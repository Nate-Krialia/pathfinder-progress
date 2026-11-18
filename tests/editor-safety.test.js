/**
 * Round 2 (item editor safety), through the real main.js in the fake Foundry: a damaged editor store is never loaded as empty and then overwritten; import refuses ids the loader would
 * reject; overlapping editor writes keep both changes; a failed publish or log after a saved change is a warning, not a failed save.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { as, env, getApi, quietly, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { loadEditorStore } from "../scripts/editor/setting.js";

const api = () => getApi();
async function editorWorld() {
  const w = await world({ perClientDefinitions: true, downtime: 6, iron: 3, fang: 3 });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  return w;
}
const dotted = (value, path = "") => (value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [...(k.includes(".") ? [`${path}/${k}`] : []), ...dotted(v, `${path}/${k}`)]) : []);
const spyWarnings = () => { const lines = [], real = ui.notifications.warn; ui.notifications.warn = text => lines.push(text); return { lines, restore: () => { ui.notifications.warn = real; } }; };
const GOOD = { kind: "tag", id: "good-one", mode: "new", fields: { name: "Good One", theme: "good things" } };
const BAD = { kind: "tag", id: "other-id", mode: "new", fields: { name: "Bad One" } };       // saved under a key that does not match its id: damaged
const damagedStore = () => ({ v: 1, records: { "tag:good-one": structuredClone(GOOD), "tag:bad-one": structuredClone(BAD) } });
const refused = (promise, pattern = /saved definitions are damaged.*tag:bad-one/) => assert.rejects(promise, error => error.name === "EditorError" && pattern.test(error.message));

test("DAMAGED EDITOR STORE: kept once in the backup setting as a JSON string, one warning per load; every write is refused and the saved value is untouched", async () => {
  const w = await editorWorld();
  const spy = spyWarnings();
  try {
    await quietly(async () => {
      const original = damagedStore();
      env.values.editorDefinitions = structuredClone(original);
      const found = await as(w.gm, async () => { const r = loadEditorStore(); await r.backedUp; return r; });
      assert.ok(found.problems.length, "it failed validation");
      assert.equal(typeof env.values.tagBackup.editor, "string");
      assert.deepEqual(JSON.parse(env.values.tagBackup.editor), original, "the backup holds the original");
      assert.deepEqual(dotted(env.values.tagBackup), [], "no object key in the backup has a dot");
      assert.equal(spy.lines.length, 1);
      assert.match(spy.lines[0], /editor definitions are damaged/);
      // every write path refuses, naming the damaged record, and changes nothing
      await as(w.gm, async () => {
        await refused(api().editor.create("tag", { name: "New Tag", theme: "x" }, { makeItem: false }));
        await refused(api().editor.update("tag:good-one", { theme: "changed" }, { confirmed: true }));
        await refused(api().editor.remove("tag:good-one"));
        await refused(api().editor.importRecords({ format: "pathfinder-progress-editor", v: 1, records: [{ kind: "tag", id: "fresh", mode: "new", fields: { name: "Fresh", theme: "f" } }] }));
        await refused(api().editor.foldOverlay());
        await refused(api().editor.clearLeftover("tag:good-one"));
      });
      assert.deepEqual(env.values.editorDefinitions, original, "the saved setting is exactly as it was");
      // reading still works: a damaged store reads as empty, and the problems are visible
      assert.deepEqual(await as(w.gm, async () => api().editor.records()), {});
      assert.match((await as(w.gm, async () => api().editor.damaged()))[0], /tag:bad-one/);
      // a second damaged load never replaces the backup
      env.values.editorDefinitions = { v: 1, records: { "tag:x": { kind: "tag", id: "y" } } };
      const second = await as(w.gm, async () => { const r = loadEditorStore(); await r.backedUp; return r; });
      assert.deepEqual(await second.backedUp, { kept: false });
      assert.deepEqual(JSON.parse(env.values.tagBackup.editor), original, "the FIRST damaged value is still the one kept");
      assert.equal(spy.lines.length, 2, "one warning per damaged load");
    });
  } finally { spy.restore(); }
});

test("DAMAGED EDITOR STORE: repair drops ONLY the damaged records, the sound ones load again, and editing works afterwards", async () => {
  const w = await editorWorld();
  await quietly(async () => {
    env.values.editorDefinitions = damagedStore();
    const result = await as(w.gm, () => api().editor.repair());
    assert.deepEqual(result, { repaired: true, dropped: ["tag:bad-one"] });
    assert.deepEqual(env.values.editorDefinitions, { v: 1, records: { "tag:good-one": GOOD } }, "only the sound record is left");
    assert.ok(api().definitions.tag.has("good-one"), "and it is in the registry again");
    assert.ok(env.values.tagBackup.editor.includes("bad-one"), "the damaged original is in the backup");
    assert.deepEqual(await as(w.gm, async () => api().editor.damaged()), []);
    await as(w.gm, () => api().editor.create("tag", { name: "New Tag", theme: "x" }, { makeItem: false }));
    assert.deepEqual(Object.keys(env.values.editorDefinitions.records).sort(), ["tag:good-one", "tag:new-tag"]);
    assert.deepEqual(await as(w.gm, () => api().editor.repair()), { repaired: false, dropped: [] }, "nothing to repair now");
    await assert.rejects(as(w.annUser, () => api().editor.repair()), /GM only/);
  });
});

test("DAMAGED EDITOR STORE: a store with an unknown outer shape is not wiped by repair; { reset: true } starts it empty and the raw copy stays in the backup", async () => {
  const w = await editorWorld();
  await quietly(async () => {
    const odd = { v: 99, records: { "tag:good-one": GOOD } };
    env.values.editorDefinitions = structuredClone(odd);
    await refused(as(w.gm, () => api().editor.create("tag", { name: "New Tag", theme: "x" }, { makeItem: false })), /unknown shape/);
    await assert.rejects(as(w.gm, () => api().editor.repair()), /unknown shape.*reset: true/);
    assert.deepEqual(env.values.editorDefinitions, odd, "nothing was wiped");
    await as(w.gm, () => api().editor.repair({ reset: true }));
    assert.deepEqual(env.values.editorDefinitions, { v: 1, records: {} });
    assert.deepEqual(JSON.parse(env.values.tagBackup.editor), odd);
  });
});
