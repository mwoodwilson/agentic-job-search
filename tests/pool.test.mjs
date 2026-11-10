// Boards are pulled side by side and up to 3 resumes are written at once, but Pages
// builds and Messages sends still happen one at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapLimit, serial } from "../scripts/lib/pool.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("mapLimit runs at most N jobs at once and keeps results in input order", async () => {
  let running = 0, most = 0;
  const out = await mapLimit([30, 10, 20, 5, 15], 3, async (ms, i) => { running++; most = Math.max(most, running); await wait(ms); running--; return i; });
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
  assert.equal(most, 3);
});

test("mapLimit: one job that throws doesn't stop the others; its error is returned in its place", async () => {
  const out = await mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error("boom"); return x; });
  assert.equal(out[0], 1);
  assert.ok(out[1] instanceof Error);
  assert.equal(out[2], 3);
});

test("serial runs jobs one at a time, in the order they were queued", async () => {
  const one = serial();
  const log = [];
  await Promise.all([
    one(async () => { log.push("a start"); await wait(20); log.push("a end"); }),
    one(async () => { log.push("b start"); await wait(5); log.push("b end"); }),
  ]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end"]);
});

test("serial keeps going after a job throws", async () => {
  const one = serial();
  await assert.rejects(one(async () => { throw new Error("x"); }));
  assert.equal(await one(async () => 7), 7);
});
