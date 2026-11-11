// The docs: README.md, docs/*.md, integrations/*.md and examples/README.md. They are the first thing a reader sees,
// so they must not rot: every link and image resolves, every setting, script, flag and skill they name exists, and
// the README has the flow diagram and the sections the reader expects, in order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "../scripts/lib/paths.mjs";
import { TESTED_CLAUDE_VERSION } from "../scripts/check-setup.mjs";
import { ensureInbox } from "../scripts/job-pull.mjs";

const text = (rel) => readFileSync(join(ROOT, rel), "utf8");
const mdIn = (dir) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".md")).map((f) => `${dir}/${f}`) : []);

const REQUIRED = ["README.md", "docs/SETUP.md", "docs/ARCHITECTURE.md", "docs/CUSTOMIZING.md", "integrations/optional-inbox.md", "examples/README.md"];
const DOC_FILES = [...new Set(["README.md", ...mdIn("docs"), ...mdIn("integrations"), "examples/README.md"])].filter((f) => existsSync(join(ROOT, f)));

const POSTER = "docs/assets/workflow-poster.png";

// ---------- links and images ----------

// Text without fenced code blocks and `inline code`, so an example link inside code is not checked.
const stripCode = (md) => md.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");

// GitHub's name for a heading's anchor: lowercase, punctuation dropped, spaces to dashes, repeats numbered.
function anchorsOf(md) {
  const seen = new Map();
  return stripCode(md).split("\n").filter((l) => /^#{1,6}\s/.test(l)).map((l) => {
    const slug = l.replace(/^#{1,6}\s+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/ /g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    return n ? `${slug}-${n}` : slug;
  });
}

// Every relative link or image in md (a file at repo path `file`) that doesn't resolve, as plain messages.
// exists / textOf are the file lookups; tests give stand-ins.
function brokenLinks(file, md, { exists = (rel) => existsSync(join(ROOT, rel)), textOf = text } = {}) {
  const body = stripCode(md);
  const targets = [
    ...[...body.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...body.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  ];
  const problems = [];
  for (const raw of targets) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // http, https, mailto
    const [pathPart, fragment] = raw.split("#");
    let rel = file;
    if (pathPart) {
      let decoded = pathPart;
      try { decoded = decodeURI(pathPart); } catch {}
      rel = relative(ROOT, resolve(ROOT, dirname(file), decoded)).split("\\").join("/");
      if (rel.startsWith("..")) { problems.push(`${file}: ${raw} leaves the project`); continue; }
      if (!exists(rel)) {
        problems.push(`${file}: ${raw} is not a file in the project`);
        continue;
      }
    }
    if (fragment && rel.endsWith(".md") && !anchorsOf(textOf(rel)).includes(fragment.toLowerCase())) {
      problems.push(`${file}: ${raw} has no heading called "${fragment}" in ${rel}`);
    }
  }
  return problems;
}

test("the docs exist", () => {
  for (const f of REQUIRED) assert.ok(existsSync(join(ROOT, f)), `${f} is missing`);
});

test("the link checker flags a missing file, a missing heading and a bad image, and skips code and web addresses", () => {
  const files = { "README.md": "# Top\n## A section\n", "docs/a.md": "# A\n" };
  const exists = (rel) => rel in files;
  const textOf = (rel) => files[rel];
  const md = [
    "[ok](a.md) [ok with heading](../README.md#a-section) [web](https://example.com/x.md) [mail](mailto:a@b.c) [same page](#a) [not on the page](#top)",
    "[gone](nothing.md) ![pic](assets/pic.png) [bad heading](../README.md#no-such-heading)",
    "`[in code](gone-too.md)`",
    "```",
    "[in a block](gone-three.md)",
    "```",
    "<img src=\"../missing.png\">",
  ].join("\n");
  const found = brokenLinks("docs/a.md", md, { exists, textOf });
  assert.deepEqual(found.map((p) => p.replace(/^docs\/a\.md: /, "")), [
    "#top has no heading called \"top\" in docs/a.md",
    "nothing.md is not a file in the project",
    "assets/pic.png is not a file in the project",
    "../README.md#no-such-heading has no heading called \"no-such-heading\" in README.md",
    "../missing.png is not a file in the project",
  ]);
});

test("every relative link and image in the docs resolves to a file in the project", () => {
  const problems = DOC_FILES.flatMap((f) => brokenLinks(f, text(f)));
  assert.deepEqual(problems, []);
});

// ---------- README ----------

const README = () => text("README.md");
const heading = (md, name) => md.search(new RegExp(`^#{2,3} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));

test("the README has the flow diagram, the poster and the sections the reader expects, in order", () => {
  const md = README();
  const poster = md.indexOf(`](${POSTER})`);
  const mermaid = md.search(/^```mermaid\n/m);
  assert.ok(poster >= 0, "README shows the poster image");
  assert.ok(mermaid >= 0, "README has a mermaid block");
  const order = ["Why it's built this way", "Quick start", "What it costs", "Mac-only parts", "Optional job inbox", "Built by", "License"];
  const at = order.map((h) => heading(md, h));
  order.forEach((h, i) => assert.ok(at[i] >= 0, `README has a "${h}" heading`));
  assert.ok(poster < mermaid && mermaid < at[0], "poster, then diagram, then the sections");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "sections are in the order of the design");
});

// The pipeline chart and the side-agents chart are read together.
test("the flow diagrams show every stage, with their labels in quotes so GitHub can draw them", () => {
  const block = [...README().matchAll(/^```mermaid\n([\s\S]*?)^```/gm)].map((m) => m[1]).join("\n");
  assert.match(block, /^flowchart /m);
  for (const stage of [/hourly pull/i, /filters/i, /job list/i, /archives/i, /inbox/i, /writer/i, /code checks/i, /fact-check/i, /verified by code/i,
    /3 tries/i, /word \+ pdf/i, /notifications/i, /repair/i, /scout/i, /proposals/i, /5 of the 6 hard rules/i, /hard rule 5/i]) {
    assert.match(block, stage, `the diagram names ${stage}`);
  }
  // Every label is in quotes: with the quoted text taken out, no bracket, brace or parenthesis is left over.
  // (An unquoted ( ) or : inside a label is what makes GitHub print "Unable to render" instead of the diagram.)
  const bare = block.replace(/"[^"]*"/g, "Q").replace(/\(\[Q\]\)|\[Q\]|\{Q\}|\(Q\)/g, "");
  assert.doesNotMatch(bare, /[\[\]{}()]/, "labels are quoted");
  const nodes = (block.match(/\[".*?"\]|\{".*?"\}/g) || []).length;
  assert.ok(nodes >= 12, `found ${nodes} labelled boxes`);
});

test("the README says which versions it was tested with and where the author is credited", () => {
  const md = README();
  assert.ok(md.includes(`Claude Code ${TESTED_CLAUDE_VERSION}`), "names the Claude Code version check-setup compares against");
  assert.match(md, /Node 20\b/);
  const built = md.slice(heading(md, "Built by"));
  assert.match(built, /Built by [A-Z][a-z]+ [A-Z][a-z]+ \(\[LinkedIn\]\(https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9-]+\)\)/);
  assert.match(built, /\)\)\s*\n\s*\n\s*\S.{20,}/, "the credit is followed by a line on why it was built");
  // The author line is the only credit: no other doc names an author or links a profile.
  for (const f of DOC_FILES.filter((x) => x !== "README.md")) assert.doesNotMatch(text(f), /linkedin\.com|Built by/i, f);
  assert.equal((md.match(/linkedin\.com/g) || []).length, 1);
});

test("the README tells the user what is stored where, and what runs on the Mac only", () => {
  const md = README();
  for (const need of [".history/", "config/preferences.json", "profile/profile.md", "Pages", "Messages", "Mail", "Numbers", "launchd", "git-ignored"]) {
    assert.ok(md.includes(need), `README mentions ${need}`);
  }
  assert.match(md, /\bnode --test\b/);
  assert.match(md, /five of the six hard rules/, "code checks five of the six");
  assert.match(md, /confirms each quote[^.]*\(hard rule 5\)/, "the quote check is hard rule 5");
  assert.doesNotMatch(md, /sixth rule/i, "rule 6 is keyword coverage, not the quote check");
  assert.match(md, /living documents/);
  assert.match(md, /\b\d{3} (automatic )?tests\b/, "the README gives the test count");
});

// ---------- SETUP, CUSTOMIZING, ARCHITECTURE ----------

test("SETUP.md walks through the same eight steps as the setup skill, in order", () => {
  const skill = text(".claude/skills/setup/SKILL.md");
  const steps = [...skill.matchAll(/^## (Step \d+: .+)$/gm)].map((m) => m[1]);
  assert.equal(steps.length, 8);
  const setup = text("docs/SETUP.md");
  const found = [...setup.matchAll(/^## (Step \d+: .+)$/gm)].map((m) => m[1]);
  assert.deepEqual(found, steps);
  assert.ok(setup.includes("--no-ai --backlog"));
  assert.ok(setup.includes("living documents"));
});

// Every setting in the example file, as a dotted path (a list or null is one setting; notes starting with _ are not).
function settingPaths(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).filter(([k]) => !k.startsWith("_")).flatMap(([k, v]) => settingPaths(v, prefix ? `${prefix}.${k}` : k));
}

test("CUSTOMIZING.md explains every setting in config/preferences.example.json", () => {
  const example = JSON.parse(text("config/preferences.example.json"));
  const paths = settingPaths(example);
  assert.ok(paths.length >= 20, `found ${paths.length} settings`);
  const md = text("docs/CUSTOMIZING.md");
  const missing = paths.filter((p) => !md.includes(`\`${p}\``));
  assert.deepEqual(missing, [], "settings CUSTOMIZING.md never names");
  for (const need of ["find-board", "families", "My rules", "living documents", "PROFESSIONAL SUMMARY", "PROFESSIONAL EXPERIENCE", "EDUCATION", "SKILLS"]) {
    assert.ok(md.includes(need), `CUSTOMIZING.md covers ${need}`);
  }
});

test("the example file's notes are short and plain (no jargon, no leftover 'marked')", () => {
  const notes = [];
  (function walk(v) {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (k === "_about" ? notes.push(x) : walk(x));
  })(JSON.parse(text("config/preferences.example.json")));
  assert.ok(notes.length >= 8);
  for (const n of notes) {
    assert.ok((n.match(/[.!?](\s|$)/g) || []).length <= 2, `one or two sentences: ${n}`);
    assert.doesNotMatch(n, /\bslug\b|\bats\b|\bmarked\b/i, n);
  }
});

test("ARCHITECTURE.md covers every skill, loop and safeguard", () => {
  const md = text("docs/ARCHITECTURE.md");
  const skills = readdirSync(join(ROOT, ".claude", "skills"));
  const docsText = ["docs/ARCHITECTURE.md", "docs/CUSTOMIZING.md", "README.md"].map(text).join("\n");
  for (const s of skills) assert.ok(docsText.includes(s), `no doc mentions the ${s} skill`);
  assert.match(md, /living documents/);
  assert.match(md, /Five of the six hard rules/);
  for (const need of ["job-pull.lock", "sent-log.json", "editRule", "maxUsdPerStep", "maxUsdScout", "HARD RULES", ".history", "verifyCheck", "evals/run-checker.mjs", "node --test",
    "Resume ready", "Needs review", "Could not tailor", "tailor-loop", "check-resume.mjs"]) {
    assert.ok(md.includes(need), `ARCHITECTURE.md covers ${need}`);
  }
});

// ---------- what the docs name must exist ----------

test("every script, flag and repo file the docs name exists", () => {
  const sources = ["scripts", "scripts/lib", "evals"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".mjs")).map((f) => text(`${d}/${f}`))).join("\n");
  const problems = [];
  for (const f of DOC_FILES) {
    const md = text(f);
    for (const m of md.matchAll(/\bnode ((?:scripts|evals)\/[\w./-]+\.mjs)/g)) if (!existsSync(join(ROOT, m[1]))) problems.push(`${f}: ${m[1]} doesn't exist`);
    for (const m of md.matchAll(/(?<![\w-])(--[a-z][a-z-]+)/g)) {
      if (m[1] !== "--test" && !sources.includes(m[1])) problems.push(`${f}: no script reads the flag ${m[1]}`);
    }
    // Repo files in `code spans` (not your own git-ignored files, patterns or placeholders).
    for (const m of md.matchAll(/`((?:scripts|evals|examples|templates|prompts|integrations|tests|docs|\.claude)\/[^`\s*<>]+)`/g)) {
      const rel = m[1].replace(/[.,:;]$/, "");
      if (!existsSync(join(ROOT, rel))) problems.push(`${f}: \`${rel}\` doesn't exist`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the docs use plain words", () => {
  for (const f of DOC_FILES) assert.doesNotMatch(text(f), /\bheadless\b/i, f);
});

test("the docs name no one's machine, and the examples use only the made-up person", () => {
  for (const f of DOC_FILES) assert.doesNotMatch(text(f), /\/Users\/|\/home\//, f);
  assert.match(text("examples/README.md"), /Jordan Reyes/);
  assert.match(text("docs/SETUP.md") + text("docs/CUSTOMIZING.md"), /Jordan Reyes|examples\//);
});

// ---------- the optional inbox guide ----------

const GUIDE = "integrations/optional-inbox.md";
const START = "<!-- INBOX TEMPLATE START -->", END = "<!-- INBOX TEMPLATE END -->";

test("the inbox guide keeps its template block, and job-pull still makes inbox.md from it", () => {
  const guide = text(GUIDE);
  assert.equal(guide.split(START).length, 2, "one start marker");
  assert.equal(guide.split(END).length, 2, "one end marker");
  assert.ok(guide.indexOf(START) < guide.indexOf(END));
  const block = guide.slice(guide.indexOf(START) + START.length, guide.indexOf(END)).trim();
  assert.match(block, /^# Inbox\n/);
  assert.ok(block.endsWith("<!-- ENTRIES BELOW -->"));

  const dir = mkdtempSync(join(tmpdir(), "inbox-guide-"));
  try {
    const file = join(dir, "inbox.md");
    assert.equal(ensureInbox(file, join(ROOT, GUIDE)), true);
    const made = readFileSync(file, "utf8");
    assert.equal(made, block + "\n");
    // The example entry sits above the marker, so a fresh inbox holds no job for the next run to import.
    assert.doesNotMatch(made.split("<!-- ENTRIES BELOW -->")[1], /https?:\/\//);
    assert.equal(ensureInbox(file, join(ROOT, GUIDE)), false, "an existing inbox is left alone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the inbox guide shows the entry format and an example prompt for another agent", () => {
  const guide = text(GUIDE);
  const outside = guide.replace(new RegExp(`${START}[\\s\\S]*?${END}`), "");
  for (const field of ["Link:", "Title:", "Company:", "Location:", "Pay:", "Posted:", "Description:"]) assert.ok(guide.includes(field), field);
  assert.match(outside, /OpenClaw/);
  assert.match(outside, /inbox\.md/);
  assert.match(outside, /## .*prompt/i, "a heading for the example prompt");
  assert.match(outside, /import-jobs/);
});
