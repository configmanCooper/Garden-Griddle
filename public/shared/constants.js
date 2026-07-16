(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') {
    window.GG = window.GG || {};
    window.GG.Constants = mod;
  }
})(this, function () {
  'use strict';

  const PROTOCOL = 1;
  const CLIENT_BUILD = '1.0.0';
  const MAX_LEVEL = 50;
  const MAX_PLAYERS = 2;

  const CROPS = {
    flour: { id: 'flour', name: 'Wheat', fridgeName: 'Flour', icon: 'W', growSeconds: 3, color: '#d7b75b' },
    sugar: { id: 'sugar', name: 'Sugar Cane', fridgeName: 'Sugar', icon: 'S', growSeconds: 5, color: '#b9d66b' },
    strawberry: { id: 'strawberry', name: 'Strawberry', fridgeName: 'Strawberry', icon: 'ST', growSeconds: 7, color: '#df4055' },
    blackberry: { id: 'blackberry', name: 'Blackberry', fridgeName: 'Blackberry', icon: 'BB', growSeconds: 9, color: '#563a75' },
    lemon: { id: 'lemon', name: 'Lemon Tree', fridgeName: 'Lemon', icon: 'L', growSeconds: 12, color: '#f0d34f' },
    banana: { id: 'banana', name: 'Banana Plant', fridgeName: 'Banana', icon: 'B', growSeconds: 15, color: '#efc94c' }
  };
  const CROP_IDS = Object.keys(CROPS);

  const RECIPES = [
    { id: 'lemon-sugar', name: 'Lemon Sugar', toppings: { lemon: 1, sugar: 1 }, icon: 'LS' },
    { id: 'strawberry', name: 'Strawberry', toppings: { strawberry: 1 }, icon: 'ST' },
    { id: 'blackberry', name: 'Blackberry', toppings: { blackberry: 1 }, icon: 'BB' },
    { id: 'banana', name: 'Banana', toppings: { banana: 1 }, icon: 'B' },
    { id: 'strawberry-sugar', name: 'Strawberry Sugar', toppings: { strawberry: 1, sugar: 1 }, icon: 'SS' },
    { id: 'blackberry-sugar', name: 'Blackberry Sugar', toppings: { blackberry: 1, sugar: 1 }, icon: 'BS' },
    { id: 'banana-sugar', name: 'Banana Sugar', toppings: { banana: 1, sugar: 1 }, icon: 'B+' },
    { id: 'strawberry-banana', name: 'Strawberry Banana', toppings: { strawberry: 1, banana: 1 }, icon: 'SB' },
    { id: 'forest-berry', name: 'Forest Berry', toppings: { strawberry: 1, blackberry: 1 }, icon: 'FB' },
    { id: 'citrus-berry', name: 'Citrus Berry', toppings: { lemon: 1, strawberry: 1, sugar: 1 }, icon: 'CB' }
  ];
  const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((recipe) => [recipe.id, recipe]));

  const UPGRADE_IDS = [
    'greenThumb',
    'quickPour',
    'bountifulBaskets',
    'nimbleHarvester',
    'happyCow',
    'fullPail',
    'swiftWhisk',
    'biggerBowl',
    'hotGriddles',
    'forgivingHeat',
    'cozyCafe',
    'fastService'
  ];

  const ACTIONS = {
    PLANT: 'plant',
    PICKUP_PAIL: 'pickupPail',
    DROP_PAIL: 'dropPail',
    WATER: 'water',
    HARVEST: 'harvest',
    MILK: 'milk',
    MIX_BATTER: 'mixBatter',
    START_CREPE: 'startCrepe',
    SERVE_CREPE: 'serveCrepe',
    CLEAR_BURNT: 'clearBurnt',
    CANCEL_TASK: 'cancelTask'
  };

  return {
    PROTOCOL,
    CLIENT_BUILD,
    MAX_LEVEL,
    MAX_PLAYERS,
    CROPS,
    CROP_IDS,
    RECIPES,
    RECIPE_BY_ID,
    UPGRADE_IDS,
    ACTIONS
  };
});

