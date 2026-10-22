// Componente "Taglia immagine in tile" (logica pura). L'unico controllo è la dimensione del tile, larghezza
// (X) e altezza (Y) in pixel: la griglia parte dall'angolo in alto a sinistra e copre sempre tutta
// l'immagine (colonne = ⌈larghezza / X⌉, righe = ⌈altezza / Y⌉). I tile di bordo che non coprono una cella
// intera sono tagliati sul bordo dell'immagine ("parziali") e si disegnano senza deformarli.
// Un tile è identificato da (id del TileSet, colonna, riga): cambiando X o Y i flag restano sulle stesse
// coordinate. Flag per tile: Bloccante, Vuoto/escluso, Terreno difficile (costo di movimento 2).
// Usato da Asset > Strutture ("Da immagine") e dal pannello Tile sotto la griglia.
(function (DnD) {
  'use strict';

  const T = () => DnD.tileset;
  const PRESETS = [16, 32, 48, 64, 128];
  const MAX_TILE = 4096;
  const FLAGS = ['blocking', 'excluded', 'difficult'];
  const FLAG_NAMES = { blocking: 'Bloccante', excluded: 'Vuoto/escluso', difficult: 'Terreno difficile' };
  const DIFFICULT_COST = 2;

  // Colonne e righe che coprono un'immagine imgW × imgH con tile tw × th.
  function grid(imgW, imgH, tw, th) {
    const cols = tw > 0 && imgW > 0 ? Math.ceil(imgW / tw - 1e-9) : 0;
    const rows = th > 0 && imgH > 0 ? Math.ceil(imgH / th - 1e-9) : 0;
    return { cols, rows, total: cols * rows, partialCols: imgW % tw !== 0, partialRows: imgH % th !== 0 };
  }

  // "N colonne × M righe = T tile"
  function gridText(g) {
    return g.cols + (g.cols === 1 ? ' colonna' : ' colonne') + ' × ' + g.rows + (g.rows === 1 ? ' riga' : ' righe') + ' = ' + g.total + ' tile';
  }

  const validSize = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_TILE;

  // Imposta X e Y di una sorgente (modifica src) con il taglio a copertura. Gli offset, i margini e le
  // spaziature dei TileSet precedenti restano salvati (i riferimenti restano validi), ma l'interfaccia
  // espone solo X e Y.
  function setTileSize(src, tw, th) {
    if (!validSize(tw) || !validSize(th)) throw new Error('La dimensione del tile deve essere un intero tra 1 e ' + MAX_TILE + ' pixel.');
    src.tileW = tw;
    src.tileH = th;
    src.cover = true;
    src.legacy = false;
    return T().recut(src);
  }

  // Tile parziali di una sorgente (indici riga per riga).
  function partialTiles(src) {
    const out = [];
    for (let r = 0; r < src.rows; r++) for (let c = 0; c < src.cols; c++) if (T().isPartial(src, c, r)) out.push(r * src.cols + c);
    return out;
  }

  // ---------- Flag ----------
  function flagsOf(ts, id) {
    const p = T().tileProps(ts, id);
    return { blocking: Boolean(p.blocking), excluded: Boolean(p.excluded), difficult: p.cost >= DIFFICULT_COST };
  }

  // Imposta un flag su più tile (modifica ts).
  function setFlag(ts, ids, flag, value) {
    if (flag === 'difficult') T().setTileProps(ts, ids, { cost: value ? DIFFICULT_COST : 1 });
    else if (flag === 'blocking') T().setTileProps(ts, ids, { blocking: Boolean(value) });
    else if (flag === 'excluded') T().setTileProps(ts, ids, { excluded: Boolean(value) });
  }

  // Rileva i tile vuoti (meno della soglia di pixel non trasparenti, 5% di base) e li segna come esclusi;
  // gli altri tornano inclusi. Restituisce la stringa dei tile vuoti ("1" = vuoto).
  function detectEmpty(ts, src, alpha, threshold) {
    const bits = T().detectEmpty(alpha, src.imageW, src.imageH, src, threshold === undefined ? ts.threshold : threshold);
    T().applyEmpty(ts, src, bits);
    return bits;
  }

  // ---------- Selezione ----------
  // Indici dei tile nel rettangolo tra a e b (indici riga per riga su cols colonne).
  function rectIndices(cols, a, b) {
    const [ax, ay, bx, by] = [a % cols, Math.floor(a / cols), b % cols, Math.floor(b / cols)];
    const out = [];
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push(y * cols + x);
    return out;
  }

  // Selezione come stringa di "0"/"1": imposta value sugli indici dati.
  function setBits(bits, indices, value) {
    const a = bits.split('');
    for (const i of indices) if (i >= 0 && i < a.length) a[i] = value ? '1' : '0';
    return a.join('');
  }
  const invertBits = (bits) => bits.replace(/[01]/g, (ch) => (ch === '1' ? '0' : '1'));
  // Selezione dai pixel: i tile non vuoti (non esclusi).
  const notExcluded = (ts, src) => T().sourceTileIds(src).map((id) => (T().isExcluded(ts, id) ? '0' : '1')).join('');

  // Riporta una selezione fatta su una griglia (oldCols × oldRows) sulla nuova: stesse coordinate (colonna, riga).
  function remapBits(bits, oldCols, oldRows, cols, rows, fill) {
    let out = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) out += c < oldCols && r < oldRows ? bits[r * oldCols + c] || fill : fill;
    }
    return out;
  }

  // ---------- Cambio dimensione di un TileSet già usato ----------
  // Dove è usato (mappe, strutture, oggetti): elenco di descrizioni (vedi tilemap.usage).
  const usage = (state, tilesetId) => DnD.tilemap.usage(state, tilesetId);

  // "Salva come nuovo tileset": copia con la nuova dimensione; i flag si copiano per (colonna, riga).
  function copyWithSize(ts, srcId, tw, th, newId, name) {
    const copy = JSON.parse(JSON.stringify(ts));
    copy.id = newId;
    copy.name = (name || ts.name + ' (' + tw + '×' + th + ')').slice(0, 60);
    setTileSize(T().sourceOf(copy, srcId), tw, th);
    return copy;
  }

  // Applica la nuova dimensione a tutti (modifica ts). Restituisce la sorgente aggiornata.
  function applySize(ts, srcId, tw, th) {
    return setTileSize(T().sourceOf(ts, srcId), tw, th);
  }

  DnD.tile = {
    PRESETS, MAX_TILE, FLAGS, FLAG_NAMES, DIFFICULT_COST,
    grid, gridText, validSize, setTileSize, partialTiles, flagsOf, setFlag, detectEmpty,
    rectIndices, setBits, invertBits, notExcluded, remapBits, usage, copyWithSize, applySize,
  };
})(globalThis.DnD = globalThis.DnD || {});
