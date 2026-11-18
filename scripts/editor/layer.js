/**
 * Editor-made definitions layered over the pack's (Stage 11d). Pure; no Foundry globals.
 *
 * The editor's content lives in the WORLD (setting `editorDefinitions`), never in the repo and never in the locked packs:
 *   { v: 1, records: { "<kind>:<id>": { kind, id, mode: "new" | "patch", fields: {...} } } }
 *   - "new":   a definition the GM made in the editor; `fields` is the whole record except kind and id.
 *   - "patch": an edit of a pack definition; `fields` are only the fields that were changed. Removing a field from the patch restores the pack's value.
 * The layer works on the loader's SOURCES (each page's JSON text), so everything it produces goes through the same validation as a pack page and a bad editor record is
 * reported by name and skipped without blocking the rest.
 */
import { blockValue, compileEffects } from "./blocks.js";
import { parseDefinition } from "../data/validate.js";

export const STORE_VERSION = 1;
export const emptyStore = () => ({ v: STORE_VERSION, records: {} });
export const keyOf = (kind, id) => `${kind}:${id}`;
const ROLE_OF = { damage: "bonusDamage", resistance: "resistance", ability: "specialAbility", condition: "applyCondition" };

const recordProblem = (key, rec) => (!rec || key !== keyOf(rec.kind, rec.id) || !["new", "patch"].includes(rec.mode) || typeof rec.fields !== "object" || Array.isArray(rec.fields) ? `the saved definition "${key}" is damaged` : null);
const hasRecords = store => store && typeof store === "object" && store.v === STORE_VERSION && store.records !== null && typeof store.records === "object" && !Array.isArray(store.records);

/** What a store must look like; a damaged setting is an error to show, never silently replaced. */
export function storeProblems(store) {
  if (!hasRecords(store)) return ["the editor's saved definitions have an unknown shape"];
  return Object.entries(store.records).map(([key, rec]) => recordProblem(key, rec)).filter(Boolean);
}

/**
 * The records of a damaged store that are still sound, and the keys of those that are not: { usable, store, dropped }. A store whose OUTER shape is unknown (no records at all) is not
 * usable record by record: `usable` is false and nothing is salvaged.
 */
export function repairStore(raw) {
  if (!hasRecords(raw)) return { usable: false, store: emptyStore(), dropped: [] };
  const records = {}, dropped = [];
  for (const [key, rec] of Object.entries(raw.records)) { if (recordProblem(key, rec)) dropped.push(key); else records[key] = rec; }
  return { usable: true, store: { v: STORE_VERSION, records }, dropped };
}

/** A material with builder blocks gets its role values from them (the blocks are the source of truth); a record without blocks is left as it is. */
export function finalizeRecord(data) {
  if (data.kind !== "material" || !data.effectBlocks) return data;
  const { effects, classEffects } = compileEffects(data.effectBlocks, data.tier);
  const next = { ...data, effects };
  if (Object.keys(classEffects).length) next.classEffects = classEffects; else delete next.classEffects;
  return next;
}

const sourceText = data => "```json\n" + JSON.stringify(data, null, 2) + "\n```";

/**
 * @param {Array<{ pack, entry, text }>} sources  the pages read from the packs
 * @param {object} store                          the editor's saved definitions
 * @returns {{ sources: Array<{ pack, entry, text }>, leftovers: Array<{ key, message }> }}
 */
export function layerSources(sources, store) {
  const leftovers = [];
  const parsed = sources.map(source => ({ source, data: parseDefinition(source.text, { pack: source.pack, entry: source.entry }).data ?? null }));
  const byKey = new Map(parsed.filter(p => p.data?.kind && p.data?.id).map(p => [keyOf(p.data.kind, p.data.id), p]));
  const added = [];

  for (const [key, rec] of Object.entries(store?.records ?? {})) {
    const base = byKey.get(key);
    if (rec.mode === "patch") {
      if (!base) { leftovers.push({ key, message: "edits a definition that is not in the packs any more" }); continue; }
      base.data = { ...base.data, ...rec.fields };
      base.edited = true;
    } else if (base) {
      leftovers.push({ key, message: "uses an id the packs already define; the pack's definition is kept" });
    } else {
      const entry = { source: { pack: "world editor", entry: rec.fields.name ?? rec.id }, data: { kind: rec.kind, id: rec.id, ...rec.fields } };
      added.push(entry);
      byKey.set(key, entry);
    }
  }

  const all = [...parsed, ...added];
  // A material's per-recipe overrides are copied onto that recipe's override list (the recipe schema is unchanged).
  for (const mat of all.filter(p => p.data?.kind === "material")) {
    mat.data = finalizeRecord(mat.data);
    for (const o of mat.data.recipeOverrides ?? []) {
      const recipe = byKey.get(keyOf("recipe", o.recipeId));
      if (!recipe?.data) { leftovers.push({ key: keyOf("material", mat.data.id), message: `has an override for "${o.recipeId}", which does not exist` }); continue; }
      recipe.data = { ...recipe.data, overrides: [...(recipe.data.overrides ?? []).filter(x => !(x.materialId === mat.data.id && x.slot === o.slot && x.role === ROLE_OF[o.block.type])), { materialId: mat.data.id, slot: o.slot, role: ROLE_OF[o.block.type], effect: o.block.type === "condition" ? [blockValue(o.block, mat.data.tier)] : blockValue(o.block, mat.data.tier) }] };
      recipe.edited = true;
    }
  }

  // Pages the layer changed or made are written back as text, so they pass through exactly the validation a pack page does.
  const out = all.map(p => (p.data && (added.includes(p) || p.edited || (p.data.kind === "material" && p.data.effectBlocks)) ? { ...p.source, text: sourceText(p.data) } : p.source));
  return { sources: out, leftovers };
}
