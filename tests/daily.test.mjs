// The competencies files are updated once a day (each update is a paid Claude step), after the resumes are sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { competenciesPlan, localDay } from "../scripts/lib/daily.mjs";

test("families whose archive grew are updated on the first run of the day", () => {
  assert.deepEqual(competenciesPlan({ last: "2026-11-09", pending: [] }, "2026-11-10", ["Product Manager"]).files, ["Product Manager"]);
});

test("later runs that day only add to the waiting list", () => {
  const p = competenciesPlan({ last: "2026-11-10", pending: ["Product Manager"] }, "2026-11-10", ["Data Analyst", "Product Manager"]);
  assert.deepEqual(p.files, []);
  assert.deepEqual(p.pending, ["Product Manager", "Data Analyst"]);
});

test("the next day's first run updates everything that waited", () => {
  assert.deepEqual(competenciesPlan({ last: "2026-11-10", pending: ["Product Manager", "Data Analyst"] }, "2026-11-11", []).files, ["Product Manager", "Data Analyst"]);
});

test("nothing waiting, nothing grew: no update, even on a new day", () => {
  assert.deepEqual(competenciesPlan({ last: "2026-11-09", pending: [] }, "2026-11-10", []).files, []);
});

test("a missing or unreadable state file counts as never updated", () => {
  assert.deepEqual(competenciesPlan(null, "2026-11-10", ["Product Manager"]).files, ["Product Manager"]);
});

test("the day is the local day, not UTC (a 9 PM Eastern run is still the same day)", () => {
  assert.equal(localDay(new Date("2026-11-11T02:00:00Z"), "America/New_York"), "2026-11-10");
});
