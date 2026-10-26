import test from "node:test";
import assert from "node:assert/strict";
import { activateRecord, makeAnchorRecord, makeCorpseRecord, makeNodeRecord, normalizeNode, refillRecord } from "../scripts/gathering/node.js";
import { formatGatherSummary } from "../scripts/gathering/summary.js";
import { readNaturalD20 } from "../scripts/adapter/pf2e.js";
import { validateRecord } from "../scripts/data/validate.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const token = { uuid: "Scene.s.Token.t", name: "Iron Vein" };
const norm = record => normalizeNode({ record, token, registry });
const ctx = { pack: "live", entry: "node" };
const messages = record => validateRecord("node", record, ctx).map(e => `${e.field}: ${e.message}`).join(" | ");

const ACTIVE = { source: "placed", state: "active", nodeType: "ore", tier: 1, charges: 3, discoveredBy: [] };
const ANCHOR = { source: "placed", state: "anchor", discoveredBy: [] };
const CORPSE_LADDER = [
  { materialId: "iron", dcOffset: 0, quantity: "1d2", guaranteed: true },
  { materialId: "silver", dcOffset: 4, quantity: "1" }
];

// State rules in the schema -----------------------------------------------------------------
test("an anchor is minimal; an active or depleted node is complete", () => {
  assert.equal(messages(ANCHOR), "");
  assert.equal(messages(ACTIVE), "");
  assert.equal(messages({ ...ACTIVE, state: "depleted", charges: 0 }), "");
});

test("anchors must not carry node fields", () => {
  for (const field of ["nodeType", "tier", "charges", "ladder"]) {
    const value = { nodeType: "ore", tier: 1, charges: 1, ladder: CORPSE_LADDER }[field];
    assert.match(messages({ ...ANCHOR, [field]: value }), new RegExp(`${field}: must not be set on an anchor`), field);
  }
});

test("a node past the anchor stage needs its type, tier and charges", () => {
  const { nodeType: _a, tier: _b, charges: _c, ...bare } = ACTIVE;
  const text = messages(bare);
  for (const field of ["nodeType", "tier", "charges"]) assert.match(text, new RegExp(`${field}: is required once a node is active`));
});

test("charges and state must agree: depleted is 0, active is at least 1", () => {
  assert.match(messages({ ...ACTIVE, state: "depleted", charges: 2 }), /charges: must be 0 when the node is depleted \(got 2\)/);
  assert.match(messages({ ...ACTIVE, charges: 0 }), /must be at least 1 when the node is active/);
});

test("corpse rules: a decay timer and its own ladder are required, and it cannot be an anchor", () => {
  const corpse = { ...ACTIVE, source: "corpse", nodeType: "corpse" };
  assert.match(messages(corpse), /decayTimer: is required/);
  assert.match(messages(corpse), /ladder: is required/);
  assert.equal(messages({ ...corpse, decayTimer: 3, ladder: CORPSE_LADDER }), "");
  assert.match(messages({ ...ANCHOR, source: "corpse", decayTimer: 3 }), /a corpse cannot be an anchor/);
  assert.match(messages({ ...ACTIVE, decayTimer: 3 }), /only applies when source is "corpse"/);
});

test("tier must be a valid node tier and unknown fields are refused", () => {
  assert.match(messages({ ...ACTIVE, tier: 9 }), /tier: must be at most 5/);
  assert.match(messages({ ...ACTIVE, id: "x" }), /id: is not a recognised field/);
});

test("a node's own ladder is validated like a nodeType's", () => {
  const noBase = { ...ACTIVE, ladder: [{ materialId: "iron", dcOffset: 0, quantity: "1" }] };
  assert.match(messages(noBase), /ladder: must have exactly one guaranteed rung/);
});

// normalizeNode ---------------------------------------------------------------------------------------
test("an active ore node resolves its ladder from the nodeType with absolute DCs", () => {
  const { ok, node } = norm(ACTIVE);
  assert.ok(ok);
  assert.deepEqual(node.skills, ["athletics", "crafting"]);
  assert.equal(node.nodeTypeName, "Ore Vein");
  assert.equal(node.ladder.source, "nodeType");
  assert.deepEqual(node.ladder.rungs.map(r => [r.materialId, r.dc, r.base]), [["iron", 10, true], ["silver", 15, false], ["starmetal", 21, false]]);
  assert.equal(node.uuid, token.uuid);
});

test("an anchor normalises without a ladder", () => {
  const { ok, node } = norm(ANCHOR);
  assert.ok(ok);
  assert.deepEqual([node.state, node.ladder, node.nodeType, node.skills], ["anchor", null, null, []]);
});

test("a corpse node uses its own ladder", () => {
  const { ok, node } = norm({ ...ACTIVE, source: "corpse", nodeType: "corpse", charges: 2, decayTimer: 3, ladder: CORPSE_LADDER });
  assert.ok(ok);
  assert.equal(node.ladder.source, "node");
  assert.deepEqual(node.ladder.rungs.map(r => r.dc), [10, 14]);
  assert.deepEqual(node.skills, ["medicine", "survival", "nature"]);
  assert.equal(node.decayTimer, 3);
});

test("errors name the token and say what is wrong", () => {
  assert.match(norm({ ...ACTIVE, nodeType: "gem" }).errors[0], /Iron Vein: unknown nodeType "gem" \(known: .*ore.*\)/);
  assert.match(norm({ ...ACTIVE, tier: 5 }).errors[0], /Iron Vein: nodeType "ore" has no ladder for tier 5, and the node has none of its own/);
  assert.match(norm({ ...ACTIVE, ladder: [{ materialId: "mithral", dcOffset: 0, quantity: "1", guaranteed: true }] }).errors[0], /unknown material\(s\): mithral/);
  assert.match(norm({ ...ACTIVE, charges: -1 }).errors[0], /^Iron Vein: charges/);
  const noLadderType = norm({ ...ACTIVE, nodeType: "corpse" });
  assert.match(noLadderType.errors[0], /nodeType "corpse" has no ladder for tier 1/);
});

// Transitions ---------------------------------------------------------------------------------------------
test("makeAnchorRecord builds a minimal hidden-marker record", () => {
  const { ok, record } = makeAnchorRecord({ region: "wood" }, registry);
  assert.ok(ok);
  assert.deepEqual(record, { source: "placed", state: "anchor", discoveredBy: [], region: "wood" });
  assert.equal(makeAnchorRecord({ source: "corpse" }, registry).ok, false);
});

test("makeNodeRecord defaults charges from the nodeType and checks everything", () => {
  const { ok, record } = makeNodeRecord({ nodeType: "ore", tier: 2 }, registry);
  assert.ok(ok);
  assert.deepEqual([record.state, record.source, record.charges, record.tier], ["active", "placed", 3, 2]);
  assert.equal(makeNodeRecord({ nodeType: "ore", tier: 1, charges: 7 }, registry).record.charges, 7);
  assert.match(makeNodeRecord({ nodeType: "gem", tier: 1 }, registry).errors[0], /unknown nodeType "gem"/);
  assert.match(makeNodeRecord({ nodeType: "ore", tier: 4 }, registry).errors[0], /no ladder for tier 4/);
  assert.match(makeNodeRecord({ nodeType: "ore", tier: 1, source: "corpse" }, registry).errors[0], /makeCorpseRecord/);
});

test("activating an anchor fills it from the nodeType; only anchors can be activated", () => {
  const anchor = makeAnchorRecord({}, registry).record;
  const { ok, record } = activateRecord(anchor, { nodeType: "herb", tier: 1 }, registry);
  assert.ok(ok);
  assert.deepEqual([record.state, record.nodeType, record.tier, record.charges], ["active", "herb", 1, 3]);
  assert.match(activateRecord(record, { nodeType: "herb", tier: 1 }, registry).errors[0], /only an anchor can be activated \(this node is active\)/);
  assert.match(activateRecord(anchor, { nodeType: "gem", tier: 1 }, registry).errors[0], /unknown nodeType/);
  assert.match(activateRecord(anchor, { nodeType: "herb", tier: 3 }, registry).errors[0], /no ladder for tier 3/);
});

test("activation can mark the node as explored and set charges and region", () => {
  const anchor = makeAnchorRecord({}, registry).record;
  const { record } = activateRecord(anchor, { nodeType: "ore", tier: 1, charges: 5, source: "explored", region: "hills" }, registry);
  assert.deepEqual([record.source, record.charges, record.region], ["explored", 5, "hills"]);
});

test("refilling brings a depleted node back to active", () => {
  const depleted = { ...ACTIVE, state: "depleted", charges: 0 };
  const { ok, record } = refillRecord(depleted, undefined, registry);
  assert.ok(ok);
  assert.deepEqual([record.state, record.charges], ["active", 3], "defaults to the nodeType's charges");
  assert.equal(refillRecord(depleted, 8, registry).record.charges, 8);
  assert.equal(refillRecord({ ...ACTIVE, charges: 1 }, 3, registry).record.charges, 3, "an active node can be topped up too");
});

test("refilling refuses anchors and bad amounts", () => {
  assert.match(refillRecord(ANCHOR, 3, registry).errors[0], /anchor has no charges/);
  for (const bad of [0, -1, 1.5]) assert.match(refillRecord(ACTIVE, bad, registry).errors[0], /at least 1/);
});

test("a corpse node needs a ladder and a decay timer", () => {
  assert.match(makeCorpseRecord({ tier: 1, decayTimer: 3 }, registry).errors[0], /needs its own ladder/);
  assert.match(makeCorpseRecord({ tier: 1, ladder: CORPSE_LADDER }, registry).errors.join(" "), /decayTimer/);
  const { ok, record } = makeCorpseRecord({ tier: 1, ladder: CORPSE_LADDER, decayTimer: 3 }, registry);
  assert.ok(ok);
  assert.deepEqual([record.source, record.nodeType, record.state, record.charges], ["corpse", "corpse", "active", 2]);
});

test("a corpse ladder that breaks the rules is refused", () => {
  const bad = [{ materialId: "iron", dcOffset: 3, quantity: "1", guaranteed: true }, { materialId: "silver", dcOffset: 0, quantity: "1" }];
  assert.match(makeCorpseRecord({ tier: 1, ladder: bad, decayTimer: 3 }, registry).errors.join(" "), /lowest dcOffset/);
});

// Summary ------------------------------------------------------------------------------------------------------
const NAMES = { iron: "Iron", silver: "Silver" };
const node = { name: "Iron Vein" };

test("the summary lists what was gathered and the charges left", () => {
  const result = { passed: true, gains: [{ materialId: "iron", quantity: 3 }, { materialId: "silver", quantity: 1 }], chargesAfter: 2, stateAfter: "active" };
  const text = formatGatherSummary({ gathererName: "Aelwyn", node, skillName: "Athletics", result, materialNames: NAMES });
  assert.match(text, /Aelwyn.*gathers from.*Iron Vein.*\(Athletics\).*Success/);
  assert.match(text, /Gathered: 3 Iron, 1 Silver\./);
  assert.match(text, /Charges left: 2\./);
});

test("a failure and a depleting gather read correctly", () => {
  const failure = { passed: false, gains: [], chargesAfter: 1, stateAfter: "active" };
  assert.match(formatGatherSummary({ gathererName: "A", node, skillName: "Athletics", result: failure, materialNames: NAMES }), /Failure.*Nothing was gathered\..*Charges left: 1\./);
  const last = { passed: true, gains: [{ materialId: "iron", quantity: 1 }], chargesAfter: 0, stateAfter: "depleted" };
  const text = formatGatherSummary({ gathererName: "A", node, skillName: "Athletics", result: last, materialNames: NAMES });
  assert.match(text, /The node is now depleted\./);
  assert.doesNotMatch(text, /Charges left/);
});

test("the summary never reveals hidden rolls or the rungs that were tried", () => {
  const result = {
    passed: true, gains: [{ materialId: "iron", quantity: 2 }], chargesAfter: 2, stateAfter: "active",
    hidden: [{ materialId: "silver", dc: 15, roll: 3, total: 12, success: false }]
  };
  const text = formatGatherSummary({ gathererName: "A", node, skillName: "Athletics", result, materialNames: NAMES });
  assert.doesNotMatch(text, /silver|Silver|\b15\b|\b12\b|hidden/i);
});

// Reading the natural d20 from PF2e's roll --------------------------------------------------------------------------
test("readNaturalD20 reads the kept d20 from a roll", () => {
  assert.equal(readNaturalD20({ dice: [{ faces: 20, results: [{ result: 7, active: true }] }] }), 7);
});

test("readNaturalD20 takes the kept die when the roll kept the higher of two", () => {
  const roll = { dice: [{ faces: 20, results: [{ result: 3, active: false }, { result: 15, active: true }] }] };
  assert.equal(readNaturalD20(roll), 15);
});

test("readNaturalD20 ignores non-d20 dice and falls back to the term total", () => {
  assert.equal(readNaturalD20({ dice: [{ faces: 6, results: [{ result: 4 }] }, { faces: 20, total: 11 }] }), 11);
});

test("readNaturalD20 returns null rather than guessing", () => {
  assert.equal(readNaturalD20({ dice: [{ faces: 6, results: [{ result: 4, active: true }] }] }), null);
  assert.equal(readNaturalD20({ dice: [] }), null);
  assert.equal(readNaturalD20({}), null);
  assert.equal(readNaturalD20(null), null);
  assert.equal(readNaturalD20({ dice: [{ faces: 20, results: [{ result: "x", active: true }] }] }), null);
});
