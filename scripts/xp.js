import { MODULE_ID, OUTCOME_XP, DEFAULT_XP, TIERS } from "./config.js";

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

/** Pull the skill, actor, and XP amount out of a PF2e skill-check chat message. */
export function parseSkillCheck(message) {
  const context = message.flags?.pf2e?.context;
  if (context?.type !== "skill-check") return null;

  const actor = message.actor;
  if (actor?.type !== "character") return null;

  const skill = (context.domains ?? []).find(d => CONFIG.PF2E?.skills?.[d]);
  const amount = OUTCOME_XP[context.outcome] ?? DEFAULT_XP;
  if (!skill) return null;

  return { actor, skill, amount, hasDc: context.dc?.value != null };
}

/** Automatic mode: award XP the moment a roll with a DC lands in chat. */
export async function handleChatMessage(message) {
  if (game.settings.get(MODULE_ID, "paused")) return;
  if (game.settings.get(MODULE_ID, "awardMode") !== "auto") return;

  // Only the roller's client does the award, so it runs exactly once.
  const authorId = message.author?.id ?? message.user?.id;
  if (authorId !== game.user.id) return;

  const check = parseSkillCheck(message);
  console.debug(`${MODULE_ID} | skill check`, check);
  // Free rolls with no DC earn nothing; this is the anti-farming rule.
  if (!check?.hasDc) return;

  await awardXp(check.actor, check.skill, check.amount);
}

/** GM mode: add a "Grant XP" button to skill-check cards, visible to the GM only. */
export function addGrantButton(message, html) {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, "awardMode") !== "gm") return;

  const check = parseSkillCheck(message);
  console.debug(`${MODULE_ID} | render card`, check, message.flags?.pf2e?.context);
  if (!check) return;

  const content = html.querySelector(".message-content") ?? html;

  const button = document.createElement("button");
  button.type = "button";
  if (message.getFlag(MODULE_ID, "granted")) {
    button.textContent = "XP granted";
    button.disabled = true;
  } else {
    button.textContent = `Grant +${check.amount} XP`;
    button.addEventListener("click", async () => {
      button.disabled = true; // stop double-clicks
      await message.setFlag(MODULE_ID, "granted", true);
      await awardXp(check.actor, check.skill, check.amount);
    });
  }
  content.append(button);
}
