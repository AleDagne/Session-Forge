// Selettore dell'icona con anteprima e tre schede: Forma (geometrica), Libreria (icone predefinite, con
// ricerca per nome e filtro per categoria) e Immagine (dal computer). Usato da nemici, giocatori,
// creature, attrezzatura e oggetti di mappa.
(function (DnD) {
  'use strict';

  const { el, clear } = DnD.ui;
  const I = DnD.icone;
  const LIB = DnD.libreriaIcone;
  const TABS = [['shape', 'Forma'], ['library', 'Libreria'], ['image', 'Immagine']];
  let seq = 0;

  // freeColor: true = colore libero e libreria degli oggetti; false = palette di 14 colori e libreria delle creature.
  // onLibraryPick(entry): facoltativo, chiamato quando si sceglie un'icona della libreria (es. dimensione suggerita).
  function iconPicker(initial, freeColor, legend, onLibraryPick) {
    const state = Object.assign({ image: null, icon: null, shape: 'cerchio' }, I.normalizeIcon(initial, freeColor));
    const uid = 'icon-' + (++seq);
    const library = freeColor ? LIB.ITEM_LIBRARY : LIB.LIBRARY;
    const categories = freeColor ? LIB.ITEM_CATEGORIES : LIB.CREATURE_CATEGORIES;
    let query = '';
    let category = '';
    const preview = el('div', { class: 'icon-preview' });
    const error = el('div', { class: 'error', 'data-error': 'icon', 'aria-live': 'polite' });
    const colorRow = el('div', { class: 'color-row' });
    const colorLabel = el('span', { class: 'muted small' });
    const shapeRow = el('div', { class: 'shape-row', role: 'tabpanel' });
    const libGrid = el('div', { class: 'icon-library-grid', role: 'listbox', 'aria-label': 'Icone della libreria' });
    const search = el('input', { type: 'search', placeholder: 'Cerca un\'icona…', 'aria-label': 'Cerca un\'icona', oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderLibrary(); } });
    const catSel = el('select', { 'aria-label': 'Categoria', onchange: (e) => { category = e.target.value; renderLibrary(); } },
      el('option', { value: '', text: 'Tutte le categorie' }), Object.entries(categories).map(([k, v]) => el('option', { value: k, text: v })));
    const libBox = el('div', { class: 'icon-library', role: 'tabpanel' }, el('div', { class: 'input-row' }, search, Object.keys(categories).length > 1 ? catSel : null), libGrid);
    const file = el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Carica immagine' });
    const imageBox = el('div', { class: 'image-row', role: 'tabpanel' }, file, el('small', { class: 'hint', text: 'Ritagliata al centro e ridotta a 128×128.' }));
    const tabButtons = {};
    const tabBar = el('div', { class: 'tabs small-tabs', role: 'tablist', 'aria-label': 'Tipo di icona' }, TABS.map(([k, label]) => {
      tabButtons[k] = el('button', { type: 'button', role: 'tab', class: 'tab', id: uid + '-' + k, text: label, onclick: () => { state.kind = k; refresh(); } });
      return tabButtons[k];
    }));

    function current() {
      if (state.kind === 'image' && state.image) return { kind: 'image', image: state.image, color: state.color };
      if (state.kind === 'library' && state.icon) return { kind: 'library', icon: state.icon, color: state.color };
      return { kind: 'shape', shape: state.shape || 'cerchio', color: state.color };
    }

    function renderLibrary() {
      const list = library.filter((x) => (!category || x.category === category) && (!query || x.name.toLowerCase().includes(query) || x.id.includes(query)));
      clear(libGrid).append(...(list.length ? list.map((x) => el('button', {
        type: 'button', class: 'icon-choice', role: 'option', title: x.name, 'aria-label': x.name, 'aria-selected': String(state.icon === x.id),
        onclick: () => { state.icon = x.id; state.kind = 'library'; refresh(); if (onLibraryPick) onLibraryPick(x); },
      }, I.iconCanvas({ kind: 'library', icon: x.id, color: state.color }, 34), el('span', { class: 'icon-choice-name', text: x.name })))
        : [el('p', { class: 'muted small', text: 'Nessuna icona trovata.' })]));
    }

    function refresh() {
      clear(preview).append(I.iconCanvas(current(), 72));
      for (const [k, b] of Object.entries(tabButtons)) {
        const on = state.kind === k;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      }
      shapeRow.hidden = state.kind !== 'shape';
      libBox.hidden = state.kind !== 'library';
      imageBox.hidden = state.kind !== 'image';
      colorLabel.textContent = state.kind === 'image' ? 'Colore del bordo' : 'Colore';
      clear(shapeRow).append(...I.SHAPES.map((s) => el('button', {
        type: 'button', class: 'shape-btn', title: I.SHAPE_NAMES[s], 'aria-label': I.SHAPE_NAMES[s],
        'aria-pressed': String(state.shape === s),
        onclick: () => { state.shape = s; state.kind = 'shape'; refresh(); },
      }, I.iconCanvas({ kind: 'shape', shape: s, color: state.color }, 26))));
      if (state.kind === 'library') renderLibrary();
      for (const b of colorRow.querySelectorAll('.swatch')) b.setAttribute('aria-pressed', String(b.dataset.color === state.color));
    }

    if (freeColor) {
      colorRow.append(el('input', { type: 'color', value: state.color, 'aria-label': 'Colore', oninput: (e) => { state.color = e.target.value.toLowerCase(); refresh(); } }));
    } else {
      colorRow.classList.add('swatch-grid');
      colorRow.append(...DnD.colori.PALETTE.map((c) => el('button', {
        type: 'button', class: 'swatch', 'data-color': c.hex, style: 'background:' + c.hex,
        title: c.name, 'aria-label': c.name, onclick: () => { state.color = c.hex; refresh(); },
      })));
    }

    file.addEventListener('change', async () => {
      error.textContent = '';
      const f = file.files[0];
      if (!f) return;
      try {
        state.image = await I.fileToIconDataUrl(f);
        state.kind = 'image';
        refresh();
      } catch (e) {
        error.textContent = e.message;
      }
      file.value = '';
    });

    const node = el('fieldset', { class: 'icon-picker' },
      el('legend', { text: legend || 'Icona (pedina)' }),
      el('div', { class: 'icon-picker-body' },
        preview,
        el('div', { class: 'icon-options' },
          tabBar, shapeRow, libBox, imageBox,
          el('div', { class: 'color-line' }, colorLabel, colorRow),
          error)));
    refresh();

    return {
      node,
      // Restituisce l'icona, oppure un errore se la scheda scelta è incompleta.
      read: () => {
        if (state.kind === 'image' && !state.image) return { error: 'Carica un\'immagine o scegli un\'altra scheda.' };
        if (state.kind === 'library' && !state.icon) return { error: 'Scegli un\'icona della libreria o un\'altra scheda.' };
        return { icon: current() };
      },
    };
  }

  DnD.uiIcone = { iconPicker };
})(globalThis.DnD = globalThis.DnD || {});
