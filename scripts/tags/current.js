/** The ledger the GM client holds in memory (pure holder, so pure code can read it). An empty one on a player client, always. */
import { emptyLedger } from "./ledger.js";
let current = emptyLedger();
export const getLedger = () => current;
export const setCurrentLedger = ledger => { current = ledger ?? emptyLedger(); };

// The GM's cap table (Slice 2a): null means "the defaults". Held here so pure code (the craft plan, the effects engine) can read it.
import { mergeCaps } from "./stack.js";
let caps = null;
export const getCapsTable = () => caps;
export const getCaps = () => mergeCaps(caps);
export const setCurrentCaps = table => { caps = table ?? null; };

// The frozen craft results (Slice 2b), held for pure code (the effects engine). GM client only; a player's is always empty.
import { emptyFrozen } from "./frozen.js";
let frozen = emptyFrozen();
export const getFrozenStore = () => frozen;
export const setCurrentFrozen = store => { frozen = store ?? emptyFrozen(); };
export const frozenRecord = id => (id ? frozen.items[id] : undefined);
