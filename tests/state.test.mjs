import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withLock, writeAtomic } from "../scripts/lib/state.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "state-"));

test("a second run is skipped while the first holds the lock", async () => {
  const file = join(dir(), "job-pull.lock");
  let inner;
  const outer = await withLock(async () => { inner = await withLock(async () => "second", { file }); return "first"; }, { file });
  assert.deepEqual(outer, { ran: true, value: "first" });
  assert.deepEqual(inner, { ran: false, value: undefined });
});

test("a stale lock from a crashed run is taken over", async () => {
  const file = join(dir(), "job-pull.lock");
  writeFileSync(file, "999999 old");
  const old = new Date(Date.now() - 2 * 3600e3);
  utimesSync(file, old, old);
  assert.equal((await withLock(async () => 1, { file, staleMs: 3600e3 })).ran, true);
});

test("the lock is released when the run throws", async () => {
  const file = join(dir(), "job-pull.lock");
  await assert.rejects(withLock(async () => { throw new Error("boom"); }, { file }));
  assert.equal(existsSync(file), false);
});

test("writeAtomic replaces the file whole and leaves no temp file", () => {
  const d = dir(), f = join(d, "jobs.csv");
  writeFileSync(f, "old");
  writeAtomic(f, "new contents");
  assert.equal(readFileSync(f, "utf8"), "new contents");
  assert.deepEqual(readdirSync(d), ["jobs.csv"]);
});

test("job-pull rewrites jobs.csv and seen-jobs.json only through writeAtomic, under the run lock", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /writeFile\((CSV_FILE|SEEN_FILE),/);
  assert.match(src, /withLock\(main\)/);
});

test("an old lock held by a run that is still going is not taken over", async () => {
  const file = join(dir(), "job-pull.lock");
  writeFileSync(file, `${process.pid} ${new Date().toISOString()}\n`); // this process is alive
  const old = new Date(Date.now() - 2 * 3600e3);
  utimesSync(file, old, old);
  assert.equal((await withLock(async () => 1, { file, staleMs: 3600e3 })).ran, false);
});
