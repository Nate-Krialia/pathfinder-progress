/**
 * Taking back ONE merge from a shared book without touching anything else (pure). A merge into the world's shared Compendium is additive; when the approval that made it fails
 * afterwards, only the pieces that merge changed go back. Whatever another approval wrote into the same book in the meantime stays.
 *
 * `changedPaths(before, after)` lists every place where the merge made a difference (to the deepest object key; arrays and plain values are leaves).
 * `revertPaths(current, changes, before)` puts each of those places back to what it was, but ONLY where the book still holds what the merge wrote there: a place someone else changed
 * since is left alone. Objects the merge created and that are empty again are removed.
 */
const isPlain = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function changedPaths(before, after, path = []) {
  const out = [];
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const was = before?.[key], now = after?.[key];
    if (same(was, now)) continue;
    if (isPlain(was) && isPlain(now)) out.push(...changedPaths(was, now, [...path, key]));
    else out.push({ path: [...path, key], before: was, after: now });
  }
  return out;
}

const read = (root, path) => path.reduce((node, key) => (isPlain(node) ? node[key] : undefined), root);

export function revertPaths(current, changes, before = {}) {
  const next = structuredClone(isPlain(current) ? current : {});
  for (const change of changes) {
    if (!same(read(next, change.path), change.after)) continue;                    // changed by someone else since: not ours to put back
    let parent = next;
    for (const key of change.path.slice(0, -1)) parent = parent[key];
    const last = change.path.at(-1);
    if (change.before === undefined) delete parent[last]; else parent[last] = structuredClone(change.before);
    // an object the merge created, now empty again, goes too
    for (let depth = change.path.length - 1; depth > 0; depth--) {
      const where = change.path.slice(0, depth);
      const node = read(next, where);
      if (isPlain(node) && !Object.keys(node).length && read(before, where) === undefined) {
        let holder = next;
        for (const key of where.slice(0, -1)) holder = holder[key];
        delete holder[where.at(-1)];
      } else break;
    }
  }
  return next;
}
