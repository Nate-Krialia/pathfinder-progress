/**
 * Charge reservations on a node record. Pure; no Foundry globals.
 *
 * Queueing a gather claims ONE charge on the node (`reservedCharges`), so two players cannot queue the same last
 * charge. Cancelling or an invalid gather releases it; resolving turns it into a spent charge. Free charges are
 * `charges - reservedCharges`. A node that runs out is depleted; nothing ever refills it.
 */

export const reservedOf = record => record?.reservedCharges ?? 0;
export const availableCharges = record => (record?.charges ?? 0) - reservedOf(record);

/** Why a gather cannot be queued on this node record right now, or null. `name` is the node's name for the message. */
export function reserveProblem(record, name = "That node") {
  if (!record || record.state === "anchor") return `${name} is not a node you can gather from`;
  if (record.revealed === false) return `${name} has not been found yet`;
  if (record.state === "depleted" || (record.charges ?? 0) < 1) return `${name} is depleted`;
  if (availableCharges(record) < 1) return `${name} has no free charge left: every charge it has is already claimed by a queued gather`;
  return null;
}

/** Claim one charge. */
export function reserve(record) {
  const problem = reserveProblem(record);
  if (problem) throw new RangeError(`reserve: ${problem}`);
  return { ...record, reservedCharges: reservedOf(record) + 1 };
}

/** Give one claimed charge back. Releasing a node with none claimed is a mistake, not a no-op. */
export function release(record) {
  const held = reservedOf(record);
  if (held < 1) throw new RangeError("release: this node has no reserved charge to give back");
  const next = { ...record };
  if (held > 1) next.reservedCharges = held - 1;
  else delete next.reservedCharges;
  return next;
}

/**
 * Turn the claimed charge into a spent one: the node ends with `chargesAfter` charges and one fewer claim.
 * At 0 charges it is depleted.
 */
export function spendReserved(record, chargesAfter) {
  const held = reservedOf(record);
  if (held < 1) throw new RangeError("spendReserved: this node has no reserved charge to spend");
  if (chargesAfter !== record.charges - 1) {
    throw new RangeError(`spendReserved: a gather spends one charge (${record.charges} before, got ${chargesAfter} after)`);
  }
  const next = { ...record, charges: chargesAfter, state: chargesAfter === 0 ? "depleted" : "active" };
  if (held > 1) next.reservedCharges = held - 1;
  else delete next.reservedCharges;
  return next;
}
