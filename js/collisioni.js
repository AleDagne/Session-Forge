// Collisioni delle tile (funzioni pure). I poligoni sono in coordinate locali della tile, normalizzate
// tra 0 e 1 (0,0 = angolo in alto a sinistra, 1,1 = in basso a destra): non dipendono dalla dimensione
// in pixel né dalla posizione sulla mappa e seguono l'orientamento della cella.
// Le pedine si muovono a scatti sulle celle: una cella è bloccata se i poligoni ne coprono almeno la
// soglia del TileSet (50% di base). La copertura si misura campionando 16×16 punti per cella, così
// poligoni sovrapposti non contano due volte. Il flag "Bloccante" e "Non navigabile" bloccano tutta la tile.
// Livello regole (gruppo mappa), sopra tilemap.js. Espone DnD.collisioni (anche l'ingombro delle tilemap: footprint,
// withFootprint, regionToTiles); usa DnD.tileset e DnD.tilemap. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const SAMPLES = 16;
  const MAX_POLYGONS = 16;
  const MAX_POINTS = 64;
  const TS = () => DnD.tileset;
  const TM = () => DnD.tilemap;
  const COVER_RANK = { '': 0, mezza: 1, 'tre-quarti': 2, totale: 3 };

  // ---------- Geometria ----------
  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Area (con segno) di un poligono.
  function polygonArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    return a / 2;
  }

  // Frazione del rettangolo [x0,x1]×[y0,y1] coperta dall'unione dei poligoni.
  function coverage(polygons, x0, y0, x1, y1) {
    let hits = 0;
    for (let j = 0; j < SAMPLES; j++) {
      const y = y0 + ((j + 0.5) / SAMPLES) * (y1 - y0);
      for (let i = 0; i < SAMPLES; i++) {
        const x = x0 + ((i + 0.5) / SAMPLES) * (x1 - x0);
        if (polygons.some((p) => pointInPolygon(x, y, p))) hits++;
      }
    }
    return hits / (SAMPLES * SAMPLES);
  }

  // Punto della tile dopo l'orientamento della cella (rotazione/specchio attorno al centro).
  function orientPoint(o, p) {
    const m = TS().ORIENTS[o];
    const x = p[0] - 0.5;
    const y = p[1] - 0.5;
    return [m[0] * x + m[1] * y + 0.5, m[2] * x + m[3] * y + 0.5];
  }

  const orientPolygons = (polygons, o) => polygons.map((p) => p.map((q) => orientPoint(o, q)));

  // Poligoni validi: almeno 3 vertici, coordinate tra 0 e 1, area non nulla.
  function normalizePolygons(v) {
    const clamp = (n) => Math.min(1, Math.max(0, Math.round(Number(n) * 10000) / 10000));
    return (Array.isArray(v) ? v : []).slice(0, MAX_POLYGONS).map((p) => (Array.isArray(p) ? p : [])
      .filter((q) => Array.isArray(q) && q.length === 2 && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[1])))
      .slice(0, MAX_POINTS).map((q) => [clamp(q[0]), clamp(q[1])]))
      .filter((p) => p.length >= 3 && Math.abs(polygonArea(p)) > 1e-6);
  }

  // Poligono rettangolare a tutta tile (punto di partenza dell'editor).
  const fullRect = () => [[0, 0], [1, 0], [1, 1], [0, 1]];

  // ---------- Blocco delle celle coperte da una tile ----------
  const maskCache = new Map();

  // Celle bloccate (true/false, riga per riga) di una tile con area span (già orientata) e orientamento o.
  function tileBlockMask(props, span, o, threshold) {
    const n = span.w * span.h;
    if (props.excluded) return new Array(n).fill(false);
    if (props.blocking || !props.navigable) return new Array(n).fill(true);
    const col = props.collision;
    if (!col || !col.enabled || !col.polygons.length) return new Array(n).fill(false);
    const key = JSON.stringify([col.polygons, span.w, span.h, o, threshold]);
    if (!maskCache.has(key)) {
      if (maskCache.size > 2000) maskCache.clear();
      const polys = orientPolygons(col.polygons, o);
      const out = [];
      for (let j = 0; j < span.h; j++) {
        for (let i = 0; i < span.w; i++) out.push(coverage(polys, i / span.w, j / span.h, (i + 1) / span.w, (j + 1) / span.h) >= threshold - 1e-9);
      }
      maskCache.set(key, out);
    }
    return maskCache.get(key);
  }

  // Visita le celle della mappa coperte da ogni tile di ogni livello: cb(x, y, props, ts, blockedHere).
  function eachCoveredCell(t, byId, cb) {
    for (const l of t.layers) {
      for (let i = 0; i < l.data.length; i++) {
        const c = l.data[i];
        if (!c) continue;
        const ts = byId[t.tilesets[c[0]]];
        if (!ts || !TS().resolveTile(ts, c[1])) continue; // tile mancante: segnaposto, non blocca
        const props = TS().tileProps(ts, c[1]);
        if (props.excluded) continue;
        const span = TM().spanOf(t, byId, c);
        const mask = tileBlockMask(props, span, c[2], ts.blockThreshold > 0 ? ts.blockThreshold : TS().BLOCK_THRESHOLD);
        const ax = i % t.w;
        const ay = Math.floor(i / t.w);
        for (let dy = 0; dy < span.h; dy++) {
          for (let dx = 0; dx < span.w; dx++) {
            const x = ax + dx;
            const y = ay + dy;
            if (x < t.w && y < t.h) cb(x, y, props, ts, mask[dy * span.w + dx]);
          }
        }
      }
    }
  }

  // Celle bloccate della mappa come chiavi y·keyW + x (keyW = larghezza della griglia di destinazione).
  // Le eccezioni dello strumento Blocco ("b" bloccata, "l" libera) valgono salvo opts.overrides === false.
  function blockedSet(t, byId, keyW, opts) {
    const set = new Set();
    if (!t) return set;
    const w = keyW || t.w;
    eachCoveredCell(t, byId || {}, (x, y, props, ts, blocked) => { if (blocked) set.add(y * w + x); });
    if (!opts || opts.overrides !== false) {
      for (let i = 0; i < t.w * t.h; i++) {
        const k = Math.floor(i / t.w) * w + (i % t.w);
        if (t.overrides[i] === 'b') set.add(k);
        else if (t.overrides[i] === 'l') set.delete(k);
      }
    }
    return set;
  }

  // Informazioni di gioco di una cella della mappa: bloccata, costo di movimento (il più alto),
  // copertura (la migliore), tag e categorie delle tile che la coprono.
  function cellInfo(t, byId, x, y) {
    const info = { blocked: false, cost: 1, cover: '', tags: [], categories: [] };
    if (!t || !TM().inBounds(t, x, y)) return info;
    eachCoveredCell(t, byId || {}, (cx, cy, props, ts, blocked) => {
      if (cx !== x || cy !== y) return;
      if (blocked) info.blocked = true;
      info.cost = Math.max(info.cost, props.cost);
      if (COVER_RANK[props.cover] > COVER_RANK[info.cover]) info.cover = props.cover;
      for (const tag of props.tags) if (!info.tags.includes(tag)) info.tags.push(tag);
      if (props.category && !info.categories.includes(props.category)) info.categories.push(props.category);
    });
    const o = t.overrides[y * t.w + x];
    if (o === 'b') info.blocked = true;
    if (o === 'l') info.blocked = false;
    return info;
  }

  // ---------- Ingombro delle tilemap (spostato da tilemap.js: dipende dalle collisioni) ----------
  // Ingombro. Strutture "da immagine": i tile selezionati; se tra quelli selezionati ce n'è almeno uno
  // "Bloccante", bloccano solo quelli (gli altri selezionati restano disegnati ma attraversabili).
  // Tilemap: celle bloccate (flag "Bloccante", navigabilità e poligoni di collisione) per le strutture,
  // celle occupate da una tile per gli oggetti. Le celle forzate con lo strumento Blocco hanno la precedenza.
  function footprint(t, byId, kind) {
    if (t.kind === 'immagine') {
      const blocking = new Array(t.w * t.h).fill(false);
      for (const l of t.layers) {
        l.data.forEach((c, i) => {
          if (c && t.mask[i] === '1' && TS().tileProps(byId[t.tilesets[c[0]]], c[1]).blocking) blocking[i] = true;
        });
      }
      if (!blocking.some(Boolean)) return t.mask;
      return blocking.map((b) => (b ? '1' : '0')).join('');
    }
    const n = t.w * t.h;
    const on = new Uint8Array(n);
    if (kind === 'item') {
      for (const l of t.layers) {
        l.data.forEach((c, i) => {
          if (!c || TS().isExcluded(byId[t.tilesets[c[0]]], c[1])) return;
          const s = TM().spanOf(t, byId, c);
          for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) {
            const x = (i % t.w) + dx;
            const y = Math.floor(i / t.w) + dy;
            if (x < t.w && y < t.h) on[y * t.w + x] = 1;
          }
        });
      }
    } else {
      for (const k of blockedSet(t, byId, t.w, { overrides: false })) on[k] = 1;
    }
    let cells = '';
    for (let i = 0; i < n; i++) cells += t.overrides[i] === 'b' ? '1' : t.overrides[i] === 'l' ? '0' : on[i] ? '1' : '0';
    return cells;
  }

  function withFootprint(t, byId, kind) {
    return Object.assign({}, t, { cells: footprint(t, byId, kind) });
  }

  // Una regione della mappa (tutti i livelli) come tilemap di una struttura o di un oggetto riutilizzabile.
  function regionToTiles(t, rect, byId, kind) {
    const part = TM().crop(JSON.parse(JSON.stringify(t)), rect);
    part.kind = 'mappa';
    part.layers = part.layers.map((l) => Object.assign(l, { locked: false }));
    part.mask = '1'.repeat(rect.w * rect.h);
    return withFootprint(TM().pruneTilesets(part), byId, kind);
  }

  DnD.collisioni = {
    SAMPLES, MAX_POLYGONS, MAX_POINTS,
    pointInPolygon, polygonArea, coverage, orientPoint, orientPolygons, normalizePolygons, fullRect,
    tileBlockMask, eachCoveredCell, blockedSet, cellInfo, footprint, withFootprint, regionToTiles,
  };
})(globalThis.DnD = globalThis.DnD || {});
