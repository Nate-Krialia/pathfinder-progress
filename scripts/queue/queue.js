/**
 * Ordering and batch resolution for the queue. Pure: the resolver is injected.
 */

/** Global submission order: submittedAt, then action id, then actor id. Returns a new array. */
export function orderRows(rows) {
  return [...rows].sort((a, b) =>
    a.action.submittedAt - b.action.submittedAt
    || String(a.action.id).localeCompare(String(b.action.id))
    || String(a.actorId).localeCompare(String(b.actorId)));
}

const STATUSES = ["resolved", "invalid", "skipped"];

/**
 * Resolve rows one by one, in submission order, isolating failures: an action that throws
 * (or returns something unexpected) is reported as an "error" and the rest still run.
 *
 * `resolveOne(row)` returns { status: "resolved" | "invalid" | "skipped", message? }.
 *   resolved: the action ran and was removed
 *   invalid:  it can never succeed; the resolver refunded and removed it
 *   skipped:  it was already handled elsewhere
 * An exception means an unexpected failure: the action is left exactly as it was.
 */
export async function runBatch(rows, resolveOne) {
  const results = [];
  for (const row of orderRows(rows)) {
    const base = { actorId: row.actorId, actionId: row.action.id };
    try {
      const outcome = await resolveOne(row);
      if (!outcome || !STATUSES.includes(outcome.status)) {
        results.push({ ...base, status: "error", message: `the resolver returned an unexpected result: ${JSON.stringify(outcome)}` });
      } else {
        results.push({ ...base, ...outcome });
      }
    } catch (error) {
      results.push({ ...base, status: "error", message: error?.message ?? String(error) });
    }
  }
  const count = status => results.filter(r => r.status === status).length;
  return { results, summary: { resolved: count("resolved"), invalid: count("invalid"), skipped: count("skipped"), errors: count("error") } };
}
