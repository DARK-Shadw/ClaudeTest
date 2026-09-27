/**
 * Ties the simulation, the renderer, the controls and the HUD together, and owns the clock.
 * The world never pauses while you play: like the shared world this grows into, time keeps
 * moving and the settlers act on their own. Time that passed while the app was closed is
 * fast-forwarded when you come back.
 */
import { Controls, type TilePos } from './input/controls';
import { WorldView } from './render/view';
import {
  BUILDINGS,
  CODE_FLOOR,
  CROPS,
  CROP_BY_CODE,
  FEATURE,
  FLOORS,
  ITEMS,
  TERRAIN,
  TICKS_PER_DAY,
  TICKS_PER_SECOND,
  ZONE,
  applyCommand,
  blueprintAt,
  blueprintSpec,
  cheb,
  createSim,
  firstName,
  floorBlueprintAt,
  hostiles,
  impressivenessLabel,
  itemAt,
  pawnById,
  planCommand,
  roomAt,
  seasonOf,
  step,
  structureAt,
  tileIndex,
  type BlueprintKind,
  type Command,
  type CropKind,
  type LogEntry,
  type Pawn,
  type Role,
  type SimState,
  type ZoneKind,
} from './sim';
import { loadPrefs, saveGame, savePrefs, type Prefs } from './storage';
import { Hud } from './ui/hud';
import { AREA_TOOLS, type ToolId } from './ui/tools';

const TICK_MS = 1000 / TICKS_PER_SECOND;
const SAVE_EVERY_MS = 10_000;
/** Fast-forwarding stops after one in-game day away, so nobody returns to a year of disasters. */
const MAX_CATCH_UP = TICKS_PER_DAY;
const CATCH_UP_CHUNK = 600;

const ZONE_TOOLS: ReadonlySet<string> = new Set<ZoneKind>(['stockpile', 'potato', 'healroot']);

export class Game {
  state: SimState;
  readonly view: WorldView;
  readonly prefs: Prefs;
  tool: ToolId = 'select';
  /** Pawns ringed on the map: the one being looked at, or the squad under orders. */
  readonly selected = new Set<number>();
  paused = false;

  private readonly hud: Hud;
  private acc = 0;
  private last = performance.now();
  private lastSave = performance.now();
  private hiddenAt = 0;

  constructor(root: HTMLElement, saved: { state: SimState; savedAt: number } | null) {
    this.prefs = loadPrefs();
    this.state = saved?.state ?? createSim(newSeed());

    const stage = document.createElement('div');
    stage.className = 'stage';
    const labels = document.createElement('div');
    labels.className = 'labels';
    root.append(stage, labels);
    this.view = new WorldView(stage, labels);
    this.view.setShadows(this.prefs.shadows);

    new Controls(this.view, this.view.canvas, {
      drawsAreas: () => AREA_TOOLS.has(this.tool),
      onTap: (x, y) => this.tap(x, y),
      onArea: (a, b, done) => this.area(a, b, done),
      onAreaCancel: () => this.view.setPreview([]),
    });

    this.hud = new Hud(this, root);
    this.hud.reset(this.state);

    if (!saved) {
      this.paused = true;
      this.hud.showIntro(this.state);
    } else if (saved.state.over) {
      this.hud.showFallen(saved.state);
    } else {
      this.catchUp(Date.now() - saved.savedAt);
    }

    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', () => this.save());
    requestAnimationFrame(this.frame);
  }

  get speed(): number {
    return this.prefs.speed;
  }

  /** Runs the simulation forward instantly. For playtesting from the browser console. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks && !this.state.over; i++) step(this.state);
    this.hud.skipLogTo(this.state);
  }

  // Loop

  private frame = (now: number): void => {
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (!this.paused && !this.state.over) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 12) {
        step(this.state);
        this.acc -= TICK_MS;
        steps++;
      }
      if (steps === 12) this.acc = 0;
      if (this.state.over) this.onFallen();
    }
    this.tidySelection();
    this.view.render(this.state, this.paused ? 0 : this.acc / TICK_MS, now, this.selected);
    this.hud.update(this.state, now);
    if (now - this.lastSave > SAVE_EVERY_MS) this.save();
    requestAnimationFrame(this.frame);
  };

  /** Drops pawns that died or left from the selection, and leaves command mode when nobody is drafted. */
  private tidySelection(): void {
    for (const id of this.selected) {
      const p = pawnById(this.state, id);
      if (!p || (this.tool === 'command' && (!p.drafted || p.life !== 'ok'))) this.selected.delete(id);
    }
    if (this.tool === 'command' && !this.drafted().length) this.setTool('select');
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      this.save();
    } else if (this.hiddenAt) {
      const away = Date.now() - this.hiddenAt;
      this.hiddenAt = 0;
      this.last = performance.now();
      if (away > 5000) this.catchUp(away);
    }
  };

  /** Runs the ticks that would have happened while the player was away, then shows what happened. */
  private catchUp(ms: number): void {
    if (this.paused || this.state.over) return;
    const total = Math.min(MAX_CATCH_UP, Math.floor(ms / TICK_MS));
    if (total < 20) return;
    const fromTick = this.state.tick;
    const firstLog = (this.state.log.at(-1)?.id ?? 0) + 1;
    this.paused = true;
    let done = 0;
    this.hud.showBusy(0);
    const chunk = (): void => {
      const n = Math.min(CATCH_UP_CHUNK, total - done);
      for (let i = 0; i < n && !this.state.over; i++) step(this.state);
      done += n;
      this.hud.showBusy(done / total);
      if (done < total && !this.state.over) {
        setTimeout(chunk, 0);
        return;
      }
      this.hud.hideBusy();
      this.paused = false;
      this.last = performance.now();
      this.hud.skipLogTo(this.state);
      const news = this.state.log.filter((e: LogEntry) => e.id >= firstLog && e.kind !== 'info' && e.kind !== 'social');
      if (this.state.over) this.onFallen();
      else this.hud.showAway(this.state.tick - fromTick, news);
      this.save();
    };
    setTimeout(chunk, 30);
  }

  private onFallen(): void {
    this.save();
    this.hud.showFallen(this.state);
  }

  save(): void {
    this.lastSave = performance.now();
    saveGame(this.state);
  }

  // Player actions

  begin(): void {
    this.paused = false;
    this.last = performance.now();
  }

  newSettlement(): void {
    this.state = createSim(newSeed());
    this.selected.clear();
    this.acc = 0;
    this.setTool('select');
    this.hud.reset(this.state);
    this.paused = true;
    this.hud.showIntro(this.state);
    this.save();
  }

  setSpeed(speed: number): void {
    this.prefs.speed = speed;
    savePrefs(this.prefs);
  }

  setShadows(on: boolean): void {
    this.prefs.shadows = on;
    this.view.setShadows(on);
    savePrefs(this.prefs);
  }

  setTool(tool: ToolId): void {
    if (tool !== 'command' && this.tool === 'command') this.selected.clear();
    this.tool = tool;
    this.view.setPreview([]);
    this.hud.showTool(tool);
  }

  /** Looks at one pawn: rings it and opens its sheet. */
  select(id: number, focus = false): void {
    if (this.tool === 'command') this.setTool('select');
    this.selected.clear();
    if (id) this.selected.add(id);
    const p = pawnById(this.state, id);
    // Their sheet covers the lower half of the screen, so frame them above it.
    if (p && focus) this.view.focusOn(tileIndex(p.x, p.y), false, 0.28);
    this.hud.showPawn(id);
  }

  // Drafting

  drafted(): Pawn[] {
    return this.state.pawns.filter((p) => p.kind === 'colonist' && p.drafted && p.life === 'ok');
  }

  /** The pawns an order goes to: the selected part of the squad, or all of it. */
  private squad(): number[] {
    const drafted = this.drafted().map((p) => p.id);
    const picked = drafted.filter((id) => this.selected.has(id));
    return picked.length ? picked : drafted;
  }

  /** Calls every settler who can fight to arms, and hands the player the squad. */
  draftAll(): void {
    const ids = this.state.pawns
      .filter((p) => p.kind === 'colonist' && p.life === 'ok' && !p.mental && !p.incapable.includes('violence'))
      .map((p) => p.id);
    if (!ids.length) {
      this.hud.showInfo('Nobody is able to fight right now.');
      return;
    }
    this.issue({ t: 'draft', ids, on: true });
    this.enterCommand(ids);
  }

  draftOne(id: number): void {
    this.issue({ t: 'draft', ids: [id], on: true });
    const p = pawnById(this.state, id);
    if (!p?.drafted) {
      this.hud.showInfo(p?.mental ? `${firstName(p)} is in no state to take orders.` : 'They can’t be drafted right now.');
      return;
    }
    this.enterCommand([id]);
  }

  undraftOne(id: number): void {
    this.issue({ t: 'draft', ids: [id], on: false });
    this.selected.delete(id);
  }

  releaseAll(): void {
    const ids = this.drafted().map((p) => p.id);
    if (ids.length) this.issue({ t: 'draft', ids, on: false });
    this.selected.clear();
    this.setTool('select');
  }

  private enterCommand(ids: number[]): void {
    this.hud.showPawn(0);
    this.selected.clear();
    for (const id of ids) this.selected.add(id);
    this.setTool('command');
  }

  /** In command mode a settler's chip picks them in or out of the squad, drafting them if needed. */
  toggleSquad(id: number): void {
    const p = pawnById(this.state, id);
    if (!p || p.kind !== 'colonist') return;
    if (!p.drafted) {
      this.issue({ t: 'draft', ids: [id], on: true });
      if (!p.drafted) {
        this.hud.showInfo(`${firstName(p)} can’t be drafted right now.`);
        return;
      }
      this.selected.add(id);
      return;
    }
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  selectWholeSquad(): void {
    this.selected.clear();
    for (const p of this.drafted()) this.selected.add(p.id);
  }

  /** Points the camera at the fight, or at where the attackers will come from. */
  focusRaid(): void {
    const r = this.state.raid;
    if (!r) return;
    const home = this.state.home;
    let target = r.edge;
    let best = Infinity;
    for (const p of hostiles(this.state)) {
      const t = tileIndex(p.x, p.y);
      const d = cheb(t, home);
      if (d < best) {
        best = d;
        target = t;
      }
    }
    this.view.focusOn(target);
  }

  setRole(pawnId: number, role: Role): void {
    this.issue({ t: 'role', pawnId, role });
  }

  issue(cmd: Command): void {
    applyCommand(this.state, cmd);
  }

  private tap(clientX: number, clientY: number): void {
    const tile = this.view.tileAt(clientX, clientY);
    const t = tile?.inside ? tileIndex(tile.x, tile.y) : -1;
    const now = performance.now();
    switch (this.tool) {
      case 'select': {
        const pawnId = this.view.pawnAt(clientX, clientY);
        if (pawnId) {
          this.select(pawnId);
          return;
        }
        this.select(0);
        if (t >= 0) this.hud.showInfo(describeTile(this.state, t));
        return;
      }
      case 'command': {
        const target = pawnById(this.state, this.view.pawnAt(clientX, clientY));
        const squad = this.squad();
        if (target?.kind === 'colonist') {
          if (target.life === 'downed') {
            this.issue({ t: 'attack', ids: squad.filter((id) => id !== target.id), targetId: target.id });
            this.view.flashAt(tileIndex(target.x, target.y), now);
          } else {
            this.toggleSquad(target.id);
          }
          return;
        }
        if (target) {
          this.issue({ t: 'attack', ids: squad, targetId: target.id });
          this.view.flashAt(tileIndex(target.x, target.y), now);
          return;
        }
        if (t >= 0 && squad.length) {
          this.issue({ t: 'move', ids: squad, tile: t });
          this.view.flashAt(t, now);
        }
        return;
      }
      case 'rally':
        if (t >= 0) this.issue({ t: 'rally', tile: t });
        return;
      case 'hunt': {
        const a = pawnById(this.state, this.view.pawnAt(clientX, clientY));
        if (a?.kind === 'animal' && !a.hostile) {
          this.issue({ t: 'hunt', animalId: a.id, on: !a.marked });
          this.hud.showInfo(a.marked ? `Marked the ${a.name.toLowerCase()} for hunting.` : `No longer hunting the ${a.name.toLowerCase()}.`);
        } else {
          this.hud.showInfo('Tap an animal to mark it for hunting.');
        }
        return;
      }
      default: {
        if (!tile?.inside || AREA_TOOLS.has(this.tool)) return;
        const kind = this.tool as BlueprintKind;
        const cmd: Command = { t: 'build', kind, x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y };
        const plan = planCommand(this.state, cmd);
        if (plan.some((p) => p.ok)) this.issue(cmd);
        else this.hud.showInfo(cantBuild(this.state, kind, t));
      }
    }
  }

  private area(a: TilePos, b: TilePos, done: boolean): void {
    const rect = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    let cmd: Command;
    const tool = this.tool;
    if (tool === 'harvest' || tool === 'clear' || tool === 'demolish') cmd = { t: tool, ...rect };
    else if (tool === 'room' || tool === 'stoneRoom') cmd = { t: 'room', wall: tool === 'room' ? 'wall' : 'stoneWall', ...rect };
    else if (ZONE_TOOLS.has(tool)) cmd = { t: 'zone', zone: tool as ZoneKind, ...rect };
    else cmd = { t: 'build', kind: tool as BlueprintKind, ...rect };
    const plan = planCommand(this.state, cmd);
    if (!done) {
      this.view.setPreview(plan);
      return;
    }
    this.view.setPreview([]);
    if (!plan.some((p) => p.ok)) {
      const why = cantPlace(this.state, cmd, a, b);
      if (why) this.hud.showInfo(why);
      return;
    }
    this.issue(cmd);
  }
}

function cantBuild(s: SimState, kind: BlueprintKind, t: number): string {
  const spec = blueprintSpec(kind);
  if (spec.tech && !s.research.done.includes(spec.tech)) return `${spec.label} needs research first.`;
  if (kind in FLOORS && s.floor[t]) return 'There is already a floor there.';
  return 'Can’t build there. Pick open ground without a building on it.';
}

/** Why an order placed nothing, in the player's words. */
function cantPlace(s: SimState, cmd: Command, a: TilePos, b: TilePos): string {
  switch (cmd.t) {
    case 'room':
      return Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2
        ? 'Rooms need at least 3×3 tiles. Drag a bigger rectangle.'
        : 'Rooms need open ground, clear of water, rock and buildings.';
    case 'build':
      return cantBuild(s, cmd.kind, tileIndex(b.x, b.y));
    case 'zone':
      if (cmd.zone === 'healroot' && !s.research.done.includes('medicine')) return 'Healroot fields need Herbal medicine research.';
      return cmd.zone === 'stockpile' ? 'Stockpiles need open ground.' : 'Fields need open grass or sand, clear of trees and rocks.';
    case 'harvest':
      return 'Nothing to harvest there. Drag over trees, bushes, rocks or ore.';
    case 'demolish':
      return 'No buildings or floors there to take apart.';
    default:
      return '';
  }
}

function newSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

const ZONE_NAME: Record<number, string> = { [ZONE.STOCKPILE]: 'Stockpile', [ZONE.POTATO]: 'Potato field', [ZONE.HEALROOT]: 'Healroot field' };

/** One line about whatever is on a tile, for tapping around the map. */
export function describeTile(s: SimState, t: number): string {
  const room = roomAt(s, t);
  const where = room ? ` · in a ${impressivenessLabel(room.impressiveness)} room (${room.impressiveness})` : '';
  const st = structureAt(s, t);
  if (st) {
    if (st.kind === 'grave') return `Grave of ${st.label}`;
    const label = BUILDINGS[st.kind].label;
    if (st.kind === 'bed') {
      const owner = s.pawns.find((p) => p.id === st.ownerId);
      return `${owner ? `${firstName(owner)}'s bed` : 'Bed · nobody sleeps here yet'}${where}`;
    }
    const hp = st.hp < st.maxHp ? ` · ${Math.max(0, Math.round((st.hp / st.maxHp) * 100))}% intact` : '';
    return `${label}${hp}${s.decon[t] ? ' · marked for demolition' : ''}${where}`;
  }
  const bp = blueprintAt(s, t) ?? floorBlueprintAt(s, t);
  if (bp) {
    const spec = blueprintSpec(bp.kind);
    return `Planned ${spec.label.toLowerCase()} · ${bp.delivered}/${spec.cost} ${spec.material} delivered`;
  }
  const it = itemAt(s, t);
  if (it) return `${ITEMS[it.type].label} ×${it.count}${s.zone[t] === ZONE.STOCKPILE ? ' · in the stockpile' : ''}`;
  if (s.plant[t]) {
    const crop = CROPS[CROP_BY_CODE[s.plant[t]] as CropKind];
    const g = s.growth[t];
    return g >= 1000 ? `${crop.label} · ready to harvest` : `${crop.label} · ${Math.floor(g / 10)}% grown${seasonOf(s.tick) === 'winter' ? ', dormant for winter' : ''}`;
  }
  const marked = s.designated[t] ? ' · marked for harvest' : ' · use Orders → Harvest';
  switch (s.feature[t]) {
    case FEATURE.TREE:
      return `Tree${marked}`;
    case FEATURE.BOULDER:
      return `Boulder${marked}`;
    case FEATURE.ORE:
      return `Iron ore${marked}`;
    case FEATURE.BUSH:
      return s.regrow[t] > s.tick ? 'Berry bush · regrowing' : `Berry bush${marked}`;
  }
  if (s.zone[t]) return `${ZONE_NAME[s.zone[t]]}${where}`;
  if (t === s.rally) return 'Rally point';
  const floor = CODE_FLOOR[s.floor[t]];
  if (floor) return `${FLOORS[floor].label}${where}`;
  if (room) return `Inside a ${impressivenessLabel(room.impressiveness)} room (${room.impressiveness})`;
  switch (s.terrain[t]) {
    case TERRAIN.WATER:
      return seasonOf(s.tick) === 'winter' ? 'Frozen lake' : 'Lake';
    case TERRAIN.MOUNTAIN:
      return 'Mountain';
    case TERRAIN.SAND:
      return 'Sand · fields grow slower here';
    default:
      return 'Meadow';
  }
}
