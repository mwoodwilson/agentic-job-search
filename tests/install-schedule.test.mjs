// The schedule installer. Nothing here touches ~/Library/LaunchAgents or runs launchctl: the plist path is a
// temp folder, and the runner that would call launchctl is a stub that records what it was asked to run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LABEL, plistFor, scheduleAction, pathDirsFor, defaultPlistPath, installSchedule, runCli } from "../scripts/install-schedule.mjs";
import { filledSettings } from "./helpers.mjs";

const args = { repoDir: "/Users/jordan/agentic-job-search", pathDirs: ["/opt/homebrew/bin", "/usr/bin", "/bin"], logFile: "/Users/jordan/agentic-job-search/data/job-pull.log" };
const tmp = () => mkdtempSync(join(tmpdir(), "ajs-schedule-"));

// A stand-in for launchctl: records each call and answers with the given status.
function stubRunner(status = 0, stderr = "") {
  const calls = [];
  const run = (command, argv) => { calls.push([command, ...argv]); return { status, stderr }; };
  return { run, calls };
}

test("the job is named com.agentic-job-search.pull", () => {
  assert.equal(LABEL, "com.agentic-job-search.pull");
});

// ---------- the plist ----------

test("plistFor runs the pull through osascript at minute 0 of every hour", () => {
  const xml = plistFor(args);
  assert.match(xml, /<string>com\.agentic-job-search\.pull<\/string>/);
  assert.ok(xml.includes("<key>Minute</key><integer>0</integer>"));
  assert.ok(!xml.includes("<key>Hour</key>"), "no Hour key: every hour");
  assert.ok(xml.includes("<string>/usr/bin/osascript</string>"));
  assert.ok(xml.includes(`cd ${args.repoDir} &amp;&amp; node scripts/job-pull.mjs &gt;&gt; ${args.logFile} 2&gt;&amp;1`));
  assert.ok(xml.includes("export PATH=/opt/homebrew/bin:/usr/bin:/bin;"));
  assert.ok(xml.includes('do shell script "export PATH='));
  assert.doesNotMatch(xml, /&&/, "every & is escaped");
});

test("plistFor quotes a folder with spaces or an ampersand for the shell, then escapes it for AppleScript and XML", () => {
  const xml = plistFor({ ...args, repoDir: "/Users/jo/job & search", logFile: "/Users/jo/job & search/data/job-pull.log" });
  assert.ok(xml.includes("cd '/Users/jo/job &amp; search' &amp;&amp; node scripts/job-pull.mjs"));
  assert.ok(xml.includes("&gt;&gt; '/Users/jo/job &amp; search/data/job-pull.log' 2&gt;&amp;1"));
  // A double quote must not end the AppleScript string early; a single quote is closed, escaped and reopened for the shell.
  const odd = plistFor({ ...args, repoDir: `/tmp/we"ird/it's` });
  assert.ok(odd.includes(String.raw`'/tmp/we\"ird/it'\\''s'`), odd.match(/cd [^&]*/)?.[0]);
});

test("plistFor writes a property list macOS accepts", { skip: spawnSync("plutil", ["-help"]).error ? "plutil is not available" : false }, () => {
  for (const repoDir of [args.repoDir, `/tmp/we"ird/it's & more`]) {
    const file = join(tmp(), "check.plist");
    writeFileSync(file, plistFor({ ...args, repoDir }));
    const r = spawnSync("plutil", ["-lint", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
});

test("pathDirsFor puts node's and claude's folders first, then the usual places, each once", () => {
  assert.deepEqual(pathDirsFor({ nodePath: "/opt/homebrew/bin/node", claudePath: "/Users/jo/.local/bin/claude" }),
    ["/opt/homebrew/bin", "/Users/jo/.local/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
  assert.deepEqual(pathDirsFor({ nodePath: "/usr/local/bin/node", claudePath: null }),
    ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
});

test("the installed plist lives in ~/Library/LaunchAgents under its label", () => {
  assert.equal(defaultPlistPath("/Users/jo"), "/Users/jo/Library/LaunchAgents/com.agentic-job-search.pull.plist");
});

// ---------- what to do ----------

test("scheduleAction installs when on and missing, removes when off and installed, otherwise does nothing", () => {
  assert.equal(scheduleAction(true, false), "install");
  assert.equal(scheduleAction(false, true), "remove");
  assert.equal(scheduleAction(true, true), "none");
  assert.equal(scheduleAction(false, false), "none");
});

// ---------- installSchedule, with a temp plist and a stub launchctl ----------

// Everything under one temp folder: the plist, the project folder and its log.
const setup = (status = 0, stderr = "") => {
  const dir = tmp();
  const repoDir = join(dir, "repo");
  const job = { repoDir, pathDirs: args.pathDirs, logFile: join(repoDir, "data", "job-pull.log") };
  return { dir, job, plistPath: join(dir, "LaunchAgents", `${LABEL}.plist`), ...stubRunner(status, stderr), logLines: [] };
};
const go = (t, hourly) => installSchedule({ hourly, plistPath: t.plistPath, run: t.run, uid: 501, log: (l) => t.logLines.push(l), ...t.job });
const oldPlist = (t) => { mkdirSync(join(t.dir, "LaunchAgents")); writeFileSync(t.plistPath, "old"); };

test("turning the hourly job on writes the plist and loads it with launchctl bootstrap", () => {
  const t = setup();
  const r = go(t, true);
  assert.equal(r.action, "install");
  assert.equal(r.ok, true);
  assert.equal(readFileSync(t.plistPath, "utf8"), plistFor(t.job));
  assert.ok(existsSync(join(t.job.repoDir, "data")), "the log's folder exists, so the job can write its output");
  assert.deepEqual(t.calls, [["launchctl", "bootstrap", "gui/501", t.plistPath]]);
  assert.match(t.logLines.join("\n"), /hourly job is on/i);
  assert.match(t.logLines.join("\n"), /data\/job-pull\.log/);
});

test("turning it off unloads the job with launchctl bootout and deletes the plist", () => {
  const t = setup();
  oldPlist(t);
  const r = go(t, false);
  assert.equal(r.action, "remove");
  assert.equal(r.ok, true);
  assert.equal(existsSync(t.plistPath), false);
  assert.deepEqual(t.calls, [["launchctl", "bootout", `gui/501/${LABEL}`]]);
  assert.match(t.logLines.join("\n"), /hourly job is off/i);
});

const installedPlist = (t, text = plistFor(t.job)) => { mkdirSync(join(t.dir, "LaunchAgents")); writeFileSync(t.plistPath, text); };

test("when the job is on and its plist is exactly what would be written now, nothing is written and launchctl isn't run", () => {
  const on = setup();
  installedPlist(on);
  assert.equal(go(on, true).action, "none");
  assert.equal(readFileSync(on.plistPath, "utf8"), plistFor(on.job));
  assert.deepEqual(on.calls, []);
  assert.match(on.logLines.join("\n"), /already on/i);
});

test("when the job is off and not installed, nothing is written and launchctl isn't run", () => {
  const off = setup();
  assert.equal(go(off, false).action, "none");
  assert.equal(existsSync(off.plistPath), false);
  assert.deepEqual(off.calls, []);
  assert.match(off.logLines.join("\n"), /already off/i);
});

test("a stale plist (the folder moved, or node or claude changed) is refreshed: bootout, rewrite, bootstrap, in that order", () => {
  const t = setup();
  const oldJob = { ...t.job, repoDir: "/Users/jo/old-place/agentic-job-search", logFile: "/Users/jo/old-place/agentic-job-search/data/job-pull.log" };
  installedPlist(t, plistFor(oldJob));
  const seen = []; // what the plist file held at the moment each launchctl call ran
  const run = (command, argv) => { seen.push([argv[0], readFileSync(t.plistPath, "utf8")]); return { status: 0, stderr: "" }; };
  const r = installSchedule({ hourly: true, plistPath: t.plistPath, run, uid: 501, log: (l) => t.logLines.push(l), ...t.job });
  assert.equal(r.action, "refresh");
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [["bootout", plistFor(oldJob)], ["bootstrap", plistFor(t.job)]], "unload the old job, then load the new plist");
  assert.equal(readFileSync(t.plistPath, "utf8"), plistFor(t.job));
  assert.match(t.logLines.join("\n"), /refreshed/i);
  assert.match(t.logLines.join("\n"), /paths changed/i);
  assert.doesNotMatch(t.logLines.join("\n"), /already on/i);
});

test("a changed PATH counts as stale too", () => {
  const t = setup();
  installedPlist(t, plistFor({ ...t.job, pathDirs: ["/usr/bin", "/bin"] }));
  const r = go(t, true);
  assert.equal(r.action, "refresh");
  assert.deepEqual(t.calls.map((c) => c[1]), ["bootout", "bootstrap"]);
});

test("the refresh uses the same launchctl forms as install and remove", () => {
  const t = setup();
  installedPlist(t, "old");
  go(t, true);
  assert.deepEqual(t.calls, [["launchctl", "bootout", `gui/501/${LABEL}`], ["launchctl", "bootstrap", "gui/501", t.plistPath]]);
});

test("if the refreshed job can't be loaded, the plist is removed and the reason is shown", () => {
  const t = setup();
  installedPlist(t, "old");
  const calls = [];
  const run = (command, argv) => { calls.push(argv[0]); return argv[0] === "bootstrap" ? { status: 5, stderr: "Bootstrap failed: 5" } : { status: 0, stderr: "" }; };
  const r = installSchedule({ hourly: true, plistPath: t.plistPath, run, uid: 501, log: (l) => t.logLines.push(l), ...t.job });
  assert.equal(r.ok, false);
  assert.deepEqual(calls, ["bootout", "bootstrap"]);
  assert.equal(existsSync(t.plistPath), false, "the next run installs it fresh");
  assert.match(t.logLines.join("\n"), /Bootstrap failed/);
});

test("if the old job wasn't loaded, the refresh still writes and loads the new one", () => {
  const t = setup();
  installedPlist(t, "old");
  const calls = [];
  const run = (command, argv) => { calls.push(argv[0]); return argv[0] === "bootout" ? { status: 3, stderr: "No such process" } : { status: 0, stderr: "" }; };
  const r = installSchedule({ hourly: true, plistPath: t.plistPath, run, uid: 501, log: () => {}, ...t.job });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["bootout", "bootstrap"]);
  assert.equal(readFileSync(t.plistPath, "utf8"), plistFor(t.job));
});

test("if launchctl can't load the job, the plist is removed again and the reason is shown", () => {
  const t = setup(5, "Bootstrap failed: 5: Input/output error");
  const r = go(t, true);
  assert.equal(r.ok, false);
  assert.equal(existsSync(t.plistPath), false, "a plist that isn't loaded would block the next try");
  assert.match(t.logLines.join("\n"), /Bootstrap failed/);
});

test("if the job wasn't loaded when turning it off, the plist is still deleted", () => {
  const t = setup(3, "Boot-out failed: 3: No such process");
  oldPlist(t);
  const r = go(t, false);
  assert.equal(r.action, "remove");
  assert.equal(r.ok, true);
  assert.equal(existsSync(t.plistPath), false);
  assert.match(t.logLines.join("\n"), /No such process/);
});

// ---------- the command, from the settings ----------

const loadedOk = (hourly) => ({ settings: { ...filledSettings(), schedule: { hourly, scout: { enabled: false, day: "Monday", hour: 9 } } }, problems: [] });
const cli = (loaded, { before } = {}) => {
  const t = setup();
  before?.(t);
  const lines = [];
  const code = runCli({ loaded, plistPath: t.plistPath, run: t.run, uid: 501, log: (l) => lines.push(l), ...t.job });
  return { code, lines: lines.join("\n"), ...t };
};

test("the command follows schedule.hourly from the settings", () => {
  const on = cli(loadedOk(true));
  assert.equal(on.code, 0);
  assert.ok(existsSync(on.plistPath));
  assert.equal(on.calls.length, 1);
  const off = cli(loadedOk(false));
  assert.equal(off.code, 0);
  assert.deepEqual(off.calls, []);
});

test("the command fails with exit 1 when launchctl won't load the job", () => {
  const t = setup(5, "Bootstrap failed: 5");
  const lines = [];
  const code = runCli({ loaded: loadedOk(true), plistPath: t.plistPath, run: t.run, uid: 501, log: (l) => lines.push(l), ...t.job });
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /Bootstrap failed/);
});

test("the command stops with the reason when the settings can't be read, and touches nothing", () => {
  const r = cli({ settings: null, problems: ["config/preferences.json doesn't exist yet. Run /setup to create it."] });
  assert.equal(r.code, 1);
  assert.match(r.lines, /✗ config\/preferences\.json doesn't exist yet/);
  assert.equal(existsSync(r.plistPath), false);
  assert.deepEqual(r.calls, []);
});

test("the command won't turn the job on while the settings still have problems, since every run would stop", () => {
  const r = cli({ ...loadedOk(true), problems: ["candidate.name is blank: put your name."] });
  assert.equal(r.code, 1);
  assert.match(r.lines, /✗ candidate\.name is blank/);
  assert.match(r.lines, /check-setup/);
  assert.equal(existsSync(r.plistPath), false);
  assert.deepEqual(r.calls, []);
});

test("the command can still turn the job off while the settings have problems", () => {
  const r = cli({ ...loadedOk(false), problems: ["candidate.name is blank: put your name."] }, { before: oldPlist });
  assert.equal(r.code, 0);
  assert.equal(existsSync(r.plistPath), false);
  assert.deepEqual(r.calls, [["launchctl", "bootout", `gui/501/${LABEL}`]]);
});

test("the command refreshes an installed job whose paths changed, and leaves an up-to-date one alone", () => {
  const stale = cli(loadedOk(true), { before: (t) => installedPlist(t, plistFor({ ...t.job, repoDir: "/elsewhere/agentic-job-search" })) });
  assert.equal(stale.code, 0);
  assert.deepEqual(stale.calls.map((c) => c[1]), ["bootout", "bootstrap"]);
  assert.match(stale.lines, /refreshed/i);
  assert.equal(readFileSync(stale.plistPath, "utf8"), plistFor(stale.job));

  const fresh = cli(loadedOk(true), { before: (t) => installedPlist(t) });
  assert.equal(fresh.code, 0);
  assert.deepEqual(fresh.calls, []);
  assert.match(fresh.lines, /already on/i);
});
