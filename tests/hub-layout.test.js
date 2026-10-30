/**
 * The Hub's LAYOUT in a real browser (Chromium via Playwright), against a hostile imitation of Foundry's own styles (build/harness.mjs). Every Hub state is drawn
 * in every theme, at 100% and 175% text (and at every size in the narrow windows), at 900, 600, 320 and 280px, with and without the hostile styles, and checked
 * with real geometry: no content spilling out of its box, no overlapping siblings, no absolute positioning, every control at least 44px, nothing cut off at the
 * right edge, no text clipped by an ancestor that hides overflow.
 *
 * Needs Chromium. Where it is not installed (the CI runner), these tests are skipped with a message, unless REQUIRE_CHROMIUM=1 is set (then they fail).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOSTILE, SCENES, launchChromium, openHarness, renderState } from "../build/harness.mjs";
import { MATRIX, runMatrix } from "../build/layout-check.mjs";

let browser = null;
let skip = false;
try { browser = await launchChromium(); } catch (error) { skip = process.env.REQUIRE_CHROMIUM === "1" ? false : `Chromium is not available (${String(error.message).split("\n")[0]})`; if (skip === false) throw error; }
if (browser) await browser.close();

test("LAYOUT: every Hub state fits, in every theme and size, at 900/600/320/280px, with and without Foundry's hostile styles", { skip, timeout: 300000 }, async () => {
  const { renders, failures } = await runMatrix();
  const sample = failures.slice(0, 12).map(f => `${f.scene} ${f.theme ?? "parchment"} ${f.textSize}% ${f.width}px hostile=${f.hostile}: ${f.problem}`);
  assert.ok(renders >= 1000, `rendered ${renders} states`);
  assert.equal(failures.length, 0, `${failures.length} layout problems, e.g.\n${sample.join("\n")}`);
});

test("LAYOUT: the matrix covers what it says (scenes, themes, sizes, widths, hostile strengths)", { skip }, () => {
  assert.deepEqual(MATRIX.themes, ["parchment", "dark", "contrast"]);
  assert.deepEqual([MATRIX.sizes, MATRIX.widths], [[100, 175], [900, 600, 320, 280, 220]]);
  assert.deepEqual(MATRIX.hostiles, [null, ...Object.keys(HOSTILE)]);
  assert.ok(Object.keys(HOSTILE).length >= 4 && Object.keys(SCENES).length >= 8);
  assert.ok(/!important/.test(HOSTILE["important 2.5rem"]) && /2rem/.test(HOSTILE["plain 2rem hidden"]) && /2\.5rem/.test(HOSTILE["plain 2.5rem visible"]));
});

test("LAYOUT MUTATION: the checks fail when a card gets a fixed height back, a badge is positioned absolutely, tabs stop wrapping, or targets shrink", { skip, timeout: 120000 }, async () => {
  const b = await launchChromium();
  try {
    const page = await openHarness(b);
    const base = { scene: "partial", width: 320, textSize: 100 };
    assert.deepEqual((await renderState(page, base)).problems, [], "the unmutated render is clean");
    const mutations = {
      "fixed card height": ".pfp-hub button.pfp-card, .pfp-hub button.pfp-option { height: 40px !important; overflow: hidden !important; }",
      "absolute badge": ".pfp-hub .pfp-badge { position: absolute !important; right: 0; bottom: 0; }",
      "tabs that do not wrap": ".pfp-hub .pfp-tabs { flex-wrap: nowrap !important; } .pfp-hub button.pfp-tab { white-space: nowrap !important; }",
      "small targets": ".pfp-hub button.pfp-btn { min-height: 30px !important; padding: 0 !important; }",
      "nowrap text": ".pfp-hub .pfp-stock, .pfp-hub .pfp-unknown, .pfp-hub .pfp-option-name { white-space: nowrap !important; overflow-wrap: normal !important; }",
      // the 0.18.3 checks: a badge that wraps letter by letter (SELECTE/D), and ordinary words broken mid-word ("Da/rk")
      "a badge that wraps letters": { scene: "partial", width: 280, textSize: 175, css: ".pfp-hub .pfp-badge { white-space: normal !important; overflow-wrap: anywhere !important; word-break: break-all !important; min-width: 0 !important; max-width: 3.5em !important; }" },
      "words broken mid-word": { scene: "panels", width: 280, textSize: 175, css: ".pfp-hub button.pfp-btn { overflow-wrap: anywhere !important; word-break: break-all !important; max-width: 5em !important; }" },
      // the 0.19.0 tabs: step boxes that overlap or are positioned absolutely, a lead card or confirm box with a fixed height, long names that cannot wrap
      "step boxes that overlap": { scene: "researchMany", width: 320, textSize: 100, css: ".pfp-hub .pfp-step { margin-left: -0.6em !important; }" },
      "absolute step boxes": { scene: "researchOne", width: 600, textSize: 100, css: ".pfp-hub .pfp-step { position: absolute !important; }" },
      "a lead card with a fixed height": { scene: "researchMany", width: 320, textSize: 175, css: ".pfp-hub .pfp-lead { height: 3em !important; overflow: hidden !important; }" },
      "a confirm box with a fixed height": { scene: "researchConfirm", width: 320, textSize: 175, css: ".pfp-hub .pfp-confirm { height: 2em !important; overflow: hidden !important; }" },
      "compendium text that cannot wrap": { scene: "compendiumExperiment", width: 320, textSize: 175, css: ".pfp-hub .pfp-facts li, .pfp-hub .pfp-effects li { white-space: nowrap !important; overflow-wrap: normal !important; }" },
      "a badge that wraps letters at 220": { scene: "partial", width: 220, textSize: 175, css: ".pfp-hub .pfp-badge { white-space: normal !important; word-break: break-all !important; min-width: 0 !important; max-width: 3.5em !important; }" }
    };
    for (const [label, spec] of Object.entries(mutations)) {
      const mutation = typeof spec === "string" ? { scene: label === "nowrap text" ? "longNames" : base.scene, css: spec } : spec;
      const { problems } = await renderState(page, { ...base, scene: mutation.scene, width: mutation.width ?? base.width, textSize: mutation.textSize ?? base.textSize, extraCss: mutation.css });
      assert.ok(problems.length > 0, `${label}: the checks must fail`);
    }
    for (const [scene, width, textSize] of [["partial", 280, 175], ["panels", 280, 175]]) assert.deepEqual((await renderState(page, { scene, width, textSize })).problems, [], `${scene} at ${width}px ${textSize}% is clean before the mutations`);
    // and the hostile styles really are hostile: against the OLD style of rule (a bare card with Foundry's button rules) the checks fail
    const bare = await renderState(page, { ...base, hostile: "plain 2rem hidden", extraCss: ".pfp-hub button.pfp-btn { all: revert !important; height: 2rem; overflow: hidden; white-space: nowrap; }" });
    assert.ok(bare.problems.length > 0, "without the reset, Foundry's button rules break the cards");
  } finally { await b.close(); }
});

test("LAYOUT: the default theme is Parchment and the stylesheet never reads the system or Foundry colour scheme", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("styles/hub.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");   // rules only, not the comments that explain them
  assert.doesNotMatch(css, /prefers-color-scheme|\.theme-dark|\.theme-light|:root\s*\{|(^|[\s,}])(html|body)\s*[,{]/m, "no rule keyed on the system or Foundry theme, and nothing global");
  const { normalizeDisplay } = await import("../scripts/hub/display.js");
  const { rootAttributes } = await import("../scripts/hub/render.js");
  const { hubModel, emptyState } = await import("../scripts/hub/viewmodels.js");
  const { makeFacts } = await import("./hub-fixtures.js");
  for (const saved of [undefined, null, {}, [], "dark", { theme: "neon" }, { theme: 5 }]) assert.equal(normalizeDisplay(saved).theme, "parchment", JSON.stringify(saved));
  assert.equal(normalizeDisplay({ theme: "dark" }).theme, "dark", "only the player's own saved choice changes it");
  assert.equal(rootAttributes(hubModel(makeFacts(), emptyState()))["data-theme"], "parchment");
});

test("LAYOUT: the window has a minimum width (the stylesheet's min-width equals HUB.minSize.width, and the constructor clamps a saved width to it)", async () => {
  const { readFileSync } = await import("node:fs");
  const { HUB } = await import("../scripts/config.js");
  const css = readFileSync("styles/hub.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, new RegExp(`\\.pfp-hub-window\\s*\\{[^}]*min-width:\\s*${HUB.minSize.width}px`), `.pfp-hub-window { min-width: ${HUB.minSize.width}px }`);
  assert.ok(HUB.minSize.width >= 280 && HUB.minSize.width <= 320, "about 300px");
  assert.match(readFileSync("scripts/hub/app.js", "utf8"), /classes: \["pfp-hub-window"\]/, "the window frame carries the class the rule targets");
});
