/**
 * The ONE layered resolver: the most specific rule wins.
 * Used for material effects (recipe override > material default) and, later,
 * corpse yields (creature override > trait/level mapping).
 * No Foundry globals (testable in Node).
 */

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
 * A recipe override for this material+slot beats the material's own default.
 */
export function resolveMaterialEffect(material, role, recipe, slotName) {
  const override = recipe?.overrides?.find(o => o.materialId === material.id && o.slot === slotName);
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
