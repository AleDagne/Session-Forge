// Giocatori › Party: più party per sessione, uno attivo. Nome, colore, icona, fazione, giocatori (anche
// leggendari: uno solo party per giocatore, spostamento con conferma), ordine di marcia, inventario e monete
// condivisi (facoltativi), note; pannello Reputazione (barre per fazione e storico) e Diario delle quest.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast } = DnD.ui;
  const P = DnD.party;
  const A = DnD.attrezzatura;
  const UM = () => DnD.uiMondo;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  let root = null;
  let editing = null;
  let viewing = null;

  const world = () => DnD.fazioni.view(DnD.store.state);
  const players = () => DnD.sessioni.visible(DnD.store.state, 'players');
  const sessionId = () => DnD.sessioni.current(DnD.store.state).id;

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) return renderForm();
    if (viewing && world().parties.some((p) => p.id === viewing)) return renderDetail(world().parties.find((p) => p.id === viewing));
    viewing = null;
    renderList();
  }

  function setActive(id) {
    UM().update((st, v) => { v.world.activePartyId = id; });
    toast('Party attivo cambiato.');
    render();
  }

  function renderList() {
    const w = world();
    const active = P.active(w.parties, w.world);
    const free = players().filter((p) => !P.partyOf(w.parties, p.id));
    root.append(el('div', { class: 'section-head' }, el('h2', { text: 'Party' }),
      el('div', { class: 'head-actions' }, el('button', { class: 'btn primary', text: '+ Nuovo party', onclick: () => { editing = 'new'; render(); } }))),
    el('p', { class: 'muted small', text: 'Il party attivo è quello usato da «Aggiungi party» nel Combattimento e nell\'Esplorazione, dai mercanti e dalla reputazione. Un giocatore sta in un solo party.' }),
    free.length ? el('p', { class: 'small warn-text', text: 'Senza party: ' + free.map((p) => p.name).join(', ') + '.' }) : '',
    w.parties.length ? el('div', { class: 'card-grid' }, w.parties.map((p) => {
      const m = P.members(p, players());
      return el('article', { class: 'card party-card' + (active && active.id === p.id ? ' active-party' : ''), style: '--party:' + p.color },
        el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(p.icon, 32), el('h3', { text: p.name }),
          active && active.id === p.id ? el('span', { class: 'tag accent', text: '★ Attivo' }) : null, p.shared ? el('span', { class: 'tag', text: 'Condiviso' }) : null), UM().factionBadge(p.factionId)),
        el('ol', { class: 'small march-order' }, m.list.map((x) => el('li', { text: x.name + (x.type === 'leggendario' ? ' ✦' : '') + ' · liv. ' + x.level }))),
        m.missing ? el('p', { class: 'small warn-text', text: '⚠ ' + m.missing + ' giocatori eliminati' }) : null,
        !m.list.length ? el('p', { class: 'muted small', text: 'Nessun membro.' }) : null,
        p.sharedPurse ? el('p', { class: 'small muted', text: '🎒 Borsa comune: ' + p.inventory.length + ' oggetti · ' + A.formatCoins(p.coins) }) : null,
        el('div', { class: 'card-actions' },
          el('button', { class: 'btn primary', text: 'Apri', onclick: () => { viewing = p.id; render(); } }),
          active && active.id === p.id ? null : el('button', { class: 'btn', text: '★ Rendi attivo', onclick: () => setActive(p.id) }),
          el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = p.id; render(); } }),
          el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(p) })));
    })) : DnD.ui.emptyState('Nessun party', 'Crea un party con i giocatori della sessione.', [{ text: '+ Nuovo party', primary: true, onclick: () => { editing = 'new'; render(); } }]));
  }

  function remove(p) {
    if (!confirm('Eliminare il party «' + p.name + '»? I giocatori restano, senza party; la reputazione del party si perde.')) return;
    UM().update((st, v) => {
      st.parties = st.parties.filter((x) => x.id !== p.id);
      if (v.world.activePartyId === p.id) v.world.activePartyId = '';
    });
    toast('Party eliminato.');
    render();
  }

  // Dettaglio: membri e ordine di marcia, reputazione, diario delle quest, borsa comune.
  function renderDetail(p) {
    const m = P.members(p, players());
    const move = (id, d) => { UM().update((st) => { P.moveInOrder(st.parties.find((x) => x.id === p.id), id, d); }); render(); };
    root.append(el('div', { class: 'section-head' },
      el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(p.icon, 36), el('h2', { text: p.name }), UM().factionBadge(p.factionId)),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn', text: '← Party', onclick: () => { viewing = null; render(); } }),
        ...DnD.uiRiposi.groupButtons(m.list.map((x) => x.id), 'del party'),
        el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = p.id; render(); } }))),
    el('div', { class: 'grid-2' },
      el('section', { class: 'panel' }, el('h3', { text: 'Ordine di marcia' }),
        m.list.length ? el('ol', { class: 'march-edit' }, m.list.map((x, i) => el('li', {},
          DnD.icone.iconCanvas(x.icon, 20), ' ', el('b', { text: x.name }), el('span', { class: 'muted small', text: ' · ' + (x.playerName || '') }),
          el('span', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn small', text: '↑', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => move(x.id, -1) }),
            el('button', { type: 'button', class: 'btn small', text: '↓', 'aria-label': 'Sposta giù', disabled: i === m.list.length - 1, onclick: () => move(x.id, 1) }))))) : el('p', { class: 'muted small', text: 'Nessun membro: aggiungili con Modifica.' }),
        p.notes ? el('p', { class: 'small muted', text: p.notes }) : null,
        p.sharedPurse ? purseBox(p) : null),
      UM().reputationPanel(p, render)),
    DnD.uiQuest.journal(p, render));
  }

  // Borsa comune: oggetti (dal catalogo) e monete.
  function purseBox(p) {
    const cat = DnD.store.state.equipment;
    const name = (id) => { const e = cat.find((x) => x.id === id); return e ? e.name : '⚠ oggetto eliminato'; };
    return el('div', { class: 'party-purse' }, el('h3', { text: '🎒 Borsa comune' }),
      p.inventory.length ? el('ul', { class: 'small' }, p.inventory.map((x) => el('li', { text: x.qty + '× ' + name(x.equipmentId) }))) : el('p', { class: 'muted small', text: 'Vuota.' }),
      el('p', { class: 'small', text: '🪙 ' + A.formatCoins(p.coins) }));
  }

  function renderForm() {
    const w = world();
    const existing = editing !== 'new' ? w.parties.find((x) => x.id === editing) : null;
    const p = existing ? clone(existing) : P.normalizeParty({ name: '', sessionId: sessionId() });
    if (!existing) p.name = '';
    const name = textInput(p.name, { maxlength: 60, 'data-key': 'name', placeholder: 'es. La Compagnia del Grifone' });
    const fs = UM().factionSelect(p.factionId);
    const icon = DnD.uiIcone.iconPicker(p.icon, false);
    const notes = el('textarea', { rows: 3, value: p.notes });
    const shared = el('input', { type: 'checkbox', checked: p.shared });
    const sharedPurse = el('input', { type: 'checkbox', checked: p.sharedPurse });
    const memberBox = el('ul', { class: 'pick-list' }, players().map((x) => {
      const other = P.partyOf(w.parties.filter((y) => y.id !== p.id), x.id);
      return el('li', {}, el('label', { class: 'check' }, el('input', { type: 'checkbox', value: x.id, checked: p.memberIds.includes(x.id) }), ' ', el('b', { text: x.name }),
        el('span', { class: 'muted small', text: (x.type === 'leggendario' ? ' ✦ leggendario' : '') + ' · liv. ' + x.level + (other ? ' · ora in «' + other.name + '»' : '') })));
    }));
    // Inventario comune: righe con oggetto e quantità; monete.
    const inv = clone(p.inventory);
    const invBox = el('div', { class: 'row-list' });
    const cat = DnD.store.state.equipment;
    const drawInv = () => clear(invBox).append(...inv.map((x, i) => el('div', { class: 'input-row' },
      el('select', { 'aria-label': 'Oggetto', onchange: (e) => { x.equipmentId = e.target.value; } }, cat.map((eq) => opt(eq.id, eq.name, eq.id === x.equipmentId)),
        cat.some((eq) => eq.id === x.equipmentId) ? null : opt(x.equipmentId, '⚠ oggetto eliminato', true)),
      numberInput(x.qty, { class: 'qty', min: 1, max: 100000, 'aria-label': 'Quantità', oninput: (e) => { x.qty = Math.max(1, readNumber(e.target) || 1); } }),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { inv.splice(i, 1); drawInv(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Oggetto', disabled: !cat.length, onclick: () => { inv.push({ id: DnD.dadi.uid(), equipmentId: cat[0].id, qty: 1, equipped: false }); drawInv(); } }));
    drawInv();
    const coinInputs = Object.fromEntries(A.CURRENCIES.map((k) => [k, numberInput(p.coins[k], { min: 0, max: 10000000, class: 'qty', 'aria-label': k })]));
    const purse = el('fieldset', {}, el('legend', { text: 'Inventario e monete condivisi' }),
      el('label', { class: 'check' }, sharedPurse, ' Usa una borsa comune del party (i mercanti possono usarla per pagare)'), invBox,
      el('div', { class: 'input-row' }, A.CURRENCIES.map((k) => el('label', { class: 'inline small' }, k, coinInputs[k]))));

    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-2' }, field('Nome', name, 'name'), field('Fazione', fs)),
      el('div', {}, el('span', { class: 'muted small', text: 'Colore ' }), UM().colorPicker(p.color, (c) => { p.color = c; })),
      icon.node,
      el('fieldset', {}, el('legend', { text: 'Giocatori' }), players().length ? memberBox : el('p', { class: 'muted small', text: 'Nessun giocatore nella sessione.' })),
      purse,
      field('Note', notes),
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
      const chosen = [...memberBox.querySelectorAll('input:checked')].map((i) => i.value);
      // Un giocatore in un altro party: si sposta, con conferma.
      const moving = chosen.map((id) => ({ id, from: P.partyOf(w.parties.filter((y) => y.id !== p.id), id) })).filter((x) => x.from);
      if (moving.length && !confirm('Spostare in «' + name.value.trim() + '»: ' + moving.map((x) => players().find((y) => y.id === x.id).name + ' (da «' + x.from.name + '»)').join(', ') + '?')) return;
      const coins = Object.fromEntries(A.CURRENCIES.map((k) => [k, Math.max(0, readNumber(coinInputs[k]) || 0)]));
      const saved = P.normalizeParty(Object.assign(p, { name: name.value.trim(), factionId: fs.value, icon: ir.icon, notes: notes.value, shared: shared.checked,
        sharedPurse: sharedPurse.checked, inventory: inv, coins, memberIds: [] }));
      UM().update((st, v) => {
        let target = st.parties.find((x) => x.id === saved.id);
        if (target) Object.assign(target, saved, { memberIds: target.memberIds.filter((id) => chosen.includes(id)), marchOrder: target.marchOrder.filter((id) => chosen.includes(id)) });
        else { st.parties.push(saved); target = saved; }
        for (const id of chosen) P.assignPlayer(v.parties.concat(v.parties.includes(target) ? [] : [target]), target.id, id);
        if (!v.world.activePartyId) v.world.activePartyId = target.id;
      });
      toast('Party salvato.', 'success');
      editing = null;
      viewing = saved.id;
      render();
    });
    root.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica party' : 'Nuovo party' })), form);
    name.focus();
  }

  DnD.uiParty = { render, reset: () => { editing = null; viewing = null; } };
})(globalThis.DnD = globalThis.DnD || {});
