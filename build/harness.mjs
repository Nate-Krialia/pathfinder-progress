/**
 * The Downtime Hub render harness (Chromium via Playwright). It draws the SAME render function the window uses, with the real stylesheet, in a page that
 * behaves like Foundry v14 around it, and checks the layout with real geometry. Used by build/screens.mjs (screenshots) and tests/hub-layout.test.js.
 *
 * "Hostile Foundry": Foundry styles every unstyled <button>, <input>, <select>, heading, <p>, <fieldset> and <legend> (a fixed height, centred nowrap
 * text, margins, borders). The module's CSS has to win against that. The hostile sheets here apply those rules (loaded BEFORE hub.css, as Foundry's are)
 * at three strengths: a plain element selector, a high-specificity selector, and !important. Every state is rendered with and without them.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUB } from "../scripts/config.js";
import { hubModel, learnedKey } from "../scripts/hub/viewmodels.js";
import { renderHubPage } from "../scripts/hub/render.js";
import { editorModel, renderEditor } from "../scripts/discovery/editor-model.js";
import { BENCH, BIG_PROJECT, BOOK_ENTRIES, FORGE, LEAD, PROJECT, STAR_EFFECT, STEEL_EFFECT, UPGRADE, compendiumFacts, compendiumState, makeBook, makeFacts, makeState, researchFacts, researchState } from "../tests/hub-fixtures.js";

const cssUrl = pathToFileURL(new URL("../styles/hub.css", import.meta.url).pathname).href;

export async function launchChromium() {
  const { chromium } = createRequire(import.meta.url)("playwright");   // pre-installed in the cloud sandbox; it has no ESM entry
  return chromium.launch();
}

// What Foundry does to plain elements, three strengths ---------------------------------------------------------------------------------------------------
const common = (button, extra = "") => `
  ${button} { height: HEIGHT; line-height: 1; text-align: center; padding: 0 0.5rem; overflow: OVERFLOW; white-space: nowrap; border: 1px solid #555; background: #2a2a2a; color: #eee; font-family: inherit; font-size: 0.875rem ${extra}; }
  input, select, textarea { height: 2rem; padding: 0 0.5rem; border: 1px solid #555; line-height: 1; }
  h1, h2, h3, h4 { margin: 0.6rem 0 0.4rem; border-bottom: 1px solid #777; font-weight: 700; line-height: 1.2; text-shadow: none; }
  h1 { font-size: 2rem; } h2 { font-size: 1.5rem; } h3 { font-size: 1.25rem; } h4 { font-size: 1.1rem; }
  p { margin: 0.75rem 0; } ul, ol { margin: 0.75rem 0; padding-left: 2rem; } li { margin: 0.25rem 0; }
  label { display: block; margin: 0.3rem 0; } legend { padding: 0 0.5rem; margin: 0 0 0.5rem; } fieldset { margin: 0.5rem 0; padding: 0 0.5rem 0.5rem; border: 2px groove #666; }
  span, div, section, nav, header { line-height: 1.6; }`;
export const HOSTILE = {
  "plain 2rem hidden": common("button", "").replaceAll("HEIGHT", "2rem").replaceAll("OVERFLOW", "hidden"),
  "plain 2.5rem visible": common("button", "").replaceAll("HEIGHT", "2.5rem").replaceAll("OVERFLOW", "visible"),
  "specific 2rem hidden": common(".application.window-app .window-content button, .application button[type='button']", "").replaceAll("HEIGHT", "2rem").replaceAll("OVERFLOW", "hidden"),
  "important 2.5rem": common("button", " !important; height: 2.5rem !important; line-height: 1 !important; white-space: nowrap !important; overflow: hidden !important; text-align: center !important; padding: 0 0.5rem !important").replaceAll("HEIGHT", "2.5rem").replaceAll("OVERFLOW", "hidden")
};
const windowCss = `
  html, body { margin: 0; background: #444; font-family: "Signika", sans-serif; font-size: 16px; }
  .application { background: #1b1b1b; color: #ddd; border: 1px solid #000; box-sizing: border-box; }
  .application .window-content { padding: 0.5rem; overflow: auto; height: 100%; box-sizing: border-box; background: #232323; }`;

// The states ---------------------------------------------------------------------------------------------------------------------------------------------
const learned = {
  [learnedKey("gate-blade", "blade", "gate-steel")]: { known: true, effects: STEEL_EFFECT },
  [learnedKey("gate-blade", "edge", "gate-star")]: { known: true, effects: STAR_EFFECT },
  [learnedKey("gate-blade", "edge", "gate-ember")]: { known: true, effects: { bonusDamage: { dice: "1d6", type: "fire" } } }
};
const base = { learned, stations: [BENCH, FORGE], researching: [{ id: "p1", goalName: "Gate Draught", recipeId: "gate-draught", progress: 1, threshold: 8 }], queue: [{ id: "q1", label: "Craft Gate Vest", days: 1 }] };
const okPlan = {
  ok: true, errors: [], plan: {
    recipeId: "gate-blade", recipeName: "Gate Blade", station: { id: "gate-bench", name: "Gate Bench", tier: 1 }, fee: 1, days: 2,
    uses: [{ slot: "blade", materialId: "gate-steel", materialName: "Gate Steel", units: 1 }, { slot: "edge", materialId: "gate-star", materialName: "Gate Star", units: 1 }],
    slots: [{ slot: "blade", effect: { known: true, roles: STEEL_EFFECT } }, { slot: "edge", effect: { known: true, roles: STAR_EFFECT } }], result: { known: true, baseTier: 2 }
  }
};
const long = "Gate Moonglass of the Unbroken Horizon Wanderers";
const longFacts = makeFacts({
  ...base, materials: { "gate-iron": { kind: "material", id: "gate-iron", name: long, tier: 1 }, "gate-steel": { kind: "material", id: "gate-steel", name: "Supercalifragilisticexpialidocious-Steel", tier: 2 }, "gate-star": { kind: "material", id: "gate-star", name: "Gate Star", tier: 3 } },
  recipes: { "gate-blade": { ...makeFacts().recipes["gate-blade"], name: "The Exceedingly Long Named Gate Blade of Wandering Heroes" }, "gate-vest": makeFacts().recipes["gate-vest"] },
  formulas: [{ recipeId: "gate-blade", name: "x", access: "loan" }, { recipeId: "gate-vest", name: "Gate Vest", access: "owned" }],
  location: { name: "Gate Town of the Seven Northern Marches and Beyond", stations: ["Gate Bench of the Old Smithy", "Gate Forge of the Deep Mountain Kings"] },
  stations: [{ ...BENCH, name: "Gate Bench of the Old Smithy", where: "Gate Town of the Seven Northern Marches" }, { ...FORGE, name: "Gate Forge of the Deep Mountain Kings" }],
  inventory: { "gate-iron": 5, "gate-steel": 1, "gate-star": 1 },
  learned: { [learnedKey("gate-blade", "edge", "gate-star")]: { known: true, effects: { specialAbility: { title: "Unbelievably Long Special Ability Title", text: "Does a thing that takes a great many words to describe properly, wrapping across several lines.", on: "criticalHit" } } } }
});
// Research and Compendium (Stage 11b round) ------------------------------------------------------------------------------------------------------------
const LONG_PROJECT = { ...PROJECT, id: "unlock-long", goalName: "The Exceedingly Long Named Gate Draught of Wandering Heroes and Their Faithful Companions", progress: 19, threshold: 20, skills: [{ skill: "crafting", label: "Crafting", modifier: 7 }, { skill: "arcana", label: "Arcana of the Seven Hidden Orders", modifier: -2 }, { skill: "occultism", label: "Occultism", modifier: 12 }, { skill: "religion", label: "Religion", modifier: null }], log: Array.from({ length: 7 }, (_, i) => ({ source: i === 3 ? "commission" : "research", degree: ["success", "criticalSuccess", "failure", "criticalFailure"][i % 4], delta: [1, 2, 0, 0][i % 4], skill: "crafting" })), hint: "Gate Bench is already at tier level 2, but this project began at 1; put it aside to get your materials back" };
const LONG_LEAD = { ...LEAD, id: "lead-long", name: "The Gate Lantern of the Seven Northern Marches and Beyond", note: "A glassblower in Gate Town of the Seven Northern Marches mentioned it over a very long and winding conversation that went on and on." };
const manyMaterials = Array.from({ length: 40 }, (_, i) => ({ id: `gate-m${i}`, name: i % 7 === 0 ? `Gate Moonglass of the Unbroken Horizon Wanderers ${i}` : `Gate Material ${i}`, tier: 1 + (i % 5), firstAt: i, places: [{ key: `p${i}`, label: i % 3 === 0 ? "Gate Town of the Seven Northern Marches and Beyond" : "Gate Field" }], rungs: [{ nodeType: "gate-bush", tier: 1, rung: "base" }, { nodeType: "gate-bush", tier: 1, rung: "higher" }], shared: false, usedIn: [{ recipeId: "r1", name: "The Exceedingly Long Named Gate Blade of Wandering Heroes" }, { recipeId: "r2", name: "Gate Vest" }] }));
const longExperiment = { recipeId: "gate-blade", name: "The Exceedingly Long Named Gate Blade of Wandering Heroes", source: "both", baseline: BOOK_ENTRIES.experiments[0].baseline, known: Array.from({ length: 9 }, (_, i) => ({ slot: i % 2 ? "edge" : "blade", materialId: `m${i}`, material: `Gate Supercalifragilisticexpialidocious-${i}`, tier: 2, effects: i % 2 ? { specialAbility: { title: "Unbelievably Long Special Ability Title", text: "Does a thing that takes a great many words to describe properly, wrapping across several lines.", on: "criticalHit" } } : STEEL_EFFECT, source: i % 3 ? "crafted" : "shared" })) };
const bookWith = (entries, own = entries) => makeBook({ entries: { ...BOOK_ENTRIES, ...entries }, own: { ...makeBook().own, ...own } });
// The discovery chain (Stage 11c): studies with a plain stage, item leads with long names, "What you know", gold lines and a locked material.
const STUDY = { id: "study:material:gate-ore", goalName: "Study: Gate Ore of the Unbroken Horizon Wanderers and Their Faithful Companions", kind: "study", recipeId: null, stage: 1, stageWord: "Getting somewhere", skills: [{ skill: "crafting", label: "Crafting", modifier: 7 }, { skill: "nature", label: "Nature", modifier: 3 }, { skill: "arcana", label: "Arcana", modifier: null }], log: [], hint: null };
const ITEM_LEADS = [
  { id: "item:material:gate-moon", recipeId: null, name: "Gate Moonglass of the Unbroken Horizon Wanderers", note: "", source: "item", itemKind: "material", paused: false },
  { id: "item:note:gate-page", recipeId: null, name: "Torn Page of the Seven Northern Marches", note: "", source: "item", itemKind: "note", paused: false },
  { id: "item:material:gate-paused", recipeId: null, name: "Gate Ember", note: "", source: "item", itemKind: "material", paused: true },
  { id: "lead-v2", recipeId: "gate-blade2", name: "Gate Blade II", note: "What you have learned about Gate ore materials shows how to make a better version.", source: "version", itemKind: null, paused: false }
];
const R = { ...Object.fromEntries([["researchEmpty", { facts: researchFacts({ projects: [], leads: [] }), state: researchState() }]]) };

// The Discovery tracks window (Stage 11c, GM only) with a registry big enough to need the search, the chips and the folding: 300 items, long names.
const editorRegistry = (n = 300) => {
  const material = new Map(), note = new Map(), recipe = new Map([["gate-blade", { id: "gate-blade", name: "Gate Blade" }]]);
  for (let i = 0; i < n; i++) {
    const kind = i % 5 === 0 ? "note" : i % 7 === 0 ? "recipe" : "material";
    const long = i % 11 === 0 ? ` of the Unbroken Horizon Wanderers and Their Faithful Companions ${i}` : ` ${i}`;
    if (kind === "material") material.set(`gate-m${i}`, { id: `gate-m${i}`, name: `Gate Material${long}`, tier: 1, value: 5, tag: i % 3 === 0 ? "gate-tag" : undefined, research: i % 4 === 0 ? { milestones: [{ steps: 4, grants: { type: "properties" } }, { steps: 8, grants: { type: "formula", recipeId: "gate-blade" } }, { steps: 12, grants: { type: "formula", recipeId: "gate-blade" } }] } : undefined });
    else if (kind === "note") note.set(`gate-n${i}`, { id: `gate-n${i}`, name: `Gate Note${long}`, recipeId: "gate-blade", research: i % 2 ? { milestones: [{ steps: 3, grants: { type: "formula" } }] } : undefined });
    else recipe.set(`gate-r${i}`, { id: `gate-r${i}`, name: `Gate Blade Mark${long}`, version: 2 });
  }
  return { material, note, recipe, tag: new Map([["gate-tag", { id: "gate-tag", name: "Mitflit parts of the Unbroken Horizon", theme: "cowardice" }]]) };
};
const EDITOR_REGISTRY = editorRegistry();
const editorScene = over => ({ editor: { registry: EDITOR_REGISTRY, overlay: {}, ...over } });
export const SCENES = {
  editorEmpty: editorScene({}),
  editor300: editorScene({ selectedKey: "material:gate-m4" }),
  editorRows: editorScene({ selectedKey: "material:gate-m8", draft: [{ steps: "4", type: "properties", recipeId: "" }, { steps: "4", type: "formula", recipeId: "" }, { steps: "abc", type: "formula", recipeId: "gate-blade" }], dirty: true }),
  editorFiltered: editorScene({ selectedKey: "note:gate-n5", filters: { search: "unbroken", kinds: ["material", "note"], track: "has" }, collapsed: ["recipe"] }),
  editorFolded: editorScene({ selectedKey: "recipe:gate-r7", collapsed: ["material", "note"] }),
  editorNone: editorScene({ filters: { search: "no such thing" } }),
  ...R,
  researchOne: { facts: researchFacts({ projects: [PROJECT], leads: [LEAD] }), state: researchState({ skill: "crafting", checkDays: 2 }) },
  researchStudy: { facts: researchFacts({ projects: [STUDY, PROJECT], leads: ITEM_LEADS, days: { free: 9, reserved: 0 } }), state: researchState({ projectId: STUDY.id, skill: "nature", checkDays: 2 }) },
  researchStudyConfirm: { facts: researchFacts({ projects: [STUDY], leads: ITEM_LEADS.slice(0, 1) }), state: researchState({ projectId: STUDY.id, confirmAside: true }) },
  researchStudyNarrow: { facts: researchFacts({ projects: [STUDY, { ...STUDY, id: "study:material:gate-b", goalName: "Study: Gate Ore B", stage: 2, stageWord: "Nearly there" }], leads: ITEM_LEADS }), state: researchState({ projectId: STUDY.id, showQueue: true }) },
  compendiumKnow: { facts: compendiumFacts({ compendium: bookWith({ materials: manyMaterials }), materialInfo: { "gate-m0": { hasTrack: true, known: true, tag: { name: "Mitflit parts of the Unbroken Horizon Wanderers", theme: "cowardice and a great many other long-winded fears", worksWith: "frightened and other conditions that take a lot of words" } }, "gate-m1": { hasTrack: true, known: false, tag: null } } }), state: compendiumState({ entryKey: "gate-m0" }) },
  compendiumUnstudied: { facts: compendiumFacts({ compendium: bookWith({ materials: manyMaterials }), materialInfo: { "gate-m1": { hasTrack: true, known: false, tag: null } } }), state: compendiumState({ entryKey: "gate-m1" }) },
  researchMany: { facts: researchFacts({ projects: [LONG_PROJECT, BIG_PROJECT, PROJECT, UPGRADE], leads: [LONG_LEAD, LEAD], days: { free: 9, reserved: 0 } }), state: researchState({ projectId: "unlock-long", skill: "arcana", checkDays: 3 }) },
  researchQueued: { facts: researchFacts({ projects: [PROJECT, UPGRADE], queuedResearch: [{ actionId: "a1", projectId: PROJECT.id, days: 2, skill: "crafting" }], days: { free: 4, reserved: 2 }, queue: [{ id: "a1", label: "Research: Gate Draught", days: 2 }] }), state: researchState({ projectId: PROJECT.id, showQueue: true }) },
  researchConfirm: { facts: researchFacts({ projects: [PROJECT], leads: [] }), state: researchState({ confirmAside: true }) },
  researchClosed: { facts: researchFacts({ downtime: { open: true, participant: false } }), state: researchState({ projectId: PROJECT.id, skill: "crafting" }) },
  researchWorkshop: { facts: researchFacts({ projects: [{ ...UPGRADE, hint: "Gate Bench is already at tier level 2, but this project began at 1; put it aside to get your materials back" }, PROJECT] }), state: researchState({ projectId: UPGRADE.id }) },
  compendiumMaterials: { facts: compendiumFacts({ compendium: bookWith({ materials: manyMaterials }) }), state: compendiumState() },
  compendiumMaterial: { facts: compendiumFacts({ compendium: bookWith({ materials: manyMaterials }), shares: [{ actionId: "s1", kind: "material", key: "gate-m0" }] }), state: compendiumState({ entryKey: "gate-m0" }) },
  compendiumShareable: { facts: compendiumFacts(), state: compendiumState({ entryKey: "gate-iron" }) },
  compendiumCreature: { facts: compendiumFacts(), state: compendiumState({ category: "creatures", entryKey: "gate-wolf" }) },
  compendiumRegion: { facts: compendiumFacts(), state: compendiumState({ category: "regions", entryKey: "gate-field" }) },
  compendiumExperiment: { facts: compendiumFacts({ compendium: bookWith({ experiments: [longExperiment] }) }), state: compendiumState({ category: "experiments", entryKey: "gate-blade" }) },
  compendiumEmpty: { facts: compendiumFacts({ compendium: makeBook({ entries: { materials: [], creatures: [], regions: [], experiments: [] }, own: { materials: [], creatures: [], regions: [], experiments: [] } }) }), state: compendiumState({ category: "creatures" }) },
  compendiumUnreadable: { facts: compendiumFacts({ compendium: null }), state: compendiumState() },
  compendiumNarrowList: { facts: compendiumFacts({ shares: [{ actionId: "s1", kind: "material", key: "gate-star" }] }), state: compendiumState({ category: "experiments", entryKey: "gate-blade", showDisplay: true }) },
  gold: { facts: makeFacts({ ...base, inventory: { "gate-iron": 5, "gate-steel": 2, "gate-star": 1 }, preview: okPlan, materials: { ...base.materials, ...Object.fromEntries(Object.entries(makeFacts().materials).map(([id, m]) => [id, { ...m, value: id === "gate-star" ? 100 : 25 }])) }, open: { "gate-ember": false } }), state: makeState({ picks: { blade: "gate-steel", edge: "gate-star" } }) },
  goldLocked: { facts: makeFacts({ ...base, inventory: { "gate-iron": 5, "gate-steel": 2, "gate-star": 1 }, open: { "gate-iron": false, "gate-star": false } }), state: makeState({ picks: { blade: "gate-steel" } }) },
  partial: { facts: makeFacts(base), state: makeState({ picks: { blade: "gate-steel" } }) },
  complete: { facts: makeFacts({ ...base, inventory: { "gate-iron": 5, "gate-steel": 2, "gate-star": 1 }, preview: okPlan }), state: makeState({ picks: { blade: "gate-steel", edge: "gate-star" } }) },
  closed: { facts: makeFacts({ ...base, downtime: { open: false, participant: false } }), state: makeState({ picks: { blade: "gate-steel", edge: "gate-star" } }) },
  panels: { facts: makeFacts({ ...base, characters: [{ id: "gate-ann", name: "Gate Ann" }, { id: "gate-bob", name: "Gate Bob of the Long Name" }] }), state: makeState({ picks: { blade: "gate-steel" }, showDisplay: true, showQueue: true, showSwitch: true }) },
  longNames: { facts: longFacts, state: makeState({ picks: { blade: "gate-iron", edge: "gate-star" }, showQueue: true }) },
  researching: { facts: makeFacts({ ...base, formulas: [] }), state: makeState({ recipeId: "gate-draught" }) },
  short: { facts: makeFacts({ ...base, inventory: { "gate-iron": 1, "gate-ember": 1 }, met: ["gate-iron", "gate-ember"], materials: { "gate-iron": { kind: "material", id: "gate-iron", name: "Gate Iron", tier: 1 }, "gate-ember": { kind: "material", id: "gate-ember", name: "Gate Ember", tier: 2 } } }), state: makeState({ recipeId: "gate-vest", picks: { hide: "gate-ember" } }) },
  empty: { facts: { ...makeFacts(), actor: null, characters: [] }, state: makeState() }
};

// The checks ---------------------------------------------------------------------------------------------------------------------------------------------
/**
 * Runs in the page. Returns a list of plain-text problems.
 * belowMinimum: the window is narrower than HUB.minSize.width (it cannot be dragged there; the harness draws it anyway as a stress test): an unsplittable badge
 * may then be wider than the box it sits in, so only the badge, overlap, position and target checks apply.
 */
function pageChecks({ minTarget, checkWords, belowMinimum }) {
  const problems = [];
  const root = document.querySelector(".pfp-hub");
  const name = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/)[0]}` : ""} "${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 36)}"`;
  const style = el => getComputedStyle(el);
  const scrolls = el => /(auto|scroll)/.test(style(el).overflowY) || /(auto|scroll)/.test(style(el).overflowX);
  const els = [root, ...root.querySelectorAll("*")].filter(el => el.getClientRects().length);

  // 1. No element's content spills out of its own box (text overflowing a fixed-height card or a nowrap line).
  for (const el of els) {
    if (scrolls(el) || el === root) continue;
    if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) problems.push(`content overflows its box vertically (${el.scrollHeight} > ${el.clientHeight}): ${name(el)}`);
    if (!belowMinimum && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) problems.push(`content overflows its box horizontally (${el.scrollWidth} > ${el.clientWidth}): ${name(el)}`);
  }
  // 2. No two siblings overlap (cards, options, slots, buttons, panels), and no two children of one card overlap each other.
  const overlap = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left); const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 1 && y > 1; };
  const groups = new Map();
  for (const el of els) { if (el === root) continue; const key = el.parentElement; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(el); }
  for (const [, siblings] of groups) {
    const boxes = siblings.map(el => [el, el.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height > 0);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, ra] = boxes[i], [b, rb] = boxes[j];
      if (style(a).position === "absolute" || style(b).position === "absolute") continue;
      if (overlap(ra, rb)) problems.push(`siblings overlap: ${name(a)} / ${name(b)}`);
    }
  }
  // 2b. Nothing in the Hub is positioned absolutely or fixed: badges, pills and bars stay in the flow, so they cannot print over a neighbour.
  for (const el of els) if (/(absolute|fixed)/.test(style(el).position)) problems.push(`positioned ${style(el).position} (it can cover a neighbour): ${name(el)}`);
  // 3. Every control is a big enough target.
  for (const el of root.querySelectorAll("[data-action], input, select")) {
    const r = el.getBoundingClientRect();
    if (r.height < minTarget - 0.5 || r.width < minTarget - 0.5) problems.push(`target ${r.width.toFixed(0)}x${r.height.toFixed(0)} is under ${minTarget}px: ${name(el)}`);
  }
  // 4. Nothing is cut off at the right edge, and the page itself does not scroll sideways.
  const vw = document.documentElement.clientWidth;
  if (!belowMinimum && document.documentElement.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  if (!belowMinimum && root.scrollWidth > root.clientWidth + 1) problems.push(`the window content is wider than the window (${root.scrollWidth} > ${root.clientWidth})`);
  for (const el of belowMinimum ? [] : els) { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width > 0) problems.push(`runs past the right edge (${r.right.toFixed(0)} > ${vw}): ${name(el)}`); }
  // 5. No text is clipped by an ancestor that hides overflow.
  for (const el of belowMinimum ? [] : els) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = style(p);
      const hideX = /(hidden|clip)/.test(s.overflowX), hideY = /(hidden|clip)/.test(s.overflowY);
      if (hideX || hideY) {
        const pr = p.getBoundingClientRect();
        // Only the axis that hides is a clip (an overflow-y:auto scroller with overflow-x:hidden scrolls vertically: that is not a clip).
        const clipped = (hideX && (r.right > pr.right + 1 || r.left < pr.left - 1)) || (hideY && !/(auto|scroll)/.test(s.overflowY) && (r.bottom > pr.bottom + 1 || r.top < pr.top - 1));
        if (clipped) { problems.push(`text clipped by ${name(p)}: ${name(el)}`); break; }
      }
    }
  }
  // 6. Words are not broken mid-word (any word of 12 characters or fewer, where the window is 280px or wider), and a badge, pill or count never splits at all
  //    (not even between its own words): it wraps as a whole onto its own line, or stays whole.
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !parent.getClientRects().length) continue;
    const inBadge = Boolean(parent.closest(".pfp-badge, .pfp-pill, .pfp-count"));
    if (!inBadge && !checkWords) continue;
    const lines = (from, to) => { range.setStart(node, from); range.setEnd(node, to); return [...range.getClientRects()].filter(r => r.width > 0); };
    const split = rects => rects.length > 1 && rects.some(r => Math.abs(r.top - rects[0].top) > 2);
    if (inBadge && split(lines(0, node.textContent.length))) problems.push(`a badge is split across lines: ${name(parent.closest(".pfp-badge, .pfp-pill, .pfp-count"))}`);
    if (!checkWords) continue;
    for (const m of node.textContent.matchAll(/\S+/g)) {
      if (m[0].length > 12 || /[-\u2013\u2014/]/.test(m[0])) continue;
      if (split(lines(m.index, m.index + m[0].length))) problems.push(`the word "${m[0]}" is broken across lines: ${name(parent)}`);
    }
  }
  return [...new Set(problems)];
}

/** One page, reused. It is loaded from a real file: a stylesheet link from about:blank to file:// is blocked, which silently renders everything unstyled. */
export async function openHarness(browser) {
  const page = await browser.newPage();
  const file = join(mkdtempSync(join(tmpdir(), "pfp-harness-")), "harness.html");
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style id="window">${windowCss}</style><style id="hostile"></style><link rel="stylesheet" href="${cssUrl}"><style id="extra"></style><body></body>`);
  await page.goto(pathToFileURL(file).href);
  // Fail loudly if the real stylesheet did not load (a layout "pass" against no CSS at all would mean nothing).
  const loaded = await page.evaluate(() => { const probe = document.createElement("div"); probe.className = "pfp-hub"; document.body.append(probe); const ok = getComputedStyle(probe).display === "flex"; probe.remove(); return ok; });
  if (!loaded) throw new Error("the harness could not load styles/hub.css");
  return page;
}

/**
 * Render one state. Options: { scene, theme, textSize, width, hostile (a HOSTILE key or null), font, announce, height, fit, shot (path) }.
 * Returns { problems, layout }.
 */
export async function renderState(page, { scene, theme = "parchment", textSize = 100, width = 900, height, hostile = null, font = "standard", announce = null, shot = null, extraCss = "" }) {
  const spec = SCENES[scene];
  const layout = width < HUB.stackBelowPx ? "narrow" : "wide";
  const display = { theme, textSize, font };
  const html = spec.editor ? renderEditor(editorModel({ ...spec.editor, layout, display })) : renderHubPage(hubModel(spec.facts, { ...spec.state, layout, display }), announce ? [announce] : []);
  const frameHeight = height ?? (layout === "narrow" ? null : 820);
  await page.setViewportSize({ width, height: frameHeight ?? 900 });
  await page.evaluate(({ html, hostileCss, extraCss, frameHeight }) => {
    document.getElementById("hostile").textContent = hostileCss;
    document.getElementById("extra").textContent = extraCss;
    document.body.innerHTML = `<div class="application window-app theme-dark" style="width:100%;${frameHeight ? `height:${frameHeight}px` : ""}"><section class="window-content">${html}</section></div>`;
  }, { html, hostileCss: hostile ? HOSTILE[hostile] : "", extraCss, frameHeight });
  await page.evaluate(() => document.fonts.ready);
  const problems = await page.evaluate(pageChecks, { minTarget: HUB.minTarget ?? 44, checkWords: width >= 280, belowMinimum: width < HUB.minSize.width });
  if (shot) await page.screenshot({ path: shot, fullPage: layout === "narrow" });
  return { problems, layout };
}
