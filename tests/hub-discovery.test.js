/** The Hub's discovery chain, gold lines and leftovers on the strict ApplicationV2 fake (Stage 11c, commit 2). */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, as, env, getApi, world } from "./fake-world.js";
import { HUB } from "../scripts/config.js";
import { build } from "../scripts/hub/app.js";
import { readFacts } from "../scripts/hub/facts.js";
import { emptyState, formulaeTab, hubModel } from "../scripts/hub/viewmodels.js";
import { installFakeApplication } from "./fake-application.js";
import { scanClean } from "./scan.js";

const api = () => getApi();
const wait = ms => new Promise(r => setTimeout(r, ms));
const track = (...m) => ({ milestones: m.map(([steps, type, recipeId]) => ({ steps, grants: type === "formula" ? { type, ...(recipeId ? { recipeId } : {}) } : { type } })) });

async function studyWorld() {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 0, fang: 0, copper: 20000 });
  api().definitions.tag.set("g7-ore", { kind: "tag", id: "g7-ore", name: "Gate ore", theme: "cowardice", worksWith: "frightened" });
  api().definitions.material.set("g7-a", { kind: "material", id: "g7-a", name: "Gate Ore A", tier: 1, value: 5, effects: { basePower: "T1" }, tag: "g7-ore", research: track([4, "properties"]) });
  await api().giveMaterial(w.ann, "g7-a", 1);
  await w.ann.update({ [`flags.${M}.compendium.materials.g7-a`]: { id: "g7-a", name: "Gate Ore A", tier: 1, firstAt: 1, places: [], rungs: [] } });
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  return w;
}
async function open(w, tab) {
  installFakeApplication();
  const app = new (build())(api(), w.ann);
  app.hubState = { ...app.hubState, tab };
  await as(w.annUser, () => app.render({ force: true }));
  const main = () => app.element.querySelector(".pfp-main").textContent.replace(/\s+/g, " ");
  const live = () => app.element.querySelector(".pfp-live").textContent;
  const press = async (action, where = "") => {
    const target = [...app.element.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
    assert.ok(target, `a live ${action}${where} button is on the page`);
    await as(w.annUser, async () => { target.click(); await wait(25); });
  };
  return { app, main, live, press };
}

test("RESEARCH: an item lead shows in plain words; following it makes a Study card with a stage word and no counts at all", async () => {
  const w = await studyWorld();
  const { app, main, live, press } = await open(w, "research");
  assert.match(main(), /Gate Ore A[\s\S]*You carry Gate Ore A and haven't studied it yet\.[\s\S]*Start researching/);
  await press("follow-lead");
  assert.match(live(), /^Research started: Study: Gate Ore A\.$/);
  assert.match(main(), /Study: Gate Ore A[\s\S]*Study[\s\S]*Just started/);
  assert.match(main(), /Studying this can teach you what it is good for, and perhaps more\./);
  assert.equal(app.element.querySelectorAll(".pfp-step, progress").length, 0, "no step boxes, no bar");
  assert.doesNotMatch(main(), /Progress \d|\d+ of \d+|steps|\bof 4\b/i);
  assert.deepEqual(scanClean(hubModel(await as(w.annUser, () => readFacts(api(), w.ann, { ...emptyState(), tab: "research" })), { ...emptyState(), tab: "research" })), []);
  await press("days-up"); await press("set-skill", '[data-skill="crafting"]');
  await press("queue-research");
  assert.match(live(), /^2 checks queued on Study: Gate Ore A\. 2 days reserved\.$/);
  await as(w.annUser, () => app.close());
});

test("RESEARCH: Put aside on a study keeps its progress (the words say so) and it comes back as a lead", async () => {
  const w = await studyWorld();
  const { app, main, live, press } = await open(w, "research");
  await press("follow-lead");
  await as(w.gm, () => api().research.study({ actor: w.ann, key: "material:g7-a", days: 2, skill: "crafting", degree: "success", chat: false }));
  await as(w.annUser, () => app.redraw());
  assert.match(main(), /Getting somewhere/);
  await press("put-aside");
  assert.match(main(), /Put aside\? Your progress is kept\./);
  await press("confirm-aside");
  assert.match(live(), /^Put aside: Study: Gate Ore A\. Your progress is kept\.$/);
  assert.match(main(), /Pick the study up again/);
  assert.equal(w.ann.getFlag(M, "discoveries").items["material:g7-a"].steps, 2);
  await as(w.annUser, () => app.close());
});

test("COMPENDIUM: a material's entry says what you know (its tag and theme) once studied, and that you have not studied it before", async () => {
  const w = await studyWorld();
  const { app, main, press } = await open(w, "compendium");
  await press("select-entry", '[data-entry="g7-a"]');
  assert.match(main(), /What you know[\s\S]*You haven't studied this yet\./);
  assert.doesNotMatch(main(), /cowardice/);
  await as(w.gm, () => api().discovery.startStudy(w.ann, "material:g7-a"));
  await as(w.gm, () => api().research.study({ actor: w.ann, key: "material:g7-a", days: 2, skill: "crafting", degree: "criticalSuccess", chat: false }));
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  await as(w.annUser, () => app.redraw());
  assert.match(main(), /What you know[\s\S]*Gate ore: a theme of cowardice\.[\s\S]*It works with frightened\./);
  assert.deepEqual(scanClean(main()), []);
  await as(w.annUser, () => app.close());
});

test("EXPERIMENTS: what the item class teaches is listed with its own words", async () => {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 3, fang: 3 });
  const { craft, resolve } = await import("./fake-world.js");
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  await resolve(w.ann, (await craft(w, w.annUser, w.ann)).id, { degree: "success" });
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const { app, main, press } = await open(w, "compendium");
  await press("set-category", '[data-category="experiments"]');
  await press("select-entry");
  assert.match(main(), /you learned it for every item of this kind/);
  await as(w.annUser, () => app.close());
});

test("FORMULAE: a tracked material that is not studied is not offered, with a plain reason; gold lines appear for discovered materials only", async () => {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 3, fang: 3, copper: 20000 });
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const state = { ...emptyState(), recipeId: DAGGER, picks: { blade: "iron", fang: "spider-fang" } };
  const view = () => as(w.annUser, async () => formulaeTab(readFacts(api(), w.ann, state), state));
  const tab = await view();
  const options = tab.detail.slots.flatMap(s => s.options);
  assert.deepEqual([...new Map(options.map(o => [o.name, o.worth]))], [["Iron", "worth 5 gp each"], ["Spider Fang", "worth 25 gp each"]]);
  assert.deepEqual([tab.detail.outcome.gold.worth, tab.detail.outcome.gold.shop, tab.detail.outcome.gold.save], ["Materials are worth about 30 gp.", "Buying this in a shop would be about 60 gp.", "You save about 55 gp."], "value × 2, minus the 5 gp station fee");
  assert.deepEqual(scanClean(tab), []);
  // give iron a track the character has not studied: it leaves the options, with a reason
  api().definitions.material.get("iron").research = track([4, "properties"]);
  await as(w.annUser, () => api().definitions.refresh({ force: true }));
  const locked = await view();
  assert.deepEqual(locked.detail.slots[0].options.map(o => o.name), ["Spider Fang"], "iron is out; the other material is still offered");
  assert.equal(locked.detail.slots[0].locked, "Not open to you yet: Iron. You haven't studied it enough to craft with it.");
  assert.equal(locked.detail.slots[0].noOptions, null);
  assert.equal(locked.detail.outcome.gold, null, "no gold line for a selection with a locked material");
});

test("WORDING: with no GM connected each action says what it was trying to do; the research queue still works (it is the player's own write)", async () => {
  const w = await studyWorld();
  await w.ann.update({ [`flags.${M}.compendium.materials.g7-a`]: { id: "g7-a", name: "Gate Ore A", tier: 1, firstAt: 1, places: [], rungs: [] } });
  const { app, live, press } = await open(w, "compendium");
  await press("select-entry", '[data-entry="g7-a"]');
  env.noGM = true;
  await press("share-entry");
  assert.equal(live(), "Couldn't share this: The GM isn't connected right now, so this can't be done yet.");
  await as(w.annUser, () => app.close());
  const research = await open(w, "research");
  await research.press("follow-lead");
  assert.equal(research.live(), "Couldn't start researching: The GM isn't connected right now, so this can't be done yet.");
  env.noGM = false;
  await as(w.annUser, () => research.app.close());
});

test("IN FLIGHT: a relayed action is guarded from the first click, looks busy only if slow, and after a while says the GM didn't answer", async () => {
  const w = await studyWorld();
  const saved = [HUB.busyShowMs, HUB.noAnswerMs];
  HUB.busyShowMs = 40; HUB.noAnswerMs = 220;
  let calls = 0;
  const real = api().research.follow;
  api().research.follow = () => { calls++; return new Promise(() => {}); };
  try {
    const { app, live, press } = await open(w, "research");
    const button = () => app.element.querySelector('[data-action="follow-lead"]');
    await press("follow-lead");
    assert.equal(button().getAttribute("aria-disabled"), null, "it does not look busy yet: a normal reply takes tens of milliseconds");
    await as(w.annUser, async () => { button().click(); await wait(5); });
    assert.equal(calls, 1, "a second click while the first is out does nothing");
    await wait(60);
    assert.equal(button().getAttribute("aria-disabled"), "true");
    assert.equal(button().getAttribute("aria-busy"), "true");
    await as(w.annUser, async () => { button().click(); await wait(5); });
    assert.equal(calls, 1, "and a click on the busy button does nothing");
    await wait(260);
    assert.equal(live(), "The GM didn't answer, try again");
    assert.equal(button().getAttribute("aria-disabled"), null, "the button is free again");
    await as(w.annUser, async () => { button().click(); await wait(5); });
    assert.equal(calls, 2, "and can be tried again");
    await as(w.annUser, () => app.close());
  } finally { api().research.follow = real; [HUB.busyShowMs, HUB.noAnswerMs] = saved; }
});

test("IN FLIGHT: a late answer still shows its own result", async () => {
  const w = await studyWorld();
  const saved = HUB.noAnswerMs;
  HUB.noAnswerMs = 80;
  const real = api().research.follow;
  api().research.follow = (...args) => new Promise(resolve => setTimeout(() => resolve(real(...args)), 200));
  try {
    const { app, live, press } = await open(w, "research");
    await press("follow-lead");
    await wait(120);
    assert.equal(live(), "The GM didn't answer, try again");
    await wait(250);
    assert.match(live(), /^Research started: Study: Gate Ore A\.$/);
    await as(w.annUser, () => app.close());
  } finally { api().research.follow = real; HUB.noAnswerMs = saved; }
});
