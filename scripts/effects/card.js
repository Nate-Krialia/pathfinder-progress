/**
 * The GM's card for an effect that acts on a target (v0.22.0). Pure; no Foundry globals.
 *
 * It is a whisper, and a whisper is still delivered to every client, so the text is plain words only ("Mitflit Fang hit Goblin A: makes the target fearful") and the
 * flag carries only the item's UUID, the target tokens' UUIDs and the effect indices. No condition value, save type or DC is in the text or the flag; they are looked up
 * on the GM's client when Apply is pressed. The result is written back into the same card, still a GM-only whisper.
 */
import { EFFECTS, MODULE_ID } from "../config.js";

export const FX_FLAG = EFFECTS.cardFlag;
const esc = text => String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const list = names => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The sentence at the top of the card. `kind`: attack | consumable | other; `mode`: card | fallback. */
export function headline({ itemName, kind, outcome, itemClass, targetNames, mode, lines }) {
  const what = list(lines);
  if (mode === "fallback") {
    return kind === "other" || kind === "attack"
      ? `${itemName} did something the module could not place. If it should affect someone, target or select them, then press Apply: ${what}.`
      : `${itemName} was used, but no one is targeted. Target or select who it affects, then press Apply: ${what}.`;
  }
  const who = list(targetNames);
  if (kind === "consumable") return `${itemName} was used on ${who}: ${what}.`;
  if (itemClass === "bomb") return outcome === "failure" ? `${itemName} missed ${who}, but you can still apply it: ${what}.` : `${itemName} hit ${who}: ${what}.`;
  return `${itemName} hit ${who}: ${what}.`;
}

const root = inner => `<div class="pfp-hub pfp-fx-card" data-layout="narrow">${inner}</div>`;   // the Hub's own reset and button rules apply (Foundry restyles buttons and lists in chat too)
const buttons = (disabled = false) => `<div class="pfp-row pfp-fx-actions"><button type="button" class="pfp-btn pfp-fx-btn" data-pfp-fx="apply"${disabled ? " disabled" : ""}>Apply</button><button type="button" class="pfp-btn pfp-fx-btn" data-pfp-fx="skip"${disabled ? " disabled" : ""}>Skip</button></div>`;

/** The chat content of a pending card. */
export const pendingContent = text => root(`<p class="pfp-fx-text">${esc(text)}</p>${buttons()}`);

/** The chat content once applied: the headline and a plain result per target. results: [{ name, lines: [text] }]. */
export const doneContent = (text, results) => root(`<p class="pfp-fx-text">${esc(text)}</p><ul class="pfp-fx-results">${results.map(r => `<li>${esc(r.name)} ${esc(r.lines.join(", "))}.</li>`).join("")}</ul>`);
export const skippedContent = text => root(`<p class="pfp-fx-text">${esc(text)}</p><p class="pfp-fx-results">Skipped.</p>`);
export const failedContent = (text, reason) => root(`<p class="pfp-fx-text">${esc(text)}</p><p class="pfp-fx-results">${esc(reason)}</p>`);

/** The flag a pending card carries: ids only. */
export const cardFlag = ({ itemUuid, targets, effects, fallback, text }) => ({ v: 1, state: "pending", itemUuid, targets, effects, ...(fallback ? { fallback: true } : {}), text });

/** The data for a new card message. */
export function cardMessage({ whisper, flag }) {
  return { whisper, content: pendingContent(flag.text), flags: { [MODULE_ID]: { [FX_FLAG]: flag } } };
}
