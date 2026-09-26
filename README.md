# Hearthwild

A playable prototype of a mobile colony sim: a small settlement on a low-poly diorama, where settlers with their own personalities build, eat, sleep and fight off goblin raids on their own. It is the first step toward a shared multiplayer world. See [docs/DESIGN.md](docs/DESIGN.md) for the design and the plan.

## Play it

```bash
npm install
npm run dev
```

Open the local URL on your computer, or the **Network** URL on a phone on the same Wi-Fi.

| Gesture | What it does |
| --- | --- |
| One finger | Moves the map, or draws when an area tool is active |
| Two fingers | Pinch to zoom, drag to move (works while drawing too) |
| Tap | Selects a settler or places a building |
| Mouse | Left button acts like one finger, right drag pans, wheel zooms |

Your first days:
1. **Harvest**: drag over trees and berry bushes.
2. **Build → Room**, then beds and a campfire.
3. Plant a **Rally** point where your settlers will fight together.
4. When scouts spot a war band, read the banner and tap it to see where it's coming from.

The game saves on the device. Close it and come back later: the time you were away is fast-forwarded, up to one in-game day, and summarised.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, reachable from other devices on your network |
| `npm test` | Simulation tests, including determinism and save/load |
| `npm run typecheck` | TypeScript checks for the game and the scripts |
| `npm run build` | Type-checks and builds to `dist/` |
| `npm run balance -- 40 8` | Plays 40 seeds for 8 days each and reports how harsh raids are |
| `npm run artifact` | Builds a single self-contained HTML page in `dist-artifact/` |

In the browser console, `hearthwild.advance(4800)` skips a day, and `hearthwild.issue({...})` gives an order.

## Layout

```
src/sim/     Deterministic simulation: map, settlers, jobs, raids, orders. No rendering code.
src/render/  Three.js diorama: models, palette, the scene.
src/input/   Touch and mouse controls.
src/ui/      HUD, sheets, overlays, icons, styles.
src/game.ts  Game loop, saving, catch-up, player actions.
tests/       Vitest suite for the simulation.
scripts/     Balance runner and the single-page build.
```
