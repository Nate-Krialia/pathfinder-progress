/**
 * Round 2 (1b #3): every relayed (socket) handler takes WHO is asking from the socket's own sender, never from a userId a client put in the payload. A Player who sends the GM's id (or the
 * owner's) is still the Player; with no socket sender only the local GM's own id is believed. Through the real main.js and the fake socketlib.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, craft, env, snapshot, world } from "./fake-world.js";

const handler = name => env.handlers.get(name);
const fromSocket = userId => ({ socketdata: { userId } });
const REFUSED_NO_SENDER = { __relay: "refused", message: "This request did not say who is asking, so it was not done." };
const notOwner = result => result?.__relay === "refused" && /does not own Ann/.test(result.message);

test("RELAYED SENDER: a Player who puts the GM's id (or Ann's) in the payload is still Bob, so every relayed handler refuses and changes nothing", async () => {
  const w = await world();
  const action = await craft(w);                                                // Ann queued a craft
  const before = snapshot(w);
  for (const claimed of [w.gm.id, w.annUser.id]) {
    const asBob = payload => ({ ...payload, userId: claimed });
    assert.ok(notOwner(await as(w.gm, () => handler("queueSubmit").call(fromSocket(w.bobUser.id), asBob({ actorId: w.ann.id, type: "craft", params: {}, days: 1 })))), `queueSubmit, payload claims ${claimed}`);
    assert.ok(notOwner(await as(w.gm, () => handler("queueCancel").call(fromSocket(w.bobUser.id), asBob({ actorId: w.ann.id, actionId: action.id })))), `queueCancel, payload claims ${claimed}`);
    assert.ok(notOwner(await as(w.gm, () => handler("workshopStart").call(fromSocket(w.bobUser.id), asBob({ actorId: w.ann.id, mode: "upgrade", params: {} })))), `workshopStart, payload claims ${claimed}`);
    assert.ok(notOwner(await as(w.gm, () => handler("workshopAside").call(fromSocket(w.bobUser.id), asBob({ actorId: w.ann.id, params: { projectId: "x" } })))), `workshopAside, payload claims ${claimed}`);
  }
  assert.equal(snapshot(w), before, "nothing changed");
  assert.deepEqual(env.handlerThrows, []);
});

test("RELAYED SENDER: with no socket sender a payload id is NOT believed (not Ann's, not Bob's, not an unknown one); only the local GM's own id is", async () => {
  const w = await world();
  const action = await craft(w);
  const before = snapshot(w);
  for (const [name, payload] of [
    ["queueSubmit", { actorId: w.ann.id, type: "craft", params: {}, days: 1 }],
    ["queueCancel", { actorId: w.ann.id, actionId: action.id }],
    ["workshopStart", { actorId: w.ann.id, mode: "upgrade", params: {} }],
    ["workshopAside", { actorId: w.ann.id, params: { projectId: "x" } }]
  ]) {
    for (const userId of [w.annUser.id, w.bobUser.id, "nobody"]) {
      assert.deepEqual(await as(w.gm, () => handler(name).call(undefined, { ...payload, userId })), REFUSED_NO_SENDER, `${name} with no sender, payload claims ${userId}`);
    }
  }
  assert.equal(snapshot(w), before, "nothing changed");
  // the one direct call that IS accepted: the GM's own client, with its own id (what api.queue.cancel does when a GM calls it)
  const cancelled = await as(w.gm, () => handler("queueCancel").call(undefined, { actorId: w.ann.id, actionId: action.id, userId: w.gm.id }));
  assert.equal(cancelled.__relay, undefined, "accepted");
  assert.ok(cancelled.refunded !== undefined, "and it cancelled Ann's action");
});

test("RELAYED SENDER: the real sender still works (the owner submits and cancels through the socket), whatever userId the payload carries", async () => {
  const w = await world();
  const queued = await craft(w);
  assert.ok(queued.id, "Ann's own submit through the relay worked");
  const result = await as(w.gm, () => handler("queueCancel").call(fromSocket(w.annUser.id), { actorId: w.ann.id, actionId: queued.id, userId: w.bobUser.id }));
  assert.ok(result.refunded !== undefined, "Ann cancelled her own, although the payload named Bob");
});

test("RELAYED SENDER: no relayed entry point calls callerOf (the one that believes a payload id); a source scan, because a new handler would otherwise copy the old habit", () => {
  for (const file of ["scripts/queue/work.js", "scripts/queue/store.js", "scripts/workshop/store.js", "scripts/data/playerDefs.js", "scripts/research/leads.js", "scripts/socket.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /callerOf\(/, `${file} must use senderOf`);
  }
  assert.match(readFileSync("scripts/queue/common.js", "utf8"), /must NEVER be the identity check of a relayed/, "the comment says so");
});
