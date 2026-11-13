#!/usr/bin/env node
// Changes one role's Status in data/jobs.csv, so you don't have to edit the CSV by hand.
//   node scripts/set-status.mjs "<link, or words from the company and title>" "<Status>"
//   e.g. node scripts/set-status.mjs "larkfield growth" Applied
// The words must match exactly one role. Set a Backlog role to New to get a resume for it on the next run.
import { pathToFileURL } from "node:url";
import { getRows, setStatus, STATUSES } from "./lib/jobs-csv.mjs";
import { CSV_FILE } from "./lib/paths.mjs";

export function findRow(query, { file = CSV_FILE } = {}) {
  const rows = getRows({ file });
  const q = String(query ?? "").trim();
  const byLink = rows.filter((r) => r.Link === q);
  if (byLink.length === 1) return byLink[0];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("Give a link, or words from the company and title.");
  const hits = rows.filter((r) => words.every((w) => `${r.Company} ${r.Title}`.toLowerCase().includes(w)));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No role matches "${q}".`);
  throw new Error(`${hits.length} roles match "${q}": ${hits.map((r) => `${r.Company} | ${r.Title}`).join("; ")}. Add words.`);
}

export function changeStatus(query, status, { file = CSV_FILE } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" (use: ${STATUSES.join(", ")})`);
  const row = findRow(query, { file });
  setStatus(row.Link, status, { file });
  return row;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [query, status] = process.argv.slice(2);
  try {
    const row = changeStatus(query, status);
    console.log(`${row.Company} | ${row.Title}: ${row.Status} → ${status}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
