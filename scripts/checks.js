/**
 * PF2e check arithmetic shared by gathering and research. Pure; no Foundry globals.
 *
 * Degree of success: total >= DC + 10 is a critical success, total >= DC a success,
 * total <= DC - 10 a critical failure, otherwise a failure. A natural 20 moves the
 * degree up one step and a natural 1 moves it down one step.
 */
export const DEGREE_NAMES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** The degree (0..3) for a natural d20 roll, a modifier and a DC. */
export function degreeIndex(natural, modifier, dc) {
  const total = natural + modifier;
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) degree = Math.min(3, degree + 1);
  if (natural === 1) degree = Math.max(0, degree - 1);
  return degree;
}

/** How many of the 20 natural results give each degree: { criticalFailure, failure, success, criticalSuccess }. */
export function degreeCounts(modifier, dc) {
  const counts = { criticalFailure: 0, failure: 0, success: 0, criticalSuccess: 0 };
  for (let natural = 1; natural <= 20; natural++) counts[DEGREE_NAMES[degreeIndex(natural, modifier, dc)]]++;
  return counts;
}

/** The chance of each degree, as fractions (counts / 20). */
export function degreeChances(modifier, dc) {
  const counts = degreeCounts(modifier, dc);
  return Object.fromEntries(Object.entries(counts).map(([degree, count]) => [degree, count / 20]));
}
