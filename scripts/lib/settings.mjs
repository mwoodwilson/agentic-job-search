// The settings file (config/preferences.json): defaults, validation, and loading.
// A required answer is null (or empty) until the user fills it in; validateSettings names each one that is still open.
import { readFileSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { ROOT, SETTINGS_FILE, PROFILE } from "./paths.mjs";

export const ATS_TYPES = ["greenhouse", "lever", "ashby", "ashby-page", "gem", "workday"];

export const DEFAULTS = {
  candidate: { name: null, contact: null },
  search: {
    companies: [], titleKeywords: null, titleExclude: [], locationKeywords: null, usOnly: true,
    pay: null, families: [{ name: "Jobs", titleKeywords: [] }],
  },
  resume: { template: "templates/resume-template.docx", roles: [], maxBullets: null, note: "", banned: [] },
  notifications: { imessage: { enabled: false, to: "", everyRun: false }, email: { enabled: false, to: "" }, numbers: { enabled: false } },
  schedule: { hourly: false, scout: { enabled: false, day: "Monday", hour: 9 } },
  claude: { maxUsdPerStep: 3, maxUsdScout: 5 },
};

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const blank = (v) => typeof v !== "string" || v.trim() === "";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Copy of v without any key that starts with "_" (the example file's "_about" notes), at every depth.
function dropNotes(v) {
  if (Array.isArray(v)) return v.map(dropNotes);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("_")).map(([k, x]) => [k, dropNotes(x)]));
  return v;
}

function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

// DEFAULTS under raw: objects merge key by key, anything else the user wrote (arrays, null, numbers) replaces the default.
export function withDefaults(raw) {
  return merge(structuredClone(DEFAULTS), dropNotes(isObj(raw) ? raw : {}));
}

// True when profile.md has real writing in it: at least 300 characters left after removing comments, headings and blank lines.
export function profileFilledIn(text) {
  if (typeof text !== "string") return false;
  const kept = text.replace(/<!--[\s\S]*?(-->|$)/g, "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return kept.join("\n").length >= 300;
}

// One plain message per problem, each naming the setting's path. profileMissing: profile/profile.md doesn't exist (not just blank).
export function validateSettings(s, { profileText = "", profileMissing = false } = {}) {
  const out = [];
  const add = (m) => out.push(m);

  if (!isObj(s.candidate)) add("candidate is missing: add your name and contact line.");
  else {
    if (blank(s.candidate.name)) add("candidate.name is blank: put your name as it should appear at the top of each resume.");
    if (blank(s.candidate.contact)) add("candidate.contact is blank: put the contact line for the top of each resume (email · phone · city).");
  }

  const search = isObj(s.search) ? s.search : {};
  if (!Array.isArray(search.companies) || search.companies.length === 0) {
    add("search.companies is empty: add at least one company to watch, as { name, ats, slug }.");
  } else {
    search.companies.forEach((c, i) => {
      const at = `search.companies[${i}]`;
      if (!isObj(c)) return add(`${at} should be { name, ats, slug }.`);
      if (blank(c.name)) add(`${at}.name is blank.`);
      if (!ATS_TYPES.includes(c.ats)) add(`${at}.ats is ${JSON.stringify(c.ats ?? null)}, which isn't a job board type this tool can read. Use one of: ${ATS_TYPES.join(", ")}.`);
      if (blank(c.slug)) add(`${at}.slug is blank: it comes from the company's careers page address.`);
      if (c.facets !== undefined && !isObj(c.facets)) add(`${at}.facets should be an object, or left out.`);
      if (c.titles !== undefined && !(Array.isArray(c.titles) && c.titles.length && c.titles.every((t) => !blank(t)))) add(`${at}.titles should be a list of title words, such as ["product marketing"], or left out.`);
    });
  }
  if (!Array.isArray(search.titleKeywords) || search.titleKeywords.length === 0) {
    add("search.titleKeywords is empty: list the words a job title must contain to be kept, such as \"product manager\".");
  }
  if (!Array.isArray(search.locationKeywords)) {
    add("search.locationKeywords isn't answered: list the places you'd work, or use [] for anywhere.");
  }
  if (!isObj(search.pay)) {
    add("search.pay isn't answered: set { \"minTop\": 0, \"minBaseTop\": 0 } for no pay floor, or the minimums in dollars.");
  } else {
    for (const k of ["minTop", "minBaseTop"]) {
      if (!isNum(search.pay[k]) || search.pay[k] < 0) add(`search.pay.${k} should be a number of dollars (0 for no floor).`);
    }
  }
  if (!Array.isArray(search.families) || search.families.length === 0) {
    add("search.families is empty: keep at least one family, such as { \"name\": \"Jobs\", \"titleKeywords\": [] }.");
  } else {
    search.families.forEach((f, i) => {
      if (!isObj(f) || blank(f.name)) add(`search.families[${i}].name is blank.`);
      if (!isObj(f) || !Array.isArray(f.titleKeywords)) add(`search.families[${i}].titleKeywords should be a list (empty matches every title).`);
    });
  }

  const resume = isObj(s.resume) ? s.resume : {};
  if (resume.maxBullets !== null && (!Number.isInteger(resume.maxBullets) || resume.maxBullets < 1)) add("resume.maxBullets should be a whole number of 1 or more, or null for no limit.");
  if (!Array.isArray(resume.roles)) add("resume.roles should be a list.");
  else resume.roles.forEach((r, i) => {
    if (!isObj(r) || blank(r.title)) add(`resume.roles[${i}].title is blank.`);
    if (!isObj(r) || blank(r.companyLine)) add(`resume.roles[${i}].companyLine is blank: write it like "Company (Location) · Start – End".`);
    if (isObj(r) && r.minBullets !== undefined && (!Number.isInteger(r.minBullets) || r.minBullets < 0)) add(`resume.roles[${i}].minBullets should be a whole number.`);
  });
  if (!Array.isArray(resume.banned)) add("resume.banned should be a list.");
  else resume.banned.forEach((b, i) => {
    let valid = isObj(b) && !blank(b.pattern);
    if (valid) try { new RegExp(b.pattern); } catch { valid = false; }
    if (!valid) add(`resume.banned[${i}].pattern should be a valid regular expression.`);
    if (!isObj(b) || blank(b.why)) add(`resume.banned[${i}].why is blank: say why that wording is banned.`);
  });

  const n = isObj(s.notifications) ? s.notifications : {};
  for (const k of ["imessage", "email"]) {
    if (isObj(n[k]) && n[k].enabled === true && blank(n[k].to)) add(`notifications.${k}.to is blank: add an address, or turn notifications.${k}.enabled off.`);
  }
  if (isObj(n.imessage) && typeof n.imessage.everyRun !== "boolean") add("notifications.imessage.everyRun should be true or false.");

  const scout = isObj(s.schedule) && isObj(s.schedule.scout) ? s.schedule.scout : {};
  if (!DAYS.includes(scout.day)) add(`schedule.scout.day should be a day of the week, such as "Monday".`);
  if (!Number.isInteger(scout.hour) || scout.hour < 0 || scout.hour > 23) add("schedule.scout.hour should be a whole number from 0 to 23.");

  const claude = isObj(s.claude) ? s.claude : {};
  for (const k of ["maxUsdPerStep", "maxUsdScout"]) {
    if (!isNum(claude[k]) || claude[k] <= 0) add(`claude.${k} should be a dollar amount above 0.`);
  }

  if (profileMissing) {
    add("profile/profile.md doesn't exist yet: run \"node scripts/check-setup.mjs\" or /setup to create it, then fill it in (write your experience and numbers under each heading).");
  } else if (!profileFilledIn(profileText)) {
    add("profile/profile.md isn't filled in yet (it's missing or still the blank template): write your experience and numbers under each heading.");
  }
  return out;
}

// How to show a file's location in a message: relative to the project when it's inside it.
function label(file) {
  const rel = relative(ROOT, file);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : file;
}

// Read, merge and check the settings file. settings is null only when the file can't be used at all.
export function loadSettings({ file = SETTINGS_FILE, profileFile = PROFILE } = {}) {
  const name = label(file);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { settings: null, problems: [`${name} doesn't exist yet. Run /setup to create it, or copy config/preferences.example.json to ${name} and fill in the blanks.`] };
    return { settings: null, problems: [`${name} can't be read (${e.code || e.message}).`] };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { settings: null, problems: [`${name} isn't valid JSON (${String(e.message).split("\n")[0]}). Look for a missing or extra comma, quote or bracket, or run /setup to rebuild it.`] };
  }
  if (!isObj(raw)) return { settings: null, problems: [`${name} must hold one JSON object ({ ... }) with your settings. Run /setup to rebuild it.`] };
  let profileText = "";
  let profileMissing = false;
  try { profileText = readFileSync(profileFile, "utf8"); } catch (e) { profileMissing = e.code === "ENOENT"; } // unreadable counts as not filled in
  const settings = withDefaults(raw);
  return { settings, problems: validateSettings(settings, { profileText, profileMissing }) };
}
