/**
 * Runs the REAL exploration store, queue and audit against fake Foundry objects: scenes with
 * tokens, a node actor, chat, settings. Update semantics (dotted paths, "-=" deletes, object
 * merging) follow Foundry's, so the revert logic is really exercised.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as exploration from "../scripts/exploration/store.js";
import * as gathering from "../scripts/gathering/store.js";
import * as queue from "../scripts/queue/store.js";
import * as audit from "../scripts/audit/store.js";
import * as research from "../scripts/research/store.js";
import { asPage, seedRecords } from "./helpers.js";

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
    async update(data) { applyFlat(token, data); }
  };
  return token;
}

function fakeScene(name, { width = 1000, height = 1000, grid = 100 } = {}) {
  const scene = {
    id: newId("scene"), name, flags: {}, tokens: collection(), grid: { size: grid },
    dimensions: { sceneX: 0, sceneY: 0, sceneWidth: width, sceneHeight: height }, failSetFlag: false, launches: 0,
    async activate() { scene.launches++; }, async view() { scene.launches++; }, async pull() { scene.launches++; },
    getFlag: (scope, key) => clone(scene.flags[scope]?.[key]),
    async setFlag(scope, key, value) { if (scene.failSetFlag && key === "prepared") throw new Error("scene flag failed"); (scene.flags[scope] ??= {})[key] = clone(value); },
    async unsetFlag(scope, key) { delete scene.flags[scope]?.[key]; },
    async createEmbeddedDocuments(type, datas) { return datas.map(d => { const t = fakeToken(d); scene.tokens.push(t); return t; }); },
    async updateEmbeddedDocuments(type, updates) { for (const u of updates) applyFlat(scene.tokens.get(u._id), u); },
    async deleteEmbeddedDocuments(type, ids) { for (const id of ids) scene.tokens.splice(scene.tokens.findIndex(t => t.id === id), 1); }
  };
  return scene;
}

function fakeActor(id, name, mods = { survival: 8, nature: 8 }) {
  const flags = {};
  const actor = {
    id, name, flags, type: "character", isOwner: true, rolls: [], failUpdate: false,
    getFlag: (scope, key) => clone(flags[scope === M ? key : `${scope}.${key}`]),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(data) {
      if (actor.failUpdate) throw new Error("actor update failed");
      for (const [path, value] of Object.entries(data)) flags[path.replace(`flags.${M}.`, "")] = clone(value);
    },
    skills: Object.fromEntries(Object.entries(mods).map(([slug, mod]) => [slug, { mod, check: { roll: async () => actor.rolls.shift() } }]))
  };
  return actor;
}

function install({ isGM = true, actors = [], scenes = [], seed = 1 } = {}) {
  const values = { auditLedger: {}, nodeActorId: "" };
  const actorList = collection([...actors]);
  const sceneList = collection([...scenes]);
  const notices = { info: [], warn: [], error: [] };
  const chat = [];
  globalThis.game = {
    user: { isGM }, i18n: { localize: t => t }, actors: actorList, scenes: sceneList,
    settings: { get: (s, k) => clone(values[k]), set: async (s, k, v) => { values[k] = clone(v); } }
  };
  globalThis.foundry = { utils: { randomID: () => newId("id") } };
  globalThis.CONFIG = { Dice: { randomUniform: mulberry(seed) }, PF2E: { skills: { survival: { label: "Survival" }, nature: { label: "Nature" } } } };
  globalThis.CONST = undefined;
  globalThis.Actor = {
    async create(data) {
      const created = {
        ...clone(data), id: newId("actor"), flags: clone(data.flags ?? {}), isOwner: true,
        getFlag: (scope, key) => created.flags[scope]?.[key],
        async getTokenDocument(tokenData) { return { toObject: () => ({ actorId: created.id, ...clone(created.prototypeToken), ...clone(tokenData) }) }; }
      };
      actorList.push(created);
      return created;
    }
  };
  globalThis.ChatMessage = {
    create: async m => { chat.push(m); },
    getSpeaker: () => ({}),
    getWhisperRecipients: () => [{ id: "gm1" }, { id: "gm2" }]
  };
  globalThis.ui = { notifications: { info: m => notices.info.push(m), warn: m => notices.warn.push(m), error: m => notices.error.push(m) } };
  globalThis.canvas = { scene: sceneList[0] };
  queue.bind(api);
  return { values, notices, chat, actorList, sceneList };
}

async function world({ anchors = 6, days = 6 } = {}) {
  const scene = fakeScene("Whispering Grove");
  const bb = fakeActor("a1", "Bottlespeaker");
  const env = install({ actors: [bb], scenes: [scene] });
  await research.grantDays(bb, days);
  await exploration.tagScene(scene, "oak-wood");
  if (anchors) await exploration.placeAnchors(api, anchors, { scene });
  return { scene, bb, env };
}

const pending = a => a.getFlag(M, "pendingActions") ?? [];
const submitExplore = (actor, skill = "survival") => queue.submit(actor, "explore", { region: "oak-wood", skill }, 2);
const nodeTokens = scene => scene.tokens.filter(t => t.getFlag(M, "node"));
const byState = (scene, state) => nodeTokens(scene).filter(t => t.getFlag(M, "node").state === state);

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

test("only a GM can ensure the node actor or place anything", async () => {
  const { scene } = await world({ anchors: 0 });
  globalThis.game.user.isGM = false;
  for (const call of [() => exploration.ensureNodeActor(), () => exploration.placeAnchors(api, 1, { scene }), () => exploration.tagScene(scene, "x"), () => exploration.resetScene(api, scene), () => exploration.clearAnchors(scene, { confirm: true })]) {
    await assert.rejects(call(), /GM only/);
  }
});

// Tags, anchors, nodes ----------------------------------------------------------------------------------------
test("tagScene / scenesFor / untagScene", async () => {
  const { scene } = await world({ anchors: 3 });
  assert.deepEqual(exploration.scenesFor(api, "oak-wood"), [{ id: scene.id, name: "Whispering Grove", freeAnchors: 3, timesPrepared: 0 }]);
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

test("placeNode uses the nodeType's own image (or the default) and the node can be gathered from", async () => {
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

// Odds, definitions ---------------------------------------------------------------------------------------------------
test("previewExplore shows odds per skill and the scenes (GM only)", async () => {
  const { bb } = await world({ anchors: 4 });
  const preview = exploration.previewExplore(api, bb, "oak-wood");
  assert.deepEqual(preview.region, { id: "oak-wood", name: "Oak Wood", dc: 18, days: 2 });
  assert.deepEqual(preview.perSkill.map(s => [s.skill, s.modifier]), [["survival", 8], ["nature", 8]]);
  assert.ok(preview.perSkill[0].expectedAnchors > 1 && preview.perSkill[0].chances.success > 0);
  assert.equal(preview.scenes[0].freeAnchors, 4);
  assert.match(exploration.previewExplore(api, bb, "oak-wood", "arcana").perSkill[0].problem, /not allowed here/);
  globalThis.game.user.isGM = false;
  assert.equal(exploration.previewExplore(api, bb, "oak-wood").scenes, null, "players do not get scene info");
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

test("simulateExplore wraps the maths: mean and spawn frequencies land near the expected numbers", () => {
  install({ seed: 5 });
  const sim = exploration.simulateExplore(api, { region: "oak-wood", runs: 20_000, degree: "success" });
  assert.ok(Math.abs(sim.meanAnchors - 3) < 0.05);
  for (const s of sim.spawn) assert.ok(Math.abs(s.observed - s.expected) < 0.02);
  assert.throws(() => exploration.simulateExplore(api, { region: "ghost", degree: "success" }), /unknown region/);
});

// Submitting ------------------------------------------------------------------------------------------------------------
test("a PLAYER can submit an explore action; the days are reserved and the audit stays clean", async () => {
  const { bb } = await world();
  globalThis.game.user.isGM = false;
  const action = await submitExplore(bb, "nature");
  assert.deepEqual(action.params, { region: "oak-wood", skill: "nature" });
  assert.deepEqual([bb.getFlag(M, "downtimeDays"), pending(bb).length], [4, 1]);
  await assert.rejects(queue.submit(bb, "explore", { region: "oak-wood", skill: "nature" }, 1), /take 2 day\(s\)/);
  await assert.rejects(queue.submit(bb, "explore", { region: "ghost" }, 2), /unknown region "ghost"/);
  await assert.rejects(queue.submit(bb, "explore", { region: "oak-wood" }, 2), /choose one with skill/);
  globalThis.game.user.isGM = true;
  assert.deepEqual(audit.scan(), []);
});

test("a GM submit is refused when no scene is tagged, and when the tagged scene has no anchors", async () => {
  const { bb, scene } = await world({ anchors: 0 });
  await assert.rejects(queue.submit(bb, "explore", { region: "barren-ridge", skill: "survival" }, 1), /no scene is tagged "barren-ridge"/);
  await assert.rejects(submitExplore(bb), /have no free anchors/);
  assert.deepEqual([bb.getFlag(M, "downtimeDays"), pending(bb).length], [6, 0]);
  await exploration.placeAnchor(api, scene);
  await assert.doesNotReject(submitExplore(bb));
});

test("the review row describes the region, the odds and the scene pool", async () => {
  const { bb } = await world({ anchors: 4 });
  await submitExplore(bb);
  const [row] = queue.list();
  assert.equal(row.label, "Explore: Oak Wood");
  assert.match(row.detail, /survival \+8 vs DC 18: crit 5% \/ success 5\d% .*expect ~\d\.\d nodes; 2 day\(s\); 1 tagged scene\(s\), 4 free anchor\(s\)/);
  assert.equal(row.problem, null);
});

// Resolving ----------------------------------------------------------------------------------------------------------------
test("resolving PREPARES the scene: anchors become real nodes, days are spent, the audit is clean, nothing is launched", async () => {
  const { bb, scene, env } = await world();
  await submitExplore(bb);
  const { results } = await queue.resolveAll(api, { degree: "success" });
  assert.equal(results[0].status, "resolved");
  assert.match(results[0].message, /prepared "Whispering Grove" \(not launched\): [234] node\(s\) activated/);
  const active = byState(scene, "active");
  assert.ok(active.length >= 2 && active.length <= 4);
  assert.equal(byState(scene, "anchor").length, 6 - active.length);
  for (const t of active) {
    const record = t.getFlag(M, "node");
    const type = registry.nodeType.get(record.nodeType);
    assert.deepEqual([record.source, record.region, t.hidden, t.name, t.texture.src], ["explored", "oak-wood", false, type.name, type.img ?? "icons/svg/item-bag.svg"]);
    assert.equal(gathering.nodeInfo(api, t).ok, true, "the party can gather from it");
  }
  for (const t of byState(scene, "anchor")) assert.deepEqual([t.hidden, t.name], [true, "Anchor"]);
  assert.equal(pending(bb).length, 0);
  assert.equal(bb.getFlag(M, "downtimeDays"), 4, "2 of 6 days spent");
  assert.equal(scene.getFlag(M, "prepared").length, 1);
  assert.equal(globalThis.canvas.scene, env.sceneList[0], "the canvas scene was not touched");
  assert.equal(scene.launches, 0, "the scene was never activated, viewed or pulled");
  assert.deepEqual(audit.scan(), []);
});

test("chat: a public flavour line without the scene name, and a GM-only whisper with the details", async () => {
  const { bb, env } = await world();
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "criticalSuccess" });
  assert.equal(env.chat.length, 2);
  const [pub, gm] = env.chat;
  assert.equal(pub.whisper, undefined);
  assert.ok(!pub.content.includes("Whispering Grove"));
  assert.match(pub.content, /rich pickings/);
  assert.deepEqual(gm.whisper, ["gm1", "gm2"]);
  assert.match(gm.content, /Whispering Grove/);
  assert.match(gm.content, /forced result/);
  assert.match(gm.content, /Scene prepared, not launched/);
});

test("one REAL roll: the natural d20 and total are recorded, and the degree comes from PF2e", async () => {
  const { bb, env } = await world();
  await submitExplore(bb);
  bb.rolls.push(roll(3, 30, 20));
  const { results } = await queue.resolveAll(api);
  assert.equal(results[0].status, "resolved");
  assert.match(results[0].message, /Natural d20: 20/);
  assert.match(env.chat[1].content, /natural 20, total 30 vs DC 18/);
  assert.match(env.chat[1].content, /Critical success/);
});

test("NO TAGGED SCENE is an error row that keeps its days; tagging a scene and Retry then works", async () => {
  const { bb } = await world();
  const scene2 = fakeScene("Barren Hills");
  globalThis.game.scenes.push(scene2);
  await exploration.placeAnchors(api, 3, { scene: scene2 });
  await queue.submit(bb, "explore", { region: "barren-ridge", skill: "survival" }, 1).catch(() => {}); // refused for a GM: no tag yet
  // A player queued it before the GM untagged / before any scene existed:
  const action = { id: "e1", type: "explore", params: { region: "barren-ridge", skill: "survival" }, daysReserved: 1, submittedAt: 1 };
  await bb.update({ [`flags.${M}.pendingActions`]: [action], [`flags.${M}.downtimeDays`]: 5 });
  const first = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(first.results[0].status, "error");
  assert.match(first.results[0].message, /no scene is tagged "barren-ridge"/);
  assert.deepEqual([pending(bb).length, bb.getFlag(M, "downtimeDays")], [1, 5], "still queued, days still reserved");
  await exploration.tagScene(scene2, "barren-ridge");
  const retry = await queue.resolveAction(api, bb, "e1", { degree: "success", chat: false });
  assert.equal(retry.status, "resolved");
  assert.deepEqual([pending(bb).length, byState(scene2, "active").length > 0], [0, true]);
  assert.deepEqual(audit.scan(), []);
});

test("a tagged scene with no free anchors is an error row that names the scene", async () => {
  const { bb, scene } = await world({ anchors: 1 });
  await submitExplore(bb);
  await exploration.clearAnchors(scene, { confirm: true });
  const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /Whispering Grove\) have no free anchors/);
  assert.equal(pending(bb).length, 1);
});

test("FEWER ANCHORS than rolled: all are activated, nothing is refunded, and the GM is told", async () => {
  const { bb, scene, env } = await world({ anchors: 1 });
  await submitExplore(bb);
  const { results } = await queue.resolveAll(api, { degree: "criticalSuccess" });
  assert.match(results[0].message, /1 node\(s\) activated \(rolled [345], the scene only had 1\), 0 free anchor\(s\) left/);
  assert.equal(byState(scene, "active").length, 1);
  assert.equal(bb.getFlag(M, "downtimeDays"), 4, "the days are still spent");
  assert.match(env.chat[1].content, /only had 1/);
});

test("PREPARING THE SAME SCENE TWICE uses the anchors that are left and counts the visits", async () => {
  const { bb, scene, env } = await world({ anchors: 6, days: 8 });
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "failure", chat: false });
  const afterFirst = byState(scene, "active").length;
  assert.ok(afterFirst >= 1 && afterFirst <= 2);
  const firstIds = byState(scene, "active").map(t => t.id);
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "failure" });
  assert.ok(byState(scene, "active").length > afterFirst);
  for (const id of firstIds) assert.equal(scene.tokens.get(id).getFlag(M, "node").state, "active", "earlier nodes untouched");
  assert.equal(scene.getFlag(M, "prepared").length, 2);
  assert.match(env.chat.at(-1).content, /already prepared 1 time/);
  assert.equal(exploration.scenesFor(api, "oak-wood")[0].timesPrepared, 2);
});

test("the prepared log keeps only the last 10 expeditions", async () => {
  const { bb, scene } = await world({ anchors: 60, days: 40 });
  for (let i = 0; i < 12; i++) { await submitExplore(bb); await queue.resolveAll(api, { degree: "criticalFailure", chat: false }); }
  assert.equal(scene.getFlag(M, "prepared").length, 10);
});

test("resetScene turns explored nodes back into hidden anchors and clears the history", async () => {
  const { bb, scene } = await world({ anchors: 4 });
  await submitExplore(bb);
  await queue.resolveAll(api, { degree: "success", chat: false });
  const explored = byState(scene, "active").length;
  await exploration.placeNode(api, scene, { nodeType: "ore", tier: 1 });
  assert.equal(await exploration.resetScene(api, scene), explored, "hand-placed nodes are left alone");
  assert.equal(byState(scene, "anchor").length, 4);
  assert.equal(byState(scene, "active").length, 1);
  for (const t of byState(scene, "anchor")) {
    assert.deepEqual([t.hidden, t.name, t.texture.src, Object.keys(t.getFlag(M, "node")).sort()], [true, "Anchor", "icons/svg/mystery-man.svg", ["discoveredBy", "region", "source", "state"]]);
  }
  assert.equal(scene.getFlag(M, "prepared"), undefined);
});

// Failure paths ---------------------------------------------------------------------------------------------------------------
function snapshot(scene) {
  return scene.tokens.map(t => JSON.stringify({ id: t.id, name: t.name, hidden: t.hidden, src: t.texture.src, node: t.getFlag(M, "node") }));
}

test("ROLLBACK: if the actor commit fails, every token and the scene log are exactly as before and the action stays queued", async () => {
  const { bb, scene } = await world();
  await submitExplore(bb);
  const before = snapshot(scene);
  const logBefore = scene.getFlag(M, "prepared");
  bb.failUpdate = true;
  const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /actor update failed/);
  assert.deepEqual(snapshot(scene), before);
  assert.equal(scene.getFlag(M, "prepared"), logBefore);
  bb.failUpdate = false;
  assert.equal(pending(bb).length, 1);
  assert.deepEqual(audit.scan(), []);
  const retry = await queue.resolveAction(api, bb, pending(bb)[0].id, { degree: "success", chat: false });
  assert.equal(retry.status, "resolved");
});

test("ROLLBACK: if the scene log cannot be written, the activated tokens are put back and nothing is spent", async () => {
  const { bb, scene } = await world();
  await submitExplore(bb);
  const before = snapshot(scene);
  scene.failSetFlag = true;
  const { results } = await queue.resolveAll(api, { degree: "success", chat: false });
  assert.match(results[0].message, /scene flag failed/);
  assert.deepEqual(snapshot(scene), before);
  assert.deepEqual([pending(bb).length, bb.getFlag(M, "downtimeDays")], [1, 4]);
});

test("a roll that fails unexpectedly changes nothing and leaves the action queued", async () => {
  const { bb, scene } = await world();
  await submitExplore(bb);
  const before = snapshot(scene);
  const { results } = await queue.resolveAll(api, { chat: false });  // no rolls queued
  assert.equal(results[0].status, "error");
  assert.deepEqual(snapshot(scene), before);
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
  const { bb } = await world({ days: 10 });
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
