// The hourly run is driven by config/preferences.json: it refuses to start without it, and every rule comes from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, DATA_DIR, LOCK_FILE } from "../scripts/lib/paths.mjs";
import { ATS_TYPES, withDefaults } from "../scripts/lib/settings.mjs";
import { passesFilters, compStatus, archiveFor, extractAshbyPostings, fetchCompany, useSettings, ensureInbox } from "../scripts/job-pull.mjs";
import { filledSettings } from "./helpers.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ajs-"));

test("job-pull refuses to run without settings", () => {
  const file = join(tmp(), "preferences.json");
  const s = filledSettings();
  s.candidate.name = null;
  writeFileSync(file, JSON.stringify(s));
  const hadData = existsSync(DATA_DIR);
  const r = spawnSync("node", ["scripts/job-pull.mjs", "--no-ai"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, AJS_SETTINGS: file }, timeout: 20000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✗ candidate\.name/);
  assert.match(r.stdout, /Run "node scripts\/check-setup\.mjs" or \/setup in Claude Code\./);
  assert.equal(existsSync(LOCK_FILE), false, "no lock was taken");
  if (!hadData) assert.equal(existsSync(DATA_DIR), false, "no data folder was made");
});

const search = (over = {}) => ({ titleKeywords: ["product manager"], titleExclude: [], locationKeywords: [], usOnly: true, ...over });

test("usOnly decides whether roles outside the US are kept", () => {
  const job = { title: "Senior Product Manager", location: "Remote - United Kingdom" };
  assert.equal(passesFilters(job, search({ usOnly: false })), true);
  assert.equal(passesFilters(job, search({ usOnly: true })), false);
});

test("titleExclude drops whole words only", () => {
  const s = search({ titleKeywords: ["product"], titleExclude: ["director"] });
  assert.equal(passesFilters({ title: "Director, Product", location: "Remote" }, s), false);
  assert.equal(passesFilters({ title: "Product Manager, Directory Services", location: "Remote" }, s), true);
});

test("title and location keywords come from the search settings", () => {
  const s = search({ locationKeywords: ["chicago", "remote"] });
  assert.equal(passesFilters({ title: "Product Manager", location: "Chicago, IL" }, s), true);
  assert.equal(passesFilters({ title: "Product Manager", location: "Denver, CO" }, s), false);
  assert.equal(passesFilters({ title: "Account Executive", location: "Chicago, IL" }, s), false);
});

test("the pay rule uses the pay settings", () => {
  const job = { pay: "$140,000 - $190,000", description: "The base salary range for this role is $140,000 - $190,000. Plus an annual bonus." };
  assert.equal(compStatus(job, { minTop: 200000, minBaseTop: 150000 }), "Pass: base over $150K plus bonus/equity, top under $200K");
});

test("archiveFor picks the first family whose keywords match, else the catch-all", () => {
  const families = [{ name: "Product Marketing", titleKeywords: ["product marketing"] }, { name: "Product Manager", titleKeywords: [] }];
  assert.equal(archiveFor("Senior Product Marketing Manager", families), "Product Marketing");
  assert.equal(archiveFor("Staff PM, Growth", families), "Product Manager");
  const catchAllFirst = [{ name: "Jobs", titleKeywords: [] }, { name: "Strategy", titleKeywords: ["strategy"] }];
  assert.equal(archiveFor("Product Strategy Lead", catchAllFirst), "Strategy");
  assert.equal(archiveFor("Head of Product", [{ name: "Marketing", titleKeywords: ["marketing"] }]), "Marketing", "no match and no catch-all: the first family");
});

test("extractAshbyPostings reads the job list embedded in a hosted Ashby page", () => {
  const html = `<html><script>window.__appData = {"org":"x","jobPostings":[{"id":"a1","title":"PM"}],"more":[1]};</script></html>`;
  assert.deepEqual(extractAshbyPostings(html), [{ id: "a1", title: "PM" }]);
  assert.throws(() => extractAshbyPostings("<html></html>"), /no job list/);
});

const reply = (status, body = "") => ({ ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body || "{}") });
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("fetchCompany knows every board type in settings, and names an unknown one", async () => {
  await withFetch(async () => reply(404), async () => {
    for (const ats of ATS_TYPES) assert.equal(await fetchCompany({ name: "Acme", ats, slug: "acme.wd1/Ext" }, new Set(), {}), null, ats);
    await assert.rejects(fetchCompany({ name: "Acme", ats: "taleo", slug: "acme" }), /unknown/);
  });
});

test("ashby-page boards: each posting is dated the first time it was seen (baseline on the company's first run)", async () => {
  useSettings(withDefaults(filledSettings()));
  const page = (ids) => `<script>{"jobPostings":[${ids.map((id) => `{"id":"${id}","title":"Product Manager ${id}","locationName":"Remote","workplaceType":"Remote"}`).join(",")},{"id":"x9","title":"Account Executive","locationName":"Austin"}]}</script>`;
  let ids = ["a1"];
  const opened = [];
  await withFetch(async (url) => {
    if (url === "https://jobs.ashbyhq.com/acme") return reply(200, page(ids));
    opened.push(url);
    return reply(200, '{"descriptionHtml":"<p>Build things.</p>"}');
  }, async () => {
    const c = { name: "Acme", ats: "ashby-page", slug: "acme" };
    const seen = {};
    const first = await fetchCompany(c, new Set(), seen);
    assert.equal(first.open, 2);
    const a1 = first.jobs.find((j) => j.url === "https://jobs.ashbyhq.com/acme/a1");
    assert.equal(a1.posted, "2000-01-01T00:00:00.000Z");
    assert.equal(a1.company, "Acme");
    assert.match(a1.location, /Remote/);
    assert.match(a1.description, /Build things/);
    assert.deepEqual(opened, ["https://jobs.ashbyhq.com/acme/a1"], "only matching postings are opened for their description");

    ids = ["a1", "b2"];
    opened.length = 0;
    const second = await fetchCompany(c, new Set(Object.keys(seen)), seen);
    const b2 = second.jobs.find((j) => j.url.endsWith("/b2"));
    assert.equal(b2.posted.slice(0, 10), new Date().toISOString().slice(0, 10));
    assert.equal(second.jobs.find((j) => j.url.endsWith("/a1")).posted, "2000-01-01T00:00:00.000Z");
    assert.deepEqual(opened, ["https://jobs.ashbyhq.com/acme/b2"], "a posting already known isn't reopened");
  });
});

test("a missing inbox.md is made from the optional-inbox template; an existing one is left alone", () => {
  const file = join(tmp(), "inbox.md");
  assert.equal(ensureInbox(file), true);
  const text = readFileSync(file, "utf8");
  assert.match(text, /<!-- ENTRIES BELOW -->/);
  assert.match(text, /^Link: /m);
  assert.doesNotMatch(text, /INBOX TEMPLATE/);
  writeFileSync(file, "mine\n");
  assert.equal(ensureInbox(file), false);
  assert.equal(readFileSync(file, "utf8"), "mine\n");
});
