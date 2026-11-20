/**
 * The `discoveryTracks` world setting (the research tracks the GM set outside the packs): { "<kind>:<id>": track }. GM data.
 *
 * EVERY write goes through `changeOverlay`: one keyed lock around the whole read-modify-write (the editor's save, its fold and its leftover removal, and `api.discovery.tracks.set/clear`
 * all write this one setting, and two of them overlapping used to drop one of the changes), and a DAMAGED value (not an object) refuses the write instead of being read as empty and
 * overwritten (the same pattern as the editor store: the raw value is kept once in the backup setting under "overlay", the write throws, nothing is replaced).
 *
 * Lock order: "discoveryTracks" is a LEAF lock. The editor takes it INSIDE "editorStore" (editorStore, then discoveryTracks); nothing inside it asks for another lock, so it never
 * waits on anything. The one-time backup (the "tagBackup" leaf lock) is taken BEFORE it, never inside.
 */
import { DISCOVERY, MODULE_ID } from "../config.js";
import { backUpOnce } from "../backup.js";
import { withLock } from "../queue/lock.js";

export const OVERLAY_LOCK = "discoveryTracks";
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** What is wrong with a stored overlay (plain sentences; empty = fine). Nothing saved is fine. */
export function overlayProblems(raw) {
  return raw === undefined || raw === null || isRecord(raw) ? [] : ["the saved research tracks are not a list of tracks (an unknown shape)"];
}

/** The overlay for READING (a damaged one reads as empty here; no write can go ahead, see changeOverlay). */
export const readOverlay = () => { const raw = game.settings.get(MODULE_ID, DISCOVERY.overlaySetting); return isRecord(raw) ? raw : {}; };

const damagedError = problems => new Error(`The saved research tracks are damaged (${problems.join("; ")}), so nothing can be saved until they are repaired. A copy is kept in the "tagBackup" setting under "overlay".`);

/**
 * Change the overlay under its lock. `change(overlay)` gets a COPY of what is stored and returns the new overlay, or `undefined` for "nothing to write". It may be async and may throw
 * (nothing is written then). Returns { before, after, changed }.
 */
export async function changeOverlay(change) {
  const first = game.settings.get(MODULE_ID, DISCOVERY.overlaySetting);
  const early = overlayProblems(first);
  if (early.length) { await backUpOnce("overlay", first, "research tracks"); throw damagedError(early); }
  return withLock(OVERLAY_LOCK, async () => {
    const raw = game.settings.get(MODULE_ID, DISCOVERY.overlaySetting);
    const problems = overlayProblems(raw);
    if (problems.length) throw damagedError(problems);                         // damaged while we waited for the lock: the backup is taken by the next attempt
    const before = structuredClone(raw ?? {});
    const after = await change(structuredClone(before));
    if (after === undefined) return { before, after: before, changed: false };
    await game.settings.set(MODULE_ID, DISCOVERY.overlaySetting, after);
    return { before, after, changed: true };
  });
}
