// Every file location the workflow uses, in one place. ROOT is the project folder.
//   config/    preferences.json: your settings (git-ignored; the example file is tracked)
//   profile/   your facts and notes (profile.md, stories.md) and your resume rules
//   data/      working state the scripts own (jobs.csv, seen-jobs.json, sent log, health, checks, proposals, the log)
//   archives/  job descriptions and competencies, one pair of files per role family, append-only
//   outputs/   tailored resumes (markdown, plus Word/PDF files in outputs/resumes/)
//   inbox.md   jobs dropped in by you or another agent, imported on the next run
//   .history/  a separate local git folder holding each run's snapshot of your data
// data/, archives/, outputs/, inbox.md and .history/ are git-ignored, so pulling updates never touches them.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// From this file's own address, not import.meta.dirname: that is new in Node 20.11, and on an older Node every script
// would crash here before check-setup could say the Node is too old.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const at = (...p) => join(ROOT, ...p);

export const DATA_DIR = at("data");
export const CSV_FILE = at("data", "jobs.csv");
export const SEEN_FILE = at("data", "seen-jobs.json");
export const SENT_LOG = at("data", "sent-log.json");
export const HEALTH_FILE = at("data", "health.json");
export const PULLED_FILE = at("data", "boards-pulled.json"); // boards read at least once (lib/first-pull.mjs)
export const LOCK_FILE = at("data", "job-pull.lock");
export const CHECKS_DIR = at("data", "checks");
export const PROPOSALS_DIR = at("data", "proposals");
export const SCOUT_FILE = at("data", "scout.json");
export const WORKFLOW_LOG = at("data", "workflow-log.md");
export const RUN_LOG = at("data", "job-pull.log"); // what the hourly job prints (install-schedule.mjs)
export const IMPORT_FILE = at("data", "inbox-import.json");

// Each role family (search.families in the settings) has its own archive and competencies file.
export const ARCHIVES_DIR = at("archives");
export const familySlug = (name) =>
  String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "jobs";
export const archiveFile = (family) => join(ARCHIVES_DIR, `jobs-${familySlug(family)}.md`);
export const competenciesFile = (family) => join(ARCHIVES_DIR, `competencies-${familySlug(family)}.md`);

export const PROFILE = at("profile", "profile.md");
export const STORIES = at("profile", "stories.md");
export const RULES_FILE = at("profile", "resume-rules.md");
export const RULES_PROPOSED = at("profile", "resume-rules.proposed.md");

export const TAILORED_FILE = at("outputs", "tailored-resumes.md");
export const OUT_DIR = at("outputs", "resumes");

export const INBOX_FILE = at("inbox.md");
export const HISTORY_DIR = at(".history");

// Settings: AJS_SETTINGS lets a test or a second setup point at a different file.
export const SETTINGS_FILE = process.env.AJS_SETTINGS || at("config", "preferences.json");
export const SETTINGS_EXAMPLE = at("config", "preferences.example.json");
