'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, GameError, botMove } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_SEATS = 8;
const SPEED = Number(process.env.SPEED) || 1; // >1 speeds up bots (testing)
const TURN_MS = 45000;
const BOT_NAMES = ['Bolt', 'Pixel', 'Waffles', 'Zippy', 'Mochi', 'Gizmo', 'Noodle', 'Biscuit', 'Turbo', 'Pickle'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

// ---- static files ------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.end('ok'); return; }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---- rooms -------------------------------------------------------------------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

class Room {
  constructor(code) {
    this.code = code;
    this.seats = [];       // { token, name, bot, ws, connected, emote }
    this.game = null;
    this.phase = 'lobby';  // lobby | playing | ended
    this.timer = null;
    this.deadline = 0;
    this.lastEvents = [];
    this.lastActivity = Date.now();
  }

  hostIndex() { return this.seats.findIndex((s) => !s.bot); }

  addBot() {
    if (this.seats.length >= MAX_SEATS) return;
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + this.seats.length;
    this.seats.push({ token: crypto.randomUUID(), name, bot: true, ws: null, connected: true });
  }

  send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

  broadcast() {
    this.lastActivity = Date.now();
    this.seats.forEach((s, i) => { if (s.ws) this.send(s.ws, this.stateFor(i)); });
  }

  stateFor(i) {
    const base = {
      t: 'state',
      room: this.code,
      phase: this.phase,
      you: i,
      host: this.hostIndex(),
      seats: this.seats.map((s) => ({ name: s.name, bot: s.bot, connected: s.connected, emote: s.emote || null })),
    };
    if (this.game) {
      Object.assign(base, {
        game: this.game.view(i),
        seq: this.game.seq,
        events: this.lastEvents,
        ms: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
      });
    }
    return base;
  }

  start() {
    if (this.seats.length < 2) throw new GameError('Need at least 2 players (add a bot!)');
    this.game = new Game(this.seats.map((s) => ({ name: s.name, bot: s.bot })));
    this.phase = 'playing';
    this.lastEvents = [{ t: 'start', p: this.game.turn }];
    this.afterAction();
  }

  backToLobby() {
    clearTimeout(this.timer);
    this.game = null;
    this.phase = 'lobby';
    this.seats = this.seats.filter((s) => s.bot || s.connected);
    this.broadcast();
  }

  handle(i, m) {
    const seat = this.seats[i];
    const isHost = i === this.hostIndex();
    switch (m.t) {
      case 'addBot': if (this.phase === 'lobby' && isHost) { this.addBot(); this.broadcast(); } break;
      case 'removeBot':
        if (this.phase === 'lobby' && isHost && this.seats[m.seat] && (this.seats[m.seat].bot || m.seat !== i)) {
          const s = this.seats[m.seat];
          if (!s.bot && s.ws) { this.send(s.ws, { t: 'kicked' }); s.ws.close(); }
          this.seats.splice(m.seat, 1);
          this.seats.forEach((x, k) => { if (x.ws) x.ws.seat = k; });
          this.broadcast();
        }
        break;
      case 'start':
        if (this.phase === 'lobby' && isHost) this.start();
        break;
      case 'again':
        if (this.phase === 'ended' && isHost) this.backToLobby();
        break;
      case 'emote':
        if (['😂', '😈', '😭', '👍', '🔥', '🤝'].includes(m.e)) {
          seat.emote = { e: m.e, n: Date.now() };
          this.broadcast();
        }
        break;
      case 'play': case 'draw': case 'pass':
        if (this.phase !== 'playing') throw new GameError('No game running');
        this.applyMove(i, m);
        break;
      default: break;
    }
  }

  applyMove(i, m) {
    const g = this.game;
    let events;
    if (m.t === 'play') events = g.play(i, m.card, { color: m.color, target: m.target });
    else if (m.t === 'draw') events = g.draw(i);
    else events = g.pass(i);
    this.lastEvents = events;
    this.afterAction();
  }

  afterAction() {
    clearTimeout(this.timer);
    const g = this.game;
    if (g.phase === 'ended') {
      this.phase = 'ended';
      this.deadline = 0;
      this.broadcast();
      return;
    }
    const seat = this.seats[g.turn];
    const auto = seat.bot || !seat.connected;
    const delay = auto ? (1100 + Math.random() * 900) / SPEED : TURN_MS;
    this.deadline = Date.now() + delay;
    this.broadcast();
    this.timer = setTimeout(() => this.autoMove(), delay);
  }

  autoMove() {
    const g = this.game;
    if (!g || g.phase !== 'playing') return;
    const i = g.turn;
    try {
      const a = botMove(g, i);
      this.applyMove(i, a);
    } catch (e) {
      // fall back to the safest legal action so the game never stalls
      try { this.applyMove(i, { t: g.drawn ? 'pass' : 'draw' }); } catch (e2) { console.error(e2); }
    }
  }

  onDisconnect(i) {
    const s = this.seats[i];
    if (!s) return;
    s.connected = false;
    s.ws = null;
    if (this.phase === 'lobby') {
      this.seats.splice(i, 1);
      this.seats.forEach((x, k) => { if (x.ws) x.ws.seat = k; });
    } else if (this.phase === 'playing' && this.game.turn === i) {
      this.afterAction(); // bot takes over immediately
      return;
    }
    this.broadcast();
  }
}

// ---- websocket ---------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    try {
      if (m.t === 'join') return join(ws, m);
      const room = ws.room && rooms.get(ws.room);
      if (!room || ws.seat === undefined) return;
      room.handle(ws.seat, m);
    } catch (e) {
      if (e instanceof GameError) ws.send(JSON.stringify({ t: 'error', msg: e.message }));
      else console.error(e);
    }
  });
  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (room && ws.seat !== undefined && room.seats[ws.seat] && room.seats[ws.seat].ws === ws) {
      room.onDisconnect(ws.seat);
    }
  });
});

function join(ws, m) {
  const err = (msg) => ws.send(JSON.stringify({ t: 'error', msg, fatal: true }));
  const name = clean(m.name, 14) || 'Player';
  let room;
  if (m.room) {
    room = rooms.get(String(m.room).toUpperCase());
    if (!room) return err('Room not found. Check your link!');
  } else {
    room = new Room(newCode());
    rooms.set(room.code, room);
  }
  // reconnect with token
  let i = m.token ? room.seats.findIndex((s) => !s.bot && s.token === m.token) : -1;
  if (i >= 0) {
    const s = room.seats[i];
    if (s.ws && s.ws !== ws) { s.ws.seat = undefined; s.ws.close(); }
    s.ws = ws; s.connected = true;
  } else {
    if (room.phase !== 'lobby') return err('That game has already started.');
    if (room.seats.length >= MAX_SEATS) return err('Room is full.');
    const token = crypto.randomUUID();
    let unique = name; let k = 2;
    while (room.seats.some((s) => s.name === unique)) unique = `${name} ${k++}`;
    room.seats.push({ token, name: unique, bot: false, ws, connected: true });
    i = room.seats.length - 1;
  }
  ws.room = room.code;
  ws.seat = i;
  ws.send(JSON.stringify({ t: 'joined', room: room.code, token: room.seats[i].token, seat: i }));
  room.broadcast();
  // if it was this player's (bot-driven) turn, hand control back
  if (room.phase === 'playing' && room.game.turn === i) room.afterAction();
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    const humans = r.seats.some((s) => !s.bot && s.connected);
    if (!humans && now - r.lastActivity > 30 * 60 * 1000) { clearTimeout(r.timer); rooms.delete(code); }
  }
}, 15000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Uno No Mercy running on http://localhost:${PORT}`));
}
module.exports = { server, rooms };
