/**
 * Foundry-bound station storage and GM tools. The rules themselves live in the
 * pure modules (join.js, reach.js, fees.js); this file only reads and writes
 * Foundry data (a world setting and actor flags). Every write is GM-only and
 * validated first, so bad data never reaches the flags.
 */
import { MODULE_ID, STATION_KEYS as K, STATIONS, WORKSHOP } from "../config.js";
import { partyCharacterIds } from "../party.js";
import { withLock } from "../queue/lock.js";
import { levelsOf, upgradePatch } from "../workshop/rules.js";
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
    partyStations: game.settings.get(MODULE_ID, WORKSHOP.partyStationsSetting) ?? [],
    partyIds: partyCharacterIds(),
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
    source: v.station.source,
    // Upgrades (the hearth count has NO EFFECT YET). A party-built workshop charges no station fee.
    upgrades: { craftDays: v.station.upgrades?.craftDays ?? 0, hearths: v.station.upgrades?.hearths ?? 0, hearthNote: WORKSHOP.hearthNote },
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

  await withLock(publicListKey, async () => {
    const list = (game.settings.get(MODULE_ID, K.stationStateSetting) ?? []).filter(e => e.stationId !== stationId);
    await game.settings.set(MODULE_ID, K.stationStateSetting, [...list, entry]);
  });
  return entry;
}

/** Remove a public station's state entry, making it public again. */
export async function clearStationState(stationId) {
  requireGM("clearStationState");
  await withLock(publicListKey, async () => {
    const list = game.settings.get(MODULE_ID, K.stationStateSetting) ?? [];
    await game.settings.set(MODULE_ID, K.stationStateSetting, list.filter(e => e.stationId !== stationId));
  });
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

// Upgrades and party workshops (Stage 10c) ---------------------------------------------------------------------------
const stationKey = id => `station:${id}`;
const partyListKey = "world:partyStations";
// Every public station shares ONE world setting, and every party workshop shares another: two different stations written
// at once would each read the old list and the later write would drop the earlier one. So the write also takes its list's lock.
const publicListKey = "world:stationState";
const readPartyList = () => structuredClone(game.settings.get(MODULE_ID, WORKSHOP.partyStationsSetting) ?? []);

/** Where a station is stored: { source, ... }, or null if there is no such station. */
function locate(api, stationId) {
  const station = readStations(api).stations.find(st => st.id === stationId);
  if (!station) return null;
  return { station };
}

/**
 * Apply a finished upgrade to a station (GM client). Under the station's lock: re-checks the station is still there and
 * still at the level the project started from, then writes ONE value (the world's station state, the owner's record, or
 * the party list). Returns an async undo() that puts the old value back.
 * @param {{ kind: "tier"|"craftDays"|"hearth", from: number, to: number }} upgrade
 */
export function applyStationUpgrade(api, stationId, { kind, from, to }) {
  requireGM("applyStationUpgrade");
  return withLock(stationKey(stationId), () => withLock(listKeyFor(api, stationId), async () => {
    const found = locate(api, stationId);
    if (!found) throw new Error(`the workshop "${stationId}" no longer exists`);
    const { station } = found;
    const level = levelsOf(station)[kind];
    if (level !== from) throw new Error(`${station.name} is at ${kind} level ${level} now, not ${from} as it was when this upgrade began`);
    const patch = upgradePatch(kind, to);
    const mergeUpgrades = base => ({ ...(base ?? {}), ...(patch.upgrades ?? {}) });

    if (station.source === "public") {
      const before = structuredClone(game.settings.get(MODULE_ID, K.stationStateSetting) ?? []);
      const existing = before.find(e => e.stationId === stationId) ?? { stationId, access: [] };
      const entry = { ...existing, ...(patch.tier ? { tier: patch.tier } : { upgrades: mergeUpgrades(existing.upgrades) }) };
      const errors = check(LIVE_SCHEMAS.stationState, entry);
      if (errors.length) throw new Error(`built an invalid station state: ${errors.map(e => `${e.field} ${e.message}`).join("; ")}`);
      await game.settings.set(MODULE_ID, K.stationStateSetting, [...before.filter(e => e.stationId !== stationId), entry]);
      return async () => { await game.settings.set(MODULE_ID, K.stationStateSetting, before); };
    }
    if (station.source === "owned") {
      const holder = [...game.actors].find(a => ownedOf(a).some(r => r.id === stationId));
      const before = structuredClone(ownedOf(holder));
      const record = before.find(r => r.id === stationId);
      const next = { ...record, ...(patch.tier ? { tier: patch.tier } : { upgrades: mergeUpgrades(record.upgrades) }) };
      const problems = validateOwnedRecord(next, holder.id, { towns: api.definitions?.town, config: STATIONS });
      if (problems.length) throw new Error(`the upgraded workshop would be invalid: ${problems.map(e => `${e.field} ${e.message}`).join("; ")}`);
      await holder.update({ [`flags.${MODULE_ID}.${K.actorStationsFlag}`]: before.map(r => (r.id === stationId ? next : r)) });
      return async () => { await holder.update({ [`flags.${MODULE_ID}.${K.actorStationsFlag}`]: before }); };
    }
    // a party workshop
    const before = readPartyList();
    const record = before.find(r => r.id === stationId);
    const next = { ...record, ...(patch.tier ? { tier: patch.tier } : { upgrades: mergeUpgrades(record.upgrades) }) };
    const errors = check(LIVE_SCHEMAS.partyStation, next);
    if (errors.length) throw new Error(`built an invalid party workshop: ${errors.map(e => `${e.field} ${e.message}`).join("; ")}`);
    await game.settings.set(MODULE_ID, WORKSHOP.partyStationsSetting, before.map(r => (r.id === stationId ? next : r)));
    return async () => { await game.settings.set(MODULE_ID, WORKSHOP.partyStationsSetting, before); };
  }));
}

/** The lock for the list a station is stored in (the actor's own flag is covered by the caller's actor lock). */
function listKeyFor(api, stationId) {
  const source = locate(api, stationId)?.station.source;
  return source === "public" ? publicListKey : source === "party" ? partyListKey : `station-record:${stationId}`;
}

/** Add a workshop the party built (GM client, under the list's lock). Returns an async undo(). */
export function addPartyStation(record) {
  requireGM("addPartyStation");
  return withLock(partyListKey, async () => {
    const errors = check(LIVE_SCHEMAS.partyStation, record);
    if (errors.length) throw new Error(`built an invalid party workshop: ${errors.map(e => `${e.field} ${e.message}`).join("; ")}`);
    const before = readPartyList();
    if (before.some(r => r.id === record.id)) throw new Error(`a party workshop "${record.id}" already exists`);
    await game.settings.set(MODULE_ID, WORKSHOP.partyStationsSetting, [...before, record]);
    return async () => { await game.settings.set(MODULE_ID, WORKSHOP.partyStationsSetting, before); };
  });
}

/** Can this character use the station at all (ignoring where it is)? Public stations: anyone; owned: owner or access list; party: the party. */
export function mayUse(station, actor) {
  if (station.owner === null) return true;
  return station.owner === actor.id || station.access.includes(actor.id);
}
