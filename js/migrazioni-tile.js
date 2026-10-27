// Migrazioni dei vecchi formati delle tile (dati grezzi, prima della normalizzazione): immagini «stirate» della
// versione 5 -> tilemap su TileSet «legacy» (formato 6), poi TileSet con sorgenti e livelli generici (versione 7).
// Livello stato (migrazioni). Espone DnD.migrazioniTile { legacyTilesetId, opsFor, migrateLegacy, migrateV7,
// migrateRaw }; usa DnD.tileset, DnD.tilemap (visita delle tilemap) e DnD.griglia (matrici di rotazione).
// Non deve toccare DOM, disco o rete. Le dimensioni in pixel delle sorgenti legacy si completano all'avvio
// (tileset.resolveLegacy, ui-tileset).
(function (DnD) {
  'use strict';

  const TS = () => DnD.tileset;

  // ---------- Migrazione dalla versione 5: immagini "stirate" -> tileset (formato della versione 6) ----------
  // Le strutture e gli oggetti con "image" diventano tilemap su un tileset "legacy": tile = immagine /
  // celle dell'area (completato all'avvio, quando si conoscono le dimensioni in pixel).
  const legacyTilesetId = (imageId, w, h) => 'ts-' + imageId.slice(4) + '-' + w + 'x' + h;
  const legacyTiles = (w, h) => {
    const n = w * h;
    return { kind: 'immagine', w, h, tilesets: [], layers: [{ name: 'Base', visible: true, data: Array(n).fill(null) }, { name: 'Sopra', visible: true, data: Array(n).fill(null) }],
      mask: '1'.repeat(n), drawAll: false, overrides: '-'.repeat(n), fade: false, sel: '', cells: '0'.repeat(n) };
  };
  // Rotazione/specchio di una tilemap nel formato della versione 6 (due livelli, celle [ts, indice, orientamento]).
  function legacyTransform(t, op) {
    const G = DnD.griglia;
    const orient = (o) => TS().ORIENTS.findIndex((m) => m.every((v, i) => v === (op === 'ruota' ? G.rotateMatrix(TS().ORIENTS[o]) : G.mirrorMatrix(TS().ORIENTS[o]))[i]));
    const rotate = op === 'ruota';
    const w = rotate ? t.h : t.w;
    const h = rotate ? t.w : t.h;
    const src = (x, y) => (rotate ? (t.h - 1 - x) * t.w + y : y * t.w + (t.w - 1 - x));
    const remap = (get) => { const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(get(src(x, y))); return out; };
    return Object.assign({}, t, {
      w, h,
      layers: t.layers.map((l) => Object.assign({}, l, { data: remap((i) => (l.data[i] ? [l.data[i][0], l.data[i][1], orient(l.data[i][2])] : null)) })),
      mask: remap((i) => t.mask[i]).join(''), overrides: remap((i) => t.overrides[i]).join(''), cells: remap((i) => t.cells[i]).join(''),
    });
  }
  function opsFor(m) {
    const G = DnD.griglia;
    const key = (x) => x.join(',');
    const seen = new Map([[key([1, 0, 0, 1]), []]]);
    const queue = [[1, 0, 0, 1]];
    while (queue.length) {
      const cur = queue.shift();
      if (key(cur) === key(m)) return seen.get(key(cur));
      for (const [op, next] of [['ruota', G.rotateMatrix(cur)], ['specchia', G.mirrorMatrix(cur)]]) {
        if (!seen.has(key(next))) { seen.set(key(next), seen.get(key(cur)).concat(op)); queue.push(next); }
      }
    }
    return [];
  }

  function migrateLegacy(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    raw.tilesets = Array.isArray(raw.tilesets) ? raw.tilesets : [];
    const valid = (im) => im && typeof im === 'object' && /^img-[0-9a-f]{16}$/.test(im.id) && im.w >= 1 && im.h >= 1;
    const ensure = (im) => {
      const id = legacyTilesetId(im.id, im.w, im.h);
      if (!raw.tilesets.some((t) => t && t.id === id)) {
        const n = im.w * im.h;
        raw.tilesets.push({ id, name: 'Immagine importata (' + im.w + '×' + im.h + ')', imageId: im.id, imageW: 0, imageH: 0, tileW: 0, tileH: 0,
          margin: 0, spacing: 0, cols: im.w, rows: im.h, smooth: true, blocking: '0'.repeat(n), empty: '0'.repeat(n), legacy: true });
      }
      return id;
    };
    const tilesFrom = (im, cells) => {
      const t = legacyTiles(im.w, im.h);
      t.tilesets = [ensure(im)];
      t.layers[im.layer === 'sopra' ? 1 : 0].data = t.layers[0].data.map((_, i) => [0, i, 0]);
      const mask = typeof cells === 'string' && cells.length === im.w * im.h ? cells : '1'.repeat(im.w * im.h);
      return Object.assign(t, { mask, sel: mask, cells: mask, drawAll: true, fade: Boolean(im.fade) });
    };
    const template = (x) => {
      if (x && x.mode === 'image' && valid(x.image)) {
        x.tiles = tilesFrom(x.image, x.image.cells);
        x.mode = 'tiles';
      }
      if (x) delete x.image;
    };
    const placed = (p) => {
      if (!p || !valid(p.image)) { if (p) delete p.image; return; }
      let t = tilesFrom(p.image, null);
      for (const op of opsFor(Array.isArray(p.image.m) ? p.image.m.map(Number) : [1, 0, 0, 1])) t = legacyTransform(t, op);
      if (typeof p.cells === 'string' && p.cells.length === t.w * t.h) t = Object.assign(t, { mask: p.cells, cells: p.cells });
      p.tiles = t;
      delete p.image;
    };
    const grid = (g) => { if (g && typeof g === 'object') { (g.structures || []).forEach(placed); (g.items || []).forEach(placed); } };
    (raw.structures || []).forEach(template);
    (raw.items || []).forEach(template);
    (raw.savedGrids || []).forEach(grid);
    for (const s of raw.sessions || []) if (s) { grid(s.combat && s.combat.grid); grid(s.gridDraft && s.gridDraft.grid); }
    if (raw.session) { grid(raw.session.combat && raw.session.combat.grid); grid(raw.session.gridDraft && raw.session.gridDraft.grid); }
    grid(raw.combat && raw.combat.grid);
    grid(raw.gridDraft && raw.gridDraft.grid);
    return raw;
  }

  // ---------- Migrazione alla versione 7: TileSet con sorgenti e id stabili, livelli generici ----------
  // Tileset della versione 6 (un'immagine, flag "blocking"/"empty" per indice) -> una sorgente (id 0);
  // celle [ts, indice, orientamento] -> [ts, tileId, orientamento]; i due livelli fissi Base/Sopra
  // diventano livelli completi ("Sopra" sopra le pedine, con la semitrasparenza della tilemap).
  function migrateV7(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 7) return raw;
    const cols = {};
    raw.tilesets = (Array.isArray(raw.tilesets) ? raw.tilesets : []).map((t) => {
      if (!t || typeof t !== 'object' || Array.isArray(t.sources)) return t;
      const c = Math.max(1, Math.round(Number(t.cols)) || 1);
      cols[t.id] = c;
      const tiles = {};
      const bits = (s) => (typeof s === 'string' ? s : '');
      for (let i = 0; i < Math.max(bits(t.blocking).length, bits(t.empty).length); i++) {
        const p = {};
        if (bits(t.blocking)[i] === '1') p.blocking = true;
        if (bits(t.empty)[i] === '1') p.excluded = true;
        if (Object.keys(p).length) tiles[TS().tileId(0, i % c, Math.floor(i / c))] = p;
      }
      const m = Number(t.margin) || 0;
      const sp = Number(t.spacing) || 0;
      return {
        id: t.id, name: t.name, smooth: t.smooth, threshold: t.threshold, blockThreshold: TS().BLOCK_THRESHOLD, nextSourceId: 1,
        sources: [{ id: 0, name: t.name, imageId: t.imageId, imageW: t.imageW, imageH: t.imageH, tileW: t.tileW, tileH: t.tileH,
          offsetX: m, offsetY: m, margin: 0, sepX: sp, sepY: sp, cols: t.cols, rows: t.rows, legacy: t.legacy }],
        tiles,
      };
    });
    DnD.tilemap.eachTilemap(raw, (tm) => {
      if (!tm || typeof tm !== 'object' || !Array.isArray(tm.layers)) return;
      const refs = Array.isArray(tm.tilesets) ? tm.tilesets : [];
      tm.layers = tm.layers.slice(0, 2).map((l, li) => {
        l = l && typeof l === 'object' ? l : {};
        const data = (Array.isArray(l.data) ? l.data : []).map((c) => {
          if (!Array.isArray(c) || c.length !== 3) return null;
          const n = cols[refs[c[0]]] || 1;
          return [c[0], TS().tileId(0, c[1] % n, Math.floor(c[1] / n)), c[2]];
        });
        return { id: 'l' + li, name: li ? 'Sopra' : 'Base', visible: l.visible !== false, opacity: 1, above: li === 1, fade: li === 1 && Boolean(tm.fade), locked: false, data };
      });
      tm.source = 0;
      delete tm.fade;
    });
    return raw;
  }

  // Tutte le migrazioni dei dati grezzi, nell'ordine, prima della normalizzazione.
  const migrateRaw = (raw) => migrateV7(migrateLegacy(raw));

  DnD.migrazioniTile = { legacyTilesetId, opsFor, migrateLegacy, migrateV7, migrateRaw };
})(globalThis.DnD = globalThis.DnD || {});
