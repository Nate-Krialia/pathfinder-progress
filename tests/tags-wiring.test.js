/**
 * Tag system Slice 1 through the real main.js in the fake Foundry (docs/22-tags-slice1.md): the GM-only ledger, a recipe slot that needs tags, an ordinary PF2e item filling it,
 * the craft itself, the player's copy (no tags, no tiers) and the leak scan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, as, craft, env, getApi, makeActor, resolve, world } from "./fake-world.js";
import { asPage, findCanaries, findTagLeaks, seedRecords } from "./helpers.js";
import { getLedger } from "../scripts/tags/current.js";
import { decodeLedger } from "../scripts/tags/ledger.js";
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
  assert.deepEqual(decodeLedger(env.values.tagLedger).items[TOOTH], { tags: ["venom-tooth", "sharp-edge"], tier: 2, name: "Wolf Tooth" });
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

// Item references: which field names an ordinary item ---------------------------------------------------------------------
const WORLD_ITEM = "Item.WWWWWWWWWWWWWWWW";
const stackIds = async actor => (await import("../scripts/adapter/pf2e.js")).getMaterialStacks(actor).map(s => s.materialId);
const giveWith = (actor, name, extra) => actor.createEmbeddedDocuments("Item", [{ name, type: "equipment", system: { quantity: 1 }, ...extra }]);
const tagRef = (w, ref) => as(w.gm, () => api().tags.setEntry(ref, { tags: ["venom-tooth"], tier: 2, name: "Thing" }));

test("REF 1 (primary): a copy made from a COMPENDIUM item matches the compendium item's uuid via _stats.compendiumSource", async () => {
  const w = await tagged();
  await giveWith(w.ann, "Copy", { _stats: { compendiumSource: TOOTH } });
  await tagRef(w, TOOTH);
  assert.ok((await stackIds(w.ann)).includes(TOOTH));
});
test("REF 1: the compendium item is ONE shared entry: every actor's copy of it counts once it is tagged", async () => {
  const w = await tagged();
  await giveWith(w.ann, "Copy", { _stats: { compendiumSource: TOOTH } });
  await giveWith(w.bob, "Copy", { _stats: { compendiumSource: TOOTH } });
  await tagRef(w, TOOTH);
  assert.ok((await stackIds(w.ann)).includes(TOOTH)); assert.ok((await stackIds(w.bob)).includes(TOOTH));
});
test("REF 1 beats the fallbacks: when compendiumSource AND the legacy flag name different tagged items, compendiumSource wins", async () => {
  const w = await tagged();
  await giveWith(w.ann, "Both", { _stats: { compendiumSource: TOOTH }, flags: { core: { sourceId: STRAP } } });
  await tagRef(w, TOOTH); await tagRef(w, STRAP);
  const ids = (await stackIds(w.ann)).filter(x => x === TOOTH || x === STRAP);
  assert.deepEqual(ids, [TOOTH]);
});
test("REF 2: _stats.duplicateSource matches a world item that was copied onto an actor (UNVERIFIED that Foundry sets it on a drop)", async () => {
  const w = await tagged();
  await giveWith(w.ann, "Copy of a world item", { _stats: { duplicateSource: WORLD_ITEM } });
  assert.ok(!(await stackIds(w.ann)).includes(WORLD_ITEM), "untagged: not a stack");
  await tagRef(w, WORLD_ITEM);
  assert.ok((await stackIds(w.ann)).includes(WORLD_ITEM));
});
test("REF 3 (legacy fallback): flags.core.sourceId still matches an item that has no _stats source", async () => {
  const w = await tagged();
  await giveWith(w.ann, "Old copy", { flags: { core: { sourceId: TOOTH } } });
  await tagRef(w, TOOTH);
  assert.ok((await stackIds(w.ann)).includes(TOOTH));
});
test("REF 4 (own uuid): an item tagged by its OWN uuid matches only that document, not its siblings", async () => {
  const w = await tagged();
  const [one] = await giveWith(w.ann, "One", {}); const [two] = await giveWith(w.ann, "Two", {});
  Object.defineProperty(one, "uuid", { value: "Actor.ann.Item.one" }); Object.defineProperty(two, "uuid", { value: "Actor.ann.Item.two" });
  await tagRef(w, "Actor.ann.Item.one");
  const ids = await stackIds(w.ann);
  assert.ok(ids.includes("Actor.ann.Item.one")); assert.ok(!ids.includes("Actor.ann.Item.two"));
});
test("REF: an item with none of these fields in the ledger is not a stack, and a duplicate whose duplicateSource is another actor's copy still matches by its compendiumSource", async () => {
  const w = await tagged();
  await giveWith(w.ann, "Dup", { _stats: { compendiumSource: TOOTH, duplicateSource: "Actor.other.Item.copy" } });
  await giveWith(w.ann, "Stranger", { _stats: { compendiumSource: STRAP } });
  await tagRef(w, TOOTH);
  const ids = await stackIds(w.ann);
  assert.ok(ids.includes(TOOTH)); assert.ok(!ids.includes(STRAP));
});
test("REF: the candidates are listed in the documented order, without repeats or blanks", async () => {
  const { itemRefCandidates, itemRefOf } = await import("../scripts/adapter/pf2e.js");
  const item = { _stats: { compendiumSource: "A", duplicateSource: "B" }, flags: { core: { sourceId: "C" } }, uuid: "D" };
  assert.deepEqual(itemRefCandidates(item), ["A", "B", "C", "D"]);
  assert.deepEqual(itemRefCandidates({ _stats: { compendiumSource: "A", duplicateSource: "A" }, uuid: "" }), ["A"]);
  assert.deepEqual(itemRefCandidates({}), []);
  assert.equal(itemRefOf(item), "A"); assert.equal(itemRefOf(item, new Set(["C"])), "C"); assert.equal(itemRefOf({}), null);
});

// Slice 2a: tag effects through the real main.js, and the canary leak scan ---------------------------------------------------------

const CANARIES = ["5d10", "6d10", "7d12", "CANARY-GHOST-TEXT", '"priority":913', '"maxValue":83', "effectBlocks", "byTier", "capNotes", "tagCaps", "contributions", '"needs"', '"tagLedger"'];
const allText = x => JSON.stringify(x, (k, v) => (v instanceof Map ? [...v.values()] : v instanceof Set ? [...v] : v));

async function effectsWorld() {
  const w = await tagged();
  await give(w.ann, "Wolf Tooth", TOOTH, 2);
  await as(w.gm, async () => {
    // the tag the craft uses: canary entries at the tiers nobody uses, an ability with a canary text, a GM priority
    await api().editor.update("tag:venom-tooth", {
      priority: 913,
      effectBlocks: { byClass: { weapon: { blocks: [
        { type: "damage", dice: { byTier: { 1: "1d4", 2: "2d6", 3: "1d8", 4: "5d10", 5: "6d10" } }, damageType: "poison" },
        { type: "ability", title: "Venom Bite", text: "CANARY-USED-TEXT" }
      ] } } }
    }, { confirmed: true });
    // a tag nothing here carries: all its numbers and words are canaries
    await api().editor.create("tag", { name: "Ghost", theme: "boo", effectBlocks: { general: { blocks: [{ type: "damage", dice: { all: "7d12" }, damageType: "fire" }, { type: "ability", title: "Boo", text: "CANARY-GHOST-TEXT" }] } } }, { makeItem: false });
    await api().editor.update("material:spider-fang", { tag: "venom-tooth" }, { confirmed: true });     // so a player holding it may be sent the tag's record
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Wolf Tooth" });
    await api().tags.setSlotNeeds(DAGGER, "fang", { all: ["venom-tooth"] });
    await api().tags.setCaps({ v: 1, roles: { resistance: { maxValue: 83 }, bonusDamage: { maxDicePerType: 1 } } });
  });
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}

test("S2a END TO END: the tag's effect is scaled by the ingredient's tier, the GM's cap clamps it, and the clamp is noted for the GM only", async () => {
  const w = await effectsWorld();
  const pv = await as(w.gm, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: TOOTH }, "oakhaven-forge"));
  assert.ok(pv.ok, pv.errors?.join(" | "));
  assert.deepEqual(pv.plan.description.damageBonuses.map(d => `${d.dice} ${d.type}`), ["1d6 poison"], "tier 2 gives 2d6; the cap of 1 die per type clamps it; tiers 4 and 5 (the canaries) are not used");
  assert.deepEqual(pv.plan.capNotes, ["capped bonusDamage (poison): 2 dice became 1"]);
  assert.deepEqual(pv.plan.description.abilities.map(a => a.title), ["Venom Bite"]);
  const queued = await craft(w, w.annUser, w.ann, { selection: { blade: "iron", fang: TOOTH } });
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const made = w.ann.items.find(i => i.getFlag(M, "crafted"));
  assert.ok(made, "the item was made");
  assert.match(made.system.description.value, /\+1d6 poison/); assert.match(made.system.description.value, /Venom Bite/);
  const log = await as(w.gm, () => api().gm.log());
  assert.ok(log.some(e => /capped bonusDamage \(poison\): 2 dice became 1/.test(e.text)), "the GM log has the clamp");
  assert.ok(!env.chat.some(m => /capped/i.test(m.content ?? "")), "no chat message mentions a cap");
});

test("S2a CANARIES: nothing the GM authored for tag effects, caps or priority reaches anything a player can read", async () => {
  const w = await effectsWorld();
  const ann = w.annUser;
  const registry = await as(ann, () => api().definitions);
  const tagRecord = registry.tag.get("venom-tooth");
  assert.ok(tagRecord, "the player may hold the tag's record (the discovery system sends it with spider-fang)");
  assert.equal("effectBlocks" in tagRecord, false); assert.equal("priority" in tagRecord, false);
  const preview = await as(ann, () => api().previewCraft(w.ann, DAGGER, { blade: "iron", fang: TOOTH }, "oakhaven-forge"));
  assert.ok(preview.ok, preview.errors?.join(" | "));
  const queued = await craft(w, ann, w.ann, { selection: { blade: "iron", fang: TOOTH } });
  const queueRows = await as(ann, () => api().queue.list([w.ann]));
  const compendium = await as(ann, () => api().compendium.view(w.ann));
  const before = { definitions: allText(registry), preview: allText(preview), queue: allText(queueRows), compendium: allText(compendium), actorFlags: allText(w.ann.rawFlags()), tagRecord: allText(tagRecord) };
  const noUsedText = [...CANARIES, "CANARY-USED-TEXT"];
  assert.deepEqual(findCanaries(before, noUsedText), [], "before the craft");
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const made = w.ann.items.find(i => i.getFlag(M, "crafted"));
  const after = { chat: allText(env.chat), actorFlags: allText(w.ann.rawFlags()), craftedFlag: allText(made.flags[M]), compendium: allText(await as(ann, () => api().compendium.view(w.ann))), definitions: allText(await as(ann, () => api().definitions)) };
  assert.deepEqual(findCanaries(after, CANARIES), [], "after the craft (the item's own final stats may carry its own numbers, never the tag's tables)");
});

test("S2a CANARIES: the scan itself fails when a tag effect is planted in a player copy (a scan that cannot fail proves nothing)", async () => {
  const w = await effectsWorld();
  const registry = await as(w.annUser, () => api().definitions);
  const planted = structuredClone(registry.tag.get("venom-tooth"));
  planted.effectBlocks = { general: { blocks: [{ type: "damage", dice: { byTier: { 4: "5d10" } } }] } };
  assert.ok(findCanaries({ tag: allText(planted) }, CANARIES).length >= 2);
  const slot = structuredClone(registry.recipe.get(DAGGER).slots.find(s => s.name === "fang"));
  slot.needs = { all: ["venom-tooth"] };
  assert.ok(findCanaries({ slot: allText(slot) }, CANARIES).length >= 1);
  assert.ok(findTagLeaks([{ data: planted }], {}).length >= 1);
});

// refsOf: the console helper the real-Foundry item-reference probe prints for every copy -------------------------------------------------------------------------------
const NEEDS_TOOTH = { all: ["venom-tooth"] };
test("REFSOF: candidates, the matched reference, tags, tier and the slots that would accept the item (an Item document and a uuid string both work)", async () => {
  const w = await tagged();
  const item = (await give(w.ann, "Copy", STRAP).then(() => w.ann.items.at(-1)));
  Object.assign(item, { _stats: { compendiumSource: TOOTH, duplicateSource: "Item.WORLD" }, uuid: `Actor.${w.ann.id}.Item.${item.id}` });
  await as(w.gm, async () => {
    await api().tags.setSlotNeeds(DAGGER, "fang", NEEDS_TOOTH);
    const before = await api().tags.refsOf(item);
    assert.deepEqual(before, { candidates: [TOOTH, "Item.WORLD", STRAP, item.uuid], matched: null, tags: [], tier: null, fitsBySlot: {} }, "untagged: the candidates are listed, nothing matches");
    await api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Tooth" });
    const after = await api().tags.refsOf(item);
    assert.equal(after.matched, TOOTH);
    assert.deepEqual([after.tags, after.tier], [["venom-tooth"], 2]);
    assert.deepEqual(after.fitsBySlot, { [`${DAGGER}/fang`]: DAGGER });
    globalThis.fromUuid = async uuid => (uuid === item.uuid ? item : null);
    assert.deepEqual(await api().tags.refsOf(item.uuid), after, "a uuid string gives the same answer");
    await assert.rejects(api().tags.refsOf("Actor.nope.Item.nope"), /could not find an item/);
    // a later candidate that is tagged is matched when the earlier ones are not
    await api().tags.removeEntry(TOOTH);
    await api().tags.setEntry(item.uuid, { tags: ["venom-tooth"], tier: 3, name: "Own copy" });
    assert.equal((await api().tags.refsOf(item)).matched, item.uuid);
  });
});
test("REFSOF: a crafted item matches through its frozen record (crafted:<freezeId>)", async () => {
  const w = await tagged();
  const item = (await give(w.ann, "Made", null).then(() => w.ann.items.at(-1)));
  Object.assign(item, { flags: { [M]: { crafted: { freezeId: "fz1" } } } });
  const { setCurrentFrozen } = await import("../scripts/tags/current.js");
  setCurrentFrozen({ v: 1, items: { fz1: { recipeId: DAGGER, name: "Made", tier: 2, native: ["venom-tooth"], inherited: [], uses: [], roles: {}, contributions: [] } } });
  const out = await as(w.gm, () => api().tags.refsOf(item));
  assert.deepEqual([out.candidates[0], out.matched, out.tags, out.tier], ["crafted:fz1", "crafted:fz1", ["venom-tooth"], 2]);
  setCurrentFrozen(null);
});
test("REFSOF: GM only; a player client is refused and learns nothing", async () => {
  const w = await tagged();
  await give(w.ann, "Copy", TOOTH);
  const item = w.ann.items.at(-1);
  await as(w.gm, () => api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Tooth" }));
  await assert.rejects(as(globalThis.game.users.find(u => !u.isGM), () => api().tags.refsOf(item)), /GM only/);
});

// E-003-like real-Foundry finding (gate 22, Step 7): a uuid has dots in it, and Foundry reads a dot in a key as a path --------------------------------------------------------
import { encodeLedger } from "../scripts/tags/ledger.js";

/** What the fake's settings.set does when it behaves like the real one for a dotted key: it rewrites the object it was GIVEN, in place, into nested objects, and stores that. */
function foundryReadsDotsAsPaths() {
  const set = globalThis.game.settings.set;
  globalThis.game.settings.set = async (scope, key, value) => {
    if (key === "tagLedger") {
      for (const flat of Object.keys(value.items ?? {}).filter(k => k.includes("."))) {
        const entry = value.items[flat]; delete value.items[flat];
        let node = value.items; const path = flat.split(".");
        for (const part of path.slice(0, -1)) node = node[part] ??= {};
        node[path.at(-1)] = entry;
      }
    }
    return set(scope, key, value);
  };
  return () => { globalThis.game.settings.set = set; };
}
test("DOTTED KEYS: the ledger is saved without dots, so a uuid tag matches right after the write, survives a reload and can be taken off", async () => {
  const w = await tagged();
  const restore = foundryReadsDotsAsPaths();
  try {
    await giveWith(w.ann, "Copy", { _stats: { compendiumSource: TOOTH } });
    const copy = w.ann.items.at(-1);
    await as(w.gm, () => api().tags.setEntry(TOOTH, { tags: ["venom-tooth"], tier: 2, name: "Wolf Tooth" }));
    const now = await as(w.gm, () => api().tags.refsOf(copy));
    assert.deepEqual([now.matched, now.tags, now.tier], [TOOTH, ["venom-tooth"], 2], "matches straight after the write");
    assert.ok(Object.keys(env.values.tagLedger.items).every(k => !k.includes(".")), `nothing with a dot in it was saved: ${Object.keys(env.values.tagLedger.items)}`);
    await as(w.gm, async () => { loadLedger(); });
    assert.deepEqual((await as(w.gm, () => api().tags.refsOf(copy))).matched, TOOTH, "still matches after the ledger is read back (a reload)");
    assert.deepEqual(Object.keys(getLedger().items), [TOOTH], "the reference is the real uuid again in memory");
    await as(w.gm, () => api().tags.removeEntry(TOOTH));
    assert.equal((await as(w.gm, () => api().tags.refsOf(copy))).matched, null, "untagged");
    await as(w.gm, async () => { loadLedger(); });
    assert.deepEqual(Object.keys(getLedger().items), [], "and it stays untagged after a reload");
  } finally { restore(); }
});
test("DOTTED KEYS: encodeLedger / decodeLedger round-trip any reference, including one with a percent sign", () => {
  const ledger = { v: 1, items: { [TOOTH]: { tags: ["a"] }, "Item.abc": { tags: ["b"] }, "spider-fang": { tags: ["c"] }, "odd%2E.name": { tags: ["d"] } } };
  const stored = encodeLedger(ledger);
  assert.ok(Object.keys(stored.items).every(k => !k.includes(".")));
  assert.deepEqual(decodeLedger(stored), ledger);
});
