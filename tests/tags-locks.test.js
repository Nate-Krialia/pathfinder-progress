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
