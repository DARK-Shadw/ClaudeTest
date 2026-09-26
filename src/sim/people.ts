/** Colonists and goblins: names, backstories, traits and starting stats. */
import { B } from './constants';
import { tileX, tileY } from './grid';
import { chance, pick, randInt } from './rng';
import type { Pawn, PawnKind, SimState, SkillId, TraitId } from './types';

export interface TraitInfo {
  label: string;
  desc: string;
}

export const TRAITS: Record<TraitId, TraitInfo> = {
  brave: { label: 'Brave', desc: 'Never flees, even when badly hurt.' },
  coward: { label: 'Coward', desc: 'Flees from fights unless cornered.' },
  industrious: { label: 'Industrious', desc: 'Works 25% faster.' },
  lazy: { label: 'Lazy', desc: 'Works 20% slower.' },
  glutton: { label: 'Glutton', desc: 'Gets hungry 40% faster.' },
  optimist: { label: 'Optimist', desc: '+8 mood, always.' },
  pessimist: { label: 'Pessimist', desc: '−8 mood, always.' },
  tough: { label: 'Tough', desc: 'Takes 30% less damage and rarely bleeds out.' },
  bloodlust: { label: 'Bloodlust', desc: 'Charges any raider on sight and enjoys the fight.' },
  greenThumb: { label: 'Green thumb', desc: 'Picks 50% more berries.' },
};

export const SKILL_LABEL: Record<SkillId, string> = {
  build: 'Build',
  gather: 'Gather',
  cook: 'Cook',
  combat: 'Combat',
};

const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

const CONFLICTS: ReadonlyArray<readonly [TraitId, TraitId]> = [
  ['brave', 'coward'],
  ['industrious', 'lazy'],
  ['optimist', 'pessimist'],
  ['coward', 'bloodlust'],
];

const FIRST_NAMES = [
  'Aldric', 'Brenna', 'Cael', 'Dara', 'Edda', 'Finn', 'Galen', 'Hild', 'Isolde', 'Joran',
  'Kestrel', 'Lio', 'Maren', 'Nell', 'Orin', 'Pip', 'Quill', 'Rowan', 'Sable', 'Tamsin',
  'Ulric', 'Vesna', 'Wren', 'Yara', 'Bram', 'Ansel', 'Corin', 'Ilse', 'Marek', 'Odile',
  'Teodor', 'Anika', 'Silas', 'Juniper', 'Hale', 'Ebba', 'Ivo', 'Runa', 'Thane', 'Mira',
];

const LAST_NAMES = [
  'Ashford', 'Brightwater', 'Stonehand', 'Thistlewood', 'Marsh', 'Oakes', 'Fenwick', 'Holloway',
  'Redfern', 'Cinder', 'Moss', 'Whitlock', 'Ravel', 'Greaves', 'Dunmore', 'Tallow', 'Vane',
  'Hollis', 'Crane', 'Wilder',
];

const BACKSTORIES: ReadonlyArray<{ text: string; skills: Partial<Record<SkillId, number>> }> = [
  { text: 'Former city guard', skills: { combat: 4 } },
  { text: 'Hedge carpenter', skills: { build: 4 } },
  { text: 'Tavern cook', skills: { cook: 4 } },
  { text: 'Forager from the deep woods', skills: { gather: 4 } },
  { text: 'Disgraced knight', skills: { combat: 3, build: 1 } },
  { text: 'Runaway apprentice mason', skills: { build: 3, gather: 1 } },
  { text: 'Shepherd from the hills', skills: { gather: 2, cook: 2 } },
  { text: 'Exiled alchemist', skills: { cook: 3, gather: 1 } },
  { text: 'Army deserter', skills: { combat: 3, gather: 1 } },
  { text: "Miller's child", skills: { cook: 2, build: 2 } },
  { text: 'Woodcutter', skills: { gather: 3, build: 1 } },
  { text: 'Wandering minstrel', skills: { cook: 1, gather: 1 } },
];

const GOBLIN_NAMES = [
  'Snagtooth', 'Grubnik', 'Rotgut', 'Skab', 'Nibbs', 'Gorza', 'Vex', 'Mogg',
  'Krikk', 'Blight', 'Scuzz', 'Nettle', 'Grimble', 'Sprog', 'Wort', 'Gnash',
];

/** Palette sizes, mirrored by the renderer's colour tables. */
export const LOOKS = { skin: 6, shirt: 8, hair: 6 } as const;

function basePawn(s: SimState, kind: PawnKind, name: string, tile: number, hp: number): Pawn {
  const x = tileX(tile);
  const y = tileY(tile);
  return {
    id: s.nextId++,
    kind,
    name,
    x,
    y,
    fromX: x,
    fromY: y,
    moveT: 0,
    moveDur: 0,
    path: [],
    hp,
    maxHp: hp,
    life: 'ok',
    bleed: 0,
    gone: false,
    attackCd: 0,
    lastAttackTick: -100,
    hitTick: -100,
    faceX: 0,
    faceY: 1,
    food: 80,
    rest: 85,
    mood: 50,
    memories: [],
    traits: [],
    skills: { build: 3, gather: 3, cook: 3, combat: 3 },
    backstory: '',
    role: 'any',
    job: null,
    thinkAt: 0,
    carry: null,
    mental: null,
    look: { skin: 0, shirt: 0, hair: 0 },
    bedId: 0,
    raidId: 0,
    looter: false,
    kills: 0,
  };
}

function rollTraits(s: SimState): TraitId[] {
  const count = chance(s.rng, 0.6) ? 2 : 1;
  const traits: TraitId[] = [];
  for (let tries = 0; traits.length < count && tries < 20; tries++) {
    const t = pick(s.rng, TRAIT_IDS);
    if (traits.includes(t)) continue;
    if (CONFLICTS.some(([a, b]) => (a === t && traits.includes(b)) || (b === t && traits.includes(a)))) continue;
    traits.push(t);
  }
  return traits;
}

export function makeColonist(s: SimState, tile: number): Pawn {
  const taken = new Set(s.pawns.map((p) => p.name.split(' ')[0]));
  let first = pick(s.rng, FIRST_NAMES);
  for (let i = 0; i < 20 && taken.has(first); i++) first = pick(s.rng, FIRST_NAMES);
  const p = basePawn(s, 'colonist', `${first} ${pick(s.rng, LAST_NAMES)}`, tile, B.colonistHp);
  const story = pick(s.rng, BACKSTORIES);
  p.backstory = story.text;
  for (const skill of Object.keys(p.skills) as SkillId[]) {
    p.skills[skill] = Math.min(10, randInt(s.rng, 1, 4) + (story.skills[skill] ?? 0));
  }
  p.traits = rollTraits(s);
  p.food = randInt(s.rng, 70, 90);
  p.rest = randInt(s.rng, 75, 95);
  p.look = {
    skin: randInt(s.rng, 0, LOOKS.skin - 1),
    shirt: randInt(s.rng, 0, LOOKS.shirt - 1),
    hair: randInt(s.rng, 0, LOOKS.hair - 1),
  };
  return p;
}

export function makeGoblin(s: SimState, tile: number, raidId: number): Pawn {
  const p = basePawn(s, 'goblin', pick(s.rng, GOBLIN_NAMES), tile, B.goblinHp);
  p.skills = { build: 0, gather: 0, cook: 0, combat: 4 };
  p.raidId = raidId;
  p.looter = chance(s.rng, 0.3);
  p.look = { skin: 0, shirt: randInt(s.rng, 0, 3), hair: 0 };
  return p;
}
