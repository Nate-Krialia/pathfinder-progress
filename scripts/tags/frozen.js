/**
 * The frozen result of a craft (Slice 2b). Pure; no Foundry globals.
 *
 * When a craft with TAGGED slots resolves, what it was made of (each ingredient, its tags and tier at that moment) and the stacked, capped result are written ONCE to a GM-only world
 * store, keyed by an opaque `freezeId` that the crafted item carries in its `crafted` flag. The effects engine reads this record instead of working the effects out again, so editing
 * a tag, the ledger or the caps later never changes an item that already exists. Nothing in it is ever sent to a player.
 *   { v: 1, items: { "<freezeId>": { recipeId, at, uses: [{ slot, ref, name, tier, tags }], roles, contributions } } }
 */
export const emptyFrozen = () => ({ v: 1, items: {} });

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** What a stored frozen store must look like; a damaged one is an error to show, never silently replaced. */
export function frozenProblems(store) {
  if (!isObject(store) || store.v !== 1 || !isObject(store.items)) return ["the saved frozen craft results have an unknown shape"];
  const problems = [];
  for (const [id, rec] of Object.entries(store.items)) if (!isObject(rec) || typeof rec.recipeId !== "string" || !isObject(rec.roles)) problems.push(`the frozen result "${id}" is damaged`);
  return problems;
}

/** The record to store for a plan, or null when the craft has no tagged slot (an old craft is not frozen). */
export function recordFromPlan(plan, now = Date.now()) {
  const f = plan?.frozen;
  if (!f) return null;
  return { recipeId: f.recipeId, at: now, uses: structuredClone(f.uses), roles: structuredClone(f.roles), contributions: structuredClone(f.contributions) };
}

/** The conditions a frozen record puts on a target (the stacked applyCondition list). */
export const frozenConditions = record => (Array.isArray(record?.roles?.applyCondition) ? record.roles.applyCondition : []);
