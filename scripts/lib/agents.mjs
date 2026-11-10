// The two agents in the workflow. Both investigate open-ended questions with web tools, both can read only inside
// this project folder (READ) and have no shell, and both can write only a proposal in data/proposals/. Nothing
// changes until you say yes.
//   Repair agent (diagnose-board skill): runs when a job board errors or shows 0 roles 3 runs in a row.
//   Scout agent (scout-companies skill): runs once a week and proposes companies to add.
// claude(step, prompt, opts) is runClaude from lib/claude.mjs (injected so tests can stand in for it).
// budgetUsd is the dollar cap for the run: claude.maxUsdPerStep for the repair agent, claude.maxUsdScout for the scout.
import { runClaude, editRule, READ } from "./claude.mjs";
import { DAYS, DEFAULTS } from "./settings.mjs";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const localDay = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function diagnoseBoard(company, problem, { claude = runClaude, today = localDay(), budgetUsd = DEFAULTS.claude.maxUsdPerStep } = {}) {
  const proposal = `data/proposals/${today}-repair-${slug(company.name)}.md`;
  const r = claude(
    `Diagnosing ${company.name}'s job board (diagnose-board)…`,
    `Use the diagnose-board skill. Company: ${company.name}. Job board type (ats): ${company.ats}. Slug: "${company.slug}". Problem: ${problem}. Write the proposal to ${proposal}.`,
    { allowedTools: [...READ, "WebFetch", editRule(proposal)], budgetUsd }
  );
  return { ...r, proposal };
}

export function runScout({ claude = runClaude, today = localDay(), budgetUsd = DEFAULTS.claude.maxUsdScout } = {}) {
  const proposal = `data/proposals/${today}-scout.md`;
  const r = claude(
    "Scouting for companies to add (scout-companies)…",
    `Use the scout-companies skill. Write the proposal to ${proposal}.`,
    { allowedTools: [...READ, "WebSearch", "WebFetch", editRule(proposal)], budgetUsd }
  );
  return { ...r, proposal };
}

// True on the first run at or after the scout's day and hour each week (a missed one runs on the next run).
// scout is schedule.scout from the settings: { enabled, day: "Monday".."Sunday", hour: 0..23 }. Off means never.
export function shouldScout(now = new Date(), lastIso = null, { enabled = false, day = "Monday", hour = 9 } = {}) {
  if (enabled !== true) return false;
  const i = DAYS.indexOf(day);
  if (i < 0) return false;
  const start = new Date(now);
  start.setHours(hour, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() - ((i + 1) % 7) + 7) % 7)); // back to that day (getDay: 0 is Sunday)
  if (start > now) start.setDate(start.getDate() - 7);
  return !lastIso || new Date(lastIso) < start;
}
