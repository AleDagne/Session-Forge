// TileSet e TileMap nell'interfaccia, parti condivise: colori dei canvas dal tema, vista con zoom e pan,
// disegno delle tilemap (livelli, tile grandi, orientamenti, tile di bordo parziali, segnaposto),
// anteprime, importazione delle immagini e salvataggio dei TileSet con conferme d'uso.
// Il taglio delle immagini in tile è nel componente ui-tile.js.
(function (DnD) {
  'use strict';

  const { el, clear, toast, openDialog } = DnD.ui;
  const T = DnD.tileset;
  const TM = DnD.tilemap;
  const L = DnD.immaginiLib;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const tilesetsById = () => TM.tilesetIndex(DnD.store.state.tilesets);
  const filled = (cells) => (cells.match(/1/g) || []).length;

  // ---------- Colori dei canvas (variabili CSS del tema) ----------
  let palette = null;
  const redrawers = new Set();
  function colors() {
    if (!palette) {
      const cs = getComputedStyle(document.documentElement);
      const v = (name) => cs.getPropertyValue(name).trim();
      palette = {
        bg: v('--grid-bg'), board: v('--grid-board'), line: v('--grid-line'), line5: v('--grid-line-strong'),
        label: v('--grid-label'), labelBg: v('--grid-label-bg'), text: v('--text'), accent: v('--accent'), selection: v('--selection'),
        missing: v('--grid-missing'), missingText: v('--grid-missing-text'),
        cut: v('--ts-cut'), selected: v('--ts-selected'), excluded: v('--ts-excluded'), blocking: v('--ts-blocking'),
        collision: v('--ts-collision'), collisionLine: v('--ts-collision-line'), vertex: v('--ts-vertex'), free: v('--ts-free'),
      };
    }
    return palette;
  }
  window.addEventListener('themechange', () => {
    palette = null;
    for (const redraw of redrawers) redraw();
  });
  // I canvas degli editor si ridisegnano al cambio tema (solo se sono nella pagina).
  const onThemeChange = (redraw) => redrawers.add(redraw);

  function sizedCanvas(w, h) {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas, ctx };
  }

  // ---------- Vista con zoom e pan (TileSet editor e TileMap editor) ----------
  // Coordinate di mondo distinte da quelle dello schermo: schermo = pan + mondo · zoom.
  // Rotella = zoom centrato sul puntatore; tasto centrale, Spazio tenuto premuto o opts.panMode() = pan.
  // opts: { label, draw(ctx, W, H), minZoom, maxZoom, panMode(), onDown(e, p), onMove(e, p), onUp(e, p), onLeave() }
  // con p = { sx, sy } in pixel CSS del canvas.
  function viewport(opts) {
    const canvas = el('canvas', { class: 'vp-canvas', tabindex: 0, 'aria-label': opts.label });
    const wrap = el('div', { class: 'vp-wrap' }, canvas);
    let view = { zoom: 1, panX: 0, panY: 0 };
    let raf = 0;
    let pan = null;
    let space = false;
    const size = () => ({ W: wrap.clientWidth, H: wrap.clientHeight });
    function draw() {
      if (!canvas.isConnected) return;
      const dpr = window.devicePixelRatio || 1;
      const { W, H } = size();
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.max(1, Math.round(W * dpr));
        canvas.height = Math.max(1, Math.round(H * dpr));
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      opts.draw(ctx, W, H);
    }
    function requestDraw() {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    }
    const clampZoom = (z) => Math.min(opts.maxZoom || 16, Math.max(opts.minZoom || 0.1, z));
    function zoomAt(sx, sy, factor) {
      const zoom = clampZoom(view.zoom * factor);
      const k = zoom / view.zoom;
      view = { zoom, panX: sx - (sx - view.panX) * k, panY: sy - (sy - view.panY) * k };
      requestDraw();
    }
    // Inquadra un rettangolo di mondo (w×h) al centro, con un margine.
    function fit(w, h, margin) {
      const { W, H } = size();
      if (!W || !H || !w || !h) return;
      const m = margin === undefined ? 24 : margin;
      const zoom = clampZoom(Math.min((W - 2 * m) / w, (H - 2 * m) / h));
      view = { zoom, panX: (W - w * zoom) / 2, panY: (H - h * zoom) / 2 };
      requestDraw();
    }
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => requestDraw()).observe(wrap);
    onThemeChange(requestDraw);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      if (e.button === 1 || space || (opts.panMode && opts.panMode())) {
        e.preventDefault();
        pan = { p0: p, view0: view };
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (opts.onDown) opts.onDown(e, p);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (pan) {
        view = { zoom: pan.view0.zoom, panX: pan.view0.panX + p.sx - pan.p0.sx, panY: pan.view0.panY + p.sy - pan.p0.sy };
        requestDraw();
        return;
      }
      if (opts.onMove) opts.onMove(e, p);
    });
    const up = (e) => {
      if (pan) { pan = null; canvas.style.cursor = ''; return; }
      if (opts.onUp) opts.onUp(e, local(e));
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (opts.onLeave) opts.onLeave(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.sx, p.sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); space = true; canvas.style.cursor = 'grab'; } });
    canvas.addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; canvas.style.cursor = ''; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    return {
      node: wrap, canvas, local, requestDraw, fit, size,
      view: () => view,
      setView: (v) => { view = v; requestDraw(); },
      // Zoom dai pulsanti: centrato sulla vista.
      zoomBy: (factor) => { const { W, H } = size(); zoomAt(W / 2, H / 2, factor); },
      panning: () => Boolean(pan) || space,
    };
  }

  // Immagine di una sorgente pronta per il disegno: { state: 'ok', img } | { state: 'loading' } | { state: 'missing' }.
  function sourceImage(src, onReady) {
    if (!src || !src.imageId) return { state: 'missing' };
    const res = DnD.immagini.drawable(src.imageId, onReady);
    // Sorgente migrata ancora senza dimensioni delle tile: si completa all'avvio.
    return res.state === 'ok' && !(src.tileW > 0) ? { state: 'loading' } : res;
  }

  // Disegna una tile già risolta (vedi tileset.resolveTile) nel rettangolo (dx, dy, dw, dh) con l'orientamento o.
  // I tile di bordo parziali (più piccoli del tile) occupano solo la parte coperta, alla stessa scala degli altri.
  function drawTile(ctx, r, img, o, dx, dy, dw, dh) {
    const [m00, m01, m10, m11] = T.ORIENTS[o];
    const swap = m00 === 0;
    const bw = swap ? dh : dw;
    const bh = swap ? dw : dh;
    const fw = r.src.tileW > 0 ? Math.min(1, r.rect.sw / r.src.tileW) : 1;
    const fh = r.src.tileH > 0 ? Math.min(1, r.rect.sh / r.src.tileH) : 1;
    if (!(r.rect.sw > 0 && r.rect.sh > 0)) return;
    ctx.save();
    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.transform(m00, m10, m01, m11, 0, 0);
    ctx.imageSmoothingEnabled = Boolean(r.ts.smooth); // pixel art nitida, salvo "Smussa"
    ctx.drawImage(img, r.rect.sx, r.rect.sy, r.rect.sw, r.rect.sh, -bw / 2, -bh / 2, bw * fw, bh * fh);
    ctx.restore();
  }

  // Disegna una tilemap con origine (ox, oy) e celle di "cell" pixel, livello per livello nell'ordine.
  // opts: { above: true | false (solo i livelli sopra/sotto le pedine; tutti se assente), alpha, clip
  // { x0, y0, x1, y1 } in celle, onReady, byId, showHidden, layerAlpha(layer, i), cellAlpha(layer, x, y, span) }.
  // Tile, sorgenti o immagini mancanti: segnaposto grigio. Restituisce { missing }.
  function drawTiles(ctx, tiles, ox, oy, cell, opts) {
    const o = opts || {};
    const byId = o.byId || tilesetsById();
    const c0 = o.clip || { x0: 0, y0: 0, x1: tiles.w - 1, y1: tiles.h - 1 };
    const back = tiles.cellW > 0 ? TM.MAX_SPAN - 1 : 0; // le tile grandi ancorate fuori dalla vista
    const x0 = Math.max(0, c0.x0 - back);
    const y0 = Math.max(0, c0.y0 - back);
    const x1 = Math.min(tiles.w - 1, c0.x1);
    const y1 = Math.min(tiles.h - 1, c0.y1);
    let missing = false;
    ctx.save();
    tiles.layers.forEach((layer, li) => {
      if (o.above !== undefined && Boolean(layer.above) !== o.above) return;
      if (!layer.visible && !o.showHidden) return;
      const base = (o.alpha === undefined ? 1 : o.alpha) * layer.opacity * (o.layerAlpha ? o.layerAlpha(layer, li) : 1);
      if (base <= 0) return;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * tiles.w + x;
          const c = layer.data[i];
          if (!c) continue;
          // Modalità A: i tile non selezionati non si disegnano, salvo "Disegna anche le parti fuori selezione".
          if (tiles.kind === 'immagine' && !tiles.drawAll && tiles.mask[i] !== '1') continue;
          const span = TM.spanOf(tiles, byId, c);
          if (x + span.w - 1 < c0.x0 || y + span.h - 1 < c0.y0) continue;
          const ts = byId[tiles.tilesets[c[0]]];
          const r = ts ? T.resolveTile(ts, c[1]) : null;
          const res = r ? sourceImage(r.src, o.onReady) : { state: 'missing' };
          const dx = ox + x * cell;
          const dy = oy + y * cell;
          ctx.globalAlpha = base * (o.cellAlpha ? o.cellAlpha(layer, x, y, span) : 1);
          if (res.state === 'missing') {
            missing = true;
            ctx.fillStyle = colors().missing;
            ctx.fillRect(dx, dy, span.w * cell, span.h * cell);
            continue;
          }
          if (res.state !== 'ok' || T.isExcluded(ts, c[1])) continue;
          drawTile(ctx, r, res.img, c[2], dx, dy, span.w * cell, span.h * cell);
        }
      }
    });
    ctx.restore();
    return { missing };
  }

  // La tilemap usa un TileSet, una sorgente o un'immagine che non c'è più?
  function missingTilesets(tiles, onReady, index) {
    const byId = index || tilesetsById();
    return tiles.layers.some((l) => l.data.some((c) => {
      if (!c) return false;
      const ts = byId[tiles.tilesets[c[0]]];
      const r = ts && T.resolveTile(ts, c[1]);
      return !r || sourceImage(r.src, onReady).state === 'missing';
    }));
  }

  // Miniatura di una tile (con orientamento) su un canvas di size px.
  function tileThumb(ts, id, size, o) {
    const { canvas, ctx } = sizedCanvas(size, size);
    canvas.className = 'tile-thumb';
    const paint = () => {
      ctx.clearRect(0, 0, size, size);
      const r = T.resolveTile(ts, id);
      const res = r ? sourceImage(r.src, paint) : { state: 'missing' };
      if (res.state === 'missing') { ctx.fillStyle = colors().missing; ctx.fillRect(0, 0, size, size); return; }
      if (res.state !== 'ok') return;
      const k = Math.min(size / r.rect.sw, size / r.rect.sh);
      const w = r.rect.sw * k;
      const h = r.rect.sh * k;
      drawTile(ctx, r, res.img, o || 0, (size - w) / 2, (size - h) / 2, w, h);
    };
    paint();
    return canvas;
  }

  // Miniatura di un modello: tilemap, altrimenti forma o icona.
  function templatePreview(t, kind, size) {
    if (!(t.mode === 'tiles' && t.tiles)) {
      return kind === 'item' ? DnD.icone.iconCanvas(t.icon, size) : DnD.uiStrutture.shapeCanvas(t, t.color, size);
    }
    const tiles = t.tiles;
    const cell = size / Math.max(tiles.w, tiles.h);
    const { canvas, ctx } = sizedCanvas(tiles.w * cell, tiles.h * cell);
    canvas.className = 'shape-canvas image-preview';
    const paint = () => {
      ctx.clearRect(0, 0, tiles.w * cell, tiles.h * cell);
      drawTiles(ctx, tiles, 0, 0, cell, { onReady: paint });
    };
    paint();
    return canvas;
  }

  // ---------- Importazione delle immagini e salvataggio dei TileSet ----------
  const imageName = (file) => ((file && file.name) || 'Texture').replace(/\.[^.]+$/, '').slice(0, 60) || 'Texture';

  // File -> immagine salvata in IndexedDB (una sola copia per contenuto) e pronta per una sorgente:
  // { name, imageId, imageW, imageH, alpha, warnings }. Gli errori (formato, quota) arrivano come eccezioni.
  async function importImage(file) {
    const res = await L.importFile(file, { maxSide: T.MAX_IMAGE_SIDE, largeSide: T.LARGE_IMAGE_SIDE, largeFile: T.LARGE_FILE });
    let imageId;
    try {
      imageId = await DnD.immagini.put(res.dataUrl);
    } catch (e) {
      throw new Error('immagine non salvata: ' + DnD.dati.saveErrorMessage(e));
    }
    const { alpha } = await L.readAlpha(res.dataUrl);
    return { name: imageName(file), imageId, imageW: res.width, imageH: res.height, alpha, warnings: res.warnings };
  }

  // Aggiunge l'immagine come sorgente del TileSet (in memoria): taglio proposto e tile vuote escluse.
  function addImageSource(ts, image) {
    const src = T.addSource(ts, image);
    T.applyEmpty(ts, src, T.detectEmpty(image.alpha, image.imageW, image.imageH, src, ts.threshold));
    return src;
  }

  // Aggiorna l'ingombro dei modelli che usano un TileSet (dopo una modifica di flag o collisioni).
  // Gli elementi già piazzati sulle griglie sono copie e restano come sono.
  function refreshTemplates(st, tilesetId) {
    const byId = TM.tilesetIndex(st.tilesets);
    for (const [list, kind] of [[st.structures, 'structure'], [st.mapObjects, 'item']]) {
      for (const x of list) if (x.tiles && x.tiles.tilesets.includes(tilesetId)) x.tiles = DnD.collisioni.withFootprint(x.tiles, byId, kind);
    }
  }

  // Salva (aggiunge o sostituisce) un TileSet; restituisce l'esito reale della scrittura.
  async function saveTileset(ts) {
    const saved = DnD.dati.normalizeTileset(ts);
    const res = await DnD.store.update((st) => {
      const i = st.tilesets.findIndex((x) => x.id === saved.id);
      if (i >= 0) st.tilesets[i] = saved;
      else st.tilesets.push(saved);
      refreshTemplates(st, saved.id);
    });
    if (!res.ok) toast('TileSet «' + saved.name + '» NON salvato: ' + res.message, 'error');
    return Object.assign({ tileset: saved }, res);
  }

  // Nuovo TileSet da un file immagine (una sorgente).
  async function tilesetFromFile(file) {
    const image = await importImage(file);
    const ts = T.newTileset(DnD.dadi.uid(), image.name);
    addImageSource(ts, image);
    const res = await saveTileset(ts);
    for (const w of image.warnings) toast('⚠ ' + w);
    return res.ok ? res.tileset : null;
  }

  // Conferma prima di eliminare qualcosa che è usato: indica dove.
  function confirmUse(what, uses) {
    if (!uses.length) return confirm('Eliminare ' + what + '?');
    return confirm(what.charAt(0).toUpperCase() + what.slice(1) + ' è usato in:\n• ' + uses.slice(0, 12).join('\n• ') +
      (uses.length > 12 ? '\n…e altri ' + (uses.length - 12) : '') +
      '\n\nEliminandolo, quelle celle mostreranno un segnaposto grigio. Eliminare comunque?');
  }

  // Immagine trascinata sul contenitore o incollata (Ctrl+V) mentre isActive() è vero. onFile(file).
  function acceptImages(target, isActive, onFile) {
    target.addEventListener('dragover', (e) => { if (isActive() && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); target.classList.add('dragging'); } });
    target.addEventListener('dragleave', () => target.classList.remove('dragging'));
    target.addEventListener('drop', (e) => {
      target.classList.remove('dragging');
      if (!isActive() || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      onFile(e.dataTransfer.files[0]);
    });
    const onPaste = (e) => {
      if (!target.isConnected) { document.removeEventListener('paste', onPaste); return; }
      if (!isActive()) return;
      const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (!item) return;
      e.preventDefault();
      onFile(item.getAsFile());
    };
    document.addEventListener('paste', onPaste);
  }

  // Sorgenti migrate: completa la dimensione delle tile quando si conoscono i pixel dell'immagine.
  async function resolveLegacyTilesets() {
    let changed = false;
    for (const ts of DnD.store.state.tilesets) {
      for (const src of ts.sources.filter((s) => s.legacy && !(s.tileW > 0))) {
        const data = await DnD.immagini.get(src.imageId);
        if (!data) continue;
        const img = await L.loadImage(data);
        const resolved = DnD.dati.normalizeSource(T.resolveLegacy(src, img.naturalWidth, img.naturalHeight), src.id);
        DnD.store.update(() => { ts.sources[ts.sources.indexOf(src)] = resolved; });
        changed = true;
      }
    }
    return changed;
  }

  DnD.uiTileset = {
    colors, onThemeChange, sizedCanvas, viewport, sourceImage, drawTile, drawTiles, missingTilesets, tileThumb, templatePreview,
    importImage, addImageSource, refreshTemplates, saveTileset, tilesetFromFile, confirmUse, acceptImages, resolveLegacyTilesets,
  };
})(globalThis.DnD = globalThis.DnD || {});
