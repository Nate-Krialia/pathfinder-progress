/**
 * Drives the REAL review window class (with a fake ApplicationV2 base) and the real stores:
 * every button the HTML renders must have a handler under exactly its data-action name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadDefinitions } from "../scripts/data/validate.js";
import * as research from "../scripts/research/store.js";
import * as queue from "../scripts/queue/store.js";
import { build, unhandledAction } from "../scripts/queue/review-app.js";
import { renderReview } from "../scripts/queue/review.js";
import { asPage, seedRecords } from "./helpers.js";

const MODULE = "pathfinder-progress";
const registry = loadDefinitions(seedRecords().map(({ file, data }) => ({ pack: "seed", entry: file, text: asPage(data) }))).registry;
const api = { definitions: registry, contexts: new Map(), uncraftable: new Set(), resolvedOutputs: new Map() };
const DAGGER = "unlock-dagger-spider-fang";
const clone = v => (v === undefined ? undefined : structuredClone(v));
const roll = (d, total, natural) => ({ options: { degreeOfSuccess: d }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });

function fakeActor(id, name) {
  const flags = {};
  const actor = {
    id, name, flags, isOwner: true, rolls: [],
    getFlag: (s, k) => clone(flags[k]),
    async setFlag(s, k, v) { flags[k] = clone(v); },
    async update(data) { for (const [p, v] of Object.entries(data)) flags[p.replace("flags.pathfinder-progress.", "")] = clone(v); },
    skills: { crafting: { mod: 5, check: { roll: async () => actor.rolls.shift() } } }
  };
  return actor;
}

function install(actors) {
  const values = { auditLedger: {} };
  const list = [...actors]; list.get = id => list.find(a => a.id === id);
  const notices = { info: [], warn: [], error: [] };
  let n = 0;
  globalThis.game = { user: { isGM: true }, i18n: { localize: t => t }, actors: list, settings: { get: (s, k) => clone(values[k]), set: async (s, k, v) => { values[k] = clone(v); } } };
  globalThis.foundry = {
    utils: { randomID: () => `id${++n}` },
    applications: { api: { ApplicationV2: class { constructor(o) { this.options = { ...this.constructor.DEFAULT_OPTIONS, ...o }; this.renders = 0; } async render() { this.renders++; } } } }
  };
  globalThis.CONFIG = { PF2E: { skills: { crafting: { label: "Crafting" } } } };
  globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
  globalThis.CSS = { escape: s => s };
  globalThis.ui = { notifications: { info: m => notices.info.push(m), warn: m => notices.warn.push(m), error: m => notices.error.push(m) } };
  return notices;
}

async function setup() {
  const a = fakeActor("a1", "Aelwyn");
  const notices = install([a]);
  await research.grantDays(a, 10);
  await research.startProject(api, { actor: a, recipe: "dagger-spider-fang" });
  const Window = build();
  const app = new Window(api);
  // A minimal element: the days input and a click listener registry.
  app.element = { querySelector: () => ({ value: app.daysInput ?? "" }), addEventListener() {} };
  return { a, notices, app, actions: Window.DEFAULT_OPTIONS.actions };
}
const call = (app, actions, name, dataset = {}) => actions[name].call(app, {}, { dataset });
const pending = a => a.getFlag(MODULE, "pendingActions") ?? [];

test("every data-action the review HTML can render has a handler under EXACTLY that name", async () => {
  const { a, actions } = await setup();
  const action = await queue.submit(a, "research", { projectId: DAGGER }, 2);
  const html = renderReview({
    rows: queue.list(),
    results: [{ actorId: "a1", actionId: action.id, status: "error", message: "x" }],
    audit: [{ actorId: "a1", name: "A", mismatches: [{ kind: "days", message: "m" }], history: [] }]
  });
  const names = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual([...names].sort(), ["accept", "edit-days", "refresh", "reject", "resolve", "resolve-all", "retry"]);
  for (const name of names) assert.equal(typeof actions[name], "function", `no handler for data-action="${name}"`);
});

test("Resolve all runs the real handler: resolves, records results, redraws", async () => {
  const { a, app, actions } = await setup();
  await queue.submit(a, "research", { projectId: DAGGER }, 2);
  a.rolls.push(roll(2, 18, 12), roll(2, 18, 12));
  await call(app, actions, "resolve-all");
  assert.equal(pending(a).length, 0);
  assert.equal(app.results[0].status, "resolved", JSON.stringify(app.results));
  assert.ok(app.renders >= 1);
});

test("Resolve all with an empty queue says so instead of doing nothing", async () => {
  const { notices, app, actions } = await setup();
  await call(app, actions, "resolve-all");
  assert.match(notices.info.at(-1), /nothing is queued/);
});

test("a failing action shows an error row and never throws out of the handler; Retry then works", async () => {
  const { a, app, actions } = await setup();
  const action = await queue.submit(a, "research", { projectId: DAGGER }, 1);
  await call(app, actions, "resolve-all");            // no rolls queued: unexpected failure
  assert.equal(app.results[0].status, "error");
  assert.equal(pending(a).length, 1);
  a.rolls.push(roll(2, 18, 12));
  await call(app, actions, "retry", { actor: "a1", actionId: action.id });
  assert.equal(pending(a).length, 0);
  assert.equal(app.results.at(-1).status, "resolved");
});

test("Resolve, Reject, Set days, Refresh and Accept each do their job", async () => {
  const { a, app, actions } = await setup();
  const first = await queue.submit(a, "research", { projectId: DAGGER }, 2);
  app.daysInput = "5";
  await call(app, actions, "edit-days", { actor: "a1", actionId: first.id });
  assert.equal(pending(a)[0].daysReserved, 5);
  await call(app, actions, "reject", { actor: "a1", actionId: first.id });
  assert.deepEqual([pending(a).length, a.getFlag(MODULE, "downtimeDays")], [0, 10]);

  const second = await queue.submit(a, "research", { projectId: DAGGER }, 1);
  a.rolls.push(roll(2, 18, 12));
  await call(app, actions, "resolve", { actor: "a1", actionId: second.id });
  assert.equal(pending(a).length, 0);

  const before = app.renders;
  await call(app, actions, "refresh");
  assert.equal(app.renders, before + 1);

  await a.setFlag(MODULE, "downtimeDays", 99);
  await call(app, actions, "accept", { actor: "a1" });
  assert.deepEqual((await import("../scripts/audit/store.js")).scan(), []);
});

test("a bad Set days value reports the error and keeps the window alive", async () => {
  const { a, notices, app, actions } = await setup();
  const first = await queue.submit(a, "research", { projectId: DAGGER }, 2);
  app.daysInput = "999";
  await call(app, actions, "edit-days", { actor: "a1", actionId: first.id });
  assert.match(notices.error.at(-1), /cannot raise to 999/);
  assert.equal(pending(a)[0].daysReserved, 2);
});

// A fake button: closest("[data-action]") returns itself; closest(".pfp-review") says whether it sits in our content.
const button = (action, inContent) => ({ dataset: { action }, closest(sel) { return sel === "[data-action]" ? this : (inContent ? {} : null); } });

test("the unknown-action fallback ignores Foundry's own header buttons but still catches our typos", () => {
  const actions = { resolve() {} };
  for (const name of ["close", "minimize", "toggleControls"]) {
    assert.equal(unhandledAction(button(name, false), actions), null, name);
    assert.equal(unhandledAction(button(name, true), actions), null, `${name} even inside the content`);
  }
  assert.equal(unhandledAction(button("someHeaderThing", false), actions), null, "outside our content: not ours");
  assert.equal(unhandledAction(button("resolve", true), actions), null, "handled");
  assert.equal(unhandledAction(button("resolve-al", true), actions), "resolve-al", "a typo in our content is reported");
  assert.equal(unhandledAction({ closest: () => null }, actions), null, "not a button");
  assert.equal(unhandledAction(null, actions), null);
});
