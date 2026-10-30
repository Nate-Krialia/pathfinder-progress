/**
 * The GM's resolve log (Stage 11a). A leaf module: a ring buffer in this client's memory, never saved to a setting or a flag.
 *
 * Totals, DCs, percentages and hidden rolls used to go out as GM-only whispers. A whisper is still delivered to every client's
 * game.messages (hidden from a player's chat log, readable from the console), so none of them is a chat message any more. They are
 * recorded here instead, on the client of the GM who resolved the action, and read with api.gm.log() (GM only).
 *
 * The Stage 11b GM window reads list() and re-renders when the `pfpGmLogChanged` hook fires (local to this client).
 * It is per client and per session on purpose: a reload empties it, and a second GM does not see the first GM's entries.
 */
import { GM_LOG } from "./config.js";

const entries = [];
let nextId = 1;

/** Plain text of a small HTML snippet: breaks become "; ", tags go. */
export function plainText(html) {
  return String(html ?? "").replace(/<(br|\/p|\/li|\/h3)\s*\/?>/gi, "; ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s*;\s*(;\s*)+/g, "; ").replace(/\s+/g, " ").replace(/[;\s]+$/, "").trim();
}

/** Add an entry: { kind, actorId?, actorName?, text, detail? }. Returns the stored entry. */
export function record({ kind, actorId = null, actorName = null, text, detail = null }) {
  const entry = { id: nextId++, at: Date.now(), kind, actorId, actorName, text: String(text), detail: detail === null ? null : structuredClone(detail) };
  entries.push(entry);
  while (entries.length > GM_LOG.maxEntries) entries.shift();
  try { globalThis.Hooks?.callAll?.(GM_LOG.changedHook, entry); } catch (error) { console.error("pathfinder-progress | a GM log listener failed", error); }
  return structuredClone(entry);
}

/** Newest first. Options: { limit, kind, actorId }. */
export function list({ limit, kind, actorId } = {}) {
  let rows = entries.filter(e => (kind === undefined || e.kind === kind) && (actorId === undefined || e.actorId === actorId)).reverse();
  if (limit !== undefined) rows = rows.slice(0, limit);
  return structuredClone(rows);
}

export function clear() { entries.length = 0; }
