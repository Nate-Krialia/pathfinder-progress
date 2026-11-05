/**
 * The tag effect builder's pure edits (Slice 2a, GM only). A draft is a tag's `effectBlocks` ({ general?, byClass? }, the same shape as a material's). Every function returns a
 * NEW draft. The blocks themselves, their problems and their plain-words lines are the effect builder's own (editor/blocks.js): nothing is copied.
 */
import { BUILT_IN_ROLES } from "../data/roles.js";
import { EFFECT_CONDITIONS } from "../config.js";
import { collapse, flat, newBlock, setProblems, spread, valueAt, describeBlocks, TIERS } from "../editor/blocks.js";

export const CLASSES = ["general", ...Object.keys(BUILT_IN_ROLES)];
const clone = x => structuredClone(x ?? {});

// A set lives in one of four places: general, byClass[cls], bySlot[kind].general, bySlot[kind].byClass[cls] (Slice 2b). `kind` "" means "any slot".
const holder = (draft, kind) => (kind ? draft.bySlot?.[kind] : draft) ?? {};
const setOf = (draft, cls, kind = "") => (cls === "general" ? holder(draft, kind).general : holder(draft, kind).byClass?.[cls]) ?? { blocks: [] };
function withSet(draft, cls, fn, kind = "") {
  const next = clone(draft);
  const set = fn(clone(setOf(next, cls, kind)));
  set.blocks ??= [];
  const empty = x => !x || (x.power === undefined && !(x.blocks ?? []).length && !x.extra);
  let box = next;
  if (kind) { next.bySlot ??= {}; next.bySlot[kind] ??= {}; box = next.bySlot[kind]; }
  if (cls === "general") box.general = set; else { box.byClass ??= {}; box.byClass[cls] = set; }
  // a set with nothing in it is not stored, and neither is a container with nothing in it
  if (cls === "general" ? empty(box.general) : empty(box.byClass[cls])) { if (cls === "general") delete box.general; else delete box.byClass[cls]; }
  if (box.byClass && !Object.keys(box.byClass).length) delete box.byClass;
  if (kind && !Object.keys(box).length) delete next.bySlot[kind];
  if (next.bySlot && !Object.keys(next.bySlot).length) delete next.bySlot;
  return next;
}

export const fxSet = setOf;
export const fxEmpty = draft => !draft || (!draft.general && !draft.byClass && !draft.bySlot);

export const fxEdit = {
  addBlock: (draft, cls, type, kind = "") => withSet(draft, cls, set => ({ ...set, blocks: [...(set.blocks ?? []), newBlock(type)] }), kind),
  removeBlock: (draft, cls, index, kind = "") => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.filter((_, i) => i !== index) }), kind),
  setPower: (draft, cls, raw, kind = "") => withSet(draft, cls, set => { const next = { ...set }; if (raw === "" || raw === undefined) delete next.power; else next.power = Number(raw); return next; }, kind),
  /** field: a plain block field (title, text, damageType, persistent, versus, bonusType, condition, save, on) */
  setField: (draft, cls, index, field, raw, kind = "") => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.map((b, i) => {
    if (i !== index) return b;
    const next = { ...b };
    if (raw === "" || raw === undefined || raw === false) delete next[field]; else next[field] = raw;
    if (field === "condition" && !EFFECT_CONDITIONS[raw]?.valued) delete next.value;
    if (field === "condition" && EFFECT_CONDITIONS[raw]?.valued && !next.value) next.value = flat(1);
    return next;
  }) }), kind),
  /** a tier-dependent field (dice, value): one value for every tier, or a T1 to T5 table */
  setTierMode: (draft, cls, index, field, mode, kind = "") => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.map((b, i) => (i !== index ? b : { ...b, [field]: mode === "table" ? spread(b[field], field === "dice" ? "1d4" : 1) : collapse(b[field], 1) })) }), kind),
  setTierValue: (draft, cls, index, field, tier, raw, kind = "") => withSet(draft, cls, set => ({ ...set, blocks: set.blocks.map((b, i) => {
    if (i !== index) return b;
    const value = field === "dice" ? String(raw) : Number(raw);
    return { ...b, [field]: tier === "all" ? { all: value } : { byTier: { ...(b[field]?.byTier ?? {}), [tier]: value } } };
  }) }), kind)
};

/** Every problem of a draft, over all five tiers, as plain sentences with the class named. */
export function fxProblems(draft) {
  const out = [];
  const sets = [["general", "", draft?.general], ...Object.entries(draft?.byClass ?? {}).map(([cls, set]) => [cls, "", set])];
  for (const [kind, k] of Object.entries(draft?.bySlot ?? {})) { sets.push(["general", kind, k.general]); for (const [cls, set] of Object.entries(k.byClass ?? {})) sets.push([cls, kind, set]); }
  for (const [cls, kind, set] of sets) {
    if (!set) continue;
    const seen = new Set();
    for (const t of TIERS) for (const problem of setProblems(set, cls, t)) if (!seen.has(problem)) { seen.add(problem); out.push(kind ? `${kind} slots, ${cls === "general" ? "any item" : cls}: ${problem}` : `${cls === "general" ? "Any item" : cls}: ${problem}`); }
  }
  return out;
}

/** What a tag does in a class, by tier, in the Hub's own words (GM view): [{ tier, lines }]. */
export const fxPreview = (tagName, draft, cls, kind = "") => TIERS.map(tier => ({ tier, lines: describeBlocks(tagName, setOf(draft, cls, kind), cls, tier) }));

export { valueAt };
