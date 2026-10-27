// Palette delle pedine e delle icone della libreria (dati): 14 colori con nome italiano ed esadecimale.
// I primi 4 sono quelli delle versioni precedenti (stessi valori, così i dati esistenti restano validi).
// Livello dati. Espone DnD.colori; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const PALETTE = [
    { key: 'verde', name: 'Verde', hex: '#3fae63' },
    { key: 'blu', name: 'Blu', hex: '#4f8fd6' },
    { key: 'rosso', name: 'Rosso', hex: '#d4453a' },
    { key: 'grigio', name: 'Grigio', hex: '#8a8f9c' },
    { key: 'arancione', name: 'Arancione', hex: '#e8832a' },
    { key: 'giallo', name: 'Giallo', hex: '#f2c94c' },
    { key: 'viola', name: 'Viola', hex: '#8e5cc9' },
    { key: 'rosa', name: 'Rosa', hex: '#e86fa6' },
    { key: 'azzurro', name: 'Azzurro', hex: '#5cc8f0' },
    { key: 'turchese', name: 'Turchese', hex: '#22a39a' },
    { key: 'marrone', name: 'Marrone', hex: '#8b5a2b' },
    { key: 'nero', name: 'Nero', hex: '#2b2b30' },
    { key: 'bianco', name: 'Bianco', hex: '#f4f4f0' },
    { key: 'oro', name: 'Oro', hex: '#c9a227' },
  ];

  // Luminanza relativa (WCAG) di un colore #rrggbb.
  function luminance(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const isDark = (hex) => luminance(hex) < 0.15;

  // Doppio bordo di contrasto: esterno opposto al colore, interno nello stesso verso del colore.
  // Così la pedina resta leggibile su sfondi chiari e scuri, in entrambi i temi.
  function contrastStrokes(hex) {
    return isDark(hex)
      ? { outer: 'rgba(255,255,255,0.9)', inner: 'rgba(0,0,0,0.55)' }
      : { outer: 'rgba(0,0,0,0.75)', inner: 'rgba(255,255,255,0.85)' };
  }

  const byHex = (hex) => PALETTE.find((c) => c.hex === String(hex || '').toLowerCase()) || null;
  const byKey = (key) => PALETTE.find((c) => c.key === key) || null;

  DnD.colori = { PALETTE, luminance, isDark, contrastStrokes, byHex, byKey };
})(globalThis.DnD = globalThis.DnD || {});
