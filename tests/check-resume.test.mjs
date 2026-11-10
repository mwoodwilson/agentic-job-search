// The resume checker: six hard rules fixed in code, plus optional rules from your settings (resume.*).
// Every resume here is the fictional Jordan Reyes example (tests/fixtures/jordan-final.md), changed one rule at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "../scripts/lib/paths.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { HARD_RULES_BLOCK, restoreHardRules, restoreRulesFile } from "../scripts/lib/rules.mjs";
import { TIME_BOUND, timeBoundCount, checkResume, parseSection, verifyCheck } from "../scripts/lib/check-resume.mjs";

const fixture = readFileSync(new URL("./fixtures/jordan-final.md", import.meta.url), "utf8");
const exampleProfile = readFileSync(join(ROOT, "examples", "profile", "profile.md"), "utf8");
const exampleRules = readFileSync(join(ROOT, "examples", "profile", "resume-rules.md"), "utf8");
const exampleSettings = withDefaults(JSON.parse(readFileSync(join(ROOT, "examples", "preferences.json"), "utf8")));
const tmp = () => mkdtempSync(join(tmpdir(), "check-resume-"));

// --- helpers that change one thing in the example resume ---------------------------------------------------------
const isHead = (l) => /^\*\*(.+?)\*\* · /.test(l);
// The bullet lines under the nth role (0-based) as [start, end) line numbers.
function roleRange(ls, n) {
  const start = ls.map((l, i) => (isHead(l) ? i : -1)).filter((i) => i >= 0)[n] + 1;
  let end = start;
  while (end < ls.length && ls[end].startsWith("- ")) end++;
  return [start, end];
}
// Replaces the bullet lines under role n with fn(lines).
function mapRole(md, n, fn) {
  const ls = md.split("\n");
  const [a, b] = roleRange(ls, n);
  ls.splice(a, b - a, ...fn(ls.slice(a, b)));
  return ls.join("\n");
}
// Removes the time phrases the example uses, leaving the numbers.
const strip = (line) => line
  .replace(/ within \d+ months/g, "").replace(/ YoY/g, "").replace(/ in 20\d\d/g, "").replace(/ per (week|month)/g, "").replace(/ annual /g, " ");
const stripRole = (md, n, which = () => true) => mapRole(md, n, (ls) => ls.map((l, i) => (which(i) ? strip(l) : l)));
const bulletsOf = (md, n) => parseSection(md).roles[n].bullets;
const replaceOnce = (md, from, to) => {
  assert.ok(md.includes(from), `fixture contains: ${from}`);
  return md.replace(from, to);
};
const summaryOf = (n) => ("Word ".repeat(100)).slice(0, n - 1) + "."; // exactly n characters
const withSummary = (md, text) => md.replace(/(### Professional Summary\n)[^\n]*/, `$1${text}`);
// A bullet padded to exactly n characters (ends with a period, keeps its number).
const padTo = (bullet, n) => {
  const base = bullet.replace(/\.$/, "");
  return `${base} ${"z".repeat(n - base.length - 2)}.`;
};
const timeProblems = (r) => r.problems.filter((p) => /time-bound/.test(p));
const keywordLines = (md, claimed, marks) => {
  const kws = marks.map((m, i) => `${m ? "✓" : "✗"} keyword${i + 1}`).join(", ");
  return md.replace(/Keyword coverage: \d+\/\d+ \(\d+%\)/, `Keyword coverage: ${claimed}/${marks.length} (0%)`).replace(/^Keywords: .*$/m, `Keywords: ${kws}`);
};

// --- the six hard rules ------------------------------------------------------------------------------------------
test("the example resume passes every hard rule", () => {
  assert.deepEqual(checkResume(fixture).problems, []);
  const r = checkResume(fixture);
  assert.equal(r.ticks, 15);
  assert.equal(r.total, 20);
  assert.ok(Array.isArray(r.softMisses));
});

test("time-bound phrases count", () => {
  for (const t of ["+40% YoY", "2,000+ tests since Q2 2026", "cut setup time 30% within 3 months", "grew revenue 18% in 2025",
    "saving 5 hours per week", "$2M in annual savings", "200 tickets/month", "+12% QoQ"]) assert.equal(timeBoundCount([t]), 1, t);
  for (const t of ["Led 12 engineers", "grew revenue 18%", "shipped 3 launches", "served 4M users", "launched in 3 markets"]) assert.equal(timeBoundCount([t]), 0, t);
});

test("timeBoundCount counts bullets, not matches, and TIME_BOUND keeps no state between calls", () => {
  assert.ok(TIME_BOUND instanceof RegExp);
  assert.equal(TIME_BOUND.global, false);
  assert.equal(timeBoundCount(["+40% YoY in 2025 within 3 months", "Led 12 engineers", "+12% QoQ"]), 2, "two bullets, not four matches");
  assert.equal(timeBoundCount([]), 0);
  for (let i = 0; i < 3; i++) assert.equal(timeBoundCount(["+40% YoY"]), 1);
});

test("TIME_BOUND edge cases: shorthand, windows, dates and look-alikes", () => {
  for (const t of ["+8% MoM", "+8%WoW", "up 20% year-over-year", "cut churn 3 pts year to date", "saved $90K over the first 6 weeks", "in the first 90 days",
    "since March 2025", "by FY26", "in H1 2025", "reduced tickets in less than 2 weeks", "30% faster last quarter"]) assert.equal(timeBoundCount([t]), 1, t);
  for (const t of ["Partnered with mom-and-pop merchants on 3 launches", "Wrote 9 PRDs for the 2022 roadmap", "Led a team of 6 engineers", "Cut checkout steps from 3 to 1",
    "Grew weekly active users 20%", "Presented the quarterly KPI review to 12 leaders",
    "Cut support tickets by 2000", "Grew orders from 2000 to 5200", "Rebuilt checkout for 2000 stores"]) assert.equal(timeBoundCount([t]), 0, t);
  for (const t of ["Cut tickets in 2025", "Shipped it during 2024", "Held NPS through 2023", "Grew sales since 2022"]) assert.equal(timeBoundCount([t]), 1, t);
});

test("a recent role with fewer than 2 time-bound results fails", () => {
  const md = stripRole(fixture, 1);
  assert.equal(timeBoundCount(bulletsOf(md, 1)), 0, "the strip left no time phrase in role 2");
  const r = checkResume(md);
  assert.deepEqual(timeProblems(r), [
    '"Product Manager": needs at least 2 time-bound results (has 0); aim for 3, e.g. "+40% YoY", "in 2025", "within 3 months"',
  ]);
  // One time-bound bullet is still not enough.
  const one = stripRole(fixture, 1, (i) => i !== 0);
  assert.equal(timeBoundCount(bulletsOf(one, 1)), 1);
  assert.match(timeProblems(checkResume(one))[0], /^"Product Manager": needs at least 2 time-bound results \(has 1\)/);
  // The first role is a recent role too.
  const first = stripRole(fixture, 0);
  assert.match(timeProblems(checkResume(first))[0], /^"Senior Product Manager": needs at least 2 time-bound results \(has 0\)/);
});

test("a role with 2 time-bound results passes, a third role needs none", () => {
  let md = stripRole(fixture, 0, (i) => i >= 2); // role 1 keeps bullets 1 and 2
  md = stripRole(md, 1, (i) => i >= 2); // role 2 keeps bullets 1 and 2
  md = stripRole(md, 2); // role 3 keeps none
  assert.deepEqual([0, 1, 2].map((n) => timeBoundCount(bulletsOf(md, n))), [2, 2, 0]);
  assert.deepEqual(timeProblems(checkResume(md)), []);
});

test("a resume with one role checks just that role", () => {
  const ls = fixture.split("\n");
  const heads = ls.map((l, i) => (isHead(l) ? i : -1)).filter((i) => i >= 0);
  const edu = ls.indexOf("### Education & Certifications");
  const one = [...ls.slice(0, heads[1]), ...ls.slice(edu)].join("\n");
  assert.equal(parseSection(one).roles.length, 1);
  assert.deepEqual(checkResume(one).problems, []);
  const r = checkResume(stripRole(one, 0));
  assert.deepEqual(timeProblems(r).length, 1);
  assert.match(timeProblems(r)[0], /^"Senior Product Manager": needs at least 2 time-bound results \(has 0\)/);
});

// Rules 2–5 check each role's bullets, so they only work when every role line and bullet is read as part of a role.
const SHAPE = "**Title** · Company (Location) · Dates";
const experienceLines = (md, fn) => {
  const ls = md.split("\n");
  const a = ls.indexOf("### Professional Experience") + 1;
  const b = ls.indexOf("### Education & Certifications");
  return [...ls.slice(0, a), ...fn(ls.slice(a, b)), ...ls.slice(b)].join("\n");
};

test("a resume with no role lines fails and names the expected shape", () => {
  const md = experienceLines(fixture, () => [""]);
  assert.equal(parseSection(md).roles.length, 0);
  const r = checkResume(md);
  assert.equal(r.problems.length, 1, r.problems.join("; "));
  assert.ok(r.problems[0].startsWith('No role lines found under "### Professional Experience"'), r.problems[0]);
  assert.ok(r.problems[0].includes(SHAPE), r.problems[0]);
});

test("role lines written with | instead of · are flagged, and their bullets don't slip past the bullet rules", () => {
  const long = `- Rebuilt the whole checkout flow ${"for every merchant ".repeat(12)}and nobody ever measured it.`;
  assert.ok(long.length > 202);
  const md = experienceLines(fixture, (ls) => [
    ...ls.map((l) => l.replace(/^(\*\*[^*]+\*\*) · /, "$1 | ")),
    long,
  ]);
  assert.equal(parseSection(md).roles.length, 0);
  const r = checkResume(md);
  assert.ok(r.problems.some((p) => p.startsWith('No role lines found under "### Professional Experience"') && p.includes(SHAPE)), r.problems.join("; "));
  const bad = r.problems.filter((p) => p.startsWith("Experience line isn't a role line"));
  assert.equal(bad.length, 3, r.problems.join("; "));
  assert.ok(bad.every((p) => p.includes(SHAPE)));
  assert.ok(bad[0].includes("**Senior Product Manager** | Larkfield Commerce"), bad[0]);
  const loose = r.problems.filter((p) => p.startsWith("Bullet before the first role line"));
  assert.ok(loose.length >= 1, r.problems.join("; "));
  assert.ok(loose.every((p) => p.includes(SHAPE)));
  // The bullets are still held to rules 2 and 3 while the role lines are being fixed.
  assert.ok(r.problems.some((p) => p.startsWith("Bullet over 200 characters")), r.problems.join("; "));
  assert.ok(r.problems.some((p) => p.startsWith("Bullet has no number")), r.problems.join("; "));
});

test("one malformed role line among three is flagged, not absorbed into the role above it", () => {
  const md = replaceOnce(fixture, "**Product Manager** · Wrenfield Health", "**Product Manager** - Wrenfield Health");
  assert.equal(parseSection(md).roles.length, 2);
  const r = checkResume(md);
  const bad = r.problems.filter((p) => p.startsWith("Experience line isn't a role line"));
  assert.equal(bad.length, 1, r.problems.join("; "));
  assert.ok(bad[0].includes("**Product Manager** - Wrenfield Health"), bad[0]);
  assert.ok(bad[0].includes(SHAPE), bad[0]);
  assert.equal(r.problems.some((p) => p.startsWith("No role lines found")), false);
  assert.equal(r.problems.some((p) => p.startsWith("Bullet before the first role line")), false);
});

test("a bullet before the first role line is flagged", () => {
  const md = experienceLines(fixture, (ls) => ["- Led 12 engineers through 3 launches in 2025.", ...ls]);
  const r = checkResume(md);
  assert.equal(r.problems.length, 1, r.problems.join("; "));
  assert.ok(r.problems[0].startsWith("Bullet before the first role line"), r.problems[0]);
  assert.ok(r.problems[0].includes("Led 12 engineers"), r.problems[0]);
});

test("the note line and bold-led bullets are not mistaken for stray role lines", () => {
  const noted = experienceLines(fixture, (ls) => [...ls, "*Earlier roles on request.*", ""]);
  assert.deepEqual(checkResume(noted).problems, []);
  const lead = replaceOnce(fixture, "- Ran a metered paywall test", "- **Paywall:** Ran a metered paywall test");
  assert.deepEqual(checkResume(lead).problems, []);
});

test("summary length is 300–350 characters", () => {
  for (const n of [299, 351]) {
    const r = checkResume(withSummary(fixture, summaryOf(n)));
    assert.ok(r.problems.some((p) => p.includes(`Summary is ${n} characters`) && p.includes("must be 300–350")), String(n));
  }
  for (const n of [300, 350]) assert.deepEqual(checkResume(withSummary(fixture, summaryOf(n))).problems, [], String(n));
});

test("a bullet over 200 characters fails, even a finalized one", () => {
  assert.match(fixture, /^Final:/m, "the example keeps its Final: line");
  const original = bulletsOf(fixture, 0)[0];
  const swap = (text) => replaceOnce(fixture, `- ${original}`, `- ${text}`);
  const r = checkResume(swap(padTo(original, 201)));
  assert.equal(r.problems.filter((p) => p.startsWith("Bullet over 200 characters (201)")).length, 1);
  assert.deepEqual(checkResume(swap(padTo(original, 200))).problems, [], "200 is allowed");
});

test("a bullet with no number fails", () => {
  const original = bulletsOf(fixture, 2)[1];
  const r = checkResume(replaceOnce(fixture, `- ${original}`, `- ${original.replace(/\d/g, "")}`));
  assert.equal(r.problems.filter((p) => p.includes("Bullet has no number")).length, 1);
});

test("coverage under 70% fails and the claimed count must match the ✓ marks", () => {
  const under = checkResume(keywordLines(fixture, 6, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0]));
  assert.ok(under.problems.some((p) => p.includes("under 70%")), under.problems.join("; "));
  assert.equal(under.problems.some((p) => p.includes("claims")), false);
  const liar = checkResume(keywordLines(fixture, 8, [1, 1, 1, 1, 1, 1, 1, 0, 0, 0]));
  assert.ok(liar.problems.some((p) => p.includes("claims 8 but 7")), liar.problems.join("; "));
  assert.equal(liar.problems.some((p) => p.includes("under 70%")), false, "7 of 10 is exactly 70%");
  assert.deepEqual(checkResume(keywordLines(fixture, 7, [1, 1, 1, 1, 1, 1, 1, 0, 0, 0])).problems, []);
  assert.ok(checkResume(fixture.replace(/^Keywords: .*$/m, "")).problems.some((p) => p.includes("Missing the Keyword coverage count or the Keywords list")));
});

test("a fact-check quote that isn't in your files fails", () => {
  const sources = { "profile/profile.md": exampleProfile };
  const bullet = bulletsOf(fixture, 0)[4];
  const only = [bullet];
  const entry = (source_file, source_quote) => ({ bullets: [{ text: bullet, verdict: "supported", source_file, source_quote }] });
  const missing = verifyCheck(entry("profile/profile.md", "Doubled the merchant base with a viral referral program in 2024"), fixture, sources, { only });
  assert.equal(missing.problems.length, 1);
  assert.match(missing.problems[0], /^quote not found in profile\/profile\.md/);
  const notYours = verifyCheck(entry("notes.md", "Present the checkout KPIs (conversion, authorization rate, payment success rate) to company leadership every quarter."), fixture, sources, { only });
  assert.equal(notYours.problems.length, 1);
  assert.match(notYours.problems[0], /isn't one of your files/);
  assert.match(notYours.problems[0], /^Source "notes\.md" isn't one of your files/);
  const real = verifyCheck(entry("profile/profile.md", "Present the checkout KPIs (conversion, authorization rate, payment success rate) to company leadership every quarter."), fixture, sources, { only });
  assert.deepEqual(real.problems, []);
  const unchecked = verifyCheck({ bullets: [] }, fixture, sources, { only });
  assert.match(unchecked.problems[0], /^Line not checked/);
});

test("a fact-check can't cite a name every object has (constructor, __proto__) as one of your files", () => {
  const sources = { "profile/profile.md": exampleProfile };
  const bullet = bulletsOf(fixture, 0)[4];
  const only = [bullet];
  const cite = (source_file, source_quote) => verifyCheck({ bullets: [{ text: bullet, verdict: "supported", source_file, source_quote }] }, fixture, sources, { only });
  // What these names turn into as text, so a lookup that reaches the object's own prototype would "find" the quote.
  assert.equal(String(Object.prototype.constructor), "function Object() { [native code] }");
  for (const [file, quote] of [["constructor", "function Object() { [native code] }"], ["__proto__", "[object Object]"], ["toString", "function toString() { [native code] }"], ["hasOwnProperty", "function hasOwnProperty() { [native code] }"]]) {
    const r = cite(file, quote);
    assert.equal(r.problems.length, 1, file);
    assert.match(r.problems[0], new RegExp(`^Source "${file}" isn't one of your files`), file);
  }
  assert.deepEqual(cite("profile/profile.md", "Present the checkout KPIs (conversion, authorization rate, payment success rate) to company leadership every quarter.").problems, [], "a real file still works");
  assert.match(cite(undefined, "Present the checkout KPIs (conversion, authorization rate, payment success rate) to company leadership every quarter.").problems[0], /isn't one of your files/, "no file named at all");
});

// --- your own rules (settings.resume) ----------------------------------------------------------------------------
test("the example resume passes the example person's own rules, and default settings add none", () => {
  assert.deepEqual(checkResume(fixture, { rules: exampleSettings.resume }).problems, []);
  assert.deepEqual(checkResume(fixture, { rules: withDefaults({}).resume }).problems, []);
  assert.deepEqual(checkResume(fixture, { rules: null }).problems, []);
});

test("user rules: role order, titles and company lines from settings", () => {
  const rules = exampleSettings.resume;
  const line2 = '**Product Manager** · Wrenfield Health (Chicago, IL) · June 2020 – February 2023';
  // A wrong date in role 2 names the line it should have been.
  const wrongDates = checkResume(replaceOnce(fixture, "June 2020 – February 2023", "June 2020 – March 2023"), { rules });
  assert.equal(wrongDates.problems.length, 1);
  assert.ok(wrongDates.problems[0].includes(`"${line2}"`), wrongDates.problems[0]);
  assert.ok(wrongDates.problems[0].includes("Role 2"), wrongDates.problems[0]);
  // A different title.
  const wrongTitle = checkResume(replaceOnce(fixture, "**Associate Product Manager** ·", "**Product Analyst** ·"), { rules });
  assert.ok(wrongTitle.problems.some((p) => p.includes('"**Associate Product Manager** · Penhallow Media (New York, NY) · July 2017 – May 2020"')), wrongTitle.problems.join("; "));
  // Reordered: role 1 and role 2 trade places.
  const ls = fixture.split("\n");
  const heads = ls.map((l, i) => (isHead(l) ? i : -1)).filter((i) => i >= 0);
  const swapped = [...ls.slice(0, heads[0]), ...ls.slice(heads[1], heads[2]), ...ls.slice(heads[0], heads[1]), ...ls.slice(heads[2])].join("\n");
  const order = checkResume(swapped, { rules });
  assert.ok(order.problems.some((p) => p.includes("Role 1") && p.includes('"**Senior Product Manager** · Larkfield Commerce (Chicago, IL) · March 2023 – Present"')), order.problems.join("; "));
  assert.ok(order.problems.some((p) => p.includes("Role 2") && p.includes(line2)));
  // A missing role.
  const two = [...ls.slice(0, heads[2]), ...ls.slice(ls.indexOf("### Education & Certifications"))].join("\n");
  const fewer = checkResume(two, { rules });
  assert.ok(fewer.problems.some((p) => p.includes("Expected 3 roles") && p.includes("found 2")), fewer.problems.join("; "));
});

test("user rules: bullet limits, note and banned phrases", () => {
  const roles = exampleSettings.resume.roles.map((r, i) => (i === 2 ? { ...r, minBullets: 3 } : r));
  const rules = { roles, maxBullets: 4, note: "*Earlier roles on request.*", banned: [{ pattern: "\\bsynergy\\b", why: "No buzzwords" }] };
  const md = replaceOnce(fixture, "Ran a metered paywall test", "Ran a metered paywall test with synergy, 2 teams and");
  const r = checkResume(md, { rules });
  assert.ok(r.problems.includes('"Senior Product Manager": at most 4 bullets (has 5)'), r.problems.join("; "));
  assert.ok(r.problems.includes('"Associate Product Manager": needs at least 3 bullets (has 2)'), r.problems.join("; "));
  assert.ok(r.problems.includes("Experience note should read *Earlier roles on request.*"), r.problems.join("; "));
  assert.ok(r.problems.includes('No buzzwords: "synergy"'), r.problems.join("; "));
  assert.equal(r.problems.length, 4, r.problems.join("; "));
  // The note, when it is there, satisfies the rule; a banned pattern matches any capitalization.
  const noted = replaceOnce(md, "### Education & Certifications", "*Earlier roles on request.*\n\n### Education & Certifications").replace("with synergy", "with Synergy");
  const fixed = checkResume(noted, { rules });
  assert.equal(fixed.problems.some((p) => p.includes("Experience note")), false);
  assert.ok(fixed.problems.includes('No buzzwords: "Synergy"'));
  // With no maxBullets, minBullets, note or banned list, none of those rules apply.
  assert.deepEqual(checkResume(md, { rules: { roles: [], maxBullets: null, note: "", banned: [] } }).problems, []);
});

test("user rules: a note written as plain text in the settings matches the italic line on the resume", () => {
  const plain = { note: "Earlier roles on request." };
  const withNote = replaceOnce(fixture, "### Education & Certifications", "*Earlier roles on request.*\n\n### Education & Certifications");
  assert.equal(checkResume(withNote, { rules: plain }).problems.some((p) => p.includes("Experience note")), false);
  // The same note typed with its asterisks still matches (the earlier way of writing it).
  assert.equal(checkResume(withNote, { rules: { note: "*Earlier roles on request.*" } }).problems.some((p) => p.includes("Experience note")), false);
  // A missing note, or different wording, is still caught, and the message shows the italic line to write.
  const missing = checkResume(fixture, { rules: plain }).problems;
  assert.ok(missing.includes("Experience note should read *Earlier roles on request.*"), missing.join("; "));
  const other = replaceOnce(fixture, "### Education & Certifications", "*Roles before 2020 on request.*\n\n### Education & Certifications");
  assert.ok(checkResume(other, { rules: plain }).problems.includes("Experience note should read *Earlier roles on request.*"));
  // A note made only of asterisks is no note at all.
  assert.deepEqual(checkResume(fixture, { rules: { note: "**" } }).problems, []);
});

test("user rules: a banned pattern that isn't a valid regular expression is skipped, not a crash", () => {
  const rules = { banned: [{ pattern: "(", why: "broken" }, { pattern: "paywall", why: "No paywalls" }] };
  assert.deepEqual(checkResume(fixture, { rules }).problems, ['No paywalls: "paywall"']);
});

test("no user rules: only the hard rules and the section headings are checked", () => {
  const ls = fixture.split("\n");
  const heads = ls.map((l, i) => (isHead(l) ? i : -1)).filter((i) => i >= 0);
  // Role 1 moved to the end and given a 6th bullet.
  const six = "- Wrote 3 launch plans in 2025, each one signed off within 2 weeks by support and sales leads.";
  const edu = ls.indexOf("### Education & Certifications");
  const role1 = ls.slice(heads[0], heads[1]);
  const others = ls.slice(heads[1], edu);
  const out = [...ls.slice(0, heads[0]), ...others, ...role1.filter((l) => l.trim()), six, "", ...ls.slice(edu)].join("\n");
  const s = parseSection(out);
  assert.deepEqual(s.roles.map((r) => r.title), ["Product Manager", "Associate Product Manager", "Senior Product Manager"]);
  assert.equal(s.roles[2].bullets.length, 6);
  assert.deepEqual(checkResume(out, { rules: {} }).problems, []);
  assert.deepEqual(checkResume(out).problems, []);
  // The headings are still required.
  const noSkills = checkResume(fixture.replace("### Skills", "### Abilities"));
  assert.deepEqual(noSkills.problems.length, 1);
  assert.match(noSkills.problems[0], /^Missing section heading "### Skills"/);
});

test("the checker carries no built-in roles, notes, banned phrases or approved-bullet list", () => {
  const src = readFileSync(join(ROOT, "scripts", "lib", "check-resume.mjs"), "utf8");
  for (const gone of ["const ROLES", "NOTE_", "const BANNED", "approvedBullets", "approved"]) assert.equal(src.includes(gone), false, gone);
});

// --- the hard rules block is put back at the start of a run -------------------------------------------------------
test("an edited Hard rules section is put back at the start of a run", () => {
  const dir = tmp();
  const file = join(dir, "resume-rules.md");
  const edited = exampleRules.replace("300–350 characters", "100–500 characters").replace("at least 2 time-bound", "at least 0 time-bound")
    .replace("- Start every bullet", "- Start every single bullet");
  writeFileSync(file, edited);
  assert.equal(restoreHardRules(edited).changed, true);
  assert.equal(restoreRulesFile(file), true);
  const after = readFileSync(file, "utf8");
  assert.ok(after.includes(HARD_RULES_BLOCK), "the block is back exactly as written");
  assert.ok(after.includes("- Start every single bullet"), "your own rules are kept");
  assert.equal(restoreRulesFile(file), false, "nothing to put back the second time");
  assert.equal(readFileSync(file, "utf8"), after);
  // An untouched file, and a missing one, report no change and make no file.
  writeFileSync(file, exampleRules);
  assert.equal(restoreRulesFile(file), false);
  assert.equal(readFileSync(file, "utf8"), exampleRules);
  const none = join(dir, "not-here.md");
  assert.equal(restoreRulesFile(none), false);
  assert.equal(existsSync(none), false);
});

test("job-pull puts the hard rules back after taking the lock, and logs it", () => {
  const src = readFileSync(join(ROOT, "scripts", "job-pull.mjs"), "utf8");
  const main = src.slice(src.indexOf("async function main()"), src.indexOf("// Runs only when started as a program"));
  const ensure = main.indexOf("ensureProfileFiles()");
  const restore = main.indexOf("restoreRulesFile()");
  assert.ok(ensure > -1 && restore > ensure, "main makes missing profile files, then restores the rules");
  assert.match(main, /if \(restoreRulesFile\(\)\) logEvent\("alert", "Hard rules section of profile\/resume-rules\.md was edited; it was put back\."\)/);
  // main only runs inside withLock, and neither call sits in the start-up code that runs before the lock.
  const startup = src.slice(src.indexOf("// Runs only when started as a program"));
  assert.match(startup, /withLock\(main\)/);
  assert.equal(startup.includes("ensureProfileFiles"), false);
  assert.equal(startup.includes("restoreRulesFile"), false);
});
