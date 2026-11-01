# 20 Stage 11d gate (real Foundry): the Item editor, the Material creator and the effect builder (v0.21.1)

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]**. **Click steps tell you what to click; the block then checks what is on screen and in the world.** Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. Where a step says **"send me a screenshot of ..."**, layout is the point. **Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".**

`tests/gate20.test.js` plays every step against the real `main.js` in a fake Foundry with a real DOM and the strict ApplicationV2 stand-in (it clicks what the steps tell you to click, then runs the block). What it cannot show: the real window, fonts, focus rings, real PF2e item sheets and prices, the real Tab key, file downloads, or the file picker.

**Before each click step, the block checks the screen first** ("preflight"): is the Item editor open, is the item the step is about picked, is the right Effects tab showing? If not, the block stops with a plain sentence saying what to open or pick, instead of reporting a confusing failure. Run it again after you fix the screen.

**New in 0.21.1: Steps 22 to 27.** They make their own items, so after a fresh SETUP (Step 2) you can run just Steps 22 to 27 and finish with Step 27 (CLEANUP again). Steps 1 to 21 are unchanged in what they do and check (their instructions are now short bullets; Step 21's CLEANUP also removes tags last). For a full run do 1 to 20, then 22 to 26, then CLEANUP (Step 21 or Step 27: the same block). The new steps cover: the three preview stages (Steps 22 and 23), the narrow layout (Step 24), the Persistent checkbox (Step 25) and the New note formula placeholder (Step 26).

**What the gate shows** (the 11d decisions, `docs/11d-item-editor-addendum.md` and the answers that came with the approval):
- **The window.** A list on the left (search, filter chips, collapsible groups, a Leftovers group), the editor in the middle (Basics, Discovery, Research track, Effects) and **What players see** on the right, which shows three stages (Just picked up, After studying, After a successful craft in this class) and, for the craft stage, the item class you pick at the top of it.
- **The Material creator.** New material makes the definition AND a linked world item in a Materials folder; New note makes a Plan note or a Research note.
- **The effect builder.** Blocks per item class (Add damage, Grant resistance, Special ability text, plus the base-power tier), with a T1 to T5 table for the dice and the amount. The classes now include bomb, consumable and trinket. The plain-words line is the Hub's own wording.
- **Changing what players may know asks first.** Gold value also sets the PF2e price; bulk is a dropdown (L, 1, 2, ...).
- **Edits of pack items are world patches** (never written to the packs) and can be taken back. Push to copies writes the name, image, description, bulk and price onto every existing copy. Delete is blocked while anything uses the item (Retire instead).
- **Export and import** of the editor's records.
- **Leftovers.** A research track whose item no longer exists is listed and can be removed. This is the **must-do fix**: an orphaned track could not be cleared before 0.21.0.
- **Players see none of it.** A player's copy of a definition carries no effects, blocks, bulk, label, description or retired flag, and the editor refuses a player.

**What SETUP plants, so you know what is not an accident.** SETUP says it in its result too. It plants: **(1)** one deliberately **orphaned research track**, `material:g20-orphan` (a track for an item that does not exist; Step 18 removes it through the editor's Leftovers, and CLEANUP removes it if you never get there); **(2)** one **in-memory** material, **Gate G20 Memory** (`g20-memory`; it is not in the packs, so the editor must leave it alone and refuse to edit it, and it is gone when you reload the GM window); **(3)** the character **Gate G20 Scholar**, owned by the user "Test". Everything else is made by you, through the editor, in the steps.

**SETUP is unchanged in 0.21.1** (it still plants exactly the three things above). Step 22 plants three more, through the editor's api, and says so: the tag **Gate G20 Ore**, and the materials **Gate G20 Plain Stage** (no research track) and **Gate G20 Study Stage** (a research track), all with the same weapon effects and no DC in any text.

**Safety.** Throwaway things named "Gate G20 ...", ids starting `gate-g20-` / `g20-`. They are real world data while the gate runs (the editor writes to the world setting `editorDefinitions` and to the world's Items, and may create a **Materials** and a **Notes** folder if you have none), and CLEANUP removes every one. No real campaign data is changed: the only edit of an existing item (Steps 12 and 13) is a world patch on a material from the packs, which is taken back in the next step. SETUP refuses to run if an earlier run left something behind (an editor record or world item named like a gate one, or a leftover `g20-` track) or if a "Gate G20 ..." actor exists that it did not make. CLEANUP always works and is safe to run twice, even after reloading the GM window (the fake definitions and the planted orphan are gone from memory but the orphan's track is still saved: CLEANUP clears it anyway).

**Restart note.** 0.21.1 changes the stylesheet and the editor's scripts and nothing in the manifest but the version: force-reload both windows (Ctrl+Shift+R); no server restart. (0.21.0 added one world setting (`editorDefinitions`, registered in code), a stylesheet rule block and the editor's scripts. The manifest changed only in its version.)  The scene-controls button is now the screwdriver-and-wrench one ("Item editor"); the old open-book "Discovery tracks" button is gone.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

**What to do and see:**
- Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.21.1**; if it is not, stop (the release may still be building).
- Run the block below in the GM window, then again in the Player window.
- You should see: `["<your GM name>", true, "0.21.1"]` in the GM window and `["Test", false, "0.21.1"]` in the Player window.

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```


## Step 2 [GM]: SETUP

**What to do and see:**
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it re-registers the in-memory material and rebuilds `globalThis.__g20`; it does not plant the orphan again).
- You should see: an object with `planted` (three lines) and `notes` (naming one formula and one pack material), and a `published` revision. On a rerun it says `already: "set up"`.
- Remember the two names in `notes`: the formula (Step 8) and the pack material (Steps 3, 12 and 13).

```js
// [GM] SETUP: plants one orphaned research track, one in-memory material and the character Gate G20 Scholar (owned by Test). Says what it planted.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (typeof api.editor?.create !== "function") throw new Error("this world is not on 0.21.0 yet: update the module and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway20") === true;
  const scholarOld = game.actors.getName("Gate G20 Scholar");
  if (!mine(scholarOld)) throw new Error('"Gate G20 Scholar" already exists and was not made by this check; rename or delete it first');

  const memory = { kind: "material", id: "g20-memory", name: "Gate G20 Memory", tier: 1, value: 1, effects: { basePower: "T1" } };
  const rows = [];
  const build = (ids, extra) => {
    const g = {
      M, api, ids, ...extra,
      scholar: () => game.actors.get(ids.scholar),
      editor: () => {
        const app = foundry.applications.instances.get("pathfinder-progress-item-editor");
        if (!app?.element) throw new Error("Open the Item editor first (the screwdriver-and-wrench button in the scene controls, or run game.modules.get('pathfinder-progress').api.discovery.openEditor())");
        return app;
      },
      // The preflight: is the screen the way this step needs it? `selected` is an editor key, `tab` an Effects tab (general, weapon, bomb, ...), `confirm` true/false.
      screen: ({ selected, tab, confirm } = {}) => {
        const app = g.editor();
        if (selected && app.selectedKey !== selected) throw new Error(`In the Item editor, pick "${g.nameOf(selected)}" in the list first (it has ${app.selectedKey ? `"${g.nameOf(app.selectedKey)}"` : "nothing"} picked)`);
        if (tab && app.effectClass !== tab) throw new Error(`In the Item editor's Effects section, open the "${tab === "general" ? "Every class" : tab}" tab first (it shows "${app.effectClass}")`);
        if (confirm !== undefined && Boolean(app.confirm) !== confirm) throw new Error(confirm ? "The editor is not asking a question right now: do the click before running this block" : "The editor is still asking a question: answer it first");
        return app;
      },
      nameOf: key => { const [kind, ...rest] = key.split(":"); return api.definitions[kind]?.get(rest.join(":"))?.name ?? key; },
      text: () => g.editor().element.textContent.replace(/\s+/g, " "),
      off: action => [...g.editor().element.querySelectorAll(`[data-action="${action}"]`)].every(b => b.getAttribute("aria-disabled") === "true"),
      worldItems: id => game.items.filter(i => i.getFlag(M, "material")?.materialId === id || i.getFlag(M, "note")?.noteId === id),
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g20 = g;
    return g;
  };
  const ensureMemory = () => {
    if (api.definitions.material.has(memory.id)) return;
    const problems = api.checkDefinition(memory);
    if (problems.length) throw new Error(`the in-memory material is invalid: ${problems.join("; ")}`);
    api.definitions.material.set(memory.id, memory);
  };

  if (scholarOld) {
    const saved = test.getFlag(M, "gateSetup20");
    if (!saved) throw new Error("part of the gate is missing: run CLEANUP (the last step), then SETUP again");
    ensureMemory();
    build({ scholar: scholarOld.id }, saved);
    return { already: "set up", rebuilt: "globalThis.__g20 and the in-memory material", published: await api.publishDefinitions() };
  }
  // Refuse to start on top of an earlier run.
  const records = Object.keys(api.editor.records()).filter(k => /:gate-g20-/.test(k));
  if (records.length) throw new Error(`an earlier run left editor records behind (${records.join(", ")}): run CLEANUP (the last step) first`);
  const items = game.items.filter(i => /^Gate G20 /.test(i.name)).map(i => i.name);
  if (items.length) throw new Error(`an earlier run left world items behind (${items.join(", ")}): run CLEANUP (the last step) first`);
  if (Object.keys(api.discovery.tracks.overlay()).some(k => /:g20-/.test(k))) throw new Error("an earlier run left a research track behind (the Item editor lists it under Leftovers): run CLEANUP (the last step) first");

  const recipe = [...api.definitions.recipe.values()].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!recipe) throw new Error("this world has no recipe at all, so a note has nothing to teach: the gate needs one");
  const pack = [...api.definitions.material.values()].find(m => !/^(g\d+|gate)-/.test(m.id) && api.editor.canEdit(`material:${m.id}`) && api.editor.entry(`material:${m.id}`)?.origin === "pack");
  if (!pack) throw new Error("this world has no material from the packs to edit in Step 12");
  const foldersBefore = ["Materials", "Notes"].filter(name => game.folders.some(f => f.type === "Item" && f.name === name));

  const scholar = await Actor.create({ name: "Gate G20 Scholar", type: "character", ownership: { default: 0, [test.id]: 3 }, flags: { [M]: { gateThrowaway20: true } } });
  ensureMemory();
  await game.settings.set(M, "discoveryTracks", { ...(game.settings.get(M, "discoveryTracks") ?? {}), "material:g20-orphan": { milestones: [{ steps: 3, grants: { type: "properties" } }] } });
  const saved = { recipeId: recipe.id, recipeName: recipe.name, pack: { key: `material:${pack.id}`, name: pack.name }, foldersBefore };
  await test.setFlag(M, "gateSetup20", saved);
  build({ scholar: scholar.id }, saved);
  const published = await api.publishDefinitions();
  return {
    planted: [
      'a research track on "material:g20-orphan", an item that does not exist (Step 18 removes it from the editor\'s Leftovers)',
      'one in-memory material, "Gate G20 Memory" (g20-memory), which is not in the packs',
      'the character "Gate G20 Scholar", owned by Test'
    ],
    notes: `Step 8 uses the formula "${recipe.name}"; Steps 12 and 13 edit and restore the pack material "${pack.name}"`,
    published
  };
})();
```


## Group A: the window and the creator

## Step 3 [GM]: open the Item editor and look at it

**What to do and see:**
- Open the editor from the scene controls (the screwdriver-and-wrench button, "Item editor"), or run `game.modules.get("pathfinder-progress").api.discovery.openEditor()`.
- In the list on the left, open **Materials** and click the pack material named in SETUP's `notes`.
- You should see: the editor in the middle with **Basics, Discovery, Research track, Effects**, and "From the module's packs." **Save is off.**
- You should see: on the right, **What players see**.
- Look at **Leftovers** at the bottom of the list.
- You should see: **material:g20-orphan is a research track for an item that no longer exists** with a **Remove** button. Do not press it yet.
- **Send me a screenshot of the whole window with the three panes and the Leftovers group showing.**

```js
// [GM] after the clicks above: three panes left to right, the orphan is listed, nothing is saved yet, and the in-memory material is left alone.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: g.pack.key });
  const pane = sel => app.element.querySelector(sel);
  g.check("the list, the editor and the preview are all on screen", Boolean(pane(".pfp-editor-list") && pane(".pfp-editor-detail") && pane(".pfp-editor-preview")));
  const box = sel => pane(sel).getBoundingClientRect();
  if (box(".pfp-editor-list").width > 0) g.check("list, editor, preview run left to right", box(".pfp-editor-list").right <= box(".pfp-editor-detail").left + 1 && box(".pfp-editor-detail").right <= box(".pfp-editor-preview").left + 1);
  g.check("the picked pack item says it comes from the packs", /From the module's packs\./.test(g.text()));
  g.check("Save is off: nothing has changed", g.off("save"));
  g.check("the planted orphan is listed under Leftovers", /Leftovers \(\d+\)/.test(g.text()) && g.text().includes("material:g20-orphan is a research track for an item that no longer exists"));
  g.check("the in-memory material is not editable (it exists only in memory)", g.api.editor.canEdit("material:g20-memory") === false && await g.api.editor.update("material:g20-memory", { name: "Changed" }).then(() => false, e => /exists only in memory/.test(e.message)));
  g.check("no editor record exists yet", Object.keys(g.api.editor.records()).filter(k => /gate-g20/.test(k)).length === 0);
  return g.done();
})();
```


## Step 4 [GM]: make a material

**What to do and see:**
- Click **New material** (top of the window).
- You should see: a small form; **Create** is off and the reason says "Give it a name first." (and, new in 0.21.1, "Choose a tier first.")
- Type **Gate G20 Fang** as the name.
- Choose **Tier 2**.
- Press **Create**.
- You should see: "**Made Gate G20 Fang and an item for it in the world's Items.**"
- You should see: the editor shows it ("Made in this world's editor.") with a **Delete** button and no "Make an item" button (it already has an item).
- Look in the sidebar's Items tab. You should see: a **Materials** folder holding **Gate G20 Fang**.

```js
// [GM] after the clicks above: the definition, the world record and the linked world item exist.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-fang" });
  const def = g.api.definitions.material.get("gate-g20-fang");
  g.check("the material exists and is tier 2", def?.tier === 2, def?.tier);
  g.check("it is saved as a record made in this world", g.api.editor.records()["material:gate-g20-fang"]?.mode === "new");
  const items = g.worldItems("gate-g20-fang");
  g.check("one world item carries it, marked as the creator's template", items.length === 1 && items[0].getFlag(g.M, "template") === true, items.length);
  const folder = items[0]?.folder;
  g.check("the item is in a Materials folder", game.folders.get(folder?.id ?? folder)?.name === "Materials");
  g.check("the window says it was made here and offers Delete but not Make an item", /Made in this world's editor/.test(g.text()) && !g.off("delete") && !app.element.querySelector('[data-action="make-item"]'));
  g.check("the saved record holds only the world's own fields (no pack text)", JSON.stringify(g.api.editor.records()["material:gate-g20-fang"]).length < 600);
  return g.done();
})();
```


## Step 5 [GM]: Basics, Save, and Push to copies

**What to do and see:**
- With **Gate G20 Fang** picked, set **Gold value (gp each)** to **12**.
- Set **Bulk** to **1**.
- Set **Label (optional, like Parts)** to **Parts**.
- Type **A fang from a throwaway beast.** in **Description**.
- You should see: **Save** turns on, "You have unsaved changes." shows, and the right-hand pane says "**Worth 12 gp each**" and "**Bulk 1**".
- Press **Save**.
- You should see: "Saved Gate G20 Fang. **Use Push to copies** to update the items that already exist."
- Press **Push to copies**.
- You should see: a question ("Write this item's name, image, description, bulk and price onto every copy ...?") with focus on **No, keep things as they are**.
- Press **Yes, do it**.
- You should see: "**Updated 1 copy.**"

```js
// [GM] after the clicks above: the definition and the world item agree (the gold value also sets the PF2e price).
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ selected: "material:gate-g20-fang", confirm: false });
  const def = g.api.definitions.material.get("gate-g20-fang");
  g.check("value, bulk and label are saved", def.value === 12 && def.bulk === "1" && def.label === "Parts", JSON.stringify([def.value, def.bulk, def.label]));
  const [item] = g.worldItems("gate-g20-fang");
  g.check("the world item's PF2e price is 12 gp", item?.system?.price?.value?.gp === 12, JSON.stringify(item?.system?.price));
  g.check("its bulk is 1", item?.system?.bulk?.value === 1, item?.system?.bulk?.value);
  g.check("its description came across", /throwaway beast/.test(item?.system?.description?.value ?? ""));
  g.check("the window said how many copies were updated", /Updated 1 copy\./.test(g.text()));
  g.check("the preview shows the worth and the bulk", /Worth 12 gp each/.test(g.text()) && /Bulk 1/.test(g.text()));
  return g.done();
})();
```


## Group B: the effect builder

## Step 6 [GM]: Add damage and a special ability to the Weapon class

**What to do and see:**
- In **Effects**, click the **Weapon** tab.
- Press **+ Add damage**.
- You should see: a block with dice **1d6** and damage type **fire**; the **+ Add damage** button turns off (one per class).
- You should see: in the right-hand pane, "**Gate G20 Fang adds +1d6 fire damage**", and the class picker already says **Weapon**.
- Press **+ Special ability text**.
- Type **Gate Bite** as the ability name.
- Type **The bite lingers.** as what it does.
- You should see: the pane adds "**Gate G20 Fang gives Gate Bite: The bite lingers.**"
- In the damage block press **Table by tier**.
- You should see: five boxes (Tier 1 to Tier 5) and a note that a material has one tier, so its own row counts.
- Set the **Tier 2** box (this material is tier 2) to **2d6**.
- You should see: the pane now says "**adds +2d6 fire damage**".
- Press **Save**.

```js
// [GM] after the clicks above: the blocks compiled to the roles the craft engine applies, for this material's own tier.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-fang", tab: "weapon", confirm: false });
  const def = g.api.definitions.material.get("gate-g20-fang");
  g.check("the weapon class adds 2d6 fire damage", JSON.stringify(def.classEffects?.weapon?.bonusDamage) === JSON.stringify({ dice: "2d6", type: "fire" }), JSON.stringify(def.classEffects?.weapon?.bonusDamage));
  g.check("the weapon class has the special ability", def.classEffects?.weapon?.specialAbility?.title === "Gate Bite" && def.classEffects.weapon.specialAbility.text === "The bite lingers.");
  g.check("the table by tier was kept in the blocks (five rows)", Object.keys(def.effectBlocks?.byClass?.weapon?.blocks?.find(b => b.type === "damage")?.dice?.byTier ?? {}).length === 5);
  g.check("the preview uses the Hub's wording and follows the weapon class", /Gate G20 Fang adds \+2d6 fire damage/.test(app.element.querySelector('[data-part="preview"]').textContent) && /Gate G20 Fang gives Gate Bite: The bite lingers\./.test(app.element.querySelector('[data-part="preview"]').textContent));
  g.check("Save is off again (it is saved)", g.off("save"));
  g.check("both Add buttons for the blocks already there are off", ["damage", "ability"].every(t => app.element.querySelector(`[data-action="add-block"][data-type="${t}"]`).getAttribute("aria-disabled") === "true"));
  return g.done();
})();
```


## Step 7 [GM]: the other classes, a base-power tier, and the preview's class picker

**What to do and see:**
- Click the **Bomb** tab and press **+ Add damage**.
- Set the dice to **1d4** and the damage type to **acid**.
- Click the **Trinket** tab.
- You should see: **+ Add damage** is **off** here (a trinket has no bonus damage).
- Press **+ Grant resistance**.
- Set the damage type to **fire** and the amount to **5**.
- Click the **Weapon** tab and set **Base power tier** to **T2**.
- Press **Save**.
- In the right-hand pane set **Item class** to **Trinket**.
- You should see: "gives resistance 5 to fire" and no fire damage.
- Set **Item class** back to **Weapon**.

```js
// [GM] after the clicks above: three classes have their own effects; the picker only changes the preview.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-fang", confirm: false });
  const def = g.api.definitions.material.get("gate-g20-fang");
  g.check("the bomb adds 1d4 acid damage", JSON.stringify(def.classEffects?.bomb?.bonusDamage) === JSON.stringify({ dice: "1d4", type: "acid" }), JSON.stringify(def.classEffects?.bomb));
  g.check("the trinket gives resistance 5 to fire", JSON.stringify(def.classEffects?.trinket?.resistance) === JSON.stringify({ type: "fire", value: 5 }), JSON.stringify(def.classEffects?.trinket));
  g.check("the weapon sets the power of tier 2", def.classEffects?.weapon?.basePower === "T2", def.classEffects?.weapon?.basePower);
  g.check("a trinket has no damage block of its own", !def.classEffects?.trinket?.bonusDamage);
  g.check("Save is off (everything is saved)", g.off("save"));
  return g.done();
})();
```


## Step 8 [GM]: notes (a Plan note and a Research note)

**What to do and see:**
- Click **New note**.
- Type **Gate G20 Plan** as the name.
- Choose the formula named in SETUP's `notes`.
- Choose **Plan note (a short study teaches the formula)**.
- Press **Create**.
- You should see: "Made Gate G20 Plan and an item for it ..."
- Click **New note** again.
- Type **Gate G20 Research** as the name, choose the same formula, and choose **Research note (a longer study)**.
- Press **Create**.
- Open the **Research track** section of each note.
- You should see: the Plan note's milestone needs fewer steps than the Research note's.

```js
// [GM] after the clicks above: both notes exist with linked items in a Notes folder; the Plan preset is shorter.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ confirm: false });
  const plan = g.api.definitions.note.get("gate-g20-plan"), research = g.api.definitions.note.get("gate-g20-research");
  g.check("both notes exist and teach the formula", plan?.recipeId === g.recipeId && research?.recipeId === g.recipeId, `${plan?.recipeId} ${research?.recipeId}`);
  g.check("the Plan note's study is shorter than the Research note's", plan?.research?.milestones?.[0]?.steps < research?.research?.milestones?.[0]?.steps, `${plan?.research?.milestones?.[0]?.steps} < ${research?.research?.milestones?.[0]?.steps}`);
  g.check("each teaches a formula at the end of its study", plan?.research?.milestones?.[0]?.grants?.type === "formula" && research?.research?.milestones?.[0]?.grants?.type === "formula");
  const folderName = id => { const f = g.worldItems(id)[0]?.folder; return game.folders.get(f?.id ?? f)?.name; };
  g.check("each has a world item in a Notes folder", folderName("gate-g20-plan") === "Notes" && folderName("gate-g20-research") === "Notes");
  g.check("the notes are listed under Notes in the window", /Notes \(\d+\)/.test(g.text()) && g.text().includes("Gate G20 Plan"));
  return g.done();
})();
```


## Group C: changing what players may know

## Step 9 [GM]: a character who knows the material (no clicks)

**What to do and see:**
- Nothing to click.
- Run the block below. It gives **Gate G20 Scholar** a Gate G20 Fang and writes into her Compendium that she has crafted with it, so the next two steps have something a player already knows.

```js
// [GM] FIXTURE: Gate G20 Scholar holds a Gate G20 Fang and has crafted with it as a weapon (a planted fact, normally learned by crafting).
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const scholar = g.scholar();
  await g.api.giveMaterial(scholar, "gate-g20-fang", 1);
  const book = scholar.getFlag(g.M, "compendium") ?? { v: 1, materials: {}, creatures: {}, regions: {} };
  book.classes = { ...(book.classes ?? {}), weapon: { ...(book.classes?.weapon ?? {}), "gate-g20-fang": { materialId: "gate-g20-fang", materialName: "Gate G20 Fang", tier: 2, effects: {}, at: Date.now() } } };
  await scholar.setFlag(g.M, "compendium", book);
  g.check("she holds one", scholar.items.some(i => i.getFlag(g.M, "material")?.materialId === "gate-g20-fang"));
  const impact = g.api.editor.impact("material:gate-g20-fang", { effectBlocks: {} });
  g.check("the editor now knows a change would touch what she has learned", impact.needsConfirm === true && impact.knownBy.includes("Gate G20 Scholar"), JSON.stringify(impact));
  g.check("a change that touches nothing she has learned (the name) does not ask", g.api.editor.impact("material:gate-g20-fang", { name: "Gate G20 Fang" }).needsConfirm === false);
  await g.api.publishDefinitions();
  return g.done();
})();
```


## Step 10 [GM]: Save asks first; answer No

**What to do and see:**
- Pick **Gate G20 Fang**.
- In **Effects**, click the **Every class** tab.
- Set **Base power tier** to **T1**.
- Press **Save**.
- You should see: instead of saving, a question at the editor's buttons: "**Gate G20 Scholar already knows something this changes (what it does in crafts). Save anyway?**"
- Press **No, keep things as they are**.
- You should see: the question goes, **your change is still in the editor** and **Save** is still on.

```js
// [GM] after the clicks above: nothing was saved, and the draft is still there.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-fang", tab: "general", confirm: false });
  const def = g.api.definitions.material.get("gate-g20-fang");
  g.check("the general effects were NOT changed (answering No keeps things as they are)", def.effects?.basePower === undefined, JSON.stringify(def.effects));
  g.check("the draft is still in the editor and Save is on", !g.off("save") && /You have unsaved changes/.test(g.text()));
  g.check("the base-power box still shows the change", app.element.querySelector('[data-field="power"][data-cls="general"]')?.value === "1");
  return g.done();
})();
```


## Step 11 [GM]: Save asks first; answer Yes

**What to do and see:**
- Press **Save** again.
- You should see: the same question.
- Press **Yes, do it**.
- You should see: "**Saved Gate G20 Fang.**" and **Save** goes off.

```js
// [GM] after the clicks above: the change is saved now.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ selected: "material:gate-g20-fang", confirm: false });
  const def = g.api.definitions.material.get("gate-g20-fang");
  g.check("the general effects now give the power of tier 1", def.effects?.basePower === "T1", JSON.stringify(def.effects));
  g.check("the window says it saved", /Saved Gate G20 Fang\./.test(g.text()));
  g.check("Save is off", g.off("save"));
  g.check("the weapon class still has its own power (T2) on top of the general T1", def.classEffects?.weapon?.basePower === "T2");
  return g.done();
})();
```


## Group D: pack items, retire and delete, export and import, leftovers

## Step 12 [GM]: edit a pack item (a world patch)

**What to do and see:**
- Pick the **pack material named in SETUP's `notes`**.
- Add **" (G20)"** to the end of its **Name**.
- Press **Save**.
- You should see: "**From the packs, with edits made here. Edited here: name.**"
- You should see: the list entry says "edited here" and there is a **Take back my edits** button.

```js
// [GM] after the clicks above: the pack item is edited as a world patch, and the packs themselves are untouched.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ selected: g.pack.key, confirm: false });
  const rec = g.api.editor.records()[g.pack.key];
  g.check("the edit is saved as a patch with one field", rec?.mode === "patch" && JSON.stringify(Object.keys(rec.fields)) === '["name"]', JSON.stringify(rec));
  g.check("the name changed in the live definitions", g.api.definitions.material.get(g.pack.key.split(":")[1]).name === `${g.pack.name} (G20)`);
  g.check("the editor says what came from where", /From the packs, with edits made here\. Edited here: name\./.test(g.text()));
  g.check("Take back my edits is offered", Boolean(g.editor().element.querySelector('[data-action="revert"]')));
  return g.done();
})();
```


## Step 13 [GM]: take it back

**What to do and see:**
- Press **Take back my edits**.
- Press **Yes, do it**.
- You should see: "**Back to the packs' version.**"
- You should see: the name is the original again and the list no longer says "edited here".

```js
// [GM] after the clicks above: the patch is gone, the pack's name is back.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ selected: g.pack.key, confirm: false });
  g.check("no patch is left", g.api.editor.records()[g.pack.key] === undefined);
  g.check("the pack's own name is back", g.api.definitions.material.get(g.pack.key.split(":")[1]).name === g.pack.name, g.api.definitions.material.get(g.pack.key.split(":")[1]).name);
  g.check("the window says so", /Back to the packs' version\./.test(g.text()) && /From the module's packs\./.test(g.text()));
  return g.done();
})();
```


## Step 14 [GM]: a material to delete (no clicks)

**What to do and see:**
- Nothing to click.
- Run the block below. It makes **Gate G20 Delete Me** (through the same call the Create button uses) and gives one to Gate G20 Scholar, so the next step can try to delete something that is in use.

```js
// [GM] FIXTURE: Gate G20 Delete Me exists and Gate G20 Scholar holds one.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const made = await g.api.editor.create("material", { name: "Gate G20 Delete Me", tier: 1 });
  await g.api.giveMaterial(g.scholar(), "gate-g20-delete-me", 1);
  g.check("it was made, with a world item", made.key === "material:gate-g20-delete-me" && g.worldItems("gate-g20-delete-me").length === 1);
  g.check("Gate G20 Scholar holds one", g.scholar().items.some(i => i.getFlag(g.M, "material")?.materialId === "gate-g20-delete-me"));
  g.check("the usage report names her", JSON.stringify(g.api.editor.usage("material:gate-g20-delete-me").copies).includes("Gate G20 Scholar"));
  await g.api.publishDefinitions();
  return g.done();
})();
```


## Step 15 [GM]: Delete is refused while it is in use; Retire hides it; Bring back

**What to do and see:**
- Type **delete me** in the list's search box and click **Gate G20 Delete Me**.
- Press **Delete**.
- You should see: a question ("Delete this item and its world item? This cannot be undone ...").
- Press **Yes, do it**.
- You should see: "**It is still in use (held as 1 in Gate G20 Scholar), so it was not deleted. Retire it instead ...**" and the item is still there.
- Press **Retire**.
- You should see: "**Retired. It no longer shows in the lists unless you turn on Show retired.**" and the list entry disappears.
- Turn on the **Show retired** chip.
- You should see: the entry is back, marked **retired**.
- Press **Bring back**.
- You should see: "Brought back."
- Turn **Show retired** off again.

```js
// [GM] after the clicks above: it is still there, not retired, and still held. (This block then removes her copy so the next step can delete it.)
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ selected: "material:gate-g20-delete-me", confirm: false });
  const def = g.api.definitions.material.get("gate-g20-delete-me");
  g.check("it was not deleted", Boolean(def));
  g.check("it is not retired (it was brought back)", def?.retired === undefined, def?.retired);
  g.check("she still holds it", g.scholar().items.some(i => i.getFlag(g.M, "material")?.materialId === "gate-g20-delete-me"));
  g.check("the window said it brought it back", /Brought back\./.test(g.text()));
  g.check("Show retired is off again", g.editor().filters.retired === false);
  for (const item of g.scholar().items.filter(i => i.getFlag(g.M, "material")?.materialId === "gate-g20-delete-me")) await item.delete();
  g.check("her copy is gone now, so nothing uses it", g.api.editor.usage("material:gate-g20-delete-me").inUse === false);
  return g.done();
})();
```


## Step 16 [GM]: Delete works when nothing uses it

**What to do and see:**
- With **Gate G20 Delete Me** still picked, press **Delete**.
- Press **Yes, do it**.
- You should see: "**Deleted.**", the editor goes back to "Pick an item on the left", and the item is gone from the list and from the Items tab.

```js
// [GM] after the clicks above: the definition, the record and the world item are all gone; the other gate items are untouched.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ confirm: false });
  g.check("the definition is gone", !g.api.definitions.material.has("gate-g20-delete-me"));
  g.check("the saved record is gone", g.api.editor.records()["material:gate-g20-delete-me"] === undefined);
  g.check("its world item is gone", g.worldItems("gate-g20-delete-me").length === 0);
  g.check("Gate G20 Fang is untouched", g.api.definitions.material.has("gate-g20-fang") && g.worldItems("gate-g20-fang").length === 1);
  g.check("the window says Deleted.", /Deleted\./.test(g.text()));
  return g.done();
})();
```


## Step 17 [GM]: export and import

**What to do and see:**
- Press **Export**.
- You should see: a file named `pathfinder-progress-editor.json` downloads and the message says "**Exported N records.**"
- Do not press **Import** here: it opens a file picker, which the block does through the api instead.

```js
// [GM] after pressing Export: the bundle is made; importing it again adds nothing; a new record imports with an item and can be deleted.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ confirm: false });
  g.check("the window said how many records it exported", /Exported \d+ records?\./.test(g.text()));
  const bundle = g.api.editor.exportRecords();
  const keys = bundle.records.map(r => `${r.kind}:${r.id}`);
  g.check("the bundle holds the gate's material and notes", ["material:gate-g20-fang", "note:gate-g20-plan", "note:gate-g20-research"].every(k => keys.includes(k)), keys.join(", "));
  const again = await g.api.editor.importRecords(JSON.parse(JSON.stringify(bundle)));
  g.check("importing it again adds nothing and skips each as already existing", again.added.length === 0 && again.skipped.length >= 3 && again.skipped.every(s => /already exists here/.test(s.reason)));
  const extra = { ...bundle, records: [{ kind: "material", id: "gate-g20-imported", mode: "new", fields: { name: "Gate G20 Imported", tier: 1, value: 3, effects: {} } }] };
  const result = await g.api.editor.importRecords(extra);
  g.check("a new record is imported and gets a world item", result.added.includes("material:gate-g20-imported") && g.worldItems("gate-g20-imported").length === 1);
  g.check("a broken bundle changes nothing and says why", await g.api.editor.importRecords({ nope: true }).then(() => false, e => /not an item editor export/.test(e.message)));
  await g.api.editor.remove("material:gate-g20-imported");
  g.check("the imported material can be deleted again", !g.api.definitions.material.has("gate-g20-imported") && g.worldItems("gate-g20-imported").length === 0);
  return g.done();
})();
```


## Step 18 [GM]: Leftovers (the must-do fix)

**What to do and see:**
- In the list, look at **Leftovers**.
- You should see: **material:g20-orphan is a research track for an item that no longer exists**.
- Press **Remove** next to it.
- You should see: "**Removed material:g20-orphan.**" and the Leftovers group disappears.

```js
// [GM] after the clicks above: the orphan is gone from the editor and from the setting; then a second orphan is cleared through the api the way CLEANUP does it.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.screen({ confirm: false });
  g.check("the window said it removed it", /Removed material:g20-orphan\./.test(g.text()));
  g.check("no g20 track is left in the saved overlay", !Object.keys(g.api.discovery.tracks.overlay()).some(k => /:g20-/.test(k)));
  g.check("the editor lists no leftovers", g.api.editor.leftovers().length === 0, JSON.stringify(g.api.editor.leftovers()));
  await game.settings.set(g.M, "discoveryTracks", { ...(game.settings.get(g.M, "discoveryTracks") ?? {}), "material:g20-orphan-2": { milestones: [{ steps: 3, grants: { type: "properties" } }] } });
  g.check("a second orphan shows up as a leftover", g.api.editor.leftovers().some(l => l.key === "material:g20-orphan-2"));
  await g.api.discovery.tracks.clear("material:g20-orphan-2");
  g.check("the api clears an orphan too (it used to refuse: 'unknown item')", !Object.keys(g.api.discovery.tracks.overlay()).some(k => /:g20-/.test(k)));
  g.check("clearing a track that is not there says so in plain words", await g.api.discovery.tracks.clear("material:g20-orphan-2").then(() => false, e => /no track/.test(e.message)));
  return g.done();
})();
```


## Step 19 [Player]: nothing the GM keeps to themselves reaches you

**What to do and see:**
- Nothing to click.
- Run the block below in the **Player** window.
- You should see: `ALL PASS`: your copy of the definitions has no effects, blocks, class table, bulk, label or description for Gate G20 Fang, and you cannot use the editor.

```js
// [Player] the relay audit for the editor's new fields. Changes nothing.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const scholar = game.actors.getName("Gate G20 Scholar");
  if (game.user.isGM || !scholar?.isOwner) throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  const rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  await api.definitions.refresh({ force: true });
  const m = api.definitions.material.get("gate-g20-fang");
  check("this window knows the material (the scholar holds one)", Boolean(m));
  check("it carries only plain fields", Object.keys(m ?? {}).every(k => ["kind", "id", "name", "tier", "value", "hasTrack", "tag"].includes(k)), Object.keys(m ?? {}).join(","));
  check("no effects, blocks, bulk, label, description, retired flag, dice or damage types", !/effect|block|bulk|label|description|retired|1d4|2d6|acid|fire/i.test(JSON.stringify(m ?? {})));
  check("the notes are not sent (she holds none)", !api.definitions.note.has("gate-g20-plan"));
  const held = scholar.items.find(i => i.getFlag(M, "material")?.materialId === "gate-g20-fang");
  check("her copy of the item has the name and the gold price from when it was given (Step 9, after Step 5's push)", held?.name === "Gate G20 Fang" && held?.system?.price?.value?.gp === 12, `${held?.name} ${JSON.stringify(held?.system?.price?.value)}`);
  check("the editor is GM only", await Promise.resolve().then(() => api.editor.create("material", { name: "Nope" })).then(() => false, e => /GM only/.test(e.message)));
  check("exporting is GM only", await Promise.resolve().then(() => api.editor.exportRecords()).then(() => false, e => /GM only/.test(e.message)));
  check("the editor window is GM only", await Promise.resolve().then(() => api.discovery.openEditor()).then(() => false, e => /GM only/.test(e.message)));
  console.log(rows.join("\n"));
  const bad = rows.filter(r => r.startsWith("FAIL")).length;
  return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS";
})();
```


## Step 20 [GM]: keyboard only, and a narrow window

**What to do and see:**
- Pick **Gate G20 Fang**.
- Click the empty edge of the window, then press **Tab** repeatedly.
- You should see: the focus ring moves through the search box, the chips, the list, the fields and the buttons, always visible, and nothing jumps out of the window.
- Press **Enter** or **Space** on a focused button.
- You should see: it presses the button.
- Drag the window's edge until it is **about 400px wide**.
- You should see: the panes stack, nothing is cut off at the right edge, and **Save** and the other buttons are reachable.
- **Send me a screenshot of the narrow window with Gate G20 Fang picked.**

```js
// [GM] after the clicks above: the window is in its narrow layout, nothing spills sideways, and Tab, Enter and Space stay inside the window without being cancelled.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-fang", confirm: false });
  const root = app.element.querySelector(".pfp-editor");
  g.check("the window is in its narrow layout", app.layout === "narrow", app.layout);
  g.check("nothing spills out sideways", root.scrollWidth <= root.clientWidth + 1, `${root.scrollWidth} <= ${root.clientWidth}`);
  const outer = [];
  const listener = e => outer.push(e.key);
  document.addEventListener("keydown", listener);
  try {
    for (const key of ["Tab", "Enter", " ", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      root.dispatchEvent(event);
      g.check(`${key === " " ? "Space" : key} keeps its default (the editor never cancels it)`, event.defaultPrevented === false);
    }
  } finally { document.removeEventListener("keydown", listener); }
  g.check("only Escape reaches Foundry", JSON.stringify(outer) === JSON.stringify(["Escape"]), JSON.stringify(outer));
  return g.done();
})();
```


## Step 21 [GM]: CLEANUP (always run this, even if a step failed)

**What to do and see:**
- Nothing to click.
- Run the block below. It deletes everything the gate made and puts back what it changed: the editor records and world items named like a gate one (tags last), a leftover edit of the pack material, the Materials and Notes folders **if the gate created them and they are empty**, the planted orphan, the in-memory material and Gate G20 Scholar. Safe to run twice.
- You should see: `problems: []` and every `...Left` count `0`, `audit: []`.
- (If you then run the new Steps 22 to 26, start again from SETUP and finish with Step 27.)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice, and safe after a reload (it does not need the in-memory material or the globals).
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const saved = user?.getFlag(M, "gateSetup20");
  const scholar = game.actors.getName("Gate G20 Scholar");
  const actors = scholar?.getFlag(M, "gateThrowaway20") === true ? [scholar] : [];
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  await attempt("the pack material's edit", async () => {
    for (const [key, rec] of Object.entries(api.editor.records())) if (rec.mode === "patch" && (/ \(G20\)$/.test(rec.fields?.name ?? "") || key === saved?.pack?.key)) await api.editor.revert(key);
  });
  for (const key of Object.keys(api.editor.records()).filter(k => /:gate-g20-/.test(k)).sort((a, b) => a.startsWith("tag:") - b.startsWith("tag:"))) await attempt(`remove ${key}`, () => api.editor.remove(key));    // tags last: a material may still name one
  await attempt("stray world items", async () => { for (const item of game.items.filter(i => /^Gate G20 /.test(i.name))) await item.delete(); });
  await attempt("the folders the gate created", async () => {
    for (const name of ["Materials", "Notes"].filter(n => !(saved?.foldersBefore ?? ["Materials", "Notes"]).includes(n))) {
      const folder = game.folders.find(f => f.type === "Item" && f.name === name);
      if (folder && !game.items.some(i => (i.folder?.id ?? i.folder) === folder.id)) await folder.delete();
    }
  });
  await attempt("the research tracks (including an orphan, whose item is gone)", async () => { for (const key of Object.keys(api.discovery.tracks.overlay()).filter(k => /:g20-/.test(k))) await api.discovery.tracks.clear(key); });
  await attempt("the editor's leftovers", async () => { for (const l of api.editor.leftovers().filter(x => /gate-g20|g20-/.test(x.key))) await api.editor.clearLeftover(l.key); });
  api.definitions.material.delete("g20-memory");
  await attempt("the audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const actor of actors) delete ledger[actor.id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/G20|gate-g20/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup20") !== undefined) await user.unsetFlag(M, "gateSetup20"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  const window = foundry.applications.instances.get("pathfinder-progress-item-editor");
  if (window) await window.close();
  api.gm.clearLog();
  delete globalThis.__g20;
  return {
    problems, actorsLeft: game.actors.filter(a => a.name === "Gate G20 Scholar").length,
    recordsLeft: Object.keys(api.editor.records()).filter(k => /gate-g20/.test(k)).length, itemsLeft: game.items.filter(i => /^Gate G20 /.test(i.name)).length,
    tracksLeft: Object.keys(api.discovery.tracks.overlay()).filter(k => /:g20-/.test(k)).length, audit: api.audit.scan()
  };
})();
```



## Group E: new in 0.21.1 (Steps 22 to 27)

## Step 22 [GM]: fixtures for the preview stages (no clicks)

**What to do and see:**
- Nothing to click.
- Run the block below. It plants, through the editor's api: the tag **Gate G20 Ore** (theme cowardice), the material **Gate G20 Plain Stage** (no research track) and the material **Gate G20 Study Stage** (a research track), each with a world item and the same weapon effects. CLEANUP removes them.

```js
// [GM] FIXTURE (through the editor's api): the tag Gate G20 Ore, an untracked material and a tracked one, with the same weapon effects and no DC anywhere.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  if (g.api.definitions.material.has("gate-g20-plain-stage") || g.api.definitions.material.has("gate-g20-study-stage")) throw new Error("the stage fixtures already exist: go on to Step 23 (or run CLEANUP and SETUP to start again)");
  await g.api.editor.create("tag", { name: "Gate G20 Ore", theme: "cowardice", worksWith: "frightened" });
  const effectBlocks = { general: { power: 1, blocks: [] }, byClass: { weapon: { blocks: [{ type: "damage", dice: { all: "1d6" }, damageType: "fire" }, { type: "ability", title: "Gate Sting", text: "The sting lingers." }] } } };
  await g.api.editor.create("material", { name: "Gate G20 Plain Stage", tier: 1, tag: "gate-g20-ore", effectBlocks });
  await g.api.editor.create("material", { name: "Gate G20 Study Stage", tier: 2, tag: "gate-g20-ore", effectBlocks, research: { milestones: [{ steps: 777, grants: { type: "properties" } }] } });
  g.check("the tag exists", g.api.definitions.tag.get("gate-g20-ore")?.theme === "cowardice");
  g.check("Gate G20 Plain Stage has no research track", !g.api.definitions.material.get("gate-g20-plain-stage")?.research);
  g.check("Gate G20 Study Stage has a research track", Boolean(g.api.definitions.material.get("gate-g20-study-stage")?.research));
  g.check("both give the weapon class damage and an ability", ["gate-g20-plain-stage", "gate-g20-study-stage"].every(id => g.api.definitions.material.get(id)?.classEffects?.weapon?.bonusDamage?.dice === "1d6" && g.api.definitions.material.get(id)?.classEffects?.weapon?.specialAbility?.title === "Gate Sting"));
  g.check("each has a world item", g.worldItems("gate-g20-plain-stage").length === 1 && g.worldItems("gate-g20-study-stage").length === 1);
  await g.api.publishDefinitions();
  return g.done();
})();
```

## Step 23 [GM]: the three preview stages

**What to do and see:**
- Type **stage** in the list's search box and click **Gate G20 Study Stage**.
- In **What players see**, click **Just picked up**.
- You should see: the name, **Tier 2**, "Worth 25 gp each", "Bulk L", and under **What you know**: "**You haven't studied this yet.**" No tag, no theme, no effects ("No effects yet: a player learns what it does by crafting with it."), and no Item class picker.
- Click **After studying**.
- You should see: "**Gate G20 Ore: a theme of cowardice.**" and "**It works with frightened.**" Still no effects.
- Click **After a successful craft in this class**.
- You should see: the **Item class** picker (on **Weapon**) and the lines "**Gate G20 Study Stage adds +1d6 fire damage**", "**... gives Gate Sting: The sting lingers.**" and "**... sets the weapon's power (tier 1)**".
- Set **Item class** to **Armor**.
- You should see: only the power line (the weapon's damage and ability are not shown for armor). Set it back to **Weapon**.
- Click **Gate G20 Plain Stage** in the list, then **Just picked up**.
- You should see: "**Gate G20 Ore: a theme of cowardice.**" already (it has no study, so the tag and theme are known on pickup), and no effects.
- Click **After studying**.
- You should see: "**No study: known on pickup.**" and nothing repeated.
- Nowhere should you see a number of steps, a threshold, a DC or odds.

```js
// [GM] after the clicks above: for BOTH materials, each stage shows only what a player would know at that point, and none shows a number of steps, a threshold, a DC or odds.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ confirm: false });
  const shown = async (key, stage) => {
    app.selectedKey = key; app.draft = null; app.previewStage = stage; app.previewClass = null;
    await app.render();
    return app.element.querySelector('[data-part="preview"]').textContent.replace(/\s+/g, " ");
  };
  const study = "material:gate-g20-study-stage", plain = "material:gate-g20-plain-stage";
  const seen = {};
  for (const key of [study, plain]) for (const stage of ["picked", "studied", "crafted"]) seen[`${key.split(":")[1]}/${stage}`] = await shown(key, stage);
  const t = (key, stage) => seen[`${key.split(":")[1]}/${stage}`];
  g.check("study / just picked up: it has not been studied, and neither tag nor theme is shown", /You haven't studied this yet\./.test(t(study, "picked")) && !/cowardice|Gate ore/.test(t(study, "picked")));
  g.check("study / just picked up: no effects", !/1d6|fire damage|Gate Sting|power \(tier/.test(t(study, "picked")) && /No effects yet/.test(t(study, "picked")));
  g.check("study / after studying: the tag and its theme, in plain words", /Gate G20 Ore: a theme of cowardice\./.test(t(study, "studied")) && /It works with frightened\./.test(t(study, "studied")));
  g.check("study / after studying: still no effects", !/1d6|fire damage|Gate Sting|power \(tier/.test(t(study, "studied")));
  g.check("study / after a craft: the weapon's effect lines", /Gate G20 Study Stage adds \+1d6 fire damage/.test(t(study, "crafted")) && /gives Gate Sting: The sting lingers\./.test(t(study, "crafted")));
  g.check("plain / just picked up: no study, so the tag and theme are known on pickup", /cowardice/.test(t(plain, "picked")) && !/haven't studied/.test(t(plain, "picked")));
  g.check("plain / just picked up: no effects", !/1d6|fire damage|Gate Sting/.test(t(plain, "picked")));
  g.check("plain / after studying: says there is no study instead of repeating itself", /No study: known on pickup\./.test(t(plain, "studied")) && !/cowardice|1d6/.test(t(plain, "studied")));
  g.check("plain / after a craft: the weapon's effect lines", /Gate G20 Plain Stage adds \+1d6 fire damage/.test(t(plain, "crafted")));
  const leaks = Object.entries(seen).filter(([, text]) => /777|\bsteps?\b|milestone|threshold|\bDC\b|odds|%/i.test(text)).map(([k]) => k);
  g.check("no stage shows a step count, a threshold, a DC or odds", leaks.length === 0, leaks.join(", "));
  app.selectedKey = study; app.previewStage = "crafted"; await app.render();
  return g.done();
})();
```

## Step 24 [GM]: the narrow layout

**What to do and see:**
- Click **Gate G20 Study Stage** in the list.
- Drag the window to about **400px wide**, as **tall** as your screen allows.
- You should see: ONE scrolling column: the header and buttons, then the list pane (search box, the filter chips **wrapping onto several lines inside the pane**, the list in its own box), then the editor with **Basics** and **Effects** at full height (not a sliver), then **What players see**.
- You should see: "Show retired" and every other chip fully inside the list pane, none overlapping another.
- Scroll the window.
- You should see: the whole window scrolls as one column; the list keeps its own small scroll; you can reach every field and **Save**.
- Make the window **short** (about 420px tall) and look again.
- You should see: the same column, just scrolling further; nothing squeezed.
- **Send me a screenshot at about 400px wide in a tall window, and one in a short window.**

```js
// [GM] after the clicks above: the narrow window is one scrolling column; nothing is squeezed, the chips stay inside the list pane, and no control sits on another.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-study-stage", confirm: false });
  if (app.layout !== "narrow") throw new Error(`Drag the Item editor narrower than about 700px first (it is "${app.layout}" now)`);
  const el = app.element, root = el.querySelector(".pfp-editor");
  const list = el.querySelector(".pfp-editor-list"), detail = el.querySelector(".pfp-editor-detail"), preview = el.querySelector(".pfp-editor-preview");
  const box = n => n.getBoundingClientRect();
  g.check("the list, the editor and the preview are all there", Boolean(list && detail && preview));
  if (box(list).width > 0) {
    g.check("the panes are stacked in one column: list, then editor, then preview", box(detail).top >= box(list).bottom - 1 && box(preview).top >= box(detail).bottom - 1 && Math.abs(box(list).left - box(detail).left) < 2);
    g.check("the editor pane is not squeezed (at least 280px tall)", box(detail).height >= 280, `${box(detail).height.toFixed(0)}px`);
    const scroller = detail.querySelector(".pfp-editor-scroll");
    g.check("the editor's content shows in the column, not in a little scrolling box", scroller.scrollHeight <= scroller.clientHeight + 1, `${scroller.scrollHeight} vs ${scroller.clientHeight}`);
    const outside = [...list.querySelectorAll(".pfp-search input, .pfp-row > button")].filter(b => { const r = box(b), p = box(list); return r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1; }).map(b => b.textContent.trim() || b.type);
    g.check("every control of the filter row is inside the list pane", outside.length === 0, outside.join(", "));
    const chips = [...list.querySelectorAll(".pfp-row > button")].map(b => box(b));
    const touching = chips.flatMap((a, i) => chips.slice(i + 1).filter(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
    g.check("no two chips overlap", touching.length === 0);
    g.check("the window does not scroll sideways", root.scrollWidth <= root.clientWidth + 1, `${root.scrollWidth} vs ${root.clientWidth}`);
  }
  g.check("Basics and Effects are in the editor", /Basics/.test(g.text()) && /Effects/.test(g.text()) && Boolean(el.querySelector('[data-field="basic"][data-name="name"]')));
  return g.done();
})();
```

## Step 25 [GM]: the Persistent checkbox

**What to do and see:**
- Make the window wide again (any width over about 700px).
- Click **Gate G20 Fang**, then the **Weapon** tab in **Effects**.
- Look at the damage block.
- You should see: **Persistent** as a normal-sized checkbox with the word beside it on the same line (not a huge box with the word underneath).
- Click the **word** Persistent (not the box).
- You should see: the box ticks and **Save** turns on.
- Click the word again.
- You should see: the box clears.
- Tick it once more and press **Discard changes**.
- You should see: **Save** is off again.

```js
// [GM] after the clicks above: the Persistent checkbox is a normal-sized box with its words beside it; the label row is the 44px tap target; it is the only checkbox.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.screen({ selected: "material:gate-g20-fang", tab: "weapon", confirm: false });
  const boxes = [...app.element.querySelectorAll('input[type="checkbox"]')];
  g.check("the damage block has exactly one checkbox (Persistent) and the editor has no other", boxes.length === 1 && boxes[0].getAttribute("aria-label") === "Persistent", boxes.length);
  const input = boxes[0], label = input?.closest("label");
  g.check("the box sits inside a label that holds the word Persistent", Boolean(label) && /Persistent/.test(label.textContent));
  if (input && input.getBoundingClientRect().width > 0) {
    const b = input.getBoundingClientRect(), l = label.getBoundingClientRect(), size = parseFloat(getComputedStyle(input).fontSize);
    g.check("the box is a normal size (about a line of text, not an enlarged box)", b.width <= size * 1.6 && b.height <= size * 1.6, `${b.width.toFixed(0)}x${b.height.toFixed(0)}px`);
    g.check("the label row is at least 44px tall: that is the tap target", l.height >= 43.5, `${l.height.toFixed(0)}px`);
    g.check("the words are beside the box on the same line, not underneath", Math.abs((l.top + l.height / 2) - (b.top + b.height / 2)) < 6 && label.getBoundingClientRect().width > b.width + 20);
  }
  g.check("ticking it and pressing Discard changes left nothing to save", g.off("save"));
  return g.done();
})();
```

## Step 26 [GM]: the New note formula placeholder

**What to do and see:**
- Click **New note**.
- Type **Gate G20 Placeholder** as the name.
- Look at the form without choosing anything.
- You should see: the formula dropdown reads "**Choose a formula**" (not the first formula), the kind of note reads "**Choose a kind of note**", **Create** is off, and the reason line says "**Pick a formula first.**"
- Run the block below with the form still open.
- Then choose **Plan note** and a formula: **Create** turns on. **Do not press it**: press **Cancel**.
- Click **New material**.
- You should see: the tier dropdown reads "**Choose a tier**", **Create** is off and the reason says "Choose a tier first." Press **Cancel**.

```js
// [GM] while the New note form is open with a name typed and no formula chosen: the formula starts on a disabled placeholder, Create is off, and the reason says why.
await (async () => {
  const g = globalThis.__g20 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const app = g.editor();
  if (!app.creating || app.creating.kind !== "note") throw new Error("Click New note first, and type the name (the form must be open)");
  const el = app.element;
  const formula = el.querySelector('[data-field="create"][data-name="recipeId"]'), kind = el.querySelector('[data-field="create"][data-name="preset"]');
  g.check("the formula dropdown is not on a real formula", formula.value === "", formula.value);
  g.check("it reads \"Choose a formula\" and that option is disabled", formula.selectedOptions[0]?.textContent === "Choose a formula" && formula.selectedOptions[0]?.disabled === true);
  g.check("the kind of note starts on \"Choose a kind of note\" too", kind.selectedOptions[0]?.textContent === "Choose a kind of note" && kind.selectedOptions[0]?.disabled === true);
  g.check("Create is off", el.querySelector('[data-action="do-create"]').getAttribute("aria-disabled") === "true");
  g.check("the reason is shown: Pick a formula first.", /Pick a formula first\./.test(g.text()));
  g.check("nothing was created", !g.api.definitions.note.has("gate-g20-placeholder"));
  return g.done();
})();
```

## Step 27 [GM]: CLEANUP again (after the new steps)

**What to do and see:**
- Nothing to click.
- Run the block below. It is the same block as Step 21 (CLEANUP), repeated here so the new steps can be run on their own after a fresh SETUP. Safe to run twice.
- You should see: `problems: []` and every `...Left` count `0`, `audit: []`.

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice, and safe after a reload (it does not need the in-memory material or the globals).
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const saved = user?.getFlag(M, "gateSetup20");
  const scholar = game.actors.getName("Gate G20 Scholar");
  const actors = scholar?.getFlag(M, "gateThrowaway20") === true ? [scholar] : [];
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  await attempt("the pack material's edit", async () => {
    for (const [key, rec] of Object.entries(api.editor.records())) if (rec.mode === "patch" && (/ \(G20\)$/.test(rec.fields?.name ?? "") || key === saved?.pack?.key)) await api.editor.revert(key);
  });
  for (const key of Object.keys(api.editor.records()).filter(k => /:gate-g20-/.test(k)).sort((a, b) => a.startsWith("tag:") - b.startsWith("tag:"))) await attempt(`remove ${key}`, () => api.editor.remove(key));    // tags last: a material may still name one
  await attempt("stray world items", async () => { for (const item of game.items.filter(i => /^Gate G20 /.test(i.name))) await item.delete(); });
  await attempt("the folders the gate created", async () => {
    for (const name of ["Materials", "Notes"].filter(n => !(saved?.foldersBefore ?? ["Materials", "Notes"]).includes(n))) {
      const folder = game.folders.find(f => f.type === "Item" && f.name === name);
      if (folder && !game.items.some(i => (i.folder?.id ?? i.folder) === folder.id)) await folder.delete();
    }
  });
  await attempt("the research tracks (including an orphan, whose item is gone)", async () => { for (const key of Object.keys(api.discovery.tracks.overlay()).filter(k => /:g20-/.test(k))) await api.discovery.tracks.clear(key); });
  await attempt("the editor's leftovers", async () => { for (const l of api.editor.leftovers().filter(x => /gate-g20|g20-/.test(x.key))) await api.editor.clearLeftover(l.key); });
  api.definitions.material.delete("g20-memory");
  await attempt("the audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const actor of actors) delete ledger[actor.id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/G20|gate-g20/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup20") !== undefined) await user.unsetFlag(M, "gateSetup20"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  const window = foundry.applications.instances.get("pathfinder-progress-item-editor");
  if (window) await window.close();
  api.gm.clearLog();
  delete globalThis.__g20;
  return {
    problems, actorsLeft: game.actors.filter(a => a.name === "Gate G20 Scholar").length,
    recordsLeft: Object.keys(api.editor.records()).filter(k => /gate-g20/.test(k)).length, itemsLeft: game.items.filter(i => /^Gate G20 /.test(i.name)).length,
    tracksLeft: Object.keys(api.discovery.tracks.overlay()).filter(k => /:g20-/.test(k)).length, audit: api.audit.scan()
  };
})();
```
