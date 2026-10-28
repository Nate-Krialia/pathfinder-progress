/** Shared constants and tunable numbers for the downtime system. */
export const MODULE_ID = "pathfinder-progress";

export const TARGETS = {
  foundry: "14.369",
  pf2e: "8.6.1"
};

export const PACKS = {
  definitions: `${MODULE_ID}.definitions`,
  // Hidden from players' interface (an honor system: Foundry does not enforce read access). Players hold a display copy of a formula once they unlock it.
  recipes: `${MODULE_ID}.recipes`,
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
  thrifty: { enabled: false, refundFraction: 0.5 }
};

/** Stations (docs/07-stations.md). All numbers are placeholders. */
export const STATIONS = {
  // Fee in gold pieces, a pure function of the STATION's tier. Spent on every craft; not paid to the owner.
  feeByTier: { 1: 1, 2: 5, 3: 20, 4: 80, 5: 300 },
  // Highest tier a carried (portable) station may have.
  portableTierCap: 2
};

/** Item UUIDs: "Compendium.<package>.<pack>.Item.<16-char id>" or "Item.<16-char id>". */
export const ITEM_UUID_PATTERN = /^(Compendium\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.Item\.[A-Za-z0-9]{16}|Item\.[A-Za-z0-9]{16})$/;

/** Trait slugs used in "versus" predicates, e.g. "fiend". */
export const TRAIT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

/** World setting and actor flag names used by the station system. */
export const STATION_KEYS = {
  partyLocationSetting: "partyLocation",
  stationStateSetting: "stationState",
  actorLocationFlag: "location",
  actorStationsFlag: "stations"
};

/** Gathering (docs/04-gathering.md). All numbers are placeholders. */
export const GATHERING = {
  // Base DC by node tier. Each ladder rung's DC is this plus its dcOffset.
  // Tiers 1 to 3 are from the spec; 4 and 5 extend the pattern.
  baseDcByTier: { 1: 10, 2: 15, 3: 20, 4: 25, 5: 30 }
};

/** The token flag that holds a node record. */
export const NODE_FLAG = "node";

/** Research (docs/02-research.md). All numbers are placeholders. */
export const RESEARCH = {
  // By project tier: the DC is the recipe's level DC plus dcOffset; threshold is the progress needed.
  tiers: {
    1: { dcOffset: -2, threshold: 8 },
    2: { dcOffset: 0, threshold: 12 },
    3: { dcOffset: 2, threshold: 18 },
    4: { dcOffset: 4, threshold: 26 },
    5: { dcOffset: 6, threshold: 40 }
  },
  // Progress gained by one daily check, by degree of success.
  progressByDegree: { criticalSuccess: 2, success: 1, failure: 0, criticalFailure: 0 },
  // Progress LOST on a critical failure (never below 0). 0 = no setback.
  critFailureSetback: 0,
  // Newest log entries kept on a project.
  maxLog: 50
};

/** Actor flag names used by research. */
export const RESEARCH_KEYS = {
  projectsFlag: "projects",
  formulasFlag: "formulas",
  daysFlag: "downtimeDays"
};

/** The queue (docs/08-foundry-integration.md). */
export const QUEUE_KEYS = {
  pendingFlag: "pendingActions",
  autoOpenSetting: "autoOpenReview"
};

/**
 * The audit ledger: a WORLD setting that only a GM (a user allowed to modify settings) can
 * write. It records what the module itself granted, so a GM client can notice days or formulas
 * that changed some other way. It is an integrity check, not enforcement or secrecy.
 */
/** The GM review window. */
export const REVIEW = {
  // "Last results" keeps this many entries; older ones drop off.
  resultsMax: 30
};

export const AUDIT = {
  ledgerSetting: "auditLedger",
  historyMax: 20
};

/** Exploration (docs/05-exploration.md). All numbers are placeholders. */
export const EXPLORATION = {
  // Anchors activated by an expedition, by degree: rolled uniformly from min to max (inclusive).
  anchorCounts: {
    criticalSuccess: { min: 3, max: 5 },
    success: { min: 2, max: 4 },
    failure: { min: 1, max: 2 },
    criticalFailure: { min: 1, max: 1 }
  },
  // How many past expeditions a scene remembers.
  preparedLogMax: 10,
  sceneTagsFlag: "sceneTags",
  preparedFlag: "prepared",
  // A token still carrying this name is an untouched anchor; activation renames it after its nodeType.
  anchorName: "Anchor",
  // Foundry core icons (no art ships with the module). A nodeType can set its own `img`.
  anchorImg: "icons/svg/mystery-man.svg",
  defaultNodeImg: "icons/svg/item-bag.svg",
  // Random anchor placement keeps this many grid squares away from the scene edge.
  placePaddingSquares: 1
};

/** The shared neutral actor every placed node token is made from (found by flag, never by name). */
export const NODE_ACTOR = {
  flag: "nodeActor",
  setting: "nodeActorId",
  name: "Resource Node",
  img: "icons/svg/item-bag.svg"
};

/** Commissions (docs/06-commissions.md). All numbers are placeholders. */
export const COMMISSIONS = {
  settingKey: "commissions",
  // Gold value per unit of a material that has no `value` of its own, by tier (for suggested payouts).
  valueByTier: { 1: 5, 2: 25, 3: 100, 4: 400, 5: 1600 },
  // The suggested payout is (material value + station fee) plus this fraction.
  payoutMargin: 0.25,
  // Entries kept in a commission's movement log.
  logMax: 50
};
