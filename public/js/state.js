export const State = {
  screen: 'title',
  session: null,
  room: null,
  snapshot: null,
  selectedOrderId: null,
  selectedPlotId: null,
  connected: false,
  rejoining: false,
  paused: false,
  lastActionResult: null,

  me() {
    if (!this.room || !this.session) return null;
    return this.room.players.find((player) => player.id === this.session.playerId) || null;
  },

  partner() {
    if (!this.room || !this.session) return null;
    return this.room.players.find((player) => player.id !== this.session.playerId) || null;
  },

  mySimPlayer() {
    return this.snapshot && this.session ? this.snapshot.players[this.session.playerId] : null;
  }
};
