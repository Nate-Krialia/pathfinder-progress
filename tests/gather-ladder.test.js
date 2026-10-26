import test from "node:test";
import assert from "node:assert/strict";
import { GATHERING, TIER_RANGES } from "../scripts/config.js";
import { baseDcFor, resolveRungs, validateLadder } from "../scripts/gathering/ladder.js";
import { formatError, loadDefinitions } from "../scripts/data/validate.js";
import { isSkillSlug } from "../scripts/adapter/pf2e.js";
import { asPage, seedRecords, source, MATERIAL, SILVER } from "./helpers.js";

const rung = (materialId, dcOffset, extra = {}) => ({ materialId, dcOffset, quantity: "1d4", ...extra });
const GOOD = [rung("iron", 0, { guaranteed: true }), rung("silver", 5), rung("starmetal", 11)];

// Base DC table ---------------------------------------------------------------------
test("the spec's placeholder DCs: tier 1 = 10, tier 2 = 15, tier 3 = 20", () => {
  assert.deepEqual([1, 2, 3].map(t => baseDcFor(t)), [10, 15, 20]);
});

test("config sanity: every node tier has a base DC and the table never decreases", () => {
  let previous = -Infinity;
  for (let tier = TIER_RANGES.node.min; tier <= TIER_RANGES.node.max; tier++) {
    const dc = baseDcFor(tier);
    assert.ok(dc >= previous, `tier ${tier}`);
    previous = dc;
  }
});

test("a tier with no configured DC throws", () => {
  assert.throws(() => baseDcFor(9), RangeError);
  assert.equal(baseDcFor(2, { baseDcByTier: { 2: 99 } }), 99);
});

// Rungs ----------------------------------------------------------------------------------
test("rung DCs are the base DC plus offsets (spec table: 10/15/21, 15/20/26, 20/25/31)", () => {
  for (const [tier, expected] of [[1, [10, 15, 21]], [2, [15, 20, 26]], [3, [20, 25, 31]]]) {
    assert.deepEqual(resolveRungs(GOOD, tier).rungs.map(r => r.dc), expected, `tier ${tier}`);
  }
});

test("resolveRungs separates the base rung from the higher ones", () => {
  const { baseDc, base, higher } = resolveRungs(GOOD, 2);
  assert.equal(baseDc, 15);
  assert.equal(base.materialId, "iron");
  assert.deepEqual(higher.map(r => r.materialId), ["silver", "starmetal"]);
});

// Ladder validation ---------------------------------------------------------------------------
test("a good ladder has no problems", () => {
  assert.deepEqual(validateLadder(GOOD), []);
});

test("a ladder needs exactly one guaranteed rung", () => {
  assert.match(validateLadder([rung("iron", 0), rung("silver", 5)])[0].message, /exactly one guaranteed rung.*found 0/);
  const two = [rung("iron", 0, { guaranteed: true }), rung("silver", 5, { guaranteed: true })];
  assert.match(validateLadder(two)[0].message, /found 2/);
});

test("the guaranteed base rung must have the lowest dcOffset", () => {
  const bad = [rung("iron", 5, { guaranteed: true }), rung("silver", 0)];
  const [error] = validateLadder(bad);
  assert.equal(error.field, "[0].dcOffset");
  assert.match(error.message, /must have the lowest dcOffset.*"silver" has 0/);
});

test("a tie for lowest offset is allowed; negative offsets work if the base is lowest", () => {
  assert.deepEqual(validateLadder([rung("iron", 0, { guaranteed: true }), rung("silver", 0)]), []);
  assert.deepEqual(validateLadder([rung("iron", -2, { guaranteed: true }), rung("silver", 0)]), []);
  assert.equal(validateLadder([rung("iron", 0, { guaranteed: true }), rung("silver", -1)]).length, 1);
});

test("duplicate materials in one ladder are rejected", () => {
  const dup = [rung("iron", 0, { guaranteed: true }), rung("iron", 5)];
  assert.equal(validateLadder(dup)[0].field, "[1].materialId");
});

// nodeType definitions --------------------------------------------------------------------------------
const NODE_TYPE = { kind: "nodeType", id: "ore", name: "Ore", skills: ["athletics", "crafting"], charges: 3, ladders: { "1": GOOD } };
const load = (...records) => loadDefinitions(records.map(r => source(r)));
const STARMETAL = { kind: "material", id: "starmetal", name: "Starmetal", tier: 3, effects: { basePower: "T3" } };

test("the seed's four node types validate", () => {
  const { registry, errors } = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })));
  assert.deepEqual(errors, [], errors.map(formatError).join(" | "));
  assert.deepEqual([...registry.nodeType.keys()].sort(), ["corpse", "herb", "ore", "salvage"]);
  assert.equal(registry.nodeType.get("corpse").ladders, undefined, "a corpse type has no default ladder");
});

test("a valid nodeType loads", () => {
  const { errors } = load(MATERIAL, SILVER, STARMETAL, NODE_TYPE);
  assert.deepEqual(errors, [], errors.map(formatError).join(" | "));
});

test("nodeType skills must be PF2e skill slugs (lores allowed)", () => {
  assert.ok(isSkillSlug("nature") && isSkillSlug("herbalism-lore") && !isSkillSlug("herbalism") && !isSkillSlug("Nature"));
  const { errors } = load(MATERIAL, SILVER, STARMETAL, { ...NODE_TYPE, skills: ["nature", "herbalism"] });
  assert.ok(errors.some(e => e.field === "skills[1]" && /not a PF2e skill/.test(e.message)), errors.map(formatError).join(" | "));
  assert.deepEqual(load(MATERIAL, SILVER, STARMETAL, { ...NODE_TYPE, skills: ["herbalism-lore"] }).errors, []);
});

test("a nodeType ladder is validated: guaranteed rule, lowest offset, unknown materials", () => {
  const noBase = { ...NODE_TYPE, ladders: { "1": [rung("iron", 0), rung("silver", 5)] } };
  assert.ok(load(MATERIAL, SILVER, noBase).errors.some(e => e.field === "ladders.1" && /exactly one guaranteed/.test(e.message)));

  const hardBase = { ...NODE_TYPE, ladders: { "1": [rung("iron", 5, { guaranteed: true }), rung("silver", 0)] } };
  assert.ok(load(MATERIAL, SILVER, hardBase).errors.some(e => e.field === "ladders.1[0].dcOffset" && /lowest dcOffset/.test(e.message)));

  const unknown = { ...NODE_TYPE, ladders: { "1": [rung("iron", 0, { guaranteed: true }), rung("mithral", 5)] } };
  const { errors } = load(MATERIAL, unknown);
  assert.ok(errors.some(e => e.field === "ladders.1[1].materialId" && /unknown material "mithral"/.test(e.message)), errors.map(formatError).join(" | "));
});

test("nodeType ladder keys must be node tiers", () => {
  const { errors } = load(MATERIAL, { ...NODE_TYPE, ladders: { "9": [rung("iron", 0, { guaranteed: true })] } });
  assert.ok(errors.some(e => e.field === "ladders.9" && /node tier from 1 to 5/.test(e.message)), errors.map(formatError).join(" | "));
  assert.ok(load(MATERIAL, { ...NODE_TYPE, ladders: { first: [rung("iron", 0, { guaranteed: true })] } }).errors.length > 0);
});

test("a nodeType needs at least one skill and at least one default charge", () => {
  assert.ok(load(MATERIAL, { ...NODE_TYPE, skills: [] }).errors.some(e => e.field === "skills"));
  assert.ok(load(MATERIAL, { ...NODE_TYPE, charges: 0 }).errors.some(e => e.field === "charges"));
});
