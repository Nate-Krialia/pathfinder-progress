/**
 * Hidden difficulty (docs/11b-hub-addendum.md, A). A leaf module.
 *
 * Players NEVER see a DC, odds, a percentage or any difficulty wording. The GM does. So anything the module builds for a player
 * (a queue row, a project returned over the socket, a preview) must not CARRY these fields at all: they are removed at the source,
 * not hidden in a UI. `HIDDEN_FIELDS` is the list the scanner tests look for in everything a player-callable api returns.
 *
 * Honor system: data Foundry stores on an actor, a token or a world setting (a project's `dc` in the actor flag, a node's
 * `perceptionDC`) is delivered to every client that can read that document. That is reported, not pretended (docs/11b).
 */
export const HIDDEN_FIELDS = ["dc", "chances", "chance", "odds", "expectedProgressPerDay", "expectedDaysToFinish", "approximate", "slotLossChance", "materialLossChance", "lossChance", "craftLevel", "explorationDC", "perceptionDC", "encounterChance"];

/** A deep copy without any hidden field, at any depth. */
export function withoutDifficulty(value) {
  if (Array.isArray(value)) return value.map(withoutDifficulty);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !HIDDEN_FIELDS.includes(key)).map(([key, inner]) => [key, withoutDifficulty(inner)]));
  }
  return value;
}

/** A research project as a player may see it: what it is, how far along, what it needs; never the DC. (Progress stays: it is progress, not difficulty.) */
export const playerProject = project => withoutDifficulty(project);
