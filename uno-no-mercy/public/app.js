'use strict';
/* Uno No Mercy — client. Server is authoritative; this file renders state + animates events. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INK = '#22123a';
const COLOR_HEX = { red: '#ff5a5f', yellow: '#ffc933', green: '#35d07f', blue: '#3b8cff' };
const COLOR_ORDER = ['red', 'yellow', 'green', 'blue'];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const coarse = matchMedia('(pointer: coarse)').matches;

const S = {
  gen: 0, room: null, token: null, you: -1, joined: false, leaving: false,
  cur: null, lastSeq: -1, tableBuilt: false, queue: Promise.resolve(), backlog: 0,
  busy: false, selected: null, muted: store.get('unm:muted') === '1', emoteSeen: {}, timerKey: '',
  pile: [], avatarKey: {},
};

/* ======================================================================== *
 *  Sound (tiny WebAudio synth, no assets)
 * ======================================================================== */
let actx = null;
function tone(freq, dur = 0.12, type = 'square', vol = 0.06, when = 0, slide = 0) {
  if (S.muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when;
    const o = actx.createOscillator(); const g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* audio unavailable */ }
}
const sfx = {
  play: () => { tone(520, 0.07, 'triangle', 0.08, 0, 300); },
  draw: () => { tone(300, 0.06, 'sawtooth', 0.03, 0, -120); },
  skip: () => { tone(400, 0.12, 'square', 0.05, 0, -250); },
  rev: () => { tone(300, 0.1, 'triangle', 0.07); tone(500, 0.1, 'triangle', 0.07, 0.09); },
  hit: () => { tone(160, 0.25, 'sawtooth', 0.08, 0, -90); tone(110, 0.3, 'square', 0.05, 0.05, -50); },
  mercy: () => { [440, 370, 311, 220].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.07, i * 0.14)); },
  turn: () => { tone(880, 0.1, 'sine', 0.07); tone(1320, 0.14, 'sine', 0.06, 0.09); },
  win: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, i * 0.12)); },
  nope: () => { tone(140, 0.12, 'square', 0.05); },
  pop: () => { tone(700, 0.05, 'sine', 0.05, 0, 400); },
};

/* ======================================================================== *
 *  Cartoon avatars
 * ======================================================================== */
const SKINS = ['#ff8fab', '#ffd166', '#7bdff2', '#b8f28b', '#c3a6ff', '#ffa94d', '#8ce99a', '#74c0fc'];
function avatar(i, mood = 'happy') {
  const skin = SKINS[i % SKINS.length];
  const acc = [
    `<circle cx="22" cy="24" r="12" fill="${skin}" stroke="${INK}" stroke-width="5"/><circle cx="78" cy="24" r="12" fill="${skin}" stroke="${INK}" stroke-width="5"/>`,
    `<path d="M50 14V2" stroke="${INK}" stroke-width="5"/><circle cx="50" cy="4" r="6" fill="#ff5a5f" stroke="${INK}" stroke-width="4"/>`,
    `<path d="M24 26L18 6L38 18Z M76 26L82 6L62 18Z" fill="#ff5a5f" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
    `<path d="M22 28Q50 -8 78 28Z" fill="#3b8cff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><circle cx="50" cy="6" r="6" fill="#fff" stroke="${INK}" stroke-width="4"/>`,
    `<path d="M26 22L32 4L44 16L50 0L56 16L68 4L74 22Z" fill="#ffc933" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
    `<path d="M30 20Q50 -6 70 20" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M30 18l-8 8M70 18l8 8" stroke="${INK}" stroke-width="5"/>`,
    `<path d="M50 14Q40 -4 56 -2Q46 6 56 14Z" fill="#35d07f" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
    `<rect x="16" y="14" width="68" height="14" rx="7" fill="#ff6fb5" stroke="${INK}" stroke-width="5"/>`,
  ][i % 8];
  let eyes; let mouth;
  if (mood === 'dead') {
    eyes = `<path d="M30 38l14 14M44 38L30 52M56 38l14 14M70 38L56 52" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
    mouth = `<path d="M36 74Q50 64 64 74" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  } else {
    const worried = mood === 'worried';
    eyes = `<ellipse cx="36" cy="46" rx="10" ry="${worried ? 13 : 11}" fill="#fff" stroke="${INK}" stroke-width="4"/><ellipse cx="64" cy="46" rx="10" ry="${worried ? 13 : 11}" fill="#fff" stroke="${INK}" stroke-width="4"/>` +
      `<circle cx="${worried ? 38 : 39}" cy="48" r="5" fill="${INK}"><animate attributeName="cy" values="48;48;48;48;48;48;56;48" dur="${4 + (i % 3)}s" repeatCount="indefinite"/></circle><circle cx="${worried ? 62 : 61}" cy="48" r="5" fill="${INK}"/>` +
      (worried ? `<path d="M24 30L44 36M76 30L56 36" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` : '');
    mouth = worried
      ? `<path d="M36 74Q43 66 50 74T64 74" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M84 40q-6 10 0 14q6-4 0-14Z" fill="#7bdff2" stroke="${INK}" stroke-width="2"/>`
      : `<path d="M32 66Q50 88 68 66Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
  }
  return `<svg viewBox="-6 -8 112 112" class="avsvg">${acc}<circle cx="50" cy="56" r="40" fill="${skin}" stroke="${INK}" stroke-width="6"/>` +
    `<ellipse cx="30" cy="70" rx="7" ry="4" fill="#ff6f91" opacity=".5"/><ellipse cx="70" cy="70" rx="7" ry="4" fill="#ff6f91" opacity=".5"/>${eyes}${mouth}</svg>`;
}

/* ======================================================================== *
 *  Cards
 * ======================================================================== */
const ico = (shape, w) =>
  `<svg viewBox="0 0 100 100"><g stroke="${INK}" stroke-width="${w + 12}" fill="${INK}" stroke-linejoin="round" stroke-linecap="round">${shape}</g>` +
  `<g stroke="currentColor" stroke-width="${w}" fill="currentColor" stroke-linejoin="round" stroke-linecap="round">${shape}</g></svg>`;
const SHAPES = {
  skip: [`<circle cx="50" cy="50" r="31" fill="none"/><path d="M28 72L72 28" fill="none"/>`, 14],
  skipall: [`<circle cx="32" cy="50" r="19" fill="none"/><path d="M19 63L45 37" fill="none"/><circle cx="68" cy="50" r="19" fill="none"/><path d="M55 63L81 37" fill="none"/>`, 9],
  reverse: [`<path d="M14 34H62" fill="none"/><polygon points="60,16 90,34 60,52"/><path d="M86 66H38" fill="none"/><polygon points="40,48 10,66 40,84"/>`, 9],
  discard: [`<rect x="22" y="14" width="38" height="54" rx="7" fill="none" transform="rotate(-14 41 41)"/><rect x="40" y="22" width="38" height="54" rx="7" fill="none" transform="rotate(14 59 49)"/><path d="M50 80V92" fill="none"/><polygon points="38,84 50,98 62,84"/>`, 7],
};
const rouletteSVG = `<svg viewBox="0 0 100 100" style="color:#fff"><g stroke="${INK}" stroke-width="7" stroke-linejoin="round">` +
  `<path d="M50 50L50 12A38 38 0 0 1 88 50Z" fill="#ff5a5f"/><path d="M50 50L88 50A38 38 0 0 1 50 88Z" fill="#3b8cff"/>` +
  `<path d="M50 50L50 88A38 38 0 0 1 12 50Z" fill="#35d07f"/><path d="M50 50L12 50A38 38 0 0 1 50 12Z" fill="#ffc933"/>` +
  `<circle cx="50" cy="50" r="9" fill="#fff"/></g></svg>`;
const icon = (k) => ico(SHAPES[k][0], SHAPES[k][1]);

const CARD_LABEL = { skip: 'Skip', skipall: 'Skip Everyone', reverse: 'Reverse', draw2: '+2', draw4: '+4', discard: 'Discard All',
  wildrev4: 'Wild Reverse +4', wild6: 'Wild +6', wild10: 'Wild +10', roulette: 'Color Roulette' };
const cardName = (c) => (c.kind === 'num' ? `${c.color} ${c.value}` : `${c.color ? c.color + ' ' : ''}${CARD_LABEL[c.kind]}`);

function symbolHTML(c) {
  switch (c.kind) {
    case 'num': return `<div class="sym">${c.value}</div>`;
    case 'draw2': return `<div class="sym">+2</div>`;
    case 'draw4': return `<div class="sym">+4</div>`;
    case 'wild6': return `<div class="sym">+6</div>`;
    case 'wild10': return `<div class="sym sm">+10</div>`;
    case 'wildrev4': return `<div class="sym sm" style="flex-direction:column;gap:0"><span class="rv">${icon('reverse')}</span><span>+4</span></div>`;
    case 'roulette': return `<div class="sym">${rouletteSVG}</div>`;
    default: return `<div class="sym" style="color:var(--c)">${icon(c.kind)}</div>`;
  }
}
function cornerHTML(c) {
  const t = { num: String(c.value), draw2: '+2', draw4: '+4', wild6: '+6', wild10: '+10', wildrev4: '+4' }[c.kind];
  const inner = t !== undefined ? t : c.kind === 'roulette' ? rouletteSVG : icon(c.kind);
  const style = c.kind === 'wild10' ? 'font-size:1.45em' : '';
  return `<span class="cn tl" style="${style}">${inner}</span><span class="cn br" style="${style}">${inner}</span>`;
}
function cardEl(c) {
  const d = document.createElement('div');
  d.className = `card ${c.color || 'wild'} ${c.kind}`;
  d.dataset.id = c.id;
  d.innerHTML = `<div class="face"><div class="oval"></div>${symbolHTML(c)}</div>${cornerHTML(c)}`;
  return d;
}
function backEl() {
  const d = document.createElement('div');
  d.className = 'card back';
  d.innerHTML = `<div class="face"><div class="oval"></div><div class="bt">NO<br>MERCY</div></div>`;
  return d;
}

/* ======================================================================== *
 *  Screens + networking
 * ======================================================================== */
function show(id) {
  for (const s of $$('.screen')) s.classList.toggle('hidden', s.id !== id);
}
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
const tokenKey = (r) => `unm:token:${r}`;
const inviteLink = (r) => Net.inviteLink(r);

function connect(roomCode) {
  S.leaving = false;
  const gen = ++S.gen;
  const name = $('#nameInput').value.trim();
  if (name) store.set('unm:name', name);
  Net.open(
    { room: roomCode || null, name: name || store.get('unm:name') || 'Player', token: roomCode ? store.get(tokenKey(roomCode)) : null },
    {
      message: (m) => { if (gen === S.gen) onMessage(m); },
      closed: () => {
        if (gen !== S.gen || S.leaving) return;
        if (S.joined) {
          toast('Connection lost — reconnecting…', 3000);
          setTimeout(() => { if (!S.leaving) connect(S.room); }, 1500);
        } else {
          $('#homeErr').textContent = 'Could not reach the server.';
        }
      },
    },
  );
}
const send = (m) => Net.send(m);

function onMessage(m) {
  if (m.t === 'joined') {
    S.joined = true; S.room = m.room; S.token = m.token;
    store.set(tokenKey(m.room), m.token);
    Net.setRoom(m.room);
  } else if (m.t === 'state') {
    S.you = m.you;
    S.backlog++;
    S.queue = S.queue.then(() => applyState(m)).catch((e) => console.error(e)).then(() => { S.backlog--; });
  } else if (m.t === 'error') {
    S.busy = false;
    if (m.fatal) {
      S.joined = false; S.leaving = true; Net.close();
      show('home'); $('#homeErr').textContent = m.msg;
      if (/not found/i.test(m.msg)) Net.setRoom(null);
      setupHome();
    } else { toast(m.msg); sfx.nope(); }
  } else if (m.t === 'notice') {
    toast(m.msg, 5000);
  } else if (m.t === 'kicked') {
    leave('You were removed from the room.');
  }
}

function leave(msg) {
  S.leaving = true; S.joined = false; S.gen++;
  if (S.room) store.del(tokenKey(S.room));
  Net.close();
  S.room = null; S.tableBuilt = false; S.cur = null;
  Net.setRoom(null);
  show('home');
  $('#winOverlay').classList.add('hidden');
  $('#homeErr').textContent = msg || '';
  setupHome();
}

/* ---------------- home ---------------- */
function setupHome() {
  $('#nameInput').value = store.get('unm:name') || '';
  const roomParam = Net.initialRoom();
  const hasRoom = roomParam.length === 4 && !S.room;
  $('#createBtn').classList.toggle('hidden', !!hasRoom);
  $('#orRow').classList.toggle('hidden', !!hasRoom);
  $('#joinRow').classList.toggle('hidden', !!hasRoom);
  $('#joinBtn').classList.toggle('hidden', !hasRoom);
  $('#joinNote').classList.toggle('hidden', !hasRoom);
  if (hasRoom) $('#joinNote').innerHTML = `You're invited to room <b>${roomParam}</b>`;
}
$('#createBtn').onclick = () => { sfx.pop(); connect(null); };
$('#joinBtn').onclick = () => { sfx.pop(); connect(Net.initialRoom()); };
$('#codeBtn').onclick = () => {
  const c = $('#codeInput').value.toUpperCase().replace(/[^A-Z]/g, '');
  if (c.length !== 4) { $('#homeErr').textContent = 'Room codes have 4 letters.'; return; }
  connect(c);
};
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#codeBtn').click(); });
$('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('#joinBtn').classList.contains('hidden') ? $('#createBtn') : $('#joinBtn')).click(); });
$$('[data-rules]').forEach((b) => (b.onclick = () => $('#rules').classList.remove('hidden')));
$('#rules [data-close]').onclick = () => $('#rules').classList.add('hidden');
$('#rules').onclick = (e) => { if (e.target.id === 'rules') $('#rules').classList.add('hidden'); };

/* ---------------- lobby ---------------- */
function renderLobby(st) {
  show('lobby');
  $('#lobbyCode').textContent = st.room;
  $('#shareLink').value = inviteLink(st.room);
  const host = st.you === st.host;
  const ul = $('#seatList');
  ul.innerHTML = '';
  st.seats.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `${avatar(i)}<span class="nm">${esc(s.name)}${i === st.host ? '<span class="tag host">HOST</span>' : ''}${s.bot ? '<span class="tag">BOT</span>' : ''}${i === st.you ? '<span class="tag">YOU</span>' : ''}</span>`;
    if (host && i !== st.you) {
      const x = document.createElement('button');
      x.className = 'x'; x.textContent = '✕'; x.title = 'Remove';
      x.onclick = () => send({ t: 'removeBot', seat: i });
      li.appendChild(x);
    }
    ul.appendChild(li);
  });
  $('#addBotBtn').classList.toggle('hidden', !host);
  $('#addBotBtn').disabled = st.seats.length >= 8;
  $('#startBtn').classList.toggle('hidden', !host);
  $('#startBtn').disabled = st.seats.length < 2;
  $('#lobbyHint').textContent = host
    ? (st.seats.length < 2 ? 'Share the link with friends — or add a bot to play solo!' : `${st.seats.length} players ready. Up to 8 can join.`)
    : 'Waiting for the host to start the game…';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function copyInvite() {
  const link = Net.inviteText ? Net.inviteText(S.room) : inviteLink(S.room);
  try {
    if (navigator.share && coarse) await navigator.share({ title: 'Uno No Mercy', text: 'Join my Uno No Mercy game!', url: link });
    else { await navigator.clipboard.writeText(link); toast('Invite link copied! 🎉'); }
  } catch {
    $('#shareLink').select();
    try { document.execCommand('copy'); toast('Invite link copied! 🎉'); } catch { toast(link, 5000); }
  }
}
$('#copyBtn').onclick = copyInvite;
$('#roomChip').onclick = copyInvite;
$('#addBotBtn').onclick = () => { sfx.pop(); send({ t: 'addBot' }); };
$('#startBtn').onclick = () => send({ t: 'start' });
$('#againBtn').onclick = () => send({ t: 'again' });
$('#leaveBtn').onclick = () => leave();
$('#muteBtn').onclick = () => {
  S.muted = !S.muted; store.set('unm:muted', S.muted ? '1' : '0');
  $('#muteBtn').textContent = S.muted ? '🔇' : '🔊';
};
$('#muteBtn').textContent = S.muted ? '🔇' : '🔊';

/* ======================================================================== *
 *  Table
 * ======================================================================== */
const seatEl = (i) => (i === S.you ? $('#mePanel') : $(`.opp[data-seat="${i}"]`));
const rectOf = (el) => (el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 40, height: 40 });
const centerOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const pileW = () => $('#discard').offsetWidth || 100;

function panelHTML() {
  return `<div class="av"></div><div class="who"><div class="nm"></div><div class="cnt"><b>7</b><span>/25</span></div><div class="meter"><i></i></div></div><div class="timer"><i></i></div>`;
}

function buildTable(st) {
  const opps = $('#opps');
  opps.innerHTML = '';
  const N = st.seats.length;
  for (let k = 1; k < N; k++) {
    const i = (st.you + k) % N;
    const d = document.createElement('div');
    d.className = 'opp'; d.dataset.seat = i; d.innerHTML = panelHTML();
    opps.appendChild(d);
  }
  const me = $('#mePanel');
  me.innerHTML = panelHTML();
  me.className = 'me-panel';
  $('#hand').innerHTML = '';
  $('#discard').innerHTML = '';
  $('#log').innerHTML = '';
  S.pile = []; S.avatarKey = {}; S.emoteSeen = {}; S.timerKey = '';
  $('#roomCode').textContent = st.room;
  const ds = $('.deck-stack');
  ds.innerHTML = '';
  for (let i = 0; i < 3; i++) ds.appendChild(backEl());
  const em = $('#emotes');
  em.innerHTML = '';
  ['😂', '😈', '😭', '👍', '🔥', '🤝'].forEach((e) => {
    const b = document.createElement('button');
    b.textContent = e; b.onclick = () => send({ t: 'emote', e });
    em.appendChild(b);
  });
  S.tableBuilt = true;
  S.selected = null;
}

function sortHand(h) {
  const kw = { num: 0, skip: 1, skipall: 2, reverse: 3, draw2: 4, draw4: 5, discard: 6, wildrev4: 7, wild6: 8, wild10: 9, roulette: 10 };
  return [...h].sort((a, b) => {
    const ca = a.color ? COLOR_ORDER.indexOf(a.color) : 9; const cb = b.color ? COLOR_ORDER.indexOf(b.color) : 9;
    return ca - cb || kw[a.kind] - kw[b.kind] || (a.value || 0) - (b.value || 0) || a.id - b.id;
  });
}

function layoutHand() {
  const hand = $('#hand');
  const slots = [...hand.children].filter((s) => !s.classList.contains('leaving'));
  const n = slots.length;
  if (!n) return;
  const W = hand.clientWidth; const cw = slots[0].offsetWidth;
  const step = n > 1 ? Math.min(cw * 1.1, (W - cw) / (n - 1)) : 0;
  const total = step * (n - 1) + cw; const start = (W - total) / 2;
  const mid = (n - 1) / 2;
  slots.forEach((s, i) => {
    const off = i - mid;
    s.style.left = `${start + i * step}px`;
    s.style.zIndex = i;
    s.style.setProperty('--rot', `${off * Math.min(3.4, 30 / n)}deg`);
    s.style.setProperty('--ty', `${Math.min(off * off * 0.9, 24)}px`);
    s.style.setProperty('--i', i);
  });
}
addEventListener('resize', layoutHand);

function renderHand(g, st, first) {
  const hand = $('#hand');
  const myTurn = g.turn === st.you && st.phase === 'playing';
  hand.classList.toggle('myturn', myTurn);
  const have = new Map($$('.slot', hand).map((s) => [Number(s.dataset.id), s]));
  const want = sortHand(g.hand);
  const ids = new Set(want.map((c) => c.id));
  for (const [id, s] of have) if (!ids.has(id)) s.remove();
  want.forEach((c, i) => {
    let s = have.get(c.id);
    if (!s) {
      s = document.createElement('div');
      s.className = 'slot enter'; s.dataset.id = c.id;
      s.style.setProperty('--d', `${first ? i * 0.07 : 0}s`);
      s.appendChild(cardEl(c));
      s.onanimationend = (e) => { if (e.animationName === 'dealIn') s.classList.remove('enter'); };
      s.onclick = () => onCardClick(c.id);
      if (first) sfx.draw();
    }
    const ok = g.playable.includes(c.id);
    s.classList.toggle('ok', ok);
    s.classList.toggle('dim', myTurn && !ok);
    s.classList.toggle('sel', S.selected === c.id && ok);
    s._card = c;
    hand.appendChild(s);
  });
  layoutHand();
}

function onCardClick(id) {
  const st = S.cur; if (!st) return;
  const g = st.game;
  const slot = $(`.slot[data-id="${id}"]`);
  if (st.phase !== 'playing') return;
  if (g.turn !== st.you) { slotNope(slot); toast("Not your turn yet!"); return; }
  if (!g.playable.includes(id)) {
    slotNope(slot);
    toast(g.pending ? `Stack a +${g.pending}-or-higher draw card, or take the cards!` : g.canPass ? 'Play the card you drew, or keep it' : "That card doesn't match!");
    return;
  }
  if (coarse && S.selected !== id) { S.selected = id; $$('.slot').forEach((s) => s.classList.toggle('sel', Number(s.dataset.id) === id)); sfx.pop(); return; }
  if (S.busy) return;
  const c = slot._card;
  const go = (extra) => { S.busy = true; S.selected = null; send({ t: 'play', card: id, ...extra }); setTimeout(() => { S.busy = false; }, 2500); };
  if (c.color === null) pickColor((color) => go({ color }));
  else if (c.kind === 'num' && c.value === 7) pickTarget(st, (target) => go({ target }));
  else go({});
}
function slotNope(s) { if (!s) return; sfx.nope(); s.classList.remove('nope'); void s.offsetWidth; s.classList.add('nope'); }

function pickColor(cb) {
  const ov = $('#colorPick'); ov.classList.remove('hidden');
  const close = () => { ov.classList.add('hidden'); };
  $$('[data-color]', ov).forEach((b) => (b.onclick = () => { close(); cb(b.dataset.color); }));
  $('[data-cancel]', ov).onclick = close;
}
function pickTarget(st, cb) {
  const ov = $('#targetPick'); ov.classList.remove('hidden');
  const list = $('#targetList'); list.innerHTML = '';
  st.game.players.forEach((p, i) => {
    if (i === st.you || p.out) return;
    const b = document.createElement('button');
    b.innerHTML = `${avatar(i)}<span>${esc(st.seats[i].name)}</span><span class="c">${p.count} cards</span>`;
    b.onclick = () => { ov.classList.add('hidden'); cb(i); };
    list.appendChild(b);
  });
  $('[data-cancel]', ov).onclick = () => ov.classList.add('hidden');
}

$('#drawBtn').onclick = () => doDraw();
$('#deck').onclick = () => doDraw();
function doDraw() {
  const st = S.cur; if (!st || st.phase !== 'playing') return;
  const g = st.game;
  if (g.turn !== st.you) { toast("Not your turn yet!"); sfx.nope(); return; }
  if (!g.canDraw) { toast(g.canPass ? 'Play it or keep it' : 'You have a playable card!'); sfx.nope(); return; }
  if (S.busy) return;
  S.busy = true; setTimeout(() => { S.busy = false; }, 2000);
  send({ t: 'draw' });
}
$('#keepBtn').onclick = () => { if (!S.busy) { S.busy = true; setTimeout(() => { S.busy = false; }, 1500); send({ t: 'pass' }); } };
document.addEventListener('click', (e) => { if (!e.target.closest('.slot') && S.selected !== null) { S.selected = null; $$('.slot.sel').forEach((s) => s.classList.remove('sel')); } });

/* ---------------- discard pile ---------------- */
function pushDiscard(c, instant) {
  const d = $('#discard');
  const el = cardEl(c);
  const rot = (Math.random() - 0.5) * 36; const dx = (Math.random() - 0.5) * 14; const dy = (Math.random() - 0.5) * 14;
  el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
  el.style.setProperty('--w', `${pileW()}px`);
  d.appendChild(el);
  while (d.children.length > 5) d.firstChild.remove();
  if (!instant) el.animate([{ scale: 1.12 }, { scale: 1 }], { duration: 220, easing: 'ease-out' });
}
function syncDiscard(top) {
  const d = $('#discard');
  const last = d.lastElementChild;
  if (!last || Number(last.dataset.id) !== top.id) { d.innerHTML = ''; pushDiscard(top, true); }
}

/* ---------------- flying cards ---------------- */
function fly(node, from, to, opt = {}) {
  const { dur = 420, delay = 0, s0 = 1, s1 = 1, r0 = 0, r1 = 0, fade = false } = opt;
  const w = pileW();
  node.style.setProperty('--w', `${w}px`);
  node.classList.add('fly');
  document.body.appendChild(node);
  const h = node.offsetHeight || w * 1.5;
  const f = centerOf(from); const t = centerOf(to);
  const kf = [
    { transform: `translate(${f.x - w / 2}px, ${f.y - h / 2}px) rotate(${r0}deg) scale(${s0})`, opacity: 1 },
    { transform: `translate(${t.x - w / 2}px, ${t.y - h / 2}px) rotate(${r1}deg) scale(${s1})`, opacity: fade ? 0.2 : 1 },
  ];
  const a = node.animate(kf, { duration: dur, delay, easing: 'cubic-bezier(.35,.85,.4,1.05)', fill: 'both' });
  return a.finished.then(() => node.remove()).catch(() => node.remove());
}

function callout(text, color = '#fff') {
  const c = $('#callout');
  c.textContent = text; c.style.color = color;
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
}
function stamp(seat, text, bg) {
  const el = seatEl(seat); if (!el) return;
  const s = document.createElement('div');
  s.className = 'stamp'; s.textContent = text; if (bg) s.style.background = bg;
  el.appendChild(s); setTimeout(() => s.remove(), 1200);
}
function addLog(text) {
  const log = $('#log');
  $$('div', log).forEach((d) => d.classList.add('old'));
  const d = document.createElement('div'); d.innerHTML = text; log.appendChild(d);
  while (log.children.length > 4) log.firstChild.remove();
  setTimeout(() => d.remove(), 9000);
}
const nameOf = (st, i) => `<b>${esc(st.seats[i].name)}</b>`;

const CALLOUTS = {
  skip: ['SKIP!', '#ffc933', 'skip'], skipall: ['SKIP EVERYONE!', '#ff6fb5', 'skip'], reverse: ['REVERSE!', '#3b8cff', 'rev'],
  draw2: ['+2', '#ff5a5f', 'hit'], draw4: ['+4', '#ff5a5f', 'hit'], wild6: ['+6', '#ff5a5f', 'hit'], wild10: ['+10!!', '#ff5a5f', 'hit'],
  wildrev4: ['REVERSE +4', '#ff5a5f', 'hit'], discard: ['DISCARD ALL!', '#35d07f', 'play'], roulette: ['ROULETTE!', '#ffc933', 'hit'],
};

async function playEvent(ev, st) {
  switch (ev.t) {
    case 'play': {
      const mine = ev.p === st.you;
      let from;
      if (mine) {
        const slot = $(`.slot[data-id="${ev.card.id}"]`);
        from = rectOf(slot || $('#hand'));
        if (slot) slot.classList.add('flying');
      } else {
        from = rectOf(seatEl(ev.p));
      }
      const node = cardEl(ev.card);
      const toEl = $('#discard');
      const sw = mine ? from.width / pileW() : 0.45;
      sfx.play();
      await fly(node, from, rectOf(toEl), { dur: 430, s0: sw, r0: mine ? 0 : -20, r1: (Math.random() - 0.5) * 30 });
      pushDiscard(ev.card);
      if (!mine) { const sl = seatEl(ev.p); sl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 250 }); }
      addLog(`${nameOf(st, ev.p)} played <span style="color:${COLOR_HEX[ev.card.color || ev.color]}">${cardName(ev.card)}</span>${ev.card.color === null ? ` → ${ev.color}` : ''}`);
      const k = ev.card.kind;
      const co = k === 'num' ? (ev.card.value === 7 ? ['SWAP!', '#c3a6ff', 'rev'] : ev.card.value === 0 ? ['ROTATE!', '#c3a6ff', 'rev'] : null) : CALLOUTS[k];
      if (co) { callout(co[0], co[1]); sfx[co[2]](); }
      $('#discard').dataset.color = ev.color;
      break;
    }
    case 'draw': {
      const deck = rectOf($('#deck'));
      const to = rectOf(seatEl(ev.p));
      const mine = ev.p === st.you;
      const n = Math.min(ev.n, 8);
      const tgt = mine ? rectOf($('#hand')) : to;
      const ps = [];
      for (let i = 0; i < n; i++) {
        ps.push(fly(backEl(), deck, tgt, { dur: 380, delay: i * 70, s0: 1, s1: mine ? 0.9 : 0.35, r1: mine ? (i - n / 2) * 6 : 0, fade: !mine }));
        setTimeout(sfx.draw, i * 70);
      }
      await Promise.all(ps);
      if (!mine) { seatEl(ev.p).animate([{ transform: 'translateY(0)' }, { transform: 'translateY(6px) scale(1.06)' }, { transform: 'translateY(0)' }], { duration: 250 }); }
      addLog(`${nameOf(st, ev.p)} drew ${ev.n} card${ev.n > 1 ? 's' : ''}`);
      break;
    }
    case 'penalty': callout(`+${ev.n} 😵`, '#ff5a5f'); break;
    case 'skip': stamp(ev.p, 'SKIPPED!', '#ffc933'); break;
    case 'skipAll': break;
    case 'reverse': {
      const r = $('#dirRing');
      r.classList.toggle('cw', ev.dir === 1); r.classList.toggle('ccw', ev.dir !== 1);
      r.classList.remove('flip'); void r.getBoundingClientRect(); r.classList.add('flip');
      break;
    }
    case 'discardAll': addLog(`${nameOf(st, ev.p)} dumped ${ev.n} extra card${ev.n > 1 ? 's' : ''}`); await sleep(250); break;
    case 'roulette': {
      callout(`${ev.color.toUpperCase()}!`, COLOR_HEX[ev.color]);
      await sleep(450);
      addLog(`${nameOf(st, ev.p)} drew ${ev.n} hunting for ${ev.color}`);
      break;
    }
    case 'rotate': {
      callout('HANDS ROTATE!', '#c3a6ff');
      $$('.opp, .me-panel').forEach((p, i) => p.animate([{ transform: 'rotate(0)' }, { transform: `rotate(${i % 2 ? 8 : -8}deg) scale(1.08)` }, { transform: 'rotate(0)' }], { duration: 500 }));
      addLog('Everyone passed their hand!');
      await sleep(550);
      break;
    }
    case 'swap': {
      callout('SWAP!', '#c3a6ff');
      const a = rectOf(seatEl(ev.a)); const b = rectOf(seatEl(ev.b));
      await Promise.all([fly(backEl(), a, b, { dur: 520, s0: 0.4, s1: 0.4 }), fly(backEl(), b, a, { dur: 520, s0: 0.4, s1: 0.4 })]);
      addLog(`${nameOf(st, ev.a)} swapped hands with ${nameOf(st, ev.b)}`);
      break;
    }
    case 'mercy': {
      const el = seatEl(ev.p);
      el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 600);
      stamp(ev.p, '💀 MERCY!', '#22123a');
      callout('NO MERCY!', '#ff5a5f');
      sfx.mercy();
      addLog(`${nameOf(st, ev.p)} hit 25 cards and is OUT!`);
      await sleep(700);
      break;
    }
    case 'shuffle': addLog('Deck reshuffled'); break;
    case 'win': break;
    default: break;
  }
}

/* ---------------- render everything ---------------- */
function renderPanel(el, st, i) {
  const g = st.game; const p = g.players[i]; const seat = st.seats[i];
  const mood = p.out ? 'dead' : p.count >= 17 ? 'worried' : 'happy';
  const key = `${i}:${mood}`;
  if (S.avatarKey[i] !== key) { S.avatarKey[i] = key; $('.av', el).innerHTML = avatar(i, mood); }
  $('.nm', el).innerHTML = esc(seat.name) + (i === st.you ? ' (you)' : '') + (!seat.bot && !seat.connected ? '<span class="tag-away">away</span>' : '') + (seat.bot ? ' 🤖' : '');
  $('.cnt b', el).textContent = p.out ? '☠' : p.count;
  const m = $('.meter i', el);
  const pct = Math.min(100, (p.count / g.mercyLimit) * 100);
  m.style.width = `${pct}%`;
  m.className = pct >= 80 ? 'danger' : pct >= 52 ? 'warn' : '';
  el.classList.toggle('turn', g.turn === i && st.phase === 'playing' && !p.out);
  el.classList.toggle('out', p.out);
  const e = seat.emote;
  if (e && S.emoteSeen[i] !== e.n) {
    if (S.emoteSeen[i] !== undefined) { const b = document.createElement('div'); b.className = 'bubble'; b.textContent = e.e; el.appendChild(b); setTimeout(() => b.remove(), 2500); sfx.pop(); }
    S.emoteSeen[i] = e.n;
  }
}

function renderAll(st, first) {
  const g = st.game;
  g.players.forEach((_, i) => renderPanel(seatEl(i), st, i));
  syncDiscard(g.top);
  $('#discard').dataset.color = g.color;
  $('#deckCount').textContent = g.deck;
  const dr = $('#dirRing'); dr.classList.toggle('cw', g.dir === 1); dr.classList.toggle('ccw', g.dir !== 1);
  const pend = $('#pending');
  pend.classList.toggle('hidden', !g.pending); pend.textContent = `+${g.pending}`;
  renderHand(g, st, first);

  const myTurn = g.turn === st.you && st.phase === 'playing';
  const draw = $('#drawBtn');
  draw.classList.toggle('hidden', !(myTurn && g.canDraw));
  draw.textContent = g.pending ? `Take +${g.pending} 😬` : 'Draw!';
  $('#keepBtn').classList.toggle('hidden', !(myTurn && g.canPass));
  $('#deck').classList.toggle('glow', myTurn && g.canDraw);
  const tb = $('#turnBanner');
  tb.classList.toggle('on', myTurn);
  tb.textContent = g.canPass ? 'Play it or keep it!' : g.pending ? `Stack a draw card or take +${g.pending}!` : 'YOUR TURN!';
  if (myTurn && S.lastTurnSeq !== st.seq) sfx.turn();
  S.lastTurnSeq = st.seq;

  // turn timer on human seats
  const key = `${st.seq}:${g.turn}`;
  if (key !== S.timerKey) {
    S.timerKey = key;
    $$('.timer i').forEach((t) => { t.style.animation = 'none'; });
    const seat = st.seats[g.turn];
    if (st.phase === 'playing' && seat && !seat.bot && seat.connected && st.ms > 0) {
      const t = $('.timer i', seatEl(g.turn));
      void t.offsetWidth;
      t.style.animation = `drain ${st.ms}ms linear forwards`;
    }
  }

  if (st.phase === 'ended') showWin(st); else $('#winOverlay').classList.add('hidden');
}

function showWin(st) {
  const g = st.game;
  if (!$('#winOverlay').classList.contains('hidden')) return;
  const w = g.winner; const me = w === st.you;
  $('#winTitle').textContent = me ? 'YOU WIN! 🎉' : `${st.seats[w].name} wins!`;
  $('#winSub').textContent = g.endReason === 'mercy' ? 'Last one standing — no mercy shown! ☠' : 'Emptied their hand first!';
  const host = st.you === st.host;
  $('#againBtn').classList.toggle('hidden', !host);
  $('#winWait').textContent = host ? '' : 'Waiting for the host to start a new round…';
  setTimeout(() => {
    if (S.cur && S.cur.phase === 'ended') {
      $('#winOverlay').classList.remove('hidden');
      sfx.win(); confetti();
    }
  }, 900);
}
function confetti() {
  const box = $('#confetti');
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = Object.values(COLOR_HEX)[i % 4];
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 300}px`);
    p.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
    p.style.animationDuration = `${2.2 + Math.random() * 2.2}s`;
    p.style.animationDelay = `${Math.random() * 0.8}s`;
    box.appendChild(p);
    setTimeout(() => p.remove(), 5500);
  }
}

/* ---------------- state application (serialised through S.queue) ---------------- */
async function applyState(st) {
  if (st.phase === 'lobby') {
    S.tableBuilt = false; S.cur = st; S.lastSeq = -1;
    $('#winOverlay').classList.add('hidden');
    renderLobby(st);
    return;
  }
  show('game');
  S.busy = false;
  if (!S.tableBuilt) {
    S.cur = st;
    buildTable(st);
    S.lastSeq = st.seq;
    renderAll(st, true);
    await sleep(200);
    return;
  }
  const fresh = st.seq !== S.lastSeq;
  S.lastSeq = st.seq;
  if (fresh && S.backlog <= 2) {
    for (const ev of st.events) {
      try { await playEvent(ev, S.cur ? st : st); } catch (e) { console.error(e); }
    }
  }
  S.cur = st;
  renderAll(st, false);
}

/* ======================================================================== *
 *  Boot
 * ======================================================================== */
setupHome();
const bootRoom = Net.initialRoom();
if (bootRoom.length === 4 && store.get(tokenKey(bootRoom))) {
  // returning player: silently rejoin with the saved token
  connect(bootRoom);
}
