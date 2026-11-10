import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logEvent } from "../scripts/lib/log.mjs";

const tmp = () => { const f = join(mkdtempSync(join(tmpdir(), "log-")), "workflow-log.md"); writeFileSync(f, "# Workflow log\n"); return f; };

test("appends one dated line with its kind", () => {
  const file = tmp();
  logEvent("failure", "Ashby marked hybrid roles remote", { file, when: new Date("2026-11-04T15:05:00") });
  assert.match(readFileSync(file, "utf8"), /\n- 2026-11-04 15:05 · failure · Ashby marked hybrid roles remote\n$/);
});

test("rejects an unknown kind", () => {
  assert.throws(() => logEvent("note", "x", { file: tmp() }), /kind/);
});

test("keeps each entry on one line", () => {
  const file = tmp();
  logEvent("run", "line one\nline two", { file, when: new Date("2026-11-04T16:00:00") });
  assert.match(readFileSync(file, "utf8"), /· run · line one line two\n$/);
});

test("makes the log's folder on first use (data/ may not exist yet)", () => {
  const file = join(mkdtempSync(join(tmpdir(), "log-")), "data", "workflow-log.md");
  logEvent("run", "first run", { file, when: new Date("2026-11-04T16:00:00") });
  assert.equal(readFileSync(file, "utf8"), "- 2026-11-04 16:00 · run · first run\n");
});
