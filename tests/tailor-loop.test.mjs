// The writer + checker loop for one role (scripts/lib/tailor-loop.mjs), with a stub Claude.
// Every resume here is the fictional Jordan Reyes example (tests/fixtures/jordan-final.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../scripts/lib/paths.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { tailorRole, tailorRoles, checkPathFor, draftPathFor, mergeSection, sectionFor } from "../scripts/lib/tailor-loop.mjs";
import { editRule } from "../scripts/lib/claude.mjs";
import { parseSection, checkResume, summarySentences } from "../scripts/lib/check-resume.mjs";
import { readSources } from "../scripts/job-pull.mjs";

const finalized = readFileSync(new URL("./fixtures/jordan-final.md", import.meta.url), "utf8");
const jordan = finalized.replace(/^Final:.*\n/m, ""); // the writer's draft: not yet finalized by you
const rules = withDefaults(JSON.parse(readFileSync(join(ROOT, "examples", "preferences.json"), "utf8"))).resume;
const link = parseSection(jordan).link;
const ROLE = { link, title: "Senior Product Manager, Checkout", company: "Saltmere" };
const bullets = [...summarySentences(parseSection(jordan)), ...parseSection(jordan).roles.flatMap((r) => r.bullets)];
const sources = { "profile/profile.md": bullets.join("\n") }; // every bullet has a real source line in this test
const confirmAll = checkResume(jordan, { rules }).softMisses.map((k) => ({ keyword: k, found: true, resume_quote: bullets[0].slice(0, 12) }));
const allSupported = { bullets: bullets.map((b) => ({ text: b, verdict: "supported", source_file: "profile/profile.md", source_quote: b.slice(0, 40) })), keywords: confirmAll };

// A fake world: the writer saves `resume` to the role's draft file on each try; the checker returns checks[try].
// Each role has its own draft, so up to 3 writers can run at once; the script files a finished draft in
// outputs/tailored-resumes.md.
function world({ resumes, checks, writerSays = "RESULT: saved" }) {
  const calls = [];
  let tailored = "# Tailored resumes\n", draft = "", tries = 0, checkTries = 0, lastCheck = null;
  return {
    calls,
    set tailored(t) { tailored = t; },
    deps: {
      claude: (step, prompt, writes) => {
        calls.push({ step, prompt, writes });
        if (/check-resume/.test(prompt)) { lastCheck = checks[Math.min(checkTries++, checks.length - 1)]; return { ok: true, result: "" }; }
        const r = resumes[Math.min(tries++, resumes.length - 1)];
        if (r) draft = r;
        return { ok: true, result: writerSays };
      },
      readTailored: () => tailored,
      readDraft: () => draft,
      writeDraft: (_link, t) => { draft = t; },
      readSources: () => sources,
      readCheck: () => lastCheck,
      rules,
    },
  };
}

test("a resume that passes code checks and the fact-check is ready after one try", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Resume ready", 1]);
  assert.deepEqual(w.calls[0].writes, [editRule(draftPathFor(link))], "the writer may write only its own draft");
  assert.equal(r.section.trim(), jordan.trim(), "the passing resume is returned for the script to file");
  assert.ok(!w.calls.some((c) => c.writes.some((x) => /jobs\.csv/.test(x))), "no Claude step may write jobs.csv");
});

test("a stretched bullet goes back to the writer with the reason, then passes", async () => {
  const stretched = structuredClone(allSupported);
  stretched.bullets[5] = { text: bullets[5], verdict: "stretched", issue: "describes the pilot as a company-wide rollout" };
  const w = world({ resumes: [jordan, jordan], checks: [stretched, allSupported] });
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Resume ready", 2]);
  const revise = w.calls.filter((c) => /tailor-resume/.test(c.prompt))[1].prompt;
  assert.match(revise, /company-wide rollout/);
  assert.match(revise, /revise/i);
});

test("after 3 tries that still have a stretched line, the role needs your review", async () => {
  const stretched = structuredClone(allSupported);
  stretched.bullets[5] = { text: bullets[5], verdict: "stretched", issue: "overstates ownership" };
  const w = world({ resumes: [jordan], checks: [stretched] });
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Needs review");
  assert.equal(r.tries, 3);
  assert.ok(r.problems.some((p) => /overstates ownership/.test(p)));
});

test("a fact-check that produced nothing is retried once, without calling the writer", async () => {
  const w = world({ resumes: [jordan], checks: [null, allSupported] });
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Resume ready", 1]);
  assert.equal(w.calls.filter((c) => /tailor-resume/.test(c.prompt)).length, 1);
});

test("a fact-check that keeps failing holds the role without more writer calls", async () => {
  const w = world({ resumes: [jordan], checks: [{ bullets: [], keywords: [] }] });
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Needs review");
  assert.equal(w.calls.filter((c) => /tailor-resume/.test(c.prompt)).length, 1);
  assert.ok(r.problems.some((p) => /fact-check didn't finish/.test(p)));
});

test("an honest 'could not tailor' with no resume saved is final", async () => {
  const w = world({ resumes: [null], checks: [], writerSays: "Under 70%.\nRESULT: could not tailor" });
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Could not tailor", 1]);
});

test("a resume already saved by a crashed run is checked, not written again", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  w.tailored = "# Tailored resumes\n\n---\n\n" + jordan;
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Resume ready");
  assert.equal(w.calls.filter((c) => /tailor-resume/.test(c.prompt)).length, 0);
});

test("a draft left by a crashed run is checked, not written again", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  w.deps.writeDraft(link, jordan);
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Resume ready");
  assert.equal(w.calls.filter((c) => /tailor-resume/.test(c.prompt)).length, 0);
});

test("keywords the fact-check doesn't confirm count as missing", async () => {
  // The writer ticks six keywords that are not in the resume: 21/26 on paper, so the code check passes.
  const unbacked = ["ledger", "treasury", "kubernetes", "blockchain", "satellite", "origami"];
  const padded = jordan
    .replace("Keyword coverage: 15/20 (75%)", "Keyword coverage: 21/26 (81%)")
    .replace("✗ buy now pay later", `${unbacked.map((k) => `✓ ${k}`).join(", ")}, ✗ buy now pay later`);
  assert.deepEqual(checkResume(padded, { rules }).problems, []);
  assert.deepEqual(checkResume(padded, { rules }).softMisses, unbacked);
  const w = world({ resumes: [padded], checks: [{ ...allSupported, keywords: [] }] });
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Needs review");
  assert.ok(r.problems.some((p) => /Only 15\/26 keywords are really in the resume.*at least 70%/.test(p)), r.problems.join("; "));
  // Quoted from the resume itself, the same keywords count.
  const quoted = unbacked.map((k) => ({ keyword: k, found: true, resume_quote: bullets[3].slice(0, 20) }));
  const ok = world({ resumes: [padded], checks: [{ ...allSupported, keywords: quoted }] });
  assert.equal((await tailorRole(ROLE, ok.deps)).status, "Resume ready");
});

test("the fact-check may write only its own JSON, through an Edit rule (Claude Code ignores Write(...) rules)", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  await tailorRole(ROLE, w.deps);
  const check = w.calls.find((c) => /check-resume/.test(c.prompt));
  assert.deepEqual(check.writes, [editRule(checkPathFor(link))]);
});

test("the writer's only write permission is its own draft, never outputs/tailored-resumes.md", async () => {
  const w = world({ resumes: [jordan, jordan], checks: [{ ...allSupported, keywords: [] }, allSupported] });
  await tailorRole(ROLE, w.deps);
  const writers = w.calls.filter((c) => /tailor-resume/.test(c.prompt));
  assert.ok(writers.length >= 1);
  for (const c of writers) assert.deepEqual(c.writes, [editRule(draftPathFor(link))]);
});

test("when code checks fail, the fact-check is skipped and the writer revises first", async () => {
  const broken = jordan.replace("Launched text reminders across 120 clinics, cutting the no-show rate from 18% to 11% within 6 months.", "Launched text reminders across clinics to cut the no-show rate.");
  assert.notEqual(broken, jordan);
  const w = world({ resumes: [broken, jordan], checks: [allSupported] });
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Resume ready", 2]);
  assert.equal(w.calls.filter((c) => /check-resume/.test(c.prompt)).length, 1, "only the clean version is fact-checked");
  assert.match(w.calls.filter((c) => /tailor-resume/.test(c.prompt))[1].prompt, /no number/);
});

test("your own rules from the settings go through the same loop", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  w.deps.rules = { ...rules, banned: [{ pattern: "\\bwallets\\b", why: "Say which wallets" }] };
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Needs review");
  assert.ok(r.problems.some((p) => /Say which wallets: "wallets"/.test(p)), r.problems.join("; "));
  assert.equal(w.calls.filter((c) => /check-resume/.test(c.prompt)).length, 0, "no fact-check while a rule is broken");
  const noRules = world({ resumes: [jordan], checks: [allSupported] });
  delete noRules.deps.rules; // the default is no user rules: only the hard rules apply
  assert.equal((await tailorRole(ROLE, noRules.deps)).status, "Resume ready");
});

test("a writer run that reports an error but did save the resume still gets checked", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  const real = w.deps.claude;
  w.deps.claude = (step, prompt, writes) => {
    const r = real(step, prompt, writes);
    return /tailor-resume/.test(prompt) ? { ...r, ok: false, error: "success (exit 1)" } : r;
  };
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Resume ready", 1]);
});

test("--retailor: a role that already has a resume gets a fresh one written (the old one stays as history)", async () => {
  const old = jordan.replace("## ", "## OLD ");
  const w = world({ resumes: [jordan], checks: [allSupported] });
  w.tailored = "# Tailored resumes\n\n---\n\n" + old;
  const r = await tailorRole({ ...ROLE, fresh: true }, w.deps);
  assert.equal(r.status, "Resume ready");
  const writes = w.calls.filter((c) => /tailor-resume/.test(c.prompt));
  assert.equal(writes.length, 1);
  assert.match(writes[0].prompt, /on the role with this link only/);
  assert.doesNotMatch(writes[0].prompt, /revise/i);
  assert.doesNotMatch(r.section, /## OLD /, "the new resume, not the old one");
});

test("--retailor: if no new resume is saved, the old one is never passed off as ready", async () => {
  const w = world({ resumes: [], checks: [allSupported] });
  w.tailored = "# Tailored resumes\n\n---\n\n" + jordan;
  const r = await tailorRole({ ...ROLE, fresh: true }, w.deps);
  assert.equal(r.status, "Needs review");
  assert.ok(r.problems.some((p) => /No resume with this link was saved/.test(p)));
  assert.equal(w.calls.filter((c) => /check-resume/.test(c.prompt)).length, 0, "the old resume isn't fact-checked as if it were new");
});

test("the files the writer and checker need are passed in the prompt up front", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  w.deps.writerFiles = () => '<file path="profile/profile.md">PROFILE TEXT</file>';
  w.deps.checkerFiles = (_link, sec) => `<file path="profile/profile.md">PROFILE TEXT</file>\n<file path="draft">${sec.slice(0, 30)}</file>`;
  await tailorRole(ROLE, w.deps);
  const writer = w.calls.find((c) => /tailor-resume/.test(c.prompt)).prompt;
  const checker = w.calls.find((c) => /check-resume/.test(c.prompt)).prompt;
  assert.ok(writer.startsWith("<file"), "files first, so runs share a cached prefix");
  assert.match(writer, /PROFILE TEXT/);
  assert.match(checker, /PROFILE TEXT/);
  assert.ok(checker.includes(jordan.trim().slice(0, 30)), "the checker gets the resume itself");
});

// Where a finished draft goes in outputs/tailored-resumes.md: newest first, right under the intro.
const intro = "# Tailored resumes\n\nIntro text.\n";
const otherSec = "## Other | Co (2026-11-01)\nLink: https://other.example/9 · Keyword coverage: 1/1 (100%)\n";
test("a new resume is filed at the top, under the intro, and nothing else changes", () => {
  const out = mergeSection(intro + "\n---\n\n" + otherSec, jordan, { link });
  assert.ok(out.startsWith(intro));
  assert.ok(out.indexOf(link) < out.indexOf("https://other.example/9"), "newest first");
  assert.ok(out.includes(otherSec.trim()));
  assert.equal(sectionFor(link, out).trim(), jordan.trim());
});

test("a resume rechecked after a crash replaces its old copy instead of being filed twice", () => {
  const edited = jordan.replace("across 120 clinics", "across 121 clinics");
  assert.notEqual(edited, jordan);
  const out = mergeSection(intro + "\n---\n\n" + otherSec + "\n---\n\n" + jordan, edited, { link });
  assert.equal(out.split(link).length - 1, 1);
  assert.match(sectionFor(link, out), /across 121 clinics/);
});

test("--retailor files the new resume on top and keeps the old one as history", () => {
  const old = jordan.replace("## ", "## OLD ");
  const out = mergeSection(intro + "\n---\n\n" + old, jordan, { link, fresh: true });
  assert.equal(out.split(link).length - 1, 2);
  assert.doesNotMatch(sectionFor(link, out), /## OLD /, "the newest copy is the one used");
});

test("the file's intro survives when the file has no resumes yet", () => {
  const out = mergeSection(intro, jordan, { link });
  assert.ok(out.startsWith(intro));
  assert.equal(sectionFor(link, out).trim(), jordan.trim());
});

test("the fact-check's sources are read for this role's link", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  const asked = [];
  w.deps.readSources = (l) => { asked.push(l); return sources; };
  await tailorRole(ROLE, w.deps);
  assert.ok(asked.length >= 1 && asked.every((l) => l === link));
});

// --- what the fact-check may quote ------------------------------------------------------------------------------------
test("sources are exactly profile.md, stories.md and finalized resumes (not this role's own, not drafts)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sources-"));
  const files = { profile: join(dir, "profile.md"), stories: join(dir, "stories.md"), tailored: join(dir, "tailored-resumes.md") };
  writeFileSync(files.profile, "PROFILE TEXT");
  writeFileSync(files.stories, "STORIES TEXT");
  const otherLink = (n) => finalized.replace(/Link: \S+/, `Link: https://example.com/jobs/other-${n}`);
  const draft = jordan.replace(/Link: \S+/, "Link: https://example.com/jobs/other-draft");
  writeFileSync(files.tailored, ["# Tailored resumes", otherLink(1), draft, finalized].join("\n---\n"));
  const s = readSources(link, files);
  assert.deepEqual(Object.keys(s).sort(), ["outputs/tailored-resumes.md", "profile/profile.md", "profile/stories.md"]);
  assert.equal(s["profile/profile.md"], "PROFILE TEXT");
  assert.equal(s["profile/stories.md"], "STORIES TEXT");
  assert.ok(s["outputs/tailored-resumes.md"].includes("other-1"), "a finalized resume for another role is a source");
  assert.ok(!s["outputs/tailored-resumes.md"].includes("other-draft"), "a draft is not");
  assert.ok(!s["outputs/tailored-resumes.md"].includes(link), "this role's own resume is not");
  // A file that doesn't exist reads as empty text, never an error.
  const none = readSources(link, { profile: join(dir, "a"), stories: join(dir, "b"), tailored: join(dir, "c") });
  assert.deepEqual(none, { "profile/profile.md": "", "profile/stories.md": "", "outputs/tailored-resumes.md": "" });
});

test("a quote from any other file isn't accepted as a source", async () => {
  const stray = structuredClone(allSupported);
  stray.bullets[0] = { ...stray.bullets[0], source_file: "notes/diary.md" };
  const w = world({ resumes: [jordan], checks: [stray] });
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "Needs review");
  assert.ok(r.problems.some((p) => /notes\/diary\.md" isn't one of your files/.test(p)), r.problems.join("; "));
});

// --- Claude itself not answering --------------------------------------------------------------------------------------
// Not signed in, a usage limit or no network: the run fails without doing any work (runClaude marks it unavailable).
// That says nothing about the role, so the role stays "New" for the next run instead of becoming "Needs review".
const down = { ok: false, unavailable: true, error: "success (exit 1)", result: "Claude AI usage limit reached", costUsd: 0 };

test("a writer run that fails without doing any work leaves the role New, after one try", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  w.deps.claude = (step, prompt, writes) => { w.calls.push({ step, prompt, writes }); return down; };
  const r = await tailorRole(ROLE, w.deps);
  assert.equal(r.status, "New");
  assert.equal(r.claudeDown, true);
  assert.equal(r.error, "success (exit 1)");
  assert.equal(w.calls.length, 1, "no second or third try while Claude isn't answering");
});

test("a fact-check that fails without doing any work leaves the role New too (its resume is checked next run)", async () => {
  const w = world({ resumes: [jordan], checks: [allSupported] });
  const real = w.deps.claude;
  w.deps.claude = (step, prompt, writes) => (/check-resume/.test(prompt) ? (w.calls.push({ step, prompt, writes }), down) : real(step, prompt, writes));
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.claudeDown], ["New", true]);
  assert.equal(w.calls.filter((c) => /check-resume/.test(c.prompt)).length, 1, "the fact-check isn't rerun");
});

test("a writer failure that did real work is still a normal failed try", async () => {
  const w = world({ resumes: [null, jordan], checks: [allSupported] });
  const real = w.deps.claude;
  let first = true;
  w.deps.claude = (step, prompt, writes) => {
    const r = real(step, prompt, writes);
    if (/tailor-resume/.test(prompt) && first) { first = false; return { ...r, ok: false, unavailable: false, error: "error_max_budget_usd (exit 1)", costUsd: 3 }; }
    return r;
  };
  const r = await tailorRole(ROLE, w.deps);
  assert.deepEqual([r.status, r.tries], ["Resume ready", 2]);
});

test("tailorRoles stops at the first sign that Claude isn't answering: that role and the rest stay New", async () => {
  const roles = ["https://example.com/jobs/1", "https://example.com/jobs/2", "https://example.com/jobs/3"].map((l, i) => ({ link: l, title: `Role ${i + 1}`, company: "Acme" }));
  let calls = 0;
  const deps = { ...world({ resumes: [jordan], checks: [allSupported] }).deps, claude: () => { calls++; return down; } };
  const results = [];
  const r = await tailorRoles(roles, deps, { onResult: (role, res) => results.push([role.link, res.status]) });
  assert.equal(calls, 1, "the second and third roles weren't tried");
  assert.deepEqual(results, [], "no Status is set for any of them");
  assert.deepEqual(r.stopped, { link: roles[0].link, error: "success (exit 1)", left: 3 });
});

test("tailorRoles writes up to `limit` roles at once", async () => {
  const roles = [1, 2, 3, 4].map((i) => ({ link: `https://example.com/jobs/${i}`, title: `Role ${i}`, company: "Acme" }));
  let running = 0, most = 0;
  const deps = { ...world({ resumes: [null], checks: [] }).deps,
    claude: async () => { running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 10)); running--; return { ok: true, result: "RESULT: could not tailor" }; } };
  const results = [];
  const r = await tailorRoles(roles, deps, { limit: 3, onResult: (role, res) => results.push(res.status) });
  assert.equal(most, 3);
  assert.deepEqual(results, ["Could not tailor", "Could not tailor", "Could not tailor", "Could not tailor"]);
  assert.equal(r.stopped, null);
});

test("tailorRoles goes through every role while Claude answers", async () => {
  const roles = [{ ...ROLE }, { ...ROLE, link: "https://example.com/jobs/other" }];
  const w = world({ resumes: [jordan], checks: [allSupported] });
  const results = [];
  const r = await tailorRoles(roles, w.deps, { onResult: (role, res) => results.push(res.status) });
  assert.equal(r.stopped, null);
  assert.equal(results.length, 2);
});

test("job-pull: roles go through tailorRoles, a stop leaves them New with one plain log line, and later Claude steps wait", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.match(src, /await tailorRoles\(/, "the run uses tailorRoles");
  assert.doesNotMatch(src, /for \(const row of waiting\)/, "no loop of its own that would keep going");
  // One line for the whole run, the first time a step comes back unavailable; never an alert per step.
  // Both step runners (blocking and side-by-side) go through the same bookkeeping.
  assert.match(src, /function claudeStep\([^)]*\) \{\s*return noteStep\(step, runClaude\(/);
  assert.match(src, /async function claudeStepAsync\([^)]*\) \{[\s\S]{0,240}return noteStep\(step, r\);/);
  const step = src.slice(src.indexOf("function noteStep("), src.indexOf("\n}\n", src.indexOf("function noteStep(")));
  assert.match(step, /r\.unavailable/);
  assert.match(step, /if \(!claudeDown\)/);
  assert.match(src, /Claude isn't answering \(\$\{[^}]+\}\)\. Roles waiting for a resume stay New and are tried next run\./);
  // Once Claude is down, no more roles, no trimming (the role goes back to New) and no scout (it stays due).
  assert.match(src, /claudeDown \? \[\] : waiting/);
  const build = src.slice(src.indexOf("async function buildResume("), src.indexOf("\n}\n", src.indexOf("async function buildResume(")));
  assert.match(build, /claudeDown[\s\S]*safeStatus\(link, "New"\)/);
  const scout = src.slice(src.indexOf("function scoutIfDue("), src.indexOf("\n}\n", src.indexOf("function scoutIfDue(")));
  assert.match(scout, /if \(claudeDown\) return;/);
  assert.match(scout, /if \(r\.unavailable\) return;/);
  assert.ok(scout.indexOf("if (r.unavailable) return;") < scout.indexOf("writeAtomic(SCOUT_FILE"), "a scout that couldn't run isn't recorded as done");
});
