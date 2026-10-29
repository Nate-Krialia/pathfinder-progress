/**
 * Runs the REAL commission store, queue, audit and craft pipeline against fake Foundry objects:
 * actors with coins and material stacks, a world commission list, chat. Every write counts as an
 * "operation", so a failure can be injected at EACH one to prove nothing is left half-applied.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as adapter from "../scripts/adapter/pf2e.js";
import * as commissions from "../scripts/commissions/store.js";
import * as research from "../scripts/research/store.js";
import * as queue from "../scripts/queue/store.js";
import * as audit from "../scripts/audit/store.js";
import { previewCraft } from "../scripts/crafting/craft.js";
import { asPage, openDowntime, seedRecords, UUID, UUID_2 } from "./helpers.js";

const M = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const api = { definitions: registry, contexts: new Map(), uncraftable: new Set(), resolvedOutputs: new Map([["dagger-spider-fang", { "1": UUID, "2": UUID_2, "3": UUID }]]) };
const clone = v => (v === undefined ? undefined : structuredClone(v));
const DAGGER = "dagger-spider-fang";
const SEL = { blade: "iron", fang: "spider-fang" };
const roll = (degreeOfSuccess, total, natural) => ({ options: { degreeOfSuccess }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

// Fake Foundry -----------------------------------------------------------------------------------------------
const env = { ops: 0, failAt: null, chat: [], values: {}, notices: [] };
function tick(label) {
  env.ops++;
  if (env.failAt === env.ops) throw new Error(`injected failure at operation ${env.ops} (${label})`);
}

function applyFlat(target, data) {
  for (const [path, value] of Object.entries(data)) {
    const parts = path.replace(`flags.${M}.`, "").split(".");
    let o = target;
    for (const part of parts.slice(0, -1)) o = (o[part] ??= {});
    o[parts.at(-1)] = clone(value);
  }
}

let idCounter = 0;
function fakeItem(actor, data) {
  const item = {
    id: `item${++idCounter}`, name: data.name, type: data.type, system: { ...(data.system ?? {}) }, flags: clone(data.flags ?? {}),
    getFlag: (scope, key) => clone(item.flags[scope]?.[key]),
    toObject: () => clone({ name: item.name, type: item.type, system: item.system, flags: item.flags }),
    async update(change) { tick("item.update"); if ("system.quantity" in change) item.system.quantity = change["system.quantity"]; },
    async delete() { tick("item.delete"); actor.items.splice(actor.items.indexOf(item), 1); }
  };
  return item;
}

function fakeActor(id, name, { copper = 0, owner = true } = {}) {
  const flags = {};
  const items = [];
  items.get = itemId => items.find(i => i.id === itemId);
  const actor = {
    id, name, flags, items, copper, isOwner: owner, type: "character", rolls: [],
    getFlag: (scope, key) => (scope === M ? clone(flags[key]) : undefined),
    async setFlag(scope, key, value) { flags[key] = clone(value); },
    async update(data) { tick("actor.update"); applyFlat(flags, data); },
    inventory: {
      coins: { get copperValue() { return actor.copper; } },
      async addCoins(c) { tick("addCoins"); actor.copper += c.gp * 100 + c.sp * 10 + c.cp; },
      async removeCoins(c) {
        tick("removeCoins");
        const cost = c.gp * 100 + c.sp * 10 + c.cp;
        if (cost > actor.copper) return false;
        actor.copper -= cost;
        return true;
      }
    },
    skills: Object.fromEntries(["crafting", "survival"].map(slug => [slug, { mod: 5, check: { roll: async () => actor.rolls.shift() } }])),
    async createEmbeddedDocuments(type, datas) {
      tick("createEmbeddedDocuments");
      return datas.map(d => { const item = fakeItem(actor, d); items.push(item); return item; });
    }
  };
  return actor;
}

function install(actors) {
  env.ops = 0; env.failAt = null; env.chat = []; env.notices = [];
  env.values = { auditLedger: {}, commissions: [], partyLocation: "oakhaven", stationState: [], extraPacks: "", itemPacks: "" };
  const list = [...actors];
  list.get = id => list.find(a => a.id === id);
  list.has = id => list.some(a => a.id === id);
  list.getName = name => list.find(a => a.name === name);
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: t => t }, actors: list,
    settings: { get: (s, k) => (k === "downtime" ? openDowntime(list.map(a => a.id)) : clone(env.values[k])), set: async (s, k, v) => { tick(`settings.set ${k}`); env.values[k] = clone(v); } }
  };
  globalThis.foundry = { utils: { randomID: () => `r${++idCounter}` } };
  globalThis.CONFIG = { Dice: { randomUniform: () => 0.99 }, PF2E: { skills: { crafting: { label: "Crafting" }, survival: { label: "Survival" } } } };
  globalThis.ChatMessage = { create: async m => { env.chat.push(m); }, getSpeaker: () => ({}) };
  globalThis.ui = { notifications: { info: m => env.notices.push(m), warn: m => env.notices.push(m), error: m => env.notices.push(m) } };
  globalThis.fromUuid = async () => ({ toObject: () => ({ name: "Dagger", type: "weapon", system: {}, flags: {} }) });
  queue.bind(api);
}

const give = (actor, id, n) => adapter.giveMaterial(actor, registry.material.get(id), n);
const stack = (actor, materialId) => actor.items.filter(i => i.getFlag(M, "material")?.materialId === materialId).reduce((n, i) => n + i.system.quantity, 0);
const flag = (actor, key) => actor.getFlag(M, key);
const loanOf = actor => (flag(actor, "formulas") ?? []).find(f => f.recipeId === DAGGER);
const gp = actor => actor.copper / 100;

/** Everything a commission craft can change, in a comparable form. */
function snapshot(actors) {
  return JSON.stringify({
    actors: actors.map(a => ({
      id: a.id, copper: a.copper, flags: a.flags,
      items: a.items.map(i => `${i.name}|${i.system.quantity}|${JSON.stringify(i.flags)}`).sort()
    })),
    commissions: env.values.commissions, ledger: env.values.auditLedger
  });
}

/**
 * patron (Aelwyn, 20 gp, owns the dagger formula, 3 iron + 3 spider-fang) and crafter (Borin, 3 gp).
 * The crafter reaches the Oakhaven Forge (tier 2, fee 5 gp).
 */
async function world({ patronCopper = 2000, crafterCopper = 300 } = {}) {
  const patron = fakeActor("pat", "Aelwyn", { copper: patronCopper });
  const crafter = fakeActor("cra", "Borin", { copper: crafterCopper });
  install([patron, crafter]);
  await research.grantFormula(api, patron, DAGGER);
  await give(patron, "iron", 3);
  await give(patron, "spider-fang", 3);
  env.ops = 0;
  return { patron, crafter, both: [patron, crafter] };
}

/** Request -> resolve -> accept -> resolve, through the queue, as players. Returns the commission id. */
async function acceptedPlayerJob(patron, crafter, spec = {}, acceptOptions = {}) {
  globalThis.game.user.isGM = false;
  await queue.submit(patron, "commission", { step: "request", crafter: crafter.name, recipe: DAGGER, access: "loan", selection: SEL, payout: 12, ...spec }, 0);
  globalThis.game.user.isGM = true;
  await queue.resolveAll(api, { chat: false });
  const created = commissions.readCommissions().at(-1);
  globalThis.game.user.isGM = false;
  await queue.submit(crafter, "commission", { step: "accept", id: created.id, ...acceptOptions }, 0);
  globalThis.game.user.isGM = true;
  await queue.resolveAll(api, { chat: false });
  return created.id;
}
const status = id => commissions.getCommission(id).status;

// The player-to-player flow, through the queue -------------------------------------------------------------------
test("request -> accept through the queue: no days, the list is written only by the GM, a loan appears, the audit is clean", async () => {
  const { patron, crafter } = await world();
  globalThis.game.user.isGM = false;
  const action = await queue.submit(patron, "commission", { step: "request", crafter: "Borin", recipe: DAGGER, selection: SEL, payout: 12 }, 0);
  assert.equal(action.daysReserved, 0);
  assert.equal(action.params.crafter, "cra", "the crafter's name was turned into an id");
  assert.deepEqual(env.values.commissions, [], "a player's request does not touch the list");
  await assert.rejects(commissions.issue(api, { patron: "x", crafter, recipe: DAGGER, payout: 1 }), /GM only/);
  globalThis.game.user.isGM = true;

  const [row] = queue.list();
  assert.match(row.label, /Commission request: Aelwyn asks Borin to craft Spider Fang Dagger/);
  assert.match(row.detail, /loan, payout 12 gp; Aelwyn holds the formula; Aelwyn has 20 gp/);
  assert.equal(row.problem, null);

  const first = await queue.resolveAll(api, { chat: false });
  assert.equal(first.results[0].status, "resolved");
  const [c] = commissions.readCommissions();
  assert.deepEqual([c.status, c.source, c.materialsFrom, c.access, c.payout, c.learnRoll], ["requested", "player", "patron", "loan", 12, false]);
  assert.deepEqual(flag(patron, "pendingActions"), [], "the request left the queue");
  assert.equal(loanOf(crafter), undefined, "no loan before the crafter accepts");

  globalThis.game.user.isGM = false;
  await queue.submit(crafter, "commission", { step: "accept", id: c.id }, 0);
  globalThis.game.user.isGM = true;
  assert.match(queue.list()[0].label, /Commission accept: Aelwyn -> Borin: Spider Fang Dagger \(loan, 12 gp, requested\)/);
  const second = await queue.resolveAll(api, { chat: false });
  assert.equal(second.results[0].status, "resolved");
  assert.equal(status(c.id), "accepted");
  assert.deepEqual([loanOf(crafter).access, loanOf(crafter).commissions], ["loan", [c.id]]);
  assert.deepEqual(audit.scan(), []);
  assert.equal(flag(crafter, "downtimeDays") ?? 0, 0, "no downtime days were touched");
});

test("refusals as a player: no formula, wrong status, the wrong character, and GM-only tools", async () => {
  const { patron, crafter } = await world();
  const stranger = fakeActor("zed", "Zed");
  globalThis.game.actors.push(stranger);
  globalThis.game.user.isGM = false;
  await assert.rejects(queue.submit(stranger, "commission", { step: "request", crafter: "Borin", recipe: DAGGER, selection: SEL, payout: 5 }, 0), /you do not own the formula/);
  await assert.rejects(queue.submit(patron, "commission", { step: "request", crafter: "Nobody", recipe: DAGGER, selection: SEL, payout: 5 }, 0), /cannot find the crafter "Nobody"/);
  await assert.rejects(queue.submit(patron, "commission", { step: "request", crafter: "Aelwyn", recipe: DAGGER, selection: SEL, payout: 5 }, 0), /different characters/);
  await assert.rejects(queue.submit(patron, "commission", { step: "request", crafter: "Borin", recipe: DAGGER, selection: SEL, payout: 5 }, 1), /cost no days/);
  await assert.rejects(queue.submit(patron, "research", { projectId: "x" }, 0), /days must be a whole number of at least 1|no project/);
  globalThis.game.user.isGM = true;

  const id = await acceptedPlayerJob(patron, crafter);
  globalThis.game.user.isGM = false;
  await assert.rejects(queue.submit(crafter, "commission", { step: "accept", id }, 0), /is accepted, so it cannot be accepted/, "wrong status");
  await assert.rejects(queue.submit(patron, "commission", { step: "craft", id, selection: SEL }, 0), /only the crafter \(or the GM\) can craft/, "the patron cannot craft");
  await assert.rejects(queue.submit(crafter, "commission", { step: "cancel", id }, 0), /only the patron \(or the GM\) can cancel/, "the crafter cannot cancel");
  await assert.rejects(queue.submit(stranger, "commission", { step: "cancel", id }, 0), /only the patron/);
  for (const call of [
    () => commissions.craftForCommission(api, id, {}), () => commissions.cancelStep(id), () => commissions.acceptStep(api, id),
    () => commissions.declineStep(id), () => commissions.issue(api, { patron: "x", crafter, recipe: DAGGER, payout: 1 })
  ]) await assert.rejects(call(), /GM only/);
  assert.equal(status(id), "accepted");
});

test("a request whose patron lost the formula before the GM resolved it is INVALID and removed; the list is untouched", async () => {
  const { patron, crafter } = await world();
  globalThis.game.user.isGM = false;
  await queue.submit(patron, "commission", { step: "request", crafter: "Borin", recipe: DAGGER, selection: SEL, payout: 12 }, 0);
  globalThis.game.user.isGM = true;
  await research.removeFormula(patron, DAGGER);
  const { results } = await queue.resolveAll(api, { chat: false });
  assert.equal(results[0].status, "invalid");
  assert.match(results[0].message, /does not hold the formula/);
  assert.deepEqual([env.values.commissions, flag(patron, "pendingActions")], [[], []]);
  assert.equal(crafter.copper, 300);
});

test("'as loan instead': a copy offer taken as a loan gives a loan, not the formula", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter, { access: "copy" }, { as: "loan" });
  const c = commissions.getCommission(id);
  assert.deepEqual([c.status, c.access, loanOf(crafter).access, loanOf(crafter).commissions], ["accepted", "loan", "loan", [id]]);
  assert.match(c.log.at(-1).text, /accepted as a loan instead of a copy/);
  assert.deepEqual(audit.scan(), []);
});

test("a copy is learned for good at accept, and cancelling does not take it back", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter, { access: "copy" });
  assert.deepEqual([loanOf(crafter).access, loanOf(crafter).source, loanOf(crafter).commissions], ["owned", "commission", undefined]);
  await commissions.cancelStep(id, { reason: "changed my mind" });
  assert.equal(status(id), "cancelled");
  assert.equal(loanOf(crafter).access, "owned", "the copy stays");
  assert.deepEqual(audit.scan(), []);
});

test("decline: the commission ends, no loan was ever made", async () => {
  const { patron, crafter } = await world();
  globalThis.game.user.isGM = false;
  await queue.submit(patron, "commission", { step: "request", crafter: "Borin", recipe: DAGGER, selection: SEL, payout: 12 }, 0);
  globalThis.game.user.isGM = true;
  await queue.resolveAll(api, { chat: false });
  const [c] = commissions.readCommissions();
  globalThis.game.user.isGM = false;
  await queue.submit(crafter, "commission", { step: "decline", id: c.id }, 0);
  globalThis.game.user.isGM = true;
  const { results } = await queue.resolveAll(api, { chat: false });
  assert.equal(results[0].status, "resolved");
  assert.equal(status(c.id), "declined");
  assert.equal(loanOf(crafter), undefined);
  assert.deepEqual(audit.scan(), []);
});

test("cancel: the patron cancels through the queue, a loan disappears; delivered and cancelled commissions cannot be cancelled", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  assert.ok(loanOf(crafter));
  globalThis.game.user.isGM = false;
  await queue.submit(patron, "commission", { step: "cancel", id }, 0);
  globalThis.game.user.isGM = true;
  const { results } = await queue.resolveAll(api, { chat: false });
  assert.match(results[0].message, /cancelled/);
  assert.equal(status(id), "cancelled");
  assert.equal(loanOf(crafter), undefined, "the loan is gone");
  assert.deepEqual([patron.copper, crafter.copper, stack(patron, "iron")], [2000, 300, 3], "nothing was held, so nothing to refund");
  globalThis.game.user.isGM = false;
  await assert.rejects(queue.submit(patron, "commission", { step: "cancel", id }, 0), /is cancelled, so it cannot be cancelled/);
  assert.deepEqual(audit.scan(), []);
});

// Crafting --------------------------------------------------------------------------------------------------------------
test("a loaned formula cannot be crafted generically, only through its commission", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  await give(crafter, "iron", 1); await give(crafter, "spider-fang", 1);
  const generic = previewCraft(crafter, DAGGER, SEL, api);
  assert.equal(generic.ok, false);
  assert.match(generic.errors[0], /on loan for a commission, so it can only be crafted through that commission/);
  assert.equal(commissions.prepareCommissionCraft(api, id).ok, true);
});

test("SUCCESS: item to the patron, fee from the patron, payout patron -> crafter, loan gone, exact numbers", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  assert.deepEqual([gp(patron), gp(crafter), stack(patron, "iron"), stack(patron, "spider-fang")], [20, 3, 3, 3]);

  const result = await commissions.craftForCommission(api, id, { degree: "success" });
  assert.equal(result.delivered, true);
  assert.deepEqual([gp(patron), gp(crafter)], [3, 15], "patron 20 - 5 fee - 12 payout; crafter 3 + 12");
  assert.deepEqual([stack(patron, "iron"), stack(patron, "spider-fang")], [2, 2], "one of each used, from the PATRON's stock");
  assert.deepEqual(patron.items.filter(i => i.type === "weapon").map(i => i.name), ["Spider Fang Dagger"], "the finished item is in the patron's inventory");
  assert.equal(crafter.items.filter(i => i.type === "weapon").length, 0, "the crafter does not get it");
  assert.equal(loanOf(crafter), undefined, "the loan ends on delivery");
  const c = commissions.getCommission(id);
  assert.deepEqual([c.status, c.attempts, c.delivered.degree], ["delivered", 1, "success"]);
  const entry = c.log.at(-1);
  assert.deepEqual([entry.type, entry.degree, entry.feeGp, entry.feePayer, entry.payoutGp, entry.payoutFrom, entry.itemTo], ["craft", "success", 5, "Aelwyn", 12, "Aelwyn", "Aelwyn"]);
  assert.deepEqual(entry.materialsConsumed, [{ materialId: "iron", units: 1 }, { materialId: "spider-fang", units: 1 }]);
  assert.equal(env.chat.length, 1);
  assert.match(env.chat[0].content, /delivered; payout 12 gp/);
  assert.match(env.chat[0].content, /Fee paid by Aelwyn: 5 gp\./, "a character patron is named as the payer");
  assert.deepEqual(audit.scan(), []);
});

test("CRITICAL FAILURE: fee and every material lost, no item, no payout, the commission stays open; then it can still succeed", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  const result = await commissions.craftForCommission(api, id, { degree: "criticalFailure", chat: false });
  assert.equal(result.delivered, false);
  assert.deepEqual([gp(patron), gp(crafter)], [15, 3], "patron lost only the 5 gp fee");
  assert.deepEqual([stack(patron, "iron"), stack(patron, "spider-fang")], [2, 2]);
  assert.equal(patron.items.filter(i => i.type === "weapon").length, 0);
  let c = commissions.getCommission(id);
  assert.deepEqual([c.status, c.attempts, c.delivered], ["inProgress", 1, undefined]);
  assert.ok(loanOf(crafter), "the loan stays while the commission is open");
  assert.deepEqual(audit.scan(), []);

  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success", chat: false }), /needs 17 gp, has 15 gp/, "after paying the fee the patron can no longer cover fee + payout");
  patron.copper += 500; // the patron earns a little more
  await commissions.craftForCommission(api, id, { degree: "success", chat: false });
  c = commissions.getCommission(id);
  assert.deepEqual([c.status, c.attempts, gp(patron), gp(crafter)], ["delivered", 2, 20 - 5 - 12, 15]);
});

test("FAILURE: each unit rolls its own loss; survivors stay with the patron", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  const rolls = [0, 0.99]; // d100 = 1 (lost, chance 50) then 100 (kept)
  globalThis.CONFIG.Dice.randomUniform = () => rolls.shift();
  await commissions.craftForCommission(api, id, { degree: "failure", chat: false });
  assert.deepEqual([stack(patron, "iron"), stack(patron, "spider-fang")], [2, 3], "the blade unit was lost, the fang unit survived");
  assert.deepEqual([gp(patron), gp(crafter), status(id)], [15, 3, "inProgress"]);
  const entry = commissions.getCommission(id).log.at(-1);
  assert.deepEqual([entry.materialsConsumed, entry.materialsKept], [[{ materialId: "iron", units: 1 }], [{ materialId: "spider-fang", units: 1 }]]);
});

test("CAN'T AFFORD: the craft is refused naming the shortfall, and NOTHING changes", async () => {
  const { patron, crafter, both } = await world({ patronCopper: 1000 }); // 10 gp: covers the 5 gp fee, not fee + 12 payout
  const id = await acceptedPlayerJob(patron, crafter);
  const before = snapshot(both);
  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success" }), /Aelwyn cannot cover the 5 gp fee plus the 12 gp payout \(needs 17 gp, has 10 gp\)/);
  assert.equal(snapshot(both), before);
  patron.copper = 300;
  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success" }), /Aelwyn cannot cover the 5 gp fee \(has 3 gp\)/);
  assert.equal(commissions.prepareCommissionCraft(api, id).ok, false);
});

test("MISSING MATERIALS: refused, naming whose stock was checked, and nothing changes", async () => {
  const { patron, crafter, both } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  for (const item of [...patron.items]) if (item.getFlag(M, "material")?.materialId === "spider-fang") patron.items.splice(patron.items.indexOf(item), 1);
  const before = snapshot(both);
  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success" }), /checked against Aelwyn's materials/);
  assert.equal(snapshot(both), before);
});

test("the patron lost the formula after the crafter accepted: the craft is refused", async () => {
  const { patron, crafter, both } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  await research.removeFormula(patron, DAGGER);
  const before = snapshot(both);
  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success" }), /Aelwyn no longer holds the formula/);
  assert.equal(snapshot(both), before);
});

test("a craft step queued by the crafter: refused while the patron cannot pay (error row, stays queued), then works after a top-up", async () => {
  const { patron, crafter } = await world({ patronCopper: 1000 });
  const id = await acceptedPlayerJob(patron, crafter);
  globalThis.game.user.isGM = false;
  await queue.submit(crafter, "commission", { step: "craft", id }, 0);
  globalThis.game.user.isGM = true;
  const [row] = queue.list();
  assert.match(row.problem, /Aelwyn cannot cover the 5 gp fee plus the 12 gp payout/);
  const first = await queue.resolveAll(api, { chat: false, degree: "success" });
  assert.equal(first.results[0].status, "error");
  assert.equal(flag(crafter, "pendingActions").length, 1, "still queued");
  assert.equal(status(id), "accepted");
  patron.copper = 2000;
  const retry = await queue.resolveAction(api, crafter, flag(crafter, "pendingActions")[0].id, { chat: false, degree: "success" });
  assert.equal(retry.status, "resolved");
  assert.deepEqual([status(id), flag(crafter, "pendingActions"), gp(crafter)], ["delivered", [], 15]);
  assert.deepEqual(audit.scan(), []);
});

// The GM-issued flow ----------------------------------------------------------------------------------------------------
test("GM-issued, NPC patron, crafter supplies materials: own stock used, fee waived, payout created, NO item, delivered record", async () => {
  const { crafter, patron } = await world();
  const { commission, warnings, suggestion } = await commissions.issue(api, { patron: "Old Brannock, the miller", crafter, recipe: DAGGER, selection: SEL });
  assert.deepEqual([commission.patron, commission.materialsFrom, commission.learnRoll, commission.source], [{ type: "lightweight", name: "Old Brannock, the miller" }, "crafter", true, "gm"]);
  assert.equal(commission.payout, suggestion.payout, "no payout given: the suggested one is used");
  assert.deepEqual(warnings, []);
  await give(crafter, "iron", 2); await give(crafter, "spider-fang", 2);
  globalThis.game.user.isGM = false;
  await queue.submit(crafter, "commission", { step: "accept", id: commission.id }, 0);
  globalThis.game.user.isGM = true;
  await queue.resolveAll(api, { chat: false });
  assert.equal(status(commission.id), "accepted");

  const before = gp(crafter);
  await commissions.craftForCommission(api, commission.id, { degree: "success", selection: SEL, learnDegree: "failure" });
  assert.deepEqual([stack(crafter, "iron"), stack(crafter, "spider-fang")], [1, 1], "the crafter's own stock paid for it");
  assert.equal(gp(crafter), before + commission.payout, "payout created as gold; the fee was waived");
  assert.equal(crafter.items.filter(i => i.type === "weapon").length, 0, "no item is created for an NPC patron");
  const card = env.chat.map(m => m.content).join("\n");
  assert.doesNotMatch(card, /Fee paid/, "the card must not claim a fee was paid");
  assert.match(card, /Fee waived \(paid by the NPC patron\)\./);
  assert.equal(patron.items.filter(i => i.type === "weapon").length, 0);
  const c = commissions.getCommission(commission.id);
  assert.deepEqual([c.status, c.delivered.itemName, c.log.at(-1).feePayer, c.log.at(-1).feeGp, c.log.at(-1).itemTo], ["delivered", "Spider Fang Dagger", "waived (NPC patron)", 0, "no item (NPC patron)"]);
  assert.deepEqual(audit.scan(), []);
});

test("GM-issued, NPC supplies the materials: the crafter needs none and keeps none; a failed attempt leaves no residue", async () => {
  const { crafter } = await world();
  const { commission } = await commissions.issue(api, { patron: "Old Brannock", crafter, recipe: DAGGER, selection: SEL, materialsFrom: "npc", payout: 20, learnRoll: false });
  await commissions.acceptStep(api, commission.id);
  const items = crafter.items.length;
  await commissions.craftForCommission(api, commission.id, { degree: "criticalFailure", chat: false });
  assert.equal(crafter.items.length, items, "no inventory changes");
  assert.equal(status(commission.id), "inProgress");
  await commissions.craftForCommission(api, commission.id, { degree: "success", chat: false });
  assert.deepEqual([status(commission.id), gp(crafter), crafter.items.length], ["delivered", 23, items]);
});

test("issue validates: payout/selection rules, unknown recipe, and an NPC patron cannot supply materials", async () => {
  const { crafter } = await world();
  await assert.rejects(commissions.issue(api, { patron: "X", crafter, recipe: DAGGER }), /give a payout, or a selection/);
  await assert.rejects(commissions.issue(api, { patron: "X", crafter, recipe: "ghost", payout: 1 }), /the recipe "ghost" no longer exists/);
  await assert.rejects(commissions.issue(api, { patron: "X", crafter, recipe: DAGGER, payout: 1, materialsFrom: "patron" }), /cannot supply materials/);
  await assert.rejects(commissions.issue(api, { patron: "X", crafter, recipe: DAGGER, payout: 0.005 }), /copper pieces/);
  const warned = await research.grantFormula(api, crafter, DAGGER).then(() => commissions.issue(api, { patron: "X", crafter, recipe: DAGGER, payout: 5, teaches: { type: "fullCopy" } }));
  assert.equal(warned.warnings.length, 3, "the crafter already knows it: three warnings");
});

// Learn roll and teaches ----------------------------------------------------------------------------------------------------
async function npcJob(crafter, extra = {}) {
  const { commission } = await commissions.issue(api, { patron: "Old Brannock", crafter, recipe: DAGGER, selection: SEL, materialsFrom: "npc", payout: 10, ...extra });
  await commissions.acceptStep(api, commission.id);
  return commission.id;
}
const projectOf = actor => (flag(actor, "projects") ?? []).find(p => p.id === `unlock-${DAGGER}`);

test("LEARN ROLL: with no project one is started; progress follows the degree; it happens ONCE, on the first attempt", async () => {
  const { crafter } = await world();
  const id = await npcJob(crafter);
  assert.equal(projectOf(crafter), undefined);
  await commissions.craftForCommission(api, id, { degree: "criticalFailure", learnDegree: "criticalSuccess", chat: false });
  assert.deepEqual([projectOf(crafter).progress, projectOf(crafter).status], [2, "active"], "crit success = 2 progress, and the project exists now");
  let c = commissions.getCommission(id);
  assert.equal(c.learnAttempted, true);
  assert.deepEqual([c.log.at(-1).learn.degree, c.log.at(-1).learn.started, c.log.at(-1).learn.progress], ["criticalSuccess", true, 2]);

  await commissions.craftForCommission(api, id, { degree: "failure", learnDegree: "criticalSuccess", chat: false });
  assert.equal(projectOf(crafter).progress, 2, "no second learn roll");
  assert.equal(commissions.getCommission(id).log.at(-1).learn, undefined);
  assert.ok(loanOf(crafter).commissions, "still only a loan");
  assert.deepEqual(audit.scan(), []);
});

test("learn roll degrees: success 1, failure 0, critical failure 0", async () => {
  for (const [degree, progress] of [["success", 1], ["failure", 0], ["criticalFailure", 0]]) {
    const { crafter } = await world();
    const id = await npcJob(crafter);
    await commissions.craftForCommission(api, id, { degree: "failure", learnDegree: degree, chat: false });
    assert.equal(projectOf(crafter).progress, progress, degree);
  }
});

test("learn roll uses an EXISTING project, and completing it makes the formula permanent (owned), ending the loan", async () => {
  const { crafter } = await world();
  await research.startProject(api, { actor: crafter, recipe: DAGGER, threshold: 1 });
  const id = await npcJob(crafter);
  await commissions.craftForCommission(api, id, { degree: "failure", learnDegree: "success", chat: false });
  assert.deepEqual([projectOf(crafter).status, loanOf(crafter).access, loanOf(crafter).commissions, loanOf(crafter).source], ["complete", "owned", undefined, "commission-learn"]);
  assert.equal(commissions.getCommission(id).log.at(-1).learn.formulaLearned, true);
  assert.equal(status(id), "inProgress", "the commission itself is still open");
  await commissions.craftForCommission(api, id, { degree: "success", chat: false });
  assert.equal(status(id), "delivered");
  assert.equal(loanOf(crafter).access, "owned", "learned for good: not removed on delivery");
  assert.deepEqual(audit.scan(), []);
});

test("learn roll is skipped when off, on a copy, or when the crafter already owns the formula", async () => {
  const off = await world();
  const idOff = await npcJob(off.crafter, { learnRoll: false });
  await commissions.craftForCommission(api, idOff, { degree: "failure", learnDegree: "success", chat: false });
  assert.equal(projectOf(off.crafter), undefined);
  assert.equal(commissions.getCommission(idOff).learnAttempted, false);

  const owns = await world();
  await research.grantFormula(api, owns.crafter, DAGGER);
  const idOwn = await npcJob(owns.crafter);
  await commissions.craftForCommission(api, idOwn, { degree: "success", learnDegree: "success", chat: false });
  assert.equal(projectOf(owns.crafter), undefined, "no project, no roll: it is already known");
  assert.equal(loanOf(owns.crafter).access, "owned");
});

test("a real learn roll goes through PF2e (natural d20 recorded); an abandoned project is started afresh", async () => {
  const { crafter } = await world();
  await research.startProject(api, { actor: crafter, recipe: DAGGER });
  await research.abandonProject(crafter, `unlock-${DAGGER}`);
  const id = await npcJob(crafter);
  crafter.rolls.push(roll(2, 20, 15));
  await commissions.craftForCommission(api, id, { degree: "failure", chat: false });
  assert.deepEqual([projectOf(crafter).status, projectOf(crafter).progress], ["active", 1]);
  assert.equal(commissions.getCommission(id).log.at(-1).learn.natural, 15);
});

test("TEACHES progress: on delivery, even with no learn roll; TEACHES fullCopy: the formula becomes owned", async () => {
  const a = await world();
  const idP = await npcJob(a.crafter, { teaches: { type: "progress", amount: 3 }, learnRoll: false });
  await commissions.craftForCommission(api, idP, { degree: "failure", chat: false });
  assert.equal(projectOf(a.crafter), undefined, "nothing is taught until delivery");
  await commissions.craftForCommission(api, idP, { degree: "success", chat: false });
  assert.equal(projectOf(a.crafter).progress, 3);
  assert.equal(commissions.getCommission(idP).log.at(-1).learn.taught, 3);
  assert.equal(loanOf(a.crafter), undefined, "the loan ended on delivery; the formula is not owned yet");

  const b = await world();
  const idF = await npcJob(b.crafter, { teaches: { type: "fullCopy" }, learnRoll: false });
  await commissions.craftForCommission(api, idF, { degree: "success", chat: false });
  assert.deepEqual([loanOf(b.crafter).access, loanOf(b.crafter).source], ["owned", "commission"]);
  assert.deepEqual(audit.scan(), []);
});

test("teaches progress that completes the project grants the formula; the learn roll and teaches add up", async () => {
  const { crafter } = await world();
  await research.startProject(api, { actor: crafter, recipe: DAGGER, threshold: 4 });
  const id = await npcJob(crafter, { teaches: { type: "progress", amount: 3 } });
  await commissions.craftForCommission(api, id, { degree: "success", learnDegree: "success", chat: false });
  assert.equal(projectOf(crafter).status, "complete", "1 (learn) + 3 (taught) reaches the threshold of 4");
  assert.equal(loanOf(crafter).access, "owned");
});

// Several commissions, listing, audit ---------------------------------------------------------------------------------------
test("two loans for the same recipe share one entry; it goes when the last commission ends", async () => {
  const { patron, crafter } = await world();
  const a = await acceptedPlayerJob(patron, crafter);
  const b = await acceptedPlayerJob(patron, crafter);
  assert.deepEqual(loanOf(crafter).commissions, [a, b]);
  await commissions.cancelStep(a);
  assert.deepEqual(loanOf(crafter).commissions, [b]);
  await commissions.craftForCommission(api, b, { degree: "success", chat: false });
  assert.equal(loanOf(crafter), undefined);
  assert.deepEqual(audit.scan(), []);
});

test("listing: a GM sees everything, a player only commissions of characters they own", async () => {
  const { patron, crafter } = await world();
  await acceptedPlayerJob(patron, crafter);
  assert.equal(commissions.listCommissions().length, 1);
  globalThis.game.user.isGM = false;
  crafter.isOwner = false;
  assert.equal(commissions.listCommissions().length, 1, "the patron's player sees it");
  patron.isOwner = false;
  assert.equal(commissions.listCommissions().length, 0, "a bystander sees nothing");
  crafter.isOwner = true;
  assert.equal(commissions.listCommissions().length, 1, "the crafter's player sees it");
  assert.equal(commissions.listCommissions({ status: "delivered" }).length, 0);
});

test("AUDIT: a forged loan is flagged by both the ledger and the commission check; a deleted loan is flagged; accepting clears the ledger part", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  assert.deepEqual(audit.scan(), []);

  await patron.setFlag(M, "formulas", [...flag(patron, "formulas"), { recipeId: "longsword-basic", access: "loan", source: "player", commissions: ["c-fake"] }]);
  const rows = audit.scan();
  assert.equal(rows.length, 1);
  const kinds = rows[0].mismatches.map(m => m.kind).sort();
  assert.deepEqual(kinds, ["formulaExtra", "loanNoCommission"]);
  assert.match(rows[0].mismatches.find(m => m.kind === "loanNoCommission").message, /no accepted loan commission with that id/);
  await patron.setFlag(M, "formulas", flag(patron, "formulas").filter(f => f.recipeId === DAGGER));
  assert.deepEqual(audit.scan(), []);

  await crafter.setFlag(M, "formulas", []);
  const missing = audit.scan();
  assert.deepEqual(missing[0].mismatches.map(m => m.kind).sort(), ["commissionNoLoan", "formulaMissing"]);
  await audit.accept(crafter);
  assert.deepEqual(audit.scan()[0].mismatches.map(m => m.kind), ["commissionNoLoan"], "accepting resets the ledger, but the commission still lacks its loan");
  assert.equal(status(id), "accepted");
});

// Fault injection: a failure at ANY write leaves the world exactly as it was ------------------------------------------------
async function craftWithFailureAt(failAt, degree) {
  const { patron, crafter, both } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  env.ops = 0;
  globalThis.CONFIG.Dice.randomUniform = () => 0; // a failed craft loses every unit (d100 = 1), so there are stacks to restore
  const before = snapshot(both);
  env.failAt = failAt;
  let error = null;
  try { await commissions.craftForCommission(api, id, { degree, chat: false }); } catch (e) { error = e; }
  env.failAt = null;
  return { error, before, after: snapshot(both), both, id, patron, crafter, ops: env.ops };
}

for (const degree of ["success", "failure", "criticalFailure"]) {
  test(`FAULT INJECTION (${degree}): failing each write in turn leaves gold, materials, items, formulas and the list exactly as they were`, async () => {
    const clean = await craftWithFailureAt(null, degree);
    assert.equal(clean.error, null);
    const writes = clean.ops;
    assert.ok(writes >= (degree === "success" ? 7 : 5), `the craft makes ${writes} writes`);
    // After a SUCCESS the crafter's Compendium learns what they made: one extra, best-effort write AFTER everything committed (docs/11b, B).
    const transactional = degree === "success" ? writes - 1 : writes;
    if (degree === "success") {
      const last = await craftWithFailureAt(writes, degree);
      assert.equal(last.error, null, "a failed Compendium write never fails the craft that already committed");
      assert.equal(status(last.id), "delivered");
    }
    for (let k = 1; k <= transactional; k++) {
      const run = await craftWithFailureAt(k, degree);
      assert.ok(run.error, `a failure at write ${k} must surface`);
      assert.match(run.error.message, new RegExp(`injected failure at operation ${k} `));
      assert.equal(run.after, run.before, `${degree}: after a failure at write ${k} of ${writes}, the world must be unchanged`);
      assert.equal(status(run.id), "accepted");
      assert.deepEqual(audit.scan(), [], `${degree}: the audit stays clean after a failure at write ${k}`);
    }
  });
}

test("FAULT INJECTION: after any injected failure the same craft can simply be run again and succeeds", async () => {
  const run = await craftWithFailureAt(3, "success");
  assert.ok(run.error);
  const result = await commissions.craftForCommission(api, run.id, { degree: "success", chat: false });
  assert.equal(result.delivered, true);
  assert.deepEqual([gp(run.patron), gp(run.crafter)], [3, 15]);
});

test("a second craft of the same commission cannot start while one is running", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  const first = commissions.craftForCommission(api, id, { degree: "success", chat: false });
  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success", chat: false }), /already being crafted/);
  await first;
  assert.equal(status(id), "delivered");
  await assert.rejects(commissions.craftForCommission(api, id, { degree: "success", chat: false }), /is delivered/);
});

test("queue isolation: a bad commission step does not block the others in the batch", async () => {
  const { patron, crafter } = await world();
  const id = await acceptedPlayerJob(patron, crafter);
  // Queue two crafts by hand-written flags: one for a commission that no longer exists, one that works.
  await crafter.update({ [`flags.${M}.pendingActions`]: [
    { id: "x1", type: "commission", params: { step: "craft", id: "c-ghost", selection: SEL }, daysReserved: 0, submittedAt: 1 },
    { id: "x2", type: "commission", params: { step: "craft", id }, daysReserved: 0, submittedAt: 2 }
  ] });
  const { results, summary } = await queue.resolveAll(api, { chat: false, degree: "success" });
  assert.deepEqual(results.map(r => r.status), ["invalid", "resolved"]);
  assert.deepEqual(summary, { resolved: 1, invalid: 1, skipped: 0, errors: 0 });
  assert.equal(status(id), "delivered");
  assert.deepEqual(flag(crafter, "pendingActions"), []);
});

test("commission steps cannot be 'edited' for days, and show no day box in the review window", async () => {
  const { patron } = await world();
  globalThis.game.user.isGM = false;
  const action = await queue.submit(patron, "commission", { step: "request", crafter: "Borin", recipe: DAGGER, selection: SEL, payout: 3 }, 0);
  globalThis.game.user.isGM = true;
  await assert.rejects(queue.editDays(patron, action.id, 2), /costs no days/);
  const { renderReview } = await import("../scripts/queue/review.js");
  const html = renderReview({ rows: queue.list() });
  assert.match(html, /no days/);
  assert.doesNotMatch(html, /data-action="edit-days"/);
});
