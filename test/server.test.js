'use strict';

const assert = require('assert');
const { io: connect } = require('socket.io-client');
const C = require('../public/shared/constants.js');
const { createGameServer } = require('../server.js');

function once(socket, event, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error('Timed out waiting for ' + event));
    }, timeout || 3000);
    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, handler);
  });
}

function emitAck(socket, event, payload, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out acknowledging ' + event)), timeout || 3000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function client(url, auth) {
  return connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: Object.assign({ protocol: C.PROTOCOL, clientBuild: C.CLIENT_BUILD }, auth || {})
  });
}

async function connected(socket) {
  if (socket.connected) return;
  await once(socket, 'connect');
}

async function run() {
  const gameServer = createGameServer({ port: 0, secret: 'test-secret', publicUrl: 'https://example.test' });
  const port = await gameServer.listen(0);
  const url = 'http://127.0.0.1:' + port;
  const sockets = [];
  try {
    const bad = client(url, { protocol: 999 });
    sockets.push(bad);
    const mismatch = await once(bad, 'connect_error');
    assert.match(mismatch.message, /Protocol mismatch/);

    let host = client(url);
    sockets.push(host);
    await connected(host);
    const hostSessionPromise = once(host, C.EVENTS.SESSION);
    const created = await emitAck(host, C.EVENTS.CREATE_ROOM, {
      name: '<Host>',
      campaign: { unlockedLevel: 3, stars: 8 }
    });
    assert.strictEqual(created.ok, true);
    const hostSession = await hostSessionPromise;
    assert.strictEqual(hostSession.code.length, 6);
    assert.ok(hostSession.sessionToken);
    assert.ok(hostSession.inviteUrl.includes('/join/' + hostSession.code));
    const sameSocketJoin = await emitAck(host, C.EVENTS.JOIN_ROOM, { code: hostSession.code, name: 'Ghost' });
    assert.strictEqual(sameSocketJoin.ok, false);
    assert.match(sameSocketJoin.reason, /Already in a room/);

    const guest = client(url);
    sockets.push(guest);
    await connected(guest);
    const guestSessionPromise = once(guest, C.EVENTS.SESSION);
    const joined = await emitAck(guest, C.EVENTS.JOIN_ROOM, {
      code: hostSession.code,
      name: 'Guest',
      inviteToken: hostSession.inviteToken
    });
    assert.strictEqual(joined.ok, true);
    const guestSession = await guestSessionPromise;
    assert.notStrictEqual(guestSession.playerId, hostSession.playerId);

    const hostReconnect = client(url);
    sockets.push(hostReconnect);
    await connected(hostReconnect);
    const hostRotatedPromise = once(hostReconnect, C.EVENTS.SESSION);
    const hostRejoined = await emitAck(hostReconnect, C.EVENTS.JOIN_ROOM, {
      code: hostSession.code,
      name: 'Host Again',
      sessionToken: hostSession.sessionToken
    });
    assert.strictEqual(hostRejoined.ok, true);
    const hostRotated = await hostRotatedPromise;
    assert.strictEqual(gameServer.rooms.getRoom(hostSession.code).hostId, hostSession.playerId, 'Host reconnect does not demote the host.');
    host = hostReconnect;

    const third = client(url);
    sockets.push(third);
    await connected(third);
    const rejectedThird = await emitAck(third, C.EVENTS.JOIN_ROOM, { code: hostSession.code, name: 'Third' });
    assert.strictEqual(rejectedThird.ok, false);
    assert.match(rejectedThird.reason, /two players/);

    const forged = client(url);
    sockets.push(forged);
    await connected(forged);
    const forgedJoin = await emitAck(forged, C.EVENTS.JOIN_ROOM, {
      code: hostSession.code,
      sessionToken: hostSession.sessionToken.slice(0, -2) + 'xx'
    });
    assert.strictEqual(forgedJoin.ok, false);

    const startedPromise = once(guest, C.EVENTS.DAY_STARTED);
    const started = await emitAck(host, C.EVENTS.START_DAY, { level: 1 });
    assert.strictEqual(started.ok, true);
    assert.strictEqual((await startedPromise).level, 1);

    const planted = await emitAck(host, C.EVENTS.SUBMIT_ACTION, {
      seq: 1,
      actionId: 'host-action-1',
      action: C.ACTIONS.PLANT,
      payload: { plotId: 'plot-1', crop: 'flour' }
    });
    assert.strictEqual(planted.ok, true);
    const duplicate = await emitAck(host, C.EVENTS.SUBMIT_ACTION, {
      seq: 2,
      actionId: 'host-action-1',
      action: C.ACTIONS.PLANT,
      payload: { plotId: 'plot-2', crop: 'sugar' }
    });
    assert.deepStrictEqual(duplicate, planted, 'Duplicate action id returns cached result.');
    const stale = await emitAck(host, C.EVENTS.SUBMIT_ACTION, {
      seq: 1,
      actionId: 'host-action-stale',
      action: C.ACTIONS.DROP_PAIL,
      payload: {}
    });
    assert.strictEqual(stale.code, 'stale');

    let rateRejected = false;
    for (let seq = 2; seq < 60; seq += 1) {
      const response = await emitAck(host, C.EVENTS.SUBMIT_ACTION, {
        seq,
        actionId: 'burst-' + seq,
        action: C.ACTIONS.DROP_PAIL,
        payload: {}
      });
      if (response.code === 'rate') {
        rateRejected = true;
        break;
      }
    }
    assert.strictEqual(rateRejected, true, 'Action burst is rate limited.');

    const room = gameServer.rooms.getRoom(hostSession.code);
    const oldGuestToken = guestSession.sessionToken;
    room.players.get(guestSession.playerId).lastSeq = 7;
    guest.disconnect();
    gameServer.rooms.finishDay(room, { level: 1, stars: 1, ratio: 0.5, spawned: 2, served: 1, missed: 1, coins: 10, tips: 0 });
    const dayTwo = await emitAck(host, C.EVENTS.START_DAY, { level: 1 });
    assert.strictEqual(dayTwo.ok, true);
    assert.strictEqual(room.players.get(hostSession.playerId).lastSeq, 0, 'Starting a new day resets action sequencing.');
    const dayTwoAction = await emitAck(host, C.EVENTS.SUBMIT_ACTION, {
      seq: 1,
      actionId: 'day-two-action-1',
      action: C.ACTIONS.PICKUP_PAIL,
      payload: {}
    });
    assert.strictEqual(dayTwoAction.ok, true);
    room.paused = true;
    const pausedAction = await emitAck(host, C.EVENTS.SUBMIT_ACTION, {
      seq: 2,
      actionId: 'paused-action',
      action: C.ACTIONS.DROP_PAIL,
      payload: {}
    });
    assert.strictEqual(pausedAction.code, 'paused', 'Paused days reject state-changing actions.');
    room.paused = false;
    const hostServerSocket = gameServer.io.sockets.sockets.get(host.id);
    assert.strictEqual(gameServer.rooms.requestSnapshot(hostServerSocket), true);
    assert.strictEqual(gameServer.rooms.requestSnapshot(hostServerSocket), false, 'Snapshot requests are coalesced.');

    const reconnect = client(url);
    sockets.push(reconnect);
    await connected(reconnect);
    const rotatedSessionPromise = once(reconnect, C.EVENTS.SESSION);
    const rejoined = await emitAck(reconnect, C.EVENTS.JOIN_ROOM, {
      code: hostSession.code,
      name: 'Guest Again',
      sessionToken: oldGuestToken
    });
    assert.strictEqual(rejoined.ok, true);
    assert.strictEqual(rejoined.reconnected, true);
    const rotated = await rotatedSessionPromise;
    assert.notStrictEqual(rotated.sessionToken, oldGuestToken, 'Reconnect token rotates.');
    assert.ok(room.state.players[guestSession.playerId], 'Reconnecting player is restored to a solo-started active day.');
    const guestDayTwoAction = await emitAck(reconnect, C.EVENTS.SUBMIT_ACTION, {
      seq: 1,
      actionId: 'guest-day-two-action-1',
      action: C.ACTIONS.PLANT,
      payload: { plotId: 'plot-2', crop: 'sugar' }
    });
    assert.notStrictEqual(guestDayTwoAction.code, 'stale');

    const staleReconnect = client(url);
    sockets.push(staleReconnect);
    await connected(staleReconnect);
    const oldTokenRejected = await emitAck(staleReconnect, C.EVENTS.JOIN_ROOM, {
      code: hostSession.code,
      sessionToken: oldGuestToken
    });
    assert.strictEqual(oldTokenRejected.ok, false);

    const soloHost = client(url);
    sockets.push(soloHost);
    await connected(soloHost);
    const soloSessionPromise = once(soloHost, C.EVENTS.SESSION);
    const soloCreated = await emitAck(soloHost, C.EVENTS.CREATE_ROOM, { name: 'Solo Host' });
    assert.strictEqual(soloCreated.ok, true);
    const soloSession = await soloSessionPromise;
    soloHost.disconnect();
    const replacement = client(url);
    sockets.push(replacement);
    await connected(replacement);
    const replacementSessionPromise = once(replacement, C.EVENTS.SESSION);
    const replacementJoin = await emitAck(replacement, C.EVENTS.JOIN_ROOM, { code: soloSession.code, name: 'Replacement' });
    assert.strictEqual(replacementJoin.ok, true);
    const replacementSession = await replacementSessionPromise;
    assert.strictEqual(gameServer.rooms.getRoom(soloSession.code).hostId, replacementSession.playerId, 'Connected replacement receives host ownership.');
    const replacementStart = await emitAck(replacement, C.EVENTS.START_DAY, { level: 1 });
    assert.strictEqual(replacementStart.ok, true);

    const expiredHost = client(url);
    sockets.push(expiredHost);
    await connected(expiredHost);
    const expiredSessionPromise = once(expiredHost, C.EVENTS.SESSION);
    const expiredCreated = await emitAck(expiredHost, C.EVENTS.CREATE_ROOM, { name: 'Expired Host' });
    assert.strictEqual(expiredCreated.ok, true);
    const expiredSession = await expiredSessionPromise;
    gameServer.rooms.getRoom(expiredSession.code).expiresAt = Date.now() - 1;
    const expiredGuest = client(url);
    sockets.push(expiredGuest);
    await connected(expiredGuest);
    const expiredJoin = await emitAck(expiredGuest, C.EVENTS.JOIN_ROOM, { code: expiredSession.code, name: 'Too Late' });
    assert.strictEqual(expiredJoin.ok, false);
    assert.match(expiredJoin.reason, /expired/);
    const createAfterExpiryPromise = once(expiredHost, C.EVENTS.SESSION);
    const createAfterExpiry = await emitAck(expiredHost, C.EVENTS.CREATE_ROOM, { name: 'Fresh Start' });
    assert.strictEqual(createAfterExpiry.ok, true, 'Expired room releases the socket for a new room.');
    await createAfterExpiryPromise;

    gameServer.rooms.createLimits.set('old-ip', { tokens: 0, updatedAt: Date.now() - 11 * 60 * 1000 });
    gameServer.rooms.cleanup();
    assert.strictEqual(gameServer.rooms.createLimits.has('old-ip'), false, 'Inactive limiter buckets are pruned.');

    const abortedPromise = once(host, C.EVENTS.ROOM_ABORTED);
    gameServer.rooms.abortAll('Test restart');
    const aborted = await abortedPromise;
    assert.strictEqual(aborted.progressAwarded, false);
    assert.match(aborted.reason, /Test restart/);
    const duringDrain = await emitAck(host, C.EVENTS.START_DAY, { level: 1 });
    assert.strictEqual(duringDrain.ok, false);
    const drainClient = client(url);
    sockets.push(drainClient);
    await connected(drainClient);
    const createDuringDrain = await emitAck(drainClient, C.EVENTS.CREATE_ROOM, { name: 'Too Late' });
    assert.strictEqual(createDuringDrain.ok, false, 'Global drain blocks new rooms.');

    console.log('server tests: protocol, rooms, actions, rate limits, reconnect, host transfer, expiry, abort passed');
  } finally {
    for (const socket of sockets) socket.disconnect();
    await gameServer.close('Test complete');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
