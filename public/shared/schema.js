(function (root, factory) {
  const C = typeof module !== 'undefined' && module.exports
    ? require('./constants.js')
    : window.GG.Constants;
  const B = typeof module !== 'undefined' && module.exports
    ? require('./balance.js')
    : window.GG.Balance;
  const mod = factory(C, B);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') {
    window.GG = window.GG || {};
    window.GG.Schema = mod;
  }
})(this, function (C, B) {
  'use strict';

  function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
  }

  function blankUpgrades() {
    return Object.fromEntries(C.UPGRADE_IDS.map((id) => [id, 0]));
  }

  function normalizeUpgrades(input) {
    const upgrades = blankUpgrades();
    for (const id of C.UPGRADE_IDS) upgrades[id] = clampInt(input && input[id], 0, B.MAX_UPGRADE_TIER);
    return upgrades;
  }

  function normalizeCampaign(input) {
    const raw = input || {};
    const bestStars = {};
    for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
      const value = raw.bestStars && (raw.bestStars[level] !== undefined ? raw.bestStars[level] : raw.bestStars[String(level)]);
      bestStars[level] = clampInt(value, 0, 3);
    }
    return {
      version: 1,
      revision: clampInt(raw.revision, 0, 1000000000),
      unlockedLevel: clampInt(raw.unlockedLevel || 1, 1, C.MAX_LEVEL),
      stars: clampInt(raw.stars, 0, 9999),
      bestStars,
      upgrades: normalizeUpgrades(raw.upgrades)
    };
  }

  function makePlayer(id, name, color, pattern, seat) {
    return {
      id,
      seat,
      name: String(name || 'Player').slice(0, 20),
      color,
      pattern,
      connected: true,
      task: null,
      lastAction: null
    };
  }

  function createState(options) {
    const opts = options || {};
    const ids = Array.isArray(opts.playerIds) && opts.playerIds.length
      ? opts.playerIds.slice(0, C.MAX_PLAYERS)
      : ['p1', 'p2'];
    const level = B.compileLevel(opts.level || 1, ids.length);
    if (Number.isFinite(opts.daySeconds) && opts.daySeconds > 0) level.daySeconds = opts.daySeconds;
    if (Number.isFinite(opts.prepSeconds) && opts.prepSeconds >= 0) level.prepSeconds = opts.prepSeconds;
    const upgrades = normalizeUpgrades(opts.upgrades);
    const effects = B.effectsFor(upgrades);
    effects.burnGraceSeconds *= level.burnGraceMultiplier;
    const players = {};
    ids.forEach((id, index) => {
      players[id] = makePlayer(
        id,
        opts.playerNames && opts.playerNames[index],
        index === 0 ? '#e45b5b' : '#4f91d9',
        index === 0 ? 'stripe' : 'dot',
        Array.isArray(opts.playerSeats) ? opts.playerSeats[index] : index
      );
    });
    const seeds = {};
    const fridge = { flour: 0, sugar: 0, milk: 0, strawberry: 0, blackberry: 0, lemon: 0, banana: 0 };
    for (const crop of C.CROP_IDS) seeds[crop] = B.STARTING_SEEDS;
    return {
      version: 1,
      status: 'playing',
      seed: (Number(opts.seed) || 1) >>> 0,
      tick: 0,
      elapsed: 0,
      level,
      upgrades,
      effects,
      players,
      seeds,
      fridge,
      batter: 0,
      pail: { holder: null, water: 0, capacity: B.PAIL_CAPACITY },
      sink: { lockedBy: null },
      cow: { milk: 0, milkReadyAt: effects.milkRechargeSeconds, lockedBy: null },
      mixer: { state: 'idle', readyAt: 0, startedBy: null },
      plots: Array.from({ length: B.PLOT_COUNT }, (_, index) => ({
        id: 'plot-' + (index + 1),
        crop: null,
        state: 'empty',
        readyAt: 0,
        lockedBy: null
      })),
      stoves: Array.from({ length: B.STOVE_COUNT }, (_, index) => ({
        id: 'stove-' + (index + 1),
        state: 'empty',
        orderId: null,
        readyAt: 0,
        burnAt: 0,
        lockedBy: null
      })),
      orders: [],
      nextOrderAt: level.prepSeconds,
      orderSerial: 0,
      randomSerial: 0,
      eventSerial: 0,
      stats: { spawned: 0, served: 0, missed: 0, burnt: 0, waste: 0, coins: 0, tips: 0 },
      tutorial: {
        planted: Object.fromEntries(C.CROP_IDS.map((id) => [id, 0])),
        pailFilled: false,
        watered: 0,
        harvested: Object.fromEntries(C.CROP_IDS.map((id) => [id, 0])),
        milkCollected: 0,
        batterMixed: false,
        crepeStarted: false,
        served: false
      },
      events: [],
      result: null
    };
  }

  return {
    blankUpgrades,
    normalizeUpgrades,
    normalizeCampaign,
    createState
  };
});
