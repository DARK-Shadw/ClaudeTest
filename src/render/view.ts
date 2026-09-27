/**
 * Draws a SimState as a low-poly diorama. The renderer only reads the state: it never changes
 * the simulation, so the same state could just as well be streamed from a server.
 */
import * as THREE from 'three';
import {
  FEATURE,
  ITEMS,
  MAP_H,
  MAP_N,
  MAP_W,
  STRUCT_CODE,
  TERRAIN,
  blueprintSpec,
  firstName,
  hourOf,
  inBounds,
  pawnBadge,
  seasonOf,
  tileIndex,
  tileX,
  tileY,
  type BuildKind,
  type ItemStack,
  type ItemType,
  type Pawn,
  type PawnBadge,
  type Placement,
  type Season,
  type SimState,
  type Structure,
  type StructureKind,
  type WeaponId,
} from '../sim';
import { hash01 } from '../sim/noise';
import { ICONS } from '../ui/icons';
import { groundworkGeometry, stockpileGeometry, terrainGeometry, worldX, worldZ } from './board';
import * as M from './models';
import { PALETTE } from './palette';

export { worldX, worldZ };

const HALF_W = MAP_W / 2;
const HALF_H = MAP_H / 2;

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
/** The number of point lights never changes, since that would recompile every shader. */
const LIGHT_POOL = 4;
const RING_POOL = 24;
const ARROW_POOL = 32;
const ARROW_TICKS = 5;

const LIGHT_COLORS = {
  skyDay: new THREE.Color(PALETTE.sky.day),
  skyWinter: new THREE.Color(0xc9dbe6),
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

const BADGE_ICON: Record<Exclude<PawnBadge, null>, string> = {
  down: ICONS.down,
  sleep: ICONS.sleep,
  fight: ICONS.sword,
  flee: ICONS.flee,
  daze: ICONS.daze,
  brawl: ICONS.fist,
  hungry: ICONS.hungry,
  drafted: ICONS.shield,
};

const CARRY_COLOR: Record<ItemType, number> = {
  wood: PALETTE.wood,
  stone: PALETTE.stone,
  iron: PALETTE.iron,
  leather: PALETTE.leather,
  berries: PALETTE.berry,
  potato: PALETTE.potato,
  meat: PALETTE.meat,
  herbs: PALETTE.herb,
  meal: PALETTE.linen,
  fineMeal: PALETTE.linen,
  club: PALETTE.woodDark,
  spear: PALETTE.woodDark,
  sword: PALETTE.metal,
  bow: PALETTE.woodDark,
  leatherArmor: PALETTE.leather,
  ironArmor: PALETTE.iron,
};

type Furniture = Exclude<StructureKind, 'wall' | 'stoneWall'>;

const FURNITURE_MODELS: Record<Furniture, () => THREE.BufferGeometry> = {
  grave: M.grave,
  door: M.door,
  bed: M.bedFrame,
  table: M.table,
  stool: M.stool,
  torch: M.torch,
  campfire: M.campfireBase,
  stove: M.stove,
  craftBench: M.craftBench,
  researchDesk: M.researchDesk,
  horseshoes: M.horseshoes,
  chessTable: M.chessTable,
  plantPot: M.plantPot,
  statue: M.statue,
  trap: M.trap,
  barricade: M.barricade,
  tower: M.tower,
};
const FURNITURE = Object.keys(FURNITURE_MODELS) as Furniture[];

/** Blueprints drawn as a tall ghost: anything that stands up like a wall. */
const TALL_BLUEPRINTS: ReadonlySet<string> = new Set<BuildKind>(['wall', 'stoneWall', 'door', 'stove', 'craftBench', 'researchDesk', 'statue', 'tower', 'campfire']);

const HELD: Partial<Record<WeaponId, M.HeldWeapon>> = { club: 'club', spear: 'spear', sword: 'sword', bow: 'bow', maul: 'maul', axe: 'axe' };

const PAWN_SCALE: Record<string, number> = {
  colonist: 1.35,
  fighter: 1.25,
  archer: 1.25,
  brute: 1.55,
  chief: 1.45,
  deer: 1.35,
  hare: 1.1,
  boar: 1.3,
  wolf: 1.3,
};

interface PawnView {
  root: THREE.Group;
  pose: THREE.Group;
  material: THREE.MeshLambertMaterial;
  weapon: THREE.Mesh;
  weaponKind: string;
  armor: THREE.Mesh;
  armorKind: string;
  carry: THREE.Mesh;
  carryMaterial: THREE.MeshLambertMaterial;
  label: HTMLDivElement | null;
  labelKey: string;
  x: number;
  y: number;
  z: number;
  heading: number;
}

function instanced(geo: THREE.BufferGeometry, material: THREE.Material, capacity: number, colors = false): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (colors) mesh.setColorAt(0, new THREE.Color(0xffffff));
  mesh.frustumCulled = false;
  return mesh;
}

interface Placed {
  y?: number;
  rot?: number;
  scale?: number;
  jitter?: number;
  color?: number;
}

interface LightSource {
  tile: number;
  kind: 'campfire' | 'stove' | 'torch';
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
  private readonly lights: THREE.PointLight[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly sky = new THREE.Color();

  private readonly geo = {
    pine: M.pineTree(),
    snowPine: M.snowPine(),
    round: M.roundTree(),
    autumn: M.autumnTree(),
    bare: M.bareTree(),
    bush: M.bush(),
    bareBush: M.bareBush(),
    berries: M.berries(),
    boulder: M.boulder(),
    ore: M.oreRock(),
    mountain: M.mountain(),
    potato: M.potatoPlant(),
    healroot: M.healrootPlant(),
    woodPost: M.wallPost(M.WOOD_WALL),
    woodArm: M.wallArm(M.WOOD_WALL),
    stonePost: M.wallPost(M.STONE_WALL),
    stoneArm: M.wallArm(M.STONE_WALL),
    blanket: M.blanket(),
    flameOuter: M.flameOuter(),
    flameInner: M.flameInner(),
    torchFlame: M.torchFlame(),
    stoveFire: M.stoveFire(),
    flag: M.rallyFlag(),
    carried: M.carried(),
    arrow: M.arrow(),
    moveMarker: M.moveMarker(),
    marker: new THREE.OctahedronGeometry(0.09, 0),
    bpTall: new THREE.BoxGeometry(0.5, 0.46, 0.5).translate(0, 0.23, 0),
    bpFlat: new THREE.BoxGeometry(0.8, 0.18, 0.8).translate(0, 0.09, 0),
    bpFloor: new THREE.BoxGeometry(0.94, 0.03, 0.94).translate(0, 0.03, 0),
    preview: new THREE.BoxGeometry(0.94, 0.06, 0.94).translate(0, 0.04, 0),
    blob: new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2),
    ring: new THREE.TorusGeometry(0.34, 0.035, 6, 28).rotateX(Math.PI / 2),
  };
  private readonly items: Record<ItemType, THREE.BufferGeometry> = {
    wood: M.woodPile(),
    stone: M.stonePile(),
    iron: M.ironPile(),
    leather: M.leatherPile(),
    berries: M.berryBasket(),
    potato: M.potatoSack(),
    meat: M.meatCut(),
    herbs: M.herbBundle(),
    meal: M.mealBowl(),
    fineMeal: M.fineMealPlate(),
    club: M.weaponItem('club'),
    spear: M.weaponItem('spear'),
    sword: M.weaponItem('sword'),
    bow: M.weaponItem('bow'),
    leatherArmor: M.armorItem('leatherArmor'),
    ironArmor: M.armorItem('ironArmor'),
  };
  private readonly weaponGeos = new Map<string, THREE.BufferGeometry>();
  private readonly armorGeos = new Map<string, THREE.BufferGeometry>();

  private readonly mat = {
    blueprint: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }),
    zone: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false }),
    marker: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    preview: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
    flame: new THREE.MeshBasicMaterial({ color: PALETTE.flame }),
    flameCore: new THREE.MeshBasicMaterial({ color: PALETTE.flameCore }),
    blanket: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    blob: new THREE.MeshBasicMaterial({ color: PALETTE.shadow, transparent: true, opacity: 0.22, depthWrite: false }),
    ring: new THREE.MeshBasicMaterial({ color: PALETTE.selection }),
    moveMarker: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
  };
  private readonly pawnGeos = new Map<string, THREE.BufferGeometry>();

  private readonly board = new THREE.Group();
  private readonly mountains = instanced(this.geo.mountain, this.solid, MAP_N);
  private readonly pines = instanced(this.geo.pine, this.solid, MAP_N);
  private readonly rounds = instanced(this.geo.round, this.solid, MAP_N);
  private readonly bushes = instanced(this.geo.bush, this.solid, MAP_N);
  private readonly berries = instanced(this.geo.berries, this.solid, MAP_N);
  private readonly boulders = instanced(this.geo.boulder, this.solid, MAP_N);
  private readonly ores = instanced(this.geo.ore, this.solid, MAP_N);
  private readonly potatoes = instanced(this.geo.potato, this.solid, MAP_N);
  private readonly healroots = instanced(this.geo.healroot, this.solid, MAP_N);
  private readonly woodPosts = instanced(this.geo.woodPost, this.solid, MAP_N);
  private readonly woodArms = instanced(this.geo.woodArm, this.solid, MAP_N * 2);
  private readonly stonePosts = instanced(this.geo.stonePost, this.solid, MAP_N);
  private readonly stoneArms = instanced(this.geo.stoneArm, this.solid, MAP_N * 2);
  private readonly furniture = new Map<Furniture, THREE.InstancedMesh>();
  private readonly blankets = instanced(this.geo.blanket, this.mat.blanket, 1024, true);
  private readonly flamesOuter = instanced(this.geo.flameOuter, this.mat.flame, 256);
  private readonly flamesInner = instanced(this.geo.flameInner, this.mat.flameCore, 256);
  private readonly torchFlames = instanced(this.geo.torchFlame, this.mat.flameCore, 1024);
  private readonly stoveFires = instanced(this.geo.stoveFire, this.mat.flame, 256);
  private readonly bpTall = instanced(this.geo.bpTall, this.mat.blueprint, MAP_N, true);
  private readonly bpFlat = instanced(this.geo.bpFlat, this.mat.blueprint, MAP_N, true);
  private readonly bpFloor = instanced(this.geo.bpFloor, this.mat.blueprint, MAP_N, true);
  private readonly markers = instanced(this.geo.marker, this.mat.marker, MAP_N, true);
  private readonly preview = instanced(this.geo.preview, this.mat.preview, MAP_N, true);
  private readonly itemGroup = new THREE.Group();
  private readonly itemObjects = new Map<number, THREE.Mesh>();
  private readonly pawnGroup = new THREE.Group();
  private readonly pawnViews = new Map<number, PawnView>();
  private readonly flag: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];
  private readonly moveMarkers: THREE.Mesh[] = [];
  private readonly arrows: THREE.Mesh[] = [];
  private readonly pulse: THREE.Mesh;
  private flashTime = -1e9;
  private terrainMesh: THREE.Mesh | null = null;
  private groundworkMesh: THREE.Mesh | null = null;
  private stockpileMesh: THREE.Mesh | null = null;

  private state: SimState | null = null;
  private season: Season | '' = '';
  private structVersion = -1;
  private itemVersion = -1;
  private berryCheckTick = 0;
  private lightSources: LightSource[] = [];
  private campfires: number[] = [];
  private torches: number[] = [];
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
      this.lights.push(light);
      this.scene.add(light);
    }

    this.flag = new THREE.Mesh(this.geo.flag, this.solid);
    this.flag.castShadow = true;
    this.flag.visible = false;
    for (let i = 0; i < RING_POOL; i++) {
      const ring = new THREE.Mesh(this.geo.ring, this.mat.ring);
      ring.visible = false;
      this.rings.push(ring);
      const mark = new THREE.Mesh(this.geo.moveMarker, this.mat.moveMarker);
      mark.visible = false;
      this.moveMarkers.push(mark);
    }
    for (let i = 0; i < ARROW_POOL; i++) {
      const arrow = new THREE.Mesh(this.geo.arrow, this.solid);
      arrow.visible = false;
      this.arrows.push(arrow);
    }
    this.pulse = new THREE.Mesh(this.geo.moveMarker, this.mat.moveMarker.clone());
    this.pulse.visible = false;

    for (const kind of FURNITURE) {
      const capacity = kind === 'trap' || kind === 'barricade' ? 2048 : 1024;
      this.furniture.set(kind, instanced(FURNITURE_MODELS[kind](), this.solid, capacity));
    }
    for (const m of [this.flamesOuter, this.flamesInner, this.torchFlames, this.stoveFires, this.preview, this.markers, this.bpTall, this.bpFlat, this.bpFloor]) {
      m.castShadow = false;
    }
    this.potatoes.castShadow = false;
    this.healroots.castShadow = false;

    this.scene.add(
      this.board,
      this.mountains,
      this.pines,
      this.rounds,
      this.bushes,
      this.berries,
      this.boulders,
      this.ores,
      this.potatoes,
      this.healroots,
      this.woodPosts,
      this.woodArms,
      this.stonePosts,
      this.stoneArms,
      ...this.furniture.values(),
      this.blankets,
      this.flamesOuter,
      this.flamesInner,
      this.torchFlames,
      this.stoveFires,
      this.bpTall,
      this.bpFlat,
      this.bpFloor,
      this.markers,
      this.preview,
      this.itemGroup,
      this.pawnGroup,
      this.flag,
      this.pulse,
      ...this.rings,
      ...this.moveMarkers,
      ...this.arrows,
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
      // Pawns up on a tower are drawn higher, so they are tapped higher too.
      const d = Math.hypot(v.x - p.x, v.z - v.y * 0.6 - p.z);
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

  /** Moves the camera so a tile sits at `screenY` (0 top, 1 bottom), clear of any sheet below. */
  focusOn(tile: number, instant = false, screenY = 0.5): void {
    const t = new THREE.Vector3(worldX(tileX(tile)), 0, worldZ(tileY(tile)));
    if (screenY !== 0.5) {
      const rect = this.canvas.getBoundingClientRect();
      const mid = this.groundAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const at = this.groundAt(rect.left + rect.width / 2, rect.top + rect.height * screenY);
      if (mid && at) t.add(mid.sub(at));
    }
    if (instant) {
      this.target.copy(t);
      this.focusTarget = null;
      this.updateCamera();
    } else {
      this.focusTarget = t;
    }
  }

  /** A ring that flashes where an order was given. */
  flashAt(tile: number, now: number): void {
    this.pulse.position.set(worldX(tileX(tile)), 0.02, worldZ(tileY(tile)));
    this.flashTime = now;
  }

  // Frame

  render(s: SimState, alpha: number, time: number, selected: ReadonlySet<number>): void {
    if (s !== this.state) this.rebuildAll(s);
    const season = seasonOf(s.tick);
    if (season !== this.season) this.setSeason(s, season);
    if (s.structVersion !== this.structVersion || s.tick >= this.berryCheckTick) {
      this.syncBoard(s);
      this.structVersion = s.structVersion;
      this.berryCheckTick = s.tick + 40;
    }
    if (s.itemVersion !== this.itemVersion) {
      this.syncItems(s);
      this.itemVersion = s.itemVersion;
    }
    this.syncPawns(s, alpha, time, selected);
    this.animateFires(s, time);
    this.light(s, alpha, season);
    const pulseAge = time - this.flashTime;
    this.pulse.visible = pulseAge < 600;
    if (this.pulse.visible) {
      const k = pulseAge / 600;
      this.pulse.scale.setScalar(0.6 + k * 0.9);
      (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
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
    this.commit(mesh, n);
  }

  // Board

  private rebuildAll(s: SimState): void {
    this.state = s;
    this.season = '';
    this.structVersion = -1;
    this.itemVersion = -1;
    for (const obj of this.itemObjects.values()) this.itemGroup.remove(obj);
    this.itemObjects.clear();
    for (const v of this.pawnViews.values()) this.removePawn(v);
    this.pawnViews.clear();
    const tiles: number[] = [];
    for (let t = 0; t < MAP_N; t++) if (s.terrain[t] === TERRAIN.MOUNTAIN) tiles.push(t);
    this.fill(this.mountains, tiles, (t) => ({ rot: hash01(s.seed + 5, tileX(t), tileY(t)) * 6.28, scale: 0.85 + hash01(s.seed + 6, tileX(t), tileY(t)) * 0.3 }));
    this.focusOn(s.home, true);
  }

  /** Repaints the ground and swaps the trees for the season. */
  private setSeason(s: SimState, season: Season): void {
    this.season = season;
    if (this.terrainMesh) {
      this.board.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }
    this.terrainMesh = new THREE.Mesh(terrainGeometry(s, season), this.solid);
    this.terrainMesh.receiveShadow = true;
    this.board.add(this.terrainMesh);
    const winter = season === 'winter';
    this.pines.geometry = winter ? this.geo.snowPine : this.geo.pine;
    this.rounds.geometry = winter ? this.geo.bare : season === 'autumn' ? this.geo.autumn : this.geo.round;
    this.bushes.geometry = winter ? this.geo.bareBush : this.geo.bush;
    this.structVersion = -1;
  }

  private commit(mesh: THREE.InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Writes instance transforms for a list of tiles. */
  private fill(mesh: THREE.InstancedMesh, tiles: readonly number[], place: (t: number) => Placed): void {
    const s = this.state!;
    let n = 0;
    const capacity = mesh.instanceMatrix.count;
    for (const t of tiles) {
      if (n >= capacity) break;
      const x = tileX(t);
      const y = tileY(t);
      const p = place(t);
      const j = p.jitter ?? 0;
      this.dummy.position.set(worldX(x) + (hash01(s.seed + 11, x, y) - 0.5) * j, p.y ?? 0, worldZ(y) + (hash01(s.seed + 13, x, y) - 0.5) * j);
      this.dummy.rotation.set(0, p.rot ?? 0, 0);
      this.dummy.scale.setScalar(p.scale ?? 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(n, this.dummy.matrix);
      if (mesh.instanceColor) mesh.setColorAt(n, this.tmpColor.setHex(p.color ?? 0xffffff));
      n++;
    }
    this.commit(mesh, n);
  }

  private syncBoard(s: SimState): void {
    const pines: number[] = [];
    const rounds: number[] = [];
    const bushes: number[] = [];
    const ripe: number[] = [];
    const boulders: number[] = [];
    const ores: number[] = [];
    const potatoes: number[] = [];
    const healroots: number[] = [];
    const woodWalls: number[] = [];
    const stoneWalls: number[] = [];
    const marks: number[] = [];
    const wall = STRUCT_CODE.wall;
    const stoneWall = STRUCT_CODE.stoneWall;
    for (let t = 0; t < MAP_N; t++) {
      const f = s.feature[t];
      if (f === FEATURE.TREE) (hash01(s.seed + 7, tileX(t), tileY(t)) < 0.68 ? pines : rounds).push(t);
      else if (f === FEATURE.BUSH) {
        bushes.push(t);
        if (s.regrow[t] <= s.tick) ripe.push(t);
      } else if (f === FEATURE.BOULDER) boulders.push(t);
      else if (f === FEATURE.ORE) ores.push(t);
      const crop = s.plant[t];
      if (crop === 1) potatoes.push(t);
      else if (crop === 2) healroots.push(t);
      const k = s.structKind[t];
      if (k === wall) woodWalls.push(t);
      else if (k === stoneWall) stoneWalls.push(t);
      if ((s.designated[t] && f !== FEATURE.NONE) || (s.decon[t] && s.structGrid[t])) marks.push(t);
    }
    const seed = s.seed;
    const natural = (t: number): Placed => ({
      rot: hash01(seed + 5, tileX(t), tileY(t)) * 6.28,
      scale: 0.82 + hash01(seed + 6, tileX(t), tileY(t)) * 0.36,
      jitter: 0.22,
    });
    this.fill(this.pines, pines, natural);
    this.fill(this.rounds, rounds, natural);
    this.fill(this.bushes, bushes, natural);
    this.fill(this.berries, ripe, natural);
    this.fill(this.boulders, boulders, natural);
    this.fill(this.ores, ores, natural);
    const crop = (t: number): Placed => {
      const g = s.growth[t] / 1000;
      return { rot: hash01(seed + 29, tileX(t), tileY(t)) * 6.28, scale: 0.35 + 0.75 * g, jitter: 0.1 };
    };
    this.fill(this.potatoes, potatoes, crop);
    this.fill(this.healroots, healroots, crop);
    this.fillWalls(s, woodWalls, this.woodPosts, this.woodArms);
    this.fillWalls(s, stoneWalls, this.stonePosts, this.stoneArms);
    this.fill(this.markers, marks, (t) => {
      const f = s.feature[t];
      const demolish = s.decon[t] && s.structGrid[t];
      const y = demolish ? 0.95 : f === FEATURE.TREE ? 1.12 : 0.62;
      return { y, rot: 0.6, color: demolish ? PALETTE.demolish : PALETTE.designate };
    });

    const tall: number[] = [];
    const flat: number[] = [];
    const floors: number[] = [];
    const ready = new Set<number>();
    for (const bp of s.blueprints) {
      (bp.floor ? floors : TALL_BLUEPRINTS.has(bp.kind) ? tall : flat).push(bp.tile);
      if (bp.delivered >= blueprintSpec(bp.kind).cost) ready.add(bp.tile * 2 + (bp.floor ? 1 : 0));
    }
    const bpStyle = (floor: boolean) => (t: number): Placed => ({ color: ready.has(t * 2 + (floor ? 1 : 0)) ? 0xbfe6ff : PALETTE.blueprint });
    this.fill(this.bpTall, tall, bpStyle(false));
    this.fill(this.bpFlat, flat, bpStyle(false));
    this.fill(this.bpFloor, floors, bpStyle(true));

    this.syncFurniture(s);
    this.syncGroundwork(s);
    this.flag.visible = s.rally >= 0;
    if (s.rally >= 0) this.flag.position.set(worldX(tileX(s.rally)), 0, worldZ(tileY(s.rally)));
  }

  /** Posts on every wall tile, arms toward each neighbouring wall or door. */
  private fillWalls(s: SimState, tiles: readonly number[], posts: THREE.InstancedMesh, arms: THREE.InstancedMesh): void {
    this.fill(posts, tiles, () => ({}));
    const joins = new Set([STRUCT_CODE.wall, STRUCT_CODE.stoneWall, STRUCT_CODE.door]);
    let n = 0;
    for (const t of tiles) {
      const x = tileX(t);
      const y = tileY(t);
      for (const [dx, dy, rot] of WALL_ARMS) {
        if (!inBounds(x + dx, y + dy) || !joins.has(s.structKind[tileIndex(x + dx, y + dy)])) continue;
        this.dummy.position.set(worldX(x), 0, worldZ(y));
        this.dummy.rotation.set(0, rot, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        arms.setMatrixAt(n, this.dummy.matrix);
        n++;
      }
    }
    this.commit(arms, n);
  }

  private syncGroundwork(s: SimState): void {
    for (const key of ['groundworkMesh', 'stockpileMesh'] as const) {
      const old = this[key];
      if (!old) continue;
      this.board.remove(old);
      old.geometry.dispose();
      this[key] = null;
    }
    const work = groundworkGeometry(s);
    if (work) {
      this.groundworkMesh = new THREE.Mesh(work, this.solid);
      this.groundworkMesh.receiveShadow = true;
      this.board.add(this.groundworkMesh);
    }
    const pile = stockpileGeometry(s);
    if (pile) {
      this.stockpileMesh = new THREE.Mesh(pile, this.mat.zone);
      this.board.add(this.stockpileMesh);
    }
  }

  private syncFurniture(s: SimState): void {
    const byKind = new Map<Furniture, Structure[]>();
    for (const st of s.structures) {
      if (st.kind === 'wall' || st.kind === 'stoneWall') continue;
      let list = byKind.get(st.kind);
      if (!list) byKind.set(st.kind, (list = []));
      list.push(st);
    }
    for (const kind of FURNITURE) {
      const mesh = this.furniture.get(kind)!;
      const list = byKind.get(kind) ?? [];
      this.fill(mesh, list.map((st) => st.tile), (t) => ({ rot: furnitureRotation(s, kind, t) }));
    }
    const beds = byKind.get('bed') ?? [];
    let n = 0;
    for (const bed of beds) {
      if (n >= this.blankets.instanceMatrix.count) break;
      const owner = bed.ownerId ? s.pawns.find((p) => p.id === bed.ownerId) : undefined;
      this.dummy.position.set(worldX(tileX(bed.tile)), 0, worldZ(tileY(bed.tile)));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.blankets.setMatrixAt(n, this.dummy.matrix);
      this.blankets.setColorAt(n, this.tmpColor.setHex(owner ? PALETTE.shirt[owner.look.shirt] : 0x8c97a6));
      n++;
    }
    this.commit(this.blankets, n);

    this.campfires = (byKind.get('campfire') ?? []).map((st) => st.tile);
    this.torches = (byKind.get('torch') ?? []).map((st) => st.tile);
    this.fill(this.stoveFires, (byKind.get('stove') ?? []).map((st) => st.tile), () => ({}));
    this.lightSources = [
      ...this.campfires.map((tile) => ({ tile, kind: 'campfire' as const })),
      ...(byKind.get('stove') ?? []).map((st) => ({ tile: st.tile, kind: 'stove' as const })),
      ...this.torches.map((tile) => ({ tile, kind: 'torch' as const })),
    ];
  }

  private animateFires(s: SimState, time: number): void {
    const flicker = (i: number): number => 1 + Math.sin(time * 0.013 + i * 1.7) * 0.12 + Math.sin(time * 0.031 + i) * 0.06;
    let n = 0;
    for (const t of this.campfires) {
      if (n >= 256) break;
      const f = flicker(n);
      this.dummy.position.set(worldX(tileX(t)), 0, worldZ(tileY(t)));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, f, 1);
      this.dummy.updateMatrix();
      this.flamesOuter.setMatrixAt(n, this.dummy.matrix);
      this.dummy.scale.set(1, 2 - f, 1);
      this.dummy.updateMatrix();
      this.flamesInner.setMatrixAt(n, this.dummy.matrix);
      n++;
    }
    this.commit(this.flamesOuter, n);
    this.commit(this.flamesInner, n);
    let k = 0;
    for (const t of this.torches) {
      if (k >= 1024) break;
      const f = flicker(k + 3);
      this.dummy.position.set(worldX(tileX(t)), 0.88 * (1 - f), worldZ(tileY(t)));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, f, 1);
      this.dummy.updateMatrix();
      this.torchFlames.setMatrixAt(k, this.dummy.matrix);
      k++;
    }
    this.commit(this.torchFlames, k);

    // Light the fires nearest the middle of the screen.
    const night = 1 - daylight(hourOf(s.tick));
    const tx = this.target.x;
    const tz = this.target.z;
    const near = this.lightSources
      .map((l) => ({ l, d: Math.hypot(worldX(tileX(l.tile)) - tx, worldZ(tileY(l.tile)) - tz) }))
      .sort((a, b) => a.d - b.d || a.l.tile - b.l.tile)
      .slice(0, LIGHT_POOL);
    this.lights.forEach((light, i) => {
      const src = near[i]?.l;
      if (!src) {
        light.intensity = 0;
        return;
      }
      const wobble = 1 + Math.sin(time * 0.02 + i * 2) * 0.12;
      light.position.set(worldX(tileX(src.tile)), src.kind === 'torch' ? 1.0 : 0.7, worldZ(tileY(src.tile)));
      if (src.kind === 'campfire') {
        light.intensity = (0.6 + night * 5) * wobble;
        light.distance = 7;
      } else if (src.kind === 'stove') {
        light.intensity = (0.3 + night * 2.5) * wobble;
        light.distance = 5;
      } else {
        light.intensity = (0.2 + night * 3) * wobble;
        light.distance = 6;
      }
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
      const spec = ITEMS[it.type];
      const gear = spec.group === 'weapon' || spec.group === 'armor';
      mesh.scale.setScalar(gear ? 1 : 0.75 + 0.55 * Math.min(1, it.count / (spec.stack * 0.6)));
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

  private bodyKey(p: Pawn): string {
    if (p.kind === 'animal') return `a:${p.species}`;
    if (p.kind === 'goblin') return `g:${p.unit}:${p.look.shirt}`;
    return `c:${p.look.skin}:${p.look.shirt}:${p.look.hair}`;
  }

  private bodyGeometry(p: Pawn): THREE.BufferGeometry {
    const key = this.bodyKey(p);
    let geo = this.pawnGeos.get(key);
    if (!geo) {
      if (p.kind === 'animal') geo = M.animal(p.species as M.AnimalKind);
      else if (p.kind === 'goblin') {
        const unit = (p.unit || 'fighter') as M.GoblinBody;
        geo = M.goblin(unit, {
          skin: unit === 'brute' ? PALETTE.goblinSkinDark : PALETTE.goblinSkin,
          cloth: PALETTE.goblinCloth[p.look.shirt % PALETTE.goblinCloth.length],
          hair: 0,
        });
      } else geo = M.colonist({ skin: PALETTE.skin[p.look.skin], cloth: PALETTE.shirt[p.look.shirt], hair: PALETTE.hair[p.look.hair] });
      this.pawnGeos.set(key, geo);
    }
    return geo;
  }

  private weaponGeometry(kind: M.HeldWeapon): THREE.BufferGeometry {
    let geo = this.weaponGeos.get(kind);
    if (!geo) this.weaponGeos.set(kind, (geo = M.weapon(kind)));
    return geo;
  }

  private armorGeometry(kind: 'leatherArmor' | 'ironArmor'): THREE.BufferGeometry {
    let geo = this.armorGeos.get(kind);
    if (!geo) this.armorGeos.set(kind, (geo = M.armorShell(kind)));
    return geo;
  }

  private makePawn(p: Pawn): PawnView {
    const root = new THREE.Group();
    const pose = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const body = new THREE.Mesh(this.bodyGeometry(p), material);
    body.castShadow = true;
    const weapon = new THREE.Mesh(this.geo.carried, this.solid);
    weapon.visible = false;
    weapon.castShadow = true;
    weapon.position.set(0.17, 0.1, 0.05);
    weapon.rotation.x = 0.25;
    const armor = new THREE.Mesh(this.geo.carried, this.solid);
    armor.visible = false;
    armor.castShadow = true;
    const carryMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const carry = new THREE.Mesh(this.geo.carried, carryMaterial);
    carry.visible = false;
    pose.add(body, weapon, armor, carry);
    const blob = new THREE.Mesh(this.geo.blob, this.mat.blob);
    blob.position.y = 0.02;
    root.add(pose, blob);
    const kind = p.kind === 'animal' ? p.species : p.kind === 'goblin' ? p.unit || 'fighter' : 'colonist';
    root.scale.setScalar(PAWN_SCALE[kind] ?? 1.3);
    this.pawnGroup.add(root);
    let label: HTMLDivElement | null = null;
    if (p.kind === 'colonist' || p.chiefId || p.kind === 'animal') {
      label = document.createElement('div');
      label.className = p.kind === 'colonist' ? 'pawn-label' : p.chiefId ? 'pawn-label chief' : 'pawn-label hunt';
      this.labels.appendChild(label);
    }
    return {
      root,
      pose,
      material,
      weapon,
      weaponKind: '',
      armor,
      armorKind: '',
      carry,
      carryMaterial,
      label,
      labelKey: '',
      x: 0,
      y: 0,
      z: 0,
      heading: Math.atan2(p.faceX, p.faceY),
    };
  }

  private removePawn(v: PawnView): void {
    this.pawnGroup.remove(v.root);
    v.material.dispose();
    v.carryMaterial.dispose();
    v.label?.remove();
  }

  private towerAt(s: SimState, x: number, y: number): number {
    return s.structKind[tileIndex(x, y)] === STRUCT_CODE.tower ? M.TOWER_HEIGHT : 0;
  }

  private syncPawns(s: SimState, alpha: number, time: number, selected: ReadonlySet<number>): void {
    const seen = new Set<number>();
    const perTile = new Map<number, number>();
    const project = new THREE.Vector3();
    let rings = 0;
    let marks = 0;
    let arrows = 0;
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
      const yFrom = this.towerAt(s, p.fromX, p.fromY);
      const yTo = this.towerAt(s, p.x, p.y);
      const lift = moving ? yFrom + (yTo - yFrom) * t : yTo;
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
      v.y = lift;
      v.z = z;

      const want = Math.atan2(p.faceX, p.faceY);
      let diff = want - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.heading += diff * 0.25;

      const job = p.job;
      const asleep = job?.kind === 'sleep' && job.asleep;
      const lying = p.life === 'downed' || asleep;
      const working =
        !moving && !!job && ['harvest', 'build', 'cook', 'craft', 'research', 'decon', 'tend', 'bash', 'eat', 'sow', 'reap'].includes(job.kind);
      let bob = 0;
      if (moving) bob = Math.abs(Math.sin(time * 0.017 + p.id)) * 0.06;
      else if (working) bob = Math.abs(Math.sin(time * 0.011 + p.id)) * 0.035;
      const sinceAttack = s.tick - p.lastAttackTick + alpha;
      const lunge = sinceAttack < 4 ? (1 - sinceAttack / 4) * 0.16 : 0;

      v.root.position.set(x + Math.sin(v.heading) * lunge, lift, z + Math.cos(v.heading) * lunge);
      v.root.rotation.y = v.heading;
      const onBed = asleep && s.structKind[tileIndex(p.x, p.y)] === STRUCT_CODE.bed;
      v.pose.position.y = lying ? (onBed ? 0.26 : 0.1) : bob;
      v.pose.rotation.x = lying ? -Math.PI / 2 : 0;
      v.pose.rotation.z = p.mental?.kind === 'daze' && !lying ? Math.sin(time * 0.004 + p.id) * 0.15 : 0;
      v.material.emissive.setHex(s.tick - p.hitTick < 3 ? 0x992211 : 0x000000);

      // Gear
      const held = p.kind === 'animal' || p.mental?.kind === 'brawl' ? undefined : HELD[p.weapon];
      if ((held ?? '') !== v.weaponKind) {
        v.weaponKind = held ?? '';
        v.weapon.visible = !!held;
        if (held) v.weapon.geometry = this.weaponGeometry(held);
      }
      const armor = p.kind === 'colonist' && p.armor !== 'none' ? p.armor : '';
      if (armor !== v.armorKind) {
        v.armorKind = armor;
        v.armor.visible = !!armor;
        if (armor) v.armor.geometry = this.armorGeometry(armor);
      }
      v.carry.visible = !!p.carry && !lying && p.kind === 'colonist';
      if (p.carry) v.carryMaterial.color.setHex(CARRY_COLOR[p.carry.type]);

      if (selected.has(p.id) && rings < RING_POOL) {
        const ring = this.rings[rings++];
        ring.visible = true;
        ring.position.set(x, lift + 0.03, z);
      }
      if (p.drafted && job?.kind === 'goto' && marks < RING_POOL) {
        const mark = this.moveMarkers[marks++];
        mark.visible = true;
        mark.position.set(worldX(tileX(job.tile)), 0.02 + Math.abs(Math.sin(time * 0.006)) * 0.05, worldZ(tileY(job.tile)));
      }
      const flight = s.tick - p.shotTick + alpha;
      if (p.shotTo >= 0 && flight >= 0 && flight < ARROW_TICKS && arrows < ARROW_POOL) {
        this.placeArrow(this.arrows[arrows++], x, lift + 0.45 * (PAWN_SCALE[p.kind === 'goblin' ? 'fighter' : 'colonist'] ?? 1.3), z, p.shotTo, flight / ARROW_TICKS);
      }

      if (v.label) this.updateLabel(p, v, project, lying, selected.has(p.id));
    }
    for (let i = rings; i < RING_POOL; i++) this.rings[i].visible = false;
    for (let i = marks; i < RING_POOL; i++) this.moveMarkers[i].visible = false;
    for (let i = arrows; i < ARROW_POOL; i++) this.arrows[i].visible = false;
    for (const [id, v] of this.pawnViews) {
      if (seen.has(id)) continue;
      this.removePawn(v);
      this.pawnViews.delete(id);
    }
  }

  /** An arrow on its arc from the archer to the target tile. */
  private placeArrow(arrow: THREE.Mesh, x0: number, y0: number, z0: number, to: number, t: number): void {
    const x1 = worldX(tileX(to));
    const z1 = worldZ(tileY(to));
    const y1 = 0.45;
    const at = (k: number): THREE.Vector3 =>
      new THREE.Vector3(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * 0.5, z0 + (z1 - z0) * k);
    arrow.visible = true;
    arrow.position.copy(at(t));
    arrow.lookAt(at(Math.min(1, t + 0.05)));
  }

  private updateLabel(p: Pawn, v: PawnView, project: THREE.Vector3, lying: boolean, selected: boolean): void {
    const label = v.label!;
    let key: string;
    let html: string;
    if (p.kind === 'colonist') {
      const badge = pawnBadge(p);
      key = `${firstName(p)}|${badge ?? ''}`;
      html = `${badge ? `<span class="badge badge-${badge}">${BADGE_ICON[badge]}</span>` : ''}<span>${firstName(p)}</span>`;
    } else if (p.chiefId) {
      key = p.name;
      html = `<span>${p.name}</span>`;
    } else {
      key = p.marked ? 'hunt' : '';
      html = p.marked ? `<span class="badge badge-hunt">${ICONS.target}</span>` : '';
    }
    if (key !== v.labelKey) {
      v.labelKey = key;
      label.innerHTML = html;
      label.style.display = html ? '' : 'none';
    }
    if (!html) return;
    const scale = v.root.scale.x;
    project.set(v.x, v.y + (lying ? 0.4 : 0.72) * scale, v.z).project(this.camera);
    const sx = (project.x * 0.5 + 0.5) * this.width;
    const sy = (-project.y * 0.5 + 0.5) * this.height;
    label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    label.classList.toggle('selected', selected);
  }

  // Light

  private light(s: SimState, alpha: number, season: Season): void {
    const d = daylight(hourOf(s.tick + alpha));
    const dusk = 1 - Math.abs(d - 0.5) * 2;
    const c = LIGHT_COLORS;
    const day = season === 'winter' ? c.skyWinter : c.skyDay;
    this.sky.copy(c.skyNight).lerp(day, d).lerp(c.skyDusk, dusk * 0.55);
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

/** How each piece of furniture turns to sit naturally on its tile. */
function furnitureRotation(s: SimState, kind: Furniture, t: number): number {
  const x = tileX(t);
  const y = tileY(t);
  const is = (xx: number, yy: number, codes: readonly number[]): boolean => inBounds(xx, yy) && codes.includes(s.structKind[tileIndex(xx, yy)]);
  if (kind === 'door') {
    const walls = [STRUCT_CODE.wall, STRUCT_CODE.stoneWall];
    const alongZ = (is(x, y - 1, walls) || is(x, y + 1, walls)) && !(is(x - 1, y, walls) || is(x + 1, y, walls));
    return alongZ ? Math.PI / 2 : 0;
  }
  if (kind === 'barricade') {
    const b = [STRUCT_CODE.barricade];
    const alongZ = (is(x, y - 1, b) || is(x, y + 1, b)) && !(is(x - 1, y, b) || is(x + 1, y, b));
    return alongZ ? Math.PI / 2 : 0;
  }
  if (kind === 'stool' || kind === 'plantPot' || kind === 'grave' || kind === 'horseshoes') {
    return kind === 'grave' ? 0 : hash01(s.seed + 31, x, y) * 6.28;
  }
  return 0;
}
