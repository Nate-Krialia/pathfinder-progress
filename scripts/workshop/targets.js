/**
 * Foundry-bound checks for research projects that are not about a recipe: a station upgrade needs its station (still at
 * the level the project began from), a design needs its blueprint. Also the designs a character holds (actor flag `blueprints`).
 */
import { MODULE_ID } from "../config.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { readStations } from "../stations/store.js";
import { levelsOf, planUpgrade } from "./rules.js";

export const BLUEPRINTS_FLAG = "blueprints";

/** The valid designs a character holds. */
export function heldDesigns(actor) {
  const raw = actor.getFlag(MODULE_ID, BLUEPRINTS_FLAG);
  return Array.isArray(raw) ? raw.filter(entry => check(LIVE_SCHEMAS.blueprintHold, entry).length === 0) : [];
}

export const holdsDesign = (actor, blueprintId) => heldDesigns(actor).some(entry => entry.blueprintId === blueprintId);

/** The design list with this blueprint added (unchanged if it is already there). */
export function withDesign(actor, blueprint, source) {
  const list = Array.isArray(actor.getFlag(MODULE_ID, BLUEPRINTS_FLAG)) ? [...actor.getFlag(MODULE_ID, BLUEPRINTS_FLAG)] : [];
  if (list.some(entry => entry?.blueprintId === blueprint.id)) return list;
  return [...list, { blueprintId: blueprint.id, name: blueprint.name, source, at: Date.now() }];
}

/** Why a (non-recipe) project can no longer reach its goal, or null. The message tells the player what to do. */
export function targetProblem(api, actor, project) {
  const outcome = project.outcome;
  if (outcome.type === "upgradeStation") {
    const station = readStations(api).stations.find(s => s.id === outcome.stationId);
    if (!station) return `the workshop "${outcome.stationId}" no longer exists; put the project aside to get your materials back`;
    const level = levelsOf(station)[outcome.kind];
    if (level !== outcome.from) return `${station.name} is already at ${outcome.kind} level ${level}, but this project began at ${outcome.from}; put it aside to get your materials back`;
    const plan = planUpgrade(station, outcome.kind);
    if (!plan.ok) return `${plan.error}; put the project aside to get your materials back`;
    return null;
  }
  if (outcome.type === "designBlueprint") {
    const blueprint = api.definitions?.blueprint.get(outcome.blueprintId);
    if (!blueprint) return `the blueprint "${outcome.blueprintId}" no longer exists; put the project aside`;
    if (holdsDesign(actor, outcome.blueprintId)) return `${actor.name} already holds the design for ${blueprint.name}; put the project aside`;
  }
  return null;
}
