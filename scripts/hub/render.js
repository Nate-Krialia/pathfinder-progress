/**
 * The Downtime Hub as HTML (Stage 11a). Pure: a view-model in, a string out, so the same function draws the window in Foundry and the
 * screenshots in docs/screens. Every control is a real <button>. A control that is off keeps aria-disabled (still focusable, its reason
 * is on screen and read out) rather than `disabled`. State is never shown by colour alone: there is always a word.
 */
import { S } from "./strings.js";
import { rootStyle } from "./display.js";
import { esc } from "../queue/review.js";
export { esc };

const button = ({ action, label, focus, pressed, disabled, why, whyId, cls = "", data = {} }) => {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
  return `<button type="button" class="pfp-btn ${cls}${disabled ? " is-disabled" : ""}" data-action="${action}" data-focus-key="${esc(focus)}"${attrs}`
    + `${pressed === undefined ? "" : ` aria-pressed="${pressed ? "true" : "false"}"`}${disabled ? ` aria-disabled="true"` : ""}${whyId && disabled ? ` aria-describedby="${esc(whyId)}"` : ""}>${label}</button>`;
};

function statusStrip(m) {
  const s = m.status;
  return `<section class="pfp-status" aria-label="Status">
  <div class="pfp-stat"><span class="pfp-stat-label">${esc(s.days.label)}</span><span class="pfp-stat-value">${esc(s.days.value)}</span></div>
  <div class="pfp-stat"><span class="pfp-stat-label">${esc(s.location.label)}</span><span class="pfp-stat-value">${esc(s.location.value)}</span><span class="pfp-stat-note">${esc(s.location.stations)}</span></div>
  <div class="pfp-stat"><span class="pfp-stat-label">${esc(s.waiting.label)}</span><span class="pfp-stat-value">${esc(s.waiting.value)}</span>
    ${button({ action: "toggle-queue", label: esc(m.queue.open ? S.hideQueue : s.waiting.button), focus: "toggle-queue", pressed: m.queue.open })}</div>
  ${s.gate.open ? "" : `<p class="pfp-gate" role="note"><strong>${esc(s.gate.reason)}.</strong> ${esc(s.gate.note)}</p>`}
</section>`;
}

function queuePanel(q) {
  if (!q.open) return "";
  const rows = q.rows.map(r => `<li class="pfp-queue-row"><span class="pfp-queue-label">${esc(r.label)}</span><span class="pfp-queue-days">${esc(r.daysText)}</span>`
    + `${button({ action: "cancel-queued", label: esc(r.cancel), focus: `cancel:${r.id}`, data: { "action-id": r.id } })}</li>`).join("");
  return `<section class="pfp-panel" aria-label="${esc(q.heading)}"><h3>${esc(q.heading)}</h3>${q.empty ? `<p>${esc(q.emptyText)}</p>` : `<ul class="pfp-queue">${rows}</ul>`}</section>`;
}

function displayPanel(d) {
  if (!d.open) return "";
  const group = (label, action, options) => `<fieldset class="pfp-fieldset"><legend>${esc(label)}</legend><div class="pfp-row">${options.map(o => button({
    action, label: `${esc(o.text)}${o.selected ? ` <span class="pfp-badge">${esc(S.selectedWord)}</span>` : ""}`, focus: `${action}:${o.value}`, pressed: o.selected, data: { value: o.value }
  })).join("")}</div></fieldset>`;
  return `<section class="pfp-panel" aria-label="${esc(d.heading)}"><h3>${esc(d.heading)}</h3>
  ${group(d.textSize.label, "set-text-size", d.textSize.options)}${group(d.theme.label, "set-theme", d.theme.options)}${group(d.font.label, "set-font", d.font.options)}
  <div class="pfp-row">${button({ action: "reset-display", label: esc(d.reset), focus: "reset-display" })}${button({ action: "toggle-display", label: esc(d.done), focus: "display-done" })}</div></section>`;
}

function switchPanel(m) {
  if (!m.showSwitch) return "";
  return `<section class="pfp-panel" aria-label="${esc(m.switcher.heading)}"><h3>${esc(m.switcher.heading)}</h3><div class="pfp-row">${m.switcher.options.map(o => button({
    action: "switch-character", label: `${esc(o.name)}${o.current ? ` <span class="pfp-badge">${esc(S.selectedWord)}</span>` : ""}`, focus: `char:${o.id}`, pressed: o.current, data: { actor: o.id }
  })).join("")}</div></section>`;
}

function listPane(list) {
  const chips = list.chips.map(c => button({ action: "set-filter", label: `${esc(c.label)} <span class="pfp-count">${c.count}</span>`, focus: `chip:${c.id}`, pressed: c.selected, cls: "pfp-chip", data: { filter: c.id } })).join("");
  const cards = list.cards.map(c => `<li>${button({
    action: "select-recipe", cls: `pfp-card is-${c.status}`, focus: `card:${c.key}`, pressed: c.selected, data: c.recipeId ? { recipe: c.recipeId } : { recipe: "" },
    label: `<span class="pfp-card-name">${esc(c.name)}</span><span class="pfp-pill pfp-pill-${c.status}">${esc(c.pill)}</span>${c.note ? `<span class="pfp-card-note">${esc(c.note)}</span>` : ""}`
      + `${c.progress ? `<span class="pfp-card-progress"><progress value="${c.progress.value}" max="${c.progress.max}" aria-label="${esc(c.progress.text)}"></progress><span>${esc(c.progress.text)}</span></span>` : ""}`
  })}${c.openInResearch ? `<div class="pfp-card-extra">${button({ action: "open-in-research", label: esc(c.openInResearch.text), focus: `research:${c.key}`, disabled: c.openInResearch.disabled, whyId: `why-${c.key}`, data: { project: c.openInResearch.projectId } })}${c.openInResearch.why ? `<span id="why-${esc(c.key)}" class="pfp-why">${esc(c.openInResearch.why)}</span>` : ""}</div>` : ""}</li>`).join("");
  return `<div class="pfp-pane pfp-list" data-scroll-key="list"><h2>${esc(list.heading)}</h2><div class="pfp-row" role="group" aria-label="${esc(list.filterLabel)}">${chips}</div>
  ${list.empty ? `<p class="pfp-empty">${esc(list.empty)}</p>` : ""}<ul class="pfp-cards">${cards}</ul></div>`;
}

function optionCard(slot, o) {
  const effect = o.effect.known ? `<span class="pfp-effects">${o.effect.effects.map(e => `<span class="pfp-effect">${esc(e)}</span>`).join("")}</span>` : `<span class="pfp-unknown">${esc(o.effect.text)}</span>`;
  return `<li>${button({
    action: "pick-material", cls: "pfp-option", focus: `pick:${slot.name}:${o.id}`, pressed: o.selected, data: { slot: slot.name, material: o.id },
    label: `<span class="pfp-option-name">${esc(o.name)}</span><span class="pfp-option-tier">${esc(o.tierText)}</span>${o.worth ? `<span class="pfp-option-tier">${esc(o.worth)}</span>` : ""}`
      + `<span class="pfp-stock${o.stock.short ? " is-short" : ""}">${o.stock.short ? `<strong>${esc(o.stock.word)}.</strong> ` : ""}${esc(o.stock.text)}</span>${effect}`
      + `${o.selected ? `<span class="pfp-badges"><span class="pfp-badge">${esc(S.selectedWord)}</span></span>` : ""}`
  })}</li>`;
}

function slotBlock(slot) {
  return `<fieldset class="pfp-slot"><legend>${esc(slot.label)}</legend><p class="pfp-role">${esc(slot.roleLine)}</p>
  <p class="pfp-slot-status${slot.chosen ? "" : " is-empty"}">${esc(slot.statusText)}${slot.chosen ? "" : ""}</p>
  ${slot.noOptions ? `<p class="pfp-empty">${esc(slot.noOptions)}</p>` : `<ul class="pfp-options">${slot.options.map(o => optionCard(slot, o)).join("")}</ul>`}${slot.locked ? `<p class="pfp-why">${esc(slot.locked)}</p>` : ""}
  ${slot.chosen ? button({ action: "clear-slot", label: esc(slot.clear), focus: `clear:${slot.name}`, data: { slot: slot.name } }) : ""}</fieldset>`;
}

function outcome(o) {
  const effects = o.effects.map(e => (e.known ? e.effects.map(line => `<li>${esc(line)}</li>`).join("") : `<li class="pfp-unknown">${esc(e.text)}</li>`)).join("");
  return `<section class="pfp-outcome" aria-label="${esc(o.heading)}"><h3>${esc(o.heading)}</h3>
  <p class="pfp-result is-${o.result.state}">${esc(o.result.text)}</p>${effects ? `<ul class="pfp-effects">${effects}</ul>` : ""}
  <ul class="pfp-facts">${o.fee ? `<li>${esc(o.fee)}</li>` : ""}<li>${esc(o.days)}</li>${o.gold ? `<li>${esc(o.gold.worth)}</li><li>${esc(o.gold.shop)}</li>${o.gold.save ? `<li>${esc(o.gold.save)}</li>` : ""}` : ""}</ul>
  ${o.materials.length ? `<p class="pfp-subhead">${esc(o.materialsHeading)}</p><ul class="pfp-facts">${o.materials.map(m => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
  <p class="pfp-note">${esc(o.costNote)}</p><p class="pfp-note">${esc(o.failureNote)}</p></section>`;
}

function stations(st) {
  if (st.none) return `<section class="pfp-stations" aria-label="${esc(st.heading)}"><h3>${esc(st.heading)}</h3><p class="pfp-empty">${esc(st.none)}</p></section>`;
  return `<section class="pfp-stations" aria-label="${esc(st.heading)}"><h3>${esc(st.heading)}</h3><ul class="pfp-options">${st.options.map(o => `<li>${button({
    action: "pick-station", cls: "pfp-option", focus: `station:${o.id}`, pressed: o.selected, data: { station: o.id },
    label: `<span class="pfp-option-name">${esc(o.name)}</span><span class="pfp-option-tier">${esc(o.tierText)}</span><span class="pfp-stock">${esc(o.where)} · ${esc(o.feeText)}</span>`
      + `${o.cheapest || o.selected ? `<span class="pfp-badges">${o.cheapest ? `<span class="pfp-badge">${esc(o.cheapest)}</span>` : ""}${o.selected ? `<span class="pfp-badge">${esc(S.selectedWord)}</span>` : ""}</span>` : ""}`
  })}</li>`).join("")}</ul></section>`;
}

function detailPane(body) {
  const d = body.detail;
  let inner;
  if (d.kind === "recipe") {
    inner = `<h2>${esc(d.name)}</h2><h3>${esc(d.slotsHeading)}</h3>${d.slots.map(slotBlock).join("")}${stations(d.stations)}${outcome(d.outcome)}
    <div class="pfp-footer"><div class="pfp-actions">${button({ action: "queue-craft", label: esc(d.buttons.queue.text), focus: "queue-craft", cls: "pfp-primary", disabled: d.buttons.queue.disabled, whyId: "why-queue" })}
    ${button({ action: "ask-crafter", label: esc(d.buttons.ask.text), focus: "ask-crafter", disabled: true, whyId: "why-ask" })}</div>
    ${d.buttons.queue.reason ? `<p id="why-queue" class="pfp-why">${esc(d.buttons.queue.reason)}</p>` : ""}<p id="why-ask" class="pfp-why">${esc(d.buttons.ask.why)}</p></div>`;
  } else if (d.kind === "researching") {
    inner = `<h2>${esc(d.name)}</h2><p>${esc(d.text)}</p>${d.progress ? `<p><progress value="${d.progress.value}" max="${d.progress.max}" aria-label="${esc(d.progress.text)}"></progress> ${esc(d.progress.text)}</p>` : ""}`;
  } else {
    inner = `<p class="pfp-empty">${esc(d.text)}</p>`;
  }
  return `<div class="pfp-pane pfp-detail" data-scroll-key="detail">${inner}</div>`;
}

// Research tab -------------------------------------------------------------------------------------------------------------------------------
function stepsHtml(progress) {
  if (progress.study) return `<span class="pfp-steps-row"><span class="pfp-steps-text">${esc(progress.text)}</span></span>`;
  const steps = progress.boxes
    ? `<span class="pfp-steps" aria-hidden="true">${progress.boxes.map(b => `<span class="pfp-step${b.done ? " is-done" : ""}"></span>`).join("")}</span>`
    : `<progress value="${progress.value}" max="${progress.max}" aria-label="${esc(progress.text)}"></progress>`;
  return `<span class="pfp-steps-row">${steps}<span class="pfp-steps-text">${esc(progress.text)}</span></span>`;
}

function researchList(list) {
  const cards = list.cards.map(c => `<li>${button({
    action: "select-project", cls: "pfp-card", focus: c.key, pressed: c.selected, data: { project: c.id },
    label: `<span class="pfp-card-name">${esc(c.name)}</span><span class="pfp-badges"><span class="pfp-pill">${esc(c.pill)}</span>${c.queued ? `<span class="pfp-badge">${esc(c.queued)}</span>` : ""}</span>${stepsHtml(c.progress)}`
  })}</li>`).join("");
  const leads = list.leads.items.map(l => `<li class="pfp-lead"><span class="pfp-card-name">${esc(l.name)}</span>${l.note ? `<span class="pfp-lead-note">${esc(l.note)}</span>` : ""}`
    + `${button({ action: "follow-lead", label: esc(l.button.text), focus: l.key, disabled: l.button.disabled, whyId: `why-${l.key}`, data: { lead: l.id } })}${l.button.why ? `<span id="why-${esc(l.key)}" class="pfp-why">${esc(l.button.why)}</span>` : ""}</li>`).join("");
  return `<div class="pfp-pane pfp-list" data-scroll-key="list"><h2>${esc(list.heading)}</h2>${list.empty ? `<p class="pfp-empty">${esc(list.empty)}</p>` : `<ul class="pfp-cards">${cards}</ul>`}
  <h3>${esc(list.leads.heading)}</h3>${list.leads.empty ? `<p class="pfp-empty">${esc(list.leads.empty)}</p><p class="pfp-note">${esc(list.leads.emptyLine)}</p>` : `<ul class="pfp-cards">${leads}</ul>`}</div>`;
}

function researchDetail(d) {
  if (d.kind !== "project") return `<div class="pfp-pane pfp-detail" data-scroll-key="detail"><p class="pfp-empty">${esc(d.text)}</p></div>`;
  const skills = d.skills.options.map(o => `<li>${button({
    action: "set-skill", cls: "pfp-option", focus: `skill:${o.skill}`, pressed: o.selected, data: { skill: o.skill },
    label: `<span class="pfp-option-name">${esc(o.label)}</span>${o.modifierText ? `<span class="pfp-option-tier">${esc(o.modifierText)}</span>` : ""}${o.selected ? `<span class="pfp-badges"><span class="pfp-badge">${esc(S.selectedWord)}</span></span>` : ""}`
  })}</li>`).join("");
  const aside = d.aside.kind === "workshop" ? `<p class="pfp-note">${esc(d.aside.note)}</p>`
    : d.aside.confirm
      ? `<div class="pfp-confirm" role="group" aria-label="${esc(d.aside.confirm.text)}"><p class="pfp-result">${esc(d.aside.confirm.text)}</p><div class="pfp-row">${button({ action: "keep-aside", label: esc(d.aside.confirm.keep), focus: "keep-aside" })}${button({ action: "confirm-aside", label: esc(d.aside.confirm.confirm), focus: "confirm-aside" })}</div></div>`
      : `<div class="pfp-row">${button({ action: "put-aside", label: esc(d.aside.button.text), focus: "put-aside", disabled: d.aside.button.disabled, whyId: "why-aside" })}</div>${d.aside.button.why ? `<p id="why-aside" class="pfp-why">${esc(d.aside.button.why)}</p>` : ""}`;
  return `<div class="pfp-pane pfp-detail" data-scroll-key="detail"><h2>${esc(d.name)}</h2><div class="pfp-badges"><span class="pfp-pill">${esc(d.pill)}</span></div>
  <p>${esc(d.goalLine)}</p>${stepsHtml(d.progress)}${d.hint ? `<p class="pfp-why">${esc(d.hint)}</p>` : ""}
  <fieldset class="pfp-fieldset"><legend>${esc(d.skills.label)}</legend><ul class="pfp-options">${skills}</ul></fieldset>
  <fieldset class="pfp-fieldset"><legend>${esc(d.days.label)}</legend><div class="pfp-row">${button({ action: "days-down", label: esc(d.days.down.text), focus: "days-down", disabled: d.days.down.disabled })}<span class="pfp-result">${esc(d.days.text)}</span>${button({ action: "days-up", label: esc(d.days.up.text), focus: "days-up", disabled: d.days.up.disabled })}</div><p class="pfp-note">${esc(d.days.note)}</p></fieldset>
  ${d.queuedNote ? `<div class="pfp-outcome"><p class="pfp-result">${esc(d.queuedNote.text)}</p><div class="pfp-row">${button({ action: "cancel-queued", label: esc(d.queuedNote.cancel), focus: `cancel:${d.queuedNote.actionId}`, data: { "action-id": d.queuedNote.actionId } })}</div></div>` : ""}
  <div class="pfp-actions">${button({ action: "queue-research", label: esc(d.queue.text), focus: "queue-research", cls: "pfp-primary", disabled: d.queue.disabled, whyId: "why-research" })}</div>${d.queue.reason ? `<p id="why-research" class="pfp-why">${esc(d.queue.reason)}</p>` : ""}
  ${aside}
  <section class="pfp-outcome" aria-label="${esc(d.checks.heading)}"><h3>${esc(d.checks.heading)}</h3>${d.checks.empty ? `<p class="pfp-empty">${esc(d.checks.empty)}</p>` : `<ul class="pfp-facts">${d.checks.rows.map(r => `<li>${esc(r.text)}</li>`).join("")}</ul>`}</section></div>`;
}

// Compendium tab -----------------------------------------------------------------------------------------------------------------------------
function compendiumList(tab) {
  const chips = tab.chips.map(c => button({ action: "set-category", label: `${esc(c.label)} <span class="pfp-count">${c.count}</span>`, focus: `category:${c.id}`, pressed: c.selected, cls: "pfp-chip", data: { category: c.id } })).join("");
  const cards = tab.list.cards.map(c => `<li>${button({
    action: "select-entry", cls: "pfp-card", focus: c.key, pressed: c.selected, data: { entry: c.entryKey },
    label: `<span class="pfp-card-name">${esc(c.name)}</span>${c.sub ? `<span class="pfp-card-note">${esc(c.sub)}</span>` : ""}<span class="pfp-badges"><span class="pfp-pill pfp-pill-${c.share}">${esc(c.pill)}</span></span>`
  })}</li>`).join("");
  return `<div class="pfp-pane pfp-list" data-scroll-key="list"><h2>${esc(tab.heading)}</h2><p class="pfp-note">${esc(tab.countLine)}</p><div class="pfp-row" role="group" aria-label="${esc(tab.categoryLabel)}">${chips}</div>
  ${tab.list.empty ? `<p class="pfp-empty">${esc(tab.list.empty)}</p>` : `<ul class="pfp-cards">${cards}</ul>`}</div>`;
}

function compendiumDetail(d) {
  if (d.kind === "empty") return `<div class="pfp-pane pfp-detail" data-scroll-key="detail"><p class="pfp-empty">${esc(d.text)}</p></div>`;
  const section = s => `<section class="pfp-outcome" aria-label="${esc(s.heading)}"><h3>${esc(s.heading)}</h3>${s.empty ? `<p class="pfp-empty">${esc(s.empty)}</p>` : `<ul class="pfp-facts">${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`}</section>`;
  const known = d.known ? `<section class="pfp-outcome" aria-label="${esc(d.known.heading)}"><h3>${esc(d.known.heading)}</h3>${d.known.empty ? `<p class="pfp-empty">${esc(d.known.empty)}</p>` : `<ul class="pfp-facts">${d.known.items.map(k => `<li><span class="pfp-card-name">${esc(k.head)}</span>${k.via ? ` <span class="pfp-card-note">(${esc(k.via)})</span>` : ""}<ul class="pfp-effects">${k.effects.map(e => `<li>${esc(e)}</li>`).join("")}</ul></li>`).join("")}</ul>`}</section>` : "";
  const share = d.sharing;
  return `<div class="pfp-pane pfp-detail" data-scroll-key="detail"><h2>${esc(d.title)}</h2>${d.meta ? `<p class="pfp-note">${esc(d.meta)}</p>` : ""}${d.sections.map(section).join("")}${known}
  <section class="pfp-outcome" aria-label="${esc(S.sharePill.shared)}"><div class="pfp-badges"><span class="pfp-pill pfp-pill-${d.share}">${esc(share.pill)}</span></div><p>${esc(share.text)}</p>
  <div class="pfp-row">${share.button ? button({ action: "share-entry", label: esc(share.button.text), focus: "share-entry", cls: "pfp-primary" }) : ""}${share.cancel ? button({ action: "cancel-queued", label: esc(share.cancel.text), focus: "cancel-share", data: { "action-id": share.cancel.actionId ?? "" } }) : ""}</div></section></div>`;
}

/** The part of the window that is replaced on every update (the live region is NOT in it, so announcements are never lost). */
export function renderHubMain(model) {
  if (!model.character) return `<p class="pfp-empty">${esc(S.noCharacter)}</p>`;
  const tabs = model.tabs.map(t => button({ action: "switch-tab", label: esc(t.text), focus: `tab:${t.id}`, cls: `pfp-tab${t.working ? "" : " is-later"}`, pressed: t.selected, data: { tab: t.id } })).join("");
  const body = model.body.kind === "formulae"
    ? `<div class="pfp-body">${listPane(model.body.list)}${detailPane(model.body)}</div>`
    : model.body.kind === "research" ? `<div class="pfp-body">${researchList(model.body.list)}${researchDetail(model.body.detail)}</div>`
    : model.body.kind === "compendium" ? (model.body.unavailable ? `<div class="pfp-body"><div class="pfp-pane"><p class="pfp-empty">${esc(model.body.unavailable)}</p></div></div>` : `<div class="pfp-body">${compendiumList(model.body)}${compendiumDetail(model.body.detail)}</div>`)
    : `<div class="pfp-body"><div class="pfp-pane pfp-placeholder"><h2>${esc(model.body.tab)}</h2><p>${esc(model.body.text)}</p></div></div>`;
  return `<header class="pfp-bar"><h1>${esc(model.title)}: <span class="pfp-char">${esc(model.character.name)}</span></h1><div class="pfp-row">
    ${button({ action: "toggle-display", label: esc(model.displayButton), focus: "toggle-display", pressed: model.displayPanel.open })}
    ${model.switcher.show ? button({ action: "toggle-switch", label: esc(model.switchButton), focus: "toggle-switch", pressed: model.showSwitch }) : ""}</div></header>
  ${displayPanel(model.displayPanel)}${switchPanel(model)}${statusStrip(model)}${queuePanel(model.queue)}
  <nav class="pfp-tabs" aria-label="Downtime sections">${tabs}</nav>${body}`;
}

/** The attributes of the app's root element (theme, font, layout, real font size). */
export function rootAttributes(model) {
  const r = rootStyle(model.display);
  return { "data-theme": r.theme, "data-font": r.font, "data-layout": model.layout, style: r.css };
}

/** A whole page's worth (the screenshots use this; the window sets the root attributes itself and keeps the live region). */
export function renderHubPage(model, announcements = []) {
  const attrs = Object.entries(rootAttributes(model)).map(([k, v]) => `${k}="${esc(v)}"`).join(" ");
  return `<div class="pfp-hub" ${attrs}><div class="pfp-main">${renderHubMain(model)}</div>
  <div class="pfp-live" role="status" aria-live="polite" aria-label="${esc(model.liveLabel)}">${announcements.map(a => `<p>${esc(a)}</p>`).join("")}</div></div>`;
}
