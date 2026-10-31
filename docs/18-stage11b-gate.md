# 18 Stage 11b round gate (real Foundry): the Research and Compendium tabs, and leads (v0.20.0)

Run in a real world, with a **GM window** and an **incognito Player window logged in as the user "Test"**. Every step is labelled **[GM]** or **[Player]** and has ONE code block. **[Player] steps tell you what to click; the block then checks what is on screen.** The blocks can be run at any time: the helper in Step 3 records every line the Hub's status line shows (they vanish after about 10 seconds), and the blocks read that record. Blocks print `PASS:` / `FAIL:` lines and end with `ALL PASS`: paste back anything that is not `ALL PASS`. Where a step says **"send me a screenshot of ..."**, layout is the point. Do a group at a time.

`tests/gate18.test.js` plays every step against the real `main.js` in a fake Foundry with a real DOM and the strict ApplicationV2 stand-in (it clicks what the steps tell you to click, then runs the block). What it cannot show: the real window, fonts, focus rings, real PF2e rolls and the real Tab key.

**What the gate shows** (the decisions of the Stage 11b round plan):
- **Research tab:** your projects as step boxes ("Progress 3 of 8", a bar beyond 20 steps), "Roll with" skills with your own sheet modifier (never odds), days you spend (one check per day), Queue N checks, Cancel, the GM resolving in secret, recent checks in plain words (a GM's free-text note never shows), **Put the project aside** with a Confirm step ("Progress is not kept"), and **leads** (a GM hands you one; you press Start researching). "Open in Research" on the Formulae tab jumps to the project. No DC, no odds, no percentage, no pace line.
- **Compendium tab:** Materials, Creatures, Regions, Experiments, only what you experienced (no "???"), Share with the party (Only you / Queued / Shared), Cancel while queued, the GM approves, the party reads it. A rejected share is whispered to its owner and the GM, never posted publicly (Steps 20 to 22, the GM rejects it in the queue window).
- **Keyboard and narrow window** for both tabs.
- Not shown, on purpose: there is no "Not shared" line when a GM rejects a share. The Hub cannot tell a rejection from any other removal, so a rejected share just goes back to "Only you".

**Safety.** Throwaway things named "Gate ...": characters **Gate Scholar** and **Gate Friend** (both owned by the user "Test"), and in-memory fake definitions (`gate-wolf` and `g6-field` in the Compendium, and `g6-town`, `g6-ore`, `g6-steel`, `g6-ember`, `g6-star`, `g6-blade`, `g6-draught`, `g6-giant`, `g6-lantern`); they last until you reload the GM window, and SETUP registers them again. No real campaign data. SETUP refuses to run if downtime is open, anything is queued, someone holds downtime days, a "Gate ..." actor exists that it did not make, or an earlier run left something behind. CLEANUP always works and is safe to run twice.

**Restart note.** 0.19.0 to 0.20.0 change nothing in the manifest but the version (0.19.0 registered a new socket handler in code), so updating the module and force-reloading both windows (Ctrl+Shift+R) is enough.

## Step 1 [GM] and [Player]: force-reload, then check who and what version you are

Force-reload BOTH windows first and wait for the world to finish loading. The version must be **0.20.0**; if it is not, stop (the release may still be building).

```js
[game.user.name, game.user.isGM, game.modules.get("pathfinder-progress").version]
```

Expected: `["<your GM name>", true, "0.20.0"]` in the GM window and `["Test", false, "0.20.0"]` in the Player window.

## Step 2 [GM]: SETUP

Safe to run again at any time (after a reload of the GM window it re-registers the fakes and rebuilds `globalThis.__g6`).

```js
// [GM] SETUP: fake definitions (memory only); Gate Scholar (holds g6-blade, researching g6-draught 3 of 8 and g6-giant 17 of 40, one lead for g6-lantern, a small Compendium) + Gate Friend; 12 days of downtime.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const test = game.users.getName("Test");
  if (!game.user.isGM || !test) throw new Error('Run this in the GM window, and the user "Test" must exist');
  const mine = doc => !doc || doc.getFlag(M, "gateThrowaway6") === true;
  const [scholarOld, friendOld] = [game.actors.getName("Gate Scholar"), game.actors.getName("Gate Friend")];
  if (![scholarOld, friendOld].every(mine)) throw new Error('"Gate Scholar" or "Gate Friend" already exists and was not made by this check; rename or delete it first');

  const [dagger] = await api.adapter.findItemUuid("Dagger");
  if (!dagger) throw new Error('could not find "Dagger" in the PF2e equipment compendium');
  const common = { kind: "recipe", category: "weapon", output: { 1: dagger, 2: dagger, 3: dagger, 4: dagger, 5: dagger }, craftLevel: 2, stationCategory: "smithing", stationTierMin: 1, skillWhitelist: ["crafting"], researchProject: { tier: 1 } };
  const one = [{ name: "base", drives: "basePower", tierFloor: 1, qty: 1 }];
  const defs = [
    ["town", { kind: "town", id: "g6-town", name: "Gate Town" }],
    ["material", { kind: "material", id: "g6-ore", name: "Gate Ore", tier: 1, effects: { basePower: "T1" } }],
    ["material", { kind: "material", id: "g6-steel", name: "Gate Steel", tier: 2, effects: { basePower: "T2", bonusDamage: { dice: "1d4", type: "fire" } } }],
    ["material", { kind: "material", id: "g6-ember", name: "Gate Ember", tier: 2, effects: { bonusDamage: { dice: "1d6", type: "fire" } } }],
    ["material", { kind: "material", id: "g6-star", name: "Gate Star", tier: 3, effects: { basePower: "T3", bonusDamage: { dice: "1d8", type: "spirit" } } }],
    ["recipe", { ...common, id: "g6-blade", name: "Gate Blade", slots: [{ name: "body", drives: "basePower", tierFloor: 1, qty: 1 }, { name: "edge", drives: "bonusDamage", tierFloor: 2, qty: 1 }] }],
    ["recipe", { ...common, id: "g6-draught", name: "Gate Draught", skillWhitelist: ["crafting", "nature"], slots: one }],
    ["recipe", { ...common, id: "g6-giant", name: "Gate Giant", researchProject: { tier: 5 }, slots: one }],
    ["recipe", { ...common, id: "g6-lantern", name: "Gate Lantern", slots: one }]
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
      M, api, ids, smith: () => game.actors.get(ids.smith), friend: () => game.actors.get(ids.friend),
      queued: (actor, type) => (actor.getFlag(M, "pendingActions") ?? []).filter(a => !type || a.type === type),
      check: (label, ok, detail) => rows.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : ` (${detail})`}`),
      done: () => { console.log(rows.join("\n")); const bad = rows.filter(r => r.startsWith("FAIL")).length; rows.length = 0; return bad ? `${bad} FAILED: scroll up for the lines` : "ALL PASS"; }
    };
    globalThis.__g6 = g;
    return g;
  };
  if (scholarOld || friendOld) {
    if (!(scholarOld && friendOld)) throw new Error("part of the gate is missing (a character was deleted): run CLEANUP (the last step), then SETUP again");
    build({ smith: scholarOld.id, friend: friendOld.id });
    return { already: "set up", rebuilt: "the definitions and globalThis.__g6", published: await api.publishDefinitions() };
  }
  if (api.downtime.isOpen()) throw new Error("downtime is already open; end it first");
  if (api.queue.list().length) throw new Error("the queue is not empty; resolve or clear it first");
  const holders = game.actors.filter(a => (a.getFlag(M, "downtimeDays") ?? 0) > 0).map(a => a.name);
  if (holders.length) throw new Error(`these characters hold downtime days: ${holders.join(", ")}`);
  const shared = game.settings.get(M, "sharedCompendium") ?? {};
  if (["experiments", "materials", "creatures", "regions"].some(k => Object.keys(shared[k] ?? {}).some(id => /^(g6-|gate-)/.test(id)))) throw new Error("an earlier run left shared Compendium entries: run CLEANUP (the last step) first");
  const published = await api.publishDefinitions();

  const flags = { [M]: { gateThrowaway6: true } };
  const owned = { default: 0, [test.id]: 3 };
  const scholar = await Actor.create({ name: "Gate Scholar", type: "character", ownership: owned, flags });
  const friend = await Actor.create({ name: "Gate Friend", type: "character", ownership: owned, flags });
  await api.grantFormula(scholar, "g6-blade");                 // owning a formula reveals its baseline (what the cheapest materials make)
  const waitFor = async fn => { const end = Date.now() + 6000; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
  if (!await waitFor(() => scholar.getFlag(M, "compendium")?.experiments?.["g6-blade"]?.baseline)) throw new Error("the baseline of Gate Blade was not revealed");
  const draught = await api.startProject({ actor: scholar, recipe: "g6-draught" });
  const giant = await api.startProject({ actor: scholar, recipe: "g6-giant" });
  await api.addProgress(scholar, draught.id, 3, "gate setup", { chat: false });
  await api.addProgress(scholar, giant.id, 17, "gate setup", { chat: false });
  await api.research.giveLead(scholar, "g6-lantern", "A glassblower in Gate Town mentioned it.");
  // A small Compendium, written directly (what the gate checks is how the Hub shows and shares it).
  const book = scholar.getFlag(M, "compendium"), now = Date.now();
  book.materials = {
    "g6-ore": { id: "g6-ore", name: "Gate Ore", tier: 1, firstAt: now - 4, places: [{ key: "region:g6-field", label: "Gate Field" }], rungs: [{ nodeType: "g6-bush", tier: 1, rung: "base" }, { nodeType: "g6-bush", tier: 1, rung: "higher" }] },
    "g6-star": { id: "g6-star", name: "Gate Star", tier: 3, firstAt: now - 3, places: [], rungs: [] }
  };
  book.creatures = { "gate-wolf": { key: "gate-wolf", name: "Gate Wolf", type: "beast", firstAt: now - 4, yields: [{ materialId: "g6-fang", name: "Gate Fang" }] } };
  book.regions = { "g6-field": { id: "g6-field", name: "Gate Field", firstAt: now - 4, nodeTypes: [{ id: "g6-bush", name: "Gate Bush" }] } };
  book.experiments["g6-blade"].slots = { edge: { "g6-star": { materialId: "g6-star", materialName: "Gate Star", tier: 3, effects: { bonusDamage: { dice: "1d8", type: "spirit" } }, at: now - 2 } } };
  await scholar.setFlag(M, "compendium", book);
  await test.setFlag(M, "gateOriginalLocation6", game.settings.get(M, "partyLocation") ?? "");
  await api.setLocation("g6-town");
  await test.setFlag(M, "gateOriginalCharacter", test.character?.id ?? "none");
  await test.update({ character: scholar.id });
  await api.downtime.start({ days: 12, actorIds: [scholar.id, friend.id] });
  build({ smith: scholar.id, friend: friend.id });
  return { scholar: scholar.name, friend: friend.name, published, testUsersCharacter: game.users.getName("Test").character?.name };
})();
```

Expected: an object naming Gate Scholar and Gate Friend, `testUsersCharacter: "Gate Scholar"` and a `published` revision. On a rerun it says `already: "set up"`.

## Step 3 [Player]: the helper (and what a Player can read before the Hub is even open)

```js
// [Player] helper for the next steps (lost on reload; run it again). Nothing here changes anything except a recorder that only listens.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const scholar = game.actors.getName("Gate Scholar"), friend = game.actors.getName("Gate Friend");
  if (game.user.isGM || !scholar?.isOwner || !friend?.isOwner) throw new Error('Player window as the user "Test" only, after the GM ran SETUP');
  await api.definitions.refresh();
  // The recorder: every distinct text of the line under the buttons (.pfp-live), with the time, from now on. It survives the Hub being closed and reopened
  // (it watches the whole page) and is replaced if this helper is run again. Result lines disappear after about 10 seconds; the recorder keeps them.
  globalThis.__p6rec?.observer.disconnect();
  const log = [], started = Date.now();
  let last = "";
  const liveText = () => [...document.querySelectorAll(".pfp-live")].map(el => el.textContent).filter(Boolean).join(" | ");
  const note = () => { const text = liveText(); if (text !== last) { last = text; log.push({ at: Date.now() - started, text }); } };
  const observer = new MutationObserver(note);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  globalThis.__p6rec = { observer, log };
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
  globalThis.__p6 = p;
  // the recorder works: it sees a line we set (a throwaway element, removed again)
  const probe = Object.assign(document.createElement("div"), { className: "pfp-live", textContent: "recorder check" });
  document.body.append(probe);
  await p.until(() => p.said(/^recorder check$/), 1000);
  p.check("the recorder sees a line (the test line)", p.said(/^recorder check$/), p.lines());
  probe.remove();
  await new Promise(r => setTimeout(r, 50));
  log.length = 0; last = liveText();
  p.check("definitions are loaded", api.definitionsStatus().status === "ready", api.definitionsStatus().status);
  p.check("a project, as the player gets it, has no DC", api.projectInfo(scholar, "unlock-g6-draught").project.dc === undefined);
  p.leadId = api.research.leads(scholar)[0]?.id;     // Step 10 tries this lead a second time
  p.check("a player cannot hand out leads", await api.research.giveLead(scholar, "g6-lantern", "x").then(() => false, error => /GM/.test(error.message)));
  return p.done();
})();
```

## Group A: the Research tab

## Step 4 [Player]: open the Hub and the Research tab

Open the Hub (scene controls hourglass, or Gate Scholar's sheet), then click the **Research** tab. **What you should see:** on the left **Active projects**: **Gate Draught** (Formula, eight step boxes, three filled, "Progress 3 of 8") and **Gate Giant** (Formula, a bar, "Progress 17 of 40"); under them **Leads you could follow**: **Gate Lantern** with "A glassblower in Gate Town mentioned it." and a **Start researching** button. On the right: "Pick a project on the left." Nothing says DC, odds, a percentage or "days to finish".

**Send me a screenshot of the whole Research tab.**

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the Research tab is open", p.button("switch-tab", '[data-tab="research"]')?.getAttribute("aria-pressed") === "true");
  p.check("both projects are listed", /Active projects/.test(p.text()) && /Gate Draught/.test(p.text()) && /Gate Giant/.test(p.text()));
  p.check("with their progress in words", /Progress 3 of 8/.test(p.text()) && /Progress 17 of 40/.test(p.text()));
  p.check("eight step boxes, three filled, for the small one; a bar for the big one", p.root().querySelectorAll(".pfp-step").length === 8 && p.root().querySelectorAll(".pfp-step.is-done").length === 3 && Boolean(p.root().querySelector("progress")));
  p.check("the lead and its button", /Gate Lantern/.test(p.text()) && /A glassblower in Gate Town mentioned it\./.test(p.text()) && Boolean(p.button("follow-lead")));
  p.check("nothing is selected yet", /Pick a project on the left\./.test(p.text()));
  const projects = p.api.projectInfo(p.scholar).filter(x => x.status === "active");
  p.check("two projects", projects.map(x => x.goalName).sort().join() === "Gate Draught,Gate Giant", projects.map(x => x.goalName).join());
  p.check("one lead", p.api.research.leads(p.scholar).length === 1 && p.api.research.leads(p.scholar)[0].name === "Gate Lantern");
  p.check("no DC, odds, percentage, pace or difficulty wording", !p.leaks());
  return p.done();
})();
```

## Step 5 [Player]: queue three checks

Click **Gate Draught**. **What you should see:** "Finishing teaches you the formula for Gate Draught."; **Roll with**: **Crafting** and **Nature**, each with "Your modifier +N" (your sheet's own number, never odds); the **Queue 1 check** button is dashed (off) with "Choose a skill to roll with first." Click **Crafting** (it gets a **SELECTED** badge). Click **One day more** twice: "**3 days (3 checks)**". Click **Queue 3 checks**.

**What you should see now:** a line at the bottom "**3 checks queued on Gate Draught. 3 days reserved.**"; the status strip says **9 free, 3 reserved** and **1 queued**; the Gate Draught card has a **Queued** badge; the detail says "**Queued: 3 checks, 3 days reserved. The GM rolls them in secret.**" with **Cancel and get the days back**; **Queue** is off ("You already have checks queued on this...") and **Put the project aside** is off ("Cancel the queued checks first, then put it aside.").

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const g = p.scholar.getFlag(p.M, "pendingActions") ?? [];
  p.check("the live line said what was queued", p.said(/^3 checks queued on Gate Draught\. 3 days reserved\.$/), p.lines());
  p.check("the strip shows 9 free, 3 reserved and 1 queued", /9 free, 3 reserved/.test(p.text()) && /1 queued/.test(p.text()));
  p.check("the detail says the GM rolls them in secret, with Cancel", /Queued: 3 checks, 3 days reserved\. The GM rolls them in secret\./.test(p.text()) && Boolean(p.button("cancel-queued")));
  p.check("Queue and Put aside are off, with their reasons", p.off(p.button("queue-research")) && p.off(p.button("put-aside")) && /You already have checks queued on this/.test(p.text()) && /Cancel the queued checks first, then put it aside\./.test(p.text()));
  p.check("one research item with three days is really queued", g.length === 1 && g[0].type === "research" && g[0].daysReserved === 3, JSON.stringify(g.map(a => [a.type, a.daysReserved])));
  p.check("no DC, odds, percentage or pace", !p.leaks());
  return p.done();
})();
```

## Step 6 [GM]: resolve it (a real PF2e roll, in secret)

```js
// [GM] resolve the queued research. PF2e rolls three checks on this client; the player is told degree words only.
await (async () => {
  const g = globalThis.__g6 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const scholar = g.smith();
  const action = g.queued(scholar, "research")[0];
  g.check("a research item is queued", Boolean(action));
  const out = await g.api.queue.resolve(scholar, action.id, { chat: true });
  g.check("it resolved", out.status === "resolved", out.message);
  const log = g.api.gm.log({ kind: "research" });
  g.check("the GM log has the totals and the DC (no chat message does)", log.length >= 1 && /vs DC/.test(log[0].text), log[0]?.text);
  return g.done();
})();
```

## Step 7 [Player]: the window followed by itself (do not click anything first)

**What you should see within a second or two:** the bottom line is gone; the strip says **Nothing queued** and the days left (the unused ones come back if it finished early); the Gate Draught progress moved; **Recent checks** lists up to three lines like "**Research check: Success (+1)**" (degree words and the progress change, nothing else).

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the queued line went away by itself", p.live() === "", p.live());
  p.check("Nothing queued", /Nothing queued/.test(p.text()));
  p.check("recent checks are in plain words", /Recent checks/.test(p.text()) && /Research check: (Critical )?(Success|Failure|failure)/.test(p.text()) && /\((\+\d|no progress)\)/.test(p.text()), p.text().match(/Recent checks.{0,160}/)?.[0]);
  const mine = game.messages.contents.filter(m => /researches/.test(m.content ?? ""));
  p.check("the chat about it has degree words only; no message at all carries a DC or a total", mine.length >= 1 && game.messages.contents.every(m => !/vs DC|\bDC\b|natural \d|d20=|total \d/.test(m.content ?? "")));
  p.check("no DC, odds, percentage or pace on screen", !p.leaks());
  return p.done();
})();
```

## Step 8 [Player]: queue one check and cancel it

Make sure Crafting is still selected and click **Queue 1 check** (**One day fewer** first if it says more). Then click **Cancel and get the days back**. **What you should see:** the line "**Cancelled: Research: Gate Draught. Your days and materials are back.**" and **Nothing queued**.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the cancel line was shown", p.said(/^Cancelled: Research: Gate Draught\. Your days and materials are back\.$/), p.lines());
  p.check("nothing queued and nothing reserved", /Nothing queued/.test(p.text()) && /, 0 reserved/.test(p.text()) && (p.scholar.getFlag(p.M, "pendingActions") ?? []).length === 0);
  return p.done();
})();
```

## Step 9 [Player]: put a project aside (with the confirm step)

Click the **Gate Giant** card, then **Put the project aside**. **What you should see:** the button is replaced by "**Put aside? Progress is not kept.**" with **Keep** and **Confirm**, and the **focus ring is on Keep**. Press **Keep** (Enter or Space works): the confirm goes away and the ring is back on **Put the project aside**. Press Put the project aside again, then **Confirm**. **What you should see:** the line "**Put aside: Gate Giant. Progress was not kept.**", Gate Giant gone from the list, and the focus ring on the window (not on a button, and not on the page behind).

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the line said progress was not kept", p.said(/^Put aside: Gate Giant\. Progress was not kept\.$/), p.lines());
  p.check("Gate Giant is gone from the list", !/Gate Giant/.test(p.root().querySelector(".pfp-list")?.textContent ?? ""));
  p.check("it is really put aside", !p.api.projectInfo(p.scholar).some(x => x.goalName === "Gate Giant" && x.status === "active"));
  p.check("focus is on the window itself", p.focus() === "window", p.focus());
  return p.done();
})();
```

## Step 10 [Player]: follow the lead

Click **Start researching** on **Gate Lantern**. **What you should see:** "**Research started: Gate Lantern.**"; a **Gate Lantern** card (Progress 0 of 8) selected, with the focus ring on it; and the leads area now says "**No leads yet.**" and "Leads show up here when someone points you at a formula you could research."

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the line was shown", p.said(/^Research started: Gate Lantern\.$/), p.lines());
  p.check("the new project is selected and has focus", p.root().querySelector('[data-action="select-project"][aria-pressed="true"]')?.textContent.includes("Gate Lantern") && p.focus() === "project:unlock-g6-lantern", p.focus());
  p.check("Progress 0 of 8", /Progress 0 of 8/.test(p.text()));
  p.check("the lead is used up", /No leads yet\./.test(p.text()) && /Leads show up here when someone points you at a formula you could research\./.test(p.text()));
  p.check("the project exists, without a DC for the player", p.api.projectInfo(p.scholar, "unlock-g6-lantern").project.dc === undefined);
  const again = await p.api.research.follow(p.scholar, p.leadId).then(() => null, error => error.message);
  p.check("following the same lead a second time is refused, in plain words", typeof again === "string" && again.length > 10 && !/\bDC\b|%|odds/i.test(again), again);
  return p.done();
})();
```

## Step 11 [Player]: "Open in Research" from the Formulae tab

Click the **Formulae** tab. You should see researching cards for Gate Draught and Gate Lantern, each with **Open in Research** (a live button now). Click it on **Gate Draught**. **What you should see:** you are on the **Research** tab with **Gate Draught** selected and the focus ring on its card.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the Research tab is open", p.button("switch-tab", '[data-tab="research"]')?.getAttribute("aria-pressed") === "true");
  p.check("Gate Draught is selected", p.root().querySelector('[data-action="select-project"][aria-pressed="true"]')?.textContent.includes("Gate Draught"));
  p.check("focus is on its card", p.focus() === "project:unlock-g6-draught", p.focus());
  return p.done();
})();
```

## Step 12 [GM]: close downtime

```js
// [GM] end the period (nothing is queued, so it ends cleanly).
await (async () => {
  const g = globalThis.__g6 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const result = await g.api.downtime.end({});
  g.check("downtime ended", !g.api.downtime.isOpen(), JSON.stringify(result));
  return g.done();
})();
```

## Step 13 [Player]: closed, but still browsable (do not click first)

**What you should see:** the notice "Downtime isn't open right now." in the strip; **Queue** is off with that reason; you can still click around; **Put the project aside** still works (it needs no downtime), so do not press it.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the notice", /Downtime isn't open right now\./.test(p.text()));
  p.check("Queue is off with that reason", p.off(p.button("queue-research")) && /Downtime isn't open right now/.test(document.querySelector(".pfp-hub #why-research")?.textContent ?? ""));
  p.check("Put aside is NOT off", p.button("put-aside") && !p.off(p.button("put-aside")));
  return p.done();
})();
```

## Step 14 [GM]: open downtime again

```js
// [GM] back to both characters with 12 days.
await (async () => {
  const g = globalThis.__g6 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  for (const actor of [g.smith(), g.friend()]) await g.api.setDays(actor, 0);
  await g.api.downtime.start({ days: 12, actorIds: [g.smith().id, g.friend().id] });
  g.check("open for both with 12 days", Object.keys(g.api.downtime.state().participants).length === 2 && g.api.days(g.smith()) === 12);
  return g.done();
})();
```

## Group B: the Compendium tab

## Step 15 [Player]: the categories

Click the **Compendium** tab. **What you should see:** **Materials 2**, **Creatures 1**, **Regions 1**, **Experiments 1**, the line "**5 entries discovered. New ones appear as you find them.**", and in Materials **Gate Ore** and **Gate Star**, each with the word **Only you**. Click each category in turn. Nothing says "???".

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the Compendium tab is open", p.button("switch-tab", '[data-tab="compendium"]')?.getAttribute("aria-pressed") === "true");
  p.check("the four categories with their counts", /Materials 2/.test(p.text()) && /Creatures 1/.test(p.text()) && /Regions 1/.test(p.text()) && /Experiments 1/.test(p.text()));
  p.check("the count line", /5 entries discovered\. New ones appear as you find them\./.test(p.text()));
  p.check("no placeholder anywhere", !/\?\?\?/.test(p.text()));
  p.check("no DC, odds, percentage or pace", !p.leaks());
  return p.done();
})();
```

## Step 16 [Player]: what each entry says

Click **Gate Ore**: "Tier 1"; **Where you found it**: Gate Field; **How you gathered it**: "a basic find" and "a better find" (no numbers); **Used in**: Gate Blade. Click **Gate Star**: "No places recorded yet.", "You haven't gathered it from a node yet.", "None of your formulae use it yet." Click **Creatures**, **Gate Wolf**: "Type: beast" and Gate Fang. **Regions**, **Gate Field**: Gate Bush. Finally **Experiments**, **Gate Blade**, and leave it open.

**What you should see for the experiment:** **What the cheapest materials make**: "A tier 1 result", "Blade needs tier 1 or higher", "Gate Ore sets the weapon's power (tier 1)", "Uses Gate Ore", "Edge needs tier 2 or higher", "A material you have not met adds +1d6 fire damage"; and **What you have learned**: "**Edge, Gate Star** (you crafted it)" with "Gate Star adds +1d8 spirit damage". Nothing about Gate Steel (you have not met it).

**Send me a screenshot of the Gate Blade entry.**

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  if (!p.root() || !p.text().includes("What the cheapest materials make")) { p.check("open Compendium, then Experiments, then Gate Blade first", false); return p.done(); }
  p.check("the baseline", /What the cheapest materials make/.test(p.text()) && /A tier 1 result/.test(p.text()) && /Gate Ore sets the weapon['’]s power \(tier 1\)/.test(p.text()) && /Edge needs tier 2 or higher/.test(p.text()));
  p.check("an unmet material is not named", /A material you have not met adds \+1d6 fire damage/.test(p.text()) && !/Gate Steel|Gate Ember/.test(p.text()));
  p.check("what you learned, in the craft form's words", /What you have learned/.test(p.text()) && /Edge, Gate Star/.test(p.text()) && /\(you crafted it\)/.test(p.text()) && /Gate Star adds \+1d8 spirit damage/.test(p.text()));
  p.check("no placeholder, no DC, odds or percentage", !/\?\?\?/.test(p.text()) && !p.leaks());
  return p.done();
})();
```

## Step 17 [Player]: share two entries

Click **Materials**, **Gate Ore**, then **Share with the party**. **What you should see:** the line "**Share queued: Gate Ore. Waiting for the GM.**", the pill says **Queued**, "Waiting for the GM to approve sharing it.", and the strip says **1 queued**. Click **Cancel the share**: "**Share cancelled: Gate Ore. It stays private.**" and the pill goes back to **Only you**. Now share **Gate Ore** again and also **Gate Star**. **Share ONLY Gate Ore and Gate Star** (not the creature or the region: Gate Wolf has a step of its own, below).

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const shares = (p.scholar.getFlag(p.M, "pendingActions") ?? []).filter(a => a.type === "share");
  p.check("the line said the share was queued, then cancelled", p.said(/^Share queued: Gate Ore\. Waiting for the GM\.$/) && p.said(/^Share cancelled: Gate Ore\. It stays private\.$/), p.lines());
  p.check("two shares are waiting for the GM", shares.length === 2 && shares.map(a => a.params.key).sort().join() === "g6-ore,g6-star", shares.map(a => a.params.key).join());
  p.check("the strip says 2 queued", /2 queued/.test(p.text()));
  p.check("both cards say Queued", (p.text().match(/Queued/g) ?? []).length >= 2);
  p.check("no days were reserved by sharing", /, 0 reserved/.test(p.text()));
  return p.done();
})();
```

## Step 18 [GM]: approve one, reject the other

**Run the code block below. Do NOT approve or reject these through the queue window** (the window is used for Gate Wolf in Step 21).

```js
// [GM] approve Gate Ore (it goes into the shared Compendium) and reject Gate Star (it stays private).
await (async () => {
  const g = globalThis.__g6 ?? (() => { throw new Error("run SETUP (step 2) first"); })();
  const scholar = g.smith();
  const ore = g.queued(scholar, "share").find(a => a.params.key === "g6-ore");
  const star = g.queued(scholar, "share").find(a => a.params.key === "g6-star");
  g.check("both shares are queued", Boolean(ore && star));
  const approved = await g.api.queue.resolve(scholar, ore.id, { chat: false });
  g.check("the GM approved Gate Ore", approved.status === "resolved", approved.message);
  await g.api.queue.reject(scholar, star.id, { chat: false });
  g.check("the shared book has Gate Ore and not Gate Star", Boolean(game.settings.get(g.M, "sharedCompendium")?.materials?.["g6-ore"]) && !game.settings.get(g.M, "sharedCompendium")?.materials?.["g6-star"]);
  return g.done();
})();
```

## Step 19 [Player]: shared, and the rejected one is just private again (do not click first)

**What you should see:** **Gate Ore** now says **Shared** ("Everyone in the party can read this.") and has no Share button; **Gate Star** says **Only you** with its Share button back. The bottom line is gone and nothing says "Not shared". Then click **Switch character**, choose **Gate Friend**, open **Compendium**: **Gate Ore** is there (Shared); Gate Star is not. Switch back to Gate Scholar.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const mine = p.api.compendium.view(p.scholar).entries.materials, theirs = p.api.compendium.view(p.friend).entries.materials;
  p.check("the party's book gives Gate Friend Gate Ore and not Gate Star", theirs.some(m => m.id === "g6-ore") && !theirs.some(m => m.id === "g6-star"), theirs.map(m => m.id).join());
  p.check("Gate Scholar still has both", mine.length === 2);
  p.check("the queued lines are gone", p.live() === "" || !/Share queued/.test(p.live()), p.live());
  p.check("no 'Not shared' line (the Hub cannot tell a rejection from other removals, so it says nothing)", !/Not shared/.test(p.text()));
  p.check("nothing is still queued", (p.scholar.getFlag(p.M, "pendingActions") ?? []).length === 0);
  return p.done();
})();
```

## Step 20 [Player]: share the creature

Go back to Gate Scholar if you are not on it. Open **Compendium**, **Creatures**, **Gate Wolf**, then **Share with the party**. **What you should see:** the line "**Share queued: Gate Wolf. Waiting for the GM.**", the pill says **Queued**, "Waiting for the GM to approve sharing it.", and the strip says **1 queued**.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("the line was shown", p.said(/^Share queued: Gate Wolf\. Waiting for the GM\.$/), p.lines());
  const shares = (p.scholar.getFlag(p.M, "pendingActions") ?? []).filter(a => a.type === "share");
  p.check("exactly one share is waiting, and it is the creature", shares.length === 1 && shares[0].params.kind === "creature" && shares[0].params.key === "gate-wolf", shares.map(a => `${a.params.kind}:${a.params.key}`).join());
  p.check("the strip says 1 queued", /1 queued/.test(p.text()));
  return p.done();
})();
```

## Step 21 [GM]: reject it THROUGH THE QUEUE WINDOW (a click, not code)

Open the GM queue window (the **Review** window; if it did not open by itself, run `game.modules.get("pathfinder-progress").api.openReview()` once). Find the row "**Share: Gate Wolf (creature)**" for Gate Scholar and press **Reject**. **What you should see:** the row leaves the window. In the chat log you see a **whisper** (to the owner and to you) saying "Gate Scholar: the GM did not share "Gate Wolf" with the party. It stays private." and **no public message** about it.

(There is no code block: the click is the test. Step 22 checks what the player's window can see.)

## Step 22 [Player]: nothing public, and the wolf is private again (do not click first)

**What you should see:** in the chat log a whisper about Gate Wolf and nothing public; on the Compendium tab (Creatures, Gate Wolf) the pill says **Only you** and the Share button is back. Open Creatures, Gate Wolf first if it is not on screen.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  await p.until(() => (p.scholar.getFlag(p.M, "pendingActions") ?? []).length === 0);
  const about = game.messages.contents.filter(m => /Gate Wolf/.test(m.content ?? ""));
  p.check("no public message anywhere mentions Gate Wolf", about.every(m => Array.isArray(m.whisper) && m.whisper.length > 0), about.map(m => `${(m.whisper ?? []).length ? "whisper" : "PUBLIC"}: ${m.content}`).join(" | "));
  p.check("the owner was told, privately", about.some(m => (m.whisper ?? []).includes(game.user.id) && /stays private/.test(m.content)), about.length);
  p.check("the party's book still has no Gate Wolf", !p.api.compendium.view(p.friend).entries.creatures.some(c => c.key === "gate-wolf" || c.id === "gate-wolf"));
  p.check("the Hub says Only you for it", !p.root() || !/Gate Wolf/.test(p.text()) || /Only you/.test(p.text()), "open Creatures, Gate Wolf");
  p.check("nothing is queued", (p.scholar.getFlag(p.M, "pendingActions") ?? []).length === 0);
  p.check("no DC, odds, percentage or pace", !p.leaks());
  return p.done();
})();
```

## Group C: keyboard and a narrow window

## Step 23 [Player]: keyboard only, on both tabs

Click on blank space inside the window (not on a button). Press **Tab**: the first ring lands on **Display**. Keep pressing **Tab** and **Shift+Tab**; use **Enter** or **Space** to press things. On the **Research** tab: tab to a project card and open it, tab to a skill and choose it, tab to **One day more**, to **Queue**. Open **Put the project aside**: focus lands on **Keep**; Enter on Keep puts it back. On the **Compendium** tab: tab to a category, an entry, **Share with the party**. **What you should see (look at the screen; this cannot be checked by code, because the browser hides focus rings while the console has the focus):** every control you land on shows a clear ring, nothing is skipped, and Escape still closes the window. Click on blank space in the Hub window before running the block, so it reads the window's own focus.

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  p.check("focus is on a control inside the Hub", Boolean(p.root()?.contains(document.activeElement)) && document.activeElement !== p.root(), p.focus());
  return p.done();
})();
```

## Step 24 [Player]: a narrow window at large text

Open **Display**, choose **175%**, and drag the window down to its minimum width (about 300px). Look at the **Research** tab with a project selected, and at the **Compendium** tab with Gate Blade open. **What you should see:** the two panes stack; step boxes wrap onto several rows without overlapping; long text wraps; badges (SELECTED, Queued, Shared, Only you) are never split; nothing is cut off at the right edge and there is no sideways scrollbar.

**Send me a screenshot of the Research tab and of the Compendium tab at that size.**

```js
await (async () => {
  const p = globalThis.__p6 ?? (() => { throw new Error("run the Player helper (step 3) first"); })();
  const frame = p.root().closest(".application");
  const width = frame.getBoundingClientRect().width;
  p.check("the window is at least about 300px wide", width >= 299, width);
  p.check("the layout is the stacked one", p.root().dataset.layout === "narrow", p.root().dataset.layout);
  p.check("nothing is wider than the window", p.root().scrollWidth <= p.root().clientWidth + 1, `${p.root().scrollWidth} > ${p.root().clientWidth}`);
  return p.done();
})();
```

## Step 25 [GM]: CLEANUP (always run this, even if a step failed)

```js
// [GM] CLEANUP: deletes everything the gate made and puts back what it changed. Safe to run twice.
await (async () => {
  const M = "pathfinder-progress", api = game.modules.get(M).api;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  const names = ["Gate Scholar", "Gate Friend"];
  const actors = names.map(n => game.actors.getName(n)).filter(a => a?.getFlag(M, "gateThrowaway6") === true);
  const ids = actors.map(a => a.id);
  const user = game.users.getName("Test");
  await attempt("party location", async () => {
    const original = user?.getFlag(M, "gateOriginalLocation6");
    if (original !== undefined) { await game.settings.set(M, "partyLocation", original); await user.unsetFlag(M, "gateOriginalLocation6"); }
  });
  await attempt("downtime", async () => {
    const period = api.downtime.state();
    if (!period.open || Object.keys(period.participants).every(id => ids.includes(id))) await game.settings.set(M, "downtime", {});
    else problems.push("downtime: a real period is open, so it was left alone");
  });
  await attempt("the shared Compendium", async () => {
    const book = game.settings.get(M, "sharedCompendium");
    if (!book) return;
    const drop = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => !/^(g6-|gate-)/.test(k)));
    const next = { ...book, materials: drop(book.materials), experiments: drop(book.experiments), creatures: drop(book.creatures), regions: drop(book.regions) };
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
  for (const [kind, id] of [["recipe", "g6-lantern"], ["recipe", "g6-giant"], ["recipe", "g6-draught"], ["recipe", "g6-blade"], ["material", "g6-star"], ["material", "g6-ember"], ["material", "g6-steel"], ["material", "g6-ore"], ["town", "g6-town"]]) api.definitions[kind].delete(id);
  await attempt("publish the cleaned registry", () => api.publishDefinitions());
  api.gm.clearLog();
  delete globalThis.__g6;
  return { problems, actorsLeft: game.actors.filter(a => names.includes(a.name)).length, downtimeOpen: api.downtime.isOpen(), testUsersCharacter: user?.character?.name ?? null, sharedLeft: ["materials", "experiments", "creatures", "regions"].flatMap(k => Object.keys(game.settings.get(M, "sharedCompendium")?.[k] ?? {})).filter(k => /^(g6-|gate-)/.test(k)).length, audit: api.audit.scan() };
})();
```

Expected: `problems: []`, `actorsLeft: 0`, `downtimeOpen: false`, `sharedLeft: 0` (it counts the gate's materials, experiments, creatures and regions in the shared Compendium: `gate-wolf` and `g6-field` are dropped too), and the audit list empty. In the Player window, run `delete globalThis.__p6` (or just reload).
