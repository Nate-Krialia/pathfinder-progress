/** Where the tag window opens from (Slice 1, GM only): a scene-controls button and a header button on the sheet of ANY item (it opens already aimed at that item). */
import { MODULE_ID } from "../config.js";
import { openTagger } from "./app.js";
import { itemRefCandidates } from "../adapter/pf2e.js";
import { getLedger } from "./current.js";
import { refWarning, T } from "./model.js";

const OPEN_ID = "pfpItemTags";
const ACTION = "pfp-item-tags";

export function installTagEntryPoints(getApi, hooks = globalThis.Hooks) {
  hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;
    const group = controls?.tokens ?? controls?.token ?? Object.values(controls ?? {})[0];
    if (!group?.tools) { console.error(`${MODULE_ID} | the scene controls have a shape this module does not know, so the Item tags button was not added`, controls); return; }
    group.tools[OPEN_ID] = { name: OPEN_ID, title: T.title, icon: "fa-solid fa-tags", button: true, order: 92, visible: true, onChange: () => openTagger(getApi()) };
  });
  hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const item = app?.document;
    if (!game.user.isGM || item?.documentName !== "Item" || !Array.isArray(controls) || controls.some(c => c.action === ACTION)) return;
    controls.push({
      action: ACTION, icon: "fa-solid fa-tags", label: T.title, visible: true,
      onClick: () => openTagger(getApi(), { materialId: item.getFlag?.(MODULE_ID, "material")?.materialId, uuid: itemRefCandidates(item).find(r => getLedger().items[r]) ?? itemRefCandidates(item)[0], name: item.name, noSource: Boolean(refWarning(item)) })
    });
  });
}
