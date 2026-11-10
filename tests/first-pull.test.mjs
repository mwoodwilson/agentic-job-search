// The money guard on first pulls: the first time a company's job board is read, the roles already open there land as
// "Backlog", not "New", so adding a company (or fixing a board that never worked) never queues every open role for a
// paid resume at once. Later pulls land new roles as "New". Boards are stubbed; the record is a temp file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pullCompanies, landingStatus, useSettings, runSummary } from "../scripts/job-pull.mjs";
import { recordPulls, firstPulls, boardKey } from "../scripts/lib/first-pull.mjs";
import { PULLED_FILE, DATA_DIR } from "../scripts/lib/paths.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { filledSettings } from "./helpers.mjs";

useSettings(withDefaults(filledSettings())); // titles must contain "product manager"; anywhere; no pay floor

const ACME = { name: "Acme", ats: "greenhouse", slug: "acme" };
const BETA = { name: "Beta", ats: "lever", slug: "beta" };
const job = (company, n) => ({ company: company.name, title: `Senior Product Manager ${n}`, location: "Remote", url: `https://jobs.example.com/${company.slug}/${n}` });
// A stand-in for fetchCompany: each company's board lists `open[name]` postings.
const boards = (open) => async (c) => (c.name in open ? { jobs: open[c.name].map((n) => job(c, n)), open: open[c.name].length } : null);
const quiet = { record: () => ({ alert: null }), pause: 0, log: () => {} };
const recordFile = () => join(mkdtempSync(join(tmpdir(), "first-pull-")), "boards-pulled.json");

// One run's pull: what the board reading found, and the Status each kept role lands with. Records the boards read,
// as the run does once the roles are written.
async function run(companies, open, file, { backlog = false } = {}) {
  const r = await pullCompanies(companies, { fetchBoard: boards(open), pulledFile: file, ...quiet });
  const statuses = Object.fromEntries(r.kept.map((j) => [j.url, landingStatus(j, { backlog, firstPull: r.firstPull })]));
  recordPulls(r.readOk, { file });
  return { ...r, statuses };
}

test("the record of boards already read lives in data/, keyed by board type and name", () => {
  assert.equal(PULLED_FILE, join(DATA_DIR, "boards-pulled.json"));
  assert.equal(boardKey({ name: "Acme", ats: "Greenhouse", slug: "Acme" }), "greenhouse|acme");
});

test("a company's first pull lands its roles as Backlog", async () => {
  const file = recordFile();
  const r = await run([ACME], { Acme: [1, 2, 3] }, file);
  assert.deepEqual([...r.firstPull], ["Acme"]);
  assert.deepEqual(Object.values(r.statuses), ["Backlog", "Backlog", "Backlog"]);
  assert.ok(existsSync(file));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))), ["greenhouse|acme"]);
});

test("the second pull's new role lands as New", async () => {
  const file = recordFile();
  await run([ACME], { Acme: [1, 2] }, file);
  const second = await run([ACME], { Acme: [1, 2, 3] }, file);
  assert.deepEqual([...second.firstPull], []);
  assert.equal(second.statuses["https://jobs.example.com/acme/3"], "New");
});

test("a newly added company next to an established one: only the new company's roles are Backlog", async () => {
  const file = recordFile();
  await run([ACME], { Acme: [1] }, file);
  const r = await run([ACME, BETA], { Acme: [1, 2], Beta: [1, 2] }, file);
  assert.deepEqual([...r.firstPull], ["Beta"]);
  assert.deepEqual(r.statuses, {
    "https://jobs.example.com/acme/1": "New", "https://jobs.example.com/acme/2": "New",
    "https://jobs.example.com/beta/1": "Backlog", "https://jobs.example.com/beta/2": "Backlog",
  });
});

test("a board that isn't found or errors isn't recorded, so the pull that finally works still lands as Backlog", async () => {
  const file = recordFile();
  const missing = await run([BETA], {}, file); // board not found (wrong name)
  assert.deepEqual(missing.problems, ["Beta"]);
  const failing = await pullCompanies([BETA], { fetchBoard: async () => { throw new Error("the site answered with error 500"); }, pulledFile: file, ...quiet });
  assert.deepEqual(failing.readOk, []);
  recordPulls(failing.readOk, { file });
  const fixed = await run([BETA], { Beta: [1, 2] }, file);
  assert.deepEqual(Object.values(fixed.statuses), ["Backlog", "Backlog"]);
});

test("a corrected board name is a new board: its first pull lands as Backlog too", async () => {
  const file = recordFile();
  await run([ACME], { Acme: [1] }, file);
  const moved = { ...ACME, slug: "acme-careers" };
  assert.deepEqual([...firstPulls([moved], { file })], ["Acme"]);
});

test("a board read with 0 open roles counts as read, so its first real posting later lands as New", async () => {
  const file = recordFile();
  await run([ACME], { Acme: [] }, file);
  const later = await run([ACME], { Acme: [1] }, file);
  assert.equal(later.statuses["https://jobs.example.com/acme/1"], "New");
});

test("--backlog lands every role as Backlog, first pull or not", async () => {
  const file = recordFile();
  await run([ACME], { Acme: [1] }, file);
  const r = await run([ACME], { Acme: [1, 2] }, file, { backlog: true });
  assert.deepEqual(Object.values(r.statuses), ["Backlog", "Backlog"]);
});

test("the run records the boards only after their roles are in jobs.csv and seen-jobs.json", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const added = main.indexOf("await addToJobsCsv(kept, today, (j) => landingStatus(j, { backlog, firstPull }))");
  const seen = main.indexOf("writeAtomic(SEEN_FILE");
  const recorded = main.indexOf("recordPulls(readOk)");
  assert.ok(added > 0 && seen > added && recorded > seen, "jobs.csv, then seen-jobs.json, then the record");
});

// The same line shows for a company just added and for every board on an existing install's first run under this
// version, so it can't claim the roles "were already open".
test("the first-pull console line is true for a new company and for an existing install's first run", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.match(src, /First pull for this board \(\$\{\[\.\.\.firstPull\]\.join\(", "\)\}\): \$\{firstBacklog\} new role\(s\) land as "Backlog"/);
  assert.doesNotMatch(src, /were already open, so they're "Backlog"/);
});

test("the run's log line says how many new roles landed as Backlog on a first pull", () => {
  assert.equal(runSummary({ added: 12, firstBacklog: 9, notify: false }), "12 new roles (9 Backlog, first pull)");
  assert.equal(runSummary({ added: 3, backlog: true, notify: false }), "3 new roles (Backlog)");
  assert.equal(runSummary({ added: 2, notify: false }), "2 new roles");
});
