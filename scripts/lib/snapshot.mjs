// Saves your data after each run, so any run's changes (jobs.csv, archives, resumes, competencies, the log) can be
// seen and undone with git. It uses its own git folder (.history/, made on first use) with the project as the work
// tree, so it never touches the project's .git and pulling code updates never collides with your data.
// Resume binaries (.docx, .pdf, .pages), temp files and the run lock are left out. Never pushes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ROOT, HISTORY_DIR } from "./paths.mjs";

export const SNAPSHOT_PATHS = ["data", "archives", "outputs", "profile", "config/preferences.json", "inbox.md"];
const LEFT_OUT = [
  ":(exclude)data/job-pull.lock",
  ...["*.tmp", "*.docx", "*.pdf", "*.pages", "*.pages/**"].map((p) => `:(exclude,glob)**/${p}`), // .pages can be a folder
];

// gitDir is relative to cwd (or absolute). Returns true when a commit was made, false when nothing changed.
export function snapshotRun(message, { cwd = ROOT, gitDir = relative(ROOT, HISTORY_DIR), paths = SNAPSHOT_PATHS } = {}) {
  const dir = resolve(cwd, gitDir);
  const git = (...a) => execFileSync("git", [`--git-dir=${dir}`, `--work-tree=${cwd}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!existsSync(join(dir, "HEAD"))) {
    git("init", "-q");
    git("config", "user.name", "Job search history");
    git("config", "user.email", "history@localhost");
    git("config", "commit.gpgsign", "false");
  }
  // A path git can't match is an error, so only paths that exist now or were saved before (to record a deletion).
  const present = paths.filter((p) => existsSync(join(cwd, p)) || git("ls-files", "--", p).trim());
  if (!present.length) return false;
  git("add", "-A", "-f", "--", ...present, ...LEFT_OUT); // -f: these folders are git-ignored in the project
  try {
    git("diff", "--cached", "--quiet");
    return false; // nothing changed
  } catch {
    git("commit", "-q", "-m", message);
    return true;
  }
}
