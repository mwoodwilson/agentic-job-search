// find-board.mjs: works out which job board a careers address belongs to and checks the board answers.
// These tests never touch the network: parseBoardUrl is pure, and findBoard takes a stand-in for fetchCompany.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoardUrl, findBoard, companyNameFromSlug } from "../scripts/find-board.mjs";

const cases = [
  ["https://job-boards.greenhouse.io/acme", { ats: "greenhouse", slug: "acme" }],
  ["https://boards.greenhouse.io/acme/jobs/123", { ats: "greenhouse", slug: "acme" }],
  ["https://jobs.lever.co/acme/abc-123", { ats: "lever", slug: "acme" }],
  ["https://jobs.ashbyhq.com/acme", { ats: "ashby", slug: "acme" }],
  ["https://jobs.gem.com/acme/am9i", { ats: "gem", slug: "acme" }],
  ["https://acme.wd5.myworkdayjobs.com/en-US/Acme_Careers/job/Remote/PM_R1", { ats: "workday", slug: "acme.wd5/Acme_Careers" }],
  ["https://acme.wd1.myworkdayjobs.com/External", { ats: "workday", slug: "acme.wd1/External" }],
  ["https://www.acme.com/careers", null],
];
for (const [url, want] of cases) test(`parseBoardUrl ${url}`, () => assert.deepEqual(parseBoardUrl(url), want));

test("parseBoardUrl ignores a trailing slash, a query string and a missing https://", () => {
  assert.deepEqual(parseBoardUrl("https://jobs.lever.co/acme/?lever-source=site"), { ats: "lever", slug: "acme" });
  assert.deepEqual(parseBoardUrl("jobs.ashbyhq.com/acme/"), { ats: "ashby", slug: "acme" });
  assert.deepEqual(parseBoardUrl("  https://job-boards.greenhouse.io/acme#jobs  "), { ats: "greenhouse", slug: "acme" });
});

test("parseBoardUrl reads the board name from a Greenhouse embed address", () => {
  assert.deepEqual(parseBoardUrl("https://boards.greenhouse.io/embed/job_board?for=acme"), { ats: "greenhouse", slug: "acme" });
  assert.equal(parseBoardUrl("https://boards.greenhouse.io/embed/job_board"), null);
});

test("parseBoardUrl reads a board name with a space or capitals as the board spells it", () => {
  assert.deepEqual(parseBoardUrl("https://jobs.ashbyhq.com/Acme%20Labs"), { ats: "ashby", slug: "Acme Labs" });
  assert.deepEqual(parseBoardUrl("https://acme.wd3.myworkdayjobs.com/fr-CA/Careers_Site"), { ats: "workday", slug: "acme.wd3/Careers_Site" });
});

test("parseBoardUrl gives null for an address with no board name, a lookalike host, or something that isn't an address", () => {
  for (const bad of [
    "https://job-boards.greenhouse.io/",
    "https://jobs.lever.co",
    "https://acme.wd5.myworkdayjobs.com/en-US",
    "https://notlever.co/acme",
    "https://jobs.lever.co.example.com/acme",
    "https://example.com/jobs.lever.co/acme",
    "",
    "not an address",
    null,
    undefined,
    42,
  ]) {
    assert.equal(parseBoardUrl(bad), null, String(bad));
  }
});

test("companyNameFromSlug makes a readable company name", () => {
  assert.equal(companyNameFromSlug("acme"), "Acme");
  assert.equal(companyNameFromSlug("acme-corp"), "Acme Corp");
  assert.equal(companyNameFromSlug("Acme Labs"), "Acme Labs");
  assert.equal(companyNameFromSlug("acme.wd5/Acme_Careers"), "Acme");
});

// ---------- findBoard, with a stand-in for fetchCompany ----------

// answers: what each ats gives back, { greenhouse: { open: 12 }, ashby: null, ... }; calls records the ats tried.
const stub = (answers, calls = []) => async (c) => {
  calls.push(c.ats);
  const a = answers[c.ats];
  if (a instanceof Error) throw a;
  return a === undefined || a === null ? null : { jobs: [], open: a.open };
};

test("findBoard returns the board, its open-role count and the line for search.companies", async () => {
  const r = await findBoard("https://boards.greenhouse.io/acme/jobs/123", "Acme Inc", stub({ greenhouse: { open: 12 } }));
  assert.deepEqual(r, { ok: true, ats: "greenhouse", slug: "acme", open: 12, entry: { name: "Acme Inc", ats: "greenhouse", slug: "acme" } });
});

test("findBoard names the company from the board name when no name is given", async () => {
  const r = await findBoard("https://jobs.lever.co/acme-corp", undefined, stub({ lever: { open: 3 } }));
  assert.equal(r.entry.name, "Acme Corp");
  assert.equal(r.nameGuessed, true);
  const named = await findBoard("https://jobs.lever.co/acme-corp", "Acme", stub({ lever: { open: 3 } }));
  assert.equal(named.nameGuessed, undefined);
});

test("findBoard says so when the board doesn't exist, and tries only that board", async () => {
  const calls = [];
  const r = await findBoard("https://jobs.lever.co/nope", "Nope", stub({}, calls));
  assert.equal(r.ok, false);
  assert.match(r.message, /no job board answered/i);
  assert.deepEqual(calls, ["lever"]);
});

test("findBoard tries the Ashby hosted page when the Ashby API is closed", async () => {
  const calls = [];
  const r = await findBoard("https://jobs.ashbyhq.com/acme", "Acme", stub({ ashby: null, "ashby-page": { open: 7 } }, calls));
  assert.deepEqual(calls, ["ashby", "ashby-page"]);
  assert.deepEqual(r, { ok: true, ats: "ashby-page", slug: "acme", open: 7, entry: { name: "Acme", ats: "ashby-page", slug: "acme" } });
});

test("findBoard tries the Ashby hosted page when the Ashby API shows no roles, and keeps the API if the page shows none either", async () => {
  const a = await findBoard("https://jobs.ashbyhq.com/acme", "Acme", stub({ ashby: { open: 0 }, "ashby-page": { open: 5 } }));
  assert.equal(a.ats, "ashby-page");
  assert.equal(a.open, 5);
  const b = await findBoard("https://jobs.ashbyhq.com/acme", "Acme", stub({ ashby: { open: 0 }, "ashby-page": { open: 0 } }));
  assert.equal(b.ats, "ashby");
  assert.equal(b.open, 0);
});

test("findBoard doesn't try the hosted page when the Ashby API works", async () => {
  const calls = [];
  const r = await findBoard("https://jobs.ashbyhq.com/acme", "Acme", stub({ ashby: { open: 4 } }, calls));
  assert.deepEqual(calls, ["ashby"]);
  assert.equal(r.ats, "ashby");
});

test("findBoard says so when neither Ashby route answers, even if the hosted page errors", async () => {
  const r = await findBoard("https://jobs.ashbyhq.com/nope", "Nope", stub({ ashby: null, "ashby-page": new Error("the Ashby page has no job list") }));
  assert.equal(r.ok, false);
  assert.match(r.message, /no job board answered/i);
});

test("findBoard reports a network error in plain words", async () => {
  const r = await findBoard("https://jobs.gem.com/acme", "Acme", stub({ gem: new Error("the site answered with error 503") }));
  assert.equal(r.ok, false);
  assert.match(r.message, /503/);
});

test("findBoard asks for the job board address when the address isn't a job board, without checking anything", async () => {
  const calls = [];
  const r = await findBoard("https://www.acme.com/careers", "Acme", stub({}, calls));
  assert.equal(r.ok, false);
  assert.match(r.message, /greenhouse|lever|ashby|gem|workday/i);
  assert.deepEqual(calls, []);
});

test("findBoard never lets the check open every posting's details", async () => {
  let known;
  await findBoard("https://acme.wd5.myworkdayjobs.com/External", "Acme", async (c, k) => { known = k; return { jobs: [], open: 1 }; });
  assert.equal(known.has("https://anything"), true);
});
