// Sezioni Nemici e Giocatori: stesso componente, configurato per la collezione. I Nemici hanno due schede:
// Standard (questa scheda: razza, classe, livello) e Creature (Manuale dei Mostri, vedi ui-mostri.js).
// Armi e armatura si scelgono anche dal catalogo dell'Attrezzatura; i giocatori hanno l'Inventario.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast, raceName } = DnD.ui;
  const R = DnD.regole;
  const C = DnD.classi;
  const A = DnD.attrezzatura;
  const G = DnD.griglia;
  const catalog = () => DnD.store.state.equipment;

  function weaponLabel(w) {
    const bonus = w.damageBonus ? R.formatModifier(w.damageBonus) : '';
    return w.name + ' (' + R.formatModifier(w.toHit) + ', ' + w.damageDice + bonus + (w.damageType ? ' ' + w.damageType : '') + ')';
  }

  const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const radio = (name, value, label, checked, onchange) => el('label', { class: 'check' },
    el('input', { type: 'radio', name, value, checked, onchange }), ' ' + label);
  let formSeq = 0;

  // Caratteristiche con valore finale e modificatore in tempo reale, randomizzazione e
  // punti caratteristica (2 ogni 4 livelli). ctx: { getRace, getClassInfo, getLevel, onChange, cap() (tetto, di base 20) }
  function abilitiesEditor(abilities, asiInit, ignoreCapInit, ctx) {
    const inputs = {};
    const outputs = {};
    const asi = Object.assign({}, asiInit);
    const asiCount = {};
    const asiMinus = {};
    const asiPlus = {};
    const ignoreCap = el('input', { type: 'checkbox', checked: ignoreCapInit, onchange: () => ctx.onChange() });
    const asiSummary = el('span', { class: 'asi-summary' });
    const asiWarn = el('div', { class: 'warn', 'aria-live': 'polite' });
    const read = () => Object.fromEntries(R.ABILITIES.map((ab) => [ab, readNumber(inputs[ab])]));
    const valid = (base) => R.ABILITIES.every((ab) => isInt(base[ab], 1, 30));
    const cap = () => (ctx.cap ? ctx.cap() : 20);
    const final = () => { const base = read(); return valid(base) ? R.finalAbilities(base, ctx.getRace(), asi, ignoreCap.checked, cap()) : null; };

    const refresh = () => {
      const race = ctx.getRace();
      const base = read();
      const lv = ctx.getLevel();
      const available = lv ? R.asiPointsAvailable(lv) : 0;
      const assigned = R.asiPointsAssigned(asi);
      for (const ab of R.ABILITIES) {
        asiCount[ab].textContent = String(asi[ab]);
        asiMinus[ab].disabled = asi[ab] <= 0;
        if (!Number.isFinite(base[ab])) { outputs[ab].textContent = '—'; asiPlus[ab].disabled = true; continue; }
        const bonus = R.racialBonus(race, ab);
        const fin = R.finalAbilities({ [ab]: base[ab] }, race, asi, ignoreCap.checked, cap())[ab];
        const extra = [bonus ? R.formatModifier(bonus) + ' razza' : '', asi[ab] ? '+' + (fin - base[ab] - bonus) + ' pt' : ''].filter(Boolean);
        outputs[ab].textContent = fin + (extra.length ? ' (' + extra.join(', ') + ')' : '') + ' → ' + R.formatModifier(R.modifier(fin));
        // Un punto in più non può superare 20 (salvo "Ignora limite"), né i punti disponibili.
        const nextFin = R.finalAbilities({ [ab]: base[ab] }, race, Object.assign({}, asi, { [ab]: asi[ab] + 1 }), ignoreCap.checked, cap())[ab];
        asiPlus[ab].disabled = assigned >= available || nextFin === fin;
      }
      asiSummary.textContent = 'Disponibili ' + available + ' · Assegnati ' + assigned + ' · Rimanenti ' + (available - assigned);
      asiWarn.textContent = assigned > available
        ? '⚠ Hai assegnato ' + assigned + ' punti ma al livello ' + (lv || '?') + ' ne hai ' + available + ': scegli quali togliere con i pulsanti −.'
        : '';
    };
    const setAsi = (ab, delta) => { asi[ab] = Math.max(0, asi[ab] + delta); ctx.onChange(); };
    const write = (values) => {
      for (const ab of R.ABILITIES) inputs[ab].value = String(values[ab]);
      ctx.onChange();
    };

    // --- Randomizza / Rilancia / Annulla ---
    let previous = null; // valori prima della randomizzazione, per "Annulla"
    const mode = el('select', { 'aria-label': 'Modalità di randomizzazione' },
      el('option', { value: 'random', text: 'Random (a caso)' }),
      el('option', { value: 'classe', text: 'Random intelligente (per classe)' }));
    const standard = el('input', { type: 'checkbox' });
    const detail = el('div', { class: 'muted small roll-detail', 'aria-live': 'polite' });
    const randomBtn = el('button', { type: 'button', class: 'btn small', text: '🎲 Randomizza', onclick: () => randomize() });
    const rerollBtn = el('button', { type: 'button', class: 'btn small', text: '↻ Rilancia', hidden: true, onclick: () => randomize() });
    const undoBtn = el('button', { type: 'button', class: 'btn small', text: 'Annulla', hidden: true, onclick: () => {
      write(previous);
      previous = null;
      randomBtn.hidden = false;
      rerollBtn.hidden = undoBtn.hidden = true;
      detail.textContent = '';
    } });

    function randomize() {
      const info = ctx.getClassInfo();
      if (mode.value === 'classe' && (!info || !info.priority.length)) {
        toast('Per il random intelligente scegli prima una classe (con caratteristiche prioritarie, se personalizzata).', 'error');
        return;
      }
      if (!previous) previous = read();
      const r = R.randomizeAbilities({ mode: mode.value, source: standard.checked ? 'standard' : '4d6', priority: info && info.priority }, DnD.dadi.randomInt);
      write(r.abilities);
      detail.textContent = standard.checked
        ? 'Array standard: ' + R.ABILITIES.map((ab) => ab + ' ' + r.abilities[ab]).join(' · ')
        : '4d6 (scartato il più basso): ' + R.ABILITIES.map((ab) => {
          const roll = r.rolls[ab];
          return ab + ' ' + roll.total + ' [' + roll.rolls.map((v, i) => (i === roll.dropIndex ? '(' + v + ')' : v)).join(',') + ']';
        }).join(' · ');
      randomBtn.hidden = true;
      rerollBtn.hidden = undoBtn.hidden = false;
    }

    const node = el('fieldset', { class: 'abilities' },
      el('legend', { text: 'Caratteristiche' }),
      el('div', { class: 'randomizer' },
        mode,
        el('label', { class: 'check small' }, standard, ' Array standard (15, 14, 13, 12, 10, 8)'),
        randomBtn, rerollBtn, undoBtn),
      el('div', { class: 'ability-row' }, R.ABILITIES.map((ab) => {
        inputs[ab] = numberInput(abilities[ab], { min: 1, max: 30, 'aria-label': R.ABILITY_NAMES[ab], 'data-key': 'abilities.' + ab, oninput: ctx.onChange });
        outputs[ab] = el('output', { class: 'ability-final' });
        asiMinus[ab] = el('button', { type: 'button', class: 'asi-btn', text: '−', 'aria-label': 'Togli un punto da ' + R.ABILITY_NAMES[ab], onclick: () => setAsi(ab, -1) });
        asiPlus[ab] = el('button', { type: 'button', class: 'asi-btn', text: '+', 'aria-label': 'Aggiungi un punto a ' + R.ABILITY_NAMES[ab], onclick: () => setAsi(ab, 1) });
        asiCount[ab] = el('span', { class: 'asi-count', 'aria-live': 'polite' });
        return el('div', { class: 'ability-cell' },
          el('div', { class: 'ability-label', title: R.ABILITY_NAMES[ab], text: ab }),
          inputs[ab], outputs[ab],
          el('div', { class: 'asi-row', title: 'Punti caratteristica assegnati' }, asiMinus[ab], asiCount[ab], asiPlus[ab]),
          el('div', { class: 'error', 'data-error': 'abilities.' + ab }));
      })),
      detail,
      el('div', { class: 'asi-box' },
        el('b', { text: 'Punti caratteristica' }), asiSummary,
        el('label', { class: 'check small' }, ignoreCap, ' Ignora limite di ' + cap()),
        el('button', { type: 'button', class: 'btn small', text: 'Azzera punti assegnati', onclick: () => { for (const ab of R.ABILITIES) asi[ab] = 0; ctx.onChange(); } })),
      asiWarn,
      el('div', { class: 'error', 'data-error': 'asi' }),
      el('small', { class: 'hint', text: 'Sotto ogni valore: punteggio finale (base + bonus razziale + punti) e modificatore. 2 punti ai livelli 4, 8, 12, 16 e 20; «Randomizza» non tocca i punti assegnati.' }));
    refresh();
    return { node, refresh, read, final, readAsi: () => ({ asi: Object.assign({}, asi), ignoreCap: ignoreCap.checked }) };
  }

  // Classe: menù a tendina e, per "Personalizzata", dado vita, competenze e priorità.
  function classEditor(c, onChange) {
    const select = el('select', { onchange: onChange },
      el('option', { value: '', text: '— Nessuna classe —' }),
      C.IDS.map((id) => el('option', { value: id, text: C.CLASSES[id].name + ' (d' + C.CLASSES[id].hitDie + ')', selected: id === c.classId })),
      el('option', { value: C.CUSTOM, text: 'Personalizzata', selected: c.classId === C.CUSTOM }));
    const hitDie = el('select', { 'data-key': 'customClass.hitDie', onchange: onChange },
      C.HIT_DICE.map((d) => el('option', { value: String(d), text: 'd' + d, selected: d === c.customClass.hitDie })));
    const saves = {};
    const prio = [0, 1, 2].map((i) => el('select', { 'aria-label': 'Priorità ' + (i + 1), 'data-key': i === 0 ? 'customClass.priority' : null, onchange: onChange },
      el('option', { value: '', text: '—' }),
      R.ABILITIES.map((ab) => el('option', { value: ab, text: ab, selected: c.customClass.priority[i] === ab }))));
    const isCaster = el('input', { type: 'checkbox', checked: Boolean(c.customClass.caster), onchange: () => { casterType.disabled = !isCaster.checked; onChange(); } });
    const casterType = el('select', { 'aria-label': 'Tipo di incantatore', disabled: !c.customClass.caster, onchange: onChange },
      C.CASTER_TYPES.map((t) => el('option', { value: t, text: C.CASTER_NAMES[t], selected: t === c.customClass.caster })));
    const customBox = el('fieldset', { class: 'custom-class' },
      el('legend', { text: 'Classe personalizzata' }),
      el('div', { class: 'grid-3' },
        field('Dado vita', hitDie, 'customClass.hitDie'),
        el('div', { class: 'field' },
          el('span', { class: 'field-label', text: 'Competenze nei tiri salvezza' }),
          el('div', { class: 'check-row' }, R.ABILITIES.map((ab) => {
            saves[ab] = el('input', { type: 'checkbox', checked: c.customClass.saves.includes(ab), onchange: onChange });
            return el('label', { class: 'check small' }, saves[ab], ' ' + ab);
          }))),
        el('div', { class: 'field' },
          el('span', { class: 'field-label', text: 'Caratteristiche prioritarie (1ª, 2ª, 3ª)' }),
          el('div', { class: 'check-row' }, prio),
          el('div', { class: 'error', 'data-error': 'customClass.priority' })),
        el('div', { class: 'field' },
          el('label', { class: 'check' }, isCaster, ' Incantatore'),
          casterType)));
    const readCustom = () => ({
      hitDie: Number(hitDie.value),
      saves: R.ABILITIES.filter((ab) => saves[ab].checked),
      priority: prio.map((s) => s.value).filter(Boolean),
      caster: isCaster.checked ? casterType.value : '',
    });
    return {
      select,
      customBox,
      refresh: () => { customBox.hidden = select.value !== C.CUSTOM; },
      read: () => ({ classId: select.value, customClass: readCustom() }),
      info: () => C.classInfo(select.value, readCustom()),
    };
  }

  // Punti ferita: manuali o calcolati dalla classe (tiro o media), con avviso se vanno ricalcolati.
  // ctx: { current() -> { level, conMod, hitDie } | motivo dell'impossibilità (stringa) }
  function hpEditor(c, ctx) {
    const name = 'hp-mode-' + (++formSeq);
    let basis = c.hpBasis;
    const maxHp = numberInput(c.maxHp, { min: 1, 'data-key': 'maxHp' });
    const detail = el('output', { class: 'calc-detail', text: c.hpDetail });
    const warn = el('div', { class: 'warn', 'aria-live': 'polite' });
    const method = (value, label) => radio(name + '-m', value, label, c.hpMethod === value);
    const autoBox = el('div', { class: 'auto-box' },
      el('div', { class: 'radio-row' }, method('tira', 'Tira i dadi'), method('media', 'Usa la media')),
      el('button', { type: 'button', class: 'btn small', text: '↻ Ricalcola PF', onclick: () => recalc(true) }),
      detail, warn);
    const isAuto = () => node.querySelector('input[name="' + name + '"]:checked').value === 'auto';
    const methodNow = () => node.querySelector('input[name="' + name + '-m"]:checked').value;

    function recalc(explicit) {
      const cur = ctx.current();
      if (typeof cur === 'string') {
        if (explicit) toast(cur, 'error');
        return refresh();
      }
      const r = R.computeHp(Object.assign({ method: methodNow() }, cur), DnD.dadi.randomInt);
      maxHp.value = String(r.total);
      detail.textContent = r.detail;
      basis = cur;
      refresh();
    }
    function refresh() {
      const auto = isAuto();
      autoBox.hidden = !auto;
      maxHp.readOnly = auto;
      warn.textContent = '';
      if (!auto) return;
      const cur = ctx.current();
      if (typeof cur === 'string') warn.textContent = '⚠ ' + cur;
      else if (!basis) warn.textContent = '⚠ PF non ancora calcolati: premi «Ricalcola PF».';
      else if (basis.level !== cur.level || basis.conMod !== cur.conMod || basis.hitDie !== cur.hitDie) {
        warn.textContent = '⚠ Livello, COS o classe sono cambiati: i PF sono da ricalcolare.';
      }
    }
    const node = el('fieldset', { class: 'hp-box' },
      el('legend', { text: 'Punti ferita' }),
      el('div', { class: 'radio-row' },
        radio(name, 'manuale', 'Manuale', c.hpMode !== 'auto', () => refresh()),
        radio(name, 'auto', 'Automatico da classe', c.hpMode === 'auto', () => { if (!basis) recalc(false); else refresh(); })),
      field('Punti ferita massimi', maxHp, 'maxHp'),
      autoBox);
    return {
      node,
      refresh,
      read: () => ({ hpMode: isAuto() ? 'auto' : 'manuale', hpMethod: methodNow(), hpBasis: basis, hpDetail: detail.textContent, maxHp: readNumber(maxHp) }),
    };
  }

  // Classe Armatura: automatica (10 + DES, armatura, scudo, difesa senza armatura) o manuale.
  // ctx: { abilities() -> caratteristiche finali | null, unarmored() -> 'COS' | 'SAG' | null, onChange }
  function acEditor(c, ctx) {
    const name = 'ac-mode-' + (++formSeq);
    const type = el('select', { 'aria-label': 'Armatura' }, R.ARMOR_TYPES.map((t) => el('option', { value: t, text: R.ARMOR_NAMES[t], selected: t === c.armor.type })));
    const base = numberInput(c.armor.base, { min: 0, max: 30, 'data-key': 'armor.base' });
    const shield = el('input', { type: 'checkbox', checked: c.armor.shield, onchange: () => refresh() });
    const magic = numberInput(c.armor.bonus || 0, { min: 0, max: 10, 'data-key': 'armor.bonus', oninput: () => refresh() });
    const unarmored = el('input', { type: 'checkbox', checked: c.armor.unarmored, onchange: () => refresh() });
    const manual = numberInput(c.ac, { min: 1, max: 40, 'data-key': 'ac' });
    const detail = el('output', { class: 'calc-detail' });
    // Armatura e scudo dal catalogo dell'Attrezzatura (facoltativi: altrimenti i campi qui sotto).
    const fromCatalog = (kind, value) => {
      const list = catalog().filter((e) => e.armor && (kind === 'scudo' ? e.armor.type === 'scudo' : e.armor.type !== 'scudo'));
      return el('select', { 'aria-label': kind === 'scudo' ? 'Scudo dal catalogo' : 'Armatura dal catalogo', onchange: () => refresh() },
        el('option', { value: '', text: kind === 'scudo' ? '— nessuno scudo dal catalogo —' : '— scritta a mano —' }),
        list.map((e) => el('option', { value: e.id, text: e.name + ' (' + A.summary(e) + ')', selected: e.id === value })));
    };
    const armorSel = fromCatalog('armatura', c.armor.equipmentId);
    const shieldSel = fromCatalog('scudo', c.armor.shieldId);
    const baseField = field('CA base dell\'armatura', base, 'armor.base');
    const unarmoredLabel = el('label', { class: 'check' }, unarmored, el('span'));
    type.addEventListener('change', () => { base.value = String(R.ARMOR_BASE[type.value]); refresh(); });
    base.addEventListener('input', () => refresh());
    manual.addEventListener('input', () => refresh());
    const manualArmor = el('div', { class: 'grid-3' }, field('Armatura', type), baseField);
    const autoBox = el('div', { class: 'auto-box' },
      el('div', { class: 'grid-2' }, field('Armatura dal catalogo', armorSel), field('Scudo dal catalogo', shieldSel)),
      manualArmor,
      el('div', { class: 'check-row' }, el('label', { class: 'check' }, shield, ' Scudo (+2)'), unarmoredLabel),
      el('label', { class: 'inline small' }, 'Bonus magico alla CA', magic),
      el('div', { class: 'error', 'data-error': 'armor.bonus' }));
    const manualBox = el('div', {}, field('Classe Armatura (CA)', manual, 'ac'));
    const isAuto = () => node.querySelector('input[name="' + name + '"]:checked').value === 'auto';
    const readArmor = () => ({
      type: type.value, base: readNumber(base), shield: shield.checked && !shieldSel.value, unarmored: unarmored.checked,
      bonus: magic.value.trim() === '' ? 0 : readNumber(magic), equipmentId: armorSel.value, shieldId: shieldSel.value,
    });

    let total = c.ac;
    function refresh() {
      const auto = isAuto();
      autoBox.hidden = !auto;
      manualBox.hidden = auto;
      baseField.hidden = type.value === 'nessuna';
      manualArmor.hidden = Boolean(armorSel.value);
      shield.closest('label').hidden = Boolean(shieldSel.value);
      const ability = ctx.unarmored();
      unarmoredLabel.hidden = !ability || Boolean(armorSel.value);
      unarmored.disabled = type.value !== 'nessuna';
      unarmoredLabel.lastChild.textContent = ' Difesa senza armatura (10 + DES + ' + (ability || '') + ')';
      if (!auto) {
        total = readNumber(manual);
        detail.textContent = 'Manuale: ' + (Number.isFinite(total) ? total : '—');
        return;
      }
      const abilities = ctx.abilities();
      const armor = readArmor();
      if (!abilities || (!armor.equipmentId && armor.type !== 'nessuna' && !isInt(armor.base, 0, 30)) || !isInt(armor.bonus, 0, 10)) {
        total = NaN;
        detail.textContent = 'CA: completa le caratteristiche e la CA base.';
        return;
      }
      const r = R.autoAc({ armor }, abilities, ability, catalog());
      total = r.total;
      detail.textContent = 'CA ' + r.detail;
    }
    // Al cambio di classe la difesa senza armatura viene proposta (Barbaro, Monaco) o tolta.
    function classChanged() {
      unarmored.checked = Boolean(ctx.unarmored()) && type.value === 'nessuna';
      refresh();
    }
    const node = el('fieldset', { class: 'ac-box' },
      el('legend', { text: 'Classe Armatura' }),
      el('div', { class: 'radio-row' },
        radio(name, 'auto', 'Automatica', c.acMode === 'auto', () => refresh()),
        radio(name, 'manuale', 'Manuale', c.acMode !== 'auto', () => refresh())),
      autoBox, manualBox, detail);
    return {
      node,
      refresh,
      classChanged,
      read: () => ({ acMode: isAuto() ? 'auto' : 'manuale', armor: readArmor(), ac: isAuto() ? total : readNumber(manual) }),
    };
  }

  // Tiri salvezza: competenze da classe o manuali, bonus competenza dal livello (sovrascrivibile).
  // ctx: { abilities(), level(), classSaves() -> [..] | null, allowOverride }
  function savesEditor(c, ctx) {
    const name = 'save-mode-' + (++formSeq);
    const checks = {};
    const mods = {};
    const totals = {};
    const pbText = el('output', { class: 'calc-detail' });
    const override = ctx.allowOverride
      ? numberInput(c.profBonusOverride, { min: 0, max: 20, placeholder: 'auto', 'data-key': 'profBonusOverride', oninput: () => refresh() })
      : null;
    const isClassMode = () => node.querySelector('input[name="' + name + '"]:checked').value === 'classe';
    const setMode = (m) => { node.querySelector('input[name="' + name + '"][value="' + m + '"]').checked = true; };
    const profBonus = () => {
      const o = override && override.value.trim() !== '' ? readNumber(override) : null;
      if (o !== null && isInt(o, 0, 20)) return o;
      const lv = ctx.level();
      return lv ? R.proficiencyBonus(lv, Boolean(ctx.legendary)) : null;
    };

    function refresh() {
      if (isClassMode()) {
        const s = ctx.classSaves() || [];
        for (const ab of R.ABILITIES) checks[ab].checked = s.includes(ab);
      }
      const pb = profBonus();
      const lv = ctx.level();
      const overridden = override && override.value.trim() !== '';
      pbText.textContent = pb === null ? 'Bonus competenza: —'
        : 'Bonus competenza ' + R.formatModifier(pb) + (overridden ? ' (manuale)' : lv ? ' (livello ' + lv + ')' : '');
      const abilities = ctx.abilities();
      for (const ab of R.ABILITIES) {
        if (!abilities || pb === null) { mods[ab].textContent = totals[ab].textContent = '—'; continue; }
        mods[ab].textContent = R.formatModifier(R.modifier(abilities[ab]));
        totals[ab].textContent = R.formatModifier(R.savingThrowTotal(abilities[ab], checks[ab].checked, pb));
      }
    }

    const node = el('fieldset', { class: 'saves-box' },
      el('legend', { text: 'Tiri salvezza' }),
      el('div', { class: 'radio-row' },
        radio(name, 'classe', 'Da classe', c.saveMode !== 'manuale', () => refresh()),
        radio(name, 'manuale', 'Manuale', c.saveMode === 'manuale', () => refresh())),
      el('div', { class: 'pb-line' }, pbText, override ? el('label', { class: 'inline small' }, 'Sovrascrivi', override) : null),
      override ? el('div', { class: 'error', 'data-error': 'profBonusOverride' }) : null,
      el('table', { class: 'saves-table' },
        el('thead', {}, el('tr', {}, ['', 'Competenza', 'Mod.', 'Totale'].map((t) => el('th', { text: t })))),
        el('tbody', {}, R.ABILITIES.map((ab) => {
          // Modificare a mano una casella passa alla modalità manuale.
          checks[ab] = el('input', { type: 'checkbox', checked: c.saves.includes(ab), 'aria-label': 'Competenza ' + R.ABILITY_NAMES[ab], onchange: () => { setMode('manuale'); refresh(); } });
          mods[ab] = el('td', { class: 'num' });
          totals[ab] = el('td', { class: 'num total' });
          return el('tr', {}, el('th', { text: ab, title: R.ABILITY_NAMES[ab] }), el('td', {}, checks[ab]), mods[ab], totals[ab]);
        }))));
    return {
      node,
      refresh,
      profBonus,
      read: () => ({
        saveMode: isClassMode() ? 'classe' : 'manuale',
        saves: R.ABILITIES.filter((ab) => checks[ab].checked),
        profBonusOverride: override && override.value.trim() !== '' ? readNumber(override) : null,
      }),
    };
  }

  // Elenco di armi modificabile: le righe vivono nel DOM e vengono lette al salvataggio. Ogni arma si scrive a
  // mano oppure si sceglie dal catalogo dell'Attrezzatura: con «Calcola» bonus per colpire e danno vengono da
  // competenza, modificatore (FOR, o DES per le armi accurate e a distanza) e bonus magico; senza, restano
  // sovrascrivibili a mano. ctx: { abilities() -> caratteristiche finali | null, profBonus() -> numero | null }
  function weaponsEditor(weapons, ctx) {
    const rows = el('div', { class: 'weapon-rows' });
    const renumber = () => {
      [...rows.children].forEach((row, i) => {
        for (const n of row.querySelectorAll('[data-field]')) n.dataset.key = 'weapons.' + i + '.' + n.dataset.field;
        for (const n of row.querySelectorAll('[data-efield]')) n.dataset.error = 'weapons.' + i + '.' + n.dataset.efield;
      });
      empty.hidden = rows.children.length > 0;
    };
    const cell = (label, input, name) => {
      input.dataset.field = name;
      return el('div', { class: 'field' }, el('label', { class: 'sr-label', text: label }), input, el('div', { class: 'error', 'data-efield': name }));
    };
    const weaponsOf = () => catalog().filter((e) => e.weapon);
    // Ricalcola bonus e danno delle righe collegate al catalogo con «Calcola».
    function refreshRow(row) {
      const v = (f) => row.querySelector('[data-field="' + f + '"]');
      const entry = weaponsOf().find((e) => e.id === v('equipmentId').value) || null;
      const auto = row.querySelector('.weapon-auto');
      auto.disabled = !entry;
      if (!entry) auto.checked = false;
      const on = Boolean(entry && auto.checked);
      for (const f of ['toHit', 'damageDice', 'damageBonus', 'damageType']) v(f).readOnly = on;
      const ab = ctx.abilities();
      const pb = ctx.profBonus();
      if (on && ab && pb !== null) {
        const st = A.weaponStats(entry, ab, pb);
        v('toHit').value = String(st.toHit);
        v('damageDice').value = st.damageDice;
        v('damageBonus').value = String(st.damageBonus);
        v('damageType').value = st.damageType;
        row.querySelector('.weapon-detail').textContent = 'Calcolato: ' + st.detail;
      } else {
        row.querySelector('.weapon-detail').textContent = entry ? A.summary(entry) : '';
      }
    }
    const addRow = (w) => {
      const select = el('select', { 'aria-label': 'Dal catalogo' }, el('option', { value: '', text: '— scritta a mano —' }),
        weaponsOf().map((e) => el('option', { value: e.id, text: e.name, selected: e.id === w.equipmentId })));
      if (w.equipmentId && !weaponsOf().some((e) => e.id === w.equipmentId)) select.append(el('option', { value: w.equipmentId, text: 'Oggetto eliminato', selected: true }));
      const auto = el('input', { type: 'checkbox', class: 'weapon-auto', checked: Boolean(w.equipmentId && w.auto !== false), 'aria-label': 'Calcola bonus e danno' });
      const name = textInput(w.name, { placeholder: 'Spada lunga', maxlength: 60 });
      const row = el('div', { class: 'weapon-row', 'data-id': w.id || DnD.dadi.uid() },
        cell('Dal catalogo', select, 'equipmentId'),
        cell('Nome', name, 'name'),
        cell('Per colpire', numberInput(w.toHit, { placeholder: '+5' }), 'toHit'),
        cell('Dado danno', textInput(w.damageDice, { placeholder: '1d8' }), 'damageDice'),
        cell('Bonus danno', numberInput(w.damageBonus, { placeholder: '+3' }), 'damageBonus'),
        cell('Tipo', textInput(w.damageType, { placeholder: 'tagliente', maxlength: 40 }), 'damageType'),
        el('label', { class: 'check small', title: 'Calcola bonus e danno dal catalogo' }, auto, ' Calcola'),
        el('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Rimuovi arma', title: 'Rimuovi arma', text: '✕', onclick: () => { row.remove(); renumber(); } }),
        el('small', { class: 'weapon-detail muted' }));
      select.addEventListener('change', () => {
        const entry = weaponsOf().find((e) => e.id === select.value);
        if (entry) { name.value = entry.name; auto.checked = true; }
        refreshRow(row);
      });
      auto.addEventListener('change', () => refreshRow(row));
      rows.appendChild(row);
      renumber();
      refreshRow(row);
      return row;
    };
    const empty = el('p', { class: 'muted small', text: 'Nessuna arma equipaggiata.' });
    const node = el('fieldset', { class: 'weapons' },
      el('legend', { text: 'Armi equipaggiate' }),
      el('div', { class: 'weapon-head' }, ['Catalogo', 'Nome', 'Per colpire', 'Dado danno', 'Bonus danno', 'Tipo', '', ''].map((t) => el('span', { text: t }))),
      rows, empty,
      el('button', { type: 'button', class: 'btn', text: '+ Aggiungi arma', onclick: () => addRow({ toHit: 0, damageDice: '1d6', damageBonus: 0 }).querySelector('input').focus() }));
    weapons.forEach(addRow);
    renumber();
    const read = () => [...rows.children].map((row) => {
      const v = (f) => row.querySelector('[data-field="' + f + '"]');
      return {
        id: row.dataset.id,
        equipmentId: v('equipmentId').value,
        auto: row.querySelector('.weapon-auto').checked,
        name: v('name').value.trim(),
        toHit: readNumber(v('toHit')),
        damageDice: v('damageDice').value.trim().toLowerCase(),
        damageBonus: v('damageBonus').value.trim() === '' ? 0 : readNumber(v('damageBonus')),
        damageType: v('damageType').value.trim(),
      };
    });
    return { node, read, refresh: () => { for (const row of rows.children) refreshRow(row); } };
  }

  // Dimensione sulla griglia: Automatica (dalla taglia) oppure w × h (preset 1×1…5×5 o valori a scelta, 1–8).
  // ctx: { size() -> taglia attuale (della razza o della creatura) | null, label }
  function gridSizeEditor(gs, ctx) {
    const auto = el('input', { type: 'checkbox', checked: gs.auto, onchange: () => refresh() });
    const preset = el('select', { 'aria-label': 'Preset', onchange: () => { if (preset.value) { w.value = h.value = preset.value; } refresh(); } },
      el('option', { value: '', text: 'Personalizzata' }), G.TOKEN_PRESETS.map((n) => el('option', { value: String(n), text: n + '×' + n })));
    const w = numberInput(gs.w, { min: 1, max: G.MAX_TOKEN, 'data-key': 'gridSize.w', 'aria-label': 'Larghezza in celle', class: 'qty', oninput: () => refresh() });
    const h = numberInput(gs.h, { min: 1, max: G.MAX_TOKEN, 'data-key': 'gridSize.h', 'aria-label': 'Altezza in celle', class: 'qty', oninput: () => refresh() });
    const info = el('output', { class: 'calc-detail' });
    function refresh() {
      const size = ctx.size();
      const d = G.gridSizeFor({ auto: true }, size);
      preset.disabled = w.disabled = h.disabled = auto.checked;
      if (auto.checked) { w.value = String(d.w); h.value = String(d.h); }
      const wv = readNumber(w);
      const hv = readNumber(h);
      preset.value = wv === hv && G.TOKEN_PRESETS.includes(wv) ? String(wv) : '';
      info.textContent = auto.checked ? 'Automatica: ' + (size || 'Media') + ' = ' + d.w + '×' + d.h + ' celle' : 'Ingombro ' + (isInt(wv, 1, 8) && isInt(hv, 1, 8) ? wv + '×' + hv + ' celle' : '—');
    }
    const node = el('fieldset', { class: 'grid-size-box' },
      el('legend', { text: 'Dimensione sulla griglia' }),
      el('div', { class: 'input-row' }, el('label', { class: 'check' }, auto, ' Automatica (dalla taglia)'), preset,
        el('label', { class: 'inline small' }, 'L', w), el('span', { text: '×' }), el('label', { class: 'inline small' }, 'A', h)),
      info,
      el('div', { class: 'error', 'data-error': 'gridSize.w' }), el('div', { class: 'error', 'data-error': 'gridSize.h' }));
    refresh();
    // Dimensione suggerita da un'icona grande: passa a w×h manuale (modificabile); 1 = nessun suggerimento.
    function suggest(n, name) {
      if (!(n > 1)) return;
      auto.checked = false;
      w.value = h.value = String(n);
      refresh();
      info.textContent += ' (suggerita da «' + name + '», modificabile)';
    }
    return { node, refresh, suggest, read: () => ({ gridSize: { auto: auto.checked, w: readNumber(w), h: readNumber(h) } }) };
  }

  // Inventario di un giocatore: oggetti del catalogo con quantità e "equipaggiato", monete e peso totale.
  function inventoryEditor(p) {
    const rows = el('div', { class: 'content-rows' });
    const weight = el('output', { class: 'calc-detail' });
    let coins = null;
    const options = () => catalog().map((e) => el('option', { value: e.id, text: e.name + ' (' + A.CATEGORY_NAMES[e.category] + ')' }));
    const readRows = () => [...rows.querySelectorAll('.content-row')].map((r) => ({
      id: r.dataset.id, equipmentId: r.querySelector('select').value, qty: readNumber(r.querySelector('input[type="number"]')), equipped: r.querySelector('input[type="checkbox"]').checked,
    })).filter((x) => x.equipmentId && isInt(x.qty, 0, 100000));
    const refresh = () => { weight.textContent = 'Peso totale: ' + A.formatWeight(A.inventoryWeight(readRows(), catalog(), coins ? coins.read() : p.coins)) + ' (monete comprese, 50 monete = 0,5 kg)'; };
    const addRow = (x) => {
      const sel = el('select', { 'aria-label': 'Oggetto', onchange: refresh }, options());
      sel.value = x.equipmentId;
      rows.append(el('div', { class: 'input-row content-row', 'data-id': x.id || DnD.dadi.uid() },
        numberInput(x.qty, { min: 0, max: 100000, 'aria-label': 'Quantità', class: 'qty', oninput: refresh }), sel,
        el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: x.equipped }), ' equipaggiato'),
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: (e) => { e.target.closest('.content-row').remove(); refresh(); } })));
      refresh();
    };
    p.inventory.forEach(addRow);
    coins = DnD.uiOggettiMappa.coinsEditor(p.coins, 'Monete');
    coins.node.addEventListener('input', refresh);
    const node = el('fieldset', { class: 'inventory-box' },
      el('legend', { text: 'Inventario' }), rows,
      el('button', { type: 'button', class: 'btn small', text: '+ Aggiungi oggetto', onclick: () => {
        if (!catalog().length) { toast('Il catalogo dell\'Attrezzatura è vuoto (Asset › Oggetti).', 'error'); return; }
        addRow({ equipmentId: catalog()[0].id, qty: 1, equipped: false });
      } }),
      coins.node, weight);
    refresh();
    return { node, read: () => ({ inventory: readRows(), coins: coins.read() }) };
  }

  // Esporta una singola creatura (nemico standard o creatura del Manuale) come file JSON.
  function exportOne(c) {
    const data = { app: DnD.config.APP_NAME, kind: 'creatura', version: DnD.dati.VERSION, exportedAt: new Date().toISOString(), creature: c };
    DnD.uiImpostazioni.download(JSON.stringify(data, null, 2), DnD.uiImpostazioni.slug(DnD.config.APP_NAME) + '-creatura-' + DnD.uiImpostazioni.slug(c.name) + '.json');
    toast('«' + c.name + '» esportato.', 'success');
  }
  // Importa una creatura da file: diventa un nemico della sessione corrente (con un id nuovo).
  async function importOne(file, onDone) {
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || raw.kind !== 'creatura' || !raw.creature || typeof raw.creature !== 'object') throw new Error('il file non contiene una creatura di questa app.');
      const c = DnD.dati.normalizeCreature(Object.assign({}, raw.creature, { type: raw.creature.type || 'standard' }), false);
      c.id = DnD.dadi.uid();
      c.sessionId = DnD.sessioni.current(DnD.store.state).id;
      c.shared = false;
      DnD.store.update((st) => { st.npcs.push(c); });
      toast('«' + c.name + '» importato.', 'success');
      onDone(c);
    } catch (e) {
      toast('Importazione non riuscita: ' + e.message, 'error');
    }
  }

  function createSection(cfg) {
    // cfg: { key: 'npcs'|'players', title, singular, isPlayer }
    let editing = null;
    let root = null;
    let tab = 'standard'; // Nemici: 'standard' | 'creature' | 'boss'; Giocatori: 'standard' | 'leggendari'
    let query = '';
    // Solo i personaggi della sessione corrente e quelli condivisi con tutte le sessioni (per i Nemici,
    // solo quelli standard: le creature hanno la loro scheda).
    const list = () => DnD.sessioni.visible(DnD.store.state, cfg.key).filter((c) => !DnD.boss.isMonster(c) && (cfg.isPlayer ? c.type !== 'leggendario' : true));
    const currentSessionId = () => DnD.sessioni.current(DnD.store.state).id;

    function render(container) {
      root = container || root;
      clear(root);
      if (!cfg.isPlayer && tab === 'creature') { renderTabs(); DnD.uiMostri.render(root.appendChild(el('div', { role: 'tabpanel' }))); return; }
      if (!cfg.isPlayer && tab === 'boss') { renderTabs(); DnD.uiBoss.render(root.appendChild(el('div', { role: 'tabpanel' }))); return; }
      if (cfg.isPlayer && tab === 'leggendari') { renderTabs(); DnD.uiLeggendario.render(root.appendChild(el('div', { role: 'tabpanel' })), api); return; }
      if (editing) renderForm();
      else renderList();
    }

    // Nemici: schede Standard, Creature e Boss. Giocatori: Standard e Leggendari.
    function renderTabs() {
      if (cfg.isPlayer) {
        root.append(el('div', { class: 'section-head' }, el('h1', { text: cfg.title })),
          DnD.uiAsset.tabBar([{ id: 'standard', label: 'Standard' }, { id: 'leggendari', label: '✦ Leggendari' }], tab, 'Tipo di giocatore', 'scheda-giocatori-', (id) => {
            tab = id;
            editing = null;
            DnD.uiLeggendario.reset();
            render();
          }));
        return;
      }
      root.append(el('div', { class: 'section-head' }, el('h1', { text: cfg.title })),
        DnD.uiAsset.tabBar([{ id: 'standard', label: 'Standard' }, { id: 'creature', label: 'Creature' }, { id: 'boss', label: '👑 Boss' }], tab, 'Tipo di nemico', 'scheda-nemici-', (id) => {
          tab = id;
          editing = null;
          DnD.uiMostri.reset();
          DnD.uiBoss.reset();
          render();
        }));
    }

    function save(fn) {
      DnD.store.update(fn);
    }

    function duplicate(c) {
      const copy = JSON.parse(JSON.stringify(c));
      copy.id = DnD.dadi.uid();
      copy.name = (c.name + ' (copia)').slice(0, 60);
      copy.weapons.forEach((w) => { w.id = DnD.dadi.uid(); });
      // La copia appartiene alla sessione corrente (anche se l'originale era condiviso).
      copy.sessionId = currentSessionId();
      copy.shared = false;
      save((st) => { st[cfg.key].splice(st[cfg.key].indexOf(c) + 1, 0, copy); });
      toast(cfg.singular + ' duplicato.');
      render();
    }

    function remove(c) {
      if (!confirm('Eliminare "' + c.name + '"?' + (c.shared ? '\nÈ condiviso: sparirà da tutte le sessioni.' : ''))) return;
      save((st) => { st[cfg.key] = st[cfg.key].filter((x) => x.id !== c.id); });
      toast(cfg.singular + ' eliminato.');
      render();
    }

    function renderList() {
      const races = DnD.store.state.races;
      renderTabs();
      const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
        const f = importInput.files[0];
        importInput.value = '';
        if (f) importOne(f, (c) => { tab = c.type === 'boss' ? 'boss' : c.type === 'creatura' ? 'creature' : 'standard'; render(); });
      } });
      const shown = list().filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()));
      root.append(
        el('div', { class: 'section-head' },
          el('h2', { text: cfg.isPlayer ? 'Giocatori standard' : 'Nemici standard' }),
          el('div', { class: 'head-actions' },
            el('input', { type: 'search', placeholder: 'Cerca…', value: query, 'aria-label': 'Cerca per nome', onchange: (e) => { query = e.target.value.trim(); render(); } }),
            cfg.isPlayer ? null : el('button', { class: 'btn', text: '⬆ Importa JSON', onclick: () => importInput.click() }), importInput,
            // Solo per i nemici: generatore automatico da razza, livello e classe.
            cfg.isPlayer ? null : el('button', { class: 'btn', text: '🎲 Genera nemico', onclick: () => DnD.uiGeneratore.open({
              allowEdit: true,
              onSaved: (creatures, edit) => { editing = edit ? creatures[0].id : null; render(); },
            }) }),
            el('button', { class: 'btn primary', text: '+ Nuovo ' + cfg.singular.toLowerCase(), onclick: () => { editing = 'new'; render(); } }))),
        shown.length
          ? el('div', { class: 'card-grid' }, shown.map((c) => {
            const stats = R.derivedStats(c, races.find((r) => r.id === c.raceId));
            const fin = stats.abilities;
            return el('article', { class: 'card' },
              el('div', { class: 'card-title' },
                el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(c.icon, 32), el('h3', { text: c.name }),
                  cfg.isPlayer ? null : el('span', { class: 'tag', text: 'Standard' }),
                  c.shared ? el('span', { class: 'tag accent', title: 'Visibile in tutte le sessioni', text: 'Condiviso' }) : null),
                el('span', { class: 'ac-badge', title: 'Classe Armatura: ' + stats.ac.detail, text: 'CA ' + stats.ac.total })),
              el('p', { class: 'muted', text: [raceName(c.raceId), C.className(c.classId), 'liv. ' + c.level].filter(Boolean).join(' · ') }),
              cfg.isPlayer && c.playerName ? el('p', { class: 'small', text: 'Giocatore: ' + c.playerName }) : null,
              el('p', { text: 'PF ' + c.maxHp }),
              el('div', { class: 'stat-line' }, R.ABILITIES.map((ab) => el('span', { class: 'stat' },
                el('b', { text: ab }), ' ' + fin[ab] + ' (' + R.formatModifier(R.modifier(fin[ab])) + ')'))),
              stats.saves.length ? el('p', { class: 'small muted', text: 'TS competenti: ' + stats.saves.map((ab) => ab + ' ' + R.formatModifier(stats.saveTotals[ab])).join(', ') }) : null,
              stats.spell ? el('p', { class: 'small muted', text: '✨ CD ' + stats.spell.dc + ' · attacco ' + R.formatModifier(stats.spell.attack) + ' · ' +
                c.spellcasting.known.length + ' incantesimi · slot ' + (stats.spell.slotsTotal.map((n, i) => n - stats.spell.slotsUsed[i]).filter((n, i) => stats.spell.slotsTotal[i]).join('/') || '—') }) : null,
              stats.weapons.length ? el('ul', { class: 'weapon-list small' }, stats.weapons.map((w) => el('li', { text: weaponLabel(w) }))) : null,
              cfg.isPlayer && c.inventory.length ? el('p', { class: 'small muted', text: '🎒 ' + c.inventory.length + ' oggetti · ' + A.formatWeight(A.inventoryWeight(c.inventory, catalog(), c.coins)) }) : null,
              el('label', { class: 'check small' },
                el('input', { type: 'checkbox', checked: c.shared, onchange: (e) => { save(() => { c.shared = e.target.checked; }); render(); } }),
                ' Condividi con tutte le sessioni'),
              el('div', { class: 'card-actions' },
                el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = c.id; render(); } }),
                el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(c) }),
                cfg.isPlayer ? el('button', { class: 'btn', text: '✦ Eleva a leggendario', disabled: c.level < 20, title: c.level < 20 ? 'Serve il livello 20' : 'Diventa un personaggio leggendario (livelli 20-40)',
                  onclick: () => { if (DnD.uiLeggendario.promote(c)) { tab = 'leggendari'; render(); } } }) : null,
                cfg.isPlayer ? null : el('button', { class: 'btn', text: 'Esporta', onclick: () => exportOne(c) }),
                el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(c) })));
          }))
          : query ? el('p', { class: 'empty', text: 'Nessun risultato per «' + query + '».' }) : DnD.ui.emptyState('Nessun ' + cfg.singular.toLowerCase() + ' in questa sessione',
            'Crea un ' + cfg.singular.toLowerCase() + ' per la sessione «' + DnD.sessioni.current(DnD.store.state).name + '», oppure condividine uno da un\'altra sessione.',
            [{ text: '+ Nuovo ' + cfg.singular.toLowerCase(), primary: true, onclick: () => { editing = 'new'; render(); } }]));
    }

    // opts (leggendari): { player, host, wrap(head, form) -> nodo, onDone(salvato | null), heading, submitText }
    function renderForm(opts) {
      opts = opts || {};
      const races = DnD.store.state.races;
      const existing = opts.player || list().find((c) => c.id === editing);
      const c = existing || DnD.dati.normalizeCreature({ name: '', level: 1, maxHp: 10, ac: 10, acMode: 'auto', saveMode: 'classe' }, cfg.isPlayer);
      if (!existing) c.name = '';
      const legendary = c.type === 'leggendario';
      const minLv = legendary ? 20 : 1;
      const maxLv = legendary ? 40 : 30;
      const done = (saved) => { if (opts.onDone) opts.onDone(saved); else { editing = null; render(); } };

      const inp = {
        name: textInput(c.name, { maxlength: 60 }),
        playerName: cfg.isPlayer ? textInput(c.playerName, { maxlength: 60 }) : null,
        raceId: el('select', {},
          el('option', { value: '', text: '— Nessuna razza —' }),
          races.map((r) => el('option', { value: r.id, text: r.name, selected: r.id === c.raceId })),
          c.raceId && !races.some((r) => r.id === c.raceId) ? el('option', { value: c.raceId, text: 'Razza eliminata', selected: true }) : null),
        level: numberInput(c.level, { min: minLv, max: maxLv }),
        abilityCap: legendary ? numberInput(c.abilityCap, { min: 20, max: 30, 'data-key': 'abilityCap' }) : null,
        notes: el('textarea', { rows: 4, value: c.notes }),
        shared: el('input', { type: 'checkbox', checked: c.shared }),
      };

      const getRace = () => races.find((r) => r.id === inp.raceId.value) || null;
      const levelNow = () => { const v = readNumber(inp.level); return isInt(v, minLv, maxLv) ? v : null; };
      const capNow = () => { const v = inp.abilityCap ? readNumber(inp.abilityCap) : 20; return isInt(v, 20, 30) ? v : 20; };
      const finalNow = () => abilities.final();
      const refresh = () => {
        abilities.refresh();
        cls.refresh();
        hp.refresh();
        ac.refresh();
        saves.refresh();
        spells.refresh();
        weapons.refresh();
        gridSize.refresh();
        if (behavior) behavior.refresh();
      };

      const cls = classEditor(c, () => { refresh(); ac.classChanged(); spells.classChanged(); });
      const abilities = abilitiesEditor(c.abilities, c.asi, c.ignoreCap, { getRace, getLevel: levelNow, getClassInfo: () => cls.info(), onChange: refresh, cap: capNow });
      const hp = hpEditor(c, {
        current: () => {
          const info = cls.info();
          const lv = levelNow();
          const fin = finalNow();
          if (!info) return 'Scegli una classe per calcolare i PF.';
          if (!lv || !fin) return 'Completa livello e caratteristiche per calcolare i PF.';
          return { level: lv, conMod: R.modifier(fin.COS), hitDie: info.hitDie };
        },
      });
      const ac = acEditor(c, { abilities: finalNow, unarmored: () => { const i = cls.info(); return (i && i.unarmored) || null; } });
      const saves = savesEditor(c, {
        abilities: finalNow, level: levelNow, allowOverride: !cfg.isPlayer || legendary, legendary,
        classSaves: () => { const i = cls.info(); return i ? i.saves : null; },
      });
      const spells = DnD.uiIncantesimi.spellcastingEditor(c, {
        info: () => cls.info(), classId: () => cls.select.value, final: finalNow, level: levelNow, profBonus: () => saves.profBonus(),
      });
      const weapons = weaponsEditor(c.weapons, { abilities: finalNow, profBonus: () => saves.profBonus() });
      const icon = DnD.uiIcone.iconPicker(c.icon, false, null, (x) => gridSize.suggest(x.grid, x.name));
      const gridSize = gridSizeEditor(c.gridSize, { size: () => { const r = getRace(); return r ? r.size : null; } });
      // Solo i nemici: comportamento nel combattimento simulato, con l'anteprima dell'archetipo.
      const behavior = cfg.isPlayer ? null : DnD.uiIa.behaviorEditor(c.behavior, {
        name: () => inp.name.value.trim(),
        combatant: () => { const f = finalNow(); return f ? { id: 'anteprima', abilities: f, weapons: weapons.read(), spellcasting: null, creature: null } : null; },
      });
      const inventory = cfg.isPlayer ? inventoryEditor(c) : null;
      inp.raceId.addEventListener('change', refresh);
      inp.level.addEventListener('input', refresh);
      if (inp.abilityCap) inp.abilityCap.addEventListener('input', refresh);

      // Nome casuale dalla lista di nomi, evitando quelli già usati.
      const nameField = field('Nome', inp.name, 'name');
      const nameRow = el('div', { class: 'input-row' });
      inp.name.replaceWith(nameRow);
      nameRow.append(inp.name, el('button', {
        type: 'button', class: 'btn', title: 'Nome casuale', 'aria-label': 'Nome casuale', text: '🎲',
        onclick: () => {
          const st = DnD.store.state;
          const used = st.players.concat(st.npcs).filter((x) => x.id !== c.id).map((x) => x.name);
          const name = DnD.nomi.pickName(DnD.nomi.NAMES, used, DnD.dadi.randomInt);
          if (name) { inp.name.value = name; inp.name.focus(); }
        },
      }));

      const form = el('form', { class: 'panel form', novalidate: true },
        el('div', { class: 'grid-3' },
          nameField,
          cfg.isPlayer ? field('Nome del giocatore', inp.playerName, 'playerName') : null,
          field('Razza', inp.raceId, 'raceId'),
          field('Livello', inp.level, 'level', legendary ? '20-40 · rango leggendario = livello − 20' : null),
          field('Classe', cls.select, 'classId'),
          legendary ? field('Tetto delle caratteristiche', inp.abilityCap, 'abilityCap', 'leggendari: 30') : null),
        cls.customBox,
        icon.node,
        gridSize.node,
        behavior ? behavior.node : null,
        abilities.node,
        el('div', { class: 'grid-2 combat-stats' }, hp.node, ac.node),
        saves.node,
        spells.node,
        weapons.node,
        inventory ? inventory.node : null,
        field('Note', inp.notes),
        el('label', { class: 'check' }, inp.shared, ' Condividi con tutte le sessioni (modello riutilizzabile)'),
        el('div', { class: 'form-actions' },
          el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => done(null) }),
          el('button', { type: 'submit', class: 'btn primary' + (opts.submitClass ? ' ' + opts.submitClass : ''), text: opts.submitText || 'Salva' })));

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const data = Object.assign({
          id: c.id,
          sessionId: c.sessionId || currentSessionId(),
          // Nemici generati: si conservano l'origine (razza, livello, classe di partenza).
          generated: Boolean(c.generated),
          origin: c.origin || null,
          shared: inp.shared.checked,
          name: inp.name.value.trim(),
          raceId: inp.raceId.value,
          level: readNumber(inp.level),
          abilities: abilities.read(),
          weapons: weapons.read(),
          notes: inp.notes.value.trim(),
        }, abilities.readAsi(), cls.read(), hp.read(), ac.read(), saves.read(), gridSize.read(), behavior ? behavior.read() : {}, { spellcasting: spells.read() }, inventory ? inventory.read() : {});
        if (cfg.isPlayer) data.playerName = inp.playerName.value.trim();
        // Leggendari: tipo, tetto e dati del percorso e delle trasformazioni restano quelli della scheda.
        if (legendary) Object.assign(data, { type: 'leggendario', abilityCap: readNumber(inp.abilityCap), legend: c.legend });
        else if (c.legendArchive) data.legendArchive = c.legendArchive;
        const iconResult = icon.read();
        data.icon = iconResult.icon;
        const errors = DnD.validazione.validateCreature(data, { playerName: cfg.isPlayer });
        if (iconResult.error) errors.icon = iconResult.error;
        if (data.acMode === 'auto' && !errors['armor.base'] && !isInt(data.ac, 1, 40)) {
          errors['abilities.DES'] = errors['abilities.DES'] || 'Completa le caratteristiche per calcolare la CA.';
        }
        if (!showErrors(form, errors)) return;
        const saved = DnD.dati.normalizeCreature(data, cfg.isPlayer);
        save((st) => {
          const i = st[cfg.key].findIndex((x) => x.id === saved.id);
          if (i >= 0) st[cfg.key][i] = saved;
          else st[cfg.key].push(saved);
        });
        toast(cfg.singular + ' salvato.', 'success');
        done(saved);
      });

      const head = el('div', { class: 'section-head' },
        el('h1', { text: opts.heading || (existing ? 'Modifica ' : 'Nuovo ') + cfg.singular.toLowerCase() }));
      (opts.host || root).append(opts.wrap ? opts.wrap(head, form) : el('div', {}, head, form));
      spells.init();
      refresh();
      inp.name.focus();
    }

    // Per la scheda dei leggendari (ui-leggendario.js): stesso form del giocatore.
    const api = { renderForm: (o) => renderForm(o), save, refresh: () => render() };

    return {
      title: cfg.title,
      render,
      reset: () => { editing = null; if (!cfg.isPlayer && DnD.uiMostri) DnD.uiMostri.reset(); },
      // Azioni rapide dalle schermate vuote (es. "Aggiungi nemici").
      open: (action) => { if (action === 'nuovo') { editing = 'new'; tab = 'standard'; } },
    };
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.nemici = createSection({ key: 'npcs', title: 'Nemici (NPC)', singular: 'Nemico', isPlayer: false });
  DnD.sezioni.giocatori = createSection({ key: 'players', title: 'Giocatori', singular: 'Giocatore', isPlayer: true });
  DnD.uiCreature = { weaponLabel, gridSizeEditor, exportOne, importOne };
})(globalThis.DnD = globalThis.DnD || {});
