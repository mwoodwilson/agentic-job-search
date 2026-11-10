// Safe state handling: one run at a time, and files replaced whole (never half-written).
import { openSync, closeSync, writeSync, statSync, rmSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { LOCK_FILE } from "./paths.mjs";

// True when the process that wrote the lock is still running.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// Runs fn while holding the lock file. If another run holds it (and it isn't stale), fn is skipped.
// Claude sessions editing data files by hand should check this lock too.
export async function withLock(fn, { file = LOCK_FILE, staleMs = 30 * 60e3 } = {}) {
  try {
    // Old and its process is gone: left by a crashed run. A long run that is still going keeps its lock.
    const pid = Number(readFileSync(file, "utf8").split(" ")[0]);
    if (Date.now() - statSync(file).mtimeMs > staleMs && !(pid > 0 && alive(pid))) rmSync(file, { force: true });
  } catch {}
  let fd;
  try {
    fd = openSync(file, "wx");
  } catch {
    return { ran: false, value: undefined };
  }
  writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
  closeSync(fd);
  try {
    return { ran: true, value: await fn() };
  } finally {
    rmSync(file, { force: true });
  }
}

// Writes to a temp file in the same folder, then renames it over the target.
export function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
