import test from "node:test";
import assert from "node:assert/strict";
import { lossChanceFor, resolveOutcome } from "../scripts/crafting/outcome.js";
import { formatSummary } from "../scripts/crafting/summary.js";
import { CRAFTING } from "../scripts/config.js";
import { DEGREES } from "../scripts/adapter/pf2e.js";

/** A plan using 4 iron (spread over two stacks) and 1 silver. */
const PLAN = {
  recipeName: "Test Blade",
  resultName: null,
  fee: 1,
  uses: [
    { slot: "blade", materialId: "iron", materialName: "Iron", units: 4, from: [{ stackId: "s1", units: 3 }, { stackId: "s2", units: 1 }] },
    { slot: "coating", materialId: "silver", materialName: "Silver", units: 1, from: [{ stackId: "s3", units: 1 }] }
  ]
};

/** An rng that returns scripted values in order and counts its calls. */
function scripted(values) {
  const rng = () => { rng.calls++; return values.shift(); };
  rng.calls = 0;
  return rng;
}

/** mulberry32: a small seeded PRNG, so statistical tests are repeatable. */
function seededD100(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * 100) + 1;
  };
}

test("success: item made, every unit and the fee consumed, no loss rolls", () => {
  const rng = scripted([]);
  const out = resolveOutcome({ plan: PLAN, degree: "success", rng });
  assert.equal(out.made, true);
  assert.equal(out.feeConsumed, 1);
  assert.deepEqual(out.consumed.map(c => c.units), [4, 1]);
  assert.deepEqual(out.kept.map(k => k.units), [0, 0]);
  assert.deepEqual(out.consumeByStack, { s1: 3, s2: 1, s3: 1 });
  assert.equal(rng.calls, 0);
});

test("critical success: same as success while thrifty craft is off (the default)", () => {
  assert.equal(CRAFTING.thrifty.enabled, false);
  const out = resolveOutcome({ plan: PLAN, degree: "criticalSuccess", rng: scripted([]) });
  assert.equal(out.made, true);
  assert.equal(out.summary.unitsUsed, 5);
  assert.equal(out.summary.unitsKept, 0);
});

test("critical success with thrifty craft ON refunds a fraction, rounded down per slot", () => {
  const config = { ...CRAFTING, thrifty: { enabled: true, refundFraction: 0.5 } };
  const out = resolveOutcome({ plan: PLAN, degree: "criticalSuccess", rng: scripted([]), config });
  // iron: 4 units -> refund 2; silver: 1 unit -> floor(0.5) = 0 refunded.
  assert.deepEqual(out.kept.map(k => k.units), [2, 0]);
  assert.deepEqual(out.consumed.map(c => c.units), [2, 1]);
  assert.deepEqual(out.consumeByStack, { s1: 2, s3: 1 });
  assert.equal(out.feeConsumed, 1);
});

test("thrifty craft never affects a plain success", () => {
  const config = { ...CRAFTING, thrifty: { enabled: true, refundFraction: 1 } };
  const out = resolveOutcome({ plan: PLAN, degree: "success", rng: scripted([]), config });
  assert.equal(out.summary.unitsKept, 0);
});

test("failure: no item, fee lost, each unit rolls d100 against the loss chance", () => {
  // Chance 50: a roll of 50 or lower loses the unit. Units in order: iron x4, silver x1.
  const rng = scripted([10, 60, 50, 51, 99]);
  const out = resolveOutcome({ plan: PLAN, degree: "failure", rng });
  assert.equal(out.made, false);
  assert.equal(out.feeConsumed, 1);
  assert.equal(rng.calls, 5, "one roll per unit");
  assert.deepEqual(out.lossRolls.map(r => [r.materialId, r.roll, r.lost]), [
    ["iron", 10, true], ["iron", 60, false], ["iron", 50, true], ["iron", 51, false], ["silver", 99, false]
  ]);
  assert.deepEqual(out.consumed.map(c => c.units), [2, 0]);
  assert.deepEqual(out.kept.map(k => k.units), [2, 1]);
  assert.deepEqual(out.consumeByStack, { s1: 2 });
});

test("failure: survivors are kept even when every roll is high; all lost when every roll is low", () => {
  const keep = resolveOutcome({ plan: PLAN, degree: "failure", rng: scripted([100, 100, 100, 100, 100]) });
  assert.equal(keep.summary.unitsKept, 5);
  assert.deepEqual(keep.consumeByStack, {});
  const lose = resolveOutcome({ plan: PLAN, degree: "failure", rng: scripted([1, 1, 1, 1, 1]) });
  assert.equal(lose.summary.unitsKept, 0);
});

test("critical failure: no item, everything and the fee lost, and the rng is NEVER called", () => {
  const rng = scripted([]);
  const out = resolveOutcome({ plan: PLAN, degree: "criticalFailure", rng });
  assert.equal(out.made, false);
  assert.equal(out.feeConsumed, 1);
  assert.equal(out.summary.unitsKept, 0);
  assert.equal(out.summary.unitsUsed, 5);
  assert.equal(rng.calls, 0);
  assert.deepEqual(out.lossRolls, []);
});

test("the fee is spent on every degree", () => {
  for (const degree of DEGREES) {
    assert.equal(resolveOutcome({ plan: PLAN, degree, rng: () => 100 }).feeConsumed, 1, degree);
  }
});

test("only successes make an item", () => {
  const made = Object.fromEntries(DEGREES.map(d => [d, resolveOutcome({ plan: PLAN, degree: d, rng: () => 100 }).made]));
  assert.deepEqual(made, { criticalFailure: false, failure: false, success: true, criticalSuccess: true });
});

// Loss chance layering ---------------------------------------------------------
test("loss chance: slot override beats material override beats the default", () => {
  assert.equal(lossChanceFor({}), 50);
  assert.equal(lossChanceFor({ materialLossChance: 20 }), 20);
  assert.equal(lossChanceFor({ materialLossChance: 20, slotLossChance: 80 }), 80);
  assert.equal(lossChanceFor({ slotLossChance: 0 }), 0, "an explicit 0 must count");
  assert.equal(lossChanceFor({}, { ...CRAFTING, lossChance: 35 }), 35);
});

test("loss chance 100 loses every unit and 0 loses none, whatever the roll", () => {
  const plan = { ...PLAN, uses: [{ ...PLAN.uses[0], slotLossChance: 100 }, { ...PLAN.uses[1], slotLossChance: 0 }] };
  const out = resolveOutcome({ plan, degree: "failure", rng: scripted([1, 100, 50, 100, 1]) });
  assert.deepEqual(out.consumed.map(c => c.units), [4, 0]);
  assert.deepEqual(out.kept.map(k => k.units), [0, 1]);
});

test("a per-slot chance applies to that slot only", () => {
  const plan = { ...PLAN, uses: [{ ...PLAN.uses[0], slotLossChance: 10 }, PLAN.uses[1]] };
  // Iron: chance 10 -> rolls 11..14 survive. Silver: default 50 -> roll 50 is lost.
  const out = resolveOutcome({ plan, degree: "failure", rng: scripted([11, 12, 13, 14, 50]) });
  assert.deepEqual(out.consumed.map(c => c.units), [0, 1]);
});

test("the rng contract is enforced", () => {
  for (const bad of [0, 101, 1.5, NaN, undefined]) {
    assert.throws(() => resolveOutcome({ plan: PLAN, degree: "failure", rng: () => bad }), /integer from 1 to 100/, String(bad));
  }
});

test("an unknown degree throws", () => {
  assert.throws(() => resolveOutcome({ plan: PLAN, degree: "meh", rng: () => 1 }), /unknown degree/);
});

// Statistics --------------------------------------------------------------------
function lossRate(chance, seed, units = 20000) {
  const plan = { fee: 0, uses: [{ slot: "s", materialId: "iron", units, from: [{ stackId: "x", units }], slotLossChance: chance }] };
  const out = resolveOutcome({ plan, degree: "failure", rng: seededD100(seed) });
  return { rate: out.summary.unitsUsed / units, rolls: out.lossRolls };
}

test("loss distribution: the observed loss rate tracks the configured chance", () => {
  for (const chance of [10, 25, 50, 75, 90]) {
    const { rate } = lossRate(chance, 1234 + chance);
    assert.ok(Math.abs(rate - chance / 100) < 0.015, `chance ${chance}: observed ${rate.toFixed(4)}`);
  }
});

test("loss distribution: units are independent (a loss does not predict the next loss)", () => {
  const { rolls } = lossRate(50, 99);
  let afterLoss = 0, lossThenLoss = 0;
  for (let i = 1; i < rolls.length; i++) {
    if (rolls[i - 1].lost) { afterLoss++; if (rolls[i].lost) lossThenLoss++; }
  }
  assert.ok(Math.abs(lossThenLoss / afterLoss - 0.5) < 0.02, `P(loss | previous loss) = ${(lossThenLoss / afterLoss).toFixed(4)}`);
});

test("loss distribution: every roll value 1..100 occurs, roughly evenly", () => {
  const { rolls } = lossRate(50, 7);
  const seen = new Map();
  for (const r of rolls) seen.set(r.roll, (seen.get(r.roll) ?? 0) + 1);
  assert.equal(seen.size, 100);
  for (const count of seen.values()) assert.ok(count > 120 && count < 290, `bucket count ${count}`);
});

test("the same seed gives the same result (tests are repeatable)", () => {
  assert.deepEqual(lossRate(50, 42).rolls.slice(0, 50), lossRate(50, 42).rolls.slice(0, 50));
});

// Summary -----------------------------------------------------------------------
test("the player summary reports counts but never the individual loss rolls", () => {
  const out = resolveOutcome({ plan: PLAN, degree: "failure", rng: scripted([10, 60, 50, 51, 99]) });
  const text = formatSummary({ crafterName: "Aelwyn", plan: PLAN, outcome: out });
  assert.match(text, /Aelwyn/);
  assert.match(text, /Failure/);
  assert.match(text, /No item was made/);
  assert.match(text, /Materials used: 2, kept: 3/);
  assert.match(text, /Fee paid: 1 gp/);
  assert.doesNotMatch(text, /\b(10|60|51|99)\b/);
});

test("the success summary names the created item", () => {
  const out = resolveOutcome({ plan: PLAN, degree: "success", rng: scripted([]) });
  const text = formatSummary({ crafterName: "Aelwyn", plan: PLAN, outcome: out, itemName: "Spider Fang Dagger" });
  assert.match(text, /Success/);
  assert.match(text, /Created: Spider Fang Dagger/);
});
