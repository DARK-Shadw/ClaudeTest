/**
 * Draws a SimState as a low-poly diorama. The renderer only reads the state: it never changes
 * the simulation, so the same state could just as well be streamed from a server.
 */
import * as THREE from 'three';
import {
  FEATURE,
  MAP_H,
  MAP_N,
  MAP_W,
  SK,
  STACK_MAX,
  STRUCTURES,
  TERRAIN,
  firstName,
  hourOf,
  inBounds,
  pawnBadge,
  tileIndex,
  tileX,
  tileY,
  type ItemStack,
  type ItemType,
  type Pawn,
  type Placement,
  type SimState,
  type Structure,
} from '../sim';
import { hash01 } from '../sim/noise';
import { ICONS } from '../ui/icons';
import * as M from './models';
import { PALETTE } from './palette';

const HALF_W = MAP_W / 2;
const HALF_H = MAP_H / 2;
export const worldX = (x: number): number => x - HALF_W + 0.5;
export const worldZ = (y: number): number => y - HALF_H + 0.5;

/**
 * A tilted board seen from across the table, turned only slightly off the grid. Keeping the grid
 * nearly square to the screen means a rectangle dragged with a thumb is a rectangle on the map.
 */
const CAMERA_YAW = 0.35;
const CAMERA_PITCH = 0.92;
const CAMERA_DIR = new THREE.Vector3(
  Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
  Math.sin(CAMERA_PITCH),
  Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH),
);
const VIEW_HEIGHT = 16;
export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 3.2;
const LIGHT_POOL = 3;

const LIGHT_COLORS = {
  skyDay: new THREE.Color(PALETTE.sky.day),
  skyDusk: new THREE.Color(PALETTE.sky.dusk),
  skyNight: new THREE.Color(PALETTE.sky.night),
  sunDay: new THREE.Color(PALETTE.sun.day),
  sunDusk: new THREE.Color(PALETTE.sun.dusk),
  sunNight: new THREE.Color(PALETTE.sun.night),
};

/** Direction to each neighbour and the rotation that points a +X wall arm at it. */
const WALL_ARMS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, Math.PI],
  [0, 1, -Math.PI / 2],
  [0, -1, Math.PI / 2],
];

const BADGE_ICON = {
  down: ICONS.down,
  sleep: ICONS.sleep,
  fight: ICONS.sword,
  flee: ICONS.flee,
  daze: ICONS.daze,
  hungry: ICONS.hungry,
} as const;

const CARRY_COLOR: Record<ItemType, number> = {
  wood: PALETTE.wood,
  stone: PALETTE.stone,
  berries: PALETTE.berry,
  meal: PALETTE.linen,
};

interface PawnView {
  root: THREE.Group;
  pose: THREE.Group;
  material: THREE.MeshLambertMaterial;
  carry: THREE.Mesh;
  carryMaterial: THREE.MeshLambertMaterial;
  label: HTMLDivElement | null;
  labelKey: string;
  x: number;
  z: number;
  heading: number;
}

function instanced(geo: THREE.BufferGeometry, material: THREE.Material, capacity = MAP_N): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.setColorAt(0, new THREE.Color(0xffffff));
  mesh.frustumCulled = false;
  return mesh;
}

export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  readonly target = new THREE.Vector3();
  zoom = 0.95;

  private readonly scene = new THREE.Scene();
  private readonly host: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x6b7f5a, 1.5);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly sky = new THREE.Color();

  private readonly geo = {
    pine: M.pineTree(),
    round: M.roundTree(),
    bush: M.bush(),
    berries: M.berries(),
    boulder: M.boulder(),
    mountain: M.mountain(),
    woodPost: M.wallPost(M.WOOD_WALL),
    woodArm: M.wallArm(M.WOOD_WALL),
    stonePost: M.wallPost(M.STONE_WALL),
    stoneArm: M.wallArm(M.STONE_WALL),
    door: M.door(),
    bed: M.bedFrame(),
    blanket: M.blanket(),
    campfire: M.campfireBase(),
    flameOuter: M.flameOuter(),
    flameInner: M.flameInner(),
    trap: M.trap(),
    grave: M.grave(),
    flag: M.rallyFlag(),
    carried: M.carried(),
    marker: new THREE.OctahedronGeometry(0.09, 0),
    bpTall: new THREE.BoxGeometry(0.5, 0.46, 0.5).translate(0, 0.23, 0),
    bpFlat: new THREE.BoxGeometry(0.8, 0.18, 0.8).translate(0, 0.09, 0),
    preview: new THREE.BoxGeometry(0.94, 0.06, 0.94).translate(0, 0.04, 0),
    blob: new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2),
    ring: new THREE.TorusGeometry(0.34, 0.035, 6, 28).rotateX(Math.PI / 2),
  };
  private readonly items: Record<ItemType, THREE.BufferGeometry> = {
    wood: M.woodPile(),
    stone: M.stonePile(),
    berries: M.berryBasket(),
    meal: M.mealBowl(),
  };

  private readonly mat = {
    blueprint: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }),
    zone: new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.3, depthWrite: false }),
    marker: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    preview: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
    flame: new THREE.MeshBasicMaterial({ color: PALETTE.flame }),
    flameCore: new THREE.MeshBasicMaterial({ color: PALETTE.flameCore }),
    blob: new THREE.MeshBasicMaterial({ color: PALETTE.shadow, transparent: true, opacity: 0.22, depthWrite: false }),
    ring: new THREE.MeshBasicMaterial({ color: PALETTE.selection }),
  };
  private readonly blanketMats = new Map<number, THREE.MeshLambertMaterial>();
  private readonly pawnGeos = new Map<string, THREE.BufferGeometry>();

  private readonly board = new THREE.Group();
  private readonly mountains = instanced(this.geo.mountain, this.solid);
  private readonly pines = instanced(this.geo.pine, this.solid);
  private readonly rounds = instanced(this.geo.round, this.solid);
  private readonly bushes = instanced(this.geo.bush, this.solid);
  private readonly berries = instanced(this.geo.berries, this.solid);
  private readonly boulders = instanced(this.geo.boulder, this.solid);
  private readonly woodPosts = instanced(this.geo.woodPost, this.solid);
  private readonly woodArms = instanced(this.geo.woodArm, this.solid, MAP_N * 2);
  private readonly stonePosts = instanced(this.geo.stonePost, this.solid);
  private readonly stoneArms = instanced(this.geo.stoneArm, this.solid, MAP_N * 2);
  private readonly bpTall = instanced(this.geo.bpTall, this.mat.blueprint);
  private readonly bpFlat = instanced(this.geo.bpFlat, this.mat.blueprint);
  private readonly markers = instanced(this.geo.marker, this.mat.marker);
  private readonly preview = instanced(this.geo.preview, this.mat.preview);
  private readonly structures = new THREE.Group();
  private readonly structureObjects = new Map<number, THREE.Object3D>();
  private readonly itemGroup = new THREE.Group();
  private readonly itemObjects = new Map<number, THREE.Mesh>();
  private readonly pawnGroup = new THREE.Group();
  private readonly pawnViews = new Map<number, PawnView>();
  private readonly flag: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private zoneMesh: THREE.Mesh | null = null;
  private boardMesh: THREE.Mesh | null = null;

  private state: SimState | null = null;
  private structVersion = -1;
  private itemVersion = -1;
  private berryCheckTick = 0;
  private focusTarget: THREE.Vector3 | null = null;
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement, labels: HTMLElement) {
    this.host = host;
    this.labels = labels;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);

    this.sun.position.set(-16, 34, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -32;
    sc.right = 32;
    sc.top = 32;
    sc.bottom = -32;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.background = this.sky;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffa04a, 0, 7, 1.6);
      this.fireLights.push(light);
      this.scene.add(light);
    }

    this.flag = new THREE.Mesh(this.geo.flag, this.solid);
    this.flag.castShadow = true;
    this.flag.visible = false;
    this.ring = new THREE.Mesh(this.geo.ring, this.mat.ring);
    this.ring.visible = false;
    this.preview.castShadow = false;
    this.markers.castShadow = false;
    this.bpTall.castShadow = false;
    this.bpFlat.castShadow = false;

    this.scene.add(
      this.board,
      this.mountains,
      this.pines,
      this.rounds,
      this.bushes,
      this.berries,
      this.boulders,
      this.woodPosts,
      this.woodArms,
      this.stonePosts,
      this.stoneArms,
      this.bpTall,
      this.bpFlat,
      this.markers,
      this.preview,
      this.structures,
      this.itemGroup,
      this.pawnGroup,
      this.flag,
      this.ring,
    );
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.solid.needsUpdate = true;
  }

  resize(): void {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.updateCamera();
  }

  // Camera

  private updateCamera(): void {
    const h = VIEW_HEIGHT / this.zoom;
    const w = h * (this.width / this.height);
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.position.copy(this.target).addScaledVector(CAMERA_DIR, 80);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /** The point on the ground under a screen position. */
  groundAt(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, out);
  }

  tileAt(clientX: number, clientY: number): { x: number; y: number; inside: boolean } | null {
    const p = this.groundAt(clientX, clientY);
    if (!p) return null;
    const x = Math.floor(p.x + HALF_W);
    const y = Math.floor(p.z + HALF_H);
    return { x, y, inside: inBounds(x, y) };
  }

  /** The pawn drawn closest to a screen position, if any is close enough to tap. */
  pawnAt(clientX: number, clientY: number): number {
    const p = this.groundAt(clientX, clientY);
    if (!p) return 0;
    let best = 0;
    let bestD = 0.75;
    for (const [id, v] of this.pawnViews) {
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  panBy(dx: number, dz: number): void {
    this.focusTarget = null;
    this.target.x = Math.max(-HALF_W, Math.min(HALF_W, this.target.x + dx));
    this.target.z = Math.max(-HALF_H, Math.min(HALF_H, this.target.z + dz));
    this.updateCamera();
  }

  /** Zooms while keeping the ground point under (clientX, clientY) still. */
  zoomAt(factor: number, clientX: number, clientY: number): void {
    const before = this.groundAt(clientX, clientY);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    this.updateCamera();
    const after = this.groundAt(clientX, clientY);
    if (before && after) this.panBy(before.x - after.x, before.z - after.z);
  }

  focusOn(tile: number, instant = false): void {
    const t = new THREE.Vector3(worldX(tileX(tile)), 0, worldZ(tileY(tile)));
    if (instant) {
      this.target.copy(t);
      this.focusTarget = null;
      this.updateCamera();
    } else {
      this.focusTarget = t;
    }
  }

  // Frame

  render(s: SimState, alpha: number, time: number, selectedId: number): void {
    if (s !== this.state) this.rebuildAll(s);
    if (s.structVersion !== this.structVersion || s.tick >= this.berryCheckTick) {
      this.syncBoard(s);
      this.structVersion = s.structVersion;
      this.berryCheckTick = s.tick + 40;
    }
    if (s.itemVersion !== this.itemVersion) {
      this.syncItems(s);
      this.itemVersion = s.itemVersion;
    }
    this.syncPawns(s, alpha, time, selectedId);
    this.animateFires(s, time);
    this.light(s, alpha);
    if (this.focusTarget) {
      this.target.lerp(this.focusTarget, 0.18);
      if (this.target.distanceTo(this.focusTarget) < 0.02) this.focusTarget = null;
      this.updateCamera();
    }
    this.renderer.render(this.scene, this.camera);
  }

  setPreview(placements: readonly Placement[]): void {
    const mesh = this.preview;
    let n = 0;
    for (const p of placements) {
      if (n >= MAP_N) break;
      this.dummy.position.set(worldX(tileX(p.tile)), 0, worldZ(tileY(p.tile)));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(n, this.dummy.matrix);
      const color = !p.ok
        ? PALETTE.invalid
        : p.action === 'designate'
          ? PALETTE.designate
          : p.action === 'zone'
            ? PALETTE.zone
            : p.action === 'clear' || p.action === 'demolish'
              ? PALETTE.demolish
              : PALETTE.valid;
      mesh.setColorAt(n, this.tmpColor.setHex(color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Board

  private rebuildAll(s: SimState): void {
    this.state = s;
    this.structVersion = -1;
    this.itemVersion = -1;
    for (const obj of this.structureObjects.values()) this.structures.remove(obj);
    this.structureObjects.clear();
    for (const obj of this.itemObjects.values()) this.itemGroup.remove(obj);
    this.itemObjects.clear();
    for (const v of this.pawnViews.values()) this.removePawn(v);
    this.pawnViews.clear();
    if (this.boardMesh) {
      this.board.remove(this.boardMesh);
      this.boardMesh.geometry.dispose();
    }
    this.boardMesh = this.buildTerrain(s);
    this.board.add(this.boardMesh);

    const tiles: number[] = [];
    for (let t = 0; t < MAP_N; t++) if (s.terrain[t] === TERRAIN.MOUNTAIN) tiles.push(t);
    this.fill(this.mountains, tiles, (t) => ({ y: 0, rot: hash01(s.seed + 5, tileX(t), tileY(t)) * 6.28, scale: 0.85 + hash01(s.seed + 6, tileX(t), tileY(t)) * 0.3 }));
    this.focusOn(s.home, true);
  }

  private buildTerrain(s: SimState): THREE.Mesh {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const color = this.tmpColor;
    const BASE = -1.3;
    const height = (t: number): number =>
      s.terrain[t] === TERRAIN.WATER ? -0.26 : s.terrain[t] === TERRAIN.SAND ? -0.03 : 0;
    const depth = waterDepth(s);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const d = new THREE.Vector3();
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const quad = (hex: number, shade: number): void => {
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      const flip = e1.cross(e2).dot(n) < 0;
      const order = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
      color.setHex(hex).multiplyScalar(shade);
      for (const v of order) {
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        col.push(color.r, color.g, color.b);
      }
    };

    const sides: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let t = 0; t < MAP_N; t++) {
      const x = tileX(t);
      const y = tileY(t);
      const h = height(t);
      const x0 = worldX(x) - 0.5;
      const z0 = worldZ(y) - 0.5;
      const shade = 0.97 + hash01(s.seed + 3, x, y) * 0.06;
      const terrain = s.terrain[t];
      let top: number;
      if (terrain === TERRAIN.WATER) top = PALETTE.water[Math.min(2, depth[t] - 1)];
      else if (terrain === TERRAIN.SAND) top = PALETTE.sand;
      else if (terrain === TERRAIN.MOUNTAIN) top = PALETTE.mountainGround;
      else top = s.feature[t] === FEATURE.TREE ? PALETTE.forestFloor : PALETTE.grass;
      a.set(x0, h, z0);
      b.set(x0, h, z0 + 1);
      c.set(x0 + 1, h, z0 + 1);
      d.set(x0 + 1, h, z0);
      n.set(0, 1, 0);
      quad(top, terrain === TERRAIN.WATER ? 1 : shade);

      for (const [dx, dy] of sides) {
        const inside = inBounds(x + dx, y + dy);
        const nh = inside ? height(tileIndex(x + dx, y + dy)) : BASE;
        if (nh >= h - 0.001) continue;
        const side = terrain === TERRAIN.SAND ? PALETTE.sandSide : terrain === TERRAIN.WATER ? PALETTE.soilDark : PALETTE.soil;
        n.set(dx, 0, dy);
        const ex = dx === 1 ? x0 + 1 : x0;
        const ez = dy === 1 ? z0 + 1 : z0;
        if (dx !== 0) {
          a.set(ex, h, z0);
          b.set(ex, h, z0 + 1);
          c.set(ex, nh, z0 + 1);
          d.set(ex, nh, z0);
        } else {
          a.set(x0, h, ez);
          b.set(x0 + 1, h, ez);
          c.set(x0 + 1, nh, ez);
          d.set(x0, nh, ez);
        }
        quad(inside ? side : PALETTE.soilDark, inside ? 0.92 : 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, this.solid);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Writes instance transforms for a list of tiles. */
  private fill(
    mesh: THREE.InstancedMesh,
    tiles: readonly number[],
    place: (t: number) => { y: number; rot: number; scale: number; jitter?: number; color?: number },
  ): void {
    const s = this.state!;
    let n = 0;
    for (const t of tiles) {
      const x = tileX(t);
      const y = tileY(t);
      const p = place(t);
      const j = p.jitter ?? 0;
      this.dummy.position.set(
        worldX(x) + (hash01(s.seed + 11, x, y) - 0.5) * j,
        p.y,
        worldZ(y) + (hash01(s.seed + 13, x, y) - 0.5) * j,
      );
      this.dummy.rotation.set(0, p.rot, 0);
      this.dummy.scale.setScalar(p.scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(n, this.dummy.matrix);
      mesh.setColorAt(n, this.tmpColor.setHex(p.color ?? 0xffffff));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private syncBoard(s: SimState): void {
    const pines: number[] = [];
    const rounds: number[] = [];
    const bushes: number[] = [];
    const ripe: number[] = [];
    const boulders: number[] = [];
    const woodWalls: number[] = [];
    const stoneWalls: number[] = [];
    const marks: number[] = [];
    for (let t = 0; t < MAP_N; t++) {
      const f = s.feature[t];
      if (f === FEATURE.TREE) (hash01(s.seed + 7, tileX(t), tileY(t)) < 0.68 ? pines : rounds).push(t);
      else if (f === FEATURE.BUSH) {
        bushes.push(t);
        if (s.regrow[t] <= s.tick) ripe.push(t);
      } else if (f === FEATURE.BOULDER) boulders.push(t);
      const k = s.structKind[t];
      if (k === SK.WALL) woodWalls.push(t);
      else if (k === SK.STONE_WALL) stoneWalls.push(t);
      if ((s.designated[t] && f !== FEATURE.NONE) || (s.decon[t] && s.structGrid[t])) marks.push(t);
    }
    const seed = s.seed;
    const natural = (t: number): { y: number; rot: number; scale: number; jitter: number } => ({
      y: 0,
      rot: hash01(seed + 5, tileX(t), tileY(t)) * 6.28,
      scale: 0.82 + hash01(seed + 6, tileX(t), tileY(t)) * 0.36,
      jitter: 0.22,
    });
    this.fill(this.pines, pines, natural);
    this.fill(this.rounds, rounds, natural);
    this.fill(this.bushes, bushes, natural);
    this.fill(this.berries, ripe, natural);
    this.fill(this.boulders, boulders, natural);
    this.fillWalls(s, woodWalls, this.woodPosts, this.woodArms);
    this.fillWalls(s, stoneWalls, this.stonePosts, this.stoneArms);
    this.fill(this.markers, marks, (t) => {
      const f = s.feature[t];
      const demolish = s.decon[t] && s.structGrid[t];
      const y = demolish ? 0.95 : f === FEATURE.TREE ? 1.12 : 0.62;
      return { y, rot: 0.6, scale: 1, color: demolish ? PALETTE.demolish : PALETTE.designate };
    });

    const tall = s.blueprints.filter((bp) => bp.kind === 'wall' || bp.kind === 'stoneWall' || bp.kind === 'door');
    const flat = s.blueprints.filter((bp) => !tall.includes(bp));
    const bpStyle = (t: number): { y: number; rot: number; scale: number; color: number } => {
      const bp = s.blueprints.find((b) => b.tile === t)!;
      const ready = bp.delivered >= STRUCTURES[bp.kind].cost;
      return { y: 0, rot: 0, scale: 1, color: ready ? 0xbfe6ff : PALETTE.blueprint };
    };
    this.fill(this.bpTall, tall.map((bp) => bp.tile), bpStyle);
    this.fill(this.bpFlat, flat.map((bp) => bp.tile), bpStyle);

    this.syncStructures(s);
    this.syncZone(s);
    this.flag.visible = s.rally >= 0;
    if (s.rally >= 0) this.flag.position.set(worldX(tileX(s.rally)), 0, worldZ(tileY(s.rally)));
  }

  /** Posts on every wall tile, arms toward each neighbouring wall or door. */
  private fillWalls(s: SimState, tiles: readonly number[], posts: THREE.InstancedMesh, arms: THREE.InstancedMesh): void {
    const square = (): { y: number; rot: number; scale: number } => ({ y: 0, rot: 0, scale: 1 });
    this.fill(posts, tiles, square);
    let n = 0;
    const white = this.tmpColor.setHex(0xffffff);
    for (const t of tiles) {
      const x = tileX(t);
      const y = tileY(t);
      for (const [dx, dy, rot] of WALL_ARMS) {
        if (!inBounds(x + dx, y + dy)) continue;
        const k = s.structKind[tileIndex(x + dx, y + dy)];
        if (k !== SK.WALL && k !== SK.STONE_WALL && k !== SK.DOOR) continue;
        this.dummy.position.set(worldX(x), 0, worldZ(y));
        this.dummy.rotation.set(0, rot, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        arms.setMatrixAt(n, this.dummy.matrix);
        arms.setColorAt(n, white);
        n++;
      }
    }
    arms.count = n;
    arms.instanceMatrix.needsUpdate = true;
    if (arms.instanceColor) arms.instanceColor.needsUpdate = true;
  }

  private syncZone(s: SimState): void {
    if (this.zoneMesh) {
      this.scene.remove(this.zoneMesh);
      this.zoneMesh.geometry.dispose();
      this.zoneMesh = null;
    }
    const pos: number[] = [];
    for (let t = 0; t < MAP_N; t++) {
      if (!s.zone[t]) continue;
      const x0 = worldX(tileX(t)) - 0.46;
      const z0 = worldZ(tileY(t)) - 0.46;
      const y = 0.015;
      pos.push(x0, y, z0, x0, y, z0 + 0.92, x0 + 0.92, y, z0 + 0.92, x0, y, z0, x0 + 0.92, y, z0 + 0.92, x0 + 0.92, y, z0);
    }
    if (pos.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.zoneMesh = new THREE.Mesh(geo, this.mat.zone);
    this.scene.add(this.zoneMesh);
  }

  private syncStructures(s: SimState): void {
    const seen = new Set<number>();
    for (const st of s.structures) {
      if (st.kind === 'wall' || st.kind === 'stoneWall') continue;
      seen.add(st.id);
      let obj = this.structureObjects.get(st.id);
      if (!obj) {
        obj = this.makeStructure(st);
        obj.position.set(worldX(tileX(st.tile)), 0, worldZ(tileY(st.tile)));
        this.structures.add(obj);
        this.structureObjects.set(st.id, obj);
      }
      if (st.kind === 'door') obj.rotation.y = doorAlongZ(s, st.tile) ? Math.PI / 2 : 0;
      if (st.kind === 'bed') {
        const owner = s.pawns.find((p) => p.id === st.ownerId);
        const blanket = obj.children[1] as THREE.Mesh;
        blanket.material = this.blanketMaterial(owner ? PALETTE.shirt[owner.look.shirt] : 0x8c97a6);
      }
    }
    for (const [id, obj] of this.structureObjects) {
      if (seen.has(id)) continue;
      this.structures.remove(obj);
      this.structureObjects.delete(id);
    }
    // The pool of lights never changes size (that would recompile every shader); unused ones go dark.
    const fires = s.structures.filter((st) => st.kind === 'campfire');
    this.fireLights.forEach((light, i) => {
      const fire = fires[i];
      light.userData.lit = !!fire;
      if (fire) light.position.set(worldX(tileX(fire.tile)), 0.7, worldZ(tileY(fire.tile)));
    });
  }

  private blanketMaterial(color: number): THREE.MeshLambertMaterial {
    let m = this.blanketMats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.blanketMats.set(color, m);
    }
    return m;
  }

  private makeStructure(st: Structure): THREE.Object3D {
    const group = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, material: THREE.Material = this.solid): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    switch (st.kind) {
      case 'door':
        add(this.geo.door);
        break;
      case 'bed':
        add(this.geo.bed);
        add(this.geo.blanket, this.blanketMaterial(0x8c97a6));
        group.rotation.y = (st.id % 2) * Math.PI;
        break;
      case 'campfire': {
        add(this.geo.campfire);
        const outer = add(this.geo.flameOuter, this.mat.flame);
        const inner = add(this.geo.flameInner, this.mat.flameCore);
        outer.castShadow = inner.castShadow = false;
        group.userData.flames = [outer, inner];
        break;
      }
      case 'trap':
        add(this.geo.trap);
        break;
      case 'grave':
        add(this.geo.grave);
        break;
      default:
        break;
    }
    group.userData.kind = st.kind;
    return group;
  }

  private animateFires(s: SimState, time: number): void {
    let i = 0;
    for (const obj of this.structureObjects.values()) {
      const flames = obj.userData.flames as THREE.Mesh[] | undefined;
      if (!flames) continue;
      const f = 1 + Math.sin(time * 0.013 + i * 1.7) * 0.12 + Math.sin(time * 0.031 + i) * 0.06;
      flames[0].scale.set(1, f, 1);
      flames[1].scale.set(1, 2 - f, 1);
      i++;
    }
    const night = 1 - daylight(hourOf(s.tick));
    this.fireLights.forEach((light, k) => {
      light.intensity = light.userData.lit ? 0.6 + night * 5 * (1 + Math.sin(time * 0.02 + k * 2) * 0.12) : 0;
    });
  }

  // Items

  private syncItems(s: SimState): void {
    const seen = new Set<number>();
    for (const it of s.items) {
      seen.add(it.id);
      let mesh = this.itemObjects.get(it.id);
      if (!mesh || mesh.userData.type !== it.type) {
        if (mesh) this.itemGroup.remove(mesh);
        mesh = new THREE.Mesh(this.items[it.type], this.solid);
        mesh.castShadow = true;
        mesh.userData.type = it.type;
        this.placeItem(mesh, it);
        this.itemGroup.add(mesh);
        this.itemObjects.set(it.id, mesh);
      }
      mesh.scale.setScalar(0.75 + 0.55 * Math.min(1, it.count / (STACK_MAX[it.type] * 0.6)));
    }
    for (const [id, mesh] of this.itemObjects) {
      if (seen.has(id)) continue;
      this.itemGroup.remove(mesh);
      this.itemObjects.delete(id);
    }
  }

  private placeItem(mesh: THREE.Mesh, it: ItemStack): void {
    const x = tileX(it.tile);
    const y = tileY(it.tile);
    mesh.position.set(worldX(x) + (hash01(it.id, x, y) - 0.5) * 0.2, 0, worldZ(y) + (hash01(it.id + 1, x, y) - 0.5) * 0.2);
    mesh.rotation.y = hash01(it.id + 2, x, y) * 6.28;
  }

  // Pawns

  private pawnGeometry(p: Pawn): THREE.BufferGeometry {
    const key = `${p.kind}:${p.look.skin}:${p.look.shirt}:${p.look.hair}`;
    let geo = this.pawnGeos.get(key);
    if (!geo) {
      geo =
        p.kind === 'goblin'
          ? M.goblin({ skin: PALETTE.goblinSkin, cloth: PALETTE.goblinCloth[p.look.shirt % PALETTE.goblinCloth.length], hair: 0 })
          : M.colonist({ skin: PALETTE.skin[p.look.skin], cloth: PALETTE.shirt[p.look.shirt], hair: PALETTE.hair[p.look.hair] });
      this.pawnGeos.set(key, geo);
    }
    return geo;
  }

  private makePawn(p: Pawn): PawnView {
    const root = new THREE.Group();
    const pose = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const body = new THREE.Mesh(this.pawnGeometry(p), material);
    body.castShadow = true;
    const carryMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const carry = new THREE.Mesh(this.geo.carried, carryMaterial);
    carry.visible = false;
    pose.add(body, carry);
    const blob = new THREE.Mesh(this.geo.blob, this.mat.blob);
    blob.position.y = 0.02;
    root.add(pose, blob);
    root.scale.setScalar(p.kind === 'goblin' ? 1.25 : 1.35);
    this.pawnGroup.add(root);
    let label: HTMLDivElement | null = null;
    if (p.kind === 'colonist') {
      label = document.createElement('div');
      label.className = 'pawn-label';
      this.labels.appendChild(label);
    }
    return { root, pose, material, carry, carryMaterial, label, labelKey: '', x: 0, z: 0, heading: Math.atan2(p.faceX, p.faceY) };
  }

  private removePawn(v: PawnView): void {
    this.pawnGroup.remove(v.root);
    v.material.dispose();
    v.carryMaterial.dispose();
    v.label?.remove();
  }

  private syncPawns(s: SimState, alpha: number, time: number, selectedId: number): void {
    const seen = new Set<number>();
    const perTile = new Map<number, number>();
    const project = new THREE.Vector3();
    this.ring.visible = false;
    for (const p of s.pawns) {
      seen.add(p.id);
      let v = this.pawnViews.get(p.id);
      if (!v) {
        v = this.makePawn(p);
        this.pawnViews.set(p.id, v);
      }
      const moving = p.moveT < p.moveDur;
      const t = moving ? Math.min(1, (p.moveT + alpha) / p.moveDur) : 1;
      let x = worldX(p.fromX + (p.x - p.fromX) * t);
      let z = worldZ(p.fromY + (p.y - p.fromY) * t);
      if (!moving) {
        // Spread out pawns that share a tile.
        const tile = tileIndex(p.x, p.y);
        const k = perTile.get(tile) ?? 0;
        perTile.set(tile, k + 1);
        if (k > 0) {
          x += Math.cos(k * 2.4) * 0.22;
          z += Math.sin(k * 2.4) * 0.22;
        }
      }
      v.x = x;
      v.z = z;

      const want = Math.atan2(p.faceX, p.faceY);
      let diff = want - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.heading += diff * 0.25;

      const job = p.job;
      const asleep = job?.kind === 'sleep' && job.asleep;
      const lying = p.life === 'downed' || asleep;
      const working = !moving && !!job && ['harvest', 'build', 'cook', 'decon', 'tend', 'bash', 'eat'].includes(job.kind);
      let lift = 0;
      if (moving) lift = Math.abs(Math.sin(time * 0.017 + p.id)) * 0.06;
      else if (working) lift = Math.abs(Math.sin(time * 0.011 + p.id)) * 0.035;
      const sinceAttack = s.tick - p.lastAttackTick + alpha;
      const lunge = sinceAttack < 4 ? (1 - sinceAttack / 4) * 0.16 : 0;

      v.root.position.set(x + Math.sin(v.heading) * lunge, 0, z + Math.cos(v.heading) * lunge);
      v.root.rotation.y = v.heading;
      const onBed = asleep && s.structKind[tileIndex(p.x, p.y)] === SK.BED;
      v.pose.position.y = lying ? (onBed ? 0.26 : 0.1) : lift;
      v.pose.rotation.x = lying ? -Math.PI / 2 : 0;
      v.pose.rotation.z = p.mental && !lying ? Math.sin(time * 0.004 + p.id) * 0.15 : 0;
      v.material.emissive.setHex(s.tick - p.hitTick < 3 ? 0x992211 : 0x000000);

      v.carry.visible = !!p.carry && !lying;
      if (p.carry) v.carryMaterial.color.setHex(CARRY_COLOR[p.carry.type]);

      if (p.id === selectedId) {
        this.ring.visible = true;
        this.ring.position.set(x, 0.03, z);
      }

      if (v.label) {
        const badge = pawnBadge(p);
        const key = `${firstName(p)}|${badge ?? ''}`;
        if (key !== v.labelKey) {
          v.labelKey = key;
          v.label.innerHTML = `${badge ? `<span class="badge badge-${badge}">${BADGE_ICON[badge]}</span>` : ''}<span>${firstName(p)}</span>`;
        }
        project.set(x, lying ? 0.55 : 0.95, z).project(this.camera);
        const sx = (project.x * 0.5 + 0.5) * this.width;
        const sy = (-project.y * 0.5 + 0.5) * this.height;
        v.label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
        v.label.classList.toggle('selected', p.id === selectedId);
      }
    }
    for (const [id, v] of this.pawnViews) {
      if (seen.has(id)) continue;
      this.removePawn(v);
      this.pawnViews.delete(id);
    }
  }

  // Light

  private light(s: SimState, alpha: number): void {
    const d = daylight(hourOf(s.tick + alpha));
    const dusk = 1 - Math.abs(d - 0.5) * 2;
    const c = LIGHT_COLORS;
    this.sky.copy(c.skyNight).lerp(c.skyDay, d).lerp(c.skyDusk, dusk * 0.55);
    this.sun.color.copy(c.sunNight).lerp(c.sunDay, d).lerp(c.sunDusk, dusk * 0.7);
    this.sun.intensity = 0.35 + 2.05 * d;
    this.hemi.intensity = 0.6 + 0.95 * d;
  }
}

/** 1 in full daylight, 0 at night, easing through dawn and dusk. */
export function daylight(hour: number): number {
  if (hour >= 6.5 && hour < 18.5) return 1;
  if (hour >= 18.5 && hour < 21) return 1 - (hour - 18.5) / 2.5;
  if (hour >= 4.5 && hour < 6.5) return (hour - 4.5) / 2;
  return 0;
}

/** Distance of every water tile from the nearest shore, for shallow-to-deep shading. */
function waterDepth(s: SimState): Int32Array {
  const depth = new Int32Array(MAP_N);
  const queue: number[] = [];
  for (let t = 0; t < MAP_N; t++) {
    if (s.terrain[t] !== TERRAIN.WATER) {
      depth[t] = 0;
      queue.push(t);
    } else {
      depth[t] = -1;
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const x = tileX(t);
    const y = tileY(t);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!inBounds(x + dx, y + dy)) continue;
      const n = tileIndex(x + dx, y + dy);
      if (depth[n] !== -1) continue;
      depth[n] = depth[t] + 1;
      queue.push(n);
    }
  }
  for (let t = 0; t < MAP_N; t++) if (depth[t] < 1 && s.terrain[t] === TERRAIN.WATER) depth[t] = 3;
  return depth;
}

/** Doors turn to sit in the wall line they belong to. */
function doorAlongZ(s: SimState, t: number): boolean {
  const x = tileX(t);
  const y = tileY(t);
  const wallish = (xx: number, yy: number): boolean => {
    if (!inBounds(xx, yy)) return false;
    const k = s.structKind[tileIndex(xx, yy)];
    return k === SK.WALL || k === SK.STONE_WALL;
  };
  return (wallish(x, y - 1) || wallish(x, y + 1)) && !(wallish(x - 1, y) || wallish(x + 1, y));
}
