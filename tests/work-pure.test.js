/** Stage 10a, the pure parts: charge reservations, escrow arithmetic, the keyed lock, and the craft-day floor. */
import test from "node:test";
import assert from "node:assert/strict";
import { availableCharges, release, reserve, reserveProblem, reservedOf, spendReserved } from "../scripts/gathering/reserve.js";
import { describeEscrow, escrowFromPlan, escrowProblems, escrowStackId, refusalText, unusedUnits, virtualStacks } from "../scripts/queue/escrow.js";
import { withLock, withLocks } from "../scripts/queue/lock.js";
import { craftDays } from "../scripts/crafting/days.js";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";

const node = (over = {}) => ({ source: "explored", state: "active", nodeType: "herb", tier: 1, charges: 3, discoveredBy: [], ...over });

// Reservations ---------------------------------------------------------------------------------------------------
test("a node with free charges can be reserved; the claim never exceeds the charges", () => {
  let record = node({ charges: 2 });
  assert.equal(reserveProblem(record), null);
  record = reserve(record);
  record = reserve(record);
  assert.equal(reservedOf(record), 2);
  assert.equal(availableCharges(record), 0);
  assert.match(reserveProblem(record, "Herb Patch"), /Herb Patch has no free charge left: every charge it has is already claimed/);
  assert.throws(() => reserve(record), /no free charge/);
});

test("reserveProblem refuses an anchor, a hidden node and a depleted node, in plain words", () => {
  assert.match(reserveProblem({ source: "placed", state: "anchor", discoveredBy: [] }, "Anchor"), /not a node you can gather from/);
  assert.match(reserveProblem(node({ revealed: false }), "Herb Patch"), /has not been found yet/);
  assert.match(reserveProblem(node({ state: "depleted", charges: 0 }), "Herb Patch"), /is depleted/);
  assert.equal(reserveProblem(undefined), "That node is not a node you can gather from");
});

test("release gives the claim back, and drops the key at zero (never a stray 0)", () => {
  const two = reserve(reserve(node()));
  const one = release(two);
  assert.equal(one.reservedCharges, 1);
  const none = release(one);
  assert.equal("reservedCharges" in none, false);
  assert.throws(() => release(none), /no reserved charge/);
});

test("spendReserved turns the claim into a spent charge; at 0 charges the node is depleted", () => {
  const a = spendReserved(reserve(node({ charges: 3 })), 2);
  assert.deepEqual([a.charges, a.state, "reservedCharges" in a], [2, "active", false]);
  const b = spendReserved(reserve(reserve(node({ charges: 2 }))), 1);
  assert.deepEqual([b.charges, b.state, b.reservedCharges], [1, "active", 1], "the other claim is still held");
  const last = spendReserved(reserve(node({ charges: 1 })), 0);
  assert.deepEqual([last.charges, last.state, "reservedCharges" in last], [0, "depleted", false]);
  assert.throws(() => spendReserved(node(), 2), /no reserved charge/);
  assert.throws(() => spendReserved(reserve(node({ charges: 3 })), 1), /spends one charge/);
});

test("the node schema accepts a claim up to the charges and rejects more, and rejects one on an anchor", () => {
  assert.deepEqual(check(LIVE_SCHEMAS.node, node({ charges: 2, reservedCharges: 2 })), []);
  assert.match(check(LIVE_SCHEMAS.node, node({ charges: 2, reservedCharges: 3 })).map(p => p.message).join(), /cannot be more than the node's charges/);
  assert.ok(check(LIVE_SCHEMAS.node, { source: "placed", state: "anchor", discoveredBy: [], reservedCharges: 1 }).length);
  assert.ok(check(LIVE_SCHEMAS.node, node({ reservedCharges: 0 })).length, "0 is not stored; the key is dropped instead");
});

test("any order of reserve, release and spend keeps 0 <= claimed <= charges (random walk)", () => {
  let seed = 11;
  const rand = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 200; run++) {
    let record = node({ charges: 1 + rand(4) });
    for (let step = 0; step < 30 && record.state === "active"; step++) {
      const choice = rand(3);
      if (choice === 0 && !reserveProblem(record)) record = reserve(record);
      else if (choice === 1 && reservedOf(record) > 0) record = release(record);
      else if (choice === 2 && reservedOf(record) > 0) record = spendReserved(record, record.charges - 1);
      assert.deepEqual(check(LIVE_SCHEMAS.node, record), [], JSON.stringify(record));
      assert.ok(reservedOf(record) >= 0 && reservedOf(record) <= record.charges);
    }
  }
});

// Escrow -----------------------------------------------------------------------------------------------------------
const plan = {
  fee: 5, station: { id: "forge", name: "Forge", tier: 2 },
  uses: [
    { slot: "blade", materialId: "iron", materialName: "Iron", units: 2, from: [{ stackId: "s1", units: 1 }, { stackId: "s2", units: 1 }] },
    { slot: "fang", materialId: "spider-fang", materialName: "Spider Fang", units: 1, from: [{ stackId: "s3", units: 1 }] }
  ]
};

test("escrowFromPlan records the fee in copper, the days, and one entry per material, plus what to take from each real stack", () => {
  const { escrow, byStack } = escrowFromPlan({ plan, days: 2, tierOf: id => (id === "iron" ? 1 : 2) });
  assert.deepEqual(escrow, {
    days: 2, feeCopper: 500, station: { id: "forge", name: "Forge" },
    units: [{ materialId: "iron", name: "Iron", tier: 1, units: 2 }, { materialId: "spider-fang", name: "Spider Fang", tier: 2, units: 1 }]
  });
  assert.deepEqual(byStack, { s1: 1, s2: 1, s3: 1 });
  assert.equal(describeEscrow(escrow), "2x Iron, 1x Spider Fang and a 5 gp fee");
});

test("the escrow is converted exactly once: used + returned = escrowed, for every pattern of loss", () => {
  const { escrow } = escrowFromPlan({ plan, days: 2, tierOf: () => 1 });
  assert.deepEqual(virtualStacks(escrow), [
    { stackId: "escrow:iron", materialId: "iron", quantity: 2 }, { stackId: "escrow:spider-fang", materialId: "spider-fang", quantity: 1 }
  ]);
  for (const ironLost of [0, 1, 2]) for (const fangLost of [0, 1]) {
    const consume = {};
    if (ironLost) consume[escrowStackId("iron")] = ironLost;
    if (fangLost) consume[escrowStackId("spider-fang")] = fangLost;
    const back = unusedUnits(escrow, consume);
    const returned = Object.fromEntries(back.map(u => [u.materialId, u.units]));
    assert.equal((returned.iron ?? 0) + ironLost, 2);
    assert.equal((returned["spider-fang"] ?? 0) + fangLost, 1);
    assert.ok(back.every(u => u.units > 0), "nothing of zero units is handed back");
  }
});

test("escrowProblems finds a missing, mismatched or malformed record", () => {
  const { escrow } = escrowFromPlan({ plan, days: 2, tierOf: () => 1 });
  assert.deepEqual(escrowProblems({ daysReserved: 2, params: { escrow } }), []);
  assert.match(escrowProblems({ daysReserved: 2, params: {} })[0], /has no escrow record/);
  assert.match(escrowProblems({ daysReserved: 3, params: { escrow } })[0], /says 2 day\(s\) but 3 are reserved/);
  assert.match(escrowProblems({ daysReserved: 2, params: { escrow: { ...escrow, feeCopper: 1.5 } } })[0], /fee in escrow is not a whole number/);
  assert.match(escrowProblems({ daysReserved: 2, params: { escrow: { ...escrow, units: [] } } })[0], /no materials are recorded/);
  assert.match(escrowProblems({ daysReserved: 2, params: { escrow: { ...escrow, units: [{ materialId: "iron", units: 0 }] } } })[0], /escrow material #1 is not valid/);
});

test("a shortage refusal points at the Compendium and says nothing can be bought; other refusals do not", () => {
  assert.equal(refusalText(['slot "blade": needs 3 Iron but only 1 available']),
    'Cannot queue this craft: slot "blade": needs 3 Iron but only 1 available. Nothing can be bought: check the Compendium for where to find what you are missing.');
  assert.equal(refusalText(["Ann does not know the formula for \"Blade\""]), 'Cannot queue this craft: Ann does not know the formula for "Blade".');
});

// Lock -------------------------------------------------------------------------------------------------------------
test("calls with the same key run one at a time, in arrival order, even when an earlier one is slow", async () => {
  const order = [];
  const slow = withLock("k", async () => { order.push("a-start"); await new Promise(r => setTimeout(r, 15)); order.push("a-end"); });
  const fast = withLock("k", async () => { order.push("b"); });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["a-start", "a-end", "b"]);
});

test("different keys do not wait for each other", async () => {
  const order = [];
  const slow = withLock("x", async () => { await new Promise(r => setTimeout(r, 15)); order.push("x"); });
  const fast = withLock("y", async () => { order.push("y"); });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["y", "x"]);
});

test("a failing call rejects its caller but does not break the chain behind it", async () => {
  const failing = withLock("z", async () => { throw new Error("boom"); });
  const after = withLock("z", async () => "fine");
  await assert.rejects(failing, /boom/);
  assert.equal(await after, "fine");
});

test("withLocks takes keys in the given order (node, then actor) and releases them all", async () => {
  const inside = [];
  await Promise.all([
    withLocks(["node:1", "actor:a"], async () => { inside.push("first"); await new Promise(r => setTimeout(r, 10)); inside.push("first-done"); }),
    withLocks(["node:1", "actor:b"], async () => { inside.push("second"); })
  ]);
  assert.deepEqual(inside, ["first", "first-done", "second"], "they share the node, so the second waits");
  assert.equal(await withLocks(["node:1", "actor:a"], async () => "free again"), "free again");
});

// Craft days -------------------------------------------------------------------------------------------------------
test("craftDays: every reduction is applied first and the result never drops below 1 day", () => {
  const recipe = { craftLevel: 4 }; // base 1 + floor(4 / 2) = 3
  assert.equal(craftDays(recipe).days, 3);
  assert.equal(craftDays(recipe, [1]).days, 2);
  assert.equal(craftDays(recipe, [1, { days: 1, source: "forge upgrade" }]).days, 1);
  const stacked = craftDays(recipe, [2, 2, 5]);
  assert.deepEqual([stacked.days, stacked.floored], [1, true]);
});
