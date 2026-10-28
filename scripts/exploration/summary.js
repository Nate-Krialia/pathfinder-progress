/**
 * Chat text for expeditions. Pure. An expedition's result is for the GM ONLY: players are not shown odds,
 * degrees, encounters or node counts (docs/11-hub-design.md), so there is no public summary at all.
 */
import { esc } from "../queue/review.js";

const DEGREE_TEXT = { criticalSuccess: "critical success", success: "success", failure: "failure", criticalFailure: "critical failure" };

/**
 * @param {object} args
 * @param {object} args.plan        from planExpedition
 * @param {Array<{ degree: string, natural: number|null, total: number|null }>} args.rolls  one per day
 * @param {{ encounter: boolean, forced: boolean, chance: number }} args.encounter
 * @param {Array<{ name: string, nodeType: string, tier: number, perceptionDC: number }>} args.nodes
 * @param {string[]} args.searchedBy  characters who already searched this scene
 */
export function formatGmSummary({ actorName, regionName, plan, skillName, dc, rolls, encounter, nodes, searchedBy = [] }) {
  const days = rolls.map((r, i) => `day ${i + 1}: ${r.natural === null ? "forced" : `natural ${r.natural}, total ${r.total} vs DC ${dc}`} = ${DEGREE_TEXT[r.degree]}`).join("; ");
  const enc = encounter.forced ? "ENCOUNTER (the party forced combat)" : encounter.encounter ? `ENCOUNTER (rolled under ${Math.round(encounter.chance * 100)}%)` : `no encounter (${Math.round(encounter.chance * 100)}% chance)`;
  const list = nodes.map(n => `<li>${esc(n.name)}: ${esc(n.nodeType)}, tier ${n.tier}, hidden, Perception DC ${n.perceptionDC}</li>`).join("");
  const notes = [];
  if (plan.notPlaced) notes.push(`${plan.rolled} node(s) were found but only ${plan.freeBefore} free anchor(s) were left, so ${plan.notPlaced} were not placed.`);
  if (plan.scene.preparedCount) notes.push(`This scene was prepared ${plan.scene.preparedCount} time(s) before.`);
  notes.push(`${plan.freeAfter} free anchor(s) left on the scene.`);
  if (searchedBy.length) notes.push(`Already searched here: ${searchedBy.join(", ")}. Reset with api.resetSearches(scene) so they can search the new nodes.`);
  return `<div class="pfp-explore"><h3>GM only: ${esc(actorName)}'s expedition to ${esc(regionName)}</h3>
<p>${esc(skillName)}, ${rolls.length} day(s) - ${esc(days)}.</p>
<p><strong>${esc(enc)}</strong> on <strong>${esc(plan.scene.name)}</strong>.</p>
<p>${nodes.length} hidden node(s) placed:</p><ul>${list}</ul><p>${notes.map(esc).join(" ")}</p>
<p><strong>Scene prepared, not launched.</strong> Activate it when the party is ready; players find the nodes with api.searchArea.</p></div>`;
}
