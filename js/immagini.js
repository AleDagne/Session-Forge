// Immagini importate (i tileset): impronta del contenuto, archivio in IndexedDB (chiave "img:<id>",
// fuori dallo stato, una sola copia per contenuto) con cache in memoria delle immagini decodificate.
(function (DnD) {
  'use strict';

  const MAX_DATA_URL = 24 * 1024 * 1024;
  const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  const ACCEPTED_EXT = /\.(png|jpe?g|webp|svg)$/i;

  // ---------- Funzioni pure ----------
  function isStoredImageUrl(v) {
    return typeof v === 'string' && v.length <= MAX_DATA_URL && DATA_URL.test(v);
  }

  // Impronta del contenuto (FNV-1a a 32 bit con due semi): stessa immagine -> stesso id.
  function imageId(dataUrl) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < dataUrl.length; i++) {
      const c = dataUrl.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    }
    return 'img-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  // Canale alfa da dati RGBA (ImageData.data).
  function alphaFromRgba(data) {
    const out = new Uint8Array(data.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3];
    return out;
  }

  function isAcceptedFile(file) {
    return Boolean(file) && (ACCEPTED_TYPES.includes(file.type) || (!file.type && ACCEPTED_EXT.test(file.name || '')));
  }

  // Immagini valide di un file esportato: solo quelle il cui id corrisponde al contenuto.
  function validImages(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, data] of Object.entries(raw)) if (isStoredImageUrl(data) && imageId(data) === id) out[id] = data;
    return out;
  }

  // Id delle immagini importate usate (di tutto l'archivio o di una sessione esportata): sorgenti dei
  // TileSet e sfondi delle griglie (salvate, bozze e combattimenti).
  function referencedIds(state) {
    const ids = (state.tilesets || []).flatMap((t) => (t.sources || []).map((s) => s.imageId));
    const bg = (g) => { if (g && g.background && g.background.imageId) ids.push(g.background.imageId); };
    for (const g of state.savedGrids || []) bg(g);
    const session = (s) => { if (s) { if (s.combat) bg(s.combat.grid); if (s.gridDraft) bg(s.gridDraft.grid); } };
    for (const s of state.sessions || []) session(s);
    session(state.session);
    return [...new Set(ids.filter(Boolean))];
  }

  // ---------- Archivio con cache ----------
  // backend: { get(key) -> Promise<string|null>, set(key, value) -> Promise }
  function createStore(backend) {
    const cache = new Map(); // id -> { status: 'loading' | 'ok' | 'missing', data, img, waiters }
    const key = (id) => 'img:' + id;

    async function put(dataUrl) {
      if (!isStoredImageUrl(dataUrl)) throw new Error('Immagine non valida.');
      const id = imageId(dataUrl);
      const entry = cache.get(id);
      if (!entry || entry.status !== 'ok') {
        await backend.set(key(id), dataUrl);
        cache.set(id, { status: 'ok', data: dataUrl, img: null, waiters: [] });
      }
      return id;
    }

    async function get(id) {
      const entry = cache.get(id);
      if (entry && entry.data) return entry.data;
      let data = null;
      try { data = await backend.get(key(id)); } catch (e) { data = null; }
      if (isStoredImageUrl(data)) {
        cache.set(id, Object.assign(cache.get(id) || { img: null, waiters: [] }, { status: 'ok', data }));
        return data;
      }
      cache.set(id, Object.assign(cache.get(id) || { img: null, waiters: [] }, { status: 'missing', data: null }));
      return null;
    }

    async function getMany(ids) {
      const out = {};
      for (const id of ids) {
        const data = await get(id);
        if (data) out[id] = data;
      }
      return out;
    }

    // Per il canvas (sincrono): { state: 'ok', img } | { state: 'loading' } | { state: 'missing' }.
    // Al primo accesso avvia caricamento e decodifica e poi chiama onReady.
    function drawable(id, onReady) {
      let entry = cache.get(id);
      if (entry && entry.img) return { state: 'ok', img: entry.img };
      if (entry && entry.status === 'missing') return { state: 'missing' };
      if (!entry) {
        entry = { status: 'loading', data: null, img: null, waiters: [] };
        cache.set(id, entry);
      }
      if (onReady && !entry.waiters.includes(onReady)) entry.waiters.push(onReady);
      if (!entry.decoding) {
        entry.decoding = get(id).then((data) => (data ? decode(data) : null)).then((img) => {
          const e = cache.get(id);
          if (img) e.img = img;
          const waiters = e.waiters;
          e.waiters = [];
          waiters.forEach((cb) => cb());
        });
      }
      return { state: 'loading' };
    }

    // reset(): svuota la cache in memoria (dopo "Cancella tutti i dati").
    return { put, get, getMany, drawable, reset: () => cache.clear(), status: (id) => (cache.get(id) ? cache.get(id).status : 'unknown') };
  }

  // ---------- Solo browser: decodifica, importazione e ritaglio ----------
  async function decode(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (e) { /* ripiego sotto */ }
    }
    return loadImage(dataUrl);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Impossibile leggere l\'immagine.'));
      img.src = src;
    });
  }

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Impossibile leggere il file.'));
      r.readAsDataURL(file);
    });
  }

  // File (PNG, JPG, WebP; SVG convertito in PNG) -> { dataUrl, width, height, warnings }.
  // PNG, JPG e WebP si conservano byte per byte: nessun ridimensionamento né ricompressione (la pixel
  // art e le linee di taglio restano esatte). Per i file molto grandi c'è solo un avviso.
  // opts: { maxSide (limite tecnico), largeSide, largeFile (soglie degli avvisi) }.
  async function importFile(file, opts) {
    const o = typeof opts === 'number' ? { maxSide: opts } : opts || {};
    if (!isAcceptedFile(file)) throw new Error('Formato non supportato: usa un\'immagine PNG, JPG o WebP.');
    if (file.size > 40 * 1024 * 1024) throw new Error('L\'immagine è troppo grande (massimo 40 MB).');
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth || 512;
      const h = img.naturalHeight || 512;
      if (o.maxSide && Math.max(w, h) > o.maxSide) {
        throw new Error('Impossibile usare l\'immagine: è di ' + w + '×' + h + ' px, il massimo gestibile è ' + o.maxSide + ' px per lato.');
      }
      const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
      let dataUrl = svg ? '' : await readDataUrl(file);
      // SVG, o file senza tipo riconosciuto: si converte in PNG (senza perdita).
      if (!isStoredImageUrl(dataUrl)) {
        const canvas = canvasOf(w, h);
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        dataUrl = canvas.toDataURL('image/png');
      }
      if (!isStoredImageUrl(dataUrl)) throw new Error('Impossibile convertire l\'immagine.');
      const warnings = [];
      if (o.largeSide && Math.max(w, h) > o.largeSide) warnings.push('L\'immagine è molto grande (' + w + '×' + h + ' px): l\'editor potrebbe rallentare.');
      if (o.largeFile && file.size > o.largeFile) warnings.push('Il file è molto pesante (' + Math.round(file.size / 1048576) + ' MB): occupa molto spazio nell\'archivio.');
      return { dataUrl, width: w, height: h, warnings };
    } catch (e) {
      throw new Error(e && e.message && e.message.startsWith('Imposs') ? e.message : 'Il file non è un\'immagine valida.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Canale alfa di un'immagine salvata: { alpha, w, h }.
  async function readAlpha(dataUrl) {
    const img = await loadImage(dataUrl);
    const canvas = canvasOf(img.naturalWidth, img.naturalHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { alpha: alphaFromRgba(ctx.getImageData(0, 0, canvas.width, canvas.height).data), w: canvas.width, h: canvas.height };
  }

  DnD.immaginiLib = {
    ACCEPTED_TYPES, isStoredImageUrl, imageId, alphaFromRgba, isAcceptedFile, validImages, referencedIds, createStore,
    importFile, readAlpha, loadImage, decode,
  };
})(globalThis.DnD = globalThis.DnD || {});
