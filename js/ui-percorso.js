// Percorso leggendario sul canvas: editor della mappa a nodi (aggiungi, collega trascinando da un nodo
// all'altro, scollega, elimina, duplica, sposta, selezione multipla con Maiusc+trascinamento, griglia, raggiera
// attorno al Nucleo, ricerca, validazione, annulla/ripeti 50 azioni) con il pannello del nodo selezionato, e
// modalità Sblocca per il gioco (nodi acquistabili che pulsano, linee attive con scorrimento di luce, sblocco con
// conferma e animazione). Sfondo cosmico, nodi come gemme, il Nucleo come sole con aureola.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const P = DnD.percorso;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const R_NODE = 26;
  const R_CORE = 38;
  const SNAP = 40;
  const TOOLS = { sposta: '🖐 Seleziona/Sposta', aggiungi: '＋ Aggiungi nodo', collega: '🔗 Collega', scollega: '✂ Scollega', elimina: '🗑 Elimina' };
  const HINTS = {
    sposta: 'Trascina i nodi; trascina il vuoto per spostare la vista; Maiusc+trascina per selezionare più nodi; rotella = zoom.',
    aggiungi: 'Clicca un punto vuoto per aggiungere un nodo (collegato al nodo selezionato, se c\'è).',
    collega: 'Trascina da un nodo a un altro per collegarli.', scollega: 'Clicca una linea per toglierla.', elimina: 'Clicca un nodo per eliminarlo (il Nucleo resta).',
  };
  const motionOff = () => DnD.impostazioni.reduceMotion() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Stelle lontane, sempre uguali per lo stesso nome (casualità con seme).
  function stars(seed, n) {
    const rng = DnD.biomi.seededRng(seed);
    return Array.from({ length: n }, () => ({ x: rng(10000) / 10000, y: rng(10000) / 10000, r: rng(3) * 0.45, a: 0.25 + rng(60) / 100, tw: rng(628) / 100 }));
  }
  const hash = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h || 1; };
  function rgba(hex, a) {
    const n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Colori del tema leggendario in cui sta il canvas (variabili --lg-*; di base il tema Divino).
  function palette(node) {
    const cs = getComputedStyle(node);
    const v = (k, def) => { const x = cs.getPropertyValue(k).trim(); return /^#[0-9a-f]{6}$/i.test(x) ? x : def; };
    return { gold: v('--lg-gold', '#f2c94c'), light: v('--lg-light', '#fff8e1'), accent: v('--lg-accent', '#e8b84a'), bg: v('--lg-bg', '#0c0a06') };
  }

  // opts: {
  //   mode: 'editor' | 'sblocca', getPath(), setPath(path, label) (salva), getUnlocked(), ctx() -> { rank, bonus },
  //   onUnlock(nodeId) -> bool, getTransformations() -> [{ id, name }] (per l'effetto «Sblocca trasformazione»)
  // }
  function create(opts) {
    const mode = opts.mode || 'editor';
    let view = { zoom: 1, panX: 0, panY: 0 };
    let tool = 'sposta';
    let selected = [];
    let drag = null;
    let snap = false;
    let query = '';
    let anim = null;          // { from, to, t0 } luce che corre lungo la linea allo sblocco
    let raf = 0;
    const hist = P.history(50);
    const canvas = el('canvas', { class: 'path-canvas', tabindex: 0, 'aria-label': mode === 'editor' ? 'Mappa del percorso: modifica dei nodi' : 'Percorso leggendario: scegli un nodo da sbloccare' });
    const wrap = el('div', { class: 'path-canvas-wrap' }, canvas);
    const info = el('div', { class: 'path-info muted small', 'aria-live': 'polite' });
    const side = el('aside', { class: 'path-side' });
    const toolbar = el('div', { class: 'path-toolbar' });
    const node = el('div', { class: 'path-editor path-' + mode }, toolbar, el('div', { class: 'path-body' }, wrap, side), info);
    let starField = null;

    const path = () => opts.getPath();
    const unlocked = () => new Set(P.withCore(opts.getUnlocked ? opts.getUnlocked() : []));
    function commit(p, label) {
      hist.push(path());
      opts.setPath(P.normalizePath(p), label);
      refresh();
    }

    // ---------- Coordinate ----------
    const size = () => ({ W: wrap.clientWidth || 600, H: wrap.clientHeight || 420 });
    const toScreen = (x, y) => { const s = size(); return { x: s.W / 2 + view.panX + x * view.zoom, y: s.H / 2 + view.panY + y * view.zoom }; };
    const toWorld = (sx, sy) => { const s = size(); return { x: (sx - s.W / 2 - view.panX) / view.zoom, y: (sy - s.H / 2 - view.panY) / view.zoom }; };
    const radius = (n) => (n.core ? R_CORE : R_NODE);
    function hitNode(sx, sy) {
      const w = toWorld(sx, sy);
      const list = path().nodes.slice().reverse();
      return list.find((n) => (n.x - w.x) ** 2 + (n.y - w.y) ** 2 <= (radius(n) + 4) ** 2) || null;
    }
    function hitLink(sx, sy) {
      const p = path();
      for (const l of p.links) {
        const a = P.nodeById(p, l[0]);
        const b = P.nodeById(p, l[1]);
        const A = toScreen(a.x, a.y);
        const B = toScreen(b.x, b.y);
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const t = Math.max(0, Math.min(1, ((sx - A.x) * dx + (sy - A.y) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(A.x + t * dx - sx, A.y + t * dy - sy) < 7) return l;
      }
      return null;
    }

    // ---------- Disegno ----------
    function requestDraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
    function draw() {
      if (!canvas.isConnected) return;
      const { W, H } = size();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      const moving = !motionOff();
      const C = palette(canvas);
      // Sfondo cosmico del tema: fondo, due nebulose (oro e metallo) e stelle lontane (si spostano poco con la vista).
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      for (const [x, y, col, a] of [[0.5, 0.5, C.gold, 0.16], [0.2, 0.8, C.accent, 0.12]]) {
        const g = ctx.createRadialGradient(W * x, H * y, 10, W * x, H * y, Math.max(W, H) * 0.65);
        g.addColorStop(0, rgba(col, a));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      if (!starField) starField = stars(hash(path().name), 180);
      for (const s of starField) {
        const tw = moving ? 0.5 + 0.5 * Math.sin(now / 900 + s.tw) : 1;
        ctx.fillStyle = rgba(C.light, (s.a * (0.6 + 0.4 * tw)).toFixed(3));
        ctx.beginPath();
        ctx.arc(((s.x * W + view.panX * 0.15) % W + W) % W, ((s.y * H + view.panY * 0.15) % H + H) % H, s.r + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (snap && mode === 'editor') {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        const step = SNAP * view.zoom;
        const o = toScreen(0, 0);
        for (let x = o.x % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = o.y % step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      }
      const p = path();
      const have = unlocked();
      const avail = mode === 'sblocca' ? new Set(P.available(p, [...have], opts.ctx())) : new Set();
      const found = new Set(P.search(p, query));
      // Collegamenti: curvi; attivi (entrambi sbloccati) dorati con scorrimento di luce.
      for (const l of p.links) {
        const a = P.nodeById(p, l[0]);
        const b = P.nodeById(p, l[1]);
        const A = toScreen(a.x, a.y);
        const B = toScreen(b.x, b.y);
        const mx = (A.x + B.x) / 2 - (B.y - A.y) * 0.08;
        const my = (A.y + B.y) / 2 + (B.x - A.x) * 0.08;
        const active = have.has(a.id) && have.has(b.id);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.quadraticCurveTo(mx, my, B.x, B.y);
        if (active) {
          ctx.strokeStyle = rgba(C.gold, 0.9);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba(C.gold, 0.8);
          ctx.shadowBlur = 10;
          ctx.stroke();
          if (moving) {
            ctx.setLineDash([6, 18]);
            ctx.lineDashOffset = -now / 40;
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = mode === 'sblocca' && (avail.has(a.id) || avail.has(b.id)) ? rgba(C.light, 0.45) : rgba(C.light, 0.22);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.restore();
      }
      // Luce che corre lungo la linea dello sblocco.
      if (anim) {
        const k = Math.min(1, (now - anim.t0) / 700);
        const a = P.nodeById(p, anim.from);
        const b = P.nodeById(p, anim.to);
        if (a && b) {
          const A = toScreen(a.x, a.y);
          const B = toScreen(b.x, b.y);
          const x = A.x + (B.x - A.x) * k;
          const y = A.y + (B.y - A.y) * k;
          const gl = ctx.createRadialGradient(x, y, 0, x, y, 22);
          gl.addColorStop(0, 'rgba(255,255,255,1)');
          gl.addColorStop(1, rgba(C.gold, 0));
          ctx.fillStyle = gl;
          ctx.beginPath();
          ctx.arc(x, y, 22, 0, Math.PI * 2);
          ctx.fill();
        }
        if (k >= 1 && now - anim.t0 > 1300) anim = null;
      }
      // Nodi: gemme o sigilli; il Nucleo come sole con aureola.
      for (const n of p.nodes) {
        const S = toScreen(n.x, n.y);
        const r = radius(n) * view.zoom;
        const on = have.has(n.id);
        const can = avail.has(n.id);
        const dim = mode === 'sblocca' && !on && !can;
        ctx.save();
        ctx.globalAlpha = dim ? 0.45 : 1;
        if (n.core) {
          const halo = ctx.createRadialGradient(S.x, S.y, r * 0.4, S.x, S.y, r * 2.4);
          halo.addColorStop(0, rgba(C.light, 0.55));
          halo.addColorStop(1, rgba(C.gold, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(S.x, S.y, r * 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba(C.light, 0.7);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(S.x, S.y, r * 1.35, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (can) {
          const pulse = moving ? 1 + 0.12 * Math.sin(now / 220) : 1.08;
          ctx.strokeStyle = rgba(n.color, 0.85);
          ctx.lineWidth = 3;
          ctx.shadowColor = n.color;
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(S.x, S.y, r * 1.25 * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        if (anim && anim.to === n.id) {
          const k = Math.min(1, (now - anim.t0 - 700) / 600);
          if (k > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(S.x, S.y, r * (1.2 + k * 1.6), 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        // Gemma: sfaccettatura con gradiente del colore della categoria.
        const gem = ctx.createRadialGradient(S.x - r * 0.35, S.y - r * 0.4, r * 0.1, S.x, S.y, r);
        gem.addColorStop(0, on || n.core ? '#ffffff' : rgba(n.color, 0.9));
        gem.addColorStop(0.35, on || n.core ? n.color : rgba(n.color, 0.55));
        gem.addColorStop(1, C.bg);
        if (on) { ctx.shadowColor = n.color; ctx.shadowBlur = 22; }
        ctx.fillStyle = gem;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 4;
          const rr = i % 2 ? r * 0.92 : r;
          if (i) ctx.lineTo(S.x + Math.cos(ang) * rr, S.y + Math.sin(ang) * rr); else ctx.moveTo(S.x + Math.cos(ang) * rr, S.y + Math.sin(ang) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = on ? rgba(C.light, 0.95) : rgba(C.light, 0.45);
        ctx.lineWidth = selected.includes(n.id) ? 3 : 1.5;
        if (selected.includes(n.id)) ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        if (found.has(n.id)) { ctx.strokeStyle = '#5cc8f0'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(S.x, S.y, r * 1.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        if (r > 12) DnD.icone.drawIcon(ctx, n.icon, S.x, S.y, r * 0.55, requestDraw);
        ctx.restore();
        // Etichetta: nome e costo.
        if (view.zoom > 0.3) {
          ctx.save();
          ctx.font = (n.core ? '700 ' : '600 ') + Math.max(10, 12 * Math.min(1.3, view.zoom)) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = dim ? rgba(C.light, 0.55) : C.light;
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 4;
          ctx.fillText(n.name, S.x, S.y + r + 15);
          if (!n.core) {
            ctx.font = Math.max(9, 10 * Math.min(1.3, view.zoom)) + 'px system-ui, sans-serif';
            ctx.fillStyle = rgba(C.gold, 0.9);
            ctx.fillText('◆'.repeat(n.cost) + (n.minRank ? ' · rango ' + n.minRank : ''), S.x, S.y + r + 28);
          }
          ctx.restore();
        }
      }
      // Anteprime dell'editor: collegamento in corso, rettangolo di selezione.
      if (drag && drag.type === 'link' && drag.at) {
        const a = P.nodeById(p, drag.from);
        const A = toScreen(a.x, a.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(drag.at.x, drag.at.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (drag && drag.type === 'rect' && drag.b) {
        ctx.strokeStyle = 'rgba(92,200,240,0.9)';
        ctx.fillStyle = 'rgba(92,200,240,0.1)';
        const x = Math.min(drag.a.x, drag.b.x);
        const y = Math.min(drag.a.y, drag.b.y);
        ctx.fillRect(x, y, Math.abs(drag.b.x - drag.a.x), Math.abs(drag.b.y - drag.a.y));
        ctx.strokeRect(x, y, Math.abs(drag.b.x - drag.a.x), Math.abs(drag.b.y - drag.a.y));
      }
      // Animazione continua (pulsazione, scorrimento di luce, stelle) solo se le animazioni sono attive.
      if (moving && (mode === 'sblocca' || anim || p.links.some((l) => have.has(l[0]) && have.has(l[1])))) requestDraw();
    }
    new ResizeObserver(() => requestDraw()).observe(wrap);

    // ---------- Puntatore ----------
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.focus({ preventScroll: true });
      const pt = local(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* evento sintetico */ }
      const hit = hitNode(pt.x, pt.y);
      if (e.button === 1 || (!hit && mode === 'sblocca')) { drag = { type: 'pan', p0: pt, v0: Object.assign({}, view) }; return; }
      if (mode === 'sblocca') { if (hit) unlockDialog(hit.id); return; }
      if (tool === 'collega' && hit) { drag = { type: 'link', from: hit.id, at: pt }; return; }
      if (tool === 'elimina' && hit) { removeSelected([hit.id]); return; }
      if (tool === 'scollega') { const l = hitLink(pt.x, pt.y); if (l) commit(P.unlink(path(), l[0], l[1]), 'scollega'); return; }
      if (tool === 'aggiungi' && !hit) {
        const w = toWorld(pt.x, pt.y);
        const from = selected.length === 1 ? selected[0] : null;
        const r = P.addNode(path(), { name: 'Nuovo nodo', x: snap ? Math.round(w.x / SNAP) * SNAP : Math.round(w.x), y: snap ? Math.round(w.y / SNAP) * SNAP : Math.round(w.y) });
        commit(from ? P.link(r.path, from, r.id) : r.path, 'aggiungi');
        selected = [r.id];
        refresh();
        return;
      }
      if (hit) {
        if (e.shiftKey || e.ctrlKey) selected = selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : selected.concat(hit.id);
        else if (!selected.includes(hit.id)) selected = [hit.id];
        drag = { type: 'move', p0: pt, ids: selected.slice(), moved: false };
        refreshSide();
        requestDraw();
        return;
      }
      if (e.shiftKey) { drag = { type: 'rect', a: pt, b: pt }; return; }
      selected = [];
      refreshSide();
      drag = { type: 'pan', p0: pt, v0: Object.assign({}, view) };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const pt = local(e);
      if (drag.type === 'pan') { view.panX = drag.v0.panX + pt.x - drag.p0.x; view.panY = drag.v0.panY + pt.y - drag.p0.y; }
      else if (drag.type === 'link') drag.at = pt;
      else if (drag.type === 'rect') drag.b = pt;
      else if (drag.type === 'move') { drag.moved = Math.hypot(pt.x - drag.p0.x, pt.y - drag.p0.y) > 3; drag.at = pt; previewMove(); }
      requestDraw();
    });
    let preview = null; // posizioni provvisorie durante lo spostamento
    function previewMove() {
      const dx = (drag.at.x - drag.p0.x) / view.zoom;
      const dy = (drag.at.y - drag.p0.y) / view.zoom;
      if (!preview) preview = clone(path());
      const base = path();
      for (const n of base.nodes) if (drag.ids.includes(n.id)) {
        const orig = preview.nodes.find((x) => x.id === n.id);
        n.x = snap ? Math.round((orig.x + dx) / SNAP) * SNAP : orig.x + dx;
        n.y = snap ? Math.round((orig.y + dy) / SNAP) * SNAP : orig.y + dy;
      }
    }
    canvas.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d) return;
      const pt = local(e);
      if (d.type === 'link') {
        const hit = hitNode(pt.x, pt.y);
        if (hit && hit.id !== d.from) commit(P.link(path(), d.from, hit.id), 'collega');
      } else if (d.type === 'rect') {
        const a = toWorld(Math.min(d.a.x, pt.x), Math.min(d.a.y, pt.y));
        const b = toWorld(Math.max(d.a.x, pt.x), Math.max(d.a.y, pt.y));
        selected = path().nodes.filter((n) => n.x >= a.x && n.x <= b.x && n.y >= a.y && n.y <= b.y).map((n) => n.id);
        refreshSide();
      } else if (d.type === 'move' && d.moved && preview) {
        // Le posizioni provvisorie diventano una modifica annullabile.
        const moved = clone(path());
        Object.assign(path(), preview);
        commit(moved, 'sposta');
      }
      preview = null;
      requestDraw();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const pt = local(e);
      const before = toWorld(pt.x, pt.y);
      view.zoom = Math.max(0.25, Math.min(3, view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const after = toScreen(before.x, before.y);
      view.panX += pt.x - after.x;
      view.panY += pt.y - after.y;
      requestDraw();
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      if (mode !== 'editor') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' && selected.length) { e.preventDefault(); removeSelected(selected); }
    });

    function undo() { const prev = hist.undo(path()); if (prev) { opts.setPath(prev, 'annulla'); refresh(); } }
    function redo() { const next = hist.redo(path()); if (next) { opts.setPath(next, 'ripeti'); refresh(); } }
    function removeSelected(ids) {
      const del = ids.filter((id) => id !== P.CORE_ID);
      if (!del.length) { toast('Il Nucleo non si può eliminare.', 'error'); return; }
      commit(P.removeNodes(path(), del), 'elimina');
      selected = selected.filter((x) => !del.includes(x));
      refresh();
    }
    function fit() {
      const p = path();
      const { W, H } = size();
      const xs = p.nodes.map((n) => n.x);
      const ys = p.nodes.map((n) => n.y);
      const w = Math.max(...xs) - Math.min(...xs) + 200;
      const h = Math.max(...ys) - Math.min(...ys) + 200;
      view.zoom = Math.max(0.25, Math.min(1.6, Math.min(W / w, H / h)));
      view.panX = -((Math.max(...xs) + Math.min(...xs)) / 2) * view.zoom;
      view.panY = -((Math.max(...ys) + Math.min(...ys)) / 2) * view.zoom;
      requestDraw();
    }

    // ---------- Modalità Sblocca ----------
    function effectText(e) {
      const st = DnD.store.state;
      switch (e.kind) {
        case 'caratteristica': return e.ability + ' ' + (e.value >= 0 ? '+' : '') + e.value + ' (tetto 30)';
        case 'competenza': return e.target === 'ts' ? 'Competenza nei TS di ' + e.ability : e.target === 'abilita' ? (e.expertise ? 'Maestria' : 'Competenza') + ' in ' + e.skill : 'Competenza: ' + e.text;
        case 'bonus': return e.stat === 'resistenza' || e.stat === 'immunita' ? P.STAT_NAMES[e.stat] + ' a ' + e.damageType : e.stat === 'senso' ? e.sense + ' ' + e.value + ' m' : P.STAT_NAMES[e.stat] + ' ' + (e.value >= 0 ? '+' : '') + e.value;
        case 'magia': { const sp = st.spells.find((s) => s.id === e.spellId); return sp ? 'Magia: ' + sp.name + (e.freq === 'giorno' ? ' (' + e.uses + '/giorno)' : ' (sempre preparata)') : '⚠ incantesimo eliminato'; }
        case 'slot': return '+' + e.count + ' slot di ' + e.level + '° livello';
        case 'privilegio': return 'Privilegio «' + e.name + '» (' + P.FEATURE_TYPE_NAMES[e.type] + ', ' + (e.uses.kind === 'volonta' ? 'a volontà' : e.uses.n + ' ' + P.USES_NAMES[e.uses.kind]) + ')' + (e.desc ? ': ' + e.desc : '');
        case 'trasformazione': { const t = (opts.getTransformations ? opts.getTransformations() : []).find((x) => x.id === e.transformationId); return t ? 'Sblocca la trasformazione «' + t.name + '»' : '⚠ trasformazione non collegata'; }
        default: return e.text;
      }
    }
    function unlockDialog(id) {
      const p = path();
      const n = P.nodeById(p, id);
      const have = unlocked();
      const r = P.canUnlock(p, [...have], id, opts.ctx());
      const body = el('div', { class: 'form legend-node-detail' },
        el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(n.icon, 40), el('div', {}, el('b', { text: n.name }),
          el('div', { class: 'muted small', text: [n.category, n.core ? 'Nucleo' : 'costo ' + n.cost + (n.cost === 1 ? ' punto' : ' punti'), n.minRank ? 'rango ' + n.minRank : ''].filter(Boolean).join(' · ') }))),
        n.description ? el('p', { class: 'muted', text: n.description }) : null,
        el('ul', {}, n.effects.map((e) => el('li', { text: effectText(e) }))),
        have.has(id) ? el('p', { class: 'ok-text', text: '✦ Già sbloccato.' }) : el('p', { class: r.ok ? 'ok-text' : 'warn-text', text: r.ok ? 'Si può sbloccare.' : 'Non ancora: ' + r.reason + '.' }));
      openDialog('Percorso: ' + n.name, body, have.has(id) || !r.ok ? [{ text: 'Chiudi' }] : [
        { text: 'Annulla' },
        { text: '✦ Sblocca', class: 'primary', onclick: () => {
          if (!confirm('Sbloccare «' + n.name + '» per ' + n.cost + (n.cost === 1 ? ' punto' : ' punti') + '?')) return false;
          const from = P.neighbors(p, id).find((x) => have.has(x)) || P.CORE_ID;
          if (opts.onUnlock(id)) { anim = { from, to: id, t0: performance.now() }; requestDraw(); }
          return undefined;
        } },
      ]);
    }

    // ---------- Pannello del nodo (editor) ----------
    function effectEditor(n, e, redraw) {
      const set = (k, f) => (ev) => { e[k] = f ? f(ev.target) : ev.target.value; };
      const st = DnD.store.state;
      const AB = DnD.regole.ABILITIES;
      const head = el('div', { class: 'input-row' },
        el('select', { 'aria-label': 'Tipo di effetto', onchange: (ev) => { Object.assign(e, P.normalizeEffect({ id: e.id, kind: ev.target.value })); for (const k of Object.keys(e)) if (!(k in P.normalizeEffect({ id: e.id, kind: e.kind }))) delete e[k]; redraw(); } },
          P.EFFECTS.map((k) => opt(k, P.EFFECT_NAMES[k], k === e.kind))),
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli l\'effetto', onclick: () => { n.effects = n.effects.filter((x) => x !== e); redraw(); } }));
      let body = null;
      if (e.kind === 'caratteristica') body = el('div', { class: 'input-row' }, el('select', { onchange: set('ability') }, AB.map((a) => opt(a, a, a === e.ability))),
        numberInput(e.value, { class: 'qty', min: -10, max: 10, oninput: set('value', (t) => readNumber(t) || 0) }));
      else if (e.kind === 'competenza') body = el('div', { class: 'input-row' },
        el('select', { onchange: (ev) => { e.target = ev.target.value; redraw(); } }, opt('ts', 'Tiro salvezza', e.target === 'ts'), opt('abilita', 'Abilità', e.target === 'abilita'), opt('altro', 'Strumento, arma o armatura', e.target === 'altro')),
        e.target === 'ts' ? el('select', { onchange: set('ability') }, AB.map((a) => opt(a, a, a === e.ability))) : null,
        e.target === 'abilita' ? [el('select', { onchange: set('skill') }, Object.keys(DnD.creatureDati.SKILLS).map((s) => opt(s, s, s === e.skill))),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: e.expertise, onchange: (ev) => { e.expertise = ev.target.checked; } }), ' maestria')] : null,
        e.target === 'altro' ? textInput(e.text, { placeholder: 'es. armi da guerra', oninput: set('text') }) : null);
      else if (e.kind === 'bonus') body = el('div', { class: 'input-row' },
        el('select', { onchange: (ev) => { e.stat = ev.target.value; redraw(); } }, P.STATS.map((s) => opt(s, P.STAT_NAMES[s], s === e.stat))),
        e.stat === 'resistenza' || e.stat === 'immunita' ? el('select', { onchange: set('damageType') }, DnD.creatureDati.DEFENSE_TYPES.map((t) => opt(t, DnD.creatureDati.DEFENSE_NAMES[t] || t, t === e.damageType)))
          : [e.stat === 'senso' ? el('select', { onchange: set('sense') }, P.SENSES.map((s) => opt(s, s, s === e.sense))) : null,
            numberInput(e.value, { class: 'qty', oninput: set('value', (t) => readNumber(t) || 0) })]);
      else if (e.kind === 'magia') body = el('div', { class: 'input-row' },
        el('select', { 'aria-label': 'Incantesimo', onchange: set('spellId') }, opt('', '— scegli —', !e.spellId),
          e.spellId && !st.spells.some((s) => s.id === e.spellId) ? opt(e.spellId, '⚠ incantesimo eliminato', true) : null,
          st.spells.map((s) => opt(s.id, s.name + ' (' + DnD.magie.levelName(s.level) + ')', s.id === e.spellId))),
        el('select', { onchange: (ev) => { e.freq = ev.target.value; redraw(); } }, opt('sempre', 'Sempre preparato', e.freq === 'sempre'), opt('giorno', 'N al giorno', e.freq === 'giorno')),
        e.freq === 'giorno' ? numberInput(e.uses, { class: 'qty', min: 1, max: 20, oninput: set('uses', (t) => readNumber(t) || 1) }) : null);
      else if (e.kind === 'slot') body = el('div', { class: 'input-row' }, '+', numberInput(e.count, { class: 'qty', min: 1, max: 9, oninput: set('count', (t) => readNumber(t) || 1) }),
        'slot di livello', numberInput(e.level, { class: 'qty', min: 1, max: 9, oninput: set('level', (t) => readNumber(t) || 1) }));
      else if (e.kind === 'privilegio') {
        const m = e.mech;
        const mech = () => {
          if (m.kind === 'attacco') return el('div', { class: 'input-row' }, el('select', { onchange: (ev) => { m.range = ev.target.value; } }, DnD.creatureDati.RANGES.map((r) => opt(r, DnD.creatureDati.RANGE_NAMES[r], r === m.range))),
            el('select', { onchange: (ev) => { m.ability = ev.target.value; } }, AB.map((a) => opt(a, a, a === m.ability))),
            textInput(m.damages[0] ? m.damages[0].dice : '1d8', { class: 'qty', 'aria-label': 'Danno', oninput: (ev) => { m.damages = [{ dice: ev.target.value.trim(), type: (m.damages[0] || {}).type || '', bonus: null }]; } }),
            el('select', { 'aria-label': 'Tipo', onchange: (ev) => { if (m.damages[0]) m.damages[0].type = ev.target.value; } }, DnD.creatureDati.DAMAGE_TYPES.map((t) => opt(t, t, m.damages[0] && m.damages[0].type === t))));
          if (m.kind === 'salvezza') return el('div', { class: 'input-row' }, 'TS', el('select', { onchange: (ev) => { m.ability = ev.target.value; } }, AB.map((a) => opt(a, a, a === m.ability))),
            'CD da', el('select', { onchange: (ev) => { m.dcAbility = ev.target.value; } }, AB.map((a) => opt(a, a, a === m.dcAbility))),
            textInput(m.damages[0] ? m.damages[0].dice : '4d6', { class: 'qty', 'aria-label': 'Danno', oninput: (ev) => { m.damages = [{ dice: ev.target.value.trim(), type: (m.damages[0] || {}).type || '', bonus: 0 }]; } }),
            el('select', { 'aria-label': 'Tipo', onchange: (ev) => { if (m.damages[0]) m.damages[0].type = ev.target.value; } }, DnD.creatureDati.DAMAGE_TYPES.map((t) => opt(t, t, m.damages[0] && m.damages[0].type === t))),
            textInput(m.area, { placeholder: 'area', oninput: (ev) => { m.area = ev.target.value; } }),
            el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: m.half, onchange: (ev) => { m.half = ev.target.checked; } }), ' metà se riesce'));
          if (m.kind === 'cura') return el('div', { class: 'input-row' }, 'Cura', textInput(m.dice, { class: 'qty', oninput: (ev) => { m.dice = ev.target.value.trim(); } }), '+', numberInput(m.bonus, { class: 'qty', oninput: (ev) => { m.bonus = readNumber(ev.target) || 0; } }));
          return null;
        };
        body = el('div', { class: 'row-list' },
          el('div', { class: 'input-row' }, textInput(e.name, { 'aria-label': 'Nome del privilegio', oninput: set('name') }),
            el('select', { onchange: set('type') }, P.FEATURE_TYPES.map((t) => opt(t, P.FEATURE_TYPE_NAMES[t], t === e.type))),
            el('select', { onchange: (ev) => { e.uses.kind = ev.target.value; redraw(); } }, P.USES.map((u) => opt(u, P.USES_NAMES[u], u === e.uses.kind))),
            e.uses.kind !== 'volonta' ? numberInput(e.uses.n, { class: 'qty', min: 1, max: 20, 'aria-label': 'Usi', oninput: (ev) => { e.uses.n = readNumber(ev.target) || 1; } }) : null),
          el('textarea', { rows: 2, value: e.desc, placeholder: 'Descrizione', oninput: set('desc') }),
          el('div', { class: 'input-row' }, el('span', { class: 'muted small', text: 'Meccanica' }),
            el('select', { onchange: (ev) => { e.mech = DnD.creature.normalizeMech(Object.assign({ kind: ev.target.value }, ev.target.value === 'attacco' ? { damages: [{ dice: '1d8', type: 'radioso' }] } : ev.target.value === 'salvezza' ? { damages: [{ dice: '4d6', type: 'radioso', bonus: 0 }] } : {})); redraw(); } },
              ['testo', 'attacco', 'salvezza', 'cura'].map((k) => opt(k, DnD.creatureDati.MECH_NAMES[k], k === m.kind)))),
          mech());
      } else if (e.kind === 'trasformazione') {
        const ts = opts.getTransformations ? opts.getTransformations() : [];
        body = el('select', { 'aria-label': 'Trasformazione', onchange: set('transformationId') }, opt('', ts.length ? '— scegli —' : '— nessuna trasformazione: creale nella scheda Trasformazioni —', !e.transformationId),
          e.transformationId && !ts.some((t) => t.id === e.transformationId) ? opt(e.transformationId, '⚠ trasformazione eliminata', true) : null, ts.map((t) => opt(t.id, t.name, t.id === e.transformationId)));
      } else body = el('textarea', { rows: 2, value: e.text, placeholder: 'Effetto narrativo', oninput: set('text') });
      return el('div', { class: 'effect-block' }, head, body);
    }

    const duplicateBtn = (cls) => el('button', { type: 'button', class: 'btn ' + cls, text: '⧉ Duplica', onclick: () => { const r = P.duplicateNodes(path(), selected); commit(r.path, 'duplica'); selected = r.ids; refresh(); } });
    function refreshSide() {
      clear(side);
      if (mode !== 'editor') return;
      const p = path();
      const warnings = P.validate(p);
      if (selected.length !== 1) {
        side.append(el('h3', { text: selected.length ? selected.length + ' nodi selezionati' : 'Percorso' }),
          el('p', { class: 'muted small', text: p.nodes.length + ' nodi · ' + p.links.length + ' collegamenti' }),
          selected.length ? el('div', { class: 'head-actions' },
            duplicateBtn('btn small'),
            el('button', { type: 'button', class: 'btn small danger', text: '🗑 Elimina', onclick: () => removeSelected(selected) })) : el('p', { class: 'muted small', text: 'Clicca un nodo per modificarlo.' }),
          warnings.length ? el('ul', { class: 'warn-text small' }, warnings.map((w) => el('li', { text: '⚠ ' + w }))) : el('p', { class: 'ok-text small', text: '✓ Tutti i nodi sono raggiungibili dal Nucleo.' }));
        return;
      }
      const n = clone(P.nodeById(p, selected[0]));
      if (!n) { selected = []; refreshSide(); return; }
      const save = (label) => {
        const q = clone(path());
        const i = q.nodes.findIndex((x) => x.id === n.id);
        q.nodes[i] = Object.assign({}, n, { icon: icon.read().icon || n.icon });
        commit(q, label || 'nodo');
      };
      const icon = DnD.uiIcone.iconPicker(n.icon, false, 'Icona');
      const effects = el('div', { class: 'row-list' });
      const drawEffects = () => clear(effects).append(...n.effects.map((e) => effectEditor(n, e, drawEffects)),
        el('button', { type: 'button', class: 'btn small', text: '+ Effetto', onclick: () => { n.effects.push(P.normalizeEffect({ kind: 'bonus' })); drawEffects(); } }));
      drawEffects();
      const others = p.nodes.filter((x) => x.id !== n.id);
      side.append(...[
        el('h3', { text: n.core ? '☀ Nucleo' : 'Nodo' }),
        field('Nome', textInput(n.name, { maxlength: 60, oninput: (e) => { n.name = e.target.value; } })),
        field('Descrizione', el('textarea', { rows: 2, value: n.description, oninput: (e) => { n.description = e.target.value; } })),
        n.core ? null : el('div', { class: 'grid-2 tight' },
          field('Costo (punti)', numberInput(n.cost, { min: 1, max: 5, oninput: (e) => { n.cost = readNumber(e.target) || 1; } })),
          field('Rango minimo', numberInput(n.minRank, { min: 0, max: 20, oninput: (e) => { n.minRank = readNumber(e.target) || 0; } }))),
        el('div', { class: 'grid-2 tight' },
          field('Categoria', textInput(n.category, { maxlength: 40, placeholder: 'es. Corpo', oninput: (e) => { n.category = e.target.value; } })),
          field('Colore', el('input', { type: 'color', value: n.color, oninput: (e) => { n.color = e.target.value; } }))),
        icon.node,
        n.core ? null : field('Esclusivo con (scelta tra due rami)', el('select', { onchange: (e) => { n.exclusiveWith = e.target.value; } },
          opt('', '— nessuno —', !n.exclusiveWith), others.filter((x) => !x.core).map((x) => opt(x.id, x.name, x.id === n.exclusiveWith)))),
        n.core ? null : el('fieldset', {}, el('legend', { text: 'Prerequisiti' }),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: n.requireAll, onchange: (e) => { n.requireAll = e.target.checked; } }), ' Servono tutti i prerequisiti elencati (invece di un nodo collegato)'),
          el('select', { multiple: true, size: 4, 'aria-label': 'Prerequisiti', onchange: (e) => { n.requires = [...e.target.selectedOptions].map((o) => o.value); } },
            others.map((x) => opt(x.id, x.name, n.requires.includes(x.id))))),
        el('fieldset', {}, el('legend', { text: 'Effetti' }), effects),
        el('div', { class: 'form-actions' },
          n.core ? null : duplicateBtn(''),
          n.core ? null : el('button', { type: 'button', class: 'btn danger', text: 'Elimina', onclick: () => removeSelected([n.id]) }),
          el('button', { type: 'button', class: 'btn primary', text: 'Applica', onclick: () => save('nodo') })),
        warnings.length ? el('ul', { class: 'warn-text small' }, warnings.map((w) => el('li', { text: '⚠ ' + w }))) : null].filter(Boolean));
    }

    function refreshToolbar() {
      clear(toolbar);
      if (mode === 'editor') {
        toolbar.append(
          el('div', { class: 'tool-group', role: 'toolbar', 'aria-label': 'Strumenti del percorso' }, Object.entries(TOOLS).map(([k, label]) => el('button', {
            type: 'button', class: 'btn small tool' + (tool === k ? ' active' : ''), 'aria-pressed': String(tool === k), text: label, onclick: () => { tool = k; refresh(); },
          }))),
          el('button', { type: 'button', class: 'btn small', text: '✺ Raggiera', title: 'Disposizione automatica a raggiera attorno al Nucleo', onclick: () => { commit(P.radialLayout(path()), 'raggiera'); fit(); } }),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: snap, onchange: (e) => { snap = e.target.checked; requestDraw(); } }), ' Griglia'),
          el('button', { type: 'button', class: 'btn small', text: '↶', title: 'Annulla (Ctrl+Z)', 'aria-label': 'Annulla', disabled: !hist.canUndo(), onclick: undo }),
          el('button', { type: 'button', class: 'btn small', text: '↷', title: 'Ripeti (Ctrl+Y)', 'aria-label': 'Ripeti', disabled: !hist.canRedo(), onclick: redo }));
      }
      toolbar.append(
        el('button', { type: 'button', class: 'btn small', text: '⤢ Adatta', title: 'Mostra tutto il percorso', onclick: fit }),
        el('input', { type: 'search', placeholder: 'Cerca un nodo…', value: query, 'aria-label': 'Cerca un nodo', oninput: (e) => { query = e.target.value.trim(); requestDraw(); } }));
    }

    function refresh() {
      refreshToolbar();
      refreshSide();
      info.textContent = mode === 'editor' ? HINTS[tool] : 'Clicca un nodo per i dettagli. I nodi che pulsano si possono sbloccare.';
      requestDraw();
    }
    refresh();
    setTimeout(fit);

    return {
      node, refresh, fit, requestDraw,
      select: (ids) => { selected = ids; refresh(); },
      selected: () => selected.slice(),
      // Posizione di un nodo sullo schermo (per i test e l'accessibilità).
      screenOf: (id) => { const n = P.nodeById(path(), id); const sp = toScreen(n.x, n.y); const r = canvas.getBoundingClientRect(); return { x: r.left + sp.x, y: r.top + sp.y }; },
      canUndo: () => hist.canUndo(),
      reset: () => { hist.clear(); selected = []; starField = null; },
    };
  }

  DnD.uiPercorso = { create };
})(globalThis.DnD = globalThis.DnD || {});
