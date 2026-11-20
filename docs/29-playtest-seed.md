# 29 Playtest seed (a GM-only setup and cleanup for a hand playtest)

This file is for the owner, playing the module by hand in a NEW, separate test world. It holds, in this order:

1. **INSTALL**: putting a build on a real Foundry, one action at a time.
2. **SETUP**: one script block that plants throwaway "Playtest ..." data.
3. **CLEANUP**: one script block that removes only what SETUP made and prints each removal.
4. **TEST SHEET**: what to click and what you should see, area by area.

Nothing here runs by itself. The two script blocks run only when you paste one into a Script Macro and press it.

## Part 1: INSTALL

**Read this first.** Everything the module stores in a world (actor flags, token flags, world settings) is delivered to every client in that world, and a Player can read it from the browser console. That includes the hidden nodes' Perception DCs, a project's stored DC and threshold, the tag ledger and every other GM setting. This is the module's "honour system" (see `README.md`, "Known limit"). So the playtest world must hold **throwaway data only**: nothing from your real campaign, nothing private.

Versions on the test clone, which the module was checked against: **Foundry 14.369** and **PF2e 8.6.1**. The module warns in the console and a notification if you run older ones.

### Install 1 [Owner]: back up the Foundry data folder

**What to do and see:**
- Find your Foundry **Data** folder (the one that holds the `worlds`, `systems` and `modules` folders). If a hosting service runs Foundry for you, use its backup or snapshot button instead.
- Copy the whole Data folder to a safe place, or make the snapshot.
- You should see: a copy that contains your worlds, for example a folder named `worlds` with your real campaign in it.

### Install 2 [Owner]: install the module

**What to do and see:**
- Choose how to install. **Way A** (the manifest URL) is quickest. **Way B** (the exact build) is for when you must have one particular commit. Do ONE of them.
- Way A: on the Foundry setup screen open **Add-on Modules**, press **Install Module**, and paste this into **Manifest URL**: `https://github.com/Nate-Krialia/pathfinder-progress/releases/download/dev/module.json`
- Way A: press **Install**.
- You should see: Pathfinder Progress installs, and Foundry offers to install **socketlib** too. Say yes.
- Way B: open the GitHub **Actions** page of the repository, open the run for the commit you want, and download the artifact named `module-<that commit's full sha>` (you need a GitHub login).
- Way B: unzip the artifact, then unzip the `module.zip` inside it into a new folder `Data/modules/pathfinder-progress/`.
- You should see: `Data/modules/pathfinder-progress/module.json` (the file sits directly in that folder, not in a folder inside it) and the folders `scripts`, `styles` and `packs`. Also install socketlib from **Install Module** (search "socketlib").

### Install 3 [Owner]: check you have the build you meant (Way A)

**What to do and see:**
- The dev build is replaced by every push to the repository, so it may not be the commit you want. This step checks.
- On the GitHub page `https://github.com/Nate-Krialia/pathfinder-progress/releases/tag/dev` download the asset `module.zip`.
- Work out its SHA-256. On Windows PowerShell: `Get-FileHash module.zip -Algorithm SHA256`. On Mac or Linux: `sha256sum module.zip`.
- On the Actions run of the commit you want, download the artifact `module-<full sha>` and open the file `module.zip.sha256` in it. The long hex string at the start is the build's SHA-256.
- You should see: the two strings are identical. If they differ, a newer build replaced the dev one: use **Way B** instead.

### Install 4 [Owner]: restart the Foundry server

**What to do and see:**
- Stop and start the Foundry process or service itself (a hosting service has a restart button). Going back to the setup screen or reloading the browser is NOT enough: the module has `"socket": true`, and Foundry reads that only when the server starts.
- Open Foundry again in the browser.
- You should see: the setup screen, with **Add-on Modules** listing Pathfinder Progress and socketlib.

### Install 5 [Owner]: make a NEW world on the pf2e system

**What to do and see:**
- On the setup screen open **Game Worlds** and press **Create World**.
- Name it something like `Pathfinder Progress Playtest`. Choose the **Pathfinder Second Edition** system. Do NOT reuse a real campaign world.
- Save it, then **Launch World** and log in as the Gamemaster.
- You should see: an empty world.

### Install 6 [GM]: turn the modules on in this world only

**What to do and see:**
- In the world press the gear tab, then **Manage Modules**.
- Tick **Pathfinder Progress** and **socketlib**, then press **Save Module Settings** and agree to reload.
- Press F12 to open the browser console and look at the Console tab after the reload.
- You should see: a line like `pathfinder-progress | ready (7 materials, 2 recipes, 0 errors)`, and no red errors that mention the module.

### Install 7 [GM]: write down which socketlib you have

**What to do and see:**
- In **Manage Modules** find socketlib. Its version is shown next to its name, or in **Setup, Add-on Modules** outside the world.
- Note it. The module was tested with socketlib **1.1.3** on the clone; the latest published one is **1.1.4** (marked verified for Foundry 14).
- You should see: either version. Both are expected to work, but tell the team which one you have, because 1.1.4 has not been through the module's real-Foundry checks.

### Install 8 [Owner]: make the two Player users

**What to do and see:**
- In the world press the gear tab, then **Configure Players**, then **Create User**.
- Name the first user `Playtest Alice`, role **Player**, and give it a password you choose. This is a public server, so pick a strong one.
- Make a second user `Playtest Bob` the same way.
- You should see: both names in the player list. The SETUP macro never makes users: it looks for these two names. If you use other names, change `USERS` at the top of the SETUP block.

### Install 9 [GM]: the first-run settings, and what SETUP does for you

**What to do and see:**
- Do Part 2 (SETUP) now. It sets the party location to Oakhaven (`api.setLocation("oakhaven")`) and gives each Player user Owner permission on its character and sets it as their character.
- If you skipped SETUP or want to do it by hand, in the GM console run `await game.modules.get("pathfinder-progress").api.setLocation("oakhaven")`.
- Open a downtime period when you are ready to test (the test sheet's first step does this): `await game.modules.get("pathfinder-progress").api.downtime.start({ days: 12 })`.
- You should see: the party location set (**Module Settings, Pathfinder Progress, Party location**). Until downtime is open the Hub says downtime is closed, which is the module working.
- A character belongs to the "party" only when a non-GM user owns it at **Owner** level. Without that, the shared Compendium and the party workshop do nothing.
- Nothing else needs a setting: the station fees are fixed in the module (1, 5, 20, 80 and 300 gp for tiers 1 to 5), the nesting depth defaults to 3, and the tag caps start at their defaults.

### Install 10 [Owner]: put a newer build on later

**What to do and see:**
- The module's version stays `0.22.0` in every build, so Foundry will NOT offer an Update. You replace the files yourself.
- In the world run the CLEANUP macro first if you want a clean start, then return to the setup screen.
- In **Add-on Modules** choose Pathfinder Progress and press **Uninstall**. This removes the module's files only: the world and its data stay.
- Install again (Install 2, Way A or Way B), check the build (Install 3), and restart the server (Install 4).
- Launch the world, press **Playtest SETUP** again (after a restart it puts the in-memory recipe back, see the test sheet).
- You should see: the console line `pathfinder-progress | ready (...)` and the same Playtest characters as before.

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
  for (const [actor, materials] of [[alice, { iron: 8, "spider-fang": 2, silver: 2, "playtest-ember": 2, "playtest-study-ore": 2 }], [bob, { iron: 4, "spider-fang": 2, silver: 2 }], [patron, { iron: 2, "spider-fang": 1 }]]) {
    for (const [id, quantity] of Object.entries(materials)) await api.giveMaterial(actor, id, quantity);
    await api.adapter.addCopper(actor, 20000);
  }
  await api.grantFormula(alice, "dagger-spider-fang");
  await api.grantFormula(alice, "playtest-blade");
  await api.grantFormula(bob, "dagger-spider-fang");
  await api.grantFormula(patron, "dagger-spider-fang");                       // a character patron lends the formula for the commission

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
    "Bob: a project for the Longsword formula, a crafted Spider Fang Dagger, materials and 200 gp; the Patron holds the dagger formula, iron, a spider fang and 200 gp for a commission",
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
// [GM] CLEANUP: removes ONLY what the "Playtest" SETUP made (the documents that carry the playtestSeed flag, and what the manifest saved on the scene names), puts back what SETUP changed, and
// prints each thing it removed. GM only. Never runs by itself. Safe to run twice: the second run prints "nothing to remove". Open the browser console (F12) to read the lines.
await (async () => {
  const M = "pathfinder-progress", SEED = "playtestSeed", api = game.modules.get(M)?.api;
  const stop = message => { ui.notifications?.error?.(`Playtest CLEANUP: ${message}`); throw new Error(message); };
  if (!game.user.isGM) stop("run this in the GM window");
  if (!api?.editor) stop("this world is not on a build with the Item editor");
  const removed = [], restored = [], problems = [];
  const done = text => { removed.push(text); console.log(`PLAYTEST CLEANUP removed: ${text}`); };
  const putBack = text => { restored.push(text); console.log(`PLAYTEST CLEANUP put back: ${text}`); };
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); console.log(`PLAYTEST CLEANUP PROBLEM ${what}: ${error.message}`); } };
  const flagged = doc => doc?.getFlag?.(M, SEED) === true;

  const scene = game.scenes.filter(flagged).find(s => s.name === "Playtest Field") ?? null;
  const man = scene?.getFlag(M, "playtestManifest") ?? null;
  const actors = game.actors.filter(flagged);
  const items = game.items.filter(flagged);

  if (man) {
    // the party location and the users' own characters go back first
    await attempt("the party location", async () => { await game.settings.set(M, "partyLocation", man.location ?? ""); putBack(`the party location (it is "${man.location || "nowhere"}" again)`); });
    for (const [userId, original] of Object.entries(man.characters ?? {})) {
      await attempt("a user's character", async () => {
        const user = game.users.get(userId);
        if (!user) return;
        await user.update({ character: original !== "none" && game.actors.get(original) && !flagged(game.actors.get(original)) ? original : null });
        putBack(`${user.name}'s character (${original === "none" ? "none, as before" : "the one from before SETUP"})`);
      });
    }
  }
  if (scene) {
    await attempt("clear the map", async () => { const cleared = await api.clearMap(scene); done(`the placed nodes on the scene (${cleared?.removed ?? 0} token(s) from Clear map)`); });
    await attempt("the scene's expedition record", async () => { const all = game.settings.get(M, "explorationState") ?? {}; if (scene.id in all) { delete all[scene.id]; await game.settings.set(M, "explorationState", all); done("the scene's expedition record"); } });
    await attempt("delete the scene", async () => { const name = scene.name; await scene.delete(); done(`the scene ${name} (and its tokens, including the corpse)`); });
  }
  if (man?.partyStations?.length) {
    await attempt("the party workshop", async () => {
      const list = game.settings.get(M, "partyStations") ?? [];
      const kept = list.filter(record => !man.partyStations.includes(record.id));
      if (kept.length !== list.length) { await game.settings.set(M, "partyStations", kept); done(`the party workshop ${man.partyStations.join(", ")}`); }
    });
  }
  await attempt("the audit log", async () => {
    const ledger = api.audit.ledger();
    let touched = 0;
    for (const actor of actors) if (ledger[actor.id]) { delete ledger[actor.id]; touched++; }
    // only the history lines that name one of OUR characters (never a line that merely says "Playtest")
    const ours = actors.map(a => a.name);
    if (ledger._events && ours.length) { const before = ledger._events.history.length; ledger._events.history = ledger._events.history.filter(h => !ours.some(name => h.text.includes(name))); touched += before - ledger._events.history.length; }
    if (touched) { await game.settings.set(M, "auditLedger", ledger); done(`${touched} audit-ledger line(s) that name Playtest characters`); }
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, async () => { const name = actor.name; await actor.delete(); done(`the character ${name} (with its bag, its workshops, its Compendium and its formulas)`); });
  for (const item of items) await attempt(`delete ${item.name}`, async () => { const name = item.name; await item.delete(); done(`the world item ${name}`); });
  if (man?.ledgerRefs?.length) {
    for (const ref of man.ledgerRefs) await attempt("an Item tags entry", async () => { if (api.tags.ledger().items[ref]) { await api.tags.removeEntry(ref); done(`the Item tags entry for ${ref}`); } });
  }
  // editor records: materials first, tags LAST (a material may still name a tag, and the editor refuses to remove a tag that is in use)
  if (man?.editorKeys?.length) {
    const keys = [...man.editorKeys].sort((a, b) => a.startsWith("tag:") - b.startsWith("tag:"));
    for (const key of keys) await attempt(`remove ${key}`, async () => { if (api.editor.entry(key)) { await api.editor.remove(key); done(`the editor record ${key}`); } });
  }
  if (man?.memory?.length) {
    await attempt("the in-memory definitions", async () => {
      let n = 0;
      for (const [kind, id] of man.memory) if (api.definitions[kind]?.delete(id)) n++;
      if (n) { await api.publishDefinitions(); done(`${n} in-memory definition(s): ${man.memory.map(([k, id]) => `${k}:${id}`).join(", ")}`); }
    });
  }
  if (man?.foldersBefore) {
    await attempt("the Items folders", async () => {
      for (const name of ["Materials", "Notes"].filter(n => !man.foldersBefore.includes(n))) {
        const folder = game.folders.find(f => f.type === "Item" && f.name === name);
        if (folder && !game.items.some(i => (i.folder?.id ?? i.folder) === folder.id)) { await folder.delete(); done(`the Items folder ${name} (SETUP made it and it is empty)`); }
      }
    });
  }
  delete globalThis.__playtest;

  // What it did NOT touch, so you are not surprised.
  const notes = [];
  if (!man) {
    const strays = Object.entries(api.editor.records()).filter(([, rec]) => /^Playtest /.test(rec.fields?.name ?? "")).map(([key]) => key);
    if (strays.length) notes.push(`No manifest was found (the Playtest Field scene is gone), so the editor records ${strays.join(", ")} were NOT touched. Remove them in the Item editor if they are yours to remove.`);
  }
  notes.push("Left alone on purpose: the 'Resource Node' actor the module made (it is shared), audit-log history lines that do not name a Playtest character, anything you shared into the party's Compendium, and the records of crafted items (api.tags.pruneFrozen() clears orphaned ones when you want).");
  const nothing = !removed.length && !restored.length && !problems.length;
  if (nothing) console.log("PLAYTEST CLEANUP: nothing to remove");
  for (const note of notes) console.log(`PLAYTEST CLEANUP note: ${note}`);
  ui.notifications?.info?.(nothing ? "Playtest CLEANUP: nothing to remove." : `Playtest CLEANUP removed ${removed.length} thing(s) and put ${restored.length} back${problems.length ? `; ${problems.length} problem(s): read the console` : ""}.`);
  return { removed, restored, problems, nothingToRemove: nothing, notes };
})();
```

## Part 4: TEST SHEET

How to use this sheet: do the steps in order, in the window named in each heading ([GM] is you as the Gamemaster, [Player] is Playtest Alice or Playtest Bob in their own browser). Each step says what you should see.

**NEW** marks a path that **no real-Foundry gate has reached yet**. If something looks wrong on a NEW path, that is the most valuable thing you can report: say which step, what you saw, and what you expected.

**What lives where.** Everything SETUP made is kept in the world, except one thing that is in memory only: the recipe **`playtest-blade`** (a weapon recipe with a body slot and two slots that match by tag). The Item editor can keep tags, materials and notes, but it cannot make a recipe, so this one is added to the running module each time. After a **reload of the GM window or a server restart** it is gone (the formula on Alice stays, shown as "its recipe is missing"): press **Playtest SETUP** again and it puts the recipe back and plants nothing else (the console says `already set up`). The Playtest tags, `Playtest Ember` and `Playtest Study Ore` are NOT in memory: the Item editor keeps them in the world.

**Players must NEVER see** a DC, odds, a percentage, a tag, a tag's effects, a cap, or a study's thresholds. They do see "Progress n of m" on a formula project (on purpose) and fees in gold. Each area below says what to look for.

### Sheet 1 [GM]: open downtime and look at the world

**What to do and see:**
- In the GM console (F12) run `await game.modules.get("pathfinder-progress").api.downtime.start({ days: 12 })`.
- In the Scenes tab right-click **Playtest Field** and choose **Activate**, so the Players can see it.
- You should see: the Playtest Field scene with three tokens and four node tokens (the hidden one shows to you with a ghost look), plus a wolf corpse.

```js
await game.modules.get("pathfinder-progress").api.downtime.start({ days: 12 })
```

### Sheet 2 [Player: Alice]: the Hub and a plain craft

**What to do and see:**
- Log in as Playtest Alice. Press the **Downtime** button (in the scene controls, or in the title bar of her character sheet) to open the Hub.
- Open the **Formulae** tab and press **Spider Fang Dagger**.
- Press **Iron** under **Blade** and **Spider Fang** under **Fang**. Look at the **Workshop** section: **Oakhaven Forge**, **Playtest Anvil** and **Playtest Camp Forge** are listed with their fees.
- Press **Queue the craft**.
- As the GM, in the review window ("Pathfinder Progress: Review", it opens by itself when something is queued) press **Resolve** on Alice's craft.
- You should see (Alice): the craft result as a whisper to her, then a crafted Spider Fang Dagger in her bag. Her Compendium **Experiments** now lists what she learned.
- **Player sees:** fees in gold, days, materials used, effect lines only for what she has learned. **Must NOT see:** any DC, chance, odds, tag or cap, in the Hub, in the chat or in a tooltip.

### Sheet 3 [Player: Alice]: a craft with tagged ingredients

**What to do and see:**
- In the Hub open **Playtest Blade**. Under **Body** pick **Iron** (or **Playtest Ember**).
- Pick **Playtest Torch** under **Edge** and **Playtest Rope** under **Charm**. You should see: under **Edge** **Playtest Torch** (her two Torch stacks are one choice, because they share one source) and **Playtest Study Ore** (a material that carries the same tag); under **Charm** **Playtest Rope**. Only her own items that fit are offered, by name.
- Queue the craft. As the GM press **Resolve** (a real roll: if it fails, give her more materials and try again).
- Open the crafted weapon's sheet and set it to **held** (PF2e ignores the effects of a weapon that is not held).
- You should see (Alice): her weapon with its own final numbers (damage dice and any ability) and nothing about tags. A craft takes the **first** copy that shares a source: Playtest Torch Stack goes before Playtest Torch Single (the player cannot choose).
- **Player sees:** the crafted item's final numbers. **Must NOT see:** which tags her ingredients carry, the tags' effects, or the caps that limited them.
- **NEW, no hand-test (untitled abilities):** an ability with no title. Every definition path refuses an empty title ("must be a non-empty string": the editor, a tag's effect blocks and a raw material all do), so the `(untitled #n)` merge in `scripts/tags/stack.js` is a guard that no data in this seed can reach.
- **NEW, no hand-test (the tier-1 fallback):** a crafted item with no tier of its own, no power role and no ingredient with a tier gets tier 1 (and the GM log says so). Every ingredient this seed can make has a tier, so the case cannot be built by hand.

### Sheet 4 [Player: Alice]: gather, search, clear

**What to do and see:**
- Log in as Alice. In her console (F12) run the first block below: it queues a gather from **Playtest Herb Patch**.
- As the GM press **Resolve** in the review window.
- In Alice's console run the second block: a search of the area.
- As the GM, in the console, run the third block: **Clear map**.
- You should see (Alice): materials in her bag after the gather, and a search message that says only "You search the area." plus anything spotted (the **Playtest Hidden Herb** if she finds it). It is the same words whether she found it or not.
- You should see (GM): after Clear map the placed nodes are gone, **Playtest Wolf Corpse** (a hand-made corpse node) is still there.
- **Player sees:** what she gathered and what she spotted. **Must NOT see:** a charge count, a node DC, how many hidden nodes remain.

```js
const api = game.modules.get("pathfinder-progress").api, scene = game.scenes.getName("Playtest Field"), node = scene.tokens.find(t => t.name === "Playtest Herb Patch");
await api.queue.submit(game.user.character, "gather", { sceneId: scene.id, tokenId: node.id, skill: "survival" });
```

```js
await game.modules.get("pathfinder-progress").api.searchArea(game.user.character)
```

```js
await game.modules.get("pathfinder-progress").api.clearMap(game.scenes.getName("Playtest Field"))
```

- Then do the same gather on **Playtest Wolf Corpse** (change the name in the first block; a herb patch lets you choose the skill, and the sheet uses survival): the hand-made corpse node's one guaranteed rung is a Spider Fang.

### Sheet 5 [Player: Alice]: research, a study and a lead

**What to do and see:**
- In the Hub open the **Research** tab. Under **Leads you could follow** you should see **Playtest Study Ore** (an item she carries) and a lead for **Longsword**.
- Press **Start researching** on Playtest Study Ore, choose a skill, press the plus beside the days until it says 2, and press **Queue 2 checks**.
- As the GM press **Resolve**. Repeat until the study reaches its first milestone (3 steps).
- You should see (Alice): the study shown as a plain stage only ("Just started", "Getting somewhere", "Nearly there"), never a number. At the milestone her **Compendium** entry for Playtest Study Ore gains, under **What you know**, "Playtest Edge: a theme of things with a bite." and "It works with frightened."
- [Player: Bob] In the Hub **Research** tab you should see the **Longsword** formula project as "Progress 0 of N" (a formula project shows its progress on purpose).
- **Player sees:** stage words for a study, "Progress n of m" for a formula project. **Must NOT see:** a study's steps or thresholds, a DC, odds or a pace.

### Sheet 6 [Player: Alice]: share a Compendium entry

**What to do and see:**
- In the Hub open the **Compendium** tab, pick **Materials**, and press **Iron**.
- You should see: "Only you" and a **Share with the party** button. Press it.
- As the GM press **Resolve** on the share in the review window.
- You should see (Bob, in his own Hub): **Iron** in his Compendium, marked as shared.
- **Player sees:** the facts the character experienced and nothing locked (no placeholders). **Must NOT see:** a DC, a rung's difficulty, a tag, or what he has not discovered.

### Sheet 7 [GM]: the Item editor and the Item tags window

**What to do and see:**
- Open the world item **Playtest Ember** (Items tab) and press the **Item editor** button in its title bar (or the scene-controls button).
- Change the **Description**, then, without pressing Save, click another item in the list.
- You should see: a question "**Discard your unsaved changes?**" with **No** selected. Press **No**, and your text is still there. **NEW** (no real-Foundry gate has run this prompt).
- Press **Save**, then pick another item: no question this time.
- Open the world item **Playtest Torch Sample** and press the **Item tags** button in its title bar.
- You should see: the window shows the tag **Playtest Edge** (it shares its source with the tagged Torch) and the tier.
- **Players never see** the ledger, tags, tiers or caps: ask Alice to open the Hub and look; it shows only her own items that fit a slot, by name.

### Sheet 8 [GM and Player: Alice]: workshops (NEW ground)

**What to do and see:**
- **NEW: giving a workshop.** SETUP already ran `api.giveStation(alice, ...)`. In the GM console run the first block below. You should see: `playtest-anvil:owned`, `party-playtest-camp:party` and `oakhaven-forge:public` among Alice's stations.
- **NEW: an owned workshop's upgrade.** In **Alice's** console run the second block (the Hub has no workshop screen yet). It takes 2 iron and starts a research project for the upgrade.
- Finish it one of two ways. **By hand:** in the Hub **Research** tab Alice queues checks on the upgrade project and you press **Resolve** until it is done. **Quick:** as the GM run the third block, which does all the checks at once with a forced critical success (what gate 14 does).
- You should see: the first block's list, run again, shows `playtest-anvil` with `craftDays: 1`, and a craft there takes one day fewer (never fewer than one).
- **NEW: transfer, then remove.** In the GM console run the fourth block. You should see: the anvil moves to Bob (Alice no longer lists it), then is removed (Bob no longer lists it).
- **NEW: the Hub fee error.** See the next step.
- **Player sees:** workshops in reach and their fees. **Must NOT see:** another character's private workshop (an owned one only if she is on its access list).

```js
const api = game.modules.get("pathfinder-progress").api; api.stationsFor(game.actors.getName("Playtest Alice")).map(s => `${s.id}:${s.source}:${JSON.stringify(s.upgrades)}`)
```

```js
await game.modules.get("pathfinder-progress").api.workshop.startUpgrade(game.user.character, { stationId: "playtest-anvil", kind: "craftDays", materials: { iron: 2 } })
```

```js
await game.modules.get("pathfinder-progress").api.research({ actor: game.actors.getName("Playtest Alice"), project: "upgrade-playtest-anvil-craftDays-1", days: 10, skill: "crafting", degree: "criticalSuccess", chat: false })
```

```js
const api = game.modules.get("pathfinder-progress").api; await api.transferStation("playtest-anvil", game.actors.getName("Playtest Bob")); await api.removeStation(game.actors.getName("Playtest Bob"), "playtest-anvil")
```

### Sheet 9 [Player: Alice]: the Hub fee error (NEW, guessed, untried)

**What to do and see:**
- There is no setting and no data that can give a workshop a tier with no fee (a station's tier must be 1 to 5 and every tier has a fee), so this needs the console on the **Player's own browser**.
- In Alice's console run the block below. It takes tier 2's fee away on that browser only.
- Close and reopen the Hub, open **Spider Fang Dagger**, and look at the **Workshop** section.
- You should see: **Oakhaven Forge** is NOT offered; under the Workshop heading a line "Oakhaven Forge: its fee could not be worked out, so it cannot be used right now. Ask the GM."; it never says "No fee". With the other workshops unusable too the Queue button's reason says a workshop has no fee set.
- **Undo it:** reload Alice's browser page (F5). The change lives only in that page.
- This route is **guessed, untried**: it assumes the module's config file is served at `/modules/pathfinder-progress/scripts/config.js` (if your Foundry address has a prefix, put it in front) and that the Hub on that page reads the same copy.

```js
const { STATIONS } = await import("/modules/pathfinder-progress/scripts/config.js"); delete STATIONS.feeByTier[2]; STATIONS.feeByTier
```

### Sheet 10 [GM]: the commission engine (NEW, GM API only)

**What to do and see:**
- The commission engine has no screen yet: it is the GM's console. Run the first block. It issues a job from **Playtest Patron** (a GM-only NPC that holds the materials and the gold) to Alice.
- Run the second block: it takes the job for Alice and crafts it with a forced success.
- You should see: the first block makes a commission (status "requested"), the second accepts it and crafts it at Oakhaven Forge (a station has to be named, because several are usable). The patron's spider fang and one of its two iron are used up, the commission says "delivered", and **Playtest Patron** (not Alice) holds the new Spider Fang Dagger.
- **Player sees:** her own commissions. **Must NOT see:** a DC or the roll.

```js
const api = game.modules.get("pathfinder-progress").api; const job = await api.commissions.issue({ patron: game.actors.getName("Playtest Patron"), crafter: game.actors.getName("Playtest Alice"), recipe: "dagger-spider-fang", selection: { blade: "iron", fang: "spider-fang" }, payout: 5 }); job.commission.id
```

```js
const api = game.modules.get("pathfinder-progress").api, job = api.commissions.list()[0]; await api.commissions.accept(job.id); await api.commissions.craft(job.id, { degree: "success", station: "oakhaven-forge" })
```

### Sheet 11 [GM]: what you cannot test by hand

**What to do and see:**
- **The damaged `stations` flag skip is not hand-testable.** It only matters when one character's `stations` flag is not a list, and no screen can damage a flag. It is fake-tested only.
- **The damaged-store and `__proto__` cases** are left out of this seed on purpose (fake-tested only).
- You should see: nothing to do here.

### Sheet 12 [GM]: CLEANUP

**What to do and see:**
- Press the **Playtest CLEANUP** macro and read the Console tab.
- You should see: one `PLAYTEST CLEANUP removed:` line per thing (the scene, the four characters, the world items, the party workshop, the tag entries, the editor records with the tags last, the in-memory recipe), `put back:` lines for the party location and the users' characters, and notes about what it leaves alone.
- Press it again. You should see: `PLAYTEST CLEANUP: nothing to remove`.
- Things CLEANUP leaves on purpose: the shared "Resource Node" actor the module made, audit-log history lines that do not name a Playtest character, anything you shared into the party's Compendium, and the records of crafted items (`api.tags.pruneFrozen()` clears orphaned ones when you want).
