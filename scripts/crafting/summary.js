import { esc } from "../queue/review.js";

/** Human-readable result text for the players. Never includes individual loss rolls. Every name that came from data (a character, a recipe, an item, a station) is HTML-escaped HERE: callers pass raw names. */
const DEGREE_LABEL = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure"
};

/** feeText overrides the fee line (a commission says who paid it, or that an NPC patron waived it). */
export function formatSummary({ crafterName, plan, outcome, itemName = null, feeText = null }) {
  const lines = [`<strong>${esc(crafterName)}</strong> crafts <em>${esc(plan.recipeName)}</em>: <strong>${DEGREE_LABEL[outcome.degree]}</strong>`];
  if (outcome.made) {
    lines.push(`Created: ${esc(itemName ?? plan.resultName ?? "the item")}.`);
  } else {
    lines.push("No item was made.");
  }
  if (plan.station) lines.push(`Station: ${esc(plan.station.name)} (tier ${plan.station.tier}).`);
  const { unitsUsed, unitsKept } = outcome.summary;
  lines.push(`Materials used: ${unitsUsed}${unitsKept ? `, kept: ${unitsKept}` : ""}.`);
  lines.push(feeText ?? `Fee paid: ${outcome.feeConsumed} gp.`);
  return lines.join("<br>");
}
