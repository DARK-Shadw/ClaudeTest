/** Skill levels, learning by doing, and how fast a colonist works. */
import { SKILL_LABEL } from './defs';
import type { Pawn, SimState, SkillId } from './types';
import { firstName, has, log, story } from './world';

export const MAX_SKILL = 20;

/** Work speed from skill level: 0.5 at level 0, 1.1 at level 8, 2.0 at level 20. */
export const skillFactor = (level: number): number => 0.5 + level * 0.075;

export const xpToNext = (level: number): number => 800 + level * 200;

const SKILL_NOUN: Record<SkillId, string> = {
  melee: 'fighter',
  shooting: 'marksman',
  construction: 'builder',
  mining: 'miner',
  plants: 'grower',
  cooking: 'cook',
  crafting: 'crafter',
  medicine: 'healer',
  social: 'talker',
  intellect: 'scholar',
};

const MILESTONES: Record<number, string> = { 8: 'skilled', 12: 'expert', 16: 'master', 20: 'legendary' };

export const passionLabel = (p: Pawn, skill: SkillId): string =>
  p.passions[skill] === 2 ? 'Burning passion' : p.passions[skill] === 1 ? 'Interested' : '';

/** Practice makes perfect: passion and brains make it faster. */
export function learn(s: SimState, p: Pawn, skill: SkillId, amount: number): void {
  if (p.kind !== 'colonist' || p.skills[skill] >= MAX_SKILL) return;
  const passion = p.passions[skill];
  let mul = passion === 2 ? 1.5 : passion === 1 ? 1 : 0.35;
  if (has(p, 'tooSmart')) mul *= 1.75;
  p.xp[skill] += amount * mul;
  while (p.skills[skill] < MAX_SKILL && p.xp[skill] >= xpToNext(p.skills[skill])) {
    p.xp[skill] -= xpToNext(p.skills[skill]);
    p.skills[skill]++;
    const word = MILESTONES[p.skills[skill]];
    if (word) {
      story(s, p, `Became ${word === 'expert' ? 'an' : 'a'} ${word} ${SKILL_NOUN[skill]}.`);
      log(s, 'good', `${firstName(p)} became ${word === 'expert' ? 'an' : 'a'} ${word} ${SKILL_NOUN[skill]} (${SKILL_LABEL[skill]} ${p.skills[skill]}).`);
    }
  }
  // Doing what you love is its own recreation.
  if (passion) p.joy = Math.min(100, p.joy + amount * (passion === 2 ? 0.02 : 0.01));
}

export function workSpeed(p: Pawn, skill: SkillId | ''): number {
  let m = skill ? skillFactor(p.skills[skill]) : 1;
  if (has(p, 'industrious')) m *= 1.25;
  if (has(p, 'lazy')) m *= 0.8;
  if (skill === 'plants' && has(p, 'greenThumb')) m *= 1.3;
  if (p.hp < p.maxHp * 0.5) m *= 0.75;
  return m;
}
