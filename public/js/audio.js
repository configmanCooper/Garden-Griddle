let context = null;
let enabled = true;

export function configure(settings) {
  enabled = settings.sfx !== false;
}

export function unlock() {
  if (context) {
    if (context.state === 'suspended') context.resume().catch(() => {});
    return;
  }
  try { context = new (window.AudioContext || window.webkitAudioContext)(); } catch (_error) { context = null; }
}

function tone(frequency, duration, type, volume, endFrequency) {
  if (!enabled || !context) return;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type || 'sine';
  oscillator.frequency.setValueAtTime(frequency, now);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume || 0.08, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

export const sfx = {
  tap: () => tone(420, 0.06, 'triangle', 0.05, 500),
  plant: () => tone(260, 0.12, 'sine', 0.07, 340),
  water: () => tone(520, 0.18, 'sine', 0.06, 760),
  harvest: () => tone(620, 0.16, 'triangle', 0.08, 920),
  milk: () => tone(330, 0.16, 'sine', 0.08, 440),
  cook: () => tone(440, 0.12, 'square', 0.05, 600),
  ready: () => { tone(660, 0.12, 'sine', 0.08, 880); setTimeout(() => tone(880, 0.16, 'sine', 0.07, 1100), 90); },
  serve: () => tone(740, 0.2, 'triangle', 0.09, 1180),
  deny: () => tone(190, 0.14, 'sawtooth', 0.05, 120),
  star: () => tone(880, 0.35, 'sine', 0.1, 1500)
};

export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

