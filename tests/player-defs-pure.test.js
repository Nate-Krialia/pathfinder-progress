/**
 * Stage 16 (pure half): which definitions a player needs, what is stripped from their copy, and how a delivered set is loaded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";
import { PLAYER_KINDS, emptyRegistry, factsKey, loadPlayerRecords, normalizeFacts, selectRecords, stripForPlayer } from "../scripts/data/playerSet.js";
import { PLAYER_SCHEMAS, DEFINITION_SCHEMAS } from "../scripts/data/schemas.js";
import { check } from "../scripts/data/schema.js";

const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const ids = (set, kind) => set.records.filter(r => r.kind === kind).map(r => r.data.id).sort();
const facts = (over = {}, actor = {}) => ({ actors: [{ id: "a1", formulas: [], blueprints: [], designs: [], materials: [], stations: [], towns: [], ...actor }], location: null, sceneTags: [], nodeTypes: [], stationTowns: [], stateStations: [], ...over });

test("the seed has what these tests lean on (a recipe not held, a blueprint, two regions, a node type with ladders)", () => {
  assert.ok(registry.recipe.size >= 2 && registry.blueprint.size >= 1 && registry.region.size >= 2);
  assert.ok(registry.nodeType.get("herb").ladders && registry.nodeType.get("herb").charges);
  assert.ok(registry.region.get("oak-wood").spawnTable && registry.region.get("oak-wood").explorationDC);
});

test("a recipe is loaded ONLY for a character who holds its formula (owned or loaned alike)", () => {
  const none = selectRecords(facts(), registry);
  assert.deepEqual(ids(none, "recipe"), []);
  const held = selectRecords(facts({}, { formulas: ["dagger-spider-fang"] }), registry);
  assert.deepEqual(ids(held, "recipe"), ["dagger-spider-fang"], "held: loaded, and no other recipe comes with it");
  assert.equal(registry.recipe.has("longsword-basic"), true);
  // Two characters of one user: the union
  const two = selectRecords({ ...facts(), actors: [{ id: "a1", formulas: ["dagger-spider-fang"] }, { id: "a2", formulas: ["longsword-basic"] }] }, registry);
  assert.deepEqual(ids(two, "recipe"), ["dagger-spider-fang", "longsword-basic"]);
});

test("a formula held with no recipe anywhere is reported as missing (the only time 'orphaned' is true), and sends nothing for it", () => {
  const set = selectRecords(facts({}, { formulas: ["ghost", "dagger-spider-fang"] }), registry);
  assert.deepEqual(set.missingRecipes, ["ghost"]);
  assert.deepEqual(ids(set, "recipe"), ["dagger-spider-fang"]);
  assert.deepEqual(set.recipeIds, ["dagger-spider-fang", "ghost"]);
});

test("a blueprint is loaded when the design is held or being researched, and not otherwise", () => {
  const id = [...registry.blueprint.keys()][0];
  assert.deepEqual(ids(selectRecords(facts(), registry), "blueprint"), []);
  assert.deepEqual(ids(selectRecords(facts({}, { blueprints: [id] }), registry), "blueprint"), [id]);
  assert.deepEqual(ids(selectRecords(facts({}, { designs: [id] }), registry), "blueprint"), [id]);
});

test("materials: only those the character has (inventory, Compendium, projects, escrow); never one they have not met", () => {
  const set = selectRecords(facts({}, { materials: ["iron", "no-such-material"] }), registry);
  assert.deepEqual(ids(set, "material"), ["iron"]);
  assert.ok(registry.material.size > 1, "and the registry has more than that");
});

test("stations and towns follow the party's town, workshops they own, saved state naming them and projects about a station", () => {
  const here = selectRecords(facts({ location: "oakhaven" }), registry);
  assert.ok(ids(here, "station").every(id => registry.station.get(id).town === "oakhaven") && ids(here, "station").length >= 1);
  assert.deepEqual(ids(here, "town"), ["oakhaven"]);
  assert.equal(ids(here, "station").includes("redhollow-forge"), false, "a station in another town is not loaded");
  const away = selectRecords(facts({ location: null }), registry);
  assert.deepEqual(ids(away, "station"), [], "nowhere in particular: no stations");
  const viaProject = selectRecords(facts({}, { stations: ["redhollow-forge"] }), registry);
  assert.deepEqual(ids(viaProject, "station"), ["redhollow-forge"]);
  assert.ok(ids(viaProject, "town").includes("redhollow"), "its town comes with it, so the station can be placed");
  const viaState = selectRecords(facts({ stateStations: ["redhollow-forge"] }), registry);
  assert.deepEqual(ids(viaState, "station"), ["redhollow-forge"]);
  const viaOwnWorkshop = selectRecords(facts({ stationTowns: ["redhollow"] }), registry);
  assert.ok(ids(viaOwnWorkshop, "station").includes("redhollow-forge") && ids(viaOwnWorkshop, "town").includes("redhollow"));
  const viaBuild = selectRecords(facts({}, { towns: ["oakhaven"] }), registry);
  assert.deepEqual(ids(viaBuild, "town"), ["oakhaven"]);
});

test("regions are those tagged on a scene in play, and the node types are those of revealed nodes there; the rest are not loaded", () => {
  const set = selectRecords(facts({ sceneTags: ["oak-wood"], nodeTypes: ["herb"] }), registry);
  assert.deepEqual(ids(set, "region"), ["oak-wood"]);
  assert.deepEqual(ids(set, "nodeType"), ["herb"]);
  assert.deepEqual(ids(selectRecords(facts({ sceneTags: ["no-such-tag"] }), registry), "region"), []);
});

test("STRIPPED: the player copy of a region has no spawnTable and no explorationDC, a node type no ladders and no charges; nothing else is lost", () => {
  const set = selectRecords(facts({ sceneTags: ["oak-wood"], nodeTypes: ["herb"] }), registry);
  const region = set.records.find(r => r.kind === "region").data;
  const nodeType = set.records.find(r => r.kind === "nodeType").data;
  assert.equal("spawnTable" in region, false);
  assert.equal("explorationDC" in region, false, "docs/11b: no DC in the player copy (the explore row no longer carries it either)");
  assert.equal("ladders" in nodeType, false);
  assert.equal("charges" in nodeType, false);
  const full = registry.region.get("oak-wood");
  for (const key of ["id", "name", "sceneTag", "skillWhitelist", "daysRequired", "danger"]) assert.deepEqual(region[key], full[key], `${key} is kept`);
  assert.deepEqual(nodeType.skills, registry.nodeType.get("herb").skills);
  assert.equal(nodeType.name, registry.nodeType.get("herb").name);
  // and the strip is a COPY: the GM's records are untouched
  assert.ok(full.spawnTable && full.explorationDC, "the GM's region still has them");
  assert.ok(registry.nodeType.get("herb").ladders && registry.nodeType.get("herb").charges, "and so does the GM's node type");
});

test("STRIPPED: selecting never mutates the GM registry", () => {
  const before = JSON.stringify([...Object.entries(registry)].map(([k, m]) => [k, [...m.values()]]));
  selectRecords(facts({ location: "oakhaven", sceneTags: ["oak-wood", "barren-ridge"], nodeTypes: ["herb", "ore"] }, { formulas: ["dagger-spider-fang"], materials: ["iron"] }), registry);
  assert.equal(JSON.stringify([...Object.entries(registry)].map(([k, m]) => [k, [...m.values()]])), before);
});

test("the player schemas are strict: a region that still carries a stripped field, or a GM-only kind, does not load", () => {
  const full = registry.region.get("oak-wood");
  const stripped = stripForPlayer("region", full);
  assert.deepEqual(check(PLAYER_SCHEMAS.region, stripped), []);
  assert.notDeepEqual(check(PLAYER_SCHEMAS.region, full), [], "the full GM region is not a valid player region");
  assert.deepEqual(check(DEFINITION_SCHEMAS.region, full), [], "and it is still a valid GM region");
  assert.notDeepEqual(check(DEFINITION_SCHEMAS.region, stripped), [], "while a stripped one is not a valid GM region (spawnTable is required there)");
  const bad = loadPlayerRecords([{ kind: "region", data: full }, { kind: "customRole", data: { kind: "customRole", id: "x" } }, { kind: "region", data: stripped }]);
  assert.deepEqual([...bad.registry.region.keys()], ["oak-wood"]);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0], /^region "oak-wood"/);
  assert.match(bad.errors[1], /creature|customRole/);
});

test("loadPlayerRecords: a delivered set loads into a registry with every kind present (empty when nothing came)", () => {
  const set = selectRecords(facts({ location: "oakhaven", sceneTags: ["oak-wood"] }, { formulas: ["dagger-spider-fang"], materials: ["iron"] }), registry);
  const { registry: loaded, errors } = loadPlayerRecords(set.records);
  assert.deepEqual(errors, []);
  assert.deepEqual([...loaded.recipe.keys()], ["dagger-spider-fang"]);
  assert.deepEqual([...loaded.material.keys()], ["iron"]);
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(emptyRegistry()).sort());
  assert.equal(loaded.creatureYield.size, 0);
  assert.deepEqual(Object.keys(loadPlayerRecords(undefined).registry.recipe), []);
  assert.deepEqual(PLAYER_KINDS.sort(), ["blueprint", "material", "nodeType", "recipe", "region", "station", "town"]);
});

test("facts compare equal when they mean the same: order and duplicates do not change the key, a real change does", () => {
  const a = facts({ sceneTags: ["b", "a", "a"] }, { formulas: ["y", "x"], materials: ["iron", "iron"] });
  const b = facts({ sceneTags: ["a", "b"] }, { formulas: ["x", "y"], materials: ["iron"] });
  assert.equal(factsKey(a), factsKey(b));
  assert.notEqual(factsKey(a), factsKey(facts({ sceneTags: ["a", "b"] }, { formulas: ["x"], materials: ["iron"] })));
  assert.deepEqual(normalizeFacts(undefined), { actors: [], location: null, sceneTags: [], nodeTypes: [], stationTowns: [], stateStations: [] });
});
