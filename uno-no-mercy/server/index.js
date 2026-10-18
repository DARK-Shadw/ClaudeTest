'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');

const PORT = process.env.PORT || 3000;
const SPEED = Number(process.env.SPEED) || 1; // >1 speeds up bots (testing)
const PUBLIC = path.join(__dirname, '..', 'public');
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

// ---- rooms over websockets ---------------------------------------------------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.alive = true;
  const out = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  ws.out = out;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') return join(ws, m);
    const room = ws.room && rooms.get(ws.room);
    if (room) room.handle(ws.token, m);
  });
  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (room) room.disconnect(ws.token, ws.out);
  });
});

function join(ws, m) {
  let room;
  if (m.room) {
    room = rooms.get(String(m.room).toUpperCase());
    if (!room) return ws.out({ t: 'error', msg: 'Room not found. Check your link!', fatal: true });
  } else {
    room = new Room(newCode(), { speed: SPEED });
    rooms.set(room.code, room);
  }
  try {
    ws.token = room.join(m.name, m.token, ws.out, () => ws.close());
    ws.room = room.code;
  } catch (e) {
    ws.out({ t: 'error', msg: e.message, fatal: true });
  }
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.hasHumans() && now - r.lastActivity > 30 * 60 * 1000) { r.destroy(); rooms.delete(code); }
  }
}, 15000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Uno No Mercy running on http://localhost:${PORT}`));
}
module.exports = { server, rooms };
