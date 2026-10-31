/**
 * Where the Discovery tracks window opens from (Stage 11c, GM only): a scene-controls button, and a header button on the sheet of any item that is a defined
 * material or note. Both just call openEditor. Shapes are guarded the same way as the Hub's entry points: a shape this module does not know is logged loudly.
 */
import { DISCOVERY, MODULE_ID } from "../config.js";
import { openEditor } from "./editor-app.js";
import { itemKey } from "./track.js";
import { E } from "./editor-model.js";

const OPEN_ID = "pfpDiscoveryTracks";

/** The editor key of a Foundry item that is a defined material or note, or null. */
export function keyOfItem(item) {
  const material = item?.getFlag?.(MODULE_ID, "material");
  if (material?.materialId) return itemKey("material", material.materialId);
  const note = item?.getFlag?.(MODULE_ID, DISCOVERY.noteFlag);
  return note?.noteId ? itemKey("note", note.noteId) : null;
}

export function installDiscoveryEntryPoints(getApi, hooks = globalThis.Hooks) {
  hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;
    const group = controls?.tokens ?? controls?.token ?? Object.values(controls ?? {})[0];
    if (!group?.tools) { console.error(`${MODULE_ID} | the scene controls have a shape this module does not know, so the Discovery tracks button was not added`, controls); return; }
    group.tools[OPEN_ID] = { name: OPEN_ID, title: E.title, icon: "fa-solid fa-book-open", button: true, order: 91, visible: true, onChange: () => openEditor(getApi()) };
  });
  hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const key = game.user.isGM && app?.document?.documentName === "Item" ? keyOfItem(app.document) : null;
    if (!key || !Array.isArray(controls) || controls.some(c => c.action === "pfp-discovery-track")) return;
    controls.push({ action: "pfp-discovery-track", icon: "fa-solid fa-book-open", label: E.title, visible: true, onClick: () => openEditor(getApi(), key) });
  });
}
