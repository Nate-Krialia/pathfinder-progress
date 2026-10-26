/**
 * Record schemas, one per record shape in docs/01-data-model.md.
 *
 * DEFINITIONS live in compendium Journal entries (parsed from a JSON block).
 * LIVE records live in flags / world settings and are validated when written.
 * Shapes are "indicative" in the spec; anything it leaves open is noted inline
 * and should be tightened as the owning stage is built.
 */
import { CRAFT_LEVEL_RANGE, ID_PATTERN, ITEM_UUID_PATTERN, QUANTITY_PATTERN, ROLE_ID_PATTERN, TIER_RANGES } from "../config.js";
import { looksLikeUuid } from "./outputRefs.js";
import { validateLadder } from "../gathering/ladder.js";
import { isSkillSlug } from "../adapter/pf2e.js";
import { any, arr, bool, int, num, obj, oneOf, optional, record, scalar, str, union, variant } from "./schema.js";
export { BUILT_IN_ROLES } from "./roles.js";

const idField = () => str({ pattern: ID_PATTERN, patternHint: "must be a lowercase slug (letters, digits, - or _)" });
const tier = range => int({ min: range.min, max: range.max });
const quantity = () => str({ pattern: QUANTITY_PATTERN, patternHint: 'must be a number or dice like "3" or "1d4"' });
const kind = name => oneOf([name]);

// Definitions -----------------------------------------------------------------
const material = obj({
  kind: kind("material"),
  id: idField(),
  name: str(),
  tier: tier(TIER_RANGES.material),
  // role -> value. The value shape depends on the role (see roles.js), so it is
  // checked in validate.js once custom roles are known.
  effects: record(any()),
  // Percent chance a unit is lost on a failed craft; beats the global default.
  lossChance: optional(int({ min: 0, max: 100 }))
});

const OUTPUT_KEY = /^([1-9]\d*|default)$/;

const recipe = obj({
  kind: kind("recipe"),
  id: idField(),
  name: str(),
  category: str(),
  // Output item by tier: { "1": ref, "2": ref }, or { "default": ref } when no role picks the tier.
  // A ref is an item name ("Dagger"), "Pack: Name", or a full UUID. Names are
  // resolved against the item packs at ready time (see data/outputRefs.js).
  output: record(str({
    refine(value, path, errors) {
      if (looksLikeUuid(value) && !ITEM_UUID_PATTERN.test(value.trim())) {
        errors.push({ field: path, message: `looks like an item UUID but is malformed (expected "Compendium.<package>.<pack>.Item.<16-character id>"); to reference an item by name, write just the name` });
      }
    }
  }), {
    refine(value, path, errors) {
      const keys = Object.keys(value);
      if (keys.length === 0) errors.push({ field: path, message: "must have at least one entry" });
      for (const key of keys) {
        if (!OUTPUT_KEY.test(key)) {
          errors.push({ field: `${path}.${key}`, message: 'key must be a tier number like "2", or "default"' });
        } else if (key !== "default" && (Number(key) < TIER_RANGES.material.min || Number(key) > TIER_RANGES.material.max)) {
          errors.push({ field: `${path}.${key}`, message: `tier must be between ${TIER_RANGES.material.min} and ${TIER_RANGES.material.max}` });
        }
      }
    }
  }),
  // Which role picks the output tier. Defaults by category (weapon/armor: basePower, focus: spellPower).
  baseRole: optional(oneOf(["basePower", "spellPower"])),
  // Craft DC = PF2e level DC for this level. Material quality never changes it.
  craftLevel: int({ min: CRAFT_LEVEL_RANGE.min, max: CRAFT_LEVEL_RANGE.max }),
  // Optional fixed name for the crafted item; defaults to the base item's name.
  resultName: optional(str()),
  // Removed in Stage 2; kept only to give a helpful error.
  itemTemplate: optional(any({
    refine(value, path, errors) {
      errors.push({ field: path, message: 'was replaced by "output" (a map of tier to item UUID)' });
    }
  })),
  slots: arr(obj({
    name: str(),
    // One role, or several (e.g. a spider fang can drive bonusDamage AND specialAbility).
    drives: union([str(), arr(str(), { min: 1 })], { hint: "must be a role name or a non-empty list of role names" }),
    tierFloor: tier(TIER_RANGES.material),
    qty: int({ min: 1 }),
    lossChance: optional(int({ min: 0, max: 100 }))
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
  // `role` is only needed when the slot drives more than one role.
  overrides: optional(arr(obj({ materialId: idField(), slot: str(), role: optional(str()), effect: any() }))),
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
  // The spec requires rejection on load if `modifies` is missing. Only item
  // fields under system.* may be modified, and never system.rules.
  modifies: str({
    pattern: /^system\.(?!rules(\.|$))[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/,
    patternHint: 'must be an item field path like "system.bulk.value" (never system.rules)',
    refine(value, path, errors) {
      if (value.split(".").some(segment => ["__proto__", "constructor", "prototype"].includes(segment))) {
        errors.push({ field: path, message: "may not contain __proto__, constructor or prototype" });
      }
    }
  }),
  effect: scalar()
});

// A named place. Stations refer to towns by id so a typo fails loudly.
const town = obj({
  kind: kind("town"),
  id: idField(),
  name: str()
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

// Gathering ------------------------------------------------------------------------
const ladderRung = obj({
  materialId: idField(),
  dcOffset: int(),
  quantity: quantity(),
  guaranteed: optional(bool())
});

/** A ladder: rungs with exactly one guaranteed base rung that is the easiest. */
const ladderSpec = arr(ladderRung, {
  min: 1,
  refine(rungs, path, errors) {
    for (const e of validateLadder(rungs)) errors.push({ field: `${path}${e.field}`, message: e.message });
  }
});

// A kind of gathering node (herb, ore, corpse, ...): which skills may gather it and its default ladders by tier.
const nodeType = obj({
  kind: kind("nodeType"),
  id: idField(),
  name: str(),
  skills: arr(str(), {
    min: 1,
    refine(skills, path, errors) {
      skills.forEach((skill, i) => {
        if (!isSkillSlug(skill)) errors.push({ field: `${path}[${i}]`, message: `"${skill}" is not a PF2e skill (use a slug like "nature", or "<name>-lore")` });
      });
    }
  }),
  // Charges a new node of this type starts with.
  charges: int({ min: 1 }),
  // Ladders by node tier: { "1": [rungs], "2": [rungs] }. A type may have none (a corpse brings its own).
  ladders: optional(record(ladderSpec, {
    refine(value, path, errors) {
      for (const key of Object.keys(value)) {
        if (!/^[1-9]\d*$/.test(key) || Number(key) < TIER_RANGES.node.min || Number(key) > TIER_RANGES.node.max) {
          errors.push({ field: `${path}.${key}`, message: `key must be a node tier from ${TIER_RANGES.node.min} to ${TIER_RANGES.node.max}` });
        }
      }
    }
  }))
});

export const DEFINITION_SCHEMAS = { material, recipe, region, creatureYield, customRole, town, station: stationDef, nodeType };

// Live records ----------------------------------------------------------------
// A gathering node, stored in a token flag. The token is its identity.
const node = obj({
  source: oneOf(["explored", "placed", "corpse"]),
  state: oneOf(["anchor", "active", "depleted"]),
  // Required once the node is active or depleted; absent on an anchor.
  nodeType: optional(idField()),
  tier: optional(tier(TIER_RANGES.node)),
  charges: optional(int({ min: 0 })),
  region: optional(str()),
  discoveredBy: arr(str()),
  // An override of the nodeType's ladder for this tier. Required for corpses.
  ladder: optional(ladderSpec),
  decayTimer: optional(num({ min: 0 }))
}, {
  refine(value, path, errors) {
    const problem = (field, message) => errors.push({ field, message });
    const isCorpse = value.source === "corpse";

    if (value.state === "anchor") {
      if (isCorpse) problem("source", 'a corpse cannot be an anchor');
      for (const field of ["nodeType", "tier", "charges", "ladder", "decayTimer"]) {
        if (value[field] !== undefined) problem(field, "must not be set on an anchor (activate it first)");
      }
    } else {
      for (const field of ["nodeType", "tier", "charges"]) {
        if (value[field] === undefined) problem(field, `is required once a node is ${value.state}`);
      }
      if (value.charges !== undefined) {
        if (value.state === "depleted" && value.charges !== 0) problem("charges", `must be 0 when the node is depleted (got ${value.charges})`);
        if (value.state === "active" && value.charges < 1) problem("charges", 'must be at least 1 when the node is active (a node with 0 charges is "depleted")');
      }
    }

    if (isCorpse) {
      if (value.decayTimer === undefined) problem("decayTimer", 'is required when source is "corpse"');
      if (value.state !== "anchor" && value.ladder === undefined) problem("ladder", 'is required when source is "corpse" (a corpse brings its own ladder)');
    } else if (value.decayTimer !== undefined) {
      problem("decayTimer", 'only applies when source is "corpse"');
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

// World-level state for a public station definition: who owns it, who may use it,
// and (for Stage 9 upgrades) a tier that overrides the read-only compendium's.
const stationState = obj({
  stationId: idField(),
  owner: optional(str()),
  access: arr(str()),
  tier: optional(tier(TIER_RANGES.station))
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

export const LIVE_SCHEMAS = { node, project, stationRecord, stationState, commission, pendingAction };

export const DEFINITION_KINDS = Object.keys(DEFINITION_SCHEMAS);
