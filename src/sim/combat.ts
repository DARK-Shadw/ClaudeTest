/**
 * Fighting: melee and archery, armor, cover and towers, downed and dead, loot, carcasses, and
 * goblin chiefs who remember who hurt them.
 */
import { B, TICKS_PER_DAY } from './constants';
import { ARMORS, SPECIES, WEAPONS, type WeaponSpec } from './defs';
import { cheb } from './grid';
import { coverAt, lineOfSight } from './path';
import { chance, randInt } from './rng';
import { learn } from './skills';
import { endBrawl, foughtTogether, mourn } from './social';
import type { Chief, ItemType, Pawn, SimState } from './types';
import {
  addMemory,
  addStructure,
  endJob,
  firstName,
  has,
  kindAt,
  log,
  pawnTile,
  placeItemNear,
  ringSearch,
  story,
  techDone,
  walkable,
} from './world';

export const weaponOf = (p: Pawn): WeaponSpec => WEAPONS[p.weapon];
export const isRanged = (p: Pawn): boolean => WEAPONS[p.weapon].range > 1;
export const onTower = (s: SimState, p: Pawn): boolean => kindAt(s, pawnTile(p)) === 'tower';

export function rangeOf(s: SimState, p: Pawn): number {
  const r = WEAPONS[p.weapon].range;
  return r > 1 && onTower(s, p) ? r + B.towerRange : r;
}

/** Whether `a` can hit `t` from where it stands right now. */
export function inReach(s: SimState, a: Pawn, t: Pawn): boolean {
  const d = cheb(pawnTile(a), pawnTile(t));
  if (!isRanged(a)) return d <= 1;
  return d <= rangeOf(s, a) && lineOfSight(s, pawnTile(a), pawnTile(t));
}

/** Who is fighting whom: colonists against goblins and hostile animals. */
export function isEnemy(a: Pawn, b: Pawn): boolean {
  if (b.life !== 'ok' || b.gone) return false;
  if (a.kind === 'colonist') return b.kind === 'goblin' || b.hostile;
  if (a.kind === 'goblin' || a.hostile) return b.kind === 'colonist';
  return false;
}

/** Colonists standing by the rally point fight as a unit. */
export const holdingLine = (s: SimState, p: Pawn): boolean =>
  p.kind === 'colonist' && s.rally >= 0 && cheb(pawnTile(p), s.rally) <= 2;

function sharedBonus(s: SimState, a: Pawn, t: Pawn): number {
  let bonus = 0;
  if (holdingLine(s, a)) bonus += B.lineHitBonus;
  if (a.drafted && techDone(s, 'tactics')) bonus += B.tacticsHitBonus;
  if (a.grudge && t.chiefId === a.grudge) bonus += 0.15;
  return bonus;
}

function meleeHit(s: SimState, a: Pawn, t: Pawn): number {
  let hit = 0.5 + a.skills.melee * 0.025;
  // Every other attacker already on the target makes it harder to parry.
  const target = pawnTile(t);
  let allies = 0;
  for (const o of s.pawns) {
    if (o !== a && o.kind === a.kind && o.hostile === a.hostile && o.life === 'ok' && !o.gone && cheb(pawnTile(o), target) <= 1) allies++;
  }
  hit += Math.min(allies, 2) * B.flankBonus + sharedBonus(s, a, t);
  return Math.max(0.05, Math.min(0.95, hit));
}

function rangedHit(s: SimState, a: Pawn, t: Pawn): number {
  const d = cheb(pawnTile(a), pawnTile(t));
  let hit = 0.45 + a.skills.shooting * 0.025 - d * 0.025;
  if (onTower(s, a)) hit += B.towerHitBonus;
  hit -= coverAt(s, pawnTile(t), pawnTile(a));
  hit += sharedBonus(s, a, t);
  return Math.max(0.05, Math.min(0.95, hit));
}

export function attack(s: SimState, a: Pawn, t: Pawn): void {
  // Fistfights stay fistfights, whatever the settlers happen to be carrying.
  const w = a.mental?.kind === 'brawl' ? WEAPONS.fists : weaponOf(a);
  const ranged = w.range > 1;
  a.attackCd = w.cd;
  a.lastAttackTick = s.tick;
  if (ranged) {
    a.shotTick = s.tick;
    a.shotTo = pawnTile(t);
  }
  if (a.kind === 'colonist') {
    learn(s, a, ranged ? 'shooting' : 'melee', 40);
    if (t.kind !== 'colonist') foughtTogether(s, a);
  }
  if (!chance(s.rng, ranged ? rangedHit(s, a, t) : meleeHit(s, a, t))) return;
  if (!ranged && has(t, 'nimble') && chance(s.rng, 1 / 6)) return;
  damage(s, t, randInt(s.rng, w.dmg[0], w.dmg[1]), a);
}

export function damage(s: SimState, t: Pawn, amount: number, by: Pawn | null): void {
  let dmg = amount * ARMORS[t.armor].mul;
  if (has(t, 'tough')) dmg *= B.toughMul;
  if (holdingLine(s, t)) dmg *= B.lineDamageMul;
  dmg = Math.max(1, Math.round(dmg));
  t.hitTick = s.tick;
  if (by) t.lastHitBy = by.id;

  // A fistfight ends before anyone is badly hurt.
  if (by && t.mental?.kind === 'brawl' && t.mental.targetId === by.id) {
    t.hp = Math.max(1, t.hp - dmg);
    if (t.hp < t.maxHp * 0.4) endBrawl(s, by, t);
    return;
  }

  t.hp -= dmg;
  if (t.hp > 0) {
    if (t.kind === 'colonist' && has(t, 'wimp') && t.hp < t.maxHp * B.wimpDownAt) downColonist(s, t, by);
    return;
  }
  t.hp = 0;
  if (t.kind === 'colonist') {
    if (chance(s.rng, has(t, 'tough') ? B.toughDeathBlowChance : B.deathBlowChance)) {
      kill(s, t, by ? `was slain by ${by.name}` : 'died of wounds', by);
      return;
    }
    downColonist(s, t, by);
    return;
  }
  kill(s, t, 'died', by);
}

export function downColonist(s: SimState, p: Pawn, by: Pawn | null): void {
  if (p.life !== 'ok') return;
  endJob(s, p);
  p.life = 'downed';
  p.drafted = false;
  p.mental = null;
  p.fromX = p.x;
  p.fromY = p.y;
  p.moveT = p.moveDur = 0;
  const stable = chance(s.rng, has(p, 'tough') ? B.toughStableChance : B.stableChance);
  p.bleed = stable ? 0 : B.bleedTicks;
  log(s, 'bad', stable ? `${p.name} is down, but not bleeding badly.` : `${p.name} is down and bleeding!`);
  story(s, p, by ? `Was cut down by ${by.name}.` : 'Collapsed from wounds.');
  const chief = by ? chiefOf(s, by) : undefined;
  if (chief && p.grudge !== chief.id) {
    p.grudge = chief.id;
    story(s, p, `Swore revenge on ${chiefName(chief)}.`);
  }
}

export const chiefOf = (s: SimState, p: Pawn): Chief | undefined => (p.chiefId ? s.chiefs.find((c) => c.id === p.chiefId) : undefined);
export const chiefName = (c: Chief): string => `${c.name} ${c.title}`;

export function kill(s: SimState, p: Pawn, cause: string, by: Pawn | null = null): void {
  if (p.life === 'dead') return;
  const tile = pawnTile(p);
  if (p.carry) {
    placeItemNear(s, tile, p.carry.type, p.carry.count);
    p.carry = null;
  }
  p.life = 'dead';
  p.job = null;
  p.path = [];
  p.hp = 0;
  p.drafted = false;
  if (by) by.kills++;
  if (p.kind === 'goblin') goblinDied(s, p, by, tile);
  else if (p.kind === 'animal') animalDied(s, p, by, tile);
  else colonistDied(s, p, cause, by, tile);
}

function goblinDied(s: SimState, p: Pawn, by: Pawn | null, tile: number): void {
  if (s.raid && p.raidId === s.raid.id) s.raid.slain++;
  const drop: ItemType | '' = p.weapon === 'club' || p.weapon === 'spear' || p.weapon === 'bow' ? p.weapon : '';
  if (drop && chance(s.rng, B.weaponDropChance)) placeItemNear(s, tile, drop, 1);
  const chief = chiefOf(s, p);
  if (chief) {
    chief.alive = false;
    const victims = chief.kills.length ? `, who had killed ${chief.kills.join(' and ')}` : '';
    const who = by?.kind === 'colonist' ? by.name : 'the settlers';
    log(s, 'raid', `${who} slew ${chiefName(chief)}, chief of the ${chief.warband}${victims}.`, true);
    if (by?.kind === 'colonist') {
      story(s, by, `Slew ${chiefName(chief)}, chief of the ${chief.warband}.`);
      addMemory(by, 'chiefSlain', 'Slew a goblin chief', 10, s.tick + TICKS_PER_DAY * 2);
    }
    for (const c of s.pawns) {
      if (c.kind !== 'colonist' || c.grudge !== chief.id) continue;
      c.grudge = 0;
      addMemory(c, 'revenge', `${chief.name} is dead`, 8, s.tick + TICKS_PER_DAY * 2);
      story(s, c, `Saw ${chief.name} fall at last.`);
    }
    return;
  }
  if (by?.kind !== 'colonist') return;
  log(s, 'good', `${firstName(by)} slew ${p.name}.`);
  if (by.kills === 1) story(s, by, `Killed for the first time: a goblin called ${p.name}.`);
  else if (by.kills % 5 === 0) story(s, by, `Has now slain ${by.kills} enemies.`);
  if (has(by, 'bloodlust')) addMemory(by, 'bloodlust', 'Enjoyed a good fight', 6, s.tick + TICKS_PER_DAY);
}

function animalDied(s: SimState, p: Pawn, by: Pawn | null, tile: number): void {
  const spec = SPECIES[p.species as keyof typeof SPECIES];
  if (p.hostile && s.raid) s.raid.slain++;
  if (by?.kind === 'animal') {
    // A predator eats its kill on the spot.
    by.food = 100;
    return;
  }
  if (spec) {
    placeItemNear(s, tile, 'meat', spec.meat);
    placeItemNear(s, tile, 'leather', spec.leather);
  }
  if (by?.kind === 'colonist') {
    log(s, p.hostile ? 'good' : 'info', p.hostile ? `${firstName(by)} killed a wolf.` : `${firstName(by)} hunted a ${p.name.toLowerCase()}.`);
    if (!p.hostile) learn(s, by, 'shooting', 60);
  }
}

function colonistDied(s: SimState, p: Pawn, cause: string, by: Pawn | null, tile: number): void {
  s.fallen.push({ id: p.id, name: p.name, tick: s.tick, cause });
  log(s, 'death', `${p.name} ${cause}.`, true);
  const grave = ringSearch(tile, 5, (t) => walkable(s, t) && !s.structGrid[t] && !s.bpGrid[t] && !s.zone[t] && !s.itemGrid[t]);
  if (grave >= 0) addStructure(s, 'grave', grave, 0, p.name);
  if (p.weapon !== 'fists') {
    const item = WEAPONS[p.weapon].item;
    if (item) placeItemNear(s, tile, item, 1);
  }
  if (p.armor !== 'none') {
    const item = ARMORS[p.armor].item;
    if (item) placeItemNear(s, tile, item, 1);
  }
  mourn(s, p);
  for (const st of s.structures) {
    if (st.ownerId === p.id) {
      st.ownerId = 0;
      s.structVersion++;
    }
  }
  const chief = by ? chiefOf(s, by) : undefined;
  if (!chief) return;
  chief.kills.push(firstName(p));
  for (const o of s.pawns) {
    if (o.kind !== 'colonist' || o.life === 'dead' || o.grudge === chief.id) continue;
    const close = o.relations.some((r) => r.id === p.id && r.kind !== 'rival' && r.kind !== 'ex');
    if (!close) continue;
    o.grudge = chief.id;
    story(s, o, `Swore revenge on ${chiefName(chief)} for ${firstName(p)}.`);
  }
}

/** A chief who walks away alive comes back stronger, and with a new name to match. */
export function chiefEscaped(s: SimState, p: Pawn): void {
  const chief = chiefOf(s, p);
  if (!chief) return;
  chief.escapes++;
  chief.level++;
  if (p.hp < p.maxHp * 0.5 && !chief.scarred) {
    chief.scarred = true;
    chief.title = 'the Scarred';
  } else if (chief.kills.length) {
    chief.title = `Bane of ${chief.kills[chief.kills.length - 1]}`;
  } else if (chief.escapes >= 2) {
    chief.title = 'the Unkillable';
  }
  log(s, 'raid', `${p.name} escaped. The ${chief.warband} will be back, led by ${chiefName(chief)}.`, true);
}
