/**
 * A fake Foundry for the Stage 10b/10c tests (a copy of the one in work-wiring.test.js, extended): it boots the REAL
 * scripts/main.js (init + ready), gives every "client" its own identity (AsyncLocalStorage) so a player's call is relayed
 * to a GM context like real socketlib (a handler that throws gives the player only socketlib's generic text), fires the
 * createItem hook, and counts every world write so a failure can be injected at each one.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords, UUID, UUID_2 } from "./helpers.js";
import { emptyRegistry } from "../scripts/data/playerSet.js";
import { attachRefresh } from "../scripts/data/playerDefs.js";
import { _resetDefsStateForTests } from "../scripts/data/playerState.js";

export const M = "pathfinder-progress";
export const makeRegistry = () => loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
export const DAGGER = "dagger-spider-fang";
export const SEL = { blade: "iron", fang: "spider-fang" };
export const clone = v => (v === undefined ? undefined : structuredClone(v));

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
  items.has = id => items.some(i => i.id === id);
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
    id: newId("item"), parent: actor, name: data.name, type: data.type, system: { ...(data.system ?? {}) }, flags: clone(data.flags ?? {}),
    getFlag: (scope, key) => clone(item.flags[scope]?.[key]),
    toObject: () => clone({ name: item.name, type: item.type, system: item.system, flags: item.flags }),
    async update(change) { tick("item.update"); if ("system.quantity" in change) item.system.quantity = change["system.quantity"]; },
    async delete() { tick("item.delete"); actor.items.splice(actor.items.indexOf(item), 1); }
  };
  return item;
}

/** Give a fake actor the delayed player-side copy and the `updateActor` echo (see makeActor). `user` is the player whose client receives it. */
function enableEcho(actor, user, delay = 30) {
  const pending = new Set();
  const echo = actor.echo = {
    delay, delivered: 0, held: false,
    seen: structuredClone(actor.rawFlags()),
    write(keys) {
      keys.forEach(key => pending.add(key));
      if (echo.held) return;
      setTimeout(() => echo.deliver(), delay);
    },
    async deliver() {
      if (!pending.size) return;
      const keys = [...pending];
      pending.clear();
      echo.seen = structuredClone(actor.rawFlags());
      echo.delivered++;
      const changes = { flags: { [M]: Object.fromEntries(keys.map(k => [k, true])) } };
      for (const fn of listeners.updateActor ?? []) await als.run({ user }, () => fn(actor, changes));
    }
  };
  return echo;
}

function makeActor(name, { copper = 0, owners = [] } = {}) {
  const flags = {};
  const items = collection([]);
  const actor = {
    id: newId("actor"), name, type: "character", flags, items, copper, owners, rolls: [],
    get isOwner() { return game.user.isGM || owners.includes(game.user.id); },
    testUserPermission: user => owners.includes(user.id),
    rawFlags: () => flags,
    // Real Foundry: a player's own copy of the actor changes when the server's update ARRIVES, in a later task, not when the GM client's write resolves.
    // `actor.echo = { delay }` (see enableEcho) makes the fake do that: non-GM clients read a copy that is refreshed `delay` ms after a write, and the
    // `updateActor` hook fires on the player's client then.
    getFlag: (scope, key) => (scope === M ? clone((actor.echo && !game.user?.isGM ? actor.echo.seen : flags)[key]) : undefined),
    async setFlag(scope, key, value) { applyPath(flags, key, value); actor.echo?.write([key]); },   // (setFlag is an update: it merges objects like update does)
    async update(data) {
      await latency();
      tick("actor.update");
      actor.echo?.write(Object.keys(data).filter(path => path.startsWith(`flags.${M}.`)).map(path => path.slice(`flags.${M}.`.length).split(".")[0]));
      for (const [path, value] of Object.entries(data)) {
        if (path.startsWith(`flags.${M}.`)) {
          const key = path.slice(`flags.${M}.`.length);
          // Real Foundry takes a deep path ("flags.<module>.compendium.materials.x"): the fake does too (a plain key still replaces the flag).
          // Real Foundry MERGES an object into the one already stored (arrays and plain values replace); a key left out of the update survives unless ForcedDeletion removes it.
          applyPath(flags, key, value);
        } else applyPath(actor, path, value);
      }
    },
    inventory: {
      coins: { get copperValue() { return actor.copper; } },
      async addCoins(c) {
        tick("addCoins");
        actor.copper += (c.gp ?? 0) * 100 + (c.sp ?? 0) * 10 + (c.cp ?? 0);
        // Real PF2e keeps coins as an inventory item. Only the actors a test creates "like PF2e" (Actor.create) have one.
        if (actor.coinItem && !items.some(i => i.system.stackGroup === "coins")) items.push(makeItem(actor, { name: "Gold Pieces", type: "treasure", system: { stackGroup: "coins", quantity: 1 } }));
      },
      async removeCoins(c) {
        tick("removeCoins");
        const cost = (c.gp ?? 0) * 100 + (c.sp ?? 0) * 10 + (c.cp ?? 0);   // like PF2e, a partial coin object (just gp) is fine
        if (cost > actor.copper) return false;
        actor.copper -= cost;
        return true;
      }
    },
    rollArgs: [], perceptionRolls: [],
    perception: { check: { roll: async () => actor.perceptionRolls.shift() } },
    skills: Object.fromEntries(["crafting", "survival", "nature", "athletics"].map(slug => [slug, { mod: 5, check: { roll: async args => { actor.rollArgs.push(args); return actor.rolls.shift(); } } }])),
    async createEmbeddedDocuments(type, datas) {
      tick("actor.createEmbeddedDocuments");
      const created = datas.map(d => { const item = makeItem(actor, d); items.push(item); return item; });
      await fireHook("createItem", created);
      return created;
    },
    async delete() { const i = game.actors.indexOf(actor); if (i >= 0) game.actors.splice(i, 1); }
  };
  return actor;
}

const listeners = {};
/** Fire a module hook the way Foundry does for the GM client (awaited here so tests are deterministic). */
async function fireHook(name, docs, ...extra) {
  for (const doc of docs) for (const fn of listeners[name] ?? []) await als.run({ user: users.gm }, () => fn(doc, ...extra));
}
/** Fire a hook as it would fire on THAT user's client (Foundry fires most document hooks on every client). */
async function fireHookAs(user, name, docs, ...extra) {
  for (const doc of docs) for (const fn of listeners[name] ?? []) await als.run({ user }, () => fn(doc, ...extra));
}
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
async function world({ iron = 3, fang = 3, copper = 2000, downtime = 6, withGM = true, perClientDefinitions = false } = {}) {
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
    users: Object.assign(collection([gm, annUser, bobUser, testUser]), { activeGM: gm }), actors: collection([]), scenes: collection([]), combats: collection([]),
    packs: { get: id => (id === "pf2e.equipment-srd" ? { getIndex: async () => [{ name: "Dagger", _id: "AAAAAAAAAAAAAAAA" }] } : undefined), filter: () => [] }, system: { id: "pf2e", version: "8.6.1" }, version: "14.369", i18n: { localize: t => t },
    modules: { get: id => modules.get(id) ?? (modules.set(id, { id, active: true }), modules.get(id)) },
    // Like game.messages in real Foundry (verified in 14.369): EVERY message is delivered to EVERY client, a whisper included. `visible` is
    // what the chat log shows this user (public ones and whispers addressed to them; a GM sees all); the rest is still readable data.
    messages: {
      get contents() {
        return env.chat.map(m => Object.defineProperty({ ...m }, "visible", { enumerable: false, get: () => game.user.isGM || !m.whisper || !m.whisper.length || m.whisper.includes(game.user.id) }));
      }
    },
    settings: { register() {}, get: (s, k) => clone(env.values[k]), set: async (s, k, v) => { await latency(); tick(`settings.set ${k}`); env.values[k] = clone(v); } }
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
      Object.assign(actor, { type: data.type, ownership: clone(data.ownership), prototypeToken: clone(data.prototypeToken), system: clone(data.system), coinItem: true });
      Object.assign(actor.flags, clone(data.flags?.[M] ?? {}));
      actor.getTokenDocument = async td => ({ toObject: () => ({ actorId: actor.id, name: actor.name, ...clone(actor.prototypeToken ?? {}), ...clone(td) }) });
      game.actors.push(actor);
      return actor;
    }
  };
  globalThis.Combat = {
    create: async data => {
      const combat = {
        id: newId("combat"), flags: clone(data.flags ?? {}), combatants: collection([]),
        getFlag: (scope, key) => clone(combat.flags[scope]?.[key]),
        async createEmbeddedDocuments(type, datas) {
          const created = datas.map(d => ({ id: newId("cmb"), actor: game.actors.get(d.actorId), parent: combat }));
          for (const c of created) combat.combatants.push(c);
          await fireHook("createCombatant", created);
          return created;
        },
        async delete() { const i = game.combats.indexOf(combat); if (i >= 0) game.combats.splice(i, 1); }
      };
      game.combats.push(combat);
      return combat;
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
  const relayAsGM = async (name, payload) => {
    if (env.noGM) { const error = new Error("There is no GM connected"); error.name = "SocketlibNoGMConnectedError"; throw error; }
    // Like the REAL socketlib: if the handler throws, the caller never sees the message, only this generic text.
    // (The real reason stays in the GM's console.) A guarded handler never throws, so this must never happen.
    try {
      // Like the REAL socketlib, the handler's `this.socketdata.userId` is the user who SENT the message (Foundry's own sender), not the payload's id.
      const sender = game.user.id;
      return await als.run({ user: gm }, () => env.handlers.get(name).call(env.relayContext ?? { socketdata: { userId: sender } }, payload));
    } catch (error) {
      env.handlerThrows.push({ name, message: error.message });
      throw new Error(`An exception occured during remote execution of handler '${name}'. Please see Gamemaster's error console for details.`);
    }
  };
  const registeredSocket = { register: (name, fn) => env.handlers.set(name, fn), executeAsGM: relayAsGM };
  globalThis.socketlib = { registerModule: () => registeredSocket, modules: new Map([[M, registeredSocket]]) };

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
  // Owning a formula reveals its baseline in the Compendium (Stage 10d). The older suites assume a fresh character has NO Compendium yet,
  // so the setup's own grant is not left behind; a test that wants the baseline grants the formula itself.
  const startBook = ann.getFlag(M, "compendium");
  if (startBook?.experiments) {
    const { experiments, ...rest } = startBook; void experiments;
    const empty = !Object.keys(rest.materials).length && !Object.keys(rest.creatures).length && !Object.keys(rest.regions).length;
    // (an update MERGES, so dropping the experiments needs an explicit deletion, as in real Foundry)
    await ann.update(empty ? { [`flags.${M}.compendium`]: new FakeForcedDeletion() } : { [`flags.${M}.compendium.experiments`]: new FakeForcedDeletion() });
  }
  env.ops = 0;
  const { setCraftReductions } = await import("../scripts/queue/work.js");
  setCraftReductions(null);
  _resetDefsStateForTests();
  if (perClientDefinitions) enablePerClientDefinitions(api, users);
  return { gm, annUser, bobUser, ann, bob, table, other };
}

// Per-client definitions (OFF unless a test asks) ------------------------------------------------------------------------
/**
 * In real Foundry every client has its own `api.definitions`. The fake has ONE api, so by default every "client" sees the GM's
 * registry (which is what every older test relies on). With `world({ perClientDefinitions: true })` the registry, the resolved
 * outputs and the rest are kept per user: the GM keeps what was loaded, and a player starts with nothing and gets
 * what `api.definitions.refresh()` delivers over the (fake) socket.
 */
function enablePerClientDefinitions(api, people) {
  const names = ["definitions", "resolvedOutputs", "uncraftable", "contexts", "errors"];
  const stores = new Map();
  stores.set(people.gm.id, Object.fromEntries(names.map(name => [name, api[name]])));
  attachRefresh(stores.get(people.gm.id).definitions);                       // (api.reload() does this on a real GM client)
  for (const user of [people.annUser, people.bobUser, people.testUser]) {
    stores.set(user.id, { definitions: attachRefresh(emptyRegistry()), resolvedOutputs: new Map(), uncraftable: new Set(), contexts: new Map(), errors: [] });
  }
  const storeFor = () => stores.get(game.user.id) ?? stores.get(people.gm.id);
  for (const name of names) {
    Object.defineProperty(api, name, { configurable: true, enumerable: true, get: () => storeFor()[name], set: value => { storeFor()[name] = value; } });
  }
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
    // A setting never written and one holding its empty default read the same, so they compare the same.
    values: Object.fromEntries(Object.entries(env.values).filter(([, v]) => !(Array.isArray(v) && v.length === 0)))
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


export { enableEcho, env, as, collection, makeToken, makeScene, makeItem, makeActor, world, quietly, loudly, stashOf, pendingOf, measure, events, snapshot, addNode, nodeOf, craft, gatherCall, resolve, everyFailureLeavesNothingHalfDone, listeners, latency, fireHook, fireHookAs, newId };
export const getApi = () => api;
export const getUsers = () => users;
