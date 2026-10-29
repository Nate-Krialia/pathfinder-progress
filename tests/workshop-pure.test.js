/** Stage 10c, the pure parts: upgrade planning, material choice, project building, blueprint build planning, party-station join. */
import test from "node:test";
import assert from "node:assert/strict";
import { check } from "../scripts/data/schema.js";
import { LIVE_SCHEMAS } from "../scripts/data/schemas.js";
import { craftDays } from "../scripts/crafting/days.js";
import { buildStationList } from "../scripts/stations/join.js";
import { RESEARCH, WORKSHOP } from "../scripts/config.js";
import {
  allocateFromStacks, buildDesignProject, buildUpgradeProject, checkUpgradeMaterials, levelsOf, planBuild, planUpgrade, stationReductions, tierCap,
  upgradeLabel, upgradePatch
} from "../scripts/workshop/rules.js";

const forge = (over = {}) => ({ id: "forge", name: "Oakhaven Forge", category: "smithing", tier: 2, location: { type: "fixed", town: "oakhaven" }, owner: null, access: [], source: "public", upgrades: { craftDays: 0, hearths: 0 }, ...over });
const kit = (over = {}) => forge({ id: "kit", name: "Travel Kit", tier: 1, location: { type: "carried", holder: "ann" }, source: "owned", ...over });
const defs = new Map([
  ["iron", { id: "iron", name: "Iron", tier: 1 }], ["silver", { id: "silver", name: "Silver", tier: 2 }], ["starmetal", { id: "starmetal", name: "Starmetal", tier: 3 }]
]);

// Planning ---------------------------------------------------------------------------------------------------------
test("a TIER upgrade raises the tier by one; a town workshop stops at 4 and a carried kit at the portable cap", () => {
  assert.deepEqual(planUpgrade(forge({ tier: 2 }), "tier"), { ok: true, kind: "tier", from: 2, to: 3, targetTier: 3, units: WORKSHOP.upgradeUnits[3] });
  assert.equal(planUpgrade(forge({ tier: 3 }), "tier").to, 4);
  assert.match(planUpgrade(forge({ tier: 4 }), "tier").error, /Oakhaven Forge is already at tier 4, the highest a workshop can reach \(4\)/);
  assert.equal(tierCap(forge()), 4);
  assert.equal(tierCap(kit()), 2);
  assert.equal(planUpgrade(kit({ tier: 1 }), "tier").ok, true);
  assert.match(planUpgrade(kit({ tier: 2 }), "tier").error, /Travel Kit is already at tier 2, the highest a carried kit can reach \(2\)/);
});

test("CRAFT DAYS and HEARTH upgrades go one level at a time up to their maximum; the target tier is the level reached", () => {
  const first = planUpgrade(forge(), "craftDays");
  assert.deepEqual([first.from, first.to, first.targetTier, first.units], [0, 1, 1, WORKSHOP.upgradeUnits[1]]);
  assert.equal(planUpgrade(forge({ upgrades: { craftDays: 2, hearths: 0 } }), "craftDays").targetTier, 3);
  assert.match(planUpgrade(forge({ upgrades: { craftDays: 3, hearths: 0 } }), "craftDays").error, /most craft-day cuts it can have \(3\)/);
  assert.match(planUpgrade(forge({ upgrades: { craftDays: 0, hearths: 3 } }), "hearth").error, /most hearths it can have \(3\)/);
  assert.equal(planUpgrade(forge(), "hearth").to, 1);
  assert.match(planUpgrade(forge(), "gold").error, /unknown upgrade "gold"/);
  assert.deepEqual(levelsOf(forge({ upgrades: { craftDays: 2, hearths: 1 } })), { tier: 2, craftDays: 2, hearth: 1 });
});

test("the HEARTH is labelled 'no effect yet' wherever it is described", () => {
  assert.match(upgradeLabel("hearth", 1), /no effect yet/);
  assert.equal(WORKSHOP.hearthNote, "no effect yet");
  assert.doesNotMatch(upgradeLabel("craftDays", 2), /no effect yet/);
  assert.deepEqual(upgradePatch("hearth", 2), { upgrades: { hearths: 2 } });
  assert.deepEqual(upgradePatch("craftDays", 1), { upgrades: { craftDays: 1 } });
  assert.deepEqual(upgradePatch("tier", 3), { tier: 3 });
});

// Materials -----------------------------------------------------------------------------------------------------------
const stacks = [{ stackId: "s1", materialId: "silver", quantity: 2 }, { stackId: "s2", materialId: "silver", quantity: 5 }, { stackId: "s3", materialId: "iron", quantity: 9 }];

test("upgrade materials must be of the TARGET tier, add up to exactly the units needed, and be in the stash", () => {
  const ok = checkUpgradeMaterials({ selection: { silver: 3 }, targetTier: 2, units: 3, stacks, materialDefs: defs });
  assert.deepEqual(ok, { ok: true, errors: [], materials: [{ materialId: "silver", qty: 3 }] });
  assert.match(checkUpgradeMaterials({ selection: { iron: 3 }, targetTier: 2, units: 3, stacks, materialDefs: defs }).errors[0], /Iron is tier 1, but this upgrade needs materials of tier 2/);
  assert.match(checkUpgradeMaterials({ selection: { silver: 9 }, targetTier: 2, units: 9, stacks, materialDefs: defs }).errors[0], /needs 9 Silver but only 7 available/);
  assert.match(checkUpgradeMaterials({ selection: { silver: 2 }, targetTier: 2, units: 3, stacks, materialDefs: defs }).errors[0], /needs 3 unit\(s\) of tier-2 materials \(you chose 2\)/);
  assert.match(checkUpgradeMaterials({ selection: { mithral: 1 }, targetTier: 2, units: 1, stacks, materialDefs: defs }).errors[0], /unknown material "mithral"/);
  assert.match(checkUpgradeMaterials({ selection: { silver: 1.5 }, targetTier: 2, units: 2, stacks, materialDefs: defs }).errors[0], /whole number of units/);
  assert.match(checkUpgradeMaterials({ selection: {}, targetTier: 2, units: 3, stacks, materialDefs: defs }).errors[0], /you chose 0/);
});

test("allocateFromStacks takes from stacks in order and never more than a stack holds", () => {
  assert.deepEqual(allocateFromStacks([{ materialId: "silver", qty: 3 }], stacks), { s1: 2, s2: 1 });
  assert.deepEqual(allocateFromStacks([{ materialId: "silver", qty: 7 }, { materialId: "iron", qty: 1 }], stacks), { s1: 2, s2: 5, s3: 1 });
});

// Projects -------------------------------------------------------------------------------------------------------------
test("an upgrade project is a valid research project whose difficulty SCALES with the target tier, with no gold", () => {
  const made = [2, 3, 4].map(to => buildUpgradeProject({ station: forge({ tier: to - 1 }), plan: planUpgrade(forge({ tier: to - 1 }), "tier"), materials: [{ materialId: "silver", qty: 3 }] }));
  for (const project of made) {
    assert.deepEqual(check(LIVE_SCHEMAS.project, project), []);
    assert.equal(project.fee, undefined, "no gold cost");
    assert.deepEqual(project.skillWhitelist, WORKSHOP.researchSkills);
  }
  assert.deepEqual(made.map(p => p.tier), [2, 3, 4]);
  assert.ok(made[0].dc < made[1].dc && made[1].dc < made[2].dc, "the DC rises with the tier");
  assert.ok(made[0].threshold < made[1].threshold && made[1].threshold < made[2].threshold, "so does the progress needed");
  assert.deepEqual(made[0].outcome, { type: "upgradeStation", stationId: "forge", kind: "tier", from: 1, to: 2 });
  assert.equal(made[0].id, "upgrade-forge-tier-2");
  assert.deepEqual(made[0].materials, [{ materialId: "silver", qty: 3 }]);
  assert.match(buildUpgradeProject({ station: forge(), plan: planUpgrade(forge(), "hearth"), materials: [] }).goalName, /hearth 1 \(no effect yet\)/);
});

test("a design project researches a blueprint, with no materials, scaling with the research tier", () => {
  const blueprint = { id: "camp-forge", name: "Camp Forge", tier: 1, researchProject: { tier: 1 } };
  const project = buildDesignProject({ blueprint });
  assert.deepEqual(check(LIVE_SCHEMAS.project, project), []);
  assert.deepEqual(project.outcome, { type: "designBlueprint", blueprintId: "camp-forge" });
  assert.equal(project.materials, undefined);
  assert.equal(project.threshold, RESEARCH.tiers[1].threshold);
  const harder = buildDesignProject({ blueprint: { ...blueprint, tier: 3, researchProject: { tier: 3 } } });
  assert.ok(harder.dc > project.dc && harder.threshold > project.threshold);
});

// Craft days ---------------------------------------------------------------------------------------------------------
test("a station's craft-day upgrades are reductions; craftDays() applies ALL of them and still never goes below 1", () => {
  assert.deepEqual(stationReductions(forge()), []);
  assert.deepEqual(stationReductions(forge({ upgrades: { craftDays: 2, hearths: 0 } })), [{ days: 2, source: "workshop upgrades" }]);
  assert.deepEqual(stationReductions(undefined), []);
  const recipe = { craftLevel: 6 };                                    // base 1 + 3 = 4 days
  assert.equal(craftDays(recipe, stationReductions(forge())).days, 4);
  assert.equal(craftDays(recipe, stationReductions(forge({ upgrades: { craftDays: 2, hearths: 0 } }))).days, 2);
  assert.equal(craftDays(recipe, [...stationReductions(forge({ upgrades: { craftDays: 3, hearths: 0 } })), { days: 5, source: "tools" }]).days, 1, "stacked reductions never go below 1");
});

// Building ---------------------------------------------------------------------------------------------------------
const blueprint = { id: "camp-forge", slots: [{ name: "anvil", tierFloor: 1, qty: 3 }, { name: "hearthstone", tierFloor: 2, qty: 1 }] };

test("a build matches materials to the blueprint's slots like a craft does: tier floors, one type per slot, real stock", () => {
  const ok = planBuild({ blueprint, selection: { anvil: "iron", hearthstone: "silver" }, stacks, materialDefs: defs });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.uses.map(u => [u.slot, u.materialId, u.units]), [["anvil", "iron", 3], ["hearthstone", "silver", 1]]);
  const bad = planBuild({ blueprint, selection: { anvil: "iron", hearthstone: "iron", roof: "iron" }, stacks, materialDefs: defs });
  assert.deepEqual(bad.errors, ['"roof" is not a slot of this blueprint', 'slot "hearthstone": Iron is tier 1 but the slot needs tier 2 or higher']);
  assert.match(planBuild({ blueprint, selection: { anvil: "iron" }, stacks, materialDefs: defs }).errors[0], /slot "hearthstone": no material selected/);
  assert.match(planBuild({ blueprint, selection: { anvil: "iron", hearthstone: "silver" }, stacks: [{ stackId: "x", materialId: "iron", quantity: 1 }], materialDefs: defs }).errors[0], /needs 3 Iron but only 1 available/);
  assert.match(planBuild({ blueprint, selection: { anvil: "mithral", hearthstone: "silver" }, stacks, materialDefs: defs }).errors[0], /unknown material "mithral"/);
});

// Join -------------------------------------------------------------------------------------------------------------------
const towns = new Map([["oakhaven", { id: "oakhaven", name: "Oakhaven" }], ["redhollow", { id: "redhollow", name: "Redhollow" }]]);
const definitions = new Map([["forge", { id: "forge", name: "Oakhaven Forge", category: "smithing", tier: 2, town: "oakhaven" }]]);
const partyRecord = (over = {}) => ({ id: "party-camp-1", name: "Camp Forge", category: "smithing", tier: 1, town: "oakhaven", builtBy: "ann", blueprintId: "camp-forge", builtAt: 1, ...over });

test("JOIN: a party workshop is fixed where it was built, owned by 'party', usable by the party's characters, with its upgrades", () => {
  const { stations, errors } = buildStationList({ definitions, towns, partyStations: [partyRecord({ upgrades: { craftDays: 1 } })], partyIds: ["ann", "bob"] });
  assert.deepEqual(errors, []);
  const camp = stations.find(s => s.id === "party-camp-1");
  assert.deepEqual(camp, {
    id: "party-camp-1", name: "Camp Forge", category: "smithing", tier: 1, location: { type: "fixed", town: "oakhaven" },
    owner: "party", access: ["ann", "bob"], source: "party", upgrades: { craftDays: 1, hearths: 0 }
  });
});

test("JOIN: a bad, duplicate or unplaceable party record is reported and left out", () => {
  const { stations, errors } = buildStationList({
    definitions, towns, partyIds: ["ann"],
    partyStations: [partyRecord({ town: "nowhere" }), partyRecord({ id: "forge" }), partyRecord({ tier: 9 }), partyRecord({ id: "ok" }), partyRecord({ id: "ok" })]
  });
  assert.deepEqual(stations.filter(s => s.source === "party").map(s => s.id), ["ok"]);
  assert.equal(errors.length, 4);
  assert.match(errors.map(e => e.message).join("\n"), /town "nowhere" is not defined/);
  assert.match(errors.map(e => e.message).join("\n"), /"forge" is already used by another station/);
  assert.equal(buildStationList({ definitions, towns, partyStations: "oops" }).errors[0].message, "must be a list of station records");
});

test("JOIN: a public station's upgrades come from its state entry; an owned record's from itself", () => {
  const pub = buildStationList({ definitions, towns, stateEntries: [{ stationId: "forge", access: [], upgrades: { craftDays: 2, hearths: 1 } }] });
  assert.deepEqual(pub.stations[0].upgrades, { craftDays: 2, hearths: 1 });
  assert.equal(pub.stations[0].owner, null, "an entry with only upgrades leaves it public");
  const owned = buildStationList({ definitions, towns, ownedByActor: new Map([["ann", [{ id: "k", name: "Kit", category: "smithing", tier: 1, location: { type: "carried", holder: "ann" }, owner: "ann", access: [], upgrades: { craftDays: 1 } }]]]) });
  assert.deepEqual(owned.stations.find(s => s.id === "k").upgrades, { craftDays: 1, hearths: 0 });
});
