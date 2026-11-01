/** The preview's three stages (v0.21.1): built from stripForPlayer and the Hub's own Compendium view-model, never from the raw record. */
import test from "node:test";
import assert from "node:assert/strict";
import { applyControl, draftFor, editorModel, previewOf, renderEditor } from "../scripts/editor/model.js";
import { FORMULAS_ONLY, NO_STUDY, STAGES, STAGE_LABELS, stageOf } from "../scripts/editor/preview.js";
import { newBlock } from "../scripts/editor/blocks.js";
import { compendiumTab } from "../scripts/hub/viewmodels-compendium.js";
import { S } from "../scripts/hub/strings.js";
import { scanClean } from "./scan.js";
import { makeRegistry } from "./fake-world.js";

const registry = makeRegistry();
registry.tag.set("gate-ore", { kind: "tag", id: "gate-ore", name: "Gate ore", theme: "cowardice", worksWith: "frightened" });

/** A material draft: tier 2, 25 gp, tag Gate ore, a weapon class that adds 1d6 fire damage and an ability without a DC; steps are odd numbers so a leak is easy to spot. */
function draftWith({ track = [], tag = "gate-ore" } = {}) {
  let d = draftFor(registry, {}, "material:iron");
  d = { ...d, id: "gate-stage", fields: { ...d.fields, name: "Gate Stage", tier: "2", value: "25", tag, bulk: "1" } };
  d = applyControl(d, { field: "power", cls: "weapon" }, "2");
  d = { ...d, blocks: { ...d.blocks, byClass: { weapon: { power: 2, blocks: [{ type: "damage", dice: { all: "1d6" }, damageType: "fire" }, { type: "ability", title: "Gate Bite", text: "The bite lingers." }] } } } };
  return { ...d, rows: track.map(([steps, type]) => ({ steps: String(steps), type, recipeId: "" })) };
}
const lines = st => [st.meta, ...st.facts, ...(st.know?.items ?? []), ...(st.know?.empty ? [st.know.empty] : []), ...(st.note ? [st.note] : []), ...st.effects];
const leaks = st => scanClean({ ...st, effects: undefined, effectLines: st.effects });
const PLAYER_FIELDS = ["hasTrack", "id", "kind", "name", "tag", "tier", "value"];

test("STAGE 1 with no study: the tag and theme are known on pickup; no effects", () => {
  const st = stageOf(registry, draftWith(), "picked", "weapon");
  assert.equal(st.meta, "Tier 2");
  assert.deepEqual(st.facts, ["Worth 25 gp each", "Bulk 1"]);
  assert.deepEqual(st.know.items, [S.tagLine("Gate ore", "cowardice"), S.tagWorksWith("frightened")]);
  assert.deepEqual(st.effects, []);
});

test("STAGE 1 with a study: it has not been studied, and neither tag nor theme is shown", () => {
  const st = stageOf(registry, draftWith({ track: [[777, "properties"], [913, "formula"]] }), "picked", "weapon");
  assert.deepEqual(st.know, { items: [], empty: S.notStudied });
  assert.doesNotMatch(JSON.stringify(st), /cowardice|Gate ore|frightened/);
  assert.deepEqual(st.effects, []);
});

test("STAGE 2: with no study it is the same as stage 1 and says so; with a properties milestone it adds the tag and theme but still no effects", () => {
  const none = stageOf(registry, draftWith(), "studied", "weapon");
  assert.equal(none.same, true);
  assert.equal(none.note, NO_STUDY);
  assert.deepEqual(none.effects, []);
  const tracked = stageOf(registry, draftWith({ track: [[777, "properties"]] }), "studied", "weapon");
  assert.deepEqual(tracked.know.items, [S.tagLine("Gate ore", "cowardice"), S.tagWorksWith("frightened")]);
  assert.deepEqual(tracked.effects, []);
  assert.equal(tracked.same, false);
});

test("STAGE 2 when the study only teaches formulas: no tag, no theme, and it says what it does teach", () => {
  const st = stageOf(registry, draftWith({ track: [[777, "formula"]] }), "studied", "weapon");
  assert.equal(st.note, FORMULAS_ONLY);
  assert.deepEqual(st.know, { items: [], empty: S.notStudied });
  assert.doesNotMatch(JSON.stringify(st), /cowardice/);
});

test("STAGE 3: the plain-words effect lines of the picked class, and the tag and theme (it must have been studied to craft)", () => {
  const st = stageOf(registry, draftWith({ track: [[777, "properties"]] }), "crafted", "weapon");
  assert.deepEqual(st.effects, ["Gate Stage sets the weapon's power (tier 2)", "Gate Stage adds +1d6 fire damage", "Gate Stage gives Gate Bite: The bite lingers."]);
  assert.deepEqual(st.know.items, [S.tagLine("Gate ore", "cowardice"), S.tagWorksWith("frightened")]);
  const armor = stageOf(registry, draftWith(), "crafted", "armor").effects.join(" ");
  assert.doesNotMatch(armor, /1d6|fire damage|Gate Bite/, "the weapon class's own effects are not shown for armor");
});

test("EQUALS THE HUB: each stage's lines are exactly what the real Hub renders for the same facts, written out by hand", () => {
  const d = draftWith({ track: [[777, "properties"]] });
  const entry = { id: "gate-stage", name: "Gate Stage", tier: 2, places: [], rungs: [], usedIn: [] };
  const hub = (info, experiments = [], category = "materials", entryKey = "gate-stage") => compendiumTab({
    compendium: { entries: { materials: [entry], creatures: [], regions: [], experiments }, own: {}, shared: {} }, shares: [], materialInfo: { "gate-stage": info }, recipes: { r: { id: "r", category: "weapon" } }
  }, { category, entryKey }).detail;
  const know = detail => detail.sections.find(s => s.heading === S.whatYouKnow);
  const picked = hub({ hasTrack: true, known: false, tag: null });
  assert.deepEqual([stageOf(registry, d, "picked", "weapon").title, stageOf(registry, d, "picked", "weapon").meta], [picked.title, picked.meta]);
  assert.deepEqual(stageOf(registry, d, "picked", "weapon").know, { items: know(picked).items, empty: know(picked).empty });
  const studied = hub({ hasTrack: true, known: true, tag: { name: "Gate ore", theme: "cowardice", worksWith: "frightened" } });
  assert.deepEqual(stageOf(registry, d, "studied", "weapon").know, { items: know(studied).items, empty: know(studied).empty });
  const experiment = { recipeId: "r", name: "A recipe", source: "own", baseline: null, known: [{ slot: "slot", materialId: "gate-stage", material: "Gate Stage", tier: 2, source: "crafted", effects: { basePower: "T2", bonusDamage: { dice: "1d6", type: "fire" }, specialAbility: { title: "Gate Bite", text: "The bite lingers." } } }] };
  const crafted = hub({ hasTrack: true, known: true, tag: null }, [experiment], "experiments", "r");
  assert.deepEqual(stageOf(registry, d, "crafted", "weapon").effects, crafted.known.items[0].effects);
});

test("LEAK SCAN: no stage of any kind of item carries a threshold, a step count, a DC, odds or difficulty wording", () => {
  for (const track of [[], [[777, "properties"]], [[777, "properties"], [913, "formula"]], [[913, "formula"]]]) {
    for (const stage of STAGES) {
      for (const cls of ["weapon", "armor", "bomb", "trinket", "focus"]) {
        const st = stageOf(registry, draftWith({ track }), stage, cls);
        assert.deepEqual(leaks(st), [], `${stage}/${cls}/${JSON.stringify(track)}`);
        assert.doesNotMatch(JSON.stringify(st), /777|913|steps?\b|milestone|threshold|research"/i, `${stage}/${cls}`);
      }
    }
  }
});

test("MUTATION GUARD: no stage but the craft stage ever carries an effect line, whatever the item has", () => {
  for (const track of [[], [[777, "properties"]]]) for (const stage of ["picked", "studied"]) {
    const st = stageOf(registry, draftWith({ track }), stage, "weapon");
    assert.deepEqual(st.effects, [], `${stage} with ${track.length} milestone(s)`);
    assert.doesNotMatch(JSON.stringify(st), /1d6|fire damage|Gate Bite|power \(tier/);
    assert.equal(st.fits, null);
  }
});

test("THE CONTROL: three real buttons with words, one pressed; the class picker only on the craft stage; the default is the craft stage", () => {
  const base = draftFor(registry, {}, "material:iron");
  const html = stage => renderEditor(editorModel({ registry, selectedKey: "material:iron", base, draft: base, previewStage: stage, origin: { origin: "pack", editedFields: [], hasItem: true } }));
  const crafted = html();
  for (const id of STAGES) assert.match(crafted, new RegExp(`data-action="preview-stage" data-stage="${id}"[^>]*>${STAGE_LABELS[id]}</button>`));
  assert.match(crafted, /data-stage="crafted" aria-pressed="true"/);
  assert.match(crafted, /data-field="preview-class"/);
  const picked = html("picked");
  assert.match(picked, /data-stage="picked" aria-pressed="true"/);
  assert.match(picked, /data-stage="crafted" aria-pressed="false"/);
  assert.doesNotMatch(picked, /data-field="preview-class"/);
  assert.match(picked, /No effects yet: a player learns what it does by crafting with it\./);
  assert.equal(previewOf(registry, base, "weapon", "nonsense").stage, "crafted", "an unknown stage falls back");
  void newBlock;
});

test("THE PLAYER'S RECORD: every stage is built from what stripForPlayer sends (no effects, no track, no editor fields), and the tag only once known", () => {
  for (const track of [[], [[777, "properties"]], [[913, "formula"]]]) for (const stage of STAGES) {
    const st = stageOf(registry, draftWith({ track }), stage, "weapon");
    if (st.same) continue;
    assert.ok(Object.keys(st.player).every(k => PLAYER_FIELDS.includes(k)), `${stage}/${JSON.stringify(track)}: ${Object.keys(st.player)}`);
    assert.equal(st.player.hasTrack, track.length > 0);
  }
  const tracked = stageOf(registry, draftWith({ track: [[777, "properties"]] }), "picked", "weapon");
  assert.equal(tracked.player.tag, undefined, "a tracked item's tag is not sent before it is studied");
  assert.equal(stageOf(registry, draftWith({ track: [[777, "properties"]] }), "studied", "weapon").player.tag, "gate-ore");
  assert.equal(stageOf(registry, draftWith(), "picked", "weapon").player.tag, "gate-ore", "an item with no study sends its tag on pickup");
});
