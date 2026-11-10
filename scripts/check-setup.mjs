// Checks that this machine and the settings are ready to run. `npm run check` prints one line per problem.
import { spawnSync } from "node:child_process";
import { SETTINGS_FILE, PROFILE } from "./lib/paths.mjs";
import { loadSettings } from "./lib/settings.mjs";
import { ensureProfileFiles } from "./lib/profile-files.mjs";
import { isMain } from "./lib/entry.mjs";
import { findPages, NO_PAGES } from "./lib/pages.mjs";

export const TESTED_CLAUDE_VERSION = "2.1.317";
const MIN_NODE = 20;
// How long `claude --version` may take before the check gives up on it (a hung claude would hang the check too).
export const VERSION_TIMEOUT_MS = 15000;

// The plain line for a Node older than MIN_NODE, or null.
export function nodeProblem(nodeVersion = process.versions.node) {
  return Number(String(nodeVersion).split(".")[0]) < MIN_NODE
    ? `Node ${nodeVersion} is too old: this needs Node ${MIN_NODE} or newer. Install the current LTS from nodejs.org.`
    : null;
}

// exec, nodeVersion and pagesInstalled are stand-ins for tests.
export function checkSetup({ settingsFile = SETTINGS_FILE, profileFile = PROFILE, exec = spawnSync, nodeVersion = process.versions.node, pagesInstalled = findPages } = {}) {
  const problems = [];
  const warnings = [];

  const old = nodeProblem(nodeVersion);
  if (old) problems.push(old);

  const claude = exec("claude", ["--version"], { encoding: "utf8", timeout: VERSION_TIMEOUT_MS, killSignal: "SIGKILL" });
  if (claude.error?.code === "ENOENT") {
    problems.push("Claude Code isn't installed (the `claude` command wasn't found). Install it and sign in, then run this check again.");
  } else if (claude.error?.code === "ETIMEDOUT") {
    problems.push(`Claude Code didn't answer \`claude --version\` within ${VERSION_TIMEOUT_MS / 1000} seconds. Open Claude Code once to sign in or update it, then run this check again.`);
  } else if (claude.error || claude.status !== 0) {
    problems.push("Claude Code is installed but `claude --version` failed. Open Claude Code once to sign in or update it, then run this check again.");
  } else {
    const version = String(claude.stdout).match(/\d+\.\d+\.\d+/)?.[0];
    if (version !== TESTED_CLAUDE_VERSION) {
      warnings.push(`Claude Code ${version ?? "(version unreadable)"} is installed; this was tested with ${TESTED_CLAUDE_VERSION}. It will probably work, but if a step misbehaves, try ${TESTED_CLAUDE_VERSION}.`);
    }
  }

  // Looked for without asking Pages itself (see lib/pages.mjs), so a missing Pages never opens a dialog.
  if (!pagesInstalled()) warnings.push(NO_PAGES);

  problems.push(...loadSettings({ file: settingsFile, profileFile }).problems);
  return { problems, warnings };
}

if (isMain(import.meta.url)) {
  // A Node that is too old is named first, on its own, before anything else runs (the rest may need a newer Node).
  const old = nodeProblem();
  if (old) {
    console.log(`✗ ${old}`);
    process.exit(1);
  }
  // Make any missing profile file from its blank template first, so there is a file to fill in.
  ensureProfileFiles();
  const { problems, warnings } = checkSetup();
  for (const p of problems) console.log(`✗ ${p}`);
  for (const w of warnings) console.log(`⚠ ${w}`);
  if (problems.length) process.exit(1);
  console.log("✓ Setup is complete.");
}
