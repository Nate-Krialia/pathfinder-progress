/** The ledger the GM client holds in memory (pure holder, so pure code can read it). An empty one on a player client, always. */
import { emptyLedger } from "./ledger.js";
let current = emptyLedger();
export const getLedger = () => current;
export const setCurrentLedger = ledger => { current = ledger ?? emptyLedger(); };
