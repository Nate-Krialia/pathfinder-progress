import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { addSpent, defaultParticipantIds, emptyState, gateReason, normalizeState, planEnd, planLate, planStart } from "../scripts/downtime/downtime.js";
import { craftDays } from "../scripts/crafting/days.js";
import { CRAFT_DAYS, DOWNTIME } from "../scripts/config.js";
import * as downtime from "../scripts/downtime/store.js";
import * as queue from "../scripts/queue/store.js";
import * as research from "../scripts/research/store.js";
import * as audit from "../scripts/audit/store.js";
import { asPage, seedRecords } from "./helpers.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const api = { definitions: registry, contexts: new Map(), uncraftable: new Set(), resolvedOutputs: new Map() };
const M = "pathfinder-progress";
const clone = v => (v === undefined ? undefined : structuredClone(v));
const roll = (degreeOfSuccess, total, natural) => ({ options: { degreeOfSuccess }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

// Pure rules ---------------------------------------------------------------------------------------------------
test("a missing or damaged downtime setting means 'closed'", () => {
  for (const raw of [undefined, null, "open", 5, [], {}]) assert.deepEqual(normalizeState(raw).open, false, JSON.stringify(raw));
  assert.equal(normalizeState({ open: "yes" }).open, false, "only true opens it");
  assert.deepEqual(normalizeState({ open: true, days: 4, startedAt: 9, participants: { a: { granted: 4, spent: 1 } } }).participants, { a: { granted: 4, spent: 1 } });
});

test("the gate: closed, not a participant, or fine, in the plain words players see", () => {
  const open = { ...emptyState(), open: true, participants: { a1: { granted: 5, spent: 0 } } };
  assert.equal(gateReason(emptyState(), "a1"), "Downtime isn't open right now");
  assert.equal(gateReason(open, "zz"), "Downtime is open, but you weren't here for it");
  assert.equal(gateReason(open, "a1"), null);
  assert.equal(DOWNTIME.reasons.closed, "Downtime isn't open right now");
});

test("default participants: each connected non-GM user's assigned character, else the player characters they own", () => {
  const users = [
    { isGM: true, active: true, characterId: "gmchar", ownedCharacterIds: ["gmchar"] },
    { isGM: false, active: true, characterId: "pc1", ownedCharacterIds: ["pc1", "pc9"] },
    { isGM: false, active: true, characterId: null, ownedCharacterIds: ["pc2", "pc3"] },
    { isGM: false, active: false, characterId: "absent", ownedCharacterIds: ["absent"] },
    { isGM: false, active: true, characterId: "pc1", ownedCharacterIds: [] }
  ];
  assert.deepEqual(defaultParticipantIds(users), ["pc1", "pc2", "pc3"]);
  assert.deepEqual(defaultParticipantIds([]), []);
});

test("planStart: a whole number of days, at least one character, and never twice", () => {
  const ok = planStart(emptyState(), { days: 5, actorIds: ["a", "b", "a"], now: 100 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.state.participants, { a: { granted: 5, spent: 0 }, b: { granted: 5, spent: 0 } });
  assert.deepEqual([ok.state.open, ok.state.days, ok.state.startedAt], [true, 5, 100]);
  for (const days of [0, -1, 1.5, DOWNTIME.maxDays + 1, "5"]) assert.equal(planStart(emptyState(), { days, actorIds: ["a"], now: 1 }).ok, false, String(days));
  assert.match(planStart(emptyState(), { days: 5, actorIds: [], now: 1 }).error, /no characters are taking part/);
  assert.match(planStart(ok.state, { days: 5, actorIds: ["a"], now: 2 }).error, /already open/);
});

test("planLate gives a late joiner the MOST free days any participant still has", () => {
  const state = planStart(emptyState(), { days: 6, actorIds: ["a", "b"], now: 1 }).state;
  const late = planLate(state, { actorId: "c", freeDays: { a: 2, b: 5 }, now: 2 });
  assert.deepEqual([late.ok, late.days], [true, 5]);
  assert.deepEqual(late.state.participants.c, { granted: 5, spent: 0, late: true });
  assert.match(planLate(state, { actorId: "a", freeDays: { a: 2, b: 5 }, now: 2 }).error, /already taking part/);
  assert.match(planLate(state, { actorId: "c", freeDays: { a: 0, b: 0 }, now: 2 }).error, /nobody has any free days/);
  assert.equal(planLate(emptyState(), { actorId: "c", freeDays: {}, now: 2 }).error, "Downtime isn't open right now");
});

test("planEnd is BLOCKED (and changes nothing) while anything is queued, unless forced", () => {
  const state = planStart(emptyState(), { days: 3, actorIds: ["a"], now: 1 }).state;
  assert.deepEqual(planEnd(state, { queueCount: 2, force: false, now: 5 }), { ok: false, blocked: 2 });
  assert.equal(planEnd(state, { queueCount: 0, force: false, now: 5 }).ok, true);
  const forced = planEnd(state, { queueCount: 2, force: true, now: 5 });
  assert.deepEqual([forced.ok, forced.state.open, forced.state.endedAt], [true, false, 5]);
  assert.match(forced.state.log.at(-1).text, /forced; 2 queued item\(s\) returned/);
  assert.equal(planEnd(emptyState(), { queueCount: 0, force: false, now: 1 }).ok, false);
});

test("spent days are recorded for participants only, while open", () => {
  const state = planStart(emptyState(), { days: 5, actorIds: ["a"], now: 1 }).state;
  assert.equal(addSpent(state, "a", 2).participants.a.spent, 2);
  assert.equal(addSpent(addSpent(state, "a", 2), "a", 1).participants.a.spent, 3);
  assert.equal(addSpent(state, "zz", 2), state, "a non-participant changes nothing");
  assert.equal(addSpent(state, "a", 0), state);
  assert.equal(addSpent(emptyState(), "a", 2).open, false);
});

// Craft time floor -----------------------------------------------------------------------------------------------
test("craftDays: 1 day plus 1 per 2 recipe levels", () => {
  const days = craftDays0 => craftDays({ craftLevel: craftDays0 }).days;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(days), [1, 1, 2, 2, 3, 3, 4, 6]);
});

test("craftDays: STACKED reductions are all applied first and the result is clamped to 1 AFTER them", () => {
  const level6 = { craftLevel: 6 }; // base 4
  assert.deepEqual(craftDays(level6, [1]), { days: 3, base: 4, reduction: 1, floored: false });
  assert.deepEqual(craftDays(level6, [1, 1, 1]), { days: 1, base: 4, reduction: 3, floored: false }, "exactly down to the floor");
  assert.deepEqual(craftDays(level6, [1, 1, 1, 1]), { days: 1, base: 4, reduction: 4, floored: true });
  assert.deepEqual(craftDays(level6, [2, { days: 2, source: "forge upgrade" }, 5, 1]), { days: 1, base: 4, reduction: 10, floored: true }, "stacking far past the floor still gives 1");
  assert.equal(craftDays({ craftLevel: 0 }, [1]).days, 1, "a 1-day craft cannot go lower");
  assert.equal(craftDays(level6, []).days, 4);
  const lowerFloor = { ...CRAFT_DAYS, minDays: 2 };
  assert.equal(craftDays(level6, [9], lowerFloor).days, 2);
});

test("craftDays: bad input is refused, never silently turned into a number", () => {
  assert.throws(() => craftDays({ craftLevel: -1 }), /craftLevel of 0 or more/);
  assert.throws(() => craftDays({}), /craftLevel/);
  for (const bad of [-1, 1.5, "2", NaN, null, { days: -2 }, { source: "x" }]) assert.throws(() => craftDays({ craftLevel: 4 }, [bad]), /whole number of days/, JSON.stringify(bad));
});

test("PROPERTY: over 2000 random crafts the days are always at least 1 and never more than the base", () => {
  let seed = 4242;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2000; i++) {
    const level = Math.floor(rng() * 20);
    const reductions = Array.from({ length: Math.floor(rng() * 8) }, () => Math.floor(rng() * 4));
    const r = craftDays({ craftLevel: level }, reductions);
    assert.ok(r.days >= 1, `level ${level} reductions ${reductions}: ${r.days}`);
    assert.ok(r.days <= r.base);
    assert.equal(r.days, Math.max(1, r.base - reductions.reduce((a, b) => a + b, 0)));
    assert.equal(r.floored, r.base - r.reduction < 1);
  }
});

// The store, with fake Foundry ---------------------------------------------------------------------------------------
const env = { values: {}, chat: [] };
function fakeActor(id, name, { owners = [] } = {}) {
  const flags = {};
  const actor = {
    id, name, flags, type: "character", isOwner: true, rolls: [], owners,
    testUserPermission: (user) => actor.owners.includes(user.id),
    getFlag: (scope, key) => (scope === M ? clone(flags[key]) : undefined),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(data) { for (const [path, value] of Object.entries(data)) flags[path.replace(`flags.${M}.`, "")] = clone(value); },
    skills: { crafting: { mod: 5, check: { roll: async () => actor.rolls.shift() } } }
  };
  return actor;
}
const collection = items => { items.get = id => items.find(i => i.id === id); items.getName = n => items.find(i => i.name === n); return items; };

/** GM + two players: Test (connected, owns Pia) and Away (not connected, owns Orin). */
async function world() {
  const pia = fakeActor("pia", "Pia", { owners: ["u-test"] });
  const orin = fakeActor("orin", "Orin", { owners: ["u-away"] });
  const bystander = fakeActor("bys", "Bystander");
  env.values = { auditLedger: {}, downtime: {}, commissions: [] };
  env.chat = [];
  const actors = collection([pia, orin, bystander]);
  const users = collection([
    { id: "gm1", isGM: true, active: true, character: null },
    { id: "u-test", isGM: false, active: true, character: pia },
    { id: "u-away", isGM: false, active: false, character: orin }
  ]);
  globalThis.game = {
    user: { isGM: true, id: "gm1", name: "GM" }, i18n: { localize: t => t }, actors, users,
    settings: { get: (s, k) => clone(env.values[k]), set: async (s, k, v) => { env.values[k] = clone(v); } }
  };
  globalThis.foundry = { utils: { randomID: () => `id${Math.random().toString(36).slice(2, 8)}` } };
  globalThis.CONFIG = { PF2E: { skills: { crafting: { label: "Crafting" } } } };
  globalThis.ChatMessage = { create: async m => { env.chat.push(m); }, getSpeaker: () => ({}) };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  queue.bind(api);
  return { pia, orin, bystander };
}
const days = a => a.getFlag(M, "downtimeDays") ?? 0;
const events = () => (env.values.auditLedger._events?.history ?? []).map(h => h.text);

test("start: only connected players' characters get the days; the absent player's character and the bystander get nothing", async () => {
  const { pia, orin, bystander } = await world();
  const result = await downtime.start({ days: 6 });
  assert.deepEqual(result.participants.map(p => p.name), ["Pia"]);
  assert.deepEqual([days(pia), days(orin), days(bystander)], [6, 0, 0]);
  const state = downtime.state();
  assert.deepEqual([state.open, state.days, Object.keys(state.participants)], [true, 6, ["pia"]]);
  assert.deepEqual(state.participants.pia, { granted: 6, spent: 0 });
  assert.equal(downtime.isOpen(), true);
  assert.deepEqual(audit.scan(), []);
});

test("start can name any characters, refuses twice, and only a GM can change the period", async () => {
  const { pia, orin } = await world();
  await downtime.start({ days: 3, actorIds: ["Pia", orin] });
  assert.deepEqual([days(pia), days(orin)], [3, 3]);
  await assert.rejects(downtime.start({ days: 3 }), /already open/);
  globalThis.game.user.isGM = false;
  for (const call of [() => downtime.start({ days: 1 }), () => downtime.end({}), () => downtime.addLate("Orin")]) await assert.rejects(call(), /GM only/);
  assert.equal(downtime.isOpen(), true, "players can read it");
});

test("start with nobody connected is refused with a way out; a bad actor reference changes nothing", async () => {
  const { pia } = await world();
  globalThis.game.users.find(u => u.id === "u-test").active = false;
  await assert.rejects(downtime.start({ days: 3 }), /no characters are taking part \(none connected; pass actorIds/);
  globalThis.game.users.find(u => u.id === "u-test").active = true;
  await assert.rejects(downtime.start({ days: 3, actorIds: ["Pia", "Nobody"] }), /no character found for "Nobody"/);
  assert.deepEqual([days(pia), downtime.isOpen()], [0, false]);
});

test("a failure while granting takes back the days already given, and the period stays closed", async () => {
  const { pia, orin } = await world();
  const real = orin.update.bind(orin);
  orin.update = async () => { throw new Error("orin update failed"); };
  await assert.rejects(downtime.start({ days: 4, actorIds: [pia, orin] }), /orin update failed/);
  orin.update = real;
  assert.deepEqual([days(pia), days(orin), downtime.isOpen()], [0, 0, false]);
  assert.deepEqual(audit.scan(), []);
});

test("addLate gives the absent player's character the MOST free days any participant has left", async () => {
  const { pia, orin, bystander } = await world();
  await downtime.start({ days: 6, actorIds: [pia, bystander] });
  await pia.update({ [`flags.${M}.downtimeDays`]: 2 }); // Pia spent some
  const late = await downtime.addLate("Orin");
  assert.deepEqual([late.days, days(orin)], [6, 6], "the bystander still has all 6");
  assert.deepEqual(downtime.state().participants.orin, { granted: 6, spent: 0, late: true });
  await assert.rejects(downtime.addLate("Orin"), /already taking part/);
  await bystander.update({ [`flags.${M}.downtimeDays`]: 0 });
  await pia.update({ [`flags.${M}.downtimeDays`]: 0 });
  await orin.update({ [`flags.${M}.downtimeDays`]: 0 });
  await assert.rejects(downtime.addLate(fakeActor("new", "New")), /no character found|nobody has any free days/);
});

test("addLate before the period is open is refused in plain words", async () => {
  const { orin } = await world();
  await assert.rejects(downtime.addLate(orin), /Downtime isn't open right now/);
});

test("the ledger shows start, late join and end, per character and as world events", async () => {
  const { pia, orin } = await world();
  await downtime.start({ days: 5 });
  await downtime.addLate(orin);
  await downtime.end({}, { queueCount: () => 0, rejectAll: async () => 0 });
  assert.deepEqual(events().map(e => e.split(/[:;]/)[0]), ["downtime started", "late joiner", "downtime ended"]);
  const piaHistory = env.values.auditLedger.pia.history.map(h => h.text);
  assert.ok(piaHistory.some(t => /downtime started: \+5 day\(s\)/.test(t)));
  assert.ok(piaHistory.some(t => /downtime ended: 5 unspent day\(s\) expired/.test(t)));
  assert.ok(env.values.auditLedger.orin.history.some(h => /late joiner: \+5 day\(s\)/.test(h.text)));
  assert.deepEqual(audit.scan(), []);
});

// The gate in the queue -----------------------------------------------------------------------------------------------
async function researchWorld() {
  const w = await world();
  await research.startProject(api, { actor: w.pia, recipe: "dagger-spider-fang", threshold: 50 });
  await research.startProject(api, { actor: w.orin, recipe: "dagger-spider-fang", threshold: 50 });
  return w;
}
const submitResearch = (actor, n = 1) => queue.submit(actor, "research", { projectId: "unlock-dagger-spider-fang" }, n);

test("GATE (players): closed downtime refuses; a non-participant is refused; a participant may queue", async () => {
  const { pia, orin } = await researchWorld();
  await pia.update({ [`flags.${M}.downtimeDays`]: 5 });
  await orin.update({ [`flags.${M}.downtimeDays`]: 5 });
  globalThis.game.user.isGM = false;
  await assert.rejects(submitResearch(pia), /^Error: Downtime isn't open right now$/);
  globalThis.game.user.isGM = true;
  await downtime.start({ days: 3, actorIds: [pia] });
  globalThis.game.user.isGM = false;
  await assert.rejects(submitResearch(orin), /^Error: Downtime is open, but you weren't here for it$/);
  await assert.doesNotReject(submitResearch(pia));
  globalThis.game.user.isGM = true;
  await downtime.addLate(orin);
  globalThis.game.user.isGM = false;
  await assert.doesNotReject(submitResearch(orin));
});

test("GATE: an explore action and a commission CRAFT are gated too; commission requests and answers (no time) are not", async () => {
  const { pia } = await researchWorld();
  globalThis.game.user.isGM = false;
  await assert.rejects(queue.submit(pia, "explore", { region: "oak-wood", skill: "survival" }, 2), /Downtime isn't open right now/);
  await assert.rejects(queue.submit(pia, "commission", { step: "craft", id: "c-x" }, 0), /Downtime isn't open right now/);
  await assert.rejects(queue.submit(pia, "commission", { step: "accept", id: "c-x" }, 0), /no commission "c-x"/, "not gated: it fails on its own merits");
  await assert.rejects(queue.submit(pia, "commission", { step: "request", crafter: "Orin", recipe: "dagger-spider-fang" }, 0), /you do not own the formula/, "not gated either");
});

test("a player cannot dodge the gate by claiming zero days", async () => {
  const { pia } = await researchWorld();
  globalThis.game.user.isGM = false;
  await assert.rejects(submitResearch(pia, 0), /days must be a whole number of at least 1/);
});

test("GM OVERRIDE: a GM queueing on someone's behalf, or using a GM tool, goes around the gate and the ledger says so; no note when it was allowed anyway", async () => {
  const { pia } = await researchWorld();
  await pia.update({ [`flags.${M}.downtimeDays`]: 4 });
  await submitResearch(pia);                                                  // downtime closed, called as GM
  await research.research({ actor: pia, project: "unlock-dagger-spider-fang", days: 1, degree: "success", chat: false }, api);
  assert.deepEqual(events(), [
    "GM override: queued a research action for Pia (Downtime isn't open right now)",
    "GM override: research for Pia (Downtime isn't open right now)"
  ]);
  await downtime.start({ days: 2, actorIds: [pia] });
  const before = events().length;
  await research.research({ actor: pia, project: "unlock-dagger-spider-fang", days: 1, degree: "success", chat: false }, api);
  assert.equal(events().length, before, "an allowed GM action writes no override note");
  assert.doesNotMatch(events().at(-1), /override/);
  assert.match(events().at(-1), /downtime started/);
});

test("the gate is checked again when the GM resolves: an action that survived a closed period is refunded, not run", async () => {
  const { pia } = await researchWorld();
  await downtime.start({ days: 3, actorIds: [pia] });
  const action = await submitResearch(pia, 2);
  assert.equal(days(pia), 1);
  env.values.downtime = {}; // the period was closed behind the queue's back
  pia.rolls.push(roll(3, 30, 20), roll(3, 30, 20));
  const { results } = await queue.resolveAll(api, { chat: false });
  assert.equal(results[0].status, "invalid");
  assert.match(results[0].message, /Downtime isn't open right now\. 2 day\(s\) refunded/);
  assert.deepEqual([days(pia), pia.getFlag(M, "pendingActions"), pia.rolls.length], [3, [], 2], "refunded, removed, and no roll was spent");
});

test("spent days are recorded when a queued action resolves", async () => {
  const { pia } = await researchWorld();
  await downtime.start({ days: 6, actorIds: [pia] });
  await submitResearch(pia, 3);
  pia.rolls.push(roll(1, 5, 3), roll(1, 5, 3), roll(1, 5, 3));
  await queue.resolveAll(api, { chat: false });
  assert.equal(downtime.state().participants.pia.spent, 3);
});

// Ending ---------------------------------------------------------------------------------------------------------------
test("END is BLOCKED while anything is queued: it reports how many and changes NOTHING", async () => {
  const { pia } = await researchWorld();
  await downtime.start({ days: 6, actorIds: [pia] });
  await submitResearch(pia, 2);
  const deps = { queueCount: () => queue.list().length, rejectAll: () => queue.rejectAll() };
  const before = JSON.stringify([pia.flags, env.values.downtime, env.values.auditLedger]);
  assert.deepEqual(await downtime.end({}, deps), { blocked: 1 });
  assert.deepEqual(await downtime.end({ force: false }, deps), { blocked: 1 });
  assert.equal(JSON.stringify([pia.flags, env.values.downtime, env.values.auditLedger]), before);
  assert.equal(downtime.isOpen(), true);
});

test("END with force returns the queued items (days refunded), then every unspent day EXPIRES; the period closes", async () => {
  const { pia, orin, bystander } = await researchWorld();
  await downtime.start({ days: 6, actorIds: [pia] });
  await submitResearch(pia, 2);
  await research.grantDays(bystander, 9); // a GM grant, so the ledger knows about it
  const deps = { queueCount: () => queue.list().length, rejectAll: () => queue.rejectAll() };
  const result = await downtime.end({ force: true }, deps);
  assert.deepEqual([result.ended, result.rejected, result.expired], [true, 1, { pia: 6, bys: 9 }]);
  assert.deepEqual([days(pia), days(orin), days(bystander)], [0, 0, 0], "everyone's days expire");
  assert.deepEqual([pia.getFlag(M, "pendingActions"), downtime.isOpen()], [[], false]);
  assert.match(events().at(-1), /downtime ended \(forced, 1 queued item\(s\) returned\); expired days: Pia 6, Bystander 9/);
  assert.deepEqual(audit.scan(), []);
  await assert.rejects(downtime.end({}, deps), /Downtime isn't open right now/);
});

test("END with an empty queue just closes it; nothing carries over to the next period", async () => {
  const { pia } = await researchWorld();
  await downtime.start({ days: 4, actorIds: [pia] });
  await pia.update({ [`flags.${M}.downtimeDays`]: 3 });
  assert.equal((await downtime.end({}, { queueCount: () => 0, rejectAll: async () => 0 })).ended, true);
  assert.equal(days(pia), 0);
  await downtime.start({ days: 2, actorIds: [pia] });
  assert.equal(days(pia), 2, "a fresh period, a fresh grant: no catch-up");
});

test("grantDays and setDays remain GM tools that work whether or not downtime is open", async () => {
  const { pia } = await world();
  await research.grantDays(pia, 3);
  await research.setDays(pia, 7);
  assert.equal(days(pia), 7);
  globalThis.game.user.isGM = false;
  await assert.rejects(research.grantDays(pia, 1), /GM only/);
});
