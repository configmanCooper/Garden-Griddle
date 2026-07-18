let context = null;
let enabled = true;
let vibrationEnabled = true;
let music = null;
let unlocked = false;
let musicIndex = 0;
let fadeToken = 0;
const MUSIC_VOLUME = 0.38;
const MUSIC_TRACKS = [
  '/assets/gardenandgriddlesong1.mp3?v=1',
  '/assets/gardenandgriddlesong2.mp3?v=1'
];

export function configure(settings) {
  enabled = settings.sfx !== false;
  vibrationEnabled = settings.vibration !== false;
  if (!enabled) stopMusic();
  else if (unlocked) startMusic();
}

export function unlock() {
  unlocked = true;
  if (context) {
    if (context.state === 'suspended') context.resume().catch(() => {});
  } else {
    try { context = new (window.AudioContext || window.webkitAudioContext)(); } catch (_error) { context = null; }
  }
  if (enabled) startMusic();
}

function startMusic() {
  if (!enabled || !unlocked) return;
  if (!music) {
    musicIndex = 0;
    music = new Audio(MUSIC_TRACKS[musicIndex]);
    music.loop = false;
    music.volume = 0;
    music.preload = 'auto';
    music.addEventListener('ended', playNextTrack);
  }
  if (music.paused) {
    const playback = music.play();
    if (playback && playback.catch) playback.catch(() => {});
    fadeMusicIn();
  }
}

function stopMusic() {
  fadeToken += 1;
  if (music && !music.paused) {
    try { music.pause(); } catch (_error) {}
  }
  if (music) music.volume = 0;
}

function playNextTrack() {
  if (!music || !enabled || !unlocked) return;
  musicIndex = (musicIndex + 1) % MUSIC_TRACKS.length;
  music.src = MUSIC_TRACKS[musicIndex];
  music.volume = 0;
  music.load();
  const playback = music.play();
  if (playback && playback.catch) playback.catch(() => {});
  fadeMusicIn();
}

function fadeMusicIn() {
  if (!music) return;
  const token = ++fadeToken;
  const startedAt = performance.now();
  const duration = 2200;
  function step(now) {
    if (token !== fadeToken || !music || !enabled || music.paused) return;
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    music.volume = MUSIC_VOLUME * progress;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
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
  flip: () => tone(520, 0.16, 'triangle', 0.08, 820),
  ready: () => { tone(660, 0.12, 'sine', 0.08, 880); setTimeout(() => tone(880, 0.16, 'sine', 0.07, 1100), 90); },
  serve: () => tone(740, 0.2, 'triangle', 0.09, 1180),
  deny: () => tone(190, 0.14, 'sawtooth', 0.05, 120),
  star: () => tone(880, 0.35, 'sine', 0.1, 1500)
};

export function vibrate(pattern) {
  if (vibrationEnabled && navigator.vibrate) navigator.vibrate(pattern);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopMusic();
    else if (enabled && unlocked) startMusic();
  });
}
