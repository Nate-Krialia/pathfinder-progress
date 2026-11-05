/**
 * The frozen result of a craft (Slice 2b). Pure; no Foundry globals.
 *
 * When a craft with TAGGED slots resolves, what it was made of (each ingredient, its tags and tier at that moment) and the stacked, capped result are written ONCE to a GM-only world
 * store, keyed by an opaque `freezeId` that the crafted item carries in its `crafted` flag. The effects engine reads this record instead of working the effects out again, so editing
 * a tag, the ledger or the caps later never changes an item that already exists. Nothing in it is ever sent to a player.
 *   { v: 1, items: { "<freezeId>": { recipeId, name, at, tier, depth, native: [tagId], inherited: [{ tag, tier }], uses: [{ slot, ref, name, tier, tags, from? }], roles, contributions } } }
 * Slice 3: a crafted item can itself be an ingredient (reference `crafted:<freezeId>`): `tier` is its own tier, `native` the GM's tags for its recipe at that moment, `inherited` the tags it took from
 * its inputs (each at the tier it was contributed at), and a `uses[i].from` is a compact copy of a crafted ingredient's record, so deleting that ingredient never loses the provenance.
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
  return {
    recipeId: f.recipeId, name: f.name, at: now, tier: f.tier ?? null, depth: f.depth ?? 1, native: [...(f.native ?? [])], inherited: structuredClone(f.inherited ?? []),
    uses: structuredClone(f.uses), roles: structuredClone(f.roles), contributions: structuredClone(f.contributions)
  };
}

/** The conditions a frozen record puts on a target (the stacked applyCondition list). */
export const frozenConditions = record => (Array.isArray(record?.roles?.applyCondition) ? record.roles.applyCondition : []);

/** The compact copy of a crafted ingredient's record that is embedded in the craft that used it. */
export function embedRecord(record) {
  if (!record) return null;
  return { recipeId: record.recipeId, name: record.name, tier: record.tier ?? null, depth: record.depth ?? 1, native: [...(record.native ?? [])], inherited: structuredClone(record.inherited ?? []), uses: structuredClone(record.uses ?? []) };
}
