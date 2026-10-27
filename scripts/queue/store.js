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
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { ResearchRefused, planResearch, planUpdate, postResearchChat, rawList } from "../research/store.js";
import { HANDLERS, wiredTypes } from "./handlers.js";
import { planEdit, planReject, planResolve, planSubmit } from "./reservation.js";
import { runBatch } from "./queue.js";
import { esc } from "./review.js";

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;

const pendingOf = actor => rawList(actor, QUEUE_KEYS.pendingFlag);
const validActions = actor => pendingOf(actor).filter(a => check(LIVE_SCHEMAS.pendingAction, a).length === 0);

function findAction(actor, actionId) {
  const pending = pendingOf(actor);
  const action = pending.find(a => a?.id === actionId);
  if (!action) throw new Error(`${actor.name} has no queued action "${actionId}"`);
  const problems = check(LIVE_SCHEMAS.pendingAction, action);
  if (problems.length) throw new Error(`queued action "${actionId}" is invalid: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  return { pending, action };
}

const actorFor = actorId => {
  const actor = game.actors.get(actorId);
  if (!actor) throw new Error(`no actor with id "${actorId}"`);
  return actor;
};

/** Describe an action for people: { label, detail, problem }. */
export function describeAction(actor, action) {
  const handler = HANDLERS[action.type];
  if (!handler) return { label: `${action.type} (not wired yet)`, detail: "no resolver exists for this type yet", problem: "this type cannot be resolved yet" };
  return handler.describe({ action, projects: rawList(actor, K.projectsFlag) });
}

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
  const checked = handler.validateSubmit({ projects: rawList(actor, K.projectsFlag), params });
  if (!checked.ok) throw new Error(`submit: ${checked.errors.join("; ")}`);
  const reserved = planSubmit(actor.getFlag(MODULE_ID, K.daysFlag), days);
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

// GM: reject and edit ------------------------------------------------------------------------
export async function reject(actor, actionId, { chat = true } = {}) {
  requireGM("reject");
  const { pending, action } = findAction(actor, actionId);
  const described = describeAction(actor, action);
  const { counter } = planReject(actor.getFlag(MODULE_ID, K.daysFlag), action);
  await commit(actor, {
    [flagKey(QUEUE_KEYS.pendingFlag)]: pending.filter(a => a.id !== actionId),
    [flagKey(K.daysFlag)]: counter
  });
  if (chat) await postNote(actor, `<p><strong>${esc(actor.name)}</strong>: the GM returned "${esc(described.label)}". ${action.daysReserved} day(s) refunded.</p>`);
  return { refunded: action.daysReserved };
}

export async function editDays(actor, actionId, newDays) {
  requireGM("editDays");
  const { pending, action } = findAction(actor, actionId);
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
    await commit(actor, { ...planUpdate(plan), [flagKey(QUEUE_KEYS.pendingFlag)]: others, [flagKey(K.daysFlag)]: after }, plan.changes);
    if (chat) await postResearchChat(actor, plan);
    const last = plan.result.results.at(-1);
    const verb = plan.result.completed ? "finished the research" : `researched (${spent} day(s))`;
    return { status: "resolved", message: `${verb}; progress ${plan.result.project.progress}/${plan.result.project.threshold}; ${refunded} day(s) refunded.${last?.natural ? ` Last natural d20: ${last.natural}.` : ""}` };
  }
};

/** Resolve one queued action. GM only. Throws on an unexpected failure (the action stays queued). */
export async function resolveAction(api, actor, actionId, { chat = true } = {}) {
  requireGM("resolve");
  const pending = pendingOf(actor);
  const action = pending.find(a => a?.id === actionId);
  if (!action) return { status: "skipped", message: "already handled" };
  const valid = findAction(actor, actionId).action;
  const resolver = RESOLVERS[valid.type];
  if (!resolver) throw new Error(`no resolver is wired for "${valid.type}" actions yet; reject it to refund its days`);
  return resolver(api, actor, valid, pending, { chat });
}

/** Resolve every queued action in submission order, isolating failures. GM only. Returns { results, summary }. */
export async function resolveAll(api, { chat = true } = {}) {
  requireGM("resolveAll");
  const rows = list();
  const batch = await runBatch(rows, row => resolveAction(api, actorFor(row.actorId), row.action.id, { chat }));
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

