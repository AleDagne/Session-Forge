// Dadi e casualità: generatore senza bias e parser di espressioni come "3d6+2".
(function (DnD) {
  'use strict';

  const RANGE = 0x100000000; // 2^32 valori possibili di un Uint32
  const MAX_COUNT = 100;
  const MAX_SIDES = 1000;
  const MAX_MODIFIER = 1000;

  // Intero uniforme in [1, sides]. Rejection sampling: scarta i valori oltre
  // l'ultimo multiplo intero di `sides`, così il modulo non introduce bias.
  function randomInt(sides) {
    if (!Number.isInteger(sides) || sides < 1) throw new RangeError('Numero di facce non valido');
    const limit = RANGE - (RANGE % sides);
    const buf = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return (buf[0] % sides) + 1;
  }

  // Identificativo casuale (crypto.randomUUID non è garantito fuori da contesti sicuri).
  function uid() {
    const buf = new Uint32Array(4);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, (n) => n.toString(16).padStart(8, '0')).join('');
  }

  // "3d6+2" -> { count: 3, sides: 6, modifier: 2 }; "d20" -> 1d20; "5" -> { count: 0, sides: 0, modifier: 5 }.
  // Restituisce null se l'espressione non è valida.
  function parseExpr(text) {
    const s = String(text == null ? '' : text).replace(/\s+/g, '').toLowerCase();
    if (/^[+-]?\d+$/.test(s)) {
      const modifier = Number(s);
      return Math.abs(modifier) <= MAX_MODIFIER ? { count: 0, sides: 0, modifier } : null;
    }
    const m = /^(\d*)d(\d+)(?:([+-])(\d+))?$/.exec(s);
    if (!m) return null;
    const count = m[1] === '' ? 1 : Number(m[1]);
    const sides = Number(m[2]);
    const modifier = m[3] ? Number(m[3] + m[4]) : 0;
    if (count < 1 || count > MAX_COUNT || sides < 2 || sides > MAX_SIDES || Math.abs(modifier) > MAX_MODIFIER) {
      return null;
    }
    return { count, sides, modifier };
  }

  // Tira `count` dadi da `sides` facce. `rng(sides)` è iniettabile per i test.
  function roll(count, sides, modifier, rng) {
    const rand = rng || randomInt;
    const mod = modifier || 0;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(rand(sides));
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    return { count, sides, modifier: mod, rolls, total };
  }

  function rollExpr(text, rng) {
    const p = parseExpr(text);
    return p ? roll(p.count, p.sides, p.modifier, rng) : null;
  }

  function formatExpr(count, sides, modifier) {
    const mod = modifier ? (modifier > 0 ? '+' + modifier : String(modifier)) : '';
    if (!count) return String(modifier || 0);
    return count + 'd' + sides + mod;
  }

  DnD.dadi = { randomInt, uid, parseExpr, roll, rollExpr, formatExpr, MAX_COUNT, MAX_SIDES };
})(globalThis.DnD = globalThis.DnD || {});
