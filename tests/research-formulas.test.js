import test from "node:test";
import assert from "node:assert/strict";
import { SNAPSHOT_KEYS, addFormula, findFormula, formulaRequirement, makeSnapshot, refreshSnapshots, removeFormula, reportFormulas, snapshotsEqual } from "../scripts/research/formulas.js";
import { prepareCraft } from "../scripts/crafting/prepare.js";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { buildStationList } from "../scripts/stations/join.js";
import { asPage, seedRecords, UUID, UUID_2 } from "./helpers.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const dagger = registry.recipe.get("dagger-spider-fang");
const longsword = registry.recipe.get("longsword-basic");
const withRecipes = recipes => ({ recipe: new Map(recipes.map(r => [r.id, r])) });

// The display copy (snapshot) keeps hidden recipe fields out of players' actor flags -------------
test("DISPLAY-COPY GUARD: a snapshot has exactly the allowed keys and none of the hidden recipe fields", () => {
  for (const recipe of [dagger, longsword]) {
    const snapshot = makeSnapshot(recipe);
    assert.deepEqual(Object.keys(snapshot).sort(), [...SNAPSHOT_KEYS].sort());
    for (const hidden of ["overrides", "output", "skillWhitelist", "researchProject", "itemTemplate", "id", "kind", "resultName", "baseRole"]) {
      assert.ok(!(hidden in snapshot), `snapshot must not contain "${hidden}"`);
    }
    for (const slot of snapshot.slots) assert.deepEqual(Object.keys(slot).sort(), ["drives", "name", "qty", "tierFloor"]);
  }
});

test("DISPLAY-COPY GUARD: nothing from the hidden fields leaks into the serialised snapshot", () => {
  const text = JSON.stringify(makeSnapshot(longsword));
  assert.doesNotMatch(text, /Compendium|Longsword"|1d6|spirit|fiend|arcana|occultism/);
  assert.ok(longsword.overrides.length > 0, "sanity: the longsword really has overrides to leak");
  assert.ok(Object.keys(longsword.output).length > 0);
});

test("a snapshot shows what a crafter needs: slots with their roles, tier floors and quantities, and the station", () => {
  const snapshot = makeSnapshot(dagger);
  assert.deepEqual(snapshot, {
    name: "Spider Fang Dagger", category: "weapon",
    slots: [
      { name: "blade", drives: ["basePower"], tierFloor: 1, qty: 1 },
      { name: "fang", drives: ["bonusDamage", "specialAbility"], tierFloor: 2, qty: 1 }
    ],
    stationCategory: "smithing", stationTierMin: 1
  });
});

test("snapshots validate against the formula schema, and the snapshot is a deep copy", () => {
  const entry = { recipeId: dagger.id, access: "owned", source: "research", snapshot: makeSnapshot(dagger) };
  assert.deepEqual(check(LIVE_SCHEMAS.formula, entry), []);
  entry.snapshot.slots[1].drives.push("x");
  assert.deepEqual(dagger.slots[1].drives, ["bonusDamage", "specialAbility"]);
  assert.ok(check(LIVE_SCHEMAS.formula, { recipeId: dagger.id, access: "owned", source: "gm", snapshot: { ...makeSnapshot(dagger), overrides: [] } }).length > 0, "the schema rejects extra snapshot fields too");
});

test("snapshotsEqual ignores key order but not content", () => {
  const a = makeSnapshot(dagger);
  const reordered = { stationTierMin: a.stationTierMin, stationCategory: a.stationCategory, slots: a.slots, category: a.category, name: a.name };
  assert.ok(snapshotsEqual(a, reordered));
  assert.ok(!snapshotsEqual(a, { ...a, stationTierMin: 3 }));
});

// Adding and removing ----------------------------------------------------------------------------
test("adding a formula records access, source and a snapshot", () => {
  const result = addFormula([], dagger, { access: "owned", source: "research" });
  assert.deepEqual([result.ok, result.change, result.list.length], [true, "added", 1]);
  assert.deepEqual(result.list[0], { recipeId: dagger.id, access: "owned", source: "research", snapshot: makeSnapshot(dagger) });
  assert.deepEqual(check(LIVE_SCHEMAS.formula, result.list[0]), []);
});

test("one entry per recipe: owned upgrades a loan, a loan never replaces owned", () => {
  const loan = addFormula([], dagger, { access: "loan", source: "commission" }).list;
  const upgraded = addFormula(loan, dagger, { access: "owned", source: "research" });
  assert.deepEqual([upgraded.change, upgraded.list.length, upgraded.list[0].access, upgraded.list[0].source], ["upgraded", 1, "owned", "research"]);
  const refused = addFormula(upgraded.list, dagger, { access: "loan" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /already owned; a loan cannot replace it/);
});

test("granting the same access again refreshes a stale snapshot, or changes nothing", () => {
  const list = addFormula([], dagger).list;
  assert.equal(addFormula(list, dagger).change, "unchanged");
  const stale = [{ ...list[0], snapshot: { ...list[0].snapshot, stationTierMin: 4 } }];
  const again = addFormula(stale, dagger);
  assert.equal(again.change, "refreshed");
  assert.equal(again.list[0].snapshot.stationTierMin, 1);
});

test("bad access values are refused; other formulas are untouched by adding", () => {
  assert.match(addFormula([], dagger, { access: "stolen" }).error, /"owned" or "loan"/);
  const list = addFormula(addFormula([], dagger).list, longsword).list;
  assert.deepEqual(list.map(e => e.recipeId), [dagger.id, longsword.id]);
});

test("removing a formula removes only that one, and complains about a missing one", () => {
  const list = addFormula(addFormula([], dagger).list, longsword).list;
  assert.deepEqual(removeFormula(list, dagger.id).list.map(e => e.recipeId), [longsword.id]);
  assert.match(removeFormula(list, "ghost").error, /no formula "ghost"/);
  assert.equal(findFormula(list, "ghost"), null);
});

// Editing a recipe afterwards -------------------------------------------------------------------------------
test("report: ok, stale after a recipe edit, and orphaned when the recipe is gone", () => {
  const list = [...addFormula([], dagger).list, ...addFormula([], longsword).list, { recipeId: "ghost", access: "owned", source: "gm", snapshot: { ...makeSnapshot(dagger), name: "Ghost Blade" } }];
  const rows = Object.fromEntries(reportFormulas(list, registry).map(r => [r.recipeId, r.status]));
  assert.deepEqual(rows, { [dagger.id]: "ok", [longsword.id]: "ok", ghost: "orphaned" });

  const edited = { ...dagger, slots: dagger.slots.map(s => (s.name === "fang" ? { ...s, qty: 2 } : s)) };
  const rows2 = Object.fromEntries(reportFormulas(list, withRecipes([edited, longsword])).map(r => [r.recipeId, r.status]));
  assert.equal(rows2[dagger.id], "stale");
  assert.equal(reportFormulas(list, registry).find(r => r.recipeId === "ghost").name, "Ghost Blade", "an orphan still shows its snapshot name");
});

test("an edit to a HIDDEN recipe field (overrides, outputs) does not make a snapshot stale", () => {
  const list = addFormula([], longsword).list;
  const edited = { ...longsword, output: { "1": UUID, "2": UUID_2, "3": UUID }, overrides: [], skillWhitelist: ["arcana"] };
  assert.equal(reportFormulas(list, withRecipes([edited]))[0].status, "ok");
});

test("a recipe without a snapshot (older data) counts as stale", () => {
  const list = [{ recipeId: dagger.id, access: "owned", source: "gm" }];
  assert.equal(reportFormulas(list, registry)[0].status, "stale");
});

test("refreshing updates stale copies, leaves good ones, and lists orphans without touching them", () => {
  const good = addFormula([], longsword).list[0];
  const stale = { ...addFormula([], dagger).list[0], snapshot: { ...makeSnapshot(dagger), stationTierMin: 4 } };
  const orphan = { recipeId: "ghost", access: "owned", source: "gm" };
  const { list, refreshed, orphaned } = refreshSnapshots([good, stale, orphan], registry);
  assert.deepEqual([refreshed, orphaned], [[dagger.id], ["ghost"]]);
  assert.equal(list[0], good, "the good entry is returned as-is");
  assert.equal(list[1].snapshot.stationTierMin, 1);
  assert.equal(list[2], orphan);
});

// Crafting needs the formula ----------------------------------------------------------------------------------
test("formulaRequirement: missing gives the helpful message; owned and loan both pass", () => {
  const missing = formulaRequirement([], dagger, "Aelwyn");
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'Aelwyn does not know the formula for "Spider Fang Dagger" (research it, or have the GM grant it)');
  assert.deepEqual(formulaRequirement(addFormula([], dagger).list, dagger, "A"), { ok: true, access: "owned" });
  assert.deepEqual(formulaRequirement(addFormula([], dagger, { access: "loan" }).list, dagger, "A"), { ok: true, access: "loan" });
  assert.equal(formulaRequirement(addFormula([], longsword).list, dagger, "A").ok, false, "a different formula does not count");
});

const base = buildStationList({ definitions: registry.station, towns: registry.town }).stations;
const STACKS = [{ stackId: "i", materialId: "iron", quantity: 5 }, { stackId: "f", materialId: "spider-fang", quantity: 5 }];
const prepare = (formulas, extra = {}) => prepareCraft({
  recipe: dagger, registry, selection: { blade: "iron", fang: "spider-fang" }, stacks: STACKS,
  outputs: { "1": UUID, "2": UUID_2, "3": UUID }, stations: base, crafterId: "aelwyn", townOf: () => "oakhaven",
  townName: id => id, nameOf: id => id, formulas, crafterName: "Aelwyn", ...extra
});

test("prepare: without the formula the craft is refused, reported with the other problems", () => {
  const result = prepare([]);
  assert.equal(result.ok, false);
  assert.equal(result.plan, null);
  assert.match(result.errors[0], /Aelwyn does not know the formula for "Spider Fang Dagger"/);
  const both = prepare([], { selection: { blade: "iron" } });
  assert.ok(both.errors.some(e => /does not know the formula/.test(e)) && both.errors.some(e => /slot "fang": no material selected/.test(e)));
});

test("prepare: with the formula it works, and the plan records how it was held", () => {
  const owned = prepare(addFormula([], dagger).list);
  assert.ok(owned.ok, owned.errors.join("|"));
  assert.equal(owned.plan.formulaAccess, "owned");
  assert.equal(owned.plan.provenance.formulaAccess, "owned");
  const loaned = prepare(addFormula([], dagger, { access: "loan" }).list);
  assert.ok(loaned.ok);
  assert.equal(loaned.plan.provenance.formulaAccess, "loan");
});

test("prepare: a formula for some OTHER recipe does not authorise this one", () => {
  assert.equal(prepare(addFormula([], longsword).list).ok, false);
});
