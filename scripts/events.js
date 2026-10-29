/**
 * A tiny in-process event list, so one module can announce something without importing the module that reacts to it (research
 * announces "formulaOwned"; the Compendium reveals the baseline). A leaf: no imports. Handlers must not throw; they are best-effort.
 */
const handlers = new Map();
export function on(name, fn) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); }
export async function emit(name, payload) {
  for (const fn of handlers.get(name) ?? []) {
    try { await fn(payload); } catch (error) { console.error(`pathfinder-progress | a "${name}" handler failed (the action itself is saved)`, error); }
  }
}
/** For tests only. */
export const _clearHandlersForTests = () => handlers.clear();
