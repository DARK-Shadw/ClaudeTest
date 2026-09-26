/** The heads-up display: everything drawn over the map, built for thumbs first. */
import type { Game, ToolId } from '../game';
import { PALETTE } from '../render/palette';
import { daylight } from '../render/view';
import {
  SKILL_LABEL,
  STRUCTURES,
  TRAITS,
  activityLabel,
  countItems,
  dayOf,
  clockLabel,
  compass,
  hostiles,
  hourOf,
  isIndoors,
  moodLabel,
  moodLines,
  pawnBadge,
  spanLabel,
  stampLabel,
  MAP_N,
  TICKS_PER_DAY,
  type LogEntry,
  type LogKind,
  type Pawn,
  type Role,
  type SimState,
  type SkillId,
} from '../sim';
import { ICONS, type IconName } from './icons';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface ToolInfo {
  label: string;
  icon: IconName;
  hint: string;
}

const TOOLS: Record<ToolId, ToolInfo> = {
  select: { label: 'Select', icon: 'select', hint: '' },
  harvest: { label: 'Harvest', icon: 'harvest', hint: 'Drag over trees, bushes and rocks to gather them.' },
  zone: { label: 'Stockpile', icon: 'zone', hint: 'Drag to mark a stockpile. Settlers haul supplies there.' },
  rally: { label: 'Rally', icon: 'rally', hint: 'Tap where settlers gather to fight. Tap the flag to remove it.' },
  clear: { label: 'Clear', icon: 'clear', hint: 'Drag to cancel plans, harvest marks and stockpiles.' },
  demolish: { label: 'Demolish', icon: 'demolish', hint: 'Drag over buildings to take them apart for half their materials.' },
  room: { label: 'Room', icon: 'room', hint: 'Drag a rectangle. The door goes on the side facing you.' },
  wall: { label: 'Wall', icon: 'wall', hint: 'Drag to draw a wooden wall outline.' },
  stoneWall: { label: 'Stone wall', icon: 'stoneWall', hint: 'Drag to draw a stone wall outline.' },
  door: { label: 'Door', icon: 'door', hint: 'Tap a tile in a wall line to place a door.' },
  bed: { label: 'Bed', icon: 'bed', hint: 'Tap to place beds. Settlers sleep best indoors.' },
  campfire: { label: 'Campfire', icon: 'campfire', hint: 'Tap to place a campfire. Cooks turn berries into meals here.' },
  trap: { label: 'Spike trap', icon: 'trap', hint: 'Tap or drag to lay traps where goblins will walk.' },
};

const BUILD_MENU: ReadonlyArray<{ tool: ToolId; desc: string; cost: string }> = [
  { tool: 'room', desc: 'Walls and a door in one drag', cost: '3 wood a wall' },
  { tool: 'bed', desc: 'Better sleep, faster healing', cost: costOf('bed') },
  { tool: 'campfire', desc: 'Cooks meals, lights the night', cost: costOf('campfire') },
  { tool: 'wall', desc: 'Stops goblins until smashed', cost: costOf('wall') },
  { tool: 'stoneWall', desc: 'Takes far longer to smash', cost: costOf('stoneWall') },
  { tool: 'door', desc: 'Settlers pass, goblins bash', cost: costOf('door') },
  { tool: 'trap', desc: 'Wounds the first goblin on it', cost: costOf('trap') },
  { tool: 'demolish', desc: 'Returns half the materials', cost: 'Free' },
];

function costOf(kind: keyof typeof STRUCTURES): string {
  const spec = STRUCTURES[kind];
  return `${spec.cost} ${spec.material}`;
}

const BUILD_TOOLS: ReadonlySet<ToolId> = new Set(BUILD_MENU.map((b) => b.tool));

const ROLES: ReadonlyArray<{ role: Role; label: string }> = [
  { role: 'any', label: 'Any' },
  { role: 'build', label: 'Build' },
  { role: 'gather', label: 'Gather' },
  { role: 'cook', label: 'Cook' },
  { role: 'haul', label: 'Haul' },
];

const LOG_ICON: Record<LogKind, string> = {
  info: ICONS.info,
  good: ICONS.check,
  warn: ICONS.daze,
  bad: ICONS.warning,
  death: ICONS.down,
  raid: ICONS.sword,
};

const icon = (name: IconName): string => `<span class="i">${ICONS[name]}</span>`;

const TEMPLATE = `
<header class="topbar">
  <div class="chip clock"><span class="i" data-el="dayIcon"></span><b data-el="day">Day 1</b><span data-el="time">07:00</span></div>
  <div class="chip stocks" data-el="stocks">
    <span class="stock">${icon('wood')}<b data-el="wood">0</b><span class="sr">wood</span></span>
    <span class="stock">${icon('stone')}<b data-el="stone">0</b><span class="sr">stone</span></span>
    <span class="stock">${icon('berries')}<b data-el="berries">0</b><span class="sr">berries</span></span>
    <span class="stock">${icon('meal')}<b data-el="meal">0</b><span class="sr">meals</span></span>
  </div>
  <div class="top-actions">
    <button class="chip speed" data-action="speed" aria-label="Game speed">${icon('speed')}<b data-el="speed">1×</b></button>
    <button class="chip square" data-action="chronicle" aria-label="Chronicle">${icon('chronicle')}</button>
    <button class="chip square" data-action="menu" aria-label="Menu">${icon('menu')}</button>
  </div>
</header>
<div class="subbar">
  <div class="colonists" data-el="colonists"></div>
  <button class="chip goals-chip" data-action="goals" data-el="goalsChip">${icon('goals')}<span data-el="goalsCount"></span></button>
</div>
<button class="banner" data-el="banner" data-action="raid" hidden></button>
<div class="card goals-card" data-el="goals" hidden></div>
<button class="card info" data-el="info" data-action="info" hidden></button>
<div class="toasts" data-el="toasts" aria-live="polite"></div>
<div class="dock">
  <div class="hint" data-el="hint" hidden><span class="i" data-el="hintIcon"></span><span data-el="hintText"></span><button data-action="done">Done</button></div>
  <section class="sheet" data-sheet="colonist" hidden>
    <div class="sheet-head">
      <span class="avatar big" data-el="pAvatar"></span>
      <div class="who"><h2 data-el="pName"></h2><p data-el="pStory"></p></div>
      <button class="square close" data-action="close" aria-label="Close">${icon('close')}</button>
    </div>
    <p class="now" data-el="pNow"></p>
    <div class="traits" data-el="pTraits"></div>
    <div class="bars" data-el="pBars"></div>
    <div class="thoughts" data-el="pThoughts"></div>
    <div class="roles" data-el="pRoles"></div>
    <div class="skills" data-el="pSkills"></div>
  </section>
  <section class="sheet" data-sheet="build" hidden>
    <div class="sheet-head"><h2>Build</h2><button class="square close" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <div class="build-grid">
      ${BUILD_MENU.map(
        (b) => `<button class="build-card" data-tool="${b.tool}">${icon(TOOLS[b.tool].icon)}<b>${TOOLS[b.tool].label}</b><span>${b.desc}</span><em>${b.cost}</em></button>`,
      ).join('')}
    </div>
  </section>
  <section class="sheet" data-sheet="chronicle" hidden>
    <div class="sheet-head"><h2>Chronicle</h2><button class="toggle" data-action="chronicle-filter" data-el="chronicleFilter">Show everything</button><button class="square close" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <ol class="log" data-el="log"></ol>
  </section>
  <section class="sheet" data-sheet="menu" hidden>
    <div class="sheet-head"><h2>Hearthwild</h2><button class="square close" data-action="close" aria-label="Close">${icon('close')}</button></div>
    <div class="menu-list">
      <button class="menu-row" data-action="shadows"><span>Shadows</span><b data-el="shadowsState">On</b></button>
      <details class="menu-row how">
        <summary>How to play</summary>
        <ul>
          <li><b>Harvest</b> trees for wood, bushes for berries, boulders for stone.</li>
          <li>Settlers haul everything to the <b>stockpile</b>, cook berries at a <b>campfire</b> and sleep in <b>beds</b>.</li>
          <li>Goblins raid every two or three days, each band bigger than the last. Scouts warn you hours ahead.</li>
          <li>Settlers answer raids by who they are: cowards run, the bloodthirsty charge. Everyone else fights at the <b>rally point</b>, where they hit harder together.</li>
          <li>Downed settlers bleed out unless someone bandages them. The dead stay dead.</li>
        </ul>
      </details>
      <button class="menu-row danger" data-action="new"><span>Found a new settlement</span></button>
      <div class="confirm" data-el="confirm" hidden>
        <p>Abandon this settlement? It can't be undone.</p>
        <div class="row"><button class="danger-fill" data-action="new-confirm">Abandon</button><button data-action="new-cancel">Keep playing</button></div>
      </div>
      <p class="fine">Prototype build · one region, single player · saved on this device.</p>
    </div>
  </section>
  <nav class="toolbar" aria-label="Tools">
    ${(['select', 'harvest'] as ToolId[]).map((t) => toolButton(t)).join('')}
    <button class="tool" data-action="build" data-el="buildTool">${icon('build')}<span>Build</span></button>
    ${(['zone', 'rally', 'clear'] as ToolId[]).map((t) => toolButton(t)).join('')}
  </nav>
</div>
<div class="overlay" data-overlay="intro" hidden><div class="panel" data-el="intro"></div></div>
<div class="overlay" data-overlay="away" hidden><div class="panel" data-el="away"></div></div>
<div class="overlay" data-overlay="fallen" hidden><div class="panel" data-el="fallen"></div></div>
<div class="overlay" data-overlay="busy" hidden><div class="panel busy"><p>Catching up on time that passed…</p><div class="progress"><i data-el="busyBar"></i></div></div></div>
`;

function toolButton(tool: ToolId): string {
  return `<button class="tool" data-tool="${tool}">${icon(TOOLS[tool].icon)}<span>${TOOLS[tool].label}</span></button>`;
}

type Sheet = 'colonist' | 'build' | 'chronicle' | 'menu';

export class Hud {
  private readonly el: HTMLElement;
  private sheet: Sheet | null = null;
  private lastUpdate = 0;
  private lastLogId = 0;
  private chronicleAll = false;
  private readonly chips = new Map<number, HTMLButtonElement>();
  private pawnId = 0;
  private pawnRole = '';
  private infoTimer = 0;
  private goalsDone = new Set<number>();
  private goalsOpen = false;

  constructor(
    private readonly game: Game,
    root: HTMLElement,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = TEMPLATE;
    root.appendChild(this.el);
    this.el.addEventListener('click', this.onClick);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    this.showTool('select');
  }

  private q<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-el="${name}"]`)!;
  }

  private overlay(name: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(`[data-overlay="${name}"]`)!;
  }

  reset(s: SimState): void {
    this.lastLogId = s.log.at(-1)?.id ?? 0;
    this.goalsDone.clear();
    this.goalsOpen = false;
    this.pawnId = 0;
    this.closeSheet();
    this.q('toasts').innerHTML = '';
    for (const chip of this.chips.values()) chip.remove();
    this.chips.clear();
    for (const name of ['intro', 'away', 'fallen']) this.overlay(name).hidden = true;
    this.lastUpdate = 0;
  }

  skipLogTo(s: SimState): void {
    this.lastLogId = s.log.at(-1)?.id ?? 0;
  }

  // Events

  private onClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-tool],[data-select],[data-role],[data-trait]');
    if (!target) return;
    const { action, tool, select, role, trait } = target.dataset;
    if (tool) {
      this.game.setTool(tool as ToolId);
      if (this.sheet === 'build' || tool === 'select') this.closeSheet();
      return;
    }
    if (select) {
      this.game.select(Number(select), true);
      return;
    }
    if (role) {
      this.game.setRole(this.pawnId, role as Role);
      this.pawnRole = '';
      this.renderPawn(this.game.state);
      return;
    }
    if (trait) {
      const info = TRAITS[trait as keyof typeof TRAITS];
      if (info) this.showInfo(`${info.label}: ${info.desc}`);
      return;
    }
    switch (action) {
      case 'build':
      case 'chronicle':
      case 'menu':
        this.toggleSheet(action);
        break;
      case 'close':
        if (this.sheet === 'colonist') this.game.select(0);
        this.closeSheet();
        break;
      case 'speed': {
        const next = this.game.speed >= 3 ? 1 : this.game.speed + 1;
        this.game.setSpeed(next);
        this.q('speed').textContent = `${next}×`;
        break;
      }
      case 'done':
        this.game.setTool('select');
        break;
      case 'raid':
        this.game.focusRaid();
        break;
      case 'goals':
        this.goalsOpen = !this.goalsOpen;
        this.renderGoals(this.game.state);
        break;
      case 'info':
        this.q('info').hidden = true;
        break;
      case 'begin':
        this.overlay('intro').hidden = true;
        this.game.begin();
        break;
      case 'away-ok':
        this.overlay('away').hidden = true;
        break;
      case 'new':
        this.q('confirm').hidden = false;
        break;
      case 'new-cancel':
        this.q('confirm').hidden = true;
        break;
      case 'new-confirm':
      case 'restart':
        this.q('confirm').hidden = true;
        this.game.newSettlement();
        break;
      case 'shadows':
        this.game.setShadows(!this.game.prefs.shadows);
        this.q('shadowsState').textContent = this.game.prefs.shadows ? 'On' : 'Off';
        break;
      case 'chronicle-filter':
        this.chronicleAll = !this.chronicleAll;
        this.renderChronicle(this.game.state);
        break;
    }
  };

  // Sheets

  private toggleSheet(sheet: Sheet): void {
    if (this.sheet === sheet) this.closeSheet();
    else this.openSheet(sheet);
  }

  private openSheet(sheet: Sheet): void {
    if (this.sheet === 'colonist' && sheet !== 'colonist') this.game.selectedId = 0;
    this.sheet = sheet;
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-sheet]')) el.hidden = el.dataset.sheet !== sheet;
    if (sheet === 'chronicle') this.renderChronicle(this.game.state);
    if (sheet === 'menu') {
      this.q('shadowsState').textContent = this.game.prefs.shadows ? 'On' : 'Off';
      this.q('confirm').hidden = true;
    }
    this.syncToolbar();
  }

  private closeSheet(): void {
    this.sheet = null;
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-sheet]')) el.hidden = true;
    this.syncToolbar();
  }

  showTool(tool: ToolId): void {
    const info = TOOLS[tool];
    const hint = this.q('hint');
    hint.hidden = tool === 'select';
    if (tool !== 'select') {
      this.q('hintIcon').innerHTML = ICONS[info.icon];
      this.q('hintText').textContent = info.hint;
    }
    this.syncToolbar();
  }

  private syncToolbar(): void {
    const tool = this.game.tool;
    for (const b of this.el.querySelectorAll<HTMLElement>('.toolbar [data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
    this.q('buildTool').classList.toggle('active', BUILD_TOOLS.has(tool) || this.sheet === 'build');
    for (const b of this.el.querySelectorAll<HTMLElement>('.build-card')) b.classList.toggle('active', b.dataset.tool === tool);
  }

  showPawn(id: number): void {
    this.pawnId = id;
    this.pawnRole = '';
    if (id === 0) {
      if (this.sheet === 'colonist') this.closeSheet();
      return;
    }
    this.openSheet('colonist');
    this.renderPawn(this.game.state);
  }

  showInfo(text: string): void {
    const info = this.q('info');
    info.textContent = text;
    info.hidden = false;
    clearTimeout(this.infoTimer);
    this.infoTimer = window.setTimeout(() => (info.hidden = true), 3500);
  }

  // Per-frame update

  update(s: SimState, now: number): void {
    this.toastNewEntries(s);
    if (now - this.lastUpdate < 180) return;
    this.lastUpdate = now;

    const day = daylight(hourOf(s.tick)) > 0.4;
    this.q('dayIcon').innerHTML = day ? ICONS.sun : ICONS.moon;
    this.q('day').textContent = `Day ${dayOf(s.tick)}`;
    this.q('time').textContent = clockLabel(s.tick);
    this.q('wood').textContent = String(countItems(s, 'wood'));
    this.q('stone').textContent = String(countItems(s, 'stone'));
    this.q('berries').textContent = String(countItems(s, 'berries'));
    this.q('meal').textContent = String(countItems(s, 'meal'));
    this.q('speed').textContent = `${this.game.speed}×`;

    this.renderChips(s);
    this.renderBanner(s);
    this.renderGoals(s);
    if (this.sheet === 'colonist') this.renderPawn(s);
  }

  private renderChips(s: SimState): void {
    const row = this.q('colonists');
    const seen = new Set<number>();
    for (const p of s.pawns) {
      if (p.kind !== 'colonist') continue;
      seen.add(p.id);
      let chip = this.chips.get(p.id);
      if (!chip) {
        chip = document.createElement('button');
        chip.className = 'pawn-chip';
        chip.dataset.select = String(p.id);
        chip.innerHTML = `<span class="avatar"><b></b></span><span class="badge"></span><span class="nm"></span>`;
        row.appendChild(chip);
        this.chips.set(p.id, chip);
        chip.querySelector('b')!.textContent = p.name[0];
        chip.querySelector('.nm')!.textContent = p.name.split(' ')[0];
      }
      const avatar = chip.querySelector<HTMLElement>('.avatar')!;
      avatar.style.setProperty('--shirt', hex(PALETTE.shirt[p.look.shirt]));
      avatar.style.setProperty('--mood', String(Math.round(p.mood)));
      avatar.style.setProperty('--ring', moodColor(p.mood));
      const badge = pawnBadge(p);
      const b = chip.querySelector<HTMLElement>('.badge')!;
      b.className = `badge${badge ? ` badge-${badge}` : ''}`;
      b.innerHTML = badge ? ICONS[BADGE_ICON[badge]] : '';
      chip.classList.toggle('selected', p.id === this.game.selectedId);
      chip.classList.toggle('downed', p.life === 'downed');
      chip.setAttribute('aria-label', `${p.name}, ${activityLabel(s, p)}`);
    }
    for (const [id, chip] of this.chips) {
      if (seen.has(id)) continue;
      chip.remove();
      this.chips.delete(id);
    }
  }

  private renderBanner(s: SimState): void {
    const banner = this.q('banner');
    const r = s.raid;
    if (!r) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    if (r.phase === 'incoming') {
      banner.className = 'banner warn';
      banner.innerHTML = `${icon('warning')}<span>War band of ${r.size} from the ${compass(s.home, r.edge)} · <b>${spanLabel(r.arriveTick - s.tick)}</b></span>`;
    } else {
      const alive = hostiles(s).length;
      banner.className = 'banner danger';
      banner.innerHTML = `${icon('sword')}<span><b>Raid!</b> ${alive} goblin${alive === 1 ? '' : 's'} ${r.retreat ? 'retreating' : 'attacking'}</span>`;
    }
  }

  private renderGoals(s: SimState): void {
    const list = goals(s);
    list.forEach((g, i) => {
      if (g.done) this.goalsDone.add(i);
    });
    const done = list.filter((_, i) => this.goalsDone.has(i)).length;
    const chip = this.q('goalsChip');
    const card = this.q('goals');
    chip.hidden = done === list.length;
    this.q('goalsCount').textContent = `First steps ${done}/${list.length}`;
    card.hidden = !this.goalsOpen || done === list.length;
    if (!card.hidden) {
      card.innerHTML = `<ol class="goal-list">${list
        .map((g, i) => `<li class="${this.goalsDone.has(i) ? 'done' : ''}">${icon(this.goalsDone.has(i) ? 'check' : 'goals')}<span>${g.label}</span></li>`)
        .join('')}</ol>`;
    }
  }

  private renderPawn(s: SimState): void {
    const p = s.pawns.find((q) => q.id === this.pawnId);
    if (!p) {
      this.game.selectedId = 0;
      this.closeSheet();
      return;
    }
    const goblin = p.kind === 'goblin';
    const avatar = this.q('pAvatar');
    avatar.style.setProperty('--shirt', hex(goblin ? PALETTE.goblinSkin : PALETTE.shirt[p.look.shirt]));
    avatar.style.setProperty('--mood', goblin ? '0' : String(Math.round(p.mood)));
    avatar.style.setProperty('--ring', goblin ? '#ff6b57' : moodColor(p.mood));
    avatar.innerHTML = `<b>${esc(p.name[0])}</b>`;
    this.q('pName').textContent = p.name;
    this.q('pStory').textContent = goblin ? (p.looter ? 'Goblin looter' : 'Goblin raider') : p.backstory;
    this.q('pNow').innerHTML = `<span class="label">Now</span> ${esc(activityLabel(s, p))}`;

    const bar = (label: string, value: number, max: number, color: string): string =>
      `<div class="bar"><span>${label}</span><i style="--v:${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(0)}%;--c:${color}"></i><b>${Math.round(value)}</b></div>`;
    const bars = [bar('Health', p.hp, p.maxHp, p.hp < p.maxHp * 0.35 ? '#ff6b57' : '#72d38c')];
    if (!goblin) {
      bars.push(bar('Food', p.food, 100, p.food < 25 ? '#ff6b57' : '#ffc53d'));
      bars.push(bar('Rest', p.rest, 100, p.rest < 20 ? '#ff6b57' : '#74c6ff'));
      bars.push(bar('Mood', p.mood, 100, moodColor(p.mood)));
    }
    this.q('pBars').innerHTML = bars.join('');

    const traits = this.q('pTraits');
    const thoughts = this.q('pThoughts');
    const roles = this.q('pRoles');
    const skills = this.q('pSkills');
    traits.hidden = thoughts.hidden = roles.hidden = skills.hidden = goblin;
    if (goblin) return;

    traits.innerHTML = p.traits.map((t) => `<button class="trait" data-trait="${t}">${TRAITS[t].label}</button>`).join('');
    const lines = moodLines(s, p).slice(0, 5);
    thoughts.innerHTML =
      `<p class="mood-title">Feeling ${moodLabel(p.mood).toLowerCase()}</p>` +
      (lines.length
        ? `<ul>${lines.map((l) => `<li><b class="${l.mood >= 0 ? 'pos' : 'neg'}">${l.mood > 0 ? '+' : '−'}${Math.abs(l.mood)}</b>${esc(l.label)}</li>`).join('')}</ul>`
        : '<p class="quiet">Nothing on their mind.</p>');
    if (this.pawnRole !== `${p.id}:${p.role}`) {
      this.pawnRole = `${p.id}:${p.role}`;
      roles.innerHTML =
        `<span class="label">Focus</span><div class="seg">` +
        ROLES.map((r) => `<button data-role="${r.role}" class="${p.role === r.role ? 'on' : ''}">${r.label}</button>`).join('') +
        `</div>`;
    }
    skills.innerHTML = (Object.keys(SKILL_LABEL) as SkillId[])
      .map((k) => `<span><em>${SKILL_LABEL[k]}</em><b>${p.skills[k]}</b></span>`)
      .join('');
  }

  private renderChronicle(s: SimState): void {
    const list = this.q('log');
    const entries = s.log.filter((e) => this.chronicleAll || e.chronicle).slice(-80).reverse();
    this.q('chronicleFilter').textContent = this.chronicleAll ? 'Only key events' : 'Show everything';
    list.innerHTML = entries.length
      ? entries.map((e) => `<li class="log-${e.kind}${e.chronicle ? ' key' : ''}"><time>${stampLabel(e.tick)}</time><p>${esc(e.text)}</p></li>`).join('')
      : '<li class="quiet">Nothing has happened yet.</li>';
  }

  private toastNewEntries(s: SimState): void {
    const newest = s.log.at(-1)?.id ?? 0;
    if (newest <= this.lastLogId) return;
    for (const e of s.log) if (e.id > this.lastLogId && e.kind !== 'info') this.toast(e);
    this.lastLogId = newest;
    if (this.sheet === 'chronicle') this.renderChronicle(s);
  }

  private toast(e: LogEntry): void {
    const box = this.q('toasts');
    const div = document.createElement('div');
    div.className = `toast toast-${e.kind}`;
    div.innerHTML = `<span class="i">${LOG_ICON[e.kind]}</span><span>${esc(e.text)}</span>`;
    box.appendChild(div);
    while (box.children.length > 4) box.firstElementChild!.remove();
    window.setTimeout(() => div.classList.add('out'), 4800);
    window.setTimeout(() => div.remove(), 5400);
  }

  // Overlays

  showIntro(s: SimState): void {
    const names = s.pawns.map((p) => p.name.split(' ')[0]);
    this.q('intro').innerHTML = `
      <p class="eyebrow">A settlement prototype</p>
      <h1>Hearthwild</h1>
      <p class="lede">${esc(names.slice(0, -1).join(', '))} and ${esc(names.at(-1) ?? '')} have reached the Wildlands. Scouts expect a goblin war band tomorrow afternoon.</p>
      <ol class="steps">
        <li>${icon('harvest')}<div><b>Gather</b><span>Drag Harvest over trees and berry bushes.</span></div></li>
        <li>${icon('room')}<div><b>Shelter</b><span>Build a room, beds and a campfire.</span></div></li>
        <li>${icon('rally')}<div><b>Defend</b><span>Plant a rally point. Settlers fight there, together.</span></div></li>
      </ol>
      <p class="note">Time never stops. Settlers work, eat and fight on their own, even while you are away. Downed settlers can die.</p>
      <p class="fine">One finger moves the map · pinch to zoom · two fingers move it while drawing</p>
      <button class="primary" data-action="begin">Begin</button>`;
    this.overlay('intro').hidden = false;
  }

  showAway(ticks: number, news: LogEntry[]): void {
    const shown = news.slice(-12);
    this.q('away').innerHTML = `
      <p class="eyebrow">While you were away</p>
      <h1>${ticks >= TICKS_PER_DAY ? 'A full day passed' : `${spanLabel(ticks)} passed`}</h1>
      ${
        shown.length
          ? `<ol class="log compact">${shown.map((e) => `<li class="log-${e.kind}"><time>${stampLabel(e.tick)}</time><p>${esc(e.text)}</p></li>`).join('')}</ol>`
          : '<p class="lede">It was quiet. The settlers kept working.</p>'
      }
      <button class="primary" data-action="away-ok">Back to the settlement</button>`;
    this.overlay('away').hidden = false;
  }

  showFallen(s: SimState): void {
    const fallen = s.fallen.slice(-8);
    this.q('fallen').innerHTML = `
      <p class="eyebrow">Day ${dayOf(s.tick)}</p>
      <h1>The settlement has fallen</h1>
      <p class="lede">It held out for ${dayOf(s.tick) - 1} day${dayOf(s.tick) === 2 ? '' : 's'} and faced ${s.raidCount + (s.raid ? 1 : 0)} raid${s.raidCount + (s.raid ? 1 : 0) === 1 ? '' : 's'}.</p>
      <ul class="fallen-list">${fallen.map((f) => `<li><b>${esc(f.name)}</b> ${esc(f.cause)} · ${stampLabel(f.tick)}</li>`).join('')}</ul>
      <button class="primary" data-action="restart">Found a new settlement</button>`;
    this.overlay('fallen').hidden = false;
  }

  showBusy(progress: number): void {
    this.overlay('busy').hidden = false;
    this.q('busyBar').style.width = `${Math.round(progress * 100)}%`;
  }

  hideBusy(): void {
    this.overlay('busy').hidden = true;
  }
}

const BADGE_ICON = { down: 'down', sleep: 'sleep', fight: 'sword', flee: 'flee', daze: 'daze', hungry: 'hungry' } as const satisfies Record<
  NonNullable<ReturnType<typeof pawnBadge>>,
  IconName
>;

function moodColor(mood: number): string {
  if (mood >= 60) return '#72d38c';
  if (mood >= 35) return '#ffc53d';
  return '#ff6b57';
}

function goals(s: SimState): Array<{ label: string; done: boolean }> {
  const colonists = s.pawns.filter((p: Pawn) => p.kind === 'colonist').length;
  let indoors = false;
  for (let t = 0; t < MAP_N && !indoors; t++) indoors = isIndoors(s, t);
  return [
    { label: 'Mark trees to chop with Harvest', done: s.designated.some(Boolean) },
    { label: 'Build a room', done: indoors },
    { label: 'A bed for every settler', done: s.structures.filter((st) => st.kind === 'bed').length >= colonists },
    { label: 'Build a campfire', done: s.structures.some((st) => st.kind === 'campfire') },
    { label: 'Plant a rally point', done: s.rally >= 0 },
    { label: 'Survive the first raid', done: s.raidCount >= 1 },
  ];
}
