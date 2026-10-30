/**
 * Where the Hub opens from (Stage 11a): a scene-controls button for every user, and a "Downtime" button in the character sheet's header.
 * Both just call openHub. The hook shapes are Foundry's (getSceneControlButtons: v14 docs; header controls: ApplicationV2 and the older
 * sheet button list), so each is guarded: if a shape is not what we expect, we log it loudly instead of failing or hiding silently.
 */
import { MODULE_ID } from "../config.js";
import { S } from "./strings.js";
import { defaultCharacter, ownedCharacters } from "./facts.js";
import { openHub } from "./app.js";

const OPEN_ID = "pfpDowntime";

/** May this user open the Hub for this actor? A character they own. */
export const mayOpenFor = actor => actor?.type === "character" && actor.testUserPermission(game.user, "OWNER");

/** Open for the user's own character (a switcher is in the window when they have several). */
export function openForUser(api) {
  if (!defaultCharacter()) { ui.notifications?.warn?.(`${MODULE_ID}: ${S.noCharacter}`); }
  return openHub(api, defaultCharacter());
}

export function installEntryPoints(getApi, hooks = globalThis.Hooks) {
  hooks.on("getSceneControlButtons", controls => {
    const group = controls?.tokens ?? controls?.token ?? Object.values(controls ?? {})[0];
    if (!group?.tools) { console.error(`${MODULE_ID} | the scene controls have a shape this module does not know, so the Downtime button was not added`, controls); return; }
    group.tools[OPEN_ID] = {
      name: OPEN_ID, title: S.appTitle, icon: "fa-solid fa-hourglass-half", button: true, order: 90, visible: true,
      onChange: () => openForUser(getApi())
    };
  });

  const control = actor => ({ action: "pfp-open-hub", icon: "fa-solid fa-hourglass-half", label: S.appTitle, visible: true, onClick: () => openHub(getApi(), actor) });
  // ApplicationV2 sheets
  hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app?.document?.documentName === "Actor" ? app.document : null;
    if (!mayOpenFor(actor) || !Array.isArray(controls) || controls.some(c => c.action === "pfp-open-hub")) return;
    controls.push(control(actor));
  });
  // Older (ApplicationV1) sheets
  hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet?.actor ?? sheet?.document;
    if (!mayOpenFor(actor) || !Array.isArray(buttons) || buttons.some(b => b.class === "pfp-open-hub")) return;
    buttons.unshift({ label: S.appTitle, class: "pfp-open-hub", icon: "fa-solid fa-hourglass-half", onclick: () => openHub(getApi(), actor) });
  });
}

export { ownedCharacters };
