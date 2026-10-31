/**
 * Where the Hub's facts come from (Stage 11a). The ONLY Foundry-bound reader: it calls the existing player APIs (formulasFor, projectInfo,
 * stationsFor, previewCraft, compendium.knownEffect, queue.list, downtime.state) and the adapter for the bag and the purse. It adds no
 * data to the player copy and invents nothing; the view-models (viewmodels.js) decide what any of it means.
 */
import * as adapter from "../adapter/pf2e.js";
import { MODULE_ID, STATION_KEYS } from "../config.js";
import { feeForStation } from "../stations/fees.js";
import { S } from "./strings.js";
import { allSlotsPicked, learnedKey, stationChoices } from "./viewmodels.js";

/** The characters this user owns at Owner level (a GM owns every character, so a GM sees them all). */
export const ownedCharacters = () => [...game.actors].filter(a => a.type === "character" && a.testUserPermission(game.user, "OWNER"));

/** The character the Hub opens for: the user's assigned character if they own it, else the first they own. */
export function defaultCharacter() {
  const owned = ownedCharacters();
  const mine = game.user.character;
  return owned.find(a => a.id === mine?.id) ?? owned[0] ?? null;
}

const inventoryOf = actor => {
  const units = {};
  for (const stack of adapter.getMaterialStacks(actor)) units[stack.materialId] = (units[stack.materialId] ?? 0) + stack.quantity;
  return units;
};

/** Safe reads: one broken source never blanks the whole window (it logs and the part reads as empty). */
const attempt = (what, fn, fallback) => {
  try { return fn(); } catch (error) { console.error(`${MODULE_ID} | the Hub could not read ${what}`, error); return fallback; }
};

export function readFacts(api, actor, state) {
  const characters = ownedCharacters().map(a => ({ id: a.id, name: a.name }));
  if (!actor) return { actor: null, characters, projects: [], leads: [], queuedResearch: [], shares: [], compendium: null, materialInfo: {}, open: {}, queue: [], formulas: [], researching: [], recipes: {}, materials: {}, inventory: {}, met: [], learned: {}, stations: [], preview: null, days: { free: 0, reserved: 0 }, gp: 0, downtime: { open: false, participant: false }, location: { name: null, stations: [] }, definitions: "ready" };

  const defs = api.definitions;
  const period = attempt("the downtime period", () => api.downtime.state(), { open: false, participants: {} });
  const rows = attempt("the queue", () => api.queue.list([actor]), []);
  const queue = rows.map(r => ({ id: r.action.id, label: r.label, days: r.action.daysReserved ?? 0 }));
  const reserved = rows.reduce((sum, r) => sum + (r.action.daysReserved ?? 0), 0);

  const formulas = attempt("the formulae", () => api.formulasFor(actor), []).filter(f => f.status !== "invalid").map(f => ({ recipeId: f.recipeId, name: f.name, access: f.access }));
  const researching = attempt("the research", () => api.projectInfo(actor), []).filter(p => p.status === "active").map(p => {
    const full = attempt("a project", () => api.projectInfo(actor, p.id).project, null);
    return full?.outcome?.type === "unlockFormula" ? { id: p.id, goalName: p.goalName, recipeId: full.outcome.recipeId ?? null, progress: p.progress, threshold: p.threshold } : null;
  }).filter(Boolean);

  const recipes = {};
  for (const f of [...formulas, ...researching]) {
    const recipe = f.recipeId ? defs?.recipe.get(f.recipeId) : null;
    if (recipe) recipes[recipe.id] = recipe;
  }
  const inventory = attempt("the bag", () => inventoryOf(actor), {});
  const materials = {};
  for (const id of Object.keys(inventory)) { const material = defs?.material.get(id); if (material) materials[id] = material; }
  const met = Object.keys(materials).filter(id => attempt("the Compendium", () => api.compendium.hasMaterial(actor, id), false));
  // Materials with a study the character has not done are not open to crafting (a plain yes/no per material).
  const open = Object.fromEntries(Object.keys(materials).map(id => [id, attempt("what you have studied", () => api.discovery.propertiesOpen(actor, id), true)]));

  const town = attempt("the party location", () => game.settings.get(MODULE_ID, STATION_KEYS.partyLocationSetting), "") || null;
  const reachable = attempt("the workshops", () => api.stationsFor(actor), []).filter(s => s.reachable);

  const recipe = state.recipeId ? recipes[state.recipeId] : null;
  const held = formulas.some(f => f.recipeId === state.recipeId);
  const learned = {};
  let stations = [];
  let preview = null;
  if (recipe && held) {
    stations = attempt("the workshops for this formula", () => api.stationsFor(actor, recipe.id), []).map(s => ({
      id: s.id, name: s.name, tier: s.tier, where: s.where, reachable: s.reachable, usable: s.usable, fee: attempt("a station fee", () => feeForStation(s), 0)
    }));
    for (const slot of recipe.slots) {
      for (const id of met) {
        if ((inventory[id] ?? 0) > 0 && materials[id].tier >= slot.tierFloor) learned[learnedKey(recipe.id, slot.name, id)] = attempt("what you have learned", () => api.compendium.knownEffect(actor, recipe, slot.name, id), { known: false });
      }
    }
    if (allSlotsPicked(recipe, state.picks)) {
      // Always name the workshop (the cheapest unless the player chose one): with several usable, previewCraft refuses to guess.
      const stationId = stationChoices(stations, state.stationId).chosenId ?? undefined;
      preview = attempt("the craft preview", () => api.previewCraft(actor, recipe.id, state.picks, stationId), null);
    }
  }

  // Research and Compendium (read only for the tab that is open). Projects only through projectInfo (the player copy: no DC, odds or pace); a check's free-text note is dropped here.
  const projects = state.tab !== "research" ? [] : attempt("the research", () => api.projectInfo(actor), []).filter(p => p.status === "active").map(p => {
    const info = attempt("a project", () => api.projectInfo(actor, p.id), null);
    const pr = info?.project;
    if (!pr) return null;
    const study = pr.kind === "study";
    return {
      id: pr.id, goalName: pr.goalName, kind: study ? "study" : pr.outcome?.type ?? "unlockFormula", recipeId: pr.outcome?.recipeId ?? null,
      ...(study ? { stage: pr.stage, stageWord: pr.stageWord } : { progress: pr.progress, threshold: pr.threshold }),
      skills: (info.perSkill ?? []).map(s => ({ skill: s.skill, label: adapter.skillLabel(s.skill), modifier: s.modifier ?? null })),
      log: (pr.log ?? []).map(({ source, degree, delta, skill }) => ({ source, degree, delta, skill })),
      hint: info.hints?.[0] ?? null
    };
  }).filter(Boolean);
  const leads = state.tab !== "research" ? [] : attempt("the leads", () => api.research.leadsFor(actor), []).map(({ id, recipeId, name, note, source, itemKind, paused }) => ({ id, recipeId: recipeId ?? null, name, note: note ?? "", source: source ?? "gm", itemKind: itemKind ?? null, paused: Boolean(paused) }));
  const queuedResearch = rows.filter(r => r.action.type === "research").map(r => ({ actionId: r.action.id, projectId: r.action.params?.projectId, days: r.action.daysReserved ?? 0, skill: r.action.params?.skill ?? null }));
  const shares = rows.filter(r => r.action.type === "share").map(r => ({ actionId: r.action.id, kind: r.action.params?.kind, key: r.action.params?.key, name: r.action.params?.name }));
  const compendium = state.tab !== "compendium" ? null : attempt("the Compendium", () => api.compendium.view(actor), null);
  // What the properties milestone teaches about each material entry: its tag and the tag's theme (only once the character knows them) or that it is not studied yet.
  const materialInfo = {};
  for (const entry of compendium?.entries?.materials ?? []) {
    const def = defs?.material.get(entry.id);
    if (!def) continue;
    const known = attempt("what you have studied", () => api.discovery.propertiesOpen(actor, entry.id), true);
    const tag = known && def.tag ? defs?.tag?.get(def.tag) : null;
    materialInfo[entry.id] = { hasTrack: Boolean(def.hasTrack), known, tag: tag ? { name: tag.name, theme: tag.theme, worksWith: tag.worksWith ?? null } : null };
  }

  return {
    projects, leads, queuedResearch, shares, compendium, materialInfo, open,
    actor: { id: actor.id, name: actor.name }, characters,
    downtime: { open: Boolean(period.open), participant: Boolean(period.participants?.[actor.id]) },
    days: { free: attempt("the days", () => api.days(actor), 0), reserved },
    gp: attempt("the purse", () => adapter.getCopper(actor) / 100, 0),
    location: { name: town ? (defs?.town.get(town)?.name ?? S.locationLoading) : null, stations: reachable.map(s => s.name) },
    queue, formulas, researching, recipes, materials, inventory, met, learned, stations, preview,
    definitions: api.definitionsStatus().status === "ready" ? "ready" : "loading"
  };
}
