// Nemici › Creature: schede secondo il formato del Manuale dei Mostri. Elenco con ricerca, badge, duplica,
// elimina, esporta/importa JSON e "Condividi con tutte le sessioni"; form con calcoli automatici in tempo
// reale (modificatori, competenza e PE dal grado di sfida, PF dai dadi vita della taglia, tiri salvezza,
// abilità, Percezione passiva), editor meccanico di tratti, azioni, azioni bonus, reazioni, azioni
// leggendarie e di tana, incantesimi innati, vista scheda stampabile e "Stima CS" (Guida del DM).
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast } = DnD.ui;
  const K = DnD.creatureDati;
  const M = DnD.creature;
  const R = DnD.regole;
  const AB = R.ABILITIES;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let editing = null;   // id in modifica, 'new' o null
  let viewing = null;   // id della scheda in vista
  let query = '';
  let root = null;

  const session = () => DnD.sessioni.current(DnD.store.state);
  const list = () => DnD.sessioni.visible(DnD.store.state, 'npcs').filter((c) => c.type === 'creatura');
  const signed = (n) => R.formatModifier(n);

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else if (viewing && list().some((c) => c.id === viewing)) renderSheet(list().find((c) => c.id === viewing));
    else { viewing = null; renderList(); }
  }

  // ---------- Elenco ----------
  function renderList() {
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
      const f = importInput.files[0];
      importInput.value = '';
      if (f) DnD.uiCreature.importOne(f, () => render());
    } });
    const shown = list().filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()) || c.ctype.includes(query.toLowerCase()));
    root.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Creature' }),
        el('div', { class: 'head-actions' },
          el('input', { type: 'search', placeholder: 'Cerca per nome o tipo…', value: query, 'aria-label': 'Cerca', onchange: (e) => { query = e.target.value.trim(); render(); } }),
          el('button', { class: 'btn', text: '⬆ Importa JSON', onclick: () => importInput.click() }), importInput,
          el('button', { class: 'btn primary', text: '+ Nuova creatura', onclick: () => { editing = 'new'; render(); } }))),
      shown.length
        ? el('div', { class: 'card-grid' }, shown.map((c) => {
          const hp = M.hpInfo(c);
          return el('article', { class: 'card' },
            el('div', { class: 'card-title' },
              el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(c.icon, 32), el('h3', { text: c.name }),
                el('span', { class: 'tag accent', text: 'Creatura' }), c.shared ? el('span', { class: 'tag', text: 'Condivisa' }) : null),
              el('span', { class: 'ac-badge', text: 'CA ' + c.ac })),
            el('p', { class: 'muted small', text: M.typeLine(c) }),
            el('p', { text: 'PF ' + hp.text + ' · GS ' + M.crText(c) }),
            el('p', { class: 'small muted', text: [c.actions.length + ' azioni', c.legendary.length ? c.legendary.length + ' leggendarie' : '', c.innate.spells.length ? c.innate.spells.length + ' incantesimi innati' : ''].filter(Boolean).join(' · ') }),
            el('label', { class: 'check small' },
              el('input', { type: 'checkbox', checked: c.shared, onchange: (e) => { DnD.store.update(() => { c.shared = e.target.checked; }); render(); } }),
              ' Condividi con tutte le sessioni'),
            el('div', { class: 'card-actions' },
              el('button', { class: 'btn primary', text: 'Scheda', onclick: () => { viewing = c.id; render(); } }),
              el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = c.id; render(); } }),
              el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(c) }),
              el('button', { class: 'btn', text: 'Esporta', onclick: () => DnD.uiCreature.exportOne(c) }),
              el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(c) })));
        }))
        : el('p', { class: 'empty', text: query ? 'Nessuna creatura per «' + query + '».' : 'Nessuna creatura in questa sessione. Creane una o condividi quelle d\'esempio.' }));
  }

  function duplicate(c) {
    const copy = Object.assign(clone(c), { id: DnD.dadi.uid(), name: (c.name + ' (copia)').slice(0, 60), sessionId: session().id, shared: false });
    DnD.store.update((st) => { st.npcs.splice(st.npcs.indexOf(c) + 1, 0, copy); });
    toast('Creatura duplicata.');
    render();
  }
  function remove(c) {
    if (!confirm('Eliminare "' + c.name + '"?' + (c.shared ? '\nÈ condivisa: sparirà da tutte le sessioni.' : ''))) return;
    DnD.store.update((st) => { st.npcs = st.npcs.filter((x) => x.id !== c.id); });
    toast('Creatura eliminata.');
    render();
  }

  // ---------- Vista scheda (stile manuale, stampabile) ----------
  function statblock(c) {
    const hp = M.hpInfo(c);
    const line = (label, value) => (value ? el('p', { class: 'sb-line' }, el('b', { text: label + ' ' }), value) : null);
    const entries = (group) => c[group].map((a) => el('p', { class: 'sb-entry' }, el('b', { class: 'sb-entry-name', text: M.actionTitle(a) + '. ' }), M.actionText(c, a)));
    const section = (title, group, intro) => (c[group].length ? [el('h3', { class: 'sb-section', text: title }), intro ? el('p', { class: 'sb-entry', text: intro }) : null, ...entries(group)] : []);
    const innate = c.innate.spells.map((s) => ({ s, sp: DnD.store.state.spells.find((x) => x.id === s.spellId) })).filter((x) => x.sp);
    const imod = M.mod(c, c.innate.ability);
    const idc = c.innate.dcOverride === null ? 8 + M.prof(c) + imod : c.innate.dcOverride;
    const iatk = c.innate.attackOverride === null ? M.prof(c) + imod : c.innate.attackOverride;
    const atWill = innate.filter((x) => x.s.freq === 'volonta').map((x) => x.sp.name.toLowerCase());
    const daily = {};
    for (const x of innate.filter((y) => y.s.freq === 'giorno')) (daily[x.s.uses] = daily[x.s.uses] || []).push(x.sp.name.toLowerCase());
    return el('article', { class: 'statblock' },
      el('h2', { class: 'sb-name', text: c.name }),
      el('p', { class: 'sb-type', text: M.typeLine(c) }),
      el('hr', { class: 'sb-rule' }),
      line('Classe Armatura', c.ac + (c.acDesc ? ' (' + c.acDesc + ')' : '')),
      line('Punti ferita', hp.total + ' (' + hp.formula + ')'),
      line('Velocità', M.speedText(c)),
      el('hr', { class: 'sb-rule' }),
      el('table', { class: 'sb-abilities' },
        el('thead', {}, el('tr', {}, AB.map((ab) => el('th', { text: ab })))),
        el('tbody', {}, el('tr', {}, AB.map((ab) => el('td', { text: c.abilities[ab] + ' (' + signed(M.mod(c, ab)) + ')' }))))),
      el('hr', { class: 'sb-rule' }),
      line('Tiri salvezza', M.savesText(c)),
      line('Abilità', M.skillsText(c)),
      line('Vulnerabilità ai danni', M.defensesText(c.vulnerabilities)),
      line('Resistenze ai danni', M.defensesText(c.resistances)),
      line('Immunità ai danni', M.defensesText(c.immunities)),
      line('Immunità alle condizioni', c.conditionImmunities.join(', ')),
      line('Sensi', M.sensesText(c)),
      line('Linguaggi', c.languages || '—'),
      line('Sfida', M.crText(c)),
      el('hr', { class: 'sb-rule' }),
      c.legendaryResistance ? el('p', { class: 'sb-entry' }, el('b', { text: 'Resistenza leggendaria (' + c.legendaryResistance + '/giorno). ' }),
        'Se ' + c.name + ' fallisce un tiro salvezza, può scegliere di superarlo.') : null,
      innate.length ? el('p', { class: 'sb-entry' }, el('b', { text: 'Incantesimi innati. ' }),
        'La caratteristica da incantatore di ' + c.name + ' è ' + R.ABILITY_NAMES[c.innate.ability] + ' (CD del tiro salvezza degli incantesimi ' + idc + ', ' + signed(iatk) +
        ' al tiro per colpire con gli incantesimi). Può lanciare in modo innato i seguenti incantesimi, senza bisogno di componenti materiali: ' +
        [atWill.length ? 'a volontà: ' + atWill.join(', ') : '', ...Object.keys(daily).sort((a, b) => b - a).map((n) => n + '/giorno ciascuno: ' + daily[n].join(', '))].filter(Boolean).join('; ') + '.') : null,
      ...entries('traits'),
      ...section('Azioni', 'actions'),
      ...section('Azioni bonus', 'bonusActions'),
      ...section('Reazioni', 'reactions'),
      ...section('Azioni leggendarie', 'legendary', c.name + ' può effettuare ' + c.legendaryPoints + ' azioni leggendarie, scegliendole tra quelle qui sotto. Si può usare una sola azione leggendaria alla volta e solo alla fine del turno di un\'altra creatura. Le azioni leggendarie spese si recuperano all\'inizio del turno di ' + c.name + '.'),
      ...section('Azioni di tana', 'lair', 'A conteggio di iniziativa 20 (perdendo i pareggi), ' + c.name + ' può effettuare un\'azione di tana.'),
      c.notes ? el('p', { class: 'sb-notes muted', text: c.notes }) : null);
  }

  function renderSheet(c) {
    root.append(
      el('div', { class: 'section-head no-print' },
        el('h2', { text: 'Scheda: ' + c.name }),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn', text: '← Elenco', onclick: () => { viewing = null; render(); } }),
          el('button', { class: 'btn', text: '🖨 Stampa', onclick: () => window.print() }),
          el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = c.id; render(); } }))),
      statblock(c));
  }

  // ---------- Form ----------
  const opt = (value, text, selected) => el('option', { value, text, selected });

  function renderForm() {
    const existing = list().find((c) => c.id === editing);
    monsterForm(root, existing, {
      onDone: (saved) => { editing = null; viewing = saved ? saved.id : null; render(); },
    });
  }

  // Form della scheda del Manuale, usato da Creature e (con opts) dai Boss.
  // opts: { kind: 'creatura' | 'boss', defaults, heading, submitText, savedText,
  //         extra(m, ctx) -> { top: [nodi], bottom: [nodi], read() -> campi, validate(data) -> errori, refresh() },
  //         wrap(heading, form) -> nodo, onDone(salvato | null, nuovo) }
  // ctx: { refresh, icon, gridSize, isNew }.
  function monsterForm(host, existing, opts) {
    opts = opts || {};
    const kind = opts.kind || 'creatura';
    const m = existing ? clone(existing) : DnD.dati.normalizeCreature(Object.assign({ type: kind, name: '', size: 'Media', ctype: 'mostruosità', cr: '1', hitDice: 2,
      actions: [{ name: 'Morso', mech: { kind: 'attacco', range: 'mischia', damages: [{ dice: '1d6', type: 'perforante' }] } }] }, opts.defaults || {}), false);
    const derived = [];   // funzioni che aggiornano i valori calcolati
    const refresh = () => { for (const f of derived) f(); };
    const num = (value, attrs, onset) => numberInput(value, Object.assign({}, attrs, { oninput: (e) => { onset(readNumber(e.target)); refresh(); } }));
    const out = (fn) => { const o = el('output', { class: 'calc-detail' }); derived.push(() => { o.textContent = fn(); }); return o; };

    // --- Intestazione
    const name = textInput(m.name, { maxlength: 60, oninput: (e) => { m.name = e.target.value; refresh(); } });
    const size = el('select', { onchange: (e) => { m.size = e.target.value; gridSize.refresh(); refresh(); } }, K.SIZES.map((s) => opt(s, s, s === m.size)));
    const ctype = el('select', { onchange: (e) => { m.ctype = e.target.value; refresh(); } }, K.TYPES.map((t) => opt(t, t, t === m.ctype)));
    const subtype = textInput(m.subtype, { maxlength: 40, placeholder: 'facoltativo', oninput: (e) => { m.subtype = e.target.value; refresh(); } });
    const alignList = el('datalist', { id: 'allineamenti-' + DnD.dadi.uid().slice(0, 6) }, K.ALIGNMENTS.map((a) => el('option', { value: a })));
    const alignment = textInput(m.alignment, { maxlength: 60, list: alignList.id, oninput: (e) => { m.alignment = e.target.value; refresh(); } });
    const cr = el('select', { 'data-key': 'cr', onchange: (e) => { m.cr = e.target.value; refresh(); } }, K.CRS.map((x) => opt(x, x + ' (' + M.formatXp(M.xpForCr(x)) + ' PE)', x === m.cr)));
    const icon = DnD.uiIcone.iconPicker(m.icon, false, null, (x) => gridSize.suggest(x.grid, x.name));
    const gridSize = DnD.uiCreature.gridSizeEditor(m.gridSize, { size: () => m.size });
    const behavior = DnD.uiIa.behaviorEditor(m.behavior, {
      name: () => m.name.trim(),
      combatant: () => ({ id: 'anteprima', abilities: m.abilities, weapons: [], spellcasting: null, creature: DnD.creature.combatState(DnD.creature.normalizeMonster(m)) }),
    });

    // --- Difesa, PF, velocità
    const hpOverride = numberInput(m.hpOverride, { min: 1, max: 9999, placeholder: 'media', 'data-key': 'hpOverride', oninput: (e) => { m.hpOverride = e.target.value.trim() === '' ? null : readNumber(e.target); refresh(); } });
    const speedBox = el('div', { class: 'grid-3 tight' }, K.SPEEDS.map((k) => field(K.SPEED_NAMES[k] + ' (m)', num(m.speed[k], { min: 0, max: 300, step: 1.5, 'data-key': 'speed.' + k }, (v) => { m.speed[k] = v; }), 'speed.' + k)),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: m.speed.hover, onchange: (e) => { m.speed.hover = e.target.checked; refresh(); } }), ' Fluttuare'));

    // --- Caratteristiche, salvezze, abilità
    const abilityRow = el('div', { class: 'ability-row' }, AB.map((ab) => el('div', { class: 'ability-cell' },
      el('div', { class: 'ability-label', title: R.ABILITY_NAMES[ab], text: ab }),
      num(m.abilities[ab], { min: 1, max: 30, 'aria-label': R.ABILITY_NAMES[ab], 'data-key': 'abilities.' + ab }, (v) => { m.abilities[ab] = v; }),
      out(() => (Number.isFinite(m.abilities[ab]) ? signed(R.modifier(m.abilities[ab])) : '—')),
      el('div', { class: 'error', 'data-error': 'abilities.' + ab }))));
    const savesBox = el('div', { class: 'check-row' }, AB.map((ab) => el('label', { class: 'check small' },
      el('input', { type: 'checkbox', checked: m.saves.includes(ab), onchange: (e) => { m.saves = e.target.checked ? m.saves.concat(ab) : m.saves.filter((x) => x !== ab); refresh(); } }),
      ' ' + ab + ' ', out(() => signed(M.saveBonus(m, ab))))));
    const skillsBox = el('div', { class: 'skills-grid' }, Object.keys(K.SKILLS).map((sk) => el('label', { class: 'skill-row' },
      el('span', { text: sk + ' (' + K.SKILLS[sk] + ')' }),
      el('select', { 'aria-label': 'Competenza in ' + sk, onchange: (e) => { if (e.target.value === '0') delete m.skills[sk]; else m.skills[sk] = Number(e.target.value); refresh(); } },
        opt('0', '—', !m.skills[sk]), opt('1', 'Competenza', m.skills[sk] === 1), opt('2', 'Maestria (×2)', m.skills[sk] === 2)),
      out(() => signed(M.skillBonus(m, sk))))));

    // --- Difese e condizioni
    const multi = (key, items, names) => el('div', { class: 'check-row defense-row' }, items.map((t) => el('label', { class: 'check small' },
      el('input', { type: 'checkbox', checked: m[key].includes(t), onchange: (e) => { m[key] = e.target.checked ? m[key].concat(t) : m[key].filter((x) => x !== t); refresh(); } }),
      ' ' + (names ? names[t] : t))));
    const sensesBox = el('div', { class: 'grid-3 tight' }, K.SENSES.map((k) => field(K.SENSE_NAMES[k] + ' (m)', num(m.senses[k], { min: 0, max: 1000, step: 1.5 }, (v) => { m.senses[k] = Number.isFinite(v) ? v : 0; }))),
      field('Percezione passiva (vuoto = automatica)', numberInput(m.passiveOverride, { min: 1, max: 50, placeholder: 'auto', oninput: (e) => { m.passiveOverride = e.target.value.trim() === '' ? null : readNumber(e.target); refresh(); } })));
    const languages = textInput(m.languages, { maxlength: 300, placeholder: 'es. Comune, Draconico', oninput: (e) => { m.languages = e.target.value; } });

    // --- Azioni (per gruppo)
    const groupBoxes = {};
    for (const g of K.GROUPS) groupBoxes[g] = el('div', { class: 'action-list' });
    const allIds = () => K.GROUPS.flatMap((g) => m[g].map((a) => ({ id: a.id, name: a.name, kind: a.mech.kind })));

    function damageRows(mech, i, a) {
      const box = el('div', { class: 'damage-rows' });
      const draw = () => {
        clear(box).append(...mech.damages.map((d, j) => el('div', { class: 'input-row damage-row' },
          el('span', { class: 'muted small', text: j ? 'più' : 'Danno' }),
          textInput(d.dice, { class: 'qty', 'aria-label': 'Dado di danno', 'data-key': a.group + '.' + i + '.dice', oninput: (e) => { d.dice = e.target.value.trim(); refresh(); } }),
          numberInput(d.bonus, { class: 'qty', placeholder: j === 0 && mech.kind === 'attacco' ? 'mod.' : '0', 'aria-label': 'Bonus al danno', oninput: (e) => { d.bonus = e.target.value.trim() === '' ? null : readNumber(e.target); refresh(); } }),
          el('select', { 'aria-label': 'Tipo di danno', onchange: (e) => { d.type = e.target.value; refresh(); } }, opt('', '— tipo —', !d.type), K.DAMAGE_TYPES.map((t) => opt(t, t, t === d.type))),
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli il danno', onclick: () => { mech.damages.splice(j, 1); draw(); refresh(); } }))),
        el('button', { type: 'button', class: 'btn small', text: mech.damages.length ? '+ Danno aggiuntivo' : '+ Danno', onclick: () => { mech.damages.push({ dice: '1d6', bonus: mech.damages.length || mech.kind !== 'attacco' ? 0 : null, type: '' }); draw(); refresh(); } }));
      };
      draw();
      return box;
    }

    function mechFields(a, i) {
      const mech = a.mech;
      const set = (k) => (e) => { mech[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; refresh(); };
      const setNum = (k, nullable) => (e) => { mech[k] = nullable && e.target.value.trim() === '' ? null : readNumber(e.target); refresh(); };
      const abSel = (k) => el('select', { onchange: set(k) }, AB.map((ab) => opt(ab, R.ABILITY_NAMES[ab], ab === mech[k])));
      if (mech.kind === 'attacco') {
        return el('div', { class: 'mech-fields' },
          el('div', { class: 'grid-3 tight' },
            field('Tipo', el('select', { onchange: set('range') }, K.RANGES.map((r) => opt(r, K.RANGE_NAMES[r], r === mech.range)))),
            field('Caratteristica', abSel('ability')),
            field('Bonus per colpire', el('div', { class: 'input-row' }, numberInput(mech.toHit, { class: 'qty', placeholder: 'auto', oninput: setNum('toHit', true) }),
              out(() => 'suggerito ' + signed(M.prof(m) + M.mod(m, mech.ability)))))),
          el('div', { class: 'grid-3 tight' },
            field('Portata (m)', numberInput(mech.reach, { min: 0, step: 1.5, oninput: setNum('reach') })),
            field('Gittata normale/lunga (m)', el('div', { class: 'input-row' }, numberInput(mech.rangeNormal, { class: 'qty', min: 0, oninput: setNum('rangeNormal') }), '/',
              numberInput(mech.rangeLong, { class: 'qty', min: 0, oninput: setNum('rangeLong') }))),
            field('Bersagli', textInput(mech.targets, { oninput: set('targets') }))),
          damageRows(mech, i, a),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: mech.magical, onchange: set('magical') }), ' Attacco magico (supera le resistenze ai danni non magici)'),
          DnD.uiCondizioni.inflictEditor(mech.inflict = mech.inflict || DnD.condizioni.normalizeInflict({}), { save: true, note: 'Si applica a chi viene colpito (se indicata, la salvezza la evita).' }));
      }
      if (mech.kind === 'salvezza') {
        return el('div', { class: 'mech-fields' },
          el('div', { class: 'grid-3 tight' },
            field('Tiro salvezza su', abSel('ability')),
            field('CD da', abSel('dcAbility')),
            field('CD', el('div', { class: 'input-row' }, numberInput(mech.dc, { class: 'qty', placeholder: 'auto', oninput: setNum('dc', true) }),
              out(() => 'suggerita ' + (8 + M.prof(m) + M.mod(m, mech.dcAbility)))))),
          el('div', { class: 'grid-3 tight' },
            field('Area (facoltativa)', textInput(mech.area, { placeholder: 'es. cono di 9 m', oninput: set('area') })),
            field('Effetto se fallisce', textInput(mech.effect, { placeholder: 'es. cade prono', oninput: set('effect') })),
            el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: mech.half, onchange: set('half') }), ' Metà danni se riesce')),
          damageRows(mech, i, a),
          DnD.uiCondizioni.inflictEditor(mech.inflict = mech.inflict || DnD.condizioni.normalizeInflict({}), { note: 'Si applica a chi fallisce il tiro salvezza dell\'azione.' }));
      }
      if (mech.kind === 'cura') {
        return el('div', { class: 'mech-fields grid-3 tight' },
          field('Dadi di cura', textInput(mech.dice, { oninput: set('dice') })), field('Bonus', numberInput(mech.bonus, { oninput: setNum('bonus') })));
      }
      if (mech.kind === 'multiattacco') {
        const box = el('div', { class: 'mech-fields' });
        const draw = () => {
          const choices = allIds().filter((x) => x.id !== a.id && x.kind !== 'multiattacco');
          clear(box).append(...mech.parts.map((p, j) => el('div', { class: 'input-row' },
            numberInput(p.count, { class: 'qty', min: 1, max: 10, 'aria-label': 'Volte', oninput: (e) => { p.count = readNumber(e.target); refresh(); } }), '×',
            el('select', { 'aria-label': 'Azione', 'data-key': a.group + '.' + i + '.parts', onchange: (e) => { p.actionId = e.target.value; refresh(); } },
              choices.map((x) => opt(x.id, x.name, x.id === p.actionId))),
            el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { mech.parts.splice(j, 1); draw(); refresh(); } }))),
          el('button', { type: 'button', class: 'btn small', text: '+ Aggiungi azione', onclick: () => {
            const first = allIds().find((x) => x.id !== a.id && x.kind !== 'multiattacco');
            if (!first) { toast('Crea prima le azioni da usare nel multiattacco.', 'error'); return; }
            mech.parts.push({ actionId: first.id, count: 1 });
            draw();
            refresh();
          } }),
          el('div', { class: 'error', 'data-error': a.group + '.' + i + '.parts' }));
        };
        draw();
        return box;
      }
      return el('p', { class: 'muted small', text: 'Solo testo: scrivi la descrizione qui sotto.' });
    }

    function actionEditor(g, a, i) {
      a.group = g;
      const f = a.freq;
      const gen = out(() => { const t = M.generatedText(m, a); return t === null ? '' : 'Testo generato: ' + t; });
      const desc = el('textarea', { rows: 2, value: a.desc, placeholder: 'Descrizione', oninput: (e) => { a.desc = e.target.value; } });
      const custom = el('input', { type: 'checkbox', checked: a.customText || a.mech.kind === 'testo', onchange: (e) => { a.customText = e.target.checked; if (e.target.checked && !a.desc) { a.desc = M.generatedText(m, a) || ''; desc.value = a.desc; } sync(); } });
      const sync = () => { desc.hidden = !(a.customText || a.mech.kind === 'testo'); custom.closest('label').hidden = a.mech.kind === 'testo'; };
      const freqUses = numberInput(f.uses, { class: 'qty', min: 1, max: 20, 'aria-label': 'Usi al giorno', oninput: (e) => { f.uses = readNumber(e.target); refresh(); } });
      const freqRecharge = el('select', { 'aria-label': 'Ricarica', onchange: (e) => { f.recharge = Number(e.target.value); refresh(); } }, [6, 5, 4].map((n) => opt(String(n), n === 6 ? '6' : n + '–6', n === f.recharge)));
      const freqSync = () => { freqUses.hidden = f.kind !== 'giorno'; freqRecharge.hidden = f.kind !== 'ricarica'; };
      const node = el('div', { class: 'action-editor' },
        el('div', { class: 'input-row' },
          textInput(a.name, { maxlength: 80, 'aria-label': 'Nome', 'data-key': g + '.' + i + '.name', oninput: (e) => { a.name = e.target.value; refresh(); } }),
          el('select', { 'aria-label': 'Meccanica', onchange: (e) => {
            const kind = e.target.value;
            a.mech = M.normalizeMech(Object.assign({ kind }, kind === 'attacco' ? { damages: [{ dice: '1d6' }] } : kind === 'salvezza' ? { damages: [{ dice: '2d6', bonus: 0 }] } : {}));
            drawGroup(g);
            refresh();
          } }, K.MECHS.map((k) => opt(k, K.MECH_NAMES[k], k === a.mech.kind))),
          el('select', { 'aria-label': 'Frequenza', onchange: (e) => { f.kind = e.target.value; freqSync(); refresh(); } }, K.FREQS.map((k) => opt(k, K.FREQ_NAMES[k], k === f.kind))),
          freqUses, freqRecharge,
          g === 'legendary' ? el('label', { class: 'inline small' }, 'costo', numberInput(a.cost || 1, { class: 'qty', min: 1, max: 3, oninput: (e) => { a.cost = readNumber(e.target); refresh(); } })) : null,
          el('button', { type: 'button', class: 'icon-btn', text: '↑', 'aria-label': 'Sposta su', onclick: () => { if (i > 0) { [m[g][i - 1], m[g][i]] = [m[g][i], m[g][i - 1]]; drawGroup(g); } } }),
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Elimina', onclick: () => { m[g].splice(i, 1); drawGroup(g); refresh(); } })),
        el('div', { class: 'error', 'data-error': g + '.' + i + '.name' }),
        el('div', { class: 'error', 'data-error': g + '.' + i + '.dice' }),
        mechFields(a, i),
        gen,
        el('label', { class: 'check small' }, custom, ' Testo personalizzato (scritto a mano)'),
        desc);
      sync();
      freqSync();
      return node;
    }
    function drawGroup(g) {
      clear(groupBoxes[g]).append(...m[g].map((a, i) => actionEditor(g, a, i)),
        el('button', { type: 'button', class: 'btn small', text: '+ Aggiungi', onclick: () => {
          m[g].push(M.normalizeAction(g === 'traits' || g === 'lair' ? { name: 'Nuovo tratto', mech: { kind: 'testo' }, customText: true }
            : { name: 'Nuova azione', mech: { kind: 'attacco', damages: [{ dice: '1d6' }] } }, g));
          drawGroup(g);
          refresh();
        } }));
      refresh();
    }

    // --- Incantesimi innati
    const innateBox = el('div', {});
    function drawInnate() {
      const spells = DnD.store.state.spells;
      clear(innateBox).append(
        el('div', { class: 'grid-3 tight' },
          field('Caratteristica', el('select', { onchange: (e) => { m.innate.ability = e.target.value; refresh(); } }, AB.map((ab) => opt(ab, R.ABILITY_NAMES[ab], ab === m.innate.ability)))),
          field('CD', el('div', { class: 'input-row' }, numberInput(m.innate.dcOverride, { class: 'qty', placeholder: 'auto', oninput: (e) => { m.innate.dcOverride = e.target.value.trim() === '' ? null : readNumber(e.target); refresh(); } }),
            out(() => 'auto ' + (8 + M.prof(m) + M.mod(m, m.innate.ability))))),
          field('Bonus di attacco', el('div', { class: 'input-row' }, numberInput(m.innate.attackOverride, { class: 'qty', placeholder: 'auto', oninput: (e) => { m.innate.attackOverride = e.target.value.trim() === '' ? null : readNumber(e.target); refresh(); } }),
            out(() => 'auto ' + signed(M.prof(m) + M.mod(m, m.innate.ability)))))),
        ...m.innate.spells.map((s, j) => el('div', { class: 'input-row' },
          el('select', { 'aria-label': 'Incantesimo', onchange: (e) => { s.spellId = e.target.value; } }, spells.map((sp) => opt(sp.id, sp.name + ' (' + DnD.magie.levelName(sp.level) + ')', sp.id === s.spellId))),
          el('select', { 'aria-label': 'Frequenza', onchange: (e) => { s.freq = e.target.value; drawInnate(); } }, opt('volonta', 'A volontà', s.freq === 'volonta'), opt('giorno', 'N al giorno', s.freq === 'giorno')),
          s.freq === 'giorno' ? numberInput(s.uses, { class: 'qty', min: 1, max: 9, 'aria-label': 'Usi al giorno', oninput: (e) => { s.uses = readNumber(e.target); } }) : null,
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { m.innate.spells.splice(j, 1); drawInnate(); } }))),
        el('button', { type: 'button', class: 'btn small', text: '+ Incantesimo innato', onclick: () => {
          if (!spells.length) { toast('La libreria Magie è vuota.', 'error'); return; }
          m.innate.spells.push({ spellId: spells[0].id, freq: 'volonta', uses: 1 });
          drawInnate();
        } }),
        el('p', { class: 'muted small', text: 'Nel combattimento si lanciano con il sistema Magie, senza consumare slot (gli usi al giorno si contano).' }));
    }

    // --- Stima del grado di sfida
    const crBox = el('div', { class: 'cr-estimate', 'aria-live': 'polite' });
    const estimate = () => {
      const e = M.estimateCr(DnD.creature.normalizeMonster(m));
      clear(crBox).append(el('p', {}, el('b', { text: 'CS stimato: ' + e.estimate }), ' · dichiarato: ' + m.cr + (e.estimate === m.cr ? ' ✓' : '')),
        el('p', { class: 'muted small', text: 'Difensivo ' + e.defensive + ' (PF ' + e.hp + (e.effHp !== e.hp ? ', effettivi ' + e.effHp : '') + ', CA ' + e.ac + ') · Offensivo ' + e.offensive +
          ' (danni per round ' + e.dpr + (e.from ? ' da «' + e.from + '»' : '') + (e.bonus !== null ? ', ' + (e.bonusKind === 'salvezza' ? 'CD ' + e.bonus : 'per colpire ' + signed(e.bonus)) : '') + '). Il CS dichiarato non viene modificato.' }));
    };

    const errorsTop = el('div', { class: 'error', 'aria-live': 'polite' });
    const extra = opts.extra ? opts.extra(m, { refresh, icon, gridSize, isNew: !existing }) : null;
    if (extra && extra.refresh) derived.push(extra.refresh);
    const form = el('form', { class: 'panel form monster-form', novalidate: true },
      ...(extra && extra.top ? extra.top : []),
      el('div', { class: 'grid-3' }, field('Nome', name, 'name'), field('Taglia', size), field('Tipo', ctype),
        field('Sottotipo', subtype), el('div', { class: 'field' }, el('label', { text: 'Allineamento' }), alignment, alignList), field('Grado di sfida', cr, 'cr')),
      el('p', { class: 'muted small' }, out(() => 'Competenza ' + signed(M.prof(m)) + ' · ' + M.formatXp(M.xpForCr(m.cr)) + ' PE · dado vita d' + M.hitDieFor(m.size))),
      icon.node, gridSize.node, opts.worldRefs === false ? null : DnD.uiMondo.worldRefsEditor(m, { live: true }).node, behavior.node,
      el('fieldset', {}, el('legend', { text: 'Difesa e punti ferita' }),
        el('div', { class: 'grid-3 tight' },
          field('Classe Armatura', num(m.ac, { min: 1, max: 40, 'data-key': 'ac' }, (v) => { m.ac = v; }), 'ac'),
          field('Descrizione della CA', textInput(m.acDesc, { placeholder: 'es. armatura naturale', oninput: (e) => { m.acDesc = e.target.value; } })),
          field('Numero di dadi vita', num(m.hitDice, { min: 1, max: 100, 'data-key': 'hitDice' }, (v) => { m.hitDice = v; }), 'hitDice')),
        el('div', { class: 'grid-2 tight' }, field('PF (vuoto = media)', hpOverride, 'hpOverride'),
          el('p', { class: 'calc-line' }, out(() => (Number.isInteger(m.hitDice) && Number.isFinite(m.abilities.COS) ? 'PF ' + M.hpInfo(m).text : 'PF: completa dadi vita e COS'))))),
      el('fieldset', {}, el('legend', { text: 'Velocità' }), speedBox),
      el('fieldset', { class: 'abilities' }, el('legend', { text: 'Caratteristiche' }), abilityRow),
      el('fieldset', {}, el('legend', { text: 'Tiri salvezza (competenza)' }), savesBox),
      el('fieldset', {}, el('legend', { text: 'Abilità' }), skillsBox),
      el('fieldset', {}, el('legend', { text: 'Vulnerabilità ai danni' }), multi('vulnerabilities', K.DEFENSE_TYPES, K.DEFENSE_NAMES)),
      el('fieldset', {}, el('legend', { text: 'Resistenze ai danni' }), multi('resistances', K.DEFENSE_TYPES, K.DEFENSE_NAMES)),
      el('fieldset', {}, el('legend', { text: 'Immunità ai danni' }), multi('immunities', K.DEFENSE_TYPES, K.DEFENSE_NAMES)),
      el('fieldset', {}, el('legend', { text: 'Immunità alle condizioni' }), multi('conditionImmunities', K.CONDITIONS)),
      el('fieldset', {}, el('legend', { text: 'Sensi e linguaggi' }), sensesBox, el('p', { class: 'calc-line' }, out(() => M.sensesText(m))), field('Linguaggi', languages)),
      ...K.GROUPS.map((g) => el('fieldset', { class: 'action-group' }, el('legend', { text: K.GROUP_NAMES[g] }),
        g === 'legendary' ? el('div', { class: 'grid-2 tight' },
          field('Punti azione leggendaria per round', num(m.legendaryPoints, { min: 1, max: 10, 'data-key': 'legendaryPoints' }, (v) => { m.legendaryPoints = v; }), 'legendaryPoints'),
          field('Resistenza leggendaria (usi al giorno)', num(m.legendaryResistance, { min: 0, max: 10, 'data-key': 'legendaryResistance' }, (v) => { m.legendaryResistance = v; }), 'legendaryResistance')) : null,
        g === 'lair' ? el('p', { class: 'muted small', text: 'Nel combattimento compaiono come promemoria a iniziativa 20 (nessuna automazione).' }) : null,
        groupBoxes[g])),
      el('fieldset', {}, el('legend', { text: 'Incantesimi innati' }), innateBox),
      field('Note', el('textarea', { rows: 3, value: m.notes, oninput: (e) => { m.notes = e.target.value; } })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: m.shared, onchange: (e) => { m.shared = e.target.checked; } }), ' Condividi con tutte le sessioni (modello riutilizzabile)'),
      el('fieldset', {}, el('legend', { text: 'Stima del grado di sfida' }),
        el('button', { type: 'button', class: 'btn small', text: '📊 Stima CS', onclick: estimate }), crBox),
      ...(extra && extra.bottom ? extra.bottom : []),
      errorsTop,
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => opts.onDone && opts.onDone(null, false) }),
        el('button', { type: 'button', class: 'btn', text: 'Anteprima scheda', onclick: () => {
          const v = DnD.dati.normalizeCreature(Object.assign(clone(m), { icon: icon.read().icon || m.icon }), false);
          DnD.ui.openDialog('Anteprima', statblock(v), [{ text: 'Chiudi' }]).classList.add('wide');
        } }),
        el('button', { type: 'submit', class: 'btn primary' + (opts.submitClass ? ' ' + opts.submitClass : ''), text: opts.submitText || 'Salva creatura' })));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const iconResult = icon.read();
      const data = Object.assign(clone(m), gridSize.read(), behavior.read(), {
        name: m.name.trim(), icon: iconResult.icon || m.icon, sessionId: m.sessionId || session().id, type: kind,
      }, extra && extra.read ? extra.read() : {});
      for (const g of K.GROUPS) for (const a of data[g]) delete a.group;
      const errors = Object.assign(DnD.validazione.validateMonster(Object.assign({}, data, { hpOverride: data.hpOverride })), extra && extra.validate ? extra.validate(data) : {});
      if (iconResult.error) errors.icon = iconResult.error;
      errorsTop.textContent = Object.keys(errors).length ? 'Controlla i campi evidenziati (' + Object.values(errors)[0] + ')' : '';
      if (!showErrors(form, errors)) return;
      const saved = DnD.dati.normalizeCreature(data, false);
      // opts.save: chi usa il form salva altrove (es. la forma di una trasformazione leggendaria).
      if (opts.save) opts.save(saved);
      else DnD.store.update((st) => {
        const i = st.npcs.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.npcs[i] = saved;
        else st.npcs.push(saved);
      });
      toast(opts.savedText || 'Creatura salvata.', 'success');
      if (opts.onDone) opts.onDone(saved, !existing);
    });

    const heading = el('div', { class: 'section-head' }, el('h2', { text: opts.heading || (existing ? 'Modifica creatura' : 'Nuova creatura') }));
    host.append(opts.wrap ? opts.wrap(heading, form) : el('div', {}, heading, form));
    for (const g of K.GROUPS) drawGroup(g);
    drawInnate();
    derived.push(() => behavior.refresh());
    refresh();
    name.focus();
  }

  DnD.uiMostri = { render, statblock, monsterForm, reset: () => { editing = null; viewing = null; } };
})(globalThis.DnD = globalThis.DnD || {});
