'use strict';
// Uno "No Mercy" rules engine (server-authoritative, no I/O).
//
// Deck (168 cards): per colour 0-9 x2, Skip x3, Skip Everyone x2, Reverse x3,
// Draw 2 x2, Draw 4 x2, Discard All x2  + 8 each of Wild Reverse Draw 4,
// Wild Draw 6, Wild Draw 10, Wild Color Roulette.

const COLORS = ['red', 'yellow', 'green', 'blue'];
const MERCY_LIMIT = 25;
const HAND_SIZE = 7;
const DRAW_VALUE = { draw2: 2, draw4: 4, wildrev4: 4, wild6: 6, wild10: 10 };
const WILD_KINDS = ['wildrev4', 'wild6', 'wild10', 'roulette'];

function buildDeck() {
  let id = 0;
  const deck = [];
  const add = (color, kind, value = null) => deck.push({ id: id++, color, kind, value });
  for (const c of COLORS) {
    for (let n = 0; n <= 9; n++) { add(c, 'num', n); add(c, 'num', n); }
    for (let i = 0; i < 3; i++) { add(c, 'skip'); add(c, 'reverse'); }
    for (let i = 0; i < 2; i++) {
      add(c, 'skipall'); add(c, 'draw2'); add(c, 'draw4'); add(c, 'discard');
    }
  }
  for (const k of WILD_KINDS) for (let i = 0; i < 8; i++) add(null, k);
  return deck;
}

function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameError extends Error {}

class Game {
  /** seats: [{ name, bot }] — hands/out state are kept here. */
  constructor(seats, rnd = Math.random) {
    this.rnd = rnd;
    this.players = seats.map((s) => ({ name: s.name, bot: !!s.bot, hand: [], out: false }));
    this.deck = shuffle(buildDeck(), rnd);
    this.discard = [];
    this.dir = 1;
    this.pending = 0;      // accumulated penalty cards
    this.pendingVal = 0;   // value of the last draw card in the stack
    this.drawn = false;    // current player already drew a playable card
    this.phase = 'playing';
    this.winner = null;
    this.endReason = null;
    this.seq = 0;
    this.events = [];

    for (let r = 0; r < HAND_SIZE; r++) for (const p of this.players) p.hand.push(this.deck.pop());
    // first card must be a plain number card
    let first = this.deck.pop();
    const skipped = [];
    while (first.kind !== 'num') { skipped.push(first); first = this.deck.pop(); }
    this.deck.unshift(...skipped);
    this.discard.push(first);
    this.color = first.color;
    this.turn = Math.floor(rnd() * this.players.length);
  }

  get top() { return this.discard[this.discard.length - 1]; }
  activeCount() { return this.players.filter((p) => !p.out).length; }

  step(from, n = 1) {
    const N = this.players.length;
    let i = from;
    for (let k = 0; k < n; k++) {
      let guard = 0;
      do { i = (i + this.dir + N) % N; } while (this.players[i].out && ++guard <= N);
    }
    return i;
  }

  canPlay(card) {
    if (this.pending > 0) {
      const v = DRAW_VALUE[card.kind];
      return v !== undefined && v >= this.pendingVal;
    }
    if (card.color === null) return true;
    if (card.color === this.color) return true;
    const t = this.top;
    return card.kind === t.kind && (card.kind !== 'num' || card.value === t.value);
  }

  playableIds(pi) {
    return this.players[pi].hand.filter((c) => this.canPlay(c)).map((c) => c.id);
  }

  emit(e) { this.events.push(e); }

  // ---- card movement -------------------------------------------------------
  refill() {
    if (this.deck.length > 0 || this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.deck = shuffle(this.discard.splice(0), this.rnd);
    this.discard.push(top);
    this.emit({ t: 'shuffle' });
  }

  drawOne(pi) {
    this.refill();
    const c = this.deck.pop();
    if (c) this.players[pi].hand.push(c);
    return c;
  }

  /** Draw n cards; stops early on mercy. Returns number drawn. */
  give(pi, n) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!this.drawOne(pi)) break;
      got++;
      if (this.players[pi].hand.length >= MERCY_LIMIT) break;
    }
    if (got) this.emit({ t: 'draw', p: pi, n: got });
    return got;
  }

  mercyCheck(pi) {
    const p = this.players[pi];
    if (p.out || p.hand.length < MERCY_LIMIT) return false;
    p.out = true;
    this.deck.push(...p.hand);
    shuffle(this.deck, this.rnd);
    p.hand = [];
    this.emit({ t: 'mercy', p: pi });
    if (this.activeCount() <= 1) {
      this.finish(this.players.findIndex((x) => !x.out), 'mercy');
    }
    return true;
  }

  finish(pi, reason) {
    this.phase = 'ended';
    this.winner = pi;
    this.endReason = reason;
    this.pending = 0;
    this.emit({ t: 'win', p: pi, reason });
  }

  // ---- actions ---------------------------------------------------------------
  /** Runs fn, bumps seq, returns events produced. */
  act(fn) {
    if (this.phase !== 'playing') throw new GameError('Game is over');
    this.events = [];
    fn();
    this.seq++;
    return this.events;
  }

  assertTurn(pi) {
    if (this.phase !== 'playing') throw new GameError('Game is over');
    if (pi !== this.turn) throw new GameError("It's not your turn");
  }

  play(pi, cardId, opts = {}) {
    return this.act(() => {
      this.assertTurn(pi);
      const p = this.players[pi];
      const idx = p.hand.findIndex((c) => c.id === cardId);
      if (idx < 0) throw new GameError('You do not have that card');
      const card = p.hand[idx];
      if (!this.canPlay(card)) throw new GameError("That card can't be played now");
      const wild = card.color === null;
      if (wild && !COLORS.includes(opts.color)) throw new GameError('Pick a colour');
      let target = null;
      if (card.kind === 'num' && card.value === 7) {
        target = opts.target;
        if (!Number.isInteger(target) || target === pi || !this.players[target] || this.players[target].out) {
          throw new GameError('Pick a player to swap hands with');
        }
      }

      p.hand.splice(idx, 1);
      this.discard.push(card);
      this.drawn = false;
      this.color = wild ? opts.color : card.color;
      const ev = { t: 'play', p: pi, card, color: this.color };
      if (target !== null) ev.target = target;
      this.emit(ev);

      if (card.kind === 'discard') {
        const keep = [];
        const dumped = [];
        for (const c of p.hand) (c.color === card.color ? dumped : keep).push(c);
        if (dumped.length) {
          p.hand = keep;
          this.discard.splice(this.discard.length - 1, 0, ...dumped);
          this.emit({ t: 'discardAll', p: pi, n: dumped.length });
        }
      }

      if (p.hand.length === 0) { this.finish(pi, 'empty'); return; }

      let steps = 1;
      switch (card.kind) {
        case 'num':
          if (card.value === 0) this.rotateHands();
          else if (card.value === 7) this.swapHands(pi, target);
          break;
        case 'skip':
          steps = 2;
          this.emit({ t: 'skip', p: this.step(pi, 1) });
          break;
        case 'skipall':
          steps = 0;
          this.emit({ t: 'skipAll', p: pi });
          break;
        case 'reverse':
          this.dir = -this.dir;
          this.emit({ t: 'reverse', dir: this.dir });
          if (this.activeCount() === 2) steps = 0; // acts as a skip with two players
          break;
        case 'draw2': case 'draw4': case 'wildrev4': case 'wild6': case 'wild10':
          if (card.kind === 'wildrev4') {
            this.dir = -this.dir;
            this.emit({ t: 'reverse', dir: this.dir });
          }
          this.pending += DRAW_VALUE[card.kind];
          this.pendingVal = DRAW_VALUE[card.kind];
          break;
        case 'roulette': {
          const victim = this.step(pi, 1);
          const v = this.players[victim];
          let n = 0;
          let found = false;
          while (!found && !v.out) {
            const c = this.drawOne(victim);
            if (!c) break;
            n++;
            if (c.color === this.color) found = true;
            if (v.hand.length >= MERCY_LIMIT) break;
          }
          this.emit({ t: 'roulette', p: victim, color: this.color, n });
          if (n) this.emit({ t: 'draw', p: victim, n });
          this.mercyCheck(victim);
          if (this.phase !== 'playing') return;
          this.emit({ t: 'skip', p: victim });
          steps = 2;
          break;
        }
        default: break;
      }
      if (this.phase !== 'playing') return;
      this.turn = steps === 0 ? pi : this.step(pi, steps);
    });
  }

  draw(pi) {
    return this.act(() => {
      this.assertTurn(pi);
      const p = this.players[pi];
      if (this.pending > 0) {
        const n = this.pending;
        this.pending = 0;
        this.pendingVal = 0;
        this.give(pi, n);
        this.emit({ t: 'penalty', p: pi, n });
        this.mercyCheck(pi);
        if (this.phase === 'playing') this.turn = this.step(pi, 1);
        return;
      }
      if (this.drawn) throw new GameError('Play the card you drew or keep it');
      if (this.playableIds(pi).length) throw new GameError('You have a playable card');
      // draw until something is playable
      let n = 0;
      let found = false;
      while (!found) {
        const c = this.drawOne(pi);
        if (!c) break;
        n++;
        if (this.canPlay(c)) found = true;
        if (p.hand.length >= MERCY_LIMIT) break;
      }
      if (n) this.emit({ t: 'draw', p: pi, n });
      if (this.mercyCheck(pi)) {
        if (this.phase === 'playing') this.turn = this.step(pi, 1);
        return;
      }
      if (found) this.drawn = true;
      else this.turn = this.step(pi, 1);
    });
  }

  /** Keep the card just drawn and end the turn. */
  pass(pi) {
    return this.act(() => {
      this.assertTurn(pi);
      if (!this.drawn) throw new GameError('Draw a card first');
      this.drawn = false;
      this.turn = this.step(pi, 1);
    });
  }

  // ---- 0 / 7 rules -----------------------------------------------------------
  rotateHands() {
    const order = [];
    let i = this.turn;
    do { order.push(i); i = this.step(i, 1); } while (i !== this.turn);
    const hands = order.map((k) => this.players[k].hand);
    order.forEach((k, idx) => { this.players[k].hand = hands[(idx - 1 + order.length) % order.length]; });
    this.emit({ t: 'rotate', dir: this.dir });
  }

  swapHands(a, b) {
    const t = this.players[a].hand;
    this.players[a].hand = this.players[b].hand;
    this.players[b].hand = t;
    this.emit({ t: 'swap', a, b });
  }

  // ---- views -------------------------------------------------------------------
  view(pi) {
    const me = this.players[pi];
    const myTurn = pi === this.turn && this.phase === 'playing';
    return {
      players: this.players.map((p, i) => ({ count: p.hand.length, out: p.out, you: i === pi })),
      hand: me ? me.hand : [],
      playable: myTurn ? this.playableIds(pi) : [],
      canDraw: myTurn && !this.drawn && (this.pending > 0 || this.playableIds(pi).length === 0),
      canPass: myTurn && this.drawn,
      top: this.top,
      color: this.color,
      dir: this.dir,
      pending: this.pending,
      turn: this.turn,
      deck: this.deck.length,
      winner: this.winner,
      endReason: this.endReason,
      mercyLimit: MERCY_LIMIT,
    };
  }
}

// ---- bot AI ------------------------------------------------------------------
function bestColor(hand, exclude) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (c.color && c !== exclude) counts[c.color]++;
  let best = COLORS[Math.floor(Math.random() * 4)];
  let max = 0;
  for (const c of COLORS) if (counts[c] > max) { max = counts[c]; best = c; }
  return best;
}

function botMove(g, pi) {
  const hand = g.players[pi].hand;
  const playable = hand.filter((c) => g.canPlay(c));
  if (!playable.length) return { t: g.drawn ? 'pass' : 'draw' };

  const next = g.step(pi, 1);
  const nextCount = g.players[next].hand.length;
  const avg = g.players.filter((p) => !p.out).reduce((s, p) => s + p.hand.length, 0) / g.activeCount();

  if (g.pending > 0) {
    // Stack if we can; cheapest answer first. Sometimes just eat it when hand is tiny.
    playable.sort((a, b) => DRAW_VALUE[a.kind] - DRAW_VALUE[b.kind]);
    const c = playable[0];
    return { t: 'play', card: c.id, color: bestColor(hand, c) };
  }

  let best = null;
  let bestScore = -Infinity;
  for (const c of playable) {
    let s = Math.random() * 0.6;
    switch (c.kind) {
      case 'num':
        s += 1 + (c.color === g.color ? 0.3 : 0);
        if (c.value === 7) {
          const minOther = Math.min(...g.players.filter((p, i) => !p.out && i !== pi).map((p) => p.hand.length));
          s += hand.length - minOther > 2 ? 4 : -0.5;
        }
        if (c.value === 0) s += hand.length > avg ? 1.5 : -0.5;
        break;
      case 'skip': s += 2.5 + (nextCount <= 3 ? 2 : 0); break;
      case 'reverse': s += 2; break;
      case 'skipall': s += 3.5; break;
      case 'draw2': s += 4 + (nextCount <= 3 ? 2 : 0); break;
      case 'draw4': s += 5 + (nextCount <= 3 ? 2 : 0); break;
      case 'discard': s += 2 + hand.filter((x) => x.color === c.color).length * 1.2; break;
      case 'roulette': s += hand.length <= 4 || nextCount <= 3 ? 5 : 0.4; break;
      default: // wild draws
        s += (hand.length <= 4 || nextCount <= 3 ? 6 : 0.2) + DRAW_VALUE[c.kind] * 0.15;
    }
    if (hand.length <= 2 && c.color === null) s -= 1;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  const out = { t: 'play', card: best.id };
  if (best.color === null) out.color = bestColor(hand, best);
  if (best.kind === 'num' && best.value === 7) {
    let tgt = -1;
    g.players.forEach((p, i) => {
      if (i !== pi && !p.out && (tgt < 0 || p.hand.length < g.players[tgt].hand.length)) tgt = i;
    });
    out.target = tgt;
  }
  return out;
}

module.exports = { Game, GameError, botMove, buildDeck, COLORS, MERCY_LIMIT, DRAW_VALUE };
