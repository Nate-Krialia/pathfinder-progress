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
import { SINGLE_SLOT_ROLES } from "../config.js";
import { DEFINITION_KINDS, DEFINITION_SCHEMAS, LIVE_SCHEMAS } from "./schemas.js";
import { BUILT_IN_ROLES, baseRoleFor, parseTier, roleSpec, rolesForCategory, slotRoles } from "./roles.js";
import { resolveMaterialEffect } from "./resolver.js";
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

export { rolesForCategory };

/**
 * Validate a whole set of definitions, including references between them.
 * `sources` is [{ pack, entry, text }]. Returns { registry, errors }.
 * `registry` holds only records that passed every check.
 */
export function loadDefinitions(sources) {
  const errors = [];
  const parsed = [];

  // 1. Parse every source and schema-check it. Invalid records are KEPT here
  //    (marked) so the duplicate check below still sees them.
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
    errors.push(...recordErrors);
    parsed.push({ kind, data: result.data, ctx, invalid: recordErrors.length > 0 });
  }

  // 2. Ids are globally unique (a "material" and a "recipe" can never share
  //    one). Checked over EVERY record with a usable id, valid or not, so a
  //    broken copy of an existing id reports the collision as well. The first
  //    definition seen keeps the id; later ones are rejected.
  const byId = new Map();
  const unique = [];
  for (const rec of parsed) {
    const id = rec.data.id;
    const first = typeof id === "string" && id !== "" ? byId.get(id) : undefined;
    if (first) {
      errors.push(mk(rec.ctx, "id", `"${id}" is already defined in [${first.ctx.pack}] "${first.ctx.entry}" (ids must be unique across all packs)`));
      continue;
    }
    if (typeof id === "string" && id !== "") byId.set(id, rec);
    if (!rec.invalid) unique.push(rec);
  }

  const customRoles = unique.filter(r => r.kind === "customRole").map(r => r.data);
  const builtInNames = new Set(Object.values(BUILT_IN_ROLES).flat());
  const materials = unique.filter(r => r.kind === "material").map(r => r.data);
  const materialIds = new Set(materials.map(m => m.id));

  const bad = new Set();
  const flag = (rec, field, message) => { errors.push(mk(rec.ctx, field, message)); bad.add(rec); };
  const flagAll = (rec, prefix, subErrors) => {
    for (const e of subErrors) flag(rec, e.field === "(root)" ? prefix : `${prefix}.${e.field}`, e.message);
  };

  for (const rec of unique) {
    const d = rec.data;

    if (rec.kind === "customRole" && builtInNames.has(d.id)) {
      flag(rec, "id", `"${d.id}" clashes with a built-in role name`);
    }

    if (rec.kind === "material") {
      for (const [role, value] of Object.entries(d.effects)) {
        const spec = roleSpec(role, customRoles);
        if (!spec) { flag(rec, `effects.${role}`, `is not a known role (built-in or custom): "${role}"`); continue; }
        flagAll(rec, `effects.${role}`, check(spec, value));
      }
    }

    if (rec.kind === "recipe") validateRecipe(rec, { customRoles, materials, materialIds, flag, flagAll });

    if (rec.kind === "creatureYield") {
      d.yield.forEach((y, i) => {
        if (!materialIds.has(y.materialId)) flag(rec, `yield[${i}].materialId`, `refers to unknown material "${y.materialId}"`);
      });
    }
  }

  const registry = Object.fromEntries(DEFINITION_KINDS.map(k => [k, new Map()]));
  const contexts = new Map(); // id -> { pack, entry }, so later checks can name the source
  for (const rec of unique) {
    if (bad.has(rec)) continue;
    registry[rec.kind].set(rec.data.id, rec.data);
    contexts.set(rec.data.id, rec.ctx);
  }
  return { registry, errors, contexts };
}

/** Cross-reference checks for one recipe: roles, slots, overrides and the output map. */
function validateRecipe(rec, { customRoles, materials, materialIds, flag, flagAll }) {
  const d = rec.data;
  const validRoles = rolesForCategory(d.category, customRoles);

  // Slots: every driven role must exist for this category, once per slot.
  d.slots.forEach((slot, i) => {
    const roles = slotRoles(slot);
    if (new Set(roles).size !== roles.length) flag(rec, `slots[${i}].drives`, "lists the same role twice");
    for (const role of roles) {
      if (!validRoles.has(role)) {
        flag(rec, `slots[${i}].drives`, `role "${role}" is not valid for category "${d.category}" (valid: ${[...validRoles].join(", ") || "none"})`);
      }
    }
  });

  // Roles that pick the output item can only be driven by one slot.
  for (const role of SINGLE_SLOT_ROLES) {
    const driving = d.slots.filter(slot => slotRoles(slot).includes(role));
    if (driving.length > 1) flag(rec, "slots", `role "${role}" is driven by ${driving.length} slots (${driving.map(s => s.name).join(", ")}); only one is allowed`);
  }

  // Overrides.
  (d.overrides ?? []).forEach((o, i) => {
    if (!materialIds.has(o.materialId)) flag(rec, `overrides[${i}].materialId`, `refers to unknown material "${o.materialId}"`);
    const slot = d.slots.find(s => s.name === o.slot);
    if (!slot) { flag(rec, `overrides[${i}].slot`, `refers to unknown slot "${o.slot}"`); return; }
    const roles = slotRoles(slot);
    const role = o.role ?? (roles.length === 1 ? roles[0] : null);
    if (!role) { flag(rec, `overrides[${i}].role`, `is required because slot "${slot.name}" drives several roles (${roles.join(", ")})`); return; }
    if (!roles.includes(role)) { flag(rec, `overrides[${i}].role`, `"${role}" is not driven by slot "${slot.name}" (it drives: ${roles.join(", ")})`); return; }
    const spec = roleSpec(role, customRoles);
    if (spec) flagAll(rec, `overrides[${i}].effect`, check(spec, o.effect));
  });

  // Output map.
  const baseRole = baseRoleFor(d);
  const keys = Object.keys(d.output);
  if (!baseRole) {
    if (keys.length !== 1 || keys[0] !== "default") {
      flag(rec, "output", `must be exactly { "default": <uuid> } because category "${d.category}" has no base role (set "baseRole" to choose one)`);
    }
    return;
  }
  if (keys.includes("default")) flag(rec, "output.default", `is not allowed: this recipe's output is picked by role "${baseRole}"`);

  const baseSlots = d.slots.filter(slot => slotRoles(slot).includes(baseRole));
  if (baseSlots.length !== 1) {
    flag(rec, "slots", `exactly one slot must drive "${baseRole}" (found ${baseSlots.length})`);
    return;
  }
  const baseSlot = baseSlots[0];
  const baseSpec = roleSpec(baseRole, customRoles);

  // Every tier a qualifying material can produce must have an output entry.
  const needed = new Map(); // tier -> first material that needs it
  for (const material of materials) {
    if (material.tier < baseSlot.tierFloor) continue;
    const resolved = resolveMaterialEffect(material, baseRole, d, baseSlot.name);
    if (!resolved || check(baseSpec, resolved.value).length) continue;
    const tier = parseTier(resolved.value);
    if (!needed.has(tier)) needed.set(tier, material);
  }
  for (const [tier, material] of [...needed].sort((a, b) => a[0] - b[0])) {
    if (!(String(tier) in d.output)) {
      flag(rec, "output", `has no entry for tier ${tier} (needed because material "${material.id}" can fill slot "${baseSlot.name}" and yields T${tier})`);
    }
  }
}

/** Like loadDefinitions, but throws a DefinitionError listing every problem. */
export function loadDefinitionsOrThrow(sources) {
  const { registry, errors } = loadDefinitions(sources);
  if (errors.length) throw new DefinitionError(errors);
  return registry;
}
