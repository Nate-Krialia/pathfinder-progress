/**
 * The module's socket (socketlib): the one place that registers it.
 *
 * A player's "Search the area" is relayed to the GM client, so EVERY client (players and GMs alike)
 * registers the same functions, once, when socketlib says it is ready (its documented way).
 *
 * socketlib REFUSES to register a module whose manifest lacks `"socket": true`: it logs its own error and
 * `registerModule` returns nothing. That is reported here in plain words, because it needs a server restart
 * to fix (a browser reload is not enough). module.json must keep `"socket": true`; a test guards it.
 */
import { MODULE_ID } from "./config.js";
import * as exploration from "./exploration/store.js";
import * as queueStore from "./queue/store.js";
import * as work from "./queue/work.js";
import { guard } from "./queue/relay.js";

let socket = null;

/** Register with socketlib. Returns the socket, or null (and says why in the console) if socketlib would not register us. */
export function ensureSocket() {
  if (socket) return socket;
  const lib = globalThis.socketlib;
  if (!lib?.registerModule) return null;
  let registered;
  try {
    registered = lib.registerModule(MODULE_ID);
  } catch (error) {
    console.error(`${MODULE_ID} | socketlib refused to register this module`, error);
    return null;
  }
  if (!registered) {
    console.error(`${MODULE_ID} | socketlib would not register this module (see its message above). The usual cause is a manifest without "socket": true; after installing a version that adds it, the Foundry SERVER must be fully restarted (reloading the browser or returning to setup is not enough).`);
    return null;
  }
  // EVERY handler is wrapped in guard(): real socketlib hides the message of anything a handler throws, so a refusal
  // must travel as data (see queue/relay.js). A test walks every registered handler and fails if one can still throw.
  registered.register("search", guard("search", options => exploration.runSearch(options)));
  // Craft and gather are queued and cancelled on the GM client (see queue/work.js). `this` carries socketlib's sender, if it gives one.
  registered.register("queueSubmit", guard("queueSubmit", function queueSubmit(payload) { return queueStore.runSubmit(payload, this); }));
  registered.register("queueCancel", guard("queueCancel", function queueCancel(payload) { return queueStore.runCancel(payload, this); }));
  socket = registered;
  exploration.setSocket(socket);
  work.setSocket(socket);
  console.log(`${MODULE_ID} | socket registered (${globalThis.game?.user?.isGM ? "GM" : "player"} client)`);
  return socket;
}

/** What the module can tell you about its socket (for troubleshooting): api.socketStatus(). */
export function socketStatus() {
  return {
    registered: Boolean(socket),
    socketlibActive: Boolean(globalThis.game?.modules?.get("socketlib")?.active),
    socketlibGlobal: Boolean(globalThis.socketlib?.registerModule),
    client: globalThis.game?.user?.isGM ? "GM" : "player",
    activeGM: globalThis.game?.users?.activeGM?.name ?? null
  };
}

/** Register on `socketlib.ready`, and make sure someone is told if that did not work. Call once, at load. */
export function installSocketHooks(hooks = globalThis.Hooks) {
  hooks.once("socketlib.ready", ensureSocket);
  hooks.once("ready", () => {
    if (socket) return;
    console.error(`${MODULE_ID} | the socket is not registered: ${JSON.stringify(socketStatus())}`);
    if (globalThis.game?.user?.isGM) {
      globalThis.ui?.notifications?.error(`${MODULE_ID}: the socket is not registered, so players cannot "Search the area". Check the console (F12); if the manifest was just updated, fully restart the Foundry server.`);
    }
  });
}

/** For tests only: forget the registration so the next call registers again. */
export function _resetSocketForTests() {
  socket = null;
  exploration.setSocket(null);
  work.setSocket(null);
}
