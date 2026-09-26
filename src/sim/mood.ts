import type { Pawn, SimState } from './types';
import { has } from './world';

export interface MoodLine {
  label: string;
  mood: number;
}

/** Everything currently pushing a colonist's mood up or down, strongest first. */
export function moodLines(s: SimState, p: Pawn): MoodLine[] {
  const lines: MoodLine[] = [];
  if (has(p, 'optimist')) lines.push({ label: 'Optimist', mood: 8 });
  if (has(p, 'pessimist')) lines.push({ label: 'Pessimist', mood: -8 });
  if (p.food <= 0) lines.push({ label: 'Starving', mood: -18 });
  else if (p.food < 25) lines.push({ label: 'Hungry', mood: -6 });
  if (p.rest < 20) lines.push({ label: 'Exhausted', mood: -8 });
  if (p.life === 'ok' && p.hp < p.maxHp * 0.6) lines.push({ label: 'In pain', mood: -6 });
  for (const m of p.memories) if (m.until > s.tick) lines.push({ label: m.label, mood: m.mood });
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
  if (mood >= 20) return 'Stressed';
  return 'Breaking';
}
