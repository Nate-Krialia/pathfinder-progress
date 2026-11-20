import { esc } from "../queue/review.js";

/** Player-facing research text. Names the goal and the numbers a researcher sees; nothing about the recipe itself. */
const DEGREE_LABEL = { criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" };
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "+0");

/**
 * The text the PLAYERS see: degree words and progress ("Progress n/m" is shown on purpose for a formula project), never a total or a DC (docs/11b). `forGM` adds the total and the DC; it is
 * only ever sent to the GM(s).
 */
export function formatResearchSummary({ actorName, project, skillName, results, completed, forGM = false }) {
  const lines = [`<strong>${esc(actorName)}</strong> researches <em>${esc(project.goalName)}</em> (${esc(skillName)}, ${results.length} day${results.length === 1 ? "" : "s"})`];
  for (const r of results) {
    const roll = forGM && r.total !== null ? `${r.total} vs DC ${project.dc}: ` : "";
    lines.push(`Day ${r.day}: ${roll}${DEGREE_LABEL[r.degree]} (${signed(r.delta)})`);
  }
  lines.push(completed ? `<strong>${esc(actorName)}</strong> has learned <em>${esc(project.goalName)}</em>!` : `Progress: ${project.progress}/${project.threshold}.`);
  return lines.join("<br>");
}

export function formatProgressSummary({ actorName, project, applied, reason, completed }) {
  const lines = [`<strong>${esc(actorName)}</strong>'s research on <em>${esc(project.goalName)}</em> ${applied < 0 ? "loses" : "advances by"} ${Math.abs(applied)} (${esc(reason)}).`];
  lines.push(completed ? `<strong>${esc(actorName)}</strong> has learned <em>${esc(project.goalName)}</em>!` : `Progress: ${project.progress}/${project.threshold}.`);
  return lines.join("<br>");
}
