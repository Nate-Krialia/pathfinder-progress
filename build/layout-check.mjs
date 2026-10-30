/** Runs the whole layout matrix and prints every problem (node build/layout-check.mjs). The test (tests/hub-layout.test.js) runs the same matrix. */
import { HOSTILE, SCENES, launchChromium, openHarness, renderState } from "./harness.mjs";

export const MATRIX = { themes: ["parchment", "dark", "contrast"], sizes: [100, 175], widths: [900, 600, 320, 280, 220], hostiles: [null, ...Object.keys(HOSTILE)] };

export async function runMatrix({ quick = false } = {}) {
  const browser = await launchChromium();
  const page = await openHarness(browser);
  const failures = [];
  let renders = 0;
  const one = async options => {
    const { problems } = await renderState(page, options);
    renders++;
    for (const problem of problems) failures.push({ ...options, problem });
  };
  for (const scene of Object.keys(SCENES)) for (const theme of MATRIX.themes) for (const textSize of MATRIX.sizes) for (const width of MATRIX.widths) for (const hostile of MATRIX.hostiles) {
    if (quick && (theme !== "parchment" || hostile === "specific 2rem hidden")) continue;
    await one({ scene, theme, textSize, width, hostile });
  }
  // every text size at the narrow widths, the font swap and the announcement line
  for (const textSize of [100, 125, 150, 175]) for (const width of [320, 280, 220]) for (const hostile of MATRIX.hostiles) {
    await one({ scene: "partial", textSize, width, hostile });
    await one({ scene: "longNames", textSize, width, hostile, font: "hyperlegible", announce: "Craft queued: Gate Blade. 2 days reserved." });
  }
  await browser.close();
  return { renders, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { renders, failures } = await runMatrix();
  const byProblem = new Map();
  for (const f of failures) { const key = f.problem.replace(/\d+(\.\d+)?/g, "N").replace(/"[^"]*"/g, '"…"'); byProblem.set(key, [...(byProblem.get(key) ?? []), f]); }
  console.log(`${renders} renders, ${failures.length} problems in ${new Set(failures.map(f => JSON.stringify({ ...f, problem: 0 }))).size} renders`);
  for (const [key, list] of [...byProblem].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(`${String(list.length).padStart(5)}  ${key}   e.g. ${list[0].scene} ${list[0].theme ?? ""} ${list[0].textSize}% ${list[0].width}px hostile=${list[0].hostile}`);
  process.exitCode = failures.length ? 1 : 0;
}
