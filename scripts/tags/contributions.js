/**
 * What the ingredients of a craft contribute in its TAGGED slots (Slice 2a). Pure; no Foundry globals.
 *
 * A tagged slot (one with `needs`) takes, from each ingredient: the ingredient's OWN effects (a material's, as before) AND the effects of every tag it carries, the tag's at
 * the CONTRIBUTING ITEM's tier (its ledger tier, else the material's own). Only the roles the slot drives count, as for a material. An ingredient's quantity is a cost, not a
 * multiplier: it contributes once. A slot without `needs` never reads a tag effect (old recipes are unchanged). `stackedCraft` is the ONE function the craft plan and the
 * effects engine share, so what a weapon is made with and what a use card applies come from the same place.
 */
import { slotRoles } from "../data/roles.js";
import { compileSet } from "../editor/blocks.js";
import { hasNeeds, itemName, tagTiers } from "./ledger.js";
import { STACKING_ROLES, stackContributions } from "./stack.js";

/** The roles a slot takes in a TAGGED slot and stacks (the recipe's power role included). */
export const stackingRolesFor = baseRole => (baseRole ? [baseRole, ...STACKING_ROLES] : STACKING_ROLES);

/** What kind of part a slot is (Slice 2b): its `kind`, else its own name. */
export const slotKind = slot => slot.kind ?? slot.name;

/**
 * What ONE tag does for an item of class `cls` in a slot of kind `kind`, at `tier`, as role values. The layers, most specific first, one winner PER ROLE:
 *   1. the recipe's own override for this tag in this slot kind        (recipe.tagOverrides)
 *   2. the tag's set for this slot kind AND this item class             (bySlot[kind].byClass[cls])
 *   3. the tag's set for this slot kind                                 (bySlot[kind].general)
 *   4. the tag's set for this item class                                (byClass[cls])
 *   5. the tag's general set                                            (general)
 */
export function tagRoles({ tag, recipe, kind, tier }) {
  const cls = recipe.category, e = tag.effectBlocks ?? {};
  const override = (recipe.tagOverrides ?? []).find(o => o.tag === tag.id && o.slot === kind);
  const layers = [
    override ? { set: override, cls } : null,
    e.bySlot?.[kind]?.byClass?.[cls] ? { set: e.bySlot[kind].byClass[cls], cls } : null,
    e.bySlot?.[kind]?.general ? { set: e.bySlot[kind].general } : null,
    e.byClass?.[cls] ? { set: e.byClass[cls], cls } : null,
    e.general ? { set: e.general } : null
  ].filter(Boolean);
  const roles = {};
  for (const layer of [...layers].reverse()) Object.assign(roles, compileSet(layer.set, tier, layer.cls));     // least specific first, so the most specific overwrites
  return roles;
}

/** The tag effects one ingredient brings to one slot: [{ role, value, from }]. Empty when the slot has no `needs`. */
export function tagContributions({ recipe, slot, ref, registry, ledger }) {
  if (!hasNeeds(slot)) return [];
  const driven = new Set(slotRoles(slot));
  const kind = slotKind(slot);
  const out = [];
  // each tag counts at the tier IT came with: the item's own tier, or (a crafted item's inherited tag) the tier it was contributed at
  for (const { tag: tagId, tier } of tagTiers(ref, registry, ledger)) {
    if (!Number.isInteger(tier)) continue;
    const tag = registry.tag?.get(tagId);
    if (!tag?.effectBlocks && !(recipe.tagOverrides ?? []).some(o => o.tag === tagId)) continue;
    for (const [role, value] of Object.entries(tagRoles({ tag: tag ?? { id: tagId }, recipe, kind, tier }))) {
      if (driven.has(role)) out.push({ role, value, from: { name: itemName(ref, registry, ledger), slot: slot.name, tagId, tagName: tag?.name ?? tagId, tier, priority: tag?.priority ?? 0 } });
    }
  }
  return out;
}

/**
 * Everything the TAGGED slots of a craft contribute, stacked and capped.
 * @param {{ recipe, uses: Array<{ slot: string, ref: string }>, registry, ledger, caps, baseRole?: string, resolveEffects: (recipe, slot, material) => { resolved: object } }} args
 * @returns {{ roles: object, notes: string[], taggedSlots: Set<string> }}
 */
export function stackedCraft({ recipe, uses, registry, ledger, caps, baseRole, resolveEffects }) {
  const taggedSlots = new Set(recipe.slots.filter(hasNeeds).map(s => s.name));
  const wanted = new Set(stackingRolesFor(baseRole));
  const contributions = [];
  for (const slot of recipe.slots) {
    if (!taggedSlots.has(slot.name)) continue;
    for (const use of uses.filter(u => u.slot === slot.name)) {
      const material = registry.material?.get(use.ref);
      if (material) for (const [role, value] of Object.entries(resolveEffects(recipe, slot, material).resolved)) if (wanted.has(role)) contributions.push({ role, value, from: { name: material.name, slot: slot.name, tier: ledger?.items?.[use.ref]?.tier ?? material.tier, priority: 0 } });
      contributions.push(...tagContributions({ recipe, slot, ref: use.ref, registry, ledger }));
    }
  }
  return { ...stackContributions(contributions, caps, { baseRole }), contributions, taggedSlots };
}
