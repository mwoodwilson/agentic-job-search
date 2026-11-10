// Live eval of the check-resume fact-checker against known cases (evals/checker-cases.json).
// Run it after any change to the check-resume skill, the code checks or the Claude model:  node evals/run-checker.mjs [case]
// Each case is a resume in examples/evals/ (or the finished one in tests/fixtures/) where the right answer is known.
// It runs the real skill in headless Claude, so it costs about $1.30 of Claude usage; see evals/README.md.
//
// Everything comes from the made-up person Jordan Reyes in examples/, never from your own profile/ or outputs/:
//  - the facts the fact-checker may quote are examples/profile/profile.md and stories.md, under the names
//    the skill knows them by (profile/profile.md, profile/stories.md);
//  - the dollar cap for each run is claude.maxUsdPerStep in examples/preferences.json, and AJS_SETTINGS points there;
//  - each run writes its JSON to a temp folder, which is deleted afterwards (kept, and named, if a case fails);
//  - the runs are denied your profile/, outputs/, data/ and archives/ folders, so they can't read them.
// Exits 1 if any case fails.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { runClaude, editRule, READ } from "../scripts/lib/claude.mjs";
import { verifyCheck, parseSection } from "../scripts/lib/check-resume.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { isMain } from "../scripts/lib/entry.mjs";
import { ROOT } from "../scripts/lib/paths.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

export const EXAMPLE_SETTINGS = join(ROOT, "examples", "preferences.json");
export const loadCases = () => JSON.parse(read("evals/checker-cases.json"));
export const exampleSettings = () => withDefaults(JSON.parse(readFileSync(EXAMPLE_SETTINGS, "utf8")));

// The fact-checker's valid source_file names, and the example person's file behind each of the first two.
export const SOURCE_FILES = {
  "profile/profile.md": "examples/profile/profile.md",
  "profile/stories.md": "examples/profile/stories.md",
};
// A resume is never its own source, and Jordan has no other finalized resume, so there is nothing to quote here.
export const sourcesFor = () => ({
  ...Object.fromEntries(Object.entries(SOURCE_FILES).map(([name, rel]) => [name, read(rel)])),
  "outputs/tailored-resumes.md": "",
});

// The folders that hold your own files: the eval runs may not read them.
export const OWN_FOLDERS = ["profile", "outputs", "data", "archives"];
const denyRule = (dir) => `Read(/${join(ROOT, dir, "**")})`;

export const linkOf = (c) => parseSection(read(c.file)).link;

// The prompt names the skill, the resume, the example files that stand in for the skill's own, and the output.
export const promptFor = (c, out) => {
  const stands = Object.entries(SOURCE_FILES).map(([name, rel]) => `${rel} is "${name}"`).join("; ");
  return `Use the check-resume skill on the resume for ${linkOf(c)} in ${c.file}. `
    + `This is an eval on a made-up person, Jordan Reyes, so read these files where the skill names its sources, and write the skill's name for each as the source_file: ${stands}. `
    + `Jordan has no finalized resumes, so never use outputs/tailored-resumes.md as a source_file. `
    + `Don't read anything in ${OWN_FOLDERS.map((d) => `${d}/`).join(", ")}. `
    + `Keywords to confirm: none. Write the JSON to ${out}. Include an entry for every summary sentence and every bullet.`;
};

// Wraps spawnSync for runClaude: the example settings for the run, and no reading of your own folders. The deny
// rules join the run's own deny list (which turns the shell off), so there is one list.
export const evalExec = (spawn = spawnSync) => (command, args, options) => {
  const rules = OWN_FOLDERS.map(denyRule);
  const at = args.indexOf("--disallowedTools");
  let end = at + 1;
  while (at >= 0 && end < args.length && !String(args[end]).startsWith("--")) end++;
  const withDeny = at < 0 ? [...args, "--disallowedTools", ...rules] : [...args.slice(0, end), ...rules, ...args.slice(end)];
  return spawn(command, withDeny, { ...options, env: { ...process.env, AJS_SETTINGS: EXAMPLE_SETTINGS } });
};

// A line is flagged when a problem names it: every problem quotes the line's first 60 characters. A line the
// checker skipped ("Line not checked") is not a catch.
export const isFlagged = (problems, line) =>
  problems.some((p) => !p.startsWith("Line not checked") && p.includes(`"${line.slice(0, 60)}…"`));
// A "pass" case needs no problems at all; a "flag" case needs every planted line flagged.
export const scoreCase = (c, problems) =>
  c.expect === "pass" ? problems.length === 0 : c.mustFlag.every((line) => isFlagged(problems, line));

export function runCase(c, { dir, settings = exampleSettings(), claude = runClaude, exec = evalExec() } = {}) {
  const out = join(dir, `${c.name}.json`);
  const run = claude(`eval ${c.name}`, promptFor(c, out), {
    allowedTools: [...READ, editRule(relative(ROOT, out))],
    budgetUsd: settings.claude.maxUsdPerStep,
    exec,
    log: () => {},
  });
  let check = null;
  try { check = JSON.parse(readFileSync(out, "utf8")); } catch {}
  const problems = check ? verifyCheck(check, read(c.file), sourcesFor()).problems : ["no result"];
  return { ok: scoreCase(c, problems), problems, run };
}

export function main(only = process.argv[2]) {
  const all = loadCases();
  const cases = all.filter((c) => !only || c.name === only);
  if (!cases.length) {
    console.error(`No case named "${only}". Cases: ${all.map((c) => c.name).join(", ")}`);
    return 1;
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ajs-evals-")));
  let failed = 0, cost = 0;
  for (const c of cases) {
    const { ok, problems, run } = runCase(c, { dir });
    if (!ok) failed++;
    cost += run.costUsd;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.name} ($${run.costUsd.toFixed(2)})`);
    if (run.error) console.log(`   claude run: ${run.error}`);
    if (run.denials.length) console.log(`   denied: ${run.denials.join("; ")}`);
    if (c.expect === "flag") for (const m of c.mustFlag) console.log(`   ${isFlagged(problems, m) ? "flagged " : "MISSED  "} ${m}`);
    for (const p of problems) console.log(`   · ${p.slice(0, 230)}`);
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed · $${cost.toFixed(2)}`);
  if (failed) console.log(`The checker's JSON files are in ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
  return failed ? 1 : 0;
}

if (isMain(import.meta.url)) process.exit(main());
