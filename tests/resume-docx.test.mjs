// The Word/PDF builder: fills the sample template (templates/resume-template.docx) from a tailored resume.
// Every resume here is the fictional Jordan Reyes example (tests/fixtures/jordan-final.md).
// Nothing here opens Pages or writes outside a temp folder: the PDF step is always given stubs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../scripts/lib/paths.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import {
  fillTemplate, parseResume, resumeFileBase, resumeFolder, resumeDir, writeDocx, writePdf, buildResumeFiles, PDF_STAGE_DIR,
} from "../scripts/resume-docx.mjs";
import { archiveFor } from "../scripts/job-pull.mjs";

const TEMPLATE = join(ROOT, "templates", "resume-template.docx");
const unzip = (file, part) => spawnSync("unzip", ["-p", file, ...(part ? [part] : [])], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).stdout;
const xml = unzip(TEMPLATE, "word/document.xml");
const fixture = readFileSync(new URL("./fixtures/jordan-final.md", import.meta.url), "utf8");
const settings = withDefaults(JSON.parse(readFileSync(join(ROOT, "examples", "preferences.json"), "utf8")));
const tmp = () => mkdtempSync(join(tmpdir(), "resume-docx-"));

const NOTE = "Earlier roles on request.";
const withNote = fixture.replace("### Professional Experience\n", `### Professional Experience\n*${NOTE}*\n`);
const jordan = { name: "Jordan Reyes", contact: "jordan@example.com · Chicago, IL" };
const section = { title: "Senior Product Manager, Checkout", company: "Saltmere", url: "https://example.com/jobs/saltmere-senior-pm-checkout", short: false, markdown: fixture };

const paras = (doc) => [...doc.slice(doc.indexOf("<w:body>"), doc.lastIndexOf("<w:sectPr")).matchAll(/<w:p\b[^>]*>.*?<\/w:p>|<w:p\b[^>]*\/>/gs)].map((m) => m[0]);
const text = (p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").replace(/&amp;/g, "&");
const bulletParas = (doc) => paras(doc).filter((p) => /<w:numPr>/.test(p));

// --- reading the resume -----------------------------------------------------------------------------------------
test("parseResume reads the summary, roles, education lines, skills and the experience note", () => {
  const d = parseResume(fixture);
  assert.match(d.summary, /^Senior Product Manager with 9 years in product/);
  assert.deepEqual(d.roles.map((r) => [r.title, r.company, r.location, r.dates, r.bullets.length]), [
    ["Senior Product Manager", "Larkfield Commerce", "Chicago, IL", "March 2023 – Present", 5],
    ["Product Manager", "Wrenfield Health", "Chicago, IL", "June 2020 – February 2023", 4],
    ["Associate Product Manager", "Penhallow Media", "New York, NY", "July 2017 – May 2020", 2],
  ]);
  assert.deepEqual(d.education, ["Calder Hill University | B.A., Economics | 2017"]);
  assert.match(d.skills, /^Checkout & Payments \| Experimentation/);
  assert.equal(d.note, "");
  assert.equal(parseResume(withNote).note, NOTE);
});

test("parseResume education: one entry per line, bullets and blank lines dropped, in order", () => {
  const md = fixture.replace(
    "- Calder Hill University | B.A., Economics | 2017\n",
    "- Calder Hill University | B.A., Economics | 2017\n\n* Example Cert Board | Certificate in Analytics | 2021\nSecond Hill College | M.S., Data Science | 2019\n"
  );
  assert.deepEqual(parseResume(md).education, [
    "Calder Hill University | B.A., Economics | 2017",
    "Example Cert Board | Certificate in Analytics | 2021",
    "Second Hill College | M.S., Data Science | 2019",
  ]);
  assert.deepEqual(parseResume(fixture.replace(/### Education & Certifications\n- .*\n/, "### Education & Certifications\n")).education, []);
});

// --- filling the sample template ----------------------------------------------------------------------------------
test("the sample template is filled with your name, contact, summary, roles, education, skills and the note in italics", () => {
  const data = parseResume(withNote);
  const doc = fillTemplate(xml, data, jordan);
  const ps = paras(doc);
  const all = ps.map(text);
  assert.equal(all[0], "Jordan Reyes");
  assert.equal(all[1], jordan.contact);
  const body = all.join("\n");
  assert.ok(body.includes(data.summary));
  for (const r of data.roles) {
    assert.ok(body.includes(r.title) && body.includes(r.dates) && body.includes(`${r.company} (${r.location})`), r.title);
    for (const b of r.bullets) assert.ok(body.includes(b.text), b.text);
  }
  assert.equal(bulletParas(doc).length, 5 + 4 + 2, "one paragraph per bullet, three roles from a two-role template");
  for (const line of data.education) assert.ok(all.includes(line), `education line: ${line}`);
  for (const gone of ["Your Name", "University Name", "Skill one", "Placeholder", "Job Title", "Company Name", "you@example.com"]) {
    assert.equal(body.includes(gone), false, `${gone} is gone`);
  }
  // Skills, one blank line, then the note in italics at the very bottom (and nowhere else).
  const [skills, blank, note] = ps.slice(-3);
  assert.equal(text(skills).replace(/ /g, " "), data.skills);
  assert.equal(text(blank), "");
  assert.equal(text(note), NOTE);
  assert.match(note, /<w:i w:val="1"\/>/, "the note is italic");
  assert.equal(all.filter((t) => t.includes(NOTE)).length, 1, "the note appears once");
  assert.ok(all.includes("PROFESSIONAL EXPERIENCE"), "the heading is just the heading");
});

test("without a note, nothing is added under Skills", () => {
  const ps = paras(fillTemplate(xml, parseResume(fixture), jordan));
  assert.equal(text(ps.at(-1)).replace(/ /g, " "), parseResume(fixture).skills);
});

test("name and contact are the first two non-empty paragraphs before the summary heading", () => {
  const blank = '<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr></w:p>';
  const tagline = '<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>A tagline the template keeps</w:t></w:r></w:p>';
  const summaryHeading = paras(xml).find((p) => text(p) === "PROFESSIONAL SUMMARY");
  const padded = xml.replace("<w:body>", `<w:body>${blank}`).replace(summaryHeading, tagline + summaryHeading);
  const all = paras(fillTemplate(padded, parseResume(fixture), jordan)).map(text);
  assert.deepEqual(all.slice(0, 4), ["", "Jordan Reyes", jordan.contact, "A tagline the template keeps"]);
  assert.equal(all[4], "PROFESSIONAL SUMMARY");
});

test("the template's education paragraphs are replaced by your education lines, school bold and degree italic", () => {
  const lines = ["Calder Hill University | B.A., Economics | 2017", "Example Cert Board | Certificate in Analytics | 2021", "Self-study, 2020"];
  const doc = fillTemplate(xml, { ...parseResume(fixture), education: lines }, jordan);
  const ps = paras(doc);
  const all = ps.map(text);
  const at = all.indexOf("EDUCATION & CERTIFICATIONS");
  assert.deepEqual(all.slice(at + 1, at + 5), [...lines, "SKILLS"]);
  assert.match(ps[at + 1], /<w:b w:val="1"\/>[^]*Calder Hill University/, "the school is bold");
  assert.match(ps[at + 1], /<w:i w:val="1"\/>[^]*B\.A\., Economics/, "the degree is italic");
  assert.doesNotMatch(ps[at + 3], /<w:[bi] w:val="1"\/>/, "a line without a | stays plain");
  // No education lines: the placeholder is not left behind, and the heading still comes before Skills.
  const none = paras(fillTemplate(xml, { ...parseResume(fixture), education: [] }, jordan)).map(text);
  assert.deepEqual(none.slice(none.indexOf("EDUCATION & CERTIFICATIONS"), none.indexOf("EDUCATION & CERTIFICATIONS") + 2), ["EDUCATION & CERTIFICATIONS", "SKILLS"]);
});

test("text is escaped, and fillTemplate needs your name and contact", () => {
  const doc = fillTemplate(xml, parseResume(fixture), { name: "Jordan <Q> & Co", contact: "a@b.example & more" });
  assert.match(doc, /Jordan &lt;Q&gt; &amp; Co/);
  assert.match(doc, /a@b\.example &amp; more/);
  assert.throws(() => fillTemplate(xml, parseResume(fixture), { name: "Jordan Reyes" }), /candidate\.name and candidate\.contact/);
  assert.throws(() => fillTemplate(xml, parseResume(fixture)), /candidate\.name and candidate\.contact/);
});

// --- names and folders --------------------------------------------------------------------------------------------
test("file names carry your name; parentheses are the full resume, brackets the short one", () => {
  const s = { company: "Saltmere", title: "Senior Product Manager, Checkout" };
  assert.equal(resumeFileBase(s, "Jordan Reyes"), "Jordan Reyes Resume (Saltmere - Senior Product Manager, Checkout)");
  assert.equal(resumeFileBase({ ...s, short: true }, "Jordan Reyes"), "Jordan Reyes Resume [Saltmere - Senior Product Manager, Checkout]");
  assert.equal(resumeFileBase({ company: "Salt/Mere", title: 'PM: "Checkout"' }, "Jordan Reyes"), "Jordan Reyes Resume (Salt-Mere - PM- -Checkout-)");
});

test("the resume folder is the role family from the settings, picked the way the job archives are", () => {
  const families = [
    { name: "Product Marketing", titleKeywords: ["product marketing"] },
    { name: "Product Strategy", titleKeywords: ["strategy", "solutions"] },
    { name: "Product Management", titleKeywords: [] },
  ];
  assert.equal(resumeFolder("Senior Product Marketing Manager", families), "Product Marketing");
  assert.equal(resumeFolder("Product Solutions Lead", families), "Product Strategy");
  assert.equal(resumeFolder("Senior Product Manager, Checkout", families), "Product Management");
  assert.equal(resumeFolder("Anything", [{ name: "Jobs", titleKeywords: [] }]), "Jobs");
  assert.equal(resumeFolder("Anything", undefined), "Jobs", "no families in the settings: the default family");
  assert.equal(resumeFolder("Chef", [{ name: "Product Manager", titleKeywords: ["product manager"] }]), "Product Manager", "no match and no catch-all: the first family");
  for (const t of ["Senior Product Marketing Manager", "Product Solutions Lead", "Senior Product Manager, Checkout", "Chef"]) {
    assert.equal(resumeFolder(t, families), archiveFor(t, families), `same family as the job archive for "${t}"`);
  }
  assert.equal(resumeDir(section, { search: { families: [{ name: "Growth / Ops", titleKeywords: [] }] } }, "/out"), "/out/Growth - Ops", "a family name is safe as a folder name");
});

// --- the files ---------------------------------------------------------------------------------------------------
test("when the PDF step fails, buildResumeFiles still returns the Word file and doesn't throw", async () => {
  const dir = tmp();
  const calls = [];
  const r = await buildResumeFiles(section, settings, {
    outDir: dir, stageDir: join(dir, "stage"), hasPages: () => true,
    pagesExport: () => { calls.push("export"); throw new Error("Pages isn't installed"); },
    reopen: () => calls.push("reopen"), // the "open Pages and try again" step is stubbed too, so no test launches Pages
  });
  assert.equal(r.docx, join(dir, "Product Manager", "Jordan Reyes Resume (Saltmere - Senior Product Manager, Checkout).docx"));
  assert.equal(r.pdf, null);
  assert.equal(r.pages, null);
  assert.deepEqual(calls, ["export", "reopen", "export"], "it tried once, reopened Pages, and tried once more");
  assert.ok(existsSync(r.docx));
  const doc = paras(unzip(r.docx, "word/document.xml")).map(text);
  assert.equal(doc[0], "Jordan Reyes");
  assert.ok(doc.includes("Calder Hill University | B.A., Economics | 2017"));
  assert.doesNotMatch(doc.join("\n"), /Your Name|University Name|Skill one/);
  assert.deepEqual(readdirSync(join(dir, "Product Manager")), ["Jordan Reyes Resume (Saltmere - Senior Product Manager, Checkout).docx"], "no PDF was left behind");
  assert.equal(existsSync(join(dir, "stage")) ? readdirSync(join(dir, "stage")).length : 0, 0, "nothing is left in the staging folder");
});

test("buildResumeFiles with a working export returns the PDF and its page count", async () => {
  const dir = tmp();
  const r = await buildResumeFiles(section, settings, {
    outDir: dir, stageDir: join(dir, "stage"), hasPages: () => true,
    pagesExport: (docx, pdf) => { writeFileSync(pdf, "%PDF-1.4 stub"); return 1; },
    reopen: () => assert.fail("Pages is not reopened when the export works"),
  });
  assert.equal(r.pages, 1);
  assert.equal(r.pdf, r.docx.replace(/\.docx$/, ".pdf"));
  assert.equal(readFileSync(r.pdf, "utf8"), "%PDF-1.4 stub");
});

test("without Pages installed, the PDF step is skipped: the Word file only, no export and no 10-second reopen wait", async () => {
  const dir = tmp();
  const r = await buildResumeFiles(section, settings, {
    outDir: dir, stageDir: join(dir, "stage"), hasPages: () => false,
    pagesExport: () => assert.fail("Pages isn't asked to export"),
    reopen: () => assert.fail("Pages isn't opened, and there's no wait"),
  });
  assert.deepEqual([r.pdf, r.pages], [null, null]);
  assert.ok(existsSync(r.docx));
  assert.deepEqual(readdirSync(join(dir, "Product Manager")), ["Jordan Reyes Resume (Saltmere - Senior Product Manager, Checkout).docx"]);
});

test("a .pages file you saved with the same name wins: nothing is rebuilt", async () => {
  const dir = tmp();
  const folder = join(dir, "Product Manager");
  mkdirSync(folder, { recursive: true });
  const base = join(folder, "Jordan Reyes Resume (Saltmere - Senior Product Manager, Checkout)");
  writeFileSync(`${base}.pages`, "yours");
  writeFileSync(`${base}.pdf`, "your pdf");
  const logs = [];
  const log = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  let r;
  try {
    r = await buildResumeFiles(section, settings, { outDir: dir, stageDir: join(dir, "stage"), pagesExport: () => assert.fail("no export"), reopen: () => assert.fail("no reopen") });
  } finally { console.log = log; }
  assert.deepEqual(r, { docx: null, pdf: `${base}.pdf`, pages: 1, finalized: true });
  assert.equal(existsSync(`${base}.docx`), false);
  assert.equal(readFileSync(`${base}.pdf`, "utf8"), "your pdf");
  assert.ok(logs.some((l) => /Kept your edited version/.test(l)), logs.join("\n"));
});

test("buildResumeFiles refuses a resume it can't read and settings with no name", async () => {
  const dir = tmp();
  const opts = { outDir: dir, stageDir: join(dir, "stage"), pagesExport: () => assert.fail("no export"), reopen: () => assert.fail("no reopen") };
  await assert.rejects(buildResumeFiles({ ...section, markdown: "## nothing here" }, settings, opts), /couldn't read the resume text/);
  const nameless = withDefaults({ ...JSON.parse(readFileSync(join(ROOT, "examples", "preferences.json"), "utf8")), candidate: { name: "", contact: "" } });
  await assert.rejects(buildResumeFiles(section, nameless, opts), /candidate\.name and candidate\.contact/);
  assert.deepEqual(existsSync(join(dir, "Product Manager")) ? readdirSync(join(dir, "Product Manager")) : [], [], "no Word file was written");
});

test("the PDF is made from a copy in the staging folder, which is cleaned up; the default staging folder is under Pictures/agentic-job-search", async () => {
  assert.equal(PDF_STAGE_DIR, join(homedir(), "Pictures", "agentic-job-search", "converting"));
  const dir = tmp();
  const docx = join(dir, "Jordan Reyes Resume (Saltmere - PM).docx");
  await writeDocx(TEMPLATE, parseResume(fixture), docx, jordan);
  const stage = join(dir, "stage");
  const seen = [];
  const pages = await writePdf(docx, join(dir, "out.pdf"), {
    stageDir: stage,
    pagesExport: (stagedDocx, stagedPdf) => {
      seen.push(stagedDocx);
      assert.equal(stagedDocx, join(stage, "Jordan Reyes Resume (Saltmere - PM).docx"));
      assert.ok(existsSync(stagedDocx), "Pages gets a copy in the staging folder");
      writeFileSync(stagedPdf, "%PDF stub");
      return 2;
    },
    reopen: () => assert.fail("no reopen"),
  });
  assert.equal(pages, 2);
  assert.equal(seen.length, 1);
  assert.equal(readFileSync(join(dir, "out.pdf"), "utf8"), "%PDF stub");
  assert.deepEqual(readdirSync(stage), []);
});

// --- the command line ----------------------------------------------------------------------------------------------
// These run a copy of scripts/ and templates/ in a temp folder (the scripts find their project from their own
// location), so they never read or write this project's outputs/. None of them gets as far as Pages.
function tempProject({ resumes = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "resume-docx-project-")); // not realpath'd: the script must run through macOS's symlinked temp folder
  cpSync(join(ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  cpSync(join(ROOT, "templates"), join(root, "templates"), { recursive: true });
  if (resumes) {
    mkdirSync(join(root, "outputs"));
    writeFileSync(join(root, "outputs", "tailored-resumes.md"), `# Tailored resumes\n\n---\n\n${fixture}`);
  }
  return root;
}
const settingsFile = (over = {}) => {
  const file = join(tmp(), "preferences.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(join(ROOT, "examples", "preferences.json"), "utf8")), ...over }));
  return file;
};
const cli = (root, file) => spawnSync(process.execPath, [join(root, "scripts", "resume-docx.mjs")], { encoding: "utf8", env: { ...process.env, AJS_SETTINGS: file }, timeout: 30000 });

test("the command line stops with the problem when there are no settings", () => {
  const r = cli(tempProject(), join(tmp(), "nope.json"));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^✗ .*doesn't exist yet/m);
});

test("the command line builds nothing for a resume that already has its Word file or .pages file", () => {
  const root = tempProject();
  const folder = join(root, "outputs", "resumes", "Product Manager");
  mkdirSync(folder, { recursive: true });
  const base = join(folder, "Jordan Reyes Resume (Saltmere - Senior Product Manager, Checkout)");
  for (const ext of [".docx", ".pages"]) {
    writeFileSync(base + ext, "yours");
    const r = cli(root, settingsFile());
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Every tailored resume already has its files\./);
    rmSync(base + ext);
  }
  assert.equal(cli(tempProject({ resumes: false }), settingsFile()).stdout.trim(), "Every tailored resume already has its files.");
});

test("the command line names the resume it couldn't build and exits 1, before touching Pages", () => {
  const root = tempProject();
  const r = cli(root, settingsFile({ candidate: { name: "", contact: "" } }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^✗ Senior Product Manager, Checkout \| Saltmere: candidate\.name and candidate\.contact are blank/m);
  assert.equal(existsSync(join(root, "outputs", "resumes")) ? readdirSync(join(root, "outputs", "resumes")).length : 0, 0, "no files were made");
});

// --- the sample template carries nothing personal -------------------------------------------------------------------
test("the sample template is placeholder text with no author, company or comments in it", () => {
  const names = spawnSync("unzip", ["-Z1", TEMPLATE], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  assert.ok(names.includes("word/document.xml"));
  assert.deepEqual(names.filter((n) => /comments|customXml|custom\.xml/i.test(n)), [], "no comments or custom XML parts");
  // Every piece of text anywhere in the file is one of the placeholder lines, and nothing else.
  const everyText = names.filter((n) => n.endsWith(".xml") || n.endsWith(".rels"))
    .flatMap((n) => [...unzip(TEMPLATE, n).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1].replace(/&amp;/g, "&")));
  assert.deepEqual(everyText, [
    "Your Name",
    "you@example.com · (555) 010-0100 · City, ST · linkedin.com/in/yourname",
    "PROFESSIONAL SUMMARY",
    "Placeholder summary: two or three sentences on who you are and what you do best. Each tailored resume replaces this text.",
    "PROFESSIONAL EXPERIENCE",
    "Job Title", "Month Year – Present", "Company Name (City, ST)",
    "Placeholder bullet one: what you did and the number it moved.",
    "Placeholder bullet two: what you did and the number it moved.",
    "Earlier Job Title", "Month Year – Month Year", "Earlier Company (City, ST)",
    "Placeholder bullet one: what you did and the number it moved.",
    "Placeholder bullet two: what you did and the number it moved.",
    "EDUCATION & CERTIFICATIONS",
    "University Name — Degree, Year",
    "SKILLS",
    "Skill one | Skill two | Skill three",
  ]);
  // Text that doesn't sit in a plain run: fields, links, deleted text, picture descriptions.
  assert.doesNotMatch(unzip(TEMPLATE), /<w:(?:instrText|delText|fldSimple|hyperlink)\b|\bdescr=/);
  // No document properties: the two property files hold no text at all.
  for (const part of ["docProps/core.xml", "docProps/app.xml"]) assert.equal(unzip(TEMPLATE, part).replace(/<[^>]*>/g, "").trim(), "", part);
  assert.deepEqual(names.filter((n) => n.startsWith("docProps/") && !/^docProps\/(core|app)\.xml$|\/$/.test(n)), [], "no other property parts");
  assert.doesNotMatch(unzip(TEMPLATE, "word/settings.xml") + xml, /w:rsid|w:author=/);
  assert.equal(bulletParas(xml).length, 4, "two roles, two placeholder bullets each");
});

test("the builder carries no one's name, template or notes", () => {
  for (const file of ["scripts/resume-docx.mjs", "scripts/lib/tailor-loop.mjs"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const word of ["New York, NY", "TEMPLATE_FOR", "DEFAULT_TEMPLATE", "Pictures/job-pull", "\"job-pull\""]) {
      assert.equal(src.includes(word), false, `${file} mentions ${word}`);
    }
  }
});
