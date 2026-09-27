/**
 * Low-poly models built from primitives. Every part is flat-shaded (non-indexed geometry with
 * per-face normals) and coloured per vertex, so a whole model is a single draw call.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';

type Part = THREE.BufferGeometry;

/** Flat-shades a primitive and paints it one colour. */
export function paint(geo: Part, color: number): Part {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function merge(parts: Part[]): Part {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('Could not merge model parts');
  return g;
}

const cyl = (rt: number, rb: number, h: number, seg: number): Part => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg: number): Part => new THREE.ConeGeometry(r, h, seg);
const box = (w: number, h: number, d: number): Part => new THREE.BoxGeometry(w, h, d);
const ico = (r: number, detail = 0): Part => new THREE.IcosahedronGeometry(r, detail);
const dodeca = (r: number): Part => new THREE.DodecahedronGeometry(r, 0);

// Nature

export function pineTree(): Part {
  return merge([
    paint(cyl(0.06, 0.08, 0.24, 5).translate(0, 0.12, 0), PALETTE.trunk),
    paint(cone(0.34, 0.5, 6).translate(0, 0.45, 0), PALETTE.pineDark),
    paint(cone(0.25, 0.4, 6).translate(0, 0.72, 0), PALETTE.pine),
  ]);
}

export function roundTree(): Part {
  return merge([
    paint(cyl(0.06, 0.08, 0.3, 5).translate(0, 0.15, 0), PALETTE.trunk),
    paint(ico(0.3).scale(1, 0.95, 1).translate(0, 0.52, 0), PALETTE.leaf),
  ]);
}

export function bush(): Part {
  return merge([paint(ico(0.22).scale(1, 0.78, 1).translate(0, 0.16, 0), PALETTE.bush)]);
}

export function berries(): Part {
  const spots: Array<[number, number, number]> = [
    [0.12, 0.24, 0.1], [-0.1, 0.27, 0.08], [0.02, 0.3, -0.12], [0.16, 0.18, -0.06], [-0.15, 0.17, -0.08],
  ];
  return merge(spots.map(([x, y, z]) => paint(ico(0.045).translate(x, y, z), PALETTE.berry)));
}

export function boulder(): Part {
  return merge([
    paint(dodeca(0.27).scale(1, 0.72, 0.92).translate(0, 0.15, 0), PALETTE.rock),
    paint(dodeca(0.14).scale(1, 0.8, 1).translate(0.22, 0.08, 0.16), PALETTE.rockDark),
  ]);
}

export function mountain(): Part {
  return merge([
    paint(cone(0.56, 1.25, 5).translate(0, 0.62, 0), PALETTE.rock),
    paint(cone(0.2, 0.34, 5).translate(0, 1.12, 0), PALETTE.snow),
    paint(cone(0.36, 0.72, 5).translate(0.28, 0.36, 0.22), PALETTE.rockDark),
  ]);
}

// Buildings

/**
 * Walls are drawn as a post on every wall tile plus an arm reaching toward each walled
 * neighbour, so they read as thin palisades and rooms stay visible from the tilted camera.
 */
export interface WallStyle {
  width: number;
  height: number;
  body: number;
  top: number;
}

export const WOOD_WALL: WallStyle = { width: 0.3, height: 0.5, body: PALETTE.wood, top: PALETTE.woodTop };
export const STONE_WALL: WallStyle = { width: 0.4, height: 0.58, body: PALETTE.stone, top: PALETTE.stoneTop };

export function wallPost(w: WallStyle): Part {
  const post = w.width + 0.08;
  return merge([
    paint(box(post, w.height + 0.04, post).translate(0, (w.height + 0.04) / 2, 0), w.body),
    paint(box(post + 0.02, 0.05, post + 0.02).translate(0, w.height + 0.06, 0), w.top),
  ]);
}

/** An arm from the tile centre to its +X edge. */
export function wallArm(w: WallStyle): Part {
  return merge([
    paint(box(0.5, w.height, w.width).translate(0.25, w.height / 2, 0), w.body),
    paint(box(0.5, 0.04, w.width + 0.02).translate(0.25, w.height + 0.02, 0), w.top),
  ]);
}

/** A door along the X axis; rotate it for walls that run along Z. */
export function door(): Part {
  return merge([
    paint(box(0.12, 0.5, 0.3).translate(-0.44, 0.25, 0), PALETTE.wood),
    paint(box(0.12, 0.5, 0.3).translate(0.44, 0.25, 0), PALETTE.wood),
    paint(box(1, 0.07, 0.3).translate(0, 0.5, 0), PALETTE.woodTop),
    paint(box(0.76, 0.44, 0.1).translate(0, 0.23, 0), PALETTE.woodDark),
  ]);
}

export function bedFrame(): Part {
  return merge([
    paint(box(0.62, 0.14, 0.9).translate(0, 0.07, 0), PALETTE.wood),
    paint(box(0.56, 0.07, 0.84).translate(0, 0.17, 0), PALETTE.linen),
    paint(box(0.4, 0.07, 0.18).translate(0, 0.23, -0.29), PALETTE.linen),
  ]);
}

export const blanket = (): Part => box(0.6, 0.08, 0.56).translate(0, 0.21, 0.13);

export function campfireBase(): Part {
  const parts: Part[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(paint(dodeca(0.075).translate(Math.cos(a) * 0.27, 0.05, Math.sin(a) * 0.27), i % 2 ? PALETTE.rock : PALETTE.rockDark));
  }
  parts.push(paint(cyl(0.045, 0.045, 0.46, 5).rotateZ(Math.PI / 2).rotateY(0.6).translate(0, 0.07, 0), PALETTE.trunk));
  parts.push(paint(cyl(0.045, 0.045, 0.46, 5).rotateZ(Math.PI / 2).rotateY(-0.9).translate(0, 0.1, 0), PALETTE.woodDark));
  return merge(parts);
}

export const flameOuter = (): Part => cone(0.16, 0.42, 6).translate(0, 0.3, 0);
export const flameInner = (): Part => cone(0.09, 0.26, 6).translate(0, 0.24, 0);

export function trap(): Part {
  const parts: Part[] = [paint(box(0.78, 0.04, 0.78).translate(0, 0.02, 0), PALETTE.woodDark)];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      parts.push(paint(cone(0.05, 0.22, 4).translate(i * 0.24, 0.13, j * 0.24), PALETTE.metal));
    }
  }
  return merge(parts);
}

export function grave(): Part {
  return merge([
    paint(box(0.44, 0.12, 0.7).translate(0, 0.06, 0.08), PALETTE.soil),
    paint(box(0.34, 0.4, 0.09).translate(0, 0.2, -0.3), PALETTE.stone),
  ]);
}

export function rallyFlag(): Part {
  return merge([
    paint(cyl(0.025, 0.03, 1.1, 5).translate(0, 0.55, 0), PALETTE.woodDark),
    paint(box(0.38, 0.24, 0.03).translate(0.2, 0.94, 0), PALETTE.flag),
    paint(cyl(0.16, 0.2, 0.06, 7).translate(0, 0.03, 0), PALETTE.rockDark),
  ]);
}

// Items

export function woodPile(): Part {
  return merge([
    paint(cyl(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.07, -0.08), PALETTE.trunk),
    paint(cyl(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.07, 0.08), PALETTE.woodDark),
    paint(cyl(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.19, 0), PALETTE.wood),
  ]);
}

export function stonePile(): Part {
  return merge([
    paint(dodeca(0.11).translate(-0.1, 0.08, 0.04), PALETTE.rock),
    paint(dodeca(0.1).translate(0.11, 0.07, -0.05), PALETTE.rockDark),
    paint(dodeca(0.09).translate(0.01, 0.18, 0), PALETTE.stoneTop),
  ]);
}

export function berryBasket(): Part {
  return merge([
    paint(cyl(0.17, 0.13, 0.14, 8).translate(0, 0.07, 0), PALETTE.woodTop),
    paint(ico(0.05).translate(0.05, 0.16, 0.03), PALETTE.berry),
    paint(ico(0.05).translate(-0.06, 0.16, -0.02), PALETTE.berry),
    paint(ico(0.05).translate(0.01, 0.18, -0.07), PALETTE.berry),
    paint(ico(0.05).translate(-0.02, 0.17, 0.07), PALETTE.berry),
  ]);
}

export function mealBowl(): Part {
  return merge([
    paint(new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, 0.14, 0), PALETTE.linen),
    paint(cyl(0.13, 0.13, 0.02, 8).translate(0, 0.12, 0), PALETTE.stew),
  ]);
}

// People

export interface PawnColors {
  skin: number;
  cloth: number;
  hair: number;
}

export function colonist(c: PawnColors): Part {
  return merge([
    paint(cyl(0.12, 0.17, 0.32, 7).translate(0, 0.16, 0), c.cloth),
    paint(box(0.2, 0.05, 0.2).translate(0, 0.33, 0), c.cloth),
    paint(ico(0.12, 1).translate(0, 0.45, 0), c.skin),
    paint(new THREE.SphereGeometry(0.128, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.47, -0.012), c.hair),
    paint(box(0.05, 0.035, 0.02).translate(0, 0.45, 0.115), PALETTE.soilDark),
  ]);
}

export type GoblinBody = 'fighter' | 'archer' | 'brute' | 'chief';

export function goblin(kind: GoblinBody, c: PawnColors): Part {
  const brute = kind === 'brute';
  const parts: Part[] = [
    paint(cyl(brute ? 0.14 : 0.1, brute ? 0.19 : 0.15, brute ? 0.3 : 0.26, 6).translate(0, brute ? 0.15 : 0.13, 0), c.cloth),
    paint(ico(brute ? 0.13 : 0.12).translate(0, brute ? 0.41 : 0.37, 0), c.skin),
    paint(cone(0.035, 0.16, 4).rotateZ(Math.PI / 2).translate(-0.16, brute ? 0.44 : 0.4, 0), c.skin),
    paint(cone(0.035, 0.16, 4).rotateZ(-Math.PI / 2).translate(0.16, brute ? 0.44 : 0.4, 0), c.skin),
    paint(box(0.12, 0.03, 0.02).translate(0, brute ? 0.42 : 0.39, 0.11), 0xd23a2a),
  ];
  if (brute) {
    parts.push(paint(cone(0.02, 0.07, 4).translate(-0.05, 0.43, 0.11), PALETTE.tusk));
    parts.push(paint(cone(0.02, 0.07, 4).translate(0.05, 0.43, 0.11), PALETTE.tusk));
    parts.push(paint(box(0.34, 0.06, 0.16).translate(0, 0.3, 0), c.cloth));
  }
  if (kind === 'archer') {
    parts.push(paint(cone(0.15, 0.22, 6).translate(0, 0.49, -0.02), c.cloth));
    parts.push(paint(box(0.08, 0.26, 0.08).rotateX(0.3).translate(-0.06, 0.26, -0.13), PALETTE.leatherDark));
  }
  if (kind === 'chief') {
    parts.push(paint(new THREE.SphereGeometry(0.13, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.39, 0), PALETTE.iron));
    parts.push(paint(cone(0.035, 0.18, 4).rotateZ(0.9).translate(-0.15, 0.53, 0), PALETTE.antler));
    parts.push(paint(cone(0.035, 0.18, 4).rotateZ(-0.9).translate(0.15, 0.53, 0), PALETTE.antler));
    parts.push(paint(box(0.3, 0.34, 0.03).rotateX(-0.15).translate(0, 0.19, -0.14), PALETTE.chiefCape));
  }
  return merge(parts);
}

/** What a colonist is carrying, held in front of them. */
export const carried = (): Part => box(0.16, 0.12, 0.12).translate(0, 0.25, 0.17);

// Seasonal nature

export function snowPine(): Part {
  return merge([
    paint(cyl(0.06, 0.08, 0.24, 5).translate(0, 0.12, 0), PALETTE.trunk),
    paint(cone(0.34, 0.5, 6).translate(0, 0.45, 0), PALETTE.pineDark),
    paint(cone(0.25, 0.4, 6).translate(0, 0.72, 0), PALETTE.snow),
    paint(cone(0.2, 0.08, 6).translate(0, 0.66, 0), PALETTE.snow),
  ]);
}

export function autumnTree(): Part {
  return merge([
    paint(cyl(0.06, 0.08, 0.3, 5).translate(0, 0.15, 0), PALETTE.trunk),
    paint(ico(0.3).scale(1, 0.95, 1).translate(0, 0.52, 0), PALETTE.leafAutumn),
    paint(ico(0.14).translate(0.16, 0.42, 0.1), PALETTE.leafAutumnDark),
  ]);
}

export function bareTree(): Part {
  return merge([
    paint(cyl(0.05, 0.08, 0.5, 5).translate(0, 0.25, 0), PALETTE.trunk),
    paint(cyl(0.02, 0.03, 0.3, 4).rotateZ(0.7).translate(-0.1, 0.52, 0), PALETTE.bare),
    paint(cyl(0.02, 0.03, 0.28, 4).rotateZ(-0.6).translate(0.1, 0.56, 0.02), PALETTE.bare),
    paint(cyl(0.015, 0.02, 0.22, 4).rotateX(0.6).translate(0, 0.6, 0.08), PALETTE.bare),
    paint(ico(0.08).scale(1.4, 0.4, 1.4).translate(0, 0.72, 0), PALETTE.snow),
  ]);
}

export function bareBush(): Part {
  return merge([
    paint(ico(0.2).scale(1, 0.6, 1).translate(0, 0.12, 0), PALETTE.bare),
    paint(ico(0.14).scale(1.2, 0.35, 1.2).translate(0, 0.21, 0), PALETTE.snow),
  ]);
}

export function oreRock(): Part {
  return merge([
    paint(dodeca(0.27).scale(1, 0.72, 0.92).translate(0, 0.15, 0), PALETTE.rockDark),
    paint(dodeca(0.07).translate(0.12, 0.24, 0.1), PALETTE.ironOre),
    paint(dodeca(0.06).translate(-0.14, 0.18, 0.08), PALETTE.ironOre),
    paint(dodeca(0.05).translate(0.02, 0.28, -0.12), PALETTE.ironOre),
  ]);
}

// Crops

export function potatoPlant(): Part {
  return merge([
    paint(ico(0.1).scale(1.2, 0.6, 1).translate(-0.08, 0.08, 0.02), PALETTE.potatoLeaf),
    paint(ico(0.09).scale(1, 0.7, 1.2).translate(0.08, 0.09, -0.04), PALETTE.leaf),
    paint(ico(0.08).scale(1, 0.8, 1).translate(0, 0.13, 0.08), PALETTE.potatoLeaf),
  ]);
}

export function healrootPlant(): Part {
  return merge([
    paint(cyl(0.012, 0.015, 0.3, 4).translate(-0.06, 0.15, 0), PALETTE.herb),
    paint(cyl(0.012, 0.015, 0.26, 4).translate(0.06, 0.13, 0.04), PALETTE.herb),
    paint(ico(0.06).scale(1.4, 0.5, 1.4).translate(-0.06, 0.3, 0), PALETTE.healroot),
    paint(ico(0.055).scale(1.4, 0.5, 1.4).translate(0.06, 0.26, 0.04), PALETTE.healroot),
    paint(ico(0.035).translate(0, 0.34, -0.03), PALETTE.healrootFlower),
  ]);
}

// Furniture, workshops and defences

export function table(): Part {
  const parts: Part[] = [paint(box(0.82, 0.07, 0.82).translate(0, 0.34, 0), PALETTE.woodTop)];
  for (const [x, z] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) {
    parts.push(paint(box(0.07, 0.31, 0.07).translate(x, 0.155, z), PALETTE.wood));
  }
  return merge(parts);
}

export function stool(): Part {
  const parts: Part[] = [paint(cyl(0.16, 0.16, 0.05, 8).translate(0, 0.22, 0), PALETTE.woodTop)];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(paint(cyl(0.022, 0.022, 0.2, 4).translate(Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1), PALETTE.wood));
  }
  return merge(parts);
}

export function torch(): Part {
  return merge([
    paint(cyl(0.12, 0.15, 0.06, 6).translate(0, 0.03, 0), PALETTE.rockDark),
    paint(cyl(0.03, 0.035, 0.72, 5).translate(0, 0.38, 0), PALETTE.woodDark),
    paint(cyl(0.06, 0.04, 0.08, 6).translate(0, 0.76, 0), PALETTE.iron),
  ]);
}

export const torchFlame = (): Part => cone(0.06, 0.18, 5).translate(0, 0.88, 0);

export function stove(): Part {
  return merge([
    paint(box(0.84, 0.46, 0.66).translate(0, 0.23, 0), PALETTE.stone),
    paint(box(0.88, 0.05, 0.7).translate(0, 0.48, 0), PALETTE.stoneTop),
    paint(box(0.36, 0.2, 0.04).translate(0, 0.18, 0.33), PALETTE.soilDark),
    paint(box(0.16, 0.42, 0.16).translate(0.26, 0.71, -0.18), PALETTE.rockDark),
    paint(cyl(0.12, 0.1, 0.06, 7).translate(-0.18, 0.54, 0.02), PALETTE.iron),
  ]);
}

export const stoveFire = (): Part => box(0.3, 0.12, 0.02).translate(0, 0.16, 0.345);

export function craftBench(): Part {
  const parts: Part[] = [paint(box(0.92, 0.08, 0.6).translate(0, 0.36, 0), PALETTE.woodTop)];
  for (const [x, z] of [[-0.38, -0.24], [0.38, -0.24], [-0.38, 0.24], [0.38, 0.24]]) {
    parts.push(paint(box(0.08, 0.34, 0.08).translate(x, 0.17, z), PALETTE.wood));
  }
  parts.push(paint(box(0.2, 0.14, 0.14).translate(-0.22, 0.47, -0.05), PALETTE.iron));
  parts.push(paint(box(0.3, 0.03, 0.05).rotateY(0.4).translate(0.18, 0.415, 0.1), PALETTE.woodDark));
  parts.push(paint(box(0.08, 0.06, 0.1).translate(0.3, 0.44, 0.05), PALETTE.metal));
  parts.push(paint(box(0.7, 0.04, 0.5).translate(0, 0.08, 0), PALETTE.woodDark));
  return merge(parts);
}

export function researchDesk(): Part {
  const parts: Part[] = [paint(box(0.86, 0.07, 0.56).translate(0, 0.36, 0), PALETTE.woodDark)];
  for (const [x, z] of [[-0.36, -0.22], [0.36, -0.22], [-0.36, 0.22], [0.36, 0.22]]) {
    parts.push(paint(box(0.07, 0.34, 0.07).translate(x, 0.17, z), PALETTE.wood));
  }
  parts.push(paint(box(0.3, 0.02, 0.22).rotateY(0.2).translate(-0.06, 0.405, 0.05), PALETTE.paper));
  parts.push(paint(box(0.02, 0.025, 0.2).rotateY(0.2).translate(-0.06, 0.41, 0.05), PALETTE.ink));
  parts.push(paint(box(0.12, 0.16, 0.2).translate(0.3, 0.47, -0.1), PALETTE.leather));
  parts.push(paint(box(0.12, 0.12, 0.18).translate(0.3, 0.61, -0.1), PALETTE.carpet));
  parts.push(paint(cyl(0.025, 0.025, 0.1, 5).translate(-0.32, 0.45, -0.16), PALETTE.candle));
  return merge(parts);
}

export function horseshoes(): Part {
  const shoe = (x: number, z: number, rot: number): Part =>
    paint(new THREE.TorusGeometry(0.07, 0.018, 4, 8, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(rot).translate(x, 0.02, z), PALETTE.iron);
  return merge([
    paint(cyl(0.3, 0.3, 0.02, 10).translate(0, 0.01, 0), PALETTE.sandSide),
    paint(cyl(0.02, 0.025, 0.26, 5).translate(0, 0.13, 0), PALETTE.iron),
    shoe(0.12, 0.08, 0.4),
    shoe(-0.1, -0.12, 2.2),
  ]);
}

export function chessTable(): Part {
  const parts: Part[] = [
    paint(box(0.6, 0.06, 0.6).translate(0, 0.33, 0), PALETTE.woodDark),
    paint(cyl(0.05, 0.08, 0.3, 6).translate(0, 0.15, 0), PALETTE.wood),
    paint(cyl(0.22, 0.24, 0.04, 8).translate(0, 0.02, 0), PALETTE.wood),
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      parts.push(paint(box(0.12, 0.012, 0.12).translate(-0.18 + i * 0.12, 0.366, -0.18 + j * 0.12), (i + j) % 2 ? PALETTE.chessDark : PALETTE.chessLight));
    }
  }
  parts.push(paint(cyl(0.02, 0.03, 0.08, 5).translate(-0.12, 0.41, -0.12), PALETTE.linen));
  parts.push(paint(cyl(0.02, 0.03, 0.08, 5).translate(0.12, 0.41, 0.06), PALETTE.ink));
  return merge(parts);
}

export function plantPot(): Part {
  return merge([
    paint(cyl(0.17, 0.12, 0.2, 7).translate(0, 0.1, 0), PALETTE.terracotta),
    paint(cyl(0.15, 0.15, 0.02, 7).translate(0, 0.19, 0), PALETTE.soilDark),
    paint(ico(0.12).scale(1, 1.2, 1).translate(0, 0.33, 0), PALETTE.leaf),
    paint(ico(0.07).translate(0.08, 0.4, 0.06), PALETTE.bush),
    paint(ico(0.04).translate(-0.04, 0.46, 0.05), PALETTE.flower),
    paint(ico(0.035).translate(0.05, 0.42, -0.08), PALETTE.berry),
  ]);
}

export function statue(): Part {
  return merge([
    paint(box(0.76, 0.2, 0.76).translate(0, 0.1, 0), PALETTE.marbleDark),
    paint(box(0.62, 0.1, 0.62).translate(0, 0.25, 0), PALETTE.marble),
    paint(cyl(0.13, 0.18, 0.5, 7).translate(0, 0.55, 0), PALETTE.marble),
    paint(ico(0.12, 1).translate(0, 0.9, 0), PALETTE.marble),
    paint(box(0.08, 0.32, 0.08).rotateZ(-0.9).translate(0.2, 0.86, 0), PALETTE.marble),
    paint(cone(0.06, 0.14, 5).translate(0.33, 1.05, 0), PALETTE.marbleDark),
  ]);
}

export function barricade(): Part {
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    parts.push(paint(cyl(0.07, 0.07, 0.9, 6).rotateZ(Math.PI / 2).translate(0, 0.07 + i * 0.12, (i - 1) * 0.02), i === 1 ? PALETTE.woodDark : PALETTE.trunk));
  }
  for (const x of [-0.34, 0, 0.34]) {
    parts.push(paint(cyl(0.02, 0.03, 0.46, 4).rotateX(0.6).translate(x, 0.24, 0.14), PALETTE.woodTop));
    parts.push(paint(cone(0.03, 0.08, 4).rotateX(0.6).translate(x, 0.44, 0.27), PALETTE.woodTop));
  }
  return merge(parts);
}

/** A platform this high lifts archers above the walls. */
export const TOWER_HEIGHT = 0.95;

export function tower(): Part {
  const h = TOWER_HEIGHT;
  const parts: Part[] = [];
  for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) {
    parts.push(paint(box(0.09, h + 0.4, 0.09).translate(x, (h + 0.4) / 2, z), PALETTE.wood));
  }
  parts.push(paint(box(0.9, 0.07, 0.9).translate(0, h, 0), PALETTE.woodTop));
  for (const [x, z, w, d] of [[0, -0.4, 0.86, 0.05], [0, 0.4, 0.86, 0.05], [-0.4, 0, 0.05, 0.86], [0.4, 0, 0.05, 0.86]]) {
    parts.push(paint(box(w, 0.16, d).translate(x, h + 0.14, z), PALETTE.wood));
  }
  parts.push(paint(box(0.7, 0.04, 0.7).rotateZ(0.02).translate(0, h * 0.45, 0), PALETTE.woodDark));
  for (let i = 0; i < 4; i++) parts.push(paint(box(0.26, 0.03, 0.03).translate(0, 0.18 + i * 0.22, 0.47), PALETTE.woodDark));
  parts.push(paint(cone(0.62, 0.3, 4).rotateY(Math.PI / 4).translate(0, h + 0.55, 0), PALETTE.woodDark));
  return merge(parts);
}

// Items

export function ironPile(): Part {
  return merge([
    paint(box(0.26, 0.08, 0.12).translate(0, 0.04, -0.07), PALETTE.iron),
    paint(box(0.26, 0.08, 0.12).translate(0, 0.04, 0.07), PALETTE.iron),
    paint(box(0.26, 0.08, 0.12).rotateY(Math.PI / 2).translate(0, 0.12, 0), PALETTE.metal),
  ]);
}

export function leatherPile(): Part {
  return merge([
    paint(box(0.34, 0.05, 0.26).translate(0, 0.025, 0), PALETTE.leather),
    paint(box(0.3, 0.05, 0.22).rotateY(0.3).translate(0.01, 0.075, 0), PALETTE.leatherDark),
    paint(box(0.26, 0.04, 0.2).rotateY(-0.2).translate(-0.01, 0.12, 0), PALETTE.leather),
  ]);
}

export function potatoSack(): Part {
  return merge([
    paint(ico(0.16).scale(1, 0.9, 1).translate(0, 0.14, 0), PALETTE.linen),
    paint(cone(0.08, 0.1, 6).translate(0, 0.3, 0), PALETTE.linen),
    paint(ico(0.05).translate(0.16, 0.05, 0.08), PALETTE.potato),
    paint(ico(0.045).translate(0.1, 0.04, 0.16), PALETTE.potato),
  ]);
}

export function meatCut(): Part {
  return merge([
    paint(box(0.3, 0.02, 0.3).translate(0, 0.01, 0), PALETTE.woodTop),
    paint(ico(0.1).scale(1.4, 0.6, 1).translate(-0.04, 0.07, 0), PALETTE.meat),
    paint(ico(0.08).scale(1.3, 0.6, 1).translate(0.07, 0.07, 0.06), PALETTE.meat),
    paint(cyl(0.015, 0.015, 0.14, 4).rotateZ(Math.PI / 2).translate(0.12, 0.08, -0.06), PALETTE.fat),
  ]);
}

export function herbBundle(): Part {
  return merge([
    paint(cyl(0.02, 0.06, 0.24, 5).rotateZ(1.3).translate(0, 0.05, 0), PALETTE.herb),
    paint(cyl(0.02, 0.05, 0.22, 5).rotateZ(1.3).rotateY(0.5).translate(0, 0.07, 0.03), PALETTE.healroot),
    paint(box(0.04, 0.05, 0.05).translate(-0.08, 0.05, 0), PALETTE.soil),
  ]);
}

export function fineMealPlate(): Part {
  return merge([
    paint(cyl(0.18, 0.15, 0.03, 9).translate(0, 0.02, 0), PALETTE.linen),
    paint(ico(0.07).scale(1.3, 0.6, 1).translate(-0.04, 0.06, 0), PALETTE.meat),
    paint(ico(0.04).translate(0.07, 0.06, 0.03), PALETTE.potato),
    paint(ico(0.035).translate(0.05, 0.06, -0.06), PALETTE.herb),
    paint(ico(0.03).translate(-0.08, 0.07, 0.07), PALETTE.berry),
  ]);
}

/** A weapon lying on the ground. */
export function weaponItem(kind: 'club' | 'spear' | 'sword' | 'bow'): Part {
  return merge([
    paint(box(0.44, 0.02, 0.2).translate(0, 0.01, 0), PALETTE.woodDark),
    weapon(kind).rotateX(Math.PI / 2).rotateY(Math.PI / 4).translate(-0.16, 0.05, 0.14),
  ]);
}

/** Armor on a little stand. */
export function armorItem(kind: 'leatherArmor' | 'ironArmor'): Part {
  const c = kind === 'ironArmor' ? PALETTE.iron : PALETTE.leather;
  return merge([
    paint(cyl(0.02, 0.02, 0.3, 4).translate(0, 0.15, 0), PALETTE.woodDark),
    paint(cyl(0.12, 0.15, 0.2, 7).translate(0, 0.22, 0), c),
    paint(box(0.32, 0.05, 0.12).translate(0, 0.32, 0), c),
    paint(cyl(0.12, 0.14, 0.03, 7).translate(0, 0.015, 0), PALETTE.woodDark),
  ]);
}

// Gear on pawns

export type HeldWeapon = 'club' | 'spear' | 'sword' | 'bow' | 'maul' | 'axe';

/** A weapon in the right hand, pointing up. */
export function weapon(kind: HeldWeapon): Part {
  switch (kind) {
    case 'club':
      return merge([
        paint(cyl(0.02, 0.015, 0.16, 5).translate(0, 0.08, 0), PALETTE.woodDark),
        paint(cyl(0.045, 0.028, 0.18, 6).translate(0, 0.25, 0), PALETTE.wood),
      ]);
    case 'spear':
      return merge([
        paint(cyl(0.013, 0.013, 0.72, 4).translate(0, 0.28, 0), PALETTE.woodDark),
        paint(cone(0.035, 0.11, 4).translate(0, 0.69, 0), PALETTE.metal),
      ]);
    case 'sword':
      return merge([
        paint(cyl(0.018, 0.018, 0.09, 5).translate(0, 0.045, 0), PALETTE.leatherDark),
        paint(box(0.13, 0.025, 0.03).translate(0, 0.1, 0), PALETTE.iron),
        paint(box(0.045, 0.34, 0.014).translate(0, 0.28, 0), PALETTE.metal),
        paint(cone(0.023, 0.05, 4).rotateY(Math.PI / 4).translate(0, 0.47, 0), PALETTE.metal),
      ]);
    case 'bow':
      return merge([
        paint(new THREE.TorusGeometry(0.22, 0.014, 4, 10, Math.PI * 0.7).rotateZ(Math.PI * 0.65).rotateY(Math.PI / 2).translate(0, 0.2, -0.1), PALETTE.woodDark),
        paint(box(0.006, 0.4, 0.006).translate(0, 0.2, 0.02), PALETTE.linen),
      ]);
    case 'maul':
      return merge([
        paint(cyl(0.02, 0.02, 0.5, 5).translate(0, 0.2, 0), PALETTE.woodDark),
        paint(box(0.2, 0.12, 0.12).translate(0, 0.46, 0), PALETTE.rockDark),
      ]);
    case 'axe':
      return merge([
        paint(cyl(0.018, 0.018, 0.46, 5).translate(0, 0.2, 0), PALETTE.woodDark),
        paint(box(0.14, 0.12, 0.02).translate(0.06, 0.39, 0), PALETTE.metal),
        paint(box(0.04, 0.16, 0.022).translate(0.13, 0.39, 0), PALETTE.metal),
      ]);
  }
}

/** Armor worn over the clothes; iron comes with a helmet. */
export function armorShell(kind: 'leatherArmor' | 'ironArmor'): Part {
  const iron = kind === 'ironArmor';
  const c = iron ? PALETTE.iron : PALETTE.leather;
  const parts: Part[] = [
    paint(cyl(0.135, 0.18, 0.2, 7).translate(0, 0.22, 0), c),
    paint(box(0.3, 0.05, 0.14).translate(0, 0.33, 0), iron ? PALETTE.metal : PALETTE.leatherDark),
  ];
  if (iron) parts.push(paint(new THREE.SphereGeometry(0.135, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.47, -0.01), PALETTE.metal));
  return merge(parts);
}

// Animals, facing +Z

export type AnimalKind = 'deer' | 'hare' | 'boar' | 'wolf';

function legs(xs: number, zs: number, h: number, w: number, color: number): Part[] {
  const out: Part[] = [];
  for (const x of [-xs, xs]) for (const z of [-zs, zs]) out.push(paint(box(w, h, w).translate(x, h / 2, z), color));
  return out;
}

export function animal(kind: AnimalKind): Part {
  switch (kind) {
    case 'deer':
      return merge([
        ...legs(0.07, 0.14, 0.24, 0.04, PALETTE.deer),
        paint(box(0.18, 0.16, 0.4).translate(0, 0.3, 0), PALETTE.deer),
        paint(box(0.14, 0.05, 0.3).translate(0, 0.22, 0), PALETTE.deerBelly),
        paint(box(0.08, 0.2, 0.08).rotateX(0.35).translate(0, 0.44, 0.19), PALETTE.deer),
        paint(box(0.1, 0.1, 0.16).translate(0, 0.53, 0.26), PALETTE.deer),
        paint(box(0.05, 0.04, 0.03).translate(0, 0.52, 0.35), PALETTE.soilDark),
        paint(cyl(0.01, 0.014, 0.16, 4).rotateZ(0.4).translate(-0.06, 0.64, 0.22), PALETTE.antler),
        paint(cyl(0.01, 0.014, 0.16, 4).rotateZ(-0.4).translate(0.06, 0.64, 0.22), PALETTE.antler),
        paint(cyl(0.008, 0.01, 0.08, 4).rotateX(-0.6).translate(-0.09, 0.68, 0.25), PALETTE.antler),
        paint(cyl(0.008, 0.01, 0.08, 4).rotateX(-0.6).translate(0.09, 0.68, 0.25), PALETTE.antler),
        paint(cone(0.03, 0.06, 4).rotateX(-2.2).translate(0, 0.34, -0.22), PALETTE.deerBelly),
      ]);
    case 'hare':
      return merge([
        paint(ico(0.09).scale(1, 0.85, 1.3).translate(0, 0.09, 0), PALETTE.hare),
        paint(ico(0.06).translate(0, 0.14, 0.11), PALETTE.hare),
        paint(box(0.025, 0.12, 0.018).rotateX(-0.3).translate(-0.025, 0.24, 0.08), PALETTE.hare),
        paint(box(0.025, 0.12, 0.018).rotateX(-0.3).translate(0.025, 0.24, 0.08), PALETTE.hare),
        paint(ico(0.03).translate(0, 0.1, -0.12), PALETTE.linen),
      ]);
    case 'boar':
      return merge([
        ...legs(0.08, 0.12, 0.12, 0.05, PALETTE.soilDark),
        paint(ico(0.18).scale(0.9, 0.8, 1.3).translate(0, 0.22, 0), PALETTE.boar),
        paint(box(0.04, 0.08, 0.3).translate(0, 0.37, -0.02), PALETTE.soilDark),
        paint(cyl(0.05, 0.07, 0.12, 6).rotateX(Math.PI / 2).translate(0, 0.2, 0.26), PALETTE.boar),
        paint(cyl(0.045, 0.045, 0.02, 6).rotateX(Math.PI / 2).translate(0, 0.2, 0.33), PALETTE.fat),
        paint(cone(0.015, 0.07, 4).rotateX(-0.6).translate(-0.05, 0.2, 0.3), PALETTE.tusk),
        paint(cone(0.015, 0.07, 4).rotateX(-0.6).translate(0.05, 0.2, 0.3), PALETTE.tusk),
      ]);
    case 'wolf':
      return merge([
        ...legs(0.06, 0.12, 0.2, 0.045, PALETTE.wolfDark),
        paint(box(0.15, 0.15, 0.38).translate(0, 0.27, 0), PALETTE.wolf),
        paint(box(0.13, 0.12, 0.13).translate(0, 0.34, 0.23), PALETTE.wolf),
        paint(cone(0.045, 0.12, 4).rotateX(Math.PI / 2).translate(0, 0.32, 0.34), PALETTE.wolfDark),
        paint(cone(0.03, 0.07, 4).translate(-0.04, 0.43, 0.21), PALETTE.wolfDark),
        paint(cone(0.03, 0.07, 4).translate(0.04, 0.43, 0.21), PALETTE.wolfDark),
        paint(cone(0.035, 0.2, 4).rotateX(-2.2).translate(0, 0.3, -0.25), PALETTE.wolfDark),
      ]);
  }
}

/** An arrow along +Z. */
export function arrow(): Part {
  return merge([
    paint(cyl(0.01, 0.01, 0.36, 4).rotateX(Math.PI / 2), PALETTE.arrow),
    paint(cone(0.022, 0.06, 4).rotateX(Math.PI / 2).translate(0, 0, 0.2), PALETTE.metal),
    paint(box(0.05, 0.005, 0.07).translate(0, 0, -0.15), PALETTE.linen),
  ]);
}

/** A tap marker for move orders. */
export const moveMarker = (): Part => paint(new THREE.TorusGeometry(0.3, 0.04, 4, 20).rotateX(Math.PI / 2).translate(0, 0.04, 0), 0xffffff);
