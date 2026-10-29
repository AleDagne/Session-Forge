// Puntatore e tastiera sulla griglia: clic, doppio clic, trascinamento di pedine ed elementi, strumenti (inserimento,
// gomma, rettangoli, misuratore, etichette), spostamento e zoom della vista, menu contestuale, scorciatoie (annulla,
// ripeti, Canc, Esc, pannello). Livello interfaccia. Espone DnD.uiGrigliaPuntatore { puntatore(api) }: registra gli
// eventi sul canvas della griglia che lo chiama; usa DnD.ui, griglia, regole, audio.
(function (DnD) {
  'use strict';

  const { openMenu, toast } = DnD.ui;
  const G = DnD.griglia;
  const { DOUBLE_CLICK_MS, DRAG_THRESHOLD } = DnD.uiGrigliaDisegno;

  // api (dalla griglia, uiGriglia.create): stato condiviso S, opts, interruttore del pannello e funzioni della griglia:
  //   S, getPaletteToggle, actionsFor, canInsertAt, canvas, changed, commit, dims, doc, entity, entityPos, eraseAt, finishPick, finishRect, footprint, history, hitTest, insertAt, insertFootprint, isValidAt, labelAt, opts, painting, redo, removeEntity, requestDraw, ro, select, setTool, tokenActions, undo, updateUi
  function puntatore(api) {
    const { S, getPaletteToggle, actionsFor, canInsertAt, canvas, changed, commit, dims, doc, entity, entityPos, eraseAt, finishPick, finishRect, footprint, history, hitTest, insertAt, insertFootprint, isValidAt, labelAt, opts, painting, redo, removeEntity, requestDraw, ro, select, setTool, tokenActions, undo, updateUi } = api;

    // ---------- Puntatore sulla griglia ----------
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    const cellOf = (p) => G.screenToCell(S.view, p.sx, p.sy);
    const inGrid = (cell) => cell.x >= 0 && cell.y >= 0 && cell.x < dims().w && cell.y < dims().h;
    const clampCell = (c) => ({ x: Math.max(0, Math.min(dims().w - 1, c.x)), y: Math.max(0, Math.min(dims().h - 1, c.y)) });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      canvas.focus({ preventScroll: true });
      const p = local(e);
      const cell = cellOf(p);
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        e.preventDefault();
        S.drag = { type: 'pan', p0: p, view0: S.view, moved: true };
        return;
      }
      if (S.pick) {
        const hit = inGrid(cell) ? hitTest(cell, false) : null;
        if (hit && hit.kind === 'token') S.pick(hit.id);
        return;
      }
      if (painting()) {
        S.drag = { type: 'paint' };
        opts.painter.down(cell, e);
        return;
      }
      if (!inGrid(cell)) {
        S.drag = { type: 'pan', p0: p, view0: S.view, moved: false };
        return;
      }
      if (S.tool === 'misura') {
        S.measure = { a: cell, b: cell };
        S.drag = { type: 'S.measure' };
      } else if (S.tool === 'gomma') {
        S.drag = { type: 'erase', before: G.gridSnapshot(doc()), erased: eraseAt(cell) };
        changed();
      } else if (S.tool === 'riempi' || S.tool === 'zona-giocatori' || S.tool === 'zona-nemici') {
        S.drag = { type: 'rect', a: cell, b: cell };
      } else if (S.tool === 'struttura' || S.tool === 'oggetto' || S.tool === 'etichetta') {
        S.drag = { type: 'click-S.tool', p0: p, view0: S.view, cell, moved: false };
      } else if (ro) {
        // Sola vista: un clic seleziona la pedina, il trascinamento sposta solo la vista (o la propria pedina, con canDrag).
        const hit = hitTest(cell);
        if (hit && hit.kind === 'token') select(hit);
        const mv = hit && hit.kind === 'token' && opts.canDrag && opts.canDrag(hit.id) && opts.movement ? opts.movement.begin(hit.id) : null;
        if (mv) {
          const at = entityPos(hit);
          S.drag = { type: 'move', hit, p0: p, off: { x: cell.x - at.x, y: cell.y - at.y }, start: at, footprint: footprint(hit), moved: false, cursor: p, mv };
        } else S.drag = { type: 'pan', p0: p, view0: S.view, moved: false, keep: Boolean(hit) };
      } else {
        const hit = hitTest(cell);
        if (hit) {
          const at = entityPos(hit);
          S.drag = { type: 'move', hit, p0: p, off: { x: cell.x - at.x, y: cell.y - at.y }, start: at, footprint: footprint(hit), moved: false, cursor: p,
            mv: hit.kind === 'token' && opts.movement ? opts.movement.begin(hit.id) : null };
        } else {
          S.drag = { type: 'pan', p0: p, view0: S.view, moved: false };
        }
      }
      updateUi();
      requestDraw();
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      const cell = cellOf(p);
      if (painting() && (!S.drag || S.drag.type === 'paint')) {
        opts.painter.move(cell, e, Boolean(S.drag));
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (!S.drag) {
        const fp = insertFootprint();
        if (fp && inGrid(cell)) {
          const x = cell.x - Math.floor(fp.w / 2);
          const y = cell.y - Math.floor(fp.h / 2);
          S.hover = { footprint: fp, x, y, valid: canInsertAt(fp, x, y) };
          requestDraw();
        } else if (S.hover) {
          S.hover = null;
          requestDraw();
        }
        canvas.style.cursor = S.pick || S.tool !== 'seleziona' ? 'crosshair' : inGrid(cell) && hitTest(cell) ? 'grab' : 'default';
        return;
      }
      const far = S.drag.p0 && Math.hypot(p.sx - S.drag.p0.sx, p.sy - S.drag.p0.sy) >= DRAG_THRESHOLD;
      if (S.drag.type === 'pan' || S.drag.type === 'click-S.tool') {
        if (!S.drag.moved && !far) return;
        S.drag.moved = true;
        canvas.style.cursor = 'grabbing';
        S.view = { zoom: S.drag.view0.zoom, panX: S.drag.view0.panX + p.sx - S.drag.p0.sx, panY: S.drag.view0.panY + p.sy - S.drag.p0.sy };
      } else if (S.drag.type === 'S.measure') {
        S.measure.b = clampCell(cell);
        updateUi();
      } else if (S.drag.type === 'rect') {
        S.drag.b = clampCell(cell);
      } else if (S.drag.type === 'erase') {
        if (inGrid(cell) && eraseAt(cell)) { S.drag.erased = true; changed(); }
      } else if (S.drag.type === 'move') {
        if (!S.drag.moved && !far) return;
        S.drag.moved = true;
        canvas.style.cursor = 'grabbing';
        S.drag.target = { x: cell.x - S.drag.off.x, y: cell.y - S.drag.off.y };
        S.drag.cursor = p;
        if (S.drag.mv) {
          // Movimento limitato: percorso minimo fino al residuo (la pedina si ferma all'ultima cella raggiungibile).
          S.drag.route = S.drag.mv.route(S.drag.target);
          S.drag.valid = Boolean(S.drag.route.end);
        } else {
          S.drag.valid = isValidAt(S.drag.hit, S.drag.target.x, S.drag.target.y);
        }
      }
      requestDraw();
    });

    canvas.addEventListener('pointerup', (e) => {
      const d = S.drag;
      S.drag = null;
      canvas.style.cursor = 'default';
      if (!d) return;
      if (d.type === 'paint') {
        opts.painter.up(cellOf(local(e)), e);
        return;
      }
      if (d.type === 'move') {
        if (d.moved && d.mv) {
          const r = d.route;
          // Movimento rifiutato (anche in parte): avviso e suono, un solo punto per tutte le griglie.
          if (!r || !r.end || r.stopped) DnD.audio.suona('movimento-rifiutato');
          if (!r || !r.end) toast('Non c\'è un percorso libero fin lì.', 'error');
          else if (r.end.x !== d.start.x || r.end.y !== d.start.y) {
            if (ro) opts.movement.apply(null, d.hit.id, r);
            else commit((dd) => opts.movement.apply(dd, d.hit.id, r));
            if (r.stopped) toast('Movimento esaurito: la pedina si ferma all\'ultima cella raggiungibile.', 'error');
          } else if (r.stopped) toast('Movimento esaurito: non può spostarsi oltre.', 'error');
          select(d.hit);
        } else if (d.moved) {
          const t = d.target;
          if (d.valid && (t.x !== d.start.x || t.y !== d.start.y)) {
            commit(() => {
              const ent = entity(d.hit);
              if (d.hit.kind === 'token') ent.pos = { x: t.x, y: t.y };
              else Object.assign(ent, t);
            });
          } else if (!d.valid) {
            if (d.hit.kind === 'token') DnD.audio.suona('movimento-rifiutato');
            toast(d.hit.kind === 'token' ? 'Posizione bloccata da un\'altra pedina o da una struttura.' : 'Posizione non valida.', 'error');
          }
          select(d.hit);
        } else {
          const key = d.hit.kind + ':' + d.hit.id;
          const now = performance.now();
          select(d.hit);
          if (S.lastClick.key === key && now - S.lastClick.time < DOUBLE_CLICK_MS && (d.hit.kind === 'token' || (d.hit.kind === 'item' && opts.onObject))) {
            S.lastClick = { key: null, time: 0 };
            if (d.hit.kind === 'token') openMenu(e.clientX, e.clientY, tokenActions(d.hit.id));
            else opts.onObject(d.hit.id);
          } else {
            S.lastClick = { key, time: now };
          }
        }
      } else if (d.type === 'pan' && !d.moved && !d.keep) {
        select(null);
      } else if (d.type === 'click-S.tool' && !d.moved) {
        if (S.tool === 'etichetta') labelAt(d.cell);
        else insertAt(d.cell);
      } else if (d.type === 'rect') {
        finishRect(G.rectBetween(d.a, d.b, doc().grid));
      } else if (d.type === 'erase' && d.erased) {
        history.push(d.before);
        changed();
      }
      requestDraw();
    });

    canvas.addEventListener('pointercancel', (e) => {
      if (S.drag && S.drag.type === 'paint') opts.painter.up(cellOf(local(e)), e);
      S.drag = null;
      requestDraw();
    });
    canvas.addEventListener('pointerleave', () => {
      if (S.hover) { S.hover = null; requestDraw(); }
      if (opts.painter && !S.drag) opts.painter.move(null);
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (ro) return;
      const cell = cellOf(local(e));
      const hit = inGrid(cell) ? hitTest(cell) : null;
      if (!hit) return;
      select(hit);
      openMenu(e.clientX, e.clientY, actionsFor(hit));
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      S.view = G.zoomAt(S.view, p.sx, p.sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      requestDraw();
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      if (!canvas.isConnected || document.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (ro) { if (e.key === 'Escape' && S.selection) select(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.altKey && k === 'b') { e.preventDefault(); getPaletteToggle().toggle(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' && S.selection) { e.preventDefault(); removeEntity(S.selection); }
      else if (e.key === 'Escape') {
        if (S.pick) finishPick(null);
        else if (S.tool !== 'seleziona') setTool('seleziona');
        else if (S.selection) select(null);
      }
    });

    return {  };
  }

  DnD.uiGrigliaPuntatore = { puntatore };
})(globalThis.DnD = globalThis.DnD || {});
