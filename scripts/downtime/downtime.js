/**
 * Downtime periods. Pure; no Foundry globals.
 *
 * A period is started by the GM for a number of days and the characters taking part. Presence is the
 * reward: only participants get days, unspent days expire when the GM ends the period, and nobody
 * catches up. State: { open, days, startedAt, endedAt?, participants: { actorId: { granted, spent, late? } }, log[] }.
 */
import { DOWNTIME } from "../config.js";

export const emptyState = () => ({ open: false, days: 0, startedAt: 0, participants: {}, log: [] });

/** Whatever is stored, as a usable state (a missing or damaged setting means "closed"). */
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyState();
  return {
    open: raw.open === true,
    days: Number.isInteger(raw.days) ? raw.days : 0,
    startedAt: Number.isInteger(raw.startedAt) ? raw.startedAt : 0,
    ...(Number.isInteger(raw.endedAt) ? { endedAt: raw.endedAt } : {}),
    participants: raw.participants && typeof raw.participants === "object" && !Array.isArray(raw.participants) ? structuredClone(raw.participants) : {},
    log: Array.isArray(raw.log) ? raw.log : []
  };
}

export const isOpen = state => state.open === true;

/** Why this character may not spend days right now, or null. */
export function gateReason(state, actorId, config = DOWNTIME) {
  if (!state.open) return config.reasons.closed;
  if (!state.participants[actorId]) return config.reasons.notParticipant;
  return null;
}

/**
 * The characters taking part by default: each connected non-GM user's assigned character, or else the
 * player characters they own.
 * @param {Array<{ isGM: boolean, active: boolean, characterId: string|null, ownedCharacterIds: string[] }>} users
 */
export function defaultParticipantIds(users) {
  const ids = [];
  for (const user of users) {
    if (user.isGM || !user.active) continue;
    if (user.characterId) ids.push(user.characterId);
    else ids.push(...user.ownedCharacterIds);
  }
  return [...new Set(ids)];
}

const withLog = (state, text, now, config = DOWNTIME) => ({ ...state, log: [...state.log, { at: now, text }].slice(-config.logMax) });

/** @returns {{ ok: true, state: object } | { ok: false, error: string }} */
export function planStart(state, { days, actorIds, now }, config = DOWNTIME) {
  if (state.open) return { ok: false, error: "downtime is already open; end it first" };
  if (!Number.isInteger(days) || days < 1 || days > config.maxDays) return { ok: false, error: `days must be a whole number from 1 to ${config.maxDays} (got ${days})` };
  const ids = [...new Set(actorIds)];
  if (!ids.length) return { ok: false, error: "no characters are taking part (none connected; pass actorIds to choose them)" };
  const participants = Object.fromEntries(ids.map(id => [id, { granted: days, spent: 0 }]));
  return { ok: true, state: withLog({ open: true, days, startedAt: now, participants, log: [] }, `downtime started: ${days} day(s) for ${ids.length} character(s)`, now, config) };
}

/**
 * A late joiner gets the most free days any participant still has.
 * @param {Object<string, number>} freeDays  participant id -> free (unreserved) days right now
 */
export function planLate(state, { actorId, freeDays, now }, config = DOWNTIME) {
  if (!state.open) return { ok: false, error: config.reasons.closed };
  if (state.participants[actorId]) return { ok: false, error: "that character is already taking part" };
  const days = Math.max(0, ...Object.keys(state.participants).map(id => freeDays[id] ?? 0));
  if (days < 1) return { ok: false, error: "nobody has any free days left, so there is nothing to give a late joiner" };
  const next = { ...state, participants: { ...state.participants, [actorId]: { granted: days, spent: 0, late: true } } };
  return { ok: true, days, state: withLog(next, `late joiner added with ${days} day(s)`, now, config) };
}

/** Ending is blocked while anything is queued, unless forced. */
export function planEnd(state, { queueCount, force, now }, config = DOWNTIME) {
  if (!state.open) return { ok: false, error: config.reasons.closed };
  if (queueCount > 0 && !force) return { ok: false, blocked: queueCount };
  return { ok: true, state: withLog({ ...state, open: false, endedAt: now }, `downtime ended${force && queueCount ? ` (forced; ${queueCount} queued item(s) returned)` : ""}`, now, config) };
}

export function addSpent(state, actorId, days) {
  const entry = state.participants[actorId];
  if (!state.open || !entry || !Number.isInteger(days) || days < 1) return state;
  return { ...state, participants: { ...state.participants, [actorId]: { ...entry, spent: entry.spent + days } } };
}
