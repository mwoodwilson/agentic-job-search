// The run is built to be fast: boards are pulled side by side, the new-roles line goes out right after the pull, up to
// 3 resumes are written at once and each is sent the moment it passes, and the slower upkeep waits until after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pullCompanies, useSettings } from "../scripts/job-pull.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { filledSettings } from "./helpers.mjs";

const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
const main = src.slice(src.indexOf("async function main()"));
const at = (needle) => { const i = main.indexOf(needle); assert.ok(i > 0, `main has ${needle}`); return i; };

test("boards are read side by side, and the results are logged in the list's order", async () => {
  useSettings(withDefaults(filledSettings()));
  const companies = ["Slow", "Fast", "Medium"].map((name) => ({ name, ats: "greenhouse", slug: name.toLowerCase() }));
  const delay = { Slow: 40, Fast: 5, Medium: 20 };
  let running = 0, most = 0;
  const fetchBoard = async (c) => { running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, delay[c.name])); running--; return { jobs: [], open: 1 }; };
  const lines = [];
  await pullCompanies(companies, { fetchBoard, record: () => ({ alert: null }), pulledFile: join(mkdtempSync(join(tmpdir(), "order-")), "pulled.json"), log: (l) => lines.push(l) });
  assert.equal(most, 3);
  assert.deepEqual(lines.map((l) => l.split(":")[0]), ["✓ Slow", "✓ Fast", "✓ Medium"]);
});

test("one board that throws is reported without stopping the others", async () => {
  const companies = [{ name: "Broken", slug: "b" }, { name: "Fine", slug: "f" }];
  const fetchBoard = async (c) => { if (c.name === "Broken") throw new Error("the site answered with error 500"); return { jobs: [], open: 2 }; };
  const lines = [];
  const r = await pullCompanies(companies, { fetchBoard, record: () => ({ alert: null }), pulledFile: join(mkdtempSync(join(tmpdir(), "order-")), "pulled.json"), log: (l) => lines.push(l) });
  assert.deepEqual(r.problems, ["Broken"]);
  assert.deepEqual(lines, ["✗ Broken: the site answered with error 500", "✓ Fine: 0 match (of 2 open)"]);
});

test("the new-roles line is queued before the writers start, and the run waits for both", () => {
  assert.ok(at("readInbox(") < at("notifyNews("), "the inbox's roles count as new roles");
  assert.ok(at("notifyNews(") < at("tailorAll()"), "queued first, so it goes out before any resume");
  assert.ok(at("tailorAll()") < at("await newsSent;"));
});

test("competencies, board repairs and the scout run after the messages", () => {
  const nothing = at("notifyNothing(");
  for (const step of ["competenciesOnceADay(", "repairBoards()", "scoutIfDue()"]) assert.ok(at(step) > nothing, `${step} after the messages`);
  assert.doesNotMatch(src.slice(src.indexOf("async function tailorAll(")), /^\s*claudeStep\(\s*`Updating competencies/m, "not inside the tailoring");
});

test("up to 3 resumes are written at once, and builds and sends go one at a time", () => {
  assert.match(src, /const PARALLEL_RESUMES = 3;/);
  assert.match(src, /tailorRoles\(roles, deps, \{ limit: PARALLEL_RESUMES,/);
  assert.match(src, /const deliver = \(link\) => oneAtATime\(/);
  assert.match(src, /deliveries\.push\(deliver\(role\.link\)\)/, "each resume is built and sent as soon as it passes");
});

test("the writer and fact-checker get their files in the prompt", () => {
  assert.match(src, /writerFiles,\s*checkerFiles,/);
  const w = src.slice(src.indexOf("function writerFiles("), src.indexOf("\n}\n", src.indexOf("function writerFiles(")));
  for (const piece of ["sharedFiles(link)", "commonStretches()", "jobSection(link)", "guideBlock("]) assert.ok(w.includes(piece), piece);
  const shared = src.slice(src.indexOf("function sharedFiles("), src.indexOf("\n}\n", src.indexOf("function sharedFiles(")));
  for (const f of ["profile/resume-rules.md", "profile/profile.md", "profile/stories.md", "outputs/tailored-resumes.md"]) assert.ok(shared.includes(f), f);
});
