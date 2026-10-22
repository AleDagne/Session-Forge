// Interfaccia dell'IA dei nemici: editor del comportamento nei form di Nemici (Standard e Creature), anteprima
// del piano sulla griglia (percorso tratteggiato, bersagli evidenziati) e finestra "Perché?" con i punteggi.
(function (DnD) {
  'use strict';

  const { el, clear, numberInput, readNumber, openDialog } = DnD.ui;
  const K = DnD.iaDati;
  const IA = DnD.ia;

  // ctx: { name() -> nome, combatant() -> combattente di prova (caratteristiche finali, armi, creatura) | null }
  function behaviorEditor(initial, ctx) {
    const b = IA.normalizeBehavior(initial);
    const temperament = el('select', { 'aria-label': 'Temperamento', onchange: () => refresh() }, K.TEMPERAMENTS.map((t) => el('option', { value: t, text: K.TEMPERAMENT_NAMES[t], selected: t === b.temperament })));
    const archetype = el('select', { 'aria-label': 'Archetipo', onchange: () => refresh() },
      el('option', { value: 'auto', text: 'Automatico (caratteristica più alta)', selected: b.archetype === 'auto' }),
      K.ARCHETYPES.map((a) => el('option', { value: a, text: a + ' – ' + K.ARCHETYPE_NAMES[a], selected: a === b.archetype })));
    const range = numberInput(b.preferredRange, { min: 1, max: 100, placeholder: 'gittata', 'aria-label': 'Distanza preferita (celle)', class: 'qty', 'data-key': 'behavior.preferredRange', oninput: () => refresh() });
    const fleeOn = el('input', { type: 'checkbox', checked: b.fleeAt > 0, onchange: () => { flee.disabled = !fleeOn.checked; refresh(); } });
    const flee = numberInput(b.fleeAt || 25, { min: 1, max: 90, 'aria-label': 'Soglia di fuga (% PF)', class: 'qty', disabled: !(b.fleeAt > 0), oninput: () => refresh() });
    const rnd = el('input', { type: 'range', min: 0, max: 30, value: String(b.randomness), 'aria-label': 'Casualità delle scelte (%)', oninput: () => refresh() });
    const rndOut = el('output', { class: 'muted small' });
    const classes = {};
    const sag = el('div', { class: 'check-row' }, DnD.classi.IDS.map((id) => {
      classes[id] = el('input', { type: 'checkbox', checked: b.sagTargets.includes(id), onchange: () => refresh() });
      return el('label', { class: 'check small' }, classes[id], ' ' + DnD.classi.CLASSES[id].name);
    }));
    const preview = el('p', { class: 'calc-detail behavior-preview', 'aria-live': 'polite' });

    function read() {
      return {
        behavior: IA.normalizeBehavior({
          temperament: temperament.value, archetype: archetype.value,
          preferredRange: range.value.trim() === '' ? null : readNumber(range),
          fleeAt: fleeOn.checked ? readNumber(flee) : 0, randomness: Number(rnd.value),
          sagTargets: DnD.classi.IDS.filter((id) => classes[id].checked),
        }),
      };
    }
    function refresh() {
      rndOut.textContent = rnd.value + '%';
      const bh = read().behavior;
      const c = ctx.combatant();
      if (!c) { preview.textContent = 'Comportamento previsto: completa le caratteristiche.'; return; }
      c.behavior = bh;
      const arch = IA.archetypeOf(c, DnD.store.state.equipment);
      const ranged = IA.allOptions(c, DnD.store.state.equipment).some((o) => o.ranged && !o.heal && !o.buff);
      preview.textContent = IA.describe(ctx.name() || 'Nemico', bh, arch, ranged) +
        (bh.temperament === 'aggressivo' && bh.fleeAt ? ' (gli Aggressivi non fuggono mai)' : '');
    }
    const node = el('fieldset', { class: 'behavior-box' },
      el('legend', { text: 'Comportamento (combattimento simulato)' }),
      el('div', { class: 'grid-2 tight' },
        el('div', { class: 'field' }, el('label', { text: 'Temperamento' }), temperament),
        el('div', { class: 'field' }, el('label', { text: 'Archetipo' }), archetype)),
      el('details', {}, el('summary', { text: 'Opzioni avanzate' }),
        el('div', { class: 'input-row' }, el('label', { class: 'inline small' }, 'Distanza preferita (celle, chi sta a distanza)', range)),
        el('div', { class: 'input-row' }, el('label', { class: 'check small' }, fleeOn, ' Fuga sotto il'), flee, el('span', { class: 'small', text: '% dei PF (solo Furbi)' })),
        el('div', { class: 'input-row' }, el('label', { class: 'inline small' }, 'Casualità delle scelte', rnd), rndOut),
        el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Classi bersaglio prioritarie (archetipo SAG)' }), sag)),
      preview);
    refresh();
    return { node, read, refresh };
  }

  // Anteprima del piano: percorso tratteggiato dal centro della pedina, posizione d'arrivo e bersagli.
  function drawPlan(ctx, view, s, plan, combatants, colors) {
    if (!plan) return;
    const mover = combatants.find((c) => c.id === plan.combatantId);
    if (!mover) return;
    const d = DnD.griglia.tokenDims(mover);
    const center = (p) => [view.panX + (p.x + d.w / 2) * s, view.panY + (p.y + d.h / 2) * s];
    ctx.save();
    ctx.strokeStyle = colors.current;
    ctx.fillStyle = colors.current;
    ctx.lineWidth = Math.max(2, s * 0.08);
    if (plan.path.length > 1) {
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      plan.path.forEach((p, i) => { const [x, y] = center(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.setLineDash([]);
      const end = plan.path[plan.path.length - 1];
      ctx.globalAlpha = 0.25;
      ctx.fillRect(view.panX + end.x * s, view.panY + end.y * s, d.w * s, d.h * s);
      ctx.globalAlpha = 1;
      ctx.strokeRect(view.panX + end.x * s + 1, view.panY + end.y * s + 1, d.w * s - 2, d.h * s - 2);
    }
    ctx.strokeStyle = colors.bad || '#d4453a';
    ctx.lineWidth = Math.max(2.5, s * 0.1);
    for (const id of (plan.action && plan.action.targetIds) || []) {
      const t = combatants.find((c) => c.id === id);
      if (!t || !t.pos) continue;
      const td = DnD.griglia.tokenDims(t);
      ctx.beginPath();
      ctx.ellipse(view.panX + (t.pos.x + td.w / 2) * s, view.panY + (t.pos.y + td.h / 2) * s, td.w * s * 0.55, td.h * s * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function whyDialog(text) {
    openDialog('Perché?', el('pre', { class: 'why-text', text }), [{ text: 'Chiudi' }]);
  }

  // Etichetta sopra una pedina (es. movimento residuo del combattente di turno), con lo stile del misuratore.
  function drawBadge(ctx, view, s, c, text) {
    const d = DnD.griglia.tokenDims(c);
    const cx = view.panX + (c.pos.x + d.w / 2) * s;
    const top = view.panY + c.pos.y * s;
    const cs = getComputedStyle(document.documentElement);
    ctx.save();
    ctx.font = 'bold ' + Math.max(10, Math.min(14, s * 0.36)) + 'px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    const h = Math.max(14, Math.min(20, s * 0.5));
    ctx.fillStyle = cs.getPropertyValue('--grid-label-bg').trim() || 'rgba(0,0,0,0.7)';
    ctx.fillRect(cx - w / 2, top - h - 3, w, h);
    ctx.fillStyle = cs.getPropertyValue('--accent').trim() || '#e8832a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, top - h / 2 - 3);
    ctx.restore();
  }

  DnD.uiIa = { behaviorEditor, drawPlan, drawBadge, whyDialog, clear };
})(globalThis.DnD = globalThis.DnD || {});
