/** The item editor's backend through the real main.js in the fake Foundry (Stage 11d): create, edit, revert, retire, delete, push to copies, tracks, leftovers. */
import test from "node:test";
import assert from "node:assert/strict";
import { M, as, getApi, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { newBlock } from "../scripts/editor/blocks.js";

const api = () => getApi();
const seedSources = () => seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));

/** A world whose registry is built from the seed sources, so the editor can re-layer. */
async function editorWorld(options = {}) {
  const w = await world({ perClientDefinitions: true, ...options });
  api().baseSources = seedSources();
  api().editorLeftovers = [];
  return w;
}
const saved = () => structuredClone(globalThis.game.settings.get(M, "editorDefinitions") ?? null);
const gm = (w, fn) => as(w.gm, fn);

test("CREATE: a material gets a definition AND a linked world item in a Materials folder; the setting holds only the world record", async () => {
  const w = await editorWorld();
  const made = await gm(w, () => api().editor.create("material", { name: "Gate Fang", tier: 2, value: 12, bulk: "L", effectBlocks: { general: { power: 2, blocks: [] }, byClass: { weapon: { blocks: [newBlock("damage")] } } } }));
  assert.equal(made.key, "material:gate-fang");
  assert.deepEqual(api().definitions.material.get("gate-fang").classEffects.weapon.bonusDamage, { dice: "1d6", type: "fire" });
  assert.equal(made.item.getFlag(M, "material").materialId, "gate-fang");
  assert.equal(made.item.getFlag(M, "template"), true);
  const folder = globalThis.game.folders.find(f => f.name === "Materials");
  assert.equal(made.item.folder, folder.id);
  assert.deepEqual(Object.keys(saved().records), ["material:gate-fang"]);
  assert.equal(saved().records["material:gate-fang"].mode, "new");
  assert.equal(api().editor.entry("material:gate-fang").origin, "world");
});

test("CREATE: a name is required, an id clash gets a free id, a player is refused, and a bad record writes nothing", async () => {
  const w = await editorWorld();
  await assert.rejects(gm(w, () => api().editor.create("material", { name: "  " })), /Give it a name/);
  const clash = await gm(w, () => api().editor.create("material", { name: "Iron" }));
  assert.equal(clash.key, "material:iron-2", "never overwrites the pack's iron");
  await assert.rejects(as(w.annUser, () => api().editor.create("material", { name: "Mine" })), /GM only/);
  const before = JSON.stringify(saved());
  await assert.rejects(gm(w, () => api().editor.create("material", { name: "Bad", tier: 9 })), /tier/);
  assert.equal(JSON.stringify(saved()), before, "nothing written for a record that would fail validation");
  assert.ok(!api().definitions.material.has("bad"));
});

test("CREATE note: a Plan note is a short study that teaches its formula, a Research note a longer one", async () => {
  const w = await editorWorld();
  const recipeId = [...api().definitions.recipe.keys()][0];
  const plan = await gm(w, () => api().editor.create("note", { name: "Gate Plan", recipeId, preset: "plan" }));
  const research = await gm(w, () => api().editor.create("note", { name: "Gate Research", recipeId, preset: "research" }));
  const steps = key => api().definitions.note.get(key).research.milestones[0];
  assert.deepEqual(steps("gate-plan").grants, { type: "formula" });
  assert.ok(steps("gate-plan").steps < steps("gate-research").steps);
  assert.equal(plan.item.getFlag(M, "note").noteId, "gate-plan");
  assert.ok(research.item);
});

test("EDIT a pack material is a patch: only the changed field is stored, and reverting restores the pack's value", async () => {
  const w = await editorWorld();
  const was = api().definitions.material.get("iron").name;
  await gm(w, () => api().editor.update("material:iron", { name: "Cold Iron" }));
  assert.equal(api().definitions.material.get("iron").name, "Cold Iron");
  assert.deepEqual(saved().records["material:iron"], { kind: "material", id: "iron", mode: "patch", fields: { name: "Cold Iron" } });
  assert.deepEqual(api().editor.entry("material:iron").editedFields, ["name"]);
  assert.equal(api().editor.entry("material:iron").origin, "pack, edited here");
  await gm(w, () => api().editor.revert("material:iron", "name"));
  assert.equal(api().definitions.material.get("iron").name, was);
  assert.deepEqual(saved().records, {}, "nothing left to patch: the record is gone");
  await assert.rejects(gm(w, () => api().editor.revert("material:iron")), /no edits/);
});

test("EDIT that would break a definition is refused in plain words and writes nothing", async () => {
  const w = await editorWorld();
  await gm(w, () => api().editor.update("material:iron", { name: "Cold Iron" }));
  const before = JSON.stringify(saved());
  await assert.rejects(gm(w, () => api().editor.update("material:iron", { tier: 12 })), /tier/);
  assert.equal(JSON.stringify(saved()), before);
  assert.equal(api().definitions.material.get("iron").tier, 1);
  await assert.rejects(gm(w, () => api().editor.update("material:nope", { name: "X" })), /no material:nope/);
});

test("EDIT what players may already know asks first: the GM must confirm, then it goes through", async () => {
  const w = await editorWorld();
  const mat = (await gm(w, () => api().editor.create("material", { name: "Gate Ore", tier: 1, tag: undefined })));
  await w.ann.setFlag(M, "compendium", { v: 1, classes: { weapon: { "gate-ore": { materialId: "gate-ore", materialName: "Gate Ore", tier: 1, effects: {}, at: 1 } } } });
  const attempt = gm(w, () => api().editor.update(mat.key, { effectBlocks: { general: { power: 1, blocks: [] } } }));
  await assert.rejects(attempt, e => e.details?.needsConfirm === true && e.details.knownBy.includes("Ann"));
  await gm(w, () => api().editor.update(mat.key, { effectBlocks: { general: { power: 1, blocks: [] } } }, { confirmed: true }));
  assert.deepEqual(api().definitions.material.get("gate-ore").effects, { basePower: "T1" });
  // a name change touches nothing a player has learned
  await gm(w, () => api().editor.update(mat.key, { name: "Gate Ore!" }));
});

test("RETIRE hides without deleting and can be undone; DELETE only an editor-made, unused item (and its world item); a pack item can only be retired", async () => {
  const w = await editorWorld();
  const made = await gm(w, () => api().editor.create("material", { name: "Gate Moss", tier: 1 }));
  await gm(w, () => api().editor.retire(made.key));
  assert.equal(api().definitions.material.get("gate-moss").retired, true);
  await gm(w, () => api().editor.retire(made.key, false));
  assert.equal(api().definitions.material.get("gate-moss").retired, undefined);
  await assert.rejects(gm(w, () => api().editor.remove("material:iron")), /cannot be deleted; retire/);

  await api().giveMaterial(w.ann, "gate-moss", 2);
  await assert.rejects(gm(w, () => api().editor.remove(made.key)), e => /still in use/.test(e.message) && e.details.usage.copies.some(c => c.where === "Ann"));
  await w.ann.items.find(i => i.name === "Gate Moss").delete();
  assert.equal(await gm(w, () => api().editor.remove(made.key)), true);
  assert.ok(!api().definitions.material.has("gate-moss"));
  assert.ok(!globalThis.game.items.some(i => i.getFlag(M, "material")?.materialId === "gate-moss"), "the world item went with it");
  assert.deepEqual(saved().records, {});
});

test("PUSH TO COPIES: name, image, description, bulk, price and tier reach every copy; unlinked tokens are counted, not touched", async () => {
  const w = await editorWorld();
  const made = await gm(w, () => api().editor.create("material", { name: "Gate Silk", tier: 1, value: 10, bulk: "L" }));
  await api().giveMaterial(w.ann, "gate-silk", 3);
  await gm(w, () => api().editor.update(made.key, { name: "Gate Spider Silk", img: "icons/silk.webp", description: "Fine thread.", bulk: "2", value: 20, tier: 2 }));
  const copy = w.ann.items.find(i => i.getFlag(M, "material")?.materialId === "gate-silk");
  assert.equal(copy.name, "Gate Silk", "editing alone does not touch copies");
  const result = await gm(w, () => api().editor.pushCopies(made.key));
  assert.equal(result.updated, 2, "the world item and Ann's copy");
  assert.equal(copy.name, "Gate Spider Silk");
  assert.equal(copy.img, "icons/silk.webp");
  assert.match(copy.system.description.value, /Fine thread/);
  assert.equal(copy.system.bulk.value, 2);
  assert.equal(copy.getFlag(M, "material").tier, 2);
  assert.equal(copy.system.quantity, 3, "the quantity is the player's");
  assert.equal(result.skippedTokens, 0);
});

test("TRACKS: setting a track on an editor item stores it in the record, clears an older overlay entry, and clearing removes it", async () => {
  const w = await editorWorld();
  const made = await gm(w, () => api().editor.create("material", { name: "Gate Bloom", tier: 1 }));
  const track = { milestones: [{ steps: 3, grants: { type: "properties" } }] };
  await globalThis.game.settings.set(M, "discoveryTracks", { [made.key]: { milestones: [{ steps: 9, grants: { type: "properties" } }] } });
  await gm(w, () => api().editor.setTrack(made.key, track));
  assert.deepEqual(api().definitions.material.get("gate-bloom").research, track);
  assert.deepEqual(globalThis.game.settings.get(M, "discoveryTracks"), {}, "the old overlay entry no longer wins");
  await gm(w, () => api().editor.setTrack(made.key, null));
  assert.equal(api().definitions.material.get("gate-bloom").research, undefined);
});

test("MUST-DO 1: an orphaned overlay entry (its item is gone) can be cleared, by tracks.clear and by the editor's leftovers", async () => {
  const w = await editorWorld();
  const orphan = { milestones: [{ steps: 3, grants: { type: "properties" } }] };
  await globalThis.game.settings.set(M, "discoveryTracks", { "material:g20-orphan": orphan, "material:g20-orphan-2": orphan });
  assert.deepEqual(api().editor.leftovers().map(l => l.key).sort(), ["material:g20-orphan", "material:g20-orphan-2"]);
  await gm(w, () => api().discovery.tracks.clear("material:g20-orphan"));
  await gm(w, () => api().editor.clearLeftover("material:g20-orphan-2"));
  assert.deepEqual(globalThis.game.settings.get(M, "discoveryTracks"), {});
  assert.deepEqual(api().editor.leftovers(), []);
  await assert.rejects(gm(w, () => api().discovery.tracks.clear("material:g20-orphan")), /no track/);
});

test("FOLD-IN: the old overlay moves into the editor's records once; entries whose item is gone stay as leftovers", async () => {
  const w = await editorWorld();
  const track = { milestones: [{ steps: 4, grants: { type: "properties" } }] };
  await globalThis.game.settings.set(M, "discoveryTracks", { "material:iron": track, "material:g20-orphan": track });
  const result = await gm(w, () => api().editor.foldOverlay());
  assert.deepEqual(result.folded, ["material:iron"]);
  assert.deepEqual(result.leftovers, ["material:g20-orphan"]);
  assert.deepEqual(api().definitions.material.get("iron").research, track);
  assert.deepEqual(Object.keys(globalThis.game.settings.get(M, "discoveryTracks")), ["material:g20-orphan"]);
  assert.deepEqual((await gm(w, () => api().editor.foldOverlay())).folded, [], "a second fold finds nothing");
});

test("PLAYERS: a player's copy of an editor-made material carries no effect, blocks, bulk, retired flag or description", async () => {
  const w = await editorWorld();
  const made = await gm(w, () => api().editor.create("material", { name: "Gate Pearl", tier: 2, description: "Secret lore", effectBlocks: { general: { power: 2, blocks: [] }, byClass: { weapon: { blocks: [newBlock("damage")] } } } }));
  await api().giveMaterial(w.ann, "gate-pearl", 1);
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const seen = as(w.annUser, () => api().definitions.material.get("gate-pearl"));
  assert.ok(seen, "Ann's client knows the material");
  assert.doesNotMatch(JSON.stringify(seen), /effect|blocks|Secret lore|bulk|retired|1d6|fire/);
  assert.ok(made.item);
});

test("EXPORT / IMPORT: a bundle made in one world brings its materials, with items, into another; clashes are skipped; a bad bundle changes nothing", async () => {
  const w = await editorWorld();
  await gm(w, () => api().editor.create("material", { name: "Gate Sap", tier: 1, value: 7 }));
  await gm(w, () => api().editor.update("material:iron", { name: "Cold Iron" }));
  const bundle = await gm(w, () => api().editor.exportRecords());
  assert.deepEqual(bundle.records.map(r => `${r.mode}:${r.id}`).sort(), ["new:gate-sap", "patch:iron"]);

  const other = await editorWorld();
  const result = await gm(other, () => api().editor.importRecords(JSON.parse(JSON.stringify(bundle))));
  assert.deepEqual(result.added.sort(), ["material:gate-sap", "material:iron"]);
  assert.equal(api().definitions.material.get("iron").name, "Cold Iron");
  assert.ok(globalThis.game.items.some(i => i.getFlag(M, "material")?.materialId === "gate-sap"), "an item was made for the imported material");
  const again = await gm(other, () => api().editor.importRecords(JSON.parse(JSON.stringify(bundle))));
  assert.deepEqual(again.added, []);
  assert.equal(again.skipped.length, 2);

  const before = JSON.stringify(saved());
  const broken = { ...bundle, records: [{ kind: "material", id: "bad", mode: "new", fields: { name: "Bad", tier: 9 } }] };
  await assert.rejects(gm(other, () => api().editor.importRecords(broken)), /tier/);
  assert.equal(JSON.stringify(saved()), before);
  await assert.rejects(gm(other, () => api().editor.importRecords({ nope: true })), /not an item editor export/);
  assert.throws(() => as(other.annUser, () => api().editor.exportRecords()), /GM only/);
});

test("IN-MEMORY definitions (a gate's fixtures) survive an editor save, and cannot themselves be edited", async () => {
  const w = await editorWorld();
  const fake = { kind: "material", id: "g20-fake", name: "Gate Fake", tier: 1, effects: { basePower: "T1" } };
  api().definitions.material.set("g20-fake", fake);
  await gm(w, () => api().editor.update("material:iron", { name: "Cold Iron" }));
  assert.equal(api().definitions.material.get("g20-fake"), fake, "still there after the registry was rebuilt");
  await assert.rejects(gm(w, () => api().editor.update("material:g20-fake", { name: "X" })), /exists only in memory/);
  assert.deepEqual(Object.keys(saved().records), ["material:iron"], "no orphan edit was written");
});
