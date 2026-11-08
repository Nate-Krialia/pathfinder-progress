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

// An item reference is often a uuid ("Compendium.pf2e.equipment-srd.Item.<id>"), which has dots in it. Foundry reads a dot in an object's key as a path when it saves data (a flag key may not
// contain one for that reason), so the ledger is SAVED with the dots written as %2E (and a % as %25) and READ back with them restored. Everything in memory uses the real reference.
const encodeKey = key => String(key).replaceAll("%", "%25").replaceAll(".", "%2E");
const decodeKey = key => String(key).replaceAll("%2E", ".").replaceAll("%25", "%");
const mapKeys = (ledger, fn) => ({ v: ledger?.v, items: Object.fromEntries(Object.entries(ledger?.items ?? {}).map(([key, entry]) => [fn(key), structuredClone(entry)])) });
/** The ledger as it is written to the world setting: no key has a dot in it. */
export const encodeLedger = ledger => mapKeys(ledger, encodeKey);
/** The ledger as it was read from the world setting, with the real references back. */
export const decodeLedger = ledger => mapKeys(ledger, decodeKey);

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

// A CRAFTED item is an ingredient by its own reference `crafted:<freezeId>` (Slice 3). What it carries comes from its frozen record (the ledger view exposes the records as `ledger.crafted`):
// its NATIVE tags (the GM's ledger entry for its recipe id, snapshotted when it was made), the tags it INHERITED (each with the tier it was contributed at), and its own tier.
export const CRAFTED_PREFIX = "crafted:";
export const isCraftedRef = ref => typeof ref === "string" && ref.startsWith(CRAFTED_PREFIX);
export const craftedId = ref => String(ref).slice(CRAFTED_PREFIX.length);
export const craftedRef = freezeId => `${CRAFTED_PREFIX}${freezeId}`;
const craftedRecord = (ref, ledger) => (isCraftedRef(ref) ? ledger?.crafted?.[craftedId(ref)] ?? null : null);

/** A view of the ledger that also knows some extra crafted records (a queued craft's escrow holds the crafted ingredients it took out of the bag). */
export function overlayLedger(ledger, records = {}) {
  const view = { v: ledger?.v, items: ledger?.items ?? {} };
  Object.defineProperty(view, "crafted", { value: { ...(ledger?.crafted ?? {}), ...records }, enumerable: false });
  return view;
}

/**
 * Every tag an item carries WITH the tier it counts at: [{ tag, tier }]. A material's single `tag` first (the migration on read), then the ledger's, at the item's own tier. A crafted
 * item: its native tags at its own tier, then the tags it inherited at the tier they were contributed at. A tag appears once (the higher tier wins).
 */
export function tagTiers(ref, registry, ledger) {
  const out = [];
  const add = (tag, tier) => {
    if (!tag) return;
    const had = out.find(t => t.tag === tag);
    if (!had) out.push({ tag, tier }); else if ((tier ?? 0) > (had.tier ?? 0)) had.tier = tier;
  };
  const rec = craftedRecord(ref, ledger);
  if (rec) {
    for (const tag of rec.native ?? []) add(tag, rec.tier);
    for (const t of rec.inherited ?? []) add(t.tag, t.tier);
    return out;
  }
  const own = effectiveTier(ref, registry, ledger);
  add(registry?.material?.get(ref)?.tag, own);
  for (const id of ledger?.items?.[ref]?.tags ?? []) add(id, own);
  return out;
}

/** The tags an item carries: its material's single `tag` first (the migration on read), then the ledger's, without repeats. A crafted item: native, then inherited. */
export const effectiveTags = (ref, registry, ledger) => tagTiers(ref, registry, ledger).map(t => t.tag);

/** The tier an item counts as: the ledger's (the GM's word), else the material's own, else null. A crafted item: the tier it was given when it was made. */
export function effectiveTier(ref, registry, ledger) {
  const rec = craftedRecord(ref, ledger);
  if (rec) return Number.isInteger(rec.tier) ? rec.tier : null;
  const own = ledger?.items?.[ref]?.tier;
  return Number.isInteger(own) ? own : (registry?.material?.get(ref)?.tier ?? null);
}

/** What to call an item: the material's name, else the ledger's, else (a crafted item) the name it was made under. */
export const itemName = (ref, registry, ledger) => craftedRecord(ref, ledger)?.name ?? registry?.material?.get(ref)?.name ?? ledger?.items?.[ref]?.name ?? ref;

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
  if (!registry?.material?.has(ref) && !ledger?.items?.[ref] && !craftedRecord(ref, ledger)) return { ok: false, reason: isCraftedRef(ref) ? `${name} has no record of what it was made of, so it cannot fill a tagged slot` : `${name} has not been tagged by the GM, so it cannot fill a tagged slot` };
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
  const rec = craftedRecord(ref, ledger);
  if (rec) return { kind: "material", id: ref, name: rec.name ?? ref, tier: rec.tier, effects: {}, standIn: true };
  const e = ledger?.items?.[ref];
  return e ? { kind: "material", id: ref, name: e.name ?? ref, tier: e.tier, effects: {}, standIn: true } : null;
}
