/** Small helpers for building the HUD's markup. */
import { ICONS, type IconName } from './icons';

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const icon = (name: IconName, cls = ''): string => `<span class="i${cls ? ` ${cls}` : ''}">${ICONS[name]}</span>`;

const rendered = new WeakMap<HTMLElement, string>();

/** Replaces an element's markup only when it changed, so taps, scroll and focus survive re-renders. */
export function setHTML(el: HTMLElement, html: string): boolean {
  if (rendered.get(el) === html) return false;
  rendered.set(el, html);
  el.innerHTML = html;
  return true;
}

export function moodColor(mood: number): string {
  if (mood >= 60) return '#72d38c';
  if (mood >= 35) return '#ffc53d';
  return '#ff6b57';
}

export function bar(label: string, value: number, max: number, color: string): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100)).toFixed(0);
  return `<div class="bar"><span>${label}</span><i style="--v:${pct}%;--c:${color}"></i><b>${Math.round(value)}</b></div>`;
}

export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
