/**
 * Stage 10b: the per-character Compendium and sharing, through the REAL scripts/main.js in the fake Foundry
 * (tests/fake-world.js): recording from every trigger, idempotence in either order, creatures that unlock yields only
 * from corpses, privacy through the API, and the share queue item (cancel, approve, reject, never blocks End downtime).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  M, as, addNode, craft, env, events, fireHook, gatherCall, getApi, getUsers, listeners, loudly, makeActor, makeToken, measure, newId, pendingOf, quietly, resolve, snapshot, world,
  everyFailureLeavesNothingHalfDone
} from "./fake-world.js";
import { GENERIC_FAILURE } from "../scripts/queue/relay.js";
import { noteGather, noteLanded } from "../scripts/compendium/store.js";

const api = () => getApi();
const book = actor => actor.getFlag(M, "compendium");
const countWrites = actor => { let n = 0; const original = actor.update; actor.update = async data => { if (JSON.stringify(Object.keys(data)).includes("compendium")) n++; return original.call(actor, data); }; return () => n; };

/** A herb patch in the Oak Wood, with a corpse-or-not option. Ann has a token on the table scene. */
const herb = (w, over = {}, extra = {}) => addNode(w.table, { nodeType: "herb", region: "oak-wood", ...over }, extra);

// MATERIAL ------------------------------------------------------------------------------------------------------------------
test("MATERIAL: a gather makes the entry the first time, with the place and the rung reached; a second gather adds nothing twice", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const { token } = await herb(w, { charges: 3 });
  const first = await gatherCall(w.annUser, w.ann, token, w.table);
  env.rng = [0.0, 0.0];                                   // quantity die, then the hidden d20: a 1 fails the higher rung
  await resolve(w.ann, first.id);
  const entry = book(w.ann).materials.moonpetal;
  assert.deepEqual([entry.id, entry.name, entry.tier], ["moonpetal", "Moonpetal", 1]);
  assert.deepEqual(entry.places, [{ key: "region:oak-wood", label: "Oak Wood" }], "the place it was found");
  assert.deepEqual(entry.rungs, [{ nodeType: "herb", tier: 1, rung: "base" }], "only the rung reached");
  assert.equal(book(w.ann).materials.wyrmroot, undefined, "a rung that was not reached leaves no entry");

  const second = await gatherCall(w.annUser, w.ann, token, w.table);
  env.rng = [0.0, 0.99, 0.0];                              // quantity, a natural 20 on the higher rung, its quantity
  await resolve(w.ann, second.id);
  assert.equal(book(w.ann).materials.moonpetal.places.length, 1, "the place is not duplicated");
  assert.deepEqual(book(w.ann).materials.moonpetal.rungs.map(r => r.rung), ["base"], "the base rung is not duplicated");
  assert.deepEqual(book(w.ann).materials.wyrmroot.rungs, [{ nodeType: "herb", tier: 1, rung: "higher" }], "the higher rung, now reached");
  assert.equal(Object.keys(book(w.ann).materials).length, 2);
  assert.deepEqual(api().audit.scan(), []);
});

test("MATERIAL: a node with no region records the scene it stands on as the place", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const { token } = await addNode(w.table, { nodeType: "ore", tier: 1, source: "placed" }, { actorId: "someone-elses-token", name: "Old Vein" });
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "gather", { sceneId: w.table.id, tokenId: token.id, skill: "athletics" }));
  await resolve(w.ann, action.id);
  assert.deepEqual(book(w.ann).materials.iron.places, [{ key: `scene:${w.table.id}`, label: "The Table" }]);
});

test("MATERIAL: any other way it lands (a GM gift, a dragged or traded item) makes a bare entry through the createItem hook, once", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  await api().giveMaterial(w.ann, "silver", 2);
  assert.deepEqual(book(w.ann).materials.silver, { id: "silver", name: "Silver", tier: 2, firstAt: book(w.ann).materials.silver.firstAt, places: [], rungs: [] });
  const writes = countWrites(w.ann);
  await api().giveMaterial(w.ann, "silver", 3);                    // tops up the stack: not a new item, nothing to record
  await w.ann.createEmbeddedDocuments("Item", [{ name: "Silver", type: "treasure", system: { quantity: 1 }, flags: { [M]: { material: { materialId: "silver", tier: 2 } } } }]);   // dragged in: same fact again
  assert.equal(writes(), 0, "recording a known material again writes nothing");
  await w.ann.createEmbeddedDocuments("Item", [{ name: "Rope", type: "equipment", system: {}, flags: {} }]);
  assert.deepEqual(Object.keys(book(w.ann).materials), ["silver"], "an ordinary item is not a discovery");
  await w.bob.createEmbeddedDocuments("Item", [{ name: "Iron", type: "treasure", system: { quantity: 1 }, flags: { [M]: { material: { materialId: "iron", tier: 1 } } } }]);
  assert.deepEqual(Object.keys(book(w.bob).materials), ["iron"], "a received item (a trade or a payout) is recorded for the receiver");
  assert.equal(book(w.ann).materials.iron, undefined, "and only for them");
});

test("MATERIAL: the createItem hook and the gather's own context merge additively in EITHER order, and a double call changes nothing", async () => {
  const gains = [{ materialId: "moonpetal", quantity: 2, rung: "base" }];
  const node = { nodeType: "herb", tier: 1, region: "oak-wood" };
  const defs = () => api().definitions;
  // order 1: the item lands (hook), then the context
  const w1 = await world({ downtime: 0, iron: 0, fang: 0 });
  await api().giveMaterial(w1.ann, "moonpetal", 2);
  await noteGather(defs(), w1.ann, { gains, node, scene: w1.table, at: 5 });
  // order 2: the context, then the item lands
  const w2 = await world({ downtime: 0, iron: 0, fang: 0 });
  await noteGather(defs(), w2.ann, { gains, node, scene: w2.table, at: 5 });
  await api().giveMaterial(w2.ann, "moonpetal", 2);
  const strip = b => { const copy = structuredClone(b.materials.moonpetal); delete copy.firstAt; return copy; };
  assert.deepEqual(strip(book(w1.ann)), strip(book(w2.ann)), "the same entry whichever came first");
  assert.equal(strip(book(w1.ann)).rungs.length, 1);
  // a double call
  const writes = countWrites(w1.ann);
  await noteGather(defs(), w1.ann, { gains, node, scene: w1.table, at: 99 });
  await noteLanded(w1.ann, { id: "moonpetal", name: "Moonpetal", tier: 1 });
  assert.equal(writes(), 0);
});

test("RECORDING IS BEST-EFFORT: a failure in it never fails or undoes the gather, and is logged on the GM", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const { token } = await herb(w, { charges: 3 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  const realUpdate = w.ann.update.bind(w.ann);
  w.ann.update = async data => { if (JSON.stringify(Object.keys(data)).includes("compendium")) throw new Error("compendium write refused"); return realUpdate(data); };
  const [outcome, logged] = await loudly(async seen => [await resolve(w.ann, action.id), seen]);
  assert.equal(outcome.status, "resolved");
  assert.ok(w.ann.items.some(i => i.getFlag(M, "material")?.materialId === "moonpetal"), "the materials were granted");
  assert.equal(nodeCharges(token), 2, "the charge was spent");
  assert.equal(book(w.ann), undefined, "nothing was recorded");
  assert.ok(logged.some(l => /could not record in the Compendium \(gather\)/.test(l)), "logged on the GM");
  assert.deepEqual(pendingOf(w.ann), []);
});
const nodeCharges = token => token.getFlag(M, "node").charges;

test("RECORDING: fault injection through a gather, at EVERY write: either the gather fails and the world is unchanged, or the failing write was best-effort and the gather still finished", async () => {
  const attempt = async failAt => {
    const w = await world({ downtime: 0, iron: 0, fang: 0 });
    const { token } = await herb(w, { charges: 3 });
    const action = await gatherCall(w.annUser, w.ann, token, w.table);
    env.ops = 0; env.labels = [];
    const before = snapshot(w);
    env.failAt = failAt;
    let error = null;
    try { await resolve(w.ann, action.id); } catch (e) { error = e; }
    env.failAt = null;
    return { w, token, before, error, ops: env.ops };
  };
  const clean = await attempt(null);
  assert.equal(clean.error, null);
  let swallowed = 0;
  for (let k = 1; k <= clean.ops; k++) {
    const run = await attempt(k);
    if (run.error) {
      assert.equal(snapshot(run.w), run.before, `a failure at write ${k} left the world changed`);
      assert.equal(pendingOf(run.w.ann).length, 1, "and the gather is still queued");
    } else {
      swallowed++;
      assert.deepEqual(pendingOf(run.w.ann), [], `the gather finished although write ${k} failed`);
      assert.equal(nodeCharges(run.token), 2, "its charge was spent");
      assert.ok(run.w.ann.items.some(i => i.getFlag(M, "material")?.materialId === "moonpetal"), "and the materials were granted");
    }
  }
  assert.ok(swallowed >= 2, `the best-effort writes (the hook's, the context's, the log's) may fail without failing the gather (${swallowed})`);
});

// CREATURES ---------------------------------------------------------------------------------------------------------------
const npc = async (name, traits) => {
  const actor = makeActor(name, {});
  Object.assign(actor, { type: "npc", system: { traits: { value: traits } } });
  game.actors.push(actor);
  return actor;
};
const combat = (...actors) => {
  const c = { id: newId("combat"), combatants: [] };
  for (const actor of actors) c.combatants.push({ id: newId("cmb"), actor, parent: c });
  return c;
};
const startCombat = async (...actors) => { const c = combat(...actors); await fireHook("createCombatant", [c.combatants.at(-1)]); return c; };

test("CREATURE: being in a combat with it makes a barebones entry (name and type), for the characters in that combat only; no duplicates", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const goblin = await npc("Goblin Warrior", ["humanoid", "goblin"]);
  await startCombat(w.ann, goblin);
  assert.deepEqual(book(w.ann).creatures["goblin warrior"], { key: "goblin warrior", name: "Goblin Warrior", type: "humanoid", firstAt: book(w.ann).creatures["goblin warrior"].firstAt, yields: [] });
  assert.equal(book(w.bob), undefined, "Bob was not in that combat");
  await startCombat(w.ann, w.bob, goblin);                       // another combat with the same creature
  assert.equal(Object.keys(book(w.ann).creatures).length, 1, "no duplicate");
  assert.deepEqual(Object.keys(book(w.bob).creatures), ["goblin warrior"], "Bob has it now");
  const wolf = await npc("Dire Wolf", ["animal"]);
  await startCombat(w.ann, wolf);
  assert.deepEqual(Object.keys(book(w.ann).creatures).sort(), ["dire wolf", "goblin warrior"]);
  assert.equal(book(w.ann).creatures["dire wolf"].type, "animal");
  const odd = await npc("Strange Thing", ["weird"]);
  await startCombat(w.ann, odd);
  assert.equal(book(w.ann).creatures["strange thing"].type, "creature", "no known creature type: stated as a plain 'creature', not a placeholder");
});

test("CREATURE: only a combat with a creature makes an entry (characters alone, or a character-only fight, make none)", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  await startCombat(w.ann, w.bob);
  assert.equal(book(w.ann), undefined);
  assert.equal(book(w.bob), undefined);
});

test("CREATURE: its yield stays LOCKED (nothing shown) until the character takes it from one of its corpses; then it is recorded on that creature", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const goblin = await npc("Goblin Warrior", ["humanoid"]);
  await startCombat(w.ann, goblin);
  const before = api().compendium.view(w.ann).entries.creatures[0];
  assert.deepEqual(before.yields, []);
  assert.doesNotMatch(JSON.stringify(api().compendium.view(w.ann)), /\?\?\?|locked/i);

  // A hand-made corpse that remembers who it was.
  const [corpseToken] = await w.table.createEmbeddedDocuments("Token", [{ name: "Goblin Corpse", x: 300, y: 300, actorId: "corpse-actor", flags: {} }]);
  await as(w.gm, () => api().makeCorpseNode(corpseToken, { tier: 1, charges: 2, decayTimer: 3, creature: { name: "Goblin Warrior", type: "humanoid" }, ladder: [{ materialId: "iron", dcOffset: 0, quantity: "1", guaranteed: true }] }));
  assert.deepEqual(corpseToken.getFlag(M, "node").creature, { name: "Goblin Warrior", type: "humanoid" });
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "gather", { sceneId: w.table.id, tokenId: corpseToken.id, skill: "survival" }));
  await resolve(w.ann, action.id);
  assert.deepEqual(book(w.ann).creatures["goblin warrior"].yields, [{ materialId: "iron", name: "Iron" }], "now recorded");
  assert.deepEqual(api().compendium.view(w.ann).entries.creatures[0].yields, [{ materialId: "iron", name: "Iron" }]);
  assert.equal(book(w.bob), undefined, "someone who was not there learns nothing");
  assert.deepEqual(api().audit.scan(), []);
});

test("CREATURE: a corpse node cannot be given a half-made creature identity", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  const [t] = await w.table.createEmbeddedDocuments("Token", [{ name: "Corpse", x: 1, y: 1, actorId: "a", flags: {} }]);
  await assert.rejects(as(w.gm, () => api().makeCorpseNode(t, { tier: 1, charges: 1, decayTimer: 1, creature: { name: "Goblin" }, ladder: [{ materialId: "iron", dcOffset: 0, quantity: "1", guaranteed: true }] })), /creature must be \{ name: "Goblin Warrior", type: "humanoid" \}/);
});

// REGIONS -------------------------------------------------------------------------------------------------------------------
test("REGION: exploring it makes the entry once; the node types found while searching are added, only the ones spotted", async () => {
  const w = await world({ iron: 0, fang: 0 });
  await as(w.gm, () => api().tagScene(w.table, "oak-wood"));
  await as(w.gm, () => api().placeAnchors(8, { scene: w.table }));
  const explore = () => as(w.annUser, () => api().queue.submit(w.ann, "explore", { region: "oak-wood", skill: "survival" }, 2));
  const first = await explore();
  await resolve(w.ann, first.id);
  assert.deepEqual(book(w.ann).regions["oak-wood"], { id: "oak-wood", name: "Oak Wood", firstAt: book(w.ann).regions["oak-wood"].firstAt, nodeTypes: [] }, "just the region: nothing found yet");
  const again = await explore();
  await resolve(w.ann, again.id);
  assert.equal(Object.keys(book(w.ann).regions).length, 1, "no duplicate");

  canvas.scene = w.table;
  w.ann.perceptionRolls.push({ total: 60, dice: [{ faces: 20, results: [{ result: 15, active: true }] }], options: {} });
  const found = await as(w.annUser, () => api().searchArea(w.ann));
  assert.ok(found.spotted.length >= 1, "something was spotted");
  const types = book(w.ann).regions["oak-wood"].nodeTypes;
  assert.ok(types.length >= 1 && types.every(t => ["herb", "ore", "salvage"].includes(t.id)), JSON.stringify(types));
  assert.equal(book(w.bob), undefined);
});

// PRIVACY AND THE GM -----------------------------------------------------------------------------------------------------
test("PRIVACY: view() gives a character their own entries; another player is refused by the API; the GM sees everything", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  await api().giveMaterial(w.ann, "silver", 1);
  await api().giveMaterial(w.bob, "iron", 1);
  const own = as(w.annUser, () => api().compendium.view(w.ann));
  assert.deepEqual(own.entries.materials.map(m => m.id), ["silver"]);
  assert.equal(own.entries.materials[0].source, "own");
  assert.throws(() => as(w.bobUser, () => api().compendium.view(w.ann)), /^Error: You can only read the Compendium of a character you own\.$/);
  assert.throws(() => as(w.annUser, () => api().compendium.all()), /GM only/);
  const all = as(w.gm, () => api().compendium.all());
  assert.deepEqual(all.characters.map(c => [c.name, c.counts]).sort(), [["Ann", { materials: 1, creatures: 0, regions: 0 }], ["Bob", { materials: 1, creatures: 0, regions: 0 }]]);
  assert.deepEqual(all.characters.find(c => c.name === "Bob").materials.map(m => m.id), ["iron"]);
  assert.deepEqual(as(w.gm, () => api().compendium.view(w.bob)).entries.materials.map(m => m.id), ["iron"], "a GM may read anyone's");
});

test("FORMULAE: usedIn is worked out from the formulae the character knows, never stored; hasMaterial answers for the future crafting rule", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  await api().giveMaterial(w.ann, "iron", 1);
  await api().giveMaterial(w.bob, "iron", 1);
  await api().grantFormula(w.ann, "dagger-spider-fang");
  const ann = as(w.annUser, () => api().compendium.view(w.ann)).entries.materials[0];
  assert.deepEqual(ann.usedIn, [{ recipeId: "dagger-spider-fang", name: "Spider Fang Dagger" }]);
  assert.deepEqual(as(w.bobUser, () => api().compendium.view(w.bob)).entries.materials[0].usedIn, [], "Bob knows no formula");
  assert.equal(JSON.stringify(book(w.ann)).includes("usedIn"), false, "not stored");
  assert.equal(api().compendium.hasMaterial(w.ann, "iron"), true);
  assert.equal(api().compendium.hasMaterial(w.ann, "silver"), false);
});

// ESCROW RETURNS ----------------------------------------------------------------------------------------------------------------
test("ESCROW RETURN: handing escrow back records nothing new for a known material, but never leaves an unrecorded one unrecorded", async () => {
  const w = await world({ iron: 1, fang: 1 });                  // exactly what a craft needs: the stacks are emptied, then recreated
  const writes = countWrites(w.ann);
  const action = await craft(w);
  await as(w.annUser, () => api().queue.cancel(w.ann, action.id));
  assert.equal(writes(), 0, "both materials were already recorded: the return wrote nothing to the Compendium");
  assert.deepEqual(Object.keys(book(w.ann).materials).sort(), ["iron", "spider-fang"]);

  // A stash that pre-dates the Compendium (nothing recorded yet) is recorded when the module hands it back.
  const w2 = await world({ iron: 1, fang: 1 });
  await w2.ann.update({ [`flags.${M}.compendium`]: new (globalThis.foundry.data.operators.ForcedDeletion)() });
  assert.equal(book(w2.ann), undefined);
  const action2 = await craft(w2);
  await as(w2.annUser, () => api().queue.cancel(w2.ann, action2.id));
  assert.deepEqual(Object.keys(book(w2.ann).materials).sort(), ["iron", "spider-fang"], "the returned materials were the character's: now recorded");
  assert.deepEqual(measure(w2.ann).stash, { iron: 1, "spider-fang": 1 });
});

test("ESCROW RETURN: an operation that fails and is undone records nothing", async () => {
  const w = await world({ iron: 1, fang: 1 });
  await w.ann.update({ [`flags.${M}.compendium`]: new (globalThis.foundry.data.operators.ForcedDeletion)() });
  const action = await craft(w);
  const before = snapshot(w);
  env.ops = 0; env.failAt = 3;
  await assert.rejects(as(w.annUser, () => api().queue.cancel(w.ann, action.id)));
  env.failAt = null;
  assert.equal(snapshot(w), before, "nothing changed, the Compendium included");
  assert.equal(book(w.ann), undefined);
});

// SHARING ------------------------------------------------------------------------------------------------------------------------
const share = (w, user, actor, params, days) => as(user, () => api().queue.submit(actor, "share", params, days));
const shared = () => (env.values.sharedCompendium ?? { materials: {} });

async function withIron(w) {
  await api().giveMaterial(w.ann, "iron", 1);
  await api().giveMaterial(w.bob, "silver", 1);
  return w;
}

test("SHARE: private by default; sharing queues an item (0 days, no downtime) that the owner can cancel; the GM approves and the party can read it", async () => {
  const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
  assert.deepEqual(as(w.bobUser, () => api().compendium.view(w.bob)).entries.materials.map(m => m.id), ["silver"], "private: Bob does not see Ann's iron");
  const action = await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  assert.deepEqual([action.type, action.daysReserved, action.params.name], ["share", 0, "Iron"]);
  assert.equal(api().downtime.isOpen(), false, "no downtime was needed");
  const [row] = api().queue.list();
  assert.equal(row.label, "Share: Iron (material)");
  assert.match(row.detail, /0 place\(s\), 0 ladder rung\(s\); no days, no downtime needed; approve to share with the party/);
  assert.equal(row.problem, null);
  assert.ok(events().includes("queued share: Iron (material) from Ann"));
  assert.deepEqual(shared().materials, {}, "still private while it waits");

  // cancel while waiting
  await as(w.annUser, () => api().queue.cancel(w.ann, action.id));
  assert.deepEqual(pendingOf(w.ann), []);
  assert.deepEqual(shared().materials, {});
  assert.ok(events().includes("share cancelled by Ann: Share: Iron (material) for Ann"), events().join(" | "));

  // queue again and approve through Resolve all
  await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  const batch = await api().queue.resolveAll({ chat: true });
  assert.equal(batch.results[0].status, "resolved");
  assert.match(batch.results[0].message, /approved: Iron \(material\) is now shared with the party/);
  assert.deepEqual(Object.keys(shared().materials), ["iron"]);
  assert.ok(events().some(t => /^share approved: Iron \(material\) from Ann$/.test(t)));
  const bobView = as(w.bobUser, () => api().compendium.view(w.bob)).entries.materials;
  assert.deepEqual(bobView.map(m => [m.id, m.source]), [["iron", "shared"], ["silver", "own"]]);
  assert.deepEqual(as(w.annUser, () => api().compendium.view(w.ann)).entries.materials.map(m => [m.id, m.source]), [["iron", "both"]]);
  assert.equal(api().compendium.hasMaterial(w.bob, "iron"), true, "shared counts as discovered for the party");
  assert.ok(env.chat.every(m => Array.isArray(m.whisper)), "only whispers");
  assert.deepEqual(api().audit.scan(), []);
});

test("SHARE: a GM rejection leaves the entry private and says so in the log", async () => {
  const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
  const action = await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  const result = await as(w.gm, () => api().queue.reject(w.ann, action.id, { chat: false }));
  assert.deepEqual(result, { refunded: 0 });
  assert.deepEqual(pendingOf(w.ann), []);
  assert.deepEqual(shared().materials, {});
  assert.deepEqual(as(w.bobUser, () => api().compendium.view(w.bob)).entries.materials.map(m => m.id), ["silver"]);
  assert.ok(events().includes("share rejected by the GM: Share: Iron (material) for Ann"), events().join(" | "));
});

test("SHARE: it shares the facts as they were when it was queued, merged additively; a creature and a region can be shared too", async () => {
  const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
  const goblin = await npc("Goblin Warrior", ["humanoid"]);
  await startCombat(w.ann, goblin);
  const queued = await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  const { token } = await herb(w, { nodeType: "ore", region: "oak-wood", charges: 2 });
  const gather = await as(w.annUser, () => api().queue.submit(w.ann, "gather", { sceneId: w.table.id, tokenId: token.id, skill: "athletics" }));
  await resolve(w.ann, gather.id);                              // adds a place AFTER the share was queued
  assert.equal(book(w.ann).materials.iron.places.length, 1);
  await resolve(w.ann, queued.id);
  assert.deepEqual(shared().materials.iron.places, [], "the later place is not shared: only what was queued");
  await share(w, w.annUser, w.ann, { kind: "creature", key: "goblin warrior" });
  await api().queue.resolveAll({ chat: false });
  assert.deepEqual(Object.keys(shared().creatures), ["goblin warrior"]);
  assert.deepEqual(shared().creatures["goblin warrior"].yields, [], "no yield: Ann has not collected one");
  const again = await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });   // now there is something new to share
  await resolve(w.ann, again.id);
  assert.equal(shared().materials.iron.places.length, 1);
});

test("SHARE: it never blocks End downtime and stays queued through a forced end", async () => {
  const w = await withIron(await world({ iron: 0, fang: 0 }));
  await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  const ended = await api().downtime.end();
  assert.deepEqual([ended.ended, ended.rejected], [true, 0]);
  assert.equal(pendingOf(w.ann).length, 1, "still waiting for the GM");
  const w2 = await withIron(await world({ iron: 0, fang: 0 }));
  await share(w2, w2.annUser, w2.ann, { kind: "material", key: "iron" });
  await craft(w2, w2.bobUser, w2.bob).catch(() => {});
  const forced = await api().downtime.end({ force: true });
  assert.equal(forced.ended, true);
  assert.equal(pendingOf(w2.ann).length, 1);
});

test("SHARE refusals reach a player as the real plain message and change nothing", async () => {
  const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
  const before = snapshot(w);
  const refused = async (call, message) => assert.rejects(call(), e => e.message === message && !/exception occured/.test(e.message), message);
  await refused(() => share(w, w.annUser, w.ann, { kind: "material", key: "silver" }), "Ann has not discovered that yet, so there is nothing to share.");
  await refused(() => share(w, w.annUser, w.ann, { kind: "spell", key: "x" }), 'share: say what to share: kind must be one of material, creature, region (got "spell")');
  await refused(() => share(w, w.annUser, w.ann, { kind: "material" }), "share: say which entry (its id, or for a creature its key)");
  await refused(() => share(w, w.annUser, w.ann, { kind: "material", key: "iron" }, 2), "share: sharing costs no days (got 2); leave days out");
  await refused(() => share(w, w.bobUser, w.ann, { kind: "material", key: "iron" }), "submit: you do not own Ann");
  assert.equal(snapshot(w), before);
  const queued = await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  await refused(() => share(w, w.annUser, w.ann, { kind: "material", key: "iron" }), "Iron is already waiting for the GM to approve sharing it.");
  await refused(() => as(w.bobUser, () => api().queue.cancel(w.ann, queued.id)), "cancel: Bob does not own Ann");
  await resolve(w.ann, queued.id);
  await refused(() => share(w, w.annUser, w.ann, { kind: "material", key: "iron" }), "Everything Ann knows about Iron is already shared with the party.");
  assert.deepEqual(env.handlerThrows, []);
});

test("SHARE: fault injection on queue, cancel and approve: nothing is left half-done", async () => {
  const build = async queued => {
    const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
    if (queued) w.action = await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
    env.ops = 0;
    return w;
  };
  await everyFailureLeavesNothingHalfDone("queue a share", () => build(false), w => share(w, w.annUser, w.ann, { kind: "material", key: "iron" }), 2);
  await everyFailureLeavesNothingHalfDone("cancel a share", () => build(true), w => as(w.annUser, () => api().queue.cancel(w.ann, w.action.id)), 2);
  await everyFailureLeavesNothingHalfDone("approve a share", () => build(true), w => resolve(w.ann, w.action.id), 3);
});

test("SHARE: the shared Compendium and every book stay schema-valid through all of it", async () => {
  const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
  await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  await api().queue.resolveAll({ chat: false });
  const { check } = await import("../scripts/data/schema.js");
  const { LIVE_SCHEMAS } = await import("../scripts/data/schemas.js");
  for (const b of [book(w.ann), book(w.bob), env.values.sharedCompendium]) assert.deepEqual(check(LIVE_SCHEMAS.compendium, b), []);
  void getUsers; void listeners; void makeToken; void quietly; void GENERIC_FAILURE;
});

test("SHARE: a character no player owns (outside the party) never sees the shared entries, even through the GM's view", async () => {
  const w = await withIron(await world({ downtime: 0, iron: 0, fang: 0 }));
  await share(w, w.annUser, w.ann, { kind: "material", key: "iron" });
  await api().queue.resolveAll({ chat: false });
  const stranger = makeActor("Stranger", { owners: [] });
  game.actors.push(stranger);
  assert.deepEqual(as(w.gm, () => api().compendium.view(stranger)).entries.materials, []);
  assert.equal(api().compendium.hasMaterial(stranger, "iron"), false);
});
