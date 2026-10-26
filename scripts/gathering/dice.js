/**
 * Quantity expressions for gathering: "3", "1d4", "2d6+1", "d8-1".
 * Pure. The random source is injected: rollDie(sides) must return an integer 1..sides.
 */
import { QUANTITY_PATTERN } from "../config.js";

export function parseQuantity(expression) {
  const text = String(expression).trim();
  if (!QUANTITY_PATTERN.test(text)) throw new Error(`parseQuantity: "${expression}" is not a number or dice expression like "3" or "2d6+1"`);
  if (/^\d+$/.test(text)) return { count: 0, sides: 0, modifier: Number(text) };
  const [, count, sides, modifier] = text.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  return { count: count === "" ? 1 : Number(count), sides: Number(sides), modifier: modifier ? Number(modifier) : 0 };
}

/** Roll a quantity. A result of 0 or less means "nothing" and is returned as 0. */
export function rollQuantity(expression, rollDie) {
  const { count, sides, modifier } = parseQuantity(expression);
  let total = modifier;
  for (let i = 0; i < count; i++) {
    const roll = rollDie(sides);
    if (!Number.isInteger(roll) || roll < 1 || roll > sides) {
      throw new Error(`rollQuantity: rollDie(${sides}) must return an integer from 1 to ${sides} (got ${roll})`);
    }
    total += roll;
  }
  return Math.max(0, total);
}

/** The average result (before clamping at 0). */
export function meanQuantity(expression) {
  const { count, sides, modifier } = parseQuantity(expression);
  return count * (sides + 1) / 2 + modifier;
}

/** The lowest and highest possible results (clamped at 0). */
export function quantityRange(expression) {
  const { count, sides, modifier } = parseQuantity(expression);
  return { min: Math.max(0, count + modifier), max: Math.max(0, count * sides + modifier) };
}
