// Asset › Eventi: libreria dei modelli di evento per l'esplorazione. Elenco con avvisi sui riferimenti
// mancanti, duplica, esporta/importa JSON di un singolo evento, «Prova evento» (simulazione che non modifica
// nulla) e editor a elenco con blocchi apribili: innesco, visibilità, ripetibilità, condizioni e azioni
// (anche annidate: esiti di una prova, righe di una tabella casuale).
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const E = DnD.eventi;
  const X = DnD.esplorazione;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  let root = null;
  let editing = null;
  let query = '';

  const lib = () => DnD.store.state.events;
  const st = () => DnD.store.state;
  const checkWhat = () => DnD.regole.ABILITIES.concat(Object.keys(DnD.creatureDati.SKILLS));
  const triggerText = (e) => E.TRIGGER_NAMES[e.trigger.kind] + (e.trigger.kind === 'tempo' ? ' (' + e.trigger.hours + ' h)' : '');
  const repeatText = (e) => (e.repeat.kind === 'n' ? e.repeat.times + ' volte' : E.REPEAT_NAMES[e.repeat.kind]) + (e.repeat.cooldown ? ', ricarica ' + e.repeat.cooldown + ' h' : '');

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function renderList() {
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
      const f = importInput.files[0];
      importInput.value = '';
      if (f) importOne(f);
    } });
    const shown = lib().filter((e) => !query || e.name.toLowerCase().includes(query.toLowerCase()));
    root.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Eventi' }),
        el('div', { class: 'head-actions' },
          el('input', { type: 'search', placeholder: 'Cerca…', value: query, 'aria-label': 'Cerca un evento', onchange: (e) => { query = e.target.value.trim(); render(); } }),
          el('button', { class: 'btn', text: '⬆ Importa JSON', onclick: () => importInput.click() }), importInput,
          el('button', { class: 'btn primary', text: '+ Nuovo evento', onclick: () => { editing = 'new'; render(); } }))),
      el('p', { class: 'muted small', text: 'Modelli: piazzati su una mappa di esplorazione (Editor griglie › Evento) diventano copie indipendenti con il proprio stato. Libreria comune a tutte le sessioni.' }),
      shown.length ? el('div', { class: 'card-grid' }, shown.map((e) => {
        const miss = E.missingRefs(e, st());
        return el('article', { class: 'card' },
          el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(e.icon, 32), el('h3', { text: e.name }))),
          el('p', { class: 'muted small', text: triggerText(e) + ' · ' + E.VISIBILITY_NAMES[e.visibility.kind] + (e.visibility.kind === 'scoperta' ? ' (CD ' + e.visibility.dc + ')' : '') + ' · ' + repeatText(e) }),
          el('p', { class: 'small', text: e.actions.length + ' azioni' + (e.conditions.length ? ' · ' + e.conditions.length + ' condizioni' : '') + (e.area ? ' · area' : '') }),
          e.description ? el('p', { class: 'muted small', text: e.description }) : null,
          miss.length ? el('p', { class: 'warn-text small', text: '⚠ ' + miss.join('; ') }) : null,
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = e.id; render(); } }),
            el('button', { class: 'btn', text: '▶ Prova evento', onclick: () => testEvent(e) }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(e) }),
            el('button', { class: 'btn', text: 'Esporta', onclick: () => exportOne(e) }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(e) })));
      })) : el('p', { class: 'empty', text: query ? 'Nessun evento per «' + query + '».' : 'Nessun evento.' }));
  }

  function duplicate(e) {
    const copy = Object.assign(clone(e), { id: DnD.dadi.uid(), name: (e.name + ' (copia)').slice(0, 80) });
    DnD.store.update((s) => { s.events.splice(s.events.indexOf(e) + 1, 0, copy); });
    toast('Evento duplicato.');
    render();
  }
  function remove(e) {
    const placed = st().savedGrids.filter((g) => (g.events || []).some((i) => i.templateId === e.id)).map((g) => g.name);
    if (!confirm('Eliminare il modello «' + e.name + '»?' + (placed.length ? '\nLe copie già piazzate (' + placed.join(', ') + ') restano e continuano a funzionare.' : ''))) return;
    DnD.store.update((s) => { s.events = s.events.filter((x) => x.id !== e.id); });
    toast('Evento eliminato.');
    render();
  }
  function exportOne(e) {
    const data = { app: DnD.config.APP_NAME, kind: 'evento', version: DnD.dati.VERSION, exportedAt: new Date().toISOString(), event: e };
    DnD.uiImpostazioni.download(JSON.stringify(data, null, 2), DnD.uiImpostazioni.slug(DnD.config.APP_NAME) + '-evento-' + DnD.uiImpostazioni.slug(e.name) + '.json');
  }
  async function importOne(file) {
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || raw.kind !== 'evento' || !raw.event || typeof raw.event !== 'object') throw new Error('il file non contiene un evento di questa app.');
      const ev = Object.assign(E.normalizeEvent(raw.event), { id: DnD.dadi.uid() });
      DnD.store.update((s) => { s.events.push(ev); });
      const miss = E.missingRefs(ev, st());
      toast('Evento «' + ev.name + '» importato.' + (miss.length ? ' ⚠ ' + miss.join('; ') : ''), miss.length ? 'error' : 'success');
      render();
    } catch (err) {
      toast('Importazione non riuscita: ' + err.message, 'error');
    }
  }

  // Prova evento: simula su copie (archivio, stato dell'esplorazione e griglia), senza modificare nulla.
  function testEvent(ev, overrides) {
    const s = clone(st());
    const sess = DnD.sessioni.current(s);
    const players = DnD.sessioni.visible(s, 'players');
    let ex = sess.exploration;
    let grid = ex ? s.savedGrids.find((g) => g.id === ex.gridId) : null;
    if (!grid) grid = Object.assign({ id: 'prova', name: 'Mappa di prova', structures: [], items: [], labels: [], zones: [] }, DnD.dati.normalizeSavedGrid({ kind: 'esplorazione', w: 20, h: 20 }));
    if (!ex) ex = X.create(grid, players, 1);
    const w = { st: s, ex, grid };
    const before = ex.log.length;
    const res = X.fireEvent(w, { event: clone(ev) }, overrides || {});
    const lines = ex.log.slice(before).map((l) => el('li', { class: 'log-' + l.kind, text: l.text }));
    const checks = [];
    const findChecks = (list) => { for (const a of list) { if (a.kind === 'prova') { checks.push(a); findChecks(a.success); findChecks(a.failure); } if (a.kind === 'tabella') a.rows.forEach((r) => findChecks(r.actions)); } };
    findChecks(ev.actions);
    const forced = Object.assign({}, overrides || {});
    openDialog('Prova evento: ' + ev.name, el('div', { class: 'form' },
      ev.readText ? el('blockquote', { class: 'event-read', text: ev.readText }) : null,
      ...res.texts.map((t) => el('blockquote', { class: 'event-read', text: t.text })),
      el('ol', { class: 'log' }, lines),
      res.pause ? el('p', { class: 'muted small', text: '⏸ Qui l\'evento prepara un combattimento; le azioni successive riprendono dopo.' }) : null,
      checks.length ? el('fieldset', {}, el('legend', { text: 'Ripeti forzando gli esiti' }), checks.map((a) => el('label', { class: 'inline small' }, a.what + ' CD ' + a.dc + ' ',
        el('select', { onchange: (e) => { if (e.target.value) forced[a.id] = e.target.value; else delete forced[a.id]; } },
          opt('', 'Tiro', !forced[a.id]), opt('successo', 'Successo', forced[a.id] === 'successo'), opt('fallimento', 'Fallimento', forced[a.id] === 'fallimento'))))) : null,
      el('p', { class: 'muted small', text: 'Simulazione con i giocatori della sessione corrente: mappa, gruppo e schede non cambiano.' })), [
      { text: 'Chiudi' },
      { text: '↻ Ripeti', class: 'primary', onclick: () => { setTimeout(() => testEvent(ev, forced)); } },
    ]).classList.add('wide');
  }

  // ---------- Editor delle azioni (ricorsivo) ----------
  // list: elenco da modificare sul posto; onChange: ridisegna.
  function actionsEditor(list, depth) {
    const box = el('div', { class: 'action-blocks' });
    const s = st();
    const npcs = DnD.sessioni.visible(s, 'npcs');
    const grids = DnD.sessioni.visible(s, 'savedGrids');
    const draw = () => {
      clear(box).append(...list.map((a, i) => block(a, i)), el('div', { class: 'input-row' },
        el('select', { 'aria-label': 'Nuova azione', class: 'new-action' }, E.ACTIONS.map((k) => opt(k, E.ACTION_NAMES[k], k === 'testo'))),
        el('button', { type: 'button', class: 'btn small', text: '+ Aggiungi azione', onclick: (e) => {
          const kind = e.target.parentNode.querySelector('.new-action').value;
          list.push(E.normalizeAction({ kind }, depth));
          draw();
        } })));
    };
    const missingOpt = (id, listOf) => (id && !listOf.some((x) => x.id === id) ? opt(id, '⚠ elemento eliminato', true) : null);
    const gridSel = (a, label) => el('select', { 'aria-label': label, onchange: (e) => { a.gridId = e.target.value; } },
      opt('', label === 'Griglia di battaglia' ? '— griglia vuota (dal bioma) —' : '— scegli —', !a.gridId), missingOpt(a.gridId, grids),
      grids.map((g) => opt(g.id, g.name + ' (' + (g.kind === 'esplorazione' ? 'esplorazione' : 'battaglia') + ')', g.id === a.gridId)));
    const xy = (o, label) => el('label', { class: 'inline small' }, label + ' x', numberInput(o.x, { class: 'qty', min: 0, max: 99, oninput: (e) => { o.x = readNumber(e.target) || 0; } }),
      'y', numberInput(o.y, { class: 'qty', min: 0, max: 99, oninput: (e) => { o.y = readNumber(e.target) || 0; } }));
    const rewardFields = (r) => el('div', { class: 'input-row' },
      el('label', { class: 'inline small' }, 'PE', numberInput(r.xp, { class: 'qty', min: 0, oninput: (e) => { r.xp = readNumber(e.target) || 0; } })),
      ...E.COINS.map((k) => el('label', { class: 'inline small' }, k, numberInput(r.coins[k], { class: 'qty', min: 0, oninput: (e) => { r.coins[k] = readNumber(e.target) || 0; } }))),
      itemsEditor(r));
    function itemsEditor(r) {
      const b = el('span', { class: 'input-row' });
      const d = () => clear(b).append(...r.items.map((it, j) => el('span', { class: 'input-row' },
        numberInput(it.qty, { class: 'qty', min: 1, oninput: (e) => { it.qty = readNumber(e.target) || 1; } }), '×',
        el('select', { 'aria-label': 'Oggetto', onchange: (e) => { it.equipmentId = e.target.value; } }, missingOpt(it.equipmentId, s.equipment), s.equipment.map((x) => opt(x.id, x.name, x.id === it.equipmentId))),
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { r.items.splice(j, 1); d(); } }))),
        el('button', { type: 'button', class: 'btn small', text: '+ Oggetto', onclick: () => { if (s.equipment.length) { r.items.push({ equipmentId: s.equipment[0].id, qty: 1 }); d(); } } }));
      d();
      return b;
    }
    function fieldsOf(a) {
      const set = (k, f) => (e) => { a[k] = f ? f(e.target) : e.target.value; };
      switch (a.kind) {
        case 'testo': {
          const rw = el('input', { type: 'checkbox', checked: Boolean(a.reward), onchange: (e) => { a.reward = e.target.checked ? E.normalizeReward({}) : null; draw(); } });
          return [el('textarea', { rows: 3, value: a.text, placeholder: 'Testo da leggere ai giocatori (le variabili tra graffe: {nome})', oninput: set('text') }),
            el('label', { class: 'check small' }, rw, ' Con ricompensa'), a.reward ? rewardFields(a.reward) : null];
        }
        case 'nota': return [textInput(a.text, { placeholder: 'Riga del registro', oninput: set('text') }),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: a.toNotes, onchange: (e) => { a.toNotes = e.target.checked; } }), ' Anche nelle note del master')];
        case 'prova': return [
          el('div', { class: 'input-row' },
            el('select', { 'aria-label': 'Prova', onchange: set('what') }, checkWhat().map((x) => opt(x, x, x === a.what))),
            el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: a.save, onchange: (e) => { a.save = e.target.checked; } }), ' tiro salvezza'),
            el('label', { class: 'inline small' }, 'CD', numberInput(a.dc, { class: 'qty', min: 1, max: 40, oninput: set('dc', (t) => readNumber(t) || 10) })),
            el('select', { 'aria-label': 'Chi tira', onchange: (e) => { a.who = e.target.value; draw(); } }, E.WHO.map((k) => opt(k, E.WHO_NAMES[k], k === a.who))),
            a.who === 'scelto' ? el('select', { 'aria-label': 'Personaggio', onchange: set('memberId') }, opt('', '— primo del gruppo —', !a.memberId),
              DnD.sessioni.visible(s, 'players').map((p) => opt(p.id, p.name, p.id === a.memberId))) : null,
            el('select', { 'aria-label': 'Modalità', onchange: set('mode') }, ['normale', 'vantaggio', 'svantaggio'].map((m) => opt(m, m[0].toUpperCase() + m.slice(1), m === a.mode))),
            a.who === 'gruppo' ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: a.group, onchange: (e) => { a.group = e.target.checked; } }), ' prova di gruppo (basta metà)') : null),
          el('details', { class: 'branch ok', open: true }, el('summary', { text: '✓ Se riesce (' + a.success.length + ')' }), actionsEditor(a.success, depth + 1)),
          el('details', { class: 'branch ko', open: true }, el('summary', { text: '✗ Se fallisce (' + a.failure.length + ')' }), actionsEditor(a.failure, depth + 1))];
        case 'combattimento': {
          const foes = el('div', { class: 'row-list' });
          const df = () => clear(foes).append(...a.foes.map((f, j) => el('div', { class: 'input-row' },
            textInput(f.qty, { class: 'qty', 'aria-label': 'Quantità (anche dadi)', oninput: (e) => { f.qty = e.target.value.trim(); } }), '×',
            el('select', { 'aria-label': 'Creatura', onchange: (e) => { f.npcId = e.target.value; } }, missingOpt(f.npcId, npcs),
              npcs.map((n) => opt(n.id, (n.type === 'boss' ? '👑 ' : '') + n.name, n.id === f.npcId))),
            el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { a.foes.splice(j, 1); df(); } }))),
          el('button', { type: 'button', class: 'btn small', text: '+ Creatura o boss', onclick: () => { if (npcs.length) { a.foes.push({ npcId: npcs[0].id, qty: '1' }); df(); } else toast('Nessun nemico nella sessione.', 'error'); } }));
          df();
          return [foes, el('div', { class: 'input-row' }, el('span', { class: 'muted small', text: 'Griglia' }), gridSel(a, 'Griglia di battaglia'),
            el('select', { 'aria-label': 'Avvio', onchange: set('start') }, opt('prepara', 'Prepara (iniziativa da tirare)', a.start === 'prepara'), opt('avvia', 'Avvia ora', a.start === 'avvia'))),
            el('p', { class: 'muted small', text: 'I giocatori partono dalla zona giocatori, le creature dalla zona nemici. Al termine si registra l\'esito (vittoria, fuga, sconfitta) nella variabile «esito combattimento» e si prosegue.' })];
        }
        case 'mappa': return [el('div', { class: 'input-row' }, gridSel(a, 'Mappa'), xy(a.entry, 'entrata'))];
        case 'danno': return [el('div', { class: 'input-row' },
          el('select', { 'aria-label': 'Danno o cura', onchange: (e) => { a.heal = e.target.value === 'cura'; draw(); } }, opt('danno', 'Danno', !a.heal), opt('cura', 'Cura', a.heal)),
          textInput(a.dice, { class: 'qty', 'aria-label': 'Dadi', oninput: set('dice') }),
          a.heal ? null : el('select', { 'aria-label': 'Tipo', onchange: set('type') }, opt('', '— tipo —', !a.type), DnD.creatureDati.DAMAGE_TYPES.map((t) => opt(t, t, t === a.type))),
          el('select', { 'aria-label': 'Bersagli', onchange: (e) => { a.targets = e.target.value; draw(); } }, opt('gruppo', 'Tutto il gruppo', a.targets === 'gruppo'), opt('scelto', 'Un personaggio', a.targets === 'scelto')),
          a.targets === 'scelto' ? el('select', { 'aria-label': 'Personaggio', onchange: set('memberId') }, DnD.sessioni.visible(s, 'players').map((p) => opt(p.id, p.name, p.id === a.memberId))) : null),
          a.heal ? null : el('div', { class: 'input-row' },
            el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: Boolean(a.save), onchange: (e) => { a.save = e.target.checked ? { what: 'DES', dc: 12, half: true } : null; draw(); } }), ' tiro salvezza'),
            a.save ? [el('select', { 'aria-label': 'Caratteristica', onchange: (e) => { a.save.what = e.target.value; } }, DnD.regole.ABILITIES.map((x) => opt(x, x, x === a.save.what))),
              el('label', { class: 'inline small' }, 'CD', numberInput(a.save.dc, { class: 'qty', min: 1, max: 40, oninput: (e) => { a.save.dc = readNumber(e.target) || 10; } })),
              el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: a.save.half, onchange: (e) => { a.save.half = e.target.checked; } }), ' metà se riesce')] : null,
            el('select', { 'aria-label': 'Condizione', onchange: set('condition') }, opt('', '— nessuna condizione —', !a.condition), DnD.creatureDati.CONDITIONS.map((c) => opt(c, c, c === a.condition))))];
        case 'ricompensa': {
          const to = el('select', { multiple: true, size: 3, 'aria-label': 'Destinatari', onchange: (e) => { a.to = [...e.target.selectedOptions].map((o) => o.value); } },
            DnD.sessioni.visible(s, 'players').map((p) => opt(p.id, p.name, a.to.includes(p.id))));
          return [rewardFields(a), field('Destinatari (nessuno = tutto il gruppo; PE divisi, monete e oggetti al primo)', to)];
        }
        case 'teletrasporto': return [el('div', { class: 'input-row' }, xy(a.to, 'cella'), el('span', { class: 'muted small', text: 'oppure verso l\'evento' }),
          el('select', { 'aria-label': 'Evento di destinazione', onchange: set('eventId') }, opt('', '— nessuno —', !a.eventId), s.events.map((e) => opt(e.id, e.name, e.id === a.eventId))))];
        case 'ambiente': return [el('div', { class: 'input-row' },
          el('select', { 'aria-label': 'Bioma', onchange: set('biomeId') }, opt('', '— bioma invariato —', !a.biomeId), missingOpt(a.biomeId, s.biomes), s.biomes.map((b) => opt(b.id, b.name, b.id === a.biomeId))),
          el('label', { class: 'inline small' }, 'raggio', numberInput(a.radius, { class: 'qty', min: 0, max: 20, oninput: set('radius', (t) => readNumber(t) || 0) })),
          textInput(a.weather, { placeholder: 'meteo (es. Nebbia)', oninput: set('weather') }),
          el('label', { class: 'inline small' }, 'ora', numberInput(a.hour, { class: 'qty', min: 0, max: 23, placeholder: '—', oninput: (e) => { a.hour = e.target.value === '' ? null : readNumber(e.target); } })))];
        case 'variabile': return [el('div', { class: 'input-row' },
          textInput(a.name, { placeholder: 'nome (es. chiave trovata)', oninput: set('name') }),
          el('select', { 'aria-label': 'Operazione', onchange: set('op') }, opt('imposta', 'Imposta a', a.op === 'imposta'), opt('incrementa', 'Aumenta di', a.op === 'incrementa')),
          textInput(String(a.value), { placeholder: 'valore (numero, testo, vero/falso)', oninput: (e) => { const v = e.target.value.trim(); a.value = v !== '' && Number.isFinite(Number(v)) ? Number(v) : v; } }))];
        case 'tabella': {
          const rows = el('div', { class: 'row-list' });
          const dr = () => clear(rows).append(...a.rows.map((r, j) => el('details', { class: 'branch', open: true },
            el('summary', {}, el('span', { class: 'input-row' },
              numberInput(r.min, { class: 'qty', min: 1, 'aria-label': 'Da', oninput: (e) => { r.min = readNumber(e.target) || 1; } }), '–',
              numberInput(r.max, { class: 'qty', min: 1, 'aria-label': 'A', oninput: (e) => { r.max = readNumber(e.target) || 1; } }),
              textInput(r.label, { placeholder: 'etichetta', oninput: (e) => { r.label = e.target.value; } }),
              el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli la riga', onclick: () => { a.rows.splice(j, 1); dr(); } }))),
            actionsEditor(r.actions, depth + 1))),
          el('button', { type: 'button', class: 'btn small', text: '+ Riga', onclick: () => { const n = a.rows.length + 1; a.rows.push({ min: n, max: n, label: '', actions: [] }); dr(); } }));
          dr();
          return [el('div', { class: 'input-row' }, el('span', { class: 'muted small', text: 'Dado' }), textInput(a.dice, { class: 'qty', oninput: set('dice') })), rows];
        }
        case 'riposo': return [el('select', { 'aria-label': 'Tipo di riposo', onchange: (e) => { a.long = e.target.value === 'lungo'; } }, opt('breve', 'Riposo breve (1 ora)', !a.long), opt('lungo', 'Riposo lungo (8 ore, scorte)', a.long))];
        case 'attiva': return [el('select', { 'aria-label': 'Evento', onchange: set('eventId') }, opt('', '— scegli —', !a.eventId), missingOpt(a.eventId, s.events), s.events.map((e) => opt(e.id, e.name, e.id === a.eventId))),
          el('p', { class: 'muted small', text: 'Sulla mappa si attiva la copia piazzata di quel modello (con il suo stato), altrimenti il modello.' })];
        default: return [];
      }
    }
    function block(a, i) {
      return el('details', { class: 'action-block', open: true },
        el('summary', {}, el('span', { class: 'action-title', text: (i + 1) + '. ' + E.ACTION_NAMES[a.kind] }),
          el('span', { class: 'action-tools' },
            el('button', { type: 'button', class: 'icon-btn', text: '↑', 'aria-label': 'Sposta su', onclick: (e) => { e.preventDefault(); if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } } }),
            el('button', { type: 'button', class: 'icon-btn', text: '↓', 'aria-label': 'Sposta giù', onclick: (e) => { e.preventDefault(); if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); } } }),
            el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Elimina l\'azione', onclick: (e) => { e.preventDefault(); list.splice(i, 1); draw(); } }))),
        el('div', { class: 'action-body' }, ...fieldsOf(a).filter(Boolean)));
    }
    draw();
    return box;
  }

  function conditionsEditor(list) {
    const s = st();
    const box = el('div', { class: 'row-list' });
    const draw = () => clear(box).append(...list.map((c, i) => el('div', { class: 'input-row row-item' },
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: c.negate, onchange: (e) => { c.negate = e.target.checked; } }), ' NON'),
      el('select', { 'aria-label': 'Condizione', onchange: (e) => { list[i] = E.normalizeCondition({ kind: e.target.value }); draw(); } }, E.COND_KINDS.map((k) => opt(k, E.COND_NAMES[k], k === c.kind))),
      c.kind === 'bioma' ? el('select', { 'aria-label': 'Bioma', onchange: (e) => { c.biomeId = e.target.value; } }, s.biomes.map((b) => opt(b.id, b.name, b.id === c.biomeId))) : null,
      c.kind === 'ora' ? el('label', { class: 'inline small' }, 'dalle', numberInput(c.from, { class: 'qty', min: 0, max: 23, oninput: (e) => { c.from = readNumber(e.target) || 0; } }),
        'alle', numberInput(c.to, { class: 'qty', min: 0, max: 23, oninput: (e) => { c.to = readNumber(e.target) || 0; } })) : null,
      c.kind === 'meteo' ? textInput(c.weather, { placeholder: 'es. Nebbia', oninput: (e) => { c.weather = e.target.value; } }) : null,
      c.kind === 'oggetto' ? el('select', { 'aria-label': 'Oggetto', onchange: (e) => { c.equipmentId = e.target.value; } }, s.equipment.map((x) => opt(x.id, x.name, x.id === c.equipmentId))) : null,
      c.kind === 'variabile' ? [textInput(c.name, { placeholder: 'variabile', oninput: (e) => { c.name = e.target.value; } }),
        el('select', { 'aria-label': 'Confronto', onchange: (e) => { c.op = e.target.value; } }, E.OPS.map((o) => opt(o, o, o === c.op))),
        textInput(String(c.value), { placeholder: 'valore', oninput: (e) => { c.value = e.target.value; } })] : null,
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { list.splice(i, 1); draw(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Condizione', onclick: () => { list.push(E.normalizeCondition({})); draw(); } }));
    draw();
    return box;
  }

  // ---------- Form ----------
  // Usato anche dall'Editor griglie per modificare una copia piazzata (opts.onSave, opts.title).
  function eventForm(host, ev, opts) {
    const e = clone(ev);
    const errorTop = el('div', { class: 'error', 'aria-live': 'polite' });
    const icon = DnD.uiIcone.iconPicker(e.icon, false, 'Icona sulla mappa');
    const name = textInput(e.name, { maxlength: 80, 'data-key': 'name' });
    const vis = el('div', {});
    const drawVis = () => clear(vis).append(el('div', { class: 'input-row' },
      el('select', { 'aria-label': 'Visibilità', onchange: (x) => { e.visibility.kind = x.target.value; drawVis(); } }, E.VISIBILITY.map((k) => opt(k, E.VISIBILITY_NAMES[k], k === e.visibility.kind))),
      e.visibility.kind === 'scoperta' ? [el('select', { 'aria-label': 'Abilità', onchange: (x) => { e.visibility.skill = x.target.value; } }, ['Percezione', 'Indagare'].map((k) => opt(k, k, k === e.visibility.skill))),
        el('label', { class: 'inline small' }, 'CD', numberInput(e.visibility.dc, { class: 'qty', min: 1, max: 40, oninput: (x) => { e.visibility.dc = readNumber(x.target) || 10; } })),
        el('select', { 'aria-label': 'Chi tira', onchange: (x) => { e.visibility.who = x.target.value; } }, opt('migliore', 'Il migliore', e.visibility.who === 'migliore'), opt('gruppo', 'Tutto il gruppo', e.visibility.who === 'gruppo'))] : null));
    drawVis();
    const trig = el('div', {});
    const drawTrig = () => clear(trig).append(el('div', { class: 'input-row' },
      el('select', { 'aria-label': 'Innesco', onchange: (x) => { e.trigger.kind = x.target.value; drawTrig(); } }, E.TRIGGERS.map((k) => opt(k, E.TRIGGER_NAMES[k], k === e.trigger.kind))),
      e.trigger.kind === 'tempo' ? el('label', { class: 'inline small' }, 'dopo', numberInput(e.trigger.hours, { class: 'qty', min: 0.5, step: 0.5, oninput: (x) => { e.trigger.hours = readNumber(x.target) || 1; } }), 'ore') : null,
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: e.area, onchange: (x) => { e.area = x.target.checked; } }), ' Area (più celle, anche non contigue)')));
    drawTrig();
    const rep = el('div', {});
    const drawRep = () => clear(rep).append(el('div', { class: 'input-row' },
      el('select', { 'aria-label': 'Ripetibilità', onchange: (x) => { e.repeat.kind = x.target.value; drawRep(); } }, E.REPEATS.map((k) => opt(k, E.REPEAT_NAMES[k], k === e.repeat.kind))),
      e.repeat.kind === 'n' ? el('label', { class: 'inline small' }, 'N', numberInput(e.repeat.times, { class: 'qty', min: 1, oninput: (x) => { e.repeat.times = readNumber(x.target) || 1; } })) : null,
      e.repeat.kind !== 'una' ? el('label', { class: 'inline small' }, 'ricarica', numberInput(e.repeat.cooldown, { class: 'qty', min: 0, oninput: (x) => { e.repeat.cooldown = readNumber(x.target) || 0; } }), 'ore') : null));
    drawRep();

    const save = () => {
      e.name = name.value.trim();
      if (!e.name) { errorTop.textContent = 'Il nome è obbligatorio.'; name.focus(); return; }
      const r = icon.read();
      if (r.error) { errorTop.textContent = r.error; return; }
      e.icon = r.icon;
      opts.onSave(E.normalizeEvent(e));
    };
    host.append(el('div', { class: 'section-head' }, el('h2', { text: opts.title })),
      el('form', { class: 'panel form event-form', novalidate: true, onsubmit: (x) => { x.preventDefault(); save(); } },
        el('div', { class: 'grid-2' }, field('Nome', name, 'name'), icon.node),
        field('Descrizione', el('textarea', { rows: 2, value: e.description, oninput: (x) => { e.description = x.target.value; } })),
        field('Testo da leggere ai giocatori', el('textarea', { rows: 3, value: e.readText, oninput: (x) => { e.readText = x.target.value; } })),
        field('Note del master', el('textarea', { rows: 2, value: e.notes, oninput: (x) => { e.notes = x.target.value; } })),
        el('fieldset', {}, el('legend', { text: 'Innesco e forma' }), trig),
        el('fieldset', {}, el('legend', { text: 'Visibilità' }), vis),
        el('fieldset', {}, el('legend', { text: 'Ripetibilità' }), rep),
        el('fieldset', {}, el('legend', { text: 'Condizioni (tutte vere)' }), conditionsEditor(e.conditions)),
        el('fieldset', {}, el('legend', { text: 'Azioni (in ordine)' }), actionsEditor(e.actions, 0)),
        errorTop,
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: opts.onCancel }),
          el('button', { type: 'button', class: 'btn', text: '▶ Prova evento', onclick: () => testEvent(E.normalizeEvent(e)) }),
          el('button', { type: 'submit', class: 'btn primary', text: opts.saveText || 'Salva evento' }))));
    name.focus();
  }

  function renderForm() {
    const existing = editing !== 'new' ? lib().find((x) => x.id === editing) : null;
    eventForm(root, existing || E.normalizeEvent({ name: '' }), {
      title: existing ? 'Modifica evento' : 'Nuovo evento',
      onCancel: () => { editing = null; render(); },
      onSave: (ev) => {
        DnD.store.update((s) => {
          const i = s.events.findIndex((x) => x.id === ev.id);
          if (i >= 0) s.events[i] = ev; else s.events.push(ev);
        });
        toast('Evento «' + ev.name + '» salvato.', 'success');
        editing = null;
        render();
      },
    });
  }

  DnD.schede = DnD.schede || {};
  DnD.schede.eventi = { title: 'Eventi', render, reset: () => { editing = null; } };
  DnD.uiEventi = { eventForm, testEvent, actionsEditor };
})(globalThis.DnD = globalThis.DnD || {});
