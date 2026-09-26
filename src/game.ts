/**
 * Ties the simulation, the renderer, the controls and the HUD together, and owns the clock.
 * The world never pauses while you play: like the shared world this grows into, time keeps
 * moving and the settlers act on their own. Time that passed while the app was closed is
 * fast-forwarded when you come back.
 */
import { Controls, type TilePos } from './input/controls';
import { WorldView } from './render/view';
import {
  FEATURE,
  ITEM_LABEL,
  STRUCTURES,
  TERRAIN,
  TICKS_PER_DAY,
  TICKS_PER_SECOND,
  applyCommand,
  blueprintAt,
  cheb,
  createSim,
  firstName,
  itemAt,
  planCommand,
  step,
  structureAt,
  tileIndex,
  type BuildKind,
  type Command,
  type LogEntry,
  type Role,
  type SimState,
} from './sim';
import { loadPrefs, saveGame, savePrefs, type Prefs } from './storage';
import { Hud } from './ui/hud';

export type ToolId = 'select' | 'harvest' | 'zone' | 'rally' | 'clear' | 'demolish' | 'room' | BuildKind;

const AREA_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['harvest', 'zone', 'clear', 'demolish', 'room', 'wall', 'stoneWall', 'trap']);
const TICK_MS = 1000 / TICKS_PER_SECOND;
const SAVE_EVERY_MS = 10_000;
/** Fast-forwarding stops after one in-game day away, so nobody returns to a year of disasters. */
const MAX_CATCH_UP = TICKS_PER_DAY;
const CATCH_UP_CHUNK = 600;

export class Game {
  state: SimState;
  readonly view: WorldView;
  readonly prefs: Prefs;
  tool: ToolId = 'select';
  selectedId = 0;
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
    this.view.render(this.state, this.paused ? 0 : this.acc / TICK_MS, now, this.selectedId);
    this.hud.update(this.state, now);
    if (now - this.lastSave > SAVE_EVERY_MS) this.save();
    requestAnimationFrame(this.frame);
  };

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
      const news = this.state.log.filter((e: LogEntry) => e.id >= firstLog && e.kind !== 'info');
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
    this.selectedId = 0;
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
    this.tool = tool;
    this.view.setPreview([]);
    this.hud.showTool(tool);
  }

  select(id: number, focus = false): void {
    this.selectedId = id;
    const p = this.state.pawns.find((q) => q.id === id);
    if (p && focus) this.view.focusOn(tileIndex(p.x, p.y));
    this.hud.showPawn(id);
  }

  /** Points the camera at the fight, or at where the war band will come from. */
  focusRaid(): void {
    const r = this.state.raid;
    if (!r) return;
    const home = this.state.home;
    let target = r.edge;
    let best = Infinity;
    for (const p of this.state.pawns) {
      if (p.kind !== 'goblin' || p.life !== 'ok') continue;
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
      case 'rally':
        if (t >= 0) this.issue({ t: 'rally', tile: t });
        return;
      case 'door':
      case 'bed':
      case 'campfire': {
        if (!tile?.inside) return;
        const cmd: Command = { t: 'build', kind: this.tool, x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y };
        if (planCommand(this.state, cmd).some((p) => p.ok)) this.issue(cmd);
        else this.hud.showInfo('Can’t build there. Pick open ground without a building on it.');
        return;
      }
      default:
        return;
    }
  }

  private area(a: TilePos, b: TilePos, done: boolean): void {
    const rect = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    let cmd: Command;
    switch (this.tool) {
      case 'harvest':
      case 'zone':
      case 'clear':
      case 'demolish':
      case 'room':
        cmd = { t: this.tool, ...rect };
        break;
      case 'wall':
      case 'stoneWall':
      case 'trap':
        cmd = { t: 'build', kind: this.tool, ...rect };
        break;
      default:
        return;
    }
    const plan = planCommand(this.state, cmd);
    if (!done) {
      this.view.setPreview(plan);
      return;
    }
    this.view.setPreview([]);
    if (!plan.some((p) => p.ok)) {
      const why = cantPlace(cmd, a, b);
      if (why) this.hud.showInfo(why);
      return;
    }
    this.issue(cmd);
  }
}

/** Why an order placed nothing, in the player's words. */
function cantPlace(cmd: Command, a: TilePos, b: TilePos): string {
  switch (cmd.t) {
    case 'room':
      return Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2
        ? 'Rooms need at least 3×3 tiles. Drag a bigger rectangle.'
        : 'Rooms need open ground, clear of water, rock and buildings.';
    case 'build':
      return 'Can’t build there. Pick open ground without a building on it.';
    case 'zone':
      return 'Stockpiles need open ground.';
    case 'harvest':
      return 'Nothing to harvest there. Drag over trees, bushes or rocks.';
    case 'demolish':
      return 'No buildings there to take apart.';
    default:
      return '';
  }
}

function newSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

/** One line about whatever is on a tile, for tapping around the map. */
export function describeTile(s: SimState, t: number): string {
  const st = structureAt(s, t);
  if (st) {
    if (st.kind === 'grave') return `Grave of ${st.label}`;
    const label = STRUCTURES[st.kind].label;
    if (st.kind === 'bed') {
      const owner = s.pawns.find((p) => p.id === st.ownerId);
      return owner ? `${firstName(owner)}'s bed` : 'Bed · nobody sleeps here yet';
    }
    const hp = st.hp < st.maxHp ? ` · ${Math.max(0, Math.round((st.hp / st.maxHp) * 100))}% intact` : '';
    return `${label}${hp}${s.decon[t] ? ' · marked for demolition' : ''}`;
  }
  const bp = blueprintAt(s, t);
  if (bp) {
    const spec = STRUCTURES[bp.kind];
    return `Planned ${spec.label.toLowerCase()} · ${bp.delivered}/${spec.cost} ${spec.material} delivered`;
  }
  const it = itemAt(s, t);
  if (it) return `${ITEM_LABEL[it.type]} ×${it.count}${s.zone[t] ? ' · in the stockpile' : ''}`;
  const marked = s.designated[t] ? ' · marked for harvest' : ' · use Harvest to gather';
  switch (s.feature[t]) {
    case FEATURE.TREE:
      return `Tree${marked}`;
    case FEATURE.BOULDER:
      return `Boulder${marked}`;
    case FEATURE.BUSH:
      return s.regrow[t] > s.tick ? 'Berry bush · regrowing' : `Berry bush${marked}`;
  }
  if (s.zone[t]) return 'Stockpile';
  if (t === s.rally) return 'Rally point';
  switch (s.terrain[t]) {
    case TERRAIN.WATER:
      return 'Lake';
    case TERRAIN.MOUNTAIN:
      return 'Mountain';
    case TERRAIN.SAND:
      return 'Sand';
    default:
      return 'Meadow';
  }
}
