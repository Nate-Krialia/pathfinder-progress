/**
 * The GM review window's content. Pure; no Foundry globals. Everything that came from data
 * (actor names, labels, messages) is HTML-escaped. Buttons carry data-action attributes that
 * the ApplicationV2 window (review-app.js) routes.
 */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ENTITIES[ch]);

const STATUS_LABEL = { resolved: "Resolved", invalid: "Refused and refunded", skipped: "Skipped", error: "Error (still queued)" };

const button = (action, label, attrs = {}, extra = "") =>
  `<button type="button" data-action="${action}"${Object.entries(attrs).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}${extra}>${esc(label)}</button>`;

/** The last result for a queued action, if there is one still relevant (errors stay until retried). */
const resultFor = (results, row) => results.find(r => r.actorId === row.actorId && r.actionId === row.action.id && r.status === "error");

function renderRow(row, results) {
  const result = resultFor(results, row);
  const ids = { actor: row.actorId, "action-id": row.action.id };
  const problem = row.problem ? `<div class="pfp-problem">${esc(row.problem)}</div>` : "";
  const failure = result
    ? `<div class="pfp-error"><strong>${esc(STATUS_LABEL.error)}:</strong> ${esc(result.message)} ${button("retry", "Retry", ids)}</div>`
    : "";
  return `<li class="pfp-row" data-actor="${esc(row.actorId)}" data-action-id="${esc(row.action.id)}">
  <div class="pfp-row-main">
    <strong>${esc(row.actorName)}</strong>: ${esc(row.label)}
    <div class="pfp-detail">${esc(row.detail)}</div>${problem}${failure}
  </div>
  <div class="pfp-row-days">${row.action.daysReserved === 0
    ? '<span class="pfp-detail">no days</span>'
    : `<input type="number" min="1" step="1" value="${esc(row.action.daysReserved)}" data-days-for="${esc(row.action.id)}" aria-label="Days reserved">
    ${button("edit-days", "Set days", ids)}`}
  </div>
  <div class="pfp-row-buttons">${button("resolve", "Resolve", ids)} ${button("reject", "Reject", ids)}</div>
</li>`;
}

function renderResults(results) {
  if (!results.length) return "";
  const items = results.map(r => `<li class="pfp-result pfp-${esc(r.status)}"><strong>${esc(STATUS_LABEL[r.status] ?? r.status)}</strong>: ${esc(r.actorName ?? r.actorId)} - ${esc(r.label ?? r.actionId)}${r.message ? `. ${esc(r.message)}` : ""}</li>`).join("");
  return `<section><h3>Last results</h3><ul class="pfp-results">${items}</ul></section>`;
}

function renderAudit(audit) {
  if (!audit.length) return `<section><h3>Audit</h3><p class="pfp-ok">Every actor matches the module's log.</p></section>`;
  const items = audit.map(a => `<li class="pfp-audit-row">
  <strong>${esc(a.name)}</strong> ${button("accept", "Accept current state", { actor: a.actorId })}
  <ul>${a.mismatches.map(m => `<li>${esc(m.message)}</li>`).join("")}</ul>
  ${a.history.length ? `<div class="pfp-history">Recent module changes: ${a.history.slice(-3).map(h => esc(h.text)).join("; ")}</div>` : ""}
</li>`).join("");
  return `<section><h3 class="pfp-warn">Audit: ${audit.length} actor(s) do not match</h3>
<p class="pfp-detail">The module's own log says these players hold something the module did not give them. Accepting resets the log to what the actor holds now.</p>
<ul class="pfp-audit">${items}</ul></section>`;
}

/**
 * @param {{ rows: object[], results?: object[], audit?: object[] }} view
 */
export function renderReview({ rows, results = [], audit = [] }) {
  const queue = rows.length
    ? `<ul class="pfp-queue">${rows.map(r => renderRow(r, results)).join("")}</ul>`
    : `<p class="pfp-empty">Nothing is waiting for review.</p>`;
  return `<div class="pfp-review">
<section><h3>Queue (${rows.length})</h3>
<div class="pfp-toolbar">${button("resolve-all", "Resolve all", {}, rows.length ? "" : " disabled")} ${button("refresh", "Refresh")}</div>
${queue}</section>
${renderResults(results)}
${renderAudit(audit)}
</div>`;
}
