(function (root, factory) {
  const C = typeof module !== 'undefined' && module.exports
    ? require('./constants.js')
    : window.GG.Constants;
  const B = typeof module !== 'undefined' && module.exports
    ? require('./balance.js')
    : window.GG.Balance;
  const R = typeof module !== 'undefined' && module.exports
    ? require('./rng.js')
    : window.GG.Rng;
  const mod = factory(C, B, R);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') {
    window.GG = window.GG || {};
    window.GG.Sim = mod;
  }
})(this, function (C, B, R) {
  'use strict';

  const EPS = 0.000001;

  function event(state, type, data) {
    state.eventSerial += 1;
    state.events.push(Object.assign({ id: 'ev-' + state.eventSerial, type, at: state.elapsed }, data || {}));
    if (state.events.length > 60) state.events.splice(0, state.events.length - 60);
  }

  function fail(reason, code) {
    return { ok: false, reason, code: code || 'invalid' };
  }

  function ok(extra) {
    return Object.assign({ ok: true }, extra || {});
  }

  function playerOf(state, playerId) {
    return state.players[playerId] || null;
  }

  function plotOf(state, plotId) {
    return state.plots.find((plot) => plot.id === plotId) || null;
  }

  function stoveOf(state, stoveId) {
    return state.stoves.find((stove) => stove.id === stoveId) || null;
  }

  function orderOf(state, orderId) {
    return state.orders.find((order) => order.id === orderId) || null;
  }

  function startTask(state, player, kind, seconds, targetType, targetId, data) {
    if (player.task) return fail('You are already busy.', 'busy');
    player.task = {
      kind,
      startedAt: state.elapsed,
      completeAt: state.elapsed + seconds,
      targetType,
      targetId,
      data: data || {}
    };
    player.lastAction = { kind, targetId, at: state.elapsed };
    return ok({ completeAt: player.task.completeAt });
  }

  function hasResources(fridge, cost) {
    return Object.keys(cost).every((key) => (fridge[key] || 0) >= cost[key]);
  }

  function spendResources(fridge, cost) {
    for (const key of Object.keys(cost)) fridge[key] -= cost[key];
  }

  function releaseTaskLock(state, player) {
    if (!player || !player.task) return;
    const task = player.task;
    if (task.targetType === 'plot') {
      const plot = plotOf(state, task.targetId);
      if (plot && plot.lockedBy === player.id) plot.lockedBy = null;
    } else if (task.targetType === 'cow') {
      if (state.cow.lockedBy === player.id) state.cow.lockedBy = null;
    } else if (task.targetType === 'sink') {
      if (state.sink.lockedBy === player.id) state.sink.lockedBy = null;
    } else if (task.targetType === 'stove') {
      const stove = stoveOf(state, task.targetId);
      if (stove && stove.lockedBy === player.id) stove.lockedBy = null;
    }
  }

  function cancelPlayerTask(state, playerId, reason) {
    const player = playerOf(state, playerId);
    if (!player || !player.task) return false;
    if (player.task.kind === 'plant' && player.task.data && player.task.data.reservedSeed) {
      state.seeds[player.task.data.crop] += 1;
      player.task.data.reservedSeed = false;
    }
    if (player.task.kind === 'serve') {
      const stove = stoveOf(state, player.task.targetId);
      const order = stove && orderOf(state, stove.orderId);
      if (order && order.status === 'serving') order.status = 'ready';
      if (stove && stove.state === 'serving') stove.state = 'ready';
    }
    releaseTaskLock(state, player);
    event(state, 'taskCancelled', { playerId, kind: player.task.kind, reason: reason || 'cancelled' });
    player.task = null;
    return true;
  }

  function dropPail(state, playerId) {
    if (state.pail.holder !== playerId) return false;
    state.pail.holder = null;
    event(state, 'pailDropped', { playerId });
    return true;
  }

  function disconnectPlayer(state, playerId) {
    const player = playerOf(state, playerId);
    if (!player) return;
    player.connected = false;
    cancelPlayerTask(state, playerId, 'disconnect');
    dropPail(state, playerId);
  }

  function reconnectPlayer(state, playerId) {
    const player = playerOf(state, playerId);
    if (player) player.connected = true;
  }

  function applyAction(state, playerId, action, payload) {
    const data = payload || {};
    const player = playerOf(state, playerId);
    if (!player) return fail('Unknown player.', 'player');
    if (!player.connected) return fail('Player is disconnected.', 'disconnected');
    if (state.status !== 'playing') return fail('The day is not active.', 'status');
    if (player.task && action !== C.ACTIONS.CANCEL_TASK) return fail('You are already busy.', 'busy');

    switch (action) {
      case C.ACTIONS.PLANT: {
        const plot = plotOf(state, data.plotId);
        if (!plot) return fail('Unknown plot.', 'target');
        if (!C.CROPS[data.crop]) return fail('Unknown crop.', 'crop');
        if (state.pail.holder === playerId) return fail('Put down the watering pail before planting.', 'pail');
        if (plot.lockedBy && plot.lockedBy !== playerId) return fail('That plot is taken.', 'taken');
        if (plot.state !== 'empty') return fail('That plot is not empty.', 'state');
        if ((state.seeds[data.crop] || 0) <= 0) return fail('No seeds remain.', 'resource');
        plot.lockedBy = playerId;
        state.seeds[data.crop] -= 1;
        const started = startTask(state, player, 'plant', state.effects.plantSeconds, 'plot', plot.id, {
          crop: data.crop,
          reservedSeed: true
        });
        if (!started.ok) {
          state.seeds[data.crop] += 1;
          plot.lockedBy = null;
        }
        return started;
      }
      case C.ACTIONS.PICKUP_PAIL:
        if (state.pail.holder && state.pail.holder !== playerId) return fail('Your partner has the pail.', 'taken');
        state.pail.holder = playerId;
        player.lastAction = { kind: 'pickupPail', at: state.elapsed };
        event(state, 'pailPickedUp', { playerId });
        return ok();
      case C.ACTIONS.DROP_PAIL:
        if (!dropPail(state, playerId)) return fail('You are not holding the pail.', 'state');
        return ok();
      case C.ACTIONS.FILL_PAIL:
        if (state.pail.holder !== playerId) return fail('Pick up the pail before using the sink.', 'pail');
        if (state.pail.water >= state.pail.capacity) return fail('The pail is already full.', 'state');
        if (state.sink.lockedBy && state.sink.lockedBy !== playerId) return fail('The sink is in use.', 'taken');
        state.sink.lockedBy = playerId;
        return startTask(state, player, 'fillPail', state.effects.fillPailSeconds, 'sink', 'sink');
      case C.ACTIONS.WATER: {
        const plot = plotOf(state, data.plotId);
        if (!plot) return fail('Unknown plot.', 'target');
        if (state.pail.holder !== playerId) return fail('Pick up the pail first.', 'pail');
        if (state.pail.water <= 0) return fail('The pail is empty. Fill it at the kitchen sink.', 'resource');
        if (plot.lockedBy && plot.lockedBy !== playerId) return fail('That plot is taken.', 'taken');
        if (plot.state !== 'dry') return fail('That crop does not need water.', 'state');
        plot.lockedBy = playerId;
        return startTask(state, player, 'water', state.effects.waterSeconds, 'plot', plot.id);
      }
      case C.ACTIONS.HARVEST: {
        const plot = plotOf(state, data.plotId);
        if (!plot) return fail('Unknown plot.', 'target');
        if (plot.lockedBy && plot.lockedBy !== playerId) return fail('That plot is taken.', 'taken');
        if (plot.state !== 'ripe') return fail('That crop is not ripe.', 'state');
        plot.lockedBy = playerId;
        return startTask(state, player, 'harvest', state.effects.harvestSeconds, 'plot', plot.id);
      }
      case C.ACTIONS.MILK:
        if (state.cow.lockedBy && state.cow.lockedBy !== playerId) return fail('Your partner is milking the cow.', 'taken');
        if (state.cow.milk < 1) return fail('The cow is not ready.', 'state');
        state.cow.lockedBy = playerId;
        return startTask(state, player, 'milk', state.effects.milkSeconds, 'cow', 'cow');
      case C.ACTIONS.MIX_BATTER:
        if (state.mixer.state !== 'idle') return fail('The mixer is already running.', 'taken');
        if (!hasResources(state.fridge, B.BATTER_COST)) return fail('The fridge needs more flour, sugar, or milk.', 'resource');
        spendResources(state.fridge, B.BATTER_COST);
        state.mixer = { state: 'mixing', readyAt: state.elapsed + state.effects.mixSeconds, startedBy: playerId };
        player.lastAction = { kind: 'mixBatter', at: state.elapsed };
        event(state, 'mixerStarted', { playerId, readyAt: state.mixer.readyAt });
        return ok({ readyAt: state.mixer.readyAt });
      case C.ACTIONS.START_CREPE: {
        const stove = stoveOf(state, data.stoveId);
        const order = orderOf(state, data.orderId);
        if (!stove || !order) return fail('Unknown stove or order.', 'target');
        if (stove.state !== 'empty' || stove.lockedBy) return fail('That stove is taken.', 'taken');
        if (order.status !== 'waiting') return fail('That order is already assigned.', 'taken');
        const recipe = C.RECIPE_BY_ID[order.recipeId];
        if (!recipe) return fail('Unknown recipe.', 'recipe');
        if (state.batter < 1 || !hasResources(state.fridge, recipe.toppings)) return fail('The kitchen is missing batter or toppings.', 'resource');
        state.batter -= 1;
        spendResources(state.fridge, recipe.toppings);
        order.status = 'cooking';
        state.tutorial.crepeStarted = true;
        order.stoveId = stove.id;
        order.assignedBy = playerId;
        stove.state = 'cooking';
        stove.orderId = order.id;
        stove.flipAt = state.elapsed + state.effects.cookSeconds / 2;
        stove.flipDeadline = stove.flipAt + state.effects.flipWindowSeconds;
        stove.flippedAt = 0;
        stove.readyAt = 0;
        stove.burnAt = 0;
        player.lastAction = { kind: 'startCrepe', targetId: stove.id, at: state.elapsed };
        event(state, 'crepeStarted', { playerId, stoveId: stove.id, orderId: order.id });
        return ok({ flipAt: stove.flipAt, flipDeadline: stove.flipDeadline });
      }
      case C.ACTIONS.FLIP_CREPE: {
        const stove = stoveOf(state, data.stoveId);
        if (!stove) return fail('Unknown stove.', 'target');
        if (stove.state !== 'needsFlip') return fail('That crepe is not ready to flip.', 'state');
        const order = orderOf(state, stove.orderId);
        if (!order || order.status !== 'cooking') return fail('That order is no longer cooking.', 'state');
        stove.state = 'cookingSecond';
        stove.flippedAt = state.elapsed;
        stove.readyAt = state.elapsed + state.effects.cookSeconds / 2;
        stove.burnAt = stove.readyAt + state.effects.burnGraceSeconds;
        state.tutorial.crepeFlipped = true;
        player.lastAction = { kind: 'flipCrepe', targetId: stove.id, at: state.elapsed };
        event(state, 'crepeFlipped', { playerId, stoveId: stove.id, orderId: order.id, readyAt: stove.readyAt });
        return ok({ readyAt: stove.readyAt, burnAt: stove.burnAt });
      }
      case C.ACTIONS.SERVE_CREPE: {
        const stove = stoveOf(state, data.stoveId);
        if (!stove) return fail('Unknown stove.', 'target');
        if (stove.lockedBy && stove.lockedBy !== playerId) return fail('That stove is taken.', 'taken');
        if (stove.state !== 'ready') return fail('That crepe is not ready.', 'state');
        const order = orderOf(state, stove.orderId);
        if (!order || order.status !== 'ready') return fail('That customer is no longer waiting.', 'state');
        stove.lockedBy = playerId;
        order.status = 'serving';
        stove.state = 'serving';
        const started = startTask(state, player, 'serve', state.effects.serveSeconds, 'stove', stove.id);
        if (!started.ok) {
          order.status = 'ready';
          stove.lockedBy = null;
        }
        return started;
      }
      case C.ACTIONS.CLEAR_BURNT: {
        const stove = stoveOf(state, data.stoveId);
        if (!stove) return fail('Unknown stove.', 'target');
        if (stove.lockedBy && stove.lockedBy !== playerId) return fail('That stove is taken.', 'taken');
        if (stove.state !== 'burnt') return fail('That stove does not need clearing.', 'state');
        stove.lockedBy = playerId;
        return startTask(state, player, 'clear', state.effects.clearSeconds, 'stove', stove.id);
      }
      case C.ACTIONS.CANCEL_TASK:
        return cancelPlayerTask(state, playerId, 'player') ? ok() : fail('No task to cancel.', 'state');
      default:
        return fail('Unknown action.', 'action');
    }
  }

  function completeTask(state, player) {
    const task = player.task;
    if (!task) return;
    if (task.kind === 'plant') {
      const plot = plotOf(state, task.targetId);
      const crop = task.data.crop;
      if (plot && plot.lockedBy === player.id && plot.state === 'empty' && task.data.reservedSeed) {
        task.data.reservedSeed = false;
        plot.crop = crop;
        plot.state = 'dry';
        state.tutorial.planted[crop] += 1;
        event(state, 'planted', { playerId: player.id, plotId: plot.id, crop });
      }
    } else if (task.kind === 'water') {
      const plot = plotOf(state, task.targetId);
      if (plot && plot.lockedBy === player.id && plot.state === 'dry' && plot.crop) {
        plot.state = 'growing';
        state.pail.water = Math.max(0, state.pail.water - 1);
        state.tutorial.watered += 1;
        plot.readyAt = state.elapsed + C.CROPS[plot.crop].growSeconds * state.effects.growthMultiplier;
        event(state, 'watered', { playerId: player.id, plotId: plot.id, readyAt: plot.readyAt });
      }
    } else if (task.kind === 'fillPail') {
      if (state.sink.lockedBy === player.id && state.pail.holder === player.id) {
        state.pail.water = state.pail.capacity;
        state.tutorial.pailFilled = true;
        event(state, 'pailFilled', { playerId: player.id, amount: state.pail.water });
      }
    } else if (task.kind === 'harvest') {
      const plot = plotOf(state, task.targetId);
      if (plot && plot.lockedBy === player.id && plot.state === 'ripe' && plot.crop) {
        const random = semanticRandom(state, plot.id + player.id + 'harvest');
        let amount = B.HARVEST_YIELD;
        for (let i = 0; i < B.HARVEST_YIELD; i += 1) if (random() < state.effects.harvestBonusChance) amount += 1;
        state.fridge[plot.crop] += amount;
        state.tutorial.harvested[plot.crop] += 1;
        event(state, 'harvested', { playerId: player.id, plotId: plot.id, crop: plot.crop, amount });
        plot.crop = null;
        plot.state = 'empty';
        plot.readyAt = 0;
      }
    } else if (task.kind === 'milk') {
      if (state.cow.lockedBy === player.id && state.cow.milk >= 1) {
        const random = semanticRandom(state, player.id + 'milk');
        const amount = 1 + (random() < state.effects.milkBonusChance ? 1 : 0);
        state.fridge.milk += amount;
        state.tutorial.milkCollected += amount;
        state.cow.milk = 0;
        state.cow.milkReadyAt = state.elapsed + state.effects.milkRechargeSeconds;
        event(state, 'milked', { playerId: player.id, amount });
      }
    } else if (task.kind === 'serve') {
      const stove = stoveOf(state, task.targetId);
      const order = stove && orderOf(state, stove.orderId);
      if (stove && order && stove.lockedBy === player.id && stove.state === 'serving' && order.status === 'serving') {
        const patienceLeft = Math.max(0, order.expiresAt - state.elapsed);
        order.status = 'eating';
        order.servedAt = state.elapsed;
        order.payAt = state.elapsed + state.effects.eatSeconds;
        state.stats.served += 1;
        state.tutorial.served = true;
        order.tip = Math.max(0, Math.round(patienceLeft * 2));
        clearStove(stove);
        event(state, 'served', { playerId: player.id, orderId: order.id, tip: order.tip });
      }
    } else if (task.kind === 'clear') {
      const stove = stoveOf(state, task.targetId);
      if (stove && stove.lockedBy === player.id && stove.state === 'burnt') {
        clearStove(stove);
        state.stats.waste += 1;
        event(state, 'stoveCleared', { playerId: player.id, stoveId: stove.id });
      }
    }
    releaseTaskLock(state, player);
    player.task = null;
  }

  function clearStove(stove) {
    stove.state = 'empty';
    stove.orderId = null;
    stove.flipAt = 0;
    stove.flipDeadline = 0;
    stove.flippedAt = 0;
    stove.readyAt = 0;
    stove.burnAt = 0;
    stove.lockedBy = null;
  }

  function activeOrderCount(state) {
    return state.orders.filter((order) => ['waiting', 'cooking', 'ready', 'serving'].includes(order.status)).length;
  }

  function pickRecipe(state) {
    const level = state.level;
    const available = C.RECIPES.slice(0, level.recipeCount);
    const random = R.makeRng((state.seed + state.orderSerial * 2654435761) >>> 0);
    if (level.recipeBias && random() < 0.62) {
      const biased = level.recipeBias.map((id) => C.RECIPE_BY_ID[id]).filter((recipe) => recipe && available.includes(recipe));
      if (biased.length) return biased[Math.floor(random() * biased.length)];
    }
    return available[Math.floor(random() * available.length)];
  }

  function spawnOrder(state) {
    const recipe = pickRecipe(state);
    const random = R.makeRng((state.seed ^ ((state.orderSerial + 1) * 2246822519)) >>> 0);
    const patience = state.level.patience * state.effects.patienceMultiplier * (0.92 + random() * 0.16);
    const order = {
      id: 'order-' + (state.orderSerial + 1),
      serial: state.orderSerial + 1,
      recipeId: recipe.id,
      status: 'waiting',
      createdAt: state.elapsed,
      expiresAt: state.elapsed + patience,
      stoveId: null,
      assignedBy: null,
      payAt: 0,
      tip: 0
    };
    state.orderSerial += 1;
    state.orders.push(order);
    state.stats.spawned += 1;
    event(state, 'orderSpawned', { orderId: order.id, recipeId: recipe.id });
  }

  function missOrder(state, order, reason) {
    if (!['waiting', 'cooking', 'ready', 'serving'].includes(order.status)) return;
    order.status = 'missed';
    order.missedAt = state.elapsed;
    order.missReason = reason;
    state.stats.missed += 1;
    if (order.stoveId) {
      const stove = stoveOf(state, order.stoveId);
      if (stove && stove.orderId === order.id) {
        const newlyBurnt = stove.state !== 'burnt';
        stove.state = 'burnt';
        stove.readyAt = 0;
        stove.burnAt = 0;
        stove.lockedBy = null;
        if (newlyBurnt) state.stats.burnt += 1;
      }
    }
    event(state, 'orderMissed', { orderId: order.id, reason });
  }

  function starsForRatio(ratio) {
    let stars = 0;
    for (let i = 0; i < B.STAR_THRESHOLDS.length; i += 1) if (ratio + EPS >= B.STAR_THRESHOLDS[i]) stars = i + 1;
    return stars;
  }

  function finishDay(state) {
    if (state.status !== 'playing') return state.result;
    for (const playerId of Object.keys(state.players)) cancelPlayerTask(state, playerId, 'dayEnd');
    for (const order of state.orders) {
      if (order.status === 'eating') {
        order.status = 'paid';
        state.stats.coins += 10;
        state.stats.tips += order.tip;
      } else {
        missOrder(state, order, 'dayEnd');
      }
    }
    const ratio = state.stats.spawned > 0 ? state.stats.served / state.stats.spawned : 0;
    state.result = {
      level: state.level.number,
      stars: starsForRatio(ratio),
      ratio,
      spawned: state.stats.spawned,
      served: state.stats.served,
      missed: state.stats.missed,
      coins: state.stats.coins,
      tips: state.stats.tips
    };
    state.status = 'dayEnd';
    event(state, 'dayEnded', state.result);
    return state.result;
  }

  function step(state, dt) {
    if (state.status !== 'playing') return state.result;
    const delta = Math.max(0, Math.min(0.25, Number(dt) || B.TICK_MS / 1000));
    state.tick += 1;
    state.elapsed = Math.min(state.level.daySeconds, state.elapsed + delta);

    for (const player of Object.values(state.players)) {
      if (player.task && player.task.completeAt <= state.elapsed + EPS) completeTask(state, player);
    }

    for (const plot of state.plots) {
      if (plot.state === 'growing' && plot.readyAt <= state.elapsed + EPS) {
        plot.state = 'ripe';
        event(state, 'cropReady', { plotId: plot.id, crop: plot.crop });
      }
    }

    if (state.cow.milk < 1 && state.cow.milkReadyAt <= state.elapsed + EPS) {
      state.cow.milk = 1;
      event(state, 'milkReady');
    }

    if (state.mixer.state === 'mixing' && state.mixer.readyAt <= state.elapsed + EPS) {
      state.batter += state.effects.batterYield;
      state.tutorial.batterMixed = true;
      event(state, 'batterReady', { amount: state.effects.batterYield, playerId: state.mixer.startedBy });
      state.mixer = { state: 'idle', readyAt: 0, startedBy: null };
    }

    for (const stove of state.stoves) {
      if (stove.state === 'cooking' && stove.flipAt <= state.elapsed + EPS) {
        stove.state = 'needsFlip';
        event(state, 'crepeNeedsFlip', { stoveId: stove.id, orderId: stove.orderId, deadline: stove.flipDeadline });
      }
      if (stove.state === 'needsFlip' && stove.flipDeadline <= state.elapsed + EPS) {
        stove.state = 'burnt';
        stove.lockedBy = null;
        state.stats.burnt += 1;
        const order = orderOf(state, stove.orderId);
        if (order) missOrder(state, order, 'missedFlip');
        event(state, 'crepeBurnt', { stoveId: stove.id, orderId: stove.orderId });
      }
      if (stove.state === 'cookingSecond' && stove.readyAt <= state.elapsed + EPS) {
        stove.state = 'ready';
        const order = orderOf(state, stove.orderId);
        if (order && order.status === 'cooking') order.status = 'ready';
        event(state, 'crepeReady', { stoveId: stove.id, orderId: stove.orderId });
      }
      if (stove.state === 'ready' && stove.burnAt <= state.elapsed + EPS) {
        stove.state = 'burnt';
        stove.lockedBy = null;
        state.stats.burnt += 1;
        const order = orderOf(state, stove.orderId);
        if (order) missOrder(state, order, 'burnt');
        event(state, 'crepeBurnt', { stoveId: stove.id, orderId: stove.orderId });
      }
    }

    for (const order of state.orders) {
      if (['waiting', 'cooking', 'ready'].includes(order.status) && order.expiresAt <= state.elapsed + EPS) {
        missOrder(state, order, 'patience');
      } else if (order.status === 'eating' && order.payAt <= state.elapsed + EPS) {
        order.status = 'paid';
        order.paidAt = state.elapsed;
        state.stats.coins += 10;
        state.stats.tips += order.tip;
        event(state, 'customerPaid', { orderId: order.id, coins: 10, tip: order.tip });
      }
    }

    const spawnCutoff = state.level.daySeconds - state.level.noSpawnFinalSeconds;
    if (state.elapsed + EPS >= state.nextOrderAt && state.elapsed < spawnCutoff) {
      if (activeOrderCount(state) < state.level.queueCap) {
        spawnOrder(state);
        state.nextOrderAt += state.level.orderInterval;
      } else {
        state.nextOrderAt = state.elapsed + 0.5;
      }
    }

    if (state.elapsed + EPS >= state.level.daySeconds) return finishDay(state);
    return null;
  }

  function advance(state, seconds, dt) {
    let remaining = Math.max(0, Number(seconds) || 0);
    const stepSize = Math.max(0.01, Number(dt) || B.TICK_MS / 1000);
    while (remaining > EPS && state.status === 'playing') {
      const amount = Math.min(stepSize, remaining);
      step(state, amount);
      remaining -= amount;
    }
    return state.result;
  }

  function applyDayResult(campaignInput, result) {
    const campaign = campaignInput;
    const level = Math.max(1, Math.min(C.MAX_LEVEL, result.level || 1));
    const previous = campaign.bestStars[level] || 0;
    const earned = Math.max(0, (result.stars || 0) - previous);
    if (result.stars > previous) campaign.bestStars[level] = result.stars;
    campaign.stars += earned;
    if (result.stars >= 1 && level >= campaign.unlockedLevel && level < C.MAX_LEVEL) campaign.unlockedLevel = level + 1;
    campaign.revision = (campaign.revision || 0) + 1;
    return earned;
  }

  function snapshot(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function semanticRandom(state, label) {
    state.randomSerial += 1;
    return R.makeRng((state.seed ^ Math.imul(state.randomSerial, 2654435761) ^ hashString(label)) >>> 0);
  }

  return {
    applyAction,
    step,
    advance,
    finishDay,
    disconnectPlayer,
    reconnectPlayer,
    cancelPlayerTask,
    applyDayResult,
    starsForRatio,
    snapshot
  };
});
