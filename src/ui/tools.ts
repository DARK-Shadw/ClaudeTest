/** Every map tool the player can hold, with its label, icon and one-line hint. */
import {
  BUILDINGS,
  BUILD_ORDER,
  FLOORS,
  FLOOR_ORDER,
  TECHS,
  blueprintSpec,
  isAreaBuild,
  isFloorKind,
  isOutlineBuild,
  type BlueprintKind,
  type BuildCategory,
  type TechId,
  type ZoneKind,
} from '../sim';
import type { IconName } from './icons';

export type ToolId =
  | 'select'
  | 'command'
  | 'harvest'
  | 'demolish'
  | 'clear'
  | 'rally'
  | 'hunt'
  | 'room'
  | 'stoneRoom'
  | ZoneKind
  | BlueprintKind;

export interface ToolInfo {
  label: string;
  icon: IconName;
  hint: string;
  desc?: string;
  cost?: string;
  tech?: TechId;
}

const KIND_ICON: Record<BlueprintKind, IconName> = {
  wall: 'wall',
  stoneWall: 'stoneWall',
  door: 'door',
  bed: 'bed',
  table: 'table',
  stool: 'stool',
  torch: 'torch',
  campfire: 'campfire',
  stove: 'stove',
  craftBench: 'bench',
  researchDesk: 'desk',
  horseshoes: 'horseshoes',
  chessTable: 'chess',
  plantPot: 'plantPot',
  statue: 'statue',
  trap: 'trap',
  barricade: 'barricade',
  tower: 'tower',
  woodFloor: 'floor',
  stoneFloor: 'floor',
  carpet: 'carpet',
};

function buildTool(kind: BlueprintKind): ToolInfo {
  const spec = blueprintSpec(kind);
  const how = isOutlineBuild(kind) ? 'Drag to draw a line or an outline.' : isAreaBuild(kind) ? 'Drag to fill an area.' : 'Tap a tile to place it.';
  return {
    label: spec.label,
    icon: KIND_ICON[kind],
    hint: `${spec.label}: ${how}`,
    desc: isFloorKind(kind) ? FLOORS[kind].desc : BUILDINGS[kind].desc,
    cost: `${spec.cost} ${spec.material}`,
    tech: spec.tech,
  };
}

export const TOOLS: Record<ToolId, ToolInfo> = {
  select: { label: 'Select', icon: 'select', hint: '' },
  command: { label: 'Command', icon: 'shield', hint: 'Tap the ground to move · tap an enemy to attack · tap a downed settler to tend.' },
  harvest: { label: 'Harvest', icon: 'harvest', hint: 'Drag over trees, bushes, rocks and ore to gather them.', desc: 'Chop, pick, quarry and mine' },
  demolish: { label: 'Demolish', icon: 'demolish', hint: 'Drag over buildings to take them apart for half their materials.', desc: 'Returns half the materials' },
  clear: { label: 'Cancel', icon: 'clear', hint: 'Drag to cancel plans, harvest marks and zones.', desc: 'Plans, marks and zones' },
  rally: { label: 'Rally point', icon: 'rally', hint: 'Tap where settlers gather to fight. They hit harder there, together.', desc: 'Where settlers muster in a raid' },
  hunt: { label: 'Hunt', icon: 'hunt', hint: 'Tap animals to mark them for hunting. Hunters need a weapon.', desc: 'Meat and leather' },
  room: { label: 'Room', icon: 'room', hint: 'Drag a rectangle. The door goes on the side facing you.', desc: 'Wooden walls and a door in one drag', cost: '3 wood a wall' },
  stoneRoom: { label: 'Stone room', icon: 'room', hint: 'Drag a rectangle of stone walls. The door goes on the side facing you.', desc: 'Stone walls hold far longer', cost: '4 stone a wall' },
  stockpile: { label: 'Stockpile', icon: 'crate', hint: 'Drag to mark a stockpile. Settlers haul supplies there.', desc: 'Where supplies are kept' },
  potato: { label: 'Potato field', icon: 'sprout', hint: 'Drag over open ground to plant potatoes. Nothing grows in winter.', desc: 'Grows in 3 days, sand is poorer' },
  healroot: { label: 'Healroot field', icon: 'herbs', hint: 'Drag to plant healroot, which heals wounds twice as fast.', desc: 'Medicine for the wounded', tech: 'medicine' },
  ...(Object.fromEntries([...BUILD_ORDER, ...FLOOR_ORDER].map((k) => [k, buildTool(k)])) as Record<BlueprintKind, ToolInfo>),
};

/** Tools that draw with a one-finger drag instead of panning. */
export const AREA_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'harvest',
  'demolish',
  'clear',
  'room',
  'stoneRoom',
  'stockpile',
  'potato',
  'healroot',
  ...[...BUILD_ORDER, ...FLOOR_ORDER].filter((k) => isAreaBuild(k)),
]);

export interface BuildCategoryInfo {
  id: BuildCategory;
  label: string;
  icon: IconName;
  tools: ToolId[];
}

export const BUILD_CATEGORIES: readonly BuildCategoryInfo[] = [
  { id: 'structure', label: 'Structure', icon: 'wall', tools: ['room', 'stoneRoom', ...BUILD_ORDER.filter((k) => BUILDINGS[k].category === 'structure')] },
  { id: 'furniture', label: 'Furniture', icon: 'bed', tools: BUILD_ORDER.filter((k) => BUILDINGS[k].category === 'furniture') },
  { id: 'production', label: 'Work', icon: 'bench', tools: BUILD_ORDER.filter((k) => BUILDINGS[k].category === 'production') },
  { id: 'fun', label: 'Fun', icon: 'chess', tools: BUILD_ORDER.filter((k) => BUILDINGS[k].category === 'fun') },
  { id: 'decor', label: 'Decor', icon: 'statue', tools: BUILD_ORDER.filter((k) => BUILDINGS[k].category === 'decor') },
  { id: 'defense', label: 'Defense', icon: 'tower', tools: BUILD_ORDER.filter((k) => BUILDINGS[k].category === 'defense') },
  { id: 'floor', label: 'Floors', icon: 'floor', tools: [...FLOOR_ORDER] },
];

export const ORDER_TOOLS: readonly ToolId[] = ['harvest', 'hunt', 'demolish', 'clear', 'rally'];
export const ZONE_TOOLS: readonly ToolId[] = ['stockpile', 'potato', 'healroot', 'clear'];

export const isBuildTool = (tool: ToolId): boolean => tool === 'room' || tool === 'stoneRoom' || tool in BUILDINGS || tool in FLOORS;

export const techLabel = (tech: TechId): string => TECHS[tech].label;
