/**
 * "What players see", in three stages (Stage 11d, v0.21.1). Pure; no Foundry globals.
 *
 * A stage is built the way the real thing is, never from the raw record: the material goes through `stripForPlayer` (what a player's client is sent), the facts are
 * shaped like the Hub's (`materialInfoFor`, the Compendium book a craft writes), and the lines come from the Hub's own Compendium view-model (`compendiumTab`), so
 * the preview cannot say anything the Hub would not. Nothing here reads a threshold, a step count or a DC: a track is only ever "there or not".
 *   picked  : the moment a player holds it. Name, tier, worth, bulk; the tag and theme only if it has NO study (known on pickup). No effects.
 *   studied : what the properties milestone adds (the tag and its theme). Still no class effects. With no study this is the same as `picked`.
 *   crafted : after a successful craft in the picked item class: the plain-words effect lines.
 */
import { stripForPlayer } from "../data/playerSet.js";
import { compendiumTab } from "../hub/viewmodels-compendium.js";
import { materialInfoFor } from "../hub/materialinfo.js";
import { S } from "../hub/strings.js";
import { cap } from "../hub/common.js";
import { recordClassFact, describeExperiments, touchExperiment } from "../compendium/experiments.js";
import { ITEM_CLASSES } from "../config.js";
import { classRoles, fitsRoles } from "./blocks.js";
import { trackOfRows } from "./rows.js";

export const STAGES = ["picked", "studied", "crafted"];
export const STAGE_LABELS = { picked: "Just picked up", studied: "After studying", crafted: "After a successful craft in this class" };
export const NO_STUDY = "No study: known on pickup.";
export const FORMULAS_ONLY = "Studying this teaches formulas, not what it is good for.";
const RECIPE_ID = "preview-recipe";

/** The draft as a definition record (what the GM's registry would hold), for stripForPlayer to cut down. */
function recordOf(draft) {
  const f = draft.fields;
  const record = { kind: "material", id: draft.id, name: String(f.name || "this item").trim(), tier: Number(f.tier) || 1, effects: {} };
  if (String(f.value ?? "").trim() !== "" && Number(f.value) >= 0) record.value = Number(f.value);
  if (f.tag) record.tag = f.tag;
  if (draft.rows.length) record.research = trackOfRows(draft.rows);
  return record;
}

/** The lines the player-facing effects take once learned by crafting, through the real Compendium path (a craft writes a class fact; Experiments lists it). */
function craftedEffects(draft, itemClass, record) {
  const roles = classRoles(draft.blocks, itemClass, record.tier);
  if (!Object.keys(roles).length) return [];
  const recipe = { id: RECIPE_ID, name: `${ITEM_CLASSES[itemClass].label} recipe`, category: itemClass, slots: [{ name: "slot", drives: Object.keys(roles), tierFloor: 1, qty: 1 }] };
  let book = touchExperiment({ experiments: {}, classes: {}, materials: {} }, { recipeId: RECIPE_ID, recipeName: recipe.name, category: itemClass, at: 1 });
  book = recordClassFact(book, { category: itemClass, materialId: record.id, materialName: record.name, tier: record.tier, effects: roles, at: 1 });
  const experiments = describeExperiments({ own: book, shared: null, recipes: new Map([[RECIPE_ID, recipe]]) });
  const facts = { compendium: { entries: { materials: [], creatures: [], regions: [], experiments }, own: {}, shared: {} }, shares: [], materialInfo: {}, recipes: { [RECIPE_ID]: recipe } };
  const detail = compendiumTab(facts, { category: "experiments", entryKey: RECIPE_ID }).detail;
  return (detail.known?.items ?? []).flatMap(k => k.effects);
}

/**
 * One stage of a material, as the player would see it.
 * @returns {{ stage, same: boolean, player: object|null, title, meta, facts: string[], know: { items: string[], empty: string|null }|null, effects: string[], fits: string|null, note: string|null }}
 */
export function stageOf(registry, draft, stage, itemClass) {
  const record = recordOf(draft);
  const hasTrack = draft.rows.length > 0;
  const hasProperties = draft.rows.some(r => r.type === "properties");
  const out = { stage, same: false, player: null, title: record.name, meta: S.tierLine(record.tier), facts: [], know: null, effects: [], fits: null, note: null };
  if (stage === "studied" && !hasTrack) return { ...out, same: true, note: NO_STUDY };
  const known = stage === "picked" ? !hasTrack : stage === "studied" ? hasProperties : true;
  if (stage === "studied" && !hasProperties) out.note = FORMULAS_ONLY;

  // What the player's client holds for it, and the tag definition as sent.
  const player = stripForPlayer("material", record, { tagKnown: known, hasTrack });
  out.player = player;                       // what the player's client holds for it (tests assert it is the stripped record)
  const tagDef = player.tag && registry.tag?.get(player.tag) ? stripForPlayer("tag", registry.tag.get(player.tag)) : null;
  const info = materialInfoFor(player, known, tagDef);
  const entry = { id: player.id, name: player.name, tier: player.tier, places: [], rungs: [], usedIn: [] };
  const facts = { compendium: { entries: { materials: [entry], creatures: [], regions: [], experiments: [] }, own: {}, shared: {} }, shares: [], materialInfo: { [player.id]: info }, recipes: {} };
  const detail = compendiumTab(facts, { category: "materials", entryKey: player.id }).detail;
  out.title = detail.title;
  out.meta = detail.meta;
  const know = detail.sections.find(s => s.heading === S.whatYouKnow);
  out.know = know ? { items: know.items, empty: know.empty } : null;
  if (player.value !== undefined) out.facts.push(cap(S.worthEach(player.value)));
  out.facts.push(`Bulk ${draft.fields.bulk || "L"}`);
  if (stage === "crafted") {
    out.effects = craftedEffects(draft, itemClass, record);
    const fits = fitsRoles(draft.blocks, itemClass);
    out.fits = fits.length ? fits : null;
  }
  return out;
}
