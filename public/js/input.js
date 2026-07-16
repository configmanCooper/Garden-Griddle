export class Input {
  constructor(canvas, render, game) {
    this.canvas = canvas;
    this.render = render;
    this.game = game;
    this.pointerId = null;
    this.start = null;
    this.last = null;
    this.target = null;
    this.holdTimer = null;
    this.holdTriggered = false;
    this.pinchDistance = 0;
    this.gestureActive = false;
    this.pointers = new Map();
    this.bind();
  }

  bind() {
    const options = { passive: false };
    this.canvas.addEventListener('pointerdown', (event) => this.down(event), options);
    this.canvas.addEventListener('pointermove', (event) => this.move(event), options);
    this.canvas.addEventListener('pointerup', (event) => this.up(event), options);
    this.canvas.addEventListener('pointercancel', (event) => this.cancel(event), options);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.render.zoomBy(event.deltaY > 0 ? 0.92 : 1.08);
    }, options);
  }

  down(event) {
    if (!this.game.isPlaying()) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.gestureActive = true;
      this.pinchDistance = this.distanceBetweenPointers();
      this.clearHold();
      return;
    }
    this.pointerId = event.pointerId;
    this.start = { x: event.clientX, y: event.clientY };
    this.last = { x: event.clientX, y: event.clientY };
    this.target = this.render.pick(event.clientX, event.clientY);
    this.holdTriggered = false;
    if (this.game.shouldHold(this.target)) {
      this.game.showHoldProgress(true);
      this.holdTimer = setTimeout(() => {
        this.holdTriggered = true;
        this.game.interact(this.target, true);
        this.game.showHoldProgress(false);
      }, 520);
    }
    try { this.canvas.setPointerCapture(event.pointerId); } catch (_error) {}
  }

  move(event) {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const distance = this.distanceBetweenPointers();
      if (this.pinchDistance) this.render.zoomBy(distance / this.pinchDistance);
      this.pinchDistance = distance;
      return;
    }
    if (this.pointerId !== event.pointerId || !this.last) return;
    const dx = event.clientX - this.last.x;
    const dy = event.clientY - this.last.y;
    const total = Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y);
    if (total > 8) {
      this.clearHold();
      this.render.panBy(dx, dy);
    }
    this.last = { x: event.clientX, y: event.clientY };
  }

  up(event) {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    this.pointers.delete(event.pointerId);
    if (this.pointerId === event.pointerId) {
      const moved = this.start ? Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) : 99;
      const target = this.target;
      this.clearHold();
      if (!this.gestureActive && !this.holdTriggered && moved < 9) this.game.interact(target, false);
      if (!target && moved < 9) this.game.clearSelection();
      this.pointerId = null;
      this.start = null;
      this.last = null;
      this.target = null;
    }
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.gestureActive = false;
  }

  cancel(event) {
    this.pointers.delete(event.pointerId);
    this.clearHold();
    this.pointerId = null;
    this.start = null;
    this.last = null;
    this.target = null;
    if (this.pointers.size === 0) this.gestureActive = false;
  }

  clearHold() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.game.showHoldProgress(false);
  }

  distanceBetweenPointers() {
    const values = [...this.pointers.values()];
    return values.length < 2 ? 0 : Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
  }
}
