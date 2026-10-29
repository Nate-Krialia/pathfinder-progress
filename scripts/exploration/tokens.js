/**
 * Token and position data for node tokens. Pure; no Foundry globals.
 * Real tokens are made from the shared Resource Node actor by exploration/store.js.
 */
import { EXPLORATION, MODULE_ID, NODE_FLAG } from "../config.js";

/** The token image for a nodeType: its own `img`, else the default core icon. */
export const nodeImage = (nodeType, config = EXPLORATION) => nodeType?.img ?? config.defaultNodeImg;

/** Token data (on top of the actor's prototype token) for a hidden anchor. */
export function anchorTokenData({ x, y, record }, config = EXPLORATION) {
  return { name: config.anchorName, x, y, hidden: true, texture: { src: config.anchorImg }, flags: { [MODULE_ID]: { [NODE_FLAG]: record } } };
}

/** Token data for a node. An expedition's nodes are made hidden (`hidden: true`) until someone spots them. */
export function nodeTokenData({ x, y, record, nodeType, hidden = false }, config = EXPLORATION) {
  return { name: nodeType.name, x, y, hidden, texture: { src: nodeImage(nodeType, config) }, flags: { [MODULE_ID]: { [NODE_FLAG]: record } } };
}

const nodePath = `flags.${MODULE_ID}.${NODE_FLAG}`;

/** Mark an anchor as occupied by the node token standing on it. */
export const occupyUpdate = (anchorId, nodeTokenId) => ({ _id: anchorId, [`${nodePath}.occupiedBy`]: nodeTokenId });

/**
 * Free an anchor again. Foundry merges flag objects, so the key has to be deleted explicitly, with
 * Foundry's ForcedDeletion operator (the old minus-equals key syntax is deprecated in v14, removed in v16).
 */
export const vacateUpdate = anchorId => ({ _id: anchorId, [`${nodePath}.occupiedBy`]: forcedDeletion() });

export function forcedDeletion() {
  const Operator = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if (!Operator) throw new Error("foundry.data.operators.ForcedDeletion is missing (Foundry API changed?)");
  return new Operator();
}

/** Show a hidden node and record that it was found. */
export const revealUpdate = (tokenId, spotterName) => ({ _id: tokenId, hidden: false, [`${nodePath}.revealed`]: true, [`${nodePath}.revealedBy`]: spotterName });

/**
 * `n` random grid-snapped positions inside a scene's play area, not on top of each other or of
 * `occupied`. Returns fewer than n if the scene runs out of room.
 * @param {{ x: number, y: number, width: number, height: number }} area  the scene rectangle
 */
export function randomPositions(n, { area, gridSize, padding = EXPLORATION.placePaddingSquares, occupied = [], rng }) {
  const cols = Math.floor(area.width / gridSize) - 2 * padding;
  const rows = Math.floor(area.height / gridSize) - 2 * padding;
  if (cols < 1 || rows < 1) return [];
  const key = (x, y) => `${x},${y}`;
  const taken = new Set(occupied.map(p => key(Math.round((p.x - area.x) / gridSize), Math.round((p.y - area.y) / gridSize))));
  const free = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const col = c + padding;
    const row = r + padding;
    if (!taken.has(key(col, row))) free.push({ x: area.x + col * gridSize, y: area.y + row * gridSize });
  }
  const out = [];
  while (out.length < n && free.length) out.push(free.splice(Math.floor(rng() * free.length), 1)[0]);
  return out;
}
