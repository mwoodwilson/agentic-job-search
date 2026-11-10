// Writer + checker loop for one role:
//   1. tailor-resume writes the resume into the role's own draft file (data/drafts/<id>.md; Claude can edit only that file)
//   2. code checks the rules (check-resume.mjs)
//   3. check-resume fact-checks every bullet (a separate Claude run, can write only its JSON);
//      code confirms each quoted source line really exists, and recomputes keyword coverage
//   4. any problem goes back to the writer to revise; after 3 tries the role needs your review.
// Each role has its own draft, so up to 3 roles are written at once (tailorRoles). The caller files the returned
// section in outputs/tailored-resumes.md (mergeSection) and deletes the draft.
// If Claude itself isn't answering (a run fails without doing any work: not signed in, a usage limit, no network),
// the role stays "New" (claudeDown in the result) and tailorRoles starts no more roles, so the next run tries again.
// Claude never sets the Status; the caller does, from the returned status.
import { createHash } from "node:crypto";
import { checkResume, verifyCheck, parseSection } from "./check-resume.mjs";
import { editRule } from "./claude.mjs";
import { mapLimit } from "./pool.mjs";

export const MAX_TRIES = 3;
const idFor = (link) => createHash("sha1").update(link).digest("hex").slice(0, 12);
export const checkPathFor = (link) => `data/checks/${idFor(link)}.json`;
export const draftPathFor = (link) => `data/drafts/${idFor(link)}.md`;
export const sectionFor = (link, tailoredText) =>
  String(tailoredText).split(/\n---\n/).find((sec) => parseSection(sec).link === link && !/^Version: short/m.test(sec)) || null;

// Files a finished resume in outputs/tailored-resumes.md: newest first, directly under the intro. A role's earlier
// copy is replaced (a resume rechecked after a crash), except with --retailor (fresh), where the old one stays as history.
export function mergeSection(tailoredText, section, { link, fresh = false } = {}) {
  const chunks = String(tailoredText).split(/\n---\n/);
  const sec = `\n${String(section).replace(/^\s*---\s*\n/, "").trim()}\n`;
  const at = fresh ? -1 : chunks.findIndex((c, i) => i > 0 && parseSection(c).link === link && !/^Version: short/m.test(c));
  if (at > 0) chunks[at] = sec;
  else chunks.splice(1, 0, sec);
  return chunks.join("\n---\n");
}

const RESULT_LINE = 'End your reply with one line: "RESULT: saved" or "RESULT: could not tailor".';

// deps: claude(step, prompt, writes) → { ok, result, error, unavailable } (or a promise of it); readTailored() → text;
// readDraft(link) → the role's draft text ("" if none); writeDraft(link, text); readSources(link) → { file: text };
// readCheck(path) → parsed JSON or null; clearCheck(path); rules: the resume settings (settings.resume) for checkResume.
// writerFiles(link) / checkerFiles(link, section): file contents put at the top of the prompt, so the runs don't spend
// turns opening them (and share a cached prefix).
// role.fresh (--retailor): write a new resume even though one exists; the old one stays as history and is
// never checked or passed off as the new one.
// Returns { status, tries, problems, section }: section is the resume to file ("Resume ready" or "Needs review").
export async function tailorRole(role, deps) {
  const { claude, readTailored, readDraft, writeDraft, readSources, readCheck, clearCheck = () => {}, rules = {},
    writerFiles = () => "", checkerFiles = () => "" } = deps;
  const { link, title, company, fresh = false } = role;
  const draft = draftPathFor(link);
  const current = () => sectionFor(link, readDraft(link));
  // A resume a crashed run already filed is checked, not rewritten (never on --retailor: that one is history).
  if (!current() && !fresh) { const filed = sectionFor(link, readTailored()); if (filed) writeDraft(link, filed); }
  const withFiles = (files, prompt) => (files ? `${files}\n\n${prompt}` : prompt);
  const name = `${title} | ${company}`;
  // Claude isn't answering: nothing is wrong with the role, so it stays "New" for the next run.
  const down = (tries, r) => ({ status: "New", tries, problems: [], claudeDown: true, error: r.error, section: null });
  let problems = [];
  let write = !current(); // a draft left by a crashed run is checked, not rewritten
  for (let tries = 1; tries <= MAX_TRIES; tries++) {
    if (write) {
      const prompt = current()
        ? `Use the tailor-resume skill to revise the resume for ${link}, which is the draft in ${draft}. Fix only these problems and keep everything else; update its Keywords line, coverage count and Sources line to match:\n- ${problems.join("\n- ")}\nSave your changes to ${draft} only. ${RESULT_LINE}`
        : `Use the tailor-resume skill on the role with this link only: ${link}. Save the resume as the only section of the draft file ${draft} (create it with the Write tool), not in outputs/tailored-resumes.md: the script files it there after the checks. ${RESULT_LINE}`;
      const w = await claude(`Tailoring ${name} (try ${tries})…`, withFiles(writerFiles(link), prompt), [editRule(draft)]);
      // A run can report an error and still have saved the resume; whatever was saved gets checked below.
      if (!w.ok && !current() && w.unavailable) return down(tries, w);
      if (!w.ok && !current()) { problems = [`The tailor-resume run failed: ${w.error}`]; continue; }
      if (!current()) {
        if (/RESULT:\s*could not tailor/i.test(w.result)) return { status: "Could not tailor", tries, problems: [], section: null };
        problems = [`No resume with this link was saved in ${draft}`];
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
      const run = await claude(
        `Fact-checking ${name} (check-resume${c > 1 ? ", retry" : ""})…`,
        withFiles(checkerFiles(link, sec), `Use the check-resume skill on the resume for ${link}, which is in ${draft}. Keywords to confirm: ${code.softMisses.length ? code.softMisses.join("; ") : "none"}. Write the JSON to ${checkPath}. Include an entry for every summary sentence and every bullet.`),
        [editRule(checkPath)]
      );
      if (run?.unavailable) return down(tries, run);
      check = readCheck(checkPath);
      v = check ? verifyCheck(check, sec, readSources(link)) : null;
    }
    if (!check || skipped(v)) {
      return { status: "Needs review", tries, section: sec, problems: [`The fact-check didn't finish after 2 runs (${check ? "it skipped lines" : "no result"}); the resume wasn't fully checked`] };
    }
    const confirmed = new Set((check?.keywords || []).map((k) => k.keyword).filter((k) => !v.unconfirmed.includes(k)));
    const missing = code.softMisses.filter((k) => !confirmed.has(k));
    const verified = code.ticks - missing.length;
    const cov = code.total && verified / code.total < 0.7
      ? [`Only ${verified}/${code.total} keywords are really in the resume (not found: ${missing.join(", ")}); at least 70% is required`]
      : [];
    problems = [...code.problems, ...v.problems, ...cov];
    if (!problems.length) return { status: "Resume ready", tries, problems: [], section: sec };
  }
  return { status: "Needs review", tries: MAX_TRIES, problems, section: current() };
}

// Every waiting role, up to `limit` at once, with onResult(role, result) as each one finishes (the caller sets its
// Status). Once a role finds Claude isn't answering, no more roles start; that role, any other role that hits it, and
// the ones not started keep their Status ("New").
// Returns { stopped: null } or { stopped: { link, error, left } }, left being how many roles weren't done.
export async function tailorRoles(roles, deps, { onResult = () => {}, limit = 1 } = {}) {
  let stopped = null, done = 0;
  const results = await mapLimit(roles, limit, async (role) => {
    if (stopped) return;
    const res = await tailorRole(role, deps);
    if (res.claudeDown) { stopped ??= { link: role.link, error: res.error }; return; }
    done++;
    await onResult(role, res);
  });
  const failed = results.find((r) => r instanceof Error);
  if (failed) throw failed;
  return { stopped: stopped ? { ...stopped, left: roles.length - done } : null };
}
