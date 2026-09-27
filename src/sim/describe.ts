/** Human-readable descriptions of pawns and what they are doing, for the HUD. */
import { onTower } from './combat';
import { FEATURE } from './constants';
import { CROPS, CROP_BY_CODE, ITEMS, SPECIES, TECHS, blueprintSpec } from './defs';
import { GOBLIN_UNITS } from './people';
import type { CropKind, JoyKind, Pawn, SimState } from './types';
import { blueprintById, firstName, pawnById } from './world';

const JOY_LABEL: Record<JoyKind, string> = {
  campfire: 'Relaxing by the fire',
  stargaze: 'Watching the stars',
  horseshoes: 'Playing horseshoes',
  chess: 'Playing chess',
  statue: 'Admiring a statue',
  walk: 'Going for a walk',
};

/** "Varek the Cruel", "a wolf", "Mira". */
export function pawnLabel(p: Pawn): string {
  if (p.kind === 'colonist') return firstName(p);
  if (p.kind === 'animal') return `a ${p.name.toLowerCase()}`;
  return p.name;
}

/** "Goblin archer", "Deer", "Carpenter, 34". */
export function pawnTitle(p: Pawn): string {
  if (p.kind === 'goblin') return p.chiefId ? 'Goblin chief' : GOBLIN_UNITS[p.unit || 'fighter'].label;
  if (p.kind === 'animal') return p.hostile ? 'Hunting the settlement' : p.marked ? 'Marked for hunting' : `Wild ${SPECIES[p.species as keyof typeof SPECIES].label.toLowerCase()}`;
  return `${p.calling}, ${p.age}`;
}

const cropLabel = (s: SimState, tile: number): string => {
  const kind = CROP_BY_CODE[s.plant[tile]];
  return kind ? CROPS[kind as CropKind].label.toLowerCase() : 'crops';
};

export function activityLabel(s: SimState, p: Pawn): string {
  if (p.life === 'downed') return p.bleed > 0 ? 'Bleeding out' : 'Recovering from wounds';
  if (p.mental?.kind === 'daze') return 'Wandering in a daze';
  if (p.mental?.kind === 'brawl') {
    const o = pawnById(s, p.mental.targetId);
    return o ? `Brawling with ${firstName(o)}` : 'Brawling';
  }
  const j = p.job;
  if (!j) return p.drafted ? 'Drafted' : 'Idle';
  switch (j.kind) {
    case 'harvest': {
      const f = s.feature[j.tile];
      if (f === FEATURE.TREE) return 'Chopping a tree';
      if (f === FEATURE.BOULDER) return 'Quarrying stone';
      if (f === FEATURE.ORE) return 'Mining iron ore';
      return 'Picking berries';
    }
    case 'haul':
      return p.carry ? `Hauling ${ITEMS[p.carry.type].label.toLowerCase()}` : 'Fetching supplies';
    case 'deliver':
      return 'Carrying materials';
    case 'build': {
      const bp = blueprintById(s, j.bpId);
      if (!bp) return 'Building';
      const label = blueprintSpec(bp.kind).label.toLowerCase();
      return bp.floor ? `Laying ${label}` : `Building a ${label}`;
    }
    case 'decon':
      return 'Taking something apart';
    case 'sow':
      return 'Sowing a field';
    case 'reap':
      return `Harvesting ${cropLabel(s, j.tile)}`;
    case 'cook':
      return j.fine ? 'Cooking a fine meal' : 'Cooking a meal';
    case 'craft':
      return `Making a ${ITEMS[j.item].label.toLowerCase()}`;
    case 'research':
      return s.research.current ? `Researching ${TECHS[s.research.current].label.toLowerCase()}` : 'Studying';
    case 'equip':
      return 'Picking up gear';
    case 'eat':
      return j.stage === 'table' ? 'Taking food to a table' : 'Eating';
    case 'sleep':
      return j.asleep ? 'Sleeping' : 'Heading to bed';
    case 'joy':
      return JOY_LABEL[j.joy];
    case 'tend': {
      const o = pawnById(s, j.targetId);
      return o ? `Tending ${firstName(o)}` : 'Tending wounds';
    }
    case 'fight': {
      const o = pawnById(s, j.targetId);
      if (p.kind === 'animal' && o?.kind === 'animal') return 'Hunting';
      return o ? `Fighting ${pawnLabel(o)}` : 'Fighting';
    }
    case 'hunt': {
      const o = pawnById(s, j.targetId);
      return o ? `Hunting ${pawnLabel(o)}` : 'Hunting';
    }
    case 'bash':
      return 'Smashing';
    case 'flee':
      return p.kind === 'animal' ? 'Running away' : 'Fleeing!';
    case 'rally':
      return onTower(s, p) ? 'Manning a watchtower' : 'Holding the rally point';
    case 'wander':
      return p.kind === 'animal' ? 'Grazing' : 'Wandering';
    case 'goto':
      return 'Moving';
    case 'hold':
      return 'Holding position';
    case 'steal':
      return 'Stealing';
    case 'leave':
      return p.carry ? 'Running off with loot' : 'Leaving';
  }
}

export type PawnBadge = 'down' | 'sleep' | 'fight' | 'flee' | 'daze' | 'brawl' | 'hungry' | 'drafted' | null;

/** The one status worth showing above a colonist's head, if any. */
export function pawnBadge(p: Pawn): PawnBadge {
  if (p.life === 'downed') return 'down';
  if (p.mental) return p.mental.kind === 'brawl' ? 'brawl' : 'daze';
  if (p.drafted) return 'drafted';
  const j = p.job;
  if (j?.kind === 'fight') return 'fight';
  if (j?.kind === 'flee') return 'flee';
  if (j?.kind === 'sleep' && j.asleep) return 'sleep';
  if (p.food < 15) return 'hungry';
  return null;
}
