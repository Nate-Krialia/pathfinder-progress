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
  daysFlag: "downtimeDays",
  leadsFlag: "leads"
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
  placePaddingSquares: 1,
  // An expedition lasts at least the region's daysRequired and at most this many days.
  maxDays: 10,
  // Chance of an encounter, rolled ONCE per expedition, by the region's danger. forceCombat makes it certain.
  encounterChance: { low: 0.2, moderate: 0.35, high: 0.5 },
  // Perception DC to spot a hidden node, by the node's tier.
  perceptionDcByTier: { 1: 14, 2: 17, 3: 20, 4: 24, 5: 28 },
  // GM-only per-scene state (encounter, searches, revealed nodes, expedition log): a world setting keyed by scene id.
  stateSetting: "explorationState"
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

/** Downtime periods (docs/11-hub-design.md). */
export const DOWNTIME = {
  stateSetting: "downtime",
  // A period grants at least 1 and at most this many days.
  maxDays: 30,
  logMax: 50,
  // Plain-language reasons shown to players.
  reasons: {
    closed: "Downtime isn't open right now",
    notParticipant: "Downtime is open, but you weren't here for it"
  }
};

/** Craft time (placeholders; workshop upgrades will supply the reductions later). */
export const CRAFT_DAYS = {
  // A craft takes 1 day, plus 1 more for every `levelsPerExtraDay` levels of the recipe.
  baseDays: 1,
  levelsPerExtraDay: 2,
  // No reduction can take a craft below this many days.
  minDays: 1
};

/**
 * Workshops (docs/10, Stage 10c). All numbers are placeholders for Stage 12.
 * Upgrade kinds: "tier" (raise the station's tier), "craftDays" (cut craft days), "hearth" (a counter; NO EFFECT YET).
 */
export const WORKSHOP = {
  // Highest tier a town (fixed) station can reach. A carried kit is capped by STATIONS.portableTierCap.
  townTierCap: 4,
  // Highest level of the other two upgrade kinds.
  maxLevel: { craftDays: 3, hearth: 3 },
  // The skill(s) an upgrade or design project may be researched with.
  researchSkills: ["crafting"],
  // The research DC of a project is the PF2e level DC of this level (by the target tier) plus the research tier's offset.
  levelByTier: { 1: 1, 2: 3, 3: 6, 4: 9, 5: 12 },
  // Units of materials of the TARGET tier an upgrade holds in escrow, by target tier. No gold.
  upgradeUnits: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 },
  // Stored in a station's `owner` field for a party-owned workshop (the access list holds the party's characters).
  partyOwner: "party",
  partyStationsSetting: "partyStations",
  // Said wherever the hearth counter is shown, so nobody mistakes it for a working feature.
  hearthNote: "no effect yet"
};

/** The per-character Compendium (docs/10, Stage 10b). */
export const COMPENDIUM = {
  flag: "compendium",
  version: 1,
  sharedSetting: "sharedCompendium",
  // Entries shared with the whole party are kept in this order.
  categories: ["materials", "creatures", "regions", "experiments"]
};

/** Stage 16: what a player client loads, and when it asks the GM again (docs/10, docs/08). */
export const DEFINITIONS_SYNC = {
  // A world setting the GM bumps whenever the definitions are reloaded; every player client refreshes when it changes.
  revisionSetting: "definitionsRevision",
  debounceMs: 300,
  socketHandler: "definitionsFor"
};

/** Stage 10d (docs/11b, B): the Experiments knowledge category. */
export const EXPERIMENTS = {
  // Crafting from a LOANED formula teaches the crafter. Does the formula's owner learn too? Proposal: no.
  ownerLearnsFromLoan: false
};

/** The GM's resolve log: memory only on the GM's client, never saved (docs/11b, Stage 11a). Players never get a chat message with a DC or a roll. */
export const GM_LOG = {
  maxEntries: 200,
  changedHook: "pfpGmLogChanged"
};

/** The Downtime Hub window (Stage 11a, docs/11-hub-design.md + 11b). Tunables for the window; the words live in hub/strings.js. */
export const HUB = {
  tabs: [
    { id: "formulae", label: "Formulae", working: true },
    { id: "research", label: "Research", working: true },
    { id: "commissions", label: "Commissions", working: false },
    { id: "explore", label: "Explore", working: false },
    { id: "workshop", label: "Workshop", working: false },
    { id: "compendium", label: "Compendium", working: true }
  ],
  // Filter chips on the Formulae list. A recipe whose category is in none of them shows under All only.
  filters: [
    { id: "all", label: "All", categories: null },
    { id: "weapon", label: "Weapon", categories: ["weapon"] },
    { id: "armor", label: "Armor", categories: ["armor", "robes"] },
    { id: "consumable", label: "Consumable", categories: ["consumable"] }
  ],
  sizeSetting: "hubWindow",          // client setting: { left, top, width, height }
  displaySetting: "hubDisplay",      // client setting: { textSize, theme, font }
  defaultSize: { width: 940, height: 680 },
  minSize: { width: 300, height: 420 },   // the stylesheet's .pfp-hub-window min-width must equal this (a test checks); ApplicationV2 has no min-size option, it reads the CSS
  stackBelowPx: 700,                 // the two panes stack when the window is narrower than this
  liveDebounceMs: 150,
  saveDebounceMs: 400,
  statusMs: 10000,                   // how long the visible "Craft queued" / "Cancelled" line stays (it also goes as soon as it stops being true)
  keysKeptInside: ["Tab", "Enter", " "],   // Foundry's KeyboardManager cancels these before the browser can act; the Hub stops them reaching it (never preventDefault)
  textSizes: [100, 125, 150, 175],   // percent
  themes: ["parchment", "dark", "contrast"],
  fonts: ["standard", "hyperlegible"],
  defaultDisplay: { textSize: 100, theme: "parchment", font: "standard" },
  basePx: 14,                        // the window's text size at 100%; every size in the stylesheet is in em of this
  // The Research and Compendium tabs (Stage 11b round).
  research: { maxStepBoxes: 20, recentChecks: 5, leadNoteMax: 300 },
  minTarget: 44                      // px: the smallest a clickable control may be (the stylesheet and the layout checks both use it)
};
