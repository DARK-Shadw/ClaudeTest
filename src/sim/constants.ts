import type { BuildKind, ItemType, StructureKind } from './types';

/** Simulation steps per real second at 1x speed. */
export const TICKS_PER_SECOND = 10;
/** An in-game hour lasts 20 real seconds at 1x, so a day lasts 8 minutes. */
export const TICKS_PER_HOUR = 200;
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24;
/** Settlements are founded at 07:00 on day 1. */
export const START_HOUR = 7;

/** Every region is the same size so regions can tile into a shared world map later. */
export const MAP_W = 48;
export const MAP_H = 48;
export const MAP_N = MAP_W * MAP_H;

export const TERRAIN = { WATER: 0, SAND: 1, GRASS: 2, MOUNTAIN: 3 } as const;
export const FEATURE = { NONE: 0, TREE: 1, BUSH: 2, BOULDER: 3 } as const;

/** Per-tile structure codes, kept in a grid so pathfinding never has to look structures up. */
export const SK = { NONE: 0, WALL: 1, STONE_WALL: 2, DOOR: 3, BED: 4, CAMPFIRE: 5, TRAP: 6, GRAVE: 7 } as const;

export const STRUCT_CODE: Record<StructureKind, number> = {
  wall: SK.WALL,
  stoneWall: SK.STONE_WALL,
  door: SK.DOOR,
  bed: SK.BED,
  campfire: SK.CAMPFIRE,
  trap: SK.TRAP,
  grave: SK.GRAVE,
};

export interface StructureSpec {
  label: string;
  material: ItemType;
  cost: number;
  /** Work units needed to build. A colonist with average skill does about 1 unit per tick. */
  work: number;
  hp: number;
  /** Solid structures block colonists; raiders have to smash through them. */
  solid: boolean;
}

export const STRUCTURES: Record<BuildKind, StructureSpec> = {
  wall: { label: 'Wall', material: 'wood', cost: 3, work: 40, hp: 160, solid: true },
  stoneWall: { label: 'Stone wall', material: 'stone', cost: 4, work: 70, hp: 420, solid: true },
  door: { label: 'Door', material: 'wood', cost: 4, work: 50, hp: 110, solid: false },
  bed: { label: 'Bed', material: 'wood', cost: 6, work: 60, hp: 80, solid: false },
  campfire: { label: 'Campfire', material: 'wood', cost: 5, work: 45, hp: 60, solid: true },
  trap: { label: 'Spike trap', material: 'wood', cost: 4, work: 35, hp: 40, solid: false },
};

export const ITEM_LABEL: Record<ItemType, string> = {
  wood: 'Wood',
  stone: 'Stone',
  berries: 'Berries',
  meal: 'Meals',
};

export const STACK_MAX: Record<ItemType, number> = { wood: 60, stone: 60, berries: 40, meal: 20 };

/** Balance numbers. Tuned with `npm run balance`. */
export const B = {
  carryMax: 30,

  foodDecay: 100 / (TICKS_PER_DAY * 1.2),
  gluttonFoodMul: 1.4,
  hungryAt: 30,
  mealNutrition: 55,
  berryNutrition: 8,
  berriesPerMeal: 4,
  eatTicks: 25,
  cookWork: 50,
  starveDamageEvery: 60,

  restDecay: 100 / (TICKS_PER_DAY * 1.1),
  restGainBed: 100 / (TICKS_PER_HOUR * 7),
  restGainGround: 100 / (TICKS_PER_HOUR * 9),

  harvestWork: { tree: 70, bush: 30, boulder: 100 },
  harvestYield: { tree: 10, bush: 10, boulder: 10 },
  bushRegrow: Math.round(TICKS_PER_DAY * 1.5),

  colonistHp: 100,
  goblinHp: 55,
  colonistDmg: [8, 14] as const,
  goblinDmg: [6, 11] as const,
  colonistAttackCd: 11,
  goblinAttackCd: 12,
  trapDmg: [35, 50] as const,
  toughMul: 0.7,
  /** Hit chance added for each other attacker already next to the target. */
  flankBonus: 0.05,
  /** Colonists within two tiles of the rally point hit more often and take less damage. */
  lineHitBonus: 0.12,
  lineDamageMul: 0.8,
  /** Chance that the blow which drops a colonist kills them outright. */
  deathBlowChance: 0.15,
  toughDeathBlowChance: 0.07,
  /** Chance that a downed colonist is not bleeding and will recover alone. */
  stableChance: 0.2,
  toughStableChance: 0.4,
  bleedTicks: TICKS_PER_HOUR * 4,
  tendWork: 40,
  downedRecoverEvery: 15,
  standUpHp: 20,
  regenEvery: 40,
  regenEveryBed: 15,

  raidWarning: TICKS_PER_HOUR * 8,
  raidInterval: [Math.round(TICKS_PER_DAY * 1.8), Math.round(TICKS_PER_DAY * 2.6)] as const,
  raidMaxDuration: TICKS_PER_HOUR * 5,
  raidMaxSize: 12,
  stealMax: 20,

  wandererInterval: [Math.round(TICKS_PER_DAY * 2.5), TICKS_PER_DAY * 4] as const,
  maxColonists: 8,
};
