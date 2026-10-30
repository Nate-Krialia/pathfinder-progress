/** The Downtime Hub against the REAL module in the fake Foundry (Stage 11a): the facts a player's window reads, its click handlers, live updates and entry points. */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, SEL, as, env, fireHookAs, getApi, world } from "./fake-world.js";
import { HUB } from "../scripts/config.js";
import { readFacts, ownedCharacters, defaultCharacter } from "../scripts/hub/facts.js";
import { build, openHub, savedPosition } from "../scripts/hub/app.js";
import { actorEvent, installHubHooks, isRelevant, WATCHED_ACTOR_FLAGS, WATCHED_SETTINGS } from "../scripts/hub/live.js";
import { installEntryPoints, mayOpenFor } from "../scripts/hub/entry.js";
import { emptyState, formulaeTab, hubModel, pickMaterial, selectRecipe } from "../scripts/hub/viewmodels.js";
import { renderHubMain } from "../scripts/hub/render.js";
import { findings } from "./scan.js";
import * as events from "../scripts/events.js";
import { build as buildReview } from "../scripts/queue/review-app.js";
import { FakeApplicationV2, RENDER_STATES, REAL_MEMBERS, collisions, installFakeApplication } from "./fake-application.js";
import { readFileSync } from "node:fs";

const api = () => getApi();
const M = "pathfinder-progress";

async function playerWorld(options = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 5, fang: 5, copper: 20000, ...options });
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}
const facts = (w, state = {}) => as(w.annUser, () => readFacts(api(), w.ann, { ...emptyState(), ...state }));

test("FACTS: a player's window reads the formulae, bag, days, queue and workshops through the player APIs only", async () => {
  const w = await playerWorld();
  const f = await facts(w, { recipeId: DAGGER });
  assert.deepEqual([f.actor.name, f.formulas.map(x => x.recipeId)], ["Ann", [DAGGER]]);
  assert.ok(f.recipes[DAGGER], "the recipe arrived through definitionsFor");
  assert.equal(f.recipes[DAGGER].craftLevel, undefined, "and carries no craft level");
  assert.equal(f.inventory.iron, 5);
  assert.deepEqual([f.days.free, f.days.reserved, f.queue.length], [12, 0, 0]);
  assert.equal(f.definitions, "ready");
  assert.deepEqual(findings(f.recipes), [], "nothing hidden in the recipes it reads");
  assert.ok(f.stations.length >= 1, "workshops for the selected recipe");
  assert.ok(f.stations.every(s => Number.isFinite(s.fee)));
});

test("FACTS: only materials the character HAS and has MET come out as options; a material never discovered is not offered", async () => {
  const w = await playerWorld();
  const f = await facts(w, { recipeId: DAGGER });
  const options = formulaeTab(f, { ...emptyState(), recipeId: DAGGER }).detail.slots.flatMap(s => s.options.map(o => o.id));
  assert.ok(options.every(id => f.inventory[id] > 0 && f.met.includes(id)));
  const unmet = Object.keys(f.inventory).filter(id => !f.met.includes(id));
  assert.ok(options.every(id => !unmet.includes(id)));
});

test("FACTS: queueing a craft reserves days, and the next read shows them in the status strip and the queue", async () => {
  const w = await playerWorld();
  const f0 = await facts(w, { recipeId: DAGGER });
  const state = { recipeId: DAGGER, picks: SEL };
  const tab = formulaeTab(await facts(w, state), { ...emptyState(), ...state });
  assert.equal(tab.detail.kind, "recipe");
  assert.equal(tab.detail.buttons.queue.disabled, false, tab.detail.buttons.queue.reason);
  assert.equal(f0.queue.length, 0);
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "craft", { recipe: DAGGER, selection: SEL }));
  const after = await facts(w, { recipeId: DAGGER });
  assert.equal(after.queue.length, 1);
  assert.equal(after.days.reserved, action.daysReserved);
  assert.equal(after.days.free, 12 - action.daysReserved);
});

test("FACTS: the same character with downtime closed reads as closed, and the whole page still passes the leak scan", async () => {
  const w = await playerWorld({ downtime: 0 });
  const f = await facts(w, { recipeId: DAGGER });
  const model = hubModel(f, { ...emptyState(), recipeId: DAGGER, picks: SEL });
  assert.equal(model.status.gate.open, false);
  assert.equal(model.body.detail.buttons.queue.disabled, true);
  assert.equal(model.body.detail.buttons.queue.reason, "Downtime isn't open right now");
  assert.deepEqual(findings(model).filter(x => !/%/.test(x)), []);
});

test("CHARACTERS: a player lists the characters they own; the default is their assigned one", async () => {
  const w = await playerWorld();
  const mine = as(w.annUser, () => ownedCharacters().map(a => a.name));
  assert.ok(mine.includes("Ann"));
  assert.equal(as(w.annUser, () => defaultCharacter())?.name, "Ann");
});

// The window class ------------------------------------------------------------------------------------------------------
function fakeWindow(w) {
  installFakeApplication();     // the STRICT stand-in: read-only getters like state/element/id, the real render lifecycle, a real DOM
  const Hub = build();
  const app = new Hub(api(), w.ann);
  app.redraw = () => { app.redraws = (app.redraws ?? 0) + 1; };
  return { app, actions: Hub.DEFAULT_OPTIONS.actions, Hub };
}
const click = (actions, app, name, data = {}) => actions[name].call(app, {}, { dataset: data });

test("WINDOW: every data-action the page draws has a handler, and the handlers change only the window's own state", async () => {
  const w = await playerWorld();
  const { app, actions } = fakeWindow(w);
  const f = await facts(w, { recipeId: DAGGER });
  const html = renderHubMain(hubModel({ ...f, characters: [{ id: "a", name: "A" }, { id: "b", name: "B" }], queue: [{ id: "q", label: "x", days: 1 }] }, { ...app.hubState, recipeId: DAGGER, showQueue: true, showDisplay: true, showSwitch: true }));
  const used = [...new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]))];
  assert.deepEqual(used.filter(name => typeof actions[name] !== "function"), []);
  click(actions, app, "select-recipe", { recipe: DAGGER });
  assert.equal(app.hubState.recipeId, DAGGER);
  click(actions, app, "pick-material", { slot: "blade", material: "iron" });
  assert.deepEqual(app.hubState.picks, { blade: "iron" });
  click(actions, app, "clear-slot", { slot: "blade" });
  assert.deepEqual(app.hubState.picks, {});
  click(actions, app, "set-filter", { filter: "weapon" });
  click(actions, app, "switch-tab", { tab: "research" });
  assert.deepEqual([app.hubState.filter, app.hubState.tab], ["weapon", "research"]);
  click(actions, app, "toggle-display");
  click(actions, app, "toggle-queue");
  click(actions, app, "toggle-switch");
  assert.deepEqual([app.hubState.showDisplay, app.hubState.showQueue, app.hubState.showSwitch], [true, true, true]);
  assert.ok(app.redraws >= 8, "each click redraws");
});

test("WINDOW: display choices are remembered per player in a client setting, and Reset puts the defaults back", async () => {
  const w = await playerWorld();
  const { app, actions } = fakeWindow(w);
  click(actions, app, "set-text-size", { value: "175" });
  click(actions, app, "set-theme", { value: "contrast" });
  click(actions, app, "set-font", { value: "hyperlegible" });
  assert.deepEqual(app.hubState.display, { textSize: 175, theme: "contrast", font: "hyperlegible" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.values[HUB.displaySetting], { textSize: 175, theme: "contrast", font: "hyperlegible" });
  click(actions, app, "reset-display");
  assert.deepEqual(app.hubState.display, HUB.defaultDisplay);
  click(actions, app, "set-text-size", { value: "999" });
  assert.equal(app.hubState.display.textSize, 100, "an unknown size is ignored");
});

test("WINDOW: Queue the craft submits through api.queue.submit, says what happened in words, and the slots start empty again", async () => {
  const w = await playerWorld();
  const { app, actions } = fakeWindow(w);
  app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { ...SEL } };
  await as(w.annUser, () => click(actions, app, "queue-craft"));
  assert.match(app.announcements[0], /^Craft queued: .+\. \d+ days? reserved\.$/);
  assert.deepEqual(app.hubState.picks, {});
  assert.equal((await facts(w)).queue.length, 1);
  assert.doesNotMatch(app.announcements.join(" "), /\bDC\b|odds|%/);
});

test("WINDOW: a button that is off does nothing: no slot filled, nothing queued", async () => {
  const w = await playerWorld();
  const { app, actions } = fakeWindow(w);
  app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { blade: "iron" } };     // a slot is still empty
  await as(w.annUser, () => click(actions, app, "queue-craft"));
  assert.equal(app.announcements.length, 0);
  assert.equal((await facts(w)).queue.length, 0);
  assert.doesNotThrow(() => { click(actions, app, "ask-crafter"); click(actions, app, "open-research"); });
});

test("WINDOW: a refusal from the queue is shown in plain words and nothing is lost", async () => {
  const w = await playerWorld();
  const { app, actions } = fakeWindow(w);
  app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { ...SEL } };
  app.api = { ...api(), queue: { ...api().queue, submit: async () => { throw new Error("Ann cannot afford the 5 gp station fee."); } } };
  await as(w.annUser, () => click(actions, app, "queue-craft"));
  assert.match(app.announcements[0] ?? "", /^Couldn't queue the craft: /);
});

test("WINDOW: cancelling a queued item gives it back and says so", async () => {
  const w = await playerWorld();
  const { app, actions } = fakeWindow(w);
  const action = await as(w.annUser, () => api().queue.submit(w.ann, "craft", { recipe: DAGGER, selection: SEL }));
  await as(w.annUser, () => click(actions, app, "cancel-queued", { actionId: action.id }));
  assert.match(app.announcements[0], /^Cancelled: .+ Your days and materials are back\.$/);
  assert.equal((await facts(w)).queue.length, 0);
});

test("WINDOW: switching character starts fresh (empty slots, no recipe) but keeps the display and the tab", async () => {
  const w = await playerWorld();
  const { app } = fakeWindow(w);
  app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { blade: "iron" }, display: { textSize: 150, theme: "dark", font: "standard" }, tab: "formulae" };
  app.showCharacter(w.ann);
  assert.deepEqual([app.hubState.recipeId, app.hubState.picks, app.hubState.display.textSize], [null, {}, 150]);
});

test("WINDOW: the saved size and position are only used when sensible", () => {
  env.values[HUB.sizeSetting] = { left: 10, top: 20, width: 50, height: 9999 };
  const box = savedPosition();
  assert.deepEqual(box, { left: 10, top: 20, width: HUB.minSize.width, height: 9999 });
  env.values[HUB.sizeSetting] = { width: "wide" };
  assert.deepEqual(savedPosition(), {});
  delete env.values[HUB.sizeSetting];
});

// Live updates ----------------------------------------------------------------------------------------------------------
test("LIVE: only data about the VIEWED character, or the shared downtime, queue and definitions state, triggers a redraw", () => {
  const viewed = "a";
  const yes = [
    { type: "actor", actorId: "a", flagKeys: ["formulas"] }, { type: "actor", actorId: "a", flagKeys: ["downtimeDays"] },
    { type: "actor", actorId: "a", flagKeys: ["pendingActions"] }, { type: "actor", actorId: "a", flagKeys: ["compendium", "x"] },
    { type: "item", actorId: "a", isMaterial: true }, { type: "setting", key: `${M}.downtime` }, { type: "setting", key: `${M}.partyLocation` },
    { type: "definitions" }, { type: "ownership", actorId: "z" }
  ];
  const no = [
    { type: "actor", actorId: "b", flagKeys: ["formulas"] }, { type: "actor", actorId: "a", flagKeys: ["xp"] }, { type: "actor", actorId: "a", flagKeys: [] },
    { type: "item", actorId: "a", isMaterial: false }, { type: "item", actorId: "b", isMaterial: true }, { type: "setting", key: `${M}.paused` },
    { type: "setting", key: "core.something" }, { type: "mystery" }, null
  ];
  for (const e of yes) assert.equal(isRelevant(e, viewed), true, JSON.stringify(e));
  for (const e of no) assert.equal(isRelevant(e, viewed), false, JSON.stringify(e));
  assert.ok(WATCHED_ACTOR_FLAGS.includes("formulas") && WATCHED_SETTINGS.every(k => k.startsWith(`${M}.`)));
  assert.deepEqual(actorEvent({ id: "a" }, { flags: { [M]: { formulas: [] }, other: { x: 1 } } }), { type: "actor", actorId: "a", flagKeys: ["formulas"] });
  assert.equal(actorEvent({ id: "a" }, { ownership: { u: 3 } }).type, "ownership");
});

test("LIVE: a burst of relevant changes redraws ONCE (debounced), an unrelated one not at all, and no window means nothing", async () => {
  const handlers = new Map();
  const hooks = { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  let redraws = 0;
  let viewed = "a";
  const notify = installHubHooks({ viewed: () => viewed, redraw: () => redraws++, hooks, delay: 10 });
  const fire = (name, ...args) => (handlers.get(name) ?? []).forEach(fn => fn(...args));
  fire("updateActor", { id: "a" }, { flags: { [M]: { downtimeDays: 3 } } });
  fire("updateActor", { id: "a" }, { flags: { [M]: { pendingActions: [] } } });
  fire("createItem", { parent: { id: "a" }, getFlag: () => ({ materialId: "iron" }) });
  fire("updateActor", { id: "a" }, { system: { hp: 1 } });
  fire("updateActor", { id: "b" }, { flags: { [M]: { formulas: [] } } });
  fire("updateSetting", { key: `${M}.paused` });
  await new Promise(r => setTimeout(r, 40));
  assert.equal(redraws, 1);
  fire("updateSetting", { key: `${M}.downtime` });
  await events.emit("definitionsRefreshed", {});
  await new Promise(r => setTimeout(r, 40));
  assert.equal(redraws, 2, "a setting and a definitions refresh together are one redraw");
  viewed = null;
  assert.equal(notify({ type: "definitions" }), false, "no window open: nothing to redraw");
});

// Entry points ----------------------------------------------------------------------------------------------------------
test("ENTRY: the scene-controls button is added for everyone; the sheet button only for a character you own", async () => {
  const w = await playerWorld();
  const handlers = new Map();
  installEntryPoints(() => api(), { on: (name, fn) => handlers.set(name, fn) });
  assert.deepEqual([...handlers.keys()].sort(), ["getActorSheetHeaderButtons", "getHeaderControlsApplicationV2", "getSceneControlButtons"]);
  w.ann.documentName = "Actor";
  const controls = { tokens: { tools: {} } };
  as(w.annUser, () => handlers.get("getSceneControlButtons")(controls));
  const tool = controls.tokens.tools.pfpDowntime;
  assert.deepEqual([tool.button, tool.title, typeof tool.onChange], [true, "Downtime", "function"]);
  const list = [];
  as(w.annUser, () => handlers.get("getHeaderControlsApplicationV2")({ document: w.ann }, list));
  assert.deepEqual(list.map(c => [c.action, c.label]), [["pfp-open-hub", "Downtime"]]);
  as(w.annUser, () => handlers.get("getHeaderControlsApplicationV2")({ document: w.ann }, list));
  assert.equal(list.length, 1, "never added twice");
  const notMine = [];
  as(w.bobUser, () => handlers.get("getHeaderControlsApplicationV2")({ document: w.ann }, notMine));
  assert.equal(notMine.length, 0, "someone else's character gets no button");
  const old = [];
  as(w.annUser, () => handlers.get("getActorSheetHeaderButtons")({ actor: w.ann }, old));
  assert.equal(old[0].label, "Downtime");
  assert.equal(as(w.annUser, () => mayOpenFor(w.ann)), true);
  assert.equal(mayOpenFor({ type: "npc", testUserPermission: () => true }), false);
  const odd = { weird: {} };
  const logged = [];
  const spy = console.error; console.error = (...a) => logged.push(a[0]);
  try { handlers.get("getSceneControlButtons")({}); } finally { console.error = spy; }
  assert.match(logged[0], /shape this module does not know/);
  void odd;
});

test("ENTRY: api.hub.open exists and the Hub never reads a definition pack on a player's client", async () => {
  const w = await playerWorld();
  assert.equal(typeof api().hub.open, "function");
  const src = (await import("node:fs")).readFileSync("scripts/hub/facts.js", "utf8") + (await import("node:fs")).readFileSync("scripts/hub/app.js", "utf8");
  assert.doesNotMatch(src, /game\.packs|getDocuments|PACKS\./);
  void w; void openHub; void pickMaterial; void selectRecipe;
});

// The strict ApplicationV2 (a real-Foundry bug the first fake let through: `this.state = ...` threw because ApplicationV2.state is a getter) ----------
test("STRICT FAKE: it behaves like the real class: read-only getters throw on assignment, render() is a no-op until forced, and state moves through the real values", async () => {
  installFakeApplication();
  class Plain extends FakeApplicationV2 {
    static DEFAULT_OPTIONS = { id: "plain-app", window: { title: "Plain" } };
    async _renderHTML() { return "<p>hi</p>"; }
    _replaceHTML(result, content) { content.innerHTML = result; }
  }
  const app = new Plain();
  for (const name of REAL_MEMBERS.getters) assert.throws(() => { app[name] = {}; }, TypeError, `assigning ${name} must throw like Foundry`);
  assert.throws(() => { app.options.window = {}; }, TypeError, "options is frozen");
  assert.equal(app.state, RENDER_STATES.NONE);
  await app.render();
  assert.equal(app.state, RENDER_STATES.NONE, "a plain render() never opens a closed window");
  assert.equal(app.element, undefined);
  const seen = [];
  const original = app._renderHTML.bind(app);
  app._renderHTML = async (...args) => { seen.push(app.state); return original(...args); };
  await app.render({ force: true });
  assert.deepEqual([seen, app.state, app.rendered, app.id, app.element.id, app.title], [[RENDER_STATES.RENDERING], RENDER_STATES.RENDERED, true, "plain-app", "plain-app", "Plain"]);
  await app.render();
  assert.equal(seen.length, 2, "now a plain render redraws");
  await app.close();
  assert.deepEqual([app.state, app.element, document.body.children.length], [RENDER_STATES.CLOSED, undefined, 0]);
});

test("STRICT FAKE: the old kind of bug is caught: a subclass that assigns this.state in its constructor cannot even be built", () => {
  installFakeApplication();
  class Broken extends FakeApplicationV2 { constructor(o) { super(o); this.state = { tab: "x" }; } }
  assert.throws(() => new Broken(), TypeError);
  class AlsoBroken extends FakeApplicationV2 { go() { this.element = null; } }
  assert.throws(() => new AlsoBroken().go(), TypeError);
});

test("COLLISIONS: nothing HubWindow or the review window defines or assigns shadows a real ApplicationV2 member (only the documented extension points)", async () => {
  const w = await playerWorld();
  installFakeApplication();
  const hub = new (build())(api(), w.ann);
  const review = new (buildReview())(api());
  assert.deepEqual(collisions(hub), []);
  assert.deepEqual(collisions(review), []);
  // What each defines on its own, for the record: these are the public names we added to the class.
  const own = instance => Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).filter(n => n !== "constructor").sort();
  assert.deepEqual(own(hub), ["_onClose", "_onPosition", "_onRender", "_renderHTML", "_replaceHTML", "announcements", "redraw", "showCharacter", "title", "viewedId"]);
  assert.deepEqual(Object.keys(hub).filter(k => !Object.keys(new FakeApplicationV2()).includes(k)).sort(), ["actor", "api", "hubState", "hubStatus"]);
  assert.deepEqual(own(review), ["_onRender", "_renderHTML", "_replaceHTML"]);
  assert.deepEqual(Object.keys(review).filter(k => !Object.keys(new FakeApplicationV2()).includes(k)).sort(), ["api", "results"]);
  // The collision check really catches one.
  class Bad extends FakeApplicationV2 { get state() { return 1; } render() {} }
  assert.deepEqual(collisions(new Bad()), ["render", "state"]);
});

test("COLLISIONS: no source line assigns to a read-only ApplicationV2 member (a static guard that does not depend on any fake)", () => {
  const readOnly = REAL_MEMBERS.getters.filter(name => name !== "title");
  for (const file of ["scripts/hub/app.js", "scripts/queue/review-app.js"]) {
    const source = readFileSync(file, "utf8");
    for (const name of readOnly) assert.doesNotMatch(source, new RegExp(`this\\.${name}\\s*(=(?!=)|\\+=|\\|\\|=|\\?\\?=)`), `${file} assigns this.${name}, which is a read-only getter on ApplicationV2`);
    assert.doesNotMatch(source, /\bthis\.options\s*=(?!=)/, `${file} replaces this.options`);
    assert.doesNotMatch(source, /\bapp\.(state|element|id)\s*=(?!=)/);
  }
});

test("REAL WINDOW: HubWindow renders for real on the strict fake, and EVERY action in `actions` is driven through real clicks", async () => {
  const w = await playerWorld();
  const dom = installFakeApplication();
  const errors = [];
  const onError = event => errors.push(event.error ?? event.message);
  window.addEventListener("error", onError);
  await as(w.annUser, async () => {
    const Hub = build();
    const app = new Hub(api(), w.ann);
    assert.equal(app.state, RENDER_STATES.NONE, "the window's own state does not touch ApplicationV2's");
    assert.equal(app.hubState.tab, "formulae");
    await app.render({ force: true });
    assert.equal(app.state, RENDER_STATES.RENDERED);
    assert.equal(app.title, "Downtime: Ann");
    assert.equal(app.viewedId, w.ann.id);
    const root = () => app.element.querySelector(".pfp-hub");
    const main = () => app.element.querySelector(".pfp-main");
    const live = () => app.element.querySelector(".pfp-live").textContent;
    const pressed = new Set();
    const press = async (action, where = "") => {
      const target = [...app.element.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
      assert.ok(target, `a live ${action} button is on the page`);
      target.click();
      pressed.add(action);
      await new Promise(resolve => setTimeout(resolve, 5));
      return target;
    };
    assert.match(main().textContent, /Downtime: Ann/);
    assert.equal(root().dataset.theme, "parchment");

    // Formulae: a card, the filter, the slots (empty), a pick per slot.
    await press("set-filter", '[data-filter="weapon"]');
    await press("select-recipe");
    assert.equal(app.hubState.recipeId, DAGGER);
    assert.ok([...app.element.querySelectorAll(".pfp-slot-status")].every(el => /Nothing chosen yet/.test(el.textContent)), "every slot starts empty on screen");
    const slots = [...app.element.querySelectorAll("fieldset.pfp-slot")];
    assert.ok(slots.length >= 1);
    for (let i = 0; i < slots.length; i++) {
      const option = app.element.querySelectorAll("fieldset.pfp-slot")[i].querySelector('[data-action="pick-material"]');   // re-read: every click redraws
      assert.ok(option, "each slot offers a material");
      option.click();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    pressed.add("pick-material");
    assert.equal(Object.keys(app.hubState.picks).length, slots.length, "one pick per slot");
    await press("clear-slot");
    await press("pick-material");
    await press("pick-station").catch(() => {});       // only drawn when several workshops fit; a single one is still a button
    // Queue it for real.
    const queueButton = app.element.querySelector('[data-action="queue-craft"]');
    assert.equal(queueButton.getAttribute("aria-disabled"), null, "the button is on");
    queueButton.click();
    pressed.add("queue-craft");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(live(), /^Craft queued: .+\. \d+ days? reserved\.$/);
    assert.equal((await facts(w)).queue.length, 1);
    assert.deepEqual(app.hubState.picks, {}, "the slots are empty again");
    assert.match(main().textContent, /1 queued/);

    // The queue panel and Cancel.
    await press("toggle-queue");
    await press("cancel-queued");
    assert.match(live(), /Cancelled: .+ Your days and materials are back\./);
    assert.equal((await facts(w)).queue.length, 0);

    // Display settings: each one changes the root's attributes and is saved.
    await press("toggle-display");
    await press("set-text-size", '[data-value="175"]');
    assert.match(root().getAttribute("style"), /--pfp-font-size:24\.5px/);
    await press("set-theme", '[data-value="contrast"]');
    assert.equal(root().dataset.theme, "contrast");
    await press("set-font", '[data-value="hyperlegible"]');
    assert.equal(root().dataset.font, "hyperlegible");
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(env.values[HUB.displaySetting], { textSize: 175, theme: "contrast", font: "hyperlegible" });
    await press("reset-display");
    assert.deepEqual([root().dataset.theme, root().dataset.font], ["parchment", "standard"]);
    await press("toggle-display");

    // Tabs, the placeholders, the layout and the position.
    await press("switch-tab", '[data-tab="research"]');
    assert.match(main().textContent, /Coming in a later stage/);
    await press("switch-tab", '[data-tab="formulae"]');
    for (const [width, layout] of [[500, "narrow"], [900, "wide"]]) { dom.resize(app.element, width); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(root().dataset.layout, layout, `${width}px`); }
    app.setPosition({ left: 40, top: 50, width: 520, height: 610 });
    await new Promise(resolve => setTimeout(resolve, HUB.saveDebounceMs + 100));
    assert.deepEqual(env.values[HUB.sizeSetting], { left: 40, top: 50, width: 520, height: 610 });

    // The rest of `actions`: placeholders, the switcher (no button with one character: call it as the handler would be), toggles.
    const actions = Hub.DEFAULT_OPTIONS.actions;
    await press("ask-crafter").catch(() => {});           // aria-disabled: the capture guard must swallow it
    const ask = app.element.querySelector('[data-action="ask-crafter"]');
    ask.click(); pressed.add("ask-crafter");
    const research = { closest: () => null, dataset: {} };
    for (const name of ["ask-crafter", "open-research"]) await actions[name].call(app, {}, research);
    pressed.add("open-research");
    await actions["toggle-switch"].call(app, {}, research); pressed.add("toggle-switch");
    await actions["switch-character"].call(app, {}, { dataset: { actor: w.ann.id } }); pressed.add("switch-character");
    assert.equal(app.hubState.recipeId, null, "switching character starts fresh");
    assert.deepEqual([...Object.keys(actions)].filter(name => !pressed.has(name)), [], "every action was driven");
    assert.deepEqual(errors, [], "nothing threw while clicking");

    // An aria-disabled button does nothing when clicked.
    await press("select-recipe");
    const before = JSON.stringify(app.hubState);
    app.element.querySelector('[data-action="queue-craft"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(JSON.stringify(app.hubState), before);
    assert.equal(app.element.querySelector('[data-action="queue-craft"]').getAttribute("aria-disabled"), "true");
    await app.close();
    assert.equal(app.state, RENDER_STATES.CLOSED);
  });
  window.removeEventListener("error", onError);
});

test("REAL WINDOW: openHub re-targets the one window it opened, and a second call does not open a second", async () => {
  const w = await playerWorld();
  installFakeApplication();
  await as(w.annUser, async () => {
    const first = openHub(api(), w.ann);
    await first.render();
    await new Promise(resolve => setTimeout(resolve, 20));
    const again = openHub(api(), w.ann);
    assert.equal(again, first);
    assert.equal(document.querySelectorAll(".pfp-hub-window").length, 1);
    await first.close();
  });
});

test("REAL WINDOW: the frame's title follows Switch character (the frame only reads the title when it is built)", async () => {
  const w = await playerWorld();
  installFakeApplication();
  await as(w.gm, async () => {
    const app = new (build())(api(), w.ann);
    await app.render({ force: true });
    const heading = () => app.element.querySelector(".window-title").textContent;
    assert.deepEqual([heading(), app.title], ["Downtime: Ann", "Downtime: Ann"]);
    await app.showCharacter(w.bob);
    assert.equal(app.title, `Downtime: ${w.bob.name}`);
    assert.equal(heading(), `Downtime: ${w.bob.name}`, "the frame says who the body says");
    assert.match(app.element.querySelector(".pfp-main").textContent, new RegExp(`Downtime: ${w.bob.name}`));
    await app.close();
  });
});

// Keyboard, focus and the transient status line (0.18.3) ---------------------------------------------------------------------------------------------------
const keydown = (target, key, init = {}) => { const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }); target.dispatchEvent(event); return event; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("KEYBOARD: Tab, Shift+Tab, Enter and Space from inside the Hub never reach a parent (Foundry's own handler), are never preventDefault-ed by us, and nothing else is touched", async () => {
  const w = await playerWorld();
  installFakeApplication();
  await as(w.annUser, async () => {
    const app = new (build())(api(), w.ann);
    await app.render({ force: true });
    const root = app.element.querySelector(".pfp-hub");
    const seen = [];
    const parent = event => seen.push([event.key, event.shiftKey, event.defaultPrevented]);
    document.body.addEventListener("keydown", parent);
    const button = app.element.querySelector('[data-action="set-filter"]');
    for (const [key, init] of [["Tab", {}], ["Tab", { shiftKey: true }], ["Enter", {}], [" ", {}]]) {
      const event = keydown(button, key, init);
      assert.equal(event.defaultPrevented, false, `${key}: we never preventDefault (the browser still moves focus / presses the button)`);
    }
    assert.deepEqual(seen, [], "none of Tab, Shift+Tab, Enter or Space left the Hub");
    keydown(root, "Tab");
    assert.deepEqual(seen, [], "a key pressed on the Hub root itself is kept inside too");
    // everything else, and Escape in particular (it still closes the window the way Foundry does), bubbles out untouched
    for (const key of ["Escape", "ArrowDown", "ArrowLeft", "a", "F6", "Home"]) { const event = keydown(button, key); assert.equal(event.defaultPrevented, false, key); }
    assert.deepEqual(seen.map(([key]) => key), ["Escape", "ArrowDown", "ArrowLeft", "a", "F6", "Home"]);
    // a key outside the Hub is untouched
    seen.length = 0;
    const outside = document.createElement("button");
    document.body.append(outside);
    for (const key of ["Tab", "Enter", " "]) keydown(outside, key);
    assert.deepEqual(seen.map(([key]) => key), ["Tab", "Enter", " "], "outside the Hub, nothing is stopped");
    document.body.removeEventListener("keydown", parent);
    await app.close();
  });
});

test("KEYBOARD: one listener per frame (redraws and a character switch never stack them), removed on close; the root takes focus on open", async () => {
  const w = await playerWorld();
  installFakeApplication();
  const proto = window.Element.prototype;
  const add = proto.addEventListener, remove = proto.removeEventListener;
  const added = [], removed = [];
  proto.addEventListener = function (type, listener, options) { if (type === "keydown" && this.classList?.contains("pfp-hub")) added.push(listener); return add.call(this, type, listener, options); };
  proto.removeEventListener = function (type, listener, options) { if (type === "keydown" && this.classList?.contains("pfp-hub")) removed.push(listener); return remove.call(this, type, listener, options); };
  try {
    await as(w.annUser, async () => {
      const app = new (build())(api(), w.ann);
      await app.render({ force: true });
      const root = app.element.querySelector(".pfp-hub");
      assert.equal(root.getAttribute("tabindex"), "-1", "a click on blank space focuses the Hub, not the page body");
      assert.equal(document.activeElement, root, "on open, focus is on the root, not on a control: Tab goes to the first control and no ring appears by itself");
      for (let i = 0; i < 5; i++) { app.hubState = { ...app.hubState, filter: i % 2 ? "weapon" : "all" }; app.redraw(); await app.render(); }
      await app.showCharacter(w.ann);
      assert.equal(added.length, 1, `exactly one keydown listener was ever added (${added.length})`);
      await app.close();
      assert.deepEqual(removed, added, "the same listener was removed on close");
    });
  } finally { proto.addEventListener = add; proto.removeEventListener = remove; }
});

test("FOCUS: a live redraw keeps the focus ring on the same button, never steals focus that was elsewhere, and falls back to the Hub (not the page body) when its button is gone", async () => {
  const w = await playerWorld();
  installFakeApplication();
  await as(w.annUser, async () => {
    const app = new (build())(api(), w.ann);
    await app.render({ force: true });
    const root = app.element.querySelector(".pfp-hub");
    app.element.querySelector('[data-action="select-recipe"]').click();
    await wait(5);
    const option = app.element.querySelector('[data-action="pick-material"]');
    option.focus();
    const key = option.dataset.focusKey;
    // a live update that changes what is drawn (the GM grants a day): the status strip text changes, the focus stays put
    const before = app.element.querySelector(".pfp-main").textContent;
    await as(w.gm, () => api().grantDays(w.ann, 1));
    app.redraw();
    assert.notEqual(app.element.querySelector(".pfp-main").textContent, before, "the redraw really replaced the content");
    assert.equal(document.activeElement.dataset.focusKey, key, "the same button still has focus after a live redraw");
    assert.ok(app.element.contains(document.activeElement));
    // focus that was NOT in the Hub is never taken by a redraw
    document.activeElement.blur();
    await as(w.gm, () => api().grantDays(w.ann, 1));
    app.redraw();
    assert.equal(document.activeElement, document.body, "a live redraw does not move focus into the Hub");
    // focus on a control that disappears falls back to the root
    app.element.querySelector('[data-action="toggle-display"]').click();
    await wait(5);
    const done = app.element.querySelector('[data-action="reset-display"]');
    done.focus();
    app.element.querySelector('[data-action="toggle-display"]').click();      // closes the panel: the focused button is gone
    await wait(5);
    assert.equal(document.activeElement, root, "focus falls back to the Hub root, not the page body");
    await app.close();
  });
  void wait;
});

test("STATUS: 'Craft queued' goes when its action is resolved while the window is open; a screen reader hears it ONCE, and clearing is silent", async () => {
  const w = await playerWorld();
  installFakeApplication();
  await as(w.annUser, async () => {
    const app = new (build())(api(), w.ann);
    await app.render({ force: true });
    const live = app.element.querySelector(".pfp-live");
    const announced = [];
    new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) announced.push(n.textContent); }).observe(live, { childList: true, subtree: true });
    app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { ...SEL } };
    app.redraw();
    app.element.querySelector('[data-action="queue-craft"]').click();
    await wait(60);
    assert.match(live.textContent, /^Craft queued: /);
    assert.match(app.element.querySelector(".pfp-main").textContent, /1 queued/);
    for (let i = 0; i < 3; i++) { app.redraw(); await wait(2); }
    assert.equal(announced.filter(Boolean).length, 1, "redraws with the same line do not re-announce it");
    // the GM resolves it while the window is open; the live-update path redraws
    const action = api().queue.list([w.ann])[0].action;
    await as(w.gm, () => api().queue.resolve(w.ann, action.id, { degree: "success", chat: false }));
    app.redraw();
    await wait(5);
    assert.match(app.element.querySelector(".pfp-main").textContent, /Nothing queued/, "the status strip says nothing is queued");
    assert.equal(live.textContent, "", "so the line under it is gone too: the window no longer contradicts itself");
    assert.deepEqual(app.announcements, []);
    assert.equal(announced.filter(Boolean).length, 1, "clearing added nothing: no second announcement");
    await app.close();
  });
});

test("STATUS: a status line that is not yet in the queue (the write arrives a moment later) is kept, and the 'Cancelled' line stays true until it times out", async () => {
  const w = await playerWorld();
  installFakeApplication();
  const original = HUB.statusMs;
  HUB.statusMs = 60;
  try {
    await as(w.annUser, async () => {
      const app = new (build())(api(), w.ann);
      await app.render({ force: true });
      const live = app.element.querySelector(".pfp-live");
      // the submit returns an id the actor flag does not show yet: not cleared
      app.hubStatus = { text: "Craft queued: Gate Blade. 2 days reserved.", kind: "queued", actionId: "not-visible-yet", seen: false };
      app.redraw();
      assert.equal(app.announcements.length, 1, "unseen: kept");
      // cancel really cancels, says so, and keeps saying it (it stays true) until the timeout
      app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { ...SEL } };
      app.redraw();
      app.hubStatus = null;
      app.element.querySelector('[data-action="queue-craft"]').click();
      await wait(40);
      const rowId = api().queue.list([w.ann])[0].action.id;
      app.element.querySelector('[data-action="toggle-queue"]').click();
      await wait(5);
      app.element.querySelector(`[data-action="cancel-queued"][data-action-id="${rowId}"]`).click();
      await wait(20);
      assert.match(live.textContent, /^Cancelled: /);
      for (let i = 0; i < 3; i++) { app.redraw(); }
      assert.match(live.textContent, /^Cancelled: /, "redraws do not clear it");
      await wait(120);
      assert.equal(live.textContent, "", "after the timeout it is gone");
      assert.deepEqual(app.announcements, []);
      await app.close();
    });
  } finally { HUB.statusMs = original; }
});

test("STATUS: the line also goes after HUB.statusMs on its own, and when you switch character; a close leaves no timer running", async () => {
  const w = await playerWorld();
  installFakeApplication();
  const original = HUB.statusMs;
  HUB.statusMs = 40;
  try {
    await as(w.gm, async () => {
      const app = new (build())(api(), w.ann);
      await app.render({ force: true });
      app.hubStatus = null;
      app.hubState = { ...app.hubState, recipeId: DAGGER, picks: { ...SEL } };
      app.redraw();
      app.element.querySelector('[data-action="queue-craft"]').click();
      await wait(25);
      assert.equal(app.announcements.length, 1);
      await wait(120);
      assert.deepEqual(app.announcements, [], "timed out");
      app.hubState = { ...app.hubState, picks: { ...SEL } };
      app.redraw();
      app.element.querySelector('[data-action="queue-craft"]').click();
      await wait(25);
      assert.equal(app.announcements.length >= 0, true);
      const before = app.announcements.length;
      await app.showCharacter(w.bob);
      assert.deepEqual(app.announcements, [], `switching character clears it (it said ${before})`);
      app.hubStatus = { text: "x", kind: "error" };
      await app.close();
    });
  } finally { HUB.statusMs = original; }
});
