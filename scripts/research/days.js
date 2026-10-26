/** The downtime-day budget. Pure. Stage 6 replaces this with queue reservation. */

/** The days an actor has, from its flag value (anything unusable counts as 0). */
export const daysFrom = value => (Number.isInteger(value) && value >= 0 ? value : 0);

export function requirePositiveDays(n, what = "days") {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`${what} must be a whole number of at least 1 (got ${n})`);
  return n;
}

export function afterGrant(current, n) {
  return daysFrom(current) + requirePositiveDays(n, "grantDays");
}

/** Spend days. Never below 0: asking for more than is available throws and changes nothing. */
export function afterSpend(current, n) {
  requirePositiveDays(n, "spend");
  const have = daysFrom(current);
  if (n > have) throw new RangeError(`cannot spend ${n} day(s): only ${have} available`);
  return have - n;
}

export function validateSetDays(n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`setDays: days must be a whole number of at least 0 (got ${n})`);
  return n;
}
