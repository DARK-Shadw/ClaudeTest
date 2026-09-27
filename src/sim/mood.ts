import { hourOf, isNight } from './time';
import { partnerOf } from './social';
import type { Pawn, SimState } from './types';
import { envBeauty, has, impressivenessTier, isLit, pawnTile, roomAt, structureById } from './world';

export interface MoodLine {
  label: string;
  mood: number;
}

const asleep = (p: Pawn): boolean => p.job?.kind === 'sleep' && p.job.asleep;

/** Everything currently pushing a colonist's mood up or down, strongest first. */
export function moodLines(s: SimState, p: Pawn): MoodLine[] {
  const lines: MoodLine[] = [];
  const add = (label: string, mood: number): void => {
    lines.push({ label, mood });
  };
  if (has(p, 'optimist')) add('Optimist', 8);
  if (has(p, 'pessimist')) add('Pessimist', -8);

  if (p.food <= 0) add('Starving', -18);
  else if (p.food < 25) add('Hungry', -6);
  if (p.rest < 20) add('Exhausted', -8);
  else if (p.rest < 35) add('Tired', -3);
  if (p.joy < 10) add('Recreation-starved', -10);
  else if (p.joy < 30) add('Bored', -4);
  else if (p.joy > 85) add('Well entertained', 3);
  if (p.life === 'ok' && p.hp < p.maxHp * 0.6) add('In pain', -6);

  const here = pawnTile(p);
  if (!asleep(p)) {
    if (!has(p, 'ascetic')) {
      const beauty = envBeauty(s, here);
      if (beauty >= 4) add('Beautiful surroundings', 6);
      else if (beauty >= 2) add('Pretty surroundings', 3);
      else if (beauty <= -1.5) add('Ugly surroundings', -3);
    }
    if (isNight(s.tick) && !has(p, 'nightOwl') && !isLit(s, here)) add('In the dark', -3);
  }
  if (has(p, 'nightOwl')) {
    const h = hourOf(s.tick);
    if (h >= 21 || h < 5) add('Night owl: loves the dark', 4);
    else if (h >= 9 && h < 17 && !asleep(p)) add('Night owl: awake by day', -4);
  }
  if (has(p, 'greedy')) {
    const bed = p.bedId ? structureById(s, p.bedId) : undefined;
    const room = bed ? roomAt(s, bed.tile) : undefined;
    if (room && room.beds === 1 && impressivenessTier(room.impressiveness) >= 4) add('Greedy: has a fine bedroom', 3);
    else add('Greedy: wants a better bedroom', -6);
  }
  const partner = partnerOf(p);
  if (partner && s.pawns.some((o) => o.id === partner.id && o.life !== 'dead')) add(partner.kind === 'spouse' ? 'Married' : 'In love', 4);

  for (const m of p.memories) if (m.until > s.tick) add(m.label, m.mood);
  return lines.sort((a, b) => Math.abs(b.mood) - Math.abs(a.mood));
}

export function computeMood(s: SimState, p: Pawn): number {
  p.memories = p.memories.filter((m) => m.until > s.tick);
  let mood = 50;
  for (const line of moodLines(s, p)) mood += line.mood;
  return Math.max(0, Math.min(100, mood));
}

export function moodLabel(mood: number): string {
  if (mood >= 80) return 'Happy';
  if (mood >= 60) return 'Content';
  if (mood >= 40) return 'Okay';
  if (mood >= 25) return 'Stressed';
  return 'Breaking';
}

/** Mood below this risks a minor breakdown; far below it, a major one. */
export function breakThreshold(p: Pawn): number {
  let t = 25;
  if (has(p, 'volatile')) t += 10;
  if (has(p, 'tooSmart')) t += 8;
  if (has(p, 'ironWilled')) t -= 10;
  return t;
}
