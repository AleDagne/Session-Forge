// Impostazioni di visualizzazione: tema, dimensione del testo, animazioni ridotte, effetti dei boss.
// Caricato in <head> per applicare il tema prima del primo rendering (niente lampo di tema sbagliato).
(function (DnD) {
  'use strict';

  const KEY = 'dnd-battaglie:impostazioni';
  const THEMES = ['chiaro', 'scuro', 'auto'];
  const TEXT_SIZES = ['piccolo', 'normale', 'grande'];
  const DEFAULTS = { theme: 'auto', textSize: 'normale', reduceMotion: false, bossEffects: true };
  const DARK_QUERY = '(prefers-color-scheme: dark)';

  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULTS.theme,
      textSize: TEXT_SIZES.includes(raw.textSize) ? raw.textSize : DEFAULTS.textSize,
      reduceMotion: Boolean(raw.reduceMotion),
      // Effetti dei boss nel combattimento (barra in alto, vignettatura, animazioni): attivi di base.
      bossEffects: raw.bossEffects !== false,
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
    KEY, THEMES, TEXT_SIZES, DEFAULTS, normalize, load, save, resolveTheme, apply, init, set,
    get: () => current,
    isDark: () => document.documentElement.dataset.theme === 'dark',
    reduceMotion: () => Boolean(current && current.reduceMotion),
    bossEffects: () => !current || current.bossEffects !== false,
  };
})(globalThis.DnD = globalThis.DnD || {});
