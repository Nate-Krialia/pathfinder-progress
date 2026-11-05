/** Tag system, Slice 2b (docs/22): slot kinds, per-recipe tag overrides, and the clamp order. Pure. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { planCraft } from "../scripts/crafting/plan.js";
import { slotKind, tagContributions, tagRoles } from "../scripts/tags/contributions.js";
import { emptyLedger } from "../scripts/tags/ledger.js";
import { mergeCaps, stackContributions } from "../scripts/tags/stack.js";
import { asPage, seedRecords, UUID, UUID_2, RECIPE } from "./helpers.js";

const ITEM = "Compendium.pf2e.equipment-srd.Item.CCCCCCCCCCCCCCCC";
const tag = (id, effectBlocks, extra = {}) => ({ kind: "tag", id, name: id[0].toUpperCase() + id.slice(1), theme: `${id} things`, ...(effectBlocks ? { effectBlocks } : {}), ...extra });
const mat = (id, tier, extra = {}) => ({ kind: "material", id, name: id, tier, effects: { basePower: `T${tier}` }, ...extra });
const dmg = (dice, damageType = "poison") => ({ type: "damage", dice: { all: dice }, damageType });
const abil = (title) => ({ type: "ability", title, text: `${title} text` });
const defs = (...records) => loadDefinitions([...seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), ...records.map(r => ({ pack: "t", entry: r.id, text: asPage(r) }))]);
const recipeOf = (slots, extra = {}) => ({ ...RECIPE, id: "tagged-sword", name: "Tagged Sword", category: "weapon", output: { 1: UUID, 2: UUID_2, 3: UUID, 4: UUID_2, 5: UUID }, slots, ...extra });
const BLADE = { name: "blade", drives: "basePower", qty: 1, needs: { all: ["metal"] } };
const COAT = { name: "coat", drives: ["bonusDamage", "specialAbility"], qty: 1, needs: { all: ["venom"] } };
const STATION = { id: "f", name: "F", category: RECIPE.stationCategory, tier: 1 };
const ironbar = mat("ironbar", 1, { tag: "metal" });
const ledgerOf = items => ({ v: 1, items });
const L = ledgerOf({ [ITEM]: { tags: ["venom"], tier: 2, name: "Wolf Tooth" } });
const reg = (records, slots, extra) => { const have = new Set(records.map(r => r.id)); const r = defs(...["metal", "venom"].filter(id => !have.has(id)).map(id => tag(id)), ...records, recipeOf(slots, extra)); assert.deepEqual(r.errors.map(e => `${e.entry} ${e.field} ${e.message}`), []); return r.registry; };
const craft = (registry, selection, caps = mergeCaps(null)) => {
  const r = planCraft({ recipe: registry.recipe.get("tagged-sword"), registry, selection, stacks: Object.values(selection).map((id, i) => ({ stackId: `s${i}`, materialId: id, quantity: 5 })), outputs: { 1: UUID }, station: STATION, ledger: L, caps });
  assert.ok(r.ok, r.errors?.join(" | "));
  return r.plan;
};

// Slot kind ------------------------------------------------------------------------------------------------------------------
test("KIND: a slot's kind is its own name unless it says otherwise; the schema accepts a lowercase key and refuses anything else", () => {
  assert.equal(slotKind({ name: "blade" }), "blade"); assert.equal(slotKind({ name: "edge", kind: "blade" }), "blade");
  assert.deepEqual(defs(tag("metal"), tag("venom"), recipeOf([BLADE, { ...COAT, kind: "decoration" }])).errors, []);
  assert.ok(defs(tag("metal"), tag("venom"), recipeOf([BLADE, { ...COAT, kind: "Decoration!" }])).errors.length > 0);
});
test("KIND: the SAME tag does different things in different slot kinds of one recipe", () => {
  const venom = tag("venom", { general: { blocks: [dmg("1d4")] }, bySlot: { blade: { general: { blocks: [dmg("1d8")] } }, decoration: { general: { blocks: [abil("Gleam")] } } } });
  const registry = reg([venom, ironbar], [BLADE, { ...COAT, name: "edge", kind: "blade" }, { ...COAT, name: "trim", kind: "decoration" }]);
  const recipe = registry.recipe.get("tagged-sword");
  const dice = slot => tagContributions({ recipe, slot, ref: ITEM, registry, ledger: L }).map(c => [c.role, c.value.dice ?? c.value.title]);
  assert.deepEqual(dice(recipe.slots[1]), [["bonusDamage", "1d8"]], "in a blade slot: 1d8 (the slot's own set beats the general 1d4)");
  assert.deepEqual(dice(recipe.slots[2]), [["bonusDamage", "1d4"], ["specialAbility", "Gleam"]], "in a decoration slot: the general damage stays, the decoration's ability is added");
});
test("KIND: with no kind written, the slot's NAME is its kind", () => {
  const venom = tag("venom", { bySlot: { coat: { general: { blocks: [dmg("1d10")] } } } });
  const registry = reg([venom, ironbar], [BLADE, COAT]);
  assert.equal(tagContributions({ recipe: registry.recipe.get("tagged-sword"), slot: COAT, ref: ITEM, registry, ledger: L })[0].value.dice, "1d10");
});
test("LAYERS: slot+class beats slot beats class beats any, ONE WINNER PER ROLE", () => {
  const venom = tag("venom", { general: { blocks: [dmg("1d4"), abil("General")] }, byClass: { weapon: { blocks: [dmg("1d6")] } }, bySlot: { coat: { general: { blocks: [dmg("1d8")] }, byClass: { weapon: { blocks: [dmg("1d10")] } } } } });
  const recipe = { category: "weapon", tagOverrides: [] };
  const roles = kind => tagRoles({ tag: defs(venom).registry.tag.get("venom"), recipe, kind, tier: 1 });
  assert.equal(roles("coat").bonusDamage.dice, "1d10", "slot+class");
  assert.equal(roles("other").bonusDamage.dice, "1d6", "class beats any");
  assert.equal(roles("other").specialAbility.title, "General", "a role only the general set has falls through");
  assert.equal(roles("coat").specialAbility.title, "General", "and so does it for the slot kind");
  const noClass = tag("venom", { general: { blocks: [dmg("1d4")] }, bySlot: { coat: { general: { blocks: [dmg("1d8")] } } } });
  assert.equal(tagRoles({ tag: defs(noClass).registry.tag.get("venom"), recipe, kind: "coat", tier: 1 }).bonusDamage.dice, "1d8", "slot beats any when there is no slot+class set");
});
test("TAG DATA: a slot kind's sets are validated like any other (bad class and bad blocks are refused, every tier)", () => {
  assert.deepEqual(defs(tag("venom", { bySlot: { blade: { general: { blocks: [dmg("1d4")] }, byClass: { weapon: { blocks: [abil("A")] } } } } })).errors, []);
  assert.ok(defs(tag("venom", { bySlot: { blade: { byClass: { sword: { blocks: [dmg("1d4")] } } } } })).errors.some(e => /not an item class/.test(e.message)));
  assert.ok(defs(tag("venom", { bySlot: { blade: { byClass: { armor: { blocks: [dmg("1d4")] } } } } })).errors.some(e => /does not apply to armor/.test(e.message)));
  assert.ok(defs(tag("venom", { bySlot: { blade: { general: { blocks: [{ type: "condition", condition: "frightened", value: { all: 1 }, save: "will" }] } } } })).errors.some(e => /belongs to a weapon, bomb or consumable/.test(e.message)));
});

// Recipe overrides -----------------------------------------------------------------------------------------------------------
const OVERRIDE = (extra = {}) => ({ tag: "venom", slot: "coat", blocks: [dmg("2d6")], ...extra });
test("OVERRIDE: the recipe's override beats the tag's own sets for that slot, per role (a role it does not name falls through)", () => {
  const venom = tag("venom", { general: { blocks: [dmg("1d4"), abil("Barb")] } });
  const registry = reg([venom, ironbar], [BLADE, COAT], { tagOverrides: [OVERRIDE()] });
  const plan = craft(registry, { blade: "ironbar", coat: ITEM });
  assert.deepEqual(plan.description.damageBonuses.map(d => d.dice), ["2d6"], "the override's 2d6, not the tag's 1d4");
  assert.deepEqual(plan.description.abilities.map(a => a.title), ["Barb"], "the tag's ability still applies: the override named only damage");
});
test("OVERRIDE: it applies to its own tag and slot kind only", () => {
  const venom = tag("venom", { general: { blocks: [dmg("1d4")] } }), edge = tag("edge", { general: { blocks: [dmg("1d6", "fire")] } });
  const slots = [BLADE, COAT, { ...COAT, name: "trim", needs: { all: ["edge"] } }];
  const registry = reg([venom, edge, ironbar], slots, { tagOverrides: [OVERRIDE()] });
  const both = ledgerOf({ [ITEM]: { tags: ["venom", "edge"], tier: 1, name: "T" } });
  const recipe = registry.recipe.get("tagged-sword");
  const dice = (slot) => tagContributions({ recipe, slot, ref: ITEM, registry, ledger: both }).map(c => `${c.from.tagId}:${c.value.dice}`);
  assert.deepEqual(dice(recipe.slots[1]), ["venom:2d6", "edge:1d6"], "the override replaced venom's damage in coat; edge (another tag) is untouched");
  assert.deepEqual(dice(recipe.slots[2]), ["venom:1d4", "edge:1d6"], "another slot kind and another tag are untouched (venom is only overridden in coat)");
});
test("OVERRIDE: it scales by the contributor's tier like any set (byTier)", () => {
  const registry = reg([tag("venom"), ironbar], [BLADE, COAT], { tagOverrides: [{ tag: "venom", slot: "coat", blocks: [{ type: "damage", dice: { byTier: { 1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10", 5: "1d12" } }, damageType: "poison" }] }] });
  assert.deepEqual(craft(registry, { blade: "ironbar", coat: ITEM }).description.damageBonuses.map(d => d.dice), ["1d6"], "the tooth is tier 2");
});
test("OVERRIDE: it works even when the tag has no effects of its own", () => {
  const registry = reg([tag("venom"), ironbar], [BLADE, COAT], { tagOverrides: [OVERRIDE()] });
  assert.deepEqual(craft(registry, { blade: "ironbar", coat: ITEM }).description.damageBonuses.map(d => d.dice), ["2d6"]);
});
test("OVERRIDE VALIDATION: the tag must exist, the slot kind must exist in the recipe, a pair once, and every tier must make a valid value", () => {
  const msgs = extra => defs(tag("metal"), tag("venom"), recipeOf([BLADE, COAT], { tagOverrides: extra })).errors.map(e => e.message).join(" | ");
  assert.equal(msgs([OVERRIDE()]), "");
  assert.match(msgs([OVERRIDE({ tag: "ghost" })]), /unknown tag "ghost"/);
  assert.match(msgs([OVERRIDE({ slot: "nowhere" })]), /"nowhere" is not a slot kind of this recipe \(kinds: blade, coat\)/);
  assert.match(msgs([OVERRIDE(), OVERRIDE()]), /overrides venom in "coat" twice/);
  assert.match(msgs([OVERRIDE({ blocks: [{ type: "condition", condition: "frightened", save: "will" }] })]), /needs a value/);
  assert.match(msgs([OVERRIDE({ blocks: [{ type: "damage", dice: { byTier: { 1: "1d4" } }, damageType: "fire" }] })]), /needs an entry for each of T1 to T5/);
  assert.equal(defs(tag("metal"), tag("venom"), recipeOf([BLADE, { ...COAT, kind: "decoration" }], { tagOverrides: [OVERRIDE({ slot: "decoration" })] })).errors.length, 0, "a slot's KIND is what an override names");
});

// Clamp order ---------------------------------------------------------------------------------------------------------------
const from = (tagName, tier, priority = 0) => ({ name: tagName, tagName, tier, priority });
const A = (title, f) => ({ role: "specialAbility", value: { title, text: "t" }, from: f });
const C = (condition, f) => ({ role: "applyCondition", value: [{ condition, value: 1, save: "will" }], from: f });
test("CLAMP ORDER (abilities): the HIGHEST tier is kept first, then the higher tag priority, then alphabetical", () => {
  const keep = (list, n = 1) => stackContributions(list, { specialAbility: { maxCount: n } }).roles.specialAbility.map(a => a.title);
  assert.deepEqual(keep([A("Low", from("A", 1)), A("High", from("Z", 3))]), ["High"], "tier 3 beats tier 1 whatever the slot order and the alphabet");
  assert.deepEqual(keep([A("First", from("A", 2, 0)), A("Second", from("B", 2, 5))]), ["Second"], "same tier: the higher priority");
  assert.deepEqual(keep([A("Zed", from("Zed", 2, 1)), A("Alpha", from("Alpha", 2, 1))]), ["Alpha"], "same tier and priority: alphabetical");
  assert.deepEqual(keep([A("Zed", from("Zed", 1)), A("Alpha", from("Alpha", 3)), A("Mid", from("Mid", 2))], 2), ["Alpha", "Mid"]);
});
test("CLAMP ORDER (conditions): the same rules, by the contributor that gave the condition", () => {
  const keep = (list, n = 1) => stackContributions(list, { applyCondition: { maxCount: n } }).roles.applyCondition.map(c => c.condition);
  assert.deepEqual(keep([C("sickened", from("A", 1)), C("frightened", from("Z", 3))]), ["frightened"], "tier beats slot order and the alphabet");
  assert.deepEqual(keep([C("sickened", from("A", 2, 0)), C("clumsy", from("B", 2, 4))]), ["clumsy"]);
  assert.deepEqual(keep([C("sickened", from("Zed", 2)), C("clumsy", from("Alpha", 2))]), ["clumsy"]);
  // a repeated condition is ranked by the contributor that WON it (the higher value), not by the first one to mention it
  const win = [{ role: "applyCondition", value: [{ condition: "frightened", value: 1, save: "will" }], from: from("A", 3) }, C("sickened", from("B", 2)), { role: "applyCondition", value: [{ condition: "frightened", value: 3, save: "will" }], from: from("C", 1) }];
  assert.deepEqual(keep(win), ["sickened"], "frightened's value came from a tier-1 contributor, so the tier-2 sickened is kept");
});
test("CLAMP ORDER: no cap, no reordering of what is kept is needed; and the DICE rule is unchanged (the biggest die is kept first)", () => {
  assert.equal(stackContributions([A("A", from("Z", 1)), A("B", from("A", 3))], {}).roles.specialAbility.length, 2);
  const r = stackContributions([{ role: "bonusDamage", value: { dice: "3d4", type: "fire" }, from: from("A", 5) }, { role: "bonusDamage", value: { dice: "3d10", type: "fire" }, from: from("B", 1) }], { bonusDamage: { maxDicePerType: 3 } });
  assert.deepEqual(r.roles.bonusDamage.map(e => e.dice), ["3d10"], "a d10 beats a d4 whatever the tier of its contributor");
});
