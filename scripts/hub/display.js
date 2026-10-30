/** The Hub's display settings (per player, a client setting). Pure. */
import { HUB } from "../config.js";

export const DEFAULT_DISPLAY = Object.freeze({ ...HUB.defaultDisplay });

/** A display setting in a safe shape: anything unknown falls back to the default for that one field. */
export function normalizeDisplay(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    textSize: HUB.textSizes.includes(value.textSize) ? value.textSize : DEFAULT_DISPLAY.textSize,
    theme: HUB.themes.includes(value.theme) ? value.theme : DEFAULT_DISPLAY.theme,
    font: HUB.fonts.includes(value.font) ? value.font : DEFAULT_DISPLAY.font
  };
}

/** The change `{ textSize | theme | font }` applied to a display setting (unknown values are ignored). */
export const withDisplay = (display, change) => normalizeDisplay({ ...display, ...change });

/** The real font size, in px, of the window's text: the base size scaled by the chosen percentage. Not CSS zoom. */
export const fontPx = display => Math.round((HUB.basePx * normalizeDisplay(display).textSize) / 100 * 100) / 100;

/** The attributes and custom properties set on the app's root element. */
export function rootStyle(display) {
  const d = normalizeDisplay(display);
  return { theme: d.theme, font: d.font, fontPx: fontPx(d), css: `--pfp-font-size:${fontPx(d)}px;` };
}
