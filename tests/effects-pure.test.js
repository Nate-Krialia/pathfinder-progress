/**
 * Effects that act on a target (v0.22.0), the pure half: the condition block, its role, the plain words, the leak scan, the decisions, the card and Apply.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compileSet, decompileRoles, describeBlocks, flat, newBlock, setProblems, spread } from "../scripts/editor/blocks.js";
import { edit, applyControl, draftProblems, editorModel, previewOf } from "../scripts/editor/model.js";
import { forPlayer, findLeaks, GM_ONLY_KEYS, EFFECT_SECRET_KEYS, plainLines, rolesForPlayer, LEAK_WORDS } from "../scripts/effects/plain.js";
import { decide, effectsOf, linesFor } from "../scripts/effects/resolve.js";
import { cardFlag, cardMessage, doneContent, headline } from "../scripts/effects/card.js";
import { outcomeFor, runApply } from "../scripts/effects/apply.js";
import { stripForPlayer } from "../scripts/data/playerSet.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { buildCraftedItemData } from "../scripts/adapter/pf2e.js";
import { planCraft } from "../scripts/crafting/plan.js";
import { recordClassFact, recordExperiment, computeBaseline } from "../scripts/compendium/experiments.js";
import { asPage } from "./helpers.js";

const cond = (condition, extra = {}) => ({ type: "condition", condition, save: "will", value: flat(1), ...extra });
const MITFLIT = { kind: "material", id: "g21-mitflit", name: "Gate G21 Mitflit", tier: 2, effects: { basePower: "T1" }, classEffects: { weapon: { applyCondition: [{ condition: "frightened", value: 1, save: "will" }, { condition: "sickened", value: 2, save: "fortitude" }, { condition: "prone", save: "none" }] } } };
const IRON = { kind: "material", id: "g21-iron", name: "Gate G21 Iron", tier: 1, effects: { basePower: "T1" } };
const SWORD = { kind: "recipe", id: "g21-sword", name: "Gate G21 Sword", category: "weapon", output: { 1: "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA", 2: "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA", 3: "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA" }, craftLevel: 5, slots: [{ name: "blade", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "fang", drives: ["applyCondition"], tierFloor: 2, qty: 1 }], stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } };
const registry = () => { const r = loadDefinitions([MITFLIT, IRON, SWORD].map((d, i) => ({ pack: "t", entry: `e${i}`, text: asPage(d) }))); assert.deepEqual(r.errors, []); return r.registry; };
const FLAG = { recipeId: "g21-sword", materials: [{ slot: "blade", materialId: "g21-iron", units: 1 }, { slot: "fang", materialId: "g21-mitflit", units: 1 }] };

test("the condition block compiles to an applyCondition array: value by tier, none for a valueless condition, several per class", () => {
  const set = { blocks: [cond("frightened", { value: spread(flat(1), 1) }), cond("sickened", { save: "fortitude", value: flat(2) }), cond("prone", { save: "none" })] };
  set.blocks[0].value.byTier[2] = 3;
  assert.deepEqual(compileSet(set, 2, "weapon").applyCondition, [{ condition: "frightened", value: 3, save: "will" }, { condition: "sickened", value: 2, save: "fortitude" }, { condition: "prone", save: "none" }]);
  assert.equal(compileSet(set, 1, "weapon").applyCondition[0].value, 1);       // only the material's own tier row applies
  assert.deepEqual(decompileRoles(compileSet(set, 2, "weapon"), "weapon").blocks.map(b => b.condition), ["frightened", "sickened", "prone"]);
});

test("setProblems: worn classes and 'Every class' refuse a condition; duplicates, bad values and a missing save are named", () => {
  const set = { blocks: [cond("frightened")] };
  assert.deepEqual(setProblems(set, "weapon", 1), []);
  for (const cls of ["armor", "robes", "focus", "trinket"]) assert.ok(setProblems(set, cls, 1).some(p => /does not apply to/.test(p)), cls);
  assert.ok(setProblems(set, "general", 1).some(p => /weapon, bomb or consumable/.test(p)));
  assert.ok(setProblems({ blocks: [cond("frightened"), cond("frightened")] }, "weapon", 1).some(p => /set twice/.test(p)));
  assert.ok(setProblems({ blocks: [cond("frightened", { value: flat(5) })] }, "weapon", 1).some(p => /1 to 4/.test(p)));
  assert.ok(setProblems({ blocks: [cond("frightened", { save: "" })] }, "weapon", 1).some(p => /saving throw/.test(p)));
  assert.deepEqual(setProblems({ blocks: [cond("prone", { value: undefined, save: "none" })] }, "bomb", 1), []);
});

test("the schema accepts the role on weapon, bomb and consumable and refuses it on armor", () => {
  const ok = loadDefinitions([{ ...MITFLIT, classEffects: { bomb: { applyCondition: [{ condition: "dazzled", save: "reflex" }] }, consumable: { applyCondition: [{ condition: "fatigued", save: "none" }] } } }].map(d => ({ pack: "t", entry: "m", text: asPage(d) })));
  assert.deepEqual(ok.errors, []);
  const bad = loadDefinitions([{ ...MITFLIT, classEffects: { armor: { applyCondition: [{ condition: "dazzled", save: "reflex" }] } } }].map(d => ({ pack: "t", entry: "m", text: asPage(d) })));
  assert.ok(bad.errors.length, "an armor class effect with a condition is refused");
  const outside = loadDefinitions([{ ...MITFLIT, classEffects: { weapon: { applyCondition: [{ condition: "blinded", save: "will" }] } } }].map(d => ({ pack: "t", entry: "m", text: asPage(d) })));
  assert.ok(outside.errors.length, "a condition outside the curated ten is refused");
});

test("editor edits: several condition blocks by index, a valueless one has no value control, the add list hides the block where it cannot apply", () => {
  let draft = { kind: "material", id: "g21-mitflit", fields: { name: "X", tier: "2", bulk: "L" }, rows: [], blocks: { general: { blocks: [] }, byClass: {} } };
  draft = edit.addBlock(draft, "weapon", "condition");
  draft = edit.addBlock(draft, "weapon", "condition");
  assert.deepEqual(draft.blocks.byClass.weapon.blocks.map(b => b.condition), ["frightened", "sickened"]);
  draft = applyControl(draft, { field: "block", cls: "weapon", type: "condition", name: "condition", index: "1" }, "prone");
  draft = applyControl(draft, { field: "block", cls: "weapon", type: "condition", name: "save", index: "1" }, "none");
  draft = applyControl(draft, { field: "tier-mode", cls: "weapon", type: "condition", name: "value", index: "0" }, "table");
  draft = applyControl(draft, { field: "cell", cls: "weapon", type: "condition", name: "value", index: "0", tier: "2" }, "3");
  assert.deepEqual(compileSet(draft.blocks.byClass.weapon, 2, "weapon").applyCondition, [{ condition: "frightened", value: 3, save: "will" }, { condition: "prone", save: "none" }]);
  const reg = registry();
  const model = cls => editorModel({ registry: reg, selectedKey: "material:g21-mitflit", draft, base: draft, effectClass: cls }).detail.effects;
  const weapon = model("weapon");
  assert.deepEqual(weapon.blocks.map(b => [b.type, b.index, b.valued]), [["condition", 0, true], ["condition", 1, false]]);
  assert.equal(weapon.blocks[1].value, null);
  assert.ok(weapon.add.some(a => a.type === "condition"));
  for (const cls of ["general", "armor", "robes", "focus", "trinket"]) assert.ok(!model(cls).add.some(a => a.type === "condition"), `${cls} is not offered a condition`);
  draft = edit.removeBlock(draft, "weapon", "condition", 0);
  assert.deepEqual(draft.blocks.byClass.weapon.blocks.map(b => b.condition), ["prone"]);
});

test("plain words: 'makes the target fearful', no value, save or DC; describeBlocks and the preview show only that", () => {
  const set = { blocks: [cond("frightened", { value: flat(3) }), cond("sickened", { save: "fortitude" })] };
  assert.deepEqual(describeBlocks("Mitflit Fang", set, "weapon", 2), ["Mitflit Fang makes the target fearful and makes the target sick"]);
  assert.deepEqual(plainLines(compileSet(set, 2, "weapon").applyCondition), ["makes the target fearful", "makes the target sick"]);
  assert.deepEqual(forPlayer("applyCondition", [{ condition: "frightened", value: 3, save: "will" }]), { plain: ["makes the target fearful"] });
  assert.deepEqual(forPlayer("bonusDamage", { dice: "1d6", type: "fire" }), { dice: "1d6", type: "fire" });
  const draft = { kind: "material", id: "g21-m", fields: { name: "Gate G21 Mitflit", tier: "2", value: "5", bulk: "L", description: "" }, rows: [], blocks: { general: { blocks: [] }, byClass: { weapon: set } } };
  const view = previewOf(registry(), draft, "weapon", "crafted");
  assert.deepEqual(view.lines, ["Gate G21 Mitflit makes the target fearful and makes the target sick"]);
  assert.equal(JSON.stringify(view).match(/will|fortitude|reflex|"DC"/i), null, "nothing in the preview names a save or a DC");
  assert.deepEqual(findLeaks(view, "$", EFFECT_SECRET_KEYS), []);
});

test("the Compendium book a craft writes holds only the plain marker, in all three places a role value is stored", () => {
  const roles = { applyCondition: [{ condition: "frightened", value: 1, save: "will" }], bonusDamage: { dice: "1d6", type: "fire" } };
  const book = recordClassFact({ experiments: {}, classes: {}, materials: {} }, { category: "weapon", materialId: "g21-mitflit", materialName: "Mitflit", tier: 2, effects: roles });
  assert.deepEqual(book.classes.weapon["g21-mitflit"].effects.applyCondition, { plain: ["makes the target fearful"] });
  assert.deepEqual(book.classes.weapon["g21-mitflit"].effects.bonusDamage, roles.bonusDamage);
  const exp = recordExperiment({ experiments: {}, classes: {}, materials: {} }, { recipeId: "g21-sword", recipeName: "S", category: "weapon", slot: "fang", materialId: "g21-mitflit", materialName: "M", tier: 2, effects: roles });
  assert.deepEqual(exp.experiments["g21-sword"].slots.fang["g21-mitflit"].effects.applyCondition, { plain: ["makes the target fearful"] });
  const baseline = computeBaseline(registry().recipe.get("g21-sword"), registry());
  assert.deepEqual(baseline.slots.find(s => s.slot === "fang").effects.applyCondition, { plain: ["makes the target fearful and"].slice(0, 0).concat(["makes the target fearful", "makes the target sick", "knocks the target down"]) });
  for (const doc of [book, exp, baseline]) assert.deepEqual(findLeaks(doc, "$", EFFECT_SECRET_KEYS), []);
});

test("LEAK SCAN: a player's copy of a material carries no GM-only field, and the scan FAILS the moment one is added", () => {
  const full = { ...MITFLIT, effectBlocks: { byClass: { weapon: { blocks: [cond("frightened")] } } }, research: { milestones: [] } };
  const stripped = stripForPlayer("material", full, { tagKnown: false });
  assert.deepEqual(findLeaks(stripped), [], "stripForPlayer leaves nothing GM-only");
  const withLeak = { ...stripped, applyCondition: [{ condition: "frightened", value: 1, save: "will" }] };
  assert.deepEqual(findLeaks(withLeak), ["$.applyCondition", "$.applyCondition[0].condition", "$.applyCondition[0].save"].filter(p => findLeaks(withLeak).includes(p)), "the leak is found");
  assert.ok(findLeaks(withLeak).length > 0, "a field added to a stripped record makes the scan report a leak");
  assert.ok(findLeaks({ ...stripped, dc: 17 }).includes("$.dc"));
  assert.ok(GM_ONLY_KEYS.includes("applyCondition") && EFFECT_SECRET_KEYS.includes("save"));
  // the recipe's craft level is stripped too (it is the DC's source)
  const recipe = stripForPlayer("recipe", SWORD);
  assert.deepEqual(findLeaks(recipe), []);
});

test("a craft: the item description gets the plain line only, the plan keeps no value, save or DC, and the item carries only ids", () => {
  const reg = registry();
  const stacks = [{ stackId: "a", materialId: "g21-iron", quantity: 2 }, { stackId: "b", materialId: "g21-mitflit", quantity: 2 }];
  const planned = planCraft({ recipe: reg.recipe.get("g21-sword"), registry: reg, selection: { blade: "g21-iron", fang: "g21-mitflit" }, stacks });
  assert.equal(planned.ok, true, JSON.stringify(planned.errors));
  assert.deepEqual(planned.plan.description.conditions.map(c => c.plain), ["makes the target fearful", "makes the target sick", "knocks the target down"]);
  assert.deepEqual(findLeaks(planned.plan.description, "$", EFFECT_SECRET_KEYS), []);
  const data = buildCraftedItemData({ name: "Sword", type: "weapon", system: { description: { value: "" } }, flags: {} }, planned.plan.description, { ...planned.plan.provenance, crafter: "x", degree: "success" });
  const html = data.system.description.value;
  assert.match(html, /Makes the target fearful/);
  assert.doesNotMatch(html, LEAK_WORDS);
  assert.deepEqual(data.system.rules, [], "no rule element is written for a condition");
  assert.deepEqual(Object.keys(data.flags["pathfinder-progress"]), ["crafted"]);
  assert.deepEqual(findLeaks(data.flags, "$", EFFECT_SECRET_KEYS), []);
});

test("effectsOf re-resolves the effects from the registry through the flag's recipe and materials", () => {
  const { effects, itemClass, recipe } = effectsOf(FLAG, registry());
  assert.equal(itemClass, "weapon"); assert.equal(recipe.craftLevel, 5);
  assert.deepEqual(effects.map(e => [e.index, e.condition, e.value, e.save]), [[0, "frightened", 1, "will"], [1, "sickened", 2, "fortitude"], [2, "prone", undefined, "none"]]);
  assert.deepEqual(effectsOf({ recipeId: "nope", materials: [] }, registry()).effects, []);
  assert.deepEqual(effectsOf({ recipeId: "g21-sword", materials: [{ slot: "blade", materialId: "g21-iron" }] }, registry()).effects, [], "a slot that does not drive the role adds nothing");
  assert.deepEqual(linesFor(effects), ["makes the target fearful", "makes the target sick", "knocks the target down"]);
});

test("decide: the triggers per item class, and anything unplaceable is the fallback card", () => {
  const atk = outcome => ({ kind: "attack", outcome });
  assert.equal(decide(atk("success"), "weapon", 1), "card");
  assert.equal(decide(atk("criticalSuccess"), "weapon", 1), "card");
  assert.equal(decide(atk("failure"), "weapon", 1), "skip");
  assert.equal(decide(atk("criticalFailure"), "weapon", 1), "skip");
  assert.equal(decide(atk("failure"), "bomb", 1), "card");
  assert.equal(decide(atk("success"), "bomb", 1), "card");
  assert.equal(decide(atk("criticalFailure"), "bomb", 1), "skip");
  assert.equal(decide({ kind: "consumable" }, "consumable", 2), "card");
  assert.equal(decide({ kind: "consumable" }, "consumable", 0), "fallback");
  assert.equal(decide(atk("success"), "weapon", 0), "fallback");
  assert.equal(decide(atk(null), "weapon", 1), "fallback");
  assert.equal(decide({ kind: "other" }, "weapon", 1), "fallback");
  assert.equal(decide({ kind: "damage", outcome: "success" }, "weapon", 1), "skip");
  assert.equal(decide({ kind: "none" }, "weapon", 1), "skip");
  assert.equal(decide(atk("success"), "armor", 1), "skip");
});

test("the card: plain words in the text, only ids in the flag, buttons while pending, a plain result when done", () => {
  const lines = ["makes the target fearful"];
  assert.equal(headline({ itemName: "Mitflit Fang", kind: "attack", outcome: "success", itemClass: "weapon", targetNames: ["Goblin A"], mode: "card", lines }), "Mitflit Fang hit Goblin A: makes the target fearful.");
  assert.match(headline({ itemName: "Bomb", kind: "attack", outcome: "failure", itemClass: "bomb", targetNames: ["Goblin A"], mode: "card", lines }), /missed Goblin A, but you can still apply it/);
  assert.match(headline({ itemName: "Potion", kind: "consumable", targetNames: ["A", "B"], mode: "card", lines }), /used on A and B/);
  const flag = cardFlag({ itemUuid: "Actor.a.Item.i", targets: ["Scene.s.Token.t"], effects: [0, 1], text: "x" });
  assert.deepEqual(Object.keys(flag).sort(), ["effects", "itemUuid", "state", "targets", "text", "v"]);
  const message = cardMessage({ whisper: ["gm"], flag: cardFlag({ itemUuid: "u", targets: [], effects: [0], text: "Mitflit Fang hit Goblin A: makes the target fearful." }) });
  assert.match(message.content, /data-pfp-fx="apply"/); assert.match(message.content, /data-pfp-fx="skip"/);
  assert.doesNotMatch(message.content + JSON.stringify(message.flags), LEAK_WORDS);
  assert.deepEqual(findLeaks(message, "$", EFFECT_SECRET_KEYS), []);
  const done = doneContent("T.", [{ name: "Goblin A", lines: ["is fearful"] }]);
  assert.match(done, /Goblin A is fearful\./); assert.doesNotMatch(done, /data-pfp-fx/);
});

test("outcomeFor: critical failure is value + 1 (capped at 4), failure the value, successes nothing; valueless on any failure; no save applies", () => {
  assert.deepEqual(outcomeFor("criticalFailure", 1), { applies: true, value: 2 });
  assert.deepEqual(outcomeFor("criticalFailure", 4), { applies: true, value: 4 });
  assert.deepEqual(outcomeFor("failure", 2), { applies: true, value: 2 });
  assert.equal(outcomeFor("success", 2).applies, false);
  assert.equal(outcomeFor("criticalSuccess", 2).applies, false);
  assert.deepEqual(outcomeFor("failure", null), { applies: true, value: null });
  assert.deepEqual(outcomeFor("criticalFailure", null), { applies: true, value: null });
  assert.deepEqual(outcomeFor(null, 3), { applies: true, value: 3 });
});

function applyWorld() {
  const log = [], rolls = [], applied = [];
  const actors = { "Scene.s.Token.a": { name: "Goblin A", actor: { name: "Goblin A", id: "synthA" } }, "Scene.s.Token.b": { name: "Goblin B", actor: { name: "Goblin B", id: "synthB" } } };
  const deps = {
    itemByUuid: async () => ({ name: "Mitflit Fang" }), craftedFlag: () => FLAG, tokenInfo: async uuid => (actors[uuid] ? { uuid, ...actors[uuid] } : null),
    rollSave: async (actor, type, dc) => { rolls.push([actor.name, type, dc]); return { degree: "failure", total: 9, natural: 4 }; },
    applyCondition: async (actor, slug, value, max) => { applied.push([actor.name, slug, value, max]); return { changed: true, to: value }; },
    levelDC: level => 14 + level, log: entry => log.push(entry)
  };
  return { deps, log, rolls, applied };
}

test("Apply: DC from the recipe's craft level, one secret save per effect per target on the target's actor, no save applies by itself, results are plain", async () => {
  const w = applyWorld();
  const flag = { itemUuid: "u", targets: ["Scene.s.Token.a", "Scene.s.Token.b"], effects: [0, 1, 2] };
  const out = await runApply({ flag, registry: registry(), deps: w.deps });
  assert.equal(out.ok, true);
  assert.deepEqual(w.rolls, [["Goblin A", "will", 19], ["Goblin A", "fortitude", 19], ["Goblin B", "will", 19], ["Goblin B", "fortitude", 19]], "prone has no save: 2 effects x 2 targets");
  assert.deepEqual(w.applied.map(a => a.slice(0, 3)), [["Goblin A", "frightened", 1], ["Goblin A", "sickened", 2], ["Goblin A", "prone", null], ["Goblin B", "frightened", 1], ["Goblin B", "sickened", 2], ["Goblin B", "prone", null]]);
  assert.deepEqual(out.results[0], { name: "Goblin A", lines: ["is fearful", "is sick", "is knocked down"] });
  assert.equal(w.log.length, 6);
  assert.match(w.log[0].text, /vs DC 19/, "the DC and the roll are in the GM log");
  assert.doesNotMatch(JSON.stringify(out.results), LEAK_WORDS);
});

test("Apply with forced degrees: success shrugs it off, critical failure goes one higher, a missing target and an adapter error are reported, never thrown", async () => {
  const w = applyWorld();
  let out = await runApply({ flag: { itemUuid: "u", targets: ["Scene.s.Token.a"], effects: [0, 1] }, registry: registry(), deps: w.deps, forceDegree: "success" });
  assert.deepEqual(out.results, [{ name: "Goblin A", lines: ["shrugs it off"] }]);
  assert.equal(w.applied.length, 0); assert.equal(w.rolls.length, 0, "a forced degree is not rolled");
  out = await runApply({ flag: { itemUuid: "u", targets: ["Scene.s.Token.a"], effects: [0, 1] }, registry: registry(), deps: w.deps, forceDegree: "criticalFailure" });
  assert.deepEqual(w.applied.map(a => a[2]), [2, 3]);
  out = await runApply({ flag: { itemUuid: "u", targets: ["Scene.s.Token.gone"], effects: [0] }, registry: registry(), deps: w.deps, forceDegree: "failure" });
  assert.deepEqual(out.results, [{ name: "A target", lines: ["could not be found"] }]);
  w.deps.applyCondition = async () => { throw new Error("boom"); };
  out = await runApply({ flag: { itemUuid: "u", targets: ["Scene.s.Token.a"], effects: [0] }, registry: registry(), deps: w.deps, forceDegree: "failure" });
  assert.match(out.results[0].lines[0], /could not be affected/);
  assert.ok(w.log.some(e => /FAILED: boom/.test(e.text)));
  w.deps.itemByUuid = async () => null;
  assert.equal((await runApply({ flag: { itemUuid: "u", targets: [], effects: [0] }, registry: registry(), deps: w.deps })).ok, false);
});
