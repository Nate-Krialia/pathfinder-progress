/**
 * Which stations can a crafter use right now? No Foundry globals (testable in Node).
 *
 * There is no map: a crafter's location is a town id (or none). It is the actor's
 * own override if set, otherwise the party location, otherwise nowhere.
 */
import { resolveLayers } from "../data/resolver.js";

/** The town an actor is in, or null. Actor override > party location > nowhere. */
export function effectiveTown(actorId, { actorOverrides = {}, partyTown } = {}) {
  const result = resolveLayers([
    { source: "actor", value: actorOverrides[actorId] || undefined },
    { source: "party", value: partyTown || undefined }
  ]);
  return result ? result.value : null;
}

/**
 * Reachability only (location and access), independent of any recipe.
 * @param {object} args
 * @param {string} args.crafterId
 * @param {object[]} args.stations     normalised stations
 * @param {(actorId: string) => string|null} args.townOf
 * @param {(townId: string) => string} [args.townName]
 * @param {(actorId: string) => string} [args.nameOf]
 * @returns {Array<{ station: object, reachable: boolean, reason: string }>}
 */
export function evaluateStations({ crafterId, stations, townOf, townName = id => id, nameOf = id => id }) {
  const where = town => (town ? townName(town) : "nowhere (no location set)");
  const here = townOf(crafterId);

  return stations.map(station => {
    const verdict = (reachable, reason) => ({ station, reachable, reason });
    const { location } = station;

    if (location.type === "fixed") {
      if (here !== location.town) {
        return verdict(false, `you are in ${where(here)}, but it is in ${townName(location.town)}`);
      }
      if (station.owner === null || station.owner === crafterId || station.access.includes(crafterId)) {
        return verdict(true, "reachable");
      }
      return verdict(false, `you are not on its access list (owner: ${nameOf(station.owner)})`);
    }

    // carried
    if (location.holder === crafterId) return verdict(true, "reachable (you carry it)");
    if (!station.access.includes(crafterId)) {
      return verdict(false, `it is carried by ${nameOf(location.holder)} and you are not on its access list`);
    }
    const holderTown = townOf(location.holder);
    if (holderTown !== here) {
      return verdict(false, `its holder ${nameOf(location.holder)} is in ${where(holderTown)}, and you are in ${where(here)}`);
    }
    return verdict(true, `reachable (carried by ${nameOf(location.holder)})`);
  });
}

/**
 * Add the recipe's requirements (category, then tier) to reachability verdicts.
 * @returns {Array<{ station: object, reachable: boolean, usable: boolean, reason: string }>}
 */
export function evaluateForRecipe(verdicts, recipe) {
  return verdicts.map(({ station, reachable, reason }) => {
    if (!reachable) return { station, reachable, usable: false, reason };
    if (station.category !== recipe.stationCategory) {
      return { station, reachable, usable: false, reason: `it is a ${station.category} station, but the recipe needs ${recipe.stationCategory}` };
    }
    if (station.tier < recipe.stationTierMin) {
      return { station, reachable, usable: false, reason: `its tier ${station.tier} is below the recipe's minimum of ${recipe.stationTierMin}` };
    }
    return { station, reachable, usable: true, reason: "usable" };
  });
}

/**
 * Choose the station for a craft. Never guesses: with several usable stations the
 * caller must name one.
 * @returns {{ ok: true, station: object } | { ok: false, errors: string[] }}
 */
export function selectStation({ verdicts, recipe, requestedId }) {
  if (requestedId) {
    const verdict = verdicts.find(v => v.station.id === requestedId);
    if (!verdict) {
      return { ok: false, errors: [`unknown station "${requestedId}" (known: ${verdicts.map(v => v.station.id).join(", ") || "none"})`] };
    }
    if (!verdict.usable) {
      return { ok: false, errors: [`station "${verdict.station.name}" cannot be used for this recipe: ${verdict.reason}`] };
    }
    return { ok: true, station: verdict.station };
  }

  const usable = verdicts.filter(v => v.usable);
  if (usable.length === 1) return { ok: true, station: usable[0].station };
  if (usable.length > 1) {
    const list = usable.map(v => `${v.station.name} (id "${v.station.id}", tier ${v.station.tier})`).join(", ");
    return { ok: false, errors: [`several stations are usable: ${list}; choose one with station: "<id>"`] };
  }

  if (verdicts.length === 0) return { ok: false, errors: ["no stations are defined"] };
  const why = verdicts.map(v => `${v.station.name}: ${v.reason}`).join("; ");
  return { ok: false, errors: [`no usable ${recipe.stationCategory} station (tier ${recipe.stationTierMin}+): ${why}`] };
}
