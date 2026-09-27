# Hearthwild: design notes

*Hearthwild is a working title.*

A mobile colony sim set in a shared, persistent fantasy world. Each friend runs a settlement in their own territory on one continent. Time never stops, settlers act on their own, and what one player does ripples out to everyone else.

> RimWorld's colony simulation, Mount & Blade's world and factions, Valheim-style building, Shadow of War's emergent characters, and a persistent fantasy world shared with friends.

## North star

This is where the game is heading. The prototype is the first slice of it.

- **A continent for 4 to 8 friends.** Each player holds a procedurally generated territory. Between the territories lies shared, contested wilderness: ruins, monster lairs, old roads and the best resources.
- **Territories need each other.** Some land is rich farmland, some sits on iron, some has a coast or old magic. Trade is how you get what your land lacks, and roads are how trade moves.
- **NPC kingdoms with their own wars.** Kingdoms rise, fight and fall. A war can close the road your caravans use and push a friend to reroute or pay tolls. Players can ally with kingdoms, turn on them, or become one.
- **Diplomacy between players:** alliances, trade pacts, embargoes and vassals. Grudges are remembered.
- **Raids with plans.** An attacker picks an entry point, objectives such as loot, captives or burning the fields, and a retreat threshold. The defender prepares patrols, alarm bells, towers, traps and fallback points. The fight plays out whether or not either side is watching.
- **Emergent characters.** Settlers are people with pasts, skills, loves and hatreds. Over time some become more: a scholar who finds forbidden books might become a necromancer, with consequences for the whole world. Enemies are people too: named goblin chiefs escape, come back scarred and angrier, and remember who hurt them, the way Shadow of War's nemeses do.
- **Generations.** Settlers marry, have children and grow old. Families become noble houses with names, heirlooms and feuds.
- **World pressure.** Seasons and famine, monster migrations, plagues, dragons, and world events that touch everyone at once, like *The Long Night*, when the sun barely rises for a season and the dead walk.
- **Ages and history.** A world runs for weeks, builds to a climax and closes as an Age with a generated chronicle. The next Age starts from its legends and ruins.
- **A hybrid simulation.** Places someone is watching, and anything important happening such as a raid or a visit, run in full detail. Everything else is simulated in summary, so a persistent world stays cheap to run.
- **Made for a phone.** Tap a settler, a building or a place on the map. Pinch out from your colony to the world map and back in.

### The first multiplayer milestone

Two players on one shared continent, each with a small colony that grows to 20 or 30 settlers, in real time. Building, resources, personalities, trade, sending parties between colonies, and one NPC faction.

## Decisions so far

| Question | Decision | What it means |
| --- | --- | --- |
| Who plays together? | **Friends-only worlds** (4 to 8 players) for now | One server per world. No matchmaking, no strangers, no heavy anti-cheat to start. |
| How harsh are raids? | **Harsh. Settlers die for good.** | Fairness comes from warning time, planning, taking command yourself and personalities, not from softer losses. |
| How hands-on is it? | **Plan by default, take command when it matters** | Settlers run their own lives. In a fight you can draft them and give direct orders, RimWorld-style. |
| What does it look like? | **Low-poly 3D, flat bright colours, a tilted board**, inspired by The Battle of Polytopia | The camera sits nearly square to the grid, so a rectangle dragged with a thumb is a rectangle on the map. |
| What is it built with? | **TypeScript everywhere**: Three.js on the phone, the same simulation code on the server | Friends can playtest from a link today. Wrap it with Capacitor for the app stores later. |

## Pillars

1. **Settlers are people you can read.** Every settler has a childhood and an adulthood, ten skills with passions, traits, friends and enemies, and a life story that fills in as they live. You should be able to answer "why is she like this?" by tapping on her.
2. **Plan by default, command when it counts.** Settlers work, eat, sleep, relax and defend themselves without you. When raiders come you can take the squad and lead the fight.
3. **Build what you imagine.** Walls, floors, furniture, workshops, decor and defences, with rooms that settlers judge by how impressive they are.
4. **One living world.** Raids, trade and world events touch every settlement.
5. **Built for thumbs and short sessions.** Check in, read what happened, set plans, leave.

## What the prototype has (v0.2)

One colony on one phone, in a 64×64 region. Everything below runs in a deterministic simulation.

**Settlers**
- Ten skills (melee, shooting, construction, mining, plants, cooking, crafting, medicine, social, intellect) that improve with use. Passions make them learn faster and enjoy the work. Milestones go in their life story ("Became an expert builder").
- Childhood and adulthood backstories set their skills. Some leave them unable to fight or unwilling to haul.
- 24 traits, including brave, coward, bloodlust, tough, nimble, industrious, lazy, glutton, ascetic, greedy, night owl, green thumb, too smart, iron-willed, volatile and cold-hearted.
- Needs for food, rest and fun, and moods built from what they see and remember: meals, bedrooms, beauty, darkness, deaths, weddings, fights.
- A daily schedule. They work, relax in the evening (campfire, horseshoes, chess, stargazing, walks, admiring statues), then sleep. Night owls live the other way round.
- Social life. Opinions come with reasons, and settlers chat, have deep talks, insult each other, fall in love, marry, break up and get into fistfights. Deaths hit people according to what the dead were to them.
- Mental breaks. Settlers pushed too far wander off in a daze or attack someone they hate.

**Work and economy**
- Gathering: chop trees, pick berries, quarry stone, mine iron ore.
- Farming: potato fields, and healroot fields that double healing speed. Crops grow slower on sand and not at all in winter.
- Hunting deer, hares, boars and wolves for meat and leather. Skittish animals bolt; boars and wolves fight back.
- Cooking simple meals at a campfire, and fine meals at a stove if the cook knows how.
- Crafting clubs, spears, bows, swords and armor to keep a set number in stock. Settlers pick up better gear on their own.
- Research at a desk: archery, masonry, cooking, herbal medicine, games, decoration, smithing and tactics.
- A work focus per settler. Without one, they pick what they are best at and love most.
- When food runs short, everyone forages without being told.

**Building**
- Wooden and stone walls, doors, and one-drag rooms.
- Floors: wooden planks, stone tiles and carpet.
- Furniture: beds, tables, stools and torches.
- Workshops: campfire, stove, crafting bench and research desk.
- Fun: horseshoes and chess.
- Decor: plant pots and statues.
- Defence: spike traps, barricades that give cover, and watchtowers that let archers shoot farther and truer.
- Rooms are rated from awful to extremely impressive by size, beauty and furniture. Bedrooms and dining rooms move moods.

**Raids and defence**
- Goblin war bands of fighters, looters, archers and brutes, growing with time, settlers and wealth. Scouts warn 8 hours ahead.
- Named chiefs lead some bands. A chief who escapes comes back stronger with a new title ("the Scarred", "Bane of Mira", "the Unkillable"). Settlers who were cut down, or who lost family, swear revenge and fight harder against that chief. When a chief dies, the whole band breaks.
- Wolf packs hunt the settlement, more often in winter.
- **Drafting:** tap Draft to call everyone who can fight to arms. Tap the ground to move the squad, tap an enemy to attack, tap a downed settler to tend them.
- Undrafted settlers muster at the rally point (or at home), fight whatever comes near as a group, man watchtowers if they have bows, and respond by personality. Cowards flee, the bloodthirsty charge, the brave never run.
- Ranged combat with sight lines and cover. Flanking, formation bonuses at the rally point, and the tactics research.
- Downed settlers bleed out in about 4 hours unless someone tends them. Some blows kill outright.

**World pressure**
- Seasons of five days each. Winter strips the berry bushes and stops the fields, so autumn is for stocking up.
- Wildlife roams and returns. Wanderers and groups of migrants join over time, sometimes as families.

**Interface**
- Toolbar: Select, Orders, Build, Zones, Draft, Colony.
- Settler pages with four tabs:
  - **Overview:** needs, gear, thoughts, focus and draft.
  - **Skills:** levels, passions, work order.
  - **Social:** who they love and hate, and why.
  - **Story:** backstory, traits, grudge and life timeline.
- Goblins and animals have pages too, with a hunt toggle and chief histories.
- A Colony sheet for research, crafting orders and a roster where each settler's focus can be set.
- A chronicle of key events, and a "while you were away" summary after catching up on missed time.

## Time

- There is one shared clock and no pause. RimWorld's pause button doesn't survive multiplayer, so the game is about planning ahead and short, decisive moments of command.
- **Prototype:** a day lasts 8 minutes at 1× so it can be tested quickly. There is a 1×/2×/3× switch for playtesting only.
- **Shared world target:** much slower, around 1 to 2 real hours per in-game day, so checking in a few times a day is enough to play well.
- **Rule of thumb:** nothing permanent happens between check-ins unless you had warning or your standing orders covered it.
- **Away from the game:** the server runs your region. You come back to a "while you were away" summary, and later a replay of every raid. The prototype already does this on one phone: close the app, reopen it, and up to one in-game day is fast-forwarded and summarised.

## Balance

`npm run balance -- <seeds> <days>` plays three scripted strategies. None of them drafts, so a player who takes command should do better.

- **Passive:** nobody gives any orders.
- **Settled:** gathering, a campfire, a house with beds and a table, a potato field, a research desk and a crafting bench.
- **Fortified:** settled, plus a rally point, spike traps and a barricade.

| Strategy | Days | Seeds | Settlement fell | Lost someone | Deaths per run | Settlers at the end |
| --- | --- | --- | --- | --- | --- | --- |
| Passive | 10 | 30 | 27% | 77% | 2.9 | 6.6 |
| Settled | 10 | 30 | 17% | 60% | 1.5 | 7.8 |
| Fortified | 10 | 30 | 7% | 50% | 0.9 | 9.2 |
| Settled | 20 | 16 | 31% | 94% | 3.4 | 11.6 |
| Fortified | 20 | 16 | 13% | 81% | 3.1 | 13.1 |

Twenty days takes a settlement through its first winter and about nine attacks. Settlements grow as wanderers and migrants arrive, but the scripted ones never add beds or defences for them, so their moods sag and their losses mount. A player who keeps building and takes command in fights should do much better.

Early raids are small (the first is always two goblins), but they grow every time and chiefs come back stronger, so a settlement that stops improving eventually bleeds.

## The shared world (planned)

- **World map:** territories of 64×64 tiles (the prototype's map size), one per player, joined by contested wilderness, roads and NPC kingdoms.
- **Caravans and parties:** travel in real time to trade, visit, scout or raid. Travel time doubles as warning time.
- **NPC kingdoms carry the ripples:** roads, tolls, blockades and wars. If you go to war with a kingdom, your friend's caravans have to reroute or pay.
- **A world storyteller:** a second director on top of each settlement's events. It watches the whole world and runs arcs lasting weeks: omens, a village falls, the dead spread along the roads, a coalition forms, a siege, the aftermath.
- **The necromancer:** grows out of the settlers themselves. A clever, bitter settler with forbidden books might turn, and a player could choose to embrace it and become the world's villain. It runs as a bounded arc, is strong but beatable, and rewards both sides.
- **Settlers across players:** friendships, rivalries and marriages between settlements. Captured raiders can be recruited, and grudges are remembered.
- **Fantasy that solves multiplayer problems:** wards and summoned guardians defend while you sleep, scrying shows incoming armies, portals link allies, curses let rivals cause trouble without a full raid.
- **Ages:** a world runs about 4 to 8 weeks, builds to a climax, and ends with a generated chronicle. Some legacy carries into the next Age.

## Architecture

- `src/sim` is pure, deterministic TypeScript with no rendering code:
  - a seeded sfc32 RNG stored in the state
  - integer path costs and no `Math.sin`, `sqrt` or the like
  - a fixed tick
- The whole state is plain JSON. Saving is `JSON.stringify`, and a test proves that save, load and continue matches an uninterrupted run.
- Every player action is a small serialisable **command**: build, zone, draft, move, attack, hunt, research, craft orders. In multiplayer the phone sends commands, the server runs the same `step()` for every region, and phones predict locally.
- Pathfinding is one Dijkstra flood per decision, over cached cost grids, which answers "what is the nearest X I can reach?" for every kind of work at once.
- **Two-tier simulation (planned):** full detail when someone is watching or something is happening, and a cheap summary otherwise. That keeps server costs flat.
- `src/render` only reads the state. `src/input` and `src/ui` turn gestures into commands.

## Milestones

1. **One colony, one phone.** *Done: the v0.1 prototype.*
2. **A colony worth living in.** *Done: v0.2, with readable settlers, drafting, crafting, farming, research, seasons, chiefs and wolves.*
3. **Shared world.** Server-run regions, a world map, caravans, trade and visits, catch-up on the server.
4. **Player raids.** Raid plans, travel time, defence plans, replays, shields.
5. **First world arc.** The world storyteller, one NPC kingdom, and a threat bigger than a goblin chief.
6. **Families and houses.** Children, ageing, heirs and noble houses.
7. **The necromancer.**

## Open questions

- How fast should the shared clock run?
- Should a single raid ever be able to wipe out a settlement? Today it can if every settler goes down and nobody is left to tend them.
- How much should drafting matter? It should feel like the best play in a crisis, without making autonomous defence feel useless.
- What is the game called?
