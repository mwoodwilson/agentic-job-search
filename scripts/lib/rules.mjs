// The fixed "Hard rules" block at the top of profile/resume-rules.md. The code checks these rules on every
// resume, so the block can't be loosened by editing the file: restoreHardRules() puts it back before each run.
// Your own rules go below the block, under "## My rules".
import { readFileSync, existsSync } from "node:fs";
import { RULES_FILE } from "./paths.mjs";
import { writeAtomic } from "./state.mjs";

export const HARD_RULES_START = "<!-- HARD RULES START -->";
export const HARD_RULES_END = "<!-- HARD RULES END -->";

export const HARD_RULES_BLOCK = [
  HARD_RULES_START,
  "## Hard rules (fixed: the code checks these on every resume; edits here are undone on the next run)",
  "1. The professional summary is 300–350 characters, counting spaces.",
  "2. Every bullet is 200 characters or less.",
  "3. Every bullet states a number and its impact.",
  "4. Each of your two most recent roles has at least 2 time-bound results (aim for 3), such as \"+40% YoY\", \"2,000+ since Q2 2026\", \"within 3 months\" or \"in 2025\".",
  "5. Every summary sentence and bullet is backed by a quote from your own files (profile.md, stories.md or a resume you finalized).",
  "6. The resume covers at least 70% of the job's keywords using true material only. If it can't, the role is marked \"Could not tailor\" instead of stretched.",
  HARD_RULES_END,
].join("\n");

// Puts the hard rules block back exactly as written. Between the markers if both are there (anything else in
// the file is left alone); otherwise at the top, with any stray marker removed. changed says whether the text differed.
export function restoreHardRules(text) {
  const src = typeof text === "string" ? text : "";
  const start = src.indexOf(HARD_RULES_START);
  const end = start < 0 ? -1 : src.indexOf(HARD_RULES_END, start + HARD_RULES_START.length);
  let out;
  if (start >= 0 && end >= 0) {
    out = src.slice(0, start) + HARD_RULES_BLOCK + src.slice(end + HARD_RULES_END.length);
  } else {
    const rest = src.split(HARD_RULES_START).join("").split(HARD_RULES_END).join("").replace(/^\s+/, "");
    out = HARD_RULES_BLOCK + (rest ? "\n\n" + rest : "\n");
  }
  return { text: out, changed: out !== src };
}

// Puts the hard rules back in your rules file at the start of a run. Returns true when it had to change the file
// (so the run can say it was edited), false when the block was already right or there is no file to fix.
export function restoreRulesFile(file = RULES_FILE) {
  if (!existsSync(file)) return false;
  const { text, changed } = restoreHardRules(readFileSync(file, "utf8"));
  if (changed) writeAtomic(file, text);
  return changed;
}
