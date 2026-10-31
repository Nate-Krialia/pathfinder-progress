/** The Discovery tracks window (Stage 11c, GM only): the pure model and a click-through on the strict ApplicationV2 fake. */
import test from "node:test";
import assert from "node:assert/strict";
import { M, as, getApi, getUsers, world } from "./fake-world.js";
import { E, draftOf, edit, editorModel, filterItems, listItems, problemsOf, renderEditor, trackOfDraft } from "../scripts/discovery/editor-model.js";
import { build } from "../scripts/discovery/editor-app.js";
import { keyOfItem } from "../scripts/discovery/entry.js";
import { installFakeApplication } from "./fake-application.js";

const api = () => getApi();
const wait = ms => new Promise(r => setTimeout(r, ms));
const track = (...m) => ({ milestones: m.map(([steps, type, recipeId]) => ({ steps, grants: type === "formula" ? { type, ...(recipeId ? { recipeId } : {}) } : { type } })) });

const registry = () => ({
  material: new Map([["ore", { id: "ore", name: "Ore", tier: 1, value: 5, tag: "metal", research: track([4, "properties"]) }], ["plain", { id: "plain", name: "Plain", tier: 1, value: 5 }]]),
  note: new Map([["page", { id: "page", name: "Page", recipeId: "blade", research: track([3, "formula"]) }]]),
  recipe: new Map([["blade", { id: "blade", name: "Blade" }], ["blade2", { id: "blade2", name: "Blade II", version: 2 }]]),
  tag: new Map([["metal", { id: "metal", name: "Metal", theme: "x" }]])
});

test("MODEL: the items that can carry a track, with where each track comes from", () => {
  const items = listItems(registry(), { "material:plain": track([2, "properties"]) });
  assert.deepEqual(items.map(i => [i.key, i.hasTrack, i.edited]), [["material:ore", true, false], ["material:plain", true, true], ["note:page", true, false], ["recipe:blade2", false, false]], "higher versions only; the first version cannot be a study");
});

test("DRAFT: rows are edited as typed; problems are plain sentences and block saving", () => {
  const reg = registry();
  let draft = edit.addDefault("material", "blade");
  assert.deepEqual(trackOfDraft(draft), track([4, "properties"], [8, "formula", "blade"]));
  assert.deepEqual(problemsOf(draft, "material", "ore", reg), []);
  draft = edit.setSteps(draft, 1, "4");
  assert.match(problemsOf(draft, "material", "ore", reg)[0].text, /must be more than the milestone before it \(4\)/);
  draft = edit.setSteps(draft, 1, "abc");
  assert.deepEqual(problemsOf(draft, "material", "ore", reg), [{ index: 1, text: "Steps must be a whole number of at least 1." }]);
  draft = edit.setSteps(draft, 1, "8");
  draft = edit.setGrants(draft, 1, "formula", "");
  assert.deepEqual(problemsOf(draft, "material", "ore", reg), [{ index: 1, text: "Pick a formula that exists." }]);
  draft = edit.setRecipe(draft, 1, "ghost");
  assert.equal(problemsOf(draft, "material", "ore", reg)[0].text, "Pick a formula that exists.");
  assert.deepEqual(problemsOf(edit.addDefault("note", "blade"), "note", "page", reg), [], "a note's default has no properties milestone");
  assert.deepEqual(problemsOf([{ steps: "4", type: "properties", recipeId: "" }], "note", "page", reg).map(p => p.text), ["Only a material has a properties milestone."]);
  assert.equal(edit.add([], "material")[0].type, "properties", "the first row of a material is its properties");
  assert.equal(edit.add(edit.add([], "material"), "material")[1].type, "formula");
  assert.equal(edit.remove(draftOf(track([1, "properties"], [2, "formula", "blade"])), 0).length, 1);
});

test("MODEL: Save is off with no change or with a problem; the detail says which track is in force", () => {
  const reg = registry();
  const base = { registry: reg, overlay: {}, selectedKey: "material:ore" };
  const clean = editorModel(base).detail;
  assert.deepEqual([clean.canSave, clean.canRevert, clean.canUseDefinition, clean.source], [false, false, false, E.fromDefinition]);
  const dirty = editorModel({ ...base, draft: edit.setSteps(draftOf(reg.material.get("ore").research), 0, "5"), dirty: true }).detail;
  assert.deepEqual([dirty.canSave, dirty.canRevert], [true, true]);
  assert.equal(editorModel({ ...base, draft: edit.setSteps(draftOf(reg.material.get("ore").research), 0, "0"), dirty: true }).detail.canSave, false);
  assert.equal(editorModel({ ...base, overlay: { "material:ore": track([2, "properties"]) } }).detail.canUseDefinition, true);
  assert.equal(editorModel({ ...base, selectedKey: "material:plain" }).detail.source, E.noTrack);
  assert.equal(editorModel({ ...base, selectedKey: null }).detail.text, E.pick);
});

test("FILTERS: the search box and the chips narrow the list; groups count what they show; a group can be folded shut", () => {
  const reg = registry();
  const items = listItems(reg, {});
  assert.deepEqual(filterItems(items, { search: "pla" }).map(i => i.key), ["material:plain"]);
  assert.deepEqual(filterItems(items, { search: "metal" }).map(i => i.key), ["material:ore"], "the search also reads the sub line (the tag)");
  assert.deepEqual(filterItems(items, { kinds: ["note", "recipe"] }).map(i => i.key), ["note:page", "recipe:blade2"]);
  assert.deepEqual(filterItems(items, { track: "has" }).map(i => i.key), ["material:ore", "note:page"]);
  assert.deepEqual(filterItems(items, { track: "none" }).map(i => i.key), ["material:plain", "recipe:blade2"]);
  assert.deepEqual(filterItems(items, { kinds: ["material"], track: "none", search: "p" }).map(i => i.key), ["material:plain"], "they combine");
  const model = editorModel({ registry: reg, overlay: {}, filters: { track: "has" }, collapsed: ["note"] });
  assert.deepEqual(model.list.groups.map(g => [g.kind, g.count, g.collapsed, g.items.length]), [["material", "1 of 2", false, 1], ["note", "1", true, 1], ["recipe", "0 of 1", false, 0]]);
  assert.equal(editorModel({ registry: reg, filters: { search: "zzz" } }).list.empty, E.noMatches);
  const html = renderEditor(model);
  assert.match(html, /aria-expanded="false"[^>]*>▸ Notes \(1\)/, "a folded group shows its heading and count and no items");
  assert.doesNotMatch(html, /data-key="note:page"/);
  assert.match(html, /data-action="toggle-chip"[^>]*data-chip="track:has"[^>]*aria-pressed="true"/);
});

test("LAYOUT (markup): the list is the LEFT pane and the editor the RIGHT one; Save and Discard are outside the scrolling part; the intro sits in its own header", () => {
  const html = renderEditor(editorModel({ registry: registry(), overlay: {}, selectedKey: "material:ore" }));
  assert.ok(html.indexOf("pfp-editor-list") < html.indexOf("pfp-editor-detail"), "list first, editor second, inside one .pfp-body grid");
  assert.match(html, /<div class="pfp-body pfp-editor-body">/);
  assert.match(html, /<header class="pfp-editor-head"><p class="pfp-note">A track is a list of milestones/);
  const detail = html.slice(html.indexOf("pfp-editor-detail"));
  const scrollEnd = detail.indexOf("</div>", detail.indexOf("pfp-editor-scroll"));
  assert.ok(detail.indexOf('data-action="save-track"') > detail.indexOf("pfp-editor-actions") && detail.indexOf("pfp-editor-actions") > scrollEnd - 400, "the action row follows the scroll area");
  assert.match(html, /data-layout="wide"/);
  assert.match(renderEditor(editorModel({ registry: registry(), layout: "narrow" })), /data-layout="narrow"/);
});

test("MARKUP: every control is a real button or a labelled field; an off button keeps aria-disabled", () => {
  const html = renderEditor(editorModel({ registry: registry(), overlay: {}, selectedKey: "material:ore" }));
  assert.match(html, /<button type="button"[^>]*data-action="pick-item"[^>]*data-key="material:ore"[^>]*aria-pressed="true"/);
  assert.match(html, /<input type="number"[^>]*aria-label="Steps 1"/);
  assert.match(html, /<input type="search"[^>]*aria-label="Search items"/);
  assert.match(html, /<button[^>]*data-action="save-track"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(html, /<script|onclick=/);
});

test("KEY: only a defined material or note item opens the window from its sheet", () => {
  const item = flags => ({ getFlag: (scope, key) => (scope === M ? flags[key] : undefined) });
  assert.equal(keyOfItem(item({ material: { materialId: "iron" } })), "material:iron");
  assert.equal(keyOfItem(item({ note: { noteId: "page" } })), "note:page");
  assert.equal(keyOfItem(item({})), null);
});

test("WINDOW: pick, add the default track, break it, fix it, save; a player cannot; the overlay is what is saved", async () => {
  const w = await world({ perClientDefinitions: true, downtime: 0, iron: 0, fang: 0 });
  installFakeApplication();
  const reg = api().definitions;
  reg.material.set("g7-x", { kind: "material", id: "g7-x", name: "Gate Ore X", tier: 1, value: 5, effects: { basePower: "T1" } });
  const app = new (build())(api(), "material:g7-x");
  await as(w.gm, () => app.render({ force: true }));
  const el = () => app.element;
  const text = () => el().textContent.replace(/\s+/g, " ");
  const click = async (action, where = "") => { const t = [...el().querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true"); assert.ok(t, `${action} is live`); await as(w.gm, async () => { t.click(); await wait(15); }); };
  const type = async (field, index, value) => { const input = el().querySelector(`[data-field="${field}"][data-index="${index}"]`); input.value = value; await as(w.gm, async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); await wait(15); }); };
  assert.match(text(), /Gate Ore X[\s\S]*No track yet/);
  // the list: search and chips narrow it, and the editor keeps its item
  const search = el().querySelector('[data-field="search"]');
  search.value = "ore x"; search.setSelectionRange?.(5, 5);
  await as(w.gm, async () => { search.dispatchEvent(new window.Event("input", { bubbles: true })); await wait(15); });
  assert.equal(document.activeElement?.dataset?.field, "search", "focus stays in the search box while typing");
  assert.match(text(), /Materials \([\d]+ of \d+\)/);
  assert.equal(el().querySelectorAll('[data-action="pick-item"]').length, 1);
  await click("toggle-chip", '[data-chip="kind:note"]');
  assert.equal(el().querySelectorAll('[data-action="pick-item"]').length, 0, "notes only + the search: nothing matches");
  assert.match(text(), /Nothing matches/);
  await click("toggle-chip", '[data-chip="kind:note"]');
  await click("toggle-group", '[data-kind="material"]');
  assert.equal(el().querySelectorAll('[data-action="pick-item"]').length, 0, "folded");
  await click("toggle-group", '[data-kind="material"]');
  assert.match(text(), /Gate Ore X[\s\S]*No track yet/, "the editor kept the item");
  await click("add-default");
  assert.equal(el().querySelectorAll(".pfp-milestone").length, 2);
  assert.equal(el().querySelector('[data-action="save-track"]').getAttribute("aria-disabled"), "true", "the default's formula has not been picked: nothing to save yet");
  assert.match(text(), /Pick a formula that exists\./);
  await type("recipe", 1, "dagger-spider-fang");
  await type("steps", 1, "4");
  assert.match(text(), /must be more than the milestone before it \(4\)/);
  assert.equal(el().querySelector('[data-action="save-track"]').getAttribute("aria-disabled"), "true");
  await type("steps", 1, "10");
  assert.equal(document.activeElement?.dataset?.field, "steps", "focus stays on the field that was edited");
  await click("save-track");
  assert.match(text(), /Saved the track for Gate Ore X\./);
  assert.deepEqual(api().discovery.tracks.overlay()["material:g7-x"], track([4, "properties"], [10, "formula", "dagger-spider-fang"]));
  assert.match(text(), /This track was set in this window and overrides the definition/);
  await click("use-definition");
  assert.deepEqual(api().discovery.tracks.overlay(), {});
  assert.match(text(), /now uses the definition's track/);
  await as(w.gm, () => app.close());
  await assert.rejects(Promise.resolve().then(() => as(w.annUser, () => api().discovery.openEditor())), /GM only/);
  void getUsers;
});

test("WINDOW: Tab, Enter and Space stay inside the window (never preventDefault), like the Hub", async () => {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  installFakeApplication();
  const app = new (build())(api(), null);
  await as(w.gm, () => app.render({ force: true }));
  const outer = [];
  document.addEventListener("keydown", e => outer.push(e.key));
  const target = app.element.querySelector(".pfp-editor");
  for (const key of ["Tab", "Enter", " ", "Escape"]) {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${key} keeps its default`);
  }
  assert.deepEqual(outer, ["Escape"], "only Escape reaches Foundry");
  await as(w.gm, () => app.close());
});
