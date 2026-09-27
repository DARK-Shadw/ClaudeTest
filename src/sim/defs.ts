/** Game content: every item, building, weapon, recipe, technology, animal and crop. */
import type {
  ArmorId,
  BlueprintKind,
  BuildCategory,
  BuildKind,
  CraftItem,
  CropKind,
  FloorKind,
  ItemType,
  SkillId,
  Species,
  StructureKind,
  TechId,
  WeaponId,
  WorkType,
} from './types';

// Items

export type ItemGroup = 'material' | 'food' | 'meal' | 'medicine' | 'weapon' | 'armor';

export interface ItemSpec {
  label: string;
  stack: number;
  group: ItemGroup;
  nutrition?: number;
  /** Rough worth, used to size raids against how rich the settlement is. */
  value: number;
}

export const ITEMS: Record<ItemType, ItemSpec> = {
  wood: { label: 'Wood', stack: 75, group: 'material', value: 1 },
  stone: { label: 'Stone', stack: 75, group: 'material', value: 1 },
  iron: { label: 'Iron', stack: 75, group: 'material', value: 3 },
  leather: { label: 'Leather', stack: 50, group: 'material', value: 2 },
  berries: { label: 'Berries', stack: 50, group: 'food', nutrition: 8, value: 1 },
  potato: { label: 'Potatoes', stack: 50, group: 'food', nutrition: 8, value: 1 },
  meat: { label: 'Meat', stack: 50, group: 'food', nutrition: 10, value: 2 },
  herbs: { label: 'Healroot', stack: 30, group: 'medicine', value: 4 },
  meal: { label: 'Simple meal', stack: 20, group: 'meal', nutrition: 55, value: 5 },
  fineMeal: { label: 'Fine meal', stack: 20, group: 'meal', nutrition: 60, value: 8 },
  club: { label: 'Club', stack: 5, group: 'weapon', value: 15 },
  spear: { label: 'Spear', stack: 5, group: 'weapon', value: 20 },
  sword: { label: 'Sword', stack: 5, group: 'weapon', value: 60 },
  bow: { label: 'Short bow', stack: 5, group: 'weapon', value: 40 },
  leatherArmor: { label: 'Leather armor', stack: 5, group: 'armor', value: 40 },
  ironArmor: { label: 'Iron armor', stack: 5, group: 'armor', value: 90 },
};

export const RAW_FOODS: readonly ItemType[] = ['berries', 'potato', 'meat'];

// Technology

export interface TechSpec {
  label: string;
  cost: number;
  desc: string;
  requires?: TechId;
}

export const TECHS: Record<TechId, TechSpec> = {
  archery: { label: 'Archery', cost: 1800, desc: 'Short bows at the crafting bench, and watchtowers.' },
  masonry: { label: 'Masonry', cost: 1400, desc: 'Stone floors, barricades of stone and plant pots.' },
  cooking: { label: 'Cooking', cost: 1400, desc: 'Stoves, where a skilled cook (Cooking 5+) makes fine meals.' },
  medicine: { label: 'Herbal medicine', cost: 1200, desc: 'Healroot fields. Wounds treated with healroot mend twice as fast.' },
  games: { label: 'Games', cost: 1000, desc: 'Chess tables for clever minds.' },
  decoration: { label: 'Decoration', cost: 1800, requires: 'masonry', desc: 'Statues and carpets.' },
  smithing: { label: 'Smithing', cost: 2800, desc: 'Swords and iron armor, forged from iron ore.' },
  tactics: { label: 'Tactics', cost: 2400, requires: 'archery', desc: 'Drafted settlers fight in formation and hit 10% more often.' },
};

export const TECH_ORDER: readonly TechId[] = ['archery', 'masonry', 'cooking', 'medicine', 'games', 'decoration', 'smithing', 'tactics'];

// Buildings

export interface BuildingSpec {
  label: string;
  category: BuildCategory;
  material: ItemType;
  cost: number;
  /** Work units needed to build. A colonist with average skill does about 1 unit per tick. */
  work: number;
  hp: number;
  /** Blocks movement. Raiders have to smash through it. */
  solid: boolean;
  /** Extra walking cost for stepping over it. */
  slow: number;
  beauty: number;
  /** Beauty spread to every tile within this radius. */
  radius: number;
  light: number;
  tech?: TechId;
  desc: string;
}

const building = (
  label: string,
  category: BuildCategory,
  material: ItemType,
  cost: number,
  work: number,
  hp: number,
  desc: string,
  extra: Partial<BuildingSpec> = {},
): BuildingSpec => ({ label, category, material, cost, work, hp, desc, solid: false, slow: 0, beauty: 0, radius: 0, light: 0, ...extra });

export const BUILDINGS: Record<BuildKind, BuildingSpec> = {
  wall: building('Wall', 'structure', 'wood', 3, 40, 160, 'Stops goblins until smashed', { solid: true }),
  stoneWall: building('Stone wall', 'structure', 'stone', 4, 70, 420, 'Takes far longer to smash', { solid: true }),
  door: building('Door', 'structure', 'wood', 4, 50, 110, 'Settlers pass, goblins bash'),
  bed: building('Bed', 'furniture', 'wood', 6, 60, 80, 'Better sleep and faster healing', { slow: 4, beauty: 1 }),
  table: building('Table', 'furniture', 'wood', 6, 50, 70, 'Nobody likes eating off the floor', { slow: 6, beauty: 1 }),
  stool: building('Stool', 'furniture', 'wood', 3, 30, 40, 'A seat by the table or the fire', { slow: 3, beauty: 1 }),
  torch: building('Torch', 'furniture', 'wood', 2, 20, 30, 'Lights the dark around it', { slow: 2, beauty: 1, light: 5 }),
  campfire: building('Campfire', 'production', 'wood', 5, 45, 60, 'Cooks simple meals, gathers people at night', {
    solid: true,
    light: 4,
  }),
  stove: building('Stove', 'production', 'stone', 20, 120, 180, 'Fine meals, if the cook knows how (Cooking 5+)', {
    solid: true,
    light: 2,
    tech: 'cooking',
  }),
  craftBench: building('Crafting bench', 'production', 'wood', 20, 120, 120, 'Makes weapons and armor', { solid: true }),
  researchDesk: building('Research desk', 'production', 'wood', 20, 120, 100, 'Scholars study new ideas here', { solid: true }),
  horseshoes: building('Horseshoes pin', 'fun', 'wood', 6, 40, 50, 'A game for idle evenings', { slow: 2 }),
  chessTable: building('Chess table', 'fun', 'wood', 12, 80, 60, 'Clever settlers love a game', {
    slow: 6,
    beauty: 2,
    tech: 'games',
  }),
  plantPot: building('Plant pot', 'decor', 'stone', 4, 40, 40, 'A little green indoors', { slow: 3, beauty: 4, tech: 'masonry' }),
  statue: building('Statue', 'decor', 'stone', 25, 300, 200, 'Makes everything around it prettier', {
    solid: true,
    beauty: 6,
    radius: 4,
    tech: 'decoration',
  }),
  trap: building('Spike trap', 'defense', 'wood', 4, 35, 40, 'Wounds the first goblin to step on it'),
  barricade: building('Barricade', 'defense', 'wood', 5, 40, 150, 'Cover for archers; slows anyone climbing it', {
    slow: 12,
    beauty: -1,
  }),
  tower: building('Watchtower', 'defense', 'wood', 30, 200, 250, 'Archers on top shoot farther and truer', {
    slow: 6,
    tech: 'archery',
  }),
};

export const BUILD_ORDER: readonly BuildKind[] = [
  'wall',
  'stoneWall',
  'door',
  'bed',
  'table',
  'stool',
  'torch',
  'campfire',
  'stove',
  'craftBench',
  'researchDesk',
  'horseshoes',
  'chessTable',
  'plantPot',
  'statue',
  'trap',
  'barricade',
  'tower',
];

/** Per-tile structure codes, kept in a grid so pathfinding never has to look structures up. */
export const STRUCTURE_KINDS: readonly StructureKind[] = ['grave', ...BUILD_ORDER];
export const STRUCT_CODE = Object.fromEntries(STRUCTURE_KINDS.map((k, i) => [k, i + 1])) as Record<StructureKind, number>;
export const CODE_KIND: ReadonlyArray<StructureKind | ''> = ['', ...STRUCTURE_KINDS];

export interface FloorSpec {
  label: string;
  material: ItemType;
  cost: number;
  work: number;
  beauty: number;
  tech?: TechId;
  desc: string;
}

export const FLOORS: Record<FloorKind, FloorSpec> = {
  woodFloor: { label: 'Wood floor', material: 'wood', cost: 1, work: 12, beauty: 1, desc: 'Faster walking, a little prettier' },
  stoneFloor: { label: 'Stone tiles', material: 'stone', cost: 1, work: 18, beauty: 2, tech: 'masonry', desc: 'Sturdy and handsome' },
  carpet: { label: 'Carpet', material: 'leather', cost: 1, work: 15, beauty: 3, tech: 'decoration', desc: 'Soft, warm and lovely' },
};

export const FLOOR_ORDER: readonly FloorKind[] = ['woodFloor', 'stoneFloor', 'carpet'];
export const FLOOR_CODE: Record<FloorKind, number> = { woodFloor: 1, stoneFloor: 2, carpet: 3 };
export const CODE_FLOOR: ReadonlyArray<FloorKind | ''> = ['', 'woodFloor', 'stoneFloor', 'carpet'];

export const isFloorKind = (k: BlueprintKind): k is FloorKind => k in FLOORS;

/** Material, amount and work for any blueprint. */
export function blueprintSpec(kind: BlueprintKind): { label: string; material: ItemType; cost: number; work: number; tech?: TechId } {
  return isFloorKind(kind) ? FLOORS[kind] : BUILDINGS[kind];
}

// Combat

export interface WeaponSpec {
  label: string;
  dmg: readonly [number, number];
  /** Ticks between blows or shots. */
  cd: number;
  /** 1 for melee. */
  range: number;
  item?: CraftItem;
  tier: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  fists: { label: 'Fists', dmg: [4, 8], cd: 10, range: 1, tier: 0 },
  club: { label: 'Club', dmg: [8, 13], cd: 11, range: 1, item: 'club', tier: 1 },
  spear: { label: 'Spear', dmg: [10, 16], cd: 13, range: 1, item: 'spear', tier: 2 },
  sword: { label: 'Sword', dmg: [13, 19], cd: 11, range: 1, item: 'sword', tier: 3 },
  bow: { label: 'Short bow', dmg: [8, 13], cd: 20, range: 8, item: 'bow', tier: 2 },
  maul: { label: 'Maul', dmg: [15, 24], cd: 17, range: 1, tier: 3 },
  axe: { label: 'War axe', dmg: [12, 20], cd: 12, range: 1, tier: 3 },
  bite: { label: 'Bite', dmg: [7, 12], cd: 12, range: 1, tier: 1 },
  tusk: { label: 'Tusks', dmg: [9, 15], cd: 14, range: 1, tier: 1 },
  hoof: { label: 'Hooves', dmg: [4, 8], cd: 14, range: 1, tier: 0 },
  nibble: { label: 'Teeth', dmg: [1, 3], cd: 12, range: 1, tier: 0 },
};

export interface ArmorSpec {
  label: string;
  /** Damage taken is multiplied by this. */
  mul: number;
  /** Walking takes this much longer. */
  slow: number;
  item?: CraftItem;
}

export const ARMORS: Record<ArmorId, ArmorSpec> = {
  none: { label: 'No armor', mul: 1, slow: 1 },
  leatherArmor: { label: 'Leather armor', mul: 0.8, slow: 1, item: 'leatherArmor' },
  ironArmor: { label: 'Iron armor', mul: 0.62, slow: 1.1, item: 'ironArmor' },
};

export interface RecipeSpec {
  material: ItemType;
  cost: number;
  work: number;
  tech?: TechId;
}

export const RECIPES: Record<CraftItem, RecipeSpec> = {
  club: { material: 'wood', cost: 12, work: 100 },
  spear: { material: 'wood', cost: 15, work: 140 },
  bow: { material: 'wood', cost: 20, work: 180, tech: 'archery' },
  sword: { material: 'iron', cost: 15, work: 260, tech: 'smithing' },
  leatherArmor: { material: 'leather', cost: 15, work: 180 },
  ironArmor: { material: 'iron', cost: 25, work: 320, tech: 'smithing' },
};

export const CRAFT_ORDER: readonly CraftItem[] = ['club', 'spear', 'bow', 'sword', 'leatherArmor', 'ironArmor'];

// Nature

export interface SpeciesSpec {
  label: string;
  hp: number;
  /** Walking-time multiplier: lower is faster. */
  speed: number;
  weapon: WeaponId;
  meat: number;
  leather: number;
  temper: 'skittish' | 'defensive' | 'predator';
}

export const SPECIES: Record<Species, SpeciesSpec> = {
  deer: { label: 'Deer', hp: 60, speed: 0.85, weapon: 'hoof', meat: 28, leather: 6, temper: 'skittish' },
  hare: { label: 'Hare', hp: 16, speed: 0.7, weapon: 'nibble', meat: 6, leather: 1, temper: 'skittish' },
  boar: { label: 'Boar', hp: 80, speed: 0.95, weapon: 'tusk', meat: 24, leather: 5, temper: 'defensive' },
  wolf: { label: 'Wolf', hp: 55, speed: 0.7, weapon: 'bite', meat: 16, leather: 5, temper: 'predator' },
};

export interface CropSpec {
  label: string;
  growDays: number;
  yield: number;
  item: ItemType;
  tech?: TechId;
}

export const CROPS: Record<CropKind, CropSpec> = {
  potato: { label: 'Potatoes', growDays: 3, yield: 10, item: 'potato' },
  healroot: { label: 'Healroot', growDays: 5, yield: 3, item: 'herbs', tech: 'medicine' },
};

export const CROP_BY_CODE: ReadonlyArray<CropKind | ''> = ['', 'potato', 'healroot'];

// Skills and work

export const SKILLS: readonly SkillId[] = [
  'melee',
  'shooting',
  'construction',
  'mining',
  'plants',
  'cooking',
  'crafting',
  'medicine',
  'social',
  'intellect',
];

export const SKILL_LABEL: Record<SkillId, string> = {
  melee: 'Melee',
  shooting: 'Shooting',
  construction: 'Construction',
  mining: 'Mining',
  plants: 'Plants',
  cooking: 'Cooking',
  crafting: 'Crafting',
  medicine: 'Medicine',
  social: 'Social',
  intellect: 'Intellect',
};

/** The skill that decides how well each kind of work goes. */
export const WORK_SKILL: Record<WorkType, SkillId | ''> = {
  build: 'construction',
  farm: 'plants',
  gather: 'plants',
  cook: 'cooking',
  craft: 'crafting',
  hunt: 'shooting',
  research: 'intellect',
  haul: '',
};

export const WORK_LABEL: Record<WorkType, string> = {
  build: 'Build',
  farm: 'Farm',
  gather: 'Gather',
  cook: 'Cook',
  craft: 'Craft',
  hunt: 'Hunt',
  research: 'Research',
  haul: 'Haul',
};

export const WORK_TYPES: readonly WorkType[] = ['build', 'cook', 'farm', 'hunt', 'gather', 'craft', 'research', 'haul'];
