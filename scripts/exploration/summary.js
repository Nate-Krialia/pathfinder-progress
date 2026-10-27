/**
 * Chat text for expeditions. Pure. Players get a flavour line (no scene name, no node details,
 * so nothing is spoiled); the GM gets the full picture, whispered.
 */
import { esc } from "../queue/review.js";

const FLAVOUR = {
  criticalSuccess: "The expedition returns with rich pickings and a clear idea of where everything lies.",
  success: "The expedition finds a good number of promising spots.",
  failure: "The expedition turns up only a few scattered finds.",
  criticalFailure: "The expedition struggles badly and finds almost nothing."
};

const DEGREE_TEXT = { criticalSuccess: "Critical success", success: "Success", failure: "Failure", criticalFailure: "Critical failure" };

export function formatPublicSummary({ actorName, regionName, degree, days }) {
  return `<div class="pfp-explore"><h3>${esc(actorName)}: expedition to ${esc(regionName)}</h3>
<p>${esc(FLAVOUR[degree])}</p><p><em>${days} downtime day(s) spent. The GM will prepare the scene when the party is ready.</em></p></div>`;
}

/** @param {{ plan: object, skillName: string, natural: number|null, total: number|null, dc: number, nodes: Array<{ name: string, nodeType: string, tier: number }> }} args */
export function formatGmSummary({ actorName, regionName, plan, skillName, natural, total, dc, nodes }) {
  const check = natural === null ? "forced result" : `${esc(skillName)}: natural ${natural}, total ${total} vs DC ${dc}`;
  const list = nodes.map(n => `<li>${esc(n.name)}: ${esc(n.nodeType)}, tier ${n.tier}</li>`).join("");
  const notes = [];
  if (plan.shortfall) notes.push(`Rolled ${plan.rolled} anchor(s) but the scene only had ${plan.freeBefore}; all were activated.`);
  if (plan.scene.preparedCount) notes.push(`This scene was already prepared ${plan.scene.preparedCount} time(s) before.`);
  notes.push(`${plan.freeAfter} free anchor(s) left on the scene.`);
  return `<div class="pfp-explore"><h3>GM: ${esc(actorName)}'s expedition to ${esc(regionName)}</h3>
<p>${check}. <strong>${esc(DEGREE_TEXT[plan.degree])}</strong>: ${plan.activations.length} node(s) activated on <strong>${esc(plan.scene.name)}</strong>.</p>
<ul>${list}</ul><p>${notes.map(esc).join(" ")}</p>
<p><strong>Scene prepared, not launched.</strong> Activate it when the party is ready.</p></div>`;
}
