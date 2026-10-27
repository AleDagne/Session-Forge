// Componente "Taglia immagine in tile" (interfaccia; la logica è in tile.js). Un solo componente, usato in
// Asset > Strutture ("Da immagine") e nel pannello Tile sotto la griglia dell'Editor griglie.
// - Immagine importata (PNG, JPEG, WebP) da pulsante, trascinamento o Ctrl+V: archiviata una volta in
//   IndexedDB, mai ridimensionata né alterata.
// - Unico controllo: la dimensione del tile, X e Y in pixel (preset o valore libero, anche non quadrati).
//   La griglia parte dall'angolo in alto a sinistra e copre tutta l'immagine; i tile di bordo parziali sono
//   segnalati. Cambiando X o Y di un TileSet già usato: "Applica a tutti", "Salva come nuovo tileset", "Annulla".
// - Anteprima con linee di taglio, numerazione facoltativa, zoom (rotella) e pan (tasto centrale, Spazio o ✋).
// - Strumenti: Seleziona (clic, Ctrl/Maiusc = aggiungi, trascina = rettangolo) con i flag Bloccante,
//   Vuoto/escluso e Terreno difficile; "Rileva tile vuoti" con soglia regolabile.
// - Modalità "struttura": strumento Includi (clic o trascinamento) e Seleziona tutto / Deseleziona / Inverti /
//   Rettangolo / Rileva dai pixel. Modalità "palette": strumento Timbro (un tile o un rettangolo di tile).
(function (DnD) {
  'use strict';

  const { el, clear, toast, openDialog, numberInput } = DnD.ui;
  const T = DnD.tileset;
  const TL = DnD.tile;
  const TM = DnD.tilemap;
  const UT = DnD.uiTileset;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const DIFFICULT = 'rgba(230,180,40,0.38)';
  const last = { tilesetId: null, numbers: false };

  const tilesets = () => DnD.store.state.tilesets.filter((t) => t.sources.length);
  const findTs = (id) => DnD.store.state.tilesets.find((t) => t.id === id) || null;

  // Le strutture "da immagine" di un TileSet si ricostruiscono dopo un cambio di dimensione: la selezione
  // resta sulle stesse coordinate (colonna, riga). Modifica st.
  function rebuildImageTemplates(st, ts, srcId, oldCols, oldRows) {
    const byId = TM.tilesetIndex(st.tilesets);
    const src = T.sourceOf(ts, srcId);
    for (const x of st.structures.concat(st.mapObjects)) {
      const t = x.tiles;
      if (!t || t.kind !== 'immagine' || t.tilesets[0] !== ts.id || t.source !== srcId) continue;
      const sel = TL.remapBits(t.sel && t.sel.length === oldCols * oldRows ? t.sel : '1'.repeat(oldCols * oldRows), oldCols, oldRows, src.cols, src.rows, '0');
      const layer = t.layers[1] && t.layers[1].data.some(Boolean) ? 'Sopra' : 'Base';
      let next = Object.assign(TM.imageTiles(ts, srcId, sel, { drawAll: t.drawAll, layer, fade: t.layers[1] && t.layers[1].fade }), { sel, ops: t.ops || [] });
      for (const op of next.ops) next = TM.transformTiles(next, op, byId);
      x.tiles = DnD.collisioni.withFootprint(next, byId, st.structures.includes(x) ? 'structure' : 'item');
      if (st.structures.includes(x)) Object.assign(x, { w: x.tiles.w, h: x.tiles.h, cells: x.tiles.cells });
    }
  }

  // opts: { mode: 'struttura' | 'palette', tilesetId, srcId, selection (struttura), container (trascina/incolla),
  //         onChange({ tilesetId, srcId, selection, stamp }), height }
  function cutter(opts) {
    const isStructure = opts.mode === 'struttura';
    let tsId = opts.tilesetId || last.tilesetId;
    let srcId = opts.srcId || 0;
    let selection = opts.selection || '';      // struttura: tile inclusi
    let picked = new Set();                     // tile selezionati (indici) per i flag o per il timbro
    let tool = isStructure ? 'includi' : 'timbro';
    let rectMode = false;
    let drag = null;
    let numbers = last.numbers;
    let alphaCache = null;

    const current = () => findTs(tsId);
    const source = () => { const ts = current(); return ts ? T.sourceOf(ts, srcId) : null; };
    const n = () => { const s = source(); return s ? s.cols * s.rows : 0; };

    // ---------- DOM ----------
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const tsSel = el('select', { 'aria-label': 'TileSet' });
    const srcSel = el('select', { 'aria-label': 'Immagine del TileSet' });
    const presetOpt = (v) => el('option', { value: String(v), text: v + ' px' });
    const wIn = numberInput('', { min: 1, max: TL.MAX_TILE, 'aria-label': 'Larghezza del tile (X) in pixel', class: 'tile-size-in' });
    const hIn = numberInput('', { min: 1, max: TL.MAX_TILE, 'aria-label': 'Altezza del tile (Y) in pixel', class: 'tile-size-in' });
    const wPre = el('select', { 'aria-label': 'Preset di X' }, el('option', { value: '', text: 'X…' }), TL.PRESETS.map(presetOpt));
    const hPre = el('select', { 'aria-label': 'Preset di Y' }, el('option', { value: '', text: 'Y…' }), TL.PRESETS.map(presetOpt));
    const gridInfo = el('span', { class: 'tile-grid-info', 'aria-live': 'polite' });
    const applyBtn = el('button', { type: 'button', class: 'btn small primary', text: 'Applica', title: 'Applica la nuova dimensione del tile' });
    const threshold = numberInput(5, { min: 0, max: 100, step: 1, 'aria-label': 'Soglia dei tile vuoti (%)', class: 'tile-size-in' });
    const numbersBox = el('input', { type: 'checkbox', checked: numbers });
    const status = el('div', { class: 'muted small', 'aria-live': 'polite' });
    const toolBtns = {};
    const toolList = isStructure ? [['includi', '✚ Includi/escludi'], ['seleziona', '⬚ Seleziona (flag)']] : [['timbro', '🖌 Timbro'], ['seleziona', '⬚ Seleziona (flag)']];
    const toolBar = el('div', { class: 'tool-group', role: 'toolbar', 'aria-label': 'Strumenti dei tile' }, toolList.map(([k, label]) => {
      toolBtns[k] = el('button', { type: 'button', class: 'btn small tool', text: label, onclick: () => setTool(k) });
      return toolBtns[k];
    }));
    const flagBtn = (flag, label) => el('button', { type: 'button', class: 'btn small', text: label, title: 'Attiva o disattiva «' + TL.FLAG_NAMES[flag] + '» sui tile selezionati', onclick: () => toggleFlag(flag) });
    const flagBar = el('div', { class: 'tool-group' },
      el('span', { class: 'muted small', text: 'Flag dei selezionati:' }),
      flagBtn('blocking', '⛔ Bloccante'), flagBtn('excluded', '▨ Vuoto/escluso'), flagBtn('difficult', '≋ Terreno difficile'));
    const selBar = isStructure ? el('div', { class: 'tool-group' },
      btn('Seleziona tutto', () => setSelection('1'.repeat(n()))),
      btn('Deseleziona', () => setSelection('0'.repeat(n()))),
      btn('Inverti', () => setSelection(TL.invertBits(selection))),
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', onchange: (e) => { rectMode = e.target.checked; } }), ' Rettangolo'),
      btn('Rileva dai pixel', () => { const ts = current(); if (ts) setSelection(TL.notExcluded(ts, source())); })) : null;
    function btn(text, onclick) { return el('button', { type: 'button', class: 'btn small', text, onclick }); }

    const vp = UT.viewport({
      label: 'Anteprima dei tile: clic per scegliere, rotella per lo zoom, tasto centrale o Spazio per spostare la vista',
      minZoom: 0.05, maxZoom: 24, draw, onDown, onMove, onUp,
    });
    vp.node.classList.add('tile-cutter-view');
    if (opts.height) vp.node.style.height = opts.height + 'px';

    const node = el('div', { class: 'tile-cutter' },
      el('div', { class: 'tile-cutter-row' },
        el('label', { class: 'field-label', text: 'TileSet' }), tsSel, srcSel,
        el('button', { type: 'button', class: 'btn small', text: '⬆ Importa immagine', onclick: () => file.click() }),
        el('span', { class: 'muted small', text: 'o trascina / incolla (Ctrl+V)' }), file),
      el('div', { class: 'tile-cutter-row' },
        el('span', { class: 'field-label', text: 'Dimensione del tile' }),
        el('label', { class: 'inline small' }, 'X', wIn, wPre), el('label', { class: 'inline small' }, 'Y', hIn, hPre), applyBtn, gridInfo),
      el('div', { class: 'tile-cutter-row' }, toolBar, flagBar),
      selBar ? el('div', { class: 'tile-cutter-row' }, selBar) : null,
      el('div', { class: 'tile-cutter-row' },
        btn('Rileva tile vuoti', () => detectEmpty()),
        el('label', { class: 'inline small' }, 'soglia', threshold, '%'),
        el('label', { class: 'check small' }, numbersBox, ' Numerazione'),
        btn('−', () => vp.zoomBy(1 / 1.25)), btn('+', () => vp.zoomBy(1.25)), btn('⤢ Adatta', () => fit())),
      vp.node, status);

    // ---------- Stato ----------
    function emit() {
      if (opts.onChange) opts.onChange({ tilesetId: tsId, srcId, selection, stamp: stamp() });
    }
    function setSelection(bits) {
      selection = bits;
      updateStatus();
      vp.requestDraw();
      emit();
    }
    function setTool(k) {
      tool = k;
      for (const [id, b] of Object.entries(toolBtns)) { b.classList.toggle('active', id === k); b.setAttribute('aria-pressed', String(id === k)); }
      updateStatus();
    }
    // Timbro della palette: { w, h, ids } dal rettangolo dei tile scelti (null se nessuno).
    function stamp() {
      const s = source();
      const ts = current();
      if (isStructure || !s || !picked.size) return null;
      const idx = [...picked];
      const xs = idx.map((i) => i % s.cols);
      const ys = idx.map((i) => Math.floor(i / s.cols));
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const w = Math.max(...xs) - x0 + 1;
      const h = Math.max(...ys) - y0 + 1;
      const ids = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y0 + y) * s.cols + x0 + x;
          const id = T.tileId(s.id, x0 + x, y0 + y);
          ids.push(picked.has(i) && !T.isExcluded(ts, id) ? id : null);
        }
      }
      return ids.some((x) => x !== null) ? { tilesetId: ts.id, w, h, ids } : null;
    }

    function fillSelects() {
      const list = tilesets();
      if (!list.some((t) => t.id === tsId)) tsId = list.length ? list[0].id : null;
      clear(tsSel).append(...(list.length ? list.map((t) => el('option', { value: t.id, text: t.name, selected: t.id === tsId }))
        : [el('option', { value: '', text: 'Nessun TileSet: importa un\'immagine' })]));
      const ts = current();
      if (ts && !T.sourceOf(ts, srcId)) srcId = ts.sources[0].id;
      clear(srcSel).append(...(ts ? ts.sources.map((s) => el('option', { value: String(s.id), text: s.name, selected: s.id === srcId })) : []));
      srcSel.hidden = !ts || ts.sources.length < 2;
      const s = source();
      wIn.value = s ? String(Math.round(s.tileW)) : '';
      hIn.value = s ? String(Math.round(s.tileH)) : '';
      if (isStructure && s && selection.length !== s.cols * s.rows) selection = TL.notExcluded(ts, s);
      updateGridInfo();
    }
    function updateGridInfo() {
      const s = source();
      const tw = Number(wIn.value);
      const th = Number(hIn.value);
      if (!s) { gridInfo.textContent = ''; applyBtn.disabled = true; return; }
      if (!TL.validSize(tw) || !TL.validSize(th)) { gridInfo.textContent = '⚠ X e Y: interi tra 1 e ' + TL.MAX_TILE; applyBtn.disabled = true; return; }
      const g = TL.grid(s.imageW, s.imageH, tw, th);
      const changed = tw !== s.tileW || th !== s.tileH || !s.cover;
      applyBtn.disabled = !changed;
      gridInfo.textContent = TL.gridText(g) + (g.partialCols || g.partialRows ? ' · bordi parziali' : '') + (changed ? ' (da applicare)' : '');
    }
    function updateStatus() {
      const s = source();
      const ts = current();
      if (!ts || !s) { status.textContent = 'Importa un\'immagine per iniziare.'; return; }
      const partial = TL.partialTiles(s).length;
      const parts = [s.imageW + '×' + s.imageH + ' px', partial ? partial + ' tile parziali (◩)' : 'nessun tile parziale'];
      if (isStructure) parts.push((selection.match(/1/g) || []).length + ' tile inclusi = celle della struttura');
      if (picked.size) parts.push(picked.size + ' selezionati');
      parts.push(tool === 'includi' ? 'Clic o trascina per includere/escludere' + (rectMode ? ' (rettangolo)' : '')
        : tool === 'timbro' ? 'Clic = un tile, trascina = rettangolo di tile (timbro)'
          : 'Clic = un tile, Ctrl/Maiusc = aggiungi, trascina = rettangolo');
      status.textContent = parts.join(' · ');
    }

    // ---------- Disegno ----------
    function fit() {
      const s = source();
      if (s) vp.fit(s.imageW, s.imageH, 16);
    }
    function draw(ctx, W, H) {
      const c = UT.colors();
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, W, H);
      const ts = current();
      const s = source();
      if (!ts || !s) return;
      const v = vp.view();
      const k = v.zoom;
      const res = UT.sourceImage(s, vp.requestDraw);
      const ox = v.panX;
      const oy = v.panY;
      // Scacchiera per la trasparenza, poi l'immagine.
      ctx.fillStyle = c.board;
      ctx.fillRect(ox, oy, s.imageW * k, s.imageH * k);
      if (res.state === 'ok') {
        ctx.imageSmoothingEnabled = Boolean(ts.smooth);
        ctx.drawImage(res.img, ox, oy, s.imageW * k, s.imageH * k);
      } else if (res.state === 'missing') {
        ctx.fillStyle = c.missing;
        ctx.fillRect(ox, oy, s.imageW * k, s.imageH * k);
      }
      ctx.font = '600 10px system-ui, sans-serif';
      for (let row = 0; row < s.rows; row++) {
        for (let col = 0; col < s.cols; col++) {
          const i = row * s.cols + col;
          const r = T.tileRect(s, col, row);
          const x = ox + r.sx * k;
          const y = oy + r.sy * k;
          const w = r.sw * k;
          const h = r.sh * k;
          if (x > W || y > H || x + w < 0 || y + h < 0) continue;
          const id = T.tileId(s.id, col, row);
          const f = TL.flagsOf(ts, id);
          if (isStructure && selection[i] !== '1') { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, h); }
          if (f.excluded) { ctx.fillStyle = c.excluded; ctx.fillRect(x, y, w, h); }
          if (f.blocking) { ctx.fillStyle = c.blocking; ctx.fillRect(x, y, w, h); }
          if (f.difficult) { ctx.fillStyle = DIFFICULT; ctx.fillRect(x, y, w, h); }
          if (picked.has(i)) { ctx.fillStyle = c.selected; ctx.fillRect(x, y, w, h); }
          ctx.strokeStyle = c.cut;
          ctx.lineWidth = 1;
          ctx.setLineDash(r.sw < s.tileW || r.sh < s.tileH ? [3, 3] : []);
          ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
          ctx.setLineDash([]);
          if (w >= 18 && h >= 14) {
            const marks = (r.sw < s.tileW || r.sh < s.tileH ? '◩' : '') + (f.blocking ? '⛔' : '') + (f.difficult ? '≋' : '');
            const text = (numbers ? String(i) : '') + (marks ? (numbers ? ' ' : '') + marks : '');
            if (text) {
              ctx.fillStyle = c.labelBg;
              ctx.fillRect(x + 1, y + 1, ctx.measureText(text).width + 4, 12);
              ctx.fillStyle = c.text;
              ctx.fillText(text, x + 3, y + 10);
            }
          }
        }
      }
      if (drag && drag.rect) {
        const a = drag.a;
        const b = drag.b;
        const [ax, ay, bx, by] = [a % s.cols, Math.floor(a / s.cols), b % s.cols, Math.floor(b / s.cols)];
        const r0 = T.tileRect(s, Math.min(ax, bx), Math.min(ay, by));
        const r1 = T.tileRect(s, Math.max(ax, bx), Math.max(ay, by));
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(ox + r0.sx * k + 1, oy + r0.sy * k + 1, (r1.sx + r1.sw - r0.sx) * k - 2, (r1.sy + r1.sh - r0.sy) * k - 2);
        ctx.setLineDash([]);
      }
    }

    // ---------- Puntatore ----------
    function tileAt(p) {
      const s = source();
      if (!s) return -1;
      const v = vp.view();
      const px = (p.sx - v.panX) / v.zoom;
      const py = (p.sy - v.panY) / v.zoom;
      if (px < 0 || py < 0 || px >= s.imageW || py >= s.imageH) return -1;
      // TileSet precedenti con offset, margini o spaziatura: si cerca il rettangolo che contiene il punto.
      if (s.offsetX || s.offsetY || s.margin || s.sepX || s.sepY) {
        for (let i = 0; i < s.cols * s.rows; i++) {
          const r = T.tileRect(s, i % s.cols, Math.floor(i / s.cols));
          if (px >= r.sx && px < r.sx + r.sw && py >= r.sy && py < r.sy + r.sh) return i;
        }
        return -1;
      }
      const col = Math.floor(px / s.tileW);
      const row = Math.floor(py / s.tileH);
      return col < s.cols && row < s.rows ? row * s.cols + col : -1;
    }
    function onDown(e, p) {
      const i = tileAt(p);
      if (i < 0) return;
      if (tool === 'includi') {
        const value = selection[i] === '1' ? '0' : '1';
        drag = { a: i, b: i, value, rect: rectMode };
        if (!rectMode) setSelection(TL.setBits(selection, [i], value === '1'));
        return;
      }
      if (tool === 'seleziona' && !(e.ctrlKey || e.shiftKey || e.metaKey)) picked = new Set();
      if (tool === 'timbro') picked = new Set();
      drag = { a: i, b: i, rect: true, base: new Set(picked) };
      picked.add(i);
      vp.requestDraw();
    }
    function onMove(e, p) {
      if (!drag) return;
      const i = tileAt(p);
      if (i < 0 || i === drag.b) return;
      drag.b = i;
      const s = source();
      if (tool === 'includi' && !drag.rect) { if (selection[i] !== drag.value) setSelection(TL.setBits(selection, [i], drag.value === '1')); return; }
      if (tool !== 'includi') picked = new Set([...drag.base, ...TL.rectIndices(s.cols, drag.a, i)]);
      vp.requestDraw();
    }
    function onUp() {
      const d = drag;
      drag = null;
      if (!d) return;
      const s = source();
      if (tool === 'includi' && d.rect) setSelection(TL.setBits(selection, TL.rectIndices(s.cols, d.a, d.b), d.value === '1'));
      updateStatus();
      vp.requestDraw();
      if (tool === 'timbro') emit();
    }

    // ---------- Flag, tile vuoti, dimensione ----------
    async function saveTs(ts) {
      const res = await UT.saveTileset(ts);
      vp.requestDraw();
      emit();
      return res;
    }
    function toggleFlag(flag) {
      const ts = current();
      const s = source();
      if (!ts || !picked.size) { toast('Seleziona prima uno o più tile con lo strumento «Seleziona».', 'error'); return; }
      const copy = clone(ts);
      const ids = [...picked].map((i) => T.tileId(s.id, i % s.cols, Math.floor(i / s.cols)));
      const allOn = ids.every((id) => TL.flagsOf(copy, id)[flag]);
      TL.setFlag(copy, ids, flag, !allOn);
      saveTs(copy);
      toast(TL.FLAG_NAMES[flag] + (allOn ? ' tolto da ' : ' impostato su ') + ids.length + (ids.length === 1 ? ' tile.' : ' tile.'));
    }
    async function alphaOf(s) {
      if (alphaCache && alphaCache.id === s.imageId) return alphaCache.alpha;
      const data = await DnD.immagini.get(s.imageId);
      if (!data) return null;
      const r = await DnD.immaginiLib.readAlpha(data);
      alphaCache = { id: s.imageId, alpha: r.alpha };
      return r.alpha;
    }
    async function detectEmpty() {
      const ts = current();
      const s = source();
      if (!ts || !s) return;
      const pct = Number(threshold.value);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) { toast('La soglia deve essere tra 0 e 100%.', 'error'); return; }
      const alpha = await alphaOf(s);
      if (!alpha) { toast('L\'immagine non è disponibile.', 'error'); return; }
      const copy = clone(ts);
      copy.threshold = pct / 100;
      const bits = TL.detectEmpty(copy, T.sourceOf(copy, s.id), alpha, pct / 100);
      await saveTs(copy);
      const count = (bits.match(/1/g) || []).length;
      toast(count + (count === 1 ? ' tile vuoto escluso' : ' tile vuoti esclusi') + ' (meno del ' + pct + '% di pixel non trasparenti). Restano modificabili a mano.');
    }

    async function applySize() {
      const ts = current();
      const s = source();
      const tw = Number(wIn.value);
      const th = Number(hIn.value);
      if (!ts || !s || !TL.validSize(tw) || !TL.validSize(th)) return;
      const uses = TL.usage(DnD.store.state, ts.id);
      const apply = async () => {
        const copy = clone(ts);
        const oldCols = s.cols;
        const oldRows = s.rows;
        TL.applySize(copy, s.id, tw, th);
        const saved = DnD.dati.normalizeTileset(copy);
        const prevSel = selection;
        const res = await DnD.store.update((st) => {
          st.tilesets[st.tilesets.findIndex((x) => x.id === saved.id)] = saved;
          rebuildImageTemplates(st, saved, s.id, oldCols, oldRows);
        });
        if (!res.ok) { toast('TileSet NON salvato: ' + res.message, 'error'); return; }
        const ns = T.sourceOf(saved, s.id);
        if (isStructure) selection = TL.remapBits(prevSel, oldCols, oldRows, ns.cols, ns.rows, '0');
        picked = new Set();
        refresh();
        fit();
        emit();
        toast('Dimensione del tile: ' + tw + '×' + th + ' px · ' + TL.gridText(TL.grid(ns.imageW, ns.imageH, tw, th)) + '.', 'success');
      };
      const asNew = async () => {
        const copy = TL.copyWithSize(ts, s.id, tw, th, DnD.dadi.uid());
        const res = await UT.saveTileset(copy);
        if (!res.ok) return;
        const ns = T.sourceOf(res.tileset, s.id);
        if (isStructure) selection = TL.remapBits(selection, s.cols, s.rows, ns.cols, ns.rows, '0');
        tsId = last.tilesetId = res.tileset.id;
        picked = new Set();
        refresh();
        fit();
        emit();
        toast('Creato il TileSet «' + res.tileset.name + '».', 'success');
      };
      if (!uses.length) { apply(); return; }
      openDialog('TileSet già in uso', el('div', {},
        el('p', { text: 'Il TileSet «' + ts.name + '» è usato in:' }),
        el('ul', {}, uses.slice(0, 12).map((u) => el('li', { text: u }))),
        uses.length > 12 ? el('p', { class: 'muted small', text: '…e altri ' + (uses.length - 12) + '.' }) : null,
        el('p', { class: 'muted small', text: 'Con «Applica a tutti» i tile restano sulle stesse coordinate (colonna, riga) con i loro flag; le strutture da immagine si ricostruiscono. «Salva come nuovo tileset» crea una copia con la nuova dimensione e lascia invariato l\'originale.' })), [
        { text: 'Annulla', onclick: () => { fillSelects(); } },
        { text: 'Salva come nuovo tileset', onclick: () => { asNew(); } },
        { text: 'Applica a tutti', class: 'primary', onclick: () => { apply(); } },
      ]);
    }

    // ---------- Importazione ----------
    async function importFile(f) {
      try {
        const image = await UT.importImage(f);
        const ts = T.newTileset(DnD.dadi.uid(), image.name);
        const src = UT.addImageSource(ts, image);
        alphaCache = { id: image.imageId, alpha: image.alpha };
        const res = await UT.saveTileset(ts);
        for (const w of image.warnings) toast('⚠ ' + w);
        if (!res.ok) return;
        tsId = last.tilesetId = res.tileset.id;
        srcId = src.id;
        selection = isStructure ? TL.notExcluded(res.tileset, T.sourceOf(res.tileset, src.id)) : '';
        picked = new Set();
        refresh();
        fit();
        emit();
        toast('TileSet «' + ts.name + '» creato: imposta X e Y del tile.', 'success');
      } catch (e) {
        toast('Importazione non riuscita: ' + e.message, 'error');
      }
    }

    tsSel.addEventListener('change', () => { tsId = last.tilesetId = tsSel.value; srcId = 0; selection = ''; picked = new Set(); refresh(); fit(); emit(); });
    srcSel.addEventListener('change', () => { srcId = Number(srcSel.value); selection = ''; picked = new Set(); refresh(); fit(); emit(); });
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) importFile(f); });
    for (const [inp, pre] of [[wIn, wPre], [hIn, hPre]]) {
      inp.addEventListener('input', updateGridInfo);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applySize(); } });
      pre.addEventListener('change', () => { if (pre.value) inp.value = pre.value; pre.value = ''; updateGridInfo(); });
    }
    applyBtn.addEventListener('click', applySize);
    numbersBox.addEventListener('change', () => { numbers = last.numbers = numbersBox.checked; vp.requestDraw(); });
    UT.acceptImages(opts.container || node, () => node.isConnected && !node.closest('[hidden]') && !document.querySelector('dialog[open]'), importFile);

    // La vista si adatta all'immagine quando cambia il TileSet o la sorgente mostrati.
    let fitted = null;
    function refresh() {
      fillSelects();
      setTool(tool);
      updateStatus();
      const key = tsId + ':' + srcId;
      if (key !== fitted && source()) { fitted = key; requestAnimationFrame(fit); }
      vp.requestDraw();
    }
    refresh();

    return {
      node, refresh, fit,
      state: () => ({ tilesetId: tsId, srcId, selection, stamp: stamp() }),
      select: (id, sid) => { tsId = last.tilesetId = id; srcId = sid || 0; selection = ''; picked = new Set(); refresh(); fit(); },
      // Contagocce: sceglie un tile come timbro.
      pickTile: (id, tileId) => {
        const ts = findTs(id);
        if (!ts) return;
        const c = T.tileCoords(tileId);
        tsId = last.tilesetId = id;
        srcId = c.src;
        fillSelects();
        const s = source();
        picked = new Set([c.row * s.cols + c.col]);
        setTool('timbro');
        vp.requestDraw();
        emit();
      },
    };
  }

  DnD.uiTile = { cutter, rebuildImageTemplates };
})(globalThis.DnD = globalThis.DnD || {});
