# Uno No Mercy 🃏☠

A cartoony, browser-based clone of **Uno Show 'Em No Mercy** with simple link-based multiplayer.

## Run it

```bash
cd uno-no-mercy
npm install
npm start            # http://localhost:3000   (PORT=… to change)
npm test             # engine simulation: 400 bot games + rule checks
```

Open the page, enter a name and hit **Create game**. Share the **invite link**
(`/?room=ABCD`) — anyone who opens it joins your lobby. Empty seats can be filled
with bots (2–8 players total). To play over the internet, deploy the folder to any
Node host (Render, Railway, Fly…) or tunnel your local port (`cloudflared tunnel --url
http://localhost:3000`, ngrok, …) and share that URL.

Refreshing the page or losing connection rejoins your seat automatically; if you stay
away, a bot plays your turns (and a 45 s turn timer keeps AFK players from stalling).

## Rules implemented (168-card deck)

* **Deck:** per colour 0–9 ×2, Skip ×3, Skip Everyone ×2, Reverse ×3, Draw 2 ×2, Draw 4 ×2,
  Discard All ×2; plus 8 each of Wild Reverse Draw 4, Wild Draw 6, Wild Draw 10, Wild Color Roulette.
* 7 cards each. Match colour / number / symbol; wilds go anywhere.
* **No playable card?** Draw until you get one, then play it or keep it.
* **Draw stacking:** answer a draw card with another draw card of equal-or-higher value
  (+2 < +4 = Wild Reverse +4 < +6 < +10). Otherwise take the whole stack and lose your turn.
* **Mercy rule:** reach 25 cards and you're eliminated (your cards go back in the deck).
  Last player standing wins — or be first to empty your hand.
* **Skip** (next player loses a turn), **Skip Everyone** (play again), **Reverse**
  (acts as Skip with 2 players), **Discard All** (dump every card of that colour),
  **Wild Reverse +4**, **Wild +6 / +10**, **Wild Color Roulette** (next player draws until they
  hit the chosen colour, keeps all and loses their turn).
* **7** swaps hands with a player of your choice, **0** rotates everyone's hands in the direction of play.

## Layout

```
server/game.js    pure rules engine + bot AI (no I/O)
server/index.js   HTTP static server + WebSocket rooms, bot/turn scheduling
server/test.js    simulation + rule tests
public/           index.html, style.css, app.js (rendering, animations, WebAudio sfx)
```

The server is authoritative: clients only send `play` / `draw` / `pass`; the server validates
every move and broadcasts a per-player view (opponents' hands are never sent).

## Artifact build (no server)

`node tools/build-artifact.js` bundles everything into one HTML file (`artifact/uno-no-mercy.html`).
There, the player who creates a game *hosts* it: the same `Room`/`Game` engine runs in their tab and
other players connect through the Artifact `room` capability using the 4-letter code. If the host
closes the tab the game ends. Without the `room` capability the page falls back to solo play vs bots.
`public/net-ws.js` (Node server) and `public/net-room.js` (artifact) are the two interchangeable transports.
