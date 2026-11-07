# 22 Tags gate, item references (a PROBE, real Foundry): how does an item reach a tagged slot?

Run in a real world on PF2e 8.6.1, in the **GM window only** (no Player window is needed yet). **This is a PROBE, not a test.** The fake Foundry cannot say what real Foundry and PF2e write into `_stats` when an item is copied onto an actor (the fake's tests write `_stats` by hand), and the tag ledger finds an ordinary item by exactly those fields (`docs/22-tags-slice1.md`, "What fills a tagged slot"). So this gate only **makes copies of an item by every route we know and prints what each copy carries**. A `PASS:` line means "the route was tried and its values are printed", **not** that the values are what we hoped; a `FAIL:` line means the module's own helper misbehaved. Paste back **all** the lines, whatever they say: the values are the result.

**Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".**

`tests/gate22.test.js` plays every block in a fake Foundry that is given just enough pretend compendium, world items and drop functions to run them. It proves the blocks run, print one line per route and clean up after themselves. **It proves nothing about what real Foundry writes: that is what this gate is for.**

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
