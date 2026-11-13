# 23 Tags gate, the GM window and its entry points (cut down; real Foundry)

Run in a real world on PF2e 8.6.1 with a **GM window** and, for Step 6 only, an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]**. **Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".** Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. **Every FAIL line prints each value it compared**, and the steps that read data Foundry could change print the saved value next to the expected one.

This is the **cut-down** gate for the Item tags window (`docs/22-tags-slice1.md`, "GM interface"): the two entry points, one round of tagging through the window, and the Player's view. The tag effect builder, the caps panel and the narrow layout are not covered here.

`tests/gate23.test.js` plays every step in a fake Foundry (a strict ApplicationV2 stand-in over jsdom, a fake item sheet that fires the header-controls hook, a fake scene-controls button). **What the fake cannot prove, and only this gate can, in real Foundry:** that the scene-controls button the module registers is really drawn and opens the window; that PF2e's item sheet **is an ApplicationV2 and shows the module's header button** (the risk: if it is not, `getHeaderControlsApplicationV2` never fires and no button appears, with no error); that the window works with Foundry's own styles and events when it is driven through its real controls; and that what the window saves reads back through the API.

**How the gate drives the window:** the blocks find the window's own elements by their `data-action` and `data-field` ids **inside the window's root element** (Foundry has `[data-action]` buttons of its own that can match first), set a field and send the same `change` event a person's edit sends, and click with the element's own `click()`. Each step **closes the windows it opened before it ends**, so nothing is left covering a button for the next step.

**What SETUP plants** (all throwaway "Gate G23" things): the character **Gate G23 Scout** (owned by Test, who is made to play it for Step 6) holding an ordinary item **Gate G23 Charm**, an in-memory material **Gate G23 Iron**, and the formula for the real recipe **Spider Fang Dagger** (`dagger-spider-fang`). Step 5 gives that real recipe's `fang` slot a tag requirement through the window, which is an editor patch of the recipe (revertable): **it touches a real recipe for the length of the gate**, and CLEANUP takes it back with `api.editor.revert`. SETUP refuses if that recipe has been edited already.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

**What to do and see:**
- Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.22.0**; if it is not, stop (the release may still be building).
- Run the block below in the GM window, then again in the Player window.
- You should see: `["<your GM name>", true, "0.22.0", true]` in the GM window and `["Test", false, "0.22.0", false]` in the Player window (the last value says this build has the GM helper `api.tags.refsOf`).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version, typeof game.modules.get("pathfinder-progress").api.tags?.refsOf === "function"]
```


## Step 2 [GM]: SETUP

**What to do and see:**
- Close any open windows of this module, and any item sheet.
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts the in-memory material and `globalThis.__g23` back).
- You should see: an object with `planted` (five lines) and a `published` revision. On a rerun it says `already: "set up"`.
- If it stops with `is not in the packs` or `has been edited already`, the real recipe the gate uses is missing or already carries edits: set `RECIPE` and `SLOT` at the top of the block to a saved recipe with an untouched slot, or take its edits back first.

```js
// [GM] SETUP: the character Gate G23 Scout (owned by Test) holding the ordinary item Gate G23 Charm, the in-memory material Gate G23 Iron, the formula for the real recipe Spider Fang Dagger. Says what it planted.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const RECIPE = "dagger-spider-fang", SLOT = "fang";
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (typeof api.tags?.refsOf !== "function") throw new Error("this world is not on a build with api.tags.refsOf: update the module and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway23") === true;
  if (!mine(game.actors.getName("Gate G23 Scout"))) throw new Error('"Gate G23 Scout" already exists and was not made by this check; rename or delete it first');
  const recipe = api.definitions.recipe.get(RECIPE), slot = recipe?.slots.find(s => s.name === SLOT);
  if (!recipe || !slot) throw new Error(`The recipe "${RECIPE}" with a slot "${SLOT}" is not in the packs of this world: set RECIPE and SLOT at the top of this block to a saved recipe`);
  const editorEntry = api.editor.entry(`recipe:${RECIPE}`);
  if (!editorEntry || (editorEntry.editedFields ?? []).length || slot.needs) throw new Error(`The recipe "${RECIPE}" has been edited already or its "${SLOT}" slot already has a tag requirement (${JSON.stringify({ editedFields: editorEntry?.editedFields ?? null, needs: slot.needs ?? null })}): take that back first, this gate edits that slot and reverts it`);
  if (api.definitions.tag.size && [...api.definitions.tag.values()].some(t => t.name === "Gate G23 Bite")) throw new Error('a tag named "Gate G23 Bite" exists already: run CLEANUP (the last step) first');
  const ensureMaterial = () => { if (!api.definitions.material.has("g23-iron")) api.definitions.material.set("g23-iron", { kind: "material", id: "g23-iron", name: "Gate G23 Iron", tier: 1, effects: { basePower: "T1" } }); };
  ensureMaterial();
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, rows, RECIPE, SLOT,
      scout: () => game.actors.get(ids.scout),
      charm: () => game.actors.get(ids.scout)?.items.find(i => i.name === "Gate G23 Charm"),
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      app: () => foundry.applications.instances.get("pathfinder-progress-tagger"),
      within: selector => foundry.applications.instances.get("pathfinder-progress-tagger")?.element?.querySelector(selector) ?? null,
      // set a field of the window the way a person's edit does (the value, then a bubbling change event), and click one of its buttons; both are looked for INSIDE the window's own element
      set: (selector, value) => { const el = g.within(selector); if (!el) throw new Error(`the Item tags window has no ${selector}`); if (el.type === "checkbox") el.checked = Boolean(value); else el.value = value; el.dispatchEvent(new (el.ownerDocument.defaultView.Event)("change", { bubbles: true })); },
      click: selector => { const el = g.within(selector); if (!el) throw new Error(`the Item tags window has no ${selector}`); el.click(); },
      windowText: () => (g.app()?.element?.textContent ?? "").replace(/\s+/g, " ").trim(),
      closeAll: async () => { await g.app()?.close(); await g.charm()?.sheet?.close(); },
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g23 = g;
    return g;
  };
  const old = game.actors.getName("Gate G23 Scout");
  if (old) {
    if (!test.getFlag(M, "gateSetup23")) throw new Error("part of the gate is missing: run CLEANUP (the last step), then SETUP again");
    build({ scout: old.id });
    return { already: "set up", rebuilt: "globalThis.__g23 and the in-memory material", published: await api.publishDefinitions() };
  }
  const published = await api.publishDefinitions();
  const flags = { [M]: { gateThrowaway23: true } };
  const scout = await Actor.create({ name: "Gate G23 Scout", type: "character", ownership: { default: 0, [test.id]: 3 }, flags });
  await scout.createEmbeddedDocuments("Item", [{ name: "Gate G23 Charm", type: "equipment", system: { quantity: 1 } }]);
  await api.grantFormula(scout, RECIPE);
  await test.setFlag(M, "gateOriginalCharacter23", test.character?.id ?? "none");
  await test.update({ character: scout.id });
  await test.setFlag(M, "gateSetup23", { at: Date.now(), recipe: RECIPE, slot: SLOT });
  build({ scout: scout.id });
  return {
    planted: [
      'the character "Gate G23 Scout" (owned by Test), holding the ordinary item "Gate G23 Charm" (no source: it is not from a compendium)',
      "the in-memory material Gate G23 Iron",
      `the formula for the real recipe ${recipe.name} (${RECIPE}); Step 5 edits its "${SLOT}" slot and CLEANUP reverts it`,
      "Test's character is now Gate G23 Scout",
      "nothing is tagged yet"
    ],
    published
  };
})();
```


## Step 3 [GM]: open the Item tags window from the scene controls

**What to do and see:**
- Make sure no window of this module is open.
- Run the block below in the GM window. It finds the module's button in the scene controls, clicks it, and looks at the window that opens.
- You should see: `PASS:` lines and `ALL PASS`. The block prints the scene-controls structure it found, the window's title, its tabs and the text of its list. If the button is not found, the FAIL line prints every group of the controls and the tools in each.
- The block closes the window before it ends.

```js
// [GM] The scene-controls button opens the Item tags window: it is drawn, has the module's own title, its tabs and the item list.
await (async () => {
  const g = globalThis.__g23 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  await g.closeAll();
  const groups = Object.fromEntries(Object.entries(ui.controls?.controls ?? {}).map(([name, group]) => [name, Object.keys(group?.tools ?? {})]));
  const button = document.querySelector('[data-tool="pfpItemTags"]');
  g.check("the module's scene-controls button is drawn (the scene controls found are printed)", Boolean(button), JSON.stringify({ selector: '[data-tool="pfpItemTags"]', found: Boolean(button), groups }));
  if (!button) return g.done();
  g.check("it is registered in one of the groups, as a button", Object.values(groups).some(tools => tools.includes("pfpItemTags")), JSON.stringify({ groups }));
  button.click();
  const app = await g.until(() => { const a = g.app(); return a?.rendered && a.element ? a : false; });
  g.check("the window opened and is rendered", Boolean(app), JSON.stringify({ openInstances: [...foundry.applications.instances.keys()].filter(k => /pathfinder-progress/.test(k)) }));
  if (!app) return g.done();
  const box = app.element.getBoundingClientRect();
  const title = (app.element.querySelector(".window-title")?.textContent ?? app.title ?? "").trim();
  const tabs = [...app.element.querySelectorAll('[data-action="tab"]')].map(b => `${b.dataset.tab}: ${b.textContent.trim()}`);
  const list = (app.element.querySelector('[data-part="entries"]')?.textContent ?? "").replace(/\s+/g, " ").trim();
  g.check("the window is drawn: it has a size on the screen", box.width > 0 && box.height > 0, JSON.stringify({ width: box.width, height: box.height }));
  g.check("it has the module's own title", /Item tags/.test(title), JSON.stringify({ title }));
  g.check("it has its three tabs", tabs.length === 3 && tabs.some(t => /^items:/.test(t)) && tabs.some(t => /^slots:/.test(t)) && tabs.some(t => /^tags:/.test(t)), JSON.stringify({ tabs }));
  g.check("it shows the item list (the text of the list is printed)", list.length > 0, JSON.stringify({ list }));
  await g.closeAll();
  g.check("the window is closed again", !g.app(), JSON.stringify({ open: Boolean(g.app()) }));
  return g.done();
})();
```


## Step 4 [GM]: the header button on a real PF2e item sheet

**What to do and see:**
- Make sure no window of this module is open.
- Run the block below in the GM window. It opens the real sheet of **Gate G23 Charm**, looks for the module's header button, clicks it and checks the Item tags window opens aimed at that item.
- You should see: `PASS:` lines and `ALL PASS`. If the button is missing, the FAIL line prints which sheet class opened, whether it is an ApplicationV2, the header controls and buttons it has, and the hooks Foundry has registered for header controls: that shows the cause (a sheet that is not ApplicationV2 never fires `getHeaderControlsApplicationV2`).
- The block closes the item sheet and the window before it ends.

```js
// [GM] The header button of the real item sheet: which sheet class, is it ApplicationV2, the controls found, the click, and the window aimed at the item.
await (async () => {
  const g = globalThis.__g23 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { api } = g;
  await g.closeAll();
  const item = g.charm();
  g.check("Gate G23 Charm is on the Scout (run SETUP if this fails)", Boolean(item), JSON.stringify({ items: g.scout()?.items.map(i => i.name) }));
  if (!item) return g.done();
  const sheet = item.sheet;
  await sheet.render({ force: true });
  await g.until(() => sheet.rendered && sheet.element);
  const isV2 = sheet instanceof foundry.applications.api.ApplicationV2;
  const controls = typeof sheet._getHeaderControls === "function" ? sheet._getHeaderControls().map(c => c.action ?? c.label ?? "?") : null;
  const v1Buttons = typeof sheet._getHeaderButtons === "function" ? sheet._getHeaderButtons().map(b => b.class ?? b.label ?? "?") : null;
  const hooks = Object.fromEntries(Object.entries(Hooks.events ?? {}).filter(([name]) => /HeaderControls|HeaderButtons/.test(name)).map(([name, list]) => [name, list.length]));
  const info = { sheetClass: sheet.constructor.name, isApplicationV2: isV2, headerControls: controls, headerButtonsV1: v1Buttons, headerHooksRegistered: hooks };
  const button = sheet.element?.querySelector('[data-action="pfp-item-tags"]') ?? null;
  g.check("the item sheet shows the module's header button (the cause is printed if not: sheet class, ApplicationV2 or not, the controls, the registered header hooks)", Boolean(button), JSON.stringify(info));
  if (!button) { await g.closeAll(); return g.done(); }
  g.check("the sheet is an ApplicationV2 (so getHeaderControlsApplicationV2 fires for it)", isV2, JSON.stringify(info));
  button.click();
  const app = await g.until(() => { const a = g.app(); return a?.rendered && a.element ? a : false; });
  g.check("clicking it opens the Item tags window", Boolean(app), JSON.stringify({ openInstances: [...foundry.applications.instances.keys()].filter(k => /pathfinder-progress/.test(k)) }));
  if (app) {
    const draft = app.ui?.draft ?? null;
    g.check("the window is aimed at that item: the item list tab, an ordinary item, its uuid and name (the draft is printed)", app.ui?.tab === "items" && draft?.source === "item" && draft?.uuid === item.uuid && draft?.name === item.name, JSON.stringify({ tab: app.ui?.tab, draft, itemUuid: item.uuid, itemName: item.name }));
    const warning = g.within('[data-part="ref-warning"]')?.textContent.replace(/\s+/g, " ").trim() ?? null;
    g.check("it warns that copies of an item with no source will not match (the Charm has no compendium source; the warning text is printed)", /Copies of this item will not match this tag/.test(warning ?? ""), JSON.stringify({ warning, refsOf: await api.tags.refsOf(item) }));
  }
  await g.closeAll();
  g.check("the window and the sheet are closed again", !g.app(), JSON.stringify({ windowOpen: Boolean(g.app()), sheetRendered: Boolean(sheet.rendered) }));
  return g.done();
})();
```


## Step 5 [GM]: tag a material and an ordinary item through the window, set a priority and a slot need, and read it all back

**What to do and see:**
- Make sure no window of this module is open.
- Run the block below in the GM window. It opens the Item tags window and, inside it, creates a tag **Gate G23 Bite**, gives it priority 7, tags the material **Gate G23 Iron**, tags the item **Gate G23 Charm** (by its uuid, which has dots in it), and gives the real recipe's `fang` slot a requirement for the tag.
- You should see: `PASS:` lines and `ALL PASS`. After each save the block waits for the write and prints the saved values: the ledger setting, the tag, the recipe's slot, and what `api.tags.refsOf` says about the Charm.
- The block closes the window before it ends.

```js
// [GM] Through the window: a tag, its priority, a tagged material, a tagged ordinary item, a slot need; every save is read back through the API and the saved settings are printed.
await (async () => {
  const g = globalThis.__g23 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api, RECIPE, SLOT } = g;
  await g.closeAll();
  const charm = g.charm();
  g.check("Gate G23 Charm is on the Scout (run SETUP if this fails)", Boolean(charm), JSON.stringify({ items: g.scout()?.items.map(i => i.name) }));
  if (!charm) return g.done();
  api.tags.open();
  const app = await g.until(() => { const a = g.app(); return a?.rendered && a.element ? a : false; });
  g.check("the Item tags window opened", Boolean(app), JSON.stringify({ openInstances: [...foundry.applications.instances.keys()].filter(k => /pathfinder-progress/.test(k)) }));
  if (!app) return g.done();
  const saved = () => JSON.stringify({ tagLedger: game.settings.get(M, "tagLedger"), editorDefinitions: Object.keys(game.settings.get(M, "editorDefinitions") ?? {}) });
  const tagOf = () => [...api.definitions.tag.values()].find(t => t.name === "Gate G23 Bite");
  try {
    // the Tags tab: a new tag, then its priority
    g.click('[data-action="tab"][data-tab="tags"]');
    await g.until(() => g.within('[data-field="new-tag-name"]'));
    g.set('[data-field="new-tag-name"]', "Gate G23 Bite");
    g.click('[data-action="create-tag"]');
    const tag = await g.until(tagOf);
    g.check("the tag exists after Create tag (the window's message is printed)", Boolean(tag), JSON.stringify({ tag: tag ?? null, message: g.windowText().slice(-160) }));
    if (!tag) return g.done();
    await g.until(() => g.within(`[data-field="priority"][data-tag="${tag.id}"]`));
    g.set(`[data-field="priority"][data-tag="${tag.id}"]`, "7");
    g.click(`[data-action="save-priority"][data-tag="${tag.id}"]`);
    const prio = await g.until(() => tagOf()?.priority === 7);
    g.check("the priority 7 is saved and read back (the tag and the saved editor keys are printed)", Boolean(prio), JSON.stringify({ tag: tagOf() ?? null, saved: saved() }));
    // the Items tab: a material
    g.click('[data-action="tab"][data-tab="items"]');
    await g.until(() => g.within('[data-field="material"]'));
    g.set('[data-field="material"]', "g23-iron");
    await g.until(() => g.within(`[data-field="tag"][data-tag="${tag.id}"]`));
    g.set(`[data-field="tag"][data-tag="${tag.id}"]`, true);
    g.click('[data-action="save-entry"]');
    const iron = await g.until(() => api.tags.ledger().items["g23-iron"]);
    g.check("the material Gate G23 Iron is tagged and read back through the API (the ledger entry, tagsOf and the saved setting are printed)", Boolean(iron) && api.tags.tagsOf("g23-iron").join() === tag.id, JSON.stringify({ entry: iron ?? null, tagsOf: api.tags.tagsOf("g23-iron"), saved: saved() }));
    // an ordinary item, by uuid (the uuid has dots in it)
    await g.until(() => g.within('[data-field="source"]'));
    g.set('[data-field="source"]', "item");
    await g.until(() => g.within('[data-field="uuid"]'));
    g.set('[data-field="uuid"]', charm.uuid);
    g.click('[data-action="lookup"]');
    await g.until(() => /Found Gate G23 Charm/.test(g.windowText()));
    await g.until(() => g.within(`[data-field="tag"][data-tag="${tag.id}"]`));
    g.set(`[data-field="tag"][data-tag="${tag.id}"]`, true);
    g.set('[data-field="tier"]', "2");
    g.click('[data-action="save-entry"]');
    const entry = await g.until(() => api.tags.ledger().items[charm.uuid]);
    const refs = await api.tags.refsOf(charm);
    g.check("the item Gate G23 Charm is tagged by its uuid and read back through refsOf (the ledger entry, refsOf and the saved setting, whose key has no dots, are printed)", Boolean(entry) && refs.matched === charm.uuid && refs.tags.join() === tag.id && refs.tier === 2, JSON.stringify({ entry: entry ?? null, refsOf: refs, saved: saved() }));
    g.check("the window said the copies of an item with no source will not match", /Copies of this item will not match this tag/.test(g.windowText()), JSON.stringify({ message: g.windowText().slice(-260) }));
    // the Recipe slots tab: a slot need on the real recipe
    g.click('[data-action="tab"][data-tab="slots"]');
    await g.until(() => g.within('[data-field="recipe"]'));
    g.set('[data-field="recipe"]', RECIPE);
    await g.until(() => g.within(`[data-field="slot-tag"][data-slot="${SLOT}"][data-tag="${tag.id}"]`));
    g.set(`[data-field="slot-tag"][data-slot="${SLOT}"][data-tag="${tag.id}"]`, true);
    g.click(`[data-action="save-slot"][data-slot="${SLOT}"]`);
    const need = await g.until(() => api.definitions.recipe.get(RECIPE)?.slots.find(s => s.name === SLOT)?.needs);
    const slot = api.definitions.recipe.get(RECIPE)?.slots.find(s => s.name === SLOT);
    g.check("the slot need is saved and read back: the fang slot needs the tag (the slot and the editor's entry are printed)", Boolean(need) && need.all?.join() === tag.id, JSON.stringify({ slot: slot ?? null, entry: api.editor.entry(`recipe:${RECIPE}`)?.editedFields ?? null, message: g.windowText().slice(-160) }));
    const after = await api.tags.refsOf(charm);
    g.check("the Charm now fits the slot, read back through refsOf", after.fitsBySlot[`${RECIPE}/${SLOT}`] === RECIPE, JSON.stringify({ refsOf: after }));
  } finally {
    await g.closeAll();
  }
  g.check("the window is closed again", !g.app(), JSON.stringify({ open: Boolean(g.app()) }));
  return g.done();
})();
```


## Step 6 [Player]: the Player still sees names only

**What to do and see:**
- In the **Player** window, open **Downtime** for **Gate G23 Scout** and choose the formula **Spider Fang Dagger** (the runner does this).
- Look at the **Fang** slot: it lists the item by name.
- Run the block below in the Player window.
- You should see: `PASS:` lines and `ALL PASS`: the slot lists **Gate G23 Charm** by the name the GM gave it, and nothing in the slot, the player's copy of the recipe, the player's copy of the tag or the page names the tag, a priority, a tier or a price.

```js
// [Player] The Fang slot lists the Charm by name; the player's copies of the recipe slot and of the tag carry no tag, priority, tier or price.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api, rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.user.character, saved = game.user.getFlag(M, "gateSetup23");
  if (game.user.isGM || hero?.name !== "Gate G23 Scout" || !saved) throw new Error('Player window as the user "Test" only, after the GM ran SETUP and Step 5');
  await api.definitions.refresh({ force: true });
  const recipe = api.definitions.recipe.get(saved.recipe), slot = recipe?.slots.find(s => s.name === saved.slot);
  const charm = hero.items.find(i => i.name === "Gate G23 Charm");
  const options = [...document.querySelectorAll(`[data-action="pick-material"][data-slot="${saved.slot}"]`)];
  const texts = options.map(b => b.textContent.replace(/\s+/g, " ").trim());
  const page = (document.querySelector(".pfp-hub")?.textContent ?? "").replace(/\s+/g, " ");
  const tagCopy = [...api.definitions.tag.values()].find(t => t.name === "Gate G23 Bite");
  const all = new RegExp("Gate G23 Bite|gate-g23-bite|priority|\\btier\\b|\\bgp\\b|price|worth", "i");
  check("the slot lists the Charm by name: one option for the item, by the name the GM gave it", options.length === 1 && options[0].dataset.material === charm?.uuid && /Gate G23 Charm/.test(texts[0] ?? ""), JSON.stringify({ texts, ids: options.map(b => b.dataset.material), charmUuid: charm?.uuid ?? null }));
  check("the option shows no tag, priority, tier or price", !all.test(texts.join(" ")), JSON.stringify({ texts }));
  check("nowhere on the window is the tag's name or a priority", !/Gate G23 Bite|gate-g23-bite/.test(page), JSON.stringify({ page: page.slice(0, 300) }));
  check("the player's copy of the recipe slot says which items fit (id and name only) and carries no tag, need or kind", Boolean(slot) && Array.isArray(slot.fits) && slot.fits.length === 1 && Object.keys(slot.fits[0]).sort().join() === "id,name" && !("needs" in slot) && !("kind" in slot) && !/gate-g23-bite/.test(JSON.stringify(slot)), JSON.stringify({ slot: slot ?? null }));
  check("the player's copy of the tag, if it has one, carries no priority and no effects", !tagCopy || (!("priority" in tagCopy) && !("effectBlocks" in tagCopy)), JSON.stringify({ tagCopy: tagCopy ?? null }));
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 7 [GM]: CLEANUP (always run this, even if a step failed)

**What to do and see:**
- Nothing to click.
- Run the block below. It closes the module's windows and the item sheet, takes back what the gate changed (the recipe slot's tag requirement, the tags it set) and deletes what it made (the Scout and its items, the tag, the in-memory material), and gives Test's character back. Safe to run twice, and safe after a reload.
- You should see: `problems: []`, `actorsLeft: 0`, `ledgerLeft: 0`, `tagLeft: false`, `recipeEdited: false`, `slotNeeds: null`, `flagLeft: false`, `windowOpen: false` and an empty `audit`.

```js
// [GM] CLEANUP: closes the windows, reverts the recipe patch, removes the tag and the ledger entries, deletes the Scout, gives Test's character back. Safe to run twice, and safe after a reload (it does not need the globals).
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const saved = user?.getFlag(M, "gateSetup23");
  const RECIPE = saved?.recipe ?? "dagger-spider-fang", SLOT = saved?.slot ?? "fang";
  const scout = game.actors.getName("Gate G23 Scout");
  const ours = scout?.getFlag(M, "gateThrowaway23") === true ? scout : null;
  const tagOf = () => [...api.definitions.tag.values()].find(t => t.name === "Gate G23 Bite");
  await attempt("the module's windows", async () => { for (const [id, app] of foundry.applications.instances) if (/^pathfinder-progress/.test(id)) await app.close(); });
  await attempt("the item sheet", async () => { for (const item of ours?.items ?? []) await item.sheet?.close?.(); });
  const charmUuid = ours?.items.find(i => i.name === "Gate G23 Charm")?.uuid ?? null;
  await attempt("the recipe slot's tag requirement", async () => {
    const entry = api.editor.entry(`recipe:${RECIPE}`);
    const needs = api.definitions.recipe.get(RECIPE)?.slots.find(s => s.name === SLOT)?.needs;
    const tag = tagOf();
    if (entry && (entry.editedFields ?? []).join() === "slots" && needs && tag && needs.all?.join() === tag.id) await api.editor.revert(`recipe:${RECIPE}`);
    else if (needs || (entry?.editedFields ?? []).length) problems.push(`the recipe ${RECIPE} was left alone: it carries edits this gate did not make (${JSON.stringify({ editedFields: entry?.editedFields ?? null, needs: needs ?? null })})`);
  });
  await attempt("the ledger entries", async () => {
    const items = api.tags.ledger().items;
    for (const key of Object.keys(items).filter(k => k === "g23-iron" || k === charmUuid || (items[k].name ?? "").startsWith("Gate G23 "))) await api.tags.removeEntry(key);
  });
  await attempt("the tag", async () => { const tag = tagOf(); if (tag && api.editor.entry(`tag:${tag.id}`)) await api.editor.remove(`tag:${tag.id}`); });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter23");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter23");
  });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    if (ours) delete ledger[ours.id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate G23 |g23-|gate-g23/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  if (ours) await attempt(`delete ${ours.name}`, () => ours.delete());
  api.definitions.material.delete("g23-iron");
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup23") !== undefined) await user.unsetFlag(M, "gateSetup23"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  delete globalThis.__g23;
  return {
    problems,
    actorsLeft: game.actors.filter(a => a.name === "Gate G23 Scout").length,
    ledgerLeft: Object.keys(api.tags.ledger().items).filter(k => k === "g23-iron" || k === charmUuid).length,
    tagLeft: Boolean(tagOf()),
    recipeEdited: (api.editor.entry(`recipe:${RECIPE}`)?.editedFields ?? []).length > 0,
    slotNeeds: api.definitions.recipe.get(RECIPE)?.slots.find(s => s.name === SLOT)?.needs ?? null,
    flagLeft: user?.getFlag(M, "gateSetup23") !== undefined,
    windowOpen: [...foundry.applications.instances.keys()].some(k => /^pathfinder-progress/.test(k)),
    audit: api.audit.scan()
  };
})();
```
