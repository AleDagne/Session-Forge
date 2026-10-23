// Mondo › Quest: elenco con stato, editor (datore, fazione, requisiti, obiettivi con contatori, tempo limite,
// ricompense, eventi collegati, testi di offerta e consegna). Diario del party (Giocatori › Party): ricerca, filtro
// per fazione e stato, avanzamento a mano. Offri / Accetta / Consegna con le ricompense confermate dal master
// (PE, monete, oggetti, reputazione, sblocco di quest e negozi). Gli eventi collegati partono nell'esplorazione.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const Q = DnD.quest;
  const F = DnD.fazioni;
  const K = DnD.mondoDati;
  const A = DnD.attrezzatura;
  const UM = () => DnD.uiMondo;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  let root = null;
  let editing = null;
  let isNew = false;
  const filter = { text: '', factionId: '', status: '' };

  const st = () => DnD.store.state;
  const world = () => F.view(st());
  const sessionId = () => DnD.sessioni.current(st()).id;
  const nowHours = () => { const ex = DnD.sessioni.current(st()).exploration; return ex ? ex.time.total : 0; };
  const statusTag = (s) => el('span', { class: 'tag q-' + s, text: K.QUEST_STATE_NAMES[s] });

  // Riga di registro: nell'esplorazione o nel combattimento in corso, altrimenti un avviso.
  function worldLog(text) {
    const se = DnD.sessioni.current(st());
    DnD.store.update((s) => {
      const cur = DnD.sessioni.current(s);
      if (cur.combat) DnD.dati.pushLog(cur.combat, 'quest', text);
      else if (cur.exploration) {
        const grid = s.savedGrids.find((g) => g.id === cur.exploration.gridId);
        if (grid) DnD.esplorazione.log({ st: s, ex: cur.exploration, grid }, text, 'quest');
      }
    });
    if (!se.combat && !se.exploration) toast(text);
  }

  // ---------- Elenco ed editor ----------
  function render(container) {
    root = container || root;
    clear(root);
    if (editing) return renderForm();
    const w = world();
    const j = w.world.quests;
    root.append(el('div', { class: 'section-head' }, el('h2', { text: 'Quest' }),
      el('div', { class: 'head-actions' }, el('button', { class: 'btn primary', text: '+ Nuova quest', onclick: () => { editing = Q.normalizeQuest({ title: '', sessionId: sessionId(), objectives: [{ kind: 'parla' }] }); editing.title = ''; isNew = true; render(); } }))),
    el('p', { class: 'muted small', text: 'Lo stato (Disponibile, Attiva, Completata, Fallita, Scaduta) e l\'avanzamento sono nel diario della sessione; i giocatori vedono solo le quest offerte e accettate.' }),
    w.quests.length ? el('div', { class: 'card-grid' }, w.quests.map((q) => {
      const s = Q.statusOf(j, q.id);
      const giver = q.giver.npcId ? w.npcs.find((n) => n.id === q.giver.npcId) : null;
      const missing = Q.missingRefs(q, st(), w);
      return el('article', { class: 'card quest-card' },
        el('div', { class: 'card-title' }, el('h3', { text: '📜 ' + q.title }), statusTag(s)),
        el('p', { class: 'small' }, giver ? el('span', { text: 'Datore: ' + giver.name + ' ' }) : q.giver.npcId ? el('span', { class: 'warn-text', text: '⚠ datore eliminato ' }) : null,
          q.factionId ? UM().factionBadge(q.factionId) : null, q.timeLimit ? el('span', { class: 'tag', text: '⏳ ' + q.timeLimit + ' h' }) : null),
        q.description ? el('p', { class: 'muted small', text: q.description.slice(0, 200) }) : null,
        el('ul', { class: 'small' }, q.objectives.map((o) => el('li', { text: Q.objectiveText(o) + ' (' + ((j[q.id] && j[q.id].progress[o.id]) || 0) + '/' + o.count + ')' + (o.optional ? ' · facoltativo' : '') }))),
        missing.length ? el('p', { class: 'small warn-text', text: '⚠ ' + missing.join(', ') }) : null,
        el('div', { class: 'card-actions' },
          el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = clone(q); isNew = false; render(); } }),
          s === 'disponibile' ? el('button', { class: 'btn', text: 'Offri…', onclick: () => offerDialog(q, giver, render) }) : null,
          el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(q) })));
    })) : DnD.ui.emptyState('Nessuna quest', 'Una quest ha obiettivi con contatori, ricompense e reputazione.', [{ text: '+ Nuova quest', primary: true, onclick: () => { editing = Q.normalizeQuest({ title: '', sessionId: sessionId() }); editing.title = ''; isNew = true; render(); } }]));
  }

  function remove(q) {
    if (!confirm('Eliminare la quest «' + q.title + '»? Lo stato nel diario si perde; NPC ed eventi che la usano mostreranno un avviso.')) return;
    UM().update((s, v) => { s.quests = s.quests.filter((x) => x.id !== q.id); delete v.world.quests[q.id]; });
    toast('Quest eliminata.');
    render();
  }

  function renderForm() {
    const q = editing;
    const w = world();
    const s = st();
    const redraw = () => render();
    const equipSel = (value, on) => el('select', { onchange: on }, opt('', '—', !value), s.equipment.map((x) => opt(x.id, x.name, x.id === value)), value && !s.equipment.some((x) => x.id === value) ? opt(value, '⚠ oggetto eliminato', true) : null);
    const reqBox = el('div', { class: 'row-list' }, q.requirements.map((r, i) => el('div', { class: 'input-row' },
      el('select', { onchange: (e) => { q.requirements[i] = { kind: e.target.value }; q.requirements[i] = Q.normalizeQuest({ requirements: [q.requirements[i]] }).requirements[0]; redraw(); } }, K.REQUIREMENTS.map((k) => opt(k, K.REQUIREMENT_NAMES[k], k === r.kind))),
      r.kind === 'reputazione' ? [UM().factionSelect(r.factionId, { empty: '— scegli —', onchange: (e) => { r.factionId = e.target.value; } }), ' ≥ ', numberInput(r.min, { class: 'qty', min: -100, max: 100, oninput: (e) => { r.min = readNumber(e.target) || 0; } })] : null,
      r.kind === 'livello' ? numberInput(r.level, { class: 'qty', min: 1, max: 40, oninput: (e) => { r.level = readNumber(e.target) || 1; } }) : null,
      r.kind === 'oggetto' ? equipSel(r.equipmentId, (e) => { r.equipmentId = e.target.value; }) : null,
      r.kind === 'evento' ? el('select', { onchange: (e) => { r.eventId = e.target.value; } }, opt('', '—', !r.eventId), (s.events || []).map((x) => opt(x.id, x.name, x.id === r.eventId))) : null,
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { q.requirements.splice(i, 1); redraw(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Requisito', onclick: () => { q.requirements.push(Q.normalizeQuest({ requirements: [{}] }).requirements[0]); redraw(); } }));
    const grids = DnD.sessioni.visible(s, 'savedGrids');
    const objBox = el('div', { class: 'row-list' }, q.objectives.map((o, i) => el('div', { class: 'row-item' }, el('div', { class: 'input-row' },
      el('select', { onchange: (e) => { o.kind = e.target.value; redraw(); } }, K.OBJECTIVES.map((k) => opt(k, K.OBJECTIVE_NAMES[k], k === o.kind))),
      o.kind === 'parla' ? el('select', { onchange: (e) => { o.npcId = e.target.value; } }, opt('', '— NPC —', !o.npcId), w.npcs.map((n) => opt(n.id, n.name, n.id === o.npcId))) : null,
      o.kind === 'uccidi' ? [textInput(o.creature, { placeholder: 'nome o tipo (es. goblin, non morto)', oninput: (e) => { o.creature = e.target.value; } }),
        el('select', { 'aria-label': 'Nemico preciso', onchange: (e) => { o.npcSourceId = e.target.value; } }, opt('', '— o un nemico preciso —', !o.npcSourceId), DnD.sessioni.visible(s, 'npcs').map((n) => opt(n.id, n.name, n.id === o.npcSourceId)))] : null,
      o.kind === 'raccogli' ? equipSel(o.equipmentId, (e) => { o.equipmentId = e.target.value; }) : null,
      o.kind === 'raggiungi' ? [el('select', { onchange: (e) => { o.gridId = e.target.value; } }, opt('', '— mappa —', !o.gridId), grids.map((g) => opt(g.id, g.name, g.id === o.gridId))),
        el('label', { class: 'inline small' }, 'col.', numberInput(o.x + 1, { class: 'qty', min: 1, max: 100, oninput: (e) => { o.x = (readNumber(e.target) || 1) - 1; } })),
        el('label', { class: 'inline small' }, 'riga', numberInput(o.y + 1, { class: 'qty', min: 1, max: 100, oninput: (e) => { o.y = (readNumber(e.target) || 1) - 1; } })),
        textInput(o.place, { class: 'short', placeholder: 'nome del luogo', oninput: (e) => { o.place = e.target.value; } })] : null,
      o.kind === 'evento' ? el('select', { onchange: (e) => { o.eventId = e.target.value; } }, opt('', '— evento —', !o.eventId), (s.events || []).map((x) => opt(x.id, x.name, x.id === o.eventId))) : null,
      el('label', { class: 'inline small' }, '×', numberInput(o.count, { class: 'qty', min: 1, max: 9999, oninput: (e) => { o.count = readNumber(e.target) || 1; } })),
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: o.optional, onchange: (e) => { o.optional = e.target.checked; } }), ' facoltativo'),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { q.objectives.splice(i, 1); redraw(); } })),
    textInput(o.text, { placeholder: 'testo per il diario (facoltativo)', oninput: (e) => { o.text = e.target.value; } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Obiettivo', onclick: () => { q.objectives.push(Q.normalizeObjective({})); redraw(); } }));
    const r = q.rewards;
    const repBox = el('div', { class: 'row-list' }, r.reputation.map((x, i) => el('div', { class: 'input-row' },
      UM().factionSelect(x.factionId, { onchange: (e) => { x.factionId = e.target.value; } }),
      numberInput(x.delta, { class: 'qty', min: -100, max: 100, oninput: (e) => { x.delta = readNumber(e.target) || 0; } }),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { r.reputation.splice(i, 1); redraw(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Reputazione', onclick: () => { r.reputation.push({ factionId: q.factionId || 'neutrali', delta: K.REP_EVENTS.questCompletata }); redraw(); } }));
    const itemsBox = el('div', { class: 'row-list' }, r.items.map((it, i) => el('div', { class: 'input-row' },
      numberInput(it.qty, { class: 'qty', min: 1, oninput: (e) => { it.qty = readNumber(e.target) || 1; } }), '×', equipSel(it.equipmentId, (e) => { it.equipmentId = e.target.value; }),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { r.items.splice(i, 1); redraw(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Oggetto', disabled: !s.equipment.length, onclick: () => { r.items.push({ equipmentId: s.equipment[0].id, qty: 1 }); redraw(); } }));
    const checks = (list, value, key, label) => el('div', { class: 'check-row' }, list.length ? list.map((x) => el('label', { class: 'check small' },
      el('input', { type: 'checkbox', checked: value.includes(x.id), onchange: (e) => { r[key] = e.target.checked ? [...new Set(r[key].concat(x.id))] : r[key].filter((y) => y !== x.id); } }), ' ' + (x.title || x.name)))
      : el('span', { class: 'muted small', text: label }));
    const eventSel = (key) => el('select', { onchange: (e) => { q[key] = e.target.value; } }, opt('', '— nessuno —', !q[key]), (s.events || []).map((x) => opt(x.id, x.name, x.id === q[key])));
    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-2' }, field('Titolo', textInput(q.title, { maxlength: 80, 'data-key': 'title', oninput: (e) => { q.title = e.target.value; } }), 'title'),
        field('Tempo limite (ore di gioco, vuoto = nessuno)', numberInput(q.timeLimit === null ? '' : q.timeLimit, { min: 1, max: 100000, oninput: (e) => { q.timeLimit = e.target.value.trim() === '' ? null : readNumber(e.target); } }))),
      field('Descrizione', el('textarea', { rows: 3, value: q.description, oninput: (e) => { q.description = e.target.value; } })),
      el('div', { class: 'grid-3' },
        field('Datore (NPC)', el('select', { onchange: (e) => { q.giver.npcId = e.target.value; } }, opt('', '— nessuno —', !q.giver.npcId), w.npcs.map((n) => opt(n.id, n.name, n.id === q.giver.npcId)))),
        field('o fazione che la offre', UM().factionSelect(q.giver.factionId, { empty: '— nessuna —', onchange: (e) => { q.giver.factionId = e.target.value; } })),
        field('Fazione della quest', UM().factionSelect(q.factionId, { empty: '— nessuna —', onchange: (e) => { q.factionId = e.target.value; } }), null, 'Ostile = quest bloccata (se la regola è attiva)')),
      el('fieldset', {}, el('legend', { text: 'Requisiti' }), reqBox),
      el('fieldset', {}, el('legend', { text: 'Obiettivi' }), objBox, el('p', { class: 'muted small', text: 'Uccidi: le uccisioni nel combattimento avanzano il contatore (per nome, tipo di creatura o nemico preciso). Raccogli: conta gli oggetti posseduti dal party. Parla: aprendo il dialogo con l\'NPC. Raggiungi e Completa un evento: nell\'esplorazione.' })),
      el('fieldset', {}, el('legend', { text: 'Ricompense' }),
        el('div', { class: 'input-row' }, el('label', { class: 'inline small' }, 'PE', numberInput(r.xp, { class: 'qty', min: 0, oninput: (e) => { r.xp = readNumber(e.target) || 0; } })),
          ...A.CURRENCIES.map((k) => el('label', { class: 'inline small' }, k, numberInput(r.coins[k], { class: 'qty', min: 0, oninput: (e) => { r.coins[k] = readNumber(e.target) || 0; } })))),
        itemsBox, el('h4', { text: 'Reputazione' }), repBox,
        el('h4', { text: 'Sblocca quest' }), checks(w.quests.filter((x) => x.id !== q.id), r.unlockQuestIds, 'unlockQuestIds', 'Nessun\'altra quest.'),
        el('h4', { text: 'Sblocca negozi (mercanti)' }), checks(w.npcs.filter((n) => n.roles.includes('mercante')), r.unlockMerchantIds, 'unlockMerchantIds', 'Nessun mercante.')),
      el('div', { class: 'grid-2' }, field('Evento all\'accettazione', eventSel('onAccept')), field('Evento al completamento', eventSel('onComplete'))),
      el('div', { class: 'grid-2' }, field('Testo di offerta', el('textarea', { rows: 2, value: q.offerText, oninput: (e) => { q.offerText = e.target.value; } })),
        field('Testo di consegna', el('textarea', { rows: 2, value: q.completeText, oninput: (e) => { q.completeText = e.target.value; } }))),
      field('Note del master', el('textarea', { rows: 2, value: q.notes, oninput: (e) => { q.notes = e.target.value; } })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: q.shared, onchange: (e) => { q.shared = e.target.checked; } }), ' Condividi con tutte le sessioni'),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva' })));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!q.title.trim()) { DnD.ui.showErrors(form, { title: 'Il titolo è obbligatorio.' }); return; }
      const saved = Q.normalizeQuest(q);
      UM().update((s2) => {
        const i = s2.quests.findIndex((x) => x.id === saved.id);
        if (i >= 0) s2.quests[i] = saved;
        else s2.quests.push(saved);
        // Il datore NPC la offre: collegamento anche dalla sua scheda.
        const giver = saved.giver.npcId && s2.worldNpcs.find((n) => n.id === saved.giver.npcId);
        if (giver && !giver.questIds.includes(saved.id)) giver.questIds.push(saved.id);
      });
      toast('Quest salvata.', 'success');
      editing = null;
      render();
    });
    root.append(el('div', { class: 'section-head' }, el('h2', { text: isNew ? 'Nuova quest' : 'Modifica quest' })), form);
  }

  // ---------- Offerta, accettazione, consegna ----------
  function reqCtx() {
    const w = world();
    const party = DnD.party.active(w.parties, w.world);
    const members = party ? DnD.party.members(party, DnD.sessioni.visible(st(), 'players')).list : [];
    const ex = DnD.sessioni.current(st()).exploration;
    return {
      party, members,
      rep: (fid) => F.reputationOf(w.world, party, fid),
      level: Math.max(0, ...members.map((m) => m.level)),
      hasItem: (id) => members.some((m) => m.inventory.some((x) => x.equipmentId === id && x.qty > 0)) || Boolean(party && party.inventory.some((x) => x.equipmentId === id && x.qty > 0)),
      eventDone: (id) => Boolean(ex && st().savedGrids.some((g) => (g.events || []).some((i) => (i.templateId === id || i.id === id) && i.state.fired > 0))),
      blockHostile: w.world.blockHostile,
    };
  }

  function offerDialog(q, npc, onDone) {
    const ctx = reqCtx();
    const req = Q.requirementsMet(q, ctx);
    UM().update((s, v) => { Q.offer(v.world.quests, q); });
    const body = el('div', { class: 'form' },
      q.offerText ? el('blockquote', { class: 'event-read', text: q.offerText }) : null,
      q.description ? el('p', { text: q.description }) : null,
      el('ul', { class: 'small' }, q.objectives.map((o) => el('li', { text: Q.objectiveText(o) + (o.count > 1 ? ' (' + o.count + ')' : '') }))),
      q.timeLimit ? el('p', { class: 'small', text: '⏳ Tempo limite: ' + q.timeLimit + ' ore di gioco.' }) : null,
      req.ok ? null : el('p', { class: 'warn-text small', text: '⚠ Requisiti non soddisfatti: ' + req.missing.join(', ') + '. Il master può accettarla comunque.' }),
      ctx.party ? null : el('p', { class: 'warn-text small', text: '⚠ Nessun party attivo (Giocatori › Party).' }));
    openDialog('📜 ' + q.title + (npc ? ' — da ' + npc.name : ''), body, [
      { text: 'Rifiuta' },
      { text: req.ok ? 'Accetta' : 'Accetta comunque', class: 'primary', onclick: () => {
        UM().update((s, v) => { Q.accept(v.world.quests, q, nowHours(), ctx.party && ctx.party.id); });
        worldLog('📜 Quest «' + q.title + '» accettata' + (ctx.party ? ' da «' + ctx.party.name + '»' : '') + '.');
        UM().sound('quest');
        recountCollect();
        fireLinkedEvent(q.onAccept);
        if (onDone) onDone();
        return undefined;
      } },
    ]);
  }

  // Evento collegato: nell'esplorazione in corso parte subito, altrimenti è un promemoria.
  function fireLinkedEvent(eventId) {
    if (!eventId) return;
    const ev = (st().events || []).find((e) => e.id === eventId);
    if (!ev) { toast('⚠ Evento collegato eliminato.', 'error'); return; }
    const ex = DnD.sessioni.current(st()).exploration;
    if (!ex) { toast('Evento collegato «' + ev.name + '»: avvialo dall\'esplorazione.'); return; }
    DnD.store.update((s) => {
      const cur = DnD.sessioni.current(s);
      const grid = s.savedGrids.find((g) => g.id === cur.exploration.gridId);
      if (grid) DnD.esplorazione.fireEvent({ st: s, ex: cur.exploration, grid }, clone(ev));
    });
  }

  // Consegna: completa (anche forzando) e distribuisce le ricompense dopo la conferma del master.
  function completeDialog(q, onDone) {
    const ctx = reqCtx();
    const e = (world().world.quests[q.id]) || Q.normalizeEntry({});
    const done = Q.allDone(q, e);
    const players = ctx.members.length ? ctx.members : DnD.sessioni.visible(st(), 'players');
    const party = ctx.party;
    const toSel = el('select', {}, party && party.sharedPurse ? opt('party', '🎒 Borsa comune del party', true) : null, players.map((p) => opt(p.id, p.name)));
    const r = q.rewards;
    const eqName = (id) => { const x = st().equipment.find((y) => y.id === id); return x ? x.name : '⚠ oggetto eliminato'; };
    const body = el('div', { class: 'form' },
      q.completeText ? el('blockquote', { class: 'event-read', text: q.completeText }) : null,
      el('ul', { class: 'small' }, q.objectives.map((o) => el('li', { text: (Q.objectiveDone(e, o) ? '✓ ' : '✗ ') + Q.objectiveText(o) + ' ' + (e.progress[o.id] || 0) + '/' + o.count }))),
      done ? null : el('p', { class: 'warn-text small', text: '⚠ Non tutti gli obiettivi sono completati: confermando la quest si chiude comunque.' }),
      el('h3', { text: 'Ricompense' }),
      el('ul', { class: 'small' },
        r.xp ? el('li', { text: r.xp + ' PE (divisi tra i membri' + (DnD.sessioni.current(st()).exploration ? ' dell\'esplorazione' : ': segnali sulle schede') + ')' }) : null,
        A.CURRENCIES.some((k) => r.coins[k]) ? el('li', { text: '🪙 ' + A.formatCoins(r.coins) }) : null,
        r.items.map((it) => el('li', { text: it.qty + '× ' + eqName(it.equipmentId) })),
        r.reputation.map((x) => el('li', {}, UM().factionBadge(x.factionId), ' ' + (x.delta > 0 ? '+' : '') + x.delta)),
        r.unlockQuestIds.length ? el('li', { text: 'Sblocca ' + r.unlockQuestIds.length + ' quest' }) : null,
        r.unlockMerchantIds.length ? el('li', { text: 'Sblocca ' + r.unlockMerchantIds.length + ' negozi' }) : null),
      el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Monete e oggetti a' }), toSel));
    openDialog('Consegna: ' + q.title, body, [
      { text: 'Annulla' },
      { text: 'Fallita', class: 'danger', onclick: () => {
        UM().update((s, v) => { Q.fail(v.world.quests, q, nowHours()); });
        worldLog('📜 Quest «' + q.title + '» fallita.');
        if (q.factionId) UM().applyReputation(party && party.id, q.factionId, K.REP_EVENTS.questFallita, 'quest fallita: ' + q.title, 'quest');
        if (onDone) onDone();
        return undefined;
      } },
      { text: 'Conferma e distribuisci', class: 'primary', onclick: () => {
        const lines = [];
        UM().update((s, v) => {
          const res = Q.complete(v.world.quests, q, nowHours(), true);
          if (!res.ok) { lines.push(res.reason); return; }
          const holder = toSel.value === 'party' ? s.parties.find((x) => x.id === party.id) : s.players.find((x) => x.id === toSel.value);
          if (holder) {
            holder.coins = A.addCoins(holder.coins, r.coins);
            for (const it of r.items) if (s.equipment.some((x) => x.id === it.equipmentId)) A.addToInventory(holder.inventory, it.equipmentId, it.qty);
          }
          // PE: ai membri dell'esplorazione in corso (divisi), altrimenti solo nel registro.
          const cur = DnD.sessioni.current(s);
          if (r.xp && cur.exploration) {
            const ids = (party ? party.memberIds : []).filter((id) => cur.exploration.members[id]);
            for (const id of ids) cur.exploration.members[id].xp += Math.floor(r.xp / ids.length);
          }
          // Negozi sbloccati: le righe con reputazione minima diventano libere nelle copie piazzate.
          for (const g of s.savedGrids) for (const it of g.items) if (it.otype === 'npc' && r.unlockMerchantIds.includes(it.npcId)) for (const l of it.npcState.stock) l.minRep = null;
          for (const n of s.worldNpcs) if (r.unlockMerchantIds.includes(n.id)) for (const l of n.merchant.stock) l.minRep = null;
        });
        for (const x of r.reputation) UM().applyReputation(party && party.id, x.factionId, x.delta, 'quest completata: ' + q.title, 'quest');
        worldLog('📜 Quest «' + q.title + '» completata.' + (r.xp ? ' ' + r.xp + ' PE.' : '') + (A.CURRENCIES.some((k) => r.coins[k]) ? ' ' + A.formatCoins(r.coins) + '.' : ''));
        UM().sound('fatto');
        fireLinkedEvent(q.onComplete);
        if (onDone) onDone();
        return undefined;
      } },
    ]);
  }

  // Obiettivi «Raccogli»: si ricontano gli oggetti di party e membri.
  function recountCollect() {
    UM().update((s, v) => {
      const party = DnD.party.active(v.parties, v.world);
      if (!party) return;
      const members = DnD.party.members(party, s.players).list;
      const countOf = (id) => members.concat([party]).reduce((n, h) => n + (h.inventory || []).filter((x) => x.equipmentId === id).reduce((a, x) => a + x.qty, 0), 0);
      Q.onCollect(v.world.quests, v.quests, countOf);
    });
  }

  // ---------- Diario del party ----------
  function journal(party, onChange) {
    const w = world();
    const j = w.world.quests;
    const list = Q.journalList(w.quests, j, filter).filter((q) => { const e = j[q.id]; return e && (e.offered || e.status !== 'disponibile') && (!e.partyId || e.partyId === party.id); });
    const search = el('input', { type: 'search', placeholder: 'Cerca…', value: filter.text, 'aria-label': 'Cerca nel diario', onchange: (e) => { filter.text = e.target.value.trim(); onChange(); } });
    const fsel = UM().factionSelect(filter.factionId, { empty: 'Tutte le fazioni', onchange: (e) => { filter.factionId = e.target.value; onChange(); } });
    const ssel = el('select', { 'aria-label': 'Stato', onchange: (e) => { filter.status = e.target.value; onChange(); } }, opt('', 'Tutti gli stati', !filter.status), K.QUEST_STATES.map((s) => opt(s, K.QUEST_STATE_NAMES[s], s === filter.status)));
    const bump = (q, o, d) => {
      UM().update((s, v) => { const e = Q.entryOf(v.world.quests, q.id); e.progress[o.id] = Math.max(0, Math.min(o.count, (e.progress[o.id] || 0) + d)); });
      onChange();
    };
    return el('section', { class: 'panel quest-journal' },
      el('div', { class: 'history-head' }, el('h2', { text: '📖 Diario delle quest' }), el('div', { class: 'head-actions' }, search, fsel, ssel)),
      list.length ? el('ul', { class: 'journal-list' }, list.map((q) => {
        const e = j[q.id];
        return el('li', { class: 'journal-entry' },
          el('div', { class: 'history-head' }, el('b', { text: q.title }), statusTag(e.status)),
          q.description ? el('p', { class: 'small muted', text: q.description }) : null,
          el('ul', { class: 'small' }, q.objectives.map((o) => el('li', { class: Q.objectiveDone(e, o) ? 'done' : '' }, (Q.objectiveDone(e, o) ? '✓ ' : '◻ ') + Q.objectiveText(o) + ' ' + (e.progress[o.id] || 0) + '/' + o.count + ' ',
            e.status === 'attiva' ? el('button', { type: 'button', class: 'btn small', text: '−', 'aria-label': 'Togli 1', onclick: () => bump(q, o, -1) }) : null,
            e.status === 'attiva' ? el('button', { type: 'button', class: 'btn small', text: '+', 'aria-label': 'Aggiungi 1', onclick: () => bump(q, o, 1) }) : null))),
          e.deadline !== null && e.status === 'attiva' ? el('p', { class: 'small', text: '⏳ Scade tra ' + Math.max(0, Math.round(e.deadline - nowHours())) + ' ore di gioco.' }) : null,
          e.status === 'attiva' ? el('div', { class: 'head-actions' }, el('button', { type: 'button', class: 'btn small primary', text: 'Consegna…', onclick: () => completeDialog(q, onChange) })) : null);
      })) : el('p', { class: 'muted small', text: 'Nessuna quest offerta o accettata (le quest si offrono dagli NPC o da Mondo › Quest).' }));
  }

  DnD.uiQuest = { render, reset: () => { editing = null; }, offerDialog, completeDialog, journal, recountCollect, worldLog, fireLinkedEvent };
})(globalThis.DnD = globalThis.DnD || {});
