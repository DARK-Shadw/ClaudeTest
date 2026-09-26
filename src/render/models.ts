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

export function goblin(c: PawnColors): Part {
  return merge([
    paint(cyl(0.1, 0.15, 0.26, 6).translate(0, 0.13, 0), c.cloth),
    paint(ico(0.12).translate(0, 0.37, 0), c.skin),
    paint(cone(0.035, 0.16, 4).rotateZ(Math.PI / 2).translate(-0.16, 0.4, 0), c.skin),
    paint(cone(0.035, 0.16, 4).rotateZ(-Math.PI / 2).translate(0.16, 0.4, 0), c.skin),
    paint(box(0.12, 0.03, 0.02).translate(0, 0.39, 0.11), 0xd23a2a),
    paint(cyl(0.014, 0.014, 0.72, 4).translate(0.17, 0.3, 0.04), PALETTE.woodDark),
    paint(cone(0.035, 0.1, 4).translate(0.17, 0.71, 0.04), PALETTE.metal),
  ]);
}

/** What a colonist is carrying, held in front of them. */
export const carried = (): Part => box(0.16, 0.12, 0.12).translate(0, 0.25, 0.17);
