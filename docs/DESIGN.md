# Hearthwild: design notes

*Hearthwild is a working title.*

A mobile colony sim set in a shared fantasy world. Each friend runs a settlement in their own region of one persistent world. Time never stops, settlers act on their own, and what one player does ripples out to everyone else.

> RimWorld's settlers with names and grudges, Clash of Clans' raids while you're away, and a Game of Thrones-style world where players have to band together.

## Decisions so far

| Question | Decision | What it means |
| --- | --- | --- |
| Who plays together? | **Friends-only worlds** (4 to 10 players) for now | One server per world. No matchmaking, no strangers, no heavy anti-cheat to start. |
| How harsh are raids? | **Harsh. Settlers die for good.** | Fairness comes from warning time, planning tools and personalities, not from softer losses. |
| What does it look like? | **Low-poly 3D, flat bright colours, a tilted board**, inspired by The Battle of Polytopia | The camera sits nearly square to the grid, so a rectangle dragged with a thumb is a rectangle on the map. |
| What is it built with? | **TypeScript everywhere**: Three.js on the phone, the same simulation code on the server | Friends can playtest from a link today. Wrap it with Capacitor for the app stores later. |

## Pillars

1. **Settlers are people.** Traits, backstories, skills, moods, memories. A coward runs, the bloodthirsty charge, and a death hits everyone's mood.
2. **Plan, don't micromanage.** You give orders and set up defences. The settlers carry them out as themselves, even while you're away.
3. **One living world.** Raids, trade and world events touch every settlement.
4. **Built for thumbs and short sessions.** Check in, read what happened, set plans, leave.

## Time

- There is one shared clock and no pause. RimWorld's pause button doesn't survive multiplayer, so the game is about planning ahead instead of reacting frame by frame.
- **Prototype:** a day lasts 8 minutes at 1× so it can be tested quickly. There is a 1×/2×/3× switch for playtesting only.
- **Shared world target:** much slower, around 1 to 2 real hours per in-game day, so checking in a few times a day is enough to play well.
- **Rule of thumb:** nothing permanent happens between check-ins unless you had warning or your standing orders covered it.
- **Away from the game:** the server runs your region. You come back to a "while you were away" summary, and later a replay of every raid. The prototype already does this on one phone: close the app, reopen it, and up to one in-game day is fast-forwarded and summarised.

## Raids and defence

**Built in the prototype:**
- Goblin war bands arrive every 2 to 3 days and grow each time. Scouts warn 8 hours ahead and say which direction they're coming from.
- A war band mixes fighters, who hunt settlers, with looters, who grab supplies and run.
- Walls and doors have to be smashed through. Spike traps wound the first goblin to step on them.
- **Rally point:** settlers gather there and fight as a unit, hitting more often and taking less damage.
- **Flanking:** anyone ganged up on gets hit more often, so lone settlers are in real danger.
- Personality decides the response. Cowards flee unless cornered. Bloodthirsty settlers charge any goblin in sight. Brave settlers never run, even badly hurt.
- **Downed settlers** bleed out in about 4 hours unless someone bandages them. Some blows kill outright, and tough settlers survive more often.
- Deaths leave a grave and a mood hit on everyone. Wounded goblins flee.

**Balance** (`npm run balance`, 40 seeds, scripted play):

| Strategy | Days | Settlement fell | Lost someone | Deaths per run |
| --- | --- | --- | --- | --- |
| Unprepared (no walls, no rally point) | 8 | 15% | 30% | 0.88 |
| Prepared (room, beds, rally point) | 8 | 0% | 35% | 0.40 |
| Unprepared | 14 | 25% | 65% | 1.85 |
| Prepared, never upgraded | 14 | 13% | 60% | 1.50 |

Preparing pays early. War bands keep growing, so a settlement that stops improving its defences eventually bleeds.

**Planned:** raids by other players with real travel time on the world map, raid replays, a shield after being raided, vacation mode, and ranged combat (bows) so walls and chokepoints matter more.

## The shared world (planned)

- **World map:** regions of 48×48 tiles (the prototype's map size), one per player, plus NPC kingdoms and wild lands.
- **Caravans:** travel in real time to trade, visit or raid. Travel time doubles as warning time.
- **NPC kingdoms carry the ripples:** roads, tolls, blockades and wars. If you go to war with a kingdom, your friend's caravans have to reroute or pay.
- **A world storyteller:** a second director on top of each settlement's events. It watches the whole world and runs arcs lasting weeks: omens, a village falls, the dead spread along the roads, a coalition forms, a siege, the aftermath.
- **The necromancer:** a player can choose to become the world's villain. It's opt-in, runs as a bounded arc, is strong but beatable, and rewards both sides.
- **Settlers across players:** friendships, rivalries and marriages between settlements. Captured raiders can be recruited, and grudges are remembered.
- **Fantasy that solves multiplayer problems:** wards and summoned guardians defend while you sleep, scrying shows incoming armies, portals link allies, curses let rivals cause trouble without a full raid.
- **Ages:** a world runs about 4 to 8 weeks, builds to a climax, and ends with a generated chronicle. Some legacy carries into the next Age.

## Architecture

- `src/sim` is pure, deterministic TypeScript with no rendering code:
  - a seeded sfc32 RNG stored in the state
  - integer path costs and no `Math.sin`, `sqrt` or the like
  - a fixed tick
- The whole state is plain JSON. Saving is `JSON.stringify`, and a test proves that save, load and continue matches an uninterrupted run.
- Every player action is a small serialisable **command**. In multiplayer the phone sends commands, the server runs the same `step()` for every region, and phones predict locally.
- **Two-tier simulation (planned):** full detail when someone is watching or something is happening, such as a raid or a visit, and a cheap summary otherwise. That keeps server costs flat.
- `src/render` only reads the state. `src/input` and `src/ui` turn gestures into commands.

## Milestones

1. **One colony, one phone.** *Done: this prototype.*
2. **Shared world.** Server-run regions, a world map, caravans, trade and visits, catch-up on the server.
3. **Player raids.** Travel time, defence plans, replays, shields.
4. **First world arc.** The world storyteller, one NPC kingdom, a smaller threat such as a goblin warlord.
5. **The necromancer.**

## Open questions

- How fast should the shared clock run?
- Should a single raid ever be able to wipe out a settlement? Today it can if every settler goes down and nobody is left to bandage them.
- What is the game called?
