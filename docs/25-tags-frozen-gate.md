# 25 Tags gate, the life of a frozen craft record (real Foundry)

Run in a real world on PF2e 8.6.1 with a **GM window** and, for Step 11 only, an **incognito Player window logged in as the user "Test"**, on the **active scene** (the two tokens are placed on it). Every step is labelled **[GM]** or **[Player]**. **Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".** Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. **Every FAIL line prints each value it compared**, and every step that reads data Foundry could alter prints the saved value next to the expected one; a text scan prints every match in full with 80 characters of context.

`tests/gate25.test.js` plays every step in a fake Foundry (PF2e-like actors and tokens, a fake chat log, items that fire `deleteItem` when deleted, and a dotted key rewritten into nested objects the way real Foundry does). **What the fake cannot prove, and only this gate can, in real Foundry:** that the saved `tagCrafted` setting reads back exactly as written, that Foundry fires `deleteItem` (and the module removes the record) for a deleted item and for a copy, that deleting an actor does or does not remove the records of the items it held (the answer is printed, not judged), that `pruneFrozen` finds the rest, that a missing record is a quiet fallback with one GM log line, and that the store survives a reload of the GM window.

**What the frozen record is** (`docs/22-tags-slice1.md`, Slice 2b): when a craft with a tagged slot resolves, the GM client writes what it was made of and what it stacked to into the GM-only world setting `tagCrafted`, keyed by an opaque id (`freezeId`) that the crafted item carries in its `crafted` flag. The use card reads the conditions from that record, so editing a tag, the ledger or the caps later does not change an item that exists. The record goes when the last item carrying its id is deleted (only the active GM client acts), `api.tags.pruneFrozen()` removes the ones no item carries, and a record that is missing is skipped and logged once.

**What SETUP plants** (all throwaway "Gate G25" things): one tag `g25-bite` (1d4 fire damage; makes the target frightened 1, Will save), a material **Gate G25 Fang** that carries that tag, a material **Gate G25 Iron**, a recipe **Gate G25 Blade** whose Edge slot needs the tag and whose output is a real PF2e dagger, a town and a workshop, the characters **Gate G25 Hero** (owned by Test) and **Gate G25 Smith** (a second crafter) and **Gate G25 Goblin A** (unlinked token) with the Hero's and the goblin's tokens on the open scene, and 12 days of downtime for the Hero and Smith. Crafts are queued and resolved from the GM window with the module's own API (a forced success).

**The gate does not need the crafted weapon's rule elements**, so it does not hold the weapon. (PF2e loads a weapon's rule elements only while the weapon is held; any step added later that reads them must first hold the weapon with `actor.changeCarryType(item, { carryType: "held", handsHeld: 1 })` and wait. The module does not equip a crafted weapon.)

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
- Open the scene you play on and make it the **active** scene (right-click it in the Scenes tab, Activate), so the tokens are placed on it.
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts the in-memory definitions and `globalThis.__g25` back, and places any token that is missing).
- You should see: an object with `planted` (seven lines), `tokens` (2 when a scene was open) and a `published` revision. On a rerun it says `already: "set up"`.
- If `tokens` is 0, open a scene and run the block again.
- If it stops with `has no item named`, change `NAMES` at the top of the block to a weapon that exists in the PF2e equipment pack and run it again (Dagger is the default).

```js
// [GM] SETUP: in-memory g25- definitions (a tag with effects, two materials, a town, a workshop, a recipe whose Edge slot needs the tag), the characters Gate G25 Hero (owned by Test), Gate G25 Smith and Gate G25 Goblin A
// (unlinked token), the Hero's and the goblin's tokens on the open scene, materials, the formula and 12 days of downtime. Says what it planted.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const PACK = "pf2e.equipment-srd", NAMES = { weapon: "Dagger" };
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (typeof api.tags?.frozen !== "function" || typeof api.tags?.pruneFrozen !== "function" || typeof api.effects?.applyCard !== "function") throw new Error("this world is not on a build with the frozen-record API and the effect cards: update the module and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway25") === true;
  for (const n of ["Hero", "Smith", "Goblin A"]) if (!mine(game.actors.getName(`Gate G25 ${n}`))) throw new Error(`"Gate G25 ${n}" already exists and was not made by this check; rename or delete it first`);
  const pack = game.packs.get(PACK);
  if (!pack) throw new Error(`There is no compendium "${PACK}" in this world`);
  const weapon = (await pack.getIndex()).find(e => e.name === NAMES.weapon);
  if (!weapon) throw new Error(`The compendium "${PACK}" has no item named "${NAMES.weapon}": change NAMES at the top of this block to a weapon that exists there`);
  const OUT = Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier, `Compendium.${PACK}.Item.${weapon._id}`]));
  const defs = [
    ["tag", { kind: "tag", id: "g25-bite", name: "Gate G25 Bite", theme: "things with a bite", effectBlocks: { general: { blocks: [{ type: "damage", dice: { all: "1d4" }, damageType: "fire" }] }, byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: { all: 1 }, save: "will" }] } } } }],
    ["town", { kind: "town", id: "g25-town", name: "Gate G25 Town" }],
    ["material", { kind: "material", id: "g25-iron", name: "Gate G25 Iron", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g25-fang", name: "Gate G25 Fang", tier: 2, tag: "g25-bite", effects: { basePower: "T2" } }],
    ["station", { kind: "station", id: "g25-bench", name: "Gate G25 Bench", category: "smithing", tier: 1, town: "g25-town" }],
    ["recipe", { kind: "recipe", category: "weapon", id: "g25-blade", name: "Gate G25 Blade", output: OUT, craftLevel: 2, stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, stationCategory: "smithing",
      slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "edge", drives: ["bonusDamage", "applyCondition"], tierFloor: 1, qty: 1, lossChance: 0, needs: { all: ["g25-bite"] } }] }]
  ];
  const ensureDefs = () => {
    for (const [kind, record] of defs) {
      if (api.definitions[kind].has(record.id)) continue;
      const problems = api.checkDefinition(record);
      if (problems.length) throw new Error(`the in-memory ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
      api.definitions[kind].set(record.id, record);
    }
  };
  ensureDefs();
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, rows, keep: {}, n: 0,
      hero: () => game.actors.get(ids.hero), smith: () => game.actors.get(ids.smith),
      token: name => canvas.scene?.tokens.find(t => t.name === `Gate G25 ${name}`),
      store: () => game.settings.get(M, "tagCrafted")?.items ?? {},
      queued: actor => actor.getFlag(M, "pendingActions") ?? [],
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      conds: actor => ["frightened", "sickened"].map(s => `${s}${actor.getCondition(s) ? (actor.getCondition(s).value ?? "") || "y" : "-"}`).join(" "),
      clear: async actor => { for (const slug of ["frightened", "sickened"]) await api.effects.adapter.removeCondition(actor, slug); },
      canon: v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x)),
      dotted: (v, path = "$") => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [...(k.includes(".") ? [`${path}.${k}`] : []), ...g.dotted(x, `${path}.${k}`)]) : []),
      // every match with 80 characters of context either side, never cut
      hits: (text, re) => [...String(text).matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].map(x => `${JSON.stringify(String(text).slice(Math.max(0, x.index - 80), x.index))} [[${x[0]}]] ${JSON.stringify(String(text).slice(x.index + x[0].length, x.index + x[0].length + 80))}`),
      // craft once for an actor: queue it, resolve it as a forced success, find the new crafted item and its freezeId
      craft: async actor => {
        const known = new Set(actor.items.filter(i => i.getFlag(M, "crafted")).map(i => i.id));
        const action = await api.queue.submit(actor, "craft", { recipe: "g25-blade", selection: { body: "g25-iron", edge: "g25-fang" }, stationId: "g25-bench" });
        const out = await api.queue.resolve(actor, action.id, { degree: "success", chat: false });
        const made = await g.until(() => actor.items.find(i => i.getFlag(M, "crafted") && !known.has(i.id)));
        return { out, made: made || null, id: made ? made.getFlag(M, "crafted")?.freezeId ?? null : null };
      },
      // a message shaped like the real Strike card (docs/probes/11d-targets-probe.md): the Hero hits Goblin A with `item`
      attack: item => {
        const t = g.token("Goblin A"), hero = g.hero();
        return { id: `g25-${++g.n}`, flags: { pf2e: { context: { type: "attack-roll", outcome: "success", target: { token: t.uuid, actor: `${t.uuid}.Actor.${t.actorId}` }, origin: { actor: `Actor.${hero.id}`, token: g.token("Hero").uuid }, action: "strike" }, origin: { actor: `Actor.${hero.id}`, uuid: item.uuid, type: "weapon" } } }, author: { targets: new Set([{ document: t }]) } };
      },
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g25 = g;
    return g;
  };
  const placeTokens = async hero => {
    if (!canvas?.scene?.createEmbeddedDocuments) return 0;
    const have = n => canvas.scene.tokens.some(t => t.name === `Gate G25 ${n}`);
    const s = canvas.grid.size, x0 = canvas.dimensions.sceneX + s * 3, y0 = canvas.dimensions.sceneY + s * 3, docs = [];
    for (const [n, actor, dx] of [["Hero", hero, 0], ["Goblin A", game.actors.getName("Gate G25 Goblin A"), 3]]) if (!have(n)) docs.push((await actor.getTokenDocument({ x: x0 + dx * s, y: y0 })).toObject());
    if (docs.length) await canvas.scene.createEmbeddedDocuments("Token", docs);
    return canvas.scene.tokens.filter(t => /^Gate G25 /.test(t.name)).length;
  };
  const old = game.actors.getName("Gate G25 Hero");
  if (old) {
    if (!test.getFlag(M, "gateSetup25")) throw new Error("part of the gate is missing: run CLEANUP (the last step), then SETUP again");
    build({ hero: old.id, smith: game.actors.getName("Gate G25 Smith")?.id });
    return { already: "set up", rebuilt: "globalThis.__g25 and the in-memory definitions", tokens: await placeTokens(old), published: await api.publishDefinitions() };
  }
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const published = await api.publishDefinitions();
  const flags = { [M]: { gateThrowaway25: true } };
  const hero = await Actor.create({ name: "Gate G25 Hero", type: "character", ownership: { default: 0, [test.id]: 3 }, flags, prototypeToken: { actorLink: true } });
  const smith = await Actor.create({ name: "Gate G25 Smith", type: "character", ownership: { default: 0 }, flags, prototypeToken: { actorLink: true } });
  await Actor.create({ name: "Gate G25 Goblin A", type: "npc", flags, system: { attributes: { hp: { value: 60, max: 60 }, ac: { value: 12 } } }, prototypeToken: { actorLink: false } });
  for (const [actor, n] of [[hero, 8], [smith, 3]]) {
    await api.giveMaterial(actor, "g25-iron", n);
    await api.giveMaterial(actor, "g25-fang", n);
    await api.grantFormula(actor, "g25-blade");
    await api.adapter.addCopper(actor, 20000);
  }
  await test.setFlag(M, "gateOriginalLocation25", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g25-town");
  await test.setFlag(M, "gateOriginalCharacter25", test.character?.id ?? "none");
  await test.update({ character: hero.id });
  await api.downtime.start({ days: 12, actorIds: [hero.id, smith.id] });
  await test.setFlag(M, "gateSetup25", { at: Date.now(), ids: [hero.id, smith.id] });
  build({ hero: hero.id, smith: smith.id });
  return {
    planted: [
      "the in-memory tag Gate G25 Bite, materials Gate G25 Iron and Gate G25 Fang (the Fang carries the tag), town and workshop (Gate G25 Town, Gate G25 Bench)",
      "the in-memory recipe Gate G25 Blade: body (any material) and edge (needs the tag), output a real PF2e dagger",
      'the characters "Gate G25 Hero" (owned by Test), "Gate G25 Smith" (a second crafter) and "Gate G25 Goblin A" (unlinked token)',
      "8 Iron and 8 Fang for the Hero, 3 and 3 for Smith, the formula for both, 200 gp each",
      "the party in Gate G25 Town; Test's character is now Gate G25 Hero",
      "12 days of downtime for the Hero and Smith",
      "the Hero's and the goblin's tokens on the open scene, nothing crafted yet"
    ],
    tokens: await placeTokens(hero),
    published
  };
})();
```


## Step 3 [GM]: craft with a tagged slot: the record is saved under an opaque id and the item names no tag

**What to do and see:**
- Run the block below in the GM window. It queues a craft for the Hero and resolves it as a forced success.
- You should see: `PASS:` lines and `ALL PASS`. The saved `tagCrafted` setting is printed in full next to what was expected.
- The block checks the id is opaque, the record is saved under it, no key anywhere in the saved store contains a dot, the saved record equals the module's in-memory one, and neither the item's flags nor the Hero's flags name the tag (every match is printed in full).

```js
// [GM] Craft 1: the freezeId is opaque, the record is saved flat and unchanged, and no flag the Player's client holds names the tag.
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero();
  const { out, made, id } = await g.craft(hero);
  g.check("the craft resolved and made a crafted item with a freezeId", out?.status === "resolved" && Boolean(made) && typeof id === "string" && id.length > 0, JSON.stringify({ status: out?.status, message: out?.message, id }));
  if (!id) return g.done();
  const saved = game.settings.get(M, "tagCrafted"), store = saved?.items ?? {};
  g.check("the id is opaque: no tag, material or gate name in it", !/g25|bite|fang|gate/i.test(id), JSON.stringify({ id }));
  g.check("the saved tagCrafted setting holds a record under that id for the recipe (the saved store is printed)", store[id]?.recipeId === "g25-blade", JSON.stringify(saved));
  const dotted = g.dotted(saved);
  g.check("no key anywhere in the saved store contains a dot (a dotted key would have been rewritten into nested objects)", dotted.length === 0, JSON.stringify({ dottedKeyPaths: dotted, storeKeys: Object.keys(store) }));
  g.check("the saved record equals the module's in-memory record: nothing was rewritten on the way", g.canon(store[id]) === g.canon(api.tags.frozen(id)), JSON.stringify({ saved: store[id] ?? null, inMemory: api.tags.frozen(id) }));
  const conditions = (store[id]?.roles?.applyCondition ?? []).map(c => `${c.condition} ${c.value}`);
  g.check("the record holds the tag's condition: frightened 1", conditions.join() === "frightened 1", JSON.stringify({ conditions, roles: store[id]?.roles ?? null }));
  const planted = /g25-bite|Gate G25 Bite|"tags"|"native"|"inherited"|"needs"|"priority"|effectBlocks/;
  const found = [...g.hits(JSON.stringify(made.flags ?? {}), planted).map(h => `the item's flags: ${h}`), ...g.hits(JSON.stringify(hero.flags ?? {}), planted).map(h => `the Hero's flags: ${h}`)];
  g.check("neither the item's flags nor the Hero's flags name the tag or carry tag data (every match is printed)", found.length === 0, found.join(" || "));
  g.check("the item carries the opaque id and the usual crafted flag (the flag is printed)", Boolean(made.getFlag(M, "crafted")?.freezeId), JSON.stringify({ keys: Object.keys(made.getFlag(M, "crafted") ?? {}), flag: made.getFlag(M, "crafted") }));
  g.keep.first = id;
  const user = game.users.getName("Test");
  await user.setFlag(M, "gateSetup25", { ...(user.getFlag(M, "gateSetup25") ?? {}), first: id });
  return g.done();
})();
```


## Step 4 [GM]: edit the tag and the caps afterwards: the old crafted item still applies the OLD conditions

**What to do and see:**
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. The block changes the tag so it now makes the target sickened 3 (Fortitude), sets a cap of 1 on a condition's value, then has the Hero hit Goblin A with the crafted weapon (a message shaped like the real Strike card) and presses Apply on the GM's card with Goblin A's save forced to a failure.
- Goblin A must have **frightened 1** (what the item was made with) and **not** sickened. The block puts the tag and the caps back.

```js
// [GM] Edit the tag and the caps after the craft: a fresh use card for the old item still applies the OLD conditions (frightened 1), read from the frozen record.
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero(), id = g.keep.first ?? game.users.getName("Test").getFlag(M, "gateSetup25")?.first;
  const item = hero.items.find(i => i.getFlag(M, "crafted")?.freezeId === id);
  g.check("the crafted item from Step 3 is on the Hero (run Step 3 first if this fails)", Boolean(item), JSON.stringify({ id, items: hero.items.map(i => i.name) }));
  if (!item) return g.done();
  const goblin = g.token("Goblin A")?.actor;
  g.check("Goblin A's token is on the scene (run SETUP with the scene open if this fails)", Boolean(goblin) && Boolean(g.token("Hero")), JSON.stringify({ tokens: canvas.scene?.tokens.map(t => t.name) }));
  if (!goblin) return g.done();
  const tag = api.definitions.tag.get("g25-bite"), original = structuredClone(tag.effectBlocks);
  let card = null, result = null;
  try {
    tag.effectBlocks.byClass.weapon.blocks = [{ type: "condition", condition: "sickened", value: { all: 3 }, save: "fortitude" }];
    await api.tags.setCaps({ v: 1, roles: { applyCondition: { maxValue: 1 } } });
    g.check("the tag now says sickened 3 and the cap table is saved (both are printed)", /sickened/.test(JSON.stringify(api.definitions.tag.get("g25-bite").effectBlocks)) && /"maxValue":1/.test(JSON.stringify(game.settings.get(M, "tagCaps"))), JSON.stringify({ tag: api.definitions.tag.get("g25-bite").effectBlocks, caps: game.settings.get(M, "tagCaps") }));
    await g.clear(goblin);
    card = await api.effects.handle(g.attack(item));
    g.check("a fresh use card was made for the old item", Boolean(card) && card.getFlag(M, "fx")?.state === "pending", JSON.stringify({ card: card ? { id: card.id, fx: card.getFlag(M, "fx") } : null }));
    if (card) result = await api.effects.applyCard(card.id, { forceDegree: "failure" });
  } finally {
    api.definitions.tag.get("g25-bite").effectBlocks = original;
    await api.tags.setCaps({ v: 1, roles: {} });
  }
  g.check("Apply worked", result?.ok === true, JSON.stringify(result));
  g.check("Goblin A has the OLD condition, frightened 1, and NOT the new one (the conditions are printed)", goblin.getCondition("frightened")?.value === 1 && !goblin.getCondition("sickened"), g.conds(goblin));
  const text = (card?.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  g.check("the card says it in plain words: Goblin A is fearful, and names no value", /Gate G25 Goblin A[^.]*\bis fearful\b/.test(text) && !/sick/i.test(text), JSON.stringify({ text }));
  g.check("the tag and the caps are back as they were (both are printed)", g.canon(api.definitions.tag.get("g25-bite").effectBlocks) === g.canon(original) && Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length === 0, JSON.stringify({ tag: api.definitions.tag.get("g25-bite").effectBlocks, caps: game.settings.get(M, "tagCaps") }));
  await g.clear(goblin);
  return g.done();
})();
```


## Step 5 [GM]: delete the item: the record goes

**What to do and see:**
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. The block deletes the crafted item of Step 3 and waits for the record to be removed (only the ACTIVE GM client does that, so the active GM's name is printed).

```js
// [GM] Delete the crafted item of Step 3: the active GM client removes its record.
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero(), id = g.keep.first ?? game.users.getName("Test").getFlag(M, "gateSetup25")?.first;
  const item = hero.items.find(i => i.getFlag(M, "crafted")?.freezeId === id);
  g.check("the crafted item from Step 3 is on the Hero, and its record is saved (run Step 3 first if this fails)", Boolean(item) && Boolean(g.store()[id]), JSON.stringify({ id, items: hero.items.map(i => i.name), keys: Object.keys(g.store()) }));
  if (!item) return g.done();
  g.check("this GM window is the active GM (only the active GM removes a record)", game.users.activeGM?.id === game.user.id, JSON.stringify({ activeGM: game.users.activeGM?.name ?? null, me: game.user.name }));
  await item.delete();
  const gone = await g.until(() => !g.store()[id]);
  g.check("the record is gone once the item is deleted (the saved keys are printed)", Boolean(gone), JSON.stringify({ id, keys: Object.keys(g.store()) }));
  g.check("the module's in-memory store agrees", api.tags.frozen(id) === null, JSON.stringify({ inMemory: api.tags.frozen(id) }));
  return g.done();
})();
```


## Step 6 [GM]: duplicate the item, delete one copy: the record stays

**What to do and see:**
- Run the block below in the GM window. It crafts again, duplicates the crafted item on the Hero (the copy carries the same id), and deletes the copies one at a time.
- You should see: `PASS:` lines and `ALL PASS`. The record stays while one copy is left and goes with the last.

```js
// [GM] Craft 2, duplicate it, delete one copy (the record stays), delete the last (it goes).
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M } = g, hero = g.hero();
  const { out, made, id } = await g.craft(hero);
  g.check("the craft resolved and made a crafted item with a freezeId", out?.status === "resolved" && Boolean(id), JSON.stringify({ status: out?.status, message: out?.message, id }));
  if (!id) return g.done();
  const [copy] = await hero.createEmbeddedDocuments("Item", [made.toObject()]);
  const carriers = () => hero.items.filter(i => i.getFlag(M, "crafted")?.freezeId === id);
  g.check("two items on the Hero carry the same id (the copy and the original)", carriers().length === 2 && carriers().every(i => i.getFlag(M, "crafted").freezeId === id), JSON.stringify({ id, carriers: carriers().map(i => [i.name, i.id]), copy: copy?.id }));
  await made.delete();
  await g.until(() => carriers().length === 1);
  await new Promise(r => setTimeout(r, 1500));
  g.check("one copy deleted, one left: the record stays (the saved keys are printed)", carriers().length === 1 && Boolean(g.store()[id]), JSON.stringify({ id, carriers: carriers().length, keys: Object.keys(g.store()) }));
  await carriers()[0].delete();
  const gone = await g.until(() => !g.store()[id]);
  g.check("the last copy deleted: the record goes (the saved keys are printed)", Boolean(gone) && carriers().length === 0, JSON.stringify({ id, carriers: carriers().length, keys: Object.keys(g.store()) }));
  return g.done();
})();
```


## Step 7 [GM]: a throwaway actor's craft: delete the actor, see what happens to the record, then prune

**What to do and see:**
- Run the block below in the GM window. It crafts for **Gate G25 Smith**, deletes Smith, waits a moment, prints whether Foundry removed the record by itself, then runs `api.tags.pruneFrozen()`.
- You should see: `PASS:` lines and `ALL PASS`. The line `recorded, not judged: deleting the actor removed the record by itself` says yes or no: that is the answer to whether Foundry fires `deleteItem` for the items of a deleted actor. Whatever it says, the record must be gone after the prune.
- Smith is gone after this step; Steps 8 to 10 use the Hero only. If you run SETUP again it makes Smith again.

```js
// [GM] Craft 3 on Smith, delete Smith: is the record removed by itself (printed, not judged)? pruneFrozen removes it either way.
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, smith = g.smith();
  if (!smith) throw new Error("Gate G25 Smith is gone: run CLEANUP, then SETUP again");
  const { out, made, id } = await g.craft(smith);
  g.check("the craft resolved and made a crafted item on Smith with a freezeId", out?.status === "resolved" && Boolean(id), JSON.stringify({ status: out?.status, message: out?.message, id }));
  if (!id) return g.done();
  g.check("its record is saved (the saved keys are printed)", Boolean(g.store()[id]), JSON.stringify({ id, keys: Object.keys(g.store()) }));
  await smith.delete();
  await g.until(() => !g.store()[id], 3000);
  const byItself = !g.store()[id];
  g.rows.push(`PASS: recorded, not judged: deleting the actor removed the record by itself: ${byItself ? "yes" : "no"} (id ${id}, saved keys ${JSON.stringify(Object.keys(g.store()))})`);
  g.check("Smith is deleted", !game.actors.getName("Gate G25 Smith"), JSON.stringify({ actors: game.actors.filter(a => /^Gate G25 /.test(a.name)).map(a => a.name) }));
  const pruned = await api.tags.pruneFrozen();
  await g.until(() => !g.store()[id]);
  g.check("after pruneFrozen the record is gone (what it removed and the saved keys are printed)", !g.store()[id], JSON.stringify({ id, pruned, keys: Object.keys(g.store()) }));
  g.check("pruneFrozen removed it only if it was still there (the removed ids are consistent with the answer above)", byItself ? !(pruned.removed ?? []).includes(id) : (pruned.removed ?? []).includes(id), JSON.stringify({ byItself, pruned }));
  return g.done();
})();
```


## Step 8 [GM]: delete a record by hand: the use card falls back quietly, with one GM log line

**What to do and see:**
- Run the block below in the GM window. It crafts for the Hero, deletes the record from the saved setting by hand, then has the Hero hit Goblin A with the weapon twice (messages shaped like the real Strike card).
- You should see: `PASS:` lines and `ALL PASS`. No card is made, nothing is thrown, and the GM log holds exactly ONE line about the missing record (it is logged once per id).

```js
// [GM] Craft 4, delete its record by hand (the setting), then two use cards: quiet fallback, one GM log line.
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero();
  const { out, made, id } = await g.craft(hero);
  g.check("the craft resolved and made a crafted item with a freezeId", out?.status === "resolved" && Boolean(id), JSON.stringify({ status: out?.status, message: out?.message, id }));
  if (!id) return g.done();
  const before = game.settings.get(M, "tagCrafted");
  const rest = Object.fromEntries(Object.entries(before?.items ?? {}).filter(([key]) => key !== id));
  await game.settings.set(M, "tagCrafted", { ...before, items: rest });
  const read = await g.until(() => !g.store()[id] && api.tags.frozen(id) === null);
  g.check("the record is gone from the saved setting and from the module's memory (the saved keys are printed)", Boolean(read), JSON.stringify({ id, savedKeys: Object.keys(g.store()), inMemory: api.tags.frozen(id) }));
  api.gm.clearLog();
  const goblin = g.token("Goblin A")?.actor;
  g.check("Goblin A's token is on the scene (run SETUP with the scene open if this fails)", Boolean(goblin), JSON.stringify({ tokens: canvas.scene?.tokens.map(t => t.name) }));
  if (!goblin) return g.done();
  let threw = null, first = "not run", second = "not run";
  try { first = await api.effects.handle(g.attack(made)); second = await api.effects.handle(g.attack(made)); } catch (error) { threw = error.message; }
  g.check("nothing was thrown and no card was made for the item whose record is missing", threw === null && first === null && second === null, JSON.stringify({ threw, first: first?.id ?? first, second: second?.id ?? second }));
  const lines = api.gm.log({ kind: "effect" }).filter(e => new RegExp(`no frozen tag result any more \\(${id}\\)`).test(e.text));
  g.check("the GM log holds exactly one line about the missing record, though two use cards came in (every line about it is printed)", lines.length === 1, JSON.stringify({ id, lines: lines.map(e => e.text), allEffectLines: api.gm.log({ kind: "effect" }).map(e => e.text) }));
  g.check("Goblin A has no condition from it (the conditions are printed)", !goblin.getCondition("frightened"), g.conds(goblin));
  return g.done();
})();
```


## Step 9 [GM]: save the store, then reload the GM window

**What to do and see:**
- Run the block below in the GM window. It crafts once more (so the store is not empty), then saves a copy of the stored setting in Test's flag and says to reload.
- You should see: `HANDOFF: reload the GM window now ...`. **Reload the GM window (Ctrl+Shift+R) and wait for the world to finish loading** (the runner does this itself when it has a reload action), then run Step 10.
- The in-memory definitions are gone after the reload; Step 10 does not need them.

```js
// [GM] Craft 5, then save the stored tagCrafted setting (and the id) in Test's flag so Step 10 can compare after the reload.
await (async () => {
  const g = globalThis.__g25 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M } = g, hero = g.hero();
  const { out, id } = await g.craft(hero);
  g.check("the craft resolved and made a crafted item with a freezeId", out?.status === "resolved" && Boolean(id), JSON.stringify({ status: out?.status, message: out?.message, id }));
  if (!id) return g.done();
  const saved = game.settings.get(M, "tagCrafted");
  const user = game.users.getName("Test");
  await user.setFlag(M, "gateSetup25", { ...(user.getFlag(M, "gateSetup25") ?? {}), reload: { id, saved: g.canon(saved), keys: Object.keys(saved?.items ?? {}) } });
  g.check("the stored setting is saved for the comparison (the saved keys are printed)", Object.keys(saved?.items ?? {}).includes(id), JSON.stringify({ id, keys: Object.keys(saved?.items ?? {}) }));
  const result = g.done();
  return result === "ALL PASS" ? "HANDOFF: reload the GM window now (Ctrl+Shift+R), wait for the world to finish loading, then run Step 10" : result;
})();
```


## Step 10 [GM]: after the reload the store reads back unchanged

**What to do and see:**
- Run the block below in the GM window after the reload.
- You should see: `PASS:` lines and `ALL PASS`. The block compares the stored setting now with the copy saved in Step 9 (both are printed), and checks the module loaded it at ready.

```js
// [GM] After the reload: the stored tagCrafted setting is exactly what Step 9 saved, and the module's store (loaded at ready) holds the record.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api, rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
  const user = game.users.getName("Test"), before = user?.getFlag(M, "gateSetup25")?.reload;
  if (!game.user.isGM || !before) throw new Error("run Steps 2 to 9 first (Step 9 saves what this step compares with)");
  const saved = game.settings.get(M, "tagCrafted");
  check("the stored setting is exactly what was saved before the reload (both are printed)", canon(saved) === before.saved, JSON.stringify({ now: canon(saved), before: before.saved }));
  check("the record of Step 9 is there under the same id (the saved keys are printed)", Object.keys(saved?.items ?? {}).includes(before.id) && JSON.stringify(Object.keys(saved?.items ?? {})) === JSON.stringify(before.keys), JSON.stringify({ id: before.id, now: Object.keys(saved?.items ?? {}), before: before.keys }));
  check("the module loaded it at ready: its in-memory record equals the saved one", canon(api.tags.frozen(before.id)) === canon(saved?.items?.[before.id]), JSON.stringify({ inMemory: api.tags.frozen(before.id), saved: saved?.items?.[before.id] ?? null }));
  const dotted = [];
  const walk = (v, path) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k.includes(".")) dotted.push(`${path}.${k}`); walk(x, `${path}.${k}`); } };
  walk(saved, "$");
  check("no key anywhere in the stored setting contains a dot", dotted.length === 0, JSON.stringify({ dottedKeyPaths: dotted }));
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 11 [Player]: can a Player client read the saved store? (a note, not a pass or fail)

**What to do and see:**
- In the **Player** window run the block below.
- You should see: `PASS:` lines, a line starting `PASS: recorded, not judged` and `ALL PASS`. The expected answer is **yes**: world settings reach every client (the honor system, `CLAUDE.md`). The block prints the answer and what a Player sees in the crafted item's own flags: only the opaque id.

```js
// [Player] Record whether this client can read the saved tagCrafted setting; check the crafted item's flags show only the opaque id.
await (async () => {
  const M = "pathfinder-progress", rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.user.character;
  if (game.user.isGM || hero?.name !== "Gate G25 Hero") throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  let readable = "no", keys = [], error = null;
  try { const store = game.settings.get(M, "tagCrafted"); keys = Object.keys(store?.items ?? {}); readable = store && typeof store === "object" ? (keys.length ? "yes" : "yes, but it is empty") : "empty"; } catch (e) { error = e.message; }
  rows.push(`PASS: recorded, not judged: a Player client can read the tagCrafted world setting from the console: ${readable} (${keys.length} records: ${JSON.stringify(keys)}${error ? `, error: ${error}` : ""}); expected yes: the honor system`);
  const crafted = hero.items.filter(i => i.getFlag(M, "crafted"));
  const planted = /g25-bite|Gate G25 Bite|"tags"|"native"|"inherited"|"needs"|"priority"|effectBlocks/;
  const found = [];
  for (const i of crafted) for (const x of JSON.stringify(i.flags ?? {}).matchAll(new RegExp(planted.source, "g"))) found.push(`item ${i.name}: ${JSON.stringify(JSON.stringify(i.flags).slice(Math.max(0, x.index - 80), x.index))} [[${x[0]}]] ${JSON.stringify(JSON.stringify(i.flags).slice(x.index + x[0].length, x.index + x[0].length + 80))}`);
  check(`the crafted items' flags show only the opaque id and the usual crafted flag, no tag (${crafted.length} read; every match is printed)`, found.length === 0, found.join(" || "));
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 12 [GM]: CLEANUP (always run this, even if a step failed)

**What to do and see:**
- Nothing to click.
- Run the block below. It deletes everything the gate made and puts back what it changed: the characters (Hero, Smith if it is still there, Goblin A), their tokens and items, the frozen records of what was crafted here, the caps, the in-memory definitions, the party location, Test's character and the downtime. Safe to run twice, and safe after a reload.
- You should see: `problems: []`, `actorsLeft: 0`, `tokensLeft: 0`, `frozenLeft: 0`, `capsLeft: 0`, `downtimeOpen: false`, `flagLeft: false` and an empty `audit`.

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice, and safe after a reload (it does not need the globals).
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const names = ["Gate G25 Hero", "Gate G25 Smith", "Gate G25 Goblin A"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway25") === true);
  const saved = user?.getFlag(M, "gateSetup25");
  const ids = [...new Set([...actors.map(a => a.id), ...(saved?.ids ?? [])])];       // Smith may be gone already (Step 7), but she was a downtime participant
  await attempt("the tokens on the scene", async () => {
    for (const scene of game.scenes) { const mine = scene.tokens.filter(t => /^Gate G25 /.test(t.name)).map(t => t.id); if (mine.length) await scene.deleteEmbeddedDocuments("Token", mine); }
  });
  await attempt("the caps", async () => { if (Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length) await api.tags.setCaps({ v: 1, roles: {} }); });
  await attempt("party location", async () => {
    const original = user?.getFlag(M, "gateOriginalLocation25");
    if (original !== undefined) { await game.settings.set(M, "partyLocation", original); await user.unsetFlag(M, "gateOriginalLocation25"); }
  });
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate G25 |g25-/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter25");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter25");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  await attempt("the frozen records of what was crafted here", async () => { await api.tags.pruneFrozen(); });
  for (const [kind, id] of [["recipe", "g25-blade"], ["station", "g25-bench"], ["town", "g25-town"], ["material", "g25-fang"], ["material", "g25-iron"], ["tag", "g25-bite"]]) api.definitions[kind]?.delete(id);
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup25") !== undefined) await user.unsetFlag(M, "gateSetup25"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  api.gm.clearLog();
  delete globalThis.__g25;
  return {
    problems,
    actorsLeft: game.actors.filter(a => names.includes(a.name)).length,
    tokensLeft: [...game.scenes].reduce((n, s) => n + s.tokens.filter(t => /^Gate G25 /.test(t.name)).length, 0),
    frozenLeft: Object.values(game.settings.get(M, "tagCrafted")?.items ?? {}).filter(r => r.recipeId === "g25-blade").length,
    capsLeft: Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length,
    downtimeOpen: api.downtime.isOpen(),
    flagLeft: user?.getFlag(M, "gateSetup25") !== undefined,
    audit: api.audit.scan()
  };
})();
```
