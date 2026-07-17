'use strict';

const assert = require('assert');
const C = require('../public/shared/constants.js');
const B = require('../public/shared/balance.js');
const S = require('../public/shared/schema.js');
const Sim = require('../public/shared/sim.js');

function testHundredLevelCampaign() {
  const campaign = S.normalizeCampaign({});
  let earned = 0;
  for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
    assert.ok(level <= campaign.unlockedLevel, 'Level ' + level + ' should be unlocked in sequence.');
    earned += Sim.applyDayResult(campaign, { level, stars: 3 });
  }
  assert.strictEqual(earned, 300, 'A perfect campaign awards exactly 300 stars.');
  assert.strictEqual(campaign.stars, 300);
  assert.strictEqual(campaign.unlockedLevel, C.MAX_LEVEL);
  for (let level = 1; level <= C.MAX_LEVEL; level += 1) assert.strictEqual(campaign.bestStars[level], 3);
  assert.strictEqual(Sim.applyDayResult(campaign, { level: 100, stars: 3 }), 0, 'Replays cannot farm stars.');
}

function testUpgradeEconomy() {
  const totalMaxCost = C.UPGRADE_IDS.reduce((sum) => {
    return sum + Array.from({ length: B.MAX_UPGRADE_TIER }, (_, tier) => B.upgradeCost(tier)).reduce((a, b) => a + b, 0);
  }, 0);
  assert.strictEqual(totalMaxCost, 360, 'Maxing every upgrade costs 360 stars.');
  const campaign = S.normalizeCampaign({ stars: 300 });
  let purchases = 0;
  for (const id of C.UPGRADE_IDS) {
    while (campaign.upgrades[id] < B.MAX_UPGRADE_TIER) {
      const result = B.purchaseUpgrade(campaign, id);
      if (!result.ok) break;
      purchases += 1;
    }
  }
  assert.ok(purchases > 0);
  assert.ok(C.UPGRADE_IDS.some((id) => campaign.upgrades[id] < B.MAX_UPGRADE_TIER), 'Perfect play still requires upgrade choices.');
  assert.ok(campaign.stars < 5, 'Campaign stars are substantially spendable.');
}

function testOldCampaignMigration() {
  const oldSave = {
    unlockedLevel: 50,
    bestStars: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [index + 1, 1]))
  };
  const campaign = S.normalizeCampaign(oldSave);
  assert.strictEqual(campaign.unlockedLevel, 51, 'A completed old 50-day campaign migrates directly to Day 51.');
}

function testUpgradeEffects() {
  const base = B.effectsFor({});
  for (const id of C.UPGRADE_IDS) {
    const upgrades = { [id]: B.MAX_UPGRADE_TIER };
    const changed = B.effectsFor(upgrades);
    switch (id) {
      case 'greenThumb': assert.ok(changed.growthMultiplier < base.growthMultiplier); break;
      case 'quickPour': assert.ok(changed.waterSeconds < base.waterSeconds); break;
      case 'bountifulBaskets': assert.ok(changed.harvestBonusChance > base.harvestBonusChance); break;
      case 'nimbleHarvester': assert.ok(changed.harvestSeconds < base.harvestSeconds); break;
      case 'happyCow': assert.ok(changed.milkRechargeSeconds < base.milkRechargeSeconds); break;
      case 'fullPail': assert.ok(changed.milkBonusChance > base.milkBonusChance); break;
      case 'swiftWhisk': assert.ok(changed.mixSeconds < base.mixSeconds); break;
      case 'biggerBowl': assert.ok(changed.batterYield > base.batterYield); break;
      case 'hotGriddles': assert.ok(changed.cookSeconds < base.cookSeconds); break;
      case 'forgivingHeat': assert.ok(changed.burnGraceSeconds > base.burnGraceSeconds); break;
      case 'cozyCafe': assert.ok(changed.patienceMultiplier > base.patienceMultiplier); break;
      case 'fastService': assert.ok(changed.serveSeconds < base.serveSeconds && changed.clearSeconds < base.clearSeconds); break;
      default: assert.fail('Untested upgrade: ' + id);
    }
  }
}

function testLevelCurve() {
  const milestones = {
    10: 'Berry Brunch',
    20: 'Lemon Festival',
    30: 'Banana Bonanza',
    40: 'Garden Gala',
    50: 'Grand Crepe Jubilee',
    60: 'Summer Terrace',
    70: 'Berry Harvest',
    80: 'Market Day',
    90: 'Chef Challenge',
    100: 'Centennial Crepe Feast'
  };
  let previousRecipes = 0;
  for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
    const duo = B.compileLevel(level, 2);
    const solo = B.compileLevel(level, 1);
    assert.strictEqual(duo.number, level);
    assert.ok(duo.recipeCount >= previousRecipes, 'Recipe count never decreases.');
    assert.ok(duo.feasibility.feasible, 'Compiled level is feasible.');
    assert.ok(solo.orderInterval > duo.orderInterval, 'Solo mode receives fewer orders.');
    assert.ok(duo.queueCap >= 3 && duo.queueCap <= 8);
    assert.strictEqual(duo.prepSeconds, level === 1 ? 60 : 30, 'Prep window matches the authored day pacing.');
    if (milestones[level]) assert.strictEqual(duo.name, milestones[level]);
    if (milestones[level]) assert.ok(duo.burnGraceMultiplier < 1, 'Milestones reduce burn grace.');
    previousRecipes = duo.recipeCount;
  }
  assert.strictEqual(B.compileLevel(1, 2).recipeCount, 3);
  assert.strictEqual(B.compileLevel(100, 2).recipeCount, 10);
  assert.ok(B.compileLevel(100, 2).orderInterval < B.compileLevel(1, 2).orderInterval);
  for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
    const t = (level - 1) / (C.MAX_LEVEL - 1);
    const oldPrep = 15 + (8 - 15) * t;
    let oldInterval = 12 + (4.5 - 12) * t;
    if ([10, 20, 30, 40, 50, 60, 70, 80, 90, 100].includes(level)) oldInterval *= 0.92;
    const oldCount = Math.ceil((B.DAY_SECONDS - oldPrep - B.NO_SPAWN_FINAL_SECONDS) / oldInterval);
    const current = B.compileLevel(level, 2);
    const newCount = Math.ceil((B.DAY_SECONDS - current.prepSeconds - B.NO_SPAWN_FINAL_SECONDS) / current.orderInterval);
    const reduction = 1 - newCount / oldCount;
    if (level > 1) assert.ok(reduction >= 0.18 && reduction <= 0.32, 'Level ' + level + ' customer reduction stays near 25%.');
  }
  const standardDay1Interval = (12 * ((B.DAY_SECONDS - B.PREP_SECONDS - B.NO_SPAWN_FINAL_SECONDS) / (B.DAY_SECONDS - 15 - B.NO_SPAWN_FINAL_SECONDS))) / 0.75;
  const previousDay1Count = Math.ceil((B.DAY_SECONDS - B.PREP_SECONDS - B.NO_SPAWN_FINAL_SECONDS) / standardDay1Interval);
  const day1 = B.compileLevel(1, 2);
  const day1Count = Math.ceil((B.DAY_SECONDS - day1.prepSeconds - B.NO_SPAWN_FINAL_SECONDS) / day1.orderInterval);
  assert.strictEqual(day1Count, previousDay1Count - 1, 'Day 1 has exactly one fewer customer than the prior schedule.');
  assert.ok(B.compileLevel(100, 2).patience < B.compileLevel(1, 2).patience);
  assert.strictEqual(B.compileLevel(1, 2).patience, 48, 'Early customer patience is increased by 20%.');
  assert.strictEqual(B.compileLevel(C.MAX_LEVEL, 2).patience, 21.6, 'Maximum-difficulty patience is increased by 20%.');
  const level10 = B.compileLevel(10, 2);
  assert.ok(level10.recipeBias.every((id) => C.RECIPES.slice(0, level10.recipeCount).some((recipe) => recipe.id === id)), 'Milestone recipes respect unlocks.');
}

testHundredLevelCampaign();
testUpgradeEconomy();
testOldCampaignMigration();
testUpgradeEffects();
testLevelCurve();
console.log('progression tests: 100 levels, 300 stars, 12 upgrades passed');
