/**
 * The effect builder's blocks (Stage 11d, docs/11d-item-editor-addendum.md). Pure; no Foundry globals.
 *
 * A material's effects are authored as BLOCKS per item class (plus a general set that applies to every class): Add damage, Grant resistance, Special ability text, and the
 * base-power tier the material gives. They COMPILE to the role values the craft engine already applies (bonusDamage, resistance, specialAbility, basePower), so the engine,
 * the one resolver, the Experiments and the Hub's wording all stay exactly as they were. The plain-words line players see comes from the SAME wording function the Hub uses
 * (hub/common.js effectLines), so what the preview shows is what the Hub shows. Conditions, afflictions and Adjust arrive in 0.22.0.
 */
import { effectLines } from "../hub/common.js";
import { rolesForCategory } from "../data/roles.js";
import { BASE_ROLE_BY_CATEGORY } from "../config.js";

/** The role the power tier compiles to in a class: base power for most, spell power for a focus. "Every class" uses base power. */
export const powerRole = itemClass => BASE_ROLE_BY_CATEGORY[itemClass] ?? "basePower";

export const BLOCK_TYPES = ["damage", "resistance", "ability"];
const ROLE_OF = { damage: "bonusDamage", resistance: "resistance", ability: "specialAbility" };
export const BLOCK_LABELS = { damage: "Add damage", resistance: "Grant resistance", ability: "Special ability text" };
export const TIERS = [1, 2, 3, 4, 5];

/** The value of a per-tier field for a material of `tier`: the table's entry, else the single value. */
export const valueAt = (field, tier) => (field?.byTier ? field.byTier[tier] : field?.all);

/** A per-tier field set to one value for every tier / spread into an explicit table (T1 to T5), keeping the current value in every row. */
export const flat = value => ({ all: value });
export const spread = (field, fallback) => ({ byTier: Object.fromEntries(TIERS.map(t => [t, valueAt(field, t) ?? fallback])) });
export const collapse = (field, tier) => ({ all: valueAt(field, tier) });

/** A new block of a type with sensible defaults, for the "Add a block" buttons. */
export function newBlock(type) {
  if (type === "damage") return { type, dice: flat("1d6"), damageType: "fire" };
  if (type === "resistance") return { type, damageType: "fire", value: flat(2) };
  if (type === "ability") return { type, title: "", text: "" };
  throw new RangeError(`newBlock: unknown block type "${type}"`);
}

/** One block as the role value it compiles to, for a material of `tier`. */
export function blockValue(block, tier) {
  if (block.type === "damage") return { dice: valueAt(block.dice, tier), type: block.damageType, ...(block.persistent ? { persistent: true } : {}), ...(block.versus ? { versus: block.versus } : {}) };
  if (block.type === "resistance") return { type: block.damageType, value: valueAt(block.value, tier) };
  if (block.type === "ability") return { title: block.title, text: block.text, ...(block.on ? { on: block.on } : {}) };
  throw new RangeError(`blockValue: unknown block type "${block.type}"`);
}

/** What is wrong with a set, as plain sentences. A role holds one value, so at most one block of each type per item class. */
export function setProblems(set, itemClass, tier) {
  const problems = [];
  for (const type of BLOCK_TYPES) if ((set?.blocks ?? []).filter(b => b.type === type).length > 1) problems.push(`Only one "${BLOCK_LABELS[type]}" block fits in one item class.`);
  if (itemClass && itemClass !== "general") {
    const roles = rolesForCategory(itemClass);
    for (const block of set?.blocks ?? []) if (!roles.has(ROLE_OF[block.type])) problems.push(`"${BLOCK_LABELS[block.type]}" does not apply to ${itemClass} items.`);
    if (set?.power !== undefined && !roles.has(powerRole(itemClass))) problems.push(`${itemClass} items have no power tier.`);
  }
  (set?.blocks ?? []).forEach(block => {
    if (block.type === "ability" && (!block.title?.trim() || !block.text?.trim())) problems.push("A special ability needs a title and its text.");
    if (block.type === "damage" && !valueAt(block.dice, tier)) problems.push("Add damage needs dice for this material's tier.");
    if (block.type === "resistance" && !(valueAt(block.value, tier) >= 1)) problems.push("Grant resistance needs an amount of at least 1 for this material's tier.");
  });
  return problems;
}

/** A set as role values: { basePower?, bonusDamage?, resistance?, specialAbility?, ...extra }. */
export function compileSet(set, tier, itemClass) {
  const roles = { ...(set?.extra ?? {}) };
  if (set?.power !== undefined) roles[powerRole(itemClass)] = `T${set.power}`;
  for (const block of set?.blocks ?? []) roles[ROLE_OF[block.type]] = blockValue(block, tier);
  return roles;
}

/** A record's blocks as the `effects` and `classEffects` the loader and the craft engine read. */
export function compileEffects(effectBlocks, tier) {
  const effects = compileSet(effectBlocks?.general, tier);
  const classEffects = Object.fromEntries(Object.entries(effectBlocks?.byClass ?? {}).map(([cls, set]) => [cls, compileSet(set, tier, cls)]).filter(([, roles]) => Object.keys(roles).length));
  return { effects, classEffects };
}

/** Role values back into a set (opening a record that was written as roles). Anything that is not a block stays in `extra`, so nothing is lost. */
export function decompileRoles(roles = {}, itemClass) {
  const set = { blocks: [], extra: {} };
  for (const [role, value] of Object.entries(roles)) {
    if (role === powerRole(itemClass) && /^T[1-5]$/.test(String(value))) set.power = Number(String(value).slice(1));
    else if (role === "bonusDamage") set.blocks.push({ type: "damage", dice: flat(value.dice), damageType: value.type, ...(value.persistent ? { persistent: true } : {}), ...(value.versus ? { versus: value.versus } : {}) });
    else if (role === "resistance") set.blocks.push({ type: "resistance", damageType: value.type, value: flat(value.value) });
    else if (role === "specialAbility") set.blocks.push({ type: "ability", title: value.title, text: value.text, ...(value.on ? { on: value.on } : {}) });
    else set.extra[role] = value;
  }
  if (!Object.keys(set.extra).length) delete set.extra;
  return set;
}

export const decompileRecord = record => ({
  general: decompileRoles(record.effects),
  byClass: Object.fromEntries(Object.entries(record.classEffects ?? {}).map(([cls, roles]) => [cls, decompileRoles(roles, cls)]))
});

/**
 * The plain-words lines a player sees for one class's effects ("Gate Fang adds +1d6 fire damage"): the Hub's own wording over the compiled roles.
 * `itemClass` "general" uses a neutral noun.
 */
export function describeBlocks(materialName, set, itemClass, tier) {
  return describeRoles(materialName, compileSet(set, tier, itemClass === "general" ? undefined : itemClass), itemClass);
}

/** Role values in plain words (the Hub's wording). */
export function describeRoles(materialName, roles, itemClass) {
  return effectLines(materialName, { known: true, effects: roles }, { category: itemClass === "general" ? undefined : itemClass }) ?? [];
}

/** What a material does in one item class: the general effects, with that class's own effects on top (the resolver's rule: class beats general). */
export const classRoles = (effectBlocks, itemClass, tier) => ({ ...compileSet(effectBlocks?.general, tier), ...compileSet(effectBlocks?.byClass?.[itemClass], tier, itemClass) });

/** Which recipe slots can this material fill in a class? Derived from the roles its effects supply (there is no category field). */
export function fitsRoles(effectBlocks, itemClass) {
  const roles = new Set([...Object.keys(compileSet(effectBlocks?.general, 1)), ...Object.keys(compileSet(effectBlocks?.byClass?.[itemClass], 1, itemClass))]);
  return [...roles].sort();
}
