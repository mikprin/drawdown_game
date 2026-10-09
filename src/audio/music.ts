// Background music. Tracks are picked up at build time from src/assets/music, which is kept out of git:
// a checkout without them builds and plays fine, just silently, and the menu hides the music entries.
const TRACKS = Object.values(
  import.meta.glob<string>('/src/assets/music/*.{mp3,ogg,m4a}', { query: '?url', import: 'default', eager: true }),
);

const STORE_KEY = 'drawdown.music';
const FADE_MS = 1200;

interface Prefs {
  on: boolean;
  volume: number;
}

/** Kept apart from the game save, like the language. */
function loadPrefs(): Prefs {
  const def: Prefs = { on: true, volume: 0.5 };
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Prefs> | null;
    if (p) return { on: p.on ?? def.on, volume: Math.min(1, Math.max(0, Number(p.volume ?? def.volume))) };
  } catch {
    /* storage unavailable or corrupt */
  }
  return def;
}

function savePrefs(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

let prefs = loadPrefs();
let audio: HTMLAudioElement | null = null;
// Browsers refuse to start audio before the first click or key press.
let unlocked = false;
let order: number[] = [];
let pos = 0;
let fadeTimer = 0;

/** Shuffled playlist; a new round never starts with the track that just ended. */
function nextTrack(): string {
  if (pos >= order.length) {
    const last = order[order.length - 1];
    order = TRACKS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
    pos = 0;
  }
  return TRACKS[order[pos++]];
}

function fadeTo(a: HTMLAudioElement, target: number, done?: () => void): void {
  clearInterval(fadeTimer);
  const from = a.volume;
  const t0 = performance.now();
  fadeTimer = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    a.volume = from + (target - from) * k;
    if (k >= 1) {
      clearInterval(fadeTimer);
      done?.();
    }
  }, 50);
}

function play(): void {
  if (!TRACKS.length || !prefs.on || !unlocked || document.hidden) return;
  if (!audio) {
    const a = (audio = new Audio());
    a.preload = 'auto';
    a.volume = 0;
    a.addEventListener('ended', () => {
      a.src = nextTrack();
      void a.play().catch(() => {});
    });
  }
  const a = audio;
  if (!a.src) a.src = nextTrack();
  if (a.paused) {
    a.volume = 0;
    a.play().then(() => fadeTo(a, prefs.volume), () => {});
  } else {
    fadeTo(a, prefs.volume);
  }
}

function pause(): void {
  const a = audio;
  if (!a || a.paused) return;
  fadeTo(a, 0, () => a.pause());
}

/** Wire up the unlock gesture and tab visibility. Call once at startup. */
export function initMusic(): void {
  if (!TRACKS.length) return;
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    play();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  // No music from a background tab.
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
}

export function hasMusic(): boolean {
  return TRACKS.length > 0;
}

export function musicOn(): boolean {
  return prefs.on;
}

export function setMusicOn(on: boolean): void {
  prefs = { ...prefs, on };
  savePrefs();
  if (on) play();
  else pause();
}

export function musicVolume(): number {
  return prefs.volume;
}

export function setMusicVolume(volume: number): void {
  prefs = { ...prefs, volume };
  savePrefs();
  if (audio && !audio.paused) {
    clearInterval(fadeTimer);
    audio.volume = volume;
  }
}
