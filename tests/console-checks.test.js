/**
 * Runs the copy-and-paste blocks in docs/12-console-checks.md against the REAL main.js API (boot the module with a
 * fake Hooks, fire init and ready, then run the blocks exactly as written). So the calls, argument shapes and return
 * values the blocks rely on are checked, not assumed. The Foundry/PF2e specifics only a real run can show.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";

const M = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const AsyncFunction = (async () => {}).constructor;
const clone = v => (v === undefined ? undefined : structuredClone(v));
const roll = (degreeOfSuccess, total, natural) => ({ options: { degreeOfSuccess }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

// The blocks, straight from the doc -------------------------------------------------------------------------------------
const doc = readFileSync("docs/12-console-checks.md", "utf8");
function block(label) {
  const match = doc.match(new RegExp(`## \\[GM\\] ${label}\\s+\`\`\`js\\n([\\s\\S]*?)\`\`\``));
  assert.ok(match, `docs/12-console-checks.md needs a "## [GM] ${label}" block`);
  return match[1];
}
const SETUP = block("Setup"), CHECK = block("Check"), CLEANUP = block("Cleanup");
const run = code => new AsyncFunction(code.replace("await (async () =>", "return await (async () =>"))();

// Fake Foundry ------------------------------------------------------------------------------------------------------------
class FakeForcedDeletion {}
function applyPath(target, path, value) {
  const parts = path.split(".");
  let o = target;
  for (const part of parts.slice(0, -1)) o = (o[part] ??= {});
  const last = parts.at(-1);
  if (value instanceof FakeForcedDeletion) { delete o[last]; return; }
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  if (isObj(value) && isObj(o[last])) for (const [k, v] of Object.entries(value)) applyPath(o[last], k, v);
  else o[last] = clone(value);
}
const collection = items => { items.get = id => items.find(i => i.id === id); items.getName = n => items.find(i => i.name === n); return items; };

let counter = 0;
const newId = prefix => `${prefix}${++counter}`;

function makeToken(data) {
  const token = {
    documentName: "Token", id: newId("tok"), name: data.name, x: data.x, y: data.y, hidden: !!data.hidden,
    texture: { src: data.texture?.src }, flags: clone(data.flags ?? {}), actorId: data.actorId,
    get uuid() { return `Scene.s.Token.${token.id}`; },
    getFlag: (scope, key) => clone(token.flags[scope]?.[key]),
    async setFlag(scope, key, value) { applyPath(token.flags, `${scope}.${key}`, value); },
    async unsetFlag(scope, key) { delete token.flags[scope]?.[key]; },
    async update(change) { for (const [k, v] of Object.entries(change)) if (k !== "_id") applyPath(token, k, v); }
  };
  return token;
}

let canvasRef;
function makeScene(name) {
  const scene = {
    id: newId("scene"), name, flags: {}, tokens: collection([]), grid: { size: 100 },
    dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000 },
    getFlag: (scope, key) => clone(scene.flags[scope]?.[key]),
    async setFlag(scope, key, value) { (scene.flags[scope] ??= {})[key] = clone(value); },
    async unsetFlag(scope, key) { delete scene.flags[scope]?.[key]; },
    async view() { canvasRef.scene = scene; },
    async createEmbeddedDocuments(type, datas) { return datas.map(d => { const t = makeToken(d); scene.tokens.push(t); return t; }); },
    async updateEmbeddedDocuments(type, updates) { for (const u of updates) { const t = scene.tokens.get(u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") applyPath(t, k, v); } },
    async deleteEmbeddedDocuments(type, ids) { for (const id of ids) { const i = scene.tokens.findIndex(t => t.id === id); if (i >= 0) scene.tokens.splice(i, 1); } }
  };
  return scene;
}

function makeActor(data) {
  const flags = clone(data.flags?.[M] ?? {});
  const actor = {
    id: newId("actor"), name: data.name, type: data.type, ownership: clone(data.ownership), prototypeToken: clone(data.prototypeToken), flags, isOwner: true,
    getFlag: (scope, key) => (scope === M ? clone(flags[key]) : undefined),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(change) {
      for (const [path, value] of Object.entries(change)) {
        if (path.startsWith(`flags.${M}.`)) flags[path.slice(`flags.${M}.`.length)] = clone(value);
        else applyPath(actor, path, value);
      }
    },
    testUserPermission: user => actor.ownership?.[user.id] === 3,
    perception: { check: { roll: async () => roll(2, 16, 10) } },
    skills: { survival: { mod: 8, check: { roll: async () => roll(2, 18, 12) } }, nature: { mod: 8, check: { roll: async () => roll(2, 18, 12) } } },
    async getTokenDocument(td) { return { toObject: () => ({ actorId: actor.id, ...clone(actor.prototypeToken ?? {}), ...clone(td) }) }; },
    async delete() { const i = game.actors.indexOf(actor); if (i >= 0) game.actors.splice(i, 1); }
  };
  return actor;
}

const listeners = {};
globalThis.Hooks = {
  once: (name, fn) => (listeners[name] ??= []).push(fn),
  on: (name, fn) => (listeners[name] ??= []).push(fn)
};

let importedMain = false;
const quietly = async fn => {
  const saved = [console.log, console.error];
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { [console.log, console.error] = saved; }
};

/** A fresh world, then boot the real module (init + ready) and hand back its api. */
async function boot({ withScene = true, testCharacter = null } = {}) {
  const gm = { id: "gm1", isGM: true, active: true, name: "GM" };
  const testUser = {
    id: "u-test", isGM: false, active: true, name: "Test", character: null, flags: {},
    getFlag: (scope, key) => clone(testUser.flags[key]),
    async setFlag(scope, key, value) { testUser.flags[key] = clone(value); },
    async unsetFlag(scope, key) { delete testUser.flags[key]; },
    async update(change) { if ("character" in change) testUser.character = change.character ? game.actors.get(change.character) ?? null : null; }
  };
  const values = { auditLedger: {}, downtime: {}, explorationState: {}, commissions: [], nodeActorId: "", extraPacks: "", itemPacks: "", partyLocation: "", stationState: [] };
  const modules = new Map();
  canvasRef = { scene: null };
  globalThis.canvas = canvasRef;
  globalThis.game = {
    user: gm, users: collection([gm, testUser]), actors: collection([]), scenes: collection([]), packs: { get: () => undefined, filter: () => [] },
    system: { id: "pf2e", version: "8.6.1" }, version: "14.369", i18n: { localize: t => t },
    modules: { get: id => modules.get(id) ?? (modules.set(id, { id, active: true }), modules.get(id)) },
    settings: { register() {}, get: (s, k) => clone(values[k]), set: async (s, k, v) => { values[k] = clone(v); } }
  };
  globalThis.foundry = {
    utils: { randomID: () => newId("r") },
    data: { fields: { ArrayField: class {}, ObjectField: class {} }, operators: { ForcedDeletion: FakeForcedDeletion } },
    applications: { instances: new Map(), api: { ApplicationV2: class {} } }
  };
  let seed = 7;
  globalThis.CONFIG = { Dice: { randomUniform: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; } }, PF2E: { skills: { survival: { label: "Survival" }, nature: { label: "Nature" } } } };
  globalThis.CONST = undefined;
  globalThis.Actor = { create: async data => { const a = makeActor(data); game.actors.push(a); return a; } };
  globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}), getWhisperRecipients: () => [{ id: "gm1" }] };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.socketlib = undefined;

  const table = makeScene("The Table");
  game.scenes.push(table);
  const scene = makeScene("Expedition Test");
  if (withScene) game.scenes.push(scene);
  canvasRef.scene = table;
  if (testCharacter) {
    const original = await Actor.create({ name: testCharacter, type: "character", ownership: { default: 0, "u-test": 3 } });
    testUser.character = original;
  }

  if (!importedMain) { await quietly(() => import("../scripts/main.js")); importedMain = true; }
  await quietly(async () => {
    for (const fn of [...(listeners.init ?? [])]) await fn();
    for (const fn of [...(listeners.ready ?? [])]) await fn();
  });
  const api = game.modules.get(M).api;
  api.definitions = registry; api.resolvedOutputs = new Map(); api.contexts = new Map();
  return { api, gm, testUser, scene, table, values };
}

/** Wrap api methods so a test can see which calls the block made, with their arguments. */
function spy(api, paths, calls) {
  for (const path of paths) {
    const parts = path.split(".");
    const owner = parts.slice(0, -1).reduce((o, k) => o[k], api);
    const name = parts.at(-1);
    const original = owner[name];
    owner[name] = async (...args) => {
      const result = await original(...args);
      calls.push({ path, args, result });
      return result;
    };
  }
}

const SEQUENCE = ["downtime.start", "downtime.addLate", "tagScene", "placeAnchors", "queue.submit", "queue.resolve", "searchArea", "clearMap", "clearAnchors", "untagScene", "downtime.end"];
const MUTATING = [...SEQUENCE];

// The happy path ------------------------------------------------------------------------------------------------------------
test("SETUP creates the two characters, puts a token on the scene, and makes Gate Hero Test's character (idempotent)", async () => {
  const { scene, testUser } = await boot();
  const first = await run(SETUP);
  assert.deepEqual(first, { hero: "Gate Hero", away: "Gate Absent", heroTokenOnScene: true, testUsersCharacter: "Gate Hero" });
  const hero = game.actors.getName("Gate Hero");
  assert.deepEqual(hero.ownership, { default: 0, "u-test": 3 });
  assert.equal(scene.tokens.length, 1);
  assert.equal(testUser.flags.checkOriginalCharacter, "none");
  const second = await run(SETUP);
  assert.deepEqual(second, first);
  assert.equal(game.actors.filter(a => a.name === "Gate Hero").length, 1, "no duplicates");
  assert.equal(scene.tokens.length, 1);
});

test("SETUP says what is missing instead of half-creating things", async () => {
  await boot({ withScene: false });
  await assert.rejects(run(SETUP), /Need the scene "Expedition Test" and the user "Test" \(scene found: false, user found: true\)/);
  assert.equal(game.actors.length, 0, "nothing was created");
});

test("CHECK runs every call in order with the real argument shapes, ends clean, and reports no deprecations", async () => {
  const { api, scene, table, values } = await boot();
  await run(SETUP);
  const calls = [];
  spy(api, MUTATING, calls);
  const result = await run(CHECK);
  assert.deepEqual(result, { deprecations: "no deprecation warnings", stoppedAt: "ran every step", error: null, cleanupProblems: [] });
  assert.deepEqual(calls.slice(0, SEQUENCE.length).map(c => c.path), SEQUENCE);
  assert.deepEqual(calls.slice(SEQUENCE.length).map(c => c.path), ["clearMap", "clearAnchors"], "the finally block only re-runs the idempotent scene clears");

  const hero = game.actors.getName("Gate Hero"), away = game.actors.getName("Gate Absent");
  const by = path => calls.find(c => c.path === path);
  assert.deepEqual(by("downtime.start").args, [{ days: 4, actorIds: [hero.id] }], "actorIds are ids");
  assert.deepEqual(by("downtime.addLate").args, [away.id]);
  assert.deepEqual(by("tagScene").args, [scene, "oak-wood"]);
  assert.deepEqual(by("placeAnchors").args, [6, { scene }]);
  assert.equal(by("placeAnchors").result.length, 6);
  assert.deepEqual(by("queue.submit").args.slice(0, 2), [hero, "explore"]);
  assert.deepEqual(by("queue.submit").args[2], { region: "oak-wood", skill: "survival", forceCombat: true });
  assert.equal(by("queue.submit").args[3], 2);
  assert.deepEqual(by("queue.resolve").args[0], hero);
  assert.equal(by("queue.resolve").args[1], by("queue.submit").result.id, "it resolves ONLY the action it queued");
  assert.deepEqual(by("queue.resolve").args[2], { degree: "success", chat: false });
  assert.equal(by("queue.resolve").result.status, "resolved");
  assert.equal(by("searchArea").args[0], hero);
  assert.match(by("searchArea").result.message, /^You search the area\./);
  assert.ok(by("clearMap").result.removed >= 4, "the expedition really placed nodes before clearMap removed them");
  assert.equal(by("clearAnchors").args[1].confirm, true);
  assert.equal(by("clearAnchors").result, 6);
  assert.deepEqual(by("downtime.end").args, [{ force: true }]);
  assert.deepEqual(by("downtime.end").result, { ended: true, rejected: 0, expired: { [hero.id]: 2, [away.id]: 4 } });

  // The world is back as it was.
  assert.equal(scene.tokens.filter(t => t.getFlag(M, "node")).length, 0);
  assert.equal(scene.getFlag(M, "sceneTags"), undefined);
  assert.equal(api.downtime.isOpen(), false);
  assert.deepEqual([hero, away].map(a => a.getFlag(M, "downtimeDays") ?? 0), [0, 0]);
  assert.equal(api.queue.list().length, 0);
  assert.equal(canvasRef.scene, table, "the scene the GM was viewing is restored");
  assert.deepEqual(api.audit.scan(), []);
  assert.equal(globalThis.console.warn.name !== "", true);
  void values;
});

test("CHECK can be run twice in a row", async () => {
  await boot();
  await run(SETUP);
  const a = await run(CHECK);
  const b = await run(CHECK);
  assert.deepEqual([a.error, b.error, a.deprecations, b.deprecations], [null, null, "no deprecation warnings", "no deprecation warnings"]);
});

test("CHECK reports deprecation warnings, and puts console.warn back", async () => {
  const { api } = await boot();
  await run(SETUP);
  const realClearMap = api.clearMap;
  let warned = false;
  api.clearMap = async scene => { if (!warned) { warned = true; console.warn("Deprecated since Version 14, removal in 16: something old"); console.warn("unrelated warning"); } return realClearMap(scene); };
  const before = console.warn;
  const result = await run(CHECK);
  assert.deepEqual(result.deprecations, ["Deprecated since Version 14, removal in 16: something old"]);
  assert.equal(result.error, null);
  assert.equal(console.warn, before, "console.warn is restored");
});

// Failure: it says where it stopped, and still cleans up ---------------------------------------------------------------------
for (const failing of ["downtime.addLate", "placeAnchors", "queue.submit", "searchArea", "clearMap"]) {
  test(`CHECK stops at ${failing}, names the step, and STILL cleans up what it created`, async () => {
    const { api, scene, table } = await boot();
    await run(SETUP);
    const before = console.warn;
    const path = failing.split(".");
    const owner = path.slice(0, -1).reduce((o, k) => o[k], api);
    const name = path.at(-1);
    const original = owner[name];
    let first = true;
    owner[name] = async (...args) => { if (first) { first = false; throw new Error(`boom in ${failing}`); } return original(...args); };
    const result = await run(CHECK);
    assert.equal(result.stoppedAt, failing === "queue.submit" ? "queue.submit" : failing);
    assert.equal(result.error, `boom in ${failing}`);
    assert.deepEqual(result.cleanupProblems, [], "cleanup had no problems");
    assert.equal(api.downtime.isOpen(), false, "downtime is closed");
    assert.equal(scene.tokens.filter(t => t.getFlag(M, "node")).length, 0, "no anchors or nodes left");
    assert.equal(scene.getFlag(M, "sceneTags"), undefined, "the tag is gone");
    assert.equal(canvasRef.scene, table, "the viewed scene is restored");
    assert.equal(console.warn, before, "console.warn is restored");
    assert.equal(api.queue.list().length, 0);
  });
}

test("CHECK reports an explore action that does not resolve instead of pretending it worked", async () => {
  const { api } = await boot();
  await run(SETUP);
  const original = api.queue.resolve;
  api.queue.resolve = async (...args) => { const r = await original(...args); return { ...r, status: "error", message: "pretend failure" }; };
  const result = await run(CHECK);
  assert.equal(result.stoppedAt, "queue.resolve");
  assert.match(result.error, /the explore action did not resolve: error: pretend failure/);
});

// Safety: it refuses to touch anything that is not its own -----------------------------------------------------------------
test("CHECK refuses to start if downtime is already open, and does not touch that period", async () => {
  const { api, scene } = await boot();
  await run(SETUP);
  await api.downtime.start({ days: 3, actorIds: [game.actors.getName("Gate Hero").id] });
  const before = JSON.stringify(api.downtime.state());
  const result = await run(CHECK);
  assert.equal(result.stoppedAt, "precheck");
  assert.match(result.error, /downtime is already open; end it first/);
  assert.equal(JSON.stringify(api.downtime.state()), before);
  assert.equal(api.downtime.isOpen(), true, "the existing period was NOT ended");
  assert.equal(scene.tokens.filter(t => t.getFlag(M, "node")).length, 0);
});

test("CHECK refuses to start while anything is queued, and leaves that queue alone", async () => {
  const { api } = await boot();
  await run(SETUP);
  const other = await Actor.create({ name: "Real Character", type: "character", ownership: { default: 0 } });
  await other.update({ [`flags.${M}.pendingActions`]: [{ id: "q1", type: "commission", params: { step: "cancel", id: "x" }, daysReserved: 0, submittedAt: 1 }] });
  const result = await run(CHECK);
  assert.equal(result.stoppedAt, "precheck");
  assert.match(result.error, /the queue is not empty/);
  assert.equal(other.getFlag(M, "pendingActions").length, 1);
  assert.equal(api.downtime.isOpen(), false);
});

test("CHECK refuses to start while another character holds downtime days (ending downtime would erase them)", async () => {
  await boot();
  await run(SETUP);
  const other = await Actor.create({ name: "Real Character", type: "character", ownership: { default: 0 } });
  await other.update({ [`flags.${M}.downtimeDays`]: 5 });
  const result = await run(CHECK);
  assert.match(result.error, /these characters hold downtime days that ending downtime would erase: Real Character/);
  assert.equal(other.getFlag(M, "downtimeDays"), 5, "their days are untouched");
});

test("CHECK refuses a scene that already has anchors or nodes, and does NOT delete them", async () => {
  const { api, scene } = await boot();
  await run(SETUP);
  await api.placeAnchors(3, { scene });
  const result = await run(CHECK);
  assert.equal(result.stoppedAt, "precheck");
  assert.match(result.error, /"Expedition Test" already has anchors or nodes/);
  assert.equal(api.listAnchors(scene).length, 3, "the anchors are still there");
  assert.equal(api.downtime.isOpen(), false);
});

test("CHECK without SETUP says to run SETUP", async () => {
  await boot();
  const result = await run(CHECK);
  assert.equal(result.stoppedAt, "precheck");
  assert.match(result.error, /run the SETUP block first/);
});

test("the CHECK block never uses resolveAll (that would resolve other people's queued actions)", () => {
  assert.doesNotMatch(CHECK, /resolveAll/);
  assert.match(CHECK, /queue\.resolve\(hero, action\.id/);
});

// Cleanup -----------------------------------------------------------------------------------------------------------------------
test("CLEANUP deletes the characters, their ledger entries and events, the downtime setting, and restores Test's character", async () => {
  const { api, testUser, values, scene } = await boot({ testCharacter: "Aria" });
  await run(SETUP);
  assert.equal(testUser.character.name, "Gate Hero");
  await run(CHECK);
  await api.grantDays(game.actors.getName("Gate Hero"), 1); // leaves a ledger entry and an override event behind
  const result = await run(CLEANUP);
  assert.equal(result.charactersLeft, 0);
  assert.equal(result.testUsersCharacter, "Aria", "Test's original character is back");
  assert.deepEqual(result.audit, []);
  assert.equal(result.downtime, "reset");
  assert.deepEqual(values.downtime, {});
  assert.equal(testUser.flags.checkOriginalCharacter, undefined);
  assert.deepEqual(Object.keys(values.auditLedger).filter(k => k !== "_events"), [], "no actor entries left");
  assert.ok(!(values.auditLedger._events?.history ?? []).some(h => /Gate Hero|Gate Absent/.test(h.text)), "no world events that name them");
  assert.equal(scene.tokens.length, 0, "the hero's token is gone too");
  assert.equal(game.actors.filter(a => /^Gate /.test(a.name)).length, 0);
  assert.ok(game.actors.getName("Aria"), "Test's own character is untouched");
});

test("CLEANUP with no assigned character before leaves Test with none, and running it twice is harmless", async () => {
  const { testUser } = await boot();
  await run(SETUP);
  const first = await run(CLEANUP);
  assert.equal(first.testUsersCharacter, null);
  const second = await run(CLEANUP);
  assert.deepEqual([second.charactersLeft, second.testUsersCharacter, second.audit], [0, null, []]);
  assert.equal(testUser.character, null);
});

test("CLEANUP leaves a REAL open downtime period alone", async () => {
  const { api, values } = await boot();
  await run(SETUP);
  const real = await Actor.create({ name: "Real Character", type: "character", ownership: { default: 0 } });
  await api.downtime.start({ days: 5, actorIds: [real.id] });
  const before = JSON.stringify(values.downtime);
  const result = await run(CLEANUP);
  assert.equal(result.downtime, "a real downtime period is open: left alone");
  assert.equal(JSON.stringify(values.downtime), before);
  assert.equal(real.getFlag(M, "downtimeDays"), 5, "the real character keeps their days");
});

test("the three blocks are labelled [GM] and the doc says where each one runs", () => {
  for (const label of ["Setup", "Check", "Cleanup"]) assert.match(doc, new RegExp(`## \\[GM\\] ${label}`));
  assert.match(SETUP, /^\/\/ \[GM\] SETUP/);
  assert.match(CHECK, /^\/\/ \[GM\] CHECK/);
  assert.match(CLEANUP, /^\/\/ \[GM\] CLEANUP/);
});
