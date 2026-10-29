import test from "node:test";
import assert from "node:assert/strict";
import { STATIONS, TIER_RANGES } from "../scripts/config.js";
import { feeForTier } from "../scripts/stations/fees.js";
import { buildStationList, validateOwnedRecord } from "../scripts/stations/join.js";
import { effectiveTown, evaluateForRecipe, evaluateStations, selectStation, withArticle } from "../scripts/stations/reach.js";
import { prepareCraft } from "../scripts/crafting/prepare.js";
import { formatSummary } from "../scripts/crafting/summary.js";
import { formatError, loadDefinitions } from "../scripts/data/validate.js";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { asPage, seedRecords, source, UUID, UUID_2 } from "./helpers.js";

// Fixtures ---------------------------------------------------------------------
const station = (id, town, extra = {}) => ({
  id, name: id, category: "smithing", tier: 1, location: { type: "fixed", town }, owner: null, access: [], source: "public", ...extra
});
const kit = (id, holder, extra = {}) => ({
  id, name: id, category: "smithing", tier: 1, location: { type: "carried", holder }, owner: holder, access: [], source: "owned", ...extra
});
const TOWNS = { oakhaven: "Oakhaven", redhollow: "Redhollow" };
const NAMES = { aelwyn: "Aelwyn", borin: "Borin", cade: "Cade" };
const reach = (crafterId, stations, locations) => evaluateStations({
  crafterId, stations,
  townOf: id => locations[id] ?? null,
  townName: id => TOWNS[id] ?? id,
  nameOf: id => NAMES[id] ?? id
});
const byId = verdicts => Object.fromEntries(verdicts.map(v => [v.station.id, v]));
const RECIPE = { stationCategory: "smithing", stationTierMin: 2 };

// Fees --------------------------------------------------------------------------
test("fees are a pure function of the station's tier (placeholder table)", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(t => feeForTier(t)), [1, 5, 20, 80, 300]);
});

test("a tier with no configured fee throws instead of charging nothing", () => {
  assert.throws(() => feeForTier(9), RangeError);
  assert.throws(() => feeForTier(0), /no fee configured/);
  assert.equal(feeForTier(2, { feeByTier: { 2: 7 } }), 7);
});

test("config sanity: every station tier has a fee, fees never decrease, and the portable cap is a valid tier", () => {
  const { min, max } = TIER_RANGES.station;
  let previous = -1;
  for (let tier = min; tier <= max; tier++) {
    const fee = feeForTier(tier);
    assert.ok(fee >= previous, `fee for tier ${tier} (${fee}) dropped below tier ${tier - 1} (${previous})`);
    previous = fee;
  }
  assert.ok(STATIONS.portableTierCap >= min && STATIONS.portableTierCap <= max);
  assert.equal(STATIONS.portableTierCap, 2);
});

// Location -----------------------------------------------------------------------
test("location: actor override beats party location beats nowhere", () => {
  assert.equal(effectiveTown("a", { actorOverrides: { a: "redhollow" }, partyTown: "oakhaven" }), "redhollow");
  assert.equal(effectiveTown("a", { actorOverrides: { b: "redhollow" }, partyTown: "oakhaven" }), "oakhaven");
  assert.equal(effectiveTown("a", { partyTown: "oakhaven" }), "oakhaven");
  assert.equal(effectiveTown("a", {}), null);
  assert.equal(effectiveTown("a", { actorOverrides: { a: "" }, partyTown: "" }), null, "empty strings count as unset");
});

// Reachability ---------------------------------------------------------------------
test("a public fixed station is reachable only in its own town", () => {
  const stations = [station("forge", "oakhaven")];
  assert.equal(reach("aelwyn", stations, { aelwyn: "oakhaven" })[0].reachable, true);
  const away = reach("aelwyn", stations, { aelwyn: "redhollow" })[0];
  assert.equal(away.reachable, false);
  assert.match(away.reason, /you are in Redhollow, but it is in Oakhaven/);
  const nowhere = reach("aelwyn", stations, {})[0];
  assert.equal(nowhere.reachable, false);
  assert.match(nowhere.reason, /nowhere \(no location set\).*Oakhaven/);
});

test("an owned fixed station: owner and access list may use it, others may not", () => {
  const stations = [station("shop", "oakhaven", { owner: "borin", access: ["cade"] })];
  const here = { aelwyn: "oakhaven", borin: "oakhaven", cade: "oakhaven" };
  assert.equal(reach("borin", stations, here)[0].reachable, true);
  assert.equal(reach("cade", stations, here)[0].reachable, true);
  const denied = reach("aelwyn", stations, here)[0];
  assert.equal(denied.reachable, false);
  assert.match(denied.reason, /not on its access list \(owner: Borin\)/);
});

test("being on the access list does not help when you are in the wrong town", () => {
  const stations = [station("shop", "oakhaven", { owner: "borin", access: ["cade"] })];
  assert.equal(reach("cade", stations, { cade: "redhollow" })[0].reachable, false);
});

test("a carried kit: the holder always has it", () => {
  const verdict = reach("borin", [kit("kit", "borin")], { borin: "redhollow" })[0];
  assert.equal(verdict.reachable, true);
  assert.match(verdict.reason, /you carry it/);
});

test("a carried kit: someone on the access list can use it only while in the same place as the holder", () => {
  const stations = [kit("kit", "borin", { access: ["cade"] })];
  assert.equal(reach("cade", stations, { borin: "oakhaven", cade: "oakhaven" })[0].reachable, true);
  const apart = reach("cade", stations, { borin: "oakhaven", cade: "redhollow" })[0];
  assert.equal(apart.reachable, false);
  assert.match(apart.reason, /its holder Borin is in Oakhaven, and you are in Redhollow/);
});

test("a carried kit: 'no location' counts as together", () => {
  assert.equal(reach("cade", [kit("kit", "borin", { access: ["cade"] })], {})[0].reachable, true);
  const split = reach("cade", [kit("kit", "borin", { access: ["cade"] })], { borin: "oakhaven" })[0];
  assert.equal(split.reachable, false);
  assert.match(split.reason, /you are in nowhere \(no location set\)/);
});

test("a carried kit: people not on the access list cannot use it", () => {
  const verdict = reach("aelwyn", [kit("kit", "borin")], { aelwyn: "oakhaven", borin: "oakhaven" })[0];
  assert.equal(verdict.reachable, false);
  assert.match(verdict.reason, /carried by Borin and you are not on its access list/);
});

// Recipe requirements -----------------------------------------------------------------
test("category mismatch is reported (and checked before tier)", () => {
  const stations = [station("apoth", "oakhaven", { category: "alchemy", tier: 1 })];
  const [v] = evaluateForRecipe(reach("aelwyn", stations, { aelwyn: "oakhaven" }), RECIPE);
  assert.equal(v.usable, false);
  assert.match(v.reason, /it is an alchemy station, but the recipe needs smithing/);
});

test("the article before a category agrees with it (a smithing, an alchemy)", () => {
  assert.equal(withArticle("smithing"), "a smithing");
  assert.equal(withArticle("alchemy"), "an alchemy");
  assert.equal(withArticle("Enchanting"), "an Enchanting");
  assert.equal(withArticle("tailoring"), "a tailoring");
});

test("a station whose tier is below the recipe minimum is reported", () => {
  const [v] = evaluateForRecipe(reach("aelwyn", [station("forge", "oakhaven", { tier: 1 })], { aelwyn: "oakhaven" }), RECIPE);
  assert.equal(v.usable, false);
  assert.match(v.reason, /its tier 1 is below the recipe's minimum of 2/);
});

test("a station at or above the minimum tier is usable; higher tiers are fine", () => {
  const stations = [station("t2", "oakhaven", { tier: 2 }), station("t4", "oakhaven", { tier: 4 })];
  const verdicts = evaluateForRecipe(reach("aelwyn", stations, { aelwyn: "oakhaven" }), RECIPE);
  assert.deepEqual(verdicts.map(v => v.usable), [true, true]);
});

test("an unreachable station keeps its location reason and is never usable", () => {
  const [v] = evaluateForRecipe(reach("aelwyn", [station("forge", "oakhaven", { tier: 3 })], { aelwyn: "redhollow" }), RECIPE);
  assert.equal(v.usable, false);
  assert.match(v.reason, /you are in Redhollow/);
});

// Selection ------------------------------------------------------------------------------
const verdictsFor = (stations, locations = { aelwyn: "oakhaven" }) => evaluateForRecipe(reach("aelwyn", stations, locations), RECIPE);

test("selection: exactly one usable station is chosen automatically", () => {
  const verdicts = verdictsFor([station("forge", "oakhaven", { tier: 2 }), station("far", "redhollow", { tier: 2 })]);
  const result = selectStation({ verdicts, recipe: RECIPE });
  assert.equal(result.ok, true);
  assert.equal(result.station.id, "forge");
});

test("selection: several usable stations are never guessed; the error lists them", () => {
  const verdicts = verdictsFor([station("a", "oakhaven", { tier: 2 }), kit("b", "aelwyn", { tier: 2 })]);
  const result = selectStation({ verdicts, recipe: RECIPE });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /several stations are usable/);
  assert.match(result.errors[0], /id "a", tier 2/);
  assert.match(result.errors[0], /id "b", tier 2/);
  assert.match(result.errors[0], /station: "<id>"/);
});

test("selection: an explicit id picks among several", () => {
  const verdicts = verdictsFor([station("a", "oakhaven", { tier: 2 }), kit("b", "aelwyn", { tier: 2 })]);
  assert.equal(selectStation({ verdicts, recipe: RECIPE, requestedId: "b" }).station.id, "b");
});

test("selection: an explicit id that cannot be used explains why", () => {
  const verdicts = verdictsFor([station("low", "oakhaven", { tier: 1 })]);
  const result = selectStation({ verdicts, recipe: RECIPE, requestedId: "low" });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /station "low" cannot be used for this recipe: its tier 1 is below/);
});

test("selection: an unknown id lists the known ones", () => {
  const result = selectStation({ verdicts: verdictsFor([station("a", "oakhaven", { tier: 2 })]), recipe: RECIPE, requestedId: "nope" });
  assert.match(result.errors[0], /unknown station "nope" \(known: a\)/);
});

test("selection: with nothing usable, the error gives each station's reason", () => {
  const verdicts = verdictsFor([
    station("far", "redhollow", { name: "Redhollow Forge", tier: 2 }),
    station("apoth", "oakhaven", { name: "Apothecary", category: "alchemy" }),
    station("low", "oakhaven", { name: "Tiny Forge", tier: 1 })
  ]);
  const { errors } = selectStation({ verdicts, recipe: RECIPE });
  assert.match(errors[0], /no usable smithing station \(tier 2\+\)/);
  assert.match(errors[0], /Redhollow Forge: you are in Oakhaven, but it is in Redhollow/);
  assert.match(errors[0], /Apothecary: it is an alchemy station/);
  assert.match(errors[0], /Tiny Forge: its tier 1 is below/);
});

test("selection: no stations at all is its own message", () => {
  assert.deepEqual(selectStation({ verdicts: [], recipe: RECIPE }).errors, ["no stations are defined"]);
});

// The join ------------------------------------------------------------------------------------
const towns = new Map(Object.entries(TOWNS).map(([id, name]) => [id, { id, name }]));
const defs = new Map([
  ["forge", { id: "forge", name: "Forge", category: "smithing", tier: 2, town: "oakhaven" }],
  ["lab", { id: "lab", name: "Lab", category: "alchemy", tier: 1, town: "redhollow" }]
]);
const join = (extra = {}) => buildStationList({ definitions: defs, towns, actorName: id => NAMES[id] ?? id, ...extra });
const ids = result => result.stations.map(s => s.id).sort();
const record = (extra = {}) => ({
  id: "mine", name: "My Kit", category: "smithing", tier: 1,
  location: { type: "carried", holder: "borin" }, owner: "borin", access: [], ...extra
});

test("join: with no world state, definitions are public stations", () => {
  const { stations, errors } = join();
  assert.deepEqual(errors, []);
  assert.deepEqual(ids({ stations }), ["forge", "lab"]);
  assert.deepEqual(stations.find(s => s.id === "forge"), {
    id: "forge", name: "Forge", category: "smithing", tier: 2,
    location: { type: "fixed", town: "oakhaven" }, owner: null, access: [], source: "public", upgrades: { craftDays: 0, hearths: 0 }
  });
});

test("join: world state sets owner and access, and its tier overrides the definition's", () => {
  const { stations, errors } = join({ stateEntries: [{ stationId: "forge", owner: "borin", access: ["cade"], tier: 3 }] });
  assert.deepEqual(errors, []);
  const forge = stations.find(s => s.id === "forge");
  assert.deepEqual([forge.owner, forge.access, forge.tier], ["borin", ["cade"], 3]);
  assert.equal(stations.find(s => s.id === "lab").tier, 1, "other stations are untouched");
});

test("join: a state entry without a tier keeps the definition's tier", () => {
  assert.equal(join({ stateEntries: [{ stationId: "forge", access: [] }] }).stations.find(s => s.id === "forge").tier, 2);
});

test("join: a state entry for an unknown station is an error and changes nothing", () => {
  const { stations, errors } = join({ stateEntries: [{ stationId: "ghost", access: [] }] });
  assert.equal(stations.length, 2);
  assert.match(formatError(errors[0]), /stationState.*"ghost".*unknown station "ghost"/);
});

test("join: a duplicate state entry removes the station until fixed (fail closed)", () => {
  const { stations, errors } = join({ stateEntries: [{ stationId: "forge", owner: "borin", access: [] }, { stationId: "forge", access: [] }] });
  assert.deepEqual(ids({ stations }), ["lab"]);
  assert.match(errors[0].message, /more than once/);
});

test("join: an owner who is not an actor removes the station rather than making it public", () => {
  const { stations, errors } = join({ stateEntries: [{ stationId: "forge", owner: "deleted", access: [] }], actorExists: id => id !== "deleted" });
  assert.deepEqual(ids({ stations }), ["lab"]);
  assert.match(errors[0].message, /"deleted" is not an actor/);
});

test("join: an invalid state entry removes its station and names the field", () => {
  const { stations, errors } = join({ stateEntries: [{ stationId: "forge", tier: 9 }] });
  assert.ok(!ids({ stations }).includes("forge"));
  assert.ok(errors.some(e => e.field === "tier"), errors.map(formatError).join(" | "));
  assert.ok(errors.some(e => e.field === "access"));
});

test("join: owned carried kits and fixed workshops are added with their owner", () => {
  const fixedShop = record({ id: "shop", name: "Shop", location: { type: "fixed", town: "redhollow" }, access: ["cade"] });
  const { stations, errors } = join({ ownedByActor: new Map([["borin", [record(), fixedShop]]]) });
  assert.deepEqual(errors, []);
  assert.deepEqual(ids({ stations }), ["forge", "lab", "mine", "shop"]);
  const shop = stations.find(s => s.id === "shop");
  assert.deepEqual([shop.source, shop.owner, shop.access, shop.location], ["owned", "borin", ["cade"], { type: "fixed", town: "redhollow" }]);
  assert.equal(stations.find(s => s.id === "mine").location.holder, "borin");
});

test("join: a carried kit above the portable cap is an error and is excluded", () => {
  const { stations, errors } = join({ ownedByActor: new Map([["borin", [record({ tier: 3 })]]]) });
  assert.ok(!ids({ stations }).includes("mine"));
  assert.equal(errors.length, 1);
  assert.match(formatError(errors[0]), /\(actor: Borin\)\] "mine": field "tier" is 3, which exceeds the portable station cap of 2/);
});

test("join: the portable cap is configurable", () => {
  const owned = new Map([["borin", [record({ tier: 3 })]]]);
  assert.equal(join({ ownedByActor: owned, config: { ...STATIONS, portableTierCap: 3 } }).errors.length, 0);
  assert.equal(join({ ownedByActor: new Map([["borin", [record({ tier: 2 })]]]), config: { ...STATIONS, portableTierCap: 1 } }).errors.length, 1);
});

test("join: a holder or owner that is not the storing actor is an error", () => {
  const wrongHolder = record({ location: { type: "carried", holder: "cade" }, owner: undefined });
  const wrongOwner = record({ id: "other", owner: "cade" });
  const { errors } = join({ ownedByActor: new Map([["borin", [wrongHolder, wrongOwner]]]) });
  assert.ok(errors.some(e => e.field === "location.holder"));
  assert.ok(errors.some(e => e.field === "owner"));
});

test("join: a fixed workshop needs an owner and a defined town", () => {
  const noOwner = record({ id: "w1", location: { type: "fixed", town: "oakhaven" }, owner: undefined });
  const badTown = record({ id: "w2", location: { type: "fixed", town: "atlantis" } });
  const { errors } = join({ ownedByActor: new Map([["borin", [noOwner, badTown]]]) });
  assert.ok(errors.some(e => e.entry === "w1" && e.field === "owner" && /required/.test(e.message)));
  assert.ok(errors.some(e => e.entry === "w2" && /town "atlantis" is not defined/.test(e.message)));
});

test("join: ids must be unique across definitions and actors", () => {
  const clashWithDefinition = record({ id: "forge" });
  const dupA = record({ id: "kit1" });
  const dupB = record({ id: "kit1", location: { type: "carried", holder: "cade" }, owner: "cade" });
  const { stations, errors } = join({ ownedByActor: new Map([["borin", [clashWithDefinition, dupA]], ["cade", [dupB]]]) });
  assert.equal(errors.filter(e => e.field === "id").length, 2);
  assert.equal(stations.filter(s => s.id === "forge").length, 1);
  assert.equal(stations.find(s => s.id === "forge").source, "public");
  assert.equal(stations.filter(s => s.id === "kit1").length, 1);
});

test("join: a malformed flag and malformed records are reported without throwing", () => {
  const { errors } = join({ ownedByActor: new Map([["borin", "not a list"], ["cade", [{ id: "bad" }, null]]]) });
  assert.ok(errors.some(e => e.field === "(flag)"));
  assert.ok(errors.length >= 3);
});

test("join: a definition naming an unknown town is skipped with an error", () => {
  const broken = new Map([["x", { id: "x", name: "X", category: "smithing", tier: 1, town: "atlantis" }]]);
  const { stations, errors } = buildStationList({ definitions: broken, towns });
  assert.deepEqual(stations, []);
  assert.match(errors[0].message, /town "atlantis" is not defined/);
});

test("validateOwnedRecord: a clean record has no problems", () => {
  assert.deepEqual(validateOwnedRecord(record(), "borin", { towns }), []);
});

// Definitions: the new `town` kind and station -> town references ---------------------------------
test("the seed defines two towns and three stations, all valid", () => {
  const { registry, errors } = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })));
  assert.deepEqual(errors, [], errors.map(formatError).join(" | "));
  assert.deepEqual([...registry.town.keys()].sort(), ["oakhaven", "redhollow"]);
  assert.deepEqual([...registry.station.keys()].sort(), ["oakhaven-apothecary", "oakhaven-forge", "redhollow-forge"]);
});

test("a station naming an undefined town fails loudly at load time", () => {
  const town = { kind: "town", id: "oakhaven", name: "Oakhaven" };
  const st = { kind: "station", id: "forge", name: "Forge", category: "smithing", tier: 1, town: "oakhavn" };
  const { errors, registry } = loadDefinitions([source(town), source(st)]);
  assert.equal(errors.length, 1);
  assert.match(formatError(errors[0]), /"forge": field "town" town "oakhavn" is not defined \(known towns: oakhaven\)/);
  assert.equal(registry.station.size, 0);
});

test("stationState schema: access is required, tier must be a valid station tier", () => {
  const ok = { stationId: "forge", owner: "a1", access: [], tier: 2 };
  assert.deepEqual(check(LIVE_SCHEMAS.stationState, ok), []);
  assert.deepEqual(check(LIVE_SCHEMAS.stationState, { stationId: "forge", access: [] }), []);
  assert.ok(check(LIVE_SCHEMAS.stationState, { stationId: "forge" }).some(e => e.field === "access"));
  assert.ok(check(LIVE_SCHEMAS.stationState, { ...ok, tier: 6 }).some(e => e.field === "tier"));
});

// prepareCraft: materials + station + fee together ---------------------------------------------------
const seed = () => loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const OUTPUTS = { "1": UUID, "2": UUID_2, "3": UUID };
const DAGGER_STACKS = [{ stackId: "i", materialId: "iron", quantity: 5 }, { stackId: "f", materialId: "spider-fang", quantity: 5 }];
const DAGGER_SEL = { blade: "iron", fang: "spider-fang" };

function prepare({ recipeId = "dagger-spider-fang", locations, stations, requestedStationId, selection = DAGGER_SEL, stacks = DAGGER_STACKS, formulas }) {
  const registry = seed();
  const list = stations ?? buildStationList({ definitions: registry.station, towns: registry.town }).stations;
  return prepareCraft({
    recipe: registry.recipe.get(recipeId), registry, selection, stacks, outputs: OUTPUTS,
    stations: list, crafterId: "aelwyn", townOf: id => locations[id] ?? null,
    townName: id => TOWNS[id] ?? id, nameOf: id => NAMES[id] ?? id, requestedStationId,
    formulas: formulas ?? [{ recipeId, access: "owned", source: "test" }], crafterName: "Aelwyn"
  });
}

test("prepare: in Oakhaven a dagger uses the Oakhaven Forge and pays the tier-2 fee", () => {
  const result = prepare({ locations: { aelwyn: "oakhaven" } });
  assert.ok(result.ok, result.errors.join(" | "));
  assert.equal(result.plan.station.id, "oakhaven-forge");
  assert.equal(result.plan.fee, 5);
  assert.equal(result.stations.chosen.id, "oakhaven-forge");
  assert.equal(result.plan.provenance.stationId, "oakhaven-forge");
});

test("prepare: in Redhollow the same dagger uses the tier-1 forge and pays 1 gp", () => {
  const result = prepare({ locations: { aelwyn: "redhollow" } });
  assert.ok(result.ok, result.errors.join(" | "));
  assert.equal(result.plan.station.id, "redhollow-forge");
  assert.equal(result.plan.fee, 1);
});

test("prepare: the longsword needs a tier-2 station, so Redhollow's tier-1 forge is too low", () => {
  const result = prepare({
    recipeId: "longsword-basic", locations: { aelwyn: "redhollow" },
    selection: { blade: "iron", coating: "silver", core: "starmetal" },
    stacks: [{ stackId: "i", materialId: "iron", quantity: 2 }, { stackId: "s", materialId: "silver", quantity: 1 }, { stackId: "m", materialId: "starmetal", quantity: 1 }]
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Redhollow Forge: its tier 1 is below the recipe's minimum of 2/);
});

test("prepare: nowhere to craft is reported together with material problems", () => {
  const result = prepare({ locations: {}, selection: { blade: "iron" } });
  assert.equal(result.ok, false);
  assert.equal(result.plan, null);
  assert.ok(result.errors.some(e => /no usable smithing station/.test(e)));
  assert.ok(result.errors.some(e => /slot "fang": no material selected/.test(e)));
});

test("prepare: wrong category shows up for the apothecary in the verdicts", () => {
  const { stations } = prepare({ locations: { aelwyn: "oakhaven" } });
  const apothecary = stations.verdicts.find(v => v.station.id === "oakhaven-apothecary");
  assert.equal(apothecary.usable, false);
  assert.match(apothecary.reason, /alchemy station, but the recipe needs smithing/);
});

test("prepare: a carried kit alongside the forge makes the choice explicit", () => {
  const registry = seed();
  const base = buildStationList({ definitions: registry.station, towns: registry.town }).stations;
  const stations = [...base, kit("my-kit", "aelwyn", { name: "Smith's Kit", tier: 1 })];
  const ambiguous = prepare({ locations: { aelwyn: "oakhaven" }, stations });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.errors[0], /several stations are usable.*oakhaven-forge.*my-kit/);

  const forge = prepare({ locations: { aelwyn: "oakhaven" }, stations, requestedStationId: "oakhaven-forge" });
  assert.equal(forge.plan.fee, 5);
  const portable = prepare({ locations: { aelwyn: "oakhaven" }, stations, requestedStationId: "my-kit" });
  assert.equal(portable.plan.fee, 1);
});

test("prepare: an access list can lock the crafter out, leaving only the wrong-category station", () => {
  const registry = seed();
  const { stations } = buildStationList({
    definitions: registry.station, towns: registry.town,
    stateEntries: [{ stationId: "oakhaven-forge", owner: "borin", access: [] }]
  });
  const result = prepare({ locations: { aelwyn: "oakhaven" }, stations });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Oakhaven Forge: you are not on its access list \(owner: Borin\)/);
  assert.match(result.errors[0], /Oakhaven Apothecary: it is an alchemy station/);
});

test("the chat summary names the station used", () => {
  const plan = { recipeName: "Dagger", resultName: null, station: { name: "Oakhaven Forge", tier: 2 }, uses: [] };
  const outcome = { degree: "success", made: true, feeConsumed: 5, summary: { unitsUsed: 2, unitsKept: 0 } };
  const text = formatSummary({ crafterName: "Aelwyn", plan, outcome, itemName: "Dagger" });
  assert.match(text, /Station: Oakhaven Forge \(tier 2\)/);
  assert.match(text, /Fee paid: 5 gp/);
});
