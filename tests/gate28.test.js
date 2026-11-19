/**
 * The explore-and-sender gate (docs/28-explore-sender-gate.md): every code block is extracted and run, in order, as the right client, in the fake Foundry with the realistic fake socketlib (the
 * handler's `this.socketdata.userId` is the user who SENT the message, as in the real one). It plays each step as its own sub-test, then proves the gate CATCHES what it is for: a module that
 * believed the `userId` in the payload (every relayed handler here is replaced, in turn, by one that does) must make the matching steps FAIL.
 *
 * What the fake cannot show: that real socketlib really hands the handler the real sender, how two real socket messages interleave on a real GM client, a real PF2e Perception roll, and when a real
 * Player window receives a whisper or an updated setting (the late-update tests below only make the fake's Player window see the setting and the flags later, as real Foundry does).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { as, enableEcho, env, getApi, getUsers, makeRegistry, M, world } from "./fake-world.js";
import script from "../e2e/steps/gate28.steps.mjs";

const gateDoc = readFileSync("docs/28-explore-sender-gate.md", "utf8");
const MODULE_VERSION = JSON.parse(readFileSync("module.json", "utf8")).version;
const GATE = new Map();
for (const match of gateDoc.matchAll(/^## Step (\d+) ((?:\[[^\]]+\](?: and )?)+)[^\n]*\n([\s\S]*?)(?=^## Step |(?![\s\S]))/gm)) {
  const block = match[3].match(/```js\n([\s\S]*?)```/);
  GATE.set(Number(match[1]), { who: match[2].trim(), code: block?.[1] ?? null, text: match[3] });
}
const roll = (degree, total, natural) => ({ options: { degreeOfSuccess: degree }, total, dice: [{ faces: 20, results: [{ result: natural, active: true }] }] });
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Run a block like a browser console would (top-level await wrapped), as a user, and collect every line it prints. */
async function run(step, user, { patch = code => code } = {}) {
  const entry = GATE.get(step);
  assert.ok(entry?.code, `docs/28-explore-sender-gate.md needs a code block in Step ${step}`);
  const code = patch(entry.code).replace(/^(\/\/[^\n]*\n)*\s*await \(/, match => match.replace("await (", "("));
  const lines = [], logged = console.log;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  try {
    const value = await as(user, () => (0, eval)(code));
    return { value, lines: lines.join("\n").split("\n").filter(Boolean) };
  } finally { console.log = logged; }
}
const reports = lines => lines.filter(l => l.startsWith("REPORT "));
const fails = lines => lines.filter(l => l.startsWith("FAIL"));
const freshWorld = () => world({ downtime: 0, iron: 0, fang: 0, perClientDefinitions: true });
const rolls = (actor, n) => { actor.perceptionRolls.length = 0; for (let i = 0; i < n; i++) actor.perceptionRolls.push(roll(2, 3, 1)); };
const actorNamed = name => game.actors.getName(name);

/** Steps 1 to 3: the versions, SETUP and the Player helper. Returns what the later steps need. */
async function setUp() {
  const w = await freshWorld();
  const { gm, testUser } = getUsers();
  const one = await run(1, gm);
  assert.deepEqual(one.value, ["GM", true, MODULE_VERSION, true]);
  const two = await run(1, testUser);
  assert.deepEqual(two.value, ["Test", false, MODULE_VERSION, true]);
  const setup = await run(2, gm);
  assert.equal(setup.value.testUsersCharacter, "Gate G28 Hero");
  const helper = await run(3, testUser);
  return { w, gm, testUser, setup, helper };
}
/** Play steps `from` to `to` in order, each as the client the doc names; every step must say ALL PASS and print a REPORT line. Returns each step's lines. */
async function play(ctx, from, to, { patch } = {}) {
  const seen = {};
  for (let step = from; step <= to; step++) {
    const user = GATE.get(step).who.startsWith("[GM]") ? ctx.gm : ctx.testUser;
    const out = await run(step, user, { patch: patch?.[step] });
    seen[step] = out;
    assert.equal(out.value, "ALL PASS", `step ${step}:\n${fails(out.lines).join("\n")}`);
    assert.ok(reports(out.lines).length > 0, `step ${step} prints at least one REPORT line`);
  }
  return seen;
}
const cleanUp = async ctx => (await run(14, ctx.gm)).value;
const done = () => { delete globalThis.__g28; delete globalThis.__p28; };

test("GATE 28: the doc has 14 steps, each labelled, with a bullet list and a result line", () => {
  assert.deepEqual([...GATE.keys()], Array.from({ length: 14 }, (_, i) => i + 1));
  const PLAYER = [3, 4, 6, 8, 10, 12];
  for (const [step, entry] of GATE) {
    assert.match(entry.who, step === 1 ? /^\[GM\] and \[Player\]$/ : PLAYER.includes(step) ? /^\[Player\]$/ : /^\[GM\]$/, `step ${step} says who runs it`);
    assert.ok(entry.code, `step ${step} has a code block`);
    assert.equal((entry.text.match(/```js/g) ?? []).length, 1, `step ${step} has ONE code block`);
    const section = entry.text.split("```js")[0];
    const bullets = section.split("\n").filter(l => /^- /.test(l));
    assert.ok(bullets.length >= 2, `step ${step} lists its instructions as bullets`);
    assert.ok(bullets.every(b => b.length <= 700), `step ${step}: every bullet is short (one action)`);
    assert.doesNotMatch(section.replace(/^- .*$/gm, ""), /\n[A-Z][^\n]{200,}/, `step ${step} has no long paragraph of instructions outside the bullets`);
    assert.ok(bullets.some(b => /You should see:/.test(b)), `step ${step} has a "You should see:" bullet`);
    assert.match(entry.code, /console\.log\(`REPORT|\.report\(|\.done\(\)/, `step ${step} prints a REPORT line`);
    // every check prints every value it compared
    for (const line of entry.code.split("\n").filter(l => /\b(?:g|p)\.check\(/.test(l) && !/check: \(/.test(l))) assert.match(line, /JSON\.stringify|\bdetail\b/, `step ${step}: a check line prints what it compared: ${line.slice(0, 90)}`);
  }
  assert.match(gateDoc, new RegExp(`version must be \\*\\*${MODULE_VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(gateDoc, /Force-reload BOTH windows first/);
  assert.match(gateDoc, /Every FAIL line prints each value it compared/);
  assert.match(gateDoc, /\*\*What the kit needs:\*\* nothing new/);
  assert.match(gateDoc, /## Step 14 \[GM\]: CLEANUP \(always run this, even if a step failed\)/);
  assert.doesNotMatch(gateDoc, /\bDC \d|odds of|\d+% chance/i, "the gate text never talks about difficulty to a player");
});

test("GATE 28: the kit needs no new action: the click script is empty and the doc says so", () => {
  assert.deepEqual([Object.keys(script.before ?? {}), Object.keys(script.after ?? {})], [[], []]);
  assert.match(readFileSync("e2e/steps/gate28.steps.mjs", "utf8"), /NO click\s+script and NO target action/);
});

test("GATE 28: every step runs in order as the right client, prints REPORT lines, and ends ALL PASS", async t => {
  const ctx = await setUp();
  try {
    assert.ok(reports((await run(1, ctx.gm)).lines).length === 1, "step 1 prints its REPORT line");
    assert.ok(reports(ctx.setup.lines).length >= 2 && reports(ctx.helper.lines).length === 1, "steps 2 and 3 print REPORT lines");
    const hero = actorNamed("Gate G28 Hero"), other = actorNamed("Gate G28 Other");
    rolls(hero, 6); rolls(other, 6);
    const seen = {};
    const step = async (n, check) => t.test(`step ${n}`, async () => {
      const user = GATE.get(n).who.startsWith("[GM]") ? ctx.gm : ctx.testUser;
      const out = await run(n, user);
      seen[n] = out;
      assert.equal(out.value, "ALL PASS", `step ${n}:\n${fails(out.lines).join("\n")}`);
      await check?.(out);
    });
    const REPORTS = (out, ...labels) => { for (const label of labels) assert.ok(out.lines.some(l => l.startsWith(`REPORT ${label}`)), `a REPORT line "${label}" is printed:\n${reports(out.lines).join("\n")}`); };

    await step(4, out => {
      REPORTS(out, "a) attempts before:", "a) payload sent:", "a) result:", "a) first read right after the call:", "a) attempts after:", "a) the stored scene state:");
      assert.match(out.lines.find(l => l.startsWith("REPORT a) attempts before:")), /: \{\}$/);
      assert.match(out.lines.find(l => l.startsWith("REPORT a) attempts after:")), /^REPORT a\) attempts after: \{"Gate G28 Hero":\d+\}$/);
      assert.equal(hero.perceptionRolls.length, 5, "one search, one Perception roll");
    });
    await step(5, out => { REPORTS(out, "a) GM sees the attempts:", "a) GM log: search entries (Hero, Other):", "a) resetSearches returned:"); });
    rolls(hero, 2);
    await step(6, out => {
      REPORTS(out, "b) first read (the GM's reset in step 5 must have arrived):", "b) payload sent twice, started together:", "b) both results:", "b) attempts after:", "b) whispers added:");
      assert.equal(hero.perceptionRolls.length, 1, "two searches started together made ONE Perception roll");
      const results = JSON.parse(out.lines.find(l => l.startsWith("REPORT b) both results:")).slice("REPORT b) both results: ".length));
      assert.deepEqual(results.map(r => r.message).sort(), ["You have already searched this area.", "You search the area."]);
    });
    await step(7, out => { REPORTS(out, "b) GM sees the attempts:", "b) GM log: search entries (Hero, Other):", "b) resetSearches returned:"); });
    rolls(hero, 3); rolls(other, 3);
    await step(8, out => {
      REPORTS(out, "c) attempts first read (the GM's reset in step 7 must have arrived):", "c1) forged payload for Gate G28 Other (the GM's id):", "c1) result:", "c1) attempts after (whose attempt was recorded):", "c2) forged payload for Gate G28 Hero (the GM's id):", "c2) result:", "c2) attempts after (whose attempt was recorded):");
      assert.equal(other.perceptionRolls.length, 3, "no Perception roll was made for Other");
      assert.match(out.lines.find(l => l.startsWith("REPORT c1) result:")), /You can only search with a character you own\./);
    });
    await step(9, out => { REPORTS(out, "c) GM sees the attempts:", "c) GM log: search entries (Hero, Other):", "c) resetSearches returned:"); });
    await step(10, out => {
      REPORTS(out, "d) queue submit for Other: payload:", "d) queue submit for Other: result:", "d) queue submit for Other: changed?:", "d) queue cancel for Other: result:", "d) workshop start for Other: result:", "d) workshop put-aside for Other: result:",
        "d) control submit for Hero: result:", "d) control cancel for Hero: result:", "d) control workshop start for Hero: result:", "d) control workshop put-aside for Hero: result:");
      const forged = out.lines.filter(l => /^REPORT d\) .* for Other: payload:/.test(l));
      assert.equal(forged.length, 4);
      assert.ok(forged.every(l => l.includes(`"userId":"${getUsers().gm.id}"`)), "every forged payload carries the GM's id");
      for (const l of out.lines.filter(l => /^REPORT d\) .* for Other: result:/.test(l))) assert.match(l, /"__relay":"refused","message":"(submit|cancel|workshop): Test does not own Gate G28 Other"/);
    });
    await step(11, out => { REPORTS(out, "d) Hero:", "d) Other:", "d) audit scan:"); });
    await step(12, out => { REPORTS(out, "e) calls made by this window:", "e) distinct messages it got back:"); });
    await step(13, out => { REPORTS(out, "e) the GM's own call, forged user id, no such character: what came back:"); });
    await t.test("step 14: CLEANUP leaves the world exactly as SETUP found it, and is safe twice", async () => {
      const first = await run(14, ctx.gm);
      assert.deepEqual([first.value.problems, first.value.actorsLeft, first.value.sceneLeft, first.value.matchesStart, first.value.gateEventsLeft, first.value.explorationStateLeft], [[], 0, false, true, 0, 0], JSON.stringify(first.value));
      assert.ok(reports(first.lines).some(l => l.startsWith("REPORT CLEANUP:")));
      const again = await run(14, ctx.gm);
      assert.deepEqual([again.value.problems, again.value.actorsLeft, again.value.sceneLeft, again.value.matchesStart], [[], 0, false, "nothing to compare"]);
      assert.equal(game.actors.getName("Gate G28 Hero"), undefined);
      assert.equal(game.scenes.getName("Gate G28 Field"), undefined);
      assert.equal(env.values.partyLocation, "oakhaven", "the party location is put back");
      assert.equal(getUsers().testUser.character ?? null, null, "Test's character is put back");
      for (const id of ["g28-ore", "g28-gem"]) assert.equal(getApi().definitions.material.has(id), false, `${id} is removed`);
    });
  } finally { done(); }
});

test("GATE 28: SETUP is safe to run again, rebuilds the helper after a GM reload, and refuses what it did not make", async () => {
  const ctx = await setUp();
  try {
    const again = await run(2, ctx.gm);
    assert.equal(again.value.already, "set up");
    getApi().definitions = makeRegistry(); delete globalThis.__g28;                    // a GM-window reload wipes the memory-only definitions and the helper
    const rebuilt = await run(2, ctx.gm);
    assert.equal(rebuilt.value.already, "set up");
    assert.ok(globalThis.__g28 && getApi().definitions.station.has("g28-bench"), "the helper and the definitions are back");
    assert.equal(game.actors.filter(a => a.name === "Gate G28 Hero").length, 1, "no second Hero");
    assert.equal((await cleanUp(ctx)).matchesStart, true);
    const intruder = await Actor.create({ name: "Gate G28 Hero", type: "character", flags: {} });   // somebody else's actor with the same name
    await assert.rejects(run(2, ctx.gm), /already exists and was not made by this check/);
    await intruder.delete();
  } finally { done(); }
});

test("GATE 28: CLEANUP works from the middle of the gate, and says so when the world is not as SETUP found it", async () => {
  const ctx = await setUp();
  try {
    rolls(actorNamed("Gate G28 Hero"), 3);
    await play(ctx, 4, 4);
    const clean = await cleanUp(ctx);
    assert.deepEqual([clean.problems, clean.actorsLeft, clean.sceneLeft, clean.matchesStart, clean.gateEventsLeft], [[], 0, false, true, 0], JSON.stringify(clean));
  } finally { done(); }
  const second = await setUp();
  try {
    await Actor.create({ name: "Somebody Else", type: "character", flags: {} });            // appears after SETUP: the world no longer matches the fingerprint
    const clean = await cleanUp(second);
    assert.equal(clean.matchesStart, false);
    assert.ok(clean.problems.some(p => /the world differs from how SETUP found it: start .*Somebody Else|the world differs from how SETUP found it: start/.test(p)), JSON.stringify(clean.problems));
    assert.match(clean.problems.join(" "), /"actors":\[/, "the message prints the fingerprint it compared");
  } finally { done(); }
});

/** A module that believes the `userId` in the payload: the registered handler is run as if that user had sent the message (the thing senderOf exists to prevent). */
function trustThePayload(names) {
  for (const name of names) {
    const real = env.handlers.get(name);
    assert.ok(real, `a "${name}" handler is registered`);
    env.handlers.set(name, function trusting(payload) { return real.call({ socketdata: { userId: payload?.userId } }, payload); });
  }
}
const HANDLERS = ["search", "queueSubmit", "queueCancel", "workshopStart", "workshopAside"];

test("GATE 28 MUTATION: a module that trusts the id in the search payload fails step 8 (Other is searched as the GM and gets an attempt)", async () => {
  const ctx = await setUp();
  try {
    const hero = actorNamed("Gate G28 Hero"), other = actorNamed("Gate G28 Other");
    rolls(hero, 6); rolls(other, 6);
    await play(ctx, 4, 7);
    trustThePayload(["search"]);
    const out = await run(8, ctx.testUser);
    assert.notEqual(out.value, "ALL PASS");
    const lines = fails(out.lines).join("\n");
    assert.match(lines, /FAIL: the search for Other is refused in the plain words, as the Player/);
    assert.match(lines, /FAIL: no attempt was recorded for Other, or for anyone \(\{"Gate G28 Other":\d+\}\)/, "and it prints the attempt that was recorded for Other");
    const gm = await run(9, ctx.gm);
    assert.notEqual(gm.value, "ALL PASS", "the GM's own view catches it too");
  } finally { done(); }
});

for (const [handler, label, pattern] of [
  ["queueSubmit", "queue submit", /FAIL: queue submit for Other: refused, and the refusal names the real sender/],
  ["queueCancel", "queue cancel", /FAIL: queue cancel for Other: refused, and the refusal names the real sender/],
  ["workshopStart", "workshop start", /FAIL: workshop start for Other: refused, and the refusal names the real sender/],
  ["workshopAside", "workshop put-aside", /FAIL: workshop put-aside for Other: refused, and the refusal names the real sender/]
]) {
  test(`GATE 28 MUTATION: a module that trusts the id in the ${label} payload fails step 10 and the GM's own step 11`, async () => {
    const ctx = await setUp();
    try {
      rolls(actorNamed("Gate G28 Hero"), 6);
      trustThePayload([handler]);
      const out = await run(10, ctx.testUser);
      assert.notEqual(out.value, "ALL PASS");
      const lines = fails(out.lines).join("\n");
      assert.match(lines, pattern);
      assert.match(lines, new RegExp(`FAIL: ${label} for Other: nothing changed for anyone`), "and the 'nothing changed' check names the change it saw");
      const gm = await run(11, ctx.gm);
      assert.notEqual(gm.value, "ALL PASS", "the GM's own view sees Other's queue or workshop changed");
    } finally { done(); }
  });
}

test("GATE 28 MUTATION: with every relayed handler trusting the payload, steps 8 and 10 both fail and print what each compared", async () => {
  const ctx = await setUp();
  try {
    rolls(actorNamed("Gate G28 Hero"), 6); rolls(actorNamed("Gate G28 Other"), 6);
    trustThePayload(HANDLERS);
    const eight = await run(8, ctx.testUser), ten = await run(10, ctx.testUser);
    assert.notEqual(eight.value, "ALL PASS");
    assert.notEqual(ten.value, "ALL PASS");
    assert.equal(fails(ten.lines).filter(l => /for Other: refused, and the refusal names the real sender/.test(l)).length, 4, "all four forged calls are caught");
    for (const line of [...fails(eight.lines), ...fails(ten.lines)]) assert.match(line, /\(.+\)$/, `a FAIL line prints what it compared: ${line.slice(0, 80)}`);
  } finally { done(); }
});

test("GATE 28 (e): the 'did not say who is asking' refusal is reached only with NO socket sender, which a Player call never has (the gate does not fake it)", async () => {
  const ctx = await setUp();
  try {
    rolls(actorNamed("Gate G28 Hero"), 8); rolls(actorNamed("Gate G28 Other"), 8);
    await play(ctx, 4, 4);
    await play(ctx, 5, 10);
    // what a call WITHOUT a sender gets (fake-only: it needs a call the real socket never makes)
    const { searchRelayed } = await import("../scripts/socket.js");
    await assert.rejects(async () => as(ctx.testUser, () => searchRelayed({ actorId: "x", sceneId: "y", userId: getUsers().gm.id }, {})), /did not say who is asking/);
    // and what the gate's step 12 says about real Player calls
    const out = await run(12, ctx.testUser);
    assert.equal(out.value, "ALL PASS", fails(out.lines).join("\n"));
    // step 12 FAILS if a Player call ever came back with that refusal
    ctx.calls = globalThis.__p28.calls;
    ctx.calls.push({ handler: "search", payload: {}, result: { __relay: "refused", message: "This request did not say who is asking, so it was not done." } });
    const bad = await run(12, ctx.testUser);
    assert.notEqual(bad.value, "ALL PASS");
    assert.match(fails(bad.lines).join("\n"), /FAIL: not one answer was the refusal 'This request did not say who is asking'/);
  } finally { done(); }
});

/** The Player's window sees a setting a GM client wrote only some time later (and an actor's flags too), as real Foundry's does (E-013). */
function lateView(key, ms) {
  const realGet = game.settings.get, realSet = game.settings.set;
  let visible = realGet(M, key);
  game.settings.set = async (scope, k, v) => { await realSet(scope, k, v); if (k === key) setTimeout(() => { visible = structuredClone(v); }, ms); };
  game.settings.get = (scope, k) => (k === key && !game.user.isGM ? structuredClone(visible) : realGet(scope, k));
  return () => { game.settings.get = realGet; game.settings.set = realSet; };
}

test("GATE 28 (late updates): with the Player's window seeing the GM's writes 300 ms late, every Player step still waits, prints its first read, and passes", async () => {
  const ctx = await setUp();
  const restore = lateView("explorationState", 300);
  try {
    const hero = actorNamed("Gate G28 Hero"), other = actorNamed("Gate G28 Other");
    enableEcho(hero, ctx.testUser, 250); enableEcho(other, ctx.testUser, 250);
    rolls(hero, 8); rolls(other, 8);
    const seen = await play(ctx, 4, 12);
    const firstReads = Object.entries(seen).filter(([step]) => [6, 8].includes(Number(step))).map(([, out]) => out.lines.find(l => /first read/.test(l)));
    assert.ok(firstReads.every(l => /Gate G28 Hero/.test(l)), `the first read of steps 6 and 8 still showed the GM's earlier attempt (the reset had not arrived yet): ${firstReads.join(" | ")}`);
    assert.ok(seen[4].lines.some(l => /^REPORT a\) first read right after the call: \{\}$/.test(l)), "step 4's first read, right after the call, was still empty (the update had not arrived)");
  } finally { restore(); done(); }
});

test("GATE 28 (late updates, mutation): step 4 without its wait fails when the Player's window sees the attempt late, and prints the first read", async () => {
  const ctx = await setUp();
  const restore = lateView("explorationState", 300);
  try {
    rolls(actorNamed("Gate G28 Hero"), 4);
    const noWait = code => code.replace("const arrived = await p.until(() => Object.keys(p.attempts()).length === 1);", "const arrived = true;");
    const out = await run(4, ctx.testUser, { patch: noWait });
    assert.notEqual(out.value, "ALL PASS");
    assert.match(fails(out.lines).join("\n"), /FAIL: exactly one attempt is recorded, and it is Gate G28 Hero's \(\{"first":\{\},"after":\{\}\}\)/);
    assert.ok(out.lines.some(l => l.startsWith("REPORT a) first read right after the call: {}")));
  } finally { restore(); done(); }
});
