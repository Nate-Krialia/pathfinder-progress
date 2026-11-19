/**
 * Round 4 / stage 1 #8: the audit ledger is ONE setting every actor's entry lives in. Two commits (or a commit and a log line) overlapping used to read the same ledger and the
 * second write erased the first; a failed actor update put the WHOLE old ledger back and erased whatever landed meanwhile. Through the real audit store in the fake Foundry, whose
 * settings write takes a moment like a real one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { as, env, makeActor, quietly, world } from "./fake-world.js";
import * as audit from "../scripts/audit/store.js";

const wait = ms => new Promise(r => setTimeout(r, ms));
const KEY = "flags.pathfinder-progress.downtimeDays";
const days = { type: "days", delta: 1 };

test("AUDIT LOCK: three commits for three actors that overlap all leave their entries (the second write used to erase the first)", async () => {
  const w = await world({ downtime: 0 });
  const third = makeActor("Cara", { copper: 0, owners: [] }); game.actors.push(third);
  const actors = [w.ann, w.bob, third];
  await as(w.gm, () => quietly(() => Promise.all(actors.map(a => audit.commit(a, { [KEY]: 1 }, [days])))));
  assert.deepEqual(Object.keys(env.values.auditLedger).filter(k => k !== "_events").sort(), actors.map(a => a.id).sort());
});

test("AUDIT LOCK: a failed actor update takes back ONLY its own entry; another actor's commit that landed meanwhile stays", async () => {
  const w = await world({ downtime: 0 });
  const annBefore = structuredClone(env.values.auditLedger?.[w.ann.id]);
  const bobBefore = env.values.auditLedger?.[w.bob.id]?.history.length ?? 0;
  w.ann.update = async () => { await wait(40); throw new Error("the actor update failed"); };
  await as(w.gm, async () => {
    const failing = audit.commit(w.ann, { [KEY]: 1 }, [days]).catch(error => error);
    await wait(5);
    await audit.commit(w.bob, { [KEY]: 1 }, [days]);
    const error = await failing;
    assert.match(error.message, /the actor update failed/);
  });
  assert.deepEqual(env.values.auditLedger[w.ann.id], annBefore, "Ann's entry is what it was before the failed commit");
  assert.equal(env.values.auditLedger[w.bob.id].history.length, bobBefore + 1, "Bob's commit that landed meanwhile is kept");
});

test("AUDIT LOCK: a failed update puts back the entry the actor had before, not an empty one", async () => {
  const w = await world({ downtime: 0 });
  await as(w.gm, () => audit.commit(w.ann, { [KEY]: 1 }, [days]));
  const before = structuredClone(env.values.auditLedger[w.ann.id]);
  w.ann.update = async () => { throw new Error("nope"); };
  await as(w.gm, () => assert.rejects(audit.commit(w.ann, { [KEY]: 2 }, [days]), /nope/));
  assert.deepEqual(env.values.auditLedger[w.ann.id], before);
});

test("AUDIT LOCK: overlapping world-event lines and an accept all land", async () => {
  const w = await world({ downtime: 0 });
  await as(w.gm, () => Promise.all([audit.logWorldEvent("one"), audit.logWorldEvent("two"), audit.accept(w.ann), audit.logWorldEvent("three")]));
  assert.deepEqual(env.values.auditLedger._events.history.map(h => h.text), ["one", "two", "three"]);
  assert.ok(env.values.auditLedger[w.ann.id], "the accept landed too");
});
