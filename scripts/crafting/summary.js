/** Human-readable result text for the players. Never includes individual loss rolls. */
const DEGREE_LABEL = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure"
};

/** feeText overrides the fee line (a commission says who paid it, or that an NPC patron waived it). */
export function formatSummary({ crafterName, plan, outcome, itemName = null, feeText = null }) {
  const lines = [`<strong>${crafterName}</strong> crafts <em>${plan.recipeName}</em>: <strong>${DEGREE_LABEL[outcome.degree]}</strong>`];
  if (outcome.made) {
    lines.push(`Created: ${itemName ?? plan.resultName ?? "the item"}.`);
  } else {
    lines.push("No item was made.");
  }
  if (plan.station) lines.push(`Station: ${plan.station.name} (tier ${plan.station.tier}).`);
  const { unitsUsed, unitsKept } = outcome.summary;
  lines.push(`Materials used: ${unitsUsed}${unitsKept ? `, kept: ${unitsKept}` : ""}.`);
  lines.push(feeText ?? `Fee paid: ${outcome.feeConsumed} gp.`);
  return lines.join("<br>");
}
