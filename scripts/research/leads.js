/**
 * Leads (Stage 11b round): a formula a character could start researching, handed over by the GM (later also by exploration and commissions).
 * A lead is `{ id, recipeId, name, note, at }` in the actor flag `leads`; `name` is the recipe's name at the time, because a player's client
 * does not hold a recipe it has no formula for. Following a lead starts the research project on the GM client.
 */
import { HUB, MODULE_ID, RESEARCH_KEYS as K } from "../config.js";
import { logWorldEvent } from "../audit/store.js";
import { playerProject } from "../difficulty.js";
import { check } from "../data/schema.js";
import { LIVE_SCHEMAS } from "../data/schemas.js";
import { actorKey, withLocks } from "../queue/lock.js";
import { assertOwner, senderOf } from "../queue/common.js";
import { refusal } from "../queue/relay.js";
import { findFormula } from "./formulas.js";
import { rawList, startProject } from "./store.js";
import { itemLeads, overlay, playerStudy, readLedger, startStudy } from "../discovery/store.js";
import { itemKey, trackOf } from "../discovery/track.js";
import { W } from "../discovery/words.js";

let boundApi = null;
export function bind(api) { boundApi = api; }

const flagKey = `flags.${MODULE_ID}.${K.leadsFlag}`;
const projectIdFor = recipeId => `unlock-${recipeId}`;

/** The actor's valid leads (a damaged entry is skipped, loudly in the console), oldest first. */
export function readLeads(actor) {
  const list = [];
  for (const entry of rawList(actor, K.leadsFlag)) {
    const problems = check(LIVE_SCHEMAS.lead, entry);
    if (problems.length) console.error(`${MODULE_ID} | ${actor.name} has a damaged lead and it is skipped: ${problems.map(p => `${p.field} ${p.message}`).join("; ")}`, entry);
    else list.push(entry);
  }
  return list.sort((a, b) => a.at - b.at);
}

/** Why this recipe cannot be a new lead / a started project for the actor, or null. Plain words. */
function problemWith(actor, recipeId) {
  if (findFormula(rawList(actor, K.formulasFlag), recipeId)) return `${actor.name} already knows that formula.`;
  const project = rawList(actor, K.projectsFlag).find(p => p?.id === projectIdFor(recipeId));
  if (project?.status === "active") return `${actor.name} is already researching it.`;
  if (project?.status === "complete") return `${actor.name} has already learned it.`;
  return null;
}

/** GM only: hand a character a lead. `note` is plain text the player reads (at most HUB.research.leadNoteMax characters). */
export async function giveLead(api, actor, recipeId, note = "") {
  if (!game.user.isGM) throw new Error("giveLead: GM only");
  const recipe = api.definitions?.recipe.get(recipeId);
  if (!recipe) throw new Error(`giveLead: unknown recipe "${recipeId}"`);
  if (typeof note !== "string" || note.length > HUB.research.leadNoteMax) throw new Error(`giveLead: the note must be text of at most ${HUB.research.leadNoteMax} characters`);
  const problem = problemWith(actor, recipeId);
  if (problem) throw new Error(`giveLead: ${problem}`);
  return withLocks([actorKey(actor)], async () => {
    const leads = readLeads(actor);
    if (leads.some(l => l.recipeId === recipeId)) throw new Error(`giveLead: ${actor.name} already has a lead for "${recipe.name}"`);
    const entry = { id: foundry.utils.randomID(), recipeId, name: recipe.name, note, at: Date.now() };
    await actor.update({ [flagKey]: [...rawList(actor, K.leadsFlag), entry] });
    await logWorldEvent(`lead given: ${recipe.name} to ${actor.name}`);
    return entry;
  });
}

/**
 * On the GM client (also the socket handler): start researching a lead. Checks, in order and each with a plain reason: who is asking (the real sender, never an id
 * the client supplied) owns the character; the lead is on that character; the formula is not already known or being researched; the recipe still exists.
 */
export async function runFollowLead(payload, context) {
  const user = senderOf(payload, context);
  const actor = game.actors.get(payload?.actorId);
  if (!actor) throw refusal(`There is no character with id "${payload?.actorId}".`);
  assertOwner(actor, user, "follow a lead");
  if (!boundApi) throw new Error("leads: not bound to the module api yet");
  return withLocks([actorKey(actor)], async () => {
    // A lead that comes from an ITEM the character carries (a material or a note with a research track): the GM checks the inventory itself, the payload is only a name.
    if (typeof payload?.leadId === "string" && payload.leadId.startsWith("item:")) {
      const item = itemLeads(boundApi, actor).find(l => l.id === payload.leadId);
      if (!item) throw refusal(W.noSuchLead);
      const entry = await startStudy(boundApi, actor, payload.leadId.slice("item:".length));
      await logWorldEvent(`study followed: ${entry.name} by ${actor.name}`);
      return user.isGM ? entry : playerStudy(entry);
    }
    const lead = readLeads(actor).find(l => l.id === payload?.leadId);
    if (!lead) throw refusal(`${actor.name} has no such lead any more.`);
    const problem = problemWith(actor, lead.recipeId);
    if (problem) throw refusal(`${problem} The lead is already used up.`);
    if (!boundApi.definitions?.recipe.has(lead.recipeId)) throw refusal(`This lead points at "${lead.name}", which no longer exists. Ask the GM.`);
    // A higher version with its own research track is studied (milestones, thresholds the GM set on that version); one without goes through the ordinary project.
    const versionKey = itemKey("recipe", lead.recipeId);
    const hasOwnTrack = Boolean(trackOf(boundApi.definitions.recipe.get(lead.recipeId), overlay(), versionKey));
    if (hasOwnTrack && !readLedger(actor).items[versionKey]) {
      const entry = await startStudy(boundApi, actor, versionKey);
      try { await actor.update({ [flagKey]: rawList(actor, K.leadsFlag).filter(l => l?.id !== lead.id) }); } catch (error) { console.error(`${MODULE_ID} | the study started, but the lead could not be removed`, error); }
      await logWorldEvent(`lead followed: ${lead.name} by ${actor.name}`);
      return user.isGM ? entry : playerStudy(entry);
    }
    const project = await startProject(boundApi, { actor, recipe: lead.recipeId });
    try {
      await actor.update({ [flagKey]: rawList(actor, K.leadsFlag).filter(l => l?.id !== lead.id) });
    } catch (error) {
      console.error(`${MODULE_ID} | the project started, but the lead could not be removed (it stays and is shown as used up)`, error);
    }
    await logWorldEvent(`lead followed: ${lead.name} by ${actor.name}`);
    return user.isGM ? project : playerProject(project);
  });
}
