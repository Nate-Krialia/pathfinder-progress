/**
 * Live updates for the Hub (Stage 11a). The window redraws itself ONLY for data that can change what it shows for the character it is
 * viewing, plus the shared downtime, queue and definitions state. Debounced; no polling.
 *
 * `isRelevant` is pure (tested in Node). `installHubHooks` binds it to Foundry's hooks and to the "definitionsRefreshed" event that the
 * v0.16.0 definitions path (data/playerDefs.js) emits when a player client has loaded new records.
 */
import { COMPENDIUM, HUB, MODULE_ID, QUEUE_KEYS, RESEARCH_KEYS, STATION_KEYS, WORKSHOP, DEFINITIONS_SYNC, DOWNTIME } from "../config.js";
import * as events from "../events.js";

/** Actor flags that change what the viewed character's Formulae tab shows. */
export const WATCHED_ACTOR_FLAGS = [RESEARCH_KEYS.leadsFlag, RESEARCH_KEYS.formulasFlag, RESEARCH_KEYS.projectsFlag, RESEARCH_KEYS.daysFlag, QUEUE_KEYS.pendingFlag, COMPENDIUM.flag, STATION_KEYS.actorStationsFlag, STATION_KEYS.actorLocationFlag];
/** Shared world settings that change it (downtime, party location, workshops, the shared Compendium, the definitions revision). */
export const WATCHED_SETTINGS = [DOWNTIME.stateSetting, STATION_KEYS.partyLocationSetting, STATION_KEYS.stationStateSetting, WORKSHOP.partyStationsSetting, COMPENDIUM.sharedSetting, DEFINITIONS_SYNC.revisionSetting].map(key => `${MODULE_ID}.${key}`);

/**
 * @param {object} event  { type: "actor"|"item"|"setting"|"definitions"|"ownership", actorId?, flagKeys?, isMaterial?, key? }
 * @param {string|null} viewedId  the character the window is showing
 */
export function isRelevant(event, viewedId) {
  switch (event?.type) {
    case "actor": return event.actorId === viewedId && (event.flagKeys ?? []).some(key => WATCHED_ACTOR_FLAGS.includes(key));
    case "item": return event.actorId === viewedId && event.isMaterial === true;
    case "setting": return WATCHED_SETTINGS.includes(event.key);
    case "definitions": return true;
    case "ownership": return true;     // the switcher's list or the viewed character's access changed
    default: return false;
  }
}

/** Foundry's update hook -> the pure event. */
export const actorEvent = (actor, changes) => ({
  type: changes?.ownership ? "ownership" : "actor", actorId: actor?.id, flagKeys: Object.keys(changes?.flags?.[MODULE_ID] ?? {})
});

/**
 * Bind the hooks. `viewed()` returns the viewed character's id (or null when no window is open); `redraw()` redraws the window.
 * Returns the debounced `notify(event)` (tests call it directly).
 */
export function installHubHooks({ viewed, redraw, hooks = globalThis.Hooks, delay = HUB.liveDebounceMs }) {
  let timer = null;
  const notify = event => {
    const id = viewed();
    if (id === null || id === undefined || !isRelevant(event, id)) return false;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; redraw(); }, delay);
    return true;
  };
  hooks.on("updateActor", (actor, changes) => notify(actorEvent(actor, changes)));
  const item = (it, extra = {}) => notify({ type: "item", actorId: it?.parent?.id, isMaterial: Boolean(it?.getFlag?.(MODULE_ID, "material")), ...extra });
  hooks.on("createItem", it => item(it));
  hooks.on("deleteItem", it => item(it));
  hooks.on("updateItem", it => item(it));
  const setting = s => notify({ type: "setting", key: s?.key });
  hooks.on("updateSetting", setting);
  hooks.on("createSetting", setting);
  events.on("definitionsRefreshed", () => notify({ type: "definitions" }));
  return notify;
}
