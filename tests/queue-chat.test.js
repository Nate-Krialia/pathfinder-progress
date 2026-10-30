/**
 * Chat from the queue's reject/cancel/resolve paths (v0.19.1). A rejected Compendium share used to be announced in PUBLIC chat ("the GM returned Share: Gate Wolf"),
 * which told the whole party about a private discovery. A share is private by default: its rejection goes to the character's owners and the GM only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rejectAll } from "../scripts/queue/store.js";
import { M, as, env, getApi, getUsers, world } from "./fake-world.js";

const api = () => getApi();
const WOLF = { key: "gate-wolf", name: "Gate Wolf", type: "beast", firstAt: 1, yields: [] };

async function withWolf() {
  const w = await world({ downtime: 0, iron: 0, fang: 0 });
  await w.ann.update({ [`flags.${M}.compendium`]: { v: 1, materials: {}, creatures: { "gate-wolf": WOLF }, regions: {} } });
  env.chat.length = 0;
  return w;
}
const queueShare = w => as(w.annUser, () => api().queue.submit(w.ann, "share", { kind: "creature", key: "gate-wolf" }));
const publicMessages = () => env.chat.filter(m => !Array.isArray(m.whisper) || m.whisper.length === 0);

test("SHARE REJECT (the GM queue window's path: chat on by default): nothing is public, and the whisper goes to the owners and the GM only", async () => {
  const w = await withWolf();
  const action = await queueShare(w);
  await as(w.gm, () => api().queue.reject(w.ann, action.id));            // exactly what the GM queue window calls
  assert.deepEqual(publicMessages(), [], "no public message at all");
  assert.ok(!publicMessages().some(m => /Gate Wolf/.test(m.content ?? "")), "no public message names the entry");
  const told = env.chat.filter(m => /Gate Wolf/.test(m.content ?? ""));
  assert.equal(told.length, 1, "the owner and the GM are told once, in one whisper");
  assert.deepEqual([...told[0].whisper].sort(), [w.annUser.id, getUsers().gm.id].sort(), "recipients: the character's owners plus the GM, nobody else");
  assert.ok(!told[0].whisper.includes(w.bobUser.id), "another player is not told");
  assert.match(told[0].content, /Gate Wolf/);
  assert.match(told[0].content, /stays private/);
});

test("SHARE REJECT with chat off posts nothing, and force-ending the period (rejectAll) posts nothing either", async () => {
  const w = await withWolf();
  const action = await queueShare(w);
  await as(w.gm, () => api().queue.reject(w.ann, action.id, { chat: false }));
  assert.deepEqual(env.chat, []);
  await queueShare(w);
  await as(w.gm, () => rejectAll({ chat: true }));            // chat requested: still only a whisper
  assert.deepEqual(publicMessages(), []);
  assert.ok(!publicMessages().some(m => /Gate Wolf/.test(m.content ?? "")));
});
