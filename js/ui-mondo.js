// Sezione «Mondo»: schede Fazioni (elenco, form, relazioni a matrice o a elenco, simmetria), Città (Crea città
// rapido, form, atteggiamento verso il party, contenuti, segnaposto sulla mappa di esplorazione), NPC (ui-npc.js)
// e Quest (ui-quest.js). Fazioni, città, NPC e quest sono librerie della sessione, condivisibili con tutte.
// Componenti comuni: selettore di fazione, distintivo, campi «Mondo» dei form dei personaggi, barra della reputazione.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const F = DnD.fazioni;
  const K = DnD.mondoDati;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const TABS = [{ id: 'fazioni', label: 'Fazioni' }, { id: 'citta', label: 'Città' }, { id: 'npc', label: 'NPC' }, { id: 'quest', label: 'Quest' }];
  const TAB_KEY = 'dnd-battaglie:scheda-mondo';
  const VIEW_KEY = 'dnd-battaglie:vista-relazioni';
  let tab = 'fazioni';
  let relView = 'matrice';
  try {
    tab = TABS.some((t) => t.id === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'fazioni';
    relView = localStorage.getItem(VIEW_KEY) === 'elenco' ? 'elenco' : 'matrice';
  } catch (e) { /* preferenza non essenziale */ }
  let root = null;
  let editing = null; // { kind: 'fazione' | 'citta', id | 'new', preset }

  // ---------- Accesso ai dati ----------
  const world = () => F.view(DnD.store.state);
  const sessionId = () => DnD.sessioni.current(DnD.store.state).id;
  const factionById = (id) => world().factions.find((f) => f.id === id) || null;
  const activeParty = () => DnD.party.active(world().parties, world().world);
  const repWith = (factionId) => F.reputationOf(world().world, activeParty(), factionId);
  // Aggiorna lo stato e il mondo della sessione corrente: fn(st, view).
  function update(fn) {
    DnD.store.update((st) => fn(st, F.view(st)));
  }

  // ---------- Componenti comuni ----------
  function factionDot(f, size) {
    return el('span', { class: 'faction-dot', style: 'background:' + (f ? f.color : 'var(--muted)') + (size ? ';width:' + size + 'px;height:' + size + 'px' : ''), 'aria-hidden': 'true' });
  }
  // Distintivo: pallino colorato, icona e nome (tooltip con descrizione). Fazione mancante: avviso.
  function factionBadge(id, opts) {
    const f = factionById(id);
    if (!f) return el('span', { class: 'tag faction-tag missing', title: 'Fazione eliminata: vale Neutrale', text: '⚠ fazione eliminata' });
    return el('span', { class: 'tag faction-tag', title: f.name + (f.description ? ' — ' + f.description : '') }, factionDot(f), ' ', DnD.icone.iconCanvas ? DnD.icone.iconCanvas(f.icon, 16) : '', ' ', (opts && opts.short) ? '' : f.name);
  }
  // Select delle fazioni visibili. opts: { empty: testo dell'opzione vuota, exclude: id }
  function factionSelect(value, opts) {
    const o = opts || {};
    const list = world().factions.filter((f) => f.id !== o.exclude);
    return el('select', { 'aria-label': o.label || 'Fazione', class: o.class || null, onchange: o.onchange || null },
      o.empty ? opt('', o.empty, !value) : null,
      list.map((f) => opt(f.id, f.name, f.id === value)),
      value && !list.some((f) => f.id === value) ? opt(value, '⚠ fazione eliminata', true) : null);
  }
  function citySelect(value, opts) {
    const o = opts || {};
    const list = world().cities;
    return el('select', { 'aria-label': 'Città', onchange: o.onchange || null }, opt('', o.empty || '— nessuna —', !value),
      list.map((c) => opt(c.id, c.name, c.id === value)), value && !list.some((c) => c.id === value) ? opt(value, '⚠ città eliminata', true) : null);
  }

  // Campi «Mondo» dei form di giocatori, nemici, creature e boss. live: aggiorna c subito (monsterForm).
  function worldRefsEditor(c, opts) {
    const o = opts || {};
    const st = { factionId: c.factionId || '', cityId: c.cityId || '' };
    const set = (k, v) => { st[k] = v; if (o.live) c[k] = v; };
    const fs = factionSelect(st.factionId, { empty: o.player ? '— dal party —' : '— predefinita (città o Nemici) —', onchange: (e) => set('factionId', e.target.value) });
    const cs = o.player ? null : citySelect(st.cityId, { onchange: (e) => {
      set('cityId', e.target.value);
      // La fazione della città diventa quella predefinita (modificabile).
      const city = world().cities.find((x) => x.id === e.target.value);
      if (city && !fs.value) { fs.value = city.factionId; set('factionId', city.factionId); }
    } });
    const node = el('fieldset', { class: 'world-refs' }, el('legend', { text: 'Mondo' }),
      el('div', { class: 'grid-2 tight' }, field('Fazione', fs), cs ? field('Città d\'origine', cs) : null),
      el('p', { class: 'muted small', text: o.player ? 'Vuota = la fazione del suo party (di base Giocatori).' : 'Vuota = la fazione della città, altrimenti Nemici. Nel combattimento la fazione decide alleati e ostili.' }));
    return { node, read: () => ({ factionId: st.factionId, cityId: st.cityId }) };
  }

  // Barra della reputazione (-100…+100) con soglia.
  function repBar(value, thresholds) {
    const v = F.repValue(value);
    const t = F.threshold(v, thresholds || world().world.thresholds);
    const pct = (v + 100) / 2;
    return el('div', { class: 'rep-bar', title: v + ' · ' + t.name },
      el('div', { class: 'rep-track' }, el('div', { class: 'rep-mid' }), el('div', { class: 'rep-fill ' + (v >= 0 ? 'pos' : 'neg'), style: v >= 0 ? 'left:50%;width:' + (pct - 50) + '%' : 'left:' + pct + '%;width:' + (50 - pct) + '%' })),
      el('span', { class: 'rep-value small', text: (v > 0 ? '+' : '') + v + ' ' + t.name }));
  }
  function levelTag(level) {
    return el('span', { class: 'tag rel-' + level, text: K.LEVEL_ICONS[level] + ' ' + K.LEVEL_NAMES[level] });
  }

  // ---------- Sezione ----------
  function select(id, focus) {
    tab = id;
    editing = null;
    try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* ignora */ }
    if (DnD.uiNpc) DnD.uiNpc.reset();
    if (DnD.uiQuest) DnD.uiQuest.reset();
    render();
    if (focus) root.querySelector('.tabs [aria-selected="true"]').focus();
  }

  function render(container) {
    root = container || root;
    clear(root);
    root.append(el('div', { class: 'section-head' }, el('h1', { text: 'Mondo' }),
      el('span', { class: 'muted small', text: 'Sessione «' + world().session.name + '» · party attivo: ' + (activeParty() ? activeParty().name : 'nessuno') })),
    DnD.uiAsset.tabBar(TABS, tab, 'Mondo', 'scheda-mondo-', select));
    const panel = el('div', { role: 'tabpanel', id: 'scheda-mondo-pannello', 'aria-labelledby': 'scheda-mondo-' + tab });
    root.append(panel);
    if (tab === 'npc') return DnD.uiNpc.render(panel);
    if (tab === 'quest') return DnD.uiQuest.render(panel);
    if (editing && editing.kind === 'fazione') return factionForm(panel);
    if (editing && editing.kind === 'citta') return cityForm(panel);
    if (tab === 'citta') return cityList(panel);
    return factionList(panel);
  }

  // ---------- Fazioni ----------
  function factionList(host) {
    const w = world();
    host.append(el('div', { class: 'section-head' }, el('h2', { text: 'Fazioni' }),
      el('div', { class: 'head-actions' }, el('button', { class: 'btn primary', text: '+ Nuova fazione', onclick: () => { editing = { kind: 'fazione', id: 'new' }; render(); } }))),
    el('p', { class: 'muted small', text: 'Giocatori, Nemici e Neutrali sono predefinite e non si eliminano. Ogni combattente ha una fazione: la relazione tra le fazioni decide chi è alleato, neutrale o ostile.' }),
    el('div', { class: 'card-grid' }, w.factions.map((f) => {
      const rep = repWith(f.id);
      return el('article', { class: 'card faction-card', style: '--faction:' + f.color },
        el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(f.icon, 32), el('h3', { text: f.name }),
          f.builtin ? el('span', { class: 'tag', text: 'Predefinita' }) : null, f.shared && !f.builtin ? el('span', { class: 'tag accent', text: 'Condivisa' }) : null), factionDot(f, 14)),
        f.description ? el('p', { class: 'muted small', text: f.description }) : null,
        activeParty() && f.id !== activeParty().factionId ? el('div', { class: 'small' }, el('span', { class: 'muted', text: 'Reputazione di «' + activeParty().name + '»: ' }), repBar(rep)) : null,
        el('div', { class: 'card-actions' },
          el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = { kind: 'fazione', id: f.id }; render(); } }),
          el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicateFaction(f) }),
          f.builtin ? null : el('button', { class: 'btn danger', text: 'Elimina', onclick: () => removeFaction(f) })));
    })),
    relationsPanel());
  }

  function relationsPanel() {
    const w = world();
    const list = w.factions;
    const sym = w.world.symmetric;
    const setLevel = (a, b, level) => {
      update((st, v) => { F.setRelation(v.factions, a, b, level, v.world.symmetric); });
      render();
    };
    const levelSelect = (a, b) => {
      const level = F.relazione(a.id, b.id, list);
      return el('select', { class: 'rel-select rel-' + level, 'aria-label': a.name + ' verso ' + b.name, onchange: (e) => setLevel(a.id, b.id, e.target.value) },
        K.LEVELS.map((l) => opt(l, K.LEVEL_ICONS[l] + ' ' + K.LEVEL_NAMES[l], l === level)));
    };
    let body;
    if (relView === 'matrice') {
      body = el('div', { class: 'table-scroll' }, el('table', { class: 'relation-matrix' },
        el('thead', {}, el('tr', {}, el('th', { text: 'come vede →' }), list.map((b) => el('th', { scope: 'col' }, factionDot(b), ' ', b.name)))),
        el('tbody', {}, list.map((a) => el('tr', {}, el('th', { scope: 'row' }, factionDot(a), ' ', a.name),
          list.map((b) => el('td', {}, a.id === b.id ? el('span', { class: 'muted small', text: '—' }) : levelSelect(a, b))))))));
    } else {
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const ab = F.relazione(a.id, b.id, list);
          const ba = F.relazione(b.id, a.id, list);
          rows.push(el('li', { class: 'relation-row' }, factionDot(a), ' ', el('b', { text: a.name }), ' → ', el('b', { text: b.name }), ': ', levelSelect(a, b),
            !sym || ab !== ba ? el('span', {}, '  ·  ', el('b', { text: b.name }), ' → ', el('b', { text: a.name }), ': ', levelSelect(b, a)) : null));
        }
      }
      body = el('ul', { class: 'relation-list' }, rows);
    }
    const asym = F.asymmetries(list);
    return el('section', { class: 'panel' },
      el('div', { class: 'history-head' }, el('h2', { text: 'Relazioni tra fazioni' }),
        el('div', { class: 'head-actions' },
          DnD.uiAsset.tabBar([{ id: 'matrice', label: 'Matrice' }, { id: 'elenco', label: 'Elenco' }], relView, 'Vista', 'vista-relazioni-', (id) => {
            relView = id;
            try { localStorage.setItem(VIEW_KEY, id); } catch (e) { /* ignora */ }
            render();
          }, true),
          el('label', { class: 'check small', title: 'Cambiando A verso B cambia anche B verso A' },
            el('input', { type: 'checkbox', checked: sym, onchange: (e) => { update((st, v) => { v.world.symmetric = e.target.checked; }); render(); } }), ' Simmetrica'))),
      el('p', { class: 'muted small', text: 'Righe: chi guarda; colonne: verso chi. L\'IA attacca solo Ostile e In guerra, supporta Alleata e Amichevole, ignora Neutrale.' }),
      sym && asym.length ? el('p', { class: 'small warn-text', text: '⚠ ' + asym.length + ' coppie hanno relazioni diverse nei due versi (impostate quando la matrice non era simmetrica).' }) : null,
      body,
      el('div', { class: 'rel-legend' }, K.LEVELS.map(levelTag)));
  }

  function duplicateFaction(f) {
    const copy = Object.assign(clone(f), { id: DnD.dadi.uid(), name: (f.name + ' (copia)').slice(0, 60), builtin: false, shared: false, sessionId: sessionId() });
    update((st, v) => {
      st.factions.push(copy);
      // La copia vede ed è vista dalle altre come l'originale.
      for (const o of v.factions) if (o.relations[f.id]) o.relations[copy.id] = o.relations[f.id];
    });
    toast('Fazione duplicata.');
    render();
  }

  // Elimina una fazione: chi la usava torna alla fazione predefinita (party, città, Nemici o Neutrali).
  function removeFaction(f) {
    const st = DnD.store.state;
    const users = [].concat(st.parties.filter((x) => x.factionId === f.id).map((x) => 'party ' + x.name), st.cities.filter((x) => x.factionId === f.id).map((x) => 'città ' + x.name),
      st.worldNpcs.filter((x) => x.factionId === f.id).map((x) => 'NPC ' + x.name), st.npcs.concat(st.players).filter((x) => x.factionId === f.id).map((x) => x.name));
    if (!confirm('Eliminare la fazione «' + f.name + '»?' + (users.length ? '\nÈ usata da: ' + users.slice(0, 8).join(', ') + (users.length > 8 ? '…' : '') + '\nTorneranno alla fazione predefinita.' : '') + (f.shared ? '\nÈ condivisa: sparirà da tutte le sessioni.' : ''))) return;
    update((s) => {
      s.factions = s.factions.filter((x) => x.id !== f.id);
      for (const o of s.factions) delete o.relations[f.id];
      for (const p of s.parties) if (p.factionId === f.id) p.factionId = 'giocatori';
      for (const c of s.cities) { if (c.factionId === f.id) c.factionId = 'neutrali'; c.presentFactionIds = c.presentFactionIds.filter((x) => x !== f.id); }
      for (const x of s.worldNpcs.concat(s.npcs, s.players)) if (x.factionId === f.id) x.factionId = '';
    });
    toast('Fazione eliminata.');
    render();
  }

  function colorPicker(value, onpick) {
    let cur = value;
    const row = el('div', { class: 'color-row swatch-grid', role: 'group', 'aria-label': 'Colore' });
    const draw = () => clear(row).append(...DnD.colori.PALETTE.map((c) => el('button', {
      type: 'button', class: 'swatch', 'aria-pressed': String(c.hex === cur), title: c.name, 'aria-label': c.name,
      style: 'background:' + c.hex, onclick: () => { cur = c.hex; onpick(cur); draw(); },
    })));
    draw();
    return row;
  }

  function factionForm(host) {
    const existing = editing.id !== 'new' ? factionById(editing.id) : null;
    const f = existing ? clone(existing) : F.normalizeFaction({ name: '', color: '#8e5cc9', sessionId: sessionId() });
    if (!existing) f.name = '';
    const name = textInput(f.name, { maxlength: 60, 'data-key': 'name', placeholder: 'es. Gilda dei mercanti' });
    const icon = DnD.uiIcone.iconPicker(f.icon, false);
    const desc = el('textarea', { rows: 3, value: f.description });
    const notes = el('textarea', { rows: 3, value: f.notes, placeholder: 'Solo per il master' });
    const shared = el('input', { type: 'checkbox', checked: f.shared, disabled: f.builtin });
    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-2' }, field('Nome', name, 'name'), field('Colore (contorno delle pedine)', colorPicker(f.color, (c) => { f.color = c; }))),
      icon.node,
      field('Descrizione', desc),
      field('Note del master', notes),
      el('label', { class: 'check' }, shared, f.builtin ? ' Predefinita: condivisa con tutte le sessioni' : ' Condividi con tutte le sessioni'),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva' })));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ir = icon.read();
      const errors = {};
      if (!name.value.trim()) errors.name = 'Il nome è obbligatorio.';
      if (ir.error) errors.icon = ir.error;
      if (!DnD.ui.showErrors(form, errors)) return;
      const saved = F.normalizeFaction(Object.assign(f, { name: name.value.trim(), icon: ir.icon, description: desc.value, notes: notes.value, shared: shared.checked }));
      update((st) => {
        const i = st.factions.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.factions[i] = saved;
        else st.factions.push(saved);
      });
      toast('Fazione salvata.', 'success');
      editing = null;
      render();
    });
    host.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica fazione' : 'Nuova fazione' })), form);
    name.focus();
  }

  // ---------- Città ----------
  const gridName = (id) => { const g = DnD.store.state.savedGrids.find((x) => x.id === id); return g ? g.name : id ? '⚠ mappa eliminata' : ''; };
  const biomeName = (id) => { const b = (DnD.store.state.biomes || []).find((x) => x.id === id); return b ? b.name : id ? '⚠ bioma eliminato' : ''; };

  function cityList(host) {
    const w = world();
    host.append(el('div', { class: 'section-head' }, el('h2', { text: 'Città' }),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn primary', text: '+ Crea città', onclick: quickCityDialog }))),
    w.cities.length ? el('div', { class: 'card-grid' }, w.cities.map((c) => cityCard(c, w))) : DnD.ui.emptyState('Nessuna città',
      'Una città ha una fazione dominante, NPC, mercanti, quest e regole. L\'atteggiamento verso il party viene dalla reputazione.', [{ text: '+ Crea città', primary: true, onclick: quickCityDialog }]));
  }

  function cityCard(c, w) {
    const rep = repWith(c.factionId);
    const att = DnD.citta.attitude(c, rep);
    const closed = DnD.citta.isClosed(c, rep, w.world.blockHostile);
    const cont = DnD.citta.contents(c, w.npcs, w.quests);
    const missing = DnD.citta.missingRefs(c, DnD.store.state, w);
    const rules = [c.rules.weapons ? '⚔ ' + c.rules.weapons : '', c.rules.curfew ? '🌙 ' + c.rules.curfew : '', c.rules.taxes ? '🪙 ' + c.rules.taxes : ''].filter(Boolean);
    return el('article', { class: 'card city-card' },
      el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(c.icon, 32), el('h3', { text: c.name }),
        el('span', { class: 'tag', text: K.CITY_SIZE_NAMES[c.size] }), c.shared ? el('span', { class: 'tag accent', text: 'Condivisa' }) : null), factionBadge(c.factionId)),
      el('p', { class: 'small' }, el('span', { class: 'tag city-att-' + att.id, text: att.name }), ' ', closed ? el('b', { class: 'danger-text', text: '🚪 Porte chiuse al party' }) : att.text ? el('span', { class: 'muted', text: att.text }) : null),
      el('p', { class: 'muted small', text: [biomeName(c.biomeId), c.gridId ? 'mappa: ' + gridName(c.gridId) : 'nessuna mappa', c.place ? 'sulla mappa ' + gridName(c.place.gridId) + ' in ' + DnD.griglia.cellLabel(c.place.x, c.place.y) : ''].filter(Boolean).join(' · ') }),
      c.presentFactionIds.length ? el('p', { class: 'small' }, el('span', { class: 'muted', text: 'Presenti: ' }), c.presentFactionIds.map((id) => factionBadge(id))) : null,
      rules.length ? el('ul', { class: 'small city-rules' }, rules.map((r) => el('li', { text: r }))) : null,
      el('p', { class: 'small', text: cont.npcs.length + ' NPC · ' + cont.merchants.length + ' mercanti · ' + cont.quests.length + ' quest' }),
      missing.length ? el('p', { class: 'small warn-text', text: '⚠ ' + missing.join(', ') }) : null,
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = { kind: 'citta', id: c.id }; render(); } }),
        el('button', { class: 'btn', text: '+ NPC qui', title: 'Nuovo NPC con la fazione della città', onclick: () => { tab = 'npc'; DnD.uiNpc.openNew({ cityId: c.id, factionId: '' }); render(); } }),
        el('button', { class: 'btn', text: '+ Nemico qui', title: 'Nuovo nemico standard con la città e la sua fazione', onclick: () => newEnemyHere(c) }),
        el('button', { class: 'btn', text: '📍 Sulla mappa…', onclick: () => placeDialog(c) }),
        el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicateCity(c) }),
        el('button', { class: 'btn danger', text: 'Elimina', onclick: () => removeCity(c) })));
  }

  function quickCityDialog() {
    const name = textInput('', { maxlength: 60, 'data-key': 'name', placeholder: 'es. Pietrarossa' });
    const fs = factionSelect('neutrali');
    const size = el('select', {}, K.CITY_SIZES.map((s) => opt(s, K.CITY_SIZE_NAMES[s], s === 'paese')));
    const biome = el('select', {}, opt('', '— nessuno —', true), (DnD.store.state.biomes || []).map((b) => opt(b.id, b.name)));
    const body = el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); } },
      field('Nome', name, 'name'), el('div', { class: 'grid-3 tight' }, field('Fazione dominante', fs), field('Dimensione', size), field('Bioma', biome)));
    openDialog('Crea città', body, [{ text: 'Annulla' }, { text: 'Crea', class: 'primary', onclick: () => {
      if (!name.value.trim()) { DnD.ui.showErrors(body, { name: 'Il nome è obbligatorio.' }); return false; }
      const c = DnD.citta.quickCity({ name: name.value.trim(), factionId: fs.value, size: size.value, biomeId: biome.value }, sessionId());
      update((st) => { st.cities.push(c); });
      toast('Città «' + c.name + '» creata.', 'success');
      render();
      return undefined;
    } }]);
    name.focus();
  }

  function newEnemyHere(c) {
    const enemy = DnD.dati.normalizeCreature({ name: 'Guardia di ' + c.name, level: 1, maxHp: 11, ac: 16, acMode: 'manuale', saveMode: 'classe', classId: 'guerriero', factionId: c.factionId, cityId: c.id, sessionId: sessionId() }, false);
    update((st) => { st.npcs.push(enemy); });
    toast('Nemico creato con la fazione della città: completalo in Nemici.', 'success');
    DnD.app.navigate('nemici');
  }

  function duplicateCity(c) {
    const copy = Object.assign(clone(c), { id: DnD.dadi.uid(), name: (c.name + ' (copia)').slice(0, 60), place: null, shared: false, sessionId: sessionId() });
    update((st) => { st.cities.push(copy); });
    toast('Città duplicata.');
    render();
  }
  function removeCity(c) {
    const npcs = world().npcs.filter((n) => n.cityId === c.id);
    if (!confirm('Eliminare la città «' + c.name + '»?' + (npcs.length ? '\n' + npcs.length + ' NPC restano senza città.' : '') + (c.place ? '\nIl segnaposto sulla mappa resta come evento.' : ''))) return;
    update((st) => { st.cities = st.cities.filter((x) => x.id !== c.id); });
    toast('Città eliminata.');
    render();
  }

  // Segnaposto: evento «Entra in una mappa» (con ritorno) piazzato su una mappa di esplorazione salvata.
  function placeDialog(c) {
    const grids = DnD.sessioni.visible(DnD.store.state, 'savedGrids').filter((g) => g.kind === 'esplorazione');
    if (!grids.length) { toast('Serve una mappa di esplorazione salvata (Editor griglie › tipo Esplorazione).', 'error'); return; }
    const gs = el('select', {}, grids.map((g) => opt(g.id, g.name, c.place && c.place.gridId === g.id)));
    const x = numberInput(c.place ? c.place.x + 1 : 1, { min: 1, max: 100, 'data-key': 'x' });
    const y = numberInput(c.place ? c.place.y + 1 : 1, { min: 1, max: 100, 'data-key': 'y' });
    const body = el('div', { class: 'form' }, field('Mappa di esplorazione', gs), el('div', { class: 'grid-2 tight' }, field('Colonna (1 = A)', x, 'x'), field('Riga', y, 'y')),
      el('p', { class: 'muted small', text: 'Diventa un evento «Entra in una mappa» (interazione) con la mappa collegata alla città; dall\'esplorazione «Esci» torna allo stesso punto.' }),
      c.gridId ? null : el('p', { class: 'small warn-text', text: '⚠ La città non ha una mappa collegata: l\'evento mostrerà solo una nota finché non la colleghi.' }));
    openDialog('Piazza «' + c.name + '» sulla mappa', body, [{ text: 'Annulla' }, { text: 'Piazza', class: 'primary', onclick: () => {
      const g = grids.find((z) => z.id === gs.value);
      const cx = readNumber(x) - 1;
      const cy = readNumber(y) - 1;
      if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) { DnD.ui.showErrors(body, { x: 'Cella fuori dalla mappa (' + g.w + '×' + g.h + ').' }); return false; }
      update((st) => {
        const grid = st.savedGrids.find((z) => z.id === g.id);
        const city = st.cities.find((z) => z.id === c.id);
        // Un solo segnaposto per città: quello precedente (se c'è) si sposta.
        for (const og of st.savedGrids) og.events = (og.events || []).filter((i) => !(city.place && i.id === city.place.instanceId));
        const inst = DnD.eventi.instantiate(DnD.citta.placeEvent(city), [{ x: cx, y: cy }], 0);
        grid.events.push(inst);
        city.place = { gridId: g.id, x: cx, y: cy, instanceId: inst.id };
      });
      toast('«' + c.name + '» piazzata su «' + g.name + '».', 'success');
      render();
      return undefined;
    } }]);
  }

  function cityForm(host) {
    const w = world();
    const existing = editing.id !== 'new' ? w.cities.find((x) => x.id === editing.id) : null;
    const c = existing ? clone(existing) : DnD.citta.normalizeCity({ sessionId: sessionId() });
    const name = textInput(c.name, { maxlength: 60, 'data-key': 'name' });
    const fs = factionSelect(c.factionId);
    const present = el('div', { class: 'check-row' }, w.factions.map((f) => el('label', { class: 'check small' },
      el('input', { type: 'checkbox', value: f.id, checked: c.presentFactionIds.includes(f.id) }), ' ', factionDot(f), ' ' + f.name)));
    const size = el('select', {}, K.CITY_SIZES.map((s) => opt(s, K.CITY_SIZE_NAMES[s], s === c.size)));
    const biome = el('select', {}, opt('', '— nessuno —', !c.biomeId), (DnD.store.state.biomes || []).map((b) => opt(b.id, b.name, b.id === c.biomeId)));
    const grids = DnD.sessioni.visible(DnD.store.state, 'savedGrids');
    const gridSel = el('select', {}, opt('', '— nessuna —', !c.gridId), grids.map((g) => opt(g.id, g.name + (g.kind === 'esplorazione' ? ' (esplorazione)' : ' (battaglia)'), g.id === c.gridId)),
      c.gridId && !grids.some((g) => g.id === c.gridId) ? opt(c.gridId, '⚠ mappa eliminata', true) : null);
    const ex = numberInput(c.entry.x + 1, { min: 1, max: 100 });
    const ey = numberInput(c.entry.y + 1, { min: 1, max: 100 });
    const icon = DnD.uiIcone.iconPicker(c.icon, false);
    const t = (v, rows, ph) => el('textarea', { rows: rows || 2, value: v, placeholder: ph || '' });
    const desc = t(c.description, 3);
    const env = t(c.environment, 2, 'clima, odori, atmosfera…');
    const rw = textInput(c.rules.weapons, { maxlength: 300, placeholder: 'es. armi lunghe consegnate alla porta' });
    const rc = textInput(c.rules.curfew, { maxlength: 300, placeholder: 'es. dalle 22 all\'alba' });
    const rt = textInput(c.rules.taxes, { maxlength: 300, placeholder: 'es. 1 ma per carro all\'ingresso' });
    const notes = t(c.notes, 3, 'Solo per il master');
    const quests = el('div', { class: 'check-row' }, w.quests.length ? w.quests.map((q) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: q.id, checked: c.questIds.includes(q.id) }), ' ' + q.title))
      : el('span', { class: 'muted small', text: 'Nessuna quest: creale in Mondo › Quest.' }));
    const events = el('div', { class: 'check-row' }, (DnD.store.state.events || []).map((ev) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: ev.id, checked: c.eventIds.includes(ev.id) }), ' ' + ev.name)));
    const entryEvent = el('select', {}, opt('', '— nessuno —', !c.entryEventId), (DnD.store.state.events || []).map((ev) => opt(ev.id, ev.name, ev.id === c.entryEventId)));
    const shared = el('input', { type: 'checkbox', checked: c.shared });
    const cont = existing ? DnD.citta.contents(c, w.npcs, w.quests) : null;
    const checked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);
    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' }, field('Nome', name, 'name'), field('Fazione dominante', fs), field('Dimensione', size)),
      el('fieldset', {}, el('legend', { text: 'Fazioni presenti' }), present),
      el('div', { class: 'grid-3' }, field('Bioma', biome), field('Mappa collegata', gridSel), el('div', { class: 'grid-2 tight' }, field('Ingresso: colonna', ex), field('riga', ey))),
      icon.node,
      field('Descrizione', desc),
      field('Ambiente', env),
      el('fieldset', {}, el('legend', { text: 'Regole (promemoria)' }), el('div', { class: 'grid-3 tight' }, field('Armi vietate', rw), field('Coprifuoco', rc), field('Tasse', rt))),
      el('fieldset', {}, el('legend', { text: 'Quest disponibili' }), quests),
      el('fieldset', {}, el('legend', { text: 'Eventi collegati (incontri tipici)' }), events, field('Evento d\'ingresso', entryEvent)),
      cont ? el('fieldset', {}, el('legend', { text: 'NPC della città' }), cont.npcs.length ? el('ul', { class: 'small' }, cont.npcs.map((n) => el('li', { text: n.name + (n.roles.length ? ' (' + n.roles.map((r) => K.ROLE_NAMES[r]).join(', ') + ')' : '') })))
        : el('p', { class: 'muted small', text: 'Nessun NPC: usa «+ NPC qui» o scegli la città nella scheda dell\'NPC.' })) : null,
      field('Note del master', notes),
      el('label', { class: 'check' }, shared, ' Condividi con tutte le sessioni'),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva' })));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ir = icon.read();
      const errors = {};
      if (!name.value.trim()) errors.name = 'Il nome è obbligatorio.';
      if (ir.error) errors.icon = ir.error;
      if (!DnD.ui.showErrors(form, errors)) return;
      const oldFaction = existing ? existing.factionId : '';
      const saved = DnD.citta.normalizeCity(Object.assign(c, {
        name: name.value.trim(), factionId: fs.value, presentFactionIds: checked(present), size: size.value, biomeId: biome.value, gridId: gridSel.value,
        entry: { x: (readNumber(ex) || 1) - 1, y: (readNumber(ey) || 1) - 1 }, icon: ir.icon, description: desc.value, environment: env.value,
        rules: { weapons: rw.value, curfew: rc.value, taxes: rt.value }, questIds: checked(quests), eventIds: checked(events), entryEventId: entryEvent.value, notes: notes.value, shared: shared.checked,
      }));
      update((st) => {
        const i = st.cities.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.cities[i] = saved;
        else st.cities.push(saved);
        // Segnaposto: l'evento si aggiorna con la mappa collegata.
        if (saved.place) {
          for (const g of st.savedGrids) for (const inst of g.events || []) if (inst.id === saved.place.instanceId) inst.event = DnD.citta.placeEvent(saved);
        }
      });
      if (existing && oldFaction !== saved.factionId) toast('La nuova fazione vale come predefinita per NPC e nemici della città che non ne hanno una propria.');
      toast('Città salvata.', 'success');
      editing = null;
      render();
    });
    host.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica città' : 'Nuova città' })), form);
    name.focus();
  }

  // ---------- Pannello reputazione (usato da Party) ----------
  // party: party di cui mostrare barre e storico; onChange(): ridisegna.
  function reputationPanel(party, onChange) {
    const w = world();
    const others = w.factions.filter((f) => f.id !== party.factionId);
    const log = w.world.repLog.filter((e) => e.partyId === party.id || (e.playerId && party.memberIds.includes(e.playerId))).slice().reverse();
    const adjust = (factionId, playerId) => {
      const delta = numberInput(5, { min: -200, max: 200, 'data-key': 'delta' });
      const reason = textInput('', { maxlength: 300, placeholder: 'es. dono al capitano' });
      const body = el('div', { class: 'form' }, el('div', { class: 'grid-2 tight' }, field('Variazione', delta, 'delta'), field('Motivazione', reason)));
      openDialog('Reputazione con «' + (factionById(factionId) || { name: '?' }).name + '»', body, [{ text: 'Annulla' }, { text: 'Applica', class: 'primary', onclick: () => {
        const d = readNumber(delta);
        if (!Number.isInteger(d) || !d) { DnD.ui.showErrors(body, { delta: 'Un intero diverso da 0.' }); return false; }
        applyReputation(party.id, factionId, d, reason.value.trim() || 'a mano', 'manuale', playerId);
        onChange();
        return undefined;
      } }]);
    };
    return el('section', { class: 'panel reputation-panel' },
      el('div', { class: 'history-head' }, el('h2', { text: 'Reputazione' }),
        el('label', { class: 'check small', title: 'Ogni giocatore può avere una reputazione propria (altrimenti vale quella del party)' },
          el('input', { type: 'checkbox', checked: w.world.perPlayer, onchange: (e) => { update((st, v) => { v.world.perPlayer = e.target.checked; }); onChange(); } }), ' Anche per giocatore')),
      el('ul', { class: 'rep-list' }, others.map((f) => el('li', {}, el('span', { class: 'rep-name' }, factionDot(f), ' ', f.name), repBar(party.reputation[f.id] || 0),
        el('button', { type: 'button', class: 'btn small', text: '±', title: 'Cambia a mano', onclick: () => adjust(f.id, '') })))),
      w.world.perPlayer ? el('details', {}, el('summary', { text: 'Reputazione dei singoli giocatori' }),
        DnD.party.members(party, DnD.sessioni.visible(DnD.store.state, 'players')).list.map((p) => el('div', { class: 'small' }, el('b', { text: p.name }),
          el('ul', { class: 'rep-list' }, others.map((f) => el('li', {}, el('span', { class: 'rep-name' }, factionDot(f), ' ', f.name), repBar(F.reputationOf(w.world, party, f.id, p.id)),
            el('button', { type: 'button', class: 'btn small', text: '±', onclick: () => adjust(f.id, p.id) }))))))) : null,
      el('details', { class: 'rep-history' }, el('summary', { text: 'Storico delle variazioni (' + log.length + ')' }),
        log.length ? el('ul', { class: 'small rep-log' }, log.slice(0, 100).map((e) => el('li', { class: e.reverted ? 'reverted' : '' },
          el('span', { class: 'muted', text: new Date(e.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) + ' · ' }),
          factionBadge(e.factionId), ' ', el('b', { text: (e.delta > 0 ? '+' : '') + e.delta }), ' (' + e.before + ' → ' + e.after + ') ', e.reason,
          e.playerId ? el('span', { class: 'muted', text: ' · ' + ((DnD.store.state.players.find((p) => p.id === e.playerId) || {}).name || '?') }) : null,
          e.reverted ? el('span', { class: 'tag', text: 'annullata' }) : el('button', { type: 'button', class: 'btn small', text: '↶', title: 'Annulla questa variazione', onclick: () => {
            update((st, v) => { F.revertReputation(v.world, st.parties, e.id); });
            onChange();
          } })))) : el('p', { class: 'muted small', text: 'Nessuna variazione.' })));
  }

  // Applica una variazione di reputazione al party (o al giocatore) della sessione corrente, con il suono.
  function applyReputation(partyId, factionId, delta, reason, source, playerId) {
    let entry = null;
    update((st, v) => {
      const party = st.parties.find((p) => p.id === partyId) || DnD.party.active(v.parties, v.world);
      entry = F.changeReputation({ world: v.world, party, playerId }, factionId, delta, reason, source);
    });
    if (entry) {
      const f = factionById(factionId);
      toast('Reputazione con «' + (f ? f.name : '?') + '»: ' + (entry.delta > 0 ? '+' : '') + entry.delta + ' (' + entry.after + ').');
      sound(entry.delta > 0 ? 'su' : 'giu');
    }
    return entry;
  }

  // ---------- Suoni (categoria «Mondo» degli effetti sonori, audio.js) ----------
  const SOUNDS = { su: 'reputazione-su', giu: 'reputazione-giu', quest: 'quest-accettata', fatto: 'quest-completata', ostile: 'npc-ostile' };
  function sound(kind) {
    if (DnD.audio && SOUNDS[kind]) DnD.audio.suona(SOUNDS[kind]);
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.mondo = { title: 'Mondo', render, reset: () => { editing = null; if (DnD.uiNpc) DnD.uiNpc.reset(); if (DnD.uiQuest) DnD.uiQuest.reset(); } };
  DnD.uiMondo = {
    world, update, factionDot, factionBadge, factionSelect, citySelect, worldRefsEditor, repBar, levelTag, reputationPanel, applyReputation, sound, colorPicker,
    repWith, activeParty, select: (id) => { tab = id; editing = null; },
  };
})(globalThis.DnD = globalThis.DnD || {});
