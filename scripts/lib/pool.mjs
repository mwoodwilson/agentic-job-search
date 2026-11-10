// Running work side by side, so a run with one new role takes minutes, not most of an hour.

// Runs fn over items with at most `limit` running at once. Results come back in input order; a job that throws
// leaves its Error in its place instead of stopping the others.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) { out[i] = e instanceof Error ? e : new Error(String(e)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// A one-at-a-time queue: serial()(job) waits for every job queued before it (e.g. Pages exports, Messages sends).
export function serial() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  };
}
