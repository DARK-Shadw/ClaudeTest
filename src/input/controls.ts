/**
 * Touch-first map controls.
 *
 * - One finger drags the map, or draws a rectangle when an area tool is active.
 * - Two fingers always pan and pinch-zoom, even mid-drawing.
 * - A quick tap selects or places.
 * - With a mouse: left button as one finger, right or middle button pans, wheel zooms.
 */
import type * as THREE from 'three';
import type { WorldView } from '../render/view';

export interface TilePos {
  x: number;
  y: number;
}

export interface ControlHandlers {
  /** True when a one-finger drag should draw instead of pan. */
  drawsAreas(): boolean;
  onTap(clientX: number, clientY: number): void;
  onArea(start: TilePos, end: TilePos, done: boolean): void;
  onAreaCancel(): void;
}

type Mode = 'idle' | 'press' | 'pan' | 'draw' | 'pinch' | 'spent';

const TAP_SLOP = 9;

export class Controls {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = 'idle';
  private startX = 0;
  private startY = 0;
  private startTile: TilePos | null = null;
  private anchor: THREE.Vector3 | null = null;
  private pinchDist = 0;

  constructor(
    private readonly view: WorldView,
    private readonly el: HTMLElement,
    private readonly handlers: ControlHandlers,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', this.wheel, { passive: false });
  }

  private down = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      if (this.mode === 'draw') this.handlers.onAreaCancel();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    this.startX = e.clientX;
    this.startY = e.clientY;
    const panButton = e.pointerType === 'mouse' && e.button !== 0;
    if (panButton) {
      this.mode = 'pan';
      this.anchor = this.view.groundAt(e.clientX, e.clientY);
      return;
    }
    this.mode = 'press';
    const tile = this.view.tileAt(e.clientX, e.clientY);
    this.startTile = tile ? { x: tile.x, y: tile.y } : null;
    this.anchor = this.view.groundAt(e.clientX, e.clientY);
  };

  private move = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.mode === 'pinch') {
      this.updatePinch();
      return;
    }
    if (this.mode === 'press') {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < TAP_SLOP) return;
      this.mode = this.handlers.drawsAreas() && this.startTile ? 'draw' : 'pan';
    }
    if (this.mode === 'pan') this.panTo(e.clientX, e.clientY);
    else if (this.mode === 'draw') this.draw(e.clientX, e.clientY, false);
  };

  private up = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.mode === 'pinch') {
      // The finger left behind should not suddenly start a drag or a tap.
      this.mode = this.pointers.size > 0 ? 'spent' : 'idle';
      return;
    }
    if (this.pointers.size > 0) return;
    if (this.mode === 'press') {
      if (this.handlers.drawsAreas() && this.startTile) this.handlers.onArea(this.startTile, this.startTile, true);
      else this.handlers.onTap(e.clientX, e.clientY);
    } else if (this.mode === 'draw') {
      this.draw(e.clientX, e.clientY, true);
    }
    this.mode = 'idle';
  };

  private cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'draw') this.handlers.onAreaCancel();
    if (this.pointers.size === 0) this.mode = 'idle';
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };

  private panTo(clientX: number, clientY: number): void {
    if (!this.anchor) return;
    const now = this.view.groundAt(clientX, clientY);
    if (now) this.view.panBy(this.anchor.x - now.x, this.anchor.z - now.z);
  }

  private draw(clientX: number, clientY: number, done: boolean): void {
    const tile = this.view.tileAt(clientX, clientY);
    if (!tile || !this.startTile) return;
    this.handlers.onArea(this.startTile, { x: tile.x, y: tile.y }, done);
  }

  private midpoint(): { x: number; y: number; dist: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private startPinch(): void {
    this.mode = 'pinch';
    const m = this.midpoint();
    this.pinchDist = Math.max(1, m.dist);
    this.anchor = this.view.groundAt(m.x, m.y);
  }

  private updatePinch(): void {
    if (this.pointers.size < 2) return;
    const m = this.midpoint();
    if (m.dist > 1) {
      this.view.zoomAt(m.dist / this.pinchDist, m.x, m.y);
      this.pinchDist = m.dist;
    }
    this.panTo(m.x, m.y);
  }
}
