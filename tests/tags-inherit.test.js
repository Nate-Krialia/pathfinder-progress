/** Tag system, Slice 3b (docs/22): a slot that says passCap hands the tags of what fills it up to the item the craft makes. Pure parts. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { planCraft } from "../scripts/crafting/plan.js";
import { inheritedTags, slotPassCap } from "../scripts/tags/inherit.js";
import { asPage, seedRecords, UUID, UUID_2, RECIPE } from "./helpers.js";

const tag = (id, extra = {}) => ({ kind: "tag", id, name: id[0].toUpperCase() + id.slice(1), theme: `${id} things`, ...extra });
const mat = (id, tier, extra = {}) => ({ kind: "material", id, name: id, tier, effects: { basePower: `T${tier}` }, ...extra });
const defs = (...records) => loadDefinitions([...seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), ...records.map(r => ({ pack: "t", entry: r.id, text: asPage(r) }))]);
const recipeOf = (slots, extra = {}) => ({ ...RECIPE, id: "bar", name: "Bar", category: "weapon", output: { 1: UUID, 2: UUID_2, 3: UUID, 4: UUID_2, 5: UUID }, slots, ...extra });
const ledgerOf = (items = {}, crafted = {}) => { const l = { v: 1, items }; Object.defineProperty(l, "crafted", { value: crafted, enumerable: false }); return l; };
const TAGS = ["a", "b", "c", "d"];
const reg = (slots, tags = TAGS.map(id => tag(id)), more = []) => { const r = defs(...tags, ...more, recipeOf(slots)); assert.deepEqual(r.errors, []); return r.registry ?? r; };
const use = (slot, materialId) => ({ slot, materialId });
const EDGE = { name: "edge", drives: "basePower", tierFloor: 1, qty: 1 };
const PART = { name: "part", drives: "bonusDamage", tierFloor: 1, qty: 1, needs: { all: ["a"] }, passCap: 2 };

test("PASSCAP: absent or 0 or false is none; true is the default; a number is its own", () => {
  assert.deepEqual([undefined, false, 0, true, 1, 3].map(passCap => slotPassCap({ passCap })), [0, 0, 0, 2, 1, 3]);
  assert.equal(slotPassCap(undefined), 0);
});
test("PASSCAP: the schema takes true or a whole number 1 to 6 and names the field otherwise", () => {
  for (const passCap of [true, 1, 6]) assert.deepEqual(defs(tag("a"), recipeOf([EDGE, { ...PART, passCap }])).errors, [], String(passCap));
  for (const passCap of [0, 7, "x", 1.5]) assert.match(JSON.stringify(defs(tag("a"), recipeOf([EDGE, { ...PART, passCap }])).errors), /passCap/, String(passCap));
});
test("INHERIT: a slot passes at most passCap tags, highest tier first, then tag priority, then alphabetical; slots without passCap pass nothing", () => {
  const registry = reg([EDGE, { ...PART, passCap: 2 }], [tag("a"), tag("b", { priority: 5 }), tag("c"), tag("d")]);
  const L = ledgerOf({ gem: { tags: ["a", "b", "c", "d"], tier: 2 }, fang: { tags: ["a", "c"], tier: 4 } });
  const recipe = { slots: [EDGE, { ...PART, passCap: 2 }] };
  assert.deepEqual(inheritedTags({ recipe, uses: [use("part", "gem")], registry, ledger: L }), [{ tag: "b", tier: 2 }, { tag: "a", tier: 2 }], "same tier: priority first, then A before C and D");
  assert.deepEqual(inheritedTags({ recipe, uses: [use("part", "fang")], registry, ledger: L }), [{ tag: "a", tier: 4 }, { tag: "c", tier: 4 }], "tier 4 outranks nothing here; both fit");
  assert.deepEqual(inheritedTags({ recipe: { slots: [EDGE, { ...PART, passCap: undefined }] }, uses: [use("part", "gem")], registry, ledger: L }), [], "no passCap, nothing");
  assert.deepEqual(inheritedTags({ recipe, uses: [use("edge", "gem")], registry, ledger: L }), [], "a slot without it, even when filled, passes nothing");
  assert.deepEqual(inheritedTags({ recipe, uses: [], registry, ledger: L }), [], "an unfilled slot passes nothing");
});
test("INHERIT: the cap is per SLOT; the same tag from two slots is kept once at the higher tier", () => {
  const registry = reg([EDGE, PART], undefined);
  const recipe = { slots: [{ ...PART, name: "p1", passCap: 1 }, { ...PART, name: "p2", passCap: 1 }] };
  const L = ledgerOf({ g1: { tags: ["a", "b"], tier: 1 }, g2: { tags: ["a", "c"], tier: 3 } });
  assert.deepEqual(inheritedTags({ recipe, uses: [use("p1", "g1"), use("p2", "g2")], registry, ledger: L }), [{ tag: "a", tier: 3 }], "two slots, one cap each, same tag once, higher tier");
});
test("INHERIT: a crafted ingredient passes its tags at THEIR original tiers (native at its own tier, inherited at theirs); a tag the registry lost is dropped", () => {
  const registry = reg([EDGE, PART]);
  const rec = { recipeId: "x", name: "Bar", tier: 2, depth: 1, native: ["a"], inherited: [{ tag: "b", tier: 4 }, { tag: "gone", tier: 5 }], uses: [], roles: {}, contributions: [] };
  const L = ledgerOf({}, { z: rec });
  assert.deepEqual(inheritedTags({ recipe: { slots: [{ ...PART, passCap: 5 }] }, uses: [use("part", "crafted:z")], registry, ledger: L }), [{ tag: "b", tier: 4 }, { tag: "a", tier: 2 }]);
});

const plan = (registry, selection, ledger) => planCraft({ recipe: registry.recipe.get("bar"), registry, selection, stacks: Object.values(selection).map((id, i) => ({ stackId: `s${i}`, materialId: id, quantity: 9 })), station: { id: "f", name: "F", category: RECIPE.stationCategory, tier: 1 }, ledger });
test("PLAN: the frozen record carries what the craft passes up; a recipe with a passCap slot is frozen even with nothing else tagged", () => {
  const registry = reg([EDGE, { ...PART, needs: undefined, passCap: 2 }], undefined, [mat("ironbar", 1), mat("gem", 2, { tag: "a", effects: { basePower: "T2", bonusDamage: { dice: "1d4", type: "fire" } } })]);
  const r = plan(registry, { edge: "ironbar", part: "gem" }, ledgerOf({ gem: { tags: ["b", "c"], tier: 3 } }));
  assert.ok(r.ok, r.errors?.join(" | "));
  assert.deepEqual(r.plan.frozen.inherited, [{ tag: "a", tier: 3 }, { tag: "b", tier: 3 }], "the gem is tier 3 in the ledger; a, b, c tie, alphabetical, cap 2");
  assert.deepEqual(r.plan.frozen.uses.map(u => u.slot), ["part"]);
});
test("PLAN: a recipe with no passCap slot freezes nothing and inherits nothing", () => {
  const registry = reg([EDGE, { ...PART, passCap: undefined, needs: undefined }], undefined, [mat("ironbar", 1), mat("gem", 2, { tag: "a", effects: { basePower: "T2", bonusDamage: { dice: "1d4", type: "fire" } } })]);
  const r = plan(registry, { edge: "ironbar", part: "gem" }, ledgerOf({}));
  assert.ok(r.ok, r.errors?.join(" | "));
  assert.equal(r.plan.frozen, null);
});
