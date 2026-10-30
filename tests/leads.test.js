/** Leads (Stage 11b round): a GM hands a character a lead; the player follows it through a relayed call that checks who is REALLY asking. */
import test from "node:test";
import assert from "node:assert/strict";
import { DAGGER, M, as, env, getApi, loudly, world } from "./fake-world.js";
import { findings } from "./scan.js";

const api = () => getApi();
const LONGSWORD = "longsword-basic";
const leadsOf = actor => actor.getFlag(M, "leads") ?? [];
const projects = actor => actor.getFlag(M, "projects") ?? [];
const give = (w, note = "A smith mentioned it.", recipe = LONGSWORD, actor = w.ann) => as(w.gm, () => api().research.giveLead(actor, recipe, note));
const follow = (w, user = w.annUser, leadId, actor = w.ann) => as(user, () => api().research.follow(actor, leadId));

test("LEADS: only a GM hands one over; it names the recipe, keeps the note, and refuses what cannot be a lead", async () => {
  const w = await world({ perClientDefinitions: true });
  await assert.rejects(as(w.annUser, () => api().research.giveLead(w.ann, LONGSWORD, "x")), /GM only/);
  const lead = await give(w);
  assert.deepEqual([lead.recipeId, lead.name, lead.note], [LONGSWORD, "Longsword (sample recipe)", "A smith mentioned it."]);
  assert.equal(leadsOf(w.ann).length, 1);
  await assert.rejects(give(w), /already has a lead/);
  await assert.rejects(give(w, "x", "no-such-recipe"), /unknown recipe/);
  await assert.rejects(give(w, "x", DAGGER), /already knows that formula/);
  await assert.rejects(give(w, "x".repeat(301), "dagger-spider-fang", w.bob), /note must be text of at most 300/);
  assert.deepEqual(findings(as(w.annUser, () => api().research.leads(w.ann))), []);
  assert.throws(() => as(w.bobUser, () => api().research.leads(w.ann)), /only read the leads of a character you own/);
});

test("LEADS: following one starts the research project (relayed, the player gets it without its DC), uses the lead up, and is not repeatable", async () => {
  const w = await world({ perClientDefinitions: true });
  const lead = await give(w);
  const project = await follow(w, w.annUser, lead.id);
  assert.deepEqual([project.id, project.goalName, project.status, project.progress, project.dc], [`unlock-${LONGSWORD}`, "Longsword (sample recipe)", "active", 0, undefined]);
  assert.ok(projects(w.ann).some(p => p.id === `unlock-${LONGSWORD}` && p.status === "active"), "the project exists on the character");
  assert.deepEqual(leadsOf(w.ann), [], "the lead is used up");
  assert.deepEqual(env.handlerThrows, []);
  await assert.rejects(follow(w, w.annUser, lead.id), /no such lead any more/);
});

test("LEADS: a GM may follow a lead on a player's behalf and keeps the full project", async () => {
  const w = await world({ perClientDefinitions: true });
  const lead = await give(w);
  const project = await follow(w, w.gm, lead.id);
  assert.ok(Number.isInteger(project.dc), "the GM's copy has its DC");
});

test("LEADS: only the owner can follow, and the sender is the REAL one: an id the client wrote into the payload counts for nothing", async () => {
  const w = await world({ perClientDefinitions: true });
  const lead = await give(w);
  await assert.rejects(follow(w, w.bobUser, lead.id), /does not own Ann/);
  assert.deepEqual(projects(w.ann).filter(p => p.id === `unlock-${LONGSWORD}`), [], "nothing started");
  const handler = env.handlers.get("researchFollow");
  const call = (context, payload) => as(w.gm, () => handler.call(context, payload));
  // Bob's client wrote Ann's id into the payload: the real sender (socketlib's) is Bob.
  const spoof = await call({ socketdata: { userId: "u-bob" } }, { actorId: w.ann.id, leadId: lead.id, userId: "u-ann" });
  assert.equal(spoof.__relay, "refused");
  assert.match(spoof.message, /does not own Ann/);
  // No real sender at all, and a payload id that is not this GM's own: refused (never trusted).
  const none = await call(undefined, { actorId: w.ann.id, leadId: lead.id, userId: "u-ann" });
  assert.equal(none.__relay, "refused");
  assert.match(none.message, /did not say who is asking/);
  assert.equal(leadsOf(w.ann).length, 1, "the lead is untouched by all of those");
  // The real owner, by the same route, is fine.
  const ok = await call({ socketdata: { userId: "u-ann" } }, { actorId: w.ann.id, leadId: lead.id });
  assert.equal(ok.status, "active");
});

test("LEADS: it fails LOUDLY and plainly when the lead is gone, already started, already known, or its recipe no longer exists", async () => {
  const w = await world({ perClientDefinitions: true });
  await assert.rejects(follow(w, w.annUser, "nope"), /no such lead any more/);
  // already being researched (the GM started the project by hand after giving the lead)
  const lead = await give(w);
  await as(w.gm, () => api().startProject({ actor: w.ann, recipe: LONGSWORD }));
  await assert.rejects(follow(w, w.annUser, lead.id), /already researching it. The lead is already used up/);
  // already known
  const w2 = await world({ perClientDefinitions: true });
  const lead2 = await give(w2);
  await as(w2.gm, () => api().grantFormula(w2.ann, LONGSWORD));
  await assert.rejects(follow(w2, w2.annUser, lead2.id), /already knows that formula/);
  // the recipe was deleted from the definitions after the lead was given
  const w3 = await world({ perClientDefinitions: true });
  const lead3 = await give(w3);
  api().definitions.recipe.delete(LONGSWORD);
  await assert.rejects(follow(w3, w3.annUser, lead3.id), /no longer exists. Ask the GM/);
  assert.equal(leadsOf(w3.ann).length, 1, "a failed follow keeps the lead");
  const generic = await loudly(async () => follow(w3, w3.annUser, lead3.id).catch(e => e.message));
  assert.doesNotMatch(String(generic), /Something went wrong|socketlib/i);
});

test("LEADS: a damaged lead is skipped (and said so in the console), never shown", async () => {
  const w = await world({ perClientDefinitions: true });
  await w.ann.setFlag(M, "leads", [{ id: "x", recipeId: "BAD ID", name: 5 }]);
  const seen = [];
  const spy = console.error; console.error = (...a) => seen.push(String(a[0]));
  try { assert.deepEqual(as(w.annUser, () => api().research.leads(w.ann)), []); } finally { console.error = spy; }
  assert.match(seen.join(" "), /damaged lead/);
});
