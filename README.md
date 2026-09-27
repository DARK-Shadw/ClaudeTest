# Hearthwild

A playable prototype of a mobile colony sim on a low-poly diorama. Settlers with their own pasts, skills, friends and enemies build, farm, craft, research, fall in love and fight off goblin raids on their own, and you can take command of them when it counts. It is the first step toward a shared multiplayer world. See [docs/DESIGN.md](docs/DESIGN.md) for the design, the long-term vision and the plan.

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
| Tap | Selects a settler, animal or goblin, or places a building |
| Mouse | Left button acts like one finger, right drag pans, wheel zooms |

Your first days:
1. **Orders → Harvest**: drag over trees and berry bushes.
2. **Build → Room**, then beds, a table and a campfire. Floors, torches and decor make rooms impressive, and settlers notice.
3. **Zones → Potato field** before winter, and a **research desk** (Build → Work) to unlock bows, stoves, medicine and more.
4. Tap a settler to read their story, their skills and passions, and who they love or hate.
5. When scouts spot a war band, tap the banner to see where it's coming from. Tap **Draft** to take command: tap the ground to move, tap an enemy to attack, tap a downed settler to tend them.

The game saves on the device. Close it and come back later: the time you were away is fast-forwarded, up to one in-game day, and summarised.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, reachable from other devices on your network |
| `npm test` | Simulation tests, including determinism and save/load |
| `npm run typecheck` | TypeScript checks for the game and the scripts |
| `npm run build` | Type-checks and builds to `dist/` |
| `npm run balance -- 30 10` | Plays 30 seeds for 10 days with three scripted strategies and reports how settlements fare |
| `npm run artifact` | Builds a single self-contained HTML page in `dist-artifact/` |

In the browser console, `hearthwild.advance(4800)` skips a day, and `hearthwild.issue({...})` gives an order.

## Layout

```
src/sim/     Deterministic simulation. No rendering code.
  defs.ts      Content: items, buildings, floors, weapons, recipes, research, animals, crops, skills
  people.ts    Settlers, backstories, traits, goblins, chiefs and animals
  ai/          Behaviour: colonists (needs, schedule, work, combat, orders), raiders, animals, job runners
  combat.ts    Melee, archery, cover, towers, downed and dead, chiefs
  social.ts    Opinions, friendships, romance, fistfights, mourning
  events.ts    Raids, wolf packs, newcomers, seasons, crops, wildlife, needs and breakdowns
src/render/  Three.js diorama: models, board overlays, palette, the scene.
src/input/   Touch and mouse controls.
src/ui/      HUD, settler pages, build and colony menus, overlays, icons, styles.
src/game.ts  Game loop, saving, catch-up, player actions.
tests/       Vitest suite for the simulation.
scripts/     Balance runner and the single-page build.
```
