# 14 Stage 10b + 10c gate (real Foundry): the Compendium, workshop upgrades, building your own workshop

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]** and has ONE code block. Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS` (or say how many failed): paste back anything that is not `ALL PASS`.

`tests/gate14.test.js` runs every block below, in order, against the real `main.js` in a fake Foundry, so the calls and argument shapes are known to run there. What it cannot show is what only a real Foundry shows: the PF2e actor data (does a wolf NPC really report its creature type?), real Combat documents, the real hooks, and socketlib carrying a player's call to the GM. That is what this gate is for.

**What the gate shows.** Compendium entries for a material, a creature (from a combat) and a region (from exploring), no duplicates, a creature's yield locked until it is collected from a corpse, privacy through the API, sharing with the party (queued, cancelled, approved, rejected, never blocking End downtime); workshop upgrades (materials held in escrow, returned when put aside, applied on completion, craft days cut but never below 1); building your own workshop (design research, then materials + gold + days, a party-owned station at the town the party is in, no station fee while other stations still charge, the location rule); and one ordinary craft and gather as a regression check.

**Safety.** Everything uses throwaway things named "Gate ...": the characters **Gate Smith**, **Gate Bystander** and **Gate Wolf**, the scene **Gate Yard**, and in-memory fake definitions (`g2-town`, `g2-away`, `g2-ore`, `g2-hide`, `g2-gem`, `g2-bench`, `g2-patch`, `g2-wood`, `g2-blade`, `g2-camp`; they exist only until you reload, and the SETUP block registers them again; no real campaign recipe is used). SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, a "Gate ..." actor or scene exists that it did not make, or an earlier run left something behind (run CLEANUP first). The SETUP block also uses the shared "Resource Node" actor for the node tokens (it creates it if missing and CLEANUP leaves it alone). CLEANUP always works, even if a step failed, and also removes the world data the gate wrote (the Yard Bench's saved upgrades, the party workshop, the shared Compendium entries).

**A note on timing.** Recording a Compendium entry happens in the background a moment after the thing that caused it, so a step may wait up to a few seconds (`until`) before it checks.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. Do this before anything else. The version must be **0.15.0**; if it is not, stop (the release may still be building).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.15.0"]` in the GM window and `["Test", false, "0.15.0"]` in the Player window.

## Step 2 [GM]: SETUP

Safe to run again at any time: after a reload of the GM window the fake definitions and the `globalThis.__g2` helper are gone, and running SETUP again re-registers the definitions and REBUILDS the helper (with the ids and the baseline saved on Gate Yard) without touching anything else.

```js
// [GM] SETUP: fake definitions (memory only), Gate Smith + Gate Bystander + Gate Wolf, Gate Yard with a patch and anchors, the party at Yard Town, 12 days of downtime. Run it again after a reload to rebuild the helper.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway2") === true;
  const [smithOld, byOld, wolfOld, sceneOld] = [game.actors.getName("Gate Smith"), game.actors.getName("Gate Bystander"), game.actors.getName("Gate Wolf"), game.scenes.getName("Gate Yard")];
  if (![smithOld, byOld, wolfOld, sceneOld].every(mine)) throw new Error('"Gate Smith", "Gate Bystander", "Gate Wolf" or "Gate Yard" already exists and was not made by this check; rename or delete it first');

  // The fake definitions go into the loaded registry (memory only). Safe to repeat.
  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const defs = [
    ["town", { kind: "town", id: "g2-town", name: "Yard Town" }],
    ["town", { kind: "town", id: "g2-away", name: "Far Town" }],
    ["material", { kind: "material", id: "g2-ore", name: "Gate Ore", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g2-hide", name: "Gate Hide", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g2-gem", name: "Gate Gem", tier: 2, effects: { basePower: "T2" } }],
    ["station", { kind: "station", id: "g2-bench", name: "Yard Bench", category: "smithing", tier: 1, town: "g2-town" }],
    ["nodeType", { kind: "nodeType", id: "g2-patch", name: "Yard Patch", skills: ["survival"], charges: 3, ladders: { 1: [{ materialId: "g2-ore", dcOffset: 0, quantity: "1d4", guaranteed: true }] } }],
    ["region", { kind: "region", id: "g2-wood", name: "Yard Wood", sceneTag: "g2-wood", skillWhitelist: ["survival", "nature"], explorationDC: 18, daysRequired: 2, danger: "moderate", spawnTable: [{ nodeType: "g2-patch", tier: 1, weight: 1 }] }],
    ["recipe", { kind: "recipe", id: "g2-blade", name: "Yard Blade", category: "weapon", output: { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger }, craftLevel: 2, slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 2 }], stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } }],
    ["blueprint", { kind: "blueprint", id: "g2-camp", name: "Yard Camp", category: "smithing", tier: 1, slots: [{ name: "anvil", tierFloor: 1, qty: 3 }, { name: "hearthstone", tierFloor: 2, qty: 1 }], gold: 25, buildDays: 3, researchProject: { tier: 1 } }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  // The helper the later [GM] steps use. Built here for a first run AND for a rerun after a reload.
  const sum = (a, id) => a.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + i.system.quantity, 0);
  const look = a => ({ gold: api.adapter.getCopper(a) / 100, ore: sum(a, "g2-ore"), gem: sum(a, "g2-gem"), hide: sum(a, "g2-hide"), free: a.getFlag(M, "downtimeDays") ?? 0, reserved: (a.getFlag(M, "pendingActions") ?? []).reduce((n, p) => n + p.daysReserved, 0) });
  const rows = [];
  const build = (ids, base) => {
    const g = {
      M, api, ids, look, base,
      smith: () => game.actors.get(ids.smith), bystander: () => game.actors.get(ids.bystander), wolf: () => game.actors.get(ids.wolf), scene: () => game.scenes.get(ids.scene),
      book: actor => actor.getFlag(M, "compendium") ?? { materials: {}, creatures: {}, regions: {} },
      shared: () => game.settings.get(M, "sharedCompendium") ?? { materials: {}, creatures: {}, regions: {} },
      partyStations: () => game.settings.get(M, "partyStations") ?? [],
      row: (actor, id) => api.stationsFor(actor).find(s => s.id === id),
      events: () => (game.settings.get(M, "auditLedger")._events?.history ?? []).map(h => h.text),
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      pause: ms => new Promise(r => setTimeout(r, ms)),
      keep: {},
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g2 = g;
    return g;
  };

  if (smithOld || byOld || wolfOld || sceneOld) {
    if (!(smithOld && byOld && wolfOld && sceneOld)) throw new Error("part of the gate is missing (a character or the scene was deleted): run CLEANUP (step 31), then SETUP again");
    const saved = sceneOld.getFlag(M, "gateIds2") ?? {};
    const ids = { smith: smithOld.id, bystander: byOld.id, wolf: wolfOld.id, scene: sceneOld.id, patch: saved.patch };
    const g = build(ids, sceneOld.getFlag(M, "gateBaseline2") ?? look(smithOld));
    return { already: "set up", rebuilt: "the definitions and globalThis.__g2", baseline: g.base, ids };
  }

  // Refuse to run against real data, or on top of an earlier run's leftovers.
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const left = [];
  if ((game.settings.get(M, "stationState") ?? []).some(e => e.stationId === "g2-bench")) left.push("a saved state for the Yard Bench");
  if ((game.settings.get(M, "partyStations") ?? []).some(s => s.blueprintId === "g2-camp")) left.push("a Yard Camp party workshop");
  if (Object.keys(game.settings.get(M, "sharedCompendium")?.materials ?? {}).some(k => k.startsWith("g2-"))) left.push("shared Compendium entries");
  if (left.length) throw new Error(`an earlier run left ${left.join(", ")}: run CLEANUP (step 31) first`);

  const flags = { [M]: { gateThrowaway2: true } };
  const smith = await Actor.create({ name: "Gate Smith", type: "character", ownership: { default: 0, [test.id]: 3 }, flags });
  const bystander = await Actor.create({ name: "Gate Bystander", type: "character", ownership: { default: 2 }, flags });   // observable by Test, but owned by nobody: NOT part of the party
  const wolf = await Actor.create({ name: "Gate Wolf", type: "npc", ownership: { default: 0 }, system: { traits: { value: ["animal"] } }, flags });
  const scene = await Scene.create({ name: "Gate Yard", width: 1400, height: 1000, grid: { size: 100 }, padding: 0, ownership: { default: 2 }, flags });
  let x = 100;
  for (const actor of [smith, bystander, wolf]) { const td = await actor.getTokenDocument({ x: (x += 100), y: 100 }); await scene.createEmbeddedDocuments("Token", [td.toObject()]); }
  const patch = await api.placeNode(scene, { nodeType: "g2-patch", tier: 1, charges: 3, x: 600, y: 300 });
  await patch.update({ name: "Yard Patch" });
  await api.tagScene(scene, "g2-wood");
  await api.placeAnchors(4, { scene });

  await api.giveMaterial(smith, "g2-ore", 12);
  await api.giveMaterial(smith, "g2-gem", 4);
  await api.adapter.addCopper(smith, 10000);
  await api.grantFormula(smith, "g2-blade");
  await scene.setFlag(M, "gateOriginalLocation", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g2-town");
  await test.setFlag(M, "gateOriginalCharacter", test.character?.id ?? "none");
  await test.update({ character: smith.id });
  await api.downtime.start({ days: 12, actorIds: [smith.id] });

  const ids = { smith: smith.id, bystander: bystander.id, wolf: wolf.id, scene: scene.id, patch: patch.id };
  const g = build(ids, look(smith));
  await scene.setFlag(M, "gateIds2", ids);          // saved so a rerun after a reload can rebuild the helper
  await scene.setFlag(M, "gateBaseline2", g.base);
  return { smith: smith.name, bystander: bystander.name, scene: scene.name, baseline: g.base, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object with the baseline `{ gold: 100, ore: 12, gem: 4, hide: 0, free: 12, reserved: 0 }` and `testUsersCharacter: "Gate Smith"`. On a rerun it says `already: "set up"` and shows the rebuilt baseline and ids.

## Step 3 [Player]: the Player helper

Open **Gate Smith**'s sheet in this window and keep the inventory visible. Run:

```js
// [Player] helper for the next steps (lost on reload; just run it again). It also asks the GM for the definitions Gate Smith needs (api.definitions.refresh()): a player client reads no pack.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api, hero = game.user.character;
  if (game.user.isGM || hero?.name !== "Gate Smith") throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  await api.definitions.refresh();
  const scene = () => game.scenes.getName("Gate Yard");
  const sum = id => hero.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + i.system.quantity, 0);
  const pending = () => hero.getFlag(M, "pendingActions") ?? [];
  const look = () => ({ gold: api.adapter.getCopper(hero) / 100, ore: sum("g2-ore"), gem: sum("g2-gem"), hide: sum("g2-hide"), free: hero.getFlag(M, "downtimeDays") ?? 0, reserved: pending().reduce((n, a) => n + a.daysReserved, 0) });
  const rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const done = () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; };
  const refused = async fn => { try { await fn(); return null; } catch (error) { return error.message; } };
  const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; };
  const book = () => hero.getFlag(M, "compendium") ?? { materials: {}, creatures: {}, regions: {} };
  const p = { M, api, hero, scene, look, pending, check, done, refused, until, book, keep: {}, bystander: game.actors.getName("Gate Bystander") };
  globalThis.__p2 = p;
  p.base = look();
  return p.base;
})();
```

Expected: `{ gold: 100, ore: 12, gem: 4, hide: 0, free: 12, reserved: 0 }`. If the scene is not visible to you, the GM should check that Gate Yard exists. From here on this window keeps its definitions up to date by itself (a moment after the GM changes something, with no reload); if a later step ever complains that something is "still loading", wait a second and run it again.

## Step 4 [Player]: the Compendium already knows what you were given

```js
// [Player] two material entries were made when the GM gave you Gate Ore and Gate Gem: once each, nothing else yet.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const ore = await p.until(() => p.book().materials["g2-ore"]);
  p.check("Gate Ore has an entry (made by the item landing in your inventory)", Boolean(ore) && ore.tier === 1 && ore.name === "Gate Ore", JSON.stringify(ore));
  p.check("so does Gate Gem", p.book().materials["g2-gem"]?.tier === 2);
  p.check("exactly 2 material entries, no creature or region yet", Object.keys(p.book().materials).length === 2 && !Object.keys(p.book().creatures ?? {}).length && !Object.keys(p.book().regions ?? {}).length, JSON.stringify(Object.keys(p.book().materials)));
  const view = p.api.compendium.view(p.hero);
  p.check("view() lists the 2 materials, each marked as your own", view.entries.materials.length === 2 && view.entries.materials.every(m => m.source === "own"), JSON.stringify(view.entries.materials.map(m => [m.id, m.source])));
  p.check("an entry made this way holds only what is known (no places, no rungs)", view.entries.materials.every(m => !m.places.length && !m.rungs.length));
  const other = await p.refused(async () => p.api.compendium.view(p.bystander));
  p.check("another character's Compendium is refused with the plain message", other === "You can only read the Compendium of a character you own.", other);
  return p.done();
})();
```

## Step 5 [GM]: a combat with Gate Wolf makes a creature entry

```js
// [GM] Smith and the wolf in a combat: Smith gets a barebones entry for the wolf; a second combat adds no duplicate; the Bystander (not in it) learns nothing.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const [smith, wolf, bystander] = [g.smith(), g.wolf(), g.bystander()];
  const tokenOf = actor => g.scene().tokens.find(t => t.actorId === actor.id);
  const fight = async () => {
    const combat = await Combat.create({ scene: g.scene().id, flags: { [g.M]: { gateThrowaway2: true } } });
    await combat.createEmbeddedDocuments("Combatant", [smith, wolf].map(a => ({ tokenId: tokenOf(a).id, sceneId: g.scene().id, actorId: a.id })));
  };
  await fight();
  const entry = await g.until(() => g.book(smith).creatures?.["gate wolf"]);
  g.check("Smith has an entry for Gate Wolf", Boolean(entry) && entry.name === "Gate Wolf", JSON.stringify(entry));
  g.check("it states a creature type (animal if PF2e reports the wolf's traits, otherwise plain 'creature')", ["animal", "creature"].includes(entry?.type), entry?.type);
  g.check("nothing is known about what it yields", Array.isArray(entry?.yields) && entry.yields.length === 0, JSON.stringify(entry?.yields));
  await fight();
  await g.pause(1500);
  g.check("a second combat adds no duplicate", Object.keys(g.book(smith).creatures).length === 1, JSON.stringify(Object.keys(g.book(smith).creatures)));
  g.check("Gate Bystander was not in it and has no creature entry", Object.keys(g.book(bystander).creatures ?? {}).length === 0);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 6 [Player]: queue an expedition (2 days)

```js
// [Player] explore Yard Wood: 2 days are reserved. The GM rolls it in secret.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "explore", { region: "g2-wood", skill: "survival" }, 2);
  const after = p.look();
  p.check("2 days are reserved", action.daysReserved === 2 && after.reserved === before.reserved + 2 && after.free === before.free - 2, JSON.stringify(after));
  p.check("no region entry yet (it needs the exploring to happen)", !p.book().regions?.["g2-wood"]);
  return p.done();
})();
```

## Step 7 [GM]: the expedition resolves and the region is recorded

```js
// [GM] resolve the expedition: Smith explored Yard Wood, so the region entry appears (once).
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "explore");
  g.check("an explore item is queued", Boolean(action));
  const out = await g.api.queue.resolve(smith, action.id, { degree: "success", chat: false });
  g.check("it resolved", out.status === "resolved", out.message);
  const entry = await g.until(() => g.book(smith).regions?.["g2-wood"]);
  g.check("Smith has a Yard Wood entry", Boolean(entry) && entry.name === "Yard Wood", JSON.stringify(entry));
  g.check("exactly one region entry", Object.keys(g.book(smith).regions).length === 1);
  g.check("Gate Bystander has none", Object.keys(g.book(g.bystander()).regions ?? {}).length === 0);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 8 [Player]: read your Compendium

```js
// [Player] materials, the wolf (yield still locked: nothing shown, no question marks) and the region.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const view = p.api.compendium.view(p.hero);
  const wolf = view.entries.creatures.find(c => c.name === "Gate Wolf");
  p.check("2 materials, 1 creature, 1 region", view.entries.materials.length === 2 && view.entries.creatures.length === 1 && view.entries.regions.length === 1, JSON.stringify([view.entries.materials.length, view.entries.creatures.length, view.entries.regions.length]));
  p.check("the wolf's yield is locked: nothing listed", Boolean(wolf) && wolf.yields.length === 0, JSON.stringify(wolf?.yields));
  p.check("there are no placeholders anywhere", !/\?\?\?|locked|unknown/i.test(JSON.stringify(view)));
  p.check("every entry is marked as your own", [...view.entries.materials, ...view.entries.creatures, ...view.entries.regions].every(e => e.source === "own"));
  p.check("the region entry names the region", view.entries.regions[0]?.name === "Yard Wood", view.entries.regions[0]?.name);
  return p.done();
})();
```

## Step 9 [GM]: Gate Wolf's corpse (a hand-made corpse that remembers who it was)

```js
// [GM] a corpse token with a one-rung ladder that yields Gate Hide, tagged with the wolf's identity.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const td = (await g.wolf().getTokenDocument({ x: 300, y: 600 })).toObject();
  const [corpse] = await g.scene().createEmbeddedDocuments("Token", [{ ...td, name: "Gate Wolf Corpse" }]);
  const record = await g.api.makeCorpseNode(corpse, { tier: 1, charges: 2, decayTimer: 3, creature: { name: "Gate Wolf", type: "animal" }, ladder: [{ materialId: "g2-hide", dcOffset: 0, quantity: "1", guaranteed: true }] });
  g.check("the corpse remembers the creature", record.creature?.name === "Gate Wolf" && record.creature?.type === "animal", JSON.stringify(record.creature));
  const bad = await (async () => { try { await g.api.makeCorpseNode(await g.scene().tokens.getName("Gate Wolf Corpse"), { replace: true, tier: 1, charges: 1, decayTimer: 1, creature: { name: "Gate Wolf" }, ladder: [{ materialId: "g2-hide", dcOffset: 0, quantity: "1", guaranteed: true }] }); return null; } catch (e) { return e.message; } })();
  g.check("a half-made creature identity is refused", /creature must be \{ name: "Goblin Warrior", type: "humanoid" \}/.test(bad ?? ""), bad);
  g.check("Smith's wolf entry still lists no yield", g.book(g.smith()).creatures["gate wolf"].yields.length === 0);
  return g.done();
})();
```

## Step 10 [Player]: queue a gather on the corpse

```js
// [Player] gathering costs a charge, not days.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const corpse = p.scene().tokens.getName("Gate Wolf Corpse");
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "gather", { sceneId: p.scene().id, tokenId: corpse.id, skill: "survival" });
  p.check("queued with no days", action.type === "gather" && action.daysReserved === 0 && JSON.stringify(p.look()) === JSON.stringify(before));
  p.check("the wolf still shows no yield (nothing collected yet)", p.api.compendium.view(p.hero).entries.creatures[0].yields.length === 0);
  return p.done();
})();
```

## Step 11 [GM]: resolve the gather: the yield unlocks

```js
// [GM] after the gather, Gate Hide is in the inventory AND recorded on the wolf's entry; the material has its own entry, once.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "gather");
  const out = await g.api.queue.resolve(smith, action.id, { degree: "success", chat: false });
  g.check("it resolved", out.status === "resolved", out.message);
  g.check("Smith has 1 Gate Hide", g.look(smith).hide === 1, g.look(smith).hide);
  const wolf = await g.until(() => g.book(smith).creatures["gate wolf"].yields.length && g.book(smith).creatures["gate wolf"]);
  g.check("the wolf's entry now lists Gate Hide", JSON.stringify(wolf?.yields) === JSON.stringify([{ materialId: "g2-hide", name: "Gate Hide" }]), JSON.stringify(wolf?.yields));
  g.check("Gate Hide has one material entry", Object.keys(g.book(smith).materials).filter(k => k === "g2-hide").length === 1);
  g.check("Gate Bystander learned nothing", Object.keys(g.book(g.bystander()).creatures ?? {}).length === 0);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 12 [Player]: share with the party

```js
// [Player] sharing is a queue item: no days, no downtime. Queue three, cancel one.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const ore = await p.api.queue.submit(p.hero, "share", { kind: "material", key: "g2-ore" });
  const wolf = await p.api.queue.submit(p.hero, "share", { kind: "creature", key: "gate wolf" });
  const region = await p.api.queue.submit(p.hero, "share", { kind: "region", key: "g2-wood" });
  p.check("all three cost no days", [ore, wolf, region].every(a => a.type === "share" && a.daysReserved === 0) && JSON.stringify(p.look()) === JSON.stringify(before), JSON.stringify(p.look()));
  const again = await p.refused(() => p.api.queue.submit(p.hero, "share", { kind: "material", key: "g2-ore" }));
  p.check("sharing the same thing twice is refused", again === "Gate Ore is already waiting for the GM to approve sharing it.", again);
  const result = await p.api.queue.cancel(p.hero, wolf.id);
  p.check("cancelling the wolf share works", result.cancelled === true || result.refunded === 0, JSON.stringify(result));
  p.check("2 shares are left waiting", p.pending().filter(a => a.type === "share").length === 2);
  return p.done();
})();
```

## Step 13 [GM]: approve one share, reject the other

```js
// [GM] approve the Gate Ore share, reject the Yard Wood share. Only the approved one is in the shared Compendium.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const rows = g.api.queue.list().filter(r => r.actorId === smith.id);
  g.check("the rows read Share: Gate Ore (material) and Share: Yard Wood (region)", rows.map(r => r.label).sort().join("|") === "Share: Gate Ore (material)|Share: Yard Wood (region)", rows.map(r => r.label).join("|"));
  g.check("nothing is shared while they wait", !Object.keys(g.shared().materials ?? {}).length && !Object.keys(g.shared().regions ?? {}).length);
  const ore = smith.getFlag(g.M, "pendingActions").find(a => a.params.key === "g2-ore");
  const region = smith.getFlag(g.M, "pendingActions").find(a => a.params.key === "g2-wood");
  const approved = await g.api.queue.resolve(smith, ore.id, { chat: false });
  g.check("the approval says so", approved.status === "resolved" && /approved: Gate Ore \(material\) is now shared with the party/.test(approved.message), approved.message);
  const rejected = await g.api.queue.reject(smith, region.id, { chat: false });
  g.check("the rejection is recorded", Boolean(rejected), JSON.stringify(rejected));
  g.check("the shared Compendium has Gate Ore only", Object.keys(g.shared().materials).join() === "g2-ore" && !Object.keys(g.shared().regions ?? {}).length, JSON.stringify(Object.keys(g.shared().materials)));
  g.check("the log has both", g.events().some(t => t === "share approved: Gate Ore (material) from Gate Smith") && g.events().some(t => /rejected/.test(t) && /Yard Wood/.test(t)), g.events().filter(t => /share/i.test(t)).join(" | "));
  const all = g.api.compendium.all();
  const mine = all.characters.find(c => c.actorId === smith.id);
  g.check("the GM sees everything: Smith's own entries, and what is shared", Boolean(mine) && mine.materials.some(m => m.id === "g2-hide") && mine.creatures.length === 1 && all.shared.materials.some(m => m.id === "g2-ore"), JSON.stringify(all.characters.map(c => [c.name, c.counts])));
  g.check("Gate Bystander (not in the party) still sees none of it", g.api.compendium.view(g.bystander()).entries.materials.length === 0);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 14 [Player]: the shared entry and the private one

```js
// [Player] Gate Ore is now both yours and shared; the rejected region stayed private; the queue holds no share any more.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const view = p.api.compendium.view(p.hero);
  p.check("Gate Ore is marked as both", view.entries.materials.find(m => m.id === "g2-ore")?.source === "both", JSON.stringify(view.entries.materials.map(m => [m.id, m.source])));
  p.check("Yard Wood is still only yours", view.entries.regions.find(r => r.name === "Yard Wood")?.source === "own");
  p.check("no share is waiting", !p.pending().some(a => a.type === "share"));
  p.check("hasMaterial answers for a discovered material", p.api.compendium.hasMaterial(p.hero, "g2-ore") === true && p.api.compendium.hasMaterial(p.hero, "g2-nothing") === false);
  return p.done();
})();
```

## Step 15 [Player]: start a workshop upgrade (materials go into escrow now)

```js
// [Player] research a craft-day cut for the Yard Bench: 2 Gate Ore are held on the project. No gold, no downtime, nothing queued.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const refusals = {
    wrongTier: await p.refused(() => p.api.workshop.startUpgrade(p.hero, { stationId: "g2-bench", kind: "craftDays", materials: { "g2-gem": 2 } })),
    wrongCount: await p.refused(() => p.api.workshop.startUpgrade(p.hero, { stationId: "g2-bench", kind: "craftDays", materials: { "g2-ore": 1 } })),
    short: await p.refused(() => p.api.workshop.startUpgrade(p.hero, { stationId: "g2-bench", kind: "craftDays", materials: { "g2-ore": 99 } })),
    noStation: await p.refused(() => p.api.workshop.startUpgrade(p.hero, { stationId: "g2-nowhere", kind: "craftDays", materials: { "g2-ore": 2 } }))
  };
  p.check("a material of the wrong tier is refused", refusals.wrongTier === "Cannot start this upgrade (Yard Bench: craftDays): Gate Gem is tier 2, but this upgrade needs materials of tier 1.", refusals.wrongTier);
  p.check("the wrong number of units is refused", refusals.wrongCount === "Cannot start this upgrade (Yard Bench: craftDays): this upgrade needs 2 unit(s) of tier-1 materials (you chose 1).", refusals.wrongCount);
  p.check("a shortage points at the Compendium", /^Cannot start this upgrade \(Yard Bench: craftDays\): needs 99 Gate Ore but only \d+ available\. Nothing can be bought: check the Compendium for where to find what you are missing\.$/.test(refusals.short ?? ""), refusals.short);
  p.check("an unknown workshop is refused", refusals.noStation === 'There is no workshop "g2-nowhere".', refusals.noStation);
  p.check("the refusals changed nothing", JSON.stringify(p.look()) === JSON.stringify(before));

  const project = await p.api.workshop.startUpgrade(p.hero, { stationId: "g2-bench", kind: "craftDays", materials: { "g2-ore": 2 } });
  const after = p.look();
  p.check("the project exists", project.id === "upgrade-g2-bench-craftDays-1" && project.goalName === "Yard Bench: craft days cut by 1" && project.status === "active", JSON.stringify([project.id, project.goalName, project.status]));
  p.check("2 Gate Ore are held on it", JSON.stringify(project.materials) === JSON.stringify([{ materialId: "g2-ore", qty: 2 }]) && after.ore === before.ore - 2, `${before.ore} -> ${after.ore}`);
  p.check("no gold, no days, nothing queued", after.gold === before.gold && after.free === before.free && after.reserved === before.reserved && p.pending().length === 0, JSON.stringify(after));
  const twice = await p.refused(() => p.api.workshop.startUpgrade(p.hero, { stationId: "g2-bench", kind: "craftDays", materials: { "g2-ore": 2 } }));
  p.check("the same upgrade cannot be started twice", twice === "Gate Smith is already researching that upgrade for Yard Bench.", twice);
  return p.done();
})();
```

## Step 16 [Player]: put a project aside: the escrow comes back, once

```js
// [Player] start a hearth upgrade (a counter with NO EFFECT YET), then put it aside: the 2 Gate Ore return exactly.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const hearth = await p.api.workshop.startUpgrade(p.hero, { stationId: "g2-bench", kind: "hearth", materials: { "g2-ore": 2 } });
  p.check("it is labelled 'no effect yet'", hearth.goalName === "Yard Bench: hearth 1 (no effect yet)", hearth.goalName);
  p.check("2 Gate Ore are held", p.look().ore === before.ore - 2);
  const back = await p.api.workshop.putAside(p.hero, hearth.id);
  p.check("putting it aside returns exactly the 2 Gate Ore", JSON.stringify(back) === JSON.stringify({ returned: [{ materialId: "g2-ore", units: 2 }] }) && JSON.stringify(p.look()) === JSON.stringify(before), JSON.stringify([back, p.look()]));
  const again = await p.refused(() => p.api.workshop.putAside(p.hero, hearth.id));
  p.check("a second put-aside is refused and returns nothing", again === '"Yard Bench: hearth 1 (no effect yet)" is abandoned, not active.' && JSON.stringify(p.look()) === JSON.stringify(before), again);
  const row = p.api.stationsFor(p.hero).find(s => s.id === "g2-bench");
  p.check("the Yard Bench still has no upgrades, and the hearth says 'no effect yet'", row.upgrades.craftDays === 0 && row.upgrades.hearths === 0 && row.upgrades.hearthNote === "no effect yet", JSON.stringify(row.upgrades));
  return p.done();
})();
```

## Step 17 [GM]: finish the upgrades (two craft-day cuts)

```js
// [GM] research the first cut to completion with the GM tool (forced critical successes, so it is certain), start and finish a second one. The GM tops up days to keep this short; in play the research runs through the queue.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  await g.api.grantDays(smith, 30);
  const before = g.look(smith);
  const one = await g.api.research({ actor: smith, project: "upgrade-g2-bench-craftDays-1", days: 10, skill: "crafting", degree: "criticalSuccess", chat: false });
  g.check("the first upgrade finished", one.completed === true, JSON.stringify(one.project?.status));
  g.check("the Yard Bench has craft-day level 1", g.row(smith, "g2-bench").upgrades.craftDays === 1, JSON.stringify(g.row(smith, "g2-bench").upgrades));
  g.check("the 2 escrowed Gate Ore were spent, not returned", g.look(smith).ore === before.ore, `${before.ore} -> ${g.look(smith).ore}`);
  g.check("the log says it finished", g.events().includes("upgrade finished: Yard Bench: craft days cut by 1 (researched by Gate Smith)"), g.events().filter(t => /upgrade/.test(t)).join(" | "));
  const second = await g.api.workshop.startUpgrade(smith, { stationId: "g2-bench", kind: "craftDays", materials: { "g2-gem": 3 } });
  g.check("the second cut needs tier-2 materials (3 Gate Gem)", second.id === "upgrade-g2-bench-craftDays-2" && g.look(smith).gem === before.gem - 3, `${before.gem} -> ${g.look(smith).gem}`);
  const two = await g.api.research({ actor: smith, project: second.id, days: 30, skill: "crafting", degree: "criticalSuccess", chat: false });
  g.check("the second upgrade finished", two.completed === true);
  g.check("the Yard Bench has craft-day level 2", g.row(smith, "g2-bench").upgrades.craftDays === 2, JSON.stringify(g.row(smith, "g2-bench").upgrades));
  const stored = (game.settings.get(g.M, "stationState") ?? []).find(e => e.stationId === "g2-bench");
  g.check("it is saved on the station, not on the character", stored?.upgrades?.craftDays === 2, JSON.stringify(stored));
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 18 [Player]: craft days drop, but never below 1

```js
// [Player] the blade takes 2 days; two cuts would make it 0, so it takes 1. The station fee is still charged. Cancel gives it all back.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "craft", { recipe: "g2-blade", selection: { body: "g2-ore" }, stationId: "g2-bench" });
  const after = p.look();
  p.check("1 day is reserved (2 days minus 2 cuts, but never below 1)", action.daysReserved === 1 && after.reserved === 1, action.daysReserved);
  p.check("the 1 gp station fee and 2 Gate Ore were taken", action.params.escrow.feeCopper === 100 && after.gold === before.gold - 1 && after.ore === before.ore - 2, JSON.stringify(after));
  const result = await p.api.queue.cancel(p.hero, action.id);
  p.check("cancel gives everything back", JSON.stringify(p.look()) === JSON.stringify(before), JSON.stringify([result, p.look()]));
  return p.done();
})();
```

## Step 19 [Player]: design a workshop (research)

```js
// [Player] you cannot build before you hold the design; researching it is an ordinary research project.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const early = await p.refused(() => p.api.queue.submit(p.hero, "build", { blueprint: "g2-camp", selection: { anvil: "g2-ore", hearthstone: "g2-gem" } }));
  p.check("building without the design is refused", early === "Gate Smith has not designed Yard Camp yet: research the design first.", early);
  const project = await p.api.workshop.startDesign(p.hero, { blueprint: "g2-camp" });
  p.check("the design project exists", project.id === "design-g2-camp" && project.goalName === "Design: Yard Camp" && project.status === "active", JSON.stringify([project.id, project.goalName]));
  const twice = await p.refused(() => p.api.workshop.startDesign(p.hero, { blueprint: "g2-camp" }));
  p.check("it cannot be started twice", twice === "Gate Smith is already designing Yard Camp.", twice);
  return p.done();
})();
```

## Step 20 [GM]: finish the design

```js
// [GM] finish the design research (forced critical successes). Smith now holds the design; nobody else does.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const out = await g.api.research({ actor: smith, project: "design-g2-camp", days: 10, skill: "crafting", degree: "criticalSuccess", chat: false });
  g.check("the design research finished", out.completed === true);
  g.check("Smith holds the design", (smith.getFlag(g.M, "blueprints") ?? []).some(b => b.blueprintId === "g2-camp"), JSON.stringify(smith.getFlag(g.M, "blueprints")));
  g.check("Gate Bystander does not", !(g.bystander().getFlag(g.M, "blueprints") ?? []).length);
  g.keep.spentBefore = g.api.downtime.state().participants[smith.id].spent;
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 21 [Player]: queue the build (materials, gold and days now) and a share

```js
// [Player] build Yard Camp: 3 Gate Ore + 1 Gate Gem + 25 gp are taken and 3 days reserved. Also queue a share (it must not block End downtime).
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const pick = { anvil: "g2-ore", hearthstone: "g2-gem" };
  const badTier = await p.refused(() => p.api.queue.submit(p.hero, "build", { blueprint: "g2-camp", selection: { anvil: "g2-ore", hearthstone: "g2-ore" } }));
  p.check("a material below a slot's tier is refused", /^Cannot queue this build \(Yard Camp\): slot "hearthstone": Gate Ore is tier 1 but the slot needs tier 2 or higher\.$/.test(badTier ?? ""), badTier);
  const badDays = await p.refused(() => p.api.queue.submit(p.hero, "build", { blueprint: "g2-camp", selection: pick }, 9));
  p.check("a made-up number of days is refused", badDays === "build: this build takes 3 day(s) (got 9); the time is set by the blueprint, leave days out", badDays);
  p.keep.beforeBuild = p.look();
  const before = p.keep.beforeBuild;
  const action = await p.api.queue.submit(p.hero, "build", { blueprint: "g2-camp", selection: pick });
  const after = p.look();
  p.check("3 days reserved, to be built in Yard Town", action.type === "build" && action.daysReserved === 3 && action.params.townName === "Yard Town", JSON.stringify([action.daysReserved, action.params.townName]));
  p.check("3 Gate Ore, 1 Gate Gem and 25 gp were taken now", after.ore === before.ore - 3 && after.gem === before.gem - 1 && after.gold === before.gold - 25, JSON.stringify(after));
  p.check("free days dropped by 3 and reserved is 3", after.free === before.free - 3 && after.reserved === 3, JSON.stringify(after));
  const share = await p.api.queue.submit(p.hero, "share", { kind: "creature", key: "gate wolf" });
  p.check("the share costs nothing", share.daysReserved === 0 && JSON.stringify(p.look()) === JSON.stringify(after));
  return p.done();
})();
```

## Step 22 [GM]: the build blocks End downtime, the share does not

```js
// [GM] End downtime is blocked by the build only (1 item), and stays open.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const rows = g.api.queue.list().filter(r => r.actorId === smith.id);
  g.check("the rows read Build: Yard Camp and Share: Gate Wolf (creature)", rows.map(r => r.label).sort().join("|") === "Build: Yard Camp|Share: Gate Wolf (creature)", rows.map(r => r.label).join("|"));
  const build = rows.find(r => r.label === "Build: Yard Camp");
  g.check("the build row shows its escrow and no odds", /3 day\(s\) reserved; to be built in Yard Town; escrow: 3x Gate Ore, 1x Gate Gem and a 25 gp fee/.test(build?.detail ?? "") && !/%|\bDC\b|odds|chance/i.test(build?.detail ?? ""), build?.detail);
  const blocked = await g.api.downtime.end();
  g.check("End downtime is blocked by 1 item (the build), and downtime stays open", blocked.blocked === 1 && g.api.downtime.isOpen(), JSON.stringify(blocked));
  g.check("the share is still queued", smith.getFlag(g.M, "pendingActions").some(a => a.type === "share"));
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 23 [Player]: cancel the build (everything returns, once) and queue it again

```js
// [Player] cancel returns the days, materials and gold exactly; a second cancel is refused; queue it again for the GM to resolve.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const build = p.pending().find(a => a.type === "build");
  const result = await p.api.queue.cancel(p.hero, build.id);
  p.check("everything is exactly as before the build was queued", JSON.stringify(p.look()) === JSON.stringify(p.keep.beforeBuild ?? p.look()) && p.keep.beforeBuild !== undefined, JSON.stringify([result, p.look(), p.keep.beforeBuild]));
  const again = await p.refused(() => p.api.queue.cancel(p.hero, build.id));
  p.check("a second cancel is refused (nothing returned twice)", /^Gate Smith has no queued action "[^"]+"$/.test(again ?? ""), again);
  p.check("still exactly as before", JSON.stringify(p.look()) === JSON.stringify(p.keep.beforeBuild));
  const action = await p.api.queue.submit(p.hero, "build", { blueprint: "g2-camp", selection: { anvil: "g2-ore", hearthstone: "g2-gem" } });
  p.check("queued again", action.type === "build" && p.look().reserved === 3);
  return p.done();
})();
```

## Step 24 [GM]: the party moved on: the build is invalid and everything is returned

```js
// [GM] move the party to Far Town, then resolve the build queued in Yard Town: invalid, all returned. Then put the party back.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const build = smith.getFlag(g.M, "pendingActions").find(a => a.type === "build");
  g.check("a build is queued", Boolean(build));
  const queued = g.look(smith);
  await g.api.setLocation("g2-away");
  let out;
  try { out = await g.api.queue.resolve(smith, build.id, { degree: "success", chat: false }); } finally { await g.api.setLocation("g2-town"); }
  g.check("it is invalid, with the plain reason", out.status === "invalid" && out.message === "The party is no longer in Yard Town (it is in Far Town). Your days, materials and gold were returned.", out.message);
  const back = g.look(smith);
  g.check("the days, materials and gold came back", back.reserved === 0 && back.free === queued.free + 3 && back.ore === queued.ore + 3 && back.gem === queued.gem + 1 && back.gold === queued.gold + 25, `${JSON.stringify(queued)} -> ${JSON.stringify(back)}`);
  g.check("nothing was built", g.partyStations().filter(s => s.blueprintId === "g2-camp").length === 0);
  g.check("the party is back in Yard Town", game.settings.get(g.M, "partyLocation") === "g2-town");
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 25 [Player]: queue the build once more

```js
// [Player] the party is back in Yard Town; queue the build for the GM to resolve.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "build", { blueprint: "g2-camp", selection: { anvil: "g2-ore", hearthstone: "g2-gem" } });
  const after = p.look();
  p.check("queued, with the escrow taken", action.type === "build" && after.reserved === 3 && after.ore === before.ore - 3 && after.gem === before.gem - 1 && after.gold === before.gold - 25, JSON.stringify(after));
  return p.done();
})();
```

## Step 26 [GM]: resolve the build: a party workshop appears (no roll)

```js
// [GM] resolve: the escrow is converted (nothing taken again), 3 days are spent, and a party-owned workshop stands in Yard Town.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const build = smith.getFlag(g.M, "pendingActions").find(a => a.type === "build");
  const queued = g.look(smith);
  const spentBefore = g.api.downtime.state().participants[smith.id].spent;
  const out = await g.api.queue.resolve(smith, build.id, { chat: false });
  g.check("it resolved", out.status === "resolved", out.message);
  const after = g.look(smith);
  g.check("nothing was taken a second time", after.gold === queued.gold && after.ore === queued.ore && after.gem === queued.gem && after.free === queued.free, JSON.stringify(after));
  g.check("3 days were spent, and none are reserved", g.api.downtime.state().participants[smith.id].spent === spentBefore + 3 && after.reserved === 0);
  const made = g.partyStations().filter(s => s.blueprintId === "g2-camp");
  g.check("exactly one party workshop was built", made.length === 1, JSON.stringify(made));
  const station = made[0] ?? {};
  g.check("it stands in Yard Town, tier 1, built by Smith", /^party-g2-camp-/.test(station.id ?? "") && station.town === "g2-town" && station.tier === 1 && station.builtBy === smith.id && station.name === "Yard Camp", JSON.stringify(station));
  g.keep.partyId = station.id;
  const row = g.row(smith, station.id);
  g.check("it shows as a party workshop here now", row?.source === "party" && row.reachable === true && row.where === "Yard Town", JSON.stringify(row));
  g.check("the log says so", g.events().some(t => new RegExp(`^resolved build: Yard Camp built in Yard Town for the party by Gate Smith; 3x Gate Ore, 1x Gate Gem and a 25 gp fee and 3 day\\(s\\) spent; station ${station.id}$`).test(t)), g.events().filter(t => /build/.test(t)).join(" | "));
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 27 [Player]: your own workshop charges no fee

```js
// [Player] craft at the party workshop: no station fee. The Yard Bench still charges 1 gp.
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const party = p.api.stationsFor(p.hero).find(s => s.source === "party");
  p.check("the party workshop is listed", Boolean(party) && party.name === "Yard Camp" && party.reachable === true, JSON.stringify(party));
  const sel = { body: "g2-ore" };
  p.check("a preview there shows a 0 gp fee", p.api.previewCraft(p.hero, "g2-blade", sel, party.id).plan.fee === 0);
  p.check("a preview at the Yard Bench still shows 1 gp", p.api.previewCraft(p.hero, "g2-blade", sel, "g2-bench").plan.fee === 1);
  const before = p.look();
  const free = await p.api.queue.submit(p.hero, "craft", { recipe: "g2-blade", selection: sel, stationId: party.id });
  p.check("queued there, with no fee in escrow and no gold taken", free.params.escrow.feeCopper === 0 && p.look().gold === before.gold, JSON.stringify(free.params.escrow));
  await p.api.queue.cancel(p.hero, free.id);
  const paid = await p.api.queue.submit(p.hero, "craft", { recipe: "g2-blade", selection: sel, stationId: "g2-bench" });
  p.check("queued at the Yard Bench, the 1 gp fee is taken", paid.params.escrow.feeCopper === 100 && p.look().gold === before.gold - 1, JSON.stringify(paid.params.escrow));
  await p.api.queue.cancel(p.hero, paid.id);
  p.check("both cancelled: exactly as before", JSON.stringify(p.look()) === JSON.stringify(before), JSON.stringify(p.look()));
  return p.done();
})();
```

## Step 28 [GM]: who may use it, and where

```js
// [GM] a party character may use it, the Bystander (nobody's character) may not, and the party must be in Yard Town.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const [smith, by] = [g.smith(), g.bystander()];
  const id = g.keep.partyId ?? g.partyStations().find(s => s.blueprintId === "g2-camp")?.id;
  g.check("the party workshop exists (run step 26 first)", Boolean(id));
  await g.api.grantFormula(by, "g2-blade");
  await g.api.giveMaterial(by, "g2-ore", 2);
  const sel = { body: "g2-ore" };
  g.check("Smith (a party character) may craft there", g.api.previewCraft(smith, "g2-blade", sel, id).ok === true, JSON.stringify(g.api.previewCraft(smith, "g2-blade", sel, id).errors));
  const refused = g.api.previewCraft(by, "g2-blade", sel, id);
  g.check("the Bystander may not", refused.ok === false && /not on its access list \(owner: party\)/.test(refused.errors.join(" ")), JSON.stringify(refused.errors));
  await g.api.setLocation("g2-away");
  let away;
  try { away = g.api.previewCraft(smith, "g2-blade", sel, id); } finally { await g.api.setLocation("g2-town"); }
  g.check("with the party in Far Town the workshop is out of reach", away.ok === false && /you are in Far Town, but it is in Yard Town/.test(away.errors.join(" ")), JSON.stringify(away.errors));
  g.check("back in Yard Town it works again", g.api.previewCraft(smith, "g2-blade", sel, id).ok === true);
  return g.done();
})();
```

## Step 29 [Player]: regression: queue one craft and one gather

```js
// [Player] the ordinary queue still works: one craft (at the Yard Bench) and one gather (on Yard Patch).
await (async () => {
  const p = globalThis.__p2 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const patch = p.scene().tokens.getName("Yard Patch");
  const before = p.look();
  const craft = await p.api.queue.submit(p.hero, "craft", { recipe: "g2-blade", selection: { body: "g2-ore" }, stationId: "g2-bench" });
  const gather = await p.api.queue.submit(p.hero, "gather", { sceneId: p.scene().id, tokenId: patch.id, skill: "survival" });
  const after = p.look();
  p.check("the craft took its escrow and reserved 1 day", craft.daysReserved === 1 && after.ore === before.ore - 2 && after.gold === before.gold - 1 && after.reserved === 1, JSON.stringify(after));
  p.check("the gather reserved no days and claimed a charge", gather.daysReserved === 0 && patch.getFlag(p.M, "node").reservedCharges === 1);
  p.keep.regression = p.look();
  return p.done();
})();
```

## Step 30 [GM]: regression: resolve both

```js
// [GM] resolve the craft and the gather: an item is made, ore is gathered, a charge is spent, and nothing is left over.
await (async () => {
  const g = globalThis.__g2 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const craft = smith.getFlag(g.M, "pendingActions").find(a => a.type === "craft");
  const gather = smith.getFlag(g.M, "pendingActions").find(a => a.type === "gather");
  g.check("a craft and a gather are queued", Boolean(craft && gather));
  const before = g.look(smith);
  const made = await g.api.queue.resolve(smith, craft.id, { degree: "success", chat: false });
  g.check("the craft resolved", made.status === "resolved", made.message);
  g.check("a Dagger was made", smith.items.some(i => i.name === "Dagger"), smith.items.map(i => i.name).join());
  const got = await g.api.queue.resolve(smith, gather.id, { degree: "success", chat: false });
  g.check("the gather resolved", got.status === "resolved", got.message);
  g.check("Gate Ore was gathered", g.look(smith).ore > before.ore, `${before.ore} -> ${g.look(smith).ore}`);
  g.check("Yard Patch has 2 charges left", g.scene().tokens.getName("Yard Patch").getFlag(g.M, "node").charges === 2);
  g.check("nothing is queued any more", g.api.queue.list().filter(r => r.actorId === smith.id).length === 1, g.api.queue.list().map(r => r.label).join("|"));
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

(One row is expected to remain: the Gate Wolf share from step 21. CLEANUP deletes it with the character.)

## Step 31 [GM]: CLEANUP (always run this, even if a step failed)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Smith", "Gate Bystander", "Gate Wolf"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway2") === true);
  const ids = actors.map(a => a.id);
  const scene = game.scenes.getName("Gate Yard");
  const ours = scene?.getFlag(M, "gateThrowaway2") === true ? scene : null;
  const user = game.users.getName("Test");

  for (const combat of game.combats?.filter(c => c.getFlag(M, "gateThrowaway2") === true) ?? []) await attempt("delete a combat", () => combat.delete());
  if (ours) {
    await attempt("party location", async () => { await game.settings.set(M, "partyLocation", ours.getFlag(M, "gateOriginalLocation") ?? ""); });
    await attempt("clear the map", () => api.clearMap(ours));
    await attempt("clear the anchors", () => api.clearAnchors(ours, { confirm: true }));
    await attempt("untag the scene", () => api.untagScene(ours, "g2-wood"));
    await attempt("the explorationState entry", async () => { const all = game.settings.get(M, "explorationState") ?? {}; delete all[ours.id]; await game.settings.set(M, "explorationState", all); });
    await attempt("delete the scene", () => ours.delete());
  }
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the Yard Bench's saved state", async () => { if ((game.settings.get(M, "stationState") ?? []).some(e => e.stationId === "g2-bench")) await api.clearStationState("g2-bench"); });
  await attempt("the party workshop", async () => { const list = game.settings.get(M, "partyStations") ?? []; if (list.some(s => s.blueprintId === "g2-camp")) await game.settings.set(M, "partyStations", list.filter(s => s.blueprintId !== "g2-camp")); });
  await attempt("the shared Compendium", async () => {
    const book = game.settings.get(M, "sharedCompendium");
    if (!book) return;
    const drop = (entries, keep) => Object.fromEntries(Object.entries(entries ?? {}).filter(([k, e]) => keep(k, e)));
    const next = { ...book, materials: drop(book.materials, k => !k.startsWith("g2-")), creatures: drop(book.creatures, (k, e) => e?.name !== "Gate Wolf"), regions: drop(book.regions, k => !k.startsWith("g2-")) };
    if (JSON.stringify(next) !== JSON.stringify(book)) await game.settings.set(M, "sharedCompendium", next);
  });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate |Yard /.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  for (const [kind, id] of [["blueprint", "g2-camp"], ["recipe", "g2-blade"], ["region", "g2-wood"], ["nodeType", "g2-patch"], ["station", "g2-bench"], ["material", "g2-gem"], ["material", "g2-hide"], ["material", "g2-ore"], ["town", "g2-away"], ["town", "g2-town"]]) api.definitions[kind].delete(id);
  delete globalThis.__g2;
  delete globalThis.__p2;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, sceneLeft: Boolean(game.scenes.getName("Gate Yard")), downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, stationStateLeft: (game.settings.get(M, "stationState") ?? []).filter(e => e.stationId === "g2-bench").length, partyStationsLeft: (game.settings.get(M, "partyStations") ?? []).filter(s => s.blueprintId === "g2-camp").length, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `sceneLeft: false`, `downtimeOpen: false`, `stationStateLeft: 0`, `partyStationsLeft: 0`, and the audit list empty. In the Player window, run `delete globalThis.__p2` (or just reload).
