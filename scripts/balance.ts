/**
 * Headless balance check: plays many seeds with scripted strategies and reports how the
 * settlements fare. Run with `npm run balance [seeds] [days]`.
 *
 * passive   nobody gives any orders
 * settled   a camp: gathering, a campfire, a bedroom, a dining table, a field, research and crafting
 * fortified settled, plus a rally point, traps and barricades
 */
import {
  TERRAIN,
  TICKS_PER_DAY,
  applyCommand,
  countGroup,
  createSim,
  step,
  tileIndex,
  tileX,
  tileY,
  type BlueprintKind,
  type SimState,
} from '../src/sim/index';

type Strategy = 'passive' | 'settled' | 'fortified';

function place(s: SimState, kind: BlueprintKind, x: number, y: number, x1 = x, y1 = y): void {
  applyCommand(s, { t: 'build', kind, x0: x, y0: y, x1, y1 });
}

/** The nearest 6x5 patch of open ground for the first house, as its top-left corner. */
function houseSpot(s: SimState, hx: number, hy: number): [number, number] {
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x0 = hx - 5 + dx;
        const y0 = hy + 1 + dy;
        let ok = x0 >= 1 && y0 >= 1 && x0 + 5 < 63 && y0 + 4 < 63;
        for (let y = y0; ok && y <= y0 + 4; y++) {
          for (let x = x0; ok && x <= x0 + 5; x++) {
            const t = tileIndex(x, y);
            ok = s.terrain[t] === TERRAIN.GRASS || s.terrain[t] === TERRAIN.SAND;
            if (ok && s.zone[t]) ok = false;
          }
        }
        if (ok) return [x0, y0];
      }
    }
  }
  return [hx - 5, hy + 1];
}

function setup(s: SimState, strategy: Strategy): void {
  if (strategy === 'passive') return;
  const hx = tileX(s.home);
  const hy = tileY(s.home);
  applyCommand(s, { t: 'harvest', x0: hx - 10, y0: hy - 10, x1: hx + 10, y1: hy + 10 });
  place(s, 'campfire', hx + 1, hy - 3);
  const [rx, ry] = houseSpot(s, hx, hy);
  applyCommand(s, { t: 'room', wall: 'wall', x0: rx, y0: ry, x1: rx + 5, y1: ry + 4 });
  for (let i = 0; i < 4; i++) place(s, 'bed', rx + 1 + i, ry + 1);
  place(s, 'table', rx + 2, ry + 3);
  place(s, 'stool', rx + 3, ry + 3);
  place(s, 'torch', rx + 4, ry + 2);
  place(s, 'researchDesk', hx + 3, hy - 4);
  place(s, 'craftBench', hx + 5, hy - 4);
  place(s, 'horseshoes', hx + 3, hy - 6);
  applyCommand(s, { t: 'zone', zone: 'potato', x0: hx + 2, y0: hy + 3, x1: hx + 6, y1: hy + 6 });
  applyCommand(s, { t: 'research', tech: 'archery' });
  if (strategy === 'settled') return;
  applyCommand(s, { t: 'rally', tile: tileIndex(hx, hy) });
  for (let i = -3; i <= 3; i += 2) {
    for (const [x, y] of [[hx + i, hy - 7], [hx + i, hy + 9], [hx - 8, hy + i], [hx + 8, hy + i]]) place(s, 'trap', x, y);
  }
  place(s, 'barricade', hx - 2, hy - 2, hx + 2, hy - 2);
}

/** A little later in the game the settled strategies keep researching. */
function keepResearching(s: SimState): void {
  if (s.research.current) return;
  const next = (['archery', 'cooking', 'medicine', 'masonry', 'tactics', 'smithing'] as const).find((t) => !s.research.done.includes(t));
  if (next) applyCommand(s, { t: 'research', tech: next });
}

interface Outcome {
  fell: boolean;
  deaths: number;
  downs: number;
  raids: number;
  slain: number;
  stolen: number;
  colonists: number;
  mood: number;
  meals: number;
  techs: number;
  breaks: number;
  fights: number;
  ms: number;
}

function play(seed: number, strategy: Strategy, days: number): Outcome {
  const s = createSim(seed);
  setup(s, strategy);
  const t0 = performance.now();
  for (let i = 0; i < TICKS_PER_DAY * days && !s.over; i++) {
    step(s);
    if (strategy !== 'passive' && s.tick % 600 === 0) keepResearching(s);
  }
  const ms = (performance.now() - t0) / Math.max(1, s.tick);
  const raidEnds = s.log.filter((e) => /^The (raid|wolf attack) is over/.test(e.text));
  const num = (re: RegExp): number => raidEnds.reduce((n, e) => n + Number(re.exec(e.text)?.[1] ?? 0), 0);
  const colonists = s.pawns.filter((p) => p.kind === 'colonist');
  return {
    fell: s.over,
    deaths: s.fallen.length,
    downs: s.log.filter((e) => e.text.includes(' is down')).length,
    raids: s.raidCount,
    slain: num(/(\d+) (goblins?|wolf|wolves) slain/),
    stolen: num(/(\d+) supplies stolen/),
    colonists: colonists.length,
    mood: colonists.length ? colonists.reduce((n, p) => n + p.mood, 0) / colonists.length : 0,
    meals: countGroup(s, 'meal'),
    techs: s.research.done.length,
    breaks: s.log.filter((e) => e.text.includes('broke down') || e.text.includes('snapped')).length,
    fights: s.log.filter((e) => e.text.includes('fistfight')).length,
    ms,
  };
}

const seeds = Number(process.argv[2] ?? 16);
const days = Number(process.argv[3] ?? 10);
const only = process.argv[4] as Strategy | undefined;
for (const strategy of ['passive', 'settled', 'fortified'] as Strategy[]) {
  if (only && strategy !== only) continue;
  const results: Outcome[] = [];
  const t0 = performance.now();
  for (let seed = 1; seed <= seeds; seed++) results.push(play(seed * 7919, strategy, days));
  const avg = (f: (o: Outcome) => number, digits = 2): string => (results.reduce((n, o) => n + f(o), 0) / results.length).toFixed(digits);
  const pct = (f: (o: Outcome) => boolean): string => `${Math.round((results.filter(f).length / results.length) * 100)}%`;
  console.log(
    `${strategy.padEnd(9)} ${days}d x${seeds}: fell ${pct((o) => o.fell)}, any death ${pct((o) => o.deaths > 0)}, ` +
      `deaths ${avg((o) => o.deaths)}, downs ${avg((o) => o.downs)}, raids ${avg((o) => o.raids)}, slain ${avg((o) => o.slain)}, ` +
      `stolen ${avg((o) => o.stolen, 0)}, colonists ${avg((o) => o.colonists, 1)}, mood ${avg((o) => o.mood, 0)}, ` +
      `meals ${avg((o) => o.meals, 0)}, techs ${avg((o) => o.techs, 1)}, breaks ${avg((o) => o.breaks, 1)}, fistfights ${avg((o) => o.fights, 1)} ` +
      `(${avg((o) => o.ms, 3)} ms/tick, ${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
}
