// Componente griglia su <canvas>, riusato dal combattimento e dall'editor griglie.
// Lavora su un "documento" { id, grid, combatants, currentId } fornito da chi lo usa: griglie di qualsiasi
// dimensione (w × h) con sfondo, pedine con ingombro w × h, strutture, oggetti di mappa, etichette e zone;
// zoom/pan, strumenti, misuratore, annulla/ripeti. Con opts.painter gli strumenti delle tile (pannello Tile
// dell'editor) dipingono direttamente sulla griglia.
(function (DnD) {
  'use strict';

  const { el, clear, toast, openMenu, promptText, openDialog } = DnD.ui;
  const G = DnD.griglia;
  const R = DnD.regole;
  const MARGIN = 22;          // fascia delle coordinate sui bordi
  const HISTORY_LIMIT = 50;
  const DOUBLE_CLICK_MS = 400;
  const DRAG_THRESHOLD = 4;
  // Colori del canvas letti dalle variabili CSS del tema; la cache si svuota al cambio tema.
  let palette = null;
  const redrawers = new Set();
  function colors() {
    if (!palette) {
      const cs = getComputedStyle(document.documentElement);
      const v = (name) => cs.getPropertyValue(name).trim();
      const rgb = (name) => v(name).split(',').map(Number);
      palette = {
        bg: v('--grid-bg'), board: v('--grid-board'), line: v('--grid-line'), line5: v('--grid-line-strong'),
        label: v('--grid-label'), labelBg: v('--grid-label-bg'), text: v('--text'), current: v('--accent'), selected: v('--selection'),
        missing: v('--grid-missing'), missingText: v('--grid-missing-text'),
        ok: 'rgba(63,174,99,0.45)', bad: 'rgba(212,69,58,0.5)',
        hp: { alto: v('--hp-high'), medio: v('--hp-mid'), basso: v('--hp-low') }, hpTrack: v('--hp-track'),
        zone: { giocatori: rgb('--zone-players'), nemici: rgb('--zone-enemies') },
      };
    }
    return palette;
  }
  window.addEventListener('themechange', () => {
    palette = null;
    for (const redraw of redrawers) redraw();
  });
  const TOOLS = {
    seleziona: '🖐 Seleziona/Sposta', struttura: '🧱 Inserisci struttura', oggetto: '💰 Inserisci oggetto', gomma: '🧽 Gomma',
    riempi: '▦ Riempi area', 'zona-giocatori': '🟦 Zona giocatori', 'zona-nemici': '🟥 Zona nemici', etichetta: '🏷 Etichetta',
    misura: '📏 Misura distanza',
  };
  const TOOL_HINTS = {
    struttura: 'Scegli una struttura nel pannello e clicca sulla griglia.',
    oggetto: 'Scegli un oggetto di mappa (o un oggetto dell\'Attrezzatura, che finisce «a terra») nel pannello e clicca sulla griglia.',
    gomma: 'Clicca o trascina per cancellare.',
    riempi: 'Scegli una struttura nel pannello e trascina un rettangolo.',
    'zona-giocatori': 'Trascina un rettangolo per la zona di partenza dei giocatori.',
    'zona-nemici': 'Trascina un rettangolo per la zona di partenza dei nemici.',
    etichetta: 'Clicca una cella per aggiungere o modificare un\'etichetta.',
    misura: 'Trascina tra due punti.',
  };
  const defaultView = () => ({ zoom: 1, panX: MARGIN + 6, panY: MARGIN + 6 });

  // Pannello laterale della griglia: stato aperto/chiuso condiviso da tutte le istanze.
  const paletteBodies = new Set();
  let paletteToggle = null;
  function getPaletteToggle() {
    if (!paletteToggle) {
      paletteToggle = DnD.ui.persistentToggle('dnd-battaglie:pannello-griglia', (collapsed) => {
        for (const b of paletteBodies) b.classList.toggle('palette-collapsed', collapsed);
      });
    }
    return paletteToggle;
  }

  // Elementi copiati da strutture/oggetti di mappa poi eliminati: mostrati come segnaposto grigio.
  function missingSources() {
    const st = DnD.store.state;
    return { structures: new Set(st.structures.map((s) => s.id)), items: new Set(st.mapObjects.map((i) => i.id)) };
  }
  const isMissing = (known, entity) => Boolean(entity.sourceId) && !known.has(entity.sourceId);

  // opts: {
  //   getDoc() -> documento | null, update(fn) applica fn(doc) e salva,
  //   tools: elenco di strumenti, toolbar: nodi extra, showCombatants: pannello Combattenti,
  //   onSelect(combatantId | null), tokenActions(combatantId) -> [{ text, onclick, disabled }],
  //   onObject(itemId): doppio clic su un oggetto di mappa (pannello di interazione),
  //   painter: strumenti delle tile { active(), down(cell, e), move(cell, e), up(cell, e), draw(ctx, view, s), hint() }
  //   overlay(ctx, view, s): disegno aggiuntivo sopra le pedine (anteprima del piano dell'IA)
  //   underlay(ctx, view, s): disegno aggiuntivo sotto le pedine (biomi ed eventi dell'esplorazione)
  //   undo(), redo(), canUndo(), canRedo(): annulla/ripeti gestiti da chi usa la griglia (esplorazione)
  // }
  function create(opts) {
    const onSelect = opts.onSelect || (() => {});
    const tokenActions = opts.tokenActions || (() => []);
    let view = defaultView();
    let tool = 'seleziona';
    let template = null;    // { kind: 'structure' | 'item' | 'equipment', id } per gli strumenti di inserimento
    let selection = null;   // { kind: 'token' | 'item' | 'structure' | 'label' | 'zone', id }
    let measure = null;     // { a, b } celle
    let drag = null;
    let hover = null;       // anteprima degli strumenti di inserimento
    let pick = null;        // callback della scelta del bersaglio
    let docId = null;
    let lastClick = { key: null, time: 0 };
    let raf = 0;
    const history = G.createHistory(HISTORY_LIMIT);

    const doc = () => opts.getDoc();
    // Collisioni: strutture, oggetti e TileMap della griglia (tile bloccanti e poligoni di collisione).
    const board = () => {
      const d = doc();
      return G.boardOf(d.grid, d.combatants, DnD.tilemap.tilesetIndex(DnD.store.state.tilesets));
    };
    const feet = () => (doc() ? doc().grid.feetPerCell || 5 : 5);
    const dims = () => G.dims(doc() && doc().grid);
    const painting = () => Boolean(opts.painter && opts.painter.active());

    // ---------- DOM ----------
    const canvas = el('canvas', { class: 'grid-canvas', tabindex: 0, 'aria-label': 'Griglia di battaglia: trascina per spostare, rotella per lo zoom' });
    const banner = el('div', { class: 'grid-banner', hidden: true },
      el('span', { text: '🎯 Clicca le pedine dei bersagli' }),
      el('button', { type: 'button', class: 'btn small', text: 'Fine', onclick: () => finishPick(null) }));
    const wrap = el('div', { class: 'grid-canvas-wrap' }, canvas, banner);
    const palette = el('div', { class: 'grid-palette', id: 'grid-palette-' + DnD.dadi.uid().slice(0, 8) });
    const info = el('div', { class: 'grid-info', 'aria-live': 'polite' });
    const selBar = el('div', { class: 'grid-selbar' });
    const btn = (text, title, onclick) => el('button', { type: 'button', class: 'btn small', text, title, 'aria-label': title, onclick });
    const toolButtons = {};
    const toolBar = el('div', { class: 'tool-group', role: 'toolbar', 'aria-label': 'Strumenti' }, opts.tools.map((t) => {
      toolButtons[t] = el('button', { type: 'button', class: 'btn small tool', text: TOOLS[t], 'aria-pressed': 'false', onclick: () => {
        // Uno strumento della griglia disattiva quelli delle tile.
        if (opts.painter && opts.painter.active()) opts.painter.deactivate();
        setTool(tool === t && t !== 'seleziona' ? 'seleziona' : t);
      } });
      return toolButtons[t];
    }));
    const undoBtn = btn('↶', 'Annulla (Ctrl+Z)', () => undo());
    const redoBtn = btn('↷', 'Ripeti (Ctrl+Y)', () => redo());
    const ignoreBox = el('input', { type: 'checkbox', onchange: (e) => { opts.update((d) => { d.grid.ignoreCollisions = e.target.checked; }); } });
    const paletteBtn = btn('◧', 'Pannello laterale (Ctrl+Alt+B)', () => getPaletteToggle().toggle());
    paletteBtn.setAttribute('aria-controls', palette.id);
    const toolbar = el('div', { class: 'grid-toolbar' },
      paletteBtn,
      btn('⟲ Reimposta vista', 'Reimposta vista', () => { view = defaultView(); requestDraw(); }),
      toolBar,
      el('label', { class: 'check small' }, ignoreBox, ' Ignora collisioni'),
      undoBtn, redoBtn,
      opts.toolbar || []);
    const body = el('div', { class: 'grid-body' }, palette, wrap);
    paletteBodies.add(body);
    body.classList.toggle('palette-collapsed', getPaletteToggle().collapsed());
    const node = el('section', { class: 'grid-pane', 'aria-label': 'Griglia' },
      toolbar, el('div', { class: 'grid-status' }, info, selBar), body);

    new ResizeObserver(() => requestDraw()).observe(wrap);
    redrawers.add(() => requestDraw());

    // ---------- Modifiche con annulla/ripeti ----------
    function commit(fn) {
      const before = G.gridSnapshot(doc());
      opts.update(fn);
      history.push(before);
      changed();
    }
    function undo() {
      if (opts.undo) { opts.undo(); updateUi(); return; }
      const d = doc();
      const prev = d && history.undo(G.gridSnapshot(d));
      if (!prev) return;
      opts.update((dd) => G.restoreSnapshot(dd, prev));
      changed();
    }
    function redo() {
      if (opts.redo) { opts.redo(); updateUi(); return; }
      const d = doc();
      const next = d && history.redo(G.gridSnapshot(d));
      if (!next) return;
      opts.update((dd) => G.restoreSnapshot(dd, next));
      changed();
    }
    function changed() {
      if (selection && !entity(selection)) selection = null;
      refreshPalette();
      updateUi();
      requestDraw();
    }

    // ---------- Entità ----------
    const LISTS = { item: 'items', structure: 'structures', label: 'labels', zone: 'zones' };
    function entity(hit) {
      const d = doc();
      if (!d || !hit) return null;
      if (hit.kind === 'token') return d.combatants.find((x) => x.id === hit.id && x.pos) || null;
      return d.grid[LISTS[hit.kind]].find((x) => x.id === hit.id) || null;
    }
    function entityPos(hit) {
      const e = entity(hit);
      return hit.kind === 'token' ? e.pos : { x: e.x, y: e.y };
    }
    function footprint(hit) {
      const e = entity(hit);
      if (hit.kind === 'token') return G.tokenShape(e);
      if (hit.kind === 'structure' || hit.kind === 'item') return e;
      if (hit.kind === 'zone') return G.shapeFrom(e.w, e.h, () => true);
      return G.squareShape(1);
    }
    function entityName(hit) {
      const e = entity(hit);
      if (hit.kind === 'zone') return G.ZONE_KINDS[e.kind];
      return hit.kind === 'label' ? 'Etichetta «' + e.text + '»' : e.name;
    }
    function isValidAt(hit, x, y) {
      if (hit.kind === 'token') return G.canPlaceToken(board(), hit.id, x, y);
      if (hit.kind === 'structure') return G.canPlaceStructure(board(), entity(hit), x, y);
      if (hit.kind === 'item') return G.canPlaceItem(board(), entity(hit), G.objectBlocks(entity(hit)), x, y);
      return G.inBounds(footprint(hit), x, y, doc().grid);
    }
    function hitTest(cell, withZones) {
      const d = doc();
      for (const t of d.combatants) if (G.tokenCovers(t, cell.x, cell.y)) return { kind: 'token', id: t.id };
      const at = (list, kind) => {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].x === cell.x && list[i].y === cell.y) return { kind, id: list[i].id };
        return null;
      };
      const inArea = (e) => cell.x >= e.x && cell.x < e.x + e.w && cell.y >= e.y && cell.y < e.y + e.h;
      const found = at(d.grid.labels, 'label');
      if (found) return found;
      for (let i = d.grid.items.length - 1; i >= 0; i--) if (inArea(d.grid.items[i])) return { kind: 'item', id: d.grid.items[i].id };
      for (let i = d.grid.structures.length - 1; i >= 0; i--) {
        const s = d.grid.structures[i];
        if (G.isFilled(s, cell.x - s.x, cell.y - s.y)) return { kind: 'structure', id: s.id };
      }
      // L'immagine può coprire anche celle non selezionate: cliccandole si seleziona comunque la struttura.
      for (let i = d.grid.structures.length - 1; i >= 0; i--) {
        const s = d.grid.structures[i];
        if (s.tiles && inArea(s)) return { kind: 'structure', id: s.id };
      }
      if (withZones !== false) {
        for (let i = d.grid.zones.length - 1; i >= 0; i--) {
          const z = d.grid.zones[i];
          if (cell.x >= z.x && cell.x < z.x + z.w && cell.y >= z.y && cell.y < z.y + z.h) return { kind: 'zone', id: z.id };
        }
      }
      return null;
    }

    // ---------- Azioni sulla selezione ----------
    function select(hit) {
      selection = hit;
      onSelect(hit && hit.kind === 'token' ? hit.id : null);
      updateUi();
      requestDraw();
    }

    function transformEntity(hit, op, label) {
      const e = entity(hit);
      const next = G.transformPlaced(e, op);
      const x = Math.max(0, Math.min(e.x, dims().w - next.w));
      const y = Math.max(0, Math.min(e.y, dims().h - next.h));
      const ok = hit.kind === 'structure' ? G.canPlaceStructure(board(), next, x, y) : G.canPlaceItem(board(), next, G.objectBlocks(e), x, y);
      if (!ok) {
        toast('Impossibile ' + label + ': l\'elemento coprirebbe una pedina.', 'error');
        return;
      }
      commit(() => Object.assign(e, next, { x, y }));
    }

    function duplicate(hit) {
      const e = entity(hit);
      const fp = footprint(hit);
      const valid = (x, y) => (hit.kind === 'structure' ? G.canPlaceStructure(board(), e, x, y)
        : hit.kind === 'item' ? G.canPlaceItem(board(), e, G.objectBlocks(e), x, y) : G.inBounds(fp, x, y, doc().grid));
      const spot = G.findFreeSpot(e.x + 1, e.y + 1, valid, doc().grid);
      if (!spot) { toast('Nessuno spazio libero per la copia.', 'error'); return; }
      const copy = Object.assign(JSON.parse(JSON.stringify(e)), { id: DnD.dadi.uid() }, spot);
      commit((d) => d.grid[LISTS[hit.kind]].push(copy));
      select({ kind: hit.kind, id: copy.id });
    }

    function removeEntity(hit) {
      if (!hit || !entity(hit)) return;
      commit((d) => {
        if (hit.kind === 'token') d.combatants.find((x) => x.id === hit.id).pos = null;
        else d.grid[LISTS[hit.kind]] = d.grid[LISTS[hit.kind]].filter((x) => x.id !== hit.id);
      });
      if (selection && selection.id === hit.id) select(null);
    }

    function editLabel(hit) {
      const l = entity(hit);
      promptText('Modifica etichetta', 'Testo', l.text, (text) => {
        commit(() => { l.text = text.slice(0, 40); });
        return null;
      });
    }

    function actionsFor(hit) {
      const del = { text: '✕ Elimina', danger: true, onclick: () => removeEntity(hit) };
      if (hit.kind === 'structure') {
        return [
          { text: '⟳ Ruota 90°', onclick: () => transformEntity(hit, 'ruota', 'ruotare') },
          { text: '⇋ Specchia', onclick: () => transformEntity(hit, 'specchia', 'specchiare') },
          { text: '⧉ Duplica', onclick: () => duplicate(hit) },
          del,
        ];
      }
      if (hit.kind === 'item') {
        return (opts.onObject ? [{ text: '🗝 Interagisci…', onclick: () => opts.onObject(hit.id) }] : []).concat(entity(hit).tiles ? [
          { text: '⟳ Ruota 90°', onclick: () => transformEntity(hit, 'ruota', 'ruotare') },
          { text: '⇋ Specchia', onclick: () => transformEntity(hit, 'specchia', 'specchiare') },
        ] : []).concat([{ text: '⧉ Duplica', onclick: () => duplicate(hit) }, { text: '✕ Rimuovi', danger: true, onclick: () => removeEntity(hit) }]);
      }
      if (hit.kind === 'label') return [{ text: '✎ Modifica testo', onclick: () => editLabel(hit) }, { text: '⧉ Duplica', onclick: () => duplicate(hit) }, del];
      if (hit.kind === 'zone') return [{ text: '⧉ Duplica', onclick: () => duplicate(hit) }, del];
      return tokenActions(hit.id).concat([{ text: '⤺ Togli dalla griglia', onclick: () => removeEntity(hit) }]);
    }

    // ---------- Strumenti di inserimento ----------
    function templateEntity() {
      if (!template) return null;
      const st = DnD.store.state;
      const list = template.kind === 'structure' ? st.structures : template.kind === 'equipment' ? st.equipment : st.mapObjects;
      return list.find((x) => x.id === template.id) || null;
    }
    function insertFootprint() {
      const t = templateEntity();
      if (tool === 'struttura' && t && template.kind === 'structure') return G.templateShape(t);
      if (tool === 'oggetto' && t && template.kind !== 'structure') return template.kind === 'equipment' ? G.squareShape(1) : G.templateShape(t, 'item');
      return null;
    }
    function placeStructure(tpl, p) {
      const placed = DnD.dati.normalizePlacedStructure(Object.assign({ id: DnD.dadi.uid(), sourceId: tpl.id, name: tpl.name, color: tpl.color },
        G.placedFields(tpl), p));
      commit((d) => d.grid.structures.push(placed));
      return placed;
    }
    // Copia di un oggetto di mappa: stato e contenuto propri, copiati dal modello.
    function placeItem(tpl, p) {
      const placed = DnD.dati.normalizePlacedItem(Object.assign(DnD.oggettiMappa.instantiate(tpl, DnD.dadi.uid()), G.placedFields(tpl, 'item'), p), dims());
      commit((d) => d.grid.items.push(placed));
      return placed;
    }
    // Oggetto dell'Attrezzatura posato "a terra": un oggetto di mappa che lo contiene.
    function placeGround(eq, p) {
      const placed = DnD.dati.normalizePlacedItem(Object.assign(DnD.oggettiMappa.groundItem(eq, DnD.dadi.uid()), G.squareShape(1), p), dims());
      commit((d) => d.grid.items.push(placed));
      return placed;
    }
    const blocksOf = (t) => (template && template.kind === 'equipment' ? false : G.objectBlocks(t));
    const canInsertAt = (fp, x, y) => (tool === 'struttura' ? G.canPlaceStructure(board(), fp, x, y) : G.canPlaceItem(board(), fp, blocksOf(templateEntity()), x, y));
    function insertAt(cell) {
      const t = templateEntity();
      if (!t || (tool === 'struttura') !== (template.kind === 'structure')) {
        toast(TOOL_HINTS[tool], 'error');
        return;
      }
      const fp = insertFootprint();
      const p = { x: cell.x - Math.floor(fp.w / 2), y: cell.y - Math.floor(fp.h / 2) };
      if (!canInsertAt(fp, p.x, p.y)) { toast('Posizione non valida.', 'error'); return; }
      if (tool === 'struttura') select({ kind: 'structure', id: placeStructure(t, p).id });
      else if (template.kind === 'equipment') select({ kind: 'item', id: placeGround(t, p).id });
      else select({ kind: 'item', id: placeItem(t, p).id });
    }
    function finishRect(rect) {
      if (tool === 'riempi') {
        const t = templateEntity();
        if (!t || template.kind !== 'structure') { toast(TOOL_HINTS.riempi, 'error'); return; }
        const filled = G.shapeFrom(rect.w, rect.h, () => true);
        if (!G.canPlaceStructure(board(), filled, rect.x, rect.y)) { toast('L\'area coprirebbe una pedina.', 'error'); return; }
        select({ kind: 'structure', id: placeStructure(Object.assign({}, t, filled, { mode: 'custom', tiles: null }), rect).id });
        return;
      }
      const zone = DnD.dati.normalizeZone(Object.assign({ id: DnD.dadi.uid(), kind: tool === 'zona-nemici' ? 'nemici' : 'giocatori' }, rect), dims());
      commit((d) => d.grid.zones.push(zone));
      select({ kind: 'zone', id: zone.id });
    }
    function labelAt(cell) {
      const existing = hitTest(cell, false);
      if (existing && existing.kind === 'label') { editLabel(existing); return; }
      promptText('Nuova etichetta', 'Testo (es. Trappola, Ingresso)', '', (text) => {
        const label = DnD.dati.normalizeLabel({ id: DnD.dadi.uid(), text, x: cell.x, y: cell.y }, dims());
        commit((d) => d.grid.labels.push(label));
        select({ kind: 'label', id: label.id });
        return null;
      });
    }
    // Gomma: cancella l'elemento più in alto nella cella (etichetta, oggetto, struttura, zona, pedina).
    function eraseAt(cell) {
      const hit = hitTest(cell);
      if (!hit) return false;
      opts.update((d) => {
        if (hit.kind === 'token') d.combatants.find((x) => x.id === hit.id).pos = null;
        else d.grid[LISTS[hit.kind]] = d.grid[LISTS[hit.kind]].filter((x) => x.id !== hit.id);
      });
      return true;
    }

    function setTool(t) {
      tool = t;
      if (t !== 'misura') measure = null;
      hover = null;
      for (const [k, b] of Object.entries(toolButtons)) {
        b.setAttribute('aria-pressed', String(k === t));
        b.classList.toggle('active', k === t);
      }
      refreshPalette();
      updateUi();
      requestDraw();
    }

    // ---------- Disegno ----------
    function requestDraw() {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    }

    function drawShape(ctx, shape, color, x, y, s, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      for (let j = 0; j < shape.h; j++) {
        for (let i = 0; i < shape.w; i++) {
          if (!G.isFilled(shape, i, j)) continue;
          const px = view.panX + (x + i) * s;
          const py = view.panY + (y + j) * s;
          ctx.fillRect(px, py, s, s);
          ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        }
      }
      ctx.restore();
    }

    function outline(ctx, shape, x, y, s, color, dashed) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([5, 4]);
      for (let j = 0; j < shape.h; j++) {
        for (let i = 0; i < shape.w; i++) {
          if (G.isFilled(shape, i, j)) ctx.strokeRect(view.panX + (x + i) * s + 1, view.panY + (y + j) * s + 1, s - 2, s - 2);
        }
      }
      ctx.restore();
    }

    function questionMark(ctx, cx, cy, s) {
      ctx.save();
      ctx.fillStyle = colors().missingText;
      ctx.font = 'bold ' + Math.round(s * 0.5) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy + 1);
      ctx.restore();
    }

    // Tilemap di una struttura o di un oggetto: i livelli sotto (above = false) o sopra le pedine, solo le
    // celle visibili. Se il TileSet o la sua immagine mancano compare un segnaposto grigio; l'ingombro resta valido.
    function drawPlacedTiles(ctx, e, s, above, faded, W, H) {
      const clip = {
        x0: Math.floor((0 - view.panX) / s) - e.x, y0: Math.floor((0 - view.panY) / s) - e.y,
        x1: Math.ceil((W - view.panX) / s) - e.x, y1: Math.ceil((H - view.panY) / s) - e.y,
      };
      const res = DnD.uiTileset.drawTiles(ctx, e.tiles, view.panX + e.x * s, view.panY + e.y * s, s, {
        above, clip, onReady: requestDraw, layerAlpha: (l) => (faded && l.fade ? 0.4 : 1),
      });
      if (res.missing && !above) questionMark(ctx, view.panX + (e.x + e.w / 2) * s, view.panY + (e.y + e.h / 2) * s, s);
    }

    // TileMap della griglia: livelli sotto le pedine (prima) o sopra (dopo). Le celle dei livelli
    // "semitrasparenti" sopra una pedina si vedono al 40%.
    function drawGridMap(ctx, map, s, above, tokenCells, W, H) {
      const clip = {
        x0: Math.max(0, Math.floor(-view.panX / s)), y0: Math.max(0, Math.floor(-view.panY / s)),
        x1: Math.ceil((W - view.panX) / s), y1: Math.ceil((H - view.panY) / s),
      };
      const covered = (x, y, span) => {
        for (let j = 0; j < span.h; j++) for (let i = 0; i < span.w; i++) if (tokenCells.has(G.key(x + i, y + j))) return true;
        return false;
      };
      DnD.uiTileset.drawTiles(ctx, map, view.panX, view.panY, s, {
        above, clip, onReady: requestDraw,
        cellAlpha: above ? (l, x, y, span) => (l.fade && covered(x, y, span) ? 0.4 : 1) : null,
      });
    }

    function drawZone(ctx, z, s, alpha) {
      const [r, g, b] = colors().zone[z.kind];
      const px = view.panX + z.x * s;
      const py = view.panY + z.y * s;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.22)';
      ctx.fillRect(px, py, z.w * s, z.h * s);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, z.w * s - 2, z.h * s - 2);
      if (s >= 14) {
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',1)';
        ctx.font = '600 ' + Math.max(9, Math.min(12, s * 0.32)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(G.ZONE_KINDS[z.kind], px + 4, py + 3, z.w * s - 8);
      }
      ctx.restore();
    }

    function drawLabel(ctx, l, s) {
      const cx = view.panX + (l.x + 0.5) * s;
      const cy = view.panY + (l.y + 0.5) * s;
      ctx.save();
      ctx.font = '600 ' + Math.max(9, Math.min(13, s * 0.34)) + 'px system-ui, sans-serif';
      const w = ctx.measureText(l.text).width + 8;
      ctx.fillStyle = colors().labelBg;
      ctx.fillRect(cx - w / 2, cy - 9, w, 18);
      ctx.strokeStyle = colors().current;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - w / 2 + 0.5, cy - 8.5, w - 1, 17);
      ctx.fillStyle = colors().current;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, cx, cy + 0.5);
      ctx.restore();
    }

    // Pedina nel suo ingombro w × h: forme stirate (il cerchio diventa un'ellisse), immagini e icone della
    // libreria adattate senza deformarle, contorno del turno, selezione, barra della vita e nome.
    function drawToken(ctx, t, x, y, s, o) {
      const dm = G.tokenDims(t);
      const dw = dm.w * s;
      const dh = dm.h * s;
      const px = view.panX + x * s;
      const py = view.panY + y * s;
      const cx = px + dw / 2;
      const cy = py + dh / 2;
      const pad = Math.min(dw, dh) * 0.12;
      const down = R.isDown(t);
      // Boss: alone del colore del tema (e aura in celle) sotto la pedina. Leggendari: alone e, in forma, ali.
      if (t.boss && !down && DnD.uiBoss) DnD.uiBoss.drawAura(ctx, t, cx, cy, dw, dh, s);
      if (t.legend && !down && DnD.uiLeggendario) DnD.uiLeggendario.drawHalo(ctx, t, cx, cy, dw, dh);
      ctx.save();
      if (o.ghost) ctx.globalAlpha = 0.6;
      if (down) { ctx.globalAlpha = 0.45; ctx.filter = 'grayscale(1)'; }
      DnD.icone.drawIconRect(ctx, t.icon, px + pad, py + pad, dw - 2 * pad, dh - 2 * pad, requestDraw);
      ctx.restore();
      // Sopra la pedina: corona del boss (il leggendario, anche in forma, ha l'aureola sotto la barra della vita).
      if (t.boss && !t.legend && DnD.uiBoss) DnD.uiBoss.drawCrown(ctx, t, cx, py + pad, Math.min(dw, dh), s);
      if (o.current) {
        ctx.save();
        ctx.beginPath();
        const ring = Math.max(3, s * 0.09);
        ctx.ellipse(cx, cy, dw / 2 - pad + ring, dh / 2 - pad + ring, 0, 0, Math.PI * 2);
        ctx.strokeStyle = colors().current;
        ctx.lineWidth = Math.max(2.5, s * 0.08);
        ctx.stroke();
        ctx.restore();
      }
      if (o.selected) {
        ctx.save();
        ctx.strokeStyle = colors().selected;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1.5, py + 1.5, dw - 3, dh - 3);
        ctx.restore();
      }
      // Mini barra della vita sopra la pedina.
      const bw = dw * 0.8;
      const bh = Math.max(3, s * 0.1);
      const bx = cx - bw / 2;
      const by = py + Math.max(1, s * 0.02);
      ctx.fillStyle = colors().hpTrack;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = down ? colors().missing : colors().hp[R.hpLevel(t.hp, t.maxHp)];
      ctx.fillRect(bx, by, bw * Math.max(0, t.hp / t.maxHp), bh);
      if (t.legend && !down && DnD.uiLeggendario) DnD.uiLeggendario.drawAureola(ctx, t, cx, by + bh, Math.min(dw, dh));
      ctx.strokeStyle = colors().line5;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
      // Numerino delle copie.
      if (t.copy) {
        const br = Math.max(6, s * 0.17);
        const bxx = px + dw - pad - br * 0.4;
        const byy = py + pad + br * 0.9;
        ctx.beginPath();
        ctx.arc(bxx, byy, br, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.round(br * 1.2) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(t.copy), bxx, byy + 0.5);
      }
      // Nome sotto la pedina.
      if (s >= 22) {
        const fs = Math.max(9, Math.min(13, s * 0.3));
        ctx.font = '600 ' + fs + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors().board;
        const ty = py + dh - pad + 1;
        ctx.strokeText(t.name, cx, ty, dw + s);
        ctx.fillStyle = down ? colors().label : colors().text;
        ctx.fillText(t.name, cx, ty, dw + s);
      }
    }

    // Oggetto di mappa: icona (o tile), con i segni di stato: aperto (più chiaro), chiuso a chiave 🔒,
    // trappola individuata ⚠ e nascosto (solo master: semitrasparente con l'occhio barrato).
    function drawObjectMarks(ctx, it, s) {
      if (s < 14) return;
      const marks = (it.lock.locked && it.state !== 'aperto' ? '🔒' : '') + (it.trap.enabled && it.trap.armed && it.trap.found ? '⚠' : '');
      ctx.save();
      if (marks) {
        ctx.font = Math.max(8, Math.round(s * 0.3)) + 'px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(marks, view.panX + (it.x + it.w) * s - 1, view.panY + it.y * s + 1);
      }
      if (it.hidden) {
        // Occhio barrato (nascosto ai giocatori, visibile solo al master) nell'angolo in basso a sinistra.
        const r = Math.max(4, s * 0.14);
        const cx = view.panX + it.x * s + r + 2;
        const cy = view.panY + (it.y + it.h) * s - r - 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#ff6b5e';
        ctx.beginPath();
        ctx.moveTo(cx - r, cy + r * 0.8);
        ctx.lineTo(cx + r, cy - r * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Sfondo della griglia: colore o immagine (adattata, coperta o a dimensione originale, con posizione,
    // scala e opacità), sempre sotto tutto e ritagliato sull'area della griglia.
    function drawBackground(ctx, g, s, N) {
      const bg = g.background;
      ctx.fillStyle = bg && bg.kind === 'colore' ? bg.color : colors().board;
      ctx.fillRect(view.panX, view.panY, N.w * s, N.h * s);
      if (!bg || bg.kind !== 'immagine' || !DnD.immagini) return;
      const res = DnD.immagini.drawable(bg.imageId, requestDraw);
      if (res.state !== 'ok') return;
      const iw = res.img.width || res.img.naturalWidth;
      const ih = res.img.height || res.img.naturalHeight;
      const r = G.backgroundRect(bg, iw, ih, N.w, N.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(view.panX, view.panY, N.w * s, N.h * s);
      ctx.clip();
      ctx.globalAlpha = bg.opacity;
      ctx.drawImage(res.img, view.panX + r.x * s, view.panY + r.y * s, r.w * s, r.h * s);
      ctx.restore();
    }

    function drawLabels(ctx, W, H, s) {
      ctx.fillStyle = colors().bg;
      ctx.fillRect(0, 0, W, MARGIN);
      ctx.fillRect(0, 0, MARGIN, H);
      ctx.fillStyle = colors().label;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const step = s >= 20 ? 1 : s >= 10 ? 2 : s >= 4 ? 5 : 10;
      const N = dims();
      for (let i = 0; i < Math.max(N.w, N.h); i += step) {
        const x = view.panX + (i + 0.5) * s;
        if (i < N.w && x > MARGIN && x < W) ctx.fillText(G.colLabel(i), x, MARGIN / 2);
        const y = view.panY + (i + 0.5) * s;
        if (i < N.h && y > MARGIN && y < H) ctx.fillText(String(i + 1), MARGIN / 2, y);
      }
      ctx.fillStyle = colors().bg;
      ctx.fillRect(0, 0, MARGIN, MARGIN);
    }

    function draw() {
      const d = doc();
      if (!d || !canvas.isConnected) return;
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = G.CELL_PX * view.zoom;
      const N = dims();
      const known = missingSources();
      ctx.fillStyle = colors().bg;
      ctx.fillRect(0, 0, W, H);
      drawBackground(ctx, d.grid, s, N);

      const tokenCells = new Set(d.combatants.flatMap((t) => G.tokenCells(t)));
      if (d.grid.tileMap) drawGridMap(ctx, d.grid.tileMap, s, false, tokenCells, W, H);
      for (const z of d.grid.zones) drawZone(ctx, z, s, 1);
      const tokensOn = (e) => d.combatants.some((t) => {
        if (!t.pos) return false;
        const dm = G.tokenDims(t);
        return t.pos.x < e.x + e.w && t.pos.x + dm.w > e.x && t.pos.y < e.y + e.h && t.pos.y + dm.h > e.y;
      });
      const above = [];
      // Tilemap: livello Base sotto le pedine, livello Sopra dopo (semitrasparente se c'è una pedina sotto, se richiesto).
      const drawTilesOf = (e) => {
        drawPlacedTiles(ctx, e, s, false, false, W, H);
        above.push(e);
      };
      for (const st of d.grid.structures) {
        if (st.tiles) {
          drawTilesOf(st);
          continue;
        }
        const missing = isMissing(known.structures, st);
        drawShape(ctx, st, missing ? colors().missing : st.color, st.x, st.y, s, 1);
        if (missing) {
          const i = st.cells.indexOf('1');
          questionMark(ctx, view.panX + (st.x + (i % st.w) + 0.5) * s, view.panY + (st.y + Math.floor(i / st.w) + 0.5) * s, s);
        }
      }
      for (const it of d.grid.items) {
        ctx.save();
        if (it.hidden) ctx.globalAlpha = 0.5;
        if (it.tiles) {
          drawTilesOf(it);
        } else {
          const cx = view.panX + (it.x + 0.5) * s;
          const cy = view.panY + (it.y + 0.5) * s;
          if (isMissing(known.items, it)) {
            DnD.icone.drawIcon(ctx, { kind: 'shape', shape: 'cerchio', color: colors().missing }, cx, cy, s * 0.3);
            questionMark(ctx, cx, cy, s * 0.8);
          } else {
            if (it.otype === 'porta' && it.state === 'aperto') ctx.globalAlpha *= 0.45;
            DnD.icone.drawIcon(ctx, it.icon, cx, cy, s * 0.38, requestDraw);
          }
        }
        ctx.restore();
        drawObjectMarks(ctx, it, s);
      }

      // Linee della griglia (più marcate ogni 5 celle).
      for (const strong of [false, true]) {
        ctx.beginPath();
        for (let i = 0; i <= Math.max(N.w, N.h); i++) {
          if ((i % 5 === 0) !== strong) continue;
          const x = Math.round(view.panX + i * s) + 0.5;
          const y = Math.round(view.panY + i * s) + 0.5;
          if (i <= N.w && x >= 0 && x <= W) { ctx.moveTo(x, Math.max(0, view.panY)); ctx.lineTo(x, Math.min(H, view.panY + N.h * s)); }
          if (i <= N.h && y >= 0 && y <= H) { ctx.moveTo(Math.max(0, view.panX), y); ctx.lineTo(Math.min(W, view.panX + N.w * s), y); }
        }
        ctx.strokeStyle = strong ? colors().line5 : colors().line;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const l of d.grid.labels) drawLabel(ctx, l, s);
      if (opts.underlay) opts.underlay(ctx, view, s, W, H);

      // Pedine: prima quelle a terra, per ultima quella di turno.
      const tokens = d.combatants.filter((t) => t.pos)
        .sort((a, b) => (R.isDown(b) - R.isDown(a)) || ((a.id === d.currentId) - (b.id === d.currentId)));
      for (const t of tokens) {
        const moving = drag && drag.type === 'move' && drag.moved && drag.hit.kind === 'token' && drag.hit.id === t.id;
        drawToken(ctx, t, t.pos.x, t.pos.y, s, {
          current: t.id === d.currentId, selected: selection && selection.kind === 'token' && selection.id === t.id, ghost: moving,
        });
      }
      // Immagini "sopra le pedine" (tetti, rami): semitrasparenti se c'è una pedina sotto, se richiesto.
      for (const e of above) drawPlacedTiles(ctx, e, s, true, tokensOn(e), W, H);
      if (d.grid.tileMap) drawGridMap(ctx, d.grid.tileMap, s, true, tokenCells, W, H);

      if (selection && selection.kind !== 'token' && entity(selection)) {
        const p = entityPos(selection);
        const e = entity(selection);
        // Per le immagini si vede l'area intera, più marcate le celle selezionate dell'ingombro.
        if (e.tiles) outline(ctx, G.shapeFrom(e.w, e.h, () => true), p.x, p.y, s, colors().line5, true);
        outline(ctx, footprint(selection), p.x, p.y, s, colors().selected, true);
      }

      // Anteprime: trascinamento (verde = valida, rosso = bloccata), inserimento e rettangoli.
      const ghost = drag && drag.target && (drag.type === 'palette' || (drag.type === 'move' && drag.moved)) ? drag : null;
      if (ghost) drawShape(ctx, ghost.footprint, ghost.valid ? colors().ok : colors().bad, ghost.target.x, ghost.target.y, s, 1);
      if (hover && !drag) drawShape(ctx, hover.footprint, hover.valid ? colors().ok : colors().bad, hover.x, hover.y, s, 0.8);
      if (drag && drag.type === 'rect' && drag.b) {
        const r = G.rectBetween(drag.a, drag.b, d.grid);
        if (tool === 'riempi') drawShape(ctx, G.shapeFrom(r.w, r.h, () => true), colors().ok, r.x, r.y, s, 1);
        else drawZone(ctx, Object.assign({ kind: tool === 'zona-nemici' ? 'nemici' : 'giocatori' }, r), s, 0.8);
      }

      // Misuratore.
      if (measure) {
        const ax = view.panX + (measure.a.x + 0.5) * s;
        const ay = view.panY + (measure.a.y + 0.5) * s;
        const bx = view.panX + (measure.b.x + 0.5) * s;
        const by = view.panY + (measure.b.y + 0.5) * s;
        ctx.save();
        ctx.strokeStyle = colors().current;
        ctx.fillStyle = colors().current;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
        const label = G.formatDistance(G.cellDistance(measure.a, measure.b), feet());
        ctx.font = 'bold 12px system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = colors().labelBg;
        ctx.fillRect(bx + 8, by - 22, tw, 20);
        ctx.fillStyle = colors().current;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + 14, by - 12);
        ctx.restore();
      }

      // Anteprima e selezione degli strumenti delle tile.
      if (opts.painter) opts.painter.draw(ctx, view, s, W, H);
      // Sovrapposizioni di chi usa la griglia (es. anteprima del piano dell'IA nel combattimento).
      if (opts.overlay) opts.overlay(ctx, view, s);

      drawLabels(ctx, W, H, s);
    }

    // ---------- Puntatore sulla griglia ----------
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    const cellOf = (p) => G.screenToCell(view, p.sx, p.sy);
    const inGrid = (cell) => cell.x >= 0 && cell.y >= 0 && cell.x < dims().w && cell.y < dims().h;
    const clampCell = (c) => ({ x: Math.max(0, Math.min(dims().w - 1, c.x)), y: Math.max(0, Math.min(dims().h - 1, c.y)) });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      canvas.focus({ preventScroll: true });
      const p = local(e);
      const cell = cellOf(p);
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        e.preventDefault();
        drag = { type: 'pan', p0: p, view0: view, moved: true };
        return;
      }
      if (pick) {
        const hit = inGrid(cell) ? hitTest(cell, false) : null;
        if (hit && hit.kind === 'token') pick(hit.id);
        return;
      }
      if (painting()) {
        drag = { type: 'paint' };
        opts.painter.down(cell, e);
        return;
      }
      if (!inGrid(cell)) {
        drag = { type: 'pan', p0: p, view0: view, moved: false };
        return;
      }
      if (tool === 'misura') {
        measure = { a: cell, b: cell };
        drag = { type: 'measure' };
      } else if (tool === 'gomma') {
        drag = { type: 'erase', before: G.gridSnapshot(doc()), erased: eraseAt(cell) };
        changed();
      } else if (tool === 'riempi' || tool === 'zona-giocatori' || tool === 'zona-nemici') {
        drag = { type: 'rect', a: cell, b: cell };
      } else if (tool === 'struttura' || tool === 'oggetto' || tool === 'etichetta') {
        drag = { type: 'click-tool', p0: p, view0: view, cell, moved: false };
      } else {
        const hit = hitTest(cell);
        if (hit) {
          const at = entityPos(hit);
          drag = { type: 'move', hit, p0: p, off: { x: cell.x - at.x, y: cell.y - at.y }, start: at, footprint: footprint(hit), moved: false };
        } else {
          drag = { type: 'pan', p0: p, view0: view, moved: false };
        }
      }
      updateUi();
      requestDraw();
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      const cell = cellOf(p);
      if (painting() && (!drag || drag.type === 'paint')) {
        opts.painter.move(cell, e, Boolean(drag));
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (!drag) {
        const fp = insertFootprint();
        if (fp && inGrid(cell)) {
          const x = cell.x - Math.floor(fp.w / 2);
          const y = cell.y - Math.floor(fp.h / 2);
          hover = { footprint: fp, x, y, valid: canInsertAt(fp, x, y) };
          requestDraw();
        } else if (hover) {
          hover = null;
          requestDraw();
        }
        canvas.style.cursor = pick || tool !== 'seleziona' ? 'crosshair' : inGrid(cell) && hitTest(cell) ? 'grab' : 'default';
        return;
      }
      const far = drag.p0 && Math.hypot(p.sx - drag.p0.sx, p.sy - drag.p0.sy) >= DRAG_THRESHOLD;
      if (drag.type === 'pan' || drag.type === 'click-tool') {
        if (!drag.moved && !far) return;
        drag.moved = true;
        canvas.style.cursor = 'grabbing';
        view = { zoom: drag.view0.zoom, panX: drag.view0.panX + p.sx - drag.p0.sx, panY: drag.view0.panY + p.sy - drag.p0.sy };
      } else if (drag.type === 'measure') {
        measure.b = clampCell(cell);
        updateUi();
      } else if (drag.type === 'rect') {
        drag.b = clampCell(cell);
      } else if (drag.type === 'erase') {
        if (inGrid(cell) && eraseAt(cell)) { drag.erased = true; changed(); }
      } else if (drag.type === 'move') {
        if (!drag.moved && !far) return;
        drag.moved = true;
        canvas.style.cursor = 'grabbing';
        drag.target = { x: cell.x - drag.off.x, y: cell.y - drag.off.y };
        drag.valid = isValidAt(drag.hit, drag.target.x, drag.target.y);
      }
      requestDraw();
    });

    canvas.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      canvas.style.cursor = 'default';
      if (!d) return;
      if (d.type === 'paint') {
        opts.painter.up(cellOf(local(e)), e);
        return;
      }
      if (d.type === 'move') {
        if (d.moved) {
          const t = d.target;
          if (d.valid && (t.x !== d.start.x || t.y !== d.start.y)) {
            commit(() => {
              const ent = entity(d.hit);
              if (d.hit.kind === 'token') ent.pos = { x: t.x, y: t.y };
              else Object.assign(ent, t);
            });
          } else if (!d.valid) {
            toast(d.hit.kind === 'token' ? 'Posizione bloccata da un\'altra pedina o da una struttura.' : 'Posizione non valida.', 'error');
          }
          select(d.hit);
        } else {
          const key = d.hit.kind + ':' + d.hit.id;
          const now = performance.now();
          select(d.hit);
          if (lastClick.key === key && now - lastClick.time < DOUBLE_CLICK_MS && (d.hit.kind === 'token' || (d.hit.kind === 'item' && opts.onObject))) {
            lastClick = { key: null, time: 0 };
            if (d.hit.kind === 'token') openMenu(e.clientX, e.clientY, tokenActions(d.hit.id));
            else opts.onObject(d.hit.id);
          } else {
            lastClick = { key, time: now };
          }
        }
      } else if (d.type === 'pan' && !d.moved) {
        select(null);
      } else if (d.type === 'click-tool' && !d.moved) {
        if (tool === 'etichetta') labelAt(d.cell);
        else insertAt(d.cell);
      } else if (d.type === 'rect') {
        finishRect(G.rectBetween(d.a, d.b, doc().grid));
      } else if (d.type === 'erase' && d.erased) {
        history.push(d.before);
        changed();
      }
      requestDraw();
    });

    canvas.addEventListener('pointercancel', (e) => {
      if (drag && drag.type === 'paint') opts.painter.up(cellOf(local(e)), e);
      drag = null;
      requestDraw();
    });
    canvas.addEventListener('pointerleave', () => {
      if (hover) { hover = null; requestDraw(); }
      if (opts.painter && !drag) opts.painter.move(null);
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const cell = cellOf(local(e));
      const hit = inGrid(cell) ? hitTest(cell) : null;
      if (!hit) return;
      select(hit);
      openMenu(e.clientX, e.clientY, actionsFor(hit));
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      view = G.zoomAt(view, p.sx, p.sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      requestDraw();
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      if (!canvas.isConnected || document.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.altKey && k === 'b') { e.preventDefault(); getPaletteToggle().toggle(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' && selection) { e.preventDefault(); removeEntity(selection); }
      else if (e.key === 'Escape') {
        if (pick) finishPick(null);
        else if (tool !== 'seleziona') setTool('seleziona');
        else if (selection) select(null);
      }
    });

    // ---------- Pannello laterale: trascinamento e scelta dei modelli ----------
    function startPaletteDrag(e, spec) {
      if (e.button !== 0 || pick) return;
      if (e.pointerType === 'mouse') e.preventDefault();
      const item = e.currentTarget;
      item.setPointerCapture(e.pointerId);
      const ghostEl = el('div', { class: 'drag-ghost', text: spec.name });
      drag = { type: 'palette', spec, footprint: spec.footprint, target: null, valid: false };
      let shown = false;
      const start = { x: e.clientX, y: e.clientY };
      const move = (ev) => {
        if (!shown && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        if (!shown) { document.body.appendChild(ghostEl); shown = true; }
        ghostEl.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 12) + 'px)';
        const r = canvas.getBoundingClientRect();
        const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        if (inside) {
          const cell = G.screenToCell(view, ev.clientX - r.left, ev.clientY - r.top);
          drag.target = { x: cell.x - Math.floor(spec.footprint.w / 2), y: cell.y - Math.floor(spec.footprint.h / 2) };
          drag.valid = spec.isValid(drag.target.x, drag.target.y);
        } else {
          drag.target = null;
        }
        requestDraw();
      };
      const end = (ev) => {
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', end);
        item.removeEventListener('pointercancel', end);
        ghostEl.remove();
        const d = drag;
        drag = null;
        if (ev.type === 'pointerup' && d && d.target) {
          if (d.valid) spec.place(d.target);
          else toast('Posizione non valida: lo spazio è occupato o fuori dalla griglia.', 'error');
        } else if (ev.type === 'pointerup' && !shown && spec.onClick) {
          spec.onClick();
        }
        requestDraw();
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', end);
      item.addEventListener('pointercancel', end);
    }

    function paletteEntry(preview, name, spec, extraClass) {
      spec.name = name;
      return el('li', {
        class: 'palette-item' + (extraClass ? ' ' + extraClass : ''), title: 'Trascina sulla griglia' + (spec.chooseHint ? ' o clicca per sceglierlo' : ''),
        onpointerdown: (e) => startPaletteDrag(e, spec),
      }, el('span', { class: 'palette-icon' }, preview), el('span', { class: 'palette-name', text: name }));
    }

    const canInsert = (kind) => opts.tools.includes(kind === 'structure' ? 'struttura' : 'oggetto');
    function chooseTemplate(kind, id) {
      template = { kind, id };
      if (kind === 'structure' && tool !== 'riempi') setTool('struttura');
      else if (kind !== 'structure') setTool('oggetto');
      else refreshPalette();
    }

    function refreshPalette() {
      const d = doc();
      if (!d) return;
      const st = DnD.store.state;
      const group = (title, entries, empty, open) => el('details', { class: 'palette-group', open: open !== false },
        el('summary', { text: title }),
        entries.length ? el('ul', {}, entries) : el('p', { class: 'muted small', text: empty }));
      const chosen = (kind, id) => (template && template.kind === kind && template.id === id ? 'chosen' : '');
      clear(palette).append(...[
        opts.showCombatants ? group('Combattenti', R.sortByInitiative(d.combatants).map((t) => paletteEntry(
          DnD.icone.iconCanvas(t.icon, 22), t.name,
          {
            footprint: G.tokenShape(t),
            isValid: (x, y) => G.canPlaceToken(board(), t.id, x, y),
            place: (p) => { commit((dd) => { dd.combatants.find((x) => x.id === t.id).pos = p; }); select({ kind: 'token', id: t.id }); },
            onClick: t.pos ? () => select({ kind: 'token', id: t.id }) : null,
          }, t.pos ? 'placed' : 'unplaced')), 'Nessun combattente.') : null,
        group('Strutture', st.structures.map((tpl) => paletteEntry(
          DnD.uiTileset.templatePreview(tpl, 'structure', 22), tpl.name,
          {
            footprint: G.templateShape(tpl),
            isValid: (x, y) => G.canPlaceStructure(board(), G.templateShape(tpl), x, y),
            place: (p) => select({ kind: 'structure', id: placeStructure(tpl, p).id }),
            onClick: canInsert('structure') ? () => chooseTemplate('structure', tpl.id) : null,
            chooseHint: canInsert('structure'),
          }, chosen('structure', tpl.id))), 'Crea strutture in Asset › Strutture.'),
        group('Oggetti di mappa', st.mapObjects.map((tpl) => paletteEntry(
          DnD.uiTileset.templatePreview(tpl, 'item', 22), tpl.name,
          {
            footprint: G.templateShape(tpl, 'item'),
            isValid: (x, y) => G.canPlaceItem(board(), G.templateShape(tpl, 'item'), G.objectBlocks(tpl), x, y),
            place: (p) => select({ kind: 'item', id: placeItem(tpl, p).id }),
            onClick: canInsert('item') ? () => chooseTemplate('item', tpl.id) : null,
            chooseHint: canInsert('item'),
          }, chosen('item', tpl.id))), 'Crea oggetti di mappa in Asset › Oggetti.'),
        group('Attrezzatura (a terra)', st.equipment.map((eq) => paletteEntry(
          DnD.icone.iconCanvas(eq.icon, 22), eq.name,
          {
            footprint: G.squareShape(1),
            isValid: (x, y) => G.canPlaceItem(board(), G.squareShape(1), false, x, y),
            place: (p) => select({ kind: 'item', id: placeGround(eq, p).id }),
            onClick: canInsert('item') ? () => chooseTemplate('equipment', eq.id) : null,
            chooseHint: canInsert('item'),
          }, chosen('equipment', eq.id))), 'Il catalogo è in Asset › Oggetti › Attrezzatura.', false),
      ].filter(Boolean));
    }

    // ---------- Barra di stato ----------
    function updateUi() {
      const d = doc();
      if (!d) return;
      undoBtn.disabled = opts.canUndo ? !opts.canUndo() : !history.canUndo();
      redoBtn.disabled = opts.canRedo ? !opts.canRedo() : !history.canRedo();
      ignoreBox.checked = d.grid.ignoreCollisions;
      const known = missingSources();
      const imageMissing = (e) => e.tiles && DnD.uiTileset.missingTilesets(e.tiles, () => updateUi());
      const missing = d.grid.structures.filter((s) => isMissing(known.structures, s)).length + d.grid.items.filter((i) => isMissing(known.items, i)).length;
      const missingImages = d.grid.structures.filter(imageMissing).length + d.grid.items.filter(imageMissing).length +
        (d.grid.tileMap && DnD.uiTileset.missingTilesets(d.grid.tileMap, () => updateUi()) ? 1 : 0);
      const cur = d.combatants.find((x) => x.id === d.currentId);
      let text;
      if (measure) {
        // Mappe di esplorazione: distanza nella scala della mappa (km, miglia…).
        const g = doc().grid;
        text = '📏 ' + G.cellLabel(measure.a.x, measure.a.y) + ' → ' + G.cellLabel(measure.b.x, measure.b.y) + ': ' +
          (g.kind === 'esplorazione' ? DnD.esplorazione.formatDistance(G.cellDistance(measure.a, measure.b), g.scale) : G.formatDistance(G.cellDistance(measure.a, measure.b), feet()));
      } else if (painting()) {
        text = opts.painter.hint();
      } else if (tool !== 'seleziona') {
        const t = templateEntity();
        text = TOOL_HINTS[tool] + (t && (tool === 'struttura' || tool === 'oggetto' || tool === 'riempi') ? ' Scelto: ' + t.name + '.' : '');
      } else if (cur) {
        text = 'Turno di ' + cur.name + ' · velocità ' + G.formatSpeed(cur.speed);
      } else {
        const g = doc().grid;
        text = g.kind === 'esplorazione' ? 'Mappa di esplorazione ' + dims().w + '×' + dims().h + ' · ' + DnD.esplorazione.scaleLabel(g.scale)
          : 'Griglia ' + dims().w + '×' + dims().h + ' · ogni casella = ' + feet() + ' ft (' + String(Math.round(feet() * 30) / 100).replace('.', ',') + ' m)';
      }
      info.textContent = text + (missing ? ' · ⚠ ' + missing + (missing === 1 ? ' elemento proviene' : ' elementi provengono') + ' da strutture/oggetti eliminati' : '') +
        (missingImages ? ' · ⚠ ' + missingImages + (missingImages === 1 ? ' elemento (o la TileMap) con tile mancanti' : ' elementi con tile mancanti') + ' (segnaposto grigio)' : '');
      const ent = entity(selection);
      clear(selBar);
      if (ent) {
        selBar.append(el('span', { class: 'muted small', text: entityName(selection) + ':' }),
          ...actionsFor(selection).map((a) => el('button', {
            type: 'button', class: 'btn small' + (a.danger ? ' danger' : ''), text: a.text, disabled: a.disabled, onclick: a.onclick,
          })));
      }
    }

    // ---------- Scelta dei bersagli dalla griglia ----------
    // cb(id) viene chiamata a ogni pedina cliccata; cb(null) quando si chiude (Fine o Esc).
    function pickTarget(cb, multiple) {
      pick = (id) => { cb(id); if (!multiple) finishPick(undefined); };
      pick.done = cb;
      banner.firstChild.textContent = multiple ? '🎯 Clicca le pedine dei bersagli, poi «Fine»' : '🎯 Clicca la pedina del bersaglio';
      banner.lastChild.textContent = multiple ? 'Fine' : 'Annulla';
      banner.hidden = false;
      canvas.style.cursor = 'crosshair';
      node.scrollIntoView({ behavior: DnD.ui.scrollBehavior(), block: 'nearest' });
    }
    function finishPick(value) {
      const p = pick;
      pick = null;
      banner.hidden = true;
      if (p && value !== undefined) p.done(value);
    }

    // ---------- API ----------
    function refresh() {
      const d = doc();
      if (!d) return;
      if (d.id !== docId) {
        docId = d.id;
        history.clear();
        view = defaultView();
        selection = null;
        measure = null;
        if (tool !== 'seleziona') setTool('seleziona');
      }
      if (selection && !entity(selection)) selection = null;
      refreshPalette();
      updateUi();
      requestDraw();
    }

    function setSelectedCombatant(id) {
      selection = id && entity({ kind: 'token', id }) ? { kind: 'token', id } : null;
      updateUi();
      requestDraw();
    }

    // ---------- Pittura delle tile (pannello Tile): stessa cronologia degli altri strumenti ----------
    // Il pennello modifica la TileMap in memoria a ogni cella; alla fine del tratto si salva una volta
    // e il tratto diventa un'azione annullabile.
    function tileSnapshot() { return G.gridSnapshot(doc()); }
    function commitTiles(before) {
      opts.update(() => {});
      history.push(before);
      changed();
    }

    setTool('seleziona');
    return {
      node, refresh, setSelectedCombatant, pickTarget, requestDraw, tileSnapshot, commitTiles, undo, redo,
      view: () => view,
      setTool: (t) => setTool(t),
      hasTokens: () => doc().combatants.some((x) => x.pos),
      canUndo: () => history.canUndo(),
      updateUi: () => updateUi(),
    };
  }

  // Miniatura di una griglia (TileMap, zone, strutture, oggetti) per gli elenchi; si ridisegna
  // quando le immagini delle tile finiscono di caricarsi.
  function gridThumbnail(grid, px) {
    const canvas = el('canvas', { class: 'grid-thumb', width: px, height: px, 'aria-hidden': 'true' });
    const ctx = canvas.getContext('2d');
    let queued = false;
    const repaint = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paintThumbnail(ctx, grid, px, repaint); }); } };
    paintThumbnail(ctx, grid, px, repaint);
    return canvas;
  }
  function paintThumbnail(ctx, grid, px, onReady) {
    const N = G.dims(grid);
    const c = px / Math.max(N.w, N.h);
    const known = missingSources();
    ctx.fillStyle = colors().bg;
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = grid.background && grid.background.kind === 'colore' ? grid.background.color : colors().board;
    ctx.fillRect(0, 0, N.w * c, N.h * c);
    if (grid.background && grid.background.kind === 'immagine' && DnD.immagini) {
      const res = DnD.immagini.drawable(grid.background.imageId, onReady);
      if (res.state === 'ok') {
        const r = G.backgroundRect(grid.background, res.img.width || res.img.naturalWidth, res.img.height || res.img.naturalHeight, N.w, N.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, N.w * c, N.h * c);
        ctx.clip();
        ctx.globalAlpha = grid.background.opacity;
        ctx.drawImage(res.img, r.x * c, r.y * c, r.w * c, r.h * c);
        ctx.restore();
      }
    }
    if (grid.tileMap) DnD.uiTileset.drawTiles(ctx, grid.tileMap, 0, 0, c, { onReady });
    // Mappe di esplorazione: i biomi nella miniatura.
    if (grid.kind === 'esplorazione' && grid.biomeMap && DnD.uiMappaEsplorazione) DnD.uiMappaEsplorazione.drawBiomes(ctx, { panX: 0, panY: 0 }, c, Object.assign({}, grid, { biomeMap: Object.assign({}, grid.biomeMap, { overlay: { visible: true, opacity: 0.85 } }) }), px, px);
    for (const z of grid.zones) {
      const [r, g, b] = colors().zone[z.kind];
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.35)';
      ctx.fillRect(z.x * c, z.y * c, z.w * c, z.h * c);
    }
    for (const s of grid.structures) {
      ctx.fillStyle = isMissing(known.structures, s) ? colors().missing : s.color;
      for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) if (G.isFilled(s, i, j)) ctx.fillRect((s.x + i) * c, (s.y + j) * c, c, c);
    }
    for (const it of grid.items) {
      ctx.fillStyle = isMissing(known.items, it) ? colors().missing : it.icon.color;
      ctx.fillRect(it.x * c, it.y * c, Math.max(2, c), Math.max(2, c));
    }
    for (const l of grid.labels) {
      ctx.fillStyle = colors().current;
      ctx.fillRect(l.x * c, l.y * c, Math.max(2, c), Math.max(2, c));
    }
  }

  function formatDate(iso) {
    if (!iso) return 'data sconosciuta';
    return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Elenco delle griglie salvate: carica (se onLoad), rinomina, duplica ed elimina.
  // onLoad(griglia) restituisce false per non chiudere la finestra.
  function savedGridsDialog(onLoad) {
    const body = el('div', { class: 'saved-grids' });
    let dialog = null;
    function renderList() {
      const grids = DnD.sessioni.visible(DnD.store.state, 'savedGrids');
      clear(body).append(grids.length
        ? el('ul', { class: 'saved-grid-list' }, grids.map((g) => el('li', {},
          gridThumbnail(g, 60),
          el('div', { class: 'saved-grid-info' },
            el('b', { text: g.name }),
            el('div', { class: 'muted small', text: g.w + '×' + g.h + ' · ' + g.structures.length + ' strutture · ' + g.items.length + ' oggetti · ' + g.positions.length + ' posizioni' + (g.tileMap ? ' · TileMap' : '') }),
            el('div', { class: 'muted small', text: 'Modificata: ' + formatDate(g.updatedAt) })),
          el('div', { class: 'head-actions' },
            onLoad ? el('button', { type: 'button', class: 'btn small primary', text: 'Carica', onclick: () => { if (onLoad(g) !== false && dialog) dialog.dismiss(); } }) : null,
            el('button', { type: 'button', class: 'btn small', text: 'Rinomina', onclick: () => renameGrid(g, renderList) }),
            el('button', { type: 'button', class: 'btn small', text: 'Duplica', onclick: () => { duplicateGrid(g); renderList(); } }),
            el('button', { type: 'button', class: 'btn small danger', text: 'Elimina', onclick: () => { if (deleteGrid(g)) renderList(); } })))))
        : el('p', { class: 'empty', text: 'Nessuna griglia salvata. Creane una nell\'Editor griglie o con «Salva come nuova griglia» durante un combattimento.' }));
    }
    renderList();
    dialog = openDialog('Griglie salvate', body, [{ text: 'Chiudi' }]);
  }

  // Operazioni sulle griglie salvate, condivise da editor e combattimento.
  // I nomi devono essere unici tra le griglie visibili nella sessione corrente.
  const nameTaken = (name, exceptId) => DnD.sessioni.visible(DnD.store.state, 'savedGrids')
    .some((g) => g.id !== exceptId && g.name.toLowerCase() === name.toLowerCase());
  function renameGrid(g, after) {
    promptText('Rinomina griglia', 'Nuovo nome', g.name, (name) => {
      if (nameTaken(name, g.id)) return 'Esiste già una griglia con questo nome.';
      DnD.store.update(() => { g.name = name; g.updatedAt = new Date().toISOString(); });
      after();
      return null;
    });
  }
  function duplicateGrid(g) {
    let name = (g.name + ' (copia)').slice(0, 60);
    for (let n = 2; nameTaken(name); n++) name = (g.name + ' (copia ' + n + ')').slice(0, 60);
    const copy = Object.assign(JSON.parse(JSON.stringify(g)), {
      id: DnD.dadi.uid(), name, updatedAt: new Date().toISOString(), sessionId: DnD.sessioni.current(DnD.store.state).id, shared: false,
    });
    DnD.store.update((st) => { st.savedGrids.splice(st.savedGrids.indexOf(g) + 1, 0, copy); });
    return copy;
  }
  function deleteGrid(g) {
    if (!confirm('Eliminare la griglia "' + g.name + '"?' + (g.shared ? '\nÈ condivisa: sparirà da tutte le sessioni.' : ''))) return false;
    DnD.store.update((st) => { st.savedGrids = st.savedGrids.filter((x) => x.id !== g.id); });
    return true;
  }

  DnD.uiGriglia = { create, savedGridsDialog, gridThumbnail, formatDate, renameGrid, duplicateGrid, deleteGrid, nameTaken };
})(globalThis.DnD = globalThis.DnD || {});
