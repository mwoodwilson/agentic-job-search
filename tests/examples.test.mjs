import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "../scripts/lib/paths.mjs";
import { withDefaults, validateSettings, profileFilledIn } from "../scripts/lib/settings.mjs";
import { HARD_RULES_START, HARD_RULES_END, HARD_RULES_BLOCK, restoreHardRules } from "../scripts/lib/rules.mjs";
import { ensureProfileFiles, exampleOf } from "../scripts/lib/profile-files.mjs";
import { parseSection, summarySentences } from "../scripts/lib/check-resume.mjs";

const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const exampleProfile = read("examples", "profile", "profile.md");
const exampleStories = read("examples", "profile", "stories.md");
const exampleRules = read("examples", "profile", "resume-rules.md");

test("the shipped profile templates are blank; the example profile is filled in", () => {
  assert.equal(profileFilledIn(read("profile", "profile.example.md")), false);
  assert.equal(profileFilledIn(read("profile", "stories.example.md")), false);
  assert.equal(profileFilledIn(exampleProfile), true);
});

test("the example settings pass validation, with every notification off", () => {
  const raw = JSON.parse(read("examples", "preferences.json"));
  const s = withDefaults(raw);
  assert.deepEqual(validateSettings(s, { profileText: exampleProfile }), []);
  assert.equal(s.notifications.imessage.enabled, false);
  assert.equal(s.notifications.email.enabled, false);
  assert.equal(s.notifications.numbers.enabled, false);
  assert.ok(s.search.companies.length >= 3 && s.search.companies.length <= 4, "3 or 4 boards");
});

test("the hard rules block has its markers and the six rules", () => {
  assert.ok(HARD_RULES_BLOCK.startsWith(HARD_RULES_START));
  assert.ok(HARD_RULES_BLOCK.endsWith(HARD_RULES_END));
  assert.equal([...HARD_RULES_BLOCK.matchAll(/^\d\. /gm)].length, 6);
  assert.match(HARD_RULES_BLOCK, /300–350 characters/);
});

test("both rules files carry the hard rules block exactly", () => {
  assert.ok(read("profile", "resume-rules.example.md").includes(HARD_RULES_BLOCK));
  assert.ok(exampleRules.includes(HARD_RULES_BLOCK));
  assert.equal(restoreHardRules(read("profile", "resume-rules.example.md")).changed, false);
});

test("restoreHardRules undoes an edit to a rule and leaves an untouched file alone", () => {
  const untouched = restoreHardRules(exampleRules);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.text, exampleRules);

  const edited = exampleRules.replace("300–350 characters", "250–400 characters");
  assert.notEqual(edited, exampleRules);
  const fixed = restoreHardRules(edited);
  assert.equal(fixed.changed, true);
  assert.ok(fixed.text.includes(HARD_RULES_BLOCK));
  assert.equal(fixed.text, exampleRules);
});

test("restoreHardRules keeps the user's own rules and puts a missing block back at the top", () => {
  const mine = "## My rules\nNever say \"synergy\".\n";
  const fixed = restoreHardRules(mine);
  assert.equal(fixed.changed, true);
  assert.ok(fixed.text.startsWith(HARD_RULES_BLOCK));
  assert.ok(fixed.text.includes(mine));
  assert.equal(restoreHardRules(fixed.text).changed, false);
  assert.equal(restoreHardRules("").text, HARD_RULES_BLOCK + "\n");

  const stray = restoreHardRules(HARD_RULES_START + "\n1. Anything goes.\n" + mine);
  assert.equal(stray.changed, true);
  assert.equal(stray.text.split(HARD_RULES_START).length, 2, "one start marker, not two");
  assert.ok(stray.text.startsWith(HARD_RULES_BLOCK));
  assert.ok(stray.text.includes("Anything goes"), "the text around a stray marker is kept");
});

test("the example resume is one finalized section for the sample job", () => {
  const sampleJob = read("examples", "sample-job.md");
  const md = read("tests", "fixtures", "jordan-final.md");
  const s = parseSection(md);
  assert.match(sampleJob, /^Link: (\S+)/m);
  assert.equal(s.link, sampleJob.match(/^Link: (\S+)/m)[1]);
  assert.match(md, /^Final:/m);
  assert.equal(s.roles.length, 3);
  assert.ok(s.coverage && s.coverage.x === s.keywords.filter((k) => k.ok).length && s.coverage.y === s.keywords.length);
});

test("every number in the example resume comes from Jordan's files", () => {
  const sources = exampleProfile + "\n" + exampleStories;
  const s = parseSection(read("tests", "fixtures", "jordan-final.md"));
  for (const line of [...summarySentences(s), ...s.roles.flatMap((r) => r.bullets)]) {
    for (const n of line.match(/\$?\d[\d,.]*[%MK+]?/g) || []) {
      const num = n.replace(/[.,]$/, "");
      assert.ok(sources.includes(num), `"${num}" is not in examples/profile: ${line.slice(0, 60)}`);
    }
  }
});

test("the three profile files are git-ignored and ship as .example.md templates", () => {
  const ignored = read(".gitignore").split("\n").map((l) => l.trim());
  for (const name of ["profile.md", "stories.md", "resume-rules.md"]) {
    assert.ok(ignored.includes(`profile/${name}`), `${name} is git-ignored`);
    assert.ok(existsSync(join(ROOT, "profile", exampleOf(name))), `profile/${exampleOf(name)} ships with the project`);
  }
});

test("ensureProfileFiles makes missing profile files from their examples and never touches existing ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "profile-files-"));
  const names = ["profile.md", "stories.md", "resume-rules.md"];
  const files = names.map((n) => join(dir, n));
  for (const f of files) writeFileSync(exampleOf(f), `template for ${f}\n`);

  const first = ensureProfileFiles({ files });
  assert.deepEqual(first, files);
  for (const f of files) assert.equal(readFileSync(f, "utf8"), readFileSync(exampleOf(f), "utf8"));

  writeFileSync(files[0], "my own profile\n");
  rmSync(files[1]);
  const second = ensureProfileFiles({ files });
  assert.deepEqual(second, [files[1]], "only the missing one is made");
  assert.equal(readFileSync(files[0], "utf8"), "my own profile\n", "an existing file is left untouched");
  assert.deepEqual(ensureProfileFiles({ files }), []);

  mkdirSync(join(dir, "sub"));
  assert.deepEqual(ensureProfileFiles({ files: [join(dir, "sub", "notes.md")] }), [], "no example, nothing made");
  assert.equal(existsSync(join(dir, "sub", "notes.md")), false);
});

test("the shipped templates are enough to make a fresh profile folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "profile-fresh-"));
  for (const n of ["profile.md", "stories.md", "resume-rules.md"]) writeFileSync(join(dir, exampleOf(n)), read("profile", exampleOf(n)));
  const made = ensureProfileFiles({ files: ["profile.md", "stories.md", "resume-rules.md"].map((n) => join(dir, n)) });
  assert.equal(made.length, 3);
  assert.equal(readFileSync(join(dir, "resume-rules.md"), "utf8"), read("profile", "resume-rules.example.md"));
});
