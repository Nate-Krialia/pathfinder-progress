/**
 * Loading and validating definitions. No Foundry globals (testable in Node).
 *
 * A definition lives in a Journal entry text page as a JSON block:
 *
 *     ```json
 *     { "kind": "material", "id": "iron", ... }
 *     ```
 *
 * Every error names the pack, the entry, and the field.
 */
import { BUILT_IN_ROLES, DEFINITION_KINDS, DEFINITION_SCHEMAS, LIVE_SCHEMAS } from "./schemas.js";
import { check } from "./schema.js";

export class DefinitionError extends Error {
  constructor(errors) {
    super(`${errors.length} problem(s) in definitions:\n${errors.map(formatError).join("\n")}`);
    this.name = "DefinitionError";
    this.errors = errors;
  }
}

export function formatError({ pack, entry, field, message }) {
  return `[${pack}] "${entry}": field "${field}" ${message}`;
}

const mk = (ctx, field, message) => ({ pack: ctx.pack, entry: ctx.entry, field, message });

/** Pull the JSON text out of a markdown page (first fenced block, or the whole page). */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/i);
  if (fenced) return fenced[1];
  const trimmed = text.trim();
  return trimmed.startsWith("{") ? trimmed : null;
}

/** Parse one page's text. Returns { data } or { errors }. */
export function parseDefinition(text, ctx) {
  const json = extractJson(text);
  if (json === null) {
    return { errors: [mk(ctx, "(page text)", "has no JSON block; wrap the definition in a ```json fence")] };
  }
  try {
    return { data: JSON.parse(json) };
  } catch (err) {
    return { errors: [mk(ctx, "(json)", `is not valid JSON: ${err.message}`)] };
  }
}

/** Schema-check one record of a known kind. Returns errors carrying ctx. */
export function validateRecord(kind, data, ctx) {
  const schema = DEFINITION_SCHEMAS[kind] ?? LIVE_SCHEMAS[kind];
  if (!schema) return [mk(ctx, "kind", `is not a known record kind "${kind}"`)];
  return check(schema, data).map(e => mk(ctx, e.field, e.message));
}

export function rolesForCategory(category, customRoles = []) {
  const roles = new Set(BUILT_IN_ROLES[category] ?? []);
  for (const role of customRoles) if (role.appliesTo.includes(category)) roles.add(role.id);
  return roles;
}

/**
 * Validate a whole set of definitions, including references between them.
 * `sources` is [{ pack, entry, text }]. Returns { registry, errors }.
 * `registry` holds only records that passed every check.
 */
export function loadDefinitions(sources) {
  const errors = [];
  const parsed = [];

  for (const source of sources) {
    const ctx = { pack: source.pack, entry: source.entry };
    const result = parseDefinition(source.text, ctx);
    if (result.errors) { errors.push(...result.errors); continue; }

    const kind = result.data?.kind;
    if (!DEFINITION_KINDS.includes(kind)) {
      errors.push(mk(ctx, "kind", `must be one of ${DEFINITION_KINDS.join(", ")} (got ${JSON.stringify(kind)})`));
      continue;
    }
    const recordErrors = validateRecord(kind, result.data, ctx);
    if (recordErrors.length) { errors.push(...recordErrors); continue; }
    parsed.push({ kind, data: result.data, ctx });
  }

  // Ids are globally unique, so a "material" and a "recipe" can never share one.
  const byId = new Map();
  const unique = [];
  for (const rec of parsed) {
    const first = byId.get(rec.data.id);
    if (first) {
      errors.push(mk(rec.ctx, "id", `"${rec.data.id}" is already defined in [${first.ctx.pack}] "${first.ctx.entry}" (ids must be unique across all packs)`));
      continue;
    }
    byId.set(rec.data.id, rec);
    unique.push(rec);
  }

  const customRoles = unique.filter(r => r.kind === "customRole").map(r => r.data);
  const builtInNames = new Set(Object.values(BUILT_IN_ROLES).flat());
  const allRoles = new Set([...builtInNames, ...customRoles.map(r => r.id)]);
  const materialIds = new Set(unique.filter(r => r.kind === "material").map(r => r.data.id));

  const bad = new Set();
  const flag = (rec, field, message) => { errors.push(mk(rec.ctx, field, message)); bad.add(rec); };

  for (const rec of unique) {
    const d = rec.data;
    if (rec.kind === "customRole" && builtInNames.has(d.id)) {
      flag(rec, "id", `"${d.id}" clashes with a built-in role name`);
    }
    if (rec.kind === "material") {
      for (const role of Object.keys(d.effects)) {
        if (!allRoles.has(role)) flag(rec, `effects.${role}`, `is not a known role (built-in or custom): "${role}"`);
      }
    }
    if (rec.kind === "recipe") {
      const roles = rolesForCategory(d.category, customRoles);
      d.slots.forEach((slot, i) => {
        if (!roles.has(slot.drives)) {
          flag(rec, `slots[${i}].drives`, `role "${slot.drives}" is not valid for category "${d.category}" (valid: ${[...roles].join(", ") || "none"})`);
        }
      });
      const slotNames = new Set(d.slots.map(s => s.name));
      (d.overrides ?? []).forEach((o, i) => {
        if (!materialIds.has(o.materialId)) flag(rec, `overrides[${i}].materialId`, `refers to unknown material "${o.materialId}"`);
        if (!slotNames.has(o.slot)) flag(rec, `overrides[${i}].slot`, `refers to unknown slot "${o.slot}"`);
      });
    }
    if (rec.kind === "creatureYield") {
      d.yield.forEach((y, i) => {
        if (!materialIds.has(y.materialId)) flag(rec, `yield[${i}].materialId`, `refers to unknown material "${y.materialId}"`);
      });
    }
  }

  const registry = Object.fromEntries(DEFINITION_KINDS.map(k => [k, new Map()]));
  for (const rec of unique) {
    if (!bad.has(rec)) registry[rec.kind].set(rec.data.id, rec.data);
  }
  return { registry, errors };
}

/** Like loadDefinitions, but throws a DefinitionError listing every problem. */
export function loadDefinitionsOrThrow(sources) {
  const { registry, errors } = loadDefinitions(sources);
  if (errors.length) throw new DefinitionError(errors);
  return registry;
}
