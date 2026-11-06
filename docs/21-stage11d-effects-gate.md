# 21 Stage 11d gate (real Foundry): effects that act on a target (v0.22.0)

Run in a real world on PF2e 8.6.1, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]**. **Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".** Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. Where a step says **"send me a screenshot of ..."**, layout is the point.

`tests/gate21.test.js` plays every step in a fake Foundry (a fake chat log, fake actors with PF2e's condition rules and saves, the real editor window in jsdom). **What the fake cannot prove, and only you can, in real Foundry: Steps 12 to 24.** They need a real attack, a real damage-free Strike, a real item use, a real save roll and the real chat log. Steps 1 to 11 prove the builder, the plain words, the leak scan, the card, Apply with a forced save, the unlinked token and the two-target case from recorded message shapes (the shapes the real-Foundry probe found, `docs/probes/11d-targets-probe.md`).

**What the gate shows** (`docs/11d-item-editor-addendum.md`, "v0.22.0 decisions"):
- **The builder.** "Apply a condition" on the Weapon, Bomb and Consumable tabs: a condition from a short list of ten, a saving throw (or No save) and a value (one value or a T1 to T5 table, hidden for a condition with no value). Several per class. Not offered on Every class, Armor, Robes, Focus or Trinket.
- **Plain words only for players.** "Makes the target fearful". A condition's value, its save and its DC never appear in the preview, the item, the Compendium book, a chat card or anything a player's client holds.
- **The GM's card.** A whisper with Apply and Skip, made when a crafted weapon hits, a bomb is thrown (any outcome but a critical failure) or a crafted consumable is used. A message the module cannot place gives a fallback card where you pick the target.
- **Apply.** One secret save per effect per target, rolled on the **target token's** actor, against the DC of the crafted item's recipe level. A critical failure puts a valued condition on one higher (never above 4); a failure at its value; a success or critical success nothing; "No save" applies by itself. The DC and the roll go to the GM log and nowhere else. The result is written back into the card, plain words only.

**What SETUP plants, so you know what is not an accident.** SETUP says it in its result too: **(1)** five **in-memory** definitions (they are gone when you reload the GM window; SETUP puts them back): the materials `g21-iron` and `g21-mitflit` and the recipes `g21-sword`, `g21-bomb` and `g21-potion` (a craft level of 5 each); **(2)** the characters **Gate G21 Hero** (owned by Test, a linked token), **Gate G21 Goblin A** (an **unlinked** token) and **Gate G21 Goblin B** (a **linked** token); **(3)** three items on the Hero marked as crafted: **Gate G21 Mitflit Sword** (a weapon), **Gate G21 Mitflit Bomb** (a bomb) and **Gate G21 Mitflit Draught** (a consumable); **(4)** their three tokens on the scene you have open. Everything else is made by you, in the steps.

**Safety.** Throwaway things named "Gate G21 ...", ids starting `gate-g21-` / `g21-`. CLEANUP (the last step) removes every one, and is safe to run twice and after a reload. No real campaign data is changed. **The real recipes under `content/recipes` are not edited**; to use "Apply a condition" in a real recipe, its slot's `drives` list needs `"applyCondition"` added. For the Spider Fang Dagger that is one line in `content/recipes/recipe-dagger-spider-fang.json`: `{ "name": "fang", "drives": ["bonusDamage", "specialAbility", "applyCondition"], "tierFloor": 2, "qty": 1 }`.

**Restart note.** 0.22.0 changes scripts, the stylesheet and the manifest's version only: force-reload both windows (Ctrl+Shift+R); no server restart.


## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

**What to do and see:**
- Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.22.0**; if it is not, stop (the release may still be building).
- Run the block below in the GM window, then again in the Player window.
- You should see: `["<your GM name>", true, "0.22.0"]` in the GM window and `["Test", false, "0.22.0"]` in the Player window.

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```


## Step 2 [GM]: SETUP

**What to do and see:**
- Open the scene you play on and make it the **active** scene (right-click it in the Scenes tab, Activate), so the Player window shows it.
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts the in-memory definitions and `globalThis.__g21` back, and places any token that is missing).
- You should see: an object with `planted` (four lines), `tokens` (3 when a scene was open) and a `published` revision. On a rerun it says `already: "set up"`.
- If `tokens` is 0, open a scene and run the block again.

```js
// [GM] SETUP: plants five in-memory g21- definitions, the characters Gate G21 Hero (owned by Test), Gate G21 Goblin A (unlinked token) and Gate G21 Goblin B (linked token),
// three crafted-flagged items on the Hero and their tokens. Says what it planted.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (typeof api.effects?.applyCard !== "function") throw new Error("this world is not on 0.22.0 yet: update the module and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway21") === true;
  for (const n of ["Hero", "Goblin A", "Goblin B"]) if (!mine(game.actors.getName(`Gate G21 ${n}`))) throw new Error(`"Gate G21 ${n}" already exists and was not made by this check; rename or delete it first`);

  const OUT = "Compendium.pf2e.equipment-srd.Item.AAAAAAAAAAAAAAAA";
  const recipe = (id, category) => ({ kind: "recipe", id, name: `Gate G21 ${category} recipe`, category, output: { 1: OUT, 2: OUT, 3: OUT }, craftLevel: 5, slots: [{ name: "blade", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "fang", drives: ["applyCondition"], tierFloor: 2, qty: 1 }], stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } });
  const defs = [
    ["material", { kind: "material", id: "g21-iron", name: "Gate G21 Iron", tier: 1, value: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g21-mitflit", name: "Gate G21 Mitflit", tier: 2, value: 5, effects: { basePower: "T1" }, classEffects: {
      weapon: { applyCondition: [{ condition: "frightened", value: 1, save: "will" }, { condition: "prone", save: "none" }] },
      bomb: { applyCondition: [{ condition: "sickened", value: 2, save: "fortitude" }] },
      consumable: { applyCondition: [{ condition: "dazzled", save: "reflex" }] } } }],
    ["recipe", recipe("g21-sword", "weapon")], ["recipe", recipe("g21-bomb", "bomb")], ["recipe", recipe("g21-potion", "consumable")]
  ];
  const ensureDefs = () => {
    for (const [kind, def] of defs) {
      if (api.definitions[kind].has(def.id)) continue;
      const problems = api.checkDefinition(def);
      if (problems.length) throw new Error(`the in-memory ${kind} ${def.id} is invalid: ${problems.join("; ")}`);
      api.definitions[kind].set(def.id, def);
    }
  };
  const crafted = recipeId => ({ [M]: { crafted: { recipeId, materials: [{ slot: "blade", materialId: "g21-iron", units: 1 }, { slot: "fang", materialId: "g21-mitflit", units: 1 }] } } });
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, seen: new Set(), n: 0,
      hero: () => game.actors.get(ids.hero),
      world: n => game.actors.getName(`Gate G21 Goblin ${n}`),
      token: name => canvas.scene?.tokens.find(t => t.name === `Gate G21 ${name}`),
      item: key => game.actors.get(ids.hero)?.items.find(i => i.name === `Gate G21 Mitflit ${key}`),
      editor: () => {
        const app = foundry.applications.instances.get("pathfinder-progress-item-editor");
        if (!app?.element) throw new Error("Open the Item editor first (the screwdriver-and-wrench button in the scene controls, or run game.modules.get('pathfinder-progress').api.discovery.openEditor())");
        return app;
      },
      mark: () => { g.seen = new Set(game.messages.map(m => m.id)); },
      cards: () => game.messages.filter(m => m.getFlag(M, "fx") && !g.seen.has(m.id)),
      ac: async n => { for (const x of ["A", "B"]) await g.world(x)?.update({ "system.attributes.ac.value": n }); },
      needTokens: () => { for (const n of ["Hero", "Goblin A", "Goblin B"]) if (!g.token(n)) throw new Error(`The token "Gate G21 ${n}" is not on the open scene: open the scene you ran SETUP on, or run SETUP again with a scene open`); },
      conds: actor => ["frightened", "prone", "sickened", "dazzled"].map(s => `${s}${actor.getCondition(s) ? (actor.getCondition(s).value ?? "") || "y" : "-"}`).join(" "),
      clear: async actor => { for (const slug of ["frightened", "prone", "sickened", "dazzled"]) await api.effects.adapter.removeCondition(actor, slug); },
      // Messages shaped like the real ones (docs/probes/11d-targets-probe.md, Results). `targets` are the roller's targets as the GM client sees them.
      attack: (outcome, { item = "Sword", target = "Goblin A", type = "attack-roll" } = {}) => {
        const hero = g.hero(), it = g.item(item), t = target ? g.token(target) : null;
        return { id: `g21-${++g.n}`, flags: { pf2e: { context: { type, outcome, ...(t ? { target: { token: t.uuid, actor: `${t.uuid}.Actor.${t.actorId}` } } : {}), origin: { actor: `Actor.${hero.id}`, token: g.token("Hero").uuid }, action: "strike" }, origin: { actor: `Actor.${hero.id}`, uuid: it.uuid, type: "weapon" } } }, author: { targets: new Set() } };
      },
      use: (targets, item = "Draught") => ({ id: `g21-${++g.n}`, flags: { pf2e: { origin: { actor: `Actor.${g.hero().id}`, uuid: g.item(item).uuid, type: "consumable" } } }, author: { targets: new Set(targets.map(n => ({ document: g.token(n) }))) } }),
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g21 = g;
    return g;
  };
  const placeTokens = async hero => {
    if (!canvas?.scene?.createEmbeddedDocuments) return 0;
    const have = n => canvas.scene.tokens.some(t => t.name === `Gate G21 ${n}`);
    const s = canvas.grid.size, x0 = canvas.dimensions.sceneX + s * 3, y0 = canvas.dimensions.sceneY + s * 3, docs = [];
    for (const [n, actor, dx] of [["Hero", hero, 0], ["Goblin A", game.actors.getName("Gate G21 Goblin A"), 3], ["Goblin B", game.actors.getName("Gate G21 Goblin B"), 6]]) if (!have(n)) docs.push((await actor.getTokenDocument({ x: x0 + dx * s, y: y0 })).toObject());
    if (docs.length) await canvas.scene.createEmbeddedDocuments("Token", docs);
    return canvas.scene.tokens.filter(t => /^Gate G21 /.test(t.name)).length;
  };

  const old = game.actors.getName("Gate G21 Hero");
  if (old) {
    if (!test.getFlag(M, "gateSetup21")) throw new Error("part of the gate is missing: run CLEANUP (the last step), then SETUP again");
    ensureDefs();
    build({ hero: old.id });
    return { already: "set up", rebuilt: "globalThis.__g21 and the in-memory definitions", tokens: await placeTokens(old), published: await api.publishDefinitions() };
  }
  const records = Object.keys(api.editor.records()).filter(k => /:gate-g21-/.test(k));
  if (records.length) throw new Error(`an earlier run left editor records behind (${records.join(", ")}): run CLEANUP (the last step) first`);
  ensureDefs();
  const flags = { [M]: { gateThrowaway21: true } };
  const hero = await Actor.create({ name: "Gate G21 Hero", type: "character", ownership: { default: 0, [test.id]: 3 }, flags, prototypeToken: { actorLink: true } });
  const goblin = (n, linked) => Actor.create({ name: `Gate G21 Goblin ${n}`, type: "npc", flags, system: { attributes: { hp: { value: 60, max: 60 }, ac: { value: 12 } } }, prototypeToken: { actorLink: linked } });
  await goblin("A", false);
  await goblin("B", true);
  const weapon = (name, recipeId) => ({ name, type: "weapon", flags: crafted(recipeId), system: { damage: { dice: 1, die: "d6", damageType: "slashing" }, equipped: { carryType: "held", handsHeld: 1 }, quantity: 1 } });
  await hero.createEmbeddedDocuments("Item", [weapon("Gate G21 Mitflit Sword", "g21-sword"), weapon("Gate G21 Mitflit Bomb", "g21-bomb"), { name: "Gate G21 Mitflit Draught", type: "consumable", flags: crafted("g21-potion"), system: { quantity: 9 } }]);
  await test.setFlag(M, "gateSetup21", { at: Date.now(), foldersBefore: ["Materials", "Notes"].filter(name => game.folders.some(f => f.type === "Item" && f.name === name)) });
  build({ hero: hero.id });
  return {
    planted: [
      "five in-memory definitions: materials g21-iron and g21-mitflit, recipes g21-sword, g21-bomb and g21-potion (craft level 5)",
      'the characters "Gate G21 Hero" (owned by Test), "Gate G21 Goblin A" (unlinked token) and "Gate G21 Goblin B" (linked token)',
      "three items on the Hero marked as crafted: Gate G21 Mitflit Sword (weapon), Gate G21 Mitflit Bomb (bomb) and Gate G21 Mitflit Draught (consumable)",
      "their tokens on the open scene"
    ],
    tokens: await placeTokens(hero),
    published: await api.publishDefinitions()
  };
})();
```


## Step 3 [GM]: the builder: Apply a condition

**What to do and see:**
- Open the Item editor (the screwdriver-and-wrench button in the scene controls).
- Click **New material**, type `Gate G21 Fang` as the name, pick **Tier 2** and press **Create**.
- In the Effects section click the **Weapon** tab.
- Click **+ Apply a condition** once. You should see: a block with a Condition box on Frightened, a Saving throw box on Will, and a Value box with 1.
- Click **+ Apply a condition** again. You should see: a second block, set to Sickened.
- In the first block, open the Saving throw box and pick **Fortitude**.
- In the first block press **Table by tier**, and type `2` in the **Tier 2** box.
- In the second block open the Condition box and pick **Prone**. You should see: its Value box goes away (Prone has no value).
- In the second block open the Saving throw box and pick **No save**.
- Run the block below.
- You should see: `ALL PASS`. The right-hand "What players see" pane reads "Gate G21 Fang makes the target fearful and knocks the target down", with no number, no save and no DC.

```js
// [GM] Checks the screen after the clicks: two condition blocks, a table, a valueless one, and the plain words (no value, save or DC).
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first; it rebuilds this helper after a reload");
  const app = g.editor();
  if (app.selectedKey !== "material:gate-g21-fang") throw new Error('In the Item editor, pick "Gate G21 Fang" in the list first');
  if (app.effectClass !== "weapon") throw new Error('In the Effects section, open the "weapon" tab first');
  const el = app.element, text = sel => el.querySelector(sel)?.textContent.replace(/\s+/g, " ") ?? "";
  const conds = [...el.querySelectorAll('select[data-name="condition"]')], saves = [...el.querySelectorAll('select[data-name="save"]')];
  g.check("two condition blocks are on the page", conds.length === 2 && saves.length === 2, conds.length);
  g.check("the first is Frightened with a Fortitude save", conds[0]?.value === "frightened" && saves[0]?.value === "fortitude", `${conds[0]?.value}/${saves[0]?.value}`);
  g.check("the second is Prone with No save", conds[1]?.value === "prone" && saves[1]?.value === "none", `${conds[1]?.value}/${saves[1]?.value}`);
  g.check("the first block shows a T1 to T5 table", el.querySelectorAll('input[data-field="cell"][data-type="condition"][data-index="0"]').length === 5);
  g.check("the second block has no value box (a valueless condition)", el.querySelectorAll('[data-type="condition"][data-index="1"][data-name="value"], input[data-field="cell"][data-index="1"]').length === 0);
  const preview = text('[data-part="preview"]');
  g.check("the preview says it in plain words", /Gate G21 Fang makes the target fearful and knocks the target down/.test(preview), preview.slice(0, 160));
  g.check("the preview names no save, no DC and no condition value", !/Will|Fortitude|Reflex|\bDC\b|frightened|prone|save/i.test(preview.replace(/Gate G21 Fang/g, "")));
  return g.done();
})();
```


## Step 4 [GM]: where the block is offered

**What to do and see:**
- In the Item editor, with Gate G21 Fang still picked, click the **Every class** tab. You should see: no **+ Apply a condition** button.
- Click the **Armor** tab, then **Robes**, **Focus** and **Trinket**. You should see: no **+ Apply a condition** button on any of them.
- Click the **Bomb** tab, then **Consumable**. You should see: a **+ Apply a condition** button on both.
- Run the block below (it walks the same tabs itself).
- You should see: `ALL PASS`.

```js
// [GM] Walks the tabs: the block is offered on weapon, bomb and consumable only, and the editor refuses it on a worn class.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const app = g.editor();
  if (app.selectedKey !== "material:gate-g21-fang") throw new Error('In the Item editor, pick "Gate G21 Fang" in the list first');
  const offered = async cls => { app.effectClass = cls; await app.render(); return app.element.querySelectorAll('[data-action="add-block"][data-type="condition"]').length > 0; };
  for (const cls of ["general", "armor", "robes", "focus", "trinket"]) g.check(`${cls}: not offered`, (await offered(cls)) === false);
  for (const cls of ["weapon", "bomb", "consumable"]) g.check(`${cls}: offered`, (await offered(cls)) === true);
  app.effectClass = "weapon";
  await app.render();
  return g.done();
})();
```


## Step 5 [GM]: the narrow layout

**What to do and see:**
- Drag the Item editor's right edge in until the window is about 400px wide (a phone-sized column).
- Click the **Weapon** tab and scroll down to the two condition blocks.
- Send me a screenshot of the condition blocks in that narrow window.
- You should see: one column; the Condition and Saving throw boxes wrap and never sit on top of each other; the Tier 1 to Tier 5 boxes wrap; every button is easy to hit.
- Run the block below.
- You should see: `ALL PASS`.

```js
// [GM] The narrow layout: the window stacks into one column and no two controls overlap.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const app = g.editor();
  if (app.layout !== "narrow") throw new Error("Drag the Item editor narrower first (about 400px wide): it is still showing the wide layout");
  const controls = [...app.element.querySelectorAll(".pfp-block select, .pfp-block input, .pfp-block button")].map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
  let overlaps = 0;
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps++;
  }
  g.check("the narrow layout is on", app.layout === "narrow");
  g.check("no two controls in a block overlap", overlaps === 0, overlaps);
  g.check("no control is wider than the window", controls.every(r => r.right <= app.element.getBoundingClientRect().right + 1));
  return g.done();
})();
```


## Step 6 [GM]: Save, and what the engine now holds

**What to do and see:**
- Widen the Item editor again (about 1000px).
- Click **Save**.
- You should see: "Saved Gate G21 Fang."
- Run the block below.
- You should see: `ALL PASS`.

```js
// [GM] After Save: the material's weapon class holds the two conditions (the tier-2 table row, a valueless one), validated like any definition.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const m = g.api.definitions.material.get("gate-g21-fang");
  if (!m) throw new Error("Save Gate G21 Fang in the Item editor first (Step 3)");
  g.check("it is saved with two conditions in the weapon class", m.classEffects?.weapon?.applyCondition?.length === 2);
  g.check("frightened with the tier-2 row of the table, a Fortitude save", JSON.stringify(m.classEffects.weapon.applyCondition[0]) === JSON.stringify({ condition: "frightened", value: 2, save: "fortitude" }), JSON.stringify(m.classEffects.weapon.applyCondition[0]));
  g.check("prone has no value and no save", JSON.stringify(m.classEffects.weapon.applyCondition[1]) === JSON.stringify({ condition: "prone", save: "none" }));
  g.check("the blocks are kept (so a later edit can change them)", m.effectBlocks?.byClass?.weapon?.blocks?.length === 2);
  g.check("no load error was reported for it", !g.api.errors.some(e => /gate-g21-fang/.test(JSON.stringify(e))));
  return g.done();
})();
```


## Step 7 [GM]: a successful craft teaches the Hero

**What to do and see:**
- Run the block below. It records what a successful craft of the Gate G21 sword would teach Gate G21 Hero (the same call a craft makes).
- You should see: `ALL PASS`.

```js
// [GM] Teaches the Hero the Mitflit's weapon behaviour (what a successful craft writes into the Compendium book).
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  await g.api.compendium.noteCrafted(g.hero(), "g21-sword", [{ slot: "blade", materialId: "g21-iron" }, { slot: "fang", materialId: "g21-mitflit" }]);
  const book = JSON.stringify(g.hero().flags?.[g.M] ?? {});
  g.check("the book holds the plain line", /makes the target fearful/.test(book) && /knocks the target down/.test(book));
  return g.done();
})();
```


## Step 8 [Player]: only plain words

**What to do and see:**
- In the **Player** window, force-reload (Ctrl+Shift+R) and wait for the world to load.
- Run the block below.
- You should see: `ALL PASS`. It reads everything this client holds about the Hero and the module's definitions, looking for a value, a save, a DC or a condition name.

```js
// [Player] Nothing this client holds names a condition's value, save or DC: not the definitions, not the Hero's Compendium book.
(() => {
  const M = "pathfinder-progress", rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.actors.getName("Gate G21 Hero");
  if (!hero) throw new Error("The Gate G21 Hero is not visible here: run Step 2 (SETUP) in the GM window, then force-reload this window");
  const api = game.modules.get(M).api;
  const book = JSON.stringify(hero.flags?.[M] ?? {});
  const defs = JSON.stringify([...(api.definitions?.material?.values() ?? [])]);
  const secret = /"(save|saveType|condition|conditionValue|dc)"\s*:|"applyCondition"\s*:\s*\[|\b(Will|Fortitude|Reflex)\b|\bDC\b/;
  check("the Hero's book has the plain line", /makes the target fearful/.test(book));
  check("the Hero's book has no save, DC or condition field", !secret.test(book));
  check("the materials this client holds have no effects or blocks", !/"(effects|classEffects|effectBlocks)"/.test(defs));
  check("and no condition, save or DC", !secret.test(defs));
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 9 [GM]: the card, from recorded message shapes

**What to do and see:**
- Make sure the Gate G21 tokens are on the open scene (Step 2).
- Open the chat sidebar and make it narrow (drag its left edge until the messages are about 300px wide).
- Run the block below. It feeds the module messages shaped exactly like the real ones the probe recorded: a weapon hit, a miss, a critical failure, a damage roll, a bomb miss, a bomb critical failure, an unknown message and a hit with no target.
- Send me a screenshot of the cards that appear in the narrow chat.
- You should see: `ALL PASS`, and four whispered cards in the chat (the hit, the bomb miss, and two fallback cards), each with **Apply** and **Skip** buttons. Do not press them yet.

```js
// [GM] The hook, from probe-shaped messages: which ones make a card, which do not, what the card says and what it carries.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  g.needTokens();
  const fx = card => card?.getFlag(g.M, "fx");
  const sendAll = async messages => { const made = []; for (const m of messages) { const card = await g.api.effects.handle(m); if (card) made.push(card); } return made; };
  g.mark();
  const hit = await g.api.effects.handle(g.attack("success"));
  g.check("a weapon hit makes one card", g.cards().length === 1 && hit);
  g.check("it names the item and the target in plain words", hit?.content.includes("Gate G21 Mitflit Sword hit Gate G21 Goblin A: makes the target fearful and knocks the target down."), hit?.content.replace(/<[^>]*>/g, " ").trim().slice(0, 140));
  g.check("it is a whisper to the GM with Apply and Skip", hit?.whisper?.length >= 1 && /data-pfp-fx="apply"/.test(hit.content) && /data-pfp-fx="skip"/.test(hit.content));
  g.check("it carries only ids: the item, the target token, the effect numbers", Object.keys(fx(hit)).sort().join() === "effects,itemUuid,state,targets,text,v" && fx(hit).targets[0] === g.token("Goblin A").uuid, JSON.stringify(Object.keys(fx(hit))));
  g.check("nothing in the card or its flag names a value, a save or a DC", !/Will|Fortitude|Reflex|\bDC\b|frightened|"value"/i.test(hit.content + JSON.stringify(fx(hit))));
  const none = await sendAll([g.attack("failure"), g.attack("criticalFailure"), g.attack("success", { type: "damage-roll" }), g.attack("criticalFailure", { item: "Bomb" })]);
  g.check("a miss, a critical failure, a damage roll and a bomb critical failure make no card", none.length === 0, none.length);
  const miss = await g.api.effects.handle(g.attack("failure", { item: "Bomb" }));
  g.check("a bomb miss makes a card that says so", /Gate G21 Mitflit Bomb missed Gate G21 Goblin A, but you can still apply it: makes the target sick\./.test(miss?.content ?? ""));
  const odd = await g.api.effects.handle(g.attack("success", { type: "spell-cast" }));
  g.check("a message the module cannot place makes the fallback card", fx(odd)?.fallback === true && fx(odd)?.targets.length === 0 && /could not place/.test(odd.content));
  const noTarget = await g.api.effects.handle(g.attack("success", { target: null }));
  g.check("a hit with no target at all makes the fallback card", fx(noTarget)?.fallback === true);
  g.check("exactly four cards were made", g.cards().length === 4, g.cards().length);
  return g.done();
})();
```


## Step 10 [GM]: Apply with forced saves, the unlinked token and two targets

**What to do and see:**
- Run the block below. It presses Apply for you on fresh cards, forcing the save result instead of rolling, so the outcome is known.
- You should see: `ALL PASS`.

```js
// [GM] Apply with a forced save degree: failure, critical failure, success; the condition on the TOKEN's actor; two targets; removing the conditions again.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  g.needTokens();
  const a = g.token("Goblin A").actor, worldA = g.world("A");
  const val = (actor, slug) => actor.getCondition(slug)?.value ?? (actor.getCondition(slug) ? "y" : null);
  const play = async degree => {
    await g.clear(a);
    const card = await g.api.effects.handle(g.attack("success"));
    const result = await g.api.effects.applyCard(card.id, { forceDegree: degree });
    return { card, result };
  };
  let r = await play("failure");
  g.check("a failed save: frightened at its value, and prone (no save) on the token's actor", val(a, "frightened") === 1 && val(a, "prone") === "y", g.conds(a));
  g.check("never on the world actor (an unlinked token has its own actor)", !worldA.getCondition("frightened") && !worldA.getCondition("prone"), g.conds(worldA));
  g.check("the card now shows a plain result and no buttons", /Goblin A is fearful, is knocked down\./.test(r.card.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")) && !/data-pfp-fx/.test(r.card.content));
  r = await play("criticalFailure");
  g.check("a critical failure puts frightened one higher", val(a, "frightened") === 2, g.conds(a));
  r = await play("success");
  g.check("a success: no frightened, but prone still applies by itself (no save)", val(a, "frightened") === null && val(a, "prone") === "y", g.conds(a));
  g.check("the result says it shrugged it off", /shrugs it off/.test(r.card.content));
  await g.clear(a);
  const draught = await g.api.effects.handle(g.use(["Goblin A", "Goblin B"]));
  g.check("a consumable use with two targets makes ONE card for both", g.cards().filter(c => c.getFlag(g.M, "fx").targets.length === 2).length === 1 && draught.content.includes("used on Gate G21 Goblin A and Gate G21 Goblin B"));
  g.check("the second use card within ten seconds makes no second card", (await g.api.effects.handle(g.use(["Goblin A", "Goblin B"]))) === null);
  await g.api.effects.applyCard(draught.id, { forceDegree: "failure" });
  const b = g.token("Goblin B").actor;
  g.check("both targets got dazzled", a.getCondition("dazzled") && b.getCondition("dazzled"), `${g.conds(a)} | ${g.conds(b)}`);
  g.check("Goblin B's token is linked, so it is the world actor too", g.world("B").getCondition("dazzled") !== null);
  const skipped = await g.api.effects.handle(g.attack("success"));
  await g.api.effects.skipCard(skipped.id);
  g.check("Skip closes a card and removes its buttons", /Skipped\./.test(skipped.content) && !/data-pfp-fx/.test(skipped.content));
  const log = g.api.gm.log({ kind: "effect" });
  g.check("the GM log holds the DC and the roll for the forced saves", log.some(e => /save vs DC \d+: (failure|criticalFailure|success)/.test(e.text)), log.length);
  g.check("no chat message carries a DC, a roll total or a save", !game.messages.some(m => /Gate G21/.test(m.content ?? "") && /\bDC\b|\btotal\b|Will|Fortitude|Reflex/i.test(m.content + JSON.stringify(m.flags?.[g.M] ?? {}))));
  await g.clear(a); await g.clear(b);
  g.check("the conditions can be taken off again", !a.getCondition("dazzled") && !b.getCondition("dazzled") && !a.getCondition("prone"), `${g.conds(a)} | ${g.conds(b)}`);
  return g.done();
})();
```


## Step 11 [GM]: mark the chat log and make the goblins hard to hit

**What to do and see:**
- Run the block below. It remembers which chat messages exist now, and sets both goblins' armor class very high.
- Make sure the **Player** window shows the scene with all three tokens.
- You should see: `ALL PASS`.

```js
// [GM] Starts the real-attack part: marks the chat log, makes the goblins very hard to hit, and checks the scene.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  g.needTokens();
  g.mark();
  await g.ac(40);
  await g.clear(g.token("Goblin A").actor); await g.clear(g.token("Goblin B").actor);
  g.check("the goblins are very hard to hit now", g.world("A").system.attributes.ac.value === 40 && g.world("B").system.attributes.ac.value === 40);
  g.check("the tokens are on the scene", ["Hero", "Goblin A", "Goblin B"].every(n => g.token(n)));
  return g.done();
})();
```


## Step 12 [Player]: strike and miss

**What to do and see:**
- In the **Player** window open the Actors tab and open **Gate G21 Hero**; open its **Actions** tab.
- Click the Hero's token on the canvas so it is controlled.
- Click the **Goblin A** token and press **T** (a target mark appears). Nothing else is targeted.
- Run the block below. You should see: `ALL PASS`.
- Click **Gate G21 Mitflit Sword**'s **Strike** button on the sheet, twice. Both will miss (the goblins are very hard to hit).

```js
// [Player] Preflight: the Hero is controlled and only Goblin A is targeted.
(() => {
  const rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const controlled = canvas.tokens.controlled.map(t => t.name), targeted = [...game.user.targets].map(t => t.name);
  check("the Hero's token is controlled", controlled.join() === "Gate G21 Hero", controlled.join() || "nothing");
  check("only Goblin A is targeted", targeted.join() === "Gate G21 Goblin A", targeted.join() || "nothing");
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 13 [GM]: misses make no card

**What to do and see:**
- Run the block below.
- You should see: `ALL PASS`. It makes the goblins easy to hit for the next step.

```js
// [GM] No card for the misses; then the goblins are easy to hit (armor class 1).
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const strikes = game.messages.filter(m => !g.seen.has(m.id) && m.flags?.pf2e?.context?.type === "attack-roll");
  g.check("the Player's strikes reached the chat", strikes.length >= 2, strikes.length);
  g.check("none of them was a hit", strikes.every(m => ["failure", "criticalFailure"].includes(m.flags.pf2e.context.outcome)), strikes.map(m => m.flags.pf2e.context.outcome).join());
  g.check("and there is NO effect card", g.cards().length === 0, g.cards().length);
  await g.ac(1);
  g.mark();
  return g.done();
})();
```


## Step 14 [Player]: strike and hit

**What to do and see:**
- In the **Player** window, keep the Hero controlled and Goblin A as the only target.
- Click **Gate G21 Mitflit Sword**'s **Strike** button once. It will hit (or crit).
- Do not roll damage.
- You should see: a normal PF2e attack card in the chat. The Player window shows no effect card.

```js
// [Player] Preflight: the Hero is controlled and only Goblin A is targeted.
(() => {
  const rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const controlled = canvas.tokens.controlled.map(t => t.name), targeted = [...game.user.targets].map(t => t.name);
  check("the Hero's token is controlled", controlled.join() === "Gate G21 Hero", controlled.join() || "nothing");
  check("only Goblin A is targeted", targeted.join() === "Gate G21 Goblin A", targeted.join() || "nothing");
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 15 [GM]: one card for the hit; press Apply

**What to do and see:**
- Look at the GM chat. You should see: ONE new whispered card, "Gate G21 Mitflit Sword hit Gate G21 Goblin A: makes the target fearful and knocks the target down." with **Apply** and **Skip**.
- Press **Apply** on that card, once. The buttons turn off while it works.
- You should see: the card changes to a plain result ("Gate G21 Goblin A is fearful, is knocked down." or "Gate G21 Goblin A shrugs it off, is knocked down.").
- Run the block below. You should see: `ALL PASS`.

```js
// [GM] The real hit: one card, Apply rolled the save in secret on the token's actor, prone applied without a save, the log has the DC and the roll.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const cards = g.cards();
  g.check("exactly one card for the hit", cards.length === 1, cards.length);
  const card = cards[0];
  if (!card) return g.done();
  const fx = card.getFlag(g.M, "fx"), a = g.token("Goblin A").actor;
  g.check("it was applied (press Apply on the card first if this fails)", fx.state === "done", fx.state);
  g.check("the result is plain words", /Gate G21 Goblin A (is fearful|shrugs it off), is knocked down\./.test(card.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")), card.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(-120));
  g.check("prone is on the TOKEN's actor, not the world actor", a.getCondition("prone") && !g.world("A").getCondition("prone"), `${g.conds(a)} | world ${g.conds(g.world("A"))}`);
  const log = g.api.gm.log({ kind: "effect" });
  g.check("the GM log has the secret save (DC and roll)", log.some(e => /will save vs DC \d+: (criticalFailure|failure|success|criticalSuccess) \(total \d+\)/.test(e.text)), log[0]?.text);
  g.check("no chat message names a DC, a total or a save", !game.messages.some(m => /Gate G21/.test(m.content ?? "") && /\bDC\b|\btotal\b|Will|Fortitude|Reflex/i.test(m.content + JSON.stringify(m.flags?.[g.M] ?? {}))));
  return g.done();
})();
```


## Step 16 [Player]: throw the bomb

**What to do and see:**
- In the **Player** window, keep the Hero controlled and Goblin A as the only target.
- Click **Gate G21 Mitflit Bomb**'s **Strike** button once. The goblins are easy to hit, so it hits.
- You should see: a normal PF2e attack card, and no effect card in the Player window.

```js
// [Player] Preflight: the Hero is controlled and only Goblin A is targeted.
(() => {
  const rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const controlled = canvas.tokens.controlled.map(t => t.name), targeted = [...game.user.targets].map(t => t.name);
  check("the Hero's token is controlled", controlled.join() === "Gate G21 Hero", controlled.join() || "nothing");
  check("only Goblin A is targeted", targeted.join() === "Gate G21 Goblin A", targeted.join() || "nothing");
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 17 [GM]: one card for the bomb

**What to do and see:**
- Press **Apply** on the new "Gate G21 Mitflit Bomb hit Gate G21 Goblin A: makes the target sick." card.
- Run the block below. You should see: `ALL PASS`.
- The block then makes the goblins hard to hit again; Step 18's Player strike is a critical failure and must make no card.

```js
// [GM] The real bomb throw: one card; applied; then the goblins are hard to hit again so the next throw is a critical failure.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const bombs = g.cards().filter(c => /Mitflit Bomb/.test(c.getFlag(g.M, "fx").text));
  g.check("exactly one card for the bomb", bombs.length === 1, g.cards().length);
  const fx = bombs[0]?.getFlag(g.M, "fx");
  g.check("it was applied (press Apply on the card first if this fails)", fx?.state === "done", fx?.state);
  g.check("the result is plain words", /Gate G21 Goblin A (is sick|shrugs it off)\./.test((bombs[0]?.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")));
  await g.ac(40);
  g.mark();
  return g.done();
})();
```


## Step 18 [Player]: throw the bomb and miss badly

**What to do and see:**
- In the **Player** window, click **Gate G21 Mitflit Bomb**'s **Strike** button once more with Goblin A targeted. It misses by a lot (a critical failure).
- You should see: a normal PF2e attack card and no effect card.

```js
// [Player] Preflight: the Hero is controlled and only Goblin A is targeted.
(() => {
  const rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const controlled = canvas.tokens.controlled.map(t => t.name), targeted = [...game.user.targets].map(t => t.name);
  check("the Hero's token is controlled", controlled.join() === "Gate G21 Hero", controlled.join() || "nothing");
  check("only Goblin A is targeted", targeted.join() === "Gate G21 Goblin A", targeted.join() || "nothing");
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 19 [GM]: no card for a critical failure

**What to do and see:**
- Run the block below.
- You should see: `ALL PASS`. The goblins' armor class is 40, so the throw was a critical failure, and a critical failure of a bomb throw makes no card.

```js
// [GM] A bomb critical failure makes no card.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const throws = game.messages.filter(m => !g.seen.has(m.id) && m.flags?.pf2e?.context?.type === "attack-roll");
  g.check("the Player's throw reached the chat", throws.length >= 1, throws.length);
  g.check("it was a critical failure", throws.every(m => m.flags.pf2e.context.outcome === "criticalFailure"), throws.map(m => m.flags.pf2e.context.outcome).join());
  g.check("and there is NO effect card", g.cards().length === 0, g.cards().length);
  g.mark();
  return g.done();
})();
```


## Step 20 [Player]: use the consumable on one target

**What to do and see:**
- In the **Player** window, keep Goblin A as the only target.
- On the Hero's sheet open the **Inventory** tab, find **Gate G21 Mitflit Draught** and press its **Use** (hand) button. Confirm any prompt.
- If the sheet shows a second card with a **Use** button, press it too.
- If no Use button appears, tell me; PF2e may need a real consumable. I will give you a one-line change that marks any real consumable as crafted.
- You should see: normal PF2e cards, and no effect card in the Player window.

```js
// [Player] Preflight: only Goblin A is targeted.
(() => {
  const rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const targeted = [...game.user.targets].map(t => t.name);
  check("only Goblin A is targeted", targeted.join() === "Gate G21 Goblin A", targeted.join() || "nothing");
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 21 [GM]: one card for the use, not two

**What to do and see:**
- Look at the GM chat. You should see: ONE new whispered card, "Gate G21 Mitflit Draught was used on Gate G21 Goblin A: dazzles the target." even though PF2e posted more than one message for the use.
- Press **Apply** on it.
- Run the block below. You should see: `ALL PASS`.
- Then wait 15 seconds before Step 22.

```js
// [GM] The real consumable use: ONE card, applied, the condition on the token's actor.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  const consumable = game.messages.filter(m => !g.seen.has(m.id) && m.flags?.pf2e?.origin?.type === "consumable");
  g.check("PF2e posted at least one consumable message", consumable.length >= 1, consumable.length);
  g.check("there is exactly ONE effect card", g.cards().length === 1, g.cards().length);
  const card = g.cards()[0];
  const fx = card?.getFlag(g.M, "fx");
  g.check("it names Goblin A", fx?.targets?.length === 1 && fx.targets[0] === g.token("Goblin A").uuid);
  g.check("it was applied (press Apply on the card first if this fails)", fx?.state === "done", fx?.state);
  g.check("the result is plain words", /Gate G21 Goblin A (is dazzled|shrugs it off)\./.test((card?.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")));
  g.mark();
  return g.done();
})();
```


## Step 22 [Player]: use the consumable with nothing targeted

**What to do and see:**
- Wait at least 15 seconds after Step 21.
- In the **Player** window, clear every target (press **U**, or click an empty part of the canvas).
- On the Hero's sheet press **Use** on **Gate G21 Mitflit Draught** again.
- You should see: normal PF2e cards, and no effect card in the Player window.

```js
// [Player] Preflight: nothing is targeted.
(() => {
  const rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  check("nothing is targeted", game.user.targets.size === 0, [...game.user.targets].map(t => t.name).join());
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 23 [GM]: the fallback card, then two targets

**What to do and see:**
- Look at the GM chat. You should see: ONE new whispered card, "Gate G21 Mitflit Draught was used, but no one is targeted. Target or select who it affects, then press Apply: dazzles the target."
- Press **Apply** with nothing targeted. You should see: a warning "Target or select a token first, then press Apply." and the card keeps its buttons.
- In the **GM** window click the **Goblin A** token and press **T**, then click the **Goblin B** token and press **T** too (Shift-click to keep both), so both are targeted.
- Press **Apply** on the card. Each goblin's reflex save is rolled for real and in secret, so a goblin may be dazzled or may shrug it off; the block reads the GM log to learn which, and then checks the card and the condition against that.
- Run the block below. You should see: `ALL PASS`.
- Note: the pipeline forces the saves for this step (Goblin A fails, Goblin B passes), and the block then also checks that exactly that happened.

```js
// [GM] The fallback card: no target at first; applied to the GM's own two targets.
await (async () => {
  const g = globalThis.__g21;
  if (!g) throw new Error("Run Step 2 (SETUP) first");
  g.check("exactly one new card", g.cards().length === 1, g.cards().length);
  const card = g.cards()[0], fx = card?.getFlag(g.M, "fx");
  g.check("it is the fallback card, with no target on it", fx?.fallback === true && fx.targets.length === 0);
  g.check("it was applied to the GM's targets (press Apply with both goblins targeted first if this fails)", fx?.state === "done", fx?.state);
  const text = (card?.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const degreeOf = who => { const entry = g.api.gm.log({ kind: "effect" }).find(e => e.actorName === `Gate G21 ${who}` && /Draught/.test(e.text)); return { degree: (entry?.text.match(/save vs DC \d+: (\w+)/) ?? [])[1] ?? null, entry: entry?.text ?? null }; };
  const lineFor = degree => (degree === "failure" || degree === "criticalFailure" ? "is dazzled." : degree ? "shrugs it off." : null);
  const A = degreeOf("Goblin A"), B = degreeOf("Goblin B");
  const sentence = who => (text.match(new RegExp(`Gate G21 ${who} (is dazzled|shrugs it off)\\.`)) ?? [])[0] ?? null;
  const expectA = lineFor(A.degree) && `Gate G21 Goblin A ${lineFor(A.degree)}`, expectB = lineFor(B.degree) && `Gate G21 Goblin B ${lineFor(B.degree)}`;
  const values = JSON.stringify({ logA: A.entry, logB: B.entry, degreeA: A.degree, degreeB: B.degree, expectA, expectB, sentenceA: sentence("Goblin A"), sentenceB: sentence("Goblin B"), forcedMixed: g.forcedMixed === true, dazzledA: Boolean(g.token("Goblin A").actor.getCondition("dazzled")), dazzledB: Boolean(g.token("Goblin B").actor.getCondition("dazzled")), text: text.slice(-200) });
  g.check("each goblin's save was rolled once for the Draught (both are in the GM log)", Boolean(A.degree) && Boolean(B.degree), values);
  g.check("Goblin A's line is exactly the one its save result gives", sentence("Goblin A") === expectA, values);
  g.check("Goblin B's line is exactly the one its save result gives", sentence("Goblin B") === expectB, values);
  g.check("a goblin that failed its save has the condition (Goblin A may already have it from Step 20 if it passed)", (lineFor(A.degree) !== "is dazzled." || Boolean(g.token("Goblin A").actor.getCondition("dazzled"))) && (lineFor(B.degree) !== "is dazzled." || Boolean(g.token("Goblin B").actor.getCondition("dazzled"))), values);
  g.check("Goblin B passed its save, so it does not have the condition", lineFor(B.degree) !== "shrugs it off." || !g.token("Goblin B").actor.getCondition("dazzled"), values);
  if (g.forcedMixed) g.check("forced run: Goblin A failed and Goblin B passed, so exactly one goblin is dazzled by this card", A.degree === "failure" && B.degree === "success" && sentence("Goblin A") === "Gate G21 Goblin A is dazzled." && sentence("Goblin B") === "Gate G21 Goblin B shrugs it off.", values);
  g.check("Goblin B's token is linked, so the world actor is the same one", g.token("Goblin B").actor === g.world("B"));
  return g.done();
})();
```


## Step 24 [Player]: the save stayed secret

**What to do and see:**
- In the **Player** window run the block below.
- You should see: `ALL PASS`. It reads every effect card this client holds (a whisper is delivered to every client, and the Player can read it from the console) and the visible chat log, looking for a DC, a roll total, a save type or a condition's value.

```js
// [Player] Nothing the GM's cards or saves put in the chat names a DC, a total, a save or a condition value.
(() => {
  const M = "pathfinder-progress", rows = [], check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const ours = game.messages.filter(m => m.flags?.[M]?.fx);
  const secret = /\bDC\b|\btotal\b|\bWill\b|\bFortitude\b|\bReflex\b|"(save|saveType|condition|conditionValue|dc)"\s*:|"value"\s*:/;
  check("the GM's cards reached this client (whispers are delivered to everyone)", ours.length >= 1, ours.length);
  check("none of them names a DC, a total, a save or a condition value", ours.every(m => !secret.test(m.content + JSON.stringify(m.flags?.[M]))), ours.length);
  check("and the visible chat log shows no effect card at all", document.querySelectorAll("#chat .pfp-fx-card").length === 0);
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 25 [GM]: CLEANUP

**What to do and see:**
- Nothing to click.
- Run the block below. It removes everything the gate made and puts back what it changed. Safe to run twice, and safe after a reload (it does not need the in-memory definitions or the globals).
- You should see: `problems: []` and every `...Left` count `0`.

```js
// [GM] CLEANUP: deletes everything the gate made. Safe to run twice, and safe after a reload.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const actors = game.actors.filter(a => /^Gate G21 /.test(a.name) && a.getFlag(M, "gateThrowaway21") === true);
  const ids = new Set(actors.map(a => a.id));
  await attempt("the effect cards", async () => {
    const del = game.messages.filter(m => m.getFlag?.(M, "fx") && /Gate G21/.test(m.content ?? "")).map(m => m.id);
    if (del.length) await ChatMessage.deleteDocuments(del);
  });
  await attempt("the tokens", async () => {
    for (const scene of game.scenes) {
      const del = scene.tokens.filter(t => /^Gate G21 /.test(t.name) || ids.has(t.actorId)).map(t => t.id);
      if (del.length) await scene.deleteEmbeddedDocuments("Token", del);
    }
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  for (const key of Object.keys(api.editor.records()).filter(k => /:gate-g21-/.test(k))) await attempt(`remove ${key}`, () => api.editor.remove(key));
  await attempt("stray world items", async () => { for (const item of game.items.filter(i => /^Gate G21 /.test(i.name))) await item.delete(); });
  await attempt("the Materials folder the gate created", async () => {
    const folder = game.folders.find(f => f.type === "Item" && f.name === "Materials");
    if (folder && !(user?.getFlag(M, "gateSetup21")?.foldersBefore ?? ["Materials"]).includes("Materials") && !game.items.some(i => (i.folder?.id ?? i.folder) === folder.id)) await folder.delete();
  });
  for (const [kind, id] of [["material", "g21-iron"], ["material", "g21-mitflit"], ["recipe", "g21-sword"], ["recipe", "g21-bomb"], ["recipe", "g21-potion"]]) api.definitions?.[kind]?.delete(id);
  await attempt("the audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup21") !== undefined) await user.unsetFlag(M, "gateSetup21"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  const window = foundry.applications.instances.get("pathfinder-progress-item-editor");
  if (window) await window.close();
  api.gm.clearLog();
  delete globalThis.__g21;
  return {
    problems,
    actorsLeft: game.actors.filter(a => /^Gate G21 /.test(a.name)).length,
    tokensLeft: game.scenes.reduce((n, s) => n + s.tokens.filter(t => /^Gate G21 /.test(t.name)).length, 0),
    itemsLeft: game.items.filter(i => /^Gate G21 /.test(i.name)).length,
    recordsLeft: Object.keys(api.editor.records()).filter(k => /gate-g21/.test(k)).length,
    cardsLeft: game.messages.filter(m => m.getFlag?.(M, "fx") && /Gate G21/.test(m.content ?? "")).length,
    audit: api.audit.scan()
  };
})();
```
