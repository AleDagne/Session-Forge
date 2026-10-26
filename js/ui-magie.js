// Sezione Magie: libreria degli incantesimi con filtri, ricerca e form.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast } = DnD.ui;
  const M = DnD.magie;
  const C = DnD.classi;
  let editing = null;
  let root = null;
  const filters = { level: '', school: '', cls: '', text: '' };

  // Riassunto dell'effetto meccanico (usato anche nei form e nel combattimento).
  function effectSummary(sp) {
    const e = sp.effect;
    const dice = e.dice ? e.dice + (e.type === 'cura' && e.addMod ? ' + mod' : '') + (e.damageType ? ' ' + e.damageType : '') : '';
    const up = e.upcastDice && sp.level > 0 ? ' (+' + e.upcastDice + ' per slot superiore)' : '';
    if (e.type === 'attacco') return 'Attacco con incantesimo' + (dice ? ' · ' + dice + up : '');
    if (e.type === 'salvezza') return 'TS ' + e.saveAbility + (dice ? ' · ' + dice + up : '') + (e.halfOnSave ? ' · metà se riesce' : ' · nulla se riesce');
    if (e.type === 'cura') return 'Cura' + (dice ? ' · ' + dice + up : '');
    return dice ? 'Effetto automatico · ' + dice + up : 'Nessun tiro automatico';
  }

  function componentsText(c) {
    return [c.V ? 'V' : '', c.S ? 'S' : '', c.M ? 'M (' + c.material + ')' : ''].filter(Boolean).join(', ') || '—';
  }

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function filtered() {
    const t = filters.text.trim().toLowerCase();
    return DnD.store.state.spells
      .filter((s) => filters.level === '' || s.level === Number(filters.level))
      .filter((s) => !filters.school || s.school === filters.school)
      .filter((s) => !filters.cls || s.classes.includes(filters.cls))
      .filter((s) => !t || s.name.toLowerCase().includes(t) || s.description.toLowerCase().includes(t))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'it'));
  }

  function duplicate(s) {
    const copy = Object.assign(JSON.parse(JSON.stringify(s)), { id: DnD.dadi.uid(), name: (s.name + ' (copia)').slice(0, 60) });
    DnD.store.update((st) => { st.spells.splice(st.spells.indexOf(s) + 1, 0, copy); });
    toast('Incantesimo duplicato.');
    render();
  }

  function remove(s) {
    const st = DnD.store.state;
    const users = st.players.concat(st.npcs).filter((c) => c.spellcasting.known.includes(s.id)).length;
    if (!confirm('Eliminare l\'incantesimo "' + s.name + '"?' + (users ? '\nÈ tra gli incantesimi di ' + users + ' personaggi: verrà tolto anche a loro.' : ''))) return;
    DnD.store.update((state) => {
      state.spells = state.spells.filter((x) => x.id !== s.id);
      for (const c of state.players.concat(state.npcs)) c.spellcasting.known = c.spellcasting.known.filter((id) => id !== s.id);
    });
    toast('Incantesimo eliminato.');
    render();
  }

  // Esporta gli incantesimi mostrati (con i filtri) come file JSON.
  function exportList() {
    const list = filtered();
    if (!list.length) { toast('Nessun incantesimo da esportare.', 'error'); return; }
    const IM = DnD.uiImpostazioni;
    IM.download(JSON.stringify(M.exportFile(list, DnD.config.APP_NAME), null, 2), IM.slug(DnD.config.APP_NAME) + '-incantesimi.json');
    toast(list.length + (list.length === 1 ? ' incantesimo esportato.' : ' incantesimi esportati.'), 'success');
  }
  // Importa incantesimi da file: si aggiungono alla libreria, saltando quelli con un nome già presente.
  async function importList(file) {
    try {
      const r = M.importFile(JSON.parse(await file.text()), DnD.store.state.spells, DnD.dati.normalizeSpell);
      if (r.added.length) DnD.store.update((st) => { st.spells.push(...r.added); });
      toast(r.added.length + (r.added.length === 1 ? ' incantesimo importato' : ' incantesimi importati') +
        (r.skipped.length ? '; già presenti, saltati: ' + r.skipped.join(', ') : '') + '.', r.added.length ? 'success' : 'error');
      render();
    } catch (e) {
      toast('Importazione non riuscita: ' + (e instanceof SyntaxError ? 'il file non è un JSON valido.' : e.message), 'error');
    }
  }

  function renderList() {
    const results = el('div');
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
      const f = importInput.files[0];
      importInput.value = '';
      if (f) importList(f);
    } });
    const draw = () => {
      const list = filtered();
      clear(results).append(list.length
        ? el('div', { class: 'card-grid' }, list.map((s) => el('article', { class: 'card' },
          el('div', { class: 'card-title' }, el('h3', { text: s.name }), el('span', { class: 'tag accent', text: M.levelName(s.level) })),
          el('p', { class: 'muted small', text: M.SCHOOL_NAMES[s.school] + ' · ' + [s.castingTime, s.range, s.duration].filter(Boolean).join(' · ') }),
          el('div', { class: 'tags' },
            s.concentration ? el('span', { class: 'tag', text: 'Concentrazione' }) : null,
            s.area ? el('span', { class: 'tag', text: 'Ad area' }) : null,
            el('span', { class: 'tag', text: 'Componenti: ' + componentsText(s.components) })),
          el('p', { class: 'small', text: effectSummary(s) }),
          s.description ? el('p', { class: 'muted small', text: s.description }) : null,
          el('p', { class: 'muted small', text: 'Classi: ' + (s.classes.map((id) => C.CLASSES[id].name).join(', ') || '—') }),
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = s.id; render(); } }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(s) }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(s) })))))
        : el('p', { class: 'empty', text: DnD.store.state.spells.length ? 'Nessun incantesimo corrisponde ai filtri.' : 'La libreria è vuota. Crea un incantesimo con «Nuovo incantesimo».' }));
    };
    const select = (key, label, options) => el('select', {
      'aria-label': label, onchange: (e) => { filters[key] = e.target.value; draw(); },
    }, options.map(([v, t]) => el('option', { value: v, text: t, selected: filters[key] === v })));
    root.append(
      el('div', { class: 'section-head' },
        el('h1', { text: 'Magie' }),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn', text: '⬆ Importa JSON', title: 'Aggiungi incantesimi da un file (quelli con lo stesso nome vengono saltati)', onclick: () => importInput.click() }), importInput,
          el('button', { class: 'btn', text: '⬇ Esporta JSON', title: 'Esporta gli incantesimi mostrati', onclick: exportList }),
          el('button', { class: 'btn primary', text: '+ Nuovo incantesimo', onclick: () => { editing = 'new'; render(); } }))),
      el('div', { class: 'filters' },
        el('input', { type: 'search', placeholder: 'Cerca per nome o descrizione…', 'aria-label': 'Cerca incantesimi', value: filters.text, oninput: (e) => { filters.text = e.target.value; draw(); } }),
        select('level', 'Livello', [['', 'Tutti i livelli']].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => [String(l), M.levelName(l)]))),
        select('school', 'Scuola', [['', 'Tutte le scuole']].concat(M.SCHOOLS.map((s) => [s, M.SCHOOL_NAMES[s]]))),
        select('cls', 'Classe', [['', 'Tutte le classi']].concat(C.IDS.filter((id) => C.CLASSES[id].caster).map((id) => [id, C.CLASSES[id].name])))),
      results);
    draw();
  }

  function renderForm() {
    const existing = DnD.store.state.spells.find((s) => s.id === editing);
    const s = existing || DnD.dati.normalizeSpell({ name: '', level: 1, school: 'invocazione', castingTime: '1 azione', duration: 'Istantanea' });
    if (!existing) s.name = '';
    const inp = {
      name: textInput(s.name, { maxlength: 60 }),
      level: el('select', {}, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => el('option', { value: String(l), text: M.levelName(l), selected: l === s.level }))),
      school: el('select', {}, M.SCHOOLS.map((x) => el('option', { value: x, text: M.SCHOOL_NAMES[x], selected: x === s.school }))),
      castingTime: textInput(s.castingTime, { maxlength: 60, placeholder: '1 azione' }),
      range: textInput(s.range, { maxlength: 60, placeholder: '18 m' }),
      duration: textInput(s.duration, { maxlength: 60, placeholder: 'Istantanea' }),
      V: el('input', { type: 'checkbox', checked: s.components.V }),
      S: el('input', { type: 'checkbox', checked: s.components.S }),
      M: el('input', { type: 'checkbox', checked: s.components.M }),
      material: textInput(s.components.material, { maxlength: 200, placeholder: 'materiale', 'aria-label': 'Componente materiale' }),
      concentration: el('input', { type: 'checkbox', checked: s.concentration }),
      area: el('input', { type: 'checkbox', checked: s.area }),
      description: el('textarea', { rows: 4, value: s.description }),
      type: el('select', {}, M.EFFECTS.map((t) => el('option', { value: t, text: M.EFFECT_NAMES[t], selected: t === s.effect.type }))),
      dice: textInput(s.effect.dice, { placeholder: 'es. 8d6' }),
      damageType: textInput(s.effect.damageType, { maxlength: 40, placeholder: 'es. fuoco' }),
      upcastDice: textInput(s.effect.upcastDice, { placeholder: 'es. 1d6' }),
      saveAbility: el('select', {}, DnD.regole.ABILITIES.map((ab) => el('option', { value: ab, text: DnD.regole.ABILITY_NAMES[ab], selected: ab === s.effect.saveAbility }))),
      halfOnSave: el('input', { type: 'checkbox', checked: s.effect.halfOnSave }),
      addMod: el('input', { type: 'checkbox', checked: s.effect.addMod }),
    };
    const classChecks = {};
    // Condizione inflitta: a chi fallisce la salvezza, a chi è colpito, o (senza tiro) a tutti i bersagli salvo la salvezza indicata.
    const inflict = DnD.condizioni.normalizeInflict(s.inflict);
    const inflictBox = DnD.uiCondizioni.inflictEditor(inflict, { save: true, note: 'Tiro salvezza dell\'incantesimo: la subisce chi fallisce. Attacco: chi è colpito. Senza tiro: tutti i bersagli, salvo la salvezza qui indicata. Con la concentrazione, finisce quando la concentrazione termina.' });
    const materialField = field('Materiale', inp.material, 'components.material');
    const saveFields = el('div', { class: 'grid-3' }, field('Tiro salvezza su', inp.saveAbility),
      el('label', { class: 'check' }, inp.halfOnSave, ' Il tiro salvezza riuscito dimezza i danni'));
    const damageTypeField = field('Tipo di danno', inp.damageType);
    const addModLabel = el('label', { class: 'check' }, inp.addMod, ' Aggiungi il modificatore da incantatore');
    const effectFields = el('div', { class: 'effect-box' },
      el('div', { class: 'grid-3' },
        field('Dado di danno o cura', inp.dice, 'effect.dice'),
        damageTypeField,
        field('Dado extra per ogni livello di slot superiore', inp.upcastDice, 'effect.upcastDice', 'Es. +1d6 a ogni slot sopra il livello dell\'incantesimo')),
      saveFields, addModLabel);
    const syncEffect = () => {
      const t = inp.type.value;
      saveFields.hidden = t !== 'salvezza';
      addModLabel.hidden = t !== 'cura';
      damageTypeField.hidden = t === 'cura';
      materialField.hidden = !inp.M.checked;
    };
    inp.type.addEventListener('change', syncEffect);
    inp.M.addEventListener('change', syncEffect);

    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' },
        field('Nome', inp.name, 'name'),
        field('Livello', inp.level, 'level'),
        field('Scuola', inp.school, 'school'),
        field('Tempo di lancio', inp.castingTime),
        field('Gittata', inp.range),
        field('Durata', inp.duration)),
      el('fieldset', {},
        el('legend', { text: 'Componenti e proprietà' }),
        el('div', { class: 'check-row' },
          el('label', { class: 'check' }, inp.V, ' Verbale (V)'),
          el('label', { class: 'check' }, inp.S, ' Somatica (S)'),
          el('label', { class: 'check' }, inp.M, ' Materiale (M)'),
          el('label', { class: 'check' }, inp.concentration, ' Concentrazione'),
          el('label', { class: 'check' }, inp.area, ' Ad area (più bersagli)')),
        materialField),
      el('fieldset', {},
        el('legend', { text: 'Classi che possono usarlo' }),
        el('div', { class: 'class-checks' }, C.IDS.filter((id) => C.CLASSES[id].caster).map((id) => {
          classChecks[id] = el('input', { type: 'checkbox', checked: s.classes.includes(id) });
          return el('label', { class: 'check' }, classChecks[id], ' ' + C.CLASSES[id].name);
        }))),
      field('Descrizione', inp.description),
      el('fieldset', {},
        el('legend', { text: 'Effetto meccanico (facoltativo)' }),
        field('Tipo', inp.type),
        effectFields,
        inflictBox),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva incantesimo' })));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const data = {
        id: s.id,
        name: inp.name.value.trim(),
        level: Number(inp.level.value),
        school: inp.school.value,
        castingTime: inp.castingTime.value.trim(),
        range: inp.range.value.trim(),
        components: { V: inp.V.checked, S: inp.S.checked, M: inp.M.checked, material: inp.M.checked ? inp.material.value.trim() : '' },
        duration: inp.duration.value.trim(),
        concentration: inp.concentration.checked,
        area: inp.area.checked,
        classes: C.IDS.filter((id) => classChecks[id] && classChecks[id].checked),
        description: inp.description.value.trim(),
        effect: {
          type: inp.type.value,
          dice: inp.dice.value.trim().toLowerCase(),
          damageType: inp.damageType.value.trim(),
          upcastDice: inp.upcastDice.value.trim().replace(/^\+/, '').toLowerCase(),
          saveAbility: inp.saveAbility.value,
          halfOnSave: inp.halfOnSave.checked,
          addMod: inp.addMod.checked,
        },
        inflict,
      };
      if (!showErrors(form, DnD.validazione.validateSpell(data))) return;
      const normalized = DnD.dati.normalizeSpell(data);
      DnD.store.update((st) => {
        const i = st.spells.findIndex((x) => x.id === normalized.id);
        if (i >= 0) st.spells[i] = normalized;
        else st.spells.push(normalized);
      });
      toast('Incantesimo salvato.', 'success');
      editing = null;
      render();
    });

    root.append(el('div', { class: 'section-head' }, el('h1', { text: existing ? 'Modifica incantesimo' : 'Nuovo incantesimo' })), form);
    syncEffect();
    inp.name.focus();
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.magie = { title: 'Magie', render, reset: () => { editing = null; } };
  DnD.uiMagie = { effectSummary, componentsText };
})(globalThis.DnD = globalThis.DnD || {});
