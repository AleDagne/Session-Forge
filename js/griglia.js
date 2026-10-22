// Logica pura della griglia di battaglia: dimensioni, forme, collisioni, coordinate, distanze,
// sfondo, ridimensionamento, annulla/ripeti e griglie salvate. Nessun accesso al DOM.
// Le griglie hanno una dimensione libera (w × h celle, da 5 a 100 per lato, di base 50×50): le celle
// si identificano con la chiave y·STRIDE + x, con un passo fisso indipendente dalla dimensione.
(function (DnD) {
  'use strict';

  const DEFAULT_SIZE = 50;
  const MIN_SIZE = 5;
  const MAX_SIZE = 100;
  const SIZE = DEFAULT_SIZE;  // dimensione delle griglie precedenti (50×50)
  const STRIDE = 1024;        // passo delle chiavi di cella (> MAX_SIZE)
  const CELL_PX = 32;         // lato di una cella a zoom 1
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 3;
  const MAX_TOKEN = 8;        // lato massimo di una pedina in celle
  const PRESETS = ['rettangolo', 'cerchio', 'triangolo', 'L', 'T', 'croce'];
  const PRESET_NAMES = { rettangolo: 'Rettangolo', cerchio: 'Cerchio', triangolo: 'Triangolo', L: 'L', T: 'T', croce: 'Croce' };
  const TOKEN_SIZES = { Minuscola: 1, Piccola: 1, Media: 1, Grande: 2, Enorme: 3, Mastodontica: 4 };
  const TOKEN_PRESETS = [1, 2, 3, 4, 5];
  const BG_FITS = ['adatta', 'copri', 'originale'];
  const BG_FIT_NAMES = { adatta: 'Adatta alla griglia (stira)', copri: 'Copri (mantiene le proporzioni)', originale: 'Dimensione originale' };

  // Dimensioni di una griglia (o di un "board"): le griglie precedenti non le hanno e sono 50×50.
  function dims(g) {
    const ok = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE;
    return { w: g && ok(g.w) ? g.w : DEFAULT_SIZE, h: g && ok(g.h) ? g.h : DEFAULT_SIZE };
  }
  const key = (x, y) => y * STRIDE + x;
  const keyX = (k) => k % STRIDE;
  const keyY = (k) => Math.floor(k / STRIDE);

  // ---------- Etichette ----------
  // 0 -> A, 25 -> Z, 26 -> AA, 49 -> AX, 99 -> CV
  function colLabel(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  function cellLabel(x, y) {
    return colLabel(x) + (y + 1);
  }

  // ---------- Forme (bitmap riga per riga: "1" = cella piena) ----------
  function shapeFrom(w, h, filled) {
    let cells = '';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells += filled(x, y) ? '1' : '0';
    return { w, h, cells };
  }

  function isFilled(shape, x, y) {
    return x >= 0 && y >= 0 && x < shape.w && y < shape.h && shape.cells[y * shape.w + x] === '1';
  }

  function presetShape(preset, w, h) {
    const t = Math.max(1, Math.round(Math.min(w, h) / 3)); // spessore dei bracci di L, T e croce
    const midX = (x) => x >= Math.floor((w - t) / 2) && x < Math.floor((w - t) / 2) + t;
    const midY = (y) => y >= Math.floor((h - t) / 2) && y < Math.floor((h - t) / 2) + t;
    switch (preset) {
      case 'cerchio': return shapeFrom(w, h, (x, y) => ((x + 0.5) / w * 2 - 1) ** 2 + ((y + 0.5) / h * 2 - 1) ** 2 <= 0.9);
      case 'triangolo': return shapeFrom(w, h, (x, y) => Math.abs(x + 0.5 - w / 2) <= Math.max(0.5, ((y + 1) / h) * (w / 2)));
      case 'L': return shapeFrom(w, h, (x, y) => x < t || y >= h - t);
      case 'T': return shapeFrom(w, h, (x, y) => y < t || midX(x));
      case 'croce': return shapeFrom(w, h, (x, y) => midX(x) || midY(y));
      default: return shapeFrom(w, h, () => true);
    }
  }

  // Rotazione di 90° in senso orario.
  function rotateShape(s) {
    return shapeFrom(s.h, s.w, (x, y) => isFilled(s, y, s.h - 1 - x));
  }

  // Specchio orizzontale.
  function mirrorShape(s) {
    return shapeFrom(s.w, s.h, (x, y) => isFilled(s, s.w - 1 - x, y));
  }

  function resizeShape(s, w, h) {
    return shapeFrom(w, h, (x, y) => isFilled(s, x, y));
  }

  function squareShape(size) {
    return shapeFrom(size, size, () => true);
  }

  function rectShape(w, h) {
    return shapeFrom(w, h, () => true);
  }

  // ---------- Pedine: ingombro in celle ----------
  function tokenSize(raceSize) {
    return TOKEN_SIZES[raceSize] || 1;
  }

  // gridSize di un personaggio: { auto, w, h }. Automatica = dalla taglia (della razza o della creatura).
  function gridSizeFor(gridSize, size) {
    const gs = gridSize || { auto: true };
    if (gs.auto !== false) { const n = tokenSize(size); return { w: n, h: n }; }
    const side = (v) => Math.max(1, Math.min(MAX_TOKEN, Math.round(Number(v)) || 1));
    return { w: side(gs.w), h: side(gs.h) };
  }

  // Ingombro di un combattente: w × h (i dati precedenti hanno solo "size", quadrato).
  function tokenDims(c) {
    const side = (v) => (Number.isInteger(v) && v >= 1 && v <= MAX_TOKEN ? v : null);
    const s = side(c.size) || 1;
    return { w: side(c.w) || s, h: side(c.h) || s };
  }
  const tokenShape = (c) => { const d = tokenDims(c); return rectShape(d.w, d.h); };

  // Celle occupate (chiavi) da una forma posizionata in (x, y).
  function cellsAt(shape, x, y) {
    const out = [];
    for (let j = 0; j < shape.h; j++) for (let i = 0; i < shape.w; i++) if (isFilled(shape, i, j)) out.push(key(x + i, y + j));
    return out;
  }

  // La forma in (x, y) sta tutta nella griglia? area: griglia o board (di base 50×50).
  function inBounds(shape, x, y, area) {
    const d = dims(area);
    return x >= 0 && y >= 0 && x + shape.w <= d.w && y + shape.h <= d.h;
  }

  // La cella (x, y) è coperta dalla pedina?
  function tokenCovers(c, x, y) {
    if (!c.pos) return false;
    const d = tokenDims(c);
    return x >= c.pos.x && x < c.pos.x + d.w && y >= c.pos.y && y < c.pos.y + d.h;
  }

  // ---------- Collisioni ----------
  // board: { w, h, combatants: [{ id, w, h, pos }], structures: [{ id, x, y, w, h, cells }], items, tileMap, ignoreCollisions }
  function tokenCells(c) {
    return c.pos ? cellsAt(tokenShape(c), c.pos.x, c.pos.y) : [];
  }

  function structureCellSet(structures, exceptId) {
    const set = new Set();
    for (const s of structures) if (s.id !== exceptId) for (const k of cellsAt(s, s.x, s.y)) set.add(k);
    return set;
  }

  // Un oggetto di mappa blocca? Le porte bloccano finché sono chiuse; gli altri solo con "Blocca il movimento".
  function objectBlocks(it) {
    if (it.otype === 'porta') return it.state !== 'aperto';
    return Boolean(it.blocks);
  }

  // Celle che bloccano le pedine: quelle selezionate delle strutture, degli oggetti di mappa che bloccano
  // (porte chiuse comprese) e della TileMap della griglia (tile bloccanti, non navigabili, poligoni di
  // collisione oltre la soglia, celle forzate con lo strumento Blocco). board.tilesets: { id: TileSet }
  // (di base quelli dell'archivio).
  function blockedCells(board) {
    const set = structureCellSet(board.structures || []);
    for (const it of board.items || []) if (objectBlocks(it)) for (const k of cellsAt(it, it.x, it.y)) set.add(k);
    if (board.tileMap) for (const k of DnD.collisioni.blockedSet(board.tileMap, board.tilesets || DnD.tilemap.storeIndex(), STRIDE)) set.add(k);
    return set;
  }

  // Contenuto di una griglia (combattimento, bozza o griglia salvata) come "board" per le collisioni.
  function boardOf(grid, combatants, tilesets) {
    const d = dims(grid);
    return {
      w: d.w, h: d.h, combatants: combatants || [], structures: grid.structures, items: grid.items, tileMap: grid.tileMap || null,
      tilesets, ignoreCollisions: grid.ignoreCollisions,
    };
  }

  // La cella (x, y) blocca il movimento? Strutture, oggetti di mappa (porte chiuse comprese) e TileMap,
  // salvo "Ignora collisioni". Le celle fuori dalla griglia sono sempre bloccate. tilesets facoltativo.
  function isCellBlocked(grid, x, y, tilesets) {
    const d = dims(grid);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return true;
    if (grid.ignoreCollisions) return false;
    return blockedCells(boardOf(grid, [], tilesets)).has(key(x, y));
  }

  // Una pedina non può sovrapporsi ad altre pedine né (salvo "ignora collisioni") a ciò che blocca.
  // Contano tutte le celle del suo ingombro (w × h); le celle non selezionate delle strutture restano libere.
  // dimsOverride facoltativo: ingombro da provare al posto di quello attuale.
  function canPlaceToken(board, id, x, y, dimsOverride) {
    const c = board.combatants.find((t) => t.id === id);
    if (!c) return false;
    const d = dimsOverride || tokenDims(c);
    const shape = rectShape(d.w, d.h);
    if (!inBounds(shape, x, y, board)) return false;
    const mine = cellsAt(shape, x, y);
    const others = new Set();
    for (const t of board.combatants) if (t.id !== id) for (const k of tokenCells(t)) others.add(k);
    if (mine.some((k) => others.has(k))) return false;
    if (board.ignoreCollisions) return true;
    const blocked = blockedCells(board);
    return !mine.some((k) => blocked.has(k));
  }

  // Una struttura non può coprire una pedina (salvo "ignora collisioni"). Le strutture possono toccarsi.
  function canPlaceStructure(board, shape, x, y) {
    if (!inBounds(shape, x, y, board)) return false;
    if (board.ignoreCollisions) return true;
    const tokens = new Set();
    for (const t of board.combatants) for (const k of tokenCells(t)) tokens.add(k);
    return !cellsAt(shape, x, y).some((k) => tokens.has(k));
  }

  // Un oggetto si può posare sopra le pedine, tranne se blocca il movimento.
  function canPlaceItem(board, shape, blocks, x, y) {
    if (!inBounds(shape, x, y, board)) return false;
    return !blocks || canPlaceStructure(board, shape, x, y);
  }

  // ---------- Modelli con tileset: ingombro e trasformazioni ----------
  // Ingombro di un modello: per le strutture la forma (o l'ingombro della tilemap), per gli oggetti
  // l'ingombro della tilemap oppure una cella.
  function templateShape(t, kind) {
    if (t.mode === 'tiles' && t.tiles) return { w: t.tiles.w, h: t.tiles.h, cells: t.tiles.cells };
    if (kind === 'item') return squareShape(1);
    return { w: t.w, h: t.h, cells: t.cells };
  }

  // Matrici 2×2 [m00, m01, m10, m11] degli orientamenti dei tile.
  const neg = (v) => 0 - v;
  // Rotazione oraria di 90° (asse y verso il basso): (x, y) -> (-y, x).
  function rotateMatrix(m) {
    return [neg(m[2]), neg(m[3]), m[0], m[1]];
  }
  // Specchio orizzontale: (x, y) -> (-x, y).
  function mirrorMatrix(m) {
    return [neg(m[0]), neg(m[1]), m[2], m[3]];
  }
  function applyMatrix(m, x, y) {
    return { x: m[0] * x + m[1] * y + 0, y: m[2] * x + m[3] * y + 0 };
  }

  // Campi di un elemento piazzato a partire dal modello: ingombro e copia della tilemap.
  function placedFields(t, kind) {
    const tiles = t.mode === 'tiles' && t.tiles ? JSON.parse(JSON.stringify(t.tiles)) : null;
    return Object.assign({}, templateShape(t, kind), { tiles });
  }

  // Ruota o specchia un elemento piazzato: celle, tilemap e ogni tile insieme.
  function transformPlaced(p, op) {
    if (p.tiles) {
      const tiles = DnD.tilemap.transformTiles(p.tiles, op);
      return { w: tiles.w, h: tiles.h, cells: tiles.cells, tiles };
    }
    return Object.assign({}, op === 'ruota' ? rotateShape(p) : mirrorShape(p), { tiles: null });
  }

  // Cerca la posizione valida più vicina a (x, y), ad anelli crescenti.
  function findFreeSpot(x, y, isValid, area) {
    const d = dims(area);
    for (let r = 0; r < Math.max(d.w, d.h) * 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && isValid(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return null;
  }

  // ---------- Vista: conversione schermo/cella, zoom e pan ----------
  function screenToCell(view, sx, sy) {
    const s = CELL_PX * view.zoom;
    return { x: Math.floor((sx - view.panX) / s), y: Math.floor((sy - view.panY) / s) };
  }

  function cellToScreen(view, x, y) {
    const s = CELL_PX * view.zoom;
    return { sx: view.panX + x * s, sy: view.panY + y * s };
  }

  // Zoom mantenendo fermo il punto dello schermo (sx, sy) sotto il cursore.
  function zoomAt(view, sx, sy, factor) {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    const k = zoom / view.zoom;
    return { zoom, panX: sx - (sx - view.panX) * k, panY: sy - (sy - view.panY) * k };
  }

  // ---------- Distanze (regola 5e: ogni diagonale vale 5 piedi) ----------
  function cellDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  // Distanza tra due pedine misurata tra le loro celle più vicine (due pedine adiacenti distano 1 casella).
  // null se una delle due non è sulla griglia.
  function tokenDistance(a, b) {
    if (!a.pos || !b.pos) return null;
    const da = tokenDims(a);
    const db = tokenDims(b);
    const gap = (a0, aw, b0, bw) => Math.max(0, b0 - (a0 + aw - 1), a0 - (b0 + bw - 1));
    return Math.max(gap(a.pos.x, da.w, b.pos.x, db.w), gap(a.pos.y, da.h, b.pos.y, db.h));
  }

  // feetPerCell: piedi per casella della mappa (5 di base; 5 ft = 1,5 m).
  function formatDistance(cells, feetPerCell) {
    const ft = cells * (feetPerCell || 5);
    return cells + (cells === 1 ? ' casella' : ' caselle') + ' · ' + ft + ' ft · ' + String(Math.round(ft * 0.3 * 100) / 100).replace('.', ',') + ' m';
  }

  // Velocità in metri -> testo con caselle e piedi.
  function formatSpeed(meters) {
    const cells = Math.floor(meters / 1.5 + 1e-9);
    return String(meters).replace('.', ',') + ' m · ' + cells * 5 + ' ft · ' + cells + (cells === 1 ? ' casella' : ' caselle');
  }

  // ---------- Sfondo ----------
  // background: { kind: 'colore' | 'immagine', color, imageId, fit, x, y, scale, opacity, pxPerCell }.
  // Rettangolo (in celle) dove disegnare l'immagine dello sfondo di imgW × imgH pixel su una griglia w × h.
  // "Dimensione originale": un pixel = 1/pxPerCell di cella (di base CELL_PX, la cella a zoom 1).
  function backgroundRect(bg, imgW, imgH, w, h) {
    let r;
    if (bg.fit === 'copri') {
      const k = Math.max(w / imgW, h / imgH);
      r = { x: (w - imgW * k) / 2, y: (h - imgH * k) / 2, w: imgW * k, h: imgH * k };
    } else if (bg.fit === 'originale') {
      const px = bg.pxPerCell > 0 ? bg.pxPerCell : CELL_PX;
      r = { x: 0, y: 0, w: imgW / px, h: imgH / px };
    } else {
      r = { x: 0, y: 0, w, h };
    }
    const scale = bg.scale > 0 ? bg.scale : 1;
    return { x: r.x + (bg.x || 0), y: r.y + (bg.y || 0), w: r.w * scale, h: r.h * scale };
  }

  // Calibrazione da una mappa già quadrettata: pixel per cella -> celle della griglia (arrotondate, 5–100).
  function calibrate(imgW, imgH, pxPerCell) {
    const clamp = (n) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
    const exactW = imgW / pxPerCell;
    const exactH = imgH / pxPerCell;
    return { w: clamp(exactW), h: clamp(exactH), exactW, exactH };
  }

  // ---------- Ridimensionamento della griglia ----------
  // side: { x: 'destra' | 'sinistra', y: 'sotto' | 'sopra' } = da quale lato si aggiungono (o tolgono) le celle.
  // Restituisce { grid (copia), lost: [descrizioni degli elementi tolti o tagliati] }. Gli elementi che escono
  // anche solo in parte dall'area vengono tolti (le zone si tagliano); la TileMap si ritaglia o si allarga.
  function resizeGrid(grid, w, h, side) {
    const g = JSON.parse(JSON.stringify(grid));
    const old = dims(g);
    const dx = side && side.x === 'sinistra' ? w - old.w : 0;
    const dy = side && side.y === 'sopra' ? h - old.h : 0;
    const lost = [];
    const fits = (x, y, ww, hh) => x >= 0 && y >= 0 && x + ww <= w && y + hh <= h;
    const move = (list, what, size) => (list || []).filter((e) => {
      const s = size(e);
      const x = e.x + dx;
      const y = e.y + dy;
      if (!fits(x, y, s.w, s.h)) { lost.push(what + ' «' + (e.name || e.text || '') + '»'); return false; }
      e.x = x;
      e.y = y;
      return true;
    });
    g.structures = move(g.structures, 'Struttura', (e) => e);
    g.items = move(g.items, 'Oggetto', (e) => e);
    g.labels = move(g.labels, 'Etichetta', () => ({ w: 1, h: 1 }));
    g.zones = (g.zones || []).filter((z) => {
      const x0 = Math.max(0, z.x + dx);
      const y0 = Math.max(0, z.y + dy);
      const x1 = Math.min(w, z.x + dx + z.w);
      const y1 = Math.min(h, z.y + dy + z.h);
      if (x1 <= x0 || y1 <= y0) { lost.push(ZONE_KINDS[z.kind] || 'Zona'); return false; }
      if (x1 - x0 !== z.w || y1 - y0 !== z.h) lost.push(ZONE_KINDS[z.kind] + ' (ridotta)');
      Object.assign(z, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      return true;
    });
    if (Array.isArray(g.positions)) g.positions = g.positions.map((p) => Object.assign(p, { x: p.x + dx, y: p.y + dy })).filter((p) => fits(p.x, p.y, 1, 1));
    if (g.tileMap) {
      const n = DnD.tilemap.lostByResize(g.tileMap, w, h, { x: -dx, y: -dy });
      if (n) lost.push(n + (n === 1 ? ' tile della TileMap' : ' tile della TileMap'));
      g.tileMap = DnD.tilemap.reshape(g.tileMap, w, h, { x: -dx, y: -dy });
    }
    if (g.background && g.background.kind === 'immagine') {
      g.background.x = (g.background.x || 0) + dx;
      g.background.y = (g.background.y || 0) + dy;
    }
    // Esplorazione: biomi e nebbia seguono le celle, gli eventi fuori dall'area si tolgono.
    if (DnD.esplorazione && (g.biomeMap || (g.events && g.events.length) || g.fog)) {
      const ex = DnD.esplorazione.resizeExtras(g, old.w, old.h, w, h, dx, dy);
      if (ex.lostEvents) lost.push(ex.lostEvents + (ex.lostEvents === 1 ? ' evento' : ' eventi'));
      Object.assign(g, { biomeMap: ex.biomeMap, fog: ex.fog, events: ex.events });
    }
    g.w = w;
    g.h = h;
    return { grid: g, lost };
  }

  // ---------- Annulla / ripeti ----------
  function createHistory(limit) {
    const past = [];
    let future = [];
    return {
      push(snapshot) {
        past.push(snapshot);
        if (past.length > limit) past.shift();
        future = [];
      },
      undo(current) {
        if (!past.length) return null;
        future.push(current);
        return past.pop();
      },
      redo(current) {
        if (!future.length) return null;
        past.push(current);
        return future.pop();
      },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      clear() { past.length = 0; future = []; },
    };
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));

  // doc: { grid: { structures, items, labels, zones, tileMap }, combatants } — un combattimento o la bozza
  // dell'editor. La TileMap fa parte dell'istantanea: annulla/ripeti coprono anche i tratti di tile.
  function gridSnapshot(doc) {
    return clone({
      structures: doc.grid.structures,
      items: doc.grid.items,
      labels: doc.grid.labels,
      zones: doc.grid.zones,
      tileMap: doc.grid.tileMap || null,
      // Esplorazione: biomi ed eventi piazzati rientrano in Annulla/Ripeti.
      biomeMap: doc.grid.biomeMap || null,
      events: doc.grid.events || [],
      fog: doc.grid.fog || null,
      positions: Object.fromEntries(doc.combatants.map((c) => [c.id, c.pos])),
      tokenDims: Object.fromEntries(doc.combatants.map((c) => [c.id, tokenDims(c)])),
      // Movimento del turno (residuo): annulla/ripeti di uno spostamento restituisce anche il movimento.
      movement: Object.fromEntries(doc.combatants.filter((c) => c.movement).map((c) => [c.id, c.movement])),
    });
  }

  function restoreSnapshot(doc, snap) {
    doc.grid.structures = clone(snap.structures);
    doc.grid.items = clone(snap.items);
    doc.grid.labels = clone(snap.labels);
    doc.grid.zones = clone(snap.zones);
    if (snap.tileMap !== undefined) doc.grid.tileMap = clone(snap.tileMap);
    if (snap.biomeMap !== undefined) doc.grid.biomeMap = clone(snap.biomeMap);
    if (snap.events !== undefined) doc.grid.events = clone(snap.events);
    if (snap.fog) doc.grid.fog = clone(snap.fog);
    for (const c of doc.combatants) {
      c.pos = snap.positions[c.id] ? Object.assign({}, snap.positions[c.id]) : null;
      if (snap.tokenDims && snap.tokenDims[c.id]) Object.assign(c, snap.tokenDims[c.id]);
      if (snap.movement && snap.movement[c.id]) c.movement = clone(snap.movement[c.id]);
    }
  }

  // ---------- Zone di partenza ----------
  const ZONE_KINDS = { giocatori: 'Partenza giocatori', nemici: 'Partenza nemici' };

  // Rettangolo normalizzato tra due celle (in qualsiasi ordine), limitato alla griglia.
  function rectBetween(a, b, area) {
    const d = dims(area);
    const cx = (v) => Math.max(0, Math.min(d.w - 1, v));
    const cy = (v) => Math.max(0, Math.min(d.h - 1, v));
    const x0 = cx(Math.min(a.x, b.x));
    const y0 = cy(Math.min(a.y, b.y));
    return { x: x0, y: y0, w: cx(Math.max(a.x, b.x)) - x0 + 1, h: cy(Math.max(a.y, b.y)) - y0 + 1 };
  }

  // Dispone i combattenti senza posizione nelle celle libere della loro zona
  // (giocatori -> "Partenza giocatori", nemici -> "Partenza nemici"), con tutto il loro ingombro.
  // Restituisce i combattenti che non hanno trovato posto (restano fuori dalla griglia).
  function placeInZones(combat) {
    const board = boardOf(combat.grid, combat.combatants);
    const unplaced = [];
    for (const c of combat.combatants) {
      if (c.pos) continue;
      const kind = c.kind === 'player' ? 'giocatori' : 'nemici';
      const zones = combat.grid.zones.filter((zz) => zz.kind === kind);
      const d = tokenDims(c);
      search: for (const z of zones) {
        for (let y = z.y; y + d.h <= z.y + z.h; y++) {
          for (let x = z.x; x + d.w <= z.x + z.w; x++) {
            if (canPlaceToken(board, c.id, x, y)) { c.pos = { x, y }; break search; }
          }
        }
      }
      if (!c.pos && zones.length) unplaced.push(c);
    }
    return unplaced;
  }

  // ---------- Griglie salvate ----------
  // I combattenti si riconoscono tra combattimenti diversi da modello d'origine + nome (es. "Goblin 2").
  function combatantKey(c) {
    return c.sourceId + '|' + c.name;
  }

  // Proprietà della griglia copiate insieme al contenuto: dimensione, piedi per cella e sfondo.
  function gridProps(g) {
    const d = dims(g);
    return { w: d.w, h: d.h, feetPerCell: g.feetPerCell || 5, background: clone(g.background || null), kind: g.kind || 'battaglia', scale: clone(g.scale || { value: 1.5, unit: 'km' }) };
  }

  function createSavedGrid(combat, name, id, updatedAt) {
    return Object.assign({
      id,
      name,
      updatedAt,
      structures: clone(combat.grid.structures),
      items: clone(combat.grid.items),
      labels: clone(combat.grid.labels),
      zones: clone(combat.grid.zones),
      tileMap: clone(combat.grid.tileMap || null),
      positions: combat.combatants.filter((c) => c.pos).map((c) => ({ key: combatantKey(c), x: c.pos.x, y: c.pos.y })),
    }, gridProps(combat.grid));
  }

  // Applica una griglia salvata al combattimento. I combattenti della griglia assenti nel combattimento
  // vengono ignorati; quelli del combattimento senza posizione salvata restano fuori dalla griglia.
  // Il combattimento lavora su una COPIA (sfondo compreso): modificarlo non cambia la griglia salvata.
  // Dopo le posizioni salvate, chi è ancora senza posto viene disposto nelle zone di partenza.
  // Restituisce i combattenti che non sono entrati nelle zone di partenza.
  function applySavedGrid(combat, saved, newId) {
    const copy = (list) => list.map((x) => Object.assign(clone(x), { id: newId() }));
    combat.grid.structures = copy(saved.structures);
    combat.grid.items = copy(saved.items);
    combat.grid.labels = copy(saved.labels);
    combat.grid.zones = copy(saved.zones);
    combat.grid.tileMap = clone(saved.tileMap || null);
    Object.assign(combat.grid, gridProps(saved));
    combat.grid.sourceGridId = saved.id;
    for (const c of combat.combatants) c.pos = null;
    const board = boardOf(combat.grid, combat.combatants);
    for (const p of saved.positions) {
      const c = combat.combatants.find((x) => !x.pos && combatantKey(x) === p.key);
      if (c && canPlaceToken(board, c.id, p.x, p.y)) c.pos = { x: p.x, y: p.y };
    }
    return placeInZones(combat);
  }

  DnD.griglia = {
    blockedCells, boardOf, isCellBlocked, objectBlocks, canPlaceItem, templateShape, rotateMatrix, mirrorMatrix, applyMatrix, placedFields, transformPlaced,
    SIZE, DEFAULT_SIZE, MIN_SIZE, MAX_SIZE, STRIDE, CELL_PX, MIN_ZOOM, MAX_ZOOM, MAX_TOKEN, PRESETS, PRESET_NAMES, TOKEN_SIZES, TOKEN_PRESETS,
    BG_FITS, BG_FIT_NAMES,
    dims, key, keyX, keyY, colLabel, cellLabel, shapeFrom, isFilled, presetShape, rotateShape, mirrorShape, resizeShape, squareShape, rectShape,
    tokenSize, gridSizeFor, tokenDims, tokenShape, tokenCovers, tokenCells, cellsAt, inBounds, canPlaceToken, canPlaceStructure, findFreeSpot,
    screenToCell, cellToScreen, zoomAt, cellDistance, tokenDistance, formatDistance, formatSpeed,
    backgroundRect, calibrate, resizeGrid,
    createHistory, gridSnapshot, restoreSnapshot, combatantKey, gridProps, createSavedGrid, applySavedGrid,
    ZONE_KINDS, rectBetween, placeInZones,
  };
})(globalThis.DnD = globalThis.DnD || {});
