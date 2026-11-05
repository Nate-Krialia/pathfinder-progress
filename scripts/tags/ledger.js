/**
 * The tag ledger (Slice 1 of the tag system, docs/22-tags-slice1.md). Pure; no Foundry globals.
 *
 * GM-only world data: { v: 1, items: { "<itemRef>": { tags: [tagId], tier?: 1..5, name?: string } } }.
 *   itemRef = a material id for a material, a recipe id for a crafted item (later slices), or an item UUID for any other PF2e item.
 * An item can carry several tags. A PF2e item with no material record has no tier of its own, so its entry MUST carry one (and a name to show); a material's entry may leave
 * the tier out (it then uses the material's own). A material's single `tag` keeps working: it is read as the first of the material's tags (migration ON READ; nothing stored changes).
 * Nothing here is ever sent to a player (docs/22; the leak scan in tests/tags-leak.test.js).
 */
import { TAGS, TIER_RANGES } from "../config.js";

export const emptyLedger = () => ({ v: TAGS.ledgerVersion, items: {} });

const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** What a stored ledger must look like; a damaged setting is an error to show, never silently replaced. */
export function ledgerProblems(ledger) {
  if (!isPlainObject(ledger) || ledger.v !== TAGS.ledgerVersion || !isPlainObject(ledger.items)) return ["the saved tag ledger has an unknown shape"];
  const problems = [];
  for (const [ref, entry] of Object.entries(ledger.items)) {
    if (!isPlainObject(entry) || !Array.isArray(entry.tags)) problems.push(`the ledger entry for "${ref}" is damaged`);
  }
  return problems;
}

/** Is `ref` a material in the registry? */
export const isMaterialRef = (registry, ref) => Boolean(registry?.material?.has(ref));

/**
 * Check one entry as the GM saves it. Returns plain sentences (empty = fine).
 * @param {string} ref
 * @param {{ tags?: string[], tier?: number, name?: string }} entry
 * @param {object} registry  the loaded definitions (material, tag)
 */
export function entryProblems(ref, entry, registry) {
  const problems = [];
  if (!String(ref ?? "").trim()) return ["Say which item this is."];
  if (!isPlainObject(entry)) return ["The entry is missing."];
  const material = isMaterialRef(registry, ref);
  const tags = entry.tags;
  if (!Array.isArray(tags) || tags.length === 0) problems.push("Give it at least one tag.");
  else {
    const seen = new Set();
    for (const tag of tags) {
      if (typeof tag !== "string" || !registry?.tag?.has(tag)) problems.push(`"${tag}" is not a tag yet: create it first.`);
      else if (seen.has(tag)) problems.push(`"${registry.tag.get(tag).name}" is listed twice.`);
      seen.add(tag);
    }
  }
  const { min, max } = TIER_RANGES.material;
  if (entry.tier === undefined || entry.tier === null) {
    if (!material) problems.push("An item without a material record has no tier of its own: give it one (the tag effects will scale by it).");
  } else if (!Number.isInteger(entry.tier) || entry.tier < min || entry.tier > max) problems.push(`The tier must be a whole number from ${min} to ${max}.`);
  if (!material && !String(entry.name ?? "").trim()) problems.push("Give the item a name to show (it is not a material, so it has none on file).");
  return problems;
}

/** The tags an item carries: its material's single `tag` first (the migration on read), then the ledger's, without repeats. */
export function effectiveTags(ref, registry, ledger) {
  const out = [];
  const add = id => { if (id && !out.includes(id)) out.push(id); };
  add(registry?.material?.get(ref)?.tag);
  for (const id of ledger?.items?.[ref]?.tags ?? []) add(id);
  return out;
}

/** The tier an item counts as: the ledger's (the GM's word), else the material's own, else null. */
export function effectiveTier(ref, registry, ledger) {
  const own = ledger?.items?.[ref]?.tier;
  return Number.isInteger(own) ? own : (registry?.material?.get(ref)?.tier ?? null);
}

/** What to call an item: the material's name, else the ledger's. */
export const itemName = (ref, registry, ledger) => registry?.material?.get(ref)?.name ?? ledger?.items?.[ref]?.name ?? ref;

/** A slot that matches by tags. On a player's copy the tags are gone: it carries `fits` (the GM's list of what fits) instead. */
export const hasNeeds = slot => Boolean(slot?.needs?.all?.length) || Array.isArray(slot?.fits);
/** A slot that may stay empty (only a tagged slot can be optional). */
export const isOptionalSlot = slot => hasNeeds(slot) && Boolean(slot.needs ? slot.needs.optional : slot.optional);

/**
 * Does the item fit the slot? A slot without `needs` is as before: any known material at or above the floor (an item that is only in the ledger is NOT a material and never
 * fits it). A slot with `needs`: the item carries every needed tag and its tier is at or above the floor.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function slotFit(slot, ref, registry, ledger) {
  const tier = effectiveTier(ref, registry, ledger);
  if (!hasNeeds(slot)) {
    const material = registry?.material?.get(ref);
    if (!material) return { ok: false, reason: `unknown material "${ref}"` };
    return material.tier >= slot.tierFloor ? { ok: true } : { ok: false, reason: `${material.name} is tier ${material.tier} but the slot needs tier ${slot.tierFloor} or higher` };
  }
  const name = itemName(ref, registry, ledger);
  if (!registry?.material?.has(ref) && !ledger?.items?.[ref]) return { ok: false, reason: `${name} has not been tagged by the GM, so it cannot fill a tagged slot` };
  if (tier === null) return { ok: false, reason: `${name} has no tier` };
  const have = new Set(effectiveTags(ref, registry, ledger));
  const missing = slot.needs.all.filter(t => !have.has(t));
  if (missing.length) return { ok: false, reason: `${name} is missing ${missing.map(t => registry?.tag?.get(t)?.name ?? t).join(", ")}` };
  if (tier < slot.tierFloor) return { ok: false, reason: `${name} is tier ${tier} but the slot needs tier ${slot.tierFloor} or higher` };
  return { ok: true };
}

/** The item refs (materials and ledger items) that fit a slot, among `refs`. */
export const fittingRefs = (slot, refs, registry, ledger) => refs.filter(ref => slotFit(slot, ref, registry, ledger).ok);

/**
 * Stand-in material record for an item that is only in the ledger, so the rest of the craft code (names, tiers, stacks) can treat it like a material. It has NO effects: tag
 * effects arrive in a later slice, so such an item fills a slot but adds nothing to the item yet.
 */
export function standInMaterial(ref, ledger) {
  const e = ledger?.items?.[ref];
  return e ? { kind: "material", id: ref, name: e.name ?? ref, tier: e.tier, effects: {}, standIn: true } : null;
}
