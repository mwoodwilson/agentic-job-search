import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findRow, changeStatus } from "../scripts/set-status.mjs";

const csv = () => {
  const dir = mkdtempSync(join(tmpdir(), "set-status-"));
  const file = join(dir, "jobs.csv");
  writeFileSync(file, [
    '"Fit","Status","Company","Title","Location","Team","Pay","Pay check","Posted","Found","Link"',
    '"","Resume ready","Larkfield","Senior Product Manager, Growth","Chicago, IL","","","","","","https://larkfield.example/1"',
    '"","Backlog","Larkfield","Senior Product Manager, Payments","Chicago, IL","","","","","","https://larkfield.example/2"',
    '"","Resume ready","Acme","Product Manager, Search","Remote","","","","","","https://acme.example/3"',
  ].join("\n") + "\n");
  return file;
};

test("set-status finds a role by its link", () => {
  assert.equal(findRow("https://acme.example/3", { file: csv() }).Company, "Acme");
});

test("set-status finds a role by words from its company and title", () => {
  assert.equal(findRow("larkfield growth", { file: csv() }).Link, "https://larkfield.example/1");
});

test("set-status refuses words that match more than one role, or none", () => {
  assert.throws(() => findRow("larkfield", { file: csv() }), /2 roles match/);
  assert.throws(() => findRow("globex", { file: csv() }), /No role matches/);
  assert.throws(() => findRow("", { file: csv() }), /Give a link/);
});

test("set-status changes the status and leaves other rows alone", () => {
  const file = csv();
  const row = changeStatus("acme search", "Applied", { file });
  assert.equal(row.Title, "Product Manager, Search");
  const text = readFileSync(file, "utf8");
  assert.match(text, /"Applied","Acme"/);
  assert.match(text, /"Resume ready","Larkfield","Senior Product Manager, Growth"/);
});

test("set-status refuses an unknown status", () => {
  assert.throws(() => changeStatus("acme", "Interviewing", { file: csv() }), /unknown status/);
});
