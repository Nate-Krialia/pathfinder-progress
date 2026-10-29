/** Stage 10b, the pure parts: the Compendium book rules (additive, idempotent, experienced facts only) and sharing. */
import test from "node:test";
import assert from "node:assert/strict";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import {
  countBook, creatureKey, describeBook, emptyBook, hasMaterial, mergeShared, pickEntry, recordCreature, recordCreatureYield, recordMaterial,
  recordRegion, recordRegionNodeType, usedIn
} from "../scripts/compendium/entries.js";

const valid = book => assert.deepEqual(check(LIVE_SCHEMAS.compendium, book), []);
/** A canonical form: object keys and array items in sorted order, so only the FACTS are compared, not the order they arrived in. */
const canonical = value => JSON.stringify(sortDeep(value));
const sortDeep = value => {
  if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortDeep(value[k])]));
  return value;
};
const at = 1000;
const WOOD = { key: "region:oak-wood", label: "Oak Wood" };
const RUNG = { nodeType: "ore", tier: 1, rung: "base" };

test("an empty book is valid and holds nothing", () => {
  const book = emptyBook();
  valid(book);
  assert.deepEqual(countBook(book), { materials: 0, creatures: 0, regions: 0 });
});

test("MATERIAL: the first time it lands makes a bare entry; place and rung only appear once they were experienced", () => {
  const bare = recordMaterial(emptyBook(), { materialId: "iron", name: "Iron", tier: 1, at });
  valid(bare);
  assert.deepEqual(bare.materials.iron, { id: "iron", name: "Iron", tier: 1, firstAt: at, places: [], rungs: [] });
  const rich = recordMaterial(bare, { materialId: "iron", name: "Iron", tier: 1, place: WOOD, rung: RUNG, at: at + 5 });
  valid(rich);
  assert.equal(rich.materials.iron.firstAt, at, "the first time stays the first time");
  assert.deepEqual(rich.materials.iron.places, [WOOD]);
  assert.deepEqual(rich.materials.iron.rungs, [RUNG]);
});

test("MATERIAL: contextual first then bare, bare then contextual, and a double call all give the SAME book", () => {
  const contextual = book => recordMaterial(book, { materialId: "iron", name: "Iron", tier: 1, place: WOOD, rung: RUNG, at });
  const bare = book => recordMaterial(book, { materialId: "iron", name: "Iron", tier: 1, at });
  const a = bare(contextual(emptyBook()));
  const b = contextual(bare(emptyBook()));
  const c = contextual(contextual(bare(bare(emptyBook()))));
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(JSON.stringify(contextual(a)), JSON.stringify(a), "recording the same fact again changes nothing");
});

test("MATERIAL: a bare entry made before the name was known takes the name later, never loses it", () => {
  const nameless = recordMaterial(emptyBook(), { materialId: "iron", at });
  assert.equal(nameless.materials.iron.name, "iron");
  const named = recordMaterial(nameless, { materialId: "iron", name: "Iron", tier: 1, at });
  assert.deepEqual([named.materials.iron.name, named.materials.iron.tier], ["Iron", 1]);
  assert.equal(recordMaterial(named, { materialId: "iron", name: "Something Else", tier: 3, at }).materials.iron.name, "Iron");
});

test("MATERIAL: places and rungs are sets (no duplicates), and only the ones reached are listed", () => {
  let book = emptyBook();
  for (const rung of ["base", "higher", "base", "higher"]) book = recordMaterial(book, { materialId: "iron", name: "Iron", place: WOOD, rung: { ...RUNG, rung }, at });
  book = recordMaterial(book, { materialId: "iron", name: "Iron", place: { key: "scene:s1", label: "The Pit" }, at });
  assert.deepEqual(book.materials.iron.rungs.map(r => r.rung), ["base", "higher"]);
  assert.deepEqual(book.materials.iron.places.map(p => p.label), ["Oak Wood", "The Pit"]);
  assert.equal(hasMaterial(book, "iron"), true);
  assert.equal(hasMaterial(book, "silver"), false);
});

test("CREATURE: a combat gives a barebones entry (name and type); yields stay empty and nothing locked is stored", () => {
  const book = recordCreature(emptyBook(), { name: "Goblin Warrior", type: "humanoid", at });
  valid(book);
  assert.deepEqual(book.creatures["goblin warrior"], { key: "goblin warrior", name: "Goblin Warrior", type: "humanoid", firstAt: at, yields: [] });
  assert.equal(recordCreature(book, { name: "GOBLIN WARRIOR", type: "humanoid", at: at + 9 }), book, "the same creature again is a no-op");
});

test("CREATURE: a yield is recorded only after it was taken from a corpse; it also makes the entry if the combat was missed", () => {
  const book = recordCreatureYield(emptyBook(), { name: "Dire Wolf", type: "animal", materialId: "wolf-pelt", materialName: "Wolf Pelt", at });
  valid(book);
  assert.deepEqual(book.creatures["dire wolf"].yields, [{ materialId: "wolf-pelt", name: "Wolf Pelt" }]);
  const twice = recordCreatureYield(book, { name: "dire wolf", type: "animal", materialId: "wolf-pelt", materialName: "Wolf Pelt", at });
  assert.deepEqual(twice.creatures["dire wolf"].yields.length, 1);
  const both = recordCreatureYield(recordCreature(emptyBook(), { name: "Dire Wolf", type: "animal", at }), { name: "Dire Wolf", type: "animal", materialId: "wolf-pelt", materialName: "Wolf Pelt", at });
  assert.deepEqual(both, book, "combat then corpse equals corpse alone");
});

test("NO PLACEHOLDERS: a described book never contains '???', a locked marker, or a count of what is not yet known", () => {
  let book = recordCreature(emptyBook(), { name: "Goblin", type: "humanoid", at });
  book = recordCreatureYield(book, { name: "Dire Wolf", type: "animal", materialId: "pelt", materialName: "Pelt", at });
  book = recordMaterial(book, { materialId: "iron", name: "Iron", tier: 1, at });
  const described = describeBook(book);
  const text = JSON.stringify(described);
  assert.doesNotMatch(text, /\?\?\?|locked|unknown|hidden|remaining/i);
  const goblin = described.creatures.find(c => c.name === "Goblin");
  assert.deepEqual(Object.keys(goblin).sort(), ["firstAt", "key", "name", "shared", "type", "yields"]);
  assert.deepEqual(goblin.yields, [], "an uncollected yield shows nothing at all");
});

test("REGION: the first exploration makes the entry; node types found are added once", () => {
  let book = recordRegion(emptyBook(), { regionId: "oak-wood", name: "Oak Wood", at });
  book = recordRegionNodeType(book, { regionId: "oak-wood", nodeType: "herb", nodeTypeName: "Herb Patch", at });
  book = recordRegionNodeType(book, { regionId: "oak-wood", nodeType: "herb", nodeTypeName: "Herb Patch", at });
  valid(book);
  assert.deepEqual(book.regions["oak-wood"].nodeTypes, [{ id: "herb", name: "Herb Patch" }]);
  const viaNode = recordRegionNodeType(emptyBook(), { regionId: "oak-wood", regionName: "Oak Wood", nodeType: "herb", nodeTypeName: "Herb Patch", at });
  assert.deepEqual(viaNode, book, "finding a node first also makes the region entry");
});

test("keys can never be prototype keys", () => {
  for (const bad of ["__proto__", "constructor", "prototype", "", "   "]) {
    assert.throws(() => recordMaterial(emptyBook(), { materialId: bad, at }), /cannot be used as an entry key/);
    assert.throws(() => creatureKey(bad), /cannot be used as an entry key/);
  }
  assert.equal(pickEntry(emptyBook(), "material", "__proto__"), null);
  assert.equal(pickEntry(emptyBook(), "material", "toString"), null);
});

test("random order of random facts always gives a valid book with the same facts (property)", () => {
  let seed = 3;
  const rand = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const facts = [
    b => recordMaterial(b, { materialId: "iron", name: "Iron", tier: 1, at }),
    b => recordMaterial(b, { materialId: "iron", name: "Iron", tier: 1, place: WOOD, rung: RUNG, at }),
    b => recordMaterial(b, { materialId: "silver", name: "Silver", tier: 2, place: WOOD, rung: { nodeType: "ore", tier: 1, rung: "higher" }, at }),
    b => recordCreature(b, { name: "Goblin", type: "humanoid", at }),
    b => recordCreatureYield(b, { name: "Goblin", type: "humanoid", materialId: "ear", materialName: "Ear", at }),
    b => recordRegion(b, { regionId: "oak-wood", name: "Oak Wood", at }),
    b => recordRegionNodeType(b, { regionId: "oak-wood", nodeType: "herb", nodeTypeName: "Herb", at })
  ];
  const canon = canonical;
  let reference = null;
  for (let run = 0; run < 100; run++) {
    const order = Array.from({ length: 12 }, () => facts[rand(facts.length)]);
    for (const f of facts) order.push(f);                                    // every fact at least once
    let book = emptyBook();
    for (const f of order) book = f(book);
    valid(book);
    reference ??= canon(book);
    assert.equal(canon(book), reference);
  }
});

test("USED IN: derived from the formula snapshots the character holds (never stored), by tier floor and role", () => {
  const iron = { id: "iron", tier: 1, effects: { basePower: "T1" } };
  const fang = { id: "fang", tier: 2, effects: { bonusDamage: { dice: "1d4", type: "poison" }, specialAbility: {} } };
  const formulas = [
    { recipeId: "dagger", snapshot: { name: "Dagger", slots: [{ name: "blade", drives: ["basePower"], tierFloor: 1, qty: 1 }, { name: "fang", drives: ["bonusDamage", "specialAbility"], tierFloor: 2, qty: 1 }] } },
    { recipeId: "sword", snapshot: { name: "Sword", slots: [{ name: "core", drives: "specialAbility", tierFloor: 3, qty: 1 }] } }
  ];
  assert.deepEqual(usedIn(iron, formulas), [{ recipeId: "dagger", name: "Dagger" }]);
  assert.deepEqual(usedIn(fang, formulas), [{ recipeId: "dagger", name: "Dagger" }], "tier 2 is below the sword's floor of 3");
  assert.deepEqual(usedIn(iron, []), []);
  assert.deepEqual(usedIn(undefined, formulas), []);
});

test("SHARE: merging is additive and idempotent, in either order; a shared entry only ever grows", () => {
  const a = recordMaterial(emptyBook(), { materialId: "iron", name: "Iron", tier: 1, place: WOOD, rung: RUNG, at: 500 }).materials.iron;
  const b = recordMaterial(emptyBook(), { materialId: "iron", name: "Iron", tier: 1, place: { key: "scene:s1", label: "The Pit" }, rung: { ...RUNG, rung: "higher" }, at: 300 }).materials.iron;
  const ab = mergeShared(mergeShared(emptyBook(), "material", a), "material", b);
  const ba = mergeShared(mergeShared(emptyBook(), "material", b), "material", a);
  valid(ab);
  assert.equal(canonical(ab), canonical(ba));
  assert.equal(ab.materials.iron.firstAt, 300, "the earliest time");
  assert.equal(ab.materials.iron.places.length, 2);
  assert.equal(JSON.stringify(mergeShared(ab, "material", a)), JSON.stringify(ab), "sharing the same facts again changes nothing");

  const creature = recordCreatureYield(emptyBook(), { name: "Dire Wolf", type: "animal", materialId: "pelt", materialName: "Pelt", at }).creatures["dire wolf"];
  const region = recordRegionNodeType(emptyBook(), { regionId: "oak-wood", regionName: "Oak Wood", nodeType: "herb", at }).regions["oak-wood"];
  const both = mergeShared(mergeShared(emptyBook(), "creature", creature), "region", region);
  valid(both);
  assert.deepEqual([Object.keys(both.creatures), Object.keys(both.regions)], [["dire wolf"], ["oak-wood"]]);
  assert.throws(() => mergeShared(emptyBook(), "spell", a), /unknown entry kind/);
});

test("pickEntry returns a copy of exactly the entry asked for, or null", () => {
  const book = recordMaterial(emptyBook(), { materialId: "iron", name: "Iron", tier: 1, place: WOOD, at });
  const entry = pickEntry(book, "material", "iron");
  assert.deepEqual(entry, book.materials.iron);
  entry.places.push({ key: "x", label: "x" });
  assert.equal(book.materials.iron.places.length, 1, "a copy, not the book's own");
  assert.equal(pickEntry(book, "material", "silver"), null);
  assert.equal(pickEntry(book, "spell", "iron"), null);
});
