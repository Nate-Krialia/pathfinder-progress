/**
 * Foundry-bound "work" actions: queued CRAFT and GATHER (Stage 10a).
 *
 * Both run on the GM client. A player cannot read the recipes or write a node token, so the player's call is relayed
 * to the GM client over socketlib (see relay below), which checks who is asking, takes the escrow, and saves the
 * queued action. Writes that touch the same actor or node run one at a time (lock.js).
 *
 * CRAFT takes its escrow when it is queued: the materials leave the stash, the station fee leaves the purse, and the
 * craft days are reserved. Resolving only CONVERTS that (the fee and days are spent whatever the roll says; the roll
 * decides whether the item is made and how many materials are lost, per unit; the unused ones come back). Cancelling
 * returns everything. GATHER costs charges only: queueing claims one charge on the node, cancelling gives it back,
 * resolving spends it. Gathers need no downtime and never block "End downtime".
 */
import { CRAFTING, MODULE_ID, QUEUE_KEYS, RESEARCH_KEYS as K } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { commit, logWorldEvent } from "../audit/store.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { craftDays } from "../crafting/days.js";
import { previewCraft } from "../crafting/craft.js";
import { resolveOutcome } from "../crafting/outcome.js";
import { formatSummary } from "../crafting/summary.js";
import { gpText } from "../commissions/commission.js";
import * as downtime from "../downtime/store.js";
import * as exploration from "../exploration/store.js";
import { normalizeNode } from "../gathering/node.js";
import { checkGatherable, pickSkill, resolveGather } from "../gathering/resolve.js";
import { release, reserve, reservedOf, reserveProblem, spendReserved } from "../gathering/reserve.js";
import { formatGatherSummary } from "../gathering/summary.js";
import { grantAll, saveNodeRecord } from "../gathering/store.js";
import { daysFrom } from "../research/days.js";
import { rawList } from "../research/store.js";
import { describeEscrow, escrowFromPlan, escrowProblems, refusalText, unusedUnits, virtualStacks } from "./escrow.js";
import { actorKey, nodeKey, withLocks } from "./lock.js";
import { noteGather } from "../compendium/store.js";
import { submitShare } from "../compendium/share.js";
import { submitBuild } from "../workshop/build.js";
import { stationReductions } from "../workshop/rules.js";
import { GENERIC_FAILURE, refusal, unwrap } from "./relay.js";
import { appendAction, assertOwner, callerOf, flagKey, gmIds, giveBack, note, ownerIds, pendingOf, recordReturned, takeEscrow, undoAll, undoThenThrow, whisper } from "./common.js";

// Re-exported: the queue store and the tests reach these through work.js.
export { assertOwner, callerOf, note, recordReturned, undoAll };
import { planReject, planResolve, planSubmit } from "./reservation.js";

export const WORK_TYPES = ["craft", "gather", "share", "build"];
/** Queued actions that cost no downtime days: they never block "End downtime", and a forced end leaves them queued. */
export const NON_BLOCKING_TYPES = ["gather", "share"];
/** Queued actions that hold an escrow record (materials and gold taken when queued): a craft and a build. */
export const ESCROW_TYPES = ["craft", "build"];
export const isWorkType = type => WORK_TYPES.includes(type);

const readRecord = doc => doc.getFlag(MODULE_ID, "node");
const d100 = () => Math.floor(CONFIG.Dice.randomUniform() * 100) + 1;
const rollDie = sides => Math.floor(CONFIG.Dice.randomUniform() * sides) + 1;
const PASS = ["success", "criticalSuccess"];

let boundApi = null;
let socket = null;
/** Give the work actions the module api (definitions). */
export function bind(api) { boundApi = api; }
/** Set by socket.js once the module has registered with socketlib. */
export function setSocket(s) { socket = s; }

/**
 * The craft-day reductions for a craft at a station: the station's craft-day upgrades PLUS any extra source plugged in
 * with setCraftReductions (tools, a bench, a later stage). The 1-day floor is applied by craftDays() AFTER all of them.
 * Passing nothing removes the extra source.
 */
let extraReductions = () => [];
export function setCraftReductions(fn) { extraReductions = typeof fn === "function" ? fn : () => []; }
const reductionsFor = (actor, station) => [...stationReductions(station), ...extraReductions(actor, station)];

// Who is asking ---------------------------------------------------------------------------------------------------
/**
 * Run `direct` here on a GM client (a refusal throws a plain Error, as it always did), or ask the GM client over the
 * socket. Over the socket the GM-side handler is guarded (relay.js): a refusal comes back as data and is rethrown here
 * with its plain text; anything unexpected becomes one generic message.
 */
export async function asGM(name, payload, direct) {
  if (game.user.isGM) return direct({ ...payload, userId: game.user.id });
  if (!socket) throw new Error("This needs the GM's client, and the module's socket is not registered (api.socketStatus() shows what is missing; if the manifest was just updated, the Foundry server must be fully restarted).");
  let result;
  try {
    result = await socket.executeAsGM(name, { ...payload, userId: game.user.id });
  } catch (error) {
    if ([error?.constructor?.name, error?.name].some(n => /NoGM/i.test(n ?? ""))) throw new Error("The GM isn't connected right now, so this can't be done yet.");
    throw new Error(GENERIC_FAILURE, { cause: error });
  }
  return unwrap(result);   // a refusal travelled as data: this throws it again, with its plain message
}

/** Where a gather's node is: { scene, token } (either may be missing). */
function nodeOf(params) {
  const scene = game.scenes.get(params.sceneId) ?? null;
  const token = scene?.tokens.get(params.tokenId) ?? null;
  return { scene, token };
}

// Locks -----------------------------------------------------------------------------------------------------------
/** Everything that changes one actor's queue (and, for a gather, one node) takes these, node first. */
export function withActionLocks(actor, action, fn) {
  return withLocks(action.type === "gather" ? [nodeKey(action.params), actorKey(actor)] : [actorKey(actor)], fn);
}

// Submitting ------------------------------------------------------------------------------------------------------
/** Normalise what a caller passed (a token document or plain ids) into plain, sendable params. */
function plainParams(type, params = {}) {
  if (type === "share") return { kind: params.kind, key: params.key };
  if (type === "build") return { blueprint: params.blueprint ?? params.blueprintId, selection: { ...(params.selection ?? {}) } };
  if (type === "craft") return { recipe: params.recipe ?? params.recipeId, selection: { ...(params.selection ?? {}) }, ...(params.stationId ? { stationId: params.stationId } : {}) };
  const token = params.node?.documentName === "Token" ? params.node : null;
  return { sceneId: params.sceneId ?? token?.parent?.id, tokenId: params.tokenId ?? token?.id, ...(params.skill ? { skill: params.skill } : {}) };
}

/** The player's (or GM's) call: queue a craft or a gather. Resolves with the saved action. */
export function submitWork(actor, type, params, days) {
  return asGM("queueSubmit", { actorId: actor.id, type, params: plainParams(type, params), days }, payload => runSubmit(payload));
}

/** On the GM client: check who is asking and queue the action. `context` is socketlib's `this`, if any. */
export async function runSubmit(payload, context) {
  const user = callerOf(payload, context);
  const actor = game.actors.get(payload.actorId);
  if (!actor) throw refusal(`submit: no character with id "${payload.actorId}"`);
  assertOwner(actor, user, "submit");
  if (!boundApi) throw new Error("submit: the queue is not bound to the module api yet");
  switch (payload.type) {
    case "craft": return submitCraft(boundApi, actor, user, payload.params, payload.days);
    case "gather": return submitGather(boundApi, actor, payload.params, payload.days);
    case "share": return submitShare(actor, payload.params, payload.days);
    case "build": return submitBuild(boundApi, actor, user, payload.params, payload.days);
    default: throw refusal(`${payload.type} actions cannot be queued this way`);
  }
}

/**
 * Queue a craft: refuse in plain words (nothing is changed), otherwise take the escrow and reserve the days.
 * Order of writes: materials and fee first (each with an undo), then ONE actor update with the action and the days.
 */
export function submitCraft(api, actor, user, params, days) {
  return withLocks([actorKey(actor)], async () => {
    const gate = downtime.gateReason(actor);
    if (gate) {
      if (!user.isGM) throw refusal(gate);
      await downtime.noteOverride(actor, "queued a craft");
    }
    const recipe = api.definitions?.recipe.get(params?.recipe);
    if (!recipe) throw refusal(`craft: unknown recipe "${params?.recipe}"`);
    const preview = previewCraft(actor, recipe.id, params.selection, api, params.stationId);
    if (!preview.ok) throw refusal(refusalText(preview.errors));
    const { plan } = preview;
    if (plan.fee === null || plan.fee === undefined || !plan.station) throw refusal(refusalText(["no station can make this"]));

    const needed = craftDays(recipe, reductionsFor(actor, preview.stations.chosen)).days;
    if (days !== undefined && days !== null && days !== 0 && days !== needed) throw refusal(`craft: this craft takes ${needed} day(s) (got ${days}); the time is set by the recipe and the station, leave days out`);
    const counter = actor.getFlag(MODULE_ID, K.daysFlag);
    const reserved = planSubmit(counter, needed);
    if (!reserved.ok) throw refusal(`Not enough free downtime days: this craft takes ${needed} and ${actor.name} has ${daysFrom(counter)} free.`);

    const { escrow, byStack } = escrowFromPlan({ plan, days: needed, tierOf: id => api.definitions.material.get(id)?.tier });
    if (adapter.getCopper(actor) < escrow.feeCopper) {
      throw refusal(`${actor.name} cannot afford the ${gpText(escrow.feeCopper)} station fee (has ${gpText(adapter.getCopper(actor))}).`);
    }

    const action = {
      id: foundry.utils.randomID(), type: "craft", daysReserved: needed, submittedAt: Date.now(),
      params: { recipe: recipe.id, recipeName: recipe.name, selection: { ...params.selection }, stationId: plan.station.id, stationName: plan.station.name, escrow }
    };
    const undos = await takeEscrow(actor, byStack, escrow.feeCopper);
    try {
      await appendAction(actor, action, { [flagKey(K.daysFlag)]: reserved.counter });
    } catch (error) {
      await undoThenThrow(undos, error);
    }
    await note(`queued craft: ${recipe.name} for ${actor.name}; escrow taken: ${describeEscrow(escrow)}; ${needed} day(s) reserved`);
    return action;
  });
}

/** Queue a gather: claim one charge on the node. No days, no downtime needed. */
export function submitGather(api, actor, params, days) {
  const { sceneId, tokenId } = params ?? {};
  if (days !== undefined && days !== null && days !== 0) return Promise.reject(refusal(`gather: gathering costs charges, not days (got ${days}); leave days out`));
  if (!sceneId || !tokenId) return Promise.reject(refusal("gather: say which node (sceneId and tokenId, or node: the token)"));
  return withLocks([nodeKey(params), actorKey(actor)], async () => {
    const { scene, token } = nodeOf(params);
    const record = token ? readRecord(token) : undefined;
    if (!token || !record) throw refusal("That node isn't there (any more).");
    if (![...scene.tokens].some(t => t.actorId === actor.id)) throw refusal(`${actor.name} needs a token on the scene to gather there.`);
    const problem = reserveProblem(record, token.name);
    if (problem) throw refusal(problem);
    const described = normalizeNode({ record, token: { uuid: token.uuid, name: token.name }, registry: api.definitions });
    if (!described.ok) throw new Error(`gather: ${described.errors.join("; ")}`);
    const picked = pickSkill(described.node.skills, params.skill, described.node.nodeTypeName ?? described.node.nodeType);
    if (!picked.ok) throw refusal(picked.error);

    const action = {
      id: foundry.utils.randomID(), type: "gather", daysReserved: 0, submittedAt: Date.now(),
      params: { sceneId, tokenId, skill: picked.skill, nodeName: token.name, nodeTypeName: described.node.nodeTypeName ?? described.node.nodeType }
    };
    await saveNodeRecord(token, reserve(record));
    try {
      await appendAction(actor, action);
    } catch (error) {
      await saveNodeRecord(token, record).catch(restoreError => console.error(`${MODULE_ID} | could not release the charge claimed for a gather that failed to queue`, restoreError));
      throw error;
    }
    await note(`queued gather: ${actor.name} at ${token.name} (${scene.name}); 1 charge reserved (${reservedOf(readRecord(token))} of ${record.charges} claimed)`);
    return action;
  });
}

// Taking back (cancel, reject, force end, invalid) ----------------------------------------------------------------
/**
 * Hand back what a queued action holds, EXCEPT its days (the caller moves those). Craft: all materials and the fee.
 * Gather: the claimed charge. Returns { undos, text } so the caller can undo it if its own write fails.
 */
export async function takeBack(actor, action) {
  if (ESCROW_TYPES.includes(action.type)) {
    const problems = escrowProblems(action);
    if (problems.length) throw new Error(`cannot return this craft's escrow: ${problems.join("; ")}`);
    const { escrow } = action.params;
    const undos = await giveBack(actor, escrow.units, escrow.feeCopper);
    return { undos, text: `escrow returned: ${describeEscrow(escrow)}`, landed: escrow.units };
  }
  if (action.type === "gather") {
    const { token } = nodeOf(action.params);
    const record = token ? readRecord(token) : undefined;
    if (!record) return { undos: [], text: "the node is gone, so there is no charge to give back" };
    if (reservedOf(record) < 1) return { undos: [], text: "the node had no claimed charge to give back" };
    await saveNodeRecord(token, release(record));
    return { undos: [{ what: `the claimed charge on ${token.name}`, run: () => saveNodeRecord(token, record) }], text: `1 charge released on ${action.params.nodeName}` };
  }
  return { undos: [], text: "" };
}

/** Drop an action that can never succeed: give everything back, refund the days, say why. Caller holds the locks. */
export async function dropAction(actor, action, pending, message) {
  const { undos, text, landed } = await takeBack(actor, action);
  const { counter } = planReject(actor.getFlag(MODULE_ID, K.daysFlag), action);
  try {
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== action.id), [flagKey(K.daysFlag)]: counter });
  } catch (error) {
    await undoThenThrow(undos, error);
  }
  await recordReturned(actor, landed);
  await note(`${action.type} could not be resolved for ${actor.name} (${message}); ${text}${action.daysReserved ? `; ${action.daysReserved} day(s) refunded` : ""}`);
  const tail = action.type === "craft" ? "Your days, materials and fee were returned." : action.type === "build" ? "Your days, materials and gold were returned." : "Nothing was spent.";
  return { status: "invalid", message: `${message}. ${tail}` };
}

// Resolving: craft ------------------------------------------------------------------------------------------------
/**
 * Resolve a queued craft on the GM client. The fee, days and materials were taken when it was queued, so nothing is
 * taken again: the days and fee are spent, the roll decides the item and the per-unit material loss, and the unused
 * materials go back. If the formula, recipe or station has gone (or the fee changed), everything is returned instead.
 */
export async function resolveCraft(api, actor, action, pending, { chat, degree: forced } = {}) {
  const problems = escrowProblems(action);
  if (problems.length) throw new Error(`the escrow on this craft is damaged (${problems.join("; ")}); reject it to try to return what is left`);
  const { escrow, recipeName } = action.params;
  const recipe = api.definitions?.recipe.get(action.params.recipe);
  if (!recipe) return dropAction(actor, action, pending, `The recipe "${recipeName ?? action.params.recipe}" no longer exists`);

  // Everything is checked against what is in escrow, exactly as at submit.
  const preview = previewCraft(actor, recipe.id, action.params.selection, api, action.params.stationId, { stacks: virtualStacks(escrow) });
  if (!preview.ok) return dropAction(actor, action, pending, `This craft can no longer be made: ${preview.errors.join("; ")}`);
  const { plan } = preview;
  if (Math.round((plan.fee ?? 0) * 100) !== escrow.feeCopper) {
    return dropAction(actor, action, pending, `The station fee changed from ${gpText(escrow.feeCopper)} to ${plan.fee} gp since this was queued`);
  }

  let degree = forced;
  if (degree) {
    if (!adapter.normalizeDegree(degree)) throw new Error(`craft: unknown degree "${degree}"`);
  } else {
    degree = (await adapter.rollCraftCheck(actor, adapter.levelDC(plan.craftLevel), { createMessage: false })).degree;
  }
  const outcome = resolveOutcome({ plan, degree, rng: d100, config: CRAFTING });
  const back = unusedUnits(escrow, outcome.consumeByStack);

  // Load what the item needs BEFORE writing anything; then write with an undo for each step.
  let itemData = null;
  if (outcome.made) {
    const base = await adapter.loadItemSource(plan.outputUuid);
    itemData = adapter.buildCraftedItemData(base, plan.description, { ...plan.provenance, crafter: actor.id, degree: outcome.degree }, { name: plan.resultName ?? undefined });
  }
  const undos = [];
  let created = null;
  try {
    if (itemData) {
      created = await adapter.createItemOnActor(actor, itemData);
      undos.push({ what: `the new item on ${actor.name}`, run: () => created.delete() });
    }
    undos.push(...await giveBack(actor, back));
    const counter = actor.getFlag(MODULE_ID, K.daysFlag);
    const { counter: after } = planResolve(counter, action.daysReserved, action.daysReserved);
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== action.id), [flagKey(K.daysFlag)]: after },
      [{ type: "days", delta: -action.daysReserved, note: `craft: ${recipe.name}` }]);
  } catch (error) {
    await undoThenThrow(undos, error);
  }

  await recordReturned(actor, back);
  await note(`resolved craft: ${recipe.name} for ${actor.name}: ${outcome.made ? "item made" : "no item"}; ${gpText(escrow.feeCopper)} fee and ${action.daysReserved} day(s) spent; `
    + `${back.length ? `escrow returned: ${back.map(u => `${u.units}x ${u.name ?? u.materialId}`).join(", ")}` : "no materials returned"}`);
  if (chat) {
    const summary = formatSummary({ crafterName: actor.name, plan, outcome, itemName: created?.name, feeText: `Station fee: ${gpText(escrow.feeCopper)} (paid when you queued it).` });
    await whisper([...new Set([...ownerIds(actor), ...gmIds()])], `<p>${summary}<br>Days spent: ${action.daysReserved}.</p>`);
    await whisper(gmIds(), `<p>GM only: ${actor.name}'s ${recipe.name}: ${outcome.degree}${outcome.lossRolls.length ? `; material loss rolls ${outcome.lossRolls.map(r => `${r.materialId} d100=${r.roll} vs ${r.chance}%${r.lost ? " lost" : " kept"}`).join(", ")}` : ""}.</p>`);
  }
  return {
    status: "resolved", daysSpent: action.daysReserved,
    message: `${recipe.name}: ${outcome.made ? `made (${outcome.degree})` : `not made (${outcome.degree})`}; ${outcome.summary.unitsUsed} material unit(s) used, ${outcome.summary.unitsKept} returned; the fee and ${action.daysReserved} day(s) were spent.`
  };
}

// Resolving: gather -----------------------------------------------------------------------------------------------
/**
 * Resolve a queued gather on the GM client: roll the visible check and the hidden rungs, add the materials, turn the
 * claimed charge into a spent one, and, at 0 charges, delete the node token (keeping only a small depleted record).
 * A node that is gone (Clear map) or an actor that left the scene makes it invalid: nothing is spent.
 */
export async function resolveGatherAction(api, actor, action, pending, { chat, degree: forced } = {}) {
  const { skill, nodeName } = action.params;
  const { scene, token } = nodeOf(action.params);
  const record = token ? readRecord(token) : undefined;
  if (!token || !record) return dropAction(actor, action, pending, `${nodeName ?? "The node"} is gone (the map was cleared), so there is nothing to gather`);
  if (![...scene.tokens].some(t => t.actorId === actor.id)) return dropAction(actor, action, pending, `${actor.name} is no longer on the scene with ${token.name}`);
  if (reservedOf(record) < 1) return dropAction(actor, action, pending, `${token.name} has no charge claimed for this gather`);

  const described = normalizeNode({ record, token: { uuid: token.uuid, name: token.name }, registry: api.definitions });
  if (!described.ok) throw new Error(`gather: ${described.errors.join("; ")}`);
  // This gather's own claimed charge is the one it is about to spend: judge the node without it.
  const node = { ...described.node, reservedCharges: reservedOf(record) - 1 };
  const problem = checkGatherable(node);
  if (problem) return dropAction(actor, action, pending, problem);
  const picked = pickSkill(node.skills, skill, node.nodeTypeName ?? node.nodeType);
  if (!picked.ok) return dropAction(actor, action, pending, picked.error);

  let visible, modifier;
  if (forced) {
    if (!adapter.normalizeDegree(forced)) throw new Error(`gather: unknown degree "${forced}"`);
    visible = { degree: forced, passed: PASS.includes(forced), total: null, natural: null };
    modifier = adapter.getSkillModifier(actor, picked.skill);
  } else {
    const roll = await adapter.rollSkillCheck(actor, picked.skill, node.ladder.base.dc, { createMessage: false });
    visible = { degree: roll.degree, passed: PASS.includes(roll.degree), total: roll.total, natural: roll.natural };
    modifier = roll.modifier;
  }
  const result = resolveGather({ node, visible, modifier, d20: () => rollDie(20), die: rollDie });

  // Burn the charge first (a crash can never leave a free attempt), then grant, then drop the action; undo on failure.
  const next = spendReserved(record, result.chargesAfter);
  const undos = [];
  try {
    await saveNodeRecord(token, next);
    undos.push({ what: `the charge on ${token.name}`, run: () => saveNodeRecord(token, record) });
    const undoGrant = await grantAll(actor, result.gains, api.definitions);
    undos.push({ what: `the materials on ${actor.name}`, run: undoGrant });
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== action.id) });
  } catch (error) {
    await undoThenThrow(undos, error);
  }

  const materialNames = Object.fromEntries(result.gains.map(g => [g.materialId, api.definitions.material.get(g.materialId).name]));
  await noteGather(api.definitions, actor, { gains: result.gains, node: record, scene });   // best-effort: never fails the gather
  let gone = false;
  if (next.state === "depleted" && exploration.isModuleNode(token, record)) gone = await exploration.retireNode(scene, token, { by: actor.name });
  await note(`resolved gather: ${actor.name} at ${nodeName ?? token.name}: ${result.gains.length ? result.gains.map(g => `${g.quantity}x ${materialNames[g.materialId]}`).join(", ") : "nothing"} gathered; 1 charge spent`
    + `${next.state === "depleted" ? `; the node is depleted${gone ? " and its token was deleted" : ""}` : ""}`);
  if (chat) {
    await whisper([...new Set([...ownerIds(actor), ...gmIds()])], `<p>${formatGatherSummary({ gathererName: actor.name, node, skillName: adapter.skillLabel(picked.skill), result, materialNames })}</p>`);
    await whisper(gmIds(), `<p>GM only: ${actor.name} at ${token.name}: hidden rung rolls ${result.hidden.length ? result.hidden.map(h => `${h.materialId} d20=${h.roll}+${h.modifier} vs DC ${h.dc}${h.success ? " found" : ""}`).join(", ") : "none"}.</p>`);
  }
  return {
    status: "resolved", daysSpent: 0,
    message: `${result.passed ? "gathered" : "found nothing"}${result.gains.length ? `: ${result.gains.map(g => `${g.quantity}x ${materialNames[g.materialId]}`).join(", ")}` : ""}; ${next.state === "depleted" ? `the node is depleted${gone ? " and gone" : ""}` : `${result.chargesAfter} charge(s) left`}.`
  };
}
