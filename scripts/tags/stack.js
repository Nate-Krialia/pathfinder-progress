/**
 * The stacking engine (Slice 2a, docs/22-tags-slice1.md "Slice 2a"). Pure; no Foundry globals.
 *
 * Contributions from every ingredient in the TAGGED slots of a craft (the material's own effects and each of its tags' effects, each at the contributing item's tier) are
 * added up INSIDE the module first; one result per role comes out, then the GM-set cap for that role clamps it. Order never changes the result (except which of two
 * equal conditions or abilities is kept, which is the first in slot order).
 *
 *   basePower / spellPower  the HIGHEST tier wins (tiers pick an output item; they do not add).
 *   bonusDamage             same damage type, die size, persistence and versus: the dice counts ADD (1d4 + 1d4 = 2d4). Different die sizes or types stay separate.
 *   resistance              same damage type: the values ADD.
 *   specialAbility          every ability applies; the same title is kept once.
 *   applyCondition          every condition applies; the same condition twice keeps the HIGHER value.
 * A cap clamps ONLY its own role. Everything it cuts is reported in `notes` (GM-only text); nothing about a clamp may reach a player.
 *
 * A contribution is { role, value, from: { name, slot?, tagId? } } with `value` in the shape the role already has (roles.js).
 */
import { EFFECTS, TAGS } from "../config.js";

const DIE = /^(\d+)d(\d+)$/;
const tierOf = ref => Number(String(ref).slice(1));
const names = list => [...new Set(list.filter(Boolean))].join(" + ");

/** A bonus type for a group: the one every contributor named, else untyped (undefined). */
const bonusTypeOf = parts => { const types = new Set(parts.map(p => p.bonusType ?? "untyped")); return types.size === 1 && !types.has("untyped") ? [...types][0] : undefined; };

/** The caps in force: the defaults with the GM's table over them, field by field. */
export function mergeCaps(table = null, defaults = TAGS.defaultCaps) {
  const out = structuredClone(defaults);
  for (const [role, fields] of Object.entries(table?.roles ?? {})) out[role] = { ...(out[role] ?? {}), ...fields };
  return out;
}

const CAP_FIELDS = { basePower: ["maxTier"], spellPower: ["maxTier"], bonusDamage: ["maxDicePerType"], resistance: ["maxValue"], specialAbility: ["maxCount"], applyCondition: ["maxValue", "maxCount"] };
export const CAP_ROLES = Object.keys(CAP_FIELDS);

/** What is wrong with a GM's cap table, in plain sentences (empty = fine). */
export function capsProblems(table) {
  if (!table || typeof table !== "object" || table.v !== 1 || typeof table.roles !== "object" || Array.isArray(table.roles)) return ["The caps table has an unknown shape."];
  const problems = [];
  for (const [role, fields] of Object.entries(table.roles)) {
    if (!CAP_FIELDS[role]) { problems.push(`"${role}" is not a role that has a cap.`); continue; }
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (!CAP_FIELDS[role].includes(field)) { problems.push(`${role} has no cap called "${field}" (it has: ${CAP_FIELDS[role].join(", ")}).`); continue; }
      const max = field === "maxTier" ? 5 : role === "applyCondition" && field === "maxValue" ? EFFECTS.maxValue : 99;
      if (!Number.isInteger(value) || value < 1 || value > max) problems.push(`${role} ${field} must be a whole number from 1 to ${max}.`);
    }
  }
  return problems;
}

function stackPower(items, cap, baseRole, notes) {
  if (!items.length) return null;
  const top = Math.max(...items.map(i => tierOf(i.value)));
  const limit = cap?.maxTier;
  if (limit !== undefined && top > limit) { notes.push(`capped ${baseRole}: tier ${top} became tier ${limit}`); return `T${limit}`; }
  return `T${top}`;
}

function stackDamage(items, cap, notes) {
  const groups = new Map();
  for (const { value, from } of items) {
    const m = DIE.exec(value.dice);
    if (!m) continue;
    const key = [value.type, value.persistent ? 1 : 0, value.versus ?? "", m[2]].join("|");
    const g = groups.get(key) ?? { type: value.type, persistent: Boolean(value.persistent), versus: value.versus, size: Number(m[2]), count: 0, parts: [], from: [] };
    g.count += Number(m[1]); g.parts.push(value); g.from.push(from?.name);
    groups.set(key, g);
  }
  let entries = [...groups.values()];
  const budgetFor = cap?.maxDicePerType;
  if (budgetFor !== undefined) {
    const byType = new Map();
    for (const g of entries) byType.set(g.type, [...(byType.get(g.type) ?? []), g]);
    for (const [type, list] of byType) {
      const total = list.reduce((n, g) => n + g.count, 0);
      if (total <= budgetFor) continue;
      let left = budgetFor;
      for (const g of [...list].sort((a, b) => b.size - a.size || (a.versus ?? "").localeCompare(b.versus ?? "") || Number(a.persistent) - Number(b.persistent))) { const keep = Math.min(g.count, left); g.count = keep; left -= keep; }
      notes.push(`capped bonusDamage (${type}): ${total} dice became ${budgetFor}`);
    }
    entries = entries.filter(g => g.count > 0);
  }
  return entries.map(g => ({ dice: `${g.count}d${g.size}`, type: g.type, ...(g.persistent ? { persistent: true } : {}), ...(g.versus ? { versus: g.versus } : {}), ...(bonusTypeOf(g.parts) ? { bonusType: bonusTypeOf(g.parts) } : {}), label: names(g.from) }));
}

function stackResistance(items, cap, notes) {
  const groups = new Map();
  for (const { value, from } of items) {
    const g = groups.get(value.type) ?? { type: value.type, value: 0, parts: [], from: [] };
    g.value += value.value; g.parts.push(value); g.from.push(from?.name);
    groups.set(value.type, g);
  }
  return [...groups.values()].map(g => {
    let amount = g.value;
    if (cap?.maxValue !== undefined && amount > cap.maxValue) { notes.push(`capped resistance (${g.type}): ${amount} became ${cap.maxValue}`); amount = cap.maxValue; }
    return { type: g.type, value: amount, ...(bonusTypeOf(g.parts) ? { bonusType: bonusTypeOf(g.parts) } : {}), label: names(g.from) };
  });
}

function stackAbilities(items, cap, notes) {
  const seen = new Set(), out = [];
  for (const { value } of items) { const key = `${value.title}|${value.on ?? "hit"}`; if (seen.has(key)) continue; seen.add(key); out.push({ ...value }); }
  if (cap?.maxCount !== undefined && out.length > cap.maxCount) { notes.push(`capped specialAbility: ${out.length} abilities became ${cap.maxCount}`); return out.slice(0, cap.maxCount); }
  return out;
}

function stackConditions(items, cap, notes) {
  const byCondition = new Map();
  for (const { value } of items) for (const e of Array.isArray(value) ? value : []) {
    const had = byCondition.get(e.condition);
    if (!had || (e.value ?? 0) > (had.value ?? 0)) byCondition.set(e.condition, { ...e });
  }
  let out = [...byCondition.values()];
  if (cap?.maxValue !== undefined) out = out.map(e => { if (e.value !== undefined && e.value > cap.maxValue) { notes.push(`capped applyCondition (${e.condition}): value ${e.value} became ${cap.maxValue}`); return { ...e, value: cap.maxValue }; } return e; });
  if (cap?.maxCount !== undefined && out.length > cap.maxCount) { notes.push(`capped applyCondition: ${out.length} conditions became ${cap.maxCount}`); out = out.slice(0, cap.maxCount); }
  return out;
}

/**
 * @param {Array<{ role: string, value: any, from?: { name?: string } }>} contributions
 * @param {object} caps  the caps in force (mergeCaps)
 * @param {{ baseRole?: string }} [options]  which role is the recipe's power role (basePower or spellPower)
 * @returns {{ roles: { [role: string]: any }, notes: string[] }}  roles holds only roles that had a contribution
 */
export function stackContributions(contributions, caps = {}, { baseRole = "basePower" } = {}) {
  const notes = [];
  const roles = {};
  const of = role => contributions.filter(c => c.role === role);
  if (of(baseRole).length) roles[baseRole] = stackPower(of(baseRole), caps[baseRole], baseRole, notes);
  if (of("bonusDamage").length) roles.bonusDamage = stackDamage(of("bonusDamage"), caps.bonusDamage, notes);
  if (of("resistance").length) roles.resistance = stackResistance(of("resistance"), caps.resistance, notes);
  if (of("specialAbility").length) roles.specialAbility = stackAbilities(of("specialAbility"), caps.specialAbility, notes);
  if (of("applyCondition").length) roles.applyCondition = stackConditions(of("applyCondition"), caps.applyCondition, notes);
  return { roles, notes };
}

/** The five roles that stack in a tagged slot (the recipe's power role is added by the caller). */
export const STACKING_ROLES = ["bonusDamage", "resistance", "specialAbility", "applyCondition"];
