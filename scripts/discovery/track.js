/**
 * Research tracks and what a character knows from them (Stage 11c, docs/11c-discovery-addendum.md). Pure; no Foundry globals.
 *
 * A TRACK is GM-only data: an ordered list of milestones { steps, grants: { type: "properties" } | { type: "formula", recipeId } }. The ledger
 * (actor flag `discoveries`) records the steps put in and the milestones reached, never the thresholds.
 */
import { DISCOVERY } from "../config.js";

export const itemKey = (kind, id) => `${kind}:${id}`;
export const parseKey = key => { const [kind, ...rest] = String(key).split(":"); return { kind, id: rest.join(":") }; };

/** The first-listed track wins: the Discovery tracks window's overlay, then the definition's own. Returns the track or null. */
export const trackOf = (record, overlay, key) => overlay?.[key] ?? record?.research ?? null;

export const finalSteps = track => track.milestones.at(-1).steps;

/** The milestones whose steps are reached at `steps`, with the ones already in `reached` left out. */
export function newlyReached(track, steps, reached = []) {
  const done = new Set(reached.map(r => r.index));
  return track.milestones.map((m, index) => ({ m, index })).filter(({ m, index }) => steps >= m.steps && !done.has(index));
}

/** 0 Just started, 1 Getting somewhere, 2 Nearly there: how far toward the NEXT milestone. No numbers leave this function. */
export function stageOf(track, steps, config = DISCOVERY) {
  const next = track.milestones.find(m => steps < m.steps);
  if (!next) return 2;
  const before = track.milestones.filter(m => m.steps <= steps).at(-1)?.steps ?? 0;
  const fraction = (steps - before) / (next.steps - before);
  return fraction < config.stageSplit[0] ? 0 : fraction < config.stageSplit[1] ? 1 : 2;
}

/** A fresh default track (the editor's "Add default track"): 4 steps = properties, 8 steps = a formula the GM picks. */
export const defaultTrack = (recipeId, kind = "material") => ({
  milestones: DISCOVERY.defaultTrack
    .filter(m => kind === "material" || m.grants.type !== "properties")
    .map(m => ({ steps: m.steps, grants: m.grants.type === "formula" ? { type: "formula", ...(recipeId ? { recipeId } : {}) } : { ...m.grants } }))
});

const wanted = (ledger, key) => ledger?.items?.[key];

/** Has this character reached the properties milestone of this item? */
export const propertiesReached = (ledger, key) => Boolean(wanted(ledger, key)?.reached?.some(r => r.type === "properties"));

/** Which formulas has the ledger granted? */
export const formulasGranted = ledger => Object.values(ledger?.items ?? {}).flatMap(e => e.reached.filter(r => r.type === "formula").map(r => r.recipeId)).filter(Boolean);

/**
 * Has the character learned what `materialId` does by crafting with it? Any class fact or recipe fact in their book (or the shared one).
 * This is the "retroactive properties" rule: a track added to a material later does not lock out someone who already crafted with it.
 */
export function craftedWith(books, materialId) {
  for (const book of [books?.own, books?.shared]) {
    for (const byMaterial of Object.values(book?.classes ?? {})) if (Object.hasOwn(byMaterial, materialId)) return true;
    for (const entry of Object.values(book?.experiments ?? {})) for (const bySlot of Object.values(entry.slots ?? {})) if (Object.hasOwn(bySlot, materialId)) return true;
  }
  return false;
}

/**
 * Does the character know the properties (the tag and its theme) of a material? Yes when it has no track, when the properties milestone is
 * reached, or when they have already crafted with it.
 * @param {boolean} hasTrack  the GM's `research` or the player copy's `hasTrack`
 */
export function propertiesKnown({ ledger, books, materialId, hasTrack }) {
  if (!hasTrack) return true;
  return propertiesReached(ledger, itemKey("material", materialId)) || craftedWith(books, materialId);
}

/**
 * Higher formula versions a character could now start researching (GM side: needs the full registry). A version qualifies when its family's previous
 * version is known, and `requiresCount` (default: its version number) DIFFERENT materials with `requiresTag` have known properties.
 * @returns {Array<{ recipeId: string, name: string }>}  not yet known, not already being studied or led to
 */
export function versionCandidates({ registry, formulaIds, met, propsKnown, taken = new Set() }) {
  const known = new Set(formulaIds);
  const out = [];
  for (const recipe of registry.recipe.values()) {
    if (!recipe.requiresTag || known.has(recipe.id) || taken.has(recipe.id)) continue;
    const version = recipe.version ?? 1;
    const previous = [...registry.recipe.values()].find(r => r.family && r.family === recipe.family && (r.version ?? 1) === version - 1);
    if (!previous || !known.has(previous.id)) continue;
    const have = [...registry.material.values()].filter(m => m.tag === recipe.requiresTag && met(m) && propsKnown(m)).length;
    if (have >= (recipe.requiresCount ?? version)) out.push({ recipeId: recipe.id, name: recipe.name });
  }
  return out.sort((a, b) => a.recipeId.localeCompare(b.recipeId));
}
