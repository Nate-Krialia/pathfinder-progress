/**
 * Stage 1c #2 and #14: every write of the `discoveryTracks` overlay (api.discovery.tracks.set/clear, the editor's save, its fold and its leftover removal) takes ONE leaf lock around the
 * whole read-modify-write, and a damaged (non-object) overlay refuses writes instead of being read as empty and overwritten. Through the real main.js in the fake Foundry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { as, env, getApi, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";

const api = () => getApi();
const track = steps => ({ milestones: [{ steps, grants: { type: "properties" } }] });
async function overlayWorld() {
  const w = await world({ perClientDefinitions: true, downtime: 6, iron: 3, fang: 3 });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  await as(w.gm, () => api().definitions.refresh?.());
  return w;
}
const slowWrites = (ms, keys) => {
  const real = game.settings.set;
  game.settings.set = async (scope, key, value) => { if (keys.includes(key)) await new Promise(r => setTimeout(r, ms)); return real(scope, key, value); };
  return () => { game.settings.set = real; };
};
const overlayKeys = () => Object.keys(env.values.discoveryTracks ?? {}).sort();

test("OVERLAY LOCK: two overlapping api.discovery.tracks.set calls on different items keep both", async () => {
  const w = await overlayWorld();
  const restore = slowWrites(25, ["discoveryTracks"]);
  try {
    await as(w.gm, () => Promise.all([api().discovery.tracks.set("material:iron", track(3)), api().discovery.tracks.set("material:silver", track(4)), api().discovery.tracks.set("material:starmetal", track(5))]));
  } finally { restore(); }
  assert.deepEqual(overlayKeys(), ["material:iron", "material:silver", "material:starmetal"]);
});

test("OVERLAY LOCK: a track set while the editor FOLDS the overlay is not erased by the fold's write from its old read", async () => {
  const w = await overlayWorld();
  env.values.discoveryTracks = { "material:iron": track(3) };                 // an old overlay entry the fold will move into the editor's records
  const restore = slowWrites(40, ["editorDefinitions"]);                      // the fold reads, then waits on its save, then writes what is left
  try {
    const folding = as(w.gm, () => api().editor.foldOverlay());
    await new Promise(r => setTimeout(r, 10));                                // the fold is now inside its save
    const setting = as(w.gm, () => api().discovery.tracks.set("material:silver", track(4)));
    const [folded] = await Promise.all([folding, setting]);
    assert.deepEqual(folded.folded, ["material:iron"]);
  } finally { restore(); }
  assert.deepEqual(overlayKeys(), ["material:silver"], "iron moved to the editor; the track set meanwhile is still there");
});

test("OVERLAY LOCK: a set and an editor leftover removal that overlap keep what the other wrote", async () => {
  const w = await overlayWorld();
  env.values.discoveryTracks = { "material:ghost-a": track(2) };
  const restore = slowWrites(25, ["discoveryTracks"]);
  try {
    await as(w.gm, () => Promise.all([api().editor.clearLeftover("material:ghost-a"), api().discovery.tracks.set("material:iron", track(3))]));
  } finally { restore(); }
  assert.deepEqual(overlayKeys(), ["material:iron"]);
});

test("DAMAGED OVERLAY: a non-object value is kept once in the backup, every write is refused and the saved value is untouched; reading still works", async () => {
  const w = await overlayWorld();
  for (const damaged of ["not an object", ["material:iron"], 7]) {
    env.values.discoveryTracks = damaged;
    delete env.values.tagBackup;
    await quietly(async () => {
      await assert.rejects(as(w.gm, () => api().discovery.tracks.set("material:iron", track(3))), /saved research tracks are damaged/);
      await assert.rejects(as(w.gm, () => api().discovery.tracks.clear("material:iron")), /saved research tracks are damaged/);
      await assert.rejects(as(w.gm, () => api().editor.setTrack("material:iron", track(3))), /saved research tracks are damaged/);
      await assert.rejects(as(w.gm, () => api().editor.clearLeftover("material:gone")), /saved research tracks are damaged/);
      await assert.rejects(as(w.gm, () => api().editor.foldOverlay()), /saved research tracks are damaged/);
    });
    assert.deepEqual(env.values.discoveryTracks, damaged, `${JSON.stringify(damaged)} was not replaced`);
    assert.equal(typeof env.values.tagBackup?.overlay, "string", "a raw copy is kept once as a JSON string");
    assert.deepEqual(JSON.parse(env.values.tagBackup.overlay), damaged);
    assert.deepEqual(as(w.gm, () => api().discovery.tracks.overlay()), {}, "reading shows it as empty (no write can follow)");
  }
  env.values.discoveryTracks = {};
  await as(w.gm, () => api().discovery.tracks.set("material:iron", track(3)));
  assert.deepEqual(overlayKeys(), ["material:iron"], "a sound overlay writes again");
});
