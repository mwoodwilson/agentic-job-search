import { test } from "node:test";
import assert from "node:assert/strict";
import { passesFilters, noteRemote, sameRolePosting } from "../scripts/job-pull.mjs";
import { validateSettings } from "../scripts/lib/settings.mjs";

const search = (over = {}) => ({
  companies: [
    { name: "Acme", ats: "greenhouse", slug: "acme" },
    { name: "Larkfield", ats: "ashby", slug: "larkfield", titles: ["product marketing"] },
  ],
  titleKeywords: ["product manager", "product marketing"],
  titleExclude: [],
  locationKeywords: ["remote", "chicago"],
  usOnly: true,
  ...over,
});

// --- A company's own title words ("titles") ---
test("a company with titles keeps only roles matching them", () => {
  const role = (title) => ({ company: "Larkfield", title, location: "Chicago, IL" });
  assert.equal(passesFilters(role("Senior Product Marketing Manager"), search()), true);
  assert.equal(passesFilters(role("Senior Product Manager, Payments"), search()), false);
});

test("companies without titles are unaffected", () => {
  assert.equal(passesFilters({ company: "Acme", title: "Senior Product Manager", location: "Chicago, IL" }, search()), true);
});

test("titles must be a non-empty list of words, or left out", () => {
  const problems = (titles) => {
    const s = search();
    s.companies[1].titles = titles;
    return validateSettings({ search: s }).filter((p) => p.includes(".titles"));
  };
  assert.equal(problems(["product marketing"]).length, 0);
  assert.equal(problems([]).length, 1);
  assert.equal(problems("product marketing").length, 1);
  assert.equal(problems([""]).length, 1);
});

// --- A remote offer in the description ---
const office = (description, location = "San Francisco, United States") =>
  ({ company: "Acme", title: "Senior Product Manager", location, primaryLocation: location, description });

test("a description that offers remote passes, even when the location field names only an office city", () => {
  for (const text of [
    "Choose what works for you: fully remote or a hybrid mix of office and home.",
    "This role can be remote within the United States.",
    "Open to remote candidates in the US.",
    "You can work remotely from anywhere in the US.",
    "This position is remote-friendly.",
    "Hybrid or remote, your choice.",
    "Remote (US) or in our San Francisco office.",
  ]) assert.equal(passesFilters(office(text), search()), true, text);
});

test("a description that rules remote out, or never offers it, does not pass", () => {
  for (const text of [
    "This role is not remote. You'll be in our San Francisco office 3 days a week.",
    "We're a remote-first company, but this role is not eligible for remote work.",
    "Hybrid: 3 days a week in our San Francisco office.",
    "We build tools for remote teams.",
    "",
  ]) assert.equal(passesFilters(office(text), search()), false, text);
});

test("a remote offer in the description doesn't override a non-US location", () => {
  assert.equal(passesFilters(office("Fully remote or hybrid.", "Melbourne, Australia"), search()), false);
});

test("noteRemote adds Remote to the location shown in the job list", () => {
  assert.equal(noteRemote(office("Fully remote or hybrid.")).location, "San Francisco, United States | Remote");
  assert.equal(noteRemote(office("Hybrid: 3 days in office.")).location, "San Francisco, United States");
  assert.equal(noteRemote(office("Fully remote or hybrid.", "Remote - US")).location, "Remote - US");
});

// --- Same company + title: one role, unless the requisition IDs differ ---
const WD = "https://acme.wd1.myworkdayjobs.com/Careers/job/";

test("different requisition IDs with the same title are separate roles", () => {
  assert.equal(sameRolePosting(`${WD}Chicago/Product-Manager_R-282280`, `${WD}Remote/Product-Manager_R-294191-1`), false);
});

test("the same requisition on the careers site and on Workday is one role", () => {
  assert.equal(sameRolePosting("https://careers.acme.example/job/R-282280/Product-Manager", `${WD}Chicago/Product-Manager_R-282280`), true);
});

test("links that differ only in case are one role", () => {
  assert.equal(sameRolePosting("https://jobs.ashbyhq.com/Acme/a8c79425", "https://jobs.ashbyhq.com/acme/a8c79425"), true);
});

test("same title on the same board without requisition IDs is still one role", () => {
  assert.equal(sameRolePosting("https://job-boards.greenhouse.io/acme/jobs/8334663", "https://job-boards.greenhouse.io/acme/jobs/8334999"), true);
});

test("a repost on a job site of a careers-site role is still one role", () => {
  assert.equal(sameRolePosting("https://www.linkedin.com/jobs/view/4123456789", "https://job-boards.greenhouse.io/acme/jobs/8334663"), true);
});
