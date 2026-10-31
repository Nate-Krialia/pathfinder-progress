/** The discovery chain, pure parts (Stage 11c): tracks, stages, knowledge, versions, the data model's rules, and the effect shape (class table + overrides). */
import test from "node:test";
import assert from "node:assert/strict";
import { defaultTrack, craftedWith, finalSteps, newlyReached, propertiesKnown, stageOf, trackOf, versionCandidates } from "../scripts/discovery/track.js";
import { check } from "../scripts/data/schema.js";
import { TRACK_SCHEMA } from "../scripts/data/schemas.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { resolveMaterialEffect } from "../scripts/data/resolver.js";
import { selectRecords, stripForPlayer, loadPlayerRecords } from "../scripts/data/playerSet.js";
import { effectKnown, isOverridden, migrateToClasses, recordClassFact, recordExperiment, describeExperiments, pickExperiment, mergeExperiment } from "../scripts/compendium/experiments.js";
import { W } from "../scripts/discovery/words.js";
import { DIFFICULTY_WORDS } from "../scripts/difficulty.js";

const track = (...m) => ({ milestones: m.map(([steps, type, recipeId]) => ({ steps, grants: type === "formula" ? { type, ...(recipeId ? { recipeId } : {}) } : { type } })) });
const T48 = track([4, "properties"], [8, "formula", "blade"]);

test("TRACK: the default is 4 steps = properties, 8 steps = a formula; a note's has no properties milestone", () => {
  assert.deepEqual(defaultTrack("blade"), track([4, "properties"], [8, "formula", "blade"]));
  assert.deepEqual(defaultTrack("blade", "note"), track([8, "formula", "blade"]));
  assert.deepEqual(check(TRACK_SCHEMA, defaultTrack("blade")), []);
});

test("TRACK schema: steps must go up, one properties milestone, at most the cap, items may have only some milestones", () => {
  assert.deepEqual(check(TRACK_SCHEMA, track([4, "properties"])), [], "properties only");
  assert.deepEqual(check(TRACK_SCHEMA, track([8, "formula", "blade"])), [], "a formula only");
  assert.match(check(TRACK_SCHEMA, track([8, "properties"], [8, "formula", "blade"]))[0].message, /more than the milestone before it/);
  assert.match(check(TRACK_SCHEMA, track([4, "properties"], [6, "properties"]))[0].message, /only one "properties" milestone/);
  assert.match(check(TRACK_SCHEMA, track(...Array.from({ length: 7 }, (_, i) => [i + 1, "formula", "blade"])))[0].message, /at most 6 milestones/);
  assert.ok(check(TRACK_SCHEMA, { milestones: [] }).length, "an empty track is not a track");
});

test("STAGE: three plain stages toward the NEXT milestone; nothing numeric leaves stageOf", () => {
  assert.deepEqual([0, 1, 2, 3].map(s => stageOf(T48, s)), [0, 0, 1, 2], "toward 4: 0/4 and 1/4 are just started, 2/4 getting somewhere, 3/4 nearly there");
  assert.deepEqual([4, 5, 6, 7, 8].map(s => stageOf(T48, s)), [0, 0, 1, 2, 2], "after the first milestone the next one starts the count again");
  assert.deepEqual(W.stages, ["Just started", "Getting somewhere", "Nearly there"]);
});

test("REACHED: milestones come once, in order, and a jump over two gives both", () => {
  assert.deepEqual(newlyReached(T48, 3).map(r => r.index), []);
  assert.deepEqual(newlyReached(T48, 4).map(r => r.index), [0]);
  assert.deepEqual(newlyReached(T48, 9, [{ index: 0 }]).map(r => r.index), [1]);
  assert.deepEqual(newlyReached(T48, 9).map(r => r.index), [0, 1]);
  assert.equal(finalSteps(T48), 8);
});

test("TRACK LAYERS: the Discovery tracks window's overlay beats the definition's own track", () => {
  assert.equal(trackOf({ research: T48 }, { "material:iron": track([2, "properties"]) }, "material:iron").milestones[0].steps, 2);
  assert.equal(trackOf({ research: T48 }, {}, "material:iron"), T48);
  assert.equal(trackOf({}, {}, "material:iron"), null);
});

test("PROPERTIES KNOWN: no track = known on pickup; a track = studied or already crafted with (the retroactive rule)", () => {
  const ledger = { items: { "material:iron": { reached: [{ index: 0, type: "properties" }] } } };
  assert.equal(propertiesKnown({ ledger: { items: {} }, books: {}, materialId: "iron", hasTrack: false }), true);
  assert.equal(propertiesKnown({ ledger: { items: {} }, books: {}, materialId: "iron", hasTrack: true }), false);
  assert.equal(propertiesKnown({ ledger, books: {}, materialId: "iron", hasTrack: true }), true);
  const crafted = { own: { classes: { armor: { iron: { materialId: "iron", effects: {} } } } } };
  assert.equal(propertiesKnown({ ledger: { items: {} }, books: crafted, materialId: "iron", hasTrack: true }), true, "someone who already crafted with it is not locked out when a track is added");
  assert.equal(craftedWith({ own: { experiments: { r: { slots: { s: { iron: {} } } } } } }, "iron"), true, "an older per-recipe fact counts too");
  assert.equal(craftedWith({ own: {} }, "iron"), false);
});

const registry = (...recipes) => ({
  recipe: new Map(recipes.map(r => [r.id, r])),
  material: new Map([["ore1", { id: "ore1", tag: "ore" }], ["ore2", { id: "ore2", tag: "ore" }], ["ore3", { id: "ore3", tag: "ore" }], ["herb", { id: "herb", tag: "leaf" }]])
});
const V1 = { id: "blade", name: "Blade", family: "blades", version: 1 };
const V2 = { id: "blade2", name: "Blade II", family: "blades", version: 2, requiresTag: "ore" };
const V3 = { id: "blade3", name: "Blade III", family: "blades", version: 3, requiresTag: "ore", requiresCount: 3 };

test("VERSIONS: v2 needs the previous formula and two DIFFERENT tagged materials understood; v3 needs v2 and three; never an unlock, only a candidate", () => {
  const reg = registry(V1, V2, V3);
  const all = (formulaIds, understood, taken) => versionCandidates({ registry: reg, formulaIds, met: () => true, propsKnown: m => understood.includes(m.id), taken: new Set(taken) }).map(c => c.recipeId);
  assert.deepEqual(all(["blade"], ["ore1"]), [], "one tagged material is not enough");
  assert.deepEqual(all(["blade"], ["ore1", "herb"]), [], "a different tag does not count");
  assert.deepEqual(all(["blade"], ["ore1", "ore2"]), ["blade2"]);
  assert.deepEqual(all([], ["ore1", "ore2"]), [], "the previous version's formula must be known");
  assert.deepEqual(all(["blade", "blade2"], ["ore1", "ore2"]), [], "v3 needs three; v2 is known");
  assert.deepEqual(all(["blade", "blade2"], ["ore1", "ore2", "ore3"]), ["blade3"]);
  assert.deepEqual(all(["blade"], ["ore1", "ore2"], ["blade2"]), [], "already a lead or a study");
  assert.deepEqual(versionCandidates({ registry: reg, formulaIds: ["blade"], met: m => m.id === "ore1", propsKnown: () => true }).map(c => c.recipeId), [], "a material the character has not met does not count");
});

// The data model --------------------------------------------------------------------------------------------------------
const page = data => ({ pack: "t", entry: data.id, text: "```json\n" + JSON.stringify(data) + "\n```" });
const base = [
  { kind: "tag", id: "ore", name: "Ore", theme: "cowardice", worksWith: "frightened" },
  { kind: "material", id: "ore1", name: "Ore One", tier: 1, effects: { basePower: "T1" }, tag: "ore", research: T48, classEffects: { armor: { basePower: "T2" } } },
  { kind: "recipe", id: "blade", name: "Blade", category: "weapon", output: { 1: "Dagger", 2: "Dagger" }, craftLevel: 2, stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }] },
  { kind: "note", id: "page", name: "Torn Page", recipeId: "blade", research: track([6, "formula"]) }
];
const load = (...extra) => loadDefinitions([...base, ...extra].map(page));
const withChange = (index, change) => load(...[]).errors && loadDefinitions(base.map((d, i) => page(i === index ? { ...d, ...change } : d)));

test("DATA MODEL: the new fields load; a material gets its gold value from its tier; the registry holds tags and notes", () => {
  const { registry: reg, errors } = load();
  assert.deepEqual(errors.map(e => e.message), []);
  assert.equal(reg.material.get("ore1").value, 5, "tier 1 default");
  assert.deepEqual([...reg.tag.keys()], ["ore"]);
  assert.deepEqual([...reg.note.keys()], ["page"]);
  assert.equal(loadDefinitions([page({ ...base[1], value: 12 }), page(base[0]), page(base[2])]).registry.material.get("ore1").value, 12, "a set value is kept");
});

test("DATA MODEL: loud, named errors for a bad tag, class effects, track grant, note and version fields", () => {
  const msgs = changes => changes.flatMap(([i, c]) => withChange(i, c).errors.map(e => `${e.entry}.${e.field}: ${e.message}`));
  assert.match(msgs([[1, { tag: "nope" }]]).join(), /tag: refers to unknown tag "nope"/);
  assert.match(msgs([[1, { classEffects: { armor: { bonusDamage: { dice: "1d4", type: "fire" } } } }]]).join(), /classEffects\.armor\.bonusDamage: is not a role of item class "armor"/);
  assert.match(msgs([[1, { classEffects: { weapon: { basePower: "T9" } } }]]).join(), /classEffects\.weapon\.basePower/);
  assert.match(msgs([[1, { research: track([4, "properties"], [8, "formula", "ghost"]) }]]).join(), /grants\.recipeId: refers to unknown recipe "ghost"/);
  assert.match(msgs([[1, { research: track([8, "formula"]) }]]).join(), /grants\.recipeId: is required/);
  assert.match(msgs([[3, { recipeId: "ghost" }]]).join(), /recipeId: refers to unknown recipe/);
  assert.match(msgs([[3, { research: track([4, "properties"]) }]]).join(), /only belongs on a material/);
  assert.match(msgs([[3, { research: undefined }]]).join(), /does nothing/);
  assert.match(msgs([[2, { requiresTag: "ore" }]]).join(), /version: must be 2 or higher/);
  assert.match(msgs([[2, { requiresTag: "ghost", version: 2 }]]).join(), /requiresTag: refers to unknown tag/);
});

test("EFFECT SHAPE: a recipe override beats the material's class table, which beats its general default", () => {
  const material = { id: "wyrm", effects: { basePower: "T1", resistance: { type: "fire", value: 2 } }, classEffects: { armor: { resistance: { type: "fire", value: 6 } } } };
  const armor = { category: "armor", slots: [{ name: "plate", drives: "resistance" }], overrides: [{ materialId: "wyrm", slot: "plate", effect: { type: "fire", value: 10 } }] };
  const plain = { category: "armor", slots: [{ name: "plate", drives: "resistance" }] };
  const weapon = { category: "weapon", slots: [{ name: "plate", drives: "resistance" }] };
  assert.deepEqual(resolveMaterialEffect(material, "resistance", armor, "plate"), { value: { type: "fire", value: 10 }, source: "recipe override" });
  assert.deepEqual(resolveMaterialEffect(material, "resistance", plain, "plate"), { value: { type: "fire", value: 6 }, source: "material class" });
  assert.deepEqual(resolveMaterialEffect(material, "resistance", weapon, "plate"), { value: { type: "fire", value: 2 }, source: "material default" }, "another class falls back to the default");
});

// Knowledge: item classes -----------------------------------------------------------------------------------------------
const ARMOR = { id: "plate", name: "Plate", category: "armor", slots: [{ name: "shell", drives: "resistance", tierFloor: 1, qty: 1 }, { name: "lining", drives: "basePower", tierFloor: 1, qty: 1 }] };
const ARMOR2 = { id: "mail", name: "Mail", category: "armor", slots: [{ name: "rings", drives: "resistance", tierFloor: 1, qty: 1 }], overrides: [{ materialId: "wyrm", slot: "rings", effect: { type: "fire", value: 9 } }] };
const fact = { category: "armor", materialId: "wyrm", materialName: "Wyrmroot", tier: 2, effects: { resistance: { type: "fire", value: 6 } }, at: 5 };

test("CLASSES: one successful armor craft teaches the material for ALL armors, except where a recipe overrides it", () => {
  const book = recordClassFact({}, fact);
  const books = { own: book, shared: {} };
  assert.deepEqual(effectKnown(books, ARMOR, "shell", "wyrm"), { known: true, effects: { resistance: { type: "fire", value: 6 } }, via: "class" });
  assert.equal(effectKnown(books, ARMOR2, "rings", "wyrm").known, false, "ARMOR2 gives wyrm its own effect: only crafting THAT teaches it");
  assert.equal(effectKnown(books, ARMOR, "lining", "wyrm").known, false, "the lining slot drives a role this craft did not show");
  assert.equal(effectKnown(books, { ...ARMOR, category: "weapon" }, "shell", "wyrm").known, false, "another item class");
  assert.equal(effectKnown(books, "plate", "shell", "wyrm").known, false, "an id alone cannot say its class");
  const learned = recordExperiment(book, { recipeId: "mail", category: "armor", slot: "rings", materialId: "wyrm", effects: { resistance: { type: "fire", value: 9 } } });
  assert.deepEqual(effectKnown({ own: learned, shared: {} }, ARMOR2, "rings", "wyrm").effects, { resistance: { type: "fire", value: 9 } });
});

test("CLASSES: roles are added, the first value learned stays, and recording twice is the same book", () => {
  const once = recordClassFact({}, fact);
  const more = recordClassFact(once, { ...fact, effects: { resistance: { type: "fire", value: 99 }, basePower: "T2" } });
  assert.deepEqual(more.classes.armor.wyrm.effects, { resistance: { type: "fire", value: 6 }, basePower: "T2" });
  assert.deepEqual(recordClassFact(more, fact), more);
});

test("PLAYER COPY: a recipe lists which (slot, material) pairs it overrides, with no values", () => {
  const out = stripForPlayer("recipe", { ...ARMOR2, craftLevel: 3, output: {}, researchProject: { tier: 1 }, family: "plates", version: 1, research: T48 });
  assert.deepEqual(out.overrideSlots, ["rings|wyrm"]);
  assert.ok(isOverridden(out, "rings", "wyrm") && !isOverridden(out, "rings", "iron"));
  assert.doesNotMatch(JSON.stringify(out), /"value":\s*9|family|version|research/);
});

test("MIGRATION: older per-recipe facts fold into the class, except for an overridden material; idempotent; the old facts stay", () => {
  const old = { experiments: {
    mail: { recipeId: "mail", name: "Mail", firstAt: 1, slots: { rings: { wyrm: { materialId: "wyrm", materialName: "Wyrmroot", tier: 2, effects: { resistance: { type: "fire", value: 9 } }, at: 4 } } } },
    plate: { recipeId: "plate", name: "Plate", firstAt: 1, slots: { shell: { wyrm: { materialId: "wyrm", materialName: "Wyrmroot", tier: 2, effects: { resistance: { type: "fire", value: 6 } }, at: 3 } } } },
    gone: { recipeId: "gone", name: "Gone", firstAt: 1, slots: { x: { wyrm: { materialId: "wyrm", materialName: "W", effects: { basePower: "T9" }, at: 4 } } } }
  } };
  const recipeOf = id => ({ plate: ARMOR, mail: ARMOR2 })[id];
  const folded = migrateToClasses(old, recipeOf);
  assert.deepEqual(folded.classes.armor.wyrm.effects, { resistance: { type: "fire", value: 6 } }, "the plate fact folded; the mail OVERRIDE (9) did not; the removed recipe was left alone");
  assert.deepEqual(folded.experiments, old.experiments, "the per-recipe facts are untouched");
  assert.deepEqual(migrateToClasses(folded, recipeOf), folded, "running it again changes nothing");
  assert.equal(effectKnown({ own: folded, shared: {} }, ARMOR, "shell", "wyrm").known, true);
});

test("SHARE: an experiment share carries the item class's facts, and merging them is additive", () => {
  let book = recordExperiment({}, { recipeId: "plate", recipeName: "Plate", category: "armor", slot: "shell", materialId: "iron", effects: { resistance: { type: "fire", value: 1 } } });
  book = recordClassFact(book, fact);
  const picked = pickExperiment(book, "plate");
  assert.deepEqual(Object.keys(picked.classFacts), ["wyrm"]);
  const into = mergeExperiment({}, picked);
  assert.deepEqual(into.classes.armor.wyrm.effects, fact.effects);
  assert.equal(into.experiments.plate.classFacts, undefined, "classFacts are merged into the classes, not stored on the entry");
  assert.deepEqual(mergeExperiment(into, picked), into, "idempotent");
});

test("VIEW: the Experiments list shows what the class teaches for a recipe's slots, never what a recipe overrides", () => {
  const ownBook = recordClassFact(recordExperiment({}, { recipeId: "mail", recipeName: "Mail", category: "armor", slot: "x", materialId: "q", effects: {} }), fact);
  const view = describeExperiments({ own: ownBook, shared: {}, recipes: new Map([["mail", ARMOR2]]) });
  assert.deepEqual(view[0].known.filter(k => k.source === "class"), [], "mail overrides wyrm in rings");
  const plateBook = recordClassFact(recordExperiment({}, { recipeId: "plate", recipeName: "Plate", category: "armor", slot: "x", materialId: "q", effects: {} }), fact);
  const plate = describeExperiments({ own: plateBook, shared: {}, recipes: new Map([["plate", ARMOR]]) });
  assert.deepEqual(plate[0].known.filter(k => k.source === "class").map(k => [k.slot, k.materialId]), [["shell", "wyrm"]]);
});

// The relay -----------------------------------------------------------------------------------------------------------------
test("RELAY: a player's material has no effects, class table or track (only whether there IS one); the tag comes only when the character knows it", () => {
  const mat = { kind: "material", id: "ore1", name: "Ore One", tier: 1, value: 5, effects: { basePower: "T1" }, classEffects: { armor: { basePower: "T2" } }, tag: "ore", research: T48 };
  const hidden = stripForPlayer("material", mat);
  assert.deepEqual(hidden, { kind: "material", id: "ore1", name: "Ore One", tier: 1, value: 5, hasTrack: true });
  assert.equal(stripForPlayer("material", mat, { tagKnown: true }).tag, "ore");
  assert.equal(stripForPlayer("material", { ...mat, research: undefined }).hasTrack, false);
  assert.equal(stripForPlayer("material", { ...mat, research: undefined }, { hasTrack: true }).hasTrack, true, "the overlay can add a track");
  assert.deepEqual(stripForPlayer("note", { kind: "note", id: "page", name: "Torn Page", recipeId: "blade", research: T48 }), { kind: "note", id: "page", name: "Torn Page", hasTrack: true });
});

test("RELAY: selectRecords sends a tag definition only along with a material whose tag the character knows, and notes they hold", () => {
  const { registry: reg } = load();
  const facts = { actors: [{ id: "a", materials: ["ore1"], notes: ["page"] }] };
  const plain = selectRecords(facts, reg, { tagKnownFor: () => false });
  assert.deepEqual(plain.records.filter(r => r.kind === "tag"), []);
  assert.equal(plain.records.find(r => r.kind === "material").data.tag, undefined);
  const known = selectRecords(facts, reg, { tagKnownFor: () => true });
  assert.deepEqual(known.records.filter(r => r.kind === "tag").map(r => r.data), [{ kind: "tag", id: "ore", name: "Ore", theme: "cowardice", worksWith: "frightened" }]);
  assert.deepEqual(known.records.filter(r => r.kind === "note").map(r => r.data), [{ kind: "note", id: "page", name: "Torn Page", hasTrack: true }]);
  assert.deepEqual(loadPlayerRecords(known.records).errors, [], "every record passes the strict player schema");
  assert.doesNotMatch(JSON.stringify(known.records), /milestones|steps|research|classEffects/, "no threshold, track or class table reaches a player");
});

test("WORDS: everything the discovery chain says to a player is plain: no number, DC, odds, percent or difficulty wording", () => {
  const lines = [...W.stages, W.studyGoal("Iron"), W.studyName("Iron"), W.leadItem("Iron"), W.leadResume("Iron"), W.leadNote("Torn Page"), W.leadVersion("Ore"), W.learnedProperties("Iron", "Ore", "cowardice"), W.learnedProperties("Iron"), W.learnedFormula("Blade"), W.needItem("Iron"), W.trackGone("Iron"), W.notStudied("Iron"), W.alreadyStudying("Iron"), W.alreadyStudied("Iron"), W.noSuchLead, W.summary("Ann", "Iron", ["success", "failure"])];
  for (const line of lines) {
    assert.doesNotMatch(line, DIFFICULTY_WORDS, line);
    assert.doesNotMatch(line, /\d/, `${line}: no count`);
  }
});
