// The pay rule, with the floors from search.pay: a role passes when the top of its USD range is over minTop.
// Under it, a base-salary range passes only if its top is over minBaseTop AND extra pay (bonus, equity, …) is
// mentioned. A total-comp range under minTop fails. Missing, unreadable or non-USD pay goes to Review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compStatus, useSettings } from "../scripts/job-pull.mjs";
import { withDefaults } from "../scripts/lib/settings.mjs";
import { filledSettings } from "./helpers.mjs";

const PAY = { minTop: 200000, minBaseTop: 150000 };
const base = (pay, extra = " Plus an annual bonus and equity.") => ({ pay, description: `The base salary range for this role is ${pay}.${extra}` });

test("top of range over minTop passes", () => {
  assert.equal(compStatus(base("$170,000 - $210,000", ""), PAY), "Pass: top of range over $200K");
});

test("a base range topping out over minBaseTop, with extra pay mentioned, passes", () => {
  assert.equal(compStatus(base("$140,000 - $190,000"), PAY), "Pass: base over $150K plus bonus/equity, top under $200K");
});

test("a base range topping out at minBaseTop or less fails", () => {
  assert.equal(compStatus(base("$120,000 - $150,000"), PAY), "Fail: base under $150K");
});

test("a base range under minTop with no bonus or equity mentioned fails", () => {
  assert.equal(compStatus(base("$160,000 - $180,000", " Benefits include health insurance."), PAY), "Fail: base under $200K, no bonus or equity mentioned");
});

test("total comp under minTop fails", () => {
  assert.equal(compStatus({ pay: "$160,000 - $190,000", description: "The total compensation range is $160,000 - $190,000." }, PAY), "Fail: total comp, top under $200K");
});

test("base vs total unclear under minTop goes to Review", () => {
  assert.equal(compStatus({ pay: "$160,000 - $190,000", description: "Pay: $160,000 - $190,000." }, PAY), "Review: top under $200K, base vs total comp unclear");
});

test("no pay floor (0): any readable range passes; missing pay is still flagged for review", () => {
  const none = { minTop: 0, minBaseTop: 0 };
  assert.equal(compStatus(base("$60,000 - $80,000", ""), none), "Pass: no pay floor");
  assert.equal(compStatus({ pay: "", description: "" }, none), "Review: no pay listed");
});

test("without a pay argument, the rule uses the active settings", () => {
  const s = withDefaults(filledSettings());
  s.search.pay = PAY;
  useSettings(s);
  assert.equal(compStatus(base("$140,000 - $190,000")), "Pass: base over $150K plus bonus/equity, top under $200K");
});
