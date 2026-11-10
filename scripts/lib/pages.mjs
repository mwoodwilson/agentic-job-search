// Whether the Pages app (which makes the PDFs) is installed, found without asking Pages itself: an AppleScript that
// names Pages ("tell application", "id of application") opens a "Where is Pages?" dialog when it is missing, and an
// unattended hourly run would wait on that dialog. It looks in the two Applications folders, then asks Spotlight.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const PAGES_PLACES = ["/Applications/Pages.app", join(homedir(), "Applications", "Pages.app")];
export const NO_PAGES = "Pages isn't installed, so resumes are made as Word files only";

// exists and exec are stand-ins for tests.
export function findPages({ exists = existsSync, exec = spawnSync } = {}) {
  if (PAGES_PLACES.some((p) => exists(p))) return true;
  const r = exec("mdfind", ["kMDItemCFBundleIdentifier == 'com.apple.iWork.Pages'"], { encoding: "utf8", timeout: 10000 });
  return !r.error && r.status === 0 && /\.app$/m.test(String(r.stdout || "").trim());
}

// check() runs the first time the answer is needed; later calls in the same run reuse it, and a missing Pages is
// said once (log).
export function oncePerRun(check = findPages, log = console.log) {
  let found = null;
  return () => {
    if (found === null) {
      found = check() === true;
      if (!found) log(`${NO_PAGES}.`);
    }
    return found;
  };
}
