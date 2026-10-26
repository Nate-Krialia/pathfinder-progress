/**
 * Planning a craft: match materials to slots, resolve effects, pick the output.
 * Pure (no Foundry globals), so it is unit-tested in plain Node.
 *
 * Rules (docs/03-crafting.md): any material meeting a slot's tier floor can
 * fill it; ONE material type per slot; effects come from the shared resolver
 * (recipe override > material default).
 */
import { CRAFTING } from "../config.js";
import { baseRoleFor, parseTier, slotRoles } from "../data/roles.js";
import { resolveMaterialEffect } from "../data/resolver.js";
import { isUuid } from "../data/outputRefs.js";
import { feeForTier } from "../stations/fees.js";

const emptyDescription = () => ({
  baseTier: null,
  damageBonuses: [],
  abilities: [],
  resistances: [],
  fields: [],
  spellSlots: 0
});

/**
 * @param {object} args
 * @param {object} args.recipe     a validated recipe definition
 * @param {object} args.registry   the loaded definitions registry
 * @param {Object<string,string>} args.selection  slot name -> material id
 * @param {Array<{stackId: string, materialId: string, quantity: number}>} args.stacks  the crafter's material stacks
 * @param {object} [args.station]  the chosen normalised station; sets the fee. Without one, plan.fee is null.
 * @param {Object<string,string>} [args.outputs]  the recipe's output refs resolved to UUIDs, by tier key
 *        (from the loader). A ref that is already a UUID needs no entry.
 * @param {object} [args.config]
 * @returns {{ ok: true, plan: object } | { ok: false, errors: string[] }}
 */
export function planCraft({ recipe, registry, selection, stacks, outputs, station, config = CRAFTING }) {
  const errors = [];
  const remaining = new Map(stacks.map(s => [s.stackId, s.quantity]));
  const customRoles = [...registry.customRole.values()];
  const baseRole = baseRoleFor(recipe);
  const uses = [];
  const description = emptyDescription();

  for (const unknown of Object.keys(selection ?? {})) {
    if (!recipe.slots.some(s => s.name === unknown)) errors.push(`"${unknown}" is not a slot of this recipe`);
  }

  for (const slot of recipe.slots) {
    const materialId = selection?.[slot.name];
    if (!materialId) { errors.push(`slot "${slot.name}": no material selected`); continue; }

    const material = registry.material.get(materialId);
    if (!material) { errors.push(`slot "${slot.name}": unknown material "${materialId}"`); continue; }
    if (material.tier < slot.tierFloor) {
      errors.push(`slot "${slot.name}": ${material.name} is tier ${material.tier} but the slot needs tier ${slot.tierFloor} or higher`);
      continue;
    }

    const roles = slotRoles(slot);
    const resolved = {};
    let usable = true;
    for (const role of roles) {
      const effect = resolveMaterialEffect(material, role, recipe, slot.name);
      if (!effect) {
        errors.push(`slot "${slot.name}": ${material.name} has no effect for role "${role}"`);
        usable = false;
      } else {
        resolved[role] = effect.value;
      }
    }
    if (!usable) continue;

    // Take units from this material's stacks, in order.
    const from = [];
    let need = slot.qty;
    for (const stack of stacks.filter(s => s.materialId === materialId)) {
      if (need === 0) break;
      const take = Math.min(need, remaining.get(stack.stackId));
      if (take > 0) {
        from.push({ stackId: stack.stackId, units: take });
        remaining.set(stack.stackId, remaining.get(stack.stackId) - take);
        need -= take;
      }
    }
    if (need > 0) {
      errors.push(`slot "${slot.name}": needs ${slot.qty} ${material.name} but only ${slot.qty - need} available`);
      continue;
    }

    uses.push({
      slot: slot.name,
      materialId,
      materialName: material.name,
      units: slot.qty,
      from,
      slotLossChance: slot.lossChance,
      materialLossChance: material.lossChance
    });

    const source = { slot: slot.name, materialId };
    for (const [role, value] of Object.entries(resolved)) {
      if (role === baseRole) description.baseTier = parseTier(value);
      else if (role === "bonusDamage") description.damageBonuses.push({ ...value, label: material.name, source });
      else if (role === "specialAbility") description.abilities.push({ on: "hit", ...value, source });
      else if (role === "resistance") description.resistances.push({ ...value, source });
      else if (role === "spellSlots") description.spellSlots += value;
      else {
        const custom = customRoles.find(r => r.id === role);
        if (custom) description.fields.push({ path: custom.modifies, value, source });
      }
    }
  }

  // Pick the output item.
  const outputKey = baseRole ? (description.baseTier === null ? null : String(description.baseTier)) : "default";
  let outputRef = null;
  let outputUuid = null;
  if (outputKey !== null) {
    outputRef = recipe.output[outputKey];
    if (!outputRef) {
      errors.push(`recipe has no output item for tier ${description.baseTier}`);
    } else {
      outputUuid = outputs?.[outputKey] ?? (isUuid(outputRef) ? outputRef.trim() : null);
      if (!outputUuid) errors.push(`output "${outputRef}" has not been resolved to a PF2e item (reload the module definitions and check the console)`);
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      recipeId: recipe.id,
      recipeName: recipe.name,
      resultName: recipe.resultName ?? null,
      craftLevel: recipe.craftLevel,
      baseTier: description.baseTier,
      outputRef,
      outputUuid,
      uses,
      description,
      station: station ? { id: station.id, name: station.name, category: station.category, tier: station.tier } : null,
      fee: station ? feeForTier(station.tier) : null,
      provenance: {
        recipeId: recipe.id,
        stationId: station?.id ?? null,
        materials: uses.map(u => ({ slot: u.slot, materialId: u.materialId, units: u.units }))
      }
    }
  };
}
