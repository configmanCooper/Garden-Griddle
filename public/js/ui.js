const C = window.GG.Constants;
const B = window.GG.Balance;

function byId(id) { return document.getElementById(id); }
function stars(value) { return '★'.repeat(value) + '☆'.repeat(3 - value); }
function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}

export class UI {
  constructor(game) {
    this.game = game;
    this.toastTimer = null;
    this.pendingPlotId = null;
    this.orderNodes = new Map();
    this.tutorialSignature = '';
    this.selectedLevel = 1;
    this.restaurantNameTimer = null;
    this.bind();
    this.buildCropOptions();
  }

  bind() {
    byId('create-room').onclick = () => this.game.createRoom();
    byId('join-room').onclick = () => this.game.joinRoom();
    byId('room-code-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') this.game.joinRoom(); });
    byId('save-server').onclick = () => this.game.saveServer();
    byId('start-day').onclick = () => {
      if (this.game.state.room && this.game.state.room.status === 'playing') this.game.returnToGame();
      else this.game.startDay(this.selectedLevel);
    };
    byId('practice-mode').onclick = () => this.game.startPractice(this.selectedLevel);
    byId('restaurant-name').oninput = (event) => {
      clearTimeout(this.restaurantNameTimer);
      this.restaurantNameTimer = setTimeout(() => this.game.setRestaurantName(event.target.value), 450);
    };
    byId('restaurant-name').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        clearTimeout(this.restaurantNameTimer);
        this.game.setRestaurantName(event.target.value);
        event.target.blur();
      }
    });
    byId('restaurant-name').addEventListener('blur', (event) => {
      clearTimeout(this.restaurantNameTimer);
      const authoritative = this.game.state.room && this.game.state.room.restaurantName;
      if (authoritative) event.target.value = authoritative;
    });
    byId('copy-room-code').onclick = () => this.game.copyRoomCode();
    byId('share-room').onclick = () => this.game.shareRoom();
    byId('open-shop').onclick = () => this.showShop();
    byId('open-settings-title').onclick = () => this.showSettings();
    byId('open-settings-room').onclick = () => this.showSettings();
    byId('open-help-title').onclick = () => byId('help-modal').classList.remove('hidden');
    byId('open-help-game').onclick = () => byId('help-modal').classList.remove('hidden');
    byId('results-shop').onclick = () => this.showShop();
    byId('results-room').onclick = () => this.show('room');
    byId('pause-game').onclick = () => this.game.pause();
    byId('pause-resume').onclick = () => this.game.pause();
    byId('pause-back-room').onclick = () => this.game.backToRoom();
    byId('pause-restart-day').onclick = () => this.game.restartDay();
    byId('pause-end-day').onclick = () => this.game.endDay();
    byId('practice-exit').onclick = () => this.game.exitPractice();
    byId('held-item').onclick = () => this.game.dropHeldItem();
    byId('selected-crop').onclick = () => this.chooseCrop(null);
    byId('camera-left').onclick = () => this.game.panCamera(-4, 0);
    byId('camera-right').onclick = () => this.game.panCamera(4, 0);
    byId('camera-up').onclick = () => this.game.panCamera(0, -3);
    byId('camera-down').onclick = () => this.game.panCamera(0, 3);
    byId('camera-zoom-out').onclick = () => this.game.zoomCamera(0.78);
    byId('camera-fit').onclick = () => this.game.resetCamera();
    byId('camera-zoom-in').onclick = () => this.game.zoomCamera(1.28);
    byId('tutorial-toggle').onclick = () => {
      const panel = byId('tutorial-panel');
      panel.classList.toggle('collapsed');
      byId('tutorial-toggle').textContent = panel.classList.contains('collapsed') ? '+' : '-';
    };
    byId('setting-sfx').onchange = (event) => this.game.updateSetting('sfx', event.target.checked);
    byId('setting-vibration').onchange = (event) => this.game.updateSetting('vibration', event.target.checked);
    byId('setting-reduced-motion').onchange = (event) => this.game.updateSetting('reducedMotion', event.target.checked);
    byId('setting-high-contrast').onchange = (event) => this.game.updateSetting('highContrast', event.target.checked);
    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
      button.onclick = () => this.game.toggleSound();
    });
    document.querySelectorAll('[data-ping]').forEach((button) => {
      button.onclick = () => this.game.ping(button.dataset.ping);
    });
    document.querySelectorAll('.modal-close').forEach((button) => {
      button.onclick = () => button.closest('.modal').classList.add('hidden');
    });
    byId('crop-modal').addEventListener('click', (event) => {
      if (event.target === byId('crop-modal')) byId('crop-modal').classList.add('hidden');
    });
    byId('shop-modal').addEventListener('click', (event) => {
      if (event.target === byId('shop-modal')) byId('shop-modal').classList.add('hidden');
    });
  }

  show(name) {
    document.querySelectorAll('#ui-root .screen').forEach((screen) => screen.classList.remove('active'));
    byId('screen-' + name).classList.add('active');
    this.game.state.screen = name;
  }

  setTitleValues(save, serverUrl) {
    byId('player-name').value = save.playerName || '';
    byId('server-url').value = serverUrl || '';
  }

  setConnection(status) {
    const text = status.state === 'connected' ? 'Connected to game server'
      : status.state === 'error' ? 'Server error: ' + status.reason
        : 'Connection lost - reconnecting...';
    byId('connection-title').textContent = text;
    if (status.state !== 'connected' && this.game.state.screen === 'game') this.toast('Connection lost - reconnecting...', true);
  }

  updateRoom(room, session) {
    if (!room || !session) return;
    byId('room-code').textContent = room.code;
    byId('campaign-stars').textContent = room.campaign.stars;
    const restaurantInput = byId('restaurant-name');
    if (document.activeElement !== restaurantInput) restaurantInput.value = room.restaurantName || 'Garden & Griddle';
    const list = byId('player-list');
    list.replaceChildren();
    for (let seat = 0; seat < 2; seat += 1) {
      const player = room.players.find((item) => item.seat === seat);
      const card = document.createElement('div');
      card.className = 'player-seat' + (player && player.id === session.playerId ? ' mine' : '');
      const dot = document.createElement('span');
      dot.className = 'player-dot';
      dot.style.background = seat === 0 ? '#e45b5b' : '#4f91d9';
      const info = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = player ? player.name : 'Open seat';
      const small = document.createElement('small');
      small.textContent = player ? (player.connected ? (player.id === room.hostId ? 'Host - connected' : 'Connected') : 'Reconnecting...') : 'Share the room code';
      info.append(strong, small);
      card.append(dot, info);
      list.appendChild(card);
    }
    const isHost = room.hostId === session.playerId;
    this.selectedLevel = Math.min(this.selectedLevel || room.selectedLevel || 1, room.campaign.unlockedLevel);
    const activeDay = room.status === 'playing';
    byId('start-day').disabled = activeDay ? false : !isHost || !['lobby', 'results'].includes(room.status);
    byId('start-day').textContent = activeDay ? 'Return to Active Day' : 'Open for the Day';
    byId('practice-mode').disabled = activeDay || !isHost || !['lobby', 'results'].includes(room.status);
    restaurantInput.disabled = !['lobby', 'results'].includes(room.status);
    byId('room-hint').textContent = activeDay
      ? 'The current day is still active. Return whenever you are ready.'
      : isHost ? 'Choose any unlocked day and start when ready.' : 'The host chooses when the restaurant opens.';
    this.renderDayPicker(room.campaign);
    this.updateSelectedLevel();
    this.renderShop(room.campaign);
  }

  updateSelectedLevel() {
    const level = this.selectedLevel || 1;
    byId('selected-level-label').textContent = level;
    const campaign = this.game.state.room && this.game.state.room.campaign;
    byId('level-stars').textContent = campaign ? stars(campaign.bestStars[level] || 0) : '☆☆☆';
    const players = this.game.state.room ? Math.max(1, this.game.state.room.players.filter((player) => player.connected).length) : 2;
    const details = B.compileLevel(level, players);
    byId('level-details').textContent = details.name + ' - ' + details.recipeCount + ' recipes - orders about every '
      + details.orderInterval.toFixed(1) + 's - ' + Math.round(details.patience) + 's patience';
  }

  renderDayPicker(campaign) {
    const picker = byId('day-picker');
    picker.replaceChildren();
    for (let level = 1; level <= C.MAX_LEVEL; level += 1) {
      const unlocked = level === 1 || (campaign.bestStars[level - 1] || 0) >= 1;
      const button = document.createElement('button');
      button.className = 'day-choice' + (unlocked ? '' : ' locked') + (level === this.selectedLevel ? ' selected' : '');
      button.disabled = !unlocked;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', level === this.selectedLevel ? 'true' : 'false');
      const number = document.createElement('strong');
      number.textContent = level;
      const rating = document.createElement('span');
      rating.textContent = unlocked ? stars(campaign.bestStars[level] || 0) : 'LOCKED';
      button.append(number, rating);
      button.onclick = () => {
        this.selectedLevel = level;
        this.renderDayPicker(campaign);
        this.updateSelectedLevel();
      };
      picker.appendChild(button);
    }
    requestAnimationFrame(() => {
      const selected = picker.querySelector('.day-choice.selected');
      if (selected) selected.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }

  updateSnapshot(snapshot, state) {
    if (!snapshot) return;
    byId('day-timer').textContent = snapshot.practice ? 'Practice' : formatTime(snapshot.level.daySeconds - snapshot.elapsed);
    const ratio = snapshot.stats.spawned ? snapshot.stats.served / snapshot.stats.spawned : 0;
    byId('live-stars').textContent = snapshot.practice ? 'No stars' : stars(window.GG.Sim ? window.GG.Sim.starsForRatio(ratio) : (ratio >= .9 ? 3 : ratio >= .7 ? 2 : ratio >= .5 ? 1 : 0));
    byId('serve-score').textContent = snapshot.practice
      ? snapshot.stats.served + ' served'
      : snapshot.stats.served + ' / ' + snapshot.stats.spawned + ' served';
    byId('practice-exit').classList.toggle('hidden', !snapshot.practice);
    this.renderOrders(snapshot, state.selectedOrderId);
    this.renderResources(snapshot);
    this.renderTutorial(snapshot);
    const me = state.mySimPlayer();
    const held = snapshot.pail.holder === (state.session && state.session.playerId);
    byId('held-item').textContent = held ? 'Watering pail ' + snapshot.pail.water + '/' + snapshot.pail.capacity + ' - tap to drop' : 'Hands free';
    byId('held-item').classList.toggle('active', held);
    const partner = state.partner();
    byId('partner-name').textContent = partner ? partner.name : 'Waiting for partner';
    byId('partner-status').textContent = partner ? (partner.connected ? 'Connected' : 'Reconnecting...') : 'Solo practice';
    byId('connection-dot').classList.toggle('online', !partner || partner.connected);
    if (me && me.task) {
      const duration = Math.max(.01, me.task.completeAt - me.task.startedAt);
      const progress = Math.max(0, Math.min(1, (snapshot.elapsed - me.task.startedAt) / duration));
      this.setProgress(true, progress);
      byId('selection-status').textContent = me.task.kind.charAt(0).toUpperCase() + me.task.kind.slice(1) + '...';
    } else {
      this.setProgress(false, 0);
      const selected = state.selectedOrderId && snapshot.orders.find((order) => order.id === state.selectedOrderId);
      byId('selection-status').textContent = selected ? 'Order selected: tap an empty stovetop.'
        : snapshot.elapsed < snapshot.level.prepSeconds ? 'Prep time: grow ingredients, milk the cow, and mix batter.'
          : 'Tap plots, the cow, sink, mixer, pail, or stovetops.';
    }
  }

  renderOrders(snapshot, selectedOrderId) {
    const holder = byId('orders');
    const active = snapshot.orders.filter((order) => ['waiting', 'cooking', 'ready', 'serving'].includes(order.status));
    const activeIds = new Set(active.map((order) => order.id));
    for (const [id, node] of this.orderNodes) {
      if (!activeIds.has(id)) {
        node.remove();
        this.orderNodes.delete(id);
      }
    }
    active.forEach((order, orderIndex) => {
      const recipe = C.RECIPE_BY_ID[order.recipeId];
      let button = this.orderNodes.get(order.id);
      if (!button) {
        button = document.createElement('button');
        const name = document.createElement('strong');
        const status = document.createElement('small');
        const icons = document.createElement('div');
        icons.className = 'order-icons';
        const patience = document.createElement('div');
        patience.className = 'patience';
        const fill = document.createElement('span');
        patience.appendChild(fill);
        button.append(name, status, icons, patience);
        button._gg = { name, status, icons, fill, recipeId: null };
        button.onclick = () => this.game.selectOrder(button.dataset.orderId);
        this.orderNodes.set(order.id, button);
      }
      button.className = 'order-ticket' + (selectedOrderId === order.id ? ' selected' : '');
      const left = Math.max(0, order.expiresAt - snapshot.elapsed);
      if (left < 7) button.classList.add('urgent');
      button.disabled = order.status !== 'waiting';
      button.dataset.orderId = order.id;
      button._gg.name.textContent = recipe.name;
      const stove = order.stoveId && snapshot.stoves.find((item) => item.id === order.stoveId);
      button._gg.status.textContent = stove && stove.state === 'needsFlip'
        ? 'FLIP NOW - ' + stove.id.replace('-', ' ')
        : order.status === 'waiting' ? 'Waiting' : order.status + (order.stoveId ? ' - ' + order.stoveId.replace('-', ' ') : '');
      if (button._gg.recipeId !== recipe.id) {
        button._gg.icons.replaceChildren();
        for (const key of Object.keys(recipe.toppings)) {
          const icon = document.createElement('span');
          icon.className = 'ingredient-icon';
          icon.textContent = C.CROPS[key] ? C.CROPS[key].icon : key.slice(0, 2).toUpperCase();
          icon.title = key;
          button._gg.icons.appendChild(icon);
        }
        button._gg.recipeId = recipe.id;
      }
      button._gg.fill.style.width = Math.max(0, Math.min(100, left / (order.expiresAt - order.createdAt) * 100)) + '%';
      const currentNode = holder.children[orderIndex];
      if (currentNode !== button) holder.insertBefore(button, currentNode || null);
    });
  }

  renderResources(snapshot) {
    const holder = byId('fridge-strip');
    holder.replaceChildren();
    const values = [
      ['flour', 'Flour', snapshot.fridge.flour],
      ['sugar', 'Sugar', snapshot.fridge.sugar],
      ['milk', 'Milk', snapshot.fridge.milk],
      ['strawberry', 'Berry', snapshot.fridge.strawberry],
      ['blackberry', 'Blackberry', snapshot.fridge.blackberry],
      ['lemon', 'Lemon', snapshot.fridge.lemon],
      ['banana', 'Banana', snapshot.fridge.banana],
      ['batter', 'Batter', snapshot.batter]
    ];
    for (const [id, label, value] of values) {
      const chip = document.createElement('div');
      chip.className = 'resource-chip';
      chip.textContent = Math.floor(value);
      const text = document.createElement('span');
      text.textContent = label;
      chip.prepend(text);
      chip.dataset.resource = id;
      holder.appendChild(chip);
    }
  }

  renderTutorial(snapshot) {
      const panel = byId('tutorial-panel');
      if (!snapshot || snapshot.level.number !== 1) {
        panel.classList.add('hidden');
        return;
      }
      panel.classList.remove('hidden');
      const tutorial = snapshot.tutorial;
      const plantedCount = tutorial.planted.flour + tutorial.planted.sugar + tutorial.planted.strawberry
        + tutorial.planted.blackberry + tutorial.planted.lemon;
      const harvestedCount = tutorial.harvested.flour + tutorial.harvested.sugar + tutorial.harvested.strawberry
        + tutorial.harvested.blackberry + tutorial.harvested.lemon;
      const plantedDone = tutorial.planted.flour >= 1 && tutorial.planted.sugar >= 2
        && tutorial.planted.strawberry >= 1 && tutorial.planted.blackberry >= 1 && tutorial.planted.lemon >= 1;
      const harvestedDone = tutorial.harvested.flour >= 1 && tutorial.harvested.sugar >= 2
        && tutorial.harvested.strawberry >= 1 && tutorial.harvested.blackberry >= 1 && tutorial.harvested.lemon >= 1;
      const tasks = [
        {
          done: plantedDone,
          title: 'Plant the ingredients (' + Math.min(6, plantedCount) + '/6)',
          text: 'With empty hands, tap six empty plots: 1 Wheat, 2 Sugar Cane, 1 Strawberry, 1 Blackberry, and 1 Lemon.'
        },
        {
          done: tutorial.pailFilled,
          title: 'Fill the watering pail',
          text: 'Tap the blue pail to pick it up, then tap the silver sink in the kitchen. It fills to 5/5.'
        },
        {
          done: tutorial.watered >= 6,
          title: 'Water all six crops (' + Math.min(6, tutorial.watered) + '/6)',
          text: 'Tap each dry crop once. Your chef stays busy until it is watered. After five plants, refill at the sink.'
        },
        {
          done: harvestedDone,
          title: 'Harvest the ingredients (' + Math.min(6, harvestedCount) + '/6)',
          text: 'Wait for each plant to look full-grown, then tap it. Everything goes straight into the shared fridge.'
        },
        {
          done: tutorial.milkCollected >= 3,
          title: 'Collect milk (' + Math.min(3, tutorial.milkCollected) + '/3)',
          text: 'Tap the cow whenever its white milk marker appears. It can hold only one milk at a time.'
        },
        {
          done: tutorial.batterMixed,
          title: 'Mix a batter batch',
          text: 'When the fridge has 3 Flour, 3 Sugar, and 3 Milk, tap the mixing bowl. One batch makes 5 crepes.'
        },
        {
          done: tutorial.crepeStarted,
          title: 'Cook a customer order',
          text: 'Tap a waiting order ticket at the top, then tap any empty stovetop. Exact toppings are used automatically.'
        },
        {
          done: tutorial.crepeFlipped,
          title: 'Flip the crepe halfway',
          text: 'When the stove ring turns blue, tap the stovetop before the flip timer runs out. Toppings appear after the flip.'
        },
        {
          done: tutorial.served,
          title: 'Serve the crepe',
          text: 'When the stove ring turns green, tap it before the crepe burns. The customer will eat and pay.'
        }
      ];
      const signature = tasks.map((task) => (task.done ? '1' : '0') + task.title).join('|');
      if (signature === this.tutorialSignature) return;
      this.tutorialSignature = signature;
      const nextIndex = tasks.findIndex((task) => !task.done);
      const list = byId('tutorial-list');
      list.replaceChildren();
      tasks.forEach((task, index) => {
        const row = document.createElement('div');
        row.className = 'tutorial-task' + (task.done ? ' done' : index === nextIndex ? ' next' : '');
        const check = document.createElement('span');
        check.className = 'tutorial-check';
        check.textContent = task.done ? '✓' : String(index + 1);
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = task.title;
        const text = document.createElement('p');
        text.textContent = task.text;
        content.append(title, text);
        row.append(check, content);
        list.appendChild(row);
      });
  }

  buildCropOptions() {
    const holder = byId('crop-options');
    for (const id of C.CROP_IDS) {
      const crop = C.CROPS[id];
      const button = document.createElement('button');
      button.className = 'crop-option';
      button.textContent = crop.name;
      const small = document.createElement('small');
      small.textContent = crop.growSeconds + 's growth';
      button.appendChild(small);
      button.onclick = () => {
        byId('crop-modal').classList.add('hidden');
        const plotId = this.pendingPlotId;
        this.pendingPlotId = null;
        this.game.selectCrop(id, plotId);
      };
      holder.appendChild(button);
    }
  }

  chooseCrop(plotId) {
    this.pendingPlotId = plotId;
    byId('crop-modal').classList.remove('hidden');
  }

  updateSelectedCrop(cropId) {
    const crop = cropId && C.CROPS[cropId];
    byId('selected-crop').textContent = crop ? 'Plant: ' + crop.name : 'Plant: choose crop';
    byId('selected-crop').style.borderColor = crop ? crop.color : '#fff';
  }

  showShop() {
    const campaign = this.game.state.room ? this.game.state.room.campaign : this.game.save.campaign;
    this.renderShop(campaign);
    byId('shop-modal').classList.remove('hidden');
  }

  showSettings() {
    const settings = this.game.save.settings;
    byId('setting-sfx').checked = settings.sfx !== false;
    byId('setting-vibration').checked = settings.vibration !== false;
    byId('setting-reduced-motion').checked = !!settings.reducedMotion;
    byId('setting-high-contrast').checked = !!settings.highContrast;
    byId('settings-modal').classList.remove('hidden');
  }

  updateSoundButtons(enabled) {
    const label = enabled ? 'Sound: On' : 'Sound: Off';
    for (const button of document.querySelectorAll('[data-sound-toggle]')) {
      const gameButton = button.id === 'sound-toggle-game';
      button.textContent = gameButton ? (enabled ? '🔊' : '🔇') : label;
      button.setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on');
      button.classList.toggle('sound-off', !enabled);
    }
    byId('setting-sfx').checked = enabled;
  }

  closeTopModal() {
    const modal = [...document.querySelectorAll('.modal:not(.hidden)')].pop();
    if (!modal) return false;
    modal.classList.add('hidden');
    return true;
  }

  renderShop(campaign) {
    if (!campaign) return;
    byId('shop-stars').textContent = campaign.stars + ' stars';
    const holder = byId('shop-grid');
    holder.replaceChildren();
    for (const id of C.UPGRADE_IDS) {
      const data = B.UPGRADES[id];
      const tier = campaign.upgrades[id] || 0;
      const card = document.createElement('div');
      card.className = 'upgrade';
      const title = document.createElement('h3');
      title.textContent = data.name + ' ' + tier + '/' + B.MAX_UPGRADE_TIER;
      const description = document.createElement('p');
      description.textContent = data.description;
      const button = document.createElement('button');
      const cost = tier < B.MAX_UPGRADE_TIER ? B.upgradeCost(tier) : 0;
      button.textContent = tier >= B.MAX_UPGRADE_TIER ? 'Maximum' : 'Buy - ' + cost + ' star' + (cost === 1 ? '' : 's');
      button.disabled = tier >= B.MAX_UPGRADE_TIER || campaign.stars < cost;
      button.onclick = () => this.game.buyUpgrade(id);
      card.append(title, description, button);
      holder.appendChild(card);
    }
  }

  results(payload) {
    const result = payload.result;
    byId('result-title').textContent = result.stars >= 3 ? 'Perfect service!' : result.stars >= 1 ? 'Day complete!' : 'The cafe needs another try';
    byId('result-stars').textContent = stars(result.stars);
    byId('result-score').textContent = result.served + ' of ' + result.spawned + ' customers served';
    byId('result-earned').textContent = payload.earnedStars ? '+' + payload.earnedStars + ' campaign star' + (payload.earnedStars === 1 ? '' : 's') : 'No new stars this time';
    this.show('results');
  }

  setProgress(visible, progress) {
    byId('action-progress').classList.toggle('hidden', !visible);
    byId('action-progress').querySelector('span').style.width = (progress * 100) + '%';
  }

  setPaused(paused, vote) {
    byId('pause-banner').classList.toggle('hidden', !paused && !vote);
    byId('pause-banner-text').textContent = paused ? 'Day paused' : 'Pause requested';
  }

  toast(message, reject) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.className = 'toast show' + (reject ? ' reject' : '');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2200);
  }
}
