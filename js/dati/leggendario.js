// Temi dei personaggi leggendari (dati): nomi e palette nella stessa forma dei temi del Boss.
// Livello dati. Espone DnD.leggendarioDati { THEMES, THEME_NAMES, PALETTES }; nessuna dipendenza. Non deve toccare DOM,
// disco o rete. I colori qui sono dati dei temi: nei componenti arrivano solo come variabili CSS (--lg-*).
(function (DnD) {
  'use strict';

  const THEMES = ['divino', 'angelico', 'abissale', 'draconico', 'cosmico'];
  const THEME_NAMES = { divino: 'Divino', angelico: 'Angelico', abissale: 'Abissale', draconico: 'Draconico', cosmico: 'Cosmico' };
  // Palette dei temi leggendari, nella stessa forma dei temi del Boss (boss.js), così barra, vignettatura, alone e
  // cornici funzionano con entrambi: accent = oro, glow = luce, shadow = alone, frame = metallo, bg = fondo.
  // Nell'interfaccia si usano con la chiave «lg:<id>» (boss.theme), per non confondersi con i temi del Boss.
  const PALETTES = {
    divino: { name: 'Divino', accent: '#f2c94c', glow: '#fff8e1', shadow: 'rgba(255, 222, 140, 0.55)', frame: '#e8b84a', bg: '#0c0a06', legendary: true, motif: 'raggi' },
    angelico: { name: 'Angelico', accent: '#bfe3ff', glow: '#ffffff', shadow: 'rgba(190, 230, 255, 0.55)', frame: '#8fd0ff', bg: '#070b12', legendary: true, motif: 'piume' },
    abissale: { name: 'Abissale', accent: '#b48cff', glow: '#efe3ff', shadow: 'rgba(140, 80, 230, 0.55)', frame: '#8e5cc9', bg: '#07040d', legendary: true, motif: 'abisso' },
    draconico: { name: 'Draconico', accent: '#f2b23c', glow: '#fff1d0', shadow: 'rgba(230, 90, 40, 0.5)', frame: '#e0322b', bg: '#0d0605', legendary: true, motif: 'scaglie' },
    cosmico: { name: 'Cosmico', accent: '#9fa8ff', glow: '#eef0ff', shadow: 'rgba(110, 120, 255, 0.5)', frame: '#5c6cff', bg: '#05051a', legendary: true, motif: 'stelle' },
  };

  DnD.leggendarioDati = { THEMES, THEME_NAMES, PALETTES };
})(globalThis.DnD = globalThis.DnD || {});
