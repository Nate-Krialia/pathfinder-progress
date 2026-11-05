/** Tag system, Slice 1 (docs/22-tags-slice1.md): the pure parts. The ledger rules, slot matching, the schema and the plan. Every refusal here has its own test. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { planCraft as basePlanCraft } from "../scripts/crafting/plan.js";
import { effectiveTags, effectiveTier, emptyLedger, entryProblems, fittingRefs, hasNeeds, isOptionalSlot, itemName, ledgerProblems, slotFit, standInMaterial } from "../scripts/tags/ledger.js";
import { stripForPlayer } from "../scripts/data/playerSet.js";
import { asPage, findTagLeaks, seedRecords, UUID, UUID_2, RECIPE } from "./helpers.js";

const ITEM = "Compendium.pf2e.equipment-srd.Item.CCCCCCCCCCCCCCCC";
const tag = (id, extra = {}) => ({ kind: "tag", id, name: id[0].toUpperCase() + id.slice(1), theme: `${id} things`, ...extra });
const mat = (id, tier, extra = {}) => ({ kind: "material", id, name: id, tier, effects: { basePower: `T${tier}` }, ...extra });
const defs = (...records) => loadDefinitions([...seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), ...records.map(r => ({ pack: "t", entry: r.id, text: asPage(r) }))]);
const needsRecipe = (slots, extra = {}) => ({ ...RECIPE, id: "tagged-sword", name: "Tagged Sword", output: { 1: UUID, 2: UUID_2, 3: UUID, 4: UUID_2, 5: UUID }, slots, ...extra });
const BLADE = { name: "blade", drives: "basePower", tierFloor: 1, qty: 1, needs: { all: ["blade"] } };
const HILT = { name: "hilt", drives: "specialAbility", tierFloor: 1, qty: 1, needs: { all: ["hilt"] } };
const GUARD = { name: "guard", drives: "specialAbility", tierFloor: 2, qty: 1, needs: { all: ["guard"], optional: true } };
const world = () => {
  const { registry, errors } = defs(tag("blade"), tag("hilt"), tag("guard"), mat("ironbar", 1, { tag: "blade" }), mat("steelbar", 3, { tag: "blade" }), needsRecipe([BLADE, HILT, GUARD]));
  assert.deepEqual(errors.map(e => `${e.entry} ${e.field} ${e.message}`), []);
  return registry;
};
const LEDGER = { v: 1, items: { [ITEM]: { tags: ["hilt"], tier: 2, name: "Leather Strap" }, steelbar: { tags: ["guard"] } } };

// Ledger entries ---------------------------------------------------------------------------------------------------
test("ENTRY: an item needs at least one tag", () => {
  assert.deepEqual(entryProblems("ironbar", { tags: [] }, world()), ["Give it at least one tag."]);
  assert.deepEqual(entryProblems("ironbar", {}, world()), ["Give it at least one tag."]);
});
test("ENTRY: a tag that does not exist is refused by name, a repeated tag too", () => {
  assert.match(entryProblems("ironbar", { tags: ["nope"] }, world())[0], /"nope" is not a tag yet/);
  assert.match(entryProblems("ironbar", { tags: ["blade", "blade"] }, world())[0], /listed twice/);
});
test("ENTRY: an item that is not a material must carry a tier (PF2e items have none)", () => {
  const r = entryProblems(ITEM, { tags: ["hilt"], name: "Strap" }, world());
  assert.equal(r.length, 1); assert.match(r[0], /no tier of its own: give it one/);
  assert.deepEqual(entryProblems(ITEM, { tags: ["hilt"], name: "Strap", tier: 2 }, world()), []);
});
test("ENTRY: a material may leave the tier out (it uses its own)", () => { assert.deepEqual(entryProblems("ironbar", { tags: ["guard"] }, world()), []); });
test("ENTRY: the tier must be a whole number from 1 to 5", () => {
  for (const tier of [0, 6, 1.5, "2"]) assert.match(entryProblems(ITEM, { tags: ["hilt"], name: "S", tier }, world())[0], /whole number from 1 to 5/, String(tier));
});
test("ENTRY: an item that is not a material needs a name to show", () => { assert.match(entryProblems(ITEM, { tags: ["hilt"], tier: 1 }, world())[0], /Give the item a name to show/); });
test("ENTRY: no reference, no entry", () => { assert.deepEqual(entryProblems("", { tags: ["x"] }, world()), ["Say which item this is."]); assert.deepEqual(entryProblems("a", null, world()), ["The entry is missing."]); });
test("LEDGER SHAPE: an unknown or damaged setting is an error to show", () => {
  assert.deepEqual(ledgerProblems(emptyLedger()), []);
  assert.match(ledgerProblems({ v: 2, items: {} })[0], /unknown shape/);
  assert.match(ledgerProblems({ v: 1, items: { x: { tags: "no" } } })[0], /"x" is damaged/);
});

// Effective tags and tier (migration on read) -----------------------------------------------------------------------
test("MIGRATION ON READ: a material's single tag is its first tag; the ledger adds more; nothing is stored", () => {
  const reg = world();
  assert.deepEqual(effectiveTags("ironbar", reg, emptyLedger()), ["blade"]);
  assert.deepEqual(effectiveTags("steelbar", reg, LEDGER), ["blade", "guard"]);
  assert.deepEqual(effectiveTags("steelbar", reg, { v: 1, items: { steelbar: { tags: ["blade", "guard"] } } }), ["blade", "guard"], "no repeat");
  assert.deepEqual(effectiveTags(ITEM, reg, LEDGER), ["hilt"]);
  assert.deepEqual(effectiveTags("nothing", reg, LEDGER), []);
});
test("TIER: the ledger's word beats the material's own; an untiered unknown item has none", () => {
  const reg = world();
  assert.equal(effectiveTier("steelbar", reg, emptyLedger()), 3);
  assert.equal(effectiveTier("steelbar", reg, { v: 1, items: { steelbar: { tags: ["blade"], tier: 5 } } }), 5);
  assert.equal(effectiveTier(ITEM, reg, LEDGER), 2);
  assert.equal(effectiveTier("nothing", reg, LEDGER), null);
  assert.equal(itemName(ITEM, reg, LEDGER), "Leather Strap"); assert.equal(itemName("ironbar", reg, LEDGER), "ironbar");
});

// Slot fit ---------------------------------------------------------------------------------------------------------
test("FIT: a slot without needs is the old tier rule, and a ledger-only item never fits it", () => {
  const reg = world(), old = { name: "x", drives: "basePower", tierFloor: 2, qty: 1 };
  assert.equal(hasNeeds(old), false);
  assert.equal(slotFit(old, "steelbar", reg, LEDGER).ok, true);
  assert.match(slotFit(old, "ironbar", reg, LEDGER).reason, /is tier 1 but the slot needs tier 2/);
  assert.match(slotFit(old, ITEM, reg, LEDGER).reason, /unknown material/);
});
test("FIT: a tagged slot needs every tag; a missing one is named", () => {
  const reg = world(), both = { ...BLADE, needs: { all: ["blade", "guard"] } };
  assert.equal(slotFit(BLADE, "ironbar", reg, LEDGER).ok, true);
  assert.match(slotFit(both, "ironbar", reg, LEDGER).reason, /missing Guard/);
  assert.equal(slotFit(both, "steelbar", reg, LEDGER).ok, true, "blade from its material tag + guard from the ledger");
});
test("FIT: the tier floor still applies next to needs", () => {
  const reg = world();
  assert.match(slotFit({ ...BLADE, tierFloor: 2 }, "ironbar", reg, LEDGER).reason, /is tier 1 but the slot needs tier 2/);
  assert.equal(slotFit({ ...BLADE, tierFloor: 2 }, "steelbar", reg, LEDGER).ok, true);
  assert.match(slotFit({ ...HILT, tierFloor: 3 }, ITEM, reg, LEDGER).reason, /Leather Strap is tier 2 but the slot needs tier 3/, "a ledger item counts by the tier the GM gave it");
});
test("FIT: an untagged PF2e item cannot fill a tagged slot", () => { assert.match(slotFit(HILT, UUID_2, world(), LEDGER).reason, /has not been tagged by the GM/); });
test("FIT: fittingRefs and standInMaterial", () => {
  const reg = world();
  assert.deepEqual(fittingRefs(HILT, ["ironbar", ITEM, UUID_2], reg, LEDGER), [ITEM]);
  const s = standInMaterial(ITEM, LEDGER);
  assert.deepEqual({ id: s.id, name: s.name, tier: s.tier, effects: s.effects, standIn: s.standIn }, { id: ITEM, name: "Leather Strap", tier: 2, effects: {}, standIn: true });
  assert.equal(standInMaterial(UUID_2, LEDGER), null);
  assert.equal(isOptionalSlot(GUARD), true); assert.equal(isOptionalSlot(BLADE), false); assert.equal(isOptionalSlot({ name: "x", tierFloor: 1 }), false);
});

// Schema and validation ----------------------------------------------------------------------------------------------
test("SCHEMA: needs must name at least one tag", () => {
  const { errors } = defs(tag("blade"), needsRecipe([{ ...BLADE, needs: { all: [] } }]));
  assert.ok(errors.some(e => /needs\.all/.test(e.field)), JSON.stringify(errors));
});
test("VALIDATION: a slot may only need tags that exist, and not the same tag twice", () => {
  const unknown = defs(tag("blade"), needsRecipe([{ ...BLADE, needs: { all: ["ghost"] } }]));
  assert.ok(unknown.errors.some(e => /slots\[0\]\.needs\.all/.test(e.field) && /unknown tag "ghost"/.test(e.message)), JSON.stringify(unknown.errors));
  const twice = defs(tag("blade"), needsRecipe([{ ...BLADE, needs: { all: ["blade", "blade"] } }]));
  assert.ok(twice.errors.some(e => /lists "blade" twice/.test(e.message)), JSON.stringify(twice.errors));
});
test("SCHEMA: a tag's priority is a whole number from -1000 to 1000", () => {
  assert.deepEqual(defs(tag("a", { priority: 5 })).errors, []);
  for (const priority of [1001, -1001, 1.5, "high"]) assert.ok(defs(tag("a", { priority })).errors.length > 0, String(priority));
});
test("COMPAT: the seed recipes (no needs) load unchanged", () => { assert.deepEqual(defs().errors, []); });

// planCraft -------------------------------------------------------------------------------------------------------------
const STATION = { id: "forge", name: "Forge", category: RECIPE.stationCategory, tier: 1 };
const plan = (args) => basePlanCraft({ outputs: { "1": UUID, "2": UUID_2, "3": UUID }, station: STATION, ledger: LEDGER, ...args });
const stacks = (...pairs) => pairs.map(([id, n = 1], i) => ({ stackId: `s${i}`, materialId: id, quantity: n }));
const run = (selection, st) => { const reg = world(); return plan({ recipe: reg.recipe.get("tagged-sword"), registry: reg, selection, stacks: st }); };

test("PLAN: required tagged slots are filled by tag; the optional one may stay empty", () => {
  const r = run({ blade: "ironbar", hilt: ITEM }, stacks(["ironbar"], [ITEM]));
  assert.ok(r.ok, r.errors?.join(" | "));
  assert.deepEqual(r.plan.uses.map(u => [u.slot, u.materialId, u.materialName]), [["blade", "ironbar", "ironbar"], ["hilt", ITEM, "Leather Strap"]]);
  assert.equal(r.plan.baseTier, 1);
});
test("PLAN: a required tagged slot left empty is an error; an optional one is not", () => {
  const r = run({ blade: "ironbar" }, stacks(["ironbar"]));
  assert.deepEqual(r.errors, ['slot "hilt": no material selected']);
});
test("PLAN: the optional slot can be filled too (tier floor and tag apply)", () => {
  assert.ok(run({ blade: "ironbar", hilt: ITEM, guard: "steelbar" }, stacks(["ironbar"], [ITEM], ["steelbar"])).ok);
  assert.match(run({ blade: "ironbar", hilt: ITEM, guard: "ironbar" }, stacks(["ironbar", 2], [ITEM])).errors[0], /missing Guard/);
});
test("PLAN: an item without the tag is refused with the reason", () => {
  assert.match(run({ blade: "ironbar", hilt: "steelbar" }, stacks(["ironbar"], ["steelbar"])).errors[0], /slot "hilt": steelbar is missing Hilt/);
});
test("PLAN: an item the GM never tagged says so and is not an 'unknown material'", () => {
  assert.match(run({ blade: "ironbar", hilt: UUID_2 }, stacks(["ironbar"], [UUID_2])).errors[0], /cannot fill this slot \(the GM has not tagged it\)/);
});
test("PLAN: quantity is still checked for a ledger item", () => { assert.match(run({ blade: "ironbar", hilt: ITEM }, stacks(["ironbar"])).errors[0], /needs 1 Leather Strap but only 0 available/); });
test("PLAN: an item with no effect for the slot's role adds nothing in a TAGGED slot (an old slot still refuses)", () => {
  const r = run({ blade: "ironbar", hilt: ITEM }, stacks(["ironbar"], [ITEM]));
  assert.equal(r.plan.description.abilities.length, 0);
  const reg = defs(tag("blade"), mat("ironbar", 1), mat("plain", 1, { effects: {} }), needsRecipe([{ name: "blade", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "hilt", drives: "specialAbility", tierFloor: 1, qty: 1 }])).registry;
  const old = basePlanCraft({ recipe: reg.recipe.get("tagged-sword"), registry: reg, selection: { blade: "ironbar", hilt: "plain" }, stacks: stacks(["ironbar"], ["plain"]), outputs: { "1": UUID }, ledger: emptyLedger() });
  assert.match(old.errors[0], /has no effect for role "specialAbility"/);
});
test("PLAN (a player's preview): the slot's `fits` decide; no tags are needed", () => {
  const recipe = { ...RECIPE, id: "tagged-sword", slots: [{ name: "hilt", drives: "specialAbility", tierFloor: 1, qty: 1, optional: false, fits: [{ id: ITEM, name: "Leather Strap" }] }] };
  const ok = basePlanCraft({ recipe, registry: { material: new Map() }, selection: { hilt: ITEM }, stacks: stacks([ITEM]), mechanical: true, ledger: emptyLedger() });
  assert.ok(ok.ok, ok.errors?.join(" | ")); assert.equal(ok.plan.uses[0].materialName, "Leather Strap");
  const bad = basePlanCraft({ recipe, registry: { material: new Map() }, selection: { hilt: UUID_2 }, stacks: stacks([UUID_2]), mechanical: true, ledger: emptyLedger() });
  assert.match(bad.errors[0], /cannot fill this slot/);
});

// The leak scan itself must fail when something leaks (a scan that cannot fail proves nothing) -----------------------------
test("LEAK SCAN: it FAILS on a tag list, needs, a ledger tier, a priority, a needed tag id in a slot, or an extra key in fits", () => {
  const known = { ledgerOnlyRefs: [ITEM], neededTags: ["venomous"] };
  const clean = { kind: "recipe", id: "r", slots: [{ name: "fang", drives: "x", tierFloor: 1, qty: 1, optional: false, fits: [{ id: ITEM, name: "Strap" }] }] };
  assert.deepEqual(findTagLeaks([{ data: clean }], known), []);
  const planted = {
    needs: { ...clean, slots: [{ ...clean.slots[0], needs: { all: ["venomous"] } }] },
    tags: { kind: "material", id: "m", tags: ["venomous"] },
    ledger: { kind: "x", id: "y", tagLedger: {} },
    tier: { kind: "material", id: ITEM, tier: 2 },
    priority: { kind: "tag", id: "t", priority: 3 },
    "tag id in a slot": { ...clean, slots: [{ ...clean.slots[0], note: "venomous" }] },
    "fits with a tier": { ...clean, slots: [{ ...clean.slots[0], fits: [{ id: ITEM, name: "Strap", tier: 2 }] }] }
  };
  for (const [label, data] of Object.entries(planted)) assert.ok(findTagLeaks([{ data }], known).length > 0, `the scan missed: ${label}`);
});

test("PLAYER COPY (pure): a tag loses its priority; a recipe slot with needs keeps NO needs, only optional and fits; a slot without needs is untouched", () => {
  assert.equal("priority" in stripForPlayer("tag", tag("blade", { priority: 9 })), false);
  const gm = needsRecipe([BLADE, { name: "old", drives: "basePower", tierFloor: 1, qty: 1 }]);
  const copy = stripForPlayer("recipe", gm, { fits: () => [{ id: "ironbar", name: "ironbar" }] });
  assert.deepEqual(copy.slots[0], { name: "blade", drives: "basePower", tierFloor: 1, qty: 1, optional: false, fits: [{ id: "ironbar", name: "ironbar" }] });
  assert.deepEqual(copy.slots[1], { name: "old", drives: "basePower", tierFloor: 1, qty: 1 });
  assert.deepEqual(findTagLeaks([{ data: copy }], { neededTags: ["blade-tag-never-in-slot"] }), []);
});
