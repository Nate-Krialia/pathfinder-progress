/**
 * Runs the REAL queue, audit and research stores against fake Foundry objects: submit,
 * reject, edit, resolve, failure isolation, retry, the audit ledger and its rollback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as research from "../scripts/research/store.js";
import * as queue from "../scripts/queue/store.js";
import * as audit from "../scripts/audit/store.js";
import { asPage, openDowntime, seedRecords } from "./helpers.js";

const MODULE = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const clone = v => (v === undefined ? undefined : structuredClone(v));
const api = { definitions: registry, contexts: new Map(), uncraftable: new Set(), resolvedOutputs: new Map() };
const DAGGER = "unlock-dagger-spider-fang";

function fakeActor(id, name, { owner = true } = {}) {
  const flags = {};
  const actor = {
    id, name, flags, isOwner: owner, failUpdate: false, rolls: [], updateCalls: 0,
    getFlag: (scope, key) => (scope === MODULE ? clone(flags[key]) : undefined),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(data) {
      actor.updateCalls++;
      if (actor.failUpdate) throw new Error("update failed");
      for (const [path, value] of Object.entries(data)) flags[path.replace("flags.pathfinder-progress.", "")] = clone(value);
    },
    skills: Object.fromEntries(["crafting", "arcana", "occultism"].map(slug => [slug, { mod: 5, check: { roll: async () => actor.rolls.shift() } }]))
  };
  return actor;
}
const roll = (degreeOfSuccess, total, natural) => ({ options: { degreeOfSuccess }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

let idCounter = 0;
function install({ isGM = true, actors = [] } = {}) {
  const values = { auditLedger: {} };
  const list = [...actors];
  list.get = id => list.find(a => a.id === id);
  const chat = [];
  globalThis.game = {
    user: { isGM }, actors: list, i18n: { localize: t => t },
    settings: { get: (s, key) => (key === "downtime" ? openDowntime(list.map(a => a.id)) : clone(values[key])), set: async (s, key, value) => { if (values.failSet) throw new Error("set failed"); values[key] = clone(value); } }
  };
  globalThis.foundry = { utils: { randomID: () => `id${++idCounter}` } };
  globalThis.CONFIG = { PF2E: { skills: { crafting: { label: "Crafting" }, arcana: { label: "Arcana" }, occultism: { label: "Occultism" } } } };
  globalThis.ChatMessage = { create: async m => { chat.push(m); }, getSpeaker: () => ({}), getWhisperRecipients: () => [{ id: "gm" }] };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  return { values, chat, list };
}

async function world({ days = 10 } = {}) {
  const actor = fakeActor("a1", "Aelwyn");
  const env = install({ actors: [actor] });
  await research.grantDays(actor, days);
  await research.startProject(api, { actor, recipe: "dagger-spider-fang" });
  return { actor, env };
}
const pending = actor => actor.getFlag(MODULE, "pendingActions") ?? [];
const counter = actor => actor.getFlag(MODULE, "downtimeDays");
const total = actor => counter(actor) + pending(actor).reduce((n, a) => n + a.daysReserved, 0);
const submitDagger = (actor, days = 2) => queue.submit(actor, "research", { projectId: DAGGER }, days);

test("submit reserves days in ONE update, conserves the total, and leaves the audit clean", async () => {
  const { actor } = await world();
  const before = actor.updateCalls;
  const action = await submitDagger(actor, 3);
  assert.equal(actor.updateCalls - before, 1);
  assert.deepEqual([counter(actor), total(actor)], [7, 10]);
  assert.deepEqual(pending(actor), [action]);
  assert.deepEqual(action.params, { projectId: DAGGER, skill: "crafting" }, "the only allowed skill is stored");
  assert.deepEqual(audit.scan(), []);
});

test("submit refuses overbooking, strangers, unwired types and bad projects, changing nothing", async () => {
  const { actor } = await world({ days: 2 });
  await assert.rejects(submitDagger(actor, 3), /cannot reserve 3 day\(s\): only 2 unreserved/);
  await assert.rejects(queue.submit(actor, "upgrade", {}, 1), /cannot be queued yet/);
  await assert.rejects(queue.submit(actor, "research", { projectId: "ghost" }, 1), /no project "ghost"/);
  const stranger = fakeActor("a2", "Stranger", { owner: false });
  globalThis.game.actors.push(stranger);
  globalThis.game.user.isGM = false;
  await assert.rejects(queue.submit(stranger, "research", { projectId: DAGGER }, 1), /you do not own/);
  assert.deepEqual([counter(actor), pending(actor)], [2, []]);
});

test("a PLAYER can submit (even with no GM online) and the audit does not false-alarm; GM actions are refused to them", async () => {
  const { actor } = await world();
  globalThis.game.user.isGM = false;
  const action = await submitDagger(actor, 2);
  globalThis.game.user.isGM = true;
  assert.deepEqual(audit.scan(), []);
  globalThis.game.user.isGM = false;
  await assert.rejects(queue.reject(actor, action.id), /GM only/);
  await assert.rejects(queue.editDays(actor, action.id, 1), /GM only/);
  await assert.rejects(queue.resolveAction(api, actor, action.id), /GM only/);
  await assert.rejects(queue.resolveAll(api), /GM only/);
  await assert.rejects(audit.accept(actor), /GM only/);
  await assert.rejects(audit.commit(actor, {}, []), /GM only/);
  assert.equal(pending(actor).length, 1);
});

test("reject refunds everything; editDays raises and cuts without changing the total", async () => {
  const { actor } = await world();
  const action = await submitDagger(actor, 2);
  await queue.editDays(actor, action.id, 5);
  assert.deepEqual([counter(actor), pending(actor)[0].daysReserved, total(actor)], [5, 5, 10]);
  await queue.editDays(actor, action.id, 1);
  assert.deepEqual([counter(actor), total(actor)], [9, 10]);
  await assert.rejects(queue.editDays(actor, action.id, 11), /cannot raise to 11/);
  await assert.rejects(queue.editDays(actor, action.id, 0), /at least 1/);
  assert.deepEqual([counter(actor), pending(actor)[0].daysReserved], [9, 1]);
  await queue.reject(actor, action.id);
  assert.deepEqual([counter(actor), pending(actor), total(actor)], [10, [], 10]);
  await assert.rejects(queue.reject(actor, action.id), /no queued action/);
  assert.deepEqual(audit.scan(), []);
});

test("resolve spends the used days, refunds the rest, rolls on the GM client, and keeps the audit clean", async () => {
  const { actor, env } = await world();
  const action = await submitDagger(actor, 3);
  actor.rolls.push(roll(2, 18, 12), roll(3, 30, 20), roll(2, 18, 11));
  const outcome = await queue.resolveAction(api, actor, action.id);
  assert.equal(outcome.status, "resolved");
  assert.equal(pending(actor).length, 0);
  assert.equal(total(actor), 7 + 0, "3 days spent from 10");
  assert.equal(counter(actor), 7);
  assert.equal(env.chat.length, 1, "one whisper to the players, with degree words only; the totals are in the GM log (docs/11b)");
  assert.deepEqual(audit.scan(), []);
});

test("early completion refunds the unspent days and unlocks the formula", async () => {
  const { actor } = await world();
  const action = await submitDagger(actor, 8);
  actor.rolls.push(...Array.from({ length: 8 }, () => roll(3, 30, 20)));
  const outcome = await queue.resolveAction(api, actor, action.id);
  assert.equal(outcome.status, "resolved");
  assert.match(outcome.message, /finished the research/);
  assert.ok(actor.getFlag(MODULE, "formulas").some(f => f.recipeId === "dagger-spider-fang" && f.access === "owned"));
  assert.ok(counter(actor) > 2, "days were refunded");
  assert.deepEqual(audit.scan(), []);
});

test("resolving an action that can never succeed refunds it and reports invalid", async () => {
  const { actor } = await world();
  const action = await submitDagger(actor, 4);
  await research.abandonProject(actor, DAGGER);
  const outcome = await queue.resolveAction(api, actor, action.id);
  assert.equal(outcome.status, "invalid");
  assert.match(outcome.message, /abandoned, not active.*4 day\(s\) refunded/);
  assert.deepEqual([counter(actor), pending(actor), total(actor)], [10, [], 10]);
  assert.deepEqual(audit.scan(), []);
});

test("FAILURE ISOLATION: resolveAll runs the rest in order; an unexpected error leaves its action queued; Retry works", async () => {
  const a = fakeActor("a1", "Aelwyn");
  const b = fakeActor("a2", "Borin");
  const c = fakeActor("a3", "Cass");
  install({ actors: [a, b, c] });
  for (const actor of [a, b, c]) {
    await research.grantDays(actor, 6);
    await research.startProject(api, { actor, recipe: "dagger-spider-fang" });
  }
  const first = await submitDagger(a, 2);      // will hit an unexpected roll failure
  const second = await submitDagger(b, 2);     // invalid (abandoned after submitting)
  const third = await submitDagger(c, 2);      // fine
  await research.abandonProject(b, DAGGER);
  c.rolls.push(roll(2, 18, 12), roll(2, 18, 12));
  // a has no rolls queued: the fake returns undefined, so the roll fails unexpectedly.

  const { results, summary } = await queue.resolveAll(api, { chat: false });
  assert.deepEqual(results.map(r => [r.actionId, r.status]), [[first.id, "error"], [second.id, "invalid"], [third.id, "resolved"]]);
  assert.deepEqual(summary, { resolved: 1, invalid: 1, skipped: 0, errors: 1 });
  assert.equal(pending(a).length, 1, "the errored action is untouched");
  assert.deepEqual([counter(a), total(a)], [4, 6]);
  assert.deepEqual(audit.scan(), []);

  a.rolls.push(roll(2, 18, 12), roll(2, 18, 12));
  const retry = await queue.resolveAction(api, a, first.id, { chat: false });
  assert.equal(retry.status, "resolved");
  assert.deepEqual([pending(a).length, total(a)], [0, 4]);
  assert.deepEqual(audit.scan(), []);
  assert.deepEqual((await queue.resolveAction(api, a, first.id)).status, "skipped");
});

test("an unwired action type is an error row, never silently dropped", async () => {
  const { actor } = await world();
  await actor.update({
    "flags.pathfinder-progress.pendingActions": [{ id: "x1", type: "upgrade", params: {}, daysReserved: 1, submittedAt: 1 }],
    "flags.pathfinder-progress.downtimeDays": 9
  });
  const { results } = await queue.resolveAll(api, { chat: false });
  assert.equal(results[0].status, "error");
  assert.match(results[0].message, /no resolver is wired for "upgrade"/);
  assert.equal(pending(actor).length, 1);
  assert.deepEqual(audit.scan(), []);
  await queue.reject(actor, "x1");
  assert.deepEqual([counter(actor), pending(actor)], [10, []]);
});

test("list is in submission order across actors and describes each action", async () => {
  const a = fakeActor("a1", "Aelwyn");
  const b = fakeActor("a2", "Borin");
  install({ actors: [a, b] });
  for (const actor of [a, b]) {
    await research.grantDays(actor, 5);
    await research.startProject(api, { actor, recipe: "dagger-spider-fang" });
  }
  const second = await submitDagger(b, 1);
  await a.update({ "flags.pathfinder-progress.pendingActions": [{ id: "old", type: "research", params: { projectId: DAGGER, skill: "arcana" }, daysReserved: 1, submittedAt: 1 }], "flags.pathfinder-progress.downtimeDays": 4 });
  const rows = queue.list();
  assert.deepEqual(rows.map(r => r.action.id), ["old", second.id]);
  assert.match(rows[0].label, /Research: Spider Fang Dagger/);
  assert.match(rows[0].detail, /DC 14/);
});

// Audit ---------------------------------------------------------------------------------------------------------------
test("audit catches tampering, keeps catching it after module changes, and Accept clears it", async () => {
  const { actor } = await world();
  await actor.setFlag(MODULE, "downtimeDays", 99);          // a player edits their days
  await actor.setFlag(MODULE, "formulas", [{ recipeId: "longsword-basic", access: "owned", source: "gm" }]);
  const p = actor.getFlag(MODULE, "projects");
  p[0].progress = 7;
  await actor.setFlag(MODULE, "projects", p);
  const kinds = () => audit.scan()[0].mismatches.map(m => m.kind).sort();
  assert.deepEqual(kinds(), ["days", "formulaExtra", "projectEdited"]);

  await research.grantDays(actor, 1);                       // a later module change must not hide it
  assert.ok(kinds().includes("days"));

  await audit.accept(actor);
  assert.deepEqual(audit.scan(), []);
  assert.match(audit.readLedger()[actor.id].history.at(-1).text, /accepted by the GM/);
});

test("bootstrap gives existing data a baseline once, and only for actors that hold module data", async () => {
  const a = fakeActor("a1", "Aelwyn");
  const b = fakeActor("a2", "Borin");
  install({ actors: [a, b] });
  await a.setFlag(MODULE, "downtimeDays", 7);
  assert.equal(audit.scan().length, 1, "data with no ledger entry is a mismatch");
  assert.deepEqual(await audit.bootstrap(), ["Aelwyn"]);
  assert.deepEqual(audit.scan(), []);
  assert.deepEqual(await audit.bootstrap(), []);
  assert.equal(audit.readLedger()[b.id], undefined);
});

test("commit is ledger-first and ROLLS BACK the ledger if the actor update fails", async () => {
  const { actor, env } = await world();
  const before = clone(env.values.auditLedger);
  actor.failUpdate = true;
  await assert.rejects(research.grantDays(actor, 5), /update failed/);
  assert.deepEqual(env.values.auditLedger, before);
  actor.failUpdate = false;
  assert.deepEqual(audit.scan(), []);
});

test("if the ledger cannot be written, the actor is not touched", async () => {
  const { actor, env } = await world();
  env.values.failSet = true;
  const days = counter(actor);
  await assert.rejects(research.grantDays(actor, 5), /set failed/);
  assert.equal(counter(actor), days);
});

test("research() through the ledger: spending days and completing a project stay in step", async () => {
  const { actor } = await world();
  await research.research({ actor, project: DAGGER, days: 3, degree: "success", chat: false }, api);
  assert.deepEqual(audit.scan(), []);
  await research.research({ actor, project: DAGGER, days: 7, degree: "criticalSuccess", chat: false }, api);
  assert.ok(actor.getFlag(MODULE, "formulas").length === 1);
  assert.deepEqual(audit.scan(), []);
  await research.removeFormula(actor, "dagger-spider-fang");
  assert.deepEqual(audit.scan(), []);
});
