/**
 * Stage 1c #3: the GM research, day and formula tools take the actor's lock ("actor:<id>", the one the queue and the leads use) around their whole read-modify-write, so a tool that
 * overlaps a queued check or another tool no longer writes from a stale read. Through the real main.js in the fake Foundry.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { as, getApi, world } from "./fake-world.js";
import { actorKey, withLock } from "../scripts/queue/lock.js";

const api = () => getApi();
const days = w => w.ann.getFlag("pathfinder-progress", "downtimeDays");
const tick = ms => new Promise(r => setTimeout(r, ms));
const slowActorWrites = (actor, ms) => {
  const real = actor.update.bind(actor);
  actor.update = async (...args) => { await new Promise(r => setTimeout(r, ms)); return real(...args); };
  return () => { actor.update = real; };
};

test("ACTOR LOCK: every GM research, day and formula tool waits for the actor's lock (and runs after it is released)", async () => {
  const w = await world({ downtime: 6, iron: 3, fang: 3 });
  const gm = fn => as(w.gm, fn);
  const tools = {
    grantDays: () => api().grantDays(w.ann, 1),
    setDays: () => api().setDays(w.ann, 6),
    startProject: () => api().startProject({ actor: w.ann, recipe: "longsword-basic" }),
    abandonProject: () => api().abandonProject(w.ann, "unlock-longsword-basic"),
    research: () => api().research({ actor: w.ann, project: "unlock-longsword-basic", days: 1, skill: "crafting", degree: "success", chat: false }),
    addProgress: () => api().addProgress(w.ann, "unlock-longsword-basic", 1, "test", { chat: false }),
    grantFormula: () => api().grantFormula(w.ann, "longsword-basic"),
    removeFormula: () => api().removeFormula(w.ann, "longsword-basic"),
    refreshFormulas: () => api().refreshFormulas(w.ann)
  };
  for (const [name, call] of Object.entries(tools)) {
    let release;
    const held = withLock(actorKey(w.ann), () => new Promise(r => { release = r; }));
    await tick(0);
    let settled = false;
    const running = gm(call).then(() => { settled = true; }, () => { settled = true; });
    await tick(30);
    assert.equal(settled, false, `${name} waits while the actor's lock is held`);
    release();
    await held;
    await running;
    assert.equal(settled, true, `${name} ran after the lock was released`);
    // put the world back for the next tool: no formula, no project, 6 days
    await gm(() => api().setDays(w.ann, 6));
    await gm(() => api().removeFormula(w.ann, "longsword-basic")).catch(() => {});
    await gm(() => api().abandonProject(w.ann, "unlock-longsword-basic")).catch(() => {});
  }
});

test("ACTOR LOCK: overlapping day grants all count, and a grant that overlaps a GM research is not lost", async () => {
  const w = await world({ downtime: 0, iron: 3, fang: 3 });
  await as(w.gm, () => api().setDays(w.ann, 2));
  const restore = slowActorWrites(w.ann, 20);
  try {
    await as(w.gm, () => Promise.all([api().grantDays(w.ann, 1), api().grantDays(w.ann, 2), api().grantDays(w.ann, 4)]));
  } finally { restore(); }
  assert.equal(days(w), 9, "2 + 1 + 2 + 4: each grant started from the other's result");
  await as(w.gm, () => api().startProject({ actor: w.ann, recipe: "longsword-basic" }));
  const restore2 = slowActorWrites(w.ann, 20);
  try {
    await as(w.gm, () => Promise.all([
      api().research({ actor: w.ann, project: "unlock-longsword-basic", days: 2, skill: "crafting", degree: "failure", chat: false }),
      api().grantDays(w.ann, 5)
    ]));
  } finally { restore2(); }
  assert.equal(days(w), 9 - 2 + 5, "the research spent 2, the grant added 5, neither overwrote the other");
});
