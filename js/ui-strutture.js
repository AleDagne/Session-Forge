// Asset › Strutture: muri, colonne, alberi, case... Forma predefinita, forma personalizzata a celle oppure
// "Da immagine": l'immagine tagliata in tile (componente ui-tile.js), un tile per cella della griglia.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast } = DnD.ui;
  const G = DnD.griglia;
  const V = DnD.validazione;
  const TM = DnD.tilemap;
  const UT = DnD.uiTileset;
  let editing = null;
  let root = null;

  // Canvas con la forma disegnata cella per cella, scalata per stare in `box` pixel.
  function shapeCanvas(shape, color, box) {
    const cell = Math.max(3, Math.floor(box / Math.max(shape.w, shape.h)));
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = shape.w * cell * dpr;
    canvas.height = shape.h * cell * dpr;
    canvas.style.width = shape.w * cell + 'px';
    canvas.style.height = shape.h * cell + 'px';
    canvas.className = 'shape-canvas';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < shape.h; y++) {
      for (let x = 0; x < shape.w; x++) {
        if (!G.isFilled(shape, x, y)) continue;
        ctx.fillRect(x * cell, y * cell, cell, cell);
        ctx.strokeRect(x * cell + 0.5, y * cell + 0.5, cell - 1, cell - 1);
      }
    }
    return canvas;
  }

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function duplicate(s) {
    const copy = Object.assign({}, s, { id: DnD.dadi.uid(), name: (s.name + ' (copia)').slice(0, 60) });
    DnD.store.update((st) => { st.structures.splice(st.structures.indexOf(s) + 1, 0, copy); });
    toast('Struttura duplicata.');
    render();
  }

  function remove(s) {
    if (!confirm('Eliminare la struttura "' + s.name + '"?\nLe copie già piazzate sulle griglie restano.')) return;
    DnD.store.update((st) => { st.structures = st.structures.filter((x) => x.id !== s.id); });
    toast('Struttura eliminata.');
    render();
  }

  function renderList() {
    const list = DnD.store.state.structures;
    root.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Strutture' }),
        el('button', { class: 'btn primary', text: '+ Nuova struttura', onclick: () => { editing = 'new'; render(); } })),
      list.length
        ? el('div', { class: 'card-grid' }, list.map((s) => el('article', { class: 'card' },
          el('div', { class: 'card-title' }, el('h3', { text: s.name }), el('span', { class: 'muted small', text: G.templateShape(s).w + '×' + G.templateShape(s).h + ' caselle' })),
          el('div', { class: 'shape-box' }, DnD.uiTileset.templatePreview(s, 'structure', 96)),
          el('p', { class: 'muted small', text: s.mode === 'tiles' ? (s.tiles.kind === 'mappa' ? 'Tilemap (versione precedente)' : 'Da immagine') + ' · ingombro ' + (s.tiles.cells.match(/1/g) || []).length + ' celle'
            : s.mode === 'custom' ? 'Forma personalizzata' : 'Forma: ' + G.PRESET_NAMES[s.preset] }),
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = s.id; render(); } }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(s) }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(s) })))))
        : el('p', { class: 'empty', text: 'Nessuna struttura. Creane una con "Nuova struttura".' }));
  }

  // Editor a griglia: clic o trascinamento per riempire/svuotare le celle.
  function cellEditor(onChange) {
    const node = el('div', { class: 'cell-editor', role: 'grid', 'aria-label': 'Editor della forma' });
    let shape = null;
    let paint = null;

    function draw(s) {
      shape = s;
      node.style.gridTemplateColumns = 'repeat(' + s.w + ', 1.8rem)';
      clear(node).append(...Array.from({ length: s.w * s.h }, (_, i) => el('button', {
        type: 'button', class: 'cell' + (s.cells[i] === '1' ? ' on' : ''), 'data-i': i,
        'aria-label': 'Cella ' + G.cellLabel(i % s.w, Math.floor(i / s.w)), 'aria-pressed': String(s.cells[i] === '1'),
      })));
    }
    function set(i, value) {
      if ((shape.cells[i] === '1') === value) return;
      shape = Object.assign({}, shape, { cells: shape.cells.slice(0, i) + (value ? '1' : '0') + shape.cells.slice(i + 1) });
      const b = node.children[i];
      b.classList.toggle('on', value);
      b.setAttribute('aria-pressed', String(value));
      onChange(shape);
    }
    const cellAt = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      return t && t.parentNode === node ? Number(t.dataset.i) : null;
    };
    node.addEventListener('pointerdown', (e) => {
      const i = cellAt(e);
      if (i === null || e.button !== 0) return;
      e.preventDefault();
      paint = shape.cells[i] !== '1';
      node.setPointerCapture(e.pointerId);
      set(i, paint);
    });
    node.addEventListener('pointermove', (e) => {
      if (paint === null) return;
      const i = cellAt(e);
      if (i !== null) set(i, paint);
    });
    const stop = () => { paint = null; };
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
    // Da tastiera: Invio/Spazio attivano il pulsante della cella.
    node.addEventListener('click', (e) => {
      if (e.detail !== 0) return; // i clic del mouse sono già gestiti da pointerdown
      const i = e.target.dataset && e.target.dataset.i;
      if (i !== undefined) set(Number(i), shape.cells[i] !== '1');
    });
    return { node, draw };
  }

  // Anteprima sulla griglia: la struttura con un margine di una cella e una pedina 1×1 d'esempio (su una
  // cella libera dell'area, se c'è, per mostrare i livelli "sopra le pedine").
  function gridPreview(tiles, box) {
    const W = tiles.w + 2;
    const H = tiles.h + 2;
    const cell = Math.max(6, Math.min(40, Math.floor(box / Math.max(W, H))));
    const { canvas, ctx } = UT.sizedCanvas(W * cell, H * cell);
    canvas.className = 'structure-grid-preview';
    const free = [...tiles.cells].findIndex((c, i) => c === '0' && tiles.mask[i] === '1');
    const tok = free >= 0 ? { x: 1 + (free % tiles.w), y: 1 + Math.floor(free / tiles.w) } : { x: 0, y: 0 };
    const paint = () => {
      const c = UT.colors();
      ctx.fillStyle = c.board;
      ctx.fillRect(0, 0, W * cell, H * cell);
      UT.drawTiles(ctx, tiles, cell, cell, cell, { above: false, onReady: paint });
      ctx.fillStyle = c.blocking;
      for (let i = 0; i < tiles.cells.length; i++) if (tiles.cells[i] === '1') ctx.fillRect(cell * (1 + (i % tiles.w)) + cell * 0.4, cell * (1 + Math.floor(i / tiles.w)) + cell * 0.4, cell * 0.2, cell * 0.2);
      DnD.icone.drawIcon(ctx, { kind: 'shape', shape: 'cerchio', color: DnD.icone.CREATURE_COLORS.blu }, (tok.x + 0.5) * cell, (tok.y + 0.5) * cell, cell * 0.38);
      const under = (x, y, span) => tok.x - 1 >= x && tok.x - 1 < x + span.w && tok.y - 1 >= y && tok.y - 1 < y + span.h;
      UT.drawTiles(ctx, tiles, cell, cell, cell, { above: true, onReady: paint, cellAlpha: (l, x, y, span) => (l.fade && under(x, y, span) ? 0.4 : 1) });
      ctx.strokeStyle = c.line;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, H * cell); }
      for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(W * cell, y * cell + 0.5); }
      ctx.stroke();
    };
    paint();
    return canvas;
  }

  function renderForm() {
    const existing = DnD.store.state.structures.find((s) => s.id === editing);
    const s = existing || DnD.dati.normalizeStructure({ name: '', color: '#7d7f86', mode: 'preset', preset: 'rettangolo', w: 2, h: 1 });
    if (!existing) s.name = '';
    // shapeMode: forma usata senza immagine; resta salvata anche in modalità "Da immagine".
    let shapeMode = s.shapeMode || (s.mode === 'custom' ? 'custom' : 'preset');
    let custom = shapeMode === 'custom'
      ? { w: s.w, h: s.h, cells: s.cells }
      : (s.w <= V.MAX_CUSTOM && s.h <= V.MAX_CUSTOM ? { w: s.w, h: s.h, cells: s.cells } : G.squareShape(3));
    let mode = s.mode;
    // Da immagine: TileSet, sorgente, tile inclusi, opzioni di disegno e trasformazioni.
    const legacyMap = s.tiles && s.tiles.kind === 'mappa' ? s.tiles : null;
    const img = s.tiles && s.tiles.kind === 'immagine' ? s.tiles : null;
    let cut = img ? { tilesetId: img.tilesets[0], srcId: img.source, selection: img.sel } : { tilesetId: null, srcId: 0, selection: '' };
    let ops = img && img.ops ? img.ops.slice() : [];

    const inp = {
      name: textInput(s.name, { maxlength: 60 }),
      color: el('input', { type: 'color', value: s.color, oninput: () => updatePreview() }),
      preset: el('select', { onchange: () => updatePreview() }, G.PRESETS.map((p) => el('option', { value: p, text: G.PRESET_NAMES[p], selected: p === s.preset }))),
      w: numberInput(s.w, { min: 1, max: V.MAX_PRESET, oninput: () => sizeChanged() }),
      h: numberInput(s.h, { min: 1, max: V.MAX_PRESET, oninput: () => sizeChanged() }),
      drawAll: el('input', { type: 'checkbox', checked: Boolean(img && img.drawAll), onchange: () => updateImage() }),
      layer: el('select', { 'aria-label': 'Livello di disegno', onchange: () => updateImage() },
        el('option', { value: 'Base', text: 'Sotto le pedine' }), el('option', { value: 'Sopra', text: 'Sopra le pedine (tetti, chiome)' })),
      fade: el('input', { type: 'checkbox', checked: Boolean(img && img.layers[1] && img.layers[1].fade), onchange: () => updateImage() }),
    };
    if (img && img.layers[1] && img.layers[1].data.some(Boolean)) inp.layer.value = 'Sopra';
    const preview = el('div', { class: 'shape-preview' });
    const editor = cellEditor((shape) => { custom = shape; updatePreview(); });
    const presetBox = el('div', {}, field('Forma', inp.preset, 'preset'));
    const customBox = el('div', { class: 'custom-box' },
      editor.node,
      el('div', { class: 'head-actions' },
        el('button', { type: 'button', class: 'btn small', text: 'Svuota', onclick: () => { custom = G.shapeFrom(custom.w, custom.h, () => false); editor.draw(custom); updatePreview(); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Riempi', onclick: () => { custom = G.shapeFrom(custom.w, custom.h, () => true); editor.draw(custom); updatePreview(); } })),
      el('small', { class: 'hint', text: 'Clicca o trascina sulle celle per riempirle o svuotarle (massimo ' + V.MAX_CUSTOM + '×' + V.MAX_CUSTOM + ').' }));
    const cellsError = el('div', { class: 'error', 'data-error': 'cells' });

    // Forma attuale secondo il modo scelto (null se le dimensioni non sono valide).
    function currentShape() {
      if ((mode === 'tiles' ? shapeMode : mode) === 'custom') return custom;
      const w = readNumber(inp.w);
      const h = readNumber(inp.h);
      const ok = (n) => Number.isInteger(n) && n >= 1 && n <= V.MAX_PRESET;
      return ok(w) && ok(h) ? G.presetShape(inp.preset.value, w, h) : null;
    }
    function updatePreview() {
      const shape = currentShape();
      clear(preview).append(shape ? shapeCanvas(shape, inp.color.value, 160) : el('span', { class: 'muted', text: 'Dimensioni non valide' }));
    }
    function sizeChanged() {
      if (mode === 'custom') {
        const w = readNumber(inp.w);
        const h = readNumber(inp.h);
        if (Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= V.MAX_CUSTOM && h <= V.MAX_CUSTOM) {
          custom = G.resizeShape(custom, w, h);
          editor.draw(custom);
        }
      }
      updatePreview();
    }

    // Tilemap "da immagine" dalle scelte attuali (null se manca il TileSet o non c'è nessun tile incluso).
    function buildTiles() {
      const st = DnD.store.state;
      const ts = st.tilesets.find((t) => t.id === cut.tilesetId);
      const src = ts && DnD.tileset.sourceOf(ts, cut.srcId);
      if (!src || !(src.tileW > 0) || !cut.selection || cut.selection.length !== src.cols * src.rows || !cut.selection.includes('1')) return null;
      const byId = TM.tilesetIndex(st.tilesets);
      let t = Object.assign(TM.imageTiles(ts, cut.srcId, cut.selection, { drawAll: inp.drawAll.checked, layer: inp.layer.value, fade: inp.fade.checked }), { sel: cut.selection });
      for (const op of ops) t = TM.transformTiles(t, op, byId);
      return TM.withFootprint(Object.assign(t, { ops: ops.slice() }), byId, 'structure');
    }
    const imagePreview = el('div', { class: 'image-panel-preview' });
    const imageInfo = el('div', { class: 'muted small', 'aria-live': 'polite' });
    function updateImage() {
      inp.fade.disabled = inp.layer.value !== 'Sopra';
      const t = legacyMap || buildTiles();
      clear(imagePreview);
      if (!t) { imageInfo.textContent = 'Importa un\'immagine, imposta X e Y del tile e includi i tile della struttura.'; return; }
      const blocking = (t.cells.match(/1/g) || []).length;
      const included = (t.mask.match(/1/g) || []).length;
      imageInfo.textContent = 'Sulla griglia: ' + t.w + '×' + t.h + ' celle · ' + (t.kind === 'mappa' ? 'ingombro ' + blocking : included + ' tile inclusi, ' + blocking + ' bloccano') +
        (ops.length ? ' · trasformata (' + ops.length + ')' : '') + ' · ● = cella che blocca';
      imagePreview.append(gridPreview(t, 220));
    }
    const cutter = DnD.uiTile.cutter({
      mode: 'struttura', tilesetId: cut.tilesetId, srcId: cut.srcId, selection: cut.selection, container: root, height: 300,
      onChange: (st) => { const changed = st.tilesetId !== cut.tilesetId || st.srcId !== cut.srcId; cut = st; if (changed) ops = []; updateImage(); },
    });
    const transformBtn = (text, title, op) => el('button', { type: 'button', class: 'btn small', text, title, 'aria-label': title, onclick: () => { ops.push(op); updateImage(); } });

    function setMode(m) {
      mode = m;
      if (m !== 'tiles') shapeMode = m;
      presetBox.hidden = m !== 'preset';
      customBox.hidden = m !== 'custom';
      sizeFields.hidden = previewWrap.hidden = m === 'tiles';
      imageBox.hidden = m !== 'tiles';
      const max = m === 'custom' ? V.MAX_CUSTOM : V.MAX_PRESET;
      inp.w.max = inp.h.max = max;
      if (m === 'custom') {
        // Si parte dalla forma predefinita attuale, se sta nei limiti dell'editor.
        const shape = currentShape();
        if (shape && shape.w <= V.MAX_CUSTOM && shape.h <= V.MAX_CUSTOM) custom = shape;
        inp.w.value = custom.w;
        inp.h.value = custom.h;
        editor.draw(custom);
      }
      updatePreview();
      if (m === 'tiles') { updateImage(); requestAnimationFrame(() => cutter.fit()); }
    }
    const modeRadio = (value, label) => el('label', { class: 'check' },
      el('input', { type: 'radio', name: 'structure-mode', value, checked: mode === value, onchange: () => setMode(value) }), ' ' + label);

    const sizeFields = el('div', { class: 'grid-2 tight' }, field('Larghezza (celle)', inp.w, 'w'), field('Altezza (celle)', inp.h, 'h'));
    const previewWrap = el('div', {}, el('div', { class: 'muted small', text: 'Anteprima' }), preview);
    const imageBox = el('div', { class: 'image-box' },
      legacyMap
        ? el('p', { class: 'warn', text: 'Questa struttura usa una tilemap della versione precedente: resta funzionante e si può piazzare, ruotare e specchiare. Per modificarla ricreala «Da immagine».' })
        : cutter.node,
      el('div', { class: 'image-panel-body' }, imagePreview,
        el('div', { class: 'image-panel-info' }, imageInfo,
          legacyMap ? null : el('label', { class: 'check small' }, inp.drawAll, ' Disegna anche le parti fuori selezione (tetti, chiome: non bloccano)'),
          legacyMap ? null : el('label', { class: 'inline small' }, 'Livello di disegno', inp.layer),
          legacyMap ? null : el('label', { class: 'check small' }, inp.fade, ' Semitrasparente quando c\'è una pedina sotto'),
          legacyMap ? null : el('div', { class: 'head-actions' }, transformBtn('⟳ Ruota 90°', 'Ruota di 90° (tile, ingombro e flag)', 'ruota'),
            transformBtn('⇋ Specchia', 'Specchia (tile, ingombro e flag)', 'specchia'),
            el('button', { type: 'button', class: 'btn small', text: 'Orientamento originale', onclick: () => { ops = []; updateImage(); } })))),
      el('small', { class: 'hint', text: 'Ogni tile incluso occupa una cella della griglia di battaglia: tile più piccoli = struttura più grande. Bloccano i tile inclusi marcati «Bloccante» (se nessuno lo è, tutti gli inclusi).' }),
      el('div', { class: 'error', 'data-error': 'tiles' }));
    // Luce e visione: blocca la vista (una finestra o una grata no) e luce emessa.
    const blocksSight = el('input', { type: 'checkbox', checked: s.blocksSight !== false });
    const light = DnD.uiVisione.emitterEditor(s.light);
    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' }, field('Nome', inp.name, 'name'), field('Colore', inp.color, 'color')),
      el('label', { class: 'check', title: 'Toglila per finestre, grate e cancelli: bloccano il passaggio ma non la vista' }, blocksSight, ' Blocca la vista'),
      light.node,
      el('fieldset', {},
        el('legend', { text: 'Forma' }),
        el('div', { class: 'radio-row' }, modeRadio('preset', 'Forma predefinita'), modeRadio('custom', 'Forma personalizzata a celle'), modeRadio('tiles', 'Da immagine')),
        el('div', { class: 'structure-editor' },
          el('div', { class: 'structure-fields' }, sizeFields, presetBox, customBox, cellsError),
          previewWrap),
        imageBox),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva struttura' })));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const shape = currentShape();
      const tiles = mode === 'tiles' ? (legacyMap || buildTiles()) : (s.tiles || null);
      const data = {
        id: s.id, name: inp.name.value.trim(), color: inp.color.value.toLowerCase(), mode, shapeMode, preset: inp.preset.value,
        w: readNumber(inp.w), h: readNumber(inp.h), cells: shape ? shape.cells : '', tiles,
        blocksSight: blocksSight.checked, light: light.read(),
      };
      // In modalità immagine la forma (nascosta) non si controlla: basta l'immagine.
      const errors = mode === 'tiles'
        ? Object.fromEntries(Object.entries(V.validateStructure(Object.assign({}, data, { mode: shapeMode }))).filter(([k]) => k === 'name' || k === 'color'))
        : V.validateStructure(data);
      if (mode === 'tiles' && !tiles) errors.tiles = 'Importa un\'immagine e includi almeno un tile (oppure scegli una forma).';
      if (!showErrors(form, errors)) return;
      const saved = DnD.dati.normalizeStructure(data);
      DnD.store.update((st) => {
        const i = st.structures.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.structures[i] = saved;
        else st.structures.push(saved);
      });
      toast('Struttura salvata.', 'success');
      editing = null;
      render();
    });

    root.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica struttura' : 'Nuova struttura' })), form);
    setMode(mode);
    inp.name.focus();
  }

  // Scheda della sezione Asset (vedi ui-asset.js).
  DnD.schede = DnD.schede || {};
  DnD.schede.strutture = { title: 'Strutture', render, reset: () => { editing = null; } };
  DnD.uiStrutture = { shapeCanvas };
})(globalThis.DnD = globalThis.DnD || {});
