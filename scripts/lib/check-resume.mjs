// Code checks for a tailored resume section (outputs/tailored-resumes.md layout). These are the rules that
// don't need judgment, so code checks them instead of the model grading itself. Five of the six hard rules are
// fixed here: 1 a summary of 300–350 characters, 2 bullets of 200 characters or less, 3 a number in every bullet,
// 4 two time-bound results in each of the two most recent roles, and 6 keyword coverage of at least 70% recomputed
// from the ✓/✗ list. (Rule 5, that every line is backed by a quote from your files, is confirmed by verifyCheck
// below, after the fact-check.) The four section headings are also required. Your own rules come from the resume
// settings: role titles and company lines, bullet limits, the experience note and banned wording. Without them, only
// the hard rules and the headings are checked.
// verifyCheck() then confirms the separate check-resume skill's verdicts: every bullet checked, and every
// "supported" bullet backed by a quote that really exists in your files.

// Text for comparing lines: a bold lead like "**20% PM Project:**" is dropped (parseSection drops it too).
const norm = (s) => String(s ?? "").replace(/^\s*\*\*[^*]+\*\*\s*/, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ")
  .replace(/\s+/g, " ").trim().toLowerCase();

// The experience note without the asterisks that make it italic: the setting is written as plain text, the resume
// line is "*note*", and both are compared this way (a setting that includes the asterisks still matches).
const plainNote = (s) => String(s ?? "").trim().replace(/^\*+|\*+$/g, "").trim();

const HEADINGS = ["### Professional Summary", "### Professional Experience", "### Education & Certifications", "### Skills"];

// A result that says when, or over what period, it happened. Any one match makes a bullet time-bound:
//   +40% YoY, +12% QoQ, year-over-year    shorthand for a change over a period
//   in 2025, since Q2 2026, FY25, March 2025    a date
//   within 3 months, over the first 6 weeks    a window
//   200 tickets/month, 5 hours per week    a rate
//   $2M in annual savings, year to date, last year    a stated period
// A bare number never counts: "launched in 3 markets" and "grew revenue 18%" are not time-bound, and neither are
// counts that look like years ("cut tickets by 2000", "from 2000 to 5200", "for 2000 stores"): by, from and for
// don't lead a year.
const PERIOD = "day|week|month|quarter|year|hour|sprint";
const COUNT = String.raw`(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
const YEAR = String.raw`(?:19|20)\d{2}`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
export const TIME_BOUND = new RegExp([
  String.raw`\b(?:yoy|qoq)\b`,
  String.raw`(?<=[\d%]\s?)(?:mom|wow)\b`, // only after a number, so "mom-and-pop" isn't read as month-over-month
  String.raw`\b(?:year|quarter|month|week)[- ]over[- ](?:year|quarter|month|week)\b`,
  String.raw`\b(?:ytd|qtd|mtd|year[- ]to[- ]date)\b`,
  String.raw`\b(?:q[1-4]|h[12])\b`,
  String.raw`\bfy\s?'?\d{2,4}\b`,
  String.raw`\b(?:in|during|since|through|throughout|until|before|after|across)\s+(?:(?:early|mid|late)[- ])?${YEAR}\b`,
  String.raw`\b${MONTH}\s+${YEAR}\b`,
  String.raw`\b(?:(?:within|in|over|across|after|under|during|inside|for|than)\s+(?:the\s+)?(?:(?:first|last|past|next)\s+)?|(?:first|last|past|next)\s+)(?:(?:about|just|only|nearly|roughly)\s+)?${COUNT}[- ]?(?:${PERIOD})s?\b`,
  String.raw`\b(?:this|last|prior|previous|next)\s+(?:${PERIOD}|half)\b`,
  String.raw`\b(?:annual|annually|annualized|yearly)\b`,
  String.raw`\bper\s+(?:${PERIOD}|wk|mo|yr|hr)\b`,
  String.raw`/\s?(?:${PERIOD}|wk|mo|yr|hr|qtr)s?\b`,
].join("|"), "i");
// How many of these bullets say when or over what period (a bullet counts once however many phrases it has).
export const timeBoundCount = (bullets) => bullets.filter((b) => TIME_BOUND.test(b)).length;

const STOP = new Set(["and", "or", "the", "a", "an", "of", "to", "for", "with", "in", "on", "from", "by", "at", "as", "&"]);

export function parseSection(md) {
  const lines = md.split("\n");
  const link = (md.match(/^Link: (\S+)/m) || [])[1] || "";
  const cov = md.match(/Keyword coverage: (\d+)\/(\d+)/);
  const kwLine = (lines.find((l) => l.startsWith("Keywords: ")) || "").slice("Keywords: ".length);
  const keywords = kwLine ? kwLine.split(/,\s*(?=[✓✗])/).map((k) => ({ ok: k.trim().startsWith("✓"), kw: k.trim().slice(1).trim() })) : [];
  const block = (h) => {
    const i = lines.indexOf(h);
    if (i < 0) return [];
    const j = lines.findIndex((l, k) => k > i && l.startsWith("### "));
    return lines.slice(i + 1, j < 0 ? lines.length : j);
  };
  const summary = block("### Professional Summary").filter((l) => l.trim()).join(" ").trim();
  const exp = block("### Professional Experience");
  const note = (exp.find((l) => /^\*[^*].*\*$/.test(l.trim())) || "").trim();
  const roles = [];
  // What the roles don't account for: bold lines that aren't role lines (their bullets would join the role above)
  // and bullets above the first role line.
  const badRoleLines = [], looseBullets = [];
  for (const l of exp) {
    const m = l.match(/^\*\*(.+?)\*\* · (.+)$/);
    const bullet = l.startsWith("- ") ? l.slice(2).replace(/^\*\*[^*]+\*\*\s*/, "").trim() : null;
    if (m) roles.push({ title: m[1].trim(), rest: m[2].trim(), bullets: [] });
    else if (bullet !== null) (roles.length ? roles.at(-1).bullets : looseBullets).push(bullet);
    else if (l.trim().startsWith("**")) badRoleLines.push(l.trim());
  }
  const skills = block("### Skills").filter((l) => l.trim()).join(" ").trim();
  return { link, coverage: cov ? { x: +cov[1], y: +cov[2] } : null, keywords, summary, note, roles, badRoleLines, looseBullets, skills, headings: lines.filter((l) => l.startsWith("### ")) };
}

// The summary's sentences, which the fact-check covers along with the bullets.
export const summarySentences = (s) => s.summary.split(/(?<=[.!?])\s+(?=[A-Z$0-9])/).filter(Boolean);
const bodyOf = (s) => norm([s.summary, ...s.roles.flatMap((r) => r.bullets), s.skills].join(" "));

function keywordFound(kw, body) {
  const alts = [kw.replace(/\([^)]*\)/g, " "), ...[...kw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])]
    .flatMap((a) => a.split("/")).map((a) => a.trim()).filter(Boolean);
  return alts.some((alt) => {
    const words = norm(alt).split(/[^a-z0-9+#]+/).filter((w) => w && !STOP.has(w));
    return words.length > 0 && words.every((w) => (w.length <= 3 ? new RegExp(`\\b${w.replace(/[+#]/g, "\\$&")}\\b`).test(body) : body.includes(w.length > 5 ? w.slice(0, 5) : w)));
  });
}

// rules: the resume settings (settings.resume): roles [{ title, companyLine, minBullets }], maxBullets, note,
// banned [{ pattern, why }]. Each one that is left empty adds no rule, so {} checks only the hard rules and headings.
export function checkResume(md, { rules = {} } = {}) {
  const { roles: wantRoles = [], maxBullets = null, note = "", banned = [] } = rules ?? {};
  const wantNote = plainNote(note);
  const s = parseSection(md);
  const problems = [];
  for (const h of HEADINGS) if (!s.headings.includes(h)) problems.push(`Missing section heading "${h}" (Skills, Summary, Experience and Education are all required)`);

  // Rules 2–5 read each role's bullets, so every role line and bullet has to be readable as part of a role.
  const SHAPE = "**Title** · Company (Location) · Dates";
  if (!s.roles.length) problems.push(`No role lines found under "### Professional Experience"; each role is a line like ${SHAPE}`);
  for (const l of s.badRoleLines) problems.push(`Experience line isn't a role line (write it as ${SHAPE}): "${l.slice(0, 60)}${l.length > 60 ? "…" : ""}"`);
  for (const b of s.looseBullets) problems.push(`Bullet before the first role line (every bullet goes under a role written as ${SHAPE}): "${b.slice(0, 60)}${b.length > 60 ? "…" : ""}"`);

  // Your rules: role order, titles and company lines, bullet limits, the experience note, banned wording.
  if (wantRoles.length) {
    if (s.roles.length !== wantRoles.length) problems.push(`Expected ${wantRoles.length} roles (resume.roles in your settings), found ${s.roles.length}`);
    s.roles.forEach((r, i) => {
      const want = wantRoles[i];
      if (!want) return;
      const wantLine = `**${want.title}** · ${want.companyLine}`;
      if (r.title !== want.title || r.rest !== want.companyLine) {
        problems.push(`Role ${i + 1} must read "${wantLine}"; found "**${r.title}** · ${r.rest}"`);
      } else if (Number.isInteger(want.minBullets) && r.bullets.length < want.minBullets) {
        problems.push(`"${r.title}": needs at least ${want.minBullets} bullets (has ${r.bullets.length})`);
      }
    });
  }
  if (Number.isInteger(maxBullets)) {
    for (const r of s.roles) if (r.bullets.length > maxBullets) problems.push(`"${r.title}": at most ${maxBullets} bullets (has ${r.bullets.length})`);
  }
  if (wantNote && plainNote(s.note) !== wantNote) problems.push(`Experience note should read *${wantNote}*`);
  const text = [s.summary, ...s.roles.flatMap((r) => r.bullets)].join("\n");
  for (const b of banned) {
    let re;
    try { re = new RegExp(b.pattern, "i"); } catch { continue; } // an invalid pattern is reported when the settings are checked
    const hit = text.match(re);
    if (hit) problems.push(`${b.why}: "${hit[0]}"`);
  }

  // Hard rules 1–3: every bullet is 200 characters or less and has a number; the summary is 300–350 characters.
  for (const b of [...s.looseBullets, ...s.roles.flatMap((r) => r.bullets)]) {
    if (b.length > 200) problems.push(`Bullet over 200 characters (${b.length}): "${b.slice(0, 60)}…"`);
    if (!/\d/.test(b)) problems.push(`Bullet has no number (every bullet needs a quantified outcome): "${b.slice(0, 60)}…"`);
  }
  const summaryLength = [...s.summary].length;
  if (summaryLength < 300 || summaryLength > 350) problems.push(`Summary is ${summaryLength} characters; it must be 300–350 (counting spaces)`);

  // Hard rule 4: each of the two most recent roles (the first two listed) has at least 2 time-bound results.
  for (const r of s.roles.slice(0, 2)) {
    const n = timeBoundCount(r.bullets);
    if (n < 2) problems.push(`"${r.title}": needs at least 2 time-bound results (has ${n}); aim for 3, e.g. "+40% YoY", "in 2025", "within 3 months"`);
  }

  // Hard rule 6: keyword coverage is at least 70%, and the count the writer claims matches its ✓ marks.
  const ticks = s.keywords.filter((k) => k.ok).length;
  const total = s.keywords.length;
  if (!s.coverage || !total) problems.push("Missing the Keyword coverage count or the Keywords list");
  else {
    if (s.coverage.x !== ticks) problems.push(`Coverage line claims ${s.coverage.x} but ${ticks} keywords are marked ✓`);
    if (s.coverage.y !== total) problems.push(`Coverage line claims ${s.coverage.y} keywords but the list has ${total}`);
    if (ticks / total < 0.7) problems.push(`Keyword coverage ${ticks}/${total} (${Math.round((100 * ticks) / total)}%) is under 70%`);
  }
  const body = bodyOf(s);
  const softMisses = s.keywords.filter((k) => k.ok && !keywordFound(k.kw, body)).map((k) => k.kw);
  return { problems, softMisses, ticks, total };
}

// Bullets from resumes you finalized are valid sources too (you wrote or finalized them).
export function finalSections(tailoredText, { exclude } = {}) {
  return String(tailoredText).split(/\n---\n/)
    .filter((sec) => /^Final:/m.test(sec) && !(exclude && parseSection(sec).link === exclude)).join("\n");
}

// check: the check-resume skill's JSON. sources: { "profile/profile.md": text, … } (only these count).
export function verifyCheck(check, md, sources, { only } = {}) {
  const s = parseSection(md);
  const required = only || [...summarySentences(s), ...s.roles.flatMap((r) => r.bullets)];
  const entries = check?.bullets || [];
  const problems = [];
  for (const b of required) {
    const e = entries.find((x) => norm(x.text) === norm(b));
    if (!e) { problems.push(`Line not checked: "${b.slice(0, 60)}…"`); continue; }
    if (e.verdict !== "supported") { problems.push(`${e.verdict || "unsupported"}: ${e.issue || "no reason given"} (bullet: "${b.slice(0, 60)}…")`); continue; }
    // Only the files you gave it count; inherited names such as "constructor" are not files.
    const src = Object.hasOwn(sources, e.source_file) ? sources[e.source_file] : undefined;
    const q = norm(e.source_quote);
    if (src === undefined) problems.push(`Source "${e.source_file}" isn't one of your files (bullet: "${b.slice(0, 60)}…")`);
    else if (q.length < 15 || !norm(src).includes(q)) problems.push(`quote not found in ${e.source_file}: "${e.source_quote}" (bullet: "${b.slice(0, 60)}…")`);
  }
  const body = bodyOf(s);
  const unconfirmed = (check?.keywords || [])
    .filter((k) => !(k.found && norm(k.resume_quote).length >= 3 && body.includes(norm(k.resume_quote))))
    .map((k) => k.keyword);
  return { problems, unconfirmed };
}
