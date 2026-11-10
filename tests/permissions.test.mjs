import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/lib/paths.mjs";
import { runClaude, READ, DENY } from "../scripts/lib/claude.mjs";

const src = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");

test("every Claude step writes only to named files, through full-path editRule() — never a bare or relative rule", () => {
  const all = src("job-pull.mjs") + src("lib/tailor-loop.mjs") + src("lib/agents.mjs");
  const literal = [...all.matchAll(/["`]((?:Edit|Write|Bash|NotebookEdit)(?:\([^)]*\))?)["`]/g)].map((m) => m[1]);
  assert.deepEqual(literal, [], "write/shell rules must come from editRule()");
  const targets = [...all.matchAll(/editRule\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(targets.length >= 6, `found ${targets.length}`);
  for (const x of targets) assert.match(x, /^("outputs\/tailored-resumes\.md"|"archives\/competencies-\*\.md"|"inbox\.md"|"data\/inbox-import\.json"|checkPath|draft|proposal)$/, `unexpected write target: ${x}`);
  assert.doesNotMatch(src("lib/agents.mjs"), /"Bash"/);
});

// Bare "Read", "Grep" or "Glob" would let a step read anywhere, such as ~/.ssh or ~/.aws, and the repair agent and the
// scout read untrusted web pages. Reads are allowed inside the project only, as one full-path rule (Claude Code checks
// Grep and Glob against Read rules); in dontAsk mode a read anywhere else is denied.
test("the read-only default is the Skill tool and reads inside the project folder only, as a full-path rule", () => {
  assert.deepEqual(READ, ["Skill", `Read(/${join(ROOT, "**")})`]);
  assert.ok(READ[1].startsWith("Read(//"), "anchored at the filesystem root, like editRule");
  const calls = [];
  runClaude("step", "prompt", { exec: (command, args) => { calls.push(args); return { status: 0, stdout: "{}", stderr: "" }; }, log: () => {} });
  const allowed = calls[0].slice(calls[0].indexOf("--allowedTools") + 1);
  assert.deepEqual(allowed, READ, "the default for a step is READ");
});

test("no Claude run anywhere is given a bare Read, Grep or Glob, or any shell, web or write tool beyond its own", () => {
  const code = (text) => text.replace(/^\s*\/\/.*$/gm, ""); // comments may name the tools
  const all = code(["job-pull.mjs", "lib/tailor-loop.mjs", "lib/agents.mjs", "lib/claude.mjs"].map(src).join("\n") + readFileSync(new URL("../evals/run-checker.mjs", import.meta.url), "utf8"));
  assert.doesNotMatch(all, /["'](Read|Grep|Glob)["']/, "reads come from READ");
  assert.doesNotMatch(src("job-pull.mjs"), /const READ = /, "job-pull uses the shared READ");
  assert.match(src("job-pull.mjs"), /allowedTools: \[\.\.\.READ, \.\.\.writes\]/);
});

// Claude Code runs "read-only" commands such as cat, grep and find without asking, in any folder, so a step with a
// shell could still read your files outside the project. No step needs one.
test("the shell is turned off for every step, and only project settings are loaded (not settings.local.json)", () => {
  assert.deepEqual(DENY, ["Bash"]);
  const calls = [];
  runClaude("step", "prompt", { exec: (command, args) => { calls.push(args); return { status: 0, stdout: "{}", stderr: "" }; }, log: () => {} });
  const args = calls[0];
  const denied = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--allowedTools"));
  assert.deepEqual(denied, ["Bash", "WebFetch", "WebSearch"]);
  assert.equal(args[args.indexOf("--setting-sources") + 1], "project", "your \"don't ask again\" rules in .claude/settings.local.json don't widen a step");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
});

test("a caller's own deny rules join the same list as the shell", () => {
  const calls = [];
  runClaude("step", "prompt", { deny: ["Read(//x/**)"], exec: (command, args) => { calls.push(args); return { status: 0, stdout: "{}", stderr: "" }; }, log: () => {} });
  const args = calls[0];
  assert.equal(args.filter((a) => a === "--disallowedTools").length, 1);
  assert.deepEqual(args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--allowedTools")), ["Bash", "WebFetch", "WebSearch", "Read(//x/**)"]);
});

// Claude Code lets any step open its built-in list of documentation sites without asking, so a step that isn't
// given a web tool has it turned off: only the repair agent (WebFetch) and the scout (WebSearch, WebFetch) reach the web.
test("a step that isn't given a web tool has it turned off; the agents keep the ones they're given", () => {
  const deniedFor = (allowedTools) => {
    const calls = [];
    runClaude("step", "prompt", { allowedTools, exec: (command, args) => { calls.push(args); return { status: 0, stdout: "{}", stderr: "" }; }, log: () => {} });
    const args = calls[0];
    return args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--allowedTools"));
  };
  assert.deepEqual(deniedFor([...READ, "Edit(//x/out.md)"]), ["Bash", "WebFetch", "WebSearch"]);
  assert.deepEqual(deniedFor([...READ, "WebFetch", "Edit(//x/p.md)"]), ["Bash", "WebSearch"], "the repair agent");
  assert.deepEqual(deniedFor([...READ, "WebSearch", "WebFetch", "Edit(//x/p.md)"]), ["Bash"], "the scout");
});
