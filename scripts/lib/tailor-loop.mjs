// Writer + checker loop for one role:
//   1. tailor-resume writes the resume (Claude, can edit only outputs/tailored-resumes.md)
//   2. code checks the rules (check-resume.mjs)
//   3. check-resume fact-checks every bullet (a separate Claude run, can write only its JSON);
//      code confirms each quoted source line really exists, and recomputes keyword coverage
//   4. any problem goes back to the writer to revise; after 3 tries the role needs your review.
// If Claude itself isn't answering (a run fails without doing any work: not signed in, a usage limit, no network),
// the role stays "New" (claudeDown in the result) and tailorRoles stops, so the next run tries again.
// Claude never sets the Status; the caller does, from the returned status.
import { createHash } from "node:crypto";
import { checkResume, verifyCheck, parseSection } from "./check-resume.mjs";
import { editRule } from "./claude.mjs";

export const MAX_TRIES = 3;
export const checkPathFor = (link) => `data/checks/${createHash("sha1").update(link).digest("hex").slice(0, 12)}.json`;
export const sectionFor = (link, tailoredText) =>
  String(tailoredText).split(/\n---\n/).find((sec) => parseSection(sec).link === link && !/^Version: short/m.test(sec)) || null;

const RESULT_LINE = 'End your reply with one line: "RESULT: saved" or "RESULT: could not tailor".';

// deps: claude(step, prompt, writes) → { ok, result, error, unavailable }; readTailored() → text; readSources() → { file: text };
// readCheck(path) → parsed JSON or null; clearCheck(path); rules: the resume settings (settings.resume) for checkResume.
// writeTailored(text) restores the file when the writer changed other resumes.
// role.fresh (--retailor): write a new resume even though one exists; the old one stays as history and is
// never checked or passed off as the new one.
export async function tailorRole(role, { claude, readTailored, writeTailored, readSources, readCheck, clearCheck = () => {}, rules = {} }) {
  const { link, title, company, fresh = false } = role;
  const baseline = fresh ? sectionFor(link, readTailored()) : null;
  // This role's resume as it stands, ignoring the old one on a fresh run until a new one is saved.
  const current = () => { const sec = sectionFor(link, readTailored()); return fresh && sec === baseline ? null : sec; };
  // Everything in the file except this role's section, to confirm the writer touched nothing else.
  const others = (text) => String(text).split(/\n---\n/).filter((sec) => parseSection(sec).link !== link).map((x) => x.trim()).join("\n---\n");
  const name = `${title} | ${company}`;
  // Claude isn't answering: nothing is wrong with the role, so it stays "New" for the next run.
  const down = (tries, r) => ({ status: "New", tries, problems: [], claudeDown: true, error: r.error });
  let problems = [];
  let write = !current(); // a resume saved by a crashed run is checked, not rewritten
  for (let tries = 1; tries <= MAX_TRIES; tries++) {
    if (write) {
      const prompt = current()
        ? `Use the tailor-resume skill to revise the resume for ${link} in outputs/tailored-resumes.md. Fix only these problems and keep everything else; update its Keywords line, coverage count and Sources line to match:\n- ${problems.join("\n- ")}\n${RESULT_LINE}`
        : `Use the tailor-resume skill on the role with this link only: ${link}. ${RESULT_LINE}`;
      const before = readTailored();
      const w = claude(`Tailoring ${name} (try ${tries})…`, prompt, [editRule("outputs/tailored-resumes.md")]);
      if (others(readTailored()) !== others(before)) {
        writeTailored?.(before); // its edit is undone: the writer may change only this role's resume
        problems = ["Last time you changed other resumes in outputs/tailored-resumes.md, so your edit was undone. Change only this role's section."];
        continue;
      }
      // A run can report an error and still have saved the resume; whatever was saved gets checked below.
      if (!w.ok && !current() && w.unavailable) return down(tries, w);
      if (!w.ok && !current()) { problems = [`The tailor-resume run failed: ${w.error}`]; continue; }
      if (!current()) {
        if (/RESULT:\s*could not tailor/i.test(w.result)) return { status: "Could not tailor", tries, problems: [] };
        problems = [fresh ? "No new resume with this link was saved in outputs/tailored-resumes.md (add a new section; keep the old one)" : "No resume with this link was saved in outputs/tailored-resumes.md"];
        continue;
      }
    }
    write = true;
    const sec = current();
    const code = checkResume(sec, { rules });
    // Rule problems go straight back to the writer; the paid fact-check waits for a version that passes them.
    if (code.problems.length) { problems = code.problems; continue; }
    // The fact-check. If it fails itself (no result, or lines it skipped), it is rerun once; those are the
    // checker's problems, so they never go to the writer.
    const checkPath = checkPathFor(link);
    const skipped = (x) => x.problems.some((p) => p.startsWith("Line not checked"));
    let check = null, v = null;
    for (let c = 1; c <= 2 && !(check && !skipped(v)); c++) {
      clearCheck(checkPath);
      const run = claude(
        `Fact-checking ${name} (check-resume${c > 1 ? ", retry" : ""})…`,
        `Use the check-resume skill on the resume for ${link}. Keywords to confirm: ${code.softMisses.length ? code.softMisses.join("; ") : "none"}. Write the JSON to ${checkPath}. Include an entry for every summary sentence and every bullet.`,
        [editRule(checkPath)]
      );
      if (run?.unavailable) return down(tries, run);
      check = readCheck(checkPath);
      v = check ? verifyCheck(check, sec, readSources(link)) : null;
    }
    if (!check || skipped(v)) {
      return { status: "Needs review", tries, problems: [`The fact-check didn't finish after 2 runs (${check ? "it skipped lines" : "no result"}); the resume wasn't fully checked`] };
    }
    const confirmed = new Set((check?.keywords || []).map((k) => k.keyword).filter((k) => !v.unconfirmed.includes(k)));
    const missing = code.softMisses.filter((k) => !confirmed.has(k));
    const verified = code.ticks - missing.length;
    const cov = code.total && verified / code.total < 0.7
      ? [`Only ${verified}/${code.total} keywords are really in the resume (not found: ${missing.join(", ")}); at least 70% is required`]
      : [];
    problems = [...code.problems, ...v.problems, ...cov];
    if (!problems.length) return { status: "Resume ready", tries, problems: [] };
  }
  return { status: "Needs review", tries: MAX_TRIES, problems };
}

// Every waiting role, one at a time, with onResult(role, result) for each finished one (the caller sets its Status).
// Stops at the first role where Claude isn't answering: that role and the rest keep their Status ("New").
// Returns { stopped: null } or { stopped: { link, error, left } }, left being how many roles weren't done.
export async function tailorRoles(roles, deps, { onResult = () => {} } = {}) {
  for (let i = 0; i < roles.length; i++) {
    const res = await tailorRole(roles[i], deps);
    if (res.claudeDown) return { stopped: { link: roles[i].link, error: res.error, left: roles.length - i } };
    await onResult(roles[i], res);
  }
  return { stopped: null };
}
