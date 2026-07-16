'use strict';

const crypto = require('crypto');
const C = require('../public/shared/constants.js');
const B = require('../public/shared/balance.js');
const S = require('../public/shared/schema.js');
const Sim = require('../public/shared/sim.js');
const Tokens = require('./tokens.js');

const ROOM_LIFETIME_MS = 30 * 60 * 1000;
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EMPTY_LOBBY_MS = 60 * 1000;
const REPLACE_GRACE_MS = 120 * 1000;
const INVITE_LIFETIME_MS = 30 * 60 * 1000;
const PAUSE_VOTE_MS = 10 * 1000;
const PAUSE_MAX_MS = 5 * 60 * 1000;
const ACTION_RATE = 20;
const ACTION_BURST = 40;
const ACTION_CACHE = 256;
const MAX_ROOMS = 500;

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < bytes.length; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function sanitizeName(value) {
  return String(value || 'Player')
    .replace(/[\u0000-\u001f\u007f<>&]/g, '')
    .trim()
    .slice(0, 20) || 'Player';
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

class RoomManager {
  constructor(io, options) {
    this.io = io;
    this.secret = options.secret;
    this.publicUrl = options.publicUrl || '';
    this.rooms = new Map();
    this.draining = false;
    this.createLimits = new Map();
    this.joinLimits = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  getRoom(code) {
    return this.rooms.get(String(code || '').toUpperCase()) || null;
  }

  createRoom(socket, payload, ack) {
    if (this.draining) return safeAck(ack, { ok: false, reason: 'Server is preparing to restart.' });
    if (socket._gg && socket._gg.roomCode) return safeAck(ack, { ok: false, reason: 'Already in a room.' });
    if (this.rooms.size >= MAX_ROOMS) return safeAck(ack, { ok: false, reason: 'Server is at room capacity. Try again shortly.' });
    if (!this.takeIpToken(this.createLimits, socket.handshake.address, 2 / 60, 5)) {
      return safeAck(ack, { ok: false, reason: 'Too many rooms created from this connection.', code: 'rate' });
    }
    let code;
    do { code = roomCode(); } while (this.rooms.has(code));
    const now = Date.now();
    const pid = crypto.randomUUID();
    const inviteToken = Tokens.randomToken(16);
    const room = {
      code,
      createdAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
      inviteToken,
      inviteExpiresAt: now + INVITE_LIFETIME_MS,
      hostId: pid,
      status: 'lobby',
      campaign: S.normalizeCampaign(payload && payload.campaign),
      selectedLevel: 1,
      players: new Map(),
      state: null,
      interval: null,
      paused: false,
      emptyPaused: false,
      pauseVote: null,
      pauseUntil: 0,
      draining: false
    };
    room.selectedLevel = room.campaign.unlockedLevel;
    this.rooms.set(code, room);
    const player = this.addPlayer(room, socket, pid, 0, sanitizeName(payload && payload.name));
    this.sendSession(room, player, socket);
    this.broadcastRoom(room);
    safeAck(ack, { ok: true, code, playerId: pid });
  }

  joinRoom(socket, payload, ack) {
    if (this.draining) return safeAck(ack, { ok: false, reason: 'Server is preparing to restart.' });
    if (socket._gg && socket._gg.roomCode) return safeAck(ack, { ok: false, reason: 'Already in a room.' });
    if (!this.takeIpToken(this.joinLimits, socket.handshake.address, 2, 20)) {
      return safeAck(ack, { ok: false, reason: 'Too many join attempts.', code: 'rate' });
    }
    const code = String(payload && payload.code || '').trim().toUpperCase();
    const room = this.getRoom(code);
    if (!room || room.draining) return safeAck(ack, { ok: false, reason: 'Room not found or unavailable.' });
    if (room.expiresAt <= Date.now()) {
      this.expireRoom(room, 'Room expired');
      return safeAck(ack, { ok: false, reason: 'Room has expired.' });
    }
    const reconnectPayload = Tokens.verify(this.secret, payload && payload.sessionToken);
    if (reconnectPayload && reconnectPayload.roomCode === room.code) {
      const player = room.players.get(reconnectPayload.playerId);
      if (!player || player.nonce !== reconnectPayload.nonce) return safeAck(ack, { ok: false, reason: 'Reconnect token is no longer valid.' });
      this.attachSocket(room, player, socket);
      player.name = sanitizeName(payload && payload.name || player.name);
      player.claimableAt = 0;
      if (room.state) {
        if (!room.state.players[player.id]) {
          room.state.players[player.id] = {
            id: player.id,
            seat: player.seat,
            name: player.name,
            color: player.seat === 0 ? '#e45b5b' : '#4f91d9',
            pattern: player.seat === 0 ? 'stripe' : 'dot',
            connected: true,
            task: null,
            lastAction: null
          };
        }
        Sim.reconnectPlayer(room.state, player.id);
      }
      this.sendSession(room, player, socket);
      if (room.state) socket.emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
      this.broadcastRoom(room);
      return safeAck(ack, { ok: true, reconnected: true, playerId: player.id });
    }

    if (room.status !== 'lobby' && room.status !== 'playing') return safeAck(ack, { ok: false, reason: 'That room is not accepting players.' });
    const providedInvite = String(payload && payload.inviteToken || '');
    const inviteValid = providedInvite && providedInvite === room.inviteToken && room.inviteExpiresAt >= Date.now();
    if (providedInvite && !inviteValid) return safeAck(ack, { ok: false, reason: 'Invitation has expired.' });

    let seat = this.openSeat(room);
    if (seat < 0) {
      const replaceable = [...room.players.values()].find((player) => !player.connected && player.claimableAt && player.claimableAt <= Date.now());
      if (!replaceable) return safeAck(ack, { ok: false, reason: 'Room already has two players.' });
      seat = replaceable.seat;
      this.removePlayer(room, replaceable.id);
    }
    const pid = crypto.randomUUID();
    const player = this.addPlayer(room, socket, pid, seat, sanitizeName(payload && payload.name));
    const host = room.players.get(room.hostId);
    if (!host || !host.connected) room.hostId = player.id;
    if (room.state && room.status === 'playing') {
      room.state.players[pid] = {
        id: pid,
        seat,
        name: player.name,
        color: seat === 0 ? '#e45b5b' : '#4f91d9',
        pattern: seat === 0 ? 'stripe' : 'dot',
        connected: true,
        task: null,
        lastAction: null
      };
    }
    this.sendSession(room, player, socket);
    if (room.state) {
      socket.emit(C.EVENTS.DAY_STARTED, { level: room.state.level.number });
      socket.emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
    }
    this.broadcastRoom(room);
    safeAck(ack, { ok: true, playerId: pid, inviteUsed: !!inviteValid });
  }

  addPlayer(room, socket, pid, seat, name) {
    const player = {
      id: pid,
      seat,
      name,
      socketId: socket.id,
      connected: true,
      nonce: Tokens.randomToken(12),
      tokenExpiresAt: Date.now() + SESSION_LIFETIME_MS,
      claimableAt: 0,
      lastSeq: 0,
      actionResults: new Map(),
      lastSnapshotRequestAt: 0,
      lastPingAt: 0,
      rate: { tokens: ACTION_BURST, updatedAt: Date.now() }
    };
    room.players.set(pid, player);
    this.attachSocket(room, player, socket);
    return player;
  }

  attachSocket(room, player, socket) {
    const previousSocketId = player.socketId;
    player.socketId = socket.id;
    player.connected = true;
    player.nonce = Tokens.randomToken(12);
    player.tokenExpiresAt = Date.now() + SESSION_LIFETIME_MS;
    socket._gg = { roomCode: room.code, playerId: player.id };
    socket.join(room.code);
    room.emptyPaused = false;
    room.emptySince = 0;
    this.touchRoom(room);
    if (previousSocketId && previousSocketId !== socket.id) {
      const oldSocket = this.io.sockets.sockets.get(previousSocketId);
      if (oldSocket) {
        oldSocket._gg = null;
        oldSocket.disconnect(true);
      }
    }
  }

  sendSession(room, player, socket) {
    const token = Tokens.sign(this.secret, {
      roomCode: room.code,
      playerId: player.id,
      seat: player.seat,
      nonce: player.nonce,
      exp: player.tokenExpiresAt
    });
    const inviteUrl = this.publicUrl
      ? this.publicUrl.replace(/\/$/, '') + '/join/' + room.code + '?invite=' + encodeURIComponent(room.inviteToken)
      : '/join/' + room.code + '?invite=' + encodeURIComponent(room.inviteToken);
    socket.emit(C.EVENTS.SESSION, {
      code: room.code,
      playerId: player.id,
      seat: player.seat,
      isHost: room.hostId === player.id,
      sessionToken: token,
      inviteToken: room.inviteToken,
      inviteUrl,
      campaign: room.campaign,
      lastSeq: player.lastSeq
    });
  }

  openSeat(room) {
    for (let seat = 0; seat < C.MAX_PLAYERS; seat += 1) {
      if (![...room.players.values()].some((player) => player.seat === seat)) return seat;
    }
    return -1;
  }

  removePlayer(room, playerId) {
    const player = room.players.get(playerId);
    if (!player) return;
    if (room.state) {
      Sim.disconnectPlayer(room.state, playerId);
      delete room.state.players[playerId];
    }
    room.players.delete(playerId);
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((item) => item.connected) || [...room.players.values()][0];
      if (next) room.hostId = next.id;
    }
  }

  startDay(socket, payload, ack) {
    const context = this.context(socket);
    if (!context) return safeAck(ack, { ok: false, reason: 'Not in a room.' });
    const { room, player } = context;
    if (this.draining || room.draining) return safeAck(ack, { ok: false, reason: 'Server is preparing to restart.' });
    if (room.hostId !== player.id) return safeAck(ack, { ok: false, reason: 'Only the host can start.' });
    if (!['lobby', 'results'].includes(room.status)) return safeAck(ack, { ok: false, reason: 'A day is already active.' });
    const level = Math.max(1, Math.min(C.MAX_LEVEL, Math.floor(Number(payload && payload.level) || room.selectedLevel)));
    if (level > room.campaign.unlockedLevel) return safeAck(ack, { ok: false, reason: 'That level is locked.' });
    const active = [...room.players.values()].filter((item) => item.connected);
    if (!active.length) return safeAck(ack, { ok: false, reason: 'No connected players.' });
    room.selectedLevel = level;
    this.touchRoom(room);
    for (const item of room.players.values()) {
      item.lastSeq = 0;
      item.actionResults.clear();
      item.rate = { tokens: ACTION_BURST, updatedAt: Date.now() };
    }
    room.state = S.createState({
      level,
      seed: crypto.randomBytes(4).readUInt32LE(0),
      playerIds: active.map((item) => item.id),
      playerNames: active.map((item) => item.name),
      playerSeats: active.map((item) => item.seat),
      upgrades: room.campaign.upgrades
    });
    room.status = 'playing';
    room.paused = false;
    room.emptyPaused = false;
    room.pauseVote = null;
    room.pauseUntil = 0;
    this.io.to(room.code).emit(C.EVENTS.DAY_STARTED, { level });
    this.io.to(room.code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
    this.startLoop(room);
    this.broadcastRoom(room);
    safeAck(ack, { ok: true, level });
  }

  startLoop(room) {
    if (room.interval) return;
    let snapshotAccumulator = 0;
    room.interval = setInterval(() => {
      if (room.pauseVote && Date.now() >= room.pauseVote.expiresAt) this.resolvePauseVote(room, false);
      if (room.paused && room.pauseUntil && Date.now() >= room.pauseUntil) {
        room.paused = false;
        room.pauseUntil = 0;
        this.broadcastPause(room);
      }
      if (!room.state || room.status !== 'playing' || room.paused || room.emptyPaused) return;
      const result = Sim.step(room.state, B.TICK_MS / 1000);
      snapshotAccumulator += B.TICK_MS;
      if (snapshotAccumulator >= B.SNAPSHOT_MS) {
        snapshotAccumulator = 0;
        this.io.to(room.code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
      }
      if (result) this.finishDay(room, result);
    }, B.TICK_MS);
  }

  finishDay(room, result) {
    if (room.interval) {
      clearInterval(room.interval);
      room.interval = null;
    }
    const earned = Sim.applyDayResult(room.campaign, result);
    room.status = 'results';
    this.io.to(room.code).emit(C.EVENTS.DAY_ENDED, { result, earnedStars: earned, campaign: room.campaign });
    this.io.to(room.code).emit(C.EVENTS.CAMPAIGN_UPDATE, { campaign: room.campaign });
    this.broadcastRoom(room);
  }

  submitAction(socket, envelope, ack) {
    const context = this.context(socket);
    if (!context || !context.room.state || context.room.status !== 'playing') {
      return safeAck(ack, { ok: false, reason: 'No active day.', code: 'status' });
    }
    const { room, player } = context;
    if (room.draining) return safeAck(ack, { ok: false, reason: 'Server is preparing to restart.', code: 'draining' });
    if (room.paused) return safeAck(ack, { ok: false, reason: 'The day is paused.', code: 'paused' });
    if (!envelope || typeof envelope !== 'object') return safeAck(ack, { ok: false, reason: 'Malformed action.', code: 'payload' });
    const seq = Math.floor(Number(envelope.seq));
    const actionId = String(envelope.actionId || '').slice(0, 80);
    if (!Number.isSafeInteger(seq) || seq <= 0 || !actionId) return safeAck(ack, { ok: false, reason: 'Action sequence is invalid.', code: 'sequence' });
    if (player.actionResults.has(actionId)) return safeAck(ack, player.actionResults.get(actionId));
    if (seq <= player.lastSeq) return safeAck(ack, { ok: false, reason: 'Stale action sequence.', code: 'stale', actionId, seq });
    if (!this.takeActionToken(player)) return safeAck(ack, { ok: false, reason: 'Too many actions.', code: 'rate', actionId, seq });
    player.lastSeq = seq;
    this.touchRoom(room);
    const result = Sim.applyAction(room.state, player.id, String(envelope.action || ''), envelope.payload || {});
    const response = Object.assign({ actionId, seq }, result);
    player.actionResults.set(actionId, response);
    while (player.actionResults.size > ACTION_CACHE) player.actionResults.delete(player.actionResults.keys().next().value);
    socket.emit(C.EVENTS.ACTION_RESULT, response);
    if (result.ok) this.io.to(room.code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
    safeAck(ack, response);
  }

  takeActionToken(player) {
    const now = Date.now();
    const elapsed = Math.max(0, (now - player.rate.updatedAt) / 1000);
    player.rate.tokens = Math.min(ACTION_BURST, player.rate.tokens + elapsed * ACTION_RATE);
    player.rate.updatedAt = now;
    if (player.rate.tokens < 1) return false;
    player.rate.tokens -= 1;
    return true;
  }

  buyUpgrade(socket, payload, ack) {
    const context = this.context(socket);
    if (!context) return safeAck(ack, { ok: false, reason: 'Not in a room.' });
    if (context.room.draining) return safeAck(ack, { ok: false, reason: 'Server is preparing to restart.' });
    if (!['lobby', 'results'].includes(context.room.status)) return safeAck(ack, { ok: false, reason: 'Shop is closed during a day.' });
    const result = B.purchaseUpgrade(context.room.campaign, String(payload && payload.id || ''));
    if (result.ok) {
      this.io.to(context.room.code).emit(C.EVENTS.CAMPAIGN_UPDATE, { campaign: context.room.campaign });
      this.broadcastRoom(context.room);
    }
    safeAck(ack, result);
  }

  requestPause(socket, ack) {
    const context = this.context(socket);
    if (!context || context.room.status !== 'playing') return safeAck(ack, { ok: false, reason: 'No active day.' });
    const { room, player } = context;
    if (room.draining) return safeAck(ack, { ok: false, reason: 'Server is preparing to restart.' });
    const connected = [...room.players.values()].filter((item) => item.connected);
    if (connected.length <= 1) {
      room.paused = !room.paused;
      room.pauseUntil = room.paused ? Date.now() + PAUSE_MAX_MS : 0;
      this.broadcastPause(room);
      return safeAck(ack, { ok: true, paused: room.paused });
    }
    if (room.pauseVote) return safeAck(ack, { ok: false, reason: 'A pause vote is already active.' });
    room.pauseVote = { requestedBy: player.id, votes: new Set([player.id]), expiresAt: Date.now() + PAUSE_VOTE_MS };
    this.broadcastPause(room);
    safeAck(ack, { ok: true, vote: true });
  }

  votePause(socket, payload, ack) {
    const context = this.context(socket);
    if (!context || !context.room.pauseVote) return safeAck(ack, { ok: false, reason: 'No pause vote.' });
    if (payload && payload.approve) context.room.pauseVote.votes.add(context.player.id);
    else return this.resolvePauseVote(context.room, false, ack);
    const connected = [...context.room.players.values()].filter((item) => item.connected);
    if (connected.every((item) => context.room.pauseVote.votes.has(item.id))) return this.resolvePauseVote(context.room, true, ack);
    this.broadcastPause(context.room);
    safeAck(ack, { ok: true, waiting: true });
  }

  resolvePauseVote(room, approved, ack) {
    room.pauseVote = null;
    if (approved) {
      room.paused = true;
      room.pauseUntil = Date.now() + PAUSE_MAX_MS;
    }
    this.broadcastPause(room);
    safeAck(ack, { ok: true, approved, paused: room.paused });
  }

  broadcastPause(room) {
    this.io.to(room.code).emit(C.EVENTS.PAUSE_UPDATE, {
      paused: room.paused,
      vote: room.pauseVote ? {
        requestedBy: room.pauseVote.requestedBy,
        votes: room.pauseVote.votes.size,
        expiresAt: room.pauseVote.expiresAt
      } : null,
      pauseUntil: room.pauseUntil
    });
  }

  ping(socket, payload) {
    const context = this.context(socket);
    if (!context) return;
    const now = Date.now();
    if (now - context.player.lastPingAt < 750) return;
    context.player.lastPingAt = now;
    const kind = ['garden', 'cook', 'milk', 'rush'].includes(payload && payload.kind) ? payload.kind : 'rush';
    socket.to(context.room.code).emit(C.EVENTS.PARTNER_PING, { playerId: context.player.id, kind, at: now });
  }

  requestSnapshot(socket) {
    const context = this.context(socket);
    if (!context || !context.room.state) return false;
    const now = Date.now();
    if (now - context.player.lastSnapshotRequestAt < 500) return false;
    context.player.lastSnapshotRequestAt = now;
    socket.emit(C.EVENTS.SNAPSHOT, Sim.snapshot(context.room.state));
    return true;
  }

  disconnect(socket) {
    const context = this.context(socket);
    if (!context) return;
    const { room, player } = context;
    if (player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.claimableAt = Date.now() + REPLACE_GRACE_MS;
    if (room.state) Sim.disconnectPlayer(room.state, player.id);
    const connected = [...room.players.values()].filter((item) => item.connected);
    if (!connected.length) room.emptyPaused = true;
    if (!connected.length) room.emptySince = Date.now();
    if (room.hostId === player.id && connected.length) room.hostId = connected[0].id;
    this.broadcastRoom(room);
    if (room.state) this.io.to(room.code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
  }

  context(socket) {
    if (!socket._gg) return null;
    const room = this.getRoom(socket._gg.roomCode);
    if (room && room.expiresAt <= Date.now()) {
      this.expireRoom(room, 'Room expired');
      return null;
    }
    const player = room && room.players.get(socket._gg.playerId);
    return room && player ? { room, player } : null;
  }

  broadcastRoom(room) {
    this.io.to(room.code).emit(C.EVENTS.ROOM_UPDATE, {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      selectedLevel: room.selectedLevel,
      campaign: room.campaign,
      players: [...room.players.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((player) => ({ id: player.id, seat: player.seat, name: player.name, connected: player.connected }))
    });
  }

  abortAll(reason) {
    this.draining = true;
    for (const room of this.rooms.values()) {
      room.draining = true;
      room.status = 'aborted';
      if (room.state) room.state.status = 'aborted';
      if (room.interval) clearInterval(room.interval);
      room.interval = null;
      this.io.to(room.code).emit(C.EVENTS.ROOM_ABORTED, { reason: reason || 'Server restart', progressAwarded: false });
    }
  }

  cleanup() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const emptyLobbyExpired = room.status === 'lobby' && room.emptySince && room.emptySince + EMPTY_LOBBY_MS <= now;
      if (room.expiresAt <= now || emptyLobbyExpired) {
        this.expireRoom(room, emptyLobbyExpired ? 'Empty room closed' : 'Room expired');
      }
    }
    this.pruneLimitMap(this.createLimits, now);
    this.pruneLimitMap(this.joinLimits, now);
  }

  touchRoom(room) {
    room.expiresAt = Date.now() + ROOM_LIFETIME_MS;
  }

  expireRoom(room, reason) {
    if (!room || !this.rooms.has(room.code)) return;
    if (room.interval) clearInterval(room.interval);
    room.interval = null;
    room.status = 'aborted';
    if (room.state) room.state.status = 'aborted';
    this.io.to(room.code).emit(C.EVENTS.ROOM_ABORTED, { reason, progressAwarded: false });
    for (const player of room.players.values()) {
      if (!player.socketId) continue;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket._gg = null;
        socket.leave(room.code);
      }
    }
    this.rooms.delete(room.code);
  }

  pruneLimitMap(map, now) {
    const cutoff = now - 10 * 60 * 1000;
    for (const [key, bucket] of map) if (bucket.updatedAt < cutoff) map.delete(key);
  }

  takeIpToken(map, address, rate, burst) {
    const key = String(address || 'unknown');
    const now = Date.now();
    const bucket = map.get(key) || { tokens: burst, updatedAt: now };
    bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, (now - bucket.updatedAt) / 1000) * rate);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      map.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    map.set(key, bucket);
    return true;
  }

  close() {
    clearInterval(this.cleanupInterval);
    this.abortAll('Server closed');
    this.rooms.clear();
  }
}

module.exports = { RoomManager, sanitizeName };
