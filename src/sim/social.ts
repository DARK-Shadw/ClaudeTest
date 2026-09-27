/**
 * How colonists feel about each other. Opinions come from looks, personality, family and a
 * running memory of every chat, insult, rescue and punch. Conversations happen on their own
 * whenever colonists are near each other; friendships, rivalries, romances and fistfights grow
 * out of them.
 */
import { TICKS_PER_DAY } from './constants';
import { cheb } from './grid';
import { learn } from './skills';
import { chance, pick, randInt, random } from './rng';
import type { Pawn, Relation, RelationKind, SimState } from './types';
import { addMemory, endJob, firstName, has, log, pawnTile, story } from './world';

const REL_BASE: Record<RelationKind, number> = {
  lover: 30,
  spouse: 40,
  sibling: 15,
  parent: 15,
  child: 15,
  friend: 0,
  rival: 0,
  ex: -10,
};

export const REL_LABEL: Record<RelationKind, string> = {
  lover: 'Lover',
  spouse: 'Spouse',
  sibling: 'Sibling',
  parent: 'Parent',
  child: 'Child',
  friend: 'Friend',
  rival: 'Rival',
  ex: 'Ex-lover',
};

export const hasRel = (p: Pawn, id: number, kind: RelationKind): boolean => p.relations.some((r) => r.id === id && r.kind === kind);
export const relationsWith = (p: Pawn, id: number): Relation[] => p.relations.filter((r) => r.id === id);

export function addRel(s: SimState, p: Pawn, id: number, kind: RelationKind): void {
  if (!hasRel(p, id, kind)) p.relations.push({ id, kind, since: s.tick });
}

export function removeRel(p: Pawn, id: number, kind: RelationKind): void {
  p.relations = p.relations.filter((r) => !(r.id === id && r.kind === kind));
}

export const partnerOf = (p: Pawn): Relation | undefined => p.relations.find((r) => r.kind === 'lover' || r.kind === 'spouse');
export const isFamily = (p: Pawn, id: number): boolean =>
  p.relations.some((r) => r.id === id && (r.kind === 'sibling' || r.kind === 'parent' || r.kind === 'child'));

/** How much `p` likes `o`, from -100 to 100. */
export function opinion(s: SimState, p: Pawn, o: Pawn): number {
  let v = 0;
  if (has(o, 'beautiful')) v += 15;
  if (has(o, 'ugly')) v -= 15;
  if (has(o, 'kind')) v += 8;
  if (has(o, 'abrasive')) v -= 6;
  for (const r of p.relations) if (r.id === o.id) v += REL_BASE[r.kind];
  for (const m of p.social) if (m.id === o.id && m.until > s.tick) v += m.value;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

/** "Close friend", "Rival"... or an empty string for acquaintances. */
export function bondLabel(v: number): string {
  if (v >= 60) return 'Close friend';
  if (v >= 20) return 'Friend';
  if (v <= -60) return 'Enemy';
  if (v <= -20) return 'Rival';
  return '';
}

export interface SocialLine {
  label: string;
  value: number;
}

/** The reasons behind an opinion, for the social tab. */
export function opinionReasons(s: SimState, p: Pawn, o: Pawn): SocialLine[] {
  const lines: SocialLine[] = [];
  if (has(o, 'beautiful')) lines.push({ label: 'Beautiful', value: 15 });
  if (has(o, 'ugly')) lines.push({ label: 'Ugly', value: -15 });
  if (has(o, 'kind')) lines.push({ label: 'Kind soul', value: 8 });
  if (has(o, 'abrasive')) lines.push({ label: 'Abrasive', value: -6 });
  for (const r of p.relations) if (r.id === o.id && REL_BASE[r.kind]) lines.push({ label: REL_LABEL[r.kind], value: REL_BASE[r.kind] });
  const grouped = new Map<string, number>();
  for (const m of p.social) if (m.id === o.id && m.until > s.tick) grouped.set(m.label, (grouped.get(m.label) ?? 0) + m.value);
  for (const [label, value] of grouped) lines.push({ label, value: Math.round(value) });
  return lines.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/** Remembers something about another colonist. Repeats stack up to `max`, then refresh. */
export function addSocial(s: SimState, p: Pawn, o: Pawn, key: string, label: string, value: number, days: number, max = 1): void {
  const until = s.tick + Math.round(days * TICKS_PER_DAY);
  const same = p.social.filter((m) => m.id === o.id && m.key === key);
  if (same.length >= max) {
    same.sort((a, b) => a.until - b.until);
    same[0].until = until;
    same[0].value = value;
    return;
  }
  p.social.push({ id: o.id, key, label, value, until });
}

const asleep = (p: Pawn): boolean => p.job?.kind === 'sleep' && p.job.asleep;
const busyFighting = (p: Pawn): boolean =>
  p.job?.kind === 'fight' || p.job?.kind === 'flee' || p.job?.kind === 'hunt' || p.drafted || !!p.mental;

const canTalk = (p: Pawn): boolean => p.kind === 'colonist' && p.life === 'ok' && !asleep(p) && !busyFighting(p);

/** Every few seconds, idle colonists near each other talk. */
export function socialTick(s: SimState): void {
  if (s.tick % 10 !== 0) return;
  for (const p of s.pawns) {
    if (p.kind !== 'colonist' || p.socialAt > s.tick) continue;
    const atFire = p.job?.kind === 'joy' && p.job.joy === 'campfire';
    p.socialAt = s.tick + (atFire ? randInt(s.rng, 40, 100) : randInt(s.rng, 120, 300));
    if (!canTalk(p)) continue;
    const here = pawnTile(p);
    const near = s.pawns.filter((o) => o !== p && canTalk(o) && cheb(here, pawnTile(o)) <= 5);
    if (near.length === 0) continue;
    interact(s, p, pick(s.rng, near));
  }
  if (s.tick % 200 === 0) for (const p of s.pawns) if (p.kind === 'colonist') p.social = p.social.filter((m) => m.until > s.tick);
}

function canRomance(s: SimState, p: Pawn, o: Pawn): boolean {
  if (p.age < 18 || o.age < 18 || Math.abs(p.age - o.age) > 16) return false;
  if (partnerOf(p) || partnerOf(o) || isFamily(p, o.id) || hasRel(p, o.id, 'ex')) return false;
  return opinion(s, p, o) >= 30;
}

function interact(s: SimState, p: Pawn, o: Pawn): void {
  const op = opinion(s, p, o);
  const low = p.mood < 30;
  const kind = has(p, 'kind');
  const insultW = kind ? 0 : 0.012 * (has(p, 'abrasive') ? 4 : 1) * (low ? 2 : 1) * (op < -10 ? 2 : 1);
  const slightW = kind ? 0 : 0.06 * (op < -10 ? 2 : 1);
  const deepW = op >= 15 ? 0.3 : 0.05;
  const romanceW = canRomance(s, p, o) ? 0.06 : 0;
  const proposeW = hasRel(p, o.id, 'lover') && op >= 60 && s.tick - (relationsWith(p, o.id).find((r) => r.kind === 'lover')?.since ?? s.tick) > TICKS_PER_DAY * 2 ? 0.12 : 0;
  const breakW = partnerOf(p)?.id === o.id && op < 0 ? 0.2 : 0;
  const total = 1 + insultW + slightW + deepW + romanceW + proposeW + breakW;
  let r = random(s.rng) * total;
  const socialMul = 0.8 + p.skills.social / 20;
  learn(s, p, 'social', 15);

  if ((r -= breakW) < 0) return breakUp(s, p, o);
  if ((r -= proposeW) < 0) return propose(s, p, o);
  if ((r -= romanceW) < 0) return flirt(s, p, o);
  if ((r -= insultW) < 0) return insult(s, p, o);
  if ((r -= slightW) < 0) {
    addSocial(s, o, p, 'slight', 'Slighted me', -3, 2, 4);
    updateBond(s, o, p);
    return;
  }
  if ((r -= deepW) < 0) {
    addSocial(s, p, o, 'deep', 'Deep talk', 5 * socialMul, 3, 3);
    addSocial(s, o, p, 'deep', 'Deep talk', 5 * socialMul, 3, 3);
    p.joy = Math.min(100, p.joy + 1.5);
    o.joy = Math.min(100, o.joy + 1.5);
  } else {
    addSocial(s, p, o, 'chat', 'Chatted', 2 * socialMul, 2, 6);
    addSocial(s, o, p, 'chat', 'Chatted', 2 * socialMul, 2, 6);
    p.joy = Math.min(100, p.joy + 0.6);
    o.joy = Math.min(100, o.joy + 0.6);
  }
  updateBond(s, p, o);
  updateBond(s, o, p);
}

function insult(s: SimState, p: Pawn, o: Pawn): void {
  addSocial(s, o, p, 'insult', 'Insulted me', -8, 3, 3);
  addMemory(o, `insulted:${p.id}`, `Insulted by ${firstName(p)}`, -4, s.tick + TICKS_PER_DAY);
  updateBond(s, o, p);
  const snaps = (has(o, 'volatile') || o.mood < 30 || has(p, 'volatile')) && chance(s.rng, 0.35);
  if (!snaps) {
    log(s, 'social', `${firstName(p)} insulted ${firstName(o)}.`);
    return;
  }
  startBrawl(s, o, p);
}

/** A fistfight. Nobody dies, but nobody forgets. */
export function startBrawl(s: SimState, a: Pawn, b: Pawn): void {
  const until = s.tick + 400;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    endJob(s, x);
    x.mental = { kind: 'brawl', until, targetId: y.id };
  }
  log(s, 'warn', `${firstName(a)} and ${firstName(b)} got into a fistfight!`);
  story(s, a, `Got into a fistfight with ${firstName(b)}.`);
  story(s, b, `Got into a fistfight with ${firstName(a)}.`);
}

/** Called by combat when a brawl ends. */
export function endBrawl(s: SimState, winner: Pawn, loser: Pawn): void {
  for (const x of [winner, loser]) {
    x.mental = null;
    if (x.job?.kind === 'fight') endJob(s, x);
  }
  addSocial(s, winner, loser, 'fight', 'Fought me', -20, 5);
  addSocial(s, loser, winner, 'fight', 'Beat me in a fight', -25, 5);
  addMemory(loser, 'lostFight', 'Lost a fistfight', -6, s.tick + TICKS_PER_DAY);
  updateBond(s, winner, loser);
  updateBond(s, loser, winner);
  log(s, 'social', `${firstName(winner)} won the fight against ${firstName(loser)}.`);
}

function flirt(s: SimState, p: Pawn, o: Pawn): void {
  const back = opinion(s, o, p);
  const odds = back >= 25 ? 0.55 + (has(p, 'beautiful') ? 0.15 : 0) : 0.08;
  if (!chance(s.rng, odds)) {
    addSocial(s, p, o, 'rebuffed', 'Turned me down', -8, 3);
    addMemory(p, 'rebuffed', `Turned down by ${firstName(o)}`, -6, s.tick + TICKS_PER_DAY);
    log(s, 'social', `${firstName(o)} turned down ${firstName(p)}.`);
    return;
  }
  addRel(s, p, o.id, 'lover');
  addRel(s, o, p.id, 'lover');
  for (const [x, y] of [[p, o], [o, p]] as const) {
    addMemory(x, 'romance', `Fell for ${firstName(y)}`, 8, s.tick + TICKS_PER_DAY * 2);
    story(s, x, `Fell in love with ${firstName(y)}.`);
  }
  log(s, 'good', `${firstName(p)} and ${firstName(o)} fell in love.`, true);
}

function propose(s: SimState, p: Pawn, o: Pawn): void {
  if (opinion(s, o, p) < 50 || !chance(s.rng, 0.6)) {
    addMemory(p, 'proposal', `${firstName(o)} said "not yet"`, -3, s.tick + TICKS_PER_DAY);
    return;
  }
  removeRel(p, o.id, 'lover');
  removeRel(o, p.id, 'lover');
  addRel(s, p, o.id, 'spouse');
  addRel(s, o, p.id, 'spouse');
  for (const [x, y] of [[p, o], [o, p]] as const) {
    addMemory(x, 'wedding', 'Got married', 12, s.tick + TICKS_PER_DAY * 3);
    story(s, x, `Married ${firstName(y)}.`);
  }
  for (const w of s.pawns) {
    if (w.kind === 'colonist' && w !== p && w !== o && w.life === 'ok') addMemory(w, 'wedding', 'Went to a wedding', 4, s.tick + TICKS_PER_DAY);
  }
  log(s, 'good', `${firstName(p)} and ${firstName(o)} were married.`, true);
}

function breakUp(s: SimState, p: Pawn, o: Pawn): void {
  for (const [x, y] of [[p, o], [o, p]] as const) {
    removeRel(x, y.id, 'lover');
    removeRel(x, y.id, 'spouse');
    addRel(s, x, y.id, 'ex');
    addMemory(x, 'breakup', `Broke up with ${firstName(y)}`, -10, s.tick + TICKS_PER_DAY * 2);
    story(s, x, `Broke up with ${firstName(y)}.`);
  }
  log(s, 'social', `${firstName(p)} and ${firstName(o)} broke up.`, true);
}

/** Tracks friendships and rivalries as opinions cross thresholds, and writes them into both stories. */
export function updateBond(s: SimState, p: Pawn, o: Pawn): void {
  const v = opinion(s, p, o);
  if (!hasRel(p, o.id, 'friend') && v >= 25) {
    addRel(s, p, o.id, 'friend');
    story(s, p, `Became friends with ${firstName(o)}.`);
    if (hasRel(o, p.id, 'friend')) log(s, 'social', `${firstName(p)} and ${firstName(o)} are friends now.`);
  } else if (hasRel(p, o.id, 'friend') && v < 10) {
    removeRel(p, o.id, 'friend');
  }
  if (!hasRel(p, o.id, 'rival') && v <= -25) {
    addRel(s, p, o.id, 'rival');
    story(s, p, `Came to resent ${firstName(o)}.`);
    log(s, 'social', `${firstName(p)} can’t stand ${firstName(o)} any more.`);
  } else if (hasRel(p, o.id, 'rival') && v > -10) {
    removeRel(p, o.id, 'rival');
  }
}

/** Fighting side by side draws people together. */
export function foughtTogether(s: SimState, p: Pawn): void {
  for (const o of s.pawns) {
    if (o === p || o.kind !== 'colonist' || o.life !== 'ok') continue;
    if (o.job?.kind !== 'fight' && !o.drafted) continue;
    if (cheb(pawnTile(p), pawnTile(o)) > 6) continue;
    addSocial(s, p, o, 'fought', 'Fought beside me', 4, 4, 3);
  }
}

/** Everyone reacts to a death according to who the dead were to them. */
export function mourn(s: SimState, dead: Pawn): void {
  const name = firstName(dead);
  const days = TICKS_PER_DAY;
  for (const o of s.pawns) {
    if (o === dead || o.kind !== 'colonist' || o.life === 'dead') continue;
    const key = `death:${dead.id}`;
    const rels = relationsWith(o, dead.id).map((r) => r.kind);
    if (has(o, 'coldHearted')) continue;
    if (rels.includes('spouse') || rels.includes('lover')) {
      addMemory(o, key, `${name}, my ${rels.includes('spouse') ? 'spouse' : 'love'}, died`, -25, s.tick + days * 4);
      story(s, o, `Lost ${name}, ${rels.includes('spouse') ? 'a spouse' : 'a great love'}.`);
    } else if (rels.includes('sibling') || rels.includes('parent') || rels.includes('child')) {
      const rel = rels.includes('sibling') ? 'sibling' : rels.includes('parent') ? 'parent' : 'child';
      addMemory(o, key, `My ${rel} ${name} died`, -18, s.tick + days * 3);
      story(s, o, `Lost ${name}, family.`);
    } else if (rels.includes('friend')) {
      addMemory(o, key, `My friend ${name} died`, -14, s.tick + days * 3);
      story(s, o, `Lost a friend: ${name}.`);
    } else if (rels.includes('rival')) {
      if (!has(o, 'kind')) addMemory(o, key, `My rival ${name} died`, 4, s.tick + days);
    } else {
      addMemory(o, key, `${name} died`, -6, s.tick + days * 2);
    }
  }
}

/** Makes some of the first settlers family or old friends, so the story starts with ties. */
export function seedRelations(s: SimState, group: Pawn[]): void {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i];
      const b = group[j];
      const r = random(s.rng);
      if (a.name.split(' ')[1] === b.name.split(' ')[1]) {
        addRel(s, a, b.id, 'sibling');
        addRel(s, b, a.id, 'sibling');
      } else if (r < 0.1 && a.age >= 18 && b.age >= 18 && Math.abs(a.age - b.age) <= 12 && !partnerOf(a) && !partnerOf(b)) {
        addRel(s, a, b.id, 'lover');
        addRel(s, b, a.id, 'lover');
      } else if (r < 0.4) {
        addSocial(s, a, b, 'history', 'Old friends', 26, 30);
        addSocial(s, b, a, 'history', 'Old friends', 26, 30);
        addRel(s, a, b.id, 'friend');
        addRel(s, b, a.id, 'friend');
        story(s, a, `Has been friends with ${firstName(b)} for years.`);
        story(s, b, `Has been friends with ${firstName(a)} for years.`);
      } else if (r < 0.48) {
        addSocial(s, a, b, 'history', 'Bad blood', -26, 30);
        addRel(s, a, b.id, 'rival');
        story(s, a, `Has never forgiven ${firstName(b)} for something that happened long ago.`);
      }
    }
  }
}
