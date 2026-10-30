/** The Research tab's view-model (Stage 11b round): every state, every rule, and the leak scanner. */
import test from "node:test";
import assert from "node:assert/strict";
import { HUB } from "../scripts/config.js";
import { S } from "../scripts/hub/strings.js";
import { hubModel, openProject, selectProject, setSkill, stepDays, formulaList } from "../scripts/hub/viewmodels.js";
import { progressModel, researchRequest, researchTab, selectedProjectId } from "../scripts/hub/viewmodels-research.js";
import { renderHubMain, renderHubPage } from "../scripts/hub/render.js";
import { BAD, scanClean, sizeFree } from "./scan.js";
import { BIG_PROJECT, LEAD, PROJECT, UPGRADE, makeFacts, makeState, researchFacts, researchState } from "./hub-fixtures.js";

const text = html => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const detail = (facts, state) => researchTab(facts, state).detail;
const only = over => researchFacts({ projects: [PROJECT], leads: [], ...over });

test("RESEARCH: nothing yet says so plainly, with the leads section and no invented content", () => {
  const tab = researchTab(researchFacts({ projects: [], leads: [] }), researchState());
  assert.deepEqual([tab.list.heading, tab.list.empty, tab.list.cards], ["Active projects", "No research projects yet.", []]);
  assert.deepEqual([tab.list.leads.empty, tab.list.leads.emptyLine], ["No leads yet.", "Leads show up here when someone points you at a formula you could research."]);
  assert.deepEqual(tab.detail, { kind: "empty", text: "Pick a project on the left." });
});

test("RESEARCH: a lone project is selected for you; with several you pick (and a stale id falls back)", () => {
  assert.equal(selectedProjectId(only(), researchState()), PROJECT.id);
  assert.equal(selectedProjectId(researchFacts(), researchState()), null);
  assert.equal(selectedProjectId(researchFacts(), researchState({ projectId: UPGRADE.id })), UPGRADE.id);
  assert.equal(selectedProjectId(researchFacts(), researchState({ projectId: "gone" })), null);
  assert.equal(selectedProjectId(only(), researchState({ projectId: "gone" })), PROJECT.id);
  const cards = researchTab(researchFacts(), researchState({ projectId: UPGRADE.id })).list.cards;
  assert.deepEqual(cards.map(c => [c.name, c.pill, c.selected]), [["Gate Draught", "Formula", false], ["Gate Bench: tier upgrade", "Station upgrade", true]]);
});

test("RESEARCH: progress is step boxes (with the words 'Progress n of m') up to the limit, a bar beyond", () => {
  const small = progressModel(PROJECT);
  assert.deepEqual([small.text, small.boxes.length, small.boxes.filter(b => b.done).length], ["Progress 3 of 8", 8, 3]);
  const big = progressModel(BIG_PROJECT);
  assert.deepEqual([big.text, big.boxes, big.value, big.max], ["Progress 17 of 40", null, 17, 40]);
  assert.equal(progressModel({ ...PROJECT, threshold: HUB.research.maxStepBoxes, progress: 0 }).boxes.length, HUB.research.maxStepBoxes);
  assert.equal(progressModel({ ...PROJECT, threshold: HUB.research.maxStepBoxes + 1 }).boxes, null);
});

test("RESEARCH: the detail says what finishing gives, and 'Roll with' shows the skill and your OWN modifier only (never odds, never a DC)", () => {
  const d = detail(only(), researchState());
  assert.equal(d.goalLine, "Finishing teaches you the formula for Gate Draught.");
  assert.deepEqual(d.skills.options.map(o => [o.label, o.modifierText, o.selected]), [["Crafting", "Your modifier +7", false], ["Arcana", "Your modifier -1", false]]);
  const lone = detail(researchFacts({ projects: [BIG_PROJECT], leads: [] }), researchState());
  assert.deepEqual(lone.skills.options.map(o => [o.label, o.modifierText, o.selected]), [["Crafting", null, true]], "one skill is chosen for you; no modifier is shown when the sheet has none");
  assert.equal(detail(researchFacts({ projects: [UPGRADE] }), researchState()).goalLine, "Finishing upgrades the workshop.");
});

test("RESEARCH: the days stepper is one day per check, never below 1 and never above the free days", () => {
  const facts = only({ days: { free: 3, reserved: 0 } });
  assert.deepEqual([detail(facts, researchState()).days.text, detail(facts, researchState({ checkDays: 3 })).days.text], ["1 day (1 check)", "3 days (3 checks)"]);
  assert.deepEqual([detail(facts, researchState()).days.down.disabled, detail(facts, researchState({ checkDays: 3 })).days.up.disabled], [true, true]);
  assert.equal(detail(facts, researchState({ checkDays: 99 })).days.value, 3, "a stale value is clamped");
  assert.equal(stepDays(researchState(), 1, 3).checkDays, 2);
  assert.equal(stepDays(researchState({ checkDays: 3 }), 1, 3).checkDays, 3);
  assert.equal(stepDays(researchState(), -1, 3).checkDays, 1);
  assert.equal(stepDays(researchState(), 1, 0).checkDays, 1, "no free days: it stays at 1 and Queue says why it is off");
  assert.match(detail(facts, researchState()).days.note, /If you finish early, the days you did not use come back/);
});

test("RESEARCH: Queue N checks is off with a plain reason, in the order a player fixes things", () => {
  const q = (facts, state = researchState({ projectId: PROJECT.id, skill: "crafting" })) => detail(facts, state).queue;
  assert.deepEqual(q(only()), { text: "Queue 1 check", disabled: false, reason: null, checks: 1, skill: "crafting" });
  assert.equal(q(only({ downtime: { open: false, participant: false } })).reason, "Downtime isn't open right now");
  assert.equal(q(only({ downtime: { open: true, participant: false } })).reason, "Downtime is open, but you weren't here for it");
  assert.equal(q(only(), researchState()).reason, "Choose a skill to roll with first.");
  assert.equal(q(only({ queuedResearch: [{ actionId: "a1", projectId: PROJECT.id, days: 2, skill: "crafting" }] })).reason, "You already have checks queued on this. Cancel them first if you want to change them.");
  assert.equal(q(only({ days: { free: 0, reserved: 2 } })).reason, "You have no free days.");
  assert.equal(q(only(), researchState({ skill: "crafting", checkDays: 3 })).text, "Queue 3 checks");
  assert.equal(q(only({ days: { free: 6, reserved: 0 } }), researchState({ skill: "crafting", checkDays: 3 })).disabled, false);
});

test("RESEARCH: queued checks show on the card and the detail, with Cancel; Put aside is off until they are cancelled", () => {
  const facts = researchFacts({ queuedResearch: [{ actionId: "a1", projectId: PROJECT.id, days: 2, skill: "crafting" }] });
  const tab = researchTab(facts, researchState({ projectId: PROJECT.id }));
  assert.deepEqual(tab.list.cards.map(c => c.queued), ["Queued", ""]);
  assert.deepEqual(tab.detail.queuedNote, { text: "Queued: 2 checks, 2 days reserved. The GM rolls them in secret.", actionId: "a1", cancel: "Cancel and get the days back" });
  assert.deepEqual(tab.detail.aside.button, { text: "Put the project aside", disabled: true, why: "Cancel the queued checks first, then put it aside." });
  assert.equal(tab.detail.aside.confirm, null, "no confirm while research is queued, even if one was pending");
  assert.equal(detail(facts, researchState({ projectId: PROJECT.id, confirmAside: true })).aside.confirm, null);
});

test("RESEARCH: Put aside asks first ('Put aside? Progress is not kept.' with Confirm and Keep); a workshop project has no Put aside here", () => {
  const ask = detail(only(), researchState({ confirmAside: true })).aside;
  assert.deepEqual(ask.confirm, { text: "Put aside? Progress is not kept.", confirm: "Confirm", keep: "Keep" });
  assert.deepEqual(detail(only(), researchState()).aside.button, { text: "Put the project aside", disabled: false, why: null });
  const workshop = detail(researchFacts({ projects: [UPGRADE] }), researchState({ confirmAside: true })).aside;
  assert.deepEqual([workshop.kind, workshop.note, workshop.button, workshop.confirm], ["workshop", "A workshop project is put aside from the Workshop tab (coming in a later stage).", undefined, undefined]);
});

test("RESEARCH: recent checks are the last few, newest first, in plain words, and a GM's free-text note NEVER appears", () => {
  const log = [{ source: "gm", delta: 0, note: "DC raised to 18 because the GM felt like it" }, { source: "addProgress", delta: 2, note: "odds were 40% so I added two" },
    ...Array.from({ length: 6 }, (_, i) => ({ source: "research", degree: i % 2 ? "success" : "criticalFailure", delta: i % 2 ? 1 : 0, skill: "crafting", note: `secret ${i}` })), { source: "commission", degree: "success", delta: 1, note: "DC 20 learn roll" }];
  const rows = detail(only({ projects: [{ ...PROJECT, log }] }), researchState()).checks.rows.map(r => r.text);
  assert.equal(rows.length, HUB.research.recentChecks);
  assert.equal(rows[0], "Learn roll (commission): Success (+1)");
  assert.equal(rows[1], "Research check: Success (+1)");
  assert.equal(rows[2], "Research check: Critical failure (no progress)");
  assert.doesNotMatch(JSON.stringify(researchTab(only({ projects: [{ ...PROJECT, log }] }), researchState())), /secret|DC|odds|raised|felt like/);
  const older = detail(only({ projects: [{ ...PROJECT, log: log.slice(0, 2) }] }), researchState()).checks.rows.map(r => r.text);
  assert.deepEqual(older, ["Progress added by the GM: +2", "Progress added by the GM: no progress"]);
  assert.deepEqual(detail(only({ projects: [{ ...PROJECT, log: [] }] }), researchState()).checks, { heading: "Recent checks", rows: [], empty: "No checks yet." });
});

test("RESEARCH: a hint is shown only if it carries no DC, odds, percentage or difficulty wording", () => {
  const withHint = hint => detail(only({ projects: [{ ...UPGRADE, hint }] }), researchState()).hint;
  assert.equal(withHint("Gate Bench is already at tier level 2; put it aside to get your materials back"), "Gate Bench is already at tier level 2; put it aside to get your materials back");
  for (const bad of ["needs a DC 18 check", "only a 40% chance", "the odds are poor", "this is difficult now"]) assert.equal(withHint(bad), "This project needs the GM's attention. Ask the GM.", bad);
  assert.equal(withHint(null), null);
});

test("LEADS: a lead shows its name and the GM's note with Start researching; a used lead is off; a note with a DC is replaced", () => {
  const items = facts => researchTab(facts, researchState()).list.leads.items;
  assert.deepEqual(items(researchFacts()).map(l => [l.name, l.note, l.button]), [["Gate Lantern", "A glassblower in Gate Town mentioned it.", { text: "Start researching", disabled: false, why: null }]]);
  const used = items(researchFacts({ projects: [{ ...PROJECT, recipeId: LEAD.recipeId }] }))[0];
  assert.deepEqual([used.button.disabled, used.button.why], [true, "You already started this."]);
  assert.equal(items(researchFacts({ formulas: [{ recipeId: LEAD.recipeId, name: "x", access: "owned" }] }))[0].button.disabled, true);
  assert.equal(items(researchFacts({ leads: [{ ...LEAD, note: "easy, DC 15" }] }))[0].note, "(A note from the GM that can't be shown here.)");
  assert.equal(items(researchFacts({ leads: [{ ...LEAD, note: "" }] }))[0].note, "");
});

test("RESEARCH: the request for api.queue.submit exists only while the button is on", () => {
  const state = researchState({ projectId: PROJECT.id, skill: "crafting", checkDays: 2 });
  assert.deepEqual(researchRequest(only({ days: { free: 5, reserved: 0 } }), state), { projectId: PROJECT.id, skill: "crafting", days: 2, name: "Gate Draught" });
  assert.equal(researchRequest(only({ downtime: { open: false, participant: false } }), state), null);
  assert.equal(researchRequest(only(), researchState()), null, "no skill chosen");
  assert.equal(researchRequest(researchFacts(), researchState()), null, "no project chosen");
});

test("FORMULAE: 'Open in Research' on a researching card is live and names its project", () => {
  const facts = makeFacts({ researching: [{ id: "p1", goalName: "Gate Draught", recipeId: "gate-draught", progress: 3, threshold: 8 }] });
  const card = formulaList(facts, makeState()).cards.find(c => c.status === "researching");
  assert.deepEqual(card.openInResearch, { text: "Open in Research", disabled: false, why: null, projectId: "p1" });
  const html = renderHubMain(hubModel(facts, makeState()));
  assert.match(html, /data-action="open-in-research"[^>]*data-project="p1"/);
  assert.doesNotMatch(html.match(/<button[^>]*data-action="open-in-research"[^>]*>/)[0], /aria-disabled/);
});

test("STATE: opening a project switches tab and resets its skill, days and confirm; choosing the same one keeps them", () => {
  const state = researchState({ tab: "formulae", skill: "arcana", checkDays: 4, confirmAside: true });
  assert.deepEqual([openProject(state, "p").tab, openProject(state, "p").projectId, openProject(state, "p").skill, openProject(state, "p").checkDays, openProject(state, "p").confirmAside], ["research", "p", null, 1, false]);
  const chosen = selectProject(researchState({ projectId: "a", skill: "arcana", checkDays: 3 }), "a");
  assert.deepEqual([chosen.skill, chosen.checkDays], ["arcana", 3]);
  assert.deepEqual([selectProject(chosen, "b").skill, selectProject(chosen, "b").checkDays], [null, 1]);
  assert.equal(setSkill(researchState(), "arcana").skill, "arcana");
});

test("RESEARCH LEAK SCANNER: no state of the tab, no page and no string has a DC, odds, a percentage, a pace or difficulty wording, and no raw hidden field", () => {
  const facts = [
    researchFacts(), researchFacts({ projects: [], leads: [] }), researchFacts({ projects: [BIG_PROJECT, PROJECT, UPGRADE] }), only({ downtime: { open: false, participant: false } }),
    only({ queuedResearch: [{ actionId: "a1", projectId: PROJECT.id, days: 2, skill: "crafting" }], days: { free: 0, reserved: 2 } }),
    researchFacts({ projects: [{ ...UPGRADE, hint: "needs a DC 18 check, odds 40%" }], leads: [{ ...LEAD, note: "the odds are good" }] })
  ];
  const states = [researchState(), researchState({ projectId: PROJECT.id, skill: "crafting", checkDays: 2 }), researchState({ projectId: PROJECT.id, confirmAside: true }), researchState({ projectId: UPGRADE.id })];
  let n = 0;
  for (const f of facts) for (const s of states) {
    const model = hubModel(f, s);
    assert.deepEqual(scanClean(model), [], JSON.stringify(s));
    assert.doesNotMatch(sizeFree(text(renderHubPage(model, ["1 check queued on Gate Draught. 1 day reserved."]))), BAD);
    assert.doesNotMatch(sizeFree(JSON.stringify(model)), /pace|per day|expected|finish in|about \d+ days/i);
    n++;
  }
  assert.equal(n, 24);
  assert.match(S.daysNote, /^Each day is one check/);
});

test("RESEARCH: every control on the page is a real button that has a handler name, and an off one is aria-disabled with its reason", () => {
  const facts = researchFacts({ queuedResearch: [{ actionId: "a1", projectId: PROJECT.id, days: 2, skill: "crafting" }], downtime: { open: false, participant: false } });
  const html = renderHubMain(hubModel(facts, researchState({ projectId: PROJECT.id })));
  assert.doesNotMatch(html, /<div[^>]*(onclick|role="button")|<a [^>]*href/);
  const actions = new Set([...html.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
  for (const a of ["select-project", "set-skill", "days-down", "days-up", "queue-research", "cancel-queued", "put-aside", "follow-lead"]) assert.ok(actions.has(a), a);
  assert.match(html.match(/<button[^>]*data-action="queue-research"[^>]*>/)[0], /aria-disabled="true"[^>]*aria-describedby="why-research"/);
  assert.match(text(html), /Downtime isn't open right now/);
});
