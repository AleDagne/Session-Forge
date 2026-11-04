// Pannello «Tile» sotto la griglia dell'Editor griglie (richiudibile e ridimensionabile): elenco dei TileSet
// (importa, rinomina, elimina con avviso se in uso), componente di taglio (X e Y) usato come palette (un tile
// o un rettangolo di tile = timbro), strumenti, rotazione e specchio del timbro e livelli della TileMap.
// Si dipinge direttamente sulla griglia principale (vedi ui-griglia.js, opts.painter): ogni tile occupa una
// cella ed è scalata alla cella. Il pennello non ridisegna la stessa cella finché il puntatore non cambia
// cella; annulla/ripeti (50 azioni) sono quelli della griglia. Funziona con mouse e touch (pointer events).
(function (DnD) {
  'use strict';

  const { el, clear, toast, promptText, numberInput } = DnD.ui;
  const G = DnD.griglia;
  const T = DnD.tileset;
  const TM = DnD.tilemap;
  const COL = DnD.collisioni;
  const UT = DnD.uiTileset;
  const HEIGHT_KEY = 'dnd-battaglie:altezza-pannello-tile';
  const TOOLS = {
    pennello: ['🖌 Pennello', 'B'], gomma: ['🧽 Gomma', 'E'], riempi: ['🪣 Riempi', 'G'], rettangolo: ['▭ Rettangolo', 'U'],
    contagocce: ['💧 Contagocce', 'I'], selezione: ['⬚ Seleziona/sposta', 'M'], blocco: ['⛔ Blocco', 'K'],
  };
  const HINTS = {
    pennello: 'Pennello: clic o trascina sulla griglia per dipingere il tile (o il timbro) scelto nella palette.',
    gomma: 'Gomma: clic o trascina per cancellare le tile del livello attivo.',
    riempi: 'Riempi: clic per riempire l\'area contigua uguale del livello attivo.',
    rettangolo: 'Rettangolo: trascina per riempire un rettangolo con il timbro (Maiusc = svuota).',
    contagocce: 'Contagocce: clic su una tile della griglia per sceglierla (con il suo orientamento).',
    selezione: 'Seleziona: trascina per selezionare; trascina dentro la selezione per spostarla. Ctrl+C, Ctrl+X, Ctrl+V, Canc.',
    blocco: 'Blocco: clic su una cella per forzarla bloccata → libera → normale.',
  };

  // Celle sulla linea tra a e b (Bresenham): il pennello non lascia buchi anche con movimenti veloci.
  function lineCells(a, b) {
    const out = [];
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - a.x);
    const dy = -Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push({ x, y });
      if (x === b.x && y === b.y) return out;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  // Pannello Tile: strumenti sulla griglia (pennello, gomma, riempi, rettangolo, contagocce, selezione, blocco) e
  // operazioni sulla selezione (copia, taglia, incolla, svuota, trasforma).
  function strumentiTile(S, api) {
    const { ensureMap, editable, edit, map, grid, widget, byId, stamp, spanFor, setTool, updateUi, updateBrush, renderLayers } = api;
    const inMap = (c) => c && grid() && c.x >= 0 && c.y >= 0 && c.x < G.dims(grid()).w && c.y < G.dims(grid()).h;
    const clampCell = (c) => { const d = G.dims(grid()); return { x: Math.max(0, Math.min(d.w - 1, c.x)), y: Math.max(0, Math.min(d.h - 1, c.y)) }; };
    const inSel = (c) => S.selRect && c.x >= S.selRect.x && c.y >= S.selRect.y && c.x < S.selRect.x + S.selRect.w && c.y < S.selRect.y + S.selRect.h;

    function paintCell(cell) {
      const m = ensureMap();
      const changed = S.tool === 'gomma' ? TM.eraseAt(m, S.layer, cell.x, cell.y, byId()) : TM.paintStamp(m, S.layer, cell.x, cell.y, stamp());
      if (changed) widget().requestDraw();
    }
    function setOverride(cell, value) {
      const m = ensureMap();
      const i = cell.y * m.w + cell.x;
      if (m.overrides[i] === value) return;
      m.overrides = m.overrides.slice(0, i) + value + m.overrides.slice(i + 1);
      widget().requestDraw();
    }
    function pickTile(cell) {
      const m = map();
      const b = byId();
      if (!m) { toast('Nessuna tile in questa cella.'); return; }
      const order = [S.layer].concat(m.layers.map((_, i) => m.layers.length - 1 - i).filter((i) => i !== S.layer && m.layers[i].visible));
      for (const li of order) {
        const a = TM.anchorAt(m, li, cell.x, cell.y, b);
        if (!a) continue;
        const tsId = m.tilesets[a.cell[0]];
        if (!b[tsId] || !T.resolveTile(b[tsId], a.cell[1])) { toast('La tile di questa cella non esiste più (segnaposto).', 'error'); return; }
        api.cutter().pickTile(tsId, a.cell[1]);
        S.base = TM.makeStamp(tsId, [a.cell[1]], 1, 1, spanFor(tsId, a.cell[1], 0));
        S.base.cells[0][2] = a.cell[2];
        S.ops = [];
        if (li !== S.layer) S.layer = li;
        setTool('pennello');
        renderLayers();
        updateBrush();
        return;
      }
      toast('Nessuna tile in questa cella.');
    }

    function down(cell, e) {
      if (!inMap(cell) && S.tool !== 'selezione' && S.tool !== 'rettangolo') return;
      const c = inMap(cell) ? cell : clampCell(cell);
      if (S.pasting && S.clipboard) {
        S.pasting = false;
        if (editable()) edit(() => TM.pasteRegion(map(), S.layer, c.x, c.y, S.clipboard));
        updateUi();
        return;
      }
      if (S.tool === 'contagocce') { pickTile(c); return; }
      if (S.tool === 'riempi') {
        if (!stamp()) { toast('Scegli prima un tile nella palette.', 'error'); return; }
        if (editable()) edit(() => TM.bucketFill(map(), S.layer, c.x, c.y, stamp(), true));
        return;
      }
      if (S.tool === 'rettangolo' || (S.tool === 'selezione' && !inSel(c))) { S.drag = { type: 'rect', a: c, b: c, erase: e && e.shiftKey }; widget().requestDraw(); return; }
      if (S.tool === 'selezione') {
        if (!editable()) return;
        S.drag = { type: 'move', a: c, dx: 0, dy: 0, rect: S.selRect, region: TM.copyRegion(ensureMap(), S.layer, S.selRect) };
        return;
      }
      if (S.tool === 'blocco') {
        const m = ensureMap();
        const value = { '-': 'b', b: 'l', l: '-' }[m.overrides[c.y * m.w + c.x]];
        S.drag = { type: 'block', value, before: widget().tileSnapshot(), was: m.overrides, last: c };
        setOverride(c, value);
        return;
      }
      if (S.tool === 'pennello' || S.tool === 'gomma') {
        if (S.tool === 'pennello' && !stamp()) { toast('Scegli prima un tile nella palette.', 'error'); return; }
        if (!editable()) return;
        S.drag = { type: 'paint', before: widget().tileSnapshot(), was: JSON.stringify(map().layers[S.layer].data), last: c };
        paintCell(c);
      }
    }
    function move(cell, e, dragging) {
      const prev = S.hover;
      S.hover = inMap(cell) ? cell : null;
      if (!S.drag) {
        if (!prev !== !S.hover || (S.hover && (S.hover.x !== prev.x || S.hover.y !== prev.y))) widget().requestDraw();
        return;
      }
      if (!cell) return;
      const c = clampCell(cell);
      if (S.drag.type === 'rect') { if (c.x !== S.drag.b.x || c.y !== S.drag.b.y) { S.drag.b = c; widget().requestDraw(); } return; }
      if (S.drag.type === 'move') { S.drag.dx = c.x - S.drag.a.x; S.drag.dy = c.y - S.drag.a.y; widget().requestDraw(); return; }
      // Pennello, gomma e blocco: niente ridisegni finché il puntatore resta nella stessa cella.
      if (!inMap(cell) || (cell.x === S.drag.last.x && cell.y === S.drag.last.y)) return;
      for (const q of lineCells(S.drag.last, cell).slice(1)) {
        if (S.drag.type === 'block') setOverride(q, S.drag.value);
        else paintCell(q);
      }
      S.drag.last = cell;
    }
    function up(cell, e) {
      const d = S.drag;
      S.drag = null;
      if (!d) return;
      if (d.type === 'paint') {
        if (JSON.stringify(map().layers[S.layer].data) !== d.was) { widget().commitTiles(d.before); renderLayers(); }
      } else if (d.type === 'block') {
        if (map().overrides !== d.was) widget().commitTiles(d.before);
      } else if (d.type === 'rect') {
        const r = G.rectBetween(d.a, d.b, grid());
        if (S.tool === 'selezione') { S.selRect = r; updateUi(); widget().requestDraw(); return; }
        if (!editable()) { widget().requestDraw(); return; }
        const erase = d.erase || (e && e.shiftKey);
        if (!erase && !stamp()) { toast('Scegli prima un tile nella palette.', 'error'); widget().requestDraw(); return; }
        edit(() => TM.fillRect(map(), S.layer, r, erase ? null : stamp()));
      } else if (d.type === 'move') {
        if (!d.dx && !d.dy) { widget().requestDraw(); return; }
        edit(() => {
          TM.clearRegion(map(), S.layer, d.rect);
          TM.pasteRegion(map(), S.layer, d.rect.x + d.dx, d.rect.y + d.dy, d.region);
        });
        S.selRect = Object.assign({}, d.rect, { x: d.rect.x + d.dx, y: d.rect.y + d.dy });
        widget().requestDraw();
      }
    }

    // ---------- Selezione: copia, taglia, incolla, svuota, trasforma ----------
    function copy(cut) {
      if (!S.selRect) { toast('Seleziona prima un\'area con lo strumento Seleziona.', 'error'); return; }
      S.clipboard = TM.copyRegion(ensureMap(), S.layer, S.selRect);
      if (cut) { if (editable()) edit(() => TM.clearRegion(map(), S.layer, S.selRect)); } else toast('Copiate ' + S.selRect.w + '×' + S.selRect.h + ' celle del livello «' + map().layers[S.layer].name + '».');
    }
    function paste() {
      if (!S.clipboard) { toast('Niente da incollare: copia prima una selezione.', 'error'); return; }
      S.pasting = true;
      if (S.tool !== 'selezione') setTool('selezione');
      toast('Clicca sulla griglia dove incollare (angolo in alto a sinistra).');
    }
    function clearSelection() {
      if (S.selRect && editable()) edit(() => TM.clearRegion(map(), S.layer, S.selRect));
    }
    function transformSelection(op) {
      if (!S.selRect || !editable()) return;
      const region = TM.transformRegion(TM.copyRegion(map(), S.layer, S.selRect), op);
      edit(() => {
        TM.clearRegion(map(), S.layer, S.selRect);
        TM.pasteRegion(map(), S.layer, S.selRect.x, S.selRect.y, region);
      });
      const d = G.dims(grid());
      S.selRect = Object.assign({}, S.selRect, { w: Math.min(region.w, d.w - S.selRect.x), h: Math.min(region.h, d.h - S.selRect.y) });
    }

    return { paintCell, setOverride, pickTile, down, move, up, copy, paste, clearSelection, transformSelection, inMap, clampCell, inSel };
  }

  // opts: { getGrid() -> contenuto della griglia (bozza) | null, widget() -> componente griglia }
  function create(opts) {
    const S = {
      tool: null, // null = strumenti della griglia
      layer: 0,
      base: null, // timbro scelto nella palette (orientamento 0)
      ops: [], // rotazioni e specchi del timbro
      hover: null,
      drag: null,
      selRect: null,
      clipboard: null,
      pasting: false,
      showBlocked: false,
      height: 360,
    };
    const byId = () => TM.tilesetIndex(DnD.store.state.tilesets);
    const grid = () => opts.getGrid();
    const widget = () => opts.widget();
    const map = () => grid() && grid().tileMap;

    // La TileMap della griglia: creata al primo tratto, sempre grande quanto la griglia.
    function ensureMap() {
      const g = grid();
      if (!g.tileMap) {
        const d = G.dims(g);
        g.tileMap = TM.newGridMap(d.w, d.h);
        g.tileMap.feetPerCell = g.feetPerCell || 5;
      }
      S.layer = Math.max(0, Math.min(g.tileMap.layers.length - 1, S.layer));
      return g.tileMap;
    }
    const editable = () => {
      const l = ensureMap().layers[S.layer];
      if (l.locked) { toast('Il livello «' + l.name + '» è bloccato: sbloccalo per modificarlo.', 'error'); return false; }
      return true;
    };
    // Modifica annullabile: fn() modifica la TileMap (restituisce false se non cambia nulla).
    function edit(fn) {
      const before = widget().tileSnapshot();
      const was = JSON.stringify(map() || null);
      ensureMap();
      if (fn() === false || JSON.stringify(map()) === was) { widget().requestDraw(); return; }
      widget().commitTiles(before);
      renderLayers();
    }

    // ---------- Timbro ----------
    const spanFor = (tsId, tileId, o) => { const m = map(); return TM.spanOf({ tilesets: [tsId], cellW: m ? m.cellW : 0, cellH: m ? m.cellH : 0 }, byId(), [0, tileId, o]); };
    function fromPalette(st) {
      if (!st.stamp) { S.base = null; return; }
      const first = st.stamp.ids.find((x) => x !== null);
      S.base = TM.makeStamp(st.stamp.tilesetId, st.stamp.ids, st.stamp.w, st.stamp.h, spanFor(st.stamp.tilesetId, first, 0));
      S.ops = [];
      if (!['pennello', 'rettangolo', 'riempi'].includes(S.tool)) setTool('pennello');
      updateBrush();
    }
    function stamp() {
      if (!S.base) return null;
      const s = S.ops.reduce((acc, op) => TM.transformRegion(acc, op), S.base);
      const b = byId();
      // Trasformazioni non ammesse dalla tile: si dipinge con l'orientamento originale.
      return Object.assign({}, s, { cells: s.cells.map((c) => (c && !T.orientAllowed(T.tileProps(b[c[0]], c[1]), c[2]) ? [c[0], c[1], 0] : c)) });
    }
    function transform(op) {
      if (S.selRect && S.tool === 'selezione') { transformSelection(op); return; }
      if (!S.base) { toast('Scegli prima un tile nella palette.', 'error'); return; }
      S.ops.push(op);
      updateBrush();
      widget().requestDraw();
    }

    // ---------- Strumenti e selezione (fuori da create: strumentiTile) ----------
    const { paintCell, setOverride, pickTile, down, move, up, copy, paste, clearSelection, transformSelection, inMap, clampCell, inSel } = strumentiTile(S, { ensureMap, editable, edit, map, grid, widget, byId, stamp, spanFor, setTool, updateUi, updateBrush, renderLayers, cutter: () => cutter });

    // ---------- Disegno sulla griglia ----------
    function drawRegion(ctx, view, region, x0, y0, s, alpha) {
      const b = byId();
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let j = 0; j < region.h; j++) {
        for (let i = 0; i < region.w; i++) {
          const c = region.cells[j * region.w + i];
          if (!c) continue;
          const ts = b[c[0]];
          const r = ts && T.resolveTile(ts, c[1]);
          const res = r ? UT.sourceImage(r.src, widget().requestDraw) : { state: 'missing' };
          const span = spanFor(c[0], c[1], c[2]);
          const x = view.panX + (x0 + i * (region.stepX || 1)) * s;
          const y = view.panY + (y0 + j * (region.stepY || 1)) * s;
          if (res.state === 'ok') UT.drawTile(ctx, r, res.img, c[2], x, y, span.w * s, span.h * s);
          else if (res.state === 'missing') { ctx.fillStyle = UT.colors().missing; ctx.fillRect(x, y, span.w * s, span.h * s); }
        }
      }
      ctx.restore();
    }
    function outlineRect(ctx, view, r, s, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(view.panX + r.x * s + 1, view.panY + r.y * s + 1, r.w * s - 2, r.h * s - 2);
      ctx.restore();
    }
    function draw(ctx, view, s) {
      const c = UT.colors();
      const m = map();
      if (m && (S.showBlocked || S.tool === 'blocco')) {
        ctx.save();
        ctx.fillStyle = c.blocking;
        for (const k of COL.blockedSet(m, byId(), G.STRIDE)) ctx.fillRect(view.panX + G.keyX(k) * s, view.panY + G.keyY(k) * s, s, s);
        ctx.font = 'bold ' + Math.max(9, s * 0.35) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < m.overrides.length; i++) {
          if (m.overrides[i] === '-') continue;
          ctx.fillStyle = m.overrides[i] === 'b' ? c.blocking : c.free;
          ctx.fillText(m.overrides[i] === 'b' ? 'B' : 'L', view.panX + ((i % m.w) + 0.5) * s, view.panY + (Math.floor(i / m.w) + 0.5) * s);
        }
        ctx.restore();
      }
      if (!S.tool) return;
      const ghost = S.pasting && S.clipboard ? Object.assign({ stepX: 1, stepY: 1 }, S.clipboard) : (S.tool === 'pennello' || S.tool === 'riempi') ? stamp() : null;
      if (ghost && S.hover && !S.drag) drawRegion(ctx, view, ghost, S.hover.x, S.hover.y, s, 0.6);
      if (S.drag && S.drag.type === 'move' && S.drag.region) drawRegion(ctx, view, Object.assign({ stepX: 1, stepY: 1 }, S.drag.region), S.drag.rect.x + S.drag.dx, S.drag.rect.y + S.drag.dy, s, 0.85);
      if ((S.tool === 'gomma' || S.tool === 'contagocce' || S.tool === 'blocco') && S.hover && !S.drag) outlineRect(ctx, view, { x: S.hover.x, y: S.hover.y, w: 1, h: 1 }, s, c.selection);
      if (S.drag && S.drag.type === 'rect') outlineRect(ctx, view, G.rectBetween(S.drag.a, S.drag.b, grid()), s, c.selection);
      if (S.selRect && S.tool === 'selezione') {
        outlineRect(ctx, view, S.drag && S.drag.type === 'move' ? Object.assign({}, S.selRect, { x: S.selRect.x + S.drag.dx, y: S.selRect.y + S.drag.dy }) : S.selRect, s, c.accent);
      }
    }
    function hint() {
      const m = map();
      const l = m && m.layers[S.layer];
      const at = S.hover ? G.cellLabel(S.hover.x, S.hover.y) + (m ? ' · costo ' + COL.cellInfo(m, byId(), S.hover.x, S.hover.y).cost + (COL.cellInfo(m, byId(), S.hover.x, S.hover.y).blocked ? ' · bloccata' : '') : '') + ' · ' : '';
      return '🧩 ' + at + (S.pasting ? 'Clicca dove incollare.' : HINTS[S.tool]) + (l ? ' Livello: ' + l.name + (l.locked ? ' (bloccato)' : '') + '.' : '');
    }

    // ---------- DOM ----------
    const toolBtns = {};
    const toolBar = el('div', { class: 'tool-group', role: 'toolbar', 'aria-label': 'Strumenti delle tile' },
      el('button', { type: 'button', class: 'btn small tool', text: '🖐 Griglia', title: 'Torna agli strumenti della griglia (Esc)', onclick: () => setTool(null) }),
      Object.entries(TOOLS).map(([k, [label, key]]) => {
        toolBtns[k] = el('button', { type: 'button', class: 'btn small tool', text: label, title: label.slice(2) + ' (' + key + ')', 'aria-pressed': 'false', onclick: () => setTool(S.tool === k ? null : k) });
        return toolBtns[k];
      }));
    const b = (text, title, onclick) => el('button', { type: 'button', class: 'btn small', text, title, 'aria-label': title, onclick });
    const transformBar = el('div', { class: 'tool-group' },
      el('span', { class: 'muted small', text: 'Timbro:' }),
      b('⟲', 'Ruota a sinistra (Maiusc+R)', () => transform('ruota-sx')), b('⟳', 'Ruota a destra (R)', () => transform('ruota')),
      b('⇋', 'Specchia orizzontale (F)', () => transform('specchia')), b('⇵', 'Specchia verticale (Maiusc+F)', () => transform('specchia-v')));
    const selBar = el('div', { class: 'tool-group' },
      el('span', { class: 'muted small', text: 'Selezione:' }),
      b('Copia', 'Copia (Ctrl+C)', () => copy(false)), b('Taglia', 'Taglia (Ctrl+X)', () => copy(true)), b('Incolla', 'Incolla (Ctrl+V)', paste), b('Svuota', 'Svuota (Canc)', clearSelection),
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', onchange: (e) => { S.showBlocked = e.target.checked; widget().requestDraw(); } }), ' Mostra celle bloccate'));
    const brushInfo = el('div', { class: 'muted small tile-brush' });
    const layersBox = el('div', { class: 'tile-layers' });
    const tsActions = el('div', { class: 'tool-group' },
      b('✎ Rinomina TileSet', 'Rinomina il TileSet', () => renameTileset()),
      b('🗑 Elimina TileSet', 'Elimina il TileSet', () => deleteTileset()));

    const cutter = DnD.uiTile.cutter({ mode: 'palette', onChange: fromPalette, height: 220 });
    const body = el('div', { class: 'tile-panel-body' },
      el('div', { class: 'tile-panel-main' }, el('div', { class: 'tile-panel-tools' }, toolBar, transformBar, selBar, brushInfo), cutter.node, tsActions),
      el('div', { class: 'tile-panel-side' }, el('h4', { text: 'Livelli' }), layersBox));
    const toggleBtn = el('button', { type: 'button', class: 'btn small', 'aria-expanded': 'true' });
    const resizer = el('div', { class: 'tile-panel-resizer', role: 'separator', tabindex: 0, 'aria-orientation': 'horizontal', 'aria-label': 'Ridimensiona il pannello Tile' });
    const node = el('section', { class: 'tile-panel', 'aria-label': 'Pannello Tile' },
      resizer,
      el('div', { class: 'tile-panel-head' }, el('div', { class: 'tabs small-tabs', role: 'tablist' }, el('button', { type: 'button', role: 'tab', class: 'tab active', 'aria-selected': 'true', text: '🧩 Tile' })), toggleBtn),
      body);
    try { S.height = Number(localStorage.getItem(HEIGHT_KEY)) || S.height; } catch (e) { /* preferenza non essenziale */ }
    const setHeight = (h) => { S.height = Math.round(Math.max(160, Math.min(900, h))); body.style.height = S.height + 'px'; };
    const storeHeight = () => { try { localStorage.setItem(HEIGHT_KEY, String(S.height)); } catch (e) { /* ignora */ } };
    setHeight(S.height);
    resizer.addEventListener('pointerdown', (e) => {
      resizer.setPointerCapture(e.pointerId);
      const y0 = e.clientY;
      const h0 = S.height;
      const mv = (ev) => setHeight(h0 - (ev.clientY - y0));
      const end = () => { resizer.removeEventListener('pointermove', mv); resizer.removeEventListener('pointerup', end); storeHeight(); };
      resizer.addEventListener('pointermove', mv);
      resizer.addEventListener('pointerup', end);
    });
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      setHeight(S.height + (e.key === 'ArrowUp' ? 20 : -20));
      storeHeight();
    });
    const collapse = DnD.ui.persistentToggle('dnd-battaglie:pannello-tile', (collapsed) => {
      body.hidden = collapsed;
      resizer.hidden = collapsed;
      toggleBtn.textContent = collapsed ? '▲ Apri' : '▼ Chiudi';
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      if (collapsed && S.tool) setTool(null);
    });
    toggleBtn.addEventListener('click', () => collapse.toggle());

    function setTool(k) {
      S.tool = k;
      if (k !== 'selezione') S.pasting = false;
      // Uno strumento delle tile riporta la griglia su «Seleziona» (niente anteprime di inserimento).
      if (k && widget()) widget().setTool('seleziona');
      for (const [id, btn] of Object.entries(toolBtns)) { btn.classList.toggle('active', id === k); btn.setAttribute('aria-pressed', String(id === k)); }
      if (k && collapse.collapsed()) collapse.toggle(false);
      updateUi();
    }
    function updateBrush() {
      if (!S.base) { brushInfo.textContent = 'Nessun tile scelto: clicca un tile (o trascina un rettangolo) nella palette.'; return; }
      const st = stamp();
      brushInfo.textContent = 'Timbro ' + st.w + '×' + st.h + (S.ops.length ? ' · trasformato (' + S.ops.length + ')' : '');
    }
    function updateUi() {
      updateBrush();
      if (widget()) { widget().updateUi(); widget().requestDraw(); }
    }

    // ---------- Livelli ----------
    function layerEdit(fn) { edit(() => { fn(ensureMap()); return undefined; }); }
    function renderLayers() {
      const m = map();
      clear(layersBox);
      if (!m) {
        layersBox.append(el('p', { class: 'muted small', text: 'La TileMap si crea al primo tratto di pennello.' }),
          b('+ Crea livelli', 'Crea la TileMap con i livelli Base e Sopra', () => layerEdit(() => {})));
        return;
      }
      S.layer = Math.max(0, Math.min(m.layers.length - 1, S.layer));
      const rows = m.layers.map((l, i) => i).reverse().map((i) => {
        const l = m.layers[i];
        const opacity = el('input', { type: 'range', min: 0, max: 100, value: String(Math.round(l.opacity * 100)), 'aria-label': 'Opacità di ' + l.name,
          onchange: (e) => layerEdit((mm) => { mm.layers[i].opacity = Number(e.target.value) / 100; }) });
        const where = el('select', { 'aria-label': 'Posizione di ' + l.name, onchange: (e) => layerEdit((mm) => { mm.layers[i].above = e.target.value === 'sopra'; }) },
          el('option', { value: 'sotto', text: 'Sotto le pedine', selected: !l.above }), el('option', { value: 'sopra', text: 'Sopra le pedine', selected: l.above }));
        return el('div', { class: 'tile-layer' + (i === S.layer ? ' active' : '') },
          el('div', { class: 'tile-layer-head' },
            b(l.visible ? '👁' : '◌', l.visible ? 'Nascondi' : 'Mostra', () => layerEdit((mm) => { mm.layers[i].visible = !mm.layers[i].visible; })),
            b(l.locked ? '🔒' : '🔓', l.locked ? 'Sblocca le modifiche' : 'Blocca le modifiche', () => layerEdit((mm) => { mm.layers[i].locked = !mm.layers[i].locked; })),
            el('button', { type: 'button', class: 'tile-layer-name', text: l.name, 'aria-pressed': String(i === S.layer), onclick: () => { S.layer = i; renderLayers(); updateUi(); } }),
            b('✎', 'Rinomina', () => promptText('Rinomina livello', 'Nome', l.name, (name) => { layerEdit((mm) => { mm.layers[i].name = name.slice(0, 40); }); return null; })),
            b('↑', 'Sposta su', () => { layerEdit((mm) => { S.layer = TM.moveLayer(mm, i, 1); }); }),
            b('↓', 'Sposta giù', () => { layerEdit((mm) => { S.layer = TM.moveLayer(mm, i, -1); }); }),
            b('⧉', 'Duplica', () => { layerEdit((mm) => { S.layer = TM.duplicateLayer(mm, i); }); }),
            b('🗑', 'Elimina', () => {
              if (m.layers.length <= 1) { toast('Deve restare almeno un livello.', 'error'); return; }
              if (l.data.some(Boolean) && !confirm('Eliminare il livello «' + l.name + '» con le sue tile?')) return;
              layerEdit((mm) => { S.layer = TM.removeLayer(mm, i); });
            })),
          el('div', { class: 'tile-layer-props' }, el('label', { class: 'inline small' }, 'Opacità', opacity), where,
            l.above ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: l.fade, onchange: (e) => layerEdit((mm) => { mm.layers[i].fade = e.target.checked; }) }), ' Semitrasparente con una pedina sotto') : null));
      });
      layersBox.append(...rows, b('+ Nuovo livello', 'Aggiungi un livello', () => {
        promptText('Nuovo livello', 'Nome del livello', 'Livello ' + (m.layers.length + 1), (name) => {
          if (m.layers.length >= TM.MAX_LAYERS) return 'Al massimo ' + TM.MAX_LAYERS + ' livelli.';
          layerEdit((mm) => { S.layer = TM.addLayer(mm, name.slice(0, 40)); });
          return null;
        });
      }));
    }

    // ---------- TileSet: rinomina ed elimina ----------
    const currentTs = () => DnD.store.state.tilesets.find((t) => t.id === cutter.state().tilesetId) || null;
    function renameTileset() {
      const ts = currentTs();
      if (!ts) return;
      promptText('Rinomina TileSet', 'Nome', ts.name, (name) => {
        UT.saveTileset(Object.assign(JSON.parse(JSON.stringify(ts)), { name })).then(() => cutter.refresh());
        return null;
      });
    }
    function deleteTileset() {
      const ts = currentTs();
      if (!ts || !UT.confirmUse('il TileSet «' + ts.name + '»', TM.usage(DnD.store.state, ts.id))) return;
      DnD.store.update((st) => { st.tilesets = st.tilesets.filter((t) => t.id !== ts.id); }).then(() => { cutter.refresh(); widget().requestDraw(); });
    }

    // ---------- Tastiera ----------
    document.addEventListener('keydown', (e) => {
      if (!node.isConnected || document.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl && !e.altKey) {
        const found = Object.entries(TOOLS).find(([, v]) => v[1].toLowerCase() === k);
        if (found) { e.preventDefault(); setTool(found[0]); return; }
        if (!S.tool) return;
        if (k === 'r') { e.preventDefault(); transform(e.shiftKey ? 'ruota-sx' : 'ruota'); return; }
        if (k === 'f') { e.preventDefault(); transform(e.shiftKey ? 'specchia-v' : 'specchia'); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (S.pasting) S.pasting = false; else setTool(null); updateUi(); return; }
        if (e.key === 'Delete' && S.selRect && S.tool === 'selezione') { e.preventDefault(); e.stopImmediatePropagation(); clearSelection(); }
        return;
      }
      if (ctrl && S.tool === 'selezione' && ['c', 'x', 'v'].includes(k)) {
        e.preventDefault();
        if (k === 'v') paste(); else copy(k === 'x');
      }
    }, true);

    function refresh() {
      cutter.refresh();
      renderLayers();
      updateBrush();
    }

    return {
      node, refresh,
      painter: { active: () => Boolean(S.tool), deactivate: () => setTool(null), down, move, up, draw, hint },
      reset: () => { setTool(null); S.selRect = null; S.clipboard = null; },
    };
  }

  DnD.uiPannelloTile = { create, lineCells };
})(globalThis.DnD = globalThis.DnD || {});
