/**
 * The one-time backup of a damaged GM setting (a leaf module: it imports nothing from the rest of the module but config and the keyed lock).
 *
 * A damaged ledger, caps table, frozen store or editor store is never allowed to be silently replaced by the next write. Before that can happen the raw value is kept ONCE in the
 * `tagBackup` world setting, as a JSON string under a fixed key ("ledger", "caps", "frozen" or "editor"): a string, so a uuid or a name inside it never becomes an object key (Foundry
 * reads a dot in a key as a path). An existing backup for a key is never replaced. The setting is GM data like the ones it backs up (honor system: a world setting can be read from
 * a Player's console).
 *
 * Lock order: "tagBackup" is a LEAF lock. Nothing inside it asks for another lock, and it is never taken while holding it.
 */
import { MODULE_ID, TAGS } from "./config.js";
import { withLock } from "./queue/lock.js";

export const BACKUP_LOCK = "tagBackup";

/** Keep `raw` once under `kind`. Returns a promise of { kept: boolean } (never rejects). `what` names it for the console. */
export function backUpOnce(kind, raw, what = kind) {
  const text = JSON.stringify(raw);        // taken now: a save that follows cannot change what is kept
  return withLock(BACKUP_LOCK, async () => {
    const have = game.settings.get(MODULE_ID, TAGS.backupSetting);
    const store = have && typeof have === "object" && !Array.isArray(have) ? have : {};
    if (typeof store[kind] === "string" && store[kind] !== "") return { kept: false };
    await game.settings.set(MODULE_ID, TAGS.backupSetting, { ...store, [kind]: text });
    return { kept: true };
  }).catch(error => { console.error(`${MODULE_ID} | could not keep a copy of the damaged ${what}`, error); return { kept: false, error }; });
}

/** A damaged setting was found at load: say so on the console (with the problems), tell the GM once, and keep the raw copy. Returns the backup's promise. */
export function reportDamaged({ kind, what, raw, problems, consoleText, note }) {
  console.error(`${MODULE_ID} | ${consoleText}`, problems);
  const backedUp = backUpOnce(kind, raw, what);
  globalThis.ui?.notifications?.warn?.(note);
  return backedUp;
}
