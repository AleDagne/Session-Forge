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
    if (rand.nota && count) rand.nota({ sides, values: rolls, modifier: mod, total });
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

  // ---------- Dadi animati: registrazione, modello del tiro, piano e coda ----------
  // Regola d'oro: il risultato si decide PRIMA con il generatore (randomInt o un rng con seme); l'animazione legge
  // solo ciò che è stato registrato e finisce sempre su quei valori.

  // Gruppo di dadi: { sides, values, dropped: [indici attenuati], modifier, total, natural (d20 naturale) }.
  function normalizeGroup(g) {
    const sides = Number.isInteger(g.sides) && g.sides >= 2 ? g.sides : 6;
    const values = (Array.isArray(g.values) ? g.values : []).map(Number).filter((v) => Number.isInteger(v) && v >= 1 && v <= sides);
    const dropped = (Array.isArray(g.dropped) ? g.dropped : []).filter((i) => Number.isInteger(i) && i >= 0 && i < values.length);
    const modifier = Number.isFinite(g.modifier) ? g.modifier : 0;
    const kept = values.filter((_, i) => !dropped.includes(i)).reduce((a, b) => a + b, 0);
    return { sides, values, dropped, modifier, total: Number.isFinite(g.total) ? g.total : kept + modifier, natural: Boolean(g.natural) };
  }

  // Registratore: rng(sides) tira con il generatore di base e registra il dado; le funzioni dei tiri (roll,
  // regole.rollD20, rollInitiative, roll4d6DropLowest) chiamano rng.nota(gruppo) per raggruppare gli ultimi dadi
  // (vantaggio, scarto, modificatore). wrap(base) registra un altro generatore negli stessi gruppi (es. con seme).
  function registratore(base) {
    const groups = [];
    const make = (rand) => {
      const rng = (sides) => { const v = rand(sides); groups.push({ sides, values: [v], raw: true }); return v; };
      rng.nota = (g) => {
        const n = (g.values || []).length;
        const tail = groups.slice(-n);
        if (n && tail.length === n && tail.every((x) => x.raw && x.sides === g.sides)) groups.splice(-n, n);
        groups.push(Object.assign(normalizeGroup(g), { raw: false }));
      };
      return rng;
    };
    const rng = make(base || randomInt);
    return {
      rng,
      wrap: (rand) => make(rand),
      gruppi: () => groups.map((g) => normalizeGroup(g)),
      // Tiro da mostrare: { etichetta, categoria, gruppi, totale, testo } (null se non è stato tirato nulla).
      tiro: (etichetta, categoria, extra) => (groups.length ? normalizeTiro(Object.assign({ etichetta, categoria, gruppi: groups }, extra)) : null),
    };
  }

  const CATEGORIE = ['menu', 'combattimento', 'esplorazione'];
  function normalizeTiro(t) {
    t = t && typeof t === 'object' ? t : {};
    const gruppi = (Array.isArray(t.gruppi) ? t.gruppi : []).map(normalizeGroup).filter((g) => g.values.length);
    return {
      etichetta: typeof t.etichetta === 'string' ? t.etichetta.slice(0, 120) : '',
      categoria: CATEGORIE.includes(t.categoria) ? t.categoria : 'menu',
      gruppi,
      totale: Number.isFinite(t.totale) ? t.totale : gruppi.length === 1 ? gruppi[0].total : null,
      testo: typeof t.testo === 'string' ? t.testo.slice(0, 300) : '',
    };
  }
  // Tiro dal risultato di roll() (menù Dadi, danni...).
  const tiroDaRoll = (r, etichetta, categoria) => normalizeTiro({ etichetta, categoria, gruppi: [{ sides: r.sides, values: r.rolls, modifier: r.modifier, total: r.total }] });

  // Piano dell'animazione (puro). opts: { speed: lenta|normale|veloce|istantanea, reduceMotion, limit (dadi animati) }.
  // { dadi: [{ sides, value, faces, dropped, crit: 'max'|'min'|null }], durata (ms), animati, soloTotale, totale }.
  // d100: due d10 (decine 00-90 e unità 0-9; 100 = «00» e «0»).
  const DURATE = { lenta: 1200, normale: 900, veloce: 600, istantanea: 0 };
  const MAX_ANIMATI = 12;
  function d100Faces(v) {
    const tens = v === 100 ? 0 : Math.floor(v / 10) * 10;
    const units = v % 10;
    return [String(tens).padStart(2, '0'), String(units)];
  }
  function pianoAnimazione(tiro, opts) {
    const o = opts || {};
    const t = normalizeTiro(tiro);
    const limit = Number.isInteger(o.limit) ? o.limit : MAX_ANIMATI;
    const dadi = [];
    for (const g of t.gruppi) {
      g.values.forEach((value, i) => {
        const dropped = g.dropped.includes(i);
        const crit = g.sides === 20 && g.natural && !dropped ? (value === 20 ? 'max' : value === 1 ? 'min' : null) : null;
        dadi.push({ sides: g.sides, value, faces: g.sides === 100 ? d100Faces(value) : [String(value)], dropped, crit });
      });
    }
    const conta = dadi.reduce((n, d) => n + (d.sides === 100 ? 2 : 1), 0);
    const soloTotale = conta > limit;
    const durata = o.reduceMotion || soloTotale ? 0 : (DURATE[o.speed] === undefined ? DURATE.normale : DURATE[o.speed]);
    return { dadi: soloTotale ? [] : dadi, durata, animati: durata > 0, soloTotale, conta, totale: t.totale, gruppi: t.gruppi, etichetta: t.etichetta, testo: t.testo };
  }
  // Testo del totale di un gruppo: «[15, 3] + 5 = 20» (i dadi scartati tra parentesi).
  function testoGruppo(g) {
    const vals = g.values.map((v, i) => (g.dropped.includes(i) ? '(' + v + ')' : String(v))).join(' + ');
    const mod = g.modifier ? (g.modifier > 0 ? ' + ' + g.modifier : ' − ' + Math.abs(g.modifier)) : '';
    return (g.values.length > 1 || mod ? vals + mod + ' = ' : '') + g.total;
  }

  // Coda dei tiri da mostrare: uno alla volta, con una pausa breve; mostra(tiro, fatto) li visualizza.
  // timer: { set(fn, ms), clear(id) } iniettabile per i test. gap(): pausa tra due tiri (ms).
  function coda(mostra, opts) {
    const o = opts || {};
    const timer = o.timer || { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
    const gap = o.gap || (() => 250);
    const max = o.max || 30;
    const items = [];
    let busy = false;
    let t = null;
    function next() {
      t = null;
      if (!items.length) { busy = false; return; }
      busy = true;
      const tiro = items.shift();
      let done = false;
      mostra(tiro, () => { if (done) return; done = true; t = timer.set(next, gap()); });
    }
    return {
      push(tiro) {
        if (!tiro) return;
        items.push(tiro);
        if (items.length > max) items.splice(0, items.length - max); // i più vecchi si saltano
        if (!busy) next();
      },
      size: () => items.length + (busy ? 1 : 0),
      clear() { items.length = 0; if (t !== null) timer.clear(t); t = null; busy = false; },
    };
  }

  DnD.dadi = {
    randomInt, uid, parseExpr, roll, rollExpr, formatExpr, MAX_COUNT, MAX_SIDES,
    normalizeGroup, registratore, normalizeTiro, tiroDaRoll, pianoAnimazione, testoGruppo, coda, d100Faces, DURATE, MAX_ANIMATI, CATEGORIE,
  };
})(globalThis.DnD = globalThis.DnD || {});
