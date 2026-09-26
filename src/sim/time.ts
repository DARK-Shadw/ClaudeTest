import { START_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';

const OFFSET = START_HOUR * TICKS_PER_HOUR;

export const dayOf = (tick: number): number => Math.floor((tick + OFFSET) / TICKS_PER_DAY) + 1;

/** Hour of day as a float in [0, 24). */
export const hourOf = (tick: number): number => ((tick + OFFSET) % TICKS_PER_DAY) / TICKS_PER_HOUR;

export function isNight(tick: number): boolean {
  const h = hourOf(tick);
  return h >= 21 || h < 6;
}

/** The tick at which a given day and hour begins. */
export const tickAt = (day: number, hour: number): number => (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR - OFFSET;

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** "14:20". Minutes are rounded down to tens so the clock reads calmly at 1x. */
export function clockLabel(tick: number): string {
  const mins = Math.floor(hourOf(tick) * 60);
  return `${pad(Math.floor(mins / 60))}:${pad(Math.floor((mins % 60) / 10) * 10)}`;
}

/** "3h 20m" of in-game time. */
export function spanLabel(ticks: number): string {
  const mins = Math.max(0, Math.round((ticks / TICKS_PER_HOUR) * 6) * 10);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "Day 3, 14:20". */
export const stampLabel = (tick: number): string => `Day ${dayOf(tick)}, ${clockLabel(tick)}`;
