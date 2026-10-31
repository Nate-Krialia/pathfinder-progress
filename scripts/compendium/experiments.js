/**
 * Experiments: what a character has LEARNED about a recipe (docs/11b, B). Pure; no Foundry globals.
 *
 * Knowledge (docs/11c-discovery-addendum.md, which replaced 11b's "per recipe only"):
 *   - per material per ITEM CLASS (a recipe's category): "Wyrmroot in armor gives resistance". One successful armor craft teaches it for ALL armors.
 *     Stored in `classes: { [category]: { [materialId]: { materialId, materialName, tier, effects: {role: value}, at } } }`.
 *   - per (recipe, slot, material) ONLY where the recipe gives that material its own OVERRIDE ("the T2 liquid in this recipe's blade slot gives +4").
 *     Older books also hold per-recipe facts for non-overridden materials; they keep working (and are folded into the class by migrateToClasses).
 * Only a SUCCESSFUL craft teaches. A formula's baseline (what the cheapest valid materials make) is revealed when the formula is owned.
 *
 * Book shape (inside the Compendium book, optional): experiments: { [recipeId]: { recipeId, name, firstAt, slots: { [slot]: { [materialId]:
 * { materialId, materialName, tier, effects: {role: value}, at } } }, baseline?: { baseTier, at, slots: [{ slot, tierFloor, materialId, effects }] } } }
 *
 * Every function is ADDITIVE and IDEMPOTENT (like the other categories): it returns a new book, adds what is new, changes nothing else,
 * so recording in either order, or twice, gives the same book.
 */
import { COMMISSIONS } from "../config.js";
import { baseRoleFor, parseTier, slotRoles } from "../data/roles.js";
import { resolveSlotEffects } from "../crafting/plan.js";

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const own = (object, key) => Object.hasOwn(object ?? {}, key);
const clone = value => structuredClone(value);
const safe = key => { if (typeof key !== "string" || !key.trim() || FORBIDDEN.has(key)) throw new RangeError(`experiments: "${key}" cannot be used as a key`); return key; };

export const experimentsOf = book => book?.experiments ?? {};
export const countExperiments = book => Object.keys(experimentsOf(book)).length;

const entryFor = (next, recipeId, name, at, category) => {
  next.experiments ??= {};
  if (!own(next.experiments, recipeId)) next.experiments[recipeId] = { recipeId, name: name ?? recipeId, firstAt: at, slots: {}, ...(category ? { category } : {}) };
  const entry = next.experiments[recipeId];
  if (category && !entry.category) entry.category = category;
  if (name && entry.name === entry.recipeId) entry.name = name;       // an entry made before the name was known
  return entry;
};

/** A successful craft taught this: `materialId` in `slot` of the recipe gives `effects`. */
export function recordExperiment(book, { recipeId, recipeName, category, slot, materialId, materialName, tier, effects, at = Date.now() }) {
  safe(recipeId); safe(slot); safe(materialId);
  const next = clone(book);
  const entry = entryFor(next, recipeId, recipeName, at, category);
  entry.slots[slot] ??= {};
  if (!own(entry.slots[slot], materialId)) entry.slots[slot][materialId] = { materialId, materialName: materialName ?? materialId, ...(tier === undefined ? {} : { tier }), effects: clone(effects ?? {}), at };
  else if (materialName && entry.slots[slot][materialId].materialName === materialId) entry.slots[slot][materialId].materialName = materialName;
  return next;
}

// Class knowledge (docs/11c-discovery-addendum.md) -------------------------------------------------------------------
/** Does this recipe give `materialId` its own effect in `slotName`? The GM's recipe lists `overrides`; a player's copy lists `overrideSlots` ("slot|materialId"). */
export function isOverridden(recipe, slotName, materialId) {
  if (!recipe || typeof recipe === "string") return false;
  if (Array.isArray(recipe.overrideSlots)) return recipe.overrideSlots.includes(`${slotName}|${materialId}`);
  return (recipe.overrides ?? []).some(o => o.materialId === materialId && o.slot === slotName);
}

/** Make sure the recipe has an Experiments entry (so it is listed and can be shared) even when what was learned is a whole item class's behaviour. */
export function touchExperiment(book, { recipeId, recipeName, category, at = Date.now() }) {
  safe(recipeId);
  const next = clone(book);
  entryFor(next, recipeId, recipeName, at, category);
  return next;
}

/** A successful craft taught this: `materialId` gives these role effects in an ITEM CLASS. Additive per role; the first value learned stays. */
export function recordClassFact(book, { category, materialId, materialName, tier, effects, at = Date.now() }) {
  safe(category); safe(materialId);
  const next = clone(book);
  next.classes ??= {};
  next.classes[category] ??= {};
  const fact = next.classes[category][materialId] ??= { materialId, materialName: materialName ?? materialId, ...(tier === undefined ? {} : { tier }), effects: {}, at };
  if (materialName && fact.materialName === materialId) fact.materialName = materialName;
  for (const [role, value] of Object.entries(effects ?? {})) if (!own(fact.effects, role)) fact.effects[role] = clone(value);
  return next;
}

/**
 * Fold the old per-recipe facts into the classes: a fact for a material the recipe does NOT override is how that material behaves in the recipe's whole
 * class. Additive and idempotent; the per-recipe facts stay (they are still true for that recipe). Recipes that no longer exist are left alone.
 * @param {(recipeId: string) => object|undefined} recipeOf
 */
export function migrateToClasses(book, recipeOf) {
  let next = book;
  for (const [recipeId, entry] of Object.entries(experimentsOf(book))) {
    const recipe = recipeOf(recipeId);
    if (!recipe) continue;
    for (const [slot, byMaterial] of Object.entries(entry.slots ?? {})) {
      for (const fact of Object.values(byMaterial)) {
        if (isOverridden(recipe, slot, fact.materialId)) continue;
        next = recordClassFact(next, { category: recipe.category, materialId: fact.materialId, materialName: fact.materialName, tier: fact.tier, effects: fact.effects, at: fact.at });
      }
    }
  }
  return next;
}

/** The formula is owned: reveal its baseline result. Keeps an existing baseline (it never changes once revealed). */
export function recordBaseline(book, { recipeId, recipeName, category, baseline, at = Date.now() }) {
  safe(recipeId);
  const next = clone(book);
  const entry = entryFor(next, recipeId, recipeName, at, category);
  if (!entry.baseline) entry.baseline = { ...(baseline.baseTier === undefined || baseline.baseTier === null ? {} : { baseTier: baseline.baseTier }), at, slots: clone(baseline.slots) };
  return next;
}

/**
 * What a character knows about `materialId` in `slot` of a recipe, from their own book and (if they are in the party) the shared one.
 * `recipe` is the recipe (its category and slots; `overrides` or `overrideSlots`) or, for older callers, just its id (no class knowledge then).
 * @returns {{ known: true, effects: object, via: "crafted"|"class"|"shared"|"baseline" } | { known: false }}
 */
export function effectKnown(books, recipe, slot, materialId) {
  const recipeId = typeof recipe === "string" ? recipe : recipe?.id;
  // 1. This recipe's own fact (an override learned here, or an older per-recipe fact).
  for (const [book, via] of [[books.own, "crafted"], [books.shared, "shared"]]) {
    const fact = experimentsOf(book)[recipeId]?.slots?.[slot]?.[materialId];
    if (fact) return { known: true, effects: clone(fact.effects), via };
  }
  // 2. How the material behaves in this recipe's ITEM CLASS, unless the recipe gives it an override (then only a craft of THIS recipe teaches it).
  if (recipe && typeof recipe === "object" && recipe.category && !isOverridden(recipe, slot, materialId)) {
    const roles = slotRoles(recipe.slots?.find(s => s.name === slot) ?? { drives: [] });
    for (const [book, via] of [[books.own, "class"], [books.shared, "shared"]]) {
      const fact = book?.classes?.[recipe.category]?.[materialId];
      if (fact && roles.length && roles.every(role => own(fact.effects, role))) return { known: true, effects: Object.fromEntries(roles.map(role => [role, clone(fact.effects[role])])), via };
    }
  }
  // 3. The formula's baseline.
  for (const book of [books.own, books.shared]) {
    const baseSlot = experimentsOf(book)[recipeId]?.baseline?.slots?.find(s => s.slot === slot);
    if (baseSlot && baseSlot.materialId === materialId) return { known: true, effects: clone(baseSlot.effects), via: "baseline" };
  }
  return { known: false };
}

/** The result of a selection, as far as it is known: the base tier is known only when the slot that picks it is. */
export function knownResult(recipe, slotFacts) {
  const baseRole = baseRoleFor(recipe);
  if (!baseRole) return { known: false };
  const slot = recipe.slots.find(s => (Array.isArray(s.drives) ? s.drives : [s.drives]).includes(baseRole));
  const fact = slot ? slotFacts[slot.name] : null;
  return fact?.known && fact.effects[baseRole] !== undefined ? { known: true, baseTier: parseTier(fact.effects[baseRole]) } : { known: false };
}

// Baseline ---------------------------------------------------------------------------------------------------------
const valueOf = material => material.value ?? COMMISSIONS.valueByTier[material.tier] ?? Number.MAX_SAFE_INTEGER;

/**
 * The cheapest valid material for each slot: the lowest tier at or above the slot's floor, then the lowest gp value, then the lowest id,
 * among the materials that have an effect for every role the slot drives. Computed on the GM, from the full registry.
 * @returns {{ baseTier: number|null, slots: Array<{ slot, tierFloor, materialId, effects }> } | null}  null when some slot has no valid material
 */
export function computeBaseline(recipe, registry) {
  const materials = [...registry.material.values()];
  const slots = [];
  for (const slot of recipe.slots) {
    const valid = materials
      .filter(m => m.tier >= slot.tierFloor)
      .map(material => ({ material, found: resolveSlotEffects(recipe, slot, material) }))
      .filter(({ found }) => found.missing.length === 0)
      .sort((a, b) => a.material.tier - b.material.tier || valueOf(a.material) - valueOf(b.material) || a.material.id.localeCompare(b.material.id));
    if (!valid.length) return null;
    slots.push({ slot: slot.name, tierFloor: slot.tierFloor, materialId: valid[0].material.id, effects: clone(valid[0].found.resolved) });
  }
  const baseRole = baseRoleFor(recipe);
  const baseSlot = baseRole ? slots.find(s => baseRole in s.effects) : null;
  return { baseTier: baseSlot ? parseTier(baseSlot.effects[baseRole]) : null, slots };
}

// Sharing and reading --------------------------------------------------------------------------------------------
/** The facts of one recipe, for a share request. Null when the character has no such entry. */
export function pickExperiment(book, recipeId) {
  if (typeof recipeId !== "string" || !own(experimentsOf(book), recipeId)) return null;
  const entry = clone(book.experiments[recipeId]);
  // What the character knows of this recipe's ITEM CLASS travels with it (a recipe's facts and its class's facts are one body of knowledge).
  const classFacts = entry.category ? clone(book.classes?.[entry.category] ?? {}) : {};
  return Object.keys(classFacts).length ? { ...entry, classFacts } : entry;
}

/** Merge shared facts into a book: the union of the known (slot, material) facts, a baseline if there is none, the earliest time. Additive, idempotent. */
export function mergeExperiment(book, picked) {
  safe(picked.recipeId);
  const { classFacts, ...entry } = picked;
  let next = clone(book);
  const merged = entryFor(next, entry.recipeId, entry.name, entry.firstAt, entry.category);
  merged.firstAt = Math.min(merged.firstAt, entry.firstAt);
  for (const [slot, byMaterial] of Object.entries(entry.slots ?? {})) {
    merged.slots[slot] ??= {};
    for (const [materialId, fact] of Object.entries(byMaterial)) if (!own(merged.slots[slot], materialId)) merged.slots[slot][materialId] = clone(fact);
  }
  if (!merged.baseline && entry.baseline) merged.baseline = clone(entry.baseline);
  for (const fact of Object.values(classFacts ?? {})) next = recordClassFact(next, { category: entry.category, ...fact });
  return next;
}

/** One line of what an experiments entry holds, for the review row. Facts only. */
export const experimentFactsText = entry => `${Object.values(entry.slots ?? {}).reduce((n, byMaterial) => n + Object.keys(byMaterial).length, 0) + Object.keys(entry.classFacts ?? {}).length} material effect(s) learned${entry.baseline ? ", baseline known" : ""}`;

/**
 * Experiments for a UI: the character's own knowledge and the shared one, merged. Nothing unknown is listed. The baseline names a
 * material only if the character has met it (an entry in their Materials); otherwise only the slot, its tier floor and the effect.
 */
export function describeExperiments({ own: ownBook, shared: sharedBook, recipes }) {
  const ids = new Set([...Object.keys(experimentsOf(ownBook)), ...Object.keys(experimentsOf(sharedBook))]);
  const met = id => own(ownBook.materials, id) || own(sharedBook?.materials, id);
  const nameOf = id => ownBook.materials?.[id]?.name ?? sharedBook?.materials?.[id]?.name ?? null;
  return [...ids].sort().map(recipeId => {
    const mine = experimentsOf(ownBook)[recipeId];
    const theirs = experimentsOf(sharedBook)[recipeId];
    const merged = mergeExperiment(mine ? { experiments: { [recipeId]: mine } } : { experiments: {} }, theirs ?? mine).experiments[recipeId];
    const known = [];
    for (const [slot, byMaterial] of Object.entries(merged.slots)) {
      for (const fact of Object.values(byMaterial)) {
        const inMine = Boolean(mine?.slots?.[slot]?.[fact.materialId]);
        known.push({ slot, materialId: fact.materialId, material: fact.materialName, tier: fact.tier ?? null, effects: clone(fact.effects), source: inMine ? "crafted" : "shared" });
      }
    }
    // What the character knows of this recipe's ITEM CLASS applies to its slots, except where the recipe gives a material its own effect.
    const recipe = recipes?.get?.(recipeId);
    if (recipe) {
      for (const slot of recipe.slots) {
        const roles = slotRoles(slot);
        for (const [book, byClass] of [[ownBook, ownBook?.classes?.[recipe.category]], [sharedBook, sharedBook?.classes?.[recipe.category]]]) {
          for (const fact of Object.values(byClass ?? {})) {
            if (isOverridden(recipe, slot.name, fact.materialId) || known.some(k => k.slot === slot.name && k.materialId === fact.materialId)) continue;
            if (!roles.every(role => own(fact.effects, role))) continue;
            known.push({ slot: slot.name, materialId: fact.materialId, material: fact.materialName, tier: fact.tier ?? null, effects: Object.fromEntries(roles.map(role => [role, clone(fact.effects[role])])), source: book === ownBook ? "class" : "shared" });
          }
        }
      }
    }
    const baseline = merged.baseline ? {
      baseTier: merged.baseline.baseTier ?? null,
      slots: merged.baseline.slots.map(s => ({ slot: s.slot, needs: `tier ${s.tierFloor} or higher`, effects: clone(s.effects), material: met(s.materialId) ? nameOf(s.materialId) : null }))
    } : null;
    const source = mine && theirs ? "both" : mine ? "own" : "shared";
    return { recipeId, name: merged.name, source, baseline, known };
  });
}
