/**
 * Plain words for effects that act on a target (v0.22.0), and the one filter between GM-only effect data and anything a player can read. Pure; no Foundry globals.
 *
 * Condition values, save types and DCs NEVER appear in anything a player can read: not an item description, not the Compendium book a craft writes, not the
 * preview. `forPlayer(role, value)` is the one place a GM-only role value becomes a player-safe one ({ plain: [lines] }); `findLeaks` is the scan the tests use to
 * prove nothing GM-only is left in a player's copy.
 */
import { EFFECT_CONDITIONS } from "../config.js";

/** What a condition does to the target, in a few plain words. */
export const CONDITION_PHRASES = {
  frightened: "makes the target fearful",
  sickened: "makes the target sick",
  clumsy: "makes the target clumsy",
  enfeebled: "makes the target weaker",
  stupefied: "makes the target dazed",
  slowed: "slows the target",
  "off-guard": "leaves the target off guard",
  prone: "knocks the target down",
  dazzled: "dazzles the target",
  fatigued: "tires the target"
};
export const conditionPhrase = condition => CONDITION_PHRASES[condition] ?? `affects the target (${EFFECT_CONDITIONS[condition]?.label ?? condition})`;

/** The plain lines for an applyCondition role value (the array of effects), or for an already-plain marker. Never a number, a save or a DC. */
export function plainLines(value) {
  if (Array.isArray(value)) return [...new Set(value.map(e => conditionPhrase(e.condition)))];
  if (Array.isArray(value?.plain)) return [...value.plain];
  return [];
}

/** A role value as a player may hold it: applyCondition becomes { plain: [...] }; every other role is returned as it was. */
export function forPlayer(role, value) {
  return role === "applyCondition" ? { plain: plainLines(value) } : value;
}

/** Every role of a set as a player may hold it. */
export const rolesForPlayer = roles => Object.fromEntries(Object.entries(roles ?? {}).map(([role, value]) => [role, forPlayer(role, value)]));

/** Field names that are GM-only data: a player's copy of anything must not carry one. */
export const GM_ONLY_KEYS = ["applyCondition", "effectBlocks", "classEffects", "effects", "save", "saveType", "condition", "conditionValue", "dc", "craftLevel", "research"];

/** The keys that must not appear anywhere in a Compendium book, a preview or a player-bound message (the role NAME applyCondition may: its value is a plain marker). */
export const EFFECT_SECRET_KEYS = ["save", "saveType", "condition", "conditionValue", "dc"];

/** The paths of GM-only keys found anywhere inside `value` (so the test adds a field and expects this to find it). */
export function findLeaks(value, path = "$", keys = GM_ONLY_KEYS) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findLeaks(v, `${path}[${i}]`, keys));
  return Object.entries(value).flatMap(([k, v]) => [...(keys.includes(k) ? [`${path}.${k}`] : []), ...findLeaks(v, `${path}.${k}`, keys)]);
}

/** Words that must not be in player-readable text next to an effect: a save type, a DC. (Used on item descriptions and chat text.) */
export const LEAK_WORDS = /\b(DC|Will|Fortitude|Reflex)\b|\bsave\b/;

/** The GM-only result words for a target that now has the condition ("Goblin A is fearful"). No value, no save, no degree. */
export const CONDITION_RESULTS = {
  frightened: "is fearful", sickened: "is sick", clumsy: "is clumsy", enfeebled: "is weakened", stupefied: "is dazed", slowed: "is slowed",
  "off-guard": "is off guard", prone: "is knocked down", dazzled: "is dazzled", fatigued: "is tired"
};
export const conditionResult = condition => CONDITION_RESULTS[condition] ?? "is affected";
export const SHRUGS = "shrugs it off";
