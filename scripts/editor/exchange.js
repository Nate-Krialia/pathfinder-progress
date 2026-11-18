/** Export and import of the editor's records (Stage 11d). Pure; no Foundry globals. A bundle is plain JSON the GM can keep or hand to another world. */
import { ID_PATTERN } from "../config.js";
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
 *   problems = the bundle is not usable at all (nothing is imported). A record that clashes is skipped with a reason unless `replace` is on; so is an edit of a definition that does not exist here.
 */
export function planImport(bundle, store, { definedIds = new Set(), replace = false } = {}) {
  const problems = [], add = [], replaceList = [], skip = [];
  if (!bundle || bundle.format !== BUNDLE_FORMAT) return { problems: ["That file is not an item editor export."], add, replace: replaceList, skip };
  if (bundle.v !== BUNDLE_VERSION) return { problems: [`That export is version ${bundle.v}; this module reads version ${BUNDLE_VERSION}.`], add, replace: replaceList, skip };
  if (!Array.isArray(bundle.records)) return { problems: ["That export has no list of records."], add, replace: replaceList, skip };
  const seen = new Set();
  bundle.records.forEach((rec, i) => {
    // An id is a lowercase slug (the same pattern every definition's id must match): a dot in it would become a path when Foundry saves the record's key, and anything else could never load.
    if (rec && KINDS.includes(rec.kind) && (typeof rec.id !== "string" || !ID_PATTERN.test(rec.id))) { problems.push(`Record ${i + 1} has an id that cannot be used (${JSON.stringify(rec.id)}): an id is lowercase letters, digits, - or _, with no dots.`); return; }
    const key = rec && KINDS.includes(rec.kind) ? keyOf(rec.kind, rec.id) : null;
    if (!key || !["new", "patch"].includes(rec.mode) || !rec.fields || typeof rec.fields !== "object" || Array.isArray(rec.fields)) { problems.push(`Record ${i + 1} is damaged.`); return; }
    if (seen.has(key)) { skip.push({ key, reason: "appears twice in the file" }); return; }
    seen.add(key);
    if (store.records[key]) { (replace ? replaceList : skip).push(replace ? rec : { key, reason: "already exists here" }); return; }
    if (rec.mode === "new" && definedIds.has(key)) { skip.push({ key, reason: "uses an id the packs already define" }); return; }
    // An edit of a definition that is not here (another world's packs) would only be stored as a leftover that matches nothing: it is refused instead.
    if (rec.mode === "patch" && !definedIds.has(key)) { skip.push({ key, reason: "edits a definition that does not exist in this world" }); return; }
    add.push(rec);
  });
  const shape = storeProblems({ v: 1, records: Object.fromEntries([...add, ...replaceList].map(r => [keyOf(r.kind, r.id), r])) });
  return { problems: [...problems, ...shape], add, replace: replaceList, skip };
}
