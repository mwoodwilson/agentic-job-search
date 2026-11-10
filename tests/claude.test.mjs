// runClaude: the dollar cap always comes from the settings (a caller's budgetUsd, else claude.maxUsdPerStep), never a literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runClaude, CLAUDE_TIMEOUT_MS } from "../scripts/lib/claude.mjs";
import { DEFAULTS } from "../scripts/lib/settings.mjs";

const ok = JSON.stringify({ subtype: "success", is_error: false, result: "Done.", total_cost_usd: 0.1, session_id: "s1" });
// A stand-in for spawnSync that records the arguments `claude` would get.
const stub = (calls) => (command, args) => { calls.push({ command, args }); return { status: 0, stdout: ok, stderr: "" }; };
const budgetArg = (call) => call.args[call.args.indexOf("--max-budget-usd") + 1];

test("with no budget given, the cap is the per-step default from the settings", () => {
  const calls = [];
  runClaude("step", "prompt", { exec: stub(calls), log: () => {} });
  assert.equal(budgetArg(calls[0]), String(DEFAULTS.claude.maxUsdPerStep));
});

test("the default follows the setting, not a number baked into claude.mjs", () => {
  const was = DEFAULTS.claude.maxUsdPerStep;
  DEFAULTS.claude.maxUsdPerStep = 7.25;
  try {
    const calls = [];
    runClaude("step", "prompt", { exec: stub(calls), log: () => {} });
    assert.equal(budgetArg(calls[0]), "7.25");
  } finally {
    DEFAULTS.claude.maxUsdPerStep = was;
  }
});

test("a budget given by the caller is the cap", () => {
  const calls = [];
  runClaude("step", "prompt", { budgetUsd: 1.5, exec: stub(calls), log: () => {} });
  assert.equal(budgetArg(calls[0]), "1.5");
  runClaude("step", "prompt", { budgetUsd: DEFAULTS.claude.maxUsdScout, exec: stub(calls), log: () => {} });
  assert.equal(budgetArg(calls[1]), String(DEFAULTS.claude.maxUsdScout));
});

test("claude.mjs holds no dollar amount of its own", () => {
  const src = readFileSync(new URL("../scripts/lib/claude.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /budgetUsd\s*=\s*[\d.]+/);
  assert.match(src, /budgetUsd = DEFAULTS\.claude\.maxUsdPerStep/);
});

// ---- a time limit on every Claude step ----
// A hung `claude` would keep the run's lock, and every later hourly run would skip itself without a word.

test("every Claude step has a time limit of 20 minutes, after which the process is killed", () => {
  assert.equal(CLAUDE_TIMEOUT_MS, 20 * 60 * 1000);
  const seen = [];
  runClaude("step", "prompt", { exec: (command, args, options) => { seen.push(options); return { status: 0, stdout: ok, stderr: "" }; }, log: () => {} });
  assert.equal(seen[0].timeout, CLAUDE_TIMEOUT_MS);
  assert.equal(seen[0].killSignal, "SIGKILL");
});

test("a step that runs out of time is a clear failure, not a crash", () => {
  const timedOut = () => ({ error: Object.assign(new Error("spawnSync claude ETIMEDOUT"), { code: "ETIMEDOUT" }), status: null, signal: "SIGKILL", stdout: "", stderr: "" });
  const lines = [];
  const r = runClaude("Tailoring Role | Acme (try 1)…", "prompt", { exec: timedOut, log: (l) => lines.push(l) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "didn't finish within 20 minutes, so it was stopped");
  assert.equal(r.costUsd, 0);
  assert.ok(lines.some((l) => l.includes("didn't finish within 20 minutes")));
});

test("a real process that hangs is killed at the time limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "hung-claude-"));
  const fake = join(dir, "claude");
  writeFileSync(fake, "#!/bin/sh\nsleep 30\n");
  chmodSync(fake, 0o755);
  const started = Date.now();
  const r = runClaude("step", "prompt", { timeoutMs: 300, exec: (command, args, options) => spawnSync(fake, args, options), log: () => {} });
  assert.ok(Date.now() - started < 10000, "it didn't wait for the hung process");
  assert.equal(r.ok, false);
  assert.match(r.error, /didn't finish within 0 seconds|didn't finish within 1 second/);
});

test("a blocked read names its path in the log line, for Grep and Glob too", () => {
  const denied = JSON.stringify({ subtype: "success", is_error: false, result: "", total_cost_usd: 0.01, session_id: "s",
    permission_denials: [{ tool_name: "Read", tool_input: { file_path: "/etc/hosts" } }, { tool_name: "Grep", tool_input: { pattern: "x", path: "/etc" } }] });
  const r = runClaude("step", "prompt", { exec: () => ({ status: 0, stdout: denied, stderr: "" }), log: () => {} });
  assert.deepEqual(r.denials, ["Read /etc/hosts", "Grep /etc"]);
});

// ---- a run that did no work at all ----
// Not signed in, a usage limit, the network down: Claude answers with an error and costs nothing. Such a failure says
// nothing about the role being worked on, so callers mark it "unavailable" and try again next run.

test("a failure that cost nothing (not signed in, usage limit, no network, no claude, timed out) is marked unavailable", () => {
  const json = (o, status = 1) => () => ({ status, stdout: JSON.stringify(o), stderr: "" });
  const quiet = { log: () => {} };
  const notSignedIn = runClaude("s", "p", { ...quiet, exec: json({ subtype: "success", is_error: true, result: "Invalid API key · Please run /login", total_cost_usd: 0 }) });
  assert.deepEqual([notSignedIn.ok, notSignedIn.unavailable], [false, true]);
  const noJson = runClaude("s", "p", { ...quiet, exec: () => ({ status: 1, stdout: "", stderr: "getaddrinfo ENOTFOUND api.anthropic.com" }) });
  assert.deepEqual([noJson.ok, noJson.unavailable], [false, true]);
  const missingCmd = runClaude("s", "p", { ...quiet, exec: () => ({ error: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }), status: null, stdout: "" }) });
  assert.equal(missingCmd.unavailable, true);
  const hung = runClaude("s", "p", { ...quiet, exec: () => ({ error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }), status: null, stdout: "" }) });
  assert.equal(hung.unavailable, true);
});

test("a failure after real work (it cost something), or a success, is not marked unavailable", () => {
  const quiet = { log: () => {} };
  const capped = runClaude("s", "p", { ...quiet, exec: () => ({ status: 1, stdout: JSON.stringify({ subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 3.01 }), stderr: "" }) });
  assert.deepEqual([capped.ok, capped.unavailable], [false, false]);
  const fine = runClaude("s", "p", { ...quiet, exec: () => ({ status: 0, stdout: ok, stderr: "" }) });
  assert.deepEqual([fine.ok, fine.unavailable], [true, false]);
});
