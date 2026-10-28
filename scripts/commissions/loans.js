/**
 * Commission loans on a crafter's formula list. Pure; no Foundry globals.
 *
 * A loan for commissions is an ordinary formula entry { access: "loan" } that also lists the ids of
 * the open commissions it serves. Several commissions for the same recipe share one entry, and it
 * goes away only when the last of them ends. A loan the GM granted by hand (no `commissions` list)
 * is never touched here, and an owned formula is never downgraded.
 */
import { makeSnapshot } from "../research/formulas.js";

const find = (list, recipeId) => list.find(entry => entry.recipeId === recipeId);

/** @returns {{ list: object[], change: "added"|"joined"|"owned"|"gmLoan" }} */
export function addLoan(list, recipe, commissionId) {
  const existing = find(list, recipe.id);
  if (!existing) {
    const entry = { recipeId: recipe.id, access: "loan", source: "commission", snapshot: makeSnapshot(recipe), commissions: [commissionId] };
    return { list: [...list, entry], change: "added" };
  }
  if (existing.access === "owned") return { list, change: "owned" };
  if (!existing.commissions) return { list, change: "gmLoan" };
  const joined = { ...existing, commissions: [...new Set([...existing.commissions, commissionId])], snapshot: makeSnapshot(recipe) };
  return { list: list.map(entry => (entry === existing ? joined : entry)), change: "joined" };
}

/** Take a commission out of every loan that serves it. @returns {{ list, dropped: boolean, entryRemoved: boolean }} */
export function dropLoan(list, commissionId) {
  let dropped = false;
  let entryRemoved = false;
  const next = [];
  for (const entry of list) {
    if (entry.access === "loan" && entry.commissions?.includes(commissionId)) {
      dropped = true;
      const rest = entry.commissions.filter(id => id !== commissionId);
      if (rest.length) next.push({ ...entry, commissions: rest });
      else entryRemoved = true;
    } else {
      next.push(entry);
    }
  }
  return { list: next, dropped, entryRemoved };
}

/** Does this crafter hold a loan that serves the commission? */
export const hasLoanFor = (list, commissionId) => list.some(entry => entry.access === "loan" && entry.commissions?.includes(commissionId));
