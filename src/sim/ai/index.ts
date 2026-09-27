/**
 * Pawn behaviour. Colonists choose work by their skills, schedule and needs, and follow the
 * player's orders when drafted. Goblins and wolves attack, and wild animals graze, flee and hunt.
 */
import { damage } from '../combat';
import { B } from '../constants';
import { randInt } from '../rng';
import type { Pawn, SimState } from '../types';
import { log, pawnTile, removeStructure, structureAt } from '../world';
import { tickAnimal } from './animal';
import { tickColonist } from './colonist';
import { tickRaider } from './raider';

export { mentalBreak, orderAttack, orderMove, planCombat, setDrafted, weaponScore, workOrder } from './colonist';
export { scheduleAt, type ScheduleBlock } from './jobs';

export function tickPawn(s: SimState, p: Pawn): void {
  if (p.attackCd > 0) p.attackCd--;
  if (p.moveT < p.moveDur) {
    p.moveT++;
    if (p.moveT < p.moveDur) return;
    if (p.kind === 'goblin' || p.hostile) checkTrap(s, p);
    if (p.life !== 'ok') return;
  }
  if (p.kind === 'colonist') tickColonist(s, p);
  else if (p.kind === 'goblin' || p.hostile) tickRaider(s, p);
  else tickAnimal(s, p);
}

/** Spike traps wound the first raider to step on them, then have to be rebuilt. */
function checkTrap(s: SimState, p: Pawn): void {
  const st = structureAt(s, pawnTile(p));
  if (!st || st.kind !== 'trap') return;
  removeStructure(s, st);
  damage(s, p, randInt(s.rng, B.trapDmg[0], B.trapDmg[1]), null);
  const who = p.kind === 'animal' ? 'a wolf' : p.name;
  log(s, 'good', p.life === 'dead' ? `${who[0].toUpperCase()}${who.slice(1)} died on a spike trap.` : `A spike trap caught ${who}.`);
}
