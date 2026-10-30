# 17 Stage 11a gate (real Foundry): the Downtime Hub window, and the chat leak fix (v0.18.0)

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. This gate is mostly a **click-through**: steps labelled **[Player]** without a code block are things to open, click and look at, and each ends with exactly what you should see. A few steps have ONE code block (SETUP, CLEANUP, the GM's nudges, two console checks). Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. Where a step says **"send me a screenshot of ..."**, that is because layout is the point and a test cannot see it. The steps are in groups; do a group or two at a time.

`tests/gate17.test.js` runs every code block below, in order, in a fake Foundry and plays the click-through steps through the same code the window uses. `docs/screens/` holds screenshots of the window drawn with throwaway data in Chromium (all three colour themes, 100% and 175% text, wide and narrow), so the layout was already looked at before you start. What no test can show is the real Foundry window: the two buttons, real resizing, real focus rings, real fonts, and how a screen reader reads it.

**What the gate shows** (the decisions in `docs/11-hub-design.md`, with `docs/11b-hub-addendum.md` winning):
- **Leak fix.** Totals, DCs and hidden rolls are no longer in ANY chat message (not even a GM-only whisper, which Foundry still hands to every client). The GM reads them with `api.gm.log()` (memory only on the GM's client, never saved).
- **The Hub.** Opens from the scene controls and from the character sheet. One character at a time with a switcher. Status strip, six tabs (only Formulae works), the Formulae list and the craft form: every slot starts EMPTY, only materials you have AND have met are offered, an effect is shown only if you have learned it, "What you will get", workshops with their fees, a Queue button that says why it is off. It redraws by itself for the character it shows, without flicker. Display settings: text size, colours, easy-read font. Keyboard only.

**Safety.** Everything uses throwaway things named "Gate ...": the characters **Gate Smith** and **Gate Friend** (both owned by the user "Test"), and in-memory fake definitions (`g5-town`, `g5-away`, `g5-ore`, `g5-steel`, `g5-ember`, `g5-star`, `g5-moon`, `g5-bench`, `g5-forge`, `g5-blade`, `g5-vest`, `g5-draught`); they exist only until you reload the GM window, and SETUP registers them again and publishes them to the Player. No real campaign recipe is used. SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, a "Gate ..." actor exists that it did not make, or an earlier run left something behind. CLEANUP always works, is safe to run twice, and also removes the shared Compendium entries the gate wrote.

**Restart note.** This release adds a stylesheet and a font to the module manifest, so after updating the module **restart the Foundry server** (not just reload the page) and relaunch the world.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.18.0**; if it is not, stop (the release may still be building).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.18.0"]` in the GM window and `["Test", false, "0.18.0"]` in the Player window.

## Step 2 [GM]: SETUP

Safe to run again at any time: after a reload of the GM window the fake definitions and the `globalThis.__g5` helper are gone, and running SETUP again re-registers them, publishes them to the players and REBUILDS the helper.

```js
// [GM] SETUP: fake definitions (memory only), Gate Smith (holds g5-blade and g5-vest, is researching g5-draught) + Gate Friend (holds nothing), two workshops in Gate Town, the party there, 12 days of downtime.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway5") === true;
  const [smithOld, friendOld] = [game.actors.getName("Gate Smith"), game.actors.getName("Gate Friend")];
  if (![smithOld, friendOld].every(mine)) throw new Error('"Gate Smith" or "Gate Friend" already exists and was not made by this check; rename or delete it first');

  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const output = { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger };
  const common = { output, craftLevel: 2, stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } };
  const defs = [
    ["town", { kind: "town", id: "g5-town", name: "Gate Town" }],
    ["town", { kind: "town", id: "g5-away", name: "Gate Away" }],
    ["material", { kind: "material", id: "g5-ore", name: "Gate Ore", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g5-steel", name: "Gate Steel", tier: 2, effects: { basePower: "T2", bonusDamage: { dice: "1d4", type: "fire" } } }],
    ["material", { kind: "material", id: "g5-ember", name: "Gate Ember", tier: 2, effects: { bonusDamage: { dice: "1d6", type: "fire" } } }],
    ["material", { kind: "material", id: "g5-star", name: "Gate Star", tier: 3, effects: { basePower: "T3", bonusDamage: { dice: "1d8", type: "spirit" } } }],
    ["material", { kind: "material", id: "g5-moon", name: "Gate Moonglass", tier: 2, effects: { basePower: "T2" } }],
    ["station", { kind: "station", id: "g5-bench", name: "Gate Bench", category: "smithing", tier: 1, town: "g5-town" }],
    ["station", { kind: "station", id: "g5-forge", name: "Gate Forge", category: "smithing", tier: 2, town: "g5-town" }],
    ["recipe", { ...common, kind: "recipe", category: "weapon", id: "g5-blade", name: "Gate Blade", stationCategory: "smithing", slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "edge", drives: "bonusDamage", tierFloor: 2, qty: 1 }] }],
    ["recipe", { ...common, kind: "recipe", category: "armor", id: "g5-vest", name: "Gate Vest", stationCategory: "smithing", slots: [{ name: "hide", drives: "basePower", tierFloor: 1, qty: 2 }] }],
    ["recipe", { ...common, kind: "recipe", category: "weapon", id: "g5-draught", name: "Gate Draught", stationCategory: "smithing", slots: [{ name: "base", drives: "basePower", tierFloor: 1, qty: 1 }] }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids,
      smith: () => game.actors.get(ids.smith), friend: () => game.actors.get(ids.friend),
      queued: actor => actor.getFlag(M, "pendingActions") ?? [],
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g5 = g;
    return g;
  };

  if (smithOld || friendOld) {
    if (!(smithOld && friendOld)) throw new Error("part of the gate is missing (a character was deleted): run CLEANUP (the last step), then SETUP again");
    build({ smith: smithOld.id, friend: friendOld.id });
    return { already: "set up", rebuilt: "the definitions and globalThis.__g5", published: await api.publishDefinitions() };
  }

  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const shared = game.settings.get(M, "sharedCompendium") ?? {};
  if (["experiments", "materials"].some(k => Object.keys(shared[k] ?? {}).some(id => id.startsWith("g5-")))) throw new Error("an earlier run left shared Compendium entries: run CLEANUP (the last step) first");
  const published = await api.publishDefinitions();

  const flags = { [M]: { gateThrowaway5: true } };
  const owned = { default: 0, [test.id]: 3 };
  const smith = await Actor.create({ name: "Gate Smith", type: "character", ownership: owned, flags });
  const friend = await Actor.create({ name: "Gate Friend", type: "character", ownership: owned, flags });
  await api.giveMaterial(smith, "g5-ore", 6);
  await api.giveMaterial(smith, "g5-steel", 3);
  await api.giveMaterial(smith, "g5-ember", 1);      // ONE: the vest's Hide needs 2, so it is "not enough"
  await api.giveMaterial(smith, "g5-star", 4);
  await api.giveMaterial(smith, "g5-moon", 2);       // in the bag, but the character has never met it: it must not be offered
  // The Compendium records what it sees in the bag a moment later; wait for that, then make the character forget Gate Moonglass.
  const seen = async () => { const end = Date.now() + 6000; while (Date.now() < end) { if (smith.getFlag(M, "compendium")?.materials?.["g5-moon"]) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
  await seen();
  await smith.update({ [`flags.${M}.compendium.materials.g5-moon`]: new foundry.data.operators.ForcedDeletion() });
  await api.adapter.addCopper(smith, 10000);
  await api.grantFormula(smith, "g5-blade");          // owning a formula reveals its baseline: Gate Ore for the body, Gate Ember for the edge
  await api.grantFormula(smith, "g5-vest");
  const project = await api.startProject({ actor: smith, recipe: "g5-draught" });
  await api.addProgress(smith, project.id, 1, "gate setup");
  await test.setFlag(M, "gateOriginalLocation5", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g5-town");
  await test.setFlag(M, "gateOriginalCharacter", test.character?.id ?? "none");
  await test.update({ character: smith.id });
  await api.downtime.start({ days: 12, actorIds: [smith.id, friend.id] });

  build({ smith: smith.id, friend: friend.id });
  return { smith: smith.name, friend: friend.name, published, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object naming Gate Smith and Gate Friend, `testUsersCharacter: "Gate Smith"` and a `published` revision. On a rerun it says `already: "set up"`.

## Step 3 [Player]: check the module is ready (and the first load of definitions)

```js
// [Player] the Hub exists and this window has its definitions from the GM.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const smith = game.actors.getName("Gate Smith");
  if (game.user.isGM || !smith?.isOwner) throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  await api.definitions.refresh();
  check("the Hub can be opened from the console too", typeof api.hub?.open === "function");
  check("this window has its definitions", api.definitionsStatus().status === "ready", api.definitionsStatus().status);
  check("it holds the formulae and nothing it should not", api.formulasFor(smith).map(f => f.recipeId).sort().join() === "g5-blade,g5-vest", api.formulasFor(smith).map(f => f.recipeId).join());
  check("it can read the recipe but not a craft level", Boolean(api.definitions.recipe.get("g5-blade")) && api.definitions.recipe.get("g5-blade").craftLevel === undefined);
  check("a GM-only call is refused", (() => { try { api.gm.log(); return false; } catch (error) { return /GM only/.test(error.message); } })());
  console.log(rows.join("\n"));
  return rows.every(r => r.startsWith("PASS")) ? "ALL PASS" : `${rows.filter(r => r.startsWith("FAIL")).length} FAILED: scroll up for the lines`;
})();
```

## Group A: opening it

## Step 4 [Player]: open it from the scene controls

Look at the toolbar on the left of the screen. Click the **Token** controls group (the first one). At the bottom of its tools there should be a button with an **hourglass** and the tooltip **Downtime**. Click it.

**What you should see:** a window titled **Downtime: Gate Smith** opens, with the **Display** button at the top right of its content, a status strip, a row of tabs, and the **Formulae** tab showing. Click the hourglass again: the SAME window comes to the front (it does not open a second one).

**Send me a screenshot of the window as it first opens** (wide, nothing clicked). If there is no hourglass button anywhere in the scene controls, send me a screenshot of the left toolbar and say which groups you can see.

## Step 5 [Player]: open it from the character sheet

Close the Hub window. Open **Gate Smith**'s character sheet. Look in the sheet's header (the title bar, and the "..." or controls menu there) for a button called **Downtime**. Click it.

**What you should see:** the same Hub window opens for Gate Smith. If the sheet has no such button, that is a finding, not a failure of the rest of the gate: **send me a screenshot of Gate Smith's sheet header and its controls menu** and carry on using the scene button.

## Step 6 [Player]: switch character

In the Hub, click **Switch character**.

**What you should see:** a panel titled **Whose downtime?** with two buttons, **Gate Smith** (marked "selected") and **Gate Friend**. Click **Gate Friend**: the title becomes **Downtime: Gate Friend**, the Formulae list says this character doesn't know any formulae yet, and the days read **12 free, 0 reserved**. Open Switch character again and click **Gate Smith** to go back.

## Group B: looking around

## Step 7 [Player]: the status strip and the tabs

**What you should see:**
- **Downtime days:** `12 free, 0 reserved`.
- **Party location:** `Gate Town`, with `Workshops here: Gate Bench, Gate Forge`.
- **Waiting on the GM:** `Nothing queued`, and a **View queue** button.
- A row of six tabs: **Formulae**, then **Research (coming later)**, **Commissions (coming later)**, **Explore (coming later)**, **Workshop (coming later)**, **Compendium (coming later)**. Click **Research**: the body says **Coming in a later stage**. Click **Formulae** to go back.

## Step 8 [Player]: the list and the filter chips

**What you should see:** three cards in the left pane: **Gate Blade** (Known), **Gate Vest** (Known) and **Gate Draught** (Researching, with a progress bar and "Progress 1 of ..."), and under Gate Draught a dashed **Open in Research** button that does nothing and says why. The chips read **All 3**, **Weapon 1**, **Armor 1**, **Consumable 0**. Click **Weapon**: only Gate Blade. **Armor**: only Gate Vest. **Consumable**: "No formulae in this group." **All**: all three. (A formula you are still researching shows under **All** only: you have not learned what kind of thing it is yet, so no group claims it.)

## Step 9 [Player]: every slot starts empty

Click **Gate Blade**.

**What you should see:**
- Two boxes, **Body** ("Body sets the weapon's power.") and **Edge** ("Edge adds bonus damage."), both saying **Nothing chosen yet**. **Nothing is marked "selected" anywhere.**
- Body offers **Gate Ore**, **Gate Ember**, **Gate Steel** and **Gate Star**; Edge offers **Gate Ember**, **Gate Steel** and **Gate Star** (it needs tier 2 or better). **Gate Moonglass is not offered anywhere** (it is in the bag but you have never met it).
- Each option shows its tier and its stock, for example **Uses 1 of 6** for Gate Ore.
- Click **Gate Vest** and back to **Gate Blade**: the slots are empty again (choosing a formula never fills anything).

## Step 10 [Player]: effects you have learned, and ones you have not

Still on Gate Blade.

**What you should see:**
- Under **Gate Ore** (Body): "**Gate Ore sets the weapon's power (tier 1)**" (you know it because owning the formula shows its basic recipe).
- Under **Gate Ember** (Edge): "**Gate Ember adds +1d6 fire damage**".
- Under **Gate Steel** and **Gate Star** in both boxes: "**You haven't tried this here yet**". Never "???", never a blank, and no numbers other than the tiers.

## Step 11 [Player]: What you will get, and the workshops

Click **Gate Ore** in Body and **Gate Steel** in Edge. Scroll down in the right pane.

**What you should see:**
- Each chosen option is outlined and carries a **SELECTED** badge, and the box says "Using Gate Ore" / "Using Gate Steel".
- A **Workshop** section with **Gate Bench** (Tier 1, "Gate Town · 1 gp", badges **Cheapest** and **selected**) and **Gate Forge** (Tier 2, "Gate Town · 5 gp").
- A **What you will get** box: the result is **A tier 1 Gate Blade** (you know the Body), a line "Gate Ore sets the weapon's power (tier 1)", a line "**Edge, Gate Steel: You haven't tried this here yet**", "**Station fee: 1 gp at Gate Bench**", "**Takes N days**" (note the number N), **Materials used:** `1 × Gate Ore`, `1 × Gate Steel`, and the sentence "**A failed craft can lose some materials and teaches you nothing.**" There is no percentage, no odds and no "DC" anywhere.
- Click **Gate Forge**: the fee line becomes "Station fee: 5 gp at Gate Forge". Click **Gate Bench** again.
- The **Queue the craft** button is solid (on) and **Ask a crafter instead** is dashed with the line "Commissions arrive in a later stage."

**Send me a screenshot of the whole right pane for this step** (scroll if needed, or make the window taller).

## Group C: why a button is off

## Step 12 [Player]: an empty slot, and not enough of a material

1. Click **Empty this slot** under Edge. **What you should see:** the **Queue the craft** button turns dashed (off) and the line under it says "**Choose a material for every slot first.**" Click it anyway: nothing happens and nothing appears in "Waiting on the GM".
2. Click **Gate Vest**, then click **Gate Ember** under Hide (the vest needs 2 and you have ONE). **What you should see:** the Gate Ember option reads "**Not enough.** Need 2, you have 1" (the word is there as well as the red), and the button is off with "**You don't have enough Gate Ember.**" Click **Gate Ember** again (it empties). Click **Gate Blade**, choose **Gate Ore** for Body and **Gate Steel** for Edge again.

## Step 13 [GM]: close downtime

```js
// [GM] end the downtime period. Nothing is queued, so it ends cleanly. The Player window should notice by itself within a second or two.
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const result = await g.api.downtime.end({});
  g.check("downtime ended", !g.api.downtime.isOpen(), JSON.stringify(result));
  return g.done();
})();
```

## Step 14 [Player]: the window follows by itself (do not click anything first)

**What you should see within a second or two, without touching the window:** a boxed notice in the status strip "**Downtime isn't open right now.** You can look around, but anything that uses days is switched off until the GM opens downtime." The **Queue the craft** button is off with the line "**Downtime isn't open right now**". You can still click around the formulae and slots.

## Step 15 [GM]: open downtime for Gate Friend only

```js
// [GM] a period that Gate Smith is not part of.
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.downtime.start({ days: 5, actorIds: [g.friend().id] });
  g.check("a period is open", g.api.downtime.isOpen());
  g.check("Gate Smith is not in it", !g.api.downtime.state().participants[g.smith().id]);
  return g.done();
})();
```

## Step 16 [Player]: you weren't here for it

**What you should see:** the notice now says "**Downtime is open, but you weren't here for it.**" and the Queue button's line says the same.

## Step 17 [GM]: reopen for both, then move the party to a town with no workshop

```js
// [GM] back to both characters with 12 days, and the party in Gate Away (no workshop there).
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.downtime.end({});
  for (const actor of [g.smith(), g.friend()]) await g.api.setDays(actor, 0);
  await g.api.downtime.start({ days: 12, actorIds: [g.smith().id, g.friend().id] });
  await g.api.setLocation("g5-away");
  g.check("open for both", Object.keys(g.api.downtime.state().participants).length === 2);
  g.check("12 days each", g.api.days(g.smith()) === 12 && g.api.days(g.friend()) === 12, g.api.days(g.smith()));
  return g.done();
})();
```

## Step 18 [Player]: no workshop within reach

**What you should see, by itself:** **Party location: Gate Away** with "**No workshops here**"; the Workshop section of the craft says "**No workshop you can use is within reach for this.**"; and the Queue button is off with that same line (when both slots are chosen). Downtime is open again, so the gate notice is gone.

## Step 19 [GM]: put the party back in Gate Town

```js
// [GM] the party returns to Gate Town (the workshops are back in reach).
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.setLocation("g5-town");
  g.check("the party is in Gate Town", game.settings.get(g.M, "partyLocation") === "g5-town");
  return g.done();
})();
```

## Group D: queueing, learning, and the chat

## Step 20 [Player]: queue a craft

With **Gate Ore** in Body and **Gate Steel** in Edge, and Gate Bench chosen, click **Queue the craft**.

**What you should see:** a line at the bottom of the window (also read out by a screen reader): "**Craft queued: Gate Blade. N days reserved.**" (the same N as before). The slots are empty again. The status strip now says **Downtime days: (12 - N) free, N reserved** and **Waiting on the GM: 1 queued**. Click **View queue**: a panel **Your queue** lists the craft with "N days reserved" and a **Cancel** button.

## Step 21 [GM]: resolve it as a success

```js
// [GM] resolve the queued craft with a forced success (a real resolve rolls; the gate forces the result).
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = g.queued(smith).find(a => a.type === "craft");
  g.check("a craft is queued", Boolean(action));
  const out = await g.api.queue.resolve(smith, action.id, { degree: "success", chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  const log = g.api.gm.log({ kind: "craft" });
  g.check("the GM log has the craft detail", log.length >= 1 && log[0].detail.degree === "success", JSON.stringify(log[0]?.detail));
  return g.done();
})();
```

## Step 22 [Player]: you learned something (do not close or reload the window)

**What you should see, without touching the window:** the queue is empty again ("Nothing queued"). On Gate Blade, under **Edge**, **Gate Steel** now says "**Gate Steel adds +1d4 fire damage**" instead of "You haven't tried this here yet". Under **Body**, **Gate Steel** STILL says "You haven't tried this here yet" (what you learn is per slot and per material). Choose **Gate Ore** and **Gate Steel** again: **What you will get** lists "Edge: Gate Steel adds +1d4 fire damage" and no unlearned effect.

## Step 23 [Player]: queue a second craft that will fail

Choose **Gate Ore** (Body) and **Gate Star** (Edge), then click **Queue the craft**. **What you should see:** the same "Craft queued" line and "1 queued".

## Step 24 [GM]: resolve it as a failure

```js
// [GM] a forced failure: it teaches nothing.
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = g.queued(smith).find(a => a.type === "craft");
  g.check("a craft is queued", Boolean(action));
  const out = await g.api.queue.resolve(smith, action.id, { degree: "failure", chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  const experiments = smith.getFlag(g.M, "compendium")?.experiments?.["g5-blade"]?.slots ?? {};
  g.check("Gate Star is still not learned for the edge", !experiments.edge?.["g5-star"], JSON.stringify(Object.keys(experiments.edge ?? {})));
  return g.done();
})();
```

## Step 25 [Player]: a failed craft teaches nothing

**What you should see:** under **Edge**, **Gate Star** still says "**You haven't tried this here yet**". Some Gate Ore or Gate Star may be gone from the stock lines (a failed craft can lose some materials); that is expected.

## Step 26 [Player]: cancel from the queue panel

Choose **Gate Ore** and **Gate Ember** and click **Queue the craft**, then **View queue** and **Cancel** on the row.

**What you should see:** "**Cancelled: ... Your days and materials are back.**" at the bottom, the queue is empty again, and the days free are back to what they were before this step.

## Step 27 [Player]: no message in your chat data has a DC or a roll

```js
// [Player] Foundry hands EVERY chat message to EVERY client, a whisper included (it is only hidden from the chat log). So scan all of them.
await (async () => {
  const rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const all = game.messages.contents;
  const leaks = all.filter(m => /vs DC|\bDC\b|GM only|\bnatural \d|d100|d20=|Perception total|total \d/.test(m.content ?? ""));
  check("there are messages from the crafts (so this is a real check)", all.some(m => /crafts/.test(m.content ?? "")), all.length);
  check("no message at all, visible or not, carries a DC or a roll total", leaks.length === 0, leaks.map(m => m.content).join(" | "));
  check("none of them is a GM-only whisper", all.filter(m => /GM only/.test(m.content ?? "")).length === 0);
  console.log(rows.join("\n"));
  return rows.every(r => r.startsWith("PASS")) ? "ALL PASS" : `${rows.filter(r => r.startsWith("FAIL")).length} FAILED: scroll up for the lines`;
})();
```

## Group E: live updates

## Step 28 [Player]: count the redraws

```js
// [Player] count how many times the Hub replaces its content. Leave the Hub open on Gate Smith's Formulae tab.
await (async () => {
  const main = document.querySelector(".pfp-hub .pfp-main");
  if (!main) throw new Error("open the Hub first (step 4)");
  globalThis.__pfpRedraws = 0;
  globalThis.__pfpObserver?.disconnect();
  globalThis.__pfpObserver = new MutationObserver(() => { globalThis.__pfpRedraws++; });
  globalThis.__pfpObserver.observe(main, { childList: true });
  return "counting: now do step 29 in the GM window, then run step 30 here";
})();
```

## Step 29 [GM]: a change that does NOT concern the Hub's character

```js
// [GM] an unrelated change: days for Gate Friend (the Hub is showing Gate Smith).
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.grantDays(g.friend(), 1);
  await new Promise(r => setTimeout(r, 2500));       // long enough for any redraw to have happened
  g.check("Gate Friend has the extra day", g.api.days(g.friend()) === 13, g.api.days(g.friend()));
  return g.done();
})();
```

## Step 30 [Player]: it did not redraw

```js
// [Player] the Hub did not redraw for Gate Friend's change. Resets the counter for the next step.
await (async () => {
  const n = globalThis.__pfpRedraws;
  globalThis.__pfpRedraws = 0;
  console.log(`redraws counted: ${n}`);
  return n === 0 ? "ALL PASS" : `FAILED: counted ${n} redraw(s) after a change to Gate Friend; the Hub is showing Gate Smith and should have ignored it`;
})();
```

## Step 31 [GM]: a change that DOES concern it

```js
// [GM] days for Gate Smith (the Hub is showing Gate Smith).
await (async () => {
  const g = globalThis.__g5 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.grantDays(g.smith(), 1);
  await new Promise(r => setTimeout(r, 2500));
  g.check("Gate Smith has the extra day", g.api.days(g.smith()) >= 1, g.api.days(g.smith()));
  return g.done();
})();
```

## Step 32 [Player]: it redrew, once, quietly

```js
// [Player] the Hub redrew for Gate Smith's change.
await (async () => {
  const n = globalThis.__pfpRedraws;
  globalThis.__pfpObserver?.disconnect();
  console.log(`redraws counted: ${n}`);
  return n >= 1 && n <= 2 ? "ALL PASS" : `FAILED: counted ${n} redraws; expected 1 (2 is tolerated if Foundry wrote the character twice)`;
})();
```

**What you should also see:** the **Downtime days** number went up by one without the window flickering, and your focus ring (if you had one on a button) stayed where it was.

## Group F: display and accessibility

## Step 33 [Player]: text size

Click **Display**. **What you should see:** a panel with **Text size** (100%, 125%, 150%, 175%), **Colours** (Parchment, Dark, High contrast), **Font** (Standard, Easy-read) and **Reset to defaults** and **Done**, the current choices marked "selected". Click **125%**, **150%**, **175%** in turn: the text of the WHOLE window grows each time (real larger text, not a blurry zoom), the layout still fits (scroll if needed), no text is cut off or on top of other text, and the buttons stay easy to hit.

**Send me a screenshot at 175% (Parchment, window wide).**

## Step 34 [Player]: colours

Click **Dark**, then **High contrast**, then **Parchment**.

**What you should see:** Dark is light text on a dark background; High contrast is **yellow on black** with strong outlines; Parchment is the warm paper look. In each, the selected tab, selected option, an off button (dashed outline) and a "Not enough" line are still easy to tell apart WITHOUT relying on colour (each has a word or a shape).

**Send me a screenshot in High contrast at 175%.**

## Step 35 [Player]: easy-read font

Click **Easy-read (Atkinson Hyperlegible)**.

**What you should see:** every letter in the window changes shape (a more open, rounder "a", "g" and "e"; "I", "l" and "1" clearly different). Click **Standard** to go back.

## Step 36 [Player]: reset, and remembered

Set 150%, High contrast and Easy-read, then close the Hub window and open it again. **What you should see:** it opens with the same choices. Click **Display** then **Reset to defaults**: 100%, Parchment, Standard.

## Step 37 [Player]: the window shrinks to a narrow layout

Drag the window's edge until it is **narrower than about 700 pixels**.

**What you should see:** the list on the left and the craft form on the right **stack**: the list first, the form under it, in one column; nothing overlaps; the whole window scrolls. Widen it again and they go back side by side.

**Send me a screenshot of the narrow, stacked window.**

## Step 38 [Player]: keyboard only

Click on the empty title area of the Hub window, then use only the keyboard. **What you should see:**
1. **Tab** moves through every control in a sensible order (Display, Switch character if shown, View queue, the tabs, the chips, the formula cards, the slot options, the workshops, Queue the craft, Ask a crafter instead). A **thick blue (or white in High contrast) ring** shows where you are every time.
2. **Enter** or **Space** presses the control: pick a formula, then pick a material for each slot, with no mouse.
3. Tab to **Queue the craft** while it is off: it takes focus and its reason is read out; pressing Enter does nothing. Fill the slots, tab to **Queue the craft**, press Enter: the craft is queued, and focus is not lost.
4. After a live update (for example the GM grants you a day), the focus ring is still on the same button.

If you can use a screen reader, turn it on and queue a craft: it should announce "Craft queued: ... days reserved." without you moving.

## Step 39 [Player]: size and position are remembered

Move the window to a corner and make it a different size, close it, and open it again from the scene controls. **What you should see:** it comes back where you left it, at that size. (This is per player: it is saved in your own browser settings.)

## Step 40 [GM]: CLEANUP (always run this, even if a step failed)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Smith", "Gate Friend"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway5") === true);
  const ids = actors.map(a => a.id);
  const user = game.users.getName("Test");

  await attempt("party location", async () => {
    if (!actors.length) return;
    const original = user?.getFlag(M, "gateOriginalLocation5");
    if (original !== undefined) { await game.settings.set(M, "partyLocation", original); await user.unsetFlag(M, "gateOriginalLocation5"); }
  });
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the shared Compendium", async () => {
    const book = game.settings.get(M, "sharedCompendium");
    if (!book) return;
    const drop = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => !k.startsWith("g5-")));
    const next = { ...book, materials: drop(book.materials), experiments: drop(book.experiments) };
    if (JSON.stringify(next) !== JSON.stringify(book)) await game.settings.set(M, "sharedCompendium", next);
  });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate /.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  for (const [kind, id] of [["recipe", "g5-draught"], ["recipe", "g5-vest"], ["recipe", "g5-blade"], ["station", "g5-forge"], ["station", "g5-bench"], ["material", "g5-moon"], ["material", "g5-star"], ["material", "g5-ember"], ["material", "g5-steel"], ["material", "g5-ore"], ["town", "g5-away"], ["town", "g5-town"]]) api.definitions[kind].delete(id);
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  api.gm.clearLog();
  delete globalThis.__g5;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, sharedLeft: Object.keys(game.settings.get(M, "sharedCompendium")?.experiments ?? {}).filter(k => k.startsWith("g5-")).length, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `downtimeOpen: false`, `sharedLeft: 0`, and the audit list empty. In the Player window, run `delete globalThis.__pfpRedraws` (or just reload).
