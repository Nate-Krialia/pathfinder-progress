/**
 * Resolving a recipe's `output` references. No Foundry globals (testable in Node).
 *
 * A reference is one of:
 *   "Dagger"                         an item NAME
 *   "pf2e.equipment-srd: Dagger"     "Pack: Name" (the pack's id or its label)
 *   "Compendium.pf2e.equipment-srd.Item.<id>"   a full UUID (escape hatch)
 *
 * Names are matched exactly (ignoring case and surrounding spaces) against the
 * configured item packs. Zero matches or several matches is a FAILURE with a
 * message saying what was found. This module never guesses.
 *
 * A "source" is { id, label, entries: [{ name, uuid, type }] }, one per searched pack.
 */
import { ITEM_UUID_PATTERN } from "../config.js";

export const isUuid = ref => typeof ref === "string" && ITEM_UUID_PATTERN.test(ref.trim());
/** Looks like a UUID (so a typo should be rejected, not treated as a name). */
export const looksLikeUuid = ref => typeof ref === "string" && /^(Compendium|Item)\./.test(ref.trim());

const norm = text => String(text ?? "").trim().toLowerCase();

/** "a, b ,c" -> ["a", "b", "c"] */
export function parsePackList(text) {
  return String(text ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * Expand pack patterns against the ids that exist. A pattern ending in ".*"
 * matches every pack with that prefix ("world.*"); anything else is an exact id.
 * Returns { ids, missing } where `missing` lists exact ids that do not exist.
 */
export function expandPackPatterns(patterns, allPackIds) {
  const ids = [];
  const missing = [];
  const add = id => { if (!ids.includes(id)) ids.push(id); };
  for (const pattern of patterns) {
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -1);
      for (const id of allPackIds) if (id.startsWith(prefix)) add(id);
    } else if (allPackIds.includes(pattern)) {
      add(pattern);
    } else {
      missing.push(pattern);
    }
  }
  return { ids, missing };
}

/** Split off a "Pack:" prefix when (and only when) it names a searched pack. */
function splitPackPrefix(ref, sources) {
  const colon = ref.indexOf(":");
  if (colon > 0) {
    const prefix = ref.slice(0, colon).trim();
    const rest = ref.slice(colon + 1).trim();
    const pack = sources.find(s => norm(s.id) === norm(prefix) || (s.label && norm(s.label) === norm(prefix)));
    if (pack && rest) return { name: rest, pack, unmatchedPrefix: null };
    return { name: ref.trim(), pack: null, unmatchedPrefix: prefix };
  }
  return { name: ref.trim(), pack: null, unmatchedPrefix: null };
}

const describeMatch = m => `[${m.packId}] ${m.name} (${m.type ?? "item"}) ${m.uuid}`;

/**
 * @returns {{ ok: true, uuid: string, via: "uuid"|"name", name?: string, packId?: string }
 *         | { ok: false, reason: "none"|"multiple"|"malformed", message: string, matches: object[] }}
 */
export function resolveRef(ref, sources) {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) return { ok: false, reason: "none", message: "the output reference is empty", matches: [] };

  if (isUuid(text)) return { ok: true, uuid: text, via: "uuid" };
  if (looksLikeUuid(text)) {
    return { ok: false, reason: "malformed", message: `"${text}" looks like a UUID but is malformed`, matches: [] };
  }

  const { name, pack, unmatchedPrefix } = splitPackPrefix(text, sources);
  const pool = pack ? [pack] : sources;
  const seen = new Set();
  const matches = [];
  for (const source of pool) {
    for (const entry of source.entries) {
      if (norm(entry.name) === norm(name) && !seen.has(entry.uuid)) {
        seen.add(entry.uuid);
        matches.push({ packId: source.id, name: entry.name, type: entry.type, uuid: entry.uuid });
      }
    }
  }

  if (matches.length === 1) {
    const [match] = matches;
    return { ok: true, uuid: match.uuid, via: "name", name: match.name, packId: match.packId, type: match.type };
  }

  const where = pack
    ? `pack "${pack.id}"`
    : `the searched item packs (${sources.map(s => s.id).join(", ") || "none"})`;
  if (matches.length === 0) {
    const hint = unmatchedPrefix
      ? `; if "${unmatchedPrefix}" was meant as a pack, it is not one of the searched packs`
      : "";
    return { ok: false, reason: "none", message: `"${name}" matched no items in ${where}${hint}`, matches };
  }
  return {
    ok: false,
    reason: "multiple",
    message: `"${name}" matched ${matches.length} items in ${where}: ${matches.map(describeMatch).join("; ")}; use "Pack: Name" or a full UUID to choose one`,
    matches
  };
}

/** A session cache of resolved refs. Failures are never cached, so a fix shows up on reload. */
export const createRefCache = () => new Map();

export function resolveRefCached(ref, sources, cache) {
  const key = `${sources.map(s => s.id).join("|")}::${String(ref).trim()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = resolveRef(ref, sources);
  if (result.ok) cache.set(key, result);
  return result;
}
