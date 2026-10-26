/**
 * Runs the REAL research store, craft preview and pack loader against small fake
 * Foundry objects (actors with flags, items, chat, packs). Nothing is injected except
 * Foundry itself, so this exercises the wiring that unit tests of the pure functions cannot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as adapter from "../scripts/adapter/pf2e.js";
import * as store from "../scripts/research/store.js";
import { previewCraft } from "../scripts/crafting/craft.js";
import { collectSources } from "../scripts/data/loader.js";
import { PACKS } from "../scripts/config.js";
import { SNAPSHOT_KEYS } from "../scripts/research/formulas.js";
import { asPage, seedRecords, UUID, UUID_2 } from "./helpers.js";

const MODULE = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const clone = value => (value === undefined ? undefined : structuredClone(value));

// Fake Foundry -----------------------------------------------------------------------------------
function fakeActor({ id = "actor1", name = "Aelwyn", mods = { crafting: -1, arcana: -1, occultism: -1 } } = {}) {
  const flags = {};
  const items = [];
  items.get = itemId => items.find(i => i.id === itemId);
  let nextItem = 1;
  const actor = {
    id, name, flags, items, updateCalls: 0, failUpdate: false, rollParams: [], rolls: [],
    getFlag: (scope, key) => (scope === MODULE ? clone(flags[key]) : undefined),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async unsetFlag(scope, key) { delete flags[key]; },
    async update(data) {
      actor.updateCalls++;
      if (actor.failUpdate) throw new Error("update failed");
      for (const [path, value] of Object.entries(data)) {
        const match = path.match(/^flags\.pathfinder-progress\.(.+)$/);
        if (!match) throw new Error(`unexpected update path ${path}`);
        flags[match[1]] = clone(value);
      }
    },
    skills: Object.fromEntries(Object.entries(mods).map(([slug, mod]) => [slug, {
      mod,
      check: { roll: async params => { actor.rollParams.push(params); return actor.rolls.shift(); } }
    }])),
    async createEmbeddedDocuments(type, datas) {
      return datas.map(data => {
        const item = {
          id: `item${nextItem++}`, name: data.name, type: data.type, system: { ...data.system }, flags: clone(data.flags ?? {}),
          getFlag: (scope, key) => item.flags[scope]?.[key],
          async update(change) { if ("system.quantity" in change) item.system.quantity = change["system.quantity"]; },
          async delete() { items.splice(items.indexOf(item), 1); }
        };
        items.push(item);
        return item;
      });
    }
  };
  return actor;
}

/** A PF2e-shaped roll result: degree, total, and the natural d20. */
const roll = (degreeOfSuccess, total, natural) => ({ options: { degreeOfSuccess }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

function install({ isGM = true, actors = [], settings = {}, packs = new Map() } = {}) {
  const chat = [];
  const notices = { info: [], warn: [], error: [] };
  const values = { partyLocation: "oakhaven", stationState: [], extraPacks: "", itemPacks: "", ...settings };
  const list = [...actors];
  list.get = id => list.find(a => a.id === id);
  list.has = id => list.some(a => a.id === id);
  globalThis.game = {
    user: { isGM }, i18n: { localize: text => text }, actors: list, packs,
    settings: { get: (scope, key) => values[key] }
  };
  globalThis.CONFIG = { PF2E: { skills: { crafting: { label: "Crafting" }, arcana: { label: "Arcana" }, occultism: { label: "Occultism" } } } };
  globalThis.ChatMessage = { create: async message => { chat.push(message); }, getSpeaker: () => ({}) };
  globalThis.ui = { notifications: { info: m => notices.info.push(m), warn: m => notices.warn.push(m), error: m => notices.error.push(m) } };
  return { chat, notices };
}

const makeApi = (overrides = {}) => ({ definitions: registry, contexts: new Map(), uncraftable: new Set(), resolvedOutputs: new Map(), ...overrides });
const DAGGER = "unlock-dagger-spider-fang";
const LONGSWORD = "unlock-longsword-basic";
const flag = (actor, key) => actor.getFlag(MODULE, key);
const projectOf = (actor, id) => flag(actor, "projects").find(p => p.id === id);

async function started(recipe = "dagger-spider-fang", extra = {}) {
  const env = install();
  const actor = fakeActor();
  const api = makeApi();
  await store.grantDays(actor, extra.days ?? 10);
  await store.startProject(api, { actor, recipe, ...extra.overrides });
  return { env, actor, api };
}

// startProject --------------------------------------------------------------------------------------
test("startProject stores a valid project on the actor", async () => {
  const { actor } = await started();
  const project = projectOf(actor, DAGGER);
  assert.deepEqual(check(LIVE_SCHEMAS.project, project), []);
  assert.deepEqual([project.goalName, project.tier, project.dc, project.threshold, project.progress, project.status], ["Spider Fang Dagger", 1, 14, 8, 0, "active"]);
});

test("startProject refuses duplicates, known formulas, unknown recipes and non-GMs", async () => {
  const { actor, api } = await started();
  await assert.rejects(store.startProject(api, { actor, recipe: "dagger-spider-fang" }), /already has an active project for "Spider Fang Dagger"/);
  await assert.rejects(store.startProject(api, { actor, recipe: "ghost" }), /unknown recipe "ghost"/);
  await store.grantFormula(api, actor, "longsword-basic");
  await assert.rejects(store.startProject(api, { actor, recipe: "longsword-basic" }), /already knows the formula for "Longsword/);
  globalThis.game.user.isGM = false;
  await assert.rejects(store.startProject(api, { actor, recipe: "dagger-spider-fang" }), /GM only/);
});

test("startProject honours dc and threshold overrides, and an abandoned project can be started again", async () => {
  const { actor, api } = await started("longsword-basic", { overrides: { dc: 14, threshold: 500 } });
  assert.deepEqual([projectOf(actor, LONGSWORD).dc, projectOf(actor, LONGSWORD).threshold], [14, 500]);
  await store.abandonProject(actor, LONGSWORD);
  assert.equal(projectOf(actor, LONGSWORD).status, "abandoned");
  await store.startProject(api, { actor, recipe: "longsword-basic" });
  assert.deepEqual([projectOf(actor, LONGSWORD).status, projectOf(actor, LONGSWORD).dc, projectOf(actor, LONGSWORD).progress], ["active", 18, 0]);
  assert.equal(flag(actor, "projects").filter(p => p.id === LONGSWORD).length, 1, "restarting replaces, never duplicates");
});

// Days ------------------------------------------------------------------------------------------------
test("days: grant, read and set, with bad values refused", async () => {
  install();
  const actor = fakeActor();
  assert.equal(store.days(actor), 0);
  assert.equal(await store.grantDays(actor, 5), 5);
  assert.equal(await store.grantDays(actor, 2), 7);
  assert.equal(await store.setDays(actor, 3), 3);
  assert.equal(store.days(actor), 3);
  for (const bad of [0, -2, 1.5]) await assert.rejects(store.grantDays(actor, bad), RangeError);
  await assert.rejects(store.setDays(actor, -1), RangeError);
  assert.equal(store.days(actor), 3);
});

// research -----------------------------------------------------------------------------------------------
test("forced-degree research (one degree per day) advances progress, spends the days, and posts one summary", async () => {
  const { env, actor, api } = await started();
  const result = await store.research({ actor, project: DAGGER, days: 4, degree: ["success", "success", "criticalSuccess", "failure"] }, api);
  assert.deepEqual([result.daysSpent, result.daysRemaining, result.completed, result.project.progress], [4, 6, false, 4]);
  assert.equal(store.days(actor), 6);
  assert.equal(projectOf(actor, DAGGER).progress, 4);
  assert.equal(projectOf(actor, DAGGER).log.length, 4);
  assert.deepEqual(check(LIVE_SCHEMAS.project, projectOf(actor, DAGGER)), []);
  assert.equal(env.chat.length, 1);
  assert.match(env.chat[0].content, /Aelwyn.*researches.*Spider Fang Dagger.*\(Crafting, 4 days\)/);
  assert.match(env.chat[0].content, /Day 3: Critical Success \(\+2\)/);
  assert.match(env.chat[0].content, /Progress: 4\/8\./);
});

test("one degree string applies to every day", async () => {
  const { actor, api } = await started();
  const result = await store.research({ actor, project: DAGGER, days: 3, degree: "success", chat: false }, api);
  assert.equal(result.project.progress, 3);
});

test("not enough days: refused before any roll and NOTHING changes", async () => {
  const { env, actor, api } = await started("dagger-spider-fang", { days: 1 });
  await assert.rejects(store.research({ actor, project: DAGGER, days: 3, degree: "success" }, api), /needs 3 downtime day\(s\) but only 1 available/);
  assert.equal(store.days(actor), 1);
  assert.equal(projectOf(actor, DAGGER).progress, 0);
  assert.equal(env.chat.length, 0);
  assert.equal(actor.rollParams.length, 0);
});

test("too few forced degrees, unknown degrees and bad day counts are refused", async () => {
  const { actor, api } = await started();
  await assert.rejects(store.research({ actor, project: DAGGER, days: 3, degree: ["success"] }, api), /1 forced degree\(s\) given for 3 day\(s\)/);
  await assert.rejects(store.research({ actor, project: DAGGER, days: 1, degree: "meh" }, api), /unknown degree "meh"/);
  for (const days of [0, -1, 1.5, undefined]) await assert.rejects(store.research({ actor, project: DAGGER, days, degree: "success" }, api), /days must be a whole number/);
  assert.equal(store.days(actor), 10);
});

test("early stop: completing mid-call stops, leaves the unspent days, and unlocks the formula with a snapshot", async () => {
  const { env, actor, api } = await started();
  await store.research({ actor, project: DAGGER, days: 4, degree: ["success", "success", "criticalSuccess", "failure"], chat: false }, api); // progress 4, 6 days left
  const before = actor.updateCalls;
  const result = await store.research({ actor, project: DAGGER, days: 4, degree: ["criticalSuccess", "criticalSuccess", "criticalSuccess", "success"] }, api);

  assert.deepEqual([result.completed, result.daysSpent, result.daysRemaining, result.project.status], [true, 2, 4, "complete"]);
  assert.equal(store.days(actor), 4);
  assert.equal(actor.updateCalls - before, 1, "progress, days AND the formula are saved in ONE update");

  const formulas = flag(actor, "formulas");
  assert.equal(formulas.length, 1);
  assert.deepEqual([formulas[0].recipeId, formulas[0].access, formulas[0].source], ["dagger-spider-fang", "owned", "research"]);
  assert.deepEqual(check(LIVE_SCHEMAS.formula, formulas[0]), []);
  assert.deepEqual(Object.keys(formulas[0].snapshot).sort(), [...SNAPSHOT_KEYS].sort());
  assert.match(env.chat.at(-1).content, /Aelwyn.*has learned.*Spider Fang Dagger/);
  await assert.rejects(store.research({ actor, project: DAGGER, days: 1, degree: "success" }, api), /is complete, not active/);
});

test("ATOMIC: if saving fails, progress, days and formula are all unchanged", async () => {
  const { actor, api } = await started();
  await store.research({ actor, project: DAGGER, days: 4, degree: "success", chat: false }, api);
  const snapshotOfState = JSON.stringify([flag(actor, "projects"), flag(actor, "downtimeDays"), flag(actor, "formulas")]);
  actor.failUpdate = true;
  await assert.rejects(store.research({ actor, project: DAGGER, days: 4, degree: "criticalSuccess" }, api), /update failed/);
  assert.equal(JSON.stringify([flag(actor, "projects"), flag(actor, "downtimeDays"), flag(actor, "formulas")]), snapshotOfState);
});

test("a chat failure after saving does not lose the research", async () => {
  const { actor, api } = await started();
  globalThis.ChatMessage.create = async () => { throw new Error("chat is down"); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await store.research({ actor, project: DAGGER, days: 2, degree: "success" }, api);
    assert.equal(result.project.progress, 2);
    assert.equal(projectOf(actor, DAGGER).progress, 2);
  } finally {
    console.error = originalError;
  }
});

test("skills: several allowed means one must be named; a wrong one is refused; one allowed is picked automatically", async () => {
  const { actor, api } = await started("longsword-basic");
  await assert.rejects(store.research({ actor, project: LONGSWORD, days: 1, degree: "success" }, api), /"Longsword \(sample recipe\)" research allow several skills \(arcana, crafting, occultism\)/);
  await assert.rejects(store.research({ actor, project: LONGSWORD, days: 1, skill: "nature", degree: "success" }, api), /skill "nature" is not allowed/);
  assert.equal((await store.research({ actor, project: LONGSWORD, days: 1, skill: "arcana", degree: "success", chat: false }, api)).skill, "arcana");
  const dagger = await started("dagger-spider-fang");
  assert.equal((await store.research({ actor: dagger.actor, project: DAGGER, days: 1, degree: "success", chat: false }, dagger.api)).skill, "crafting");
});

test("a real roll goes through PF2e without its own chat card, and the degree and total are used", async () => {
  const { env, actor, api } = await started();
  actor.rolls.push(roll(2, 15, 16), roll(3, 25, 20));
  const result = await store.research({ actor, project: DAGGER, days: 2 }, api);
  assert.deepEqual(actor.rollParams.map(p => [p.dc.value, p.skipDialog, p.createMessage]), [[14, true, false], [14, true, false]]);
  assert.deepEqual(result.results.map(r => [r.degree, r.total, r.delta]), [["success", 15, 1], ["criticalSuccess", 25, 2]]);
  assert.match(env.chat[0].content, /Day 1: 15 vs DC 14: Success \(\+1\)/);
  assert.match(env.chat[0].content, /Day 2: 25 vs DC 14: Critical Success \(\+2\)/);
});

test("a roll PF2e returns in an unreadable shape fails loudly and changes nothing", async () => {
  const { actor, api } = await started();
  actor.rolls.push({ total: 10, dice: [] });
  await assert.rejects(store.research({ actor, project: DAGGER, days: 1 }, api), /could not read the degree of success/);
  assert.equal(store.days(actor), 10);
  assert.equal(projectOf(actor, DAGGER).progress, 0);
});

test("a project whose recipe was deleted cannot be researched", async () => {
  const { actor } = await started();
  const gone = makeApi({ definitions: { ...registry, recipe: new Map() } });
  await assert.rejects(store.research({ actor, project: DAGGER, days: 1, degree: "success" }, gone), /recipe "dagger-spider-fang" no longer exists; abandon the project/);
});

// addProgress ----------------------------------------------------------------------------------------------
test("addProgress needs a reason, records it, and shares the completion path", async () => {
  const { env, actor, api } = await started("longsword-basic");
  await assert.rejects(store.addProgress(api, actor, LONGSWORD, 3), /a reason is required/);
  await assert.rejects(store.addProgress(api, actor, LONGSWORD, 3, "   "), /a reason is required/);
  const result = await store.addProgress(api, actor, LONGSWORD, 3, "Studied Master Orrin's notes");
  assert.deepEqual([result.applied, result.project.progress, result.completed], [3, 3, false]);
  assert.deepEqual(projectOf(actor, LONGSWORD).log.at(-1), { source: "addProgress", delta: 3, note: "Studied Master Orrin's notes" });
  assert.match(env.chat.at(-1).content, /advances by 3 \(Studied Master Orrin's notes\)/);

  const done = await store.addProgress(api, actor, LONGSWORD, 20, "A master's gift", { chat: false });
  assert.equal(done.completed, true);
  assert.equal(flag(actor, "formulas")[0].recipeId, "longsword-basic");
  assert.equal(store.days(actor), 10, "addProgress never spends days");
});

test("addProgress with a negative amount is a setback that cannot go below 0", async () => {
  const { actor, api } = await started("longsword-basic");
  await store.addProgress(api, actor, LONGSWORD, 2, "start", { chat: false });
  const result = await store.addProgress(api, actor, LONGSWORD, -5, "the notes burned", { chat: false });
  assert.deepEqual([result.applied, result.project.progress], [-2, 0]);
});

test("addProgress on a finished or unknown project is refused", async () => {
  const { actor, api } = await started("longsword-basic");
  await assert.rejects(store.addProgress(api, actor, "unlock-ghost", 1, "x"), /has no project "unlock-ghost"/);
  await store.abandonProject(actor, LONGSWORD);
  await assert.rejects(store.addProgress(api, actor, LONGSWORD, 1, "x"), /abandoned, not active/);
});

// Formulas ------------------------------------------------------------------------------------------------------
test("grantFormula: owned, then loan refused over owned; owned closes a running project", async () => {
  const { actor, api } = await started("longsword-basic");
  const first = await store.grantFormula(api, actor, "longsword-basic");
  assert.deepEqual([first.change, first.entry.access, first.entry.source], ["added", "owned", "gm"]);
  assert.equal(projectOf(actor, LONGSWORD).status, "abandoned");
  assert.match(projectOf(actor, LONGSWORD).log.at(-1).note, /formula granted by the GM/);
  await assert.rejects(store.grantFormula(api, actor, "longsword-basic", { access: "loan" }), /already owned; a loan cannot replace it/);
  await assert.rejects(store.grantFormula(api, actor, "ghost"), /unknown recipe "ghost"/);
  await assert.rejects(store.grantFormula(api, actor, "longsword-basic", { access: "stolen" }), /"owned" or "loan"/);
});

test("grantFormula as a loan, then upgraded to owned; a loan leaves a running project alone", async () => {
  const { actor, api } = await started("longsword-basic");
  const loan = await store.grantFormula(api, actor, "longsword-basic", { access: "loan", source: "commission" });
  assert.deepEqual([loan.change, loan.entry.access, loan.entry.source], ["added", "loan", "commission"]);
  assert.equal(projectOf(actor, LONGSWORD).status, "active");
  const upgraded = await store.grantFormula(api, actor, "longsword-basic");
  assert.deepEqual([upgraded.change, upgraded.entry.access], ["upgraded", "owned"]);
});

test("removeFormula removes it; a second removal says so", async () => {
  const { actor, api } = await started();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  await store.removeFormula(actor, "dagger-spider-fang");
  assert.deepEqual(flag(actor, "formulas"), []);
  await assert.rejects(store.removeFormula(actor, "dagger-spider-fang"), /no formula "dagger-spider-fang" to remove/);
});

test("formulasFor reports ok, stale, orphaned and invalid entries", async () => {
  const { actor, api } = await started();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  await store.grantFormula(api, actor, "longsword-basic", { access: "loan" });
  const raw = flag(actor, "formulas");
  raw[1].snapshot.craftLevel = 9; // stale
  raw.push({ recipeId: "ghost-recipe", access: "owned", source: "gm" }); // orphaned
  raw.push({ recipeId: "bad", access: "borrowed", source: "gm" }); // invalid
  await actor.setFlag(MODULE, "formulas", raw);
  const rows = Object.fromEntries(store.formulasFor(api, actor).map(r => [r.recipeId, r.status]));
  assert.deepEqual(rows, { "dagger-spider-fang": "ok", "longsword-basic": "stale", "ghost-recipe": "orphaned", bad: "invalid" });
  assert.match(store.formulasFor(api, actor).find(r => r.recipeId === "bad").problem, /access/);
});

// Editing a recipe afterwards -------------------------------------------------------------------------------------
function editedApi(mutate) {
  const edited = structuredClone(registry.recipe.get("dagger-spider-fang"));
  mutate(edited);
  return makeApi({ definitions: { ...registry, recipe: new Map([...registry.recipe, [edited.id, edited]]) } });
}

test("a recipe edit makes the copy stale; refreshing updates it, and a second refresh does nothing", async () => {
  const { actor, api } = await started();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  const edited = editedApi(r => { r.slots.find(s => s.name === "fang").qty = 2; });
  assert.equal(store.formulasFor(edited, actor)[0].status, "stale");

  const changes = await store.refreshFormulas(edited, actor);
  assert.deepEqual(changes, [{ actor: "Aelwyn", refreshed: ["dagger-spider-fang"], orphaned: [] }]);
  assert.equal(flag(actor, "formulas")[0].snapshot.slots.find(s => s.name === "fang").qty, 2);
  assert.equal(store.formulasFor(edited, actor)[0].status, "ok");
  assert.deepEqual(await store.refreshFormulas(edited, actor), []);
});

test("refresh keeps invalid and orphaned entries untouched and reports the orphans", async () => {
  const { actor, api } = await started();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  const raw = flag(actor, "formulas");
  raw.push({ recipeId: "ghost-recipe", access: "owned", source: "gm" }, { recipeId: "bad", access: "borrowed", source: "gm" });
  await actor.setFlag(MODULE, "formulas", raw);
  const edited = editedApi(r => { r.craftLevel = 5; });
  const [change] = await store.refreshFormulas(edited, actor);
  assert.deepEqual([change.refreshed, change.orphaned], [["dagger-spider-fang"], ["ghost-recipe"]]);
  const after = flag(actor, "formulas");
  assert.equal(after.length, 3);
  assert.deepEqual(after[2], { recipeId: "bad", access: "borrowed", source: "gm" }, "invalid data is never destroyed");
});

test("on load the GM is told what was refreshed and what is orphaned, so nothing changes silently", async () => {
  const { env, actor, api } = await started();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  await actor.setFlag(MODULE, "formulas", [...flag(actor, "formulas"), { recipeId: "ghost-recipe", access: "owned", source: "gm" }]);
  globalThis.game.actors.push(actor);
  const edited = editedApi(r => { r.craftLevel = 6; });
  const changes = await store.refreshAllFormulas(edited);
  assert.equal(changes.length, 1);
  assert.match(env.notices.info[0], /refreshed 1 formula copy\(ies\).*Aelwyn: dagger-spider-fang/);
  assert.match(env.notices.warn[0], /orphaned formula\(s\).*Aelwyn: ghost-recipe.*removeFormula/);
});

test("players never run the refresh", async () => {
  const { actor, api } = await started();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  globalThis.game.actors.push(actor);
  globalThis.game.user.isGM = false;
  assert.deepEqual(await store.refreshAllFormulas(editedApi(r => { r.craftLevel = 7; })), []);
  assert.equal(flag(actor, "formulas")[0].snapshot.craftLevel, 2);
});

// projectInfo ---------------------------------------------------------------------------------------------------------
test("projectInfo lists projects, and with an id shows DC, modifiers, per-day odds and expected days", async () => {
  const { actor, api } = await started();
  assert.deepEqual(store.projectInfo(api, actor), [{ id: DAGGER, goalName: "Spider Fang Dagger", status: "active", progress: 0, threshold: 8 }]);
  const info = store.projectInfo(api, actor, DAGGER);
  assert.equal(info.daysAvailable, 10);
  const crafting = info.perSkill[0];
  assert.deepEqual([crafting.skill, crafting.modifier], ["crafting", -1]);
  assert.deepEqual(crafting.chances, { criticalFailure: 0.25, failure: 0.45, success: 0.25, criticalSuccess: 0.05 });
  assert.equal(crafting.expectedProgressPerDay, 0.35);
  assert.ok(crafting.expectedDaysToFinish > 22 && crafting.expectedDaysToFinish < 24.5);
  assert.deepEqual(info.hints, []);
});

test("projectInfo copes with a skill the actor lacks and hints when the recipe changed", async () => {
  const { actor, api } = await started();
  const lacking = fakeActor({ mods: {} });
  lacking.flags.projects = flag(actor, "projects");
  assert.equal(store.projectInfo(api, lacking, DAGGER).perSkill[0].modifier, null);
  const retiered = editedApi(r => { r.researchProject.tier = 3; });
  assert.match(store.projectInfo(retiered, actor, DAGGER).hints[0], /research tier is now 3, but this project began at tier 1/);
  const gone = makeApi({ definitions: { ...registry, recipe: new Map() } });
  assert.match(store.projectInfo(gone, actor, DAGGER).hints[0], /no longer exists; abandon this project/);
  assert.throws(() => store.projectInfo(api, actor, "unlock-ghost"), /has no project "unlock-ghost"/);
});

// Crafting needs the formula (the real previewCraft) ---------------------------------------------------------------------
async function craftSetup() {
  const actor = fakeActor();
  const env = install({ actors: [actor] });
  const api = makeApi({ resolvedOutputs: new Map([["dagger-spider-fang", { "1": UUID, "2": UUID_2, "3": UUID }]]) });
  await adapter.giveMaterial(actor, registry.material.get("iron"), 3);
  await adapter.giveMaterial(actor, registry.material.get("spider-fang"), 3);
  return { env, actor, api };
}
const SEL = { blade: "iron", fang: "spider-fang" };

test("previewCraft refuses a recipe the actor has no formula for, and works once it is granted", async () => {
  const { actor, api } = await craftSetup();
  const refused = previewCraft(actor, "dagger-spider-fang", SEL, api);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.errors, ['Aelwyn does not know the formula for "Spider Fang Dagger" (research it, or have the GM grant it)']);

  await store.grantFormula(api, actor, "dagger-spider-fang");
  const allowed = previewCraft(actor, "dagger-spider-fang", SEL, api);
  assert.ok(allowed.ok, allowed.errors.join(" | "));
  assert.equal(allowed.plan.provenance.formulaAccess, "owned");
  assert.equal(allowed.plan.station.id, "oakhaven-forge");
});

test("a loaned formula lets previewCraft through and says so in the provenance", async () => {
  const { actor, api } = await craftSetup();
  await store.grantFormula(api, actor, "dagger-spider-fang", { access: "loan" });
  const result = previewCraft(actor, "dagger-spider-fang", SEL, api);
  assert.ok(result.ok, result.errors.join(" | "));
  assert.equal(result.plan.provenance.formulaAccess, "loan");
});

test("an orphaned formula: crafting its (deleted) recipe gives a clear message pointing at the fix", async () => {
  const { actor, api } = await craftSetup();
  await actor.setFlag(MODULE, "formulas", [{ recipeId: "ghost-recipe", access: "owned", source: "gm" }]);
  const result = previewCraft(actor, "ghost-recipe", {}, api);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unknown recipe "ghost-recipe"; Aelwyn holds an orphaned formula for it.*api\.removeFormula/);
  assert.deepEqual(previewCraft(actor, "never-existed", {}, api).errors, ['unknown recipe "never-existed"']);
});

test("removing the formula blocks crafting again", async () => {
  const { actor, api } = await craftSetup();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  assert.ok(previewCraft(actor, "dagger-spider-fang", SEL, api).ok);
  await store.removeFormula(actor, "dagger-spider-fang");
  assert.equal(previewCraft(actor, "dagger-spider-fang", SEL, api).ok, false);
});

test("crafting uses the LIVE recipe, not the snapshot: after an edit the plan reflects it at once", async () => {
  const { actor, api } = await craftSetup();
  await store.grantFormula(api, actor, "dagger-spider-fang");
  assert.equal(previewCraft(actor, "dagger-spider-fang", SEL, api).plan.uses.find(u => u.slot === "fang").units, 1);
  const edited = structuredClone(registry.recipe.get("dagger-spider-fang"));
  edited.slots.find(s => s.name === "fang").qty = 2;
  const liveApi = makeApi({
    definitions: { ...registry, recipe: new Map([...registry.recipe, [edited.id, edited]]) },
    resolvedOutputs: api.resolvedOutputs
  });
  const plan = previewCraft(actor, "dagger-spider-fang", SEL, liveApi).plan;
  assert.equal(plan.uses.find(u => u.slot === "fang").units, 2, "the new quantity applies although the snapshot still says 1");
  assert.equal(flag(actor, "formulas")[0].snapshot.slots.find(s => s.name === "fang").qty, 1);
});

// GM-only ----------------------------------------------------------------------------------------------------------------
test("every research and formula tool is GM-only", async () => {
  const { actor, api } = await started();
  globalThis.game.user.isGM = false;
  await assert.rejects(store.grantDays(actor, 1), /GM only/);
  await assert.rejects(store.setDays(actor, 1), /GM only/);
  await assert.rejects(store.research({ actor, project: DAGGER, days: 1, degree: "success" }, api), /GM only/);
  await assert.rejects(store.addProgress(api, actor, DAGGER, 1, "x"), /GM only/);
  await assert.rejects(store.abandonProject(actor, DAGGER), /GM only/);
  await assert.rejects(store.grantFormula(api, actor, "dagger-spider-fang"), /GM only/);
  await assert.rejects(store.removeFormula(actor, "dagger-spider-fang"), /GM only/);
  await assert.rejects(store.refreshFormulas(api, actor), /GM only/);
});

test("a stored flag that is not a list is a loud error, never silently replaced", async () => {
  const { actor, api } = await started();
  actor.flags.projects = "oops";
  await assert.rejects(store.startProject(api, { actor, recipe: "longsword-basic" }), /"projects" flag is not a list/);
});

// The GM-only recipes pack ---------------------------------------------------------------------------------------------------
function fakePack({ documentName = "JournalEntry", visible = true, entries = [], fail = false } = {}) {
  return {
    documentName, visible,
    async getDocuments() {
      if (fail) throw new Error("You do not have permission to view this compendium");
      return entries.map(e => { const pages = [{ type: "text", name: "Definition", text: { markdown: e.text } }]; pages.size = 1; return { name: e.name, pages }; });
    }
  };
}
const sampleText = '```json\n{"kind":"town","id":"oakhaven","name":"Oakhaven"}\n```';

test("the loader reads the GM-only recipes pack for a GM", async () => {
  install({ packs: new Map([[PACKS.definitions, fakePack({ entries: [{ name: "Oakhaven", text: sampleText }] })], [PACKS.recipes, fakePack({ entries: [{ name: "R", text: sampleText }] })]]) });
  const { sources, problems } = await collectSources();
  assert.deepEqual(problems, []);
  assert.deepEqual(sources.map(s => s.pack), [PACKS.definitions, PACKS.recipes]);
});

test("a player skips the recipes pack quietly, however Foundry hides it", async () => {
  for (const recipesPack of [fakePack({ visible: false }), fakePack({ fail: true }), undefined]) {
    const packs = new Map([[PACKS.definitions, fakePack({ entries: [{ name: "Oakhaven", text: sampleText }] })]]);
    if (recipesPack) packs.set(PACKS.recipes, recipesPack);
    install({ isGM: false, packs });
    const { sources, problems } = await collectSources();
    assert.deepEqual(problems, [], "players are never shown pack problems");
    assert.deepEqual(sources.map(s => s.pack), [PACKS.definitions]);
  }
});

test("a GM IS told when a pack is missing or unreadable", async () => {
  install({ packs: new Map([[PACKS.definitions, fakePack()], [PACKS.recipes, fakePack({ fail: true })]]) });
  const { problems } = await collectSources();
  assert.match(problems[0].message, /could not be read: You do not have permission/);
  install({ packs: new Map([[PACKS.definitions, fakePack()]]) });
  assert.match((await collectSources()).problems[0].message, /was not found/);
});

// Build and manifest guards ----------------------------------------------------------------------------------------------------
test("MANIFEST GUARD: the recipes pack is declared GM-only (players and trusted players get NONE)", () => {
  const manifest = JSON.parse(readFileSync("module.json", "utf8"));
  const recipes = manifest.packs.find(p => p.name === "recipes");
  assert.ok(recipes, "module.json must declare the recipes pack");
  assert.equal(recipes.type, "JournalEntry");
  assert.equal(recipes.path, "packs/recipes");
  assert.equal(recipes.ownership.PLAYER, "NONE");
  assert.equal(recipes.ownership.TRUSTED, "NONE");
  assert.equal(recipes.ownership.ASSISTANT, "OWNER");
  assert.equal(`${manifest.id}.${recipes.name}`, PACKS.recipes);
  const definitions = manifest.packs.find(p => p.name === "definitions");
  assert.notEqual(definitions.ownership?.PLAYER, "NONE", "the public pack must stay readable");
});

test("CONTENT GUARD: recipes live only in content/recipes, and nothing else does", () => {
  const kindsIn = dir => readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).kind);
  assert.deepEqual([...new Set(kindsIn("content/recipes"))], ["recipe"]);
  assert.ok(!kindsIn("content/definitions").includes("recipe"), "a recipe in the public pack would be readable by players");
});

test("the build script builds the recipes pack from content/recipes", () => {
  const script = readFileSync("build/pack.mjs", "utf8");
  assert.match(script, /name: "recipes", source: "content\/recipes"/);
  assert.match(script, /name: "definitions", source: "content\/definitions"/);
});
