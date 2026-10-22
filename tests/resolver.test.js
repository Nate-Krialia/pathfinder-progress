import test from "node:test";
import assert from "node:assert/strict";
import { resolveCorpseYield, resolveLayers, resolveMaterialEffect } from "../scripts/data/resolver.js";
import { loadDefinitions } from "../scripts/data/validate.js";
import { asPage, seedRecords } from "./helpers.js";

const seed = () => loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;

test("resolveLayers: the first defined layer wins and reports its source", () => {
  assert.deepEqual(resolveLayers([{ source: "a", value: undefined }, { source: "b", value: 2 }, { source: "c", value: 3 }]), { value: 2, source: "b" });
  assert.equal(resolveLayers([{ source: "a", value: undefined }]), null);
});

test("resolveLayers: falsy-but-real values (0, empty string) still count", () => {
  assert.deepEqual(resolveLayers([{ source: "a", value: 0 }, { source: "b", value: 9 }]), { value: 0, source: "a" });
});

test("recipe override beats material default (seed data)", () => {
  const { material, recipe } = seed();
  const silver = material.get("silver");
  const sword = recipe.get("longsword-basic");
  // Silver in the coating slot has a recipe override.
  assert.deepEqual(resolveMaterialEffect(silver, "bonusDamage", sword, "coating"), { value: "+1d6 vs fiends", source: "recipe override" });
  // The material's own default is "+1d4 vs fiends".
  assert.equal(silver.effects.bonusDamage, "+1d4 vs fiends");
});

test("with no matching override, the material default is used", () => {
  const { material, recipe } = seed();
  const silver = material.get("silver");
  const sword = recipe.get("longsword-basic");
  // Different slot: override does not apply.
  assert.deepEqual(resolveMaterialEffect(silver, "basePower", sword, "blade"), { value: "T2", source: "material default" });
  // Different material in the overridden slot: override does not apply.
  const starmetal = material.get("starmetal");
  assert.deepEqual(resolveMaterialEffect(starmetal, "bonusDamage", sword, "coating"), { value: "+1d6 vs fiends", source: "material default" });
  // No recipe at all.
  assert.equal(resolveMaterialEffect(silver, "bonusDamage", null, "coating").source, "material default");
});

test("a role the material has no effect for resolves to null", () => {
  const { material, recipe } = seed();
  assert.equal(resolveMaterialEffect(material.get("iron"), "specialAbility", recipe.get("longsword-basic"), "core"), null);
});

test("corpse yield: per-creature override beats the trait/level mapping", () => {
  const override = { yield: [{ materialId: "scale", quantity: "1d4" }] };
  const mapped = [{ materialId: "hide", quantity: "1" }];
  assert.equal(resolveCorpseYield(override, mapped).source, "creature override");
  assert.equal(resolveCorpseYield(undefined, mapped).source, "trait/level mapping");
});
