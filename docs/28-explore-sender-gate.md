# 28 Explore and sender gate: the search relay, one attempt, and who is really asking (real Foundry)

Run in a real world on PF2e 8.6.1 with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]**. **Each step's instructions are a short bullet list, one action per bullet, in the order you do them; what you should see afterwards is its own bullet starting "You should see:". Run the steps in order. Steps are never renumbered: a new step is added at the end, so only the new ones need a rerun.**

**Every FAIL line prints each value it compared, and every step prints at least one `REPORT` line on every run (a pass too), so a failure can be read from the output alone.** A step run by the Player prints what the Player's window held at its FIRST read and then waits for the GM's write to arrive (`p.until`, up to 6 s): a Player window sees the GM client's write as a later update (E-013).

`tests/gate28.test.js` plays every step in a fake Foundry and runs the mutation checks (a module that trusted the id in the payload fails the steps named below). **What the fake cannot prove, and only this gate can:** that real socketlib hands the handler the real sender (`this.socketdata.userId`) and ignores the `userId` a Player puts in the payload; that two socket messages sent together interleave on the real GM client the way the fake's do; that a real PF2e character's Perception roll runs on the GM client; that a Player's window really receives the whisper and the updated `explorationState` setting later than the GM's write.

**What this gate covers** (fake-tested before, never run on real Foundry): a Player's "Search the area" (the `search` socket handler, `runSearch`, `resetSearches`, the search whisper); the one-step check-and-claim of a search under the `explorationState` lock (round 4, finding 18); and a Player who forges another user's id in the payload of the `search`, `queueSubmit`, `queueCancel`, `workshopStart` and `workshopAside` handlers (round 2, `senderOf`). The Player calls the GM's handlers directly through the real socket (the technique of gate 15, step 17); `api.searchArea` builds exactly the same `search` payload from the scene the Player's window is viewing (`scripts/exploration/store.js`), so this gate sends it with an explicit scene id and does not need that scene to be the active one.

**How the forgeries are aimed:** the Player forges the **GM's** user id, and aims at the character **Gate G28 Other**, which Test can see but does not own. A module that believed the id in the payload would act as the GM and change Other's search record, queue or workshop. A module that uses socketlib's real sender refuses, and the refusal names Test ("submit: Test does not own Gate G28 Other"), which is the proof of who was acting. The same payload aimed at **Gate G28 Hero** (owned by Test) is the control: it works, and only Hero changes.

**What SETUP plants** (all throwaway "Gate G28" things): in-memory definitions (a town, two materials `g28-ore` and `g28-gem`, a workshop `g28-bench`), the characters **Gate G28 Hero** (owned by Test, who is made to play it) and **Gate G28 Other** (observable by Test, owned by nobody), the scene **Gate G28 Field** with both characters' tokens (it is NOT activated), materials on both, the party at the gate town, and on Other: one queued share and one workshop project that the GM made, so the forged cancel and put-aside have something to aim at. SETUP saves a fingerprint of the world as it was (on the user Test) and CLEANUP checks the world against it.

**What the kit needs:** nothing new. Every step is a plain block run in the GM window or the Player window, in order; the runner must show the `console.log` lines. There is no click script and no runner action (no reload, no extras). **What it does NOT need:** a reload, a second Player, an active scene, or any real dice control (no search here depends on a roll: nothing is hidden on the scene, so a search always finds nothing).

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

**What to do and see:**
- Force-reload BOTH windows first (Ctrl+Shift+R) and wait for the world to finish loading. The version must be **0.22.0**; if it is not, stop (the release may still be building).
- Run the block below in the GM window, then again in the Player window.
- You should see: `["<your GM name>", true, "0.22.0", true]` in the GM window and `["Test", false, "0.22.0", true]` in the Player window (the last value says the module's socket is registered on that client).

```js
await (async () => {
  const row = [game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version, game.modules.get("pathfinder-progress").api.socketStatus().registered === true];
  console.log(`REPORT who, window and version: ${JSON.stringify(row)}`);
  return row;
})();
```

## Step 2 [GM]: SETUP

**What to do and see:**
- Run the block below in the GM window. It is safe to run again at any time (after a reload of the GM window it puts the in-memory definitions and `globalThis.__g28` back).
- You should see: an object with `planted` (the lines it made), `baseline` and `testUsersCharacter: "Gate G28 Hero"`. On a rerun it says `already: "set up"`.
- If it stops with `already exists and was not made by this check`, rename or delete that actor or scene first.

```js
// [GM] SETUP: in-memory g28- definitions, Gate G28 Hero (Test plays it) and Gate G28 Other (nobody owns it), the scene Gate G28 Field with both tokens, materials, one queued share and one hearth project
// on Other (made by the GM). Saves a fingerprint of the world as it was. Says what it planted. Run it again after a reload to rebuild the helper.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  if (api.socketStatus().registered !== true || !globalThis.socketlib?.modules?.get(M)) throw new Error(`the module's socket is not registered: ${JSON.stringify(api.socketStatus())}`);
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway28") === true;
  const [heroOld, otherOld, sceneOld] = [game.actors.getName("Gate G28 Hero"), game.actors.getName("Gate G28 Other"), game.scenes.getName("Gate G28 Field")];
  if (![heroOld, otherOld, sceneOld].every(mine)) throw new Error('"Gate G28 Hero", "Gate G28 Other" or "Gate G28 Field" already exists and was not made by this check; rename or delete it first');

  const defs = [
    ["town", { kind: "town", id: "g28-town", name: "Gate G28 Town" }],
    ["material", { kind: "material", id: "g28-ore", name: "Gate G28 Ore", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g28-gem", name: "Gate G28 Gem", tier: 1, effects: { basePower: "T1" } }],
    ["station", { kind: "station", id: "g28-bench", name: "Gate G28 Bench", category: "smithing", tier: 1, town: "g28-town" }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  const sum = (a, id) => a.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + i.system.quantity, 0);
  const ledgerEvents = () => (game.settings.get(M, "auditLedger")?._events?.history ?? []).map(h => h.text);
  const fingerprint = () => JSON.stringify({
    actors: game.actors.filter(a => a.getFlag(M, "gateThrowaway28") !== true).map(a => a.name).sort(),
    scenes: game.scenes.filter(s => s.getFlag(M, "gateThrowaway28") !== true).map(s => s.name).sort(),
    partyLocation: game.settings.get(M, "partyLocation") ?? "",
    testCharacter: game.users.getName("Test")?.character?.id ?? null,
    explorationScenes: Object.keys(game.settings.get(M, "explorationState") ?? {}).filter(id => game.scenes.get(id)?.getFlag(M, "gateThrowaway28") !== true).sort(),
    stationState: (game.settings.get(M, "stationState") ?? []).filter(e => e.stationId !== "g28-bench").length,
    partyStations: (game.settings.get(M, "partyStations") ?? []).length,
    gateEvents: ledgerEvents().filter(t => /Gate G28/.test(t)).length
  });
  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, sum, fingerprint, ledgerEvents,
      hero: () => game.actors.get(ids.hero), other: () => game.actors.get(ids.other), scene: () => game.scenes.get(ids.scene),
      state: () => structuredClone(game.settings.get(M, "explorationState")?.[ids.scene] ?? null),
      attempts: () => structuredClone(game.settings.get(M, "explorationState")?.[ids.scene]?.searches ?? {}),
      searchLog: actor => api.gm.log({ kind: "search" }).filter(e => e.actorId === actor.id),
      named: obj => Object.fromEntries(Object.entries(obj).map(([id, v]) => [game.actors.get(id)?.name ?? id, v])),
      view: a => ({ name: a.name, pending: (a.getFlag(M, "pendingActions") ?? []).map(x => `${x.type}:${x.id}`), projects: (a.getFlag(M, "projects") ?? []).map(x => `${x.id}:${x.status}:${JSON.stringify(x.materials ?? [])}`), ore: sum(a, "g28-ore"), gem: sum(a, "g28-gem") }),
      until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
      pause: ms => new Promise(r => setTimeout(r, ms)),
      report: (label, value) => console.log(`REPORT ${label}: ${JSON.stringify(value)}`),
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g28 = g;
    return g;
  };

  if (heroOld || otherOld || sceneOld) {
    if (!(heroOld && otherOld && sceneOld)) throw new Error("part of the gate is missing (a character or the scene was deleted): run CLEANUP (step 14), then SETUP again");
    const saved = sceneOld.getFlag(M, "gateIds28") ?? {};
    const g = build({ hero: heroOld.id, other: otherOld.id, scene: sceneOld.id, otherShare: saved.otherShare, otherHearth: saved.otherHearth, otherEvents: saved.otherEvents });
    g.report("SETUP rerun: rebuilt the helper", g.ids);
    return { already: "set up", rebuilt: "the definitions and globalThis.__g28", ids: g.ids };
  }

  // Refuse to run on top of an earlier run's leftovers, and remember the world as it is NOW.
  const left = [];
  if ((game.settings.get(M, "stationState") ?? []).some(e => e.stationId === "g28-bench")) left.push("a saved state for the Gate G28 Bench");
  if (ledgerEvents().some(t => /Gate G28/.test(t))) left.push("audit lines that name Gate G28 things");
  if (left.length) throw new Error(`an earlier run left ${left.join(", ")}: run CLEANUP (step 14) first`);
  const start = fingerprint();
  await test.setFlag(M, "gateStart28", start);                      // a string; the world as it was, for CLEANUP to compare against
  await test.setFlag(M, "gateOriginalCharacter28", test.character?.id ?? "none");

  const flags = { [M]: { gateThrowaway28: true } };
  const hero = await Actor.create({ name: "Gate G28 Hero", type: "character", ownership: { default: 0, [test.id]: 3 }, flags });
  const other = await Actor.create({ name: "Gate G28 Other", type: "character", ownership: { default: 2 }, flags });   // observable by Test, owned by nobody
  const scene = await Scene.create({ name: "Gate G28 Field", width: 1400, height: 1000, grid: { size: 100 }, padding: 0, ownership: { default: 2 }, flags });
  let x = 100;
  for (const actor of [hero, other]) { const td = await actor.getTokenDocument({ x: (x += 200), y: 300 }); await scene.createEmbeddedDocuments("Token", [td.toObject()]); }
  await scene.setFlag(M, "gateOriginalLocation", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g28-town");
  await api.giveMaterial(hero, "g28-ore", 6);
  await api.giveMaterial(other, "g28-ore", 6);
  await api.giveMaterial(other, "g28-gem", 2);
  await test.update({ character: hero.id });

  const ids = { hero: hero.id, other: other.id, scene: scene.id };
  const g = build(ids);
  const booked = await g.until(() => ["g28-ore", "g28-gem"].every(id => other.getFlag(M, "compendium")?.materials?.[id]) && hero.getFlag(M, "compendium")?.materials?.["g28-ore"]);
  if (!booked) throw new Error("the Compendium did not record the materials the characters were given (wait a moment and run SETUP again after CLEANUP)");
  const share = await api.queue.submit(other, "share", { kind: "material", key: "g28-ore" });           // the GM's own queued share on Other: the forged cancel aims at it
  const hearth = await api.workshop.startUpgrade(other, { stationId: "g28-bench", kind: "hearth", materials: { "g28-ore": 2 } });   // and the GM's own project: the forged put-aside aims at it
  ids.otherShare = share.id; ids.otherHearth = hearth.id;
  ids.otherEvents = g.ledgerEvents().filter(t => /Gate G28 Other/.test(t)).length;      // the audit lines about Other that the GM's own setup made: a forged request must not add one
  await scene.setFlag(M, "gateIds28", ids);
  g.report("SETUP: the world before (fingerprint saved on Test)", JSON.parse(start));
  g.report("SETUP: Hero, Other and the ids the forgeries aim at", { hero: g.view(hero), other: g.view(other), ids });
  return {
    planted: ["g28-town, g28-ore, g28-gem, g28-bench (in memory)", "Gate G28 Hero (owned by Test) and Gate G28 Other (owned by nobody)", "Gate G28 Field with both tokens (not activated)", "the party at g28-town", "one queued share and one hearth project on Other"],
    baseline: { hero: g.view(hero), other: g.view(other), attempts: g.attempts() },
    testUsersCharacter: game.users.getName("Test").character?.name
  };
})();
```

## Step 3 [Player]: the Player helper

**What to do and see:**
- Run the block below in the Player window. It is lost on a reload; just run it again.
- You should see: an object with `me`, `gm`, `hero`, `other` and `ids` (the action and the project the GM made on Other), and the first read it took.
- If it stops with `Player window as "Test" only`, you are in the wrong window or SETUP has not run.

```js
// [Player] helper for the next steps: the module's real socket, the GM's user id, what this window can read, and a log of every handler call it makes.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const hero = game.user.character, other = game.actors.getName("Gate G28 Other"), scene = game.scenes.getName("Gate G28 Field");
  if (game.user.isGM || hero?.name !== "Gate G28 Hero") throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  if (!other || !scene) throw new Error("this window cannot see Gate G28 Other or Gate G28 Field (the GM should check SETUP)");
  const socket = globalThis.socketlib?.modules?.get(M), gm = game.users.find(u => u.isGM);
  if (!socket || !gm) throw new Error("could not find the module's socket or the GM user (api.socketStatus() shows what is missing)");
  const sum = (a, id) => a.items.filter(i => i.getFlag(M, "material")?.materialId === id).reduce((n, i) => n + i.system.quantity, 0);
  const calls = [];
  const rows = [];
  const p = {
    M, api, hero, other, scene, socket, gmId: gm.id, me: game.user.id, calls, ids: {},
    state: () => structuredClone(game.settings.get(M, "explorationState")?.[scene.id] ?? null),
    attempts: () => structuredClone(game.settings.get(M, "explorationState")?.[scene.id]?.searches ?? {}),
    named: obj => Object.fromEntries(Object.entries(obj).map(([id, v]) => [game.actors.get(id)?.name ?? id, v])),
    whispers: () => game.messages.contents.filter(m => m.visible && m.whisper?.length && /You search the area|already searched/.test(m.content)).map(m => m.content),
    view: a => ({ name: a.name, pending: (a.getFlag(M, "pendingActions") ?? []).map(x => `${x.type}:${x.id}`), projects: (a.getFlag(M, "projects") ?? []).map(x => `${x.id}:${x.status}:${JSON.stringify(x.materials ?? [])}`), ore: sum(a, "g28-ore"), gem: sum(a, "g28-gem") }),
    // everything this window can read of the module's characters, workshops and queues (ids, kinds and counts only: never a number a player must not see)
    snap: () => JSON.stringify({
      actors: game.actors.filter(a => a.getFlag(M, "gateThrowaway28") === true || (a.getFlag(M, "pendingActions") ?? []).length || (a.getFlag(M, "projects") ?? []).length).map(a => p.view(a)).sort((a, b) => a.name.localeCompare(b.name)),
      gmCharacter: game.users.find(u => u.isGM)?.character?.name ?? null,
      stationState: (game.settings.get(M, "stationState") ?? []).length, partyStations: (game.settings.get(M, "partyStations") ?? []).length
    }),
    call: async (handler, payload) => {
      let result;
      try { result = await socket.executeAsGM(handler, payload); } catch (error) { result = { threw: error.message }; }
      calls.push({ handler, payload, result });
      return result;
    },
    until: async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } return false; },
    pause: ms => new Promise(r => setTimeout(r, ms)),
    report: (label, value) => console.log(`REPORT ${label}: ${JSON.stringify(value)}`),
    check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
    done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
  };
  globalThis.__p28 = p;
  // what the GM made on Other in SETUP: wait for it to arrive in this window, and print the first read
  const first = p.view(other);
  const arrived = await p.until(() => p.view(other).pending.length === 1 && p.view(other).projects.length === 1);
  if (!arrived) throw new Error(`Gate G28 Other's queue and project did not arrive in this window (first read ${JSON.stringify(first)}, now ${JSON.stringify(p.view(other))})`);
  p.ids.otherShare = (other.getFlag(M, "pendingActions") ?? [])[0].id;
  p.ids.otherHearth = (other.getFlag(M, "projects") ?? [])[0].id;
  p.report("helper: first read of Other, then what arrived", { firstRead: first, arrived: p.view(other), ids: p.ids });
  return { me: p.me, gm: p.gmId, hero: p.view(hero), other: p.view(other), ids: p.ids, firstRead: first, attempts: p.named(p.attempts()) };
})();
```

## Step 4 [Player]: a) a search records exactly one attempt

**What to do and see:**
- Run the block below in the Player window. It sends the same `search` payload the "Search the area" button sends, through the real socket, for Gate G28 Hero.
- You should see: `REPORT` lines for the attempt record before, the payload, the result, the first read after the call and the read once it arrived, then `ALL PASS`.
- You should see: one whisper to you that says only "You search the area." (no number, nothing about what was or was not there).

```js
// [Player] a) one search, one attempt. Prints the attempt record before and after.
await (async () => {
  const p = globalThis.__p28 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const before = p.named(p.attempts()), whispersBefore = p.whispers().length;
  p.report("a) attempts before", before);
  const payload = { actorId: p.hero.id, sceneId: p.scene.id, userId: p.me };
  p.report("a) payload sent", payload);
  const result = await p.call("search", payload);
  p.report("a) result", result);
  const first = p.named(p.attempts());
  p.report("a) first read right after the call", first);
  const arrived = await p.until(() => Object.keys(p.attempts()).length === 1);
  const after = p.named(p.attempts());
  p.report("a) attempts after", after);
  const whisper = await p.until(() => p.whispers().length === whispersBefore + 1);
  const state = p.state();
  p.report("a) the stored scene state", state);
  p.check("there was no attempt before", Object.keys(before).length === 0, JSON.stringify(before));
  p.check("the call was answered, not refused", typeof result?.message === "string" && Array.isArray(result?.spotted) && result.__relay === undefined, JSON.stringify(result));
  p.check("the player is told only the plain line, and nothing was spotted", result?.message === "You search the area." && result.spotted.length === 0, JSON.stringify(result));
  p.check("exactly one attempt is recorded, and it is Gate G28 Hero's", Boolean(arrived) && JSON.stringify(Object.keys(after)) === '["Gate G28 Hero"]' && typeof after["Gate G28 Hero"] === "number", JSON.stringify({ first, after }));
  p.check("nothing else in the scene state changed", state?.encounter === null && JSON.stringify(state?.revealed) === "[]" && JSON.stringify(state?.depleted) === "[]" && JSON.stringify(state?.prepared) === "[]", JSON.stringify(state));
  p.check("one whisper reached this window, and it is exactly the plain line", Boolean(whisper) && JSON.stringify(p.whispers().slice(whispersBefore)) === JSON.stringify(["<p>You search the area.</p>"]), JSON.stringify({ whispersBefore, now: p.whispers() }));
  return p.done();
})();
```

## Step 5 [GM]: a) the GM's own view of step 4, then give the attempt back

**What to do and see:**
- Run the block below in the GM window. It reads the scene state and the GM log (the GM log lives in memory: if you reloaded the GM window since step 4 its counts start again, and this step says so).
- You should see: `REPORT` lines with the stored attempts, the GM log's entries for the two characters, and what `resetSearches` returned, then `ALL PASS`.

```js
// [GM] a) the GM's view: one search resolved for the Hero, the attempt is hers, resetSearches clears it.
await (async () => {
  const g = globalThis.__g28 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero(), other = g.other();
  const attempts = g.named(g.attempts()), logHero = g.searchLog(hero).length, logOther = g.searchLog(other).length;
  g.report("a) GM sees the attempts", attempts);
  g.report("a) GM log: search entries (Hero, Other)", [logHero, logOther]);
  g.check("the stored attempt is the Hero's alone", JSON.stringify(Object.keys(attempts)) === '["Gate G28 Hero"]', JSON.stringify(attempts));
  g.check("the GM log shows ONE search for the Hero and none for Other (a reload of this window restarts the log)", logHero === 1 && logOther === 0, JSON.stringify({ logHero, logOther }));
  const cleared = await g.api.resetSearches(g.scene());
  g.report("a) resetSearches returned", cleared);
  g.check("resetSearches gave back exactly one attempt", cleared === 1, JSON.stringify(cleared));
  g.check("and the stored attempts are empty now", JSON.stringify(g.attempts()) === "{}", JSON.stringify(g.attempts()));
  return g.done();
})();
```

## Step 6 [Player]: b) the same character searching twice at once makes ONE attempt

**What to do and see:**
- Run the block below in the Player window. It first waits until this window shows the attempts empty (the GM's reset arrives as a later update), then starts two `search` calls for Gate G28 Hero together.
- You should see: `REPORT` lines for the first read, both results, the stored state and the whispers, then `ALL PASS`.
- You should see: one of the two results is the plain "You search the area." and the other says you have already searched.

```js
// [Player] b) two searches started together for one character: ONE attempt (one result is the fresh line, the other the already-searched line), one whisper.
await (async () => {
  const p = globalThis.__p28 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const first = p.named(p.attempts());
  p.report("b) first read (the GM's reset in step 5 must have arrived)", first);
  const cleared = await p.until(() => Object.keys(p.attempts()).length === 0);
  p.check("the GM's reset arrived: no attempt is shown", Boolean(cleared), JSON.stringify({ first, now: p.named(p.attempts()) }));
  const whispersBefore = p.whispers().length;
  const payload = { actorId: p.hero.id, sceneId: p.scene.id, userId: p.me };
  p.report("b) payload sent twice, started together", payload);
  const results = await Promise.all([p.call("search", payload), p.call("search", payload)]);
  p.report("b) both results", results);
  const arrived = await p.until(() => Object.keys(p.attempts()).length === 1);
  const whisper = await p.until(() => p.whispers().length >= whispersBefore + 1);
  await p.pause(1500);                                              // a second whisper (a second attempt) would arrive in this time
  const after = p.named(p.attempts());
  const fresh = results.filter(r => r?.message === "You search the area."), already = results.filter(r => r?.message === "You have already searched this area.");
  p.report("b) attempts after", after);
  p.report("b) the stored scene state", p.state());
  p.report("b) whispers added", p.whispers().slice(whispersBefore));
  p.check("both calls were answered, neither refused", results.every(r => typeof r?.message === "string" && r.__relay === undefined), JSON.stringify(results));
  p.check("exactly ONE result is the fresh search and ONE says already searched", fresh.length === 1 && already.length === 1, JSON.stringify({ fresh: fresh.length, already: already.length, results }));
  p.check("one attempt is stored, the Hero's", Boolean(arrived) && JSON.stringify(Object.keys(after)) === '["Gate G28 Hero"]', JSON.stringify(after));
  p.check("exactly one whisper was added (a second search would have made a second)", Boolean(whisper) && JSON.stringify(p.whispers().slice(whispersBefore)) === JSON.stringify(["<p>You search the area.</p>"]), JSON.stringify({ whispersBefore, added: p.whispers().slice(whispersBefore) }));
  return p.done();
})();
```

## Step 7 [GM]: b) the GM's view of step 6, then give the attempt back

**What to do and see:**
- Run the block below in the GM window.
- You should see: `REPORT` lines with the stored attempts and the GM log's entries, then `ALL PASS`.

```js
// [GM] b) the GM's view: step 6 made ONE more search for the Hero (two in all with step 4), and the attempt is given back.
await (async () => {
  const g = globalThis.__g28 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero(), other = g.other();
  const attempts = g.named(g.attempts()), logHero = g.searchLog(hero).length, logOther = g.searchLog(other).length;
  g.report("b) GM sees the attempts", attempts);
  g.report("b) GM log: search entries (Hero, Other)", [logHero, logOther]);
  g.check("the stored attempt is the Hero's alone", JSON.stringify(Object.keys(attempts)) === '["Gate G28 Hero"]', JSON.stringify(attempts));
  g.check("the GM log shows TWO searches for the Hero in all (step 4 and ONE from step 6), none for Other (a reload of this window restarts the log)", logHero === 2 && logOther === 0, JSON.stringify({ logHero, logOther }));
  const cleared = await g.api.resetSearches(g.scene());
  g.report("b) resetSearches returned", cleared);
  g.check("resetSearches gave back exactly one attempt", cleared === 1 && JSON.stringify(g.attempts()) === "{}", JSON.stringify({ cleared, attempts: g.attempts() }));
  return g.done();
})();
```

## Step 8 [Player]: c) a forged GM id in the search payload: the module acts as the Player

**What to do and see:**
- Run the block below in the Player window. It sends the `search` payload with the GM's user id in it, first for Gate G28 Other (which you do not own), then for your own Gate G28 Hero.
- You should see: `REPORT` lines with each payload, each result, and the attempts before and after, then `ALL PASS`.
- You should see: the first search is refused as "You can only search with a character you own." and records nothing for Other; the second is done as you and records the attempt for Hero.

```js
// [Player] c) the GM's id in the payload does not make the Player the GM: Other (not owned by Test) is refused and gets no attempt; the Hero (owned by Test) is searched as Test.
await (async () => {
  const p = globalThis.__p28 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const first = p.named(p.attempts());
  p.report("c) attempts first read (the GM's reset in step 7 must have arrived)", first);
  const cleared = await p.until(() => Object.keys(p.attempts()).length === 0);
  p.check("the GM's reset arrived: no attempt is shown", Boolean(cleared), JSON.stringify({ first, now: p.named(p.attempts()) }));

  const forgedOther = { actorId: p.other.id, sceneId: p.scene.id, userId: p.gmId };
  p.report("c1) forged payload for Gate G28 Other (the GM's id)", forgedOther);
  const refused = await p.call("search", forgedOther);
  p.report("c1) result", refused);
  await p.pause(1500);                                              // an attempt written by a module that trusted the id would arrive in this time
  const afterOther = p.named(p.attempts());
  p.report("c1) attempts after (whose attempt was recorded)", afterOther);
  p.check("the search for Other is refused in the plain words, as the Player", refused?.message === "You can only search with a character you own." && JSON.stringify(refused?.spotted) === "[]" && refused.__relay === undefined, JSON.stringify(refused));
  p.check("no attempt was recorded for Other, or for anyone", JSON.stringify(afterOther) === "{}", JSON.stringify(afterOther));

  const whispersBefore = p.whispers().length;
  const forgedHero = { actorId: p.hero.id, sceneId: p.scene.id, userId: p.gmId };
  p.report("c2) forged payload for Gate G28 Hero (the GM's id)", forgedHero);
  const done = await p.call("search", forgedHero);
  p.report("c2) result", done);
  const arrived = await p.until(() => Object.keys(p.attempts()).length === 1);
  const whisper = await p.until(() => p.whispers().length === whispersBefore + 1);
  const afterHero = p.named(p.attempts());
  p.report("c2) attempts after (whose attempt was recorded)", afterHero);
  p.check("the search for the Hero is done as the Player", done?.message === "You search the area." && done.__relay === undefined, JSON.stringify(done));
  p.check("exactly one attempt is recorded, the Hero's, and none for Other", Boolean(arrived) && JSON.stringify(Object.keys(afterHero)) === '["Gate G28 Hero"]', JSON.stringify(afterHero));
  p.check("the whisper came to this window (the owner), once", Boolean(whisper) && p.whispers().slice(whispersBefore).length === 1, JSON.stringify({ whispersBefore, added: p.whispers().slice(whispersBefore) }));
  return p.done();
})();
```

## Step 9 [GM]: c) the GM's view of step 8, then give the attempt back

**What to do and see:**
- Run the block below in the GM window.
- You should see: `REPORT` lines with the stored attempts and the GM log's entries, then `ALL PASS`.

```js
// [GM] c) the GM's view: the refused search for Other left no attempt and no log entry; the search for the Hero is the third in all.
await (async () => {
  const g = globalThis.__g28 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero(), other = g.other();
  const attempts = g.named(g.attempts()), logHero = g.searchLog(hero).length, logOther = g.searchLog(other).length;
  g.report("c) GM sees the attempts", attempts);
  g.report("c) GM log: search entries (Hero, Other)", [logHero, logOther]);
  g.check("the stored attempt is the Hero's alone; Other has none", JSON.stringify(Object.keys(attempts)) === '["Gate G28 Hero"]', JSON.stringify(attempts));
  g.check("the GM log has NO search for Other, and the Hero's is the third in all (a reload of this window restarts the log)", logOther === 0 && logHero === 3, JSON.stringify({ logHero, logOther }));
  const cleared = await g.api.resetSearches(g.scene());
  g.report("c) resetSearches returned", cleared);
  g.check("resetSearches gave back exactly one attempt", cleared === 1 && JSON.stringify(g.attempts()) === "{}", JSON.stringify({ cleared, attempts: g.attempts() }));
  return g.done();
})();
```

## Step 10 [Player]: d) a forged GM id in queue submit, queue cancel, workshop start and workshop put-aside

**What to do and see:**
- Run the block below in the Player window. For each of the four handlers it sends a payload with the GM's user id in it, aimed at Gate G28 Other (which you do not own), and then the same kind of call for your own Gate G28 Hero.
- You should see: for every call a `REPORT` line with the payload, one with the result, and one with whether anything changed in the world (the snapshot before, right after and 1.5 s later).
- You should see: all four calls aimed at Other refused with a message that names you ("submit: Test does not own Gate G28 Other" and the like) and NOTHING changed; the four calls for Hero work and change only Hero (its project ends up put aside, marked abandoned). It then says `ALL PASS`.

```js
// [Player] d) the GM's id forged into queueSubmit, queueCancel, workshopStart and workshopAside. Aimed at Other: refused as the Player, nothing changes. Aimed at the Hero (owned by Test): works, only the Hero changes.
await (async () => {
  const p = globalThis.__p28 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const me = game.user.name;
  const forge = async (name, handler, payload, refusal) => {
    const before = p.snap();
    p.report(`d) ${name}: payload`, payload);
    const result = await p.call(handler, payload);
    p.report(`d) ${name}: result`, result);
    const first = p.snap();
    await p.pause(1500);                                            // a change made by a module that trusted the id would arrive in this time
    const after = p.snap();
    p.report(`d) ${name}: changed?`, { immediately: first !== before, after1500ms: after !== before });
    p.check(`${name}: refused, and the refusal names the real sender (${me}), not the GM`, result?.__relay === "refused" && result.message === refusal, JSON.stringify({ result, expected: refusal }));
    p.check(`${name}: nothing changed for anyone (the GM, Other, the Hero, the workshops)`, before === first && first === after, JSON.stringify({ before, first, after }));
  };
  const other = p.other;
  await forge("queue submit for Other", "queueSubmit", { actorId: other.id, type: "share", params: { kind: "material", key: "g28-gem" }, userId: p.gmId }, `submit: ${me} does not own ${other.name}`);
  await forge("queue cancel for Other", "queueCancel", { actorId: other.id, actionId: p.ids.otherShare, userId: p.gmId }, `cancel: ${me} does not own ${other.name}`);
  await forge("workshop start for Other", "workshopStart", { actorId: other.id, mode: "upgrade", params: { stationId: "g28-bench", kind: "craftDays", materials: { "g28-ore": 2 } }, userId: p.gmId }, `workshop: ${me} does not own ${other.name}`);
  await forge("workshop put-aside for Other", "workshopAside", { actorId: other.id, params: { projectId: p.ids.otherHearth }, userId: p.gmId }, `workshop: ${me} does not own ${other.name}`);

  // The controls: the same handlers, the same forged id, aimed at the Hero. They work (as the Player, an owner), so a refusal above is not a broken handler.
  const hero = p.hero, heroBefore = p.view(hero), otherBefore = p.view(other);
  const submit = await p.call("queueSubmit", { actorId: hero.id, type: "share", params: { kind: "material", key: "g28-ore" }, userId: p.gmId });
  p.report("d) control submit for Hero: result", submit);
  const queued = await p.until(() => p.view(hero).pending.length === 1);
  p.check("control: a forged id on your own character still submits (as you); the Hero's queue has the share, Other's is unchanged", submit?.type === "share" && typeof submit.id === "string" && Boolean(queued) && JSON.stringify(p.view(other)) === JSON.stringify(otherBefore), JSON.stringify({ submit, hero: p.view(hero), other: p.view(other), otherBefore }));
  const cancel = await p.call("queueCancel", { actorId: hero.id, actionId: submit?.id, userId: p.gmId });
  p.report("d) control cancel for Hero: result", cancel);
  const cancelled = await p.until(() => p.view(hero).pending.length === 0);
  p.check("control: the cancel works as you; the Hero's queue is empty again, Other's is unchanged", Boolean(cancelled) && cancel?.__relay === undefined && JSON.stringify(p.view(other)) === JSON.stringify(otherBefore), JSON.stringify({ cancel, hero: p.view(hero), other: p.view(other) }));
  const start = await p.call("workshopStart", { actorId: hero.id, mode: "upgrade", params: { stationId: "g28-bench", kind: "craftDays", materials: { "g28-ore": 2 } }, userId: p.gmId });
  p.report("d) control workshop start for Hero: result", { id: start?.id, status: start?.status, relay: start?.__relay, message: start?.message });
  const started = await p.until(() => p.view(hero).projects.length === 1 && p.view(hero).ore === heroBefore.ore - 2);
  p.check("control: the workshop start works as you; two ore are held on the Hero's project, Other's workshop is unchanged", Boolean(started) && start?.__relay === undefined && JSON.stringify(p.view(other)) === JSON.stringify(otherBefore), JSON.stringify({ hero: p.view(hero), heroBefore, other: p.view(other), otherBefore }));
  const aside = await p.call("workshopAside", { actorId: hero.id, params: { projectId: start?.id }, userId: p.gmId });
  p.report("d) control workshop put-aside for Hero: result", aside);
  const asideDone = v => v.ore === heroBefore.ore && v.pending.length === 0 && v.projects.length === 1 && v.projects[0].startsWith(`${start?.id}:abandoned:`);   // a put-aside project stays on the character, marked abandoned
  const back = await p.until(() => asideDone(p.view(hero)));
  p.check("control: the put-aside works as you; the two ore are back and the project is marked abandoned, and Other's workshop is unchanged", Boolean(back) && JSON.stringify(aside) === JSON.stringify({ returned: [{ materialId: "g28-ore", units: 2 }] }) && JSON.stringify(p.view(other)) === JSON.stringify(otherBefore), JSON.stringify({ aside, hero: p.view(hero), heroBefore, other: p.view(other), otherBefore }));
  return p.done();
})();
```

## Step 11 [GM]: d) the GM's view of step 10: nothing changed for anyone

**What to do and see:**
- Run the block below in the GM window.
- You should see: `REPORT` lines with Hero, Other and the audit scan, then `ALL PASS`.

```js
// [GM] d) the GM's own client sees the true state: Other's queue and workshop are exactly what SETUP made, the Hero shows only what its own controls did, nothing was logged for the forgeries.
await (async () => {
  const g = globalThis.__g28 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const hero = g.hero(), other = g.other(), M = g.M;
  const heroView = g.view(hero), otherView = g.view(other), scan = g.api.audit.scan();
  g.report("d) Hero", heroView);
  g.report("d) Other", otherView);
  g.report("d) audit scan", scan);
  g.check("Other has exactly the one share the GM queued, and nothing else", JSON.stringify(otherView.pending) === JSON.stringify([`share:${g.ids.otherShare}`]), JSON.stringify(otherView));
  g.check("Other has exactly the hearth project the GM started, with its two ore held, and the ore it was left with", otherView.projects.length === 1 && otherView.projects[0].startsWith(`${g.ids.otherHearth}:active:`) && otherView.ore === 4 && otherView.gem === 2, JSON.stringify(otherView));
  g.check("the Hero has no queued action, all six ore, and only the one project its own control put aside (marked abandoned)", heroView.pending.length === 0 && heroView.ore === 6 && heroView.projects.length === 1 && heroView.projects[0].startsWith("upgrade-g28-bench-craftDays-1:abandoned:"), JSON.stringify(heroView));
  g.check("no forged request left a line in the audit log about Other (only the lines SETUP made)", g.ledgerEvents().filter(t => /Gate G28 Other/.test(t)).length === g.ids.otherEvents, JSON.stringify({ expected: g.ids.otherEvents, lines: g.ledgerEvents().filter(t => /Gate G28/.test(t)) }));
  g.check("the audit scan finds no mismatch", scan.length === 0, JSON.stringify(scan));
  g.check("no public workshop state and no party workshop was written", (game.settings.get(M, "stationState") ?? []).filter(e => e.stationId === "g28-bench").length === 0 && (game.settings.get(M, "partyStations") ?? []).length === 0, JSON.stringify({ stationState: game.settings.get(M, "stationState"), partyStations: game.settings.get(M, "partyStations") }));
  return g.done();
})();
```

## Step 12 [Player]: e) the "did not say who is asking" refusal cannot be reached from a Player call

**What to do and see:**
- Run the block below in the Player window, after steps 4, 6, 8 and 10.
- You should see: a `REPORT` line listing every handler call this window made and every distinct message it got back, then `ALL PASS`.
- Read the text under the block: it says why this refusal cannot be reached from a real Player call, and what the gate does instead of faking it.

```js
// [Player] e) every call this window made carried a real sender: none of the answers was the "did not say who is asking" refusal.
await (async () => {
  const p = globalThis.__p28 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const answered = p.calls.map(c => ({ handler: c.handler, as: c.result?.__relay ?? (c.result?.threw ? "threw" : "answered"), message: c.result?.message ?? null }));
  const messages = [...new Set(answered.map(a => a.message).filter(Boolean))];
  p.report("e) calls made by this window", answered.length);
  p.report("e) distinct messages it got back", messages);
  p.check("this window made all the calls of steps 4, 6, 8 and 10 (1 + 2 + 2 + 8 = 13 or more)", p.calls.length >= 13, JSON.stringify({ calls: p.calls.length }));
  p.check("not one answer was the refusal 'This request did not say who is asking' (a real Player call always carries socketlib's sender)", !messages.some(m => /did not say who is asking/.test(m)), JSON.stringify(messages));
  p.check("not one call threw or came back as an unexpected failure", answered.every(a => a.as !== "threw" && a.as !== "failed"), JSON.stringify(answered.filter(a => a.as === "threw" || a.as === "failed")));
  return p.done();
})();
```

**Why that refusal is not reachable from a Player call, and what is not faked.** `senderOf` (`scripts/queue/common.js`) answers "This request did not say who is asking, so it was not done." only when the handler has **no** socketlib sender (`this.socketdata.userId`) **and** the call is not one made directly on the GM's own client with the GM's own id. A message that a Player sends through the real socket always arrives with Foundry's own sender, so the handler never sees that situation; the Player cannot remove the sender or make a call "on the GM's own client". The gate therefore does not pretend to reach it: steps 8 and 10 prove the sender is used (the refusals name Test), and this step proves that no real Player call came back with that refusal. The refusal itself is covered by the fake-Foundry tests only (`tests/relayed-sender.test.js`).

## Step 13 [GM]: e) a note, not a pass or fail: what the GM's own call to its own handler does

**What to do and see:**
- Run the block below in the GM window. It calls the module's `search` handler from the GM window with a made-up user id and a character that does not exist, so nothing can change.
- You should see: a `REPORT` line with what came back (the answer is recorded, not judged: a refusal, the plain search line or an error are all written down), and `ALL PASS` when nothing changed.

```js
// [GM] e) recorded, not judged: a GM calling the handler from its own window with a user id that is not its own. A character that does not exist is named, so nothing can change either way.
await (async () => {
  const g = globalThis.__g28 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const socket = globalThis.socketlib?.modules?.get(g.M);
  const before = JSON.stringify([g.state(), g.view(g.hero()), g.view(g.other())]);
  let answer;
  try { answer = await socket.executeAsGM("search", { actorId: "gate28-no-such-actor", sceneId: g.scene().id, userId: "gate28-no-such-user" }); } catch (error) { answer = { threw: error.message }; }
  g.report("e) the GM's own call, forged user id, no such character: what came back", answer);
  const after = JSON.stringify([g.state(), g.view(g.hero()), g.view(g.other())]);
  g.check("nothing changed, whatever it answered", before === after, JSON.stringify({ before, after }));
  return g.done();
})();
```

## Step 14 [GM]: CLEANUP (always run this, even if a step failed)

**What to do and see:**
- Run the block below in the GM window. It is safe to run twice, and after a reload.
- You should see: `problems: []`, `actorsLeft: 0`, `sceneLeft: false` and `matchesStart: true` (the world is exactly as SETUP found it). On a second run `matchesStart` says `"nothing to compare"`.

```js
// [GM] CLEANUP: deletes everything the gate made, puts back what it changed, and checks the world against the fingerprint SETUP took. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const actors = ["Gate G28 Hero", "Gate G28 Other"].map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway28") === true);
  const ids = actors.map(a => a.id);
  const scene = game.scenes.getName("Gate G28 Field");
  const ours = scene?.getFlag(M, "gateThrowaway28") === true ? scene : null;
  const user = game.users.getName("Test");

  if (ours) {
    await attempt("party location", async () => { await game.settings.set(M, "partyLocation", ours.getFlag(M, "gateOriginalLocation") ?? ""); });
    await attempt("clear the map", () => api.clearMap(ours));
    await attempt("the explorationState entry", async () => { const all = game.settings.get(M, "explorationState") ?? {}; if (ours.id in all) { delete all[ours.id]; await game.settings.set(M, "explorationState", all); } });
    await attempt("delete the scene", () => ours.delete());
  }
  await attempt("the Gate G28 Bench's saved state", async () => { if ((game.settings.get(M, "stationState") ?? []).some(e => e.stationId === "g28-bench")) await api.clearStationState("g28-bench"); });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate G28/.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter28");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter28");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  for (const [kind, id] of [["station", "g28-bench"], ["material", "g28-gem"], ["material", "g28-ore"], ["town", "g28-town"]]) api.definitions[kind].delete(id);
  delete globalThis.__g28;

  // The world against the fingerprint SETUP took (the same fields, read the same way).
  const events = () => (game.settings.get(M, "auditLedger")?._events?.history ?? []).map(h => h.text);
  const fingerprint = () => JSON.stringify({
    actors: game.actors.filter(a => a.getFlag(M, "gateThrowaway28") !== true).map(a => a.name).sort(),
    scenes: game.scenes.filter(s => s.getFlag(M, "gateThrowaway28") !== true).map(s => s.name).sort(),
    partyLocation: game.settings.get(M, "partyLocation") ?? "",
    testCharacter: game.users.getName("Test")?.character?.id ?? null,
    explorationScenes: Object.keys(game.settings.get(M, "explorationState") ?? {}).filter(id => game.scenes.get(id)?.getFlag(M, "gateThrowaway28") !== true).sort(),
    stationState: (game.settings.get(M, "stationState") ?? []).filter(e => e.stationId !== "g28-bench").length,
    partyStations: (game.settings.get(M, "partyStations") ?? []).length,
    gateEvents: events().filter(t => /Gate G28/.test(t)).length
  });
  const start = user?.getFlag(M, "gateStart28");
  const now = fingerprint();
  let matchesStart = "nothing to compare";
  if (typeof start === "string") {
    matchesStart = start === now;
    if (!matchesStart) problems.push(`the world differs from how SETUP found it: start ${start}, now ${now}`);
    else await attempt("the fingerprint", () => user.unsetFlag(M, "gateStart28"));
  }
  const outcome = {
    problems, actorsLeft: ["Gate G28 Hero", "Gate G28 Other"].filter(n => game.actors.getName(n)).length, sceneLeft: Boolean(game.scenes.getName("Gate G28 Field")),
    explorationStateLeft: Object.keys(game.settings.get(M, "explorationState") ?? {}).filter(id => !game.scenes.get(id)).length,
    gateEventsLeft: events().filter(t => /Gate G28/.test(t)).length, matchesStart
  };
  console.log(`REPORT CLEANUP: ${JSON.stringify(outcome)}`);
  return outcome;
})();
```
