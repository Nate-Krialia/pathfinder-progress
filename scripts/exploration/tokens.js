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

/** Token data for a ready-to-gather node. */
export function nodeTokenData({ x, y, record, nodeType }, config = EXPLORATION) {
  return { name: nodeType.name, x, y, hidden: false, texture: { src: nodeImage(nodeType, config) }, flags: { [MODULE_ID]: { [NODE_FLAG]: record } } };
}

/**
 * The update that activates an anchor token: the new record, shown, and (if the token still
 * has the default anchor look) renamed and re-imaged after its nodeType.
 */
export function activationUpdate({ tokenId, record, nodeType, currentName }, config = EXPLORATION) {
  const update = { _id: tokenId, hidden: false, [`flags.${MODULE_ID}.${NODE_FLAG}`]: record };
  if (currentName === config.anchorName) {
    update.name = nodeType.name;
    update["texture.src"] = nodeImage(nodeType, config);
  }
  return update;
}

/**
 * The update that puts an activated token back as it was. Keys the activation ADDED are removed
 * (Foundry merges flag objects, so they must be deleted explicitly).
 */
export function revertUpdate({ tokenId, before }) {
  const update = { _id: tokenId, hidden: before.hidden, name: before.name, "texture.src": before.img };
  const path = `flags.${MODULE_ID}.${NODE_FLAG}`;
  for (const key of before.addedKeys) update[`${path}.-=${key}`] = null;
  for (const [key, value] of Object.entries(before.record)) update[`${path}.${key}`] = value;
  return update;
}

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
