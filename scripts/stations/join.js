/**
 * Joining the three places station data lives into one normalised list.
 * No Foundry globals (testable in Node).
 *
 *  - compendium `station` definitions: fixed facts (name, category, tier, town)
 *  - world `stationState` list:        owner / access / tier override for those
 *  - actor flags:                      player-owned workshops and carried kits
 *
 * A normalised station: { id, name, category, tier, location, owner, access, source }
 *   location: { type: "fixed", town } | { type: "carried", holder }
 *   source:   "public" | "owned"
 *
 * Problems are reported (never thrown) as { pack, entry, field, message }, the same
 * shape the definition loader uses, and the offending station is left OUT of the
 * list. A bad state entry removes its station entirely (fail closed) so a private
 * workshop can never fall back to being public.
 */
import { STATIONS } from "../config.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { resolveLayers } from "../data/resolver.js";

/**
 * Problems with ONE owned record (a workshop or carried kit stored on an actor).
 * @returns {Array<{field: string, message: string}>}
 */
export function validateOwnedRecord(record, actorId, { towns, config = STATIONS } = {}) {
  const schemaErrors = check(LIVE_SCHEMAS.stationRecord, record);
  if (schemaErrors.length) return schemaErrors;

  const errors = [];
  const { location } = record;
  if (record.owner !== undefined && record.owner !== actorId) {
    errors.push({ field: "owner", message: `must be the actor that stores it (${actorId}), not "${record.owner}"` });
  }
  if (location.type === "fixed") {
    if (record.owner === undefined) errors.push({ field: "owner", message: `is required for a fixed workshop (set it to ${actorId})` });
    if (towns && !towns.has(location.town)) {
      errors.push({ field: "location.town", message: `town "${location.town}" is not defined (known towns: ${[...towns.keys()].join(", ") || "none"})` });
    }
  } else {
    if (location.holder !== actorId) {
      errors.push({ field: "location.holder", message: `must be the actor carrying it (${actorId}), not "${location.holder}"` });
    }
    if (record.tier > config.portableTierCap) {
      errors.push({ field: "tier", message: `is ${record.tier}, which exceeds the portable station cap of ${config.portableTierCap}` });
    }
  }
  return errors;
}

/**
 * @param {object} args
 * @param {Map<string, object>} args.definitions   station definitions by id
 * @param {Map<string, object>} args.towns         town definitions by id
 * @param {Map<string, {pack: string, entry: string}>} [args.contexts]  where each definition came from
 * @param {object[]} args.stateEntries             the world stationState list
 * @param {Map<string, any>} args.ownedByActor     actorId -> the raw `stations` flag value
 * @param {(id: string) => boolean} [args.actorExists]
 * @param {(id: string) => string} [args.actorName]
 * @returns {{ stations: object[], errors: object[] }}
 */
export function buildStationList({
  definitions, towns, contexts, stateEntries = [], ownedByActor = new Map(),
  actorExists, actorName = id => id, config = STATIONS
}) {
  const errors = [];
  const stations = new Map();
  const fail = (pack, entry, field, message) => errors.push({ pack, entry, field, message });

  // 1. Public stations from the compendium.
  for (const def of definitions.values()) {
    const ctx = contexts?.get(def.id) ?? { pack: "(station definitions)", entry: def.id };
    if (!towns.has(def.town)) {
      fail(ctx.pack, ctx.entry, "town", `town "${def.town}" is not defined`);
      continue;
    }
    stations.set(def.id, {
      id: def.id, name: def.name, category: def.category, tier: def.tier,
      location: { type: "fixed", town: def.town }, owner: null, access: [], source: "public"
    });
  }

  // 2. World state: owner, access and tier override for public stations.
  const seenState = new Set();
  stateEntries.forEach((entry, i) => {
    const label = typeof entry?.stationId === "string" ? entry.stationId : `entry #${i}`;
    const pack = "(world setting: stationState)";
    const schemaErrors = check(LIVE_SCHEMAS.stationState, entry);
    if (schemaErrors.length) {
      for (const e of schemaErrors) fail(pack, label, e.field, e.message);
      if (stations.has(entry?.stationId)) stations.delete(entry.stationId); // fail closed
      return;
    }
    if (!definitions.has(entry.stationId)) {
      fail(pack, label, "stationId", `refers to unknown station "${entry.stationId}"`);
      return;
    }
    if (seenState.has(entry.stationId)) {
      fail(pack, label, "stationId", `appears more than once; the station is unusable until it has a single entry`);
      stations.delete(entry.stationId);
      return;
    }
    seenState.add(entry.stationId);

    const station = stations.get(entry.stationId);
    if (!station) return; // its definition was already rejected
    if (entry.owner && actorExists && !actorExists(entry.owner)) {
      fail(pack, label, "owner", `"${entry.owner}" is not an actor in this world; the station is unusable until fixed`);
      stations.delete(entry.stationId);
      return;
    }
    station.owner = entry.owner ?? null;
    station.access = [...entry.access];
    station.tier = resolveLayers([
      { source: "world state", value: entry.tier },
      { source: "definition", value: station.tier }
    ]).value;
  });

  // 3. Player-owned workshops and carried kits, from actor flags.
  for (const [actorId, raw] of ownedByActor) {
    const pack = `(actor: ${actorName(actorId)})`;
    if (!Array.isArray(raw)) {
      fail(pack, "stations flag", "(flag)", "must be a list of station records");
      continue;
    }
    raw.forEach((record, i) => {
      const label = typeof record?.id === "string" ? record.id : `record #${i}`;
      const recordErrors = validateOwnedRecord(record, actorId, { towns, config });
      if (recordErrors.length) {
        for (const e of recordErrors) fail(pack, label, e.field, e.message);
        return;
      }
      if (stations.has(record.id) || definitions.has(record.id)) {
        fail(pack, label, "id", `"${record.id}" is already used by another station (ids must be unique)`);
        return;
      }
      stations.set(record.id, {
        id: record.id, name: record.name, category: record.category, tier: record.tier,
        location: structuredClone(record.location), owner: record.owner ?? actorId,
        access: [...record.access], source: "owned"
      });
    });
  }

  return { stations: [...stations.values()], errors };
}
