/** Tag system, Slice 3a (docs/22): a crafted item as an ingredient. Pure parts: the crafted reference, its tags and tier, the nesting limit, what a craft freezes. */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import { planCraft } from "../scripts/crafting/plan.js";
import { craftedRef, effectiveTags, effectiveTier, isCraftedRef, itemName, overlayLedger, slotFit, standInMaterial, tagTiers } from "../scripts/tags/ledger.js";
import { embedRecord } from "../scripts/tags/frozen.js";
import { mergeCaps, mergeLimits, capsProblems } from "../scripts/tags/stack.js";
import { asPage, seedRecords, UUID, UUID_2, RECIPE } from "./helpers.js";

const tag = (id, effectBlocks, extra = {}) => ({ kind: "tag", id, name: id[0].toUpperCase() + id.slice(1), theme: `${id} things`, ...(effectBlocks ? { effectBlocks } : {}), ...extra });
const mat = (id, tier, extra = {}) => ({ kind: "material", id, name: id, tier, effects: { basePower: `T${tier}` }, ...extra });
const dmg = (dice, damageType = "poison") => ({ type: "damage", dice: { all: dice }, damageType });
const defs = (...records) => loadDefinitions([...seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) })), ...records.map(r => ({ pack: "t", entry: r.id, text: asPage(r) }))]);
const recipeOf = (slots, extra = {}) => ({ ...RECIPE, id: "mount-blade", name: "Mount Blade", category: "weapon", output: { 1: UUID, 2: UUID_2, 3: UUID, 4: UUID_2, 5: UUID }, slots, ...extra });
const EDGE = { name: "edge", drives: "basePower", qty: 1 };
const MOUNT = { name: "mount", drives: "bonusDamage", qty: 1, needs: { all: ["metal"] } };
const STATION = { id: "f", name: "F", category: RECIPE.stationCategory, tier: 1 };
const REC = (over = {}) => ({ recipeId: "bar", name: "Cold Iron Bar", tier: 2, depth: 1, native: ["metal"], inherited: [], uses: [], roles: {}, contributions: [], ...over });
const ledgerWith = (crafted, items = {}) => { const l = { v: 1, items }; Object.defineProperty(l, "crafted", { value: crafted, enumerable: false }); return l; };
const reg = (records, slots, extra) => { const have = new Set(records.map(r => r.id)); const r = defs(...["metal"].filter(id => !have.has(id)).map(id => tag(id)), ...records, recipeOf(slots, extra)); assert.deepEqual(r.errors.map(e => `${e.entry} ${e.field} ${e.message}`), []); return r.registry; };
const ironbar = mat("ironbar", 1);
const plan = (registry, selection, ledger, extra = {}) => planCraft({ recipe: registry.recipe.get("mount-blade"), registry, selection, stacks: Object.values(selection).map((id, i) => ({ stackId: `s${i}`, materialId: id, quantity: 5 })), outputs: { 1: UUID }, station: STATION, ledger, caps: mergeCaps(null), ...extra });

test("REF: a crafted item is an ingredient under crafted:<freezeId>", () => { assert.equal(craftedRef("abc"), "crafted:abc"); assert.ok(isCraftedRef("crafted:abc")); assert.ok(!isCraftedRef("iron")); assert.ok(!isCraftedRef(undefined)); });
test("CRAFTED: its tags are its native tags then its inherited ones, its tier and name are the record's; a plain ledger entry is ignored", () => {
  const registry = reg([ironbar], [EDGE, MOUNT]);
  const L = ledgerWith({ x1: REC({ native: ["metal"], inherited: [{ tag: "cold", tier: 1 }, { tag: "metal", tier: 3 }] }) }, { "crafted:x1": { tags: ["ignored"], tier: 5, name: "Nope" } });
  assert.deepEqual(effectiveTags("crafted:x1", registry, L), ["metal", "cold"], "native first; a tag appears once");
  assert.deepEqual(tagTiers("crafted:x1", registry, L), [{ tag: "metal", tier: 3 }, { tag: "cold", tier: 1 }], "native counts at the item's tier (2), but the inherited metal came at 3: the higher tier wins");
  assert.equal(effectiveTier("crafted:x1", registry, L), 2); assert.equal(itemName("crafted:x1", registry, L), "Cold Iron Bar");
});
test("CRAFTED: it fits a tagged slot by its tags and tier floor, and says plainly when it has no record", () => {
  const registry = reg([ironbar], [EDGE, MOUNT]);
  const L = ledgerWith({ x1: REC() });
  assert.equal(slotFit(MOUNT, "crafted:x1", registry, L).ok, true);
  assert.match(slotFit({ ...MOUNT, needs: { all: ["metal", "cold"] } }, "crafted:x1", registry, L).reason, /missing cold/);
  assert.match(slotFit({ ...MOUNT, tierFloor: 3 }, "crafted:x1", registry, L).reason, /is tier 2 but the slot needs tier 3/);
  assert.match(slotFit(MOUNT, "crafted:gone", registry, L).reason, /has no record of what it was made of/);
  assert.equal(slotFit({ name: "old", drives: "basePower", tierFloor: 1, qty: 1 }, "crafted:x1", registry, L).ok, false, "an old slot never takes it");
});
test("CRAFTED: standInMaterial and overlayLedger", () => {
  const L = ledgerWith({ x1: REC() });
  assert.deepEqual({ id: standInMaterial("crafted:x1", L).id, name: standInMaterial("crafted:x1", L).name, tier: standInMaterial("crafted:x1", L).tier }, { id: "crafted:x1", name: "Cold Iron Bar", tier: 2 });
  assert.equal(standInMaterial("crafted:none", L), null);
  const view = overlayLedger(L, { x2: REC({ name: "Second" }) });
  assert.deepEqual(Object.keys(view.crafted).sort(), ["x1", "x2"]); assert.deepEqual(Object.keys(L.crafted), ["x1"], "the original is untouched");
  assert.deepEqual(Object.keys(view), ["v", "items"], "the records are not enumerable: copying a ledger never carries them");
});

test("PLAN: a crafted ingredient fills a tagged slot; its tag's effect is scaled by the ITEM's tier; the plan names it", () => {
  const metal = tag("metal", { general: { blocks: [{ type: "damage", dice: { byTier: { 1: "1d4", 2: "1d6", 3: "1d8", 4: "1d10", 5: "1d12" } }, damageType: "poison" }] } });
  const registry = reg([metal, ironbar], [EDGE, MOUNT]);
  const r = plan(registry, { edge: "ironbar", mount: "crafted:x1" }, ledgerWith({ x1: REC() }));
  assert.ok(r.ok, r.errors?.join(" | "));
  assert.deepEqual(r.plan.description.damageBonuses.map(d => d.dice), ["1d6"], "tier 2");
  assert.deepEqual(r.plan.uses.map(u => [u.slot, u.materialId, u.materialName]), [["edge", "ironbar", "ironbar"], ["mount", "crafted:x1", "Cold Iron Bar"]]);
});
test("PLAN: a crafted ingredient with no record is refused with the reason", () => {
  const registry = reg([ironbar], [EDGE, MOUNT]);
  const r = plan(registry, { edge: "ironbar", mount: "crafted:gone" }, ledgerWith({}));
  assert.equal(r.ok, false); assert.match(r.errors[0], /cannot fill this slot/);
});

// Nesting limit -------------------------------------------------------------------------------------------------------------------------
test("DEPTH: a craft one level above its deepest crafted ingredient; over the limit it is refused in plain words, before anything is spent", () => {
  const registry = reg([ironbar], [EDGE, MOUNT]);
  const ok = plan(registry, { edge: "ironbar", mount: "crafted:x1" }, ledgerWith({ x1: REC({ depth: 2 }) }));
  assert.ok(ok.ok, ok.errors?.join(" | ")); assert.equal(ok.plan.frozen?.depth ?? 3, 3);
  const deep = plan(registry, { edge: "ironbar", mount: "crafted:x1" }, ledgerWith({ x1: REC({ depth: 3 }) }));
  assert.equal(deep.ok, false); assert.match(deep.errors[0], /nest crafted items 4 deep; the limit is 3/);
  const tight = plan(registry, { edge: "ironbar", mount: "crafted:x1" }, ledgerWith({ x1: REC({ depth: 1 }) }), { limits: { maxDepth: 1 } });
  assert.equal(tight.ok, false); assert.match(tight.errors[0], /2 deep; the limit is 1/);
});
test("DEPTH: the limit is a GM setting in the caps table (1 to 6) and defaults to 3", () => {
  assert.equal(mergeLimits(null).maxDepth, 3); assert.equal(mergeLimits({ v: 1, roles: {}, limits: { maxDepth: 5 } }).maxDepth, 5);
  assert.deepEqual(capsProblems({ v: 1, roles: {}, limits: { maxDepth: 2 } }), []);
  for (const v of [0, 7, 1.5, "3"]) assert.match(capsProblems({ v: 1, roles: {}, limits: { maxDepth: v } })[0], /from 1 to 6/, String(v));
  assert.match(capsProblems({ v: 1, roles: {}, limits: { speed: 1 } })[0], /not a limit/);
});

// What a craft freezes ---------------------------------------------------------------------------------------------------------------
test("FREEZE: a craft whose recipe has a ledger entry is frozen with the GM's tier and tags; the record carries name, depth and the embedded ingredient", () => {
  const registry = reg([ironbar], [EDGE, MOUNT]);
  const L = ledgerWith({ x1: REC({ depth: 2, inherited: [{ tag: "cold", tier: 1 }] }) }, { "mount-blade": { tags: ["metal"], tier: 4, name: "Mount Blade" } });
  const r = plan(registry, { edge: "ironbar", mount: "crafted:x1" }, L);
  const f = r.plan.frozen;
  assert.deepEqual([f.recipeId, f.tier, f.depth, f.native], ["mount-blade", 4, 3, ["metal"]]);
  const mount = f.uses.find(u => u.slot === "mount");
  assert.equal(mount.from.recipeId, "bar"); assert.deepEqual(mount.from.inherited, [{ tag: "cold", tier: 1 }]);
});
test("FREEZE: with no ledger entry the item's tier is the craft's power tier; with no power role, the highest input tier", () => {
  const registry = reg([ironbar], [EDGE, MOUNT]);
  const tagged = plan(registry, { edge: "ironbar", mount: "crafted:x1" }, ledgerWith({ x1: REC() }));
  assert.equal(tagged.plan.frozen.tier, 1, "the iron's power tier T1 (the tagged slot froze it because it has a tagged slot)");
  assert.deepEqual(tagged.plan.frozen.native, []);
});
test("FREEZE: a craft with no tagged slot and no ledger entry for its recipe is NOT frozen (old recipes are untouched)", () => {
  const registry = reg([ironbar], [EDGE, { name: "grip", drives: "bonusDamage", qty: 1 }]);
  const mat2 = mat("fang", 1, { effects: { bonusDamage: { dice: "1d4", type: "poison" } } });
  const reg2 = reg([ironbar, mat2], [EDGE, { name: "grip", drives: "bonusDamage", qty: 1 }]);
  const r = plan(reg2, { edge: "ironbar", grip: "fang" }, ledgerWith({}));
  assert.ok(r.ok, r.errors?.join(" | ")); assert.equal(r.plan.frozen, null); void registry;
});
test("EMBED: the compact copy of an ingredient's record keeps what provenance needs and nothing computed", () => {
  const e = embedRecord(REC({ uses: [{ slot: "s", ref: "iron" }], roles: { x: 1 }, contributions: [1] }));
  assert.deepEqual(Object.keys(e).sort(), ["depth", "inherited", "name", "native", "recipeId", "tier", "uses"]);
  assert.equal(embedRecord(null), null);
});

test("3a: the leak scan fails when an inherited list, a passCap, outputTags or a native list reaches a player record", async () => {
  const { findTagLeaks } = await import("./helpers.js");
  for (const key of ["inherited", "passCap", "outputTags", "native"]) assert.ok(findTagLeaks({ slots: [], [key]: [] }).length, key);
});
