import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import * as P from "../scripts/lib/paths.mjs";

test("every exported path is inside the project, and none is in about-me/", () => {
  for (const [name, value] of Object.entries(P)) {
    if (typeof value !== "string") continue;
    if (name === "SETTINGS_FILE" && process.env.AJS_SETTINGS) continue; // pointed elsewhere on purpose
    const rel = relative(P.ROOT, value);
    assert.ok(!rel.startsWith("..") && !isAbsolute(rel), `${name} is outside the project: ${value}`);
    assert.doesNotMatch(value, /about-me/, name);
  }
});

test("each role family has its own archive and competencies file", () => {
  assert.ok(P.archiveFile("Product Manager").endsWith(join("archives", "jobs-product-manager.md")));
  assert.ok(P.competenciesFile("Product Manager").endsWith(join("archives", "competencies-product-manager.md")));
  assert.equal(P.familySlug("Jobs"), "jobs");
  assert.equal(P.familySlug("  Sales & Partnerships! "), "sales-partnerships");
});

test("files live where the docs say", () => {
  const at = (...p) => join(P.ROOT, ...p);
  assert.equal(P.WORKFLOW_LOG, at("data", "workflow-log.md"));
  assert.equal(P.PROFILE, at("profile", "profile.md"));
  assert.equal(P.STORIES, at("profile", "stories.md"));
  assert.equal(P.RULES_FILE, at("profile", "resume-rules.md"));
  assert.equal(P.OUT_DIR, at("outputs", "resumes"));
  assert.equal(P.INBOX_FILE, at("inbox.md"));
  assert.equal(P.IMPORT_FILE, at("data", "inbox-import.json"));
  assert.equal(P.HISTORY_DIR, at(".history"));
});

test("the old fixed layout is gone", () => {
  for (const name of ["ARCHIVES", "COMPETENCY_FILES", "RESUMES", "STYLE_GUIDE", "FEEDBACK_LOG", "LINKEDIN_FILE", "TEMPLATE_DIR", "PROFILE_FILE"]) {
    assert.equal(name in P, false, `${name} should no longer be exported`);
  }
});

// import.meta.dirname and import.meta.filename are new in Node 20.11. On an older Node they are undefined, so a script
// that used them would crash before check-setup could say the Node is too old.
test("no script, eval or test takes its folder from import.meta's dirname or filename (Node 20.11+ only)", () => {
  const files = ["scripts", "scripts/lib", "evals", "tests"].flatMap((d) => readdirSync(join(P.ROOT, d)).filter((f) => f.endsWith(".mjs")).map((f) => `${d}/${f}`));
  assert.ok(files.length > 30, `found ${files.length} files`);
  const using = files.filter((f) => /import\.meta\.(dirname|filename)\b/.test(readFileSync(join(P.ROOT, f), "utf8").replace(/\/\/.*$/gm, "")));
  assert.deepEqual(using, []);
});
