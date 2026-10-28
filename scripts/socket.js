/**
 * The module's socket (socketlib): the one place that registers it.
 *
 * A player's "Search the area" is relayed to the GM client, so EVERY client (players and GMs alike) must
 * register the same functions. socketlib's documentation does not say when `socketlib.ready` fires relative to
 * a module's own script, so registration is idempotent and tried at every moment it could work: on
 * `socketlib.ready`, `init`, `setup` and `ready`, and again, lazily, the first time the socket is needed.
 */
import { MODULE_ID } from "./config.js";
import * as exploration from "./exploration/store.js";

let socket = null;

/** Register with socketlib if it is available and we have not already. Returns the socket, or null if socketlib is not usable yet. */
export function ensureSocket() {
  if (socket) return socket;
  const lib = globalThis.socketlib;
  if (!lib?.registerModule) return null;
  try {
    const registered = lib.registerModule(MODULE_ID);
    registered.register("search", options => exploration.runSearch(options));
    socket = registered;
    exploration.setSocket(socket);
    console.log(`${MODULE_ID} | socket registered (${globalThis.game?.user?.isGM ? "GM" : "player"} client)`);
  } catch (error) {
    socket = null;
    console.error(`${MODULE_ID} | could not register with socketlib; "Search the area" will not work for players`, error);
  }
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

/** Wire the registration to every hook that could be the right moment. Call once, at load. */
export function installSocketHooks(hooks = globalThis.Hooks) {
  exploration.setSocketProvider(ensureSocket);
  hooks.once("socketlib.ready", ensureSocket);
  hooks.once("init", ensureSocket);
  hooks.once("setup", ensureSocket);
  hooks.once("ready", () => {
    if (ensureSocket()) return;
    const status = socketStatus();
    console.error(`${MODULE_ID} | socketlib is not available (${JSON.stringify(status)}). Install and enable socketlib.`);
    if (globalThis.game?.user?.isGM) globalThis.ui?.notifications?.error(`${MODULE_ID}: socketlib is required (players' "Search the area" needs it) but it is not available. Install and enable it.`);
  });
}

/** For tests only: forget the registration so the next call registers again. */
export function _resetSocketForTests() {
  socket = null;
  exploration.setSocket(null);
}
