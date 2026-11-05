/** The tag window (Slice 1, GM only) on the strict ApplicationV2 fake: tag a material and an item, refuse an item without a tier, create a tag, set a priority, set a slot's needs. */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, as, env, getApi, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { installFakeApplication } from "./fake-application.js";
import { build } from "../scripts/tags/app.js";
import { renderTagger, taggerModel } from "../scripts/tags/model.js";
import { emptyLedger } from "../scripts/tags/ledger.js";

const api = () => getApi();
const wait = ms => new Promise(r => setTimeout(r, ms));
const ITEM = "Compendium.pf2e.equipment-srd.Item.TTTTTTTTTTTTTTTT";

async function windowFor() {
  const w = await world({ perClientDefinitions: true, downtime: 0, iron: 0, fang: 0 });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  installFakeApplication();
  const app = new (build())(api());
  await as(w.gm, () => app.render({ force: true }));
  const el = () => app.element;
  const text = () => el().textContent.replace(/\s+/g, " ");
  const click = async (action, where = "") => { const t = [...el().querySelectorAll(`[data-action="${action}"]${where}`)][0]; assert.ok(t, `${action}${where} is on the page`); await as(w.gm, async () => { t.click(); await wait(30); }); };
  const set = async (selector, value) => {
    const input = el().querySelector(selector);
    assert.ok(input, `${selector} exists`);
    if (input.type === "checkbox") input.checked = value; else input.value = value;
    await as(w.gm, async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); await wait(30); });
  };
  return { w, app, el, text, click, set };
}

test("WINDOW: GM only", async () => {
  const w = await world({ perClientDefinitions: true });
  installFakeApplication();
  const app = new (build())(api());
  await as(w.annUser, () => app.render({ force: true }));
  assert.match(app.element.textContent, /GM only/);
});

test("WINDOW: create a tag, give it a priority, tag a material with two tags, see it listed", async () => {
  const { w, text, click, set } = await windowFor();
  await click("tab", '[data-tab="tags"]');
  await set('[data-field="new-tag-name"]', "Venom Tooth");
  await click("create-tag");
  assert.match(text(), /Made the tag Venom Tooth/);
  assert.ok(api().definitions.tag.has("venom-tooth"));
  assert.equal(api().definitions.tag.get("venom-tooth").theme, "Venom Tooth", "the theme defaults to the name");
  await set('[data-field="new-tag-name"]', "Sharp Edge"); await set('[data-field="new-tag-theme"]', "cutting");
  await click("create-tag");
  await set('[data-field="priority"][data-tag="venom-tooth"]', "7");
  await click("save-priority", '[data-tag="venom-tooth"]');
  assert.match(text(), /Saved the priority/);
  assert.equal(api().definitions.tag.get("venom-tooth").priority, 7);
  await click("tab", '[data-tab="items"]');
  await set('[data-field="material"]', "spider-fang");
  await set('[data-field="tag"][data-tag="venom-tooth"]', true);
  await set('[data-field="tag"][data-tag="sharp-edge"]', true);
  await click("save-entry");
  assert.match(text(), /Saved Spider Fang/);
  assert.deepEqual(env.values.tagLedger.items["spider-fang"].tags, ["venom-tooth", "sharp-edge"]);
  assert.match(text(), /Spider Fang[\s\S]*Venom Tooth[\s\S]*Sharp Edge/);
  void w;
});

test("WINDOW: an item that is not a material cannot be saved without a tier; with one it is", async () => {
  const { click, set, text } = await windowFor();
  await as(getApiGm(), () => api().editor.create("tag", { name: "Venom Tooth", theme: "x" }, { makeItem: false }));
  await click("tab", '[data-tab="items"]');
  await set('[data-field="source"]', "item");
  await set('[data-field="uuid"]', ITEM);
  await set('[data-field="name"]', "Wolf Tooth");
  await set('[data-field="tag"][data-tag="venom-tooth"]', true);
  await click("save-entry");
  assert.match(text(), /no tier of its own: give it one/);
  assert.equal(env.values.tagLedger, undefined, "nothing was saved");
  await set('[data-field="tier"]', "2");
  await click("save-entry");
  assert.match(text(), /Saved Wolf Tooth/);
  assert.deepEqual(env.values.tagLedger.items[ITEM], { tags: ["venom-tooth"], tier: 2, name: "Wolf Tooth" });
  await click("remove-entry", `[data-ref="${ITEM}"]`);
  assert.match(text(), /Wolf Tooth is no longer tagged/);
});
const getApiGm = () => globalThis.game.users.get("gm1");

test("WINDOW: set what a recipe slot needs, then take it back to the tier rule", async () => {
  const { click, set, text } = await windowFor();
  await as(getApiGm(), () => api().editor.create("tag", { name: "Venom Tooth", theme: "x" }, { makeItem: false }));
  await click("tab", '[data-tab="slots"]');
  await set('[data-field="recipe"]', DAGGER);
  await set('[data-field="slot-tag"][data-slot="fang"][data-tag="venom-tooth"]', true);
  await set('[data-field="slot-optional"][data-slot="fang"]', true);
  await click("save-slot", '[data-slot="fang"]');
  assert.match(text(), /Saved fang/);
  assert.deepEqual(api().definitions.recipe.get(DAGGER).slots.find(s => s.name === "fang").needs, { all: ["venom-tooth"], optional: true });
  assert.match(text(), /by tag/);
  await click("clear-slot", '[data-slot="fang"]');
  assert.equal(api().definitions.recipe.get(DAGGER).slots.find(s => s.name === "fang").needs, undefined);
});

test("WINDOW: saving a slot with no tag ticked says so instead of saving", async () => {
  const { click, set, text } = await windowFor();
  await click("tab", '[data-tab="slots"]');
  await set('[data-field="recipe"]', DAGGER);
  await set('[data-field="slot-optional"][data-slot="fang"]', true);
  await click("save-slot", '[data-slot="fang"]');
  assert.match(text(), /Pick at least one tag/);
});

test("MODEL: the markup escapes names (a hostile item name cannot inject markup)", () => {
  const reg = { material: new Map(), tag: new Map([["x", { id: "x", name: "<img src=x onerror=1>", theme: "t" }]]), recipe: new Map() };
  const html = renderTagger(taggerModel({ tab: "tags", draft: { source: "material", tags: [] } }, reg, emptyLedger()));
  assert.ok(!html.includes("<img src=x"), html);
  assert.match(html, /&lt;img src=x/);
});

// The effect builder and the caps (Slice 2a) -------------------------------------------------------------------------------
const makeTag = async (name = "Venom Tooth") => as(getApiGm(), () => api().editor.create("tag", { name, theme: "x" }, { makeItem: false }));

test("BUILDER: open a tag's effects, add a damage block, fill the dice by tier, and save it as an editor patch the registry reads", async () => {
  const { click, set, text, el } = await windowFor();
  await makeTag();
  await click("tab", '[data-tab="tags"]');
  await click("edit-effects", '[data-tag="venom-tooth"]');
  assert.match(text(), /What Venom Tooth does/);
  await click("fx-add", '[data-type="damage"]');
  await set('[data-field="fx-tiervalue"][data-name="dice"][data-tier="all"]', "1d8");
  await set('[data-field="fx-field"][data-name="damageType"]', "poison");
  await set('[data-field="fx-field"][data-name="bonusType"]', "item");
  assert.match(text(), /1d8/, "the preview shows the dice");
  await set('[data-field="fx-tiermode"][data-name="dice"]', "table");
  await set('[data-field="fx-tiervalue"][data-name="dice"][data-tier="5"]', "3d8");
  assert.ok(el().querySelector('[data-part="fx-preview"]').textContent.includes("3d8"));
  await click("fx-save");
  assert.match(text(), /Saved the tag's effects/);
  const saved = api().definitions.tag.get("venom-tooth").effectBlocks;
  assert.equal(saved.general.blocks[0].bonusType, "item"); assert.equal(saved.general.blocks[0].dice.byTier[5], "3d8");
  assert.ok(api().editor.records()["tag:venom-tooth"].fields.effectBlocks, "stored in the world editor, not the packs");
});
test("BUILDER: a draft with a problem names it and cannot be saved", async () => {
  const { click, text } = await windowFor();
  await makeTag();
  await click("tab", '[data-tab="tags"]');
  await click("edit-effects", '[data-tag="venom-tooth"]');
  await click("fx-class", '[data-cls="armor"]');
  await click("fx-add", '[data-type="damage"]');
  assert.match(text(), /armor: Add damage does not apply to armor items|does not apply to armor/);
  await click("fx-save");
  assert.equal(api().definitions.tag.get("venom-tooth").effectBlocks, undefined, "nothing was saved");
  assert.match(text(), /does not apply to armor/);
});
test("BUILDER: Any item has no 'Apply a condition' button (it belongs to a weapon, bomb or consumable)", async () => {
  const { click, el } = await windowFor();
  await makeTag();
  await click("tab", '[data-tab="tags"]');
  await click("edit-effects", '[data-tag="venom-tooth"]');
  assert.equal(el().querySelector('[data-action="fx-add"][data-type="condition"]'), null);
  await click("fx-class", '[data-cls="weapon"]');
  assert.ok(el().querySelector('[data-action="fx-add"][data-type="condition"]'));
});
test("BUILDER: Discard throws the draft away; removing every block takes the effects off the tag", async () => {
  const { click, text } = await windowFor();
  await makeTag();
  await api().editor.update("tag:venom-tooth", { effectBlocks: { general: { blocks: [{ type: "damage", dice: { all: "1d4" }, damageType: "fire" }] } } }, { confirmed: true });
  await click("tab", '[data-tab="tags"]');
  await click("edit-effects", '[data-tag="venom-tooth"]');
  await click("fx-remove", '[data-index="0"]');
  await click("fx-discard");
  assert.ok(api().definitions.tag.get("venom-tooth").effectBlocks, "discard changed nothing");
  await click("edit-effects", '[data-tag="venom-tooth"]');
  await click("fx-remove", '[data-index="0"]');
  await click("fx-save");
  assert.match(text(), /Saved the tag's effects/);
  assert.equal(api().definitions.tag.get("venom-tooth").effectBlocks, undefined);
});
test("CAPS: the window shows the defaults, saves a changed cap, refuses a bad one, and goes back to the defaults", async () => {
  const { click, set, text } = await windowFor();
  await click("tab", '[data-tab="tags"]');
  assert.match(text(), /Caps/);
  await set('[data-field="cap"][data-role="resistance"][data-name="maxValue"]', "20");
  await click("caps-save");
  assert.match(text(), /Saved the caps/);
  assert.equal(env.values.tagCaps.roles.resistance.maxValue, 20);
  assert.equal(await as(getApiGm(), () => api().tags.caps().effective.resistance.maxValue), 20);
  await set('[data-field="cap"][data-role="resistance"][data-name="maxValue"]', "0");
  await click("caps-save");
  assert.match(text(), /whole number from 1 to 99/);
  assert.equal(env.values.tagCaps.roles.resistance.maxValue, 20, "the bad value was not saved");
  await click("caps-reset");
  assert.match(text(), /back to the defaults/);
  assert.equal(await as(getApiGm(), () => api().tags.caps().effective.resistance.maxValue), 10);
});
test("CAPS: only a GM can read or write them", async () => {
  const w = await world({ perClientDefinitions: true });
  await assert.rejects(as(w.annUser, () => api().tags.setCaps({ v: 1, roles: { resistance: { maxValue: 3 } } })), /tags\.setCaps: GM only/);
  await assert.rejects(as(w.annUser, async () => api().tags.caps()), /tags\.caps: GM only/);
  assert.equal(env.values.tagCaps, undefined, "nothing was written");
});

// Slice 2b: slot kinds, the kind scope of the effects builder, and recipe overrides ----------------------------------------------------
test("KIND (window): set a slot's kind alone, without touching its needs; the kind scope of the builder writes a bySlot set", async () => {
  const { click, set, text } = await windowFor();
  await makeTag();
  await click("tab", '[data-tab="slots"]');
  await set('[data-field="recipe"]', DAGGER);
  await set('[data-field="slot-kind"][data-slot="fang"]', "decoration");
  await click("save-slot", '[data-slot="fang"]');
  assert.match(text(), /Saved fang/);
  const fang = api().definitions.recipe.get(DAGGER).slots.find(s => s.name === "fang");
  assert.equal(fang.kind, "decoration"); assert.equal(fang.needs, undefined, "the needs were left alone");
  await click("tab", '[data-tab="tags"]');
  await click("edit-effects", '[data-tag="venom-tooth"]');
  await set('[data-field="fx-kind"]', "decoration");
  await click("fx-add", '[data-type="damage"]');
  await set('[data-field="fx-tiervalue"][data-name="dice"][data-tier="all"]', "1d8");
  assert.match(text(), /1d8/);
  await click("fx-save");
  const saved = api().definitions.tag.get("venom-tooth").effectBlocks;
  assert.equal(saved.bySlot.decoration.general.blocks[0].dice.all, "1d8"); assert.equal(saved.general, undefined, "not written as an any-slot set");
});
test("KIND (api): setSlotKind and setTagOverride are GM only, validated, and revertable", async () => {
  const w = await world({ perClientDefinitions: true });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  await as(w.gm, () => api().editor.create("tag", { name: "Venom Tooth", theme: "x" }, { makeItem: false }));
  await assert.rejects(as(w.annUser, () => api().tags.setSlotKind(DAGGER, "fang", "decoration")), /tags\.setSlotKind: GM only/);
  await assert.rejects(as(w.annUser, () => api().tags.setTagOverride(DAGGER, "venom-tooth", "fang", { blocks: [] })), /tags\.setTagOverride: GM only/);
  await as(w.gm, async () => {
    await assert.rejects(api().tags.setSlotKind(DAGGER, "fang", "Bad Kind!"), /lowercase letters/);
    await assert.rejects(api().tags.setSlotKind(DAGGER, "nope", "x"), /has no slot "nope"/);
    assert.equal((await api().tags.setSlotKind(DAGGER, "fang", "decoration")).kind, "decoration");
    await assert.rejects(api().tags.setTagOverride(DAGGER, "ghost", "decoration", { blocks: [{ type: "damage", dice: { all: "1d4" }, damageType: "fire" }] }), /unknown tag "ghost"/);
    await assert.rejects(api().tags.setTagOverride(DAGGER, "venom-tooth", "nowhere", { blocks: [{ type: "damage", dice: { all: "1d4" }, damageType: "fire" }] }), /not a slot kind of this recipe/);
    const list = await api().tags.setTagOverride(DAGGER, "venom-tooth", "decoration", { blocks: [{ type: "damage", dice: { all: "2d6" }, damageType: "fire" }] });
    assert.equal(list.length, 1);
    assert.equal((await api().tags.setTagOverride(DAGGER, "venom-tooth", "decoration", { blocks: [{ type: "damage", dice: { all: "3d6" }, damageType: "fire" }] })).length, 1, "the same pair is replaced, not doubled");
    assert.deepEqual(await api().tags.removeTagOverride(DAGGER, "venom-tooth", "decoration"), []);
    assert.equal(api().definitions.recipe.get(DAGGER).tagOverrides, undefined);
    assert.equal((await api().tags.setSlotKind(DAGGER, "fang", null)).kind, undefined, "back to the slot's own name");
  });
});
