/** Player-facing research text. Names the goal and the numbers a researcher sees; nothing about the recipe itself. */
const DEGREE_LABEL = { criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" };
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "+0");

/**
 * The text the PLAYERS see: degree words and progress, never a total or a DC (docs/11b). `forGM` adds the total and the DC; it is
 * only ever sent to the GM(s).
 */
export function formatResearchSummary({ actorName, project, skillName, results, completed, forGM = false }) {
  const lines = [`<strong>${actorName}</strong> researches <em>${project.goalName}</em> (${skillName}, ${results.length} day${results.length === 1 ? "" : "s"})`];
  for (const r of results) {
    const roll = forGM && r.total !== null ? `${r.total} vs DC ${project.dc}: ` : "";
    lines.push(`Day ${r.day}: ${roll}${DEGREE_LABEL[r.degree]} (${signed(r.delta)})`);
  }
  lines.push(completed ? `<strong>${actorName}</strong> has learned <em>${project.goalName}</em>!` : `Progress: ${project.progress}/${project.threshold}.`);
  return lines.join("<br>");
}

export function formatProgressSummary({ actorName, project, applied, reason, completed }) {
  const lines = [`<strong>${actorName}</strong>'s research on <em>${project.goalName}</em> ${applied < 0 ? "loses" : "advances by"} ${Math.abs(applied)} (${reason}).`];
  lines.push(completed ? `<strong>${actorName}</strong> has learned <em>${project.goalName}</em>!` : `Progress: ${project.progress}/${project.threshold}.`);
  return lines.join("<br>");
}
