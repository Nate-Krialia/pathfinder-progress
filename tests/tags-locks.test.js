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

// A damaged setting is backed up once, then replaced as before (review finding 5) --------------------------------------------------
import { loadCaps, loadLedger } from "../scripts/tags/state.js";
const dotted = (value, path = "") => (value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [...(k.includes(".") ? [`${path}/${k}`] : []), ...dotted(v, `${path}/${k}`)]) : []);
const spyWarnings = () => { const lines = [], real = ui.notifications.warn; ui.notifications.warn = text => lines.push(text); return { lines, restore: () => { ui.notifications.warn = real; } }; };
const DAMAGED_LEDGER = { v: 1, items: { [A]: "not an entry", "Compendium.pf2e.equipment-srd.Item.CCCCCCCCCCCCCCCC": { tags: 7 } } };

test("DAMAGED LEDGER: kept once as a JSON string in the backup setting, one warning, loaded as empty; a save then replaces it; a second damaged load keeps the FIRST copy", async () => {
  const w = await tagWorld();
  const spy = spyWarnings();
  try {
    await quietly(async () => {
      env.values.tagLedger = structuredClone(DAMAGED_LEDGER);
      const first = await as(w.gm, async () => { const r = loadLedger(); await r.backedUp; return r; });
      assert.ok(first.problems.length, "it failed validation");
      assert.deepEqual(getLedger().items, {}, "loaded as empty, as before");
      assert.equal(typeof env.values.tagBackup.ledger, "string");
      assert.deepEqual(JSON.parse(env.values.tagBackup.ledger), DAMAGED_LEDGER, "the backup holds the original");
      assert.deepEqual(dotted(env.values.tagBackup), [], "no object key anywhere in the backup has a dot (the uuid is inside the string)");
      assert.equal(spy.lines.length, 1);
      assert.match(spy.lines[0], /tag ledger is damaged/);
      // saving a tag replaces the damaged ledger in the world, as before
      await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
      assert.deepEqual(Object.keys(decodeLedger(env.values.tagLedger).items), [A]);
      assert.deepEqual(JSON.parse(env.values.tagBackup.ledger), DAMAGED_LEDGER, "the backup still holds the original");
      // a second damaged load never replaces the backup
      env.values.tagLedger = { v: 1, items: { other: 3 } };
      const second = await as(w.gm, async () => { const r = loadLedger(); await r.backedUp; return r; });
      assert.deepEqual(await second.backedUp, { kept: false });
      assert.deepEqual(JSON.parse(env.values.tagBackup.ledger), DAMAGED_LEDGER, "the FIRST damaged value is still the one kept");
      assert.equal(spy.lines.length, 2, "one warning per damaged load");
    });
  } finally { spy.restore(); }
});

test("DAMAGED CAPS: the same, under its own key; the ledger's backup is untouched; a healthy load keeps nothing and says nothing", async () => {
  const w = await tagWorld();
  const spy = spyWarnings();
  try {
    await quietly(async () => {
      await as(w.gm, async () => { env.values.tagLedger = structuredClone(DAMAGED_LEDGER); await loadLedger().backedUp; });
      env.values.tagCaps = { v: 1, roles: { nonsense: { maxTier: 9 } } };
      const r = await as(w.gm, async () => { const x = loadCaps(); await x.backedUp; return x; });
      assert.ok(r.problems.length);
      assert.deepEqual(JSON.parse(env.values.tagBackup.caps), { v: 1, roles: { nonsense: { maxTier: 9 } } });
      assert.deepEqual(JSON.parse(env.values.tagBackup.ledger), DAMAGED_LEDGER, "the ledger backup is still there");
      assert.deepEqual(Object.keys(env.values.tagBackup).sort(), ["caps", "ledger"]);
      assert.equal(getCaps().basePower.maxTier, 5, "the defaults apply");
      const before = spy.lines.length;
      await as(w.gm, () => api().tags.setCaps({ v: 1, roles: { basePower: { maxTier: 2 } } }));
      const healthy = loadCaps();
      assert.equal(healthy.backedUp, undefined);
      assert.equal(spy.lines.length, before, "a healthy load says nothing");
    });
  } finally { spy.restore(); }
});

// A failed publish or log after a SAVED change is a warning, not a failure (review finding 6) --------------------------------------------
const spyWarn = () => {
  const out = { console: [], notes: [] }, realConsole = console.warn, realNote = ui.notifications.warn;
  console.warn = (...a) => out.console.push(a.map(String).join(" "));
  ui.notifications.warn = t => out.notes.push(t);
  out.restore = () => { console.warn = realConsole; ui.notifications.warn = realNote; };
  return out;
};
const failingAuditWrites = () => { const real = game.settings.set; game.settings.set = async (scope, key, value) => { if (key === "auditLedger") throw new Error("the log could not be written"); return real(scope, key, value); }; return () => { game.settings.set = real; }; };

test("SAVED BUT NOT LOGGED: logWorldEvent throws after setEntry saved: the call resolves, the entry is saved, and the GM gets a warning and a note", async () => {
  const w = await tagWorld();
  const spy = spyWarn(), restore = failingAuditWrites();
  try {
    const saved = await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
    assert.deepEqual(saved, { tags: ["venom-tooth"], tier: 2, name: "Item A" }, "it resolved with the saved entry");
    assert.ok(getLedger().items[A], "in memory");
    assert.ok(decodeLedger(env.values.tagLedger).items[A], "and saved in the world");
    assert.match(spy.console.join("\n"), /the tag change was saved, but writing the audit log line failed/);
    assert.deepEqual(spy.notes, ["The tag change was saved, but writing the audit log line failed (see the console)."]);
    await as(w.gm, () => api().tags.removeEntry(A));       // removeEntry takes the same path
    assert.equal(getLedger().items[A], undefined);
    await as(w.gm, () => api().tags.setCaps({ v: 1, roles: { basePower: { maxTier: 2 } } }));   // and so does the caps save
    assert.equal(env.values.tagCaps.roles.basePower.maxTier, 2);
    assert.match(spy.notes.at(-1), /The caps change was saved, but writing the audit log line failed/);
  } finally { restore(); spy.restore(); }
});

test("SAVED BUT NOT PUBLISHED: publishDefinitions throws after the save: the call resolves, the entry is saved, the log line is still written, and the GM is told", async () => {
  const w = await tagWorld();
  const spy = spyWarn();
  const realPublish = api().publishDefinitions;
  api().publishDefinitions = async () => { throw new Error("could not tell the players"); };
  try {
    await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
    assert.ok(decodeLedger(env.values.tagLedger).items[A], "saved");
    assert.match(spy.console.join("\n"), /was saved, but publishing the definitions to the players failed/);
    assert.deepEqual(spy.notes, ["The tag change was saved, but publishing the definitions to the players failed (see the console)."]);
    assert.ok(Object.values(env.values.auditLedger?._events?.history ?? []).some(h => /tags: tagged/.test(h.text)), "the log step still ran");
  } finally { api().publishDefinitions = realPublish; spy.restore(); }
});

test("SAVED AND PUBLISHED: nothing to warn about when both steps work", async () => {
  const w = await tagWorld();
  const spy = spyWarn();
  try {
    await as(w.gm, () => api().tags.setEntry(A, { tags: ["venom-tooth"], tier: 2, name: "Item A" }));
    assert.deepEqual([spy.console, spy.notes], [[], []]);
  } finally { spy.restore(); }
});

// A damaged frozen store is backed up once too (round 2, stage 1 finding 7 remainder) ----------------------------------------------------
import { loadFrozen } from "../scripts/tags/state.js";
import * as tagState from "../scripts/tags/state.js";
import { getFrozenStore } from "../scripts/tags/current.js";
const DAMAGED_FROZEN = { v: 1, items: { abc123: { recipeId: "dagger", roles: {}, uses: [] }, "bad.one": "not a record", dmg: { recipeId: 7 } } };

test("DAMAGED FROZEN STORE: kept once in the backup setting as a JSON string (a dotted key inside it never becomes an object key), one warning per load; the SOUND records stay, the damaged ones are left out; the next freeze saves the sound ones and the backup keeps the original", async () => {
  const w = await tagWorld();
  const spy = spyWarnings();
  try {
    await quietly(async () => {
      env.values.tagCrafted = structuredClone(DAMAGED_FROZEN);
      const first = await as(w.gm, async () => { const r = loadFrozen(); await r.backedUp; return r; });
      assert.ok(first.problems.length, "it failed validation");
      assert.deepEqual(Object.keys(getFrozenStore().items), ["abc123"], "only the sound record is in memory");
      assert.deepEqual(first.dropped.sort(), ["bad.one", "dmg"]);
      assert.equal(typeof env.values.tagBackup.frozen, "string");
      assert.deepEqual(JSON.parse(env.values.tagBackup.frozen), DAMAGED_FROZEN, "the backup holds the original, damaged records included");
      assert.deepEqual(dotted(env.values.tagBackup), [], "no object key anywhere in the backup has a dot (the dotted key is inside the string)");
      assert.equal(spy.lines.length, 1);
      assert.match(spy.lines[0], /frozen craft store is damaged and was loaded without 2 damaged records \(1 sound one was kept\)/);
      assert.match(spy.lines[0], /api\.tags\.repairFrozen\(\) or the next craft saves the sound ones/);
      assert.deepEqual(Object.keys(env.values.tagCrafted.items).sort(), ["abc123", "bad.one", "dmg"], "the setting itself is untouched until something saves");
      // the next freeze saves the sound records and the new one; the damaged ones are gone from the setting (they are in the backup)
      const frozen = await as(w.gm, () => tagState.freezeCraft({ frozen: { recipeId: "r-new", name: "New", tier: 2, native: [], inherited: [], uses: [], roles: {}, contributions: [] } }));
      assert.deepEqual(Object.keys(env.values.tagCrafted.items).sort(), ["abc123", frozen.id].sort());
      assert.deepEqual(JSON.parse(env.values.tagBackup.frozen), DAMAGED_FROZEN, "the backup still holds the original");
      // a second damaged load never replaces the backup
      env.values.tagCrafted = { v: 1, items: { other: 3 } };
      const second = await as(w.gm, async () => { const r = loadFrozen(); await r.backedUp; return r; });
      assert.deepEqual(await second.backedUp, { kept: false });
      assert.deepEqual(JSON.parse(env.values.tagBackup.frozen), DAMAGED_FROZEN, "the FIRST damaged value is still the one kept");
      assert.equal(spy.lines.length, 2, "one warning per damaged load");
      // a healthy store keeps nothing and says nothing
      env.values.tagCrafted = { v: 1, items: {} };
      assert.equal(as(w.gm, () => loadFrozen()).backedUp, undefined);
      assert.equal(spy.lines.length, 2);
    });
  } finally { spy.restore(); }
});

test("DAMAGED FROZEN STORE: a store with an unknown outer shape has nothing to salvage: it loads empty, with the same backup and warning", async () => {
  const w = await tagWorld();
  const spy = spyWarnings();
  try {
    await quietly(async () => {
      const odd = { v: 7, items: { abc123: { recipeId: "dagger", roles: {} } } };
      env.values.tagCrafted = structuredClone(odd);
      const r = await as(w.gm, async () => { const x = loadFrozen(); await x.backedUp; return x; });
      assert.deepEqual(getFrozenStore().items, {});
      assert.deepEqual(JSON.parse(env.values.tagBackup.frozen), odd);
      assert.match(spy.lines[0], /frozen craft store is damaged and was loaded as empty/);
      assert.deepEqual(r.dropped, []);
    });
  } finally { spy.restore(); }
});

test("REPAIR FROZEN: api.tags.repairFrozen writes back only the sound records (the damaged ones are in the backup), refuses an unknown shape unless { reset: true }, is GM only and does nothing to a healthy store", async () => {
  const w = await tagWorld();
  await quietly(async () => {
    assert.deepEqual(await as(w.gm, () => api().tags.repairFrozen()), { repaired: false, dropped: [] }, "nothing saved: nothing to do");
    env.values.tagCrafted = structuredClone(DAMAGED_FROZEN);
    await assert.rejects(as(w.annUser, () => api().tags.repairFrozen()), /GM only/);
    const result = await as(w.gm, () => api().tags.repairFrozen());
    assert.deepEqual([result.repaired, result.dropped.sort()], [true, ["bad.one", "dmg"]]);
    assert.deepEqual(Object.keys(env.values.tagCrafted.items), ["abc123"], "only the sound record is saved");
    assert.deepEqual(Object.keys(getFrozenStore().items), ["abc123"], "and in memory");
    assert.deepEqual(JSON.parse(env.values.tagBackup.frozen), DAMAGED_FROZEN, "the damaged original is kept");
    assert.deepEqual(await as(w.gm, () => api().tags.repairFrozen()), { repaired: false, dropped: [] }, "healthy now");
    // an unknown outer shape is not wiped by accident
    const odd = { v: 7, items: { abc123: { recipeId: "dagger", roles: {} } } };
    env.values.tagCrafted = structuredClone(odd);
    await assert.rejects(as(w.gm, () => api().tags.repairFrozen()), /unknown shape.*reset: true/);
    assert.deepEqual(env.values.tagCrafted, odd, "nothing was wiped");
    await as(w.gm, () => api().tags.repairFrozen({ reset: true }));
    assert.deepEqual(env.values.tagCrafted, { v: 1, items: {} });
  });
});

test("REPAIR FROZEN: a held record that is sound stays held; a repair that overlaps a freeze loses neither (both take the tagCrafted lock)", async () => {
  const w = await tagWorld();
  await quietly(async () => {
    const held = { recipeId: "dagger", roles: {}, held: true };
    env.values.tagCrafted = { v: 1, items: { keep: held, broken: 5 } };
    await as(w.gm, () => loadFrozen());
    const [repaired, frozen] = await as(w.gm, () => Promise.all([api().tags.repairFrozen(), tagState.freezeCraft({ frozen: { recipeId: "r-x", name: "X", tier: 1, native: [], inherited: [], uses: [], roles: {}, contributions: [] } })]));
    assert.ok([true, false].includes(repaired.repaired), "the repair either wrote the sound records back or found the freeze had already done it (the copy is kept first, outside the lock, so either order is fine)");
    assert.deepEqual(Object.keys(env.values.tagCrafted.items).sort(), ["keep", frozen.id].sort());
    assert.equal(env.values.tagCrafted.items.keep.held, true, "the hold survived the repair");
  });
});

test("DAMAGED FROZEN STORE: a second GM's damaged write read in through the settings echo is backed up the same way, and the backup keys of ledger, caps, frozen and editor sit side by side", async () => {
  const w = await tagWorld();
  const spy = spyWarnings();
  try {
    await quietly(async () => {
      env.values.tagLedger = structuredClone(DAMAGED_LEDGER);
      await as(w.gm, async () => { await loadLedger().backedUp; });
      env.values.tagCrafted = structuredClone(DAMAGED_FROZEN);
      await fireHookAs(w.gm, "updateSetting", [{ key: `${M}.tagCrafted` }]);        // the echo reloads it (finding 4's hook)
      await new Promise(r => setTimeout(r, 30));
      assert.deepEqual(JSON.parse(env.values.tagBackup.frozen), DAMAGED_FROZEN);
      assert.deepEqual(JSON.parse(env.values.tagBackup.ledger), DAMAGED_LEDGER, "the ledger backup is untouched");
      assert.deepEqual(Object.keys(env.values.tagBackup).sort(), ["frozen", "ledger"]);
    });
  } finally { spy.restore(); }
});

// Round 5: the raw copy is kept OUTSIDE the tagCrafted lock --------------------------------------------------------------------------
test("REPAIR FROZEN LOCK: while the raw copy is being kept (slowly) the tagCrafted lock is free, so another change to the store is not held up behind the repair", async () => {
  const w = await tagWorld();
  await quietly(async () => {
    env.values.tagCrafted = { v: 1, items: { keep: { recipeId: "dagger", roles: {} }, broken: 5 } };
    await as(w.gm, async () => { await loadFrozen().backedUp; });
    delete env.values.tagBackup;                                                      // so the repair has a copy to keep (the load had already kept one)
    const restore = slowWrites({ tagBackup: 150 });
    try {
      const started = Date.now();
      const repair = as(w.gm, () => api().tags.repairFrozen());
      await new Promise(r => setTimeout(r, 20));                                     // the repair is now keeping its copy
      let waited;
      const removal = as(w.gm, () => tagState.removeFrozen("keep")).then(() => { waited = Date.now() - started; });
      await Promise.all([repair, removal]);
      assert.ok(waited < 120, `another change to the store finished while the copy was being kept (it took ${waited} ms; a nested lock made it wait for the whole repair)`);
    } finally { restore(); }
    assert.equal(typeof env.values.tagBackup.frozen, "string", "the copy was kept");
  });
});
