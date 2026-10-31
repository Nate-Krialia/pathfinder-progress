/**
 * Chat from the queue's reject/cancel/resolve paths (v0.19.1). A rejected Compendium share used to be announced in PUBLIC chat ("the GM returned Share: Gate Wolf"),
 * which told the whole party about a private discovery. A share is private by default: its rejection goes to the character's owners and the GM only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rejectAll } from "../scripts/queue/store.js";
import { DAGGER, M, SEL, addNode, as, craft, env, gatherCall, getApi, getUsers, world } from "./fake-world.js";

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

// EVERY kind of rejection is a whisper (v0.19.2): the text names private things (a research project, a blueprint, a patron, a region).
const submitAs = (w, type, params, days) => as(w.annUser, () => api().queue.submit(w.ann, type, params, days));
const KINDS = {
  research: { name: "Longsword", queue: async w => { await as(w.gm, () => api().startProject({ actor: w.ann, recipe: "longsword-basic" })).catch(() => {}); return submitAs(w, "research", { projectId: "unlock-longsword-basic", skill: "crafting" }, 1); } },
  craft: { name: "Spider Fang Dagger|Dagger", queue: w => craft(w) },
  explore: { name: "Oak Wood", queue: async w => { await as(w.gm, () => api().tagScene(w.table, "oak-wood")); await as(w.gm, () => api().placeAnchors(8, { scene: w.table })); return submitAs(w, "explore", { region: "oak-wood", skill: "survival" }, 2); } },
  gather: { name: "Herb Patch", queue: async w => { const { token } = await addNode(w.table, { nodeType: "herb", tier: 1, charges: 3 }); return gatherCall(w.annUser, w.ann, token, w.table); } },
  commission: { name: "Commission", queue: w => submitAs(w, "commission", { step: "request", crafter: "Bob", recipe: DAGGER, access: "loan", selection: SEL, payout: 12 }, 0) }
};
for (const [kind, spec] of Object.entries(KINDS)) {
  test(`REJECT ${kind}: the note is a whisper to the owners and the GM, never public, and chat:false posts nothing`, async () => {
    const w = await world({ downtime: 12 });
    const action = await spec.queue(w);
    env.chat.length = 0;
    await as(w.gm, () => api().queue.reject(w.ann, action.id));                       // the queue window's call: chat on by default
    assert.deepEqual(publicMessages(), [], `a rejected ${kind} was posted publicly`);
    assert.equal(env.chat.length, 1, "one whisper");
    assert.deepEqual([...env.chat[0].whisper].sort(), [w.annUser.id, getUsers().gm.id].sort(), "the character's owners plus the GM, nobody else");
    assert.match(env.chat[0].content, new RegExp(spec.name));
    const again = await spec.queue(w);
    env.chat.length = 0;
    await as(w.gm, () => api().queue.reject(w.ann, again.id, { chat: false }));
    assert.deepEqual(env.chat, []);
  });
}

test("GATHER summary: no chat message (public or whisper) carries a charge count, resolved from the queue or called directly", async () => {
  const w = await world({ downtime: 12 });
  const { token } = await addNode(w.table, { nodeType: "herb", tier: 1, charges: 3 });
  const action = await gatherCall(w.annUser, w.ann, token, w.table);
  env.chat.length = 0;
  await as(w.gm, () => api().queue.resolve(w.ann, action.id, { degree: "success", chat: true }));
  assert.ok(env.chat.length >= 1, "the gather was announced");
  assert.ok(env.chat.every(m => !/charge/i.test(m.content ?? "")), env.chat.map(m => m.content).join(" | "));
  assert.deepEqual(publicMessages().filter(m => /charge/i.test(m.content ?? "")), []);
});
