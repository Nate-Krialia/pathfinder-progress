/**
 * Tag system Slice 1 through the real main.js in the fake Foundry (docs/22-tags-slice1.md): the GM-only ledger, a recipe slot that needs tags, an ordinary PF2e item filling it,
 * the craft itself, the player's copy (no tags, no tiers) and the leak scan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, as, craft, env, getApi, makeActor, resolve, world } from "./fake-world.js";
import { asPage, findTagLeaks, seedRecords } from "./helpers.js";
import { getLedger } from "../scripts/tags/current.js";
import { loadLedger } from "../scripts/tags/state.js";

const api = () => getApi();
const TOOTH = "Compendium.pf2e.equipment-srd.Item.TTTTTTTTTTTTTTTT";
const STRAP = "Compendium.pf2e.equipment-srd.Item.SSSSSSSSSSSSSSSS";

async function tagged(options = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 6, iron: 3, fang: 3, ...options });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  await as(w.gm, async () => {
    await api().editor.create("tag", { name: "Venom Tooth", theme: "bitey things" }, { makeItem: false });
    await api().editor.create("tag", { name: "Sharp Edge", theme: "cutting things" }, { makeItem: false });
  });
  return w;
}
const give = (actor, name, ref, quantity = 1) => actor.createEmbeddedDocuments("Item", [{ name, type: "equipment", system: { quantity }, flags: { core: { sourceId: ref } } }]);
const gm = fn => as(getApi() && globalThis.game.users.get("gm1"), fn);

test("LEDGER: the GM tags a material and an ordinary item; a player cannot; it survives a reload", async () => {
  const w = await tagged();
  await as(w.gm, async () => {
    await api().tags.setEntry("spider-fang", { tags: ["venom-tooth"] });
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth", "sharp-edge"], tier: 2, name: "Wolf Tooth" });
  });
  assert.deepEqual(await as(w.gm, () => api().tags.tagsOf("spider-fang")), ["venom-tooth"]);
  assert.deepEqual(await as(w.gm, () => api().tags.tagsOf(TOOTH)), ["venom-tooth", "sharp-edge"]);
  assert.equal(await as(w.gm, () => api().tags.tierOf(TOOTH)), 2);
  await assert.rejects(as(w.annUser, () => api().tags.setEntry("spider-fang", { tags: ["venom-tooth"] })), /GM only/);
  await assert.rejects(as(w.annUser, async () => api().tags.ledger()), /GM only/);
  await assert.rejects(as(w.annUser, () => api().tags.removeEntry(TOOTH)), /GM only/);
  assert.deepEqual(env.values.tagLedger.items[TOOTH], { tags: ["venom-tooth", "sharp-edge"], tier: 2, name: "Wolf Tooth" });
  getLedger().items = {}; loadLedger();                             // a fresh load reads the saved setting
  assert.ok(getLedger().items[TOOTH], "read back from the world setting");
});
test("LEDGER: the editor refuses to save an item without a tier, without a name, with an unknown tag or with no tag", async () => {
  const w = await tagged();
  await as(w.gm, async () => {
    await assert.rejects(api().tags.setEntry(STRAP, { tags: ["venom-tooth"], name: "Strap" }), /no tier of its own: give it one/);
    await assert.rejects(api().tags.setEntry(STRAP, { tags: ["venom-tooth"], tier: 1 }), /Give the item a name to show/);
    await assert.rejects(api().tags.setEntry(STRAP, { tags: ["ghost"], tier: 1, name: "S" }), /"ghost" is not a tag yet/);
    await assert.rejects(api().tags.setEntry(STRAP, { tags: [], tier: 1, name: "S" }), /at least one tag/);
    await assert.rejects(api().tags.setEntry(STRAP, { tags: ["venom-tooth"], tier: 9, name: "S" }), /from 1 to 5/);
  });
  assert.deepEqual(getLedger().items, {}, "nothing was written");
  assert.equal(env.values.tagLedger, undefined);
});
test("LEDGER: Untag removes the entry; untagging something never tagged is refused", async () => {
  const w = await tagged();
  await as(w.gm, async () => {
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 1, name: "Tooth" });
    await api().tags.removeEntry(TOOTH);
    await assert.rejects(api().tags.removeEntry(TOOTH), /not tagged/);
  });
  assert.deepEqual(getLedger().items, {});
});
test("SLOT NEEDS: setSlotNeeds is an editor patch (validated, revertable); unknown tags, unknown slots and empty needs are refused", async () => {
  const w = await tagged();
  await as(w.gm, async () => {
    const slot = await api().tags.setSlotNeeds(DAGGER, "fang", { all: ["venom-tooth"], optional: true });
    assert.deepEqual(slot.needs, { all: ["venom-tooth"], optional: true });
    assert.deepEqual(api().editor.entry(`recipe:${DAGGER}`).editedFields, ["slots"]);
    await assert.rejects(api().tags.setSlotNeeds(DAGGER, "fang", { all: ["ghost"] }), /"ghost" is not a tag yet/);
    await assert.rejects(api().tags.setSlotNeeds(DAGGER, "fang", { all: [] }), /at least one tag/);
    await assert.rejects(api().tags.setSlotNeeds(DAGGER, "nope", { all: ["venom-tooth"] }), /has no slot "nope"/);
    await assert.rejects(api().tags.setSlotNeeds("no-recipe", "fang", { all: ["venom-tooth"] }), /There is no recipe/);
    const back = await api().tags.setSlotNeeds(DAGGER, "fang", null);
    assert.equal(back.needs, undefined, "back to the tier rule");
    await api().tags.setSlotNeeds(DAGGER, "fang", { all: ["venom-tooth"] });
    await api().editor.revert(`recipe:${DAGGER}`);
    assert.equal(api().definitions.recipe.get(DAGGER).slots.find(s => s.name === "fang").needs, undefined, "revert restores the pack's slot");
  });
  await assert.rejects(as(w.annUser, () => api().tags.setSlotNeeds(DAGGER, "fang", { all: ["venom-tooth"] })), /GM only/);
});
test("STACKS: an ordinary item counts as a stack only while the GM has it tagged", async () => {
  const w = await tagged();
  await give(w.ann, "Wolf Tooth", TOOTH, 3);
  const adapter = await import("../scripts/adapter/pf2e.js");
  assert.equal(adapter.getMaterialStacks(w.ann).some(s => s.materialId === TOOTH), false);
  await as(w.gm, () => api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Wolf Tooth" }));
  const stack = adapter.getMaterialStacks(w.ann).find(s => s.materialId === TOOTH);
  assert.equal(stack.quantity, 3);
  await as(w.gm, () => api().tags.removeEntry(TOOTH));
  assert.equal(adapter.getMaterialStacks(w.ann).some(s => s.materialId === TOOTH), false);
  // with OTHER items tagged, an untagged ordinary item is still not a stack
  await give(w.ann, "Plain Strap", STRAP, 1);
  await as(w.gm, () => api().tags.setEntry(STRAP, { tags: ["venom-tooth"], tier: 1, name: "Plain Strap" }));
  const ids = adapter.getMaterialStacks(w.ann).map(s => s.materialId);
  assert.equal(ids.includes(STRAP), true); assert.equal(ids.includes(TOOTH), false);
});

async function ready() {
  const w = await tagged();
  await give(w.ann, "Wolf Tooth", TOOTH, 2);
  await give(w.ann, "Plain Strap", STRAP, 1);
  await as(w.gm, async () => {
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Wolf Tooth" });
    await api().tags.setEntry("spider-fang", { tags: ["venom-tooth"] });
    await api().tags.setSlotNeeds(DAGGER, "fang", { all: ["venom-tooth"] });
  });
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}

test("CRAFT: a tagged slot takes the GM's tagged PF2e item; it is consumed; the crafted item remembers it", async () => {
  const w = await ready();
  const pv = await as(w.gm, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: TOOTH }, "oakhaven-forge"));
  assert.ok(pv.ok, pv.errors?.join(" | "));
  assert.deepEqual(pv.plan.uses.map(u => [u.slot, u.materialId, u.materialName]), [["blade", "iron", "Iron"], ["fang", TOOTH, "Wolf Tooth"]]);
  const bad = await as(w.gm, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: STRAP }, "oakhaven-forge"));
  assert.equal(bad.ok, false); assert.match(bad.errors.join(" "), /cannot fill this slot \(the GM has not tagged it\)/);
  const queued = await craft(w, w.annUser, w.ann, { selection: { blade: "iron", fang: TOOTH } });
  await as(w.gm, () => resolve(w.ann, queued.id));
  const strap = w.ann.items.find(i => i.name === "Plain Strap"), tooth = w.ann.items.find(i => i.name === "Wolf Tooth");
  assert.ok(strap, "the untagged item was left alone");
  assert.equal(tooth.system.quantity, 1, "one tooth used");
  const made = w.ann.items.find(i => i.getFlag(M, "crafted"));
  assert.deepEqual(made.getFlag(M, "crafted").materials.map(m => [m.slot, m.materialId]), [["blade", "iron"], ["fang", TOOTH]]);
});
test("OLD RECIPES: a slot without needs behaves exactly as before, tagged items or not", async () => {
  const w = await tagged();
  await give(w.ann, "Wolf Tooth", TOOTH, 2);
  await as(w.gm, () => api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Wolf Tooth" }));
  const r = await as(w.gm, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: TOOTH }, "oakhaven-forge"));
  assert.equal(r.ok, false); assert.match(r.errors.join(" "), /unknown material/);
  const ok = await as(w.gm, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: "spider-fang" }, "oakhaven-forge"));
  assert.ok(ok.ok, ok.errors?.join(" | "));
});

test("PLAYERS: the copy has no tags, no needs, no tier for a ledger item; each tagged slot lists only what this character holds and fits; and the leak scan passes", async () => {
  const w = await ready();
  const copy = [...(await as(w.annUser, () => api().definitions)).recipe.values()];
  const slot = copy.find(r => r.id === DAGGER).slots.find(s => s.name === "fang");
  assert.equal(slot.needs, undefined);
  assert.equal(slot.optional, false);
  assert.deepEqual(slot.fits.map(f => f.id).sort(), [TOOTH, "spider-fang"].sort(), "the strap is not there: it is untagged");
  assert.deepEqual(slot.fits.find(f => f.id === TOOTH), { id: TOOTH, name: "Wolf Tooth" });
  const reg = await as(w.annUser, () => api().definitions);
  assert.deepEqual(findTagLeaks(reg, { ledgerOnlyRefs: [TOOTH, STRAP], neededTags: ["venom-tooth"] }), []);
  // the old blade slot has no `fits` at all: unchanged
  assert.equal(copy.find(r => r.id === DAGGER).slots.find(s => s.name === "blade").fits, undefined);
  // the tag definitions the player may hold never carry the GM's priority
  for (const t of reg.tag.values()) assert.equal("priority" in t, false);
});
test("PLAYERS: a player previews and crafts with the fitting item, and an item that does not fit is refused without saying why in tags", async () => {
  const w = await ready();
  const ok = await as(w.annUser, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: TOOTH }, "oakhaven-forge"));
  assert.ok(ok.ok, ok.errors?.join(" | "));
  const bad = await as(w.annUser, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: STRAP }, "oakhaven-forge"));
  assert.equal(bad.ok, false);
  assert.equal(findTagLeaks([{ data: bad }], { neededTags: ["venom-tooth"] }).length, 0);
  assert.doesNotMatch(JSON.stringify(bad), /venom-tooth|Venom Tooth/);
  const queued = await craft(w, w.annUser, w.ann, { selection: { blade: "iron", fang: TOOTH } });
  assert.ok(queued.id);
});
test("PLAYERS: tagging a new item after the player has loaded refreshes their list (the ledger is part of the revision)", async () => {
  const w = await ready();
  await give(w.ann, "Second Tooth", "Compendium.pf2e.equipment-srd.Item.UUUUUUUUUUUUUUUU");
  await as(w.annUser, () => api().definitions.refresh());
  const fits = () => as(w.annUser, () => api().definitions.recipe.get(DAGGER).slots.find(s => s.name === "fang").fits.map(f => f.id));
  assert.equal((await fits()).includes("Compendium.pf2e.equipment-srd.Item.UUUUUUUUUUUUUUUU"), false);
  await as(w.gm, () => api().tags.setEntry("Compendium.pf2e.equipment-srd.Item.UUUUUUUUUUUUUUUU", { tags: ["venom-tooth"], tier: 2, name: "Second Tooth" }));
  await as(w.annUser, () => api().definitions.refresh());
  assert.equal((await fits()).includes("Compendium.pf2e.equipment-srd.Item.UUUUUUUUUUUUUUUU"), true);
  void makeActor; void gm;
});
