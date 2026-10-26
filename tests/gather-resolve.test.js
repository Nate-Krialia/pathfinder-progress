import test from "node:test";
import assert from "node:assert/strict";
import { checkGatherable, hiddenSuccessChance, neededD20, pickSkill, resolveGather, visiblePassChance } from "../scripts/gathering/resolve.js";
import { normalizeNode } from "../scripts/gathering/node.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;

/** A normalised node view built from the seed definitions. */
function nodeView(record = {}) {
  const result = normalizeNode({
    record: { source: "placed", state: "active", nodeType: "ore", tier: 1, charges: 3, discoveredBy: [], ...record },
    token: { uuid: "Scene.s.Token.t", name: "Iron Vein" },
    registry
  });
  assert.ok(result.ok, result.errors?.join(" | "));
  return result.node;
}

/** Scripted random sources that count their calls. */
function scripted({ d20 = [], die = [] } = {}) {
  const src = {
    d20Calls: 0, dieCalls: 0,
    d20: () => { src.d20Calls++; return d20.shift(); },
    die: () => { src.dieCalls++; return die.shift(); }
  };
  return src;
}

/** mulberry32 seeded generator returning an integer 1..sides. */
function seeded(seed) {
  let a = seed >>> 0;
  return sides => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * sides) + 1;
  };
}

const PASS = { passed: true, degree: "success" };
const FAIL = { passed: false, degree: "failure" };

// The spec's gate -------------------------------------------------------------------------
test("a passed visible roll always yields the base material", () => {
  const rng = scripted({ d20: [1, 1], die: [3] });
  const result = resolveGather({ node: nodeView(), visible: PASS, modifier: -50, d20: rng.d20, die: rng.die });
  assert.deepEqual(result.gains, [{ materialId: "iron", quantity: 3, rung: "base" }]);
});

test("a failed visible roll yields nothing and rolls NO dice at all", () => {
  const rng = scripted();
  const result = resolveGather({ node: nodeView(), visible: FAIL, modifier: 99, d20: rng.d20, die: rng.die });
  assert.deepEqual(result.gains, []);
  assert.deepEqual(result.hidden, []);
  assert.equal(rng.d20Calls + rng.dieCalls, 0, "no hidden rolls and no quantity dice after a failure");
});

test("higher rungs come only from their own hidden rolls (silver DC 15, starmetal DC 21)", () => {
  // modifier 9: silver needs a natural 6+, starmetal a natural 12+.
  const cases = [
    { d20: [5, 11], expected: ["iron"] },
    { d20: [6, 11], expected: ["iron", "silver"] },
    { d20: [5, 12], expected: ["iron", "starmetal"] },
    { d20: [6, 12], expected: ["iron", "silver", "starmetal"] }
  ];
  for (const { d20, expected } of cases) {
    const rng = scripted({ d20: [...d20], die: [2, 1, 1] });
    const result = resolveGather({ node: nodeView(), visible: PASS, modifier: 9, d20: rng.d20, die: rng.die });
    assert.deepEqual(result.gains.map(g => g.materialId), expected, `d20 ${d20}`);
  }
});

test("the DC boundary is inclusive: meeting the DC succeeds, one short fails", () => {
  const hit = resolveGather({ node: nodeView(), visible: PASS, modifier: 9, ...scripted({ d20: [6, 1], die: [1, 1] }) });
  assert.equal(hit.hidden[0].total, 15);
  assert.equal(hit.hidden[0].success, true);
  const miss = resolveGather({ node: nodeView(), visible: PASS, modifier: 9, ...scripted({ d20: [5, 1], die: [1] }) });
  assert.equal(miss.hidden[0].total, 14);
  assert.equal(miss.hidden[0].success, false);
});

test("the visible roll does NOT unlock higher rungs automatically", () => {
  // Even a huge modifier, if the hidden d20s are low, gives only the base material... until the total meets the DC.
  const rng = scripted({ d20: [1, 1], die: [1] });
  const result = resolveGather({ node: nodeView(), visible: { passed: true, degree: "criticalSuccess" }, modifier: 5, d20: rng.d20, die: rng.die });
  assert.deepEqual(result.gains.map(g => g.materialId), ["iron"]);
});

test("one hidden roll per higher rung, each recorded for the GM", () => {
  const rng = scripted({ d20: [10, 20], die: [1, 1, 1] });
  const result = resolveGather({ node: nodeView(), visible: PASS, modifier: 4, d20: rng.d20, die: rng.die });
  assert.equal(rng.d20Calls, 2);
  assert.deepEqual(result.hidden.map(h => [h.materialId, h.dc, h.roll, h.total, h.success]), [
    ["silver", 15, 10, 14, false],
    ["starmetal", 21, 20, 24, true]
  ]);
});

test("quantity dice are used per rung (iron 1d4, silver 1d2, starmetal 1)", () => {
  const rng = scripted({ d20: [20, 20], die: [4, 2] });
  const result = resolveGather({ node: nodeView(), visible: PASS, modifier: 9, d20: rng.d20, die: rng.die });
  assert.deepEqual(result.gains.map(g => [g.materialId, g.quantity]), [["iron", 4], ["silver", 2], ["starmetal", 1]]);
  assert.equal(rng.dieCalls, 2, "starmetal's fixed quantity rolls no die");
});

test("a quantity that rolls to nothing is not granted", () => {
  const registry2 = registry;
  const node = normalizeNode({
    record: { source: "placed", state: "active", nodeType: "ore", tier: 1, charges: 1, discoveredBy: [],
      ladder: [{ materialId: "iron", dcOffset: 0, quantity: "1d4-3", guaranteed: true }] },
    token: { uuid: "u", name: "n" }, registry: registry2
  }).node;
  const result = resolveGather({ node, visible: PASS, modifier: 0, ...scripted({ die: [1] }) });
  assert.deepEqual(result.gains, []);
});

// Charges ----------------------------------------------------------------------------------
test("every attempt burns exactly one charge: pass, fail, with or without a haul", () => {
  for (const visible of [PASS, FAIL]) {
    const result = resolveGather({ node: nodeView({ charges: 3 }), visible, modifier: 0, ...scripted({ d20: [1, 1], die: [1] }) });
    assert.equal(result.chargesBefore, 3);
    assert.equal(result.chargesAfter, 2, visible.passed ? "pass" : "fail");
    assert.equal(result.stateAfter, "active");
  }
});

test("the last charge depletes the node, even on a failure", () => {
  assert.equal(resolveGather({ node: nodeView({ charges: 1 }), visible: FAIL, modifier: 0, ...scripted() }).stateAfter, "depleted");
  const done = resolveGather({ node: nodeView({ charges: 1 }), visible: PASS, modifier: 0, ...scripted({ d20: [1, 1], die: [1] }) });
  assert.deepEqual([done.chargesAfter, done.stateAfter], [0, "depleted"]);
});

test("a depleted node or an anchor is refused BEFORE any dice are rolled", () => {
  const rng = scripted();
  const depleted = nodeView({ state: "depleted", charges: 0 });
  assert.match(checkGatherable(depleted), /Iron Vein is depleted/);
  assert.throws(() => resolveGather({ node: depleted, visible: PASS, modifier: 0, d20: rng.d20, die: rng.die }), /depleted/);
  const anchor = nodeView({ state: "anchor", nodeType: undefined, tier: undefined, charges: undefined });
  assert.match(checkGatherable(anchor), /anchor.*cannot be gathered until it is activated/);
  assert.throws(() => resolveGather({ node: anchor, visible: PASS, modifier: 0, d20: rng.d20, die: rng.die }), /anchor/);
  assert.equal(rng.d20Calls + rng.dieCalls, 0);
});

test("resolving does not mutate the node view", () => {
  const node = nodeView();
  const before = JSON.stringify(node);
  resolveGather({ node, visible: PASS, modifier: 3, ...scripted({ d20: [10, 10], die: [1, 1, 1] }) });
  assert.equal(JSON.stringify(node), before);
});

test("the random sources' contracts are enforced", () => {
  assert.throws(() => resolveGather({ node: nodeView(), visible: PASS, modifier: 0, d20: () => 21, die: () => 1 }), /d20 must return an integer from 1 to 20/);
  assert.throws(() => resolveGather({ node: nodeView(), visible: PASS, modifier: 0, d20: () => 5, die: () => 9 }), /integer from 1 to 4/);
});

// Other tiers and ladders --------------------------------------------------------------------
test("a tier-2 ore node has silver as its base and starmetal as its hidden rung (DCs 15 and 20)", () => {
  const node = nodeView({ tier: 2 });
  assert.equal(node.ladder.base.materialId, "silver");
  assert.deepEqual(node.ladder.higher.map(r => [r.materialId, r.dc]), [["starmetal", 20]]);
  assert.equal(node.ladder.baseDc, 15);
});

test("a per-node ladder override beats the nodeType's ladder", () => {
  const node = nodeView({ ladder: [{ materialId: "silver", dcOffset: 0, quantity: "1", guaranteed: true }] });
  assert.equal(node.ladder.source, "node");
  assert.equal(node.ladder.base.materialId, "silver");
  assert.equal(nodeView().ladder.source, "nodeType");
});

// The odds helpers --------------------------------------------------------------------------------
test("hiddenSuccessChance matches brute-force enumeration of the d20", () => {
  for (const modifier of [-5, 0, 3, 9, 14, 25]) {
    for (const dc of [8, 10, 15, 21, 26, 40]) {
      let hits = 0;
      for (let roll = 1; roll <= 20; roll++) if (roll + modifier >= dc) hits++;
      assert.equal(hiddenSuccessChance(modifier, dc), hits / 20, `mod ${modifier} dc ${dc}`);
    }
  }
});

test("neededD20: the lowest natural that succeeds, or null when impossible", () => {
  assert.equal(neededD20(9, 15), 6);
  assert.equal(neededD20(9, 21), 12);
  assert.equal(neededD20(30, 15), 1);
  assert.equal(neededD20(0, 21), null);
  assert.equal(neededD20(0, 20), 20);
});

test("visiblePassChance models PF2e degrees: natural 1 steps down, natural 20 steps up", () => {
  assert.equal(visiblePassChance(9, 10), 0.95, "only a natural 1 turns a bare success into a failure");
  assert.equal(visiblePassChance(0, 10), 0.55);
  assert.equal(visiblePassChance(0, 15), 0.3);
  assert.equal(visiblePassChance(-10, 15), 0.05, "a natural 20 lifts a failure to a success");
  assert.equal(visiblePassChance(30, 10), 1, "a natural 1 only drops a critical success to a success");
  assert.equal(visiblePassChance(-30, 10), 0);
});

// Skills -----------------------------------------------------------------------------------------------
test("skill choice: single option is picked automatically, several must be named, wrong ones refused", () => {
  assert.deepEqual(pickSkill(["crafting"], undefined, "Salvage Heap"), { ok: true, skill: "crafting" });
  assert.deepEqual(pickSkill(["athletics", "crafting"], "crafting", "Ore Vein"), { ok: true, skill: "crafting" });
  assert.match(pickSkill(["athletics", "crafting"], undefined, "Ore Vein").error, /allow several skills \(athletics, crafting\); choose one with skill/);
  assert.match(pickSkill(["athletics", "crafting"], "nature", "Ore Vein").error, /skill "nature" is not allowed for Ore Vein nodes \(allowed: athletics, crafting\)/);
  assert.match(pickSkill(["crafting"], "athletics", "Salvage Heap").error, /not allowed/);
});

// Statistics --------------------------------------------------------------------------------------------
function trials(n, { modifier, record = {}, seed }) {
  const die = seeded(seed);
  const tally = { passes: 0, byMaterial: {}, qty: {}, calls: 0 };
  for (let i = 0; i < n; i++) {
    const node = nodeView({ charges: 3, ...record });
    const result = resolveGather({ node, visible: PASS, modifier, d20: () => die(20), die });
    tally.passes++;
    for (const g of result.gains) {
      tally.byMaterial[g.materialId] = (tally.byMaterial[g.materialId] ?? 0) + 1;
      tally.qty[g.materialId] = (tally.qty[g.materialId] ?? 0) + g.quantity;
    }
  }
  return tally;
}

test("statistics: hidden rung success rates match the exact odds across modifiers (20,000 trials each)", () => {
  const n = 20000;
  for (const modifier of [0, 3, 9, 14, 20]) {
    const tally = trials(n, { modifier, seed: 1000 + modifier });
    for (const [material, dc] of [["silver", 15], ["starmetal", 21]]) {
      const observed = (tally.byMaterial[material] ?? 0) / n;
      const expected = hiddenSuccessChance(modifier, dc);
      assert.ok(Math.abs(observed - expected) < 0.015, `${material} at +${modifier}: observed ${observed.toFixed(4)}, expected ${expected}`);
    }
  }
});

test("statistics: Bottlespeaker's +9 gives about 75% silver and 45% starmetal", () => {
  const n = 20000;
  const tally = trials(n, { modifier: 9, seed: 42 });
  assert.ok(Math.abs(tally.byMaterial.silver / n - 0.75) < 0.015);
  assert.ok(Math.abs(tally.byMaterial.starmetal / n - 0.45) < 0.015);
  assert.equal(tally.byMaterial.iron, n, "iron on every pass");
});

test("statistics: impossible and certain rungs behave exactly", () => {
  const n = 5000;
  const never = trials(n, { modifier: 0, seed: 7 }); // starmetal DC 21 is out of reach with +0
  assert.equal(never.byMaterial.starmetal ?? 0, 0);
  const always = trials(n, { modifier: 20, seed: 8 }); // silver needs a 1, starmetal a 1
  assert.equal(always.byMaterial.silver, n);
  assert.equal(always.byMaterial.starmetal, n);
});

test("statistics: expected yield equals pass rate times mean quantity", () => {
  const n = 20000;
  const tally = trials(n, { modifier: 9, seed: 99 });
  assert.ok(Math.abs(tally.qty.iron / n - 2.5) < 0.04, `iron per gather ${tally.qty.iron / n}`);
  const silverPerAppearance = tally.qty.silver / tally.byMaterial.silver;
  assert.ok(Math.abs(silverPerAppearance - 1.5) < 0.03, `silver per appearance ${silverPerAppearance}`);
  assert.equal(tally.qty.starmetal, tally.byMaterial.starmetal, "starmetal is always exactly 1");
});

test("statistics: two rungs at the same DC succeed independently (P(both) is about p squared)", () => {
  const ladder = [
    { materialId: "iron", dcOffset: 0, quantity: "1", guaranteed: true },
    { materialId: "silver", dcOffset: 5, quantity: "1" },
    { materialId: "starmetal", dcOffset: 5, quantity: "1" }
  ];
  const die = seeded(5150);
  const n = 20000;
  let both = 0, silver = 0, starmetal = 0;
  for (let i = 0; i < n; i++) {
    const result = resolveGather({ node: nodeView({ ladder }), visible: PASS, modifier: 9, d20: () => die(20), die });
    const s = result.gains.some(g => g.materialId === "silver");
    const m = result.gains.some(g => g.materialId === "starmetal");
    if (s) silver++;
    if (m) starmetal++;
    if (s && m) both++;
  }
  const p = hiddenSuccessChance(9, 15);
  assert.ok(Math.abs(silver / n - p) < 0.015 && Math.abs(starmetal / n - p) < 0.015);
  assert.ok(Math.abs(both / n - p * p) < 0.015, `P(both) = ${(both / n).toFixed(4)}, p^2 = ${p * p}`);
});

test("statistics: the visible pass rate model agrees with a simulated PF2e-style check", () => {
  const die = seeded(31337);
  const n = 40000;
  for (const [modifier, dc] of [[9, 10], [0, 10], [4, 18], [-10, 15], [12, 10]]) {
    let passes = 0;
    for (let i = 0; i < n; i++) {
      const natural = die(20);
      const total = natural + modifier;
      let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
      if (natural === 20) degree = Math.min(3, degree + 1);
      if (natural === 1) degree = Math.max(0, degree - 1);
      if (degree >= 2) passes++;
    }
    assert.ok(Math.abs(passes / n - visiblePassChance(modifier, dc)) < 0.012, `mod ${modifier} dc ${dc}`);
  }
});
