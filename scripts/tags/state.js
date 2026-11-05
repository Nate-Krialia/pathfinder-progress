/**
 * The tag ledger, Foundry side (Slice 1, GM only). The ledger is a world setting (`tagLedger`) read ONLY by the GM client into memory here; a player client never reads it and
 * never receives it (docs/22). Every write is checked first (ledger.js entryProblems), written, the adapter's idea of "tagged items" refreshed and the players told the
 * definitions changed (so the slot lists they were sent are worked out again).
 */
import { MODULE_ID, TAGS } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { logWorldEvent } from "../audit/store.js";
import { emptyLedger, entryProblems, ledgerProblems } from "./ledger.js";
import { getCaps, getCapsTable, getFrozenStore, getLimits, getLedger, setCurrentCaps, setCurrentFrozen, setCurrentLedger } from "./current.js";
import { emptyFrozen, frozenProblems, recordFromPlan } from "./frozen.js";
import { capsProblems } from "./stack.js";
import { craftedRef } from "./ledger.js";

export { getLedger, getCaps, getFrozenStore };
/** Tests and the loader put a ledger in memory directly (and tell the adapter which items are tagged). */
export function setLedger(ledger) {
  setCurrentLedger(ledger);
  adapter.setTaggedRefProvider(() => new Set([...Object.keys(getLedger().items), ...Object.keys(getFrozenStore().items).map(craftedRef)]));   // tagged items, and crafted items that have a frozen record
}

export class TagError extends Error {
  constructor(message, details = {}) { super(message); this.name = "TagError"; this.details = details; }
}
const requireGM = what => { if (!game.user?.isGM) throw new Error(`${what}: GM only`); };

/** GM, at ready: read the saved ledger. A damaged one is reported and treated as empty (the rest of the module still loads). */
export function loadLedger() {
  if (!game.user?.isGM) { setLedger(emptyLedger()); return { problems: [] }; }
  const raw = game.settings.get(MODULE_ID, TAGS.ledgerSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) { setLedger(emptyLedger()); return { problems: [] }; }
  const problems = ledgerProblems(raw);
  setLedger(problems.length ? emptyLedger() : structuredClone(raw));
  return { problems };
}

/** GM, at ready: read the GM's cap table (a damaged one is reported and ignored: the defaults apply). */
export function loadCaps() {
  if (!game.user?.isGM) { setCurrentCaps(null); return { problems: [] }; }
  const raw = game.settings.get(MODULE_ID, TAGS.capsSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) { setCurrentCaps(null); return { problems: [] }; }
  const problems = capsProblems(raw);
  setCurrentCaps(problems.length ? null : structuredClone(raw));
  return { problems };
}

/** GM: replace the cap table: { v: 1, roles: { <role>: { <cap>: n } } }. Anything left out keeps its default. Players never see it. */
export async function setCaps(table) {
  requireGM("tags.setCaps");
  const clean = { v: 1, roles: structuredClone(table?.roles ?? {}), ...(table?.limits && Object.keys(table.limits).length ? { limits: structuredClone(table.limits) } : {}) };
  const problems = capsProblems(clean);
  if (problems.length) throw new TagError(problems.join(" "), { problems });
  await game.settings.set(MODULE_ID, TAGS.capsSetting, clean);
  setCurrentCaps(clean);
  await logWorldEvent("tags: changed the caps");
  return { table: structuredClone(clean), effective: getCaps(), limits: getLimits() };
}
export const capsNow = () => { requireGM("tags.caps"); return { table: structuredClone(getCapsTable()), effective: getCaps(), limits: getLimits() }; };

async function commit(api, next, what) {
  await game.settings.set(MODULE_ID, TAGS.ledgerSetting, next);
  setLedger(next);
  await api.publishDefinitions?.();
  await logWorldEvent(what);
}

/** GM: tag an item. `ref` is a material id or an item UUID; `entry` is { tags: [tagId], tier?, name? }. Refuses (in plain words) what entryProblems finds. */
export async function setEntry(api, ref, entry) {
  requireGM("tags.setEntry");
  const clean = { tags: [...(entry?.tags ?? [])], ...(entry?.tier !== undefined && entry?.tier !== null ? { tier: entry.tier } : {}), ...(String(entry?.name ?? "").trim() ? { name: String(entry.name).trim() } : {}) };
  const problems = entryProblems(ref, clean, api.definitions);
  if (problems.length) throw new TagError(problems.join(" "), { problems });
  const next = structuredClone(getLedger());
  next.items[ref] = clean;
  await commit(api, next, `tags: tagged ${ref}`);
  return structuredClone(clean);
}

/** GM: take an item out of the ledger. */
export async function removeEntry(api, ref) {
  requireGM("tags.removeEntry");
  if (!getLedger().items[ref]) throw new TagError("That item is not tagged.");
  const next = structuredClone(getLedger());
  delete next.items[ref];
  await commit(api, next, `tags: untagged ${ref}`);
  return true;
}

/** GM: give a slot a kind (a shared key such as "blade" or "decoration"), or take it away (null: the kind is the slot's own name). An editor patch of the recipe. */
export async function setSlotKind(api, recipeId, slotName, kind) {
  requireGM("tags.setSlotKind");
  const recipe = api.definitions?.recipe?.get(recipeId);
  if (!recipe) throw new TagError(`There is no recipe "${recipeId}".`);
  if (!recipe.slots.some(s => s.name === slotName)) throw new TagError(`${recipe.name} has no slot "${slotName}".`);
  const clean = kind === null || kind === undefined || String(kind).trim() === "" ? null : String(kind).trim();
  if (clean !== null && !/^[a-z0-9][a-z0-9_-]*$/.test(clean)) throw new TagError("A kind is lowercase letters, numbers, - or _ (for example blade or decoration).");
  const slots = recipe.slots.map(s => { if (s.name !== slotName) return s; const { kind: _old, ...rest } = s; return clean ? { ...rest, kind: clean } : rest; });
  try { await api.editor.update(`recipe:${recipeId}`, { slots }, { confirmed: true }); } catch (error) { throw new TagError(error.message, error.details); }
  return api.definitions.recipe.get(recipeId).slots.find(s => s.name === slotName);
}

/**
 * GM: this recipe's own word on what a TAG does in one slot KIND (beats the tag's own sets there). `set` = { power?, blocks: [...] } (the effect builder's blocks), or null to remove it.
 * An editor patch of the recipe's `tagOverrides`: validated on load (the tag and the kind must exist, every tier must make a valid value) and revertable.
 */
export async function setTagOverride(api, recipeId, tagId, slotKind, set) {
  requireGM("tags.setTagOverride");
  const recipe = api.definitions?.recipe?.get(recipeId);
  if (!recipe) throw new TagError(`There is no recipe "${recipeId}".`);
  const others = (recipe.tagOverrides ?? []).filter(o => !(o.tag === tagId && o.slot === slotKind));
  const next = set ? [...others, { tag: tagId, slot: slotKind, ...(set.power !== undefined ? { power: set.power } : {}), blocks: structuredClone(set.blocks ?? []) }] : others;
  try { await api.editor.update(`recipe:${recipeId}`, { tagOverrides: next.length ? next : undefined }, { confirmed: true }); } catch (error) { throw new TagError(error.message, error.details); }
  return structuredClone(api.definitions.recipe.get(recipeId).tagOverrides ?? []);
}

/**
 * GM: set what a recipe slot needs. `needs` = { all: [tagId], optional?: bool } or null to take the requirement away (the slot goes back to the old tier rule).
 * It is an editor patch over the recipe's `slots`, so it goes through the same validation as a pack page and can be taken back with editor.revert.
 */
export async function setSlotNeeds(api, recipeId, slotName, needs) {
  requireGM("tags.setSlotNeeds");
  const recipe = api.definitions?.recipe?.get(recipeId);
  if (!recipe) throw new TagError(`There is no recipe "${recipeId}".`);
  if (!recipe.slots.some(s => s.name === slotName)) throw new TagError(`${recipe.name} has no slot "${slotName}".`);
  const clean = needs ? { all: [...new Set(needs.all ?? [])], ...(needs.optional ? { optional: true } : {}) } : null;
  if (clean && clean.all.length === 0) throw new TagError("Pick at least one tag for the slot to need (or take the requirement away).");
  for (const t of clean?.all ?? []) if (!api.definitions.tag?.has(t)) throw new TagError(`"${t}" is not a tag yet: create it first.`);
  const slots = recipe.slots.map(s => {
    if (s.name !== slotName) return s;
    const { needs: _old, ...rest } = s;
    return clean ? { ...rest, needs: clean } : rest;
  });
  try { await api.editor.update(`recipe:${recipeId}`, { slots }, { confirmed: true }); }
  catch (error) { throw new TagError(error.message, error.details); }
  return api.definitions.recipe.get(recipeId).slots.find(s => s.name === slotName);
}


// Frozen craft results (Slice 2b) ------------------------------------------------------------------------------------------------
/** GM, at ready: read the GM-only record of what crafted items were made of. A damaged one is reported and treated as empty. */
export function loadFrozen() {
  if (!game.user?.isGM) { setCurrentFrozen(emptyFrozen()); return { problems: [] }; }
  const raw = game.settings.get(MODULE_ID, TAGS.frozenSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) { setCurrentFrozen(emptyFrozen()); return { problems: [] }; }
  const problems = frozenProblems(raw);
  setCurrentFrozen(problems.length ? emptyFrozen() : structuredClone(raw));
  return { problems };
}

async function writeFrozen(next) {
  await game.settings.set(MODULE_ID, TAGS.frozenSetting, next);
  setCurrentFrozen(next);
}

/**
 * GM client, when a craft with tagged slots resolves: store its frozen result and return { id, undo }. The id goes on the crafted item (its `crafted` flag). Returns null for a craft
 * with no tagged slot (nothing to freeze: those items keep working out their effects as before).
 */
export async function freezeCraft(plan) {
  const record = recordFromPlan(plan);
  if (!record) return null;
  const id = foundry.utils.randomID();
  const next = structuredClone(getFrozenStore());
  next.items[id] = record;
  await writeFrozen(next);
  return { id, undo: () => removeFrozen(id) };
}

/** GM: put a frozen result back (a crafted ingredient came back out of escrow; the hook had removed its record when the item left the bag). */
export async function restoreFrozen(id, record) {
  if (!game.user?.isGM || !id || !record || getFrozenStore().items[id]) return false;
  const next = structuredClone(getFrozenStore());
  next.items[id] = structuredClone(record);
  await writeFrozen(next);
  return true;
}

/** GM: mark a frozen result as held while its item waits in a queued craft's escrow, so the item leaving the bag (or a prune) does not drop it. The record stays in the GM-only store: it is never copied into the queued action (an actor flag). */
export async function holdFrozen(id) {
  if (!game.user?.isGM || !id || !getFrozenStore().items[id]) return null;
  const was = !!getFrozenStore().items[id].held;
  if (!was) await setHeld(id, true);
  return { undo: () => (was ? null : setHeld(id, false)) };
}
/** GM: the held item came back to a bag (or the hold was undone). */
export const releaseFrozen = id => (game.user?.isGM && id && getFrozenStore().items[id]?.held ? setHeld(id, false) : false);
async function setHeld(id, held) {
  if (!getFrozenStore().items[id]) return false;
  const next = structuredClone(getFrozenStore());
  if (held) next.items[id].held = true; else delete next.items[id].held;
  await writeFrozen(next);
  return true;
}

/** GM: forget a frozen result (the item is gone, or the craft was rolled back). Quiet when it is not there. */
export async function removeFrozen(id) {
  if (!game.user?.isGM) return false;
  if (!getFrozenStore().items[id]) return false;
  const next = structuredClone(getFrozenStore());
  delete next.items[id];
  await writeFrozen(next);
  return true;
}

/** Every crafted item the world can see (actors' items and world items) that carries this freeze id. */
export function itemsWithFreezeId(id) {
  const all = [...(game.actors ?? [])].flatMap(a => [...(a.items ?? [])]).concat([...(game.items ?? [])]);
  return all.filter(i => i.getFlag?.(MODULE_ID, "crafted")?.freezeId === id);
}

/** GM safety net: drop every frozen result that no item in the world carries any more. Unlinked token actors are not searched, so this is run by hand (api.tags.pruneFrozen()), never on its own. */
export async function pruneFrozen() {
  requireGM("tags.pruneFrozen");
  const gone = Object.keys(getFrozenStore().items).filter(id => !getFrozenStore().items[id].held && itemsWithFreezeId(id).length === 0);
  if (!gone.length) return { removed: [] };
  const next = structuredClone(getFrozenStore());
  for (const id of gone) delete next.items[id];
  await writeFrozen(next);
  return { removed: gone };
}

/** GM, read one frozen result (for the GM and for tests). */
export function frozenResult(id) {
  requireGM("tags.frozen");
  return structuredClone(getFrozenStore().items[id] ?? null);
}

/**
 * The hooks that keep the frozen store honest. Only the ACTIVE GM client acts (so two GMs do not both write): a deleted crafted item takes its frozen result with it unless another
 * copy of the item still carries the same id; and a change to the setting by another GM client is read in.
 */
export function installFrozenHooks(hooks = globalThis.Hooks) {
  const activeGM = () => game.user?.isGM && game.users?.activeGM?.id === game.user.id;
  hooks.on("deleteItem", item => {
    if (!activeGM()) return;
    const id = item?.getFlag?.(MODULE_ID, "crafted")?.freezeId;
    if (!id || getFrozenStore().items[id]?.held || itemsWithFreezeId(id).some(other => other !== item && other.id !== item.id)) return;
    return removeFrozen(id).catch(error => console.error(`${MODULE_ID} | could not remove a frozen craft result`, error));
  });
  hooks.on("updateSetting", setting => { if (game.user?.isGM && setting?.key === `${MODULE_ID}.${TAGS.frozenSetting}`) loadFrozen(); });
}
