// Finestra del generatore di nemici: opzioni (razza, livello, classe + opzioni avanzate),
// anteprima con Rigenera e salvataggio. Usata dalla sezione Nemici e dal setup del combattimento.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast, openDialog } = DnD.ui;
  const R = DnD.regole;
  const C = DnD.classi;
  const GEN = DnD.generatore;

  // Classi personalizzate già usate da nemici o giocatori: una voce per ciascuna definizione diversa.
  function customClasses() {
    const st = DnD.store.state;
    const seen = new Map();
    for (const c of st.players.concat(st.npcs)) {
      if (c.classId !== C.CUSTOM) continue;
      const key = JSON.stringify(c.customClass);
      if (!seen.has(key)) seen.set(key, { label: 'Personalizzata (come «' + c.name + '»)', customClass: c.customClass });
    }
    return [...seen.values()];
  }

  // Scheda di sola lettura con tutti i valori del nemico generato.
  function creatureSheet(c) {
    const st = DnD.store.state;
    const race = st.races.find((r) => r.id === c.raceId) || null;
    const stats = DnD.statistiche.derivedStats(c, race);
    const spellNames = st.spells.filter((s) => c.spellcasting.known.includes(s.id));
    const rows = R.ABILITIES.map((ab) => {
      const bonus = R.racialBonus(race, ab);
      const pts = stats.abilities[ab] - c.abilities[ab] - bonus;
      return el('tr', {},
        el('th', { text: ab }),
        el('td', { text: String(c.abilities[ab]) }),
        el('td', { text: bonus ? R.formatModifier(bonus) : '—' }),
        el('td', { text: pts ? '+' + pts : '—' }),
        el('td', { class: 'total', text: String(stats.abilities[ab]) }),
        el('td', { text: R.formatModifier(R.modifier(stats.abilities[ab])) }),
        el('td', { class: stats.saves.includes(ab) ? 'total' : '', text: R.formatModifier(stats.saveTotals[ab]) }));
    });
    return el('div', { class: 'gen-sheet' },
      el('p', { class: 'muted', text: [race ? race.name : 'Nessuna razza', C.className(c.classId), 'livello ' + c.level, 'competenza ' + R.formatModifier(stats.profBonus)].join(' · ') }),
      el('table', { class: 'saves-table gen-abilities' },
        el('thead', {}, el('tr', {}, ['', 'Base', 'Razza', 'Punti', 'Finale', 'Mod.', 'TS'].map((t) => el('th', { text: t })))),
        el('tbody', {}, rows)),
      el('div', { class: 'gen-stats' },
        el('div', {}, el('b', { text: 'PF ' + c.maxHp }), el('div', { class: 'calc-detail', text: c.hpDetail })),
        el('div', {}, el('b', { text: 'CA ' + stats.ac.total }), el('div', { class: 'calc-detail', text: stats.ac.detail }))),
      el('div', {}, el('b', { text: 'Armi' }),
        el('ul', { class: 'weapon-list small' }, c.weapons.map((w) => el('li', { text: DnD.uiCreature.weaponLabel(w) })))),
      stats.spell ? el('div', {}, el('b', { text: 'Incantesimi' }),
        el('p', { class: 'small', text: 'CD ' + stats.spell.dc + ' · attacco ' + R.formatModifier(stats.spell.attack) + ' · ' + stats.spell.ability +
          ' · slot ' + (stats.spell.slotsTotal.map((n, i) => (n ? (i + 1) + '°×' + n : '')).filter(Boolean).join(', ') || '—') }),
        el('p', { class: 'small', text: spellNames.length ? spellNames.map((s) => s.name + (s.level ? ' (' + s.level + '°)' : '')).join(', ') : 'Nessun incantesimo.' })) : null,
      c.notes ? el('p', { class: 'muted small gen-notes', text: c.notes }) : null);
  }

  function summary(c) {
    const race = DnD.store.state.races.find((r) => r.id === c.raceId) || null;
    const stats = DnD.statistiche.derivedStats(c, race);
    const best = c.weapons[0];
    return c.name + ' — PF ' + c.maxHp + ' · CA ' + stats.ac.total + (best ? ' · ' + best.name + ' ' + R.formatModifier(best.toHit) : '') +
      (stats.spell ? ' · CD ' + stats.spell.dc : '');
  }

  // cfg: { saveLabel, allowEdit, onSaved(creatures, edit), baseInput: { party, creatures } (setup del combattimento) }
  function open(cfg) {
    const st = DnD.store.state;
    const customs = customClasses();
    const body = el('div', { class: 'generator' });
    // Difficoltà: i nemici generati (CS dal livello) insieme a quelli già scelti nel setup, contro il party.
    const difficulty = DnD.uiDifficolta.indicator({ title: 'Difficoltà con questi nemici', compact: true, onBalance: () => balance() });
    const dialog = openDialog('Genera nemico', el('div', {}, difficulty.node, body), []);
    dialog.classList.add('wide');
    let opts = null;
    let results = [];

    const inp = {
      race: el('select', { 'data-key': 'raceId' },
        el('option', { value: '', text: st.races.length ? '— Scegli —' : 'Nessuna razza nella libreria' }),
        st.races.map((r, i) => el('option', { value: r.id, text: r.name, selected: i === 0 }))),
      level: numberInput(1, { min: 1, max: 20, 'data-key': 'level' }),
      cls: el('select', { 'data-key': 'classId' },
        el('option', { value: '', text: '— Scegli —' }),
        C.IDS.map((id) => el('option', { value: id, text: C.CLASSES[id].name })),
        customs.map((x, i) => el('option', { value: 'custom:' + i, text: x.label }))),
      quantity: numberInput(1, { min: 1, max: GEN.MAX_QUANTITY, 'data-key': 'quantity' }),
      standard: el('input', { type: 'radio', name: 'gen-ab', value: 'standard' }),
      dice: el('input', { type: 'radio', name: 'gen-ab', value: '4d6', checked: true }),
      avg: el('input', { type: 'radio', name: 'gen-hp', value: 'media', checked: true }),
      roll: el('input', { type: 'radio', name: 'gen-hp', value: 'tira' }),
      magic: el('input', { type: 'checkbox' }),
      name: textInput('', { maxlength: 55, placeholder: 'Vuoto = «Razza Classe»', 'data-key': 'name' }),
    };

    const form = el('form', { class: 'form', novalidate: true },
      el('div', { class: 'grid-3' }, field('Razza', inp.race, 'raceId'), field('Livello (1-20)', inp.level, 'level'), field('Classe', inp.cls, 'classId')),
      el('details', { class: 'extra' },
        el('summary', { text: 'Opzioni avanzate' }),
        el('div', { class: 'form' },
          el('div', { class: 'grid-2' },
            field('Quantità (nemici distinti, numerati)', inp.quantity, 'quantity'),
            field('Nome personalizzato', inp.name, 'name')),
          el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Caratteristiche' }),
            el('label', { class: 'check' }, inp.dice, ' 4d6 scarta il più basso'),
            el('label', { class: 'check' }, inp.standard, ' Array standard')),
          el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Punti ferita' }),
            el('label', { class: 'check' }, inp.avg, ' Usa la media'),
            el('label', { class: 'check' }, inp.roll, ' Tira i dadi')),
          el('label', { class: 'check' }, inp.magic, ' Equipaggiamento magico per livello (+1 dal 5°, +2 dall\'11°, +3 dal 17° a colpire, danno e CA)'))),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => dialog.dismiss() }),
        el('button', { type: 'submit', class: 'btn primary', text: '🎲 Genera' })));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      generate();
    });

    const DF = DnD.difficolta;
    // Nemici generati come un solo gruppo (stesso livello, stesso CS); gli altri sono fissi.
    function encounterInput() {
      const base = cfg.baseInput || { party: DF.partyFrom(DnD.uiDifficolta.partyPlayers().players), creatures: [] };
      const lv = results.length ? results[0].creature.level : readNumber(inp.level);
      const qty = results.length ? results.length : inp.quantity.value.trim() === '' ? 1 : readNumber(inp.quantity);
      const gen = Number.isInteger(lv) && lv >= GEN.MIN_LEVEL && lv <= GEN.MAX_LEVEL && Number.isInteger(qty) && qty > 0
        ? [{ id: '__generati', name: 'Nemici generati (liv. ' + lv + ')', cr: DF.standardCr(lv), count: Math.min(qty, GEN.MAX_QUANTITY) }] : [];
      return { party: base.party, creatures: base.creatures.map((g) => Object.assign({}, g, { fixed: true })).concat(gen) };
    }
    const refreshDifficulty = () => difficulty.update(encounterInput());
    function balance() {
      DnD.uiDifficolta.balanceDialog(encounterInput(), (i, count) => {
        if (count < 1) { toast('Già senza nemici generati l\'incontro ha questa difficoltà.'); return; }
        inp.quantity.value = String(count);
        if (results.length) generate();
        else refreshDifficulty();
      }, GEN.MAX_QUANTITY);
    }
    inp.level.addEventListener('input', () => { if (!results.length) refreshDifficulty(); });
    inp.quantity.addEventListener('input', () => { if (!results.length) refreshDifficulty(); });

    function readOptions() {
      const custom = /^custom:(\d+)$/.exec(inp.cls.value);
      return {
        raceId: inp.race.value,
        level: readNumber(inp.level),
        classId: custom ? C.CUSTOM : inp.cls.value,
        customClass: custom ? customs[Number(custom[1])].customClass : null,
        quantity: inp.quantity.value.trim() === '' ? 1 : readNumber(inp.quantity),
        abilityMethod: inp.standard.checked ? 'standard' : '4d6',
        hpMethod: inp.roll.checked ? 'tira' : 'media',
        magicItems: inp.magic.checked,
        name: inp.name.value.trim(),
        sessionId: DnD.sessioni.current(DnD.store.state).id,
      };
    }
    const ctx = () => ({ races: DnD.store.state.races, spells: DnD.store.state.spells, customClass: opts.customClass });

    function generate() {
      const o = readOptions();
      const errors = GEN.validateOptions(o);
      if (errors.quantity || errors.name) form.querySelector('details.extra').open = true;
      if (!showErrors(form, errors)) return;
      opts = o;
      const existing = DnD.sessioni.visible(DnD.store.state, 'npcs').map((n) => n.name);
      results = GEN.generateEnemies(opts, ctx(), existing, DnD.dadi.randomInt);
      renderPreview();
    }

    function regenerateAt(i) {
      results[i] = GEN.regenerate(results[i].creature, opts, ctx(), DnD.dadi.randomInt);
    }

    function warningsBox() {
      const warnings = [...new Set(results.flatMap((r) => r.warnings))];
      if (!warnings.length) return null;
      return el('div', { class: 'gen-warnings', role: 'status' }, warnings.map((w) => el('p', { class: 'warn', text: '⚠ ' + w })),
        el('button', { type: 'button', class: 'btn small', text: 'Apri la sezione Magie', onclick: () => { dialog.dismiss(); DnD.app.navigate('magie'); } }));
    }

    function renderPreview() {
      refreshDifficulty();
      const single = results.length === 1;
      clear(body).append(
        warningsBox(),
        single
          ? el('div', {}, el('h3', { text: results[0].creature.name }), creatureSheet(results[0].creature))
          : el('div', { class: 'gen-list' }, results.map((r, i) => el('details', { class: 'gen-item' },
            el('summary', { text: summary(r.creature) }),
            creatureSheet(r.creature),
            el('button', { type: 'button', class: 'btn small', text: '🎲 Rigenera questo', onclick: () => { regenerateAt(i); renderPreview(); body.querySelectorAll('.gen-item')[i].open = true; } })))),
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'btn', text: '← Opzioni', onclick: () => { results = []; clear(body).append(form); refreshDifficulty(); } }),
          el('button', { type: 'button', class: 'btn', text: '🎲 Rigenera' + (single ? '' : ' tutti'), onclick: () => { results.forEach((r, i) => regenerateAt(i)); renderPreview(); } }),
          cfg.allowEdit && single ? el('button', { type: 'button', class: 'btn', text: 'Salva e modifica', onclick: () => save(true) }) : null,
          el('button', { type: 'button', class: 'btn primary', text: cfg.saveLabel || 'Salva', onclick: () => save(false) })));
    }

    function save(edit) {
      const creatures = results.map((r) => r.creature);
      DnD.store.update((s) => { s.npcs.push(...creatures); });
      dialog.dismiss();
      toast(creatures.length === 1 ? 'Nemico «' + creatures[0].name + '» generato.' : creatures.length + ' nemici generati.', 'success');
      cfg.onSaved(creatures, edit);
    }

    body.append(form);
    refreshDifficulty();
    inp.level.focus();
  }

  DnD.uiGeneratore = { open, creatureSheet };
})(globalThis.DnD = globalThis.DnD || {});
