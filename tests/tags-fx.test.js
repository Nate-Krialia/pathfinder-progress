/** The tag effect builder's pure edits (Slice 2a). */
import test from "node:test";
import assert from "node:assert/strict";
import { CLASSES, fxEdit, fxEmpty, fxPreview, fxProblems, fxSet } from "../scripts/tags/fx.js";

test("FX: add a damage block with sensible defaults; remove it; an emptied set is not stored", () => {
  let d = fxEdit.addBlock({}, "general", "damage");
  assert.deepEqual(d.general.blocks[0], { type: "damage", dice: { all: "1d6" }, damageType: "fire" });
  assert.equal(fxEmpty(d), false);
  d = fxEdit.removeBlock(d, "general", 0);
  assert.equal(fxEmpty(d), true); assert.deepEqual(d, {});
});
test("FX: a class set is stored under byClass and removed when empty", () => {
  let d = fxEdit.addBlock({}, "weapon", "ability");
  assert.ok(d.byClass.weapon); assert.equal(fxSet(d, "weapon").blocks.length, 1);
  d = fxEdit.removeBlock(d, "weapon", 0);
  assert.deepEqual(d, {});
});
test("FX: power, plain fields, a checkbox and a cleared field", () => {
  let d = fxEdit.addBlock({}, "general", "damage");
  d = fxEdit.setPower(d, "general", "3"); assert.equal(d.general.power, 3);
  d = fxEdit.setPower(d, "general", ""); assert.equal(d.general.power, undefined);
  d = fxEdit.setField(d, "general", 0, "damageType", "cold"); assert.equal(d.general.blocks[0].damageType, "cold");
  d = fxEdit.setField(d, "general", 0, "persistent", true); assert.equal(d.general.blocks[0].persistent, true);
  d = fxEdit.setField(d, "general", 0, "persistent", false); assert.equal("persistent" in d.general.blocks[0], false);
  d = fxEdit.setField(d, "general", 0, "bonusType", "item"); assert.equal(d.general.blocks[0].bonusType, "item");
  d = fxEdit.setField(d, "general", 0, "bonusType", ""); assert.equal("bonusType" in d.general.blocks[0], false);
});
test("FX: a tier-dependent field is one value for every tier, or a T1 to T5 table that keeps what was there", () => {
  let d = fxEdit.addBlock({}, "general", "damage");
  d = fxEdit.setTierValue(d, "general", 0, "dice", "all", "2d6"); assert.deepEqual(d.general.blocks[0].dice, { all: "2d6" });
  d = fxEdit.setTierMode(d, "general", 0, "dice", "table");
  assert.deepEqual(d.general.blocks[0].dice, { byTier: { 1: "2d6", 2: "2d6", 3: "2d6", 4: "2d6", 5: "2d6" } });
  d = fxEdit.setTierValue(d, "general", 0, "dice", 3, "3d6"); assert.equal(d.general.blocks[0].dice.byTier[3], "3d6");
  d = fxEdit.setTierMode(d, "general", 0, "dice", "all"); assert.deepEqual(d.general.blocks[0].dice, { all: "2d6" }, "collapsing keeps the T1 value");
});
test("FX: choosing a valued condition gives it a value; a valueless one has none", () => {
  let d = fxEdit.addBlock({}, "weapon", "condition");
  d = fxEdit.setField(d, "weapon", 0, "condition", "prone"); assert.equal("value" in d.byClass.weapon.blocks[0], false);
  d = fxEdit.setField(d, "weapon", 0, "condition", "sickened"); assert.deepEqual(d.byClass.weapon.blocks[0].value, { all: 1 });
});
test("FX: problems are checked over all five tiers and name the class; a valid draft has none", () => {
  assert.deepEqual(fxProblems(fxEdit.addBlock({}, "weapon", "damage")), []);
  const bad = fxEdit.addBlock({}, "general", "condition");
  assert.match(fxProblems(bad)[0], /^Any item: Apply a condition belongs to a weapon, bomb or consumable/);
  let hole = fxEdit.setTierMode(fxEdit.addBlock({}, "weapon", "damage"), "weapon", 0, "dice", "table");
  hole = fxEdit.setTierValue(hole, "weapon", 0, "dice", 2, "");
  assert.match(fxProblems(hole)[0], /^weapon: Add damage needs dice/);
  const armor = fxEdit.addBlock({}, "armor", "damage");
  assert.match(fxProblems(armor)[0], /does not apply to armor/);
  assert.match(fxProblems(fxEdit.addBlock(fxEdit.addBlock({}, "weapon", "damage"), "weapon", "damage"))[0], /Only one/);
});
test("FX: the preview shows the Hub's own wording for each tier", () => {
  const d = fxEdit.setTierMode(fxEdit.addBlock({}, "weapon", "damage"), "weapon", 0, "dice", "table");
  const p = fxPreview("Venom", fxEdit.setTierValue(d, "weapon", 0, "dice", 5, "3d6"), "weapon");
  assert.equal(p.length, 5); assert.match(p[4].lines.join(" "), /3d6/); assert.match(p[0].lines.join(" "), /1d6/);
  assert.deepEqual(fxPreview("Venom", {}, "weapon")[0].lines, []);
});
test("FX: the classes offered are 'general' plus the built-in item classes", () => { assert.deepEqual(CLASSES.slice(0, 3), ["general", "weapon", "armor"]); });
