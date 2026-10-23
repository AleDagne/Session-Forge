// Condizioni nell'interfaccia: simboli con tooltip sulla scheda del combattente, riquadro di concentrazione e tiri
// contro la morte, finestra per applicare/modificare/togliere le condizioni (anche personalizzate), editor della
// «Condizione inflitta» per azioni delle creature e incantesimi, simboli per la pedina sulla griglia.
(function (DnD) {
  'use strict';

  const { el, clear, fill, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const C = DnD.condizioni;
  const AB = ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'];
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const customs = () => DnD.store.state.customConditions || [];
  const MAX_TOKEN_ICONS = 4;

  // Tooltip di una voce: nome, fonte, durata, incantesimo collegato, effetti e note.
  function tipOf(e, byId) {
    const d = C.defOf(e);
    return [d.name + (e.source.id ? ' — da ' + (e.source.name || 'fonte') : e.source.name && e.source.name !== 'manuale' ? ' — ' + e.source.name : ''),
      C.durationText(e, byId) + (e.spellId ? ' · legata alla concentrazione' : ''), d.text || '', d.effects.map((x) => '• ' + C.EFFECTS[x]).join('\n'), e.notes].filter(Boolean).join('\n');
  }
  // Simboli delle condizioni (clic = finestra delle condizioni).
  function chips(x, byId, onOpen) {
    const list = C.normalizeList(x.conditions);
    if (!list.length) return null;
    return el('div', { class: 'cond-chips' }, list.map((e) => {
      const d = C.defOf(e);
      return el('button', { type: 'button', class: 'cond-chip', style: '--cond:' + d.color, title: tipOf(e, byId), 'aria-label': d.name, onclick: onOpen },
        el('span', { text: d.icon }), e.type === 'sfinimento' ? el('b', { text: String(e.level) }) : null);
    }));
  }
  // Riquadro della scheda: condizioni, concentrazione e tiri contro la morte.
  function cardBox(x, byId, onOpen) {
    const ds = C.normalizeDeathSaves(x.deathSaves);
    const dots = (n, mark) => Array.from({ length: 3 }, (_, i) => el('span', { class: 'death-dot' + (i < n ? ' on ' + mark : '') }));
    const conc = x.concentration
      ? el('button', { type: 'button', class: 'tag conc-tag', title: 'Concentrazione su ' + x.concentration.name + ' (dal round ' + x.concentration.round + '). Clic per terminarla o modificarla.', onclick: onOpen, text: '◎ ' + x.concentration.name })
      : null;
    const death = ds.active || ds.stable
      ? el('div', { class: 'death-saves small', title: 'Tiri contro la morte: 3 successi = stabile, 3 fallimenti = morto' },
        el('span', { text: ds.stable ? 'Stabile ' : 'Contro la morte ' }), el('span', { class: 'muted', text: '✔' }), dots(ds.successes, 'ok'), el('span', { class: 'muted', text: ' ✖' }), dots(ds.failures, 'ko'))
      : null;
    const ch = chips(x, byId, onOpen);
    return ch || conc || death ? el('div', { class: 'cond-box' }, ch, conc, death) : null;
  }
  // Per la pedina: al massimo 4 simboli, gli altri come «+N», e la concentrazione.
  function tokenGlyphs(x) {
    const list = C.normalizeList(x.conditions);
    const icons = list.map((e) => { const d = C.defOf(e); return { icon: d.icon, color: d.color, level: e.type === 'sfinimento' ? e.level : 0 }; });
    return { icons: icons.slice(0, MAX_TOKEN_ICONS), more: Math.max(0, icons.length - MAX_TOKEN_ICONS), conc: x.concentration ? x.concentration.name : '' };
  }

  // Selettore del tipo: condizioni della tabella e personalizzate. value: 'tipo' oppure 'custom:id'.
  function typeSelect(value, empty) {
    const std = C.TYPES.map((t) => opt(t.id, t.icon + ' ' + t.name, value === t.id));
    const cust = customs().map((c) => opt('custom:' + c.id, c.icon + ' ' + c.name, value === 'custom:' + c.id));
    return el('select', {}, empty ? opt('', empty, !value) : null, el('optgroup', { label: 'Condizioni' }, std), cust.length ? el('optgroup', { label: 'Personalizzate' }, cust) : null);
  }
  // Campi della durata. d: oggetto modificato sul posto; whoOptions: [[id, nome]] per inizio/fine turno.
  function durationFields(d, whoOptions) {
    const kind = el('select', { onchange: () => { d.kind = kind.value; if (d.kind === 'minuto') d.rounds = 10; sync(); } }, C.DURATIONS.map((k) => opt(k, C.DURATION_NAMES[k], k === d.kind)));
    const rounds = numberInput(d.rounds || 1, { class: 'qty', min: 1, max: 1000, oninput: () => { d.rounds = Math.max(1, readNumber(rounds) || 1); } });
    const who = el('select', { onchange: () => { d.who = who.value; } }, whoOptions.map(([v, t]) => opt(v, t, v === d.who)));
    const ability = el('select', { onchange: () => { d.ability = ability.value; } }, AB.map((ab) => opt(ab, ab, ab === d.ability)));
    const dc = numberInput(d.dc || 10, { class: 'qty', min: 1, max: 40, oninput: () => { d.dc = readNumber(dc) || 10; } });
    const roundsF = field('Round', rounds);
    const whoF = field('Di chi', who);
    const saveF = el('div', { class: 'input-row' }, field('Salvezza su', ability), field('CD', dc));
    const sync = () => { roundsF.hidden = d.kind !== 'round'; whoF.hidden = !['inizio-turno', 'fine-turno'].includes(d.kind); saveF.hidden = d.kind !== 'salvezza'; if (!whoF.hidden && !d.who) d.who = who.value; };
    sync();
    return el('div', { class: 'grid-3 tight' }, field('Durata', kind), roundsF, whoF, saveF);
  }

  // ---------- Finestra delle condizioni di un combattente ----------
  // ctx: { mutate, log, byId, combatants(), after() }
  function dialog(id, ctx) {
    const body = el('div', { class: 'form cond-dialog' });
    let editingId = null;
    let lastRemoved = null; // { entry } per «↶ Annulla»
    const draft = () => ({ type: 'prono', level: 1, sourceId: '', duration: C.normalizeDuration({}), notes: '', linkSpell: false });
    let d = draft();
    const change = (fn, after) => { ctx.mutate((c) => { const t = c.combatants.find((y) => y.id === id); if (t) fn(c, t); }); if (ctx.after) ctx.after(); if (after) after(); draw(); };

    function applyDraft() {
      const isCustom = d.type.startsWith('custom:');
      const custom = isCustom ? customs().find((c) => 'custom:' + c.id === d.type) : null;
      if (isCustom && !custom) { toast('Condizione personalizzata non trovata.', 'error'); return; }
      change((c, t) => {
        const src = d.sourceId ? ctx.byId(d.sourceId) : null;
        const data = { type: isCustom ? 'custom' : d.type, custom, level: d.level, source: src ? { id: src.id, name: src.name } : { name: 'manuale' },
          duration: d.duration, notes: d.notes, spellId: d.linkSpell && src && src.concentration ? src.concentration.spellId : '' };
        if (editingId) { const old = C.normalizeList(t.conditions).find((e) => e.id === editingId); if (old && C.keyOf(old) !== C.keyOf(C.normalizeEntry(data))) C.remove(t, old.id); }
        const r = C.apply(t, data);
        ctx.log(c, r.ok ? 'condizione' : 'sistema', r.line);
      }, () => { editingId = null; d = draft(); });
    }

    function draw() {
      const x = ctx.byId(id);
      if (!x) { fill(body, el('p', { text: 'Il combattente non è più nel combattimento.' })); return; }
      const list = C.normalizeList(x.conditions);
      const others = ctx.combatants().filter((y) => y.id !== id);
      const rows = list.map((e) => {
        const def = C.defOf(e);
        return el('li', { class: 'cond-row', style: '--cond:' + def.color },
          el('span', { class: 'cond-chip', text: def.icon }),
          el('div', {}, el('b', { text: def.name }), el('div', { class: 'muted small', text: (e.source.id ? 'da ' + e.source.name + ' · ' : '') + C.durationText(e, ctx.byId) + (e.spellId ? ' · concentrazione' : '') + (e.notes ? ' · ' + e.notes : '') })),
          el('div', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn small', text: '✎', title: 'Modifica', onclick: () => {
              editingId = e.id;
              d = { type: e.type === 'custom' ? 'custom:' + e.custom.id : e.type, level: e.level || 1, sourceId: e.source.id, duration: Object.assign({}, e.duration), notes: e.notes, linkSpell: Boolean(e.spellId) };
              draw();
            } }),
            el('button', { type: 'button', class: 'btn small danger', text: '✕', title: 'Togli', onclick: () => change((c, t) => {
              const r = C.remove(t, e.id);
              if (r) { lastRemoved = r; ctx.log(c, 'sistema', t.name + ': ' + C.nameOf(r).toLowerCase() + ' tolta dal master.'); }
            }) })));
      });
      // Form: tipo, livello, fonte, durata, incantesimo collegato, note.
      const type = typeSelect(d.type);
      type.addEventListener('change', () => { d.type = type.value; draw(); });
      const level = numberInput(d.level, { class: 'qty', min: 1, max: 6, oninput: () => { d.level = Math.max(1, Math.min(6, readNumber(level) || 1)); } });
      const source = el('select', { onchange: () => { d.sourceId = source.value; draw(); } }, opt('', 'Manuale', !d.sourceId), others.map((y) => opt(y.id, y.name, y.id === d.sourceId)));
      const src = d.sourceId ? ctx.byId(d.sourceId) : null;
      const link = src && src.concentration ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: d.linkSpell, onchange: (ev) => { d.linkSpell = ev.target.checked; } }), ' Legata alla concentrazione di ' + src.name + ' su ' + src.concentration.name) : null;
      const notes = textInput(d.notes, { placeholder: 'facoltative', oninput: () => { d.notes = notes.value; } });
      const immune = !d.type.startsWith('custom:') && C.immuneTo(x, d.type);
      const ds = C.normalizeDeathSaves(x.deathSaves);
      const num = (v, onset) => { const n = numberInput(v, { class: 'qty', min: 0, max: 3, oninput: () => onset(Math.max(0, Math.min(3, readNumber(n) || 0))) }); return n; };
      fill(body, 
        list.length ? el('ul', { class: 'cond-list' }, rows) : el('p', { class: 'muted small', text: 'Nessuna condizione attiva.' }),
        lastRemoved ? el('button', { type: 'button', class: 'btn small', text: '↶ Annulla: rimetti ' + C.nameOf(lastRemoved).toLowerCase(), onclick: () => {
          const e = lastRemoved;
          lastRemoved = null;
          change((c, t) => { C.restore(t, e); ctx.log(c, 'sistema', t.name + ': ' + C.nameOf(e).toLowerCase() + ' rimessa (annulla).'); });
        } }) : null,
        el('fieldset', {}, el('legend', { text: editingId ? 'Modifica la condizione' : 'Applica una condizione' }),
          el('div', { class: 'grid-3 tight' }, field('Condizione', type), d.type === 'sfinimento' ? field('Livello (1-6)', level) : null, field('Causata da', source)),
          durationFields(d.duration, [[id, x.name]].concat(others.map((y) => [y.id, y.name]))),
          link,
          field('Note', notes),
          immune ? el('p', { class: 'warn small', text: '🛡 ' + x.name + ' è immune a questa condizione: l\'applicazione verrà rifiutata.' }) : null,
          el('div', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn primary small', text: editingId ? 'Salva la modifica' : 'Applica', onclick: applyDraft }),
            editingId ? el('button', { type: 'button', class: 'btn small', text: 'Annulla modifica', onclick: () => { editingId = null; d = draft(); draw(); } }) : null,
            el('button', { type: 'button', class: 'btn small', text: '✦ Condizioni personalizzate…', onclick: () => customDialog(draw) }))),
        el('fieldset', {}, el('legend', { text: '◎ Concentrazione' }),
          x.concentration ? el('p', { class: 'small', text: 'Concentrato su ' + x.concentration.name + ' (dal round ' + x.concentration.round + ').' }) : el('p', { class: 'muted small', text: 'Nessuna concentrazione: inizia lanciando un incantesimo con concentrazione.' }),
          el('div', { class: 'head-actions' },
            x.concentration ? el('button', { type: 'button', class: 'btn small danger', text: 'Termina la concentrazione', onclick: () => change((c, t) => { for (const l of C.endConcentration(t, c.combatants, 'scelta').lines) ctx.log(c, 'concentrazione', l); }) }) : null,
            x.concentrationUndo ? el('button', { type: 'button', class: 'btn small', text: '↶ Ripristina ' + x.concentrationUndo.concentration.name, title: 'Intervento del master: la concentrazione e i suoi effetti tornano', onclick: () => change((c, t) => {
              const name = t.concentrationUndo.concentration.name;
              if (C.restoreConcentration(t, c.combatants)) ctx.log(c, 'sistema', '◎ ' + t.name + ': concentrazione su ' + name + ' ripristinata dal master.');
            }) }) : null),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: x.concentrationAdv, onchange: (ev) => change((c, t) => { t.concentrationAdv = ev.target.checked; }) }),
            ' Vantaggio ai tiri salvezza di concentrazione (tratto)')),
        x.kind === 'player' || ds.active || ds.stable ? el('fieldset', {}, el('legend', { text: '🎲 Tiri contro la morte' }),
          el('div', { class: 'input-row' }, field('Successi', num(ds.successes, (n) => change((c, t) => { t.deathSaves = Object.assign(C.normalizeDeathSaves(t.deathSaves), { successes: n }); }))),
            field('Fallimenti', num(ds.failures, (n) => change((c, t) => { t.deathSaves = Object.assign(C.normalizeDeathSaves(t.deathSaves), { failures: n }); t.dead = n >= 3; })))),
          el('div', { class: 'head-actions' },
            el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: ds.stable, onchange: (ev) => change((c, t) => { t.deathSaves = Object.assign(C.normalizeDeathSaves(t.deathSaves), { stable: ev.target.checked, active: true }); }) }), ' Stabile'),
            el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: x.dead, onchange: (ev) => change((c, t) => { t.dead = ev.target.checked; ctx.log(c, 'sistema', t.name + (t.dead ? ' è morto (master).' : ' non è più morto (master).')); }) }), ' Morto'),
            C.dying(x) ? el('button', { type: 'button', class: 'btn small', text: '🎲 Tira ora', onclick: () => change((c, t) => { ctx.log(c, 'sistema', C.deathSave(t, DnD.dadi.randomInt).line); }) }) : null)) : null,
        el('label', { class: 'check small', title: 'Le condizioni bloccano Attacca, Lancia incantesimo, azioni delle creature, Scatto e Disimpegno' },
          el('input', { type: 'checkbox', checked: x.forceActions, onchange: (ev) => change((c, t) => { t.forceActions = ev.target.checked; ctx.log(c, 'sistema', t.name + (t.forceActions ? ': il master permette le azioni nonostante le condizioni.' : ': le condizioni bloccano di nuovo le azioni.')); }) }),
          ' Permetti comunque le azioni (master)'));
    }
    draw();
    openDialog('Condizioni di ' + (ctx.byId(id) || { name: '' }).name, body, [{ text: 'Chiudi' }]);
  }

  // ---------- Condizioni personalizzate (libreria globale) ----------
  function customDialog(onDone) {
    const body = el('div', { class: 'form' });
    let edit = null;
    const save = (c) => {
      const n = C.normalizeCustom(c);
      DnD.store.update((st) => {
        st.customConditions = st.customConditions || [];
        const i = st.customConditions.findIndex((x) => x.id === n.id);
        if (i >= 0) st.customConditions[i] = n; else st.customConditions.push(n);
      });
      edit = null;
      draw();
    };
    function draw() {
      const list = customs();
      const rows = list.map((c) => el('li', { class: 'cond-row', style: '--cond:' + c.color }, el('span', { class: 'cond-chip', text: c.icon }),
        el('div', {}, el('b', { text: c.name }), el('div', { class: 'muted small', text: c.effects.map((e) => C.EFFECTS[e]).join(' · ') || 'nessun effetto automatico' })),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn small', text: '✎', onclick: () => { edit = JSON.parse(JSON.stringify(c)); draw(); } }),
          el('button', { type: 'button', class: 'btn small danger', text: '✕', onclick: () => {
            if (!confirm('Eliminare «' + c.name + '»? Le copie già applicate nei combattimenti restano.')) return;
            DnD.store.update((st) => { st.customConditions = (st.customConditions || []).filter((x) => x.id !== c.id); });
            draw();
          } }))));
      const form = edit ? (() => {
        const name = textInput(edit.name, { maxlength: 40, oninput: () => { edit.name = name.value; } });
        const icon = textInput(edit.icon, { maxlength: 4, class: 'qty', oninput: () => { edit.icon = icon.value; } });
        const color = el('input', { type: 'color', value: edit.color, oninput: () => { edit.color = color.value; } });
        const desc = el('textarea', { rows: 2, value: edit.description, oninput: () => { edit.description = desc.value; } });
        return el('fieldset', {}, el('legend', { text: edit.id ? 'Modifica' : 'Nuova condizione' }),
          el('div', { class: 'grid-3 tight' }, field('Nome', name), field('Icona (simbolo)', icon), field('Colore', color)),
          field('Descrizione', desc),
          el('div', { class: 'check-row' }, C.EFFECT_IDS.map((k) => el('label', { class: 'check small' },
            el('input', { type: 'checkbox', checked: edit.effects.includes(k), onchange: (ev) => { edit.effects = ev.target.checked ? edit.effects.concat(k) : edit.effects.filter((x) => x !== k); } }), ' ' + C.EFFECTS[k]))),
          el('div', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn primary small', text: 'Salva', onclick: () => save(edit) }),
            el('button', { type: 'button', class: 'btn small', text: 'Annulla', onclick: () => { edit = null; draw(); } })));
      })() : el('button', { type: 'button', class: 'btn small', text: '+ Nuova condizione personalizzata', onclick: () => { edit = { name: '', icon: '✦', color: '#8b5cf6', description: '', effects: [] }; draw(); } });
      fill(body, list.length ? el('ul', { class: 'cond-list' }, rows) : el('p', { class: 'muted small', text: 'Nessuna condizione personalizzata.' }), form);
    }
    draw();
    openDialog('Condizioni personalizzate', body, [{ text: 'Chiudi', onclick: () => { if (onDone) onDone(); } }]);
  }

  // ---------- Editor «Condizione inflitta» ----------
  // inf: oggetto modificato sul posto (normalizeInflict); opts: { save: mostra «salvezza che la evita», note }.
  function inflictEditor(inf, opts) {
    const o = opts || {};
    const box = el('fieldset', { class: 'inflict-box' });
    function draw() {
      const value = inf.type === 'custom' ? 'custom:' + inf.customId : inf.type;
      const type = typeSelect(value, '— nessuna —');
      type.addEventListener('change', () => {
        const v = type.value;
        inf.type = v.startsWith('custom:') ? 'custom' : v;
        inf.customId = v.startsWith('custom:') ? v.slice(7) : '';
        draw();
      });
      const level = numberInput(inf.level || 1, { class: 'qty', min: 1, max: 6, oninput: () => { inf.level = Math.max(1, Math.min(6, readNumber(level) || 1)); } });
      inf.duration = inf.duration || C.normalizeDuration({});
      const save = inf.save || { ability: '', dc: null };
      const saveAb = el('select', { onchange: () => { inf.save = saveAb.value ? { ability: saveAb.value, dc: readNumber(saveDc) || null } : null; } }, opt('', 'nessuna', !save.ability), AB.map((ab) => opt(ab, ab, ab === save.ability)));
      const saveDc = numberInput(save.dc === null ? '' : save.dc, { class: 'qty', min: 1, max: 40, placeholder: 'CD', oninput: () => { if (inf.save) inf.save.dc = readNumber(saveDc) || null; } });
      fill(box, el('legend', { text: '🌀 Condizione inflitta' }),
        el('div', { class: 'grid-3 tight' }, field('Condizione', type), inf.type === 'sfinimento' ? field('Livello', level) : null,
          inf.type && o.save ? field('Salvezza che la evita', el('div', { class: 'input-row' }, saveAb, saveDc)) : null),
        inf.type ? durationFields(inf.duration, [['fonte', 'chi la causa'], ['bersaglio', 'il bersaglio']]) : null,
        o.note ? el('p', { class: 'muted small', text: o.note }) : null);
    }
    draw();
    return box;
  }

  DnD.uiCondizioni = { chips, cardBox, tokenGlyphs, dialog, customDialog, inflictEditor, tipOf };
})(globalThis.DnD = globalThis.DnD || {});
