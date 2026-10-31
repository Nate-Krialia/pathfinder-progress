/** The research-track rows of the item editor (Stage 11d; moved here from the 11c Discovery tracks window). Pure; no Foundry globals. */
import { check } from "../data/schema.js";
import { TRACK_SCHEMA } from "../data/schemas.js";
import { defaultTrack } from "../discovery/track.js";

/** A draft of a track: rows of { steps (text, as typed), type, recipeId }. */
export const rowsOf = track => (track ? track.milestones.map(m => ({ steps: String(m.steps), type: m.grants.type, recipeId: m.grants.recipeId ?? "" })) : []);

export function trackOfRows(rows) {
  return { milestones: rows.map(r => ({ steps: Number(r.steps), grants: r.type === "formula" ? { type: "formula", ...(r.recipeId ? { recipeId: r.recipeId } : {}) } : { type: "properties" } })) };
}

/** Edits, each returning new rows. */
export const rowEdit = {
  setSteps: (rows, index, value) => rows.map((r, i) => (i === index ? { ...r, steps: String(value) } : r)),
  setGrants: (rows, index, type, recipeId = "") => rows.map((r, i) => (i === index ? { ...r, type, recipeId: type === "formula" ? recipeId : "" } : r)),
  setRecipe: (rows, index, recipeId) => rows.map((r, i) => (i === index ? { ...r, recipeId } : r)),
  remove: (rows, index) => rows.filter((_, i) => i !== index),
  add: (rows, kind) => {
    const last = rows.at(-1);
    const next = last ? Number(last.steps) + 4 : 4;
    const type = kind === "material" && !rows.some(r => r.type === "properties") ? "properties" : "formula";
    return [...rows, { steps: String(Number.isFinite(next) ? next : 4), type, recipeId: "" }];
  },
  addDefault: (kind, recipeId) => rowsOf(defaultTrack(recipeId, kind))
};

/** What is wrong with the rows, as plain sentences: [{ index|null, text }]. Empty means they can be saved. */
export function rowProblems(rows, kind, itemId, registry) {
  const problems = [];
  rows.forEach((r, index) => {
    if (!/^\d+$/.test(String(r.steps).trim()) || Number(r.steps) < 1) problems.push({ index, text: "Steps must be a whole number of at least 1." });
    if (r.type === "formula") {
      const recipeId = r.recipeId || (kind === "note" ? registry.note.get(itemId)?.recipeId : kind === "recipe" ? itemId : "");
      if (!recipeId || !registry.recipe.has(recipeId)) problems.push({ index, text: "Pick a formula that exists." });
    }
    if (r.type === "properties" && kind !== "material") problems.push({ index, text: "Only a material has a properties milestone." });
  });
  if (!problems.length && rows.length) for (const p of check(TRACK_SCHEMA, trackOfRows(rows))) problems.push({ index: null, text: `${p.field.replace(/^milestones/, "Milestone ").replace(/\[(\d+)\]/g, (_, n) => `${Number(n) + 1}`)} ${p.message}.`.replace(/\s+/g, " ") });
  return problems;
}
