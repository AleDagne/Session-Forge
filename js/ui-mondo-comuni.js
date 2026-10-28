// Accesso ai dati e componenti comuni del Mondo: vista della sessione, aggiornamento, pallini e distintivi delle
// fazioni, select di fazioni e città, campi «Mondo» dei form, barra e pannello della reputazione, colori, suoni.
// Livello interfaccia (sotto le sezioni del Mondo, dei Nemici e dei Giocatori). Espone DnD.uiMondoComuni; usa DnD.ui,
// fazioni, party, dati/mondo, sessioni, icone, colori, audio, store.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const F = DnD.fazioni;
  const K = DnD.mondoDati;
  const opt = (value, text, selected) => el('option', { value, text, selected });

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

  DnD.uiMondoComuni = {
    world, sessionId, factionById, activeParty, repWith, update, factionDot, factionBadge, factionSelect, citySelect, worldRefsEditor, repBar, levelTag, colorPicker, reputationPanel, applyReputation, sound,
  };
})(globalThis.DnD = globalThis.DnD || {});
