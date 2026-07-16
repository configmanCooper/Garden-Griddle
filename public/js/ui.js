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
    this.bind();
    this.buildCropOptions();
  }

  bind() {
    byId('create-room').onclick = () => this.game.createRoom();
    byId('join-room').onclick = () => this.game.joinRoom();
    byId('room-code-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') this.game.joinRoom(); });
    byId('save-server').onclick = () => this.game.saveServer();
    byId('start-day').onclick = () => this.game.startDay(Number(byId('level-select').value));
    byId('level-select').oninput = () => this.updateSelectedLevel();
    byId('share-room').onclick = () => this.game.shareRoom();
    byId('open-shop').onclick = () => this.showShop();
    byId('results-shop').onclick = () => this.showShop();
    byId('results-room').onclick = () => this.show('room');
    byId('pause-game').onclick = () => this.game.pause();
    byId('held-item').onclick = () => this.game.dropHeldItem();
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
    const slider = byId('level-select');
    slider.max = room.campaign.unlockedLevel;
    slider.value = Math.min(Number(slider.value || room.selectedLevel), room.campaign.unlockedLevel);
    byId('start-day').disabled = !isHost || !['lobby', 'results'].includes(room.status);
    byId('room-hint').textContent = isHost ? 'Choose any unlocked day and start when ready.' : 'The host chooses when the restaurant opens.';
    this.updateSelectedLevel();
    this.renderShop(room.campaign);
  }

  updateSelectedLevel() {
    const level = Number(byId('level-select').value || 1);
    byId('selected-level-label').textContent = level;
    const campaign = this.game.state.room && this.game.state.room.campaign;
    byId('level-stars').textContent = campaign ? stars(campaign.bestStars[level] || 0) : '☆☆☆';
    const players = this.game.state.room ? Math.max(1, this.game.state.room.players.filter((player) => player.connected).length) : 2;
    const details = B.compileLevel(level, players);
    byId('level-details').textContent = details.name + ' - ' + details.recipeCount + ' recipes - orders about every '
      + details.orderInterval.toFixed(1) + 's - ' + Math.round(details.patience) + 's patience';
  }

  updateSnapshot(snapshot, state) {
    if (!snapshot) return;
    byId('day-timer').textContent = formatTime(snapshot.level.daySeconds - snapshot.elapsed);
    const ratio = snapshot.stats.spawned ? snapshot.stats.served / snapshot.stats.spawned : 0;
    byId('live-stars').textContent = stars(window.GG.Sim ? window.GG.Sim.starsForRatio(ratio) : (ratio >= .9 ? 3 : ratio >= .7 ? 2 : ratio >= .5 ? 1 : 0));
    byId('serve-score').textContent = snapshot.stats.served + ' / ' + snapshot.stats.spawned + ' served';
    this.renderOrders(snapshot, state.selectedOrderId);
    this.renderResources(snapshot);
    const me = state.mySimPlayer();
    const held = snapshot.pail.holder === (state.session && state.session.playerId);
    byId('held-item').textContent = held ? 'Watering pail - tap to drop' : 'Hands free';
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
          : 'Tap plots, the cow, mixer, pail, or stovetops.';
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
    for (const order of active) {
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
      button._gg.status.textContent = order.status === 'waiting' ? 'Waiting' : order.status + (order.stoveId ? ' - ' + order.stoveId.replace('-', ' ') : '');
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
      holder.appendChild(button);
    }
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
        this.game.plant(this.pendingPlotId, id);
      };
      holder.appendChild(button);
    }
  }

  chooseCrop(plotId) {
    this.pendingPlotId = plotId;
    byId('crop-modal').classList.remove('hidden');
  }

  showShop() {
    const campaign = this.game.state.room ? this.game.state.room.campaign : this.game.save.campaign;
    this.renderShop(campaign);
    byId('shop-modal').classList.remove('hidden');
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
    byId('pause-banner').textContent = paused ? 'Day paused' : 'Partner requested a pause - tap pause to approve';
  }

  toast(message, reject) {
    const toast = byId('toast');
    toast.textContent = message;
    toast.className = 'toast show' + (reject ? ' reject' : '');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2200);
  }
}
