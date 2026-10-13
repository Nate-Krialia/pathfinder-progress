import { MODULE_ID, OUTCOME_XP, TIERS } from "./config.js";

export function getXp(actor, skill) {
  return actor.getFlag(MODULE_ID, "skillXp")?.[skill] ?? 0;
}

export function getTier(xp) {
  let tier = 0;
  TIERS.forEach((t, i) => { if (xp >= t.xp) tier = i; });
  return tier;
}

export async function awardXp(actor, skill, amount) {
  const before = getXp(actor, skill);
  const after = before + amount;
  await actor.update({ [`flags.${MODULE_ID}.skillXp.${skill}`]: after });

  const label = game.i18n.localize(CONFIG.PF2E?.skills?.[skill]?.label ?? skill);
  const tierBefore = getTier(before);
  const tierAfter = getTier(after);
  const next = TIERS[tierAfter + 1];
  const progress = next ? `${after}/${next.xp}` : `${after} (max)`;

  ui.notifications.info(`${actor.name}: ${label} +${amount} XP (${progress})`);
  if (tierAfter > tierBefore) {
    ui.notifications.info(`${actor.name} reached ${TIERS[tierAfter].name} in ${label}!`);
  }
}

/** Decide whether a chat message is an XP-worthy skill check, and award it. */
export async function handleChatMessage(message) {
  if (game.settings.get(MODULE_ID, "paused")) return;

  // Only the roller's client does the award, so it runs exactly once.
  const authorId = message.author?.id ?? message.user?.id;
  if (authorId !== game.user.id) return;

  const context = message.flags?.pf2e?.context;
  if (context?.type !== "skill-check") return;

  const actor = message.actor;
  if (actor?.type !== "character") return;

  // Free rolls with no DC earn nothing; this is the anti-farming rule.
  if (context.dc?.value == null) return;

  const skill = (context.domains ?? []).find(d => CONFIG.PF2E?.skills?.[d]);
  const amount = OUTCOME_XP[context.outcome];
  console.debug(`${MODULE_ID} | skill check`, { skill, outcome: context.outcome, amount });
  if (!skill || !amount) return;

  await awardXp(actor, skill, amount);
}
