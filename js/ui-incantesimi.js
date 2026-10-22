// Sezione "Incantesimi" nei form di Nemici e Giocatori: caratteristica da incantatore,
// bonus di attacco e CD (sovrascrivibili), slot totali/usati, riposi e incantesimi conosciuti.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, readNumber } = DnD.ui;
  const R = DnD.regole;
  const M = DnD.magie;
  const C = DnD.classi;
  const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const optionalNumber = (input) => (input.value.trim() === '' ? null : readNumber(input));
  const withOutput = (fieldNode, output) => { fieldNode.appendChild(output); return fieldNode; };

  // ctx: { info() -> classe effettiva | null, classId(), final() -> caratteristiche | null, level(), profBonus() }
  function spellcastingEditor(c, ctx) {
    const sc = c.spellcasting;
    const known = new Set(sc.known);
    const ability = el('select', { 'aria-label': 'Caratteristica da incantatore', onchange: () => refresh() },
      el('option', { value: '', text: 'Da classe' }),
      R.ABILITIES.map((ab) => el('option', { value: ab, text: R.ABILITY_NAMES[ab], selected: sc.ability === ab })));
    const attackOverride = numberInput(sc.attackOverride, { placeholder: 'auto', 'data-key': 'spell.attackOverride', oninput: () => refresh() });
    const dcOverride = numberInput(sc.dcOverride, { placeholder: 'auto', 'data-key': 'spell.dcOverride', oninput: () => refresh() });
    const attackOut = el('output', { class: 'calc-detail' });
    const dcOut = el('output', { class: 'calc-detail' });
    const slotInputs = LEVELS.map((l, i) => numberInput(sc.slotOverrides[i], { min: 0, max: 20, 'aria-label': 'Slot totali di ' + l + '° livello', 'data-key': 'spell.slot.' + i, oninput: () => refresh() }));
    const usedInputs = LEVELS.map((l, i) => numberInput(sc.slotsUsed[i], { min: 0, max: 20, 'aria-label': 'Slot usati di ' + l + '° livello', 'data-key': 'spell.used.' + i, oninput: () => refresh() }));
    const leftCells = LEVELS.map(() => el('td', { class: 'num' }));
    const casterText = el('p', { class: 'muted small' });
    const prepareHint = el('p', { class: 'warn' });
    const cantripList = el('ul', { class: 'spell-pick' });
    const spellList = el('ul', { class: 'spell-pick' });
    const cantripCount = el('span', { class: 'muted small' });
    const spellCount = el('span', { class: 'muted small' });

    const autoSlots = () => {
      const info = ctx.info();
      const lv = ctx.level();
      return info && info.caster && lv ? C.slotTable(info.caster, lv) : [0, 0, 0, 0, 0, 0, 0, 0, 0];
    };
    const totals = () => M.effectiveSlots(autoSlots(), slotInputs.map(optionalNumber));
    const setUsed = (fn) => { usedInputs.forEach((inp, i) => { inp.value = String(fn(i, readNumber(inp) || 0)); }); refresh(); };

    // Incantesimi della classe (più quelli già scelti, anche se di altre classi).
    function renderLists() {
      const classId = ctx.classId();
      const all = DnD.store.state.spells
        .filter((s) => classId === C.CUSTOM || s.classes.includes(classId) || known.has(s.id))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'it'));
      const entry = (s) => el('li', {}, el('label', { class: 'check small', title: DnD.uiMagie.effectSummary(s) },
        el('input', { type: 'checkbox', checked: known.has(s.id), onchange: (e) => { if (e.target.checked) known.add(s.id); else known.delete(s.id); refresh(); } }),
        ' ' + s.name + (s.level ? ' (' + s.level + '°)' : '')));
      const cantrips = all.filter((s) => s.level === 0);
      const spells = all.filter((s) => s.level > 0);
      clear(cantripList).append(...(cantrips.length ? cantrips.map(entry) : [el('li', { class: 'muted small', text: 'Nessun trucchetto per questa classe nella libreria.' })]));
      clear(spellList).append(...(spells.length ? spells.map(entry) : [el('li', { class: 'muted small', text: 'Nessun incantesimo per questa classe nella libreria.' })]));
    }

    function refresh() {
      const info = ctx.info();
      node.hidden = !(info && info.caster);
      if (node.hidden) return;
      const fin = ctx.final();
      const pb = ctx.profBonus();
      const ab = ability.value || info.spellAbility;
      ability.options[0].textContent = 'Da classe (' + info.spellAbility + ')';
      casterText.textContent = C.CASTER_NAMES[info.caster] + (info.caster === 'patto' ? ': gli slot si recuperano anche con un riposo breve.' : '.');
      if (fin && pb !== null) {
        const mod = R.modifier(fin[ab]);
        attackOut.textContent = 'Calcolato: ' + R.formatModifier(M.spellAttackBonus(pb, mod)) + ' (competenza ' + R.formatModifier(pb) + ' + ' + ab + ' ' + R.formatModifier(mod) + ')' +
          (attackOverride.value.trim() !== '' ? ' · usato: ' + R.formatModifier(readNumber(attackOverride) || 0) : '');
        dcOut.textContent = 'Calcolata: ' + M.spellSaveDc(pb, mod) + ' (8 + ' + pb + ' + ' + ab + ' ' + R.formatModifier(mod) + ')' +
          (dcOverride.value.trim() !== '' ? ' · usata: ' + dcOverride.value.trim() : '');
        const prepares = C.CLASSES[ctx.classId()] && C.CLASSES[ctx.classId()].prepares;
        const lv = ctx.level();
        prepareHint.textContent = prepares && lv
          ? 'Suggerimento: incantesimi preparabili = ' + (prepares === 'meta' ? 'metà livello' : 'livello') + ' + mod. ' + ab + ' = ' +
            Math.max(1, (prepares === 'meta' ? Math.floor(lv / 2) : lv) + mod) + '.'
          : '';
      } else {
        attackOut.textContent = dcOut.textContent = 'Completa livello e caratteristiche.';
        prepareHint.textContent = '';
      }
      const auto = autoSlots();
      const tot = totals();
      LEVELS.forEach((l, i) => {
        slotInputs[i].placeholder = String(auto[i]);
        const left = (tot[i] || 0) - (readNumber(usedInputs[i]) || 0);
        leftCells[i].textContent = String(left);
        leftCells[i].classList.toggle('negative', left < 0);
      });
      const selected = DnD.store.state.spells.filter((s) => known.has(s.id));
      cantripCount.textContent = 'Scelti: ' + selected.filter((s) => s.level === 0).length;
      spellCount.textContent = 'Scelti: ' + selected.filter((s) => s.level > 0).length;
    }

    const node = el('fieldset', { class: 'spell-box' },
      el('legend', { text: 'Incantesimi' }),
      casterText,
      el('div', { class: 'spell-stat-line' },
        field('Caratteristica da incantatore', ability),
        withOutput(field('Bonus di attacco (sovrascrivi)', attackOverride, 'spell.attackOverride'), attackOut),
        withOutput(field('CD del tiro salvezza (sovrascrivi)', dcOverride, 'spell.dcOverride'), dcOut)),
      el('table', { class: 'slot-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Slot' }), LEVELS.map((l) => el('th', { text: l + '°' })))),
        el('tbody', {},
          el('tr', {}, el('th', { text: 'Totali', title: 'Vuoto = calcolato da classe e livello' }), slotInputs.map((i) => el('td', {}, i))),
          el('tr', {}, el('th', { text: 'Usati' }), usedInputs.map((i) => el('td', {}, i))),
          el('tr', {}, el('th', { text: 'Rimasti' }), leftCells))),
      el('small', { class: 'hint', text: 'Slot totali vuoti = calcolati in automatico da classe e livello.' }),
      el('div', { class: 'head-actions' },
        el('button', { type: 'button', class: 'btn small', text: '🌙 Riposo lungo', title: 'Ripristina tutti gli slot', onclick: () => setUsed(() => 0) }),
        el('button', { type: 'button', class: 'btn small', text: '☕ Riposo breve', title: 'Ripristina gli slot della magia del patto', onclick: () => {
          const info = ctx.info();
          if (info && info.caster === 'patto') setUsed(() => 0);
          else DnD.ui.toast('Il riposo breve ripristina solo gli slot della magia del patto (Warlock).');
        } })),
      el('div', { class: 'spell-lists' },
        el('div', {}, el('div', { class: 'history-head' }, el('h3', { text: 'Trucchetti' }), cantripCount), cantripList),
        el('div', {}, el('div', { class: 'history-head' }, el('h3', { text: 'Incantesimi conosciuti/preparati' }), spellCount), spellList)),
      prepareHint);

    return {
      node,
      refresh,
      classChanged: () => { renderLists(); refresh(); },
      read: () => ({
        ability: ability.value || null,
        attackOverride: optionalNumber(attackOverride),
        dcOverride: optionalNumber(dcOverride),
        slotOverrides: slotInputs.map(optionalNumber),
        slotsUsed: usedInputs.map((i) => (i.value.trim() === '' ? 0 : readNumber(i))),
        known: [...known].filter((id) => DnD.store.state.spells.some((s) => s.id === id)),
      }),
      init: () => { renderLists(); refresh(); },
    };
  }

  DnD.uiIncantesimi = { spellcastingEditor };
})(globalThis.DnD = globalThis.DnD || {});
