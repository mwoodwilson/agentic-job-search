#!/usr/bin/env node
// Job Pull: the hourly job-search run (node scripts/job-pull.mjs). One run at a time (data/job-pull.lock).
// Every rule comes from config/preferences.json; if a required setting is missing, it says what to fix and stops.
// Built to be fast: a run with one new role takes a few minutes.
//  1. Pulls open roles from every public job board in search.companies at once (Greenhouse, Lever, Ashby, Ashby
//     hosted pages, Gem and Workday). Keeps roles not seen before that pass the title, location and pay rules.
//  2. Logs them: data/jobs.csv (Status "New", or "Backlog" on a company's first pull: those roles were already open,
//     so they don't all get paid resumes at once) and each role family's archive in archives/ (full job descriptions).
//  3. Reads inbox.md (import-jobs), then, if text or email is on, sends one line about the new roles (with the Numbers
//     job list when that is on).
//  4. Writes up to 3 resumes at once: per "New" role the writer + checker loop (lib/tailor-loop.mjs, each role in its
//     own draft file), which ends in "Resume ready", "Could not tailor" or "Needs review" (set by code). Each resume
//     that passes is filed in outputs/tailored-resumes.md, built as Word/PDF and sent right away in its own text and
//     email, where those are on (each once per version: data/sent-log.json). If Claude isn't answering (not signed in,
//     a usage limit, no network), the roles stay "New" for the next run and no more Claude steps start this run.
//  5. After the messages: the Numbers job list (if on) gets the final statuses; update-competencies runs once a day;
//     the repair and scout agents write proposals to data/proposals/. Every run ends with a log line and a snapshot in
//     .history/. Claude steps (lib/claude.mjs) are capped and read-only except one named file each.
// Flags: --no-ai (pull only; new roles stay "New" for the next full run), --backlog (add every new role as "Backlog",
//        no resumes or messages),
//        --numbers (only update the Numbers job list, and text it to you if iMessage is on),
//        --retailor <link> (a normal run that also writes a fresh resume for a role that already has one),
//        --resume-only (skip the job boards: import the inbox, tailor "New" roles and any --retailor link, send).
// File locations: lib/paths.mjs. Tests: node --test. Workflow log: data/workflow-log.md.

import { writeFile, readFile, appendFile, stat, mkdir, rm, readdir } from "node:fs/promises";
import { join, dirname, relative, basename } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { tailoredSections, buildResumeFiles, newestPerLink } from "./resume-docx.mjs";
import { runClaude, runClaudeAsync, editRule, READ } from "./lib/claude.mjs";
import { isMain } from "./lib/entry.mjs";
import { logEvent } from "./lib/log.mjs";
import { withLock, writeAtomic } from "./lib/state.mjs";
import { getRows, setStatus } from "./lib/jobs-csv.mjs";
import { checkResume, finalSections } from "./lib/check-resume.mjs";
import { ensureProfileFiles } from "./lib/profile-files.mjs";
import { restoreRulesFile } from "./lib/rules.mjs";
import { tailorRoles, sectionFor, draftPathFor, mergeSection } from "./lib/tailor-loop.mjs";
import { mapLimit, serial } from "./lib/pool.mjs";
import { competenciesPlan, localDay } from "./lib/daily.mjs";
import { unsent, markSent, noteChannels, resumesToRetry, versionOf, sentKey } from "./lib/sent-log.mjs";
import { recordBoard } from "./lib/health.mjs";
import { firstPulls, recordPulls } from "./lib/first-pull.mjs";
import { snapshotRun } from "./lib/snapshot.mjs";
import { diagnoseBoard, runScout, shouldScout } from "./lib/agents.mjs";
import { ATS_TYPES, loadSettings, withDefaults } from "./lib/settings.mjs";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import {
  ROOT, DATA_DIR, CSV_FILE, SEEN_FILE, INBOX_FILE, IMPORT_FILE, TAILORED_FILE, PROFILE, STORIES, RULES_FILE,
  CHECKS_DIR, PROPOSALS_DIR, SCOUT_FILE, SENT_LOG, ARCHIVES_DIR, PULLED_FILE, archiveFile, competenciesFile,
} from "./lib/paths.mjs";

// This run's settings: config/preferences.json merged with the defaults. The program loads and checks them
// before main runs; tests and other scripts set them with useSettings(). Functions that take a search or pay
// argument fall back to these.
let settings = withDefaults({});
// What this run may send and update: nothing, until each notification is turned on in the settings.
// imessage and email are the address to send to (null when off); numbers is whether to keep the Numbers sheet;
// everyRun is whether a run with nothing new still texts (notifications.imessage.everyRun, off by default).
function notifyTargets(s = settings) {
  const n = s?.notifications || {};
  const to = (k) => (n[k]?.enabled === true && typeof n[k].to === "string" && n[k].to.trim() ? n[k].to.trim() : null);
  const imessage = to("imessage");
  return { imessage, email: to("email"), numbers: n.numbers?.enabled === true, everyRun: !!imessage && n.imessage?.everyRun === true };
}
let TARGETS = notifyTargets(settings);
function useSettings(s) {
  settings = s;
  TARGETS = notifyTargets(s);
}

// Which role family (and so which archive and competencies file) a role belongs to, from its title: the first
// family whose title keywords appear in it, else the first family with no keywords (the catch-all), else the first.
function archiveFor(title, families = settings.search.families) {
  const list = Array.isArray(families) && families.length ? families : [{ name: "Jobs", titleKeywords: [] }];
  const hasWords = (f) => Array.isArray(f.titleKeywords) && f.titleKeywords.length > 0;
  return (list.find((f) => hasWords(f) && matches(title, f.titleKeywords)) || list.find((f) => !hasWords(f)) || list[0]).name;
}
const BASELINE_DATE = "2000-01-01T00:00:00.000Z"; // ashby-page postings already open on the company's first run
const HEADERS = { "User-Agent": "personal-job-search-script", Accept: "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lc = (s) => String(s ?? "").toLowerCase();
const unique = (arr) => [...new Set(arr.filter(Boolean))];
const matches = (text, keywords) =>
  keywords.length === 0 || keywords.some((k) => lc(text).includes(lc(k)));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const excluded = (text, words) =>
  words.some((w) => new RegExp(`\\b${escapeRe(lc(w)).replace(/\s+/g, "\\s+")}\\b`).test(lc(text)));

// Same title, exclude and location rules for every board (search in the settings). Whether a role is new is
// decided by seen-jobs.json (and company + title), not by its posted date. With search.usOnly on (the default),
// roles outside the US are dropped (e.g. "Remote UK", "Remote Canada") unless the location also names the US.
const NON_US = /\b(uk|united kingdom|england|canada|london|toronto|vancouver|montreal|dublin|ireland|india|bengaluru|bangalore|germany|berlin|munich|france|paris|singapore|australia|sydney|japan|tokyo|brazil|sao paulo|são paulo|mexico|emea|apac|latam|europe|amsterdam|netherlands|spain|madrid|poland|warsaw|israel|tel aviv)\b/i;
const US = /\b(us|usa|u\.s\.?|united states|new york|nyc)\b/i;
const inUS = (location) => !NON_US.test(String(location ?? "")) || US.test(String(location ?? ""));

// A remote offer in the description counts as a remote location, for boards whose location field names only an
// office city. Any sentence ruling remote out wins, and with usOnly a non-US location still drops the role.
const REMOTE_OFFER = /\b(fully[- ]remote|remote[- ](friendly|eligible|option)|work(ing)? remotely|open to remote|(can|may) be (fully )?remote|remote (or|and) (a )?(hybrid|in[- ]office|on[- ]?site|in our)|(hybrid|in[- ]office|on[- ]?site),? (or|and) (fully )?remote|remote within the (us|u\.s\.|united states)|remote \((us|usa|u\.s\.|united states)\)|(role|position) is remote)/i;
const REMOTE_RULED_OUT = /\b(not (a )?remote|no remote|not (eligible|open|available) (for|to) remote|remote (work )?is not|isn'?t remote|non-remote)\b/i;
const remoteInDescription = (text) => REMOTE_OFFER.test(String(text ?? "")) && !REMOTE_RULED_OUT.test(String(text ?? ""));
// Adds "Remote" to the location shown in the job list when only the description offers it.
const noteRemote = (j) =>
  !matches(j.location, ["remote"]) && remoteInDescription(j.description)
    ? { ...j, location: unique([j.location, "Remote"]).join(" | ") }
    : j;

// A company entry's optional "titles" narrows that one company to these title words, on top of titleKeywords.
const companyTitles = (j, search) =>
  (search.companies ?? []).find((c) => lc(c.name) === lc(j.company))?.titles ?? [];

function passesFilters(j, search = settings.search) {
  return matches(j.title, search.titleKeywords ?? []) &&
    matches(j.title, companyTitles(j, search)) &&
    !excluded(j.title, search.titleExclude ?? []) &&
    (matches(j.location, search.locationKeywords ?? []) || remoteInDescription(j.description)) &&
    (search.usOnly === false || inUS(j.primaryLocation || j.location));
}

// Same company + title = same role, even when it arrives under a different link (e.g. a repost on another site).
const roleKeyOf = (company, title) =>
  `${lc(company).replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?)$/, "").replace(/[^a-z0-9]+/g, " ").trim()}|${lc(title).replace(/[^a-z0-9]+/g, " ").trim()}`;
// ...unless both links carry different requisition IDs (e.g. R-282280 and R-294191): some companies post the same
// title for separate openings. Links that differ only in case are the same role.
const reqIdOf = (url) => String(url ?? "").match(/(?:^|[^a-z0-9])(r-?\d{5,})/i)?.[1].replace("-", "").toLowerCase() ?? "";
const sameRolePosting = (a, b) => {
  const ia = reqIdOf(a), ib = reqIdOf(b);
  return !(ia && ib && ia !== ib);
};
// key → links already listed under that company + title.
const addKeyLink = (map, key, url) => map.set(key, [...(map.get(key) ?? []), url]);
const isListedRepost = (map, key, url) => (map.get(key) ?? []).some((u) => sameRolePosting(u, url));


// Largest figure in a pay string, e.g. "$239K - $325K", "232,000–282,000 USD" or "$1.2M". Null if none.
// K and M only count when stuck to the number, so "150,000 Mid-level" isn't read as millions.
function payMax(text) {
  const mult = { k: 1e3, m: 1e6 };
  const nums = [...String(text ?? "").matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)([kKmM](?![a-zA-Z]))?/g)]
    .map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? mult[m[2].toLowerCase()] : 1))
    .filter((n) => n >= 1000);
  return nums.length ? Math.max(...nums) : null;
}

// Pay in a currency other than US dollars.
const nonUSD = (text) =>
  /[€£¥₹]|\b(EUR|GBP|CAD|AUD|INR|JPY|CHF|SGD|MXN|BRL)\b|\b(?:C|CA|A|AU)\$/.test(String(text ?? ""));

// Whether the stated range is base-only or total comp, from the words just before the first dollar figure.
// Only explicit phrases count ("base salary", "total compensation"), so "knowledge base" or a stray
// "equity" doesn't decide it. Base is checked first, so an unclear role is kept rather than dropped.
function payLabel(description) {
  const m = String(description ?? "").search(/\$\s?\d/);
  if (m < 0) return "unknown";
  const before = description.slice(Math.max(0, m - 200), m).toLowerCase();
  if (/\bbase\s+(salary|pay|compensation)\b/.test(before)) return "base";
  if (/\btotal\s+(target\s+)?(comp|compensation|cash)\b|\bote\b|on-target earnings/.test(before)) return "total";
  return "unknown";
}

// Pay rule, with the floors in search.pay: the top of the USD range over minTop passes. Under it, a base-only range
// passes if its top is over minBaseTop and extra pay is mentioned; otherwise it fails. minTop 0 means no floor.
// Unclear, missing or non-USD pay goes to Review (kept, so you can judge it).
const EXTRA_PAY = /\b(bonus(es)?|equity|stock|RSUs?|incentive|commissions?|variable (pay|comp\w*)|total rewards|profit[- ]sharing|LTIs?|long[- ]term incentive)\b/i;
const money = (n) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);

function compStatus(j, pay = settings.search.pay) {
  const minTop = pay?.minTop || 0, minBaseTop = pay?.minBaseTop || 0;
  if (!String(j.pay ?? "").trim()) return "Review: no pay listed";
  // Judge a USD range on its own when other currencies are listed too (e.g. "… USD; … CAD").
  const usd = String(j.pay).split(/;\s*/).filter((p) => !nonUSD(p) && /USD|\$/.test(p)).join("; ");
  if (nonUSD(j.pay) && !usd) return "Review: pay not in USD";
  if (usd) j = { ...j, pay: usd };
  const max = payMax(j.pay);
  if (max === null) return "Review: pay not readable";
  if (!minTop) return "Pass: no pay floor";
  const top = money(minTop), baseTop = money(minBaseTop);
  if (max > minTop) return `Pass: top of range over ${top}`;
  // The description decides base vs total; if it doesn't say, the pay text itself (e.g. "Base $155K – $217K") can.
  let label = payLabel(j.description);
  if (label === "unknown") label = /\bbase\b/i.test(j.pay) ? "base" : /\btotal\b|\bote\b/i.test(j.pay) ? "total" : "unknown";
  if (label === "base") {
    if (max <= minBaseTop) return `Fail: base under ${baseTop}`;
    if (!EXTRA_PAY.test(String(j.description ?? ""))) return `Fail: base under ${top}, no bonus or equity mentioned`;
    return `Pass: base over ${baseTop} plus bonus/equity, top under ${top}`;
  }
  if (label === "total") return `Fail: total comp, top under ${top}`;
  return `Review: top under ${top}, base vs total comp unclear`;
}

async function getJSON(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`the site answered with error ${res.status}`);
    const text = await res.text();
    try {
      return { data: JSON.parse(text) };
    } catch {
      if (attempt === 2) throw new Error("got a web page instead of job data");
      await sleep(1500);
    }
  }
}

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&amp;/g, "&");
}

function htmlToText(html) {
  if (!html) return "";
  let s = decodeEntities(html);
  s = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*li\s*>/gi, "")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatPay(min, max, currency = "", interval = "") {
  if (min == null && max == null) return "";
  const f = (n) => (n == null || Number.isNaN(n) ? "?" : Math.round(n).toLocaleString("en-US"));
  const per = interval ? " " + String(interval).replace(/^per-/, "/").replace(/-salary$/, "") : "";
  return `${f(min)}–${f(max)} ${currency || ""}${per}`.trim();
}

function greenhouseJobs(data, company) {
  return (data?.jobs || []).map((j) => ({
    company: company.name,
    title: j.title || "",
    location: unique([j.location?.name, ...(j.offices || []).map((o) => o.name)]).join(" | "),
    primaryLocation: j.location?.name || "", // decides the country; offices can list other countries
    team: unique((j.departments || []).map((d) => d.name)).join(", "),
    posted: j.first_published || j.updated_at || "",
    pay: (j.pay_input_ranges || [])
      .map((p) =>
        formatPay(
          p.min_cents != null ? p.min_cents / 100 : null,
          p.max_cents != null ? p.max_cents / 100 : null,
          p.currency_type
        )
      )
      .filter(Boolean)
      .join("; "),
    url: j.absolute_url || "",
    description: htmlToText(j.content),
  }));
}

function leverJobs(data, company) {
  return (Array.isArray(data) ? data : []).map((j) => {
    const c = j.categories || {};
    const lists = (j.lists || [])
      .map((l) => `${l.text || ""}\n${htmlToText(l.content)}`.trim())
      .join("\n\n");
    const s = j.salaryRange;
    return {
      company: company.name,
      title: j.text || "",
      location: unique([
        c.location,
        ...(c.allLocations || []),
        lc(j.workplaceType) === "remote" ? "Remote" : "",
      ]).join(" | "),
      team: unique([c.department, c.team]).join(" / "),
      posted: j.createdAt ? new Date(j.createdAt).toISOString() : "",
      pay: s ? formatPay(s.min, s.max, s.currency, s.interval) : "",
      url: j.hostedUrl || "",
      description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n").trim(),
    };
  });
}

function ashbyJobs(data, company) {
  return (data?.jobs || [])
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      company: company.name,
      title: j.title || "",
      location: unique([
        j.location,
        ...(j.secondaryLocations || []).map((l) => l.location),
        // Ashby sets isRemote on hybrid roles too, so only workplaceType "Remote" counts as remote.
        j.workplaceType === "Remote" ? "Remote" : "",
      ]).join(" | "),
      team: unique([j.department, j.team]).join(" / "),
      posted: j.publishedAt || "",
      pay:
        j.compensation?.scrapeableCompensationSalarySummary ||
        j.compensation?.compensationTierSummary ||
        "",
      url: j.jobUrl || "",
      description: j.descriptionPlain || htmlToText(j.descriptionHtml),
    }));
}

// Gem job boards (jobs.gem.com/<slug>). The feed has no pay field, so pay comes from the description.
function gemPay(text) {
  const m = text.match(/\$\s?([\d,]{4,}(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$\s?([\d,]{4,}(?:\.\d+)?)/);
  if (!m) return "";
  const before = text.slice(Math.max(0, m.index - 150), m.index);
  return "$" + m[1] + " – $" + m[2] + (/base/i.test(before) ? " base" : "");
}

function gemJobs(data, company) {
  return (Array.isArray(data) ? data : []).map((j) => {
    const description = htmlToText(j.content);
    return {
      company: company.name,
      title: j.title || "",
      location: unique([j.location?.name, j.location_type === "remote" ? "Remote" : ""]).join(" | "),
      primaryLocation: j.location?.name || "",
      team: unique((j.departments || []).map((d) => d.name)).join(", "),
      posted: j.first_published_at || j.created_at || "",
      pay: gemPay(description),
      url: j.absolute_url || "",
      description,
    };
  });
}

// Workday has no pay field, so pay comes from the description. When ranges are listed by location, the line
// naming one of your search.locationKeywords is used, else the first range. Marked "base" when the description
// calls it a salary.
function workdayPay(text, locationKeywords = settings.search.locationKeywords ?? []) {
  const ranges = [...text.matchAll(/^(.*?)\$\s?([\d,]{4,}(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$\s?([\d,]{4,}(?:\.\d+)?)/gm)];
  if (!ranges.length) return "";
  const m = ranges.find((r) => locationKeywords.some((k) => lc(r[1]).includes(lc(k)))) || ranges[0];
  const place = /^\s*([^:$]{2,40}):\s*$/.exec(m[1])?.[1];
  const before = text.slice(Math.max(0, m.index - 400), m.index + m[1].length);
  const base = /\bbase\b|\bsalar(y|ies)\b/i.test(before) ? " base" : "";
  return `$${m[2]} – $${m[3]}${base}${place ? ` (${place.trim()})` : ""}`;
}

// One page of a Workday board's list, with the company's own filters ("facets" in its settings entry, e.g. US
// only), for boards whose list stops before the end.
function workdayListBody(c, offset) {
  return { appliedFacets: c.facets || {}, limit: 20, offset, searchText: "" };
}

// Workday boards. The list only gives titles, so a posting is opened (for its locations, date and description)
// only when its title passes the title rules and its location could pass (a location keyword, or "3 Locations"),
// and the pull doesn't already have it ("known": seen-jobs.json and jobs.csv links). Known roles are skipped
// later anyway, and reopening them (a large board can have hundreds) cost minutes every run.
async function fetchWorkday(c, known = new Set()) {
  const [board, site] = c.slug.split("/");
  const host = `${board}.myworkdayjobs.com`;
  const api = `https://${host}/wday/cxs/${board.split(".")[0]}/${site}`;
  const postings = [];
  for (let offset = 0, total = 1; offset < total; offset += 20) {
    const res = await fetch(`${api}/jobs`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(workdayListBody(c, offset)),
    });
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw new Error(`the site answered with error ${res.status}`);
    const data = await res.json();
    if (offset === 0) total = data.total || 0; // later pages report a total of 0
    if (!data.jobPostings?.length) break;
    postings.push(...data.jobPostings);
    await sleep(250);
  }
  const jobs = [];
  for (const p of postings) {
    const job = {
      company: c.name,
      title: p.title || "",
      location: p.locationsText || "",
      team: "",
      posted: "",
      pay: "",
      url: `https://${host}/${site}${p.externalPath}`,
      description: "",
    };
    const s = settings.search;
    const couldPass =
      matches(job.title, s.titleKeywords ?? []) &&
      !excluded(job.title, s.titleExclude ?? []) &&
      (/^\d+ Locations$/i.test(job.location) || matches(job.location, s.locationKeywords ?? []));
    if (couldPass && !known.has(job.url)) {
      try {
        const info = (await getJSON(`${api}${p.externalPath}`)).data?.jobPostingInfo;
        if (info) {
          job.location = unique([info.location, ...(info.additionalLocations || [])]).join(" | ");
          job.primaryLocation = info.location || "";
          job.posted = info.startDate || "";
          job.description = htmlToText(info.jobDescription);
          job.pay = workdayPay(job.description);
        }
      } catch {
        // One posting that won't open is skipped this run; it's tried again next run.
      }
      await sleep(250);
    }
    jobs.push(job);
  }
  return jobs;
}

// Ashby's API address for a board. The name is encoded once (board names can have spaces).
function ashbyUrl(c) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.slug)}?includeCompensation=true`;
}

// Which parts of a run happen. --resume-only skips rechecking the job boards (about 6 minutes), for a quick
// resume: it still imports inbox.md, tailors every "New" role (and a --retailor link), builds and sends.
// Board repairs need fresh board results, so they're skipped too (and with --no-ai).
function runPlan(argv) {
  const resumeOnly = argv.includes("--resume-only");
  return { pullBoards: !resumeOnly, repairBoards: !resumeOnly && !argv.includes("--no-ai") };
}

// One company's board (an entry in search.companies): { jobs, open }, where open is the number of postings on the
// board, or null if the board doesn't exist. known: links the pull already has, so their details aren't fetched
// again. seen: seen-jobs.json, which dates the postings of boards that give no posted date (ashby-page).
async function fetchCompany(c, known = new Set(), seen = {}) {
  const slug = encodeURIComponent(c.slug);
  const ats = lc(c.ats);
  const board = (jobs) => ({ jobs, open: jobs.length });

  if (ats === "greenhouse") {
    const r = await getJSON(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true&pay_transparency=true`
    );
    return r.notFound ? null : board(greenhouseJobs(r.data, c));
  }

  if (ats === "lever") {
    let found = false;
    for (const host of ["api.lever.co", "api.eu.lever.co"]) {
      const r = await getJSON(`https://${host}/v0/postings/${slug}?mode=json`);
      if (r.notFound) continue;
      found = true;
      if (Array.isArray(r.data) && r.data.length) return board(leverJobs(r.data, c));
      await sleep(1000);
    }
    return found ? board([]) : null;
  }

  if (ats === "ashby") {
    const r = await getJSON(ashbyUrl(c));
    return r.notFound ? null : board(ashbyJobs(r.data, c));
  }

  if (ats === "ashby-page") return fetchAshbyPage(c, known, seen);

  if (ats === "gem") {
    const r = await getJSON(`https://api.gem.com/job_board/v0/${slug}/job_posts/`);
    return r.notFound ? null : board(gemJobs(r.data, c));
  }

  if (ats === "workday") {
    const jobs = await fetchWorkday(c, known);
    return jobs === null ? null : board(jobs);
  }

  throw new Error(`unknown ats "${c.ats}" (use ${ATS_TYPES.join(", ")})`);
}

// Ashby hosted pages (ats "ashby-page"), for companies whose public Ashby API is off: the job list embedded in
// jobs.ashbyhq.com/<slug>. The page has no posted dates, so each posting is dated the first time this script saw
// it, and postings already open on the company's first run get BASELINE_DATE. Only postings that pass the
// filters and aren't known yet are opened for their description.
async function fetchAshbyPage(c, known, seen) {
  const page = `https://jobs.ashbyhq.com/${encodeURIComponent(c.slug)}`;
  const res = await fetch(page, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the site answered with error ${res.status}`);
  const postings = extractAshbyPostings(await res.text());
  const hadCompany = Object.keys(seen).some((u) => u.startsWith(page + "/"));
  const nowIso = new Date().toISOString();
  const jobs = [];
  for (const p of postings) {
    const url = `${page}/${p.id}`;
    if (!seen[url]) seen[url] = hadCompany ? nowIso : BASELINE_DATE;
    const job = {
      company: c.name,
      title: p.title || "",
      location: [p.locationName, ...(p.secondaryLocations || []).map((l) => l.locationName), p.workplaceType === "Remote" ? "Remote" : ""]
        .filter(Boolean).join(" | "),
      team: "",
      pay: p.compensationTierSummary || "",
      posted: seen[url],
      url,
      description: "",
      source: `${c.name} careers page (Ashby)`,
    };
    if (passesFilters(job) && !known.has(url)) {
      job.description = await fetchAshbyDescription(url);
      await sleep(500);
    }
    jobs.push(job);
  }
  return { jobs, open: postings.length };
}

// Pulls the job list out of an Ashby hosted page (the "jobPostings" array embedded in the HTML).
function extractAshbyPostings(html) {
  const start = html.indexOf('"jobPostings":[');
  if (start < 0) throw new Error("the Ashby page has no job list");
  const from = html.indexOf("[", start);
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return JSON.parse(html.slice(from, i + 1));
  }
  throw new Error("could not read the Ashby page's job list");
}

// Full description for one Ashby posting, from its own page.
async function fetchAshbyDescription(url) {
  const res = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (!res.ok) return "";
  const html = await res.text();
  const m = html.match(/"descriptionHtml":"((?:[^"\\]|\\.)*)"/);
  return m ? htmlToText(JSON.parse(`"${m[1]}"`)) : "";
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");

// A text file's contents, or "" when it doesn't exist yet (e.g. no tailored resumes or stories so far).
function readText(file) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

// What the fact-check may quote as proof for a resume: your profile and stories, and resumes you finalized
// (not this role's own). Anything else it names is rejected. files: where each one lives (tests point it elsewhere).
function readSources(link, files = { profile: PROFILE, stories: STORIES, tailored: TAILORED_FILE }) {
  return {
    "profile/profile.md": readText(files.profile),
    "profile/stories.md": readText(files.stories),
    "outputs/tailored-resumes.md": finalSections(readText(files.tailored), { exclude: link }),
  };
}

async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

// A Claude step: the checked runner (lib/claude.mjs) plus a log line when it fails. Each step can read inside this
// folder only (READ), has no shell, and can write only the files it needs (writes).
const runCost = { usd: 0 };
// Problems collected during a run (failed Claude steps, broken or empty boards), written to workflow-log.md at
// the end. Never texted or emailed.
const runAlerts = [];
// Set (to the error) when a step failed without doing any work: not signed in, a usage limit, no network. From then
// on this run starts no more resumes, trims or scout; the roles stay "New" and the next run tries again.
let claudeDown = null;
function claudeStep(step, prompt, writes = [], opts = {}) {
  return noteStep(step, runClaude(step, prompt, { budgetUsd: settings.claude.maxUsdPerStep, ...opts, allowedTools: [...READ, ...writes] }));
}
// Each step's cost, and one plain line the first time Claude isn't answering.
function noteStep(step, r) {
  runCost.usd += r.costUsd;
  if (!r.ok && r.unavailable) {
    // One plain line for the whole run, not an alert per step.
    if (!claudeDown) logEvent("failure", `Claude isn't answering (${r.error}). Roles waiting for a resume stay New and are tried next run.`);
    claudeDown ??= r.error;
  } else if (!r.ok) {
    logEvent("failure", `${step} failed: ${r.error}`);
    runAlerts.push(`${step.replace(/…$/, "")} failed: ${r.error}`);
  }
  if (r.denials.length) logEvent("alert", `${step} tried a blocked action: ${r.denials.join("; ")}`);
  return r;
}
// The same, without blocking the script, so several resumes are written at once.
async function claudeStepAsync(step, prompt, writes = [], opts = {}) {
  const r = await runClaudeAsync(step, prompt, { budgetUsd: settings.claude.maxUsdPerStep, ...opts, allowedTools: [...READ, ...writes] });
  return noteStep(step, r);
}


// The only messages you get, by text and by email (each only if turned on in the settings): right after the pull, one
// line about the new roles, with the job list (the Numbers sheet, when that is on); then each resume, the moment it
// passes, in its own text (its line and job link, then its PDF) and its own email. Problems are never messaged; they
// go to data/workflow-log.md.
function rolesMessage(newRoles, { sheet = false } = {}) {
  if (!newRoles) return null;
  const line = `Job search: ${newRoles} new role${newRoles === 1 ? "" : "s"} added.`;
  return sheet ? `${line} The job list is attached.` : line;
}
// The job link goes on its own line: Messages cuts off a long PDF file name.
const resumeMessage = (title, link = "") => `Resume ready: ${title}${link ? `\n${link}` : ""}`;
// The text after a run with nothing new, only when notifications.imessage.everyRun is on (no attachments). It is
// sent from one place, notifyNothing, and is never a fallback for a run that has news.
const NO_MATCHES = "Run complete: no matching roles were found.";
// --numbers: the job list alone, when Numbers is on.
const SHEET_UPDATED = "Job search: the job list is updated and attached.";
const SHEET_OFF = "The Numbers sheet is off (notifications.numbers.enabled in config/preferences.json).";
// iMessage through the Mac's Messages app: one text, then each file as an attachment.
// On macOS 26 the conversation is addressed as chat id "any;-;<number>". If that conversation
// doesn't exist yet, fall back to the number as a participant of the first enabled account.
function sendIMessage(to, text, files = []) {
  const script = `on run argv
  tell application "Messages"
    try
      set target to chat id ("any;-;" & (item 1 of argv))
    on error
      set target to participant (item 1 of argv) of (1st account whose enabled is true)
    end try
    send (item 2 of argv) to target
    -- Pause between items: back-to-back sends can drop attachments while one is still uploading.
    repeat with i from 3 to count of argv
      delay 3
      send ((POSIX file (item i of argv)) as alias) to target
    end repeat
    delay 3
  end tell
end run`;
  const r = spawnSync("osascript", ["-e", script, to, text, ...files], { encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`iMessage NOT sent: ${(r.stderr || "").trim()}`);
    return false;
  }
  return true;
}

// Email through the Mac's Mail app (uses whatever account Mail sends from). Attachments go in
// ~/Pictures/agentic-job-search like the iMessage ones.
function sendEmail(to, subject, body, files = []) {
  const script = `on run argv
  tell application "Mail"
    set m to make new outgoing message with properties {subject:(item 2 of argv), content:(item 3 of argv) & return & return, visible:false}
    tell m
      make new to recipient at end of to recipients with properties {address:(item 1 of argv)}
      repeat with i from 4 to count of argv
        tell content to make new attachment with properties {file name:((POSIX file (item i of argv)) as alias)} at after the last paragraph
      end repeat
    end tell
    delay 2
    send m
  end tell
end run`;
  const r = spawnSync("osascript", ["-e", script, to, subject, body, ...files], { encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`Email NOT sent: ${(r.stderr || "").trim()}`);
    return false;
  }
  return true;
}

// A tailored resume's markdown (tailored-resumes.md layout) as plain text for an email body.
// Drops the heading and the Keywords/Sources/Version lines; keeps the keyword coverage.
function resumePlainText(md) {
  const out = [];
  for (const line of md.split("\n")) {
    if (/^---\s*$/.test(line) || /^## /.test(line) || /^(Keywords|Sources|Version|Version notes|Final|Arc):/.test(line)) continue;
    const cov = line.match(/^Link: .*Keyword coverage: ([^·\n]+)/);
    if (cov) { out.push(`Keyword coverage: ${cov[1].trim()}`); continue; }
    const h = line.match(/^### (.+)/);
    if (h) { out.push("", h[1].toUpperCase()); continue; }
    out.push(line.replace(/\*\*/g, "").replace(/^\*(.+)\*$/, "$1").replace(/^- /, "• "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Each role's draft (data/drafts/<id>.md): the only file its writer, fact-checker and trimmer work on, so up to 3
// roles are written at once and no Claude step edits outputs/tailored-resumes.md while other roles are filed.
const draftFile = (link) => join(ROOT, draftPathFor(link));
const readDraftFile = (link) => readText(draftFile(link));
const writeDraftFile = (link, text) => { mkdirSync(dirname(draftFile(link)), { recursive: true }); writeAtomic(draftFile(link), text); };
const clearDraftFile = (link) => rmSync(draftFile(link), { force: true });
// Files a finished resume in outputs/tailored-resumes.md (newest first; --retailor keeps the old one as history).
const fileSection = (link, section, { fresh = false } = {}) =>
  writeAtomic(TAILORED_FILE, mergeSection(readText(TAILORED_FILE), section, { link, fresh }));

// Builds one passed resume as .docx and .pdf in outputs/resumes/ with the template formatting (see resume-docx.mjs).
// Over one page: tailor-resume drops the least relevant bullet in the role's draft, then it is filed again and rebuilt
// (up to twice). Returns { doc }, { review } (held for you), or { later } (back to "New": Claude isn't answering).
async function buildResume(link) {
  const pick = async () => newestPerLink(await tailoredSections()).find((x) => x.url === link && !x.short);
  let s = await pick();
  if (!s) return { review: { link, title: link, problems: ["No resume with this link in outputs/tailored-resumes.md"] } };
  const name = `${s.title} | ${s.company}`;
  const held = (problems) => {
    safeStatus(link, "Needs review");
    logEvent("failure", `Needs review: ${name} after building files: ${problems.slice(0, 3).join("; ")}`);
    return { review: { link, title: name, problems } };
  };
  try {
    let r = await buildResumeFiles(s, settings);
    const draft = draftPathFor(link);
    for (let tries = 0; r.pages > 1 && tries < 2 && !claudeDown; tries++) {
      writeDraftFile(link, s.markdown);
      const trim = await claudeStepAsync(
        `Trimming "${name}" to one page (tailor-resume)…`,
        `The resume in ${draft} (Link: ${link}, "${name}") runs to ${r.pages} pages. Remove the single least relevant bullet for that job, following profile/resume-rules.md and any minBullets under resume.roles in config/preferences.json, then update that resume's Keywords line (mark ✗ any keyword only that bullet covered), its keyword coverage count, and its Sources line (remove that bullet's entry). Change nothing else. Use the Edit tool on ${draft} only.`,
        [editRule(draft)]
      );
      const trimmed = sectionFor(link, readDraftFile(link));
      clearDraftFile(link);
      if (trim.unavailable) break;
      if (trimmed) fileSection(link, trimmed);
      s = (await pick()) || s;
      r = await buildResumeFiles(s, settings);
    }
    // Claude isn't answering, so it can't be trimmed now: back to "New", and the next run checks it and trims it.
    if (r.pages > 1 && claudeDown) {
      safeStatus(link, "New");
      console.log(`${name} is over one page and Claude isn't answering, so it's back to New for the next run.`);
      return { later: true };
    }
    // Trimming changed the resume, so the code checks run again before it can be sent.
    const after = checkResume(s.markdown, { rules: settings.resume }).problems;
    if (r.pages > 1 || after.length) return held(r.pages > 1 ? [`still ${r.pages} pages after trimming`, ...after] : after);
    console.log(`Resume files: ${r.docx || r.pdf}${r.pdf ? ` + PDF (${r.pages} page${r.pages === 1 ? "" : "s"})` : ""}`);
    return { doc: { ...r, title: name, url: link, markdown: s.markdown } };
  } catch (e) {
    console.log(`Couldn't build resume files for ${name}: ${e.message}`);
    return held([`The Word/PDF build failed: ${e.message}`]);
  }
}

// One CSV line into cells (handles quoted cells and doubled quotes).
function parseCsvLine(line) {
  const cells = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { cells.push(cell); cell = ""; }
    else cell += c;
  }
  cells.push(cell);
  return cells;
}

// jobs.csv rows keyed by link: { fit, title, company }.
function csvRows(csv) {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = parseCsvLine(lines[0] || "");
  const col = (name) => head.indexOf(name);
  const rows = {};
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const link = c[col("Link")];
    if (link) rows[link] = { fit: c[col("Fit")] || "", title: c[col("Title")] || "", company: c[col("Company")] || "" };
  }
  return rows;
}

// Attachments for Messages and Mail are copied here first: Messages silently drops scripted files from most other folders.
const STAGE_DIR = join(homedir(), "Pictures", "agentic-job-search");
// Copies jobs.csv into a Numbers spreadsheet in iCloud ("Agentic Job Search" in the Numbers folder). It is the job
// list sent by iMessage and email, because its links open with a tap. Runs only when notifications.numbers is on.
// One way only: jobs.csv stays the working copy, and the spreadsheet is overwritten each run (edits made in
// Numbers don't come back).
const NUMBERS_FILE = join(homedir(), "Library/Mobile Documents/com~apple~Numbers/Documents/Agentic Job Search.numbers");
async function syncNumbers() {
  const lines = (await readFile(CSV_FILE, "utf8")).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = parseCsvLine(lines[0]);
  const keep = head.map((h, i) => i).filter((i) => head[i] !== "Fit"); // Fit is unused
  const linkCol = head.indexOf("Link");
  const rows = lines.map((l, r) => {
    const c = parseCsvLine(l);
    return keep.map((i) => {
      const v = String(c[i] ?? "").replace(/[\x1e\x1f]/g, " ");
      if (r > 0 && i === linkCol && /^https?:\/\//.test(v)) return `=HYPERLINK("${v.replace(/"/g, "%22")}","Open")`;
      return /^[=+]/.test(v) ? "'" + v : v; // never let a text cell start a formula
    });
  });
  const dataFile = join(STAGE_DIR, "numbers-sync.txt");
  await mkdir(STAGE_DIR, { recursive: true });
  await writeFile(dataFile, rows.map((r) => r.join("\x1f")).join("\x1e"));
  const script = `on run argv
  set raw to read (POSIX file (item 2 of argv)) as «class utf8»
  set AppleScript's text item delimiters to (ASCII character 30)
  set recs to text items of raw
  set AppleScript's text item delimiters to (ASCII character 31)
  set nRows to count of recs
  set grid to {}
  repeat with r from 1 to nRows
    set end of grid to text items of (item r of recs)
  end repeat
  set nCols to count of (item 1 of grid)
  set f to POSIX file (item 1 of argv)
  with timeout of 900 seconds
    tell application "Numbers"
      if (item 3 of argv) is "exists" then
        set d to open f
      else
        set d to make new document
        save d in f
      end if
      tell table 1 of sheet 1 of d
        set header row count to 1
        set footer row count to 0
        set row count to nRows
        set column count to nCols
        repeat with r from 1 to nRows
          set vals to item r of grid
          repeat with c from 1 to nCols
            set value of cell c of row r to (item c of vals)
          end repeat
        end repeat
      end tell
      save d
      close d
    end tell
  end timeout
  set AppleScript's text item delimiters to ""
end run`;
  const mode = (await stat(NUMBERS_FILE).catch(() => null)) ? "exists" : "new";
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    r = spawnSync("osascript", ["-e", script, NUMBERS_FILE, dataFile, mode], { encoding: "utf8", timeout: 960000 });
    if (r.status === 0 || attempt === 2) break;
    // Numbers was closed or still opening ("Application isn't running"): open it in the background, wait, retry.
    console.log(`Numbers sync failed (${(r.stderr || "").trim().slice(0, 80)}); opening Numbers and trying again.`);
    spawnSync("open", ["-g", "-a", "Numbers"]);
    spawnSync("sleep", ["10"]);
  }
  if (r.status !== 0) {
    console.log(`Numbers sync failed: ${(r.stderr || "").trim()}`);
    runAlerts.push(`The Numbers job list didn't update: ${(r.stderr || "").trim().slice(0, 120)}`);
    return false;
  }
  console.log(`Numbers: ${rows.length - 1} roles synced to ${NUMBERS_FILE}`);
  return true;
}

// How messages actually go out. Tests pass their own, so nothing is ever really sent.
const LIVE_IO = { sendIMessage, sendEmail, logEvent };

// The run's messages. Each goes only where its notification is turned on (targets, from notifyTargets); with
// everything off nothing is sent and no files are copied. Nothing else is ever sent.

// Right after the pull: one line about the new roles, by text and by email, with the job list when the Numbers sheet
// is on. If the sheet is on but didn't update (numbersOk false), nothing is sent: the roles are in jobs.csv and the
// next sheet. Returns true when something went out.
async function notifyNews({ targets, newRoles, numbersOk, io = LIVE_IO, stageDir = STAGE_DIR, sheetFile = NUMBERS_FILE }) {
  if (!newRoles || !(targets.imessage || targets.email) || (targets.numbers && !numbersOk)) return false;
  let sheet = null;
  if (targets.numbers) {
    await mkdir(stageDir, { recursive: true });
    sheet = join(stageDir, basename(sheetFile));
    await writeFile(sheet, await readFile(sheetFile));
  }
  const text = rolesMessage(newRoles, { sheet: !!sheet });
  let sent = false;
  if (targets.imessage) {
    if (io.sendIMessage(targets.imessage, text, sheet ? [sheet] : [])) { sent = true; console.log(`iMessage: "${text}" sent to ${targets.imessage}`); }
    else io.logEvent("failure", "The new-roles text didn't send.");
  }
  if (targets.email) {
    if (io.sendEmail(targets.email, "Job search", text, sheet ? [sheet] : [])) { sent = true; console.log(`Email: "${text}" sent to ${targets.email}`); }
    else io.logEvent("failure", "The new-roles email didn't send.");
  }
  return sent;
}

// One finished resume, the moment it passes: its own text (its line and job link, then the PDF) and its own email
// (link and full text in the body, PDF attached). Each once per version of its text (data/sent-log.json): never twice
// after a rerun, but again if it was re-tailored. A send that fails is logged; the resume goes out with a later run.
// Returns { sent }: true when it went out by text or by email.
async function notifyResume({ targets, doc: r, io = LIVE_IO, stageDir = STAGE_DIR, sentFile = SENT_LOG }) {
  if (!(targets.imessage || targets.email)) return { sent: false };
  const version = (x) => versionOf(x.markdown);
  const texting = targets.imessage && unsent([r], "resume-text", { version, file: sentFile }).length > 0;
  const emailing = targets.email && unsent([r], "resume-email", { version, file: sentFile }).length > 0;
  const src = r.pdf || r.docx;
  if (!src || !(texting || emailing)) return { sent: false };
  await mkdir(stageDir, { recursive: true });
  const file = join(stageDir, src.split("/").pop());
  await writeFile(file, await readFile(src));
  let sent = false;
  if (texting) {
    if (io.sendIMessage(targets.imessage, resumeMessage(r.title, r.url), [file])) {
      markSent([sentKey(r.url, "resume-text", version(r))], { file: sentFile });
      sent = true;
      console.log(`iMessage: "Resume ready: ${r.title}" with its link and PDF sent to ${targets.imessage}`);
    } else io.logEvent("failure", `The text for ${r.title} didn't send; it goes out with a later run.`);
  }
  if (emailing) {
    const body = [`Role: ${r.title}`, `Link: ${r.url}`, ...(r.pages > 1 ? ["⚠ Over one page."] : []), "", resumePlainText(r.markdown || "")].join("\n");
    if (io.sendEmail(targets.email, `Resume: ${r.title}`, body, [file])) {
      markSent([sentKey(r.url, "resume-email", version(r))], { file: sentFile });
      sent = true;
      console.log(`Email: resume for ${r.title} sent to ${targets.email}`);
    } else io.logEvent("failure", `The email for ${r.title} didn't send; it goes out with a later run.`);
  }
  return { sent };
}

// A run with nothing new (no new roles, no resume built): "no matching roles were found", only when everyRun is on.
function notifyNothing({ targets, io = LIVE_IO }) {
  if (!(targets.imessage && targets.everyRun)) return;
  if (io.sendIMessage(targets.imessage, NO_MATCHES, [])) console.log(`iMessage: "${NO_MATCHES}" sent to ${targets.imessage}`);
  else io.logEvent("failure", "The run-complete iMessage didn't send.");
}

// --numbers: update the Numbers sheet from jobs.csv (e.g. after changing statuses by hand) and, when iMessage is
// on, text it to you. With the sheet turned off it only says so.
async function numbersOnly({ targets, syncNumbers: sync = syncNumbers, io = LIVE_IO, stageDir = STAGE_DIR, sheetFile = NUMBERS_FILE }) {
  if (!targets.numbers) {
    console.log(SHEET_OFF);
    return;
  }
  if (await sync() && targets.imessage) {
    const copy = join(stageDir, basename(sheetFile));
    await mkdir(stageDir, { recursive: true });
    await writeFile(copy, await readFile(sheetFile));
    io.sendIMessage(targets.imessage, SHEET_UPDATED, [copy]);
  }
}

// Sorts jobs.csv newest first: by Posted date, or Found date when there's no Posted date.
// Rows are moved whole, so Fit, Status and anything you typed stay with their role.
// New rows go in on top before sorting, and ties keep their order, so among roles with the same date the
// ones found most recently stay above the earlier ones.
function orderJobsCsv(text, newLines = []) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return text;
  const head = parseCsvLine(lines[0].replace(/^﻿/, ""));
  const posted = head.indexOf("Posted"), found = head.indexOf("Found");
  const key = (line) => { const c = parseCsvLine(line); return `${c[posted] || c[found] || ""}|${c[found] || ""}`; };
  const body = [...newLines, ...lines.slice(1)].map((line, i) => ({ line, i, k: key(line) }));
  body.sort((a, b) => b.k.localeCompare(a.k) || a.i - b.i);
  return [lines[0], ...body.map((r) => r.line)].join("\n") + "\n";
}
async function sortJobsCsv(newLines = []) {
  const text = await readFile(CSV_FILE, "utf8").catch(() => "");
  if (!text.trim()) return;
  writeAtomic(CSV_FILE, orderJobsCsv(text, newLines));
}

// inbox.md: jobs you or another agent drop in (format: integrations/optional-inbox.md). A missing inbox is made
// from the template block in that guide. Returns true when it made one.
const INBOX_GUIDE = join(ROOT, "integrations", "optional-inbox.md");
const INBOX_START = "<!-- INBOX TEMPLATE START -->", INBOX_END = "<!-- INBOX TEMPLATE END -->";
function ensureInbox(file = INBOX_FILE, guide = INBOX_GUIDE) {
  if (existsSync(file)) return false;
  const text = readText(guide);
  const a = text.indexOf(INBOX_START), b = text.indexOf(INBOX_END);
  const block = a >= 0 && b > a ? text.slice(a + INBOX_START.length, b).trim() : "# Inbox\n\n<!-- ENTRIES BELOW -->";
  writeFileSync(file, block + "\n");
  return true;
}

// Entries waiting in inbox.md: anything with a link below the "Entries" marker.
async function inboxHasEntries() {
  const text = await readFile(INBOX_FILE, "utf8").catch(() => "");
  const below = text.split("<!-- ENTRIES BELOW -->")[1] || "";
  return /https?:\/\//.test(below);
}

// The researched role guide at the top of each competencies file sits between these markers.
// update-competencies must never change it; as a backstop the script saves it and puts it back if it changed.
const GUIDE_START = "<!-- ROLE GUIDE START -->", GUIDE_END = "<!-- ROLE GUIDE END -->";
const guideBlock = (text) => {
  const a = text.indexOf(GUIDE_START), b = text.indexOf(GUIDE_END);
  return a >= 0 && b > a ? text.slice(a, b + GUIDE_END.length) : null;
};
async function readRoleGuides() {
  const out = {};
  for (const { name } of settings.search.families) {
    const f = competenciesFile(name);
    out[f] = guideBlock(await readFile(f, "utf8").catch(() => ""));
  }
  return out;
}
async function restoreRoleGuides(saved) {
  for (const [f, block] of Object.entries(saved)) {
    if (!block) continue;
    const text = await readFile(f, "utf8").catch(() => "");
    const now = guideBlock(text);
    if (now === block) continue;
    let fixed;
    if (now) fixed = text.replace(now, block);
    else { const nl = text.indexOf("\n"); fixed = nl >= 0 ? text.slice(0, nl + 1) + "\n" + block + "\n" + text.slice(nl + 1) : block + "\n" + text; }
    writeAtomic(f, fixed);
    console.log(`Restored the role guide in ${f.split("/").pop()} (update-competencies changed it).`);
  }
}

// Links given with --retailor this run: tailored fresh even though a resume exists.
const retailor = new Set();
// Roles dropped in inbox.md: the skill reads them into data/inbox-import.json, then the script adds them to jobs.csv
// and the archives (also picks up a file left by a failed run).
async function readInbox(seen, today, stamp) {
  if (await inboxHasEntries()) {
    claudeStep("Reading roles from inbox.md (import-jobs)…", "Use the import-jobs skill: read the entries in inbox.md into data/inbox-import.json.",
      [editRule("inbox.md"), editRule("data/inbox-import.json")]);
  }
  return importInbox(seen, today, stamp);
}

// The files each writer and fact-checker needs, put at the top of its prompt so it doesn't spend turns opening
// them. The same files come first in the same order, so runs share a cached prefix.
const fileBlock = (path, text, note = "") => `<file path="${path}"${note ? ` note="${note}"` : ""}>\n${String(text).trim()}\n</file>`;
const LOADED = "The files below are already loaded from the project: use them as given and don't open them again (you can still read any other file you need).";
function sharedFiles(link) {
  return [
    fileBlock("profile/resume-rules.md", readText(RULES_FILE)),
    fileBlock("profile/profile.md", readText(PROFILE)),
    fileBlock("profile/stories.md", readText(STORIES)),
    fileBlock("outputs/tailored-resumes.md", finalSections(readText(TAILORED_FILE), { exclude: link }) || "(none yet)", "only the resumes you finalized, the sections with a Final: line"),
  ];
}
// The role's own section of its archive (from its ## heading to the next ---), and the role family it's in.
function jobSection(link) {
  for (const { name } of settings.search.families) {
    const text = readText(archiveFile(name));
    const at = text.indexOf(`**Link:** ${link}`);
    if (at < 0) continue;
    const start = text.lastIndexOf("\n## ", at) + 1;
    const end = text.indexOf("\n---\n", at);
    return { family: name, text: text.slice(start, end < 0 ? text.length : end) };
  }
  return null;
}
// The fact-checker's common stretches, shown to the writer too, so a first draft doesn't repeat them.
function commonStretches() {
  const text = readText(join(ROOT, ".claude/skills/check-resume/SKILL.md"));
  const a = text.indexOf("## Common stretches");
  if (a < 0) return "";
  const b = text.indexOf("\n## ", a + 3);
  return text.slice(a, b < 0 ? text.length : b).replace(/\nNever edit any file except the JSON output\.\s*$/, "").trim();
}
function writerFiles(link) {
  const rel = (f) => relative(ROOT, f);
  const parts = [LOADED, ...sharedFiles(link)];
  const stretches = commonStretches();
  if (stretches) parts.push(fileBlock(".claude/skills/check-resume/SKILL.md", stretches, "the fact-checker's common stretches: a line that matches one is sent back"));
  const job = jobSection(link);
  if (job) {
    parts.push(fileBlock(rel(archiveFile(job.family)), job.text, "only this role's section"));
    const guide = guideBlock(readText(competenciesFile(job.family)));
    if (guide) parts.push(fileBlock(rel(competenciesFile(job.family)), guide, "only the role guide; the analysis of real postings below it is in the file if you need phrasing"));
  }
  return parts.join("\n\n");
}
const checkerFiles = (link, section) =>
  [LOADED, ...sharedFiles(link), fileBlock(draftPathFor(link), section, "the resume to check")].join("\n\n");

// Every "New" role gets a resume, up to 3 written at once. Each one that passes is filed in outputs/tailored-resumes.md,
// built and sent right away; builds and sends go one at a time (Pages, Messages). Code sets each Status from the
// result; Claude never edits jobs.csv. Returns { review, built, sent, couldNot }.
const PARALLEL_RESUMES = 3;
const oneAtATime = serial();
async function tailorAll() {
  mkdirSync(CHECKS_DIR, { recursive: true });
  const deps = {
    claude: claudeStepAsync,
    readTailored: () => readText(TAILORED_FILE),
    readDraft: readDraftFile,
    writeDraft: writeDraftFile,
    readSources,
    readCheck: (p) => { try { return JSON.parse(readFileSync(join(ROOT, p), "utf8")); } catch { return null; } },
    clearCheck: (p) => rmSync(join(ROOT, p), { force: true }),
    rules: settings.resume,
    writerFiles,
    checkerFiles,
  };
  const review = [];
  const counts = { built: 0, sent: 0, couldNot: 0 };
  const deliver = (link) => oneAtATime(async () => {
    try {
      const b = await buildResume(link);
      if (b.review) { review.push(b.review); return; }
      if (b.later) return;
      counts.built++;
      if ((await notifyResume({ targets: TARGETS, doc: b.doc })).sent) counts.sent++;
    } catch (e) {
      // One resume that can't be built or sent never stops the others; it stays "Resume ready" and goes out later.
      review.push({ link, title: link, problems: [`Building or sending stopped: ${e.message}`] });
      logEvent("failure", `Building or sending the resume for ${link} stopped: ${e.message}`);
    }
  });
  // Ready resumes that didn't go out on a channel that is on (an earlier run stopped before sending, or a send
  // failed), listed before this run builds any. A resume that was already ready when a channel was turned on is never
  // sent on it (lib/sent-log.mjs).
  const tailoredNow = readText(TAILORED_FILE);
  const earlier = resumesToRetry(getRows(), { channels: { "resume-text": !!TARGETS.imessage, "resume-email": !!TARGETS.email }, builtNow: [], sectionOf: (link) => sectionFor(link, tailoredNow) });
  const deliveries = earlier.map(deliver);
  // Each link once, even if a row was duplicated by hand.
  const waiting = getRows().filter((r, i, all) => r.Status === "New" && all.findIndex((x) => x.Link === r.Link) === i);
  if (!waiting.length) console.log("\nNo new roles to tailor resumes for.");
  else if (claudeDown) console.log(`\nClaude isn't answering, so ${waiting.length} role(s) stay New for the next run.`);
  // Up to 3 roles at once; once Claude isn't answering, no more start, and those roles keep the Status "New".
  const roles = (claudeDown ? [] : waiting).map((row) => ({ link: row.Link, title: row.Title, company: row.Company, fresh: retailor.has(row.Link) }));
  const { stopped } = await tailorRoles(roles, deps, { limit: PARALLEL_RESUMES, onResult: (role, res) => {
    const name = `${role.title} | ${role.company}`;
    if (res.section) fileSection(role.link, res.section, { fresh: role.fresh });
    clearDraftFile(role.link);
    safeStatus(role.link, res.status);
    console.log(`→ ${name}: ${res.status} (${res.tries} tr${res.tries === 1 ? "y" : "ies"})`);
    if (res.status === "Resume ready") {
      logEvent("success", `Resume ready: ${name} (passed code checks and fact-check on try ${res.tries})`);
      deliveries.push(deliver(role.link)); // built and sent while the next role is being written
    } else if (res.status === "Could not tailor") {
      counts.couldNot++;
      logEvent("run", `Could not tailor ${name}: under 70% keyword coverage with true material`);
    } else {
      review.push({ link: role.link, title: name, problems: res.problems });
      logEvent("failure", `Needs review: ${name} after ${res.tries} tries: ${res.problems.slice(0, 3).join("; ")}`);
    }
  } });
  if (stopped) console.log(`\nClaude isn't answering (${stopped.error}), so ${stopped.left} role(s) stay New for the next run.`);
  await Promise.all(deliveries);
  await sortJobsCsv(); // keep newest first
  return { review, ...counts };
}

// update-competencies, once a day, after the messages: role families whose archive grew wait in data/competencies.json
// until the day's first run. A run that can't update (--no-ai, or Claude isn't answering) or whose update fails leaves
// them waiting.
const COMPETENCIES_STATE = join(DATA_DIR, "competencies.json");
async function competenciesOnceADay(grew, { run = true } = {}) {
  let state = null;
  try { state = JSON.parse(readFileSync(COMPETENCIES_STATE, "utf8")); } catch {}
  const today = localDay();
  const plan = competenciesPlan(state, today, grew);
  let next = { last: state?.last || null, pending: plan.pending };
  if (run && !claudeDown && plan.files.length) {
    const guides = await readRoleGuides();
    const rel = (f) => relative(ROOT, f);
    const r = claudeStep(
      `Updating competencies for ${plan.files.join(", ")} (update-competencies)…`,
      `Use the update-competencies skill on these archives, which got new postings: ${plan.files.map((fam) => `${rel(archiveFile(fam))} (competencies file: ${rel(competenciesFile(fam))})`).join(", ")}.`,
      [editRule("archives/competencies-*.md")]
    );
    await restoreRoleGuides(guides);
    if (r.ok) next = { last: today, pending: [] };
  }
  if (JSON.stringify(next) !== JSON.stringify(state)) writeAtomic(COMPETENCIES_STATE, JSON.stringify(next, null, 1));
}

// jobs.csv is a running list: new roles are added and never removed, then it's sorted newest first.
// Fit is no longer filled in (there is no rating step); it stays first and Link last. Status starts as "New" (or
// "Backlog": see landingStatus); the code sets "Resume ready", "Could not tailor" or "Needs review" after the writer +
// checker loop; you set "Applied", "Recruiter screen", "Rejected" or "Skip", and setting a held role back to "New" retries it.
// status: one Status for every role, or a function giving each role's.
async function addToJobsCsv(jobs, today, status = "New") {
  const statusOf = typeof status === "function" ? status : () => status;
  const header = ["Fit", "Status", "Company", "Title", "Location", "Team", "Pay", "Pay check", "Posted", "Found", "Link"];
  let csv = await readFile(CSV_FILE, "utf8").catch(() => "");
  const firstLine = csv.replace(/^﻿/, "").split(/\r?\n/)[0].replace(/"/g, "");
  if (firstLine !== header.join(",")) {
    // Missing, or from an older version of the script: keep any old rows in jobs.csv.old, start fresh.
    if (csv.trim().split(/\r?\n/).length > 1) await writeFile(CSV_FILE + ".old", csv);
    csv = "﻿" + header.map(csvCell).join(",") + "\n";
    writeAtomic(CSV_FILE, csv);
  }
  const rows = jobs.map((j) =>
    ["", statusOf(j), j.company, j.title, j.location, j.team, j.pay, j.payStatus, day(j.posted), today, j.url].map(csvCell).join(",")
  );
  await sortJobsCsv(rows);
}

// Each role family (search.families) has its own archive, archives/jobs-<family>.md, append-only. A posting is
// skipped if its link is already in ANY archive (including one from a family since renamed), or if the same
// company and title are already in its own archive.
// Returns the families whose archives grew and a one-line summary per archive.
async function addToArchives(jobs, stamp) {
  await mkdir(ARCHIVES_DIR, { recursive: true });
  const archives = {};
  const allLinks = new Set();
  const others = (await readdir(ARCHIVES_DIR)).filter((f) => /^jobs-.+\.md$/.test(f)).map((f) => join(ARCHIVES_DIR, f));
  for (const f of others) for (const m of (await readFile(f, "utf8").catch(() => "")).matchAll(/\*\*Link:\*\* (\S+)/g)) allLinks.add(m[1]);
  for (const { name: family } of settings.search.families) {
    const file = archiveFile(family);
    const text = await readFile(file, "utf8").catch(() => "");
    archives[family] = { file, text, roles: new Set() };
    for (const m of text.matchAll(/^## (.+?) \| (.+)$/gm)) archives[family].roles.add(`${m[2]}|${m[1]}`.toLowerCase());
  }
  const roleKey = (j) => `${j.company}|${j.title}`.toLowerCase();
  const addByFamily = {};
  for (const j of jobs) {
    const family = archiveFor(j.title);
    const a = archives[family];
    if (!j.url || allLinks.has(j.url) || a.roles.has(roleKey(j))) continue;
    allLinks.add(j.url);
    a.roles.add(roleKey(j));
    (addByFamily[family] ??= []).push(j);
  }

  const summary = [], grew = [];
  for (const [family, { file, text }] of Object.entries(archives)) {
    const toAdd = addByFamily[family] || [];
    const md = [];
    // Every archive exists from the first run, even before it has any postings.
    if (!text) md.push(`# ${family} job descriptions`, "", "Append-only archive. Each run adds only postings not already listed.", "");
    if (toAdd.length) {
      grew.push(family);
      md.push(`# Run ${stamp}: ${toAdd.length} new`, "");
      for (const j of toAdd) {
        md.push("---", "", `## ${j.title} | ${j.company}`, "");
        md.push(
          `**Location:** ${j.location || "n/a"}  `,
          `**Team:** ${j.team || "n/a"}  `,
          `**Pay:** ${j.pay || "not listed"}  `,
          `**Pay check:** ${j.payStatus}  `,
          `**Source:** ${j.source || "Company job board"}  `,
          `**Posted:** ${day(j.posted) || "n/a"}  `,
          `**Link:** ${j.url}`,
          "",
          j.description || "(no description provided)",
          ""
        );
      }
    }
    if (md.length) await appendFile(file, md.join("\n") + "\n");
    summary.push(`${family}: ${toAdd.length} added`);
  }
  return { grew, summary };
}

// Roles the import-jobs skill extracted into data/inbox-import.json go into jobs.csv and the archives here,
// with the same pay check as every other role. No title/location filtering: whoever put them in the inbox
// already chose them. Links already in jobs.csv are skipped. The file is deleted afterwards.
async function importInbox(seen, today, stamp) {
  const text = await readFile(IMPORT_FILE, "utf8").catch(() => null);
  if (text === null) return { imported: [], grew: [] };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // Never lose the inbox's roles: keep the unreadable file under a dated name and say so.
    const kept = IMPORT_FILE.replace(/\.json$/, `-unreadable-${stamp.replace(/[ :]/g, "-")}.json`);
    await writeFile(kept, text);
    await rm(IMPORT_FILE, { force: true });
    console.log(`The inbox import file wasn't valid JSON (${e.message}). Saved as ${kept}.`);
    runAlerts.push(`Couldn't read the inbox's roles; saved as ${kept} for a retry.`);
    return { imported: [], grew: [] };
  }
  const list = Array.isArray(raw) ? raw : [];
  const rowsNow = csvRows(await readFile(CSV_FILE, "utf8").catch(() => ""));
  const inCsv = new Set(Object.keys(rowsNow));
  const inCsvKeys = new Map();
  for (const [link, r] of Object.entries(rowsNow)) addKeyLink(inCsvKeys, roleKeyOf(r.company, r.title), link);
  const jobs = [];
  let duplicates = 0;
  for (const e of list) {
    const url = String(e.url || e.link || "").trim();
    // Same link, or same company + title under another link (e.g. a job site vs the careers site) = already listed.
    if (!url || inCsv.has(url) || isListedRepost(inCsvKeys, roleKeyOf(e.company, e.title), url) || jobs.some((j) => j.url === url)) { duplicates++; continue; }
    const j = {
      company: e.company || "", title: e.title || "", location: e.location || "", team: e.team || "",
      pay: e.pay || "", posted: e.posted || "", url, description: e.description || "", source: "Inbox",
    };
    j.payStatus = compStatus(j);
    jobs.push(j);
  }
  await addToJobsCsv(jobs, today);
  const { grew } = await addToArchives(jobs, stamp);
  for (const j of jobs) if (!seen[j.url]) seen[j.url] = today; // a later pull never lists them twice
  writeAtomic(SEEN_FILE, JSON.stringify(seen, null, 2));
  await rm(IMPORT_FILE, { force: true });
  if (list.length) console.log(`Inbox: imported ${jobs.length}, skipped ${duplicates} already in jobs.csv.`);
  return { imported: jobs.map((j) => j.url), grew };
}

// Status changes go through here: a row that can't be found (duplicate, edited link) becomes an alert, not a crash.
function safeStatus(link, status) {
  try {
    setStatus(link, status);
    return true;
  } catch (e) {
    runAlerts.push(`Couldn't set "${status}" for ${link}: ${e.message}`);
    return false;
  }
}

// A board that just hit its 3rd bad run in a row: log an alert (the repair agent hooks in here).
const brokenBoards = [];
function boardAlert({ alert }, company) {
  if (!alert) return;
  runAlerts.push(alert);
  brokenBoards.push({ company, alert });
}

// Repair agent: for each board that just hit 3 bad runs, investigate and propose a fix (never applied automatically).
function repairBoards() {
  mkdirSync(PROPOSALS_DIR, { recursive: true });
  for (const { company, alert } of brokenBoards.splice(0)) {
    const r = diagnoseBoard(company, alert, { budgetUsd: settings.claude.maxUsdPerStep, claude: (step, prompt, opts) => claudeStep(step, prompt, opts.allowedTools.filter((x) => !READ.includes(x)), opts) });
    if (r.ok) {
      runAlerts.push(`Proposed fix for ${company.name}: ${r.proposal} (ask Claude to apply it)`);
      logEvent("decision", `Repair agent proposed a fix for ${company.name}'s board: ${r.proposal}`);
    }
  }
}

// Scout agent: once a week (the day and hour in schedule.scout, only if it is turned on), propose companies to add.
// You decide; nothing is added automatically.
function scoutIfDue() {
  let last = null;
  try { last = JSON.parse(readFileSync(SCOUT_FILE, "utf8")).last; } catch {}
  if (!shouldScout(new Date(), last, settings.schedule.scout)) return;
  // Claude isn't answering this run: the scout stays due and runs on a later run.
  if (claudeDown) return;
  mkdirSync(PROPOSALS_DIR, { recursive: true });
  const r = runScout({ budgetUsd: settings.claude.maxUsdScout, claude: (step, prompt, opts) => claudeStep(step, prompt, opts.allowedTools.filter((x) => !READ.includes(x)), opts) });
  if (r.unavailable) return;
  writeAtomic(SCOUT_FILE, JSON.stringify({ last: new Date().toISOString(), proposal: r.proposal, ok: r.ok }));
  if (!r.ok) return;
  logEvent("decision", `Scout agent proposed companies to add: ${r.proposal}`);
}

// Writes everything that went wrong this run to workflow-log.md, once. Nothing is texted or emailed.
function logAlerts() {
  for (const a of runAlerts) logEvent("alert", a);
  runAlerts.length = 0;
}

// End of every run: one log line when anything happened, then a git snapshot of the state.
// Quiet runs (nothing new, nothing failed) aren't logged; data/health.json shows each board's last run.
// One line for the workflow log: counts resumes actually sent, and any built but not sent. With no text or email
// turned on (notify false) nothing is expected to be sent, so it just counts the resumes built.
function runSummary({ added = 0, firstBacklog = 0, built = 0, sent = 0, held = 0, couldNot = 0, backlog = false, costUsd = 0, notify = true } = {}) {
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const parts = [`${n(added, "new role")}${backlog ? " (Backlog)" : firstBacklog ? ` (${firstBacklog} Backlog, first pull)` : ""}`];
  if (!notify) {
    if (built) parts.push(`${n(built, "resume")} built`);
  } else {
    if (sent) parts.push(`${n(sent, "resume")} sent`);
    if (built > sent) parts.push(`${n(built - sent, "resume")} built but not sent`);
  }
  if (held) parts.push(`${held} held for review`);
  if (couldNot) parts.push(`${couldNot} could not tailor`);
  if (costUsd) parts.push(`Claude $${costUsd.toFixed(2)}`);
  return parts.join(", ");
}

// The alert for resumes built but not sent, only when a text or email was supposed to send them.
function unsentAlert({ built = 0, sent = 0, notify = true } = {}) {
  return notify && built > sent ? `${built - sent} resume(s) were built but didn't go out; they'll be sent next run.` : null;
}

function finishRun(stamp, counts = {}) {
  const { added = 0, built = 0, held = 0, couldNot = 0 } = counts;
  const notSent = unsentAlert(counts);
  if (notSent) runAlerts.push(notSent);
  const summary = runSummary({ ...counts, costUsd: runCost.usd });
  if (added || built || held || couldNot || runAlerts.length) logEvent("run", summary);
  try {
    if (snapshotRun(`run ${stamp}: ${summary}`)) console.log("Git: run saved");
  } catch (e) {
    console.log(`Git snapshot failed: ${e.message}`);
    runAlerts.push(`This run couldn't be saved to git history: ${e.message.slice(0, 120)}`);
  }
  logAlerts();
}

// Reads every company's board, up to 8 at once (one at a time took minutes; now it takes about as long as the slowest
// board). Results are logged in the list's order. Returns { kept, problems, firstPull, readOk }: kept, the postings that
// pass the title and location rules; problems, the companies whose board couldn't be read; firstPull, the names of the
// companies whose board is being read for the first time (lib/first-pull.mjs); readOk, the boards read successfully,
// which the run records once their roles are written. fetchBoard, record, pulledFile, limit and log are stand-ins for tests.
async function pullCompanies(companies, { known = new Set(), seen = {}, fetchBoard = fetchCompany, record = recordBoard, pulledFile = PULLED_FILE, limit = 8, log = console.log } = {}) {
  const kept = [], problems = [], readOk = [];
  const boards = await mapLimit(companies, limit, (c) => fetchBoard(c, known, seen));
  boards.forEach((board, i) => {
    const c = companies[i];
    if (board instanceof Error) {
      problems.push(c.name);
      log(`✗ ${c.name}: ${board.message}`);
      boardAlert(record(c.name, { error: board.message }), c);
    } else if (board === null) {
      problems.push(c.name);
      log(`✗ ${c.name}: board not found. Check the slug "${c.slug}" in its careers URL.`);
      boardAlert(record(c.name, { error: `board not found (slug "${c.slug}")` }), c);
    } else {
      const hits = board.jobs.map(noteRemote).filter((j) => passesFilters(j));
      kept.push(...hits);
      readOk.push(c);
      log(`✓ ${c.name}: ${hits.length} match (of ${board.open} open)`);
      boardAlert(record(c.name, { open: board.open }), c);
    }
  });
  return { kept, problems, firstPull: firstPulls(readOk, { file: pulledFile }), readOk };
}

// The Status a new role from a job board lands with: "Backlog" in a --backlog run, or when its company's board is
// being read for the first time (those roles were already open, so they don't all get paid resumes at once);
// otherwise "New".
function landingStatus(job, { backlog = false, firstPull = new Set() } = {}) {
  return backlog || firstPull.has(job.company) ? "Backlog" : "New";
}

async function main() {
  // Your profile files exist, and the hard rules in profile/resume-rules.md are as the code checks them.
  // This runs only here, inside the lock, so a run that refuses to start (settings problems) makes no files.
  ensureProfileFiles();
  if (restoreRulesFile()) logEvent("alert", "Hard rules section of profile/resume-rules.md was edited; it was put back.");
  mkdirSync(dirname(TAILORED_FILE), { recursive: true });
  if (ensureInbox()) console.log("Made inbox.md: drop in jobs you find elsewhere and the next run imports them.");
  // Which of text and email are on, noted before anything is built: the first run that finds one on marks the resumes
  // already ready as handled on it, so they're never sent (lib/sent-log.mjs). Noted now, a resume this run builds can
  // never be taken for an old one, even if the run stops before sending.
  const tailoredAtStart = readText(TAILORED_FILE);
  noteChannels(getRows(), { channels: { "resume-text": !!TARGETS.imessage, "resume-email": !!TARGETS.email }, sectionOf: (link) => sectionFor(link, tailoredAtStart) });
  const seen = await readJSON(SEEN_FILE);
  const seenBefore = new Set(Object.keys(seen)); // postings from earlier runs are never listed again
  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toLocaleString("sv-SE", { hour12: false }).slice(0, 16); // local "YYYY-MM-DD HH:MM"

  // --backlog: a one-time catch-up (e.g. after adding companies). New roles are added with Status
  // "Backlog" instead of "New", and no resumes or alerts are made.
  const backlog = process.argv.includes("--backlog");
  // --retailor <link>: that role goes back to "New" and gets a fresh resume (e.g. after new facts or narratives).
  // The old resume stays in outputs/tailored-resumes.md as history.
  const ri = process.argv.indexOf("--retailor");
  if (ri > -1) {
    const link = process.argv[ri + 1] || "";
    if (getRows().some((r) => r.Link === link)) {
      safeStatus(link, "New");
      retailor.add(link);
    } else console.log(`--retailor: no role in jobs.csv has the link ${link}`);
  }
  // --numbers: only copy jobs.csv to the Numbers spreadsheet (e.g. after changing statuses by hand).
  if (process.argv.includes("--numbers")) {
    await numbersOnly({ targets: TARGETS });
    logAlerts();
    return;
  }

  const plan = runPlan(process.argv);
  const companies = settings.search.companies;
  console.log(`\n===== Run ${stamp}${backlog ? " (backlog catch-up)" : ""}${plan.pullBoards ? "" : " (resume only)"} =====`);
  if (plan.pullBoards) console.log(`Pulling every open role from ${companies.length} compan${companies.length === 1 ? "y" : "ies"}, keeping ones not seen before…\n`);
  else console.log("Resume only: job boards not checked this run.\n");
  const known = new Set([...seenBefore, ...getRows().map((r) => r.Link)]);
  const { kept, problems, firstPull, readOk } = await pullCompanies(plan.pullBoards ? companies : [], { known, seen });

  // One row per posting, only postings not seen on an earlier run, then the pay rule.
  // Roles that fail the pay rule are dropped.
  // A role already in jobs.csv under another link (same company + title) also counts as seen.
  const listedKeys = new Map();
  for (const [link, r] of Object.entries(csvRows(await readFile(CSV_FILE, "utf8").catch(() => "")))) addKeyLink(listedKeys, roleKeyOf(r.company, r.title), link);
  const fresh = new Map();
  for (const j of kept) {
    const key = roleKeyOf(j.company, j.title);
    if (!j.url || seenBefore.has(j.url) || fresh.has(j.url) || isListedRepost(listedKeys, key, j.url)) continue;
    addKeyLink(listedKeys, key, j.url);
    fresh.set(j.url, j);
  }
  const afterPay = [];
  for (const j of fresh.values()) {
    j.payStatus = compStatus(j);
    if (!j.payStatus.startsWith("Fail")) afterPay.push(j);
  }
  kept.splice(0, kept.length, ...afterPay);
  for (const j of kept) if (!seen[j.url]) seen[j.url] = today;
  kept.sort((a, b) => String(b.posted).localeCompare(String(a.posted)));

  // A company's first pull lands as "Backlog" (landingStatus). Its board is recorded as read only after its roles are
  // in jobs.csv and seen-jobs.json: if the run stops before that, the next run treats it as a first pull again.
  await addToJobsCsv(kept, today, (j) => landingStatus(j, { backlog, firstPull }));
  const { grew, summary } = await addToArchives(kept, stamp);
  writeAtomic(SEEN_FILE, JSON.stringify(seen, null, 2));
  recordPulls(readOk);
  console.log(`Archives: ${summary.join(", ")}.`);
  const firstBacklog = backlog ? 0 : kept.filter((j) => firstPull.has(j.company)).length;

  console.log(`\nDone. ${kept.length} new role${kept.length === 1 ? "" : "s"}.`);
  if (firstBacklog) console.log(`First pull for this board (${[...firstPull].join(", ")}): ${firstBacklog} new role(s) land as "Backlog", with no resumes. Set any to "New" to get a resume.`);
  if (problems.length) console.log(`Couldn't read: ${problems.join(", ")}`);
  console.log(`Spreadsheet:       ${CSV_FILE}`);
  console.log(`Full descriptions: ${settings.search.families.map((f) => archiveFile(f.name)).join(", ")}`);

  if (backlog) {
    console.log(`\nBacklog catch-up: ${kept.length} roles added with Status "Backlog". Change any to "New" to get a resume.`);
    if (TARGETS.numbers) await syncNumbers();
    finishRun(stamp, { added: kept.length, backlog: true });
    return;
  }
  const noAi = process.argv.includes("--no-ai");
  // The inbox first, so its roles are in the new-roles message and get resumes this run.
  const inbox = noAi ? { imported: [], grew: [] } : await readInbox(seen, today, stamp);
  const newRoles = kept.length + inbox.imported.length;

  // 1. One line about the new roles, right away (with the job list when the Numbers sheet is on).
  // 2. Resumes, up to 3 at once, each sent the moment it passes. Sends go one at a time, the new-roles line first; the
  //    writers start while the sheet is being updated and sent.
  const newsSent = newRoles && (TARGETS.imessage || TARGETS.email)
    ? oneAtATime(async () => notifyNews({ targets: TARGETS, newRoles, numbersOk: TARGETS.numbers ? await syncNumbers() : false }))
      .catch((e) => logEvent("failure", `The new-roles message stopped: ${e.message}`))
    : null;
  const result = noAi ? null : tailorAll();
  await newsSent;
  const done = (await result) || { review: [], built: 0, sent: 0, couldNot: 0 };

  // 3. A run with nothing new texts "no matching roles were found", only when everyRun is on.
  if (!newRoles && !done.built) notifyNothing({ targets: TARGETS });

  // 4. After the messages: the Numbers copy of jobs.csv (only when it's turned on) gets the final statuses, then the
  //    slower upkeep: competencies (once a day), board repairs, and the scout when it is due.
  if (TARGETS.numbers) await syncNumbers();
  await competenciesOnceADay([...new Set([...grew, ...inbox.grew])], { run: !noAi });
  if (plan.repairBoards) repairBoards();
  if (!noAi) scoutIfDue();

  // Anything that went wrong this run (failed steps, broken boards) goes to workflow-log.md; then the snapshot.
  finishRun(stamp, { added: kept.length, firstBacklog, built: done.built, sent: done.sent, held: done.review.length, couldNot: done.couldNot, notify: !!(TARGETS.imessage || TARGETS.email) });
}

// Runs only when started as a program (node scripts/job-pull.mjs), so tests can import the functions.
// The settings come first: with any problem, it says what to fix and stops before the lock or any file.
if (isMain(import.meta.url)) {
  const loaded = loadSettings();
  if (loaded.problems.length) {
    for (const p of loaded.problems) console.log(`✗ ${p}`);
    console.log(`Run "node scripts/check-setup.mjs" or /setup in Claude Code.`);
    process.exitCode = 1;
  } else {
    useSettings(loaded.settings);
    mkdirSync(DATA_DIR, { recursive: true }); // the lock lives in data/, which a fresh setup doesn't have yet
    withLock(main)
      .then((r) => { if (!r.ran) console.log(`\nAnother run is still going (data/job-pull.lock), so this one was skipped.`); })
      .catch((err) => {
        console.error(`Something went wrong: ${err.message}`);
        runAlerts.push(`The hourly run crashed: ${err.message}`);
        logAlerts();
        process.exit(1);
      });
  }
}

export {
  useSettings, pullCompanies, landingStatus, passesFilters, noteRemote, sameRolePosting, compStatus, archiveFor, orderJobsCsv, extractAshbyPostings, fetchCompany, runPlan, ensureInbox,
  notifyTargets, notifyNews, notifyResume, notifyNothing, numbersOnly, unsentAlert, NO_MATCHES, SHEET_UPDATED, SHEET_OFF, payMax, workdayPay, workdayListBody, fetchWorkday, ashbyJobs, ashbyUrl, runSummary, rolesMessage, resumeMessage, resumePlainText,
  CSV_FILE, TAILORED_FILE, readSources, writerFiles, checkerFiles, jobSection,
};
