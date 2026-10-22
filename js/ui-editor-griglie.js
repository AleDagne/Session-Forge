// Sezione Editor griglie: costruisce le mappe prima di giocare. La griglia (lo stesso componente canvas del
// combattimento: strutture, oggetti di mappa, zone, etichette) ha sotto il pannello Tile, con cui si dipinge
// la TileMap direttamente sulla griglia. Si lavora su una bozza (sessione.gridDraft, una per sessione)
// salvata a ogni modifica; "Salva" la trasforma in una griglia salvata della sessione corrente.
// Ogni griglia ha dimensione (5–100 celle per lato), piedi per cella e sfondo (colore o immagine), scelti
// alla creazione e modificabili dopo («Proprietà»), e un tipo: Battaglia (come sempre) o Esplorazione, con
// scala configurabile e strumenti Bioma, Evento e Nebbia (vedi ui-mappa-esplorazione.js).
(function (DnD) {
  'use strict';

  const { el, clear, toast, promptText, field, numberInput, textInput, readNumber, showErrors, openDialog } = DnD.ui;
  const G = DnD.griglia;
  const UG = DnD.uiGriglia;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const ALL_TOOLS = ['seleziona', 'struttura', 'oggetto', 'gomma', 'riempi', 'zona-giocatori', 'zona-nemici', 'etichetta', 'misura'];

  let root = null;
  let editing = false;
  let widget = null;
  let tilePanel = null;
  let explorePanel = null;
  let docKey = 'bozza-0';
  let docSeq = 0;
  const status = el('span', { class: 'draft-status' });

  const session = (st) => DnD.sessioni.current(st || DnD.store.state);
  const draft = () => session().gridDraft;
  const savedOf = (d) => (d && d.gridId ? DnD.store.state.savedGrids.find((g) => g.id === d.gridId) || null : null);

  function updateStatus() {
    const d = draft();
    if (!d) return;
    status.textContent = d.dirty ? '● Modifiche non salvate (bozza conservata automaticamente)' : '✓ Salvata';
    status.classList.toggle('dirty', d.dirty);
  }

  const markDirty = () => {
    DnD.store.update((st) => { session(st).gridDraft.dirty = true; });
    updateStatus();
  };

  function getTilePanel() {
    if (!tilePanel) {
      tilePanel = DnD.uiPannelloTile.create({ getGrid: () => (draft() ? draft().grid : null), widget: () => widget });
    }
    return tilePanel;
  }

  // Strumenti delle mappe di esplorazione (biomi, eventi, nebbia): visibili solo se la bozza è di quel tipo.
  function getExplorePanel() {
    if (!explorePanel) {
      explorePanel = DnD.uiMappaEsplorazione.create({
        getGrid: () => (draft() ? draft().grid : null), widget: () => widget, mode: 'editor',
        otherPainter: () => getTilePanel().painter, onChange: () => updateStatus(),
      });
    }
    return explorePanel;
  }

  function getWidget() {
    if (!widget) {
      const panel = getTilePanel();
      const xp = getExplorePanel();
      // Un clic sugli strumenti delle tile spegne quelli dell'esplorazione.
      panel.node.addEventListener('click', (e) => { if (e.target.closest('button')) xp.painter.deactivate(); }, true);
      widget = UG.create({
        getDoc: () => (draft() ? { id: session().id + ':' + docKey, grid: draft().grid, combatants: [], currentId: null } : null),
        update: (fn) => {
          DnD.store.update((st) => {
            fn({ id: docKey, grid: session(st).gridDraft.grid, combatants: [], currentId: null });
            session(st).gridDraft.dirty = true;
          });
          updateStatus();
        },
        tools: ALL_TOOLS,
        showCombatants: false,
        painter: DnD.uiMappaEsplorazione.combinePainters(panel.painter, xp.painter),
        onObject: (id) => DnD.uiOggettiMappa.openPanel({
          getItem: () => draft() && draft().grid.items.find((x) => x.id === id),
          update: (fn) => { DnD.store.update((st) => fn(session(st).gridDraft.grid.items.find((x) => x.id === id), st)); markDirty(); widget.refresh(); },
          log: (text) => toast(text),
        }),
        toolbar: [el('button', { type: 'button', class: 'btn small', text: '⚙ Proprietà', title: 'Dimensione, piedi per cella e sfondo', onclick: () => editProps() })],
      });
    }
    return widget;
  }

  // Conferma prima di perdere modifiche non salvate di un'altra bozza.
  function confirmDiscard() {
    const d = draft();
    return !d || !d.dirty || confirm('La bozza «' + d.name + '» ha modifiche non salvate che andranno perse. Continuare?');
  }

  function startDraft(gridId, name, content) {
    DnD.store.update((st) => {
      session(st).gridDraft = {
        gridId, name, dirty: !gridId,
        grid: Object.assign({
          structures: clone(content.structures), items: clone(content.items), labels: clone(content.labels), zones: clone(content.zones),
          tileMap: clone(content.tileMap || null), ignoreCollisions: false,
        }, G.gridProps(content), DnD.esplorazione.extrasOf(content)),
      };
    });
    docKey = 'bozza-' + (++docSeq);
    editing = true;
    if (tilePanel) tilePanel.reset();
    if (explorePanel) explorePanel.reset();
    render();
  }

  function openGrid(g) {
    const d = draft();
    if (d && d.gridId === g.id) { editing = true; render(); return; } // riprende la bozza di questa griglia
    if (confirmDiscard()) startDraft(g.id, g.name, g);
  }

  // ---------- Proprietà della griglia: dimensione, piedi per cella, sfondo, calibrazione ----------
  // initial: { name?, w, h, feetPerCell, background }; onOk(valori) restituisce un messaggio d'errore o nulla.
  function propsDialog(title, initial, isNew, onOk) {
    let bg = initial.background ? clone(initial.background) : null;
    const inp = {
      name: isNew ? textInput(initial.name || '', { maxlength: 60, placeholder: 'es. Cripta del lich' }) : null,
      w: numberInput(initial.w, { min: G.MIN_SIZE, max: G.MAX_SIZE }),
      h: numberInput(initial.h, { min: G.MIN_SIZE, max: G.MAX_SIZE }),
      feetPerCell: numberInput(initial.feetPerCell, { min: 1, max: 100 }),
    };
    const kindSel = el('select', { 'aria-label': 'Tipo di sfondo' },
      el('option', { value: '', text: 'Nessuno (colore del tema)' }), el('option', { value: 'colore', text: 'Colore tinta unita' }), el('option', { value: 'immagine', text: 'Immagine importata' }));
    const color = el('input', { type: 'color', value: bg && bg.color ? bg.color : '#2b2f38', 'aria-label': 'Colore dello sfondo' });
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const fit = el('select', { 'aria-label': 'Adattamento' }, G.BG_FITS.map((f) => el('option', { value: f, text: G.BG_FIT_NAMES[f] })));
    const bx = numberInput(0, { step: 0.5, 'aria-label': 'Posizione X (celle)' });
    const by = numberInput(0, { step: 0.5, 'aria-label': 'Posizione Y (celle)' });
    const scale = numberInput(100, { min: 5, max: 2000, step: 5, 'aria-label': 'Scala (%)' });
    const opacity = el('input', { type: 'range', min: 0, max: 100, value: '100', 'aria-label': 'Opacità' });
    const px = numberInput('', { min: 1, max: 4096, placeholder: 'es. 70', 'aria-label': 'Pixel per cella' });
    const fitBg = el('input', { type: 'checkbox', checked: true });
    const imgInfo = el('span', { class: 'muted small' });
    const calInfo = el('div', { class: 'muted small', 'aria-live': 'polite' });
    const preview = el('div', { class: 'bg-preview' });
    const errorBox = el('div', { class: 'error', 'aria-live': 'polite' });
    const sideX = el('select', { 'aria-label': 'Colonne' }, el('option', { value: 'destra', text: 'a destra' }), el('option', { value: 'sinistra', text: 'a sinistra' }));
    const sideY = el('select', { 'aria-label': 'Righe' }, el('option', { value: 'sotto', text: 'in basso' }), el('option', { value: 'sopra', text: 'in alto' }));
    // Tipo di griglia e scala (solo per l'esplorazione: 1 cella = valore + unità).
    const X = DnD.esplorazione;
    const sc = X.normalizeScale(initial.scale);
    const kindType = el('select', { 'aria-label': 'Tipo di griglia' },
      el('option', { value: 'battaglia', text: '⚔ Battaglia', selected: initial.kind !== 'esplorazione' }), el('option', { value: 'esplorazione', text: '🧭 Esplorazione', selected: initial.kind === 'esplorazione' }));
    const scaleValue = numberInput(sc.value, { min: 0.01, step: 0.5, 'aria-label': 'Una cella misura' });
    const scaleUnit = el('select', { 'aria-label': 'Unità' }, X.UNITS.map((u) => el('option', { value: u, text: X.UNIT_NAMES[u], selected: u === sc.unit })));
    const scalePreset = el('select', { 'aria-label': 'Preset di scala', onchange: (e) => { if (e.target.value) { const p = X.SCALE_PRESETS[Number(e.target.value)]; scaleValue.value = String(p.value); scaleUnit.value = p.unit; } } },
      el('option', { value: '', text: 'Preset…' }), X.SCALE_PRESETS.map((p, i) => el('option', { value: String(i), text: String(p.value).replace('.', ',') + ' ' + X.UNIT_NAMES[p.unit] })));
    const scaleRow = el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: '1 cella =' }), scaleValue, scaleUnit, scalePreset,
      el('div', { class: 'error', 'data-error': 'scale' }));
    const syncKind = () => { scaleRow.hidden = kindType.value !== 'esplorazione'; };
    kindType.addEventListener('change', syncKind);

    function readBg() {
      const kind = kindSel.value;
      if (!kind) return null;
      if (kind === 'colore') return DnD.dati.normalizeBackground({ kind: 'colore', color: color.value });
      if (!bg || !bg.imageId) return null;
      return DnD.dati.normalizeBackground(Object.assign({}, bg, {
        kind: 'immagine', fit: fit.value, x: readNumber(bx) || 0, y: readNumber(by) || 0, scale: (readNumber(scale) || 100) / 100, opacity: Number(opacity.value) / 100,
      }));
    }
    function sync() {
      colorRow.hidden = kindSel.value !== 'colore';
      imageBox.hidden = kindSel.value !== 'immagine';
      imgInfo.textContent = bg && bg.imageId ? 'Immagine: ' + bg.imageW + '×' + bg.imageH + ' px' : 'Nessuna immagine';
      const w = readNumber(inp.w);
      const h = readNumber(inp.h);
      const v = readBg();
      clear(preview).append(UG.gridThumbnail(Object.assign({ structures: [], items: [], labels: [], zones: [], tileMap: null },
        { w: Number.isInteger(w) && w >= 5 && w <= 100 ? w : 50, h: Number.isInteger(h) && h >= 5 && h <= 100 ? h : 50, background: v }), 150));
    }
    // Calibrazione: con i pixel di una cella della mappa quadrettata si ricavano larghezza e altezza.
    function calibrate() {
      const p = readNumber(px);
      if (!bg || !bg.imageId) { calInfo.textContent = 'Importa prima l\'immagine della mappa.'; return; }
      if (!Number.isFinite(p) || p < 1) { calInfo.textContent = 'Indica quanti pixel misura una cella.'; return; }
      const c = G.calibrate(bg.imageW, bg.imageH, p);
      inp.w.value = String(c.w);
      inp.h.value = String(c.h);
      if (fitBg.checked) { fit.value = 'originale'; bg.pxPerCell = p; bx.value = '0'; by.value = '0'; scale.value = '100'; }
      calInfo.textContent = 'Griglia ' + c.w + '×' + c.h + ' celle (' + String(Math.round(c.exactW * 10) / 10).replace('.', ',') + '×' + String(Math.round(c.exactH * 10) / 10).replace('.', ',') + ' calcolate).' +
        (c.w !== Math.round(c.exactW) || c.h !== Math.round(c.exactH) ? ' Limitata a ' + G.MIN_SIZE + '–' + G.MAX_SIZE + ' celle per lato.' : '');
      sync();
    }
    async function importBg(f) {
      try {
        const res = await DnD.immaginiLib.importFile(f, { maxSide: DnD.tileset.MAX_IMAGE_SIDE, largeSide: DnD.tileset.LARGE_IMAGE_SIDE, largeFile: DnD.tileset.LARGE_FILE });
        let imageId;
        try { imageId = await DnD.immagini.put(res.dataUrl); } catch (e) { throw new Error('immagine non salvata: ' + DnD.dati.saveErrorMessage(e)); }
        bg = Object.assign(bg || {}, { kind: 'immagine', imageId, imageW: res.width, imageH: res.height, pxPerCell: 0 });
        kindSel.value = 'immagine';
        for (const w of res.warnings) toast('⚠ ' + w);
        sync();
      } catch (e) {
        errorBox.textContent = 'Importazione non riuscita: ' + e.message;
      }
    }

    if (bg) {
      kindSel.value = bg.kind;
      fit.value = bg.fit;
      bx.value = String(bg.x);
      by.value = String(bg.y);
      scale.value = String(Math.round(bg.scale * 100));
      opacity.value = String(Math.round(bg.opacity * 100));
      if (bg.pxPerCell) px.value = String(bg.pxPerCell);
    }
    const colorRow = el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Colore' }), color);
    const imageBox = el('div', { class: 'bg-image-box' },
      el('div', { class: 'input-row' },
        el('button', { type: 'button', class: 'btn small', text: '⬆ Importa immagine', onclick: () => file.click() }), imgInfo,
        el('button', { type: 'button', class: 'btn small danger', text: 'Rimuovi sfondo', onclick: () => { bg = null; kindSel.value = ''; sync(); } }), file),
      el('div', { class: 'grid-3 tight' }, field('Adattamento', fit), field('Posizione X (celle)', bx), field('Posizione Y (celle)', by),
        field('Scala (%)', scale), el('div', { class: 'field' }, el('label', { text: 'Opacità' }), opacity)),
      el('fieldset', {}, el('legend', { text: 'Calibra dalla mappa' }),
        el('p', { class: 'muted small', text: 'Per un\'immagine già quadrettata: indica quanti pixel misura una cella e la griglia si adatta da sola.' }),
        el('div', { class: 'input-row' }, el('label', { class: 'inline small' }, 'Pixel per cella', px),
          el('label', { class: 'check small' }, fitBg, ' Adatta lo sfondo alle celle'),
          el('button', { type: 'button', class: 'btn small', text: 'Calibra', onclick: calibrate })),
        calInfo));
    for (const x of [kindSel, color, fit, bx, by, scale, opacity, inp.w, inp.h]) x.addEventListener('input', sync);
    kindSel.addEventListener('change', sync);
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) importBg(f); });

    const body = el('form', { class: 'form grid-props', onsubmit: (e) => e.preventDefault() },
      isNew ? field('Nome della griglia', inp.name, 'name') : null,
      el('div', { class: 'input-row' }, el('label', { class: 'inline' }, 'Tipo ', kindType), scaleRow),
      el('p', { class: 'muted small', text: 'Esplorazione: mappa di viaggio con biomi, eventi, nebbia e pedina del gruppo (si gioca dalla voce Esplorazione). Le griglie esistenti restano di battaglia.' }),
      el('div', { class: 'grid-3 tight' },
        field('Larghezza (celle)', inp.w, 'w', G.MIN_SIZE + '–' + G.MAX_SIZE),
        field('Altezza (celle)', inp.h, 'h', G.MIN_SIZE + '–' + G.MAX_SIZE),
        field('Piedi per cella', inp.feetPerCell, 'feetPerCell', '5 ft = 1,5 m')),
      isNew ? null : el('div', { class: 'input-row small' }, el('span', { class: 'muted small', text: 'Con ingrandimento o riduzione, colonne' }), sideX,
        el('span', { class: 'muted small', text: 'e righe' }), sideY),
      el('fieldset', {}, el('legend', { text: 'Sfondo' }),
        el('div', { class: 'bg-layout' }, el('div', {}, kindSel, colorRow, imageBox), preview)),
      errorBox);
    UT().acceptImages(body, () => body.isConnected, importBg);
    sync();
    syncKind();
    const dialog = openDialog(title, body, [
      { text: 'Annulla' },
      { text: isNew ? 'Crea griglia' : 'Applica', class: 'primary', onclick: () => {
        const values = {
          name: inp.name ? inp.name.value.trim() : undefined, w: readNumber(inp.w), h: readNumber(inp.h), feetPerCell: readNumber(inp.feetPerCell),
          background: readBg(), side: { x: sideX.value, y: sideY.value },
          kind: kindType.value, scale: { value: readNumber(scaleValue), unit: scaleUnit.value },
        };
        const errors = DnD.validazione.validateGridProps(values);
        if (kindSel.value === 'immagine' && !values.background) errors.background = 'Importa un\'immagine o scegli un altro sfondo.';
        if (!showErrors(body, errors)) { errorBox.textContent = errors.background || ''; return false; }
        const err = onOk(values);
        if (err) { errorBox.textContent = err; return false; }
        return undefined;
      } },
    ]);
    dialog.classList.add('wide');
    (inp.name || inp.w).focus();
  }
  const UT = () => DnD.uiTileset;

  function newGrid() {
    if (!confirmDiscard()) return;
    propsDialog('Nuova griglia', { name: '', w: G.DEFAULT_SIZE, h: G.DEFAULT_SIZE, feetPerCell: 5, background: null, kind: 'battaglia', scale: null }, true, (v) => {
      if (UG.nameTaken(v.name)) return 'Esiste già una griglia con questo nome.';
      const explore = v.kind === 'esplorazione';
      startDraft(null, v.name, { structures: [], items: [], labels: [], zones: [], tileMap: null, w: v.w, h: v.h, feetPerCell: v.feetPerCell, background: v.background,
        kind: v.kind, scale: DnD.esplorazione.normalizeScale(v.scale), biomeMap: explore ? DnD.biomi.emptyMap(v.w, v.h, 'bioma-pianura') : null,
        events: [], fog: { enabled: false, seen: '0'.repeat(v.w * v.h) } });
      return null;
    });
  }

  // Modifica delle proprietà della bozza aperta. Riducendo la griglia, gli elementi fuori dall'area vengono
  // elencati e tolti solo dopo la conferma.
  function editProps() {
    const d = draft();
    const g = d.grid;
    propsDialog('Proprietà di «' + d.name + '»', Object.assign(G.gridProps(g)), false, (v) => {
      const res = G.resizeGrid(g, v.w, v.h, v.side);
      if (res.lost.length && !confirm('Con la nuova dimensione questi elementi escono dall\'area e verranno tolti:\n• ' +
        res.lost.slice(0, 15).join('\n• ') + (res.lost.length > 15 ? '\n…e altri ' + (res.lost.length - 15) : '') + '\n\nContinuare?')) return 'Dimensione non applicata.';
      DnD.store.update((st) => {
        const gd = session(st).gridDraft;
        gd.grid = Object.assign(res.grid, { feetPerCell: v.feetPerCell, background: v.background, kind: v.kind, scale: DnD.esplorazione.normalizeScale(v.scale) });
        if (v.kind === 'esplorazione' && !gd.grid.biomeMap) gd.grid.biomeMap = DnD.biomi.emptyMap(v.w, v.h, '');
        if (!gd.grid.fog || gd.grid.fog.seen.length !== v.w * v.h) gd.grid.fog = DnD.esplorazione.normalizeFog(gd.grid.fog, v.w, v.h);
        if (gd.grid.tileMap) gd.grid.tileMap.feetPerCell = v.feetPerCell;
        gd.dirty = true;
      });
      updateStatus();
      render();
      toast('Griglia ' + v.w + '×' + v.h + ' celle.' + (res.lost.length ? ' Elementi tolti: ' + res.lost.length + '.' : ''), 'success');
      return null;
    });
  }

  // La griglia risulta salvata solo se la scrittura è riuscita davvero (es. spazio esaurito).
  async function save() {
    const d = draft();
    const existing = savedOf(d);
    if (UG.nameTaken(d.name, existing && existing.id)) {
      toast('Esiste già un\'altra griglia chiamata «' + d.name + '»: rinominala prima di salvare.', 'error');
      return;
    }
    const content = clone(Object.assign({ structures: d.grid.structures, items: d.grid.items, labels: d.grid.labels, zones: d.grid.zones, tileMap: d.grid.tileMap || null },
      G.gridProps(d.grid), DnD.esplorazione.extrasOf(d.grid)));
    const saved = Object.assign({
      id: existing ? existing.id : DnD.dadi.uid(),
      name: d.name,
      sessionId: existing ? existing.sessionId : session().id,
      shared: existing ? existing.shared : false,
      updatedAt: new Date().toISOString(),
      positions: existing ? existing.positions : [],
    }, content);
    const previous = existing ? clone(existing) : null;
    const previousId = d.gridId;
    const res = await DnD.store.update((st) => {
      const i = st.savedGrids.findIndex((g) => g.id === saved.id);
      if (i >= 0) st.savedGrids[i] = saved;
      else st.savedGrids.push(saved);
      session(st).gridDraft.gridId = saved.id;
      session(st).gridDraft.dirty = false;
    });
    if (!res.ok) {
      // Non scritta: la bozza resta con modifiche non salvate e la griglia torna com'era in memoria.
      DnD.store.update((st) => {
        const i = st.savedGrids.findIndex((g) => g.id === saved.id);
        if (previous) st.savedGrids[i] = previous; else if (i >= 0) st.savedGrids.splice(i, 1);
        session(st).gridDraft.gridId = previousId;
        session(st).gridDraft.dirty = true;
      });
      updateStatus();
      toast('Griglia «' + d.name + '» NON salvata: ' + res.message, 'error');
      return;
    }
    updateStatus();
    toast('Griglia «' + d.name + '» salvata.', 'success');
  }

  function rename() {
    const d = draft();
    promptText('Rinomina griglia', 'Nuovo nome', d.name, (name) => {
      const existing = savedOf(d);
      if (UG.nameTaken(name, existing && existing.id)) return 'Esiste già una griglia con questo nome.';
      DnD.store.update((st) => { session(st).gridDraft.name = name; session(st).gridDraft.dirty = true; });
      render();
      return null;
    });
  }

  function confirmLeave() {
    const d = draft();
    return !editing || !d || !d.dirty ||
      confirm('La griglia «' + d.name + '» ha modifiche non salvate. Uscire comunque?\nLa bozza resta conservata e potrai riprenderla dall\'elenco.');
  }

  function close() {
    if (!confirmLeave()) return;
    editing = false;
    render();
  }

  function render(container) {
    root = container || root;
    clear(root);
    const open = editing && draft();
    root.append(open ? editorHead() : el('div', { class: 'section-head' },
      el('h1', { text: 'Editor griglie' }),
      el('button', { class: 'btn primary', text: '+ Nuova griglia', onclick: newGrid })));
    const panel = el('div', { class: 'editor-panel' });
    root.append(panel);
    if (open) renderEditor(panel);
    else renderList(panel);
  }

  function renderList(panel) {
    const grids = DnD.sessioni.visible(DnD.store.state, 'savedGrids');
    const d = draft();
    // append() scriverebbe «null» come testo: i nodi assenti si tolgono.
    panel.append(...[
      d && d.dirty ? el('div', { class: 'panel draft-banner' },
        el('span', { text: '✎ Bozza con modifiche non salvate: «' + d.name + '»' }),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn small primary', text: 'Riprendi', onclick: () => { editing = true; render(); } }),
          el('button', { class: 'btn small danger', text: 'Scarta', onclick: () => {
            if (!confirm('Scartare le modifiche alla bozza «' + d.name + '»?')) return;
            DnD.store.update((st) => { session(st).gridDraft = null; });
            render();
          } }))) : null,
      grids.length
        ? el('div', { class: 'card-grid' }, grids.map((g) => el('article', { class: 'card grid-card' },
          el('div', { class: 'grid-card-thumb' }, UG.gridThumbnail(g, 140)),
          el('h3', {}, g.name, ' ', el('span', { class: 'tag' + (g.kind === 'esplorazione' ? ' accent' : ''), text: g.kind === 'esplorazione' ? '🧭 Esplorazione' : '⚔ Battaglia' })),
          el('p', { class: 'muted small', text: 'Ultima modifica: ' + UG.formatDate(g.updatedAt) }),
          g.kind === 'esplorazione' ? el('p', { class: 'muted small', text: DnD.esplorazione.scaleLabel(g.scale) + ' · ' + DnD.biomi.usedIds(g.biomeMap).length + ' biomi · ' + g.events.length + ' eventi' + (g.fog.enabled ? ' · nebbia' : '') }) : null,
          el('p', { class: 'muted small', text: g.w + '×' + g.h + ' celle da ' + g.feetPerCell + ' ft · ' + g.structures.length + ' strutture · ' + g.items.length + ' oggetti · ' +
            g.labels.length + ' etichette · ' + g.zones.length + ' zone' + (g.tileMap ? ' · TileMap ' + g.tileMap.layers.length + ' livelli' : '') +
            (g.background ? ' · sfondo ' + (g.background.kind === 'immagine' ? 'immagine' : 'colore') : '') }),
          el('label', { class: 'check small' },
            el('input', { type: 'checkbox', checked: g.shared, onchange: (e) => { DnD.store.update(() => { g.shared = e.target.checked; }); render(); } }),
            ' Condivisa con tutte le sessioni'),
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn primary', text: 'Apri', onclick: () => openGrid(g) }),
            el('button', { class: 'btn', text: 'Rinomina', onclick: () => UG.renameGrid(g, () => render()) }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => { UG.duplicateGrid(g); render(); } }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => { if (UG.deleteGrid(g)) render(); } })))))
        : DnD.ui.emptyState('Nessuna griglia in questa sessione',
          'Costruisci la mappa della sessione «' + session().name + '» prima di giocare: dimensione e sfondo, tile, muri, oggetti, etichette e zone di partenza.', [
            { text: 'Crea una griglia', primary: true, onclick: newGrid },
            { text: '+ Aggiungi nemici', onclick: () => DnD.app.navigate('nemici', 'nuovo') },
          ])].filter(Boolean));
  }

  function editorHead() {
    const d = draft();
    updateStatus();
    return el('div', { class: 'section-head' },
      el('div', {},
        el('h1', { text: d.name }),
        el('span', { class: 'muted small', text: d.grid.w + '×' + d.grid.h + ' celle · ' + (d.grid.kind === 'esplorazione' ? '🧭 esplorazione, ' + DnD.esplorazione.scaleLabel(d.grid.scale) : d.grid.feetPerCell + ' ft per cella') + ' · ' }),
        status),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn', text: 'Rinomina', onclick: rename }),
        el('button', { class: 'btn', text: '⚙ Proprietà', onclick: editProps }),
        el('button', { class: 'btn primary', text: '💾 Salva', onclick: save }),
        el('button', { class: 'btn', text: 'Chiudi', onclick: close })));
  }

  function renderEditor(panel) {
    const w = getWidget();
    const t = getTilePanel();
    const xp = getExplorePanel();
    panel.append(el('div', { class: 'editor-layout' }, w.node, xp.node, t.node));
    w.refresh();
    xp.refresh();
    t.refresh();
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.editor = {
    title: 'Editor griglie',
    render,
    reset: () => { editing = false; },
    canLeave: confirmLeave,
    // Azione rapida "Crea una griglia" dalle schermate vuote.
    open: (action) => { if (action === 'nuovo') setTimeout(newGrid); },
  };
  DnD.uiEditorGriglie = { propsDialog };
})(globalThis.DnD = globalThis.DnD || {});
