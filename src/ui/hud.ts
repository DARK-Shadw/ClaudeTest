/** The heads-up display: everything drawn over the map, built for thumbs first. */
import type { Game } from '../game';
import { PALETTE } from '../render/palette';
import { daylight } from '../render/view';
import {
  RAW_FOODS,
  SEASON_LABEL,
  TICKS_PER_DAY,
  activityLabel,
  chiefName,
  clockLabel,
  compass,
  countGroup,
  countItems,
  dayOf,
  describeUnits,
  firstName,
  hostiles,
  hourOf,
  pawnBadge,
  pawnById,
  seasonOf,
  spanLabel,
  stampLabel,
  type CraftItem,
  type LogEntry,
  type LogKind,
  type PawnBadge,
  type Role,
  type SimState,
  type TechId,
} from '../sim';
import { ICONS, type IconName } from './icons';
import {
  COLONY_TABS,
  PAWN_TABS,
  buildBody,
  colonistBody,
  colonyBody,
  creatureBody,
  goals,
  pawnHead,
  tabs,
  toolGrid,
  type ColonyTab,
  type PawnTab,
} from './panels';
import { esc, hex, icon, moodColor, setHTML } from './text';
import { ORDER_TOOLS, TOOLS, ZONE_TOOLS, isBuildTool, techLabel, type ToolId } from './tools';

const LOG_ICON: Record<LogKind, string> = {
  info: ICONS.info,
  good: ICONS.check,
  warn: ICONS.daze,
  bad: ICONS.warning,
  death: ICONS.down,
  raid: ICONS.sword,
  social: ICONS.heart,
};

const BADGE_ICON: Record<Exclude<PawnBadge, null>, IconName> = {
  down: 'down',
  sleep: 'sleep',
  fight: 'sword',
  flee: 'flee',
  daze: 'daze',
  brawl: 'fist',
  hungry: 'hungry',
  drafted: 'shield',
};

const SEASON_ICON: Record<string, IconName> = { spring: 'spring', summer: 'sun', autumn: 'autumn', winter: 'winter' };

const closeButton = `<button class="square close" data-action="close" aria-label="Close">${icon('close')}</button>`;

const TEMPLATE = `
<header class="topbar">
  <div class="chip clock"><span class="i" data-el="seasonIcon"></span><b data-el="day">Day 1</b><span class="season" data-el="season"></span><span class="time" data-el="time">07:00</span></div>
  <div class="chip stocks">
    <span class="stock s-wood">${icon('wood')}<b data-el="wood">0</b><span class="sr">wood</span></span>
    <span class="stock s-stone">${icon('stone')}<b data-el="stone">0</b><span class="sr">stone</span></span>
    <span class="stock s-iron">${icon('iron')}<b data-el="iron">0</b><span class="sr">iron</span></span>
    <span class="stock s-meal">${icon('meal')}<b data-el="meals">0</b><span class="sr">meals</span></span>
    <span class="stock s-food">${icon('berries')}<b data-el="raw">0</b><span class="sr">raw food</span></span>
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
  <div class="squad" data-el="squad" hidden>
    <div class="squad-top"><span class="squad-title">${icon('shield')}<b data-el="squadTitle">Squad</b></span><button class="squad-btn" data-action="squad-all">All</button><button class="squad-btn release" data-action="release">${icon('release')}<span>Release</span></button></div>
    <div class="squad-chips" data-el="squadChips"></div>
    <p class="squad-hint" data-el="squadHint"></p>
  </div>
  <section class="sheet" data-sheet="pawn" hidden>
    <div class="sheet-head"><div class="head-main" data-el="pHead"></div>${closeButton}</div>
    <div data-el="pTabs"></div>
    <div data-el="pBody"></div>
    <div data-el="pActions"></div>
  </section>
  <section class="sheet" data-sheet="orders" hidden>
    <div class="sheet-head"><h2>Orders</h2>${closeButton}</div>
    <div data-el="ordersBody"></div>
  </section>
  <section class="sheet" data-sheet="build" hidden>
    <div class="sheet-head"><h2>Build</h2>${closeButton}</div>
    <div data-el="buildBody"></div>
  </section>
  <section class="sheet" data-sheet="zones" hidden>
    <div class="sheet-head"><h2>Zones</h2>${closeButton}</div>
    <div data-el="zonesBody"></div>
  </section>
  <section class="sheet" data-sheet="colony" hidden>
    <div class="sheet-head"><h2>Colony</h2>${closeButton}</div>
    <div data-el="colonyTabs"></div>
    <div data-el="colonyHead"></div>
    <div data-el="colonyBody"></div>
  </section>
  <section class="sheet" data-sheet="chronicle" hidden>
    <div class="sheet-head"><h2>Chronicle</h2><button class="toggle" data-action="chronicle-filter" data-el="chronicleFilter">Show everything</button>${closeButton}</div>
    <ol class="log" data-el="log"></ol>
  </section>
  <section class="sheet" data-sheet="menu" hidden>
    <div class="sheet-head"><h2>Hearthwild</h2>${closeButton}</div>
    <div class="menu-list">
      <button class="menu-row" data-action="shadows"><span>Shadows</span><b data-el="shadowsState">On</b></button>
      <details class="menu-row how">
        <summary>How to play</summary>
        <ul>
          <li>Use <b>Orders → Harvest</b> on trees, berry bushes, rocks and iron ore. Settlers haul it all to the <b>stockpile</b>.</li>
          <li><b>Build</b> rooms, beds, tables and a campfire. Floors, torches, plant pots and statues make rooms impressive, and settlers love that.</li>
          <li>Sow <b>potato fields</b> before winter: nothing grows for five days and the berry bushes go bare.</li>
          <li>A <b>research desk</b> unlocks bows and watchtowers, stoves, medicine, masonry, smithing and more. A <b>crafting bench</b> makes weapons and armor.</li>
          <li>Every settler has a past, skills they love, friends and enemies. Tap one to read their story.</li>
          <li>Raids come every couple of days: goblin archers, brutes and chiefs who come back for revenge, and wolf packs in winter. Scouts warn you hours ahead.</li>
          <li>Tap <b>Draft</b> to take command: tap the ground to move, tap an enemy to attack, tap a downed friend to tend them. Undrafted settlers muster at the <b>rally point</b> and fight by their nature.</li>
          <li>Downed settlers bleed out unless someone tends them. The dead stay dead.</li>
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
    <button class="tool" data-action="tool-select" data-el="tSelect">${icon('select')}<span>Select</span></button>
    <button class="tool" data-action="orders" data-el="tOrders">${icon('orders')}<span>Orders</span></button>
    <button class="tool" data-action="build" data-el="tBuild">${icon('build')}<span>Build</span></button>
    <button class="tool" data-action="zones" data-el="tZones">${icon('zone')}<span>Zones</span></button>
    <button class="tool" data-action="draft" data-el="tDraft"><span class="i" data-el="tDraftIcon"></span><span data-el="tDraftLabel">Draft</span></button>
    <button class="tool" data-action="colony" data-el="tColony">${icon('colony')}<span>Colony</span></button>
  </nav>
</div>
<div class="overlay" data-overlay="intro" hidden><div class="panel" data-el="intro"></div></div>
<div class="overlay" data-overlay="away" hidden><div class="panel" data-el="away"></div></div>
<div class="overlay" data-overlay="fallen" hidden><div class="panel" data-el="fallen"></div></div>
<div class="overlay" data-overlay="busy" hidden><div class="panel busy"><p>Catching up on time that passed…</p><div class="progress"><i data-el="busyBar"></i></div></div></div>
`;

type Sheet = 'pawn' | 'orders' | 'build' | 'zones' | 'colony' | 'chronicle' | 'menu';

export class Hud {
  private readonly el: HTMLElement;
  private sheet: Sheet | null = null;
  private lastUpdate = 0;
  private lastLogId = 0;
  private chronicleAll = false;
  private readonly chips = new Map<number, HTMLButtonElement>();
  private readonly squadChips = new Map<number, HTMLButtonElement>();
  private pawnId = 0;
  private pawnTab: PawnTab = 'overview';
  private openRel = 0;
  private buildCat = 'structure';
  private colonyTab: ColonyTab = 'research';
  private infoTimer = 0;
  private readonly goalsDone = new Set<number>();
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
    this.el.addEventListener('change', this.onChange);
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
    for (const chip of this.squadChips.values()) chip.remove();
    this.squadChips.clear();
    for (const name of ['intro', 'away', 'fallen']) this.overlay(name).hidden = true;
    this.lastUpdate = 0;
  }

  skipLogTo(s: SimState): void {
    this.lastLogId = s.log.at(-1)?.id ?? 0;
  }

  // Events

  private onChange = (e: Event): void => {
    const target = e.target as HTMLSelectElement;
    const id = Number(target.dataset.focus);
    if (id) this.game.setRole(id, target.value as Role);
  };

  private onClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-action],[data-tool],[data-select],[data-role],[data-tab],[data-rel],[data-cat],[data-ctab],[data-tech],[data-order],[data-squad]',
    );
    if (!target || target.tagName === 'SELECT') return;
    const d = target.dataset;
    if (d.tool) return this.pickTool(d.tool as ToolId);
    if (d.squad) {
      this.game.toggleSquad(Number(d.squad));
      if (this.game.tool !== 'command') this.game.setTool('command');
      return this.refresh();
    }
    if (d.select) return this.tapSettler(Number(d.select));
    if (d.role) {
      this.game.setRole(this.pawnId, d.role as Role);
      return this.refresh();
    }
    if (d.tab) {
      this.pawnTab = d.tab as PawnTab;
      this.openRel = 0;
      return this.refresh();
    }
    if (d.rel) {
      const id = Number(d.rel);
      this.openRel = this.openRel === id ? 0 : id;
      return this.refresh();
    }
    if (d.cat) {
      this.buildCat = d.cat;
      return this.refresh();
    }
    if (d.ctab) {
      this.colonyTab = d.ctab as ColonyTab;
      return this.refresh();
    }
    if (d.tech) {
      this.game.issue({ t: 'research', tech: d.tech as TechId });
      return this.refresh();
    }
    if (d.order) {
      const item = d.order as CraftItem;
      this.game.issue({ t: 'order', item, count: this.game.state.orders[item] + Number(d.delta) });
      return this.refresh();
    }
    this.action(d.action ?? '');
  };

  private action(action: string): void {
    const game = this.game;
    switch (action) {
      case 'tool-select':
        game.setTool('select');
        this.closeSheet();
        break;
      case 'orders':
      case 'build':
      case 'zones':
      case 'colony':
      case 'chronicle':
      case 'menu':
        this.toggleSheet(action);
        break;
      case 'draft':
        if (game.drafted().length) game.releaseAll();
        else game.draftAll();
        this.closeSheet();
        break;
      case 'squad-all':
        game.selectWholeSquad();
        if (game.tool !== 'command') game.setTool('command');
        break;
      case 'release':
        game.releaseAll();
        break;
      case 'draft-one':
        game.draftOne(this.pawnId);
        break;
      case 'undraft-one':
        game.undraftOne(this.pawnId);
        break;
      case 'hunt':
      case 'unhunt':
        game.issue({ t: 'hunt', animalId: this.pawnId, on: action === 'hunt' });
        break;
      case 'close':
        if (this.sheet === 'pawn') game.select(0);
        this.closeSheet();
        break;
      case 'speed': {
        const next = game.speed >= 3 ? 1 : game.speed + 1;
        game.setSpeed(next);
        this.q('speed').textContent = `${next}×`;
        break;
      }
      case 'done':
        game.setTool('select');
        break;
      case 'raid':
        game.focusRaid();
        break;
      case 'goals':
        this.goalsOpen = !this.goalsOpen;
        this.renderGoals(game.state);
        break;
      case 'info':
        this.q('info').hidden = true;
        break;
      case 'begin':
        this.overlay('intro').hidden = true;
        game.begin();
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
        game.newSettlement();
        break;
      case 'shadows':
        game.setShadows(!game.prefs.shadows);
        this.q('shadowsState').textContent = game.prefs.shadows ? 'On' : 'Off';
        break;
      case 'chronicle-filter':
        this.chronicleAll = !this.chronicleAll;
        this.renderChronicle(game.state);
        break;
    }
    this.refresh();
  }

  private pickTool(tool: ToolId): void {
    const info = TOOLS[tool];
    if (info.tech && !this.game.state.research.done.includes(info.tech)) {
      this.showInfo(`${info.label} needs ${techLabel(info.tech)} research. Colony → Research.`);
      return;
    }
    this.game.setTool(tool);
    this.closeSheet();
  }

  /** A settler's chip: their sheet normally, their place in the squad under command. */
  private tapSettler(id: number): void {
    if (this.game.tool === 'command') {
      this.game.toggleSquad(id);
      this.refresh();
      return;
    }
    this.game.select(id, true);
  }

  /** Redraws right away instead of waiting for the next tick of the HUD clock. */
  private refresh(): void {
    this.lastUpdate = 0;
  }

  // Sheets

  private toggleSheet(sheet: Sheet): void {
    if (this.sheet === sheet) this.closeSheet();
    else this.openSheet(sheet);
  }

  private openSheet(sheet: Sheet): void {
    if (this.sheet === 'pawn' && sheet !== 'pawn' && this.game.tool !== 'command') this.game.selected.clear();
    this.sheet = sheet;
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-sheet]')) el.hidden = el.dataset.sheet !== sheet;
    if (sheet === 'chronicle') this.renderChronicle(this.game.state);
    if (sheet === 'menu') {
      this.q('shadowsState').textContent = this.game.prefs.shadows ? 'On' : 'Off';
      this.q('confirm').hidden = true;
    }
    this.refresh();
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
    hint.hidden = tool === 'select' || tool === 'command';
    if (!hint.hidden) {
      this.q('hintIcon').innerHTML = ICONS[info.icon];
      this.q('hintText').textContent = info.hint;
    }
    this.syncToolbar();
  }

  private syncToolbar(): void {
    const tool = this.game.tool;
    const drafted = this.game.drafted().length > 0;
    this.q('tSelect').classList.toggle('active', tool === 'select' && (this.sheet === null || this.sheet === 'pawn'));
    this.q('tOrders').classList.toggle('active', this.sheet === 'orders' || ORDER_TOOLS.includes(tool));
    this.q('tBuild').classList.toggle('active', this.sheet === 'build' || isBuildTool(tool));
    this.q('tZones').classList.toggle('active', this.sheet === 'zones' || (ZONE_TOOLS.includes(tool) && tool !== 'clear'));
    this.q('tColony').classList.toggle('active', this.sheet === 'colony');
    const draft = this.q('tDraft');
    draft.classList.toggle('active', tool === 'command');
    draft.classList.toggle('armed', drafted);
    setHTML(this.q('tDraftIcon'), ICONS[drafted ? 'release' : 'shield']);
    this.q('tDraftLabel').textContent = drafted ? 'Release' : 'Draft';
  }

  showPawn(id: number): void {
    this.pawnId = id;
    this.openRel = 0;
    if (id === 0) {
      if (this.sheet === 'pawn') this.closeSheet();
      return;
    }
    const p = pawnById(this.game.state, id);
    if (p && p.kind !== 'colonist') this.pawnTab = 'overview';
    this.openSheet('pawn');
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

    const season = seasonOf(s.tick);
    setHTML(this.q('seasonIcon'), ICONS[daylight(hourOf(s.tick)) > 0.4 ? SEASON_ICON[season] : 'moon']);
    this.q('day').textContent = `Day ${dayOf(s.tick)}`;
    this.q('season').textContent = SEASON_LABEL[season];
    this.q('time').textContent = clockLabel(s.tick);
    this.q('wood').textContent = String(countItems(s, 'wood'));
    this.q('stone').textContent = String(countItems(s, 'stone'));
    this.q('iron').textContent = String(countItems(s, 'iron'));
    this.q('meals').textContent = String(countGroup(s, 'meal'));
    this.q('raw').textContent = String(RAW_FOODS.reduce((n, t) => n + countItems(s, t), 0));
    this.q('speed').textContent = `${this.game.speed}×`;

    this.renderChips(s);
    this.renderSquad();
    this.renderBanner(s);
    this.renderGoals(s);
    this.syncToolbar();
    switch (this.sheet) {
      case 'pawn':
        this.renderPawn(s);
        break;
      case 'orders':
        setHTML(this.q('ordersBody'), toolGrid(s, ORDER_TOOLS, this.game.tool));
        break;
      case 'build':
        setHTML(this.q('buildBody'), buildBody(s, this.buildCat, this.game.tool));
        break;
      case 'zones':
        setHTML(this.q('zonesBody'), toolGrid(s, ZONE_TOOLS, this.game.tool));
        break;
      case 'colony':
        this.renderColony(s);
        break;
    }
  }

  private renderChips(s: SimState): void {
    const row = this.q('colonists');
    const seen = new Set<number>();
    const command = this.game.tool === 'command';
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
        chip.querySelector('.nm')!.textContent = firstName(p);
      }
      const avatar = chip.querySelector<HTMLElement>('.avatar')!;
      avatar.style.setProperty('--shirt', hex(PALETTE.shirt[p.look.shirt]));
      avatar.style.setProperty('--mood', String(Math.round(p.mood)));
      avatar.style.setProperty('--ring', moodColor(p.mood));
      const badge = pawnBadge(p);
      const b = chip.querySelector<HTMLElement>('.badge')!;
      const cls = `badge${badge ? ` badge-${badge}` : ''}`;
      if (b.className !== cls) {
        b.className = cls;
        b.innerHTML = badge ? ICONS[BADGE_ICON[badge]] : '';
      }
      chip.classList.toggle('selected', this.game.selected.has(p.id));
      chip.classList.toggle('downed', p.life === 'downed');
      chip.classList.toggle('in-squad', command && p.drafted);
      chip.setAttribute('aria-label', `${p.name}, ${activityLabel(s, p)}`);
    }
    for (const [id, chip] of this.chips) {
      if (seen.has(id)) continue;
      chip.remove();
      this.chips.delete(id);
    }
  }

  private renderSquad(): void {
    const drafted = this.game.drafted();
    const box = this.q('squad');
    box.hidden = drafted.length === 0;
    if (box.hidden) return;
    const row = this.q('squadChips');
    const seen = new Set<number>();
    for (const p of drafted) {
      seen.add(p.id);
      let chip = this.squadChips.get(p.id);
      if (!chip) {
        chip = document.createElement('button');
        chip.className = 'squad-chip';
        chip.dataset.squad = String(p.id);
        chip.innerHTML = `<b></b><i></i>`;
        row.appendChild(chip);
        this.squadChips.set(p.id, chip);
        chip.querySelector('b')!.textContent = firstName(p);
      }
      const hp = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
      chip.querySelector<HTMLElement>('i')!.style.setProperty('--hp', `${hp.toFixed(0)}%`);
      chip.classList.toggle('on', this.game.tool === 'command' && this.game.selected.has(p.id));
      chip.classList.toggle('hurt', hp < 35);
    }
    for (const [id, chip] of this.squadChips) {
      if (seen.has(id)) continue;
      chip.remove();
      this.squadChips.delete(id);
    }
    const picked = drafted.filter((p) => this.game.selected.has(p.id)).length;
    this.q('squadTitle').textContent =
      this.game.tool !== 'command' ? 'Squad on standby' : picked && picked < drafted.length ? `${picked} of ${drafted.length} selected` : `Squad of ${drafted.length}`;
    this.q('squadHint').textContent =
      this.game.tool === 'command'
        ? 'Tap the ground to move · tap an enemy to attack · tap a downed settler to tend'
        : 'Tap a name to give orders again';
  }

  private renderBanner(s: SimState): void {
    const banner = this.q('banner');
    const r = s.raid;
    if (!r) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const chief = r.chiefId ? s.chiefs.find((c) => c.id === r.chiefId) : undefined;
    let html: string;
    if (r.phase === 'incoming') {
      banner.className = 'banner warn';
      const what = r.kind === 'wolves' ? `Wolf pack of ${r.size}` : chief ? `${esc(chiefName(chief))} and ${r.size - 1}` : `War band of ${r.size}`;
      html = `${icon('warning')}<span>${what} from the ${compass(s.home, r.edge)} · <b>${spanLabel(r.arriveTick - s.tick)}</b></span>`;
    } else {
      const alive = hostiles(s).filter((h) => h.raidId === r.id).length;
      banner.className = 'banner danger';
      const noun = r.kind === 'wolves' ? (alive === 1 ? 'wolf' : 'wolves') : alive === 1 ? 'goblin' : 'goblins';
      html = `${icon('sword')}<span><b>${r.kind === 'wolves' ? 'Wolves!' : 'Raid!'}</b> ${alive} ${noun} ${r.retreat ? 'fleeing' : 'attacking'}${
        this.game.drafted().length ? '' : ' · <u>Draft</u> to take command'
      }</span>`;
    }
    setHTML(banner, html);
    banner.title = r.kind === 'goblins' && r.units.length ? describeUnits(r.units) : '';
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
      setHTML(
        card,
        `<ol class="goal-list">${list
          .map((g, i) => `<li class="${this.goalsDone.has(i) ? 'done' : ''}">${icon(this.goalsDone.has(i) ? 'check' : 'goals')}<span>${g.label}</span></li>`)
          .join('')}</ol>`,
      );
    }
  }

  private renderPawn(s: SimState): void {
    const p = pawnById(s, this.pawnId);
    if (!p) {
      this.game.select(0);
      this.closeSheet();
      return;
    }
    setHTML(this.q('pHead'), pawnHead(p));
    if (p.kind !== 'colonist') {
      setHTML(this.q('pTabs'), '');
      setHTML(this.q('pBody'), '');
      setHTML(this.q('pActions'), creatureBody(s, p));
      return;
    }
    setHTML(this.q('pTabs'), tabs(PAWN_TABS, this.pawnTab, 'tab'));
    if (this.pawnTab === 'overview') {
      // Buttons live in their own block, which only changes when the choice does, so taps land.
      const body = colonistBody(s, p, 'overview', 0);
      const split = body.indexOf('<div class="roles">');
      setHTML(this.q('pBody'), body.slice(0, split));
      setHTML(this.q('pActions'), body.slice(split));
    } else {
      setHTML(this.q('pBody'), colonistBody(s, p, this.pawnTab, this.openRel));
      setHTML(this.q('pActions'), '');
    }
  }

  private renderColony(s: SimState): void {
    setHTML(this.q('colonyTabs'), tabs(COLONY_TABS, this.colonyTab, 'ctab'));
    const body = colonyBody(s, this.colonyTab);
    if (this.colonyTab === 'research') {
      const split = body.indexOf('<ul class="tech-list">');
      setHTML(this.q('colonyHead'), body.slice(0, split));
      setHTML(this.q('colonyBody'), body.slice(split));
      return;
    }
    setHTML(this.q('colonyHead'), '');
    if (this.colonyTab === 'settlers') {
      // The roster keeps its elements (and any open menu) while activities update in place.
      const key = s.pawns
        .filter((p) => p.kind === 'colonist')
        .map((p) => `${p.id}:${p.role}`)
        .join(',');
      const box = this.q('colonyBody');
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        setHTML(box, body);
      }
      for (const row of box.querySelectorAll<HTMLElement>('[data-select]')) {
        const p = pawnById(s, Number(row.dataset.select));
        const text = row.querySelector('.settler-text span');
        if (p && text) text.textContent = activityLabel(s, p);
        const av = row.querySelector<HTMLElement>('.avatar');
        if (p && av) {
          av.style.setProperty('--mood', String(Math.round(p.mood)));
          av.style.setProperty('--ring', moodColor(p.mood));
        }
      }
      return;
    }
    this.q('colonyBody').dataset.key = '';
    setHTML(this.q('colonyBody'), body);
  }

  private renderChronicle(s: SimState): void {
    const list = this.q('log');
    const entries = s.log.filter((e) => this.chronicleAll || e.chronicle).slice(-100).reverse();
    this.q('chronicleFilter').textContent = this.chronicleAll ? 'Only key events' : 'Show everything';
    setHTML(
      list,
      entries.length
        ? entries.map((e) => `<li class="log-${e.kind}${e.chronicle ? ' key' : ''}"><time>${stampLabel(e.tick)}</time><p>${esc(e.text)}</p></li>`).join('')
        : '<li class="quiet">Nothing has happened yet.</li>',
    );
  }

  private toastNewEntries(s: SimState): void {
    const newest = s.log.at(-1)?.id ?? 0;
    if (newest <= this.lastLogId) return;
    for (const e of s.log) if (e.id > this.lastLogId && e.kind !== 'info' && e.kind !== 'social') this.toast(e);
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
    window.setTimeout(() => div.classList.add('out'), 5200);
    window.setTimeout(() => div.remove(), 5800);
  }

  // Overlays

  showIntro(s: SimState): void {
    const settlers = s.pawns.filter((p) => p.kind === 'colonist');
    const names = settlers.map(firstName);
    const who = settlers.map((p) => `<li>${esc(firstName(p))}, ${esc(p.calling.toLowerCase())}, ${p.age}</li>`).join('');
    this.q('intro').innerHTML = `
      <p class="eyebrow">A settlement prototype</p>
      <h1>Hearthwild</h1>
      <p class="lede">${esc(names.slice(0, -1).join(', '))} and ${esc(names.at(-1) ?? '')} have reached the Wildlands with a cart of supplies. Scouts expect goblins tomorrow afternoon.</p>
      <ul class="founders">${who}</ul>
      <ol class="steps">
        <li>${icon('harvest')}<div><b>Gather</b><span>Orders → Harvest trees and berry bushes.</span></div></li>
        <li>${icon('room')}<div><b>Settle</b><span>Build a room, beds and a campfire. Tap settlers to read their stories.</span></div></li>
        <li>${icon('shield')}<div><b>Defend</b><span>When raiders come, tap Draft and lead the fight yourself.</span></div></li>
      </ol>
      <p class="note">Time never stops. Settlers work, eat, argue, fall in love and fight on their own, even while you are away. The dead stay dead.</p>
      <p class="fine">One finger moves the map · pinch to zoom · two fingers move it while drawing</p>
      <button class="primary" data-action="begin">Begin</button>`;
    this.overlay('intro').hidden = false;
  }

  showAway(ticks: number, news: LogEntry[]): void {
    const shown = news.slice(-14);
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
    const fallen = s.fallen.slice(-10);
    const days = dayOf(s.tick) - 1;
    const raids = s.raidCount + (s.raid ? 1 : 0);
    this.q('fallen').innerHTML = `
      <p class="eyebrow">Day ${dayOf(s.tick)}</p>
      <h1>The settlement has fallen</h1>
      <p class="lede">It held out for ${days} day${days === 1 ? '' : 's'} and faced ${raids} attack${raids === 1 ? '' : 's'}.</p>
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
