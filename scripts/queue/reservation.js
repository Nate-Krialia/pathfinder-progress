/**
 * Day reservation arithmetic for the queue. Pure; no Foundry globals.
 *
 * The actor's counter holds UNRESERVED days. Queued actions hold reserved days.
 * Total = unreserved + reserved. Submitting, rejecting and editing only MOVE days between
 * the two, so the total never changes; only a resolved action spends days.
 */
import { daysFrom } from "../research/days.js";

const isDays = n => Number.isInteger(n) && n >= 1;

/** Reserved days across a list of queued actions (entries with a bad `daysReserved` count as 0). */
export const pendingTotal = pending => pending.reduce((sum, action) => sum + (isDays(action?.daysReserved) ? action.daysReserved : 0), 0);

export const totalDays = (counter, pending) => daysFrom(counter) + pendingTotal(pending);

/** Reserve `days` for a new action. Never overbooks. */
export function planSubmit(counter, days) {
  if (!isDays(days)) return { ok: false, error: `days must be a whole number of at least 1 (got ${days})` };
  const have = daysFrom(counter);
  if (days > have) return { ok: false, error: `cannot reserve ${days} day(s): only ${have} unreserved` };
  return { ok: true, counter: have - days };
}

/** Rejecting refunds every reserved day. */
export function planReject(counter, action) {
  return { counter: daysFrom(counter) + action.daysReserved };
}

/** Change how many days an action reserves. A raise needs enough unreserved days; a cut refunds the difference. */
export function planEdit(counter, action, newDays) {
  if (!isDays(newDays)) return { ok: false, error: `days must be a whole number of at least 1 (got ${newDays}); to cancel, reject the action` };
  const delta = newDays - action.daysReserved;
  const have = daysFrom(counter);
  if (delta > have) {
    return { ok: false, error: `cannot raise to ${newDays} day(s): ${have} unreserved day(s) available, ${delta} more needed` };
  }
  return { ok: true, counter: have - delta, daysReserved: newDays };
}

/** Resolving spends `spent` of the reserved days and refunds the rest. */
export function planResolve(counter, reserved, spent) {
  if (!Number.isInteger(spent) || spent < 0 || spent > reserved) {
    throw new RangeError(`planResolve: spent must be between 0 and the ${reserved} reserved day(s) (got ${spent})`);
  }
  return { counter: daysFrom(counter) + (reserved - spent), refunded: reserved - spent };
}
