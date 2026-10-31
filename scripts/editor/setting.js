/** The editor's saved definitions (a world setting), read and written (Stage 11d). GM data: players can read a world setting from the console like any other (honor system). */
import { MODULE_ID } from "../config.js";
import { emptyStore, storeProblems } from "./layer.js";

export const EDITOR_SETTING = "editorDefinitions";

/** @returns {{ store, problems }} an empty store when nothing is saved; a damaged setting is reported (and treated as empty) so the rest of the module still loads. */
export function readEditorStore() {
  const raw = game.settings.get(MODULE_ID, EDITOR_SETTING);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) return { store: emptyStore(), problems: [] };
  const problems = storeProblems(raw);
  return problems.length ? { store: emptyStore(), problems } : { store: structuredClone(raw), problems: [] };
}

/** Replace the whole setting (a setting write replaces, so removing a record or a field here really removes it). */
export const writeEditorStore = store => game.settings.set(MODULE_ID, EDITOR_SETTING, store);
