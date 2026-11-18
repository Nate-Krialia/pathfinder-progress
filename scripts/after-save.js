/**
 * What happens AFTER a change has been saved (a leaf module). Telling the players the definitions changed and writing the audit log line come after the write, so a failure there is
 * not a failed save: the window must not show an error for a change that is in the world (the GM would retry, and a retried create makes a second record with a `-2` id).
 * Each step is tried on its own (one failing does not skip the next); every failure is a console warning with its error, and the GM gets ONE note per saved change that names what
 * was saved and which steps failed.
 */
import { MODULE_ID } from "./config.js";

/** @param {string} what  "the tag change", "the editor change"   @param {Array<[string, () => any]>} steps  [label, function] */
export async function afterSave(what, steps) {
  const failed = [];
  for (const [label, step] of steps) {
    try { await step(); } catch (error) {
      failed.push(label);
      console.warn(`${MODULE_ID} | ${what} was saved, but ${label} failed`, error);
    }
  }
  if (failed.length) globalThis.ui?.notifications?.warn?.(`${what[0].toUpperCase()}${what.slice(1)} was saved, but ${failed.join(" and ")} failed (see the console).`);
}
