/** Where the tag window opens from (Slice 1, GM only): a scene-controls button and a header button on the sheet of ANY item (it opens already aimed at that item). */
import { MODULE_ID } from "../config.js";
import { openTagger } from "./app.js";
import { itemRefCandidates } from "../adapter/pf2e.js";
import { getLedger } from "./current.js";
import { refWarning, T } from "./model.js";

const OPEN_ID = "pfpItemTags";
const ACTION = "pfp-item-tags";
const V1_CLASS = "pfp-item-tags";
export const V1_HOOK = "getItemSheetHeaderButtons";

export function installTagEntryPoints(getApi, hooks = globalThis.Hooks) {
  hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;
    const group = controls?.tokens ?? controls?.token ?? Object.values(controls ?? {})[0];
    if (!group?.tools) { console.error(`${MODULE_ID} | the scene controls have a shape this module does not know, so the Item tags button was not added`, controls); return; }
    group.tools[OPEN_ID] = { name: OPEN_ID, title: T.title, icon: "fa-solid fa-tags", button: true, order: 92, visible: true, onChange: () => openTagger(getApi()) };
  });
  // The tag window opens aimed at the item whose sheet the button sits on. What the module resolved is logged (console.debug), so a click that opens nothing can be traced.
  const prefillFor = item => {
    const candidates = itemRefCandidates(item);
    return { materialId: item.getFlag?.(MODULE_ID, "material")?.materialId, uuid: candidates.find(r => getLedger().items[r]) ?? candidates[0], name: item.name, noSource: Boolean(refWarning(item)) };
  };
  const openFor = item => openTagger(getApi(), prefillFor(item));
  hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const item = app?.document;
    if (!game.user.isGM || item?.documentName !== "Item" || !Array.isArray(controls) || controls.some(c => c.action === ACTION)) return;
    controls.push({ action: ACTION, icon: "fa-solid fa-tags", label: T.title, visible: true, onClick: () => openFor(item) });
  });
  // ApplicationV1 sheets (PF2e's item sheets are V1): Foundry calls get<ClassName>HeaderButtons for each class in the sheet's inheritance chain; ItemSheet is in every item sheet's chain.
  // Every guard that stops the button being added says so with console.debug (a Player is the normal case and says nothing).
  hooks.on(V1_HOOK, (sheet, buttons) => {
    if (!game.user.isGM) return;
    const item = sheet?.item ?? sheet?.document;
    if (item?.documentName !== "Item") { console.debug(`${MODULE_ID} | Item tags button not added: the sheet's document is not an Item`, { sheetClass: sheet?.constructor?.name, documentName: item?.documentName }); return; }
    if (!Array.isArray(buttons)) { console.debug(`${MODULE_ID} | Item tags button not added: the header buttons are not a list`, { sheetClass: sheet?.constructor?.name }); return; }
    if (buttons.some(b => b.class === V1_CLASS)) { console.debug(`${MODULE_ID} | Item tags button not added again: this sheet already has it`, { sheetClass: sheet?.constructor?.name }); return; }
    // An ApplicationV1 header button runs its onclick callback (V2's `action` name does nothing here). It waits for the window to draw, and a failure is reported, never swallowed by the click.
    buttons.unshift({
      label: T.title, class: V1_CLASS, icon: "fa-solid fa-tags",
      onclick: async event => {
        event?.preventDefault?.();
        console.debug(`${MODULE_ID} | Item tags button clicked`, { sheetClass: sheet?.constructor?.name, name: item.name, uuid: item.uuid, type: item.type });
        try {
          if (!game.user.isGM) { console.debug(`${MODULE_ID} | Item tags button stopped: the user is not a GM`); return undefined; }
          const prefill = prefillFor(item);
          console.debug(`${MODULE_ID} | opening the Item tags window with`, prefill);
          const app = openTagger(getApi(), prefill);
          await app.opened;
          console.debug(`${MODULE_ID} | the Item tags window finished drawing`, { rendered: app.rendered, id: app.id });
          return app;
        } catch (error) { console.error(`${MODULE_ID} | the Item tags button could not open the window for ${item?.name}`, error); globalThis.ui?.notifications?.error?.(`${T.title}: ${error?.message ?? error}`); return undefined; }
      }
    });
  });
}
