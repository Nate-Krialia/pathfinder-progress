/**
 * Runs the REAL gathering store and the REAL PF2e adapter against small fake
 * Foundry documents (token, actor, items, chat). Nothing is injected except the
 * Foundry objects themselves, so this exercises the wiring that unit tests of the
 * pure functions cannot: store.js -> adapter -> actor inventory -> token flag.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as adapter from "../scripts/adapter/pf2e.js";
import * as store from "../scripts/gathering/store.js";
import { asPage, seedRecords } from "./helpers.js";

const MODULE = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const api = { definitions: registry };

// Fake Foundry --------------------------------------------------------------------------------
/** Foundry v14's deletion operator: a dotted-path update with this value deletes the key. */
class FakeForcedDeletion {}

/** A token document whose flags merge like Foundry's setFlag (shallow here), with write counting. */
function fakeToken(name = "Iron Vein") {
  const flags = {};
  const doc = {
    documentName: "Token", id: "tok1", name, uuid: `Scene.s1.Token.${name}`, hidden: false,
    failNextFlagWrite: false, flagWrites: 0,
    getFlag: (scope, key) => (flags[`${scope}.${key}`] === undefined ? undefined : structuredClone(flags[`${scope}.${key}`])),
    async setFlag(scope, key, value) {
      if (doc.failNextFlagWrite) { doc.failNextFlagWrite = false; throw new Error("flag write failed"); }
      doc.flagWrites++;
      const k = `${scope}.${key}`;
      flags[k] = { ...(flags[k] ?? {}), ...structuredClone(value) };
    },
    async unsetFlag(scope, key) { delete flags[`${scope}.${key}`]; },
    // A dotted flag path ("flags.<scope>.<key>.<field>") updates one field; a ForcedDeletion value removes it. One call = one write.
    async update(data) {
      const flagPaths = Object.keys(data).filter(path => /^flags\.[^.]+\.[^.]+\.[^.]+$/.test(path));
      if (flagPaths.length) {
        if (doc.failNextFlagWrite) { doc.failNextFlagWrite = false; throw new Error("flag write failed"); }
        doc.flagWrites++;
      }
      for (const [path, value] of Object.entries(data)) {
        if (!flagPaths.includes(path)) { Object.assign(doc, { [path]: value }); continue; }
        const [, scope, key, field] = path.split(".");
        const k = `${scope}.${key}`;
        flags[k] ??= {};
        if (value instanceof FakeForcedDeletion) delete flags[k][field];
        else flags[k][field] = structuredClone(value);
      }
    }
  };
  return doc;
}

/** An actor with an inventory, the athletics skill, and optional failure injection. */
function fakeActor({ athletics = 9, name = "Bottlespeaker" } = {}) {
  const items = [];
  items.get = id => items.find(i => i.id === id);
  let nextId = 1;
  const actor = {
    name, id: "actor1", items,
    skills: { athletics: { mod: athletics }, crafting: { mod: -1 }, medicine: { mod: 10 } },
    createCalls: 0, failCreateOnCall: null,
    async createEmbeddedDocuments(type, datas) {
      return datas.map(data => {
        actor.createCalls++;
        if (actor.failCreateOnCall === actor.createCalls) throw new Error("could not create the item");
        const item = {
          id: `item${nextId++}`, name: data.name, type: data.type, system: { ...data.system }, flags: structuredClone(data.flags ?? {}),
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

/** Install fake Foundry globals. `uniforms` scripts CONFIG.Dice.randomUniform(); out of values is a test bug. */
function install(uniforms = []) {
  const chat = [];
  const queue = [...uniforms];
  globalThis.game = { user: { isGM: true }, i18n: { localize: text => text } };
  globalThis.foundry = { data: { operators: { ForcedDeletion: FakeForcedDeletion } } };
  globalThis.CONFIG = {
    Dice: { randomUniform: () => { if (!queue.length) throw new Error("test ran out of scripted dice"); return queue.shift(); } },
    PF2E: { skills: { athletics: { label: "Athletics" }, crafting: { label: "Crafting" }, medicine: { label: "Medicine" } } }
  };
  globalThis.ChatMessage = { create: async message => { chat.push(message); }, getSpeaker: () => ({ alias: "speaker" }) };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  return { chat, remaining: () => queue.length };
}

const orePlaced = (charges = 3) => ({ nodeType: "ore", tier: 1, charges });
async function oreNode(charges = 3) {
  const token = fakeToken();
  await store.createNode(api, token, orePlaced(charges));
  return token;
}
const record = token => token.getFlag(MODULE, "node");
const stackOf = (actor, name) => actor.items.filter(i => i.name === name);
const qty = (actor, name) => stackOf(actor, name).reduce((n, i) => n + i.system.quantity, 0);
const assertConsistent = token => assert.deepEqual(check(LIVE_SCHEMAS.node, record(token)), [], "node record must always be consistent");

// With +9: iron 1d4 -> uniform .99 = 4; silver hidden d20 .99 = 20 (success), silver 1d2 .0 = 1; starmetal hidden d20 .99 = 20 (success).
const BIG_HAUL = [0.99, 0.99, 0.0, 0.99];

// Tests ----------------------------------------------------------------------------------------------
test("giveMaterial is exported and the gather code can reach it", () => {
  assert.equal(typeof adapter.giveMaterial, "function");
});

test("adapter.giveMaterial creates a flagged treasure stack, then tops it up", async () => {
  const actor = fakeActor();
  await adapter.giveMaterial(actor, registry.material.get("iron"), 3);
  assert.equal(actor.items.length, 1);
  assert.deepEqual([actor.items[0].name, actor.items[0].type, actor.items[0].system.quantity], ["Iron", "treasure", 3]);
  assert.deepEqual(actor.items[0].flags[MODULE].material, { materialId: "iron", tier: 1 });
  await adapter.giveMaterial(actor, registry.material.get("iron"), 2);
  assert.equal(actor.items.length, 1, "tops up the same stack");
  assert.equal(actor.items[0].system.quantity, 5);
});

test("a passing gather really grants flagged material items to the actor (the bug that shipped)", async () => {
  const env = install(BIG_HAUL);
  const actor = fakeActor();
  const token = await oreNode();
  const result = await store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api);

  assert.equal(result.passed, true);
  assert.deepEqual(result.gains.map(g => [g.materialId, g.quantity]), [["iron", 4], ["silver", 1], ["starmetal", 1]]);
  assert.deepEqual([qty(actor, "Iron"), qty(actor, "Silver"), qty(actor, "Starmetal")], [4, 1, 1]);
  for (const item of actor.items) assert.ok(item.getFlag(MODULE, "material")?.materialId, `${item.name} must carry its material flag`);
  assert.deepEqual([record(token).charges, record(token).state], [2, "active"]);
  assert.equal(env.remaining(), 0, "every scripted die was used");
});

test("the chat summary lists the haul and nothing about the hidden rolls", async () => {
  const env = install(BIG_HAUL);
  const actor = fakeActor();
  const token = await oreNode();
  await store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api);
  assert.equal(env.chat.length, 1);
  const text = env.chat[0].content;
  assert.match(text, /gathers from.*Iron Vein.*\(Athletics\).*Success/);
  assert.match(text, /Gathered: 4 Iron, 1 Silver, 1 Starmetal\./);
  assert.match(text, /Charges left: 2\./);
  assert.doesNotMatch(text, /\b15\b|\b21\b|hidden/i);
});

test("gathering again tops up the existing stacks instead of duplicating them", async () => {
  install([...BIG_HAUL, ...BIG_HAUL]);
  const actor = fakeActor();
  const token = await oreNode();
  await store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api);
  await store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api);
  assert.deepEqual(stackOf(actor, "Iron").length, 1);
  assert.deepEqual([qty(actor, "Iron"), qty(actor, "Silver"), qty(actor, "Starmetal")], [8, 2, 2]);
  assert.equal(record(token).charges, 1);
});

test("a failed gather grants nothing, rolls no dice, and still burns a charge", async () => {
  const env = install([]); // any dice roll would throw: there are none scripted
  const actor = fakeActor();
  const token = await oreNode();
  const result = await store.gather({ actor, node: token, skill: "athletics", degree: "failure", chat: false }, api);
  assert.deepEqual([result.passed, result.gains, result.hidden, result.chargesAfter], [false, [], [], 2]);
  assert.equal(actor.items.length, 0);
  assert.equal(record(token).charges, 2);
  assert.equal(env.chat.length, 0, "chat: false posts nothing");
});

test("chat: false posts nothing but still returns the full result", async () => {
  const env = install(BIG_HAUL);
  const actor = fakeActor();
  const token = await oreNode();
  const result = await store.gather({ actor, node: token, skill: "athletics", degree: "success", chat: false }, api);
  assert.equal(env.chat.length, 0);
  assert.equal(result.gains.length, 3);
  assert.equal(result.hidden.length, 2, "hidden rolls are returned to the GM");
});

test("the last charge depletes the node with charges and state agreeing", async () => {
  install([0.0]); // iron 1d4 -> 1; silver/starmetal hidden d20 needs 2 more... script them as failures below
  const actor = fakeActor();
  const token = await oreNode(1);
  install([0.0, 0.0, 0.0]); // iron qty 1; both hidden d20s = 1 (fail)
  const result = await store.gather({ actor, node: token, skill: "athletics", degree: "success", chat: false }, api);
  assert.deepEqual([result.chargesAfter, result.state], [0, "depleted"]);
  assert.deepEqual([record(token).charges, record(token).state], [0, "depleted"]);
  assertConsistent(token);
  await assert.rejects(store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api), /depleted/);
});

test("a consistent node record at every step of a node's life", async () => {
  const actor = fakeActor();
  const token = await oreNode(2);
  for (let i = 0; i < 2; i++) {
    install([0.5, 0.0, 0.0, 0.0]);
    await store.gather({ actor, node: token, skill: "athletics", degree: i === 0 ? "success" : "failure", chat: false }, api);
    assertConsistent(token);
  }
  assert.deepEqual([record(token).charges, record(token).state], [0, "depleted"]);
  assert.equal(store.refillNode, undefined, "nodes never refill");
});

// Failure paths: a grant that crashes -------------------------------------------------------------------
test("if granting fails, the charge is refunded and nothing is given", async () => {
  install(BIG_HAUL);
  const actor = fakeActor();
  actor.failCreateOnCall = 1; // the very first item creation throws
  const token = await oreNode(3);
  await assert.rejects(
    store.gather({ actor, node: token, skill: "athletics", degree: "success", chat: false }, api),
    err => /could not grant the materials \(could not create the item\)/.test(err.message) && /charge was refunded and nothing was given/.test(err.message)
  );
  assert.deepEqual([record(token).charges, record(token).state], [3, "active"], "the charge came back");
  assert.equal(actor.items.length, 0);
  assertConsistent(token);
});

test("a partly failed grant is undone: new stacks are deleted, topped-up stacks restored", async () => {
  install(BIG_HAUL);
  const actor = fakeActor();
  await adapter.giveMaterial(actor, registry.material.get("iron"), 5); // existing stack: will be topped up then restored
  actor.createCalls = 0;
  actor.failCreateOnCall = 1; // silver (a NEW stack) fails after iron was topped up
  const token = await oreNode(3);
  await assert.rejects(store.gather({ actor, node: token, skill: "athletics", degree: "success", chat: false }, api), /refunded/);
  assert.equal(qty(actor, "Iron"), 5, "the iron top-up was taken back");
  assert.equal(qty(actor, "Silver"), 0);
  assert.equal(record(token).charges, 3);
});

test("a partly failed grant deletes stacks it had just created", async () => {
  install(BIG_HAUL);
  const actor = fakeActor();
  actor.failCreateOnCall = 2; // iron's new stack is created, then silver's creation fails
  const token = await oreNode(3);
  await assert.rejects(store.gather({ actor, node: token, skill: "athletics", degree: "success", chat: false }, api), /refunded/);
  assert.equal(actor.items.length, 0, "the iron stack created a moment ago was deleted again");
  assert.equal(record(token).charges, 3);
});

test("if the refund itself fails, the error says so and the node is still consistent", async () => {
  install(BIG_HAUL);
  const actor = fakeActor();
  actor.failCreateOnCall = 1;
  const token = await oreNode(3);
  const realUpdate = token.update.bind(token);
  let writes = 0;
  token.update = async (...args) => { writes++; if (writes === 2) throw new Error("flag write failed"); return realUpdate(...args); }; // 1st = burn, 2nd = refund
  await assert.rejects(
    store.gather({ actor, node: token, skill: "athletics", degree: "success", chat: false }, api),
    err => /charge could NOT be refunded/.test(err.message) && /set flags\.pathfinder-progress\.node\.charges back to 3/.test(err.message) && /now has 2 charge/.test(err.message)
  );
  assert.deepEqual([record(token).charges, record(token).state], [2, "active"], "burned but consistent: never 0 charges while active");
  assertConsistent(token);
});

test("a chat failure after a successful gather does not lose the result", async () => {
  const env = install(BIG_HAUL);
  globalThis.ChatMessage.create = async () => { throw new Error("chat is down"); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const actor = fakeActor();
    const token = await oreNode();
    const result = await store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api);
    assert.equal(result.gains.length, 3);
    assert.equal(qty(actor, "Iron"), 4);
  } finally {
    console.error = originalError;
  }
  assert.equal(env.chat.length, 0);
});

// The store refuses to save a broken record ----------------------------------------------------------------
test("saveNodeRecord refuses an inconsistent node (0 charges but active) and leaves the flag alone", async () => {
  install();
  const token = await oreNode(3);
  const before = record(token);
  await assert.rejects(store.saveNodeRecord(token, { ...before, charges: 0 }), /refusing to save an inconsistent node record.*must be at least 1 when the node is active/);
  await assert.rejects(store.saveNodeRecord(token, { ...before, state: "depleted" }), /must be 0 when the node is depleted/);
  assert.deepEqual(record(token), before);
});

// Other tools through the real wiring ------------------------------------------------------------------------------
test("previewGather reads the real skill modifier through the adapter", async () => {
  install();
  const actor = fakeActor({ athletics: 9 });
  const token = await oreNode();
  const preview = store.previewGather(api, actor, token, "athletics");
  assert.deepEqual([preview.ok, preview.modifier, preview.baseDc], [true, 9, 10]);
  assert.deepEqual(preview.rungs.map(r => r.chance ?? r.passChance), [0.95, 0.75, 0.45]);
});

test("anchor: gathering is refused; activating unhides the token", async () => {
  install();
  const actor = fakeActor();
  const token = fakeToken();
  await store.createAnchor(api, token);
  assert.equal(token.hidden, true);
  await assert.rejects(store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api), /is an anchor.*cannot be gathered until it is activated/);
  await store.activateNode(api, token, { nodeType: "ore", tier: 1 });
  assert.equal(token.hidden, false);
  assert.deepEqual([record(token).state, record(token).charges], ["active", 3]);
  assertConsistent(token);
});

test("replacing a node with an anchor clears the old keys (no stale fields survive the merge)", async () => {
  install();
  const token = await oreNode();
  await store.createAnchor(api, token, { replace: true });
  assert.deepEqual(Object.keys(record(token)).sort(), ["discoveredBy", "source", "state"]);
});

test("skill whitelist and auto-pick work through the store", async () => {
  install([0.0]);
  const actor = fakeActor();
  const ore = await oreNode();
  await assert.rejects(store.gather({ actor, node: ore, skill: "nature", degree: "success" }, api), /skill "nature" is not allowed for Ore Vein nodes/);
  await assert.rejects(store.gather({ actor, node: ore, degree: "success" }, api), /allow several skills/);
  assert.equal(record(ore).charges, 3, "refused gathers spend nothing");

  const salvage = fakeToken("Scrap");
  await store.createNode(api, salvage, { nodeType: "salvage", tier: 1 });
  const result = await store.gather({ actor, node: salvage, degree: "success", chat: false }, api);
  assert.equal(result.skill, "crafting");
  assert.equal(qty(actor, "Iron"), 1);
});

test("corpse node: made by hand, gathered like any other", async () => {
  install([0.0, 0.0, 0.0]);
  const actor = fakeActor();
  const token = fakeToken("Dead Wolf");
  await store.makeCorpseNode(api, token, { tier: 1, charges: 2, decayTimer: 3, ladder: [
    { materialId: "iron", dcOffset: 0, quantity: "1d2", guaranteed: true },
    { materialId: "silver", dcOffset: 4, quantity: "1" }
  ] });
  assertConsistent(token);
  const result = await store.gather({ actor, node: token, skill: "medicine", degree: "success", chat: false }, api);
  assert.equal(result.skill, "medicine");
  assert.equal(qty(actor, "Iron"), 1);
});

test("GM-only: a non-GM cannot gather or edit nodes", async () => {
  install();
  const actor = fakeActor();
  const token = await oreNode();
  globalThis.game.user.isGM = false;
  await assert.rejects(store.gather({ actor, node: token, skill: "athletics", degree: "success" }, api), /GM only/);
  await assert.rejects(store.createNode(api, fakeToken(), orePlaced()), /GM only/);
});
