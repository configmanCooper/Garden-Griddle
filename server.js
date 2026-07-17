'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const C = require('./public/shared/constants.js');
const { RoomManager } = require('./server/rooms.js');

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createGameServer(options) {
  const opts = options || {};
  const app = express();
  const server = http.createServer(app);
  const allowedOrigins = opts.allowedOrigins || parseOrigins(process.env.ALLOWED_ORIGINS);
  const allowOrigin = (origin, callback) => {
    if (!origin || /^https:\/\/localhost$/i.test(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return callback(null, true);
    const privateLan = /^http:\/\/(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$/i;
    if (!allowedOrigins.length && privateLan.test(origin)) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed.'));
  };
  const io = new Server(server, {
    path: '/gg-realtime',
    cors: { origin: allowOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 32768,
    perMessageDeflate: { threshold: 1024 }
  });
  const secret = opts.secret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const rooms = new RoomManager(io, { secret, publicUrl: opts.publicUrl || process.env.PUBLIC_URL || '' });

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size, build: C.CLIENT_BUILD }));
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.type('application/json').sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
  });
  app.get('/join/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.use(express.static(path.join(__dirname, 'public')));

  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    if (Number(auth.protocol) !== C.PROTOCOL) return next(new Error('Protocol mismatch.'));
    if (String(auth.clientBuild || '') !== C.CLIENT_BUILD) return next(new Error('Client update required.'));
    next();
  });

  io.on('connection', (socket) => {
    socket.on(C.EVENTS.CREATE_ROOM, (payload, ack) => rooms.createRoom(socket, payload || {}, ack));
    socket.on(C.EVENTS.JOIN_ROOM, (payload, ack) => rooms.joinRoom(socket, payload || {}, ack));
    socket.on(C.EVENTS.START_DAY, (payload, ack) => rooms.startDay(socket, payload || {}, ack));
    socket.on(C.EVENTS.SET_RESTAURANT_NAME, (payload, ack) => rooms.setRestaurantName(socket, payload || {}, ack));
    socket.on(C.EVENTS.SUBMIT_ACTION, (payload, ack) => rooms.submitAction(socket, payload || {}, ack));
    socket.on(C.EVENTS.BUY_UPGRADE, (payload, ack) => rooms.buyUpgrade(socket, payload || {}, ack));
    socket.on(C.EVENTS.PAUSE_REQUEST, (_payload, ack) => rooms.requestPause(socket, ack));
    socket.on(C.EVENTS.PAUSE_VOTE, (payload, ack) => rooms.votePause(socket, payload || {}, ack));
    socket.on(C.EVENTS.REQUEST_SNAPSHOT, () => rooms.requestSnapshot(socket));
    socket.on(C.EVENTS.PING, (payload) => rooms.ping(socket, payload || {}));
    socket.on('disconnect', () => rooms.disconnect(socket));
  });

  async function listen(port) {
    const target = port === undefined ? Number(process.env.PORT || 3100) : port;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(target, () => {
        server.off('error', reject);
        resolve();
      });
    });
    return server.address().port;
  }

  async function close(reason) {
    rooms.close(reason);
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }

  return { app, server, io, rooms, listen, close };
}

if (require.main === module) {
  const gameServer = createGameServer();
  gameServer.listen().then((port) => {
    console.log('Garden & Griddle server listening on http://localhost:' + port);
  });
  const shutdown = async () => {
    gameServer.rooms.abortAll('Server maintenance');
    setTimeout(async () => {
      await gameServer.close('Server maintenance');
      process.exit(0);
    }, 250).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createGameServer };
