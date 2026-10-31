import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_TYPES, collapse, compileEffects, compileSet, decompileRoles, describeBlocks, fitsRoles, flat, newBlock, setProblems, spread, valueAt } from "../scripts/editor/blocks.js";
import { emptyStore, finalizeRecord, keyOf, layerSources, storeProblems } from "../scripts/editor/layer.js";
import { buildRegistry } from "../scripts/editor/build.js";
import { stripForPlayer } from "../scripts/data/playerSet.js";
import { FANG_RECIPE, MATERIAL, RECIPE, SILVER, clone, source } from "./helpers.js";

const base = () => [source(MATERIAL), source(SILVER), source(RECIPE), source(FANG_RECIPE)];
const store = (...records) => ({ v: 1, records: Object.fromEntries(records.map(r => [keyOf(r.kind, r.id), r])) });
const newMat = (id, fields) => ({ kind: "material", id, mode: "new", fields: { name: id, tier: 2, ...fields } });

// Blocks -------------------------------------------------------------------------------------------------------------
test("per-tier fields: a flat value, a spread table and collapsing back keep the value for the material's tier", () => {
  assert.equal(valueAt(flat("1d6"), 3), "1d6");
  const table = spread(flat("1d6"), "1d4");
  assert.deepEqual(Object.keys(table.byTier), ["1", "2", "3", "4", "5"]);
  assert.equal(valueAt(table, 5), "1d6");
  table.byTier[3] = "2d6";
  assert.deepEqual(collapse(table, 3), { all: "2d6" });
});

test("a table is read by the material's own tier", () => {
  const set = { blocks: [{ type: "damage", dice: { byTier: { 1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10", 5: "1d12" } }, damageType: "fire" }] };
  assert.deepEqual(compileSet(set, 2).bonusDamage, { dice: "1d6", type: "fire" });
  assert.deepEqual(compileSet(set, 5).bonusDamage, { dice: "1d12", type: "fire" });
});

test("blocks compile to the role values the craft engine already applies", () => {
  const set = { power: 2, blocks: [newBlock("damage"), newBlock("resistance"), { type: "ability", title: "Venom", text: "Sickened 1.", on: "hit" }] };
  assert.deepEqual(compileSet(set, 2), {
    basePower: "T2", bonusDamage: { dice: "1d6", type: "fire" }, resistance: { type: "fire", value: 2 }, specialAbility: { title: "Venom", text: "Sickened 1.", on: "hit" }
  });
});

test("roles survive a round trip through blocks, and what is not a block is kept in extra", () => {
  const roles = { basePower: "T3", bonusDamage: { dice: "1d6", type: "cold", persistent: true }, spellSlots: 2, resistance: { type: "fire", value: 5 } };
  const set = decompileRoles(roles);
  assert.deepEqual(set.extra, { spellSlots: 2 });
  assert.deepEqual(compileSet(set, 3), roles);
});

test("compileEffects splits a general set from the per-class sets and drops empty classes", () => {
  const { effects, classEffects } = compileEffects({ general: { power: 1, blocks: [] }, byClass: { weapon: { blocks: [newBlock("damage")] }, armor: { blocks: [] } } }, 1);
  assert.deepEqual(effects, { basePower: "T1" });
  assert.deepEqual(Object.keys(classEffects), ["weapon"]);
});

test("problems come back in plain words: duplicate type, wrong class, empty ability, missing dice", () => {
  const dup = setProblems({ blocks: [newBlock("damage"), newBlock("damage")] }, "weapon", 1);
  assert.match(dup[0], /Only one "Add damage" block/);
  assert.match(setProblems({ blocks: [newBlock("damage")] }, "armor", 1)[0], /does not apply to armor/);
  assert.match(setProblems({ blocks: [{ type: "ability", title: "", text: "x" }] }, "weapon", 1)[0], /title and its text/);
  assert.match(setProblems({ blocks: [{ type: "damage", dice: { byTier: { 1: "1d4" } }, damageType: "fire" }] }, "weapon", 3)[0], /needs dice/);
  assert.deepEqual(setProblems({ blocks: [newBlock("damage")] }, "weapon", 1), []);
});

test("every block type is covered by newBlock and by the role map", () => {
  for (const type of BLOCK_TYPES) assert.equal(newBlock(type).type, type);
  assert.throws(() => newBlock("zap"), /unknown block type/);
});

test("the plain-words line comes from the Hub's own wording", () => {
  const lines = describeBlocks("Gate Fang", { blocks: [newBlock("damage")] }, "weapon", 2);
  assert.ok(lines.length >= 1);
  assert.match(lines.join(" "), /1d6/);
  assert.match(lines.join(" "), /fire/);
});

test("fitsRoles lists the roles a material can supply for a class (derived, no category field)", () => {
  const eb = { general: { power: 1, blocks: [] }, byClass: { weapon: { blocks: [newBlock("damage")] } } };
  assert.deepEqual(fitsRoles(eb, "weapon"), ["basePower", "bonusDamage"]);
  assert.deepEqual(fitsRoles(eb, "armor"), ["basePower"]);
});

// Layer --------------------------------------------------------------------------------------------------------------
test("an empty store changes nothing", () => {
  const { sources, leftovers } = layerSources(base(), emptyStore());
  assert.deepEqual(sources, base());
  assert.deepEqual(leftovers, []);
});

test("a new record becomes a validated material and the packs are untouched", () => {
  const { registry, errors, leftovers } = buildRegistry(base(), store(newMat("gate-fang", { effects: { basePower: "T2" } })));
  assert.deepEqual(errors, []);
  assert.deepEqual(leftovers, []);
  assert.equal(registry.material.get("gate-fang").name, "gate-fang");
  assert.equal(registry.material.get("iron").name, "Iron");
});

test("a patch changes only the fields it names", () => {
  const { registry, errors } = buildRegistry(base(), store({ kind: "material", id: "iron", mode: "patch", fields: { name: "Cold Iron" } }));
  assert.deepEqual(errors, []);
  const iron = registry.material.get("iron");
  assert.equal(iron.name, "Cold Iron");
  assert.equal(iron.tier, 1);
  assert.deepEqual(iron.effects, { basePower: "T1" });
});

test("a patch for something the packs no longer have is a leftover, not an error", () => {
  const { leftovers, errors } = buildRegistry(base(), store({ kind: "material", id: "gone", mode: "patch", fields: { name: "X" } }));
  assert.deepEqual(errors, []);
  assert.equal(leftovers[0].key, "material:gone");
});

test("a new record that reuses a pack id keeps the pack's definition and says so", () => {
  const { registry, leftovers } = buildRegistry(base(), store(newMat("iron", {})));
  assert.equal(registry.material.get("iron").name, "Iron");
  assert.match(leftovers[0].message, /packs already define/);
});

test("a bad editor record is reported by name and the rest still loads", () => {
  const { registry, errors } = buildRegistry(base(), store(newMat("bad", { tier: 9 }), newMat("good", { effects: { basePower: "T1" } })));
  assert.ok(errors.some(e => e.entry === "bad" || String(e.entry).includes("bad")));
  assert.ok(registry.material.has("good"));
  assert.ok(!registry.material.has("bad"));
});

test("blocks are the source of truth: they replace the stored roles when the record is built", () => {
  const rec = finalizeRecord({ kind: "material", id: "m", name: "M", tier: 2, effects: { basePower: "T9" }, effectBlocks: { general: { power: 2, blocks: [] }, byClass: { weapon: { blocks: [newBlock("damage")] } } } });
  assert.deepEqual(rec.effects, { basePower: "T2" });
  assert.deepEqual(rec.classEffects.weapon.bonusDamage, { dice: "1d6", type: "fire" });
  const plain = { kind: "material", id: "p", name: "P", tier: 1, effects: { basePower: "T1" } };
  assert.equal(finalizeRecord(plain), plain);
});

test("a per-recipe override on the material lands on that recipe, and a missing recipe is a leftover", () => {
  const withOverride = newMat("gate-fang", { effects: { basePower: "T2" }, recipeOverrides: [{ recipeId: "fang-dagger", slot: "fang", block: newBlock("damage") }] });
  const { registry, errors } = buildRegistry(base(), store(withOverride));
  assert.deepEqual(errors, []);
  const o = registry.recipe.get("fang-dagger").overrides.find(x => x.materialId === "gate-fang");
  assert.deepEqual(o, { materialId: "gate-fang", slot: "fang", role: "bonusDamage", effect: { dice: "1d6", type: "fire" } });
  const orphan = newMat("m2", { effects: { basePower: "T1" }, recipeOverrides: [{ recipeId: "nope", slot: "edge", block: newBlock("damage") }] });
  assert.match(buildRegistry(base(), store(orphan)).leftovers[0].message, /does not exist/);
});

test("an override on a slot that does not drive that role is a named validation error, not a silent drop", () => {
  const bad = newMat("m3", { effects: { basePower: "T1" }, recipeOverrides: [{ recipeId: "blade", slot: "edge", block: newBlock("damage") }] });
  const { errors } = buildRegistry(base(), store(bad));
  assert.ok(errors.some(e => e.entry === "blade" && /not driven by slot "edge"/.test(e.message)));
});

test("a damaged store is described, not trusted", () => {
  assert.equal(storeProblems(emptyStore()).length, 0);
  assert.match(storeProblems({ v: 7, records: {} })[0], /unknown shape/);
  assert.match(storeProblems({ v: 1, records: { "material:a": { kind: "material", id: "b", mode: "new", fields: {} } } })[0], /damaged/);
});

// Players ------------------------------------------------------------------------------------------------------------
test("a player's copy of a material carries none of the editor's fields", () => {
  const rec = { kind: "material", id: "m", name: "M", tier: 2, value: 5, img: "x.webp", description: "d", bulk: "L", label: "Parts", retired: true,
    effects: { basePower: "T2" }, effectBlocks: { general: { blocks: [] } }, recipeOverrides: [] };
  const out = stripForPlayer("material", clone(rec));
  assert.deepEqual(Object.keys(out).sort(), ["hasTrack", "id", "kind", "name", "tier", "value"]);
});

// Export / import ---------------------------------------------------------------------------------------------------
import { BUNDLE_FORMAT, exportBundle, planImport } from "../scripts/editor/exchange.js";

test("an export holds the records asked for; an import plan adds new ones and skips clashes with a reason", () => {
  const mine = store(newMat("a", {}), newMat("b", {}));
  const bundle = exportBundle(mine, ["material:a"]);
  assert.equal(bundle.format, BUNDLE_FORMAT);
  assert.deepEqual(bundle.records.map(r => r.id), ["a"]);
  const into = planImport(exportBundle(mine), store(newMat("a", {})), { definedIds: new Set(["material:iron"]) });
  assert.deepEqual(into.add.map(r => r.id), ["b"]);
  assert.deepEqual(into.skip, [{ key: "material:a", reason: "already exists here" }]);
  assert.deepEqual(planImport(exportBundle(mine), store(newMat("a", {})), { replace: true }).replace.map(r => r.id), ["a"]);
  const clash = planImport({ ...bundle, records: [newMat("iron", {})] }, emptyStore(), { definedIds: new Set(["material:iron"]) });
  assert.match(clash.skip[0].reason, /packs already define/);
});

test("an import refuses a file that is not an export, has another version, or has a damaged record", () => {
  assert.match(planImport({ hello: 1 }, emptyStore()).problems[0], /not an item editor export/);
  assert.match(planImport({ format: BUNDLE_FORMAT, v: 9, records: [] }, emptyStore()).problems[0], /version 9/);
  assert.match(planImport({ format: BUNDLE_FORMAT, v: 1, records: [{ kind: "material", id: "x" }] }, emptyStore()).problems[0], /Record 1 is damaged/);
  assert.match(planImport({ format: BUNDLE_FORMAT, v: 1, records: [{ kind: "recipe", id: "x", mode: "new", fields: {} }] }, emptyStore()).problems[0], /damaged/);
});

test("a focus's power tier is SPELL power (not base power); it compiles, round-trips and validates", () => {
  const eb = { general: { power: 1, blocks: [] }, byClass: { focus: { power: 3, blocks: [] }, weapon: { power: 2, blocks: [] } } };
  const { effects, classEffects } = compileEffects(eb, 2);
  assert.deepEqual(effects, { basePower: "T1" }, "Every class means base power");
  assert.deepEqual(classEffects, { focus: { spellPower: "T3" }, weapon: { basePower: "T2" } });
  assert.equal(decompileRoles({ spellPower: "T3" }, "focus").power, 3);
  assert.equal(decompileRoles({ spellPower: "T3" }, "weapon").extra.spellPower, "T3", "in a weapon class it is just another role, kept as it was");
  assert.deepEqual(setProblems({ power: 3, blocks: [] }, "focus", 2), []);
  const { errors, registry } = buildRegistry(base(), store(newMat("gate-focus", { effectBlocks: eb })));
  assert.deepEqual(errors, []);
  assert.equal(registry.material.get("gate-focus").classEffects.focus.spellPower, "T3");
});
