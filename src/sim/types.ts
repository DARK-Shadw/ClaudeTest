import type { RngState } from './rng';

export type ItemType = 'wood' | 'stone' | 'berries' | 'meal';
export type BuildKind = 'wall' | 'stoneWall' | 'door' | 'bed' | 'campfire' | 'trap';
export type StructureKind = BuildKind | 'grave';

export type TraitId =
  | 'brave'
  | 'coward'
  | 'industrious'
  | 'lazy'
  | 'glutton'
  | 'optimist'
  | 'pessimist'
  | 'tough'
  | 'bloodlust'
  | 'greenThumb';

export type SkillId = 'build' | 'gather' | 'cook' | 'combat';
export type WorkType = 'build' | 'gather' | 'cook' | 'haul';
/** A colonist's focus: the work they pick first. */
export type Role = 'any' | WorkType;

export interface ItemStack {
  id: number;
  type: ItemType;
  count: number;
  tile: number;
}

export interface Structure {
  id: number;
  kind: StructureKind;
  tile: number;
  hp: number;
  maxHp: number;
  /** Pawn id for beds, 0 when unowned. */
  ownerId: number;
  /** Name on a grave. */
  label: string;
}

export interface Blueprint {
  id: number;
  kind: BuildKind;
  tile: number;
  delivered: number;
  work: number;
}

/** A remembered event that colours a colonist's mood until it expires. */
export interface Memory {
  key: string;
  label: string;
  mood: number;
  until: number;
}

/** Palette indices; the renderer owns the actual colours. */
export interface Look {
  skin: number;
  shirt: number;
  hair: number;
}

export interface Carry {
  type: ItemType;
  count: number;
}

export type Job =
  | { kind: 'harvest'; tile: number; progress: number }
  | { kind: 'haul'; itemId: number; dest: number; stage: 'fetch' | 'drop' }
  | { kind: 'deliver'; bpId: number; itemId: number; amount: number; stage: 'fetch' | 'drop' }
  | { kind: 'build'; bpId: number }
  | { kind: 'decon'; tile: number; progress: number }
  | { kind: 'cook'; stationId: number; itemId: number; stage: 'fetch' | 'cook'; progress: number }
  | { kind: 'eat'; itemId: number; progress: number }
  | { kind: 'sleep'; bedId: number; asleep: boolean }
  | { kind: 'tend'; targetId: number; progress: number }
  | { kind: 'fight'; targetId: number; repathAt: number }
  | { kind: 'bash'; structureId: number }
  | { kind: 'flee'; until: number }
  | { kind: 'rally'; until: number }
  | { kind: 'wander'; until: number }
  | { kind: 'steal'; itemId: number }
  | { kind: 'leave' };

export type JobKind = Job['kind'];
export type PawnKind = 'colonist' | 'goblin';
export type Life = 'ok' | 'downed' | 'dead';

export interface Pawn {
  id: number;
  kind: PawnKind;
  name: string;
  /** Logical tile. While walking this is already the destination of the current step. */
  x: number;
  y: number;
  /** Tile the current step started from, for smooth rendering. */
  fromX: number;
  fromY: number;
  moveT: number;
  moveDur: number;
  path: number[];
  hp: number;
  maxHp: number;
  life: Life;
  /** Ticks left before a downed colonist bleeds out; 0 means stable. */
  bleed: number;
  /** Raiders that walked off the map. Removed at the end of the tick. */
  gone: boolean;
  attackCd: number;
  lastAttackTick: number;
  hitTick: number;
  faceX: number;
  faceY: number;
  food: number;
  rest: number;
  mood: number;
  memories: Memory[];
  traits: TraitId[];
  skills: Record<SkillId, number>;
  backstory: string;
  role: Role;
  job: Job | null;
  /** Earliest tick to plan again after a failed job. */
  thinkAt: number;
  carry: Carry | null;
  mental: { until: number } | null;
  look: Look;
  bedId: number;
  raidId: number;
  /** Goblin looters grab supplies and run; the rest hunt colonists. */
  looter: boolean;
  kills: number;
}

export interface Raid {
  id: number;
  phase: 'incoming' | 'active';
  warnTick: number;
  arriveTick: number;
  size: number;
  edge: number;
  retreat: boolean;
  slain: number;
  stolen: number;
  escapedLoot: number;
}

export type LogKind = 'info' | 'good' | 'warn' | 'bad' | 'death' | 'raid';

export interface LogEntry {
  id: number;
  tick: number;
  kind: LogKind;
  text: string;
  /** Chronicle entries are the settlement's history: foundings, raids, deaths, arrivals. */
  chronicle: boolean;
}

export interface Fallen {
  name: string;
  tick: number;
  cause: string;
}

/**
 * The whole simulation is plain JSON-safe data. Saving is JSON.stringify, and a server can
 * run the same step() on the same state to stay in lockstep with a phone.
 */
export interface SimState {
  version: 1;
  seed: number;
  rng: RngState;
  tick: number;
  nextId: number;
  nextLogId: number;

  terrain: number[];
  feature: number[];
  /** Tick when a harvested bush has berries again. */
  regrow: number[];
  /** Player orders: harvest here. Bush orders stay, so bushes are picked again once they regrow. */
  designated: number[];
  /** Player orders: take this structure apart. */
  decon: number[];
  /** Stockpile zone. */
  zone: number[];
  structGrid: number[];
  structKind: number[];
  bpGrid: number[];
  itemGrid: number[];

  pawns: Pawn[];
  items: ItemStack[];
  structures: Structure[];
  blueprints: Blueprint[];

  raid: Raid | null;
  raidCount: number;
  nextRaidTick: number;
  nextWandererTick: number;
  rally: number;
  home: number;

  log: LogEntry[];
  fallen: Fallen[];
  over: boolean;

  /** Bumped when anything drawn on the static board changes (features, structures, zones, orders). */
  structVersion: number;
  itemVersion: number;
}
