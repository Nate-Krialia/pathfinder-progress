/**
 * Record schemas, one per record shape in docs/01-data-model.md.
 *
 * DEFINITIONS live in compendium Journal entries (parsed from a JSON block).
 * LIVE records live in flags / world settings and are validated when written.
 * Shapes are "indicative" in the spec; anything it leaves open is noted inline
 * and should be tightened as the owning stage is built.
 */
import { CRAFT_LEVEL_RANGE, DISCOVERY, ID_PATTERN, ITEM_UUID_PATTERN, QUANTITY_PATTERN, ROLE_ID_PATTERN, TIER_RANGES } from "../config.js";
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
// A research TRACK (Stage 11c): milestones in the order they are reached. GM-only data: it is never sent to players (stripForPlayer).
const milestone = obj({ steps: int({ min: 1 }), grants: variant("type", { properties: {}, formula: { recipeId: optional(idField()) } }) });
const track = obj({
  milestones: arr(milestone, {
    min: 1,
    refine(milestones, path, errors) {
      if (milestones.length > DISCOVERY.maxMilestones) errors.push({ field: path, message: `can have at most ${DISCOVERY.maxMilestones} milestones (got ${milestones.length})` });
      milestones.forEach((m, i) => {
        if (i > 0 && !(m.steps > milestones[i - 1].steps)) errors.push({ field: `${path}[${i}].steps`, message: `must be more than the milestone before it (${milestones[i - 1].steps})` });
      });
      if (milestones.filter(m => m.grants?.type === "properties").length > 1) errors.push({ field: path, message: 'can have only one "properties" milestone' });
    }
  })
});

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
  ,
  // Gold value per unit: what a shop would price it by and what a commission payout is suggested from. Defaults by tier (COMMISSIONS.valueByTier) at load.
  value: optional(num({ min: 0 })),
  // The tag carries a THEME (a "tag" definition). Reaching the properties milestone teaches the player the tag and its theme in plain words.
  tag: optional(idField()),
  // How the material behaves in one ITEM CLASS (a recipe category): role -> value. Beats `effects` for that class; a recipe override beats both.
  classEffects: optional(record(record(any()))),
  // Optional research track: without one the material has no study, its tag and theme are known on pickup.
  research: optional(track)
});

// A tag: the theme a family of materials shares ("Mitflit parts: cowardice, which works with frightened").
const tagDef = obj({ kind: kind("tag"), id: idField(), name: str(), theme: str(), worksWith: optional(str()) });

// A note: a Foundry item (flag `note`) that points at a formula. With a research track it offers a lead; without one it does nothing.
const noteDef = obj({ kind: kind("note"), id: idField(), name: str(), recipeId: idField(), research: optional(track) });

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
  researchProject: obj({ tier: tier(TIER_RANGES.research) }, { extra: true }),
  // A formula FAMILY and VERSION (Stage 11c). Version 1 is the first; a higher version needs the previous version's formula and `requiresCount` distinct
  // materials with `requiresTag` whose properties are known (default: the version number). Material tier and formula version are separate axes.
  family: optional(idField()),
  version: optional(int({ min: 1 })),
  requiresTag: optional(idField()),
  requiresCount: optional(int({ min: 2 })),
  research: optional(track)
});

// The fields of a region that a player's copy keeps (see PLAYER_SCHEMAS). The GM's copy adds the spawn table and the DC.
const regionPlayerFields = {
  kind: kind("region"),
  id: idField(),
  name: str(),
  sceneTag: str(),
  // The skills that may make the exploration check.
  skillWhitelist: arr(str(), {
    min: 1,
    refine(skills, path, errors) {
      skills.forEach((skill, i) => {
        if (!isSkillSlug(skill)) errors.push({ field: `${path}[${i}]`, message: `"${skill}" is not a PF2e skill (use a slug like "survival", or "<name>-lore")` });
      });
    }
  }),
  daysRequired: int({ min: 1 }),
  // How dangerous the region is. Players see the label (later, in the Hub); the encounter chance behind it stays with the GM.
  danger: optional(oneOf(["low", "moderate", "high"]))
};

const region = obj({
  ...regionPlayerFields,
  // Each activated anchor rolls this table: a node type and tier, chosen by weight.
  // That the nodeType exists and has a ladder for the tier is checked against the loaded definitions.
  spawnTable: arr(obj({ nodeType: idField(), tier: tier(TIER_RANGES.node), weight: num({ min: 0 }) }), {
    min: 1,
    refine(entries, path, errors) {
      if (!entries.some(e => e.weight > 0)) errors.push({ field: path, message: "needs at least one entry with a weight above 0" });
      const seen = new Set();
      entries.forEach((e, i) => {
        const key = `${e.nodeType}/${e.tier}`;
        if (seen.has(key)) errors.push({ field: `${path}[${i}]`, message: `repeats nodeType "${e.nodeType}" at tier ${e.tier}; merge the weights into one entry` });
        seen.add(key);
      });
    }
  }),
  explorationDC: int({ min: 1 })
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

// A workshop blueprint: what it takes to BUILD a party-owned workshop (docs/10, Stage 10c). The design is researched first.
const blueprint = obj({
  kind: kind("blueprint"),
  id: idField(),
  name: str(),
  // The station category it provides ("smithing", "alchemy", ...) and the tier it is built at.
  category: str(),
  tier: tier(TIER_RANGES.station),
  // Materials: any material of at least the floor's tier fills a slot, one material type per slot (like a recipe).
  slots: arr(obj({ name: str(), tierFloor: tier(TIER_RANGES.material), qty: int({ min: 1 }) }), { min: 1 }),
  // Gold (gp) and downtime days the build costs.
  gold: num({ min: 0 }),
  buildDays: int({ min: 1 }),
  // The research that designs it (tier from the research table).
  researchProject: obj({ tier: tier(TIER_RANGES.research) })
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
const nodeTypePlayerFields = {
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
  // Token image for nodes of this type (a Foundry path). Defaults to a core icon.
  img: optional(str())
};

const nodeType = obj({
  ...nodeTypePlayerFields,
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

export const DEFINITION_SCHEMAS = { material, recipe, region, creatureYield, customRole, town, station: stationDef, nodeType, blueprint, tag: tagDef, note: noteDef };
export const TRACK_SCHEMA = track;

// What a PLAYER client holds (Stage 16, docs/10): the same kinds, but a region without its spawn table, and a node type
// without its ladders and charges. These are strict like the others, so a stripped copy that still carried a hidden field
// would fail to load. Every other kind is delivered whole.
const playerMaterial = obj({
  kind: kind("material"), id: idField(), name: str(), tier: tier(TIER_RANGES.material), value: optional(num({ min: 0 })),
  // Whether the material has a study (a plain yes/no, never the milestones) and, once the character knows it, its tag.
  hasTrack: optional(bool()), tag: optional(idField())
});
const playerNote = obj({ kind: kind("note"), id: idField(), name: str(), hasTrack: optional(bool()) });
const playerRecipe = obj({
  kind: kind("recipe"),
  id: idField(),
  name: str(),
  category: str(),
  baseRole: optional(oneOf(["basePower", "spellPower"])),
  slots: arr(obj({ name: str(), drives: union([str(), arr(str(), { min: 1 })], { hint: "must be a role name or a non-empty list of role names" }), tierFloor: tier(TIER_RANGES.material), qty: int({ min: 1 }) }), { min: 1 }),
  stationCategory: str(),
  stationTierMin: tier(TIER_RANGES.station),
  skillWhitelist: arr(str(), { min: 1 }),
  // Craft days, worked out on the GM client (the craft level, the station's upgrades and the 1-day floor): by station id, and with no station.
  days: obj({ default: int({ min: 1 }), byStation: record(int({ min: 1 })) }),
  // The (slot, material) pairs this recipe gives its own effect ("slot|materialId"), with no values: class knowledge does not apply to them (Stage 11c).
  overrideSlots: optional(arr(str()))
});
const playerBlueprint = obj({
  kind: kind("blueprint"),
  id: idField(),
  name: str(),
  category: str(),
  tier: tier(TIER_RANGES.station),
  slots: arr(obj({ name: str(), tierFloor: tier(TIER_RANGES.material), qty: int({ min: 1 }) }), { min: 1 }),
  gold: num({ min: 0 }),
  buildDays: int({ min: 1 })
});
export const PLAYER_SCHEMAS = { ...DEFINITION_SCHEMAS, region: obj(regionPlayerFields), nodeType: obj(nodeTypePlayerFields), material: playerMaterial, recipe: playerRecipe, blueprint: playerBlueprint, note: playerNote };

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
  decayTimer: optional(num({ min: 0 })),
  // A hidden node an expedition placed: the Perception DC to spot it, the anchor it stands on, and whether it was found.
  perceptionDC: optional(int({ min: 1 })),
  anchorId: optional(str()),
  revealed: optional(bool()),
  revealedBy: optional(str()),
  // Charges claimed by queued gathers (see gathering/reserve.js). Never more than the charges the node has.
  reservedCharges: optional(int({ min: 1 })),
  // On an anchor: the node token standing on it right now (cleared by clearMap).
  occupiedBy: optional(str()),
  // A corpse node: which creature it was (so gathering from it can be recorded on that creature's Compendium entry).
  creature: optional(obj({ name: str(), type: str() }))
}, {
  refine(value, path, errors) {
    const problem = (field, message) => errors.push({ field, message });
    const isCorpse = value.source === "corpse";

    if (value.state === "anchor") {
      if (isCorpse) problem("source", 'a corpse cannot be an anchor');
      for (const field of ["nodeType", "tier", "charges", "ladder", "decayTimer", "perceptionDC", "anchorId", "revealed", "revealedBy", "reservedCharges"]) {
        if (value[field] !== undefined) problem(field, "must not be set on an anchor (activate it first)");
      }
    } else {
      if (value.occupiedBy !== undefined) problem("occupiedBy", "is only for anchors (it names the node standing on the anchor)");
      for (const field of ["nodeType", "tier", "charges"]) {
        if (value[field] === undefined) problem(field, `is required once a node is ${value.state}`);
      }
      if (value.charges !== undefined) {
        if (value.state === "depleted" && value.charges !== 0) problem("charges", `must be 0 when the node is depleted (got ${value.charges})`);
        if (value.state === "active" && value.charges < 1) problem("charges", 'must be at least 1 when the node is active (a node with 0 charges is "depleted")');
        if (value.reservedCharges !== undefined && value.reservedCharges > value.charges) problem("reservedCharges", `cannot be more than the node's charges (${value.reservedCharges} reserved, ${value.charges} charge(s))`);
      }
    }

    if (isCorpse) {
      if (value.decayTimer === undefined) problem("decayTimer", 'is required when source is "corpse"');
      if (value.state !== "anchor" && value.ladder === undefined) problem("ladder", 'is required when source is "corpse" (a corpse brings its own ladder)');
    } else if (value.decayTimer !== undefined) {
      problem("decayTimer", 'only applies when source is "corpse"');
    }
    if (value.creature !== undefined && !isCorpse) problem("creature", 'only applies when source is "corpse"');
  }
});

const projectLogEntry = obj({
  source: oneOf(["research", "addProgress", "gm", "commission"]),
  delta: int(),
  skill: optional(str()),
  degree: optional(str()),
  note: optional(str())
});

// A workshop design a character holds (the actor flag `blueprints`), earned by research. Building needs the builder to hold it.
const blueprintHold = obj({ blueprintId: idField(), name: str(), source: oneOf(["research", "gm"]), at: int({ min: 0 }) });

// A research project, stored in the researcher's actor flag (the actor is its owner).
const project = obj({
  id: str(),
  goalName: str(),
  outcome: variant("type", {
    unlockFormula: { recipeId: idField() },
    // kind "tier": from and to are tiers; "craftDays" and "hearth": from and to are levels (hearth has no effect yet).
    upgradeStation: { stationId: str(), kind: oneOf(["tier", "craftDays", "hearth"]), from: int({ min: 0 }), to: int({ min: 1 }) },
    // Designing a workshop blueprint (building it is a separate queue item).
    designBlueprint: { blueprintId: idField() }
  }),
  tier: tier(TIER_RANGES.research),
  dc: int(),
  threshold: int({ min: 1 }),
  progress: int({ min: 0 }),
  skillWhitelist: arr(str(), { min: 1 }),
  materials: optional(arr(obj({ materialId: idField(), qty: int({ min: 1 }) }))),
  fee: optional(num({ min: 0 })),
  status: oneOf(["active", "complete", "abandoned"]),
  log: arr(projectLogEntry)
}, {
  refine(value, path, errors) {
    if (value.status === "active" && value.progress >= value.threshold) {
      errors.push({ field: "status", message: `is "active" but progress ${value.progress} has reached the threshold ${value.threshold} (it should be complete)` });
    }
    if (value.status === "complete" && value.progress < value.threshold) {
      errors.push({ field: "status", message: `is "complete" but progress ${value.progress} is below the threshold ${value.threshold}` });
    }
  }
});

// What a player may read of a formula they hold: enough to craft, nothing about
// hidden effects, output items, or how it is researched.
const formulaSnapshot = obj({
  name: str(),
  category: str(),
  // Legacy: snapshots made before v0.17.0 carry the craft level. It is accepted and ignored; the GM load rewrites the snapshot without it (docs/11b).
  craftLevel: optional(int({ min: CRAFT_LEVEL_RANGE.min, max: CRAFT_LEVEL_RANGE.max })),
  slots: arr(obj({ name: str(), drives: arr(str(), { min: 1 }), tierFloor: tier(TIER_RANGES.material), qty: int({ min: 1 }) }), { min: 1 }),
  stationCategory: str(),
  stationTierMin: tier(TIER_RANGES.station)
});

// A formula an actor holds. "loan" is in the schema now; the loan flow arrives in Stage 8.
const formula = obj({
  recipeId: idField(),
  access: oneOf(["owned", "loan"]),
  source: str(),
  snapshot: optional(formulaSnapshot),
  // A loan handed over for commissions: the ids of the open commissions it serves (see commissions/loans.js).
  commissions: optional(arr(str()))
});

// A full station record (player-owned, or the live form of a public one).
// Upgrades a station has: craft days cut and hearths. The tier is the station's tier itself. `hearths` has NO EFFECT YET.
const stationUpgrades = obj({ craftDays: optional(int({ min: 0 })), hearths: optional(int({ min: 0 })) });

const stationRecord = obj({
  id: str(),
  name: str(),
  category: str(),
  tier: tier(TIER_RANGES.station),
  location: variant("type", { fixed: { town: str() }, carried: { holder: str() } }),
  owner: optional(str()),
  access: arr(str()),
  upgrades: optional(stationUpgrades)
});

// A party-owned workshop (world setting `partyStations`): fixed where it was built, usable by every party character.
const partyStation = obj({
  id: str(),
  name: str(),
  category: str(),
  tier: tier(TIER_RANGES.station),
  town: str(),
  builtBy: str(),
  blueprintId: str(),
  builtAt: int({ min: 0 }),
  upgrades: optional(stationUpgrades)
});

// World-level state for a public station definition: who owns it, who may use it,
// and (for Stage 9 upgrades) a tier that overrides the read-only compendium's.
const stationState = obj({
  stationId: idField(),
  owner: optional(str()),
  access: arr(str()),
  tier: optional(tier(TIER_RANGES.station)),
  upgrades: optional(stationUpgrades)
});

// A commission (docs/06-commissions.md). Shape only; the rules between fields (who supplies what,
// price in whole copper pieces) are in commissions/commission.js.
export const COMMISSION_STATUSES = ["requested", "accepted", "inProgress", "delivered", "cancelled", "declined"];
const commission = obj({
  id: str(),
  source: oneOf(["player", "gm"]),
  status: oneOf(COMMISSION_STATUSES),
  patron: variant("type", { actor: { actorId: str() }, lightweight: { name: str() } }),
  crafter: str(),
  formulaId: idField(),
  access: oneOf(["loan", "copy"]),
  // slot name -> material id. Required unless the crafter supplies the materials.
  selection: optional(record(str())),
  stationId: optional(str()),
  materialsFrom: oneOf(["patron", "npc", "crafter"]),
  payout: num({ min: 0 }),
  teaches: variant("type", { none: {}, progress: { amount: int({ min: 1 }) }, fullCopy: {} }),
  learnRoll: bool(),
  learnAttempted: bool(),
  attempts: int({ min: 0 }),
  createdAt: int({ min: 0 }),
  delivered: optional(obj({ itemName: optional(str()), degree: str(), at: int({ min: 0 }) })),
  // What the module moved: fees, materials, payouts, items, learn rolls.
  log: arr(any())
});

// A queued downtime action, stored in the player's actor flag (the actor is its owner).
// `daysReserved` is the days it uses, already taken out of the actor's unreserved counter.
// The per-character Compendium (docs/10, Stage 10b): only facts the character has experienced, nothing locked is stored.
const compPlace = obj({ key: str(), label: str() });
const compRung = obj({ nodeType: str(), tier: int({ min: 1 }), rung: oneOf(["base", "higher"]) });
const compEntry = {
  material: obj({ id: idField(), name: str(), tier: optional(int({ min: 1 })), firstAt: int({ min: 0 }), places: arr(compPlace), rungs: arr(compRung) }),
  creature: obj({ key: str(), name: str(), type: str(), firstAt: int({ min: 0 }), yields: arr(obj({ materialId: idField(), name: str() })) }),
  region: obj({ id: str(), name: str(), firstAt: int({ min: 0 }), nodeTypes: arr(obj({ id: str(), name: str() })) })
};
// Experiments (docs/11b, B): what a character has learned about a recipe, per SLOT and MATERIAL (never per exact combination). `effects`
// is role -> value as the shared resolver gave it. A baseline holds the result of the cheapest valid materials, revealed when the
// formula is owned; it keeps the material ids only to match a preview, and the view never names a material the character has not met.
const compFact = obj({ materialId: idField(), materialName: str(), tier: optional(int({ min: 1 })), effects: record(any()), at: int({ min: 0 }) });
const compBaseline = obj({
  baseTier: optional(int({ min: 1 })),
  at: int({ min: 0 }),
  slots: arr(obj({ slot: str(), tierFloor: int({ min: 1 }), materialId: idField(), effects: record(any()) }))
});
// Class knowledge (Stage 11c): what a material does in an ITEM CLASS (a recipe category), learned by a successful craft. role -> value.
const compClassFact = obj({ materialId: idField(), materialName: str(), tier: optional(int({ min: 1 })), effects: record(any()), at: int({ min: 0 }) });
const compExperiment = obj({ recipeId: idField(), name: str(), category: optional(str()), firstAt: int({ min: 0 }), slots: record(record(compFact)), baseline: optional(compBaseline) });
const compendium = obj({
  v: int({ min: 1, max: 1 }),
  materials: record(compEntry.material),
  creatures: record(compEntry.creature),
  regions: record(compEntry.region),
  experiments: optional(record(compExperiment)),
  classes: optional(record(record(compClassFact)))
});

const pendingAction = obj({
  id: str(),
  // "upgrade" is reserved for workshop upgrades. Craft and gather are queued through the GM client (queue/work.js).
  type: oneOf(["research", "explore", "upgrade", "commission", "craft", "gather", "share", "build"]),
  params: any(),
  // Research and explore need at least a day (their handlers say so); commission steps cost none.
  daysReserved: int({ min: 0 }),
  submittedAt: int({ min: 0 })
});

// One actor's expected state in the audit ledger (see scripts/audit/audit.js).
const auditEntry = obj({
  name: str(),
  days: int(),
  formulas: record(oneOf(["owned", "loan"])),
  projects: record(obj({ tier: int(), dc: int(), threshold: int(), progress: int(), status: str() })),
  history: arr(obj({ at: int(), text: str() }))
});

// The discovery ledger (actor flag `discoveries`, Stage 11c): per studied item, the steps put in, the milestones reached and a plain stage.
// It holds NO thresholds (those are GM-only data, read at each check). `stage` is the word shown: 0 Just started, 1 Getting somewhere, 2 Nearly there.
const discoveryEntry = obj({
  key: str(), kind: oneOf(["material", "note", "recipe"]), id: idField(), name: str(),
  steps: int({ min: 0 }), reached: arr(obj({ index: int({ min: 0 }), type: oneOf(["properties", "formula"]), recipeId: optional(idField()) })), stage: int({ min: 0, max: 2 }),
  status: oneOf(["active", "complete"]), paused: optional(bool()), startedAt: int({ min: 0 })
});
const discoveries = obj({ v: int({ min: 1, max: 1 }), items: record(discoveryEntry) });

/** A lead the GM handed a character: a formula it could start researching. `name` is the recipe's name at the time (the player copy does not hold the recipe). */
const lead = obj({ id: str(), recipeId: idField(), name: str(), note: str(), at: int({ min: 0 }), source: optional(oneOf(["gm", "version"])) });

export const LIVE_SCHEMAS = { discoveries, lead, node, project, formula, stationRecord, stationState, partyStation, commission, pendingAction, auditEntry, compendium, blueprintHold };

export const DEFINITION_KINDS = Object.keys(DEFINITION_SCHEMAS);
