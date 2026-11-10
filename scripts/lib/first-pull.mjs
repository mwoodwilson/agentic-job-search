// data/boards-pulled.json: when each job board was first read successfully, keyed by "<ats>|<slug>". A board with no
// record is being read for the first time, so the roles already open on it land as "Backlog", not "New": adding a
// company, or fixing a board that never worked, never queues every open role for a paid resume at once. A corrected
// board name (slug) or type counts as a new board.
import { readFileSync } from "node:fs";
import { PULLED_FILE } from "./paths.mjs";
import { writeAtomic } from "./state.mjs";

export const boardKey = (c) => `${String(c.ats ?? "").toLowerCase()}|${String(c.slug ?? "").toLowerCase()}`;
const load = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };

// Names of the companies whose board has no record yet.
export function firstPulls(companies, { file = PULLED_FILE } = {}) {
  const pulled = load(file);
  return new Set(companies.filter((c) => !(boardKey(c) in pulled)).map((c) => c.name));
}

// Records these boards as read (the time of their first successful read is kept).
export function recordPulls(companies, { file = PULLED_FILE, when = new Date().toISOString() } = {}) {
  const pulled = load(file);
  const fresh = companies.filter((c) => !(boardKey(c) in pulled));
  if (!fresh.length) return;
  for (const c of fresh) pulled[boardKey(c)] = when;
  writeAtomic(file, JSON.stringify(pulled, null, 1));
}
