// Riposi e risorse nell'interfaccia: elenco «Risorse» con − e + (anche risorse personalizzate), finestra del riposo
// breve o lungo (un riquadro per personaggio: dadi vita da spendere con i tiri modificabili e l'anteprima; regola
// delle 24 ore con «Forza»; riposo interrotto; turni di guardia nell'esplorazione) e riposo delle schede dei
// giocatori fuori dall'esplorazione (Giocatori, Party, fine del combattimento). La logica è in riposi.js.
(function (DnD) {
  'use strict';

  const { el, clear, fill, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const RP = DnD.riposi;
  const K = DnD.riposiDati;
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const session = (st) => DnD.sessioni.current(st || DnD.store.state);
  const variants = () => DnD.impostazioni.restOptions();
  // Combattimento attivo nella sessione: niente riposi.
  const combatActive = () => { const c = session().combat; return Boolean(c && c.phase === 'attivo'); };
  const BUSY = 'Non si riposa durante un combattimento attivo';

  // ---------- Elenco «Risorse» ----------
  // list: risorse (riposi.resources); onAdjust(id, delta); onCustom: { add(data), remove(id) } facoltativo.
  function resourcesBox(list, onAdjust, onCustom) {
    const row = (r) => el('li', { class: 'res-row' },
      el('span', { class: 'res-label', text: r.label }),
      el('span', { class: 'res-value', text: r.max === null ? String(r.value) : r.value + '/' + r.max }),
      el('span', { class: 'muted small', title: 'Si ripristina: ' + K.RESET_NAMES[r.reset], text: K.RESET_NAMES[r.reset] }),
      r.readonly ? el('span') : el('span', { class: 'head-actions' },
        el('button', { type: 'button', class: 'btn small', text: '−', 'aria-label': 'Togli 1 a ' + r.label, disabled: r.value <= 0, onclick: () => onAdjust(r.id, -1) }),
        el('button', { type: 'button', class: 'btn small', text: '+', 'aria-label': 'Aggiungi 1 a ' + r.label, disabled: r.max !== null && r.value >= r.max, onclick: () => onAdjust(r.id, 1) }),
        onCustom && r.kind === 'personalizzata' ? el('button', { type: 'button', class: 'btn small danger', text: '✕', 'aria-label': 'Elimina ' + r.label, onclick: () => onCustom.remove(r.resource.id) }) : null));
    const label = textInput('', { placeholder: 'es. Ispirazione bardica', maxlength: 40 });
    const max = numberInput(3, { class: 'qty', min: 1, max: 999 });
    const reset = el('select', {}, K.RESETS.map((k) => opt(k, K.RESET_NAMES[k], k === 'lungo')));
    return el('div', { class: 'res-box' },
      el('ul', { class: 'res-list' }, list.map(row)),
      onCustom ? el('details', { class: 'small' }, el('summary', { text: '+ Risorsa personalizzata' }),
        el('div', { class: 'input-row' }, field('Nome', label), field('Massimo', max), field('Si ripristina', reset),
          el('button', { type: 'button', class: 'btn small primary', text: 'Aggiungi', onclick: () => {
            if (!label.value.trim()) { toast('Scrivi il nome della risorsa.', 'error'); return; }
            onCustom.add({ label: label.value, max: readNumber(max) || 1, reset: reset.value });
          } }))) : null);
  }

  // ---------- Finestra del riposo ----------
  // o: { kind: 'breve' | 'lungo', title, subjects: [{ id, acc }] (accessori per l'anteprima), now (ore di gioco,
  // per la regola delle 24 ore), guards (nell'esplorazione), note, onConfirm(params) -> { ok, reason, lines } }.
  // params: { rolls: { id: [dadi] }, force, interruptAfter, guards: [id] }.
  function restDialog(o) {
    const long = o.kind === 'lungo';
    const hours = RP.hoursOf(o.kind, variants());
    const rolls = {};
    const body = el('div', { class: 'form rest-dialog' });
    let force = false;
    let interrupt = false;
    let interruptAfter = Math.max(0, hours - 1);
    const guardSet = new Set();
    function box(sub) {
      const s = sub.acc;
      const hp = s.getHp();
      if (!long) {
        const left = s.hd.total - s.hd.used;
        rolls[sub.id] = rolls[sub.id] || [];
        const count = numberInput(rolls[sub.id].length, { class: 'qty', min: 0, max: left, 'aria-label': 'Dadi vita da spendere per ' + s.name, oninput: () => {
          const n = Math.max(0, Math.min(left, readNumber(count) || 0));
          const cur = rolls[sub.id];
          if (n > cur.length) cur.push(...RP.rollHitDice(s, n - cur.length, DnD.dadi.randomInt).slice(0, n - cur.length));
          else cur.length = n;
          draw();
        } });
        const dice = rolls[sub.id].map((v, i) => numberInput(v, { class: 'qty', min: 1, max: s.hd.die, 'aria-label': 'Dado vita ' + (i + 1), oninput: (ev) => {
          rolls[sub.id][i] = Math.max(1, Math.min(s.hd.die, readNumber(ev.target) || 1));
          preview.textContent = previewText();
        } }));
        const previewText = () => {
          const gain = rolls[sub.id].reduce((n, v) => n + RP.healOf(s, v), 0);
          return 'PF ' + hp + ' → ' + Math.min(s.maxHp, hp + gain) + '/' + s.maxHp + (rolls[sub.id].length ? ' (+' + gain + ': d' + s.hd.die + ' ' + (s.conMod >= 0 ? '+' : '') + s.conMod + ' COS per dado)' : '');
        };
        const preview = el('span', { class: 'small', text: previewText() });
        return el('fieldset', { class: 'rest-box' }, el('legend', { text: s.name }),
          el('div', { class: 'input-row' }, field('Dadi vita da spendere (' + left + '/' + s.hd.total + ' d' + s.hd.die + ' rimasti)', count),
            dice.length ? el('div', { class: 'rest-dice', title: 'Tiri dei dadi vita: puoi cambiarli a mano' }, el('span', { class: 'muted small', text: 'Tiri:' }), dice) : null),
          preview);
      }
      const regain = variants().heroic ? s.hd.total : Math.max(1, Math.floor(s.hd.total / 2));
      const can = RP.canLongRest(s, o.now);
      return el('fieldset', { class: 'rest-box' }, el('legend', { text: s.name }),
        el('p', { class: 'small', text: 'PF ' + hp + ' → ' + s.maxHp + ' · dadi vita +' + Math.min(regain, s.hd.used) + ' (' + (s.hd.total - s.hd.used) + '/' + s.hd.total + ')' +
          (s.getTemp() ? ' · PF temporanei azzerati' : '') + (s.getExhaustion() ? ' · sfinimento ' + s.getExhaustion() + ' → ' + (s.getExhaustion() - 1) : '') + ' · slot e risorse ripristinati' }),
        can.ok ? null : el('p', { class: 'warn small', text: '⚠ Un solo riposo lungo ogni ' + K.LONG_EVERY + ' ore: mancano ' + can.wait + ' ore.' }));
    }
    function draw() {
      const blocked = long && o.subjects.some((x) => !RP.canLongRest(x.acc, o.now).ok);
      fill(body, 
        el('p', { class: 'muted small', text: (long ? 'Riposo lungo' : 'Riposo breve') + ': ' + hours + (hours === 1 ? ' ora' : ' ore') + (o.note ? ' · ' + o.note : '') + '.' }),
        o.subjects.length ? o.subjects.map(box) : el('p', { class: 'empty', text: 'Nessun personaggio.' }),
        o.guards && o.guards.length ? el('fieldset', {}, el('legend', { text: '🛡 Turni di guardia (in ordine)' }),
          el('div', { class: 'check-row' }, o.guards.map((g) => el('label', { class: 'check small' },
            el('input', { type: 'checkbox', checked: guardSet.has(g.id), onchange: (ev) => { if (ev.target.checked) guardSet.add(g.id); else guardSet.delete(g.id); } }), ' ' + g.name)))) : null,
        blocked ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: force, onchange: (ev) => { force = ev.target.checked; } }), ' Forza (master): riposo lungo anche prima delle 24 ore') : null,
        long ? el('div', { class: 'input-row' },
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: interrupt, onchange: (ev) => { interrupt = ev.target.checked; draw(); } }), ' Interrompi il riposo dopo'),
          interrupt ? numberInput(interruptAfter, { class: 'qty', min: 0, max: hours - 1, 'aria-label': 'Ore prima dell\'interruzione', oninput: (ev) => { interruptAfter = Math.max(0, Math.min(hours - 1, readNumber(ev.target) || 0)); } }) : null,
          interrupt ? el('span', { class: 'muted small', text: 'ore: nessun beneficio del riposo lungo (con almeno ' + K.INTERRUPT_SHORT + ' ora, quelli del riposo breve).' }) : null) : null);
    }
    draw();
    openDialog(o.title || (long ? '🛏 Riposo lungo' : '🛏 Riposo breve'), body, [
      { text: 'Annulla' },
      { text: long ? '🛏 Riposo lungo' : '🛏 Riposo breve', class: 'primary', onclick: () => {
        const r = o.onConfirm({ rolls, force, interruptAfter: interrupt ? interruptAfter : undefined, guards: o.guards ? o.guards.filter((g) => guardSet.has(g.id)).map((g) => g.id) : [] });
        if (!r || !r.ok) { toast((r && r.reason) || 'Riposo non riuscito.', 'error'); return false; }
        showSummary(r.lines);
        return undefined;
      } },
    ]);
  }
  function showSummary(lines) {
    if (!lines || !lines.length) return;
    toast(lines[lines.length - 1].replace(/^🛏 /, ''), 'success');
    openDialog('Riepilogo del riposo', el('ul', { class: 'rest-summary' }, lines.map((l) => el('li', { text: l }))), [{ text: 'Chiudi' }]);
  }

  // ---------- Schede dei giocatori (fuori dall'esplorazione) ----------
  const playersOf = (st, ids) => ids.map((id) => st.players.find((p) => p.id === id)).filter(Boolean);
  // Riposo delle schede: l'orologio dei riposi della sessione avanza della durata.
  function restPlayers(kind, ids, title) {
    if (combatActive()) { toast(BUSY + '.', 'error'); return; }
    const st = DnD.store.state;
    const se = session(st);
    // Con un'esplorazione in corso il riposo del gruppo passa da lì (tempo, scorte, incontri).
    if (se.exploration && DnD.uiEsplorazione && ids.every((id) => se.exploration.members[id])) { DnD.uiEsplorazione.restDialog(kind); return; }
    const preview = JSON.parse(JSON.stringify(st));
    const subjects = playersOf(preview, ids).map((p) => ({ id: p.id, acc: RP.fromSheet(p, preview) }));
    restDialog({ kind, title, subjects, now: se.restClock, onConfirm: (params) => {
      let out = { ok: true, lines: [] };
      DnD.store.update((s2) => {
        const ss = session(s2);
        const list = playersOf(s2, ids).map((p) => ({ p, acc: RP.fromSheet(p, s2) }));
        if (kind === 'lungo' && !params.force) {
          const tired = list.filter((x) => !RP.canLongRest(x.acc, ss.restClock).ok);
          if (tired.length) { out = { ok: false, reason: tired.map((x) => x.p.name).join(', ') + ': un solo riposo lungo ogni ' + K.LONG_EVERY + ' ore (spunta «Forza» per il master)' }; return; }
        }
        const hours = kind === 'lungo' && params.interruptAfter !== undefined ? params.interruptAfter : RP.hoursOf(kind, variants());
        ss.restClock += hours;
        for (const { p, acc } of list) {
          const r = kind === 'breve' ? RP.shortRest(acc, { rolls: params.rolls[p.id] || [] }) : RP.longRest(acc, { opts: variants(), interruptedAfter: params.interruptAfter });
          if (kind === 'lungo' && params.interruptAfter === undefined) acc.markLongRest(ss.restClock);
          out.lines.push(RP.summaryText(r));
        }
      });
      return out;
    } });
  }
  // Ripristina tutto (master: test e preparazione).
  function restoreAllPlayers(ids) {
    if (!confirm('Ripristinare tutto (PF, dadi vita, slot, risorse, sfinimento) per ' + ids.length + (ids.length === 1 ? ' personaggio' : ' personaggi') + '?')) return;
    const lines = [];
    DnD.store.update((st) => { for (const p of playersOf(st, ids)) lines.push(RP.summaryText(RP.restoreAll(RP.fromSheet(p, st)))); });
    showSummary(lines);
  }
  // Finestra «Risorse» di un giocatore: elenco con − e +, risorse personalizzate, riposi e ripristino.
  function playerDialog(id, onChange) {
    const body = el('div', { class: 'form' });
    const change = (fn) => { DnD.store.update((st) => { const p = st.players.find((x) => x.id === id); if (p) fn(p, st); }); draw(); if (onChange) onChange(); };
    function draw() {
      const st = DnD.store.state;
      const p = st.players.find((x) => x.id === id);
      if (!p) { clear(body); return; }
      const preview = JSON.parse(JSON.stringify(p));
      const acc = RP.fromSheet(preview, st);
      fill(body, 
        el('p', { class: 'small', text: 'PF ' + acc.getHp() + '/' + acc.maxHp + (acc.getTemp() ? ' (+' + acc.getTemp() + ' temporanei)' : '') }),
        el('div', { class: 'input-row' }, el('button', { type: 'button', class: 'btn small', text: '− 1 PF', onclick: () => change((q, s) => { const a = RP.fromSheet(q, s); a.setHp(a.getHp() - 1); }) }),
          el('button', { type: 'button', class: 'btn small', text: '+ 1 PF', onclick: () => change((q, s) => { const a = RP.fromSheet(q, s); a.setHp(a.getHp() + 1); }) })),
        resourcesBox(RP.resources(acc), (rid, d) => change((q, s) => RP.adjust(RP.fromSheet(q, s), rid, d)), {
          add: (data) => change((q) => { q.status = RP.normalizeStatus(q.status); q.status.resources.push(RP.normalizeResource(Object.assign({ value: data.max }, data))); }),
          remove: (rid) => change((q) => { q.status.resources = q.status.resources.filter((r) => r.id !== rid); }),
        }),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn', text: '🛏 Riposo breve', disabled: combatActive(), title: combatActive() ? BUSY : null, onclick: () => restPlayers('breve', [id]) }),
          el('button', { type: 'button', class: 'btn', text: '🛏 Riposo lungo', disabled: combatActive(), title: combatActive() ? BUSY : null, onclick: () => restPlayers('lungo', [id]) }),
          el('button', { type: 'button', class: 'btn small', text: '⟲ Ripristina tutto (master)', onclick: () => { restoreAllPlayers([id]); draw(); } })));
    }
    draw();
    openDialog('Risorse di ' + ((DnD.store.state.players.find((x) => x.id === id) || {}).name || ''), body, [{ text: 'Chiudi', onclick: () => { if (onChange) onChange(); } }]);
  }
  // Pulsanti di riposo per un gruppo di giocatori (Giocatori, Party).
  function groupButtons(ids, label) {
    const off = combatActive() || !ids.length;
    const title = combatActive() ? BUSY : !ids.length ? 'Nessun giocatore' : null;
    return [
      el('button', { type: 'button', class: 'btn', text: '🛏 Riposo breve' + (label ? ' ' + label : ''), disabled: off, title, onclick: () => restPlayers('breve', ids) }),
      el('button', { type: 'button', class: 'btn', text: '🛏 Riposo lungo' + (label ? ' ' + label : ''), disabled: off, title, onclick: () => restPlayers('lungo', ids) }),
      el('button', { type: 'button', class: 'btn small', text: '⟲ Ripristina tutto', title: 'Master: PF, dadi vita, slot, risorse e sfinimento al massimo', disabled: !ids.length, onclick: () => restoreAllPlayers(ids) }),
    ];
  }

  DnD.uiRiposi = { resourcesBox, restDialog, showSummary, restPlayers, restoreAllPlayers, playerDialog, groupButtons, combatActive, BUSY };
})(globalThis.DnD = globalThis.DnD || {});
