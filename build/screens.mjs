/**
 * Renders the Downtime Hub with throwaway "Gate" data and saves screenshots to docs/screens (Stage 11a).
 * Needs Playwright + Chromium (pre-installed in the cloud sandbox). Run: node build/screens.mjs
 * It draws the SAME render function the window uses, with the real stylesheet; it does not need Foundry.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");   // Playwright is pre-installed globally in the sandbox; it has no ESM entry
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hubModel, learnedKey } from "../scripts/hub/viewmodels.js";
import { renderHubPage } from "../scripts/hub/render.js";
import { BENCH, FORGE, STAR_EFFECT, STEEL_EFFECT, makeFacts, makeState } from "../tests/hub-fixtures.js";

const css = pathToFileURL(new URL("../styles/hub.css", import.meta.url).pathname).href;
const out = new URL("../docs/screens/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const learned = {
  [learnedKey("gate-blade", "blade", "gate-steel")]: { known: true, effects: STEEL_EFFECT },
  [learnedKey("gate-blade", "edge", "gate-star")]: { known: true, effects: STAR_EFFECT }
};
const base = { learned, stations: [BENCH, FORGE], researching: [{ id: "p1", goalName: "Gate Draught", recipeId: "gate-draught", progress: 3, threshold: 8 }], queue: [{ id: "q1", label: "Craft Gate Vest", days: 1 }] };
const okPlan = {
  ok: true, errors: [], plan: {
    recipeId: "gate-blade", recipeName: "Gate Blade", station: { id: "gate-bench", name: "Gate Bench", tier: 1 }, fee: 1, days: 2,
    uses: [{ slot: "blade", materialId: "gate-steel", materialName: "Gate Steel", units: 1 }, { slot: "edge", materialId: "gate-iron", materialName: "Gate Iron", units: 1 }],
    slots: [{ slot: "blade", effect: { known: true, roles: STEEL_EFFECT } }, { slot: "edge", effect: { known: false } }], result: { known: true, baseTier: 2 }
  }
};
const scenes = {
  // one blade slot filled (learned effect), the edge slot EMPTY, an unlearned effect on offer, Queue off with its reason
  partial: { facts: makeFacts(base), state: makeState({ picks: { blade: "gate-steel" } }) },
  complete: { facts: makeFacts({ ...base, inventory: { "gate-iron": 5, "gate-steel": 2, "gate-star": 1 }, preview: { ...okPlan, plan: { ...okPlan.plan, uses: okPlan.plan.uses.map((u, i) => (i ? { ...u, materialId: "gate-star", materialName: "Gate Star" } : u)), slots: [okPlan.plan.slots[0], { slot: "edge", effect: { known: true, roles: STAR_EFFECT } }] } } }), state: makeState({ picks: { blade: "gate-steel", edge: "gate-star" } }) },
  closed: { facts: makeFacts({ ...base, downtime: { open: false, participant: false } }), state: makeState({ picks: { blade: "gate-steel", edge: "gate-star" } }) },
  display: { facts: makeFacts(base), state: makeState({ picks: { blade: "gate-steel" }, showDisplay: true, showQueue: true }) }
};

const browser = await chromium.launch();
const shots = [];
async function shoot(name, scene, { theme, textSize, width, height, narrow }) {
  const model = hubModel(scene.facts, { ...scene.state, layout: narrow ? "narrow" : "wide", display: { theme, textSize, font: "standard" } });
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${css}"><body style="margin:0;background:#888"><div style="width:${width}px;${narrow ? "" : `height:${height}px`}">${renderHubPage(model, scene.announce ? [scene.announce] : [])}</div>`;
  const file = `${out}.page.html`;
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  // report anything that would be a layout bug: clipped text, horizontal overflow, targets under 44px
  const report = await page.evaluate(() => {
    const problems = [];
    const root = document.querySelector(".pfp-hub");
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`horizontal overflow ${root.scrollWidth} > ${root.clientWidth}`);
    for (const b of document.querySelectorAll("button")) {
      const r = b.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) problems.push(`small target ${r.width.toFixed(0)}x${r.height.toFixed(0)}: ${b.textContent.trim().slice(0, 30)}`);
      if (b.scrollWidth > b.clientWidth + 1) problems.push(`clipped button text: ${b.textContent.trim().slice(0, 30)}`);
    }
    return problems;
  });
  const file2 = `${name}.png`;
  await page.screenshot({ path: `${out}${file2}`, fullPage: Boolean(narrow) });
  await page.close();
  shots.push({ file: file2, problems: report });
}

for (const theme of ["parchment", "dark", "contrast"]) {
  for (const textSize of [100, 175]) {
    await shoot(`${theme}-${textSize}-wide`, scenes.partial, { theme, textSize, width: 1000, height: textSize === 175 ? 1700 : 1150 });
    await shoot(`${theme}-${textSize}-narrow`, scenes.partial, { theme, textSize, width: 460, height: textSize === 175 ? 1900 : 1300, narrow: true });
  }
}
await shoot("parchment-100-complete", scenes.complete, { theme: "parchment", textSize: 100, width: 1000, height: 820 });
await shoot("parchment-100-closed", scenes.closed, { theme: "parchment", textSize: 100, width: 1000, height: 820 });
await shoot("parchment-125-display-panel", scenes.display, { theme: "parchment", textSize: 125, width: 1000, height: 1000 });
await browser.close();
writeFileSync(`${out}.page.html`, "");
for (const s of shots) console.log(s.file, s.problems.length ? `PROBLEMS: ${s.problems.join(" | ")}` : "ok");
