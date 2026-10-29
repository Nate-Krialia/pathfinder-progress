# 12 Console checks (copy and paste, GM window)

These blocks are run against the real `main.js` API by `tests/console-checks.test.js`, so the calls and argument shapes are known to work (in the fake Foundry; the PF2e and Foundry specifics only a real run shows). Run them in this order in the **GM** window with the console open (F12): SETUP once, CHECK as often as you like, CLEANUP when you are done.

The check only ever touches the scene **"Expedition Test"** and the characters **Gate Hero** and **Gate Absent**. It refuses to start (changing nothing) if downtime is already open, anything is queued, another character holds downtime days, or the scene already has anchors or nodes.

## [GM] Setup

```js
// [GM] SETUP: (re)create the two throwaway characters, give Gate Hero a token on "Expedition Test", make Gate Hero Test's character.
await (async () => {
  const M = "pathfinder-progress";
  const scene = game.scenes.getName("Expedition Test"), user = game.users.getName("Test");
  if (!scene || !user) throw new Error(`Need the scene "Expedition Test" and the user "Test" (scene found: ${!!scene}, user found: ${!!user})`);
  const ownership = { default: 0, [user.id]: 3 };
  const hero = game.actors.getName("Gate Hero") ?? await Actor.create({ name: "Gate Hero", type: "character", ownership });
  const away = game.actors.getName("Gate Absent") ?? await Actor.create({ name: "Gate Absent", type: "character", ownership });
  if (!scene.tokens.some(t => t.actorId === hero.id)) {
    const td = await hero.getTokenDocument({ x: 300, y: 300 });
    await scene.createEmbeddedDocuments("Token", [td.toObject()]);
  }
  if (user.getFlag(M, "checkOriginalCharacter") === undefined) await user.setFlag(M, "checkOriginalCharacter", user.character?.id ?? "none");
  await user.update({ character: hero.id });
  return { hero: hero.name, away: away.name, heroTokenOnScene: scene.tokens.some(t => t.actorId === hero.id), testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

## [GM] Check

```js
// [GM] CHECK: runs downtime start/addLate/end, explore, searchArea, clearMap, clearAnchors and captures every "deprecat..." console warning.
// Prints { deprecations, stoppedAt, error, cleanupProblems }. Cleanup of what THIS run created always runs.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const scene = game.scenes.getName("Expedition Test"), hero = game.actors.getName("Gate Hero"), away = game.actors.getName("Gate Absent");
  const seen = [], originalWarn = console.warn;
  let step = "precheck", error = null, ours = false, startedDowntime = false, tagged = false, viewedBefore = null, viewed = false;
  const cleanupProblems = [];
  const attempt = async (name, fn) => { try { await fn(); } catch (e) { cleanupProblems.push(`${name}: ${e.message}`); } };
  console.warn = (...args) => { seen.push(args.map(String).join(" ")); originalWarn(...args); };
  try {
    if (!scene || !hero || !away) throw new Error('run the SETUP block first (needs the scene "Expedition Test", Gate Hero and Gate Absent)');
    if (!scene.tokens.some(t => t.actorId === hero.id)) throw new Error("Gate Hero has no token on the scene; run SETUP");
    if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first so this check never touches a real period");
    if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first (ending downtime would return every queued item)");
    const holders = game.actors.filter(a => ![hero.id, away.id].includes(a.id) && (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
    if (holders.length) throw new Error(`these characters hold downtime days that ending downtime would erase: ${holders.join(", ")}`);
    if (api.listAnchors(scene, { all: true }).length) throw new Error('"Expedition Test" already has anchors or nodes; clear them first (this check clears the scene when it finishes)');
    ours = true;

    viewedBefore = canvas.scene;
    step = "scene.view"; await scene.view(); viewed = true;                                     // searchArea searches the scene the GM is viewing
    step = "downtime.start"; await api.downtime.start({ days: 4, actorIds: [hero.id] }); startedDowntime = true;
    step = "downtime.addLate"; await api.downtime.addLate(away.id);
    step = "tagScene"; await api.tagScene(scene, "oak-wood"); tagged = true;
    step = "placeAnchors"; await api.placeAnchors(6, { scene });
    step = "queue.submit"; const action = await api.queue.submit(hero, "explore", { region: "oak-wood", skill: "survival", forceCombat: true }, 2);
    step = "queue.resolve"; const outcome = await api.queue.resolve(hero, action.id, { degree: "success", chat: false });  // only OUR action
    if (outcome.status !== "resolved") throw new Error(`the explore action did not resolve: ${outcome.status}: ${outcome.message}`);
    step = "searchArea"; await api.searchArea(hero);
    step = "clearMap"; await api.clearMap(scene);
    step = "clearAnchors"; await api.clearAnchors(scene, { confirm: true });
    step = "untagScene"; await api.untagScene(scene, "oak-wood"); tagged = false;
    step = "downtime.end"; await api.downtime.end({ force: true }); startedDowntime = false;
    step = "done";
  } catch (e) {
    error = e.message;
  } finally {
    // Cleanup ALWAYS runs, but only undoes what this run created.
    if (startedDowntime) await attempt("downtime.end", () => api.downtime.end({ force: true }));
    if (ours) {
      await attempt("clearMap", () => api.clearMap(scene));
      await attempt("clearAnchors", () => api.clearAnchors(scene, { confirm: true }));
    }
    if (tagged) await attempt("untagScene", () => api.untagScene(scene, "oak-wood"));
    if (viewed) await attempt("restore the scene you were viewing", () => viewedBefore?.view());
    console.warn = originalWarn;
  }
  const deprecations = seen.filter(s => /deprecat/i.test(s));
  return { deprecations: deprecations.length ? deprecations : "no deprecation warnings", stoppedAt: error ? step : "ran every step", error, cleanupProblems };
})();
```

## [GM] Cleanup

```js
// [GM] CLEANUP: delete Gate Hero and Gate Absent and everything they left behind; restore Test's character. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const user = game.users.getName("Test"), scene = game.scenes.getName("Expedition Test");
  const names = ["Gate Hero", "Gate Absent"];
  const actors = names.map(n => game.actors.getName(n)).filter(Boolean);
  const ids = actors.map(a => a.id);
  const report = {};

  if (scene) {                                                                                   // the test scene: nodes, anchors, tag and our token
    report.clearMap = await api.clearMap(scene);
    report.anchorsDeleted = await api.clearAnchors(scene, { confirm: true });
    await api.untagScene(scene, "oak-wood");
    const tokenIds = scene.tokens.filter(t => ids.includes(t.actorId)).map(t => t.id);
    if (tokenIds.length) await scene.deleteEmbeddedDocuments("Token", tokenIds);
  }

  const period = api.downtime.state();                                                           // reset the downtime setting only if it is closed or only ours
  if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) {
    await game.settings.set(M, "downtime", {});
    report.downtime = "reset";
  } else {
    report.downtime = "a real downtime period is open: left alone";
  }

  const ledger = api.audit.ledger();                                                             // their ledger entries and the world events that name them
  for (const id of ids) delete ledger[id];
  if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !names.some(n => h.text.includes(n)));
  await game.settings.set(M, "auditLedger", ledger);

  if (user) {                                                                                    // Test's character goes back to what it was
    const original = user.getFlag(M, "checkOriginalCharacter");
    await user.update({ character: original && original !== "none" && game.actors.get(original) ? original : null });
    if (original !== undefined) await user.unsetFlag(M, "checkOriginalCharacter");
  }
  for (const actor of actors) await actor.delete();

  return { ...report, charactersLeft: game.actors.filter(a => names.includes(a.name)).length, testUsersCharacter: user?.character?.name ?? null, audit: api.audit.scan() };
})();
```
