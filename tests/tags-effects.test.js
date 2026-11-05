/** Tag effects, Slice 2a: tag effect data, validation, contributions, the craft plan and the effects engine in TAGGED slots. Pure. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { planCraft } from "../scripts/crafting/plan.js";
import { effectsOf } from "../scripts/effects/resolve.js";
import { tagContributions } from "../scripts/tags/contributions.js";
import { emptyLedger } from "../scripts/tags/ledger.js";
import { mergeCaps } from "../scripts/tags/stack.js";
import { asPage, seedRecords, UUID, UUID_2, RECIPE } from "./helpers.js";

const ITEM = "Compendium.pf2e.equipment-srd.Item.CCCCCCCCCCCCCCCC";
const ITEM2 = "Compendium.pf2e.equipment-srd.Item.DDDDDDDDDDDDDDDD";
const tag = (id, effectBlocks, extra = {}) => ({ kind: "tag", id, name: id[0].toUpperCase() + id.slice(1), theme: `${id} things`, ...(effectBlocks ? { effectBlocks } : {}), ...extra });
const mat = (id, tier, extra = {}) => ({ kind: "material", id, name: id, tier, effects: { basePower: `T${tier}` }, ...extra });
const damage = (dice, damageType = "poison", extra = {}) => ({ type: "damage", dice, damageType, ...extra });
const byTier = (a, b, c, d, e) => ({ byTier: { 1: a, 2: b, 3: c, 4: d, 5: e } });
const general = (...blocks) => ({ general: { blocks } });
const defs = (...records) => loadDefinitions([...seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), ...records.map(r => ({ pack: "t", entry: r.id, text: asPage(r) }))]);
const recipeOf = (slots, extra = {}) => ({ ...RECIPE, id: "tagged-sword", name: "Tagged Sword", category: "weapon", output: { 1: UUID, 2: UUID_2, 3: UUID, 4: UUID_2, 5: UUID }, slots, ...extra });
const BLADE = { name: "blade", drives: "basePower", qty: 1, needs: { all: ["metal"] } };
const COAT = { name: "coat", drives: ["bonusDamage", "specialAbility", "applyCondition"], qty: 1, needs: { all: ["venom"] } };
const PLAIN = { name: "grip", drives: "bonusDamage", qty: 1 };
const STATION = { id: "f", name: "F", category: RECIPE.stationCategory, tier: 1 };
const reg = (records, slots, extra) => { const have = new Set(records.map(r => r.id)); const r = defs(...["metal", "venom"].filter(id => !have.has(id)).map(id => tag(id)), ...records, recipeOf(slots, extra)); assert.deepEqual(r.errors.map(e => `${e.entry} ${e.field} ${e.message}`), []); return r.registry; };
const stacks = (...ids) => ids.map((id, i) => ({ stackId: `s${i}`, materialId: id, quantity: 5 }));
const craft = (registry, selection, ledger = emptyLedger(), caps = mergeCaps(null)) => {
  const r = planCraft({ recipe: registry.recipe.get("tagged-sword"), registry, selection, stacks: stacks(...Object.values(selection)), outputs: { 1: UUID }, station: STATION, ledger, caps });
  assert.ok(r.ok, r.errors?.join(" | "));
  return r.plan;
};
const VENOM_D4 = tag("venom", general(damage({ all: "1d4" })));
const ironbar = mat("ironbar", 1, { tag: "metal" });
const ledgerOf = items => ({ v: 1, items });

// Validation ----------------------------------------------------------------------------------------------------------------
test("TAG DATA: a tag's effects use the same blocks as a material, and load clean", () => {
  const r = defs(tag("venom", { general: { power: 2, blocks: [damage(byTier("1d4", "1d4", "1d6", "1d6", "1d8"), "poison", { bonusType: "item" })] }, byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: { all: 1 }, save: "will" }] } } }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.registry.tag.get("venom").effectBlocks.general.blocks[0].bonusType, "item");
});
test("TAG DATA: every tier T1 to T5 must make a valid value (a table with a hole is refused)", () => {
  const holey = defs(tag("venom", general(damage({ byTier: { 1: "1d4", 2: "1d4" } }))));
  assert.ok(holey.errors.some(e => /needs an entry for each of T1 to T5/.test(e.message)), JSON.stringify(holey.errors));
  const big = defs(tag("venom", { byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: byTier(1, 2, 3, 4, 9), save: "will" }] } } }));
  assert.ok(big.errors.length > 0);
});
test("TAG DATA: Apply a condition belongs to a weapon, bomb or consumable, not to 'any item'", () => {
  const r = defs(tag("venom", general({ type: "condition", condition: "frightened", value: { all: 1 }, save: "will" })));
  assert.ok(r.errors.some(e => /belongs to a weapon, bomb or consumable/.test(e.message)), JSON.stringify(r.errors));
});
test("TAG DATA: an unknown item class and a role the class does not have are refused; a bad bonus type is refused", () => {
  assert.ok(defs(tag("venom", { byClass: { sword: { blocks: [damage({ all: "1d4" })] } } })).errors.some(e => /not an item class/.test(e.message)));
  assert.ok(defs(tag("venom", { byClass: { armor: { blocks: [damage({ all: "1d4" })] } } })).errors.some(e => /does not apply to armor/.test(e.message)));
  assert.ok(defs(tag("venom", general(damage({ all: "1d4" }, "poison", { bonusType: "magic" })))).errors.length > 0);
});
test("TAG DATA: tags may NOT add effects beyond the curated conditions (an unknown condition is refused)", () => {
  assert.ok(defs(tag("venom", { byClass: { weapon: { blocks: [{ type: "condition", condition: "doomed", value: { all: 1 }, save: "will" }] } } })).errors.length > 0);
});

// Contributions ---------------------------------------------------------------------------------------------------------------
test("CONTRIBUTIONS: an ingredient brings its tags' effects at ITS OWN tier (the ledger tier for an ordinary item)", () => {
  const registry = reg([tag("venom", general(damage(byTier("1d4", "1d6", "1d8", "1d10", "1d12")))), ironbar], [BLADE, COAT]);
  const ledger = ledgerOf({ [ITEM]: { tags: ["venom"], tier: 4, name: "Wolf Tooth" } });
  const c = tagContributions({ recipe: registry.recipe.get("tagged-sword"), slot: COAT, ref: ITEM, registry, ledger });
  assert.deepEqual(c.map(x => [x.role, x.value.dice, x.from.tier]), [["bonusDamage", "1d10", 4]]);
});
test("CONTRIBUTIONS: only the roles the SLOT drives count", () => {
  const registry = reg([tag("venom", general(damage({ all: "1d4" }), { type: "ability", title: "Barb", text: "t" })), ironbar], [BLADE, { ...COAT, drives: "bonusDamage" }]);
  const ledger = ledgerOf({ [ITEM]: { tags: ["venom"], tier: 1, name: "T" } });
  assert.deepEqual(tagContributions({ recipe: registry.recipe.get("tagged-sword"), slot: { ...COAT, drives: "bonusDamage" }, ref: ITEM, registry, ledger }).map(x => x.role), ["bonusDamage"]);
});
test("CONTRIBUTIONS: a slot without needs never reads a tag", () => {
  const registry = reg([VENOM_D4, ironbar], [BLADE, PLAIN]);
  assert.deepEqual(tagContributions({ recipe: registry.recipe.get("tagged-sword"), slot: PLAIN, ref: ITEM, registry, ledger: ledgerOf({ [ITEM]: { tags: ["venom"], tier: 1, name: "T" } }) }), []);
});
test("CONTRIBUTIONS: within one tag, the item class's set beats the general set per role", () => {
  const registry = reg([tag("venom", { general: { blocks: [damage({ all: "1d4" })] }, byClass: { weapon: { blocks: [damage({ all: "1d10" })] } } }), ironbar], [BLADE, COAT]);
  const ledger = ledgerOf({ [ITEM]: { tags: ["venom"], tier: 1, name: "T" } });
  assert.equal(tagContributions({ recipe: registry.recipe.get("tagged-sword"), slot: COAT, ref: ITEM, registry, ledger })[0].value.dice, "1d10");
});

// The craft plan ---------------------------------------------------------------------------------------------------------------
const L = ledgerOf({ [ITEM]: { tags: ["venom"], tier: 1, name: "Wolf Tooth" }, [ITEM2]: { tags: ["venom"], tier: 3, name: "Spider Fang" } });
const TIERED = tag("venom", general(damage(byTier("1d4", "1d4", "1d6", "1d6", "1d8"))));

test("PLAN: effects come from the tags of a tagged slot's ingredient, scaled by ITS tier", () => {
  const registry = reg([TIERED, ironbar], [BLADE, COAT]);
  const low = craft(registry, { blade: "ironbar", coat: ITEM }, L), high = craft(registry, { blade: "ironbar", coat: ITEM2 }, L);
  assert.deepEqual(low.description.damageBonuses.map(d => d.dice), ["1d4"]);
  assert.deepEqual(high.description.damageBonuses.map(d => d.dice), ["1d6"]);
});
test("PLAN: the scaling tier is the CONTRIBUTOR's, not the recipe's and not another ingredient's", () => {
  // two ingredients in two tagged slots, tiers 1 and 3, same die size at the two tiers: they add as 2d4? no: tier 1 = 1d4, tier 3 = 1d6 -> two separate entries
  const registry = reg([TIERED, ironbar], [BLADE, COAT, { ...COAT, name: "coat2" }]);
  const plan = craft(registry, { blade: "ironbar", coat: ITEM, coat2: ITEM2 }, L);
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice).sort(), ["1d4", "1d6"]);
});
test("PLAN: the same tag from two ingredients STACKS (1d4 + 1d4 = 2d4), and the label names both", () => {
  const registry = reg([VENOM_D4, ironbar], [BLADE, COAT, { ...COAT, name: "coat2" }]);
  const plan = craft(registry, { blade: "ironbar", coat: ITEM, coat2: ITEM2 }, L);
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice), ["2d4"]);
  assert.match(plan.description.damageBonuses[0].label, /Wolf Tooth \+ Spider Fang/);
});
test("PLAN: quantity is a COST, not a multiplier (a slot that takes 3 units still contributes once)", () => {
  const registry = reg([VENOM_D4, ironbar], [BLADE, { ...COAT, qty: 3 }]);
  assert.deepEqual(craft(registry, { blade: "ironbar", coat: ITEM }, L).description.damageBonuses.map(d => d.dice), ["1d4"]);
});
test("PLAN: the ingredient's OWN material effects ALSO apply and stack with its tags' (1d4 own + 1d4 tag = 2d4)", () => {
  const fang = mat("fang", 1, { tag: "venom", effects: { bonusDamage: { dice: "1d4", type: "poison" } } });
  const registry = reg([VENOM_D4, ironbar, fang], [BLADE, COAT]);
  assert.deepEqual(craft(registry, { blade: "ironbar", coat: "fang" }).description.damageBonuses.map(d => d.dice), ["2d4"]);
});
test("PLAN: OLD slots ignore tags: a tagged material in an untagged slot adds only its own effects", () => {
  const fang = mat("fang", 1, { tag: "venom", effects: { bonusDamage: { dice: "1d4", type: "poison" } } });
  const registry = reg([VENOM_D4, ironbar, fang], [BLADE, PLAIN]);
  const plan = craft(registry, { blade: "ironbar", grip: "fang" });
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice), ["1d4"], "no tag damage was added");
  assert.deepEqual(plan.capNotes, []);
});
test("PLAN: untagged slots are not merged with tagged ones (old behaviour: one entry per material)", () => {
  const fang = mat("fang", 1, { tag: "venom", effects: { bonusDamage: { dice: "1d4", type: "poison" } } });
  const registry = reg([VENOM_D4, ironbar, fang], [BLADE, COAT, PLAIN]);
  const plan = craft(registry, { blade: "ironbar", coat: ITEM, grip: "fang" }, L);
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice).sort(), ["1d4", "1d4"], "the tagged slot's tag 1d4 and the untagged slot's own 1d4 stay two entries");
});
test("PLAN: the five roles: power (highest), damage, ability, conditions come out of the stack (weapon)", () => {
  const venom = tag("venom", { general: { blocks: [damage({ all: "1d6" }), { type: "ability", title: "Barb", text: "Sharp." }] }, byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: { all: 2 }, save: "will" }] } } });
  const metal = tag("metal", { general: { power: 3, blocks: [] } });
  const registry = reg([venom, metal, ironbar], [BLADE, COAT]);
  const plan = craft(registry, { blade: "ironbar", coat: ITEM }, L);
  assert.equal(plan.baseTier, 3, "the tag's power tier beats the iron's T1");
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice), ["1d6"]);
  assert.deepEqual(plan.description.abilities.map(a => a.title), ["Barb"]);
  assert.deepEqual(plan.description.conditions.map(c => c.plain), ["makes the target fearful"]);
  assert.ok(!JSON.stringify(plan.description.conditions).includes("will"), "no save in the description");
});
test("PLAN: resistance stacks too (a consumable)", () => {
  const venom = tag("venom", general({ type: "resistance", damageType: "fire", value: { all: 4 } }));
  const registry = reg([venom, ironbar], [{ name: "base", drives: "basePower", qty: 1 }, { name: "vial", drives: "resistance", qty: 1, needs: { all: ["venom"] } }, { name: "herb", drives: "resistance", qty: 1, needs: { all: ["venom"] } }], { category: "consumable" });
  const r = planCraft({ recipe: registry.recipe.get("tagged-sword"), registry, selection: { base: "ironbar", vial: ITEM, herb: ITEM2 }, stacks: stacks("ironbar", ITEM, ITEM2), outputs: { 1: UUID }, station: STATION, ledger: L, caps: mergeCaps(null) });
  assert.ok(r.ok, r.errors?.join(" | "));
  assert.deepEqual(r.plan.description.resistances.map(x => `${x.type} ${x.value}`), ["fire 8"]);
});
test("PLAN: the GM's cap clamps and the plan says so (GM-only notes); a cap that is not reached says nothing", () => {
  const registry = reg([tag("venom", general(damage({ all: "3d6" }))), ironbar], [BLADE, COAT, { ...COAT, name: "coat2" }]);
  const capped = craft(registry, { blade: "ironbar", coat: ITEM, coat2: ITEM2 }, L, mergeCaps({ v: 1, roles: { bonusDamage: { maxDicePerType: 4 } } }));
  assert.deepEqual(capped.description.damageBonuses.map(d => d.dice), ["4d6"]);
  assert.deepEqual(capped.capNotes, ["capped bonusDamage (poison): 6 dice became 4"]);
  const loose = craft(registry, { blade: "ironbar", coat: ITEM, coat2: ITEM2 }, L, mergeCaps({ v: 1, roles: { bonusDamage: { maxDicePerType: 9 } } }));
  assert.deepEqual(loose.description.damageBonuses.map(d => d.dice), ["6d6"]); assert.deepEqual(loose.capNotes, []);
});
test("PLAN: a cap on one role does not clamp another (power cap vs damage)", () => {
  const registry = reg([tag("venom", general(damage({ all: "6d6" }))), tag("metal", { general: { power: 5, blocks: [] } }), ironbar], [BLADE, COAT]);
  const plan = craft(registry, { blade: "ironbar", coat: ITEM }, ledgerOf({ [ITEM]: { tags: ["venom", "metal"], tier: 1, name: "T" } }), mergeCaps({ v: 1, roles: { basePower: { maxTier: 2 }, bonusDamage: { maxDicePerType: 9 } } }));
  assert.equal(plan.baseTier, 2); assert.deepEqual(plan.description.damageBonuses.map(d => d.dice), ["6d6"]);
});
test("PLAN: a recipe with no tagged slot is exactly as before (no cap notes, no merging, one entry per material)", () => {
  const fang = mat("fang", 1, { effects: { bonusDamage: { dice: "1d4", type: "poison" } } });
  const registry = reg([ironbar, fang], [{ name: "blade", drives: "basePower", qty: 1 }, PLAIN, { ...PLAIN, name: "grip2" }]);
  const plan = craft(registry, { blade: "ironbar", grip: "fang", grip2: "fang" });
  assert.deepEqual(plan.capNotes, []);
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice), ["1d4", "1d4"], "two entries, not 2d4: old slots never merge");
});

// The effects engine ---------------------------------------------------------------------------------------------------------
test("ENGINE: a crafted item's conditions in tagged slots come from the same stack (the higher value of a repeated condition wins)", () => {
  const venom = tag("venom", { byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: byTier(1, 1, 2, 3, 4), save: "will" }] } } });
  const registry = reg([venom, ironbar], [BLADE, COAT, { ...COAT, name: "coat2" }]);
  const plan = craft(registry, { blade: "ironbar", coat: ITEM, coat2: ITEM2 }, L);
  const { effects } = effectsOf({ recipeId: "tagged-sword", materials: plan.provenance.materials }, registry, { ledger: L, caps: mergeCaps(null) });
  assert.deepEqual(effects.map(e => [e.condition, e.value, e.save]), [["frightened", 2, "will"]], "tier 1 gives value 1, tier 3 gives value 2: the higher stays");
});
test("ENGINE: a tagged slot's conditions are not counted twice (once per material and once from the stack)", () => {
  const fang = mat("fang", 1, { tag: "venom", effects: { applyCondition: [{ condition: "sickened", value: 1, save: "fortitude" }] } });
  const registry = reg([tag("venom"), ironbar, fang], [BLADE, COAT]);
  const { effects } = effectsOf({ recipeId: "tagged-sword", materials: [{ slot: "blade", materialId: "ironbar", units: 1 }, { slot: "coat", materialId: "fang", units: 1 }] }, registry, { ledger: emptyLedger(), caps: mergeCaps(null) });
  assert.equal(effects.length, 1);
});
test("ENGINE: old recipes (no tagged slot) resolve exactly as before", () => {
  const fang = mat("fang", 1, { effects: { applyCondition: [{ condition: "sickened", value: 1, save: "fortitude" }] } });
  const registry = reg([ironbar, fang], [{ name: "blade", drives: "basePower", qty: 1 }, { name: "coat", drives: "applyCondition", qty: 1 }]);
  const { effects } = effectsOf({ recipeId: "tagged-sword", materials: [{ slot: "blade", materialId: "ironbar", units: 1 }, { slot: "coat", materialId: "fang", units: 1 }] }, registry);
  assert.deepEqual(effects.map(e => [e.materialId, e.slot, e.condition]), [["fang", "coat", "sickened"]]);
});
