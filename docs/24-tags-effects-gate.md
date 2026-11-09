# 24 Tags gate, stacking, caps and effects on a real craft (real Foundry)

Run in a real world on PF2e 8.6.1 with a **GM window** and an **incognito Player window logged in as the user "Test"**, on the **active scene** (the three tokens are placed on it). Every step is labelled **[GM]** or **[Player]**. **Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see is its own bullet starting "You should see:".** Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. **Every FAIL line prints each value it compared**, and the steps that read data Foundry could change (a saved setting, an item's rules) print the stored value next to the expected one.

`tests/gate24.test.js` plays every step in a fake Foundry (a pretend compendium, items with sources, PF2e-like actors and tokens, a fake chat log) in which a dotted key is rewritten the way real Foundry does. **What the fake cannot prove, and only this gate can, in real Foundry:** that PF2e accepts the crafted weapon with several `DamageDice` rule elements and rolls them, that the numbers a craft stacks are the numbers on the weapon, that a cap clamps what it should and says so only to the GM, that a crafted weapon's use card applies the stacked conditions to the right token actors, what a real craft and a real cancel do to a stack of copies that share a source, and that the saved caps, ledger and frozen records read back as written.

**What SETUP plants** (all throwaway "Gate G24" things): three tags, `g24-fang` (1d4 fire damage, makes the target frightened 1, Will save), `g24-venom` (1d4 fire damage, makes the target sickened 2, Fortitude save) and `g24-barb` (1d6 poison damage; a tag holds at most one damage block per item class, so the Rope carries both Venom and Barb), a recipe **Gate G24 Blade** whose output is a real PF2e dagger and whose two tagged slots (Edge, Charm) match those tags, the characters **Gate G24 Hero** (owned by Test) and **Gate G24 Goblin A** (unlinked token) and **Gate G24 Goblin B** (linked token) with their tokens on the open scene, and, on the Hero, **several real copies that share one compendium source**: a stack of 3 plus a single copy of a **Torch** (the Edge ingredient), and two stacks of 2 **Rope** (the Charm ingredient). Torch and Rope are tagged in Step 3 and untagged in Step 11.

**What the gate shows**
- **Stacking.** Fire damage from two ingredients adds up (1d4 + 1d4 = 2d4); poison stays separate; the crafted weapon carries exactly those rule elements, and a real damage roll or formula shows them (Steps 4 and 5).
- **Caps.** A cap clamps only its own role; what it cut is written to the GM log only and never reaches a player (Steps 6, 7 and 10). The saved cap table is printed.
- **Several copies, one source.** A craft takes the FIRST copy that shares the source and the player cannot choose; the steps print which copy was escrowed and how many shared the source, and Step 8 prints what a cancel does to a stack.
- **Effects.** A hit with the crafted weapon gives the GM a card whose Apply puts the stacked conditions on the TARGET token's actor (Step 9).
- **Nothing leaks.** The player's client holds no tag, no cap and no note about a clamp (Step 10).

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
- Open the scene you play on and make it the **active** scene (right-click it in the Scenes tab, Activate), so the Player window shows it.
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts the in-memory definitions and `globalThis.__g24` back, and places any token that is missing).
- You should see: an object with `planted` (eight lines), `tokens` (3 when a scene was open) and a `published` revision. On a rerun it says `already: "set up"`.
- If `tokens` is 0, open a scene and run the block again.
- If it stops with `has no item named`, change `NAMES` at the top of the block to equipment items that exist in the PF2e equipment pack and run it again (Torch and Rope are the defaults, and Dagger is the weapon the craft makes).

```js
// [GM] SETUP: in-memory g24- definitions (two tags with effects, a material, a town, a workshop, a recipe whose Edge and Charm slots match the tags), Gate G24 Hero with real copies of two compendium items
// (several copies share each source), two goblins with tokens, the party in Gate G24 Town and 12 days of downtime. Says what it planted.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const PACK = "pf2e.equipment-srd", NAMES = { edge: "Torch", charm: "Rope", weapon: "Dagger" };
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (typeof api.tags?.refsOf !== "function" || typeof api.effects?.applyCard !== "function") throw new Error("this world is not on a build with api.tags.refsOf and the effect cards: update the module and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway24") === true;
  for (const n of ["Hero", "Goblin A", "Goblin B"]) if (!mine(game.actors.getName(`Gate G24 ${n}`))) throw new Error(`"Gate G24 ${n}" already exists and was not made by this check; rename or delete it first`);
  const pack = game.packs.get(PACK);
  if (!pack) throw new Error(`There is no compendium "${PACK}" in this world`);
  const index = await pack.getIndex();
  const entryOf = name => { const e = index.find(x => x.name === name); if (!e) throw new Error(`The compendium "${PACK}" has no item named "${name}": change NAMES at the top of this block to an equipment item that exists there`); return e; };
  const edge = await pack.getDocument(entryOf(NAMES.edge)._id), charm = await pack.getDocument(entryOf(NAMES.charm)._id);
  const OUT = Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier, `Compendium.${PACK}.Item.${entryOf(NAMES.weapon)._id}`]));
  const damage = (dice, damageType) => ({ type: "damage", dice: { all: dice }, damageType });
  const defs = [
    ["tag", { kind: "tag", id: "g24-fang", name: "Gate G24 Fang", theme: "things with a bite", effectBlocks: { general: { blocks: [damage("1d4", "fire")] }, byClass: { weapon: { blocks: [{ type: "condition", condition: "frightened", value: { all: 1 }, save: "will" }] } } } }],
    ["tag", { kind: "tag", id: "g24-venom", name: "Gate G24 Venom", theme: "things that poison", effectBlocks: { general: { blocks: [damage("1d4", "fire")] }, byClass: { weapon: { blocks: [{ type: "condition", condition: "sickened", value: { all: 2 }, save: "fortitude" }] } } } }],
    ["tag", { kind: "tag", id: "g24-barb", name: "Gate G24 Barb", theme: "things with a barb", effectBlocks: { general: { blocks: [damage("1d6", "poison")] } } }],
    ["town", { kind: "town", id: "g24-town", name: "Gate G24 Town" }],
    ["material", { kind: "material", id: "g24-iron", name: "Gate G24 Iron", tier: 1, effects: { basePower: "T1" } }],
    ["station", { kind: "station", id: "g24-bench", name: "Gate G24 Bench", category: "smithing", tier: 1, town: "g24-town" }],
    ["recipe", { kind: "recipe", category: "weapon", id: "g24-blade", name: "Gate G24 Blade", output: OUT, craftLevel: 2, stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, stationCategory: "smithing",
      slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 },
        { name: "edge", drives: ["bonusDamage", "applyCondition"], tierFloor: 1, qty: 1, lossChance: 0, needs: { all: ["g24-fang"] } },
        { name: "charm", drives: ["bonusDamage", "applyCondition"], tierFloor: 1, qty: 1, lossChance: 0, needs: { all: ["g24-venom"] } }] }]
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
  const stats = item => item._stats?.toObject?.() ?? item._stats ?? {};
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, rows, keep: {}, stats, sources: { edge: edge.uuid, charm: charm.uuid },
      hero: () => game.actors.get(ids.hero),
      token: name => canvas.scene?.tokens.find(t => t.name === `Gate G24 ${name}`),
      queued: actor => actor.getFlag(M, "pendingActions") ?? [],
      sharing: (actor, source) => actor.items.filter(i => !i.getFlag(M, "crafted") && stats(i).compendiumSource === source),
      bag: actor => actor.items.filter(i => !i.getFlag(M, "crafted") && [edge.uuid, charm.uuid].includes(stats(i).compendiumSource)).map(i => `${i.name} x${i.system?.quantity ?? 1}`),
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      conds: actor => ["frightened", "sickened"].map(s => `${s}${actor.getCondition(s) ? (actor.getCondition(s).value ?? "") || "y" : "-"}`).join(" "),
      clear: async actor => { for (const slug of ["frightened", "sickened"]) await api.effects.adapter.removeCondition(actor, slug); },
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g24 = g;
    return g;
  };
  const placeTokens = async hero => {
    if (!canvas?.scene?.createEmbeddedDocuments) return 0;
    const have = n => canvas.scene.tokens.some(t => t.name === `Gate G24 ${n}`);
    const s = canvas.grid.size, x0 = canvas.dimensions.sceneX + s * 3, y0 = canvas.dimensions.sceneY + s * 3, docs = [];
    for (const [n, actor, dx] of [["Hero", hero, 0], ["Goblin A", game.actors.getName("Gate G24 Goblin A"), 3], ["Goblin B", game.actors.getName("Gate G24 Goblin B"), 6]]) if (!have(n)) docs.push((await actor.getTokenDocument({ x: x0 + dx * s, y: y0 })).toObject());
    if (docs.length) await canvas.scene.createEmbeddedDocuments("Token", docs);
    return canvas.scene.tokens.filter(t => /^Gate G24 /.test(t.name)).length;
  };
  const old = game.actors.getName("Gate G24 Hero");
  if (old) {
    if (!test.getFlag(M, "gateSetup24")) throw new Error("part of the gate is missing: run CLEANUP (the last step), then SETUP again");
    build({ hero: old.id });
    return { already: "set up", rebuilt: "globalThis.__g24 and the in-memory definitions", tokens: await placeTokens(old), published: await api.publishDefinitions() };
  }
  for (const [what, source] of [["edge", edge.uuid], ["charm", charm.uuid]]) if (api.tags.ledger().items[source]) throw new Error(`the ${what} compendium item ${source} is already tagged in your ledger: this gate tags it and takes the tag off again, so untag it first`);
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const published = await api.publishDefinitions();
  const flags = { [M]: { gateThrowaway24: true } };
  const hero = await Actor.create({ name: "Gate G24 Hero", type: "character", ownership: { default: 0, [test.id]: 3 }, flags, prototypeToken: { actorLink: true } });
  const goblin = (n, linked) => Actor.create({ name: `Gate G24 Goblin ${n}`, type: "npc", flags, system: { attributes: { hp: { value: 60, max: 60 }, ac: { value: 12 } } }, prototypeToken: { actorLink: linked } });
  await goblin("A", false);
  await goblin("B", true);
  await api.giveMaterial(hero, "g24-iron", 8);
  await api.grantFormula(hero, "g24-blade");
  const copy = (doc, name, quantity) => ({ ...game.items.fromCompendium(doc), name, system: { ...(game.items.fromCompendium(doc).system ?? {}), quantity } });
  await hero.createEmbeddedDocuments("Item", [copy(edge, "Gate G24 Torch Stack", 3), copy(edge, "Gate G24 Torch Single", 1), copy(charm, "Gate G24 Rope A", 2), copy(charm, "Gate G24 Rope B", 2)]);
  await api.adapter.addCopper(hero, 20000);
  await test.setFlag(M, "gateOriginalLocation24", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g24-town");
  await test.setFlag(M, "gateOriginalCharacter24", test.character?.id ?? "none");
  await test.update({ character: hero.id });
  await api.downtime.start({ days: 12, actorIds: [hero.id] });
  await test.setFlag(M, "gateSetup24", { at: Date.now(), edge: edge.uuid, charm: charm.uuid, copies: { edge: 4, charm: 4 } });
  build({ hero: hero.id });
  return {
    planted: [
      "the in-memory tags Gate G24 Fang, Gate G24 Venom and Gate G24 Barb, material Gate G24 Iron, town and workshop (Gate G24 Town, Gate G24 Bench)",
      "the in-memory recipe Gate G24 Blade: body (any material), edge (needs Fang) and charm (needs Venom), output a real PF2e dagger",
      'the characters "Gate G24 Hero" (owned by Test), "Gate G24 Goblin A" (unlinked token) and "Gate G24 Goblin B" (linked token)',
      `on the Hero, real copies sharing the source ${edge.uuid}: Gate G24 Torch Stack (3) and Gate G24 Torch Single (1)`,
      `on the Hero, real copies sharing the source ${charm.uuid}: Gate G24 Rope A (2) and Gate G24 Rope B (2)`,
      "8 Gate G24 Iron, the formula, 200 gp, and the party in Gate G24 Town",
      "Test's character is now Gate G24 Hero, and 12 days of downtime are open for the Hero",
      "nothing is tagged yet (Step 3 tags the two compendium items)"
    ],
    tokens: await placeTokens(hero),
    published
  };
})();
```


## Step 3 [GM]: tag the two compendium items, and see which copies match

**What to do and see:**
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. Every comparison prints its values.
- The block tags the Torch (Fang, tier 2) and the Rope (Venom and Barb, tier 3) under their compendium uuids, asks `refsOf` about every copy on the Hero, and prints the saved ledger setting.

```js
// [GM] Tag the two compendium items; every copy sharing a source matches; the saved ledger setting is printed.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero(), { edge, charm } = g.sources;
  await api.tags.setEntry(edge, { tags: ["g24-fang"], tier: 2, name: "Gate G24 Torch" });
  await api.tags.setEntry(charm, { tags: ["g24-venom", "g24-barb"], tier: 3, name: "Gate G24 Rope" });
  await g.until(() => api.tags.ledger().items[edge] && api.tags.ledger().items[charm]);
  const stored = JSON.stringify(game.settings.get(M, "tagLedger"));
  const keys = JSON.stringify(Object.keys(api.tags.ledger().items));
  g.check("the ledger holds both tags after the write (keys in memory and the saved setting are printed)", Boolean(api.tags.ledger().items[edge]) && Boolean(api.tags.ledger().items[charm]), JSON.stringify({ keys, stored }));
  const refs = {};
  for (const item of g.sharing(hero, edge).concat(g.sharing(hero, charm))) refs[item.name] = await api.tags.refsOf(item);
  const values = JSON.stringify({ copiesSharingTheEdgeSource: g.sharing(hero, edge).map(i => `${i.name} x${i.system?.quantity ?? 1}`), copiesSharingTheCharmSource: g.sharing(hero, charm).map(i => `${i.name} x${i.system?.quantity ?? 1}`), refs });
  g.check("two real copies share the Torch source, and two share the Rope source (so the first-copy rule and the several-copies tolerance run in Steps 4, 6, 7 and 8)", g.sharing(hero, edge).length === 2 && g.sharing(hero, charm).length === 2, values);
  g.check("every Torch copy matches the Fang tag at tier 2 and fits the Edge slot", ["Gate G24 Torch Stack", "Gate G24 Torch Single"].every(n => refs[n]?.matched === edge && refs[n].tier === 2 && refs[n].tags.join() === "g24-fang" && refs[n].fitsBySlot["g24-blade/edge"] === "g24-blade"), values);
  g.check("every Rope copy matches the Venom and Barb tags at tier 3 and fits the Charm slot", ["Gate G24 Rope A", "Gate G24 Rope B"].every(n => refs[n]?.matched === charm && refs[n].tier === 3 && refs[n].tags.join() === "g24-venom,g24-barb" && refs[n].fitsBySlot["g24-blade/charm"] === "g24-blade"), values);
  g.keep.bag = g.bag(hero);
  return g.done();
})();
```


## Step 4 [GM]: a craft with two tagged ingredients: the numbers stack, the weapon carries them

**What to do and see:**
- The runner queues the craft in the Player window (Gate G24 Blade: Gate G24 Iron in Body, the Torch in Edge, the Rope in Charm, Gate G24 Bench). By hand: in the Player window open the Downtime window for Gate G24 Hero, choose the formula, pick those three and click **Queue the craft**.
- Run the block below in the GM window. It resolves the craft as a forced success.
- You should see: `PASS:` lines and `ALL PASS`. The block prints which copies were escrowed and how many shared each source (the craft takes the FIRST copy sharing a source), the stacked numbers, and the rule elements on the crafted weapon.
- The block renames the weapon to **Gate G24 Blade** so the later steps find it.

```js
// [GM] Resolve craft 1 (a forced success): fire adds up (1d4 + 1d4 = 2d4), poison stays; the weapon carries those rule elements; the first copies sharing each source were escrowed.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero(), { edge, charm } = g.sources;
  const action = g.queued(hero).find(a => a.type === "craft");
  g.check("a craft is queued (the Player's clicks queue it; do them first if this fails)", Boolean(action), JSON.stringify(g.queued(hero).map(a => a.type)));
  if (!action) return g.done();
  const units = (action.params?.escrow?.units ?? []).filter(u => u.itemData);
  const escrowed = Object.fromEntries(units.map(u => [u.itemData._stats?.compendiumSource, { name: u.itemData.name, units: u.units }]));
  g.rows.push(`PASS: which copies were escrowed, and how many copies shared each source: ${JSON.stringify({ escrowed, copiesStillInTheBag: { torch: g.sharing(hero, edge).length, rope: g.sharing(hero, charm).length }, bagBefore: g.keep.bag })}`);
  g.check("a copy of the right source was escrowed for the Edge and for the Charm", Boolean(escrowed[edge]) && Boolean(escrowed[charm]), JSON.stringify(escrowed));
  const out = await api.queue.resolve(hero, action.id, { degree: "success", chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  const made = await g.until(() => hero.items.find(i => i.getFlag(M, "crafted")));
  const flag = made?.getFlag(M, "crafted");
  g.check("a crafted weapon is on the Hero, with an opaque freezeId", Boolean(made) && typeof flag?.freezeId === "string", JSON.stringify(flag));
  if (!made) return g.done();
  await made.update({ name: "Gate G24 Blade" });
  const record = api.tags.frozen(flag.freezeId);
  const rolesText = JSON.stringify(record?.roles ?? null);
  const fire = (record?.roles?.bonusDamage ?? []).find(d => d.type === "fire"), poison = (record?.roles?.bonusDamage ?? []).find(d => d.type === "poison");
  g.check("the stack: fire adds up to 2d4, poison stays 1d6 (the saved record is printed)", fire?.dice === "2d4" && poison?.dice === "1d6", rolesText);
  const conditions = Object.fromEntries((record?.roles?.applyCondition ?? []).map(c => [c.condition, c.value]));
  g.check("the stack: frightened 1 (Fang) and sickened 2 (Venom)", conditions.frightened === 1 && conditions.sickened === 2, JSON.stringify(conditions));
  const rules = (made.toObject().system.rules ?? []).filter(r => r.key === "DamageDice");
  const rulesText = JSON.stringify(rules);
  g.check("the weapon carries one DamageDice rule element per stacked group: 2d4 fire and 1d6 poison (the rules as saved on the item are printed)", rules.length === 2 && rules.some(r => r.diceNumber === 2 && r.dieSize === "d4" && r.damageType === "fire") && rules.some(r => r.diceNumber === 1 && r.dieSize === "d6" && r.damageType === "poison"), rulesText);
  const live = made.rules ?? null;
  g.check("PF2e accepts the rule elements: none was ignored or failed to load (the live rule elements are printed)", live === null || (live.filter(r => r.key === "DamageDice").length === 2 && live.every(r => !r.ignored)), JSON.stringify(live?.map(r => ({ key: r.key, ignored: r.ignored }))));
  g.check("the item's flags carry only the opaque id: no tag and no tag data", !/g24-fang|g24-venom|g24-barb|Gate G24 Fang|Gate G24 Venom|Gate G24 Barb|"tags"|"native"|"inherited"|"needs"|effectBlocks/.test(JSON.stringify(made.flags ?? {})), JSON.stringify(made.flags ?? {}));
  g.keep.craft1 = flag.freezeId;
  g.keep.bag = g.bag(hero);
  return g.done();
})();
```


## Step 5 [GM]: the real damage formula

**What to do and see:**
- The runner reads the damage formula of **Gate G24 Blade** from the Hero's strike without posting a chat card (needs the runner's `damageFormula` action). By hand: open the Hero's sheet, Strikes, roll damage on **Gate G24 Blade** once, and read the formula in the chat card.
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. If the runner supplied the formula it contains the 2d4 fire and the 1d6 poison; if not, the block says so and the hand roll is the check (the formula there must show **2d4** fire and **1d6** poison).

```js
// [GM] The weapon's real damage formula (supplied by the runner, or read by hand) shows the stacked dice.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const formula = g.formula ?? null;
  if (formula === null) g.rows.push("PASS: no formula was captured by the runner: roll damage on Gate G24 Blade by hand and check the chat card shows 2d4 fire and 1d6 poison");
  else g.check("the strike's damage formula shows the stacked fire (2d4) and the poison (1d6)", /2d4/.test(formula) && /1d6/.test(formula), JSON.stringify({ formula }));
  const made = g.hero().items.find(i => i.name === "Gate G24 Blade");
  g.check("Gate G24 Blade is on the Hero (Step 4 made it)", Boolean(made), JSON.stringify(g.hero().items.map(i => i.name)));
  return g.done();
})();
```


## Step 6 [GM]: a cap clamps its own role, and says so only to the GM

**What to do and see:**
- The runner queues the craft again in the Player window (the same clicks as Step 4). By hand, do Step 4's clicks first.
- Run the block below in the GM window. It sets the cap `bonusDamage.maxDicePerType` to 1, resolves the craft as a forced success, then puts the caps back.
- You should see: `PASS:` lines and `ALL PASS`. The block prints the saved cap table, the clamped result and the GM log line.

```js
// [GM] Craft 2 under a cap of 1 die per damage type: fire is cut from 2d4 to 1d4, poison and the conditions are untouched, the GM log says what was cut, the caps are restored.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero();
  const action = g.queued(hero).find(a => a.type === "craft");
  g.check("a craft is queued (the Player's clicks queue it; do Step 4's clicks first if this fails)", Boolean(action), JSON.stringify(g.queued(hero).map(a => a.type)));
  if (!action) return g.done();
  const known = new Set(hero.items.filter(i => i.getFlag(M, "crafted")).map(i => i.id));
  await api.tags.setCaps({ v: 1, roles: { bonusDamage: { maxDicePerType: 1 } } });
  const stored = JSON.stringify(game.settings.get(M, "tagCaps"));
  g.check("the cap is saved (the saved setting is printed)", /"maxDicePerType":1/.test(stored), stored);
  let made = null, record = null;
  try {
    api.gm.clearLog();
    const out = await api.queue.resolve(hero, action.id, { degree: "success", chat: true });
    g.check("it resolved", out.status === "resolved", out.message);
    made = await g.until(() => hero.items.find(i => i.getFlag(M, "crafted") && !known.has(i.id)));
    record = made ? api.tags.frozen(made.getFlag(M, "crafted").freezeId) : null;
  } finally {
    await api.tags.setCaps({ v: 1, roles: {} });
  }
  const bonus = record?.roles?.bonusDamage ?? [];
  g.check("fire was clamped to one die (1d4) and poison stayed 1d6 (the saved record is printed)", bonus.find(d => d.type === "fire")?.dice === "1d4" && bonus.find(d => d.type === "poison")?.dice === "1d6", JSON.stringify(record?.roles ?? null));
  g.check("the conditions are untouched by a damage cap", (record?.roles?.applyCondition ?? []).length === 2, JSON.stringify(record?.roles?.applyCondition));
  const log = api.gm.log({ kind: "craft" });
  g.check("the GM log says what the cap cut", log.some(e => /capped bonusDamage \(fire\)/.test(e.text)), JSON.stringify(log.map(e => e.text)));
  g.check("the caps are back to the defaults (the saved setting is printed)", Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length === 0, JSON.stringify(game.settings.get(M, "tagCaps")));
  if (made) await made.update({ name: "Gate G24 Blade B" });
  g.keep.bag = g.bag(hero);
  return g.done();
})();
```


## Step 7 [GM]: a count cap keeps the highest tier first

**What to do and see:**
- The runner queues the craft again in the Player window. By hand, do Step 4's clicks first.
- Run the block below in the GM window. It sets the cap `applyCondition.maxCount` to 1, resolves the craft as a forced success, then puts the caps back.
- You should see: `PASS:` lines and `ALL PASS`. Of the two conditions only the one from the higher-tier ingredient (sickened, from the tier 3 Rope) is kept.

```js
// [GM] Craft 3 under a cap of one condition: the highest tier is kept first (sickened from the tier 3 Rope, not frightened from the tier 2 Torch); the GM log says what was cut; the caps are restored.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero();
  const action = g.queued(hero).find(a => a.type === "craft");
  g.check("a craft is queued (the Player's clicks queue it; do Step 4's clicks first if this fails)", Boolean(action), JSON.stringify(g.queued(hero).map(a => a.type)));
  if (!action) return g.done();
  const known = new Set(hero.items.filter(i => i.getFlag(M, "crafted")).map(i => i.id));
  await api.tags.setCaps({ v: 1, roles: { applyCondition: { maxCount: 1 } } });
  g.check("the cap is saved (the saved setting is printed)", /"maxCount":1/.test(JSON.stringify(game.settings.get(M, "tagCaps"))), JSON.stringify(game.settings.get(M, "tagCaps")));
  let made = null, record = null;
  try {
    api.gm.clearLog();
    const out = await api.queue.resolve(hero, action.id, { degree: "success", chat: true });
    g.check("it resolved", out.status === "resolved", out.message);
    made = await g.until(() => hero.items.find(i => i.getFlag(M, "crafted") && !known.has(i.id)));
    record = made ? api.tags.frozen(made.getFlag(M, "crafted").freezeId) : null;
  } finally {
    await api.tags.setCaps({ v: 1, roles: {} });
  }
  const conditions = (record?.roles?.applyCondition ?? []).map(c => `${c.condition} ${c.value}`);
  g.check("one condition is kept: sickened 2, from the higher-tier ingredient (the saved record is printed)", conditions.length === 1 && conditions[0] === "sickened 2", JSON.stringify({ conditions, roles: record?.roles ?? null }));
  const log = api.gm.log({ kind: "craft" });
  g.check("the GM log says what the cap cut", log.some(e => /capped applyCondition: 2 conditions became 1/.test(e.text)), JSON.stringify(log.map(e => e.text)));
  g.check("the caps are back to the defaults (the saved setting is printed)", Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length === 0, JSON.stringify(game.settings.get(M, "tagCaps")));
  if (made) await made.update({ name: "Gate G24 Blade C" });
  g.keep.bag = g.bag(hero);
  return g.done();
})();
```


## Step 8 [GM]: what a cancel does to a stack of copies, and the frozen records

**What to do and see:**
- The runner queues the craft again in the Player window. By hand, do Step 4's clicks first.
- Run the block below in the GM window. It cancels the queued craft and prints what happened to every copy.
- You should see: `PASS:` lines and `ALL PASS`. **Read the `PASS: what a cancel did` line: it is the answer to what a cancel does to a stack** (a known cosmetic issue: the escrowed copy may come back as a new item instead of joining the stack it came from). The block does not mind either way; it checks that no unit is lost.
- The block also prints the saved frozen-craft keys and checks that the crafts of Steps 4, 6 and 7 have a record each.

```js
// [GM] Cancel a queued craft: print the copies sharing each source before, while queued and after (a stack may come back as a new item); the frozen records are listed.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M, api } = g, hero = g.hero(), { edge, charm } = g.sources;
  const action = g.queued(hero).find(a => a.type === "craft");
  g.check("a craft is queued (the Player's clicks queue it; do Step 4's clicks first if this fails)", Boolean(action), JSON.stringify(g.queued(hero).map(a => a.type)));
  if (!action) return g.done();
  const units = bag => bag.reduce((n, entry) => n + Number(/x(\d+)$/.exec(entry)?.[1] ?? 1), 0);
  const before = g.keep.bag ?? [], whileQueued = g.bag(hero);
  const escrowed = (action.params?.escrow?.units ?? []).filter(u => u.itemData).map(u => `${u.itemData.name} x${u.units} (the escrowed item's own quantity was ${u.itemData.system?.quantity ?? 1})`);
  const out = await api.queue.cancel(hero, action.id);
  await g.until(() => g.queued(hero).length === 0);
  await g.until(() => units(g.bag(hero)) === units(before));
  const after = g.bag(hero);
  const detail = JSON.stringify({ before, escrowed, whileQueued, after, itemsBefore: before.length, itemsAfter: after.length, cancel: out });
  g.rows.push(`PASS: what a cancel did to the copies sharing a source: ${detail}; ${after.length > before.length ? "the escrowed unit came back as a NEW item (the stack split)" : after.length === before.length ? "no new item: the unit went back where it came from" : "fewer items than before"}`);
  g.check("the queue is empty and not one unit of either source was lost (the bags are printed)", g.queued(hero).length === 0 && units(after) === units(before), detail);
  g.check("the units escrowed while queued were fewer than before (the craft really held them)", units(whileQueued) < units(before), detail);
  const store = game.settings.get(M, "tagCrafted")?.items ?? {};
  const keys = Object.keys(store);
  const ids = [g.keep.craft1].filter(Boolean);
  g.check("the saved frozen-craft setting holds a record for each craft made so far (three), under flat keys (the saved keys are printed)", keys.length >= 3 && keys.every(k => !k.includes(".")) && ids.every(id => keys.includes(id)), JSON.stringify({ keys, recipeIds: keys.map(k => store[k]?.recipeId) }));
  return g.done();
})();
```


## Step 9 [GM]: strike with the crafted weapon and press Apply: the stacked conditions land on the token's actor

**What to do and see:**
- The runner selects the Hero's token, targets **Gate G24 Goblin A**, makes a Strike with **Gate G24 Blade** (the die is rigged to hit), and presses Apply on the GM's card with Goblin A's save forced to a failure. It then does the same for **Gate G24 Goblin B** with the save forced to a success. By hand: select the Hero token, target Goblin A, Strike with Gate G24 Blade, press Apply on the whispered card; then the same on Goblin B (the saves are rolled in secret, so a goblin may shrug it off).
- Run the block below in the GM window.
- You should see: `PASS:` lines and `ALL PASS`. Goblin A (unlinked token) has frightened 1 and sickened 2; Goblin B (linked token) has neither; each card names the goblin in plain words and no card shows a DC, a roll or a value.

```js
// [GM] The two cards from the Strikes: applied to the right token actors, plain words, nothing secret in chat.
await (async () => {
  const g = globalThis.__g24 ?? (() => { throw new Error("run SETUP (Step 2) first"); })();
  const { M } = g;
  const cards = game.messages.contents.filter(m => m.flags?.[M]?.fx && /Gate G24 Blade/.test(m.flags[M].fx.text ?? ""));
  const done = cards.filter(m => m.flags[M].fx.state === "done");
  const text = m => (m.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const A = g.token("Goblin A")?.actor, B = g.token("Goblin B")?.actor;
  const detail = JSON.stringify({ cards: cards.map(m => ({ state: m.flags[M].fx.state, text: text(m).slice(-160) })), goblinA: A ? g.conds(A) : null, goblinB: B ? g.conds(B) : null });
  g.check("two cards for Gate G24 Blade were made and applied (one per Strike)", cards.length === 2 && done.length === 2, detail);
  g.check("Goblin A (an unlinked token: the token's own actor) has frightened 1 and sickened 2", Boolean(A) && A.getCondition("frightened")?.value === 1 && A.getCondition("sickened")?.value === 2, detail);
  g.check("Goblin B (a linked token, so the world actor) passed its save: neither condition", Boolean(B) && !B.getCondition("frightened") && !B.getCondition("sickened"), detail);
  g.check("the cards say it in plain words: Goblin A is affected, Goblin B shrugs it off", done.some(m => /Gate G24 Goblin A[^.]*\bis fearful\b/.test(text(m)) && /Gate G24 Goblin A[^.]*\bis sick\b/.test(text(m))) && done.some(m => /Gate G24 Goblin B shrugs it off/.test(text(m))), detail);
  g.check("no card carries a DC, a roll, a save or a condition value", !done.some(m => /\bDC\b|\btotal\b|\bWill\b|\bFortitude\b|"value"\s*:|"save"\s*:/.test(m.content + JSON.stringify(m.flags?.[M]))), detail);
  await g.clear(A); await g.clear(B);
  g.check("the conditions can be taken off again", !A.getCondition("frightened") && !A.getCondition("sickened"), `${g.conds(A)} | ${g.conds(B)}`);
  return g.done();
})();
```


## Step 10 [Player]: what the player's client holds

**What to do and see:**
- In the **Player** window run the block below.
- You should see: `PASS:` lines and `ALL PASS`. It reads every chat message this client holds (a whisper is delivered to every client), the Hero's flags and every item's flags, looking for a tag's name or id, a cap, a note about a clamp, a DC or a roll total.
- The crafted weapons' rule elements and description legitimately show the final numbers (2d4 fire); that is not looked for.

```js
// [Player] No chat message, actor flag or item flag names a tag, a cap, what a cap cut, a DC or a roll total.
await (async () => {
  const M = "pathfinder-progress", rows = [];
  const check = (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`);
  const hero = game.user.character;
  if (game.user.isGM || hero?.name !== "Gate G24 Hero") throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  const tagWords = /g24-fang|g24-venom|g24-barb|Gate G24 Fang|Gate G24 Venom|Gate G24 Barb|"tags"|"native"|"inherited"|"needs"|"priority"|"passCap"|effectBlocks/;
  const capWords = /\bcapped\b|maxDicePerType|maxCount|maxValue|maxTier|\bbecame\b|tagCaps/i;
  const secretWords = /\bDC\b|\btotal\b|\bodds\b/i;
  const chat = game.messages.contents.map(m => `${m.content ?? ""} ${JSON.stringify(m.flags ?? {})}`);
  const actorFlags = JSON.stringify(hero.flags ?? {});
  const itemFlags = hero.items.map(i => `${i.name}: ${JSON.stringify(i.flags ?? {})}`);
  const show = (list, re) => list.filter(t => re.test(t)).join(" | ").slice(0, 300);
  check(`no chat message this client holds names a tag or tag data (${chat.length} read)`, !chat.some(t => tagWords.test(t)), show(chat, tagWords));
  check("and none mentions a cap or what a cap cut", !chat.some(t => capWords.test(t)), show(chat, capWords));
  check("and none carries a DC, a roll total or odds", !chat.some(t => secretWords.test(t)), show(chat, secretWords));
  check("the character's flags name no tag and carry no cap", !tagWords.test(actorFlags) && !capWords.test(actorFlags), actorFlags.slice(0, 300));
  check(`no item's flags name a tag or a cap (${itemFlags.length} read)`, !itemFlags.some(t => tagWords.test(t) || capWords.test(t)), show(itemFlags, new RegExp(`${tagWords.source}|${capWords.source}`, "i")));
  let readable = "no";
  try { const caps = game.settings.get(M, "tagCaps"); readable = caps && typeof caps === "object" ? "yes" : "empty"; } catch { readable = "no"; }
  rows.push(`PASS: recorded, not judged: a player client can read the tagCaps world setting from the console: ${readable} (the honor system)`);
  console.log(rows.join("\n"));
  return rows.some(r => r.startsWith("FAIL")) ? "FAILED: scroll up for the lines" : "ALL PASS";
})();
```


## Step 11 [GM]: CLEANUP (always run this, even if a step failed)

**What to do and see:**
- Nothing to click.
- Run the block below. It deletes everything the gate made and puts back what it changed: both goblins and the Hero (with their tokens and items), the tags it set, the caps, the in-memory definitions, the frozen records of what was crafted here, the party location, Test's character and the downtime. Safe to run twice, and safe after a reload.
- You should see: `problems: []`, `actorsLeft: 0`, `tokensLeft: 0`, `frozenLeft: 0`, `ledgerLeft: 0`, `capsLeft: 0`, `downtimeOpen: false`, `sharedLeft: 0`, `flagLeft: false` and an empty `audit`.

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice, and safe after a reload (it does not need the globals).
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const user = game.users.getName("Test");
  const names = ["Gate G24 Hero", "Gate G24 Goblin A", "Gate G24 Goblin B"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway24") === true);
  const ids = actors.map(a => a.id);
  const saved = user?.getFlag(M, "gateSetup24");
  await attempt("the tokens on the scene", async () => {
    for (const scene of game.scenes) { const mine = scene.tokens.filter(t => /^Gate G24 /.test(t.name)).map(t => t.id); if (mine.length) await scene.deleteEmbeddedDocuments("Token", mine); }
  });
  await attempt("the caps", async () => { if (Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length) await api.tags.setCaps({ v: 1, roles: {} }); });
  await attempt("party location", async () => {
    const original = user?.getFlag(M, "gateOriginalLocation24");
    if (original !== undefined) { await game.settings.set(M, "partyLocation", original); await user.unsetFlag(M, "gateOriginalLocation24"); }
  });
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the shared Compendium", async () => {
    const book = game.settings.get(M, "sharedCompendium");
    if (!book) return;
    const drop = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => !k.startsWith("g24-")));
    const next = { ...book, materials: drop(book.materials), experiments: drop(book.experiments) };
    if (JSON.stringify(next) !== JSON.stringify(book)) await game.settings.set(M, "sharedCompendium", next);
  });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate G24 |g24-/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter24");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter24");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  await attempt("the tags this gate set", async () => {
    const items = api.tags.ledger().items;
    for (const key of Object.keys(items).filter(k => [saved?.edge, saved?.charm].includes(k) || (items[k].name ?? "").startsWith("Gate G24 "))) await api.tags.removeEntry(key);
  });
  await attempt("the frozen records of what was crafted here", async () => { await api.tags.pruneFrozen(); });
  for (const [kind, id] of [["recipe", "g24-blade"], ["station", "g24-bench"], ["town", "g24-town"], ["material", "g24-iron"], ["tag", "g24-barb"], ["tag", "g24-venom"], ["tag", "g24-fang"]]) api.definitions[kind]?.delete(id);
  await attempt("Test's flag", async () => { if (user?.getFlag(M, "gateSetup24") !== undefined) await user.unsetFlag(M, "gateSetup24"); });
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  api.gm.clearLog();
  delete globalThis.__g24;
  return {
    problems,
    actorsLeft: game.actors.filter(a => names.includes(a.name)).length,
    tokensLeft: [...game.scenes].reduce((n, s) => n + s.tokens.filter(t => /^Gate G24 /.test(t.name)).length, 0),
    frozenLeft: Object.values(game.settings.get(M, "tagCrafted")?.items ?? {}).filter(r => r.recipeId === "g24-blade").length,
    ledgerLeft: Object.keys(api.tags.ledger().items).filter(k => [saved?.edge, saved?.charm].includes(k)).length,
    capsLeft: Object.keys(game.settings.get(M, "tagCaps")?.roles ?? {}).length,
    downtimeOpen: api.downtime.isOpen(),
    sharedLeft: Object.keys(game.settings.get(M, "sharedCompendium")?.experiments ?? {}).filter(k => k.startsWith("g24-")).length,
    flagLeft: user?.getFlag(M, "gateSetup24") !== undefined,
    audit: api.audit.scan()
  };
})();
```
