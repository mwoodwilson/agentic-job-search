import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseBoard, runScout, shouldScout } from "../scripts/lib/agents.mjs";
import { editRule, READ } from "../scripts/lib/claude.mjs";
import { DEFAULTS } from "../scripts/lib/settings.mjs";

const fakeClaude = (calls) => (step, prompt, opts) => { calls.push({ step, prompt, opts }); return { ok: true, result: "Proposal written.", costUsd: 0.4 }; };

test("the repair agent investigates with web access but can write only its proposal", () => {
  const calls = [];
  const r = diagnoseBoard({ name: "Globex", ats: "greenhouse", slug: "globex" }, "0 open roles 3 runs in a row", { claude: fakeClaude(calls), today: "2026-11-04" });
  assert.equal(r.proposal, "data/proposals/2026-11-04-repair-globex.md");
  const { prompt, opts } = calls[0];
  assert.match(prompt, /diagnose-board/);
  assert.match(prompt, /greenhouse/);
  assert.match(prompt, /"globex"/);
  assert.match(prompt, /0 open roles/);
  assert.deepEqual(opts.allowedTools, [...READ, "WebFetch", editRule("data/proposals/2026-11-04-repair-globex.md")]);
});

test("the repair agent runs on the budget it is given, and on the per-step default otherwise", () => {
  const calls = [];
  diagnoseBoard({ name: "Acme", ats: "lever", slug: "acme" }, "error", { claude: fakeClaude(calls), today: "2026-11-04", budgetUsd: 1.25 });
  assert.equal(calls[0].opts.budgetUsd, 1.25);
  diagnoseBoard({ name: "Acme", ats: "lever", slug: "acme" }, "error", { claude: fakeClaude(calls), today: "2026-11-04" });
  assert.equal(calls[1].opts.budgetUsd, DEFAULTS.claude.maxUsdPerStep);
});

test("the scout agent searches the web but can write only its proposal", () => {
  const calls = [];
  const r = runScout({ claude: fakeClaude(calls), today: "2026-11-09" });
  assert.equal(r.proposal, "data/proposals/2026-11-09-scout.md");
  assert.deepEqual(calls[0].opts.allowedTools, [...READ, "WebSearch", "WebFetch", editRule("data/proposals/2026-11-09-scout.md")]);
  assert.match(calls[0].prompt, /scout-companies/);
});

test("the scout runs on the budget it is given, and on the scout default otherwise", () => {
  const calls = [];
  runScout({ claude: fakeClaude(calls), today: "2026-11-09", budgetUsd: 7.5 });
  assert.equal(calls[0].opts.budgetUsd, 7.5);
  runScout({ claude: fakeClaude(calls), today: "2026-11-09" });
  assert.equal(calls[1].opts.budgetUsd, DEFAULTS.claude.maxUsdScout);
});

const MON9 = { enabled: true, day: "Monday", hour: 9 };

test("the scout runs once a week, on the first run on or after the scout day and hour", () => {
  const mon9 = new Date("2026-11-09T09:00:00"), mon8 = new Date("2026-11-09T08:00:00"), tue = new Date("2026-11-10T10:00:00");
  assert.equal(shouldScout(mon9, null, MON9), true);
  assert.equal(shouldScout(mon8, "2026-11-02T09:00:00", MON9), false, "last week's scout already ran; this week's starts at 9:00");
  assert.equal(shouldScout(mon9, "2026-11-09T09:00:05", MON9), false, "already ran this week");
  assert.equal(shouldScout(tue, "2026-11-02T09:00:00", MON9), true, "Monday was missed (Mac asleep): run Tuesday");
  assert.equal(shouldScout(tue, "2026-11-09T09:01:00", MON9), false);
});

test("a scout that is turned off never runs", () => {
  const now = new Date("2026-11-09T09:00:00");
  assert.equal(shouldScout(now, null, { enabled: false }), false);
  assert.equal(shouldScout(now, null, { enabled: false, day: "Monday", hour: 9 }), false);
  assert.equal(shouldScout(now, "2020-01-01T00:00:00", { enabled: false, day: "Monday", hour: 9 }), false);
  assert.equal(shouldScout(now, null), false, "with no scout settings it stays off");
});

test("the scout day and hour come from the settings", () => {
  const wed14 = { enabled: true, day: "Wednesday", hour: 14 };
  const lastWeek = "2026-11-04T14:05:00"; // Wednesday of the week before
  assert.equal(shouldScout(new Date("2026-11-11T13:59:00"), lastWeek, wed14), false, "a minute early");
  assert.equal(shouldScout(new Date("2026-11-11T14:00:00"), lastWeek, wed14), true, "Wednesday 14:00");
  assert.equal(shouldScout(new Date("2026-11-09T09:00:00"), lastWeek, wed14), false, "Monday is not the day");
  assert.equal(shouldScout(new Date("2026-11-12T08:00:00"), lastWeek, wed14), true, "Wednesday was missed: run Thursday");
  assert.equal(shouldScout(new Date("2026-11-12T08:00:00"), "2026-11-11T14:10:00", wed14), false, "already ran this week");
  assert.equal(shouldScout(new Date("2026-11-08T23:00:00"), null, { enabled: true, day: "Sunday", hour: 22 }), true, "Sunday is the last day of the week list");
});

test("a scout day that isn't a weekday name never runs", () => {
  assert.equal(shouldScout(new Date("2026-11-09T09:00:00"), null, { enabled: true, day: "Someday", hour: 9 }), false);
});

test("job-pull runs the repair agent on board alerts and the scout weekly, outside backlog runs", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.match(src, /diagnoseBoard\(/);
  assert.match(src, /shouldScout\(/);
  assert.match(src, /runScout\(/);
  assert.match(src, /SCOUT_FILE/);
});

test("job-pull takes every Claude budget and the scout schedule from the settings", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.match(src, /budgetUsd: settings\.claude\.maxUsdPerStep, \.\.\.opts/, "each step defaults to maxUsdPerStep");
  assert.match(src, /diagnoseBoard\([^\n]*budgetUsd: settings\.claude\.maxUsdPerStep/, "the repair agent uses maxUsdPerStep");
  assert.match(src, /runScout\(\{[^\n]*budgetUsd: settings\.claude\.maxUsdScout/, "the scout uses maxUsdScout");
  assert.match(src, /shouldScout\(new Date\(\), last, settings\.schedule\.scout\)/, "the scout day and hour come from schedule.scout");
});
