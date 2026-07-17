'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const C = require('../public/shared/constants.js');
const Sim = require('../public/shared/sim.js');
const { createGameServer } = require('../server.js');

function browserExecutable() {
  const candidates = [
    process.env.GG_CHROMIUM_PATH,
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright', 'chromium-1217', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('No Chromium browser found. Set GG_CHROMIUM_PATH.');
  return executable;
}

async function clickTarget(page, type, id, holdMs) {
  const point = await page.evaluate(({ type, id }) => window.game.render.clientPointForTarget(type, id), { type, id });
  assert.ok(point, 'Target should project into the canvas: ' + type + ':' + id);
  const picked = await page.evaluate(({ point }) => window.game.render.pick(point.x, point.y), { point });
  assert.deepStrictEqual(picked, { type, id }, 'Projected point should raycast the requested target.');
  await page.evaluate(async ({ point, holdMs }) => {
    const canvas = document.getElementById('game-canvas');
    const init = { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch', clientX: point.x, clientY: point.y };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    if (holdMs) await new Promise((resolve) => setTimeout(resolve, holdMs));
    canvas.dispatchEvent(new PointerEvent('pointerup', init));
  }, { point, holdMs: holdMs || 0 });
}

(async () => {
  const gameServer = createGameServer({ secret: 'browser-test', publicUrl: 'http://127.0.0.1' });
  const port = await gameServer.listen(0);
  const url = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  for (const page of [host, guest]) {
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('PAGEERROR', error.message);
    });
  }

  try {
    await host.goto(url, { waitUntil: 'load' });
    await host.waitForFunction(() => window.game && window.game.render);
    await host.waitForFunction(() => window.game.state.connected);
    await host.click('#open-settings-title');
    await host.check('#setting-reduced-motion');
    assert.strictEqual(await host.evaluate(() => document.body.classList.contains('reduced-motion') && window.game.render.reducedMotion), true);
    await host.click('#settings-modal .modal-close');
    await host.click('#open-help-title');
    await host.waitForSelector('#help-modal:not(.hidden)');
    await host.click('#help-modal .modal-close');
    await host.fill('#player-name', 'Host');
    await host.click('#create-room');
    await host.waitForSelector('#screen-room.active');
    const code = await host.textContent('#room-code');

    await guest.goto(url, { waitUntil: 'load' });
    await guest.waitForFunction(() => window.game && window.game.render);
    await guest.waitForFunction(() => window.game.state.connected);
    await guest.fill('#player-name', 'Guest');
    await guest.fill('#room-code-input', code);
    await guest.click('#join-room');
    await guest.waitForSelector('#screen-room.active');
    await host.waitForFunction(() => window.game.state.room && window.game.state.room.players.length === 2);

    await host.click('#start-day');
    await host.waitForSelector('#screen-game.active');
    await guest.waitForSelector('#screen-game.active');
    await host.waitForSelector('#tutorial-panel:not(.hidden)');
    assert.match(await host.textContent('#tutorial-list'), /Plant the ingredients/);
    const originalZoom = await host.evaluate(() => window.game.render.cameraZoom);
    await host.click('#camera-zoom-out');
    await host.click('#camera-zoom-out');
    await host.click('#camera-zoom-out');
    const farZoom = await host.evaluate(() => window.game.render.cameraZoom);
    assert.ok(farZoom < originalZoom * 0.55, 'Phone camera can zoom much farther out.');
    await host.evaluate(() => window.game.render.panBy(-10000, -10000));
    const farPan = await host.evaluate(() => ({ x: window.game.render.cameraPan.x, z: window.game.render.cameraPan.z }));
    assert.deepStrictEqual(farPan, { x: 24, z: 16 }, 'Camera can pan across the expanded scene range.');
    await host.click('#camera-fit');
    assert.strictEqual(await host.evaluate(() => window.game.render.cameraPan.length()), 0);
    await host.click('#camera-right');
    await host.click('#camera-down');
    assert.deepStrictEqual(await host.evaluate(() => ({ x: window.game.render.cameraPan.x, z: window.game.render.cameraPan.z })), { x: 4, z: 3 });
    await host.click('#camera-fit');
    const room = gameServer.rooms.getRoom(code);
    room.state.effects.plantSeconds = 0.1;
    room.state.effects.waterSeconds = 0.1;
    room.state.effects.fillPailSeconds = 0.1;
    room.state.effects.harvestSeconds = 0.1;
    room.state.effects.growthMultiplier = 0.08;

    await clickTarget(host, 'plot', 'plot-1');
    await host.waitForSelector('#crop-modal:not(.hidden)');
    await host.click('#crop-options .crop-option');
    await host.waitForFunction(() => window.game.state.snapshot.plots[0].state === 'dry');
    assert.match(await host.textContent('#selected-crop'), /Wheat/);
    await clickTarget(host, 'plot', 'plot-2');
    await host.waitForFunction(() => window.game.state.snapshot.plots[1].state === 'dry');
    await clickTarget(host, 'pail', 'pail');
    await host.waitForFunction(() => window.game.state.snapshot.pail.holder === window.game.state.session.playerId);
    await clickTarget(host, 'sink', 'sink');
    await host.waitForFunction(() => window.game.state.snapshot.pail.water === 5);
    await host.waitForFunction(() => document.querySelectorAll('#tutorial-list .tutorial-task.done').length >= 1);
    await clickTarget(host, 'plot', 'plot-1');
    await host.waitForFunction(() => window.game.state.snapshot.plots[0].state === 'growing');
    await host.waitForFunction(() => window.game.state.snapshot.plots[0].state === 'ripe', null, { timeout: 7000 });
    await clickTarget(host, 'plot', 'plot-1');
    await host.waitForFunction(() => window.game.state.snapshot.fridge.flour >= 3);
    const harvested = await host.evaluate(() => window.game.state.snapshot.fridge.flour);
    assert.ok(harvested >= 3, 'Touch workflow should harvest flour.');

    room.state.fridge.flour = 20;
    room.state.fridge.sugar = 20;
    room.state.fridge.milk = 20;
    room.state.fridge.strawberry = 20;
    room.state.fridge.blackberry = 20;
    room.state.fridge.lemon = 20;
    room.state.fridge.banana = 20;
    room.state.batter = 10;
    room.state.effects.cookSeconds = 0.2;
    room.state.effects.serveSeconds = 0.1;
    room.state.nextOrderAt = room.state.elapsed;
    Sim.step(room.state, 0.05);
    gameServer.io.to(code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));

    await host.waitForSelector('.order-ticket:not([disabled])');
    await host.click('.order-ticket:not([disabled])');
    await clickTarget(host, 'stove', 'stove-1');
    await host.waitForFunction(() => window.game.state.snapshot.stoves[0].state === 'needsFlip');
    await host.waitForFunction(() => window.game.render.stoveViews.get('stove-1').crepe.material.map === null);
    const flipResult = await host.evaluate(() => window.game.interact({ type: 'stove', id: 'stove-1' }, false));
    assert.strictEqual(flipResult.ok, true);
    await host.waitForFunction(() => ['cookingSecond', 'ready'].includes(window.game.state.snapshot.stoves[0].state));
    await host.waitForFunction(() => !!window.game.render.stoveViews.get('stove-1').crepe.material.map);
    await host.waitForFunction(() => window.game.state.snapshot.stoves[0].state === 'ready');
    await clickTarget(host, 'stove', 'stove-1');
    await host.waitForFunction(() => window.game.state.snapshot.stats.served >= 1);
    await host.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });
    assert.strictEqual(await host.evaluate(() => window.game.graphicsLost), true);
    await host.evaluate(() => document.getElementById('game-canvas').dispatchEvent(new Event('webglcontextrestored')));
    assert.strictEqual(await host.evaluate(() => window.game.graphicsLost), false);

    await guest.evaluate(() => window.game.render.panBy(100, 0));
    const cameraState = await Promise.all([
      host.evaluate(() => window.game.render.cameraPan.x),
      guest.evaluate(() => window.game.render.cameraPan.x)
    ]);
    assert.notStrictEqual(cameraState[0], cameraState[1], 'Camera state is client-local.');

    room.state.pail.holder = null;
    gameServer.io.to(code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
    for (const page of [host, guest]) {
      await page.evaluate(() => {
        const original = window.game.ui.toast.bind(window.game.ui);
        window.game.ui.toast = (message, reject) => {
          window._lastToast = { message, reject: !!reject };
          original(message, reject);
        };
      });
    }
    const conflict = await Promise.all([
      host.evaluate(() => window.game.sendAction(window.GG.Constants.ACTIONS.PICKUP_PAIL, {})),
      guest.evaluate(() => window.game.sendAction(window.GG.Constants.ACTIONS.PICKUP_PAIL, {}))
    ]);
    assert.strictEqual(conflict.filter((result) => result.ok).length, 1, 'Exactly one client wins a shared-resource race.');
    const losingPage = conflict[0].ok ? guest : host;
    const rejectionToast = await losingPage.evaluate(() => window._lastToast);
    assert.strictEqual(rejectionToast.reject, true, 'Losing client shows non-blocking rejection feedback.');

    await host.evaluate(() => window.game.net.socket.disconnect());
    await host.waitForFunction(() => !window.game.state.connected);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const holderAfterDisconnect = room.state.pail.holder;
    const offlineAction = await host.evaluate(() => window.game.sendAction(window.GG.Constants.ACTIONS.DROP_PAIL, {}));
    assert.strictEqual(offlineAction.code, 'offline');
    assert.strictEqual(room.state.pail.holder, holderAfterDisconnect, 'Offline action is not buffered into the room.');
    await host.evaluate(() => window.game.net.socket.connect());
    await host.waitForFunction(() => window.game.state.connected && !window.game.state.rejoining);
    const resumedAction = await host.evaluate(() => window.game.sendAction(window.GG.Constants.ACTIONS.PICKUP_PAIL, {}));
    assert.notStrictEqual(resumedAction.code, 'stale', 'Reconnect restores the server action sequence.');

    await host.waitForTimeout(500);
    const hostState = await host.evaluate(() => ({
      tick: window.game.state.snapshot.tick,
      served: window.game.state.snapshot.stats.served,
      batter: window.game.state.snapshot.batter,
      metrics: window.game.render.metrics()
    }));
    const guestState = await guest.evaluate(() => ({
      served: window.game.state.snapshot.stats.served,
      batter: window.game.state.snapshot.batter
    }));
    assert.strictEqual(hostState.served, guestState.served);
    assert.strictEqual(hostState.batter, guestState.batter);
    const cropIds = C.CROP_IDS;
    room.state.plots.forEach((plot, index) => {
      plot.crop = cropIds[index % cropIds.length];
      plot.state = 'ripe';
      plot.readyAt = room.state.elapsed;
    });
    room.state.orders = Array.from({ length: 8 }, (_, index) => ({
      id: 'peak-' + index,
      recipeId: C.RECIPES[index % C.RECIPES.length].id,
      status: 'waiting',
      createdAt: room.state.elapsed,
      expiresAt: room.state.elapsed + 30,
      stoveId: null,
      assignedBy: null,
      payAt: 0,
      tip: 0
    }));
    room.state.stoves.forEach((stove, index) => {
      stove.state = 'cookingSecond';
      stove.orderId = room.state.orders[index].id;
      stove.readyAt = room.state.elapsed + 5;
      stove.burnAt = room.state.elapsed + 10;
    });
    room.state.mixer = { state: 'mixing', startedAt: room.state.elapsed, readyAt: room.state.elapsed + 5, startedBy: room.state.players[Object.keys(room.state.players)[0]].id };
    gameServer.io.to(code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
    await host.waitForFunction(() => {
      return window.game.state.snapshot.stoves.every((stove) => stove.state === 'cookingSecond')
        && [...window.game.render.stoveViews.values()].every((view) => !!view.crepe.material.map);
    });
    const peakMetrics = await host.evaluate(() => window.game.render.metrics());
    assert.ok(peakMetrics.calls < 120, 'Worst-case draw calls stay under the planned budget: ' + peakMetrics.calls);
    assert.ok(peakMetrics.triangles < 250000, 'Worst-case triangles stay under the planned budget: ' + peakMetrics.triangles);
    const toppingAtlasActive = await host.evaluate(() => {
      return [...window.game.render.stoveViews.values()].every((view) => view.crepe.material.map && view.crepe.material.map.image.width > 0);
    });
    assert.strictEqual(toppingAtlasActive, true, 'Topping atlas textures are active.');

    room.expiresAt = Date.now() - 1;
    await host.evaluate(() => window.game.net.socket.disconnect());
    await host.evaluate(() => window.game.net.socket.connect());
    await host.waitForFunction(() => window.game.state.screen === 'title' && !window.game.state.rejoining);
    assert.deepStrictEqual(errors, []);
    console.log('browser tests: two-client touch workflow, convergence, rejection recovery, graphics budgets passed');
  } finally {
    await browser.close();
    await gameServer.close('Browser test complete');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
