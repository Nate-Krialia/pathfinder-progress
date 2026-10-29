/**
 * Runs the REAL exploration store, queue and audit against fake Foundry objects: scenes with
 * tokens, a node actor, chat, settings. Update semantics (dotted paths, "-=" deletes, object
 * merging) follow Foundry's, so the revert logic is really exercised. Every write counts as an
 * "operation" so a failure can be injected at each one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as exploration from "../scripts/exploration/store.js";
import * as gathering from "../scripts/gathering/store.js";
import * as queue from "../scripts/queue/store.js";
import * as audit from "../scripts/audit/store.js";
import * as research from "../scripts/research/store.js";
import { _resetSocketForTests, ensureSocket, installSocketHooks, socketStatus } from "../scripts/socket.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { asPage, openDowntime, seedRecords } from "./helpers.js";

const M = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const api = { definitions: registry, contexts: new Map(), uncraftable: new Set(), resolvedOutputs: new Map() };
const clone = v => (v === undefined ? undefined : structuredClone(v));
const roll = (degreeOfSuccess, total, natural) => ({ options: { degreeOfSuccess }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Foundry-style update: dotted paths, "-=key" deletes, plain objects merge.
function applyPath(target, path, value) {
  const parts = path.split(".");
  let o = target;
  for (const part of parts.slice(0, -1)) o = (o[part] ??= {});
  const last = parts.at(-1);
  if (last.startsWith("-=")) { delete o[last.slice(2)]; return; }
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  if (isObj(value) && isObj(o[last])) for (const [k, v] of Object.entries(value)) applyPath(o[last], k, v);
  else o[last] = clone(value);
}
const applyFlat = (target, data) => { for (const [k, v] of Object.entries(data)) if (k !== "_id") applyPath(target, k, v); };

// Fault injection: every world write is an operation; env.failAt makes the Nth one throw.
const env = { ops: 0, failAt: null, labels: [] };
function tick(label) {
  env.ops++;
  env.labels.push(label);
  if (env.failAt === env.ops) throw new Error(`injected failure at operation ${env.ops} (${label})`);
}

const collection = (items = []) => {
  const list = items;
  list.get = id => list.find(i => i.id === id);
  list.getName = name => list.find(i => i.name === name);
  return list;
};

let nextId = 0;
const newId = prefix => `${prefix}${++nextId}`;

function fakeToken(data) {
  const token = {
    documentName: "Token", id: newId("tok"), name: data.name, x: data.x, y: data.y, hidden: !!data.hidden,
    texture: { src: data.texture?.src }, flags: clone(data.flags ?? {}), actorId: data.actorId, actorLink: data.actorLink,
    get uuid() { return `Scene.s.Token.${token.id}`; },
    getFlag: (scope, key) => clone(token.flags[scope]?.[key]),
    async setFlag(scope, key, value) { applyPath(token.flags, `${scope}.${key}`, value); },
    async unsetFlag(scope, key) { delete token.flags[scope]?.[key]; },
    async update(data) { tick("token.update"); applyFlat(token, data); }
  };
  return token;
}

function fakeScene(name, { width = 1000, height = 1000, grid = 100 } = {}) {
  const scene = {
    id: newId("scene"), name, flags: {}, tokens: collection(), grid: { size: grid },
    dimensions: { sceneX: 0, sceneY: 0, sceneWidth: width, sceneHeight: height }, launches: 0,
    async activate() { scene.launches++; }, async view() { scene.launches++; }, async pull() { scene.launches++; },
    getFlag: (scope, key) => clone(scene.flags[scope]?.[key]),
    async setFlag(scope, key, value) { (scene.flags[scope] ??= {})[key] = clone(value); },
    async unsetFlag(scope, key) { delete scene.flags[scope]?.[key]; },
    async createEmbeddedDocuments(type, datas) { tick("createEmbeddedDocuments"); return datas.map(d => { const t = fakeToken(d); scene.tokens.push(t); return t; }); },
    async updateEmbeddedDocuments(type, updates) { tick("updateEmbeddedDocuments"); for (const u of updates) applyFlat(scene.tokens.get(u._id), u); },
    async deleteEmbeddedDocuments(type, ids) { tick("deleteEmbeddedDocuments"); for (const id of ids) { const i = scene.tokens.findIndex(t => t.id === id); if (i >= 0) scene.tokens.splice(i, 1); } }
  };
  return scene;
}

function fakeActor(id, name, mods = { survival: 8, nature: 8 }) {
  const flags = {};
  const actor = {
    id, name, flags, type: "character", isOwner: true, rolls: [], perceptionRolls: [], failUpdate: false, owners: ["u-player"],
    testUserPermission: (user, level) => actor.owners.includes(user.id),
    perception: { check: { roll: async () => actor.perceptionRolls.shift() } },
    getFlag: (scope, key) => clone(flags[scope === M ? key : `${scope}.${key}`]),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(data) {
      tick("actor.update");
      if (actor.failUpdate) throw new Error("actor update failed");
      for (const [path, value] of Object.entries(data)) flags[path.replace(`flags.${M}.`, "")] = clone(value);
    },
    skills: Object.fromEntries(Object.entries(mods).map(([slug, mod]) => [slug, { mod, check: { roll: async () => actor.rolls.shift() } }]))
  };
  return actor;
}

// Set by a test to make the fake Actor.create rewrite fields the way Foundry/PF2e can: (data) => data.
let createRewrite = null;

function install({ isGM = true, actors = [], scenes = [], seed = 1 } = {}) {
  createRewrite = null;
  env.ops = 0; env.failAt = null; env.labels = [];
  const values = { auditLedger: {}, nodeActorId: "", explorationState: {} };
  const actorList = collection([...actors]);
  const sceneList = collection([...scenes]);
  const notices = { info: [], warn: [], error: [] };
  const chat = [];
  globalThis.game = {
    user: { isGM, id: isGM ? "gm1" : "u-player" }, i18n: { localize: t => t }, actors: actorList, scenes: sceneList,
    users: collection([{ id: "gm1", isGM: true, active: true, name: "GM" }, { id: "u-player", isGM: false, active: true, name: "Player" }, { id: "u-other", isGM: false, active: true, name: "Other" }]),
    settings: { get: (s, k) => (k === "downtime" ? openDowntime(actorList.map(a => a.id)) : clone(values[k])), set: async (s, k, v) => { tick(`settings.set ${k}`); values[k] = clone(v); } }
  };
  globalThis.foundry = { utils: { randomID: () => newId("id") } };
  globalThis.CONFIG = { Dice: { randomUniform: mulberry(seed) }, PF2E: { skills: { survival: { label: "Survival" }, nature: { label: "Nature" } } } };
  globalThis.CONST = undefined;
  globalThis.Actor = {
    async create(data) {
      const created = {
        ...clone(createRewrite ? createRewrite(clone(data)) : data), id: newId("actor"), flags: clone(data.flags ?? {}), isOwner: true,
        getFlag: (scope, key) => created.flags[scope]?.[key],
        failUpdate: false,
        testUserPermission: () => false,
        async update(change) { if (created.failUpdate) throw new Error("update refused"); applyFlat(created, change); },
        async getTokenDocument(tokenData) { return { toObject: () => ({ actorId: created.id, ...clone(created.prototypeToken), ...clone(tokenData) }) }; }
      };
      actorList.push(created);
      return created;
    }
  };
  globalThis.ChatMessage = {
    create: async m => { chat.push(m); },
    getSpeaker: () => ({}),
    getWhisperRecipients: () => [{ id: "gm1" }]
  };
  globalThis.ui = { notifications: { info: m => notices.info.push(m), warn: m => notices.warn.push(m), error: m => notices.error.push(m) } };
  globalThis.canvas = { scene: sceneList[0] };
  queue.bind(api);
  return { values, notices, chat, actorList, sceneList };
}

/** Put a character token on a scene (a search only counts characters standing on the scene). */
const standOn = (scene, actor) => scene.createEmbeddedDocuments("Token", [{ name: actor.name, actorId: actor.id, x: 0, y: 0 }]);

async function world({ anchors = 6, days = 6, seed = 1 } = {}) {
  const scene = fakeScene("Whispering Grove");
  const bb = fakeActor("a1", "Bottlespeaker");
  const env = install({ actors: [bb], scenes: [scene], seed });
  await research.grantDays(bb, days);
  await exploration.tagScene(scene, "oak-wood");
  if (anchors) await exploration.placeAnchors(api, anchors, { scene });
  return { scene, bb, env };
}

const pending = a => a.getFlag(M, "pendingActions") ?? [];
const submitExplore = (actor, days = 2, extra = {}) => queue.submit(actor, "explore", { region: "oak-wood", skill: "survival", ...extra }, days);
const nodeTokens = scene => scene.tokens.filter(t => t.getFlag(M, "node"));
const byState = (scene, state) => nodeTokens(scene).filter(t => t.getFlag(M, "node").state === state);
const anchorsOf = scene => nodeTokens(scene).filter(t => t.getFlag(M, "node").state === "anchor");
const explored = scene => nodeTokens(scene).filter(t => t.getFlag(M, "node").source === "explored");
const state = scene => exploration.sceneState(scene.id);
/** A rng whose FIRST value is `first` (the encounter roll), then ordinary numbers. */
const rngStartingWith = (first, seed = 3) => { const base = mulberry(seed); let used = false; return () => (used ? base() : (used = true, first)); };
/** Put a hidden explored node on a scene without running an expedition. */
async function hiddenNode(scene, { nodeType = "herb", tier = 1, dc = 14, x = 500, y = 500 } = {}) {
  const actor = await exploration.ensureNodeActor();
  const type = registry.nodeType.get(nodeType);
  const [token] = await scene.createEmbeddedDocuments("Token", [{
    name: type.name, actorId: actor.id, x, y, hidden: true,
    flags: { [M]: { node: { source: "explored", state: "active", nodeType, tier, charges: type.charges, discoveredBy: [], region: "oak-wood", perceptionDC: dc, revealed: false } } }
  }]);
  return token;
}

// Resource Node actor --------------------------------------------------------------------------------------
test("ensureNodeActor creates a flagged loot actor with safe defaults, reuses it, and finds it by flag if the setting is lost", async () => {
  const { env } = await world({ anchors: 0 });
  const actor = await exploration.ensureNodeActor();
  assert.equal(actor.type, "loot");
  assert.equal(actor.flags[M].nodeActor, true);
  assert.equal(actor.ownership.default, 0);
  assert.deepEqual([actor.prototypeToken.actorLink, actor.prototypeToken.disposition, actor.prototypeToken.displayName], [false, 0, 30]);
  assert.equal(env.values.nodeActorId, actor.id);
  assert.match(env.notices.info.at(-1), /created the "Resource Node" actor/);
  assert.equal(await exploration.ensureNodeActor(), actor, "reused");
  assert.equal(env.actorList.filter(a => a.type === "loot").length, 1);
  env.values.nodeActorId = "";
  assert.equal(await exploration.ensureNodeActor(), actor, "found by flag, not by name");
  assert.equal(env.values.nodeActorId, actor.id);
});

test("if the node actor is deleted it is recreated with a WARNING notice; a renamed one is still found", async () => {
  const { env } = await world({ anchors: 0 });
  const first = await exploration.ensureNodeActor();
  first.name = "Totally Renamed";
  assert.equal(await exploration.ensureNodeActor(), first);
  env.actorList.splice(env.actorList.indexOf(first), 1);
  const second = await exploration.ensureNodeActor();
  assert.notEqual(second.id, first.id);
  assert.match(env.notices.warn.at(-1), /was deleted, so it was created again/);
  assert.equal(env.values.nodeActorId, second.id);
});

test("if Foundry/PF2e rewrite ownership and actorLink at creation, ensureNodeActor corrects them and says so", async () => {
  const { env } = await world({ anchors: 0 });
  createRewrite = data => ({ ...data, ownership: { default: 1, gm1: 3 }, prototypeToken: { ...data.prototypeToken, actorLink: true } });
  const actor = await exploration.ensureNodeActor();
  assert.equal(actor.ownership.default, 0);
  assert.equal(actor.ownership.gm1, 3, "the GM's own ownership is left alone");
  assert.equal(actor.prototypeToken.actorLink, false);
  assert.equal(actor.prototypeToken.disposition, 0, "other defaults untouched");
  assert.ok(env.notices.info.some(m => /corrected the new "Resource Node" actor's defaults \(default ownership was 1; prototype token actorLink was true\)/.test(m)), env.notices.info.join(" | "));
  const again = await exploration.ensureNodeActor();
  assert.equal(again, actor);
  assert.equal(env.notices.info.filter(m => /corrected/.test(m)).length, 1, "reuse does not re-correct");
});

test("a recreated node actor gets the same correction, and an actor that already has the defaults is not touched", async () => {
  const { env } = await world({ anchors: 0 });
  const first = await exploration.ensureNodeActor();
  assert.equal(env.notices.info.filter(m => /corrected/.test(m)).length, 0, "nothing to correct when the defaults stuck");
  env.actorList.splice(env.actorList.indexOf(first), 1);
  createRewrite = data => ({ ...data, ownership: { default: 1 }, prototypeToken: { ...data.prototypeToken, actorLink: true } });
  const second = await exploration.ensureNodeActor();
  assert.deepEqual([second.ownership.default, second.prototypeToken.actorLink], [0, false]);
  assert.match(env.notices.warn.at(-1), /was deleted, so it was created again/);
});

test("if the correction itself does not stick, ensureNodeActor fails loudly instead of leaving an unsafe actor quietly", async () => {
  await world({ anchors: 0 });
  createRewrite = data => ({ ...data, ownership: { default: 1 } });
  const original = globalThis.Actor.create;
  globalThis.Actor.create = async data => { const a = await original(data); a.update = async () => {}; return a; };
  await assert.rejects(exploration.ensureNodeActor(), /could not set the "Resource Node" actor's safe defaults \(default ownership was 1\)/);
});

test("only a GM can ensure the node actor or place anything", async () => {
  const { scene } = await world({ anchors: 0 });
  globalThis.game.user.isGM = false;
  for (const call of [() => exploration.ensureNodeActor(), () => exploration.placeAnchors(api, 1, { scene }), () => exploration.tagScene(scene, "x"), () => exploration.clearMap(scene), () => exploration.resetSearches(scene), async () => exploration.listAnchors(scene), () => exploration.clearAnchors(scene, { confirm: true })]) {
    await assert.rejects(call(), /GM only/);
  }
});

// Tags, anchors, nodes ----------------------------------------------------------------------------------------
test("tagScene / scenesFor / untagScene", async () => {
  const { scene } = await world({ anchors: 3 });
  assert.deepEqual(exploration.scenesFor(api, "oak-wood"), [{ id: scene.id, name: "Whispering Grove", freeAnchors: 3, totalAnchors: 3, timesPrepared: 0 }]);
  assert.deepEqual(exploration.scenesFor(api, "barren-ridge"), []);
  assert.deepEqual(await exploration.tagScene(scene, "oak-wood"), ["oak-wood"], "no duplicates");
  assert.deepEqual(await exploration.tagScene("Whispering Grove", "barren-ridge"), ["oak-wood", "barren-ridge"], "by name");
  assert.deepEqual(await exploration.untagScene(scene, "oak-wood"), ["barren-ridge"]);
  assert.deepEqual(exploration.scenesFor(api, "oak-wood"), []);
  assert.throws(() => exploration.scenesFor(api, "ghost"), /unknown region "ghost"/);
  await assert.rejects(exploration.tagScene(scene, ""), /give the tag as text/);
});

test("placeAnchors makes hidden, unlinked, default-looking anchors from the node actor, on distinct squares", async () => {
  const { scene } = await world({ anchors: 5 });
  assert.equal(scene.tokens.length, 5);
  const keys = new Set();
  for (const t of scene.tokens) {
    assert.deepEqual([t.name, t.hidden, t.actorLink, t.texture.src], ["Anchor", true, false, "icons/svg/mystery-man.svg"]);
    assert.equal(t.getFlag(M, "node").state, "anchor");
    assert.equal((t.x % 100) + (t.y % 100), 0, "snapped to the grid");
    keys.add(`${t.x},${t.y}`);
  }
  assert.equal(keys.size, 5);
  assert.equal(exploration.listAnchors(scene).length, 5);
  await assert.rejects(exploration.placeAnchors(api, 0, { scene }), /whole number of at least 1/);
});

test("placeNode uses the nodeType's own image (or the default); a hand-placed node counts as found", async () => {
  const { scene } = await world({ anchors: 0 });
  const ore = await exploration.placeNode(api, scene, { nodeType: "ore", tier: 1 });
  const herb = await exploration.placeNode(api, scene, { nodeType: "herb", tier: 1, x: 300, y: 300 });
  assert.equal(ore.texture.src, registry.nodeType.get("ore").img);
  assert.equal(herb.texture.src, "icons/svg/item-bag.svg");
  assert.deepEqual([ore.name, herb.name, herb.x, herb.hidden], ["Ore Vein", "Herb Patch", 300, false]);
  const info = gathering.nodeInfo(api, ore);
  assert.equal(info.ok, true);
  assert.equal(info.node.nodeType, "ore");
  await assert.rejects(exploration.placeNode(api, scene, { nodeType: "ore", tier: 5 }), /placeNode:/);
  await assert.rejects(exploration.placeNode(api, scene, { nodeType: "geode", tier: 1 }), /unknown nodeType/);
});

test("listAnchors { all } shows every node; clearAnchors needs confirm and only deletes anchors", async () => {
  const { scene } = await world({ anchors: 2 });
  await exploration.placeNode(api, scene, { nodeType: "herb", tier: 1 });
  assert.equal(exploration.listAnchors(scene).length, 2);
  assert.equal(exploration.listAnchors(scene, { all: true }).length, 3);
  await assert.rejects(exploration.clearAnchors(scene), /would delete 2 anchor token\(s\).*confirm: true/);
  assert.equal(scene.tokens.length, 3);
  assert.equal(await exploration.clearAnchors(scene, { confirm: true }), 2);
  assert.deepEqual(scene.tokens.map(t => t.name), ["Herb Patch"]);
});

// Odds, definitions (GM only: players are never shown odds or results) ------------------------------------------------
test("previewExplore, simulateExplore, checkDefinition and scenesFor are GM-only: a player is never shown odds", async () => {
  const { bb } = await world({ anchors: 4 });
  globalThis.game.user.isGM = false;
  for (const call of [
    async () => exploration.previewExplore(api, bb, "oak-wood"), async () => exploration.simulateExplore(api, { region: "oak-wood", degree: "success" }),
    async () => exploration.checkDefinition(api, registry.region.get("oak-wood")), async () => exploration.scenesFor(api, "oak-wood")
  ]) await assert.rejects(call(), /GM only/);
});

test("previewExplore (GM) shows odds per skill, the minimum days, the danger label with its hidden chance, and the scenes", async () => {
  const { bb } = await world({ anchors: 4 });
  const preview = exploration.previewExplore(api, bb, "oak-wood");
  assert.deepEqual(preview.region, { id: "oak-wood", name: "Oak Wood", dc: 18, minDays: 2, danger: "moderate", encounterChance: 0.35 });
  assert.deepEqual(preview.perSkill.map(s => [s.skill, s.modifier]), [["survival", 8], ["nature", 8]]);
  assert.ok(preview.perSkill[0].expectedAnchors > 1 && preview.perSkill[0].chances.success > 0);
  assert.equal(preview.scenes[0].freeAnchors, 4);
  assert.match(exploration.previewExplore(api, bb, "oak-wood", "arcana").perSkill[0].problem, /not allowed here/);
  assert.throws(() => exploration.previewExplore(api, bb, "ghost"), /unknown region/);
});

test("checkDefinition reports problems in a candidate region without loading it", () => {
  install();
  const good = registry.region.get("oak-wood");
  assert.deepEqual(exploration.checkDefinition(api, { ...good, id: "copy-wood" }), []);
  const bad = exploration.checkDefinition(api, { ...good, id: "bad", spawnTable: [{ nodeType: "geode", tier: 1, weight: 1 }, { nodeType: "herb", tier: 3, weight: 1 }] });
  assert.equal(bad.length, 2);
  assert.match(bad[0], /spawnTable\[0\]\.nodeType refers to unknown nodeType "geode"/);
  assert.match(bad[1], /spawnTable\[1\]\.tier nodeType "herb" has no tier-3 ladder/);
  assert.equal(api.definitions.region.has("bad"), false);
});

test("simulateExplore (GM): trips of several days scale the node count but not the encounter chance", () => {
  install({ seed: 5 });
  const one = exploration.simulateExplore(api, { region: "oak-wood", runs: 20_000, degree: "success", days: 1 });
  const five = exploration.simulateExplore(api, { region: "oak-wood", runs: 20_000, degree: "success", days: 5 });
  assert.ok(Math.abs(one.meanNodes - 3) < 0.05 && Math.abs(five.meanNodes - 15) < 0.15, `${one.meanNodes} / ${five.meanNodes}`);
  assert.ok(Math.abs(one.encounterRate - 0.35) < 0.015 && Math.abs(five.encounterRate - 0.35) < 0.015);
  assert.equal(exploration.simulateExplore(api, { region: "oak-wood", runs: 300, degree: "success", forceCombat: true }).encounterRate, 1);
  assert.throws(() => exploration.simulateExplore(api, { region: "ghost", degree: "success" }), /unknown region/);
});

// Submitting ------------------------------------------------------------------------------------------------------------
test("a PLAYER queues days of exploring with force combat; the days are reserved and the audit stays clean", async () => {
  const { bb } = await world({ anchors: 4 });
  globalThis.game.user.isGM = false;
  const action = await submitExplore(bb, 3, { forceCombat: true });
  assert.deepEqual([action.daysReserved, action.params.forceCombat, action.params.region], [3, true, "oak-wood"]);
  assert.equal(bb.getFlag(M, "downtimeDays"), 3);
  await assert.rejects(submitExplore(bb, 1), /takes at least 2 day\(s\)/);
  await assert.rejects(submitExplore(bb, 11), /at most 10 days/);
  await assert.rejects(submitExplore(bb, 2, { forceCombat: "maybe" }), /true or false/);
  globalThis.game.user.isGM = true;
  assert.deepEqual(audit.scan(), []);
  assert.equal(bb.getFlag(M, "downtimeDays"), 3);
});

test("a GM submit is refused when no scene is tagged, and when the tagged scene has no anchors at all", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  await assert.rejects(queue.submit(bb, "explore", { region: "barren-ridge", skill: "survival" }, 1), /no scene is tagged "barren-ridge"/);
  await assert.rejects(submitExplore(bb), /have no anchors/);
  assert.deepEqual([bb.getFlag(M, "downtimeDays"), pending(bb).length], [6, 0]);
  await exploration.placeAnchor(api, scene);
  await assert.doesNotReject(submitExplore(bb));
});

test("the review row describes the region, the odds for the trip, force combat and the scene pool (GM view)", async () => {
  const { bb } = await world({ anchors: 4 });
  await submitExplore(bb, 3, { forceCombat: true });
  const [row] = queue.list();
  assert.equal(row.label, "Explore: Oak Wood");
  assert.match(row.detail, /survival \+8 vs DC 18: crit 5% \/ success 5\d% .*expect ~\d+\.\d nodes; 3 day\(s\); FORCE COMBAT; 1 tagged scene\(s\), 4 free anchor\(s\) of 4/);
  assert.equal(row.problem, null);
});

// Resolving ----------------------------------------------------------------------------------------------------------------
test("resolving PREPARES the scene: HIDDEN nodes appear on new tokens at anchor positions, the anchors stay and are marked occupied, nothing is launched", async () => {
  const { bb, scene } = await world({ anchors: 20 });
  const anchorPositions = new Set(anchorsOf(scene).map(t => `${t.x},${t.y}`));
  const anchorIds = anchorsOf(scene).map(t => t.id);
  await submitExplore(bb, 3);
  const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(results[0].status, "resolved");
  assert.match(results[0].message, /prepared "Whispering Grove" \(not launched\): \d+ hidden node\(s\) placed, (no )?encounter/);

  const nodes = explored(scene);
  assert.ok(nodes.length >= 6 && nodes.length <= 12, "three days of successes: 2-4 nodes each");
  for (const t of nodes) {
    const record = t.getFlag(M, "node");
    const type = registry.nodeType.get(record.nodeType);
    assert.deepEqual([t.hidden, t.name, t.texture.src], [true, type.name, type.img ?? "icons/svg/item-bag.svg"]);
    assert.deepEqual([record.source, record.region, record.revealed, record.perceptionDC], ["explored", "oak-wood", false, 14]);
    assert.ok(anchorPositions.has(`${t.x},${t.y}`), "a node stands where an anchor is");
    assert.equal(scene.tokens.get(record.anchorId).getFlag(M, "node").occupiedBy, t.id, "the anchor knows which node stands on it");
    assert.equal(gathering.nodeInfo(api, t).ok, true);
  }
  assert.equal(new Set(nodes.map(t => t.getFlag(M, "node").anchorId)).size, nodes.length, "one node per anchor");
  assert.deepEqual(anchorsOf(scene).map(t => t.id).sort(), anchorIds.sort(), "every anchor is still there");
  assert.equal(anchorsOf(scene).filter(t => t.getFlag(M, "node").occupiedBy).length, nodes.length);
  assert.equal(scene.launches, 0, "never activated, viewed or pulled");
  assert.equal(bb.getFlag(M, "downtimeDays"), 3, "3 of 6 days spent");
  assert.deepEqual(audit.scan(), []);
});

test("NOTHING LEAKS to players: no public chat, no scene flag, no result on the player's sheet", async () => {
  const { bb, scene, env } = await world({ anchors: 10 });
  await submitExplore(bb, 2, { forceCombat: true });
  await queue.resolveAll(api, { degree: "criticalSuccess" });
  assert.ok(env.chat.length >= 1);
  for (const message of env.chat) assert.deepEqual(message.whisper, ["gm1"], "every expedition message is whispered to the GM only");
  assert.deepEqual(Object.keys(scene.flags[M]), ["sceneTags"], "the scene's flags hold only its tag");
  assert.deepEqual(Object.keys(bb.flags).sort(), ["downtimeDays", "pendingActions"], "the player's sheet holds no results");
  assert.deepEqual(bb.getFlag(M, "pendingActions"), []);
  const everything = JSON.stringify([env.chat.filter(m => !m.whisper), scene.flags, bb.flags]);
  assert.doesNotMatch(everything, /encounter|Perception DC|natural|hidden node/i);
  globalThis.game.user.isGM = false;
  assert.throws(() => exploration.previewExplore(api, bb, "oak-wood"), /GM only/);
});

test("the encounter is rolled ONCE per expedition: forced is certain; otherwise the region's danger decides; a long trip does not roll again", async () => {
  const { bb, scene } = await world({ anchors: 40, days: 30 });
  const run = async (first, extra = {}, days = 2) => {
    await exploration.clearMap(scene);
    await submitExplore(bb, days, extra);
    globalThis.CONFIG.Dice.randomUniform = rngStartingWith(first);
    await queue.resolveAll(api, { degree: "criticalFailure", chat: false });
    return state(scene).encounter;
  };
  assert.deepEqual(await run(0.9, { forceCombat: true }), { active: true, forced: true, at: state(scene).encounter.at, by: "Bottlespeaker" });
  assert.equal((await run(0.1)).active, true, "moderate danger (35%): a low roll is an encounter");
  assert.equal((await run(0.9)).active, false);
  assert.equal(state(scene).prepared.length, 1);
  // 6 days, first roll 0.9 (no encounter), every later roll 0: a second encounter roll would have fired.
  await exploration.clearMap(scene);
  await submitExplore(bb, 6);
  let calls = 0;
  const base = mulberry(9);
  globalThis.CONFIG.Dice.randomUniform = () => (calls++ === 0 ? 0.9 : 0.0 + base() * 0);
  await queue.resolveAll(api, { degree: "criticalFailure", chat: false });
  assert.equal(state(scene).encounter.active, false, "one roll for the whole trip");
});

test("each day is its own hidden roll: three days, three checks, and the GM whisper lists them", async () => {
  const { bb, env } = await world({ anchors: 20 });
  await submitExplore(bb, 3);
  bb.rolls.push(roll(2, 22, 14), roll(1, 10, 2), roll(3, 30, 20));
  const { results } = await queue.resolveAll(api);
  assert.equal(results[0].status, "resolved");
  assert.equal(bb.rolls.length, 0, "all three rolls were used");
  const gm = env.chat.at(-1).content;
  assert.match(gm, /day 1: natural 14, total 22 vs DC 18 = success; day 2: natural 2, total 10 vs DC 18 = failure; day 3: natural 20, total 30 vs DC 18 = critical success/);
  assert.match(gm, /GM only/);
  assert.match(gm, /Scene prepared, not launched/);
});

test("NO TAGGED SCENE is an error row that keeps its days; tagging a scene and Retry then works", async () => {
  const { bb } = await world();
  const scene2 = fakeScene("Barren Hills");
  globalThis.game.scenes.push(scene2);
  await exploration.placeAnchors(api, 6, { scene: scene2 });
  const action = { id: "e1", type: "explore", params: { region: "barren-ridge", skill: "survival", forceCombat: false }, daysReserved: 1, submittedAt: 1 };
  await bb.update({ [`flags.${M}.pendingActions`]: [action], [`flags.${M}.downtimeDays`]: 5 });
  const first = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(first.results[0].status, "error");
  assert.match(first.results[0].message, /no scene is tagged "barren-ridge"/);
  assert.deepEqual([pending(bb).length, bb.getFlag(M, "downtimeDays")], [1, 5], "still queued, days still reserved");
  await exploration.tagScene(scene2, "barren-ridge");
  const retry = await queue.resolveAction(api, bb, "e1", { degree: "success", chat: false });
  assert.equal(retry.status, "resolved");
  assert.deepEqual([pending(bb).length, explored(scene2).length > 0], [0, true]);
  assert.deepEqual(audit.scan(), []);
});

test("a tagged scene with no anchors AT ALL is an error row that names the scene", async () => {
  const { bb, scene } = await world({ anchors: 1 });
  await submitExplore(bb);
  await exploration.clearAnchors(scene, { confirm: true });
  const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /Whispering Grove\) have no anchors at all/);
  assert.equal(pending(bb).length, 1);
});

test("FEWER free anchors than nodes: only what fits is placed, the days are still spent, and the GM log says so", async () => {
  const { bb, scene, env } = await world({ anchors: 1 });
  await submitExplore(bb, 2);
  const { results } = await queue.resolveAll(api, { degree: "criticalSuccess" });
  assert.match(results[0].message, /1 hidden node\(s\) placed \(\d+ found, only 1 free anchor\(s\): \d+ not placed\)/);
  assert.equal(explored(scene).length, 1);
  assert.equal(bb.getFlag(M, "downtimeDays"), 4);
  assert.match(env.chat.at(-1).content, /were found but only 1 free anchor\(s\) were left, so \d+ were not placed/);
});

test("EVERY anchor already occupied: nothing is placed, the expedition still resolves and the GM is told", async () => {
  const { bb, scene, env } = await world({ anchors: 2 });
  await submitExplore(bb, 2);
  await queue.resolveAll(api, { degree: "criticalSuccess", chat: false });
  assert.equal(anchorsOf(scene).filter(t => !t.getFlag(M, "node").occupiedBy).length, 0);
  const before = explored(scene).length;
  await submitExplore(bb, 2);
  const { results } = await queue.resolveAll(api, { degree: "success" });
  assert.equal(results[0].status, "resolved");
  assert.equal(explored(scene).length, before, "no extra nodes");
  assert.match(results[0].message, /0 hidden node\(s\) placed \(\d+ found, only 0 free anchor\(s\)/);
  assert.match(env.chat.at(-1).content, /so \d+ were not placed/);
});

test("PREPARING THE SAME SCENE TWICE only uses anchors that are still free and counts the visits", async () => {
  const { bb, scene, env } = await world({ anchors: 12, days: 8 });
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "failure", chat: false });
  const first = explored(scene).map(t => t.id);
  assert.ok(first.length >= 1 && first.length <= 2);
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "failure" });
  assert.ok(explored(scene).length > first.length);
  for (const id of first) assert.ok(scene.tokens.get(id), "earlier nodes are untouched");
  const anchorIdsUsed = explored(scene).map(t => t.getFlag(M, "node").anchorId);
  assert.equal(new Set(anchorIdsUsed).size, anchorIdsUsed.length, "no anchor was used twice");
  assert.equal(exploration.scenesFor(api, "oak-wood")[0].timesPrepared, 2);
  assert.match(env.chat.at(-1).content, /prepared 1 time\(s\) before/);
});

test("the expedition history keeps only the last 10", async () => {
  const { bb, scene } = await world({ anchors: 60, days: 40 });
  for (let i = 0; i < 12; i++) { await submitExplore(bb); await queue.resolveAll(api, { degree: "criticalFailure", chat: false }); }
  assert.equal(state(scene).prepared.length, 10);
});

// Searching ----------------------------------------------------------------------------------------------------------------
const search = (actor, scene, userId = "u-player") => exploration.runSearch({ actorId: actor.id, sceneId: scene.id, userId });

test("SEARCH spots only the hidden nodes whose Perception DC the GM-side roll beats, and reveals them to everyone", async () => {
  const { bb, scene, env } = await world({ anchors: 0 });
  await standOn(scene, bb);
  const herb = await hiddenNode(scene, { nodeType: "herb", dc: 14 });
  const ore2 = await hiddenNode(scene, { nodeType: "ore", tier: 2, dc: 17, x: 600 });
  const ore3 = await hiddenNode(scene, { nodeType: "ore", tier: 3, dc: 20, x: 700 });
  bb.perceptionRolls.push(roll(2, 15, 9));
  const result = await search(bb, scene);
  assert.deepEqual(result, { message: "You search the area. You spot: Herb Patch.", spotted: ["Herb Patch"] });
  assert.equal(herb.hidden, false);
  assert.deepEqual([ore2.hidden, ore3.hidden], [true, true]);
  assert.deepEqual([herb.getFlag(M, "node").revealed, herb.getFlag(M, "node").revealedBy], [true, "Bottlespeaker"]);
  assert.deepEqual(state(scene).revealed.map(r => [r.name, r.by]), [["Herb Patch", "Bottlespeaker"]]);
  const known = bb.getFlag(M, "knownNodes");
  assert.deepEqual([known.length, known[0].sceneId, known[0].nodeType], [1, scene.id, "herb"]);
  const [forPlayer, forGm] = env.chat;
  assert.deepEqual(forPlayer.whisper, ["u-player"]);
  assert.equal(forPlayer.content, "<p>You search the area. You spot: Herb Patch.</p>");
  assert.deepEqual(forGm.whisper, ["gm1"]);
  assert.match(forGm.content, /Perception total 15 \(natural 9\)\. Found 1 of 3 hidden node\(s\): Herb Patch \(DC 14\)/);
});

test("the player's words are IDENTICAL whether the search failed or nothing was there, and never hint at what is left", async () => {
  const withNodes = await world({ anchors: 0 });
  await standOn(withNodes.scene, withNodes.bb);
  await hiddenNode(withNodes.scene, { dc: 30 });
  await hiddenNode(withNodes.scene, { dc: 30, x: 600 });
  withNodes.bb.perceptionRolls.push(roll(1, 10, 3));
  const failed = await search(withNodes.bb, withNodes.scene);
  const failedChat = withNodes.env.chat.filter(m => m.whisper[0] === "u-player").map(m => m.content);

  const empty = await world({ anchors: 0 });
  await standOn(empty.scene, empty.bb);
  empty.bb.perceptionRolls.push(roll(1, 10, 3));
  const nothing = await search(empty.bb, empty.scene);
  const emptyChat = empty.env.chat.filter(m => m.whisper[0] === "u-player").map(m => m.content);

  assert.deepEqual(failed, nothing);
  assert.deepEqual(failed, { message: "You search the area.", spotted: [] });
  assert.deepEqual(failedChat, emptyChat);
  assert.deepEqual(failedChat, ["<p>You search the area.</p>"]);
  assert.equal(withNodes.scene.tokens.filter(t => t.hidden).length, 2, "nothing was revealed");
});

test("ONE attempt per character per scene visit; resetSearches (and clearMap) give it back", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  await standOn(scene, bb);
  await hiddenNode(scene, { dc: 30 });
  bb.perceptionRolls.push(roll(1, 10, 3), roll(3, 40, 20));
  assert.equal((await search(bb, scene)).message, "You search the area.");
  assert.equal((await search(bb, scene)).message, "You have already searched this area.");
  assert.equal(bb.perceptionRolls.length, 1, "the second attempt did not even roll");
  assert.equal(await exploration.resetSearches(scene), 1);
  assert.deepEqual((await search(bb, scene)).message, "You search the area. You spot: Herb Patch.");
  await exploration.clearMap(scene);
  assert.deepEqual(state(scene).searches, {});
});

test("a search by someone who does not own the character, or whose character is not on the scene, does nothing and uses nothing up", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  await hiddenNode(scene, { dc: 5 });
  bb.perceptionRolls.push(roll(3, 40, 20));
  assert.equal((await search(bb, scene)).message, "You search the area.", "not on the scene: nothing happens");
  assert.deepEqual(state(scene).searches, {}, "and no attempt is used up");
  await standOn(scene, bb);
  assert.match((await search(bb, scene, "u-other")).message, /only search with a character you own/);
  assert.equal(bb.perceptionRolls.length, 1);
  assert.equal(scene.tokens.filter(t => t.hidden).length, 1);
});

test("the Perception roll is made on the GM client: a player cannot send a better total", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  await standOn(scene, bb);
  await hiddenNode(scene, { dc: 25 });
  bb.perceptionRolls.push(roll(1, 8, 3));
  const result = await exploration.runSearch({ actorId: bb.id, sceneId: scene.id, userId: "u-player", total: 99 });
  assert.deepEqual(result.spotted, []);
});

test("searchArea: a player's call is relayed to the GM client; no socket or no GM is a plain message, and nothing is revealed", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  await standOn(scene, bb);
  await hiddenNode(scene, { dc: 10 });
  globalThis.canvas = { scene };
  globalThis.game.user.isGM = false;
  globalThis.game.user.id = "u-player";
  await assert.rejects(exploration.searchArea(bb), /socket is not registered/);
  let relayed = null;
  exploration.setSocket({
    async executeAsGM(name, args) {
      relayed = { name, args };
      globalThis.game.user.isGM = true; // the handler runs on the GM's client
      try { return await exploration.runSearch(args); } finally { globalThis.game.user.isGM = false; }
    }
  });
  bb.perceptionRolls.push(roll(2, 18, 12));
  const result = await exploration.searchArea(bb);
  assert.deepEqual(relayed, { name: "search", args: { actorId: bb.id, sceneId: scene.id, userId: "u-player" } }, "no roll or total travels from the player");
  assert.equal(result.message, "You search the area. You spot: Herb Patch.");
  exploration.setSocket({ async executeAsGM() { throw new Error("No GM is connected"); } });
  await assert.rejects(exploration.searchArea(bb), /The GM isn't available to run your search right now/);
  bb.isOwner = false;
  await assert.rejects(exploration.searchArea(bb), /only search with a character you own/);
  exploration.setSocket(null);
});

// Gathering ---------------------------------------------------------------------------------------------------------------
test("a hidden node cannot be gathered; once it is spotted it can, it spends a charge, and nothing ever refills it", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  bb.skills.nature = { mod: 5, check: { roll: async () => roll(2, 18, 12) } };
  bb.createEmbeddedDocuments = async (type, datas) => datas.map((d, i) => ({ id: `i${i}`, ...d, getFlag: () => undefined, update: async () => {} }));
  bb.items = Object.assign([], { get: () => undefined });
  const token = await hiddenNode(scene, { nodeType: "herb", dc: 12 });
  await assert.rejects(gathering.gather({ actor: bb, node: token, skill: "nature", degree: "success", chat: false }, api), /has not been found yet/);
  assert.equal(token.getFlag(M, "node").charges, 3, "a refused gather spends nothing");
  await standOn(scene, bb);
  bb.perceptionRolls.push(roll(2, 20, 12));
  await search(bb, scene);
  assert.equal(token.hidden, false);
  assert.equal(gathering.nodeInfo(api, token).node.revealed, true);
  assert.equal(gathering.refillNode, undefined, "refilling is gone");
  assert.equal(exploration.refillNode, undefined);
});

// clearMap ------------------------------------------------------------------------------------------------------------------
test("clearMap deletes every module-placed node (found or hidden), frees the anchors, clears known nodes, state and searches; the shared actor and anchors stay", async () => {
  const { bb, scene } = await world({ anchors: 6 });
  await standOn(scene, bb);
  const sharedActorId = (await exploration.ensureNodeActor()).id;
  const found1 = await hiddenNode(scene, { x: 100 });
  const found2 = await hiddenNode(scene, { x: 200 });
  const hidden1 = await hiddenNode(scene, { x: 300, dc: 30 });
  const hidden2 = await hiddenNode(scene, { x: 400, dc: 30 });
  await exploration.placeNode(api, scene, { nodeType: "ore", tier: 1, x: 700 });
  const foreign = scene.tokens.push(fakeToken({ name: "My own node", actorId: "someone-else", x: 800, y: 800, flags: { [M]: { node: { source: "placed", state: "active", nodeType: "ore", tier: 1, charges: 3, discoveredBy: [] } } } }));
  const anchor = anchorsOf(scene)[0];
  await anchor.update({ [`flags.${M}.node.occupiedBy`]: found1.id });
  bb.perceptionRolls.push(roll(3, 25, 12));
  await bb.update({ [`flags.${M}.knownNodes`]: [{ sceneId: scene.id, tokenId: found1.id, name: "Herb Patch" }, { sceneId: "other-scene", tokenId: "keep", name: "Keep me" }] });
  await exploration.runSearch({ actorId: bb.id, sceneId: scene.id, userId: "u-player" }); // reveals found1, found2 (DC 14), not the DC-30 ones
  const items = [{ name: "Moonpetal", qty: 3 }];
  bb.items = items;

  const counts = await exploration.clearMap(scene);
  assert.deepEqual({ removed: counts.removed, found: counts.found, hidden: counts.hidden }, { removed: 5, found: 3, hidden: 2 });
  assert.equal(counts.skipped, 1, "the foreign node token is left alone and counted");
  assert.deepEqual(scene.tokens.filter(t => t.getFlag(M, "node") && t.getFlag(M, "node").state !== "anchor").map(t => t.name), ["My own node"]);
  assert.equal(anchorsOf(scene).length, 6, "every anchor is still there");
  assert.equal(anchorsOf(scene).filter(t => t.getFlag(M, "node").occupiedBy).length, 0, "and free again");
  assert.deepEqual(bb.getFlag(M, "knownNodes"), [{ sceneId: "other-scene", tokenId: "keep", name: "Keep me" }], "only this scene's known nodes are removed");
  assert.equal(counts.knownNodesCleared, 3, "the two found nodes in the list plus the one the search added");
  assert.deepEqual(state(scene), { encounter: null, prepared: [], searches: {}, revealed: [] }, "encounter, searches and history reset");
  assert.equal(exploration.sceneState(scene.id).encounter, null);
  assert.ok(globalThis.game.actors.get(sharedActorId), "the shared Resource Node actor is never deleted");
  assert.deepEqual(items, [{ name: "Moonpetal", qty: 3 }], "inventories are untouched");
  assert.ok(![hidden1, hidden2, found2].some(t => scene.tokens.get(t.id)));
});

test("clearMap is safe to run again (idempotent) and reports zeros on a clean scene; GM only", async () => {
  const { scene } = await world({ anchors: 3 });
  await hiddenNode(scene);
  assert.equal((await exploration.clearMap(scene)).removed, 1);
  assert.deepEqual(await exploration.clearMap(scene), { removed: 0, found: 0, hidden: 0, skipped: 0, knownNodesCleared: 0 });
  globalThis.game.user.isGM = false;
  await assert.rejects(exploration.clearMap(scene), /GM only/);
});

test("after clearMap the same scene can be explored again from scratch", async () => {
  const { bb, scene } = await world({ anchors: 8, days: 8 });
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "success", chat: false });
  assert.ok(explored(scene).length > 0);
  await exploration.clearMap(scene);
  assert.equal(explored(scene).length, 0);
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "success", chat: false });
  assert.ok(explored(scene).length > 0);
  assert.equal(state(scene).prepared.length, 1);
});

// Failure paths ---------------------------------------------------------------------------------------------------------------
function worldSnapshot(scene, actor) {
  return JSON.stringify({
    tokens: scene.tokens.map(t => ({ id: t.id, name: t.name, hidden: t.hidden, x: t.x, y: t.y, node: t.getFlag(M, "node") })),
    state: state(scene), actor: actor.flags
  });
}

test("ROLLBACK: if the actor commit fails, the new tokens, the occupied marks and the scene state are exactly as before and the action stays queued", async () => {
  const { bb, scene } = await world({ anchors: 10 });
  await submitExplore(bb, 2, { forceCombat: true });
  const before = worldSnapshot(scene, bb);
  bb.failUpdate = true;
  const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /actor update failed/);
  bb.failUpdate = false;
  assert.equal(worldSnapshot(scene, bb), before);
  const retry = await queue.resolveAction(api, bb, pending(bb)[0].id, { degree: "success", chat: false });
  assert.equal(retry.status, "resolved");
});

test("FAULT INJECTION: failing each write of an expedition in turn leaves the scene, the anchors, the state and the character exactly as they were", async () => {
  const attempt = async failAt => {
    const { bb, scene } = await world({ anchors: 10 });
    await submitExplore(bb, 2, { forceCombat: true });
    env.ops = 0; env.labels = [];
    const before = worldSnapshot(scene, bb);
    env.failAt = failAt;
    let error = null;
    let outcome = null;
    try {
      const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
      outcome = results[0];
      if (results[0].status === "error") error = new Error(results[0].message);
    } catch (e) { error = e; }
    env.failAt = null;
    return { error, outcome, before, after: worldSnapshot(scene, bb), ops: env.ops, labels: [...env.labels], scene, bb };
  };
  const clean = await attempt(null);
  assert.equal(clean.error, null);
  assert.ok(clean.ops >= 5, `an expedition makes ${clean.ops} writes`);
  for (let k = 1; k <= clean.ops; k++) {
    const run = await attempt(k);
    if (clean.labels[k - 1] === "settings.set downtime") {
      // The "days spent" bookkeeping after a finished action never fails it (it only logs).
      assert.equal(run.outcome.status, "resolved", `the bookkeeping write ${k} failing must not undo a finished expedition`);
      continue;
    }
    assert.ok(run.error, `a failure at write ${k} (${clean.labels[k - 1]}) must surface`);
    assert.match(run.error.message, new RegExp(`injected failure at operation ${k} `));
    assert.equal(run.after, run.before, `after a failure at write ${k} (${clean.labels[k - 1]}) of ${clean.ops} the world must be unchanged`);
    assert.deepEqual(pending(run.bb).length, 1, "the action is still queued");
    assert.deepEqual(audit.scan(), []);
  }
});

test("a roll that fails unexpectedly changes nothing and leaves the action queued", async () => {
  const { bb, scene } = await world({ anchors: 6 });
  await submitExplore(bb);
  const before = worldSnapshot(scene, bb);
  const { results } = await queue.resolveAll(api, { chat: false });  // no rolls queued
  assert.equal(results[0].status, "error");
  assert.equal(worldSnapshot(scene, bb), before);
  assert.equal(pending(bb).length, 1);
});

test("a deleted region is INVALID: the days are refunded and the action removed", async () => {
  const { bb } = await world();
  await submitExplore(bb);
  const trimmed = { ...api, definitions: { ...registry, region: new Map() } };
  const { results } = await queue.resolveAll(trimmed, { degree: "success", chat: false });
  assert.equal(results[0].status, "invalid");
  assert.match(results[0].message, /region "oak-wood" no longer exists.*2 day\(s\) refunded/);
  assert.deepEqual([pending(bb).length, bb.getFlag(M, "downtimeDays")], [0, 6]);
  assert.deepEqual(audit.scan(), []);
});

test("one failing explore does not block a research action in the same batch", async () => {
  const { bb } = await world({ anchors: 6, days: 10 });
  const ae = fakeActor("a2", "Alistair", { crafting: 5 });
  globalThis.game.actors.push(ae);
  await research.grantDays(ae, 3);
  await research.startProject(api, { actor: ae, recipe: "dagger-spider-fang" });
  await submitExplore(bb);
  await queue.submit(ae, "research", { projectId: "unlock-dagger-spider-fang" }, 1);
  ae.rolls.push(roll(2, 18, 12));
  const { results, summary } = await queue.resolveAll(api, { chat: false });  // bb has no rolls: its explore errors
  assert.deepEqual(summary, { resolved: 1, invalid: 0, skipped: 0, errors: 1 });
  assert.equal(results.find(r => r.actorId === "a2").status, "resolved");
});

// The socket: a PLAYER's search must reach the GM client ------------------------------------------------------------------
function fakeHooks() {
  const listeners = {};
  return { once(name, fn) { (listeners[name] ??= []).push(fn); }, fire(name) { const fns = listeners[name] ?? []; listeners[name] = []; for (const fn of fns) fn(); } };
}

/**
 * A socketlib that records registrations and runs "GM" handlers as the GM client (isGM flips for the call).
 * `refuse: true` behaves like the real socketlib does when the manifest lacks "socket": true: it logs its own
 * error and registerModule returns NOTHING.
 */
function fakeSocketlib({ refuse = false, throwOnRegister = false } = {}) {
  const lib = {
    functions: new Map(), registrations: 0, calls: [],
    registerModule(id) {
      lib.registrations++;
      if (throwOnRegister) throw new Error("registerModule failed");
      if (refuse) { console.error(`socketlib | Failed to register socket for module '${id}'. Please set '"socket":true' in your manifest and restart foundry`); return undefined; }
      return {
        register: (name, fn) => lib.functions.set(name, fn),
        async executeAsGM(name, args) {
          lib.calls.push({ name, args });
          const fn = lib.functions.get(name);
          if (!fn) throw new Error(`socketlib: "${name}" is not registered on the GM client`);
          const wasGM = globalThis.game.user.isGM;
          globalThis.game.user.isGM = true; // the handler runs on the GM's client
          try { return await fn(args); } finally { globalThis.game.user.isGM = wasGM; }
        }
      };
    }
  };
  return lib;
}

/** Run `fn` while capturing console.error lines. */
async function capturingErrors(fn) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try { await fn(); } finally { console.error = original; }
  return logged;
}

async function playerSearchWorld() {
  _resetSocketForTests();
  const { bb, scene } = await world({ anchors: 0 });
  await standOn(scene, bb);
  await hiddenNode(scene, { dc: 10 });
  globalThis.canvas = { scene };
  globalThis.game.user.isGM = false;
  globalThis.game.user.id = "u-player";
  bb.perceptionRolls.push(roll(2, 18, 12));
  return { bb, scene };
}

test("SOCKET (player client): registered on socketlib.ready, then a player's search is relayed to the GM client and comes back plain", async () => {
  const { bb } = await playerSearchWorld();
  const lib = fakeSocketlib();
  globalThis.socketlib = lib;
  const hooks = fakeHooks();
  installSocketHooks(hooks);
  assert.equal(lib.registrations, 0, "nothing registers before socketlib says it is ready");
  hooks.fire("socketlib.ready");
  assert.equal(lib.registrations, 1);
  assert.ok(lib.functions.has("search"), "the search handler is registered on THIS (player) client");
  const result = await exploration.searchArea(bb);
  assert.deepEqual(result, { message: "You search the area. You spot: Herb Patch.", spotted: ["Herb Patch"] });
  assert.deepEqual(lib.calls, [{ name: "search", args: { actorId: bb.id, sceneId: globalThis.canvas.scene.id, userId: "u-player" } }]);
  globalThis.socketlib = undefined;
});

test("SOCKET: registration does not depend on the client being a GM; both kinds register the same function once", async () => {
  for (const isGM of [false, true]) {
    _resetSocketForTests();
    install({ isGM });
    const lib = fakeSocketlib();
    globalThis.socketlib = lib;
    const hooks = fakeHooks();
    installSocketHooks(hooks);
    hooks.fire("socketlib.ready");
    hooks.fire("socketlib.ready");
    ensureSocket();
    assert.equal(lib.registrations, 1, `${isGM ? "GM" : "player"} client registers exactly once`);
    assert.ok(lib.functions.has("search"));
    assert.equal(socketStatus().registered, true);
    assert.equal(socketStatus().client, isGM ? "GM" : "player");
  }
  globalThis.socketlib = undefined;
});

test("SOCKET REAL BUG: socketlib returning NOTHING (no \"socket\": true in the manifest) is reported in plain words, with no TypeError", async () => {
  const { bb } = await playerSearchWorld();
  globalThis.socketlib = fakeSocketlib({ refuse: true });
  const hooks = fakeHooks();
  installSocketHooks(hooks);
  const logged = await capturingErrors(async () => {
    hooks.fire("socketlib.ready");
    await assert.rejects(exploration.searchArea(bb), /socket is not registered \(api\.socketStatus\(\) shows what is missing; if the manifest was just updated, the Foundry server must be fully restarted\)/);
  });
  assert.ok(logged.some(l => /socketlib \| Failed to register socket/.test(l)), "socketlib's own message is still visible");
  const ours = logged.find(l => /would not register this module/.test(l));
  assert.ok(ours, "and so is ours");
  assert.match(ours, /"socket": true/);
  assert.match(ours, /SERVER must be fully restarted/);
  assert.ok(!logged.some(l => /TypeError|Cannot read properties of undefined/.test(l)), "no crash on undefined.register");
  assert.equal(socketStatus().registered, false);
  globalThis.socketlib = undefined;
});

test("SOCKET: if registerModule throws, the real error is logged and the player gets a clear message", async () => {
  const { bb } = await playerSearchWorld();
  globalThis.socketlib = fakeSocketlib({ throwOnRegister: true });
  const hooks = fakeHooks();
  installSocketHooks(hooks);
  const logged = await capturingErrors(async () => {
    hooks.fire("socketlib.ready");
    await assert.rejects(exploration.searchArea(bb), /socket is not registered/);
  });
  assert.ok(logged.some(l => /socketlib refused to register this module.*registerModule failed/.test(l)));
  globalThis.socketlib = undefined;
});

test("SOCKET: if the socket is not registered by the time Foundry is ready, the GM is told loudly and the console gets the status", async () => {
  for (const isGM of [true, false]) {
    _resetSocketForTests();
    const { env } = await world({ anchors: 0 });
    globalThis.game.user.isGM = isGM;
    globalThis.socketlib = fakeSocketlib({ refuse: true });
    const hooks = fakeHooks();
    installSocketHooks(hooks);
    const errors = [];
    globalThis.ui = { notifications: { error: m => errors.push(m), info() {}, warn() {} } };
    const logged = await capturingErrors(async () => { hooks.fire("socketlib.ready"); hooks.fire("ready"); });
    assert.ok(logged.some(l => /the socket is not registered: \{.*"registered":false/.test(l)), "status is in the console");
    assert.equal(errors.length, isGM ? 1 : 0, isGM ? "the GM gets an on-screen error" : "players get no popup");
    if (isGM) assert.match(errors[0], /fully restart the Foundry server/);
    void env;
  }
  globalThis.socketlib = undefined;
});

test("SOCKET: with socketlib absent a search says the socket is not registered, and works once it registers", async () => {
  const { bb } = await playerSearchWorld();
  globalThis.socketlib = undefined;
  const hooks = fakeHooks();
  installSocketHooks(hooks);
  await assert.rejects(exploration.searchArea(bb), /socket is not registered/);
  assert.equal(socketStatus().socketlibGlobal, false);
  globalThis.socketlib = fakeSocketlib();
  hooks.fire("socketlib.ready");
  bb.perceptionRolls.push(roll(2, 18, 12));
  assert.equal((await exploration.searchArea(bb)).spotted[0], "Herb Patch");
  globalThis.socketlib = undefined;
});

test("SOCKET: no GM connected is a plain message and nothing is revealed", async () => {
  const { bb, scene } = await playerSearchWorld();
  globalThis.socketlib = { registerModule: () => ({ register() {}, executeAsGM: async () => { throw new Error("No GM is connected"); } }) };
  const hooks = fakeHooks();
  installSocketHooks(hooks);
  hooks.fire("socketlib.ready");
  await assert.rejects(exploration.searchArea(bb), /The GM isn't available to run your search right now/);
  assert.equal(scene.tokens.filter(t => t.hidden).length, 1);
  globalThis.socketlib = undefined;
});

// The manifest: socketlib refuses a module without "socket": true --------------------------------------------------------
const manifest = () => JSON.parse(readFileSync("module.json", "utf8"));

test('MANIFEST: module.json has "socket": true (socketlib will not register the module without it)', () => {
  const m = manifest();
  assert.strictEqual(m.socket, true, 'add "socket": true to module.json, then fully restart the Foundry server');
});

test("MANIFEST: socketlib is a REQUIRED module with a reason, not just recommended", () => {
  const m = manifest();
  const entry = m.relationships.requires.find(r => r.id === "socketlib");
  assert.ok(entry, "socketlib must be in relationships.requires");
  assert.equal(entry.type, "module");
  assert.match(entry.manifest, /socketlib.*module\.json$/);
  assert.match(entry.reason, /Search the area/);
  assert.ok(!(m.relationships.recommends ?? []).some(r => r.id === "socketlib"));
});

test("MANIFEST: any source file that uses socketlib forces both the requirement and the socket flag", () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : name.endsWith(".js") && files.push(path); } };
  walk("scripts");
  const users = files.filter(f => /\bsocketlib\.(registerModule|ready)|registerModule\(|executeAsGM|executeAsUser|executeForEveryone/.test(readFileSync(f, "utf8")));
  assert.ok(users.length >= 1, "the scan sees the code that uses the socket");
  const m = manifest();
  assert.strictEqual(m.socket, true, `${users.join(", ")} use socketlib, so module.json needs "socket": true`);
  assert.ok(m.relationships.requires.some(r => r.id === "socketlib"));
});
