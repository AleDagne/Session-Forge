// Layout della schermata Combattimento (logica pura): tre colonne (entità, griglia, turni) con larghezze delle
// colonne laterali, stato aperto/chiuso e scheda attiva sugli schermi stretti, salvati nel browser.
(function (DnD) {
  'use strict';

  const KEY = 'dnd-battaglie:layout-combattimento';
  const OLD_CARDS_KEY = 'dnd-battaglie:larghezza-schede'; // larghezza delle schede del layout precedente
  const DEFAULTS = { left: 340, right: 300, leftOpen: true, rightOpen: true, tab: 'entita' };
  const MIN = 240;            // larghezza minima di una colonna laterale (px)
  const MAX_FRACTION = 0.4;   // larghezza massima: 40% del layout
  const NARROW = 1100;        // sotto questa larghezza le colonne laterali diventano schede
  const TABS = ['entita', 'turni'];

  const num = (v, def) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : def);

  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      left: Math.max(MIN, Math.min(2000, num(raw.left, DEFAULTS.left))),
      right: Math.max(MIN, Math.min(2000, num(raw.right, DEFAULTS.right))),
      leftOpen: raw.leftOpen !== false,
      rightOpen: raw.rightOpen !== false,
      tab: TABS.includes(raw.tab) ? raw.tab : DEFAULTS.tab,
    };
  }

  // Larghezza di una colonna laterale per un layout largo `total` px: tra MIN e il 40% (mai sotto MIN).
  function clamp(width, total) {
    const max = Number.isFinite(total) && total > 0 ? Math.max(MIN, Math.floor(total * MAX_FRACTION)) : 2000;
    return Math.max(MIN, Math.min(max, Math.round(width)));
  }

  // key facoltativa: la schermata Esplorazione usa la stessa disposizione con preferenze proprie.
  function load(storage, key) {
    try {
      const text = storage.getItem(key || KEY);
      if (text) return normalize(JSON.parse(text));
      // Prima volta col nuovo layout: si riprende la larghezza delle schede scelta in precedenza.
      const old = key ? 0 : Number(storage.getItem(OLD_CARDS_KEY));
      return normalize(old ? { left: old } : null);
    } catch (e) {
      return normalize(null);
    }
  }

  function save(storage, layout, key) {
    try {
      storage.setItem(key || KEY, JSON.stringify(normalize(layout)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Reimposta layout: valori predefiniti, salvati.
  function reset(storage, key) {
    const d = normalize(null);
    save(storage, d, key);
    return d;
  }

  const isNarrow = (width) => width < NARROW;

  DnD.layoutCombattimento = { KEY, DEFAULTS, MIN, MAX_FRACTION, NARROW, TABS, normalize, clamp, load, save, reset, isNarrow };
})(globalThis.DnD = globalThis.DnD || {});
