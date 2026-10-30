/**
 * Renders the Downtime Hub with throwaway "Gate" data and saves screenshots to docs/screens (node build/screens.mjs).
 * Needs Playwright + Chromium (pre-installed in the cloud sandbox). The page is the layout harness (build/harness.mjs): the real render function and the
 * real stylesheet, inside a window that behaves like Foundry v14 around it. Most shots have the HOSTILE Foundry styles ON (that is the point); a few have
 * them off for comparison. Every shot is also layout-checked; the script prints any problem.
 */
import { mkdirSync } from "node:fs";
import { launchChromium, openHarness, renderState } from "./harness.mjs";

const out = new URL("../docs/screens/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const HOSTILE = "specific 2rem hidden";
const jobs = [];
for (const theme of ["parchment", "dark", "contrast"]) for (const textSize of [100, 175]) for (const width of [900, 320]) jobs.push({ scene: "partial", theme, textSize, width, hostile: HOSTILE });
jobs.push({ scene: "partial", theme: "parchment", textSize: 100, width: 900, hostile: null, tag: "no-foundry-styles" });
for (const scene of ["complete", "closed", "panels", "longNames", "short", "researching", "empty"]) {
  jobs.push({ scene, theme: "parchment", textSize: 100, width: 900, hostile: HOSTILE });
  jobs.push({ scene, theme: "dark", textSize: 175, width: 280, hostile: HOSTILE });
}
// 0.18.3: the Display panel and the SELECTED badge in a narrow window at 175% text (the real-Foundry finding), at the new minimum width and at a stress width below it
for (const width of [300, 280, 220]) jobs.push({ scene: "panels", theme: "dark", textSize: 175, width, hostile: HOSTILE, tag: width < 300 ? "below-minimum-width" : "minimum-width" });
jobs.push({ scene: "partial", theme: "parchment", textSize: 175, width: 300, hostile: HOSTILE, tag: "minimum-width" });
jobs.push({ scene: "partial", theme: "dark", textSize: 125, width: 600, hostile: HOSTILE }, { scene: "longNames", theme: "contrast", textSize: 150, width: 320, hostile: HOSTILE, font: "hyperlegible", announce: "Craft queued: Gate Blade. 2 days reserved." });

// 0.19.0: the Research and Compendium tabs
for (const scene of ["researchOne", "researchMany", "researchQueued", "researchConfirm", "researchClosed", "researchWorkshop", "researchEmpty", "compendiumMaterial", "compendiumShareable", "compendiumExperiment", "compendiumCreature", "compendiumEmpty"]) {
  jobs.push({ scene, theme: "parchment", textSize: 100, width: 900, hostile: HOSTILE });
  jobs.push({ scene, theme: "dark", textSize: 175, width: 300, hostile: HOSTILE, tag: "minimum-width" });
}
jobs.push({ scene: "researchMany", theme: "contrast", textSize: 125, width: 600, hostile: HOSTILE }, { scene: "compendiumNarrowList", theme: "dark", textSize: 175, width: 280, hostile: HOSTILE });

const browser = await launchChromium();
const page = await openHarness(browser);
let bad = 0;
for (const job of jobs) {
  const name = `${job.scene}-${job.theme}-${job.textSize}-${job.width}${job.tag ? `-${job.tag}` : ""}${job.font ? `-${job.font}` : ""}`;
  const { problems } = await renderState(page, { ...job, shot: `${out}${name}.png` });
  bad += problems.length;
  console.log(name, problems.length ? `PROBLEMS: ${problems.slice(0, 4).join(" | ")}` : "ok");
}
await browser.close();
process.exitCode = bad ? 1 : 0;
