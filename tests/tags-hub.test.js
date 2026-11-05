/** The Hub's slot lists for tag-matched slots (Slice 1): exactly what the GM said fits, a named item with no tier or price, optional slots do not block "Queue". */
import test from "node:test";
import assert from "node:assert/strict";
import { allSlotsPicked, slotPane } from "../scripts/hub/viewmodels.js";

const ITEM = "Compendium.pf2e.equipment-srd.Item.TTTTTTTTTTTTTTTT";
const facts = {
  met: ["iron", "silver", ITEM], inventory: { iron: 2, silver: 1, [ITEM]: 3 }, open: { iron: true, silver: true, [ITEM]: true }, learned: {},
  materials: { iron: { id: "iron", name: "Iron", tier: 1, value: 3 }, silver: { id: "silver", name: "Silver", tier: 2, value: 9 }, [ITEM]: { id: ITEM, name: "Wolf Tooth", standIn: true } }
};
const recipe = {
  id: "r", name: "R", category: "weapon",
  slots: [
    { name: "blade", drives: "basePower", tierFloor: 1, qty: 1 },
    { name: "hilt", drives: "specialAbility", tierFloor: 1, qty: 1, optional: false, fits: [{ id: ITEM, name: "Wolf Tooth" }, { id: "silver", name: "Silver" }] },
    { name: "guard", drives: "specialAbility", tierFloor: 2, qty: 1, optional: true, fits: [{ id: "silver", name: "Silver" }] }
  ]
};
const opts = (pane, slot) => pane.find(p => p.name === slot).options;

test("HUB: an old slot lists materials by the tier rule only (a tagged ordinary item is not a candidate)", () => {
  assert.deepEqual(opts(slotPane(facts, recipe, {}), "blade").map(o => o.id), ["iron", "silver"]);
});
test("HUB: a tagged slot lists exactly what the GM said fits, the stand-in item by name with no tier text and no price", () => {
  const hilt = opts(slotPane(facts, recipe, {}), "hilt");
  assert.deepEqual(hilt.map(o => o.id).sort(), [ITEM, "silver"].sort());
  const tooth = hilt.find(o => o.id === ITEM);
  assert.equal(tooth.name, "Wolf Tooth"); assert.equal(tooth.tierText, ""); assert.equal(tooth.worth, null);
});
test("HUB: iron is in the bag and meets the floor but is not on the slot's fits list, so it is not offered; the tier floor still holds for a real material", () => {
  assert.equal(opts(slotPane(facts, recipe, {}), "hilt").some(o => o.id === "iron"), false);
  assert.deepEqual(opts(slotPane(facts, recipe, {}), "guard").map(o => o.id), ["silver"]);
  const low = { ...recipe, slots: [{ ...recipe.slots[2], tierFloor: 3 }] };
  assert.deepEqual(opts(slotPane(facts, low, {}), "guard"), [], "silver is tier 2 and the floor is 3");
});
test("HUB: an optional tagged slot may stay empty; a required one may not", () => {
  assert.equal(allSlotsPicked(recipe, { blade: "iron", hilt: ITEM }), true);
  assert.equal(allSlotsPicked(recipe, { blade: "iron" }), false);
  assert.equal(allSlotsPicked(recipe, { hilt: ITEM }), false);
  assert.equal(allSlotsPicked({ slots: [{ name: "a", optional: true }] }, {}), false, "`optional` alone (no fits) is not a tagged slot");
});
test("HUB: picking the stand-in names it as the chosen item", () => {
  const pane = slotPane(facts, recipe, { hilt: ITEM });
  assert.equal(pane.find(p => p.name === "hilt").options.find(o => o.selected).id, ITEM);
});
