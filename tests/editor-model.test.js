import test from "node:test";
import assert from "node:assert/strict";
import { CLASS_IDS, applyControl, changesOf, defaultPreviewClass, draftFor, draftProblems, edit, editorModel, filterItems, isDirty, listItems, previewOf, renderEditor } from "../scripts/editor/model.js";
import { makeRegistry } from "./fake-world.js";

const registry = makeRegistry();
const FANG = "material:spider-fang";
const model = (extra = {}) => {
  const base = extra.key === null ? null : draftFor(registry, {}, extra.key ?? FANG);
  return editorModel({ registry, selectedKey: extra.key ?? FANG, base, draft: extra.draft ?? base, origin: { origin: "pack", editedFields: [], hasItem: true }, ...extra.input });
};
const ctl = (draft, d, value) => applyControl(draft, d, value);

test("an untouched draft is not dirty and changes nothing; an edit of a block that is not there is a no-op", () => {
  const base = draftFor(registry, {}, FANG);
  assert.equal(isDirty(structuredClone(base), base), false);
  assert.deepEqual(changesOf(structuredClone(base), base), {});
  const poke = ctl(base, { field: "block", cls: "armor", type: "damage", name: "dice" }, "9d6");
  assert.deepEqual(poke, base, "no block there: nothing happens, and no empty class entry appears");
});

test("changes carry only what differs, with numbers as numbers and blanks removing optional fields", () => {
  const base = draftFor(registry, {}, FANG);
  let d = ctl(base, { field: "basic", name: "value" }, "30");
  d = ctl(d, { field: "basic", name: "tier" }, "3");
  d = ctl(d, { field: "basic", name: "label" }, "Parts");
  assert.deepEqual(changesOf(d, base), { value: 30, tier: 3, label: "Parts" });
  d = ctl(d, { field: "basic", name: "label" }, "  ");
  assert.deepEqual(changesOf(d, base), { value: 30, tier: 3, label: undefined }, "a label cannot be blank, so it is removed");
  const blankValue = ctl(base, { field: "basic", name: "value" }, "");
  assert.deepEqual(changesOf(blankValue, draftFor(registry, {}, "material:iron")).value, undefined);
});

test("blocks: add one per type, set values, switch to a per-tier table and back, remove", () => {
  let d = draftFor(registry, {}, "material:iron");
  d = ctl(d, { field: "power", cls: "weapon" }, "3");
  assert.equal(d.blocks.byClass.weapon.power, 3);
  d = applyControl(d, { field: "power", cls: "weapon" }, "");
  assert.equal(d.blocks.byClass.weapon, undefined, "an emptied class leaves no entry");
  d = edit.addBlock(d, "weapon", "damage");
  assert.equal(edit.addBlock(d, "weapon", "damage"), d, "a second Add damage in the same class does nothing");
  d = ctl(d, { field: "block", cls: "weapon", type: "damage", name: "dice" }, "2d8");
  d = ctl(d, { field: "block", cls: "weapon", type: "damage", name: "damageType" }, "cold");
  d = ctl(d, { field: "tier-mode", cls: "weapon", type: "damage", name: "dice" }, "table");
  assert.deepEqual(Object.keys(d.blocks.byClass.weapon.blocks[0].dice.byTier), ["1", "2", "3", "4", "5"]);
  d = ctl(d, { field: "cell", cls: "weapon", type: "damage", name: "dice", tier: 4 }, "3d8");
  assert.equal(d.blocks.byClass.weapon.blocks[0].dice.byTier[4], "3d8");
  d = ctl(d, { field: "tier-mode", cls: "weapon", type: "damage", name: "dice" }, "flat");
  assert.deepEqual(d.blocks.byClass.weapon.blocks[0].dice, { all: "2d8" }, "back to one value: the value for this material's tier");
  d = edit.removeBlock(d, "weapon", "damage");
  assert.equal(d.blocks.byClass.weapon, undefined);
});

test("problems are plain sentences: no name, bad tier, a note with no formula, a class that cannot take a block", () => {
  const base = draftFor(registry, {}, FANG);
  const bad = ctl(ctl(base, { field: "basic", name: "name" }, " "), { field: "basic", name: "tier" }, "7");
  const p = draftProblems(bad, registry);
  assert.ok(p.fields.includes("Give it a name.") && p.fields.some(t => /Tier must be/.test(t)));
  assert.equal(p.any, true);
  const withBlock = edit.addBlock(base, "armor", "damage");
  assert.match(draftProblems(withBlock, registry).effects.armor[0], /does not apply to armor/);
  const noteKey = [...registry.note.keys()][0];
  if (noteKey) {
    const note = draftFor(registry, {}, `note:${noteKey}`);
    assert.equal(draftProblems(ctl(note, { field: "basic", name: "recipeId" }, ""), registry).fields.some(t => /Pick the formula/.test(t)), true);
  }
});

test("the window model: Save needs a change AND no problems; Push needs a clean draft; delete only for what was made here", () => {
  const clean = model();
  assert.deepEqual([clean.detail.actions.canSave, clean.detail.actions.canPush, clean.detail.actions.canDelete], [false, true, false]);
  const base = draftFor(registry, {}, FANG);
  const dirty = model({ draft: ctl(base, { field: "basic", name: "value" }, "30") });
  assert.deepEqual([dirty.detail.actions.canSave, dirty.detail.actions.canPush, dirty.detail.actions.canDiscard], [true, false, true]);
  const broken = model({ draft: ctl(base, { field: "basic", name: "name" }, "") });
  assert.equal(broken.detail.actions.canSave, false);
  const mine = model({ input: { origin: { origin: "world", editedFields: [], hasItem: false } } });
  assert.deepEqual([mine.detail.actions.canDelete, mine.detail.actions.canMakeItem], [true, true]);
});

test("the preview opens on the first class that has its own effects, and follows the picker", () => {
  const d = edit.addBlock(draftFor(registry, {}, "material:iron"), "bomb", "damage");
  assert.equal(defaultPreviewClass(d.blocks), "bomb");
  assert.equal(model({ draft: d, input: {} }).preview.classes.find(c => c.selected).id, "bomb");
  assert.equal(model({ draft: d, input: { previewClass: "armor" } }).preview.classes.find(c => c.selected).id, "armor");
  const lines = previewOf(registry, d, "bomb").lines.join(" ");
  assert.match(lines, /1d6/);
  assert.match(previewOf(registry, d, "armor").lines.join(" ") || "", /^((?!1d6).)*$/, "the bomb's damage is not shown for armor");
  assert.deepEqual(CLASS_IDS.sort(), ["armor", "bomb", "consumable", "focus", "robes", "trinket", "weapon"]);
});

test("the preview warns when the text carries a DC (players would read it on the item)", () => {
  const p = previewOf(registry, draftFor(registry, {}, FANG), "weapon");
  assert.match(p.warning, /DC or odds/);
  assert.equal(previewOf(registry, draftFor(registry, {}, "material:iron"), "weapon").warning, undefined);
});

test("the list: search, kind and track chips, retired hidden unless asked, origin tags, leftovers", () => {
  const retired = new Map(registry.material);
  retired.set("old", { ...registry.material.get("iron"), id: "old", name: "Old Stuff", retired: true });
  const reg = { ...registry, material: retired };
  const items = listItems(reg, {}, { "material:iron": { mode: "patch" }, "material:old": { mode: "new" } });
  assert.equal(filterItems(items, {}).some(i => i.id === "old"), false);
  assert.equal(filterItems(items, { retired: true }).some(i => i.id === "old"), true);
  assert.deepEqual(filterItems(items, { search: "spider", kinds: ["material"] }).map(i => i.id), ["spider-fang"]);
  assert.equal(items.find(i => i.id === "iron").origin, "edited");
  assert.equal(items.find(i => i.id === "old").origin, "world");
  const m = editorModel({ registry: reg, leftovers: [{ key: "material:gone", message: "is a research track for an item that no longer exists" }] });
  assert.equal(m.list.leftovers.items.length, 1);
  assert.match(renderEditor(m), /clear-leftover/);
});

test("the creator asks for a name (and for a formula on a note) and says why it cannot create yet", () => {
  const m = editorModel({ registry, creating: { kind: "note", name: "" } });
  assert.equal(m.detail.canCreate, false);
  assert.equal(m.detail.problems.length, 2);
  const ok = editorModel({ registry, creating: { kind: "material", name: "Gate Fang", tier: 2 } });
  assert.equal(ok.detail.canCreate, true);
  assert.match(renderEditor(ok), /data-action="do-create"/);
});

test("markup: every control is labelled, every button is a plain button, text is escaped, and Save/Discard sit outside the scrolling part", () => {
  const base = draftFor(registry, {}, FANG);
  const d = ctl(base, { field: "basic", name: "description" }, '<img src=x onerror=alert(1)> & "quotes"');
  const html = renderEditor(model({ draft: d }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) assert.match(m[0], /aria-label="[^"]+"/, `unlabelled: ${m[0].slice(0, 80)}`);
  for (const m of html.matchAll(/<button\b[^>]*>/g)) assert.match(m[0], /type="button"/);
  const detail = html.slice(html.indexOf("pfp-editor-detail"));
  assert.ok(detail.indexOf("pfp-editor-actions") > detail.indexOf("</div>"), "the action row follows the scrolling part");
  assert.doesNotMatch(html.slice(0, html.indexOf("pfp-editor-actions")).slice(html.indexOf('data-scroll-key="detail"')), /data-action="save"/);
});

test("a confirmation is plain words with two buttons", () => {
  const html = renderEditor(model({ input: { confirm: { text: "Ann already knows something this changes.", action: "save" } } }));
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /data-action="confirm-yes"/);
  assert.match(html, /data-action="confirm-no"/);
});

test("the base-power tier can be set on every class that has one (weapon, armor, robes, focus, bomb, consumable, trinket), not just on Every class", () => {
  const d = draftFor(registry, {}, "material:iron");
  for (const cls of ["general", "weapon", "armor", "robes", "focus", "bomb", "consumable", "trinket"]) {
    const m = editorModel({ registry, selectedKey: "material:iron", base: d, draft: d, effectClass: cls, origin: { origin: "pack", editedFields: [], hasItem: true } });
    assert.ok(m.detail.effects.power, `${cls} offers a base power tier`);
  }
  assert.match(renderEditor(editorModel({ registry, selectedKey: "material:iron", base: d, draft: d, effectClass: "weapon", origin: { origin: "pack", editedFields: [], hasItem: true } })), /data-field="power" data-cls="weapon"/);
});
