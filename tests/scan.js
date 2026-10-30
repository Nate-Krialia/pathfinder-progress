/** The leak scanner for return values and view-models (docs/11b): a hidden field name at any depth, or a string that talks about DCs, odds, percentages or difficulty. */
import { DIFFICULTY_WORDS, HIDDEN_FIELDS } from "../scripts/difficulty.js";

export const BAD = DIFFICULTY_WORDS;
export const ITEM_RULES = new Set(["effects", "roles"]);   // a learned effect is the ITEM's own rules text (a save DC on a venom is the item's, not the roll's)

/** Everything wrong in a value: a hidden field name at any depth, or a string that talks about DCs, odds, percentages or difficulty. */
export function findings(value, path = "$") {
  if (typeof value === "string") return BAD.test(value) ? [`${path}: "${value}"`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findings(v, `${path}[${i}]`));
  if (value instanceof Map) return findings([...value.entries()], path);
  if (value instanceof Set) return findings([...value], path);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(HIDDEN_FIELDS.includes(k) ? [`${path}.${k}: hidden field`] : []),
      ...(ITEM_RULES.has(k) ? [] : findings(v, `${path}.${k}`))
    ]);
  }
  return [];
}


// A text-size label ("125%") is the one percentage the Hub shows; it is a size, not odds. Everything else must stay clean.
import { HUB } from "../scripts/config.js";
const SIZE_LABEL = new RegExp(`\\b(${HUB.textSizes.join("|")})%`, "g");
export const sizeFree = value => (typeof value === "string" ? value.replace(SIZE_LABEL, "") : value);
export const scanClean = (value, path = "$") => findings(JSON.parse(JSON.stringify(value), (k, v) => sizeFree(v)), path);
