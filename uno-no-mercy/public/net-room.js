'use strict';
/* Transport for the artifact build: no server. The player who creates the game
 * hosts it — the rules engine (Room) runs in their tab — and everyone else talks to
 * that tab through the artifact "room" capability (a named room per game code). */
const Net = (() => {
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const genTok = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2));
  let R = null; let nr = null; let host = null; let h = null;
  let myTok = null; let offs = []; let timers = []; let cleared = false;
  const sends = {};
  const capP = (async () => { try { return (await window.claude.use('room')) || null; } catch { return null; } })();
  const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const emit = (topic, data) => { if (nr) nr.emit(topic, data).catch(() => {}); };
  const toGuest = (tok) => (sends[tok] = sends[tok] || ((m) => emit('h2c', { to: tok, m })));

  function teardown() {
    offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
    timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
    offs = []; timers = [];
    if (host) host.destroy();
    if (nr) { try { nr.presence({ tok: null, host: null }); nr.leave(); } catch { /* ignore */ } }
    host = null; nr = null;
    Object.keys(sends).forEach((k) => delete sends[k]);
  }

  async function openHost(join) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    myTok = genTok();
    if (R) { try { nr = await R.join(`uno-${code.toLowerCase()}`); } catch { nr = null; } }
    host = new Room(code, {});
    if (nr) {
      offs.push(nr.on('c2h', (msg) => {
        const d = msg.data;
        if (!d || typeof d.tok !== 'string' || !d.m || typeof d.m !== 'object') return;
        if (d.m.t === 'join') {
          try { host.join(d.m.name, d.tok, toGuest(d.tok), null); }
          catch (e) { toGuest(d.tok)({ t: 'error', msg: e.message, fatal: true }); }
        } else host.handle(d.tok, d.m);
      }));
      offs.push(nr.onPeers((c) => {
        for (const p of c.left) {
          const tok = p.presence && p.presence.tok;
          if (typeof tok === 'string' && tok !== myTok) host.disconnect(tok, sends[tok]);
        }
        for (const p of c.joined) {
          const tok = p.presence && p.presence.tok;
          const i = typeof tok === 'string' ? host.indexOf(tok) : -1;
          if (i >= 0 && !host.seats[i].connected) host.join(host.seats[i].name, tok, toGuest(tok), null);
        }
      }));
      nr.presence({ tok: myTok, host: 1 }).catch(() => {});
    }
    host.join(join.name, myTok, (m) => { Promise.resolve().then(() => h.message(m)); }, null);
    if (!nr) h.message({ t: 'notice', msg: 'Multiplayer is not available in this view. Playing solo against bots.' });
  }

  async function openGuest(join) {
    const fail = (msg) => h.message({ t: 'error', msg, fatal: true });
    const code = clean(join.room);
    myTok = join.token || genTok();
    if (!R) return fail('Multiplayer is not available in this view. Open the artifact while signed in, or create a solo game.');
    try { nr = await R.join(`uno-${code.toLowerCase()}`); } catch { return fail("Couldn't open that room."); }
    let joined = false; let lastHost = Date.now();
    offs.push(nr.on('h2c', (msg) => {
      const d = msg.data;
      if (!d || d.to !== myTok || !d.m) return;
      if (d.m.t === 'joined') { joined = true; lastHost = Date.now(); }
      h.message(d.m);
    }));
    offs.push(nr.onPeers((c) => {
      if (c.peers.some((p) => p.presence && p.presence.host && !p.isMe)) lastHost = Date.now();
    }));
    nr.presence({ tok: myTok }).catch(() => {});
    const ask = () => emit('c2h', { tok: myTok, m: { t: 'join', name: join.name } });
    ask();
    let tries = 0;
    timers.push(setInterval(() => {
      if (!joined) {
        if (++tries >= 5) { teardown(); fail('Room not found. Check the code, and make sure the host still has the game open.'); } else ask();
      } else if (Date.now() - lastHost > 9000) {
        teardown(); fail('The host left the game.');
      }
    }, 1500));
  }

  return {
    initialRoom() { return cleared ? '' : clean(location.hash.slice(1)); },
    inviteLink: (code) => `${location.href.split('#')[0]}#${code}`,
    inviteText: (code) => `Join my Uno No Mercy game! Open ${location.href.split('#')[0]}#${code} and enter room code ${code}.`,
    setRoom(code) {
      cleared = !code;
      try { history.replaceState(null, '', code ? `#${code}` : location.pathname + location.search); } catch { /* sandboxed */ }
    },
    async open(join, handlers) {
      teardown();
      h = handlers;
      R = await capP;
      if (join.room) await openGuest(join); else await openHost(join);
    },
    send(m) {
      if (host) host.handle(myTok, m);
      else emit('c2h', { tok: myTok, m });
    },
    close() { teardown(); },
  };
})();
