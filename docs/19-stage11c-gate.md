# 19 Stage 11c gate (real Foundry): the discovery chain, item classes, gold values and the leftovers (v0.20.1)

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]**. **[Player] steps tell you what to click; the block then checks what is on screen.** The blocks can be run at any time: the helper in Step 3 records every line the Hub's status line shows (they vanish after about 10 seconds), and the blocks read that record. Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. Where a step says **"send me a screenshot of ..."**, layout is the point.

`tests/gate19.test.js` plays every step against the real `main.js` in a fake Foundry with a real DOM and the strict ApplicationV2 stand-in (it clicks what the steps tell you to click, then runs the block). What it cannot show: the real window, fonts, focus rings, real PF2e rolls, the real Tab key, or a GM that is connected but never answers (the automated tests cover that with a fake that never replies).

**What the gate shows** (the 11c decisions, `docs/11c-discovery-addendum.md`):
- **Leads from what you carry.** A material or note with a research track offers a lead; one without a track never does. Following a lead costs nothing until days are spent. Studies show a plain stage (Just started, Getting somewhere, Nearly there) and **no numbers anywhere**.
- **Milestones.** The first teaches what the material is good for (its tag and the tag's theme) and opens it for crafting; later ones teach a formula. A tracked material you have not studied stays out of the craft options, with a plain reason.
- **A higher formula version** (Gate Blade II) appears as a lead once its previous version is known and two different tagged materials are understood. It still has to be researched.
- **Put aside keeps a study's progress.**
- **Gold:** "worth N gp each", "Materials are worth about ...", "Buying this in a shop would be about ...", "You save about ...".
- **The Discovery tracks window** (GM): edit milestones, see plain validation, save.
- **No GM connected:** each action says what it was trying to do.
- Not shown, on purpose: the "GM didn't answer" line and the busy button (they need a GM that is connected and silent; the automated tests cover them).

**Fixtures, not behaviour.** SETUP plants some things so the steps have something to look at: the Compendium entries for Gate Ore A, Gate Ore B and Gate Plain (normally an entry appears when you find the material), and the already-started Gate Page study (normally you would start it yourself). They are there so the steps can be short; they are not how the module finds or starts things.

**Safety.** Throwaway things named "Gate ...": characters **Gate Scholar** and **Gate Friend** (both owned by the user "Test"), and in-memory fake definitions (`g7-ore`, `g7-a`, `g7-b`, `g7-plain`, `g7-blade`, `g7-blade2`, `g7-lantern`, `g7-charm`, `g7-trinket`, `g7-page`, `g7-letter`, `g7-town`); they last until you reload the GM window, and SETUP registers them again. No real campaign data. SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, a "Gate ..." actor exists that it did not make, or an earlier run left tracks behind. CLEANUP always works and is safe to run twice.

**Restart note.** 0.20.0 adds a world setting (the tracks overlay) and a stylesheet rule, nothing else in the manifest but the version: update the module and **force-reload both windows** (Ctrl+Shift+R). If the Discovery tracks button is missing, restart the Foundry server once.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first and wait for the world to finish loading. The version must be **0.20.1**; if it is not, stop (the release may still be building).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.20.1"]` in the GM window and `["Test", false, "0.20.1"]` in the Player window.

## Step 2 [GM]: SETUP

Safe to run again at any time (after a reload of the GM window it re-registers the fakes and rebuilds `globalThis.__g7`).

```js
// [GM] SETUP: fake definitions (memory only); Gate Scholar (carries Gate Ore A and B with tracks, Gate Plain without one, two notes; knows Gate Blade; is already studying Gate Page) + Gate Friend; 12 days of downtime.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway7") === true;
  const [scholarOld, friendOld] = [game.actors.getName("Gate Scholar"), game.actors.getName("Gate Friend")];
  if (![scholarOld, friendOld].every(mine)) throw new Error('"Gate Scholar" or "Gate Friend" already exists and was not made by this check; rename or delete it first');

  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const track = (...m) => ({ milestones: m.map(([steps, type, recipeId]) => ({ steps, grants: type === "formula" ? { type, ...(recipeId ? { recipeId } : {}) } : { type } })) });
  const recipe = (id, name, over = {}) => ({ kind: "recipe", id, name, category: "weapon", output: { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger }, craftLevel: 2, stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 }, slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }], ...over });
  const defs = [
    ["town", { kind: "town", id: "g7-town", name: "Gate Town" }],
    ["tag", { kind: "tag", id: "g7-ore", name: "Gate ore", theme: "cowardice", worksWith: "frightened" }],
    ["recipe", recipe("g7-blade", "Gate Blade", { family: "g7-blades", version: 1 })],
    ["recipe", recipe("g7-blade2", "Gate Blade II", { family: "g7-blades", version: 2, requiresTag: "g7-ore", requiresCount: 2, researchProject: { tier: 2 }, research: track([5, "formula"]) })],
    ["recipe", recipe("g7-lantern", "Gate Lantern")],
    ["recipe", recipe("g7-charm", "Gate Charm")],
    ["recipe", recipe("g7-trinket", "Gate Trinket")],
    ["material", { kind: "material", id: "g7-a", name: "Gate Ore A", tier: 1, value: 5, effects: { basePower: "T1" }, tag: "g7-ore", research: track([4, "properties"], [8, "formula", "g7-lantern"]) }],
    ["material", { kind: "material", id: "g7-b", name: "Gate Ore B", tier: 1, value: 5, effects: { basePower: "T1" }, tag: "g7-ore", research: track([2, "properties"]) }],
    ["material", { kind: "material", id: "g7-plain", name: "Gate Plain", tier: 1, value: 12, effects: { basePower: "T1" } }],
    ["note", { kind: "note", id: "g7-page", name: "Gate Page", recipeId: "g7-charm", research: track([3, "formula"]) }],
    ["note", { kind: "note", id: "g7-letter", name: "Gate Letter", recipeId: "g7-trinket", research: track([3, "formula"]) }]
  ];
  for (const [kind, record] of defs) {
    if (api.definitions[kind].has(record.id)) continue;
    const problems = api.checkDefinition(record);
    if (problems.length) throw new Error(`fake ${kind} ${record.id} is invalid: ${problems.join("; ")}`);
    api.definitions[kind].set(record.id, record);
  }

  const rows = [];
  const build = ids => {
    const g = {
      M, api, ids, scholar: () => game.actors.get(ids.scholar), friend: () => game.actors.get(ids.friend),
      queued: (actor, type) => (actor.getFlag(M, "pendingActions") ?? []).filter(a => !type || a.type === type),
      ledger: actor => actor.getFlag(M, "discoveries")?.items ?? {},
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g7 = g;
    return g;
  };
  if (scholarOld || friendOld) {
    if (!(scholarOld && friendOld)) throw new Error("part of the gate is missing (a character was deleted): run CLEANUP (the last step), then SETUP again");
    build({ scholar: scholarOld.id, friend: friendOld.id });
    return { already: "set up", rebuilt: "the definitions and globalThis.__g7", published: await api.publishDefinitions() };
  }
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  if (Object.keys(api.discovery.tracks.overlay()).some(k => /:g7-/.test(k))) throw new Error("an earlier run left tracks in the Discovery tracks window: run CLEANUP (the last step) first");

  const flags = { [M]: { gateThrowaway7: true } };
  const owned = { default: 0, [test.id]: 3 };
  const scholar = await Actor.create({ name: "Gate Scholar", type: "character", ownership: owned, flags });
  const friend = await Actor.create({ name: "Gate Friend", type: "character", ownership: owned, flags });
  for (const id of ["g7-a", "g7-b", "g7-plain"]) await api.giveMaterial(scholar, id, 1);
  await api.discovery.giveNote(scholar, "g7-page");
  await api.discovery.giveNote(scholar, "g7-letter");
  await api.grantFormula(scholar, "g7-blade");
  const now = Date.now();
  const entry = (id, name) => ({ id, name, tier: 1, firstAt: now, places: [], rungs: [] });
  const book = scholar.getFlag(M, "compendium") ?? { v: 1, materials: {}, creatures: {}, regions: {} };
  book.materials = { "g7-a": entry("g7-a", "Gate Ore A"), "g7-b": entry("g7-b", "Gate Ore B"), "g7-plain": entry("g7-plain", "Gate Plain") };
  await scholar.setFlag(M, "compendium", book);
  await api.discovery.startStudy(scholar, "note:g7-page");            // already under way: one step in ("Getting somewhere"), so Put aside can be tried
  await test.setFlag(M, "gateOriginalLocation7", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g7-town");
  await test.setFlag(M, "gateOriginalCharacter7", test.character?.id ?? "none");
  await test.update({ character: scholar.id });
  await api.downtime.start({ days: 12, actorIds: [scholar.id, friend.id] });
  await api.research.study({ actor: scholar, key: "note:g7-page", days: 1, skill: "crafting", degree: "success", chat: false });
  const published = await api.publishDefinitions();
  build({ scholar: scholar.id, friend: friend.id });
  return { scholar: scholar.name, friend: friend.name, published, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object naming Gate Scholar and Gate Friend, `testUsersCharacter: "Gate Scholar"` and a `published` revision. On a rerun it says `already: "set up"`.

## Step 3 [Player]: the helper (and the recorder)

```js
// [Player] helper for the next steps (lost on reload; run it again). Nothing here changes anything except a recorder that only listens.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const scholar = game.actors.getName("Gate Scholar"), friend = game.actors.getName("Gate Friend");
  if (game.user.isGM || !scholar?.isOwner || !friend?.isOwner) throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  await api.definitions.refresh();
  // The recorder: every distinct text of the line under the buttons (.pfp-live), with the time, from now on. It survives the Hub being closed and reopened
  // (it watches the whole page) and is replaced if this helper is run again. Result lines disappear after about 10 seconds; the recorder keeps them.
  globalThis.__p7rec?.observer.disconnect();
  const log = [], started = Date.now();
  let last = "";
  const liveText = () => [...document.querySelectorAll(".pfp-live")].map(el => el.textContent).filter(Boolean).join(" | ");
  const note = () => { const text = liveText(); if (text !== last) { last = text; log.push({ at: Date.now() - started, text }); } };
  const observer = new MutationObserver(note);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  globalThis.__p7rec = { observer, log };
  const rows = [];
  const BAD = /\bDC\b|\bodds\b|\d\s?%|\bchances?\b|\bdifficult|\bexpected\b|\bpercent\b|\bpace\b|\bper day\b/i;
  const p = {
    M, api, scholar, friend,
    root: () => document.querySelector(".pfp-hub"),
    text: () => (document.querySelector(".pfp-hub")?.textContent ?? "").replace(/\s+/g, " "),
    live: () => document.querySelector(".pfp-live")?.textContent ?? "",
    // true if the line under the buttons has said something matching, at any time since this helper was run (so the blocks can be run whenever you like)
    said: re => log.some(entry => entry.text !== "" && re.test(entry.text)),
    lines: () => log.filter(entry => entry.text !== "").map(entry => `+${entry.at}ms "${entry.text}"`).join(" | ") || "(the line has said nothing)",
    until: async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; },
    button: (action, where = "") => document.querySelector(`.pfp-hub [data-action="${action}"]${where}`),
    off: el => el?.getAttribute("aria-disabled") === "true",
    focus: () => document.activeElement?.dataset?.focusKey ?? (document.activeElement === document.querySelector(".pfp-hub") ? "window" : document.activeElement?.tagName),
    // the text size labels (125%) are the one percentage the Hub shows, and only while the Display panel is open
    leaks: () => BAD.test(p.text().replace(/\b(100|125|150|175)%/g, "")),
    check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
    done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
  };
  globalThis.__p7 = p;
  // the recorder works: it sees a line we set (a throwaway element, removed again)
  const probe = Object.assign(document.createElement("div"), { className: "pfp-live", textContent: "recorder check" });
  document.body.append(probe);
  await p.until(() => p.said(/(^| \| )recorder check$/), 1000);
  p.check("the recorder sees a line (the test line)", p.said(/(^| \| )recorder check$/), p.lines());
  probe.remove();
  await new Promise(r => setTimeout(r, 50));
  log.length = 0; last = liveText();
  p.check("definitions are loaded", api.definitionsStatus().status === "ready", api.definitionsStatus().status);
  p.check("a player cannot set a track", await api.discovery.tracks.set("material:g7-a", { milestones: [{ steps: 1, grants: { type: "properties" } }] }).then(() => false, error => /GM only/.test(error.message)));
  return p.done();
})();
```

## Group A: leads, studies and milestones

## Step 4 [Player]: open the Hub, Research tab: leads from what you carry

Open the Hub (scene controls hourglass, or Gate Scholar's sheet), then click the **Research** tab. **What you should see:** on the left **Active projects**: **Study: Gate Page** (pill **Study**, the words **Getting somewhere**, no step boxes, no bar). Under **Leads you could follow**: **Gate Ore A** ("You carry Gate Ore A and haven't studied it yet."), **Gate Ore B** (the same) and **Gate Letter** ("You hold Gate Letter and haven't studied it yet."), each with a **Start researching** button. **Gate Plain is not listed** (it has no research track) and neither is Gate Page (already started). Nothing shows a number, a total, a DC, odds or "of".

**Send me a screenshot of the whole Research tab.**

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the Research tab is open", p.button("switch-tab", '[data-tab="research"]')?.getAttribute("aria-pressed") === "true");
  const names = p.api.research.leadsFor(p.scholar).map(l => l.name).sort().join();
  p.check("three leads, from the items carried", names === "Gate Letter,Gate Ore A,Gate Ore B", names);
  p.check("none is listed for Gate Plain or Gate Page", !/Gate Plain/.test(p.root().querySelector(".pfp-list")?.textContent ?? "") && p.api.research.leadsFor(p.scholar).every(l => !/Gate Page/.test(l.name)));
  p.check("the lead sentences", /You carry Gate Ore A and haven't studied it yet\./.test(p.text()) && /You hold Gate Letter and haven't studied it yet\./.test(p.text()));
  p.check("the study that is already under way, in words", /Study: Gate Page/.test(p.text()) && /Getting somewhere/.test(p.text()));
  p.check("no step boxes and no bar anywhere", p.root().querySelectorAll(".pfp-step, progress").length === 0);
  p.check("no number, DC, odds or percentage", !p.leaks() && !/\bProgress \d|\d+ of \d+|\bsteps?\b/i.test(p.text().replace(/Study: /g, "")), p.text().match(/.{0,30}(Progress \d|\d+ of \d+).{0,20}/)?.[0]);
  p.check("the player's definitions say a material HAS a study, not what it is", p.api.definitions.material.get("g7-a").hasTrack === true && p.api.definitions.material.get("g7-plain").hasTrack === false && !("research" in p.api.definitions.material.get("g7-a")));
  return p.done();
})();
```

## Step 5 [Player]: follow Gate Ore B and queue two checks

Click **Start researching** on **Gate Ore B**. **What you should see:** the line "**Research started: Study: Gate Ore B.**", a **Study: Gate Ore B** card (pill **Study**, **Just started**) selected, and in the detail "Studying this can teach you what it is good for, and perhaps more.", **Roll with**: Crafting, Nature, Arcana (Arcana may have no modifier if you are untrained). Your days did not change. Click **Crafting**, **One day more** once ("2 days (2 checks)"), then **Queue 2 checks**: "**2 checks queued on Study: Gate Ore B. 2 days reserved.**"

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the start line", p.said(/^Research started: Study: Gate Ore B\.$/), p.lines());
  p.check("the queue line", p.said(/^2 checks queued on Study: Gate Ore B\. 2 days reserved\.$/), p.lines());
  p.check("a Study card with a stage word and no counts", /Study: Gate Ore B[\s\S]*Study[\s\S]*(Just started|Getting somewhere)/.test(p.text()) && p.root().querySelectorAll(".pfp-step, progress").length === 0);
  p.check("the goal line", /Studying this can teach you what it is good for, and perhaps more\./.test(p.text()));
  const queued = p.scholar.getFlag(p.M, "pendingActions").filter(a => a.type === "research");
  p.check("one research item with two days is really queued", queued.length === 1 && queued[0].daysReserved === 2, JSON.stringify(queued.map(a => a.daysReserved)));
  p.check("the ledger holds no threshold", !/threshold|milestones/.test(JSON.stringify(p.scholar.getFlag(p.M, "discoveries"))));
  p.check("no number, DC, odds or percentage", !p.leaks());
  return p.done();
})();
```

## Step 6 [GM]: resolve the study (a real PF2e roll, in secret), then top it up so the milestone is reached

```js
// [GM] resolve the queued study with a real roll; then forced critical successes finish Gate Ore B's one milestone (properties), so this step does not depend on luck.
await (async () => {
  const g = globalThis.__g7 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const scholar = g.scholar();
  const action = g.queued(scholar, "research")[0];
  g.check("a research item is queued", Boolean(action));
  const out = await g.api.queue.resolve(scholar, action.id, { chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  if (!g.api.discovery.propertiesOpen(scholar, "g7-b")) await g.api.research.study({ actor: scholar, key: "material:g7-b", days: 2, skill: "crafting", degree: "criticalSuccess", chat: false });
  g.check("the properties milestone is reached", g.ledger(scholar)["material:g7-b"].reached.some(r => r.type === "properties") && g.api.discovery.propertiesOpen(scholar, "g7-b"));
  g.check("the chat about it is whispers with words only", game.messages.contents.filter(m => /Gate Ore B/.test(m.content ?? "")).every(m => Array.isArray(m.whisper) && m.whisper.length > 0 && !/\bDC\b|natural|total/.test(m.content)));
  g.check("the GM log has the totals and the DC", g.api.gm.log({ kind: "research" }).some(l => /Gate Ore B/.test(l.text) && /DC/.test(l.text)));
  return g.done();
})();
```

## Step 7 [Player]: what you know, craft options, locked materials and gold

Do not click anything first: the window follows by itself (give it a second). **What you should see:** open the **Compendium** tab, **Materials**. Click **Gate Ore B**: **What you know**: "**Gate ore: a theme of cowardice.**" and "**It works with frightened.**". Click **Gate Ore A**: **What you know**: "**You haven't studied this yet.**" (no theme). Then open the **Formulae** tab, **Gate Blade**, and look at the **Body** slot: it offers **Gate Ore B** ("worth 5 gp each") and **Gate Plain** ("worth 12 gp each"), and says "**Not open to you yet: Gate Ore A. You haven't studied it enough to craft with it.**" (Gate Ore A is not offered.) Pick **Gate Plain**: **What you will get** shows "**Materials are worth about 12 gp.**", "**Buying this in a shop would be about 24 gp.**" and "**You save about 24 gp.**"

**Send me a screenshot of the Gate Blade formula with Gate Plain picked.**

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the Formulae tab is open with Gate Blade", p.button("switch-tab", '[data-tab="formulae"]')?.getAttribute("aria-pressed") === "true" && /Gate Blade/.test(p.text()), "open Formulae, then Gate Blade first");
  p.check("Gate Ore B and Gate Plain are offered, with their worth", /Gate Ore B[\s\S]*worth 5 gp each/.test(p.text()) && /Gate Plain[\s\S]*worth 12 gp each/.test(p.text()));
  p.check("Gate Ore A is not offered, and the reason is plain", !p.root().querySelector('[data-action="pick-material"][data-material="g7-a"]') && /Not open to you yet: Gate Ore A\. You haven['’]t studied it enough to craft with it\./.test(p.text()));
  p.check("the gold lines", /Materials are worth about 12 gp\./.test(p.text()) && /Buying this in a shop would be about 24 gp\./.test(p.text()) && /You save about 24 gp\./.test(p.text()), "pick Gate Plain in the Body slot first");
  const refused = p.api.previewCraft(p.scholar, "g7-blade", { body: "g7-a" });
  p.check("the craft itself refuses Gate Ore A, first thing, in plain words (not only the screen)", refused.ok === false && refused.errors[0] === "You haven't studied Gate Ore A enough to craft with it yet.", JSON.stringify(refused.errors));
  p.check("what the properties teach: the tag and its theme, only for the studied one", p.api.definitions.tag.get("g7-ore")?.theme === "cowardice" && p.api.definitions.material.get("g7-b").tag === "g7-ore" && p.api.definitions.material.get("g7-a").tag === undefined);
  p.check("no DC, odds, percentage or pace", !p.leaks());
  return p.done();
})();
```

## Step 8 [GM]: finish Gate Ore A (a formula), and see the higher version become a lead

```js
// [GM] forced critical successes finish Gate Ore A (4 checks = 8 steps: properties, then the Gate Lantern formula). A and B are both understood and Gate Blade is known, so Gate Blade II should appear as a LEAD, not as a formula.
await (async () => {
  const g = globalThis.__g7 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const scholar = g.scholar();
  if (!g.ledger(scholar)["material:g7-a"]) await g.api.discovery.startStudy(scholar, "material:g7-a");
  await g.api.research.study({ actor: scholar, key: "material:g7-a", days: 4, skill: "crafting", degree: "criticalSuccess", chat: false });
  const a = g.ledger(scholar)["material:g7-a"];
  g.check("Gate Ore A is finished: properties, then a formula", a.status === "complete" && a.reached.map(r => r.type).join() === "properties,formula", JSON.stringify(a.reached));
  g.check("the formula milestone taught Gate Lantern", scholar.getFlag(g.M, "formulas").some(f => f.recipeId === "g7-lantern"));
  const lead = (scholar.getFlag(g.M, "leads") ?? []).find(l => l.recipeId === "g7-blade2");
  g.check("Gate Blade II is a lead with a plain note", Boolean(lead) && lead.source === "version" && /Gate ore materials/.test(lead.note), JSON.stringify(lead));
  g.check("it is NOT a formula yet (never an instant unlock)", !scholar.getFlag(g.M, "formulas").some(f => f.recipeId === "g7-blade2"));
  g.check("asking again changes nothing", (await g.api.discovery.refreshVersionLeads(scholar)).length === 0);
  return g.done();
})();
```

## Step 9 [Player]: the higher version is a lead you still have to research

Do not click anything first. Open the **Research** tab. **What you should see:** the lead **Gate Blade II** ("What you have learned about Gate ore materials shows how to make a better version."); **Gate Ore A** and **Gate Ore B** are gone from the leads (studied). Click **Start researching** on Gate Blade II: "**Research started: Study: Gate Blade II.**" and a **Study** card. Open **Formulae**: **Gate Lantern** is a known formula (Known pill); **Gate Blade II** is not.

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the start line", p.said(/^Research started: Study: Gate Blade II\.$/), p.lines());
  p.check("Gate Lantern is known, Gate Blade II is not", p.api.formulasFor(p.scholar).some(f => f.recipeId === "g7-lantern") && !p.api.formulasFor(p.scholar).some(f => f.recipeId === "g7-blade2"));
  p.check("the studied items are no longer leads", !p.api.research.leadsFor(p.scholar).some(l => /Gate Ore/.test(l.name)));
  p.check("no number, DC, odds or percentage", !p.leaks());
  return p.done();
})();
```

## Step 10 [GM]: finish Gate Blade II (its own track: 5 steps)

```js
// [GM] three forced critical successes: the thresholds set on THAT version (5 steps) decide.
await (async () => {
  const g = globalThis.__g7 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const scholar = g.scholar();
  await g.api.research.study({ actor: scholar, key: "recipe:g7-blade2", days: 3, skill: "crafting", degree: "criticalSuccess", chat: false });
  g.check("Gate Blade II is a formula now", scholar.getFlag(g.M, "formulas").some(f => f.recipeId === "g7-blade2"));
  g.check("the lead was used up", !(scholar.getFlag(g.M, "leads") ?? []).some(l => l.recipeId === "g7-blade2"));
  return g.done();
})();
```

## Step 11 [Player]: Put aside keeps a study's progress

Open the **Research** tab. Click **Study: Gate Page** (**Getting somewhere**), then **Put the study aside**. **What you should see:** "**Put aside? Your progress is kept.**" with **Keep** and **Confirm**; the focus ring is on **Keep**. Press **Confirm**: "**Put aside: Study: Gate Page. Your progress is kept.**" and the card is gone from the list; under the leads, **Gate Page** now says "**You've started studying Gate Page. Pick it up again whenever you like.**" with the button **Pick the study up again**. Press it: the study is back, still **Getting somewhere**.

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the put-aside line", p.said(/^Put aside: Study: Gate Page\. Your progress is kept\.$/), p.lines());
  p.check("the pick-up line", p.said(/^Research started: Study: Gate Page\.$/), p.lines());
  p.check("it is back, and still Getting somewhere", /Study: Gate Page[\s\S]*Getting somewhere/.test(p.text()));
  const entry = p.scholar.getFlag(p.M, "discoveries")?.items?.["note:g7-page"];
  p.check("the study is no longer paused after the pick-up (Foundry merges an update into what is stored, so this has to be false)", Boolean(entry) && !entry.paused && entry.status === "active", JSON.stringify(entry));
  p.check("and it is back under Active projects, not still offered as a lead", !p.api.research.leadsFor(p.scholar).some(l => l.id === "item:note:g7-page") && p.api.projectInfo(p.scholar).some(x => x.id === "study:note:g7-page"));
  p.check("nothing numeric on screen", !p.leaks() && p.root().querySelectorAll(".pfp-step, progress").length === 0);
  return p.done();
})();
```

## Group B: the GM's window, the relay, the keyboard

## Step 12 [GM]: the Discovery tracks window

Open it from the scene controls (the open-book button next to the Review button), or run `game.modules.get("pathfinder-progress").api.discovery.openEditor()`. **What to do and see:** pick **Gate Plain** (Materials, "No track yet"); press **Add the default track**: two rows, "Steps 4 / Properties" and "Steps 8 / A formula", with the message "Pick a formula that exists." and **Save** off. Choose **Gate Trinket** in the second row: the message goes and **Save** turns on. Change the second row's steps to **4**: "must be more than the milestone before it (4)" and **Save** is off again; set it to **10**. Press **Save**: "Saved the track for Gate Plain." and the item shows "has a track" and "edited here". Press **Use the definition's track**: back to "No track yet". Also open a Gate Ore A item sheet (give yourself one if needed) to see the header button, or skip.

**Send me a screenshot of the window with the two rows and a message showing.**

**Run the block below AFTER you have done the clicks above** (it needs the window to have saved and cleared once). It then saves a track on Gate Plain on purpose, so **Gate Plain is left with a track and is locked for crafting** from here on (Steps 13 and 16 rely on that).

```js
// [GM] after the clicks above: the overlay was written and cleared; a player cannot read it (GM only); the Player's copy of Gate Plain learns THAT a track exists once one is saved (checked in Step 13).
await (async () => {
  const g = globalThis.__g7 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  g.check("the overlay is empty again after Use the definition's track", Object.keys(g.api.discovery.tracks.overlay()).every(k => !/g7-plain/.test(k)), JSON.stringify(g.api.discovery.tracks.overlay()));
  await g.api.discovery.tracks.set("material:g7-plain", { milestones: [{ steps: 3, grants: { type: "properties" } }] });
  g.check("saving through the api writes the overlay", g.api.discovery.tracks.overlay()["material:g7-plain"]?.milestones[0].steps === 3);
  await g.api.publishDefinitions();
  g.check("a bad track is refused in plain words", await g.api.discovery.tracks.set("material:g7-plain", { milestones: [{ steps: 5, grants: { type: "properties" } }, { steps: 3, grants: { type: "formula", recipeId: "g7-charm" } }] }).then(() => false, e => /more than the milestone before it/.test(e.message)));
  return g.done();
})();
```

## Step 13 [Player]: the relay audit (nothing the GM keeps to themselves reaches you)

Nothing to click. **What you should see:** `ALL PASS` from the block: your copy of the definitions holds no track, class table or threshold, and the Gate Plain study the GM saved in Step 12 shows up only as "it has a study".

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  await p.api.definitions.refresh({ force: true });
  const mats = [...p.api.definitions.material.values()], notes = [...p.api.definitions.note.values()], recipes = [...p.api.definitions.recipe.values()];
  p.check("no track, class table, milestone or threshold in anything you hold", !/milestones|steps|research|classEffects|requiresTag|requiresCount|family/.test(JSON.stringify([mats, notes, recipes])));
  p.check("the gold value came through", mats.find(m => m.id === "g7-plain")?.value === 12);
  p.check("Gate Plain now says it has a study (the GM saved one), without saying what", p.api.definitions.material.get("g7-plain").hasTrack === true && p.api.definitions.material.get("g7-plain").tag === undefined);
  p.check("the overlay is not readable through the api", await Promise.resolve().then(() => p.api.discovery.tracks.overlay()).then(() => false, e => /GM only/.test(e.message)));
  return p.done();
})();
```

## Step 14 [Player]: keyboard only, and a narrow window

Click on blank space inside the Hub. Press **Tab**: the first ring lands on **Display**. On the **Research** tab Tab to a card, a skill, **One day more**, and the study's **Put the study aside**: **Enter** opens the confirm with the ring on **Keep**; Enter on Keep closes it. Then open **Display**, choose **175%** and drag the window to its minimum width (about 300px). **What you should see (look at the screen; the browser hides focus rings while the console has the focus):** every control you land on shows a clear ring; the two panes stack; the study card, the lead cards, "What you know", the gold lines and the "Not open to you yet" sentence wrap and never overlap; badges (Study, Queued) are never split; nothing is cut off at the right edge.

**Send me a screenshot of the Research tab and of the Formulae tab with Gate Ore B picked (not Gate Plain: it is locked after Step 12), at that size.**

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const frame = p.root().closest(".application");
  const width = frame.getBoundingClientRect().width;
  p.check("the window is at least about 300px wide", width >= 299, width);
  p.check("the layout is the stacked one", p.root().dataset.layout === "narrow", p.root().dataset.layout);
  p.check("nothing is wider than the window", p.root().scrollWidth <= p.root().clientWidth + 1, `${p.root().scrollWidth} > ${p.root().clientWidth}`);
  return p.done();
})();
```

## Group C: with no GM connected

## Step 15 [GM]: log out (or close the GM tab) now

**First**, in the Player window, open the **Research** tab and press **Start researching** on **Gate Letter** while the GM is still connected, so there is an active **Study: Gate Letter** for the next step. **Then** close the GM window so that **no GM is connected**. Do not run CLEANUP yet. (Leave the Player window open.)

## Step 16 [Player]: each action says what it was trying to do

**What to do** (the GM window stays closed): open the **Compendium** tab, **Materials**, **Gate Plain** and press **Share with the party**: the line is "**Couldn't share this: The GM isn't connected right now, so this can't be done yet.**" Then open the **Research** tab and press **Start researching** on **Gate Plain** (it is a lead since Step 12 gave it a track): "**Couldn't start researching: The GM isn't connected right now, so this can't be done yet.**" Then click **Study: Gate Letter** (started in Step 15), press **Put the study aside** and **Confirm**: "**Couldn't put this aside: ...**" (the same reason). Finally, on that study, pick Crafting and press **Queue 1 check**: this one WORKS ("1 check queued ..."), because a player writes their own research queue; the GM will resolve it later. Nothing says "Couldn't queue the craft" except a real craft.

```js
await (async () => {
  const p = globalThis.__p7 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const reason = "The GM isn't connected right now, so this can't be done yet.";
  p.check("share", p.said(new RegExp(`^Couldn't share this: ${reason.replace(/[.']/g, "\\$&")}$`)), p.lines());
  p.check("start researching", p.said(new RegExp(`^Couldn't start researching: ${reason.replace(/[.']/g, "\\$&")}$`)), p.lines());
  p.check("put aside", p.said(new RegExp(`^Couldn't put this aside: ${reason.replace(/[.']/g, "\\$&")}$`)), p.lines());
  p.check("a research check was queued without the GM", p.said(/^1 check queued on /), p.lines());
  p.check("none of them says it was trying to queue a craft", !p.said(/Couldn't queue the craft/), p.lines());
  return p.done();
})();
```

## Step 17 [GM]: log back in, then CLEANUP (always run this, even if a step failed)

Log the GM back in, wait for the world, and run this. It deletes everything the gate made, puts back what it changed, and clears the tracks. Safe to run twice.

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Scholar", "Gate Friend"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway7") === true);
  const ids = actors.map(a => a.id);
  const user = game.users.getName("Test");
  await attempt("queue", async () => { for (const row of api.queue.list().filter(r => ids.includes(r.actorId))) await api.queue.reject(game.actors.get(row.actorId), row.action.id, { chat: false }); });
  await attempt("party location", async () => {
    const original = user?.getFlag(M, "gateOriginalLocation7");
    if (original !== undefined) { await game.settings.set(M, "partyLocation", original); await user.unsetFlag(M, "gateOriginalLocation7"); }
  });
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the Discovery tracks", async () => { for (const key of Object.keys(api.discovery.tracks.overlay()).filter(k => /:g7-/.test(k))) await api.discovery.tracks.clear(key); });
  await attempt("audit ledger", async () => {
    const ledger = api.audit.ledger();
    for (const id of ids) delete ledger[id];
    if (ledger._events) ledger._events.history = ledger._events.history.filter(h => !/Gate /.test(h.text));
    await game.settings.set(M, "auditLedger", ledger);
  });
  await attempt("Test's character", async () => {
    const original = user?.getFlag(M, "gateOriginalCharacter7");
    if (!user || original === undefined) return;
    await user.update({ character: original !== "none" && game.actors.get(original) ? original : null });
    await user.unsetFlag(M, "gateOriginalCharacter7");
  });
  for (const actor of actors) await attempt(`delete ${actor.name}`, () => actor.delete());
  for (const [kind, id] of [["note", "g7-letter"], ["note", "g7-page"], ["recipe", "g7-trinket"], ["recipe", "g7-charm"], ["recipe", "g7-lantern"], ["recipe", "g7-blade2"], ["recipe", "g7-blade"], ["material", "g7-plain"], ["material", "g7-b"], ["material", "g7-a"], ["tag", "g7-ore"], ["town", "g7-town"]]) api.definitions[kind].delete(id);
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  api.gm.clearLog();
  delete globalThis.__g7;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, tracksLeft: Object.keys(api.discovery.tracks.overlay()).filter(k => /:g7-/.test(k)).length, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `downtimeOpen: false`, `tracksLeft: 0` and the audit list empty. In the Player window, run `delete globalThis.__p7` (or just reload).
