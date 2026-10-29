// Pannello laterale della griglia (editor e combattimento): elenco dei combattenti, delle strutture, degli oggetti
// di mappa, degli NPC e dell'Attrezzatura; scelta del modello per gli strumenti di inserimento e trascinamento sulla
// griglia. Livello interfaccia. Espone DnD.uiGrigliaPannello { pannello(api) }; usa DnD.ui, griglia, tileset, icone.
(function (DnD) {
  'use strict';

  const { el, clear, toast } = DnD.ui;
  const G = DnD.griglia;
  const R = DnD.regole;
  const { DRAG_THRESHOLD } = DnD.uiGrigliaDisegno;

  // api (dalla griglia, uiGriglia.create): stato condiviso S e funzioni della griglia:
  //   S, opts, board, canvas, commit, doc, footprint, palette, placeGround, placeItem, placeNpc, placeStructure, requestDraw, ro, select, setTool
  function pannello(api) {
    const { S, opts, board, canvas, commit, doc, footprint, palette, placeGround, placeItem, placeNpc, placeStructure, requestDraw, ro, select, setTool } = api;

    // ---------- Pannello laterale: trascinamento e scelta dei modelli ----------
    function startPaletteDrag(e, spec) {
      if (e.button !== 0 || S.pick) return;
      if (e.pointerType === 'mouse') e.preventDefault();
      const item = e.currentTarget;
      item.setPointerCapture(e.pointerId);
      const ghostEl = el('div', { class: 'drag-ghost', text: spec.name });
      S.drag = { type: 'palette', spec, footprint: spec.footprint, target: null, valid: false };
      let shown = false;
      const start = { x: e.clientX, y: e.clientY };
      const move = (ev) => {
        if (!shown && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        if (!shown) { document.body.appendChild(ghostEl); shown = true; }
        ghostEl.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 12) + 'px)';
        const r = canvas.getBoundingClientRect();
        const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        if (inside) {
          const cell = G.screenToCell(S.view, ev.clientX - r.left, ev.clientY - r.top);
          S.drag.target = { x: cell.x - Math.floor(spec.footprint.w / 2), y: cell.y - Math.floor(spec.footprint.h / 2) };
          S.drag.valid = spec.isValid(S.drag.target.x, S.drag.target.y);
        } else {
          S.drag.target = null;
        }
        requestDraw();
      };
      const end = (ev) => {
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', end);
        item.removeEventListener('pointercancel', end);
        ghostEl.remove();
        const d = S.drag;
        S.drag = null;
        if (ev.type === 'pointerup' && d && d.target) {
          if (d.valid) spec.place(d.target);
          else toast('Posizione non valida: lo spazio è occupato o fuori dalla griglia.', 'error');
        } else if (ev.type === 'pointerup' && !shown && spec.onClick) {
          spec.onClick();
        }
        requestDraw();
      };
      item.addEventListener('pointermove', move);
      item.addEventListener('pointerup', end);
      item.addEventListener('pointercancel', end);
    }

    function paletteEntry(preview, name, spec, extraClass) {
      spec.name = name;
      return el('li', {
        class: 'palette-item' + (extraClass ? ' ' + extraClass : ''), title: 'Trascina sulla griglia' + (spec.chooseHint ? ' o clicca per sceglierlo' : ''),
        onpointerdown: (e) => startPaletteDrag(e, spec),
      }, el('span', { class: 'palette-icon' }, preview), el('span', { class: 'palette-name', text: name }));
    }

    const canInsert = (kind) => opts.tools.includes(kind === 'structure' ? 'struttura' : 'oggetto');
    function chooseTemplate(kind, id) {
      S.template = { kind, id };
      if (kind === 'structure' && S.tool !== 'riempi') setTool('struttura');
      else if (kind !== 'structure') setTool('oggetto');
      else refreshPalette();
    }

    function refreshPalette() {
      const d = doc();
      if (!d || ro) return;
      const st = DnD.store.state;
      const group = (title, entries, empty, open) => el('details', { class: 'palette-group', open: open !== false },
        el('summary', { text: title }),
        entries.length ? el('ul', {}, entries) : el('p', { class: 'muted small', text: empty }));
      const chosen = (kind, id) => (S.template && S.template.kind === kind && S.template.id === id ? 'chosen' : '');
      clear(palette).append(...[
        opts.showCombatants ? group('Combattenti', R.sortByInitiative(d.combatants).map((t) => paletteEntry(
          DnD.icone.iconCanvas(t.icon, 22), t.name,
          {
            footprint: G.tokenShape(t),
            isValid: (x, y) => G.canPlaceToken(board(), t.id, x, y),
            place: (p) => { commit((dd) => { dd.combatants.find((x) => x.id === t.id).pos = p; }); select({ kind: 'token', id: t.id }); },
            onClick: t.pos ? () => select({ kind: 'token', id: t.id }) : null,
          }, t.pos ? 'placed' : 'unplaced')), 'Nessun combattente.') : null,
        group('Strutture', st.structures.map((tpl) => paletteEntry(
          DnD.uiTileset.templatePreview(tpl, 'structure', 22), tpl.name,
          {
            footprint: G.templateShape(tpl),
            isValid: (x, y) => G.canPlaceStructure(board(), G.templateShape(tpl), x, y),
            place: (p) => select({ kind: 'structure', id: placeStructure(tpl, p).id }),
            onClick: canInsert('structure') ? () => chooseTemplate('structure', tpl.id) : null,
            chooseHint: canInsert('structure'),
          }, chosen('structure', tpl.id))), 'Crea strutture in Asset › Strutture.'),
        group('Oggetti di mappa', st.mapObjects.map((tpl) => paletteEntry(
          DnD.uiTileset.templatePreview(tpl, 'item', 22), tpl.name,
          {
            footprint: G.templateShape(tpl, 'item'),
            isValid: (x, y) => G.canPlaceItem(board(), G.templateShape(tpl, 'item'), G.objectBlocks(tpl), x, y),
            place: (p) => select({ kind: 'item', id: placeItem(tpl, p).id }),
            onClick: canInsert('item') ? () => chooseTemplate('item', tpl.id) : null,
            chooseHint: canInsert('item'),
          }, chosen('item', tpl.id))), 'Crea oggetti di mappa in Asset › Oggetti.'),
        st.worldNpcs ? group('NPC del Mondo', DnD.sessioni.visible(st, 'worldNpcs').map((n) => {
          const dm = DnD.griglia.gridSizeFor(n.stats.gridSize, n.stats.size || null);
          const shape = { w: dm.w, h: dm.h, cells: '1'.repeat(dm.w * dm.h) };
          return paletteEntry(DnD.icone.iconCanvas(n.stats.icon, 22), n.name, {
            footprint: shape,
            isValid: (x, y) => G.canPlaceItem(board(), shape, false, x, y),
            place: (p) => select({ kind: 'item', id: placeNpc(n, p).id }),
          });
        }), 'Crea NPC in Mondo › NPC.', false) : null,
        group('Attrezzatura (a terra)', st.equipment.map((eq) => paletteEntry(
          DnD.icone.iconCanvas(eq.icon, 22), eq.name,
          {
            footprint: G.squareShape(1),
            isValid: (x, y) => G.canPlaceItem(board(), G.squareShape(1), false, x, y),
            place: (p) => select({ kind: 'item', id: placeGround(eq, p).id }),
            onClick: canInsert('item') ? () => chooseTemplate('equipment', eq.id) : null,
            chooseHint: canInsert('item'),
          }, chosen('equipment', eq.id))), 'Il catalogo è in Asset › Oggetti › Attrezzatura.', false),
      ].filter(Boolean));
    }

    return { refreshPalette };
  }

  DnD.uiGrigliaPannello = { pannello };
})(globalThis.DnD = globalThis.DnD || {});
