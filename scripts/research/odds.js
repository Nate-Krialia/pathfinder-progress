/** The odds of a research project, exactly. Pure. */
import { RESEARCH } from "../config.js";
import { degreeChances } from "../checks.js";
import { deltaFor } from "./project.js";

/** Average progress per day. */
export function expectedProgressPerDay(modifier, dc, config = RESEARCH) {
  const chances = degreeChances(modifier, dc);
  return Object.entries(chances).reduce((sum, [degree, chance]) => sum + chance * deltaFor(degree, config), 0);
}

/**
 * Expected number of days to finish from `progress`, solved exactly as a Markov chain
 * (so setbacks and 2-point criticals are handled). Infinity if progress can never be made.
 * Above 200 points of threshold it falls back to threshold/average and says so.
 * @returns {{ days: number, approximate: boolean }}
 */
export function expectedDaysToFinish({ modifier, dc, threshold, progress = 0, config = RESEARCH }) {
  const perDay = expectedProgressPerDay(modifier, dc, config);
  const chances = degreeChances(modifier, dc);
  const canAdvance = Object.entries(chances).some(([degree, chance]) => chance > 0 && deltaFor(degree, config) > 0);
  if (!canAdvance || perDay <= 0) return { days: Infinity, approximate: false };
  if (progress >= threshold) return { days: 0, approximate: false };
  if (threshold > 200) return { days: (threshold - progress) / perDay, approximate: true };

  // E[s] = 1 + sum_d p_d * E[next(s, d)], with E = 0 once the threshold is reached.
  const n = threshold;
  const matrix = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let s = 0; s < n; s++) {
    matrix[s][s] += 1;
    matrix[s][n] = 1;
    for (const [degree, chance] of Object.entries(chances)) {
      const next = Math.max(0, s + deltaFor(degree, config));
      if (next < n) matrix[s][next] -= chance;
    }
  }
  for (let col = 0; col < n; col++) { // Gaussian elimination with partial pivoting
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col] / matrix[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  return { days: matrix[progress][n] / matrix[progress][progress], approximate: false };
}
