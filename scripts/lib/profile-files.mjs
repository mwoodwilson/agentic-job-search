// Your profile files (profile/profile.md, stories.md, resume-rules.md) are git-ignored, so what you write in them
// is never committed or overwritten by an update. The project ships blank copies next to them as *.example.md.
// ensureProfileFiles() makes any missing profile file from its example and returns the files it made.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PROFILE, STORIES, RULES_FILE } from "./paths.mjs";

export const exampleOf = (file) => file.replace(/\.md$/, ".example.md");

// files: the profile files to make sure exist (default: the three in profile/). An existing file is never touched.
// A file whose example is missing is skipped.
export function ensureProfileFiles({ files = [PROFILE, STORIES, RULES_FILE] } = {}) {
  const created = [];
  for (const file of files) {
    const example = exampleOf(file);
    if (existsSync(file) || !existsSync(example)) continue;
    mkdirSync(dirname(file), { recursive: true });
    copyFileSync(example, file);
    created.push(file);
  }
  return created;
}
