// One headless Claude run, checked. Each run:
// - loads only project settings and skills (not your personal plugins and hooks, and not .claude/settings.local.json,
//   where an interactive "don't ask again" would otherwise widen what a step may do),
// - can read only inside this project folder (READ), has no shell (DENY), has web tools only when it's given them
//   (WEB_TOOLS), and can write only the files it's given (editRule(): full-path Edit rules); it never asks for
//   permission (dontAsk), so anything else is denied,
// - is capped by a dollar budget: the caller's budgetUsd (job-pull passes claude.maxUsdPerStep or claude.maxUsdScout from the
//   settings), else the settings default (Claude Code 2.1.317 has no turn limit),
// - is stopped after CLAUDE_TIMEOUT_MS: a hung claude would otherwise keep the run's lock, and every later hourly run
//   would skip itself,
// - returns JSON, so a run that "finished" with an error is caught even when the exit code is 0.
// A failed run that did no work at all (cost nothing: not signed in, a usage limit, no network, no `claude`, or
// stopped at the time limit) is marked unavailable: it says nothing about the task, so callers try again next run.
// runClaude blocks until the run ends; runClaudeAsync doesn't, so several resumes can be written at once.
import { spawnSync, spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./paths.mjs";
import { DEFAULTS } from "./settings.mjs";

// A write permission for one file (or glob) in the project, anchored to its full path ("//" = absolute).
// Relative rules break when a session runs `cd` (seen 2026-11-04: every edit denied after a `cd` into a subfolder).
// Edit rules also cover the Write tool; Write(...) rules are ignored by Claude Code.
export const editRule = (rel) => `Edit(/${join(ROOT, rel)})`;

// Every step's read access: the Skill tool, and reads inside this project folder only, as one full-path rule like
// editRule's. Claude Code checks Grep and Glob against Read rules, so this covers them too. A bare "Read", "Grep" or
// "Glob" would allow reading anywhere (your ~/.ssh or ~/.aws), and the repair agent and scout read untrusted web
// pages; in dontAsk mode a read outside the project needs approval, so it is denied.
export const READ = ["Skill", `Read(/${join(ROOT, "**")})`];
// Turned off for every step: the shell. Claude Code runs "read-only" commands such as cat, grep and find without
// asking, in any folder, so a step with a shell could still read files outside the project. No step needs one.
export const DENY = ["Bash"];
// Turned off for every step that isn't given them: Claude Code lets any step open its built-in list of documentation
// sites without asking. Only the repair agent and the scout are given web tools.
export const WEB_TOOLS = ["WebFetch", "WebSearch"];

// The longest one Claude step may run before it is killed.
export const CLAUDE_TIMEOUT_MS = 20 * 60 * 1000;
const span = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} second${Math.round(ms / 1000) === 1 ? "" : "s"}`);

const argsFor = (prompt, allowedTools, deny, budgetUsd) => [
  "-p", prompt,
  "--output-format", "json",
  "--permission-mode", "dontAsk",
  "--setting-sources", "project",
  "--max-budget-usd", String(budgetUsd),
  "--disallowedTools", ...DENY, ...WEB_TOOLS.filter((t) => !allowedTools.includes(t)), ...deny,
  "--allowedTools", ...allowedTools,
];

// The run's JSON output → { ok, unavailable, result, costUsd, sessionId, denials, error }, with its log lines.
function parseRun(step, { status, stdout, stderr, missing, timedOut, timeoutMs }, log) {
  const fail = (error) => { log(`✗ ${step}: ${error}`); return { ok: false, unavailable: true, error, result: "", costUsd: 0, sessionId: "", denials: [] }; };
  if (missing) return fail("couldn't find the `claude` command");
  if (timedOut) return fail(`didn't finish within ${span(timeoutMs)}, so it was stopped`);
  let j;
  try {
    j = JSON.parse(stdout);
  } catch {
    return fail(`no JSON result (exit ${status}): ${String(stderr || stdout || "").trim().slice(0, 200)}`);
  }
  const out = {
    ok: status === 0 && !j.is_error && j.subtype === "success",
    result: j.result || "",
    costUsd: j.total_cost_usd || 0,
    sessionId: j.session_id || "",
    denials: (j.permission_denials || []).map((d) => `${d.tool_name} ${d.tool_input?.file_path || d.tool_input?.path || d.tool_input?.command || ""}`.trim()),
    error: "",
  };
  out.unavailable = !out.ok && out.costUsd === 0;
  if (!out.ok) out.error = `${j.subtype || "error"} (exit ${status})`;
  if (out.result) log(out.result);
  log(`${out.ok ? "✓" : "✗"} ${step} · $${out.costUsd.toFixed(2)} · session ${out.sessionId}${out.denials.length ? ` · denied: ${out.denials.join("; ")}` : ""}${out.error ? ` · ${out.error}` : ""}`);
  return out;
}

// deny: more deny rules for this run (the evals deny your own folders), added to DENY and the web tools not given.
export function runClaude(step, prompt, { allowedTools = READ, deny = [], budgetUsd = DEFAULTS.claude.maxUsdPerStep, timeoutMs = CLAUDE_TIMEOUT_MS, exec = spawnSync, log = console.log } = {}) {
  log(`\n▶ ${step}`);
  const r = exec("claude", argsFor(prompt, allowedTools, deny, budgetUsd), { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" });
  return parseRun(step, { status: r.status, stdout: r.stdout, stderr: r.stderr, missing: r.error?.code === "ENOENT", timedOut: r.error?.code === "ETIMEDOUT", timeoutMs }, log);
}

// The same run without blocking the script, with the same caps, time limit and checks.
export function runClaudeAsync(step, prompt, { allowedTools = READ, deny = [], budgetUsd = DEFAULTS.claude.maxUsdPerStep, timeoutMs = CLAUDE_TIMEOUT_MS, spawn = nodeSpawn, log = console.log } = {}) {
  log(`\n▶ ${step}`);
  return new Promise((resolve) => {
    const out = [], err = [];
    let done = false, timedOut = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(parseRun(step, { ...r, timeoutMs }, log)); } };
    const child = spawn("claude", argsFor(prompt, allowedTools, deny, budgetUsd), { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { timedOut = true; child.kill?.("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => finish({ status: null, stdout: "", stderr: e.message, missing: e.code === "ENOENT" }));
    child.on("close", (status) => finish({ status, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), timedOut }));
  });
}
