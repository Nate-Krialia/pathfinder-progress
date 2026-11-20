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

// Import refuses what the loader would reject, and an edit of nothing (1b #11) -------------------------------------------------------
import { BUNDLE_FORMAT, planImport } from "../scripts/editor/exchange.js";
import { emptyStore } from "../scripts/editor/layer.js";
const bundleOf = records => ({ format: BUNDLE_FORMAT, v: 1, records });
const newTag = id => ({ kind: "tag", id, mode: "new", fields: { name: "T", theme: "t" } });

test("IMPORT: an id with a dot, capitals, a space or no text is refused before anything is stored (the whole bundle imports nothing)", () => {
  for (const id of ["iron.x", "Iron", "has space", "", 5, null, "__proto__.x"]) {
    const plan = planImport(bundleOf([newTag("fine"), newTag(id)]), emptyStore(), {});
    assert.match(plan.problems.join(" "), /Record 2 has an id that cannot be used/, `id ${JSON.stringify(id)}`);
  }
  assert.deepEqual(planImport(bundleOf([newTag("fine-1"), newTag("fine_2")]), emptyStore(), {}).problems, [], "ordinary slugs are fine");
  // a patch with a dotted id is refused the same way (it used to be stored as a leftover under a dotted key)
  const patch = { kind: "material", id: "iron.x", mode: "patch", fields: { name: "X" } };
  assert.match(planImport(bundleOf([patch]), emptyStore(), { definedIds: new Set(["material:iron.x"]) }).problems.join(" "), /cannot be used/);
});

test("IMPORT: an edit of a definition that does not exist here is refused (skipped with its reason), never stored as a leftover; an edit of one that exists is accepted", async () => {
  const gone = { kind: "material", id: "no-such-metal", mode: "patch", fields: { name: "X" } };
  const iron = { kind: "material", id: "iron", mode: "patch", fields: { name: "Cold Iron" } };
  const plan = planImport(bundleOf([gone, iron]), emptyStore(), { definedIds: new Set(["material:iron"]) });
  assert.deepEqual(plan.skip, [{ key: "material:no-such-metal", reason: "edits a definition that does not exist in this world" }]);
  assert.deepEqual(plan.add.map(r => r.id), ["iron"]);
  assert.deepEqual(plan.problems, []);
  // through the editor: nothing is written for the missing one and no leftover appears
  const w = await editorWorld();
  await quietly(async () => {
    const result = await as(w.gm, () => api().editor.importRecords(bundleOf([gone])));
    assert.deepEqual(result.added, []);
    assert.equal(result.skipped[0].reason, "edits a definition that does not exist in this world");
    assert.equal(env.values.editorDefinitions, undefined, "the setting was not written");
    assert.deepEqual(api().editorLeftovers, [], "and no leftover was made");
    const ok = await as(w.gm, () => api().editor.importRecords(bundleOf([iron])));
    assert.deepEqual(ok.added, ["material:iron"]);
    assert.equal(env.values.editorDefinitions.records["material:iron"].fields.name, "Cold Iron");
    await assert.rejects(as(w.gm, () => api().editor.importRecords(bundleOf([{ ...gone, id: "a.b" }]))), /cannot be used/);
  });
});

// Overlapping editor changes keep both (1b #2) ---------------------------------------------------------------------------------------
import { DAGGER } from "./fake-world.js";
const slowEditorWrites = ms => {
  const real = game.settings.set;
  game.settings.set = async (scope, key, value) => { if (key === "editorDefinitions") await new Promise(r => setTimeout(r, ms)); return real(scope, key, value); };
  return () => { game.settings.set = real; };
};
const creating = (name, extra = {}) => api().editor.create("tag", { name, theme: `${name} things`, ...extra }, { makeItem: false });

test("EDITOR LOCK: two overlapping creates with the SAME name keep both records and get different ids", async () => {
  const w = await editorWorld();
  const restore = slowEditorWrites(25);
  try {
    const [a, b] = await quietly(() => as(w.gm, () => Promise.all([creating("Twin Tag"), creating("Twin Tag")])));
    assert.notEqual(a.key, b.key, "different ids");
    assert.deepEqual(Object.keys(env.values.editorDefinitions.records).sort(), [a.key, b.key].sort(), "both are in the saved setting");
    assert.ok(api().definitions.tag.has("twin-tag") && api().definitions.tag.has("twin-tag-2"), "and both are in the registry");
  } finally { restore(); }
});

test("EDITOR LOCK: two overlapping creates with DIFFERENT names keep both (each used to start from the same store, and the second write erased the first)", async () => {
  const w = await editorWorld();
  const restore = slowEditorWrites(25);
  try {
    await quietly(() => as(w.gm, () => Promise.all([creating("Alpha Tag"), creating("Beta Tag"), creating("Gamma Tag")])));
    assert.deepEqual(Object.keys(env.values.editorDefinitions.records).sort(), ["tag:alpha-tag", "tag:beta-tag", "tag:gamma-tag"]);
    for (const id of ["alpha-tag", "beta-tag", "gamma-tag"]) assert.ok(api().definitions.tag.has(id), id);
  } finally { restore(); }
});

test("EDITOR LOCK: two overlapping changes to ONE recipe's slots (a need on one slot, a kind on another) both land: each works its slot list out from the recipe as it is inside the lock", async () => {
  const w = await editorWorld();
  await quietly(() => as(w.gm, () => creating("Edge Tag")));
  const restore = slowEditorWrites(25);
  try {
    await quietly(() => as(w.gm, () => Promise.all([api().tags.setSlotNeeds(DAGGER, "fang", { all: ["edge-tag"] }), api().tags.setSlotKind(DAGGER, "blade", "edge")])));
  } finally { restore(); }
  const slots = api().definitions.recipe.get(DAGGER).slots;
  assert.deepEqual(slots.find(s => s.name === "fang").needs, { all: ["edge-tag"] }, "the need on fang");
  assert.equal(slots.find(s => s.name === "blade").kind, "edge", "the kind on blade");
  const saved = env.values.editorDefinitions.records[`recipe:${DAGGER}`].fields.slots;
  assert.ok(saved.find(s => s.name === "fang").needs && saved.find(s => s.name === "blade").kind, "and both are in the saved setting");
});

test("EDITOR LOCK: no editor change waits on itself: update, revert, retire, remove, setTrack, foldOverlay, clearLeftover, importRecords, repair and updateWith all finish, in any mix, and a refused change frees the lock", async () => {
  const w = await editorWorld();
  await quietly(async () => {
    await as(w.gm, async () => {
      const made = await creating("Cycle Tag");
      await api().editor.update(made.key, { theme: "changed" }, { confirmed: true });
      await api().editor.updateWith(made.key, rec => ({ theme: `${rec.theme}!` }), { confirmed: true });
      await api().editor.retire("material:iron", true);
      await api().editor.retire("material:iron", false);
      assert.equal(await api().editor.foldOverlay().then(r => r.folded.length), 0);
      assert.deepEqual(await api().editor.repair(), { repaired: false, dropped: [] });
      await assert.rejects(api().editor.updateWith("tag:does-not-exist", () => ({})), /There is no tag:does-not-exist to edit/);
      await assert.rejects(api().editor.remove("tag:does-not-exist"), /cannot be deleted/);      // a refusal ...
      await api().editor.remove(made.key);                                                          // ... does not leave the lock held
      const pack = await api().editor.update("material:iron", { name: "Cold Iron" }, { confirmed: true });
      assert.equal(pack.editedFields.includes("name"), true);
      await api().editor.revert("material:iron");
      assert.equal(env.values.editorDefinitions.records["material:iron"], undefined, "the revert took the patch back");
    });
  });
});

// A failed publish or log AFTER a saved editor change is a warning, not a failed save (1b #8) ------------------------------------------------
const spyWarn = () => {
  const out = { console: [], notes: [] }, realConsole = console.warn, realNote = ui.notifications.warn;
  console.warn = (...a) => out.console.push(a.map(String).join(" "));
  ui.notifications.warn = t => out.notes.push(t);
  out.restore = () => { console.warn = realConsole; ui.notifications.warn = realNote; };
  return out;
};
const failingAuditWrites = () => { const real = game.settings.set; game.settings.set = async (scope, key, value) => { if (key === "auditLedger") throw new Error("the log could not be written"); return real(scope, key, value); }; return () => { game.settings.set = real; }; };
const failingPublish = () => { const real = api().publishDefinitions; api().publishDefinitions = async () => { throw new Error("could not tell the players"); }; return () => { api().publishDefinitions = real; }; };
const PUBLISH_NOTE = "The editor change was saved, but publishing the definitions to the players failed (see the console).";

test("SAVED BUT NOT PUBLISHED: publishDefinitions throws after create: it resolves, the record and the world item exist ONCE (no retry, no -2 id), one console warning and one GM note", async () => {
  const w = await editorWorld();
  const spy = spyWarn(), restore = failingPublish();
  try {
    const made = await as(w.gm, () => api().editor.create("material", { name: "Fresh Metal", tier: 1 }));
    assert.equal(made.key, "material:fresh-metal");
    assert.ok(made.item, "the world item was made");
    assert.deepEqual(Object.keys(env.values.editorDefinitions.records), ["material:fresh-metal"], "saved, one record, no -2");
    assert.ok(api().definitions.material.has("fresh-metal") && !api().definitions.material.has("fresh-metal-2"));
    assert.equal(spy.console.filter(l => /was saved, but publishing the definitions to the players failed/.test(l)).length, 1);
    assert.deepEqual(spy.notes, [PUBLISH_NOTE], "the GM is told once");
  } finally { restore(); spy.restore(); }
});

test("SAVED BUT NOT LOGGED: the audit write throws after create, update, remove, import and repair: each resolves with the change saved, and the GM gets ONE note per change", async () => {
  const w = await editorWorld();
  const spy = spyWarn(), restore = failingAuditWrites();
  const LOG_NOTE = "The editor change was saved, but writing the audit log line failed (see the console).";
  try {
    await as(w.gm, async () => {
      const made = await creating("Logless Tag");
      assert.ok(env.values.editorDefinitions.records["tag:logless-tag"], "create saved");
      await api().editor.update(made.key, { theme: "edited" }, { confirmed: true });
      assert.equal(env.values.editorDefinitions.records["tag:logless-tag"].fields.theme, "edited", "update saved");
      await api().editor.importRecords({ format: "pathfinder-progress-editor", v: 1, records: [{ kind: "tag", id: "imported-tag", mode: "new", fields: { name: "Imported Tag", theme: "i" } }] });
      assert.ok(env.values.editorDefinitions.records["tag:imported-tag"], "import saved");
      await api().editor.remove(made.key);
      assert.equal(env.values.editorDefinitions.records["tag:logless-tag"], undefined, "remove saved");
      env.values.editorDefinitions = { v: 1, records: { ...env.values.editorDefinitions.records, "tag:oops": { kind: "tag", id: "other" } } };
      assert.equal((await api().editor.repair()).repaired, true);
      assert.deepEqual(Object.keys(env.values.editorDefinitions.records), ["tag:imported-tag"], "repair saved");
    });
    assert.deepEqual(spy.notes, [LOG_NOTE, LOG_NOTE, LOG_NOTE, LOG_NOTE, LOG_NOTE], "one note for each of the five changes");
  } finally { restore(); spy.restore(); }
});

test("SAVED BUT BOTH FAILED: one note names both steps; the slot saves from the tags code resolve too (they used to throw a TagError for a saved change)", async () => {
  const w = await editorWorld();
  await as(w.gm, () => creating("Edge Tag"));
  const spy = spyWarn(), restoreLog = failingAuditWrites(), restorePublish = failingPublish();
  try {
    await as(w.gm, async () => {
      const slot = await api().tags.setSlotNeeds(DAGGER, "fang", { all: ["edge-tag"] });
      assert.deepEqual(slot.needs, { all: ["edge-tag"] }, "the slot save resolved with the saved slot");
      assert.deepEqual((await api().tags.setSlotKind(DAGGER, "blade", "edge")).kind, "edge");
    });
    assert.ok(env.values.editorDefinitions.records[`recipe:${DAGGER}`].fields.slots.find(s => s.name === "fang").needs, "saved in the world");
    assert.equal(spy.notes.length, 2, "one note per saved change");
    assert.equal(spy.notes[0], "The editor change was saved, but publishing the definitions to the players and writing the audit log line failed (see the console).");
    assert.equal(spy.console.filter(l => /was saved, but/.test(l)).length, 4, "and each failed step is a console warning");
  } finally { restoreLog(); restorePublish(); spy.restore(); }
});

test("SAVED AND PUBLISHED: nothing to warn about when both steps work", async () => {
  const w = await editorWorld();
  const spy = spyWarn();
  try {
    await as(w.gm, () => creating("Quiet Tag"));
    assert.deepEqual([spy.console, spy.notes], [[], []]);
  } finally { spy.restore(); }
});

// Round 5: the raw copy is kept OUTSIDE the editorStore lock -------------------------------------------------------------------------
test("EDITOR REPAIR LOCK: while the raw copy is being kept (slowly) the editor lock is free, so another editor change is not held up behind the repair", async () => {
  const w = await editorWorld();
  await quietly(async () => {
    env.values.editorDefinitions = damagedStore();
    await as(w.gm, async () => { await loadEditorStore().backedUp; });
    delete env.values.tagBackup;                                                      // so the repair has a copy to keep
    const real = game.settings.set;
    game.settings.set = async (scope, key, value) => { if (key === "tagBackup") await new Promise(r => setTimeout(r, 150)); return real(scope, key, value); };
    try {
      const started = Date.now();
      const repair = as(w.gm, () => api().editor.repair());
      await new Promise(r => setTimeout(r, 20));
      let waited;
      const other = as(w.gm, () => api().editor.create("tag", { name: "Another One", theme: "other things" }, { makeItem: false })).catch(() => {}).then(() => { waited = Date.now() - started; });
      await Promise.all([repair, other]);
      assert.ok(waited < 120, `another editor change finished while the copy was being kept (it took ${waited} ms; a nested lock made it wait for the whole repair)`);
    } finally { game.settings.set = real; }
    assert.equal(typeof env.values.tagBackup.editor, "string", "the copy was kept");
  });
});

// Stage 1c #12: kind and id are never fields ----------------------------------------------------------------------------------------------
test("IDENTITY FIELDS: import, update and create refuse a field called kind or id, and nothing is written", async () => {
  const sneaky = { kind: "material", id: "iron", mode: "patch", fields: { name: "Cold Iron", id: "other" } };
  assert.match(planImport(bundleOf([newTag("fine"), { kind: "tag", id: "t2", mode: "new", fields: { name: "T", kind: "material" } }]), emptyStore(), {}).problems.join(" "), /Record 2 \(tag:t2\) has a field called kind/);
  assert.match(planImport(bundleOf([sneaky]), emptyStore(), { definedIds: new Set(["material:iron"]) }).problems.join(" "), /field called id/);
  const w = await editorWorld();
  await quietly(async () => {
    await assert.rejects(as(w.gm, () => api().editor.importRecords(bundleOf([sneaky]))), /field called id/);
    await assert.rejects(as(w.gm, () => api().editor.update("material:iron", { id: "other" })), error => error.name === "EditorError" && /cannot be edited as a field/.test(error.message));
    await assert.rejects(as(w.gm, () => api().editor.update("material:iron", { name: "Cold Iron", kind: "recipe" })), /cannot be edited as a field/);
    await assert.rejects(as(w.gm, () => api().editor.create("tag", { name: "Odd", theme: "x", kind: "material" }, { makeItem: false })), /cannot be a field/);
    assert.equal(env.values.editorDefinitions, undefined, "nothing was written");
    const made = await as(w.gm, () => api().editor.create("tag", { name: "Wanted", theme: "x", id: "wanted-id" }, { makeItem: false }));
    assert.equal(made.key, "tag:wanted-id", "id is still the id the caller WANTS (it is never stored as a field)");
    assert.equal("id" in env.values.editorDefinitions.records["tag:wanted-id"].fields, false);
  });
});
