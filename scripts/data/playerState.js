/**
 * Where a client stands with its definitions (Stage 16). No imports, so any module can read it without a cycle.
 * Kept per user id: in a real Foundry page there is exactly one user, and the test world runs several "clients" in one process.
 */
const states = new Map();

const fresh = () => ({
  status: "idle",          // idle | loading | ready | no-gm | failed
  message: "",             // the plain reason when not ready
  key: null,               // factsKey of the last successful load
  missing: new Set(),      // formulas held with no recipe on the GM (truly orphaned)
  loadedAt: 0,
  loads: 0                 // how many times the GM was asked and answered (for tests and troubleshooting)
});

export function defsState() {
  const id = globalThis.game?.user?.id ?? "?";
  if (!states.has(id)) states.set(id, fresh());
  return states.get(id);
}

/** For tests only. */
export const _resetDefsStateForTests = () => states.clear();

/** The plain sentence for a client that cannot say what a held recipe is yet. */
export function notLoadedText() {
  const s = defsState();
  if (s.status === "no-gm") return "The GM isn't connected, so your recipes can't be loaded yet.";
  if (s.status === "failed") return s.message || "Your recipes could not be loaded; tell the GM.";
  return "Your recipes are still loading; try again in a moment.";
}
