/**
 * The item editor, Foundry side (Stage 11d, GM only): create, edit, retire, delete and re-push materials and notes.
 *
 * Content lives in the world setting `editorDefinitions` (scripts/editor/layer.js). Every change is checked IN MEMORY first: the whole registry is rebuilt with the candidate
 * store and, if that would introduce a definition problem, nothing is written and the problem is returned in plain words. Only then is the setting written, the in-memory
 * registry replaced and the players told the definitions changed. Pack definitions are never written; an edit of one is a patch in the world.
 */
import { COMMISSIONS, COMPENDIUM, DISCOVERY, MODULE_ID, RESEARCH_KEYS } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { formatError } from "../data/validate.js";
import { check } from "../data/schema.js";
import { TRACK_SCHEMA } from "../data/schemas.js";
import { craftedWith, propertiesReached } from "../discovery/track.js";
import { logWorldEvent } from "../audit/store.js";
import * as playerDefs from "../data/playerDefs.js";
import * as stations from "../stations/store.js";
import { buildRegistry } from "./build.js";
import { exportBundle, planImport } from "./exchange.js";
import { emptyStore, keyOf } from "./layer.js";
import { EDITOR_SETTING, readEditorStore, writeEditorStore } from "./setting.js";

const requireGM = what => { if (!game.user?.isGM) throw new Error(`${what}: GM only`); };

/** An editor problem with plain sentences the window shows; `details` carries structured data (what uses something, what would change). */
export class EditorError extends Error {
  constructor(message, details = {}) { super(message); this.name = "EditorError"; this.details = details; }
}

export const slugify = text => String(text ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
const fmt = formatError;
const kindOf = key => key.split(":")[0];
const idOf = key => key.split(":").slice(1).join(":");

const base = api => api.baseSources ?? [];
const current = () => readEditorStore().store;

/** Swap the in-memory registry for a freshly built one, the way `reload` does (the refresh hook, the station errors), without re-reading the packs. */
function install(api, built) {
  api.definitions = playerDefs.attachRefresh(built.registry);
  api.contexts = built.contexts;
  api.errors = [...built.errors, ...stations.readStations(api).errors];
  api.editorLeftovers = built.leftovers;
}

/** What the packs plus the saved edits build, and the definitions that exist only in memory (a test fixture, a gate's fakes): the editor leaves those alone. */
function baseline(api) {
  const built = buildRegistry(base(api), current());
  const memoryOnly = [];
  for (const [kind, map] of Object.entries(api.definitions ?? {})) if (map instanceof Map) for (const [id, rec] of map) if (!built.registry[kind]?.has(id)) memoryOnly.push([kind, id, rec]);
  return { built, memoryOnly };
}

/** Check a candidate store in memory; on success write it, install the new registry (memory-only definitions kept) and tell the players. */
async function commitStore(api, candidate) {
  const { built: now, memoryOnly } = baseline(api);
  const before = new Set(now.errors.map(fmt));
  const built = buildRegistry(base(api), candidate);
  const fresh = built.errors.filter(e => !before.has(fmt(e)));
  if (fresh.length) throw new EditorError(fresh.map(e => `${e.entry}: ${e.field} ${e.message}`).join("; "), { problems: fresh });
  await writeEditorStore(candidate);
  for (const [kind, id, rec] of memoryOnly) if (!built.registry[kind].has(id)) built.registry[kind].set(id, rec);
  install(api, built);
  await api.publishDefinitions?.();
  return built;
}

/** Does this definition come from the packs or the editor (so an edit can be saved), as opposed to existing only in memory? */
export const canEdit = (api, key) => isSaved(api, key);
const isSaved = (api, key) => Boolean(buildRegistry(base(api), current()).registry[kindOf(key)]?.has(idOf(key)));

const clone = x => structuredClone(x);
const withRecord = (store, rec) => { const next = clone(store); next.records[keyOf(rec.kind, rec.id)] = rec; return next; };

// Reading -----------------------------------------------------------------------------------------------------------
/** Where a definition comes from: "world" (made in the editor), "pack" (untouched) or "pack, edited here". */
export function originOf(key, store = current()) {
  const rec = store.records[key];
  return rec ? (rec.mode === "new" ? "world" : "pack, edited here") : "pack";
}

/** The characters (names) whose own book or studies already show what a material does. */
export function knownBy(api, materialId) {
  const out = [];
  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    const book = actor.getFlag(MODULE_ID, "compendium");
    const ledger = actor.getFlag(MODULE_ID, RESEARCH_KEYS.discoveriesFlag);
    if (craftedWith({ own: book }, materialId) || propertiesReached(ledger, keyOf("material", materialId))) out.push(actor.name);
  }
  // The party's shared book counts for everyone.
  let shared = null;
  try { shared = game.settings.get(MODULE_ID, COMPENDIUM.sharedSetting); } catch { /* not registered in a bare test world */ }
  if (shared && craftedWith({ shared }, materialId)) out.push("the party's shared book");
  return out.sort();
}

/** Everything that uses a definition: copies of the item, recipes, node types and creatures that name a material, and the characters who know it. */
export function usageOf(api, key) {
  const kind = kindOf(key), id = idOf(key);
  const copies = adapter.copiesOf(kind, id).filter(c => !(c.actor === null && c.item.getFlag?.(MODULE_ID, "template")));
  const byActor = new Map();
  for (const c of copies) byActor.set(c.actor?.name ?? "(world items)", (byActor.get(c.actor?.name ?? "(world items)") ?? 0) + 1);
  const defs = api.definitions;
  const recipes = kind === "material" ? [...defs.recipe.values()].filter(r => (r.overrides ?? []).some(o => o.materialId === id)).map(r => r.name) : [];
  const nodes = kind === "material" ? [...defs.nodeType.values()].filter(n => Object.values(n.ladders ?? {}).some(l => l.some(r => r.materialId === id))).map(n => n.name ?? n.id) : [];
  const yields = kind === "material" ? [...defs.creatureYield.values()].filter(y => y.yield.some(r => r.materialId === id)).map(y => y.id) : [];
  const notes = [];
  const used = { copies: [...byActor].map(([where, count]) => ({ where, count })), recipes, nodes, yields, notes };
  return { ...used, knownBy: kind === "material" ? knownBy(api, id) : [], inUse: used.copies.length + recipes.length + nodes.length + yields.length > 0 };
}

/** The effective definition and the editor's view of it: { key, kind, id, record, origin, retired, edited fields }. */
export function entry(api, key) {
  const record = api.definitions?.[kindOf(key)]?.get(idOf(key));
  if (!record) return null;
  const rec = current().records[key];
  return { key, kind: kindOf(key), id: idOf(key), record: clone(record), origin: originOf(key), editedFields: rec?.mode === "patch" ? Object.keys(rec.fields) : [], retired: Boolean(record.retired) };
}

/** The editor's saved records (for the list's "made here" / "edited here" tags). */
export const records = () => clone(current().records);

/** Is there a WORLD item (not an actor's copy) for this definition? The window offers "Make an item" when there is not. */
export const hasWorldItem = key => adapter.copiesOf(kindOf(key), idOf(key)).some(c => c.actor === null);

// Writing ------------------------------------------------------------------------------------------------------------
function uniqueId(api, store, wanted) {
  const taken = id => [...Object.values(api.definitions ?? {})].some(map => map instanceof Map && map.has(id)) || Object.values(store.records).some(r => r.id === id);
  if (!taken(wanted)) return wanted;
  for (let n = 2; n < 1000; n++) if (!taken(`${wanted}-${n}`)) return `${wanted}-${n}`;
  throw new EditorError(`could not find a free id near "${wanted}"`);
}

const MATERIAL_DEFAULTS = tier => ({ tier, value: COMMISSIONS.valueByTier[tier] ?? 0, effects: {}, bulk: "L" });

/** Fields a new record starts from. A note's track comes from its preset. */
function defaultsFor(kind, fields) {
  if (kind === "material") return { ...MATERIAL_DEFAULTS(fields.tier ?? 1), ...fields };
  return { bulk: "L", preset: "research", ...fields };
}

/**
 * Create a definition AND its linked world item. `fields` for a material: { name, tier?, value?, bulk?, img?, description?, tag?, label?, research?, effectBlocks?, id? };
 * for a note: { name, recipeId, preset?: "plan" | "research", ... }. Returns { key, record, item }.
 */
export async function create(api, kind, fields, { makeItem = true } = {}) {
  requireGM("editor.create");
  if (!["material", "note", "tag"].includes(kind)) throw new EditorError(`the editor makes materials, notes and tags (not "${kind}")`);
  if (!String(fields?.name ?? "").trim()) throw new EditorError("Give it a name first.");
  const store = current();
  const { id: wanted, ...rest } = fields;
  const id = uniqueId(api, store, wanted ? slugify(wanted) : slugify(fields.name));
  let data = defaultsFor(kind, rest);
  // A note's study length comes from its preset (config DISCOVERY.notePresets): a Plan note is a short study, a Research note a longer one.
  if (kind === "note" && data.research === undefined) data.research = { milestones: [{ steps: DISCOVERY.notePresets[data.preset] ?? DISCOVERY.notePresets.research, grants: { type: "formula" } }] };
  const rec = { kind, id, mode: "new", fields: data };
  await commitStore(api, withRecord(store, rec));
  const record = api.definitions[kind].get(id);
  let item = null;
  if (makeItem && kind !== "tag") item = await adapter.createWorldItem(kind, record, { folder: await adapter.ensureItemFolder(kind === "material" ? "Materials" : "Notes") });
  await logWorldEvent(`editor: created ${kind} "${record.name}"`);
  return { key: keyOf(kind, id), record, item };
}

/** What changing `fields` would alter that players may already know (tag, theme, class effects), if anyone does. */
export function impactOf(api, key, fields) {
  const kind = kindOf(key);
  const touches = [];
  if (kind === "material") {
    if ("tag" in fields) touches.push("its tag");
    if ("effectBlocks" in fields || "effects" in fields || "classEffects" in fields) touches.push("what it does in crafts");
  }
  if (kind === "tag" && ("theme" in fields || "name" in fields || "worksWith" in fields)) touches.push("the tag's theme");
  if (!touches.length) return { needsConfirm: false, what: [], knownBy: [] };
  const materials = kind === "material" ? [idOf(key)] : [...api.definitions.material.values()].filter(m => m.tag === idOf(key)).map(m => m.id);
  const known = [...new Set(materials.flatMap(id => knownBy(api, id)))];
  return { needsConfirm: known.length > 0, what: touches, knownBy: known };
}

/**
 * Change fields of a definition. A field set to `undefined` or `null` is removed (a patch field goes back to the pack's value). If characters already know something that
 * this changes, nothing is written until the caller passes `confirmed: true` (the window asks the GM first).
 */
export async function update(api, key, fields, { confirmed = false } = {}) {
  requireGM("editor.update");
  const store = current();
  const record = api.definitions[kindOf(key)]?.get(idOf(key));
  if (!record) throw new EditorError(`There is no ${key} to edit.`);
  if (!isSaved(api, key)) throw new EditorError("This item exists only in memory (it is not in the packs or the editor's saved items), so an edit could not be kept. Reloading would lose it.");
  const impact = impactOf(api, key, fields);
  if (impact.needsConfirm && !confirmed) throw new EditorError(`${impact.knownBy.join(", ")} already know${impact.knownBy.length === 1 ? "s" : ""} something this changes (${impact.what.join(", ")}).`, { needsConfirm: true, ...impact });
  const existing = store.records[key];
  const rec = existing ? clone(existing) : { kind: kindOf(key), id: idOf(key), mode: "patch", fields: {} };
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null) delete rec.fields[field]; else rec.fields[field] = value;
  }
  const next = withRecord(store, rec);
  if (rec.mode === "patch" && !Object.keys(rec.fields).length) delete next.records[key];     // nothing left to patch: the pack's definition shows again
  await commitStore(api, next);
  await logWorldEvent(`editor: edited ${key}`);
  return entry(api, key);
}

/** Take back an edit of a pack definition (every field, or one). */
export async function revert(api, key, field) {
  requireGM("editor.revert");
  const rec = current().records[key];
  if (!rec || rec.mode !== "patch") throw new EditorError("That item has no edits to take back.");
  return update(api, key, field ? { [field]: undefined } : Object.fromEntries(Object.keys(rec.fields).map(f => [f, undefined])), { confirmed: true });
}

export const retire = (api, key, retired = true) => update(api, key, { retired: retired ? true : undefined }, { confirmed: true });

/** Delete an editor-made definition that nothing uses. A pack's definition can only be retired. */
export async function remove(api, key) {
  requireGM("editor.remove");
  const store = current();
  const rec = store.records[key];
  if (!rec || rec.mode !== "new") throw new EditorError("A definition from the packs cannot be deleted; retire it to hide it from the lists.");
  const usage = usageOf(api, key);
  if (usage.inUse) throw new EditorError("It is still in use, so it cannot be deleted. Retire it instead, or remove what uses it first.", { usage });
  const next = clone(store);
  delete next.records[key];
  await commitStore(api, next);
  for (const c of adapter.copiesOf(kindOf(key), idOf(key))) if (c.actor === null && c.item.getFlag?.(MODULE_ID, "template")) await c.item.delete();
  await logWorldEvent(`editor: deleted ${key}`);
  return true;
}

/** Write the definition's name, image, description, bulk, price (and a material's tier) onto every existing copy. Unlinked scene tokens are skipped and counted. */
export async function pushCopies(api, key) {
  requireGM("editor.pushCopies");
  const kind = kindOf(key), record = api.definitions[kind]?.get(idOf(key));
  if (!record) throw new EditorError(`There is no ${key}.`);
  let updated = 0;
  for (const c of adapter.copiesOf(kind, record.id)) { await adapter.refreshCopy(c.item, kind, record); updated++; }
  return { updated, skippedTokens: adapter.unlinkedTokenCopies(kind, record.id) };
}

/** Another world item for an existing definition (the creator makes the first one; this makes more or replaces a deleted one). */
export async function makeItem(api, key) {
  requireGM("editor.makeItem");
  const kind = kindOf(key), record = api.definitions[kind]?.get(idOf(key));
  if (!record) throw new EditorError(`There is no ${key}.`);
  return adapter.createWorldItem(kind, record, { folder: await adapter.ensureItemFolder(kind === "material" ? "Materials" : "Notes") });
}

// Tracks (the Discovery tracks window folded in) -------------------------------------------------------------------------
const overlayNow = () => game.settings.get(MODULE_ID, DISCOVERY.overlaySetting) ?? {};

/** Set (or with null clear) one item's research track. Clearing also works for an ORPHANED overlay entry (its item is gone). */
export async function setTrack(api, key, track) {
  requireGM("setTrack");
  const kind = kindOf(key), exists = Boolean(api.definitions?.[kind]?.get(idOf(key)));
  if (track === null) {
    const overlay = overlayNow();
    if (key in overlay) { const next = { ...overlay }; delete next[key]; await game.settings.set(MODULE_ID, DISCOVERY.overlaySetting, next); }
    if (exists && current().records[key]?.fields?.research) await update(api, key, { research: undefined }, { confirmed: true });
    else if (!exists && !(key in overlay) && !current().records[key]) throw new EditorError(`There is no track for ${key}.`);
    return true;
  }
  if (!exists) throw new Error(`setTrack: unknown item "${key}"`);
  const problems = check(TRACK_SCHEMA, track);
  if (problems.length) throw new Error(`setTrack: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`);
  track.milestones.forEach((m, i) => {
    if (m.grants.type === "properties" && kind !== "material") throw new Error(`setTrack: milestone ${i + 1}: only a material has a properties milestone`);
    if (m.grants.type === "formula") {
      const recipeId = m.grants.recipeId ?? (kind === "note" ? api.definitions.note.get(idOf(key)).recipeId : kind === "recipe" ? idOf(key) : null);
      if (!recipeId || !api.definitions.recipe.get(recipeId)) throw new Error(`setTrack: milestone ${i + 1}: pick a formula that exists`);
    }
  });
  await update(api, key, { research: track }, { confirmed: true });
  // The editor's record is now the only source: an older overlay entry for the same item would otherwise still win.
  const overlay = overlayNow();
  if (key in overlay) { const next = { ...overlay }; delete next[key]; await game.settings.set(MODULE_ID, DISCOVERY.overlaySetting, next); }
  return true;
}

/** Fold the old tracks overlay into the editor's records (once; later calls find nothing). Overlay entries whose item is gone stay as leftovers. */
export async function foldOverlay(api) {
  requireGM("editor.foldOverlay");
  const overlay = overlayNow();
  const folded = [], left = {};
  let store = current();
  for (const [key, track] of Object.entries(overlay)) {
    if (!api.definitions[kindOf(key)]?.get(idOf(key))) { left[key] = track; continue; }
    const existing = store.records[key];
    const rec = existing ? clone(existing) : { kind: kindOf(key), id: idOf(key), mode: "patch", fields: {} };
    rec.fields.research = track;
    store = withRecord(store, rec);
    folded.push(key);
  }
  if (!folded.length) return { folded: [], leftovers: Object.keys(left) };
  await commitStore(api, store);
  await game.settings.set(MODULE_ID, DISCOVERY.overlaySetting, left);
  return { folded, leftovers: Object.keys(left) };
}

/** Saved edits that match nothing any more, and tracks whose item is gone: [{ key, message }]. */
export function leftovers(api) {
  const out = [...(api.editorLeftovers ?? [])];
  for (const key of Object.keys(overlayNow())) if (!api.definitions?.[kindOf(key)]?.get(idOf(key))) out.push({ key, message: "is a research track for an item that no longer exists" });
  return out;
}

/** Remove one leftover: the saved edit and/or the orphaned track. */
export async function clearLeftover(api, key) {
  requireGM("editor.clearLeftover");
  const overlay = overlayNow();
  if (key in overlay) { const next = { ...overlay }; delete next[key]; await game.settings.set(MODULE_ID, DISCOVERY.overlaySetting, next); }
  const store = current();
  if (store.records[key]) { const next = clone(store); delete next.records[key]; await commitStore(api, next); }
  return true;
}

// Export / import --------------------------------------------------------------------------------------------------------
/** The bundle (plain JSON) for the given keys, or every record the editor holds. */
export function exportRecords(api, keys = null) {
  requireGM("editor.exportRecords");
  return exportBundle(current(), keys);
}

/** Bring records from a bundle into this world. Clashes are skipped (or replaced with `replace`); a bundle that would break a definition imports nothing. */
export async function importRecords(api, bundle, { replace = false, makeItems = true } = {}) {
  requireGM("editor.importRecords");
  const defined = new Set();
  for (const kind of ["material", "note", "tag"]) for (const id of api.definitions[kind].keys()) if (!current().records[keyOf(kind, id)]) defined.add(keyOf(kind, id));
  const plan = planImport(bundle, current(), { definedIds: defined, replace });
  if (plan.problems.length) throw new EditorError(plan.problems.join(" "), { problems: plan.problems });
  const incoming = [...plan.add, ...plan.replace];
  if (!incoming.length) return { added: [], replaced: [], skipped: plan.skip };
  const next = clone(current());
  for (const rec of incoming) next.records[keyOf(rec.kind, rec.id)] = rec;
  await commitStore(api, next);
  if (makeItems) for (const rec of plan.add.filter(r => r.mode === "new" && r.kind !== "tag")) {
    const key = keyOf(rec.kind, rec.id);
    if (!adapter.copiesOf(rec.kind, rec.id).length) await makeItem(api, key);
  }
  await logWorldEvent(`editor: imported ${incoming.length} record${incoming.length === 1 ? "" : "s"}`);
  return { added: plan.add.map(r => keyOf(r.kind, r.id)), replaced: plan.replace.map(r => keyOf(r.kind, r.id)), skipped: plan.skip };
}

export { emptyStore, EDITOR_SETTING };
