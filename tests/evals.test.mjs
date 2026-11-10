// The fact-checker evals (evals/run-checker.mjs), without Claude: the cases file, the planted resumes, how a
// case is scored, and what a run is allowed to read. The live run is `node evals/run-checker.mjs`.
// Every resume here is the fictional Jordan Reyes example.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "../scripts/lib/paths.mjs";
import { parseSection, summarySentences, checkResume } from "../scripts/lib/check-resume.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { runClaude, READ } from "../scripts/lib/claude.mjs";
import {
  loadCases, exampleSettings, sourcesFor, promptFor, evalExec, isFlagged, scoreCase, runCase, main,
  EXAMPLE_SETTINGS, OWN_FOLDERS, SOURCE_FILES,
} from "../evals/run-checker.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const FIXTURE = "tests/fixtures/jordan-final.md";
const fixtureLines = read(FIXTURE).split("\n");
const cases = loadCases();
const flagCases = cases.filter((c) => c.expect === "flag");
const rules = withDefaults(JSON.parse(read("examples/preferences.json"))).resume;
const linesOf = (rel) => { const s = parseSection(read(rel)); return [...summarySentences(s), ...s.roles.flatMap((r) => r.bullets)]; };

test("the five cases: the finished resume passes, four planted problems are flagged", () => {
  assert.deepEqual(cases.map((c) => c.name), ["jordan-final", "changed-number", "inflated-ownership", "wrong-role", "keyword-list-summary"]);
  assert.equal(new Set(cases.map((c) => c.name)).size, 5);
  const [pass, ...rest] = cases;
  assert.equal(pass.expect, "pass");
  assert.equal(pass.file, FIXTURE);
  assert.equal(pass.mustFlag, undefined);
  for (const c of rest) {
    assert.equal(c.expect, "flag", c.name);
    assert.equal(c.file, `examples/evals/${c.name}.md`);
    assert.ok(c.mustFlag.length >= 1, `${c.name} names the line that must be flagged`);
  }
  for (const c of cases) assert.ok(c.plants && existsSync(join(ROOT, c.file)), c.name);
});

test("each planted resume differs from the finished one in exactly one line, and mustFlag is that line", () => {
  for (const c of flagCases) {
    const lines = read(c.file).split("\n");
    assert.equal(lines.length, fixtureLines.length, c.name);
    const changed = lines.filter((l, i) => l !== fixtureLines[i]);
    assert.equal(changed.length, 1, `${c.name} changes exactly one line`);
    const changedAt = lines.findIndex((l, i) => l !== fixtureLines[i]);
    // A bullet is its whole line; a summary sentence sits inside the summary paragraph.
    for (const m of c.mustFlag) assert.ok(linesOf(c.file).includes(m), `${c.name}: mustFlag is an exact bullet or summary sentence`);
    assert.ok(changed[0].includes(c.mustFlag[0]), `${c.name}: the changed line holds the planted text`);
    assert.ok(!fixtureLines[changedAt].includes(c.mustFlag[0]), `${c.name}: the finished resume doesn't say it`);
  }
});

test("every planted line is unique in its resume and starts differently from the true lines", () => {
  for (const c of flagCases) {
    const all = linesOf(c.file);
    for (const m of c.mustFlag) {
      assert.equal(all.filter((l) => l === m).length, 1, `${c.name}: said once`);
      assert.deepEqual(all.filter((l) => l !== m && l.slice(0, 60) === m.slice(0, 60)), [], `${c.name}: no other line shares its first 60 characters`);
    }
  }
});

test("the finished and planted resumes all pass the code checks, so only the facts are wrong", () => {
  for (const f of [FIXTURE, ...flagCases.map((c) => c.file)]) {
    assert.deepEqual(checkResume(read(f), { rules }).problems, [], f);
  }
});

test("the planted resumes keep every other line true: they share the finished resume's other lines", () => {
  const base = new Set(linesOf(FIXTURE));
  for (const c of flagCases) {
    const others = linesOf(c.file).filter((l) => !c.mustFlag.includes(l));
    for (const l of others) assert.ok(base.has(l), `${c.name}: "${l.slice(0, 50)}" is a line of the finished resume`);
  }
});

test("the planted changes are the ones each case says", () => {
  const by = (name) => cases.find((c) => c.name === name);
  assert.match(by("changed-number").mustFlag[0], /from 28% to 11%/);
  assert.match(read(FIXTURE), /from 18% to 11%/);
  assert.match(by("inflated-ownership").mustFlag[0], /^Led payments engineering/);
  assert.match(read(FIXTURE), /^- Partnered with payments engineering/m);
  // wrong-role: the line is a true fact from the Senior Product Manager job, placed under Wrenfield Health.
  const wrong = parseSection(read(by("wrong-role").file));
  assert.ok(wrong.roles[1].bullets.includes(by("wrong-role").mustFlag[0]));
  assert.match(by("wrong-role").mustFlag[0], /Apple Pay/);
  assert.match(read("examples/profile/profile.md"), /Apple Pay and other digital wallets launched in April 2024/);
  // keyword-list-summary: a summary sentence with no verb, all commas.
  const kw = by("keyword-list-summary").mustFlag[0];
  assert.ok(parseSection(read(by("keyword-list-summary").file)).summary.includes(kw));
  assert.ok(kw.split(",").length >= 6 && !/\b(find|test|bring|ran|led|wrote|built)s?\b/i.test(kw));
});

test("the sources are the example person's files, under the names the skill knows; nothing else counts", () => {
  const s = sourcesFor();
  assert.deepEqual(Object.keys(s).sort(), ["outputs/tailored-resumes.md", "profile/profile.md", "profile/stories.md"]);
  assert.equal(s["profile/profile.md"], read("examples/profile/profile.md"));
  assert.equal(s["profile/stories.md"], read("examples/profile/stories.md"));
  assert.equal(s["outputs/tailored-resumes.md"], "", "a resume is never its own source");
  for (const rel of Object.values(SOURCE_FILES)) assert.ok(rel.startsWith("examples/profile/"), rel);
});

test("the eval code never reads your own profile, stories or tailored resumes", () => {
  const src = read("evals/run-checker.mjs");
  assert.doesNotMatch(src, /\b(PROFILE|STORIES|TAILORED_FILE|RESUMES|STYLE_GUIDE|RULES_FILE)\b/);
  assert.doesNotMatch(src, /about-me/);
});

test("isFlagged matches the line named, not a different one, and a skipped line is no catch", () => {
  const line = "Added Apple Pay and other digital wallets to checkout and wrote the launch plan and enablement for 40 support and sales reps.";
  const sibling = "Added Apple Pay and other digital wallets to booking and wrote the launch plan and enablement for 40 reps.";
  const problem = (l, kind = "stretched: reason") => `${kind} (bullet: "${l.slice(0, 60)}…")`;
  assert.equal(isFlagged([problem(line)], line), true);
  assert.equal(isFlagged([problem(sibling)], line), false, "a different line is not the planted one");
  assert.equal(isFlagged([`Line not checked: "${line.slice(0, 60)}…"`], line), false);
  assert.equal(isFlagged([`quote not found in profile/profile.md: "x" (bullet: "${line.slice(0, 60)}…")`], line), true, "a made-up quote is caught by code");
  assert.equal(isFlagged([], line), false);
  assert.equal(isFlagged([problem("Short line.")], "Short line."), true, "a line under 60 characters");
});

test("a pass case needs no problems; a flag case needs every planted line flagged", () => {
  assert.equal(scoreCase({ expect: "pass" }, []), true);
  assert.equal(scoreCase({ expect: "pass" }, ["stretched: x (bullet: \"a…\")"]), false);
  const c = { expect: "flag", mustFlag: ["First line here.", "Second line here."] };
  const p = (l) => `unsupported: x (bullet: "${l}…")`;
  assert.equal(scoreCase(c, [p("First line here.")]), false);
  assert.equal(scoreCase(c, [p("First line here."), p("Second line here.")]), true);
  assert.equal(scoreCase(c, ["no result"]), false);
});

test("the prompt names the example files, the skill's names for them and the output; never the real folders as sources", () => {
  const c = flagCases[0];
  const prompt = promptFor(c, "/tmp/x/out.json");
  assert.match(prompt, /^Use the check-resume skill on the resume for https:\/\/example\.com\/jobs\/saltmere-senior-pm-checkout in examples\/evals\/changed-number\.md\./);
  assert.match(prompt, /examples\/profile\/profile\.md is "profile\/profile\.md"/);
  assert.match(prompt, /examples\/profile\/stories\.md is "profile\/stories\.md"/);
  assert.match(prompt, /never use outputs\/tailored-resumes\.md as a source_file/);
  assert.match(prompt, /Write the JSON to \/tmp\/x\/out\.json/);
  assert.match(prompt, /Keywords to confirm: none/);
});

test("a run uses the example settings and is denied your own folders", () => {
  const calls = [];
  const stub = (command, args, options) => { calls.push({ command, args, options }); return { status: 0, stdout: "{}", stderr: "" }; };
  evalExec(stub)("claude", ["-p", "x", "--allowedTools", "Read"], { cwd: ROOT });
  const { args, options } = calls[0];
  assert.equal(options.env.AJS_SETTINGS, EXAMPLE_SETTINGS);
  assert.equal(EXAMPLE_SETTINGS, join(ROOT, "examples", "preferences.json"));
  const denied = args.slice(args.indexOf("--disallowedTools") + 1);
  assert.deepEqual(denied.length, OWN_FOLDERS.length);
  for (const d of OWN_FOLDERS) assert.ok(denied.includes(`Read(/${join(ROOT, d, "**")})`), `${d}/ is denied`);
  assert.deepEqual(OWN_FOLDERS, ["profile", "outputs", "data", "archives"]);
  assert.ok(!denied.some((r) => r.includes("/examples/")), "the example files stay readable");
});

test("the eval's deny rules join the run's own deny list, so the shell stays off", () => {
  const calls = [];
  const stub = (command, args, options) => { calls.push(args); return { status: 0, stdout: "{}", stderr: "" }; };
  runClaude("eval", "x", { exec: evalExec(stub), log: () => {} });
  const args = calls[0];
  assert.equal(args.filter((a) => a === "--disallowedTools").length, 1, "one deny list");
  const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--allowedTools"));
  assert.deepEqual(denied, ["Bash", "WebFetch", "WebSearch", ...OWN_FOLDERS.map((d) => `Read(/${join(ROOT, d, "**")})`)]);
});

test("each Claude run is capped at claude.maxUsdPerStep from the example settings, and writes only its own JSON in a temp folder", (t) => {
  const settings = exampleSettings();
  assert.equal(settings.claude.maxUsdPerStep, 3);
  const dir = mkdtempSync(join(tmpdir(), "evals-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seen = [];
  const claude = (step, prompt, opts) => { seen.push({ step, prompt, opts }); return { ok: true, result: "", costUsd: 0.5, denials: [], error: "" }; };
  const r = runCase(cases[1], { dir, claude });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].opts.budgetUsd, settings.claude.maxUsdPerStep);
  assert.deepEqual(seen[0].opts.allowedTools.filter((t) => !t.startsWith("Edit(")), READ, "reads inside the project only");
  const edits = seen[0].opts.allowedTools.filter((t) => t.startsWith("Edit("));
  assert.deepEqual(edits, [`Edit(/${join(dir, "changed-number.json")})`], "one write permission: the JSON in the temp folder");
  assert.ok(!edits[0].includes(join(ROOT, "data")) && !edits[0].includes(join(ROOT, "outputs")));
  assert.ok(seen[0].prompt.includes(join(dir, "changed-number.json")));
  assert.equal(r.ok, false, "no JSON written, so the case fails");
  assert.deepEqual(r.problems, ["no result"]);
  const src = read("evals/run-checker.mjs");
  assert.doesNotMatch(src, /budgetUsd:\s*[\d.]+/, "no dollar amount of its own");
});

test("an unknown case name is an error, not a silent pass", () => {
  const errors = [];
  const was = console.error;
  console.error = (m) => errors.push(m);
  try { assert.equal(main("no-such-case"), 1); } finally { console.error = was; }
  assert.match(errors[0], /No case named "no-such-case"\. Cases: jordan-final, changed-number/);
});

test("the eval files point only at the example person: no private folders, and every employer is one in examples/profile", () => {
  // Markers of the previous setup (its folders and files, the agent that dropped jobs in) and of absolute paths on a machine.
  // Names of people and employers are caught by a separate private scan, so they are not listed in this public file.
  const PRIVATE_MARKERS = /about-me\/|openclaw|resume-style-guide|~\/job-search|\/Users\/|\/home\//i;
  const files = ["evals/README.md", "evals/run-checker.mjs", "evals/checker-cases.json", ...flagCases.map((c) => c.file)];
  for (const f of files) assert.doesNotMatch(read(f), PRIVATE_MARKERS, f);
  const profile = read("examples/profile/profile.md");
  for (const c of cases) {
    assert.ok(c.file.startsWith("examples/evals/") || c.file === FIXTURE, `${c.name}: the resume is an example file`);
    for (const r of parseSection(read(c.file)).roles) {
      const company = r.rest.split(" (")[0];
      assert.ok(profile.includes(company), `${c.name}: "${company}" is an employer in examples/profile/profile.md`);
    }
  }
});
