import test from "node:test";
import assert from "node:assert/strict";
import { formatError, loadDefinitions } from "../scripts/data/validate.js";
import { resolveMaterialEffect } from "../scripts/data/resolver.js";
import { FANG, FANG_RECIPE, MATERIAL, RECIPE, SILVER, UUID, UUID_2, clone, source } from "./helpers.js";

const run = (...records) => loadDefinitions(records.map(r => source(r)));
const fields = errors => errors.map(e => e.field).sort();
const dump = errors => errors.map(formatError).join(" | ");

// Output map --------------------------------------------------------------------
test("output: a valid tier map loads", () => {
  const { errors } = run(MATERIAL, SILVER, RECIPE);
  assert.deepEqual(errors, [], dump(errors));
});

test("output: a tier a qualifying material needs but the map lacks is an error naming the material", () => {
  const { errors } = run(MATERIAL, SILVER, { ...RECIPE, output: { "1": UUID } });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "output");
  assert.match(errors[0].message, /no entry for tier 2.*"silver".*slot "edge"/);
});

test("output: tiers only count for materials that meet the base slot's floor", () => {
  const raised = { ...RECIPE, output: { "3": UUID }, slots: [{ name: "edge", drives: "basePower", tierFloor: 3, qty: 1 }] };
  const starmetal = { kind: "material", id: "starmetal", name: "Starmetal", tier: 3, effects: { basePower: "T3" } };
  const { errors } = run(MATERIAL, SILVER, starmetal, raised);
  assert.deepEqual(errors, [], dump(errors));
});

test("output: bad UUIDs and bad keys are rejected", () => {
  assert.ok(run({ ...RECIPE, output: { "1": "Compendium.pf2e.equipment-srd.Item.short" } }).errors.some(e => e.field === "output.1"));
  assert.ok(run({ ...RECIPE, output: { one: UUID } }).errors.some(e => e.field === "output.one" && /tier number/.test(e.message)));
  assert.ok(run({ ...RECIPE, output: { "9": UUID } }).errors.some(e => e.field === "output.9" && /between/.test(e.message)));
  assert.ok(run({ ...RECIPE, output: {} }).errors.some(e => e.field === "output" && /at least one/.test(e.message)));
});

test("output: a base-role recipe may not use the default key", () => {
  const { errors } = run(MATERIAL, { ...RECIPE, output: { "1": UUID, default: UUID } });
  assert.ok(errors.some(e => e.field === "output.default"), dump(errors));
});

test("output: a category with no base role needs exactly { default }", () => {
  const trinket = { ...RECIPE, id: "charm", category: "trinket", slots: [{ name: "gem", drives: "glow", tierFloor: 1, qty: 1 }], output: { default: UUID } };
  const role = { kind: "customRole", id: "glow", appliesTo: ["trinket"], modifies: "system.glow", effect: 1 };
  assert.deepEqual(run(role, trinket).errors, []);
  const bad = run(role, { ...trinket, output: { "1": UUID } }).errors;
  assert.ok(bad.some(e => e.field === "output" && /"default"/.test(e.message)), dump(bad));
});

test("itemTemplate gets a helpful 'renamed to output' error", () => {
  const { itemTemplate: _drop, ...rest } = { ...RECIPE, itemTemplate: UUID };
  const { errors } = run(MATERIAL, { ...rest, itemTemplate: UUID });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "itemTemplate");
  assert.match(errors[0].message, /replaced by "output"/);
});

test("craftLevel must be 0 to 25", () => {
  assert.deepEqual(run(MATERIAL, { ...RECIPE, craftLevel: 0 }).errors, []);
  assert.deepEqual(run(MATERIAL, { ...RECIPE, craftLevel: 25 }).errors, []);
  assert.equal(run({ ...RECIPE, craftLevel: 26 }).errors[0].field, "craftLevel");
  assert.equal(run({ ...RECIPE, craftLevel: -1 }).errors[0].field, "craftLevel");
});

// Slots driving several roles ---------------------------------------------------
test("drives accepts a string or an array of roles", () => {
  const { errors } = run(MATERIAL, FANG, FANG_RECIPE);
  assert.deepEqual(errors, [], dump(errors));
});

test("drives: empty arrays, repeats and non-strings are rejected", () => {
  const slots = drives => [RECIPE.slots[0], { name: "x", drives, tierFloor: 1, qty: 1 }];
  assert.ok(run({ ...RECIPE, slots: slots([]) }).errors.some(e => e.field === "slots[1].drives"));
  assert.ok(run({ ...RECIPE, slots: slots(["bonusDamage", "bonusDamage"]) }).errors.some(e => /twice/.test(e.message)));
  assert.ok(run({ ...RECIPE, slots: slots(5) }).errors.some(e => e.field === "slots[1].drives"));
});

test("two slots may not drive the same output-picking role", () => {
  const twice = { ...RECIPE, slots: [...RECIPE.slots, { name: "second", drives: "basePower", tierFloor: 1, qty: 1 }] };
  const { errors } = run(MATERIAL, twice);
  assert.ok(errors.some(e => e.field === "slots" && /only one is allowed/.test(e.message)), dump(errors));
});

test("a multi-role slot needs the material to have EVERY driven role (checked at plan time), not at load", () => {
  // Loading is fine even though iron has no bonusDamage; planCraft rejects the selection.
  assert.deepEqual(run(MATERIAL, FANG, FANG_RECIPE).errors, []);
});

// Overrides ---------------------------------------------------------------------
test("override on a multi-role slot must name its role, and the role must be driven by the slot", () => {
  const ov = o => ({ ...FANG_RECIPE, overrides: [o] });
  const effect = { dice: "1d8", type: "poison" };
  assert.ok(run(MATERIAL, FANG, ov({ materialId: "spider-fang", slot: "fang", effect })).errors.some(e => e.field === "overrides[0].role" && /required/.test(e.message)));
  assert.ok(run(MATERIAL, FANG, ov({ materialId: "spider-fang", slot: "fang", role: "resistance", effect })).errors.some(e => /not driven by slot/.test(e.message)));
  assert.deepEqual(run(MATERIAL, FANG, ov({ materialId: "spider-fang", slot: "fang", role: "bonusDamage", effect })).errors, []);
});

test("an override's value is checked against its role's shape", () => {
  const bad = { ...FANG_RECIPE, overrides: [{ materialId: "spider-fang", slot: "fang", role: "bonusDamage", effect: { dice: "1d7", type: "poison" } }] };
  const { errors } = run(MATERIAL, FANG, bad);
  assert.ok(errors.some(e => e.field === "overrides[0].effect.dice"), dump(errors));
});

test("the resolver applies an override only for its own role on a multi-role slot", () => {
  const recipe = { ...FANG_RECIPE, overrides: [{ materialId: "spider-fang", slot: "fang", role: "bonusDamage", effect: { dice: "2d6", type: "poison" } }] };
  assert.equal(resolveMaterialEffect(FANG, "bonusDamage", recipe, "fang").source, "recipe override");
  assert.equal(resolveMaterialEffect(FANG, "specialAbility", recipe, "fang").source, "material default");
});

// Role value shapes ---------------------------------------------------------------
const withEffect = (role, value) => run({ ...MATERIAL, effects: { basePower: "T1", [role]: value } }).errors;

test("bonusDamage shape", () => {
  assert.deepEqual(withEffect("bonusDamage", { dice: "2d6", type: "fire", persistent: true, versus: "undead" }), []);
  assert.ok(withEffect("bonusDamage", { dice: "1d7", type: "fire" }).some(e => e.field === "effects.bonusDamage.dice"));
  assert.ok(withEffect("bonusDamage", { dice: "1d4", type: "gloom" }).some(e => e.field === "effects.bonusDamage.type"));
  assert.ok(withEffect("bonusDamage", { dice: "1d4", type: "fire", versus: "Not A Slug" }).some(e => e.field === "effects.bonusDamage.versus"));
  assert.ok(withEffect("bonusDamage", "+1d4 vs fiends").some(e => e.field === "effects.bonusDamage"));
  assert.ok(withEffect("bonusDamage", { dice: "1d4", type: "fire", extra: 1 }).some(e => e.field === "effects.bonusDamage.extra"));
});

test("specialAbility shape", () => {
  assert.deepEqual(withEffect("specialAbility", { title: "T", text: "x" }), []);
  assert.deepEqual(withEffect("specialAbility", { title: "T", text: "x", on: "criticalHit" }), []);
  assert.ok(withEffect("specialAbility", { title: "T" }).some(e => e.field === "effects.specialAbility.text"));
  assert.ok(withEffect("specialAbility", { title: "T", text: "x", on: "miss" }).some(e => e.field === "effects.specialAbility.on"));
});

test("resistance, spellSlots and tier references", () => {
  assert.deepEqual(withEffect("resistance", { type: "fire", value: 5 }), []);
  assert.ok(withEffect("resistance", { type: "fire", value: 0 }).length > 0);
  assert.ok(withEffect("resistance", { type: "fire", value: 51 }).length > 0);
  assert.deepEqual(withEffect("spellSlots", 2), []);
  assert.ok(withEffect("spellSlots", 0).length > 0);
  assert.deepEqual(run({ ...MATERIAL, effects: { basePower: "T5" } }).errors, []);
  assert.ok(run({ ...MATERIAL, effects: { basePower: "T9" } }).errors.some(e => /between T1 and T5/.test(e.message)));
  assert.ok(run({ ...MATERIAL, effects: { basePower: 2 } }).errors.some(e => e.field === "effects.basePower"));
  assert.ok(run({ ...MATERIAL, effects: { basePower: "2" } }).errors.some(e => /tier like/.test(e.message)));
});

test("loss chance overrides are 0 to 100", () => {
  assert.deepEqual(run({ ...MATERIAL, lossChance: 0 }).errors, []);
  assert.deepEqual(run({ ...MATERIAL, lossChance: 100 }).errors, []);
  assert.ok(run({ ...MATERIAL, lossChance: 101 }).errors.some(e => e.field === "lossChance"));
  const slot = { ...RECIPE, slots: [{ ...RECIPE.slots[0], lossChance: -5 }] };
  assert.ok(run(MATERIAL, slot).errors.some(e => e.field === "slots[0].lossChance"));
});

test("custom roles may only modify system.* paths, never rules", () => {
  const role = path => ({ kind: "customRole", id: "bulky", appliesTo: ["weapon"], modifies: path, effect: 1 });
  assert.deepEqual(run(role("system.bulk.value")).errors, []);
  for (const bad of ["system.rules", "system.rules.0.value", "name", "flags.pf2e.x", "system.__proto__.x", "system."]) {
    assert.ok(run(role(bad)).errors.some(e => e.field === "modifies"), `should reject ${bad}`);
  }
});

test("custom role values are scalars, and clones do not mutate fixtures", () => {
  const role = { kind: "customRole", id: "bulky", appliesTo: ["weapon"], modifies: "system.bulk.value", effect: { no: 1 } };
  assert.ok(run(role).errors.some(e => e.field === "effect"));
  const before = JSON.stringify(RECIPE);
  clone(RECIPE).slots.push({});
  assert.equal(JSON.stringify(RECIPE), before);
});
