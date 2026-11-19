/**
 * Foundry-bound audit: the ledger (a GM-only world setting) and every GM-side write.
 *
 * `commit` is the ONE way module code changes an actor's research, formula or day data:
 * it records the expected change in the ledger FIRST, then updates the actor, and puts the
 * ledger back if the actor update fails. So the ledger never claims a change that did not happen.
 *
 * The ledger is readable by players (Foundry world settings are) but only a GM can write it.
 * Like recipe visibility, this is an honor-system aid, not security (see docs/10).
 */
import { AUDIT, MODULE_ID, QUEUE_KEYS, RESEARCH_KEYS as K } from "../config.js";
import { applyChange, baselineEntry, compare, compareLoans, emptyEntry, hasModuleData } from "./audit.js";
import { readCommissions } from "../commissions/list.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { reservedOf } from "../gathering/reserve.js";
import { escrowProblems } from "../queue/escrow.js";
import { withLock } from "../queue/lock.js";

const requireGM = what => { if (!game.user.isGM) throw new Error(`${what}: GM only`); };

/** A flag as a list. A flag that is not a list becomes one invalid entry, so the audit reports it. */
const asList = value => (value === undefined ? [] : Array.isArray(value) ? value : [{ notAList: value }]);

/** The raw module data an actor holds. */
export const readState = actor => ({
  counter: actor.getFlag(MODULE_ID, K.daysFlag),
  pending: asList(actor.getFlag(MODULE_ID, QUEUE_KEYS.pendingFlag)),
  formulas: asList(actor.getFlag(MODULE_ID, K.formulasFlag)),
  projects: asList(actor.getFlag(MODULE_ID, K.projectsFlag))
});

export function readLedger() {
  const raw = game.settings.get(MODULE_ID, AUDIT.ledgerSetting);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? structuredClone(raw) : {};
}

const writeLedger = ledger => game.settings.set(MODULE_ID, AUDIT.ledgerSetting, ledger);

/**
 * The ledger is ONE setting that every actor's entry lives in, so every change is a read-modify-write under ONE lock: read INSIDE the lock, change a clone, await the write.
 * Two commits for two actors used to read the same ledger and the second write erased the first's entry. The lock is a LEAF: whatever runs inside it only reads and writes this
 * one setting (never an actor update, never another lock), so it sits innermost, after node and actor.
 */
export const AUDIT_LOCK = "auditLedger";
const changeLedger = mutate => withLock(AUDIT_LOCK, async () => {
  const ledger = readLedger();
  const result = mutate(ledger);
  await writeLedger(ledger);
  return result;
});

/**
 * Apply `update` (flat actor-update paths) to the actor and record `changes` in the ledger.
 * GM only. With no changes (a reject or edit that only moves days) the ledger is left alone.
 */
export async function commit(actor, update, changes = [], now = Date.now()) {
  requireGM("commit");
  if (!changes.length) {
    await actor.update(update);
    return;
  }
  // The ledger is written FIRST (under the lock, only this actor's key), the actor next, outside the lock: an actor update can fire hooks that log, and the lock is not re-entrant.
  let previous;
  await changeLedger(ledger => {
    previous = ledger[actor.id] === undefined ? undefined : structuredClone(ledger[actor.id]);
    let entry = ledger[actor.id] ?? emptyEntry(actor.name);
    for (const change of changes) entry = applyChange(entry, change, now, actor.name);
    ledger[actor.id] = entry;
  });
  try {
    await actor.update(update);
  } catch (error) {
    try {
      // Put back ONLY this actor's own entry (what it was, or nothing): another actor's commit may have landed meanwhile and must stay.
      await changeLedger(ledger => { if (previous === undefined) delete ledger[actor.id]; else ledger[actor.id] = previous; });
    } catch (restoreError) {
      console.error(`${MODULE_ID} | the actor update failed AND the audit ledger could not be restored`, restoreError);
    }
    throw error;
  }
}

const validActions = state => state.pending.filter(a => check(LIVE_SCHEMAS.pendingAction, a).length === 0);

/** A queued craft must carry a sound escrow record (what it took, and the days it reserved). */
function escrowMismatches(state) {
  return validActions(state).filter(a => a.type === "craft")
    .flatMap(a => escrowProblems(a).map(problem => ({ kind: "escrow", message: `the queued craft "${a.params?.recipeName ?? a.id}": ${problem}` })));
}

/**
 * Every node's claimed charges must equal the queued gathers aimed at it. A leftover claim (a gather that vanished
 * without giving it back) would lock a charge for good; a gather with no claim could take a charge twice. A queued
 * gather whose node has gone (Clear map) is fine: it resolves as invalid. Rows have `node: true` and no actor id.
 */
export function reservationRows(actors = [...game.actors]) {
  const claimed = new Map();
  for (const actor of actors) {
    for (const action of validActions({ pending: asList(actor.getFlag(MODULE_ID, QUEUE_KEYS.pendingFlag)) })) {
      if (action.type !== "gather") continue;
      const key = `${action.params?.sceneId}/${action.params?.tokenId}`;
      claimed.set(key, (claimed.get(key) ?? 0) + 1);
    }
  }
  const rows = [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      const record = token.getFlag(MODULE_ID, "node");
      if (!record) continue;
      const held = reservedOf(record);
      const queued = claimed.get(`${scene.id}/${token.id}`) ?? 0;
      if (held !== queued) {
        rows.push({
          actorId: null, node: true, name: `${token.name} on ${scene.name}`, history: [],
          mismatches: [{ kind: "nodeReservation", message: `has ${held} charge(s) claimed, but ${queued} gather(s) are queued for it` }]
        });
      }
    }
  }
  return rows;
}

/** Actors whose data does not match the ledger, then nodes whose claimed charges do not match the queue. Each row: { actorId, name, mismatches, history }. */
export function scan(actors = [...game.actors]) {
  const ledger = readLedger();
  const commissions = readCommissions();
  const rows = [];
  for (const actor of actors) {
    const state = readState(actor);
    const entry = ledger[actor.id];
    if (!entry && !hasModuleData(state)) continue;
    const mismatches = [...compare(state, entry ?? emptyEntry(actor.name)), ...compareLoans({ actorId: actor.id, formulas: state.formulas, commissions }), ...escrowMismatches(state)];
    if (mismatches.length) rows.push({ actorId: actor.id, name: actor.name, mismatches, history: entry?.history ?? [] });
  }
  rows.push(...reservationRows());
  return rows;
}

/** First run: actors that already hold module data but have no ledger entry get one that matches today. Returns their names. */
export async function bootstrap(actors = [...game.actors], now = Date.now()) {
  requireGM("audit bootstrap");
  const added = [];
  await withLock(AUDIT_LOCK, async () => {
    const ledger = readLedger();
    for (const actor of actors) {
      const state = readState(actor);
      if (ledger[actor.id] || !hasModuleData(state)) continue;
      ledger[actor.id] = baselineEntry(state, actor.name, "baseline when auditing began", now);
      added.push(actor.name);
    }
    if (added.length) await writeLedger(ledger);
  });
  return added;
}

/** A note about something that is not one actor's data (a downtime start, a GM override). Kept under the ledger key "_events". */
export async function logWorldEvent(text, now = Date.now()) {
  requireGM("audit event");
  await changeLedger(ledger => {
    const history = [...(ledger._events?.history ?? []), { at: now, text }].slice(-100);
    ledger._events = { name: "World events", history };
  });
}

/** The GM accepts what an actor holds now: the ledger is reset to match it (history is kept). */
export async function accept(actor, now = Date.now()) {
  requireGM("audit accept");
  let fresh;
  await changeLedger(ledger => {
    fresh = baselineEntry(readState(actor), actor.name, "accepted by the GM", now);
    fresh.history = [...(ledger[actor.id]?.history ?? []), ...fresh.history].slice(-AUDIT.historyMax);
    ledger[actor.id] = fresh;
  });
  return fresh;
}
