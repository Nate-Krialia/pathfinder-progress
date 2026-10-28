/**
 * "Search the area": a character's Perception total against the Perception DCs of the hidden nodes on a
 * scene. Pure. The player-facing words never depend on whether anything was there: a failed search and an
 * empty scene read exactly the same, and the number of hidden nodes left is never mentioned.
 */

export const SEARCH_TEXT = "You search the area.";
export const SEARCHED_ALREADY_TEXT = "You have already searched this area.";

/** Which hidden nodes does a Perception total spot? @param {Array<{ id: string, dc: number }>} nodes */
export const spottedIds = (total, nodes) => nodes.filter(node => total >= node.dc).map(node => node.id);

/** What the player is told: the same line every time, plus only what was actually spotted. */
export function searchMessage(spottedNames) {
  if (!spottedNames.length) return SEARCH_TEXT;
  return `${SEARCH_TEXT} You spot: ${spottedNames.join(", ")}.`;
}
