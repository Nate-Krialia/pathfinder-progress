/**
 * A tiny schema validator. No Foundry globals, so it runs in plain Node tests.
 *
 * A spec is an object with a `type`:
 *   string | int | number | boolean | enum | effect | array | object | record | variant | any
 * plus optional modifiers: `optional`, `refine(value, path, errors)`.
 * Validation never throws; it appends { field, message } entries to `errors`.
 */

const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** Classify an effect value: a number, a tier reference like "T2", or free text. */
export function classifyEffectValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "string" && value.trim() !== "") {
    return /^T[1-9]\d*$/.test(value.trim()) ? "tier" : "string";
  }
  return null;
}

function describe(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `${typeof value} ${JSON.stringify(value)}`;
}

function fail(errors, path, message) {
  errors.push({ field: path || "(root)", message });
}

export function validateValue(spec, value, path, errors) {
  if (value === undefined || value === null) {
    if (!spec.optional) fail(errors, path, "is required");
    return;
  }

  const before = errors.length;
  switch (spec.type) {
    case "string":
      if (typeof value !== "string" || value.trim() === "") {
        fail(errors, path, `must be a non-empty string (got ${describe(value)})`);
      } else if (spec.pattern && !spec.pattern.test(value)) {
        fail(errors, path, `${spec.patternHint ?? `must match ${spec.pattern}`} (got "${value}")`);
      }
      break;

    case "int":
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || (spec.type === "int" && !Number.isInteger(value))) {
        fail(errors, path, `must be ${spec.type === "int" ? "an integer" : "a number"} (got ${describe(value)})`);
      } else if (spec.min !== undefined && value < spec.min) {
        fail(errors, path, `must be at least ${spec.min} (got ${value})`);
      } else if (spec.max !== undefined && value > spec.max) {
        fail(errors, path, `must be at most ${spec.max} (got ${value})`);
      }
      break;

    case "boolean":
      if (typeof value !== "boolean") fail(errors, path, `must be true or false (got ${describe(value)})`);
      break;

    case "enum":
      if (!spec.values.includes(value)) {
        fail(errors, path, `must be one of ${spec.values.join(", ")} (got ${describe(value)})`);
      }
      break;

    case "effect":
      if (classifyEffectValue(value) === null) {
        fail(errors, path, `must be a number, a tier like "T2", or a text string (got ${describe(value)})`);
      }
      break;

    case "array":
      if (!Array.isArray(value)) {
        fail(errors, path, `must be an array (got ${describe(value)})`);
        break;
      }
      if (spec.min !== undefined && value.length < spec.min) {
        fail(errors, path, `must have at least ${spec.min} item(s) (got ${value.length})`);
      }
      value.forEach((item, i) => validateValue(spec.of, item, `${path}[${i}]`, errors));
      break;

    case "object": {
      if (!isPlainObject(value)) {
        fail(errors, path, `must be an object (got ${describe(value)})`);
        break;
      }
      for (const [key, sub] of Object.entries(spec.fields)) {
        validateValue(sub, value[key], path ? `${path}.${key}` : key, errors);
      }
      if (!spec.extra) {
        for (const key of Object.keys(value)) {
          if (!(key in spec.fields)) fail(errors, path ? `${path}.${key}` : key, "is not a recognised field");
        }
      }
      break;
    }

    case "record":
      if (!isPlainObject(value)) {
        fail(errors, path, `must be an object (got ${describe(value)})`);
        break;
      }
      for (const [key, item] of Object.entries(value)) {
        validateValue(spec.of, item, `${path}.${key}`, errors);
      }
      break;

    case "variant": {
      if (!isPlainObject(value)) {
        fail(errors, path, `must be an object (got ${describe(value)})`);
        break;
      }
      const tag = value[spec.key];
      const variant = spec.variants[tag];
      if (!variant) {
        fail(errors, `${path}.${spec.key}`, `must be one of ${Object.keys(spec.variants).join(", ")} (got ${describe(tag)})`);
        break;
      }
      validateValue(obj({ [spec.key]: str(), ...variant }), value, path, errors);
      break;
    }

    case "scalar":
      if (!["number", "string", "boolean"].includes(typeof value)
        || (typeof value === "number" && !Number.isFinite(value))
        || value === "") {
        fail(errors, path, `must be a number, a text string, or true/false (got ${describe(value)})`);
      }
      break;

    case "union": {
      const matched = spec.of.some(option => {
        const attempt = [];
        validateValue({ ...option, optional: false }, value, path, attempt);
        return attempt.length === 0;
      });
      if (!matched) fail(errors, path, spec.hint ?? `does not match any allowed form (got ${describe(value)})`);
      break;
    }

    case "any":
      break;

    default:
      throw new Error(`schema.js: unknown spec type "${spec.type}" at ${path}`);
  }

  // Cross-field rules only run once the value is structurally sound.
  if (spec.refine && errors.length === before) spec.refine(value, path, errors);
}

/** Validate `value` against `spec`; returns [{ field, message }] (empty when valid). */
export function check(spec, value) {
  const errors = [];
  validateValue(spec, value, "", errors);
  return errors;
}

// Spec builders -------------------------------------------------------------
export const str = (opts = {}) => ({ type: "string", ...opts });
export const int = (opts = {}) => ({ type: "int", ...opts });
export const num = (opts = {}) => ({ type: "number", ...opts });
export const bool = (opts = {}) => ({ type: "boolean", ...opts });
export const oneOf = (values, opts = {}) => ({ type: "enum", values, ...opts });
export const effect = (opts = {}) => ({ type: "effect", ...opts });
export const arr = (of, opts = {}) => ({ type: "array", of, ...opts });
export const obj = (fields, opts = {}) => ({ type: "object", fields, ...opts });
export const record = (of, opts = {}) => ({ type: "record", of, ...opts });
export const variant = (key, variants, opts = {}) => ({ type: "variant", key, variants, ...opts });
export const any = (opts = {}) => ({ type: "any", ...opts });
export const scalar = (opts = {}) => ({ type: "scalar", ...opts });
export const union = (of, opts = {}) => ({ type: "union", of, ...opts });
export const optional = spec => ({ ...spec, optional: true });
