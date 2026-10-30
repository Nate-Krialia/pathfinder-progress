/**
 * The Hub when Foundry's update echo arrives AFTER our own handler finished (v0.19.1). In real Foundry a player's copy of an actor changes when the server's
 * update arrives, a later task than the relayed write that caused it. `enableEcho` (fake-world.js) models that: the player's reads are refreshed, and the
 * `updateActor` hook fires, `delay` ms after a write. Each flow below is driven by real clicks on the strict ApplicationV2 fake, then the echo is delivered and
 * the window has redrawn: the status line and the focus must still be what the action asked for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { as, enableEcho, getApi, world } from "./fake-world.js";
import { build } from "../scripts/hub/app.js";
import { installHubHooks } from "../scripts/hub/live.js";
import { installFakeApplication } from "./fake-application.js";
import { DEFINITIONS_SYNC, HUB } from "../scripts/config.js";

const api = () => getApi();
const LONGSWORD = "longsword-basic";
const wait = ms => new Promise(r => setTimeout(r, ms));

async function openWithEcho(w, delay, tab = "research") {
  installFakeApplication();
  const echo = enableEcho(w.ann, w.annUser, delay);
  const Hub = build();
  let app;
  await as(w.annUser, async () => {
    app = new Hub(api(), w.ann);
    app.hubState = { ...app.hubState, tab };
    await app.render({ force: true });
  });
  installHubHooks({ viewed: () => (app.element ? app.viewedId : null), redraw: () => app.redraw() });
  const live = () => app.element.querySelector(".pfp-live").textContent;
  const main = () => app.element.querySelector(".pfp-main").textContent.replace(/\s+/g, " ");
  const focus = () => (document.activeElement === app.element.querySelector(".pfp-hub") ? "window" : document.activeElement?.dataset?.focusKey ?? document.activeElement?.tagName);
  /** Click, then let the handler's await finish. */
  const press = async (action, where = "") => {
    const target = [...app.element.querySelectorAll(`[data-action="${action}"]${where}`)].find(b => b.getAttribute("aria-disabled") !== "true");
    assert.ok(target, `a live ${action}${where} button is on the page`);
    await as(w.annUser, async () => { target.click(); await wait(15); });
  };
  /** The echo has been delivered and the debounced redraw that follows it has run. */
  const settle = async () => { await wait(delay + 60); assert.ok(echo.delivered > 0, "the echo was delivered"); await wait(HUB.liveDebounceMs + 120); };
  const finish = async () => { await wait(DEFINITIONS_SYNC.debounceMs + 400); await as(w.annUser, () => app.close()); };
  return { app, echo, live, main, focus, press, settle, finish };
}
async function player(options = {}) {
  const w = await world({ perClientDefinitions: true, downtime: 12, iron: 5, fang: 5, copper: 20000, ...options });
  await as(w.annUser, () => api().definitions.refresh());
  return w;
}
/** Every flow runs with the echo arriving before the handler is done (1 ms), shortly after it (30 ms) and well after it (400 ms). */
const DELAYS = [1, 30, 400];
const flows = (name, setup, body) => { for (const delay of DELAYS) test(`ECHO ${delay}ms: ${name}`, async () => { const w = await player(); const made = await setup(w); const ui = await openWithEcho(w, delay); try { await body(w, ui, made); } finally { await ui.finish(); } }); };
const withProject = w => as(w.gm, () => api().startProject({ actor: w.ann, recipe: LONGSWORD }));

flows("queue research: the line and the strip survive the update echo of our own write", withProject, async (w, { live, main, press, settle }) => {
  await press("set-skill", '[data-skill="crafting"]');
  await press("days-up"); await press("days-up");
  await press("queue-research");
  await settle();
  assert.match(live(), /^3 checks queued on .+\. 3 days reserved\.$/, "the line is still there after the echo");
  assert.match(main(), /1 queued/);
});

flows("cancel queued: the Cancelled line survives the echo", withProject, async (w, { live, main, press, settle }) => {
  await press("set-skill", '[data-skill="crafting"]');
  await press("queue-research");
  await settle();
  assert.match(main(), /Queued: 1 check/);
  await press("cancel-queued");
  await settle();
  assert.match(live(), /^Cancelled: Research: .+\. Your days and materials are back\.$/);
  assert.match(main(), /Nothing queued/);
});

flows("Put aside, confirmed: the line stays and focus ends on the window, not the page body", withProject, async (w, { live, focus, press, settle }, project) => {
  await press("put-aside");
  assert.equal(focus(), "keep-aside");
  await press("confirm-aside");
  await settle();
  assert.match(live(), new RegExp(`^Put aside: ${project.goalName.replace(/[()]/g, "\\$&")}\\. Progress was not kept\\.$`));
  assert.equal(focus(), "window", "focus is on the Hub window");
});

flows("Start researching a lead: the line stays and focus ends on the new project's card", w => as(w.gm, () => api().research.giveLead(w.ann, LONGSWORD, "Someone mentioned it.")), async (w, { echo, live, main, focus, press, settle }) => {
  echo.deliver();
  await wait(300);
  await press("follow-lead");
  await settle();
  assert.match(live(), /^Research started: .+\.$/);
  assert.match(main(), /No leads yet\./);
  assert.equal(focus(), `project:unlock-${LONGSWORD}`);
});

flows("a line still clears when something ELSE changes the queue afterwards (the GM resolves it)", withProject, async (w, { live, press, settle }) => {
  await press("set-skill", '[data-skill="crafting"]');
  await press("queue-research");
  await settle();
  assert.match(live(), /^1 check queued/);
  const action = api().queue.list([w.ann]).find(r => r.action.type === "research").action;
  await as(w.gm, () => api().queue.reject(w.ann, action.id, { chat: false }));
  await settle();
  assert.equal(live(), "", "the line goes when the queue changes from elsewhere");
});

// The reply of a relayed call comes back AFTER the update echo of its write (the strip already shows the new state): the window must not look idle meanwhile.
for (const [name, setup, steps] of [
  ["queue research", withProject, async (w, ui) => { await ui.press("set-skill", '[data-skill="crafting"]'); return () => ui.press("queue-research"); }],
  ["cancel queued", async w => { await withProject(w); const action = await as(w.annUser, async () => { await api().queue.submit(w.ann, "research", { projectId: "unlock-longsword-basic", skill: "crafting" }, 1); return api().queue.list([w.ann])[0].action; }); return action; }, async (w, ui, action) => () => ui.press("cancel-queued")]
]) {
  test(`ECHO slow reply: ${name}: the line is never blank while the relay is still answering`, async () => {
    const w = await player();
    const made = await setup(w);
    const ui = await openWithEcho(w, 20);
    const realSubmit = api().queue.submit, realCancel = api().queue.cancel;
    api().queue.submit = async (...args) => { const result = await realSubmit(...args); await wait(400); return result; };
    api().queue.cancel = async (...args) => { const result = await realCancel(...args); await wait(400); return result; };
    try {
      const go = await steps(w, ui, made);
      await go();
      await wait(HUB.liveDebounceMs + 100);       // the echo has come and the window redrew, the reply has not
      assert.ok(ui.echo.delivered > 0);
      assert.notEqual(ui.live(), "", "the window said nothing while it was working");
      await wait(500);
      assert.match(ui.live(), name === "queue research" ? /^1 check queued/ : /^Cancelled: Research/);
    } finally { api().queue.submit = realSubmit; api().queue.cancel = realCancel; await ui.finish(); }
  });
}
