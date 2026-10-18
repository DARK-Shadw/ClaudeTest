'use strict';
const assert = require('assert');
const { Game, botMove, buildDeck } = require('./game');

const deck = buildDeck();
assert.strictEqual(deck.length, 168, 'deck has 168 cards');

function total(g) {
  return g.deck.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
}

let ended = 0, mercy = 0, empty = 0, maxTurns = 0;
for (let n = 0; n < 400; n++) {
  const count = 2 + (n % 7);
  const g = new Game(Array.from({ length: count }, (_, i) => ({ name: 'B' + i, bot: true })));
  let turns = 0;
  while (g.phase === 'playing' && turns < 5000) {
    const a = botMove(g, g.turn);
    if (a.t === 'play') g.play(g.turn, a.card, { color: a.color, target: a.target });
    else if (a.t === 'draw') g.draw(g.turn);
    else g.pass(g.turn);
    assert.strictEqual(total(g), 168, 'cards conserved');
    for (const p of g.players) assert(p.hand.length < 25 || p.out === false && false, 'no hand over limit');
    assert(!g.players[g.turn].out || g.phase !== 'playing', 'turn on eliminated player');
    turns++;
  }
  assert.strictEqual(g.phase, 'ended', 'game ' + n + ' did not finish');
  ended++; maxTurns = Math.max(maxTurns, turns);
  g.endReason === 'mercy' ? mercy++ : empty++;
}
console.log(`ok: ${ended} games finished (empty-hand wins ${empty}, mercy wins ${mercy}), longest ${maxTurns} actions`);

// targeted rule checks
const g = new Game([{ name: 'a' }, { name: 'b' }, { name: 'c' }], () => 0.5);
const mk = (kind, color, value = null, id = 9000 + Math.floor(Math.random() * 1e6)) => ({ id, color, kind, value });
g.turn = 0; g.dir = 1; g.color = 'red'; g.discard.push(mk('num', 'red', 5));
g.players[0].hand = [mk('draw2', 'red'), mk('num', 'blue', 1)];
g.players[1].hand = [mk('draw4', 'blue'), mk('draw2', 'green'), mk('num', 'red', 3)];
g.players[0].hand.forEach((c, i) => c.id = 1 + i); g.players[1].hand.forEach((c, i) => c.id = 10 + i);
g.play(0, 1);
assert.strictEqual(g.pending, 2); assert.strictEqual(g.turn, 1);
assert(g.canPlay(g.players[1].hand[0]), '+4 stacks on +2');
assert(!g.canPlay(g.players[1].hand[2]), 'number cannot answer a draw');
g.play(1, 10);
assert.strictEqual(g.pending, 6); assert.strictEqual(g.turn, 2);
const before = g.players[2].hand.length;
g.draw(2);
assert.strictEqual(g.players[2].hand.length, before + 6); assert.strictEqual(g.pending, 0);
console.log('rule checks ok');
