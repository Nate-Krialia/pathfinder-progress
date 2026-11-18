/**
 * The tag ledger, Foundry side (Slice 1, GM only). The ledger is a world setting (`tagLedger`) read ONLY by the GM client into memory here; a player client never reads it and
 * never receives it (docs/22). Every write is checked first (ledger.js entryProblems), written, the adapter's idea of "tagged items" refreshed and the players told the
 * definitions changed (so the slot lists they were sent are worked out again).
 */
import { MODULE_ID, TAGS } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { logWorldEvent } from "../audit/store.js";
import { craftedId, decodeLedger, effectiveTags, effectiveTier, emptyLedger, encodeLedger, entryProblems, isCraftedRef, ledgerProblems, slotFit } from "./ledger.js";
import { getCaps, getCapsTable, getFrozenStore, getLimits, getLedger, setCurrentCaps, setCurrentFrozen, setCurrentLedger } from "./current.js";
import { emptyFrozen, frozenProblems, recordFromPlan } from "./frozen.js";
import { capsProblems } from "./stack.js";
import { withLock } from "../queue/lock.js";
import { BACKUP_LOCK, reportDamaged } from "../backup.js";
import { afterSave } from "../after-save.js";
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

/**
 * A damaged ledger or caps table is loaded as empty (the rest of the module still loads), and the next save would replace it for good. So before that can happen the raw value is kept
 * ONCE in the `tagBackup` world setting (scripts/backup.js), and the GM is told once per damaged load, in plain words.
 */
export { BACKUP_LOCK };
const BACKUP_WHAT = { ledger: "tag ledger", caps: "tag caps table", frozen: "frozen craft store" };
function reportDamagedTag(kind, problems, raw) {
  const loadedAs = kind === "caps" ? "the defaults" : "empty";
  return reportDamaged({
    kind, what: BACKUP_WHAT[kind], raw, problems,
    consoleText: `the saved ${BACKUP_WHAT[kind]} is damaged, so it was loaded as ${loadedAs}:`,
    note: `The saved ${BACKUP_WHAT[kind]} is damaged and was loaded as ${loadedAs}. A copy of the damaged data is kept once in the "${TAGS.backupSetting}" world setting; the next save replaces the damaged one.`
  });
}

/** GM, at ready: read the saved ledger. A damaged one is kept once as a backup (see above), reported, and treated as empty (the rest of the module still loads). */
export function loadLedger() {
  if (!game.user?.isGM) { setLedger(emptyLedger()); return { problems: [] }; }
  const raw = game.settings.get(MODULE_ID, TAGS.ledgerSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) { setLedger(emptyLedger()); return { problems: [] }; }
  const problems = ledgerProblems(raw);
  setLedger(problems.length ? emptyLedger() : decodeLedger(raw));
  return problems.length ? { problems, backedUp: reportDamagedTag("ledger", problems, raw) } : { problems };
}

/** GM, at ready: read the GM's cap table (a damaged one is kept once as a backup, reported and ignored: the defaults apply). */
export function loadCaps() {
  if (!game.user?.isGM) { setCurrentCaps(null); return { problems: [] }; }
  const raw = game.settings.get(MODULE_ID, TAGS.capsSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) { setCurrentCaps(null); return { problems: [] }; }
  const problems = capsProblems(raw);
  setCurrentCaps(problems.length ? null : structuredClone(raw));
  return problems.length ? { problems, backedUp: reportDamagedTag("caps", problems, raw) } : { problems };
}

/**
 * GM: replace the cap table: { v: 1, roles: { <role>: { <cap>: n } } }. Anything left out keeps its default. Players never see it.
 * The write and the in-memory table change together under the "tagCaps" lock (a leaf lock), so overlapping saves land in the order they were asked for.
 */
export async function setCaps(table) {
  requireGM("tags.setCaps");
  const clean = { v: 1, roles: structuredClone(table?.roles ?? {}), ...(table?.limits && Object.keys(table.limits).length ? { limits: structuredClone(table.limits) } : {}) };
  const problems = capsProblems(clean);
  if (problems.length) throw new TagError(problems.join(" "), { problems });
  await withLock(CAPS_LOCK, async () => {
    await game.settings.set(MODULE_ID, TAGS.capsSetting, clean);
    setCurrentCaps(clean);
  });
  await afterSave("the caps change", [["writing the audit log line", () => logWorldEvent("tags: changed the caps")]]);
  return { table: structuredClone(clean), effective: getCaps(), limits: getLimits() };
}
export const capsNow = () => { requireGM("tags.caps"); return { table: structuredClone(getCapsTable()), effective: getCaps(), limits: getLimits() }; };

/**
 * The ledger is changed read-clone-write: the whole of that runs under the "tagLedger" lock (a leaf lock: nothing inside asks for another), on a copy of the ledger as it is INSIDE the lock,
 * so two overlapping changes (two quick saves, a macro tagging items in a loop) both land instead of the second erasing the first. `change(draft)` edits the copy (and may throw TagError).
 * The definitions are published and the change logged AFTER the lock is let go.
 */
export const LEDGER_LOCK = "tagLedger";
export const CAPS_LOCK = "tagCaps";
async function changeLedger(api, what, change) {
  const result = await withLock(LEDGER_LOCK, async () => {
    const draft = structuredClone(getLedger());
    const out = change(draft);
    await game.settings.set(MODULE_ID, TAGS.ledgerSetting, encodeLedger(draft));     // a separate, dot-free copy: whatever Foundry does to what it is given, `draft` stays as written
    setLedger(draft);
    return out;
  });
  await afterSave("the tag change", [["publishing the definitions to the players", () => api.publishDefinitions?.()], ["writing the audit log line", () => logWorldEvent(what)]]);
  return result;
}

/** GM: tag an item. `ref` is a material id or an item UUID; `entry` is { tags: [tagId], tier?, name? }. Refuses (in plain words) what entryProblems finds. */
export async function setEntry(api, ref, entry) {
  requireGM("tags.setEntry");
  const clean = { tags: [...(entry?.tags ?? [])], ...(entry?.tier !== undefined && entry?.tier !== null ? { tier: entry.tier } : {}), ...(String(entry?.name ?? "").trim() ? { name: String(entry.name).trim() } : {}) };
  const problems = entryProblems(ref, clean, api.definitions);
  if (problems.length) throw new TagError(problems.join(" "), { problems });
  await changeLedger(api, `tags: tagged ${ref}`, draft => { draft.items[ref] = clean; });
  return structuredClone(clean);
}

/**
 * GM, a console helper for the real-Foundry gates: how one item (a Document or a uuid string) is seen by the tag system. Reads only; a player client is refused.
 *   candidates   what `itemRefCandidates` returns for it (the references it could be tagged under, most trusted first)
 *   matched      the first candidate that is a key in the ledger or a frozen record, else null
 *   tags / tier  what the ledger says about `matched` (the existing effective-tags and effective-tier code); [] and null when nothing matched
 *   fitsBySlot   every recipe slot that would accept it, as { "<recipeId>/<slotName>": "<recipeId>" }; {} when nothing matched
 */
export async function refsOf(api, itemOrUuid) {
  requireGM("tags.refsOf");
  const item = typeof itemOrUuid === "string" ? await globalThis.fromUuid?.(itemOrUuid) : itemOrUuid;
  if (!item || typeof item !== "object") throw new TagError(`I could not find an item for "${String(itemOrUuid)}".`);
  const ledger = getLedger();
  const candidates = adapter.itemRefCandidates(item);
  const known = ref => Boolean(ledger.items[ref]) || (isCraftedRef(ref) && Boolean(getFrozenStore().items[craftedId(ref)]));
  const matched = candidates.find(known) ?? null;
  const fitsBySlot = {};
  if (matched) for (const recipe of api.definitions?.recipe?.values() ?? []) for (const slot of recipe.slots) if (slotFit(slot, matched, api.definitions, ledger).ok) fitsBySlot[`${recipe.id}/${slot.name}`] = recipe.id;
  return { candidates: [...candidates], matched, tags: matched ? effectiveTags(matched, api.definitions, ledger) : [], tier: matched ? effectiveTier(matched, api.definitions, ledger) : null, fitsBySlot };
}

/** GM: take an item out of the ledger. */
export async function removeEntry(api, ref) {
  requireGM("tags.removeEntry");
  await changeLedger(api, `tags: untagged ${ref}`, draft => {
    if (!draft.items[ref]) throw new TagError("That item is not tagged.");
    delete draft.items[ref];
  });
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
  const change = fresh => ({ slots: fresh.slots.map(s => { if (s.name !== slotName) return s; const { kind: _old, ...rest } = s; return clean ? { ...rest, kind: clean } : rest; }) });
  try { await api.editor.updateWith(`recipe:${recipeId}`, change, { confirmed: true }); } catch (error) { throw new TagError(error.message, error.details); }
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
  // the list is worked out from the recipe AS IT IS inside the editor's lock, so two overlapping changes to one recipe both land
  const change = fresh => {
    const others = (fresh.tagOverrides ?? []).filter(o => !(o.tag === tagId && o.slot === slotKind));
    const next = set ? [...others, { tag: tagId, slot: slotKind, ...(set.power !== undefined ? { power: set.power } : {}), blocks: structuredClone(set.blocks ?? []) }] : others;
    return { tagOverrides: next.length ? next : undefined };
  };
  try { await api.editor.updateWith(`recipe:${recipeId}`, change, { confirmed: true }); } catch (error) { throw new TagError(error.message, error.details); }
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
  const change = fresh => ({
    slots: fresh.slots.map(s => {
      if (s.name !== slotName) return s;
      const { needs: _old, ...rest } = s;
      return clean ? { ...rest, needs: clean } : rest;
    })
  });
  try { await api.editor.updateWith(`recipe:${recipeId}`, change, { confirmed: true }); }
  catch (error) { throw new TagError(error.message, error.details); }
  return api.definitions.recipe.get(recipeId).slots.find(s => s.name === slotName);
}


// Frozen craft results (Slice 2b) ------------------------------------------------------------------------------------------------
/**
 * GM, at ready: read the GM-only record of what crafted items were made of. A damaged one is kept ONCE as a backup (scripts/backup.js, key "frozen"), the GM is told once per damaged load,
 * and it is treated as empty (the module keeps working: crafted items whose record is missing fall back quietly, as for any missing record). The next freeze replaces the damaged setting,
 * which is why the raw copy is taken first.
 */
export function loadFrozen() {
  if (!game.user?.isGM) { setCurrentFrozen(emptyFrozen()); return { problems: [] }; }
  const raw = game.settings.get(MODULE_ID, TAGS.frozenSetting);
  if (raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw).length === 0)) { setCurrentFrozen(emptyFrozen()); return { problems: [] }; }
  const problems = frozenProblems(raw);
  setCurrentFrozen(problems.length ? emptyFrozen() : structuredClone(raw));
  return problems.length ? { problems, backedUp: reportDamagedTag("frozen", problems, raw) } : { problems };
}

/**
 * Every change to the frozen store is read-clone-write, so two overlapping changes (two crafts resolving at once, a hook removing a record while a craft adds one) would each clone the SAME
 * store and the second write would erase the first. They all go through this one keyed lock, and each decision (does the record exist, is it held) is made on the store as it is INSIDE
 * the lock. "tagCrafted" is a LEAF lock: nothing in here asks for another lock, and none of the functions below calls another locked function while holding it (they share the unlocked
 * `change` helper). The queue's per-actor (and node) locks are taken first, then this one; see scripts/queue/lock.js.
 */
export const FROZEN_LOCK = "tagCrafted";
async function writeFrozen(next) {
  await game.settings.set(MODULE_ID, TAGS.frozenSetting, next);
  setCurrentFrozen(next);
}
/** Run `change(draft)` on a copy of the store inside the lock; it returns { write: false, result } to leave the store alone, else its `result` is returned after the write. */
const changeFrozen = change => withLock(FROZEN_LOCK, async () => {
  const draft = structuredClone(getFrozenStore());
  const out = change(draft);
  if (out?.write === false) return out.result;
  await writeFrozen(draft);
  return out?.result;
});
const skip = result => ({ write: false, result });

/**
 * GM client, when a craft with tagged slots resolves: store its frozen result and return { id, undo }. The id goes on the crafted item (its `crafted` flag). Returns null for a craft
 * with no tagged slot (nothing to freeze: those items keep working out their effects as before).
 */
export async function freezeCraft(plan) {
  const record = recordFromPlan(plan);
  if (!record) return null;
  const id = foundry.utils.randomID();
  await changeFrozen(draft => { draft.items[id] = record; });
  return { id, undo: () => removeFrozen(id) };
}

/** GM: put a frozen result back (a crafted ingredient came back out of escrow; the hook had removed its record when the item left the bag). */
export async function restoreFrozen(id, record) {
  if (!game.user?.isGM || !id || !record) return false;
  return changeFrozen(draft => {
    if (draft.items[id]) return skip(false);
    draft.items[id] = structuredClone(record);
    return { result: true };
  });
}

/** GM: mark a frozen result as held while its item waits in a queued craft's escrow, so the item leaving the bag (or a prune) does not drop it. The record stays in the GM-only store: it is never copied into the queued action (an actor flag). */
export async function holdFrozen(id) {
  if (!game.user?.isGM || !id) return null;
  const was = await changeFrozen(draft => {
    if (!draft.items[id]) return skip(null);
    const held = !!draft.items[id].held;
    if (held) return skip(true);
    draft.items[id].held = true;
    return { result: false };
  });
  if (was === null) return null;
  return { undo: () => (was ? null : setHeld(id, false)) };
}
/** GM: the held item came back to a bag (or the hold was undone). */
export const releaseFrozen = id => (game.user?.isGM && id ? changeFrozen(draft => (draft.items[id]?.held ? (delete draft.items[id].held, { result: true }) : skip(false))) : false);
const setHeld = (id, held) => changeFrozen(draft => {
  if (!draft.items[id]) return skip(false);
  if (held) draft.items[id].held = true; else delete draft.items[id].held;
  return { result: true };
});

/** GM: forget a frozen result (the item is gone, or the craft was rolled back). Quiet when it is not there. */
export async function removeFrozen(id) {
  if (!game.user?.isGM) return false;
  return changeFrozen(draft => {
    if (!draft.items[id]) return skip(false);
    delete draft.items[id];
    return { result: true };
  });
}

/** Every crafted item the world can see (actors' items and world items) that carries this freeze id. */
export function itemsWithFreezeId(id) {
  const all = [...(game.actors ?? [])].flatMap(a => [...(a.items ?? [])]).concat([...(game.items ?? [])]);
  return all.filter(i => i.getFlag?.(MODULE_ID, "crafted")?.freezeId === id);
}

/** GM safety net: drop every frozen result that no item in the world carries any more. Unlinked token actors are not searched, so this is run by hand (api.tags.pruneFrozen()), never on its own. */
export async function pruneFrozen() {
  requireGM("tags.pruneFrozen");
  return changeFrozen(draft => {
    const gone = Object.keys(draft.items).filter(id => !draft.items[id].held && itemsWithFreezeId(id).length === 0);
    if (!gone.length) return skip({ removed: [] });
    for (const id of gone) delete draft.items[id];
    return { result: { removed: gone } };
  });
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
  // A change made by ANOTHER GM client (or the writer's own echo, which reads back what was just written, so it is harmless) is read into memory here; without this a second GM would
  // carry on with the ledger / caps / frozen store it read at ready and its next save would overwrite the other GM's change. Only a GM client ever reads these, and nothing is sent to anyone.
  // The first ever write of a setting arrives as `createSetting`, the rest as `updateSetting`.
  const reloads = { [`${MODULE_ID}.${TAGS.frozenSetting}`]: loadFrozen, [`${MODULE_ID}.${TAGS.ledgerSetting}`]: loadLedger, [`${MODULE_ID}.${TAGS.capsSetting}`]: loadCaps };
  const reload = setting => { if (game.user?.isGM) reloads[setting?.key]?.(); };
  hooks.on("updateSetting", reload);
  hooks.on("createSetting", reload);
}
