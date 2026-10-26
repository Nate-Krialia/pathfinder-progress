import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { planCraft as basePlanCraft } from "../scripts/crafting/plan.js";
import { CRAFTING } from "../scripts/config.js";
import { asPage, seedRecords, UUID, UUID_2, MATERIAL, SILVER, RECIPE } from "./helpers.js";

const seed = () => loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const build = (...records) => loadDefinitions(records.map(r => ({ pack: "t", entry: r.id, text: asPage(r) })));
const stack = (stackId, materialId, quantity) => ({ stackId, materialId, quantity });

// The seed recipes name their outputs ("Dagger"); the loader resolves them to UUIDs.
const RESOLVED = { "1": UUID, "2": UUID_2, "3": UUID };
const STATION = { id: "forge", name: "Forge", category: "smithing", tier: 1 };
const planCraft = args => basePlanCraft({ outputs: RESOLVED, station: STATION, ...args });

test("seed: a spider fang dagger plans with poison damage and the venom ability", () => {
  const registry = seed();
  const result = planCraft({
    recipe: registry.recipe.get("dagger-spider-fang"),
    registry,
    selection: { blade: "iron", fang: "spider-fang" },
    stacks: [stack("s-iron", "iron", 1), stack("s-fang", "spider-fang", 1)]
  });
  assert.ok(result.ok, result.errors?.join(" | "));
  const { plan } = result;
  assert.equal(plan.baseTier, 1);
  assert.equal(plan.outputUuid, UUID);
  assert.equal(plan.outputRef, "Dagger");
  assert.equal(plan.craftLevel, 2);
  assert.equal(plan.resultName, "Spider Fang Dagger");
  assert.equal(plan.fee, 1);
  assert.deepEqual(plan.station, STATION);
  assert.equal(plan.provenance.stationId, "forge");
  // One fang feeds BOTH roles.
  assert.equal(plan.description.damageBonuses.length, 1);
  assert.deepEqual(
    { dice: plan.description.damageBonuses[0].dice, type: plan.description.damageBonuses[0].type, label: plan.description.damageBonuses[0].label },
    { dice: "1d4", type: "poison", label: "Spider Fang" });
  assert.equal(plan.description.abilities.length, 1);
  assert.equal(plan.description.abilities[0].title, "Spider Venom");
  assert.deepEqual(plan.provenance.materials, [{ slot: "blade", materialId: "iron", units: 1 }, { slot: "fang", materialId: "spider-fang", units: 1 }]);
});

test("the blade material's tier picks the output item", () => {
  const registry = seed();
  const recipe = registry.recipe.get("dagger-spider-fang");
  const stacks = [stack("a", "silver", 1), stack("b", "spider-fang", 1)];
  const plan = planCraft({ recipe, registry, selection: { blade: "silver", fang: "spider-fang" }, stacks }).plan;
  assert.equal(plan.baseTier, 2);
  assert.equal(plan.outputUuid, UUID_2);
});

test("a recipe override can remap a material's tier, changing the output item", () => {
  const remapped = { ...RECIPE, output: { "1": UUID, "2": UUID_2 }, overrides: [{ materialId: "silver", slot: "edge", effect: "T1" }] };
  const { registry, errors } = build(MATERIAL, SILVER, remapped);
  assert.deepEqual(errors, []);
  const plan = planCraft({ recipe: registry.recipe.get("blade"), registry, selection: { edge: "silver" }, stacks: [stack("s", "silver", 1)] }).plan;
  assert.equal(plan.baseTier, 1);
  assert.equal(plan.outputUuid, UUID);
});

test("the recipe override replaces the material default in the description", () => {
  const registry = seed();
  const recipe = registry.recipe.get("longsword-basic");
  const result = planCraft({
    recipe, registry,
    selection: { blade: "iron", coating: "silver", core: "starmetal" },
    stacks: [stack("i", "iron", 2), stack("s", "silver", 1), stack("m", "starmetal", 1)]
  });
  assert.ok(result.ok, result.errors?.join(" | "));
  assert.equal(result.plan.description.damageBonuses[0].dice, "1d6"); // override, not silver's own 1d4
  assert.equal(result.plan.description.abilities[0].title, "Starforged Edge");
});

test("errors: missing, unknown and extra selections", () => {
  const registry = seed();
  const recipe = registry.recipe.get("dagger-spider-fang");
  const stacks = [stack("i", "iron", 5), stack("f", "spider-fang", 5)];
  const run = selection => planCraft({ recipe, registry, selection, stacks });
  assert.match(run({ blade: "iron" }).errors.join("|"), /slot "fang": no material selected/);
  assert.match(run({ blade: "mithral", fang: "spider-fang" }).errors.join("|"), /unknown material "mithral"/);
  assert.match(run({ blade: "iron", fang: "spider-fang", pommel: "iron" }).errors.join("|"), /"pommel" is not a slot/);
});

test("errors: a material below the tier floor is rejected", () => {
  const registry = seed();
  const recipe = registry.recipe.get("longsword-basic");
  const { errors } = planCraft({
    recipe, registry,
    selection: { blade: "iron", coating: "iron", core: "starmetal" },
    stacks: [stack("i", "iron", 5), stack("m", "starmetal", 1)]
  });
  assert.match(errors.join("|"), /slot "coating": Iron is tier 1 but the slot needs tier 2/);
});

test("errors: a material lacking an effect for a driven role is rejected", () => {
  const registry = seed();
  const recipe = registry.recipe.get("dagger-spider-fang");
  // Silver is tier 2 (meets the fang floor) but has no specialAbility.
  const { errors } = planCraft({
    recipe, registry, selection: { blade: "iron", fang: "silver" },
    stacks: [stack("i", "iron", 1), stack("s", "silver", 1)]
  });
  assert.match(errors.join("|"), /Silver has no effect for role "specialAbility"/);
});

test("errors: not enough units, and the same stack is not double-booked by two slots", () => {
  const registry = seed();
  const longsword = registry.recipe.get("longsword-basic");
  const short = planCraft({
    recipe: longsword, registry,
    selection: { blade: "iron", coating: "silver", core: "starmetal" },
    stacks: [stack("i", "iron", 1), stack("s", "silver", 1), stack("m", "starmetal", 1)]
  });
  assert.match(short.errors.join("|"), /slot "blade": needs 2 Iron but only 1 available/);

  // Two slots both want silver, but only one silver exists.
  const both = { ...RECIPE, slots: [
    { name: "edge", drives: "basePower", tierFloor: 1, qty: 1 },
    { name: "inlay", drives: "bonusDamage", tierFloor: 2, qty: 1 }
  ] };
  const { registry: r2 } = build(MATERIAL, SILVER, both);
  const clash = planCraft({ recipe: r2.recipe.get("blade"), registry: r2, selection: { edge: "silver", inlay: "silver" }, stacks: [stack("s", "silver", 1)] });
  assert.match(clash.errors.join("|"), /slot "inlay": needs 1 Silver but only 0 available/);
});

test("units are drawn across several stacks of the same material, in order", () => {
  const registry = seed();
  const recipe = registry.recipe.get("longsword-basic");
  const { plan } = planCraft({
    recipe, registry,
    selection: { blade: "iron", coating: "silver", core: "starmetal" },
    stacks: [stack("i1", "iron", 1), stack("i2", "iron", 5), stack("s", "silver", 1), stack("m", "starmetal", 1)]
  });
  assert.deepEqual(plan.uses[0].from, [{ stackId: "i1", units: 1 }, { stackId: "i2", units: 1 }]);
});

test("resistance, spellSlots and custom-role effects land in the description", () => {
  const armorMat = { kind: "material", id: "plate", name: "Plate", tier: 1, effects: { basePower: "T1", resistance: { type: "fire", value: 5 }, spellSlots: undefined, bulky: 2 } };
  delete armorMat.effects.spellSlots;
  const role = { kind: "customRole", id: "bulky", appliesTo: ["armor"], modifies: "system.bulk.value", effect: 1 };
  const recipe = { ...RECIPE, id: "mail", category: "armor", output: { "1": UUID }, slots: [
    { name: "plates", drives: ["basePower", "resistance", "bulky"], tierFloor: 1, qty: 1 }
  ] };
  const { registry, errors } = build(role, armorMat, recipe);
  assert.deepEqual(errors, []);
  const { plan } = planCraft({ recipe: registry.recipe.get("mail"), registry, selection: { plates: "plate" }, stacks: [stack("p", "plate", 1)] });
  assert.deepEqual(plan.description.resistances.map(r => [r.type, r.value]), [["fire", 5]]);
  assert.deepEqual(plan.description.fields.map(f => [f.path, f.value]), [["system.bulk.value", 2]]);
});

test("spellSlots add up across slots (recorded only; no PF2e mechanism yet)", () => {
  const gem = (id, n) => ({ kind: "material", id, name: id, tier: 1, effects: { spellPower: "T1", spellSlots: n } });
  const focus = { ...RECIPE, id: "wand", category: "focus", output: { "1": UUID }, slots: [
    { name: "core", drives: ["spellPower", "spellSlots"], tierFloor: 1, qty: 1 },
    { name: "inlay", drives: "spellSlots", tierFloor: 1, qty: 1 }
  ] };
  const inlayGem = { kind: "material", id: "ruby", name: "Ruby", tier: 1, effects: { spellSlots: 3 } };
  const { registry, errors } = build(gem("quartz", 1), inlayGem, focus);
  assert.deepEqual(errors, []);
  const { plan } = planCraft({ recipe: registry.recipe.get("wand"), registry, selection: { core: "quartz", inlay: "ruby" },
    stacks: [stack("q", "quartz", 1), stack("r", "ruby", 1)] });
  assert.equal(plan.description.spellSlots, 4);
  assert.equal(plan.baseTier, 1);
});

test("a recipe with no base role uses the default output", () => {
  const role = { kind: "customRole", id: "glow", appliesTo: ["trinket"], modifies: "system.glow", effect: 1 };
  const gem = { kind: "material", id: "opal", name: "Opal", tier: 1, effects: { glow: 3 } };
  const charm = { ...RECIPE, id: "charm", category: "trinket", output: { default: UUID_2 }, slots: [{ name: "gem", drives: "glow", tierFloor: 1, qty: 1 }] };
  const { registry, errors } = build(role, gem, charm);
  assert.deepEqual(errors, []);
  const { plan } = planCraft({ recipe: registry.recipe.get("charm"), registry, selection: { gem: "opal" }, stacks: [stack("o", "opal", 1)] });
  assert.equal(plan.outputUuid, UUID_2);
  assert.equal(plan.baseTier, null);
});

test("the fee comes from the chosen station's tier", () => {
  const registry = seed();
  const recipe = registry.recipe.get("dagger-spider-fang");
  const args = { recipe, registry, selection: { blade: "iron", fang: "spider-fang" }, stacks: [stack("i", "iron", 1), stack("f", "spider-fang", 1)] };
  assert.equal(planCraft(args).plan.fee, 1);
  assert.equal(planCraft({ ...args, station: { ...STATION, tier: 2 } }).plan.fee, 5);
  assert.equal(planCraft({ ...args, station: { ...STATION, tier: 5 } }).plan.fee, 300);
});

test("without a station the plan has no fee or station yet", () => {
  const registry = seed();
  const recipe = registry.recipe.get("dagger-spider-fang");
  const result = basePlanCraft({ recipe, registry, outputs: RESOLVED, selection: { blade: "iron", fang: "spider-fang" },
    stacks: [stack("i", "iron", 1), stack("f", "spider-fang", 1)] });
  assert.ok(result.ok);
  assert.equal(result.plan.fee, null);
  assert.equal(result.plan.station, null);
});

// Output references ---------------------------------------------------------------
test("a name that has not been resolved blocks the craft with a clear message", () => {
  const registry = seed();
  const recipe = registry.recipe.get("dagger-spider-fang");
  const result = basePlanCraft({ recipe, registry, selection: { blade: "iron", fang: "spider-fang" },
    stacks: [stack("i", "iron", 1), stack("f", "spider-fang", 1)] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("|"), /output "Dagger" has not been resolved/);
});

test("a raw UUID output needs no resolution", () => {
  const { registry } = build(MATERIAL, { ...RECIPE, id: "raw", output: { "1": UUID } });
  const result = basePlanCraft({ recipe: registry.recipe.get("raw"), registry, selection: { edge: "iron" }, stacks: [stack("i", "iron", 1)] });
  assert.ok(result.ok, result.errors?.join("|"));
  assert.equal(result.plan.outputUuid, UUID);
});

test("the resolved UUID wins over the raw reference text", () => {
  const registry = seed();
  const result = basePlanCraft({ recipe: registry.recipe.get("dagger-spider-fang"), registry, selection: { blade: "iron", fang: "spider-fang" },
    stacks: [stack("i", "iron", 1), stack("f", "spider-fang", 1)], outputs: { "1": UUID_2 } });
  assert.equal(result.plan.outputUuid, UUID_2);
});
