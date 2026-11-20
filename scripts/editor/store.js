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
import { emptyStore, identityFieldsIn, keyOf, repairStore } from "./layer.js";
import { backUpOnce } from "../backup.js";
import { afterSave } from "../after-save.js";
import { withLock } from "../queue/lock.js";
import { EDITOR_SETTING, readEditorStore, writeEditorStore } from "./setting.js";
import { changeOverlay, readOverlay } from "../discovery/overlay.js";

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
/**
 * The saved store for a WRITE (create, edit, remove, import, fold, clear): it THROWS while the saved definitions are damaged, naming the damaged records. A damaged store used to load as
 * empty and the next write replaced it, taking every definition the editor had made. (The raw copy is kept once in the backup setting; api.editor.repair() drops only the damaged records.)
 */
function current() {
  const { store, problems, raw } = readEditorStore();
  if (problems.length) {
    backUpOnce("editor", raw, "editor definitions");        // once only; the loader has usually done it already
    throw new EditorError(`The editor's saved definitions are damaged (${problems.join("; ")}), so nothing can be saved until they are repaired. api.editor.repair() drops only the damaged records; a copy of the damaged data is kept in the "tagBackup" setting.`, { problems, damaged: true });
  }
  return store;
}
/** The saved store for READING and showing (the window's lists): a damaged one reads as empty here, but no write can go ahead (see current). */
const viewStore = () => readEditorStore().store;

/** Swap the in-memory registry for a freshly built one, the way `reload` does (the refresh hook, the station errors), without re-reading the packs. */
function install(api, built) {
  api.definitions = playerDefs.attachRefresh(built.registry);
  api.contexts = built.contexts;
  api.errors = [...built.errors, ...stations.readStations(api).errors];
  api.editorLeftovers = built.leftovers;
}

/** What the packs plus the saved edits build, and the definitions that exist only in memory (a test fixture, a gate's fakes): the editor leaves those alone. */
const memoryOnlyOf = (api, registry) => {
  const memoryOnly = [];
  for (const [kind, map] of Object.entries(api.definitions ?? {})) if (map instanceof Map) for (const [id, rec] of map) if (!registry[kind]?.has(id)) memoryOnly.push([kind, id, rec]);
  return memoryOnly;
};
function baseline(api) {
  const built = buildRegistry(base(api), current());
  return { built, memoryOnly: memoryOnlyOf(api, built.registry) };
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
  return built;
}

/** After a change is saved and installed: tell the players the definitions changed and write the log line. A failure of either is a warning, never a failed save (see after-save.js). */
const saved = (api, logText) => afterSave("the editor change", [["publishing the definitions to the players", () => api.publishDefinitions?.()], ...(logText ? [["writing the audit log line", () => logWorldEvent(logText)]] : [])]);

/** Does this definition come from the packs or the editor (so an edit can be saved), as opposed to existing only in memory? */
export const canEdit = (api, key) => isSaved(api, key);
const isSaved = (api, key) => Boolean(buildRegistry(base(api), viewStore()).registry[kindOf(key)]?.has(idOf(key)));

const clone = x => structuredClone(x);
const withRecord = (store, rec) => { const next = clone(store); next.records[keyOf(rec.kind, rec.id)] = rec; return next; };

// Repair ----------------------------------------------------------------------------------------------------------------
/** What is wrong with the saved definitions right now (plain sentences; empty = fine). Reads only. */
export const damaged = () => readEditorStore().problems;

/**
 * GM: put a damaged store right by dropping ONLY its damaged records (the sound ones stay and load again). The raw damaged value is kept once in the backup setting first. A store whose
 * outer shape is unknown has nothing to salvage record by record: that is refused unless `{ reset: true }` is passed (it then starts empty; the raw copy stays in the backup).
 */
async function repairIn(api, { reset = false } = {}) {
  requireGM("editor.repair");
  const { problems, raw } = readEditorStore();                     // read again inside the lock: the raw copy was already kept, before the lock, by repair() below
  if (!problems.length) return { repaired: false, dropped: [] };
  const fixed = repairStore(raw);
  if (!fixed.usable && !reset) throw new EditorError("The editor's saved definitions have an unknown shape, so there is nothing to salvage record by record. A copy is kept in the \"tagBackup\" setting. api.editor.repair({ reset: true }) starts the editor's definitions empty.", { problems, damaged: true });
  const memoryOnly = memoryOnlyOf(api, buildRegistry(base(api), emptyStore()).registry);       // the registry was loaded with the damaged store read as empty
  await writeEditorStore(fixed.store);
  const built = buildRegistry(base(api), fixed.store);
  for (const [kind, id, rec] of memoryOnly) if (!built.registry[kind].has(id)) built.registry[kind].set(id, rec);
  install(api, built);
  await saved(api, `editor: repaired the saved definitions (dropped ${fixed.dropped.length})`);
  return { repaired: true, dropped: fixed.dropped };
}

// Reading -----------------------------------------------------------------------------------------------------------
/** Where a definition comes from: "world" (made in the editor), "pack" (untouched) or "pack, edited here". */
export function originOf(key, store = viewStore()) {
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
  const tagged = kind === "tag" ? [...defs.material.values()].filter(m => m.tag === id).map(m => m.name) : [];
  const used = { copies: [...byActor].map(([where, count]) => ({ where, count })), recipes, nodes, yields, notes, tagged };
  return { ...used, knownBy: kind === "material" ? knownBy(api, id) : [], inUse: used.copies.length + recipes.length + nodes.length + yields.length + tagged.length > 0 };
}

/** The effective definition and the editor's view of it: { key, kind, id, record, origin, retired, edited fields }. */
export function entry(api, key) {
  const record = api.definitions?.[kindOf(key)]?.get(idOf(key));
  if (!record) return null;
  const rec = viewStore().records[key];
  return { key, kind: kindOf(key), id: idOf(key), record: clone(record), origin: originOf(key), editedFields: rec?.mode === "patch" ? Object.keys(rec.fields) : [], retired: Boolean(record.retired) };
}

/** The editor's saved records (for the list's "made here" / "edited here" tags). */
export const records = () => clone(viewStore().records);

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
  if (kind === "tag") return { ...fields };                       // a tag is a name, a theme and what it works with: nothing item-like
  return { bulk: "L", preset: "research", ...fields };
}

/**
 * Create a definition AND its linked world item. `fields` for a material: { name, tier?, value?, bulk?, img?, description?, tag?, label?, research?, effectBlocks?, id? };
 * for a note: { name, recipeId, preset?: "plan" | "research", ... }. Returns { key, record, item }.
 */
async function createIn(api, kind, fields, { makeItem = true } = {}) {
  requireGM("editor.create");
  if (!["material", "note", "tag"].includes(kind)) throw new EditorError(`the editor makes materials, notes and tags (not "${kind}")`);
  if (!String(fields?.name ?? "").trim()) throw new EditorError("Give it a name first.");
  const store = current();
  // `id` is the id the caller WANTS (made unique and stored as the record's id, never as a field); a field called `kind` would try to change what the record is.
  if (Object.hasOwn(fields ?? {}, "kind")) throw new EditorError('"kind" names the record and cannot be a field; the kind is the first argument.');
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
  await saved(api, `editor: created ${kind} "${record.name}"`);
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
async function updateIn(api, key, fields, { confirmed = false } = {}) {
  requireGM("editor.update");
  const identity = identityFieldsIn(fields);
  if (identity.length) throw new EditorError(`"${identity.join('" and "')}" name the record and cannot be edited as a field.`);
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
  await saved(api, `editor: edited ${key}`);
  return entry(api, key);
}

/** Take back an edit of a pack definition (every field, or one). */
async function revertIn(api, key, field) {
  requireGM("editor.revert");
  const rec = current().records[key];
  if (!rec || rec.mode !== "patch") throw new EditorError("That item has no edits to take back.");
  return updateIn(api, key, field ? { [field]: undefined } : Object.fromEntries(Object.keys(rec.fields).map(f => [f, undefined])), { confirmed: true });
}

const retireIn = (api, key, retired = true) => updateIn(api, key, { retired: retired ? true : undefined }, { confirmed: true });

/** Delete an editor-made definition that nothing uses. A pack's definition can only be retired. */
async function removeIn(api, key) {
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
  await saved(api, `editor: deleted ${key}`);
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
const overlayNow = readOverlay;
/** Take ONE key out of the overlay (under the overlay lock). Returns whether it was there. */
const dropFromOverlay = async key => (await changeOverlay(overlay => { if (!(key in overlay)) return undefined; delete overlay[key]; return overlay; })).changed;

/** Set (or with null clear) one item's research track. Clearing also works for an ORPHANED overlay entry (its item is gone). */
async function setTrackIn(api, key, track) {
  requireGM("setTrack");
  const kind = kindOf(key), exists = Boolean(api.definitions?.[kind]?.get(idOf(key)));
  if (track === null) {
    const hadOverlay = await dropFromOverlay(key);
    if (exists && current().records[key]?.fields?.research) await updateIn(api, key, { research: undefined }, { confirmed: true });
    else if (!exists && !hadOverlay && !current().records[key]) throw new EditorError(`There is no track for ${key}.`);
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
  await updateIn(api, key, { research: track }, { confirmed: true });
  // The editor's record is now the only source: an older overlay entry for the same item would otherwise still win.
  await dropFromOverlay(key);
  return true;
}

/** Fold the old tracks overlay into the editor's records (once; later calls find nothing). Overlay entries whose item is gone stay as leftovers. */
async function foldOverlayIn(api) {
  requireGM("editor.foldOverlay");
  const folded = [];
  let leftovers = [];
  // The whole fold runs under the overlay lock: it reads the overlay, saves the records, and writes back what was left, so a track set meanwhile cannot be dropped by a write made from the old read.
  await changeOverlay(async overlay => {
    const left = {};
    let store = current();
    for (const [key, track] of Object.entries(overlay)) {
      if (!api.definitions[kindOf(key)]?.get(idOf(key))) { left[key] = track; continue; }
      const existing = store.records[key];
      const rec = existing ? clone(existing) : { kind: kindOf(key), id: idOf(key), mode: "patch", fields: {} };
      rec.fields.research = track;
      store = withRecord(store, rec);
      folded.push(key);
    }
    leftovers = Object.keys(left);
    if (!folded.length) return undefined;
    await commitStore(api, store);
    return left;
  });
  if (!folded.length) return { folded: [], leftovers };
  await saved(api);
  return { folded, leftovers };
}

/** Saved edits that match nothing any more, and tracks whose item is gone: [{ key, message }]. */
export function leftovers(api) {
  const out = [...(api.editorLeftovers ?? [])];
  for (const key of Object.keys(overlayNow())) if (!api.definitions?.[kindOf(key)]?.get(idOf(key))) out.push({ key, message: "is a research track for an item that no longer exists" });
  return out;
}

/** Remove one leftover: the saved edit and/or the orphaned track. */
async function clearLeftoverIn(api, key) {
  requireGM("editor.clearLeftover");
  await dropFromOverlay(key);
  const store = current();
  if (store.records[key]) { const next = clone(store); delete next.records[key]; await commitStore(api, next); await saved(api); }
  return true;
}

// Export / import --------------------------------------------------------------------------------------------------------
/** The bundle (plain JSON) for the given keys, or every record the editor holds. */
export function exportRecords(api, keys = null) {
  requireGM("editor.exportRecords");
  return exportBundle(viewStore(), keys);
}

/** Bring records from a bundle into this world. Clashes are skipped (or replaced with `replace`); a bundle that would break a definition imports nothing. */
async function importRecordsIn(api, bundle, { replace = false, makeItems = true } = {}) {
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
  await saved(api, `editor: imported ${incoming.length} record${incoming.length === 1 ? "" : "s"}`);
  return { added: plan.add.map(r => keyOf(r.kind, r.id)), replaced: plan.replace.map(r => keyOf(r.kind, r.id)), skipped: plan.skip };
}

// The public entry points, LOCKED --------------------------------------------------------------------------------------------------
/**
 * Every change to the saved definitions is read-clone-write (and then the registry is rebuilt and installed). Two overlapping changes would each start from the SAME store and the second write
 * would erase the first (two quick creates; two slot saves on one recipe), and two creates could pick the same free id. So each change takes this one keyed lock and decides on the store
 * as it is INSIDE the lock (the `...In` functions above read it fresh). "editorStore" holds ONE nested lock: "discoveryTracks" (the research-track overlay, a leaf; editorStore, then discoveryTracks, never the other way round). Otherwise nothing inside asks for another lock (the work is the store, the registry rebuild,
 * the world item, the audit line and the definitions revision), and the `...In` functions never take it, so one editor change calling another cannot wait on itself.
 * Where it sits among the others: the tag and queue code take their own locks (actor, node, tagLedger, tagCaps, tagCrafted, tagBackup) and never hold one while asking for this.
 */
export const EDITOR_LOCK = "editorStore";
const locked = async (what, fn) => { requireGM(what); return withLock(EDITOR_LOCK, fn); };
export const create = (api, kind, fields, options) => locked("editor.create", () => createIn(api, kind, fields, options));
export const update = (api, key, fields, options) => locked("editor.update", () => updateIn(api, key, fields, options));
/** Like `update`, but `build(record)` makes the fields from the definition AS IT IS inside the lock (a caller that works a whole list out first, such as a recipe's slots, would otherwise use a stale one). */
export const updateWith = (api, key, build, options) => locked("editor.update", () => {
  const record = api.definitions?.[kindOf(key)]?.get(idOf(key));
  if (!record) throw new EditorError(`There is no ${key} to edit.`);
  return updateIn(api, key, build(clone(record)), options);
});
export const revert = (api, key, field) => locked("editor.revert", () => revertIn(api, key, field));
export const retire = (api, key, retired) => locked("editor.retire", () => retireIn(api, key, retired));
export const remove = (api, key) => locked("editor.remove", () => removeIn(api, key));
export const setTrack = (api, key, track) => locked("setTrack", () => setTrackIn(api, key, track));
export const foldOverlay = api => locked("editor.foldOverlay", () => foldOverlayIn(api));
export const clearLeftover = (api, key) => locked("editor.clearLeftover", () => clearLeftoverIn(api, key));
export const importRecords = (api, bundle, options) => locked("editor.importRecords", () => importRecordsIn(api, bundle, options));
export async function repair(api, options) {
  requireGM("editor.repair");
  // The raw copy is kept BEFORE the editor lock is taken: the backup lock is a leaf and is never nested inside another one (the copy is once-only, so taking it first loses nothing).
  const first = readEditorStore();
  if (first.problems.length) await backUpOnce("editor", first.raw, "editor definitions");
  return locked("editor.repair", () => repairIn(api, options));
}

export { emptyStore, EDITOR_SETTING };
