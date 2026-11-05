/** Tag effects, Slice 2a: the stacking engine and the caps (docs/22-tags-slice1.md). Pure. Every rule of the math has its own test. */
import test from "node:test";
import assert from "node:assert/strict";
import { CAP_ROLES, capsProblems, mergeCaps, stackContributions } from "../scripts/tags/stack.js";
import { TAGS } from "../scripts/config.js";

const dmg = (dice, type = "poison", extra = {}, name = "x") => ({ role: "bonusDamage", value: { dice, type, ...extra }, from: { name } });
const res = (type, value, extra = {}, name = "x") => ({ role: "resistance", value: { type, value, ...extra }, from: { name } });
const abil = (title, text = "t", name = "x") => ({ role: "specialAbility", value: { title, text }, from: { name } });
const cond = (list, name = "x") => ({ role: "applyCondition", value: list, from: { name } });
const pow = (t, name = "x") => ({ role: "basePower", value: `T${t}`, from: { name } });
const NONE = {};
const run = (c, caps = NONE, o) => stackContributions(c, caps, o);

// bonusDamage -------------------------------------------------------------------------------------------------------------
test("DAMAGE: the same type and die size ADD their counts (1d4 + 1d4 = 2d4)", () => {
  assert.deepEqual(run([dmg("1d4"), dmg("1d4")]).roles.bonusDamage.map(e => e.dice), ["2d4"]);
  assert.deepEqual(run([dmg("2d6"), dmg("1d6"), dmg("3d6")]).roles.bonusDamage.map(e => e.dice), ["6d6"]);
});
test("DAMAGE: different die sizes of one type stay separate", () => {
  const r = run([dmg("1d4"), dmg("1d6")]).roles.bonusDamage;
  assert.deepEqual(r.map(e => e.dice).sort(), ["1d4", "1d6"]);
});
test("DAMAGE: different damage types stay separate", () => {
  assert.deepEqual(run([dmg("1d4", "fire"), dmg("1d4", "cold")]).roles.bonusDamage.map(e => `${e.dice} ${e.type}`).sort(), ["1d4 cold", "1d4 fire"]);
});
test("DAMAGE: persistent and versus-a-trait damage do not merge with plain damage of the same type and size", () => {
  assert.equal(run([dmg("1d4"), dmg("1d4", "poison", { persistent: true })]).roles.bonusDamage.length, 2);
  assert.equal(run([dmg("1d4"), dmg("1d4", "poison", { versus: "fiend" })]).roles.bonusDamage.length, 2);
  assert.equal(run([dmg("1d4", "poison", { versus: "fiend" }), dmg("1d4", "poison", { versus: "fiend" })]).roles.bonusDamage[0].dice, "2d4");
});
test("DAMAGE: the label names every contributor once; the order of contributions does not change the totals", () => {
  const a = [dmg("1d4", "poison", {}, "Fang"), dmg("1d4", "poison", {}, "Thorn"), dmg("1d6", "fire", {}, "Fang"), dmg("1d4", "poison", {}, "Fang")];
  const r = run(a).roles.bonusDamage;
  assert.equal(r.find(e => e.type === "poison").label, "Fang + Thorn");
  const total = list => list.map(e => `${e.dice} ${e.type}`).sort().join();
  assert.equal(total(run([...a].reverse()).roles.bonusDamage), total(r));
});
test("DAMAGE: a bonus type is carried when every contributor named the same one, and is untyped otherwise", () => {
  assert.equal(run([dmg("1d4", "poison", { bonusType: "item" }), dmg("1d4", "poison", { bonusType: "item" })]).roles.bonusDamage[0].bonusType, "item");
  assert.equal(run([dmg("1d4", "poison", { bonusType: "item" }), dmg("1d4", "poison", { bonusType: "status" })]).roles.bonusDamage[0].bonusType, undefined);
  assert.equal(run([dmg("1d4", "poison", { bonusType: "item" }), dmg("1d4")]).roles.bonusDamage[0].bonusType, undefined);
  assert.equal(run([dmg("1d4")]).roles.bonusDamage[0].bonusType, undefined);
});

// resistance ----------------------------------------------------------------------------------------------------------------
test("RESISTANCE: values ADD per damage type; different types stay separate", () => {
  const r = run([res("fire", 3), res("fire", 4), res("cold", 2)]).roles.resistance;
  assert.deepEqual(r.map(e => `${e.type} ${e.value}`).sort(), ["cold 2", "fire 7"]);
});

// power --------------------------------------------------------------------------------------------------------------------
test("POWER: the HIGHEST tier wins; tiers never add", () => {
  assert.equal(run([pow(1), pow(3), pow(2)]).roles.basePower, "T3");
  assert.equal(run([{ ...pow(2), role: "spellPower" }, { ...pow(4), role: "spellPower" }], NONE, { baseRole: "spellPower" }).roles.spellPower, "T4");
});

// abilities -----------------------------------------------------------------------------------------------------------------
test("ABILITIES: every ability applies; the same title (and trigger) once", () => {
  const r = run([abil("Venom"), abil("Barb"), abil("Venom", "other text")]).roles.specialAbility;
  assert.deepEqual(r.map(a => a.title), ["Venom", "Barb"]);
  assert.equal(r[0].text, "t", "the first one is kept");
});

// conditions ----------------------------------------------------------------------------------------------------------------
test("CONDITIONS: different conditions ALL apply", () => {
  const r = run([cond([{ condition: "frightened", value: 1, save: "will" }]), cond([{ condition: "sickened", value: 2, save: "fortitude" }])]).roles.applyCondition;
  assert.deepEqual(r.map(e => e.condition).sort(), ["frightened", "sickened"]);
});
test("CONDITIONS: the same condition twice keeps the HIGHER value (and its save)", () => {
  const r = run([cond([{ condition: "frightened", value: 1, save: "will" }]), cond([{ condition: "frightened", value: 3, save: "reflex" }]), cond([{ condition: "frightened", value: 2, save: "will" }])]).roles.applyCondition;
  assert.deepEqual(r, [{ condition: "frightened", value: 3, save: "reflex" }]);
});
test("CONDITIONS: a valueless condition is kept once", () => {
  const r = run([cond([{ condition: "prone", save: "none" }]), cond([{ condition: "prone", save: "none" }])]).roles.applyCondition;
  assert.equal(r.length, 1);
});

// caps ----------------------------------------------------------------------------------------------------------------------
test("CAP damage: dice per type are clamped, biggest die first; a cap that is not reached cuts nothing and says nothing", () => {
  const big = run([dmg("3d8"), dmg("3d6"), dmg("2d4")], { bonusDamage: { maxDicePerType: 4 } });
  assert.deepEqual(big.roles.bonusDamage.map(e => e.dice), ["3d8", "1d6"]);
  assert.deepEqual(big.notes, ["capped bonusDamage (poison): 8 dice became 4"]);
  const fine = run([dmg("1d4"), dmg("1d4")], { bonusDamage: { maxDicePerType: 4 } });
  assert.deepEqual(fine.roles.bonusDamage.map(e => e.dice), ["2d4"]); assert.deepEqual(fine.notes, []);
});
test("CAP damage: each damage type has its own budget", () => {
  const r = run([dmg("3d6", "fire"), dmg("3d6", "cold")], { bonusDamage: { maxDicePerType: 4 } });
  assert.deepEqual(r.roles.bonusDamage.map(e => e.dice), ["3d6", "3d6"]); assert.deepEqual(r.notes, []);
});
test("CAP resistance: the value per type is clamped", () => {
  const r = run([res("fire", 8), res("fire", 7), res("cold", 4)], { resistance: { maxValue: 10 } });
  assert.deepEqual(r.roles.resistance.map(e => `${e.type} ${e.value}`).sort(), ["cold 4", "fire 10"]);
  assert.deepEqual(r.notes, ["capped resistance (fire): 15 became 10"]);
});
test("CAP power: the tier is clamped", () => { const r = run([pow(5)], { basePower: { maxTier: 3 } }); assert.equal(r.roles.basePower, "T3"); assert.match(r.notes[0], /tier 5 became tier 3/); });
test("CAP abilities: only the first N are kept", () => {
  const r = run([abil("A"), abil("B"), abil("C")], { specialAbility: { maxCount: 2 } });
  assert.deepEqual(r.roles.specialAbility.map(a => a.title), ["A", "B"]); assert.equal(r.notes.length, 1);
});
test("CAP conditions: value per condition and the count are clamped", () => {
  const r = run([cond([{ condition: "frightened", value: 4, save: "will" }, { condition: "sickened", value: 1, save: "will" }, { condition: "clumsy", value: 1, save: "will" }])], { applyCondition: { maxValue: 2, maxCount: 2 } });
  assert.deepEqual(r.roles.applyCondition.map(e => `${e.condition} ${e.value}`), ["frightened 2", "sickened 1"]);
  assert.equal(r.notes.length, 2);
});
test("A CAP CLAMPS ONLY ITS OWN ROLE: a tiny damage cap leaves resistances, abilities and conditions alone (and the other way round)", () => {
  const contributions = [dmg("6d6"), res("fire", 40), abil("A"), abil("B"), cond([{ condition: "frightened", value: 4, save: "will" }])];
  const onlyDamage = run(contributions, { bonusDamage: { maxDicePerType: 1 } });
  assert.equal(onlyDamage.roles.bonusDamage[0].dice, "1d6"); assert.equal(onlyDamage.roles.resistance[0].value, 40); assert.equal(onlyDamage.roles.specialAbility.length, 2); assert.equal(onlyDamage.roles.applyCondition[0].value, 4);
  const onlyResist = run(contributions, { resistance: { maxValue: 1 } });
  assert.equal(onlyResist.roles.resistance[0].value, 1); assert.equal(onlyResist.roles.bonusDamage[0].dice, "6d6"); assert.equal(onlyResist.roles.applyCondition[0].value, 4);
  assert.deepEqual(run(contributions, {}).notes, [], "no cap, no note");
});
test("A role with no contribution is absent from the result", () => { assert.deepEqual(Object.keys(run([dmg("1d4")]).roles), ["bonusDamage"]); assert.deepEqual(run([]).roles, {}); });

// the cap table -------------------------------------------------------------------------------------------------------------
test("CAPS TABLE: the defaults cover every role, the GM's values win field by field, the rest keep their default", () => {
  assert.deepEqual(CAP_ROLES.filter(r => r !== "spellPower" && !TAGS.defaultCaps[r]), []);
  const merged = mergeCaps({ v: 1, roles: { resistance: { maxValue: 20 }, applyCondition: { maxCount: 2 } } });
  assert.equal(merged.resistance.maxValue, 20); assert.equal(merged.applyCondition.maxCount, 2); assert.equal(merged.applyCondition.maxValue, TAGS.defaultCaps.applyCondition.maxValue);
  assert.equal(mergeCaps(null).bonusDamage.maxDicePerType, TAGS.defaultCaps.bonusDamage.maxDicePerType);
  assert.equal(TAGS.defaultCaps.resistance.maxValue, 10, "the defaults object was not changed by merging");
});
test("CAPS TABLE: an unknown role, an unknown cap, a non-integer, zero and too-large values are each refused", () => {
  assert.deepEqual(capsProblems({ v: 1, roles: { resistance: { maxValue: 10 } } }), []);
  assert.match(capsProblems({ v: 1, roles: { nonsense: { a: 1 } } })[0], /not a role that has a cap/);
  assert.match(capsProblems({ v: 1, roles: { resistance: { maxDice: 1 } } })[0], /no cap called "maxDice"/);
  for (const v of [0, -1, 1.5, "3", 100]) assert.match(capsProblems({ v: 1, roles: { resistance: { maxValue: v } } })[0], /whole number from 1 to 99/, String(v));
  assert.match(capsProblems({ v: 1, roles: { basePower: { maxTier: 6 } } })[0], /from 1 to 5/);
  assert.match(capsProblems({ v: 1, roles: { applyCondition: { maxValue: 9 } } })[0], /from 1 to 4/);
  assert.match(capsProblems({ v: 2, roles: {} })[0], /unknown shape/);
});
