// A script runs as a program only when it is the file node was asked to run. Under a symlinked folder or file
// (macOS's /var is /private/var; a user may link their project folder) the two paths differ as text, and a script
// that compared them as text would exit 0 and do nothing, which for an hourly run means silently never working.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, copyFileSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isMain } from "../scripts/lib/entry.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

// A copy of scripts/ and the profile templates in a temp folder, plus a symlink to that folder.
function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ajs-entry-")));
  cpSync(join(REPO, "scripts"), join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "profile"));
  for (const n of readdirSync(join(REPO, "profile")).filter((f) => f.endsWith(".example.md"))) copyFileSync(join(REPO, "profile", n), join(root, "profile", n));
  const link = join(dirname(root), `${basename(root)}-link`);
  symlinkSync(root, link, "dir");
  return { root, link };
}

test("isMain is true for the same file, a file reached through a symlinked folder or a symlinked file, and false otherwise", () => {
  const { root, link } = project();
  const real = join(root, "scripts", "check-setup.mjs");
  const meta = pathToFileURL(real).href;
  assert.equal(isMain(meta, real), true);
  assert.equal(isMain(meta, join(link, "scripts", "check-setup.mjs")), true, "symlinked folder");
  const fileLink = join(root, "linked-check.mjs");
  symlinkSync(real, fileLink);
  assert.equal(isMain(meta, fileLink), true, "symlinked file");
  assert.equal(isMain(meta, join(root, "scripts", "find-board.mjs")), false, "a different file");
  assert.equal(isMain(meta, join(root, "scripts", "missing.mjs")), false, "a path that doesn't exist");
  assert.equal(isMain(meta, undefined), false);
  assert.equal(isMain(meta, ""), false);
});

// Each command line, run through the symlinked folder with no usable settings, still prints its normal first message.
const missing = (root) => join(root, "no-such-preferences.json");
const CLIS = [
  ["check-setup.mjs", [], /^✗ .*\/setup/m],
  ["job-pull.mjs", ["--no-ai"], /^✗ .*\/setup[\s\S]*Run "node scripts\/check-setup\.mjs"/m],
  ["resume-docx.mjs", [], /^✗ .*\/setup/m],
  ["find-board.mjs", [], /^Usage: node scripts\/find-board\.mjs/m],
  ["install-schedule.mjs", [], /^✗ .*\/setup/m],
];
for (const [file, argv, want] of CLIS) {
  test(`${file} runs when started through a symlinked folder`, () => {
    const { root, link } = project();
    const r = spawnSync(process.execPath, [join(link, "scripts", file), ...argv], { encoding: "utf8", env: { ...process.env, AJS_SETTINGS: missing(root) }, timeout: 20000 });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, want);
  });
}

test("a command line run through a symlinked file still prints its normal output", () => {
  const { root } = project();
  const fileLink = join(root, "board.mjs");
  symlinkSync(join(root, "scripts", "find-board.mjs"), fileLink);
  const r = spawnSync(process.execPath, [fileLink], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^Usage: node scripts\/find-board\.mjs/m);
});
