/**
 * What each queued action type needs. Pure. A type is "wired" once it has an entry here AND a
 * resolver in queue/store.js. Only research is wired so far (exploration, commissions and
 * upgrades arrive in later stages).
 *
 * validateSubmit uses only data on the actor (its projects), never the recipes, so a
 * player's client can submit.
 */

/** Look up a project in the actor's raw projects list. */
const findProject = (projects, id) => projects.find(p => p?.id === id);

const research = {
  /** @returns {{ ok: true, params: object } | { ok: false, errors: string[] }} */
  validateSubmit({ projects, params }) {
    const project = findProject(projects, params?.projectId);
    if (!project) return { ok: false, errors: [`no project "${params?.projectId}" (projects: ${projects.map(p => p?.id).join(", ") || "none"})`] };
    if (project.outcome?.type !== "unlockFormula") return { ok: false, errors: ["only unlockFormula projects can be researched for now"] };
    if (project.status !== "active") return { ok: false, errors: [`project "${project.id}" is ${project.status}, not active`] };

    const allowed = project.skillWhitelist ?? [];
    let skill = params.skill;
    if (skill === undefined) {
      if (allowed.length !== 1) return { ok: false, errors: [`"${project.goalName}" research allows several skills (${allowed.join(", ")}); choose one with skill`] };
      skill = allowed[0];
    } else if (!allowed.includes(skill)) {
      return { ok: false, errors: [`skill "${skill}" is not allowed for "${project.goalName}" research (allowed: ${allowed.join(", ")})`] };
    }
    return { ok: true, params: { projectId: project.id, skill } };
  },

  /** A short label and detail for the review window. */
  describe({ action, projects }) {
    const project = findProject(projects, action.params?.projectId);
    if (!project) return { label: `Research: ${action.params?.projectId ?? "?"}`, detail: "project not found", problem: "the project no longer exists" };
    const detail = `${action.params.skill ?? "?"}, DC ${project.dc}, progress ${project.progress}/${project.threshold}`;
    const problem = project.status !== "active" ? `project is ${project.status}` : null;
    return { label: `Research: ${project.goalName}`, detail, problem };
  }
};

export const HANDLERS = { research };
export const wiredTypes = () => Object.keys(HANDLERS);
