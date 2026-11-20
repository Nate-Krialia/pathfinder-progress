# 29 Playtest seed (a GM-only setup and cleanup for a hand playtest)

This file is for the owner, playing the module by hand in a NEW, separate test world. It holds, in this order:

1. **INSTALL**: putting a build on a real Foundry, one action at a time.
2. **SETUP**: one script block that plants throwaway "Playtest ..." data.
3. **CLEANUP**: one script block that removes only what SETUP made and prints each removal.
4. **TEST SHEET**: what to click and what you should see, area by area.

Nothing here runs by itself. The two script blocks run only when you paste one into a Script Macro and press it.

## Part 1: INSTALL

(written in a later commit of this round)

## Part 2: SETUP

**What to do and see:**
- Make a Script Macro (Macro Directory, Create Macro, Type: Script) named `Playtest SETUP` and paste the block below into it.
- Press the macro in the GM window, then press F12 and look at the Console tab.
- You should see: lines starting `PLAYTEST SETUP`, ending with a `planted` list and (if anything needs you) `WARNINGS`.

```js
// [GM] SETUP: plants the "Playtest ..." data (see the list this block prints at the end). GM only. Never runs by itself. Safe to run again: a second run plants nothing new and only puts the
// in-memory definitions back (run it again after a reload of the GM window or a server restart). Open the browser console (F12) to read the lines it prints.
await (async () => {
  const M = "pathfinder-progress", SEED = "playtestSeed", api = game.modules.get(M)?.api;
  // ---- Things you may change ----
  const USERS = { alice: "Playtest Alice", bob: "Playtest Bob" };                       // the names of two Player users you made (this block never makes users)
  const LEVELS = { alice: 3, bob: 5 };                                                   // the character levels asked for (set in its own step, see "levelNotes")
  const PACK = "pf2e.equipment-srd", NAMES = { edge: "Torch", charm: "Rope", weapon: "Dagger", sword: "Longsword" };   // PF2e items, found by NAME (no uuid is typed in here)
  const SCENE = "Playtest Field", TOWN = "oakhaven";

  const stop = message => { ui.notifications?.error?.(`Playtest SETUP: ${message}`); throw new Error(message); };
  const say = (label, value) => console.log(`PLAYTEST SETUP ${label}${value === undefined ? "" : `: ${JSON.stringify(value)}`}`);
  if (!game.user.isGM) stop("run this in the GM window");
  if (!api?.editor || typeof api.tags?.setEntry !== "function" || typeof api.placeNode !== "function") stop("this world is not on a build with the Item editor, the Item tags api and the node tools: install the build, restart the Foundry server and force-reload the window");
  const mine = doc => !doc || doc.getFlag(M, SEED) === true;
  const ACTOR_NAMES = ["Playtest Alice", "Playtest Bob", "Playtest Patron", "Playtest Wolf"];
  const clash = [...ACTOR_NAMES.map(n => game.actors.getName(n)), game.scenes.getName(SCENE), game.items.getName("Playtest Torch Sample")].filter(doc => !mine(doc));
  if (clash.length) stop(`"${clash.map(d => d.name).join('", "')}" already exists and was not made by this macro; rename or delete it first`);

  // The PF2e items, by name: ONE message lists every name that is missing.
  const pack = game.packs.get(PACK);
  if (!pack) stop(`there is no compendium "${PACK}" in this world (is this a pf2e world?)`);
  const index = await pack.getIndex();
  const missing = Object.values(NAMES).filter(name => !index.find(entry => entry.name === name));
  if (missing.length) stop(`the compendium "${PACK}" has no item named "${missing.join('", "')}": change NAMES at the top of this block to equipment items that exist there`);
  const docs = Object.fromEntries(await Promise.all(Object.entries(NAMES).map(async ([key, name]) => [key, await pack.getDocument(index.find(entry => entry.name === name)._id)])));
  const uuids = Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, doc.uuid]));
  say("found these PF2e items (by name)", uuids);

  // ---- the in-memory definition (the editor cannot hold a RECIPE; it makes only tags, materials and notes) ----
  const OUT = Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier, uuids.weapon]));
  const memory = [
    ["recipe", { kind: "recipe", category: "weapon", id: "playtest-blade", name: "Playtest Blade", output: OUT, craftLevel: 2, stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, stationCategory: "smithing",
      slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 },
        { name: "edge", drives: ["bonusDamage"], tierFloor: 1, qty: 1, lossChance: 0, needs: { all: ["playtest-edge"] } },
        { name: "charm", drives: ["bonusDamage"], tierFloor: 1, qty: 1, lossChance: 0, needs: { all: ["playtest-charm"] } }] }]
  ];
  const ensureMemory = () => {
    for (const [kind, record] of memory) {
      if (api.definitions[kind].has(record.id)) continue;
      const problems = api.checkDefinition(record);
      if (problems.length) stop(`the in-memory ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
      api.definitions[kind].set(record.id, record);
    }
  };

  // ---- a second run: nothing new is made ----
  const sceneOld = game.scenes.getName(SCENE);
  const anyOld = ACTOR_NAMES.map(n => game.actors.getName(n)).filter(Boolean);
  if (sceneOld || anyOld.length) {
    const old = sceneOld?.getFlag(M, "playtestManifest");
    if (!sceneOld || old?.complete !== true || anyOld.length !== ACTOR_NAMES.length) stop("part of the seed is missing (a character or the scene was deleted, or an earlier run stopped half way): run CLEANUP, then SETUP again");
    ensureMemory();
    for (const key of old.editorKeys) if (!api.editor.entry(key)) stop(`the editor record ${key} is gone: run CLEANUP, then SETUP again`);
    await api.publishDefinitions();
    say("already set up: put the in-memory definitions back", memory.map(([kind, record]) => `${kind}:${record.id}`));
    return { already: "set up", rebuilt: memory.map(([kind, record]) => `${kind}:${record.id}`), warnings: old.warnings ?? [] };
  }
  const leftDefs = [...["playtest-edge", "playtest-charm"].filter(id => api.definitions.tag.has(id)).map(id => `tag ${id}`), ...["playtest-ember", "playtest-study-ore"].filter(id => api.definitions.material.has(id)).map(id => `material ${id}`)];
  if (leftDefs.length) stop(`${leftDefs.join(", ")} already exists and was not made by this macro: remove it in the Item editor first`);
  for (const [what, uuid] of [["Torch", uuids.edge], ["Rope", uuids.charm]]) if (api.tags.ledger().items[uuid]) stop(`the ${what} (${uuid}) is already tagged in your Item tags ledger: this macro tags it and takes the tag off again, so untag it first`);

  // ---- from here on, everything made is written into the manifest on the scene, step by step ----
  const users = { alice: game.users.getName(USERS.alice), bob: game.users.getName(USERS.bob) };
  const warnings = [];
  const man = {
    v: 1, complete: false, at: Date.now(), editorKeys: [], ledgerRefs: [], items: [], partyStations: [], ownedStations: [], memory: memory.map(([kind, record]) => [kind, record.id]),
    users: { alice: users.alice?.id ?? null, bob: users.bob?.id ?? null }, characters: {},
    location: game.settings.get(M, "partyLocation") ?? "", foldersBefore: game.folders.filter(f => f.type === "Item").map(f => f.name)
  };
  for (const user of Object.values(users)) if (user) man.characters[user.id] = user.character?.id ?? "none";
  const flags = { [M]: { [SEED]: true } };
  const scene = await Scene.create({ name: SCENE, width: 2000, height: 1400, grid: { size: 100 }, padding: 0, ownership: { default: 2 }, flags: { [M]: { [SEED]: true, playtestManifest: man } } });
  const save = () => scene.setFlag(M, "playtestManifest", man);
  const ownedBy = (user, key) => {
    if (user) return { default: 0, [user.id]: 3 };
    warnings.push(`There is no user named "${USERS[key]}", so "Playtest ${key === "alice" ? "Alice" : "Bob"}" has no owner. Make a Player user with that name (or change USERS at the top and run CLEANUP, then SETUP), then give that user Owner permission on the character and pick it as their character in User Configuration.`);
    return { default: 0 };
  };

  // ---- the persisted definitions (the Item editor keeps these in this world, so they survive a reload) ----
  const damage = (dice, damageType) => ({ type: "damage", dice: { all: dice }, damageType });
  const make = async (kind, fields, options) => { const out = await api.editor.create(kind, fields, options); man.editorKeys.push(out.key); await save(); return out; };
  await make("tag", { name: "Playtest Edge", theme: "things with a bite", worksWith: "frightened", effectBlocks: { general: { blocks: [damage("1d4", "fire")] } } }, { makeItem: false });
  await make("tag", { name: "Playtest Charm", theme: "things that soothe", effectBlocks: { general: { blocks: [damage("1d4", "poison")] } } }, { makeItem: false });
  await make("material", { name: "Playtest Ember", tier: 1, value: 6, effectBlocks: { general: { power: 1, blocks: [] }, byClass: { weapon: { blocks: [damage("1d6", "fire"), { type: "ability", title: "Playtest Glow", text: "The blade glows faintly." }] } } } });
  await make("material", { name: "Playtest Study Ore", tier: 1, value: 8, tag: "playtest-edge", research: { milestones: [{ steps: 3, grants: { type: "properties" } }] } });
  ensureMemory();
  say("editor records (kept in this world)", man.editorKeys);
  say("in-memory definitions (gone after a reload: run SETUP again)", man.memory);

  // ---- people, the scene and its tokens ----
  const alice = await Actor.create({ name: "Playtest Alice", type: "character", ownership: ownedBy(users.alice, "alice"), flags, prototypeToken: { actorLink: true } });
  const bob = await Actor.create({ name: "Playtest Bob", type: "character", ownership: ownedBy(users.bob, "bob"), flags, prototypeToken: { actorLink: true } });
  const patron = await Actor.create({ name: "Playtest Patron", type: "npc", ownership: { default: 0 }, flags, prototypeToken: { actorLink: true } });      // owned by the GM only
  const wolf = await Actor.create({ name: "Playtest Wolf", type: "npc", ownership: { default: 0 }, flags, system: { attributes: { hp: { value: 20, max: 20 } } }, prototypeToken: { actorLink: false } });
  man.actors = [alice, bob, patron, wolf].map(a => a.id);
  await save();
  const levelNotes = [];
  for (const [actor, level] of [[alice, LEVELS.alice], [bob, LEVELS.bob]]) {
    try { await actor.update({ "system.details.level.value": level }); levelNotes.push(`${actor.name}: asked for level ${level}; the sheet now says ${actor.system?.details?.level?.value ?? "nothing"}`); }
    catch (error) { levelNotes.push(`${actor.name}: the level could not be set (${error.message}); set it on the character sheet by hand`); }
  }
  say("levels (setting a level never stops SETUP)", levelNotes);
  let x = 200;
  for (const actor of [alice, bob, patron]) { const td = await actor.getTokenDocument({ x: (x += 200), y: 200 }); await scene.createEmbeddedDocuments("Token", [td.toObject()]); }

  // ---- gathering: nodes on the scene (the shipped node types), one hidden for a search, a hand-made corpse node ----
  await api.setLocation(TOWN);
  const place = async (name, nodeType, charges, at) => { const token = await api.placeNode(scene, { nodeType, tier: 1, charges, x: at, y: 500 }); await token.update({ name }); return token; };
  await place("Playtest Herb Patch", "herb", 3, 300);
  await place("Playtest Ore Vein", "ore", 2, 500);
  await place("Playtest Salvage Pile", "salvage", 2, 700);
  const hidden = await place("Playtest Hidden Herb", "herb", 3, 1000);
  await hidden.update({ hidden: true, [`flags.${M}.node.revealed`]: false });
  const wolfToken = (await wolf.getTokenDocument({ x: 400, y: 800 })).toObject();
  const [corpse] = await scene.createEmbeddedDocuments("Token", [{ ...wolfToken, name: "Playtest Wolf Corpse" }]);
  await api.makeCorpseNode(corpse, { tier: 1, charges: 2, decayTimer: 3, creature: { name: "Playtest Wolf", type: "animal" }, ladder: [{ materialId: "spider-fang", dcOffset: 0, quantity: "1", guaranteed: true }] });
  await save();

  // ---- crafting: ingredients (real PF2e copies that share one source), the tags on them, two world items ----
  const copy = (doc, name, quantity) => ({ ...game.items.fromCompendium(doc), name, system: { ...(game.items.fromCompendium(doc).system ?? {}), quantity } });
  await alice.createEmbeddedDocuments("Item", [copy(docs.edge, "Playtest Torch Stack", 3), copy(docs.edge, "Playtest Torch Single", 1), copy(docs.charm, "Playtest Rope A", 2), copy(docs.charm, "Playtest Rope B", 2)]);
  await api.tags.setEntry(uuids.edge, { tags: ["playtest-edge"], tier: 2, name: "Playtest Torch" });
  man.ledgerRefs.push(uuids.edge);
  await api.tags.setEntry(uuids.charm, { tags: ["playtest-charm"], tier: 3, name: "Playtest Rope" });
  man.ledgerRefs.push(uuids.charm);
  const sample = await Item.create({ ...game.items.fromCompendium(docs.edge), name: "Playtest Torch Sample", flags });
  man.items.push(sample.id);
  await save();

  // ---- materials, formulas, gold ----
  for (const [actor, materials] of [[alice, { iron: 8, "spider-fang": 2, silver: 2, "playtest-ember": 2, "playtest-study-ore": 2 }], [bob, { iron: 4, "spider-fang": 2, silver: 2 }]]) {
    for (const [id, quantity] of Object.entries(materials)) await api.giveMaterial(actor, id, quantity);
    await api.adapter.addCopper(actor, 20000);
  }
  await api.grantFormula(alice, "dagger-spider-fang");
  await api.grantFormula(alice, "playtest-blade");
  await api.grantFormula(bob, "dagger-spider-fang");

  // ---- workshops: the public bench is the shipped Oakhaven Forge; an owned workshop (Alice's, ready to upgrade); a party workshop ----
  const owned = await api.giveStation(alice, { name: "Playtest Anvil", category: "smithing", tier: 1, location: { town: TOWN }, id: "playtest-anvil" });
  man.ownedStations.push(owned.id);
  const party = { id: "party-playtest-camp", name: "Playtest Camp Forge", category: "smithing", tier: 1, town: TOWN, builtBy: alice.id, blueprintId: "camp-forge", builtAt: Date.now() };
  await game.settings.set(M, "partyStations", [...(game.settings.get(M, "partyStations") ?? []), party]);
  man.partyStations.push(party.id);
  await save();

  // ---- research: a study (Alice carries Playtest Study Ore), a formula project (Bob), a lead (Alice) ----
  await api.startProject({ actor: bob, recipe: "longsword-basic" });
  await api.research.giveLead(alice, "longsword-basic", "A smith in Oakhaven says there is a trick to a long blade.");

  // ---- the user's character, then the Compendium's entries (written a moment after the gifts above) ----
  for (const [key, actor] of [["alice", alice], ["bob", bob]]) if (users[key]) await users[key].update({ character: actor.id });
  const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; };
  const booked = await until(() => alice.getFlag(M, "compendium")?.materials?.iron);
  if (!booked) warnings.push("The Compendium had not recorded Alice's materials yet (wait a moment and look in the Hub)");
  await api.publishDefinitions();
  // ---- a weapon already crafted by Bob (a plain Spider Fang Dagger, a forced success) ----
  let crafted = null;
  try { crafted = await api.craft({ actor: bob, recipeId: "dagger-spider-fang", selection: { blade: "iron", fang: "spider-fang" }, station: "oakhaven-forge", degree: "success" }); }
  catch (error) { warnings.push(`Bob's crafted dagger could not be made (${error.message}); craft one by hand in the Hub instead`); }
  man.complete = true;
  await save();
  const planted = [
    `${man.actors.length} characters: Playtest Alice (owner: ${users.alice?.name ?? "nobody"}), Playtest Bob (owner: ${users.bob?.name ?? "nobody"}), Playtest Patron (GM only, the commission patron), Playtest Wolf (for the corpse)`,
    `the scene ${SCENE} with their tokens, three visible nodes, one hidden node and a hand-made corpse node (not activated: open it yourself)`,
    `editor records, kept in this world: ${man.editorKeys.join(", ")}`,
    `in-memory definitions (gone after a reload): ${man.memory.map(([kind, id]) => `${kind}:${id}`).join(", ")}`,
    `Alice's bag: real copies of ${NAMES.edge} (two stacks) and ${NAMES.charm} (two stacks), tagged in the Item tags ledger, plus Playtest Ember and Playtest Study Ore; formulas dagger-spider-fang and playtest-blade; a lead; 200 gp`,
    "Bob: a project for the Longsword formula, a crafted Spider Fang Dagger, materials and 200 gp",
    `workshops: the public Oakhaven Forge (shipped), Alice's owned ${owned.name}, the party's ${party.name}`,
    `world items: Playtest Torch Sample (for the Item tags window) and the editor's items for Playtest Ember and Playtest Study Ore (for the Item editor)`,
    `the party is in ${TOWN} (it was "${man.location || "nowhere"}")`
  ];
  say("planted", planted);
  if (warnings.length) say("WARNINGS (read these)", warnings);
  ui.notifications?.info?.(`Playtest SETUP done${warnings.length ? ` with ${warnings.length} warning(s): read the console` : ""}. Downtime is NOT open yet: the test sheet starts it.`);
  return { planted, warnings, levelNotes, uuids, crafted: crafted ? "made" : "not made" };
})();
```

## Part 3: CLEANUP

**What to do and see:**
- Make a second Script Macro named `Playtest CLEANUP` and paste the block below into it.
- Press it in the GM window, then read the Console tab.
- You should see: one `PLAYTEST CLEANUP removed:` line per thing, then notes. Pressed again, it says `nothing to remove`.

```js
// (the CLEANUP block is written in the next commit of this round)
```

## Part 4: TEST SHEET

(written in a later commit of this round)
