import * as Save from './save.js';

const C = window.GG.Constants;
const DEFAULT_SERVER = 'https://garden-and-griddle.onrender.com';

function detectServer() {
  const query = new URLSearchParams(location.search).get('server');
  if (query) return query.replace(/\/$/, '');
  const stored = Save.serverUrl().replace(/\/$/, '');
  if (stored) return stored;
  const capacitorLocal = location.protocol === 'https:' && location.hostname === 'localhost' && !location.port;
  return capacitorLocal ? DEFAULT_SERVER : '';
}

function socketUrl(serverUrl) {
  const target = new URL(serverUrl || location.origin, location.href);
  // Render's edge requires a leading application query before Engine.IO's EIO/transport parameters.
  target.searchParams.set('ggClient', '1');
  return target.toString();
}

export class Net {
  constructor() {
    this.serverUrl = detectServer();
    this.handlers = new Map();
    this.seq = 0;
    this.socket = window.io(socketUrl(this.serverUrl), {
      path: '/gg-realtime',
      transports: ['websocket', 'polling'],
      auth: { protocol: C.PROTOCOL, clientBuild: C.CLIENT_BUILD },
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 3000,
      timeout: 8000
    });
    this.socket.on('connect', () => this.emitLocal('status', { state: 'connected' }));
    this.socket.on('disconnect', (reason) => this.emitLocal('status', { state: 'disconnected', reason }));
    this.socket.on('connect_error', (error) => this.emitLocal('status', { state: 'error', reason: error.message }));
    for (const event of Object.values(C.EVENTS)) {
      this.socket.on(event, (payload) => this.emitLocal(event, payload));
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  emitLocal(event, payload) {
    for (const handler of this.handlers.get(event) || []) handler(payload);
  }

  emitAck(event, payload) {
    if (!this.socket.connected) return Promise.resolve({ ok: false, reason: 'Connection lost - action was not sent.', code: 'offline' });
    return new Promise((resolve) => {
      this.socket.timeout(5000).emit(event, payload || {}, (error, response) => {
        resolve(error ? { ok: false, reason: 'Server did not respond.' } : response);
      });
    });
  }

  create(name, campaign, restaurantName) {
    return this.emitAck(C.EVENTS.CREATE_ROOM, { name, campaign, restaurantName });
  }

  join(code, name, inviteToken) {
    return this.emitAck(C.EVENTS.JOIN_ROOM, {
      code,
      name,
      inviteToken: inviteToken || '',
      sessionToken: Save.sessionFor(code)
    });
  }

  start(level) {
    this.seq = 0;
    return this.emitAck(C.EVENTS.START_DAY, { level });
  }

  setRestaurantName(name) { return this.emitAck(C.EVENTS.SET_RESTAURANT_NAME, { name }); }

  action(action, payload) {
    this.seq += 1;
    const actionId = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random();
    return this.emitAck(C.EVENTS.SUBMIT_ACTION, { seq: this.seq, actionId, action, payload: payload || {} });
  }

  setSequence(lastSeq) {
    this.seq = Math.max(0, Math.floor(Number(lastSeq) || 0));
  }

  buyUpgrade(id) { return this.emitAck(C.EVENTS.BUY_UPGRADE, { id }); }
  pause() { return this.emitAck(C.EVENTS.PAUSE_REQUEST, {}); }
  votePause(approve) { return this.emitAck(C.EVENTS.PAUSE_VOTE, { approve }); }
  ping(kind) { this.socket.emit(C.EVENTS.PING, { kind }); }
  requestSnapshot() { this.socket.emit(C.EVENTS.REQUEST_SNAPSHOT); }
}
