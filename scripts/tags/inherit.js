/**
 * Tag inheritance (Slice 3b). A recipe slot that says `passCap` hands the tags of what fills it up to the item the craft makes, so that item can carry them into a later craft.
 * Pure. Only TAGS pass, never a stacked effect. Each tag keeps the tier of the ingredient that brought it (a crafted ingredient's own tags keep THEIR original tiers).
 * Per filled slot: at most `passCap` tags, chosen highest tier first, then the higher tag priority, then alphabetical. The same tag from two slots is kept once, at the higher tier.
 */
import { TAGS } from "../config.js";
import { tagTiers } from "./ledger.js";

/** How many tags this slot passes up: 0 when it does not opt in. */
export function slotPassCap(slot) {
  const v = slot?.passCap;
  if (v === true) return TAGS.passCap;
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/** @returns {{ tag: string, tier: number|null }[]} what the craft's item inherits, best first */
export function inheritedTags({ recipe, uses, registry, ledger }) {
  const name = id => String(registry?.tag?.get(id)?.name ?? id);
  const order = (a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (registry?.tag?.get(b.tag)?.priority ?? 0) - (registry?.tag?.get(a.tag)?.priority ?? 0) || name(a.tag).localeCompare(name(b.tag));
  const out = [];
  for (const use of uses) {
    const cap = slotPassCap(recipe.slots.find(s => s.name === use.slot));
    if (!cap) continue;
    const offered = tagTiers(use.materialId, registry, ledger).filter(t => registry?.tag?.has(t.tag)).sort(order).slice(0, cap);
    for (const t of offered) {
      const had = out.find(o => o.tag === t.tag);
      if (!had) out.push({ tag: t.tag, tier: t.tier }); else if ((t.tier ?? 0) > (had.tier ?? 0)) had.tier = t.tier;
    }
  }
  return out.sort(order);
}
