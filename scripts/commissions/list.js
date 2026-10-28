/**
 * The world-level commission list (a GM-written setting). Players can read it, never write it:
 * their requests reach it through the queue, resolved on a GM client.
 */
import { COMMISSIONS, MODULE_ID } from "../config.js";

export function readCommissions() {
  const raw = game.settings.get(MODULE_ID, COMMISSIONS.settingKey);
  return Array.isArray(raw) ? structuredClone(raw) : [];
}

export async function writeCommissions(list) {
  if (!game.user.isGM) throw new Error("commissions: only a GM client can write the commission list");
  await game.settings.set(MODULE_ID, COMMISSIONS.settingKey, list);
}
