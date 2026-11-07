# 22 Tags gate, item references (a PROBE, real Foundry): how does an item reach a tagged slot?

Run in a real world on PF2e 8.6.1. Steps 1 to 9 use the **GM window** only; Steps 10 to 15 also use an **incognito Player window logged in as the user "Test"**. **Steps 1 to 5 are a PROBE, not a test.** The fake Foundry cannot say what real Foundry and PF2e write into `_stats` when an item is copied onto an actor (the fake's tests write `_stats` by hand), and the tag ledger finds an ordinary item by exactly those fields (`docs/22-tags-slice1.md`, "What fills a tagged slot"). So this gate only **makes copies of an item by every route we know and prints what each copy carries**. A `PASS:` line means "the route was tried and its values are printed", **not** that the values are what we hoped; a `FAIL:` line means the module's own helper misbehaved. Paste back **all** the lines, whatever they say: the values are the result.

**Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".**

`tests/gate22.test.js` plays every block in a fake Foundry that is given just enough pretend compendium, world items and drop functions to run them. It proves the blocks run, print one line per route and clean up after themselves. **It proves nothing about what real Foundry writes: that is what this gate is for.**

**Steps 6 to 16 were added after the probe was run** (module build 0898833). The probe showed that copies of compendium items and of imported world items carry `_stats.compendiumSource`, so a tag on the compendium item matches them, and that a copy of a plain world item (one made from scratch) carries no source, so its tag never matches copies. **Decision: no fallback code.** The GM puts a homebrew item into a compendium once and uses copies dropped from there; the Item tags window warns when an item offers only its own uuid. Steps 6 to 16 check that, then check the rest of the item path on a real craft: tag it, see it in the player's window, queue and cancel, queue and fail, resolve a success, and scan what the player's client holds.
- Steps are never renumbered. **Steps 6 to 15 need SETUP (Step 2) to have run:** if you ran CLEANUP (Step 5), run Step 2 again first. Finish with **Step 16** (CLEANUP 2), not Step 5.
- The stack-merge check is skipped: the probe showed no merge on a real drop.
- Steps 4 and 9 are real drops. Without the runner's drop action (see `e2e/steps/gate22.steps.mjs`) they are **hand** steps: drag as the bullets say.

## What each line says

One line per route, nothing cut: `route | name=… | uuid=… | _stats=… | flags.core=… | quantity=… | refsOf=…`.
- `uuid` is the copy's own uuid; `_stats` is the whole stats object (`compendiumSource`, `duplicateSource`, `createdTime`, ...); `flags.core` is the legacy field (`sourceId`); `quantity` is `system.quantity`.
- `refsOf` is `game.modules.get("pathfinder-progress").api.tags.refsOf(item)`: `candidates` (the references the copy could be tagged under, most trusted first: `crafted:<id>`, `_stats.compendiumSource`, `_stats.duplicateSource`, `flags.core.sourceId`, then its own uuid), `matched` (the first candidate that is in the ledger; `null` here, because this gate tags nothing), `tags`, `tier` and `fitsBySlot`.

## The routes

| Id | What it does |
|---|---|
| 0a, 0b | the two world items SETUP made, as they are (the source for routes 2 and 5) |
| 1a | the compendium item, `toObject()`, created on Gate G22 Smith |
| 1b | the compendium item through `game.items.fromCompendium()` (Foundry's own import data), created on Smith |
| 1c | the compendium item through `Item.implementation.fromDropData()` (what a drop calls first), created on Smith |
| 2a, 2b | the world item that was imported from the compendium, onto Smith by `toObject()` and by `fromDropData()` |
| 2c, 2d | the world item that has no source at all, onto Smith by `toObject()` and by `fromDropData()` |
| 3a, 3b | Smith's own copy (1a) copied to Gate G22 Friend by `toObject()`, and cloned to Friend with `clone({}, { parent, save, addSource })` |
| 4 | an item created with ONLY `_stats.compendiumSource` written |
| 5a | an item created with ONLY `_stats.duplicateSource` written |
| 5b, 5c | the plain world item duplicated the way Foundry's own Duplicate does (`clone({}, { save, addSource })`), then that duplicate onto Smith |
| 6 | an item created with ONLY `flags.core.sourceId` written |
| 7a to 7c | (Step 4, by hand or by the runner's drop action) the compendium item, the world item and the compendium item again, dropped on Smith's sheet |

## What the later steps depend on (they are NOT written yet)

- **Which reference the GM tags a compendium item under:** rows 1a to 1c and 7a. If `_stats.compendiumSource` is the compendium item's uuid, tagging the compendium item tags every copy (design as written). If it is empty, the compendium route does not work and the design needs a decision.
- **Whether a world item reaches an actor:** rows 2a to 2d, 5b, 5c and 7b. Three outcomes are possible: the copy carries `duplicateSource` naming the world item (the design's assumption), nothing, or the world item's own `compendiumSource`. This decides whether a world item tagged by its uuid is ever found on an actor.
- **Whether a copy on an actor can be tagged by its own uuid and survive a move:** rows 3a and 3b (does the copy of a copy keep the original source, or point at the first copy?).
- **Whether the old `flags.core.sourceId` fallback is alive:** row 6. If Foundry has moved the value into `_stats.compendiumSource`, route 6 is just route 4 and the fallback is dead code.
- **Whether `_stats.duplicateSource` and `_stats.compendiumSource` survive being written at creation:** rows 4 and 5a.
- **How a stack counts, and how escrow must hand items back:** rows 7a and 7c (`quantity`: does PF2e merge a second drop into the first stack?).
- **The tagging step, the escrow step, the player window and the leak scan** all follow from the table above. They are written only after you paste this gate's lines back.

## Step 1 [GM]: force-reload, then check who and what version you are

**What to do and see:**
- Force-reload the GM window first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.22.0**; if it is not, stop (the release may still be building).
- Run the block below in the GM window.
- You should see: `["<your GM name>", true, "0.22.0", true]` (the last value says this build has the `refsOf` helper).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version, typeof game.modules.get("pathfinder-progress").api.tags?.refsOf === "function"]
```


## Step 2 [GM]: SETUP

**What to do and see:**
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts `globalThis.__g22` back).
- You should see: an object with `compendium` (the item and its uuid), `worldItem`, `worldPlain`, `actors` (`Gate G22 Smith`, owned by Test, and `Gate G22 Friend`) and `planted` (four lines). On a rerun it says `already: "set up"`.
- If it stops with `has no item named "Torch"`, change `NAME` at the top of the block to any equipment item that exists in that pack, and run it again.

```js
// [GM] SETUP: two throwaway characters (Gate G22 Smith, owned by Test, and Gate G22 Friend), a world item imported from one real PF2e compendium item (Gate G22 World Item) and a
// plain world item (Gate G22 World Plain). Nothing is tagged. Says what it planted.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const PACK = "pf2e.equipment-srd", NAME = "Torch";
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (typeof api.tags?.refsOf !== "function") throw new Error("this world is not on a build with api.tags.refsOf yet: update the module and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway22") === true;
  for (const n of ["Smith", "Friend"]) if (!mine(game.actors.getName(`Gate G22 ${n}`))) throw new Error(`"Gate G22 ${n}" already exists and was not made by this check; rename or delete it first`);
  for (const n of ["World Item", "World Plain"]) if (!mine(game.items.getName(`Gate G22 ${n}`))) throw new Error(`The world item "Gate G22 ${n}" already exists and was not made by this check; rename or delete it first`);
  const pack = game.packs.get(PACK);
  if (!pack) throw new Error(`There is no compendium "${PACK}" in this world`);
  const entry = (await pack.getIndex()).find(e => e.name === NAME);
  if (!entry) throw new Error(`The compendium "${PACK}" has no item named "${NAME}": change NAME at the top of this block to an equipment item that exists there`);
  const comp = await pack.getDocument(entry._id);
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, comp, rows, keep: {},
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g22 = g;
    return g;
  };
  const saved = test.getFlag(M, "gateSetup22");
  const smithOld = game.actors.getName("Gate G22 Smith"), friendOld = game.actors.getName("Gate G22 Friend"), worldOld = game.items.getName("Gate G22 World Item"), plainOld = game.items.getName("Gate G22 World Plain");
  if (saved && smithOld && friendOld && worldOld && plainOld) {
    build({ smith: smithOld.id, friend: friendOld.id, world: worldOld.id, plain: plainOld.id });
    return { already: "set up", rebuilt: "globalThis.__g22", compendium: saved.compendium };
  }
  const flags = { [M]: { gateThrowaway22: true } };
  const smith = smithOld ?? await Actor.create({ name: "Gate G22 Smith", type: "character", ownership: { default: 0, [test.id]: 3 }, flags });
  const friend = friendOld ?? await Actor.create({ name: "Gate G22 Friend", type: "character", ownership: { default: 0 }, flags });
  const imported = game.items.fromCompendium(comp);
  const worldItem = worldOld ?? await Item.create({ ...imported, name: "Gate G22 World Item", flags: { ...(imported.flags ?? {}), ...flags } });
  const worldPlain = plainOld ?? await Item.create({ name: "Gate G22 World Plain", type: "equipment", system: { quantity: 1 }, flags });
  build({ smith: smith.id, friend: friend.id, world: worldItem.id, plain: worldPlain.id });
  const compendium = { uuid: comp.uuid, name: comp.name, pack: PACK };
  await test.setFlag(M, "gateSetup22", { compendium, worldItemUuid: worldItem.uuid, worldPlainUuid: worldPlain.uuid, smithName: smith.name });
  return {
    planted: [
      "the characters Gate G22 Smith (owned by Test) and Gate G22 Friend",
      `the world item Gate G22 World Item, imported from the compendium item ${comp.name}`,
      "the world item Gate G22 World Plain, with no source at all",
      "nothing is tagged: this gate only reads"
    ],
    compendium, worldItem: worldItem.uuid, worldPlain: worldPlain.uuid, actors: [smith.name, friend.name]
  };
})();
```


## Step 3 [GM]: the probe (copies by every route we can script)

**What to do and see:**
- Run the block below in the GM window. It is safe to run again: it first deletes the copies an earlier run made.
- You should see: one `PASS:` line per route (about seventeen), each with its full values, then `ALL PASS`. A route that real Foundry refuses prints `not possible here: <the reason>`: that is a result, not a problem.
- Paste back every line (copy the console output, not just the last line).

```js
// [GM] PROBE: make a copy of the compendium item and of the two world items by every route we can script, print what each copy carries, mark the copies as the gate's.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const { M, api, comp } = g;
  const smith = game.actors.get(g.ids.smith), friend = game.actors.get(g.ids.friend), world = game.items.get(g.ids.world), plain = game.items.get(g.ids.plain);
  if (!smith || !friend || !world || !plain) throw new Error("the gate's actors or world items are gone: run SETUP again");
  // earlier probe copies go first, so the block can run again
  for (const actor of [smith, friend]) for (const item of actor.items.filter(i => i.getFlag(M, "gateThrowaway22") && /^Gate G22 probe /.test(i.name))) await item.delete();
  for (const item of game.items.filter(i => /^Gate G22 probe /.test(i.name))) await item.delete();
  const stats = item => JSON.stringify(item._stats?.toObject?.() ?? item._stats ?? null);
  const describe = async (route, item) => {
    const refs = await api.tags.refsOf(item);
    const text = `${route} | name=${item.name} | uuid=${item.uuid ?? null} | _stats=${stats(item)} | flags.core=${JSON.stringify(item.flags?.core ?? null)} | quantity=${item.system?.quantity ?? null} | refsOf=${JSON.stringify(refs)}`;
    return { text, ok: typeof item.uuid !== "string" || refs.candidates.at(-1) === item.uuid };
  };
  const made = {};
  const nameOf = id => `Gate G22 probe ${id}`;
  const dataOf = (doc, id) => ({ ...doc.toObject(), name: nameOf(id) });
  const create = async (actor, data) => (await actor.createEmbeddedDocuments("Item", [data]))[0];
  const dropped = async uuid => Item.implementation.fromDropData({ type: "Item", uuid });
  const bare = (id, extra) => ({ name: nameOf(id), type: "equipment", system: { quantity: 1 }, ...extra });
  const routes = [
    ["0a world item (imported from the compendium), as it is", async () => world],
    ["0b world plain item, as it is", async () => plain],
    ["1a compendium item: toObject() created on Smith", async () => create(smith, dataOf(comp, "1a"))],
    ["1b compendium item: game.items.fromCompendium() created on Smith", async () => create(smith, { ...game.items.fromCompendium(comp), name: nameOf("1b") })],
    ["1c compendium item: Item.implementation.fromDropData() created on Smith", async () => create(smith, dataOf(await dropped(comp.uuid), "1c"))],
    ["2a world item (imported): toObject() created on Smith", async () => create(smith, dataOf(world, "2a"))],
    ["2b world item (imported): fromDropData() created on Smith", async () => create(smith, dataOf(await dropped(world.uuid), "2b"))],
    ["2c world plain item: toObject() created on Smith", async () => create(smith, dataOf(plain, "2c"))],
    ["2d world plain item: fromDropData() created on Smith", async () => create(smith, dataOf(await dropped(plain.uuid), "2d"))],
    ["3a Smith's copy 1a: toObject() created on Friend", async () => create(friend, dataOf(made["1a"], "3a"))],
    ["3b Smith's copy 1a: clone({}, { parent: Friend, save, addSource })", async () => made["1a"].clone({ name: nameOf("3b") }, { parent: friend, save: true, addSource: true })],
    ["4 only _stats.compendiumSource written on create", async () => create(smith, bare("4", { _stats: { compendiumSource: comp.uuid } }))],
    ["5a only _stats.duplicateSource written on create", async () => create(smith, bare("5a", { _stats: { duplicateSource: plain.uuid } }))],
    ["5b world plain item duplicated like Foundry's Duplicate: clone({}, { save, addSource })", async () => plain.clone({ name: nameOf("5b") }, { save: true, addSource: true })],
    ["5c that world duplicate: toObject() created on Smith", async () => create(smith, dataOf(made["5b"], "5c"))],
    ["6 only flags.core.sourceId written on create", async () => create(smith, bare("6", { flags: { core: { sourceId: comp.uuid } } }))]
  ];
  for (const [label, make] of routes) {
    const id = label.split(" ")[0];
    try {
      const item = await make();
      if (!item) throw new Error("the route gave no item");
      made[id] = item;
      const { text, ok } = await describe(label, item);
      g.rows.push(`${ok ? "PASS" : "FAIL"}: ${text}${ok ? "" : " | PROBLEM: refsOf.candidates does not end with the copy's own uuid"}`);
      if (!item.getFlag(M, "gateThrowaway22") && !/^0/.test(id)) await item.update({ [`flags.${M}.gateThrowaway22`]: true });
    } catch (error) {
      g.rows.push(`PASS: ${label} | not possible here: ${error.message}`);
    }
  }
  return g.done();
})();
```


## Step 4 [GM]: the real drop (by hand, or by the runner's drop action)

**What to do and see:**
- Open **Gate G22 Smith**'s character sheet on the Inventory tab.
- Drag **Torch** from the PF2e equipment compendium onto the sheet (or whichever item SETUP printed as `compendium`).
- Drag **Gate G22 World Item** from the Items sidebar onto the sheet.
- Drag the same compendium item onto the sheet a second time.
- Run the block below in the GM window.
- You should see: one `PASS:` line per item you dragged (7a, 7b, ...), each with its full values, then `ALL PASS`. If PF2e merged the second drop into the first, there is one line for the compendium item with `quantity=2`, and that is the answer.
- If you did not drag anything, the block says `FAIL: no hand-dragged item` and that is correct.
- Paste back every line.

```js
// [GM] PROBE, the real drop: print every item on Gate G22 Smith that this gate did not make itself (the ones you dragged on), with the same values as Step 3.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const { M, api } = g;
  const smith = game.actors.get(g.ids.smith);
  if (!smith) throw new Error("Gate G22 Smith is gone: run SETUP again");
  const stats = item => JSON.stringify(item._stats?.toObject?.() ?? item._stats ?? null);
  const dragged = smith.items.filter(i => !/^Gate G22 probe /.test(i.name) && i.type !== "treasure");     // by name: a copy of Gate G22 World Item carries that item's throwaway flag too
  g.check("at least one hand-dragged item is on Smith (drag as the bullets say, then run this block)", dragged.length > 0, `${dragged.length} found`);
  let n = 0;
  for (const item of dragged) {
    const refs = await api.tags.refsOf(item);
    g.rows.push(`${refs.candidates.at(-1) === item.uuid || typeof item.uuid !== "string" ? "PASS" : "FAIL"}: 7${"abcdefghij"[n++] ?? "z"} dragged by hand | name=${item.name} | uuid=${item.uuid ?? null} | _stats=${stats(item)} | flags.core=${JSON.stringify(item.flags?.core ?? null)} | quantity=${item.system?.quantity ?? null} | refsOf=${JSON.stringify(refs)}`);
  }
  return g.done();
})();
```


## Step 5 [GM]: CLEANUP (always run this, even if a step failed)

**What to do and see:**
- Nothing to click.
- Run the block below. It deletes everything the gate made: both characters (with the copies on them), the two world items and the probe's world duplicates, and Test's flag. Safe to run twice, and safe after a reload.
- You should see: `problems: []`, `actorsLeft: 0`, `itemsLeft: 0`, `flagLeft: false`.
- (If you then run Steps 6 to 15, run SETUP (Step 2) again first and finish with Step 16.)

```js
// [GM] CLEANUP: deletes everything the gate made. Safe to run twice, and safe after a reload (it does not need the globals).
await (async () => {
  const M = "pathfinder-progress";
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  for (const name of ["Smith", "Friend"]) {
    const actor = game.actors.getName(`Gate G22 ${name}`);
    if (actor?.getFlag(M, "gateThrowaway22") === true) await attempt(`delete ${actor.name}`, () => actor.delete());
  }
  await attempt("the world items", async () => { for (const item of game.items.filter(i => /^Gate G22 /.test(i.name) && i.getFlag(M, "gateThrowaway22") === true)) await item.delete(); });
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup22") !== undefined) await user.unsetFlag(M, "gateSetup22"); });
  delete globalThis.__g22;
  return {
    problems,
    actorsLeft: game.actors.filter(a => /^Gate G22 /.test(a.name)).length,
    itemsLeft: game.items.filter(i => /^Gate G22 /.test(i.name)).length,
    flagLeft: user?.getFlag(M, "gateSetup22") !== undefined
  };
})();
```


## Step 6 [GM]: SETUP 2 (a small craft: a tag, a recipe with a tagged slot, a workshop, downtime)

**What to do and see:**
- Run SETUP (Step 2) first if you have not, or if you ran CLEANUP (Step 5) since.
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts the in-memory definitions and `globalThis.__g22` back).
- You should see: an object with `planted` (seven lines) and a `published` revision. On a rerun it says `already: "set up"`.
- If it stops with `this gate tags ...`, the compendium item SETUP chose is not the one this gate tags: set `NAME` in Step 2 back to `Torch` and run Step 2 again.

```js
// [GM] SETUP 2: five in-memory g22- definitions (a tag, a material, a town, a workshop, a recipe whose second slot needs the tag), a copy of the compendium item on Gate G22 Smith (Gate G22 Ingredient),
// 6 Gate G22 Iron, the formula, the party in Gate G22 Town and 12 days of downtime. Says what it planted.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (Step 2) first, then this step"); })();
  const { M, api, comp } = g;
  const COMP_UUID = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS";
  const test = game.users.getName("Test");
  const smith = game.actors.get(g.ids.smith), friend = game.actors.get(g.ids.friend);
  if (!game.user.isGM || !test || !smith || !friend) throw new Error("run this in the GM window after SETUP (Step 2)");
  if (comp.uuid !== COMP_UUID) throw new Error(`this gate tags ${COMP_UUID}, but Step 2 chose ${comp.uuid} (${comp.name}): set NAME in Step 2 back to "Torch" and run Step 2 again`);
  const OUT = Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier, COMP_UUID]));
  const defs = [
    ["tag", { kind: "tag", id: "g22-tooth", name: "Gate G22 Tooth", theme: "things with a bite" }],
    ["town", { kind: "town", id: "g22-town", name: "Gate G22 Town" }],
    ["material", { kind: "material", id: "g22-iron", name: "Gate G22 Iron", tier: 1, effects: { basePower: "T1" } }],
    ["station", { kind: "station", id: "g22-bench", name: "Gate G22 Bench", category: "smithing", tier: 1, town: "g22-town" }],
    ["recipe", { kind: "recipe", category: "weapon", id: "g22-trinket", name: "Gate G22 Trinket", output: OUT, craftLevel: 2, stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, stationCategory: "smithing",
      slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "charm", drives: "bonusDamage", tierFloor: 1, qty: 1, lossChance: 0, needs: { all: ["g22-tooth"] } }] }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`the in-memory ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }
  const stats = item => item._stats?.toObject?.() ?? item._stats ?? {};
  const snapOf = item => ({ name: item.name, type: item.type, system: item.toObject().system, compendiumSource: stats(item).compendiumSource ?? null, quantity: item.system?.quantity ?? null });
  const extend = ids => {
    g.queued = actor => actor.getFlag(M, "pendingActions") ?? [];
    g.until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; };
    g.stats = stats; g.snapOf = snapOf;
    g.ingredient = () => game.actors.get(ids.smith)?.items.find(i => i.name === "Gate G22 Ingredient");
    return g;
  };
  const saved = test.getFlag(M, "gateSetup22") ?? {};
  if (saved.craft && smith.items.some(i => i.name === "Gate G22 Ingredient")) {
    extend(g.ids);
    return { already: "set up", rebuilt: "the definitions and globalThis.__g22", published: await api.publishDefinitions() };
  }
  if (api.tags.ledger().items[COMP_UUID]) throw new Error(`the compendium item ${COMP_UUID} is already tagged in your ledger: this gate tags it and takes the tag off again, so untag it first`);
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const published = await api.publishDefinitions();
  await api.giveMaterial(smith, "g22-iron", 6);
  await api.grantFormula(smith, "g22-trinket");
  const [ingredient] = await smith.createEmbeddedDocuments("Item", [{ ...game.items.fromCompendium(comp), name: "Gate G22 Ingredient" }]);
  await api.adapter.addCopper(smith, 10000);
  await test.setFlag(M, "gateOriginalLocation22", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g22-town");
  await test.setFlag(M, "gateOriginalCharacter22", test.character?.id ?? "none");
  await test.update({ character: smith.id });
  await api.downtime.start({ days: 12, actorIds: [smith.id] });
  extend(g.ids);
  await test.setFlag(M, "gateSetup22", { ...(test.getFlag(M, "gateSetup22") ?? {}), craft: { ingredient: snapOf(ingredient), compendiumUuid: COMP_UUID, iron: 6, freeDays: 12 } });
  return {
    planted: [
      "the in-memory tag Gate G22 Tooth, material Gate G22 Iron, town and workshop (Gate G22 Town, Gate G22 Bench)",
      "the in-memory recipe Gate G22 Trinket: slot body (any material) and slot charm (needs the tag Gate G22 Tooth, loss chance 0)",
      "a copy of the compendium item on Gate G22 Smith, named Gate G22 Ingredient, made with Foundry's own import data",
      "6 Gate G22 Iron, the formula, 100 gp, and the party in Gate G22 Town",
      "Test's character is now Gate G22 Smith, and 12 days of downtime are open for Smith",
      "nothing is tagged yet (Step 7 tags the compendium item)",
      "the in-memory definitions go when you reload the GM window; this step puts them back"
    ],
    published
  };
})();
```


## Step 7 [GM]: tag the compendium item, and see which copies match

**What to do and see:**
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. The values of every comparison are printed, so a `FAIL:` line shows what real Foundry did.
- The block tags the compendium uuid `Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS`, makes three copies on Gate G22 Friend (a compendium copy made with Foundry's own import data, a copy of the imported world item, a copy of the plain world item; the real drop is Step 9), and asks `refsOf` which of them match.

```js
// [GM] Tag the compendium item, copy it three ways onto Gate G22 Friend and check which copies match.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (Step 2) and SETUP 2 (Step 6) first"); })();
  if (!g.stats) throw new Error("run SETUP 2 (Step 6) first");
  const { M, api } = g;
  const COMP_UUID = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS";
  const friend = game.actors.get(g.ids.friend), world = game.items.get(g.ids.world), plain = game.items.get(g.ids.plain);
  for (const item of friend.items.filter(i => /^Gate G22 match /.test(i.name))) await item.delete();
  // C: Foundry's own import data for the compendium item (the probe's route 1b); W and P: toObject() of the two world items (routes 2a and 2c). Step 9 does the real drop.
  const make = async (data, name) => (await friend.createEmbeddedDocuments("Item", [{ ...data, name }]))[0];
  const c = await make(game.items.fromCompendium(g.comp), "Gate G22 match C"), w = await make(world.toObject(), "Gate G22 match W"), p = await make(plain.toObject(), "Gate G22 match P");
  await api.tags.setEntry(COMP_UUID, { tags: ["g22-tooth"], tier: 2, name: "Gate G22 Torch" });
  const R = { c: await api.tags.refsOf(c), w: await api.tags.refsOf(w), p: await api.tags.refsOf(p) };
  const values = JSON.stringify({ compendiumCopy: { stats: g.stats(c), refsOf: R.c }, importedWorldItemCopy: { stats: g.stats(w), refsOf: R.w }, plainWorldItemCopy: { stats: g.stats(p), refsOf: R.p } });
  g.check("the compendium copy carries _stats.compendiumSource = the compendium uuid", g.stats(c).compendiumSource === COMP_UUID, values);
  g.check("so it matches the tag, with the tag and the tier the GM gave", R.c.matched === COMP_UUID && R.c.tags.join() === "g22-tooth" && R.c.tier === 2, values);
  g.check("and it would be accepted by the charm slot of Gate G22 Trinket", R.c.fitsBySlot["g22-trinket/charm"] === "g22-trinket", values);
  g.check("a copy of the imported world item matches the same tag (it carries the compendium source on)", R.w.matched === COMP_UUID, values);
  g.check("a copy of the PLAIN world item matches nothing (it carries no source)", R.p.matched === null && g.stats(p).compendiumSource == null, values);
  return g.done();
})();
```


## Step 8 [GM]: tag the imported world item, and see which tag wins

**What to do and see:**
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. The block ends with only the compendium item tagged again.
- The compendium source is the first reference the lookup tries, so while both are tagged the compendium entry answers; take it off and the world item answers by its own uuid.

```js
// [GM] Tag the world item imported from the compendium; check it matches; check which reference wins; put the tags back as they were.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (Step 2) and SETUP 2 (Step 6) first"); })();
  if (!g.stats) throw new Error("run SETUP 2 (Step 6) first");
  const { api } = g;
  const COMP_UUID = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS";
  const friend = game.actors.get(g.ids.friend), world = game.items.get(g.ids.world);
  const w = friend.items.find(i => i.name === "Gate G22 match W");
  if (!w) throw new Error("run Step 7 first (it makes the copies this step reads)");
  if (!api.tags.ledger().items[COMP_UUID]) await api.tags.setEntry(COMP_UUID, { tags: ["g22-tooth"], tier: 2, name: "Gate G22 Torch" });
  await api.tags.setEntry(world.uuid, { tags: ["g22-tooth"], tier: 3, name: "Gate G22 World Item" });
  const both = await api.tags.refsOf(world), bothCopy = await api.tags.refsOf(w);
  g.check("the world item matches while both are tagged, and the compendium source wins (it is tried first)", both.matched === COMP_UUID && both.candidates[0] === COMP_UUID, JSON.stringify(both));
  await api.tags.removeEntry(COMP_UUID);
  const alone = await api.tags.refsOf(world), aloneCopy = await api.tags.refsOf(w);
  g.check("with only the world item tagged it matches by its own uuid, at the tier the GM gave it", alone.matched === world.uuid && alone.tier === 3 && alone.tags.join() === "g22-tooth", JSON.stringify(alone));
  g.rows.push(`PASS: printed, not judged: the COPY of the world item, with both tagged: ${JSON.stringify(bothCopy)}; with only the world item tagged: ${JSON.stringify(aloneCopy)}`);
  await api.tags.setEntry(COMP_UUID, { tags: ["g22-tooth"], tier: 2, name: "Gate G22 Torch" });
  await api.tags.removeEntry(world.uuid);
  const keys = Object.keys(api.tags.ledger().items);
  g.check("put back: the compendium item is tagged and the world item is not", keys.includes(COMP_UUID) && !keys.includes(world.uuid), JSON.stringify(keys));
  return g.done();
})();
```


## Step 9 [GM]: a real drop of the PLAIN world item (settles work-log issue 27)

**What to do and see:**
- With the runner's drop action this is done for you. By hand: open **Gate G22 Smith**'s sheet on the Inventory tab and drag **Gate G22 World Plain** from the Items sidebar onto it.
- Run the block below in the GM window.
- You should see: one `PASS:` line per dropped copy with its full values, a line starting `PASS: ANSWER`, then `ALL PASS`. If you did not drop anything the block says `FAIL: ... dropped` and that is correct.
- Paste back every line: the answer is whether a copy of a plain world item carries ANY source.

```js
// [GM] The real drop of the plain world item on Gate G22 Smith: print what the new copy carries.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { api } = g;
  const smith = game.actors.get(g.ids.smith);
  const stats = item => item._stats?.toObject?.() ?? item._stats ?? null;
  const copies = smith.items.filter(i => i.name === "Gate G22 World Plain");
  g.check("the plain world item was dropped on Smith (drag it from the Items sidebar first if this fails)", copies.length > 0, `${copies.length} found`);
  let n = 0;
  for (const item of copies) {
    const refs = await api.tags.refsOf(item);
    g.rows.push(`${refs.candidates.at(-1) === item.uuid || typeof item.uuid !== "string" ? "PASS" : "FAIL"}: 9${"abcdefgh"[n++] ?? "z"} dropped plain world item | name=${item.name} | uuid=${item.uuid ?? null} | _stats=${JSON.stringify(stats(item))} | flags.core=${JSON.stringify(item.flags?.core ?? null)} | quantity=${item.system?.quantity ?? null} | refsOf=${JSON.stringify(refs)}`);
  }
  if (copies.length) {
    const s = stats(copies[0]) ?? {};
    g.rows.push(`PASS: ANSWER (issue 27): the dropped copy of a plain world item carries compendiumSource=${JSON.stringify(s.compendiumSource ?? null)}, duplicateSource=${JSON.stringify(s.duplicateSource ?? null)}, flags.core.sourceId=${JSON.stringify(copies[0].flags?.core?.sourceId ?? null)}; ${s.compendiumSource || s.duplicateSource || copies[0].flags?.core?.sourceId ? "it HAS a source" : "it has NO source, so a tag on the world item never matches its copies"}`);
  }
  return g.done();
})();
```


## Step 10 [Player]: the window offers the item by name only

**What to do and see:**
- In the **Player** window, open **Downtime** for **Gate G22 Smith** (the scene controls' hourglass) and choose the formula **Gate G22 Trinket** (the runner does this).
- Look at the **charm** slot: it lists one item.
- Run the block below in the Player window.
- You should see: `PASS:` lines and `ALL PASS`: the slot lists the item by the name the GM gave it, and nothing in the slot or on the page names the tag, a tier or a price.

```js
// [Player] The charm slot lists what fits, by name, and shows no tag, tier or price anywhere.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api, rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const saved = game.user.getFlag(M, "gateSetup22");
  if (game.user.isGM || game.user.character?.name !== "Gate G22 Smith" || !saved?.craft) throw new Error('Player window as the user "Test" only, after the GM ran SETUP and SETUP 2');
  await api.definitions.refresh({ force: true });
  const recipe = api.definitions.recipe.get("g22-trinket"), charm = recipe?.slots.find(s => s.name === "charm");
  const options = [...document.querySelectorAll('[data-action="pick-material"][data-slot="charm"]')];
  const texts = options.map(b => b.textContent.replace(/\s+/g, " ").trim());
  const page = (document.querySelector(".pfp-hub")?.textContent ?? "").replace(/\s+/g, " ");
  check("the slot lists exactly one item, the compendium reference, by the name the GM gave it", options.length === 1 && options[0].dataset.material === saved.craft.compendiumUuid && /Gate G22 Torch/.test(texts[0] ?? ""), JSON.stringify(texts));
  check("the option shows no tag, no tier and no price", !/tier|tag|\bgp\b|price|worth/i.test(texts.join(" ")), JSON.stringify(texts));
  check("nowhere on the window is the tag's name or id", !/Gate G22 Tooth|g22-tooth/.test(page), page.slice(0, 200));
  check("the player's copy of the slot says which items fit (id and name only) and carries nothing about tags", Boolean(charm) && Array.isArray(charm.fits) && charm.fits.length === 1 && Object.keys(charm.fits[0]).sort().join() === "id,name" && !("needs" in charm) && !("kind" in charm) && !("passCap" in charm) && !/g22-tooth/.test(JSON.stringify(charm)), JSON.stringify(charm));
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 11 [Player]: queue a craft with the real PF2e item

**What to do and see:**
- In the **Player** window, on **Gate G22 Trinket**: choose **Gate G22 Iron** in **Body**, choose the item in **Charm**, choose **Gate G22 Bench**, click **Queue the craft** (the runner does this).
- You should see: "Craft queued: Gate G22 Trinket. N days reserved." at the bottom.
- Run the block below in the Player window.
- You should see: `PASS:` lines and `ALL PASS`: the item left the bag and is held whole in the queued craft.

```js
// [Player] The craft is queued and the real item is held whole in escrow.
await (async () => {
  const M = "pathfinder-progress", rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.user.character, saved = game.user.getFlag(M, "gateSetup22");
  if (game.user.isGM || hero?.name !== "Gate G22 Smith" || !saved?.craft) throw new Error('Player window as the user "Test" only, after the GM ran SETUP and SETUP 2');
  const was = saved.craft.ingredient;
  const queued = (hero.getFlag(M, "pendingActions") ?? []).filter(a => a.type === "craft");
  check("exactly one craft is queued (the clicks queue it; do them first if this fails)", queued.length === 1, queued.length);
  const unit = queued[0]?.params?.escrow?.units?.find(u => u.itemData);
  check("the real item is in escrow, whole: its own name, type and compendium source", unit?.itemData?.name === was.name && unit?.itemData?.type === was.type && unit?.itemData?._stats?.compendiumSource === was.compendiumSource, JSON.stringify({ was, unit: unit ? { name: unit.itemData?.name, type: unit.itemData?.type, source: unit.itemData?._stats?.compendiumSource } : null }));
  check("it has left the bag", !hero.items.some(i => i.name === was.name), hero.items.map(i => i.name).join(", "));
  check("the queue carries no tag, no tier from the ledger and no DC", !/g22-tooth|Gate G22 Tooth|\bDC\b/.test(JSON.stringify(queued)), JSON.stringify(queued).slice(0, 200));
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 12 [Player]: cancel, and the same real item comes back

**What to do and see:**
- In the **Player** window click **View queue**, then **Cancel** on the craft (the runner does this).
- You should see: "Cancelled: ... Your days and materials are back."
- Run the block below in the Player window.
- You should see: `PASS:` lines and `ALL PASS`: the item is back with its own name, type, data and compendium source, and the days and iron are back.

```js
// [Player] After the cancel: the same real item is back (not a stand-in), the queue is empty, days and iron are back.
await (async () => {
  const M = "pathfinder-progress", rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.user.character, saved = game.user.getFlag(M, "gateSetup22");
  if (game.user.isGM || hero?.name !== "Gate G22 Smith" || !saved?.craft) throw new Error('Player window as the user "Test" only, after the GM ran SETUP and SETUP 2');
  const was = saved.craft.ingredient;
  const item = hero.items.find(i => i.name === was.name);
  const stats = item?._stats?.toObject?.() ?? item?._stats ?? {};
  const now = item ? { name: item.name, type: item.type, system: item.toObject().system, compendiumSource: stats.compendiumSource ?? null, quantity: item.system?.quantity ?? null } : null;
  const iron = hero.items.filter(i => i.getFlag(M, "material")?.materialId === "g22-iron").reduce((n, i) => n + i.system.quantity, 0);
  const detail = JSON.stringify({ was, now, iron, free: hero.getFlag(M, "downtimeDays") ?? 0, queued: (hero.getFlag(M, "pendingActions") ?? []).length });
  check("the item is back on Smith, once", hero.items.filter(i => i.name === was.name).length === 1, detail);
  check("it is the same real item: same type, same data, same compendium source, same quantity", Boolean(now) && now.type === was.type && JSON.stringify(now.system) === JSON.stringify(was.system) && now.compendiumSource === was.compendiumSource && now.quantity === was.quantity, detail);
  check("the queue is empty again and the days and iron are back", (hero.getFlag(M, "pendingActions") ?? []).length === 0 && (hero.getFlag(M, "downtimeDays") ?? 0) === saved.craft.freeDays && iron === saved.craft.iron, detail);
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 13 [GM]: queue again, force a failure, and the item still comes back

**What to do and see:**
- The runner queues the craft again in the Player window (the same clicks as Step 11). By hand, do Step 11's clicks first.
- Run the block below in the GM window. It resolves the craft as a forced failure.
- You should see: `PASS:` lines and `ALL PASS`. The charm slot has a loss chance of 0, so the item cannot be lost to the failure.

```js
// [GM] A forced failure: the queued craft resolves, nothing is made, and the real item comes back as it was.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (Step 2) and SETUP 2 (Step 6) first"); })();
  if (!g.queued) throw new Error("run SETUP 2 (Step 6) first");
  const { api } = g;
  const smith = game.actors.get(g.ids.smith), was = game.users.getName("Test").getFlag(g.M, "gateSetup22").craft.ingredient;
  const action = g.queued(smith).find(a => a.type === "craft");
  g.check("a craft is queued (the Player's clicks queue it; do Step 11's clicks first if this fails)", Boolean(action), JSON.stringify(g.queued(smith).map(a => a.type)));
  if (!action) return g.done();
  const out = await api.queue.resolve(smith, action.id, { degree: "failure", chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  await g.until(() => g.queued(smith).length === 0);
  const item = g.ingredient(), now = item ? g.snapOf(item) : null;
  const detail = JSON.stringify({ was, now, queued: g.queued(smith).length, crafted: smith.items.filter(i => i.getFlag(g.M, "crafted")).length });
  g.check("the real item is back on Smith, once", smith.items.filter(i => i.name === was.name).length === 1, detail);
  g.check("it is the same real item: same type, data, compendium source and quantity", Boolean(now) && now.type === was.type && JSON.stringify(now.system) === JSON.stringify(was.system) && now.compendiumSource === was.compendiumSource && now.quantity === was.quantity, detail);
  g.check("a failure makes no item", smith.items.filter(i => i.getFlag(g.M, "crafted")).length === 0, detail);
  return g.done();
})();
```


## Step 14 [GM]: queue again and resolve a success

**What to do and see:**
- The runner queues the craft again in the Player window. By hand, do Step 11's clicks first.
- Run the block below in the GM window. It resolves the craft as a forced success.
- You should see: `PASS:` lines and `ALL PASS`: a crafted item with an opaque `freezeId` and no tag data, and the ingredient used up.

```js
// [GM] A forced success: the crafted item carries only an opaque freezeId; what it was made of is in the GM-only store.
await (async () => {
  const g = globalThis.__g22 ?? (() => { throw new Error("run SETUP (Step 2) and SETUP 2 (Step 6) first"); })();
  if (!g.queued) throw new Error("run SETUP 2 (Step 6) first");
  const { api, M } = g;
  const smith = game.actors.get(g.ids.smith), was = game.users.getName("Test").getFlag(M, "gateSetup22").craft.ingredient;
  const action = g.queued(smith).find(a => a.type === "craft");
  g.check("a craft is queued (the Player's clicks queue it; do Step 11's clicks first if this fails)", Boolean(action), JSON.stringify(g.queued(smith).map(a => a.type)));
  if (!action) return g.done();
  const out = await api.queue.resolve(smith, action.id, { degree: "success", chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  await g.until(() => smith.items.some(i => i.getFlag(M, "crafted")));
  const made = smith.items.find(i => i.getFlag(M, "crafted"));
  const flag = made?.getFlag(M, "crafted");
  const text = JSON.stringify(made?.flags ?? {});
  g.check("a crafted item is on Smith, with an opaque freezeId", Boolean(made) && typeof flag?.freezeId === "string" && flag.freezeId.length > 0, JSON.stringify(flag));
  g.check("the GM-only store holds what it was made of", Boolean(flag?.freezeId) && Boolean(api.tags.frozen(flag.freezeId)), JSON.stringify(api.tags.frozen(flag?.freezeId ?? "")));
  g.check("the item's flags carry no tag, no tag name and no tag data", !/g22-tooth|Gate G22 Tooth|"tags"|"native"|"inherited"|"needs"|"priority"|effectBlocks/.test(text), text);
  g.check("the ingredient was used up (a success keeps nothing)", smith.items.filter(i => i.name === was.name).length === 0, smith.items.map(i => i.name).join(", "));
  return g.done();
})();
```


## Step 15 [Player]: what the player's client holds

**What to do and see:**
- In the **Player** window run the block below.
- You should see: `PASS:` lines and `ALL PASS`. It reads every chat message this client holds (a whisper is delivered to every client), the character's flags and every item's flags, looking for the tag's name or id, tag data, a DC or a roll total.
- Note: world settings are delivered to every client, so a player can read the ledger setting from the console. That is the honor system (CLAUDE.md), not a leak this gate looks for; the line below records it.

```js
// [Player] Chat, the character's flags and every item's flags carry no tag, tag data, DC or roll total.
await (async () => {
  const M = "pathfinder-progress", rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.user.character;
  if (game.user.isGM || hero?.name !== "Gate G22 Smith") throw new Error('Player window as the user "Test" only, after the GM ran SETUP and SETUP 2');
  const tagWords = /g22-tooth|Gate G22 Tooth|"tags"|"native"|"inherited"|"needs"|"priority"|"passCap"|effectBlocks/;
  const secretWords = /\bDC\b|\btotal\b|\bodds\b/i;
  const chat = game.messages.contents.map(m => `${m.content ?? ""} ${JSON.stringify(m.flags ?? {})}`);
  const actorFlags = JSON.stringify(hero.flags ?? {});
  const itemFlags = hero.items.map(i => `${i.name}: ${JSON.stringify(i.flags ?? {})}`);
  check(`no chat message this client holds names a tag or tag data (${chat.length} read)`, !chat.some(t => tagWords.test(t)), chat.filter(t => tagWords.test(t)).join(" | ").slice(0, 300));
  check("and none carries a DC, a roll total or odds", !chat.some(t => secretWords.test(t)), chat.filter(t => secretWords.test(t)).join(" | ").slice(0, 300));
  check("the character's flags name no tag and carry no tag data", !tagWords.test(actorFlags), actorFlags.slice(0, 300));
  check(`no item's flags name a tag or carry tag data (${itemFlags.length} read)`, !itemFlags.some(t => tagWords.test(t)), itemFlags.filter(t => tagWords.test(t)).join(" | ").slice(0, 300));
  let readable = "no";
  try { readable = game.settings.get(M, "tagLedger") && Object.keys(game.settings.get(M, "tagLedger")).length ? "yes" : "empty"; } catch { readable = "no"; }
  rows.push(`PASS: recorded, not judged: a player client can read the tagLedger world setting from the console: ${readable} (the honor system)`);
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 16 [GM]: CLEANUP 2 (always run this, even if a step failed)

**What to do and see:**
- Nothing to click.
- Run the block below. It deletes everything the gate made (this is the cleanup for Steps 2 to 15; Step 5 only covers Steps 2 to 4): the characters, the world items, the tags it set, the in-memory definitions, the crafted item's frozen record, and it puts the party location, Test's character and the downtime back. Safe to run twice, and safe after a reload.
- You should see: `problems: []`, `actorsLeft: 0`, `itemsLeft: 0`, `frozenLeft: 0`, `ledgerLeft: 0`, `downtimeOpen: false`, `sharedLeft: 0`, `flagLeft: false` and an empty `audit`.

```js
// [GM] CLEANUP 2: deletes everything the gate made and puts back what it changed. Safe to run twice, and safe after a reload (it does not need the globals).
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const COMP_UUID = "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS";
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const names = ["Gate G22 Smith", "Gate G22 Friend"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway22") === true);
  const ids = actors.map(a => a.id);
  const freezeIds = actors.flatMap(a => [...a.items]).map(i => i.getFlag(M, "crafted")?.freezeId).filter(Boolean);
  await attempt("party location", async () => {
    const original = user?.getFlag(M, "gateOriginalLocation22");
    if (original !== undefined) { await game.settings.set(M, "partyLocation", original); await user.unsetFlag(M, "gateOriginalLocation22"); }
  });
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the shared Compendium", async () => {
    const book = game.settings.get(M, "sharedCompendium");
    if (!book) return;
    const drop = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => !k.startsWith("g22-")));
    const next = { ...book, materials: drop(book.materials), experiments: drop(book.experiments) };
    if (JSON.stringify(next) !== JSON.stringify(book)) await game.settings.set(M, "sharedCompendium", next);
  });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate G22 |g22-/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter22");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter22");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  await attempt("the world items", async () => { for (const item of game.items.filter(i => /^Gate G22 /.test(i.name) && i.getFlag(M, "gateThrowaway22") === true)) await item.delete(); });
  await attempt("the tags this gate set", async () => {
    const items = api.tags.ledger().items;
    for (const key of Object.keys(items).filter(k => k === COMP_UUID || (items[k].name ?? "").startsWith("Gate G22 "))) await api.tags.removeEntry(key);
  });
  await attempt("the frozen records of what was crafted here", async () => { await api.tags.pruneFrozen(); });
  for (const [kind, id] of [["recipe", "g22-trinket"], ["station", "g22-bench"], ["town", "g22-town"], ["material", "g22-iron"], ["tag", "g22-tooth"]]) api.definitions[kind]?.delete(id);
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup22") !== undefined) await user.unsetFlag(M, "gateSetup22"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  api.gm.clearLog();
  delete globalThis.__g22;
  return {
    problems,
    actorsLeft: game.actors.filter(a => names.includes(a.name)).length,
    itemsLeft: game.items.filter(i => /^Gate G22 /.test(i.name)).length,
    frozenLeft: freezeIds.filter(id => api.tags.frozen(id)).length,
    ledgerLeft: Object.keys(api.tags.ledger().items).filter(k => k === COMP_UUID).length,
    downtimeOpen: api.downtime.isOpen(),
    sharedLeft: Object.keys(game.settings.get(M, "sharedCompendium")?.experiments ?? {}).filter(k => k.startsWith("g22-")).length,
    flagLeft: user?.getFlag(M, "gateSetup22") !== undefined,
    audit: api.audit.scan()
  };
})();
```
