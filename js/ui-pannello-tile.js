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

  // opts: { getGrid() -> contenuto della griglia (bozza) | null, widget() -> componente griglia }
  function create(opts) {
    let tool = null;          // null = strumenti della griglia
    let layer = 0;
    let base = null;          // timbro scelto nella palette (orientamento 0)
    let ops = [];             // rotazioni e specchi del timbro
    let hover = null;
    let drag = null;
    let selRect = null;
    let clipboard = null;
    let pasting = false;
    let showBlocked = false;
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
      layer = Math.max(0, Math.min(g.tileMap.layers.length - 1, layer));
      return g.tileMap;
    }
    const editable = () => {
      const l = ensureMap().layers[layer];
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
      if (!st.stamp) { base = null; return; }
      const first = st.stamp.ids.find((x) => x !== null);
      base = TM.makeStamp(st.stamp.tilesetId, st.stamp.ids, st.stamp.w, st.stamp.h, spanFor(st.stamp.tilesetId, first, 0));
      ops = [];
      if (!['pennello', 'rettangolo', 'riempi'].includes(tool)) setTool('pennello');
      updateBrush();
    }
    function stamp() {
      if (!base) return null;
      const s = ops.reduce((acc, op) => TM.transformRegion(acc, op), base);
      const b = byId();
      // Trasformazioni non ammesse dalla tile: si dipinge con l'orientamento originale.
      return Object.assign({}, s, { cells: s.cells.map((c) => (c && !T.orientAllowed(T.tileProps(b[c[0]], c[1]), c[2]) ? [c[0], c[1], 0] : c)) });
    }
    function transform(op) {
      if (selRect && tool === 'selezione') { transformSelection(op); return; }
      if (!base) { toast('Scegli prima un tile nella palette.', 'error'); return; }
      ops.push(op);
      updateBrush();
      widget().requestDraw();
    }

    // ---------- Strumenti sulla griglia ----------
    const inMap = (c) => c && grid() && c.x >= 0 && c.y >= 0 && c.x < G.dims(grid()).w && c.y < G.dims(grid()).h;
    const clampCell = (c) => { const d = G.dims(grid()); return { x: Math.max(0, Math.min(d.w - 1, c.x)), y: Math.max(0, Math.min(d.h - 1, c.y)) }; };
    const inSel = (c) => selRect && c.x >= selRect.x && c.y >= selRect.y && c.x < selRect.x + selRect.w && c.y < selRect.y + selRect.h;

    function paintCell(cell) {
      const m = ensureMap();
      const changed = tool === 'gomma' ? TM.eraseAt(m, layer, cell.x, cell.y, byId()) : TM.paintStamp(m, layer, cell.x, cell.y, stamp());
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
      const order = [layer].concat(m.layers.map((_, i) => m.layers.length - 1 - i).filter((i) => i !== layer && m.layers[i].visible));
      for (const li of order) {
        const a = TM.anchorAt(m, li, cell.x, cell.y, b);
        if (!a) continue;
        const tsId = m.tilesets[a.cell[0]];
        if (!b[tsId] || !T.resolveTile(b[tsId], a.cell[1])) { toast('La tile di questa cella non esiste più (segnaposto).', 'error'); return; }
        cutter.pickTile(tsId, a.cell[1]);
        base = TM.makeStamp(tsId, [a.cell[1]], 1, 1, spanFor(tsId, a.cell[1], 0));
        base.cells[0][2] = a.cell[2];
        ops = [];
        if (li !== layer) layer = li;
        setTool('pennello');
        renderLayers();
        updateBrush();
        return;
      }
      toast('Nessuna tile in questa cella.');
    }

    function down(cell, e) {
      if (!inMap(cell) && tool !== 'selezione' && tool !== 'rettangolo') return;
      const c = inMap(cell) ? cell : clampCell(cell);
      if (pasting && clipboard) {
        pasting = false;
        if (editable()) edit(() => TM.pasteRegion(map(), layer, c.x, c.y, clipboard));
        updateUi();
        return;
      }
      if (tool === 'contagocce') { pickTile(c); return; }
      if (tool === 'riempi') {
        if (!stamp()) { toast('Scegli prima un tile nella palette.', 'error'); return; }
        if (editable()) edit(() => TM.bucketFill(map(), layer, c.x, c.y, stamp(), true));
        return;
      }
      if (tool === 'rettangolo' || (tool === 'selezione' && !inSel(c))) { drag = { type: 'rect', a: c, b: c, erase: e && e.shiftKey }; widget().requestDraw(); return; }
      if (tool === 'selezione') {
        if (!editable()) return;
        drag = { type: 'move', a: c, dx: 0, dy: 0, rect: selRect, region: TM.copyRegion(ensureMap(), layer, selRect) };
        return;
      }
      if (tool === 'blocco') {
        const m = ensureMap();
        const value = { '-': 'b', b: 'l', l: '-' }[m.overrides[c.y * m.w + c.x]];
        drag = { type: 'block', value, before: widget().tileSnapshot(), was: m.overrides, last: c };
        setOverride(c, value);
        return;
      }
      if (tool === 'pennello' || tool === 'gomma') {
        if (tool === 'pennello' && !stamp()) { toast('Scegli prima un tile nella palette.', 'error'); return; }
        if (!editable()) return;
        drag = { type: 'paint', before: widget().tileSnapshot(), was: JSON.stringify(map().layers[layer].data), last: c };
        paintCell(c);
      }
    }
    function move(cell, e, dragging) {
      const prev = hover;
      hover = inMap(cell) ? cell : null;
      if (!drag) {
        if (!prev !== !hover || (hover && (hover.x !== prev.x || hover.y !== prev.y))) widget().requestDraw();
        return;
      }
      if (!cell) return;
      const c = clampCell(cell);
      if (drag.type === 'rect') { if (c.x !== drag.b.x || c.y !== drag.b.y) { drag.b = c; widget().requestDraw(); } return; }
      if (drag.type === 'move') { drag.dx = c.x - drag.a.x; drag.dy = c.y - drag.a.y; widget().requestDraw(); return; }
      // Pennello, gomma e blocco: niente ridisegni finché il puntatore resta nella stessa cella.
      if (!inMap(cell) || (cell.x === drag.last.x && cell.y === drag.last.y)) return;
      for (const q of lineCells(drag.last, cell).slice(1)) {
        if (drag.type === 'block') setOverride(q, drag.value);
        else paintCell(q);
      }
      drag.last = cell;
    }
    function up(cell, e) {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.type === 'paint') {
        if (JSON.stringify(map().layers[layer].data) !== d.was) { widget().commitTiles(d.before); renderLayers(); }
      } else if (d.type === 'block') {
        if (map().overrides !== d.was) widget().commitTiles(d.before);
      } else if (d.type === 'rect') {
        const r = G.rectBetween(d.a, d.b, grid());
        if (tool === 'selezione') { selRect = r; updateUi(); widget().requestDraw(); return; }
        if (!editable()) { widget().requestDraw(); return; }
        const erase = d.erase || (e && e.shiftKey);
        if (!erase && !stamp()) { toast('Scegli prima un tile nella palette.', 'error'); widget().requestDraw(); return; }
        edit(() => TM.fillRect(map(), layer, r, erase ? null : stamp()));
      } else if (d.type === 'move') {
        if (!d.dx && !d.dy) { widget().requestDraw(); return; }
        edit(() => {
          TM.clearRegion(map(), layer, d.rect);
          TM.pasteRegion(map(), layer, d.rect.x + d.dx, d.rect.y + d.dy, d.region);
        });
        selRect = Object.assign({}, d.rect, { x: d.rect.x + d.dx, y: d.rect.y + d.dy });
        widget().requestDraw();
      }
    }

    // ---------- Selezione: copia, taglia, incolla, svuota, trasforma ----------
    function copy(cut) {
      if (!selRect) { toast('Seleziona prima un\'area con lo strumento Seleziona.', 'error'); return; }
      clipboard = TM.copyRegion(ensureMap(), layer, selRect);
      if (cut) { if (editable()) edit(() => TM.clearRegion(map(), layer, selRect)); } else toast('Copiate ' + selRect.w + '×' + selRect.h + ' celle del livello «' + map().layers[layer].name + '».');
    }
    function paste() {
      if (!clipboard) { toast('Niente da incollare: copia prima una selezione.', 'error'); return; }
      pasting = true;
      if (tool !== 'selezione') setTool('selezione');
      toast('Clicca sulla griglia dove incollare (angolo in alto a sinistra).');
    }
    function clearSelection() {
      if (selRect && editable()) edit(() => TM.clearRegion(map(), layer, selRect));
    }
    function transformSelection(op) {
      if (!selRect || !editable()) return;
      const region = TM.transformRegion(TM.copyRegion(map(), layer, selRect), op);
      edit(() => {
        TM.clearRegion(map(), layer, selRect);
        TM.pasteRegion(map(), layer, selRect.x, selRect.y, region);
      });
      const d = G.dims(grid());
      selRect = Object.assign({}, selRect, { w: Math.min(region.w, d.w - selRect.x), h: Math.min(region.h, d.h - selRect.y) });
    }

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
      if (m && (showBlocked || tool === 'blocco')) {
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
      if (!tool) return;
      const ghost = pasting && clipboard ? Object.assign({ stepX: 1, stepY: 1 }, clipboard) : (tool === 'pennello' || tool === 'riempi') ? stamp() : null;
      if (ghost && hover && !drag) drawRegion(ctx, view, ghost, hover.x, hover.y, s, 0.6);
      if (drag && drag.type === 'move' && drag.region) drawRegion(ctx, view, Object.assign({ stepX: 1, stepY: 1 }, drag.region), drag.rect.x + drag.dx, drag.rect.y + drag.dy, s, 0.85);
      if ((tool === 'gomma' || tool === 'contagocce' || tool === 'blocco') && hover && !drag) outlineRect(ctx, view, { x: hover.x, y: hover.y, w: 1, h: 1 }, s, c.selection);
      if (drag && drag.type === 'rect') outlineRect(ctx, view, G.rectBetween(drag.a, drag.b, grid()), s, c.selection);
      if (selRect && tool === 'selezione') {
        outlineRect(ctx, view, drag && drag.type === 'move' ? Object.assign({}, selRect, { x: selRect.x + drag.dx, y: selRect.y + drag.dy }) : selRect, s, c.accent);
      }
    }
    function hint() {
      const m = map();
      const l = m && m.layers[layer];
      const at = hover ? G.cellLabel(hover.x, hover.y) + (m ? ' · costo ' + COL.cellInfo(m, byId(), hover.x, hover.y).cost + (COL.cellInfo(m, byId(), hover.x, hover.y).blocked ? ' · bloccata' : '') : '') + ' · ' : '';
      return '🧩 ' + at + (pasting ? 'Clicca dove incollare.' : HINTS[tool]) + (l ? ' Livello: ' + l.name + (l.locked ? ' (bloccato)' : '') + '.' : '');
    }

    // ---------- DOM ----------
    const toolBtns = {};
    const toolBar = el('div', { class: 'tool-group', role: 'toolbar', 'aria-label': 'Strumenti delle tile' },
      el('button', { type: 'button', class: 'btn small tool', text: '🖐 Griglia', title: 'Torna agli strumenti della griglia (Esc)', onclick: () => setTool(null) }),
      Object.entries(TOOLS).map(([k, [label, key]]) => {
        toolBtns[k] = el('button', { type: 'button', class: 'btn small tool', text: label, title: label.slice(2) + ' (' + key + ')', 'aria-pressed': 'false', onclick: () => setTool(tool === k ? null : k) });
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
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', onchange: (e) => { showBlocked = e.target.checked; widget().requestDraw(); } }), ' Mostra celle bloccate'));
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

    let height = 360;
    try { height = Number(localStorage.getItem(HEIGHT_KEY)) || height; } catch (e) { /* preferenza non essenziale */ }
    const setHeight = (h) => { height = Math.round(Math.max(160, Math.min(900, h))); body.style.height = height + 'px'; };
    const storeHeight = () => { try { localStorage.setItem(HEIGHT_KEY, String(height)); } catch (e) { /* ignora */ } };
    setHeight(height);
    resizer.addEventListener('pointerdown', (e) => {
      resizer.setPointerCapture(e.pointerId);
      const y0 = e.clientY;
      const h0 = height;
      const mv = (ev) => setHeight(h0 - (ev.clientY - y0));
      const end = () => { resizer.removeEventListener('pointermove', mv); resizer.removeEventListener('pointerup', end); storeHeight(); };
      resizer.addEventListener('pointermove', mv);
      resizer.addEventListener('pointerup', end);
    });
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      setHeight(height + (e.key === 'ArrowUp' ? 20 : -20));
      storeHeight();
    });
    const collapse = DnD.ui.persistentToggle('dnd-battaglie:pannello-tile', (collapsed) => {
      body.hidden = collapsed;
      resizer.hidden = collapsed;
      toggleBtn.textContent = collapsed ? '▲ Apri' : '▼ Chiudi';
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      if (collapsed && tool) setTool(null);
    });
    toggleBtn.addEventListener('click', () => collapse.toggle());

    function setTool(k) {
      tool = k;
      if (k !== 'selezione') pasting = false;
      // Uno strumento delle tile riporta la griglia su «Seleziona» (niente anteprime di inserimento).
      if (k && widget()) widget().setTool('seleziona');
      for (const [id, btn] of Object.entries(toolBtns)) { btn.classList.toggle('active', id === k); btn.setAttribute('aria-pressed', String(id === k)); }
      if (k && collapse.collapsed()) collapse.toggle(false);
      updateUi();
    }
    function updateBrush() {
      if (!base) { brushInfo.textContent = 'Nessun tile scelto: clicca un tile (o trascina un rettangolo) nella palette.'; return; }
      const st = stamp();
      brushInfo.textContent = 'Timbro ' + st.w + '×' + st.h + (ops.length ? ' · trasformato (' + ops.length + ')' : '');
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
      layer = Math.max(0, Math.min(m.layers.length - 1, layer));
      const rows = m.layers.map((l, i) => i).reverse().map((i) => {
        const l = m.layers[i];
        const opacity = el('input', { type: 'range', min: 0, max: 100, value: String(Math.round(l.opacity * 100)), 'aria-label': 'Opacità di ' + l.name,
          onchange: (e) => layerEdit((mm) => { mm.layers[i].opacity = Number(e.target.value) / 100; }) });
        const where = el('select', { 'aria-label': 'Posizione di ' + l.name, onchange: (e) => layerEdit((mm) => { mm.layers[i].above = e.target.value === 'sopra'; }) },
          el('option', { value: 'sotto', text: 'Sotto le pedine', selected: !l.above }), el('option', { value: 'sopra', text: 'Sopra le pedine', selected: l.above }));
        return el('div', { class: 'tile-layer' + (i === layer ? ' active' : '') },
          el('div', { class: 'tile-layer-head' },
            b(l.visible ? '👁' : '◌', l.visible ? 'Nascondi' : 'Mostra', () => layerEdit((mm) => { mm.layers[i].visible = !mm.layers[i].visible; })),
            b(l.locked ? '🔒' : '🔓', l.locked ? 'Sblocca le modifiche' : 'Blocca le modifiche', () => layerEdit((mm) => { mm.layers[i].locked = !mm.layers[i].locked; })),
            el('button', { type: 'button', class: 'tile-layer-name', text: l.name, 'aria-pressed': String(i === layer), onclick: () => { layer = i; renderLayers(); updateUi(); } }),
            b('✎', 'Rinomina', () => promptText('Rinomina livello', 'Nome', l.name, (name) => { layerEdit((mm) => { mm.layers[i].name = name.slice(0, 40); }); return null; })),
            b('↑', 'Sposta su', () => { layerEdit((mm) => { layer = TM.moveLayer(mm, i, 1); }); }),
            b('↓', 'Sposta giù', () => { layerEdit((mm) => { layer = TM.moveLayer(mm, i, -1); }); }),
            b('⧉', 'Duplica', () => { layerEdit((mm) => { layer = TM.duplicateLayer(mm, i); }); }),
            b('🗑', 'Elimina', () => {
              if (m.layers.length <= 1) { toast('Deve restare almeno un livello.', 'error'); return; }
              if (l.data.some(Boolean) && !confirm('Eliminare il livello «' + l.name + '» con le sue tile?')) return;
              layerEdit((mm) => { layer = TM.removeLayer(mm, i); });
            })),
          el('div', { class: 'tile-layer-props' }, el('label', { class: 'inline small' }, 'Opacità', opacity), where,
            l.above ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: l.fade, onchange: (e) => layerEdit((mm) => { mm.layers[i].fade = e.target.checked; }) }), ' Semitrasparente con una pedina sotto') : null));
      });
      layersBox.append(...rows, b('+ Nuovo livello', 'Aggiungi un livello', () => {
        promptText('Nuovo livello', 'Nome del livello', 'Livello ' + (m.layers.length + 1), (name) => {
          if (m.layers.length >= TM.MAX_LAYERS) return 'Al massimo ' + TM.MAX_LAYERS + ' livelli.';
          layerEdit((mm) => { layer = TM.addLayer(mm, name.slice(0, 40)); });
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
        if (!tool) return;
        if (k === 'r') { e.preventDefault(); transform(e.shiftKey ? 'ruota-sx' : 'ruota'); return; }
        if (k === 'f') { e.preventDefault(); transform(e.shiftKey ? 'specchia-v' : 'specchia'); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (pasting) pasting = false; else setTool(null); updateUi(); return; }
        if (e.key === 'Delete' && selRect && tool === 'selezione') { e.preventDefault(); e.stopImmediatePropagation(); clearSelection(); }
        return;
      }
      if (ctrl && tool === 'selezione' && ['c', 'x', 'v'].includes(k)) {
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
      painter: { active: () => Boolean(tool), deactivate: () => setTool(null), down, move, up, draw, hint },
      reset: () => { setTool(null); selRect = null; clipboard = null; },
    };
  }

  DnD.uiPannelloTile = { create, lineCells };
})(globalThis.DnD = globalThis.DnD || {});
