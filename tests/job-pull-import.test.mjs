import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../scripts/lib/paths.mjs";

// Importing job-pull.mjs must not start a live run (pulls, Claude calls, texts).
test("job-pull.mjs can be imported without running and uses the shared paths", async () => {
  const m = await import("../scripts/job-pull.mjs");
  assert.equal(typeof m.passesFilters, "function");
  assert.equal(m.CSV_FILE, P.CSV_FILE);
  assert.equal(m.TAILORED_FILE, P.TAILORED_FILE);
});
