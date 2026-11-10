import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ATS_TYPES, DEFAULTS, withDefaults, validateSettings, profileFilledIn, loadSettings } from "../scripts/lib/settings.mjs";
import { SETTINGS_EXAMPLE } from "../scripts/lib/paths.mjs";
import { filledSettings, LONG_PROFILE } from "./helpers.mjs";

const filled = filledSettings();
const longProfile = LONG_PROFILE;
const tmp = () => mkdtempSync(join(tmpdir(), "settings-"));
const BLANK_TEMPLATE = "# Profile\n\n<!-- Write your story here. Keep it short. -->\n\n## Summary\n\n<!-- Two or three sentences on who you are. -->\n\n## Experience\n\n<!-- One section per job:\n     what you did and the numbers. -->\n\n## Skills\n";

test("a complete settings file has no problems", () => assert.deepEqual(validateSettings(withDefaults(filled), { profileText: longProfile }), []));

test("each required field is named when missing", () => {
  for (const [path, mutate] of [["candidate.name", (s) => (s.candidate.name = null)], ["candidate.contact", (s) => (s.candidate.contact = "")],
    ["search.companies", (s) => (s.search.companies = [])], ["search.titleKeywords", (s) => (s.search.titleKeywords = [])],
    ["search.locationKeywords", (s) => (s.search.locationKeywords = null)], ["search.pay", (s) => (s.search.pay = null)]]) {
    const s = withDefaults(structuredClone(filled)); mutate(s);
    assert.ok(validateSettings(s, { profileText: longProfile }).some((p) => p.includes(path)), path);
  }
});

test("an unknown board type is named", () => {
  const raw = filledSettings();
  raw.search.companies[0].ats = "taleo";
  const problems = validateSettings(withDefaults(raw), { profileText: longProfile });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /search\.companies\[0\]\.ats/);
  assert.ok(problems[0].includes("taleo"));
  for (const t of ATS_TYPES) assert.ok(problems[0].includes(t), `lists ${t}`);
});

test("a company missing its name or slug is named", () => {
  const raw = filledSettings();
  raw.search.companies = [{ name: "", ats: "lever", slug: "x" }, { name: "Beta", ats: "lever", slug: " " }];
  const problems = validateSettings(withDefaults(raw), { profileText: longProfile });
  assert.ok(problems.some((p) => p.includes("search.companies[0].name")));
  assert.ok(problems.some((p) => p.includes("search.companies[1].slug")));
});

test("a blank profile.md blocks the run", () => {
  const problems = validateSettings(withDefaults(filled), { profileText: BLANK_TEMPLATE });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /profile\/profile\.md/);
});

test("profileFilledIn ignores comments, headings and blank lines, and needs 300 characters", () => {
  assert.equal(profileFilledIn(BLANK_TEMPLATE), false);
  assert.equal(profileFilledIn(""), false);
  assert.equal(profileFilledIn(undefined), false);
  assert.equal(profileFilledIn(longProfile), true);
  assert.equal(profileFilledIn("x".repeat(299)), false);
  assert.equal(profileFilledIn("x".repeat(300)), true);
  assert.equal(profileFilledIn("## " + "x".repeat(500)), false, "a heading doesn't count");
  assert.equal(profileFilledIn("<!--\n" + "x".repeat(500) + "\n-->"), false, "a multi-line comment doesn't count");
  assert.equal(profileFilledIn("<!-- " + "x".repeat(500)), false, "an unclosed comment doesn't count");
  assert.equal(profileFilledIn("x".repeat(150) + "<!-- gone -->" + "x".repeat(150)), true, "text around a comment still counts");
});

test("notifications default to off", () => {
  const s = withDefaults(filled);
  assert.equal(s.notifications.imessage.enabled, false); assert.equal(s.notifications.email.enabled, false); assert.equal(s.notifications.numbers.enabled, false);
});

test("the text after every run is off by default, and must be true or false", () => {
  assert.equal(withDefaults(filled).notifications.imessage.everyRun, false);
  assert.equal(DEFAULTS.notifications.imessage.everyRun, false);
  const raw = filledSettings();
  raw.notifications = { imessage: { enabled: true, to: "+15550100199", everyRun: "yes" } };
  assert.deepEqual(validateSettings(withDefaults(raw), { profileText: longProfile }), ["notifications.imessage.everyRun should be true or false."]);
  raw.notifications.imessage.everyRun = true;
  assert.deepEqual(validateSettings(withDefaults(raw), { profileText: longProfile }), []);
  const example = JSON.parse(readFileSync(new URL("../config/preferences.example.json", import.meta.url), "utf8"));
  assert.equal(example.notifications.imessage.everyRun, false);
});

test("an enabled notification needs an address", () => {
  const raw = filledSettings();
  raw.notifications = { imessage: { enabled: true, to: "" }, email: { enabled: true, to: "jordan@example.com" } };
  const problems = validateSettings(withDefaults(raw), { profileText: longProfile });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /notifications\.imessage\.to/);
  raw.notifications.email.to = "  ";
  assert.ok(validateSettings(withDefaults(raw), { profileText: longProfile }).some((p) => p.includes("notifications.email.to")));
  raw.notifications = { imessage: { enabled: false, to: "" }, numbers: { enabled: true } };
  assert.deepEqual(validateSettings(withDefaults(raw), { profileText: longProfile }), [], "numbers needs no address; a disabled one needs none");
});

test("the example file is not enough to run: it has blanks to fill in", () => {
  const example = JSON.parse(readFileSync(SETTINGS_EXAMPLE, "utf8"));
  const problems = validateSettings(withDefaults(example), { profileText: longProfile });
  assert.ok(problems.some((p) => p.includes("candidate.name")));
  for (const f of ["candidate.contact", "search.companies", "search.titleKeywords", "search.locationKeywords", "search.pay"]) {
    assert.ok(problems.some((p) => p.includes(f)), f);
  }
});

test("the example file has every setting and explains each section", () => {
  const example = JSON.parse(readFileSync(SETTINGS_EXAMPLE, "utf8"));
  const walk = (o, path = "") => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? [path + k, ...walk(v, path + k + ".")] : [path + k]);
  const have = new Set(walk(JSON.parse(JSON.stringify(example), (k, v) => (k.startsWith("_") ? undefined : v))));
  for (const p of walk(DEFAULTS)) assert.ok(have.has(p), `example is missing ${p}`);
  const objects = (o, path = "") => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? [[path + k, v], ...objects(v, path + k + ".")] : []);
  for (const [path, obj] of [["(top level)", example], ...objects(example)]) {
    assert.equal(typeof obj._about, "string", `${path} needs an _about`);
    assert.ok(obj._about.length > 20, `${path} _about is too short`);
  }
});

test("withDefaults fills gaps, keeps answers, drops _ keys and doesn't touch DEFAULTS", () => {
  const raw = { _about: "hi", candidate: { _about: "x", name: "Jordan Reyes" }, search: { usOnly: false, families: [{ _note: "n", name: "PM", titleKeywords: ["product"] }] } };
  const s = withDefaults(raw);
  assert.equal(s.candidate.name, "Jordan Reyes");
  assert.equal(s.candidate.contact, null);
  assert.equal(s.search.usOnly, false);
  assert.deepEqual(s.search.families, [{ name: "PM", titleKeywords: ["product"] }], "arrays are replaced, not merged");
  assert.equal("_about" in s, false);
  assert.equal("_about" in s.candidate, false);
  assert.equal(s.claude.maxUsdPerStep, 3);
  assert.equal(s.schedule.scout.day, "Monday");
  s.search.companies.push({ name: "X" });
  s.notifications.imessage.enabled = true;
  assert.deepEqual(DEFAULTS.search.companies, []);
  assert.equal(DEFAULTS.notifications.imessage.enabled, false);
  assert.deepEqual(withDefaults(null), withDefaults({}));
});

test("other settings are checked and named when wrong", () => {
  const bad = (mutate) => { const raw = filledSettings(); mutate(raw); return validateSettings(withDefaults(raw), { profileText: longProfile }); };
  assert.ok(bad((r) => (r.search.pay = { minTop: "a lot", minBaseTop: 0 })).some((p) => p.includes("search.pay.minTop")));
  assert.ok(bad((r) => (r.search.pay = { minTop: 0, minBaseTop: -1 })).some((p) => p.includes("search.pay.minBaseTop")));
  assert.ok(bad((r) => (r.search.families = [])).some((p) => p.includes("search.families")));
  assert.ok(bad((r) => (r.search.families = [{ name: "", titleKeywords: [] }])).some((p) => p.includes("search.families[0].name")));
  assert.ok(bad((r) => (r.resume = { maxBullets: 0 })).some((p) => p.includes("resume.maxBullets")));
  assert.ok(bad((r) => (r.resume = { roles: [{ title: "PM" }] })).some((p) => p.includes("resume.roles[0].companyLine")));
  assert.ok(bad((r) => (r.resume = { banned: [{ pattern: "(", why: "x" }] })).some((p) => p.includes("resume.banned[0].pattern")));
  assert.ok(bad((r) => (r.resume = { banned: [{ pattern: "foo", why: "" }] })).some((p) => p.includes("resume.banned[0].why")));
  assert.ok(bad((r) => (r.schedule = { scout: { day: "Funday" } })).some((p) => p.includes("schedule.scout.day")));
  assert.ok(bad((r) => (r.schedule = { scout: { hour: 24 } })).some((p) => p.includes("schedule.scout.hour")));
  assert.ok(bad((r) => (r.claude = { maxUsdPerStep: 0 })).some((p) => p.includes("claude.maxUsdPerStep")));
  assert.deepEqual(bad((r) => { r.resume = { maxBullets: 4, roles: [{ title: "PM", companyLine: "Larkfield (Chicago, IL) · 2020 – 2024", minBullets: 2 }], banned: [{ pattern: "\\bsynergy\\b", why: "buzzword" }] }; }), []);
});

test("a preferences.json that isn't valid JSON gives a plain message", () => {
  const file = join(tmp(), "preferences.json");
  writeFileSync(file, '{"candidate": {,}');
  const { settings, problems } = loadSettings({ file, profileFile: join(tmp(), "none.md") });
  assert.equal(settings, null);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes("config/preferences.json isn't valid JSON") || problems[0].includes(file), problems[0]);
  assert.ok(problems[0].includes("isn't valid JSON"));
  assert.ok(!problems[0].includes("at JSON.parse"));
});

test("a preferences.json that isn't an object gives a plain message", () => {
  const file = join(tmp(), "preferences.json");
  writeFileSync(file, "[1, 2]");
  const { settings, problems } = loadSettings({ file, profileFile: join(tmp(), "none.md") });
  assert.equal(settings, null);
  assert.match(problems[0], /must hold one JSON object/);
});

test("a missing preferences.json says how to create it", () => {
  const { settings, problems } = loadSettings({ file: join(tmp(), "preferences.json"), profileFile: join(tmp(), "none.md") });
  assert.equal(settings, null);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes("copy config/preferences.example.json"));
  assert.ok(problems[0].includes("/setup"));
});

test("loadSettings returns the merged settings and any problems", () => {
  const dir = tmp();
  const file = join(dir, "preferences.json");
  const profileFile = join(dir, "profile.md");
  writeFileSync(file, JSON.stringify(filledSettings()));
  writeFileSync(profileFile, longProfile);
  const ok = loadSettings({ file, profileFile });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.settings.candidate.name, "Jordan Reyes");
  assert.equal(ok.settings.claude.maxUsdScout, 5);
  writeFileSync(profileFile, BLANK_TEMPLATE);
  const blank = loadSettings({ file, profileFile });
  assert.equal(blank.problems.length, 1);
  assert.match(blank.problems[0], /profile\/profile\.md/);
  assert.equal(blank.settings.candidate.name, "Jordan Reyes");
  const noProfile = loadSettings({ file, profileFile: join(dir, "missing.md") });
  assert.match(noProfile.problems[0], /profile\/profile\.md/);
});

test("a missing profile.md says to run check-setup or /setup to create it, then fill it in", () => {
  const dir = tmp();
  const file = join(dir, "preferences.json");
  writeFileSync(file, JSON.stringify(filledSettings()));
  const { problems } = loadSettings({ file, profileFile: join(dir, "profile.md") });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^profile\/profile\.md doesn't exist yet/);
  assert.ok(problems[0].includes("node scripts/check-setup.mjs"));
  assert.ok(problems[0].includes("/setup"));
  assert.match(problems[0], /to create it, then fill it in/);
  // A profile that exists but is still blank keeps the "isn't filled in" message.
  const blank = join(dir, "blank.md");
  writeFileSync(blank, BLANK_TEMPLATE);
  const blankProblems = loadSettings({ file, profileFile: blank }).problems;
  assert.equal(blankProblems.length, 1);
  assert.match(blankProblems[0], /isn't filled in yet/);
  assert.doesNotMatch(blankProblems[0], /doesn't exist/);
});
