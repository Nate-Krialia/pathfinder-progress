/**
 * The tag ledger, Foundry side (Slice 1, GM only). The ledger is a world setting (`tagLedger`) read ONLY by the GM client into memory here; a player client never reads it and
 * never receives it (docs/22). Every write is checked first (ledger.js entryProblems), written, the adapter's idea of "tagged items" refreshed and the players told the
 * definitions changed (so the slot lists they were sent are worked out again).
 */
import { MODULE_ID, TAGS } from "../config.js";
import * as adapter from "../adapter/pf2e.js";
import { logWorldEvent } from "../audit/store.js";
import { emptyLedger, entryProblems, ledgerProblems } from "./ledger.js";
import { getLedger, setCurrentLedger } from "./current.js";

export { getLedger };
/** Tests and the loader put a ledger in memory directly (and tell the adapter which items are tagged). */
export function setLedger(ledger) {
  setCurrentLedger(ledger);
  adapter.setTaggedRefProvider(() => new Set(Object.keys(getLedger().items)));
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
