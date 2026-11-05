/**
 * What the ingredients of a craft contribute in its TAGGED slots (Slice 2a). Pure; no Foundry globals.
 *
 * A tagged slot (one with `needs`) takes, from each ingredient: the ingredient's OWN effects (a material's, as before) AND the effects of every tag it carries, the tag's at
 * the CONTRIBUTING ITEM's tier (its ledger tier, else the material's own). Only the roles the slot drives count, as for a material. An ingredient's quantity is a cost, not a
 * multiplier: it contributes once. A slot without `needs` never reads a tag effect (old recipes are unchanged). `stackedCraft` is the ONE function the craft plan and the
 * effects engine share, so what a weapon is made with and what a use card applies come from the same place.
 */
import { slotRoles } from "../data/roles.js";
import { classRoles } from "../editor/blocks.js";
import { effectiveTags, effectiveTier, hasNeeds, itemName } from "./ledger.js";
import { STACKING_ROLES, stackContributions } from "./stack.js";

/** The roles a slot takes in a TAGGED slot and stacks (the recipe's power role included). */
export const stackingRolesFor = baseRole => (baseRole ? [baseRole, ...STACKING_ROLES] : STACKING_ROLES);

/** The tag effects one ingredient brings to one slot: [{ role, value, from }]. Empty when the slot has no `needs`. */
export function tagContributions({ recipe, slot, ref, registry, ledger }) {
  if (!hasNeeds(slot)) return [];
  const tier = effectiveTier(ref, registry, ledger);
  if (!Number.isInteger(tier)) return [];
  const driven = new Set(slotRoles(slot));
  const out = [];
  for (const tagId of effectiveTags(ref, registry, ledger)) {
    const tag = registry.tag?.get(tagId);
    if (!tag?.effectBlocks) continue;
    for (const [role, value] of Object.entries(classRoles(tag.effectBlocks, recipe.category, tier))) {
      if (driven.has(role)) out.push({ role, value, from: { name: itemName(ref, registry, ledger), slot: slot.name, tagId, tier } });
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
      if (material) for (const [role, value] of Object.entries(resolveEffects(recipe, slot, material).resolved)) if (wanted.has(role)) contributions.push({ role, value, from: { name: material.name, slot: slot.name } });
      contributions.push(...tagContributions({ recipe, slot, ref: use.ref, registry, ledger }));
    }
  }
  return { ...stackContributions(contributions, caps, { baseRole }), taggedSlots };
}
