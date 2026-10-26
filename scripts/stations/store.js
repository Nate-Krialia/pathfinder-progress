/**
 * Foundry-bound station storage and GM tools. The rules themselves live in the
 * pure modules (join.js, reach.js, fees.js); this file only reads and writes
 * Foundry data (a world setting and actor flags). Every write is GM-only and
 * validated first, so bad data never reaches the flags.
 */
import { MODULE_ID, STATION_KEYS as K, STATIONS } from "../config.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { buildStationList, validateOwnedRecord } from "./join.js";
import { effectiveTown, evaluateForRecipe, evaluateStations } from "./reach.js";

export const partyTown = () => game.settings.get(MODULE_ID, K.partyLocationSetting) || null;
export const actorNameOf = id => game.actors.get(id)?.name ?? id;

/** The town an actor is in right now: actor override > party location > nowhere. */
export function townOfActor(actorId) {
  const override = game.actors.get(actorId)?.getFlag(MODULE_ID, K.actorLocationFlag);
  return effectiveTown(actorId, { actorOverrides: { [actorId]: override }, partyTown: partyTown() });
}

/** The joined station list ({ stations, errors }) from the compendium, world state and actor flags. */
export function readStations(api) {
  if (!api.definitions) return { stations: [], errors: [] };
  const ownedByActor = new Map();
  for (const actor of game.actors) {
    const raw = actor.getFlag(MODULE_ID, K.actorStationsFlag);
    if (raw !== undefined) ownedByActor.set(actor.id, raw);
  }
  return buildStationList({
    definitions: api.definitions.station,
    towns: api.definitions.town,
    contexts: api.contexts,
    stateEntries: game.settings.get(MODULE_ID, K.stationStateSetting) ?? [],
    ownedByActor,
    actorExists: id => game.actors.has(id),
    actorName: actorNameOf
  });
}

/** One row per known station for `actor`: reachability, and usability when a recipe is given. */
export function stationRows(api, actor, recipeId) {
  const { stations } = readStations(api);
  const townName = id => api.definitions.town.get(id)?.name ?? id;
  let verdicts = evaluateStations({ crafterId: actor.id, stations, townOf: townOfActor, townName, nameOf: actorNameOf });
  if (recipeId) {
    const recipe = api.definitions.recipe.get(recipeId);
    if (!recipe) throw new Error(`stationsFor: unknown recipe "${recipeId}"`);
    verdicts = evaluateForRecipe(verdicts, recipe);
  }
  return verdicts.map(v => ({
    id: v.station.id,
    name: v.station.name,
    category: v.station.category,
    tier: v.station.tier,
    where: v.station.location.type === "fixed" ? townName(v.station.location.town) : `carried by ${actorNameOf(v.station.location.holder)}`,
    reachable: v.reachable,
    ...(recipeId ? { usable: v.usable } : {}),
    reason: v.reason
  }));
}

// GM tools -------------------------------------------------------------------------
function requireGM(what) {
  if (!game.user.isGM) throw new Error(`${what}: GM only`);
}

function requireTown(api, townId, what) {
  if (!api.definitions?.town.has(townId)) {
    throw new Error(`${what}: unknown town "${townId}" (known: ${[...(api.definitions?.town.keys() ?? [])].join(", ") || "none"})`);
  }
}

const ownedOf = actor => {
  const raw = actor.getFlag(MODULE_ID, K.actorStationsFlag);
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${actor.name}'s stations flag is not a list; fix or clear it first`);
  return raw;
};

/** Set the party's location (a town id), or "" / null to clear it. */
export async function setLocation(api, townId) {
  requireGM("setLocation");
  if (townId) requireTown(api, townId, "setLocation");
  await game.settings.set(MODULE_ID, K.partyLocationSetting, townId ?? "");
}

/** Override one actor's location, or pass null to fall back to the party location. */
export async function setActorLocation(api, actor, townId) {
  requireGM("setActorLocation");
  if (townId) {
    requireTown(api, townId, "setActorLocation");
    await actor.setFlag(MODULE_ID, K.actorLocationFlag, townId);
  } else {
    await actor.unsetFlag(MODULE_ID, K.actorLocationFlag);
  }
}

/** Set owner / access / tier for a PUBLIC station. Omitted fields are cleared. */
export async function setStationState(api, stationId, state = {}) {
  requireGM("setStationState");
  if (!api.definitions?.station.has(stationId)) throw new Error(`setStationState: unknown station "${stationId}"`);
  const entry = { stationId, access: [], ...state };
  if (entry.owner === null || entry.owner === undefined) delete entry.owner;
  if (entry.tier === null || entry.tier === undefined) delete entry.tier;
  const errors = check(LIVE_SCHEMAS.stationState, entry);
  if (errors.length) throw new Error(`setStationState: invalid:\n- ${errors.map(e => `${e.field} ${e.message}`).join("\n- ")}`);
  if (entry.owner && !game.actors.has(entry.owner)) throw new Error(`setStationState: owner "${entry.owner}" is not an actor in this world`);

  const list = (game.settings.get(MODULE_ID, K.stationStateSetting) ?? []).filter(e => e.stationId !== stationId);
  await game.settings.set(MODULE_ID, K.stationStateSetting, [...list, entry]);
  return entry;
}

/** Remove a public station's state entry, making it public again. */
export async function clearStationState(stationId) {
  requireGM("clearStationState");
  const list = game.settings.get(MODULE_ID, K.stationStateSetting) ?? [];
  await game.settings.set(MODULE_ID, K.stationStateSetting, list.filter(e => e.stationId !== stationId));
}

/**
 * Give an actor a carried kit (default) or a fixed workshop.
 * spec: { name, category, tier, location?: "carried" | { town }, access?: [actorId], id? }
 * Refuses (and writes nothing) when the record is invalid, e.g. a kit above the portable cap.
 */
export async function giveStation(api, actor, spec) {
  requireGM("giveStation");
  const wantsFixed = spec.location && spec.location !== "carried";
  const record = {
    id: spec.id ?? `owned-${foundry.utils.randomID(8).toLowerCase()}`,
    name: spec.name,
    category: spec.category,
    tier: spec.tier,
    location: wantsFixed ? { type: "fixed", town: spec.location.town ?? spec.location } : { type: "carried", holder: actor.id },
    owner: actor.id,
    access: spec.access ?? []
  };
  const problems = validateOwnedRecord(record, actor.id, { towns: api.definitions?.town, config: STATIONS });
  if (readStations(api).stations.some(s => s.id === record.id)) problems.push({ field: "id", message: `"${record.id}" is already used by another station` });
  if (problems.length) {
    throw new Error(`giveStation: "${record.name ?? record.id}" is invalid:\n- ${problems.map(p => `${p.field} ${p.message}`).join("\n- ")}`);
  }
  await actor.setFlag(MODULE_ID, K.actorStationsFlag, [...ownedOf(actor), record]);
  return record;
}

/** Delete an owned station (workshop or kit) from an actor. */
export async function removeStation(actor, stationId) {
  requireGM("removeStation");
  const current = ownedOf(actor);
  const next = current.filter(r => r.id !== stationId);
  if (next.length === current.length) throw new Error(`removeStation: ${actor.name} has no owned station "${stationId}"`);
  await actor.setFlag(MODULE_ID, K.actorStationsFlag, next);
}

/** Move an owned station to another actor (the new owner/holder). */
export async function transferStation(api, stationId, toActor) {
  requireGM("transferStation");
  const from = [...game.actors].find(a => ownedOf(a).some(r => r.id === stationId));
  if (!from) throw new Error(`transferStation: no actor owns a station "${stationId}"`);
  const record = structuredClone(ownedOf(from).find(r => r.id === stationId));
  record.owner = toActor.id;
  if (record.location.type === "carried") record.location.holder = toActor.id;
  const problems = validateOwnedRecord(record, toActor.id, { towns: api.definitions?.town, config: STATIONS });
  if (problems.length) throw new Error(`transferStation: invalid:\n- ${problems.map(p => `${p.field} ${p.message}`).join("\n- ")}`);
  await toActor.setFlag(MODULE_ID, K.actorStationsFlag, [...ownedOf(toActor), record]);
  await from.setFlag(MODULE_ID, K.actorStationsFlag, ownedOf(from).filter(r => r.id !== stationId));
  return record;
}
