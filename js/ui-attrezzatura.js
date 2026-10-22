// Asset › Oggetti › Attrezzatura: catalogo degli oggetti di gioco (armi, armature, scudi, equipaggiamento,
// strumenti, consumabili, oggetti magici, tesori...). Elenco con ricerca e filtro per categoria, form con i
// campi comuni e quelli specifici di armi e armature. Le voci si scelgono nei form di nemici e giocatori
// (armi equipaggiate, armatura, inventario) e si trascinano sulla griglia come "oggetti a terra".
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast } = DnD.ui;
  const A = DnD.attrezzatura;
  let editing = null;
  let root = null;
  let filter = { q: '', category: '' };

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function renderList() {
    const all = DnD.store.state.equipment;
    const listBox = el('div');
    const draw = () => {
      const q = filter.q.toLowerCase();
      const list = all.filter((e) => (!filter.category || e.category === filter.category) && (!q || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))));
      clear(listBox).append(list.length
        ? el('table', { class: 'equip-table' },
          el('thead', {}, el('tr', {}, ['', 'Nome', 'Categoria', 'Dettagli', 'Costo', 'Peso', ''].map((t) => el('th', { text: t })))),
          el('tbody', {}, list.map((e) => el('tr', {},
            el('td', {}, DnD.icone.iconCanvas(e.icon, 24)),
            el('td', {}, el('b', { text: e.name }), e.rarity !== 'comune' ? el('span', { class: 'tag', text: e.rarity }) : null, e.attunement ? el('span', { class: 'tag', text: 'sintonia' }) : null),
            el('td', { class: 'muted small', text: A.CATEGORY_NAMES[e.category] }),
            el('td', { class: 'small', text: A.summary(e) }),
            el('td', { class: 'small', text: A.formatCost(e.cost) }),
            el('td', { class: 'small', text: A.formatWeight(e.weight) }),
            el('td', {}, el('div', { class: 'head-actions' },
              el('button', { class: 'btn small', text: 'Modifica', onclick: () => { editing = e.id; render(); } }),
              el('button', { class: 'btn small', text: 'Duplica', onclick: () => {
                const copy = Object.assign(JSON.parse(JSON.stringify(e)), { id: DnD.dadi.uid(), name: (e.name + ' (copia)').slice(0, 60) });
                DnD.store.update((st) => { st.equipment.splice(st.equipment.indexOf(e) + 1, 0, copy); });
                render();
              } }),
              el('button', { class: 'btn small danger', text: 'Elimina', onclick: () => {
                if (!confirm('Eliminare «' + e.name + '» dal catalogo?\nLe armi già scritte nelle schede restano con i loro valori.')) return;
                DnD.store.update((st) => { st.equipment = st.equipment.filter((x) => x.id !== e.id); });
                render();
              } })))))))
        : el('p', { class: 'empty', text: 'Nessun oggetto con questi filtri.' }));
    };
    root.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Attrezzatura' }),
        el('button', { class: 'btn primary', text: '+ Nuovo oggetto', onclick: () => { editing = 'new'; render(); } })),
      el('div', { class: 'filters' },
        el('input', { type: 'search', placeholder: 'Cerca per nome o tag…', value: filter.q, 'aria-label': 'Cerca', oninput: (ev) => { filter.q = ev.target.value; draw(); } }),
        el('select', { 'aria-label': 'Categoria', onchange: (ev) => { filter.category = ev.target.value; draw(); } },
          el('option', { value: '', text: 'Tutte le categorie' }),
          A.CATEGORIES.map((c) => el('option', { value: c, text: A.CATEGORY_NAMES[c] + ' (' + all.filter((e) => e.category === c).length + ')', selected: c === filter.category })))),
      listBox);
    draw();
  }

  function renderForm() {
    const existing = DnD.store.state.equipment.find((x) => x.id === editing);
    const e = existing || A.normalizeEquipment({ name: '', category: 'avventura', icon: { kind: 'library', icon: 'borsa', color: '#b8a06a' } });
    if (!existing) e.name = '';
    const w = e.weapon || A.normalizeEquipment({ category: 'armi' }).weapon;
    const a = e.armor || A.normalizeEquipment({ category: 'armature' }).armor;
    const inp = {
      name: textInput(e.name, { maxlength: 60 }),
      category: el('select', {}, A.CATEGORIES.map((c) => el('option', { value: c, text: A.CATEGORY_NAMES[c], selected: c === e.category }))),
      description: el('textarea', { rows: 3, value: e.description }),
      weight: numberInput(e.weight, { min: 0, step: 0.1 }),
      cost: numberInput(e.cost.amount, { min: 0, step: 0.1 }),
      unit: el('select', { 'aria-label': 'Valuta' }, A.CURRENCIES.map((c) => el('option', { value: c, text: A.CURRENCY_NAMES[c], selected: c === e.cost.unit }))),
      rarity: el('select', {}, A.RARITIES.map((r) => el('option', { value: r, text: r, selected: r === e.rarity }))),
      attunement: el('input', { type: 'checkbox', checked: e.attunement }),
      tags: textInput(e.tags.join(', '), { placeholder: 'es. argento, elfico' }),
      speedBonus: numberInput(e.speedBonus || '', { min: -30, max: 30, step: 1.5, placeholder: 'nessuno' }),
      wCat: el('select', {}, el('option', { value: 'semplice', text: 'Semplice', selected: w.cat === 'semplice' }), el('option', { value: 'guerra', text: 'Da guerra', selected: w.cat === 'guerra' })),
      wKind: el('select', {}, el('option', { value: 'mischia', text: 'Mischia', selected: w.kind === 'mischia' }), el('option', { value: 'distanza', text: 'Distanza', selected: w.kind === 'distanza' })),
      wDice: textInput(w.dice, { placeholder: '1d8' }),
      wType: el('select', {}, DnD.creatureDati.DAMAGE_TYPES.map((t) => el('option', { value: t, text: t, selected: t === w.damageType }))),
      wVers: textInput(w.versatile, { placeholder: 'es. 1d10' }),
      wNormal: numberInput(w.rangeNormal, { min: 0, step: 1.5 }),
      wLong: numberInput(w.rangeLong, { min: 0, step: 1.5 }),
      wMagic: el('select', {}, [0, 1, 2, 3].map((n) => el('option', { value: String(n), text: n ? '+' + n : 'nessuno', selected: n === w.magic }))),
      aType: el('select', {}, ['leggera', 'media', 'pesante'].map((t) => el('option', { value: t, text: A.ARMOR_TYPE_NAMES[t], selected: t === a.type }))),
      aBase: numberInput(a.base, { min: 0, max: 30 }),
      aDex: el('select', {}, A.DEX_RULES.map((r) => el('option', { value: r, text: A.DEX_RULE_NAMES[r], selected: r === a.dex }))),
      aStr: numberInput(a.strength || '', { min: 0, max: 30, placeholder: 'nessuna' }),
      aStealth: el('input', { type: 'checkbox', checked: a.stealthDis }),
      aMagic: el('select', {}, [0, 1, 2, 3].map((n) => el('option', { value: String(n), text: n ? '+' + n : 'nessuno', selected: n === a.magic }))),
    };
    const props = {};
    const icon = DnD.uiIcone.iconPicker(e.icon, true, 'Icona');
    const weaponBox = el('fieldset', {}, el('legend', { text: 'Arma' }),
      el('div', { class: 'grid-3 tight' }, field('Categoria', inp.wCat), field('Tipo', inp.wKind), field('Bonus magico', inp.wMagic)),
      el('div', { class: 'grid-3 tight' }, field('Dado di danno', inp.wDice, 'weapon.dice'), field('Tipo di danno', inp.wType), field('Dado versatile', inp.wVers, 'weapon.versatile')),
      el('div', { class: 'grid-3 tight' }, field('Gittata normale (m)', inp.wNormal), field('Gittata lunga (m)', inp.wLong, 'weapon.rangeLong')),
      el('div', { class: 'check-row' }, A.WEAPON_PROPS.map((p) => {
        props[p] = el('input', { type: 'checkbox', checked: w.props.includes(p) });
        return el('label', { class: 'check small' }, props[p], ' ' + p);
      })));
    const armorBox = el('fieldset', {}, el('legend', { text: 'Armatura o scudo' }),
      el('div', { class: 'grid-3 tight' }, field('Tipo', inp.aType), field('CA base (scudo: bonus)', inp.aBase, 'armor.base'), field('Effetto della DES', inp.aDex)),
      el('div', { class: 'grid-3 tight' }, field('Forza minima', inp.aStr), field('Bonus magico', inp.aMagic), el('label', { class: 'check' }, inp.aStealth, ' Svantaggio a Furtività')));
    const sync = () => {
      weaponBox.hidden = inp.category.value !== 'armi';
      armorBox.hidden = inp.category.value !== 'armature' && inp.category.value !== 'scudi';
      inp.aType.closest('.field').hidden = inp.category.value === 'scudi';
      inp.aDex.closest('.field').hidden = inp.category.value === 'scudi';
    };
    inp.category.addEventListener('change', sync);

    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' }, field('Nome', inp.name, 'name'), field('Categoria', inp.category, 'category'), field('Rarità', inp.rarity)),
      field('Descrizione', inp.description),
      el('div', { class: 'grid-3' }, field('Peso (kg)', inp.weight, 'weight'),
        el('div', { class: 'field' }, el('label', { text: 'Costo' }), el('div', { class: 'input-row' }, inp.cost, inp.unit), el('div', { class: 'error', 'data-error': 'cost.amount' })),
        field('Tag (separati da virgole)', inp.tags)),
      el('div', { class: 'grid-3' }, field('Bonus alla velocità (m)', inp.speedBonus, 'speedBonus', 'Quando è equipaggiato; negativo = malus')),
      el('label', { class: 'check' }, inp.attunement, ' Richiede sintonia'),
      weaponBox, armorBox, icon.node,
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva oggetto' })));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const iconResult = icon.read();
      const cat = inp.category.value;
      const data = {
        id: e.id, name: inp.name.value.trim(), category: cat, description: inp.description.value.trim(),
        weight: readNumber(inp.weight) || 0, cost: { amount: readNumber(inp.cost) || 0, unit: inp.unit.value },
        rarity: inp.rarity.value, attunement: inp.attunement.checked, icon: iconResult.icon || e.icon,
        tags: inp.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        speedBonus: readNumber(inp.speedBonus) || 0,
        weapon: cat === 'armi' ? {
          cat: inp.wCat.value, kind: inp.wKind.value, dice: inp.wDice.value.trim(), damageType: inp.wType.value, versatile: inp.wVers.value.trim(),
          props: A.WEAPON_PROPS.filter((p) => props[p].checked), rangeNormal: readNumber(inp.wNormal) || 0, rangeLong: readNumber(inp.wLong) || 0, magic: Number(inp.wMagic.value),
        } : null,
        armor: cat === 'armature' || cat === 'scudi' ? {
          type: cat === 'scudi' ? 'scudo' : inp.aType.value, base: readNumber(inp.aBase), dex: inp.aDex.value, strength: readNumber(inp.aStr) || 0,
          stealthDis: inp.aStealth.checked, magic: Number(inp.aMagic.value),
        } : null,
      };
      const errors = DnD.validazione.validateEquipment(data);
      if (iconResult.error) errors.icon = iconResult.error;
      if (!showErrors(form, errors)) return;
      const saved = A.normalizeEquipment(data);
      DnD.store.update((st) => {
        const i = st.equipment.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.equipment[i] = saved;
        else st.equipment.push(saved);
      });
      toast('Oggetto salvato nel catalogo.', 'success');
      editing = null;
      render();
    });

    root.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica oggetto' : 'Nuovo oggetto' })), form);
    sync();
    inp.name.focus();
  }

  // Scheda della sezione Asset › Oggetti (vedi ui-asset.js).
  DnD.schede = DnD.schede || {};
  DnD.schede.attrezzatura = { title: 'Attrezzatura', render, reset: () => { editing = null; } };
})(globalThis.DnD = globalThis.DnD || {});
