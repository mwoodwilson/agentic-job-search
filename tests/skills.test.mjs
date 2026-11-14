// The Claude Code skills in .claude/skills/. job-pull.mjs runs most of them headless with read-only tools plus
// write access to named files, so each one has to be written for any user, name only files that exist, and tell
// the model to write only what job-pull grants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as P from "../scripts/lib/paths.mjs";
import { HARD_RULES_BLOCK, HARD_RULES_START, HARD_RULES_END } from "../scripts/lib/rules.mjs";

const SKILLS_DIR = join(P.ROOT, ".claude", "skills");
const skillNames = () => readdirSync(SKILLS_DIR).filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory());
const skillText = (name) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
const frontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  const field = (k) => (m?.[1].match(new RegExp(`^${k}: (.*)$`, "m")) || [])[1];
  return { name: field("name"), description: field("description") };
};

const PIPELINE = ["tailor-resume", "check-resume", "import-jobs", "diagnose-board", "scout-companies", "interview-prep", "craft-stories", "update-competencies"];

// What a skill written for any user must never point at: the previous setup's folders and files, the agent that
// used to drop jobs in, and absolute paths on someone's own machine. (Names of people and employers are caught
// by a separate private scan, so they are not listed in this public file.)
const OWNER_DETAILS = /about-me\/|openclaw|resume-style-guide|~\/job-search|\/Users\/|\/home\//i;

// ---------- repo paths named in a skill ----------

const PREFIXES = "profile|data|outputs|archives|config|templates|prompts";
const PATH = new RegExp(`(?<![\\w./-])(?:${PREFIXES})/(?:[\\w.*/-]|<[^<>\\s]*>)+`, "g");
// Every path in the text, placeholders like <hash> turned into *, trailing dots, slashes and bold markers dropped.
const pathsIn = (text) => [...new Set([...text.matchAll(PATH)].map((m) => m[0].replace(/\*\*$/, "").replace(/<[^>]*>/g, "*").replace(/[./]+$/, "")))];

const rel = (abs) => relative(P.ROOT, abs);
const FAMILY = "zzfamilyzz"; // archiveFile() and competenciesFile() with a stand-in name give the pattern
const globToRegExp = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if ([".git", "node_modules", ".history", ".superpowers", "data", "archives", "outputs"].includes(e.name)) return [];
  return e.isDirectory() ? walk(join(dir, e.name)) : [rel(join(dir, e.name))];
});
// Files you create yourself are named in .gitignore, one per line (a folder line like data/ names no file).
const gitignored = readFileSync(join(P.ROOT, ".gitignore"), "utf8").split("\n")
  .filter((l) => new RegExp(`^(${PREFIXES})/[^*]+[^/]$`).test(l.trim())).map((l) => l.trim());

const KNOWN = [
  ...Object.values(P).filter((v) => typeof v === "string").map(rel).filter((r) => r && !r.startsWith("..")),
  "config/preferences.json", // SETTINGS_FILE, unless AJS_SETTINGS points it elsewhere
  rel(P.archiveFile(FAMILY)).replace(FAMILY, "*"),
  rel(P.competenciesFile(FAMILY)).replace(FAMILY, "*"),
  `${rel(P.CHECKS_DIR)}/*`, `${rel(P.DRAFTS_DIR)}/*`, `${rel(P.PROPOSALS_DIR)}/*`, `${rel(P.OUT_DIR)}/*`, // files the scripts name themselves
  ...gitignored,
  ...walk(P.ROOT),
];
const isKnownPath = (p) => KNOWN.some((k) => k === p || globToRegExp(k).test(p) || (p.includes("*") && globToRegExp(p).test(k)));

test("the path check accepts files the project defines and rejects the rest", () => {
  for (const ok of ["profile/profile.md", "profile/resume-rules.md", "data/jobs.csv", "data/inbox-import.json", "data/checks/*.json", "data/proposals/*.md",
    "archives/jobs-*.md", "archives/competencies-*.md", "archives/jobs-product-manager.md", "outputs/tailored-resumes.md", "outputs/resumes/*",
    "config/preferences.json", "templates/resume-template.docx", "profile/interview-practice.md", "profile/crafted-stories.md"]) {
    assert.equal(isKnownPath(ok), true, ok);
  }
  for (const bad of ["profile/nope.md", "data/notes.md", "archives/notes.md", "outputs/summary.md", "config/other.json", "templates/missing.docx", "prompts/missing.md"]) {
    assert.equal(isKnownPath(bad), false, bad);
  }
  assert.deepEqual(pathsIn("Read `data/checks/<hash>.json`, then archives/jobs-<family-slug>.md. See profile/profile.md."),
    ["data/checks/*.json", "archives/jobs-*.md", "profile/profile.md"]);
  assert.deepEqual(pathsIn("**Never edit data/jobs.csv.** Use <top keywords in profile/profile.md>."), ["data/jobs.csv", "profile/profile.md"]);
});

// ---------- every skill ----------

test("the eight pipeline skills are all there", () => {
  for (const name of PIPELINE) assert.ok(existsSync(join(SKILLS_DIR, name, "SKILL.md")), name);
});

test("the setup and research-resume-rules skills are there", () => {
  for (const name of ["setup", "research-resume-rules"]) assert.ok(existsSync(join(SKILLS_DIR, name, "SKILL.md")), name);
});

for (const name of skillNames()) {
  test(`${name}: the frontmatter name is the folder name and the description says when to use it`, () => {
    const { name: fmName, description } = frontmatter(skillText(name));
    assert.equal(fmName, name);
    assert.ok(description && description.length > 40, "a description");
    assert.match(description, /\bUse when\b/i, "the description says when to use the skill");
    assert.ok(!description.includes(": "), "a colon and space in the description breaks the frontmatter");
  });

  test(`${name}: written for any user, with no trace of the previous owner`, () => {
    const hit = skillText(name).match(OWNER_DETAILS);
    assert.equal(hit, null, `found "${hit?.[0]}"`);
  });

  test(`${name}: every repo path it names is one the project defines`, () => {
    const found = pathsIn(skillText(name));
    assert.ok(found.length > 0, "it names at least one file");
    for (const p of found) assert.ok(isKnownPath(p), `${p} isn't in paths.mjs or the repo`);
  });
}

// ---------- what each skill must say ----------

const mustName = {
  "tailor-resume": ["profile/resume-rules.md", "profile/profile.md", "profile/stories.md", "config/preferences.json", "outputs/tailored-resumes.md", "archives/jobs-<family-slug>.md",
    "archives/competencies-<family-slug>.md", "HARD RULES START", "My rules", "resume.roles", "resume.note", "time-bound", "aim for 3"],
  "check-resume": ["profile/profile.md", "profile/stories.md", "outputs/tailored-resumes.md", "data/checks/<hash>.json", "source_file", "source_quote"],
  "import-jobs": ["inbox.md", "data/inbox-import.json", "<!-- ENTRIES BELOW -->"],
  "diagnose-board": ["search.companies", "config/preferences.json", "data/proposals/"],
  "scout-companies": ["profile/profile.md", "search.titleKeywords", "search.companies", "config/preferences.json", "data/proposals/", "Backlog"],
  "interview-prep": ["profile/interview-practice.md", "archives/jobs-<family-slug>.md", "archives/competencies-<family-slug>.md", "outputs/tailored-resumes.md"],
  "craft-stories": ["profile/stories.md", "profile/interview-practice.md", "profile/crafted-stories.md", "archives/competencies-<family-slug>.md"],
  "update-competencies": ["archives/jobs-<family-slug>.md", "archives/competencies-<family-slug>.md", "profile/profile.md", "search.families", "<!-- ROLE GUIDE START -->", "<!-- ROLE GUIDE END -->"],
  "setup": ["config/preferences.example.json", "config/preferences.json", "profile/profile.md", "profile/stories.md", "profile/resume-rules.md", "examples/profile/profile.md",
    "node scripts/check-setup.mjs", "node scripts/find-board.mjs", "node scripts/job-pull.mjs --no-ai --backlog", "node scripts/install-schedule.mjs",
    "search.titleKeywords", "search.locationKeywords", "search.pay", "search.companies", "notifications.imessage", "notifications.email", "notifications.numbers",
    "schedule.hourly", "schedule.scout", "Backlog", "HARD RULES START", "/research-resume-rules"],
  "research-resume-rules": ["prompts/research-resume-rules.md", "profile/resume-rules.proposed.md", "profile/resume-rules.md", "profile/resume-rules.example.md",
    "HARD RULES START", "HARD RULES END", "My rules", "deep-research", "Research mode", "{target roles}", "{level}", "{field/industry}"],
};
for (const [name, needles] of Object.entries(mustName)) {
  test(`${name} names the files and settings it works from`, () => {
    const text = skillText(name);
    for (const n of needles) assert.ok(text.includes(n), `${name} should mention ${n}`);
  });
}

test("living documents: tailor-resume and craft-stories call profile.md and stories.md living documents", () => {
  assert.match(skillText("tailor-resume"), /living document/i);
  assert.match(skillText("craft-stories"), /living document/i);
});

test("check-resume accepts only the three source files the code accepts", () => {
  const text = skillText("check-resume");
  const sources = ["profile/profile.md", "profile/stories.md", "outputs/tailored-resumes.md"];
  for (const s of sources) assert.ok(text.includes(`\`${s}\``), s);
  const example = text.match(/"source_file": "([^"]+)"/);
  assert.ok(example && sources.includes(example[1]), "the JSON example names one of the three");
  assert.match(text, /Final:/, "only finalized resumes count from the tailored file");
  assert.match(text, /resume-rules\.md[^\n]*(not|never)/i, "the rules file is said not to be a source");
});

test("the skills that write give the model exactly the files job-pull grants", () => {
  const grants = {
    "tailor-resume": "outputs/tailored-resumes.md",
    "check-resume": "data/checks/<hash>.json",
    "import-jobs": "data/inbox-import.json",
    "update-competencies": "archives/competencies-<family-slug>.md",
    "diagnose-board": "data/proposals/",
    "scout-companies": "data/proposals/",
  };
  for (const [name, file] of Object.entries(grants)) assert.ok(skillText(name).includes(file), `${name} writes ${file}`);
  // The two agents are told they can write only the proposal; the checker only its JSON; the updater only its files.
  for (const name of ["diagnose-board", "scout-companies"]) assert.match(skillText(name), /only write the proposal/i, name);
  assert.match(skillText("check-resume"), /Never edit any file except the JSON/i);
  assert.match(skillText("update-competencies"), /Never change the role guide/i);
});

// ---------- the setup skill ----------

test("the setup skill runs the first pull as a backlog catch-up", () => {
  assert.ok(skillText("setup").includes("--no-ai --backlog"));
});

test("setup has the eight steps, in order", () => {
  const steps = [...skillText("setup").matchAll(/^## Step (\d+): (.+)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("setup asks one question at a time and uses answers the user already gave", () => {
  const text = skillText("setup");
  assert.match(text, /one question at a time/i);
  assert.match(text, /gave answers up front[^.\n]*use them and don't ask again/i);
});

test("setup says plainly that the user's own files are git-ignored and stay on the Mac", () => {
  const text = skillText("setup");
  assert.match(text, /ignored by git, so your details stay on this Mac/);
  for (const f of ["config/preferences.json", "profile/profile.md", "profile/stories.md", "profile/resume-rules.md"]) assert.ok(text.includes(f), f);
  const ignored = readFileSync(join(P.ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  for (const f of ["config/preferences.json", "profile/profile.md", "profile/stories.md", "profile/resume-rules.md"]) assert.ok(ignored.includes(f), `${f} is in .gitignore`);
});

test("setup tells the user, in the agreed words, that profile.md and stories.md are living documents", () => {
  assert.ok(skillText("setup").includes("profile.md and stories.md are living documents: keep adding to them. The more true detail they hold, the better every resume gets."));
});

test("setup writes only profile/ and config/preferences.json, and never the hard rules block", () => {
  const text = skillText("setup");
  assert.match(text, /Only files in `profile\/` and `config\/preferences\.json`/);
  assert.match(text, new RegExp(`Never edit the "Hard rules" block[^\\n]*${HARD_RULES_START}[^\\n]*${HARD_RULES_END}`));
});

test("setup turns notifications on only with a yes and an address", () => {
  const text = skillText("setup");
  assert.match(text, /off\. Ask about each one separately, and turn it on only with a yes/);
  assert.match(text, /a yes without an address, leave it off/);
});

test("setup explains Backlog roles: set Status to New to get a resume, and only later roles get resumes automatically", () => {
  const text = skillText("setup");
  assert.match(text, /Status "Backlog"/);
  assert.match(text, /set its Status to "New"/);
  assert.match(text, /Only roles found from now on get resumes automatically/);
});

test("setup finds each company's board with find-board, with the address and name in single quotes", () => {
  assert.match(skillText("setup"), /node scripts\/find-board\.mjs '<address of a job on the board>' '<Company name>'/);
});

test("setup never puts a web-derived address inside double quotes, and uses only addresses on the known job-board hosts", () => {
  const text = skillText("setup");
  // Inside double quotes the shell still runs $(...) and backticks, so no find-board command may use them.
  for (const line of text.split("\n").filter((l) => l.includes("scripts/find-board.mjs"))) assert.doesNotMatch(line, /find-board\.mjs[^\n]*"/, line);
  for (const host of ["greenhouse.io", "lever.co", "ashbyhq.com", "gem.com", "myworkdayjobs.com"]) assert.ok(text.includes(host), host);
  assert.match(text, /only an address on one of these job-board hosts/i);
  assert.match(text, /single quote/i);
});

test("setup turns the hourly schedule and the weekly scout on only with a clear yes", () => {
  const step7 = skillText("setup").split(/^## Step 7:/m)[1].split(/^## Step 8:/m)[0];
  assert.match(step7, /`schedule\.hourly` to true only on a clear yes/);
  assert.match(step7, /if you are not sure[^.\n]*leave it (off|false)/i);
  assert.match(step7, /`schedule\.scout\.enabled` to true only on a clear yes/);
});

test("the scripts the setup skill runs exist", () => {
  const named = [...new Set([...skillText("setup").matchAll(/node scripts\/([\w-]+)\.mjs/g)].map((m) => m[1]))];
  assert.deepEqual(named.sort(), ["check-setup", "find-board", "install-schedule", "job-pull", "set-status"]);
  for (const n of named) assert.ok(existsSync(join(P.ROOT, "scripts", `${n}.mjs`)), `scripts/${n}.mjs`);
});

// ---------- onboarding: the owner's design (2026-11-13). Change it only when the owner asks. ----------
// Simple: eight steps, about eight questions. Cost first. Experience from a resume or in the user's own words. Roles,
// where and pay, companies, notifications, scout and schedule, then the first resumes, then interview practice.

const setupStep = (n) => skillText("setup").split(new RegExp(`^## Step ${n}:`, "m"))[1].split(/^## /m)[0];

test("onboarding: the eight steps, in this order", () => {
  const steps = [...skillText("setup").matchAll(/^## Step \d+: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(steps, ["Cost and the computer", "Your experience", "The roles you want", "Where and pay", "Companies to watch", "Notifications", "Scout and schedule", "Your first resumes"]);
  assert.match(skillText("setup"), /eight steps, about eight questions\. Don't add questions\./);
});

test("onboarding: cost is the first thing said, and every paid step names its cost before it runs", () => {
  const step1 = setupStep(1);
  assert.ok(step1.indexOf("Before anything else, tell the user what it costs") < step1.indexOf("check-setup"), "cost before anything runs");
  assert.match(step1, /about \$2–4 of Claude usage/);
  assert.match(step1, /an hour with no new roles costs nothing/);
  assert.match(step1, /stops at \$3/);
  assert.match(setupStep(7), /about \$5 a run/, "the scout's cost");
  assert.match(setupStep(8), /Each is about \$2–4/, "the first resumes' cost");
  assert.match(skillText("setup").split(/^## Finish/m)[1], /uses about as much as any conversation that long/, "interview practice's cost");
});

test("onboarding: experience comes from a resume or the user's own words, and no resume is needed", () => {
  const step2 = setupStep(2);
  assert.match(step2, /or just tell me about your jobs in your own words\. Rough is fine, and you don't need a resume\./);
  assert.match(step2, /\*\*Without a resume\*\*, interview them one job at a time/);
  assert.match(step2, /in their own words, in `profile\/stories\.md`/, "raw words are kept as a source");
  assert.match(step2, /What's something you're proud of that your resume undersells\?/, "raw experience is asked for even with a resume");
  assert.match(step2, /the writer builds every resume only from these two files/);
});

test("onboarding: each kind of role gets its own resume folder", () => {
  assert.match(setupStep(3), /one `search\.families` entry per kind of role[\s\S]*own folder of resumes in `outputs\/resumes\/`/);
});

test("onboarding: it ends by writing the first resumes, then offers interview practice", () => {
  const step8 = setupStep(8);
  assert.ok(step8.indexOf("--no-ai --backlog") < step8.indexOf("Pick up to 3 for resumes now"));
  assert.ok(step8.indexOf("Pick up to 3 for resumes now") < step8.indexOf("node scripts/job-pull.mjs --resume-only"));
  const finish = skillText("setup").split(/^## Finish/m)[1];
  assert.match(finish, /Want to practice interviewing for one of these roles\?/);
  assert.match(finish, /run the interview-prep skill/);
  assert.match(finish, /`\/interview-prep`/);
});

test("onboarding: the questions cut for simplicity stay cut", () => {
  const text = skillText("setup");
  assert.match(text, /Leave `search\.titleExclude` as `\[\]`/);
  assert.match(text, /set both `minTop` and `minBaseTop` to it/);
  assert.match(text, /Leave `notifications\.imessage\.everyRun` off/);
  assert.doesNotMatch(text, /^## Step \d+: Resume rules/m, "no resume-rules step");
  assert.doesNotMatch(text, /Do you have your current resume\?/, "a resume is never required");
});

// ---------- the research-resume-rules skill and its prompt ----------

test("research-resume-rules never edits the hard rules, writes the proposal file, and drops rules that loosen a hard rule", () => {
  const text = skillText("research-resume-rules");
  assert.match(text, new RegExp(`Never edit anything between \`${HARD_RULES_START}\` and \`${HARD_RULES_END}\``));
  assert.match(text, /below the line "## My rules"/);
  assert.match(text, /Drop any rule that loosens or conflicts with a hard rule/);
  assert.match(text, /keep, edit or delete/i);
  assert.match(text, /field or industry[^\n]*target roles[^\n]*level/i);
});

test("research-resume-rules uses the deep-research skill when there is one, and falls back", () => {
  const text = skillText("research-resume-rules");
  assert.match(text, /If the deep-research skill is available/);
  assert.match(text, /web search and fetch/);
  assert.match(text, /claude\.ai in Research mode/);
});

test("the research prompt keeps its three placeholders, and its fixed rules match the hard rules in code", () => {
  const prompt = readFileSync(join(P.ROOT, "prompts", "research-resume-rules.md"), "utf8");
  for (const p of ["{target roles}", "{level}", "{field/industry}"]) assert.ok(prompt.includes(p), p);
  assert.ok(!/^>/m.test(prompt), "no quote markers");
  // The prompt's "fixed rules" paragraph states the same limits the checker enforces.
  const flat = prompt.replace(/\s+/g, " ");
  assert.ok(flat.includes("Do not propose rules that loosen or conflict with these."));
  assert.ok(flat.includes("professional summary of 300–350 characters") && HARD_RULES_BLOCK.includes("summary is 300–350 characters"));
  assert.ok(flat.includes("every bullet 200 characters or less") && HARD_RULES_BLOCK.includes("Every bullet is 200 characters or less"));
  assert.ok(flat.includes("every bullet states a number and its impact") && HARD_RULES_BLOCK.includes("Every bullet states a number and its impact"));
  assert.ok(flat.includes("at least 2 time-bound results in each of the two most recent roles") && HARD_RULES_BLOCK.includes("at least 2 time-bound results"));
  assert.ok(flat.includes("Output 10–20 rules."));
});

// Every step runs with the shell turned off, so a skill that reaches for one only wastes a turn.
test("the skills the hourly run uses say plainly not to run shell commands", () => {
  for (const name of ["check-resume", "update-competencies", "tailor-resume", "import-jobs"]) {
    assert.match(skillText(name), /(Don't|don't) (try to )?run scripts or shell commands|Shell commands aren't allowed/, name);
  }
});
