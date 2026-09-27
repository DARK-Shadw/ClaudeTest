/** Local persistence. Every access is guarded: storage can be missing, full or blocked. */
import { deserialize, serialize, type SimState } from './sim';

/** Saves from an older version of the simulation are left alone rather than misread. */
const SAVE_KEY = 'hearthwild.save.v2';
const SAVED_AT_KEY = 'hearthwild.savedAt.v2';
const PREFS_KEY = 'hearthwild.prefs.v1';

export interface Prefs {
  shadows: boolean;
  speed: number;
}

const DEFAULT_PREFS: Prefs = { shadows: true, speed: 1 };

export function loadGame(): { state: SimState; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = deserialize(raw);
    if (!state) return null;
    const savedAt = Number(localStorage.getItem(SAVED_AT_KEY)) || Date.now();
    return { state, savedAt };
  } catch {
    return null;
  }
}

export function saveGame(state: SimState): void {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
    localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
  } catch {
    // Out of space or blocked: the game keeps running, it just won't resume later.
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience only.
  }
}
