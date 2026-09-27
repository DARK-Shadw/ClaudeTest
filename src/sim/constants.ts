/** Simulation steps per real second at 1x speed. */
export const TICKS_PER_SECOND = 10;
/** An in-game hour lasts 20 real seconds at 1x, so a day lasts 8 minutes. */
export const TICKS_PER_HOUR = 200;
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24;
/** Settlements are founded at 07:00 on day 1, the first day of spring. */
export const START_HOUR = 7;
export const DAYS_PER_SEASON = 5;

/** Every region is the same size so regions can tile into a shared world map later. */
export const MAP_W = 64;
export const MAP_H = 64;
export const MAP_N = MAP_W * MAP_H;

export const TERRAIN = { WATER: 0, SAND: 1, GRASS: 2, MOUNTAIN: 3 } as const;
export const FEATURE = { NONE: 0, TREE: 1, BUSH: 2, BOULDER: 3, ORE: 4 } as const;
export const ZONE = { NONE: 0, STOCKPILE: 1, POTATO: 2, HEALROOT: 3 } as const;
export const CROP = { NONE: 0, POTATO: 1, HEALROOT: 2 } as const;

/** Balance numbers. Tuned with `npm run balance`. */
export const B = {
  carryMax: 30,

  foodDecay: 100 / (TICKS_PER_DAY * 1.2),
  gluttonFoodMul: 1.4,
  hungryAt: 30,
  eatTicks: 25,
  cookWork: 50,
  rawPerMeal: 4,
  starveDamageEvery: 60,

  /** Sixteen hours awake cost a little over half of rest; eight hours in bed win it back. */
  restDecay: 100 / (TICKS_PER_DAY * 1.2),
  restGainBed: 100 / (TICKS_PER_HOUR * 13),
  restGainGround: 100 / (TICKS_PER_HOUR * 16),

  joyDecay: 100 / (TICKS_PER_DAY * 1.6),

  harvestWork: { tree: 70, bush: 30, boulder: 100, ore: 130 },
  harvestYield: { tree: 10, bush: 10, boulder: 10, ore: 8 },
  bushRegrow: Math.round(TICKS_PER_DAY * 1.5),
  sowWork: 18,
  /** Research points per unit of scholarly work: a whole tech tree takes one scholar a couple of weeks. */
  researchRate: 0.3,
  reapWork: 25,

  colonistHp: 100,
  toughMul: 0.7,
  wimpDownAt: 0.35,
  flankBonus: 0.05,
  /** Colonists within two tiles of the rally point hit more often and take less damage. */
  lineHitBonus: 0.12,
  lineDamageMul: 0.8,
  tacticsHitBonus: 0.1,
  towerRange: 3,
  towerHitBonus: 0.12,
  trapDmg: [35, 50] as const,
  /** Chance that the blow which drops a colonist kills them outright. */
  deathBlowChance: 0.15,
  toughDeathBlowChance: 0.07,
  /** Chance that a downed colonist is not bleeding and will recover alone. */
  stableChance: 0.2,
  toughStableChance: 0.4,
  bleedTicks: TICKS_PER_HOUR * 4,
  tendWork: 40,
  downedRecoverEvery: 15,
  downedRecoverEveryHerbs: 8,
  standUpHp: 20,
  regenEvery: 40,
  regenEveryBed: 15,

  raidWarning: TICKS_PER_HOUR * 8,
  wolfWarning: TICKS_PER_HOUR * 4,
  threatInterval: [Math.round(TICKS_PER_DAY * 1.5), Math.round(TICKS_PER_DAY * 2.3)] as const,
  raidMaxDuration: TICKS_PER_HOUR * 6,
  raidMaxSize: 16,
  stealMax: 20,
  weaponDropChance: 0.35,

  wandererInterval: [Math.round(TICKS_PER_DAY * 2), Math.round(TICKS_PER_DAY * 3.5)] as const,
  migrationInterval: [TICKS_PER_DAY * 3, TICKS_PER_DAY * 5] as const,
  maxColonists: 20,
  maxAnimals: 34,
};
