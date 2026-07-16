'use strict';

const assert = require('assert');
const C = require('../public/shared/constants.js');
const B = require('../public/shared/balance.js');
const S = require('../public/shared/schema.js');
const Sim = require('../public/shared/sim.js');

let assertions = 0;
function equal(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
  assertions += 1;
}
function truthy(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function fresh(options) {
  return S.createState(Object.assign({ level: 1, seed: 12345, playerIds: ['p1', 'p2'] }, options || {}));
}

function complete(state, seconds) {
  Sim.advance(state, seconds, 0.05);
}

function testInitialState() {
  const state = fresh();
  equal(state.plots.length, 12, 'The garden has twelve plots.');
  equal(state.stoves.length, 3, 'The kitchen has three stovetops.');
  for (const crop of C.CROP_IDS) equal(state.seeds[crop], 20, crop + ' starts with twenty seeds.');
  equal(state.batter, 0, 'Batter starts empty.');
  equal(state.cow.milk, 0, 'Cow starts recharging.');
}

function testGardenLoop() {
  const state = fresh();
  let result = Sim.applyAction(state, 'p1', C.ACTIONS.PLANT, { plotId: 'plot-1', crop: 'flour' });
  truthy(result.ok, 'Plant action begins.');
  result = Sim.applyAction(state, 'p2', C.ACTIONS.PLANT, { plotId: 'plot-1', crop: 'sugar' });
  equal(result.code, 'taken', 'A simultaneous plant race has one winner.');
  complete(state, state.effects.plantSeconds + 0.01);
  equal(state.plots[0].state, 'dry', 'Planting produces a dry crop.');
  equal(state.seeds.flour, 19, 'Planting consumes one seed.');
  complete(state, 5);
  equal(state.plots[0].state, 'dry', 'Dry crops do not grow.');
  truthy(Sim.applyAction(state, 'p1', C.ACTIONS.PICKUP_PAIL).ok, 'Player can pick up the pail.');
  equal(Sim.applyAction(state, 'p2', C.ACTIONS.PICKUP_PAIL).code, 'taken', 'Only one player can hold the pail.');
  truthy(Sim.applyAction(state, 'p1', C.ACTIONS.WATER, { plotId: 'plot-1' }).ok, 'Watering begins.');
  complete(state, state.effects.waterSeconds + 0.01);
  equal(state.plots[0].state, 'growing', 'Watering starts growth.');
  complete(state, C.CROPS.flour.growSeconds * state.effects.growthMultiplier + 0.02);
  equal(state.plots[0].state, 'ripe', 'Crop ripens at its authored time.');
  truthy(Sim.applyAction(state, 'p2', C.ACTIONS.HARVEST, { plotId: 'plot-1' }).ok, 'Either player can harvest.');
  equal(Sim.applyAction(state, 'p1', C.ACTIONS.HARVEST, { plotId: 'plot-1' }).code, 'taken', 'Harvest race has one winner.');
  complete(state, state.effects.harvestSeconds + 0.01);
  equal(state.fridge.flour, 3, 'Harvest enters the shared fridge.');
  equal(state.plots[0].state, 'empty', 'Harvest clears the plot.');
}

function testSeedReservation() {
  const state = fresh();
  state.seeds.flour = 1;
  truthy(Sim.applyAction(state, 'p1', C.ACTIONS.PLANT, { plotId: 'plot-1', crop: 'flour' }).ok, 'Last seed can be reserved.');
  equal(Sim.applyAction(state, 'p2', C.ACTIONS.PLANT, { plotId: 'plot-2', crop: 'flour' }).code, 'resource', 'Reserved seed cannot be double-spent.');
  Sim.applyAction(state, 'p1', C.ACTIONS.CANCEL_TASK);
  equal(state.seeds.flour, 1, 'Cancelling planting refunds its reserved seed.');
}

function testDisconnectReleasesLocks() {
  const state = fresh();
  Sim.applyAction(state, 'p1', C.ACTIONS.PLANT, { plotId: 'plot-1', crop: 'lemon' });
  Sim.applyAction(state, 'p1', C.ACTIONS.PICKUP_PAIL);
  Sim.disconnectPlayer(state, 'p1');
  equal(state.plots[0].lockedBy, null, 'Disconnect releases plot locks.');
  equal(state.pail.holder, null, 'Disconnect drops the pail.');
  equal(state.players.p1.task, null, 'Disconnect cancels timed action.');
  equal(state.seeds.lemon, 20, 'Cancelled planting does not consume a seed.');
}

function testCow() {
  const state = fresh();
  complete(state, state.effects.milkRechargeSeconds + 0.01);
  equal(state.cow.milk, 1, 'Cow produces one milk.');
  complete(state, 10);
  equal(state.cow.milk, 1, 'Cow stores only one milk.');
  truthy(Sim.applyAction(state, 'p2', C.ACTIONS.MILK).ok, 'Either player can milk.');
  equal(Sim.applyAction(state, 'p1', C.ACTIONS.MILK).code, 'taken', 'Cow collection race has one winner.');
  complete(state, state.effects.milkSeconds + 0.01);
  equal(state.fridge.milk, 1, 'Milk enters the fridge.');
  equal(state.cow.milk, 0, 'Cow empties after collection.');
}

function testBatterAndStoves() {
  const state = fresh({ prepSeconds: 0 });
  state.fridge.flour = 20;
  state.fridge.sugar = 20;
  state.fridge.milk = 20;
  state.fridge.strawberry = 20;
  truthy(Sim.applyAction(state, 'p1', C.ACTIONS.MIX_BATTER).ok, 'Mixer starts with correct ingredients.');
  equal(state.fridge.flour, 17, 'Mixer consumes flour.');
  equal(state.fridge.sugar, 18, 'Mixer consumes sugar.');
  equal(state.fridge.milk, 16, 'Mixer consumes milk.');
  complete(state, state.effects.mixSeconds + 0.01);
  equal(state.batter, 10, 'One batch makes ten crepes.');
  complete(state, 0.1);
  const order = state.orders.find((item) => item.status === 'waiting');
  truthy(order, 'An order spawns after prep.');
  state.fridge.lemon = 20;
  state.fridge.blackberry = 20;
  state.fridge.banana = 20;
  for (let i = 0; i < 3; i += 1) {
    let target = state.orders.find((item) => item.status === 'waiting');
    if (!target) {
      state.nextOrderAt = state.elapsed;
      complete(state, 0.1);
      target = state.orders.find((item) => item.status === 'waiting');
    }
    truthy(Sim.applyAction(state, i % 2 ? 'p2' : 'p1', C.ACTIONS.START_CREPE, {
      stoveId: 'stove-' + (i + 1),
      orderId: target.id
    }).ok, 'Each stovetop can cook independently.');
  }
  equal(state.stoves.filter((stove) => stove.state === 'cooking').length, 3, 'All three stoves cook at once.');
  complete(state, state.effects.cookSeconds + 0.01);
  equal(state.stoves.filter((stove) => stove.state === 'ready').length, 3, 'All stoves become ready.');
  truthy(Sim.applyAction(state, 'p1', C.ACTIONS.SERVE_CREPE, { stoveId: 'stove-1' }).ok, 'Ready crepe can be served.');
  equal(Sim.applyAction(state, 'p2', C.ACTIONS.SERVE_CREPE, { stoveId: 'stove-1' }).code, 'taken', 'Serve race has one winner.');
  complete(state, state.effects.serveSeconds + 0.01);
  equal(state.stats.served, 1, 'Serving increments correct orders.');
  complete(state, state.effects.eatSeconds + 0.01);
  truthy(state.stats.coins >= 10, 'Customer eats and pays.');
}

function testBurnAndClear() {
  const state = fresh({ prepSeconds: 0 });
  state.batter = 5;
  for (const key of Object.keys(state.fridge)) state.fridge[key] = 10;
  complete(state, 0.1);
  const order = state.orders[0];
  Sim.applyAction(state, 'p1', C.ACTIONS.START_CREPE, { stoveId: 'stove-1', orderId: order.id });
  complete(state, state.effects.cookSeconds + state.effects.burnGraceSeconds + 0.1);
  equal(state.stoves[0].state, 'burnt', 'Ready crepe eventually burns.');
  equal(state.stats.burnt, 1, 'Burn is counted.');
  truthy(Sim.applyAction(state, 'p2', C.ACTIONS.CLEAR_BURNT, { stoveId: 'stove-1' }).ok, 'Burnt stove can be cleared.');
  complete(state, state.effects.clearSeconds + 0.01);
  equal(state.stoves[0].state, 'empty', 'Clearing restores the stove.');
}

function testCommittedServeBeatsPatience() {
  const state = fresh({ prepSeconds: 0 });
  state.batter = 1;
  for (const key of Object.keys(state.fridge)) state.fridge[key] = 10;
  complete(state, 0.1);
  const order = state.orders[0];
  Sim.applyAction(state, 'p1', C.ACTIONS.START_CREPE, { stoveId: 'stove-1', orderId: order.id });
  complete(state, state.effects.cookSeconds + 0.01);
  order.expiresAt = state.elapsed + state.effects.serveSeconds / 2;
  truthy(Sim.applyAction(state, 'p2', C.ACTIONS.SERVE_CREPE, { stoveId: 'stove-1' }).ok, 'Serve can begin before patience expires.');
  complete(state, state.effects.serveSeconds + 0.01);
  equal(order.status, 'eating', 'A committed serve is honored after patience reaches zero.');
  equal(state.stats.served, 1, 'Committed serve counts as served.');
}

function testStarsAndCampaign() {
  equal(Sim.starsForRatio(0.49), 0, 'Below half earns no star.');
  equal(Sim.starsForRatio(0.5), 1, 'Half earns one star.');
  equal(Sim.starsForRatio(0.7), 2, 'Seventy percent earns two stars.');
  equal(Sim.starsForRatio(0.9), 3, 'Ninety percent earns three stars.');
  const campaign = S.normalizeCampaign({});
  equal(Sim.applyDayResult(campaign, { level: 1, stars: 2 }), 2, 'First result awards improved stars.');
  equal(campaign.unlockedLevel, 2, 'Passing unlocks next level.');
  equal(Sim.applyDayResult(campaign, { level: 1, stars: 2 }), 0, 'Replaying same score awards no stars.');
  equal(Sim.applyDayResult(campaign, { level: 1, stars: 3 }), 1, 'Improvement awards only the difference.');
}

function testUpgrades() {
  const campaign = S.normalizeCampaign({ stars: 20 });
  const buy = B.purchaseUpgrade(campaign, 'biggerBowl');
  truthy(buy.ok, 'Upgrade purchase succeeds.');
  equal(campaign.stars, 19, 'First tier costs one star.');
  equal(campaign.upgrades.biggerBowl, 1, 'Upgrade tier increments.');
  const state = fresh({ upgrades: campaign.upgrades });
  equal(state.effects.batterYield, 12, 'Bigger Bowl affects batter output.');
}

function testDeterminism() {
  function scripted(dt) {
    const state = fresh({ upgrades: { bountifulBaskets: 5, fullPail: 5 } });
    Sim.applyAction(state, 'p1', C.ACTIONS.PLANT, { plotId: 'plot-1', crop: 'blackberry' });
    Sim.advance(state, 1, dt);
    Sim.applyAction(state, 'p2', C.ACTIONS.PICKUP_PAIL);
    Sim.applyAction(state, 'p2', C.ACTIONS.WATER, { plotId: 'plot-1' });
    Sim.advance(state, 20, dt);
    Sim.applyAction(state, 'p1', C.ACTIONS.HARVEST, { plotId: 'plot-1' });
    Sim.advance(state, 2, dt);
    Sim.advance(state, state.effects.milkRechargeSeconds, dt);
    Sim.applyAction(state, 'p1', C.ACTIONS.MILK);
    Sim.advance(state, 1, dt);
    return { blackberry: state.fridge.blackberry, milk: state.fridge.milk, randomSerial: state.randomSerial };
  }
  equal(scripted(0.05), scripted(0.1), 'Semantic random outcomes are independent of step cadence.');
}

function testLevelFeasibility() {
  const max = Object.fromEntries(C.UPGRADE_IDS.map((id) => [id, B.MAX_UPGRADE_TIER]));
  for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
    truthy(B.estimateFeasibility(level, 2, {}).feasible, 'Base two-player level ' + level + ' is feasible.');
    truthy(B.estimateFeasibility(level, 1, {}).feasible, 'Base solo level ' + level + ' is feasible.');
    truthy(B.estimateFeasibility(level, 2, max).feasible, 'Two-player level ' + level + ' is feasible.');
    truthy(B.estimateFeasibility(level, 1, max).feasible, 'Solo level ' + level + ' is feasible.');
  }
}

testInitialState();
testGardenLoop();
testSeedReservation();
testDisconnectReleasesLocks();
testCow();
testBatterAndStoves();
testBurnAndClear();
testCommittedServeBeatsPatience();
testStarsAndCampaign();
testUpgrades();
testDeterminism();
testLevelFeasibility();

console.log('core tests:', assertions, 'assertions passed');
