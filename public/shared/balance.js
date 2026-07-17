(function (root, factory) {
  const C = typeof module !== 'undefined' && module.exports
    ? require('./constants.js')
    : window.GG.Constants;
  const mod = factory(C);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') {
    window.GG = window.GG || {};
    window.GG.Balance = mod;
  }
})(this, function (C) {
  'use strict';

  const TICK_MS = 50;
  const SNAPSHOT_MS = 100;
  const DAY_SECONDS = 180;
  const PREP_SECONDS = 30;
  const NO_SPAWN_FINAL_SECONDS = 8;
  const STARTING_SEEDS = 20;
  const PLOT_COUNT = 12;
  const STOVE_COUNT = 3;
  const HARVEST_YIELD = 3;
  const PAIL_CAPACITY = 5;
  const STAR_THRESHOLDS = [0.5, 0.7, 0.9];
  const SOLO_ARRIVAL_RATE = 0.5;
  const HUMAN_ACTIONS_PER_SECOND_PER_PLAYER = 1.6;
  const HUMAN_APM_GUARD = 0.8;

  const BASE_TIMINGS = {
    plant: 0.4,
    water: 1.2,
    fillPail: 1.2,
    harvest: 0.8,
    milk: 0.5,
    mix: 3,
    cook: 6,
    flipWindow: 4.5,
    burnGrace: 7.5,
    serve: 0.6,
    clear: 0.8,
    eat: 4,
    milkRecharge: 3
  };

  const BATTER_COST = { flour: 3, sugar: 3, milk: 3 };
  const BATTER_YIELD = 10;
  const MAX_UPGRADE_TIER = 5;
  const UPGRADE_COSTS = [2, 4, 6, 8, 10];
  const UPGRADES = {
    greenThumb: { name: 'Green Thumb', description: 'Crops grow 6% faster per tier.' },
    quickPour: { name: 'Quick Pour', description: 'Watering completes 15% faster per tier.' },
    bountifulBaskets: { name: 'Bountiful Baskets', description: 'Each harvested unit has a 12% bonus chance per tier.' },
    nimbleHarvester: { name: 'Nimble Harvester', description: 'Harvesting completes 12% faster per tier.' },
    happyCow: { name: 'Happy Cow', description: 'Milk recharges 8% faster per tier.' },
    fullPail: { name: 'Full Pail', description: 'Milk collection has a 15% bonus chance per tier.' },
    swiftWhisk: { name: 'Swift Whisk', description: 'Batter mixing is 12% faster per tier.' },
    biggerBowl: { name: 'Bigger Bowl', description: 'Batter batches produce 2 more portions per tier.' },
    hotGriddles: { name: 'Hot Griddles', description: 'Crepes cook 7% faster per tier.' },
    forgivingHeat: { name: 'Forgiving Heat', description: 'Ready crepes gain 1.5 seconds per tier before burning.' },
    cozyCafe: { name: 'Cozy Cafe', description: 'Customers have 5% more patience per tier.' },
    fastService: { name: 'Fast Service', description: 'Serving and clearing complete 10% faster per tier.' }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function recipeCountForLevel(level) {
    if (level <= 5) return 3;
    if (level <= 10) return 4;
    if (level <= 15) return 5;
    if (level <= 20) return 6;
    if (level <= 25) return 7;
    if (level <= 30) return 8;
    if (level <= 40) return 9;
    return 10;
  }

  function milestoneForLevel(level) {
    return {
      10: { name: 'Berry Brunch', recipeBias: ['strawberry', 'blackberry'], burnGraceMultiplier: 0.96 },
      20: { name: 'Lemon Festival', recipeBias: ['lemon-sugar'], burnGraceMultiplier: 0.94 },
      30: { name: 'Banana Bonanza', recipeBias: ['banana', 'banana-sugar', 'strawberry-banana'], burnGraceMultiplier: 0.92 },
      40: { name: 'Garden Gala', recipeBias: ['forest-berry', 'strawberry-banana'], burnGraceMultiplier: 0.9 },
      50: { name: 'Grand Crepe Jubilee', recipeBias: C.RECIPES.map((recipe) => recipe.id), burnGraceMultiplier: 0.88 },
      60: { name: 'Summer Terrace', recipeBias: ['lemon-sugar', 'banana-sugar', 'citrus-berry'], burnGraceMultiplier: 0.88 },
      70: { name: 'Berry Harvest', recipeBias: ['strawberry-sugar', 'blackberry-sugar', 'forest-berry'], burnGraceMultiplier: 0.86 },
      80: { name: 'Market Day', recipeBias: ['strawberry-banana', 'citrus-berry', 'forest-berry'], burnGraceMultiplier: 0.84 },
      90: { name: 'Chef Challenge', recipeBias: C.RECIPES.map((recipe) => recipe.id), burnGraceMultiplier: 0.82 },
      100: { name: 'Centennial Crepe Feast', recipeBias: C.RECIPES.map((recipe) => recipe.id), burnGraceMultiplier: 0.8 }
    }[level] || null;
  }

  function makeLevel(levelNumber, playerCount, intervalScale) {
    const level = clamp(Math.floor(Number(levelNumber) || 1), 1, C.MAX_LEVEL);
    const players = clamp(Math.floor(Number(playerCount) || 2), 1, 2);
    const t = (level - 1) / (C.MAX_LEVEL - 1);
    const milestone = milestoneForLevel(level);
    const originalPrepSeconds = lerp(15, 8, t);
    let orderInterval = lerp(12, 4.5, t);
    if (milestone) orderInterval *= 0.92;
    // Preserve the new 30-second prep window while targeting 75% of the original arrivals.
    const originalServiceSeconds = DAY_SECONDS - originalPrepSeconds - NO_SPAWN_FINAL_SECONDS;
    const newServiceSeconds = DAY_SECONDS - PREP_SECONDS - NO_SPAWN_FINAL_SECONDS;
    orderInterval *= (newServiceSeconds / originalServiceSeconds) / 0.75;
    if (players === 1) orderInterval /= SOLO_ARRIVAL_RATE;
    orderInterval *= intervalScale || 1;
    let prepSeconds = PREP_SECONDS;
    if (level === 1) {
      const normalCount = Math.ceil((DAY_SECONDS - PREP_SECONDS - NO_SPAWN_FINAL_SECONDS) / orderInterval);
      prepSeconds = 60;
      const previousTargetCount = Math.max(1, normalCount - 1);
      const targetCount = Math.max(1, Math.ceil(previousTargetCount / 2));
      orderInterval = (DAY_SECONDS - prepSeconds - NO_SPAWN_FINAL_SECONDS) / Math.max(0.5, targetCount - 0.5);
    } else {
      orderInterval *= 2;
    }
    return {
      number: level,
      name: milestone ? milestone.name : 'Day ' + level,
      milestone: !!milestone,
      recipeBias: milestone ? milestone.recipeBias.slice() : null,
      burnGraceMultiplier: milestone ? milestone.burnGraceMultiplier : 1,
      recipeCount: recipeCountForLevel(level),
      orderInterval: Number(orderInterval.toFixed(3)),
      patience: Number((lerp(40, 18, t) * 1.2).toFixed(3)),
      prepSeconds,
      queueCap: Math.min(8, 3 + Math.floor((level - 1) / 8)),
      daySeconds: DAY_SECONDS,
      noSpawnFinalSeconds: NO_SPAWN_FINAL_SECONDS,
      playerCount: players
    };
  }

  function compileLevel(levelNumber, playerCount) {
    let intervalScale = 1;
    let level = makeLevel(levelNumber, playerCount, intervalScale);
    let feasibility = estimateLevelObject(level, {});
    while (!feasibility.feasible && intervalScale < 2.5) {
      intervalScale *= 1.04;
      level = makeLevel(levelNumber, playerCount, intervalScale);
      feasibility = estimateLevelObject(level, {});
    }
    level.orderInterval = Number(level.orderInterval.toFixed(3));
    level.feasibility = feasibility;
    return level;
  }

  function tier(upgrades, id) {
    return clamp(Math.floor(Number(upgrades && upgrades[id]) || 0), 0, MAX_UPGRADE_TIER);
  }

  function effectsFor(upgrades) {
    const greenThumb = tier(upgrades, 'greenThumb');
    const quickPour = tier(upgrades, 'quickPour');
    const nimbleHarvester = tier(upgrades, 'nimbleHarvester');
    const happyCow = tier(upgrades, 'happyCow');
    const swiftWhisk = tier(upgrades, 'swiftWhisk');
    const hotGriddles = tier(upgrades, 'hotGriddles');
    const fastService = tier(upgrades, 'fastService');
    return {
      growthMultiplier: Math.max(0.45, 1 - greenThumb * 0.06),
      plantSeconds: BASE_TIMINGS.plant,
      waterSeconds: Math.max(0.2, BASE_TIMINGS.water * (1 - quickPour * 0.15)),
      fillPailSeconds: BASE_TIMINGS.fillPail,
      harvestSeconds: Math.max(0.2, BASE_TIMINGS.harvest * (1 - nimbleHarvester * 0.12)),
      milkSeconds: BASE_TIMINGS.milk,
      milkRechargeSeconds: Math.max(1, BASE_TIMINGS.milkRecharge * (1 - happyCow * 0.08)),
      harvestBonusChance: Math.min(0.75, tier(upgrades, 'bountifulBaskets') * 0.12),
      milkBonusChance: Math.min(0.75, tier(upgrades, 'fullPail') * 0.15),
      mixSeconds: Math.max(0.7, BASE_TIMINGS.mix * (1 - swiftWhisk * 0.12)),
      batterYield: BATTER_YIELD + tier(upgrades, 'biggerBowl') * 2,
      cookSeconds: Math.max(1.5, BASE_TIMINGS.cook * (1 - hotGriddles * 0.07)),
      flipWindowSeconds: BASE_TIMINGS.flipWindow,
      burnGraceSeconds: BASE_TIMINGS.burnGrace + tier(upgrades, 'forgivingHeat') * 1.5,
      patienceMultiplier: 1 + tier(upgrades, 'cozyCafe') * 0.05,
      serveSeconds: Math.max(0.2, BASE_TIMINGS.serve * (1 - fastService * 0.1)),
      clearSeconds: Math.max(0.2, BASE_TIMINGS.clear * (1 - fastService * 0.1)),
      eatSeconds: BASE_TIMINGS.eat
    };
  }

  function upgradeCost(currentTier) {
    return UPGRADE_COSTS[clamp(Math.floor(Number(currentTier) || 0), 0, MAX_UPGRADE_TIER - 1)];
  }

  function purchaseUpgrade(campaign, id) {
    if (!UPGRADES[id]) return { ok: false, reason: 'Unknown upgrade.' };
    const current = tier(campaign.upgrades, id);
    if (current >= MAX_UPGRADE_TIER) return { ok: false, reason: 'Upgrade is already at maximum tier.' };
    const cost = upgradeCost(current);
    if ((campaign.stars || 0) < cost) return { ok: false, reason: 'Not enough stars.' };
    campaign.stars -= cost;
    campaign.upgrades[id] = current + 1;
    campaign.revision = (campaign.revision || 0) + 1;
    return { ok: true, cost, tier: current + 1 };
  }

  function averageToppingUnits(level) {
    const recipes = C.RECIPES.slice(0, level.recipeCount);
    const total = recipes.reduce((sum, recipe) => {
      return sum + Object.values(recipe.toppings).reduce((recipeSum, amount) => recipeSum + amount, 0);
    }, 0);
    return recipes.length ? total / recipes.length : 1;
  }

  function estimateLevelObject(level, upgrades) {
    const fx = effectsFor(upgrades || {});
    const serviceSeconds = level.daySeconds - level.prepSeconds - level.noSpawnFinalSeconds;
    const maxOrders = Math.max(1, Math.floor(serviceSeconds / level.orderInterval) + 1);
    const batches = Math.ceil(maxOrders / fx.batterYield);
    const effectiveHarvestYield = HARVEST_YIELD * (1 + fx.harvestBonusChance);
    const ingredientUnits = maxOrders * averageToppingUnits(level) + batches * (BATTER_COST.flour + BATTER_COST.sugar);
    const harvestsNeeded = ingredientUnits / effectiveHarvestYield;
    const pailCycleSeconds = fx.waterSeconds + fx.fillPailSeconds / PAIL_CAPACITY;
    const pailWaterCapacity = level.daySeconds / pailCycleSeconds;
    const stoveCapacity = STOVE_COUNT * serviceSeconds / fx.cookSeconds;
    const milkCapacity = level.daySeconds / fx.milkRechargeSeconds;
    const milkNeeded = batches * BATTER_COST.milk;
    const milkCollections = milkNeeded / (1 + fx.milkBonusChance);
    const refillsNeeded = Math.ceil(harvestsNeeded / PAIL_CAPACITY);
    const estimatedActions = harvestsNeeded * 3 + refillsNeeded + maxOrders * 3 + batches + milkCollections + 2;
    const humanActionCapacity = level.daySeconds * level.playerCount * HUMAN_ACTIONS_PER_SECOND_PER_PLAYER * HUMAN_APM_GUARD;
    const personSeconds = harvestsNeeded * (fx.plantSeconds + fx.waterSeconds + fx.harvestSeconds)
      + maxOrders * fx.serveSeconds
      + milkCollections * fx.milkSeconds
      + refillsNeeded * fx.fillPailSeconds;
    const personSecondCapacity = level.daySeconds * level.playerCount * HUMAN_APM_GUARD;
    const averageGrowSeconds = C.CROP_IDS.reduce((sum, id) => sum + C.CROPS[id].growSeconds * fx.growthMultiplier, 0) / C.CROP_IDS.length;
    const plotHarvestCapacity = BoundedPlotCapacity(level.daySeconds, averageGrowSeconds, fx);
    return {
      level: level.number,
      maxOrders,
      harvestsNeeded,
      pailWaterCapacity,
      refillsNeeded,
      stoveCapacity,
      milkNeeded,
      milkCapacity,
      estimatedActions,
      humanActionCapacity,
      personSeconds,
      personSecondCapacity,
      plotHarvestCapacity,
      feasible: pailWaterCapacity >= harvestsNeeded * 1.15
        && stoveCapacity >= maxOrders * 1.15
        && milkCapacity >= milkNeeded * 1.15
        && plotHarvestCapacity >= harvestsNeeded * 1.15
        && humanActionCapacity >= estimatedActions
        && personSecondCapacity >= personSeconds
    };
  }

  function BoundedPlotCapacity(daySeconds, averageGrowSeconds, fx) {
    const cycle = fx.plantSeconds + fx.waterSeconds + averageGrowSeconds + fx.harvestSeconds;
    return PLOT_COUNT * daySeconds / cycle;
  }

  function estimateFeasibility(levelNumber, playerCount, upgrades) {
    return estimateLevelObject(makeLevel(levelNumber, playerCount, 1), upgrades);
  }

  return {
    TICK_MS,
    SNAPSHOT_MS,
    DAY_SECONDS,
    PREP_SECONDS,
    NO_SPAWN_FINAL_SECONDS,
    STARTING_SEEDS,
    PLOT_COUNT,
    STOVE_COUNT,
    HARVEST_YIELD,
    PAIL_CAPACITY,
    STAR_THRESHOLDS,
    SOLO_ARRIVAL_RATE,
    HUMAN_ACTIONS_PER_SECOND_PER_PLAYER,
    HUMAN_APM_GUARD,
    BASE_TIMINGS,
    BATTER_COST,
    BATTER_YIELD,
    MAX_UPGRADE_TIER,
    UPGRADE_COSTS,
    UPGRADES,
    compileLevel,
    effectsFor,
    upgradeCost,
    purchaseUpgrade,
    estimateFeasibility
  };
});
