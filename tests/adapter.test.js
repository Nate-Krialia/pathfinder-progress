import test from "node:test";
import assert from "node:assert/strict";
import { getCreatureInfo, getMaterialFlags, getMaterialStacks, isMaterialItem, levelDC, versionAtLeast } from "../scripts/adapter/pf2e.js";

test("levelDC matches the PF2e level-based DC table", () => {
  assert.equal(levelDC(0), 14);
  assert.equal(levelDC(1), 15);
  assert.equal(levelDC(4), 19);
  assert.equal(levelDC(10), 27);
  assert.equal(levelDC(20), 40);
  assert.equal(levelDC(25), 50);
});

test("levelDC rejects out-of-range levels", () => {
  assert.throws(() => levelDC(-1), RangeError);
  assert.throws(() => levelDC(26), RangeError);
  assert.throws(() => levelDC(2.5), RangeError);
});

test("versionAtLeast compares dotted versions numerically", () => {
  assert.ok(versionAtLeast("14.369", "14.369"));
  assert.ok(versionAtLeast("14.370", "14.369"));
  assert.ok(versionAtLeast("15.1", "14.369"));
  assert.ok(versionAtLeast("8.10.0", "8.6.1"));
  assert.ok(!versionAtLeast("8.5.9", "8.6.1"));
  assert.ok(!versionAtLeast("13.999", "14.369"));
});

const fakeItem = (flags, quantity) => ({
  getFlag: (scope, key) => (scope === "pathfinder-progress" && key === "material" ? flags : undefined),
  system: { quantity }
});

test("material flags are read from items; non-materials return null", () => {
  assert.deepEqual(getMaterialFlags(fakeItem({ materialId: "iron", tier: 1 })), { materialId: "iron", tier: 1 });
  assert.equal(getMaterialFlags(fakeItem(undefined)), null);
  assert.equal(isMaterialItem(fakeItem({ materialId: "iron", tier: 1 })), true);
  assert.equal(isMaterialItem({}), false);
});

test("getMaterialStacks lists only material items, with quantities", () => {
  const actor = { items: [fakeItem({ materialId: "iron", tier: 1 }, 5), fakeItem(undefined, 1), fakeItem({ materialId: "silver", tier: 2 }, 2)] };
  const stacks = getMaterialStacks(actor);
  assert.deepEqual(stacks.map(s => [s.materialId, s.tier, s.quantity]), [["iron", 1, 5], ["silver", 2, 2]]);
});

test("getCreatureInfo reads level and traits", () => {
  assert.deepEqual(getCreatureInfo({ system: { details: { level: { value: 7 } }, traits: { value: ["dragon", "fire"] } } }), { level: 7, traits: ["dragon", "fire"] });
  assert.deepEqual(getCreatureInfo({ level: 3, traits: new Set(["beast"]) }), { level: 3, traits: ["beast"] });
});
