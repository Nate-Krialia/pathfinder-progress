/**
 * Stage 10a: queued craft and gather, run through the REAL scripts/main.js api in a fake Foundry.
 *
 * Boot = fire the module's own init and ready hooks, then drive everything through api.queue.*, api.downtime.*,
 * api.clearMap and api.audit.*. A player's call really goes through the registered socket handlers: each "client"
 * has its own identity (AsyncLocalStorage), so a player's call is relayed to a GM context, two players can act at the
 * same moment, and a handler never sees the caller's identity unless it was sent. Every world write counts as an
 * "operation", so a failure can be injected at EACH one to prove nothing is left half-applied.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, chatLeaks, seedRecords, UUID, UUID_2 } from "./helpers.js";
import * as gmLog from "../scripts/gm-log.js";
import { GENERIC_FAILURE, Refusal, guard, refusal, unwrap } from "../scripts/queue/relay.js";

const M = "pathfinder-progress";
const makeRegistry = () => loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const registry = makeRegistry();
const DAGGER = "dagger-spider-fang";
const SEL = { blade: "iron", fang: "spider-fang" };
const clone = v => (v === undefined ? undefined : structuredClone(v));

// Fake Foundry ---------------------------------------------------------------------------------------------------------
class FakeForcedDeletion {}
function applyPath(target, path, value) {
  const parts = path.split(".");
  if (parts.some(part => part.startsWith("-="))) throw new Error(`the "-=" update syntax is deprecated: use ForcedDeletion (key "${path}")`);
  let o = target;
  for (const part of parts.slice(0, -1)) o = (o[part] ??= {});
  const last = parts.at(-1);
  if (value instanceof FakeForcedDeletion) { delete o[last]; return; }
  const isObj = v => v && typeof v === "object" && !Array.isArray(v);
  if (isObj(value) && isObj(o[last])) for (const [k, v] of Object.entries(value)) applyPath(o[last], k, v);
  else o[last] = clone(value);
}
const applyFlat = (target, data) => { for (const [k, v] of Object.entries(data)) if (k !== "_id") applyPath(target, k, v); };

const env = { ops: 0, failAt: null, failLabel: null, chat: [], values: {}, rng: [], handlers: new Map(), relayContext: undefined, noGM: false, handlerThrows: [] };
function tick(label) {
  env.ops++;
  if (env.failAt === env.ops) throw new Error(`injected failure at operation ${env.ops} (${label})`);
  if (env.failLabel === label) { env.failLabel = null; throw new Error(`injected failure at ${label}`); }
}

/** Real Foundry writes take a round trip, so calls from two clients genuinely interleave. The fake yields before applying a write. */
const latency = () => new Promise(resolve => setImmediate(resolve));

const als = new AsyncLocalStorage();
/** Run fn as this user's client. */
const as = (user, fn) => als.run({ user }, fn);

const collection = (items = []) => {
  items.get = id => items.find(i => i.id === id);
  items.getName = name => items.find(i => i.name === name);
  return items;
};
let nextId = 0;
const newId = prefix => `${prefix}${++nextId}`;

function makeToken(data) {
  const token = {
    documentName: "Token", id: newId("tok"), name: data.name, x: data.x ?? 0, y: data.y ?? 0, hidden: !!data.hidden,
    flags: clone(data.flags ?? {}), actorId: data.actorId,
    get uuid() { return `Scene.s.Token.${token.id}`; },
    getFlag: (scope, key) => clone(token.flags[scope]?.[key]),
    async setFlag(scope, key, value) { await latency(); tick("token.setFlag"); applyPath(token.flags, `${scope}.${key}`, value); },
    async unsetFlag(scope, key) { await latency(); tick("token.unsetFlag"); delete token.flags[scope]?.[key]; },
    async update(change) { await latency(); tick("token.update"); applyFlat(token, change); }
  };
  return token;
}

function makeScene(name, data = {}) {
  const scene = {
    id: newId("scene"), name, flags: clone(data.flags ?? {}), ownership: clone(data.ownership), tokens: collection([]), grid: { size: 100 },
    async delete() { const i = game.scenes.indexOf(scene); if (i >= 0) game.scenes.splice(i, 1); },
    dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000 },
    getFlag: (scope, key) => clone(scene.flags[scope]?.[key]),
    async setFlag(scope, key, value) { (scene.flags[scope] ??= {})[key] = clone(value); },
    async unsetFlag(scope, key) { delete scene.flags[scope]?.[key]; },
    async createEmbeddedDocuments(type, datas) { tick("scene.createEmbeddedDocuments"); return datas.map(d => { const t = makeToken(d); scene.tokens.push(t); return t; }); },
    async updateEmbeddedDocuments(type, updates) { tick("scene.updateEmbeddedDocuments"); for (const u of updates) applyFlat(scene.tokens.get(u._id), u); },
    async deleteEmbeddedDocuments(type, ids) { tick("scene.deleteEmbeddedDocuments"); for (const id of ids) { const i = scene.tokens.findIndex(t => t.id === id); if (i >= 0) scene.tokens.splice(i, 1); } }
  };
  return scene;
}

function makeItem(actor, data) {
  const item = {
    id: newId("item"), name: data.name, type: data.type, system: { ...(data.system ?? {}) }, flags: clone(data.flags ?? {}),
    getFlag: (scope, key) => clone(item.flags[scope]?.[key]),
    toObject: () => clone({ name: item.name, type: item.type, system: item.system, flags: item.flags }),
    async update(change) { tick("item.update"); if ("system.quantity" in change) item.system.quantity = change["system.quantity"]; },
    async delete() { tick("item.delete"); actor.items.splice(actor.items.indexOf(item), 1); }
  };
  return item;
}

function makeActor(name, { copper = 0, owners = [] } = {}) {
  const flags = {};
  const items = collection([]);
  const actor = {
    id: newId("actor"), name, type: "character", flags, items, copper, owners, rolls: [],
    get isOwner() { return game.user.isGM || owners.includes(game.user.id); },
    testUserPermission: user => owners.includes(user.id),
    getFlag: (scope, key) => (scope === M ? clone(flags[key]) : undefined),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(data) {
      await latency();
      tick("actor.update");
      for (const [path, value] of Object.entries(data)) {
        if (path.startsWith(`flags.${M}.`)) {
          const key = path.slice(`flags.${M}.`.length);
          if (value instanceof FakeForcedDeletion) delete flags[key]; else flags[key] = clone(value);
        } else applyPath(actor, path, value);
      }
    },
    inventory: {
      coins: { get copperValue() { return actor.copper; } },
      async addCoins(c) {
        tick("addCoins");
        actor.copper += c.gp * 100 + c.sp * 10 + c.cp;
        // Real PF2e keeps coins as an inventory item. Only the actors a test creates "like PF2e" (Actor.create) have one.
        if (actor.coinItem && !items.some(i => i.system.stackGroup === "coins")) items.push(makeItem(actor, { name: "Gold Pieces", type: "treasure", system: { stackGroup: "coins", quantity: 1 } }));
      },
      async removeCoins(c) {
        tick("removeCoins");
        const cost = c.gp * 100 + c.sp * 10 + c.cp;
        if (cost > actor.copper) return false;
        actor.copper -= cost;
        return true;
      }
    },
    rollArgs: [], perceptionRolls: [],
    perception: { check: { roll: async () => actor.perceptionRolls.shift() } },
    skills: Object.fromEntries(["crafting", "survival", "nature", "athletics"].map(slug => [slug, { mod: 5, check: { roll: async args => { actor.rollArgs.push(args); return actor.rolls.shift(); } } }])),
    async createEmbeddedDocuments(type, datas) { tick("actor.createEmbeddedDocuments"); return datas.map(d => { const item = makeItem(actor, d); items.push(item); return item; }); },
    async delete() { const i = game.actors.indexOf(actor); if (i >= 0) game.actors.splice(i, 1); }
  };
  return actor;
}

const listeners = {};
globalThis.Hooks = {
  once: (name, fn) => (listeners[name] ??= []).push(fn),
  on: (name, fn) => (listeners[name] ??= []).push(fn)
};
const quietly = async fn => {
  const saved = [console.log, console.error];
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { [console.log, console.error] = saved; }
};
const loudly = async fn => {
  const saved = console.error;
  const seen = [];
  console.error = (...args) => seen.push(args.map(String).join(" "));
  try { return await fn(seen); } finally { console.error = saved; }
};

let importedMain = false;
let api;
let users;

/** A fresh world and a freshly booted module. Returns the people and places the tests use. */
async function world({ iron = 3, fang = 3, copper = 2000, downtime = 6, withGM = true } = {}) {
  env.ops = 0; env.failAt = null; env.failLabel = null; env.chat = []; env.rng = []; env.relayContext = undefined; env.noGM = !withGM; env.handlerThrows = [];
  const gm = { id: "gm1", isGM: true, active: true, name: "GM", character: null };
  const annUser = { id: "u-ann", isGM: false, active: true, name: "Ann", character: null };
  const bobUser = { id: "u-bob", isGM: false, active: true, name: "Bob", character: null };
  const testUser = {
    id: "u-test", isGM: false, active: true, name: "Test", character: null, flags: {},
    getFlag: (scope, key) => clone(testUser.flags[key]),
    async setFlag(scope, key, value) { testUser.flags[key] = clone(value); },
    async unsetFlag(scope, key) { delete testUser.flags[key]; },
    async update(change) { if ("character" in change) testUser.character = change.character ? game.actors.get(change.character) ?? null : null; }
  };
  users = { gm, annUser, bobUser, testUser };
  env.values = {
    auditLedger: {}, downtime: {}, explorationState: {}, commissions: [], nodeActorId: "", extraPacks: "", itemPacks: "",
    partyLocation: "oakhaven", stationState: []
  };
  const modules = new Map();
  let seed = 5;
  globalThis.canvas = { scene: null };
  globalThis.game = {
    get user() { return als.getStore()?.user ?? gm; },
    users: Object.assign(collection([gm, annUser, bobUser, testUser]), { activeGM: gm }), actors: collection([]), scenes: collection([]),
    packs: { get: id => (id === "pf2e.equipment-srd" ? { getIndex: async () => [{ name: "Dagger", _id: "AAAAAAAAAAAAAAAA" }] } : undefined), filter: () => [] }, system: { id: "pf2e", version: "8.6.1" }, version: "14.369", i18n: { localize: t => t },
    modules: { get: id => modules.get(id) ?? (modules.set(id, { id, active: true }), modules.get(id)) },
    settings: { register() {}, get: (s, k) => clone(env.values[k]), set: async (s, k, v) => { tick(`settings.set ${k}`); env.values[k] = clone(v); } }
  };
  globalThis.foundry = {
    utils: { randomID: () => newId("r") },
    data: { fields: { ArrayField: class {}, ObjectField: class {} }, operators: { ForcedDeletion: FakeForcedDeletion } },
    applications: { instances: new Map(), api: { ApplicationV2: class {} } }
  };
  globalThis.CONFIG = {
    Dice: { randomUniform: () => (env.rng.length ? env.rng.shift() : (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) },
    PF2E: { skills: { crafting: { label: "Crafting" }, survival: { label: "Survival" }, nature: { label: "Nature" }, athletics: { label: "Athletics" } } }
  };
  globalThis.CONST = undefined;
  globalThis.Actor = {
    create: async data => {
      const owners = Object.entries(data.ownership ?? {}).filter(([k, v]) => k !== "default" && v === 3).map(([k]) => k);
      const actor = makeActor(data.name, { owners });
      Object.assign(actor, { type: data.type, ownership: clone(data.ownership), prototypeToken: clone(data.prototypeToken), coinItem: true });
      Object.assign(actor.flags, clone(data.flags?.[M] ?? {}));
      actor.getTokenDocument = async td => ({ toObject: () => ({ actorId: actor.id, name: actor.name, ...clone(actor.prototypeToken ?? {}), ...clone(td) }) });
      game.actors.push(actor);
      return actor;
    }
  };
  globalThis.Scene = { create: async data => { const scene = makeScene(data.name, data); game.scenes.push(scene); return scene; } };
  globalThis.ChatMessage = {
    create: async message => { env.chat.push(message); },
    getSpeaker: () => ({}),
    getWhisperRecipients: () => [gm]
  };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.fromUuid = async () => ({ toObject: () => ({ name: "Dagger", type: "weapon", system: {}, flags: {} }) });

  // A fake socketlib: executeAsGM runs the registered function in a GM context (or fails if no GM is connected).
  env.handlers = new Map();
  globalThis.socketlib = {
    registerModule: () => ({
      register: (name, fn) => env.handlers.set(name, fn),
      executeAsGM: async (name, payload) => {
        if (env.noGM) { const error = new Error("There is no GM connected"); error.name = "SocketlibNoGMConnectedError"; throw error; }
        // Like the REAL socketlib: if the handler throws, the caller never sees the message, only this generic text.
        // (The real reason stays in the GM's console.) A guarded handler never throws, so this must never happen.
        try {
          return await als.run({ user: gm }, () => env.handlers.get(name).call(env.relayContext, payload));
        } catch (error) {
          env.handlerThrows.push({ name, message: error.message });
          throw new Error(`An exception occured during remote execution of handler '${name}'. Please see Gamemaster's error console for details.`);
        }
      }
    })
  };

  const ann = makeActor("Ann", { copper, owners: [annUser.id] });
  const bob = makeActor("Bob", { copper, owners: [bobUser.id] });
  game.actors.push(ann, bob);
  annUser.character = ann; bobUser.character = bob;
  const table = makeScene("The Table");
  const other = makeScene("Other Place");
  game.scenes.push(table, other);
  table.tokens.push(makeToken({ name: "Ann", actorId: ann.id }));
  other.tokens.push(makeToken({ name: "Bob", actorId: bob.id }));   // Bob is NOT on the table's scene

  if (!importedMain) { await quietly(() => import("../scripts/main.js")); importedMain = true; }
  const { _resetSocketForTests } = await import("../scripts/socket.js");
  _resetSocketForTests();
  await quietly(async () => {
    for (const fn of [...(listeners.init ?? [])]) await fn();
    for (const fn of [...(listeners.ready ?? [])]) await fn();
    for (const fn of [...(listeners["socketlib.ready"] ?? [])]) await fn();
  });
  api = game.modules.get(M).api;
  game.modules.get(M).version = JSON.parse(readFileSync("module.json", "utf8")).version;
  api.definitions = makeRegistry(); api.resolvedOutputs = new Map([[DAGGER, { "1": UUID, "2": UUID_2, "3": UUID }]]); api.contexts = new Map(); api.uncraftable = new Set();

  if (iron) await api.giveMaterial(ann, "iron", iron);
  if (fang) await api.giveMaterial(ann, "spider-fang", fang);
  await api.grantFormula(ann, DAGGER);
  if (downtime) await api.downtime.start({ days: downtime, actorIds: [ann.id, bob.id] });
  env.ops = 0;
  const { setCraftReductions } = await import("../scripts/queue/work.js");
  setCraftReductions(null);
  return { gm, annUser, bobUser, ann, bob, table, other };
}

// Helpers ---------------------------------------------------------------------------------------------------------------
const stashOf = actor => {
  const out = {};
  for (const item of actor.items) { const id = item.getFlag(M, "material")?.materialId; if (id) out[id] = (out[id] ?? 0) + item.system.quantity; }
  return out;
};
const pendingOf = actor => actor.getFlag(M, "pendingActions") ?? [];
const measure = actor => {
  const free = actor.getFlag(M, "downtimeDays") ?? 0;
  const reserved = pendingOf(actor).reduce((n, a) => n + a.daysReserved, 0);
  return {
    copper: actor.copper, stash: stashOf(actor), freeDays: free, reservedDays: reserved, totalDays: free + reserved,
    items: actor.items.filter(i => !i.getFlag(M, "material")).map(i => i.name).sort()
  };
};
const events = () => (env.values.auditLedger._events?.history ?? []).map(h => h.text);
/** Everything a craft or gather can touch, comparable (item ids are ignored: a returned stack is a new item). */
function snapshot(w) {
  return JSON.stringify({
    actors: game.actors.map(a => ({ id: a.id, copper: a.copper, flags: a.flags, items: a.items.map(i => `${i.name}|${i.system.quantity}|${JSON.stringify(i.flags)}`).sort() })),
    scenes: game.scenes.map(s => ({ id: s.id, tokens: s.tokens.map(t => ({ id: t.id, name: t.name, hidden: t.hidden, flags: t.flags })) })),
    values: env.values
  });
}
void snapshot;

let nodeCounter = 0;
/** A node token on a scene: record fields can be overridden. Returns the token. */
async function addNode(scene, over = {}, { actorId = "node-actor", name = "Herb Patch", withAnchor = false } = {}) {
  const record = { source: "explored", state: "active", nodeType: "herb", tier: 1, charges: 3, discoveredBy: [], revealed: true, ...over };
  let anchor = null;
  if (withAnchor) {
    [anchor] = await scene.createEmbeddedDocuments("Token", [{ name: "Anchor", x: 500 + (++nodeCounter) * 100, y: 100, hidden: true, flags: { [M]: { node: { source: "placed", state: "anchor", discoveredBy: [] } } } }]);
    record.anchorId = anchor.id;
  }
  const [token] = await scene.createEmbeddedDocuments("Token", [{ name, x: 100, y: 100, actorId, flags: { [M]: { node: record } } }]);
  if (anchor) await anchor.update({ [`flags.${M}.node.occupiedBy`]: token.id });
  env.ops = 0;
  return { token, anchor };
}
const nodeOf = token => token.getFlag(M, "node");

const craft = (w, user = w.annUser, actor = w.ann, over = {}, days) => as(user, () => api.queue.submit(actor, "craft", { recipe: DAGGER, selection: SEL, ...over }, days));
const gatherCall = (user, actor, token, scene, over = {}, days) => as(user, () => api.queue.submit(actor, "gather", { sceneId: scene.id, tokenId: token.id, skill: "nature", ...over }, days));
const resolve = (actor, id, options = {}) => api.queue.resolve(actor, id, { degree: "success", chat: false, ...options });

/** Fail the Nth world write of `op` for N = 1, 2, ...: whenever it throws the world must be exactly as before. */
async function everyFailureLeavesNothingHalfDone(label, build, op, minWrites = 4) {
  let finished = null;
  for (let n = 1; n <= 400; n++) {
    const w = await build();
    const before = snapshot(w);
    env.ops = 0; env.failAt = n;
    let failed = false;
    try { await op(w); } catch { failed = true; }
    env.failAt = null;
    if (!failed) { finished = n; break; }
    assert.equal(snapshot(w), before, `${label}: failing write #${n} left the world changed`);
  }
  assert.ok(finished && finished >= minWrites, `${label}: expected the operation to have at least ${minWrites - 1} writes (finished at ${finished})`);
  return finished;
}

// CRAFT: queueing and escrow ------------------------------------------------------------------------------------------
test("a player queues a craft: materials, the station fee and the days are taken NOW, once, and the row says so in plain words", async () => {
  const w = await world();
  const before = measure(w.ann);
  const action = await craft(w);
  const after = measure(w.ann);
  assert.deepEqual([action.type, action.daysReserved], ["craft", 2]);
  assert.deepEqual(after.stash, { iron: before.stash.iron - 1, "spider-fang": before.stash["spider-fang"] - 1 });
  assert.equal(after.copper, before.copper - 500, "the 5 gp station fee left the purse");
  assert.deepEqual([after.freeDays, after.reservedDays, after.totalDays], [before.freeDays - 2, 2, before.totalDays], "days moved into the reservation; the total did not change");
  assert.deepEqual(action.params.escrow.units, [{ materialId: "iron", name: "Iron", tier: 1, units: 1 }, { materialId: "spider-fang", name: "Spider Fang", tier: 2, units: 1 }]);
  assert.equal(action.params.escrow.feeCopper, 500);

  const [row] = api.queue.list();
  assert.equal(row.label, "Craft: Spider Fang Dagger");
  assert.match(row.detail, /2 day\(s\) reserved; station Oakhaven Forge; escrow: 1x Iron, 1x Spider Fang and a 5 gp fee/);
  assert.equal(row.problem, null);
  assert.doesNotMatch(row.detail, /%|DC|odds|chance|roll/i, "no odds anywhere a player might look");
  assert.ok(events().includes("queued craft: Spider Fang Dagger for Ann; escrow taken: 1x Iron, 1x Spider Fang and a 5 gp fee; 2 day(s) reserved"));
  assert.deepEqual(api.audit.scan(), []);
});

for (const [label, iron, fang] of [["a bigger stash", 3, 3], ["exactly what the craft needs (the stacks are deleted, then recreated)", 1, 1]]) {
  test(`cancelling a queued craft returns days, materials and fee exactly once: ${label}`, async () => {
    const w = await world({ iron, fang });
    const before = measure(w.ann);
    const action = await craft(w);
    if (iron === 1) assert.deepEqual(stashOf(w.ann), {}, "the stacks were emptied into escrow");
    const result = await as(w.annUser, () => api.queue.cancel(w.ann, action.id));
    assert.equal(result.refunded, 2);
    assert.match(result.returned, /escrow returned: 1x Iron, 1x Spider Fang and a 5 gp fee/);
    assert.deepEqual(measure(w.ann), before, "gold, days and materials are exactly as before");
    assert.deepEqual(api.queue.list(), []);
    assert.ok(events().some(t => /^craft cancelled by Ann: Craft: Spider Fang Dagger for Ann; escrow returned: 1x Iron, 1x Spider Fang and a 5 gp fee; 2 day\(s\) refunded$/.test(t)), events().join(" | "));
    await assert.rejects(as(w.annUser, () => api.queue.cancel(w.ann, action.id)), /has no queued action/, "a second cancel cannot return it twice");
    assert.deepEqual(measure(w.ann), before);
    assert.deepEqual(api.audit.scan(), []);
  });
}

test("two crafts queued at the same moment for one character both land: nothing is lost or taken twice", async () => {
  const w = await world({ iron: 2, fang: 2 });
  const start = measure(w.ann);
  const both = await Promise.all([craft(w), craft(w)]);
  assert.equal(pendingOf(w.ann).length, 2, "neither queued action overwrote the other");
  assert.notEqual(both[0].id, both[1].id);
  const after = measure(w.ann);
  assert.deepEqual(after.stash, {}, "each craft took its own materials, once");
  assert.equal(start.copper - after.copper, 1000);
  assert.deepEqual([after.freeDays, after.reservedDays, after.totalDays], [start.freeDays - 4, 4, start.totalDays]);
  assert.deepEqual(api.audit.scan(), []);
});

test("two crafts for the same last materials: one queues, the other is refused, nothing is taken twice", async () => {
  const w = await world({ iron: 1, fang: 1 });
  const settled = await Promise.allSettled([craft(w), craft(w)]);
  assert.deepEqual(settled.map(s => s.status).sort(), ["fulfilled", "rejected"]);
  assert.match(settled.find(s => s.status === "rejected").reason.message, /Cannot queue this craft: .*Compendium/);
  assert.equal(pendingOf(w.ann).length, 1);
  assert.equal(w.ann.copper, 1500);
  assert.deepEqual(api.audit.scan(), []);
});

// CRAFT: resolving ------------------------------------------------------------------------------------------------------
test("resolving a success CONVERTS the escrow: gold, days and materials each move exactly once across queue and resolve", async () => {
  const w = await world();
  const start = measure(w.ann);
  const action = await craft(w);
  const queued = measure(w.ann);
  const outcome = await api.queue.resolve(w.ann, action.id, { degree: "success", chat: true });
  const done = measure(w.ann);
  assert.equal(outcome.status, "resolved");
  assert.equal(done.copper, queued.copper, "resolve takes no gold: the fee was already taken at queue time");
  assert.equal(start.copper - done.copper, 500, "the fee left the purse exactly once");
  assert.deepEqual(done.stash, queued.stash, "no material is taken twice, and none comes back on a success");
  assert.equal(done.freeDays, queued.freeDays, "resolve takes no free days");
  assert.equal(start.totalDays - done.totalDays, 2, "the 2 craft days were spent exactly once");
  assert.equal(done.reservedDays, 0);
  assert.deepEqual(done.items, ["Spider Fang Dagger"], "one item was made");
  assert.deepEqual(pendingOf(w.ann), []);
  assert.equal(api.downtime.state().participants[w.ann.id].spent, 2);
  assert.ok(events().some(t => /^resolved craft: Spider Fang Dagger for Ann: item made; 5 gp fee and 2 day\(s\) spent; no materials returned$/.test(t)), events().join(" | "));
  assert.deepEqual(api.audit.scan(), [], "the ledger agrees: the days were spent through the audit commit");

  // Players are told in plain words, by whisper; the roll detail goes to the GM only.
  assert.equal(env.chat.length, 1, "one message, for the player and the GM; the roll detail is in the GM log, not in a whisper");
  assert.ok(env.chat.every(m => Array.isArray(m.whisper) && m.whisper.length), "no public chat message");
  const toPlayer = env.chat.find(m => m.whisper.includes("u-ann"));
  assert.match(toPlayer.content, /crafts <em>Spider Fang Dagger<\/em>: <strong>Success<\/strong>/);
  assert.match(toPlayer.content, /Station fee: 5 gp \(paid when you queued it\)/);
  assert.doesNotMatch(toPlayer.content, /d100|natural|DC \d|roll/i);
  assert.deepEqual(chatLeaks(env.chat), [], "no message has a loss roll, a chance or a DC");
  assert.ok(gmLog.list({ kind: "craft" }).some(e => e.actorId === w.ann.id && e.detail.recipeId));
});

test("a FAILURE still spends the fee and the days; the roll only decides the item and the per-unit material loss", async () => {
  // blade unit first, then fang: u=0.0 is d100 = 1 (lost, 50% chance), u=0.99 is d100 = 100 (kept)
  for (const [rolls, lost] of [[[0.0, 0.99], { iron: 1, "spider-fang": 0 }], [[0.99, 0.0], { iron: 0, "spider-fang": 1 }], [[0.0, 0.0], { iron: 1, "spider-fang": 1 }], [[0.99, 0.99], { iron: 0, "spider-fang": 0 }]]) {
    const w = await world();
    const start = measure(w.ann);
    const action = await craft(w);
    env.rng = [...rolls];
    const outcome = await resolve(w.ann, action.id, { degree: "failure" });
    const done = measure(w.ann);
    assert.equal(outcome.status, "resolved");
    assert.match(outcome.message, /not made \(failure\)/);
    assert.equal(done.copper, start.copper - 500, `the fee is spent on a failure (${rolls})`);
    assert.equal(start.totalDays - done.totalDays, 2, "and so are the days");
    assert.deepEqual(done.items, [], "no item");
    assert.deepEqual({ iron: start.stash.iron - done.stash.iron, "spider-fang": start.stash["spider-fang"] - done.stash["spider-fang"] }, lost, `per-unit loss for rolls ${rolls}`);
    assert.deepEqual(env.rng, [], "exactly one d100 per unit");
    assert.deepEqual(api.audit.scan(), []);
  }
});

test("a critical failure loses every escrowed unit with no loss rolls; a critical success makes the item", async () => {
  const w = await world();
  const start = measure(w.ann);
  const action = await craft(w);
  env.rng = [0.5, 0.5];
  await resolve(w.ann, action.id, { degree: "criticalFailure" });
  const done = measure(w.ann);
  assert.deepEqual(env.rng, [0.5, 0.5], "no loss rolls were made");
  assert.deepEqual([start.stash.iron - done.stash.iron, start.stash["spider-fang"] - done.stash["spider-fang"], start.copper - done.copper, start.totalDays - done.totalDays], [1, 1, 500, 2]);
  const second = await craft(w);
  await resolve(w.ann, second.id, { degree: "criticalSuccess" });
  assert.deepEqual(measure(w.ann).items, ["Spider Fang Dagger"]);
});

test("a craft against the real PF2e roll path uses the Crafting check's degree", async () => {
  const w = await world();
  const action = await craft(w);
  w.ann.rolls.push({ options: { degreeOfSuccess: 3 }, total: 30, dice: [{ faces: 20, results: [{ result: 15, active: true }] }] });
  const outcome = await api.queue.resolve(w.ann, action.id, { chat: false });
  assert.match(outcome.message, /made \(criticalSuccess\)/);
  assert.equal(w.ann.rollArgs.length, 1);
  assert.equal(w.ann.rollArgs[0].createMessage, false, "PF2e's own chat card is switched off: the roll stays with the GM");
});

test("a queued gather's real roll is also kept off the public chat", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  w.ann.rolls.push({ options: { degreeOfSuccess: 2 }, total: 20, dice: [{ faces: 20, results: [{ result: 15, active: true }] }] });
  const outcome = await api.queue.resolve(w.ann, action.id, { chat: false });
  assert.equal(outcome.status, "resolved");
  assert.equal(w.ann.rollArgs.length, 1);
  assert.equal(w.ann.rollArgs[0].createMessage, false);
});

// CRAFT: refusals ----------------------------------------------------------------------------------------------------
test("refusals are plain, say what is missing, point at the Compendium for shortages, and change NOTHING", async () => {
  const cases = [
    [{ fang: 0 }, {}, /Cannot queue this craft: .*slot "fang": needs 1 Spider Fang but only 0 available\. Nothing can be bought: check the Compendium/],
    [{}, { selection: { blade: "iron" } }, /Cannot queue this craft: slot "fang": no material selected\. Nothing can be bought: check the Compendium/],
    [{}, { selection: { ...SEL, hilt: "iron" } }, /"hilt" is not a slot of this recipe/],
    [{ copper: 400 }, {}, /Ann cannot afford the 5 gp station fee \(has 4 gp\)/],
    [{}, { recipe: "nope" }, /unknown recipe "nope"/]
  ];
  for (const [worldOptions, over, expected] of cases) {
    const w = await world(worldOptions);
    const before = snapshot(w);
    await assert.rejects(craft(w, w.annUser, w.ann, over), expected);
    assert.equal(snapshot(w), before, `${expected}: the refusal changed the world`);
  }
  const w = await world();
  await api.setDays(w.ann, 1);
  const before = snapshot(w);
  await assert.rejects(craft(w), /Not enough free downtime days: this craft takes 2 and Ann has 1 free\./);
  assert.equal(snapshot(w), before);
  await assert.rejects(craft(w, w.bobUser, w.bob), /Bob does not know the formula for "Spider Fang Dagger"/);
  env.values.partyLocation = "nowhere";
  await api.setDays(w.ann, 6);
  await assert.rejects(craft(w), /Cannot queue this craft: .*(station|forge|smithing)/i);
});

test("a craft is refused outside downtime, and for someone who was not there; a GM can override and the ledger says so", async () => {
  const w = await world({ downtime: 0 });
  await api.grantDays(w.ann, 3);
  await assert.rejects(craft(w), /^Error: Downtime isn't open right now$/);
  assert.deepEqual(pendingOf(w.ann), []);
  assert.deepEqual([w.ann.copper, stashOf(w.ann).iron], [2000, 3], "nothing was taken");

  await api.downtime.start({ days: 2, actorIds: [w.bob.id] });
  await assert.rejects(craft(w), /^Error: Downtime is open, but you weren't here for it$/);

  const action = await as(w.gm, () => api.queue.submit(w.ann, "craft", { recipe: DAGGER, selection: SEL }));
  assert.equal(action.daysReserved, 2);
  assert.ok(events().some(t => /^GM override: queued a craft for Ann \(Downtime is open, but you weren't here for it\)$/.test(t)), events().join(" | "));
});

test("the craft-day floor holds through the queue path with stacked reductions: never below 1 day", async () => {
  const { setCraftReductions } = await import("../scripts/queue/work.js");
  try {
    for (const [reductions, days] of [[[], 2], [[1], 1], [[1, 3], 1], [[{ days: 2, source: "forge" }, { days: 2, source: "tools" }, 5], 1]]) {
      const w = await world();
      setCraftReductions(() => reductions);
      const action = await craft(w);
      assert.equal(action.daysReserved, days, JSON.stringify(reductions));
      assert.equal(action.params.escrow.days, days);
      assert.equal(measure(w.ann).reservedDays, days);
      assert.deepEqual(api.audit.scan(), []);
    }
  } finally { setCraftReductions(null); }
  const w = await world();
  await assert.rejects(craft(w, w.annUser, w.ann, {}, 5), /this craft takes 2 day\(s\) \(got 5\); the time is set by the recipe and the station, leave days out/);
  assert.equal((await craft(w, w.annUser, w.ann, {}, 2)).daysReserved, 2, "passing the right number is fine");
  await assert.rejects(as(w.gm, () => api.queue.editDays(w.ann, pendingOf(w.ann)[0].id, 1)), /a craft's time is set by the recipe and the station/);
});

// CRAFT: when it can no longer be made ------------------------------------------------------------------------------------
test("if the party left the station, the craft is INVALID: days, materials and fee all come back", async () => {
  const w = await world();
  const start = measure(w.ann);
  const action = await craft(w);
  env.values.partyLocation = "nowhere";
  const outcome = await resolve(w.ann, action.id);
  assert.equal(outcome.status, "invalid");
  assert.match(outcome.message, /This craft can no longer be made: .*Your days, materials and fee were returned\.$/);
  assert.deepEqual(measure(w.ann), start, "everything is back, once");
  assert.deepEqual(pendingOf(w.ann), []);
  assert.deepEqual(api.audit.scan(), []);
  assert.ok(events().some(t => /^craft could not be resolved for Ann \(This craft can no longer be made/.test(t)));
});

test("if the formula is gone, or the station fee changed, the craft is invalid and returns everything", async () => {
  const w = await world();
  const start = measure(w.ann);
  const first = await craft(w);
  await api.removeFormula(w.ann, DAGGER);
  const gone = await resolve(w.ann, first.id);
  assert.equal(gone.status, "invalid");
  assert.match(gone.message, /does not know the formula/);
  await api.grantFormula(w.ann, DAGGER);
  assert.deepEqual(measure(w.ann), start);

  const second = await craft(w);
  const tampered = clone(pendingOf(w.ann));
  tampered[0].params.escrow.feeCopper = 400;
  await w.ann.update({ [`flags.${M}.pendingActions`]: tampered });
  const changed = await resolve(w.ann, second.id);
  assert.equal(changed.status, "invalid");
  assert.match(changed.message, /The station fee changed from 4 gp to 5 gp since this was queued/);
});

test("a damaged escrow record is an ERROR (the action stays queued, nothing moves) and the audit reports it", async () => {
  const w = await world();
  const action = await craft(w);
  const damaged = clone(pendingOf(w.ann));
  delete damaged[0].params.escrow;
  await w.ann.update({ [`flags.${M}.pendingActions`]: damaged });
  const [row] = api.queue.list();
  assert.match(row.problem, /has no escrow record/);
  const { results } = await api.queue.resolveAll({ chat: false });
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /the escrow on this craft is damaged/);
  assert.equal(pendingOf(w.ann).length, 1, "still queued");
  const audit = api.audit.scan();
  assert.match(audit[0].mismatches.map(m => m.message).join(), /the queued craft "Spider Fang Dagger": a queued craft has no escrow record/);
  await assert.rejects(as(w.gm, () => api.queue.reject(w.ann, action.id, { chat: false })), /cannot return this craft's escrow/);
});

// End downtime ---------------------------------------------------------------------------------------------------------------
test("a queued craft BLOCKS End downtime; a queued gather does not, and it stays resolvable afterwards", async () => {
  const w = await world();
  const { token } = await addNode(w.table, { charges: 3 });
  const action = await craft(w);
  assert.deepEqual(await api.downtime.end(), { blocked: 1 });
  assert.equal(api.downtime.isOpen(), true);

  await as(w.gm, () => api.queue.reject(w.ann, action.id, { chat: false }));
  const g = await gatherCall(w.annUser, w.ann, token, w.table);
  const ended = await api.downtime.end();
  assert.deepEqual([ended.ended, ended.rejected], [true, 0]);
  assert.equal(api.downtime.isOpen(), false);
  assert.equal(api.queue.list().length, 1, "the gather is still queued");
  assert.equal(nodeOf(token).reservedCharges, 1, "and its charge is still claimed");
  const outcome = await resolve(w.ann, g.id);
  assert.equal(outcome.status, "resolved");
  assert.ok((stashOf(w.ann).moonpetal ?? 0) >= 1, "it still works with downtime closed");
  assert.deepEqual(api.audit.scan(), []);
});

test("a forced End downtime returns the craft (escrow included) and leaves the gather queued with its charge claimed", async () => {
  const w = await world();
  const { token } = await addNode(w.table, { charges: 3 });
  const start = measure(w.ann);
  await craft(w);
  const g = await gatherCall(w.annUser, w.ann, token, w.table);
  const ended = await api.downtime.end({ force: true });
  assert.deepEqual([ended.ended, ended.rejected], [true, 1]);
  const after = measure(w.ann);
  assert.deepEqual([after.copper, after.stash], [start.copper, start.stash], "the fee and materials came back");
  assert.equal(after.reservedDays, 0);
  assert.deepEqual(pendingOf(w.ann).map(a => a.id), [g.id]);
  assert.equal(nodeOf(token).reservedCharges, 1);
  assert.deepEqual(api.audit.scan(), []);
});

// Reject / cancel permissions ---------------------------------------------------------------------------------------------
test("the GM can reject a craft and everything comes back (logged as returned by the GM)", async () => {
  const w = await world();
  const start = measure(w.ann);
  const action = await craft(w);
  const result = await as(w.gm, () => api.queue.reject(w.ann, action.id, { chat: false }));
  assert.equal(result.refunded, 2);
  assert.deepEqual(measure(w.ann), start);
  assert.ok(events().some(t => /^craft returned by the GM: Craft: Spider Fang Dagger for Ann; escrow returned/.test(t)));
});

test("another player cannot cancel someone else's queued item, or queue for their character", async () => {
  const w = await world();
  const action = await craft(w);
  const gatherNode = (await addNode(w.table, { charges: 3 })).token;
  const g = await gatherCall(w.annUser, w.ann, gatherNode, w.table);
  const before = snapshot(w);
  await assert.rejects(as(w.bobUser, () => api.queue.cancel(w.ann, action.id)), /cancel: Bob does not own Ann/);
  await assert.rejects(as(w.bobUser, () => api.queue.cancel(w.ann, g.id)), /cancel: Bob does not own Ann/);
  await assert.rejects(craft(w, w.bobUser, w.ann), /submit: Bob does not own Ann|you do not own Ann/);
  await assert.rejects(gatherCall(w.bobUser, w.ann, gatherNode, w.table), /you do not own Ann|does not own Ann/);
  assert.equal(snapshot(w), before, "nothing changed");

  // Even a call that reaches the GM handler directly is checked against the user it names.
  env.relayContext = { socketdata: { userId: "u-bob" } };
  await assert.rejects(as(w.annUser, () => api.queue.cancel(w.ann, action.id)), /cancel: Bob does not own Ann/, "the sender socketlib reports wins over the id in the payload");
  env.relayContext = undefined;
  assert.deepEqual(await env.handlers.get("queueCancel")({ actorId: w.ann.id, actionId: action.id, userId: "u-nobody" }),
    { __relay: "refused", message: 'the GM client does not know the user "u-nobody"' }, "a guarded handler returns the refusal as data");
  assert.equal(snapshot(w), before);

  // The owner can; the handler itself only ever runs on a GM client.
  await as(w.annUser, () => api.queue.cancel(w.ann, action.id));
  assert.equal(pendingOf(w.ann).length, 1);
  // The handler only ever runs on a GM client. Run on a player's client it is a bug, not a refusal: logged, and no message leaks.
  const wrongClient = await loudly(seen => as(w.annUser, () => env.handlers.get("queueCancel")({ actorId: w.ann.id, actionId: g.id, userId: "u-ann" })).then(result => [result, seen]));
  assert.deepEqual(wrongClient[0], { __relay: "failed" });
  assert.match(wrongClient[1].join("\n"), /"queueCancel" socket handler hit an unexpected error/);
});

test("when no GM is connected, or the socket is missing, a player gets a plain message and nothing changes", async () => {
  const w = await world();
  const before = snapshot(w);
  env.noGM = true;
  await assert.rejects(craft(w), /The GM isn't connected right now, so this can't be done yet\./);
  await assert.rejects(as(w.annUser, () => api.queue.cancel(w.ann, "whatever")), /The GM isn't connected right now/);
  env.noGM = false;
  const { _resetSocketForTests } = await import("../scripts/socket.js");
  _resetSocketForTests();
  await assert.rejects(craft(w), /the module's socket is not registered/);
  assert.equal(snapshot(w), before);
});

test("the real wiring registers the relay functions and exposes cancel on the api", async () => {
  await world();
  assert.deepEqual([...env.handlers.keys()].sort(), ["definitionsFor", "queueCancel", "queueSubmit", "researchFollow", "search", "workshopAside", "workshopStart"]);
  assert.equal(typeof api.queue.cancel, "function");
  assert.match(readFileSync("module.json", "utf8"), /"socket": true/);
});

// Fault injection --------------------------------------------------------------------------------------------------------------
test("fault injection: a failure at ANY write while queueing a craft leaves nothing taken and nothing queued", async () => {
  const writes = await everyFailureLeavesNothingHalfDone("queue craft", () => world(), w => craft(w));
  assert.ok(writes >= 5);
});

test("fault injection: a failure at ANY write while queueing a craft with the stacks fully used also leaves nothing half-done", async () => {
  await everyFailureLeavesNothingHalfDone("queue craft, exact stacks", () => world({ iron: 1, fang: 1 }), w => craft(w));
});

test("fault injection: a failure at ANY write while cancelling leaves the craft queued with its escrow still held", async () => {
  await everyFailureLeavesNothingHalfDone("cancel craft",
    async () => { const w = await world({ iron: 1, fang: 1 }); w.action = await craft(w); env.ops = 0; return w; },
    w => as(w.annUser, () => api.queue.cancel(w.ann, w.action.id)));
});

test("fault injection: a failure at ANY write while resolving a craft leaves it queued, escrow held, no item made", async () => {
  await everyFailureLeavesNothingHalfDone("resolve craft success",
    async () => { const w = await world(); w.action = await craft(w); env.ops = 0; return w; },
    w => resolve(w.ann, w.action.id, { degree: "success" }));
  await everyFailureLeavesNothingHalfDone("resolve craft failure",
    async () => { const w = await world(); w.action = await craft(w); env.ops = 0; env.rng = [0.99, 0.99]; return w; },
    w => resolve(w.ann, w.action.id, { degree: "failure" }));
});

// GATHER ----------------------------------------------------------------------------------------------------------------------
test("a gather needs NO downtime: it claims one charge, costs no days, and the row says so", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  assert.equal(api.downtime.isOpen(), false);
  await assert.rejects(gatherCall(w.annUser, w.ann, token, w.table, { skill: undefined }), /allow several skills \(nature, survival\)/);
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  assert.deepEqual([action.type, action.daysReserved, action.params.skill, action.params.nodeName], ["gather", 0, "nature", "Herb Patch"]);
  assert.equal(nodeOf(token).reservedCharges, 1);
  assert.equal(nodeOf(token).charges, 3, "a claim is not a spent charge");
  assert.equal(measure(w.ann).totalDays, 0);
  const [row] = api.queue.list();
  assert.equal(row.label, "Gather: Herb Patch");
  assert.match(row.detail, /Herb Patch|herb|Herb/i);
  assert.match(row.detail, /1 charge claimed, no days/);
  assert.doesNotMatch(row.detail, /%|DC|odds|chance/i);
  assert.ok(events().some(t => /^queued gather: Ann at Herb Patch \(The Table\); 1 charge reserved \(1 of 3 claimed\)$/.test(t)), events().join(" | "));
  assert.deepEqual(api.audit.scan(), []);
});

test("cancelling a queued gather gives the charge back and leaves the node exactly as it was", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  const original = nodeOf(token);
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  const result = await as(w.annUser, () => api.queue.cancel(w.ann, action.id));
  assert.match(result.returned, /1 charge released on Herb Patch/);
  assert.deepEqual(nodeOf(token), original, "no stray reservedCharges key either");
  assert.deepEqual(pendingOf(w.ann), []);
  assert.ok(events().some(t => /^gather cancelled by Ann: Gather: Herb Patch for Ann; 1 charge released on Herb Patch$/.test(t)));
  assert.deepEqual(api.audit.scan(), []);
});

test("resolving a gather rolls the yield, adds the materials, spends the claimed charge, and tells only the owner and GM", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  const outcome = await api.queue.resolve(w.ann, action.id, { degree: "success", chat: true });
  assert.equal(outcome.status, "resolved");
  assert.ok(stashOf(w.ann).moonpetal >= 1 && stashOf(w.ann).moonpetal <= 4, "the guaranteed 1d4 base rung");
  const record = nodeOf(token);
  assert.deepEqual([record.charges, record.state, "reservedCharges" in record], [2, "active", false]);
  assert.deepEqual(pendingOf(w.ann), []);
  assert.deepEqual(measure(w.ann).totalDays, 0, "no days were touched");
  assert.deepEqual(api.downtime.state().participants, {}, "and no spent-days bookkeeping");
  assert.ok(events().some(t => /^resolved gather: Ann at Herb Patch: .*gathered; 1 charge spent$/.test(t)), events().join(" | "));
  assert.ok(env.chat.every(m => Array.isArray(m.whisper)), "no public message");
  const toPlayer = env.chat.find(m => m.whisper.includes("u-ann"));
  assert.match(toPlayer.content, /gathers from <em>Herb Patch<\/em>/);
  assert.doesNotMatch(toPlayer.content, /d20|DC|rung|natural/i);
  assert.deepEqual(chatLeaks(env.chat), [], "no message has a rung roll or a DC");
  assert.ok(gmLog.list({ kind: "gather" }).some(e => /vs DC|hidden rung rolls none/.test(e.text)), "the GM log has them");
  assert.deepEqual(api.audit.scan(), []);
  void w.bobUser;
});

test("a failed gather finds nothing but still spends the charge", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  const outcome = await resolve(w.ann, action.id, { degree: "failure" });
  assert.match(outcome.message, /^found nothing; 2 charge\(s\) left\.$/);
  assert.deepEqual(stashOf(w.ann), { iron: 3, "spider-fang": 3 });
  assert.equal(nodeOf(token).charges, 2);
});

test("the last charge DELETES the node token; only a small depleted record stays, the anchor stays occupied, nothing respawns", async () => {
  const w = await world({ downtime: 0 });
  const { token, anchor } = await addNode(w.table, { charges: 1 }, { withAnchor: true });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  const outcome = await resolve(w.ann, action.id);
  assert.match(outcome.message, /the node is depleted and gone\.$/);
  assert.equal(w.table.tokens.get(token.id), undefined, "the node token is deleted");
  assert.equal(w.table.tokens.filter(t => t.getFlag(M, "node") && t.getFlag(M, "node").state !== "anchor").length, 0, "no hidden or depleted token is left behind");
  const { sceneState } = await import("../scripts/exploration/store.js");
  const [depleted] = sceneState(w.table.id).depleted;
  assert.deepEqual({ ...depleted, at: 0 }, { tokenId: token.id, name: "Herb Patch", nodeType: "herb", tier: 1, anchorId: anchor.id, by: "Ann", at: 0 });
  assert.equal(anchor.getFlag(M, "node").occupiedBy, token.id, "the anchor stays occupied: no respawn");
  assert.ok(events().some(t => /the node is depleted and its token was deleted$/.test(t)));
  assert.deepEqual(api.audit.scan(), []);

  // Clear map counts the depleted record, frees the anchor, and resets the scene state.
  const cleared = await as(w.gm, () => api.clearMap(w.table));
  assert.deepEqual({ removed: cleared.removed, depletedCleared: cleared.depletedCleared, orphanedGathers: cleared.orphanedGathers }, { removed: 0, depletedCleared: 1, orphanedGathers: 0 });
  assert.equal(anchor.getFlag(M, "node").occupiedBy, undefined);
  assert.deepEqual(sceneState(w.table.id).depleted, []);
});

test("a hand-made node (not placed by an expedition) is NOT deleted when it runs dry: it stays as a depleted token", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { source: "placed", charges: 1 }, { actorId: "someone-elses-token" });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  await resolve(w.ann, action.id);
  assert.ok(w.table.tokens.get(token.id), "the GM's own token is not deleted");
  assert.deepEqual([nodeOf(token).state, nodeOf(token).charges], ["depleted", 0]);
  const { sceneState } = await import("../scripts/exploration/store.js");
  assert.deepEqual(sceneState(w.table.id).depleted, []);
  assert.deepEqual(api.audit.scan(), []);
});

test("if the depleted token cannot be deleted, the node stays as a depleted token and the gather still counts", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 1 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  env.failLabel = "scene.deleteEmbeddedDocuments";
  const outcome = await loudly(() => resolve(w.ann, action.id));
  assert.equal(outcome.status, "resolved");
  assert.ok(w.table.tokens.get(token.id));
  assert.equal(nodeOf(token).state, "depleted");
  const { sceneState } = await import("../scripts/exploration/store.js");
  assert.deepEqual(sceneState(w.table.id).depleted, [], "the record was taken back with the failed delete");
  assert.deepEqual(pendingOf(w.ann), []);
});

test("two players cannot take the same last charge: exactly one queues, the other is told it is claimed", async () => {
  const w = await world({ downtime: 0 });
  await api.giveMaterial(w.bob, "iron", 1);
  w.other.tokens.pop();
  w.table.tokens.push(makeToken({ name: "Bob", actorId: w.bob.id }));
  const { token } = await addNode(w.table, { charges: 1 });
  const settled = await Promise.allSettled([gatherCall(w.annUser, w.ann, token, w.table), gatherCall(w.bobUser, w.bob, token, w.table)]);
  assert.deepEqual(settled.map(s => s.status).sort(), ["fulfilled", "rejected"]);
  const refused = settled.find(s => s.status === "rejected");
  assert.match(refused.reason.message, /Herb Patch has no free charge left: every charge it has is already claimed by a queued gather/);
  assert.equal(nodeOf(token).reservedCharges, 1);
  assert.equal(pendingOf(w.ann).length + pendingOf(w.bob).length, 1);
  assert.deepEqual(api.audit.scan(), []);
});

test("three simultaneous gathers on a 2-charge node: two queue, one is refused, and resolving both in parallel spends both exactly once", async () => {
  const w = await world({ downtime: 0 });
  w.other.tokens.pop();
  w.table.tokens.push(makeToken({ name: "Bob", actorId: w.bob.id }));
  const { token } = await addNode(w.table, { charges: 2 }, { withAnchor: true });
  const settled = await Promise.allSettled([
    gatherCall(w.annUser, w.ann, token, w.table), gatherCall(w.bobUser, w.bob, token, w.table), gatherCall(w.annUser, w.ann, token, w.table)
  ]);
  assert.equal(settled.filter(s => s.status === "fulfilled").length, 2);
  assert.equal(nodeOf(token).reservedCharges, 2);
  assert.deepEqual(api.audit.scan(), []);
  const queued = api.queue.list();
  const results = await Promise.all(queued.map(row => resolve(game.actors.get(row.actorId), row.action.id)));
  assert.deepEqual(results.map(r => r.status), ["resolved", "resolved"]);
  assert.equal(w.table.tokens.get(token.id), undefined, "the second one spent the last charge and removed the node");
  const total = Object.values(w.ann.items.concat(w.bob.items).reduce((m, i) => { const id = i.getFlag(M, "material")?.materialId; if (id === "moonpetal") m.n = (m.n ?? 0) + i.system.quantity; return m; }, {}))[0];
  assert.ok(total >= 2, "each of the two gathers produced at least the guaranteed rung");
  assert.deepEqual(api.audit.scan(), []);
});

test("a gather is refused, in plain words, for a node that is hidden, an anchor, depleted, missing, on another scene, or a character who is not there", async () => {
  const w = await world({ downtime: 0 });
  const hidden = (await addNode(w.table, { revealed: false })).token;
  const depleted = (await addNode(w.table, { state: "depleted", charges: 0, source: "placed" })).token;
  const [anchor] = await w.table.createEmbeddedDocuments("Token", [{ name: "Anchor", flags: { [M]: { node: { source: "placed", state: "anchor", discoveredBy: [] } } } }]);
  const fine = (await addNode(w.table, { charges: 2 })).token;
  const before = snapshot(w);
  await assert.rejects(gatherCall(w.annUser, w.ann, hidden, w.table), /Herb Patch has not been found yet/);
  await assert.rejects(gatherCall(w.annUser, w.ann, depleted, w.table), /Herb Patch is depleted/);
  await assert.rejects(gatherCall(w.annUser, w.ann, anchor, w.table), /Anchor is not a node you can gather from/);
  await assert.rejects(gatherCall(w.annUser, w.ann, { id: "nope" }, w.table), /That node isn't there \(any more\)\./);
  await assert.rejects(gatherCall(w.bobUser, w.bob, fine, w.table), /Bob needs a token on the scene to gather there\./);
  await assert.rejects(gatherCall(w.annUser, w.ann, fine, w.table, { skill: "athletics" }), /skill "athletics" is not allowed for Herb Patch nodes/);
  await assert.rejects(gatherCall(w.annUser, w.ann, fine, w.table, {}, 1), /gathering costs charges, not days \(got 1\)/);
  await assert.rejects(as(w.annUser, () => api.queue.submit(w.ann, "gather", {}, 0)), /say which node/);
  assert.equal(snapshot(w), before, "no refusal changed anything");
});

test("Clear map while gathers are waiting: it reports how many were orphaned, and they resolve as invalid with nothing left claimed", async () => {
  const w = await world({ downtime: 0 });
  w.other.tokens.pop();
  w.table.tokens.push(makeToken({ name: "Bob", actorId: w.bob.id }));
  const dying = (await addNode(w.table, { charges: 3 }, { withAnchor: true })).token;
  const handMade = (await addNode(w.table, { source: "placed", charges: 3 }, { actorId: "someone-elses-token", name: "My Own Node" })).token;
  const a = await gatherCall(w.annUser, w.ann, dying, w.table);
  const b = await gatherCall(w.bobUser, w.bob, dying, w.table);
  const c = await gatherCall(w.annUser, w.ann, handMade, w.table);
  const cleared = await as(w.gm, () => api.clearMap(w.table));
  assert.equal(cleared.orphanedGathers, 2, "only the gathers aimed at deleted nodes");
  assert.equal(w.table.tokens.get(dying.id), undefined);
  assert.equal(nodeOf(handMade).reservedCharges, 1, "the hand-made node keeps its claim");
  assert.deepEqual(api.audit.scan(), [], "a gather aimed at a node that is gone is not a mismatch");

  const { results } = await api.queue.resolveAll({ chat: false, degree: "success" });
  const byId = Object.fromEntries(results.map(r => [r.actionId, r]));
  assert.deepEqual([byId[a.id].status, byId[b.id].status, byId[c.id].status], ["invalid", "invalid", "resolved"]);
  assert.match(byId[a.id].message, /Herb Patch is gone \(the map was cleared\), so there is nothing to gather\. Nothing was spent\.$/);
  assert.deepEqual([pendingOf(w.ann), pendingOf(w.bob)], [[], []]);
  assert.deepEqual(api.audit.scan(), []);
});

test("a gather whose character left the scene is invalid, and its claimed charge is released", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  await w.table.deleteEmbeddedDocuments("Token", [w.table.tokens.find(t => t.actorId === w.ann.id).id]);
  const outcome = await resolve(w.ann, action.id);
  assert.equal(outcome.status, "invalid");
  assert.match(outcome.message, /Ann is no longer on the scene with Herb Patch\. Nothing was spent\.$/);
  assert.equal("reservedCharges" in nodeOf(token), false);
  assert.deepEqual(api.audit.scan(), []);
});

test("fault injection: a failure at ANY write while queueing, cancelling or resolving a gather leaves nothing half-done", async () => {
  const build = async (queued) => {
    const w = await world({ downtime: 0 });
    const made = await addNode(w.table, { charges: 2 }, { withAnchor: true });
    w.token = made.token;
    if (queued) { w.action = await gatherCall(w.annUser, w.ann, w.token, w.table); }
    env.ops = 0;
    return w;
  };
  await everyFailureLeavesNothingHalfDone("queue gather", () => build(false), w => gatherCall(w.annUser, w.ann, w.token, w.table), 3);
  await everyFailureLeavesNothingHalfDone("cancel gather", () => build(true), w => as(w.annUser, () => api.queue.cancel(w.ann, w.action.id)), 3);
  await everyFailureLeavesNothingHalfDone("resolve gather", () => build(true), w => resolve(w.ann, w.action.id));
});

// Audit ----------------------------------------------------------------------------------------------------------------------
test("the audit scan finds a node whose claims do not match the queue (a leaked or a forged claim)", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  await gatherCall(w.annUser, w.ann, token, w.table);
  assert.deepEqual(api.audit.scan(), []);

  await token.setFlag(M, "node", { ...nodeOf(token), reservedCharges: 2 });
  let [row] = api.audit.scan();
  assert.equal(row.node, true);
  assert.equal(row.actorId, null);
  assert.equal(row.name, "Herb Patch on The Table");
  assert.equal(row.mismatches[0].message, "has 2 charge(s) claimed, but 1 gather(s) are queued for it");

  await token.setFlag(M, "node", { ...nodeOf(token), reservedCharges: 1 });
  await w.ann.update({ [`flags.${M}.pendingActions`]: [] });   // the gather vanished without giving its claim back
  [row] = api.audit.scan();
  assert.equal(row.mismatches[0].message, "has 1 charge(s) claimed, but 0 gather(s) are queued for it");
});

test("the review window's audit section has no 'Accept' button for a node row (there is no actor to accept)", async () => {
  const { renderReview } = await import("../scripts/queue/review.js");
  const html = renderReview({ rows: [], audit: [{ actorId: null, node: true, name: "Herb Patch on The Table", history: [], mismatches: [{ kind: "nodeReservation", message: "x" }] }] });
  assert.match(html, /Herb Patch on The Table/);
  assert.doesNotMatch(html, /data-action="accept"/);
});

// Mixed queue ------------------------------------------------------------------------------------------------------------------
test("Resolve all handles a craft and a gather in one batch, in submission order, each on its own", async () => {
  const w = await world();
  const { token } = await addNode(w.table, { charges: 3 });
  const c = await craft(w);
  const g = await gatherCall(w.annUser, w.ann, token, w.table);
  const batch = await api.queue.resolveAll({ chat: false, degree: "success" });
  assert.deepEqual(batch.results.map(r => [r.actionId, r.status]), [[c.id, "resolved"], [g.id, "resolved"]]);
  assert.deepEqual(pendingOf(w.ann), []);
  assert.deepEqual(api.audit.scan(), []);
});

test("a GM queuing a gather needs no override; the world events record the rest of the story in order", async () => {
  const w = await world({ downtime: 0 });
  const { token } = await addNode(w.table, { charges: 3 });
  await as(w.gm, () => api.queue.submit(w.ann, "gather", { sceneId: w.table.id, tokenId: token.id, skill: "nature" }));
  assert.ok(!events().some(t => /GM override/.test(t)));
});

// Players see no odds or hidden results ---------------------------------------------------------------------------------------
test("nothing a player can read holds odds or hidden results: the queued actions, the rows, and the preview tools", async () => {
  const w = await world();
  const { token } = await addNode(w.table, { charges: 3 });
  const c = await craft(w);
  await gatherCall(w.annUser, w.ann, token, w.table);
  const stored = JSON.stringify(pendingOf(w.ann));
  assert.doesNotMatch(stored, /"dc"|odds|chance|lossRolls|natural|hidden/i);
  assert.equal(c.params.escrow.units.length, 2);
  for (const row of api.queue.list()) assert.doesNotMatch(`${row.label} ${row.detail}`, /%|\bDC\b|odds|chance/i);
  await assert.rejects(as(w.annUser, async () => api.previewGather(w.ann, token, "nature")), /GM only/);
  await assert.rejects(as(w.annUser, async () => api.nodeInfo(token)), /GM only/);
  await assert.rejects(as(w.annUser, async () => api.previewExplore(w.ann, "oak-wood")), /GM only/);
  assert.equal(typeof (await as(w.gm, async () => api.previewGather(w.ann, token, "nature"))).ok, "boolean", "the GM still can");
});

test("the source never uses the removed '-=' update syntax (ForcedDeletion only), including the new files", () => {
  for (const file of ["scripts/queue/work.js", "scripts/queue/escrow.js", "scripts/queue/lock.js", "scripts/gathering/reserve.js", "scripts/queue/store.js", "scripts/exploration/store.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /["'`]-=/, `${file} uses a "-=" key`);
  }
});

// The gate checklist (docs/13-stage10a-gate.md): every block is run, in order, as the right client ---------------------------
const gateDoc = readFileSync("docs/13-stage10a-gate.md", "utf8");
// The docs/13 gate asks for the version it shipped with; the block itself just reports the installed one, so the test compares with module.json.
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2], code: block?.[1] ?? null });
}
const gateStepCount = [...GATE.keys()].length;

/** Run a block like a browser console would: top-level await is wrapped, the last expression is the value. */
function runBlock(step, user) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/13-stage10a-gate.md needs a code block in Step ${step}`);
  const code = entry.code.replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  return als.run({ user }, () => (0, eval)(code));
}
const gateWorld = options => world({ downtime: 0, iron: 0, fang: 0, ...options });

test("the gate checklist has exactly one code block per step, and every step says who runs it", () => {
  assert.equal(gateStepCount, 25);
  for (const [step, { who, code }] of GATE) {
    assert.match(who, /^\[(GM|Player)\]( and \[(GM|Player)\])?$/, `step ${step}`);
    assert.ok(code, `step ${step} needs its code block`);
  }
  for (const step of [8, 10, 12, 21, 23]) assert.match(GATE.get(step).who, /Player/);
  for (const step of [8, 10, 12]) assert.equal(GATE.get(step).code, GATE.get(4).code, `step ${step} repeats step 4's block exactly`);
  assert.match(gateDoc, /game\.user\.name, game\.user\.isGM/);
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /version must be \*\*0\.14\.1\*\*/);
});

test("GATE: every step runs, in order, as the right client, and reports ALL PASS", async () => {
  const w = await gateWorld();
  const { gm, testUser } = users;
  const annBefore = snapshot(w);
  await quietly(async () => {
    assert.deepEqual(await runBlock(1, gm), ["GM", true, MODULE_VERSION]);
    assert.deepEqual(await runBlock(1, testUser), ["Test", false, MODULE_VERSION]);

    const setup = await runBlock(2, gm);
    assert.deepEqual(setup.baseline, { gold: 20, ore: 8, free: 6, reserved: 0, items: [] });
    assert.deepEqual([setup.hero, setup.away, setup.scene, setup.testUsersCharacter], ["Gate Hero", "Gate Absent", "Gate Scene", "Gate Hero"]);
    assert.deepEqual(await runBlock(3, testUser), { gold: 20, ore: 8, free: 6, reserved: 0, queued: [] });

    const run = async (step, user) => assert.equal(await runBlock(step, user), "ALL PASS", `step ${step} did not report ALL PASS`);
    const reloadGMWindow = async () => {        // a reload wipes the memory-only definitions and the helper
      api.definitions = makeRegistry(); delete globalThis.__gate;
      const again = await runBlock(2, gm);
      assert.match(again.already, /set up/);
      assert.deepEqual(again.baseline, { gold: 20, ore: 8, free: 6, reserved: 0, items: [] }, "the saved baseline, not today's numbers");
      assert.ok(api.definitions.recipe.has("gate-blade") && globalThis.__gate, "the definitions and the helper are back");
    };
    for (const [step, user] of [[4, testUser], [5, gm], [6, testUser], [7, testUser], [8, testUser], [9, gm], [10, testUser], [11, gm], [12, testUser], [13, gm],
      [14, testUser], [15, testUser], [16, gm], [17, gm], [18, testUser], [19, gm], [20, gm]]) {
      if (step === 9 || step === 20) await reloadGMWindow();    // before the first GM resolve, and after a node was deleted
      await run(step, user);
    }
    await run(21, testUser);
    await run(22, gm);
    await run(23, testUser);
    await run(24, gm);

    const cleanup = await runBlock(25, gm);
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, sceneLeft: false, downtimeOpen: false, testUsersCharacter: null, audit: [] });
  });
  // Everything the gate changed is back; nothing of Ann's or Bob's was touched.
  assert.equal(game.scenes.getName("Gate Scene"), undefined);
  assert.equal(game.actors.getName("Gate Hero"), undefined);
  assert.equal(env.values.partyLocation, "oakhaven", "the party location is put back");
  assert.deepEqual(env.values.downtime, {});
  assert.equal(api.definitions.recipe.has("gate-blade") || api.definitions.material.has("gate-ore") || api.definitions.town.has("gate-town") || api.definitions.nodeType.has("gate-patch") || api.definitions.station.has("gate-bench"), false, "the fake definitions are removed");
  assert.ok(!events().some(t => /Gate (Hero|Absent|Patch|Blade)/.test(t)), "the world events that name the gate things are gone");
  assert.deepEqual(Object.keys(env.values.auditLedger).filter(k => k !== "_events" && !/^actor/.test(k)), []);
  assert.deepEqual(measure(w.ann), { copper: 2000, stash: {}, freeDays: 0, reservedDays: 0, totalDays: 0, items: [] });
  void annBefore;
  assert.equal(globalThis.__gate, undefined, "the GM helper is removed by CLEANUP");
  delete globalThis.__p; // the Player window removes its own helper
});

test("GATE: SETUP refuses to run against real data, changing nothing", async () => {
  for (const [label, prepare, expected] of [
    ["downtime open", async w => { await api.downtime.start({ days: 2, actorIds: [w.ann.id] }); }, /downtime is already open/],
    ["a queued action", async w => { await api.grantDays(w.ann, 2); await as(w.annUser, () => api.queue.submit(w.ann, "research", { projectId: "none" }, 1)).catch(() => {}); await w.ann.update({ [`flags.${M}.pendingActions`]: [{ id: "q", type: "commission", params: { step: "cancel", id: "x" }, daysReserved: 0, submittedAt: 1 }] }); }, /the queue is not empty/],
    ["downtime days held", async w => { await api.grantDays(w.bob, 3); }, /these characters hold downtime days: Bob/],
    ["a real actor with the same name", async w => { w.bob.name = "Gate Hero"; }, /already exists and was not made by this check/]
  ]) {
    const w = await gateWorld();
    await prepare(w);
    const before = snapshot(w);
    await quietly(async () => assert.rejects(Promise.resolve(runBlock(2, users.gm)), expected, label));
    assert.equal(snapshot(w).replace(/"name":"Gate Hero"/g, ""), before.replace(/"name":"Gate Hero"/g, ""), `${label}: SETUP changed something`);
    assert.equal(game.scenes.getName("Gate Scene"), undefined, label);
  }
});

test("GATE: SETUP can be run twice, and CLEANUP works from the middle of the gate, after a failed step", async () => {
  const w = await gateWorld();
  await quietly(async () => {
    await runBlock(2, users.gm);
    const again = await runBlock(2, users.gm);
    assert.match(again.already, /set up/);
    assert.equal(game.actors.filter(a => a.name === "Gate Hero").length, 1);
    await runBlock(3, users.testUser);
    assert.equal(await runBlock(4, users.testUser), "ALL PASS");       // a craft is queued with its escrow taken
    await runBlock(15, users.testUser).catch(() => {});                  // a gather too (step 15 may complain; it does not matter here)
    const cleanup = await runBlock(25, users.gm);                      // cleanup straight from there
    assert.deepEqual(cleanup, { problems: [], actorsLeft: 0, sceneLeft: false, downtimeOpen: false, testUsersCharacter: null, audit: [] });
    const second = await runBlock(25, users.gm);
    assert.deepEqual(second.problems, [], "cleanup is safe to run twice");
  });
  assert.equal(env.values.partyLocation, "oakhaven");
  assert.deepEqual(measure(w.ann).copper, 2000);
});

test("GATE: CLEANUP leaves a REAL open downtime period alone", async () => {
  const w = await gateWorld();
  await quietly(async () => {
    await runBlock(2, users.gm);
    const real = game.actors.getName("Gate Hero");
    void real;
    await api.downtime.end({ force: true });
    await api.downtime.start({ days: 3, actorIds: [w.ann.id] });
    const cleanup = await runBlock(25, users.gm);
    assert.match(cleanup.problems.join(), /a real period is open, so it was left alone/);
  });
  assert.equal(api.downtime.isOpen(), true);
  assert.equal(api.downtime.state().participants[w.ann.id].granted, 3);
});

// The relay: refusals travel as data (real socketlib hides the message of anything a handler throws) -------------------------
const GENERIC_SOCKETLIB = /An exception occured during remote execution of handler/;

test("RELAY: guard() and unwrap() turn only Refusals into plain messages and everything else into one generic line", async () => {
  const quiet = await loudly(async seen => {
    const refuses = guard("t", async () => { throw refusal("Downtime isn't open right now"); });
    const breaks = guard("t", async () => { throw new Error("secret detail"); });
    const fine = guard("t", async () => ({ ok: 1 }));
    assert.deepEqual(await refuses(), { __relay: "refused", message: "Downtime isn't open right now" });
    assert.deepEqual(await breaks(), { __relay: "failed" });
    assert.deepEqual(await fine(), { ok: 1 });
    assert.throws(() => unwrap({ __relay: "refused", message: "Downtime isn't open right now" }), /^Error: Downtime isn't open right now$/);
    assert.throws(() => unwrap({ __relay: "failed" }), new RegExp(`^Error: ${GENERIC_FAILURE}$`));
    assert.deepEqual(unwrap({ ok: 1 }), { ok: 1 });
    assert.equal(unwrap(undefined), undefined);
    return seen;
  });
  assert.equal(quiet.length, 1, "only the unexpected error was logged");
  assert.match(quiet[0], /"t" socket handler hit an unexpected error/);
  assert.equal(refusal("x") instanceof Refusal && refusal("x") instanceof Error, true);
  assert.equal(GENERIC_FAILURE, "Something went wrong; tell the GM.");
});

test("RELAY: the module registers exactly the handlers we know about, and every one is guarded", async () => {
  await world();
  assert.deepEqual([...env.handlers.keys()].sort(), ["definitionsFor", "queueCancel", "queueSubmit", "researchFollow", "search", "workshopAside", "workshopStart"]);
  const source = readFileSync("scripts/socket.js", "utf8");
  const registers = source.split("\n").filter(line => /\.register\("/.test(line));
  assert.equal(registers.length, 7);
  for (const line of registers) assert.match(line, /register\("\w+", guard\("\w+",/, `an unguarded handler: ${line.trim()}`);
  // every file that relays through the socket unwraps what comes back
  for (const file of ["scripts/queue/work.js", "scripts/exploration/store.js"]) {
    const text = readFileSync(file, "utf8");
    assert.ok(/executeAsGM\(/.test(text) && /unwrap\(/.test(text), `${file} relays and must unwrap`);
  }
});

test("RELAY: walking every registered handler with refusals, nonsense and bugs: none of them ever throws", async () => {
  const w = await world();
  const payloads = [undefined, null, 7, "text", {}, { userId: "gm1" }, { userId: "nobody", actorId: w.ann.id, actionId: "x" },
    { userId: "u-bob", actorId: w.ann.id, actionId: "x", type: "craft", params: { recipe: "nope" } },
    { userId: "u-ann", actorId: "no-such-actor", actionId: "x", type: "gather", params: {} },
    { userId: "u-ann", actorId: w.ann.id, sceneId: "no-scene", type: "craft", params: null }];
  let results = 0;
  await loudly(async () => {
    for (const name of [...env.handlers.keys()]) {
      for (const payload of payloads) for (const user of [users.gm, w.annUser]) {
        const result = await als.run({ user }, () => env.handlers.get(name).call(undefined, payload));   // must not throw
        results++;
        assert.ok(result === undefined || typeof result === "object" || typeof result === "string", `${name} returned something odd`);
        if (result?.__relay) assert.ok(["refused", "failed"].includes(result.__relay));
      }
    }
  });
  assert.equal(results, 7 * payloads.length * 2);
  assert.deepEqual(env.handlerThrows, []);
});

test("RELAY: a refusal reaches a NON-GM client as the real plain message; the same call by a GM (no relay) throws that same message", async () => {
  const w = await world();                                   // downtime open
  const notGeneric = error => error instanceof Error && !GENERIC_SOCKETLIB.test(error.message) && error.message !== GENERIC_FAILURE;
  // Each case: [how a player's client asks (relayed), how a GM asks directly (no relay), the message both must get].
  const cases = [
    [() => craft(w, w.annUser, w.ann, { recipe: "nope" }), () => craft(w, w.gm, w.ann, { recipe: "nope" }), 'craft: unknown recipe "nope"'],
    [() => as(w.annUser, () => api.queue.cancel(w.ann, "no-id")), () => as(w.gm, () => api.queue.cancel(w.ann, "no-id")), 'Ann has no queued action "no-id"'],
    [() => as(w.bobUser, () => api.queue.cancel(w.ann, "no-id")), () => as(w.bobUser, () => api.queue.cancel(w.ann, "no-id")), "cancel: Bob does not own Ann"],
    [() => craft(w, w.annUser, w.ann, {}, 5), () => craft(w, w.gm, w.ann, {}, 5), "craft: this craft takes 2 day(s) (got 5); the time is set by the recipe and the station, leave days out"]
  ];
  for (const [viaRelay, direct, message] of cases) {
    await assert.rejects(viaRelay(), error => error.message === message && notGeneric(error), `relayed: ${message}`);
    await assert.rejects(direct(), error => error.message === message && error instanceof Error, `direct: ${message}`);
  }
  assert.deepEqual(env.handlerThrows, [], "no refusal was thrown out of a handler (the real socketlib would have hidden it)");

  // Downtime closed: the player is refused with the plain message; a GM going around the gate is not refused, and no handler ran for the direct calls.
  const closed = await world({ downtime: 0 });
  await api.grantDays(closed.ann, 3);
  await assert.rejects(craft(closed), error => error.message === "Downtime isn't open right now" && notGeneric(error));
  const queuedByGM = await craft(closed, closed.gm);
  assert.equal(queuedByGM.type, "craft", "a GM is not refused, exactly as before");
  assert.deepEqual(env.handlerThrows, []);
});

test("RELAY: an unexpected exception is logged on the GM, the player sees ONE generic line, and a GM calling directly still gets the real error", async () => {
  const w = await world();
  const realGet = api.definitions.recipe.get.bind(api.definitions.recipe);
  api.definitions.recipe.get = () => { throw new TypeError("kaboom in a pure helper"); };
  try {
    const [error, logged] = await loudly(seen => assert.rejects(craft(w), e => e).catch(e => e).then(() => craft(w).catch(e => e)).then(e => [e, seen]));
    assert.equal(error.message, GENERIC_FAILURE);
    assert.doesNotMatch(error.message, /kaboom/);
    assert.ok(logged.some(l => /"queueSubmit" socket handler hit an unexpected error/.test(l)), "logged on the GM");
    assert.deepEqual(env.handlerThrows, [], "the handler did not throw through socketlib: the player got our line, not socketlib's");
    const direct = await craft(w, w.gm).catch(e => e);
    assert.match(direct.message, /kaboom in a pure helper/, "no relay: the GM gets the original error, exactly as before");
  } finally { api.definitions.recipe.get = realGet; }
  assert.equal(measure(w.ann).reservedDays, 0);
});

test("RELAY: a plain Error from a pure helper is NOT shown to players, even when its text looks friendly", async () => {
  const w = await world();
  const original = w.ann.items.get;
  w.ann.items.get = () => undefined;       // the stack vanishes between the check and the take: "<name> no longer has that stack of materials"
  let error;
  try { error = await loudly(() => craft(w).catch(e => e)); } finally { w.ann.items.get = original; }
  assert.equal(error.message, GENERIC_FAILURE);
  assert.equal(measure(w.ann).copper, 2000);
});

test("RELAY: fault injection through the relay: whatever write fails, the player gets the generic line and the world is unchanged", async () => {
  const messages = [];
  const writes = await everyFailureLeavesNothingHalfDone("queue craft via the relay", () => world(), async w => {
    try { await craft(w); } catch (error) { messages.push(error.message); throw error; }
  });
  assert.ok(writes >= 5);
  assert.ok(messages.length >= 4);
  assert.deepEqual([...new Set(messages)], [GENERIC_FAILURE], "an unexpected failure is never shown as anything but the generic line");
  assert.deepEqual(env.handlerThrows, []);
});

test("RELAY: the search handler: its messages arrive as data, and a bug in it gives the generic line (not socketlib's)", async () => {
  const w = await world({ downtime: 0 });
  canvas.scene = w.table;
  w.ann.perceptionRolls.push({ total: 12, dice: [{ faces: 20, results: [{ result: 7, active: true }] }], options: {} });
  const found = await as(w.annUser, () => api.searchArea(w.ann));
  assert.match(found.message, /^You search the area\./);
  const again = await as(w.annUser, () => api.searchArea(w.ann));
  assert.equal(again.message, "You have already searched this area.");
  await assert.rejects(as(w.bobUser, () => api.searchArea(w.ann)), /^Error: You can only search with a character you own\.$/);
  const w2 = await world({ downtime: 0 });
  canvas.scene = w2.table;
  w2.ann.perception = undefined;          // a bug: no Perception check to roll
  const [error] = await loudly(seen => as(w2.annUser, () => api.searchArea(w2.ann)).catch(e => [e, seen]));
  assert.equal(error.message, GENERIC_FAILURE);
  assert.deepEqual(env.handlerThrows, []);
});

// Every refusal message the gate checks, driven through the realistic fake socketlib as the NON-GM user "Test" ------------------
test("GATE refusals: the player receives each real plain message (steps 6, 7, 14, 18), never socketlib's generic text", async () => {
  await gateWorld();
  const { gm, testUser } = users;
  await quietly(async () => {
    await runBlock(2, gm);
    const hero = game.actors.getName("Gate Hero"), away = game.actors.getName("Gate Absent"), scene = game.scenes.getName("Gate Scene");
    const asTest = fn => as(testUser, fn);
    const refused = async (fn, expected) => {
      const error = await asTest(fn).then(() => null, e => e);
      assert.ok(error, `expected a refusal: ${expected}`);
      assert.ok(typeof expected === "string" ? error.message === expected : expected.test(error.message), `got "${error.message}"`);
      assert.doesNotMatch(error.message, GENERIC_SOCKETLIB);
      assert.notEqual(error.message, GENERIC_FAILURE);
    };
    const queue = (type, params, days) => api.queue.submit(hero, type, params, days);
    const SHORT = "Nothing can be bought: check the Compendium for where to find what you are missing.";

    // step 6: the second cancel
    const action = await asTest(() => queue("craft", { recipe: "gate-blade", selection: { body: "gate-ore" } }));
    await asTest(() => api.queue.cancel(hero, action.id));
    await refused(() => api.queue.cancel(hero, action.id), `Gate Hero has no queued action "${action.id}"`);
    // step 7
    await refused(() => queue("craft", { recipe: "gate-blade", selection: { body: "gate-gem" } }), `Cannot queue this craft: slot "body": needs 2 Gate Gem but only 0 available. ${SHORT}`);
    await refused(() => queue("craft", { recipe: "gate-blade", selection: {} }), `Cannot queue this craft: slot "body": no material selected. ${SHORT}`);
    await refused(() => queue("craft", { recipe: "gate-blade", selection: { body: "gate-ore" } }, 5), "craft: this craft takes 2 day(s) (got 5); the time is set by the recipe and the station, leave days out");
    // step 14: outside downtime
    await api.downtime.end();
    await refused(() => queue("craft", { recipe: "gate-blade", selection: { body: "gate-ore" } }), "Downtime isn't open right now");
    // step 18
    const B = scene.tokens.getName("Gate Patch B"), H = scene.tokens.getName("Gate Patch H");
    await as(gm, () => api.queue.submit(away, "gather", { sceneId: scene.id, tokenId: B.id }));
    await refused(() => queue("gather", { sceneId: scene.id, tokenId: B.id }), "Gate Patch B has no free charge left: every charge it has is already claimed by a queued gather");
    await refused(() => queue("gather", { sceneId: scene.id, tokenId: H.id }), "Gate Patch H has not been found yet");
    await refused(() => api.queue.cancel(away, away.getFlag(M, "pendingActions")[0].id), "cancel: Test does not own Gate Absent");
    assert.deepEqual(env.handlerThrows, [], "no refusal was thrown out of a handler");
    await runBlock(25, gm);
  });
});

test("GATE: the message-matching checks in the gate doc expect the real plain messages, anchored", () => {
  for (const text of [
    'Gate Hero has no queued action "[^"]+"', 'Cannot queue this craft: slot "body": needs 2 Gate Gem but only 0 available', 'craft: this craft takes 2 day\\(s\\) \\(got 5\\)',
    'refusal === "Downtime isn\'t open right now"', 'taken === "Gate Patch B has no free charge left: every charge it has is already claimed by a queued gather"',
    'hidden === "Gate Patch H has not been found yet"', 'cancel === "cancel: Test does not own Gate Absent"'
  ]) assert.ok(gateDoc.includes(text), `the gate doc should check: ${text}`);
});
