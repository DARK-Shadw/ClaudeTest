'use strict';
/* Transport for the Node server: one WebSocket per player. */
const Net = (() => {
  let ws = null;
  return {
    initialRoom() {
      return (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    },
    inviteLink: (code) => `${location.origin}${location.pathname}?room=${code}`,
    setRoom(code) {
      try { history.replaceState(null, '', code ? `?room=${code}` : location.pathname); } catch { /* ignore */ }
    },
    open(join, h) {
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
      ws = sock;
      sock.onopen = () => sock.send(JSON.stringify({ t: 'join', ...join }));
      sock.onmessage = (e) => h.message(JSON.parse(e.data));
      sock.onclose = () => { if (ws === sock) h.closed(); };
    },
    send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    close() { const s = ws; ws = null; if (s) s.close(); },
  };
})();
