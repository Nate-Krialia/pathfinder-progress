/**
 * Hidden difficulty (docs/11b-hub-addendum.md, A). A leaf module.
 *
 * Players NEVER see a DC, odds, a percentage, a STUDY threshold or any difficulty wording. The GM does. The one deliberate exception (decided by the project owner): a formula project's
 * progress, shown as "Progress n of m", so players can make better decisions (studies still show stage words only). So anything the module builds for a player
 * (a queue row, a project returned over the socket, a preview) must not CARRY these fields at all: they are removed at the source,
 * not hidden in a UI. `HIDDEN_FIELDS` is the list the scanner tests look for in everything a player-callable api returns.
 *
 * Honor system: data Foundry stores on an actor, a token or a world setting (a project's `dc` in the actor flag, a node's
 * `perceptionDC`) is delivered to every client that can read that document. That is reported, not pretended (docs/11b).
 */
export const HIDDEN_FIELDS = ["dc", "chances", "chance", "odds", "expectedProgressPerDay", "expectedDaysToFinish", "approximate", "slotLossChance", "materialLossChance", "lossChance", "craftLevel", "explorationDC", "perceptionDC", "encounterChance"];

/** Wording that talks about a DC, odds, a percentage or difficulty. The Hub refuses to show free text that matches (hints, a GM's note); the tests scan with the same pattern. */
export const DIFFICULTY_WORDS = /\bDC\b|\bodds\b|\d\s?%|\bchances?\b|\bdifficult|\bexpected\b|\bexpect ~|\bpercent\b/i;
export const isDifficultyText = text => DIFFICULTY_WORDS.test(String(text ?? ""));

/** A deep copy without any hidden field, at any depth. */
export function withoutDifficulty(value) {
  if (Array.isArray(value)) return value.map(withoutDifficulty);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !HIDDEN_FIELDS.includes(key)).map(([key, inner]) => [key, withoutDifficulty(inner)]));
  }
  return value;
}

/** A research project as a player may see it: what it is, how far along, what it needs; never the DC. (Progress stays: it is progress, not difficulty.) */
export const playerProject = project => {
  const clean = withoutDifficulty(project);
  // A project's log carries the GM's free-text `note` (addProgress's reason, an abandon reason): it can say anything, so a player's copy never holds one (each entry keeps source, delta, skill, degree).
  return Array.isArray(clean?.log) ? { ...clean, log: clean.log.map(({ note, ...entry }) => entry) } : clean;
};
