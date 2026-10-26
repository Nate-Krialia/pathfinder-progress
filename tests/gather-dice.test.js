import test from "node:test";
import assert from "node:assert/strict";
import { meanQuantity, parseQuantity, quantityRange, rollQuantity } from "../scripts/gathering/dice.js";

/** mulberry32 seeded generator returning 1..sides. */
function seededDie(seed) {
  let a = seed >>> 0;
  return sides => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * sides) + 1;
  };
}

test("parseQuantity understands numbers and dice", () => {
  assert.deepEqual(parseQuantity("3"), { count: 0, sides: 0, modifier: 3 });
  assert.deepEqual(parseQuantity("1d4"), { count: 1, sides: 4, modifier: 0 });
  assert.deepEqual(parseQuantity("d8"), { count: 1, sides: 8, modifier: 0 });
  assert.deepEqual(parseQuantity("2d6+1"), { count: 2, sides: 6, modifier: 1 });
  assert.deepEqual(parseQuantity(" 3d4-2 "), { count: 3, sides: 4, modifier: -2 });
});

test("parseQuantity rejects anything else", () => {
  for (const bad of ["lots", "1d", "d", "1d4+", "-3", "1.5", "", "2d6*2"]) assert.throws(() => parseQuantity(bad), /not a number or dice/, bad);
});

test("a plain number rolls no dice", () => {
  let calls = 0;
  assert.equal(rollQuantity("5", () => { calls++; return 1; }), 5);
  assert.equal(calls, 0);
});

test("scripted dice add up with the modifier", () => {
  const rolls = [3, 6];
  assert.equal(rollQuantity("2d6+1", () => rolls.shift()), 10);
});

test("a result of zero or less becomes 0 (nothing gathered)", () => {
  assert.equal(rollQuantity("1d4-3", () => 1), 0);
  assert.equal(rollQuantity("1d4-1", () => 1), 0);
  assert.equal(rollQuantity("1d4-1", () => 2), 1);
});

test("the die function's contract is enforced", () => {
  for (const bad of [0, 5, 2.5, undefined]) assert.throws(() => rollQuantity("1d4", () => bad), /integer from 1 to 4/, String(bad));
});

test("mean and range", () => {
  assert.equal(meanQuantity("1d4"), 2.5);
  assert.equal(meanQuantity("2d6+1"), 8);
  assert.equal(meanQuantity("3"), 3);
  assert.deepEqual(quantityRange("2d6+1"), { min: 3, max: 13 });
  assert.deepEqual(quantityRange("1d4-3"), { min: 0, max: 1 });
});

test("distribution: 1d4 is uniform over 1..4 and averages 2.5", () => {
  const die = seededDie(11);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) { const v = rollQuantity("1d4", die); counts[v]++; sum += v; }
  assert.ok(Math.abs(sum / n - 2.5) < 0.03, `mean ${sum / n}`);
  for (const v of [1, 2, 3, 4]) assert.ok(Math.abs(counts[v] / n - 0.25) < 0.015, `${v}: ${counts[v] / n}`);
});

test("distribution: 2d6+1 spans 3..13 and averages 8", () => {
  const die = seededDie(23);
  let sum = 0, lo = Infinity, hi = -Infinity;
  const n = 20000;
  for (let i = 0; i < n; i++) { const v = rollQuantity("2d6+1", die); sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(Math.abs(sum / n - 8) < 0.06, `mean ${sum / n}`);
  assert.deepEqual([lo, hi], [3, 13]);
});
