// data/health.json: how each job board did on recent runs. A board that returns 0 open roles, or errors,
// 3 runs in a row raises one alert (once per streak), since a broken or empty board otherwise fails silently.
import { readFileSync } from "node:fs";
import { HEALTH_FILE } from "./paths.mjs";
import { writeAtomic } from "./state.mjs";

export const STREAK = 3;

export function recordBoard(name, { open, error } = {}, { file = HEALTH_FILE, when = new Date().toISOString() } = {}) {
  let all = {};
  try { all = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const h = all[name] || { zeroStreak: 0, errorStreak: 0 };
  if (error) { h.errorStreak++; h.zeroStreak = 0; h.lastError = error; }
  else if (!open) { h.zeroStreak++; h.errorStreak = 0; }
  else { h.zeroStreak = 0; h.errorStreak = 0; h.lastOk = when; h.lastOpen = open; }
  h.lastRun = when;
  all[name] = h;
  writeAtomic(file, JSON.stringify(all, null, 1));
  let alert = null;
  if (h.errorStreak === STREAK) alert = `${name}'s job board has failed ${STREAK} runs in a row: ${error}`;
  if (h.zeroStreak === STREAK) alert = `${name}'s job board has shown 0 open roles ${STREAK} runs in a row. The board may have moved or broken.`;
  return { alert, health: h };
}
