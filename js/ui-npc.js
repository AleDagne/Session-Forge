// Mondo › NPC: elenco, editor (Generale, Scheda riusata Standard/Creatura, Mercante, Dialogo, Quest e routine),
// «Promuovi da nemico/creatura». Sulla griglia: pannello NPC con Parla (dialogo giocabile), Commercia (finestra di
// scambio con carrello, monete e contrattazione), Quest, Attacca, Scheda e Fazione (copia, atteggiamento,
// rivelazioni per i giocatori, Calma). Ogni copia piazzata ha lo stato proprio (npc.js).
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const N = DnD.npc;
  const F = DnD.fazioni;
  const K = DnD.mondoDati;
  const A = DnD.attrezzatura;
  const R = DnD.regole;
  const UM = () => DnD.uiMondo;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const SUBTABS = [{ id: 'generale', label: 'Generale' }, { id: 'scheda', label: 'Scheda' }, { id: 'mercante', label: 'Mercante' }, { id: 'dialogo', label: 'Dialogo' }, { id: 'altro', label: 'Quest e routine' }];
  let root = null;
  let editing = null;   // copia di lavoro dell'NPC in modifica
  let isNew = false;
  let sub = 'generale';
  let query = '';

  const st = () => DnD.store.state;
  const world = () => F.view(st());
  const sessionId = () => DnD.sessioni.current(st()).id;
  const npcById = (id) => (st().worldNpcs || []).find((n) => n.id === id) || null;
  const players = () => DnD.sessioni.visible(st(), 'players');
  const eqName = (id) => { const e = st().equipment.find((x) => x.id === id); return e ? e.name : '⚠ oggetto eliminato'; };

  // ---------- Elenco ----------
  function render(container) {
    root = container || root;
    clear(root);
    if (editing) return renderEditor();
    renderList();
  }

  function newNpc(preset) {
    return N.normalizeNpc(Object.assign({ id: DnD.dadi.uid(), name: '', base: 'standard', roles: ['informatore'], sessionId: sessionId(),
      stats: { name: '', level: 1, maxHp: 9, ac: 11, acMode: 'manuale', saveMode: 'classe', classId: '' } }, preset || {}));
  }
  function openNew(preset) {
    editing = newNpc(preset);
    editing.name = '';
    isNew = true;
    sub = 'generale';
  }

  function renderList() {
    const w = world();
    const shown = w.npcs.filter((n) => !query || (n.name + ' ' + n.title).toLowerCase().includes(query.toLowerCase()));
    root.append(el('div', { class: 'section-head' }, el('h2', { text: 'NPC' }),
      el('div', { class: 'head-actions' },
        el('input', { type: 'search', placeholder: 'Cerca…', value: query, 'aria-label': 'Cerca un NPC', onchange: (e) => { query = e.target.value.trim(); render(); } }),
        el('button', { class: 'btn', text: '⇧ Promuovi da nemico…', onclick: promoteDialog }),
        el('button', { class: 'btn primary', text: '+ Nuovo NPC', onclick: () => { openNew(); render(); } }))),
    el('p', { class: 'muted small', text: 'Un NPC riusa la scheda Standard o Creatura e aggiunge ruoli, fazione, città, atteggiamento e dialogo. Trascinalo sulla griglia dal pannello (gruppo «NPC del Mondo»): ogni copia ha il suo stato. Non conta nella difficoltà e nei PE finché non diventa ostile.' }),
    shown.length ? el('div', { class: 'card-grid' }, shown.map((n) => {
      const fid = N.factionOf(n, null, w.cities);
      const rep = F.reputationOf(w.world, DnD.party.active(w.parties, w.world), fid);
      const att = N.attitudeOf(n, null, rep);
      const city = w.cities.find((c) => c.id === n.cityId);
      const missing = N.missingRefs(n, st(), w);
      return el('article', { class: 'card npc-card' },
        el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(n.stats.icon, 32), el('h3', { text: n.name }),
          n.shared ? el('span', { class: 'tag accent', text: 'Condiviso' }) : null), UM().factionBadge(fid)),
        n.title ? el('p', { class: 'muted small', text: n.title }) : null,
        el('p', { class: 'small' }, n.roles.map((r) => el('span', { class: 'tag', text: K.ROLE_ICONS[r] + ' ' + K.ROLE_NAMES[r] })), n.hiddenRole ? el('span', { class: 'tag', text: '🙈 ruolo nascosto' }) : null),
        el('p', { class: 'muted small', text: [n.base === 'creatura' ? 'Creatura GS ' + n.stats.cr : 'Standard liv. ' + n.stats.level, 'CA ' + n.stats.ac, city ? '🏰 ' + city.name : n.cityId ? '⚠ città eliminata' : '', 'atteggiamento: ' + K.ATTITUDE_NAMES[att]].filter(Boolean).join(' · ') }),
        missing.length ? el('p', { class: 'small warn-text', text: '⚠ ' + missing.join(', ') }) : null,
        el('div', { class: 'card-actions' },
          el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = clone(n); isNew = false; sub = 'generale'; render(); } }),
          el('button', { class: 'btn', text: '▶ Dialogo', disabled: !n.dialog.nodes.length, onclick: () => dialogRunner(n, null, { test: true }) }),
          el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(n) }),
          el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(n) })));
    })) : query ? el('p', { class: 'empty', text: 'Nessun NPC per «' + query + '».' }) : DnD.ui.emptyState('Nessun NPC', 'Mercanti, datori di quest, guardie, informatori…', [{ text: '+ Nuovo NPC', primary: true, onclick: () => { openNew(); render(); } }]));
  }

  function duplicate(n) {
    const copy = Object.assign(clone(n), { id: DnD.dadi.uid(), name: (n.name + ' (copia)').slice(0, 60), shared: false, sessionId: sessionId() });
    UM().update((s) => { s.worldNpcs.push(copy); });
    toast('NPC duplicato.');
    render();
  }
  function remove(n) {
    if (!confirm('Eliminare l\'NPC «' + n.name + '»? Le copie piazzate sulle griglie restano come segnaposto con un avviso.' + (n.shared ? '\nÈ condiviso: sparirà da tutte le sessioni.' : ''))) return;
    UM().update((s) => { s.worldNpcs = s.worldNpcs.filter((x) => x.id !== n.id); });
    toast('NPC eliminato.');
    render();
  }

  // Promuovi da nemico (Standard, Creatura o Boss): la scheda si copia, il nemico resta.
  function promoteDialog() {
    const list = DnD.sessioni.visible(st(), 'npcs');
    if (!list.length) { toast('Nessun nemico nella sessione.', 'error'); return; }
    const sel = el('select', {}, list.map((n) => opt(n.id, n.name + ' (' + (n.type === 'boss' ? 'Boss' : n.type === 'creatura' ? 'Creatura' : 'Standard') + ')')));
    openDialog('Promuovi a NPC', el('div', { class: 'form' }, field('Nemico o creatura', sel), el('p', { class: 'muted small', text: 'La scheda viene copiata in un nuovo NPC (ruolo Informatore, modificabile); il nemico originale resta.' })), [
      { text: 'Annulla' },
      { text: 'Promuovi', class: 'primary', onclick: () => {
        const enemy = list.find((n) => n.id === sel.value);
        editing = N.fromEnemy(enemy, sessionId());
        if (enemy.factionId) editing.factionId = enemy.factionId;
        if (enemy.cityId) editing.cityId = enemy.cityId;
        isNew = true;
        sub = 'generale';
        render();
      } },
    ]);
  }

  // ---------- Editor ----------
  function persist(n) {
    const saved = N.normalizeNpc(n);
    UM().update((s) => {
      const i = s.worldNpcs.findIndex((x) => x.id === saved.id);
      if (i >= 0) s.worldNpcs[i] = saved;
      else s.worldNpcs.push(saved);
    });
    isNew = false;
    return saved;
  }
  function saveAndClose() {
    if (!editing.name.trim()) { toast('Il nome è obbligatorio (scheda Generale).', 'error'); sub = 'generale'; render(); return; }
    persist(editing);
    toast('NPC salvato.', 'success');
    editing = null;
    render();
  }

  function renderEditor() {
    const n = editing;
    root.append(el('div', { class: 'section-head' },
      el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(n.stats.icon, 32), el('h2', { text: (isNew ? 'Nuovo NPC' : 'NPC') + (n.name ? ': ' + n.name : '') })),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { class: 'btn primary', text: 'Salva NPC', onclick: saveAndClose }))),
    DnD.uiAsset.tabBar(SUBTABS, sub, 'Parti dell\'NPC', 'scheda-npc-', (id) => { sub = id; render(); }, true));
    const host = el('div', { class: 'npc-editor', role: 'tabpanel' });
    root.append(host);
    if (sub === 'scheda') return statsTab(host, n);
    if (sub === 'mercante') return merchantTab(host, n);
    if (sub === 'dialogo') return dialogTab(host, n);
    if (sub === 'altro') return otherTab(host, n);
    generalTab(host, n);
  }

  function generalTab(host, n) {
    const w = world();
    const set = (k) => (e) => { n[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const roleBox = el('div', { class: 'check-row' }, K.ROLES.map((r) => el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: n.roles.includes(r), onchange: (e) => { n.roles = e.target.checked ? [...new Set(n.roles.concat(r))] : n.roles.filter((x) => x !== r); render(); } }), ' ' + K.ROLE_ICONS[r] + ' ' + K.ROLE_NAMES[r])));
    const cityFaction = () => { const c = w.cities.find((x) => x.id === n.cityId); return c ? DnD.citta.defaultFaction(c) : 'neutrali'; };
    host.append(el('div', { class: 'panel form' },
      el('div', { class: 'grid-3' },
        field('Nome', textInput(n.name, { maxlength: 60, oninput: (e) => { n.name = e.target.value; n.stats.name = e.target.value; } })),
        field('Titolo o mestiere', textInput(n.title, { maxlength: 60, placeholder: 'es. Fabbro del porto', oninput: set('title') })),
        field('Scheda', el('select', { onchange: (e) => {
          if (!confirm('Cambiare il tipo di scheda? Le statistiche ripartono da una scheda vuota.')) { e.target.value = n.base; return; }
          n.base = e.target.value;
          n.stats = N.normalizeNpc({ base: n.base, name: n.name }).stats;
          render();
        } }, opt('standard', 'Standard (razza, classe, livello)', n.base === 'standard'), opt('creatura', 'Creatura (Manuale dei Mostri)', n.base === 'creatura')))),
      el('fieldset', {}, el('legend', { text: 'Ruoli' }), roleBox,
        el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: n.hiddenRole, onchange: set('hiddenRole') }), ' Ruolo nascosto (sulla griglia e ai giocatori si vede solo il nome)')),
      el('div', { class: 'grid-3' },
        field('Fazione', UM().factionSelect(n.factionId, { empty: '— dalla città (' + ((w.factions.find((f) => f.id === cityFaction()) || {}).name || 'Neutrali') + ') —', onchange: set('factionId') })),
        field('Città', UM().citySelect(n.cityId, { onchange: (e) => { n.cityId = e.target.value; render(); } })),
        field('Atteggiamento di base', el('select', { onchange: set('attitude') }, K.ATTITUDES.map((a) => opt(a, K.ATTITUDE_NAMES[a], a === n.attitude))), null,
          'Si somma al modificatore della reputazione del party con la sua fazione.')),
      // Sempre visibile: qualunque NPC può essere attaccato (le regole valgono anche senza il ruolo).
      el('fieldset', {}, el('legend', { text: '🛡 Nel combattimento (combattente neutrale)' }),
        el('div', { class: 'grid-3 tight' },
          field('Comportamento', el('select', { onchange: (e) => { n.combat.defend = e.target.value; } }, K.DEFENDS.map((d) => opt(d, K.DEFEND_NAMES[d], d === n.combat.defend)))),
          field('Se provocato diventa ostile', el('select', { onchange: (e) => { n.combat.provoke = e.target.value; } }, K.PROVOKE_RULES.map((d) => opt(d, K.PROVOKE_NAMES[d], d === n.combat.provoke)))),
          field('Penalità di reputazione', numberInput(n.combat.penalty, { min: -100, max: 0, oninput: (e) => { n.combat.penalty = Math.min(0, readNumber(e.target) || 0); } }))),
        el('div', { class: 'grid-2 tight' },
          field('CD per calmarlo', numberInput(n.combat.calmDc, { min: 1, max: 40, oninput: (e) => { n.combat.calmDc = readNumber(e.target) || 15; } })),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: n.combat.joinNow, onchange: (e) => { n.combat.joinNow = e.target.checked; } }), ' Entra subito nell\'iniziativa (anche se neutrale)')),
        el('p', { class: 'muted small', text: 'Un NPC neutrale non attacca e resta fuori dall\'iniziativa finché non diventa ostile: se viene attaccato (o lo è un alleato che difende) diventa ostile, tira l\'iniziativa ed entra al round successivo.' })),
      field('Note del master', el('textarea', { rows: 3, value: n.notes, oninput: set('notes') })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: n.shared, onchange: set('shared') }), ' Condividi con tutte le sessioni')));
  }

  // Scheda: il form di Standard o Creatura, che salva le statistiche dell'NPC.
  function statsTab(host, n) {
    const done = (saved) => { if (saved) { const name = n.name || saved.name; n.stats = Object.assign(saved, { name }); n.name = name; persist(n); } sub = 'generale'; render(); };
    const stats = Object.assign(clone(n.stats), { id: 'scheda-' + n.id, name: n.name || n.stats.name, sessionId: sessionId() });
    if (n.base === 'creatura') {
      DnD.uiMostri.monsterForm(host, stats, { kind: 'creatura', worldRefs: false, heading: 'Scheda (Creatura)', submitText: 'Salva la scheda', savedText: 'Scheda dell\'NPC salvata.', save: () => {}, onDone: (saved) => done(saved) });
    } else {
      DnD.sezioni.nemici.form({ player: stats, host, heading: 'Scheda (Standard)', submitText: 'Salva la scheda', savedText: 'Scheda dell\'NPC salvata.', save: () => {}, onDone: (saved) => done(saved) });
    }
  }

  function merchantTab(host, n) {
    const m = n.merchant;
    const cat = st().equipment;
    if (!n.roles.includes('mercante')) host.append(el('p', { class: 'small warn-text', text: 'Il ruolo Mercante non è attivo (scheda Generale): la merce resta salvata ma non si vende.' }));
    const lines = el('div', { class: 'row-list' });
    const draw = () => clear(lines).append(...m.stock.map((s, i) => el('div', { class: 'input-row stock-row' },
      el('select', { 'aria-label': 'Oggetto', onchange: (e) => { s.equipmentId = e.target.value; } }, cat.map((e) => opt(e.id, e.name + ' (' + A.formatCost(e.cost) + ')', e.id === s.equipmentId)),
        cat.some((e) => e.id === s.equipmentId) ? null : opt(s.equipmentId, '⚠ oggetto eliminato', true)),
      el('label', { class: 'inline small' }, 'qtà', numberInput(s.qty, { class: 'qty', min: 0, max: 9999, oninput: (e) => { s.qty = Math.max(0, readNumber(e.target) || 0); } })),
      el('label', { class: 'inline small', title: 'Vuoto = costo dell\'Attrezzatura' }, 'prezzo (mo)', numberInput(s.price === null ? '' : s.price / 100, { class: 'qty', min: 0, step: 0.01, placeholder: 'base',
        oninput: (e) => { const v = e.target.value.trim(); s.price = v === '' ? null : Math.round(Number(v) * 100); } })),
      el('label', { class: 'inline small', title: 'Pezzi aggiunti ogni giorno, fino al tetto' }, '+/giorno', numberInput(s.restock, { class: 'qty', min: 0, max: 999, oninput: (e) => { s.restock = Math.max(0, readNumber(e.target) || 0); } })),
      el('label', { class: 'inline small' }, 'tetto', numberInput(s.max, { class: 'qty', min: 0, max: 9999, oninput: (e) => { s.max = Math.max(0, readNumber(e.target) || 0); } })),
      el('label', { class: 'inline small', title: 'Reputazione minima per vederlo in vendita (vuoto = sempre)' }, 'rep. min', numberInput(s.minRep === null ? '' : s.minRep, { class: 'qty', min: -100, max: 100, placeholder: '—',
        oninput: (e) => { const v = e.target.value.trim(); s.minRep = v === '' ? null : Math.max(-100, Math.min(100, Number(v))); } })),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { m.stock.splice(i, 1); draw(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Oggetto in vendita', disabled: !cat.length, onclick: () => { m.stock.push(N.normalizeStockLine({ equipmentId: cat[0].id, qty: 1 })); draw(); } }));
    draw();
    const coins = Object.fromEntries(A.CURRENCIES.map((k) => [k, numberInput(m.coins[k], { class: 'qty', min: 0, max: 10000000, 'aria-label': k, oninput: (e) => { m.coins[k] = Math.max(0, readNumber(e.target) || 0); } })]));
    host.append(el('div', { class: 'panel form' },
      el('fieldset', {}, el('legend', { text: 'Merce in vendita' }), lines),
      el('fieldset', {}, el('legend', { text: 'Monete per comprare dal party' }), el('div', { class: 'input-row' }, A.CURRENCIES.map((k) => el('label', { class: 'inline small' }, k, coins[k])))),
      el('div', { class: 'grid-3 tight' },
        field('Margine di vendita (×)', numberInput(m.sellMargin, { min: 0.1, max: 10, step: 0.05, oninput: (e) => { m.sellMargin = readNumber(e.target) || 1; } }), null, '1 = prezzo del catalogo'),
        field('Margine di acquisto (×)', numberInput(m.buyMargin, { min: 0, max: 5, step: 0.05, oninput: (e) => { m.buyMargin = Math.max(0, readNumber(e.target) || 0); } }), null, 'quanto paga gli oggetti del party'),
        field('CD per contrattare (Persuasione)', numberInput(m.haggleDc, { min: 1, max: 40, oninput: (e) => { m.haggleDc = readNumber(e.target) || 15; } }))),
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: m.buys, onchange: (e) => { m.buys = e.target.checked; } }), ' Compra oggetti dal party'),
      el('p', { class: 'muted small', text: 'Prezzo finale = base × margine × reputazione (es. sopra +50 sconto del 10%) × atteggiamento × contrattazione. Ogni copia piazzata ha merce e monete proprie.' })));
  }

  // Dialogo: nodi (testo e risposte), condizioni ed esiti in blocchi apribili.
  function dialogTab(host, n) {
    const d = n.dialog;
    const w = world();
    const nodeOpts = (value, empty) => [opt('', empty || '— fine del dialogo —', !value)].concat(d.nodes.map((x, i) => opt(x.id, (i + 1) + '. ' + (x.title || x.text.slice(0, 30) || 'nodo'), x.id === value)));
    const redraw = () => render();
    const warnings = N.dialogWarnings(d);
    host.append(el('div', { class: 'panel form dialog-editor' },
      el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Nodo iniziale' }),
        el('select', { onchange: (e) => { d.start = e.target.value; } }, nodeOpts(d.start, '—')),
        el('button', { type: 'button', class: 'btn small', text: '+ Nodo', onclick: () => { d.nodes.push({ id: DnD.dadi.uid(), title: '', text: '', answers: [] }); if (!d.start) d.start = d.nodes[0].id; redraw(); } }),
        el('button', { type: 'button', class: 'btn small', text: '▶ Prova', disabled: !d.nodes.length, onclick: () => dialogRunner(n, null, { test: true }) })),
      warnings.length ? el('ul', { class: 'small warn-text' }, warnings.map((x) => el('li', { text: '⚠ ' + x }))) : null,
      d.nodes.length ? null : el('p', { class: 'muted small', text: 'Nessun nodo. Un nodo ha un testo e delle risposte; ogni risposta può avere condizioni (reputazione, oggetto, variabile, atteggiamento) ed esiti (vai a un nodo, prova, reputazione, apri quest, apri negozio, avvia combattimento, cambia atteggiamento, variabile).' }),
      ...d.nodes.map((node, ni) => el('details', { class: 'dialog-node', open: d.nodes.length <= 3 },
        el('summary', { text: (ni + 1) + '. ' + (node.title || node.text.slice(0, 40) || 'nodo') + (node.id === d.start ? ' ★' : '') + ' · ' + node.answers.length + ' risposte' }),
        el('div', { class: 'grid-2 tight' }, field('Titolo (per il master)', textInput(node.title, { maxlength: 60, oninput: (e) => { node.title = e.target.value; } })),
          el('div', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn small', text: '↑', disabled: ni === 0, onclick: () => { d.nodes.splice(ni - 1, 0, d.nodes.splice(ni, 1)[0]); redraw(); } }),
            el('button', { type: 'button', class: 'btn small danger', text: 'Elimina nodo', onclick: () => { d.nodes.splice(ni, 1); if (d.start === node.id) d.start = d.nodes.length ? d.nodes[0].id : ''; redraw(); } }))),
        field('Testo dell\'NPC', el('textarea', { rows: 3, value: node.text, oninput: (e) => { node.text = e.target.value; } })),
        ...node.answers.map((a, ai) => el('div', { class: 'dialog-answer' },
          el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: '↳' }), textInput(a.text, { maxlength: 300, 'aria-label': 'Risposta', oninput: (e) => { a.text = e.target.value; } }),
            el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli la risposta', onclick: () => { node.answers.splice(ai, 1); redraw(); } })),
          condsEditor(a, w, redraw),
          outcomesEditor(a, w, nodeOpts, redraw))),
        el('button', { type: 'button', class: 'btn small', text: '+ Risposta', onclick: () => { node.answers.push({ id: DnD.dadi.uid(), text: '', conds: [], outcomes: [{ kind: 'fine' }] }); redraw(); } })))));
  }

  function condsEditor(a, w, redraw) {
    const box = el('div', { class: 'cond-list small' }, el('span', { class: 'muted', text: 'Condizioni: ' }));
    a.conds.forEach((c, i) => {
      const kind = el('select', { onchange: (e) => { a.conds[i] = N.normalizeDialog({ nodes: [{ answers: [{ conds: [{ kind: e.target.value }] }] }] }).nodes[0].answers[0].conds[0]; redraw(); } },
        K.DIALOG_CONDS.map((k) => opt(k, K.DIALOG_COND_NAMES[k], k === c.kind)));
      let body;
      if (c.kind === 'reputazione') body = [UM().factionSelect(c.factionId, { empty: '— fazione dell\'NPC —', onchange: (e) => { c.factionId = e.target.value; } }), ' ≥ ', numberInput(c.min, { class: 'qty', min: -100, max: 100, oninput: (e) => { c.min = readNumber(e.target) || 0; } })];
      else if (c.kind === 'oggetto') body = [el('select', { onchange: (e) => { c.equipmentId = e.target.value; } }, opt('', '—', !c.equipmentId), st().equipment.map((x) => opt(x.id, x.name, x.id === c.equipmentId)))];
      else if (c.kind === 'atteggiamento') body = [el('select', { onchange: (e) => { c.attitude = e.target.value; } }, K.ATTITUDES.map((x) => opt(x, K.ATTITUDE_NAMES[x], x === c.attitude)))];
      else body = [textInput(c.name, { class: 'short', placeholder: 'variabile', oninput: (e) => { c.name = e.target.value; } }), el('select', { onchange: (e) => { c.op = e.target.value; } }, DnD.eventi.OPS.map((x) => opt(x, x, x === c.op))),
        textInput(String(c.value), { class: 'short', oninput: (e) => { c.value = e.target.value; } })];
      box.append(el('span', { class: 'cond-chip' }, el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: c.negate, onchange: (e) => { c.negate = e.target.checked; } }), 'non'), kind, ...body,
        el('button', { type: 'button', class: 'icon-btn', text: '✕', 'aria-label': 'Togli la condizione', onclick: () => { a.conds.splice(i, 1); redraw(); } })));
    });
    box.append(el('button', { type: 'button', class: 'btn small', text: '+', title: 'Aggiungi condizione', onclick: () => { a.conds.push({ kind: 'reputazione', factionId: '', min: 0 }); redraw(); } }));
    return box;
  }

  function outcomesEditor(a, w, nodeOpts, redraw) {
    const box = el('div', { class: 'cond-list small' }, el('span', { class: 'muted', text: 'Esiti: ' }));
    a.outcomes.forEach((o, i) => {
      const kind = el('select', { onchange: (e) => { a.outcomes[i] = { kind: e.target.value }; redraw(); } }, K.DIALOG_OUTCOMES.map((k) => opt(k, K.DIALOG_OUTCOME_NAMES[k], k === o.kind)));
      let body = [];
      if (o.kind === 'vai') body = [el('select', { onchange: (e) => { o.to = e.target.value; } }, nodeOpts(o.to))];
      if (o.kind === 'prova') body = [textInput(o.what || 'Persuasione', { class: 'short', list: 'abilita-dialogo', oninput: (e) => { o.what = e.target.value; } }), 'CD', numberInput(o.dc || 12, { class: 'qty', min: 1, max: 40, oninput: (e) => { o.dc = readNumber(e.target) || 12; } }),
        '✓', el('select', { onchange: (e) => { o.success = e.target.value; } }, nodeOpts(o.success)), '✗', el('select', { onchange: (e) => { o.failure = e.target.value; } }, nodeOpts(o.failure))];
      if (o.kind === 'reputazione') body = [UM().factionSelect(o.factionId, { empty: '— fazione dell\'NPC —', onchange: (e) => { o.factionId = e.target.value; } }), numberInput(o.delta === undefined ? 5 : o.delta, { class: 'qty', min: -100, max: 100, oninput: (e) => { o.delta = readNumber(e.target) || 0; } })];
      if (o.kind === 'quest') body = [el('select', { onchange: (e) => { o.questId = e.target.value; } }, opt('', '—', !o.questId), w.quests.map((q) => opt(q.id, q.title, q.id === o.questId)))];
      if (o.kind === 'atteggiamento') body = [el('select', { onchange: (e) => { o.value = e.target.value; } }, K.ATTITUDES.map((x) => opt(x, K.ATTITUDE_NAMES[x], x === (o.value || 'amichevole'))))];
      if (o.kind === 'variabile') body = [textInput(o.name || '', { class: 'short', placeholder: 'variabile', oninput: (e) => { o.name = e.target.value; } }),
        el('select', { onchange: (e) => { o.op = e.target.value; } }, opt('imposta', '=', o.op !== 'incrementa'), opt('incrementa', '+=', o.op === 'incrementa')), textInput(String(o.value === undefined ? '' : o.value), { class: 'short', oninput: (e) => { o.value = e.target.value; } })];
      box.append(el('span', { class: 'cond-chip' }, kind, ...body, el('button', { type: 'button', class: 'icon-btn', text: '✕', 'aria-label': 'Togli l\'esito', onclick: () => { a.outcomes.splice(i, 1); redraw(); } })));
    });
    box.append(el('button', { type: 'button', class: 'btn small', text: '+', title: 'Aggiungi esito', onclick: () => { a.outcomes.push({ kind: 'vai', to: '' }); redraw(); } }),
      el('datalist', { id: 'abilita-dialogo' }, Object.keys(DnD.creatureDati.SKILLS).concat(R.ABILITIES).map((x) => el('option', { value: x }))));
    return box;
  }

  function otherTab(host, n) {
    const w = world();
    const qBox = el('div', { class: 'check-row' }, w.quests.length ? w.quests.map((q) => el('label', { class: 'check small' },
      el('input', { type: 'checkbox', checked: n.questIds.includes(q.id), onchange: (e) => { n.questIds = e.target.checked ? [...new Set(n.questIds.concat(q.id))] : n.questIds.filter((x) => x !== q.id); } }), ' ' + q.title))
      : el('span', { class: 'muted small', text: 'Nessuna quest: creale in Mondo › Quest.' }));
    const grids = DnD.sessioni.visible(st(), 'savedGrids');
    const rBox = el('div', { class: 'row-list' });
    const draw = () => clear(rBox).append(...n.routine.map((r, i) => el('div', { class: 'input-row' },
      el('label', { class: 'inline small' }, 'dalle', numberInput(r.from, { class: 'qty', min: 0, max: 23, oninput: (e) => { r.from = readNumber(e.target) || 0; } })),
      el('label', { class: 'inline small' }, 'alle', numberInput(r.to, { class: 'qty', min: 0, max: 23, oninput: (e) => { r.to = readNumber(e.target) || 0; } })),
      textInput(r.place, { placeholder: 'luogo (es. bottega, taverna)', oninput: (e) => { r.place = e.target.value; } }),
      el('select', { 'aria-label': 'Mappa', onchange: (e) => { r.gridId = e.target.value; } }, opt('', '— nessuna mappa —', !r.gridId), grids.map((g) => opt(g.id, g.name, g.id === r.gridId))),
      el('label', { class: 'inline small' }, 'col.', numberInput(r.x + 1, { class: 'qty', min: 1, max: 100, oninput: (e) => { r.x = (readNumber(e.target) || 1) - 1; } })),
      el('label', { class: 'inline small' }, 'riga', numberInput(r.y + 1, { class: 'qty', min: 1, max: 100, oninput: (e) => { r.y = (readNumber(e.target) || 1) - 1; } })),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { n.routine.splice(i, 1); draw(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Fascia oraria', onclick: () => { n.routine.push({ from: 8, to: 18, gridId: '', x: 0, y: 0, place: '' }); draw(); } }));
    draw();
    host.append(el('div', { class: 'panel form' },
      el('fieldset', {}, el('legend', { text: '📜 Quest offerte (datore di quest)' }), qBox),
      el('fieldset', {}, el('legend', { text: '🕑 Routine (facoltativa)' }), rBox, el('p', { class: 'muted small', text: 'Promemoria: dove si trova a ogni ora del giorno (con l\'esplorazione in corso il pannello NPC mostra la fascia attuale).' }))));
  }

  // ---------- Pannello sulla griglia ----------
  // Info per il disegno della copia (ui-griglia): fazione, ruolo visibile, modello mancante.
  function itemInfo(it) {
    const s = DnD.store && DnD.store.state;
    const npc = s && s.worldNpcs ? s.worldNpcs.find((x) => x.id === it.npcId) : null;
    if (!npc) return { faction: null, missing: true, roleIcon: '' };
    const fid = N.factionOf(npc, it.npcState, s.cities);
    return { faction: s.factions.find((f) => f.id === fid) || null, missing: false, roleIcon: npc.hiddenRole ? '' : npc.roles.filter((r) => r !== 'informatore').map((r) => K.ROLE_ICONS[r]).join('') };
  }

  // Contesto comune di una copia: modello, stato, fazione, reputazione e atteggiamento (con il giocatore che parla).
  function contextOf(it, playerId) {
    const w = world();
    const npc = npcById(it.npcId);
    if (!npc) return null;
    const state = it.npcState;
    const factionId = N.factionOf(npc, state, w.cities);
    const party = DnD.party.active(w.parties, w.world);
    const rep = F.reputationOf(w.world, party, factionId, playerId);
    return { w, npc, state, factionId, party, rep, attitude: N.attitudeOf(npc, state, rep) };
  }

  // ctx: { getItem(), update(fn(item, st)), log(text), combat: { attack(itemId), join(itemId) } (nel combattimento) }
  function openPanel(ctx) {
    const body = el('div', { class: 'npc-panel' });
    let dialog = null;
    const draw = () => {
      const it = ctx.getItem();
      if (!it) { if (dialog) dialog.dismiss(); return; }
      const c = contextOf(it);
      if (!c) {
        clear(body).append(el('p', { class: 'warn-text', text: '⚠ Il modello di questo NPC è stato eliminato: la copia resta come segnaposto.' }));
        return;
      }
      const { npc, state } = c;
      const b = (text, onclick, disabled, cls, title) => el('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text, onclick, disabled, title });
      const hour = DnD.sessioni.current(st()).exploration ? DnD.sessioni.current(st()).exploration.time.hour : null;
      const routine = hour !== null ? N.routineAt(npc, hour) : null;
      const hp = state.hp === null ? (npc.base === 'creatura' ? DnD.creature.hpInfo(npc.stats).total : npc.stats.maxHp) : state.hp;
      clear(body).append(
        el('div', { class: 'npc-head' }, DnD.icone.iconCanvas(npc.stats.icon, 40), el('div', {},
          el('b', { text: npc.name }), npc.title ? el('span', { class: 'muted small', text: ' · ' + npc.title }) : null,
          el('div', { class: 'small' }, UM().factionBadge(c.factionId), ' ', el('span', { class: 'tag att-' + c.attitude, text: K.ATTITUDE_NAMES[c.attitude] }),
            state.hostile ? el('span', { class: 'tag danger', text: '⚔ ostile' }) : null, state.dead ? el('span', { class: 'tag', text: '✝ morto' }) : null,
            ' ', npc.roles.map((r) => el('span', { class: 'tag', text: K.ROLE_ICONS[r] + ' ' + K.ROLE_NAMES[r] }))),
          el('div', { class: 'muted small', text: 'PF ' + hp + ' · CA ' + npc.stats.ac + ' · reputazione del party con la fazione: ' + c.rep + (routine ? ' · ora: ' + (routine.place || 'in giro') : '') }))),
        el('div', { class: 'head-actions npc-actions' },
          b('💬 Parla', () => dialogRunner(npc, ctx), !npc.dialog.nodes.length || state.dead, '', npc.dialog.nodes.length ? '' : 'Nessun dialogo: scrivilo in Mondo › NPC › Dialogo'),
          npc.roles.includes('mercante') ? b('🪙 Commercia', () => tradeWindow(ctx), state.dead || state.hostile) : null,
          npc.roles.includes('quest') || npc.questIds.length ? b('📜 Quest', () => questsOf(npc, ctx)) : null,
          b('⚔ Attacca', () => attack(ctx), state.dead, 'danger'),
          ctx.combat && !state.hostile && !state.dead ? b('↪ Entra nell\'iniziativa', () => { ctx.combat.join(it.id); if (dialog) dialog.dismiss(); }, false, '', 'Lo include subito nel combattimento, ancora neutrale') : null,
          b('📄 Scheda', () => sheet(npc)),
          b('⚑ Fazione e stato…', () => factionDialog(ctx, draw))),
        npc.notes ? el('details', {}, el('summary', { text: 'Note del master' }), el('p', { class: 'small', text: npc.notes })) : '');
    };
    draw();
    const it = ctx.getItem();
    dialog = openDialog('👤 ' + (it ? it.name : 'NPC'), body, [{ text: 'Chiudi' }]);
    ctx.redraw = draw;
  }

  function sheet(npc) {
    let node;
    if (npc.base === 'creatura') node = DnD.uiMostri.statblock(npc.stats);
    else {
      const stats = DnD.statistiche.derivedStats(npc.stats, st().races.find((r) => r.id === npc.stats.raceId), st().equipment);
      node = el('div', { class: 'small' },
        el('p', { text: [DnD.ui.raceName(npc.stats.raceId), DnD.classi.className(npc.stats.classId), 'liv. ' + npc.stats.level].filter(Boolean).join(' · ') }),
        el('p', { text: 'PF ' + npc.stats.maxHp + ' · CA ' + stats.ac.total }),
        el('div', { class: 'stat-line' }, R.ABILITIES.map((ab) => el('span', { class: 'stat' }, el('b', { text: ab }), ' ' + stats.abilities[ab]))),
        stats.weapons.length ? el('ul', {}, stats.weapons.map((w) => el('li', { text: DnD.uiCreature.weaponLabel(w) }))) : null);
    }
    openDialog('Scheda di ' + npc.name, node, [{ text: 'Chiudi' }]).classList.add('wide');
  }

  // Fazione della copia, atteggiamento, rivelazioni per i giocatori, Calma (prova), anteprima della vista giocatori.
  function factionDialog(ctx, redraw) {
    const it = ctx.getItem();
    const c = contextOf(it);
    if (!c) return;
    const { npc, state } = c;
    const fs = UM().factionSelect(state.factionId, { empty: '— del modello (' + ((world().factions.find((f) => f.id === N.factionOf(npc, null, world().cities)) || {}).name || '?') + ') —' });
    const att = el('select', {}, opt('', '— del modello (' + K.ATTITUDE_NAMES[npc.attitude] + ') —', !state.attitude), K.ATTITUDES.map((a) => opt(a, K.ATTITUDE_NAMES[a], a === state.attitude)));
    const rev = (k, label) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: state.revealed[k], 'data-k': k }), ' ' + label);
    const reveal = el('div', { class: 'check-row' }, rev('name', 'nome'), rev('role', 'ruolo'), rev('attitude', 'atteggiamento'));
    const who = el('select', {}, players().map((p) => opt(p.id, p.name)));
    const preview = el('pre', { class: 'small player-view', text: JSON.stringify(N.statoNpcPerGiocatore(npc, state, { attitude: c.attitude }), null, 1) });
    const body = el('div', { class: 'form' },
      el('div', { class: 'grid-2 tight' }, field('Fazione di questa copia', fs), field('Atteggiamento', att)),
      el('fieldset', {}, el('legend', { text: 'Rivelato ai giocatori' }), reveal),
      state.hostile || (state.hostileTo && state.hostileTo.length) ? el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Calma (Persuasione, CD ' + npc.combat.calmDc + ')' }), who,
        el('button', { type: 'button', class: 'btn small', text: '🕊 Prova a calmarlo', disabled: !players().length, onclick: () => {
          const p = players().find((x) => x.id === who.value);
          const r = R.rollSave({ bonus: DnD.leggendario.checkBonus(p, 'Persuasione', false, st()), mode: 'normale', dc: npc.combat.calmDc }, DnD.dadi.randomInt);
          let text = p.name + ' prova a calmare ' + npc.name + ': Persuasione ' + r.total + ' contro CD ' + npc.combat.calmDc + ' → ' + (r.success ? 'ci riesce, torna neutrale.' : 'non ci riesce.');
          if (r.success) ctx.update((x) => { x.npcState.hostile = false; x.npcState.hostileTo = []; x.npcState.attitude = 'indifferente'; });
          if (r.success && ctx.combat && ctx.combat.calm) text += ' ' + (ctx.combat.calm(it.id) || '');
          ctx.log(text);
          toast(text);
          dlg.dismiss();
          redraw();
        } })) : null,
      el('details', {}, el('summary', { text: 'Anteprima: cosa vedrebbero i giocatori' }), preview));
    const dlg = openDialog('Fazione e stato di ' + npc.name, body, [{ text: 'Annulla' }, { text: 'Applica', class: 'primary', onclick: () => {
      ctx.update((x) => {
        x.npcState.factionId = fs.value;
        x.npcState.attitude = att.value || null;
        for (const inp of reveal.querySelectorAll('input')) x.npcState.revealed[inp.dataset.k] = inp.checked;
      });
      if (fs.value !== state.factionId) ctx.log(npc.name + ': fazione ' + ((world().factions.find((f) => f.id === (fs.value || N.factionOf(npc, null, world().cities))) || {}).name || '?') + '.');
      redraw();
      return undefined;
    } }]);
  }

  // Attacca: nel combattimento la copia diventa un combattente ostile (provocazione); fuori, parte un combattimento.
  function attack(ctx) {
    const it = ctx.getItem();
    const c = contextOf(it);
    if (!c) return;
    if (!confirm('Attaccare ' + c.npc.name + '? Diventa ostile' + (c.npc.combat.penalty ? ' e la reputazione con la sua fazione scende di ' + (-c.npc.combat.penalty) : '') + '.')) return;
    if (ctx.combat) { ctx.combat.attack(it.id); return; }
    startFight(c, ctx);
  }

  // Fuori dal combattimento: nuovo combattimento con il party attivo e l'NPC ostile (o aggiunta a quello in corso).
  function startFight(c, ctx) {
    const s = st();
    const se = DnD.sessioni.current(s);
    const members = DnD.party.members(c.party, players()).list;
    const it = ctx.getItem();
    const npcX = DnD.combattenti.createCombatants([], [{ npc: Object.assign(clone(c.npc.stats), { id: c.npc.id, name: c.npc.name }), quantity: 1 }], s.races, DnD.dadi.randomInt, s.spells, s.equipment)[0];
    Object.assign(npcX, { faction: c.factionId, hostileTo: [c.party ? c.party.factionId : 'giocatori'], npc: N.combatData(c.npc, c.state, '', 'ostile') });
    if (it.npcState.hp !== null) npcX.hp = Math.min(npcX.maxHp, it.npcState.hp);
    ctx.update((x) => { x.npcState.hostile = true; x.npcState.attitude = 'ostile'; });
    if (c.npc.combat.penalty) UM().applyReputation(c.party && c.party.id, c.factionId, c.npc.combat.penalty, 'attacco a ' + c.npc.name, 'combattimento');
    UM().sound('ostile');
    if (se.combat) {
      DnD.store.update((st2) => {
        const cb = DnD.sessioni.current(st2).combat;
        npcX.joinRound = cb.phase === 'attivo' ? cb.round + 1 : 0;
        cb.combatants.push(npcX);
        DnD.dati.pushLog(cb, 'sistema', '⚠ ' + npcX.name + ' diventa ostile ed entra nel combattimento' + (npcX.joinRound ? ' al round ' + npcX.joinRound : '') + '.');
      });
    } else {
      const xs = DnD.combattenti.createCombatants(members, [], s.races, DnD.dadi.randomInt, s.spells, s.equipment);
      const ctxF = { parties: world().parties, cities: world().cities, factions: world().factions };
      for (const x of xs) x.faction = F.defaultFactionFor(members.find((m) => m.id === x.sourceId), 'player', ctxF);
      DnD.store.update((st2) => {
        DnD.sessioni.current(st2).combat = {
          id: DnD.dadi.uid(), phase: 'iniziativa', round: 1, currentId: null, combatants: xs.concat(npcX), log: [],
          ai: { simulated: false, mode: 'passo', delay: 1, seed: DnD.dadi.randomInt(2147483646) },
          grid: Object.assign({ structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false, sourceGridId: null }, DnD.griglia.gridProps({})),
        };
      });
    }
    ctx.log('⚔ Il party attacca ' + c.npc.name + '.');
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    DnD.app.navigate('combattimento');
  }

  // ---------- Quest dell'NPC ----------
  function questsOf(npc, ctx) {
    const w = world();
    const qs = w.quests.filter((q) => npc.questIds.includes(q.id) || q.giver.npcId === npc.id);
    const body = el('div', { class: 'form' });
    const draw = () => clear(body).append(qs.length ? el('ul', { class: 'pick-list' }, qs.map((q) => {
      const s = DnD.quest.statusOf(world().world.quests, q.id);
      return el('li', {}, el('b', { text: q.title }), ' ', el('span', { class: 'tag q-' + s, text: K.QUEST_STATE_NAMES[s] }), ' ',
        s === 'disponibile' ? el('button', { type: 'button', class: 'btn small primary', text: 'Offri…', onclick: () => DnD.uiQuest.offerDialog(q, npc, () => { draw(); if (ctx.redraw) ctx.redraw(); }) }) : null,
        s === 'attiva' ? el('button', { type: 'button', class: 'btn small', text: 'Consegna…', onclick: () => DnD.uiQuest.completeDialog(q, () => {
          ctx.update((x) => { x.npcState.delivered = [...new Set(x.npcState.delivered.concat(q.id))]; });
          draw();
        }) }) : null);
    })) : el('p', { class: 'muted small', text: 'Nessuna quest collegata.' }));
    draw();
    openDialog('📜 Quest di ' + npc.name, body, [{ text: 'Chiudi' }]);
  }

  // ---------- Dialogo giocabile ----------
  // opts.test: prova dall'editor (nessun effetto sullo stato, gli esiti si elencano soltanto).
  function dialogRunner(npc, ctx, opts) {
    const o = opts || {};
    const d = npc.dialog;
    if (!d.nodes.length) return;
    const who = el('select', { 'aria-label': 'Chi parla' }, players().map((p) => opt(p.id, p.name)));
    const transcript = el('div', { class: 'dialog-transcript' });
    const answersBox = el('div', { class: 'dialog-answers' });
    let nodeId = d.start;
    const line = (text, cls) => { transcript.append(el('p', { class: cls || '', text })); transcript.scrollTop = transcript.scrollHeight; };
    const session = () => DnD.sessioni.current(st());
    const vars = () => F.variables(session());
    // Avanzamento delle quest «Parla con».
    if (!o.test) {
      const lines = [];
      UM().update((s, v) => { lines.push(...DnD.quest.onTalk(v.world.quests, v.quests, npc.id)); });
      for (const l of lines) { line(l, 'muted small'); if (ctx) ctx.log(l); }
    }
    const condCtx = () => {
      const it = ctx ? ctx.getItem() : null;
      const c = it ? contextOf(it, who.value) : null;
      const p = players().find((x) => x.id === who.value);
      const party = DnD.party.active(world().parties, world().world);
      const fidDefault = c ? c.factionId : N.factionOf(npc, null, world().cities);
      return {
        rep: (fid) => F.reputationOf(world().world, party, fid || fidDefault, who.value),
        hasItem: (id) => Boolean(p && p.inventory.some((x) => x.equipmentId === id && x.qty > 0)) || Boolean(party && party.inventory.some((x) => x.equipmentId === id && x.qty > 0)),
        variable: (name) => vars()[name],
        attitude: c ? c.attitude : npc.attitude,
        bonus: (what) => (p ? DnD.leggendario.checkBonus(p, what, false, st()) : 0),
        factionId: fidDefault,
      };
    };
    function show() {
      const node = N.nodeOf(d, nodeId);
      clear(answersBox);
      if (!node) { line('— Fine del dialogo —', 'muted'); return; }
      line(npc.name + ': ' + DnD.eventi.interpolate(node.text, vars()), 'npc-line');
      const cc = condCtx();
      const avail = N.answersFor(node, cc);
      if (!avail.length) { line('(nessuna risposta disponibile)', 'muted small'); answersBox.append(el('button', { type: 'button', class: 'btn', text: 'Chiudi', onclick: () => dlg.dismiss() })); return; }
      answersBox.append(...avail.map((a) => el('button', { type: 'button', class: 'btn dialog-choice', text: a.text, onclick: () => pick(a) })));
    }
    function pick(a) {
      const cc = condCtx();
      line('➜ ' + (players().find((p) => p.id === who.value) || { name: 'Il party' }).name + ': ' + a.text, 'player-line');
      const r = N.choose(d, a, cc, DnD.dadi.randomInt);
      for (const l of r.lines) line(l, 'muted small');
      for (const e of r.effects) applyEffect(e, cc);
      nodeId = r.next;
      if (ctx && !o.test) ctx.log('💬 ' + npc.name + ' — ' + a.text + (r.lines.length ? ' ' + r.lines.join(' ') : ''));
      show();
    }
    function applyEffect(e, cc) {
      const name = K.DIALOG_OUTCOME_NAMES[e.kind];
      if (o.test) { line('[prova] ' + name + (e.delta ? ' ' + e.delta : '') + (e.value ? ' ' + e.value : ''), 'muted small'); return; }
      if (e.kind === 'reputazione') {
        const party = DnD.party.active(world().parties, world().world);
        const entry = UM().applyReputation(party && party.id, e.factionId || cc.factionId, e.delta, 'dialogo con ' + npc.name, 'dialogo', world().world.perPlayer ? who.value : '');
        if (entry) line('Reputazione ' + (entry.delta > 0 ? '+' : '') + entry.delta + ' (' + entry.after + ').', 'muted small');
      } else if (e.kind === 'atteggiamento' && ctx) {
        ctx.update((x) => { x.npcState.attitude = e.value; });
        line(npc.name + ' ora è ' + K.ATTITUDE_NAMES[e.value].toLowerCase() + '.', 'muted small');
      } else if (e.kind === 'variabile') {
        UM().update((s) => {
          const v = F.variables(DnD.sessioni.current(s));
          if (e.op === 'incrementa') v[e.name] = (Number(v[e.name]) || 0) + (Number(e.value) || 0);
          else v[e.name] = e.value === 'vero' ? true : e.value === 'falso' ? false : e.value;
        });
        line('Variabile «' + e.name + '» = ' + vars()[e.name] + '.', 'muted small');
      } else if (e.kind === 'quest') {
        const q = world().quests.find((x) => x.id === e.questId);
        if (q) DnD.uiQuest.offerDialog(q, npc, () => {});
        else line('⚠ Quest eliminata.', 'warn-text small');
      } else if (e.kind === 'negozio' && ctx) tradeWindow(ctx);
      else if (e.kind === 'combattimento' && ctx) { dlg.dismiss(); attack(ctx); }
    }
    who.addEventListener('change', () => { clear(transcript); nodeId = d.start; show(); });
    const dlg = openDialog((o.test ? '▶ Prova: ' : '💬 ') + npc.name, el('div', { class: 'dialog-runner' },
      players().length ? el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Parla' }), who) : null, transcript, answersBox), [{ text: 'Chiudi' }]);
    dlg.classList.add('wide');
    show();
  }

  // ---------- Finestra di scambio ----------
  function tradeWindow(ctx) {
    const body = el('div', { class: 'trade-window' });
    const cart = { buy: {}, sell: {} };
    const buyerSel = el('select', { 'aria-label': 'Chi compra' });
    const party = () => DnD.party.active(world().parties, world().world);
    const buyers = () => {
      const list = players().map((p) => ({ id: 'p:' + p.id, name: p.name, player: p }));
      const pt = party();
      if (pt && pt.sharedPurse) list.unshift({ id: 'party:' + pt.id, name: '🎒 Borsa comune di «' + pt.name + '»', party: pt });
      return list;
    };
    const buyer = () => buyers().find((b) => b.id === buyerSel.value) || buyers()[0] || null;
    const purseOf = (b) => (b ? (b.player || b.party) : null);
    // Rifornimento: un giorno per giorno di esplorazione passato.
    const exNow = DnD.sessioni.current(st()).exploration;
    if (exNow) ctx.update((x) => { const n = N.restock(x.npcState, exNow.time.day); if (n) ctx.log('🪙 Il mercante si rifornisce (+' + n + ' pezzi).'); });

    const draw = () => {
      const it = ctx.getItem();
      const c = it ? contextOf(it, buyer() && buyer().player ? buyer().player.id : '') : null;
      if (!c) return;
      const keep = buyerSel.value;
      clear(buyerSel).append(...buyers().map((b) => opt(b.id, b.name, b.id === keep)));
      const b = buyer();
      const holder = purseOf(b);
      const pctx = { rep: c.rep, attitude: c.attitude, catalog: st().equipment };
      const rows = N.offer(c.npc, c.state, pctx);
      const cartObj = { buy: Object.entries(cart.buy).filter(([, q]) => q > 0).map(([lineId, qty]) => ({ lineId, qty })), sell: Object.entries(cart.sell).filter(([, q]) => q > 0).map(([equipmentId, qty]) => ({ equipmentId, qty })) };
      const q = holder ? N.quote(c.npc, c.state, cartObj, holder, pctx) : { ok: false, errors: ['Nessun acquirente: crea un giocatore.'], total: 0, buyTotal: 0, sellTotal: 0 };
      const invRows = holder ? Object.values(holder.inventory.reduce((m, x) => { m[x.equipmentId] = m[x.equipmentId] || { equipmentId: x.equipmentId, qty: 0 }; m[x.equipmentId].qty += x.qty; return m; }, {})) : [];
      const factor = F.priceFactor(c.rep);
      const pct = Math.round((c.state.haggle || 0) * 100);
      clear(body).append(
        el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Acquirente' }), buyerSel,
          holder ? el('span', { class: 'small', text: '🪙 ' + A.formatCoins(holder.coins) + ' (' + N.formatCopper(N.toCopper(holder.coins)) + ' in tutto)' }) : null),
        el('p', { class: 'muted small', text: 'Reputazione ' + c.rep + (factor !== 1 ? ' (' + (factor < 1 ? 'sconto ' + Math.round((1 - factor) * 100) + '%' : 'rincaro ' + Math.round((factor - 1) * 100) + '%') + ')' : '') +
          ' · atteggiamento ' + K.ATTITUDE_NAMES[c.attitude].toLowerCase() + (pct ? ' · contrattazione ' + (pct > 0 ? '−' + pct : '+' + (-pct)) + '%' : '') + ' · il mercante ha ' + A.formatCoins(c.state.coins) }),
        el('div', { class: 'grid-2' },
          el('section', {}, el('h3', { text: 'In vendita' }), rows.length ? el('table', { class: 'trade-table small' },
            el('tbody', {}, rows.map((r) => el('tr', { class: r.locked || r.missing ? 'muted' : '' },
              el('td', {}, r.missing ? '⚠ oggetto eliminato' : r.equipment.name, r.locked ? el('span', { class: 'tag', title: 'Serve reputazione ' + r.line.minRep, text: '🔒 rep. ' + r.line.minRep }) : null),
              el('td', { text: '×' + r.line.qty }),
              el('td', { text: N.formatCopper(r.price) }),
              el('td', {}, numberInput(cart.buy[r.line.id] || 0, { class: 'qty', min: 0, max: r.line.qty, disabled: r.locked || r.missing || !r.line.qty, 'aria-label': 'Quantità da comprare',
                onchange: (e) => { cart.buy[r.line.id] = Math.max(0, Math.min(r.line.qty, readNumber(e.target) || 0)); draw(); } })))))) : el('p', { class: 'muted small', text: 'Niente in vendita.' })),
          el('section', {}, el('h3', { text: 'Da vendere' }), !c.npc.merchant.buys ? el('p', { class: 'muted small', text: 'Questo mercante non compra.' }) : invRows.length ? el('table', { class: 'trade-table small' },
            el('tbody', {}, invRows.map((r) => el('tr', {},
              el('td', { text: eqName(r.equipmentId) }), el('td', { text: '×' + r.qty }),
              el('td', { text: N.formatCopper(N.unitBuyPrice(c.npc, c.state, r.equipmentId, pctx)) }),
              el('td', {}, numberInput(cart.sell[r.equipmentId] || 0, { class: 'qty', min: 0, max: r.qty, 'aria-label': 'Quantità da vendere',
                onchange: (e) => { cart.sell[r.equipmentId] = Math.max(0, Math.min(r.qty, readNumber(e.target) || 0)); draw(); } })))))) : el('p', { class: 'muted small', text: 'Inventario vuoto.' }))),
        el('div', { class: 'trade-total' },
          el('span', { text: 'Acquisti ' + N.formatCopper(q.buyTotal) + ' · vendite ' + N.formatCopper(q.sellTotal) + ' · ' }),
          el('b', { text: q.total >= 0 ? 'da pagare: ' + N.formatCopper(q.total) : 'da ricevere: ' + N.formatCopper(-q.total) })),
        q.errors.length && (cartObj.buy.length || cartObj.sell.length) ? el('ul', { class: 'small warn-text' }, q.errors.map((x) => el('li', { text: x }))) : '',
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn', text: '🗣 Contratta (Persuasione)', disabled: !b || !b.player, title: 'Prova di Persuasione contro la CD del mercante: una volta per visita', onclick: () => {
            const p = b.player;
            let res = null;
            ctx.update((x) => { res = N.haggle(c.npc, x.npcState, DnD.leggendario.checkBonus(p, 'Persuasione', false, st()), DnD.dadi.randomInt); });
            const text = p.name + ' contratta con ' + c.npc.name + ': ' + res.text;
            ctx.log('🪙 ' + text);
            toast(text);
            draw();
          } }),
          el('button', { type: 'button', class: 'btn', text: '⟳ Rifornisci (1 giorno)', title: 'Il master fa passare un giorno per la merce', onclick: () => {
            ctx.update((x) => { const n = N.restock(x.npcState, x.npcState.lastRestockDay + 1); ctx.log('🪙 ' + c.npc.name + ' si rifornisce (+' + n + ' pezzi).'); });
            draw();
          } }),
          el('button', { type: 'button', class: 'btn primary', text: 'Conferma scambio', disabled: !q.ok, onclick: () => {
            let text = '';
            try {
              DnD.store.update((s) => {
                const it2 = ctx.getItem();
                const holder2 = b.player ? s.players.find((x) => x.id === b.player.id) : s.parties.find((x) => x.id === b.party.id);
                // Lo stato della copia si aggiorna dentro ctx.update; qui servono i riferimenti allo stesso archivio.
                text = N.checkout(c.npc, it2.npcState, cartObj, holder2, pctx);
              });
            } catch (err) { toast(err.message, 'error'); return; }
            ctx.update(() => {});
            ctx.log('🪙 ' + b.name + ' con ' + c.npc.name + ': ' + text + '.');
            toast('Scambio fatto: ' + text + '.', 'success');
            cart.buy = {};
            cart.sell = {};
            // Obiettivi «Raccogli» delle quest attive: si ricontano gli oggetti posseduti.
            if (DnD.uiQuest) DnD.uiQuest.recountCollect();
            draw();
          } })));
    };
    buyerSel.addEventListener('change', () => { cart.sell = {}; draw(); });
    draw();
    const it = ctx.getItem();
    openDialog('🪙 Bottega di ' + (it ? it.name : ''), body, [{ text: 'Chiudi' }]).classList.add('wide');
  }

  DnD.uiNpc = { render, reset: () => { editing = null; }, openNew, openPanel, itemInfo, dialogRunner, tradeWindow, contextOf };
})(globalThis.DnD = globalThis.DnD || {});
