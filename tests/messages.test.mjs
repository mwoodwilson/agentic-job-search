// What the run sends (text and email): the job list (Numbers), finished resumes, and fixed lines. Nothing else.
// Everything is off until it is turned on in the settings (notifications). Problems (failed steps, broken boards,
// scout and repair proposals) go to workflow-log.md only.
// These tests never send a message, open an app or touch iCloud: sending is stubbed or the function is pure.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { notifyTargets, runMessage, notifyRun, numbersOnly, runSummary, unsentAlert, NO_MATCHES, SHEET_UPDATED, SHEET_OFF } from "../scripts/job-pull.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { filledSettings } from "./helpers.mjs";

const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
const PHONE = "+15550100199";
const EMAIL = "jordan@example.com";

const settingsWith = (notifications) => withDefaults({ ...filledSettings(), notifications });
const tmp = () => mkdtempSync(join(tmpdir(), "ajs-msg-"));

// ---- which notifications are on ----

test("nothing is sent by default", () => {
  assert.deepEqual(notifyTargets(withDefaults(filledSettings())), { imessage: null, email: null, numbers: false, everyRun: false });
});

test("the text after every run is on only with iMessage on and everyRun true", () => {
  assert.equal(notifyTargets(settingsWith({ imessage: { enabled: true, to: PHONE } })).everyRun, false, "off by default");
  assert.equal(notifyTargets(settingsWith({ imessage: { enabled: true, to: PHONE, everyRun: true } })).everyRun, true);
  assert.equal(notifyTargets(settingsWith({ imessage: { enabled: false, to: PHONE, everyRun: true } })).everyRun, false, "iMessage off: no text at all");
});

test("only what is turned on is used", () => {
  assert.deepEqual(notifyTargets(settingsWith({ imessage: { enabled: true, to: PHONE } })), { imessage: PHONE, email: null, numbers: false, everyRun: false });
  assert.deepEqual(notifyTargets(settingsWith({ email: { enabled: true, to: EMAIL } })), { imessage: null, email: EMAIL, numbers: false, everyRun: false });
  assert.deepEqual(notifyTargets(settingsWith({ numbers: { enabled: true } })), { imessage: null, email: null, numbers: true, everyRun: false });
  assert.deepEqual(
    notifyTargets(settingsWith({ imessage: { enabled: true, to: PHONE }, email: { enabled: true, to: EMAIL }, numbers: { enabled: true } })),
    { imessage: PHONE, email: EMAIL, numbers: true, everyRun: false },
  );
});

test("an address that is filled in but turned off is not used; turned on with no address is not used either", () => {
  assert.deepEqual(notifyTargets(settingsWith({ imessage: { enabled: false, to: PHONE }, email: { enabled: false, to: EMAIL } })), { imessage: null, email: null, numbers: false, everyRun: false });
  assert.deepEqual(notifyTargets(settingsWith({ imessage: { enabled: true, to: "  " }, email: { enabled: true, to: "" } })), { imessage: null, email: null, numbers: false, everyRun: false });
});

// ---- the lines ----

test("message lines", () => {
  assert.equal(runMessage({ resumes: 2, sheet: true }), "Job search: 2 new resumes ready. The job list is attached.");
  assert.equal(runMessage({ resumes: 1 }), "Job search: 1 new resume ready.");
  assert.equal(runMessage({ newRoles: 3, sheet: true }), "Job search: 3 new roles added, no resumes created. The job list is attached.");
  assert.equal(runMessage({}), null);
});

test("message lines: one role, and the same lines without the job list", () => {
  assert.equal(runMessage({ newRoles: 1 }), "Job search: 1 new role added, no resumes created.");
  assert.equal(runMessage({ resumes: 2, newRoles: 5, sheet: false }), "Job search: 2 new resumes ready.");
  assert.equal(runMessage({ resumes: 0, newRoles: 0, sheet: true }), null, "nothing new: no message, even with the sheet on");
});

// With everyRun on, a run with nothing new texts this fixed line, with no attachments.
test("the every-run text is a fixed line", () => {
  assert.equal(NO_MATCHES, "Run complete: no matching roles were found.");
});

// ---- the run's messages (sending is stubbed) ----

// A fake world: a stage folder, a sheet file, a sent log, two finished resumes, and stand-ins for Messages and Mail.
function world({ imessageOk = true, emailOk = true } = {}) {
  const dir = tmp();
  const sheetFile = join(dir, "Agentic Job Search.numbers");
  writeFileSync(sheetFile, "sheet");
  const docs = ["One", "Two"].map((n, i) => {
    const pdf = join(dir, `Resume ${n}.pdf`);
    writeFileSync(pdf, `pdf ${n}`);
    return { url: `https://jobs.example.com/${i + 1}`, title: `Role ${n}, Acme`, markdown: `### Professional Summary\nSummary ${n}.`, pdf, pages: 1 };
  });
  const calls = { texts: [], emails: [], logs: [] };
  const io = {
    sendIMessage: (to, text, files = []) => { calls.texts.push({ to, text, files }); return imessageOk; },
    sendEmail: (to, subject, body, files = []) => { calls.emails.push({ to, subject, body, files }); return emailOk; },
    logEvent: (kind, text) => calls.logs.push({ kind, text }),
  };
  const opts = { io, stageDir: join(dir, "stage"), sentFile: join(dir, "sent-log.json"), sheetFile };
  return { dir, docs, calls, opts };
}
const off = { imessage: null, email: null, numbers: false, everyRun: false };
const base = (name) => name.split("/").pop();

test("all notifications off: a run with news sends nothing and stages nothing", async () => {
  const w = world();
  const r = await notifyRun({ targets: off, resumeDocs: w.docs, newRoles: 3, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
  assert.equal(r.resumesSent, 0);
  assert.equal(existsSync(w.opts.stageDir), false, "no files were copied for attachments");
  assert.equal(existsSync(w.opts.sentFile), false, "nothing was marked as sent");
});

test("all notifications off: a run with nothing new sends nothing", async () => {
  const w = world();
  await notifyRun({ targets: off, resumeDocs: [], newRoles: 0, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
});

test("iMessage on with everyRun, nothing new: the no-matching-roles text, no files, no email", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, imessage: PHONE, everyRun: true }, resumeDocs: [], newRoles: 0, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls.texts, [{ to: PHONE, text: NO_MATCHES, files: [] }]);
  assert.deepEqual(w.calls.emails, []);
});

test("iMessage on without everyRun (the default), nothing new: no text at all", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, imessage: PHONE }, resumeDocs: [], newRoles: 0, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
  await notifyRun({ targets: { ...off, imessage: PHONE, numbers: true }, resumeDocs: [], newRoles: 0, numbersOk: true, ...w.opts });
  assert.deepEqual(w.calls.texts, [], "not with the sheet on either");
});

test("email only, nothing new: nothing is sent (email goes only when there is news)", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, email: EMAIL }, resumeDocs: [], newRoles: 0, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
});

test("iMessage only, with resumes: one text with just the resume PDFs (no sheet), marked as sent", async () => {
  const w = world();
  const r = await notifyRun({ targets: { ...off, imessage: PHONE }, resumeDocs: w.docs, newRoles: 2, numbersOk: false, ...w.opts });
  assert.equal(w.calls.texts.length, 1);
  const [t] = w.calls.texts;
  assert.equal(t.to, PHONE);
  assert.equal(t.text, "Job search: 2 new resumes ready.");
  assert.deepEqual(t.files.map(base), ["Resume One.pdf", "Resume Two.pdf"]);
  assert.ok(t.files.every((f) => f.startsWith(w.opts.stageDir)), "attachments are copies in the stage folder");
  assert.deepEqual(readdirSync(w.opts.stageDir).sort(), ["Resume One.pdf", "Resume Two.pdf"], "the sheet was not copied");
  assert.equal(r.resumesSent, 2);
  assert.equal(Object.keys(JSON.parse(readFileSync(w.opts.sentFile, "utf8"))).length, 2);
  assert.deepEqual(w.calls.emails, []);
});

test("iMessage and Numbers, new roles but no resumes: the job list is attached", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, imessage: PHONE, numbers: true }, resumeDocs: [], newRoles: 3, numbersOk: true, ...w.opts });
  assert.equal(w.calls.texts.length, 1);
  const [t] = w.calls.texts;
  assert.equal(t.text, "Job search: 3 new roles added, no resumes created. The job list is attached.");
  assert.deepEqual(t.files, [join(w.opts.stageDir, "Agentic Job Search.numbers")]);
  assert.equal(readFileSync(t.files[0], "utf8"), "sheet");
});

test("Numbers on but the sheet didn't update: a run with news sends nothing (it goes with the next run); the every-run text still goes", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, imessage: PHONE, email: EMAIL, numbers: true, everyRun: true }, resumeDocs: w.docs, newRoles: 2, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
  await notifyRun({ targets: { ...off, imessage: PHONE, email: EMAIL, numbers: true, everyRun: true }, resumeDocs: [], newRoles: 0, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls.texts, [{ to: PHONE, text: NO_MATCHES, files: [] }]);
  assert.deepEqual(w.calls.emails, []);
});

test("email only, new roles: one email with the fixed line and no attachment", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, email: EMAIL }, resumeDocs: [], newRoles: 3, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls.texts, []);
  assert.deepEqual(w.calls.emails, [{ to: EMAIL, subject: "Job search", body: "Job search: 3 new roles added, no resumes created.", files: [] }]);
});

test("email and Numbers, with resumes: the line with the sheet, then one email per resume", async () => {
  const w = world();
  await notifyRun({ targets: { ...off, email: EMAIL, numbers: true }, resumeDocs: w.docs, newRoles: 2, numbersOk: true, ...w.opts });
  const [summary, ...each] = w.calls.emails;
  assert.equal(summary.body, "Job search: 2 new resumes ready. The job list is attached.");
  assert.deepEqual(summary.files, [join(w.opts.stageDir, "Agentic Job Search.numbers")]);
  assert.deepEqual(each.map((e) => e.subject), ["Resume: Role One, Acme", "Resume: Role Two, Acme"]);
  assert.deepEqual(each.map((e) => e.files.map(base)), [["Resume One.pdf"], ["Resume Two.pdf"]]);
  assert.ok(each.every((e) => e.to === EMAIL));
  assert.deepEqual(w.calls.texts, []);
});

test("resumes that went out by email only still count as sent", async () => {
  const w = world();
  const r = await notifyRun({ targets: { ...off, email: EMAIL }, resumeDocs: w.docs, newRoles: 2, numbersOk: false, ...w.opts });
  assert.equal(r.resumesSent, 2);
});

// A resume whose text went out but whose email failed is re-queued for email the next run. That run has a resume
// (so it has news) but nothing new to text: it must not fall back to the every-run line, which only everyRun sends.
test("text and email on, a resume already texted whose email failed: the retry run sends no text (everyRun off)", async () => {
  const w = world({ emailOk: false });
  const targets = { ...off, imessage: PHONE, email: EMAIL };
  await notifyRun({ targets, resumeDocs: [w.docs[0]], newRoles: 1, numbersOk: false, ...w.opts });
  assert.equal(w.calls.texts.length, 1, "the first run texts the resume");
  w.calls.texts.length = 0;
  w.calls.emails.length = 0;
  // The next run re-queues it for email; nothing new otherwise.
  await notifyRun({ targets, resumeDocs: [w.docs[0]], newRoles: 0, numbersOk: false, ...w.opts });
  assert.deepEqual(w.calls.texts, [], "no text: no 'no matching roles' line, no empty line");
  assert.deepEqual(w.calls.emails.map((e) => e.subject), ["Job search", "Resume: Role One, Acme"], "the email is retried");
});

test("the every-run line is sent only from the nothing-new branch, never as a fallback", () => {
  const sends = [...src.matchAll(/io\.sendIMessage\(targets\.imessage, NO_MATCHES/g)];
  assert.equal(sends.length, 1);
  const fn = src.slice(src.indexOf("async function notifyRun("), src.indexOf("\n}\n", src.indexOf("async function notifyRun(")));
  assert.equal((fn.match(/NO_MATCHES/g) || []).length, 2, "only in the !news && everyRun branch (its send and its log line)");
  assert.doesNotMatch(src, /function runText\(/, "no helper that falls back to it");
});

test("a text that fails to send is logged, and its resumes are not marked as sent", async () => {
  const w = world({ imessageOk: false });
  const r = await notifyRun({ targets: { ...off, imessage: PHONE }, resumeDocs: w.docs, newRoles: 2, numbersOk: false, ...w.opts });
  assert.equal(r.resumesSent, 0);
  assert.equal(w.calls.logs.length, 1);
  assert.equal(w.calls.logs[0].kind, "failure");
  assert.equal(existsSync(w.opts.sentFile), false);
});

// ---- the run's log line and alerts when nothing is set up to send ----

test("with no notification on, a built resume is not called 'not sent' and raises no alert", () => {
  assert.equal(runSummary({ added: 0, built: 2, sent: 0, notify: false }), "0 new roles, 2 resumes built");
  assert.equal(runSummary({ added: 1, built: 1, sent: 0, notify: false, held: 1 }), "1 new role, 1 resume built, 1 held for review");
  assert.equal(unsentAlert({ built: 2, sent: 0, notify: false }), null);
});

test("with a notification on, a resume built but not sent is still called out", () => {
  assert.equal(runSummary({ added: 0, built: 2, sent: 0 }), "0 new roles, 2 resumes built but not sent");
  assert.equal(runSummary({ added: 2, built: 1, sent: 1, notify: true }), "2 new roles, 1 resume sent");
  assert.equal(unsentAlert({ built: 2, sent: 0, notify: true }), "2 resume(s) were built but didn't go out; they'll be sent next run.");
  assert.equal(unsentAlert({ built: 2, sent: 2, notify: true }), null);
});

test("ready resumes that didn't go out are re-queued for each channel that is on: text and email", () => {
  assert.match(src, /resumesToRetry\(getRows\(\), \{ channels: \{ "resume-text": !!TARGETS\.imessage, "resume-email": !!TARGETS\.email \}, builtNow: \[\.\.\.passed\]/);
  assert.doesNotMatch(src, /if \(TARGETS\.imessage\) for \(const l of pendingResumes\(/);
});

// ---- --numbers ----

test("--numbers with the sheet off: says so and does nothing else", async () => {
  assert.equal(SHEET_OFF, "The Numbers sheet is off (notifications.numbers.enabled in config/preferences.json).");
  const w = world();
  const sync = mock.fn(async () => true);
  const log = mock.method(console, "log", () => {});
  try {
    await numbersOnly({ targets: { ...off, imessage: PHONE }, syncNumbers: sync, ...w.opts });
    assert.deepEqual(log.mock.calls.map((c) => c.arguments[0]), [SHEET_OFF]);
  } finally { log.mock.restore(); }
  assert.equal(sync.mock.callCount(), 0, "Numbers was not touched");
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
});

test("--numbers with the sheet on and iMessage off: syncs and sends nothing", async () => {
  const w = world();
  const sync = mock.fn(async () => true);
  await numbersOnly({ targets: { ...off, numbers: true }, syncNumbers: sync, ...w.opts });
  assert.equal(sync.mock.callCount(), 1);
  assert.deepEqual(w.calls, { texts: [], emails: [], logs: [] });
});

test("--numbers with the sheet and iMessage on: texts the updated sheet", async () => {
  const w = world();
  await numbersOnly({ targets: { ...off, imessage: PHONE, numbers: true }, syncNumbers: async () => true, ...w.opts });
  assert.deepEqual(w.calls.texts, [{ to: PHONE, text: SHEET_UPDATED, files: [join(w.opts.stageDir, "Agentic Job Search.numbers")] }]);
});

test("--numbers when the sync fails: no text", async () => {
  const w = world();
  await numbersOnly({ targets: { ...off, imessage: PHONE, numbers: true }, syncNumbers: async () => false, ...w.opts });
  assert.deepEqual(w.calls.texts, []);
});

// ---- what the code is allowed to send ----

test("every text sends only the run's line, the no-matches line or the --numbers line", () => {
  const calls = [...src.matchAll(/io\.sendIMessage\(([^\n]*)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3, "the no-matches text, the run's text and the --numbers text");
  for (const a of calls) assert.match(a, /^targets\.imessage, (NO_MATCHES|text|SHEET_UPDATED), /, `unexpected text: io.sendIMessage(${a}`);
});

test("every email is the run's line (with the sheet only when it's on), or one finished resume", () => {
  const calls = [...src.matchAll(/io\.sendEmail\(([^\n]*)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2);
  for (const a of calls) assert.match(a, /^targets\.email, ("Job search", text, sheet \? \[sheet\] : \[\]|`Resume: \$\{r\.title\}`)/, `unexpected email: io.sendEmail(${a}`);
});

test("the Numbers sync runs only when notifications.numbers is on", () => {
  const calls = src.split("\n").filter((l) => /\bsyncNumbers\(\)/.test(l) && !/^\s*(async )?function /.test(l) && !/^\s*\/\//.test(l));
  assert.ok(calls.length >= 2, "the run and the backlog catch-up");
  for (const l of calls) assert.match(l, /targets\.numbers/i, `ungated sync: ${l.trim()}`);
});

test("Messages and Mail attachments are staged in ~/Pictures/agentic-job-search, and the sheet has its own name", () => {
  assert.match(src, /"Pictures", "agentic-job-search"/);
  assert.doesNotMatch(src, /"job-pull"/, "no folder named job-pull");
  assert.match(src, /const NUMBERS_FILE = join\(homedir\(\), "Library\/Mobile Documents\/com~apple~Numbers\/Documents\/Agentic Job Search\.numbers"\);/);
});

test("alerts are logged, never sent; no Mac notifications; no scout text", () => {
  const fn = src.slice(src.indexOf("function logAlerts("), src.indexOf("\n}\n", src.indexOf("function logAlerts(")));
  assert.ok(fn.length > 0, "logAlerts exists");
  assert.doesNotMatch(fn, /sendIMessage|sendEmail/);
  assert.doesNotMatch(src, /sendAlerts|notifyMac|Job search ⚠|weekly scout/);
});
