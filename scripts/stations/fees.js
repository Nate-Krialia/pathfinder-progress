/** Station fees: a pure function of the station's tier (config table). */
import { STATIONS } from "../config.js";

export function feeForTier(tier, config = STATIONS) {
  const fee = config.feeByTier[tier];
  if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) {
    throw new RangeError(`feeForTier: no fee configured for station tier ${tier} (check STATIONS.feeByTier)`);
  }
  return fee;
}
