/** Player-facing text for a gather. Never mentions hidden rolls or rungs that were tried. */
export function formatGatherSummary({ gathererName, node, skillName, result, materialNames }) {
  const lines = [`<strong>${gathererName}</strong> gathers from <em>${node.name}</em> (${skillName}): <strong>${result.passed ? "Success" : "Failure"}</strong>`];
  if (result.gains.length) {
    lines.push(`Gathered: ${result.gains.map(g => `${g.quantity} ${materialNames[g.materialId] ?? g.materialId}`).join(", ")}.`);
  } else {
    lines.push("Nothing was gathered.");
  }
  lines.push(result.stateAfter === "depleted" ? "The node is now depleted." : `Charges left: ${result.chargesAfter}.`);
  return lines.join("<br>");
}
