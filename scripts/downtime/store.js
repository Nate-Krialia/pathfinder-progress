/**
 * Foundry-bound downtime: the period (a world setting only a GM client writes), the day grants, and
 * the gate that queue.submit uses. Days live in the existing counter on each actor; every grant and
 * expiry goes through the audit commit, so the ledger shows start, late joins and expiry.
 *
 * No socket is needed: players never change the period, they only read it.
 */
import { DOWNTIME, MODULE_ID, RESEARCH_KEYS as K } from "../config.js";
import { commit, logWorldEvent } from "../audit/store.js";
import { daysFrom } from "../research/days.js";
import { addSpent, defaultParticipantIds, gateReason as gateFor, isOpen as isOpenState, normalizeState, planEnd, planLate, planStart } from "./downtime.js";

const requireGM = what => { if (!game.user.isGM) throw new Error(`downtime.${what}: GM only`); };
const flagKey = key => `flags.${MODULE_ID}.${key}`;
const counterOf = actor => daysFrom(actor.getFlag(MODULE_ID, K.daysFlag));

export function readState() {
  return normalizeState(game.settings.get(MODULE_ID, DOWNTIME.stateSetting));
}
const writeState = state => game.settings.set(MODULE_ID, DOWNTIME.stateSetting, state);

export const isOpen = () => isOpenState(readState());
export const state = () => structuredClone(readState());

/** Why this character may not spend days right now, or null. Anyone can ask. */
export const gateReason = actor => gateFor(readState(), actor.id);

/** The characters taking part if the GM names nobody: connected players' characters. */
export function defaultParticipants() {
  const users = [...game.users].map(user => ({
    isGM: user.isGM, active: user.active, characterId: user.character?.id ?? null,
    ownedCharacterIds: [...game.actors].filter(a => a.type === "character" && a.testUserPermission(user, "OWNER")).map(a => a.id)
  }));
  return defaultParticipantIds(users);
}

const actorFor = ref => {
  const actor = typeof ref === "string" ? (game.actors.get(ref) ?? game.actors.getName(ref)) : ref;
  if (!actor?.id) throw new Error(`downtime: no character found for "${ref?.name ?? ref}"`);
  return actor;
};

async function setCounter(actor, to, note) {
  const from = counterOf(actor);
  if (from === to) return from;
  await commit(actor, { [flagKey(K.daysFlag)]: to }, [{ type: "days", delta: to - from, note }]);
  return from;
}

/** Give `days` to each participant. If anything fails, the ones already given are taken back. */
async function grantAll(actors, days, note) {
  const done = [];
  try {
    for (const actor of actors) { done.push({ actor, before: await setCounter(actor, counterOf(actor) + days, note) }); }
  } catch (error) {
    for (const { actor, before } of done.reverse()) await setCounter(actor, before, "downtime start undone").catch(() => {});
    throw error;
  }
  return done;
}

/** Start a period. options: { days, actorIds? } (default: connected players' characters). GM only. */
export async function start({ days, actorIds } = {}) {
  requireGM("start");
  const current = readState();
  const ids = actorIds ? actorIds.map(ref => actorFor(ref).id) : defaultParticipants();
  const planned = planStart(current, { days, actorIds: ids, now: Date.now() });
  if (!planned.ok) throw new Error(`downtime.start: ${planned.error}`);
  const actors = Object.keys(planned.state.participants).map(id => actorFor(id));
  const done = await grantAll(actors, days, `downtime started: +${days} day(s)`);
  try {
    await writeState(planned.state);
    await logWorldEvent(`downtime started: ${days} day(s) each for ${actors.map(a => a.name).join(", ")}`);
  } catch (error) {
    for (const { actor, before } of done.reverse()) await setCounter(actor, before, "downtime start undone").catch(() => {});
    await writeState(current).catch(() => {});
    throw error;
  }
  return { days, participants: actors.map(a => ({ id: a.id, name: a.name })) };
}

/** Add a late joiner with the most free days any participant still has. GM only. */
export async function addLate(ref) {
  requireGM("addLate");
  const actor = actorFor(ref);
  const current = readState();
  const freeDays = Object.fromEntries(Object.keys(current.participants).map(id => [id, counterOf(game.actors.get(id) ?? { getFlag: () => 0 })]));
  const planned = planLate(current, { actorId: actor.id, freeDays, now: Date.now() });
  if (!planned.ok) throw new Error(`downtime.addLate: ${planned.error}`);
  const before = await setCounter(actor, counterOf(actor) + planned.days, `late joiner: +${planned.days} day(s)`);
  try {
    await writeState(planned.state);
    await logWorldEvent(`late joiner: ${actor.name} added with ${planned.days} day(s)`);
  } catch (error) {
    await setCounter(actor, before, "late join undone").catch(() => {});
    throw error;
  }
  return { actorId: actor.id, days: planned.days };
}

/**
 * End the period. Blocked (nothing changes) while anything is queued, unless { force: true }, which returns
 * the queued items first. Then every unspent day expires. Safe to run again if it stopped part-way.
 * @param {{ force?: boolean }} options
 * @param {{ queueCount: () => number, rejectAll: () => Promise<number> }} deps  supplied by the api (the queue lives elsewhere)
 */
export async function end({ force = false } = {}, deps = {}) {
  requireGM("end");
  const current = readState();
  const queueCount = deps.queueCount?.() ?? 0;
  const planned = planEnd(current, { queueCount, force, now: Date.now() });
  if (!planned.ok) {
    if (planned.blocked !== undefined) return { blocked: planned.blocked };
    throw new Error(`downtime.end: ${planned.error}`);
  }
  const rejected = queueCount > 0 ? await deps.rejectAll() : 0;
  const expired = {};
  for (const actor of game.actors) {
    const days = counterOf(actor);
    if (days > 0) { await setCounter(actor, 0, `downtime ended: ${days} unspent day(s) expired`); expired[actor.id] = days; }
  }
  await writeState(planned.state);
  await logWorldEvent(`downtime ended${force && rejected ? ` (forced, ${rejected} queued item(s) returned)` : ""}; expired days: ${Object.entries(expired).map(([id, d]) => `${game.actors.get(id)?.name ?? id} ${d}`).join(", ") || "none"}`);
  return { ended: true, rejected, expired };
}

/** Bookkeeping for the period state: a participant spent days. Never fails the action it follows. */
export async function recordSpent(actor, days) {
  try {
    const current = readState();
    const next = addSpent(current, actor.id, days);
    if (next !== current) await writeState(next);
  } catch (error) {
    console.error(`${MODULE_ID} | could not record spent downtime days`, error);
  }
}

/** A GM tool went around the downtime gate: say so in the audit ledger. Returns the reason, or null if it was allowed anyway. */
export async function noteOverride(actor, what) {
  const reason = gateReason(actor);
  if (reason) await logWorldEvent(`GM override: ${what} for ${actor.name} (${reason})`);
  return reason;
}
