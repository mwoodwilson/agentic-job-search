// Reading data/jobs.csv and changing a role's Status. Only code changes statuses; skills never edit jobs.csv.
import { readFileSync, existsSync } from "node:fs";
import { CSV_FILE } from "./paths.mjs";
import { writeAtomic } from "./state.mjs";

export const STATUSES = ["New", "Backlog", "Resume ready", "Could not tailor", "Needs review", "Applied", "Recruiter screen", "Rejected", "Skip"];

export function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Every row as an object keyed by the header (Fit, Status, Company, Title, …, Link).
export function getRows({ file = CSV_FILE } = {}) {
  if (!existsSync(file)) return []; // first run: no job list yet
  const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parseCsvLine(l).map((v, i) => [head[i], v])));
}

export function setStatus(link, status, { file = CSV_FILE } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  const text = readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const head = parseCsvLine(lines[0].replace(/^﻿/, ""));
  const si = head.indexOf("Status"), li = head.indexOf("Link");
  const hits = lines.map((l, i) => [l, i]).filter(([l, i]) => i > 0 && l.trim() && parseCsvLine(l)[li] === link);
  if (hits.length !== 1) throw new Error(`link not found exactly once in jobs.csv: ${link}`);
  const [line, i] = hits[0];
  const cells = parseCsvLine(line);
  cells[si] = status;
  lines[i] = cells.map(cell).join(",");
  writeAtomic(file, lines.join(eol));
}
