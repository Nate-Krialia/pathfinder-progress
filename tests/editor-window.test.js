/** The item editor window (Stage 11d, GM only) on the strict ApplicationV2 fake: pick, edit, save, confirm, create, push, delete, keyboard. */
import test from "node:test";
import assert from "node:assert/strict";
import { M, as, getApi, world } from "./fake-world.js";
import { asPage, seedRecords } from "./helpers.js";
import { build } from "../scripts/editor/app.js";
import { keyOfItem } from "../scripts/editor/entry.js";
import { rowEdit, rowProblems, rowsOf, trackOfRows } from "../scripts/editor/rows.js";
import { installFakeApplication } from "./fake-application.js";

const api = () => getApi();
const wait = ms => new Promise(r => setTimeout(r, ms));
const track = (...m) => ({ milestones: m.map(([steps, type, recipeId]) => ({ steps, grants: type === "formula" ? { type, ...(recipeId ? { recipeId } : {}) } : { type } })) });

async function windowFor(key = null, options = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 0, iron: 0, fang: 0, ...options });
  api().baseSources = seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }));
  api().editorLeftovers = [];
  installFakeApplication();
  const app = new (build())(api(), key);
  await as(w.gm, () => app.render({ force: true }));
  const el = () => app.element;
  const text = () => el().textContent.replace(/\s+/g, " ");
  const live = (action, where = "") => [...el().querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
  const click = async (action, where = "") => { const t = live(action, where); assert.ok(t, `${action}${where} is live`); await as(w.gm, async () => { t.click(); await wait(25); }); };
  const set = async (selector, value, event = "change") => {
    const input = el().querySelector(selector);
    assert.ok(input, `${selector} exists`);
    if (input.type === "checkbox") input.checked = value; else input.value = value;
    await as(w.gm, async () => { input.dispatchEvent(new window.Event(event, { bubbles: true })); await wait(25); });
  };
  return { w, app, el, text, click, set, live };
}

test("ROWS: the track rows moved with the editor and still make plain-words problems", () => {
  const reg = { recipe: new Map([["blade", { id: "blade" }]]), note: new Map([["page", { id: "page", recipeId: "blade" }]]) };
  let rows = rowEdit.addDefault("material", "blade");
  assert.deepEqual(trackOfRows(rows), track([4, "properties"], [8, "formula", "blade"]));
  assert.deepEqual(rowProblems(rows, "material", "x", reg), []);
  rows = rowEdit.setSteps(rows, 1, "4");
  assert.match(rowProblems(rows, "material", "x", reg)[0].text, /must be more than the milestone before it \(4\)/);
  rows = rowEdit.setSteps(rowEdit.setSteps(rows, 1, "abc"), 0, "4");
  assert.deepEqual(rowProblems(rows, "material", "x", reg), [{ index: 1, text: "Steps must be a whole number of at least 1." }]);
  assert.deepEqual(rowProblems(rowsOf(track([4, "properties"])), "note", "page", reg).map(p => p.text), ["Only a material has a properties milestone."]);
  assert.equal(rowEdit.add([], "material")[0].type, "properties");
  assert.equal(rowEdit.remove(rowsOf(track([1, "properties"], [2, "formula", "blade"])), 0).length, 1);
});

test("KEY: only a defined material or note item opens the editor from its sheet", () => {
  const item = flags => ({ getFlag: (scope, key) => (scope === M ? flags[key] : undefined) });
  assert.equal(keyOfItem(item({ material: { materialId: "iron" } })), "material:iron");
  assert.equal(keyOfItem(item({ note: { noteId: "page" } })), "note:page");
  assert.equal(keyOfItem(item({})), null);
});

test("WINDOW: edit a field, Save turns on, save writes a patch, the item keeps its old name until Push to copies", async () => {
  const { w, text, click, set, live, el } = await windowFor("material:iron");
  assert.match(text(), /Iron[\s\S]*From the module's packs/);
  assert.equal(live("save"), undefined, "nothing changed: Save is off");
  const saveBefore = el().querySelector('[data-action="save"]');
  await set('[data-field="basic"][data-name="name"]', "Cold Iron", "change");
  assert.ok(live("save"), "Save is on after an edit");
  assert.match(text(), /You have unsaved changes/);
  assert.equal(el().querySelector('[data-action="discard"]').getAttribute("aria-disabled"), null);
  assert.notEqual(el().querySelector('[data-part="actions"]'), null);
  assert.match(text(), /Cold Iron/, "the preview is live");
  void saveBefore;
  await click("save");
  assert.match(text(), /Saved Cold Iron\. Use Push to copies/);
  assert.equal(api().definitions.material.get("iron").name, "Cold Iron");
  assert.match(text(), /From the packs, with edits made here\. Edited here: name\./);
  await click("revert");
  assert.match(text(), /Take back every edit/);
  await click("confirm-yes");
  assert.equal(api().definitions.material.get("iron").name, "Iron");
  void w;
});

test("WINDOW: typing in a box refreshes only the preview and the action row; the box and the Save button stay the very same elements", async () => {
  const { app, el, set, live } = await windowFor("material:iron");
  const box = el().querySelector('[data-field="basic"][data-name="description"]');
  const list = el().querySelector(".pfp-editor-list");
  const detail = el().querySelector(".pfp-editor-detail .pfp-editor-scroll");
  await set('[data-field="basic"][data-name="description"]', "A dull grey metal.");
  assert.equal(el().querySelector('[data-field="basic"][data-name="description"]'), box, "the box being typed in is untouched");
  assert.equal(el().querySelector(".pfp-editor-list"), list);
  assert.equal(el().querySelector(".pfp-editor-detail .pfp-editor-scroll"), detail);
  assert.match(el().querySelector('[data-part="preview"]').textContent, /A dull grey metal\./);
  assert.ok(live("save"));
  void app;
});

test("WINDOW: a problem keeps Save off and says why, right beside it", async () => {
  const { text, set, live, el } = await windowFor("material:iron");
  await set('[data-field="basic"][data-name="name"]', "  ");
  assert.equal(live("save"), undefined);
  assert.match(el().querySelector('[data-part="actions"]').textContent, /Give it a name\./);
  await set('[data-field="basic"][data-name="name"]', "Iron Two");
  assert.ok(live("save"));
  assert.doesNotMatch(el().querySelector('[data-part="actions"]').textContent, /Give it a name/);
  void text;
});

test("WINDOW: add damage to the weapon class, see it in the preview, switch to a tier table, save", async () => {
  const { text, click, set, el } = await windowFor("material:iron");
  await click("effect-class", '[data-cls="weapon"]');
  await click("add-block", '[data-cls="weapon"][data-type="damage"]');
  assert.equal(el().querySelector('[data-action="add-block"][data-type="damage"]').getAttribute("aria-disabled"), "true", "one Add damage per class");
  await set('[data-field="block"][data-cls="weapon"][data-name="dice"]', "2d6");
  await set('[data-field="block"][data-cls="weapon"][data-name="damageType"]', "cold");
  assert.match(el().querySelector('[data-part="preview"]').textContent, /Iron adds \+2d6 cold damage/);
  await click("tier-mode", '[data-name="dice"]');
  assert.equal(el().querySelectorAll('[data-field="cell"]').length, 5);
  await set('[data-field="cell"][data-tier="1"]', "3d6");
  await click("save");
  assert.match(text(), /Saved Iron/);
  assert.deepEqual(api().definitions.material.get("iron").classEffects.weapon.bonusDamage, { dice: "3d6", type: "cold" }, "iron is tier 1: its own row counts");
});

test("WINDOW: saving a change players may know asks first, and No keeps things as they are", async () => {
  const { w, text, click, set, el } = await windowFor("material:iron");
  await w.ann.setFlag(M, "compendium", { v: 1, classes: { weapon: { iron: { materialId: "iron", materialName: "Iron", tier: 1, effects: {}, at: 1 } } } });
  await click("effect-class", '[data-cls="weapon"]');
  await click("add-block", '[data-cls="weapon"][data-type="damage"]');
  await click("save");
  assert.match(text(), /Ann already knows something this changes[\s\S]*Save anyway\?/);
  await click("confirm-no");
  assert.equal(api().definitions.material.get("iron").classEffects, undefined);
  assert.ok(el().querySelector('[data-action="save"]'), "the draft is still there");
  await click("save");
  await click("confirm-yes");
  assert.ok(api().definitions.material.get("iron").classEffects.weapon.bonusDamage);
  void set;
});

test("WINDOW: make a material, then a note; both get items; the list and the editor follow", async () => {
  const { text, click, set, el } = await windowFor();
  await click("new-material");
  assert.equal(el().querySelector('[data-action="do-create"]').getAttribute("aria-disabled"), "true");
  assert.match(text(), /Give it a name first\./);
  await set('[data-field="create"][data-name="name"]', "Gate Fang");
  await set('[data-field="create"][data-name="tier"]', "2");
  await click("do-create");
  assert.match(text(), /Made Gate Fang and an item for it/);
  assert.equal(api().definitions.material.get("gate-fang").tier, 2);
  assert.match(text(), /Made in this world's editor/);
  assert.ok(el().querySelector('[data-action="delete"]'), "something made here can be deleted");
  assert.equal(el().querySelector('[data-action="make-item"]'), null, "it already has an item");
  await click("new-note");
  await set('[data-field="create"][data-name="name"]', "Gate Plan");
  await set('[data-field="create"][data-name="recipeId"]', [...api().definitions.recipe.keys()][0]);
  await set('[data-field="create"][data-name="preset"]', "plan");
  await click("do-create");
  assert.ok(api().definitions.note.get("gate-plan"));
});

test("WINDOW: Push to copies asks first and reports the count; Delete asks first and, when in use, says where and offers Retire", async () => {
  const { w, text, click, el } = await windowFor();
  await click("new-material");
  await as(w.gm, async () => { for (const [name, value] of [["name", "Gate Silk"], ["tier", "1"]]) { const input = el().querySelector(`[data-field="create"][data-name="${name}"]`); input.value = value; input.dispatchEvent(new window.Event("change", { bubbles: true })); await wait(25); } });
  await click("do-create");
  await api().giveMaterial(w.ann, "gate-silk", 1);
  await click("push-copies");
  assert.match(text(), /onto every copy/);
  await click("confirm-yes");
  assert.match(text(), /Updated 2 copies\./);
  await click("delete");
  assert.match(text(), /This cannot be undone/);
  await click("confirm-yes");
  assert.match(text(), /still in use \(held as 1 in Ann\)[\s\S]*Retire it instead/);
  assert.ok(api().definitions.material.has("gate-silk"));
  await click("retire");
  assert.match(text(), /Retired\./);
  assert.equal(api().definitions.material.get("gate-silk").retired, true);
});

test("WINDOW: leftovers are listed and can be removed, including an orphaned track", async () => {
  const { w, text, click } = await windowFor();
  await globalThis.game.settings.set(M, "discoveryTracks", { "material:g20-orphan": track([3, "properties"]) });
  await as(w.gm, () => click("toggle-chip", '[data-chip="show:retired"]'));
  await click("toggle-chip", '[data-chip="show:retired"]');
  assert.match(text(), /Leftovers \(1\)/);
  assert.match(text(), /material:g20-orphan is a research track for an item that no longer exists/);
  await click("clear-leftover", '[data-key="material:g20-orphan"]');
  assert.match(text(), /Removed material:g20-orphan\./);
  assert.doesNotMatch(text(), /Leftovers/);
});

test("WINDOW: a player cannot open it, and Tab, Enter and Space stay inside the window (never preventDefault)", async () => {
  const { w, app, el } = await windowFor();
  await assert.rejects(Promise.resolve().then(() => as(w.annUser, () => api().discovery.openEditor())), /GM only/);
  const outer = [];
  document.addEventListener("keydown", e => outer.push(e.key));
  const target = el().querySelector(".pfp-editor");
  for (const key of ["Tab", "Enter", " ", "Escape"]) {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${key} keeps its default`);
  }
  assert.deepEqual(outer, ["Escape"], "only Escape reaches Foundry");
  await as(w.gm, () => app.close());
});

test("WINDOW: a new note starts on 'Choose a formula', Create stays off until one is chosen, and the reason says so", async () => {
  const { click, set, text, el } = await windowFor();
  await click("new-note");
  const select = el().querySelector('[data-field="create"][data-name="recipeId"]');
  assert.equal(select.value, "", "no formula is pre-selected");
  assert.equal(select.selectedOptions[0].textContent, "Choose a formula");
  assert.equal(select.selectedOptions[0].disabled, true);
  await set('[data-field="create"][data-name="name"]', "A note");
  await set('[data-field="create"][data-name="preset"]', "plan");
  assert.equal(el().querySelector('[data-action="do-create"]').getAttribute("aria-disabled"), "true");
  assert.match(text(), /Pick a formula first\./);
  await set('[data-field="create"][data-name="recipeId"]', [...api().definitions.recipe.keys()][0]);
  assert.doesNotMatch(text(), /Pick a formula first\./);
  assert.equal(el().querySelector('[data-action="do-create"]').getAttribute("aria-disabled"), null);
  await click("new-material");
  assert.equal(el().querySelector('[data-field="create"][data-name="tier"]').selectedOptions[0].textContent, "Choose a tier");
  assert.match(text(), /Choose a tier first\./);
});

test("WINDOW: the stage buttons switch what the preview shows; effects only appear on the craft stage", async () => {
  const { click, el } = await windowFor("material:spider-fang");
  const preview = () => el().querySelector('[data-part="preview"]').textContent.replace(/\s+/g, " ");
  assert.match(preview(), /Spider Fang adds \+1d4 poison damage/);
  assert.ok(el().querySelector('[data-field="preview-class"]'));
  await click("preview-stage", '[data-stage="picked"]');
  assert.equal(el().querySelector('[data-stage="picked"]').getAttribute("aria-pressed"), "true");
  assert.doesNotMatch(preview(), /poison damage/);
  assert.match(preview(), /No effects yet: a player learns what it does by crafting with it\./);
  assert.equal(el().querySelector('[data-field="preview-class"]'), null, "the class picker belongs to the craft stage");
  await click("preview-stage", '[data-stage="studied"]');
  assert.match(preview(), /No study: known on pickup\./);
  assert.doesNotMatch(preview(), /poison damage/);
  await click("preview-stage", '[data-stage="crafted"]');
  assert.match(preview(), /poison damage/);
});
