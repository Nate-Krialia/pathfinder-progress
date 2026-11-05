/**
 * What a crafted item does to a target, and whether a message should offer it (v0.22.0). Pure; no Foundry globals.
 *
 * Nothing about the effect is written on the item: the item carries only the crafted flag (recipe and materials). Here the GM client looks the effects up again in its
 * registry through the ONE resolver (resolveSlotEffects), so a condition's value, save and DC never leave the GM's client.
 */
import { slotRoles } from "../data/roles.js";
import { resolveSlotEffects } from "../crafting/plan.js";
import { plainLines } from "./plain.js";
import { hasNeeds } from "../tags/ledger.js";
import { frozenRecord, getCaps, getLedger } from "../tags/current.js";
import { frozenConditions } from "../tags/frozen.js";
import * as gmLog from "../gm-log.js";
import { stackedCraft } from "../tags/contributions.js";
import { baseRoleFor } from "../data/roles.js";

/** The recipe's categories that act on a target, and when. */
export const TARGET_CLASSES = ["weapon", "bomb", "consumable"];

/**
 * The applyCondition effects of a crafted item, in a stable order: [{ index, materialId, materialName, slot, condition, value?, save }]. `recipe` is null when the flag names
 * a recipe the registry does not have.
 */
const warned = new Set();
export function effectsOf(flag, registry, { ledger = getLedger(), caps = getCaps(), frozen = frozenRecord } = {}) {
  const recipe = registry.recipe.get(flag?.recipeId) ?? null;
  if (!recipe) return { recipe: null, itemClass: null, effects: [] };
  const effects = [];
  for (const use of flag.materials ?? []) {
    const material = registry.material.get(use.materialId), slot = recipe.slots.find(s => s.name === use.slot);
    if (!material || !slot || !slotRoles(slot).includes("applyCondition")) continue;
    if (hasNeeds(slot)) continue;                      // a tagged slot's conditions come from the stack below (the ingredient's own and its tags', added up and capped)
    const list = resolveSlotEffects(recipe, slot, material).resolved.applyCondition;
    for (const e of Array.isArray(list) ? list : []) effects.push({ index: effects.length, materialId: material.id, materialName: material.name, slot: slot.name, ...e });
  }
  // Slice 2a/2b: tagged slots. A craft made with this slice carries an opaque freezeId: its conditions are READ from the frozen result (editing a tag, the ledger or the caps later does
  // not change the item). A craft made before the slice has none and is resolved again from the current registry, ledger and caps, as it always was.
  if (recipe.slots.some(hasNeeds)) {
    let stacked = null;
    if (flag.freezeId) {
      const record = frozen(flag.freezeId);
      if (record) stacked = { roles: { applyCondition: frozenConditions(record) } };
      else {
        // The record is gone (cleanup ran, the world was restored, a GM edited the setting): never guess and never crash; the GM is told once.
        if (!warned.has(flag.freezeId)) { warned.add(flag.freezeId); try { gmLog.record({ kind: "effect", text: `A crafted ${recipe.name} has no frozen tag result any more (${flag.freezeId}), so its tag effects are skipped.` }); } catch { /* logging must never break a use card */ } }
        stacked = { roles: {} };
      }
    } else {
      stacked = stackedCraft({ recipe, uses: (flag.materials ?? []).map(u => ({ slot: u.slot, ref: u.materialId })), registry, ledger, caps, baseRole: baseRoleFor(recipe), resolveEffects: resolveSlotEffects });
    }
    for (const e of stacked.roles.applyCondition ?? []) effects.push({ index: effects.length, materialId: "stacked", materialName: "its ingredients", slot: "stacked", ...e });
  }
  return { recipe, itemClass: recipe.category, effects };
}

/** The plain lines for some effects ("makes the target fearful"), without repeats. */
export const linesFor = effects => plainLines(effects.map(e => ({ condition: e.condition })));

/**
 * What to do with a message about a crafted item of `itemClass`: "card" (offer the effects to the GM), "fallback" (offer them, but the GM picks who) or "skip".
 *   weapon     an attack roll that hit (success or criticalSuccess).
 *   bomb       an attack roll with any outcome except critical failure (the GM decides on the card).
 *   consumable the use card.
 *   anything else about a crafted item that can act on a target (a message the module cannot place): the fallback card.
 */
export function decide(event, itemClass, targetCount) {
  if (!TARGET_CLASSES.includes(itemClass) || event.kind === "none" || event.kind === "damage") return "skip";
  let offer;
  if (event.kind === "attack" && !["success", "failure", "criticalSuccess", "criticalFailure"].includes(event.outcome)) offer = "fallback";   // an outcome the module cannot read
  else if (event.kind === "attack" && itemClass === "weapon") offer = ["success", "criticalSuccess"].includes(event.outcome) ? "card" : "skip";
  else if (event.kind === "attack" && itemClass === "bomb") offer = event.outcome === "criticalFailure" ? "skip" : "card";
  else if (event.kind === "consumable" && itemClass === "consumable") offer = "card";
  else offer = "fallback";
  return offer === "card" && targetCount === 0 ? "fallback" : offer;
}
