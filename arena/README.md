# Arena: Heroes vs Demons

Two teams of four, evolved from nothing. Every fighter is driven by its own small neural network
(attention over what it can see, a GRU for memory, and heads for movement, action, ability choice and
targeting). Nobody scripts tactics. We build the world and the rules; the fighters learn to attack,
dodge, use cover, heal each other, summon and raise the dead, and then win XP and unlock new abilities
that the same networks have to learn to use.

The simulation is headless and compiled (numba): one full match takes tens of milliseconds, so thousands
of battles per generation are cheap. The 2D sprite viewer is a separate, standalone HTML page that replays
recorded matches. Swapping in Mixamo 3D models later only touches the viewer, never the simulation.

```
arena/
  layout.py     brain parameter layout, ability primitives, XP thresholds, the ability "draft"
  sim.py        the arena: physics, abilities, observations, the brain, the match loop (numba)
  evolve.py     deep genetic algorithm: co-evolving populations, hall of fame, XP, unlocks
  train.py      command line trainer
  replay.py     turns a recorded match into compact JSON
  watch.py      bundles champion replays from a run into one standalone HTML page
  analyze.py    measures what evolved teams actually do (cover, kiting, focus fire, ...)
  viewer/       the 2D sprite viewer (single HTML file, no dependencies)
  tests/        pytest suite for the rules, determinism, evolution and the replay format
```

## Quick start

```bash
pip install -r arena/requirements.txt

# evolve for a while (first call compiles for ~20 s; ~4 s per generation on 4 cores)
python -m arena.train --name main --gens 300

# keep going later, optionally with longer matches
python -m arena.train --name main --gens 300 --resume --tmax 240 --tsd 120

# watch: records champion matches and writes one page you can open in any browser
python -m arena.watch --run main --gens 0,50,100,200,latest
open arena/viewer/watch.html

# what are they doing?
python -m arena.analyze --run main --gen latest
```

Viewer: space = play/pause, left/right = seek 5 s, episode menu switches generations,
the Void (the closing ring) is what ends stalemates.

## The world

- A 32x32 arena with five stone pillars that block movement and projectiles (so cover is real).
- Heroes: Knight, Archer, Mage, Cleric. Demons: Brute, Imp, Warlock, Necromancer.
- Every fighter can move, use a basic attack, and dodge (a dash with brief invulnerability).
- Cleric starts with Heal, Necromancer with Summon, Mage and Warlock with a telegraphed Blast.
- After 70 s the Void starts closing in and burns anyone outside it, so fights cannot stall forever.
- Heals and wards only work on *other* characters. (Early runs found a self-heal loop that stalled
  fights until the Void ended them; that is now a rule, not something to hope evolution avoids.)

## How evolution works

- **Genome**: for each of a team's four characters, a ~9k-parameter network plus its ability slots.
- **Algorithm**: a deep genetic algorithm. Truncation selection, role-level crossover (a child can take
  its Cleric from one parent and its Knight from another), Gaussian mutation with a random step size per child.
- **Co-evolution**: heroes and demons evolve against each other, with a hall of fame of past champions
  mixed in so a side cannot forget how to beat an old strategy.
- **Fitness**: win/draw/loss, damage dealt, HP margin, healing, plus a participation term so a fighter
  who does nothing drags its team down.
- **XP and unlocks**: characters earn XP from results and contribution, and it is inherited. At the XP
  thresholds a character is offered three random ability mutations from its role's pool and the character's
  *own network* picks one (the draft head). Abilities are generic primitives (projectile, blast, heal, ward,
  haste, summon, raise dead) with mutating parameters. The ability scorer is shared across slots and reads
  each ability's descriptor, so a new spell plugs into an existing brain rather than needing a new output.
- Ranged shots lead moving targets. Blasts do not: they are telegraphed on the ground, so dodging
  and positioning matter.

## What is simplified (for now)

- Summoned skeletons use a simple scripted brawler AI, not evolved brains.
- Perception is perfect (no fog of war), and everything is 2D.
- Abilities come from a fixed set of primitives; the evolution tunes their numbers and picks which to take.
- Sprites are drawn in code. Mixamo 3D can replace the renderer later because the viewer only reads
  replays (positions, state, events).

## Tests

```bash
python -m pytest arena/tests -q
```

Numba freezes module constants at compile time. After editing `layout.py`, delete `arena/__pycache__`.
