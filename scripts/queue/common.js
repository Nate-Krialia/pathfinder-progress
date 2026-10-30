/**
 * Helpers shared by the queued actions that run on the GM client (craft, gather, share, build, and the workshop calls):
 * the audit-log note, who is asking, the undo plumbing, the escrow take / give-back, whispers, and saving a queued action.
 * Kept here (not in work.js) so the modules that build on them do not import each other in a circle.
 */
import { MODULE_ID, QUEUE_KEYS } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { logWorldEvent } from "../audit/store.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { gpText } from "../commissions/commission.js";
import { rawList } from "../research/store.js";
import { ensureMaterials, whileHandled } from "../compendium/store.js";
import { refusal } from "./relay.js";

export const flagKey = key => `flags.${MODULE_ID}.${key}`;
export const pendingOf = actor => rawList(actor, QUEUE_KEYS.pendingFlag);

/** A line in the audit ledger's world events. The operation it describes is already done, so a failed log never fails it. */
export async function note(text) {
  try {
    await logWorldEvent(text);
  } catch (error) {
    console.error(`${MODULE_ID} | could not write to the audit log: ${text}`, error);
  }
}

/**
 * The user behind a relayed call. socketlib may say who called (`socketdata.userId`); otherwise it is the id the
 * caller sent. Foundry cannot prove identity to a module, so this is an honor-system check (see docs/10): it stops
 * the buttons and the API being used on someone else's character, not a player determined to forge an id.
 */
export function callerOf(payload, context) {
  const id = context?.socketdata?.userId ?? payload?.userId;
  const user = game.users.get(id);
  if (!user) throw refusal(`the GM client does not know the user "${id}"`);
  return user;
}

/**
 * Who is REALLY asking, for requests that must not trust a client-supplied id. The sender is socketlib's own (from Foundry's socket event, `this.socketdata.userId`).
 * Without it, only a call made directly on THIS GM client is accepted (asGM adds the GM's own id there); a userId in the payload of anything else is ignored.
 */
export function senderOf(payload, context) {
  const real = context?.socketdata?.userId;
  if (real) {
    const user = game.users.get(real);
    if (!user) throw refusal(`the GM client does not know the user "${real}"`);
    return user;
  }
  if (game.user.isGM && payload?.userId === game.user.id) return game.user;
  throw refusal("This request did not say who is asking, so it was not done.");
}

/** The GM or an owner of the actor. Throws otherwise, before anything is read or written. */
export function assertOwner(actor, user, what) {
  if (user.isGM) return;
  if (!actor.testUserPermission(user, "OWNER")) throw refusal(`${what}: ${user.name} does not own ${actor.name}`);
}

// Undo plumbing ---------------------------------------------------------------------------------------------------
export async function undoAll(undos) {
  const failures = [];
  for (const undo of [...undos].reverse()) {
    try { await undo.run(); } catch (error) { failures.push(`${undo.what} (${error.message})`); }
  }
  if (failures.length) throw new Error(`could not undo: ${failures.join("; ")}. Check these by hand.`);
}

export async function undoThenThrow(undos, error) {
  try {
    await undoAll(undos);
  } catch (undoError) {
    throw new Error(`${error.message}. ${undoError.message}`, { cause: error });
  }
  throw error;
}

/** Take the materials (one stack at a time, each with its own undo) and the fee. Returns the undos. */
export async function takeEscrow(actor, byStack, feeCopper) {
  const undos = [];
  try {
    for (const [stackId, units] of Object.entries(byStack)) {
      const item = actor.items.get(stackId);
      if (!item) throw new Error(`${actor.name} no longer has that stack of materials`);
      const snapshot = { quantity: item.system?.quantity ?? 1, data: item.toObject() };
      await adapter.consumeMaterialStacks(actor, { [stackId]: units });
      undos.push({
        what: `materials on ${actor.name}`,
        run: async () => {
          const existing = actor.items.get(stackId);
          if (existing) await existing.update({ "system.quantity": snapshot.quantity });
          else await adapter.createItemOnActor(actor, snapshot.data);
        }
      });
    }
    if (feeCopper > 0) {
      await adapter.removeCopper(actor, feeCopper);
      undos.push({ what: `${gpText(feeCopper)} on ${actor.name}`, run: () => adapter.addCopper(actor, feeCopper) });
    }
  } catch (error) {
    await undoThenThrow(undos, error);
  }
  return undos;
}

/**
 * Hand materials (and optionally the fee) back to the stash and purse. Returns the undos.
 * A return is not a discovery, so the createItem hook skips these items. Once the whole operation has COMMITTED, the
 * caller passes the same units to recordReturned(): each material is recorded in the Compendium only if the character
 * had no entry for it, so a return can never leave a material unrecorded (and a failed, undone operation records nothing).
 */
export async function giveBack(actor, units, feeCopper = 0) {
  const undos = [];
  try {
    await whileHandled(actor.id, units.map(u => u.materialId), async () => {
      for (const u of units) {
        const before = adapter.getMaterialStacks(actor).find(s => s.materialId === u.materialId)?.quantity ?? 0;
        const item = await adapter.giveMaterial(actor, { id: u.materialId, name: u.name ?? u.materialId, tier: u.tier }, u.units);
        undos.push({
          what: `${u.units}x ${u.materialId} on ${actor.name}`,
          run: () => (before === 0 ? item.delete() : item.update({ "system.quantity": before }))
        });
      }
    });
    if (feeCopper > 0) {
      await adapter.addCopper(actor, feeCopper);
      undos.push({ what: `${gpText(feeCopper)} on ${actor.name}`, run: () => adapter.removeCopper(actor, feeCopper) });
    }
  } catch (error) {
    await undoThenThrow(undos, error);
  }
  return undos;
}

/** After an operation that handed `units` back has committed: record any material the character has no entry for. Best-effort. */
export function recordReturned(actor, units) {
  return units?.length ? ensureMaterials(actor, units.map(u => ({ id: u.materialId, name: u.name, tier: u.tier }))) : undefined;
}

export { ownerIds, whisper, gmIds } from "../chat.js";

export async function appendAction(actor, action, extraUpdate = {}) {
  const problems = check(LIVE_SCHEMAS.pendingAction, action);
  if (problems.length) throw new Error(`submit: built an invalid action: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  await actor.update({ [flagKey(QUEUE_KEYS.pendingFlag)]: [...pendingOf(actor), action], ...extraUpdate });
}

