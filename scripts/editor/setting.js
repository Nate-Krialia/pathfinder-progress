/** The editor's saved definitions (a world setting), read and written (Stage 11d). GM data: players can read a world setting from the console like any other (honor system). */
import { MODULE_ID, TAGS } from "../config.js";
import { reportDamaged } from "../backup.js";
import { emptyStore, storeProblems } from "./layer.js";

export const EDITOR_SETTING = "editorDefinitions";

/**
 * @returns {{ store, problems, raw }} an empty store when nothing is saved; a damaged setting comes back as an EMPTY store plus its `problems` (and the `raw` value), so the registry can
 * still load. Reading never writes: whether an edit may go ahead is decided by editor/store.js (it refuses while `problems` exist).
 */
export function readEditorStore() {
  const raw = game.settings.get(MODULE_ID, EDITOR_SETTING);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) return { store: emptyStore(), problems: [], raw };
  const problems = storeProblems(raw);
  return problems.length ? { store: emptyStore(), problems, raw } : { store: structuredClone(raw), problems: [], raw };
}

/**
 * The read the loader makes (GM, at load and on every reload): the same as readEditorStore, and a damaged store is kept ONCE in the backup setting and the GM is told once per load.
 * It is NOT dropped: nothing the editor made is lost, editing is switched off until api.editor.repair() drops only the damaged records.
 */
export function loadEditorStore() {
  const found = readEditorStore();
  if (found.problems.length) {
    found.backedUp = reportDamaged({
      kind: "editor", what: "editor definitions", raw: found.raw, problems: found.problems,
      consoleText: "the saved editor definitions are damaged, so none of them were loaded and editing is switched off:",
      note: `The saved item editor definitions are damaged: they were not loaded, and editing is switched off until they are repaired (api.editor.repair() drops only the damaged records). A copy of the damaged data is kept once in the "${TAGS.backupSetting}" world setting.`
    });
  }
  return found;
}

/** Replace the whole setting (a setting write replaces, so removing a record or a field here really removes it). */
export const writeEditorStore = store => game.settings.set(MODULE_ID, EDITOR_SETTING, store);
