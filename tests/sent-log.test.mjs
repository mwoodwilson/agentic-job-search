import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { alreadySent, markSent, unsent } from "../scripts/lib/sent-log.mjs";

const file = () => join(mkdtempSync(join(tmpdir(), "sent-")), "sent-log.json");

test("a key is sent once", () => {
  const f = file();
  assert.equal(alreadySent("https://a/1|resume-text", { file: f }), false);
  markSent(["https://a/1|resume-text"], { file: f });
  assert.equal(alreadySent("https://a/1|resume-text", { file: f }), true);
  assert.equal(alreadySent("https://a/1|resume-email", { file: f }), false);
});

test("unsent keeps only items whose key for that channel wasn't sent", () => {
  const f = file();
  markSent(["https://a/1|text"], { file: f });
  const items = [{ url: "https://a/1" }, { url: "https://a/2" }];
  assert.deepEqual(unsent(items, "text", { file: f }).map((i) => i.url), ["https://a/2"]);
});

test("the log records when each key was sent", () => {
  const f = file();
  markSent(["k"], { file: f, when: "2026-11-04T13:00:00.000Z" });
  assert.equal(JSON.parse(readFileSync(f, "utf8")).k, "2026-11-04T13:00:00.000Z");
});

test("job-pull checks the sent log before each kind of send and records it after", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  for (const ch of ['"resume-email"', '"resume-text"']) assert.ok(src.includes(ch), `channel ${ch} not used`);
  assert.ok((src.match(/markSent\(/g) || []).length >= 2);
});

test("a resume marked ready but never sent (the run was cut short) is picked up again", async () => {
  const { pendingResumes, versionOf, sentKey } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  const sec = (n) => `## R${n} | Co\nLink: https://a/${n}\n\n### Professional Summary\nText ${n}.\n`;
  markSent([sentKey("https://a/1", "resume-text", versionOf(sec(1)))], { file: f });
  const rows = [
    { Status: "Resume ready", Link: "https://a/1" },
    { Status: "Resume ready", Link: "https://a/2" },
    { Status: "New", Link: "https://a/3" },
  ];
  assert.deepEqual(pendingResumes(rows, { file: f, sectionOf: (l) => sec(l.slice(-1)) }), ["https://a/2"]);
});

test("a re-tailored resume (new text) is sent again; a changed Keywords line alone is not", async () => {
  const { pendingResumes, versionOf, sentKey } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  const v1 = "## R | Co\nLink: https://a/1\nKeywords: ✓ a\n\n### Professional Summary\nOld summary.\n";
  markSent([sentKey("https://a/1", "resume-text", versionOf(v1))], { file: f });
  const rows = [{ Status: "Resume ready", Link: "https://a/1" }];
  assert.deepEqual(pendingResumes(rows, { file: f, sectionOf: () => v1.replace("✓ a", "✗ a") }), []);
  assert.deepEqual(pendingResumes(rows, { file: f, sectionOf: () => v1.replace("Old summary", "New summary") }), ["https://a/1"]);
});

test("your own finalized resume isn't re-sent when your edits are synced in", async () => {
  const { pendingResumes, sentKey } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  markSent([sentKey("https://a/1", "resume-text", "oldversion")], { file: f });
  const fin = "## R | Co\nLink: https://a/1\nFinal: you edited this\n\n### Professional Summary\nYour text.\n";
  assert.deepEqual(pendingResumes([{ Status: "Resume ready", Link: "https://a/1" }], { file: f, sectionOf: () => fin }), []);
});

test("a role texted as 'No resume' is texted again once it has a resume", async () => {
  const { sentKey } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  markSent([sentKey("https://a/1", "text", "new")], { file: f });
  const items = [{ url: "https://a/1" }];
  assert.deepEqual(unsent(items, "text", { file: f, version: () => "new" }), []);
  assert.deepEqual(unsent(items, "text", { file: f, version: () => "resume" }).map((i) => i.url), ["https://a/1"]);
});

test("job-pull sends ready resumes that didn't go out along with this run's", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  assert.match(src, /const earlier = resumesToRetry\(getRows\(\), \{[^\n]*sectionOf/);
  assert.match(src, /const deliveries = earlier\.map\(deliver\);/, "each one is built and sent like this run's");
});

test("a resume's version ignores the trailing --- divider, so both code paths agree and no false 'not sent' alert is raised", async () => {
  const { versionOf } = await import("../scripts/lib/sent-log.mjs");
  const sec = "## R | Co\nLink: https://a/1\n\n### Professional Summary\nText.\n\n### Skills\nA | B\n";
  assert.equal(versionOf(sec), versionOf(sec + "\n\n---\n\n"));
  assert.equal(versionOf(sec), versionOf(sec + "\n---\n\n## Next | Co\n### Professional Summary\nOther.\n"));
});

// ---- turning a channel on later, and resumes that didn't go out ----
// resumesToRetry: the ready resumes to send again this run, per channel that is on. A resume that was already ready
// when a channel was turned on is never sent on it; one made after, that didn't go out, is retried.
const section = (n) => `## Role ${n} | Acme\nLink: https://jobs.example.com/${n}\n\n### Professional Summary\nSummary ${n}.\n`;
const ready = (...ns) => ns.map((n) => ({ Status: "Resume ready", Link: `https://jobs.example.com/${n}` }));
const sectionOf = (link) => section(link.split("/").pop());
const TEXT_ON = { "resume-text": true, "resume-email": false };
const ALL_OFF = { "resume-text": false, "resume-email": false };

test("iMessage turned on later texts no old resume; a resume made after it was turned on, not yet sent, is retried", async () => {
  const { resumesToRetry } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  // Runs with iMessage off build resumes 1 and 2; nothing is texted.
  assert.deepEqual(resumesToRetry(ready(1, 2), { channels: ALL_OFF, builtNow: [1, 2].map((n) => `https://jobs.example.com/${n}`), sectionOf, file: f }), []);
  // iMessage turned on: the next run sends nothing old.
  assert.deepEqual(resumesToRetry(ready(1, 2), { channels: TEXT_ON, builtNow: [], sectionOf, file: f }), []);
  assert.deepEqual(resumesToRetry(ready(1, 2), { channels: TEXT_ON, builtNow: [], sectionOf, file: f }), [], "nor on the run after");
  // Resume 3 is built with iMessage on, and its text fails (nothing is marked): the next run retries it alone.
  assert.deepEqual(resumesToRetry(ready(1, 2, 3), { channels: TEXT_ON, builtNow: ["https://jobs.example.com/3"], sectionOf, file: f }), [], "this run sends it anyway");
  assert.deepEqual(resumesToRetry(ready(1, 2, 3), { channels: TEXT_ON, builtNow: [], sectionOf, file: f }), ["https://jobs.example.com/3"]);
});

// The channel is noted as on at the start of the run, before any resume is built. If the first run after turning it
// on stops after building a resume but before sending, that resume is still retried: it isn't taken for an old one.
test("a channel is noted as on at the start of the run, so a crash before sending can't make a new resume count as old", async () => {
  const { noteChannels, resumesToRetry } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  // First run with iMessage on: at its start, resume 1 (made while it was off) is the only ready one.
  noteChannels(ready(1), { channels: TEXT_ON, sectionOf, file: f });
  // It builds resume 2, then stops before sending (no resumesToRetry, nothing marked sent).
  // Next run, at its start, and after its tailoring:
  noteChannels(ready(1, 2), { channels: TEXT_ON, sectionOf, file: f });
  assert.deepEqual(resumesToRetry(ready(1, 2), { channels: TEXT_ON, builtNow: [], sectionOf, file: f }), ["https://jobs.example.com/2"]);
});

test("job-pull notes the channels at the start of the run, before any resume is built", () => {
  const src = readFileSync(new URL("../scripts/job-pull.mjs", import.meta.url), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const noted = main.indexOf("noteChannels(getRows(), {");
  assert.ok(noted > 0, "main calls noteChannels");
  assert.ok(noted < main.indexOf("tailorAll()"), "before tailoring");
  assert.ok(noted < main.indexOf('safeStatus(link, "New")'), "before --retailor puts a role back to New");
});

test("off, on, off, on: resumes made while it was off the second time aren't texted either", async () => {
  const { resumesToRetry } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  resumesToRetry(ready(1), { channels: TEXT_ON, builtNow: [], sectionOf, file: f });
  resumesToRetry(ready(1, 2), { channels: ALL_OFF, builtNow: ["https://jobs.example.com/2"], sectionOf, file: f });
  assert.deepEqual(resumesToRetry(ready(1, 2), { channels: TEXT_ON, builtNow: [], sectionOf, file: f }), []);
});

test("a re-tailored resume (new text) made after iMessage was turned on is sent", async () => {
  const { resumesToRetry } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  resumesToRetry(ready(1), { channels: TEXT_ON, builtNow: [], sectionOf, file: f });
  const changed = (link) => sectionOf(link).replace("Summary 1.", "A new summary.");
  assert.deepEqual(resumesToRetry(ready(1), { channels: TEXT_ON, builtNow: [], sectionOf: changed, file: f }), ["https://jobs.example.com/1"]);
});

test("email turned on later emails no old resume either", async () => {
  const { resumesToRetry } = await import("../scripts/lib/sent-log.mjs");
  const f = file();
  assert.deepEqual(resumesToRetry(ready(1, 2), { channels: { "resume-text": false, "resume-email": true }, builtNow: [], sectionOf, file: f }), []);
});

// Email on, iMessage off: each resume is emailed the moment it passes. One whose email failed must go out with a
// later run, as the log line says ("they'll be sent next run").
test("a resume whose email failed is emailed on the next run, then never again", async () => {
  const { resumesToRetry } = await import("../scripts/lib/sent-log.mjs");
  const { notifyResume, unsentAlert } = await import("../scripts/job-pull.mjs");
  const dir = mkdtempSync(join(tmpdir(), "email-retry-"));
  const sentFile = join(dir, "sent-log.json");
  const pdf = join(dir, "Resume 1.pdf");
  writeFileSync(pdf, "pdf");
  const doc = { url: "https://jobs.example.com/1", title: "Role 1, Acme", markdown: section(1), pdf, pages: 1 };
  const emails = [];
  let mailWorks = false;
  const io = { sendIMessage: () => assert.fail("iMessage is off"), sendEmail: (to, subject) => { emails.push(subject); return mailWorks; }, logEvent: () => {} };
  const targets = { imessage: null, email: "jordan@example.com", numbers: true, everyRun: false };
  const channels = { "resume-text": false, "resume-email": true };
  const opts = { io, stageDir: join(dir, "stage"), sentFile };

  // Run 1 builds resume 1; Mail fails, so it isn't marked as sent.
  assert.deepEqual(resumesToRetry(ready(1), { channels, builtNow: [doc.url], sectionOf, file: sentFile }), []);
  const first = await notifyResume({ targets, doc, ...opts });
  assert.equal(first.sent, false);
  assert.equal(unsentAlert({ built: 1, sent: 0, notify: true }), "1 resume(s) were built but didn't go out; they'll be sent next run.");
  // Run 2 builds nothing new, but re-queues resume 1, and Mail works: it is emailed.
  mailWorks = true;
  assert.deepEqual(resumesToRetry(ready(1), { channels, builtNow: [], sectionOf, file: sentFile }), [doc.url]);
  const second = await notifyResume({ targets, doc, ...opts });
  assert.equal(second.sent, true);
  assert.deepEqual(emails, ["Resume: Role 1, Acme", "Resume: Role 1, Acme"]);
  // Run 3: it went out, so it isn't sent again.
  assert.deepEqual(resumesToRetry(ready(1), { channels, builtNow: [], sectionOf, file: sentFile }), []);
});
