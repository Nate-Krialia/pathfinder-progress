/**
 * The tag effect builder's pure edits (Slice 2a, GM only). A draft is a tag's `effectBlocks` ({ general?, byClass? }, the same shape as a material's). Every function returns a
 * NEW draft. The blocks themselves, their problems and their plain-words lines are the effect builder's own (editor/blocks.js): nothing is copied.
 */
import { BUILT_IN_ROLES } from "../data/roles.js";
import { EFFECT_CONDITIONS } from "../config.js";
import { collapse, flat, newBlock, setProblems, spread, valueAt, describeBlocks, TIERS } from "../editor/blocks.js";

export const CLASSES = ["general", ...Object.keys(BUILT_IN_ROLES)];
const clone = x => structuredClone(x ?? {});

const setOf = (draft, cls) => (cls === "general" ? draft.general : draft.byClass?.[cls]) ?? { blocks: [] };
function withSet(draft, cls, fn) {
  const next = clone(draft);
  const set = fn(clone(setOf(next, cls)));
  set.blocks ??= [];
  if (cls === "general") next.general = set; else { next.byClass ??= {}; next.byClass[cls] = set; }
  // a set with nothing in it is not stored
  const empty = s => !s || (s.power === undefined && !(s.blocks ?? []).length && !s.extra);
  if (cls === "general" ? empty(next.general) : empty(next.byClass[cls])) { if (cls === "general") delete next.general; else delete next.byClass[cls]; }
  if (next.byClass && !Object.keys(next.byClass).length) delete next.byClass;
  return next;
}

export const fxSet = setOf;
export const fxEmpty = draft => !draft || (!draft.general && !draft.byClass);

export const fxEdit = {
  addBlock: (draft, cls, type) => withSet(draft, cls, set => ({ ...set, blocks: [...(set.blocks ?? []), newBlock(type)] })),
  removeBlock: (draft, cls, index) => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.filter((_, i) => i !== index) })),
  setPower: (draft, cls, raw) => withSet(draft, cls, set => { const next = { ...set }; if (raw === "" || raw === undefined) delete next.power; else next.power = Number(raw); return next; }),
  /** field: a plain block field (title, text, damageType, persistent, versus, bonusType, condition, save, on) */
  setField: (draft, cls, index, field, raw) => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.map((b, i) => {
    if (i !== index) return b;
    const next = { ...b };
    if (raw === "" || raw === undefined || raw === false) delete next[field]; else next[field] = raw;
    if (field === "condition" && !EFFECT_CONDITIONS[raw]?.valued) delete next.value;
    if (field === "condition" && EFFECT_CONDITIONS[raw]?.valued && !next.value) next.value = flat(1);
    return next;
  }) })),
  /** a tier-dependent field (dice, value): one value for every tier, or a T1 to T5 table */
  setTierMode: (draft, cls, index, field, mode) => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.map((b, i) => (i !== index ? b : { ...b, [field]: mode === "table" ? spread(b[field], field === "dice" ? "1d4" : 1) : collapse(b[field], 1) })) })),
  setTierValue: (draft, cls, index, field, tier, raw) => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.map((b, i) => {
    if (i !== index) return b;
    const value = field === "dice" ? String(raw) : Number(raw);
    return { ...b, [field]: tier === "all" ? { all: value } : { byTier: { ...(b[field]?.byTier ?? {}), [tier]: value } } };
  }) }))
};

/** Every problem of a draft, over all five tiers, as plain sentences with the class named. */
export function fxProblems(draft) {
  const out = [];
  const sets = [["general", draft?.general], ...Object.entries(draft?.byClass ?? {})];
  for (const [cls, set] of sets) {
    const seen = new Set();
    for (const t of TIERS) for (const problem of setProblems(set, cls, t)) if (!seen.has(problem)) { seen.add(problem); out.push(`${cls === "general" ? "Any item" : cls}: ${problem}`); }
  }
  return out;
}

/** What a tag does in a class, by tier, in the Hub's own words (GM view): [{ tier, lines }]. */
export const fxPreview = (tagName, draft, cls) => TIERS.map(tier => ({ tier, lines: describeBlocks(tagName, setOf(draft, cls), cls, tier) }));

export { valueAt };
