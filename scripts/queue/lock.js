/**
 * A tiny keyed lock for the GM client: calls with the same key run one after another, in the order they arrived.
 * This is what stops two players' gathers taking the same last charge, and a craft being cancelled while it resolves.
 * The GM client is the only place these writes happen, so an in-memory lock is enough.
 *
 * Not re-entrant: never take a key you already hold. Lock order is always node first, then actor.
 */
const tails = new Map();

export function withLock(key, fn) {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

/** Take several keys, in the order given (outermost first), then run fn. */
export function withLocks(keys, fn) {
  return keys.reduceRight((inner, key) => () => withLock(key, inner), fn)();
}

export const actorKey = actor => `actor:${actor.id}`;
export const nodeKey = params => `node:${params.sceneId}/${params.tokenId}`;
