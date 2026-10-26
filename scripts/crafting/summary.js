/** Human-readable result text for the players. Never includes individual loss rolls. */
const DEGREE_LABEL = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure"
};

export function formatSummary({ crafterName, plan, outcome, itemName = null }) {
  const lines = [`<strong>${crafterName}</strong> crafts <em>${plan.recipeName}</em>: <strong>${DEGREE_LABEL[outcome.degree]}</strong>`];
  if (outcome.made) {
    lines.push(`Created: ${itemName ?? plan.resultName ?? "the item"}.`);
  } else {
    lines.push("No item was made.");
  }
  const { unitsUsed, unitsKept } = outcome.summary;
  lines.push(`Materials used: ${unitsUsed}${unitsKept ? `, kept: ${unitsKept}` : ""}.`);
  lines.push(`Fee paid: ${outcome.feeConsumed} gp.`);
  return lines.join("<br>");
}
