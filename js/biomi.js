// Biomi (logica pura): tipi di terreno con regole di viaggio (costo di movimento per modalità, ore per cella,
// ritmo), visibilità e luce, pericoli ambientali, scorte, incontri casuali e meteo; sottobiomi che ereditano
// da un altro bioma. Mappa dei biomi di una griglia (una cella = un bioma, livello separato dall'aspetto
// grafico), con pennello, riempimento, rettangolo, ridimensionamento e generazione a macchie da un seme.
(function (DnD) {
  'use strict';

  const MODES = ['piedi', 'cavallo', 'nave', 'volo'];
  const MODE_NAMES = { piedi: 'A piedi', cavallo: 'A cavallo', nave: 'Nave', volo: 'Volo' };
  const COSTS = [1, 2, 3, 0]; // 0 = impraticabile
  const COST_NAMES = { 1: 'Normale (1)', 2: 'Difficile (2)', 3: 'Molto difficile (3)', 0: 'Impraticabile' };
  const PACES = ['lento', 'normale', 'veloce'];
  const PACE_NAMES = { lento: 'Lento', normale: 'Normale', veloce: 'Veloce' };
  // Ritmo: moltiplicatore delle ore e modificatore alle prove di Percezione/Sopravvivenza (lento: vantaggio
  // simulato con +5 a Furtività-Sopravvivenza, veloce: -5 alla Percezione passiva).
  const PACE = { lento: { hours: 1.5, check: 2 }, normale: { hours: 1, check: 0 }, veloce: { hours: 0.75, check: -5 } };
  const LIGHTS = ['normale', 'penombra', 'buio'];
  const LIGHT_NAMES = { normale: 'Luce normale', penombra: 'Penombra', buio: 'Buio' };
  const HAZARD_FREQS = ['ore', 'entrata'];
  const EFFECT_KINDS = ['danno', 'sfinimento', 'condizione', 'scorte'];
  const EFFECT_NAMES = { danno: 'Danno', sfinimento: 'Livello di sfinimento', condizione: 'Condizione', scorte: 'Perdita di scorte' };
  const ENC_PER = ['ora', 'cella'];
  const MAX_PALETTE = 60;
  const NONE = '.';
  const CODES = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const HEX = /^#[0-9a-f]{6}$/i;
  const uid = () => DnD.dadi.uid();
  const AB = () => DnD.regole.ABILITIES;
  const SKILLS = () => DnD.creatureDati.SKILLS;

  // Prova: caratteristica o abilità con CD.
  function normalizeCheck(c) {
    c = obj(c);
    const what = typeof c.what === 'string' && (AB().includes(c.what) || SKILLS()[c.what]) ? c.what : 'COS';
    return { what, save: Boolean(c.save), dc: int(c.dc, 12, 1, 40) };
  }
  function normalizeEffect(e) {
    e = obj(e);
    return {
      kind: pick(e.kind, EFFECT_KINDS, 'danno'),
      dice: DnD.dadi.parseExpr(e.dice) ? str(e.dice, 20) : '1d6',
      type: str(e.type, 30),
      levels: int(e.levels, 1, 1, 6),
      condition: pick(e.condition, DnD.creatureDati.CONDITIONS, 'avvelenato'),
      food: num(e.food, 1, 0, 100), water: num(e.water, 1, 0, 100),
    };
  }
  function normalizeHazard(h) {
    h = obj(h);
    return {
      id: str(h.id, 64) || uid(), name: str(h.name, 80) || 'Pericolo',
      freq: pick(h.freq, HAZARD_FREQS, 'ore'), hours: int(h.hours, 8, 1, 240),
      check: normalizeCheck(h.check), effect: normalizeEffect(h.effect),
    };
  }
  function normalizeEncounterRow(r) {
    r = obj(r);
    return {
      id: str(r.id, 64) || uid(),
      kind: r.kind === 'evento' ? 'evento' : 'creatura',
      refId: str(r.refId, 64),
      weight: int(r.weight, 1, 1, 100),
      qty: DnD.dadi.parseExpr(r.qty) ? str(r.qty, 20) : '1',
      crMin: str(r.crMin, 5), crMax: str(r.crMax, 5),
    };
  }
  function normalizeWeather(w) {
    w = obj(w);
    return { id: str(w.id, 64) || uid(), name: str(w.name, 60) || 'Sereno', weight: int(w.weight, 1, 1, 100), visibility: int(w.visibility, 0, -10, 10), dc: int(w.dc, 0, -10, 10) };
  }

  // Campi sovrascrivibili da un sottobioma (null = eredita dal padre).
  const FIELDS = ['color', 'icon', 'tiles', 'description', 'cost', 'modeCost', 'hoursPerCell', 'discovery', 'light', 'hazards', 'food', 'water',
    'encounterChance', 'encounterPer', 'encounters', 'weather'];

  function normalizeBiome(b) {
    b = obj(b);
    const parent = str(b.parentId, 64);
    const inherit = (k) => parent && (b[k] === null || b[k] === undefined);
    const mc = obj(b.modeCost);
    const out = {
      id: str(b.id, 64) || uid(),
      name: str(b.name, 60) || 'Bioma',
      parentId: parent,
      color: HEX.test(b.color) ? b.color.toLowerCase() : '#6a9a52',
      icon: b.icon ? DnD.icone.normalizeIcon(b.icon, true) : null,
      tiles: arr(b.tiles).filter((t) => typeof t === 'string').slice(0, 20),
      description: str(b.description, 3000),
      cost: COSTS.includes(Number(b.cost)) ? Number(b.cost) : 1,
      // Eccezioni per modalità di viaggio: costo (come sopra) oppure assente = come il costo base.
      modeCost: Object.fromEntries(MODES.filter((m) => mc[m] !== undefined && mc[m] !== null && mc[m] !== '' && COSTS.includes(Number(mc[m]))).map((m) => [m, Number(mc[m])])),
      hoursPerCell: num(b.hoursPerCell, 4, 0.1, 240),
      discovery: int(b.discovery, 2, 0, 20),
      light: pick(b.light, LIGHTS, 'normale'),
      hazards: arr(b.hazards).slice(0, 20).map(normalizeHazard),
      food: num(b.food, 1, 0, 20), water: num(b.water, 1, 0, 20),
      encounterChance: int(b.encounterChance, 5, 0, 100),
      encounterPer: pick(b.encounterPer, ENC_PER, 'ora'),
      encounters: arr(b.encounters).slice(0, 50).map(normalizeEncounterRow),
      weather: arr(b.weather).slice(0, 20).map(normalizeWeather),
      shared: b.shared !== false,
    };
    // Sottobioma: i campi non indicati restano "da ereditare" (null).
    if (parent) for (const k of FIELDS) if (inherit(k)) out[k] = null;
    return out;
  }

  // Bioma effettivo: i campi null si prendono dal padre (a catena, senza cicli). byId: Map o funzione.
  function resolve(biome, byId) {
    if (!biome) return null;
    const get = typeof byId === 'function' ? byId : (id) => byId.get(id);
    const chain = [biome];
    const seen = new Set([biome.id]);
    let cur = biome;
    while (cur.parentId && !seen.has(cur.parentId)) {
      const p = get(cur.parentId);
      if (!p) break;
      seen.add(p.id);
      chain.push(p);
      cur = p;
    }
    const out = Object.assign({}, biome);
    for (const k of FIELDS) {
      const src = chain.find((x) => x[k] !== null && x[k] !== undefined);
      out[k] = src ? src[k] : normalizeBiome({})[k];
    }
    return out;
  }

  // ---------- Regole di viaggio ----------
  // Costo per cella nella modalità: 0 = impraticabile.
  const costFor = (biome, mode) => (biome.modeCost && biome.modeCost[mode] !== undefined ? biome.modeCost[mode] : biome.cost);
  // Ore per attraversare una cella: ore base × costo × ritmo × scala (le ore del bioma valgono per 1,5 km).
  function hoursFor(biome, mode, pace, scaleKm) {
    const c = costFor(biome, mode);
    if (!c) return null;
    const k = Number.isFinite(scaleKm) && scaleKm > 0 ? scaleKm / 1.5 : 1;
    const speed = mode === 'cavallo' ? 0.8 : mode === 'volo' ? 0.5 : mode === 'nave' ? 0.6 : 1;
    return Math.round(biome.hoursPerCell * c * PACE[pace || 'normale'].hours * k * speed * 100) / 100;
  }

  // ---------- Casualità con seme ----------
  // rng(sides) intero in [1, sides], riproducibile (mulberry32).
  function seededRng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return (sides) => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * sides) + 1;
    };
  }

  function weightedPick(list, rng) {
    const total = list.reduce((s, x) => s + x.weight, 0);
    if (!total) return null;
    let r = rng(total);
    for (const x of list) { r -= x.weight; if (r <= 0) return x; }
    return list[list.length - 1];
  }

  // Meteo: tiro pesato tra i meteo del bioma (null se non ce ne sono).
  const rollWeather = (biome, rng) => (biome.weather && biome.weather.length ? weightedPick(biome.weather, rng) : null);

  // Incontro casuale: tiro d100 contro la probabilità; se riesce, riga pesata della tabella e quantità.
  // creatures: libreria (per l'intervallo di GS). Restituisce { roll, chance, hit, row, qty, missing }.
  function rollEncounter(biome, rng, creatures) {
    const d100 = rng(100);
    const out = { roll: d100, chance: biome.encounterChance, hit: d100 <= biome.encounterChance, row: null, qty: 0, missing: false };
    if (!out.hit) return out;
    const crOk = (r) => {
      if (r.kind !== 'creatura' || (!r.crMin && !r.crMax)) return true;
      const c = (creatures || []).find((x) => x.id === r.refId);
      if (!c || !c.cr) return true;
      const v = DnD.creature.crValue(c.cr);
      return (!r.crMin || v >= DnD.creature.crValue(r.crMin)) && (!r.crMax || v <= DnD.creature.crValue(r.crMax));
    };
    const rows = biome.encounters.filter(crOk);
    out.row = weightedPick(rows, rng);
    if (out.row) {
      const q = DnD.dadi.rollExpr(out.row.qty, rng);
      out.qty = Math.max(1, q ? q.total : 1);
      if (out.row.kind === 'creatura') out.missing = !(creatures || []).some((x) => x.id === out.row.refId);
    }
    return out;
  }

  // Scorte consumate in `hours` ore nel bioma, per `people` persone.
  const consumption = (biome, hours, people) => ({
    food: Math.round(biome.food * (hours / 24) * Math.max(1, people) * 100) / 100,
    water: Math.round(biome.water * (hours / 24) * Math.max(1, people) * 100) / 100,
  });

  // ---------- Mappa dei biomi ----------
  // { palette: [idBioma], cells: stringa w*h (un carattere = indice nella palette, '.' = nessuno),
  //   defaultId, overlay: { visible, opacity } }
  function emptyMap(w, h, defaultId) {
    return { palette: [], cells: NONE.repeat(w * h), defaultId: defaultId || '', overlay: { visible: true, opacity: 0.45 } };
  }
  function normalizeMap(m, w, h) {
    if (!m || typeof m !== 'object') return null;
    const palette = arr(m.palette).filter((x) => typeof x === 'string').slice(0, MAX_PALETTE);
    let cells = typeof m.cells === 'string' ? m.cells : '';
    cells = (cells + NONE.repeat(w * h)).slice(0, w * h).replace(new RegExp('[^' + CODES.slice(0, palette.length).replace(/[^\w]/g, '') + ']', 'g'), NONE);
    if (!palette.length) cells = NONE.repeat(w * h);
    const o = obj(m.overlay);
    return { palette, cells, defaultId: str(m.defaultId, 64), overlay: { visible: o.visible !== false, opacity: num(o.opacity, 0.45, 0.05, 1) } };
  }
  // Bioma (id) di una cella: quello dipinto o il predefinito della mappa.
  function cellBiome(map, w, x, y) {
    if (!map) return '';
    const ch = map.cells[y * w + x];
    if (ch && ch !== NONE) return map.palette[CODES.indexOf(ch)] || map.defaultId || '';
    return map.defaultId || '';
  }
  const paintedBiome = (map, w, x, y) => { const ch = map ? map.cells[y * w + x] : NONE; return ch && ch !== NONE ? map.palette[CODES.indexOf(ch)] || '' : ''; };
  function codeOf(map, id) {
    if (!id) return NONE;
    let i = map.palette.indexOf(id);
    if (i < 0) {
      if (map.palette.length >= MAX_PALETTE) return null;
      map.palette.push(id);
      i = map.palette.length - 1;
    }
    return CODES[i];
  }
  // Assegna (id) o toglie ('') il bioma alle celle [{x, y}]. Modifica map; restituisce le celle cambiate.
  function paint(map, w, h, cells, id) {
    const code = codeOf(map, id);
    if (code === null) return 0;
    const a = map.cells.split('');
    let n = 0;
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
      const i = c.y * w + c.x;
      if (a[i] !== code) { a[i] = code; n++; }
    }
    map.cells = a.join('');
    return n;
  }
  function rectCells(a, b) {
    const out = [];
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
    return out;
  }
  // Riempimento dell'area contigua (4 direzioni) con lo stesso bioma dipinto della cella di partenza.
  function fillCells(map, w, h, start) {
    const target = map.cells[start.y * w + start.x];
    const seen = new Uint8Array(w * h);
    const out = [];
    const stack = [start];
    while (stack.length) {
      const c = stack.pop();
      if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
      const i = c.y * w + c.x;
      if (seen[i] || map.cells[i] !== target) continue;
      seen[i] = 1;
      out.push(c);
      stack.push({ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 });
    }
    return out;
  }
  // Ridimensionamento (come la griglia): dx, dy = celle aggiunte a sinistra/in alto (negativo = tolte).
  function reshapeMap(map, w, h, nw, nh, dx, dy) {
    if (!map) return null;
    const a = [];
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const ox = x - (dx || 0);
      const oy = y - (dy || 0);
      a.push(ox >= 0 && oy >= 0 && ox < w && oy < h ? map.cells[oy * w + ox] : NONE);
    }
    return Object.assign({}, map, { cells: a.join('') });
  }
  // Genera macchie casuali dai biomi indicati (seme riproducibile): crescita da semi sparsi, poi le celle
  // vuote prendono il bioma della cella dipinta più vicina. Sostituisce solo le celle vuote se onlyEmpty.
  function generate(map, w, h, ids, seed, opts) {
    opts = opts || {};
    if (!ids.length) return 0;
    const rng = seededRng(seed);
    const n = Math.max(ids.length, Math.round((w * h) / (opts.blob || 60)));
    const seeds = [];
    // Ogni bioma scelto ha almeno una macchia; le altre sono casuali.
    for (let i = 0; i < n; i++) seeds.push({ x: rng(w) - 1, y: rng(h) - 1, id: i < ids.length ? ids[i] : ids[(rng(ids.length) - 1)] });
    const out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (opts.onlyEmpty && map.cells[y * w + x] !== NONE) continue;
      let best = null;
      let bd = Infinity;
      for (const s of seeds) {
        // Distanza con un po' di rumore per bordi irregolari.
        const d = (s.x - x) ** 2 + (s.y - y) ** 2 + ((x * 7 + y * 13 + s.x * 3) % 5);
        if (d < bd) { bd = d; best = s; }
      }
      out.push({ x, y, id: best.id });
    }
    let changed = 0;
    for (const id of ids) changed += paint(map, w, h, out.filter((c) => c.id === id), id);
    return changed;
  }
  // Biomi usati da una mappa (id), per esportazione e legenda.
  function usedIds(map) {
    if (!map) return [];
    const set = new Set();
    if (map.defaultId) set.add(map.defaultId);
    for (const ch of new Set(map.cells)) if (ch !== NONE && map.palette[CODES.indexOf(ch)]) set.add(map.palette[CODES.indexOf(ch)]);
    return [...set];
  }

  // ---------- Esempi originali ----------
  function examples() {
    const hz = (id, name, freq, hours, what, dc, effect, save) => ({ id, name, freq, hours, check: { what, dc, save: Boolean(save) }, effect });
    const wx = (id, name, weight, visibility, dc) => ({ id, name, weight, visibility, dc });
    return [
      { id: 'bioma-foresta', name: 'Foresta', color: '#2f7d3a', cost: 2, modeCost: { cavallo: 2, volo: 1 }, hoursPerCell: 4, discovery: 1, light: 'penombra', food: 1, water: 1,
        description: 'Alberi fitti e sottobosco: si avanza piano ma acqua e selvaggina non mancano.',
        hazards: [hz('hz-f1', 'Rovi e radici', 'ore', 8, 'Sopravvivenza', 10, { kind: 'danno', dice: '1d4', type: 'perforante' })],
        encounterChance: 8, encounterPer: 'ora', weather: [wx('w-f1', 'Sereno', 6, 0, 0), wx('w-f2', 'Pioggia fine', 3, -1, 1), wx('w-f3', 'Nebbia tra i tronchi', 1, -1, 2)] },
      { id: 'bioma-pianura', name: 'Pianura', color: '#b7c95a', cost: 1, hoursPerCell: 3, discovery: 4, light: 'normale', food: 1, water: 1,
        description: 'Prati e strade di campagna: si vede lontano e si viaggia spediti.',
        encounterChance: 4, encounterPer: 'ora', weather: [wx('w-p1', 'Sereno', 7, 0, 0), wx('w-p2', 'Vento forte', 2, 0, 1), wx('w-p3', 'Temporale', 1, -2, 2)] },
      { id: 'bioma-deserto', name: 'Deserto', color: '#e2b65c', cost: 2, modeCost: { cavallo: 2, volo: 1 }, hoursPerCell: 4, discovery: 5, light: 'normale', food: 1, water: 2,
        description: 'Dune e roccia arsa: di giorno il caldo prosciuga le borracce.',
        hazards: [hz('hz-d1', 'Calura', 'ore', 4, 'COS', 12, { kind: 'sfinimento', levels: 1 }, true)],
        encounterChance: 3, encounterPer: 'ora', weather: [wx('w-d1', 'Sole cocente', 6, 0, 1), wx('w-d2', 'Tempesta di sabbia', 1, -4, 3), wx('w-d3', 'Notte gelida', 2, -1, 1)] },
      { id: 'bioma-palude', name: 'Palude', color: '#5f7a4a', cost: 3, modeCost: { nave: 1, volo: 1 }, hoursPerCell: 4, discovery: 1, light: 'penombra', food: 1, water: 1,
        description: 'Acqua stagnante e canne alte: si affonda fino alle ginocchia e gli insetti non danno tregua.',
        hazards: [hz('hz-pa1', 'Febbre di palude', 'ore', 12, 'COS', 11, { kind: 'condizione', condition: 'avvelenato' }, true)],
        encounterChance: 10, encounterPer: 'ora', weather: [wx('w-pa1', 'Afa', 5, 0, 0), wx('w-pa2', 'Nebbia', 4, -2, 1)] },
      { id: 'bioma-montagna', name: 'Montagna', color: '#8a8580', cost: 3, modeCost: { cavallo: 0, volo: 1 }, hoursPerCell: 6, discovery: 6, light: 'normale', food: 1, water: 1,
        description: 'Sentieri ripidi e passi ventosi: i cavalli non passano oltre le pietraie.',
        hazards: [hz('hz-m1', 'Frana', 'entrata', 0, 'DES', 13, { kind: 'danno', dice: '2d6', type: 'contundente' }, true)],
        encounterChance: 4, encounterPer: 'cella', weather: [wx('w-m1', 'Sereno', 5, 0, 0), wx('w-m2', 'Nubi basse', 3, -3, 1), wx('w-m3', 'Bufera', 1, -4, 3)] },
      { id: 'bioma-tundra', name: 'Tundra', color: '#c8d8de', cost: 2, hoursPerCell: 4, discovery: 5, light: 'normale', food: 1.5, water: 1,
        description: 'Distese gelate e muschio: il freddo morde chi non è coperto.',
        hazards: [hz('hz-t1', 'Gelo', 'ore', 6, 'COS', 12, { kind: 'danno', dice: '1d6', type: 'freddo' }, true)],
        encounterChance: 3, encounterPer: 'ora', weather: [wx('w-t1', 'Cielo terso', 4, 0, 0), wx('w-t2', 'Nevischio', 4, -2, 1), wx('w-t3', 'Bufera di neve', 2, -4, 3)] },
      { id: 'bioma-caverna', name: 'Caverna', color: '#4b4458', cost: 2, modeCost: { cavallo: 0, nave: 0 }, hoursPerCell: 2, discovery: 1, light: 'buio', food: 1, water: 1,
        description: 'Gallerie umide nel buio completo: senza luce non si vede a un passo.',
        hazards: [hz('hz-c1', 'Aria viziata', 'ore', 8, 'COS', 10, { kind: 'sfinimento', levels: 1 }, true)],
        encounterChance: 12, encounterPer: 'ora' },
      { id: 'bioma-costa', name: 'Costa', color: '#4f9fbf', cost: 1, modeCost: { nave: 1 }, hoursPerCell: 3, discovery: 4, light: 'normale', food: 1, water: 1.5,
        description: 'Spiagge, scogliere e insenature: il mare offre pesce ma l\'acqua dolce va cercata.',
        encounterChance: 5, encounterPer: 'ora', weather: [wx('w-co1', 'Brezza', 6, 0, 0), wx('w-co2', 'Mareggiata', 2, -1, 2), wx('w-co3', 'Foschia', 2, -2, 1)] },
      // Sottobioma d'esempio: eredita dalla foresta e sovrascrive solo ciò che cambia.
      { id: 'bioma-foresta-innevata', name: 'Foresta innevata', parentId: 'bioma-foresta', color: '#9fc0b0', cost: 3, light: null,
        hazards: [hz('hz-fi1', 'Gelo tra gli alberi', 'ore', 8, 'COS', 11, { kind: 'danno', dice: '1d4', type: 'freddo' }, true)],
        description: 'Come la foresta, ma la neve alta rallenta e il freddo si fa sentire.' },
    ].map(normalizeBiome);
  }

  DnD.biomi = {
    MODES, MODE_NAMES, COSTS, COST_NAMES, PACES, PACE_NAMES, PACE, LIGHTS, LIGHT_NAMES, HAZARD_FREQS, EFFECT_KINDS, EFFECT_NAMES, ENC_PER, FIELDS, NONE,
    normalizeBiome, normalizeCheck, normalizeEffect, normalizeHazard, normalizeEncounterRow, normalizeWeather, resolve, examples,
    costFor, hoursFor, seededRng, weightedPick, rollWeather, rollEncounter, consumption,
    emptyMap, normalizeMap, cellBiome, paintedBiome, paint, rectCells, fillCells, reshapeMap, generate, usedIds,
  };
})(globalThis.DnD = globalThis.DnD || {});
