import test from "node:test";
import assert from "node:assert/strict";
import { DefinitionError, extractJson, formatError, loadDefinitions, loadDefinitionsOrThrow, validateRecord } from "../scripts/data/validate.js";
import { MATERIAL, RECIPE, SILVER, asPage, clone, seedRecords, source } from "./helpers.js";

const PACK = "test.pack";
const run = (...records) => loadDefinitions(records.map(r => (typeof r === "object" && r.text ? r : source(r))));

/** Every error must name the pack, the entry, and the field. */
function assertNamesAll(error, { pack = PACK, entry, field }) {
  const line = formatError(error);
  assert.ok(line.includes(pack), `pack missing from: ${line}`);
  assert.ok(line.includes(entry), `entry missing from: ${line}`);
  assert.ok(line.includes(field), `field missing from: ${line}`);
}

test("the seed content passes validation with no errors", () => {
  const sources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  const { registry, errors } = loadDefinitions(sources);
  assert.deepEqual(errors, []);
  assert.equal(registry.material.size, 3);
  assert.equal(registry.recipe.size, 1);
  assert.ok(registry.material.has("iron") && registry.material.has("silver") && registry.material.has("starmetal"));
});

test("a valid set loads into the registry by kind", () => {
  const { registry, errors } = run(MATERIAL, SILVER, RECIPE);
  assert.deepEqual(errors, []);
  assert.equal(registry.material.get("silver").tier, 2);
  assert.equal(registry.recipe.get("blade").name, "Blade");
});

test("invalid JSON fails loudly, naming pack, entry and field", () => {
  const { errors } = run({ pack: PACK, entry: "Broken", text: "```json\n{ \"kind\": \"material\", \n```" });
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "Broken", field: "(json)" });
  assert.match(errors[0].message, /not valid JSON/);
});

test("a page with no JSON block fails loudly", () => {
  const { errors } = run({ pack: PACK, entry: "Prose", text: "Just some notes about iron." });
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "Prose", field: "(page text)" });
});

test("an unknown kind is rejected", () => {
  const { errors } = run({ kind: "banana", id: "x" });
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "x", field: "kind" });
});

const BAD_CASES = [
  ["tier out of range", { ...MATERIAL, tier: 9 }, "tier", /at most/],
  ["missing id", (() => { const m = clone(MATERIAL); delete m.id; return m; })(), "id", /required/],
  ["id not a slug", { ...MATERIAL, id: "Iron Ore!" }, "id", /lowercase slug/],
  ["effect value is an array", { ...MATERIAL, effects: { basePower: ["T1"] } }, "effects.basePower", /number, a tier/],
  ["unrecognised field", { ...MATERIAL, colour: "grey" }, "colour", /not a recognised field/],
  ["recipe with no slots", { ...RECIPE, slots: [] }, "slots", /at least 1/],
  ["recipe slot qty 0", { ...RECIPE, slots: [{ name: "edge", drives: "basePower", tierFloor: 1, qty: 0 }] }, "slots[0].qty", /at least 1/],
  ["recipe bad itemTemplate", { ...RECIPE, itemTemplate: "nonsense" }, "itemTemplate", /item UUID/],
  ["duplicate slot names", { ...RECIPE, slots: [
    { name: "edge", drives: "basePower", tierFloor: 1, qty: 1 },
    { name: "edge", drives: "bonusDamage", tierFloor: 1, qty: 1 }] }, "slots[1].name", /duplicate slot name/]
];
for (const [label, data, field, pattern] of BAD_CASES) {
  test(`schema error: ${label}`, () => {
    const { errors } = run(data);
    const hit = errors.find(e => e.field === field);
    assert.ok(hit, `expected an error on "${field}", got: ${errors.map(formatError).join(" | ")}`);
    assert.match(hit.message, pattern);
    assertNamesAll(hit, { entry: data.id ?? "entry", field });
  });
}

test("a bad record is excluded from the registry but good ones still load", () => {
  const { registry, errors } = run(MATERIAL, { ...SILVER, tier: 99 });
  assert.equal(errors.length, 1);
  assert.ok(registry.material.has("iron"));
  assert.ok(!registry.material.has("silver"));
});

test("material effect with an unknown role is rejected", () => {
  const { errors } = run({ ...MATERIAL, effects: { sparkle: 3 } });
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "iron", field: "effects.sparkle" });
});

test("recipe slot driving a role invalid for its category is rejected", () => {
  const bad = { ...RECIPE, slots: [{ name: "edge", drives: "spellSlots", tierFloor: 1, qty: 1 }] };
  const { errors } = run(bad);
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "blade", field: "slots[0].drives" });
  assert.match(errors[0].message, /valid: basePower, bonusDamage, specialAbility/);
});

test("recipe override must reference a known material and slot", () => {
  const bad = { ...RECIPE, overrides: [{ materialId: "mithral", slot: "nope", effect: 1 }] };
  const { errors } = run(MATERIAL, bad);
  const fields = errors.map(e => e.field).sort();
  assert.deepEqual(fields, ["overrides[0].materialId", "overrides[0].slot"]);
});

test("duplicate ids across packs fail and name BOTH packs", () => {
  const { errors } = loadDefinitions([
    source(MATERIAL, "pack.alpha", "Iron (alpha)"),
    source({ ...MATERIAL, name: "Iron copy" }, "pack.beta", "Iron (beta)")
  ]);
  assert.equal(errors.length, 1);
  const line = formatError(errors[0]);
  assert.ok(line.includes("pack.alpha") && line.includes("pack.beta"), line);
});

test("a custom role without `modifies` is rejected", () => {
  const { errors } = run({ kind: "customRole", id: "sheen", appliesTo: ["weapon"], effect: "shiny" });
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "sheen", field: "modifies" });
});

test("a valid custom role makes a new role usable by materials and recipes", () => {
  const role = { kind: "customRole", id: "sheen", appliesTo: ["weapon"], modifies: "system.sheen", effect: 1 };
  const mat = { ...MATERIAL, effects: { basePower: "T1", sheen: 2 } };
  const rec = { ...RECIPE, slots: [{ name: "edge", drives: "sheen", tierFloor: 1, qty: 1 }] };
  const { errors } = run(role, mat, rec);
  assert.deepEqual(errors, []);
});

test("a custom role may not reuse a built-in role name", () => {
  const { errors } = run({ kind: "customRole", id: "basePower", appliesTo: ["weapon"], modifies: "x", effect: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /built-in/);
});

test("creature yield must reference known materials", () => {
  const y = { kind: "creatureYield", id: "wyrm", creature: "Young Red Dragon", yield: [{ materialId: "scale", quantity: "1d4" }] };
  const { errors } = run(MATERIAL, y);
  assert.equal(errors.length, 1);
  assertNamesAll(errors[0], { entry: "wyrm", field: "yield[0].materialId" });
});

test("loadDefinitionsOrThrow throws a DefinitionError listing every problem", () => {
  assert.throws(
    () => loadDefinitionsOrThrow([source({ ...MATERIAL, tier: 0 }), source({ ...SILVER, tier: 7 })]),
    err => err instanceof DefinitionError && err.errors.length === 2 && /\[test\.pack\] "iron": field "tier"/.test(err.message)
  );
});

test("extractJson handles labelled, unlabelled and CRLF fences, and bare JSON", () => {
  assert.equal(extractJson("intro\n```json\n{\"a\":1}\n```").trim(), '{"a":1}');
  assert.equal(extractJson("```\n{\"a\":1}\n```").trim(), '{"a":1}');
  assert.equal(extractJson("```json\r\n{\"a\":1}\r\n```").trim(), '{"a":1}');
  assert.equal(extractJson('  {"a":1}  '), '{"a":1}');
  assert.equal(extractJson("nothing here"), null);
});

// Live records ----------------------------------------------------------------
const ctx = { pack: "live", entry: "record" };
const NODE = { id: "n1", source: "placed", tier: 1, charges: 3, discoveredBy: [], state: "active",
  ladder: [{ materialId: "iron", dcOffset: 0, quantity: "1d4", guaranteed: true }, { materialId: "silver", dcOffset: 5, quantity: "1d2" }] };

test("live: a valid node passes; a corpse node requires decayTimer", () => {
  assert.deepEqual(validateRecord("node", NODE, ctx), []);
  const corpse = { ...NODE, source: "corpse" };
  assert.match(validateRecord("node", corpse, ctx)[0].message, /required when source is "corpse"/);
  assert.deepEqual(validateRecord("node", { ...corpse, decayTimer: 3 }, ctx), []);
  assert.match(validateRecord("node", { ...NODE, decayTimer: 3 }, ctx)[0].message, /only applies/);
});

test("live: node ladder quantity must be a number or dice", () => {
  const bad = { ...NODE, ladder: [{ materialId: "iron", dcOffset: 0, quantity: "lots" }] };
  assert.equal(validateRecord("node", bad, ctx)[0].field, "ladder[0].quantity");
});

test("live: project outcome is a tagged variant", () => {
  const base = { id: "p1", owner: "actor1", tier: 2, dc: 20, threshold: 12, progress: 0, skillWhitelist: ["arcana"], status: "active" };
  assert.deepEqual(validateRecord("project", { ...base, outcome: { type: "unlockFormula", formulaId: "blade" } }, ctx), []);
  assert.deepEqual(validateRecord("project", { ...base, outcome: { type: "upgradeStation", stationId: "s1", fromTier: 1, toTier: 2 } }, ctx), []);
  const bad = validateRecord("project", { ...base, outcome: { type: "explode" } }, ctx);
  assert.equal(bad[0].field, "outcome.type");
});

test("live: commission variants, defaults enums and patron forms", () => {
  const base = { id: "c1", crafter: "a1", formulaId: "blade", itemSpec: { name: "x" }, status: "open",
    materialsFrom: "crafter", payout: 50, teaches: { type: "none" }, formulaAccess: "loan" };
  assert.deepEqual(validateRecord("commission", { ...base, patron: { type: "lightweight", name: "Old Brannock" } }, ctx), []);
  assert.deepEqual(validateRecord("commission", { ...base, patron: { type: "actor", actorId: "a2" }, teaches: { type: "progress", amount: 2 } }, ctx), []);
  assert.ok(validateRecord("commission", { ...base, patron: { type: "lightweight", name: "x" }, materialsFrom: "patron" }, ctx).length > 0);
});

test("live: station location is fixed{town} or carried{holder}; pendingAction is checked", () => {
  const st = { id: "s1", name: "Forge", category: "smithing", tier: 1, access: [] };
  assert.deepEqual(validateRecord("stationRecord", { ...st, location: { type: "fixed", town: "Oakhaven" } }, ctx), []);
  assert.deepEqual(validateRecord("stationRecord", { ...st, location: { type: "carried", holder: "a1" } }, ctx), []);
  assert.ok(validateRecord("stationRecord", { ...st, location: { type: "fixed" } }, ctx).length > 0);
  const act = { id: "q1", actor: "a1", type: "research", params: {}, daysReserved: 1, submittedAt: 1 };
  assert.deepEqual(validateRecord("pendingAction", act, ctx), []);
  assert.ok(validateRecord("pendingAction", { ...act, daysReserved: -1 }, ctx).length > 0);
});

// Duplicate ids are reported even when a copy is ALSO invalid ------------------
test("an invalid copy of an existing id reports BOTH its schema error and the duplicate", () => {
  const { errors, registry } = loadDefinitions([
    source(MATERIAL, "pack.main", "Iron"),
    source({ ...MATERIAL, tier: 9 }, "world.test-defs", "Iron (copy)")
  ]);
  const fields = errors.map(e => e.field).sort();
  assert.deepEqual(fields, ["id", "tier"], errors.map(formatError).join(" | "));
  const dup = errors.find(e => e.field === "id");
  assert.equal(dup.pack, "world.test-defs");
  assert.ok(dup.message.includes("pack.main"), "duplicate error must name the original pack too");
  // The original, valid record is still the one that loads.
  assert.equal(registry.material.get("iron").tier, 1);
});

test("a VALID duplicate still fails loudly, and the first definition wins", () => {
  const { errors, registry } = loadDefinitions([
    source(MATERIAL, "pack.main", "Iron"),
    source({ ...MATERIAL, name: "Iron copy" }, "world.test-defs", "Iron (copy)")
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "id");
  assert.equal(registry.material.get("iron").name, "Iron");
});

test("duplicates are caught across different kinds (ids share one namespace)", () => {
  const { errors } = loadDefinitions([
    source(MATERIAL, "pack.a", "Iron"),
    source({ ...RECIPE, id: "iron" }, "pack.b", "Iron recipe")
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /already defined in \[pack\.a\]/);
});

test("when the INVALID copy comes first, the valid one is still reported as a duplicate", () => {
  const { errors } = loadDefinitions([
    source({ ...MATERIAL, tier: 9 }, "pack.a", "Iron (bad)"),
    source(MATERIAL, "pack.b", "Iron (good)")
  ]);
  assert.ok(errors.some(e => e.pack === "pack.b" && e.field === "id"), errors.map(formatError).join(" | "));
});
