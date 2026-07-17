'use strict';

const assert = require('assert');
const C = require('../public/shared/constants.js');
const B = require('../public/shared/balance.js');
const S = require('../public/shared/schema.js');
const Sim = require('../public/shared/sim.js');

const DECISION_SECONDS = 0.25;

function first(state, predicate) {
  return state.orders.find(predicate);
}

function act(state, playerId, action, payload) {
  const result = Sim.applyAction(state, playerId, action, payload || {});
  if (result.ok) state._botAcceptedActions = (state._botAcceptedActions || 0) + 1;
  return result;
}

function canMake(state, order) {
  if (!order || state.batter < 1) return false;
  const recipe = C.RECIPE_BY_ID[order.recipeId];
  return Object.keys(recipe.toppings).every((key) => state.fridge[key] >= recipe.toppings[key]);
}

function plantablePlot(state) {
  state._botInitialized = state._botInitialized || new Set();
  return state.plots.find((plot) => plot.state === 'empty' && !plot.lockedBy && !state._botInitialized.has(plot.id))
    || state.plots.find((plot) => plot.state === 'empty' && !plot.lockedBy);
}

function desiredCrops(state) {
  if (state._botCrops) return state._botCrops;
  const available = C.RECIPES.slice(0, state.level.recipeCount);
  if (state.level.recipeBias) {
    for (const id of state.level.recipeBias) {
      const recipe = C.RECIPE_BY_ID[id];
      if (recipe && !available.includes(recipe)) available.push(recipe);
    }
  }
  const weights = { strawberry: 0, blackberry: 0, lemon: 0, banana: 0 };
  for (const recipe of available) {
    for (const crop of Object.keys(weights)) weights[crop] += recipe.toppings[crop] || 0;
  }
  const crops = ['flour', 'flour', 'sugar', 'sugar'];
  const allocated = { strawberry: 0, blackberry: 0, lemon: 0, banana: 0 };
  for (const crop of Object.keys(weights)) {
    if (weights[crop] > 0 && crops.length < B.PLOT_COUNT) {
      crops.push(crop);
      allocated[crop] += 1;
    }
  }
  while (crops.length < B.PLOT_COUNT) {
    const next = Object.keys(weights).sort((a, b) => {
      const scoreA = weights[a] / (allocated[a] + 1);
      const scoreB = weights[b] / (allocated[b] + 1);
      return scoreB - scoreA;
    })[0];
    crops.push(next);
    allocated[next] += 1;
  }
  state._botCrops = crops;
  return crops;
}

function plantDesired(state, playerId, plot) {
  const crop = desiredCrops(state)[Number(plot.id.split('-')[1]) - 1];
  const result = act(state, playerId, C.ACTIONS.PLANT, { plotId: plot.id, crop });
  if (result.ok) state._botInitialized.add(plot.id);
  return result.ok;
}

function urgentKitchenAction(state, playerId) {
  const player = state.players[playerId];
  if (player.task) return false;
  const flip = state.stoves.find((stove) => stove.state === 'needsFlip');
  if (flip) return act(state, playerId, C.ACTIONS.FLIP_CREPE, { stoveId: flip.id }).ok;
  const ready = state.stoves.find((stove) => stove.state === 'ready' && !stove.lockedBy);
  if (ready) return act(state, playerId, C.ACTIONS.SERVE_CREPE, { stoveId: ready.id }).ok;
  const burnt = state.stoves.find((stove) => stove.state === 'burnt' && !stove.lockedBy);
  if (burnt) return act(state, playerId, C.ACTIONS.CLEAR_BURNT, { stoveId: burnt.id }).ok;
  if (state.cow.milk >= 1 && !state.cow.lockedBy && state.fridge.milk < 12) {
    return act(state, playerId, C.ACTIONS.MILK).ok;
  }
  if (state.mixer.state === 'idle' && state.batter < 7) {
    const mixed = act(state, playerId, C.ACTIONS.MIX_BATTER);
    if (mixed.ok) return true;
  }
  const stove = state.stoves.find((item) => item.state === 'empty');
  const order = first(state, (item) => item.status === 'waiting' && canMake(state, item));
  if (stove && order) return act(state, playerId, C.ACTIONS.START_CREPE, { stoveId: stove.id, orderId: order.id }).ok;
  return false;
}

function kitchenAction(state, playerId) {
  const player = state.players[playerId];
  if (player.task) return false;
  if (urgentKitchenAction(state, playerId)) return true;
  const uninitialized = state.plots.find((plot) => {
    state._botInitialized = state._botInitialized || new Set();
    return plot.state === 'empty' && !plot.lockedBy && !state._botInitialized.has(plot.id);
  });
  if (uninitialized) return plantDesired(state, playerId, uninitialized);
  const ripe = state.plots.find((plot) => plot.state === 'ripe' && !plot.lockedBy);
  if (ripe) return act(state, playerId, C.ACTIONS.HARVEST, { plotId: ripe.id }).ok;
  const empty = plantablePlot(state);
  if (empty) return plantDesired(state, playerId, empty);
  return false;
}

function gardenAction(state, playerId) {
  const player = state.players[playerId];
  if (player.task) return false;
  const uninitialized = state.plots.find((plot) => {
    state._botInitialized = state._botInitialized || new Set();
    return plot.state === 'empty' && !plot.lockedBy && !state._botInitialized.has(plot.id);
  });
  if (uninitialized) {
    if (state.pail.holder === playerId) return act(state, playerId, C.ACTIONS.DROP_PAIL).ok;
    return plantDesired(state, playerId, uninitialized);
  }
  const ripe = state.plots.find((plot) => plot.state === 'ripe' && !plot.lockedBy);
  if (ripe) return act(state, playerId, C.ACTIONS.HARVEST, { plotId: ripe.id }).ok;
  const dry = state.plots
    .filter((plot) => plot.state === 'dry' && !plot.lockedBy)
    .sort((a, b) => C.CROPS[b.crop].growSeconds - C.CROPS[a.crop].growSeconds)[0];
  if (dry) {
    if (!state.pail.holder) return act(state, playerId, C.ACTIONS.PICKUP_PAIL).ok;
    if (state.pail.holder === playerId && state.pail.water <= 0) return act(state, playerId, C.ACTIONS.FILL_PAIL).ok;
    if (state.pail.holder === playerId) return act(state, playerId, C.ACTIONS.WATER, { plotId: dry.id }).ok;
  }
  const empty = plantablePlot(state);
  if (empty) {
    if (state.pail.holder === playerId) return act(state, playerId, C.ACTIONS.DROP_PAIL).ok;
    return plantDesired(state, playerId, empty);
  }
  return kitchenAction(state, playerId);
}

function soloAction(state, playerId) {
  const player = state.players[playerId];
  if (player.task) return false;
  if (urgentKitchenAction(state, playerId)) return true;
  return gardenAction(state, playerId);
}

function runBotsState(level, playerCount, upgrades) {
  const ids = playerCount === 1 ? ['p1'] : ['p1', 'p2'];
  const state = S.createState({ level, seed: 7000 + level, playerIds: ids, upgrades });
  let nextDecision = 0;
  while (state.status === 'playing') {
    if (state.elapsed >= nextDecision) {
      if (playerCount === 1) soloAction(state, 'p1');
      else {
        gardenAction(state, 'p1');
        kitchenAction(state, 'p2');
      }
      nextDecision += DECISION_SECONDS;
    }
    Sim.step(state, 0.05);
  }
  return state;
}

function runBots(level, playerCount, upgrades) {
  return runBotsState(level, playerCount, upgrades).result;
}

function runBalanceTests() {
  const max = Object.fromEntries(C.UPGRADE_IDS.map((id) => [id, B.MAX_UPGRADE_TIER]));
  const mid = Object.fromEntries(C.UPGRADE_IDS.map((id) => [id, 3]));
  let threeStarred = 0;
  let soloPassed = 0;
  for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
    const duoState = runBotsState(level, 2, max);
    const duo = duoState.result;
    assert.ok(duo.stars >= 3, 'Bounded-action duo should earn 3 stars on level ' + level + ' but earned ' + duo.stars);
    const actionLimit = duoState.level.daySeconds * 2 * B.HUMAN_ACTIONS_PER_SECOND_PER_PLAYER * B.HUMAN_APM_GUARD;
    assert.ok((duoState._botAcceptedActions || 0) <= actionLimit, 'Duo actions remain inside the authored human input ceiling.');
    threeStarred += 1;
    const soloState = runBotsState(level, 1, max);
    const solo = soloState.result;
    assert.ok(solo.stars >= 1, 'Bounded-action solo bot should pass level ' + level);
    const soloLimit = soloState.level.daySeconds * B.HUMAN_ACTIONS_PER_SECOND_PER_PLAYER * B.HUMAN_APM_GUARD;
    assert.ok((soloState._botAcceptedActions || 0) <= soloLimit, 'Solo actions remain inside the authored human input ceiling.');
    assert.ok(runBots(level, 2, mid).stars >= 1, 'Mid-upgrade duo should pass level ' + level);
    assert.ok(runBots(level, 1, mid).stars >= 1, 'Mid-upgrade solo should pass level ' + level);
    assert.deepStrictEqual(runBots(level, 2, max), duo, 'Full balance run is deterministic on level ' + level);
    soloPassed += 1;
  }

  const idle = S.createState({ level: 1, seed: 1, playerIds: ['p1', 'p2'] });
  Sim.advance(idle, idle.level.daySeconds, 0.05);
  assert.strictEqual(idle.result.stars, 0, 'Idle players must fail.');
  console.log('balance tests:', threeStarred, 'duo levels at 3 stars,', soloPassed, 'solo levels passed');
}

module.exports = { runBots, runBotsState, runBalanceTests };

if (require.main === module) runBalanceTests();
