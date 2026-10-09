// The player's own settings (the Settings screen of the main menu). Kept on this device only
// (localStorage); every read and write is guarded, so a private window or blocked storage simply
// falls back to the defaults. Nothing here is a game rule: these change how the game looks and
// how quickly the computer guests play, never what anyone may do.
const KEY = 'hotelEscape.settings.v1';

export const SETTING_CHOICES = {
  // How quickly the computer guests (bots) think and walk. They always play faster than a person.
  botSpeed: [
    { value: 'relaxed', label: 'Relaxed', think: 1.1, walk: 1.25 },
    { value: 'normal', label: 'Normal', think: 0.75, walk: 1.7 },
    { value: 'fast', label: 'Fast', think: 0.45, walk: 2.3 },
  ],
  // On the other guests' turns, the view follows whoever is playing, or stays on your own guest.
  follow: [
    { value: 'follow', label: 'Follow them' },
    { value: 'stay', label: 'Stay on me' },
  ],
  // Sharper costs battery and smoothness on an iPad.
  graphics: [
    { value: 'saver', label: 'Battery saver', pixelRatio: 1 },
    { value: 'balanced', label: 'Balanced', pixelRatio: 1.5 },
    { value: 'sharp', label: 'Sharp', pixelRatio: 2 },
  ],
  // The lobby behind the main menu: animated, or held still.
  menuMotion: [
    { value: 'on', label: 'Animated' },
    { value: 'off', label: 'Still' },
  ],
};

const DEFAULTS = { botSpeed: 'normal', follow: 'follow', graphics: 'balanced', menuMotion: 'on', bots: 5, role: 'random' };

function load() {
  try {
    const raw = window.localStorage?.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch { return { ...DEFAULTS }; }
}

const current = load();

export const settings = {
  get(name) { return current[name] ?? DEFAULTS[name]; },
  set(name, value) {
    current[name] = value;
    try { window.localStorage?.setItem(KEY, JSON.stringify(current)); } catch { /* storage blocked: keep it for this visit */ }
  },
  // The chosen option's details (its label and numbers), e.g. choice('botSpeed').walk.
  choice(name) {
    const list = SETTING_CHOICES[name] || [];
    return list.find(o => o.value === settings.get(name)) || list.find(o => o.value === DEFAULTS[name]) || list[0] || null;
  },
};
