import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordBoard } from "../scripts/lib/health.mjs";

const file = () => join(mkdtempSync(join(tmpdir(), "health-")), "health.json");

test("a board with 0 open roles 3 runs in a row raises one alert", () => {
  const f = file();
  assert.equal(recordBoard("Globex", { open: 0 }, { file: f }).alert, null);
  assert.equal(recordBoard("Globex", { open: 0 }, { file: f }).alert, null);
  assert.match(recordBoard("Globex", { open: 0 }, { file: f }).alert, /Globex.*0 open roles.*3 runs/);
  assert.equal(recordBoard("Globex", { open: 0 }, { file: f }).alert, null, "only once per streak");
});

test("a board that errors 3 runs in a row raises an alert with the error", () => {
  const f = file();
  recordBoard("Acme", { error: "the site answered with error 403" }, { file: f });
  recordBoard("Acme", { error: "the site answered with error 403" }, { file: f });
  assert.match(recordBoard("Acme", { error: "the site answered with error 403" }, { file: f }).alert, /Acme.*error 403/);
});

test("a healthy run resets the streak", () => {
  const f = file();
  recordBoard("Initech", { open: 0 }, { file: f });
  recordBoard("Initech", { open: 0 }, { file: f });
  recordBoard("Initech", { open: 346 }, { file: f });
  assert.equal(recordBoard("Initech", { open: 0 }, { file: f }).alert, null);
});

test("job-pull records every board's health (read, not found, error) and logs alerts", async () => {
  const { readFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { pullCompanies } = await import("../scripts/job-pull.mjs");
  const recorded = [];
  const fetchBoard = async (c) => {
    if (c.name === "Gone") return null;
    if (c.name === "Broken") throw new Error("the site answered with error 500");
    return { jobs: [], open: 4 };
  };
  const companies = ["Fine", "Gone", "Broken"].map((name) => ({ name, ats: "greenhouse", slug: name.toLowerCase() }));
  await pullCompanies(companies, { fetchBoard, record: (name, result) => { recorded.push([name, result]); return { alert: null }; },
    pulledFile: join(mkdtempSync(join(tmpdir(), "health-")), "boards-pulled.json"), pause: 0, log: () => {} });
  assert.deepEqual(recorded, [
    ["Fine", { open: 4 }],
    ["Gone", { error: 'board not found (slug "gone")' }],
    ["Broken", { error: "the site answered with error 500" }],
  ]);
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.match(src, /record = recordBoard/, "the run records into data/health.json");
  assert.match(src, /function logAlerts\(/);
  assert.match(src, /crashed/);
});

test("--numbers goes through numbersOnly (which checks the Numbers setting) and logs any alerts", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  const branch = src.slice(src.indexOf('if (process.argv.includes("--numbers"))'), src.indexOf("console.log(`\\n===== Run"));
  assert.match(branch, /await numbersOnly\(\{ targets: TARGETS \}\)/);
  assert.match(branch, /logAlerts\(\)/);
});

test("when Numbers isn't running, the sync opens it and tries once more", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function syncNumbers"), src.indexOf("// Sorts jobs.csv newest first"));
  assert.match(fn, /"open", \["-g", "-a", "Numbers"\]/);
  assert.match(fn, /for \(let attempt = 1; attempt <= 2; attempt\+\+\)/);
});
