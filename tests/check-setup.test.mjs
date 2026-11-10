import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, cpSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { checkSetup, TESTED_CLAUDE_VERSION, VERSION_TIMEOUT_MS } from "../scripts/check-setup.mjs";
import { findPages, oncePerRun, PAGES_PLACES } from "../scripts/lib/pages.mjs";
import { filledSettings, LONG_PROFILE } from "./helpers.mjs";

const dir = mkdtempSync(join(tmpdir(), "check-setup-"));
const settingsFile = join(dir, "preferences.json");
const profileFile = join(dir, "profile.md");
writeFileSync(settingsFile, JSON.stringify(filledSettings()));
writeFileSync(profileFile, LONG_PROFILE);

const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
const missing = () => ({ error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), status: null, stdout: "" });
// A stand-in for spawnSync: answers `claude --version`. Nothing else may be run (no osascript: asking for Pages
// when it isn't installed opens a "Where is Pages?" dialog).
const stub = ({ claude = ok(`${TESTED_CLAUDE_VERSION} (Claude Code)\n`) } = {}) =>
  (cmd) => (cmd === "claude" ? claude : assert.fail(`check-setup ran ${cmd}`));
const withPages = { pagesInstalled: () => true };

test("the tested Claude Code version is 2.1.317", () => assert.equal(TESTED_CLAUDE_VERSION, "2.1.317"));

test("everything in place gives no problems and no warnings", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub(), ...withPages });
  assert.deepEqual(r, { problems: [], warnings: [] });
});

test("a different Claude Code version is a warning that names the tested version", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub({ claude: ok("2.1.400 (Claude Code)\n") }), ...withPages });
  assert.deepEqual(r.problems, []);
  assert.equal(r.warnings.length, 1);
  assert.ok(r.warnings[0].includes("2.1.317"));
  assert.ok(r.warnings[0].includes("2.1.400"));
});

test("a Claude Code version that can't be read is a warning", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub({ claude: ok("hello\n") }), ...withPages });
  assert.deepEqual(r.problems, []);
  assert.ok(r.warnings.some((w) => w.includes("2.1.317")));
});

test("Claude Code not installed is a problem", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub({ claude: missing() }), ...withPages });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /Claude Code isn't installed/);
});

test("Claude Code that fails to run is a problem", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub({ claude: { status: 1, stdout: "", stderr: "boom" } }), ...withPages });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /Claude Code/);
});

test("Pages missing is a warning, not a problem", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub(), pagesInstalled: () => false });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, ["Pages isn't installed, so resumes are made as Word files only"]);
});

test("the Pages check looks for the app without asking Pages (no osascript, so no 'Where is Pages?' dialog)", () => {
  const src = readFileSync(new URL("../scripts/check-setup.mjs", import.meta.url), "utf8") + readFileSync(new URL("../scripts/lib/pages.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /osascript|application "Pages"/);
  assert.deepEqual(PAGES_PLACES.slice(0, 1), ["/Applications/Pages.app"]);
  const ran = [];
  const exec = (cmd, args) => { ran.push([cmd, ...args].join(" ")); return { status: 0, stdout: "" }; };
  assert.equal(findPages({ exists: (p) => p === "/Applications/Pages.app", exec }), true);
  assert.deepEqual(ran, [], "found in Applications: Spotlight isn't asked");
  assert.equal(findPages({ exists: () => false, exec: (cmd, args) => (ran.push(cmd), { status: 0, stdout: "/Volumes/Apps/Pages.app\n" }) }), true, "found by Spotlight elsewhere");
  assert.equal(findPages({ exists: () => false, exec }), false, "nowhere: not installed");
  assert.equal(findPages({ exists: () => false, exec: () => ({ error: new Error("spawn mdfind ENOENT"), status: null, stdout: "" }) }), false);
  assert.ok(ran.every((c) => c.startsWith("mdfind")), ran.join("; "));
});

test("in a run, Pages is looked for once and a missing Pages is said once", () => {
  let checks = 0;
  const said = [];
  const has = oncePerRun(() => { checks++; return false; }, (line) => said.push(line));
  assert.deepEqual([has(), has(), has()], [false, false, false]);
  assert.equal(checks, 1);
  assert.deepEqual(said, ["Pages isn't installed, so resumes are made as Word files only."]);
  const found = oncePerRun(() => true, () => assert.fail("nothing to say when Pages is there"));
  assert.equal(found(), true);
});

test("`claude --version` has a short time limit, and a check that times out is a problem", () => {
  assert.ok(VERSION_TIMEOUT_MS > 0 && VERSION_TIMEOUT_MS <= 30000, `${VERSION_TIMEOUT_MS}`);
  const seen = [];
  checkSetup({ settingsFile, profileFile, exec: (cmd, args, options) => { seen.push(options); return ok(`${TESTED_CLAUDE_VERSION}\n`); }, ...withPages });
  assert.equal(seen[0].timeout, VERSION_TIMEOUT_MS);
  const hung = { error: Object.assign(new Error("spawnSync claude ETIMEDOUT"), { code: "ETIMEDOUT" }), status: null, stdout: "" };
  const r = checkSetup({ settingsFile, profileFile, exec: stub({ claude: hung }), ...withPages });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /didn't answer `claude --version` within \d+ seconds/);
});

test("an old Node is a problem", () => {
  const r = checkSetup({ settingsFile, profileFile, exec: stub(), nodeVersion: "18.19.0", ...withPages });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /Node/);
  assert.match(r.problems[0], /18\.19\.0/);
  assert.deepEqual(checkSetup({ settingsFile, profileFile, exec: stub(), nodeVersion: "20.0.0", ...withPages }).problems, []);
});

test("settings problems are passed through", () => {
  const r = checkSetup({ settingsFile: join(dir, "nope.json"), profileFile, exec: stub(), ...withPages });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /\/setup/);
});

// The command line makes any missing profile file in its project's profile/ folder. These tests run a copy of
// scripts/ and the profile templates in a temp folder (the scripts find their project from their own location),
// so they never touch the real profile/ folder.
const REPO = fileURLToPath(new URL("..", import.meta.url));
const PROFILE_NAMES = ["profile.md", "stories.md", "resume-rules.md"];
function tempProject() {
  // Not realpath'd on purpose: macOS's temp folder is a symlink, and the script must still run through it.
  const root = mkdtempSync(join(tmpdir(), "check-setup-project-"));
  cpSync(join(REPO, "scripts"), join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "profile"));
  for (const n of readdirSync(join(REPO, "profile")).filter((f) => f.endsWith(".example.md"))) copyFileSync(join(REPO, "profile", n), join(root, "profile", n));
  return root;
}
const runCli = (root, settings) => spawnSync(process.execPath, [join(root, "scripts", "check-setup.mjs")],
  { encoding: "utf8", env: { ...process.env, AJS_SETTINGS: settings } });
// The real profile/ folder: every file name and its text.
const realProfile = () => readdirSync(join(REPO, "profile")).sort().map((n) => [n, readFileSync(join(REPO, "profile", n), "utf8")]);

test("the command line prints each problem and exits 1", () => {
  const before = realProfile();
  const r = runCli(tempProject(), join(dir, "nope.json"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^✗ .*\/setup/m);
  assert.doesNotMatch(r.stdout, /Setup is complete/);
  assert.deepEqual(realProfile(), before, "the real profile/ folder is untouched");
});

test("the command line makes the three profile files from their templates first; profile.md is then to be filled in", () => {
  const before = realProfile();
  const root = tempProject();
  for (const n of PROFILE_NAMES) assert.equal(existsSync(join(root, "profile", n)), false, `${n} starts missing`);
  const r = runCli(root, settingsFile);
  for (const n of PROFILE_NAMES) {
    assert.equal(readFileSync(join(root, "profile", n), "utf8"), readFileSync(join(REPO, "profile", n.replace(/\.md$/, ".example.md")), "utf8"), `${n} is a copy of its template`);
  }
  // profile.md was made blank, so the run asks for it to be filled in instead of saying it doesn't exist.
  assert.match(r.stdout, /^✗ profile\/profile\.md isn't filled in yet/m);
  assert.doesNotMatch(r.stdout, /doesn't exist yet/);
  // A second run leaves what you wrote alone.
  writeFileSync(join(root, "profile", "profile.md"), LONG_PROFILE);
  const again = runCli(root, settingsFile);
  assert.equal(readFileSync(join(root, "profile", "profile.md"), "utf8"), LONG_PROFILE);
  assert.doesNotMatch(again.stdout, /profile\/profile\.md/);
  assert.deepEqual(realProfile(), before, "the real profile/ folder is untouched");
});

// On a Node older than 20 the command line must still say so in one plain line. The test stands in for an old
// Node: a preload reports the version as 18.19.0 and blanks import.meta.dirname and import.meta.filename (both
// new in Node 20.11) in every file it loads, the way an older Node leaves them undefined.
function oldNodePreload() {
  const dir = mkdtempSync(join(tmpdir(), "old-node-"));
  writeFileSync(join(dir, "hooks.mjs"), [
    "export async function load(url, context, next) {",
    "  const r = await next(url, context);",
    "  if (!url.startsWith(\"file:\") || !url.endsWith(\".mjs\") || r.source == null) return r;",
    "  const text = typeof r.source === \"string\" ? r.source : new TextDecoder().decode(r.source);",
    "  return { ...r, source: text.replace(/import\\.meta\\.(dirname|filename)/g, \"undefined\") };",
    "}",
  ].join("\n"));
  writeFileSync(join(dir, "preload.mjs"), [
    "import { register } from \"node:module\";",
    "Object.defineProperty(process.versions, \"node\", { value: \"18.19.0\" });",
    "register(\"./hooks.mjs\", import.meta.url);",
  ].join("\n"));
  return pathToFileURL(join(dir, "preload.mjs")).href;
}

test("on a Node older than 20 the command line prints the plain 'too old' line and exits 1, before making any file", () => {
  const before = realProfile();
  const root = tempProject();
  const r = spawnSync(process.execPath, ["--import", oldNodePreload(), join(root, "scripts", "check-setup.mjs")],
    { encoding: "utf8", env: { ...process.env, AJS_SETTINGS: settingsFile } });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr.trim(), "", "no crash");
  assert.equal(r.stdout.trim(), "✗ Node 18.19.0 is too old: this needs Node 20 or newer. Install the current LTS from nodejs.org.");
  for (const n of PROFILE_NAMES) assert.equal(existsSync(join(root, "profile", n)), false, `${n} was not made`);
  assert.deepEqual(realProfile(), before, "the real profile/ folder is untouched");
});
