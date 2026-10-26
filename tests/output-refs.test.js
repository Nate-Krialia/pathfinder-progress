import test from "node:test";
import assert from "node:assert/strict";
import {
  createRefCache, expandPackPatterns, isUuid, looksLikeUuid, parsePackList, resolveRef, resolveRefCached
} from "../scripts/data/outputRefs.js";
import { formatError, loadDefinitions } from "../scripts/data/validate.js";
import { MATERIAL, RECIPE, UUID, source } from "./helpers.js";

const uuid = (pack, id) => `Compendium.${pack}.Item.${id.padEnd(16, "0")}`;
const entry = (pack, name, id, type = "weapon") => ({ name, uuid: uuid(pack, id), type });

const SRD = { id: "pf2e.equipment-srd", label: "Equipment", entries: [
  entry("pf2e.equipment-srd", "Dagger", "dagger"),
  entry("pf2e.equipment-srd", "Longsword", "longsword"),
  entry("pf2e.equipment-srd", "Rapier", "rapier")
] };
const HOMEBREW = { id: "world.homebrew", label: "My Homebrew", entries: [
  entry("world.homebrew", "Dagger", "homedagger"),
  entry("world.homebrew", "Sunblade", "sunblade")
] };

// Single match ------------------------------------------------------------------
test("a name with a single match resolves to that item's UUID", () => {
  const result = resolveRef("Longsword", [SRD, HOMEBREW]);
  assert.equal(result.ok, true);
  assert.equal(result.uuid, uuid("pf2e.equipment-srd", "longsword"));
  assert.equal(result.via, "name");
  assert.equal(result.packId, "pf2e.equipment-srd");
});

test("names match exactly, ignoring case and surrounding spaces, but never partially", () => {
  assert.equal(resolveRef("  longSWORD ", [SRD]).ok, true);
  assert.equal(resolveRef("Long", [SRD]).ok, false);
  assert.equal(resolveRef("Longswords", [SRD]).ok, false);
});

// No match ------------------------------------------------------------------------
test("no match fails loudly, naming the item and the packs searched", () => {
  const result = resolveRef("Vorpal Blade", [SRD, HOMEBREW]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "none");
  assert.deepEqual(result.matches, []);
  assert.match(result.message, /"Vorpal Blade" matched no items/);
  assert.match(result.message, /pf2e\.equipment-srd, world\.homebrew/);
});

test("no match with no packs configured says so", () => {
  assert.match(resolveRef("Dagger", []).message, /\(none\)/);
});

test("an empty reference fails", () => {
  for (const bad of ["", "   ", undefined, null]) assert.equal(resolveRef(bad, [SRD]).ok, false);
});

// Multiple matches -----------------------------------------------------------------
test("several matches fail and list every candidate; nothing is guessed", () => {
  const result = resolveRef("Dagger", [SRD, HOMEBREW]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "multiple");
  assert.equal(result.matches.length, 2);
  assert.equal(result.uuid, undefined);
  assert.match(result.message, /"Dagger" matched 2 items/);
  assert.match(result.message, /\[pf2e\.equipment-srd\] Dagger \(weapon\) Compendium\.pf2e\.equipment-srd\.Item\./);
  assert.match(result.message, /\[world\.homebrew\] Dagger/);
  assert.match(result.message, /use "Pack: Name" or a full UUID/);
});

test("the same item listed twice is one match, not an ambiguity", () => {
  const twice = { ...SRD, entries: [...SRD.entries, SRD.entries[0]] };
  assert.equal(resolveRef("Dagger", [twice]).ok, true);
});

test("two items with one name inside a single pack are still ambiguous", () => {
  const dup = { id: "world.dups", label: "Dups", entries: [entry("world.dups", "Axe", "axe1"), entry("world.dups", "Axe", "axe2")] };
  const result = resolveRef("world.dups: Axe", [dup]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "multiple");
  assert.match(result.message, /in pack "world\.dups"/);
});

// "Pack: Name" ------------------------------------------------------------------------
test('"Pack: Name" by pack id disambiguates', () => {
  const result = resolveRef("world.homebrew: Dagger", [SRD, HOMEBREW]);
  assert.equal(result.ok, true);
  assert.equal(result.uuid, uuid("world.homebrew", "homedagger"));
  assert.equal(resolveRef("pf2e.equipment-srd: Dagger", [SRD, HOMEBREW]).uuid, uuid("pf2e.equipment-srd", "dagger"));
});

test('"Pack: Name" also accepts the pack label, ignoring case', () => {
  assert.equal(resolveRef("my homebrew: Dagger", [SRD, HOMEBREW]).uuid, uuid("world.homebrew", "homedagger"));
});

test('"Pack: Name" only searches that pack', () => {
  const result = resolveRef("world.homebrew: Longsword", [SRD, HOMEBREW]);
  assert.equal(result.ok, false);
  assert.match(result.message, /in pack "world\.homebrew"/);
});

test("an unknown prefix is treated as part of the name, with a hint when nothing matches", () => {
  const result = resolveRef("pf2e.equipment: Dagger", [SRD, HOMEBREW]);
  assert.equal(result.ok, false);
  assert.match(result.message, /"pf2e\.equipment: Dagger" matched no items/);
  assert.match(result.message, /"pf2e\.equipment" was meant as a pack, it is not one of the searched packs/);
});

test("an item whose real name contains a colon can still be found", () => {
  const odd = { id: "world.odd", label: "Odd", entries: [entry("world.odd", "Armor: Test Plate", "odd1", "armor")] };
  const result = resolveRef("Armor: Test Plate", [odd]);
  assert.equal(result.ok, true);
  assert.equal(result.uuid, uuid("world.odd", "odd1"));
});

// Raw UUID ----------------------------------------------------------------------------
test("a full UUID is accepted as-is without any lookup", () => {
  const result = resolveRef(UUID, []);
  assert.deepEqual(result, { ok: true, uuid: UUID, via: "uuid" });
  assert.equal(resolveRef(`  ${UUID}  `, []).uuid, UUID);
});

test("a malformed UUID is an error, never treated as a name", () => {
  const result = resolveRef("Compendium.pf2e.equipment-srd.Item.short", [SRD]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed");
  assert.equal(resolveRef("Item.123", [SRD]).reason, "malformed");
  assert.ok(isUuid(UUID) && !isUuid("Dagger") && looksLikeUuid("Item.1") && !looksLikeUuid("Itemized Dagger"));
});

// Pack list ------------------------------------------------------------------------------
test("pack lists parse and expand, including wildcards", () => {
  assert.deepEqual(parsePackList(" pf2e.equipment-srd , world.* ,, "), ["pf2e.equipment-srd", "world.*"]);
  const all = ["pf2e.equipment-srd", "pf2e.spells-srd", "world.homebrew", "world.loot"];
  assert.deepEqual(expandPackPatterns(["pf2e.equipment-srd", "world.*"], all), { ids: ["pf2e.equipment-srd", "world.homebrew", "world.loot"], missing: [] });
  assert.deepEqual(expandPackPatterns(["world.*", "world.loot"], all).ids, ["world.homebrew", "world.loot"], "no duplicates");
});

test("a named pack that does not exist is reported as missing; a wildcard matching nothing is not", () => {
  const { ids, missing } = expandPackPatterns(["pf2e.nope", "moduleX.*"], ["pf2e.equipment-srd"]);
  assert.deepEqual(ids, []);
  assert.deepEqual(missing, ["pf2e.nope"]);
});

// Session cache ----------------------------------------------------------------------------
test("successful resolutions are cached for the session", () => {
  const sources = [{ ...SRD, entries: [...SRD.entries] }];
  const cache = createRefCache();
  const first = resolveRefCached("Dagger", sources, cache);
  assert.equal(first.ok, true);
  sources[0].entries.length = 0; // the item "disappears"; the cache still answers
  assert.deepEqual(resolveRefCached("Dagger", sources, cache), first);
  assert.equal(cache.size, 1);
});

test("failures are NOT cached, so fixing the data shows up on the next load", () => {
  const sources = [{ id: "world.x", label: "X", entries: [] }];
  const cache = createRefCache();
  assert.equal(resolveRefCached("Spear", sources, cache).ok, false);
  assert.equal(cache.size, 0);
  sources[0].entries.push(entry("world.x", "Spear", "spear1"));
  assert.equal(resolveRefCached("Spear", sources, cache).ok, true);
});

test("the cache is keyed by the searched packs, so changing the pack list re-resolves", () => {
  const cache = createRefCache();
  const a = resolveRefCached("Dagger", [SRD], cache);
  const b = resolveRefCached("Dagger", [HOMEBREW], cache);
  assert.notEqual(a.uuid, b.uuid);
  assert.equal(cache.size, 2);
});

// Schema and load-time checks with names ---------------------------------------------------------
const load = (...records) => loadDefinitions(records.map(r => source(r)));

test("recipes validate with name, Pack: Name and UUID outputs", () => {
  for (const output of [{ "1": "Dagger", "2": "Dagger" }, { "1": "pf2e.equipment-srd: Dagger", "2": "Dagger" }, { "1": UUID, "2": "Dagger" }]) {
    const { errors } = load(MATERIAL, { ...RECIPE, output });
    assert.deepEqual(errors, [], errors.map(formatError).join(" | "));
  }
});

test("a malformed UUID in an output is rejected at load time with a helpful message", () => {
  const { errors } = load({ ...RECIPE, output: { "1": "Compendium.pf2e.equipment-srd.Item.short" } });
  const hit = errors.find(e => e.field === "output.1");
  assert.ok(hit, errors.map(formatError).join(" | "));
  assert.match(hit.message, /malformed.*write just the name/);
});

test("load-time tier coverage still works when outputs are names", () => {
  const silver = { kind: "material", id: "silver", name: "Silver", tier: 2, effects: { basePower: "T2" } };
  const { errors } = load(MATERIAL, silver, { ...RECIPE, output: { "1": "Dagger" } });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no entry for tier 2/);
});

test("an empty or non-string output value is still rejected", () => {
  assert.ok(load({ ...RECIPE, output: { "1": "" } }).errors.some(e => e.field === "output.1"));
  assert.ok(load({ ...RECIPE, output: { "1": 5 } }).errors.some(e => e.field === "output.1"));
});
