/** Human-readable descriptions of what pawns are doing, for the HUD. */
import { FEATURE, STRUCTURES } from './constants';
import type { Pawn, SimState } from './types';
import { blueprintById, firstName, pawnById } from './world';

export function activityLabel(s: SimState, p: Pawn): string {
  if (p.life === 'downed') return p.bleed > 0 ? 'Bleeding out' : 'Recovering from wounds';
  if (p.mental) return 'Wandering in a daze';
  const j = p.job;
  if (!j) return 'Idle';
  switch (j.kind) {
    case 'harvest': {
      const f = s.feature[j.tile];
      if (f === FEATURE.TREE) return 'Chopping a tree';
      if (f === FEATURE.BOULDER) return 'Breaking rocks';
      return 'Picking berries';
    }
    case 'haul':
      return p.carry ? `Hauling ${p.carry.type}` : 'Fetching supplies';
    case 'deliver':
      return 'Carrying materials';
    case 'build': {
      const bp = blueprintById(s, j.bpId);
      return bp ? `Building a ${STRUCTURES[bp.kind].label.toLowerCase()}` : 'Building';
    }
    case 'decon':
      return 'Taking something apart';
    case 'cook':
      return 'Cooking a meal';
    case 'eat':
      return 'Eating';
    case 'sleep':
      return j.asleep ? 'Sleeping' : 'Heading to bed';
    case 'tend': {
      const o = pawnById(s, j.targetId);
      return o ? `Tending ${firstName(o)}` : 'Tending wounds';
    }
    case 'fight': {
      const o = pawnById(s, j.targetId);
      if (!o) return 'Fighting';
      return `Fighting ${o.kind === 'goblin' ? o.name : firstName(o)}`;
    }
    case 'bash':
      return 'Smashing';
    case 'flee':
      return 'Fleeing!';
    case 'rally':
      return 'Holding the rally point';
    case 'wander':
      return 'Wandering';
    case 'steal':
      return 'Stealing';
    case 'leave':
      return 'Leaving';
  }
}

export type PawnBadge = 'down' | 'sleep' | 'fight' | 'flee' | 'daze' | 'hungry' | null;

/** The one status worth showing above a colonist's head, if any. */
export function pawnBadge(p: Pawn): PawnBadge {
  if (p.life === 'downed') return 'down';
  if (p.mental) return 'daze';
  const j = p.job;
  if (j?.kind === 'fight') return 'fight';
  if (j?.kind === 'flee') return 'flee';
  if (j?.kind === 'sleep' && j.asleep) return 'sleep';
  if (p.food < 15) return 'hungry';
  return null;
}
