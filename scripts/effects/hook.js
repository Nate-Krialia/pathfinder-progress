/**
 * The GM-assisted hook for effects that act on a target (Stage 11d, v0.22.0). The ONE active GM client sees a message about a crafted item, decides whether it is a hit or a
 * use that carries an "Apply a condition" effect, and whispers the GM a card with Apply and Skip. Pressing Apply rolls the target's save in secret and puts the condition on
 * the TARGET TOKEN's actor. Everything that knows a PF2e message shape is in adapter/pf2e-effects.js; this file is built over an injected adapter so the tests drive it with plain
 * objects. A message it cannot place degrades to a fallback card (the GM picks the target), never to silence.
 */
import { EFFECTS, MODULE_ID } from "../config.js";
import { FX_FLAG, cardFlag, cardMessage, doneContent, failedContent, headline, skippedContent } from "./card.js";
import { decide, effectsOf, linesFor } from "./resolve.js";
import { runApply } from "./apply.js";

/**
 * @param {object} deps
 *   adapter   scripts/adapter/pf2e-effects.js (or a fake)
 *   registry  () => the GM's definitions registry
 *   chat      { create(data) -> message, get(id) -> message, gmIds() -> [id] }
 *   log       (entry) => void           the GM log
 *   levelDC   (level) => number
 *   notify    { info(text), warn(text) }
 *   now       () => ms
 */
export function createEffects(deps) {
  const { adapter, chat, notify } = deps;
  const now = deps.now ?? (() => Date.now());
  const seenMessages = new Set(), seenOrigins = new Map(), inFlight = new Set();
  const applyDeps = { itemByUuid: adapter.itemByUuid, craftedFlag: adapter.craftedFlag, tokenInfo: adapter.tokenInfo, rollSave: adapter.rollSave, applyCondition: adapter.applyCondition, levelDC: deps.levelDC, log: deps.log };

  const names = async uuids => Promise.all(uuids.map(async uuid => (await adapter.tokenInfo(uuid))?.name ?? "a target"));

  /** A message in, a card out (or null). The caller is the active GM's client. */
  async function handle(message) {
    const event = adapter.readMessage(message);
    if (event.kind === "none" || event.kind === "damage") return null;       // not an item message / a damage roll is never a trigger
    if (event.messageId && seenMessages.has(event.messageId)) return null;
    if (event.kind === "consumable" && event.originUuid) {
      const at = seenOrigins.get(event.originUuid);
      if (at !== undefined && now() - at < EFFECTS.dedupeMs) return null;      // the second card (Use pressed on the first) is the same use
    }
    const item = await adapter.resolveItem(event, message);
    const flag = adapter.craftedFlag(item);
    if (!flag) return null;
    const { itemClass, effects } = effectsOf(flag, deps.registry());
    if (!effects.length) return null;
    const own = event.kind === "attack" && event.targetTokenUuid ? [event.targetTokenUuid] : adapter.authorTargets(message);   // context.target holds only the first target
    const decision = decide(event, itemClass, own.length);
    if (decision === "skip") return null;
    if (event.messageId) seenMessages.add(event.messageId);
    if (event.kind === "consumable" && event.originUuid) seenOrigins.set(event.originUuid, now());
    const targets = decision === "fallback" ? [] : own;
    const text = headline({ itemName: item.name, kind: event.kind === "attack" || event.kind === "consumable" ? event.kind : "other", outcome: event.outcome, itemClass, targetNames: await names(targets), mode: decision, lines: linesFor(effects) });
    return chat.create(cardMessage({ whisper: chat.gmIds(), flag: cardFlag({ itemUuid: item.uuid, targets, effects: effects.map(e => e.index), fallback: decision === "fallback", text }) }));
  }

  /** Never throws. If something goes wrong after the message was recognised, the GM still gets a fallback card. */
  async function onMessage(message) {
    try { return await handle(message); }
    catch (error) {
      console.error(`${MODULE_ID} | effects hook`, error);
      try {
        const item = message?.item;
        const flag = adapter.craftedFlag(item);
        const { effects } = flag ? effectsOf(flag, deps.registry()) : { effects: [] };
        if (!effects.length) return null;
        const text = headline({ itemName: item.name, kind: "other", mode: "fallback", lines: linesFor(effects) });
        return await chat.create(cardMessage({ whisper: chat.gmIds(), flag: cardFlag({ itemUuid: item.uuid, targets: [], effects: effects.map(e => e.index), fallback: true, text }) }));
      } catch (second) { console.error(`${MODULE_ID} | effects hook fallback`, second); return null; }
    }
  }

  const setState = (message, state, extra = {}) => message.update({ ...extra, [`flags.${MODULE_ID}.${FX_FLAG}.state`]: state });

  /** Press Apply on a card. `forceDegree` is for the gate and the tests (a save degree instead of a roll). */
  async function applyCard(messageId, { forceDegree } = {}) {
    const message = chat.get(messageId);
    const fx = message?.getFlag?.(MODULE_ID, FX_FLAG);
    if (!fx) return { ok: false, reason: "That is not an effect card." };
    if (inFlight.has(messageId) || fx.state !== "pending") return { ok: false, reason: "That card was already handled." };
    inFlight.add(messageId);
    try {
      const targets = fx.fallback || !fx.targets?.length ? adapter.gmPicks() : fx.targets;
      if (!targets.length) { notify.warn("Target or select a token first, then press Apply."); return { ok: false, reason: "no target" }; }
      await setState(message, "working");
      const result = await runApply({ flag: { ...fx, targets }, registry: deps.registry(), deps: applyDeps, forceDegree });
      if (!result.ok) { await setState(message, "failed", { content: failedContent(fx.text, result.reason) }); return result; }
      await setState(message, "done", { content: doneContent(fx.text, result.results) });
      return result;
    } catch (error) {
      console.error(`${MODULE_ID} | effects apply`, error);
      try { await setState(message, "pending"); } catch { /* the card stays as it is */ }
      notify.warn(`Could not apply: ${error.message}`);
      return { ok: false, reason: error.message };
    } finally { inFlight.delete(messageId); }
  }

  async function skipCard(messageId) {
    const message = chat.get(messageId);
    const fx = message?.getFlag?.(MODULE_ID, FX_FLAG);
    if (!fx || fx.state !== "pending" || inFlight.has(messageId)) return { ok: false, reason: "That card was already handled." };
    await setState(message, "skipped", { content: skippedContent(fx.text) });
    return { ok: true };
  }

  /** Draw a card's buttons: GM only, and only while it is pending. */
  function onRender(message, html, { isGM }) {
    const fx = message?.getFlag?.(MODULE_ID, FX_FLAG);
    if (!fx) return;
    const buttons = [...(html?.querySelectorAll?.("[data-pfp-fx]") ?? [])];
    if (!isGM) { buttons.forEach(b => b.remove()); return; }
    for (const button of buttons) {
      if (fx.state !== "pending") { button.disabled = true; continue; }
      if (button.dataset.wired) continue;
      button.dataset.wired = "1";
      button.addEventListener("click", () => {
        buttons.forEach(b => { b.disabled = true; });                             // disabled while in flight, so a second click cannot start a second roll
        const done = button.dataset.pfpFx === "skip" ? skipCard(message.id) : applyCard(message.id);
        done.then(r => { if (!r.ok && fx.state === "pending") buttons.forEach(b => { b.disabled = false; }); });
      });
    }
  }

  return { handle, onMessage, applyCard, skipCard, onRender };
}

/** The one place main.js calls: the two Foundry hooks. Only the active GM reacts to a message; every GM client draws the buttons. */
export function installEffectsHooks(effects, { isActiveGM, isGM }) {
  Hooks.on("createChatMessage", message => (isActiveGM() ? effects.onMessage(message) : undefined));
  Hooks.on("renderChatMessageHTML", (message, html) => effects.onRender(message, html, { isGM: isGM() }));
}
