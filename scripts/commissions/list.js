/**
 * The world-level commission list (a GM-written setting). Players can read it, never write it:
 * their requests reach it through the queue, resolved on a GM client.
 */
import { COMMISSIONS, MODULE_ID } from "../config.js";
import { withLock } from "../queue/lock.js";

export function readCommissions() {
  const raw = game.settings.get(MODULE_ID, COMMISSIONS.settingKey);
  return Array.isArray(raw) ? structuredClone(raw) : [];
}

export async function writeCommissions(list) {
  if (!game.user.isGM) throw new Error("commissions: only a GM client can write the commission list");
  await game.settings.set(MODULE_ID, COMMISSIONS.settingKey, list);
}

/**
 * The whole list is ONE setting, so every change to it is a read-modify-write under ONE lock: read INSIDE the lock, change the copy, await the write. `mutate(list)` changes the list
 * in place and may return a value. A LEAF lock: nothing inside it takes another lock or touches an actor, so it sits innermost (after node, actor and the commission's own lock).
 */
export const COMMISSION_LIST_LOCK = "commissionList";
export function changeCommissions(mutate) {
  return withLock(COMMISSION_LIST_LOCK, async () => {
    const list = readCommissions();
    const result = mutate(list);
    await writeCommissions(list);
    return result;
  });
}
