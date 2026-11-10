#!/usr/bin/env node
// Turns the hourly job on or off to match schedule.hourly in config/preferences.json (macOS launchd).
//   node scripts/install-schedule.mjs
// On: writes ~/Library/LaunchAgents/com.agentic-job-search.pull.plist and loads it; if it is already on but its paths
// are out of date (the folder moved, or node or claude changed), it reloads it from a fresh plist. Off: unloads it and
// deletes the plist. It prints what it did. To change the schedule later, edit schedule.hourly and run this again.
// The job runs the pull through osascript (not node directly) so macOS asks for the Messages, Mail, Numbers and
// Pages permissions on behalf of a normal app. The pull's output goes to data/job-pull.log.
// installSchedule() and runCli() take the plist path and the launchctl runner as arguments, so tests use a temp
// folder and a stub and never touch your real LaunchAgents folder.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";
import { ROOT, RUN_LOG } from "./lib/paths.mjs";
import { loadSettings } from "./lib/settings.mjs";
import { isMain } from "./lib/entry.mjs";

export const LABEL = "com.agentic-job-search.pull";

// ---------- the plist ----------

// The same text three times over: quoted for the shell, then escaped for the AppleScript string that holds the
// shell command, then escaped for the XML of the plist.
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const shq = (s) => (SHELL_SAFE.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
const appleScriptText = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The property list for the hourly job: at minute 0 of every hour, run the pull from repoDir with pathDirs on PATH
// (launchd starts jobs with almost no PATH) and print its output to logFile.
export function plistFor({ repoDir, pathDirs, logFile }) {
  const command = `export PATH=${shq(pathDirs.join(":"))}; cd ${shq(repoDir)} && node scripts/job-pull.mjs >> ${shq(logFile)} 2>&1`;
  const script = `do shell script "${appleScriptText(command)}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-e</string>
    <string>${xml(script)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
`;
}

// The folders the job needs on PATH: node's, claude's (when found), the usual Homebrew places, then the system's.
export function pathDirsFor({ nodePath, claudePath }) {
  const dirs = [dirname(nodePath), claudePath ? dirname(claudePath) : null, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set(dirs.filter(Boolean))];
}

export const defaultPlistPath = (home = homedir()) => join(home, "Library", "LaunchAgents", `${LABEL}.plist`);

// ---------- what to do ----------

export function scheduleAction(hourly, installed) {
  if (hourly && !installed) return "install";
  if (!hourly && installed) return "remove";
  return "none";
}

// Runs a command: { status, stderr }. The real runner for launchctl; tests give a stub.
function defaultRun(command, argv) {
  const r = spawnSync(command, argv, { encoding: "utf8" });
  return { status: r.status ?? 1, stderr: String(r.stderr || "").trim() || r.error?.message || "" };
}

const shown = (repoDir, file) => {
  const rel = relative(repoDir, file);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : file;
};

// Writes the plist and loads it. If launchctl won't load it, the plist is deleted again, because a plist that isn't
// loaded would make the next try think the job is already on. Returns true when the job is loaded.
function loadJob({ plistPath, run, uid, repoDir, pathDirs, logFile, log }) {
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true }); // the job's output goes here, and the shell won't make the folder
  writeFileSync(plistPath, plistFor({ repoDir, pathDirs, logFile }));
  const r = run("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  if (r.status === 0) return true;
  rmSync(plistPath, { force: true });
  log(`✗ macOS wouldn't load the hourly job${r.stderr ? `: ${r.stderr}` : ` (launchctl exit ${r.status})`}`);
  return false;
}

// Makes the hourly job match `hourly`. Returns { action, ok }; action is "install", "remove", "refresh" or "none".
// With the job on and already installed, the installed plist is compared with the one that would be written now
// (this folder, this node and claude): if they differ (the folder moved, or node or claude changed) the job would
// fail every hour with nothing to say so, so it is unloaded and loaded again from a fresh plist.
// plistPath and run (launchctl) have no defaults here on purpose: whatever calls this says where the plist goes
// and what runs launchctl. pathDirs is needed whenever hourly is true.
export function installSchedule({ hourly, plistPath, run, uid, repoDir, pathDirs, logFile, log = console.log }) {
  const installed = existsSync(plistPath);
  let action = scheduleAction(hourly, installed);
  const job = { plistPath, run, uid, repoDir, pathDirs, logFile, log };

  if (action === "install") {
    if (!loadJob(job)) return { action, ok: false };
    log(`✓ The hourly job is on. It runs at the start of every hour while this Mac is on and you're logged in, and writes to ${shown(repoDir, logFile)}.`);
    return { action, ok: true };
  }

  if (action === "remove") {
    const r = run("launchctl", ["bootout", `gui/${uid}/${LABEL}`]);
    rmSync(plistPath, { force: true });
    log("✓ The hourly job is off.");
    if (r.status !== 0) log(`  (launchctl said: ${r.stderr || `exit ${r.status}`}. The job may not have been loaded; it won't be started again.)`);
    return { action, ok: true };
  }

  if (hourly && installed) {
    let current = null;
    try { current = readFileSync(plistPath, "utf8"); } catch {}
    if (current !== plistFor({ repoDir, pathDirs, logFile })) {
      action = "refresh";
      run("launchctl", ["bootout", `gui/${uid}/${LABEL}`]); // not loaded is fine: it is loaded again just below
      if (!loadJob(job)) return { action, ok: false };
      log(`✓ The hourly job was refreshed because its paths changed (the project folder, node or claude). It still runs at the start of every hour and writes to ${shown(repoDir, logFile)}.`);
      return { action, ok: true };
    }
  }

  log(hourly
    ? "The hourly job is already on. Nothing to change."
    : "The hourly job is already off. To turn it on, set schedule.hourly to true in config/preferences.json and run this again.");
  return { action, ok: true };
}

// The command: reads the settings result ({ settings, problems }) and follows schedule.hourly. Returns the exit code.
export function runCli({ loaded, plistPath = defaultPlistPath(), run = defaultRun, uid = process.getuid?.(), repoDir = ROOT, logFile = RUN_LOG, pathDirs, log = console.log }) {
  if (!loaded.settings) {
    for (const p of loaded.problems) log(`✗ ${p}`);
    return 1;
  }
  const hourly = loaded.settings.schedule?.hourly === true;
  const installing = scheduleAction(hourly, existsSync(plistPath)) === "install";
  if (installing && loaded.problems.length) {
    for (const p of loaded.problems) log(`✗ ${p}`);
    log('The hourly job would stop at the start of every run until these are fixed. Run "node scripts/check-setup.mjs", fix what it lists, then run this again.');
    return 1;
  }
  // The job's PATH is needed whenever it is on: a fresh install, or the check that an installed one is still current.
  const dirs = hourly ? (pathDirs ?? pathDirsFor({ nodePath: process.execPath, claudePath: whichClaude() })) : [];
  return installSchedule({ hourly, plistPath, run, uid, repoDir, pathDirs: dirs, logFile, log }).ok ? 0 : 1;
}

function whichClaude() {
  const r = spawnSync("which", ["claude"], { encoding: "utf8" });
  const found = r.status === 0 ? String(r.stdout).trim() : "";
  if (!found) console.log("⚠ The `claude` command wasn't found, so the hourly job may not be able to run Claude. Run \"node scripts/check-setup.mjs\".");
  return found || null;
}

if (isMain(import.meta.url)) {
  process.exitCode = runCli({ loaded: loadSettings() });
}
