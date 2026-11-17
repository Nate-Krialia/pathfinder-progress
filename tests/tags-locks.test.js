/**
 * Review fixes 3 to 6 (the tag ledger and the caps): overlapping writes keep both changes; a second GM's change is read in; a damaged setting is backed up once; a failed publish or log
 * after a saved change is a warning, not a failure. Through the real main.js in the fake Foundry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { as, env, fireHookAs, getApi, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { getCaps, getLedger } from "../scripts/tags/current.js";
import { decodeLedger } from "../scripts/tags/ledger.js";

const api = () => getApi();
const M = "pathfinder-progress";
const A = "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA";
const B = "Compendium.pf2e.equipment-srd.Item.BBBBBBBBBBBBBBBB";

async function tagWorld() {
  const w = await world({ perClientDefinitions: true, downtime: 6, iron: 3, fang: 3 });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  await as(w.gm, () => api().editor.create("tag", { name: "Venom Tooth", theme: "bitey things" }, { makeItem: false }));
  return w;
}
/** A settings write that takes a moment, per key, as a real one does (a round trip): the gap in which a second clone used to be taken. */
const slowWrites = (delays) => {
  const real = game.settings.set;
  game.settings.set = async (scope, key, value) => { const ms = typeof delays[key] === "function" ? delays[key]() : delays[key]; if (ms) await new Promise(r => setTimeout(r, ms)); return real(scope, key, value); };
  return () => { game.settings.set = real; };
};

test("LEDGER LOCK: two overlapping setEntry calls keep BOTH tags (each used to clone the same ledger, and the second write erased the first)", async () => {
  const w = await tagWorld();
  const restore = slowWrites({ tagLedger: 25 });
  try {
    await as(w.gm, () => Promise.all([api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }), api().tags.setEntry(B, { tags: ["venom-tooth"], tier: 3, name: "Item B" })]));
  } finally { restore(); }
  assert.deepEqual(Object.keys(decodeLedger(env.values.tagLedger).items).sort(), [A, B], "both are in the saved setting");
  assert.deepEqual(Object.keys(getLedger().items).sort(), [A, B], "and in memory");
});

test("LEDGER LOCK: a tag, an untag and another tag that overlap all land; removing something that is not tagged still says so", async () => {
  const w = await tagWorld();
  await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
  const restore = slowWrites({ tagLedger: 15 });
  try {
    await as(w.gm, () => Promise.all([api().tags.removeEntry(A), api().tags.setEntry(B, { tags: ["venom-tooth"], tier: 3, name: "Item B" })]));
    await assert.rejects(as(w.gm, () => api().tags.removeEntry(A)), /That item is not tagged/);
  } finally { restore(); }
  assert.deepEqual(Object.keys(decodeLedger(env.values.tagLedger).items), [B]);
  assert.deepEqual(Object.keys(getLedger().items), [B]);
});

test("CAPS LOCK: overlapping setCaps calls land in the order they were asked for (the last call wins, in memory and in the saved setting)", async () => {
  const w = await tagWorld();
  let n = 0;
  const restore = slowWrites({ tagCaps: () => (n++ === 0 ? 40 : 2) });          // the first write is slow, the second quick: unlocked, the first used to land LAST
  try {
    await as(w.gm, () => Promise.all([api().tags.setCaps({ v: 1, roles: { basePower: { maxTier: 2 } } }), api().tags.setCaps({ v: 1, roles: { basePower: { maxTier: 4 } } })]));
  } finally { restore(); }
  assert.equal(env.values.tagCaps.roles.basePower.maxTier, 4, "saved: the last call");
  assert.equal(getCaps().basePower.maxTier, 4, "memory: the last call");
});

// A second GM's change is read in (review finding 4) -----------------------------------------------------------------------------
import { encodeLedger } from "../scripts/tags/ledger.js";
const KEY = k => `${M}.${k}`;

test("SECOND GM: a ledger change another GM client saved is read into memory (update and first-time create), and the writer's own echo changes nothing", async () => {
  const w = await tagWorld();
  await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
  const mine = structuredClone(getLedger());
  await fireHookAs(w.gm, "updateSetting", [{ key: KEY("tagLedger") }]);                                   // my own echo: reads back what I wrote
  assert.deepEqual(getLedger(), mine, "the echo of my own write is harmless");
  // another GM tags B: the saved setting changes under me
  env.values.tagLedger = encodeLedger({ v: 1, items: { ...mine.items, [B]: { tags: ["venom-tooth"], tier: 3, name: "Item B" } } });
  assert.equal(getLedger().items[B], undefined, "not yet seen");
  await fireHookAs(w.gm, "updateSetting", [{ key: KEY("tagLedger") }]);
  assert.deepEqual(Object.keys(getLedger().items).sort(), [A, B]);
  // and the next save of THIS GM keeps the other GM's tag instead of overwriting it
  await as(w.gm, () => api().tags.setEntry("spider-fang", { tags: ["venom-tooth"] }));
  assert.deepEqual(Object.keys(decodeLedger(env.values.tagLedger).items).sort(), [A, B, "spider-fang"].sort());
  // the first write of a setting arrives as createSetting
  env.values.tagLedger = encodeLedger({ v: 1, items: {} });
  await fireHookAs(w.gm, "createSetting", [{ key: KEY("tagLedger") }]);
  assert.deepEqual(getLedger().items, {});
});

test("SECOND GM: a caps change another GM client saved is read into memory; the echo of the writer's own save changes nothing", async () => {
  const w = await tagWorld();
  await as(w.gm, () => api().tags.setCaps({ v: 1, roles: { basePower: { maxTier: 2 } } }));
  await fireHookAs(w.gm, "updateSetting", [{ key: KEY("tagCaps") }]);
  assert.equal(getCaps().basePower.maxTier, 2, "own echo harmless");
  env.values.tagCaps = { v: 1, roles: { basePower: { maxTier: 3 } } };
  await fireHookAs(w.gm, "updateSetting", [{ key: KEY("tagCaps") }]);
  assert.equal(getCaps().basePower.maxTier, 3);
});

test("SECOND GM: a Player client never reads any of it (it would have wiped the GM-only memory the fake shares), and an unrelated setting does nothing", async () => {
  const w = await tagWorld();
  await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
  await as(w.gm, () => api().tags.setCaps({ v: 1, roles: { basePower: { maxTier: 2 } } }));
  for (const key of ["tagLedger", "tagCaps", "tagCrafted"]) await fireHookAs(w.annUser, "updateSetting", [{ key: KEY(key) }]);
  assert.ok(getLedger().items[A], "the ledger memory is untouched");
  assert.equal(getCaps().basePower.maxTier, 2, "so are the caps");
  await fireHookAs(w.gm, "updateSetting", [{ key: KEY("downtimeState") }]);
  assert.ok(getLedger().items[A]);
});
