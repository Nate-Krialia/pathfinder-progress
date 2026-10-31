/** The discovery chain through the real main.js in the fake Foundry (Stage 11c): leads from inventory, studies, milestones, the tag relay, crafting gating, versions. */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, SEL, as, craft, env, getApi, getUsers, loudly, makeActor, resolve, world } from "./fake-world.js";
import { DIFFICULTY_WORDS } from "../scripts/difficulty.js";

const api = () => getApi();
const roll = (degree = 2) => ({ options: { degreeOfSuccess: degree }, total: 25, dice: [{ faces: 20, results: [{ result: 15, active: true }] }] });
const track = (...m) => ({ milestones: m.map(([steps, type, recipeId]) => ({ steps, grants: type === "formula" ? { type, ...(recipeId ? { recipeId } : {}) } : { type } })) });
const recipe = (id, name, over = {}) => ({ kind: "recipe", id, name, category: "weapon", output: { 1: "Dagger", 2: "Dagger", 3: "Dagger", 4: "Dagger", 5: "Dagger" }, craftLevel: 2, stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }], ...over });

/** A world with a tag, two tracked ore materials, a plain material, a note and a blade family. Everything is memory-only. */
async function discoveryWorld(options = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 0, fang: 0, copper: 20000, ...options });
  const defs = [
    ["tag", { kind: "tag", id: "g7-ore", name: "Gate ore", theme: "cowardice", worksWith: "frightened" }],
    ["material", { kind: "material", id: "g7-a", name: "Gate Ore A", tier: 1, value: 5, effects: { basePower: "T1" }, tag: "g7-ore", research: track([4, "properties"], [8, "formula", "g7-blade"]) }],
    ["material", { kind: "material", id: "g7-b", name: "Gate Ore B", tier: 1, value: 5, effects: { basePower: "T1" }, tag: "g7-ore", research: track([2, "properties"]) }],
    ["material", { kind: "material", id: "g7-plain", name: "Gate Plain", tier: 1, effects: { basePower: "T1" }, tag: "g7-ore", value: 12 }],
    ["recipe", recipe("g7-blade", "Gate Blade", { family: "g7-blades", version: 1 })],
    ["recipe", recipe("g7-blade2", "Gate Blade II", { family: "g7-blades", version: 2, requiresTag: "g7-ore", requiresCount: 2, researchProject: { tier: 2 }, research: track([5, "formula"]) })],
    ["note", { kind: "note", id: "g7-page", name: "Gate Page", recipeId: "g7-blade", research: track([3, "formula"]) }]
  ];
  for (const [kind, record] of defs) api().definitions[kind].set(record.id, record);
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}
// (a player client learns about a new item when its definitions refresh; in Foundry the createItem hook asks for that)
const give = async (w, id, n = 1, actor = w.ann) => { await api().giveMaterial(actor, id, n); await as(w.annUser, () => api().definitions.refresh({ force: true })); };
const giveNote = async (w, id) => { await api().discovery.giveNote(w.ann, id); await as(w.annUser, () => api().definitions.refresh({ force: true })); };
const ledger = actor => actor.getFlag(M, "discoveries")?.items ?? {};
const leadIds = (w, actor = w.ann) => as(w.annUser, () => api().research.leadsFor(actor)).map(l => l.id).sort();
const study = (w, key, degree, days = 1, actor = w.ann) => as(w.gm, () => api().research.study({ actor, key, days, skill: "crafting", degree, chat: false }));

test("LEADS: a carried material or note WITH a track is a lead; one without a track never is; leaving the inventory withdraws it", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a"); await give(w, "g7-plain");
  await giveNote(w, "g7-page");
  assert.deepEqual(leadIds(w), ["item:material:g7-a", "item:note:g7-page"], "the plain material offers no lead");
  const [lead] = as(w.annUser, () => api().research.leadsFor(w.ann)).filter(l => l.id === "item:material:g7-a");
  assert.deepEqual([lead.source, lead.name], ["item", "Gate Ore A"]);
  await w.ann.items.find(i => i.name === "Gate Ore A").delete();
  assert.deepEqual(leadIds(w), ["item:note:g7-page"]);
  assert.deepEqual(w.ann.getFlag(M, "leads") ?? [], [], "item leads are derived, never stored");
});

test("FOLLOW: starting costs nothing; the GM checks the inventory itself; a spoofed or used-up lead is refused in plain words", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a");
  await assert.rejects(as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-b")), /no longer hold the item|gone/);
  await assert.rejects(as(w.bobUser, () => api().research.follow(w.ann, "item:material:g7-a")), /own|Ann/i, "not the owner");
  const days = w.ann.getFlag(M, "downtimeDays");
  const started = await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  assert.deepEqual([started.kind, started.goalName, started.stage, started.stageWord], ["study", "Study: Gate Ore A", 0, "Just started"]);
  assert.equal(w.ann.getFlag(M, "downtimeDays"), days, "it costs nothing until days are spent");
  assert.doesNotMatch(JSON.stringify(started), /steps|threshold|milestone|"dc"/);
  await assert.rejects(as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a")), /no longer hold the item|gone|studied/);
  assert.deepEqual(leadIds(w), [], "a started study is no longer a lead");
});

test("STUDY: checks add steps; the properties milestone opens the material (crafting, tag, theme); the formula milestone teaches the formula", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a", 2);
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  await w.ann.update({ [`flags.${M}.compendium.materials.g7-a`]: { id: "g7-a", name: "Gate Ore A", tier: 1, firstAt: 1, places: [], rungs: [] } });
  const selection = { body: "g7-a" };
  const gated = as(w.gm, () => api().previewCraft(w.ann, DAGGER, { blade: "g7-a", fang: "spider-fang" }, "oakhaven-forge"));
  void selection; void gated;
  assert.equal(api().discovery.propertiesOpen(w.ann, "g7-a"), false);
  await study(w, "material:g7-a", "success", 3);
  let entry = ledger(w.ann)["material:g7-a"];
  assert.deepEqual([entry.steps, entry.reached.length, entry.stage], [3, 0, 2], "3 of 4 toward the first milestone: nearly there");
  assert.equal(api().discovery.propertiesOpen(w.ann, "g7-a"), false);
  await study(w, "material:g7-a", "criticalSuccess", 1);
  entry = ledger(w.ann)["material:g7-a"];
  assert.deepEqual(entry.reached, [{ index: 0, type: "properties" }], "the properties milestone");
  assert.equal(api().discovery.propertiesOpen(w.ann, "g7-a"), true);
  assert.equal(as(w.annUser, () => api().definitions.material.get("g7-a")).tag, undefined, "the player copy has not been refreshed yet");
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const playerCopy = as(w.annUser, () => api().definitions);
  assert.equal(playerCopy.material.get("g7-a").tag, "g7-ore", "the tag arrives with the properties");
  assert.deepEqual(playerCopy.tag.get("g7-ore"), { kind: "tag", id: "g7-ore", name: "Gate ore", theme: "cowardice", worksWith: "frightened" });
  assert.equal(w.ann.getFlag(M, "formulas")?.some(f => f.recipeId === "g7-blade") ?? false, false);
  await study(w, "material:g7-a", "criticalSuccess", 2);
  entry = ledger(w.ann)["material:g7-a"];
  assert.deepEqual([entry.status, entry.reached.map(r => r.type)], ["complete", ["properties", "formula"]]);
  assert.ok(w.ann.getFlag(M, "formulas").some(f => f.recipeId === "g7-blade"), "the formula milestone taught Gate Blade");
  assert.deepEqual(leadIds(w), [], "a finished study is not a lead any more");
});

test("QUEUE: a study is an ordinary research queue item; the row has no counts; the GM resolves it with the rolls scripted; the whisper has degree words only", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-b");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-b"));
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: "study:material:g7-b", skill: "crafting" }, 2));
  const row = as(w.annUser, () => api().queue.list([w.ann])).find(r => r.action.id === action.id);
  assert.equal(row.label, "Research: Study: Gate Ore B");
  assert.doesNotMatch(JSON.stringify(row), /DC|\d+\/\d+|threshold|steps/);
  w.ann.rolls.push(roll(3), roll(2));
  env.chat.length = 0;
  const out = await api().queue.resolve(w.ann, action.id, { chat: true });
  assert.equal(out.status, "resolved", out.message);
  assert.deepEqual(ledger(w.ann)["material:g7-b"].reached, [{ index: 0, type: "properties" }], "2 steps from a critical success: the first (and only) milestone");
  assert.ok(env.chat.length >= 1 && env.chat.every(m => Array.isArray(m.whisper) && m.whisper.length), "whispers only");
  assert.doesNotMatch(env.chat.map(m => m.content).join(" "), /DC|\btotal\b|\b25\b|natural/i);
  assert.match(env.chat.map(m => m.content).join(" "), /Gate Ore B[\s\S]*what Gate Ore B is good for: Gate ore, a theme of cowardice/);
  assert.ok(api().gm.log({ kind: "research" }).some(l => /Gate Ore B/.test(l.text) && /DC/.test(l.text)), "the totals and the DC went to the GM log");
});

test("CRAFTING: a tracked, unstudied material is refused by previewCraft and craft with a plain reason; studying opens it", async () => {
  const w = await discoveryWorld();
  api().definitions.recipe.set("g7-dag", recipe("g7-dag", "Gate Dagger", { output: { default: "Dagger", 1: "Dagger" }, slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }] }));
  const dagger = api().definitions.recipe.get(DAGGER);
  const slots = dagger.slots.map(s => s.name);
  assert.equal(slots.length, 2);
  await give(w, "iron", 2).catch(() => {});                       // (iron is the sample's tier-1 material; it has no track)
  await give(w, "spider-fang", 1);
  const sel = { blade: "iron", fang: "spider-fang" };
  assert.equal(as(w.gm, () => api().previewCraft(w.ann, DAGGER, sel, "oakhaven-forge")).ok, true, "no track: usable at once");
  // give the iron a track
  api().definitions.material.get("iron").research = track([4, "properties"]);
  const refused = as(w.gm, () => api().previewCraft(w.ann, DAGGER, sel, "oakhaven-forge"));
  assert.deepEqual([refused.ok, refused.errors], [false, ["You haven't studied Iron enough to craft with it yet."]]);
  await assert.rejects(as(w.gm, () => api().craft({ actor: w.ann, recipeId: DAGGER, selection: sel, station: "oakhaven-forge", degree: "success" })), /haven't studied Iron/);
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const player = as(w.annUser, () => api().previewCraft(w.ann, DAGGER, sel, "oakhaven-forge"));
  assert.deepEqual([player.ok, player.errors], [false, ["You haven't studied Iron enough to craft with it yet."]], "the player's own preview says so too");
  await api().discovery.startStudy(w.ann, "material:iron");
  await study(w, "material:iron", "criticalSuccess", 2);
  assert.equal(as(w.gm, () => api().previewCraft(w.ann, DAGGER, sel, "oakhaven-forge")).ok, true, "studied: open");
});

test("RETROACTIVE: a track added later does not lock out someone who already learned the material by crafting", async () => {
  const w = await discoveryWorld();
  await give(w, "iron", 1); await give(w, "spider-fang", 1);
  await resolve(w.ann, (await craft(w, w.annUser, w.ann, { selection: { blade: "iron", fang: "spider-fang" } })).id, { degree: "success" });
  api().definitions.material.get("iron").research = track([4, "properties"]);
  assert.equal(api().discovery.propertiesOpen(w.ann, "iron"), true, "they have crafted with it: the properties milestone is theirs");
  assert.equal(api().discovery.propertiesOpen(w.bob, "iron"), false, "someone who has not is not");
});

test("PUT ASIDE keeps a study's progress; it comes back as a lead and following picks it up where it stopped", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  await study(w, "material:g7-a", "success", 3);
  const out = await as(w.annUser, () => api().research.putAside(w.ann, "study:material:g7-a"));
  assert.deepEqual(out, { kept: true });
  assert.equal(ledger(w.ann)["material:g7-a"].steps, 3, "progress kept");
  assert.deepEqual(as(w.annUser, () => api().projectInfo(w.ann)).filter(p => p.kind === "study"), [], "no longer an active study");
  assert.deepEqual(leadIds(w), ["item:material:g7-a"], "a lead again");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  assert.deepEqual([ledger(w.ann)["material:g7-a"].steps, ledger(w.ann)["material:g7-a"].paused], [3, undefined]);
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: "study:material:g7-a", skill: "crafting" }, 1));
  await assert.rejects(as(w.annUser, () => api().research.putAside(w.ann, "study:material:g7-a")), /Cancel the queued research/);
  await as(w.annUser, () => api().queue.cancel(w.ann, action.id));
});

test("ITEM GONE: a queued check on an item the character no longer holds is invalid, refunds the days and keeps the progress; the item back = studying again", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  await study(w, "material:g7-a", "success", 2);
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "research", { projectId: "study:material:g7-a", skill: "crafting" }, 2));
  await w.ann.items.find(i => i.name === "Gate Ore A").delete();
  const free = w.ann.getFlag(M, "downtimeDays");
  const out = await api().queue.resolve(w.ann, action.id, { chat: false });
  assert.equal(out.status, "invalid");
  assert.match(out.message, /You need Gate Ore A in hand to study it/);
  assert.equal(w.ann.getFlag(M, "downtimeDays"), free + 2, "the reserved days came back");
  assert.equal(ledger(w.ann)["material:g7-a"].steps, 2, "progress kept");
});

test("EDITING a track applies to a study already running (thresholds are not copied onto the actor)", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  await study(w, "material:g7-a", "success", 2);
  assert.doesNotMatch(JSON.stringify(w.ann.getFlag(M, "discoveries")), /threshold|milestones/, "the ledger holds no thresholds");
  await api().discovery.tracks.set("material:g7-a", track([3, "properties"]));
  await study(w, "material:g7-a", "success", 1);
  assert.deepEqual(ledger(w.ann)["material:g7-a"].reached, [{ index: 0, type: "properties" }], "the new, lower threshold applied");
  assert.equal(ledger(w.ann)["material:g7-a"].status, "complete");
  await assert.rejects(as(w.annUser, () => api().discovery.tracks.set("material:g7-a", null)), /GM only/);
  await assert.rejects(api().discovery.tracks.set("material:g7-a", track([5, "properties"], [3, "formula", "g7-blade"])), /more than the milestone before it/);
  await assert.rejects(api().discovery.tracks.set("material:g7-a", track([5, "formula", "ghost"])), /pick a formula that exists/);
});

test("VERSIONS: with the previous formula known and two different tagged materials understood, the higher version appears as a LEAD, researched with the thresholds set on that version", async () => {
  const w = await discoveryWorld();
  await api().grantFormula(w.ann, "g7-blade");
  await give(w, "g7-a"); await give(w, "g7-b");
  await w.ann.update({ [`flags.${M}.compendium.materials`]: { "g7-a": { id: "g7-a", name: "Gate Ore A", tier: 1, firstAt: 1, places: [], rungs: [] }, "g7-b": { id: "g7-b", name: "Gate Ore B", tier: 1, firstAt: 1, places: [], rungs: [] } } });
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  await study(w, "material:g7-a", "criticalSuccess", 2);
  assert.deepEqual((w.ann.getFlag(M, "leads") ?? []).map(l => l.recipeId), [], "one understood tagged material: not yet");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-b"));
  await study(w, "material:g7-b", "criticalSuccess", 1);
  const leads = w.ann.getFlag(M, "leads");
  assert.deepEqual(leads.map(l => [l.recipeId, l.source]), [["g7-blade2", "version"]]);
  assert.match(leads[0].note, /Gate ore materials/);
  assert.doesNotMatch(leads[0].note, DIFFICULTY_WORDS);
  assert.equal(w.ann.getFlag(M, "formulas").some(f => f.recipeId === "g7-blade2"), false, "never an instant unlock");
  await api().discovery.refreshVersionLeads(w.ann);
  assert.equal(w.ann.getFlag(M, "leads").length, 1, "idempotent");
  const started = await as(w.annUser, () => api().research.follow(w.ann, leads[0].id));
  assert.equal(started.kind, "study", "the version has its own track, so it is studied with those milestones");
  assert.deepEqual(w.ann.getFlag(M, "leads") ?? [], [], "the lead is used up");
  await study(w, "recipe:g7-blade2", "criticalSuccess", 3);
  assert.ok(w.ann.getFlag(M, "formulas").some(f => f.recipeId === "g7-blade2"), "only after researching it (5 steps on that version's own track)");
});

test("A NOTE with a track offers a lead and teaches its formula; a note without one does nothing", async () => {
  const w = await discoveryWorld();
  await giveNote(w, "g7-page");
  await as(w.annUser, () => api().research.follow(w.ann, "item:note:g7-page"));
  await study(w, "note:g7-page", "criticalSuccess", 2);
  assert.ok(w.ann.getFlag(M, "formulas").some(f => f.recipeId === "g7-blade"));
  assert.equal(ledger(w.ann)["note:g7-page"].status, "complete");
});

test("RELAY AUDIT: a player's definitions carry no track, no class table, no threshold; the gold value and hasTrack come through; the tag only once known", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a"); await give(w, "g7-plain");
  await giveNote(w, "g7-page");
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const defs = as(w.annUser, () => api().definitions);
  assert.deepEqual(defs.material.get("g7-a"), { kind: "material", id: "g7-a", name: "Gate Ore A", tier: 1, value: 5, hasTrack: true }, "unstudied: no tag");
  assert.deepEqual(defs.material.get("g7-plain"), { kind: "material", id: "g7-plain", name: "Gate Plain", tier: 1, value: 12, hasTrack: false, tag: "g7-ore" }, "no track: tag known on pickup");
  assert.deepEqual([...defs.tag.keys()], ["g7-ore"], "the tag arrives with the plain material");
  assert.deepEqual(defs.note.get("g7-page"), { kind: "note", id: "g7-page", name: "Gate Page", hasTrack: true });
  assert.doesNotMatch(JSON.stringify([...defs.material.values(), ...defs.note.values(), ...defs.recipe.values()]), /milestones|steps|research|classEffects|requiresTag|family/);
  // the overlay adds a track: the player copy learns THAT a track exists, not what it is
  await api().discovery.tracks.set("material:g7-plain", track([4, "properties"]));
  await as(w.gm, () => api().publishDefinitions());
  await as(w.annUser, () => api().definitions.refresh());
  assert.equal(as(w.annUser, () => api().definitions.material.get("g7-plain")).hasTrack, true);
  assert.equal(as(w.annUser, () => api().definitions.material.get("g7-plain")).tag, undefined, "and its tag is withheld until studied");
});

test("PROJECT INFO: a study lists with a plain stage and no counts; the GM sees the steps", async () => {
  const w = await discoveryWorld();
  await give(w, "g7-a");
  await as(w.annUser, () => api().research.follow(w.ann, "item:material:g7-a"));
  await study(w, "material:g7-a", "success", 2);
  const list = as(w.annUser, () => api().projectInfo(w.ann)).filter(p => p.kind === "study");
  assert.deepEqual(list.map(p => [p.id, p.stageWord]), [["study:material:g7-a", "Getting somewhere"]]);
  assert.equal(list[0].progress, undefined);
  const info = as(w.annUser, () => api().projectInfo(w.ann, "study:material:g7-a"));
  assert.equal(info.project.steps, undefined);
  assert.deepEqual(info.perSkill.map(s => s.skill), ["crafting", "nature", "arcana"], "the config default skills");
  assert.equal(as(w.gm, () => api().projectInfo(w.ann, "study:material:g7-a")).project.steps, 2);
});

test("MIGRATION at startup: older per-recipe facts fold into item classes for every character and the shared book, once", async () => {
  const w = await discoveryWorld();
  const old = { v: 1, materials: {}, creatures: {}, regions: {}, experiments: { [DAGGER]: { recipeId: DAGGER, name: "Dagger", firstAt: 1, slots: { blade: { iron: { materialId: "iron", materialName: "Iron", tier: 1, effects: { basePower: "T1" }, at: 2 } } } } } };
  await w.ann.update({ [`flags.${M}.compendium`]: old });
  assert.equal(await api().compendium.migrateClasses(), 1);
  assert.deepEqual(w.ann.getFlag(M, "compendium").classes.weapon.iron.effects, { basePower: "T1" });
  assert.equal(await api().compendium.migrateClasses(), 0, "idempotent");
});

test("A damaged ledger fails loudly, naming the character", async () => {
  const w = await discoveryWorld();
  await w.ann.update({ [`flags.${M}.discoveries`]: { v: 1, items: { x: { nope: true } } } });
  const { readLedger } = await import("../scripts/discovery/store.js");
  assert.throws(() => readLedger(w.ann), /Ann's discoveries are invalid/);
  void getUsers; void makeActor; void loudly;
});

test("RECORDER: a craft teaches a material's behaviour for the item CLASS, but an overridden slot teaches only that recipe", async () => {
  const w = await discoveryWorld();
  const { noteCrafted } = await import("../scripts/compendium/store.js");
  const longsword = api().definitions.recipe.get("longsword-basic");        // silver in its coating slot has a recipe override
  await noteCrafted(api().definitions, w.ann, longsword, [{ slot: "blade", materialId: "iron" }, { slot: "coating", materialId: "silver" }]);
  const book = w.ann.getFlag(M, "compendium");
  assert.deepEqual(Object.keys(book.classes.weapon), ["iron"], "iron has no override here: the whole weapon class learns it");
  assert.deepEqual(Object.keys(book.experiments["longsword-basic"].slots), ["coating"], "silver's override is this recipe's own fact");
  assert.equal(book.experiments["longsword-basic"].category, "weapon");
  assert.equal(book.classes.weapon.silver, undefined, "and does NOT teach the class what silver does elsewhere");
});
