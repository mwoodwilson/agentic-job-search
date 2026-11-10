#!/usr/bin/env node
// Resume DOCX/PDF: turns each tailored resume in outputs/tailored-resumes.md into a Word file and a PDF that
// keep the exact formatting of your template (resume.template in the settings; the sample is
// templates/resume-template.docx).
// It reuses the template's own paragraphs: section headings, rules and spacing stay as they are. Your name and
// contact line (candidate.name and candidate.contact in the settings) fill the first two lines, and the summary,
// roles, bullets, education and skills are replaced with the tailored text.
// Run:  node scripts/resume-docx.mjs        (builds files for any tailored resume that doesn't have them yet)
// Output: outputs/resumes/<role family>/<Your Name> Resume (<Company> - <Title>).docx and ".pdf". The folder is
// the role family (search.families in the settings), picked from the job title the same way job-pull.mjs picks the job archive.
// If you saved your own edited version as a .pages file with the same name, nothing is rebuilt for that
// resume, so your version (and the PDF made from it) is never overwritten.
// A short version (only made when you ask; its section in tailored-resumes.md has a "Version: short" line)
// uses [brackets] instead: "<Your Name> Resume [<Company> - <Title>].pdf". (parentheses) = full, [brackets] = short.
// The PDF is made by Pages, which must be installed. Without it you still get the Word file: Pages is looked for once
// per run (lib/pages.mjs, without opening a dialog), and when it's missing the PDF step is skipped.

import { readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";

import { ROOT, OUT_DIR, TAILORED_FILE } from "./lib/paths.mjs";
import { loadSettings } from "./lib/settings.mjs";
import { isMain } from "./lib/entry.mjs";
import { oncePerRun } from "./lib/pages.mjs";

// ---------- reading the tailored resume ----------

// Parses one resume section written in the tailored-resumes.md format (see the tailor-resume skill).
export function parseResume(md) {
  const sections = {};
  let current = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) { current = h[1].toLowerCase(); sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  const find = (word) => sections[Object.keys(sections).find((k) => k.includes(word))] || [];
  const text = (lines) => lines.map((l) => l.trim()).filter((l) => l && !/^-{3,}$/.test(l)).join(" ");

  const roles = [];
  let note = "";
  for (const raw of find("experience")) {
    const line = raw.trim();
    if (!line) continue;
    const role = line.match(/^\*\*(.+?)\*\*\s*·\s*(.+?)\s*·\s*(.+)$/);
    if (role) {
      const cl = role[2].match(/^(.*?)\s*\(([^()]+)\)\s*$/);
      roles.push({ title: role[1], company: cl ? cl[1] : role[2], location: cl ? cl[2] : "", dates: role[3], bullets: [] });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet && roles.length) {
      const b = bullet[1];
      const bold = b.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      roles.at(-1).bullets.push(bold ? { lead: bold[1], text: bold[2] } : { lead: "", text: b });
      continue;
    }
    const n = line.match(/^\*(.+)\*$/);
    if (n && !roles.length) note = n[1];
  }
  // One entry per line under "### Education & Certifications": "School | Degree | Year", bullet marks dropped.
  const education = find("education").map((l) => l.trim().replace(/^[-*]\s+/, "")).filter((l) => l && !/^-{3,}$/.test(l));
  return { summary: text(find("summary")), note, roles, education, skills: text(find("skills")) };
}

// ---------- template surgery ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tText = (s) => `<w:t xml:space="preserve">${esc(s)}</w:t>`;

// Skills line: non-breaking spaces inside each skill so Word never splits one across lines.
export const skillsLine = (text) => String(text).split(" | ").map((x) => x.trim().replace(/ /g, "\u00a0")).join(" | ");
const paraText = (p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const pPr = (p) => (p.match(/^<w:p\b[^>]*>(<w:pPr>.*?<\/w:pPr>)?/s) || [])[1] || "";
const runs = (p) => [...p.matchAll(/<w:r\b[^>]*>.*?<\/w:r>/gs)].map((m) => m[0]);
const runText = (r) => [...r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const rPr = (r) => (r.match(/<w:rPr>.*?<\/w:rPr>/s) || [""])[0];
const firstTextRunPr = (p) => rPr(runs(p).find((r) => runText(r).trim()) || "");
// Same run formatting, made bold (replacing any explicit "bold off" the template set).
const bold = (pr) => {
  if (!pr) return '<w:rPr><w:b w:val="1"/><w:bCs w:val="1"/></w:rPr>';
  const base = pr.replace(/<w:b(?:Cs)?\b[^>]*\/>/g, "");
  return base.replace(/(<w:rFonts[^>]*\/>)|(<w:rPr>)(?![\s\S]*<w:rFonts)/, (m) => m + '<w:b w:val="1"/><w:bCs w:val="1"/>');
};
// Same run formatting, made italic.
const italic = (pr) => (pr ? pr.replace(/<w:i(?:Cs)?\b[^>]*\/>/g, "").replace("</w:rPr>", '<w:i w:val="1"/><w:iCs w:val="1"/></w:rPr>') : '<w:rPr><w:i w:val="1"/><w:iCs w:val="1"/></w:rPr>');
// Same run formatting, with bold and italic taken off.
const unstyled = (pr) => pr.replace(/<w:(?:b|bCs|i|iCs)\b[^>]*\/>/g, "");
// The formatting of a line's plain text: its first run that isn't a hyperlink's blue style.
const plainRunPr = (p) => rPr(runs(p).find((r) => runText(r).trim() && !/Hyperlink/.test(rPr(r))) || runs(p).find((r) => runText(r).trim()) || "");
// Copies keep Word's paragraph ids unique by dropping them.
const clean = (p) => p.replace(/ w14:(paraId|textId)="[^"]*"/g, "");
const para = (proto, inner) => `<w:p>${pPr(proto)}${inner}</w:p>`;
const run = (pr, inner) => `<w:r>${pr}${inner}</w:r>`;

function analyse(body) {
  const paras = [...body.matchAll(/<w:p\b[^>]*>.*?<\/w:p>|<w:p\b[^>]*\/>/gs)].map((m) => m[0]);
  const txt = paras.map((p) => paraText(p).trim());
  const idx = (re, from = 0) => txt.findIndex((t, i) => i >= from && re.test(t));
  const summaryH = idx(/^PROFESSIONAL SUMMARY/);
  const expH = idx(/^PROFESSIONAL EXPERIENCE/);
  const eduH = idx(/^EDUCATION/);
  const skillsH = idx(/^SKILLS$/);
  const missing = [["PROFESSIONAL SUMMARY", summaryH], ["PROFESSIONAL EXPERIENCE", expH], ["EDUCATION", eduH], ["SKILLS", skillsH]].filter(([, i]) => i === -1).map(([n]) => n);
  if (missing.length) throw new Error(`template is missing a section heading: ${missing.join(", ")}`);
  // Your name and contact line: the first two non-empty paragraphs above the summary heading.
  const headerIdx = paras.map((p, i) => i).filter((i) => i < summaryH && txt[i]).slice(0, 2);
  if (headerIdx.length < 2) throw new Error("template needs a name line and a contact line above PROFESSIONAL SUMMARY");
  const summaryP = idx(/\S/, summaryH + 1);
  // The template's education lines: the text paragraphs between the Education heading and the Skills heading.
  const eduIdx = paras.map((p, i) => i).filter((i) => i > eduH && i < skillsH && txt[i]);
  const skillsP = idx(/\S/, skillsH + 1);
  const inExp = (i) => i > expH && i < eduH;
  const roleIdx = paras.map((p, i) => i).filter((i) => inExp(i) && txt[i] && /<w:tabs>/.test(paras[i]));
  const bulletIdx = paras.map((p, i) => i).filter((i) => inExp(i) && /<w:numPr>/.test(paras[i]));
  // The paragraphs that make up one role in the template: role line, spacers, company line, spacers, first bullet.
  const unit = (role) => {
    const company = idx(/\S/, role + 1);
    const bullet = bulletIdx.find((i) => i > role);
    return {
      role: paras[role], company: paras[company], bullet: paras[bullet],
      gapAfterRole: paras.slice(role + 1, company), gapAfterCompany: paras.slice(company + 1, bullet),
    };
  };
  // Bullet text uses the formatting most bullets in the template share, so one odd bullet doesn't spread.
  const counts = {};
  for (const i of bulletIdx) { const pr = firstTextRunPr(paras[i]); counts[pr] = (counts[pr] || 0) + 1; }
  const bulletRunPr = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    paras, headerIdx, summaryP, expH, eduH, skillsP, firstRole: roleIdx[0], lastBullet: bulletIdx.at(-1), bulletRunPr,
    eduFirst: eduIdx[0], eduLast: eduIdx.at(-1) ?? eduH,
    // Later roles often carry extra space above them, so they follow the template's second role.
    firstUnit: unit(roleIdx[0]), laterUnit: unit(roleIdx[1] ?? roleIdx[0]),
  };
}

// Gives paragraph p at least `twips` of space above it, unless the heading above already leaves that much.
function spaceBefore(p, heading, twips) {
  const num = (s, a) => Number((s.match(new RegExp(`w:${a}="([\\d.]+)"`)) || [])[1] || 0);
  const headSpacing = (pPr(heading).match(/<w:spacing\b[^>]*\/>/) || [""])[0];
  const ppr = pPr(p);
  const spacing = (ppr.match(/<w:spacing\b[^>]*\/>/) || [""])[0];
  if (num(headSpacing, "after") + num(spacing, "before") >= twips) return p;
  const newPpr = spacing
    ? ppr.replace(spacing, spacing.replace(/\s*w:before="[^"]*"/, "").replace(/\/>$/, ` w:before="${twips}"/>`))
    : ppr.replace(/(<w:ind\b|<w:jc\b|<w:rPr>|<\/w:pPr>)/, `<w:spacing w:before="${twips}"/>$1`);
  return p.replace(ppr, newPpr);
}

function companyLine(proto, company, location) {
  const rs = runs(proto).filter((r) => runText(r));
  const paren = rs.findIndex((r) => runText(r).trim() === "(");
  if (location && paren > 0 && rs[paren + 1]) {
    // Italic company, plain "(", italic "location)" as in the template.
    return para(proto, run(rPr(rs[0]), tText(company + " ")) + run(rPr(rs[paren]), tText("(")) + run(rPr(rs[paren + 1]), tText(location + ")")));
  }
  return para(proto, run(firstTextRunPr(proto), tText(location ? `${company} (${location})` : company)));
}

// One education line "School | Degree | Year" as a paragraph shaped like the template's education line:
// school in bold, degree in italics, the rest plain. A line without a "|" stays plain.
function educationLine(proto, line) {
  const base = unstyled(firstTextRunPr(proto));
  const [school, degree, ...rest] = line.split(" | ");
  if (degree === undefined) return para(proto, run(base, tText(line)));
  return para(proto, run(bold(base), tText(school)) + run(base, tText(" | ")) + run(italic(base), tText(degree)) + (rest.length ? run(base, tText(" | " + rest.join(" | "))) : ""));
}

const NEEDS_CANDIDATE = "candidate.name and candidate.contact are blank: add them in config/preferences.json (they are printed at the top of every resume).";
const hasText = (v) => typeof v === "string" && v.trim() !== "";

// documentXml: the template's word/document.xml. data: parseResume(...). who: { name, contact } from the settings.
export function fillTemplate(documentXml, data, { name, contact } = {}) {
  if (!hasText(name) || !hasText(contact)) throw new Error(NEEDS_CANDIDATE);
  const start = documentXml.indexOf("<w:body>") + "<w:body>".length;
  const sect = documentXml.lastIndexOf("<w:sectPr");
  const body = documentXml.slice(start, sect);
  const t = analyse(body);
  const P = t.paras;
  const keep = (a, b) => P.slice(a, b);

  const out = [];
  // Header: the first two non-empty paragraphs above the summary heading become your name and contact line,
  // in the template's own formatting (the contact line's plain text, not a link's blue style). Anything else up there stays.
  const [nameAt, contactAt] = t.headerIdx;
  out.push(...keep(0, t.summaryP).map((p, i) =>
    i === nameAt ? para(p, run(firstTextRunPr(p), tText(name.trim())))
      : i === contactAt ? para(p, run(plainRunPr(p), tText(contact.trim())))
        : p));
  out.push(para(P[t.summaryP], run(firstTextRunPr(P[t.summaryP]), tText(data.summary))));
  out.push(...keep(t.summaryP + 1, t.expH));

  // Experience heading: a parenthetical note in the template's heading is taken out; the experience note goes
  // at the bottom instead (in italics, one blank line under Skills, on every resume).
  let expH = P[t.expH];
  const noteRun = runs(expH).find((r) => runText(r).trim().startsWith("("));
  if (noteRun) expH = expH.replace(noteRun, "").replace(/(<w:t[^>]*>[^<]*?)\s+(<\/w:t>)(?![\s\S]*<w:t)/, "$1$2");
  out.push(expH);
  out.push(...keep(t.expH + 1, t.firstRole));

  // One unit per role: role line, the template's spacers and company line, then bullets.
  data.roles.forEach((r, n) => {
    const u = n === 0 ? t.firstUnit : t.laterUnit;
    const bulletRunPr = t.bulletRunPr;
    out.push(para(u.role, run(firstTextRunPr(u.role), tText(r.title) + "<w:tab/>" + tText(r.dates))));
    out.push(...u.gapAfterRole);
    out.push(companyLine(u.company, r.company, r.location));
    out.push(...u.gapAfterCompany);
    for (const b of r.bullets) {
      const lead = b.lead ? run(bold(bulletRunPr), tText(b.lead)) + run(bulletRunPr, tText(" " + b.text)) : run(bulletRunPr, tText(b.text));
      out.push(para(u.bullet, lead));
    }
  });

  // From the last template bullet through the Education heading stays (spacers, rules, heading). The template's
  // education lines are replaced by yours, shaped like the template's first one. Then what sits between them and the
  // skills text stays (spacers, the Skills heading), the skills text is replaced, and the rest of the template stays.
  out.push(...keep(t.lastBullet + 1, t.eduH + 1));
  const eduProto = P[t.eduFirst ?? t.skillsP];
  out.push(...(data.education || []).map((line) => educationLine(eduProto, line)));
  out.push(...keep(t.eduLast + 1, t.skillsP));
  out.push(para(P[t.skillsP], run(firstTextRunPr(P[t.skillsP]), tText(skillsLine(data.skills)))));
  out.push(...keep(t.skillsP + 1, P.length));
  if (data.note) {
    out.push(para(P[t.skillsP], ""), para(P[t.skillsP], run(italic(firstTextRunPr(P[t.skillsP])), tText(data.note))));
  }

  return documentXml.slice(0, start) + out.map(clean).join("") + documentXml.slice(sect);
}

// ---------- files ----------

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout;
};

// who: { name, contact } (candidate in the settings).
export async function writeDocx(templatePath, data, outPath, who) {
  const work = join(tmpdir(), `resume-docx-${process.pid}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  try {
    sh("unzip", ["-q", templatePath, "-d", work]);
    const docPath = join(work, "word", "document.xml");
    await writeFile(docPath, fillTemplate(await readFile(docPath, "utf8"), data, who));
    await rm(outPath, { force: true });
    sh("zip", ["-q", "-X", "-r", outPath, "."], { cwd: work });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// Pages ignores negative indents, which some templates use to push text into the margins, so lines wrap
// earlier and the resume runs long. For the PDF copy only, widen the page margins by the same amount and
// shift every indent and tab stop to match: text lands in the same place, and Pages lays it out correctly.
export function normalizeIndents(documentXml, numberingXml = "") {
  const attr = (s, name) => { const m = s.match(new RegExp(`w:${name}="(-?[\\d.]+)"`)); return m ? Number(m[1]) : null; };
  const inds = [...documentXml.matchAll(/<w:ind\b[^>]*\/>/g)].map((m) => m[0]);
  const dl = Math.max(0, -Math.min(0, ...inds.map((i) => attr(i, "left") ?? 0)));
  const dr = Math.max(0, -Math.min(0, ...inds.map((i) => attr(i, "right") ?? 0)));
  if (!dl && !dr) return documentXml;

  // Left indent each list level gives its bullets, by numId.
  const absLeft = {};
  for (const a of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>(.*?)<\/w:abstractNum>/gs)) {
    const lvl0 = (a[2].match(/<w:lvl w:ilvl="0".*?<\/w:lvl>/s) || [""])[0];
    absLeft[a[1]] = attr((lvl0.match(/<w:ind\b[^>]*\/>/) || [""])[0], "left") ?? 0;
  }
  const numLeft = {};
  for (const n of numberingXml.matchAll(/<w:num w:numId="(\d+)"[^>]*>.*?<w:abstractNumId w:val="(\d+)"/gs)) numLeft[n[1]] = absLeft[n[2]] ?? 0;

  let xml = documentXml.replace(/<w:pgMar\b[^>]*\/>/, (m) =>
    m.replace(/w:left="([\d.]+)"/, (_, v) => `w:left="${Number(v) - dl}"`).replace(/w:right="([\d.]+)"/, (_, v) => `w:right="${Number(v) - dr}"`));

  xml = xml.replace(/<w:p\b([^>]*)>(<w:pPr>.*?<\/w:pPr>)?/gs, (whole, pAttrs, ppr = "") => {
    const numId = (ppr.match(/<w:numId w:val="(\d+)"/) || [])[1];
    const inherited = numId ? numLeft[numId] ?? 0 : 0;
    const ind = (ppr.match(/<w:ind\b[^>]*\/>/) || [""])[0];
    const left = (attr(ind, "left") ?? inherited) + dl;
    const right = (attr(ind, "right") ?? 0) + dr;
    const keep = ind.replace(/<w:ind\b|\/>|w:(left|right|start|end)="[^"]*"/g, "").trim();
    const newInd = `<w:ind w:left="${left}" w:right="${right}"${keep ? " " + keep : ""}/>`;
    let p = ppr || "<w:pPr></w:pPr>";
    p = p.replace(/<w:tab w:val="([^"]+)"([^>]*?)w:pos="(-?[\d.]+)"/g, (m, v, mid, pos) => `<w:tab w:val="${v}"${mid}w:pos="${Number(pos) + dl}"`);
    p = ind ? p.replace(ind, newInd)
      : p.replace(/(<w:contextualSpacing|<w:mirrorIndents|<w:suppressOverlap|<w:jc\b|<w:textDirection|<w:textAlignment|<w:outlineLvl|<w:rPr>|<\/w:pPr>)/, (m) => newInd + m);
    return `<w:p${pAttrs}>${p}`;
  });
  return xml;
}

// Pages draws the first education line right against the heading's rule in some templates.
// For the PDF copy only, give it 8pt of room unless the heading already leaves that much.
export function spaceEducation(documentXml) {
  const start = documentXml.indexOf("<w:body>") + "<w:body>".length;
  const t = analyse(documentXml.slice(start, documentXml.lastIndexOf("<w:sectPr")));
  if (t.eduFirst === undefined) return documentXml; // no education lines
  const entry = t.paras[t.eduFirst], heading = t.paras[t.eduH];
  const headAfter = Number(((pPr(heading).match(/<w:spacing\b[^>]*\/>/) || [""])[0].match(/w:after="([\d.]+)"/) || [])[1] || 0);
  if (headAfter >= 80) return documentXml; // the heading already leaves room
  return documentXml.replace(entry, spaceBefore(entry, heading, 160));
}

// Pages is sandboxed and can't open files in this project folder, so it works on a copy in this staging folder.
export const PDF_STAGE_DIR = join(homedir(), "Pictures", "agentic-job-search", "converting");

// Opens the .docx in Pages, exports a PDF, and returns the page count.
// options (tests use them so nothing launches Pages): stageDir; pagesExport(stagedDocx, stagedPdf) → page count;
// reopen(), the "open Pages and try again" step that runs once when the export fails.
export async function writePdf(docxPath, pdfPath, { stageDir = PDF_STAGE_DIR, pagesExport = exportWithPages, reopen = reopenPages } = {}) {
  await mkdir(stageDir, { recursive: true });
  const name = docxPath.split("/").pop();
  const stagedDocx = join(stageDir, name), stagedPdf = join(stageDir, name.replace(/\.docx$/, ".pdf"));
  // The copy Pages converts gets its indents normalized (see normalizeIndents).
  const work = join(tmpdir(), `resume-pdf-${process.pid}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  sh("unzip", ["-q", docxPath, "-d", work]);
  const docXml = join(work, "word", "document.xml");
  const numbering = await readFile(join(work, "word", "numbering.xml"), "utf8").catch(() => "");
  await writeFile(docXml, spaceEducation(normalizeIndents(await readFile(docXml, "utf8"), numbering)));
  await rm(stagedDocx, { force: true });
  sh("zip", ["-q", "-X", "-r", stagedDocx, "."], { cwd: work });
  await rm(work, { recursive: true, force: true });
  try {
    const pages = withPagesRetry(() => pagesExport(stagedDocx, stagedPdf), reopen);
    await writeFile(pdfPath, await readFile(stagedPdf));
    return pages;
  } finally {
    await rm(stagedDocx, { force: true });
    await rm(stagedPdf, { force: true });
  }
}

// Pages was closed or still opening ("Application isn't running", -600): open it in the background, wait, and
// try once more. A second failure still fails, and the run sends the Word file alone.
const reopenPages = () => { spawnSync("open", ["-g", "-a", "Pages"]); spawnSync("sleep", ["10"]); };
export function withPagesRetry(exportOnce, reopen = reopenPages) {
  try { return exportOnce(); }
  catch (e) {
    console.log(`PDF export failed (${e.message.slice(0, 80)}); opening Pages and trying again.`);
    reopen();
    return exportOnce();
  }
}

function exportWithPages(docxPath, pdfPath) {
  const script = `on run argv
  with timeout of 120 seconds
    tell application "Pages"
      set d to open (POSIX file (item 1 of argv))
      delay 2
      set n to count of pages of d
      export d to (POSIX file (item 2 of argv)) as PDF
      close d saving no
      return n
    end tell
  end timeout
end run`;
  return Number(sh("osascript", ["-e", script, docxPath, pdfPath]).trim());
}

const exists = (p) => access(p).then(() => true, () => false);

// One subfolder per role family (search.families in the settings). It follows the job title exactly as the job
// archives do in job-pull.mjs (archiveFor): the first family whose title keywords appear in the title, else the
// first family with no keywords (the catch-all), else the first family.
export const resumeFolder = (title, families) => {
  const list = Array.isArray(families) && families.length ? families : [{ name: "Jobs", titleKeywords: [] }];
  const hasWords = (f) => Array.isArray(f.titleKeywords) && f.titleKeywords.length > 0;
  const t = String(title ?? "").toLowerCase();
  return (list.find((f) => hasWords(f) && f.titleKeywords.some((k) => t.includes(String(k).toLowerCase()))) || list.find((f) => !hasWords(f)) || list[0]).name;
};
const safe = (s) => String(s ?? "").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
export const resumeDir = (s, settings, outDir = OUT_DIR) => join(outDir, safe(resumeFolder(s.title, settings?.search?.families)));

// File name without extension. (parentheses) around the job = the full resume; [brackets] = the short version.
export const resumeFileBase = (s, candidateName) => {
  const job = safe(`${s.company} - ${s.title}`);
  return s.short ? `${safe(candidateName)} Resume [${job}]` : `${safe(candidateName)} Resume (${job})`;
};

// Tailored resume sections (newest first), each with its heading, link, base resume and resume text.
export async function tailoredSections() {
  const text = await readFile(TAILORED_FILE, "utf8").catch(() => "");
  const starts = [...text.matchAll(/^## .+$/gm)].map((m) => m.index);
  return starts.map((s, i) => {
    const section = text.slice(s, starts[i + 1] ?? text.length);
    const head = section.split("\n")[0].replace(/^## /, "").replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
    const [title, company] = head.split(" | ");
    return {
      title, company: company || "",
      url: (section.match(/Link: (https?:\/\/\S+)/) || [])[1] || "",
      short: /^Version: short\b/m.test(section),
      markdown: section,
    };
  });
}

// A role can have several resumes (--retailor keeps the old one as history). The newest is first in the file;
// only it counts (one full and one short version per link).
export const newestPerLink = (sections) =>
  sections.filter((x, i, all) => all.findIndex((y) => y.url === x.url && y.short === x.short) === i);

// Whether Pages is installed, looked for the first time a resume is built in this run.
const pagesThisRun = oncePerRun();

// Builds the .docx and .pdf for one tailored resume. settings: the loaded settings (candidate name and contact,
// resume.template, search.families). Returns the paths and the PDF's page count; when the PDF can't be made
// (Pages missing or closed), pdf is null and the Word file is still returned. Without Pages the PDF step isn't tried.
// options (tests use them so nothing launches Pages or writes outside a temp folder): outDir, hasPages() (whether
// Pages is installed), plus the writePdf options stageDir, pagesExport and reopen.
export async function buildResumeFiles(s, settings, { outDir = OUT_DIR, hasPages = pagesThisRun, ...pdfOptions } = {}) {
  const who = settings?.candidate || {};
  if (!hasText(who.name) || !hasText(who.contact)) throw new Error(NEEDS_CANDIDATE);
  const dir = resumeDir(s, settings, outDir);
  await mkdir(dir, { recursive: true });
  const base = join(dir, resumeFileBase(s, who.name));
  // Your own edited version (.pages) wins: keep it and its PDF, build nothing.
  if (await exists(`${base}.pages`)) {
    console.log(`Kept your edited version: ${base}.pages`);
    return { docx: null, pdf: (await exists(`${base}.pdf`)) ? `${base}.pdf` : null, pages: 1, finalized: true };
  }
  const template = resolve(ROOT, settings.resume.template);
  if (!(await exists(template))) throw new Error(`resume template not found: ${settings.resume.template} (resume.template in config/preferences.json)`);
  const data = parseResume(s.markdown);
  if (!data.roles.length || !data.summary) throw new Error(`couldn't read the resume text for ${s.title} | ${s.company}`);
  await writeDocx(template, data, `${base}.docx`, who);
  if (!hasPages()) return { docx: `${base}.docx`, pdf: null, pages: null };
  let pages = null, pdf = `${base}.pdf`;
  try { pages = await writePdf(`${base}.docx`, pdf, pdfOptions); } catch (e) { pdf = null; console.log(`PDF not made: ${e.message}`); }
  return { docx: `${base}.docx`, pdf, pages };
}

// Command line: build files for every tailored resume that doesn't have a .docx yet.
if (isMain(import.meta.url)) {
  const { settings, problems } = loadSettings();
  if (!settings) {
    for (const p of problems) console.log(`✗ ${p}`);
    process.exitCode = 1;
  } else {
    const sections = newestPerLink(await tailoredSections());
    let made = 0;
    for (const s of sections) {
      const base = join(resumeDir(s, settings), resumeFileBase(s, settings.candidate.name ?? ""));
      if ((await exists(base + ".docx")) || (await exists(base + ".pages"))) continue;
      try {
        const r = await buildResumeFiles(s, settings);
        made++;
        console.log(`✓ ${s.title} | ${s.company}: ${r.pdf ? `PDF ${r.pages} page${r.pages === 1 ? "" : "s"}` : "Word only"}`);
        if (r.pages > 1) console.log("  ⚠ Longer than one page. Trim it before applying.");
      } catch (e) {
        console.log(`✗ ${s.title} | ${s.company}: ${e.message}`);
        process.exitCode = 1;
      }
    }
    console.log(made ? `Made ${made} resume file set(s) in ${OUT_DIR}` : "Every tailored resume already has its files.");
  }
}
