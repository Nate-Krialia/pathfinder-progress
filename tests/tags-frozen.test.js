/**
 * Tag system, Slice 2b through the real main.js in the fake Foundry: a craft with tagged slots freezes what it was made of and what it stacked to in a GM-only store; the effects engine
 * reads that frozen result, so editing a tag, the ledger or the caps later cannot change an item that exists; the record goes when its item goes; a missing record is a quiet fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, as, craft, env, fireHookAs, getApi, resolve, world } from "./fake-world.js";
import { asPage, findCanaries, findTagLeaks, seedRecords } from "./helpers.js";
import { effectsOf } from "../scripts/effects/resolve.js";
import { getFrozenStore, setCurrentFrozen } from "../scripts/tags/current.js";
import { emptyFrozen } from "../scripts/tags/frozen.js";

const api = () => getApi();
const TOOTH = "Compendium.pf2e.equipment-srd.Item.TTTTTTTTTTTTTTTT";
const FRIGHT = { byTier: { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 } };

async function frozenWorld({ caps } = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 5, fang: 3 });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  await w.ann.createEmbeddedDocuments("Item", [{ name: "Wolf Tooth", type: "equipment", system: { quantity: 4 }, flags: { core: { sourceId: TOOTH } } }]);
  await as(w.gm, async () => {
    await api().editor.create("tag", { name: "Venom Tooth", theme: "bitey", effectBlocks: { byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: FRIGHT, save: "will" }, { type: "damage", dice: { all: "1d4" }, damageType: "poison" }] } } } }, { makeItem: false });
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 3, name: "Wolf Tooth" });
    const recipe = api().definitions.recipe.get(DAGGER);
    const slots = recipe.slots.map(s => (s.name === "fang" ? { ...s, drives: ["bonusDamage", "specialAbility", "applyCondition"], needs: { all: ["venom-tooth"] } } : s));
    await api().editor.update(`recipe:${DAGGER}`, { slots }, { confirmed: true });
    if (caps) await api().tags.setCaps(caps);
  });
  return w;
}
const craftIt = async (w, selection = { blade: "iron", fang: TOOTH }) => {
  const queued = await craft(w, w.annUser, w.ann, { selection });
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const items = w.ann.items.filter(i => i.getFlag(M, "crafted"));
  return items.at(-1);
};
const conds = (flag, w) => as(w.gm, () => effectsOf(flag, api().definitions).effects.map(e => `${e.condition} ${e.value}`));

test("FROZEN: a craft with a tagged slot stores what it was made of in the GM-only store; the item carries only an opaque id", async () => {
  const w = await frozenWorld();
  const made = await craftIt(w);
  const flag = made.getFlag(M, "crafted");
  assert.equal(typeof flag.freezeId, "string"); assert.ok(flag.freezeId.length >= 2 && !/venom|tooth|frightened/i.test(flag.freezeId), "an opaque id");
  const rec = env.values.tagCrafted.items[flag.freezeId];
  assert.equal(rec.recipeId, DAGGER);
  assert.deepEqual(rec.uses.map(u => [u.slot, u.ref, u.name, u.tier, u.tags]), [["fang", TOOTH, "Wolf Tooth", 3, ["venom-tooth"]]]);
  assert.deepEqual(rec.roles.applyCondition, [{ condition: "frightened", value: 2, save: "will" }]);
  assert.ok(!JSON.stringify(flag).includes("venom-tooth") && !JSON.stringify(flag).includes("frightened"), "the item's flag holds no tag, tier or effect");
  assert.deepEqual(await conds(flag, w), ["frightened 2"]);
});
test("FROZEN: a craft with NO tagged slot freezes nothing and gets no id (old items work as before)", async () => {
  const w = await world({ perClientDefinitions: true, downtime: 6, iron: 3, fang: 3 });
  const queued = await craft(w, w.annUser, w.ann, {});
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const made = w.ann.items.find(i => i.getFlag(M, "crafted"));
  assert.equal(made.getFlag(M, "crafted").freezeId, undefined);
  assert.equal(env.values.tagCrafted, undefined);
});
test("FROZEN: editing the tag, the ledger and the caps AFTER the craft does not change the item (a new craft shows the new numbers)", async () => {
  const w = await frozenWorld();
  const made = await craftIt(w);
  const flag = made.getFlag(M, "crafted");
  assert.deepEqual(await conds(flag, w), ["frightened 2"]);
  await as(w.gm, async () => {
    await api().editor.update("tag:venom-tooth", { effectBlocks: { byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: { all: 4 }, save: "fortitude" }] } } } }, { confirmed: true });
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 5, name: "Wolf Tooth" });
    await api().tags.setCaps({ v: 1, roles: { applyCondition: { maxValue: 1 } } });
  });
  assert.deepEqual(await conds(flag, w), ["frightened 2"], "the old item is exactly as it was crafted");
  const second = await craftIt(w);
  assert.deepEqual(await conds(second.getFlag(M, "crafted"), w), ["frightened 1"], "a new craft uses the new tag, tier and cap (value 4, capped at 1)");
});
test("PRE-SLICE ITEMS: a crafted item with no freeze id keeps being worked out live, as before", async () => {
  const w = await frozenWorld();
  const made = await craftIt(w);
  const old = { ...made.getFlag(M, "crafted") }; delete old.freezeId;
  assert.deepEqual(await conds(old, w), ["frightened 2"]);
  await as(w.gm, () => api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 5, name: "Wolf Tooth" }));
  assert.deepEqual(await conds(old, w), ["frightened 3"], "live: it follows the ledger (tier 5 gives 4, the default cap of 3 clamps it)");
  assert.deepEqual(await conds(made.getFlag(M, "crafted"), w), ["frightened 2"], "frozen: it does not");
});
test("MISSING RECORD: the item's tag effects are skipped, nothing throws, and the GM is told once", async () => {
  const w = await frozenWorld();
  const made = await craftIt(w);
  const flag = made.getFlag(M, "crafted");
  setCurrentFrozen(emptyFrozen());
  assert.deepEqual(await conds(flag, w), []);
  assert.deepEqual(await conds(flag, w), []);
  const log = await as(w.gm, () => api().gm.log());
  const told = log.filter(e => /no frozen tag result any more/.test(e.text));
  assert.equal(told.length, 1, "told once, not on every use");
});
test("CLEANUP: deleting the crafted item removes its frozen result; another copy keeps it alive until the last one goes", async () => {
  const w = await frozenWorld();
  const made = await craftIt(w);
  const id = made.getFlag(M, "crafted").freezeId;
  await w.bob.createEmbeddedDocuments("Item", [{ name: "Copy", type: "weapon", system: {}, flags: { [M]: { crafted: made.getFlag(M, "crafted") } } }]);
  await made.delete();
  await fireHookAs(w.gm, "deleteItem", [made]);
  assert.ok(env.values.tagCrafted.items[id], "the copy on another actor still carries the id");
  const copy = w.bob.items.find(i => i.getFlag(M, "crafted"));
  await copy.delete();
  await fireHookAs(w.gm, "deleteItem", [copy]);
  assert.equal(env.values.tagCrafted.items[id], undefined, "the last copy is gone: so is the record");
});
test("CLEANUP: only the ACTIVE GM client acts, and an item with no freeze id is ignored", async () => {
  const w = await frozenWorld();
  const made = await craftIt(w);
  const id = made.getFlag(M, "crafted").freezeId;
  await made.delete();
  await fireHookAs(w.annUser, "deleteItem", [made]);
  assert.ok(env.values.tagCrafted.items[id], "a player client never removes a record");
  await fireHookAs(w.gm, "deleteItem", [{ id: "x", getFlag: () => undefined }]);
  assert.ok(env.values.tagCrafted.items[id]);
  // a GM client that is not the ACTIVE GM leaves it to the one that is (two GMs must not both write)
  const real = game.users.activeGM;
  game.users.activeGM = w.annUser;
  await fireHookAs(w.gm, "deleteItem", [made]);
  assert.ok(env.values.tagCrafted.items[id], "a second GM client did not act");
  game.users.activeGM = real;
  await fireHookAs(w.gm, "deleteItem", [made]);
  assert.equal(env.values.tagCrafted.items[id], undefined, "the active GM did");
});
test("PRUNE: pruneFrozen removes only the records no item carries any more, and only a GM may run it", async () => {
  const w = await frozenWorld();
  const kept = await craftIt(w);
  const gone = await craftIt(w);
  await gone.delete();                                           // the hook is missed (say, an actor was deleted with it)
  const [keepId, goneId] = [kept, gone].map(i => i.getFlag(M, "crafted").freezeId);
  await assert.rejects(as(w.annUser, () => api().tags.pruneFrozen()), /tags\.pruneFrozen: GM only/);
  const r = await as(w.gm, () => api().tags.pruneFrozen());
  assert.deepEqual(r.removed, [goneId]);
  assert.ok(env.values.tagCrafted.items[keepId]); assert.equal(env.values.tagCrafted.items[goneId], undefined);
  assert.deepEqual((await as(w.gm, () => api().tags.pruneFrozen())).removed, [], "nothing left to prune");
  await assert.rejects(as(w.annUser, async () => api().tags.frozen(keepId)), /tags\.frozen: GM only/);
});
test("ROLLBACK: if the item cannot be created, the frozen result is undone with everything else", async () => {
  const w = await frozenWorld();
  const queued = await craft(w, w.annUser, w.ann, { selection: { blade: "iron", fang: TOOTH } });
  const original = w.ann.createEmbeddedDocuments;
  w.ann.createEmbeddedDocuments = async (type, data) => { if (data.some(d => d.flags?.[M]?.crafted)) throw new Error("the item could not be created"); return original(type, data); };
  await assert.rejects(as(w.gm, () => resolve(w.ann, queued.id, { chat: true })), /could not be created/);
  w.ann.createEmbeddedDocuments = original;
  assert.deepEqual(Object.keys(getFrozenStore().items), [], "no orphan record");
  assert.deepEqual(Object.keys(env.values.tagCrafted?.items ?? {}), []);
});
test("STORE: a damaged frozen setting is reported and read as empty; a player client never loads it", async () => {
  const w = await frozenWorld();
  const { loadFrozen } = await import("../scripts/tags/state.js");
  env.values.tagCrafted = { v: 9, items: {} };
  assert.match((await as(w.gm, async () => loadFrozen())).problems[0], /unknown shape/);
  assert.deepEqual(getFrozenStore().items, {});
  env.values.tagCrafted = { v: 1, items: { x: { recipeId: "r", roles: {} } } };
  await as(w.annUser, async () => loadFrozen());
  assert.deepEqual(getFrozenStore().items, {}, "a player client holds nothing");
});

// Players and the canaries (Slice 2b) ----------------------------------------------------------------------------------------------
const K = ["CANARY-KIND", "8d12", "9d10", '"tagOverrides"', '"bySlot"', '"contributions"', "tagCrafted", "CANARY-KIND ability text", "effectBlocks", "byTier", '"needs"'];
const text = x => JSON.stringify(x, (k, v) => (v instanceof Map ? [...v.values()] : v instanceof Set ? [...v] : v));

test("S2b CANARIES: slot kinds, overrides, tier tables and the frozen result reach nothing a player can read", async () => {
  const w = await frozenWorld();
  await as(w.gm, async () => {
    await api().tags.setSlotKind(DAGGER, "fang", "canary-kind-decoration");
    await api().editor.update("tag:venom-tooth", { effectBlocks: { byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: FRIGHT, save: "will" }, { type: "damage", dice: { all: "1d4" }, damageType: "poison" }] } }, bySlot: { "canary-kind-decoration": { general: { blocks: [{ type: "damage", dice: { byTier: { 1: "1d4", 2: "1d4", 3: "1d6", 4: "8d12", 5: "9d10" } }, damageType: "fire" }] } } } } }, { confirmed: true });
    await api().tags.setTagOverride(DAGGER, "venom-tooth", "canary-kind-decoration", { blocks: [{ type: "ability", title: "Override", text: "CANARY-KIND ability text" }] });
  });
  await as(w.annUser, () => api().definitions.refresh());
  const registry = await as(w.annUser, () => api().definitions);
  const slot = registry.recipe.get(DAGGER).slots.find(s => s.name === "fang");
  assert.equal("kind" in slot, false, "a player's slot has no kind"); assert.equal(registry.recipe.get(DAGGER).tagOverrides, undefined);
  const preview = await as(w.annUser, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: TOOTH }, "oakhaven-forge"));
  assert.ok(preview.ok, preview.errors?.join(" | "));
  const queued = await craft(w, w.annUser, w.ann, { selection: { blade: "iron", fang: TOOTH } });
  const rows = await as(w.annUser, () => api().queue.list([w.ann]));
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const made = w.ann.items.find(i => i.getFlag(M, "crafted"));
  const payloads = {
    definitions: text(registry), preview: text(preview), queue: text(rows), compendium: text(await as(w.annUser, () => api().compendium.view(w.ann))),
    actorFlags: text(w.ann.rawFlags()), itemFlags: text(made.flags[M]), chat: text(env.chat)
  };
  const hits = findCanaries(payloads, K);
  assert.deepEqual(hits, []);
  assert.deepEqual(findTagLeaks(registry, { neededTags: ["venom-tooth"] }), []);
  // the GM side really did hold them (so the scan above is not vacuous)
  const rec = env.values.tagCrafted.items[made.getFlag(M, "crafted").freezeId];
  assert.ok(JSON.stringify(rec).includes("Override"), "the frozen result holds the override's ability");
  assert.ok(JSON.stringify(env.values.editorDefinitions).includes("8d12"), "the GM store holds the canary tier table");
});
test("S2b CANARIES: the scan fails when a kind, an override or a frozen record is planted in a player payload", () => {
  const slot = { name: "fang", drives: "bonusDamage", tierFloor: 1, qty: 1 };
  assert.ok(findTagLeaks([{ data: { kind: "recipe", id: "r", slots: [{ ...slot, kind: "canary-kind-decoration" }] } }], {}).length >= 1, "a slot kind");
  assert.ok(findTagLeaks([{ data: { kind: "recipe", id: "r", slots: [slot], tagOverrides: [{ tag: "t" }] } }], {}).length >= 1, "an override");
  assert.ok(findTagLeaks([{ data: { kind: "tag", id: "t", bySlot: {} } }], {}).length >= 1, "a bySlot set");
  assert.ok(findCanaries({ flag: text({ freezeId: "abc", contributions: [] }) }, K).length >= 1, "a frozen record in a flag");
});
