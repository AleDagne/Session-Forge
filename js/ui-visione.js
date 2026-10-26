// Luce, visione e nebbia di guerra sul canvas della griglia (Editor griglie, Combattimento, Esplorazione).
// Il velo della nebbia, il buio e il colore delle luci sono disegnati su due canvas a parte (una cella = un pixel,
// ingranditi con o senza sfumatura) e ricalcolati solo quando cambia la firma dello stato (pedine, sorgenti, porte,
// nebbia, tema, «Vedi come»): zoom e pan riusano gli stessi canvas. Strumenti (pittore della griglia): Luce,
// Blocco vista, Stanza, Rivela/Nascondi nebbia (cerchio, rettangolo, riempimento) e «Vedi da qui». Pannello «Luce e
// visione» con luce ambientale, sorgenti, nebbia, stanze, legenda e anteprima «Vedi come» (giocatori o una pedina).
// La logica è in visione.js; i colori vengono dalle variabili CSS --vision-* (temi chiaro e scuro).
(function (DnD) {
  'use strict';

  const { el, clear, toast, field, numberInput, readNumber, openDialog } = DnD.ui;
  const V = DnD.visione;
  const K = DnD.visioneDati;
  const G = DnD.griglia;
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const fmtFt = (ft) => ft + ' ft (' + String(Math.round(ft * 0.3 * 10) / 10).replace('.', ',') + ' m)';

  // ---------- Colori (variabili CSS, ricaricate al cambio di tema) ----------
  let pal = null;
  function palette() {
    if (!pal) {
      const cs = getComputedStyle(document.documentElement);
      const v = (name) => cs.getPropertyValue(name).trim();
      const rgb = (name, def) => { const p = v(name).split(',').map(Number); return p.length === 3 && p.every(Number.isFinite) ? p : def; };
      pal = {
        dark: rgb('--vision-dark', [8, 10, 20]), fog: rgb('--vision-fog', [30, 34, 44]), fogPlayer: rgb('--vision-fog-player', [14, 16, 22]),
        room: rgb('--vision-room', [110, 160, 255]), mark: v('--vision-mark') || '#f2b632', theme: document.documentElement.dataset.theme || '',
      };
    }
    return pal;
  }
  window.addEventListener('themechange', () => { pal = null; });
  const reduced = () => Boolean(DnD.impostazioni && DnD.impostazioni.reduceMotion());
  const tilesets = () => DnD.tilemap.storeIndex();
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // ---------- Editor della luce emessa (strutture e oggetti di mappa) ----------
  // { node, read() -> emitter | null }
  function emitterEditor(light) {
    const l = light || { on: true, bright: 20, dim: 20, color: '#ffcf7a', flicker: false };
    const has = el('input', { type: 'checkbox', checked: Boolean(light) });
    const on = el('input', { type: 'checkbox', checked: l.on !== false });
    const bright = numberInput(l.bright, { min: 0, max: 1000, step: 5, 'aria-label': 'Luce intensa (piedi)' });
    const dim = numberInput(l.dim, { min: 0, max: 1000, step: 5, 'aria-label': 'Penombra oltre (piedi)' });
    const color = el('input', { type: 'color', value: l.color || '#ffcf7a', 'aria-label': 'Colore della luce' });
    const flicker = el('input', { type: 'checkbox', checked: Boolean(l.flicker) });
    const preset = el('select', { 'aria-label': 'Valori di una sorgente', onchange: (e) => {
      const s = V.sourceById(e.target.value);
      if (s) { bright.value = s.bright; dim.value = s.dim; color.value = s.color; flicker.checked = s.flicker; has.checked = true; sync(); }
    } }, opt('', '— valori di… —', true), K.SOURCES.map((s) => opt(s.id, s.icon + ' ' + s.name + ' (' + s.bright + ' + ' + s.dim + ' ft)')));
    const fields = el('div', {},
      el('div', { class: 'grid-3 tight' }, field('Luce intensa (ft)', bright), field('Penombra oltre (ft)', dim), field('Colore', color)),
      el('div', { class: 'check-row' }, el('label', { class: 'check' }, on, ' Accesa'), el('label', { class: 'check' }, flicker, ' Intermittenza (tremolio)'), preset));
    const sync = () => { fields.hidden = !has.checked; };
    has.addEventListener('change', sync);
    sync();
    const node = el('fieldset', {}, el('legend', { text: 'Luce' }), el('label', { class: 'check' }, has, ' Emette luce (raggi in piedi, convertiti in celle con i piedi per cella della mappa)'), fields);
    return {
      node,
      read: () => (has.checked ? V.normalizeEmitter({ on: on.checked, bright: readNumber(bright), dim: readNumber(dim), color: color.value, flicker: flicker.checked }) : null),
    };
  }

  // ---------- Livello sulla griglia ----------
  const TOOLS = {
    'v-luce': '💡 Luce', 'v-blocco': '🧱 Blocco vista', 'v-stanza': '🚪 Stanza', 'v-rivela': '☀ Rivela area', 'v-nascondi': '🌫 Nascondi area', 'v-vedi': '👁 Vedi da qui',
  };
  const HINTS = {
    'v-luce': 'Clicca una cella: piazza la sorgente scelta (clic su una sorgente = selezionala).',
    'v-blocco': 'Clicca o trascina: cella predefinita → blocca la vista → non la blocca → leggermente oscurata.',
    'v-stanza': 'Clicca o trascina sulle celle della stanza selezionata (si rivela tutta insieme).',
    'v-rivela': 'Rivela la nebbia: trascina (cerchio o rettangolo) o clicca (riempi l\'area chiusa dai muri).',
    'v-nascondi': 'Nascondi con la nebbia: trascina (cerchio o rettangolo) o clicca (riempi l\'area chiusa dai muri).',
    'v-vedi': 'Clicca una cella: anteprima di ciò che si vede da lì con i sensi scelti.',
  };

  // opts: { getDoc(), widget(), mode: 'editor' | 'combattimento' | 'esplorazione', env() -> { hour, biomeLight },
  //   playersView(ctx, doc) -> { cells, seenIds } (di base: le pedine dei giocatori), onChange() }
  function create(opts) {
    const mode = opts.mode || 'editor';
    let tool = null;
    let brush = 'cerchio';
    let lightKind = 'torcia';
    let selectedLight = null;
    let selectedRoom = null;
    let viewAs = 'master';      // 'master' | 'giocatori' | 'pedina:<id>' | 'punto'
    let probe = { pos: null, kind: 'normale' };
    let drag = null;
    let hover = null;
    let cache = null;
    let flickerTimer = 0;
    const doc = () => opts.getDoc();
    const W = () => opts.widget();
    const changed = () => { cache = null; if (opts.onChange) opts.onChange(); if (W()) W().requestDraw(); refreshPanels(); };
    // Modifica annullabile della griglia (stessa cronologia degli altri strumenti).
    function edit(fn) {
      const d = doc();
      if (!d || !d.grid) return;
      V.ensure(d.grid);
      const before = W().tileSnapshot();
      const r = fn(d.grid, d);
      W().commitTiles(before);
      changed();
      return r;
    }

    // ---- Calcolo (con cache) ----
    function compute() {
      const d = doc();
      if (!d || !d.grid) return null;
      const g = V.ensure(d.grid);
      const env = opts.env ? opts.env() : {};
      const p = palette();
      const key = V.signature(g, d.combatants, [env, viewAs, probe, p.theme]);
      if (cache && cache.key === key) return cache;
      const t0 = performance.now();
      const ctx = V.context(g, d.combatants, Object.assign({ tilesets: tilesets() }, env));
      const fogOn = g.fog.enabled;
      const pv = opts.playersView ? opts.playersView(ctx, d) : V.playersView(ctx);
      // Celle e pedine dell'anteprima: giocatori, una pedina o un punto scelto (editor).
      let view = null;
      let seen = null;
      if (viewAs === 'giocatori') {
        view = fogOn ? V.cellStates(g, pv.cells) : pv.cells.map((x) => (x ? 2 : 0));
        seen = pv.seenIds;
      } else if (viewAs.startsWith('pedina:') || viewAs === 'punto') {
        const viewer = viewAs === 'punto'
          ? (probe.pos ? { id: '__punto', pos: probe.pos, w: 1, h: 1, hp: 1, conditions: [], senses: (K.PROBES.find((x) => x.id === probe.kind) || K.PROBES[0]).senses } : null)
          : d.combatants.find((c) => c.id === viewAs.slice(7));
        const cells = viewer ? V.viewOf(ctx, viewer) : new Uint8Array(ctx.n);
        view = cells.map((x) => (x ? 2 : 0));
        seen = new Set(viewer ? d.combatants.filter((c) => c.id === viewer.id || V.canSee(ctx, viewer, c).seen).map((c) => c.id) : []);
      }
      const states = view ? null : fogOn ? V.cellStates(g, pv.cells) : null;
      const lm = ctx.lm;
      const anyDark = lm.level.some((x) => x < 2) || lm.magic.some(Boolean);
      // Canvas a una cella per pixel: colore delle luci (sopra il buio) e velo (buio + nebbia).
      const n = ctx.n;
      const tint = new Uint8ClampedArray(n * 4);
      const shade = new Uint8ClampedArray(n * 4);
      let tinted = false;
      for (let i = 0; i < n; i++) {
        const lv = lm.level[i];
        if (lm.src[i] >= 0 && lm.ambient < 2) {
          const c = hexRgb(lm.emitters[lm.src[i]].color);
          tint.set([c[0], c[1], c[2], lv === 2 ? 70 : 40], i * 4);
          tinted = true;
        }
        // Buio: velo per livello di luce. Nell'anteprima le celle viste fuori dalla luce intensa hanno un velo leggero
        // (con la scurovisione il buio si vede come penombra); quelle non viste sono coperte dalla nebbia.
        let ad = 0;
        if (view) ad = view[i] && lv < 2 ? 0.25 : 0;
        else if (anyDark) ad = lv === 2 ? 0 : lv === 1 ? 0.32 : 0.62;
        let av = 0;
        let fogC = p.fog;
        if (view) { av = view[i] === 2 ? 0 : view[i] === 1 ? K.PLAYER_EXPLORED : 1; fogC = p.fogPlayer; }
        else if (states) av = states[i] === 2 ? 0 : states[i] === 1 ? g.fog.opacity * K.EXPLORED_FACTOR : g.fog.opacity;
        const a = 1 - (1 - ad) * (1 - av);
        if (a <= 0) continue;
        const wd = ad * (1 - av);
        const col = [0, 1, 2].map((k) => (p.dark[k] * wd + fogC[k] * av) / a);
        shade.set([col[0], col[1], col[2], Math.round(a * 255)], i * 4);
      }
      const toCanvas = (data) => {
        const cv = document.createElement('canvas');
        cv.width = ctx.w;
        cv.height = ctx.h;
        cv.getContext('2d').putImageData(new ImageData(data, ctx.w, ctx.h), 0, 0);
        return cv;
      };
      cache = {
        key, ctx, pv, view, seen, states, ms: performance.now() - t0,
        tint: tinted ? toCanvas(tint) : null, shade: toCanvas(shade),
        flicker: lm.emitters.some((e) => e.flicker && !e.dark),
        known: view || states,
      };
      return cache;
    }

    // ---- Disegno ----
    function draw(ctx, view, s) {
      const c = compute();
      if (!c) return;
      const d = doc();
      const g = d.grid;
      const wpx = g.w * s;
      const hpx = g.h * s;
      ctx.save();
      ctx.imageSmoothingEnabled = !g.vision.stepped;
      if (c.tint) {
        // Intermittenza delle torce (niente con «Riduci animazioni»).
        const t = performance.now() / 1000;
        const flick = c.flicker && !reduced();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = flick ? 0.82 + 0.1 * Math.sin(t * 9) + 0.08 * Math.sin(t * 23.7) : 1;
        ctx.drawImage(c.tint, view.panX, view.panY, wpx, hpx);
        if (flick && !flickerTimer) flickerTimer = setTimeout(() => { flickerTimer = 0; if (W()) W().requestDraw(); }, 110);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(c.shade, view.panX, view.panY, wpx, hpx);
      ctx.restore();
      const preview = viewAs !== 'master';
      // Fantasmi: ultime posizioni note dei nemici (anteprima dei giocatori).
      if (preview && g.fog.enabled && g.fog.ghosts) {
        for (const [id, pos] of Object.entries(g.fog.lastKnown)) {
          if (c.seen && c.seen.has(id)) continue;
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = palette().mark;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(view.panX + (pos.x + 0.5) * s, view.panY + (pos.y + 0.5) * s, s * 0.36, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (preview) return;
      // Master: sorgenti piazzate (icona e raggio di quella selezionata), stanze e celle della vista con gli strumenti.
      for (const l of g.vision.lights) {
        const cx = view.panX + (l.x + 0.5) * s;
        const cy = view.panY + (l.y + 0.5) * s;
        ctx.save();
        ctx.globalAlpha = l.on ? 0.95 : 0.4;
        ctx.fillStyle = l.dark ? '#1b1d27' : l.color;
        ctx.strokeStyle = l.dark ? '#c9c2ff' : '#1b1d27';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(4, s * 0.16), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (l.id === selectedLight) {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = palette().mark;
          for (const r of [l.bright, l.bright + l.dim]) if (r > 0) { ctx.beginPath(); ctx.arc(cx, cy, (r / V.feetPerCell(g)) * s, 0, Math.PI * 2); ctx.stroke(); }
        }
        ctx.restore();
      }
      const room = g.vision.rooms.find((r) => r.id === selectedRoom);
      if (tool === 'v-stanza' || room) {
        const rc = palette().room;
        for (const r of g.vision.rooms) {
          if (tool !== 'v-stanza' && r !== room) continue;
          ctx.save();
          ctx.fillStyle = 'rgba(' + rc.join(',') + ',' + (r === room ? 0.32 : 0.14) + ')';
          for (const cell of r.cells) ctx.fillRect(view.panX + cell.x * s, view.panY + cell.y * s, s, s);
          ctx.restore();
        }
      }
      if (tool === 'v-blocco') {
        ctx.save();
        const cols = { 1: 'rgba(212,69,58,0.45)', 2: 'rgba(63,174,99,0.4)', 3: 'rgba(150,150,170,0.45)' };
        for (let i = 0; i < g.vision.sight.length; i++) {
          const v = g.vision.sight[i];
          const x = i % g.w;
          const y = Math.floor(i / g.w);
          if (v !== '0') { ctx.fillStyle = cols[v]; ctx.fillRect(view.panX + x * s + 2, view.panY + y * s + 2, s - 4, s - 4); }
          else if (c.ctx.sm.block[i]) { ctx.strokeStyle = 'rgba(212,69,58,0.55)'; ctx.strokeRect(view.panX + x * s + 3.5, view.panY + y * s + 3.5, s - 7, s - 7); }
        }
        ctx.restore();
      }
    }

    // Anteprima «Vedi come»: pedine e oggetti che non si vedono restano nascosti.
    function hideToken(t) {
      if (viewAs === 'master') return false;
      const c = compute();
      return Boolean(c && c.seen && !c.seen.has(t.id));
    }
    function hideItem(it) {
      if (viewAs === 'master') return false;
      if (it.hidden) return true;
      const c = compute();
      if (!c || !c.known) return false;
      const g = doc().grid;
      const need = it.otype === 'npc' ? 2 : 1;
      for (let j = 0; j < it.h; j++) for (let i = 0; i < it.w; i++) if ((c.known[(it.y + j) * g.w + it.x + i] || 0) >= need) return false;
      return true;
    }
    // Livello di luce in una cella (indicatore della pedina corrente).
    function levelAt(x, y) { const c = compute(); return c ? V.lightAt(c.ctx, x, y) : 2; }

    // ---- Strumenti (pittore della griglia) ----
    function setTool(t) {
      tool = t;
      if (t && opts.otherPainter) opts.otherPainter().deactivate();
      refreshPanels();
      if (W()) { W().updateUi(); W().requestDraw(); }
    }
    const inGrid = (g, c) => c && c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h;
    function applyBrush(a, b) {
      const d = doc();
      const n = edit((g) => {
        g.fog.enabled = true;
        return V.paintFog(g, V.brushCells(g, brush, a, b, brush === 'riempi' ? V.sightMap(g, tilesets()) : null), tool === 'v-rivela');
      });
      if (d && !n) toast('Nessuna cella cambiata.');
    }
    const painter = {
      active: () => Boolean(tool),
      deactivate: () => { if (tool) { tool = null; drag = null; refreshPanels(); } },
      down(cell) {
        const d = doc();
        if (!d || !inGrid(d.grid, cell)) return;
        const g = d.grid;
        if (tool === 'v-luce') {
          const hit = g.vision.lights.find((l) => l.x === cell.x && l.y === cell.y);
          if (hit) { selectedLight = hit.id; changed(); return; }
          edit((gr) => {
            const dark = lightKind === 'oscurita';
            const src = V.sourceById(lightKind);
            const l = V.normalizeLight(dark ? { name: K.DARKNESS.name, dark: true, x: cell.x, y: cell.y, minutes: null }
              : { name: src.name, kind: src.id, bright: src.bright, dim: src.dim, color: src.color, flicker: src.flicker, x: cell.x, y: cell.y, minutes: null }, gr);
            gr.vision.lights.push(l);
            selectedLight = l.id;
          });
          return;
        }
        if (tool === 'v-blocco') {
          drag = { value: K.SIGHT_CYCLE[g.vision.sight[cell.y * g.w + cell.x]], before: W().tileSnapshot(), cells: new Set() };
          setSight(cell);
          return;
        }
        if (tool === 'v-stanza') {
          let room = g.vision.rooms.find((r) => r.id === selectedRoom);
          const before = W().tileSnapshot();
          if (!room) {
            room = V.normalizeRoom({ name: 'Stanza ' + (g.vision.rooms.length + 1) }, g);
            g.vision.rooms.push(room);
            selectedRoom = room.id;
          }
          drag = { before, adding: !room.cells.some((c) => c.x === cell.x && c.y === cell.y) };
          toggleRoomCell(cell);
          return;
        }
        if (tool === 'v-rivela' || tool === 'v-nascondi') {
          if (brush === 'riempi') { applyBrush(cell); return; }
          drag = { a: cell, b: cell };
          return;
        }
        if (tool === 'v-vedi') {
          probe = { pos: { x: cell.x, y: cell.y }, kind: probe.kind };
          viewAs = 'punto';
          changed();
        }
      },
      move(cell, e, dragging) {
        hover = cell;
        const d = doc();
        if (drag && dragging && cell && d && inGrid(d.grid, cell)) {
          if (tool === 'v-blocco') setSight(cell);
          else if (tool === 'v-stanza') toggleRoomCell(cell);
          else if (drag.a) drag.b = cell;
        }
        if (W()) W().requestDraw();
      },
      up(cell) {
        const dr = drag;
        drag = null;
        if (!dr) return;
        if (tool === 'v-blocco' || tool === 'v-stanza') { W().commitTiles(dr.before); changed(); return; }
        if (dr.a) applyBrush(dr.a, cell || dr.b);
      },
      draw(ctx, view, s) {
        const d = doc();
        if (!d || !tool) return;
        ctx.save();
        ctx.strokeStyle = palette().mark;
        ctx.setLineDash([5, 4]);
        if (drag && drag.a && drag.b) {
          if (brush === 'rettangolo') {
            const r = G.rectBetween(drag.a, drag.b, d.grid);
            ctx.strokeRect(view.panX + r.x * s, view.panY + r.y * s, r.w * s, r.h * s);
          } else {
            const r = Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) + 0.5;
            ctx.beginPath();
            ctx.arc(view.panX + (drag.a.x + 0.5) * s, view.panY + (drag.a.y + 0.5) * s, r * s, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (hover) ctx.strokeRect(view.panX + hover.x * s + 0.5, view.panY + hover.y * s + 0.5, s - 1, s - 1);
        ctx.restore();
      },
      hint: () => (tool ? HINTS[tool] : ''),
    };
    function setSight(cell) {
      const g = doc().grid;
      const k = cell.y * g.w + cell.x;
      if (drag.cells.has(k)) return;
      drag.cells.add(k);
      g.vision.sight = g.vision.sight.slice(0, k) + drag.value + g.vision.sight.slice(k + 1);
      cache = null;
      W().requestDraw();
    }
    function toggleRoomCell(cell) {
      const g = doc().grid;
      const room = g.vision.rooms.find((r) => r.id === selectedRoom);
      if (!room) return;
      const has = room.cells.some((c) => c.x === cell.x && c.y === cell.y);
      if (drag.adding && !has && room.cells.length < K.MAX_ROOM_CELLS) room.cells.push({ x: cell.x, y: cell.y });
      else if (!drag.adding && has) room.cells = room.cells.filter((c) => c.x !== cell.x || c.y !== cell.y);
      W().requestDraw();
    }

    // ---- Pannelli ----
    const panels = new Set();
    function refreshPanels() { for (const p of panels) p(); }
    const toolBtn = (t) => el('button', { type: 'button', class: 'btn small tool' + (tool === t ? ' active' : ''), 'aria-pressed': String(tool === t), text: TOOLS[t], onclick: () => setTool(tool === t ? null : t) });
    const btn = (text, onclick, title) => el('button', { type: 'button', class: 'btn small', text, title, 'aria-label': title || text, onclick });

    function viewSelect() {
      const d = doc();
      const sel = el('select', { 'aria-label': 'Vedi come', onchange: (e) => { viewAs = e.target.value; if (viewAs === 'punto' && !probe.pos) setTool('v-vedi'); changed(); } },
        opt('master', '👁 Master (tutto)', viewAs === 'master'), opt('giocatori', 'Come i giocatori', viewAs === 'giocatori'),
        d ? d.combatants.filter((c) => c.pos).map((c) => opt('pedina:' + c.id, 'Come ' + c.name, viewAs === 'pedina:' + c.id)) : [],
        mode === 'editor' ? opt('punto', 'Da un punto scelto…', viewAs === 'punto') : null);
      return sel;
    }
    function fogControls(g) {
      return el('div', { class: 'explore-tool-row' },
        el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: g.fog.enabled, onchange: (e) => edit((gr) => { gr.fog.enabled = e.target.checked; }) }), ' Nebbia di guerra'),
        el('label', { class: 'inline small' }, 'Modalità', el('select', { onchange: (e) => edit((gr) => { gr.fog.mode = e.target.value; }) },
          K.FOG_MODES.map((m) => opt(m, K.FOG_MODE_NAMES[m], g.fog.mode === m)))),
        el('label', { class: 'inline small' }, 'Pennello', el('select', { onchange: (e) => { brush = e.target.value; refreshPanels(); } },
          K.BRUSHES.map((b) => opt(b, K.BRUSH_NAMES[b], brush === b)))),
        toolBtn('v-rivela'), toolBtn('v-nascondi'),
        btn('Rivela tutto', () => edit((gr) => { gr.fog.enabled = true; V.revealAll(gr); })),
        btn('Nascondi tutto', () => { if (confirm('Nascondere tutta la mappa e dimenticare le celle esplorate?')) edit((gr) => { gr.fog.enabled = true; V.hideAll(gr); }); }));
    }

    // Pannello completo «Luce e visione» (Editor griglie; nel gioco dentro una finestra).
    function panel() {
      const node = el('section', { class: 'panel vision-panel', 'aria-label': 'Luce e visione' });
      const render = () => {
        clear(node);
        const d = doc();
        if (!d || !d.grid) return;
        const g = V.ensure(d.grid);
        const v = g.vision;
        const lights = v.lights;
        const sel = lights.find((l) => l.id === selectedLight);
        const room = v.rooms.find((r) => r.id === selectedRoom);
        const c = cache;
        node.append(
          el('div', { class: 'explore-tools-head' }, el('h3', { text: '🔦 Luce e visione' }),
            el('span', { class: 'muted small', text: c ? 'ricalcolo ' + Math.round(c.ms) + ' ms' : '' })),
          el('div', { class: 'explore-cols' },
            el('fieldset', {}, el('legend', { text: 'Luce' }),
              el('div', { class: 'input-row' },
                el('label', { class: 'inline small' }, 'Luce ambientale', el('select', { onchange: (e) => edit((gr) => { gr.vision.ambient = e.target.value; }) },
                  K.AMBIENTS.filter((a) => a !== 'auto' || g.kind === 'esplorazione').map((a) => opt(a, K.AMBIENT_NAMES[a], v.ambient === a)))),
                el('label', { class: 'check small', title: 'Celle nette invece del gradiente morbido (più veloce)' }, el('input', { type: 'checkbox', checked: v.stepped, onchange: (e) => edit((gr) => { gr.vision.stepped = e.target.checked; }) }), ' Luce a gradini')),
              el('div', { class: 'explore-tool-row' },
                el('select', { 'aria-label': 'Sorgente da piazzare', onchange: (e) => { lightKind = e.target.value; setTool('v-luce'); } },
                  K.SOURCES.map((s) => opt(s.id, s.icon + ' ' + s.name, lightKind === s.id)), opt('oscurita', K.DARKNESS.icon + ' ' + K.DARKNESS.name, lightKind === 'oscurita')),
                toolBtn('v-luce')),
              lights.length ? el('ul', { class: 'placed-events' }, lights.map((l) => el('li', { class: l.id === selectedLight ? 'selected' : '' },
                el('button', { type: 'button', class: 'link-btn', text: (l.dark ? '🌑 ' : '💡 ') + l.name + ' · ' + G.cellLabel(l.x, l.y), onclick: () => { selectedLight = l.id === selectedLight ? null : l.id; changed(); } }),
                el('span', { class: 'muted small', text: (l.on ? '' : 'spenta · ') + (l.minutes === null ? '' : Math.round(l.minutes) + ' min') + (l.link ? ' · concentrazione' : '') }),
                el('span', { class: 'action-tools' },
                  el('button', { type: 'button', class: 'icon-btn', text: l.on ? '🌑' : '🔥', title: l.on ? 'Spegni' : 'Accendi', 'aria-label': l.on ? 'Spegni ' + l.name : 'Accendi ' + l.name,
                    onclick: () => edit((gr) => { const x = gr.vision.lights.find((y) => y.id === l.id); x.on = !x.on; if (x.on && x.minutes === 0) x.minutes = null; }) }),
                  el('button', { type: 'button', class: 'icon-btn danger', text: '✕', title: 'Togli', 'aria-label': 'Togli ' + l.name, onclick: () => edit((gr) => { gr.vision.lights = gr.vision.lights.filter((y) => y.id !== l.id); }) })))))
                : el('p', { class: 'muted small', text: 'Nessuna sorgente piazzata. Anche strutture, oggetti di mappa e pedine possono fare luce.' }),
              sel ? lightForm(sel) : null),
            el('fieldset', {}, el('legend', { text: 'Vista e stanze' }),
              el('div', { class: 'explore-tool-row' }, toolBtn('v-blocco'), toolBtn('v-stanza'),
                btn('+ Stanza', () => edit((gr) => { const r = V.normalizeRoom({ name: 'Stanza ' + (gr.vision.rooms.length + 1) }, gr); gr.vision.rooms.push(r); selectedRoom = r.id; tool = 'v-stanza'; }))),
              v.rooms.length ? el('ul', { class: 'placed-events' }, v.rooms.map((r) => el('li', { class: r.id === selectedRoom ? 'selected' : '' },
                el('button', { type: 'button', class: 'link-btn', text: r.name + ' · ' + r.cells.length + ' celle', onclick: () => { selectedRoom = r.id === selectedRoom ? null : r.id; changed(); } }),
                el('span', { class: 'muted small', text: r.revealed ? 'rivelata' : 'da rivelare' }),
                el('span', { class: 'action-tools' },
                  el('button', { type: 'button', class: 'icon-btn', text: '✎', title: 'Rinomina', 'aria-label': 'Rinomina ' + r.name, onclick: () => { const n = prompt('Nome della stanza', r.name); if (n && n.trim()) edit((gr) => { gr.vision.rooms.find((x) => x.id === r.id).name = n.trim().slice(0, 60); }); } }),
                  el('button', { type: 'button', class: 'icon-btn', text: '↺', title: 'Torna «da rivelare»', 'aria-label': 'Azzera ' + r.name, onclick: () => edit((gr) => { gr.vision.rooms.find((x) => x.id === r.id).revealed = false; }) }),
                  el('button', { type: 'button', class: 'icon-btn danger', text: '✕', title: 'Elimina', 'aria-label': 'Elimina ' + r.name, onclick: () => edit((gr) => { gr.vision.rooms = gr.vision.rooms.filter((x) => x.id !== r.id); if (selectedRoom === r.id) selectedRoom = null; }) })))))
                : el('p', { class: 'muted small', text: 'Una stanza si rivela tutta quando un giocatore ci entra o si apre una porta che la tocca.' }),
              room ? el('p', { class: 'muted small', text: 'Stanza selezionata: «' + room.name + '». Usa 🚪 Stanza per aggiungere o togliere celle.' }) : null,
              legend()),
            el('fieldset', {}, el('legend', { text: 'Nebbia di guerra' }), fogControls(g),
              el('div', { class: 'input-row' },
                el('label', { class: 'inline small' }, 'Velo del master', el('input', { type: 'range', min: 10, max: 95, value: String(Math.round(g.fog.opacity * 100)), 'aria-label': 'Opacità del velo',
                  onchange: (e) => edit((gr) => { gr.fog.opacity = Number(e.target.value) / 100; }) })),
                el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: g.fog.ghosts, onchange: (e) => edit((gr) => { gr.fog.ghosts = e.target.checked; }) }), ' Ultime posizioni note (fantasmi)'))),
            el('fieldset', {}, el('legend', { text: 'Vedi come' }),
              el('div', { class: 'input-row' }, viewSelect(),
                mode === 'editor' ? el('select', { 'aria-label': 'Sensi del punto scelto', onchange: (e) => { probe = { pos: probe.pos, kind: e.target.value }; changed(); } },
                  K.PROBES.map((pr) => opt(pr.id, pr.name, probe.kind === pr.id))) : null,
                mode === 'editor' ? toolBtn('v-vedi') : null),
              el('p', { class: 'muted small', text: viewAs === 'master' ? 'Il master vede tutto: le zone non rivelate hanno un velo.' : 'Anteprima: celle e pedine fuori vista coperte, come le vedrebbero i giocatori.' }))));
      };
      panels.add(render);
      render();
      return { node, refresh: render, dispose: () => panels.delete(render) };
    }
    function lightForm(l) {
      const name = el('input', { type: 'text', value: l.name, maxlength: 60, 'aria-label': 'Nome della sorgente' });
      const bright = numberInput(l.bright, { min: 0, max: 1000, step: 5, 'aria-label': 'Luce intensa (piedi)' });
      const dim = numberInput(l.dim, { min: 0, max: 1000, step: 5, 'aria-label': 'Penombra oltre (piedi)' });
      const color = el('input', { type: 'color', value: l.color, 'aria-label': 'Colore' });
      const minutes = numberInput(l.minutes === null ? '' : l.minutes, { min: 0, max: 100000, placeholder: 'illimitata', 'aria-label': 'Durata in minuti' });
      const flicker = el('input', { type: 'checkbox', checked: l.flicker });
      return el('div', { class: 'form vision-light-form' },
        el('div', { class: 'grid-3 tight' }, field('Nome', name), field(l.dark ? 'Raggio del buio (ft)' : 'Luce intensa (ft)', l.dark ? dim : bright), l.dark ? null : field('Penombra oltre (ft)', dim)),
        el('div', { class: 'grid-3 tight' }, l.dark ? null : field('Colore', color), field('Durata (minuti di gioco)', minutes), l.dark ? null : el('label', { class: 'check' }, flicker, ' Intermittenza')),
        el('p', { class: 'muted small', text: l.dark ? 'Buio magico: niente luce, la scurovisione non vede, la vista pura sì.' : 'Luce intensa ' + fmtFt(l.bright) + ', penombra fino a ' + fmtFt(l.bright + l.dim) + '.' }),
        el('div', { class: 'form-actions' }, btn('Applica', () => edit((gr) => {
          const x = gr.vision.lights.find((y) => y.id === l.id);
          Object.assign(x, V.normalizeLight(Object.assign({}, x, { name: name.value, bright: readNumber(bright), dim: readNumber(dim), color: color.value, flicker: flicker.checked,
            minutes: minutes.value.trim() === '' ? null : readNumber(minutes) }), gr));
        }))));
    }
    function legend() {
      return el('ul', { class: 'biome-legend vision-legend' }, K.LEVELS.map((lv) => el('li', { title: K.LEVEL_RULES[lv] },
        el('span', { class: 'biome-swatch vision-swatch-' + lv }), K.LEVEL_ICONS[lv] + ' ' + K.LEVEL_NAMES[lv])),
        el('li', { title: 'Celle mai viste dai giocatori' }, el('span', { class: 'biome-swatch vision-swatch-fog' }), 'Nebbia'),
        el('li', { title: 'Celle già viste: strutture e tile, senza pedine nemiche' }, el('span', { class: 'biome-swatch vision-swatch-explored' }), 'Esplorata'));
    }

    // Barra rapida del Combattimento e dell'Esplorazione: nebbia, rivela/nascondi area, «Vedi come», pannello completo.
    function quickBar() {
      const node = el('div', { class: 'vision-quick explore-tool-row', role: 'toolbar', 'aria-label': 'Luce e nebbia' });
      const render = () => {
        clear(node);
        const d = doc();
        if (!d || !d.grid) return;
        const g = V.ensure(d.grid);
        node.append(
          el('button', { type: 'button', class: 'btn small', 'aria-pressed': String(g.fog.enabled), text: g.fog.enabled ? '🌫 Nebbia attiva' : '🌫 Nebbia spenta',
            onclick: () => edit((gr) => { gr.fog.enabled = !gr.fog.enabled; }) }),
          toolBtn('v-rivela'), toolBtn('v-nascondi'),
          el('select', { 'aria-label': 'Pennello della nebbia', onchange: (e) => { brush = e.target.value; refreshPanels(); } }, K.BRUSHES.map((b) => opt(b, K.BRUSH_NAMES[b], brush === b))),
          viewSelect(),
          btn('🔦 Luce e visione…', () => {
            const p = panel();
            const dialog = openDialog('Luce e visione', p.node, [{ text: 'Chiudi' }]);
            dialog.classList.add('wide');
            dialog.addEventListener('close', () => p.dispose());
          }, 'Luce ambientale, sorgenti, nebbia, stanze'));
      };
      panels.add(render);
      render();
      return node;
    }

    return {
      painter, draw, compute, hideToken, hideItem, levelAt, panel, quickBar, emitterEditor,
      reset: () => { tool = null; selectedLight = null; selectedRoom = null; viewAs = 'master'; probe = { pos: null, kind: 'normale' }; cache = null; },
      invalidate: () => { cache = null; },
      viewAs: () => viewAs,
      setViewAs: (v) => { viewAs = v; changed(); },
      tool: () => tool,
    };
  }

  DnD.uiVisione = { create, emitterEditor, TOOLS, palette };
})(globalThis.DnD = globalThis.DnD || {});
