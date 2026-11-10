import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { snapshotRun, SNAPSHOT_PATHS } from "../scripts/lib/snapshot.mjs";

// A project folder like a user's: data/ and outputs/ are git-ignored, with a lock, a temp file and resume binaries.
function project() {
  const d = mkdtempSync(join(tmpdir(), "snap-"));
  const put = (rel, text) => { mkdirSync(join(d, rel, ".."), { recursive: true }); writeFileSync(join(d, rel), text); };
  put(".gitignore", "data/\noutputs/\n");
  put("data/jobs.csv", "a\n");
  put("data/job-pull.lock", "123\n");
  put("data/jobs.csv.4242.tmp", "half\n");
  put("outputs/tailored-resumes.md", "# Resumes\n");
  put("outputs/resumes/x.pdf", "%PDF");
  put("outputs/resumes/x.docx", "PK");
  put("outputs/resumes/x.pages/Index.zip", "PK");
  return d;
}
const tracked = (d) => execFileSync("git", [`--git-dir=${join(d, ".history")}`, "ls-files"], { cwd: d, encoding: "utf8" }).split("\n").filter(Boolean);

test("the snapshot covers the user's data folders", () => {
  assert.deepEqual(SNAPSHOT_PATHS, ["data", "archives", "outputs", "profile", "config/preferences.json", "inbox.md"]);
});

test("a run is saved to .history with the git-ignored data, but not the lock, temp files or resume binaries", () => {
  const d = project();
  assert.equal(snapshotRun("run 1", { cwd: d }), true);
  const files = tracked(d);
  assert.ok(files.includes("data/jobs.csv"), files.join(", "));
  assert.ok(files.includes("outputs/tailored-resumes.md"), files.join(", "));
  for (const f of files) assert.doesNotMatch(f, /job-pull\.lock|\.tmp$|\.pdf$|\.docx$|\.pages(\/|$)/, f);
  assert.equal(snapshotRun("run 2", { cwd: d }), false, "nothing changed");
  assert.equal(existsSync(join(d, ".git")), false, "the project's own git folder is never made or touched");
});

test("a run with changes is committed with its summary; a deleted file is recorded", () => {
  const d = project();
  writeFileSync(join(d, "inbox.md"), "# Inbox\n");
  snapshotRun("run 1", { cwd: d });
  writeFileSync(join(d, "data", "jobs.csv"), "a\nb\n");
  rmSync(join(d, "inbox.md"));
  assert.equal(snapshotRun("run 2026-11-04 13:00: 2 new roles", { cwd: d }), true);
  const log = execFileSync("git", [`--git-dir=${join(d, ".history")}`, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  assert.equal(log, "run 2026-11-04 13:00: 2 new roles");
  assert.equal(tracked(d).includes("inbox.md"), false);
});

test("job-pull logs a run summary and snapshots after normal and backlog runs", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.ok((src.match(/finishRun\(/g) || []).length >= 3, "defined once, called after backlog and normal runs");
  assert.match(src, /snapshotRun\(/);
  assert.match(src, /logEvent\("run"/);
});

test("the run summary counts resumes actually sent, and calls out any built but not sent", async () => {
  const { runSummary } = await import("../scripts/job-pull.mjs");
  assert.equal(runSummary({ added: 2, built: 1, sent: 1 }), "2 new roles, 1 resume sent");
  assert.equal(runSummary({ added: 0, built: 2, sent: 0, held: 1 }), "0 new roles, 2 resumes built but not sent, 1 held for review");
});
