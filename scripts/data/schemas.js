/**
 * Record schemas, one per record shape in docs/01-data-model.md.
 *
 * DEFINITIONS live in compendium Journal entries (parsed from a JSON block).
 * LIVE records live in flags / world settings and are validated when written.
 * Shapes are "indicative" in the spec; anything it leaves open is noted inline
 * and should be tightened as the owning stage is built.
 */
import { ID_PATTERN, QUANTITY_PATTERN, ROLE_ID_PATTERN, TIER_RANGES } from "../config.js";
import { arr, bool, effect, int, num, obj, oneOf, optional, record, str, variant, any } from "./schema.js";

const idField = () => str({ pattern: ID_PATTERN, patternHint: "must be a lowercase slug (letters, digits, - or _)" });
const tier = range => int({ min: range.min, max: range.max });
const quantity = () => str({ pattern: QUANTITY_PATTERN, patternHint: 'must be a number or dice like "3" or "1d4"' });
const kind = name => oneOf([name]);

/** Built-in role vocabulary, by recipe category (docs/01-data-model.md). */
export const BUILT_IN_ROLES = {
  weapon: ["basePower", "bonusDamage", "specialAbility"],
  armor: ["basePower", "resistance", "specialAbility"],
  robes: ["basePower", "resistance", "specialAbility"],
  focus: ["spellPower", "spellSlots", "specialAbility"]
};

// Definitions -----------------------------------------------------------------
const material = obj({
  kind: kind("material"),
  id: idField(),
  name: str(),
  tier: tier(TIER_RANGES.material),
  // Stage 1 accepts number | tier ("T2") | string; tightened in Stage 2.
  effects: record(effect())
});

const recipe = obj({
  kind: kind("recipe"),
  id: idField(),
  name: str(),
  category: str(),
  // Assumed to be a PF2e item UUID (the spec does not define it).
  itemTemplate: str({ pattern: /^(Compendium|Item)\./, patternHint: 'must be an item UUID starting "Compendium." or "Item."' }),
  slots: arr(obj({
    name: str(),
    drives: str(),
    tierFloor: tier(TIER_RANGES.material),
    qty: int({ min: 1 })
  }), {
    min: 1,
    refine(slots, path, errors) {
      const seen = new Set();
      slots.forEach((slot, i) => {
        if (seen.has(slot.name)) errors.push({ field: `${path}[${i}].name`, message: `duplicate slot name "${slot.name}"` });
        seen.add(slot.name);
      });
    }
  }),
  overrides: optional(arr(obj({ materialId: idField(), slot: str(), effect: effect() }))),
  stationCategory: str(),
  stationTierMin: tier(TIER_RANGES.station),
  skillWhitelist: arr(str(), { min: 1 }),
  researchProject: obj({ tier: tier(TIER_RANGES.research) }, { extra: true })
});

const region = obj({
  kind: kind("region"),
  id: idField(),
  sceneTag: str(),
  // nodeType is not defined by the spec; treated as a free string for now.
  spawnTable: arr(obj({ nodeType: str(), weight: num({ min: 0 }) }), { min: 1 }),
  explorationDC: int({ min: 1 }),
  daysRequired: int({ min: 1 })
});

// The spec names the override but not its shape; this is the minimal sensible one.
const creatureYield = obj({
  kind: kind("creatureYield"),
  id: idField(),
  creature: str(),
  yield: arr(obj({ materialId: idField(), quantity: quantity() }), { min: 1 })
});

const customRole = obj({
  kind: kind("customRole"),
  id: str({ pattern: ROLE_ID_PATTERN, patternHint: 'must be camelCase like "weaponSheen"' }),
  appliesTo: arr(str(), { min: 1 }),
  // The spec requires rejection on load if `modifies` is missing.
  modifies: str(),
  effect: effect()
});

// Public/fixed stations: fixed facts only. Owner/access live in the world list.
const stationDef = obj({
  kind: kind("station"),
  id: idField(),
  name: str(),
  category: str(),
  tier: tier(TIER_RANGES.station),
  town: str()
});

export const DEFINITION_SCHEMAS = { material, recipe, region, creatureYield, customRole, station: stationDef };

// Live records ----------------------------------------------------------------
const ladderRung = obj({
  materialId: idField(),
  dcOffset: int(),
  quantity: quantity(),
  guaranteed: optional(bool())
});

const node = obj({
  id: str(),
  source: oneOf(["explored", "placed", "corpse"]),
  tier: tier(TIER_RANGES.node),
  region: optional(str()),
  charges: int({ min: 0 }),
  discoveredBy: arr(str()),
  state: oneOf(["anchor", "active", "depleted"]),
  ladder: arr(ladderRung),
  decayTimer: optional(num({ min: 0 }))
}, {
  refine(value, path, errors) {
    if (value.source === "corpse" && value.decayTimer === undefined) {
      errors.push({ field: "decayTimer", message: 'is required when source is "corpse"' });
    }
    if (value.source !== "corpse" && value.decayTimer !== undefined) {
      errors.push({ field: "decayTimer", message: 'only applies when source is "corpse"' });
    }
  }
});

const project = obj({
  id: str(),
  owner: str(),
  outcome: variant("type", {
    unlockFormula: { formulaId: idField() },
    upgradeStation: { stationId: str(), fromTier: tier(TIER_RANGES.station), toTier: tier(TIER_RANGES.station) }
  }),
  tier: tier(TIER_RANGES.research),
  dc: int(),
  threshold: int({ min: 1 }),
  progress: int({ min: 0 }),
  skillWhitelist: arr(str(), { min: 1 }),
  materials: optional(arr(obj({ materialId: idField(), qty: int({ min: 1 }) }))),
  fee: optional(num({ min: 0 })),
  status: str()
});

// A full station record (player-owned, or the live form of a public one).
const stationRecord = obj({
  id: str(),
  name: str(),
  category: str(),
  tier: tier(TIER_RANGES.station),
  location: variant("type", { fixed: { town: str() }, carried: { holder: str() } }),
  owner: optional(str()),
  access: arr(str())
});

// World-level list entry holding owner/access for a public station definition.
const stationAccess = obj({
  stationId: idField(),
  owner: optional(str()),
  access: arr(str())
});

const commission = obj({
  id: str(),
  patron: variant("type", { actor: { actorId: str() }, lightweight: { name: str() } }),
  crafter: str(),
  formulaId: idField(),
  itemSpec: any(),
  status: str(),
  materialsFrom: oneOf(["npc", "crafter"]),
  payout: num({ min: 0 }),
  teaches: variant("type", { none: {}, progress: { amount: int({ min: 1 }) }, fullCopy: {} }),
  formulaAccess: oneOf(["loan", "copy"])
});

const pendingAction = obj({
  id: str(),
  actor: str(),
  // The spec leaves this list open ("..."); extend it as later stages add action types.
  type: oneOf(["research", "explore", "upgrade", "commissionStep"]),
  params: any(),
  daysReserved: int({ min: 0 }),
  submittedAt: num({ min: 0 })
});

export const LIVE_SCHEMAS = { node, project, stationRecord, stationAccess, commission, pendingAction };

export const DEFINITION_KINDS = Object.keys(DEFINITION_SCHEMAS);
