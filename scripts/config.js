export const MODULE_ID = "pathfinder-progress";

// XP awarded per check, by degree of success. Failures teach more than easy wins.
export const OUTCOME_XP = {
  criticalFailure: 3,
  failure: 2,
  success: 1,
  criticalSuccess: 2
};

// Total XP needed to reach each mastery tier (tier 0 starts at 0 XP).
export const TIERS = [
  { name: "Novice", xp: 0 },
  { name: "Practiced", xp: 25 },
  { name: "Adept", xp: 75 },
  { name: "Expert", xp: 150 },
  { name: "Master", xp: 300 }
];
