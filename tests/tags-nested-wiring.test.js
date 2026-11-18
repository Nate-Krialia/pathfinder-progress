/** Tag system, Slice 3a through the real main.js in the fake Foundry: craft something, use it as an ingredient of another craft, cancel, hit the depth limit, players. */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, as, craft, env, fireHookAs, getApi, resolve, world } from "./fake-world.js";
import { UUID, UUID_2, asPage, findCanaries, findTagLeaks, seedRecords } from "./helpers.js";
import { removeFrozen, getFrozenStore } from "../scripts/tags/state.js";

const api = () => getApi();
const text = x => JSON.stringify(x, (k, v) => (v instanceof Map ? [...v.values()] : v instanceof Set ? [...v] : v));
const ref = id => `crafted:${id}`;

async function nestedWorld({ pass } = {}) {
  const dagger = seedRecords().map(r => r.data).find(d => d.id === DAGGER);
  const mount = {
    ...structuredClone(dagger), id: "mount-blade", name: "Mount Blade", resultName: "Mounted Blade", category: "weapon",
    slots: [{ name: "edge", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "mount", drives: "bonusDamage", qty: 1, needs: { all: ["metal-bit"] } }]
  };
  if (pass !== undefined) mount.slots[1].passCap = pass;
  const grand = { ...structuredClone(mount), id: "grand-blade", name: "Grand Blade", resultName: "Grand Blade" };
  grand.slots[1] = { name: "mount", drives: "bonusDamage", qty: 1, needs: { all: ["metal-bit"] } };
  delete mount.overrides; delete grand.overrides;
  const w = await world({ perClientDefinitions: true, downtime: 30, iron: 8, fang: 4 });
  api().baseSources = [...seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), { pack: "t", entry: "mount-blade", text: asPage(mount) }, { pack: "t", entry: "grand-blade", text: asPage(grand) }];
  api().editorLeftovers = [];
  await as(w.gm, async () => {
    await api().editor.create("tag", { name: "Metal Bit", theme: "bits", effectBlocks: { general: { blocks: [{ type: "damage", dice: { byTier: { 1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10", 5: "1d12" } }, damageType: "poison" }] } } }, { makeItem: false });   // also rebuilds the registry with the extra recipe
    await api().tags.setEntry(DAGGER, { tags: ["metal-bit"], tier: 2, name: "Spider Fang Dagger" });
    await api().grantFormula(w.ann, "mount-blade"); await api().grantFormula(w.ann, "grand-blade");
  });
  for (const id of ["mount-blade", "grand-blade"]) api().resolvedOutputs.set(id, { "1": UUID, "2": UUID_2, "3": UUID });
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}
const craftDagger = async w => {
  const queued = await craft(w, w.annUser, w.ann, {});
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  return w.ann.items.filter(i => i.getFlag(M, "crafted")).at(-1);
};
const mountSel = id => ({ recipe: "mount-blade", selection: { edge: "iron", mount: ref(id) } });
const stackRefs = async w => (await import("../scripts/adapter/pf2e.js")).getMaterialStacks(w.ann).map(s => s.materialId);

test("3a: a craft whose recipe the GM tagged is frozen with the GM's tier and tags; the item is then an ingredient under crafted:<freezeId>", async () => {
  const w = await nestedWorld();
  const made = await craftDagger(w);
  const flag = made.getFlag(M, "crafted");
  const rec = env.values.tagCrafted.items[flag.freezeId];
  assert.deepEqual([rec.recipeId, rec.name, rec.tier, rec.depth, rec.native, rec.inherited], [DAGGER, "Spider Fang Dagger", 2, 1, ["metal-bit"], []]);
  assert.ok((await stackRefs(w)).includes(ref(flag.freezeId)), "it is a stack under its own reference");
});
test("3a: it fills a tagged slot; its tag's effect is scaled by the item's tier; the item is consumed; the new record embeds the old one", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  const pv = await as(w.gm, () => api().previewCraft(w.ann, "mount-blade", { edge: "iron", mount: ref(id) }, "oakhaven-forge"));
  assert.ok(pv.ok, pv.errors?.join(" | "));
  assert.deepEqual(pv.plan.description.damageBonuses.map(d => d.dice), ["1d6"], "the dagger is tier 2");
  const queued = await craft(w, w.annUser, w.ann, mountSel(id));
  assert.ok(!w.ann.items.some(i => i === dagger), "queueing took the dagger out of the bag (escrow)");
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const outer = w.ann.items.filter(i => i.getFlag(M, "crafted")).at(-1);
  const orec = env.values.tagCrafted.items[outer.getFlag(M, "crafted").freezeId];
  assert.equal(orec.depth, 2);
  const used = orec.uses.find(u => u.slot === "mount");
  assert.deepEqual(Object.keys(used.from).sort(), ["depth", "inherited", "name", "native", "recipeId", "tier", "uses"], "a small provenance copy, not the whole inner record");
  assert.equal(used.ref, ref(id)); assert.equal(used.from.recipeId, DAGGER); assert.deepEqual(used.from.native, ["metal-bit"]);
  assert.match(outer.system.description.value, /\+1d6 poison/);
  // the used-up dagger took its record with it, and the outer craft's provenance does not depend on it
  assert.equal(env.values.tagCrafted.items[id], undefined);
  assert.equal(env.values.tagCrafted.items[outer.getFlag(M, "crafted").freezeId].uses.find(u => u.slot === "mount").from.recipeId, DAGGER);
});
test("3a: cancelling the queued craft hands back THE DAGGER (same crafted flag, same name), and its frozen record comes back with it", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  const queued = await craft(w, w.annUser, w.ann, mountSel(id));
  await as(w.gm, () => fireHookAs(w.gm, "deleteItem", [dagger]));                // the hook the moment the item left the bag: a held record must survive it
  assert.ok(getFrozenStore().items[id]?.held, "held while in escrow");
  assert.equal(text(w.ann.rawFlags()).includes("metal-bit"), false, "the queued action (an actor flag) carries no record");
  await as(w.gm, () => api().tags.pruneFrozen());
  assert.ok(getFrozenStore().items[id], "prune leaves a held record");
  await as(w.gm, () => api().queue.reject(w.ann, queued.id, { chat: false }));
  const back = w.ann.items.find(i => i.getFlag(M, "crafted")?.freezeId === id);
  assert.ok(back, "the crafted item is back");
  assert.equal(back.name, dagger.name); assert.equal(back.system.quantity, 1);
  assert.ok(getFrozenStore().items[id] && !getFrozenStore().items[id].held, "its record is released");
  assert.ok((await stackRefs(w)).includes(ref(id)), "it can be an ingredient again");
  const names = w.ann.items.map(i => i.name);
  assert.equal(names.filter(n => n === dagger.name).length, 1, "one dagger, not a stand-in plus a dagger");
});
test("3a: a failed craft hands back the unused crafted ingredient as the real item", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  const queued = await craft(w, w.annUser, w.ann, mountSel(id));
  await as(w.gm, () => resolve(w.ann, queued.id, { degree: "criticalFailure", chat: false }));      // everything is lost on a critical failure: nothing comes back
  assert.ok(!w.ann.items.some(i => i.getFlag(M, "crafted")?.freezeId === id));
  const w2 = await nestedWorld();
  const d2 = await craftDagger(w2);
  const id2 = d2.getFlag(M, "crafted").freezeId;
  const q2 = await craft(w2, w2.annUser, w2.ann, mountSel(id2));
  await as(w2.gm, () => resolve(w2.ann, q2.id, { degree: "failure", chat: false }));
  const survivors = w2.ann.items.filter(i => i.getFlag(M, "crafted")?.freezeId === id2);
  assert.ok(survivors.length <= 1);
  if (survivors.length) assert.ok(getFrozenStore().items[id2], "a surviving dagger has its record again");
});
test("3a: the nesting limit refuses the craft in plain words and takes nothing", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  await as(w.gm, () => api().tags.setCaps({ v: 1, roles: {}, limits: { maxDepth: 1 } }));
  await assert.rejects(craft(w, w.annUser, w.ann, mountSel(id)), /nest crafted items 2 deep; the limit is 1/);
  assert.ok(w.ann.items.includes(dagger), "nothing was taken");
  assert.equal((await as(w.gm, () => api().tags.caps())).limits.maxDepth, 1);
});
test("3a: an old crafted item (no freeze id) or one whose record is gone is simply not an ingredient", async () => {
  const w = await nestedWorld();
  const made = await craftDagger(w);
  const id = made.getFlag(M, "crafted").freezeId;
  await as(w.gm, () => removeFrozen(id));
  assert.ok(!(await stackRefs(w)).includes(ref(id)));
  await assert.rejects(craft(w, w.annUser, w.ann, mountSel(id)), /cannot fill this slot|no stack|needs 1/);
});
test("3a: players see a crafted ingredient only as a fits entry (opaque reference, the item's name); canaries find nothing", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  await as(w.annUser, () => api().definitions.refresh());
  const registry = await as(w.annUser, () => api().definitions);
  const slot = registry.recipe.get("mount-blade").slots.find(s => s.name === "mount");
  assert.deepEqual(slot.fits, [{ id: ref(id), name: "Spider Fang Dagger" }]);
  assert.equal("needs" in slot, false);
  const pv = await as(w.annUser, () => api().previewCraft(w.ann, "mount-blade", { edge: "iron", mount: ref(id) }, "oakhaven-forge"));
  assert.ok(pv.ok, pv.errors?.join(" | "));
  const queued = await craft(w, w.annUser, w.ann, mountSel(id));
  const rows = await as(w.annUser, () => api().queue.list([w.ann]));
  await as(w.gm, () => resolve(w.ann, queued.id, { chat: true }));
  const outer = w.ann.items.filter(i => i.getFlag(M, "crafted")).at(-1);
  const C = ["metal-bit", "Metal Bit", '"native"', '"inherited"', '"contributions"', '"depth"', "tagCrafted", "effectBlocks", "byTier", '"passCap"', '"outputTags"'];
  const payloads = { definitions: text(registry), preview: text(pv), queue: text(rows), compendium: text(await as(w.annUser, () => api().compendium.view(w.ann))), actorFlags: text(w.ann.rawFlags()), itemFlags: text(outer.flags[M]), chat: text(env.chat) };
  assert.deepEqual(findCanaries(payloads, C), []);
  assert.deepEqual(findTagLeaks(registry, { neededTags: ["metal-bit"] }), []);
  void fireHookAs;
});

const lastCrafted = w => w.ann.items.filter(i => i.getFlag(M, "crafted")).at(-1);
test("3b: a slot with passCap hands the dagger's tags up; the mount blade then fills a metal-bit slot of a THIRD recipe, at the dagger's tier, three deep", async () => {
  const w = await nestedWorld({ pass: true });
  const dagger = await craftDagger(w);
  const did = dagger.getFlag(M, "crafted").freezeId;
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, mountSel(did))).id, { chat: true });
  const blade = lastCrafted(w);
  const bid = blade.getFlag(M, "crafted").freezeId;
  const rec = env.values.tagCrafted.items[bid];
  assert.deepEqual(rec.inherited, [{ tag: "metal-bit", tier: 2 }], "the dagger's tag, at the dagger's tier");
  assert.deepEqual(rec.native, [], "the GM tagged only the dagger recipe");
  const pv = await as(w.gm, () => api().previewCraft(w.ann, "grand-blade", { edge: "iron", mount: ref(bid) }, "oakhaven-forge"));
  assert.ok(pv.ok, pv.errors?.join(" | "));
  assert.deepEqual(pv.plan.description.damageBonuses.map(d => d.dice), ["1d6"], "the inherited tag counts at its ORIGINAL tier 2, not the blade's");
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { recipe: "grand-blade", selection: { edge: "iron", mount: ref(bid) } })).id, { chat: true });
  assert.equal(env.values.tagCrafted.items[lastCrafted(w).getFlag(M, "crafted").freezeId].depth, 3);
});
test("3b: without passCap the mount blade carries nothing up, so it cannot fill the third recipe's tagged slot", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, mountSel(dagger.getFlag(M, "crafted").freezeId))).id, { chat: true });
  const bid = lastCrafted(w).getFlag(M, "crafted").freezeId;
  assert.deepEqual(env.values.tagCrafted.items[bid]?.inherited ?? [], []);
  const pv = await as(w.gm, () => api().previewCraft(w.ann, "grand-blade", { edge: "iron", mount: ref(bid) }, "oakhaven-forge"));
  assert.equal(pv.ok, false);
});
test("3b: nothing about inheritance reaches a player (passCap, inherited tags, tiers, the embedded provenance)", async () => {
  const w = await nestedWorld({ pass: true });
  const dagger = await craftDagger(w);
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, mountSel(dagger.getFlag(M, "crafted").freezeId))).id, { chat: true });
  const blade = lastCrafted(w);
  await as(w.annUser, () => api().definitions.refresh());
  const registry = await as(w.annUser, () => api().definitions);
  const slot = registry.recipe.get("mount-blade").slots.find(s => s.name === "mount");
  assert.equal("passCap" in slot, false);
  assert.deepEqual(findTagLeaks(registry, { neededTags: ["metal-bit"] }), []);
  const rows = await as(w.annUser, () => api().queue.list([w.ann]));
  const C = ["metal-bit", "Metal Bit", '"inherited"', '"native"', '"passCap"', "tagCrafted", "effectBlocks", '"depth"', '"contributions"'];
  const payloads = { definitions: text(registry), queue: text(rows), compendium: text(await as(w.annUser, () => api().compendium.view(w.ann))), actorFlags: text(w.ann.rawFlags()), itemFlags: text(blade.flags[M]), chat: text(env.chat) };
  assert.deepEqual(findCanaries(payloads, C), []);
});

// A commission craft that consumes a crafted ingredient (stage 1 finding 4) ---------------------------------------------------------------------
/** Ann holds a crafted dagger; the GM issues a commission (NPC patron, Ann supplies her own stock) whose mount slot takes the dagger. Deleting the dagger fires the deleteItem hook, as Foundry does. */
async function commissionUsingTheDagger() {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  const realDelete = dagger.delete.bind(dagger);
  dagger.delete = async () => { await realDelete(); await fireHookAs(w.gm, "deleteItem", [dagger]); };
  const { commission } = await as(w.gm, () => api().commissions.issue({ patron: "Old Brannock", crafter: w.ann, recipe: "mount-blade", selection: { edge: "iron", mount: ref(id) }, payout: 1 }));
  await as(w.gm, () => api().commissions.accept(commission.id));
  return { w, dagger, id, commission };
}
const carriers = (w, id) => w.ann.items.filter(i => i.getFlag(M, "crafted")?.freezeId === id);

test("COMMISSION ROLLBACK: when the commission craft fails AFTER it consumed the crafted dagger, the dagger comes back WITH its frozen record, not held, and no record is left behind", async () => {
  const { w, id, commission } = await commissionUsingTheDagger();
  const realUpdate = w.ann.update;
  w.ann.update = async () => { throw new Error("boom: the crafter could not be updated"); };      // the step after the items and gold moved
  try {
    await assert.rejects(as(w.gm, () => api().commissions.craft(commission.id, { degree: "success", gateChecked: true })), /boom/);
  } finally { w.ann.update = realUpdate; }
  assert.equal(carriers(w, id).length, 1, "the dagger is back in the bag");
  assert.ok(env.values.tagCrafted.items[id], "and its frozen record is still there (the hook dropped it while the item was out, before)");
  assert.equal(env.values.tagCrafted.items[id].held, undefined, "no hold is left on it");
  assert.deepEqual(Object.keys(env.values.tagCrafted.items), [id], "and it is the only record");
  assert.equal(api().commissions.get(commission.id).status, "accepted", "the commission is still open");
  // the dagger is still a working ingredient
  const pv = await as(w.gm, () => api().previewCraft(w.ann, "mount-blade", { edge: "iron", mount: ref(id) }, "oakhaven-forge"));
  assert.ok(pv.ok, pv.errors?.join(" | "));
});

test("COMMISSION SUCCESS: the used-up crafted dagger takes its record with it and nothing is left held", async () => {
  const { w, id, commission } = await commissionUsingTheDagger();
  await as(w.gm, () => api().commissions.craft(commission.id, { degree: "success", gateChecked: true }));
  assert.equal(carriers(w, id).length, 0, "the dagger was used up");
  assert.equal(env.values.tagCrafted.items[id], undefined, "so its record went");
  const records = Object.values(env.values.tagCrafted?.items ?? {});
  assert.equal(records.length, 0, "an NPC patron takes no item, so nothing new is frozen either");
  assert.ok(records.every(r => !r.held), "and nothing is left held");
});

// The frozen record's undo is registered the moment the record exists (stage 1 finding 15) ------------------------------------------------------
/** Bob (a character patron) supplies the materials and gets the dagger; the GM issues and accepts the commission. DAGGER has a ledger entry in nestedWorld, so a craft of it is frozen. */
async function patronCommission() {
  const w = await nestedWorld();
  await as(w.gm, async () => { await api().giveMaterial(w.bob, "iron", 3); await api().giveMaterial(w.bob, "spider-fang", 3); await api().grantFormula(w.bob, DAGGER); });
  const { commission } = await as(w.gm, () => api().commissions.issue({ patron: w.bob, crafter: w.ann, recipe: DAGGER, selection: { blade: "iron", fang: "spider-fang" }, materialsFrom: "patron", payout: 1 }));
  await as(w.gm, () => api().commissions.accept(commission.id));
  return { w, commission };
}
const recordIds = () => Object.keys(env.values.tagCrafted?.items ?? {});
const stackOf = (actor, id) => actor.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + (i.system?.quantity ?? 1), 0);

test("FROZEN UNDO: a commission craft that fails while the steps are applied leaves NO frozen record behind (the undo was registered after the steps before)", async () => {
  const { w, commission } = await patronCommission();
  const ironBefore = stackOf(w.bob, "iron"), copperBefore = (await import("../scripts/adapter/pf2e.js")).getCopper(w.bob);
  const realCreate = w.bob.createEmbeddedDocuments;
  w.bob.createEmbeddedDocuments = async () => { throw new Error("boom: the patron's bag would not take the dagger"); };      // the last step: the item for the patron
  try {
    await assert.rejects(as(w.gm, () => api().commissions.craft(commission.id, { degree: "success", gateChecked: true })), /boom/);
  } finally { w.bob.createEmbeddedDocuments = realCreate; }
  assert.deepEqual(recordIds(), [], "no frozen record survives a craft that did not happen");
  assert.equal(stackOf(w.bob, "iron"), ironBefore, "the patron's materials are back");
  assert.equal((await import("../scripts/adapter/pf2e.js")).getCopper(w.bob), copperBefore, "and the gold");
  assert.equal(api().commissions.get(commission.id).status, "accepted");
});

test("FROZEN UNDO: a failure BETWEEN the freeze and the steps (the item data cannot be built) leaves no frozen record either", async () => {
  const { w, commission } = await patronCommission();
  const realFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async () => ({ toObject: () => ({ name: "Dagger", type: "weapon", system: {}, flags: {}, notClonable() {} }) });      // structuredClone of this throws, after the record was written
  try {
    await assert.rejects(as(w.gm, () => api().commissions.craft(commission.id, { degree: "success", gateChecked: true })));
  } finally { globalThis.fromUuid = realFromUuid; }
  assert.deepEqual(recordIds(), [], "the record written a moment earlier was undone");
  assert.equal(api().commissions.get(commission.id).status, "accepted");
});

test("FROZEN UNDO: a successful commission craft with a character patron keeps its one record (the undo is only for failure)", async () => {
  const { w, commission } = await patronCommission();
  await as(w.gm, () => api().commissions.craft(commission.id, { degree: "success", gateChecked: true }));
  const item = w.bob.items.find(i => i.getFlag(M, "crafted"));
  assert.ok(item, "the patron got the dagger");
  assert.deepEqual(recordIds(), [item.getFlag(M, "crafted").freezeId], "and its record");
});

// The direct GM craft() undoes a failure and freezes a tagged craft (stage 1 finding 16) --------------------------------------------------------
import { getCopper } from "../scripts/adapter/pf2e.js";
const SEL_DAGGER = { blade: "iron", fang: "spider-fang" };
const direct = (w, extra = {}) => as(w.gm, () => api().craft({ actor: w.ann, recipeId: DAGGER, selection: SEL_DAGGER, degree: "success", ...extra }));
const bag = (w, id) => w.ann.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + (i.system?.quantity ?? 1), 0);

test("DIRECT CRAFT: when making the item fails, the fee and the materials come back and no frozen record is left", async () => {
  const w = await nestedWorld();
  const [coppers, iron, fang] = [getCopper(w.ann), bag(w, "iron"), bag(w, "spider-fang")];
  const realCreate = w.ann.createEmbeddedDocuments;
  w.ann.createEmbeddedDocuments = async () => { throw new Error("boom: the bag would not take the item"); };
  try {
    await assert.rejects(direct(w), /boom/);
  } finally { w.ann.createEmbeddedDocuments = realCreate; }
  assert.equal(getCopper(w.ann), coppers, "the fee is back");
  assert.deepEqual([bag(w, "iron"), bag(w, "spider-fang")], [iron, fang], "and the materials");
  assert.deepEqual(recordIds(), [], "and the record that was written a moment before is undone");
  assert.equal(w.ann.items.filter(i => i.getFlag(M, "crafted")).length, 0);
});

test("DIRECT CRAFT: a craft of a recipe with a ledger entry is frozen like every other (the item carries an opaque id and the record exists); a plain craft still costs what it did", async () => {
  const w = await nestedWorld();
  const coppers = getCopper(w.ann), iron = bag(w, "iron");
  const result = await direct(w);
  const flag = result.item.getFlag(M, "crafted");
  assert.equal(typeof flag.freezeId, "string");
  assert.deepEqual(recordIds(), [flag.freezeId]);
  assert.ok(getCopper(w.ann) < coppers, "the fee was paid");
  assert.ok(bag(w, "iron") < iron, "and materials used");
});

test("DIRECT CRAFT: a crafted ingredient is held while it is consumed: a failure hands the dagger back with its record, success takes the used-up record with it", async () => {
  const w = await nestedWorld();
  const dagger = await craftDagger(w);
  const id = dagger.getFlag(M, "crafted").freezeId;
  const realDelete = dagger.delete.bind(dagger);
  dagger.delete = async () => { await realDelete(); await fireHookAs(w.gm, "deleteItem", [dagger]); };
  const mount = { edge: "iron", mount: ref(id) };
  const realCreate = w.ann.createEmbeddedDocuments;
  // failure first: creating the new item throws (the dagger was recreated by the rollback through the same call, so let that one through)
  let calls = 0;
  w.ann.createEmbeddedDocuments = async (...args) => { if (calls++ === 0) throw new Error("boom: the bag would not take the item"); return realCreate.apply(w.ann, args); };
  try {
    await assert.rejects(as(w.gm, () => api().craft({ actor: w.ann, recipeId: "mount-blade", selection: mount, degree: "success" })), /boom/);
  } finally { w.ann.createEmbeddedDocuments = realCreate; }
  assert.equal(w.ann.items.filter(i => i.getFlag(M, "crafted")?.freezeId === id).length, 1, "the dagger is back");
  assert.ok(env.values.tagCrafted.items[id], "with its record");
  assert.equal(env.values.tagCrafted.items[id].held, undefined, "not held");
  assert.deepEqual(recordIds(), [id], "and nothing else");
  // now it succeeds: the dagger (re-created, a new item object) is used up and its record goes
  const again = w.ann.items.find(i => i.getFlag(M, "crafted")?.freezeId === id);
  const again0 = again.delete.bind(again);
  again.delete = async () => { await again0(); await fireHookAs(w.gm, "deleteItem", [again]); };
  const ok = await as(w.gm, () => api().craft({ actor: w.ann, recipeId: "mount-blade", selection: mount, degree: "success" }));
  assert.equal(env.values.tagCrafted.items[id], undefined, "the used-up dagger took its record");
  assert.deepEqual(recordIds(), [ok.item.getFlag(M, "crafted").freezeId], "the new item has the only record");
  assert.ok(Object.values(env.values.tagCrafted.items).every(r => !r.held));
});

test("DIRECT CRAFT: a failed chat message does not make a finished craft look failed", async () => {
  const w = await nestedWorld();
  const realChat = ChatMessage.create;
  const logged = [];
  const realError = console.error;
  ChatMessage.create = async () => { throw new Error("chat is down"); };
  console.error = (...a) => logged.push(a.map(String).join(" "));
  try {
    const result = await direct(w);
    assert.ok(result.item, "the item exists and the call resolved");
  } finally { ChatMessage.create = realChat; console.error = realError; }
  assert.match(logged.join("\n"), /the craft is done, but the chat message failed/);
});
