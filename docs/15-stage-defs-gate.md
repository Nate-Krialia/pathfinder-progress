# 15 Definitions gate (real Foundry): players load only the definitions they need (v0.16.0)

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]** and has ONE code block. Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS` (or say how many failed): paste back anything that is not `ALL PASS`.

`tests/gate15.test.js` runs every block below, in order, against the real `main.js` in a fake Foundry where the Player and the GM each have their OWN `api.definitions` (as in real Foundry) and the Player only gets what the GM sends over the socket. What it cannot show is what only a real Foundry shows: socketlib naming the true sender, the real hooks firing on the Player's client, and the timing of the refresh. That is what this gate is for.

**What the gate shows.**
- A Player whose character holds `g3-loom-blade` can preview it. A Player character who does NOT hold it is told `<name> does not know this formula.`, never "unknown" or "orphaned"; only a held formula with no recipe at all on the GM says "orphaned".
- An explore submit is validated for a region in play (tagged on the scene the character stands on) and refused plainly for one that is not.
- The GM's copy and the Player's copy differ as designed: the Player has no recipe they do not hold, no region that is not in play, no unmet material, and, for what they do have, a region without its spawn table and DC, a node type without its ladders and charges, a material without its effects, and a recipe without its overrides, outputs, craft level or loss chances. The GM keeps everything.
- A formula the GM grants (or takes away) reaches the Player without a reload, a moment later (the debounced refresh); so does a definition the GM edits and publishes.
- socketlib's own sender is what decides whose definitions come back: a forged user id in the call changes nothing.

**Not provable in a live world (unit tests only, in `tests/player-defs-wiring.test.js`).** The "GM isn't connected" and "still loading" sentences need the GM to be logged out or the socket to be slow, which a gate cannot do safely. They are checked in the tests with a fake GM that is absent or slow.

**Safety.** Everything uses throwaway things named "Gate ...": the characters **Gate Weaver** and **Gate Idler** (both owned by the user "Test"), the scene **Gate Meadow**, and in-memory fake definitions (`g3-town`, `g3-thread`, `g3-silk`, `g3-loom`, `g3-bush`, `g3-meadow`, `g3-cave`, `g3-loom-blade`, `g3-secret-blade`, `g3-hut`; they exist only until you reload the GM window, and SETUP registers them again; no real campaign recipe is used). SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, or a "Gate ..." actor or scene exists that it did not make. The SETUP block also uses the shared "Resource Node" actor for the node token (it creates it if missing and CLEANUP leaves it alone). CLEANUP always works, even if a step failed, and is safe to run twice.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.16.0**; if it is not, stop (the release may still be building).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.16.0"]` in the GM window and `["Test", false, "0.16.0"]` in the Player window.

## Step 2 [GM]: SETUP

Safe to run again at any time: after a reload of the GM window the fake definitions and the `globalThis.__g3` helper are gone, and running SETUP again re-registers the definitions, publishes them to the players and REBUILDS the helper without touching anything else.

```js
// [GM] SETUP: fake definitions (memory only), Gate Weaver (holds g3-loom-blade) + Gate Idler (holds nothing), Gate Meadow tagged g3-meadow with a bush node, party at Gate Town, 6 days of downtime. Run it again after a reload to rebuild the helper.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway3") === true;
  const [weaverOld, idlerOld, sceneOld] = [game.actors.getName("Gate Weaver"), game.actors.getName("Gate Idler"), game.scenes.getName("Gate Meadow")];
  if (![weaverOld, idlerOld, sceneOld].every(mine)) throw new Error('"Gate Weaver", "Gate Idler" or "Gate Meadow" already exists and was not made by this check; rename or delete it first');

  // The fake definitions go into the GM's loaded registry (memory only). Safe to repeat.
  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const output = { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger };
  const slots = [{ name: "body", drives: "basePower", tierFloor: 1, qty: 2 }];
  const recipe = (id, name) => ({ kind: "recipe", id, name, category: "weapon", output, craftLevel: 2, slots, stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } });
  const defs = [
    ["town", { kind: "town", id: "g3-town", name: "Gate Town" }],
    ["material", { kind: "material", id: "g3-thread", name: "Gate Thread", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g3-silk", name: "Gate Silk", tier: 2, effects: { basePower: "T2" } }],
    ["station", { kind: "station", id: "g3-loom", name: "Gate Loom", category: "smithing", tier: 1, town: "g3-town" }],
    ["nodeType", { kind: "nodeType", id: "g3-bush", name: "Gate Bush", skills: ["survival"], charges: 3, ladders: { 1: [{ materialId: "g3-thread", dcOffset: 0, quantity: "1d4", guaranteed: true }] } }],
    ["region", { kind: "region", id: "g3-meadow", name: "Gate Meadow", sceneTag: "g3-meadow", skillWhitelist: ["survival", "nature"], explorationDC: 18, daysRequired: 2, danger: "moderate", spawnTable: [{ nodeType: "g3-bush", tier: 1, weight: 1 }] }],
    ["region", { kind: "region", id: "g3-cave", name: "Gate Cave", sceneTag: "g3-cave", skillWhitelist: ["survival"], explorationDC: 20, daysRequired: 2, danger: "high", spawnTable: [{ nodeType: "g3-bush", tier: 1, weight: 1 }] }],
    ["recipe", recipe("g3-loom-blade", "Gate Loom Blade")],
    ["recipe", recipe("g3-secret-blade", "Gate Secret Blade")],
    ["blueprint", { kind: "blueprint", id: "g3-hut", name: "Gate Hut", category: "smithing", tier: 1, slots: [{ name: "wall", tierFloor: 1, qty: 3 }], gold: 25, buildDays: 3, researchProject: { tier: 1 } }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  // The helper the later [GM] steps use. Built here for a first run AND for a rerun after a reload.
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids,
      weaver: () => game.actors.get(ids.weaver), idler: () => game.actors.get(ids.idler), scene: () => game.scenes.get(ids.scene),
      status: () => api.definitionsStatus(),
      pause: ms => new Promise(r => setTimeout(r, ms)),
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g3 = g;
    return g;
  };

  if (weaverOld || idlerOld || sceneOld) {
    if (!(weaverOld && idlerOld && sceneOld)) throw new Error("part of the gate is missing (a character or the scene was deleted): run CLEANUP (step 18), then SETUP again");
    const ids = { weaver: weaverOld.id, idler: idlerOld.id, scene: sceneOld.id };
    build(ids);
    return { already: "set up", rebuilt: "the definitions and globalThis.__g3", published: await api.publishDefinitions(), ids };
  }

  // Refuse to run against real data.
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const published = await api.publishDefinitions();      // tell the players' windows the GM's definitions changed (only now: a refused SETUP writes nothing)

  const flags = { [M]: { gateThrowaway3: true } };
  const owned = { default: 0, [test.id]: 3 };
  const weaver = await Actor.create({ name: "Gate Weaver", type: "character", ownership: owned, flags });
  const idler = await Actor.create({ name: "Gate Idler", type: "character", ownership: owned, flags });
  const scene = await Scene.create({ name: "Gate Meadow", width: 1400, height: 1000, grid: { size: 100 }, padding: 0, ownership: { default: 2 }, flags });
  let x = 100;
  for (const actor of [weaver, idler]) { const td = await actor.getTokenDocument({ x: (x += 100), y: 100 }); await scene.createEmbeddedDocuments("Token", [td.toObject()]); }
  const bush = await api.placeNode(scene, { nodeType: "g3-bush", tier: 1, charges: 3, x: 600, y: 300 });
  await bush.update({ name: "Gate Bush" });
  await api.tagScene(scene, "g3-meadow");
  await api.placeAnchors(4, { scene });

  await api.giveMaterial(weaver, "g3-thread", 6);
  await api.grantFormula(weaver, "g3-loom-blade");
  await scene.setFlag(M, "gateOriginalLocation", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g3-town");
  await test.setFlag(M, "gateOriginalCharacter", test.character?.id ?? "none");
  await test.update({ character: weaver.id });
  await api.downtime.start({ days: 6, actorIds: [weaver.id, idler.id] });

  const ids = { weaver: weaver.id, idler: idler.id, scene: scene.id };
  build(ids);
  await scene.setFlag(M, "gateIds3", ids);
  return { weaver: weaver.name, idler: idler.name, scene: scene.name, published, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object naming Gate Weaver, Gate Idler and Gate Meadow, `testUsersCharacter: "Gate Weaver"` and a `published` revision. On a rerun it says `already: "set up"`.

## Step 3 [Player]: the Player helper (and the first load)

Open **Gate Weaver**'s sheet in this window. Run:

```js
// [Player] helper for the next steps (lost on reload; just run it again). It asks the GM for the definitions your characters need.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const weaver = game.actors.getName("Gate Weaver"), idler = game.actors.getName("Gate Idler");
  if (game.user.isGM || !weaver?.isOwner || !idler?.isOwner) throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  const before = Object.fromEntries(["recipe", "material", "region"].map(kind => [kind, api.definitions[kind].size]));
  const loaded = await api.definitions.refresh();
  const rows = [];
  const p = {
    M, api, weaver, idler,
    ids: kind => [...api.definitions[kind].keys()].sort(),
    check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
    done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; },
    refused: async fn => { try { await fn(); return null; } catch (error) { return error.message; } },
    until: async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; }
  };
  globalThis.__p3 = p;
  return { before, loaded: loaded.changed, status: api.definitionsStatus().status };
})();
```

Expected: `before` shows the Player window held (almost) nothing from the packs (`recipe: 0, material: 0, region: 0` after a fresh reload), `loaded: true` and `status: "ready"`.

## Step 4 [Player]: what this window loaded

```js
// [Player] only what Gate Weaver and Gate Idler need: the one recipe they hold, the thread in the bag, the loom in Gate Town, the meadow they stand in.
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const d = p.api.definitions;
  p.check("exactly one recipe: the one Gate Weaver holds", JSON.stringify(p.ids("recipe")) === '["g3-loom-blade"]', JSON.stringify(p.ids("recipe")));
  p.check("the secret recipe nobody holds is NOT here", !d.recipe.has("g3-secret-blade"));
  p.check("Gate Thread (in the bag) is here, Gate Silk (never met) is not", d.material.has("g3-thread") && !d.material.has("g3-silk"), JSON.stringify(p.ids("material")));
  p.check("the loom and Gate Town are here", d.station.has("g3-loom") && d.town.has("g3-town"));
  p.check("the meadow they stand in is here, the cave is not", d.region.has("g3-meadow") && !d.region.has("g3-cave"), JSON.stringify(p.ids("region")));
  p.check("the bush that is out in the meadow is here", d.nodeType.has("g3-bush"));
  p.check("the hut nobody has designed is NOT here", !d.blueprint.has("g3-hut"));
  const region = d.region.get("g3-meadow"), bush = d.nodeType.get("g3-bush");
  p.check("the meadow has no spawn table and no DC in this window", region && !("spawnTable" in region) && !("explorationDC" in region), JSON.stringify(Object.keys(region ?? {})));
  p.check("the meadow keeps what a player needs ", region?.name === "Gate Meadow" && region.daysRequired === 2 && region.skillWhitelist.includes("survival") && !("explorationDC" in region));
  p.check("the bush has no ladders and no charges in this window", bush && !("ladders" in bush) && !("charges" in bush), JSON.stringify(Object.keys(bush ?? {})));
  p.check("the window says it is ready", p.api.definitionsStatus().status === "ready");
  return p.done();
})();
```

## Step 5 [GM]: the GM's copy is the full one

```js
// [GM] the GM window still has everything, with the spawn table, the DC, the ladders and the charges.
await (async () => {
  const g = globalThis.__g3 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const d = g.api.definitions;
  g.check("both recipes, both regions, both materials are in the GM window", d.recipe.has("g3-loom-blade") && d.recipe.has("g3-secret-blade") && d.region.has("g3-cave") && d.region.has("g3-meadow") && d.material.has("g3-silk") && d.blueprint.has("g3-hut"));
  g.check("the meadow still has its spawn table and DC", Array.isArray(d.region.get("g3-meadow").spawnTable) && d.region.get("g3-meadow").explorationDC === 18);
  g.check("the bush still has its ladders and charges", Boolean(d.nodeType.get("g3-bush").ladders) && d.nodeType.get("g3-bush").charges === 3);
  g.check("a GM window has nothing to fetch", (await d.refresh()).gm === true);
  g.check("a GM window reports ready", g.status().status === "ready");
  return g.done();
})();
```

## Step 6 [Player]: preview a recipe Gate Weaver holds

```js
// [Player] this used to say "unknown recipe" in a player window. Now it previews.
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const result = p.api.previewCraft(p.weaver, "g3-loom-blade", { body: "g3-thread" }, "g3-loom");
  p.check("the preview is ok", result.ok === true, JSON.stringify(result.errors));
  p.check("it shows the loom's 1 gp fee", result.plan?.fee === 1, result.plan?.fee);
  p.check("it uses the thread in the bag", JSON.stringify(result.plan?.uses?.map(u => u.materialId)) === '["g3-thread"]', JSON.stringify(result.plan?.uses?.map(u => u.materialId)));
  const unmet = p.api.previewCraft(p.weaver, "g3-loom-blade", { body: "g3-silk" }, "g3-loom");
  p.check("a material Gate Weaver has never met is 'you do not have', not 'unknown'", unmet.ok === false && unmet.errors.some(e => /slot "body": you do not have "g3-silk"/.test(e)) && !unmet.errors.some(e => /unknown/.test(e)), JSON.stringify(unmet.errors));
  return p.done();
})();
```

## Step 7 [Player]: a recipe a character does not hold

```js
// [Player] Gate Idler holds nothing: one plain sentence, whether the recipe exists (and is loaded for her sister character) or not.
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const expected = ["Gate Idler does not know this formula."];
  for (const id of ["g3-loom-blade", "g3-secret-blade", "g3-never-existed"]) {
    const result = p.api.previewCraft(p.idler, id, { body: "g3-thread" });
    p.check(`${id}: exactly the plain sentence`, result.ok === false && JSON.stringify(result.errors) === JSON.stringify(expected), JSON.stringify(result.errors));
    p.check(`${id}: never 'unknown' or 'orphaned'`, !result.errors.some(e => /unknown|orphaned/i.test(e)));
  }
  return p.done();
})();
```

## Step 8 [Player]: explore a region in play

```js
// [Player] the meadow is tagged on the scene Gate Weaver stands on, so the submit is validated here; the cave is not in play, so it is refused plainly.
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const free = () => p.weaver.getFlag(p.M, "downtimeDays") ?? 0;
  const before = free();
  const action = await p.api.queue.submit(p.weaver, "explore", { region: "g3-meadow", skill: "survival" }, 2);
  p.check("the meadow is queued for 2 days", action.type === "explore" && action.params.region === "g3-meadow" && free() === before - 2, JSON.stringify([action.params, before, free()]));
  const cave = await p.refused(() => p.api.queue.submit(p.weaver, "explore", { region: "g3-cave", skill: "survival" }, 2));
  p.check("the cave is refused with a plain sentence", /^submit: there is no region "g3-cave" you can explore from where your characters are/.test(cave ?? ""), cave);
  p.check("the cave refusal changed nothing", free() === before - 2);
  const result = await p.api.queue.cancel(p.weaver, action.id);
  p.check("cancelling gives the 2 days back", free() === before && result.refunded === 2, JSON.stringify(result));
  return p.done();
})();
```

## Step 9 [GM]: grant a formula

```js
// [GM] give Gate Weaver the secret blade's formula. The Player window must pick it up on its own, a moment later.
await (async () => {
  const g = globalThis.__g3 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.grantFormula(g.weaver(), "g3-secret-blade");
  g.check("Gate Weaver now holds both formulas", (g.weaver().getFlag(g.M, "formulas") ?? []).map(f => f.recipeId).sort().join() === "g3-loom-blade,g3-secret-blade");
  return g.done();
})();
```

## Step 10 [Player]: it arrives without a reload

```js
// [Player] do NOT reload and do NOT call refresh: wait for the window to update itself (up to 8 seconds).
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const arrived = await p.until(() => p.api.definitions.recipe.has("g3-secret-blade"));
  p.check("the secret blade's recipe arrived by itself", Boolean(arrived));
  const result = p.api.previewCraft(p.weaver, "g3-secret-blade", { body: "g3-thread" }, "g3-loom");
  p.check("and it previews", result.ok === true, JSON.stringify(result.errors));
  p.check("Gate Idler still does not know it", JSON.stringify(p.api.previewCraft(p.idler, "g3-secret-blade", {}).errors) === '["Gate Idler does not know this formula."]');
  return p.done();
})();
```

## Step 11 [GM]: take the formula away

```js
// [GM] remove it again. The Player window must drop the recipe by itself.
await (async () => {
  const g = globalThis.__g3 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.removeFormula(g.weaver(), "g3-secret-blade");
  g.check("Gate Weaver holds one formula again", (g.weaver().getFlag(g.M, "formulas") ?? []).map(f => f.recipeId).join() === "g3-loom-blade");
  return g.done();
})();
```

## Step 12 [Player]: it goes away without a reload

```js
// [Player] wait for the window to drop the recipe by itself (up to 8 seconds).
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const gone = await p.until(() => !p.api.definitions.recipe.has("g3-secret-blade"));
  p.check("the secret blade's recipe is gone again", Boolean(gone));
  p.check("the one she still holds is still here", p.api.definitions.recipe.has("g3-loom-blade"));
  p.check("a refusal for it is the plain sentence again", JSON.stringify(p.api.previewCraft(p.weaver, "g3-secret-blade", {}).errors) === '["Gate Weaver does not know this formula."]');
  return p.done();
})();
```

## Step 13 [GM]: a held formula with no recipe at all

```js
// [GM] put a formula for a recipe that does not exist on Gate Weaver, the way a deleted recipe would leave one.
await (async () => {
  const g = globalThis.__g3 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const weaver = g.weaver();
  const list = weaver.getFlag(g.M, "formulas") ?? [];
  if (!list.some(f => f.recipeId === "g3-ghost")) await weaver.update({ [`flags.${g.M}.formulas`]: [...list, { recipeId: "g3-ghost", access: "owned", source: "gm" }] });
  g.check("Gate Weaver holds a formula for g3-ghost, which has no recipe", (weaver.getFlag(g.M, "formulas") ?? []).some(f => f.recipeId === "g3-ghost") && !g.api.definitions.recipe.has("g3-ghost"));
  return g.done();
})();
```

## Step 14 [Player]: only this one says "orphaned"

```js
// [Player] the GM checked: no recipe for g3-ghost exists anywhere. That, and only that, is "orphaned".
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const reported = await p.until(() => p.api.definitionsStatus().orphaned.includes("g3-ghost"));
  p.check("the window learned that g3-ghost is orphaned (reported by the GM)", Boolean(reported), JSON.stringify(p.api.definitionsStatus().orphaned));
  const ghost = p.api.previewCraft(p.weaver, "g3-ghost", {});
  p.check("held with no recipe: the orphaned-formula sentence", /^Gate Weaver holds an orphaned formula for this \(its recipe no longer exists\): ask the GM to remove it or restore the recipe\.$/.test(ghost.errors[0] ?? ""), JSON.stringify(ghost.errors));
  const never = p.api.previewCraft(p.weaver, "g3-never-existed", {});
  p.check("not held and not there: NOT orphaned", JSON.stringify(never.errors) === '["Gate Weaver does not know this formula."]', JSON.stringify(never.errors));
  return p.done();
})();
```

## Step 15 [GM]: edit a definition and publish it

```js
// [GM] rename the meadow in the GM's memory and publish: every player window should pick the new name up.
await (async () => {
  const g = globalThis.__g3 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.api.definitions.region.set("g3-meadow", { ...g.api.definitions.region.get("g3-meadow"), name: "Gate Meadow Renamed" });
  const published = await g.api.publishDefinitions();
  g.check("publishing a changed registry makes a new revision", published.changed === true, JSON.stringify(published));
  const again = await g.api.publishDefinitions();
  g.check("publishing it again changes nothing", again.changed === false, JSON.stringify(again));
  return g.done();
})();
```

## Step 16 [Player]: the edit arrives without a reload

```js
// [Player] wait for the new name (up to 8 seconds); no reload and no refresh call.
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const renamed = await p.until(() => p.api.definitions.region.get("g3-meadow")?.name === "Gate Meadow Renamed");
  p.check("the meadow's new name arrived", Boolean(renamed), p.api.definitions.region.get("g3-meadow")?.name);
  p.check("and it is still stripped", !("spawnTable" in p.api.definitions.region.get("g3-meadow")));
  return p.done();
})();
```

## Step 17 [Player]: socketlib's sender decides, not the id in the call

```js
// [Player] call the GM's definitionsFor handler directly with the GM's user id in the payload. If the module believed that id it would refuse (the GM loads everything itself); if socketlib's real sender is used you get YOUR set.
await (async () => {
  const p = globalThis.__p3 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const gmId = game.users.find(u => u.isGM)?.id;
  const socket = globalThis.socketlib?.modules?.get(p.M);
  if (!gmId || !socket) throw new Error("could not find the GM user or the module's socket (api.socketStatus() shows what is missing)");
  const forged = await socket.executeAsGM("definitionsFor", { userId: gmId });
  p.check("a forged GM id in the payload is ignored: the answer is the Player's set", Array.isArray(forged?.records) && forged.__relay === undefined, JSON.stringify(forged?.__relay ?? forged?.message ?? "records"));
  const recipes = (forged?.records ?? []).filter(r => r.kind === "recipe").map(r => r.data.id).sort();
  p.check("and it is Gate Weaver's set (the loom blade, not the secret blade)", JSON.stringify(recipes) === '["g3-loom-blade"]', JSON.stringify(recipes));
  return p.done();
})();
```

If this step FAILS with `refused` / "The GM client loads every definition itself", the module is trusting the id in the payload and socketlib's sender is not reaching the handler: report it before anything else.

## Step 18 [GM]: CLEANUP (always run this, even if a step failed)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Weaver", "Gate Idler"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway3") === true);
  const ids = actors.map(a => a.id);
  const scene = game.scenes.getName("Gate Meadow");
  const ours = scene?.getFlag(M, "gateThrowaway3") === true ? scene : null;
  const user = game.users.getName("Test");

  if (ours) {
    await attempt("party location", async () => { await game.settings.set(M, "partyLocation", ours.getFlag(M, "gateOriginalLocation") ?? ""); });
    await attempt("clear the map", () => api.clearMap(ours));
    await attempt("clear the anchors", () => api.clearAnchors(ours, { confirm: true }));
    await attempt("untag the scene", () => api.untagScene(ours, "g3-meadow"));
    await attempt("the explorationState entry", async () => { const all = game.settings.get(M, "explorationState") ?? {}; delete all[ours.id]; await game.settings.set(M, "explorationState", all); });
    await attempt("delete the scene", () => ours.delete());
  }
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
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
  for (const [kind, id] of [["blueprint", "g3-hut"], ["recipe", "g3-secret-blade"], ["recipe", "g3-loom-blade"], ["region", "g3-cave"], ["region", "g3-meadow"], ["nodeType", "g3-bush"], ["station", "g3-loom"], ["material", "g3-silk"], ["material", "g3-thread"], ["town", "g3-town"]]) api.definitions[kind].delete(id);
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  delete globalThis.__g3;
  delete globalThis.__p3;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, sceneLeft: Boolean(game.scenes.getName("Gate Meadow")), downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `sceneLeft: false`, `downtimeOpen: false`, and the audit list empty. In the Player window, run `delete globalThis.__p3` (or just reload); the fake definitions it was holding are in that window's memory only and disappear with the reload.
