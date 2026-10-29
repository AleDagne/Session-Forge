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
  const { MARGIN, DOUBLE_CLICK_MS, DRAG_THRESHOLD } = DnD.uiGrigliaDisegno;
  const HISTORY_LIMIT = 50;
  // Colori del canvas (cache e ridisegno al cambio tema): in ui-griglia-disegno.js.
  const { colors, redrawers } = DnD.uiGrigliaDisegno;
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
  //   vision: livello di luce e nebbia (ui-visione.js): draw(ctx, view, s) sopra pedine e tile, hideToken(t) e
  //     hideItem(it) per l'anteprima «Vedi come»
  //   undo(), redo(), canUndo(), canRedo(): annulla/ripeti gestiti da chi usa la griglia (esplorazione)
  //   movement: { begin(combatantId) -> null (movimento libero) | { route(target) -> { path, cost, end, stopped,
  //     label }, normal: Set, dash: Set (chiavi delle celle raggiungibili) }, apply(doc, combatantId, route) }
  //     limiti di velocità nel combattimento (movimento.js): anteprima, costo e fermata all'ultima cella raggiungibile
  //   turnInfo(combattente): testo della barra del turno (velocità e movimento residuo)
  //   readOnly: sola vista (giocatore online): zoom, spostamento della vista, selezione e misuratore, nessuna modifica;
  //     con canDrag(id) e movement si trascina la propria pedina: movement.apply(null, id, percorso) manda la richiesta
  //   tilesets() -> indice dei TileSet da usare al posto della libreria (le definizioni ricevute dal master)
  // }
  function create(opts) {
    const onSelect = opts.onSelect || (() => {});
    const tokenActions = opts.tokenActions || (() => []);
    // Stato condiviso del componente (vista, strumento, selezione, trascinamento…): un solo oggetto, così le parti
    // in altri file (pannello laterale, puntatore) lo leggono e lo modificano come il resto della griglia.
    const S = {
      view: defaultView(),
      tool: 'seleziona',
      template: null, // { kind: 'structure' | 'item' | 'equipment', id } per gli strumenti di inserimento
      selection: null, // { kind: 'token' | 'item' | 'structure' | 'label' | 'zone', id }
      measure: null, // { a, b } celle
      drag: null,
      hover: null, // anteprima degli strumenti di inserimento
      pick: null, // callback della scelta del bersaglio
      docId: null,
      lastClick: { key: null, time: 0 },
    };
    let raf = 0;
    const history = G.createHistory(HISTORY_LIMIT);

    const doc = () => opts.getDoc();
    // Collisioni: strutture, oggetti e TileMap della griglia (tile bloccanti e poligoni di collisione).
    const tsIndex = () => (opts.tilesets ? opts.tilesets() : DnD.tilemap.tilesetIndex(DnD.store.state.tilesets));
    const ro = Boolean(opts.readOnly);
    const board = () => {
      const d = doc();
      return G.boardOf(d.grid, d.combatants, tsIndex());
    };
    const feet = () => (doc() ? doc().grid.feetPerCell || 5 : 5);
    // Misuratore con la regola delle diagonali (le mappe di esplorazione restano con la loro scala).
    const measureCells = (a, b) => (doc().grid.kind === 'esplorazione' ? G.cellDistance(a, b) : DnD.movimento.distance(a, b, DnD.impostazioni.movementRules()));
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
    const toolBar = el('div', { class: 'S.tool-group', role: 'toolbar', 'aria-label': 'Strumenti' }, opts.tools.map((t) => {
      toolButtons[t] = el('button', { type: 'button', class: 'btn small S.tool', text: TOOLS[t], 'aria-pressed': 'false', onclick: () => {
        // Uno strumento della griglia disattiva quelli delle tile.
        if (opts.painter && opts.painter.active()) opts.painter.deactivate();
        setTool(S.tool === t && t !== 'seleziona' ? 'seleziona' : t);
      } });
      return toolButtons[t];
    }));
    const undoBtn = btn('↶', 'Annulla (Ctrl+Z)', () => undo());
    const redoBtn = btn('↷', 'Ripeti (Ctrl+Y)', () => redo());
    const ignoreBox = el('input', { type: 'checkbox', onchange: (e) => { opts.update((d) => { d.grid.ignoreCollisions = e.target.checked; }); } });
    const paletteBtn = btn('◧', 'Pannello laterale (Ctrl+Alt+B)', () => getPaletteToggle().toggle());
    paletteBtn.setAttribute('aria-controls', palette.id);
    const toolbar = el('div', { class: 'grid-toolbar' },
      ro ? null : paletteBtn,
      btn('⟲ Reimposta vista', 'Reimposta vista', () => { S.view = defaultView(); requestDraw(); }),
      toolBar,
      ro ? null : el('label', { class: 'check small' }, ignoreBox, ' Ignora collisioni'),
      ro ? null : undoBtn, ro ? null : redoBtn,
      opts.toolbar || []);
    const body = el('div', { class: 'grid-body' + (ro ? ' palette-collapsed' : '') }, ro ? null : palette, wrap);
    if (!ro) {
      paletteBodies.add(body);
      body.classList.toggle('palette-collapsed', getPaletteToggle().collapsed());
    }
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
      if (S.selection && !entity(S.selection)) S.selection = null;
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
      S.selection = hit;
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
      if (S.selection && S.selection.id === hit.id) select(null);
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
      if (!S.template) return null;
      const st = DnD.store.state;
      const list = S.template.kind === 'structure' ? st.structures : S.template.kind === 'equipment' ? st.equipment : st.mapObjects;
      return list.find((x) => x.id === S.template.id) || null;
    }
    function insertFootprint() {
      const t = templateEntity();
      if (S.tool === 'struttura' && t && S.template.kind === 'structure') return G.templateShape(t);
      if (S.tool === 'oggetto' && t && S.template.kind !== 'structure') return S.template.kind === 'equipment' ? G.squareShape(1) : G.templateShape(t, 'item');
      return null;
    }
    function placeStructure(tpl, p) {
      const placed = DnD.dati.normalizePlacedStructure(Object.assign({ id: DnD.dadi.uid(), sourceId: tpl.id, name: tpl.name, color: tpl.color, blocksSight: tpl.blocksSight, light: tpl.light },
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
    // Copia di un NPC del Mondo: stato proprio (PF, merce, atteggiamento), ingombro dalla scheda.
    function placeNpc(npc, p) {
      const placed = DnD.dati.normalizePlacedItem(Object.assign(DnD.npc.placedItem(npc, DnD.dadi.uid(), p.x, p.y), p), dims());
      commit((d) => d.grid.items.push(placed));
      return placed;
    }
    // Oggetto dell'Attrezzatura posato "a terra": un oggetto di mappa che lo contiene.
    function placeGround(eq, p) {
      const placed = DnD.dati.normalizePlacedItem(Object.assign(DnD.oggettiMappa.groundItem(eq, DnD.dadi.uid()), G.squareShape(1), p), dims());
      commit((d) => d.grid.items.push(placed));
      return placed;
    }
    const blocksOf = (t) => (S.template && S.template.kind === 'equipment' ? false : G.objectBlocks(t));
    const canInsertAt = (fp, x, y) => (S.tool === 'struttura' ? G.canPlaceStructure(board(), fp, x, y) : G.canPlaceItem(board(), fp, blocksOf(templateEntity()), x, y));
    function insertAt(cell) {
      const t = templateEntity();
      if (!t || (S.tool === 'struttura') !== (S.template.kind === 'structure')) {
        toast(TOOL_HINTS[S.tool], 'error');
        return;
      }
      const fp = insertFootprint();
      const p = { x: cell.x - Math.floor(fp.w / 2), y: cell.y - Math.floor(fp.h / 2) };
      if (!canInsertAt(fp, p.x, p.y)) { toast('Posizione non valida.', 'error'); return; }
      if (S.tool === 'struttura') select({ kind: 'structure', id: placeStructure(t, p).id });
      else if (S.template.kind === 'equipment') select({ kind: 'item', id: placeGround(t, p).id });
      else select({ kind: 'item', id: placeItem(t, p).id });
    }
    function finishRect(rect) {
      if (S.tool === 'riempi') {
        const t = templateEntity();
        if (!t || S.template.kind !== 'structure') { toast(TOOL_HINTS.riempi, 'error'); return; }
        const filled = G.shapeFrom(rect.w, rect.h, () => true);
        if (!G.canPlaceStructure(board(), filled, rect.x, rect.y)) { toast('L\'area coprirebbe una pedina.', 'error'); return; }
        select({ kind: 'structure', id: placeStructure(Object.assign({}, t, filled, { mode: 'custom', tiles: null }), rect).id });
        return;
      }
      const zone = DnD.dati.normalizeZone(Object.assign({ id: DnD.dadi.uid(), kind: S.tool === 'zona-nemici' ? 'nemici' : 'giocatori' }, rect), dims());
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
      S.tool = t;
      if (t !== 'misura') S.measure = null;
      S.hover = null;
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

    // Primitive di disegno (forme, pedine, zone, etichette, TileMap…): in ui-griglia-disegno.js.
    const { drawShape, outline, questionMark, drawPlacedTiles, drawGridMap, drawZone, drawLabel, drawToken, drawConditions, factionOf, drawNpcItem, drawObjectMarks, drawBackground, drawLabels, drawReach, drawRoute } = DnD.uiGrigliaDisegno.primitive({
      view: () => S.view, requestDraw: () => requestDraw(), tsIndex: () => tsIndex(), dims: () => dims(), wrap,
    });

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
      const s = G.CELL_PX * S.view.zoom;
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
          questionMark(ctx, S.view.panX + (st.x + (i % st.w) + 0.5) * s, S.view.panY + (st.y + Math.floor(i / st.w) + 0.5) * s, s);
        }
      }
      for (const it of d.grid.items) {
        if (opts.vision && opts.vision.hideItem(it)) continue;
        if (it.otype === 'npc') { drawNpcItem(ctx, it, s); continue; }
        ctx.save();
        if (it.hidden) ctx.globalAlpha = 0.5;
        if (it.tiles) {
          drawTilesOf(it);
        } else {
          const cx = S.view.panX + (it.x + 0.5) * s;
          const cy = S.view.panY + (it.y + 0.5) * s;
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
          const x = Math.round(S.view.panX + i * s) + 0.5;
          const y = Math.round(S.view.panY + i * s) + 0.5;
          if (i <= N.w && x >= 0 && x <= W) { ctx.moveTo(x, Math.max(0, S.view.panY)); ctx.lineTo(x, Math.min(H, S.view.panY + N.h * s)); }
          if (i <= N.h && y >= 0 && y <= H) { ctx.moveTo(Math.max(0, S.view.panX), y); ctx.lineTo(Math.min(W, S.view.panX + N.w * s), y); }
        }
        ctx.strokeStyle = strong ? colors().line5 : colors().line;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const l of d.grid.labels) drawLabel(ctx, l, s);
      if (opts.underlay) opts.underlay(ctx, S.view, s, W, H);
      if (S.drag && S.drag.type === 'move' && S.drag.moved && S.drag.mv) drawReach(ctx, S.drag.mv, s);

      // Pedine: prima quelle a terra, per ultima quella di turno.
      const tokens = d.combatants.filter((t) => t.pos && !(opts.vision && opts.vision.hideToken(t)))
        .sort((a, b) => (R.isDown(b) - R.isDown(a)) || ((a.id === d.currentId) - (b.id === d.currentId)));
      for (const t of tokens) {
        const moving = S.drag && S.drag.type === 'move' && S.drag.moved && S.drag.hit.kind === 'token' && S.drag.hit.id === t.id;
        drawToken(ctx, t, t.pos.x, t.pos.y, s, {
          current: t.id === d.currentId, selected: S.selection && S.selection.kind === 'token' && S.selection.id === t.id, ghost: moving,
        });
      }
      // Immagini "sopra le pedine" (tetti, rami): semitrasparenti se c'è una pedina sotto, se richiesto.
      for (const e of above) drawPlacedTiles(ctx, e, s, true, tokensOn(e), W, H);
      if (d.grid.tileMap) drawGridMap(ctx, d.grid.tileMap, s, true, tokenCells, W, H);
      // Luce, buio e nebbia di guerra: livello a parte, ricalcolato solo quando cambia qualcosa.
      if (opts.vision) opts.vision.draw(ctx, S.view, s, W, H);

      if (S.selection && S.selection.kind !== 'token' && entity(S.selection)) {
        const p = entityPos(S.selection);
        const e = entity(S.selection);
        // Per le immagini si vede l'area intera, più marcate le celle selezionate dell'ingombro.
        if (e.tiles) outline(ctx, G.shapeFrom(e.w, e.h, () => true), p.x, p.y, s, colors().line5, true);
        outline(ctx, footprint(S.selection), p.x, p.y, s, colors().selected, true);
      }

      // Anteprime: trascinamento (verde = valida, rosso = bloccata), inserimento e rettangoli.
      const ghost = S.drag && S.drag.target && (S.drag.type === 'palette' || (S.drag.type === 'move' && S.drag.moved)) ? S.drag : null;
      if (ghost && ghost.mv) drawRoute(ctx, ghost, s);
      else if (ghost) drawShape(ctx, ghost.footprint, ghost.valid ? colors().ok : colors().bad, ghost.target.x, ghost.target.y, s, 1);
      if (S.hover && !S.drag) drawShape(ctx, S.hover.footprint, S.hover.valid ? colors().ok : colors().bad, S.hover.x, S.hover.y, s, 0.8);
      if (S.drag && S.drag.type === 'rect' && S.drag.b) {
        const r = G.rectBetween(S.drag.a, S.drag.b, d.grid);
        if (S.tool === 'riempi') drawShape(ctx, G.shapeFrom(r.w, r.h, () => true), colors().ok, r.x, r.y, s, 1);
        else drawZone(ctx, Object.assign({ kind: S.tool === 'zona-nemici' ? 'nemici' : 'giocatori' }, r), s, 0.8);
      }

      // Misuratore.
      if (S.measure) {
        const ax = S.view.panX + (S.measure.a.x + 0.5) * s;
        const ay = S.view.panY + (S.measure.a.y + 0.5) * s;
        const bx = S.view.panX + (S.measure.b.x + 0.5) * s;
        const by = S.view.panY + (S.measure.b.y + 0.5) * s;
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
        const label = doc().grid.kind === 'esplorazione' ? DnD.esplorazione.formatDistance(G.cellDistance(S.measure.a, S.measure.b), doc().grid.scale) : G.formatDistance(measureCells(S.measure.a, S.measure.b), feet());
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
      if (opts.painter) opts.painter.draw(ctx, S.view, s, W, H);
      // Sovrapposizioni di chi usa la griglia (es. anteprima del piano dell'IA nel combattimento).
      if (opts.overlay) opts.overlay(ctx, S.view, s);

      drawLabels(ctx, W, H, s);
    }

    // Puntatore e tastiera (ui-griglia-puntatore.js): registra gli eventi sul canvas con ciò che gli serve della griglia.
    DnD.uiGrigliaPuntatore.puntatore({ S, getPaletteToggle, actionsFor, canInsertAt, canvas, changed, commit, dims, doc, entity, entityPos, eraseAt, finishPick, finishRect, footprint, history, hitTest, insertAt, insertFootprint, isValidAt, labelAt, opts, painting, redo, removeEntity, requestDraw, ro, select, setTool, tokenActions, undo, updateUi });

    // uiGrigliaPannello (ui-griglia-pannello.js): pannello riceve dalla griglia ciò che gli serve.
    const { refreshPalette } = DnD.uiGrigliaPannello.pannello({ S, opts, board, canvas, commit, doc, footprint, palette, placeGround, placeItem, placeNpc, placeStructure, requestDraw, ro, select, setTool });

    // ---------- Barra di stato ----------
    function updateUi() {
      const d = doc();
      if (!d) return;
      undoBtn.disabled = opts.canUndo ? !opts.canUndo() : !history.canUndo();
      redoBtn.disabled = opts.canRedo ? !opts.canRedo() : !history.canRedo();
      ignoreBox.checked = d.grid.ignoreCollisions;
      const known = missingSources();
      const imageMissing = (e) => e.tiles && DnD.uiTileset.missingTilesets(e.tiles, () => updateUi(), tsIndex());
      const missing = d.grid.structures.filter((s) => isMissing(known.structures, s)).length + d.grid.items.filter((i) => isMissing(known.items, i)).length;
      const missingImages = d.grid.structures.filter(imageMissing).length + d.grid.items.filter(imageMissing).length +
        (d.grid.tileMap && DnD.uiTileset.missingTilesets(d.grid.tileMap, () => updateUi(), tsIndex()) ? 1 : 0);
      const cur = d.combatants.find((x) => x.id === d.currentId);
      let text;
      if (S.measure) {
        // Mappe di esplorazione: distanza nella scala della mappa (km, miglia…).
        const g = doc().grid;
        text = '📏 ' + G.cellLabel(S.measure.a.x, S.measure.a.y) + ' → ' + G.cellLabel(S.measure.b.x, S.measure.b.y) + ': ' +
          (g.kind === 'esplorazione' ? DnD.esplorazione.formatDistance(G.cellDistance(S.measure.a, S.measure.b), g.scale) : G.formatDistance(measureCells(S.measure.a, S.measure.b), feet()));
      } else if (painting()) {
        text = opts.painter.hint();
      } else if (S.tool !== 'seleziona') {
        const t = templateEntity();
        text = TOOL_HINTS[S.tool] + (t && (S.tool === 'struttura' || S.tool === 'oggetto' || S.tool === 'riempi') ? ' Scelto: ' + t.name + '.' : '');
      } else if (cur) {
        text = 'Turno di ' + cur.name + (opts.turnInfo ? ' · ' + opts.turnInfo(cur) : '');
      } else {
        const g = doc().grid;
        text = g.kind === 'esplorazione' ? 'Mappa di esplorazione ' + dims().w + '×' + dims().h + ' · ' + DnD.esplorazione.scaleLabel(g.scale)
          : 'Griglia ' + dims().w + '×' + dims().h + ' · ogni casella = ' + feet() + ' ft (' + String(Math.round(feet() * 30) / 100).replace('.', ',') + ' m)';
      }
      info.textContent = text + (missing ? ' · ⚠ ' + missing + (missing === 1 ? ' elemento proviene' : ' elementi provengono') + ' da strutture/oggetti eliminati' : '') +
        (missingImages ? ' · ⚠ ' + missingImages + (missingImages === 1 ? ' elemento (o la TileMap) con tile mancanti' : ' elementi con tile mancanti') + ' (segnaposto grigio)' : '');
      const ent = entity(S.selection);
      clear(selBar);
      if (ent && ro) selBar.append(el('span', { class: 'muted small', text: entityName(S.selection) }));
      else if (ent) {
        selBar.append(el('span', { class: 'muted small', text: entityName(S.selection) + ':' }),
          ...actionsFor(S.selection).map((a) => el('button', {
            type: 'button', class: 'btn small' + (a.danger ? ' danger' : ''), text: a.text, disabled: a.disabled, onclick: a.onclick,
          })));
      }
    }

    // ---------- Scelta dei bersagli dalla griglia ----------
    // cb(id) viene chiamata a ogni pedina cliccata; cb(null) quando si chiude (Fine o Esc).
    function pickTarget(cb, multiple) {
      S.pick = (id) => { cb(id); if (!multiple) finishPick(undefined); };
      S.pick.done = cb;
      banner.firstChild.textContent = multiple ? '🎯 Clicca le pedine dei bersagli, poi «Fine»' : '🎯 Clicca la pedina del bersaglio';
      banner.lastChild.textContent = multiple ? 'Fine' : 'Annulla';
      banner.hidden = false;
      canvas.style.cursor = 'crosshair';
      node.scrollIntoView({ behavior: DnD.ui.scrollBehavior(), block: 'nearest' });
    }
    function finishPick(value) {
      const p = S.pick;
      S.pick = null;
      banner.hidden = true;
      if (p && value !== undefined) p.done(value);
    }

    // ---------- API ----------
    function refresh() {
      const d = doc();
      if (!d) return;
      if (d.id !== S.docId) {
        S.docId = d.id;
        history.clear();
        S.view = defaultView();
        S.selection = null;
        S.measure = null;
        if (S.tool !== 'seleziona') setTool('seleziona');
      }
      if (S.selection && !entity(S.selection)) S.selection = null;
      refreshPalette();
      updateUi();
      requestDraw();
    }

    function setSelectedCombatant(id) {
      S.selection = id && entity({ kind: 'token', id }) ? { kind: 'token', id } : null;
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
      view: () => S.view,
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
