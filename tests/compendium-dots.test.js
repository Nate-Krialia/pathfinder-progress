/**
 * Dot-free keys in the Compendium (issue 30): Foundry reads a dot in an object's key as a path when it saves data, so a creature called "Dr. Smith" must not be stored under a key with a dot in it.
 * The fake rewrites a dotted key into nested objects (in a flag write and in a setting write), as real Foundry does; the old key ("dr. smith") then left the Compendium damaged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { M, as, fireHook, getApi, makeActor, newId, world, quietly } from "./fake-world.js";
import { creatureKey } from "../scripts/compendium/entries.js";
import { mergeIntoShared, readBook, readShared } from "../scripts/compendium/store.js";

/** Expand every dotted key of a plain object into nested objects (arrays are left alone), the way Foundry expands the data of an update. */
function expandDots(value) {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    let node = out; const path = key.split(".");
    for (const part of path.slice(0, -1)) node = node[part] ??= {};
    node[path.at(-1)] = expandDots(inner);
  }
  return out;
}
const npc = name => { const actor = makeActor(name, {}); Object.assign(actor, { type: "npc", system: { traits: { value: ["humanoid"] } } }); game.actors.push(actor); return actor; };
const startCombat = async (...actors) => { const c = { id: newId("combat"), combatants: [] }; for (const actor of actors) c.combatants.push({ id: newId("cmb"), actor, parent: c }); await fireHook("createCombatant", [c.combatants.at(-1)]); return c; };
/** Real Foundry's behaviour for a dotted key, in the fake: a character's flag write, and the shared setting write, are expanded. */
function foundryExpandsDots(actor) {
  const update = actor.update.bind(actor);
  actor.update = data => update(Object.fromEntries(Object.entries(data).map(([path, value]) => [path, expandDots(value)])));
  const set = game.settings.set;
  game.settings.set = async (scope, key, value) => set(scope, key, key === "sharedCompendium" ? expandDots(value) : value);
  return () => { game.settings.set = set; };
}

test("CREATURE KEY: a name with dots gets a key with none; a name without dots keeps the key it always had; two names never share a key", () => {
  assert.equal(creatureKey("Dr. Smith"), "dr%2e smith");
  assert.equal(creatureKey("St. Bernard Jr."), "st%2e bernard jr%2e");
  assert.equal(creatureKey("Goblin Warrior"), "goblin warrior");
  assert.equal(creatureKey("Dire Wolf"), "dire wolf", "the keys already stored for ordinary names are unchanged");
  assert.notEqual(creatureKey("A.B"), creatureKey("a%2eb"), "a literal %2e in a name is escaped, so it cannot collide");
  assert.ok(![creatureKey("a.b.c"), creatureKey("x. y")].some(k => k.includes(".")));
});

test("CREATURE KEY: a creature called Dr. Smith is recorded under a dot-free key and the Compendium still reads back (a flag write)", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const restore = foundryExpandsDots(w.ann);
  try {
    await startCombat(w.ann, npc("Dr. Smith"));
    const stored = w.ann.getFlag(M, "compendium");
    assert.deepEqual(Object.keys(stored.creatures), ["dr%2e smith"], `the flag holds one flat key, not nested objects: ${JSON.stringify(Object.keys(stored.creatures))}`);
    assert.deepEqual([stored.creatures["dr%2e smith"].key, stored.creatures["dr%2e smith"].name], ["dr%2e smith", "Dr. Smith"], "the entry keeps the real name");
    assert.doesNotThrow(() => readBook(w.ann), "the stored book is valid");
    const view = await as(w.annUser, () => getApi().compendium.view(w.ann));
    assert.deepEqual(view.entries.creatures.map(c => c.name), ["Dr. Smith"]);
    await startCombat(w.ann, npc("Dr. Smith"));
    assert.equal(Object.keys(w.ann.getFlag(M, "compendium").creatures).length, 1, "met again: still one entry");
  } finally { restore(); }
});

test("CREATURE KEY: a shared entry for a creature with dots is saved flat too (a setting write)", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const restore = foundryExpandsDots(w.ann);
  try {
    await quietly(() => mergeIntoShared("creature", { key: creatureKey("Dr. Smith"), name: "Dr. Smith", type: "humanoid", firstAt: 1, yields: [] }));
    const shared = readShared();
    assert.deepEqual(Object.keys(shared.creatures), ["dr%2e smith"]);
    assert.equal(shared.creatures["dr%2e smith"].name, "Dr. Smith");
  } finally { restore(); }
});
