'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const C = require('./public/shared/constants.js');
const Sim = require('./public/shared/sim.js');
const { createGameServer } = require('./server.js');

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

(async () => {
  const output = path.join(__dirname, 'play-assets', 'screenshots');
  fs.mkdirSync(output, { recursive: true });
  const server = createGameServer({ secret: 'screenshot', publicUrl: 'https://garden-and-griddle.onrender.com' });
  const port = await server.listen(0);
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'load' });
    await page.waitForFunction(() => window.game && window.game.state.connected);
    await page.screenshot({ path: path.join(output, '01-title.png') });
    await page.fill('#player-name', 'Chef Hazel');
    await page.click('#create-room');
    await page.waitForSelector('#screen-room.active');
    await page.click('#start-day');
    await page.waitForSelector('#screen-game.active');
    const code = await page.evaluate(() => window.game.state.session.code);
    const room = server.rooms.getRoom(code);
    room.state.elapsed = 52;
    room.state.fridge = { flour: 12, sugar: 9, milk: 7, strawberry: 8, blackberry: 6, lemon: 5, banana: 4 };
    room.state.batter = 16;
    room.state.plots.forEach((plot, index) => {
      plot.crop = C.CROP_IDS[index % C.CROP_IDS.length];
      plot.state = index % 3 === 0 ? 'ripe' : 'growing';
      plot.readyAt = room.state.elapsed + 4 + index * 0.4;
    });
    room.state.nextOrderAt = room.state.elapsed;
    for (let i = 0; i < 5; i += 1) {
      Sim.step(room.state, 0.05);
      room.state.nextOrderAt = room.state.elapsed;
    }
    room.state.stoves[0].state = 'cooking';
    room.state.stoves[0].orderId = room.state.orders[0] && room.state.orders[0].id;
    room.state.stoves[0].readyAt = room.state.elapsed + 3;
    room.state.stoves[0].burnAt = room.state.elapsed + 8;
    room.state.stoves[1].state = 'ready';
    room.state.stoves[1].orderId = room.state.orders[1] && room.state.orders[1].id;
    room.state.stoves[1].readyAt = room.state.elapsed;
    room.state.stoves[1].burnAt = room.state.elapsed + 5;
    server.io.to(code).emit(C.EVENTS.SNAPSHOT, Sim.snapshot(room.state));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(output, '02-gameplay.png') });
    console.log('Generated Play screenshots.');
  } finally {
    await browser.close();
    await server.close('Screenshot complete');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

