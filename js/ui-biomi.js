// Asset › Biomi: libreria dei tipi di terreno per l'esplorazione. Elenco con ricerca, duplica, elimina (con
// avviso se il bioma è dipinto su qualche mappa o è il "padre" di un sottobioma) e form con aspetto, movimento
// per modalità di viaggio, tempo, visibilità e luce, pericoli ambientali, scorte, incontri casuali e meteo.
// Un sottobioma eredita le sezioni lasciate su «Eredita» dal bioma padre.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast } = DnD.ui;
  const B = DnD.biomi;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  let root = null;
  let editing = null;
  let query = '';

  // Sezioni del form e campi che un sottobioma può ereditare.
  const SECTIONS = [
    ['aspetto', 'Aspetto', ['color', 'icon', 'tiles', 'description']],
    ['movimento', 'Movimento', ['cost', 'modeCost']],
    ['tempo', 'Tempo di viaggio', ['hoursPerCell']],
    ['visibilita', 'Visibilità e luce', ['discovery', 'light']],
    ['pericoli', 'Pericoli ambientali', ['hazards']],
    ['scorte', 'Scorte', ['food', 'water']],
    ['incontri', 'Incontri casuali', ['encounterChance', 'encounterPer', 'encounters']],
    ['meteo', 'Meteo', ['weather']],
  ];

  const lib = () => DnD.store.state.biomes;
  const byId = () => new Map(lib().map((b) => [b.id, b]));
  // Mappe (griglie salvate e bozze) che usano il bioma.
  function usage(id) {
    const st = DnD.store.state;
    const grids = st.savedGrids.filter((g) => B.usedIds(g.biomeMap).includes(id)).map((g) => g.name);
    const children = lib().filter((b) => b.parentId === id).map((b) => b.name);
    return { grids, children };
  }

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function costText(b) {
    const mc = Object.entries(b.modeCost || {}).map(([m, c]) => B.MODE_NAMES[m].toLowerCase() + ' ' + (c ? c : 'imp.'));
    return (b.cost ? 'costo ' + b.cost : 'impraticabile') + (mc.length ? ' (' + mc.join(', ') + ')' : '');
  }

  function renderList() {
    const all = lib();
    const shown = all.filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase()));
    root.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Biomi' }),
        el('div', { class: 'head-actions' },
          el('input', { type: 'search', placeholder: 'Cerca…', value: query, 'aria-label': 'Cerca un bioma', onchange: (e) => { query = e.target.value.trim(); render(); } }),
          el('button', { class: 'btn primary', text: '+ Nuovo bioma', onclick: () => { editing = 'new'; render(); } }))),
      el('p', { class: 'muted small', text: 'Tipi di terreno con regole di viaggio, pericoli, scorte, incontri e meteo. Si dipingono sulle mappe di esplorazione (Editor griglie › Biomi). Libreria comune a tutte le sessioni.' }),
      shown.length ? el('div', { class: 'card-grid' }, shown.map((raw) => {
        const b = B.resolve(raw, byId());
        const parent = raw.parentId ? all.find((x) => x.id === raw.parentId) : null;
        return el('article', { class: 'card biome-card' },
          el('div', { class: 'card-title' },
            el('div', { class: 'title-with-icon' }, el('span', { class: 'biome-swatch', style: 'background:' + b.color }), el('h3', { text: raw.name }),
              parent ? el('span', { class: 'tag', text: 'da ' + parent.name }) : raw.parentId ? el('span', { class: 'tag', text: '⚠ padre mancante' }) : null)),
          el('p', { class: 'muted small', text: [costText(b), b.hoursPerCell + ' h/cella', 'scoperta ' + b.discovery, B.LIGHT_NAMES[b.light].toLowerCase()].join(' · ') }),
          el('p', { class: 'small', text: [b.hazards.length ? b.hazards.length + ' pericoli' : '', 'incontri ' + b.encounterChance + '% per ' + b.encounterPer, b.weather.length ? b.weather.length + ' meteo' : '',
            'cibo ' + b.food + ' e acqua ' + b.water + ' al giorno'].filter(Boolean).join(' · ') }),
          b.description ? el('p', { class: 'muted small', text: b.description }) : null,
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = raw.id; render(); } }),
            el('button', { class: 'btn', text: 'Sottobioma', title: 'Nuovo bioma che eredita da questo', onclick: () => { editing = { parentId: raw.id }; render(); } }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(raw) }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(raw) })));
      })) : el('p', { class: 'empty', text: query ? 'Nessun bioma per «' + query + '».' : 'Nessun bioma.' }));
  }

  function duplicate(b) {
    const copy = Object.assign(clone(b), { id: DnD.dadi.uid(), name: (b.name + ' (copia)').slice(0, 60) });
    DnD.store.update((st) => { st.biomes.splice(st.biomes.indexOf(b) + 1, 0, copy); });
    toast('Bioma duplicato.');
    render();
  }
  function remove(b) {
    const u = usage(b.id);
    const warn = (u.grids.length ? '\nÈ dipinto su: ' + u.grids.join(', ') + ' (quelle celle useranno il bioma predefinito della mappa).' : '') +
      (u.children.length ? '\nÈ il padre di: ' + u.children.join(', ') + ' (erediteranno i valori di base).' : '');
    if (!confirm('Eliminare il bioma «' + b.name + '»?' + warn)) return;
    DnD.store.update((st) => { st.biomes = st.biomes.filter((x) => x.id !== b.id); });
    toast('Bioma eliminato.');
    render();
  }

  // ---------- Form ----------
  const checkWhat = () => DnD.regole.ABILITIES.concat(Object.keys(DnD.creatureDati.SKILLS));

  function renderForm() {
    const existing = typeof editing === 'string' && editing !== 'new' ? lib().find((b) => b.id === editing) : null;
    const seed = existing ? clone(existing) : B.normalizeBiome(Object.assign({ name: '' }, typeof editing === 'object' ? editing : {}));
    const parentRaw = () => (b.parentId ? lib().find((x) => x.id === b.parentId) : null);
    const b = seed;
    // Valori di partenza per le sezioni ereditate: quelli del padre, così togliendo «Eredita» si parte da lì.
    const eff = () => B.resolve(b, byId());
    const val = (k) => (b[k] === null || b[k] === undefined ? clone(eff()[k]) : b[k]);
    const work = {};
    for (const [, , keys] of SECTIONS) for (const k of keys) work[k] = clone(val(k));
    const inherited = {};
    for (const [id, , keys] of SECTIONS) inherited[id] = Boolean(b.parentId) && keys.every((k) => b[k] === null);

    const errorTop = el('div', { class: 'error', 'aria-live': 'polite' });
    const name = textInput(b.name, { maxlength: 60, 'data-key': 'name', placeholder: 'es. Bosco di betulle' });
    const parentSel = el('select', { 'aria-label': 'Eredita da', onchange: () => { b.parentId = parentSel.value; render2(); } },
      opt('', '— nessuno (bioma autonomo) —', !b.parentId), lib().filter((x) => x.id !== b.id).map((x) => opt(x.id, x.name, x.id === b.parentId)));
    const body = el('div', {});

    function section(id, title, content) {
      const box = el('fieldset', { class: 'biome-section' }, el('legend', { text: title }));
      if (b.parentId) {
        const cb = el('input', { type: 'checkbox', checked: inherited[id], onchange: () => { inherited[id] = cb.checked; render2(); } });
        box.append(el('label', { class: 'check small' }, cb, ' Eredita da «' + (parentRaw() ? parentRaw().name : 'padre mancante') + '»'));
        if (inherited[id]) { box.append(el('p', { class: 'muted small', text: 'Valori del padre.' })); return box; }
      }
      box.append(...[].concat(content()));
      return box;
    }
    const numF = (label, k, attrs, hint) => field(label, numberInput(work[k], Object.assign({ oninput: (e) => { work[k] = readNumber(e.target); } }, attrs)), 'f.' + k, hint);
    const checkSel = (c) => el('select', { 'aria-label': 'Prova', onchange: (e) => { c.what = e.target.value; } }, checkWhat().map((x) => opt(x, x, x === c.what)));

    function hazardsEditor() {
      const box = el('div', { class: 'row-list' });
      const draw = () => clear(box).append(...work.hazards.map((h, i) => el('div', { class: 'row-item' },
        el('div', { class: 'input-row' },
          textInput(h.name, { 'aria-label': 'Nome del pericolo', oninput: (e) => { h.name = e.target.value; } }),
          el('select', { 'aria-label': 'Frequenza', onchange: (e) => { h.freq = e.target.value; draw(); } }, opt('ore', 'Ogni N ore', h.freq === 'ore'), opt('entrata', 'Alla prima entrata', h.freq === 'entrata')),
          h.freq === 'ore' ? el('label', { class: 'inline small' }, 'ogni', numberInput(h.hours, { class: 'qty', min: 1, max: 240, oninput: (e) => { h.hours = readNumber(e.target); } }), 'ore') : null,
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { work.hazards.splice(i, 1); draw(); } })),
        el('div', { class: 'input-row' },
          el('span', { class: 'muted small', text: 'Prova' }), checkSel(h.check),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: h.check.save, onchange: (e) => { h.check.save = e.target.checked; } }), ' tiro salvezza'),
          el('label', { class: 'inline small' }, 'CD', numberInput(h.check.dc, { class: 'qty', min: 1, max: 40, oninput: (e) => { h.check.dc = readNumber(e.target); } })),
          el('span', { class: 'muted small', text: 'Se fallisce:' }),
          el('select', { 'aria-label': 'Effetto', onchange: (e) => { h.effect.kind = e.target.value; draw(); } }, B.EFFECT_KINDS.map((k) => opt(k, B.EFFECT_NAMES[k], k === h.effect.kind))),
          h.effect.kind === 'danno' ? [textInput(h.effect.dice, { class: 'qty', 'aria-label': 'Dadi', oninput: (e) => { h.effect.dice = e.target.value; } }),
            el('select', { 'aria-label': 'Tipo di danno', onchange: (e) => { h.effect.type = e.target.value; } }, opt('', '— tipo —', !h.effect.type), DnD.creatureDati.DAMAGE_TYPES.map((t) => opt(t, t, t === h.effect.type)))] : null,
          h.effect.kind === 'sfinimento' ? numberInput(h.effect.levels, { class: 'qty', min: 1, max: 6, 'aria-label': 'Livelli', oninput: (e) => { h.effect.levels = readNumber(e.target); } }) : null,
          h.effect.kind === 'condizione' ? el('select', { 'aria-label': 'Condizione', onchange: (e) => { h.effect.condition = e.target.value; } }, DnD.creatureDati.CONDITIONS.map((c) => opt(c, c, c === h.effect.condition))) : null,
          h.effect.kind === 'scorte' ? [el('label', { class: 'inline small' }, 'cibo', numberInput(h.effect.food, { class: 'qty', min: 0, step: 0.5, oninput: (e) => { h.effect.food = readNumber(e.target); } })),
            el('label', { class: 'inline small' }, 'acqua', numberInput(h.effect.water, { class: 'qty', min: 0, step: 0.5, oninput: (e) => { h.effect.water = readNumber(e.target); } }))] : null))),
      el('button', { type: 'button', class: 'btn small', text: '+ Pericolo', onclick: () => { work.hazards.push(B.normalizeHazard({})); draw(); } }));
      draw();
      return box;
    }

    function encountersEditor() {
      const st = DnD.store.state;
      const npcs = DnD.sessioni.visible(st, 'npcs');
      const box = el('div', { class: 'row-list' });
      const draw = () => clear(box).append(...work.encounters.map((r, i) => {
        const list = r.kind === 'evento' ? st.events : npcs;
        const missing = r.refId && !list.some((x) => x.id === r.refId);
        return el('div', { class: 'input-row row-item' },
          el('select', { 'aria-label': 'Tipo', onchange: (e) => { r.kind = e.target.value; r.refId = ''; draw(); } }, opt('creatura', 'Creature', r.kind === 'creatura'), opt('evento', 'Evento', r.kind === 'evento')),
          el('select', { 'aria-label': r.kind === 'evento' ? 'Evento' : 'Creatura', onchange: (e) => { r.refId = e.target.value; } },
            opt('', '— scegli —', !r.refId), missing ? opt(r.refId, '⚠ elemento eliminato', true) : null,
            list.map((x) => opt(x.id, x.name + (x.cr ? ' (GS ' + x.cr + ')' : ''), x.id === r.refId))),
          el('label', { class: 'inline small' }, 'peso', numberInput(r.weight, { class: 'qty', min: 1, max: 100, oninput: (e) => { r.weight = readNumber(e.target); } })),
          r.kind === 'creatura' ? [el('label', { class: 'inline small' }, 'quantità', textInput(r.qty, { class: 'qty', oninput: (e) => { r.qty = e.target.value.trim(); } })),
            el('label', { class: 'inline small' }, 'GS', textInput(r.crMin, { class: 'qty', placeholder: 'min', oninput: (e) => { r.crMin = e.target.value.trim(); } }), '–',
              textInput(r.crMax, { class: 'qty', placeholder: 'max', oninput: (e) => { r.crMax = e.target.value.trim(); } }))] : null,
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { work.encounters.splice(i, 1); draw(); } }));
      }), el('button', { type: 'button', class: 'btn small', text: '+ Riga della tabella', onclick: () => { work.encounters.push(B.normalizeEncounterRow({})); draw(); } }));
      draw();
      return box;
    }

    function weatherEditor() {
      const box = el('div', { class: 'row-list' });
      const draw = () => clear(box).append(...work.weather.map((w, i) => el('div', { class: 'input-row row-item' },
        textInput(w.name, { 'aria-label': 'Meteo', oninput: (e) => { w.name = e.target.value; } }),
        el('label', { class: 'inline small' }, 'peso', numberInput(w.weight, { class: 'qty', min: 1, max: 100, oninput: (e) => { w.weight = readNumber(e.target); } })),
        el('label', { class: 'inline small' }, 'visibilità', numberInput(w.visibility, { class: 'qty', min: -10, max: 10, oninput: (e) => { w.visibility = readNumber(e.target); } })),
        el('label', { class: 'inline small' }, 'CD +', numberInput(w.dc, { class: 'qty', min: -10, max: 10, oninput: (e) => { w.dc = readNumber(e.target); } })),
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { work.weather.splice(i, 1); draw(); } }))),
      el('button', { type: 'button', class: 'btn small', text: '+ Meteo', onclick: () => { work.weather.push(B.normalizeWeather({})); draw(); } }));
      draw();
      return box;
    }

    let icon = null;
    function render2() {
      const tilesets = DnD.store.state.tilesets;
      clear(body).append(
        section('aspetto', 'Aspetto', () => {
          icon = DnD.uiIcone.iconPicker(work.icon || { kind: 'shape', shape: 'esagono', color: work.color }, true, 'Icona (legenda)');
          return [
            el('div', { class: 'grid-2 tight' },
              field('Colore di sovrapposizione', el('input', { type: 'color', value: work.color, oninput: (e) => { work.color = e.target.value; } })),
              field('Tile preferiti (facoltativi)', el('select', { multiple: true, size: Math.min(4, Math.max(2, tilesets.length)), 'aria-label': 'TileSet preferiti',
                onchange: (e) => { work.tiles = [...e.target.selectedOptions].map((o) => o.value); } }, tilesets.map((t) => opt(t.id, t.name, work.tiles.includes(t.id)))),
              null, tilesets.length ? 'Ctrl+clic per più TileSet' : 'Nessun TileSet importato')),
            icon.node,
            field('Descrizione', el('textarea', { rows: 2, value: work.description, oninput: (e) => { work.description = e.target.value; } })),
          ];
        }),
        section('movimento', 'Movimento', () => [
          el('div', { class: 'grid-3 tight' },
            field('Costo per cella', el('select', { onchange: (e) => { work.cost = Number(e.target.value); } }, B.COSTS.map((c) => opt(String(c), B.COST_NAMES[c], c === work.cost))))),
          el('p', { class: 'muted small', text: 'Eccezioni per modalità di viaggio:' }),
          el('div', { class: 'grid-3 tight' }, B.MODES.map((m) => field(B.MODE_NAMES[m], el('select', {
            onchange: (e) => { if (e.target.value === '') delete work.modeCost[m]; else work.modeCost[m] = Number(e.target.value); },
          }, opt('', 'Come il costo base', work.modeCost[m] === undefined), B.COSTS.map((c) => opt(String(c), B.COST_NAMES[c], work.modeCost[m] === c)))))),
        ]),
        section('tempo', 'Tempo di viaggio', () => [
          el('div', { class: 'grid-2 tight' }, numF('Ore per cella a passo normale', 'hoursPerCell', { min: 0.1, max: 240, step: 0.5 }, 'per 1 cella = 1,5 km; si adatta alla scala della mappa')),
          el('p', { class: 'muted small', text: 'Ritmo: lento ×1,5 ore (+2 alle prove di scoperta), normale ×1, veloce ×0,75 ore (−5 alle prove di scoperta). Moltiplicato anche per il costo della cella.' }),
        ]),
        section('visibilita', 'Visibilità e luce', () => el('div', { class: 'grid-2 tight' },
          numF('Raggio di scoperta (celle)', 'discovery', { min: 0, max: 20 }),
          field('Luce', el('select', { onchange: (e) => { work.light = e.target.value; } }, B.LIGHTS.map((l) => opt(l, B.LIGHT_NAMES[l], l === work.light)))))),
        section('pericoli', 'Pericoli ambientali', () => hazardsEditor()),
        section('scorte', 'Scorte (per persona al giorno)', () => el('div', { class: 'grid-2 tight' },
          numF('Cibo (razioni)', 'food', { min: 0, max: 20, step: 0.5 }), numF('Acqua (litri)', 'water', { min: 0, max: 20, step: 0.5 }))),
        section('incontri', 'Incontri casuali', () => [
          el('div', { class: 'grid-2 tight' }, numF('Probabilità (d100 ≤)', 'encounterChance', { min: 0, max: 100 }, '%'),
            field('Controllo', el('select', { onchange: (e) => { work.encounterPer = e.target.value; } }, opt('ora', 'Ogni ora di viaggio', work.encounterPer === 'ora'), opt('cella', 'A ogni cella', work.encounterPer === 'cella')))),
          encountersEditor()]),
        section('meteo', 'Meteo possibile', () => [el('p', { class: 'muted small', text: 'Si tira ogni 8 ore di gioco, pesato. Visibilità: celle in più o in meno di scoperta; CD: aumento delle CD delle prove.' }), weatherEditor()]));
    }
    render2();

    const save = () => {
      const data = Object.assign({}, b, { name: name.value.trim(), parentId: parentSel.value });
      if (!data.name) { errorTop.textContent = 'Il nome è obbligatorio.'; name.focus(); return; }
      for (const [id, , keys] of SECTIONS) for (const k of keys) data[k] = data.parentId && inherited[id] ? null : clone(work[k]);
      if (!(data.parentId && inherited.aspetto) && icon) { const r = icon.read(); data.icon = r.icon || null; }
      // Ciclo di ereditarietà: non si può ereditare da un proprio discendente.
      for (let p = data.parentId, guard = 0; p && guard < 50; guard++) {
        if (p === data.id) { errorTop.textContent = 'Ereditarietà circolare: scegli un altro bioma padre.'; return; }
        const x = lib().find((y) => y.id === p);
        p = x ? x.parentId : '';
      }
      for (const k of ['hoursPerCell', 'discovery', 'food', 'water', 'encounterChance']) {
        if (data[k] !== null && !Number.isFinite(data[k])) { errorTop.textContent = 'Controlla i valori numerici.'; return; }
      }
      const saved = B.normalizeBiome(data);
      DnD.store.update((st) => {
        const i = st.biomes.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.biomes[i] = saved; else st.biomes.push(saved);
      });
      toast('Bioma «' + saved.name + '» salvato.', 'success');
      editing = null;
      render();
    };

    root.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica bioma' : 'Nuovo bioma' })),
      el('form', { class: 'panel form biome-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
        el('div', { class: 'grid-2' }, field('Nome', name, 'name'), field('Eredita da (sottobioma)', parentSel, null, 'es. «Foresta innevata» da «Foresta»')),
        body, errorTop,
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
          el('button', { type: 'submit', class: 'btn primary', text: 'Salva bioma' }))));
    name.focus();
  }

  DnD.schede = DnD.schede || {};
  DnD.schede.biomi = { title: 'Biomi', render, reset: () => { editing = null; } };
})(globalThis.DnD = globalThis.DnD || {});
