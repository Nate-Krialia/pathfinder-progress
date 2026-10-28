/**
 * Work out the audit-ledger changes between an actor's formula and project lists before and after
 * a write, so a flow never has to list them by hand. Pure; no Foundry globals.
 * The ledger tracks a formula's ACCESS and a project's progress and status, nothing else.
 */
export function ledgerChanges({ formulasBefore, formulasAfter, projectsBefore, projectsAfter, note }) {
  const changes = [];
  const before = new Map(formulasBefore.map(f => [f.recipeId, f.access]));
  const after = new Map(formulasAfter.map(f => [f.recipeId, f.access]));
  for (const [recipeId, access] of after) if (before.get(recipeId) !== access) changes.push({ type: "formulaAdd", recipeId, access, note });
  for (const recipeId of before.keys()) if (!after.has(recipeId)) changes.push({ type: "formulaRemove", recipeId, note });

  const key = p => JSON.stringify([p.tier, p.dc, p.threshold, p.progress, p.status]);
  const oldProjects = new Map(projectsBefore.map(p => [p.id, p]));
  for (const project of projectsAfter) {
    const old = oldProjects.get(project.id);
    if (!old || key(old) !== key(project)) changes.push({ type: "projectSet", project, note });
  }
  const kept = new Set(projectsAfter.map(p => p.id));
  for (const id of oldProjects.keys()) if (!kept.has(id)) changes.push({ type: "projectRemove", id });
  return changes;
}
