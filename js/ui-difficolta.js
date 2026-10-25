// Interfaccia della difficoltà degli incontri (calcoli in difficolta.js): indicatore a fasce colorate con il
// dettaglio del calcolo, «Bilancia» (anteprima e conferma), «Budget» di una creatura e finestra delle tabelle
// personalizzate. Usata da setup del combattimento, generatore, Creature, Boss ed Esplorazione.
(function (DnD) {
  'use strict';

  const { el, fill, numberInput, readNumber, openDialog, toast } = DnD.ui;
  const D = DnD.difficolta;
  const K = DnD.difficoltaDati;
  const fmt = (n) => DnD.creature.formatXp(Math.round(n));

  const rules = () => D.tables(DnD.store.state.difficultyRules);

  // Party per i calcoli: i membri del party attivo visibili nella sessione, altrimenti tutti i giocatori.
  function partyPlayers(st) {
    st = st || DnD.store.state;
    const all = DnD.sessioni.visible(st, 'players');
    const v = DnD.fazioni.view(st);
    const p = DnD.party.active(v.parties, v.world);
    const members = p ? all.filter((x) => p.memberIds.includes(x.id)) : [];
    return members.length ? { players: members, label: 'party «' + p.name + '»' } : { players: all, label: 'tutti i giocatori' };
  }

  // Indicatore: { node, update(input), result() }. opts: { title, onBalance(result) (pulsante «Bilancia»), compact }.
  function indicator(opts) {
    opts = opts || {};
    let last = null;
    const badge = el('span', { class: 'diff-badge' });
    const numbers = el('span', { class: 'muted small diff-numbers' });
    const bar = el('div', { class: 'diff-bar', role: 'meter', 'aria-valuemin': '0' });
    const marker = el('span', { class: 'diff-marker', 'aria-hidden': 'true' });
    const detail = el('pre', { class: 'diff-detail small' });
    const warnings = el('ul', { class: 'diff-warnings small' });
    const balanceBtn = opts.onBalance ? el('button', { type: 'button', class: 'btn small', text: '⚖ Bilancia', title: 'Proposte per raggiungere la difficoltà scelta', onclick: () => opts.onBalance(last) }) : null;
    const node = el('div', { class: 'diff-indicator' + (opts.compact ? ' compact' : ''), 'aria-live': 'polite' },
      el('div', { class: 'diff-head' }, el('b', { text: (opts.title || 'Difficoltà') + ': ' }), badge, ' ', numbers, balanceBtn),
      bar, warnings,
      el('details', { class: 'diff-more' }, el('summary', { class: 'small', text: 'Dettaglio del calcolo' }), detail));

    function update(input) {
      const r = last = D.evaluate(input, rules());
      const text = D.detailText(r);
      const name = r.band ? D.bandName(r.band) : '—';
      badge.textContent = name;
      badge.className = 'diff-badge' + (r.band ? ' diff-' + r.band : '');
      numbers.textContent = r.count ? 'PE modificati ' + fmt(r.adjustedXp) + ' · grezzi ' + fmt(r.rawXp) + (r.party ? ' · ' + fmt(r.perPlayerXp) + ' a testa' : '') : '';
      const sc = r.party ? D.scale(r) : null;
      fill(bar, sc ? sc.segments.map((s) => el('span', {
        class: 'diff-seg diff-' + s.band, style: 'width:' + s.width.toFixed(3) + '%',
        title: D.bandName(s.band) + (s.band === 'oltre' ? ': oltre ' + fmt(s.from) : ': da ' + fmt(s.from) + (s.band === 'mortale' ? ' (oltre ' + fmt(s.to) + ' è Oltre il mortale)' : ' a ' + fmt(s.to))),
      })) : null, sc && r.count ? marker : null);
      if (sc) marker.style.left = sc.marker.toFixed(2) + '%';
      bar.title = text;
      bar.setAttribute('aria-label', 'Difficoltà dell\'incontro');
      bar.setAttribute('aria-valuemax', String(Math.round(sc ? sc.max : 0)));
      bar.setAttribute('aria-valuenow', String(Math.round(r.adjustedXp)));
      bar.setAttribute('aria-valuetext', name + ', ' + fmt(r.adjustedXp) + ' PE modificati');
      detail.textContent = text;
      fill(warnings, r.warnings.map((w) => el('li', { class: 'warn', text: '⚠ ' + w })));
      if (balanceBtn) balanceBtn.disabled = !r.count || !r.party;
      return r;
    }
    return { node, update, result: () => last };
  }

  // Bilancia: scelta della fascia, una proposta per ogni tipo di creatura; il master ne applica una (o nessuna).
  // onApply(index, count) riceve il gruppo scelto e il nuovo numero.
  function balanceDialog(input, onApply, max) {
    const target = el('select', { 'aria-label': 'Difficoltà da raggiungere' }, K.THRESHOLD_BANDS.map((b) => el('option', { value: b, text: D.bandName(b), selected: b === 'medio' })));
    const list = el('div', { class: 'diff-proposals', 'aria-live': 'polite' });
    let dialog = null;
    const draw = () => {
      const props = D.balance(input, target.value, rules(), max);
      fill(list, props.length ? el('ul', { class: 'pick-list' }, props.map((p) => el('li', {},
        el('b', { text: p.name || 'Creatura' }), ' ',
        p.to === null ? el('span', { class: 'muted small', text: 'non raggiunge «' + D.bandName(target.value) + '» cambiando solo questo tipo (0-' + (max || K.MAX_BALANCE) + ').' })
          : p.to === p.from ? el('span', { class: 'muted small', text: 'già ' + p.from + ': ' + D.bandName(p.result.band) + ' (' + fmt(p.result.adjustedXp) + ' PE modificati).' })
            : [el('span', { class: 'small', text: p.from + ' → ' + p.to + ' (' + (p.to > p.from ? '+' : '') + (p.to - p.from) + '): ' + D.bandName(p.result.band) + ', ' + fmt(p.result.adjustedXp) + ' PE modificati ' }),
              el('button', { type: 'button', class: 'btn small', text: 'Applica', onclick: () => {
                if (!confirm('Portare «' + (p.name || 'Creatura') + '» da ' + p.from + ' a ' + p.to + '?')) return;
                onApply(p.index, p.to);
                dialog.dismiss();
                toast('Incontro bilanciato: ' + D.bandName(p.result.band) + '.', 'success');
              } })]))) : el('p', { class: 'empty', text: 'Nessuna creatura da bilanciare.' }));
    };
    target.addEventListener('change', draw);
    dialog = openDialog('Bilancia l\'incontro', el('div', { class: 'form' },
      el('label', { class: 'inline' }, 'Difficoltà da raggiungere ', target),
      el('p', { class: 'muted small', text: 'Per ogni tipo: quante creature servono, cambiando solo quel tipo (gli altri restano come sono). Niente cambia finché non scegli «Applica».' }),
      list), [{ text: 'Chiudi' }]);
    draw();
    return dialog;
  }

  // Budget di un CS con il party attuale: quante creature servono per Medio, Difficile e Mortale.
  function budgetBox(cr) {
    const box = el('div', { class: 'diff-budget', 'aria-live': 'polite' });
    const update = (crNow) => {
      const { players, label } = partyPlayers();
      const party = D.partyFrom(players);
      if (!party.length) { fill(box, el('p', { class: 'muted small', text: 'Budget: nessun giocatore nella sessione.' })); return; }
      const b = D.budget(crNow, party, rules());
      fill(box, el('p', { class: 'small' }, el('b', { text: 'Budget (CS ' + crNow + ', ' + label + ', ' + party.length + ' pers.): ' }),
        ['medio', 'difficile', 'mortale'].map((k, i) => [i ? ' · ' : '', el('span', { class: 'diff-badge diff-' + k, text: D.bandName(k) }), ' ',
          b[k] ? b[k].count + (b[k].band !== k ? ' (già ' + D.bandName(b[k].band) + ')' : '') : 'oltre ' + K.MAX_BALANCE])));
    };
    update(cr);
    return { node: box, update };
  }

  // ---------- Tabelle personalizzate ----------
  function rulesDialog() {
    const r = D.normalizeRules(DnD.store.state.difficultyRules);
    const custom = el('input', { type: 'checkbox', checked: r.custom });
    const npcs = el('input', { type: 'checkbox', checked: r.countNeutralNpcs });
    const cell = (v, label) => numberInput(v, { min: 0, max: 10000000, class: 'qty', 'aria-label': label });
    const thr = r.thresholds.map((row, i) => row.map((v, j) => cell(v, 'Livello ' + (i + 1) + ', ' + D.bandName(K.THRESHOLD_BANDS[j]))));
    const multBox = el('tbody');
    const multRows = [];
    const addMult = (m) => {
      const row = { min: numberInput(m.min, { min: 1, max: 1000, class: 'qty', 'aria-label': 'Da quante creature' }), factor: numberInput(m.factor, { min: 0, max: 100, step: 0.5, class: 'qty', 'aria-label': 'Moltiplicatore' }) };
      const tr = el('tr', {}, el('td', {}, row.min), el('td', {}, row.factor), el('td', {}, el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Elimina la riga', onclick: () => { multRows.splice(multRows.indexOf(row), 1); tr.remove(); } })));
      multRows.push(row);
      multBox.append(tr);
    };
    r.multipliers.forEach(addMult);
    const below = numberInput(r.belowFirst, { min: 0, max: 100, step: 0.5, class: 'qty', 'aria-label': 'Sotto la prima riga' });
    const above = numberInput(r.aboveLast, { min: 0, max: 100, step: 0.5, class: 'qty', 'aria-label': 'Oltre l\'ultima riga' });
    // Leggendari: una riga per livello 21-40, attiva solo se spuntata (altrimenti la riga del 20).
    const legend = Array.from({ length: K.MAX_LEVEL - K.MAX_TABLE_LEVEL }, (_, i) => {
      const lv = K.MAX_TABLE_LEVEL + 1 + i;
      const cur = r.legendary[lv] || r.thresholds[K.MAX_TABLE_LEVEL - 1];
      return { lv, on: el('input', { type: 'checkbox', checked: Boolean(r.legendary[lv]), 'aria-label': 'Soglie a mano per il livello ' + lv }), cells: cur.map((v, j) => cell(v, 'Livello ' + lv + ', ' + D.bandName(K.THRESHOLD_BANDS[j]))) };
    });
    const head = el('thead', {}, el('tr', {}, el('th', { text: 'Liv.' }), K.THRESHOLD_BANDS.map((b) => el('th', { text: D.bandName(b) }))));
    const error = el('p', { class: 'error', 'aria-live': 'polite' });
    const body = el('div', { class: 'form diff-rules' },
      el('label', { class: 'check' }, custom, ' Usa tabelle personalizzate (regole della casa)'),
      el('label', { class: 'check' }, npcs, ' Conta anche gli NPC neutrali che potrebbero diventare ostili (mai alleati e amichevoli)'),
      el('details', {}, el('summary', { text: 'Soglie di PE per personaggio (livelli 1-20)' }),
        el('table', { class: 'diff-table' }, head, el('tbody', {}, thr.map((row, i) => el('tr', {}, el('th', { text: String(i + 1) }), row.map((c) => el('td', {}, c))))))),
      el('details', {}, el('summary', { text: 'Moltiplicatori per numero di creature' }),
        el('table', { class: 'diff-table' }, el('thead', {}, el('tr', {}, el('th', { text: 'Da (creature)' }), el('th', { text: 'Moltiplicatore' }), el('th', {}))), multBox),
        el('button', { type: 'button', class: 'btn small', text: '+ Riga', onclick: () => addMult({ min: '', factor: '' }) }),
        el('div', { class: 'input-row' }, el('label', { class: 'inline small' }, 'Party grande, sotto la prima riga ×', below), el('label', { class: 'inline small' }, 'Party piccolo, oltre l\'ultima ×', above)),
        el('p', { class: 'muted small', text: 'Party con meno di ' + K.SMALL_PARTY + ' giocatori: un gradino su; con ' + K.LARGE_PARTY + ' o più: un gradino giù.' })),
      el('details', {}, el('summary', { text: 'Leggendari (livelli 21-40): soglie a mano' }),
        el('p', { class: 'muted small', text: 'La Guida arriva al livello 20: senza soglie a mano si usa la riga del 20 (con un avviso). Valgono anche senza tabelle personalizzate.' }),
        el('table', { class: 'diff-table' }, el('thead', {}, el('tr', {}, el('th', { text: 'A mano' }), el('th', { text: 'Liv.' }), K.THRESHOLD_BANDS.map((b) => el('th', { text: D.bandName(b) })))),
          el('tbody', {}, legend.map((x) => el('tr', {}, el('td', {}, x.on), el('th', { text: String(x.lv) }), x.cells.map((c) => el('td', {}, c))))))),
      error);
    const read = () => ({
      custom: custom.checked, countNeutralNpcs: npcs.checked,
      thresholds: thr.map((row) => row.map(readNumber)),
      multipliers: multRows.map((m) => ({ min: readNumber(m.min), factor: readNumber(m.factor) })),
      belowFirst: readNumber(below), aboveLast: readNumber(above),
      legendary: Object.fromEntries(legend.filter((x) => x.on.checked).map((x) => [x.lv, x.cells.map(readNumber)])),
    });
    // Ogni riga di soglie deve crescere da facile a mortale; i moltiplicatori partono da 1 creatura.
    const validate = (d) => {
      const rows = d.thresholds.concat(Object.values(d.legendary));
      if (rows.some((row) => row.some((v) => !Number.isInteger(v) || v < 0))) return 'Le soglie sono interi da 0 in su.';
      if (rows.some((row) => row.some((v, i) => i && v < row[i - 1]))) return 'In ogni riga le soglie crescono da facile a mortale.';
      if (d.multipliers.some((m) => !Number.isInteger(m.min) || m.min < 1 || !Number.isFinite(m.factor) || m.factor < 0)) return 'Ogni moltiplicatore ha un numero di creature (da 1) e un fattore (da 0).';
      if (!d.multipliers.some((m) => m.min === 1)) return 'Serve una riga dei moltiplicatori per 1 creatura.';
      if (new Set(d.multipliers.map((m) => m.min)).size !== d.multipliers.length) return 'Due righe dei moltiplicatori con lo stesso numero di creature.';
      if (![d.belowFirst, d.aboveLast].every((v) => Number.isFinite(v) && v >= 0)) return 'I gradini oltre la tabella sono numeri da 0 in su.';
      return '';
    };
    const save = (data) => { DnD.store.update((st) => { st.difficultyRules = D.normalizeRules(data); }); window.dispatchEvent(new Event('difficultychange')); };
    openDialog('Tabelle della difficoltà', body, [
      { text: 'Ripristina la Guida', onclick: () => {
        if (!confirm('Tornare alle tabelle della Guida del DM? Le soglie dei leggendari e le opzioni restano.')) return false;
        save(Object.assign(D.defaultRules(), { legendary: r.legendary, countNeutralNpcs: npcs.checked }));
        toast('Tabelle della Guida ripristinate.', 'success');
        return undefined;
      } },
      { text: 'Annulla' },
      { text: 'Salva', class: 'primary', onclick: () => {
        const data = read();
        const msg = validate(data);
        error.textContent = msg;
        if (msg) return false;
        save(data);
        toast('Tabelle della difficoltà salvate.', 'success');
        return undefined;
      } },
    ]).classList.add('wide');
  }

  // Gruppo «Difficoltà» del pannello Impostazioni (dati dell'archivio, non del browser).
  function settingsGroup() {
    const status = el('p', { class: 'muted small' });
    const sync = () => {
      const r = D.normalizeRules(DnD.store.state && DnD.store.state.difficultyRules);
      status.textContent = (r.custom ? 'Tabelle personalizzate' : 'Tabelle della Guida del DM') + (Object.keys(r.legendary).length ? ' · soglie a mano per ' + Object.keys(r.legendary).length + ' livelli leggendari' : '') +
        (r.countNeutralNpcs ? ' · NPC neutrali contati' : '');
    };
    window.addEventListener('difficultychange', sync);
    const node = el('details', { class: 'settings-group' }, el('summary', { text: 'Difficoltà' }), status,
      el('button', { type: 'button', class: 'btn small', text: 'Tabelle e opzioni…', onclick: rulesDialog }));
    return { node, sync };
  }

  DnD.uiDifficolta = { rules, partyPlayers, indicator, balanceDialog, budgetBox, rulesDialog, settingsGroup };
})(globalThis.DnD = globalThis.DnD || {});
