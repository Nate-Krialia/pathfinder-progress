# 13 Stage 10a gate (real Foundry): craft and gather as queue items

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]** and has ONE code block. Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS` (or say how many failed): paste back anything that is not `ALL PASS`.

`tests/work-wiring.test.js` runs every block below, in order, against the real `main.js` in a fake Foundry, so the calls and argument shapes are known to run there. What it cannot show is what only a real Foundry shows: the PF2e rolls, the real token and actor documents, and socketlib carrying a player's call to the GM. That is what this gate is for.

**Safety.** Everything uses throwaway things named "Gate ...": the characters **Gate Hero** and **Gate Absent**, the scene **Gate Scene**, and in-memory fake definitions (`gate-blade`, `gate-ore`, `gate-gem`, `gate-bench`, `gate-town`, `gate-patch`; they exist only until you reload, and the SETUP block registers them again). SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, or a "Gate ..." actor or scene exists that it did not make. The SETUP block also uses the shared "Resource Node" actor for the node tokens (it creates it if missing and CLEANUP leaves it alone). CLEANUP always works, even if a step failed.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. Do this before anything else. The version must be **0.14.0**; if it is not, stop (the release may still be building).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.14.0"]` in the GM window and `["Test", false, "0.14.0"]` in the Player window.

## Step 2 [GM]: SETUP

```js
// [GM] SETUP: fake definitions (memory only), Gate Hero + Gate Absent, Gate Scene with nodes, 6 days of downtime, party at Gate Town.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway") === true;
  const [heroOld, awayOld, sceneOld] = [game.actors.getName("Gate Hero"), game.actors.getName("Gate Absent"), game.scenes.getName("Gate Scene")];
  if (![heroOld, awayOld, sceneOld].every(mine)) throw new Error('"Gate Hero", "Gate Absent" or "Gate Scene" already exists and was not made by this check; rename or delete it first');

  // The fake definitions go into the loaded registry (memory only). Safe to repeat. (The recipe names an output for every tier a loaded material could reach.)
  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const defs = [
    ["town", { kind: "town", id: "gate-town", name: "Gate Town" }],
    ["material", { kind: "material", id: "gate-ore", name: "Gate Ore", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "gate-gem", name: "Gate Gem", tier: 2, effects: { basePower: "T2" } }],
    ["station", { kind: "station", id: "gate-bench", name: "Gate Bench", category: "smithing", tier: 1, town: "gate-town" }],
    ["nodeType", { kind: "nodeType", id: "gate-patch", name: "Gate Patch", skills: ["survival"], charges: 3, ladders: { 1: [{ materialId: "gate-ore", dcOffset: 0, quantity: "1d4", guaranteed: true }] } }],
    ["recipe", { kind: "recipe", id: "gate-blade", name: "Gate Blade", category: "weapon", output: { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger }, craftLevel: 2, slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 2 }], stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  if (heroOld) return { already: "set up", note: "definitions re-registered; nothing else changed" };

  // Refuse to run against real data.
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);

  const flags = { [M]: { gateThrowaway: true } };
  const hero = await Actor.create({ name: "Gate Hero", type: "character", ownership: { default: 0, [test.id]: 3 }, flags });
  const away = await Actor.create({ name: "Gate Absent", type: "character", ownership: { default: 2 }, flags });   // observable by Test, but not owned
  const scene = await Scene.create({ name: "Gate Scene", width: 1400, height: 1000, grid: { size: 100 }, padding: 0, ownership: { default: 2 }, flags });
  let x = 100;
  for (const actor of [hero, away]) { const td = await actor.getTokenDocument({ x: (x += 100), y: 100 }); await scene.createEmbeddedDocuments("Token", [td.toObject()]); }
  const place = async (name, charges, at) => { const t = await api.placeNode(scene, { nodeType: "gate-patch", tier: 1, charges, x: at, y: 300 }); await t.update({ name }); return t; };
  const A = await place("Gate Patch A", 3, 500), B = await place("Gate Patch B", 1, 600), H = await place("Gate Patch H", 3, 800);
  await H.update({ hidden: true, [`flags.${M}.node.revealed`]: false });
  const anchor = await api.placeAnchor(scene, { x: 700, y: 300 });
  await anchor.update({ name: "Gate Anchor", [`flags.${M}.node.occupiedBy`]: B.id });
  await B.update({ [`flags.${M}.node.anchorId`]: anchor.id });

  await api.giveMaterial(hero, "gate-ore", 8);
  await api.adapter.addCopper(hero, 2000);
  await api.grantFormula(hero, "gate-blade");
  await scene.setFlag(M, "gateOriginalLocation", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("gate-town");
  await test.setFlag(M, "gateOriginalCharacter", test.character?.id ?? "none");
  await test.update({ character: hero.id });
  await api.downtime.start({ days: 6, actorIds: [hero.id, away.id] });

  // Helpers the later [GM] steps use (lost if you reload; just run SETUP again).
  const sumOre = a => a.items.filter(i => i.getFlag(M, "material")?.materialId === "gate-ore").reduce((n, i) => n + i.system.quantity, 0);
  const look = a => ({ gold: api.adapter.getCopper(a) / 100, ore: sumOre(a), free: a.getFlag(M, "downtimeDays") ?? 0, reserved: (a.getFlag(M, "pendingActions") ?? []).reduce((n, p) => n + p.daysReserved, 0), items: a.items.filter(i => !i.getFlag(M, "material")).map(i => i.name) });
  const rows = [];
  const g = {
    M, api, ids: { hero: hero.id, away: away.id, scene: scene.id, A: A.id, B: B.id, H: H.id, anchor: anchor.id }, look, base: look(hero),
    hero: () => game.actors.get(g.ids.hero), away: () => game.actors.get(g.ids.away), scene: () => game.scenes.get(g.ids.scene),
    node: key => g.scene().tokens.get(g.ids[key]),
    events: () => (game.settings.get(M, "auditLedger")._events?.history ?? []).map(h => h.text),
    check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
    done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
  };
  globalThis.__gate = g;
  return { hero: hero.name, away: away.name, scene: scene.name, nodes: [A.name, B.name, H.name], baseline: g.base, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object with the baseline `{ gold: 20, ore: 8, free: 6, reserved: 0, items: [] }` and `testUsersCharacter: "Gate Hero"`.

## Step 3 [Player]: the Player helper

Open **Gate Hero**'s sheet in this window and keep the inventory visible. Run:

```js
// [Player] helper for the next steps (lost on reload; just run it again).
globalThis.__p = (() => {
  const M = "pathfinder-progress", api = game.modules.get(M).api, hero = game.user.character;
  if (game.user.isGM || hero?.name !== "Gate Hero") throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  const scene = () => game.scenes.getName("Gate Scene");
  const node = name => scene()?.tokens.getName(name);
  const ore = () => hero.items.filter(i => i.getFlag(M, "material")?.materialId === "gate-ore").reduce((n, i) => n + i.system.quantity, 0);
  const pending = () => hero.getFlag(M, "pendingActions") ?? [];
  const look = () => ({ gold: api.adapter.getCopper(hero) / 100, ore: ore(), free: hero.getFlag(M, "downtimeDays") ?? 0, reserved: pending().reduce((n, a) => n + a.daysReserved, 0), queued: pending().map(a => a.type) });
  const rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const done = () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; };
  const refused = async fn => { try { await fn(); return null; } catch (error) { return error.message; } };
  const p = { M, api, hero, scene, node, look, pending, check, done, refused };
  p.base = look();
  return p;
})();
globalThis.__p.base
```

Expected: `{ gold: 20, ore: 8, free: 6, reserved: 0, queued: [] }`. If the scene or nodes are not visible to you, the GM should check that Gate Scene exists.

## Step 4 [Player]: queue a craft (escrow is taken NOW)

```js
// [Player] queue the craft: the materials, the station fee and the days leave you immediately.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } });
  const after = p.look();
  const fee = action.params.escrow.feeCopper / 100;
  p.check("2 craft days were reserved", action.daysReserved === 2, action.daysReserved);
  p.check("2 Gate Ore left your inventory", after.ore === before.ore - 2, `${before.ore} -> ${after.ore}`);
  p.check("the station fee left your purse", fee > 0 && after.gold === before.gold - fee, `${before.gold} -> ${after.gold} gp (fee ${fee})`);
  p.check("free days dropped by 2, reserved is 2", after.free === before.free - 2 && after.reserved === 2, `${before.free} -> ${after.free} free, ${after.reserved} reserved`);
  p.check("the craft is queued", JSON.stringify(after.queued) === '["craft"]');
  return p.done();
})();
```

Also look at Gate Hero's sheet: the Gate Ore stack dropped by 2 and the gold dropped by the fee.

## Step 5 [GM]: what the GM sees

```js
// [GM] the queue row, the audit and the log.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const row = g.api.queue.list().find(r => r.actorId === g.ids.hero);
  g.check("the row reads Craft: Gate Blade", row?.label === "Craft: Gate Blade", row?.label);
  g.check("the row shows the escrow", /escrow: 2x Gate Ore and a 1 gp fee/.test(row?.detail ?? ""), row?.detail);
  g.check("the row shows no odds", !/%|\bDC\b|odds|chance/i.test(row?.detail ?? ""));
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  g.check("the log says the escrow was taken", g.events().some(t => /^queued craft: Gate Blade for Gate Hero; escrow taken: 2x Gate Ore and a 1 gp fee; 2 day\(s\) reserved$/.test(t)));
  return g.done();
})();
```

## Step 6 [Player]: cancel gives everything back, once

```js
// [Player] cancel your own queued craft: days, materials and fee all return; a second cancel finds nothing.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const [action] = p.pending();
  const result = await p.api.queue.cancel(p.hero, action.id);
  const after = p.look();
  p.check("cancel refunded 2 days", result.refunded === 2, JSON.stringify(result));
  p.check("gold, ore and days are exactly as at the start", JSON.stringify(after) === JSON.stringify(p.base), JSON.stringify(after));
  const again = await p.refused(() => p.api.queue.cancel(p.hero, action.id));
  p.check("a second cancel is refused (nothing is returned twice)", /has no queued action/.test(again ?? ""), again);
  p.check("still exactly as at the start", JSON.stringify(p.look()) === JSON.stringify(p.base));
  return p.done();
})();
```

## Step 7 [Player]: shortfall and bad-request refusals change nothing

```js
// [Player] refusals say what is missing, point at the Compendium for shortages, and change nothing.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const short = await p.refused(() => p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-gem" } }));
  p.check("a material you do not have is refused with the Compendium pointer", /needs 2 Gate Gem but only 0 available/.test(short ?? "") && /Compendium/.test(short ?? ""), short);
  const empty = await p.refused(() => p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: {} }));
  p.check("an empty slot is refused", /slot "body": no material selected/.test(empty ?? ""), empty);
  const days = await p.refused(() => p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } }, 5));
  p.check("a made-up number of days is refused", /this craft takes 2 day\(s\) \(got 5\)/.test(days ?? ""), days);
  p.check("nothing changed", JSON.stringify(p.look()) === JSON.stringify(p.base), JSON.stringify(p.look()));
  return p.done();
})();
```

## Step 8 [Player]: queue the craft again (to be resolved)

This is the **same block as step 4**, repeated so every step has its own. (Gold now 20 minus the fee, ore 6, 4 free days, 2 reserved.)

```js
// [Player] queue the craft: the materials, the station fee and the days leave you immediately.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } });
  const after = p.look();
  const fee = action.params.escrow.feeCopper / 100;
  p.check("2 craft days were reserved", action.daysReserved === 2, action.daysReserved);
  p.check("2 Gate Ore left your inventory", after.ore === before.ore - 2, `${before.ore} -> ${after.ore}`);
  p.check("the station fee left your purse", fee > 0 && after.gold === before.gold - fee, `${before.gold} -> ${after.gold} gp (fee ${fee})`);
  p.check("free days dropped by 2, reserved is 2", after.free === before.free - 2 && after.reserved === 2, `${before.free} -> ${after.free} free, ${after.reserved} reserved`);
  p.check("the craft is queued", JSON.stringify(after.queued) === '["craft"]');
  return p.done();
})();
```

## Step 9 [GM]: resolve a SUCCESS; gold, days and materials each move exactly once

```js
// [GM] resolve the queued craft as a success and check the escrow was converted, not taken again.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero();
  const [action] = hero.getFlag(g.M, "pendingActions");
  const before = g.look(hero);
  const out = await g.api.queue.resolve(hero, action.id, { degree: "success", chat: true });
  const after = g.look(hero);
  g.check("resolved", out.status === "resolved", out.message);
  g.check("no second charge: gold did not move at resolve", after.gold === before.gold, `${before.gold} -> ${after.gold}`);
  g.check("the fee left the purse exactly once", Math.round((g.base.gold - after.gold) * 100) === action.params.escrow.feeCopper, `${g.base.gold} -> ${after.gold}`);
  g.check("no second material charge", after.ore === before.ore, `${before.ore} -> ${after.ore}`);
  g.check("free days did not move at resolve; nothing is reserved any more", after.free === before.free && after.reserved === 0, JSON.stringify(after));
  g.check("exactly 2 days were spent in total", (g.base.free + g.base.reserved) - (after.free + after.reserved) === 2);
  g.check("a Dagger was made", after.items.length === 1 && /Dagger/.test(after.items[0]), after.items.join());
  g.check("the downtime log shows 2 days spent", g.api.downtime.state().participants[g.ids.hero].spent === 2);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

Now look at the chat: you (GM) got a whisper with the plain result and a second GM-only whisper with the roll line. In the Player window you should see ONE whispered card ("Gate Hero crafts Gate Blade: Success ... Station fee: 1 gp (paid when you queued it)") and no raw rolls. There should be no public card from PF2e.

## Step 10 [Player]: queue the craft a second time

This is the **same block as step 4**, repeated so every step has its own. (Ore is 6 after the success, so it takes 2 and leaves 4.)

```js
// [Player] queue the craft: the materials, the station fee and the days leave you immediately.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } });
  const after = p.look();
  const fee = action.params.escrow.feeCopper / 100;
  p.check("2 craft days were reserved", action.daysReserved === 2, action.daysReserved);
  p.check("2 Gate Ore left your inventory", after.ore === before.ore - 2, `${before.ore} -> ${after.ore}`);
  p.check("the station fee left your purse", fee > 0 && after.gold === before.gold - fee, `${before.gold} -> ${after.gold} gp (fee ${fee})`);
  p.check("free days dropped by 2, reserved is 2", after.free === before.free - 2 && after.reserved === 2, `${before.free} -> ${after.free} free, ${after.reserved} reserved`);
  p.check("the craft is queued", JSON.stringify(after.queued) === '["craft"]');
  return p.done();
})();
```

## Step 11 [GM]: resolve a FAILURE; the fee and days are still spent, materials are lost per unit

```js
// [GM] resolve as a failure: the fee and the days are spent anyway; only the materials are rolled, per unit.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero();
  const [action] = hero.getFlag(g.M, "pendingActions");
  const before = g.look(hero);
  const out = await g.api.queue.resolve(hero, action.id, { degree: "failure", chat: true });
  const after = g.look(hero);
  const returned = after.ore - before.ore;
  g.check("resolved as a failure, no item", out.status === "resolved" && /not made \(failure\)/.test(out.message) && after.items.length === before.items.length, out.message);
  g.check("the fee was already taken, and it stays spent", after.gold === before.gold, `${before.gold} -> ${after.gold}`);
  g.check("the 2 days stay spent", after.free === before.free && after.reserved === 0 && (before.free + before.reserved) - (after.free + after.reserved) === 2, JSON.stringify(after));
  g.check("each of the 2 units was kept or lost: 0, 1 or 2 came back", returned >= 0 && returned <= 2, `${returned} of 2 came back`);
  g.check("no audit mismatches", g.api.audit.scan().length === 0);
  console.log(`(information) ${2 - returned} of 2 units were lost this time; run steps 10-11 again to see other results`);
  return g.done();
})();
```

## Step 12 [Player]: queue the craft a third time

This is the **same block as step 4**, repeated so every step has its own. (You have 2 free days left, so it reserves them.)

```js
// [Player] queue the craft: the materials, the station fee and the days leave you immediately.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const action = await p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } });
  const after = p.look();
  const fee = action.params.escrow.feeCopper / 100;
  p.check("2 craft days were reserved", action.daysReserved === 2, action.daysReserved);
  p.check("2 Gate Ore left your inventory", after.ore === before.ore - 2, `${before.ore} -> ${after.ore}`);
  p.check("the station fee left your purse", fee > 0 && after.gold === before.gold - fee, `${before.gold} -> ${after.gold} gp (fee ${fee})`);
  p.check("free days dropped by 2, reserved is 2", after.free === before.free - 2 && after.reserved === 2, `${before.free} -> ${after.free} free, ${after.reserved} reserved`);
  p.check("the craft is queued", JSON.stringify(after.queued) === '["craft"]');
  return p.done();
})();
```

## Step 13 [GM]: a craft BLOCKS End downtime; rejecting it returns everything

```js
// [GM] End downtime is blocked by the queued craft; reject returns the escrow; then End downtime works.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero();
  const [action] = hero.getFlag(g.M, "pendingActions");
  const queued = g.look(hero);
  const blocked = await g.api.downtime.end();
  g.check("End downtime is blocked by the queued craft", blocked.blocked === 1 && g.api.downtime.isOpen(), JSON.stringify(blocked));
  const result = await g.api.queue.reject(hero, action.id, { chat: false });
  const after = g.look(hero);
  g.check("reject returned the days, the materials and the fee", result.refunded === 2 && after.ore === queued.ore + 2 && after.gold === queued.gold + action.params.escrow.feeCopper / 100 && after.free === queued.free + 2 && after.reserved === 0, JSON.stringify(after));
  const ended = await g.api.downtime.end();
  g.check("End downtime now works", ended.ended === true && !g.api.downtime.isOpen(), JSON.stringify(ended));
  g.check("no audit mismatches", g.api.audit.scan().length === 0);
  return g.done();
})();
```

## Step 14 [Player]: a craft is refused outside downtime

```js
// [Player] downtime is closed now: crafting is refused in plain words and nothing is taken.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.look();
  const refusal = await p.refused(() => p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } }));
  p.check("refused with the plain message", /Downtime isn't open right now/.test(refusal ?? ""), refusal);
  p.check("nothing was taken", JSON.stringify(p.look()) === JSON.stringify(before), JSON.stringify(p.look()));
  return p.done();
})();
```

## Step 15 [Player]: a gather needs no downtime; cancel gives the charge back

```js
// [Player] queue a gather with downtime CLOSED, cancel it (charge back), then queue it again for the GM to resolve.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const patch = p.node("Gate Patch A");
  if (!patch) throw new Error("cannot see Gate Patch A on Gate Scene; ask the GM to check the scene is visible to players");
  const target = { sceneId: p.scene().id, tokenId: patch.id };
  const record = () => patch.getFlag(p.M, "node");
  const before = p.look();
  const first = await p.api.queue.submit(p.hero, "gather", target);
  p.check("queued with downtime closed, no days", first.type === "gather" && first.daysReserved === 0 && p.look().free === before.free);
  p.check("one charge is claimed on the node", record().reservedCharges === 1 && record().charges === 3, JSON.stringify(record()));
  await p.api.queue.cancel(p.hero, first.id);
  p.check("cancel gave the charge back (no claim left)", !("reservedCharges" in record()) && record().charges === 3, JSON.stringify(record()));
  const second = await p.api.queue.submit(p.hero, "gather", target);
  p.check("queued again", p.pending().some(a => a.id === second.id) && record().reservedCharges === 1);
  return p.done();
})();
```

## Step 16 [GM]: resolve the gather (downtime is still closed)

```js
// [GM] resolve the gather with downtime closed: materials arrive, one charge is spent, no days move.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero();
  const [action] = hero.getFlag(g.M, "pendingActions");
  const before = g.look(hero);
  const out = await g.api.queue.resolve(hero, action.id, { degree: "success", chat: true });
  const after = g.look(hero), record = g.node("A").getFlag(g.M, "node");
  g.check("downtime is closed and it still resolved", !g.api.downtime.isOpen() && out.status === "resolved", out.message);
  g.check("Gate Ore arrived (1 to 4)", after.ore - before.ore >= 1 && after.ore - before.ore <= 4, `${before.ore} -> ${after.ore}`);
  g.check("the claim became a spent charge: 2 left, no claim", record.charges === 2 && !("reservedCharges" in record), JSON.stringify(record));
  g.check("no days moved", after.free === before.free && after.reserved === 0);
  g.check("no audit mismatches", g.api.audit.scan().length === 0);
  return g.done();
})();
```

## Step 17 [GM]: queue Gate Absent's gather on the LAST charge of Gate Patch B

```js
// [GM] Gate Absent claims the last charge on Gate Patch B (a GM can queue for anyone).
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const action = await g.api.queue.submit(g.away(), "gather", { sceneId: g.ids.scene, tokenId: g.ids.B });
  const record = g.node("B").getFlag(g.M, "node");
  g.check("queued for Gate Absent", action.type === "gather" && action.daysReserved === 0);
  g.check("the last charge is claimed", record.charges === 1 && record.reservedCharges === 1, JSON.stringify(record));
  return g.done();
})();
```

## Step 18 [Player]: the last charge cannot be taken twice, and other people's items are not yours

```js
// [Player] contention and permissions: the claimed charge, the hidden node, and someone else's queued item.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const sceneId = p.scene().id;
  const taken = await p.refused(() => p.api.queue.submit(p.hero, "gather", { sceneId, tokenId: p.node("Gate Patch B").id }));
  p.check("the last charge is already claimed", /Gate Patch B has no free charge left: every charge it has is already claimed by a queued gather/.test(taken ?? ""), taken);
  const hiddenNode = p.node("Gate Patch H");
  if (hiddenNode) {
    const hidden = await p.refused(() => p.api.queue.submit(p.hero, "gather", { sceneId, tokenId: hiddenNode.id }));
    p.check("a node nobody has found is refused", /Gate Patch H has not been found yet/.test(hidden ?? ""), hidden);
  } else {
    p.check("a node nobody has found is not even visible to you", true);
  }
  const away = game.actors.getName("Gate Absent");
  if (!away) throw new Error("cannot see Gate Absent; the GM should check its ownership allows observing");
  const theirs = (away.getFlag(p.M, "pendingActions") ?? [])[0];
  p.check("Gate Absent has a queued gather to try to cancel", theirs?.type === "gather");
  const cancel = await p.refused(() => p.api.queue.cancel(away, theirs.id));
  p.check("cancelling someone else's item is refused", /does not own Gate Absent|you do not own/.test(cancel ?? ""), cancel);
  p.check("their item is still queued", (away.getFlag(p.M, "pendingActions") ?? []).length === 1);
  return p.done();
})();
```

## Step 19 [GM]: the last charge deletes the node; the anchor stays occupied

```js
// [GM] resolve Gate Absent's gather: Gate Patch B runs dry and is DELETED; a small depleted record stays; the anchor stays occupied.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const away = g.away();
  const [action] = away.getFlag(g.M, "pendingActions");
  const out = await g.api.queue.resolve(away, action.id, { degree: "success", chat: true });
  const state = game.settings.get(g.M, "explorationState")[g.ids.scene] ?? {};
  const leftovers = g.scene().tokens.filter(t => t.getFlag(g.M, "node") && t.getFlag(g.M, "node").state !== "anchor" && t.name === "Gate Patch B");
  g.check("resolved", out.status === "resolved", out.message);
  g.check("the node token is gone, no hidden token left behind", !g.node("B") && leftovers.length === 0);
  g.check("a small depleted record stays", state.depleted?.length === 1 && state.depleted[0].name === "Gate Patch B" && state.depleted[0].anchorId === g.ids.anchor, JSON.stringify(state.depleted));
  g.check("the anchor stays occupied (nothing respawns)", g.node("anchor").getFlag(g.M, "node").occupiedBy === g.ids.B);
  g.check("Gate Absent received Gate Ore", g.look(away).ore >= 1, g.look(away).ore);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 20 [GM]: open a new period of downtime

```js
// [GM] a new period: 4 days each for Gate Hero and Gate Absent.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  await g.api.downtime.start({ days: 4, actorIds: [g.ids.hero, g.ids.away] });
  g.check("downtime is open", g.api.downtime.isOpen());
  g.check("Gate Hero has 4 free days", g.look(g.hero()).free === 4, g.look(g.hero()).free);
  return g.done();
})();
```

## Step 21 [Player]: queue a craft AND a gather

```js
// [Player] one craft (reserves 2 days, takes its escrow) and one gather (claims a charge on Gate Patch A) at the same time.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const patch = p.node("Gate Patch A");
  const before = p.look();
  const craft = await p.api.queue.submit(p.hero, "craft", { recipe: "gate-blade", selection: { body: "gate-ore" } });
  const gather = await p.api.queue.submit(p.hero, "gather", { sceneId: p.scene().id, tokenId: patch.id });
  const after = p.look();
  p.check("the craft reserved 2 days and took 2 Gate Ore", craft.daysReserved === 2 && after.ore === before.ore - 2 && after.reserved === 2, JSON.stringify(after));
  p.check("the gather reserved no days", gather.daysReserved === 0);
  p.check("Gate Patch A has one charge claimed", patch.getFlag(p.M, "node").reservedCharges === 1);
  p.check("both are queued", JSON.stringify(after.queued) === '["craft","gather"]', JSON.stringify(after.queued));
  return p.done();
})();
```

## Step 22 [GM]: End downtime is blocked by the craft but not by the gather

```js
// [GM] the craft blocks End downtime and the gather does not; the gather stays queued and still resolves after the end.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero();
  const craft = hero.getFlag(g.M, "pendingActions").find(a => a.type === "craft");
  const gather = hero.getFlag(g.M, "pendingActions").find(a => a.type === "gather");
  g.check("a craft and a gather are queued", Boolean(craft && gather));
  const blocked = await g.api.downtime.end();
  g.check("blocked by the craft only (1 item blocks)", blocked.blocked === 1 && g.api.downtime.isOpen(), JSON.stringify(blocked));
  await g.api.queue.reject(hero, craft.id, { chat: false });
  const ended = await g.api.downtime.end();
  g.check("with only the gather left, End downtime works", ended.ended === true && ended.rejected === 0 && !g.api.downtime.isOpen(), JSON.stringify(ended));
  g.check("the gather is still queued with its charge claimed", hero.getFlag(g.M, "pendingActions").some(a => a.id === gather.id) && g.node("A").getFlag(g.M, "node").reservedCharges === 1);
  const out = await g.api.queue.resolve(hero, gather.id, { degree: "success", chat: false });
  g.check("it still resolves after downtime ended", out.status === "resolved", out.message);
  g.check("Gate Patch A has 1 charge left", g.node("A").getFlag(g.M, "node").charges === 1);
  g.check("no audit mismatches", g.api.audit.scan().length === 0);
  return g.done();
})();
```

## Step 23 [Player]: queue a gather on the last charge of Gate Patch A

```js
// [Player] Gate Patch A has 1 charge left and downtime is closed: queue a gather on it.
await (async () => {
  const p = globalThis.__p ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const patch = p.node("Gate Patch A");
  const gather = await p.api.queue.submit(p.hero, "gather", { sceneId: p.scene().id, tokenId: patch.id });
  const record = patch.getFlag(p.M, "node");
  p.check("queued with downtime closed", gather.type === "gather" && gather.daysReserved === 0);
  p.check("the last charge is claimed", record.charges === 1 && record.reservedCharges === 1, JSON.stringify(record));
  return p.done();
})();
```

## Step 24 [GM]: Clear map with a gather waiting

```js
// [GM] Clear map deletes the nodes and reports the waiting gather; it then resolves as invalid and nothing stays claimed.
await (async () => {
  const g = globalThis.__gate ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero();
  const [gather] = hero.getFlag(g.M, "pendingActions");
  g.check("a gather is waiting", gather?.type === "gather");
  const cleared = await g.api.clearMap(g.scene());
  g.check("Clear map reports 1 orphaned gather and the 1 depleted record", cleared.orphanedGathers === 1 && cleared.depletedCleared === 1, JSON.stringify(cleared));
  g.check("the nodes are gone and the anchor is free", !g.node("A") && !g.node("H") && g.node("anchor").getFlag(g.M, "node").occupiedBy === undefined);
  const out = await g.api.queue.resolve(hero, gather.id, { degree: "success", chat: false });
  g.check("the waiting gather resolves as invalid, nothing spent", out.status === "invalid" && /is gone \(the map was cleared\)/.test(out.message), out.message);
  g.check("the queue is empty", g.api.queue.list().length === 0);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 25 [GM]: CLEANUP (always run this, even if a step failed)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Hero", "Gate Absent"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway") === true);
  const ids = actors.map(a => a.id);
  const scene = game.scenes.getName("Gate Scene");
  const ours = scene?.getFlag(M, "gateThrowaway") === true ? scene : null;
  const user = game.users.getName("Test");

  if (ours) {
    await attempt("party location", async () => { await game.settings.set(M, "partyLocation", ours.getFlag(M, "gateOriginalLocation") ?? ""); });
    await attempt("clear the map", () => api.clearMap(ours));
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
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate (Hero|Absent|Patch|Blade|Ore|Gem|Bench)/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  for (const [kind, id] of [["recipe", "gate-blade"], ["nodeType", "gate-patch"], ["station", "gate-bench"], ["material", "gate-gem"], ["material", "gate-ore"], ["town", "gate-town"]]) api.definitions[kind].delete(id);
  delete globalThis.__gate;
  delete globalThis.__p;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, sceneLeft: Boolean(game.scenes.getName("Gate Scene")), downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `sceneLeft: false`, `downtimeOpen: false`, and the audit list empty. In the Player window, run `delete globalThis.__p` (or just reload).
