/**
 * The HUD's sheets as plain functions from state to markup: a settler's life in four tabs,
 * creatures, the build, orders and zone menus, and the colony's research, crafting and roster.
 */
import { PALETTE } from '../render/palette';
import {
  ARMORS,
  CRAFT_ORDER,
  ITEMS,
  MAX_SKILL,
  RECIPES,
  REL_LABEL,
  SKILLS,
  SKILL_LABEL,
  SPECIES,
  TECHS,
  TECH_ORDER,
  TRAITS,
  WEAPONS,
  WORK_LABEL,
  activityLabel,
  bondLabel,
  breakThreshold,
  canResearch,
  chiefName,
  countItems,
  dayOf,
  firstName,
  moodLabel,
  moodLines,
  opinion,
  opinionReasons,
  pawnTitle,
  techDone,
  workOrder,
  xpToNext,
  type CraftItem,
  type Pawn,
  type Role,
  type SimState,
  type SkillId,
  type TechId,
} from '../sim';
import { ICONS, type IconName } from './icons';
import { BUILD_CATEGORIES, TOOLS, techLabel, type ToolId } from './tools';
import { bar, esc, hex, icon, joinAnd, moodColor, plural } from './text';

export type PawnTab = 'overview' | 'skills' | 'social' | 'story';
export type ColonyTab = 'research' | 'crafting' | 'settlers';

export const PAWN_TABS: ReadonlyArray<{ id: PawnTab; label: string; icon: IconName }> = [
  { id: 'overview', label: 'Overview', icon: 'person' },
  { id: 'skills', label: 'Skills', icon: 'star' },
  { id: 'social', label: 'Social', icon: 'heart' },
  { id: 'story', label: 'Story', icon: 'scroll' },
];

export const COLONY_TABS: ReadonlyArray<{ id: ColonyTab; label: string; icon: IconName }> = [
  { id: 'research', label: 'Research', icon: 'research' },
  { id: 'crafting', label: 'Crafting', icon: 'craft' },
  { id: 'settlers', label: 'Settlers', icon: 'settlers' },
];

export const ROLES: ReadonlyArray<{ role: Role; label: string }> = [
  { role: 'any', label: 'Any' },
  { role: 'build', label: 'Build' },
  { role: 'farm', label: 'Farm' },
  { role: 'gather', label: 'Gather' },
  { role: 'cook', label: 'Cook' },
  { role: 'craft', label: 'Craft' },
  { role: 'hunt', label: 'Hunt' },
  { role: 'research', label: 'Research' },
  { role: 'haul', label: 'Haul' },
];

const ITEM_ICON: Partial<Record<string, IconName>> = {
  club: 'club',
  spear: 'spear',
  sword: 'sword',
  bow: 'bow',
  leatherArmor: 'armor',
  ironArmor: 'armor',
};

export const tabs = <T extends string>(list: ReadonlyArray<{ id: T; label: string; icon: IconName }>, current: T, attr: string): string =>
  `<div class="tabs">${list
    .map((t) => `<button class="tab${t.id === current ? ' on' : ''}" data-${attr}="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`)
    .join('')}</div>`;

export function avatar(p: Pawn, big = false): string {
  const shirt = p.kind === 'colonist' ? PALETTE.shirt[p.look.shirt] : p.kind === 'goblin' ? PALETTE.goblinSkin : PALETTE.deer;
  const ring = p.kind === 'colonist' ? moodColor(p.mood) : '#ff6b57';
  const mood = p.kind === 'colonist' ? Math.round(p.mood) : 100;
  return `<span class="avatar${big ? ' big' : ''}" style="--shirt:${hex(shirt)};--ring:${ring};--mood:${mood}"><b>${esc(p.name[0])}</b></span>`;
}

// Settlers

export function pawnHead(p: Pawn): string {
  const title = p.kind === 'colonist' ? `${p.calling}, ${p.age}` : pawnTitle(p);
  return `${avatar(p, true)}<div class="who"><h2>${esc(p.name)}</h2><p>${esc(title)}</p></div>`;
}

export function colonistBody(s: SimState, p: Pawn, tab: PawnTab, openRel: number): string {
  switch (tab) {
    case 'overview':
      return overview(s, p);
    case 'skills':
      return skillsTab(p);
    case 'social':
      return socialTab(s, p, openRel);
    case 'story':
      return storyTab(s, p);
  }
}

function scheduleText(p: Pawn): string {
  return p.traits.includes('nightOwl')
    ? 'Night owl: works through the night, relaxes at dawn, sleeps 9:00 to 17:00.'
    : 'Works 6:00 to 19:00, relaxes until 22:00, then sleeps.';
}

function overview(s: SimState, p: Pawn): string {
  const hurt = p.hp < p.maxHp * 0.35;
  const bars = [
    bar('Health', p.hp, p.maxHp, hurt ? '#ff6b57' : '#72d38c'),
    bar('Mood', p.mood, 100, moodColor(p.mood)),
    bar('Food', p.food, 100, p.food < 25 ? '#ff6b57' : '#ffc53d'),
    bar('Rest', p.rest, 100, p.rest < 20 ? '#ff6b57' : '#74c6ff'),
    bar('Fun', p.joy, 100, p.joy < 20 ? '#ff6b57' : '#c792ff'),
  ].join('');
  const weapon = WEAPONS[p.weapon];
  const gearIcon = ITEM_ICON[p.weapon] ?? 'fist';
  const gear = `<div class="gear">
    <span class="gear-item">${icon(gearIcon)}<span><b>${weapon.label}</b><em>${weapon.range > 1 ? `Range ${weapon.range}` : 'Melee'} · ${weapon.dmg[0]}–${weapon.dmg[1]} damage</em></span></span>
    <span class="gear-item">${icon('armor')}<span><b>${ARMORS[p.armor].label}</b><em>${p.armor === 'none' ? 'Takes full damage' : `Takes ${Math.round(ARMORS[p.armor].mul * 100)}% damage`}</em></span></span>
  </div>`;
  const lines = moodLines(s, p).slice(0, 7);
  const thoughts =
    `<p class="mood-title">Feeling ${moodLabel(p.mood).toLowerCase()} <span class="quiet">· breaks below ${breakThreshold(p)}</span></p>` +
    (lines.length
      ? `<ul>${lines.map((l) => `<li><b class="${l.mood >= 0 ? 'pos' : 'neg'}">${l.mood > 0 ? '+' : '−'}${Math.abs(l.mood)}</b>${esc(l.label)}</li>`).join('')}</ul>`
      : '<p class="quiet">Nothing on their mind.</p>');
  const roles = `<div class="roles"><span class="label">Focus</span><div class="seg">${ROLES.map(
    (r) => `<button data-role="${r.role}" class="${p.role === r.role ? 'on' : ''}">${r.label}</button>`,
  ).join('')}</div></div>`;
  const draft =
    p.life !== 'ok'
      ? ''
      : p.drafted
        ? `<button class="wide-btn" data-action="undraft-one">${icon('release')}<span>Release from duty</span></button>`
        : `<button class="wide-btn accent" data-action="draft-one">${icon('shield')}<span>Draft ${esc(firstName(p))}</span></button>`;
  const schedule = scheduleText(p);
  return `<p class="now"><span class="label">Now</span> ${esc(activityLabel(s, p))}</p>
    <div class="bars">${bars}</div>
    ${gear}
    <div class="thoughts">${thoughts}</div>
    ${roles}
    ${schedule ? `<p class="quiet small">${schedule}</p>` : ''}
    ${draft}`;
}

function skillsTab(p: Pawn): string {
  const rows = SKILLS.map((k: SkillId) => {
    const level = p.skills[k];
    const passion = p.passions[k];
    const flames = passion ? `<span class="passion p${passion}" title="${passion === 2 ? 'Burning passion' : 'Interested'}">${ICONS.flame}${passion === 2 ? ICONS.flame : ''}</span>` : '<span class="passion"></span>';
    const disabled = (k === 'melee' || k === 'shooting') && p.incapable.includes('violence');
    const xp = level >= MAX_SKILL ? 100 : Math.min(100, (p.xp[k] / xpToNext(level)) * 100);
    return `<li class="skill${disabled ? ' off' : ''}"><span class="nm">${SKILL_LABEL[k]}</span>${flames}<span class="lvl"><i style="--v:${((level / MAX_SKILL) * 100).toFixed(0)}%"></i><u style="--x:${xp.toFixed(0)}%"></u></span><b>${disabled ? '–' : level}</b></li>`;
  }).join('');
  const notes: string[] = [];
  if (p.incapable.includes('violence')) notes.push('Will not fight or hunt, ever.');
  if (p.incapable.includes('dumb')) notes.push('Will not haul: considers it beneath them.');
  const order = workOrder(p)
    .slice(0, 6)
    .map((w) => WORK_LABEL[w]);
  return `<ul class="skill-list">${rows}</ul>
    <p class="quiet small">${icon('flame', 'tiny p1')} interested · ${icon('flame', 'tiny p2')}${icon('flame', 'tiny p2')} burning passion: they learn faster and enjoy the work.</p>
    ${notes.map((n) => `<p class="note">${n}</p>`).join('')}
    <p class="label">Picks work in this order</p>
    <p class="work-order">${order.join(' → ')}</p>`;
}

function relationTags(p: Pawn, o: Pawn, mine: number): string[] {
  const tags = p.relations.filter((r) => r.id === o.id).map((r) => REL_LABEL[r.kind]);
  if (tags.length === 0) {
    const bond = bondLabel(mine);
    if (bond) tags.push(bond);
  }
  return tags;
}

function socialTab(s: SimState, p: Pawn, openRel: number): string {
  const others = s.pawns
    .filter((o) => o.kind === 'colonist' && o !== p)
    .map((o) => ({ o, mine: opinion(s, p, o), theirs: opinion(s, o, p) }))
    .sort((a, b) => b.mine - a.mine || a.o.id - b.o.id);
  const partner = p.relations.find((r) => r.kind === 'lover' || r.kind === 'spouse');
  const loves = partner ? s.pawns.find((o) => o.id === partner.id) : undefined;
  const friends = others.filter((r) => r.mine >= 20 && r.o !== loves).map((r) => firstName(r.o));
  const hates = others.filter((r) => r.mine <= -20).map((r) => firstName(r.o));
  const summary: string[] = [];
  if (loves) summary.push(`${partner!.kind === 'spouse' ? 'Married to' : 'In love with'} <b>${esc(firstName(loves))}</b>`);
  if (friends.length) summary.push(`Friends with <b>${esc(joinAnd(friends.slice(0, 4)))}</b>`);
  if (hates.length) summary.push(`Can’t stand <b class="neg">${esc(joinAnd(hates.slice(0, 4)))}</b>`);
  if (!summary.length) summary.push('No strong feelings about anyone yet.');
  const rows = others
    .map(({ o, mine, theirs }) => {
      const tags = relationTags(p, o, mine);
      const open = openRel === o.id;
      const reasons = open
        ? `<ul class="reasons">${opinionReasons(s, p, o)
            .map((l) => `<li><b class="${l.value >= 0 ? 'pos' : 'neg'}">${l.value > 0 ? '+' : '−'}${Math.abs(l.value)}</b>${esc(l.label)}</li>`)
            .join('') || '<li class="quiet">They barely know each other.</li>'}<li class="quiet">${esc(firstName(o))}’s opinion of ${esc(firstName(p))}: ${theirs > 0 ? '+' : ''}${theirs}</li></ul>`
        : '';
      return `<li class="rel${open ? ' open' : ''}" data-rel="${o.id}">
        <span class="dot" style="--c:${hex(PALETTE.shirt[o.look.shirt])}"></span>
        <span class="rel-name"><b>${esc(firstName(o))}</b><em>${esc(tags.join(' · ') || 'Acquaintance')}</em></span>
        <span class="op ${mine >= 0 ? 'pos' : 'neg'}">${mine > 0 ? '+' : ''}${mine}</span>
        ${reasons}</li>`;
    })
    .join('');
  const lost = p.relations
    .filter((r) => r.kind !== 'friend' && r.kind !== 'rival')
    .map((r) => ({ r, f: s.fallen.find((f) => f.id === r.id) }))
    .filter((x) => x.f)
    .map(({ r, f }) => `<li>${icon('skull')}<span>${REL_LABEL[r.kind]} <b>${esc(f!.name)}</b> ${esc(f!.cause)} on day ${dayOf(f!.tick)}.</span></li>`)
    .join('');
  return `<p class="social-sum">${summary.join('<br>')}</p>
    ${rows ? `<ul class="rel-list">${rows}</ul><p class="quiet small">Tap someone to see why.</p>` : '<p class="quiet">Nobody else lives here yet.</p>'}
    ${lost ? `<p class="label">Lost</p><ul class="lost">${lost}</ul>` : ''}`;
}

function storyTab(s: SimState, p: Pawn): string {
  const traits = p.traits
    .map((t) => `<li><b>${TRAITS[t].label}</b><span>${TRAITS[t].desc}</span></li>`)
    .join('');
  const chief = p.grudge ? s.chiefs.find((c) => c.id === p.grudge) : undefined;
  const timeline = [...p.story]
    .reverse()
    .map((e) => `<li><time>Day ${dayOf(e.tick)}</time><p>${esc(e.text)}</p></li>`)
    .join('');
  return `<p class="story-p"><span class="label">Childhood</span>${esc(p.childhood)}</p>
    <p class="story-p"><span class="label">Adulthood</span>${esc(p.adulthood)}</p>
    ${traits ? `<ul class="trait-list">${traits}</ul>` : ''}
    ${chief ? `<p class="grudge">${icon('sword')}<span>Has sworn to kill <b>${esc(chiefName(chief))}</b>${chief.alive ? '' : ', and saw them fall'}.</span></p>` : ''}
    <p class="label">Life in the Wildlands${p.kills ? ` · ${plural(p.kills, 'kill')}` : ''}</p>
    <ol class="timeline">${timeline}</ol>`;
}

// Goblins and animals

export function creatureBody(s: SimState, p: Pawn): string {
  const parts = [`<p class="now"><span class="label">Now</span> ${esc(activityLabel(s, p))}</p>`];
  parts.push(`<div class="bars one">${bar('Health', p.hp, p.maxHp, p.hp < p.maxHp * 0.35 ? '#ff6b57' : '#72d38c')}</div>`);
  if (p.kind === 'goblin') {
    const w = WEAPONS[p.weapon];
    parts.push(`<p class="quiet">Armed with a ${w.label.toLowerCase()} · melee ${p.skills.melee}${p.unit === 'archer' ? ` · shooting ${p.skills.shooting}` : ''}</p>`);
    const chief = p.chiefId ? s.chiefs.find((c) => c.id === p.chiefId) : undefined;
    if (chief) {
      const history = [
        `Chief of the ${chief.warband}, level ${chief.level}.`,
        chief.escapes ? `Has escaped ${plural(chief.escapes, 'time')}.` : 'Has never been beaten.',
        chief.kills.length ? `Has killed ${joinAnd(chief.kills)}.` : '',
      ].filter(Boolean);
      parts.push(`<p class="grudge">${icon('crown')}<span>${esc(history.join(' '))}</span></p>`);
      const avengers = s.pawns.filter((c) => c.kind === 'colonist' && c.grudge === chief.id).map(firstName);
      if (avengers.length) parts.push(`<p class="quiet">${esc(joinAnd(avengers))} ${avengers.length === 1 ? 'has' : 'have'} sworn to kill them.</p>`);
    }
    parts.push('<p class="quiet small">Draft your settlers and tap this goblin to attack it.</p>');
    return parts.join('');
  }
  const spec = SPECIES[p.species as keyof typeof SPECIES];
  const temper =
    p.hostile
      ? 'Part of a hungry pack hunting your settlers.'
      : spec.temper === 'skittish'
        ? 'Skittish: bolts when anyone comes close. Best hunted with a bow.'
        : spec.temper === 'defensive'
          ? 'Defensive: fights back hard when hurt.'
          : 'Predator: hunts deer and hares, and fights back when hurt.';
  parts.push(`<p class="quiet">${temper}</p><p class="quiet small">Yields about ${spec.meat} meat and ${spec.leather} leather.</p>`);
  if (!p.hostile) {
    parts.push(
      p.marked
        ? `<button class="wide-btn" data-action="unhunt">${icon('close')}<span>Stop hunting</span></button>`
        : `<button class="wide-btn accent" data-action="hunt">${icon('hunt')}<span>Hunt this ${esc(spec.label.toLowerCase())}</span></button>`,
    );
  }
  return parts.join('');
}

// Build, orders and zones

export function toolCard(s: SimState, tool: ToolId, active: boolean): string {
  const t = TOOLS[tool];
  const locked = t.tech && !techDone(s, t.tech);
  const meta = locked ? `${icon('lock', 'tiny')} ${techLabel(t.tech!)}` : (t.cost ?? '');
  return `<button class="build-card${active ? ' active' : ''}${locked ? ' locked' : ''}" data-tool="${tool}">${icon(t.icon)}<b>${t.label}</b><span>${esc(t.desc ?? '')}</span>${meta ? `<em>${meta}</em>` : ''}</button>`;
}

export function buildBody(s: SimState, category: string, activeTool: ToolId): string {
  const cat = BUILD_CATEGORIES.find((c) => c.id === category) ?? BUILD_CATEGORIES[0];
  const tabsHtml = `<div class="tabs wrap">${BUILD_CATEGORIES.map(
    (c) => `<button class="tab${c.id === cat.id ? ' on' : ''}" data-cat="${c.id}">${icon(c.icon)}<span>${c.label}</span></button>`,
  ).join('')}</div>`;
  return `${tabsHtml}<div class="build-grid">${cat.tools.map((t) => toolCard(s, t, t === activeTool)).join('')}</div>`;
}

export function toolGrid(s: SimState, tools: readonly ToolId[], activeTool: ToolId): string {
  return `<div class="build-grid">${tools.map((t) => toolCard(s, t, t === activeTool)).join('')}</div>`;
}

// Colony

export function colonyBody(s: SimState, tab: ColonyTab): string {
  switch (tab) {
    case 'research':
      return researchTab(s);
    case 'crafting':
      return craftingTab(s);
    case 'settlers':
      return settlersTab(s);
  }
}

function researchTab(s: SimState): string {
  const cur = s.research.current && !s.research.done.includes(s.research.current) ? s.research.current : '';
  const desks = s.structures.some((st) => st.kind === 'researchDesk');
  const pct = cur ? Math.min(100, (s.research.progress[cur] / TECHS[cur].cost) * 100) : 0;
  const head = cur
    ? `<div class="research-now"><span class="label">Studying</span><b>${TECHS[cur].label}</b><div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div><p>${
        desks ? `${pct.toFixed(0)}% · ${TECHS[cur].cost} points` : 'Nobody can study without a research desk (Build → Work).'
      }</p></div>`
    : `<p class="note">Pick something to study.${desks ? '' : ' Scholars also need a research desk (Build → Work).'}</p>`;
  const rows = TECH_ORDER.map((t: TechId) => {
    const spec = TECHS[t];
    const done = s.research.done.includes(t);
    const open = canResearch(s, t);
    const pct = Math.min(100, (s.research.progress[t] / spec.cost) * 100);
    const state = done ? 'done' : t === cur ? 'current' : open ? 'open' : 'locked';
    const tail = done
      ? icon('check', 'ok')
      : !open
        ? `<em>${icon('lock', 'tiny')} ${TECHS[spec.requires!].label}</em>`
        : t === cur
          ? '<em>Studying</em>'
          : `<em>${pct > 0 ? `${pct.toFixed(0)}% · ` : ''}${spec.cost}</em>`;
    return `<li class="tech ${state}"${open && !done ? ` data-tech="${t}"` : ''}><span class="tech-text"><b>${spec.label}</b><span>${esc(spec.desc)}</span></span>${tail}</li>`;
  }).join('');
  return `${head}<ul class="tech-list">${rows}</ul><p class="quiet small">Tap a subject to study it. Clever settlers with a passion for it learn fastest.</p>`;
}

function craftingTab(s: SimState): string {
  const benches = s.structures.some((st) => st.kind === 'craftBench');
  const rows = CRAFT_ORDER.map((item: CraftItem) => {
    const r = RECIPES[item];
    const locked = r.tech && !techDone(s, r.tech);
    const keep = s.orders[item];
    const have = countItems(s, item);
    return `<li class="craft${locked ? ' locked' : ''}">
      ${icon(ITEM_ICON[item] ?? 'craft')}
      <span class="craft-text"><b>${ITEMS[item].label}</b><span>${r.cost} ${r.material}${locked ? ` · needs ${TECHS[r.tech!].label}` : ''} · ${have} in stock</span></span>
      ${locked ? '' : `<span class="stepper"><button data-order="${item}" data-delta="-1" aria-label="Fewer">${icon('minus')}</button><b>${keep}</b><button data-order="${item}" data-delta="1" aria-label="More">${icon('plus')}</button></span>`}
    </li>`;
  }).join('');
  return `${benches ? '' : '<p class="note">Crafters need a crafting bench (Build → Work).</p>'}
    <p class="quiet small">Crafters keep this many of each in stock. Settlers pick up better gear on their own.</p>
    <ul class="craft-list">${rows}</ul>`;
}

function settlersTab(s: SimState): string {
  const rows = s.pawns
    .filter((p) => p.kind === 'colonist')
    .map(
      (p) => `<li class="settler" data-select="${p.id}">${avatar(p)}<span class="settler-text"><b>${esc(p.name)}</b><span>${esc(activityLabel(s, p))}</span></span>
        <select data-focus="${p.id}" aria-label="Focus for ${esc(firstName(p))}">${ROLES.map((r) => `<option value="${r.role}"${p.role === r.role ? ' selected' : ''}>${r.label}</option>`).join('')}</select></li>`,
    )
    .join('');
  return `<p class="quiet small">Everyone does whatever needs doing, best skills first. A focus makes them pick that work before anything else.</p><ul class="settler-list">${rows}</ul>`;
}

// First steps

export interface Goal {
  label: string;
  done: boolean;
}

export function goals(s: SimState): Goal[] {
  const colonists = s.pawns.filter((p) => p.kind === 'colonist').length;
  const has = (kind: string): boolean => s.structures.some((st) => st.kind === kind);
  return [
    { label: 'Mark trees and bushes with Orders → Harvest', done: s.designated.some(Boolean) },
    { label: 'Build a room with a bed for everyone', done: s.structures.filter((st) => st.kind === 'bed').length >= colonists },
    { label: 'Build a campfire so meals get cooked', done: has('campfire') },
    { label: 'Plant a rally point (Orders)', done: s.rally >= 0 },
    { label: 'Build a research desk and pick a subject', done: has('researchDesk') && (s.research.current !== '' || s.research.done.length > 0) },
    { label: 'Sow a potato field before winter (Zones)', done: s.zone.some((z) => z === 2) },
    { label: 'Draft your settlers and win a fight', done: s.raidCount >= 1 && s.pawns.some((p) => p.kind === 'colonist' && p.kills > 0) },
  ];
}
