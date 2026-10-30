/** Small pure helpers the Hub's view-models share (Stage 11a, split out in the 11b round so the tab view-models do not import each other). */
import { S } from "./strings.js";
import { parseTier } from "../data/roles.js";
import { isDifficultyText } from "../difficulty.js";

export const cap = text => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const signed = n => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Free text the Hub did not write itself (a hint the module built from a project, a note a GM typed into a lead) is shown only if it carries no DC, odds,
 * percentage or difficulty wording. Otherwise `fallback` is shown instead (docs/11b: a leak is stopped at the source, not hidden in a stylesheet).
 */
export const safeText = (text, fallback) => (isDifficultyText(text) ? fallback : String(text ?? ""));

/** Whether anything that spends days may be used: { open, reason, note }. */
export function downtimeGate(downtime) {
  if (!downtime?.open) return { open: false, reason: S.closed, note: S.closedNote };
  if (!downtime.participant) return { open: false, reason: S.notHere, note: S.closedNote };
  return { open: true, reason: null, note: null };
}

/** One learned role effect in plain words ("adds +1d8 spirit damage"). */
export function roleText(role, value, recipe) {
  const noun = S.categoryNoun[recipe?.category] ?? S.genericNoun;
  switch (role) {
    case "basePower": return `${S.slotRole.basePower(noun)} (tier ${parseTier(value)})`;
    case "spellPower": return `${S.slotRole.spellPower(noun)} (tier ${parseTier(value)})`;
    case "bonusDamage": return `adds +${value.dice} ${value.persistent ? "persistent " : ""}${value.type} damage${value.versus ? ` against ${value.versus}` : ""}`;
    case "specialAbility": return `gives ${value.title}: ${value.text}${value.on ? ` (on a ${value.on === "criticalHit" ? "critical hit" : "hit"})` : ""}`;
    case "resistance": return `gives resistance ${value.value} to ${value.type}`;
    case "spellSlots": return `adds ${plural(value, "spell slot")}`;
    default: return `${role}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
  }
}

/** The learned effect lines for a material, or null when the character has not learned it here. Only known facts ever produce text. */
export function effectLines(materialName, fact, recipe) {
  if (!fact?.known) return null;
  return Object.entries(fact.effects ?? {}).map(([role, value]) => S.outcomeEffectLine(materialName, roleText(role, value, recipe)));
}

