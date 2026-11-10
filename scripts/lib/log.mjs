// data/workflow-log.md: one line per event, newest last. The script writes run results, failures and alerts;
// Claude adds decisions, fixes and successes when they happen in a session.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { WORKFLOW_LOG } from "./paths.mjs";

export const KINDS = ["run", "success", "failure", "decision", "fix", "alert"];

const stamp = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function logEvent(kind, text, { file = WORKFLOW_LOG, when = new Date() } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown log kind "${kind}" (use ${KINDS.join(", ")})`);
  const line = String(text).replace(/\s*\n\s*/g, " ").trim();
  mkdirSync(dirname(file), { recursive: true }); // data/ doesn't exist before the first run
  appendFileSync(file, `- ${stamp(when)} · ${kind} · ${line}\n`);
}
