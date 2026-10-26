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

/** Craft DCs come from recipe.craftLevel (0 to 25) via the PF2e level-DC table. */
export const CRAFT_LEVEL_RANGE = { min: 0, max: 25 };

/** Roles that exactly one slot may drive; they pick which output item is made. */
export const SINGLE_SLOT_ROLES = ["basePower", "spellPower"];

/** Which role picks the output tier, by recipe category. A recipe may override with `baseRole`. */
export const BASE_ROLE_BY_CATEGORY = {
  weapon: "basePower",
  armor: "basePower",
  robes: "basePower",
  focus: "spellPower"
};

/** Crafting tunables (placeholders). */
export const CRAFTING = {
  // Percent chance that one material unit is lost on a failed craft (1 to 100 on a d100).
  lossChance: 50,
  // "Thrifty craft" is UNCONFIRMED in the spec, so it ships off.
  thrifty: { enabled: false, refundFraction: 0.5 },
  // Fixed fee in gold pieces until stations (Stage 3) set it by tier.
  stubFeeGp: 1
};

/** Item UUIDs: "Compendium.<package>.<pack>.Item.<16-char id>" or "Item.<16-char id>". */
export const ITEM_UUID_PATTERN = /^(Compendium\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.Item\.[A-Za-z0-9]{16}|Item\.[A-Za-z0-9]{16})$/;

/** Trait slugs used in "versus" predicates, e.g. "fiend". */
export const TRAIT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
