// TileSet (funzioni pure): libreria globale di texture tagliate in tile, sul modello di Godot.
// Un TileSet ha più sorgenti (texture). Ogni sorgente ha un id numerico stabile e un proprio taglio
// (dimensione delle tile, offset iniziale, margine esterno, separazione orizzontale e verticale).
// Ogni tile è identificata da tileId = sorgente·2^20 + riga·2^10 + colonna: resta valida se si
// rinomina la sorgente o se la texture si allarga (nuove righe o colonne). Per le tile della prima
// riga della sorgente 0 l'id coincide con il vecchio indice, quindi i dati precedenti restano validi.
// Le proprietà stanno in tiles[tileId], solo per le tile con valori diversi da quelli predefiniti.
(function (DnD) {
  'use strict';

  const PRESETS = [16, 32, 48, 64, 128];
  const PREFERRED = [32, 16, 64, 48, 128];
  const MAX_IMAGE_SIDE = 8192;          // limite pratico dei canvas
  const LARGE_IMAGE_SIDE = 4096;        // oltre: solo un avviso
  const LARGE_FILE = 8 * 1024 * 1024;   // oltre: solo un avviso
  const MAX_GRID = 1024;                // righe e colonne per sorgente
  const MAX_SOURCES = 2048;
  const EMPTY_THRESHOLD = 0.05;
  const BLOCK_THRESHOLD = 0.5;
  const ALPHA_MIN = 32;
  const COVERS = ['', 'mezza', 'tre-quarti', 'totale'];
  const COVER_NAMES = { '': 'Nessuna', mezza: 'Mezza (+2 CA)', 'tre-quarti': 'Tre quarti (+5 CA)', totale: 'Totale' };
  const SRC_STEP = 1048576;
  const ROW_STEP = 1024;

  // ---------- Identità delle tile ----------
  const tileId = (src, col, row) => src * SRC_STEP + row * ROW_STEP + col;
  const tileCoords = (id) => ({ src: Math.floor(id / SRC_STEP), row: Math.floor(id / ROW_STEP) % ROW_STEP, col: id % ROW_STEP });

  function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
  }

  // ---------- Taglio ----------
  // cut: { tileW, tileH, offsetX, offsetY, margin, sepX, sepY, cover }. Il margine esterno si toglie da tutti
  // i lati; l'offset sposta l'inizio della griglia. Taglio "a copertura" (cover, quello dell'interfaccia
  // attuale: solo larghezza e altezza del tile): la griglia copre tutta l'immagine, colonne e righe si
  // arrotondano per eccesso e i tile di bordo sono tagliati sul bordo dell'immagine ("parziali").
  // Taglio classico (TileSet delle versioni precedenti): i pixel che avanzano a destra e in basso si ignorano.
  function gridOf(imgW, imgH, cut) {
    const m = cut.margin || 0;
    const round = (v) => (cut.cover ? Math.ceil(v - 1e-9) : Math.floor(v + 1e-9));
    const count = (size, start, tile, sep) => (tile > 0 ? Math.min(MAX_GRID, Math.max(0, round((size - m - start + sep) / (tile + sep)))) : 0);
    const x0 = (cut.offsetX || 0) + m;
    const y0 = (cut.offsetY || 0) + m;
    const cols = count(imgW, x0, cut.tileW, cut.sepX || 0);
    const rows = count(imgH, y0, cut.tileH, cut.sepY || 0);
    const used = (n, start, tile, sep) => start + n * tile + Math.max(0, n - 1) * sep;
    return {
      cols, rows,
      restX: cols && !cut.cover ? Math.max(0, Math.round(imgW - m - used(cols, x0, cut.tileW, cut.sepX || 0))) : 0,
      restY: rows && !cut.cover ? Math.max(0, Math.round(imgH - m - used(rows, y0, cut.tileH, cut.sepY || 0))) : 0,
    };
  }

  // Rettangolo sorgente (in pixel) della tile (col, row) di una sorgente. Con il taglio a copertura i tile
  // di bordo si fermano al bordo dell'immagine (sw/sh minori della dimensione del tile).
  function tileRect(src, col, row) {
    const sx = (src.offsetX || 0) + (src.margin || 0) + col * (src.tileW + (src.sepX || 0));
    const sy = (src.offsetY || 0) + (src.margin || 0) + row * (src.tileH + (src.sepY || 0));
    if (!src.cover || !(src.imageW > 0)) return { sx, sy, sw: src.tileW, sh: src.tileH };
    return { sx, sy, sw: Math.max(0, Math.min(src.tileW, src.imageW - sx)), sh: Math.max(0, Math.min(src.tileH, src.imageH - sy)) };
  }

  // Tile di bordo che non copre una cella intera?
  function isPartial(src, col, row) {
    const r = tileRect(src, col, row);
    return r.sw < src.tileW || r.sh < src.tileH;
  }

  // Dimensione proposta: un preset che divide entrambi i lati (32 per primo), altrimenti il
  // divisore comune se dà un numero ragionevole di tile, altrimenti 32.
  function proposeTileSize(w, h) {
    const preset = PREFERRED.find((p) => w % p === 0 && h % p === 0 && Math.max(w, h) / p <= 256);
    if (preset) return preset;
    const g = gcd(w, h);
    return g >= 8 && Math.max(w, h) / g <= 50 ? g : 32;
  }

  const sourceOf = (ts, srcId) => (ts ? ts.sources.find((s) => s.id === srcId) || null : null);
  const inSource = (src, c) => Boolean(src) && src.tileW > 0 && c.col < src.cols && c.row < src.rows;

  // { ts, src, col, row, rect } di una tile, oppure null se la sorgente o la tile non esistono più.
  function resolveTile(ts, id) {
    const c = tileCoords(id);
    const src = sourceOf(ts, c.src);
    if (!inSource(src, c)) return null;
    return { ts, src, col: c.col, row: c.row, rect: tileRect(src, c.col, c.row) };
  }

  // Id delle tile di una sorgente, riga per riga.
  function sourceTileIds(src) {
    const out = [];
    for (let r = 0; r < src.rows; r++) for (let c = 0; c < src.cols; c++) out.push(tileId(src.id, c, r));
    return out;
  }

  // ---------- Proprietà delle tile ----------
  // Le informazioni D&D (copertura, terreno difficile) sono facoltative: con i valori predefiniti
  // il TileSet funziona come un editor di mappe generico.
  function defaultProps() {
    return {
      name: '', category: '', tags: [],
      blocking: false, excluded: false, navigable: true, cost: 1, cover: '',
      collision: { enabled: false, polygons: [] },
      rotate: true, flip: true,
      custom: {},
    };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function tileProps(ts, id) {
    const p = defaultProps();
    const own = ts && ts.tiles ? ts.tiles[id] : null;
    return own ? Object.assign(p, JSON.parse(JSON.stringify(own))) : p;
  }

  // Solo i valori diversi da quelli predefiniti (null se nessuno).
  function compactProps(p) {
    const def = defaultProps();
    const out = {};
    for (const k of Object.keys(def)) if (p[k] !== undefined && !same(p[k], def[k])) out[k] = p[k];
    return Object.keys(out).length ? out : null;
  }

  // Applica le stesse modifiche a più tile (modifica ts).
  function setTileProps(ts, ids, patch) {
    for (const id of ids) {
      const next = compactProps(Object.assign(tileProps(ts, id), JSON.parse(JSON.stringify(patch))));
      if (next) ts.tiles[id] = next;
      else delete ts.tiles[id];
    }
  }

  const isExcluded = (ts, id) => Boolean(ts && ts.tiles && ts.tiles[id] && ts.tiles[id].excluded);

  // Orientamenti consentiti dalla tile (0-3 rotazioni, 4-7 con specchio; 4 e 6 sono specchi puri).
  function orientAllowed(props, o) {
    if (!props.rotate && [1, 2, 3, 5, 7].includes(o)) return false;
    if (!props.flip && o >= 4) return false;
    return true;
  }

  // ---------- Tile vuote ----------
  // Frazione di pixel non trasparenti di ogni tile della sorgente (riga per riga).
  function tileCoverage(alpha, imgW, imgH, src) {
    const out = [];
    for (let row = 0; row < src.rows; row++) {
      for (let col = 0; col < src.cols; col++) {
        const r = tileRect(src, col, row);
        let hits = 0;
        let total = 0;
        for (let y = Math.floor(r.sy); y < Math.floor(r.sy + r.sh); y++) {
          for (let x = Math.floor(r.sx); x < Math.floor(r.sx + r.sw); x++) {
            total++;
            if (x < imgW && y < imgH && alpha[y * imgW + x] >= ALPHA_MIN) hits++;
          }
        }
        out.push(total ? hits / total : 0);
      }
    }
    return out;
  }

  // "1" = tile con meno della soglia di pixel non trasparenti (5% di base).
  function detectEmpty(alpha, imgW, imgH, src, threshold) {
    const t = threshold === undefined ? EMPTY_THRESHOLD : threshold;
    return tileCoverage(alpha, imgW, imgH, src).map((c) => (c < t ? '1' : '0')).join('');
  }

  // Segna come escluse le tile vuote rilevate (le altre tornano incluse): restano modificabili a mano.
  function applyEmpty(ts, src, bits) {
    sourceTileIds(src).forEach((id, i) => setTileProps(ts, [id], { excluded: bits[i] === '1' }));
  }

  // ---------- TileSet e sorgenti ----------
  function newTileset(id, name) {
    return { id, name, smooth: false, threshold: EMPTY_THRESHOLD, blockThreshold: BLOCK_THRESHOLD, nextSourceId: 0, sources: [], tiles: {} };
  }

  // Ricalcola colonne e righe dal taglio.
  function recut(src) {
    if (src.legacy || !(src.imageW > 0) || !(src.tileW > 0)) return src;
    const g = gridOf(src.imageW, src.imageH, src);
    src.cols = Math.max(1, g.cols);
    src.rows = Math.max(1, g.rows);
    return src;
  }

  // image: { name, imageId, imageW, imageH }; cut facoltativo (di base: tile proposta, nessun offset).
  function addSource(ts, image, cut) {
    if (ts.sources.length >= MAX_SOURCES) throw new Error('Troppe sorgenti in questo TileSet.');
    const size = proposeTileSize(image.imageW, image.imageH);
    const src = Object.assign({
      id: ts.nextSourceId, name: image.name || 'Texture', imageId: image.imageId, imageW: image.imageW, imageH: image.imageH,
      tileW: size, tileH: size, offsetX: 0, offsetY: 0, margin: 0, sepX: 0, sepY: 0, cols: 1, rows: 1, legacy: false, cover: true,
    }, cut);
    ts.nextSourceId = Math.max(ts.nextSourceId, src.id) + 1;
    ts.sources.push(recut(src));
    return src;
  }

  // Elimina una sorgente con le proprietà delle sue tile.
  function removeSource(ts, srcId) {
    ts.sources = ts.sources.filter((s) => s.id !== srcId);
    for (const k of Object.keys(ts.tiles)) if (tileCoords(Number(k)).src === srcId) delete ts.tiles[k];
  }

  // Duplica una sorgente: stessa immagine (nessuna copia), id nuovo, proprietà copiate.
  function duplicateSource(ts, srcId, name) {
    const src = sourceOf(ts, srcId);
    const copy = Object.assign(JSON.parse(JSON.stringify(src)), { id: ts.nextSourceId, name: name || src.name + ' (copia)' });
    ts.nextSourceId++;
    ts.sources.splice(ts.sources.indexOf(src) + 1, 0, copy);
    for (const [k, p] of Object.entries(Object.assign({}, ts.tiles))) {
      const c = tileCoords(Number(k));
      if (c.src === srcId) ts.tiles[tileId(copy.id, c.col, c.row)] = JSON.parse(JSON.stringify(p));
    }
    return copy;
  }

  // Immagine intera come singola tile.
  function wholeImageCut(src) {
    return { tileW: src.imageW, tileH: src.imageH, offsetX: 0, offsetY: 0, margin: 0, sepX: 0, sepY: 0, cover: true };
  }

  // ---------- Migrazione dalla versione 5: immagini "stirate" -> tileset (formato della versione 6) ----------
  // Le strutture e gli oggetti con "image" diventano tilemap su un tileset "legacy": tile = immagine /
  // celle dell'area (completato all'avvio, quando si conoscono le dimensioni in pixel).
  const ORIENTS = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0], [-1, 0, 0, 1], [0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0]];
  const legacyTilesetId = (imageId, w, h) => 'ts-' + imageId.slice(4) + '-' + w + 'x' + h;
  const legacyTiles = (w, h) => {
    const n = w * h;
    return { kind: 'immagine', w, h, tilesets: [], layers: [{ name: 'Base', visible: true, data: Array(n).fill(null) }, { name: 'Sopra', visible: true, data: Array(n).fill(null) }],
      mask: '1'.repeat(n), drawAll: false, overrides: '-'.repeat(n), fade: false, sel: '', cells: '0'.repeat(n) };
  };
  // Rotazione/specchio di una tilemap nel formato della versione 6 (due livelli, celle [ts, indice, orientamento]).
  function legacyTransform(t, op) {
    const G = DnD.griglia;
    const orient = (o) => ORIENTS.findIndex((m) => m.every((v, i) => v === (op === 'ruota' ? G.rotateMatrix(ORIENTS[o]) : G.mirrorMatrix(ORIENTS[o]))[i]));
    const rotate = op === 'ruota';
    const w = rotate ? t.h : t.w;
    const h = rotate ? t.w : t.h;
    const src = (x, y) => (rotate ? (t.h - 1 - x) * t.w + y : y * t.w + (t.w - 1 - x));
    const remap = (get) => { const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(get(src(x, y))); return out; };
    return Object.assign({}, t, {
      w, h,
      layers: t.layers.map((l) => Object.assign({}, l, { data: remap((i) => (l.data[i] ? [l.data[i][0], l.data[i][1], orient(l.data[i][2])] : null)) })),
      mask: remap((i) => t.mask[i]).join(''), overrides: remap((i) => t.overrides[i]).join(''), cells: remap((i) => t.cells[i]).join(''),
    });
  }
  function opsFor(m) {
    const G = DnD.griglia;
    const key = (x) => x.join(',');
    const seen = new Map([[key([1, 0, 0, 1]), []]]);
    const queue = [[1, 0, 0, 1]];
    while (queue.length) {
      const cur = queue.shift();
      if (key(cur) === key(m)) return seen.get(key(cur));
      for (const [op, next] of [['ruota', G.rotateMatrix(cur)], ['specchia', G.mirrorMatrix(cur)]]) {
        if (!seen.has(key(next))) { seen.set(key(next), seen.get(key(cur)).concat(op)); queue.push(next); }
      }
    }
    return [];
  }

  function migrateLegacy(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    raw.tilesets = Array.isArray(raw.tilesets) ? raw.tilesets : [];
    const valid = (im) => im && typeof im === 'object' && /^img-[0-9a-f]{16}$/.test(im.id) && im.w >= 1 && im.h >= 1;
    const ensure = (im) => {
      const id = legacyTilesetId(im.id, im.w, im.h);
      if (!raw.tilesets.some((t) => t && t.id === id)) {
        const n = im.w * im.h;
        raw.tilesets.push({ id, name: 'Immagine importata (' + im.w + '×' + im.h + ')', imageId: im.id, imageW: 0, imageH: 0, tileW: 0, tileH: 0,
          margin: 0, spacing: 0, cols: im.w, rows: im.h, smooth: true, blocking: '0'.repeat(n), empty: '0'.repeat(n), legacy: true });
      }
      return id;
    };
    const tilesFrom = (im, cells) => {
      const t = legacyTiles(im.w, im.h);
      t.tilesets = [ensure(im)];
      t.layers[im.layer === 'sopra' ? 1 : 0].data = t.layers[0].data.map((_, i) => [0, i, 0]);
      const mask = typeof cells === 'string' && cells.length === im.w * im.h ? cells : '1'.repeat(im.w * im.h);
      return Object.assign(t, { mask, sel: mask, cells: mask, drawAll: true, fade: Boolean(im.fade) });
    };
    const template = (x) => {
      if (x && x.mode === 'image' && valid(x.image)) {
        x.tiles = tilesFrom(x.image, x.image.cells);
        x.mode = 'tiles';
      }
      if (x) delete x.image;
    };
    const placed = (p) => {
      if (!p || !valid(p.image)) { if (p) delete p.image; return; }
      let t = tilesFrom(p.image, null);
      for (const op of opsFor(Array.isArray(p.image.m) ? p.image.m.map(Number) : [1, 0, 0, 1])) t = legacyTransform(t, op);
      if (typeof p.cells === 'string' && p.cells.length === t.w * t.h) t = Object.assign(t, { mask: p.cells, cells: p.cells });
      p.tiles = t;
      delete p.image;
    };
    const grid = (g) => { if (g && typeof g === 'object') { (g.structures || []).forEach(placed); (g.items || []).forEach(placed); } };
    (raw.structures || []).forEach(template);
    (raw.items || []).forEach(template);
    (raw.savedGrids || []).forEach(grid);
    for (const s of raw.sessions || []) if (s) { grid(s.combat && s.combat.grid); grid(s.gridDraft && s.gridDraft.grid); }
    if (raw.session) { grid(raw.session.combat && raw.session.combat.grid); grid(raw.session.gridDraft && raw.session.gridDraft.grid); }
    grid(raw.combat && raw.combat.grid);
    grid(raw.gridDraft && raw.gridDraft.grid);
    return raw;
  }

  // ---------- Migrazione alla versione 7: TileSet con sorgenti e id stabili, livelli generici ----------
  // Tileset della versione 6 (un'immagine, flag "blocking"/"empty" per indice) -> una sorgente (id 0);
  // celle [ts, indice, orientamento] -> [ts, tileId, orientamento]; i due livelli fissi Base/Sopra
  // diventano livelli completi ("Sopra" sopra le pedine, con la semitrasparenza della tilemap).
  function migrateV7(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 7) return raw;
    const cols = {};
    raw.tilesets = (Array.isArray(raw.tilesets) ? raw.tilesets : []).map((t) => {
      if (!t || typeof t !== 'object' || Array.isArray(t.sources)) return t;
      const c = Math.max(1, Math.round(Number(t.cols)) || 1);
      cols[t.id] = c;
      const tiles = {};
      const bits = (s) => (typeof s === 'string' ? s : '');
      for (let i = 0; i < Math.max(bits(t.blocking).length, bits(t.empty).length); i++) {
        const p = {};
        if (bits(t.blocking)[i] === '1') p.blocking = true;
        if (bits(t.empty)[i] === '1') p.excluded = true;
        if (Object.keys(p).length) tiles[tileId(0, i % c, Math.floor(i / c))] = p;
      }
      const m = Number(t.margin) || 0;
      const sp = Number(t.spacing) || 0;
      return {
        id: t.id, name: t.name, smooth: t.smooth, threshold: t.threshold, blockThreshold: BLOCK_THRESHOLD, nextSourceId: 1,
        sources: [{ id: 0, name: t.name, imageId: t.imageId, imageW: t.imageW, imageH: t.imageH, tileW: t.tileW, tileH: t.tileH,
          offsetX: m, offsetY: m, margin: 0, sepX: sp, sepY: sp, cols: t.cols, rows: t.rows, legacy: t.legacy }],
        tiles,
      };
    });
    DnD.tilemap.eachTilemap(raw, (tm) => {
      if (!tm || typeof tm !== 'object' || !Array.isArray(tm.layers)) return;
      const refs = Array.isArray(tm.tilesets) ? tm.tilesets : [];
      tm.layers = tm.layers.slice(0, 2).map((l, li) => {
        l = l && typeof l === 'object' ? l : {};
        const data = (Array.isArray(l.data) ? l.data : []).map((c) => {
          if (!Array.isArray(c) || c.length !== 3) return null;
          const n = cols[refs[c[0]]] || 1;
          return [c[0], tileId(0, c[1] % n, Math.floor(c[1] / n)), c[2]];
        });
        return { id: 'l' + li, name: li ? 'Sopra' : 'Base', visible: l.visible !== false, opacity: 1, above: li === 1, fade: li === 1 && Boolean(tm.fade), locked: false, data };
      });
      tm.source = 0;
      delete tm.fade;
    });
    return raw;
  }

  // Tutte le migrazioni dei dati grezzi, nell'ordine, prima della normalizzazione.
  const migrateRaw = (raw) => migrateV7(migrateLegacy(raw));

  // Sorgente "legacy": tile = dimensione dell'immagine / celle dell'area, quando si conoscono i pixel.
  function resolveLegacy(src, imgW, imgH) {
    return Object.assign({}, src, { imageW: imgW, imageH: imgH, tileW: imgW / src.cols, tileH: imgH / src.rows });
  }

  DnD.tileset = {
    PRESETS, MAX_IMAGE_SIDE, LARGE_IMAGE_SIDE, LARGE_FILE, MAX_GRID, EMPTY_THRESHOLD, BLOCK_THRESHOLD, COVERS, COVER_NAMES, ORIENTS,
    tileId, tileCoords, gcd, gridOf, tileRect, isPartial, proposeTileSize, sourceOf, resolveTile, sourceTileIds,
    defaultProps, tileProps, compactProps, setTileProps, isExcluded, orientAllowed,
    tileCoverage, detectEmpty, applyEmpty,
    newTileset, recut, addSource, removeSource, duplicateSource, wholeImageCut,
    legacyTilesetId, opsFor, migrateLegacy, migrateV7, migrateRaw, resolveLegacy,
  };
})(globalThis.DnD = globalThis.DnD || {});
