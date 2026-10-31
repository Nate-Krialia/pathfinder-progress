# 16 Stage 10d gate (real Foundry): hidden difficulty everywhere, and the Experiments knowledge system (v0.17.0)

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]** and has ONE code block. Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS` (or say how many failed): paste back anything that is not `ALL PASS`.

`tests/gate16.test.js` runs every block below, in order, against the real `main.js` in a fake Foundry where the Player and the GM each have their OWN `api.definitions`, and the Player gets only what the GM sends over the socket. What it cannot show is what only a real Foundry shows: the PF2e roll in a real research resolve, the real chat log a player can read, the real hooks, and the timing of the refresh.

**What the gate shows** (the decisions in `docs/11b-hub-addendum.md`):
- **Hidden difficulty.** `queue.list` gives a Player a plain explore row (skill and days) and a research row without its DC, while the GM's row for the SAME item still has the DC and the odds. A project the Player is handed over the socket has no DC. `projectInfo` gives a Player no DC, chances or expected days. The chat a Player can read after a research resolve has no DC and no total. The Player's recipe and material copies carry no craft level, loss chances, effects or outputs.
- **Experiments.** A preview with a material the character has not experienced shows the slot VALID and its effect `unknown`, with the fee, days and materials used. A FAILED craft teaches nothing (a forced degree on the GM side); a successful one makes the effect known with no reload, per material per slot (not per combination). Finishing research reveals the baseline. Sharing an experiment works, and the party sees it.

**Safety.** Everything uses throwaway things named "Gate ...": the characters **Gate Smith** and **Gate Friend** (both owned by the user "Test", so both are party characters), the scene **Gate Forge**, and in-memory fake definitions (`g4-town`, `g4-ore`, `g4-steel`, `g4-ember`, `g4-star`, `g4-bench`, `g4-bush`, `g4-field`, `g4-blade`, `g4-axe`); they exist only until you reload the GM window, and SETUP registers them again and publishes them to the Player. No real campaign recipe is used. SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, a "Gate ..." actor or scene exists that it did not make, or an earlier run left something behind. CLEANUP always works, is safe to run twice, and also removes the shared Compendium entries the gate wrote.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.17.0**; if it is not, stop (the release may still be building). Because this release changes nothing in the manifest, a reload is enough.

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.17.0"]` in the GM window and `["Test", false, "0.17.0"]` in the Player window.

## Step 2 [GM]: SETUP

Safe to run again at any time: after a reload of the GM window the fake definitions and the `globalThis.__g4` helper are gone, and running SETUP again re-registers the definitions, publishes them to the players and REBUILDS the helper.

```js
// [GM] SETUP: fake definitions (memory only), Gate Smith (holds g4-blade) + Gate Friend, Gate Forge tagged g4-field, the party at Gate Smithy Town, 12 days of downtime. Run it again after a reload to rebuild the helper.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway4") === true;
  const [smithOld, friendOld, sceneOld] = [game.actors.getName("Gate Smith"), game.actors.getName("Gate Friend"), game.scenes.getName("Gate Forge")];
  if (![smithOld, friendOld, sceneOld].every(mine)) throw new Error('"Gate Smith", "Gate Friend" or "Gate Forge" already exists and was not made by this check; rename or delete it first');

  // The fake definitions go into the GM's loaded registry (memory only). Safe to repeat.
  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const output = { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger };
  const common = { kind: "recipe", category: "weapon", output, craftLevel: 2, stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } };
  const defs = [
    ["town", { kind: "town", id: "g4-town", name: "Gate Smithy Town" }],
    ["material", { kind: "material", id: "g4-ore", name: "Gate Ore", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g4-steel", name: "Gate Steel", tier: 2, effects: { basePower: "T2", bonusDamage: { dice: "1d4", type: "fire" } } }],
    ["material", { kind: "material", id: "g4-ember", name: "Gate Ember", tier: 2, effects: { bonusDamage: { dice: "1d6", type: "fire" } } }],
    ["material", { kind: "material", id: "g4-star", name: "Gate Star", tier: 3, effects: { basePower: "T3", bonusDamage: { dice: "1d8", type: "spirit" } } }],
    ["station", { kind: "station", id: "g4-bench", name: "Gate Bench", category: "smithing", tier: 1, town: "g4-town" }],
    ["nodeType", { kind: "nodeType", id: "g4-bush", name: "Gate Bush", skills: ["survival"], charges: 3, ladders: { 1: [{ materialId: "g4-ore", dcOffset: 0, quantity: "1d4", guaranteed: true }] } }],
    ["region", { kind: "region", id: "g4-field", name: "Gate Field", sceneTag: "g4-field", skillWhitelist: ["survival", "nature"], explorationDC: 20, daysRequired: 2, danger: "moderate", spawnTable: [{ nodeType: "g4-bush", tier: 1, weight: 1 }] }],
    ["recipe", { ...common, id: "g4-blade", name: "Gate Blade", slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "edge", drives: "bonusDamage", tierFloor: 2, qty: 1 }] }],
    ["recipe", { ...common, id: "g4-axe", name: "Gate Axe", slots: [{ name: "head", drives: "basePower", tierFloor: 1, qty: 1 }] }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  // The helper the later [GM] steps use. Built here for a first run AND for a rerun after a reload.
  const sum = (a, id) => a.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + i.system.quantity, 0);
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids,
      smith: () => game.actors.get(ids.smith), friend: () => game.actors.get(ids.friend), scene: () => game.scenes.get(ids.scene),
      book: actor => actor.getFlag(M, "compendium") ?? {},
      exp: (actor, recipe = "g4-blade") => (actor.getFlag(M, "compendium") ?? {}).experiments?.[recipe],
      have: (actor, id) => sum(actor, id),
      shared: () => game.settings.get(M, "sharedCompendium") ?? {},
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g4 = g;
    return g;
  };

  if (smithOld || friendOld || sceneOld) {
    if (!(smithOld && friendOld && sceneOld)) throw new Error("part of the gate is missing (a character or the scene was deleted): run CLEANUP (the last step), then SETUP again");
    build({ smith: smithOld.id, friend: friendOld.id, scene: sceneOld.id });
    return { already: "set up", rebuilt: "the definitions and globalThis.__g4", published: await api.publishDefinitions() };
  }

  // Refuse to run against real data, or on top of an earlier run's leftovers.
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const shared = game.settings.get(M, "sharedCompendium") ?? {};
  if (Object.keys(shared.experiments ?? {}).some(k => k.startsWith("g4-")) || Object.keys(shared.materials ?? {}).some(k => k.startsWith("g4-"))) throw new Error("an earlier run left shared Compendium entries: run CLEANUP (the last step) first");
  const published = await api.publishDefinitions();

  const flags = { [M]: { gateThrowaway4: true } };
  const owned = { default: 0, [test.id]: 3 };
  const smith = await Actor.create({ name: "Gate Smith", type: "character", ownership: owned, flags });
  const friend = await Actor.create({ name: "Gate Friend", type: "character", ownership: owned, flags });
  const scene = await Scene.create({ name: "Gate Forge", width: 1400, height: 1000, grid: { size: 100 }, padding: 0, ownership: { default: 2 }, flags });
  let x = 100;
  for (const actor of [smith, friend]) { const td = await actor.getTokenDocument({ x: (x += 100), y: 100 }); await scene.createEmbeddedDocuments("Token", [td.toObject()]); }
  await api.tagScene(scene, "g4-field");
  await api.placeAnchors(4, { scene });

  await api.giveMaterial(smith, "g4-ore", 6);
  await api.giveMaterial(smith, "g4-steel", 4);
  await api.giveMaterial(smith, "g4-ember", 3);
  await api.giveMaterial(smith, "g4-star", 4);
  await api.adapter.addCopper(smith, 10000);
  await api.adapter.addCopper(friend, 1000);
  await api.grantFormula(smith, "g4-blade");                // owning a formula reveals its baseline
  await scene.setFlag(M, "gateOriginalLocation", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g4-town");
  await test.setFlag(M, "gateOriginalCharacter", test.character?.id ?? "none");
  await test.update({ character: smith.id });
  await api.downtime.start({ days: 12, actorIds: [smith.id, friend.id] });

  const ids = { smith: smith.id, friend: friend.id, scene: scene.id };
  build(ids);
  await scene.setFlag(M, "gateIds4", ids);
  return { smith: smith.name, friend: friend.name, scene: scene.name, published, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object naming Gate Smith, Gate Friend and Gate Forge, `testUsersCharacter: "Gate Smith"` and a `published` revision. On a rerun it says `already: "set up"`.

## Step 3 [Player]: the Player helper (and the first load)

Open **Gate Smith**'s sheet in this window. Run:

```js
// [Player] helper for the next steps (lost on reload; just run it again). It asks the GM for the definitions your characters need.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const smith = game.actors.getName("Gate Smith"), friend = game.actors.getName("Gate Friend");
  if (game.user.isGM || !smith?.isOwner || !friend?.isOwner) throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  const loaded = await api.definitions.refresh();
  const rows = [];
  const BAD = /\bDC\b|\bodds\b|\d\s?%|\bchances?\b|\bdifficult|\bexpected\b|\bexpect ~|\bpercent\b/i;
  const HIDDEN = ["dc", "chances", "chance", "odds", "expectedProgressPerDay", "expectedDaysToFinish", "slotLossChance", "materialLossChance", "lossChance", "craftLevel", "explorationDC", "perceptionDC", "encounterChance"];
  // Everything wrong in a value: a hidden field at any depth, or difficulty wording (an item's own learned rules text, under "effects", is exempt).
  const findings = (value, path = "$") => {
    if (typeof value === "string") return BAD.test(value) ? [`${path}: ${value}`] : [];
    if (Array.isArray(value)) return value.flatMap((v, i) => findings(v, `${path}[${i}]`));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [...(HIDDEN.includes(k) ? [`${path}.${k}`] : []), ...(k === "effects" ? [] : findings(v, `${path}.${k}`))]);
    return [];
  };
  const p = {
    M, api, smith, friend, findings,
    preview: (actor, selection) => api.previewCraft(actor, "g4-blade", selection, "g4-bench"),
    row: id => api.queue.list().find(r => r.action.id === id),
    check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
    done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; },
    refused: async fn => { try { await fn(); return null; } catch (error) { return error.message; } },
    until: async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
    keep: {}
  };
  globalThis.__p4 = p;
  return { loaded: loaded.changed, status: api.definitionsStatus().status };
})();
```

Expected: `loaded: true`, `status: "ready"`. From here on this window keeps its definitions up to date by itself; if a later step says something is "still loading", wait a second and run it again.

## Step 4 [Player]: an explore row has no DC and no odds

```js
// [Player] queue an expedition into Gate Field and read the row the way the Hub will: plain.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const action = await p.api.queue.submit(p.smith, "explore", { region: "g4-field", skill: "survival" }, 2);
  p.keep.explore = action.id;
  const row = p.row(action.id);
  p.check("the row reads Explore: Gate Field", row?.label === "Explore: Gate Field", row?.label);
  p.check("the row says only the skill and the days", row?.detail === "survival; 2 day(s)", row?.detail);
  p.check("no DC, no odds, no percentage, no hidden field anywhere in the row or the action", p.findings({ row, action }).length === 0, JSON.stringify(p.findings({ row, action })));
  p.check("the Player's copy of the region has no DC and no spawn table", !("explorationDC" in p.api.definitions.region.get("g4-field")) && !("spawnTable" in p.api.definitions.region.get("g4-field")));
  return p.done();
})();
```

## Step 5 [GM]: the GM's row for the SAME item still has everything

```js
// [GM] the same expedition: the DC and the odds are on the GM's row. Then give Gate Smith a research project to look at.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "explore");
  const row = g.api.queue.list().find(r => r.action.id === action?.id);
  g.check("an explore item is queued", Boolean(action));
  g.check("the GM's row has the DC and the odds", /survival \+\d+ vs DC 20: crit \d+% \/ success \d+% \/ fail \d+% \/ crit-fail \d+%, expect ~\d+\.\d nodes/.test(row?.detail ?? ""), row?.detail);
  await g.api.queue.reject(smith, action.id, { chat: false });
  g.check("the expedition was returned (nothing is left queued)", !smith.getFlag(g.M, "pendingActions")?.length);
  const project = await g.api.startProject({ actor: smith, recipe: "g4-axe" });
  g.check("a research project for the Gate Axe exists, with its DC stored on the actor", project.dc > 0, project.dc);
  return g.done();
})();
```

## Step 6 [Player]: a research row and projectInfo have no DC; a project over the socket has none

```js
// [Player] queue one day of research; read the row, projectInfo, and the project a relayed upgrade start hands you.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const action = await p.api.queue.submit(p.smith, "research", { projectId: "unlock-g4-axe", skill: "crafting" }, 1);
  p.keep.research = action.id;
  const row = p.row(action.id);
  p.check("the research row shows the skill and the progress, not the DC", /^crafting, progress 0\/\d+$/.test(row?.detail ?? ""), row?.detail);
  const info = p.api.projectInfo(p.smith, "unlock-g4-axe");
  p.check("projectInfo gives no DC, chances or expected days", p.findings(info).length === 0, JSON.stringify(p.findings(info)));
  p.check("it gives only your own modifier per skill, and the progress", info.perSkill.every(s => Object.keys(s).sort().join() === "modifier,skill") && info.project.progress === 0 && info.project.threshold > 0, JSON.stringify(info.perSkill));
  const upgrade = await p.api.workshop.startUpgrade(p.smith, { stationId: "g4-bench", kind: "hearth", materials: { "g4-ore": 2 } });
  p.check("the project the GM hands you has no DC", p.findings(upgrade).length === 0 && !("dc" in upgrade) && upgrade.threshold > 0, JSON.stringify(p.findings(upgrade)));
  const back = await p.api.workshop.putAside(p.smith, upgrade.id);
  p.check("and putting it aside returns the 2 Gate Ore", JSON.stringify(back) === JSON.stringify({ returned: [{ materialId: "g4-ore", units: 2 }] }), JSON.stringify(back));
  p.check("the audit ledger is GM-only", /GM only/.test(await p.refused(() => p.api.audit.scan()) ?? ""));
  return p.done();
})();
```

## Step 7 [GM]: resolve the research (a real roll) with chat on

```js
// [GM] resolve the queued research day. PF2e rolls it on this client; the player is told the degree only.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "research");
  g.check("a research item is queued", Boolean(action));
  const out = await g.api.queue.resolve(smith, action.id, { chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  const gmLog = g.api.gm.log({ kind: "research" });
  g.check("the GM log has the total and the DC (no chat message does: Stage 11a)", gmLog.length >= 1 && /vs DC/.test(gmLog[0].text), JSON.stringify(gmLog[0]?.text));
  return g.done();
})();
```

## Step 8 [Player]: the chat you can read has no DC

```js
// [Player] every message this window can see about the research: degree words and progress, no DC, no total.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const mine = game.messages.contents.filter(m => m.visible && /researches/.test(m.content ?? ""));
  p.check("you were told about the research", mine.length >= 1, mine.length);
  p.check("it was a whisper, not a public message", mine.every(m => (m.whisper ?? []).length > 0), JSON.stringify(mine.map(m => m.whisper)));
  p.check("it has the degree words and the progress", mine.some(m => /Day 1: (Critical )?(Success|Failure)/.test(m.content) && /Progress: \d+\/\d+|has learned/.test(m.content)));
  p.check("it has no DC, no roll total, no percentage", mine.every(m => !/\bDC\b|vs |\d+%/.test(m.content)), mine.map(m => m.content).join(" | "));
  // Foundry hands EVERY message to EVERY client, a whisper included (it is only hidden from the chat log). So look at all of them.
  const all = game.messages.contents;
  const leaks = all.filter(m => /vs DC|\bDC\b|GM only|natural \d|d100|d20=|Perception total/.test(m.content ?? ""));
  p.check("no message at all, visible or not, carries a DC or a roll total", leaks.length === 0, leaks.map(m => m.content).join(" | "));
  p.check("and none of the GM-only whispers exists", all.filter(m => /GM only/.test(m.content ?? "")).length === 0);
  return p.done();
})();
```

## Step 9 [Player]: a preview with materials you have not experienced

```js
// [Player] Gate Steel and Gate Star are in your bag but you have never crafted with them: the slots are valid, the effects are "unknown".
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const result = p.preview(p.smith, { body: "g4-steel", edge: "g4-star" });
  p.check("the selection is valid", result.ok === true, JSON.stringify(result.errors));
  const plan = result.plan;
  p.check("the mechanical facts are all there: the fee, the days, the station, the materials", plan.fee === 1 && plan.days === 2 && plan.station.name === "Gate Bench" && plan.uses.length === 2, JSON.stringify([plan.fee, plan.days, plan.station?.name]));
  p.check("both slots are valid with their tier and units", plan.slots.every(s => s.materialName && s.tier >= 2 && s.units === 1), JSON.stringify(plan.slots.map(s => [s.slot, s.materialName, s.tier])));
  p.check("neither effect is known: the clear field, never a placeholder", plan.slots.every(s => JSON.stringify(s.effect) === '{"known":false}') && !/\?\?\?/.test(JSON.stringify(result)), JSON.stringify(plan.slots.map(s => s.effect)));
  p.check("the result is unknown, and nothing about the item or its name is carried", JSON.stringify(plan.result) === '{"known":false}' && !/outputUuid|resultName|description|baseTier"/.test(JSON.stringify(result)));
  p.check("no hidden field or difficulty wording anywhere in the preview", p.findings(result).length === 0, JSON.stringify(p.findings(result)));
  const cheap = p.preview(p.smith, { body: "g4-ore", edge: "g4-ember" }).plan;
  p.check("the baseline (the cheapest valid materials) IS known from the start", cheap.slots.every(s => s.effect.known && s.effect.via === "baseline") && cheap.result.known && cheap.result.baseTier === 1, JSON.stringify(cheap.slots.map(s => s.effect.via)));
  const recipe = p.api.definitions.recipe.get("g4-blade");
  p.check("the Player's copy of the recipe has only what the Hub lists need", Object.keys(recipe).sort().join() === "category,days,id,kind,name,skillWhitelist,slots,stationCategory,stationTierMin", Object.keys(recipe).sort().join());
  p.check("and the Player's copy of a material has no effects", !["effects", "classEffects", "research", "lossChance"].some(k => k in p.api.definitions.material.get("g4-steel")), Object.keys(p.api.definitions.material.get("g4-steel")).join());
  return p.done();
})();
```

## Step 10 [Player]: queue a craft with the unexperienced materials

```js
// [Player] queue the Gate Blade with Gate Steel and Gate Star.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const action = await p.api.queue.submit(p.smith, "craft", { recipe: "g4-blade", selection: { body: "g4-steel", edge: "g4-star" }, stationId: "g4-bench" });
  p.keep.craft1 = action.id;
  p.check("queued: 2 days and its escrow are taken", action.type === "craft" && action.daysReserved === 2 && action.params.escrow.feeCopper === 100, JSON.stringify([action.daysReserved, action.params.escrow.feeCopper]));
  return p.done();
})();
```

## Step 11 [GM]: the craft FAILS (a forced degree): nothing is taught

```js
// [GM] resolve it as a failure. The roll decides whether you get it; the materials decide what you get: a failure teaches nothing.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const before = JSON.stringify(g.exp(smith));
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "craft");
  const out = await g.api.queue.resolve(smith, action.id, { degree: "failure", chat: false });
  g.check("it resolved as a failure", out.status === "resolved" && /not made \(failure\)/.test(out.message), out.message);
  g.check("no item was made", !smith.items.some(i => !i.getFlag(g.M, "material") && /Dagger/.test(i.name)));
  g.check("the Compendium learned NOTHING (the experiments are exactly as before)", JSON.stringify(g.exp(smith)) === before);
  g.check("no (slot, material) fact for steel or star was recorded", !g.exp(smith).slots?.body?.["g4-steel"] && !g.exp(smith).slots?.edge?.["g4-star"]);
  return g.done();
})();
```

## Step 12 [Player]: still unknown; craft it again

```js
// [Player] the same preview: still unknown. Queue the same craft once more.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const plan = p.preview(p.smith, { body: "g4-steel", edge: "g4-star" }).plan;
  p.check("after a failure the effects are still unknown", plan.slots.every(s => !s.effect.known) && !plan.result.known, JSON.stringify(plan.slots.map(s => s.effect)));
  const action = await p.api.queue.submit(p.smith, "craft", { recipe: "g4-blade", selection: { body: "g4-steel", edge: "g4-star" }, stationId: "g4-bench" });
  p.check("queued again", action.type === "craft");
  return p.done();
})();
```

## Step 13 [GM]: the craft SUCCEEDS

```js
// [GM] resolve it as a success.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "craft");
  const out = await g.api.queue.resolve(smith, action.id, { degree: "success", chat: false });
  g.check("it resolved as a success", out.status === "resolved" && /made \(success\)/.test(out.message), out.message);
  // Stage 11c: a successful craft teaches how the material behaves in the recipe's ITEM CLASS (a weapon), not just this recipe.
  const classFacts = () => g.smith().getFlag(g.M, "compendium")?.classes?.weapon ?? {};
  const entry = await g.until(() => classFacts()["g4-steel"]);
  g.check("the Compendium learned Gate Steel for weapons", Boolean(entry) && entry.effects.basePower === "T2", JSON.stringify(entry?.effects));
  g.check("and Gate Star's bonus damage", classFacts()["g4-star"]?.effects?.bonusDamage?.dice === "1d8");
  g.check("exactly those two materials and nothing else", Object.keys(classFacts()).sort().join() === "g4-star,g4-steel");
  return g.done();
})();
```

## Step 14 [Player]: the effects are known now, with no reload

```js
// [Player] same window, no reload, no refresh call: the preview knows what it learned, per material and slot, not per combination.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const now = p.preview(p.smith, { body: "g4-steel", edge: "g4-star" }).plan;
  p.check("both effects are known, learned by crafting", now.slots.every(s => s.effect.known && s.effect.via === "class"), JSON.stringify(now.slots.map(s => s.effect.via)));
  p.check("the result tier is known: T2 (the steel in the body slot)", JSON.stringify(now.result) === '{"known":true,"baseTier":2}', JSON.stringify(now.result));
  const mixed = p.preview(p.smith, { body: "g4-steel", edge: "g4-ember" }).plan;
  p.check("steel in the body is known whatever sits in the edge (per material, not per combination)", mixed.slots[0].effect.known && mixed.slots[0].effect.via === "class", JSON.stringify(mixed.slots.map(s => s.effect.via)));
  p.check("the ember in the edge is known because it is the baseline material", mixed.slots[1].effect.known && mixed.slots[1].effect.via === "baseline");
  const other = p.preview(p.smith, { body: "g4-ore", edge: "g4-steel" }).plan;
  p.check("steel in the EDGE slot is still unknown (it was learned in the body slot)", !other.slots[1].effect.known, JSON.stringify(other.slots[1].effect));
  p.check("the API says the same", p.api.compendium.knownEffect(p.smith, "g4-blade", "body", "g4-steel").known === true && p.api.compendium.knownEffect(p.smith, "g4-blade", "edge", "g4-steel").known === false);
  return p.done();
})();
```

## Step 15 [Player]: your Compendium

```js
// [Player] the experiments section: the baseline (materials named only if you have met them) and what you learned. No placeholders.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const view = p.api.compendium.view(p.smith);
  const blade = view.entries.experiments.find(e => e.recipeId === "g4-blade");
  p.check("there is a Gate Blade entry, yours", blade?.name === "Gate Blade" && blade.source === "own", JSON.stringify(blade?.source));
  p.check("the baseline is there, with the tier each slot needs", blade?.baseline?.baseTier === 1 && blade.baseline.slots.map(s => s.needs).join() === "tier 1 or higher,tier 2 or higher", JSON.stringify(blade?.baseline?.slots?.map(s => s.needs)));
  p.check("the baseline names the materials you have met (you hold both)", blade?.baseline?.slots?.map(s => s.material).join() === "Gate Ore,Gate Ember", JSON.stringify(blade?.baseline?.slots?.map(s => s.material)));
  p.check("it lists exactly what you learned", blade?.known?.map(k => `${k.slot}:${k.material}`).sort().join() === "body:Gate Steel,edge:Gate Star", JSON.stringify(blade?.known?.map(k => `${k.slot}:${k.material}`)));
  p.check("no placeholders, no difficulty wording", !/\?\?\?|locked|unknown/i.test(JSON.stringify(view.entries.experiments)) && p.findings(view).length === 0, JSON.stringify(p.findings(view)));
  return p.done();
})();
```

## Step 16 [Player]: share what you learned

```js
// [Player] sharing an experiment is a queue item: no days, no downtime. It shares the recipe's facts as they are now.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const free = () => p.smith.getFlag(p.M, "downtimeDays") ?? 0;
  const before = free();
  const action = await p.api.queue.submit(p.smith, "share", { kind: "experiment", key: "g4-blade" });
  p.check("it costs no days", action.type === "share" && action.daysReserved === 0 && free() === before, JSON.stringify([action.daysReserved, before, free()]));
  const row = p.row(action.id);
  p.check("the row reads Share: Gate Blade (experiment) and says what it holds", row?.label === "Share: Gate Blade (experiment)" && /^2 material effect\(s\) learned, baseline known; no days, no downtime needed/.test(row?.detail ?? ""), JSON.stringify([row?.label, row?.detail]));
  const again = await p.refused(() => p.api.queue.submit(p.smith, "share", { kind: "experiment", key: "g4-blade" }));
  p.check("asking twice is refused plainly", again === "Gate Blade is already waiting for the GM to approve sharing it.", again);
  return p.done();
})();
```

## Step 17 [GM]: approve the share; give Gate Friend the formula

```js
// [GM] approve it (Resolve all handles shares), then give Gate Friend the Gate Blade formula so the party can use the shared facts.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith(), friend = g.friend();
  g.check("nothing is shared while it waits", !g.shared().experiments?.["g4-blade"]);
  const action = smith.getFlag(g.M, "pendingActions").find(a => a.type === "share");
  const out = await g.api.queue.resolve(smith, action.id, { chat: false });
  g.check("it resolved", out.status === "resolved" && /approved: Gate Blade \(experiment\) is now shared with the party/.test(out.message), out.message);
  g.check("the party's book holds the two learned facts (for the weapon class)", Object.keys(g.shared().classes?.weapon ?? {}).sort().join() === "g4-star,g4-steel");
  g.check("and it can be queued only while it has something new to share", g.api.queue.list().filter(r => r.action.type === "share").length === 0);
  await g.api.grantFormula(friend, "g4-blade");
  await g.api.giveMaterial(friend, "g4-steel", 1);
  await g.api.giveMaterial(friend, "g4-star", 1);
  g.check("Gate Friend now holds the formula (its baseline was revealed too)", Boolean(g.exp(friend)?.baseline));
  return g.done();
})();
```

## Step 18 [Player]: the party sees the shared facts

```js
// [Player] Gate Friend never crafted with the steel or the star, but the party's book knows them: read-only, merged with what Friend knows.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  await p.until(() => p.api.definitions.material.has("g4-star") && p.api.definitions.recipe.has("g4-blade"));
  const plan = p.preview(p.friend, { body: "g4-steel", edge: "g4-star" }).plan;
  p.check("Gate Friend's preview knows both effects, from the party", plan.slots.every(s => s.effect.known && s.effect.via === "shared"), JSON.stringify(plan.slots.map(s => s.effect.via)));
  const mine = p.api.compendium.view(p.friend).entries.experiments.find(e => e.recipeId === "g4-blade");
  p.check("Friend's entry is both: their own baseline and the party's facts", mine?.source === "both" && mine.known.every(k => k.source === "shared") && mine.known.length === 2, JSON.stringify([mine?.source, mine?.known?.map(k => k.source)]));
  const again = await p.refused(() => p.api.queue.submit(p.smith, "share", { kind: "experiment", key: "g4-blade" }));
  p.check("sharing what is already shared is refused", again === "Everything Gate Smith knows about Gate Blade is already shared with the party.", again);
  return p.done();
})();
```

## Step 19 [GM]: finish research on the Gate Axe: the baseline is revealed

```js
// [GM] Gate Friend researches the Gate Axe to the end (forced critical successes). The baseline appears; no material is handed over.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const friend = g.friend();
  await g.api.startProject({ actor: friend, recipe: "g4-axe" });
  g.check("before: no experiments entry for the axe", !g.exp(friend, "g4-axe"));
  await g.api.grantDays(friend, 20);
  const out = await g.api.research({ actor: friend, project: "unlock-g4-axe", days: 20, skill: "crafting", degree: "criticalSuccess", chat: false });
  g.check("the research finished", out.completed === true);
  const entry = await g.until(() => g.exp(friend, "g4-axe"));
  g.check("the baseline was revealed on finishing", Boolean(entry?.baseline) && entry.baseline.baseTier === 1 && entry.baseline.slots.map(s => s.slot).join() === "head", JSON.stringify(entry?.baseline));
  g.check("it is the cheapest valid material (Gate Ore, tier 1), and no fact was learned", entry.baseline.slots[0].materialId === "g4-ore" && Object.keys(entry.slots).length === 0);
  return g.done();
})();
```

## Step 20 [Player]: a baseline for a material you have never met names no material

```js
// [Player] Gate Friend has never held Gate Ore: the baseline shows the slot, the tier needed and the effect, not the material's name.
await (async () => {
  const p = globalThis.__p4 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const axe = p.api.compendium.view(p.friend).entries.experiments.find(e => e.recipeId === "g4-axe");
  p.check("the Gate Axe entry exists with its baseline", axe?.baseline?.baseTier === 1, JSON.stringify(axe?.baseline));
  p.check("the slot, the tier it needs and the effect are shown", axe?.baseline?.slots?.[0]?.slot === "head" && axe.baseline.slots[0].needs === "tier 1 or higher" && axe.baseline.slots[0].effects.basePower === "T1");
  p.check("the material is not named (never met)", axe?.baseline?.slots?.[0]?.material === null, JSON.stringify(axe?.baseline?.slots?.[0]));
  p.check("the only effects listed come from the weapon class (shared or learned elsewhere): none was learned by crafting the Axe", (axe?.known ?? []).every(k => k.source === "class" || k.source === "shared"), JSON.stringify((axe?.known ?? []).map(k => k.source)));
  return p.done();
})();
```

## Step 21 [GM]: the GM's views are complete

```js
// [GM] the GM sees every character's experiments, previews with the FULL plan, and the audit.
await (async () => {
  const g = globalThis.__g4 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const smith = g.smith();
  const all = g.api.compendium.all();
  const mine = all.characters.find(c => c.name === "Gate Smith");
  g.check("compendium.all lists Gate Smith's two learned facts", mine?.experiments?.find(e => e.recipeId === "g4-blade")?.known?.length === 2);
  g.check("and the party's shared experiments", all.shared.experiments.some(e => e.recipeId === "g4-blade"));
  const full = g.api.previewCraft(smith, "g4-blade", { body: "g4-steel", edge: "g4-star" }, "g4-bench");
  g.check("the GM's preview keeps the full plan: result, effects, craft level, loss chances", full.ok && Boolean(full.plan.description) && full.plan.craftLevel === 2 && "slotLossChance" in full.plan.uses[0], JSON.stringify(Object.keys(full.plan ?? {})));
  g.check("the GM's registry still has the effects, outputs and the DC", Boolean(g.api.definitions.material.get("g4-steel").effects) && Boolean(g.api.definitions.recipe.get("g4-blade").output) && g.api.definitions.region.get("g4-field").explorationDC === 20);
  g.check("no audit mismatches", g.api.audit.scan().length === 0, JSON.stringify(g.api.audit.scan()));
  return g.done();
})();
```

## Step 22 [GM]: CLEANUP (always run this, even if a step failed)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Smith", "Gate Friend"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway4") === true);
  const ids = actors.map(a => a.id);
  const scene = game.scenes.getName("Gate Forge");
  const ours = scene?.getFlag(M, "gateThrowaway4") === true ? scene : null;
  const user = game.users.getName("Test");

  if (ours) {
    await attempt("party location", async () => { await game.settings.set(M, "partyLocation", ours.getFlag(M, "gateOriginalLocation") ?? ""); });
    await attempt("clear the map", () => api.clearMap(ours));
    await attempt("clear the anchors", () => api.clearAnchors(ours, { confirm: true }));
    await attempt("untag the scene", () => api.untagScene(ours, "g4-field"));
    await attempt("the explorationState entry", async () => { const all = game.settings.get(M, "explorationState") ?? {}; delete all[ours.id]; await game.settings.set(M, "explorationState", all); });
    await attempt("delete the scene", () => ours.delete());
  }
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the shared Compendium", async () => {
    const book = game.settings.get(M, "sharedCompendium");
    if (!book) return;
    const drop = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => !k.startsWith("g4-")));
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
  for (const [kind, id] of [["recipe", "g4-axe"], ["recipe", "g4-blade"], ["region", "g4-field"], ["nodeType", "g4-bush"], ["station", "g4-bench"], ["material", "g4-star"], ["material", "g4-ember"], ["material", "g4-steel"], ["material", "g4-ore"], ["town", "g4-town"]]) api.definitions[kind].delete(id);
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  delete globalThis.__g4;
  delete globalThis.__p4;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, sceneLeft: Boolean(game.scenes.getName("Gate Forge")), downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, sharedLeft: Object.keys(game.settings.get(M, "sharedCompendium")?.experiments ?? {}).filter(k => k.startsWith("g4-")).length, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `sceneLeft: false`, `downtimeOpen: false`, `sharedLeft: 0`, and the audit list empty. In the Player window, run `delete globalThis.__p4` (or just reload).
