// Real failures from the pipeline's first weeks, each pinned so it can't come back. See evals/README.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compStatus, ashbyJobs, ashbyUrl, orderJobsCsv, workdayListBody, fetchWorkday, runPlan, useSettings } from "../scripts/job-pull.mjs";
import { skillsLine, newestPerLink, withPagesRetry } from "../scripts/resume-docx.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { filledSettings } from "./helpers.mjs";

const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");

test("Acme: a USD range is judged on USD even when a CAD range is also listed", () => {
  const job = { pay: "162,100–224,500 USD; 153,000–190,000 CAD", description: "The base salary range for this role is $162,100 - $224,500. You'll also be eligible for equity." };
  assert.equal(compStatus(job, { minTop: 240000, minBaseTop: 170000 }), "Pass: base over $170K plus bonus/equity, top under $240K");
});

test("pay listed only in another currency still goes to Review", () => {
  assert.equal(compStatus({ pay: "153,000–190,000 CAD", description: "" }, { minTop: 240000, minBaseTop: 170000 }), "Review: pay not in USD");
});

test("Globex: Ashby's isRemote flag on a hybrid role doesn't make it remote", () => {
  const [j] = ashbyJobs({ jobs: [{ title: "Product Marketing Lead", location: "San Francisco", isRemote: true, workplaceType: "Hybrid" }] }, { name: "Globex" });
  assert.equal(j.location, "San Francisco");
  const [r] = ashbyJobs({ jobs: [{ title: "PM", location: "San Francisco", isRemote: true, workplaceType: "Remote" }] }, { name: "Globex" });
  assert.match(r.location, /Remote/);
});

test("a skill name never splits across lines (non-breaking spaces inside each skill)", () => {
  assert.equal(skillsLine("Product Management | Go-to-Market Strategy | SQL"), "Product\u00a0Management | Go-to-Market\u00a0Strategy | SQL");
});

test("a failed file build holds the role and alerts; a resume with no file is skipped, not a crash", () => {
  const build = src.slice(src.indexOf("async function buildResume("), src.indexOf("\n}\n", src.indexOf("async function buildResume(")));
  assert.match(build, /const held = \(problems\) => \{\s*safeStatus\(link, "Needs review"\);\s*logEvent\("failure"/);
  assert.match(build, /return \{ review: \{ link, title: name, problems \} \}/);
  assert.match(build, /catch \(e\) \{[\s\S]*return held\(\[`The Word\/PDF build failed: \$\{e\.message\}`\]\)/);
  const send = src.slice(src.indexOf("async function notifyResume("), src.indexOf("\n}\n", src.indexOf("async function notifyResume(")));
  assert.match(send, /const src = r\.pdf \|\| r\.docx;\s*if \(!src \|\| !\(texting \|\| emailing\)\) return \{ sent: false \};/, "a resume with no file is sent on neither channel");
});

test("the trim prompt names the resume by its link; the role-guide restore writes atomically", () => {
  assert.match(src, /The resume in \$\{draft\} \(Link: \$\{link\}/);
  const restore = src.slice(src.indexOf("async function restoreRoleGuides"), src.indexOf("async function restoreRoleGuides") + 600);
  assert.match(restore, /writeAtomic\(/);
  assert.doesNotMatch(restore, /await writeFile\(/);
});

test("--retailor <link>: sets that role back to New and has the loop write a fresh resume", () => {
  assert.match(src, /process\.argv\.indexOf\("--retailor"\)/);
  assert.match(src, /safeStatus\(link, "New"\)/);
  assert.match(src, /fresh: retailor\.has\(row\.Link\)/);
});

test("--retailor: a role with an old and a new resume builds and sends only the newest", () => {
  const secs = [
    { url: "https://a", short: false, markdown: "new A" },
    { url: "https://b", short: false, markdown: "B" },
    { url: "https://a", short: false, markdown: "old A" },
    { url: "https://a", short: true, markdown: "short A" },
  ];
  assert.deepEqual(newestPerLink(secs).map((s) => s.markdown), ["new A", "B", "short A"]);
  assert.match(src, /newestPerLink\(await tailoredSections\(\)\)\.find\(\(x\) => x\.url === link && !x\.short\)/);
});

test("an Ashby board name with spaces is encoded once, not twice (%20, never %2520)", () => {
  assert.equal(ashbyUrl({ slug: "Acme Platform Inc" }), "https://api.ashbyhq.com/posting-api/job-board/Acme%20Platform%20Inc?includeCompensation=true");
  assert.equal(ashbyUrl({ slug: "acme" }), "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true");
});

test("a Workday board's list request carries the company's own filters (facets), sent as-is", () => {
  const us = { Country_and_Jurisdiction: ["0123456789abcdef0123456789abcdef"] };
  assert.deepEqual(workdayListBody({ facets: us }, 40), { appliedFacets: us, limit: 20, offset: 40, searchText: "" });
  assert.deepEqual(workdayListBody({ slug: "acme.wd1/Ext" }, 0).appliedFacets, {}, "boards without filters are unchanged");
});

test("speed: a Workday role the pull already has is not reopened for its details; a new one is", async () => {
  const s = withDefaults(filledSettings());
  s.search.locationKeywords = ["chicago"];
  useSettings(s);
  const calls = [];
  const realFetch = globalThis.fetch;
  const reply = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/jobs")) return reply({ total: 2, jobPostings: [
      { title: "Product Manager", locationsText: "Chicago, IL", externalPath: "/job/CHI/Old_1" },
      { title: "Product Manager, Ads", locationsText: "Chicago, IL", externalPath: "/job/CHI/New_2" },
    ] });
    return reply({ jobPostingInfo: { location: "Chicago, IL", startDate: "2026-11-06", jobDescription: "<p>$200,000 - $300,000 base</p>" } });
  };
  try {
    const known = new Set(["https://acme.wd1.myworkdayjobs.com/Ext/job/CHI/Old_1"]);
    const jobs = await fetchWorkday({ name: "Acme", ats: "workday", slug: "acme.wd1/Ext" }, known);
    assert.deepEqual(calls.filter((u) => !u.endsWith("/jobs")), ["https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Ext/job/CHI/New_2"]);
    assert.match(jobs.find((j) => j.url.endsWith("New_2")).description, /\$200,000/);
    assert.equal(jobs.length, 2, "the known role is still counted as open");
  } finally { globalThis.fetch = realFetch; }
});

test("speed: --resume-only skips the job boards and board repairs", () => {
  assert.deepEqual(runPlan(["node", "job-pull.mjs", "--resume-only"]), { pullBoards: false, repairBoards: false });
  assert.deepEqual(runPlan(["node", "job-pull.mjs"]), { pullBoards: true, repairBoards: true });
  assert.deepEqual(runPlan(["node", "job-pull.mjs", "--no-ai"]), { pullBoards: true, repairBoards: false });
});

test("Initech: a role found later in the day is listed above that day's earlier roles", () => {
  const head = '"Fit","Status","Company","Title","Location","Team","Pay","Pay check","Posted","Found","Link"';
  const row = (co, posted, found) => `"","New","${co}","PM","","","","","${posted}","${found}","https://x/${co}"`;
  const old = [head, row("Acme", "2026-11-06", "2026-11-06"), row("Globex", "2026-11-06", "2026-11-06"), row("Umbrella", "2026-11-05", "2026-11-06")].join("\n") + "\n";
  const out = orderJobsCsv(old, [row("Initech", "2026-11-06", "2026-11-06"), row("Hooli", "", "2026-11-07")]);
  const order = out.trim().split("\n").slice(1).map((l) => l.split('","')[2]);
  assert.deepEqual(order, ["Hooli", "Initech", "Acme", "Globex", "Umbrella"]);
  // Sorting again (every run does) keeps the same order.
  assert.equal(orderJobsCsv(out), out);
});

test("a PDF export that fails because Pages is closed opens Pages and tries again", () => {
  let tries = 0, opened = 0;
  const pages = withPagesRetry(() => {
    if (++tries === 1) throw new Error("osascript failed: Pages got an error: Application isn't running. (-600)");
    return 1;
  }, () => opened++);
  assert.equal(pages, 1);
  assert.equal(tries, 2);
  assert.equal(opened, 1);
});

test("a PDF export that works the first time doesn't open Pages; a second failure still fails", () => {
  let opened = 0;
  assert.equal(withPagesRetry(() => 1, () => opened++), 1);
  assert.equal(opened, 0);
  assert.throws(() => withPagesRetry(() => { throw new Error("still closed"); }, () => {}), /still closed/);
});
