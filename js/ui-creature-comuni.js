// Aiuti condivisi dalle schede dei Nemici e dei Giocatori (ui-creature, ui-scheda, ui-mostri, ui-boss, ui-generatore):
// etichetta di un'arma, editor della dimensione sulla griglia, esporta e importa una singola creatura.
// Livello interfaccia (sotto le sezioni). Espone DnD.uiCreatureComuni; usa DnD.ui, regole, griglia, dati, sessioni, store.
(function (DnD) {
  'use strict';

  const { el, numberInput, readNumber, toast } = DnD.ui;
  const R = DnD.regole;
  const G = DnD.griglia;
  const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

  function weaponLabel(w) {
    const bonus = w.damageBonus ? R.formatModifier(w.damageBonus) : '';
    return w.name + ' (' + R.formatModifier(w.toHit) + ', ' + w.damageDice + bonus + (w.damageType ? ' ' + w.damageType : '') + ')';
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

  // Esporta una singola creatura (nemico standard o creatura del Manuale) come file JSON.
  function exportOne(c) {
    const data = { app: DnD.config.APP_NAME, kind: 'creatura', version: DnD.dati.VERSION, exportedAt: new Date().toISOString(), creature: c };
    DnD.ui.download(JSON.stringify(data, null, 2), DnD.ui.slug(DnD.config.APP_NAME) + '-creatura-' + DnD.ui.slug(c.name) + '.json');
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

  DnD.uiCreatureComuni = { weaponLabel, gridSizeEditor, exportOne, importOne };
})(globalThis.DnD = globalThis.DnD || {});
