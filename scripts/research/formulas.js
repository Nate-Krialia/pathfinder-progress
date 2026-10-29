/**
 * Formulas an actor holds. Pure; no Foundry globals.
 *
 * Crafting always uses the LIVE recipe; a formula only authorises it. The snapshot is a
 * display copy so the interface can show players their own formulae. Recipes live in a pack
 * hidden from players' interface; that is an honor system, not access control.
 * It copies only what a player may know, never overrides, outputs, or research details.
 */

/** The only recipe fields a snapshot may contain (a test guards this list). */
// craftLevel is NOT here (docs/11b): the level gives the craft DC through the public PF2e table, and this copy sits on the actor.
export const SNAPSHOT_KEYS = ["name", "category", "slots", "stationCategory", "stationTierMin"];

export function makeSnapshot(recipe) {
  return {
    name: recipe.name,
    category: recipe.category,
    slots: recipe.slots.map(slot => ({
      name: slot.name,
      drives: Array.isArray(slot.drives) ? [...slot.drives] : [slot.drives],
      tierFloor: slot.tierFloor,
      qty: slot.qty
    })),
    stationCategory: recipe.stationCategory,
    stationTierMin: recipe.stationTierMin
  };
}

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
};
export const snapshotsEqual = (a, b) => canonical(a) === canonical(b);

export const findFormula = (list, recipeId) => list.find(entry => entry.recipeId === recipeId) ?? null;

/**
 * Add a formula. One entry per recipe: owned replaces a loan (an upgrade), a loan never
 * replaces owned, and granting the same access again just refreshes the snapshot.
 * @returns {{ ok: true, list: object[], change: "added"|"upgraded"|"refreshed"|"unchanged" } | { ok: false, error: string }}
 */
export function addFormula(list, recipe, { access = "owned", source = "gm" } = {}) {
  if (!["owned", "loan"].includes(access)) return { ok: false, error: `access must be "owned" or "loan" (got ${JSON.stringify(access)})` };
  const entry = { recipeId: recipe.id, access, source, snapshot: makeSnapshot(recipe) };
  const existing = findFormula(list, recipe.id);

  if (!existing) return { ok: true, list: [...list, entry], change: "added" };
  if (existing.access === "owned" && access === "loan") {
    return { ok: false, error: `the formula for "${recipe.name}" is already owned; a loan cannot replace it` };
  }
  if (existing.access === "loan" && access === "owned") {
    return { ok: true, list: list.map(e => (e === existing ? entry : e)), change: "upgraded" };
  }
  const same = existing.snapshot && snapshotsEqual(existing.snapshot, entry.snapshot);
  return { ok: true, list: same ? list : list.map(e => (e === existing ? { ...existing, snapshot: entry.snapshot } : e)), change: same ? "unchanged" : "refreshed" };
}

export function removeFormula(list, recipeId) {
  if (!findFormula(list, recipeId)) return { ok: false, error: `no formula "${recipeId}" to remove` };
  return { ok: true, list: list.filter(entry => entry.recipeId !== recipeId) };
}

/** One row per formula: ok, stale (snapshot out of date), or orphaned (its recipe no longer exists). */
export function reportFormulas(list, registry) {
  return list.map(entry => {
    const recipe = registry.recipe.get(entry.recipeId);
    const name = recipe?.name ?? entry.snapshot?.name ?? entry.recipeId;
    let status = "ok";
    if (!recipe) status = "orphaned";
    else if (!entry.snapshot || !snapshotsEqual(entry.snapshot, makeSnapshot(recipe))) status = "stale";
    return { recipeId: entry.recipeId, name, access: entry.access, source: entry.source, status };
  });
}

/** Bring stale snapshots up to date. Orphans are left alone and listed. */
export function refreshSnapshots(list, registry) {
  const refreshed = [];
  const orphaned = [];
  const next = list.map(entry => {
    const recipe = registry.recipe.get(entry.recipeId);
    if (!recipe) { orphaned.push(entry.recipeId); return entry; }
    const fresh = makeSnapshot(recipe);
    if (entry.snapshot && snapshotsEqual(entry.snapshot, fresh)) return entry;
    refreshed.push(entry.recipeId);
    return { ...entry, snapshot: fresh };
  });
  return { list: next, refreshed, orphaned };
}

/**
 * Does this crafter hold the formula? Owned and loaned formulas both authorise crafting, with one
 * limit: a loan handed over for commissions (it carries a `commissions` list) can only be used
 * through one of those commissions, never by the generic craft.
 */
export function formulaRequirement(list, recipe, crafterName, { commissionId } = {}) {
  const entry = findFormula(list, recipe.id);
  if (!entry) {
    return { ok: false, error: `${crafterName} does not know the formula for "${recipe.name}" (research it, or have the GM grant it)` };
  }
  const serves = entry.access === "loan" ? (entry.commissions ?? []) : [];
  if (serves.length) {
    if (!commissionId) return { ok: false, error: `${crafterName} holds "${recipe.name}" on loan for a commission, so it can only be crafted through that commission (api.commissions.craft)` };
    if (!serves.includes(commissionId)) return { ok: false, error: `${crafterName}'s loan of "${recipe.name}" is not for commission "${commissionId}"` };
  }
  return { ok: true, access: entry.access };
}
