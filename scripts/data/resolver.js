/**
 * The ONE layered resolver: the most specific rule wins.
 * Used for material effects (recipe override > material default) and, later,
 * corpse yields (creature override > trait/level mapping).
 * No Foundry globals (testable in Node).
 */

import { slotRoles } from "./roles.js";

/**
 * @param {Array<{source: string, value: any}>} layers  most specific first
 * @returns {{value: any, source: string} | null}  the first layer with a value
 */
export function resolveLayers(layers) {
  for (const layer of layers) {
    if (layer.value !== undefined && layer.value !== null) {
      return { value: layer.value, source: layer.source };
    }
  }
  return null;
}

/**
 * Effect of `material` for `role` when placed in `slotName` of `recipe`.
 * A recipe override for this material+slot+role beats the material's own
 * default. An override's `role` may be omitted when its slot drives one role.
 */
export function resolveMaterialEffect(material, role, recipe, slotName) {
  const slot = recipe?.slots?.find(s => s.name === slotName);
  const roles = slot ? slotRoles(slot) : [];
  const soleRole = roles.length === 1 ? roles[0] : null;
  const override = recipe?.overrides?.find(o =>
    o.materialId === material.id && o.slot === slotName && (o.role ?? soleRole) === role);
  return resolveLayers([
    { source: "recipe override", value: override?.effect },
    { source: "material default", value: material.effects?.[role] }
  ]);
}

/** Yield for a creature: a per-creature override beats the trait/level mapping. */
export function resolveCorpseYield(creatureOverride, mappedYield) {
  return resolveLayers([
    { source: "creature override", value: creatureOverride?.yield },
    { source: "trait/level mapping", value: mappedYield }
  ]);
}
