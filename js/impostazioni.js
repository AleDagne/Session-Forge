// Impostazioni di visualizzazione: tema, dimensione del testo, animazioni ridotte, effetti dei boss, regole del
// movimento (diagonali, modalità senza velocità) e dadi animati (interruttori, velocità, colore). I suoni hanno
// impostazioni proprie (audio.js), indipendenti da «Riduci animazioni».
// Caricato in <head> per applicare il tema prima del primo rendering (niente lampo di tema sbagliato).
(function (DnD) {
  'use strict';

  const KEY = 'dnd-battaglie:impostazioni';
  const THEMES = ['chiaro', 'scuro', 'auto'];
  const TEXT_SIZES = ['piccolo', 'normale', 'grande'];
  const DIAGONALS = ['sempre1', 'alternata'];
  const MISSING_MODES = ['vietato', 'doppio'];
  const DICE_SPEEDS = ['lenta', 'normale', 'veloce', 'istantanea'];
  const DEFAULTS = {
    theme: 'auto', textSize: 'normale', reduceMotion: false, bossEffects: true,
    diagonals: 'sempre1', missingMode: 'vietato',
    diceAnim: true, diceMenu: true, diceCombat: true, diceExploration: true, diceSpeed: 'normale', diceColor: 'rosso',
  };
  const DARK_QUERY = '(prefers-color-scheme: dark)';

  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
      textSize: TEXT_SIZES.includes(raw.textSize) ? raw.textSize : DEFAULTS.textSize,
      reduceMotion: Boolean(raw.reduceMotion),
      // Effetti dei boss nel combattimento (barra in alto, vignettatura, animazioni): attivi di base.
      bossEffects: raw.bossEffects !== false,
      // Movimento: diagonali sempre a 1 casella (come prima) o alternate 1-2-1; modalità senza velocità vietata o doppia.
      diagonals: DIAGONALS.includes(raw.diagonals) ? raw.diagonals : DEFAULTS.diagonals,
      missingMode: MISSING_MODES.includes(raw.missingMode) ? raw.missingMode : DEFAULTS.missingMode,
      // Dadi animati: interruttore generale e per categoria, velocità, colore (chiave della palette).
      diceAnim: raw.diceAnim !== false,
      diceMenu: raw.diceMenu !== false,
      diceCombat: raw.diceCombat !== false,
      diceExploration: raw.diceExploration !== false,
      diceSpeed: DICE_SPEEDS.includes(raw.diceSpeed) ? raw.diceSpeed : DEFAULTS.diceSpeed,
      diceColor: typeof raw.diceColor === 'string' && /^[a-z]{2,20}$/.test(raw.diceColor) ? raw.diceColor : DEFAULTS.diceColor,
    };
  }

  // Al primo avvio non c'è nulla di salvato: tema "auto", cioè quello del sistema.
  function load(storage) {
    try {
      return normalize(JSON.parse(storage.getItem(KEY)));
    } catch (e) {
      return normalize(null);
    }
  }

  function save(storage, settings) {
    try {
      storage.setItem(KEY, JSON.stringify(normalize(settings)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // 'chiaro' | 'scuro' | 'auto' -> 'light' | 'dark'
  function resolveTheme(theme, prefersDark) {
    if (theme === 'chiaro') return 'light';
    if (theme === 'scuro') return 'dark';
    return prefersDark ? 'dark' : 'light';
  }

  function apply(root, settings, prefersDark) {
    const s = normalize(settings);
    const theme = resolveTheme(s.theme, prefersDark);
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    root.dataset.textSize = s.textSize;
    if (s.reduceMotion) root.dataset.reduceMotion = '';
    else delete root.dataset.reduceMotion;
    if (s.bossEffects) delete root.dataset.bossEffects;
    else root.dataset.bossEffects = 'off';
    if (typeof window !== 'undefined' && window.dispatchEvent && typeof Event === 'function') window.dispatchEvent(new Event('bosseffectschange'));
    if (changed && typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('themechange'));
    return theme;
  }

  const prefersDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;

  // Stato corrente nel browser: legge, applica e segue il sistema quando il tema è "auto".
  let current = null;
  function init() {
    current = load(localStorage);
    apply(document.documentElement, current, prefersDark());
    if (typeof matchMedia === 'function') {
      matchMedia(DARK_QUERY).addEventListener('change', () => apply(document.documentElement, current, prefersDark()));
    }
    return current;
  }

  function set(patch) {
    current = normalize(Object.assign({}, current, patch));
    save(localStorage, current);
    apply(document.documentElement, current, prefersDark());
    return current;
  }

  DnD.impostazioni = {
    KEY, THEMES, TEXT_SIZES, DIAGONALS, MISSING_MODES, DICE_SPEEDS, DEFAULTS, normalize, load, save, resolveTheme, apply, init, set,
    get: () => current,
    isDark: () => document.documentElement.dataset.theme === 'dark',
    reduceMotion: () => Boolean(current && current.reduceMotion),
    bossEffects: () => !current || current.bossEffects !== false,
    // Regole del movimento per movimento.js (di base quelle predefinite, anche prima di init).
    movementRules: () => ({ diagonals: (current || DEFAULTS).diagonals, missingMode: (current || DEFAULTS).missingMode }),
    dice: () => normalize(current || DEFAULTS),
  };
})(globalThis.DnD = globalThis.DnD || {});
