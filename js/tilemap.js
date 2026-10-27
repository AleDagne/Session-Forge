// TileMap (funzioni pure): mappe dipinte con le tile dei TileSet. Lo stesso modello serve per la
// TileMap di una griglia e per l'aspetto di strutture e oggetti:
//   { kind: 'mappa' | 'immagine', w, h, cellW, cellH, feetPerCell, showGrid, tilesets: [id del TileSet],
//     layers: [{ id, name, visible, opacity, above, fade, locked, data: [cella | null] }],
//     overrides, mask, drawAll, sel, source, cells }
// Una cella è [indice in tilesets, tileId, orientamento 0-7]: niente copie dell'immagine o della tile.
// cellW/cellH: pixel della texture che valgono una cella (0 = ogni tile occupa una cella); una tile più
// grande occupa più celle ed è ancorata alla cella in alto a sinistra. Livelli in ordine di disegno;
// "above" = sopra le pedine. overrides: per cella "-" (normale), "b" (bloccata), "l" (libera).
// Modalità "immagine" (strutture e oggetti): la sorgente intera, un tile per cella, con la maschera
// dei tile selezionati come ingombro.
// Livello regole (gruppo mappa). Espone DnD.tilemap; usa DnD.tileset. Non deve toccare il DOM. storeIndex(): TileSet
// dello stato corrente (modello.statoCorrente) se il chiamante non li passa.
// L'ingombro (footprint) è in collisioni.js.
(function (DnD) {
  'use strict';

  const MAX_SIDE = 100;    // come la griglia di battaglia più grande
  const MAX_LAYERS = 32;
  const MAX_SPAN = 8;      // celle occupate al massimo da una tile per lato
  const TS = () => DnD.tileset;
  const nulls = (n) => new Array(n).fill(null);
  const GRID_LAYERS = [['Base', {}], ['Sopra', { above: true, fade: true }]];

  // ---------- Creazione ----------
  function newLayer(id, name, n, opts) {
    return Object.assign({ id, name, visible: true, opacity: 1, above: false, fade: false, locked: false, data: nulls(n) }, opts);
  }

  function nextLayerId(t) {
    let n = 0;
    for (const l of t.layers) { const m = /^l(\d+)$/.exec(l.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
    return 'l' + n;
  }

  // Tilemap di una struttura o di un oggetto: livello Base (sotto le pedine) e Sopra.
  function newTiles(kind, w, h) {
    const n = w * h;
    return {
      kind, w, h, cellW: 0, cellH: 0, feetPerCell: 5, showGrid: true, tilesets: [],
      layers: [newLayer('l0', 'Base', n), newLayer('l1', 'Sopra', n, { above: true })],
      mask: '1'.repeat(n), drawAll: false, overrides: '-'.repeat(n), sel: '', source: 0, cells: '0'.repeat(n),
    };
  }

  // TileMap di una griglia (stessa dimensione della griglia, di base 50×50): ogni tile occupa una cella
  // ed è scalata alla cella. Livelli Base (sotto le pedine) e Sopra (tetti e chiome).
  function newGridMap(w, h) {
    const t = newTiles('mappa', w || 50, h || 50);
    const n = t.w * t.h;
    t.layers = GRID_LAYERS.map(([name, opts], i) => newLayer('l' + i, name, n, opts));
    return t;
  }

  const tilesetIndex = (list) => Object.fromEntries((list || []).map((t) => [t.id, t]));
  const storeIndex = () => { const st = DnD.modello.statoCorrente(); return st ? tilesetIndex(st.tilesets) : {}; };

  // Indice del TileSet nella tilemap (lo aggiunge se manca: più TileSet nella stessa mappa).
  function tilesetRef(t, tilesetId) {
    let i = t.tilesets.indexOf(tilesetId);
    if (i < 0) { t.tilesets.push(tilesetId); i = t.tilesets.length - 1; }
    return i;
  }

  // Toglie i TileSet non più usati e rinumera le celle.
  function pruneTilesets(t) {
    const used = [...new Set(t.layers.flatMap((l) => l.data.filter(Boolean).map((c) => c[0])))].sort((a, b) => a - b);
    const map = new Map(used.map((old, i) => [old, i]));
    t.tilesets = used.map((i) => t.tilesets[i]);
    for (const l of t.layers) l.data = l.data.map((c) => (c ? [map.get(c[0]), c[1], c[2]] : null));
    return t;
  }

  // ---------- Orientamenti (rotazioni di 90° e specchi) ----------
  const orientIndex = (m) => TS().ORIENTS.findIndex((o) => o.every((v, i) => v === m[i]));
  const orientRotate = (o) => orientIndex(TS().rotateMatrix(TS().ORIENTS[o]));
  const orientMirror = (o) => orientIndex(TS().mirrorMatrix(TS().ORIENTS[o]));
  // L'orientamento scambia larghezza e altezza (rotazioni di 90° e 270°).
  const orientSwaps = (o) => TS().ORIENTS[o][0] === 0;
  // op: 'ruota' (90° orario), 'ruota-sx' (90° antiorario), 'specchia' (orizzontale), 'specchia-v' (verticale).
  function applyOp(o, op) {
    if (op === 'ruota') return orientRotate(o);
    if (op === 'ruota-sx') return orientRotate(orientRotate(orientRotate(o)));
    if (op === 'specchia') return orientMirror(o);
    return orientMirror(orientRotate(orientRotate(o)));
  }

  // ---------- Celle occupate da una tile ----------
  function spanOf(t, byId, cell) {
    if (!(t.cellW > 0 && t.cellH > 0) || !cell) return { w: 1, h: 1 };
    const r = TS().resolveTile(byId[t.tilesets[cell[0]]], cell[1]);
    if (!r) return { w: 1, h: 1 };
    const clamp = (v) => Math.max(1, Math.min(MAX_SPAN, Math.round(v)));
    const w = clamp(r.src.tileW / t.cellW);
    const h = clamp(r.src.tileH / t.cellH);
    return orientSwaps(cell[2]) ? { w: h, h: w } : { w, h };
  }

  const inBounds = (t, x, y) => x >= 0 && y >= 0 && x < t.w && y < t.h;

  // Tile che copre la cella (x, y) del livello: la sua ancora { x, y, cell } oppure null.
  function anchorAt(t, li, x, y, byId) {
    const data = t.layers[li].data;
    if (!inBounds(t, x, y)) return null;
    if (data[y * t.w + x]) return { x, y, cell: data[y * t.w + x] };
    if (!(t.cellW > 0)) return null;
    for (let dy = 0; dy < MAX_SPAN; dy++) {
      for (let dx = 0; dx < MAX_SPAN; dx++) {
        const ax = x - dx;
        const ay = y - dy;
        if ((!dx && !dy) || ax < 0 || ay < 0) continue;
        const c = data[ay * t.w + ax];
        if (!c) continue;
        const s = spanOf(t, byId, c);
        if (dx < s.w && dy < s.h) return { x: ax, y: ay, cell: c };
      }
    }
    return null;
  }

  // ---------- Pittura ----------
  function setCell(t, li, x, y, value) {
    if (!inBounds(t, x, y)) return false;
    const i = y * t.w + x;
    if (JSON.stringify(t.layers[li].data[i]) === JSON.stringify(value)) return false;
    t.layers[li].data[i] = value;
    return true;
  }

  // Timbro: { w, h, stepX, stepY, cells: [[tilesetId, tileId, orientamento] | null] }. stepX/stepY = celle
  // occupate da ogni tile del timbro (tile più grandi della cella). Le posizioni vuote non cancellano.
  function makeStamp(tilesetId, ids, w, h, step) {
    const s = step || { w: 1, h: 1 };
    return { w, h, stepX: s.w, stepY: s.h, cells: ids.map((id) => (id === null || id === undefined ? null : [tilesetId, id, 0])) };
  }

  function paintStamp(t, li, x, y, stamp) {
    let changed = false;
    for (let j = 0; j < stamp.h; j++) {
      for (let i = 0; i < stamp.w; i++) {
        const c = stamp.cells[j * stamp.w + i];
        if (c && setCell(t, li, x + i * stamp.stepX, y + j * stamp.stepY, [tilesetRef(t, c[0]), c[1], c[2]])) changed = true;
      }
    }
    return changed;
  }

  // Cella del timbro ripetuto a partire da (x0, y0); null se (x, y) non è allineata ai passi del timbro.
  function patternAt(stamp, x0, y0, x, y) {
    const dx = x - x0;
    const dy = y - y0;
    if (dx % stamp.stepX || dy % stamp.stepY) return undefined;
    const i = ((dx / stamp.stepX) % stamp.w + stamp.w) % stamp.w;
    const j = ((dy / stamp.stepY) % stamp.h + stamp.h) % stamp.h;
    return stamp.cells[j * stamp.w + i];
  }

  // Gomma: svuota la cella e la tile (anche grande) che la copre.
  function eraseAt(t, li, x, y, byId) {
    const a = anchorAt(t, li, x, y, byId || {});
    let changed = setCell(t, li, x, y, null);
    if (a && setCell(t, li, a.x, a.y, null)) changed = true;
    return changed;
  }

  // Rettangolo: ripete il timbro (o svuota, se stamp è null). rect: { x, y, w, h }.
  function fillRect(t, li, rect, stamp) {
    let changed = false;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (!stamp) { if (setCell(t, li, x, y, null)) changed = true; continue; }
        const c = patternAt(stamp, rect.x, rect.y, x, y);
        if (c && setCell(t, li, x, y, [tilesetRef(t, c[0]), c[1], c[2]])) changed = true;
      }
    }
    return changed;
  }

  // Secchiello: riempie le celle collegate (4 direzioni) uguali a quella di partenza; con contiguous
  // false sostituisce tutte le celle uguali del livello. Le celle non allineate ai passi del timbro si svuotano.
  function bucketFill(t, li, x, y, stamp, contiguous) {
    if (!inBounds(t, x, y)) return false;
    const data = t.layers[li].data;
    const key = (c) => JSON.stringify(c);
    const target = key(data[y * t.w + x]);
    const region = [];
    if (contiguous === false) {
      for (let i = 0; i < data.length; i++) if (key(data[i]) === target) region.push(i);
    } else {
      const seen = new Uint8Array(data.length);
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (!inBounds(t, cx, cy)) continue;
        const i = cy * t.w + cx;
        if (seen[i] || key(data[i]) !== target) continue;
        seen[i] = 1;
        region.push(i);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    }
    let changed = false;
    for (const i of region) {
      const c = stamp ? patternAt(stamp, x, y, i % t.w, Math.floor(i / t.w)) : null;
      const value = c ? [tilesetRef(t, c[0]), c[1], c[2]] : null;
      if (setCell(t, li, i % t.w, Math.floor(i / t.w), value)) changed = true;
    }
    return changed;
  }

  // Secchiello su un array di celle (w×h), contiguo in 4 direzioni.
  function floodFill(data, w, h, x, y, value) {
    const key = (c) => JSON.stringify(c);
    const target = key(data[y * w + x]);
    if (target === key(value)) return data.slice();
    const out = data.slice();
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || key(out[cy * w + cx]) !== target) continue;
      out[cy * w + cx] = value;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return out;
  }

  // ---------- Regioni: copia, incolla, sposta ----------
  // Regione: { w, h, cells: [[tilesetId, tileId, orientamento] | null] } (indipendente dalla mappa).
  function copyRegion(t, li, rect) {
    const cells = [];
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const c = inBounds(t, x, y) ? t.layers[li].data[y * t.w + x] : null;
        cells.push(c ? [t.tilesets[c[0]], c[1], c[2]] : null);
      }
    }
    return { w: rect.w, h: rect.h, cells };
  }

  function clearRegion(t, li, rect) {
    return fillRect(t, li, rect, null);
  }

  // Incolla le celle piene della regione con l'angolo in alto a sinistra in (x, y).
  function pasteRegion(t, li, x, y, region) {
    return paintStamp(t, li, x, y, Object.assign({ stepX: 1, stepY: 1 }, region));
  }

  // Corrispondenza delle posizioni: nuova (x, y) -> vecchio indice, per una griglia w×h.
  function remapIndex(w, h, op) {
    if (op === 'ruota') return { w: h, h: w, src: (x, y) => (h - 1 - x) * w + y };
    if (op === 'ruota-sx') return { w: h, h: w, src: (x, y) => x * w + (w - 1 - y) };
    if (op === 'specchia') return { w, h, src: (x, y) => y * w + (w - 1 - x) };
    return { w, h, src: (x, y) => (h - 1 - y) * w + x };
  }
  function remapString(str, w, h, op) {
    const r = remapIndex(w, h, op);
    let s = '';
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) s += str[r.src(x, y)];
    return s;
  }

  // Ruota o specchia una regione o un timbro: posizioni (e passi) e orientamento di ogni tile.
  function transformRegion(region, op) {
    const r = remapIndex(region.w, region.h, op);
    const cells = [];
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const c = region.cells[r.src(x, y)];
        cells.push(c ? [c[0], c[1], applyOp(c[2], op)] : null);
      }
    }
    const swap = op === 'ruota' || op === 'ruota-sx';
    const out = Object.assign({}, region, { w: r.w, h: r.h, cells });
    if (region.stepX) Object.assign(out, { stepX: swap ? region.stepY : region.stepX, stepY: swap ? region.stepX : region.stepY });
    return out;
  }

  // ---------- Trasformazione dell'intera tilemap (strutture e oggetti ruotati sulla griglia) ----------
  // Le tile grandi restano ancorate all'angolo in alto a sinistra della loro nuova area.
  function transformLayerData(t, data, op, byId) {
    const r = remapIndex(t.w, t.h, op);
    const out = nulls(r.w * r.h);
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (!c) continue;
      const ox = i % t.w;
      const oy = Math.floor(i / t.w);
      const s = spanOf(t, byId, c);
      let ax;
      let ay;
      if (op === 'ruota') { ax = t.h - oy - s.h; ay = ox; }
      else if (op === 'ruota-sx') { ax = oy; ay = t.w - ox - s.w; }
      else if (op === 'specchia') { ax = t.w - ox - s.w; ay = oy; }
      else { ax = ox; ay = t.h - oy - s.h; }
      if (ax >= 0 && ay >= 0 && ax < r.w && ay < r.h) out[ay * r.w + ax] = [c[0], c[1], applyOp(c[2], op)];
    }
    return out;
  }

  function transformTiles(t, op, byId) {
    const b = byId || storeIndex();
    const r = remapIndex(t.w, t.h, op);
    return Object.assign({}, t, {
      w: r.w, h: r.h,
      layers: t.layers.map((l) => Object.assign({}, l, { data: transformLayerData(t, l.data, op, b) })),
      mask: remapString(t.mask, t.w, t.h, op), overrides: remapString(t.overrides, t.w, t.h, op), cells: remapString(t.cells, t.w, t.h, op),
    });
  }

  // ---------- Dimensioni ----------
  // Ritaglia o ingrandisce una tilemap (le celle nuove restano vuote).
  function reshape(t, w, h, at) {
    const off = at || { x: 0, y: 0 };
    const pick = (get, fill) => {
      const out = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ox = x + off.x;
        const oy = y + off.y;
        out.push(ox >= 0 && oy >= 0 && ox < t.w && oy < t.h ? get(oy * t.w + ox) : fill);
      }
      return out;
    };
    return Object.assign({}, t, {
      w, h,
      layers: t.layers.map((l) => Object.assign({}, l, { data: pick((i) => l.data[i], null) })),
      mask: pick((i) => t.mask[i], '0').join(''), overrides: pick((i) => t.overrides[i], '-').join(''), cells: pick((i) => t.cells[i], '0').join(''),
    });
  }
  const crop = (t, b) => reshape(t, b.w, b.h, { x: b.x, y: b.y });
  const resize = (t, w, h) => reshape(t, w, h, { x: 0, y: 0 });

  // Tile che andrebbero perse riducendo la mappa a w×h (at: angolo della nuova area nella vecchia).
  function lostByResize(t, w, h, at) {
    const off = at || { x: 0, y: 0 };
    let n = 0;
    for (const l of t.layers) {
      l.data.forEach((c, i) => {
        const x = (i % t.w) - off.x;
        const y = Math.floor(i / t.w) - off.y;
        if (c && (x < 0 || y < 0 || x >= w || y >= h)) n++;
      });
    }
    return n;
  }

  // Rettangolo dei "1" di una maschera, oppure null.
  function bounds(mask, w, h) {
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < w * h; i++) {
      if (mask[i] !== '1') continue;
      const x = i % w;
      const y = Math.floor(i / w);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---------- Livelli ----------
  function addLayer(t, name, opts) {
    t.layers.push(newLayer(nextLayerId(t), name, t.w * t.h, opts));
    return t.layers.length - 1;
  }

  function duplicateLayer(t, li) {
    const l = t.layers[li];
    const copy = Object.assign(JSON.parse(JSON.stringify(l)), { id: nextLayerId(t), name: (l.name + ' (copia)').slice(0, 40), locked: false });
    t.layers.splice(li + 1, 0, copy);
    return li + 1;
  }

  function removeLayer(t, li) {
    if (t.layers.length <= 1) throw new Error('Deve restare almeno un livello.');
    t.layers.splice(li, 1);
    return Math.min(li, t.layers.length - 1);
  }

  // Sposta un livello nell'ordine di disegno (dir +1 = più in alto). Restituisce il nuovo indice.
  function moveLayer(t, li, dir) {
    const j = li + dir;
    if (j < 0 || j >= t.layers.length) return li;
    const [l] = t.layers.splice(li, 1);
    t.layers.splice(j, 0, l);
    return j;
  }

  // Ordine di disegno: prima i livelli sotto le pedine, poi (dopo le pedine) quelli sopra.
  const layersBelow = (t) => t.layers.filter((l) => !l.above);
  const layersAbove = (t) => t.layers.filter((l) => l.above);

  // ---------- Strutture e oggetti ----------
  // Modalità A: la sorgente intera del TileSet, un tile per cella. selection: tile selezionati ("0"/"1").
  // Se non si disegnano le parti fuori selezione, l'area si riduce al rettangolo dei tile selezionati.
  function imageTiles(ts, srcId, selection, opts) {
    const o = opts || {};
    const src = TS().sourceOf(ts, srcId);
    let t = newTiles('immagine', src.cols, src.rows);
    t.tilesets = [ts.id];
    t.source = srcId;
    const layer = o.layer === 'Sopra' ? 1 : 0;
    t.layers[layer].data = TS().sourceTileIds(src).map((id) => (TS().isExcluded(ts, id) ? null : [0, id, 0]));
    t.layers[1].fade = Boolean(o.fade);
    t.mask = selection;
    t.sel = selection; // selezione sull'intera sorgente, per riaprire l'editor dopo il ritaglio
    t.drawAll = Boolean(o.drawAll);
    if (!t.drawAll) {
      const b = bounds(selection, t.w, t.h);
      if (b) t = crop(t, b);
    }
    return t;
  }

  // ---------- Riferimenti nell'archivio ----------
  // Chiama cb(tilemap, dove) per ogni tilemap dello stato (o di un file): modelli, elementi piazzati,
  // TileMap delle griglie salvate, delle bozze e dei combattimenti. dove: { kind, name }.
  function eachTilemap(state, cb) {
    if (!state || typeof state !== 'object') return;
    const visit = (tm, where) => { if (tm && typeof tm === 'object') cb(tm, where); };
    const grid = (g, where) => {
      if (!g || typeof g !== 'object') return;
      visit(g.tileMap, where);
      for (const p of Array.isArray(g.structures) ? g.structures : []) if (p) visit(p.tiles, where);
      for (const p of Array.isArray(g.items) ? g.items : []) if (p) visit(p.tiles, where);
    };
    const session = (s) => {
      if (!s || typeof s !== 'object') return;
      if (s.combat) grid(s.combat.grid, { kind: 'combattimento', name: s.name });
      if (s.gridDraft) grid(s.gridDraft.grid, { kind: 'bozza', name: s.gridDraft.name });
    };
    for (const x of Array.isArray(state.structures) ? state.structures : []) if (x) visit(x.tiles, { kind: 'struttura', name: x.name });
    for (const x of Array.isArray(state.mapObjects) ? state.mapObjects : []) if (x) visit(x.tiles, { kind: 'oggetto', name: x.name });
    for (const x of Array.isArray(state.items) ? state.items : []) if (x) visit(x.tiles, { kind: 'oggetto', name: x.name }); // dati precedenti
    for (const g of Array.isArray(state.savedGrids) ? state.savedGrids : []) grid(g, { kind: 'griglia', name: g && g.name });
    for (const s of Array.isArray(state.sessions) ? state.sessions : []) session(s);
    session(state.session);
    if (state.combat) grid(state.combat.grid, { kind: 'combattimento', name: '' });
    if (state.gridDraft) grid(state.gridDraft.grid, { kind: 'bozza', name: state.gridDraft.name });
  }

  // TileSet usati (da tutto lo stato o da una sessione esportata).
  function referencedTilesetIds(state) {
    const ids = new Set();
    eachTilemap(state, (tm) => { for (const id of Array.isArray(tm.tilesets) ? tm.tilesets : []) ids.add(id); });
    return [...ids];
  }

  const WHERE = { struttura: 'Struttura', oggetto: 'Oggetto', griglia: 'Griglia', bozza: 'Bozza dell\'editor', combattimento: 'Combattimento della sessione' };
  // Dove è usato un TileSet (o una sua sorgente, se srcId è indicato): elenco di descrizioni.
  function usage(state, tilesetId, srcId) {
    const out = new Set();
    eachTilemap(state, (tm, where) => {
      const ref = (tm.tilesets || []).indexOf(tilesetId);
      if (ref < 0) return;
      const uses = (tm.layers || []).some((l) => (l.data || []).some((c) => c && c[0] === ref && (srcId === undefined || TS().tileCoords(c[1]).src === srcId)));
      if (uses) out.add(WHERE[where.kind] + (where.name ? ' «' + where.name + '»' : ''));
    });
    return [...out];
  }

  DnD.tilemap = {
    MAX_SIDE, MAX_LAYERS, MAX_SPAN, GRID_LAYERS,
    newLayer, nextLayerId, newTiles, newGridMap, tilesetIndex, storeIndex, tilesetRef, pruneTilesets,
    orientIndex, orientRotate, orientMirror, orientSwaps, applyOp,
    spanOf, inBounds, anchorAt, setCell, makeStamp, paintStamp, patternAt, eraseAt, fillRect, bucketFill, floodFill,
    copyRegion, clearRegion, pasteRegion, remapIndex, remapString, transformRegion, transformTiles,
    reshape, crop, resize, lostByResize, bounds,
    addLayer, duplicateLayer, removeLayer, moveLayer, layersBelow, layersAbove,
    imageTiles,
    eachTilemap, referencedTilesetIds, usage,
  };
})(globalThis.DnD = globalThis.DnD || {});
