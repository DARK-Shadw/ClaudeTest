/** Colonists, goblins and animals: names, backstories, traits, skills and starting stats. */
import { B } from './constants';
import { SKILLS, SPECIES } from './defs';
import { tileX, tileY } from './grid';
import { chance, pick, randInt, random } from './rng';
import type {
  Chief,
  GoblinUnit,
  Incapable,
  Passion,
  Pawn,
  PawnKind,
  SimState,
  SkillId,
  Species,
  TraitId,
  WeaponId,
} from './types';

export interface TraitInfo {
  label: string;
  desc: string;
}

export const TRAITS: Record<TraitId, TraitInfo> = {
  brave: { label: 'Brave', desc: 'Never flees, even when badly hurt.' },
  coward: { label: 'Coward', desc: 'Runs from fights unless cornered.' },
  bloodlust: { label: 'Bloodlust', desc: 'Charges any enemy on sight and enjoys the kill.' },
  tough: { label: 'Tough', desc: 'Takes 30% less damage and rarely bleeds out.' },
  wimp: { label: 'Wimp', desc: 'Collapses from pain at a third of their health.' },
  nimble: { label: 'Nimble', desc: 'Dodges one blow in six.' },
  fastWalker: { label: 'Fast walker', desc: 'Gets everywhere 20% sooner.' },
  industrious: { label: 'Industrious', desc: 'Works 25% faster.' },
  lazy: { label: 'Lazy', desc: 'Works 20% slower.' },
  glutton: { label: 'Glutton', desc: 'Gets hungry 40% faster.' },
  ascetic: { label: 'Ascetic', desc: 'Doesn’t mind bare rooms, raw food or sleeping rough.' },
  optimist: { label: 'Optimist', desc: '+8 mood, always.' },
  pessimist: { label: 'Pessimist', desc: '−8 mood, always.' },
  kind: { label: 'Kind', desc: 'Never insults anyone. People warm to them.' },
  abrasive: { label: 'Abrasive', desc: 'Says what they think, and it often hurts.' },
  greedy: { label: 'Greedy', desc: 'Wants an impressive bedroom, and sulks without one.' },
  nightOwl: { label: 'Night owl', desc: 'Sleeps by day, works by night, and loves the dark.' },
  greenThumb: { label: 'Green thumb', desc: 'Grows and gathers plants faster, with bigger harvests.' },
  beautiful: { label: 'Beautiful', desc: 'Others think better of them at a glance.' },
  ugly: { label: 'Ugly', desc: 'Others think worse of them at a glance.' },
  tooSmart: { label: 'Too smart', desc: 'Learns 75% faster, but breaks down more easily.' },
  ironWilled: { label: 'Iron-willed', desc: 'Very hard to break.' },
  volatile: { label: 'Volatile', desc: 'Snaps easily and picks fights.' },
  coldHearted: { label: 'Cold-hearted', desc: 'Feels nothing when others die.' },
};

const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

const CONFLICTS: ReadonlyArray<readonly [TraitId, TraitId]> = [
  ['brave', 'coward'],
  ['coward', 'bloodlust'],
  ['tough', 'wimp'],
  ['industrious', 'lazy'],
  ['optimist', 'pessimist'],
  ['kind', 'abrasive'],
  ['kind', 'coldHearted'],
  ['beautiful', 'ugly'],
  ['ironWilled', 'volatile'],
  ['ascetic', 'greedy'],
  ['ascetic', 'glutton'],
];

export const conflicts = (a: TraitId, b: TraitId): boolean =>
  CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

interface Backstory {
  title: string;
  text: string;
  skills: Partial<Record<SkillId, number>>;
  incapable?: Incapable;
}

/** Text uses {name}. Stories speak of the settler by name only. */
const CHILDHOODS: readonly Backstory[] = [
  { title: 'Farm child', text: '{name} grew up pulling weeds and feeding hens on a hill farm.', skills: { plants: 3, cooking: 1 } },
  { title: 'Street urchin', text: '{name} survived the alleys of a port city by fists and wits.', skills: { melee: 2, social: 1 } },
  { title: 'Temple acolyte', text: '{name} was raised by priests who taught letters and herbcraft.', skills: { intellect: 2, medicine: 2 } },
  {
    title: 'Noble heir',
    text: '{name} grew up in silk and was never once asked to carry anything.',
    skills: { social: 3, intellect: 2 },
    incapable: 'dumb',
  },
  { title: 'Hunter’s child', text: '{name} could track a hare through snow before learning to read.', skills: { shooting: 3, plants: 1 } },
  { title: 'Smith’s apprentice', text: '{name} spent childhood at the bellows, burned and happy.', skills: { crafting: 3, construction: 1 } },
  { title: 'War orphan', text: '{name} lost everything to a war nobody remembers the reason for.', skills: { melee: 1, shooting: 1, medicine: 1 } },
  { title: 'Shepherd', text: '{name} kept sheep in the high meadows and wolves away from them.', skills: { plants: 1, shooting: 2 } },
  { title: 'Miner’s kid', text: '{name} knew the dark under the mountain better than the sun.', skills: { mining: 3, construction: 1 } },
  { title: 'Library mouse', text: '{name} lived among the stacks of a crumbling library.', skills: { intellect: 4 } },
  { title: 'Runaway', text: '{name} ran from home at ten and never looked back.', skills: { social: 1, construction: 1, melee: 1 } },
  { title: 'Sickly child', text: '{name} spent years in bed, reading and watching the healers work.', skills: { intellect: 2, medicine: 2 } },
  { title: 'Fisher’s child', text: '{name} mended nets and gutted fish on a cold grey shore.', skills: { cooking: 2, crafting: 1 } },
  { title: 'Circus kid', text: '{name} grew up juggling knives in a travelling troupe.', skills: { social: 2, melee: 1 } },
];

const ADULTHOODS: readonly Backstory[] = [
  { title: 'City guard', text: 'Then {name} walked the walls of a city at night for years.', skills: { melee: 3, shooting: 2 } },
  { title: 'Carpenter', text: 'Then {name} built houses, carts and coffins for a small town.', skills: { construction: 4, crafting: 1 } },
  { title: 'Tavern cook', text: 'Then {name} fed a rowdy tavern every night of the week.', skills: { cooking: 4, social: 1 } },
  { title: 'Forester', text: 'Then {name} kept a lord’s forest, and the poachers out of it.', skills: { plants: 3, shooting: 2 } },
  { title: 'Disgraced knight', text: 'Then {name} was a knight, until one terrible decision.', skills: { melee: 4, social: 1 } },
  { title: 'Mason', text: 'Then {name} cut and laid stone for castles that still stand.', skills: { construction: 2, mining: 2 } },
  { title: 'Herbalist', text: 'Then {name} sold remedies from a cart, some of which worked.', skills: { medicine: 3, plants: 2 } },
  { title: 'Army deserter', text: 'Then {name} fought in a war, and walked away from it one night.', skills: { shooting: 3, melee: 1 } },
  { title: 'Scholar', text: 'Then {name} studied old languages at a university by the sea.', skills: { intellect: 4, social: 1 } },
  { title: 'Blacksmith', text: 'Then {name} ran a forge, and was proud of every blade.', skills: { crafting: 4, mining: 1 } },
  { title: 'Minstrel', text: 'Then {name} sang for bread and beds across three kingdoms.', skills: { social: 4 } },
  { title: 'Poacher', text: 'Then {name} fed a village with a lord’s deer, and was nearly hanged for it.', skills: { shooting: 3, cooking: 1 } },
  { title: 'Pit fighter', text: 'Then {name} fought in the pits for coins and cheers.', skills: { melee: 4 } },
  {
    title: 'Monk',
    text: 'Then {name} took a vow never to raise a hand against anyone, and kept it.',
    skills: { medicine: 2, intellect: 2, plants: 1 },
    incapable: 'violence',
  },
  { title: 'Miner', text: 'Then {name} spent twenty years chasing silver down the dark.', skills: { mining: 4, construction: 1 } },
  { title: 'Merchant', text: 'Then {name} traded wool and gossip up and down the river.', skills: { social: 3, intellect: 1 } },
  { title: 'Farmer', text: 'Then {name} worked a patch of land until a bad year took it.', skills: { plants: 4, cooking: 1 } },
  { title: 'Hedge wizard', text: 'Then {name} learned a little real magic, and a lot of tricks.', skills: { intellect: 3, medicine: 1 } },
  { title: 'Mercenary', text: 'Then {name} fought for whoever paid, and sometimes won.', skills: { melee: 2, shooting: 2 } },
  { title: 'Beekeeper', text: 'Then {name} kept bees and brewed mead on a quiet hill.', skills: { plants: 2, cooking: 2 } },
  { title: 'Ship’s carpenter', text: 'Then {name} patched hulls on ships bound for strange ports.', skills: { construction: 3, crafting: 2 } },
  { title: 'Court physician', text: 'Then {name} treated a king, and fled when the king died anyway.', skills: { medicine: 4, social: 1 } },
];

const FIRST_NAMES = [
  'Aldric', 'Brenna', 'Cael', 'Dara', 'Edda', 'Finn', 'Galen', 'Hild', 'Isolde', 'Joran',
  'Kestrel', 'Lio', 'Maren', 'Nell', 'Orin', 'Pip', 'Quill', 'Rowan', 'Sable', 'Tamsin',
  'Ulric', 'Vesna', 'Wren', 'Yara', 'Bram', 'Ansel', 'Corin', 'Ilse', 'Marek', 'Odile',
  'Teodor', 'Anika', 'Silas', 'Juniper', 'Hale', 'Ebba', 'Ivo', 'Runa', 'Thane', 'Mira',
  'Tor', 'Lena', 'Darek', 'Erik', 'Solveig', 'Piet', 'Agna', 'Bastien', 'Cora', 'Dagny',
];

const LAST_NAMES = [
  'Ashford', 'Brightwater', 'Stonehand', 'Thistlewood', 'Marsh', 'Oakes', 'Fenwick', 'Holloway',
  'Redfern', 'Cinder', 'Moss', 'Whitlock', 'Ravel', 'Greaves', 'Dunmore', 'Tallow', 'Vane',
  'Hollis', 'Crane', 'Wilder', 'Harrow', 'Pike', 'Emberly', 'Frost',
];

const GOBLIN_NAMES = [
  'Snagtooth', 'Grubnik', 'Rotgut', 'Skab', 'Nibbs', 'Gorza', 'Vex', 'Mogg',
  'Krikk', 'Blight', 'Scuzz', 'Nettle', 'Grimble', 'Sprog', 'Wort', 'Gnash',
  'Ratbag', 'Squint', 'Blotch', 'Ugrub', 'Kazz', 'Muck', 'Fester', 'Grot',
];

const CHIEF_NAMES = ['Varek', 'Ghazrak', 'Skarn', 'Uzgul', 'Morgra', 'Throk', 'Bolgra', 'Krazzik', 'Gulvar', 'Rendar'];
const CHIEF_TITLES = ['the Cruel', 'the Hungry', 'Bonebreaker', 'the Red', 'Ironjaw', 'the Sly', 'Skullsplitter', 'the Loud'];
const WARBANDS = ['Red Hand', 'Broken Tusk', 'Black Mire', 'Rot Fang', 'Ash Clan', 'Gnawed Bone', 'Grey Rot', 'Howling Pit'];

/** Palette sizes, mirrored by the renderer's colour tables. */
export const LOOKS = { skin: 6, shirt: 8, hair: 6 } as const;

const zeroSkills = (): Record<SkillId, number> =>
  Object.fromEntries(SKILLS.map((k) => [k, 0])) as Record<SkillId, number>;

function basePawn(s: SimState, kind: PawnKind, name: string, tile: number, hp: number): Pawn {
  const x = tileX(tile);
  const y = tileY(tile);
  return {
    id: s.nextId++,
    kind,
    name,
    species: '',
    unit: '',
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
    lastHitBy: 0,
    shotTick: -100,
    shotTo: -1,
    faceX: 0,
    faceY: 1,
    food: 80,
    rest: 85,
    joy: 70,
    mood: 50,
    memories: [],
    traits: [],
    skills: zeroSkills(),
    xp: zeroSkills(),
    passions: zeroSkills() as Record<SkillId, Passion>,
    incapable: [],
    age: 30,
    calling: '',
    childhood: '',
    adulthood: '',
    story: [],
    social: [],
    relations: [],
    role: 'any',
    job: null,
    thinkAt: 0,
    gearAt: 0,
    socialAt: 0,
    carry: null,
    weapon: 'fists',
    armor: 'none',
    drafted: false,
    mental: null,
    look: { skin: 0, shirt: 0, hair: 0 },
    bedId: 0,
    raidId: 0,
    looter: false,
    chiefId: 0,
    grudge: 0,
    hostile: false,
    marked: false,
    kills: 0,
  };
}

function rollTraits(s: SimState): TraitId[] {
  const r = random(s.rng);
  const count = r < 0.25 ? 1 : r < 0.8 ? 2 : 3;
  const traits: TraitId[] = [];
  for (let tries = 0; traits.length < count && tries < 30; tries++) {
    const t = pick(s.rng, TRAIT_IDS);
    if (traits.includes(t) || traits.some((o) => conflicts(o, t))) continue;
    traits.push(t);
  }
  return traits;
}

export interface ColonistOptions {
  lastName?: string;
  minAge?: number;
  maxAge?: number;
}

export function makeColonist(s: SimState, tile: number, opts: ColonistOptions = {}): Pawn {
  const taken = new Set(s.pawns.map((p) => p.name.split(' ')[0]));
  let first = pick(s.rng, FIRST_NAMES);
  for (let i = 0; i < 30 && taken.has(first); i++) first = pick(s.rng, FIRST_NAMES);
  const p = basePawn(s, 'colonist', `${first} ${opts.lastName ?? pick(s.rng, LAST_NAMES)}`, tile, B.colonistHp);
  p.age = randInt(s.rng, opts.minAge ?? 17, opts.maxAge ?? 64);
  const child = pick(s.rng, CHILDHOODS);
  const adult = p.age >= 20 ? pick(s.rng, ADULTHOODS) : null;
  p.childhood = child.text.replace('{name}', first) + ` (${child.title})`;
  p.adulthood = adult ? adult.text.replace('{name}', first) + ` (${adult.title})` : `${first} is still young, and left home only recently.`;
  p.calling = adult?.title ?? child.title;

  for (const skill of SKILLS) {
    const bonus = (child.skills[skill] ?? 0) + (adult?.skills[skill] ?? 0);
    const level = Math.min(20, randInt(s.rng, 0, 3) + bonus + Math.floor(Math.min(p.age, 50) / 18));
    p.skills[skill] = level;
    const roll = random(s.rng);
    const bias = bonus >= 3 ? 0.35 : bonus > 0 ? 0.15 : 0;
    p.passions[skill] = roll < 0.07 + bias / 3 ? 2 : roll < 0.25 + bias ? 1 : 0;
  }
  for (const inc of [child.incapable, adult?.incapable]) {
    if (inc && !p.incapable.includes(inc)) p.incapable.push(inc);
  }
  if (p.incapable.includes('violence')) {
    p.skills.melee = 0;
    p.skills.shooting = 0;
    p.passions.melee = 0;
    p.passions.shooting = 0;
  }
  p.traits = rollTraits(s);
  if (p.traits.includes('bloodlust') && p.incapable.includes('violence')) p.traits = p.traits.filter((t) => t !== 'bloodlust');
  p.food = randInt(s.rng, 70, 90);
  p.rest = randInt(s.rng, 75, 95);
  p.joy = randInt(s.rng, 55, 80);
  p.look = {
    skin: randInt(s.rng, 0, LOOKS.skin - 1),
    shirt: randInt(s.rng, 0, LOOKS.shirt - 1),
    hair: randInt(s.rng, 0, LOOKS.hair - 1),
  };
  p.socialAt = s.tick + randInt(s.rng, 60, 200);
  return p;
}

// Goblins

export interface GoblinStats {
  hp: number;
  weapon: WeaponId;
  melee: number;
  shooting: number;
}

export const GOBLIN_UNITS: Record<GoblinUnit, { label: string; cost: number }> = {
  fighter: { label: 'Goblin raider', cost: 1 },
  archer: { label: 'Goblin archer', cost: 1.3 },
  brute: { label: 'Goblin brute', cost: 3 },
  chief: { label: 'Goblin chief', cost: 4 },
};

export function makeGoblin(s: SimState, tile: number, raidId: number, unit: GoblinUnit, chief?: Chief): Pawn {
  const hp = unit === 'brute' ? 130 : unit === 'chief' ? 100 + (chief?.level ?? 1) * 15 : unit === 'archer' ? 40 : 50;
  const name = chief ? `${chief.name} ${chief.title}` : pick(s.rng, GOBLIN_NAMES);
  const p = basePawn(s, 'goblin', name, tile, hp);
  p.unit = unit;
  p.raidId = raidId;
  p.chiefId = chief?.id ?? 0;
  p.looter = unit === 'fighter' && chance(s.rng, 0.3);
  p.skills.melee = unit === 'chief' ? 8 + (chief?.level ?? 1) : unit === 'brute' ? 7 : randInt(s.rng, 3, 6);
  p.skills.shooting = unit === 'archer' ? randInt(s.rng, 4, 7) : 2;
  p.weapon = unit === 'archer' ? 'bow' : unit === 'brute' ? 'maul' : unit === 'chief' ? 'axe' : chance(s.rng, 0.5) ? 'club' : 'spear';
  p.armor = unit === 'chief' ? 'leatherArmor' : 'none';
  p.look = { skin: 0, shirt: randInt(s.rng, 0, 3), hair: 0 };
  return p;
}

export function makeChief(s: SimState): Chief {
  return {
    id: s.nextId++,
    name: pick(s.rng, CHIEF_NAMES),
    title: pick(s.rng, CHIEF_TITLES),
    warband: pick(s.rng, WARBANDS),
    level: 1,
    kills: [],
    alive: true,
    escapes: 0,
    scarred: false,
  };
}

// Animals

export function makeAnimal(s: SimState, tile: number, species: Species): Pawn {
  const spec = SPECIES[species];
  const p = basePawn(s, 'animal', spec.label, tile, spec.hp);
  p.species = species;
  p.weapon = spec.weapon;
  p.skills.melee = species === 'wolf' ? 7 : species === 'boar' ? 6 : 3;
  p.food = randInt(s.rng, 40, 100);
  p.look = { skin: 0, shirt: randInt(s.rng, 0, 2), hair: 0 };
  return p;
}
