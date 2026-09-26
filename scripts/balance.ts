/**
 * Headless balance check: plays many seeds with two scripted strategies and reports how
 * harsh the raids are. Run with `npm run balance [seeds] [days]`.
 */
import {
  TICKS_PER_DAY,
  applyCommand,
  countItems,
  createSim,
  step,
  tileIndex,
  tileX,
  tileY,
  type SimState,
} from '../src/sim/index';

type Strategy = 'unprepared' | 'prepared';

function setup(s: SimState, strategy: Strategy): void {
  const hx = tileX(s.home);
  const hy = tileY(s.home);
  applyCommand(s, { t: 'harvest', x0: hx - 9, y0: hy - 9, x1: hx + 9, y1: hy + 9 });
  applyCommand(s, { t: 'build', kind: 'campfire', x0: hx + 1, y0: hy - 3, x1: hx + 1, y1: hy - 3 });
  if (strategy === 'unprepared') return;
  applyCommand(s, { t: 'room', x0: hx - 4, y0: hy + 1, x1: hx, y1: hy + 5 });
  for (let i = 0; i < 3; i++) applyCommand(s, { t: 'build', kind: 'bed', x0: hx - 3 + i, y0: hy + 2, x1: hx - 3 + i, y1: hy + 2 });
  applyCommand(s, { t: 'rally', tile: tileIndex(hx, hy) });
  for (let i = -3; i <= 3; i += 2) {
    for (const [x, y] of [[hx + i, hy - 6], [hx + i, hy + 8], [hx - 7, hy + i], [hx + 7, hy + i]]) {
      applyCommand(s, { t: 'build', kind: 'trap', x0: x, y0: y, x1: x, y1: y });
    }
  }
}

interface Outcome {
  fell: boolean;
  deaths: number;
  downs: number;
  raids: number;
  slain: number;
  stolen: number;
  colonists: number;
  food: number;
}

function play(seed: number, strategy: Strategy, days: number): Outcome {
  const s = createSim(seed);
  setup(s, strategy);
  for (let i = 0; i < TICKS_PER_DAY * days && !s.over; i++) step(s);
  const raidEnds = s.log.filter((e) => e.text.startsWith('The raid is over'));
  const num = (re: RegExp): number => raidEnds.reduce((n, e) => n + Number(re.exec(e.text)?.[1] ?? 0), 0);
  return {
    fell: s.over,
    deaths: s.fallen.length,
    downs: s.log.filter((e) => e.text.includes(' is down')).length,
    raids: s.raidCount,
    slain: num(/(\d+) goblins? slain/),
    stolen: num(/(\d+) supplies stolen/),
    colonists: s.pawns.filter((p) => p.kind === 'colonist').length,
    food: countItems(s, 'berries') + countItems(s, 'meal') * 4,
  };
}

const seeds = Number(process.argv[2] ?? 24);
const days = Number(process.argv[3] ?? 8);
for (const strategy of ['unprepared', 'prepared'] as Strategy[]) {
  const results: Outcome[] = [];
  const t0 = performance.now();
  for (let seed = 1; seed <= seeds; seed++) results.push(play(seed * 7919, strategy, days));
  const avg = (f: (o: Outcome) => number): string => (results.reduce((n, o) => n + f(o), 0) / results.length).toFixed(2);
  const pct = (f: (o: Outcome) => boolean): string => `${Math.round((results.filter(f).length / results.length) * 100)}%`;
  console.log(
    `${strategy.padEnd(11)} ${days}d x${seeds}: fell ${pct((o) => o.fell)}, any death ${pct((o) => o.deaths > 0)}, ` +
      `deaths ${avg((o) => o.deaths)}, downs ${avg((o) => o.downs)}, raids ${avg((o) => o.raids)}, ` +
      `slain ${avg((o) => o.slain)}, stolen ${avg((o) => o.stolen)}, colonists ${avg((o) => o.colonists)}, ` +
      `food ${avg((o) => o.food)}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
}
