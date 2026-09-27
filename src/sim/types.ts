import type { RngState } from './rng';

export type ItemType =
  | 'wood'
  | 'stone'
  | 'iron'
  | 'leather'
  | 'berries'
  | 'potato'
  | 'meat'
  | 'herbs'
  | 'meal'
  | 'fineMeal'
  | 'club'
  | 'spear'
  | 'sword'
  | 'bow'
  | 'leatherArmor'
  | 'ironArmor';

export type BuildKind =
  | 'wall'
  | 'stoneWall'
  | 'door'
  | 'bed'
  | 'table'
  | 'stool'
  | 'torch'
  | 'campfire'
  | 'stove'
  | 'craftBench'
  | 'researchDesk'
  | 'horseshoes'
  | 'chessTable'
  | 'plantPot'
  | 'statue'
  | 'trap'
  | 'barricade'
  | 'tower';
export type StructureKind = BuildKind | 'grave';
export type FloorKind = 'woodFloor' | 'stoneFloor' | 'carpet';
export type BlueprintKind = BuildKind | FloorKind;
export type BuildCategory = 'structure' | 'furniture' | 'production' | 'fun' | 'decor' | 'defense' | 'floor';

export type TechId = 'archery' | 'masonry' | 'cooking' | 'medicine' | 'games' | 'decoration' | 'smithing' | 'tactics';
export type CraftItem = 'club' | 'spear' | 'sword' | 'bow' | 'leatherArmor' | 'ironArmor';
export type WeaponId = 'fists' | 'club' | 'spear' | 'sword' | 'bow' | 'maul' | 'axe' | 'bite' | 'tusk' | 'hoof' | 'nibble';
export type ArmorId = 'none' | 'leatherArmor' | 'ironArmor';
export type Species = 'deer' | 'hare' | 'boar' | 'wolf';
export type GoblinUnit = 'fighter' | 'archer' | 'brute' | 'chief';
export type CropKind = 'potato' | 'healroot';

export type TraitId =
  | 'brave'
  | 'coward'
  | 'bloodlust'
  | 'tough'
  | 'wimp'
  | 'nimble'
  | 'fastWalker'
  | 'industrious'
  | 'lazy'
  | 'glutton'
  | 'ascetic'
  | 'optimist'
  | 'pessimist'
  | 'kind'
  | 'abrasive'
  | 'greedy'
  | 'nightOwl'
  | 'greenThumb'
  | 'beautiful'
  | 'ugly'
  | 'tooSmart'
  | 'ironWilled'
  | 'volatile'
  | 'coldHearted';

export type SkillId =
  | 'melee'
  | 'shooting'
  | 'construction'
  | 'mining'
  | 'plants'
  | 'cooking'
  | 'crafting'
  | 'medicine'
  | 'social'
  | 'intellect';

export type WorkType = 'build' | 'farm' | 'gather' | 'cook' | 'craft' | 'hunt' | 'research' | 'haul';
/** A colonist's focus: the work they pick first. */
export type Role = 'any' | WorkType;
/** 0 none, 1 interested, 2 burning passion. */
export type Passion = 0 | 1 | 2;
export type Incapable = 'violence' | 'dumb';
export type RelationKind = 'lover' | 'spouse' | 'sibling' | 'parent' | 'child' | 'friend' | 'rival' | 'ex';
export type JoyKind = 'campfire' | 'stargaze' | 'horseshoes' | 'chess' | 'statue' | 'walk';

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
  kind: BlueprintKind;
  floor: boolean;
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

/** A remembered event that colours how one colonist feels about another. */
export interface SocialMemory {
  id: number;
  key: string;
  label: string;
  value: number;
  until: number;
}

export interface Relation {
  id: number;
  kind: RelationKind;
  since: number;
}

export interface StoryEntry {
  tick: number;
  text: string;
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

export interface Mental {
  kind: 'daze' | 'brawl';
  until: number;
  targetId: number;
}

export type Job =
  | { kind: 'harvest'; tile: number; progress: number }
  | { kind: 'haul'; itemId: number; dest: number; stage: 'fetch' | 'drop' }
  | { kind: 'deliver'; bpId: number; itemId: number; amount: number; stage: 'fetch' | 'drop' }
  | { kind: 'build'; bpId: number }
  | { kind: 'decon'; tile: number; progress: number }
  | { kind: 'sow'; tile: number; progress: number }
  | { kind: 'reap'; tile: number; progress: number }
  | { kind: 'cook'; stationId: number; stage: 'fetch' | 'cook'; progress: number; fine: boolean }
  | { kind: 'craft'; benchId: number; item: CraftItem; stage: 'fetch' | 'work'; progress: number }
  | { kind: 'research'; deskId: number; until: number }
  | { kind: 'equip'; itemId: number }
  | { kind: 'eat'; itemId: number; stage: 'fetch' | 'table' | 'eat'; progress: number; table: number }
  | { kind: 'sleep'; bedId: number; asleep: boolean }
  | { kind: 'joy'; joy: JoyKind; target: number; until: number }
  | { kind: 'tend'; targetId: number; progress: number; ordered: boolean }
  | { kind: 'fight'; targetId: number; repathAt: number; ordered: boolean }
  | { kind: 'hunt'; targetId: number; repathAt: number }
  | { kind: 'bash'; structureId: number }
  | { kind: 'flee'; until: number }
  | { kind: 'rally'; until: number }
  | { kind: 'wander'; until: number }
  | { kind: 'goto'; tile: number }
  | { kind: 'hold' }
  | { kind: 'steal'; itemId: number }
  | { kind: 'leave' };

export type JobKind = Job['kind'];
export type PawnKind = 'colonist' | 'goblin' | 'animal';
export type Life = 'ok' | 'downed' | 'dead';

export interface Pawn {
  id: number;
  kind: PawnKind;
  name: string;
  species: Species | '';
  unit: GoblinUnit | '';
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
  /** Who last hurt this pawn. Animals fight back or flee from them. */
  lastHitBy: number;
  /** Last arrow loosed: when, and at which tile. Drawn by the renderer. */
  shotTick: number;
  shotTo: number;
  faceX: number;
  faceY: number;
  food: number;
  rest: number;
  joy: number;
  mood: number;
  memories: Memory[];
  traits: TraitId[];
  skills: Record<SkillId, number>;
  xp: Record<SkillId, number>;
  passions: Record<SkillId, Passion>;
  incapable: Incapable[];
  age: number;
  /** What they did last, e.g. "Carpenter". */
  calling: string;
  childhood: string;
  adulthood: string;
  story: StoryEntry[];
  social: SocialMemory[];
  relations: Relation[];
  role: Role;
  job: Job | null;
  /** Earliest tick to plan again after a failed job. */
  thinkAt: number;
  /** Next tick to look for better gear. */
  gearAt: number;
  /** Next tick this colonist may strike up a conversation. */
  socialAt: number;
  carry: Carry | null;
  weapon: WeaponId;
  armor: ArmorId;
  drafted: boolean;
  mental: Mental | null;
  look: Look;
  bedId: number;
  raidId: number;
  /** Goblin looters grab supplies and run; the rest hunt colonists. */
  looter: boolean;
  chiefId: number;
  /** A chief this colonist has sworn revenge on. */
  grudge: number;
  /** Animals that are part of an attack on the settlement. */
  hostile: boolean;
  /** Animals marked for hunting. */
  marked: boolean;
  kills: number;
}

export interface Chief {
  id: number;
  name: string;
  title: string;
  warband: string;
  level: number;
  kills: string[];
  alive: boolean;
  escapes: number;
  scarred: boolean;
}

export interface Raid {
  id: number;
  kind: 'goblins' | 'wolves';
  units: GoblinUnit[];
  phase: 'incoming' | 'active';
  warnTick: number;
  arriveTick: number;
  size: number;
  edge: number;
  retreat: boolean;
  slain: number;
  stolen: number;
  escapedLoot: number;
  chiefId: number;
}

export type LogKind = 'info' | 'good' | 'warn' | 'bad' | 'death' | 'raid' | 'social';

export interface LogEntry {
  id: number;
  tick: number;
  kind: LogKind;
  text: string;
  /** Chronicle entries are the settlement's history: foundings, raids, deaths, arrivals. */
  chronicle: boolean;
}

export interface Fallen {
  id: number;
  name: string;
  tick: number;
  cause: string;
}

export interface Research {
  current: TechId | '';
  progress: Record<TechId, number>;
  done: TechId[];
}

/**
 * The whole simulation is plain JSON-safe data. Saving is JSON.stringify, and a server can
 * run the same step() on the same state to stay in lockstep with a phone.
 */
export interface SimState {
  version: 2;
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
  /** 1 stockpile, 2 potato field, 3 healroot field. */
  zone: number[];
  /** Built floor code per tile. */
  floor: number[];
  /** Crop code growing on a tile, and its growth out of 1000. */
  plant: number[];
  growth: number[];
  structGrid: number[];
  structKind: number[];
  bpGrid: number[];
  floorBpGrid: number[];
  itemGrid: number[];

  pawns: Pawn[];
  items: ItemStack[];
  structures: Structure[];
  blueprints: Blueprint[];

  raid: Raid | null;
  raidCount: number;
  nextThreatTick: number;
  nextWandererTick: number;
  nextMigrationTick: number;
  chiefs: Chief[];
  research: Research;
  /** Crafters keep this many of each item in stock. */
  orders: Record<CraftItem, number>;
  rally: number;
  home: number;

  log: LogEntry[];
  fallen: Fallen[];
  over: boolean;

  /** Bumped when anything drawn on the static board changes (features, structures, zones, orders). */
  structVersion: number;
  itemVersion: number;
}
