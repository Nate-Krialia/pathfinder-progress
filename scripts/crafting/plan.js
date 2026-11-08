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
import { feeForStation } from "../stations/fees.js";
import { plainLines } from "../effects/plain.js";
import { effectiveTags, effectiveTier, hasNeeds, isCraftedRef, craftedId, isOptionalSlot, itemName, slotFit, standInMaterial } from "../tags/ledger.js";
import { embedRecord } from "../tags/frozen.js";
import { inheritedTags, slotPassCap } from "../tags/inherit.js";
import { getCaps, getLedger, getLimits } from "../tags/current.js";
import { stackedCraft, stackingRolesFor } from "../tags/contributions.js";

const emptyDescription = () => ({
  baseTier: null,
  damageBonuses: [],
  abilities: [],
  resistances: [],
  conditions: [],       // plain-words lines only (v0.22.0): the condition, its value and its save are GM-only and are resolved again when the item is used
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
/**
 * The effect each driven role gets from `material` in `slot` of `recipe`: the ONE place effects are resolved
 * (recipe override > material default, via the shared resolver). Used by planCraft and by the Experiments recorder.
 * @returns {{ resolved: Object<string, any>, missing: string[] }}  role -> value, and the roles with no effect
 */
export function resolveSlotEffects(recipe, slot, material) {
  const resolved = {};
  const missing = [];
  for (const role of slotRoles(slot)) {
    const effect = resolveMaterialEffect(material, role, recipe, slot.name);
    if (!effect) missing.push(role); else resolved[role] = effect.value;
  }
  return { resolved, missing };
}

export function planCraft({ recipe, registry, selection, stacks, outputs, station, config = CRAFTING, mechanical = false, ledger = getLedger(), caps = getCaps(), limits = getLimits() }) {
  const errors = [];
  const remaining = new Map(stacks.map(s => [s.stackId, s.quantity]));
  const customRoles = mechanical ? [] : [...registry.customRole.values()];
  const baseRole = baseRoleFor(recipe);
  const uses = [];
  const description = emptyDescription();

  for (const unknown of Object.keys(selection ?? {})) {
    if (!recipe.slots.some(s => s.name === unknown)) errors.push(`"${unknown}" is not a slot of this recipe`);
  }

  for (const slot of recipe.slots) {
    const materialId = selection?.[slot.name];
    // A tagged slot (Slice 1) marked optional may stay empty; every other slot must be filled, as before.
    if (!materialId) { if (isOptionalSlot(slot)) continue; errors.push(`slot "${slot.name}": no material selected`); continue; }

    const tagged = hasNeeds(slot);
    let material = registry.material.get(materialId);
    // An item that only the tag ledger knows (an ordinary PF2e item the GM tagged) stands in as a material with no effects. A player's preview gets the name from the slot's `fits`.
    if (!material && tagged) material = mechanical ? (() => { const f = (slot.fits ?? []).find(x => x.id === materialId); return f ? { id: materialId, name: f.name, effects: {}, standIn: true } : null; })() : standInMaterial(materialId, ledger);
    if (!material) { errors.push(`slot "${slot.name}": ${tagged ? `${materialId} cannot fill this slot (the GM has not tagged it)` : `unknown material "${materialId}"`}`); continue; }
    if (tagged) {
      // The GM checks tags and tier. A player's preview only has the GM's list of what fits (never the tags themselves).
      const fit = mechanical ? ((slot.fits ?? []).some(x => x.id === materialId) ? { ok: true } : { ok: false, reason: `${material.name} does not fit this slot` }) : slotFit(slot, materialId, registry, ledger);
      if (!fit.ok) { errors.push(`slot "${slot.name}": ${fit.reason}`); continue; }
    } else if (material.tier < slot.tierFloor) {
      errors.push(`slot "${slot.name}": ${material.name} is tier ${material.tier} but the slot needs tier ${slot.tierFloor} or higher`);
      continue;
    }

    // MECHANICAL mode (a player's preview, docs/11b): the player's copy of a material has no effects, so only the facts are checked here
    // (slot, tier floor, quantity). The GM checks the effects when the craft is queued.
    let resolved = {};
    if (!mechanical) {
      const found = resolveSlotEffects(recipe, slot, material);
      // In a tagged slot an item with no effect for a role simply adds nothing for it yet (tag effects arrive in a later slice); anywhere else it is still an error.
      if (!tagged) for (const role of found.missing) errors.push(`slot "${slot.name}": ${material.name} has no effect for role "${role}"`);
      if (!tagged && found.missing.length) continue;
      resolved = found.resolved;
    }

    // Take units from this material's stacks, in order. Items that share a source (copies of one compendium item, tagged under that source) are separate stacks with the SAME materialId, so the
    // craft takes the FIRST copy in the bag and then the next if it needs more: the player cannot choose a copy, and escrow (queue/work.js heldOf) records only the first copy's data. By design.
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
      ...(mechanical ? {} : { slotLossChance: slot.lossChance, materialLossChance: material.lossChance })
    });

    const source = { slot: slot.name, materialId };
    for (const [role, value] of Object.entries(resolved)) {
      // In a tagged slot the five stacking roles are added up with the tags' effects after the loop (tags/stack.js); everything else is applied here as before.
      if (tagged && stackingRolesFor(baseRole).includes(role)) continue;
      if (role === baseRole) description.baseTier = parseTier(value);
      else if (role === "bonusDamage") description.damageBonuses.push({ ...value, label: material.name, source });
      else if (role === "specialAbility") description.abilities.push({ on: "hit", ...value, source });
      else if (role === "resistance") description.resistances.push({ ...value, source });
      else if (role === "applyCondition") for (const plain of plainLines(value)) description.conditions.push({ plain, source });
      else if (role === "spellSlots") description.spellSlots += value;
      else {
        const custom = customRoles.find(r => r.id === role);
        if (custom) description.fields.push({ path: custom.modifies, value, source });
      }
    }
  }

  // Slice 3: crafted items used as ingredients, and how deep the nesting goes. Refused in plain words before anything is spent.
  let depth = 1;
  const craftedUses = mechanical ? [] : uses.filter(u => isCraftedRef(u.materialId));
  for (const u of craftedUses) depth = Math.max(depth, (ledger?.crafted?.[craftedId(u.materialId)]?.depth ?? 1) + 1);
  if (depth > limits.maxDepth) errors.push(`this would nest crafted items ${depth} deep; the limit is ${limits.maxDepth} (crafted items made from crafted items made from...)`);

  // Slice 2a: what the TAGGED slots contribute (the materials' own effects and every tag's, each at its contributor's tier), stacked and capped. Old slots never read a tag.
  let capNotes = [];
  let frozen = null;
  if (!mechanical && !errors.length) {
    const stacked = stackedCraft({ recipe, uses: uses.map(u => ({ slot: u.slot, ref: u.materialId })), registry, ledger, caps, baseRole, resolveEffects: resolveSlotEffects });
    const source = { stacked: true };
    const r = stacked.roles;
    if (baseRole && r[baseRole]) description.baseTier = parseTier(r[baseRole]);          // exactly one slot drives the power role, so the stack is the only source of the tier when that slot is tagged
    for (const e of r.bonusDamage ?? []) description.damageBonuses.push({ ...e, source });
    for (const e of r.specialAbility ?? []) description.abilities.push({ on: "hit", ...e, source });
    for (const e of r.resistance ?? []) description.resistances.push({ ...e, source });
    if (r.applyCondition?.length) for (const plain of plainLines(r.applyCondition)) description.conditions.push({ plain, source });
    capNotes = stacked.notes;
    // Slice 2b/3: what the craft was made of and what it stacked to, for the GM-only frozen store (written when the craft resolves, never read from here by a player). A craft is frozen when it has a
    // tagged slot, or its recipe has a ledger entry (the GM tagged what it makes), so the item it makes can be an ingredient later.
    const native = ledger?.items?.[recipe.id]?.tags ?? [];
    const passing = new Set(recipe.slots.filter(s => slotPassCap(s)).map(s => s.name));
    if (stacked.taggedSlots.size || native.length || ledger?.items?.[recipe.id] || passing.size) {
      const inputTiers = uses.map(u => effectiveTier(u.materialId, registry, ledger)).filter(Number.isInteger);
      frozen = {
        recipeId: recipe.id,
        name: recipe.resultName ?? recipe.name,
        // the item's own tier: the GM's tier for its recipe, else the craft's power tier, else the highest input tier (recipes with no power role)
        tier: ledger?.items?.[recipe.id]?.tier ?? description.baseTier ?? (inputTiers.length ? Math.max(...inputTiers) : null),
        depth,
        native: [...native],
        inherited: inheritedTags({ recipe, uses, registry, ledger }),
        uses: uses.filter(u => stacked.taggedSlots.has(u.slot) || passing.has(u.slot) || isCraftedRef(u.materialId)).map(u => ({
          slot: u.slot, ref: u.materialId, name: itemName(u.materialId, registry, ledger), tier: effectiveTier(u.materialId, registry, ledger), tags: effectiveTags(u.materialId, registry, ledger),
          ...(isCraftedRef(u.materialId) ? { from: embedRecord(ledger?.crafted?.[craftedId(u.materialId)]) } : {})
        })),
        roles: stacked.roles,
        contributions: stacked.contributions.map(c => ({ role: c.role, value: c.value, from: c.from }))
      };
    }
  }

  if (mechanical) {
    if (errors.length) return { ok: false, errors };
    return { ok: true, plan: { recipeId: recipe.id, recipeName: recipe.name, uses, station: station ? { id: station.id, name: station.name, category: station.category, tier: station.tier } : null, fee: station ? feeForStation(station) : null, provenance: { recipeId: recipe.id, stationId: station?.id ?? null, materials: uses.map(u => ({ slot: u.slot, materialId: u.materialId, units: u.units })) } } };
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
      frozen,             // GM-only: the tagged part of the craft, to be frozen when it resolves (tags/frozen.js)
      capNotes,           // GM-only text about what a cap cut (never shown to a player; the craft logs it to the GM log)
      station: station ? { id: station.id, name: station.name, category: station.category, tier: station.tier } : null,
      // A workshop the party built charges no station fee; every other station charges its tier's fee.
      fee: station ? feeForStation(station) : null,
      provenance: {
        recipeId: recipe.id,
        stationId: station?.id ?? null,
        materials: uses.map(u => ({ slot: u.slot, materialId: u.materialId, units: u.units }))
      }
    }
  };
}
