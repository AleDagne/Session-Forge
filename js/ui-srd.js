// Finestra «Importa dall'SRD» (anteprima con ricerca, filtri e selezione, poi scelta sui conflitti) e testo di
// attribuzione dell'SRD 5.1 (sezione Magie e Impostazioni). Livello interfaccia. Espone DnD.uiSrd; usa DnD.srd
// (confronto, importazione, salvataggio tutto o niente), DnD.datiSrd (attribuzione), DnD.magie e DnD.classi.
(function (DnD) {
  'use strict';

  const { el, clear, toast, openDialog } = DnD.ui;
  const M = DnD.magie;
  const C = DnD.classi;
  const SCELTE = { tieni: 'Tieni il mio', sostituisci: 'Sostituisci', copia: 'Importa come copia' };
  const MOTIVI = { nome: 'stesso nome di un tuo incantesimo', id: 'stesso id già in libreria', modificato: 'già importato e poi modificato' };

  // Testo di attribuzione (alla lettera dal PDF) con il collegamento alla licenza.
  function attribuzione() {
    const S = DnD.datiSrd;
    if (!S) return null;
    return el('div', { class: 'srd-credits small' },
      el('p', { text: S.ATTRIBUZIONE }),
      el('p', { class: 'muted' }, 'Licenza: ', el('a', { href: S.LICENZA_URL, target: '_blank', rel: 'noopener', text: S.LICENZA })));
  }

  const classiDi = (v) => v.classes.map((id) => C.CLASSES[id].name).join(', ') || '—';

  // Apre la finestra. onDone() dopo un'importazione riuscita (per ridisegnare la sezione).
  function apri(onDone) {
    const voci = DnD.srd.catalogo();
    if (!voci.length) { toast('Il file degli incantesimi dell\'SRD non è caricato.', 'error'); return; }
    const scelti = new Set();
    const f = { text: '', level: '', school: '', cls: '' };
    const stati = new Map(DnD.srd.confronta(DnD.store.state.spells, voci).map((r) => [r.voce.id, r]));
    const lista = el('ul', { class: 'srd-list' });
    const conteggio = el('span', { class: 'muted small' });
    const filtrate = () => {
      const t = f.text.trim().toLowerCase();
      return voci.filter((v) => (f.level === '' || v.level === Number(f.level)) && (!f.school || v.school === f.school) &&
        (!f.cls || v.classes.includes(f.cls)) && (!t || v.name.toLowerCase().includes(t) || v.description.toLowerCase().includes(t)));
    };
    const etichetta = (r) => (r.stato === 'presente' ? el('span', { class: 'tag', text: 'già importato' })
      : r.stato === 'conflitto' ? el('span', { class: 'tag danger', text: 'conflitto', title: MOTIVI[r.motivo] }) : el('span', { class: 'tag accent', text: 'nuovo' }));
    const disegna = () => {
      const vis = filtrate();
      clear(lista).append(...(vis.length ? vis.map((v) => {
        const box = el('input', { type: 'checkbox', checked: scelti.has(v.id), 'aria-label': 'Seleziona ' + v.name, onchange: () => { if (box.checked) scelti.add(v.id); else scelti.delete(v.id); conta(); } });
        const testo = el('p', { class: 'small srd-text', hidden: true, text: v.description + (v.higherLevels ? '\nAi livelli superiori. ' + v.higherLevels : '') });
        return el('li', {},
          el('div', { class: 'srd-row' },
            el('label', { class: 'check' }, box, ' ', el('strong', { text: v.name })),
            el('span', { class: 'muted small', text: M.levelName(v.level) + ' · ' + M.SCHOOL_NAMES[v.school] + ' · ' + classiDi(v) }),
            etichetta(stati.get(v.id)),
            el('button', { type: 'button', class: 'btn small', text: 'Testo', 'aria-expanded': 'false', onclick: (e) => { testo.hidden = !testo.hidden; e.target.setAttribute('aria-expanded', String(!testo.hidden)); } })),
          testo);
      }) : [el('li', { class: 'muted small', text: 'Nessun incantesimo corrisponde ai filtri.' })]));
      conta();
    };
    const conta = () => {
      const vis = filtrate().length;
      conteggio.textContent = scelti.size + ' selezionati · ' + vis + ' mostrati su ' + voci.length;
    };
    const select = (key, label, options) => el('select', { 'aria-label': label, onchange: (e) => { f[key] = e.target.value; disegna(); } },
      options.map(([v, t]) => el('option', { value: v, text: t })));
    const body = el('div', { class: 'srd-import' },
      el('div', { class: 'filters' },
        el('input', { type: 'search', placeholder: 'Cerca per nome o testo…', 'aria-label': 'Cerca negli incantesimi dell\'SRD', oninput: (e) => { f.text = e.target.value; disegna(); } }),
        select('level', 'Livello', [['', 'Tutti i livelli']].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => [String(l), M.levelName(l)]))),
        select('school', 'Scuola', [['', 'Tutte le scuole']].concat(M.SCHOOLS.map((s) => [s, M.SCHOOL_NAMES[s]]))),
        select('cls', 'Classe', [['', 'Tutte le classi']].concat(C.IDS.filter((id) => C.CLASSES[id].caster).map((id) => [id, C.CLASSES[id].name])))),
      el('div', { class: 'srd-bar' },
        el('button', { type: 'button', class: 'btn small', text: 'Seleziona tutti', title: 'Seleziona tutti gli incantesimi mostrati', onclick: () => { for (const v of filtrate()) scelti.add(v.id); disegna(); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Deseleziona', onclick: () => { for (const v of filtrate()) scelti.delete(v.id); disegna(); } }),
        conteggio),
      lista,
      el('p', { class: 'muted small', text: 'Gli effetti meccanici sono proposti in automatico dal testo: dopo l\'importazione li trovi nel filtro «Da verificare».' }));
    const dialog = openDialog('Importa dall\'SRD 5.1', body, [
      { text: 'Annulla' },
      { text: 'Continua', class: 'primary', onclick: () => {
        if (!scelti.size) { toast('Seleziona almeno un incantesimo.', 'error'); return false; }
        const confronto = DnD.srd.confronta(DnD.store.state.spells, voci.filter((v) => scelti.has(v.id)));
        if (confronto.some((r) => r.stato === 'conflitto')) conflitti(confronto, onDone);
        else importa(confronto, {}, onDone);
        return true;
      } },
    ]);
    dialog.classList.add('wide');
    disegna();
  }

  // Seconda finestra: una scelta per ogni conflitto, con «Applica a tutti». Predefinito: tieni il mio.
  function conflitti(confronto, onDone) {
    const lista = confronto.filter((r) => r.stato === 'conflitto');
    const scelte = Object.fromEntries(lista.map((r) => [r.voce.id, 'tieni']));
    const selects = [];
    const opzioni = (valore) => Object.entries(SCELTE).map(([k, t]) => el('option', { value: k, text: t, selected: k === valore }));
    const tutti = el('select', { 'aria-label': 'Applica a tutti i conflitti', onchange: (e) => {
      if (!e.target.value) return;
      for (const s of selects) { s.value = e.target.value; scelte[s.dataset.id] = e.target.value; }
    } }, [el('option', { value: '', text: 'Applica a tutti…' })].concat(opzioni('')));
    const body = el('div', {},
      el('p', { text: lista.length + (lista.length === 1 ? ' incantesimo è' : ' incantesimi sono') + ' già in libreria. Scegli cosa fare: «Tieni il mio» non cambia nulla, «Sostituisci» mette il testo dell\'SRD al posto del tuo (i personaggi che lo conoscono lo tengono), «Importa come copia» aggiunge l\'incantesimo dell\'SRD con il nome «… (SRD)».' }),
      el('label', { class: 'inline small' }, 'Per tutti: ', tutti),
      el('ul', { class: 'srd-list' }, lista.map((r) => {
        const s = el('select', { 'data-id': r.voce.id, 'aria-label': 'Scelta per ' + r.voce.name, onchange: (e) => { scelte[r.voce.id] = e.target.value; } }, opzioni('tieni'));
        selects.push(s);
        return el('li', { class: 'srd-row' },
          el('strong', { text: r.voce.name }),
          el('span', { class: 'muted small', text: MOTIVI[r.motivo] + (r.esistente.name !== r.voce.name ? ' («' + r.esistente.name + '»)' : '') }),
          s);
      })));
    openDialog('Conflitti con la libreria', body, [
      { text: 'Annulla' },
      { text: 'Importa', class: 'primary', onclick: () => { importa(confronto, scelte, onDone); } },
    ]).classList.add('wide');
  }

  async function importa(confronto, scelte, onDone) {
    const r = DnD.srd.applica(DnD.store.state.spells, confronto, scelte, DnD.dadi.uid);
    const e = r.esito;
    const fatti = e.aggiunti + e.sostituiti + e.copie;
    if (!fatti) {
      toast('Nessun incantesimo importato' + (e.presenti ? ': ' + e.presenti + ' già presenti' : '') + (e.tenuti ? ', ' + e.tenuti + ' tenuti come erano' : '') + '.');
      return;
    }
    const salvato = await DnD.srd.salvaLibreria(DnD.store, r.spells);
    if (!salvato.ok) {
      toast('Importazione annullata, nessun incantesimo aggiunto: ' + (salvato.message || 'salvataggio non riuscito') + '.', 'error');
      if (onDone) onDone();
      return;
    }
    const parti = [e.aggiunti && e.aggiunti + ' aggiunti', e.sostituiti && e.sostituiti + ' sostituiti', e.copie && e.copie + ' copie',
      e.tenuti && e.tenuti + ' tenuti come erano', e.presenti && e.presenti + ' già presenti'].filter(Boolean);
    toast('Importazione dall\'SRD: ' + parti.join(', ') + '.', 'success');
    if (onDone) onDone();
  }

  DnD.uiSrd = { apri, attribuzione };
})(globalThis.DnD = globalThis.DnD || {});
