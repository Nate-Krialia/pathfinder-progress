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
    // the item editor (0.21.0): fields that shrink, groups squeezed flat, an intro that is cut off, effect blocks and a confirm box with a fixed height
    Object.assign(mutations, {
      "editor fields under 44px": { scene: "editorRows", width: 900, textSize: 100, css: ".pfp-hub input, .pfp-hub select { min-height: 20px !important; height: 20px !important; }" },
      "editor groups squeezed flat": { scene: "editor300", width: 900, textSize: 100, css: ".pfp-hub .pfp-editor-scroll > * { flex: 1 1 0 !important; min-height: 0 !important; }" },
      "an editor intro that is cut off": { scene: "editor300", width: 900, textSize: 100, css: ".pfp-hub .pfp-editor-head { height: 6px !important; overflow: hidden !important; }" },
      "effect blocks with a fixed height": { scene: "editor300", width: 900, textSize: 100, css: ".pfp-hub .pfp-block { height: 2em !important; overflow: hidden !important; }" },
      "an editor confirm box with a fixed height": { scene: "editorConfirm", width: 420, textSize: 175, css: ".pfp-hub .pfp-editor-confirm { height: 2em !important; overflow: hidden !important; }" },
      // v0.21.1: the narrow editor (the 0.21.0 matrix drew narrow windows with an auto height, so nothing could be squeezed), the filter chips, overlapping controls, the checkbox
      "an editor pane squeezed in a narrow window": { scene: "editor300", width: 400, height: 600, textSize: 100, css: ".pfp-hub.pfp-editor[data-layout=\"narrow\"] > .pfp-editor-body > .pfp-pane { flex: 0 1 auto !important; max-height: 6em !important; overflow: hidden !important; }" },
      "filter chips that overflow their pane": { scene: "editor300", width: 400, height: 900, textSize: 175, css: ".pfp-hub .pfp-editor-list { height: 6em !important; overflow: visible !important; }" },
      "controls that overlap": { scene: "editor300", width: 400, height: 900, textSize: 100, css: ".pfp-hub .pfp-editor-list .pfp-row > button { margin-right: -2em !important; }" },
      "an oversized checkbox": { scene: "editor300", width: 900, textSize: 100, css: ".pfp-hub input[type=\"checkbox\"] { width: 44px !important; height: 44px !important; }" },
      "a preview that cannot wrap": { scene: "editor300", width: 900, textSize: 100, css: ".pfp-hub .pfp-lines li, .pfp-hub .pfp-editor-preview p { white-space: nowrap !important; overflow-wrap: normal !important; }" }
    });
    for (const [label, spec] of Object.entries(mutations)) {
      const mutation = typeof spec === "string" ? { scene: label === "nowrap text" ? "longNames" : base.scene, css: spec } : spec;
      const { problems } = await renderState(page, { ...base, scene: mutation.scene, width: mutation.width ?? base.width, textSize: mutation.textSize ?? base.textSize, height: mutation.height, extraCss: mutation.css });
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

test("EDITOR LAYOUT: 300 items stay usable: the list is on the left and scrolls by itself, the editor is on the right with Save and Discard on screen; narrow stacks them", { skip, timeout: 120000 }, async () => {
  const b = await launchChromium();
  try {
    const page = await openHarness(b);
    const geometry = () => page.evaluate(() => {
      const rect = sel => { const el = document.querySelector(sel); const r = el?.getBoundingClientRect(); return el ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : null; };
      return { list: rect(".pfp-editor-list"), detail: rect(".pfp-editor-detail"), listScroll: rect(".pfp-editor-list .pfp-editor-scroll"), save: rect('[data-action="save"]'), discard: rect('[data-action="discard"]'), preview: rect(".pfp-editor-preview"), head: rect(".pfp-editor-head"), items: document.querySelectorAll('[data-action="pick-item"]').length, viewport: window.innerHeight };
    });
    for (const theme of ["parchment", "dark", "contrast"]) {
      const wide = await renderState(page, { scene: "editorRows", theme, width: 900, textSize: 100, hostile: "important 2.5rem" });
      assert.deepEqual(wide.problems, [], `${theme}: wide is clean`);
      const g = await geometry();
      assert.ok(g.items >= 100, `many items are listed (${g.items})`);
      assert.ok(g.list.right <= g.detail.left + 1 && Math.abs(g.list.top - g.detail.top) < 2, "the list is on the LEFT and the editor in the MIDDLE");
      assert.ok(g.detail.right <= g.preview.left + 1 && Math.abs(g.detail.top - g.preview.top) < 2, "what players see is on the RIGHT");
      assert.ok(g.listScroll.scrollHeight > g.listScroll.clientHeight + 100, "the long list scrolls inside its own box");
      assert.ok(g.save.bottom <= g.viewport && g.discard.bottom <= g.viewport && g.save.top >= g.detail.top, "Save and Discard are on screen without scrolling");
      assert.ok(g.head.bottom <= g.list.top + 1, "the intro sits above the panes and is not covered");
    }
    // v0.21.1: a narrow window about 400px wide is ONE scrolling column, in a tall window AND a short one, at 100% and 175% text: no pane squeezed, the filter row inside its pane,
    // no control over another (the page checks do that for every state; this loop draws the editor scenes at the sizes Nate found broken).
    for (const scene of ["editor300", "editorRows", "editorConfirm", "editorLeftovers", "editorCreate"]) for (const theme of ["parchment", "contrast"]) for (const [width, height] of [[400, 900], [400, 420], [320, 900], [320, 420]]) for (const textSize of [100, 175]) {
      const narrow = await renderState(page, { scene, theme, width, height, textSize, hostile: "important 2.5rem" });
      assert.deepEqual(narrow.problems, [], `${scene} ${theme} ${width}x${height} ${textSize}%`);
    }
    for (const width of [320, 280, 220]) {
      const narrow = await renderState(page, { scene: "editor300", width, textSize: 175, hostile: "important 2.5rem" });
      assert.deepEqual(narrow.problems, [], `${width}px: clean`);
      const g = await geometry();
      assert.ok(g.detail.top >= g.list.bottom - 1 && Math.abs(g.list.left - g.detail.left) < 2, `${width}px: the panes stack`);
      assert.ok(g.preview.top >= g.detail.bottom - 1 && Math.abs(g.detail.left - g.preview.left) < 2, `${width}px: the preview stacks below the editor`);
    }
  } finally { await b.close(); }
});

test("CHECKBOX RESET (v0.21.2): with Foundry-style checkbox CSS an unchecked box looks empty and a checked box shows ONE tick; without the reset the matrix fails", { skip, timeout: 180000 }, async () => {
  const b = await launchChromium();
  try {
    const inject = '<label class="pfp-check"><input type="checkbox" aria-label="Second box" checked> Second box</label><label class="pfp-check"><input type="radio" name="r" aria-label="A radio"> A radio</label>';
    const withReset = await openHarness(b);
    for (const hostile of [null, ...Object.keys(HOSTILE)]) for (const theme of ["parchment", "dark", "contrast"]) for (const textSize of [100, 175]) {
      for (const spec of [{ scene: "editor300" }, { scene: "editorEmpty", inject }]) {
        const { problems } = await renderState(withReset, { ...spec, theme, hostile, width: 900, textSize });
        assert.deepEqual(problems.filter(p => /checkbox|radio|\bmark/.test(p)), [], `${spec.scene} ${theme} ${textSize}% hostile=${hostile}`);
      }
    }
    // MUTATION: the same stylesheet with the reset cut out. Foundry's dark square and double tick then show, and the checks must say so.
    const without = await openHarness(b, { stripReset: true });
    const { problems } = await renderState(without, { scene: "editor300", hostile: "important 2.5rem", width: 900, textSize: 100 });
    assert.ok(problems.some(p => /unchecked checkbox .* shows 1 mark/.test(p)), `the dark filled square is caught: ${problems}`);
    assert.ok(problems.some(p => /checked checkbox .* shows 2 marks, not exactly one/.test(p)), `the second tick is caught: ${problems}`);
    const injected = await renderState(without, { scene: "editorEmpty", hostile: "plain 2rem hidden", width: 900, textSize: 100, inject });
    assert.ok(injected.problems.some(p => /radio/.test(p)) && injected.problems.some(p => /checked checkbox "Second box"/.test(p)), "any checkbox or radio is caught, not just the Persistent one");
  } finally { await b.close(); }
});
