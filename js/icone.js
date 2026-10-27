// Icone di creature e oggetti: forme geometriche, immagini e icone della libreria (vedi dati/libreria-icone.js).
// Normalizzazione e SVG (puri) e disegno su canvas.
(function (DnD) {
  'use strict';

  const SHAPES = ['cerchio', 'quadrato', 'triangolo', 'rombo', 'esagono', 'stella'];
  const SHAPE_NAMES = { cerchio: 'Cerchio', quadrato: 'Quadrato', triangolo: 'Triangolo', rombo: 'Rombo', esagono: 'Esagono', stella: 'Stella' };
  // Le creature usano solo i colori della palette (vedi dati/colori.js).
  const CREATURE_COLORS = {};
  DnD.colori.PALETTE.forEach((c) => { CREATURE_COLORS[c.key] = c.hex; });
  const DEFAULT_COLOR = CREATURE_COLORS.grigio;
  const HEX = /^#[0-9a-f]{6}$/i;
  const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
  const MAX_DATA_URL = 300000;
  const IMAGE_PX = 128;

  function isImageDataUrl(v) {
    return typeof v === 'string' && v.length <= MAX_DATA_URL && DATA_URL.test(v);
  }

  // ---------- Libreria di icone predefinite (vedi dati/libreria-icone.js) ----------
  const LIB = () => DnD.libreriaIcone || { LIBRARY: [], ITEM_LIBRARY: [] };
  const libraryEntry = (id) => LIB().LIBRARY.find((x) => x.id === id) || LIB().ITEM_LIBRARY.find((x) => x.id === id) || null;
  const DETAIL_DARK = 'rgba(0,0,0,0.45)';
  const DETAIL_LIGHT = 'rgba(255,255,255,0.75)';

  // SVG completo di un'icona della libreria nel colore indicato (null se l'icona non esiste). Il corpo usa
  // currentColor: un solo disegno per icona, il colore è l'attributo `color` della radice.
  function iconSvg(id, color) {
    const entry = libraryEntry(id);
    if (!entry) return null;
    const dark = DnD.colori.isDark(color);
    const body = entry.svg.split('{c}').join('currentColor').split('{d}').join(dark ? DETAIL_LIGHT : DETAIL_DARK).split('{l}').join(dark ? DETAIL_DARK : DETAIL_LIGHT);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="' + IMAGE_PX + '" height="' + IMAGE_PX + '" color="' + color + '">' + body + '</svg>';
  }
  const svgDataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // freeColor: true per gli oggetti (qualsiasi colore), false per le creature (solo la palette).
  function normalizeIcon(raw, freeColor) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const palette = Object.values(CREATURE_COLORS);
    const color = typeof raw.color === 'string' && (freeColor ? HEX.test(raw.color) : palette.includes(raw.color.toLowerCase()))
      ? raw.color.toLowerCase() : DEFAULT_COLOR;
    if (raw.kind === 'image' && isImageDataUrl(raw.image)) return { kind: 'image', image: raw.image, color };
    if (raw.kind === 'library' && typeof raw.icon === 'string' && libraryEntry(raw.icon)) return { kind: 'library', icon: raw.icon, color };
    return { kind: 'shape', shape: SHAPES.includes(raw.shape) ? raw.shape : 'cerchio', color };
  }

  // ---------- Disegno (solo browser) ----------
  const images = new Map();

  // Restituisce l'immagine (in cache); `onload` viene chiamato quando è pronta per il disegno.
  function getImage(src, onload) {
    let entry = images.get(src);
    if (!entry) {
      const img = new Image();
      entry = { img, callbacks: [] };
      img.onload = () => { const cbs = entry.callbacks; entry.callbacks = []; cbs.forEach((cb) => cb()); };
      img.src = src;
      images.set(src, entry);
    }
    if (!entry.img.complete && onload) entry.callbacks.push(onload);
    return entry.img;
  }

  function shapePath(ctx, shape, cx, cy, r) {
    ctx.beginPath();
    const poly = (n, rot, radius) => {
      for (let i = 0; i < n; i++) {
        const a = rot + (i * 2 * Math.PI) / n;
        const px = cx + (radius ? radius(i) : r) * Math.cos(a);
        const py = cy + (radius ? radius(i) : r) * Math.sin(a);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    };
    switch (shape) {
      case 'quadrato': ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7); break;
      case 'triangolo': poly(3, -Math.PI / 2); break;
      case 'rombo': poly(4, -Math.PI / 2); break;
      case 'esagono': poly(6, 0); break;
      case 'stella': poly(10, -Math.PI / 2, (i) => (i % 2 ? r * 0.45 : r)); break;
      default: ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }

  // Icona della libreria pronta per il canvas: ImageBitmap (o immagine) per colore, in cache.
  const bitmaps = new Map();
  function libraryImage(id, color, onload) {
    const key = id + '|' + color;
    let entry = bitmaps.get(key);
    if (!entry) {
      entry = { img: null, callbacks: [] };
      bitmaps.set(key, entry);
      const svg = iconSvg(id, color);
      if (svg && typeof Image === 'function') {
        const img = new Image();
        const done = (bmp) => { entry.img = bmp; const cbs = entry.callbacks; entry.callbacks = []; cbs.forEach((cb) => cb()); };
        img.onload = () => {
          if (typeof createImageBitmap === 'function') createImageBitmap(img).then(done, () => done(img));
          else done(img);
        };
        img.src = svgDataUrl(svg);
      }
    }
    if (!entry.img && onload) entry.callbacks.push(onload);
    return entry.img;
  }

  // Ellisse inscritta nel rettangolo (x, y, w, h), come percorso corrente.
  function ellipsePath(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  }

  // Disegna l'icona nel rettangolo (x, y, w, h), ad esempio l'ingombro di una pedina: le forme si adattano
  // (il cerchio diventa un'ellisse), immagini e icone della libreria si adattano senza deformarsi, con il
  // bordo colorato. onImageLoad: chiamata quando un'immagine finisce di caricarsi (per ridisegnare).
  function drawIconRect(ctx, icon, x, y, w, h, onImageLoad) {
    const r = Math.min(w, h) / 2;
    ctx.save();
    if (icon.kind === 'image' || icon.kind === 'library') {
      const img = icon.kind === 'image' ? getImage(icon.image, onImageLoad) : libraryImage(icon.icon, icon.color, onImageLoad);
      ellipsePath(ctx, x, y, w, h);
      // Fondo dietro le icone: scuro, oppure chiaro per i colori scuri (nero, marrone…), così la sagoma si legge.
      ctx.fillStyle = icon.kind === 'image' ? '#111' : (DnD.colori.isDark(icon.color) ? 'rgba(232,230,222,0.92)' : 'rgba(20,22,28,0.82)');
      ctx.fill();
      const ready = img && (icon.kind === 'library' || (img.complete && img.naturalWidth));
      if (ready) {
        ctx.save();
        ctx.clip();
        const iw = img.naturalWidth || img.width || 1;
        const ih = img.naturalHeight || img.height || 1;
        // Immagini: coprono l'ellisse mantenendo le proporzioni; icone: contenute, con un piccolo margine.
        const k = icon.kind === 'image' ? Math.max(w / iw, h / ih) : Math.min(w, h) * 0.86 / Math.max(iw, ih);
        ctx.drawImage(img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
        ctx.restore();
      }
      ellipsePath(ctx, x, y, w, h);
      ctx.lineWidth = Math.max(3, r * 0.2);
      ctx.strokeStyle = DnD.colori.contrastStrokes(icon.color).outer;
      ctx.stroke();
      ctx.lineWidth = Math.max(2, r * 0.13);
      ctx.strokeStyle = icon.color;
      ctx.stroke();
    } else {
      // Forma geometrica stirata sull'ingombro (lo spessore del bordo non si deforma).
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(w / 2, h / 2);
      shapePath(ctx, icon.shape, 0, 0, 1);
      ctx.restore();
      ctx.fillStyle = icon.color;
      ctx.fill();
      ctx.lineJoin = 'round';
      const k = DnD.colori.contrastStrokes(icon.color);
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.strokeStyle = k.outer;
      ctx.stroke();
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.strokeStyle = k.inner;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Disegna l'icona centrata in (cx, cy) con raggio r.
  function drawIcon(ctx, icon, cx, cy, r, onImageLoad) {
    drawIconRect(ctx, icon, cx - r, cy - r, r * 2, r * 2, onImageLoad);
  }

  // Piccolo canvas con l'icona (per elenchi, schede e anteprime).
  function iconCanvas(icon, size, className) {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = size + 'px';
    canvas.className = 'icon-canvas' + (className ? ' ' + className : '');
    const paint = () => {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawIcon(ctx, icon, size / 2, size / 2, size * 0.42, paint);
    };
    paint();
    return canvas;
  }

  // Ridimensiona un file immagine a 128x128 (ritaglio quadrato centrale) e restituisce un data URL.
  function fileToIconDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Il file scelto non è un\'immagine.')); return; }
      if (file.size > 20 * 1024 * 1024) { reject(new Error('L\'immagine è troppo grande (massimo 20 MB).')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.min(IMAGE_PX, side);
        canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
        let data = canvas.toDataURL('image/webp', 0.85);
        if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/png');
        if (!isImageDataUrl(data)) reject(new Error('Impossibile convertire l\'immagine.'));
        else resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossibile leggere l\'immagine.')); };
      img.src = url;
    });
  }

  DnD.icone = {
    SHAPES, SHAPE_NAMES, CREATURE_COLORS, DEFAULT_COLOR, HEX,
    isImageDataUrl, libraryEntry, iconSvg, svgDataUrl, normalizeIcon, getImage, libraryImage, shapePath, drawIcon, drawIconRect, iconCanvas, fileToIconDataUrl,
  };
})(globalThis.DnD = globalThis.DnD || {});
