// data/sent-log.json: every message already sent, so a rerun never sends the same thing twice, but a change
// is still sent. Keys are "<role link>|<channel>|<version>":
//   resume-text|<v>, resume-email|<v>   a resume, once per version of its text (a re-tailored resume goes again)
//   resume-text|on-since, resume-email|on-since   when that channel was found turned on (see resumesToRetry)
// A value is the time it was sent, or HANDLED for a resume that was already ready when its channel was turned on.
// (Older keys text|… and list-email|… are from when each role got its own line in the message; no longer used.)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SENT_LOG } from "./paths.mjs";
import { writeAtomic } from "./state.mjs";

const load = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };

export const sentKey = (url, channel, version) => (version ? `${url}|${channel}|${version}` : `${url}|${channel}`);

// A resume's version: its text from the summary on, so a changed Keywords or Sources line doesn't count.
export function versionOf(markdown) {
  const md = String(markdown ?? "");
  const i = md.indexOf("### Professional Summary");
  const body = md.slice(i < 0 ? 0 : i).split(/\n---\s*(\n|$)/)[0]; // stop at the divider before the next resume
  return createHash("sha1").update(body.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 10);
}

export const alreadySent = (key, { file = SENT_LOG } = {}) => key in load(file);

export function markSent(keys, { file = SENT_LOG, when = new Date().toISOString() } = {}) {
  const log = load(file);
  for (const k of keys) log[k] = when;
  writeAtomic(file, JSON.stringify(log, null, 1));
}

// Items (with .url) not yet sent on this channel, in this version (version(item) → string, optional).
export function unsent(items, channel, { file = SENT_LOG, version } = {}) {
  const log = load(file);
  return items.filter((i) => !(sentKey(i.url, channel, version?.(i)) in log));
}

// Links of "Resume ready" rows whose current resume text never went out on this channel ("resume-text" or
// "resume-email"): the run stopped before sending, a send failed, or the resume was re-tailored. A resume you
// finalized yourself is sent only if it was never sent at all. sectionOf(link) → that resume's section in
// outputs/tailored-resumes.md.
export function pendingResumes(rows, { file = SENT_LOG, sectionOf, channel = "resume-text" } = {}) {
  const log = load(file);
  const everSent = (link) => Object.keys(log).some((k) => k.startsWith(`${link}|${channel}`));
  return rows
    .filter((r) => r.Status === "Resume ready")
    .filter((r) => {
      const md = sectionOf?.(r.Link);
      if (!md) return false;
      if (/^Final:/m.test(md)) return !everSent(r.Link);
      return !(sentKey(r.Link, channel, versionOf(md)) in log);
    })
    .map((r) => r.Link);
}

// Turning a channel on later must not send every resume made before. The first run that finds a channel on records
// "<channel>|on-since" and marks each resume already "Resume ready" (other than this run's) as handled on it, so only
// resumes made from then on are ever retried. A run with the channel off clears the record, so turning it on again
// does the same.
const onSince = (channel) => `${channel}|on-since`;
export const HANDLED = "ready before this channel was turned on";

// Notes which channels are on: records "<channel>|on-since" and marks the ready resumes (other than builtNow) as
// handled for a channel found on for the first time; clears the record for a channel that is off. job-pull calls
// it at the start of every run, before any resume is built, so a run that stops before sending can't leave a new
// resume to be taken for an old one. channels: { "resume-text": on, "resume-email": on }.
export function noteChannels(rows, { channels = {}, builtNow = [], sectionOf, file = SENT_LOG, when = new Date().toISOString() } = {}) {
  const log = load(file);
  let changed = false;
  for (const [channel, on] of Object.entries(channels)) {
    if (!on) {
      if (onSince(channel) in log) { delete log[onSince(channel)]; changed = true; }
      continue;
    }
    if (onSince(channel) in log) continue;
    log[onSince(channel)] = when;
    changed = true;
    for (const r of rows) {
      if (r.Status !== "Resume ready" || builtNow.includes(r.Link)) continue;
      const md = sectionOf?.(r.Link);
      const key = md && sentKey(r.Link, channel, versionOf(md));
      if (key && !(key in log)) log[key] = HANDLED;
    }
  }
  if (changed) writeAtomic(file, JSON.stringify(log, null, 1));
}

// Links of ready resumes to send again this run, for each channel that is on (pendingResumes), never one of this
// run's own (builtNow, sent anyway). A channel not noted yet is noted first (noteChannels).
export function resumesToRetry(rows, { channels = {}, builtNow = [], sectionOf, file = SENT_LOG, when } = {}) {
  noteChannels(rows, { channels, builtNow, sectionOf, file, ...(when ? { when } : {}) });
  const out = [];
  for (const [channel, on] of Object.entries(channels)) {
    if (!on) continue;
    for (const l of pendingResumes(rows, { file, sectionOf, channel })) if (!builtNow.includes(l) && !out.includes(l)) out.push(l);
  }
  return out;
}
