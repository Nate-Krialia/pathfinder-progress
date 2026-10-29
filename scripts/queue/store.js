/**
 * Foundry-bound queue. Any owner can SUBMIT (an action is stored in the actor's own flag,
 * with its days moved from the unreserved counter into the reservation, in one update).
 * Only a GM can reject, edit or resolve; resolving runs the hidden rolls on the GM client.
 *
 * Failure isolation: each action resolves on its own. A request that can never succeed is
 * "invalid" (refunded, removed, reported). Anything unexpected is an "error": the action is
 * left exactly as it was so the GM can fix the cause and Retry.
 */
import { MODULE_ID, QUEUE_KEYS, RESEARCH_KEYS as K } from "../config.js";
import { commit } from "../audit/store.js";
import { check } from "../data/schema.js";
import { daysFrom } from "../research/days.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import * as commissions from "../commissions/store.js";
import * as downtime from "../downtime/store.js";
import * as exploration from "../exploration/store.js";
import { ResearchRefused, planResearch, planUpdate, postResearchChat, rawList } from "../research/store.js";
import { HANDLERS, wiredTypes } from "./handlers.js";
import { planEdit, planReject, planResolve, planSubmit } from "./reservation.js";
import { runBatch } from "./queue.js";
import { esc } from "./review.js";
import * as work from "./work.js";
import { noteRegionExplored } from "../compendium/store.js";
import { resolveShare } from "../compendium/share.js";
import { applyStationUpgrade } from "../stations/store.js";
import { resolveBuild } from "../workshop/build.js";
import { refusal } from "./relay.js";

let boundApi = null;
/** Give the queue the module api (definitions). Needed by explore actions. */
export function bind(api) { boundApi = api; work.bind(api); }
const needApi = what => {
  if (!boundApi) throw new Error(`${what}: the queue is not bound to the module api yet`);
  return boundApi;
};

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;

const pendingOf = actor => rawList(actor, QUEUE_KEYS.pendingFlag);
const validActions = actor => pendingOf(actor).filter(a => check(LIVE_SCHEMAS.pendingAction, a).length === 0);

function findAction(actor, actionId) {
  const pending = pendingOf(actor);
  const action = pending.find(a => a?.id === actionId);
  if (!action) throw refusal(`${actor.name} has no queued action "${actionId}"`);
  const problems = check(LIVE_SCHEMAS.pendingAction, action);
  if (problems.length) throw new Error(`queued action "${actionId}" is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return { pending, action };
}

const actorFor = actorId => {
  const actor = game.actors.get(actorId);
  if (!actor) throw refusal(`no actor with id "${actorId}"`);
  return actor;
};

/** Describe an action for people: { label, detail, problem }. */
export function describeAction(actor, action) {
  const handler = HANDLERS[action.type];
  if (!handler) return { label: `${action.type} (not wired yet)`, detail: "no resolver exists for this type yet", problem: "this type cannot be resolved yet" };
  let info;
  try {
    info = !boundApi ? undefined
      : action.type === "explore" ? exploration.describeInfo(boundApi, actor, action)
        : action.type === "commission" ? commissions.describeInfo(boundApi, actor, action) : undefined;
  } catch (error) {
    return { label: `${action.type} (could not be described)`, detail: error.message, problem: `could not read this action: ${error.message}` };
  }
  return handler.describe({ action, projects: rawList(actor, K.projectsFlag), info });
}

/** Does this action take downtime? Days reserved (research, explore, craft), or a commission craft step (which still costs no days). */
const spendsTime = (type, params, days) => days > 0 || (type === "commission" && params?.step === "craft");

// Submitting (any owner) -------------------------------------------------------------------
/**
 * Queue an action and reserve its days. Anyone who owns the actor can submit.
 * @param {object} actor
 * @param {string} type    a wired type ("research")
 * @param {object} params  the type's parameters (research: { projectId, skill? })
 * @param {number} days    days to reserve
 */
export async function submit(actor, type, params, days) {
  if (!game.user.isGM && !actor.isOwner) throw new Error(`submit: you do not own ${actor.name}`);
  const handler = HANDLERS[type];
  if (!handler) throw new Error(`submit: "${type}" actions cannot be queued yet (wired: ${wiredTypes().join(", ")})`);
  // Craft and gather run on the GM client (players cannot read recipes or write node tokens); the call is relayed there.
  if (work.isWorkType(type)) return work.submitWork(actor, type, params, days);
  // The downtime gate. Players never bypass it; a GM submitting on someone's behalf does, and the ledger says so.
  if (spendsTime(type, params, days)) {
    const reason = downtime.gateReason(actor);
    if (reason) {
      if (!game.user.isGM) throw new Error(reason);
      await downtime.noteOverride(actor, `queued a ${type} action`);
    }
  }
  const region = type === "explore" ? needApi("submit").definitions?.region.get(params?.region) : undefined;
  const scenes = type === "explore" && game.user.isGM && region ? exploration.poolFor(region) : null;
  const submitter = type === "commission" ? commissions.submitContext(actor, params) : {};
  const checked = handler.validateSubmit({ projects: rawList(actor, K.projectsFlag), params, days, region, scenes, ...submitter });
  if (!checked.ok) throw new Error(`submit: ${checked.errors.join("; ")}`);
  // Commission steps cost no days; everything else reserves at least one.
  const reserved = handler.freeOfDays && days === 0
    ? { ok: true, counter: daysFrom(actor.getFlag(MODULE_ID, K.daysFlag)) }
    : planSubmit(actor.getFlag(MODULE_ID, K.daysFlag), days);
  if (!reserved.ok) throw new Error(`submit: ${reserved.error}`);

  const action = { id: foundry.utils.randomID(), type, params: checked.params, daysReserved: days, submittedAt: Date.now() };
  const problems = check(LIVE_SCHEMAS.pendingAction, action);
  if (problems.length) throw new Error(`submit: built an invalid action: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  // ONE update: the reservation and the counter move together.
  await actor.update({
    [flagKey(QUEUE_KEYS.pendingFlag)]: [...pendingOf(actor), action],
    [flagKey(K.daysFlag)]: reserved.counter
  });
  return action;
}

// Reading ------------------------------------------------------------------------------------
/** Every queued action across all actors, in submission order. Each row: { actorId, actorName, action, label, detail, problem }. */
export function list(actors = [...game.actors]) {
  const rows = [];
  for (const actor of actors) {
    for (const action of validActions(actor)) {
      rows.push({ actorId: actor.id, actorName: actor.name, action, ...describeAction(actor, action) });
    }
  }
  return rows.sort((a, b) => a.action.submittedAt - b.action.submittedAt || String(a.action.id).localeCompare(String(b.action.id)));
}

// GM: reject and edit; owner: cancel ---------------------------------------------------------------------
/**
 * Take a queued action back: its days return to the counter, a craft's materials and fee return to the character,
 * a gather's claimed charge returns to the node. Everything is returned or nothing is (the returns are undone if
 * the queue write fails). `verb` is for the log: "returned by the GM", "cancelled by the player".
 */
async function returnQueued(actor, actionId, { chat, verb }) {
  const first = findAction(actor, actionId).action;
  return work.withActionLocks(actor, first, async () => {
    const { pending, action } = findAction(actor, actionId); // read again inside the lock
    const described = describeAction(actor, action);
    const { undos, text, landed } = await work.takeBack(actor, action);
    const { counter } = planReject(actor.getFlag(MODULE_ID, K.daysFlag), action);
    try {
      await commit(actor, {
        [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== actionId),
        [flagKey(K.daysFlag)]: counter
      });
    } catch (error) {
      await work.undoAll(undos).catch(undoError => { throw new Error(`${error.message}. ${undoError.message}`); });
      throw error;
    }
    await work.recordReturned(actor, landed);
    if (work.isWorkType(action.type)) {
      await work.note([`${action.type} ${verb}: ${described.label} for ${actor.name}`, text, action.daysReserved ? `${action.daysReserved} day(s) refunded` : ""].filter(Boolean).join("; "));
    }
    if (chat) await postNote(actor, `<p><strong>${esc(actor.name)}</strong>: the GM returned "${esc(described.label)}". ${action.daysReserved} day(s) refunded.${text ? ` ${esc(text)}.` : ""}</p>`);
    return { refunded: action.daysReserved, ...(text ? { returned: text } : {}) };
  });
}

export async function reject(actor, actionId, { chat = true } = {}) {
  requireGM("reject");
  const { action } = findAction(actor, actionId);
  return returnQueued(actor, actionId, { chat, verb: action.type === "share" ? "rejected by the GM" : "returned by the GM" });
}

/**
 * Cancel your own queued action and get everything back. Players can call this: it is relayed to the GM client,
 * which checks the caller owns the character before touching anything.
 */
export function cancel(actor, actionId) {
  return work.asGM("queueCancel", { actorId: actor.id, actionId }, payload => runCancel(payload));
}

/** On the GM client (also the socket handler): check who is asking, then cancel. */
export async function runCancel(payload, context) {
  requireGM("cancel");
  const user = work.callerOf(payload, context);
  const actor = actorFor(payload.actorId);
  work.assertOwner(actor, user, "cancel");
  return returnQueued(actor, payload.actionId, { chat: false, verb: `cancelled by ${user.name}` });
}

/** The socket handler for a relayed craft or gather submit. */
export const runSubmit = (payload, context) => work.runSubmit(payload, context);

export async function editDays(actor, actionId, newDays) {
  requireGM("editDays");
  const { pending, action } = findAction(actor, actionId);
  if (action.type === "craft") throw new Error("editDays: a craft's time is set by the recipe and the station; reject the craft to get everything back");
  if (action.type === "build") throw new Error("editDays: a build's time is set by the blueprint; reject the build to get everything back");
  if (action.daysReserved === 0) throw new Error("editDays: this action costs no days");
  const plan = planEdit(actor.getFlag(MODULE_ID, K.daysFlag), action, newDays);
  if (!plan.ok) throw new Error(`editDays: ${plan.error}`);
  await commit(actor, {
    [flagKey(QUEUE_KEYS.pendingFlag)]: pending.map(a => (a.id === actionId ? { ...a, daysReserved: plan.daysReserved } : a)),
    [flagKey(K.daysFlag)]: plan.counter
  });
  return { daysReserved: plan.daysReserved };
}

// GM: resolve ----------------------------------------------------------------------------------
/** One resolver per wired type. Each returns { status, message } or throws (an unexpected error). */
const RESOLVERS = {
  async research(api, actor, action, pending, { chat }) {
    const others = pending.filter(a => a.id !== action.id);
    const counter = actor.getFlag(MODULE_ID, K.daysFlag);
    let plan;
    try {
      plan = await planResearch(api, {
        actor, project: action.params.projectId, days: action.daysReserved, daysAvailable: action.daysReserved, skill: action.params.skill
      });
    } catch (error) {
      if (!(error instanceof ResearchRefused)) throw error;
      // Can never succeed: refund everything and drop it. The total is unchanged, so no ledger change.
      const { counter: refunded } = planResolve(counter, action.daysReserved, 0);
      await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: others, [flagKey(K.daysFlag)]: refunded });
      return { status: "invalid", message: `${error.message}. ${action.daysReserved} day(s) refunded.` };
    }
    const spent = plan.result.daysSpent;
    const { counter: after, refunded } = planResolve(counter, action.daysReserved, spent);
    // A finished upgrade changes the station FIRST (under the station's lock, with an undo); if the actor's commit then fails, it is put back.
    const undoStation = plan.stationEffect ? await applyStationUpgrade(api, plan.stationEffect.stationId, plan.stationEffect) : null;
    try {
      await commit(actor, { ...planUpdate(plan), [flagKey(QUEUE_KEYS.pendingFlag)]: others, [flagKey(K.daysFlag)]: after }, plan.changes);
    } catch (error) {
      if (undoStation) await undoStation();
      throw error;
    }
    if (plan.stationEffect) await work.note(`upgrade finished: ${plan.result.project.goalName} (researched by ${actor.name})`);
    if (chat) await postResearchChat(actor, plan);
    const last = plan.result.results.at(-1);
    const verb = plan.result.completed ? "finished the research" : `researched (${spent} day(s))`;
    return { status: "resolved", daysSpent: spent, message: `${verb}; progress ${plan.result.project.progress}/${plan.result.project.threshold}; ${refunded} day(s) refunded.${last?.natural ? ` Last natural d20: ${last.natural}.` : ""}` };
  }
};

RESOLVERS.commission = (api, actor, action, pending, { chat, degree }) => commissions.resolveStep(api, actor, action, pending, { chat, degree });
RESOLVERS.build = (api, actor, action, pending, options) => resolveBuild(api, actor, action, pending, options, work.dropAction);
RESOLVERS.share = (api, actor, action, pending, options) => resolveShare(api, actor, action, pending, options);
RESOLVERS.craft = (api, actor, action, pending, options) => work.resolveCraft(api, actor, action, pending, options);
RESOLVERS.gather = (api, actor, action, pending, options) => work.resolveGatherAction(api, actor, action, pending, options);

RESOLVERS.explore = async function explore(api, actor, action, pending, { chat, degree }) {
  const others = pending.filter(a => a.id !== action.id);
  const counter = actor.getFlag(MODULE_ID, K.daysFlag);
  let run;
  try {
    run = await exploration.planRun(api, actor, action, { degree });
  } catch (error) {
    if (!(error instanceof exploration.ExploreRefused)) throw error;
    // Can never succeed (region gone, skill not allowed): refund everything. The total is unchanged.
    const { counter: refunded } = planResolve(counter, action.daysReserved, 0);
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: others, [flagKey(K.daysFlag)]: refunded });
    return { status: "invalid", message: `${error.message}. ${action.daysReserved} day(s) refunded.` };
  }
  // World first (tokens, anchors, scene state), then the actor; if the actor commit fails the scene is put back.
  const undo = await exploration.applyPlan(api, actor, run);
  try {
    const { counter: after } = planResolve(counter, action.daysReserved, action.daysReserved);
    await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: others, [flagKey(K.daysFlag)]: after },
      [{ type: "days", delta: -action.daysReserved, note: `expedition: ${run.region.name}` }]);
  } catch (error) {
    try {
      await undo();
    } catch (undoError) {
      console.error(`${MODULE_ID} | the actor commit failed AND the scene could not be restored`, undoError);
      throw new Error(`${error.message}. The scene "${run.plan.scene.name}" was changed and could not be restored automatically; run api.clearMap on it.`);
    }
    throw error;
  }
  await noteRegionExplored(api.definitions, actor, run.region.id);   // best-effort: never fails the expedition
  if (chat) await exploration.postExploreChat(api, actor, run);
  const { plan } = run;
  const short = plan.notPlaced ? ` (${plan.rolled} found, only ${plan.freeBefore} free anchor(s): ${plan.notPlaced} not placed)` : "";
  const enc = run.encounter.encounter ? (run.encounter.forced ? "encounter (forced)" : "encounter") : "no encounter";
  return {
    status: "resolved", daysSpent: action.daysReserved,
    message: `prepared "${plan.scene.name}" (not launched): ${plan.activations.length} hidden node(s) placed${short}, ${enc}, ${plan.freeAfter} free anchor(s) left.`
  };
};

/** Resolve one queued action. GM only. Throws on an unexpected failure (the action stays queued). */
export async function resolveAction(api, actor, actionId, { chat = true, degree } = {}) {
  requireGM("resolve");
  if (!pendingOf(actor).some(a => a?.id === actionId)) return { status: "skipped", message: "already handled" };
  const first = findAction(actor, actionId).action;
  if (!RESOLVERS[first.type]) throw new Error(`no resolver is wired for "${first.type}" actions yet; reject it to refund its days`);

  // One resolve at a time per actor (and per node for a gather); the action is read again once the lock is ours.
  return work.withActionLocks(actor, first, async () => {
    const pending = pendingOf(actor);
    if (!pending.some(a => a?.id === actionId)) return { status: "skipped", message: "already handled" };
    const valid = findAction(actor, actionId).action;

    // The gate is checked again here: an action that survived a closed period is refunded, not run.
    if (spendsTime(valid.type, valid.params, valid.daysReserved)) {
      const reason = downtime.gateReason(actor);
      if (reason) {
        if (work.ESCROW_TYPES.includes(valid.type)) return work.dropAction(actor, valid, pending, reason);
        const { counter } = planReject(actor.getFlag(MODULE_ID, K.daysFlag), valid);
        await commit(actor, { [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== valid.id), [flagKey(K.daysFlag)]: counter });
        return { status: "invalid", message: `${reason}. ${valid.daysReserved} day(s) refunded.` };
      }
    }
    const outcome = await RESOLVERS[valid.type](api, actor, valid, pending, { chat, degree });
    if (outcome.status === "resolved" && outcome.daysSpent) await downtime.recordSpent(actor, outcome.daysSpent);
    return outcome;
  });
}

/** How many queued actions block "End downtime": everything except gathers and shares (they cost no days). */
export const blockingCount = () => list().filter(row => !work.NON_BLOCKING_TYPES.includes(row.action.type)).length;

/**
 * Return queued actions to their owners (days refunded, escrow handed back). Used by a forced end of downtime, which
 * leaves gathers alone: they need no downtime and stay queued. Returns how many were returned.
 */
export async function rejectAll({ chat = false, keepGathers = false } = {}) {
  requireGM("rejectAll");
  let count = 0;
  for (const row of list()) {
    if (keepGathers && work.NON_BLOCKING_TYPES.includes(row.action.type)) continue;
    await reject(actorFor(row.actorId), row.action.id, { chat });
    count++;
  }
  return count;
}

/** Resolve every queued action in submission order, isolating failures. GM only. Returns { results, summary }. */
export async function resolveAll(api, { chat = true, degree } = {}) {
  requireGM("resolveAll");
  const rows = list();
  const batch = await runBatch(rows, row => resolveAction(api, actorFor(row.actorId), row.action.id, { chat, degree }));
  // Add names so a results panel can say who and what.
  const byKey = new Map(rows.map(r => [`${r.actorId}/${r.action.id}`, r]));
  batch.results = batch.results.map(r => ({ ...r, actorName: byKey.get(`${r.actorId}/${r.actionId}`)?.actorName, label: byKey.get(`${r.actorId}/${r.actionId}`)?.label }));
  return batch;
}

async function postNote(actor, content) {
  try {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  } catch (error) {
    console.error(`${MODULE_ID} | the queue change is saved, but the chat message failed`, error);
  }
}

