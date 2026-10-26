/**
 * Node records: normalising a token's flag into a usable view, and the state
 * transitions (create, activate, refill, corpse). Pure; no Foundry globals.
 *
 * A record is the flag stored on a node token. A VIEW adds everything resolved
 * from definitions: the nodeType, the ladder with absolute DCs, the allowed skills.
 */
import { GATHERING } from "../config.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { resolveLayers } from "../data/resolver.js";
import { resolveRungs } from "./ladder.js";

const describeErrors = errors => errors.map(e => `${e.field} ${e.message}`);

/**
 * @param {object} args
 * @param {object} args.record     the token's node flag
 * @param {{uuid: string, name: string}} args.token
 * @param {object} args.registry   loaded definitions
 * @returns {{ ok: true, node: object } | { ok: false, errors: string[] }}
 */
export function normalizeNode({ record, token, registry, config = GATHERING }) {
  const schemaErrors = check(LIVE_SCHEMAS.node, record);
  if (schemaErrors.length) return { ok: false, errors: describeErrors(schemaErrors).map(e => `${token.name}: ${e}`) };

  const base = {
    uuid: token.uuid, name: token.name, source: record.source, state: record.state,
    region: record.region ?? null, discoveredBy: [...record.discoveredBy], decayTimer: record.decayTimer ?? null
  };
  if (record.state === "anchor") return { ok: true, node: { ...base, nodeType: null, tier: null, charges: 0, skills: [], ladder: null } };

  const nodeType = registry.nodeType.get(record.nodeType);
  if (!nodeType) return { ok: false, errors: [`${token.name}: unknown nodeType "${record.nodeType}" (known: ${[...registry.nodeType.keys()].join(", ") || "none"})`] };

  const layer = resolveLayers([
    { source: "node", value: record.ladder },
    { source: "nodeType", value: nodeType.ladders?.[String(record.tier)] }
  ]);
  if (!layer) {
    return { ok: false, errors: [`${token.name}: nodeType "${nodeType.id}" has no ladder for tier ${record.tier}, and the node has none of its own`] };
  }
  const missing = layer.value.filter(r => !registry.material.has(r.materialId)).map(r => r.materialId);
  if (missing.length) return { ok: false, errors: [`${token.name}: ladder refers to unknown material(s): ${missing.join(", ")}`] };

  const rungs = resolveRungs(layer.value, record.tier, config);
  return {
    ok: true,
    node: {
      ...base,
      nodeType: nodeType.id, nodeTypeName: nodeType.name, tier: record.tier, charges: record.charges,
      skills: [...nodeType.skills],
      ladder: { source: layer.source, ...rungs }
    }
  };
}

// Transitions: each returns { ok: true, record } or { ok: false, errors } ----------------------
const DUMMY_TOKEN = { uuid: "(new node)", name: "node" };

function validated(record, registry, config) {
  const result = normalizeNode({ record, token: DUMMY_TOKEN, registry, config });
  return result.ok ? { ok: true, record } : { ok: false, errors: result.errors.map(e => e.replace(/^node: /, "")) };
}

/** A hidden "a node could spawn here" marker. */
export function makeAnchorRecord({ source = "placed", region } = {}, registry, config) {
  if (source === "corpse") return { ok: false, errors: ["an anchor cannot have source \"corpse\""] };
  return validated({ source, state: "anchor", discoveredBy: [], ...(region ? { region } : {}) }, registry, config);
}

/** A ready-to-gather node (a GM-placed or explored node). */
export function makeNodeRecord({ source = "placed", nodeType, tier, charges, region, discoveredBy = [] }, registry, config) {
  if (source === "corpse") return { ok: false, errors: ['use makeCorpseRecord for source "corpse"'] };
  const type = registry.nodeType.get(nodeType);
  if (!type) return { ok: false, errors: [`unknown nodeType "${nodeType}" (known: ${[...registry.nodeType.keys()].join(", ") || "none"})`] };
  return validated({
    source, state: "active", nodeType, tier, charges: charges ?? type.charges,
    discoveredBy, ...(region ? { region } : {})
  }, registry, config);
}

/** Turn an anchor into an active node. */
export function activateRecord(record, { nodeType, tier, charges, source, region, discoveredBy }, registry, config) {
  if (record.state !== "anchor") return { ok: false, errors: [`only an anchor can be activated (this node is ${record.state})`] };
  const type = registry.nodeType.get(nodeType);
  if (!type) return { ok: false, errors: [`unknown nodeType "${nodeType}" (known: ${[...registry.nodeType.keys()].join(", ") || "none"})`] };
  const next = {
    ...record, state: "active", nodeType, tier, charges: charges ?? type.charges,
    ...(source ? { source } : {}), ...(region ? { region } : {}), ...(discoveredBy ? { discoveredBy } : {})
  };
  return validated(next, registry, config);
}

/** Bring a spent or part-used node back to `charges` (default: its nodeType's). */
export function refillRecord(record, charges, registry, config) {
  if (record.state === "anchor") return { ok: false, errors: ["an anchor has no charges to refill; activate it first"] };
  const type = registry.nodeType.get(record.nodeType);
  const amount = charges ?? type?.charges;
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, errors: [`charges must be a whole number of at least 1 (got ${amount})`] };
  return validated({ ...record, state: "active", charges: amount }, registry, config);
}

/** A corpse node: the same shape, with its own ladder and a decay timer. */
export function makeCorpseRecord({ tier, ladder, charges, decayTimer, nodeType = "corpse", region, discoveredBy = [] }, registry, config) {
  if (!ladder) return { ok: false, errors: ["a corpse node needs its own ladder (the trait-to-material mapping that would derive one is not built yet)"] };
  const type = registry.nodeType.get(nodeType);
  if (!type) return { ok: false, errors: [`unknown nodeType "${nodeType}" (known: ${[...registry.nodeType.keys()].join(", ") || "none"})`] };
  return validated({
    source: "corpse", state: "active", nodeType, tier, charges: charges ?? type.charges, decayTimer, ladder,
    discoveredBy, ...(region ? { region } : {})
  }, registry, config);
}
