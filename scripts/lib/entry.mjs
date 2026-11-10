// "Am I the script being run?" for a command-line script: isMain(import.meta.url).
// Both paths go through realpath first. Node gives import.meta.url as the real path of the file, but
// process.argv[1] is the path as typed, so under a symlinked folder or file (macOS's /var is /private/var, or a
// project folder you linked) comparing them as text is false and the script would exit 0 without doing anything.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return real(argv1) === real(fileURLToPath(metaUrl));
}
