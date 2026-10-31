/**
 * Every word the discovery chain shows a player (Stage 11c). Plain words only: no thresholds, counts, DCs or odds (docs/11b-hub-addendum.md, which
 * the tests enforce by scanning this object).
 */
export const W = {
  stages: ["Just started", "Getting somewhere", "Nearly there"],
  studyGoal: name => `Studying ${name}.`,
  studyName: name => `Study: ${name}`,
  leadItem: name => `You carry ${name} and haven't studied it yet.`,
  leadNote: name => `You hold ${name} and haven't studied it yet.`,
  leadVersion: tag => `What you have learned about ${tag} materials shows how to make a better version.`,
  learnedProperties: (name, tag, theme) => `You've learned what ${name} is good for${tag ? `: ${tag}, a theme of ${theme}` : ""}.`,
  learnedFormula: name => `You've learned the formula for ${name}.`,
  needItem: name => `You need ${name} in hand to study it.`,
  trackGone: name => `There is nothing more to learn from ${name} right now.`,
  notStudied: name => `You haven't studied ${name} enough to craft with it yet.`,
  alreadyStudying: name => `You are already studying ${name}.`,
  alreadyStudied: name => `You have already studied ${name}.`,
  noSuchLead: "That lead is gone: you no longer hold the item, or it has been studied.",
  summary: (actor, name, degrees) => `${actor} studies ${name}: ${degrees.join(", ")}.`
};
