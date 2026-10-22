// Sezione Razze: elenco e form di creazione/modifica.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast } = DnD.ui;
  let editing = null; // null = elenco, 'new' = nuova razza, altrimenti id della razza
  let root = null;

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function bonusSummary(race) {
    const parts = DnD.regole.ABILITIES
      .filter((ab) => race.bonuses[ab].apply && race.bonuses[ab].value)
      .map((ab) => ab + ' ' + DnD.regole.formatModifier(race.bonuses[ab].value));
    return parts.length ? parts.join(', ') : 'Nessun bonus applicato';
  }

  function renderList() {
    const races = DnD.store.state.races;
    root.append(
      el('div', { class: 'section-head' },
        el('h1', { text: 'Razze' }),
        el('button', { class: 'btn primary', text: '+ Nuova razza', onclick: () => { editing = 'new'; render(); } })),
      races.length
        ? el('div', { class: 'card-grid' }, races.map((r) => el('article', { class: 'card' },
          el('h3', { text: r.name }),
          el('p', { class: 'muted', text: r.size + ' · ' + String(r.speed).replace('.', ',') + ' m' + (r.darkvision ? ' · Scurovisione ' + String(r.darkvision).replace('.', ',') + ' m' : '') }),
          el('p', { text: bonusSummary(r) }),
          r.description ? el('p', { class: 'muted small', text: r.description }) : null,
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = r.id; render(); } }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(r) })))))
        : el('p', { class: 'empty', text: 'Nessuna razza. Creane una con "Nuova razza".' }));
  }

  function remove(race) {
    const s = DnD.store.state;
    const used = s.npcs.concat(s.players).filter((c) => c.raceId === race.id).length;
    const msg = 'Eliminare la razza "' + race.name + '"?' +
      (used ? '\n' + used + ' personaggi la usano e resteranno senza bonus razziali.' : '');
    if (!confirm(msg)) return;
    DnD.store.update((st) => { st.races = st.races.filter((r) => r.id !== race.id); });
    toast('Razza eliminata.');
    render();
  }

  function renderForm() {
    const existing = DnD.store.state.races.find((r) => r.id === editing);
    const r = existing || DnD.dati.normalizeRace({ name: '', bonuses: DnD.dati.makeBonuses({}) });
    if (!existing) r.name = '';

    const inp = {
      name: textInput(r.name, { maxlength: 60, required: true }),
      size: el('select', {}, DnD.validazione.SIZES.map((s) => el('option', { value: s, text: s, selected: s === r.size }))),
      speed: numberInput(r.speed, { step: '0.5', min: 0, inputmode: 'decimal' }),
      darkvision: numberInput(r.darkvision, { step: '0.5', min: 0, inputmode: 'decimal', placeholder: 'Nessuna' }),
      description: el('textarea', { rows: 3, value: r.description }),
      traits: el('textarea', { rows: 4, value: r.traits }),
      resistances: textInput(r.resistances),
      languages: textInput(r.languages),
      proficiencies: textInput(r.proficiencies),
    };
    const bonusInputs = {};

    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' },
        field('Nome', inp.name, 'name'),
        field('Taglia', inp.size, 'size'),
        field('Velocità (m)', inp.speed, 'speed')),
      el('fieldset', { class: 'abilities' },
        el('legend', { text: 'Bonus alle caratteristiche' }),
        el('div', { class: 'ability-row' }, DnD.regole.ABILITIES.map((ab) => {
          const b = r.bonuses[ab];
          const value = numberInput(b.value, { 'aria-label': 'Bonus ' + DnD.regole.ABILITY_NAMES[ab], 'data-key': 'bonuses.' + ab });
          const apply = el('input', { type: 'checkbox', checked: b.apply });
          bonusInputs[ab] = { value, apply };
          return el('div', { class: 'ability-cell' },
            el('div', { class: 'ability-label', title: DnD.regole.ABILITY_NAMES[ab], text: ab }),
            value,
            el('label', { class: 'check' }, apply, ' applica'),
            el('div', { class: 'error', 'data-error': 'bonuses.' + ab }));
        }))),
      field('Descrizione', inp.description),
      field('Tratti', inp.traits),
      el('details', { class: 'extra', open: Boolean(r.darkvision || r.resistances || r.languages || r.proficiencies) },
        el('summary', { text: 'Campi opzionali' }),
        el('div', { class: 'grid-2' },
          field('Scurovisione (m)', inp.darkvision, 'darkvision', 'Lascia vuoto se assente'),
          field('Resistenze', inp.resistances),
          field('Linguaggi', inp.languages),
          field('Competenze', inp.proficiencies))),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva razza' })));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const bonuses = {};
      for (const ab of DnD.regole.ABILITIES) {
        bonuses[ab] = { value: readNumber(bonusInputs[ab].value), apply: bonusInputs[ab].apply.checked };
      }
      const data = {
        id: r.id,
        name: inp.name.value.trim(),
        size: inp.size.value,
        speed: readNumber(inp.speed),
        darkvision: inp.darkvision.value.trim() === '' ? null : readNumber(inp.darkvision),
        description: inp.description.value.trim(),
        traits: inp.traits.value.trim(),
        bonuses,
        resistances: inp.resistances.value.trim(),
        languages: inp.languages.value.trim(),
        proficiencies: inp.proficiencies.value.trim(),
      };
      if (!showErrors(form, DnD.validazione.validateRace(data))) return;
      DnD.store.update((st) => {
        const i = st.races.findIndex((x) => x.id === data.id);
        if (i >= 0) st.races[i] = data;
        else st.races.push(data);
      });
      toast('Razza salvata.', 'success');
      editing = null;
      render();
    });

    root.append(el('div', { class: 'section-head' }, el('h1', { text: existing ? 'Modifica razza' : 'Nuova razza' })), form);
    inp.name.focus();
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.razze = { title: 'Razze', render, reset: () => { editing = null; } };
})(globalThis.DnD = globalThis.DnD || {});
