/** Station fees: a pure function of the station's tier (config table). */
import { STATIONS } from "../config.js";

/** The fee for a normalised station: a workshop the party built charges none, every other station its tier's fee. The ONE rule (plan.js and the Hub use it). */
export function feeForStation(station, config = STATIONS) {
  return station.source === "party" ? 0 : feeForTier(station.tier, config);
}

export function feeForTier(tier, config = STATIONS) {
  const fee = config.feeByTier[tier];
  if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) {
    throw new RangeError(`feeForTier: no fee configured for station tier ${tier} (check STATIONS.feeByTier)`);
  }
  return fee;
}
