// Mappa di esplorazione sul canvas della griglia: disegno della sovrapposizione dei biomi (con legenda) e degli
// eventi piazzati (icona, area, occhio barrato per quelli nascosti); pannello degli strumenti per l'Editor griglie
// (Bioma: pennello, riempi, rettangolo, gomma, contagocce, genera da bioma; Evento: piazza, area, modifica la copia,
// aggiorna dal modello) e, nella schermata Esplorazione, lo strumento del master «Interagisci». La nebbia di scoperta
// è la nebbia di guerra di «Luce e visione» (visione.js, ui-visione.js), unica per tutte le griglie.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, readNumber, toast, openDialog } = DnD.ui;
  const B = DnD.biomi;
  const E = DnD.eventi;
  const X = DnD.esplorazione;
  const G = DnD.griglia;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });

  // ---------- Disegno ----------
  function visibleRange(view, s, grid, W, H) {
    return {
      x0: Math.max(0, Math.floor(-view.panX / s)), y0: Math.max(0, Math.floor(-view.panY / s)),
      x1: Math.min(grid.w - 1, Math.floor((W - view.panX) / s)), y1: Math.min(grid.h - 1, Math.floor((H - view.panY) / s)),
    };
  }
  const biomeIndex = () => {
    const raw = new Map(DnD.store.state.biomes.map((b) => [b.id, b]));
    return new Map([...raw.values()].map((b) => [b.id, B.resolve(b, raw)]));
  };

  // Sovrapposizione colorata dei biomi (le celle senza bioma dipinto usano il predefinito, più tenue).
  function drawBiomes(ctx, view, s, grid, W, H) {
    const map = grid.biomeMap;
    if (!map || !map.overlay.visible) return;
    const idx = biomeIndex();
    const r = visibleRange(view, s, grid, W || 1e5, H || 1e5);
    ctx.save();
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const painted = B.paintedBiome(map, grid.w, x, y);
        const id = painted || map.defaultId;
        const b = id ? idx.get(id) : null;
        if (!b) continue;
        ctx.globalAlpha = map.overlay.opacity * (painted ? 1 : 0.45);
        ctx.fillStyle = b.color;
        ctx.fillRect(view.panX + x * s, view.panY + y * s, s, s);
      }
    }
    ctx.restore();
  }

  // Eventi piazzati: area tenue, icona nella prima cella; per il master quelli nascosti hanno l'occhio barrato.
  // opts: { master, selectedId, playerView, onLoad }
  function drawEvents(ctx, view, s, grid, opts) {
    opts = opts || {};
    for (const inst of grid.events || []) {
      const visible = E.isVisible(inst);
      if (opts.playerView && !visible) continue;
      const spent = (inst.event.repeat.kind === 'una' && inst.state.fired >= 1) || (inst.event.repeat.kind === 'n' && inst.state.fired >= inst.event.repeat.times) || inst.state.disabled;
      ctx.save();
      ctx.fillStyle = inst.event.icon.color;
      ctx.globalAlpha = 0.18;
      for (const c of inst.cells) ctx.fillRect(view.panX + c.x * s, view.panY + c.y * s, s, s);
      ctx.globalAlpha = 1;
      if (inst.id === opts.selectedId) {
        ctx.strokeStyle = inst.event.icon.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        for (const c of inst.cells) ctx.strokeRect(view.panX + c.x * s + 1.5, view.panY + c.y * s + 1.5, s - 3, s - 3);
        ctx.setLineDash([]);
      }
      const c0 = inst.cells[0];
      const pad = s * 0.14;
      ctx.globalAlpha = spent ? 0.4 : visible ? 1 : 0.6;
      DnD.icone.drawIconRect(ctx, inst.event.icon, view.panX + c0.x * s + pad, view.panY + c0.y * s + pad, s - 2 * pad, s - 2 * pad, opts.onLoad);
      ctx.globalAlpha = 1;
      if (!visible && opts.master) eyeSlash(ctx, view.panX + (c0.x + 1) * s - s * 0.2, view.panY + c0.y * s + s * 0.2, Math.max(5, s * 0.17));
      if (spent && opts.master) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.font = Math.max(9, s * 0.3) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✓', view.panX + c0.x * s + s * 0.8, view.panY + (c0.y + 1) * s - s * 0.12);
      }
      ctx.restore();
    }
  }
  function eyeSlash(ctx, cx, cy, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,22,28,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.2, r * 0.22);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + r * 0.8);
    ctx.lineTo(cx + r, cy - r * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  // Legenda dei biomi usati dalla mappa.
  function legend(grid) {
    const idx = biomeIndex();
    const ids = B.usedIds(grid.biomeMap);
    if (!ids.length) return el('p', { class: 'muted small', text: 'Nessun bioma sulla mappa.' });
    return el('ul', { class: 'biome-legend' }, ids.map((id) => {
      const b = idx.get(id);
      return el('li', {}, el('span', { class: 'biome-swatch', style: 'background:' + (b ? b.color : '#888') }),
        b ? b.name : '⚠ bioma eliminato', grid.biomeMap.defaultId === id ? el('span', { class: 'muted small', text: ' (predefinito)' }) : null);
    }));
  }

  // ---------- Strumenti (Editor griglie e schermata Esplorazione) ----------
  const TOOLS = {
    'b-pennello': '🖌 Pennello', 'b-riempi': '🪣 Riempi', 'b-rettangolo': '▭ Rettangolo', 'b-gomma': '🧽 Gomma', 'b-contagocce': '💧 Contagocce',
    'e-piazza': '📍 Piazza evento', 'e-area': '▦ Celle dell\'area', 'e-interagisci': '👆 Interagisci',
  };
  const HINTS = {
    'b-pennello': 'Trascina per dipingere il bioma scelto.', 'b-riempi': 'Clicca: riempie l\'area contigua con il bioma scelto.',
    'b-rettangolo': 'Trascina un rettangolo di bioma.', 'b-gomma': 'Trascina per togliere il bioma (resta il predefinito).',
    'b-contagocce': 'Clicca una cella per scegliere il suo bioma.',
    'e-piazza': 'Clicca una cella: piazza una copia del modello scelto.', 'e-area': 'Clicca o trascina sulle celle per aggiungerle (o toglierle) all\'area dell\'evento selezionato.',
    'e-interagisci': 'Clicca un evento sulla mappa: si apre la finestra evento.',
  };

  // opts: { getGrid(), widget(), mode: 'editor' | 'gioco', onInteract(inst) (gioco), onChange() }
  function create(opts) {
    const mode = opts.mode || 'editor';
    let tool = null;
    let biomeId = '';
    let templateId = '';
    let selectedId = null;
    let drag = null;
    let hover = null;
    const node = el('section', { class: 'panel explore-tools' });
    const grid = () => opts.getGrid();
    const W = () => opts.widget();

    function setTool(t) {
      tool = t;
      if (t && opts.otherPainter) opts.otherPainter().deactivate();
      refresh();
      if (W()) { W().updateUi(); W().requestDraw(); }
    }
    const changed = () => { if (opts.onChange) opts.onChange(); if (W()) W().requestDraw(); };

    function ensureMap(g) {
      if (!g.biomeMap) g.biomeMap = B.emptyMap(g.w, g.h, '');
      return g.biomeMap;
    }
    function applyAt(cell, extend) {
      const g = grid();
      if (!g || !cell || cell.x < 0 || cell.y < 0 || cell.x >= g.w || cell.y >= g.h) return false;
      if (tool === 'b-pennello' || tool === 'b-gomma') {
        if (tool === 'b-pennello' && !biomeId) { toast('Scegli un bioma nel pannello.', 'error'); return false; }
        return B.paint(ensureMap(g), g.w, g.h, [cell], tool === 'b-gomma' ? '' : biomeId) > 0;
      }
      if (tool === 'b-riempi') {
        if (!biomeId) { toast('Scegli un bioma nel pannello.', 'error'); return false; }
        const m = ensureMap(g);
        return B.paint(m, g.w, g.h, B.fillCells(m, g.w, g.h, cell), biomeId) > 0;
      }
      if (tool === 'b-contagocce') {
        biomeId = B.cellBiome(g.biomeMap, g.w, cell.x, cell.y);
        setTool('b-pennello');
        return false;
      }
      if (tool === 'e-piazza') {
        const t = DnD.store.state.events.find((e) => e.id === templateId);
        if (!t) { toast('Scegli un modello di evento.', 'error'); return false; }
        const now = mode === 'gioco' && DnD.sessioni.current(DnD.store.state).exploration ? DnD.sessioni.current(DnD.store.state).exploration.time.total : 0;
        const inst = E.instantiate(t, [cell], now);
        g.events = (g.events || []).concat(inst);
        selectedId = inst.id;
        if (t.area) setTool('e-area');
        return true;
      }
      if (tool === 'e-area') {
        const inst = (g.events || []).find((i) => i.id === selectedId);
        if (!inst) { toast('Seleziona prima un evento piazzato (elenco nel pannello).', 'error'); return false; }
        const has = E.inCells(inst.cells, cell);
        if (extend !== undefined ? extend === has : false) return false;
        if (has && inst.cells.length > 1) inst.cells = inst.cells.filter((c) => c.x !== cell.x || c.y !== cell.y);
        else if (!has) inst.cells.push({ x: cell.x, y: cell.y });
        else return false;
        drag && (drag.adding = !has);
        return true;
      }
      if (tool === 'e-interagisci') {
        const inst = (g.events || []).find((i) => E.inCells(i.cells, cell));
        if (inst && opts.onInteract) opts.onInteract(inst);
        return false;
      }
      return false;
    }

    const painter = {
      active: () => Boolean(tool),
      deactivate: () => { if (tool) { tool = null; refresh(); } },
      down(cell) {
        drag = { before: W().tileSnapshot(), changed: false, a: cell, b: cell, adding: undefined };
        if (tool === 'b-rettangolo') return;
        drag.changed = applyAt(cell) || drag.changed;
        if (drag && drag.changed) changed();
      },
      move(cell, e, dragging) {
        hover = cell;
        if (!drag || !dragging || !cell) { if (W()) W().requestDraw(); return; }
        if (tool === 'b-rettangolo') { drag.b = cell; W().requestDraw(); return; }
        if (['b-pennello', 'b-gomma', 'e-area'].includes(tool)) {
          if (applyAt(cell, tool === 'e-area' ? drag.adding : undefined)) { drag.changed = true; changed(); }
        }
      },
      up(cell) {
        const d = drag;
        drag = null;
        if (!d) return;
        if (tool === 'b-rettangolo' && cell) {
          const g = grid();
          if (!biomeId) toast('Scegli un bioma nel pannello.', 'error');
          else d.changed = B.paint(ensureMap(g), g.w, g.h, B.rectCells(d.a, cell), biomeId) > 0;
        }
        if (d.changed) { W().commitTiles(d.before); changed(); refresh(); }
      },
      draw(ctx, view, s, Wd, Hd) {
        const g = grid();
        if (!g || g.kind !== 'esplorazione') return;
        if (mode === 'editor') {
          drawBiomes(ctx, view, s, g, Wd, Hd);
          drawEvents(ctx, view, s, g, { master: true, selectedId, onLoad: () => W().requestDraw() });
        } else if (selectedId) {
          drawEvents(ctx, view, s, { events: (g.events || []).filter((i) => i.id === selectedId) }, { master: true, selectedId, onLoad: () => W().requestDraw() });
        }
        if (drag && tool === 'b-rettangolo') {
          const r = G.rectBetween(drag.a, drag.b, g);
          ctx.save();
          ctx.strokeStyle = '#ffffff';
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(view.panX + r.x * s, view.panY + r.y * s, r.w * s, r.h * s);
          ctx.restore();
        } else if (tool && hover) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.strokeRect(view.panX + hover.x * s + 0.5, view.panY + hover.y * s + 0.5, s - 1, s - 1);
          ctx.restore();
        }
      },
      hint: () => (tool ? HINTS[tool] : ''),
    };

    // ---------- Pannello ----------
    const toolBtn = (t) => el('button', { type: 'button', class: 'btn small tool' + (tool === t ? ' active' : ''), 'aria-pressed': String(tool === t), text: TOOLS[t], onclick: () => setTool(tool === t ? null : t) });

    function editInstance(inst) {
      const host = el('div', {});
      const dialog = openDialog('Copia piazzata: ' + inst.event.name, host, []);
      dialog.classList.add('wide');
      DnD.uiEventi.eventForm(host, inst.event, {
        title: 'Modifica solo questa copia (il modello non cambia)', saveText: 'Applica alla copia',
        onCancel: () => dialog.dismiss(),
        onSave: (ev) => {
          const g = grid();
          const before = W().tileSnapshot();
          const i = g.events.find((x) => x.id === inst.id);
          i.event = ev;
          W().commitTiles(before);
          dialog.dismiss();
          changed();
          refresh();
        },
      });
    }

    function generateDialog() {
      const g = grid();
      const biomes = DnD.store.state.biomes;
      const checks = biomes.map((b) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: b.id, checked: ['bioma-foresta', 'bioma-pianura', 'bioma-palude'].includes(b.id) }), ' ' + b.name));
      const seed = numberInput(Math.floor(Math.random() * 99999) + 1, { min: 1, max: 2147483646 });
      const blob = numberInput(60, { min: 4, max: 1000 });
      const onlyEmpty = el('input', { type: 'checkbox', checked: true });
      openDialog('Genera da bioma', el('div', { class: 'form' },
        el('p', { class: 'muted small', text: 'Riempie la mappa con macchie casuali dei biomi scelti; lo stesso seme dà sempre lo stesso risultato. Poi si ritocca a mano.' }),
        el('div', { class: 'check-row' }, checks),
        el('div', { class: 'grid-3 tight' }, field('Seme', seed), field('Celle per macchia (circa)', blob)),
        el('label', { class: 'check' }, onlyEmpty, ' Solo le celle senza bioma')), [
        { text: 'Annulla' },
        { text: 'Genera', class: 'primary', onclick: () => {
          const ids = checks.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
          if (!ids.length) { toast('Scegli almeno un bioma.', 'error'); return false; }
          const before = W().tileSnapshot();
          const n = B.generate(ensureMap(g), g.w, g.h, ids, readNumber(seed) || 1, { blob: readNumber(blob) || 60, onlyEmpty: onlyEmpty.checked });
          W().commitTiles(before);
          changed();
          refresh();
          toast(n + ' celle generate.');
          return undefined;
        } },
      ]);
    }

    function refresh() {
      const g = grid();
      clear(node);
      if (!g || g.kind !== 'esplorazione') { node.hidden = true; return; }
      node.hidden = false;
      const st = DnD.store.state;
      const map = g.biomeMap;
      const idx = biomeIndex();
      const setMap = (fn) => { const before = W().tileSnapshot(); fn(ensureMap(g)); W().commitTiles(before); changed(); refresh(); };
      const events = g.events || [];
      if (mode === 'gioco') {
        node.append(el('div', { class: 'explore-tool-row' }, el('span', { class: 'muted small', text: 'Master:' }), toolBtn('e-interagisci'), opts.extra ? opts.extra() : null));
        return;
      }
      node.append(
        el('div', { class: 'explore-tools-head' }, el('h3', { text: '🧭 Mappa di esplorazione' }), el('span', { class: 'muted small', text: X.scaleLabel(g.scale) })),
        el('div', { class: 'explore-cols' },
          el('fieldset', {}, el('legend', { text: 'Biomi' }),
            el('div', { class: 'explore-tool-row' }, ['b-pennello', 'b-riempi', 'b-rettangolo', 'b-gomma', 'b-contagocce'].map(toolBtn),
              el('button', { type: 'button', class: 'btn small', text: '🎲 Genera da bioma', onclick: generateDialog })),
            el('div', { class: 'biome-palette', role: 'listbox', 'aria-label': 'Bioma da dipingere' }, st.biomes.map((b) => el('button', {
              type: 'button', class: 'biome-chip' + (b.id === biomeId ? ' active' : ''), role: 'option', 'aria-selected': String(b.id === biomeId), title: b.description || b.name,
              onclick: () => { biomeId = b.id; if (!tool || !tool.startsWith('b-') || tool === 'b-gomma' || tool === 'b-contagocce') setTool('b-pennello'); else refresh(); },
            }, el('span', { class: 'biome-swatch', style: 'background:' + (idx.get(b.id) || b).color }), b.name))),
            el('div', { class: 'input-row' },
              el('label', { class: 'inline small' }, 'Predefinito', el('select', { onchange: (e) => setMap((m) => { m.defaultId = e.target.value; }) },
                opt('', '— nessuno —', !map || !map.defaultId), st.biomes.map((b) => opt(b.id, b.name, map && map.defaultId === b.id)))),
              el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: !map || map.overlay.visible, onchange: (e) => setMap((m) => { m.overlay.visible = e.target.checked; }) }), ' Mostra'),
              el('label', { class: 'inline small' }, 'Opacità', el('input', { type: 'range', min: 5, max: 100, value: String(Math.round((map ? map.overlay.opacity : 0.45) * 100)),
                onchange: (e) => setMap((m) => { m.overlay.opacity = Number(e.target.value) / 100; }) }))),
            legend(g)),
          el('fieldset', {}, el('legend', { text: 'Eventi' }),
            el('div', { class: 'input-row' },
              el('select', { 'aria-label': 'Modello di evento', onchange: (e) => { templateId = e.target.value; setTool('e-piazza'); } },
                opt('', '— modello —', !templateId), st.events.map((e) => opt(e.id, e.name, e.id === templateId))),
              toolBtn('e-piazza'), toolBtn('e-area')),
            events.length ? el('ul', { class: 'placed-events' }, events.map((inst) => {
              const miss = E.missingRefs(inst.event, st);
              const tpl = st.events.find((e) => e.id === inst.templateId);
              return el('li', { class: inst.id === selectedId ? 'selected' : '' },
                el('button', { type: 'button', class: 'link-btn', text: inst.event.name + ' · ' + G.cellLabel(inst.cells[0].x, inst.cells[0].y) + (inst.cells.length > 1 ? ' (+' + (inst.cells.length - 1) + ')' : ''),
                  onclick: () => { selectedId = inst.id === selectedId ? null : inst.id; refresh(); W().requestDraw(); } }),
                el('span', { class: 'muted small', text: (E.isVisible(inst) ? '' : '🙈 ') + (inst.state.fired ? 'innescato ' + inst.state.fired + '× ' : '') }),
                miss.length ? el('span', { class: 'warn-text small', title: miss.join('; '), text: '⚠' }) : null,
                el('span', { class: 'action-tools' },
                  el('button', { type: 'button', class: 'icon-btn', text: '✎', title: 'Modifica questa copia', 'aria-label': 'Modifica questa copia', onclick: () => editInstance(inst) }),
                  el('button', { type: 'button', class: 'icon-btn', text: '⟳', title: tpl ? 'Aggiorna dal modello (lo stato resta)' : 'Modello eliminato', 'aria-label': 'Aggiorna dal modello', disabled: !tpl,
                    onclick: () => { if (!confirm('Sostituire questa copia con il modello «' + tpl.name + '»? Lo stato (innescato, scoperto) resta.')) return; const before = W().tileSnapshot(); Object.assign(inst, E.updateFromTemplate(inst, tpl)); W().commitTiles(before); changed(); refresh(); } }),
                  el('button', { type: 'button', class: 'icon-btn', text: '↺', title: 'Azzera lo stato', 'aria-label': 'Azzera lo stato', onclick: () => { const before = W().tileSnapshot(); inst.state = E.normalizeInstance({}).state; W().commitTiles(before); changed(); refresh(); } }),
                  el('button', { type: 'button', class: 'icon-btn danger', text: '✕', title: 'Togli dalla mappa', 'aria-label': 'Togli dalla mappa', onclick: () => { const before = W().tileSnapshot(); g.events = g.events.filter((x) => x.id !== inst.id); if (selectedId === inst.id) selectedId = null; W().commitTiles(before); changed(); refresh(); } })));
            })) : el('p', { class: 'muted small', text: 'Nessun evento piazzato.' })),
          el('p', { class: 'muted small', text: '🌫 La nebbia di scoperta è nel pannello «Luce e visione» (sotto), con la luce automatica dall\'ora e dal bioma.' })));
    }

    return {
      node, painter, refresh,
      reset: () => { tool = null; selectedId = null; drag = null; },
      select: (id) => { selectedId = id; refresh(); },
      tool: () => tool,
    };
  }

  // Due pittori (es. strumenti delle tile ed esplorazione) sulla stessa griglia: risponde quello attivo,
  // entrambi disegnano.
  function combinePainters(a, b) {
    const cur = () => (b.active() ? b : a);
    return {
      active: () => a.active() || b.active(),
      deactivate: () => { a.deactivate(); b.deactivate(); },
      down: (c, e) => cur().down(c, e),
      move: (c, e, d) => { if (a.active() || b.active()) cur().move(c, e, d); else { a.move(c, e, d); b.move(c, e, d); } },
      up: (c, e) => cur().up(c, e),
      draw: (ctx, view, s, W, H) => { b.draw(ctx, view, s, W, H); a.draw(ctx, view, s, W, H); },
      hint: () => cur().hint(),
    };
  }

  DnD.uiMappaEsplorazione = { create, combinePainters, drawBiomes, drawEvents, legend, eyeSlash, TOOLS };
})(globalThis.DnD = globalThis.DnD || {});
