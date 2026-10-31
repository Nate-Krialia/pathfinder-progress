/** Export and import of the editor's records (Stage 11d). Pure; no Foundry globals. A bundle is plain JSON the GM can keep or hand to another world. */
import { keyOf, storeProblems } from "./layer.js";

export const BUNDLE_FORMAT = "pathfinder-progress-editor";
export const BUNDLE_VERSION = 1;
const KINDS = ["material", "note", "tag"];

/** The bundle for some (or all) of the store's records. */
export function exportBundle(store, keys = null) {
  const wanted = keys ? new Set(keys) : null;
  return { format: BUNDLE_FORMAT, v: BUNDLE_VERSION, records: Object.entries(store.records).filter(([key]) => !wanted || wanted.has(key)).map(([, rec]) => structuredClone(rec)) };
}

/**
 * What importing a bundle would do, without doing it.
 * @returns {{ problems: string[], add: object[], replace: object[], skip: Array<{ key, reason }> }}
 *   problems = the bundle is not usable at all (nothing is imported). A record that clashes is skipped with a reason unless `replace` is on.
 */
export function planImport(bundle, store, { definedIds = new Set(), replace = false } = {}) {
  const problems = [], add = [], replaceList = [], skip = [];
  if (!bundle || bundle.format !== BUNDLE_FORMAT) return { problems: ["That file is not an item editor export."], add, replace: replaceList, skip };
  if (bundle.v !== BUNDLE_VERSION) return { problems: [`That export is version ${bundle.v}; this module reads version ${BUNDLE_VERSION}.`], add, replace: replaceList, skip };
  if (!Array.isArray(bundle.records)) return { problems: ["That export has no list of records."], add, replace: replaceList, skip };
  const seen = new Set();
  bundle.records.forEach((rec, i) => {
    const key = rec && KINDS.includes(rec.kind) ? keyOf(rec.kind, rec.id) : null;
    if (!key || !["new", "patch"].includes(rec.mode) || !rec.fields || typeof rec.fields !== "object" || Array.isArray(rec.fields)) { problems.push(`Record ${i + 1} is damaged.`); return; }
    if (seen.has(key)) { skip.push({ key, reason: "appears twice in the file" }); return; }
    seen.add(key);
    if (store.records[key]) { (replace ? replaceList : skip).push(replace ? rec : { key, reason: "already exists here" }); return; }
    if (rec.mode === "new" && definedIds.has(key)) { skip.push({ key, reason: "uses an id the packs already define" }); return; }
    add.push(rec);
  });
  const shape = storeProblems({ v: 1, records: Object.fromEntries([...add, ...replaceList].map(r => [keyOf(r.kind, r.id), r])) });
  return { problems: [...problems, ...shape], add, replace: replaceList, skip };
}
