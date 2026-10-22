/** Shared constants and tunable numbers for the downtime system. */
export const MODULE_ID = "pathfinder-progress";

export const TARGETS = {
  foundry: "14.369",
  pf2e: "8.6.1"
};

export const PACKS = {
  definitions: `${MODULE_ID}.definitions`,
  crafted: `${MODULE_ID}.crafted-items`
};

/** Inclusive tier ranges per record kind. Placeholders; tune freely. */
export const TIER_RANGES = {
  material: { min: 1, max: 5 },
  node: { min: 1, max: 5 },
  station: { min: 1, max: 5 },
  research: { min: 1, max: 5 }
};

/** Definition ids: lowercase slug, e.g. "silver" or "longsword-basic". */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Custom role ids are camelCase like the built-in roles, e.g. "weaponSheen". */
export const ROLE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** Dice expressions allowed for node/ladder quantities: "3", "1d4", "2d6+1". */
export const QUANTITY_PATTERN = /^(\d+|\d*d\d+([+-]\d+)?)$/;
