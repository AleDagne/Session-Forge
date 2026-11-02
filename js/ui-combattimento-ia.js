// Combattimento › Combattimento simulato (IA): stato per il pianificatore, piano del turno, esecuzione animata
// (movimento e azioni con le stesse funzioni dei pulsanti del master), annulla/ripeti di un turno, modalità automatica
// e pannello dell'IA. Parte della schermata Combattimento (ui-combattimento.js), che le passa stato e funzioni con
// un'api. Livello interfaccia. Espone DnD.uiCombattimentoIA { ia(api) }.
(function (DnD) {
  'use strict';

  // api (da ui-combattimento.js): IA, KI, M, Mv, R, S, aiHistory, byId, clone, combat, el, fpc, limited, log, mutate, nextTurn, performAttack, performCast, performCreatureAction, relTable, render, rules, session, toast
  function ia(api) {
    const {
      IA, KI, M, Mv, R, S, aiHistory, byId, clone, combat, el, fpc, limited, log, mutate, nextTurn, performAttack, performCast, performCreatureAction, relTable, render, rules, session, toast,
    } = api;

    const aiOn = () => Boolean(combat() && combat().ai && combat().ai.simulated);
    function aiState() {
      const st = DnD.store.state;
      const c = combat();
      return { combatants: c.combatants, grid: c.grid, catalog: st.equipment, tilesets: DnD.tilemap.tilesetIndex(st.tilesets), round: c.round, seed: c.ai.seed, rules: rules(), relations: relTable(st) };
    }
    // Impronta di ciò che cambia il piano: posizioni, PF, ingombri, controllo, fazioni e oggetti della griglia.
    const aiSignature = (c) => JSON.stringify([c.round, c.currentId, c.freeMovement, c.combatants.map((x) => [x.id, x.pos, x.hp, x.w, x.h, x.control, x.faction, x.hidden, x.movement, x.conditions, x.moveMode, x.hostileTo, x.joinRound, x.light]),
      c.grid.items.map((it) => [it.id, it.x, it.y, it.state, it.light]), c.grid.structures.length, c.grid.ignoreCollisions, c.grid.vision]);
    // Piano del combattente di turno, se è controllato dall'IA: si ricalcola quando cambia il turno o la griglia,
    // o su richiesta (Ricalcola, Cambia bersaglio: il bersaglio scelto resta finché non si ricalcola).
    function currentAiPlan(force) {
      const c = combat();
      if (!c || !aiOn() || c.phase !== 'attivo') return null;
      const cur = c.currentId ? byId(c.currentId) : null;
      if (!cur || cur.control !== 'ia' || R.isDown(cur)) return null;
      const sig = aiSignature(c);
      const target = force ? force.targetId || null : S.aiPlan && S.aiPlan.forId === cur.id && S.aiPlan.round === c.round ? S.aiPlan.targetId : null;
      if (force || !S.aiPlan || S.aiPlan.sig !== sig) {
        S.aiPlan = { forId: cur.id, round: c.round, sig, targetId: target, plan: IA.pianificaTurno(aiState(), cur, target ? { forceTargetId: target } : {}) };
      }
      return S.aiPlan.plan;
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Animazione dello spostamento: la pedina avanza cella per cella (solo in memoria, poi si salva una volta).
    async function animateMove(id, path, ms) {
      for (const p of path.slice(1)) {
        const x = byId(id);
        if (!x) return;
        x.pos = { x: p.x, y: p.y };
        if (S.grid) S.grid.requestDraw();
        await sleep(ms);
      }
    }
    // Esegue il piano: spostamento, riga di log con la motivazione (e i punteggi per "Perché?"), poi l'azione
    // con le funzioni esistenti; infine passa al turno successivo. Tutto il turno si annulla in un colpo.
    async function executePlan(plan, animate) {
      if (S.aiBusy || !plan || !combat()) return;
      const x = byId(plan.combatantId);
      if (!x) return;
      S.aiBusy = true;
      const before = clone(combat());
      try {
        const end = plan.path[plan.path.length - 1];
        if (animate && plan.path.length > 1 && !DnD.impostazioni.reduceMotion()) {
          await animateMove(x.id, plan.path, Math.min(160, Math.max(40, (combat().ai.delay * 1000) / plan.path.length)));
        }
        mutate((c) => {
          const m = c.combatants.find((y) => y.id === plan.combatantId);
          if (end && plan.dash && limited(m)) Mv.dash(m);
          let moveLine = '';
          if (end && (end.x !== m.pos.x || end.y !== m.pos.y)) {
            if (limited(m)) {
              Mv.recordMove(m, end, plan.moveCost);
              moveLine = Mv.moveText(m, plan.path.length - 1, plan.moveCost, Mv.left(m, rules(), fpc()), fpc());
            } else m.pos = { x: end.x, y: end.y };
          }
          DnD.dati.pushLog(c, 'ia', '🤖 ' + plan.reason);
          c.log[c.log.length - 1].why = IA.whyText(plan);
          if (moveLine) log(c, 'movimento', moveLine);
          for (const r of plan.reminders) log(c, 'sistema', r);
          const a = plan.action;
          if (a.kind === 'schivare') log(c, 'sistema', m.name + ' usa Schivare: gli attacchi contro di lui hanno svantaggio fino al suo prossimo turno.');
          if (a.kind === 'aiutare') {
            const ally = c.combatants.find((y) => y.id === a.targetIds[0]);
            const foe = c.combatants.find((y) => y.id === a.foeId);
            log(c, 'sistema', m.name + ' usa Aiutare: ' + (ally ? ally.name : '') + ' ha vantaggio al prossimo attacco' + (foe ? ' contro ' + foe.name : '') + '.');
          }
        });
        const a = plan.action;
        if (a.kind === 'arma') performAttack(x.id, a.targetIds[0], a.id, a.mode);
        else if (a.kind === 'creatura') {
          const st = byId(x.id).creature;
          const act = st && M.allActions(st).find((y) => y.id === a.id);
          const steps = act && act.mech.kind === 'multiattacco' ? M.expandMultiattack(st, act).map(() => [a.targetIds[0]]) : [a.targetIds];
          performCreatureAction(x.id, a.id, steps, a.mode);
        } else if (a.kind === 'incantesimo') performCast(x.id, a.id, a.slotLevel, a.targetIds, a.mode);
      } finally {
        S.aiBusy = false;
      }
      S.aiPlan = null;
      nextTurn();
      aiHistory.push(before, clone(combat()));
      render();
    }
    function restoreCombat(state, text) {
      if (!state) return;
      S.aiPaused = true;
      clearTimeout(S.aiTimer);
      DnD.store.update((st) => { session(st).combat = clone(state); });
      S.aiPlan = null;
      render();
      toast(text);
    }
    function skipTurn() {
      const before = clone(combat());
      const cur = byId(combat().currentId);
      mutate((c) => log(c, 'ia', '🤖 ' + cur.name + ' salta il turno (scelta del master).'));
      S.aiPlan = null;
      nextTurn();
      aiHistory.push(before, clone(combat()));
    }
    // Modalità automatica: il turno IA parte da solo dopo il ritardo; si ferma al turno di un combattente
    // manuale, con la Pausa, o quando non ci sono più avversari.
    function scheduleAuto() {
      clearTimeout(S.aiTimer);
      S.aiTimer = null;
      const c = combat();
      if (!c || c.phase !== 'attivo' || !aiOn() || c.ai.mode !== 'auto' || S.aiPaused || S.aiBusy) return;
      const plan = currentAiPlan();
      if (!plan) return;
      if (plan.action.kind === 'nessuna' && /nessun avversario/.test(plan.reason)) {
        S.aiPaused = true;
        toast('Combattimento simulato in pausa: nessun avversario rimasto.');
        render();
        return;
      }
      S.aiTimer = setTimeout(() => {
        S.aiTimer = null;
        if (S.root && S.root.isConnected && !S.aiPaused && combat() && combat().ai.mode === 'auto') executePlan(currentAiPlan(), true);
      }, c.ai.delay * 1000);
    }

    // Pannello del combattimento simulato: interruttore, modalità, ritardo, pausa, annulla/ripeti e piano del turno.
    function aiPanel() {
      const c = combat();
      const ai = c.ai;
      const setAi = (patch) => { mutate((cc) => Object.assign(cc.ai, patch)); };
      const head = el('div', { class: 'ai-controls' },
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ai.simulated, onchange: (e) => { S.aiPaused = false; S.aiPlan = null; setAi({ simulated: e.target.checked }); } }), ' Combattimento simulato'),
        ai.simulated ? el('select', { 'aria-label': 'Modalità', onchange: (e) => { S.aiPaused = false; setAi({ mode: e.target.value }); } },
          KI.MODES.map((m) => el('option', { value: m, text: KI.MODE_NAMES[m], selected: m === ai.mode }))) : null,
        ai.simulated && ai.mode === 'auto' ? el('label', { class: 'inline small' }, 'Ritardo',
          el('input', { type: 'range', min: 0, max: 3, step: 0.5, value: String(ai.delay), 'aria-label': 'Ritardo (secondi)',
            onchange: (e) => setAi({ delay: Number(e.target.value) }) }), ai.delay + ' s') : null,
        ai.simulated && ai.mode === 'auto' ? el('button', { type: 'button', class: 'btn small', text: S.aiPaused ? '▶ Riprendi' : '⏸ Pausa',
          onclick: () => { S.aiPaused = !S.aiPaused; render(); } }) : null,
        ai.simulated ? el('button', { type: 'button', class: 'btn small', text: '↶ Annulla turno IA', disabled: !aiHistory.canUndo(), onclick: () => restoreCombat(aiHistory.undo(), 'Turno IA annullato.') }) : null,
        ai.simulated ? el('button', { type: 'button', class: 'btn small', text: '↷ Ripeti', disabled: !aiHistory.canRedo(), onclick: () => restoreCombat(aiHistory.redo(), 'Turno IA ripetuto.') }) : null);
      if (!ai.simulated) return el('section', { class: 'panel ai-panel' }, head);
      const plan = currentAiPlan();
      const cur = c.currentId ? byId(c.currentId) : null;
      let body;
      if (plan) {
        body = el('div', { class: 'ai-plan' },
          el('p', { class: 'ai-reason', text: (ai.mode === 'manuale' ? '💡 Suggerimento: ' : '🤖 ') + plan.reason }),
          plan.reminders.length ? el('ul', { class: 'muted small' }, plan.reminders.map((r) => el('li', { text: r }))) : null,
          el('div', { class: 'head-actions' },
            ai.mode !== 'manuale' ? el('button', { type: 'button', class: 'btn small primary', text: '▶ Esegui', disabled: S.aiBusy, onclick: () => executePlan(plan, ai.mode === 'auto') }) : null,
            el('button', { type: 'button', class: 'btn small', text: '🎯 Cambia bersaglio', onclick: () => {
              if (!S.grid) return;
              S.grid.pickTarget((id) => { if (id && byId(id) && id !== plan.combatantId) { currentAiPlan({ targetId: id }); render(); } });
            } }),
            ai.mode !== 'manuale' ? el('button', { type: 'button', class: 'btn small', text: 'Salta turno', onclick: skipTurn }) : null,
            el('button', { type: 'button', class: 'btn small', text: '↻ Ricalcola', onclick: () => { currentAiPlan({}); render(); } }),
            el('button', { type: 'button', class: 'btn small', text: 'Perché?', onclick: () => DnD.uiIa.whyDialog(IA.whyText(plan)) })));
      } else {
        body = el('p', { class: 'muted small', text: cur ? (cur.control === 'ia' ? cur.name + ' è a terra.' : 'Turno di ' + cur.name + ' (manuale): gioca tu.') : 'Nessun turno attivo.' });
      }
      return el('section', { class: 'panel ai-panel' }, head, body);
    }

    return { aiOn, aiPanel, aiState, currentAiPlan, executePlan, restoreCombat, scheduleAuto };
  }

  DnD.uiCombattimentoIA = { ia };
})(globalThis.DnD = globalThis.DnD || {});
