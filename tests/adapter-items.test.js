import test from "node:test";
import assert from "node:assert/strict";
import {
  DAMAGE_TYPES, DEGREES, ITEM_DAMAGE_SELECTOR, buildCraftedItemData, buildDescriptionHtml, buildRuleElements,
  expectedItemType, normalizeDegree, setPath
} from "../scripts/adapter/pf2e.js";

const FANG_DESCRIPTION = {
  damageBonuses: [{ dice: "1d4", type: "poison", label: "Spider Fang" }],
  abilities: [{ title: "Spider Venom", text: "Fortitude DC 18 or sickened 1.", on: "hit" }],
  resistances: [], fields: [], spellSlots: 0
};

test("normalizeDegree maps PF2e's 0 to 3 and accepts names", () => {
  assert.deepEqual([0, 1, 2, 3].map(normalizeDegree), ["criticalFailure", "failure", "success", "criticalSuccess"]);
  for (const name of DEGREES) assert.equal(normalizeDegree(name), name);
  for (const bad of [4, -1, 1.5, "win", null, undefined]) assert.equal(normalizeDegree(bad), null, String(bad));
});

test("damage types include the Remaster set the seeds use", () => {
  for (const type of ["poison", "spirit", "vitality", "void", "fire", "piercing"]) assert.ok(DAMAGE_TYPES.includes(type), type);
});

test("bonusDamage becomes a DamageDice rule scoped to this item's own damage", () => {
  const [rule] = buildRuleElements({ damageBonuses: [{ dice: "2d6", type: "fire", label: "Ember" }] });
  assert.deepEqual(rule, { key: "DamageDice", selector: ITEM_DAMAGE_SELECTOR, diceNumber: 2, dieSize: "d6", damageType: "fire", label: "Ember" });
});

test("persistent and versus become category and predicate", () => {
  const [rule] = buildRuleElements({ damageBonuses: [{ dice: "1d4", type: "spirit", persistent: true, versus: "fiend", label: "Silver" }] });
  assert.equal(rule.category, "persistent");
  assert.deepEqual(rule.predicate, ["target:trait:fiend"]);
});

test("rules for non-persistent, non-versus bonuses carry neither field", () => {
  const [rule] = buildRuleElements(FANG_DESCRIPTION);
  assert.ok(!("category" in rule) && !("predicate" in rule));
});

test("specialAbility becomes a Note on the same selector; outcome depends on `on`", () => {
  const [, note] = buildRuleElements(FANG_DESCRIPTION);
  assert.deepEqual(note, {
    key: "Note", selector: ITEM_DAMAGE_SELECTOR, title: "Spider Venom",
    text: "Fortitude DC 18 or sickened 1.", outcome: ["success", "criticalSuccess"]
  });
  const [crit] = buildRuleElements({ abilities: [{ title: "T", text: "x", on: "criticalHit" }] });
  assert.deepEqual(crit.outcome, ["criticalSuccess"]);
});

test("resistance becomes a Resistance rule", () => {
  assert.deepEqual(buildRuleElements({ resistances: [{ type: "fire", value: 5 }] }), [{ key: "Resistance", type: "fire", value: 5 }]);
});

test("an empty description yields no rules and no description text", () => {
  assert.deepEqual(buildRuleElements({}), []);
  assert.equal(buildDescriptionHtml({}), "");
});

test("the description lists every property and escapes titles", () => {
  const html = buildDescriptionHtml({ ...FANG_DESCRIPTION, abilities: [{ title: "<b>Hax</b>", text: "ok", on: "hit" }], spellSlots: 2,
    resistances: [{ type: "fire", value: 5 }] });
  assert.match(html, /\+1d4 poison/);
  assert.match(html, /&lt;b&gt;Hax&lt;\/b&gt;/);
  assert.match(html, /Resistance fire 5/);
  assert.match(html, /Spell slots: \+2/);
});

// setPath -----------------------------------------------------------------------
test("setPath writes nested system fields, creating the path", () => {
  const target = { system: {} };
  setPath(target, "system.bulk.value", 2);
  assert.deepEqual(target, { system: { bulk: { value: 2 } } });
});

test("setPath refuses rules, non-system paths and prototype pollution", () => {
  for (const bad of ["system.rules", "system.rules.0", "name", "flags.x", "system.__proto__.polluted", "system.constructor.x", "system..x", "system"]) {
    assert.throws(() => setPath({ system: {} }, bad, 1), /refusing to write/, bad);
  }
  assert.equal({}.polluted, undefined);
});

// buildCraftedItemData ----------------------------------------------------------
const BASE = {
  _id: "abc", name: "Dagger", type: "weapon", folder: "f1", ownership: { default: 3 },
  system: { quantity: 3, rules: [{ key: "ExistingRule" }], description: { value: "<p>A knife.</p>" } },
  flags: { pf2e: { x: 1 } }
};
const PROVENANCE = { recipeId: "dagger-spider-fang", materials: [{ slot: "fang", materialId: "spider-fang", units: 1 }], crafter: "actor1", degree: "success" };

test("a crafted item keeps the base data, appends rules, and records provenance", () => {
  const data = buildCraftedItemData(BASE, FANG_DESCRIPTION, PROVENANCE);
  assert.equal(data._id, undefined);
  assert.equal(data.folder, undefined);
  assert.equal(data.ownership, undefined);
  assert.equal(data.name, "Dagger");
  assert.equal(data.system.quantity, 1);
  assert.deepEqual(data.system.rules.map(r => r.key), ["ExistingRule", "DamageDice", "Note"]);
  assert.match(data.system.description.value, /^<p>A knife\.<\/p><hr>/);
  assert.deepEqual(data.flags.pf2e, { x: 1 });
  assert.deepEqual(data.flags["pathfinder-progress"].crafted, PROVENANCE);
});

test("building a crafted item never mutates the base data", () => {
  const before = JSON.stringify(BASE);
  buildCraftedItemData(BASE, FANG_DESCRIPTION, PROVENANCE, { name: "Spider Fang Dagger" });
  assert.equal(JSON.stringify(BASE), before);
});

test("an explicit name overrides the base name", () => {
  assert.equal(buildCraftedItemData(BASE, FANG_DESCRIPTION, PROVENANCE, { name: "Spider Fang Dagger" }).name, "Spider Fang Dagger");
});

test("custom-role fields are applied to the item data", () => {
  const data = buildCraftedItemData(BASE, { fields: [{ path: "system.bulk.value", value: 2 }] }, PROVENANCE);
  assert.equal(data.system.bulk.value, 2);
});

test("a base item with no rules or description still works", () => {
  const data = buildCraftedItemData({ name: "Bare", type: "weapon" }, FANG_DESCRIPTION, PROVENANCE);
  assert.equal(data.system.rules.length, 2);
  assert.match(data.system.description.value, /Crafted properties/);
});

test("expectedItemType maps recipe categories to PF2e item types", () => {
  assert.equal(expectedItemType("weapon"), "weapon");
  assert.equal(expectedItemType("armor"), "armor");
  assert.equal(expectedItemType("robes"), "armor");
  assert.equal(expectedItemType("focus"), null);
});
