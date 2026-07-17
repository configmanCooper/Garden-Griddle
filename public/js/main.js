import { Render3D } from './render3d.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Net } from './net.js';
import { State } from './state.js';
import * as Save from './save.js';
import * as Audio from './audio.js';

const C = window.GG.Constants;

class Game {
  constructor() {
    this.state = State;
    this.save = Save.load();
    this.pendingInvite = this.parseInvite();
    this.net = new Net();
    this.ui = new UI(this);
    this.ui.setTitleValues(this.save, this.net.serverUrl);
    this.ui.updateSelectedCrop(this.state.selectedCropId);
    Audio.configure(this.save.settings);
    try {
      this.render = new Render3D(document.getElementById('game-canvas'));
    } catch (error) {
      if (error.message === 'WEBGL2_UNAVAILABLE') document.getElementById('unsupported').classList.remove('hidden');
      throw error;
    }
    this.applySettings();
    this.input = new Input(document.getElementById('game-canvas'), this.render, this);
    this.keysDown = new Set();
    this.lastLoopTime = performance.now();
    this.bindNetwork();
    this.bindGlobal();
    this.lastSnapshotEventCount = 0;
    this.seenEventIds = new Set();
    this.graphicsLost = false;
    this.debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
    document.getElementById('debug-overlay').classList.toggle('hidden', !this.debugEnabled);
    this.lastDebugAt = 0;
    window.game = this;
    requestAnimationFrame((time) => this.loop(time));
  }

  handleBack(appPlugin) {
    if (this.ui.closeTopModal()) return;
    if (this.state.screen === 'game') {
      this.pause();
      return;
    }
    if (this.state.screen === 'results') {
      this.ui.show('room');
      return;
    }
    if (this.state.screen === 'room') {
      if (appPlugin && appPlugin.minimizeApp) appPlugin.minimizeApp();
      return;
    }
    if (appPlugin && appPlugin.minimizeApp) appPlugin.minimizeApp();
  }

  bindGlobal() {
    window.addEventListener('pointerdown', () => Audio.unlock(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.state.screen === 'game') this.net.requestSnapshot();
    });
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.graphicsLost = true;
      this.ui.toast('Graphics paused - restoring...', true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.graphicsLost = false;
      this.net.requestSnapshot();
      this.ui.toast('Graphics restored.');
    });
    window.addEventListener('keydown', (event) => {
      const typing = event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
        || event.target.isContentEditable;
      const key = String(event.key || '').toLowerCase();
      if (!typing && ['w', 'a', 's', 'd'].includes(key)) {
        this.keysDown.add(key);
        event.preventDefault();
      }
      if (event.code === 'Escape') this.clearSelection();
      if (!typing && event.code === 'Space' && this.state.screen === 'game') this.pause();
    });
    window.addEventListener('keyup', (event) => {
      this.keysDown.delete(String(event.key || '').toLowerCase());
    });
    window.addEventListener('blur', () => this.keysDown.clear());
    const appPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (appPlugin && appPlugin.addListener) {
      appPlugin.addListener('appUrlOpen', ({ url }) => this.handleInviteUrl(url));
      if (appPlugin.getLaunchUrl) {
        appPlugin.getLaunchUrl().then((result) => {
          if (result && result.url) this.handleInviteUrl(result.url);
        }).catch(() => {});
      }
      appPlugin.addListener('backButton', () => this.handleBack(appPlugin));
    }
  }

  bindNetwork() {
    this.net.on('status', async (status) => {
      this.state.connected = status.state === 'connected';
      if (status.state !== 'connected' && this.state.session) this.state.rejoining = true;
      this.ui.setConnection(status);
      if (status.state === 'connected' && this.state.session) {
        const result = await this.net.join(this.state.session.code, this.save.playerName, this.state.session.inviteToken);
        if (!result.ok) {
          this.state.session = null;
          this.state.room = null;
          this.state.snapshot = null;
          this.state.rejoining = false;
          this.ui.show('title');
          this.ui.toast(result.reason || 'The previous room is no longer available.', true);
        }
      }
    });
    this.net.on(C.EVENTS.SESSION, (session) => {
      this.state.session = session;
      this.pendingInvite = null;
      this.net.setSequence(session.lastSeq);
      Save.storeSession(session.code, session.sessionToken);
      this.syncCampaign(session.campaign);
      this.ui.show('room');
    });
    this.net.on(C.EVENTS.ROOM_UPDATE, (room) => {
      this.state.room = room;
      if (room.restaurantName) {
        this.save.restaurantName = room.restaurantName;
        Save.write(this.save);
        this.render.setRestaurantName(room.restaurantName);
      }
      this.syncCampaign(room.campaign);
      this.ui.updateRoom(room, this.state.session);
      if (room.status === 'lobby' || room.status === 'results') {
        if (this.state.screen !== 'results') this.ui.show('room');
      }
    });
    this.net.on(C.EVENTS.DAY_STARTED, () => {
      this.state.selectedOrderId = null;
      this.ui.show('game');
      this.ui.toast('The restaurant is open!');
    });
    this.net.on(C.EVENTS.SNAPSHOT, (snapshot) => {
      if (this.state.selectedOrderId) {
        const selected = snapshot.orders.find((order) => order.id === this.state.selectedOrderId);
        if (!selected || selected.status !== 'waiting') this.state.selectedOrderId = null;
      }
      this.state.snapshot = snapshot;
      this.state.rejoining = false;
      this.ui.updateSnapshot(snapshot, this.state);
      this.playNewEvents(snapshot);
    });
    this.net.on(C.EVENTS.ACTION_RESULT, (result) => {
      this.state.lastActionResult = result;
      if (!result.ok) {
        Audio.sfx.deny();
        Audio.vibrate(30);
        this.ui.toast(result.reason || 'Your partner got there first.', true);
      }
    });
    this.net.on(C.EVENTS.DAY_ENDED, (payload) => {
      this.syncCampaign(payload.campaign);
      Audio.sfx.star();
      this.ui.results(payload);
    });
    this.net.on(C.EVENTS.CAMPAIGN_UPDATE, ({ campaign }) => {
      this.syncCampaign(campaign);
      if (this.state.room) this.state.room.campaign = campaign;
      this.ui.updateRoom(this.state.room, this.state.session);
    });
    this.net.on(C.EVENTS.PAUSE_UPDATE, (payload) => {
      this.state.paused = payload.paused;
      this.ui.setPaused(payload.paused, payload.vote);
    });
    this.net.on(C.EVENTS.PARTNER_PING, (payload) => {
      const labels = { garden: 'Partner: I will handle the garden', cook: 'Partner: I will cook', milk: 'Partner needs milk', rush: 'Partner: rush order!' };
      this.ui.toast(labels[payload.kind] || 'Partner ping');
    });
    this.net.on(C.EVENTS.ERROR, (payload) => this.ui.toast(payload.reason || payload.msg || 'Server error', true));
    this.net.on(C.EVENTS.ROOM_ABORTED, (payload) => {
      this.state.session = null;
      this.state.room = null;
      this.state.snapshot = null;
      this.ui.show('title');
      this.ui.toast((payload.reason || 'Room closed') + ' - no progress was awarded.', true);
    });
  }

  playNewEvents(snapshot) {
    const events = snapshot.events || [];
    for (const event of events) {
      if (this.seenEventIds.has(event.id)) continue;
      this.seenEventIds.add(event.id);
      if (this.seenEventIds.size > 200) this.seenEventIds.delete(this.seenEventIds.values().next().value);
      if (event.type === 'cropReady' || event.type === 'crepeReady') Audio.sfx.ready();
      else if (event.type === 'crepeNeedsFlip') {
        Audio.sfx.ready();
        this.ui.toast('Flip ' + String(event.stoveId || 'the stove').replace('-', ' ') + ' now!');
      }
      else if (event.type === 'crepeFlipped') Audio.sfx.flip();
      else if (event.type === 'harvested') Audio.sfx.harvest();
      else if (event.type === 'milked') Audio.sfx.milk();
      else if (event.type === 'served') Audio.sfx.serve();
    }
  }

  parseInvite() {
    const parts = location.pathname.match(/\/join\/([A-Z0-9]{6})/i);
    const query = new URLSearchParams(location.search);
    const code = parts ? parts[1].toUpperCase() : query.get('room');
    const inviteToken = query.get('invite') || '';
    if (code) document.addEventListener('DOMContentLoaded', () => { document.getElementById('room-code-input').value = code; });
    return code ? { code, inviteToken } : null;
  }

  handleInviteUrl(url) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/join\/([A-Z0-9]{6})/i);
      if (!match) return;
      const code = match[1].toUpperCase();
      if (this.state.session) {
        if (this.state.session.code === code) this.ui.show('room');
        else this.ui.toast('You are already in a restaurant room.', true);
        return;
      }
      this.pendingInvite = { code, inviteToken: parsed.searchParams.get('invite') || '' };
      document.getElementById('room-code-input').value = this.pendingInvite.code;
      this.ui.show('title');
      this.ui.toast('Invitation ready - tap Join.');
    } catch (_error) {}
  }

  playerName() {
    const name = document.getElementById('player-name').value.trim() || 'Player';
    this.save.playerName = name;
    Save.write(this.save);
    return name;
  }

  async createRoom() {
    Audio.unlock();
    const result = await this.net.create(this.playerName(), this.save.campaign, this.save.restaurantName);
    if (!result.ok) this.ui.toast(result.reason, true);
  }

  async joinRoom() {
    Audio.unlock();
    const input = document.getElementById('room-code-input');
    const code = (this.pendingInvite && this.pendingInvite.code) || input.value.trim().toUpperCase();
    const invite = this.pendingInvite && this.pendingInvite.code === code ? this.pendingInvite.inviteToken : '';
    if (code.length !== 6) return this.ui.toast('Enter the six-character room code.', true);
    const result = await this.net.join(code, this.playerName(), invite);
    if (!result.ok) this.ui.toast(result.reason, true);
  }

  async startDay(level) {
    const result = await this.net.start(level);
    if (!result.ok) this.ui.toast(result.reason, true);
  }

  async setRestaurantName(name) {
    const result = await this.net.setRestaurantName(String(name || '').trim());
    if (!result.ok) this.ui.toast(result.reason, true);
  }

  async buyUpgrade(id) {
    const result = await this.net.buyUpgrade(id);
    if (!result.ok) this.ui.toast(result.reason, true);
    else {
      Audio.sfx.tap();
      this.ui.toast('Upgrade purchased!');
    }
  }

  saveServer() {
    const url = document.getElementById('server-url').value.trim().replace(/\/$/, '');
    Save.storeServerUrl(url);
    location.reload();
  }

  async shareRoom() {
    if (!this.state.session) return;
    const text = 'Join my Garden & Griddle restaurant: ' + this.state.session.inviteUrl;
    try {
      const nativeShare = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
      if (nativeShare && nativeShare.share) await nativeShare.share({ title: 'Garden & Griddle', text, url: this.state.session.inviteUrl, dialogTitle: 'Invite your partner' });
      else if (navigator.share) await navigator.share({ title: 'Garden & Griddle', text, url: this.state.session.inviteUrl });
      else {
        await navigator.clipboard.writeText(this.state.session.inviteUrl);
        this.ui.toast('Invite link copied!');
      }
    } catch (_error) {}
  }

  syncCampaign(campaign) {
    if (!campaign) return;
    this.save.campaign = Save.acceptCampaign(this.save.campaign, campaign);
    Save.write(this.save);
  }

  updateSetting(key, value) {
    this.save.settings[key] = value;
    Save.write(this.save);
    this.applySettings();
  }

  applySettings() {
    Audio.configure(this.save.settings);
    document.body.classList.toggle('reduced-motion', !!this.save.settings.reducedMotion);
    document.body.classList.toggle('high-contrast', !!this.save.settings.highContrast);
    if (this.render) this.render.setReducedMotion(this.save.settings.reducedMotion);
  }

  isPlaying() {
    return this.state.screen === 'game' && !!this.state.snapshot && this.state.snapshot.status === 'playing'
      && this.state.connected && !this.state.rejoining && !this.state.paused;
  }

  shouldHold(target) {
    return false;
  }

  showHoldProgress(show) {
    this.ui.setProgress(show, show ? 0.45 : 0);
  }

  interact(target, held) {
    if (!target || !this.state.snapshot) return;
    Audio.unlock();
    if (target.type === 'plot') {
      const plot = this.state.snapshot.plots.find((item) => item.id === target.id);
      if (!plot) return;
      if (plot.state === 'empty') {
        if (this.state.snapshot.pail.holder === this.state.session.playerId) return this.ui.toast('Put down the pail before planting.', true);
        if (this.state.selectedCropId) return this.plant(plot.id, this.state.selectedCropId);
        return this.ui.chooseCrop(plot.id);
      }
      if (plot.state === 'dry') {
        const hasPail = this.state.snapshot.pail.holder === this.state.session.playerId;
        if (!hasPail) return this.ui.toast('Pick up the pail first.', true);
        if (this.state.snapshot.pail.water <= 0) return this.ui.toast('The pail is empty. Fill it at the kitchen sink.', true);
        return this.sendAction(C.ACTIONS.WATER, { plotId: plot.id }, Audio.sfx.water);
      }
      if (plot.state === 'ripe') return this.sendAction(C.ACTIONS.HARVEST, { plotId: plot.id }, Audio.sfx.harvest);
      return this.ui.toast('This crop is still growing.');
    }
    if (target.type === 'pail') {
      const mine = this.state.snapshot.pail.holder === this.state.session.playerId;
      return this.sendAction(mine ? C.ACTIONS.DROP_PAIL : C.ACTIONS.PICKUP_PAIL, {}, Audio.sfx.tap);
    }
    if (target.type === 'sink') return this.sendAction(C.ACTIONS.FILL_PAIL, {}, Audio.sfx.water);
    if (target.type === 'cow') return this.sendAction(C.ACTIONS.MILK, {}, Audio.sfx.milk);
    if (target.type === 'mixer') return this.sendAction(C.ACTIONS.MIX_BATTER, {}, Audio.sfx.tap);
    if (target.type === 'stove') {
      const stove = this.state.snapshot.stoves.find((item) => item.id === target.id);
      if (stove.state === 'empty') {
        if (!this.state.selectedOrderId) return this.ui.toast('Select an order ticket first.', true);
        const orderId = this.state.selectedOrderId;
        this.state.selectedOrderId = null;
        return this.sendAction(C.ACTIONS.START_CREPE, { stoveId: stove.id, orderId }, Audio.sfx.cook);
      }
      if (stove.state === 'needsFlip') return this.sendAction(C.ACTIONS.FLIP_CREPE, { stoveId: stove.id });
      if (stove.state === 'ready') return this.sendAction(C.ACTIONS.SERVE_CREPE, { stoveId: stove.id }, Audio.sfx.serve);
      if (stove.state === 'burnt') return this.sendAction(C.ACTIONS.CLEAR_BURNT, { stoveId: stove.id }, Audio.sfx.tap);
      return this.ui.toast('That crepe is cooking.');
    }
    this.clearSelection();
  }

  plant(plotId, crop) {
    this.sendAction(C.ACTIONS.PLANT, { plotId, crop }, Audio.sfx.plant);
  }

  selectCrop(cropId, plotId) {
    this.state.selectedCropId = cropId;
    this.ui.updateSelectedCrop(cropId);
    if (plotId) this.plant(plotId, cropId);
  }

  selectOrder(orderId) {
    this.state.selectedOrderId = this.state.selectedOrderId === orderId ? null : orderId;
    this.ui.updateSnapshot(this.state.snapshot, this.state);
  }

  clearSelection() {
    this.state.selectedOrderId = null;
    if (this.state.snapshot) this.ui.updateSnapshot(this.state.snapshot, this.state);
  }

  dropHeldItem() {
    if (!this.state.snapshot || this.state.snapshot.pail.holder !== this.state.session.playerId) return;
    this.sendAction(C.ACTIONS.DROP_PAIL, {}, Audio.sfx.tap);
  }

  async sendAction(action, payload, sound) {
    const result = await this.net.action(action, payload);
    if (result.ok) {
      if (sound) sound();
      Audio.vibrate(10);
    } else {
      Audio.sfx.deny();
      this.ui.toast(result.reason || 'Action rejected.', true);
    }
    return result;
  }

  async pause() {
    if (!this.state.room) return;
    const result = this.state.paused || (document.getElementById('pause-banner').textContent.includes('requested'))
      ? await this.net.votePause(true)
      : await this.net.pause();
    if (!result.ok) this.ui.toast(result.reason, true);
  }

  ping(kind) {
    this.net.ping(kind);
    this.ui.toast('Ping sent');
  }

  zoomCamera(amount) {
    this.render.zoomBy(amount);
  }

  panCamera(dx, dz) {
    this.render.panWorld(dx, dz);
  }

  resetCamera() {
    this.render.resetView();
  }

  updateKeyboardPan(time) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastLoopTime) / 1000));
    this.lastLoopTime = time;
    if (this.state.screen !== 'game' || !this.keysDown.size) return;
    const speed = 10;
    let dx = 0;
    let dz = 0;
    if (this.keysDown.has('a')) dx -= speed * dt;
    if (this.keysDown.has('d')) dx += speed * dt;
    if (this.keysDown.has('w')) dz -= speed * dt;
    if (this.keysDown.has('s')) dz += speed * dt;
    if (dx || dz) this.render.panWorld(dx, dz);
  }

  loop(time) {
    this.updateKeyboardPan(time);
    if (this.state.snapshot) this.render.update(this.state.snapshot, this.state.session);
    if (!this.graphicsLost) this.render.render(time);
    if (this.debugEnabled && time - this.lastDebugAt > 500) {
      this.lastDebugAt = time;
      const metrics = this.render.metrics();
      document.getElementById('debug-overlay').textContent = Math.round(metrics.fps) + ' FPS | ' + metrics.calls + ' calls | '
        + metrics.triangles + ' tris | ' + metrics.geometries + ' geo';
    }
    requestAnimationFrame((next) => this.loop(next));
  }
}

new Game();
