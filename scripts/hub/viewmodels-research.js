/**
 * The Research tab's view-model (Stage 11b round). Pure. Facts come from hub/facts.js, which reads only projectInfo (the player copy: no DC, no odds, no pace),
 * the queue rows and the leads api. Nothing here knows a DC, and no free-text note from a project's log is ever shown.
 *
 * facts.projects: [{ id, goalName, kind, recipeId|null, progress, threshold, skills: [{ skill, label, modifier|null }], log: [{ source, degree?, delta, skill? }], hint|null }]  (active only)
 * facts.leads: [{ id, recipeId, name, note }]            facts.queuedResearch: [{ actionId, projectId, days, skill }]
 * state: projectId, skill, checkDays, confirmAside
 */
import { HUB } from "../config.js";
import { S } from "./strings.js";
import { downtimeGate, plural, safeText, signed } from "./common.js";

const clamp = (n, low, high) => Math.min(Math.max(n, low), Math.max(low, high));

/** The project on screen: the chosen one, or the only one when there is exactly one (no focus is moved for that). */
export function selectedProjectId(facts, state) {
  const ids = facts.projects.map(p => p.id);
  if (state.projectId && ids.includes(state.projectId)) return state.projectId;
  return ids.length === 1 ? ids[0] : null;
}

/** Step boxes up to HUB.research.maxStepBoxes; a native bar beyond that. Always with the words "Progress n of m". */
export function progressModel(project) {
  // A study (Stage 11c) shows a plain stage and no numbers: its thresholds are the GM's.
  if (project.kind === "study") return { study: true, stage: project.stage ?? 0, text: S.stageWords[project.stage ?? 0] ?? S.stageWords[0], boxes: null, value: null, max: null };
  const useBoxes = project.threshold <= HUB.research.maxStepBoxes;
  return {
    value: project.progress, max: project.threshold, text: S.stepsText(project.progress, project.threshold),
    boxes: useBoxes ? Array.from({ length: project.threshold }, (_, i) => ({ done: i < project.progress })) : null
  };
}

const checkRow = entry => {
  const what = S.checkSource[entry.source] ?? S.checkSource.research;
  const result = entry.degree && S.degreeWords[entry.degree] ? `${S.degreeWords[entry.degree]} (${S.progressDelta(entry.delta)})` : S.progressDelta(entry.delta);
  return { text: S.checkRow(what, result) };
};

export function leadCards(facts) {
  return facts.leads.map(lead => {
    if (lead.source === "item") {
      const text = lead.paused ? S.leadResume(lead.name) : lead.itemKind === "note" ? S.leadNote(lead.name) : S.leadItem(lead.name);
      return { key: `lead:${lead.id}`, id: lead.id, name: safeText(lead.name, S.leadHidden), note: safeText(text, S.leadHidden), button: { text: lead.paused ? S.leadStartAgain : S.leadStart, disabled: false, why: null } };
    }
    const used = facts.projects.some(p => p.recipeId === lead.recipeId) || facts.formulas.some(f => f.recipeId === lead.recipeId);
    return {
      key: `lead:${lead.id}`, id: lead.id, name: safeText(lead.name, S.leadHidden), note: lead.note ? safeText(lead.note, S.leadHidden) : "",
      button: { text: S.leadStart, disabled: used, why: used ? S.leadUsed : null }
    };
  });
}

export function researchTab(facts, state) {
  const gate = downtimeGate(facts.downtime);
  const selectedId = selectedProjectId(facts, state);
  const queuedFor = id => facts.queuedResearch.find(q => q.projectId === id) ?? null;
  const leads = leadCards(facts);
  const list = {
    heading: S.researchHeading,
    cards: facts.projects.map(p => ({
      key: `project:${p.id}`, id: p.id, name: p.goalName, kind: p.kind, pill: S.kindPill[p.kind] ?? S.kindPill.unlockFormula,
      progress: progressModel(p), queued: queuedFor(p.id) ? S.queuedBadge : "", selected: p.id === selectedId
    })),
    empty: facts.projects.length === 0 ? S.researchNone : null,
    leads: { heading: S.leadsHeading, items: leads, empty: leads.length === 0 ? S.leadsNone : null, emptyLine: leads.length === 0 ? S.leadsNoneLine : null }
  };

  const project = facts.projects.find(p => p.id === selectedId) ?? null;
  if (!project) return { list, detail: { kind: "empty", text: S.pickProject } };

  const queued = queuedFor(project.id);
  const skills = project.skills.map(s => ({ skill: s.skill, label: s.label, modifierText: s.modifier === null || s.modifier === undefined ? null : S.modifierText(signed(s.modifier)) }));
  const chosen = skills.some(s => s.skill === state.skill) ? state.skill : (skills.length === 1 ? skills[0].skill : null);
  const free = facts.days.free;
  const n = clamp(state.checkDays ?? 1, 1, free);
  let reason = null;
  if (!gate.open) reason = gate.reason;
  else if (!chosen) reason = S.reasonNoSkill;
  else if (queued) reason = S.reasonAlreadyQueued;
  else if (free < 1) reason = S.reasonNoFreeDays;
  const isFormula = project.kind === "unlockFormula";
  const isStudy = project.kind === "study";
  const confirmOpen = Boolean(state.confirmAside) && (isFormula || isStudy) && !queued;
  return {
    list,
    detail: {
      kind: "project", id: project.id, name: project.goalName, pill: S.kindPill[project.kind] ?? S.kindPill.unlockFormula,
      goalLine: (S.goalLine[project.kind] ?? S.goalLine.unlockFormula)(project.goalName),
      progress: progressModel(project),
      hint: project.hint ? safeText(project.hint, S.hintHidden) : null,
      skills: { label: S.rollWith, options: skills.map(s => ({ ...s, selected: s.skill === chosen })) },
      days: { label: S.daysLabel2, value: n, text: S.daysText(n), down: { text: S.daysDown, disabled: n <= 1 }, up: { text: S.daysUp, disabled: n >= free }, note: S.daysNote },
      queue: { text: S.queueChecks(n), disabled: reason !== null, reason, checks: n, skill: chosen },
      queuedNote: queued ? { text: S.queuedNote(queued.days, queued.days), actionId: queued.actionId, cancel: S.cancelQueued } : null,
      aside: isFormula || isStudy
        ? { kind: isStudy ? "study" : "formula", button: { text: isStudy ? S.asideStudyButton : S.asideButton, disabled: Boolean(queued), why: queued ? S.asideWhyQueued : null }, confirm: confirmOpen ? { text: isStudy ? S.asideStudyConfirmText : S.asideConfirmText, confirm: S.asideConfirm, keep: S.asideKeep } : null }
        : { kind: "workshop", note: S.asideWorkshop },
      checks: { heading: S.recentChecks, rows: project.log.slice(-HUB.research.recentChecks).reverse().map(checkRow), empty: project.log.length === 0 ? S.noChecks : null }
    }
  };
}

/** What api.queue.submit needs for the Queue N checks button, or null while it is off. */
export function researchRequest(facts, state) {
  const tab = researchTab(facts, state);
  if (tab.detail.kind !== "project" || tab.detail.queue.disabled) return null;
  return { projectId: tab.detail.id, skill: tab.detail.queue.skill, days: tab.detail.queue.checks, name: tab.detail.name };
}

export { plural };
