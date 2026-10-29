/**
 * Whispers. A leaf module (no imports from the rest of the module) so research, queue and compendium code can all use it.
 * Player-facing results go to the owners and the GM only; anything with a DC or a roll total goes to the GM alone (docs/11b).
 */
import { MODULE_ID } from "./config.js";

export const ownerIds = actor => [...(game.users ?? [])].filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
export const gmIds = () => (ChatMessage.getWhisperRecipients?.("GM") ?? []).map(u => u.id);
/** The people who should see a character's result: its owners and the GM(s). */
export const resultRecipients = actor => [...new Set([...ownerIds(actor), ...gmIds()])];

export async function whisper(recipients, content) {
  if (!recipients.length) return;
  try {
    await ChatMessage.create({ whisper: recipients, content });
  } catch (error) {
    console.error(`${MODULE_ID} | the result is saved, but the chat message failed`, error);
  }
}
