/**
 * Experiments (docs/11b, B), the pure half: what is recorded, in which order, what a baseline is, what a view shows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";
import { emptyBook, recordMaterial } from "../scripts/compendium/entries.js";
import {
  computeBaseline, describeExperiments, effectKnown, experimentFactsText, knownResult, mergeExperiment, pickExperiment, recordBaseline, recordExperiment
} from "../scripts/compendium/experiments.js";
import { resolveSlotEffects } from "../scripts/crafting/plan.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { check } from "../scripts/data/schema.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const dagger = registry.recipe.get("dagger-spider-fang");
const longsword = registry.recipe.get("longsword-basic");
const at = 1000;
const learn = (book, recipe, slot, materialId, when = at) => {
  const material = registry.material.get(materialId);
  const { resolved } = resolveSlotEffects(recipe, recipe.slots.find(s => s.name === slot), material);
  return recordExperiment(book, { recipeId: recipe.id, recipeName: recipe.name, slot, materialId, materialName: material.name, tier: material.tier, effects: resolved, at: when });
};
const valid = book => assert.deepEqual(check(LIVE_SCHEMAS.compendium, book), []);

test("a fact is per (recipe, slot, material): the effect the shared resolver gives, nothing about the other slot or the pairing", () => {
  const book = learn(emptyBook(), dagger, "blade", "silver");
  assert.deepEqual(book.experiments[dagger.id].slots, { blade: { silver: { materialId: "silver", materialName: "Silver", tier: 2, effects: { basePower: "T2" }, at } } });
  assert.deepEqual(effectKnown({ own: book, shared: emptyBook() }, dagger.id, "blade", "silver"), { known: true, effects: { basePower: "T2" }, via: "crafted" });
  assert.deepEqual(effectKnown({ own: book, shared: emptyBook() }, dagger.id, "blade", "iron"), { known: false }, "another material in the same slot is not known");
  assert.deepEqual(effectKnown({ own: book, shared: emptyBook() }, dagger.id, "fang", "silver"), { known: false }, "the same material in another slot is not known");
  assert.deepEqual(effectKnown({ own: book, shared: emptyBook() }, longsword.id, "blade", "silver"), { known: false }, "another recipe is not known");
  valid(book);
});

test("the effect comes from the ONE resolver: a recipe override beats the material default", () => {
  const coating = longsword.slots.find(s => s.name === "coating");
  const viaOverride = resolveSlotEffects(longsword, coating, registry.material.get("silver"));
  assert.deepEqual(viaOverride.resolved, { bonusDamage: longsword.overrides.find(o => o.materialId === "silver").effect });
  assert.notDeepEqual(viaOverride.resolved.bonusDamage, registry.material.get("silver").effects.bonusDamage, "the override differs from the default");
  const book = learn(emptyBook(), longsword, "coating", "silver");
  assert.deepEqual(book.experiments[longsword.id].slots.coating.silver.effects, viaOverride.resolved);
});

test("recording is idempotent and additive in either order", () => {
  const a = learn(learn(emptyBook(), dagger, "blade", "silver"), dagger, "fang", "spider-fang");
  const b = learn(learn(emptyBook(), dagger, "fang", "spider-fang"), dagger, "blade", "silver");
  assert.deepEqual(a.experiments[dagger.id].slots, b.experiments[dagger.id].slots);
  assert.deepEqual(learn(a, dagger, "blade", "silver", 9999), a, "again, later: nothing changes (the first time stays)");
  assert.deepEqual(learn(a, dagger, "blade", "silver"), a);
  assert.deepEqual(emptyBook().experiments, undefined, "an empty book does not even carry the key");
});

test("a bare entry takes the proper recipe and material names when they are known", () => {
  let book = recordExperiment(emptyBook(), { recipeId: dagger.id, slot: "blade", materialId: "silver", effects: { basePower: "T2" }, at });
  assert.equal(book.experiments[dagger.id].name, dagger.id);
  book = recordExperiment(book, { recipeId: dagger.id, recipeName: dagger.name, slot: "blade", materialId: "silver", materialName: "Silver", effects: { basePower: "T2" }, at });
  assert.equal(book.experiments[dagger.id].name, "Spider Fang Dagger");
  assert.equal(book.experiments[dagger.id].slots.blade.silver.materialName, "Silver");
});

test("keys cannot be prototype names", () => {
  assert.throws(() => recordExperiment(emptyBook(), { recipeId: "__proto__", slot: "a", materialId: "b", effects: {}, at }), /cannot be used as a key/);
  assert.throws(() => recordExperiment(emptyBook(), { recipeId: "r", slot: "constructor", materialId: "b", effects: {}, at }), /cannot be used as a key/);
});

test("BASELINE: per slot, the cheapest valid material (lowest tier at or above the floor, then lowest gp value, then lowest id)", () => {
  const baseline = computeBaseline(dagger, registry);
  assert.deepEqual(baseline.slots.map(s => [s.slot, s.materialId]), [["blade", "iron"], ["fang", "spider-fang"]], "iron is T1 and has basePower; the fang slot needs bonusDamage AND specialAbility, so silver (no ability) is out");
  assert.equal(baseline.baseTier, 1);
  assert.deepEqual(baseline.slots[0].effects, { basePower: "T1" });
  const sword = computeBaseline(longsword, registry);
  assert.deepEqual(sword.slots.map(s => [s.slot, s.materialId]), [["blade", "iron"], ["coating", "silver"], ["core", "starmetal"]], "a T2 tie on value is broken by id: silver before spider-fang");
  assert.equal(sword.slots[1].effects.bonusDamage.dice, longsword.overrides.find(o => o.materialId === "silver").effect.dice, "and it uses the recipe override");
});

test("BASELINE: no valid material for a slot means no baseline; a cheaper valid material wins whatever the load order", () => {
  const poor = { ...registry, material: new Map([["iron", registry.material.get("iron")]]) };
  assert.equal(computeBaseline(dagger, poor), null);
  const reversed = { ...registry, material: new Map([...registry.material].reverse()) };
  assert.deepEqual(computeBaseline(dagger, reversed), computeBaseline(dagger, registry));
});

test("BASELINE: recorded once, never changes, and makes ONLY the baseline material's effect known", () => {
  const baseline = computeBaseline(dagger, registry);
  const book = recordBaseline(emptyBook(), { recipeId: dagger.id, recipeName: dagger.name, baseline, at });
  const again = recordBaseline(book, { recipeId: dagger.id, recipeName: dagger.name, baseline: { baseTier: 9, slots: [] }, at: 5 });
  assert.deepEqual(again, book);
  const books = { own: book, shared: emptyBook() };
  assert.deepEqual(effectKnown(books, dagger.id, "blade", "iron"), { known: true, effects: { basePower: "T1" }, via: "baseline" });
  assert.deepEqual(effectKnown(books, dagger.id, "blade", "silver"), { known: false });
  valid(book);
});

test("knownResult: the base tier is known only when the slot that picks it is known", () => {
  const facts = { blade: { known: true, effects: { basePower: "T2" } }, fang: { known: false } };
  assert.deepEqual(knownResult(dagger, facts), { known: true, baseTier: 2 });
  assert.deepEqual(knownResult(dagger, { ...facts, blade: { known: false } }), { known: false });
});

test("the shared book is read too, below the character's own, and merging is additive", () => {
  const mine = learn(emptyBook(), dagger, "blade", "silver");
  const theirs = learn(learn(emptyBook(), dagger, "blade", "iron", 5), dagger, "blade", "silver", 6);
  const books = { own: mine, shared: theirs };
  assert.equal(effectKnown(books, dagger.id, "blade", "silver").via, "crafted", "the character's own knowledge wins");
  assert.equal(effectKnown(books, dagger.id, "blade", "iron").via, "shared");
  const merged = mergeExperiment(mine, theirs.experiments[dagger.id]);
  assert.deepEqual(Object.keys(merged.experiments[dagger.id].slots.blade).sort(), ["iron", "silver"]);
  assert.equal(merged.experiments[dagger.id].firstAt, 5, "the earliest time");
  assert.deepEqual(mergeExperiment(merged, theirs.experiments[dagger.id]), merged, "idempotent");
  assert.deepEqual(mergeExperiment(emptyBook(), mine.experiments[dagger.id]).experiments, mine.experiments);
  valid(merged);
});

test("pickExperiment gives a copy of one recipe's facts, and null for a recipe the character knows nothing about", () => {
  const book = learn(emptyBook(), dagger, "blade", "silver");
  const picked = pickExperiment(book, dagger.id);
  picked.slots.blade.silver.effects.basePower = "T9";
  assert.equal(book.experiments[dagger.id].slots.blade.silver.effects.basePower, "T2", "a copy");
  assert.equal(pickExperiment(book, longsword.id), null);
  assert.equal(pickExperiment(emptyBook(), dagger.id), null);
  assert.match(experimentFactsText(book.experiments[dagger.id]), /^1 material effect\(s\) learned$/);
});

test("VIEW: only what was experienced is listed (no placeholders), and a baseline names a material only if it has been met", () => {
  const baseline = computeBaseline(dagger, registry);
  let own = recordBaseline(emptyBook(), { recipeId: dagger.id, recipeName: dagger.name, baseline, at });
  const never = describeExperiments({ own, shared: emptyBook() });
  assert.deepEqual(never.map(e => [e.recipeId, e.source, e.known.length]), [[dagger.id, "own", 0]]);
  assert.deepEqual(never[0].baseline.slots.map(s => [s.slot, s.needs, s.material]), [["blade", "tier 1 or higher", null], ["fang", "tier 2 or higher", null]], "never met a valid material: the slots and the effect, no material name");
  assert.doesNotMatch(JSON.stringify(never), /Iron|\?\?\?|unknown|locked/, "no material name (the recipe and effect text may say what it is or does), and no placeholder");
  own = recordMaterial(own, { materialId: "iron", name: "Iron", tier: 1, at });
  assert.deepEqual(describeExperiments({ own, shared: emptyBook() })[0].baseline.slots.map(s => s.material), ["Iron", null], "met iron: named; the fang still is not");
  own = learn(own, dagger, "blade", "silver");
  const view = describeExperiments({ own, shared: emptyBook() })[0];
  assert.deepEqual(view.known.map(k => [k.slot, k.material, k.source, k.effects]), [["blade", "Silver", "crafted", { basePower: "T2" }]]);
});

test("VIEW: a shared recipe the character has no private knowledge of is listed as shared; both is both", () => {
  const sharedBook = learn(emptyBook(), dagger, "blade", "silver");
  assert.deepEqual(describeExperiments({ own: emptyBook(), shared: sharedBook }).map(e => [e.recipeId, e.source, e.known[0].source]), [[dagger.id, "shared", "shared"]]);
  const mine = learn(emptyBook(), dagger, "blade", "iron");
  const both = describeExperiments({ own: mine, shared: sharedBook })[0];
  assert.equal(both.source, "both");
  assert.deepEqual(both.known.map(k => [k.material, k.source]).sort(), [["Iron", "crafted"], ["Silver", "shared"]]);
});
