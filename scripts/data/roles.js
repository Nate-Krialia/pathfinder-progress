/**
 * The role vocabulary: which roles exist per recipe category, and the exact
 * value shape each role accepts. No Foundry globals (testable in Node).
 */
import { BASE_ROLE_BY_CATEGORY, TIER_RANGES, TRAIT_SLUG_PATTERN } from "../config.js";
import { DAMAGE_TYPES } from "../adapter/pf2e.js";
import { bool, int, obj, oneOf, optional, scalar, str } from "./schema.js";

/** Built-in roles by recipe category (docs/01-data-model.md). */
export const BUILT_IN_ROLES = {
  weapon: ["basePower", "bonusDamage", "specialAbility"],
  armor: ["basePower", "resistance", "specialAbility"],
  robes: ["basePower", "resistance", "specialAbility"],
  focus: ["spellPower", "spellSlots", "specialAbility"]
};

export const parseTier = ref => Number(String(ref).slice(1));

const tierRef = str({
  pattern: /^T[1-9]\d*$/,
  patternHint: 'must be a tier like "T2"',
  refine(value, path, errors) {
    const { min, max } = TIER_RANGES.material;
    const n = parseTier(value);
    if (n < min || n > max) errors.push({ field: path || "(root)", message: `tier must be between T${min} and T${max} (got ${value})` });
  }
});

const damageType = () => oneOf(DAMAGE_TYPES);

/** The value shape for each built-in role. */
export const ROLE_SPECS = {
  // Tier references: pick which output item is made.
  basePower: tierRef,
  spellPower: tierRef,
  bonusDamage: obj({
    dice: str({ pattern: /^[1-9]\d?d(4|6|8|10|12)$/, patternHint: 'must be dice like "1d4" or "2d6"' }),
    type: damageType(),
    persistent: optional(bool()),
    versus: optional(str({ pattern: TRAIT_SLUG_PATTERN, patternHint: 'must be a trait slug like "fiend"' }))
  }),
  specialAbility: obj({
    title: str(),
    text: str(),
    on: optional(oneOf(["hit", "criticalHit"]))
  }),
  resistance: obj({ type: damageType(), value: int({ min: 1, max: 50 }) }),
  // Stage 2 records this in the item description and flags only.
  spellSlots: int({ min: 1 })
};

/** Spec for `role`: a built-in role, or a custom role (any scalar). Null if unknown. */
export function roleSpec(role, customRoles = []) {
  if (ROLE_SPECS[role]) return ROLE_SPECS[role];
  return customRoles.some(r => r.id === role) ? scalar() : null;
}

/** The roles a slot drives, as an array (`drives` may be a string or an array). */
export const slotRoles = slot => (Array.isArray(slot.drives) ? slot.drives : [slot.drives]);

/** Which role picks this recipe's output tier, or null when it has none. */
export const baseRoleFor = recipe => recipe.baseRole ?? BASE_ROLE_BY_CATEGORY[recipe.category] ?? null;

export function rolesForCategory(category, customRoles = []) {
  const roles = new Set(BUILT_IN_ROLES[category] ?? []);
  for (const role of customRoles) if (role.appliesTo.includes(category)) roles.add(role.id);
  return roles;
}
