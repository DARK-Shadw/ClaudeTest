'use strict';
// Transport-agnostic room: lobby, seats, bots and turn timers around a Game.
// Used by the Node WebSocket server and, unchanged, by the in-browser (artifact) host.
const { Game, GameError, botMove } = require('./game');

const MAX_SEATS = 8;
const BOT_NAMES = ['Bolt', 'Pixel', 'Waffles', 'Zippy', 'Mochi', 'Gizmo', 'Noodle', 'Biscuit', 'Turbo', 'Pickle'];
const TOKEN_RE = /^[\w-]{8,64}$/;

const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const genToken = () => (globalThis.crypto && globalThis.crypto.randomUUID
  ? globalThis.crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2));

class Room {
  /** opts: { speed (bot speed-up, for tests), turnMs (human turn timer) } */
  constructor(code, opts = {}) {
    this.code = code;
    this.speed = opts.speed || 1;
    this.turnMs = opts.turnMs || 45000;
    this.seats = [];       // { token, name, bot, send, kick, connected, emote }
    this.game = null;
    this.phase = 'lobby';  // lobby | playing | ended
    this.timer = null;
    this.deadline = 0;
    this.lastEvents = [];
    this.lastActivity = Date.now();
  }

  indexOf(token) { return this.seats.findIndex((s) => s.token === token); }
  hostIndex() { return this.seats.findIndex((s) => !s.bot); }
  hasHumans() { return this.seats.some((s) => !s.bot && s.connected); }
  destroy() { clearTimeout(this.timer); }

  addBot() {
    if (this.seats.length >= MAX_SEATS) return;
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + this.seats.length;
    this.seats.push({ token: genToken(), name, bot: true, send: null, kick: null, connected: true });
  }

  /**
   * Seat a player (or re-attach one by token). `send(msg)` delivers to them; `kick()` drops them.
   * Throws GameError (fatal for the joiner) when they can't be seated.
   */
  join(name, token, send, kick) {
    let i = token ? this.seats.findIndex((s) => !s.bot && s.token === token) : -1;
    if (i >= 0) {
      const s = this.seats[i];
      if (s.kick && s.send !== send) s.kick();
      s.send = send; s.kick = kick; s.connected = true;
    } else {
      if (this.phase !== 'lobby') throw new GameError('That game has already started.');
      if (this.seats.length >= MAX_SEATS) throw new GameError('Room is full.');
      const base = clean(name, 14) || 'Player';
      let unique = base; let k = 2;
      while (this.seats.some((s) => s.name === unique)) unique = `${base} ${k++}`;
      const tok = token && TOKEN_RE.test(token) && this.indexOf(token) < 0 ? token : genToken();
      this.seats.push({ token: tok, name: unique, bot: false, send, kick, connected: true });
      i = this.seats.length - 1;
    }
    const s = this.seats[i];
    s.send && s.send({ t: 'joined', room: this.code, token: s.token, seat: i });
    this.broadcast();
    // if it was this player's (bot-driven) turn, hand control back
    if (this.phase === 'playing' && this.game.turn === i) this.afterAction();
    return s.token;
  }

  /** The player's connection ended. `send` guards against a stale connection. */
  disconnect(token, send) {
    const i = this.indexOf(token);
    if (i < 0) return;
    const s = this.seats[i];
    if (send && s.send !== send) return;
    s.connected = false;
    s.send = null;
    s.kick = null;
    if (this.phase === 'lobby') {
      this.seats.splice(i, 1);
    } else if (this.phase === 'playing' && this.game.turn === i) {
      this.afterAction(); // a bot takes over immediately
      return;
    }
    this.broadcast();
  }

  broadcast() {
    this.lastActivity = Date.now();
    this.seats.forEach((s, i) => { if (s.send) s.send(this.stateFor(i)); });
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

  /** Handle a client message from the seat holding `token`. Never throws. */
  handle(token, m) {
    const i = this.indexOf(token);
    if (i < 0 || !m || typeof m !== 'object') return;
    try {
      this.dispatch(i, m);
    } catch (e) {
      if (e instanceof GameError) { const s = this.seats[i]; if (s && s.send) s.send({ t: 'error', msg: e.message }); }
      else console.error(e);
    }
  }

  dispatch(i, m) {
    const seat = this.seats[i];
    const isHost = i === this.hostIndex();
    switch (m.t) {
      case 'addBot': if (this.phase === 'lobby' && isHost) { this.addBot(); this.broadcast(); } break;
      case 'removeBot':
        if (this.phase === 'lobby' && isHost && this.seats[m.seat] && m.seat !== i) {
          const s = this.seats[m.seat];
          if (!s.bot && s.send) { s.send({ t: 'kicked' }); if (s.kick) s.kick(); }
          this.seats.splice(m.seat, 1);
          this.broadcast();
        }
        break;
      case 'start': if (this.phase === 'lobby' && isHost) this.start(); break;
      case 'again': if (this.phase === 'ended' && isHost) this.backToLobby(); break;
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
    const delay = auto ? (1100 + Math.random() * 900) / this.speed : this.turnMs;
    this.deadline = Date.now() + delay;
    this.broadcast();
    this.timer = setTimeout(() => this.autoMove(), delay);
  }

  autoMove() {
    const g = this.game;
    if (!g || g.phase !== 'playing') return;
    const i = g.turn;
    try {
      this.applyMove(i, botMove(g, i));
    } catch (e) {
      // fall back to the safest legal action so the game never stalls
      try { this.applyMove(i, { t: g.drawn ? 'pass' : 'draw' }); } catch (e2) { console.error(e2); }
    }
  }
}

module.exports = { Room, GameError, MAX_SEATS };
