import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setStatus, getRows } from "../scripts/lib/jobs-csv.mjs";

const CSV = '﻿"Fit","Status","Company","Title","Location","Team","Pay","Pay check","Posted","Found","Link"\n' +
  '"","New","Initech","PM, Ticketing","Remote","","$1 – $2","Pass","2026-11-03","2026-11-04","https://a.example/1"\n' +
  '"","Backlog","Acme","PM, ""Core""","NYC","","","Review","","2026-11-04","https://a.example/2"\n';
const file = () => { const f = join(mkdtempSync(join(tmpdir(), "csv-")), "jobs.csv"); writeFileSync(f, CSV); return f; };

test("setStatus changes only that row's Status", () => {
  const f = file();
  setStatus("https://a.example/1", "Resume ready", { file: f });
  const lines = readFileSync(f, "utf8").split("\n");
  assert.match(lines[1], /^"","Resume ready","Initech",/);
  assert.equal(lines[2], CSV.split("\n")[2]);
  assert.equal(lines[0], CSV.split("\n")[0]);
});

test("setStatus rejects an unknown link or status", () => {
  const f = file();
  assert.throws(() => setStatus("https://nope", "Skip", { file: f }), /link/);
  assert.throws(() => setStatus("https://a.example/1", "Done", { file: f }), /status/);
});

test("getRows reads quoted cells", () => {
  const rows = getRows({ file: file() });
  assert.equal(rows[1].Title, 'PM, "Core"');
  assert.equal(rows[0].Status, "New");
});

test("setStatus works on a file saved with Windows line endings, and keeps them", () => {
  const f = join(mkdtempSync(join(tmpdir(), "csv-")), "jobs.csv");
  writeFileSync(f, CSV.replace(/\n/g, "\r\n"));
  setStatus("https://a.example/2", "Skip", { file: f });
  const text = readFileSync(f, "utf8");
  assert.match(text, /"","Skip","Acme"/);
  assert.equal(text.split("\r\n").length, CSV.split("\n").length);
});

test("job-pull guards setStatus so one bad row can't crash the run", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.equal((src.match(/\bsetStatus\(/g) || []).length, 1, "only safeStatus calls setStatus directly");
  assert.match(src, /function safeStatus\(/);
});

test("application statuses Rejected and Recruiter screen can be set", () => {
  const f = file();
  setStatus("https://a.example/1", "Rejected", { file: f });
  setStatus("https://a.example/2", "Recruiter screen", { file: f });
  const rows = getRows({ file: f });
  assert.deepEqual(rows.map((r) => r.Status), ["Rejected", "Recruiter screen"]);
});

test("getRows on a fresh setup (no jobs.csv yet) returns no rows", () => {
  assert.deepEqual(getRows({ file: join(mkdtempSync(join(tmpdir(), "csv-")), "jobs.csv") }), []);
});
