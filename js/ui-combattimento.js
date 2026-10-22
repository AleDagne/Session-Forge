// Sezione Combattimento: setup, iniziativa e gestione dei turni. Il combattimento appartiene alla
// sessione corrente (sessione.combat). Nemici Standard e Creature (con azioni a pulsanti, multiattacco,
// ricarica, usi giornalieri, Resistenza leggendaria, azioni leggendarie e promemoria delle azioni di tana);
// i danni tengono conto di vulnerabilità, resistenze e immunità di ogni combattente.
// Combattimento simulato: i combattenti controllati dall'IA pianificano il turno con DnD.ia (funzioni pure)
// e il piano si esegue con le stesse funzioni dei comandi manuali (attacco, incantesimi, azioni delle creature).
// Boss: dopo ogni azione si controllano le soglie di fase (boss.js) e si mostrano barra in alto, ombra ed effetti.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast, openDialog, promptText } = DnD.ui;
  const R = DnD.regole;
  const M = DnD.creature;
  const G = DnD.griglia;
  const MAX_COPIES = 50;

  let root = null;
  const setup = { players: new Set(), npcs: {}, gridId: '', control: {}, faction: {}, simulated: false }; // selezione del setup (non persistita)
  let selectedId = null; // combattente selezionato (scheda e pedina)
  let grid = null;       // widget della griglia: creato una volta, così vista e annulla/ripeti sopravvivono ai render

  const session = (st) => DnD.sessioni.current(st || DnD.store.state);
  const combat = () => session().combat;
  const order = () => R.sortByInitiative(combat().combatants);
  const byId = (id) => combat().combatants.find((c) => c.id === id);

  // ---------- Movimento (movimento.js) ----------
  // Regole dalle impostazioni (diagonali, modalità senza velocità), piedi per cella della griglia del combattimento.
  // I limiti valgono nel combattimento attivo, salvo «Movimento libero» (master) e «Ignora velocità» (combattente).
  const Mv = DnD.movimento;
  const rules = () => DnD.impostazioni.movementRules();
  const fpc = () => (combat() && combat().grid.feetPerCell) || 5;
  const limited = (x) => { const c = combat(); return Boolean(c && c.phase === 'attivo' && !c.freeMovement && !x.ignoreSpeed); };
  const cellsText = (n) => n + (n === 1 ? ' casella' : ' caselle');
  const condsOf = (x) => x.conditions || []; // i combattenti appena creati non hanno ancora il campo
  // Velocità e residuo: «🚶 30 ft (6 caselle) · restano 4 (prono: striscia…)».
  function speedText(x, short) {
    const st = Mv.speedState(x, rules(), fpc());
    const head = Mv.MODE_ICONS[st.mode] + ' ' + (short ? '' : Mv.MODE_NAMES[st.mode] + ' ') + st.feet + ' ft (' + cellsText(st.cells) + ')';
    const rest = !limited(x) ? ' · movimento libero' : ' · restano ' + Mv.left(x, rules(), fpc()) + '/' + Mv.budget(x, rules(), fpc());
    return head + rest + (st.reasons.length ? ' — ' + st.reasons.join('; ') : '');
  }
  // Anteprima del trascinamento: percorso minimo e celle raggiungibili (1× e con lo Scatto).
  function movementBegin(id) {
    const x = byId(id);
    if (!x || !x.pos || !limited(x)) return null;
    const st = aiState();
    const P = IA.paths(IA.buildMap(st), st, x);
    const left = Mv.left(x, rules(), fpc());
    const full = Mv.speedCells(x, rules(), fpc());
    const sets = Mv.reachable(P, left, left + full);
    return {
      normal: sets.normal, dash: sets.dash,
      route: (target) => {
        const r = Mv.routeTo(P, target, left);
        r.label = !r.end ? 'non raggiungibile' : r.stopped
          ? 'oltre il residuo (' + (r.full === null ? '?' : r.full) + ' > ' + left + '): si ferma dopo ' + r.cost
          : 'costo ' + r.cost + ' · restano ' + (left - r.cost);
        return r;
      },
    };
  }
  // Applica lo spostamento trascinato (dentro l'annulla/ripeti della griglia).
  function movementApply(c, id, r) {
    const t = c.combatants.find((y) => y.id === id);
    if (!t) return;
    Mv.recordMove(t, r.end, r.cost);
    log(c, 'movimento', Mv.moveText(t, r.path.length - 1, r.cost, Mv.left(t, rules(), fpc()), fpc()) + (r.stopped ? ' Movimento esaurito.' : ''));
  }
  // Azioni di movimento: Scatto, Disimpegno, Rialzarsi, Annulla spostamento.
  function moveAction(id, kind) {
    const x = byId(id);
    if (!x) return;
    if (kind === 'rialzati') {
      const probe = clone(x);
      const r = Mv.standUp(probe, rules(), fpc());
      if (!r.ok) { toast('Non può rialzarsi: ' + r.reason + '.', 'error'); return; }
    }
    if (kind === 'annulla' && !Mv.movementOf(x).moves.length) { toast(x.name + ' non si è ancora spostato in questo turno.'); return; }
    mutate((c) => {
      const t = c.combatants.find((y) => y.id === id);
      if (kind === 'scatto') { Mv.dash(t); log(c, 'movimento', t.name + ' usa Scatto (azione): +' + cellsText(Mv.speedCells(t, rules(), fpc())) + ', restano ' + cellsText(Mv.left(t, rules(), fpc())) + '.'); }
      else if (kind === 'disimpegno') { Mv.disengage(t); log(c, 'movimento', t.name + ' usa Disimpegno (azione): il suo movimento non provoca attacchi di opportunità in questo turno.'); }
      else if (kind === 'rialzati') { const r = Mv.standUp(t, rules(), fpc()); log(c, 'movimento', t.name + ' si rialza (costa ' + cellsText(r.cost) + '), restano ' + cellsText(Mv.left(t, rules(), fpc())) + '.'); }
      else if (kind === 'annulla') { const r = Mv.undoMoves(t); log(c, 'movimento', t.name + ' annulla lo spostamento: torna in ' + G.cellLabel(r.to.x, r.to.y) + ', restituite ' + cellsText(r.refunded) + '.'); }
    });
  }
  function setMode(id, mode) {
    mutate((c) => {
      const t = c.combatants.find((y) => y.id === id);
      t.moveMode = mode;
      aiPlan = null;
      log(c, 'movimento', t.name + ': modalità di movimento ' + Mv.MODE_NAMES[mode].toLowerCase() + ' (' + Mv.feetIn(t, mode) + ' ft).');
    });
  }
  function toggleCondition(id, cond) {
    mutate((c) => {
      const t = c.combatants.find((y) => y.id === id);
      const on = !condsOf(t).includes(cond);
      t.conditions = on ? condsOf(t).concat(cond) : condsOf(t).filter((x) => x !== cond);
      aiPlan = null;
      log(c, 'sistema', t.name + (on ? ' è ' + cond : ' non è più ' + cond) + '.');
    });
  }
  // Condizioni (anche «rallentato»): quelle che cambiano la velocità sono indicate.
  function conditionsDialog(x) {
    const speedy = new Set(Mv.STOP.concat('prono', 'rallentato'));
    const body = el('div', { class: 'check-row' }, Mv.conditions().map((k) => el('label', { class: 'check small' },
      el('input', { type: 'checkbox', checked: condsOf(x).includes(k), onchange: () => toggleCondition(x.id, k) }), ' ' + k + (speedy.has(k) ? ' 🦶' : ''))));
    openDialog('Condizioni di ' + x.name, el('div', { class: 'form' }, body,
      el('p', { class: 'muted small', text: '🦶 = cambia la velocità: afferrato, trattenuto, paralizzato, pietrificato e privo di sensi = 0; prono = striscia (costo doppio; Rialzarsi costa metà velocità); rallentato = metà velocità.' })), [{ text: 'Chiudi' }]);
  }
  // Riquadro del movimento nella scheda: velocità e residuo con il motivo, condizioni, azioni.
  function movementBox(x) {
    const m = Mv.movementOf(x);
    const prone = condsOf(x).includes('prono');
    return el('div', { class: 'move-box' + (limited(x) && !Mv.left(x, rules(), fpc()) ? ' empty' : '') },
      el('span', { class: 'small', text: speedText(x) }),
      condsOf(x).length ? el('div', { class: 'cond-chips' }, condsOf(x).map((k) => el('span', { class: 'tag cond-tag', text: k }))) : null,
      el('div', { class: 'head-actions' },
        el('button', { type: 'button', class: 'btn small', text: '🏃 Scatto', title: 'Aggiunge la velocità al residuo (usa l\'azione)', disabled: R.isDown(x), onclick: () => moveAction(x.id, 'scatto') }),
        el('button', { type: 'button', class: 'btn small', text: '↩ Disimpegno', title: 'Promemoria: niente attacchi di opportunità (usa l\'azione)', disabled: R.isDown(x) || m.disengaged, onclick: () => moveAction(x.id, 'disimpegno') }),
        prone ? el('button', { type: 'button', class: 'btn small', text: '⤒ Rialzati', title: 'Costa metà della velocità', onclick: () => moveAction(x.id, 'rialzati') }) : null,
        m.moves.length ? el('button', { type: 'button', class: 'btn small', text: '↶ Annulla spostamento', title: 'Torna alla posizione d\'inizio turno e restituisce il movimento', onclick: () => moveAction(x.id, 'annulla') }) : null,
        el('button', { type: 'button', class: 'btn small', text: 'Condizioni…', onclick: () => conditionsDialog(byId(x.id)) })));
  }
  // Interruttore del master: nessun limite di velocità.
  const freeBox = el('input', { type: 'checkbox', onchange: (e) => mutate((c) => { c.freeMovement = e.target.checked; log(c, 'sistema', 'Movimento libero ' + (c.freeMovement ? 'attivo: nessun limite di velocità.' : 'disattivato.')); }) });

  // ---------- Combattimento simulato (IA) ----------
  const IA = DnD.ia;
  const KI = DnD.iaDati;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let aiPlan = null;          // { forId, round, plan } del turno in corso
  let aiPaused = false;       // modalità automatica in pausa
  let aiBusy = false;         // esecuzione in corso (animazione)
  let aiTimer = null;
  const aiHistory = IA.turnHistory(); // annulla/ripeti: un intero turno IA = una sola azione
  const aiOn = () => Boolean(combat() && combat().ai && combat().ai.simulated);
  function aiState() {
    const st = DnD.store.state;
    const c = combat();
    return { combatants: c.combatants, grid: c.grid, catalog: st.equipment, tilesets: DnD.tilemap.tilesetIndex(st.tilesets), round: c.round, seed: c.ai.seed, rules: rules() };
  }
  // Impronta di ciò che cambia il piano: posizioni, PF, ingombri, controllo, fazioni e oggetti della griglia.
  const aiSignature = (c) => JSON.stringify([c.round, c.currentId, c.freeMovement, c.combatants.map((x) => [x.id, x.pos, x.hp, x.w, x.h, x.control, x.faction, x.hidden, x.movement, x.conditions, x.moveMode]),
    c.grid.items.map((it) => [it.id, it.x, it.y, it.state]), c.grid.structures.length, c.grid.ignoreCollisions]);
  // Piano del combattente di turno, se è controllato dall'IA: si ricalcola quando cambia il turno o la griglia,
  // o su richiesta (Ricalcola, Cambia bersaglio: il bersaglio scelto resta finché non si ricalcola).
  function currentAiPlan(force) {
    const c = combat();
    if (!c || !aiOn() || c.phase !== 'attivo') return null;
    const cur = c.currentId ? byId(c.currentId) : null;
    if (!cur || cur.control !== 'ia' || R.isDown(cur)) return null;
    const sig = aiSignature(c);
    const target = force ? force.targetId || null : aiPlan && aiPlan.forId === cur.id && aiPlan.round === c.round ? aiPlan.targetId : null;
    if (force || !aiPlan || aiPlan.sig !== sig) {
      aiPlan = { forId: cur.id, round: c.round, sig, targetId: target, plan: IA.pianificaTurno(aiState(), cur, target ? { forceTargetId: target } : {}) };
    }
    return aiPlan.plan;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Animazione dello spostamento: la pedina avanza cella per cella (solo in memoria, poi si salva una volta).
  async function animateMove(id, path, ms) {
    for (const p of path.slice(1)) {
      const x = byId(id);
      if (!x) return;
      x.pos = { x: p.x, y: p.y };
      if (grid) grid.requestDraw();
      await sleep(ms);
    }
  }
  // Esegue il piano: spostamento, riga di log con la motivazione (e i punteggi per "Perché?"), poi l'azione
  // con le funzioni esistenti; infine passa al turno successivo. Tutto il turno si annulla in un colpo.
  async function executePlan(plan, animate) {
    if (aiBusy || !plan || !combat()) return;
    const x = byId(plan.combatantId);
    if (!x) return;
    aiBusy = true;
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
      aiBusy = false;
    }
    aiPlan = null;
    nextTurn();
    aiHistory.push(before, clone(combat()));
    render();
  }
  function restoreCombat(state, text) {
    if (!state) return;
    aiPaused = true;
    clearTimeout(aiTimer);
    DnD.store.update((st) => { session(st).combat = clone(state); });
    aiPlan = null;
    render();
    toast(text);
  }
  function skipTurn() {
    const before = clone(combat());
    const cur = byId(combat().currentId);
    mutate((c) => log(c, 'ia', '🤖 ' + cur.name + ' salta il turno (scelta del master).'));
    aiPlan = null;
    nextTurn();
    aiHistory.push(before, clone(combat()));
  }
  // Modalità automatica: il turno IA parte da solo dopo il ritardo; si ferma al turno di un combattente
  // manuale, con la Pausa, o quando non ci sono più avversari.
  function scheduleAuto() {
    clearTimeout(aiTimer);
    aiTimer = null;
    const c = combat();
    if (!c || c.phase !== 'attivo' || !aiOn() || c.ai.mode !== 'auto' || aiPaused || aiBusy) return;
    const plan = currentAiPlan();
    if (!plan) return;
    if (plan.action.kind === 'nessuna' && /nessun avversario/.test(plan.reason)) {
      aiPaused = true;
      toast('Combattimento simulato in pausa: nessun avversario rimasto.');
      render();
      return;
    }
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (root && root.isConnected && !aiPaused && combat() && combat().ai.mode === 'auto') executePlan(currentAiPlan(), true);
    }, c.ai.delay * 1000);
  }

  // Pannello del combattimento simulato: interruttore, modalità, ritardo, pausa, annulla/ripeti e piano del turno.
  function aiPanel() {
    const c = combat();
    const ai = c.ai;
    const setAi = (patch) => { mutate((cc) => Object.assign(cc.ai, patch)); };
    const head = el('div', { class: 'ai-controls' },
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ai.simulated, onchange: (e) => { aiPaused = false; aiPlan = null; setAi({ simulated: e.target.checked }); } }), ' Combattimento simulato'),
      ai.simulated ? el('select', { 'aria-label': 'Modalità', onchange: (e) => { aiPaused = false; setAi({ mode: e.target.value }); } },
        KI.MODES.map((m) => el('option', { value: m, text: KI.MODE_NAMES[m], selected: m === ai.mode }))) : null,
      ai.simulated && ai.mode === 'auto' ? el('label', { class: 'inline small' }, 'Ritardo',
        el('input', { type: 'range', min: 0, max: 3, step: 0.5, value: String(ai.delay), 'aria-label': 'Ritardo (secondi)',
          onchange: (e) => setAi({ delay: Number(e.target.value) }) }), ai.delay + ' s') : null,
      ai.simulated && ai.mode === 'auto' ? el('button', { type: 'button', class: 'btn small', text: aiPaused ? '▶ Riprendi' : '⏸ Pausa',
        onclick: () => { aiPaused = !aiPaused; render(); } }) : null,
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
          ai.mode !== 'manuale' ? el('button', { type: 'button', class: 'btn small primary', text: '▶ Esegui', disabled: aiBusy, onclick: () => executePlan(plan, ai.mode === 'auto') }) : null,
          el('button', { type: 'button', class: 'btn small', text: '🎯 Cambia bersaglio', onclick: () => {
            if (!grid) return;
            grid.pickTarget((id) => { if (id && byId(id) && id !== plan.combatantId) { currentAiPlan({ targetId: id }); render(); } });
          } }),
          ai.mode !== 'manuale' ? el('button', { type: 'button', class: 'btn small', text: 'Salta turno', onclick: skipTurn }) : null,
          el('button', { type: 'button', class: 'btn small', text: '↻ Ricalcola', onclick: () => { currentAiPlan({}); render(); } }),
          el('button', { type: 'button', class: 'btn small', text: 'Perché?', onclick: () => DnD.uiIa.whyDialog(IA.whyText(plan)) })));
    } else {
      body = el('p', { class: 'muted small', text: cur ? (cur.control === 'ia' ? cur.name + ' è a terra.' : 'Turno di ' + cur.name + ' (manuale): gioca tu.') : 'Nessun turno attivo.' });
    }
    return el('section', { class: 'panel ai-panel' }, head, body);
  }

  // Il combattimento lavora su una copia della griglia scelta: questi pulsanti la salvano a parte
  // o, su richiesta, aggiornano la griglia originale.
  const originalGrid = () => {
    const id = combat() && combat().grid.sourceGridId;
    return id ? DnD.store.state.savedGrids.find((g) => g.id === id) || null : null;
  };
  const updateOriginalBtn = el('button', {
    type: 'button', class: 'btn small', text: '⟳ Aggiorna la griglia originale', title: 'Aggiorna la griglia originale',
    onclick: () => {
      const g = originalGrid();
      if (!g || !confirm('Sovrascrivere la griglia "' + g.name + '" con strutture, oggetti e posizioni di questo combattimento?')) return;
      const saved = Object.assign(DnD.griglia.createSavedGrid(combat(), g.name, g.id, new Date().toISOString()),
        { sessionId: g.sessionId, shared: g.shared });
      DnD.store.update((st) => { st.savedGrids[st.savedGrids.indexOf(g)] = saved; });
      toast('Griglia "' + g.name + '" aggiornata.', 'success');
    },
  });

  function saveAsNewGrid() {
    promptText('Salva come nuova griglia', 'Nome della griglia', '', (name) => {
      if (DnD.uiGriglia.nameTaken(name)) return 'Esiste già una griglia con questo nome.';
      const saved = Object.assign(DnD.griglia.createSavedGrid(combat(), name, DnD.dadi.uid(), new Date().toISOString()),
        { sessionId: session().id, shared: false });
      DnD.store.update((st) => { st.savedGrids.push(saved); });
      toast('Griglia "' + name + '" salvata.', 'success');
      return null;
    });
  }

  function loadGrid(saved) {
    if (!confirm('Caricare "' + saved.name + '"? Strutture, oggetti e posizioni attuali verranno sostituiti.')) return false;
    let unplaced = [];
    mutate((c) => { unplaced = DnD.griglia.applySavedGrid(c, saved, DnD.dadi.uid); });
    if (unplaced.length) toast('Non entrano nelle zone di partenza: ' + unplaced.map((x) => x.name).join(', ') + '.', 'error');
    const missing = combat().combatants.filter((x) => !x.pos).length;
    toast('Griglia caricata.' + (missing ? ' ' + missing + ' combattenti senza posizione: trascinali dal pannello.' : ''), 'success');
    return true;
  }

  function getGrid() {
    if (!grid) {
      grid = DnD.uiGriglia.create({
        getDoc: combat,
        update: (fn) => DnD.store.update(() => fn(combat())),
        tools: ['seleziona', 'misura'],
        showCombatants: true,
        onSelect: (id) => selectCombatant(id, 'grid'),
        tokenActions,
        movement: { begin: movementBegin, apply: movementApply },
        turnInfo: (x) => speedText(x, true),
        // Residuo sopra la pedina di turno; anteprima del piano dell'IA: percorso tratteggiato e bersagli evidenziati.
        overlay: (ctx, view, s) => {
          const c = combat();
          const cur = c && c.currentId ? byId(c.currentId) : null;
          if (cur && cur.pos && limited(cur)) DnD.uiIa.drawBadge(ctx, view, s, cur, '🦶 ' + Mv.left(cur, rules(), fpc()));
          if (!c || !aiOn() || !aiPlan || aiPlan.forId !== c.currentId) return;
          const col = DnD.uiTileset.colors();
          DnD.uiIa.drawPlan(ctx, view, s, aiPlan.plan, c.combatants, { current: col.accent, bad: '#d4453a' });
        },
        onObject: (id) => DnD.uiOggettiMappa.openPanel({
          getItem: () => combat() && combat().grid.items.find((x) => x.id === id),
          update: (fn) => { DnD.store.update((st) => fn(session(st).combat.grid.items.find((x) => x.id === id), st)); render(); },
          log: (text) => { DnD.store.update(() => log(combat(), 'sistema', text)); render(); },
          combatants: () => order(),
          applyDamage: (targetId, amount, type, text) => {
            mutate((c) => {
              const t = byId(targetId);
              if (!t) return;
              const r = M.applyDefenses(amount, M.damageTypeOf(type), t.defenses, true);
              const before = t.hp;
              hurt(t, r.amount);
              log(c, 'colpito', text + (r.note ? ' (' + r.note + ')' : '') + ' ' + t.name + ': ' + before + ' → ' + t.hp + ' PF.');
              if (before > 0 && t.hp === 0) log(c, 'a-terra', t.name + ' è a terra!');
            });
          },
        }),
        toolbar: [
          el('button', { type: 'button', class: 'btn small', text: '💾 Salva come nuova griglia', onclick: saveAsNewGrid }),
          updateOriginalBtn,
          el('button', { type: 'button', class: 'btn small', text: 'Carica griglia…', onclick: () => DnD.uiGriglia.savedGridsDialog(loadGrid) }),
          el('label', { class: 'check small', title: 'Nessun limite di velocità (eventi, teletrasporti)' }, freeBox, ' Movimento libero'),
        ],
      });
    }
    updateOriginalBtn.hidden = !originalGrid();
    freeBox.checked = Boolean(combat() && combat().freeMovement);
    return grid;
  }

  // Seleziona un combattente evidenziando scheda e pedina. source: 'card' | 'grid' | 'list'.
  function selectCombatant(id, source) {
    selectedId = id;
    for (const card of root.querySelectorAll('.combatant')) card.classList.toggle('selected', card.dataset.id === id);
    if (source !== 'grid' && grid) grid.setSelectedCombatant(id);
    if (source !== 'card' && id) {
      const card = root.querySelector('.combatant[data-id="' + id + '"]');
      if (card) card.scrollIntoView({ behavior: DnD.ui.scrollBehavior(), block: 'nearest' });
    }
  }

  function tokenActions(id) {
    const x = byId(id);
    if (!x) return [];
    return [
      x.creature ? { text: '🐉 Azioni della creatura…', disabled: R.isDown(x), onclick: () => selectCombatant(id, 'list') } : null,
      { text: '⚔ Attacca', disabled: R.isDown(x) || !x.weapons.length || combat().combatants.length < 2, onclick: () => attackDialog(byId(id)) },
      { text: '✚ Cura', onclick: () => healDialog(byId(id)) },
      { text: '🛡 Tiro salvezza', onclick: () => saveDialog(byId(id)) },
      x.spellcasting ? { text: '✨ Lancia incantesimo', disabled: R.isDown(x) || !x.spellcasting.spells.length, onclick: () => castDialog(byId(id)) } : null,
      { text: '✎ Modifica', onclick: () => editDialog(byId(id)) },
      { text: '↔ Dimensione sulla griglia…', onclick: () => resizeDialog(byId(id)) },
      ...Mv.MODES.filter((mode) => mode !== Mv.modeOf(x)).map((mode) => {
        const ft = Mv.feetIn(x, mode);
        const banned = ft <= 0 && mode !== 'cammina' && rules().missingMode === 'vietato';
        return { text: Mv.MODE_ICONS[mode] + ' Modalità: ' + Mv.MODE_NAMES[mode].toLowerCase() + (ft > 0 ? ' (' + ft + ' ft)' : mode === 'cammina' ? '' : banned ? ' (nessuna velocità)' : ' (costo doppio)'),
          disabled: banned, onclick: () => setMode(id, mode) };
      }),
      { text: '🏃 Scatto', disabled: R.isDown(x), onclick: () => moveAction(id, 'scatto') },
      condsOf(x).includes('prono') ? { text: '⤒ Rialzati (metà velocità)', onclick: () => moveAction(id, 'rialzati') } : null,
      Mv.movementOf(x).moves.length ? { text: '↶ Annulla spostamento', onclick: () => moveAction(id, 'annulla') } : null,
      { text: '⚕ Condizioni…', onclick: () => conditionsDialog(byId(id)) },
      { text: x.ignoreSpeed ? '🦶 Rispetta la velocità' : '🦶 Ignora velocità', onclick: () => mutate((c) => {
        const t = c.combatants.find((y) => y.id === id);
        t.ignoreSpeed = !t.ignoreSpeed;
        log(c, 'sistema', t.name + ': ' + (t.ignoreSpeed ? 'ignora la velocità (movimento libero).' : 'rispetta di nuovo la velocità.'));
      }) },
      { text: x.control === 'ia' ? '👤 Controllo: passa a Manuale' : '🤖 Controllo: passa all\'IA', onclick: () => mutate((c) => {
        const t = c.combatants.find((y) => y.id === id);
        t.control = t.control === 'ia' ? 'manuale' : 'ia';
        aiPlan = null;
        log(c, 'sistema', t.name + ': controllo ' + (t.control === 'ia' ? 'IA' : 'manuale') + '.');
      }) },
      { text: '⚑ Fazione: ' + KI.FACTION_NAMES[x.faction] + ' → ' + KI.FACTION_NAMES[KI.FACTIONS[(KI.FACTIONS.indexOf(x.faction) + 1) % KI.FACTIONS.length]], onclick: () => mutate((c) => {
        const t = c.combatants.find((y) => y.id === id);
        t.faction = KI.FACTIONS[(KI.FACTIONS.indexOf(t.faction) + 1) % KI.FACTIONS.length];
        aiPlan = null;
        log(c, 'sistema', t.name + ': fazione ' + KI.FACTION_NAMES[t.faction] + '.');
      }) },
      { text: x.hidden ? '👁 Non più nascosto' : '🙈 Nascosto (l\'IA non lo vede)', onclick: () => mutate((c) => { const t = c.combatants.find((y) => y.id === id); t.hidden = !t.hidden; aiPlan = null; }) },
    ].filter(Boolean);
  }

  // Dimensione di una singola pedina (non cambia il modello originale). Se la pedina non entra nella sua
  // posizione con il nuovo ingombro, compare un avviso e la dimensione non cambia.
  function resizeDialog(x) {
    const d = G.tokenDims(x);
    const w = numberInput(d.w, { min: 1, max: G.MAX_TOKEN, 'data-key': 'w' });
    const h = numberInput(d.h, { min: 1, max: G.MAX_TOKEN, 'data-key': 'h' });
    const presets = el('div', { class: 'head-actions' }, G.TOKEN_PRESETS.map((n) => el('button', { type: 'button', class: 'btn small', text: n + '×' + n, onclick: () => { w.value = h.value = String(n); } })));
    const body = el('div', { class: 'form' }, presets, el('div', { class: 'grid-2' }, field('Larghezza (celle)', w, 'w'), field('Altezza (celle)', h, 'h')),
      el('p', { class: 'muted small', text: 'Vale solo per questa pedina in questo combattimento; il modello originale non cambia.' }));
    openDialog('Dimensione di ' + x.name, body, [
      { text: 'Annulla' },
      { text: 'Applica', class: 'primary', onclick: () => {
        const errors = {};
        DnD.validazione.intInRange(errors, 'w', readNumber(w), 1, G.MAX_TOKEN);
        DnD.validazione.intInRange(errors, 'h', readNumber(h), 1, G.MAX_TOKEN);
        if (!showErrors(body, errors)) return false;
        const nd = { w: readNumber(w), h: readNumber(h) };
        const t = byId(x.id);
        if (t.pos && !G.canPlaceToken(G.boardOf(combat().grid, combat().combatants), t.id, t.pos.x, t.pos.y, nd)) {
          toast(t.name + ' non entra in quella posizione con ' + nd.w + '×' + nd.h + ' celle: spostalo in uno spazio libero e riprova.', 'error');
          return false;
        }
        mutate((c) => {
          Object.assign(byId(x.id), nd);
          log(c, 'modifica', x.name + ': dimensione sulla griglia ' + d.w + '×' + d.h + ' → ' + nd.w + '×' + nd.h + '.');
        });
        return undefined;
      } },
    ]);
  }

  // Danno con le regole della trasformazione leggendaria: a 0 PF della forma si torna normali e il danno in
  // eccesso passa al personaggio (le righe finiscono nel log alla fine dell'azione).
  let hurtLines = [];
  function hurt(t, amount) {
    hurtLines = hurtLines.concat(DnD.leggendario.damage(t, amount));
  }

  function mutate(fn) {
    let events = [];
    DnD.store.update((st) => {
      fn(session(st).combat, st);
      if (hurtLines.length && session(st).combat) for (const line of hurtLines) log(session(st).combat, 'sistema', line);
      hurtLines = [];
      // Boss: passaggi di fase e sconfitte (anche più fasi con un solo colpo), con le note nel log.
      const c = session(st).combat;
      if (c && c.phase === 'attivo') events = DnD.boss.checkCombat(c, (type, text) => log(c, type, text));
    });
    if (events.some((e) => e.kind === 'fase')) aiPlan = null;
    render();
    DnD.uiBoss.playEvents(events, root && root.querySelector('.combat-layout'));
  }

  function log(c, type, text) {
    DnD.dati.pushLog(c, type, text);
  }

  function render(container) {
    root = container || root;
    clear(root);
    if (!combat()) renderSetup();
    else if (combat().phase === 'iniziativa') renderInitiative();
    else renderActive();
  }

  // ---------- Setup ----------
  // Genera nemici al volo: vengono salvati in Nemici e aggiunti al setup (uno per ciascuno).
  function generateAndAdd() {
    DnD.uiGeneratore.open({
      saveLabel: 'Salva e aggiungi al combattimento',
      onSaved: (creatures) => {
        for (const c of creatures) setup.npcs[c.id] = 1;
        render();
      },
    });
  }

  function renderSetup() {
    const st = DnD.store.state;
    const vPlayers = DnD.sessioni.visible(st, 'players');
    const vNpcs = DnD.sessioni.visible(st, 'npcs');
    const vGrids = DnD.sessioni.visible(st, 'savedGrids');
    if (!vPlayers.length && !vNpcs.length) {
      root.append(DnD.ui.emptyState('Nessun personaggio in questa sessione',
        'Per iniziare un combattimento servono nemici o giocatori della sessione «' + session().name + '» (o condivisi con tutte le sessioni).', [
          { text: '🎲 Genera e aggiungi', primary: true, onclick: generateAndAdd },
          { text: '+ Aggiungi nemici', onclick: () => DnD.app.navigate('nemici', 'nuovo') },
          { text: '+ Aggiungi giocatori', onclick: () => DnD.app.navigate('giocatori', 'nuovo') },
          { text: 'Crea una griglia', onclick: () => DnD.app.navigate('editor', 'nuovo') },
        ]));
      return;
    }
    const playerSummary = (c) => { // i leggendari con gli effetti dei nodi già applicati
      const e = DnD.leggendario.effectivePlayer(c, st);
      return [DnD.classi.className(c.classId), 'PF ' + e.maxHp, 'CA ' + R.derivedStats(e, st.races.find((r) => r.id === c.raceId), st.equipment).ac.total];
    };
    const summary = (c) => (DnD.boss.isMonster(c)
      ? [c.type === 'boss' ? 'Boss' : 'Creatura', 'GS ' + c.cr, 'PF ' + M.hpInfo(c).total, 'CA ' + c.ac]
      : playerSummary(c));
    const qtyInputs = {};
    const errorBox = el('div', { class: 'error', 'aria-live': 'polite' });
    // Controllo (Manuale o IA) e fazione per riga: di base giocatori Manuale, nemici IA.
    function controlPickers(id, kind) {
      const control = setup.control[id] || IA.defaultControl(kind);
      const faction = setup.faction[id] || IA.defaultFaction(kind);
      return el('span', { class: 'control-pickers' },
        el('select', { class: 'small-select', 'aria-label': 'Controllo', onchange: (e) => { setup.control[id] = e.target.value; } },
          el('option', { value: 'manuale', text: '👤 Manuale', selected: control === 'manuale' }), el('option', { value: 'ia', text: '🤖 IA', selected: control === 'ia' })),
        el('select', { class: 'small-select', 'aria-label': 'Fazione', onchange: (e) => { setup.faction[id] = e.target.value; } },
          KI.FACTIONS.map((f) => el('option', { value: f, text: KI.FACTION_NAMES[f], selected: f === faction }))));
    }

    const playersBox = vPlayers.length
      ? el('ul', { class: 'pick-list' }, vPlayers.map((p) => el('li', {},
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: setup.players.has(p.id), onchange: (e) => { if (e.target.checked) setup.players.add(p.id); else setup.players.delete(p.id); } }),
          ' ', el('b', { text: p.name }),
          el('span', { class: 'muted small', text: ' · ' + [p.playerName].concat(summary(p)).filter(Boolean).join(' · ') })), ' ', controlPickers(p.id, 'player'))))
      : el('p', { class: 'empty', text: 'Nessun giocatore. Creali nella sezione Giocatori.' });

    const npcsBox = vNpcs.length
      ? el('ul', { class: 'pick-list' }, vNpcs.map((n) => {
        qtyInputs[n.id] = numberInput(setup.npcs[n.id] || 0, {
          min: 0, max: MAX_COPIES, class: 'qty', 'aria-label': 'Quantità di ' + n.name,
          oninput: (e) => { setup.npcs[n.id] = readNumber(e.target); },
        });
        return el('li', {}, qtyInputs[n.id], ' ', el('b', { text: n.name }), ' ',
          el('span', { class: 'tag' + (n.type === 'boss' ? ' boss-tag' : n.type === 'creatura' ? ' accent' : ''), text: n.type === 'boss' ? '👑 Boss' : n.type === 'creatura' ? 'Creatura' : 'Standard' }),
          el('span', { class: 'muted small', text: ' · ' + summary(n).filter(Boolean).join(' · ') }), ' ', controlPickers(n.id, 'npc'));
      }))
      : el('p', { class: 'empty', text: 'Nessun nemico. Creali nella sezione Nemici.' });

    function start() {
      const players = vPlayers.filter((p) => setup.players.has(p.id));
      const entries = [];
      for (const n of vNpcs) {
        const q = readNumber(qtyInputs[n.id]);
        if (!Number.isInteger(q) || q < 0 || q > MAX_COPIES) {
          qtyInputs[n.id].classList.add('invalid');
          errorBox.textContent = 'La quantità di "' + n.name + '" deve essere un intero tra 0 e ' + MAX_COPIES + '.';
          qtyInputs[n.id].focus();
          return;
        }
        if (q > 0) entries.push({ npc: n, quantity: q });
      }
      if (!players.length && !entries.length) {
        errorBox.textContent = 'Seleziona almeno un giocatore o un nemico.';
        return;
      }
      const combatants = R.createCombatants(players, entries, st.races, DnD.dadi.randomInt, st.spells, st.equipment);
      for (const x of combatants) {
        if (setup.control[x.sourceId]) x.control = setup.control[x.sourceId];
        if (setup.faction[x.sourceId]) x.faction = setup.faction[x.sourceId];
      }
      const startGrid = vGrids.find((g) => g.id === gridSelect.value);
      let unplaced = [];
      DnD.store.update((s) => {
        session(s).combat = {
          id: DnD.dadi.uid(), phase: 'iniziativa', round: 1, currentId: null, combatants, log: [],
          ai: { simulated: setup.simulated, mode: 'passo', delay: 1, seed: DnD.dadi.randomInt(2147483646) },
          grid: Object.assign({ structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false, sourceGridId: null }, G.gridProps({})),
        };
        if (startGrid) unplaced = DnD.griglia.applySavedGrid(session(s).combat, startGrid, DnD.dadi.uid);
      });
      if (unplaced.length) toast('Non entrano nelle zone di partenza: ' + unplaced.map((x) => x.name).join(', ') + '. Trascinali dal pannello.', 'error');
      setup.players.clear();
      setup.npcs = {};
      setup.gridId = '';
      aiHistory.clear();
      aiPlan = null;
      aiPaused = false;
      render();
    }

    const gridSelect = el('select', { onchange: (e) => { setup.gridId = e.target.value; } },
      el('option', { value: '', text: 'Griglia vuota' }),
      vGrids.map((g) => el('option', { value: g.id, text: g.name, selected: g.id === setup.gridId })));
    const gridPanel = el('section', { class: 'panel' },
      el('h2', { text: 'Griglia di partenza' }),
      el('div', { class: 'grid-start' },
        field('Parti da', gridSelect),
        el('button', { type: 'button', class: 'btn', text: 'Griglie salvate…', onclick: () => DnD.uiGriglia.savedGridsDialog((g) => {
          setup.gridId = g.id;
          render();
          return true;
        }) })),
      el('p', { class: 'muted small', text: 'Dalla griglia salvata vengono ripresi strutture, oggetti e posizioni dei combattenti con lo stesso nome; gli altri restano da trascinare.' }));

    root.append(
      el('div', { class: 'section-head' }, el('h1', { text: 'Nuovo combattimento' })),
      el('div', { class: 'grid-2' },
        el('section', { class: 'panel' },
          el('div', { class: 'history-head' },
            el('h2', { text: 'Giocatori' }),
            vPlayers.length ? el('button', { class: 'btn small', text: 'Tutti', onclick: () => { vPlayers.forEach((p) => setup.players.add(p.id)); render(); } }) : null),
          playersBox),
        el('section', { class: 'panel' },
          el('div', { class: 'history-head' },
            el('h2', { text: 'Nemici e quantità' }),
            el('button', { class: 'btn small', text: '🎲 Genera e aggiungi', onclick: generateAndAdd })),
          npcsBox)),
      gridPanel,
      el('div', { class: 'form-actions' }, errorBox,
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: setup.simulated, onchange: (e) => { setup.simulated = e.target.checked; } }), ' Combattimento simulato (IA)'),
        el('button', { class: 'btn primary', text: 'Tira l\'iniziativa', onclick: start })));
  }

  // ---------- Iniziativa ----------
  function renderInitiative() {
    const inputs = {};
    const list = order();
    const rerollAll = () => mutate((c) => {
      for (const x of c.combatants) Object.assign(x, R.rollInitiative(x.dexMod, DnD.dadi.randomInt));
    });
    const begin = () => {
      const errors = {};
      for (const x of list) {
        const v = readNumber(inputs[x.id]);
        DnD.validazione.intInRange(errors, 'init.' + x.id, v, -20, 60);
      }
      if (!showErrors(root, errors)) return;
      mutate((c) => {
        for (const x of c.combatants) x.initiative = readNumber(inputs[x.id]);
        const sorted = R.sortByInitiative(c.combatants);
        c.phase = 'attivo';
        c.round = 1;
        c.currentId = R.firstTurn(sorted);
        for (const x of c.combatants) Mv.resetTurn(x);
        log(c, 'sistema', 'Inizia il combattimento. Ordine: ' + sorted.map((x) => x.name + ' (' + x.initiative + ')').join(', ') + '.');
        if (c.currentId) startTurnOf(c, sorted, null, c.currentId, true);
      });
    };
    const cancel = () => {
      if (confirm('Annullare il combattimento?')) mutate((c, st) => { session(st).combat = null; });
    };

    root.append(
      el('div', { class: 'section-head' }, el('h1', { text: 'Iniziativa' }),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn', text: 'Ritira tutti', onclick: rerollAll }),
          el('button', { class: 'btn danger', text: 'Annulla', onclick: cancel }))),
      (DnD.uiEsplorazione && DnD.uiEsplorazione.combatBanner()) || '',
      el('div', { class: 'panel' },
        el('p', { class: 'muted', text: 'd20 + modificatore di DES tirati automaticamente. Puoi correggere i valori a mano.' }),
        el('table', { class: 'init-table' },
          el('thead', {}, el('tr', {}, ['Combattente', 'Tiro', 'Iniziativa'].map((t) => el('th', { text: t })))),
          el('tbody', {}, list.map((x) => {
            inputs[x.id] = numberInput(x.initiative, { 'data-key': 'init.' + x.id, 'aria-label': 'Iniziativa di ' + x.name, onchange: (e) => {
              const v = readNumber(e.target);
              if (Number.isInteger(v) && v >= -20 && v <= 60) DnD.store.update(() => { byId(x.id).initiative = v; });
            } });
            return el('tr', { class: x.kind },
              el('td', {}, el('span', { class: 'kind-dot ' + x.kind }), ' ', x.name),
              el('td', { class: 'muted', text: 'd20 (' + x.initiativeRoll + ') ' + R.formatModifier(x.dexMod) }),
              el('td', {}, inputs[x.id], el('div', { class: 'error', 'data-error': 'init.' + x.id })));
          }))),
        el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', text: 'Inizia combattimento', onclick: begin }))));
  }

  // ---------- Combattimento attivo ----------
  // Inizio del turno di un combattente: promemoria delle azioni di tana (a iniziativa 20), poi per le creature
  // tiro di ricarica e ripristino dei punti azione leggendaria.
  function startTurnOf(c, sorted, prevId, nextId, newRound) {
    const lairs = sorted.filter((x) => x.creature && x.creature.lair.length && !R.isDown(x));
    if (lairs.length && M.crossesLair(sorted, prevId, nextId, newRound)) {
      for (const x of lairs) log(c, 'sistema', '🏰 Iniziativa 20 — azioni di tana di ' + x.name + ': ' + x.creature.lair.map((a) => a.name).join(', ') + ' (promemoria).');
      toast('Iniziativa 20: azioni di tana disponibili.');
    }
    const cur = byId(nextId);
    Mv.resetTurn(cur);
    log(c, 'turno', 'Turno di ' + cur.name + '.');
    // Trasformazione leggendaria: la durata scende all'inizio del turno.
    for (const line of DnD.leggendario.tick(cur)) log(c, 'sistema', line);
    if (cur.creature) for (const line of M.startTurn(cur.creature, DnD.dadi.randomInt)) log(c, 'sistema', line);
  }

  function nextTurn() {
    mutate((c) => {
      const sorted = R.sortByInitiative(c.combatants);
      const res = R.nextTurn(sorted, c.currentId, c.round);
      if (res.currentId === c.currentId && res.round === c.round) return;
      const newRound = res.round !== c.round;
      if (newRound) log(c, 'round', '— Round ' + res.round + ' —');
      const prev = c.currentId;
      c.round = res.round;
      c.currentId = res.currentId;
      startTurnOf(c, sorted, prev, c.currentId, newRound);
    });
  }

  function endCombat() {
    if (!confirm('Terminare il combattimento? Il log e lo stato dei combattenti verranno cancellati.')) return;
    const ended = JSON.parse(JSON.stringify(combat()));
    mutate((c, st) => { session(st).combat = null; });
    toast('Combattimento terminato.');
    // Combattimento preparato da un evento dell'esplorazione: esito e ritorno all'esplorazione.
    if (DnD.uiEsplorazione) DnD.uiEsplorazione.onCombatEnded(ended);
  }

  function rollText(rolls, flat) {
    return '[' + rolls.join(', ') + ']' + (flat ? ' ' + R.formatModifier(flat) : '');
  }

  // preset: { targetId, weaponId, mode } per riaprire la finestra dopo la scelta del bersaglio sulla griglia.
  function attackDialog(attacker, preset) {
    preset = preset || {};
    const targets = order().filter((x) => x.id !== attacker.id);
    const preferred = targets.find((t) => t.id === preset.targetId) ||
      targets.find((t) => t.kind !== attacker.kind && !R.isDown(t)) || targets[0];
    const target = el('select', {}, targets.map((t) => el('option', {
      value: t.id, selected: t === preferred,
      text: t.name + ' (CA ' + t.ac + ', PF ' + t.hp + '/' + t.maxHp + ')' + (R.isDown(t) ? ' – a terra' : ''),
    })));
    const weapon = el('select', {}, attacker.weapons.map((w) => el('option', { value: w.id, text: DnD.uiCreature.weaponLabel(w), selected: w.id === preset.weaponId })));
    const mode = (value, label) => el('label', { class: 'check' },
      el('input', { type: 'radio', name: 'modo', value, checked: value === (preset.mode || R.MODES.normale) }), ' ' + label);
    const currentMode = () => body.querySelector('input[name="modo"]:checked').value;
    const pickButton = grid && grid.hasTokens() && grid.node.isConnected
      ? el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
        const keep = { targetId: target.value, weaponId: weapon.value, mode: currentMode() };
        dialog.dismiss();
        grid.pickTarget((id) => {
          const a = byId(attacker.id);
          if (!a) return;
          attackDialog(a, Object.assign(keep, id && id !== attacker.id ? { targetId: id } : {}));
        });
      } })
      : null;
    const distance = el('p', { class: 'muted small', 'aria-live': 'polite' });
    const showDistance = () => {
      const t = byId(target.value);
      const dd = t ? G.tokenDistance(attacker, t) : null;
      distance.textContent = dd === null ? '' : 'Distanza (tra le celle più vicine): ' + G.formatDistance(dd, combat().grid.feetPerCell);
    };
    target.addEventListener('change', showDistance);
    showDistance();
    const body = el('div', { class: 'form' },
      el('div', { class: 'target-row' }, field('Bersaglio', target), pickButton),
      distance,
      field('Arma', weapon),
      el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro' }),
        mode(R.MODES.normale, 'Normale'), mode(R.MODES.vantaggio, 'Vantaggio'), mode(R.MODES.svantaggio, 'Svantaggio')));

    const dialog = openDialog(attacker.name + ' attacca', body, [
      { text: 'Annulla' },
      { text: 'Tira l\'attacco', class: 'primary', onclick: () => {
        performAttack(attacker.id, target.value, weapon.value, currentMode());
      } },
    ]);
  }

  function performAttack(attackerId, targetId, weaponId, mode) {
    let summary = '';
    let summaryType = 'info';
    mutate((c) => {
      const a = byId(attackerId);
      const t = byId(targetId);
      const w = a && a.weapons.find((x) => x.id === weaponId);
      if (!a || !t || !w) return;
      const res = R.resolveAttack({ toHit: w.toHit, targetAC: t.ac, damageDice: w.damageDice, damageBonus: w.damageBonus, mode }, DnD.dadi.randomInt);
      const d20 = mode === R.MODES.normale
        ? 'd20 = ' + res.natural
        : 'd20 con ' + mode + ' [' + res.d20Rolls.join(', ') + '] → ' + res.natural;
      let text = a.name + ' attacca ' + t.name + ' con ' + w.name + ': ' + d20 + ' ' + R.formatModifier(w.toHit) + ' = ' + res.total + ' contro CA ' + t.ac;
      if (res.fumble) {
        text += '. 1 NATURALE: fallimento automatico.';
        summary = a.name + ': fallimento automatico!';
        log(c, 'mancato', text);
        return;
      }
      if (!res.hit) {
        text += ' → mancato.';
        summary = a.name + ' manca ' + t.name + '.';
        log(c, 'mancato', text);
        return;
      }
      const before = t.hp;
      const def = M.applyDefenses(res.damage, M.damageTypeOf(w.damageType), t.defenses, w.magical);
      hurt(t, def.amount);
      const dmgExpr = res.damageDiceCount + 'd' + res.damageSides;
      text += res.crit ? '. 20 NATURALE, COLPO CRITICO! ' : ' → colpito. ';
      text += 'Danni ' + dmgExpr + (res.crit ? ' (dadi raddoppiati)' : '') + ': ' + rollText(res.damageRolls, res.damageFlat) +
        ' = ' + res.damage + (w.damageType ? ' ' + w.damageType : '') + (def.note ? ' (' + def.note + ')' : '') + '. ' + t.name + ': ' + before + ' → ' + t.hp + ' PF.';
      log(c, res.crit ? 'critico' : 'colpito', text);
      summary = (res.crit ? 'CRITICO! ' : '') + t.name + ' subisce ' + def.amount + ' danni.';
      summaryType = res.crit ? 'success' : 'info';
      if (before > 0 && t.hp === 0) {
        log(c, 'a-terra', t.name + ' è a terra!');
        summary += ' ' + t.name + ' è a terra!';
      }
    });
    if (summary) toast(summary, summaryType);
  }

  // Tiro salvezza: d20 + totale della caratteristica, con vantaggio/svantaggio e CD opzionale.
  // ---------- Incantesimi ----------
  function slotsIndicator(sc) {
    const levels = sc.slotsTotal.map((n, i) => [i + 1, n]).filter(([, n]) => n > 0);
    const innate = (list) => list.map((sp) => { const inn = sc.innate[sp.id]; return el('span', { class: inn && inn.freq === 'giorno' && !inn.left ? 'empty-slot' : '', text: sp.name + (inn && inn.freq === 'giorno' ? ' ' + inn.left : '') }); });
    if (sc.innate && !levels.length) {
      return el('div', { class: 'slots-indicator', title: 'Incantesimi innati' }, el('span', { text: '✨ Innati · CD ' + sc.dc + ' · ' + R.formatModifier(sc.attack) }), innate(sc.spells));
    }
    // Incantatori con anche magie senza slot (le magie «N al giorno» dei leggendari): slot e usi rimasti.
    if (sc.innate) {
      return el('div', { class: 'slots-indicator', title: 'Slot incantesimo e magie senza slot rimasti' },
        el('span', { text: '✨ CD ' + sc.dc + ' · ' + R.formatModifier(sc.attack) }),
        levels.map(([l, n]) => { const left = DnD.magie.slotsLeft(sc.slotsTotal, sc.slotsUsed, l); return el('span', { class: left ? '' : 'empty-slot', text: l + '°: ' + left + '/' + n }); }),
        innate(sc.spells.filter((sp) => sc.innate[sp.id])));
    }
    return el('div', { class: 'slots-indicator', title: 'Slot incantesimo rimasti' },
      el('span', { text: '✨ CD ' + sc.dc + ' · ' + R.formatModifier(sc.attack) }),
      levels.length
        ? levels.map(([l, n]) => {
          const left = DnD.magie.slotsLeft(sc.slotsTotal, sc.slotsUsed, l);
          return el('span', { class: left ? '' : 'empty-slot', text: l + '°: ' + left + '/' + n });
        })
        : el('span', { text: 'solo trucchetti' }));
  }

  // preset: { spellId, slotLevel, targetIds, mode } per riaprire la finestra dopo la scelta sulla griglia.
  function castDialog(caster, preset) {
    preset = preset || {};
    const sc = caster.spellcasting;
    const spells = sc.spells.slice().sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'it'));
    const spellSel = el('select', {}, spells.map((sp) => el('option', {
      value: sp.id, selected: sp.id === preset.spellId,
      text: sp.name + ' — ' + DnD.magie.levelName(sp.level) + (sp.level && !DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed).length ? ' (nessuno slot)' : ''),
    })));
    const slotSel = el('select', {});
    const summary = el('p', { class: 'muted small' });
    const warn = el('div', { class: 'warn', 'aria-live': 'polite' });
    const others = order().filter((t) => t.id !== caster.id);
    const chosen = new Set(preset.targetIds || []);
    const targetBox = el('div', { class: 'target-checks' });
    const modeBox = el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro per colpire' }),
      ['normale', 'vantaggio', 'svantaggio'].map((m) => el('label', { class: 'check' },
        el('input', { type: 'radio', name: 'modo-magia', value: m, checked: m === (preset.mode || 'normale') }), ' ' + m[0].toUpperCase() + m.slice(1))));
    const current = () => spells.find((sp) => sp.id === spellSel.value);
    const readTargets = () => [...targetBox.querySelectorAll('input:checked')].map((i) => i.value);
    const currentMode = () => body.querySelector('input[name="modo-magia"]:checked').value;
    let castBtn = null;

    function sync() {
      const sp = current();
      if (!sp) return;
      const inn = innateOf(sc, sp);
      const levels = inn ? [sp.level] : DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed);
      clear(slotSel).append(...(inn
        ? [el('option', { value: String(sp.level), text: 'Innato: ' + (inn.freq === 'giorno' ? inn.left + ' usi rimasti oggi' : 'a volontà') + ', senza slot' })]
        : sp.level === 0
          ? [el('option', { value: '0', text: 'Trucchetto: non consuma slot' })]
          : levels.map((l) => el('option', {
            value: String(l), selected: l === preset.slotLevel,
            text: l + '° livello (' + DnD.magie.slotsLeft(sc.slotsTotal, sc.slotsUsed, l) + ' rimasti)' + (l > sp.level && sp.effect.upcastDice ? ' · +' + (l - sp.level) + '×' + sp.effect.upcastDice : ''),
          }))));
      slotSel.disabled = Boolean(inn) || sp.level === 0 || !levels.length;
      warn.textContent = inn ? (inn.freq === 'giorno' && inn.left <= 0 ? '⚠ Usi giornalieri esauriti.' : '')
        : sp.level > 0 && !levels.length ? '⚠ Nessuno slot di ' + sp.level + '° livello o superiore disponibile: non puoi lanciare questo incantesimo.' : '';
      if (castBtn) castBtn.disabled = Boolean(warn.textContent);
      summary.textContent = DnD.uiMagie.effectSummary(sp) + (sp.area ? ' · ad area: puoi scegliere più bersagli' : '');
      modeBox.hidden = sp.effect.type !== 'attacco';
      // Bersagli: più di uno solo per gli incantesimi ad area. Le cure possono puntare anche su sé stessi.
      const pool = sp.effect.type === 'cura' ? [caster].concat(others) : others;
      const multi = sp.area;
      if (!multi && chosen.size > 1) { const first = [...chosen][0]; chosen.clear(); chosen.add(first); }
      if (!chosen.size && pool.length && sp.effect.type !== 'nessuno') {
        const preferred = pool.find((t) => (sp.effect.type === 'cura' ? t.kind === caster.kind : t.kind !== caster.kind) && !R.isDown(t)) || pool[0];
        chosen.add(preferred.id);
      }
      clear(targetBox).append(...pool.map((t) => el('label', { class: 'check' },
        el('input', {
          type: multi ? 'checkbox' : 'radio', name: 'bersaglio-magia', value: t.id, checked: chosen.has(t.id),
          onchange: (e) => { if (!multi) chosen.clear(); if (e.target.checked) chosen.add(t.id); else chosen.delete(t.id); },
        }),
        ' ' + t.name + ' (CA ' + t.ac + ', PF ' + t.hp + '/' + t.maxHp + ')' + (R.isDown(t) ? ' – a terra' : ''))));
    }
    spellSel.addEventListener('change', () => { chosen.clear(); sync(); });

    const pickButton = grid && grid.hasTokens() && grid.node.isConnected
      ? el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
        const keep = { spellId: spellSel.value, slotLevel: Number(slotSel.value), mode: currentMode() };
        const multi = current().area;
        const picked = multi ? new Set(readTargets()) : new Set();
        dialog.dismiss();
        grid.pickTarget((id) => {
          const a = byId(caster.id);
          if (!a) return;
          if (id) {
            if (multi && picked.has(id)) picked.delete(id); else picked.add(id);
            if (multi) return toast(byId(id) ? byId(id).name + (picked.has(id) ? ' aggiunto ai bersagli.' : ' tolto dai bersagli.') : '');
            return castDialog(a, Object.assign(keep, { targetIds: [id] }));
          }
          castDialog(a, Object.assign(keep, { targetIds: [...picked] }));
        }, multi);
      } })
      : null;

    const body = el('div', { class: 'form' },
      el('div', { class: 'grid-2' }, field('Incantesimo', spellSel), field('Livello dello slot', slotSel)),
      summary, warn,
      el('fieldset', {}, el('legend', { text: 'Bersagli' }), targetBox, pickButton),
      modeBox);
    const dialog = openDialog(caster.name + ' lancia un incantesimo', body, [
      { text: 'Annulla' },
      { text: '✨ Lancia', class: 'primary', onclick: () => {
        const sp = current();
        const targets = readTargets();
        if (sp.effect.type !== 'nessuno' && !targets.length) { toast('Scegli almeno un bersaglio.', 'error'); return false; }
        const inn = innateOf(sc, sp);
        if (inn ? inn.freq === 'giorno' && inn.left <= 0 : sp.level > 0 && !DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed).includes(Number(slotSel.value))) {
          toast(inn ? 'Usi giornalieri esauriti.' : 'Nessuno slot disponibile per questo incantesimo.', 'error');
          return false;
        }
        performCast(caster.id, sp.id, inn ? sp.level : sp.level === 0 ? 0 : Number(slotSel.value), targets, currentMode());
        return undefined;
      } },
    ]);
    castBtn = dialog.querySelector('.modal-actions .btn.primary');
    sync();
  }

  // Incantesimo innato di una creatura (senza slot): { freq, left } oppure null.
  const innateOf = (sc, sp) => (sc && sc.innate && sp && sc.innate[sp.id]) || null;

  function performCast(casterId, spellId, slotLevel, targetIds, mode) {
    let summaryText = '';
    mutate((c, st) => {
      const a = byId(casterId);
      const sc = a && a.spellcasting;
      const sp = sc && sc.spells.find((x) => x.id === spellId);
      if (!sp) return;
      const inn = innateOf(sc, sp);
      if (inn) {
        if (inn.freq === 'giorno') inn.left = Math.max(0, inn.left - 1);
        // Leggendari: la magia «N al giorno» del Percorso resta spesa anche nella scheda (fino al riposo lungo).
        const source = a.kind === 'player' && a.legend ? st.players.find((p) => p.id === a.sourceId) : null;
        if (source && source.legend && inn.freq === 'giorno') source.legend.spellUses[sp.id] = (source.legend.spellUses[sp.id] || 0) + 1;
      } else if (sp.level > 0) {
        sc.slotsUsed = DnD.magie.consumeSlot(sc.slotsUsed, sc.slotsTotal, slotLevel);
        // Per i giocatori lo slot consumato resta anche nella scheda, oltre il combattimento.
        const source = a.kind === 'player' ? st.players.find((p) => p.id === a.sourceId) : null;
        if (source) source.spellcasting.slotsUsed[slotLevel - 1] = sc.slotsUsed[slotLevel - 1];
      }
      const targets = targetIds.map(byId).filter(Boolean);
      const res = DnD.magie.resolveSpell({
        spell: sp, slotLevel, mode, caster: { attack: sc.attack, dc: sc.dc, mod: sc.mod },
        targets: targets.map((t) => ({ id: t.id, ac: t.ac, saves: t.saves })),
      }, DnD.dadi.randomInt);
      const e = sp.effect;
      const dmgType = e.damageType ? ' ' + e.damageType : '';
      const diceText = (r) => (r ? DnD.dadi.formatExpr(r.count, r.sides, r.modifier) + ': ' + rollText(r.rolls, r.modifier) + ' = ' + Math.max(0, r.total) : '');
      const parts = [a.name + ' lancia ' + sp.name + (inn ? ' (innato' + (inn.freq === 'giorno' ? ', ' + inn.left + ' usi rimasti' : ', a volontà') + ')' : sp.level ? ' (slot ' + slotLevel + '°)' : ' (trucchetto)') +
        (targets.length ? ' su ' + targets.map((t) => t.name).join(', ') : '') + '.'];
      if (res.roll) parts.push((e.type === 'cura' ? 'Cura ' : 'Danni ') + diceText(res.roll) + (e.type === 'cura' ? '' : dmgType) + '.');
      const downed = [];
      for (const r of res.targets) {
        const t = byId(r.id);
        const before = t.hp;
        let defNote = '';
        if (e.type === 'cura') t.hp = R.heal(t.hp, t.maxHp, r.amount);
        else if (r.amount) {
          const def = M.applyDefenses(r.amount, M.damageTypeOf(e.damageType), t.defenses, true);
          defNote = def.note ? ' (' + def.note + ')' : '';
          hurt(t, def.amount);
          r.amount = def.amount;
        }
        // Tiro salvezza fallito: la Resistenza leggendaria può trasformarlo in un successo.
        if (e.type === 'salvezza' && !r.success && t.creature && t.creature.legendaryResistance.left > 0) {
          t.pendingSave = { full: [{ amount: res.roll ? Math.max(0, res.roll.total) : 0, type: M.damageTypeOf(e.damageType) }], half: e.halfOnSave, applied: before - t.hp, magical: true, text: sp.name };
        }
        const hpText = (before === t.hp ? '' : ' (' + before + ' → ' + t.hp + ' PF)') + defNote;
        if (e.type === 'attacco') {
          const d20 = mode === 'normale' ? 'd20 = ' + r.natural : 'd20 con ' + mode + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
          const outcome = r.fumble ? '1 NATURALE, mancato' : r.crit ? 'CRITICO, ' + r.amount + ' danni' + dmgType + ' (' + diceText(r.roll) + ')'
            : r.hit ? 'colpito, ' + r.amount + ' danni' + dmgType + ' (' + diceText(r.roll) + ')' : 'mancato';
          parts.push(t.name + ': ' + d20 + ' ' + R.formatModifier(sc.attack) + ' = ' + r.total + ' contro CA ' + t.ac + ' → ' + outcome + hpText + '.');
        } else if (e.type === 'salvezza') {
          parts.push(t.name + ': salvezza ' + e.saveAbility + ' ' + r.saveTotal + ' vs CD ' + sc.dc + ' → ' + (r.success ? 'riesce' : 'fallisce') + ', ' + r.amount + ' danni' + hpText + '.');
        } else if (e.type === 'cura') {
          parts.push(t.name + ' recupera ' + (t.hp - before) + ' PF' + hpText + (before === 0 && t.hp > 0 ? ', torna in piedi' : '') + '.');
        } else if (res.roll) {
          parts.push(t.name + ': ' + r.amount + ' danni' + hpText + '.');
        }
        if (before > 0 && t.hp === 0) downed.push(t.name);
      }
      log(c, 'magia', parts.join(' '));
      for (const n of downed) log(c, 'a-terra', n + ' è a terra!');
      summaryText = a.name + ' lancia ' + sp.name + (downed.length ? ' · a terra: ' + downed.join(', ') : '');
    });
    if (summaryText) toast(summaryText, 'success');
  }

  function saveDialog(target) {
    const ability = el('select', { 'data-key': 'ability' }, R.ABILITIES.map((ab) => el('option', {
      value: ab, text: R.ABILITY_NAMES[ab] + ' (' + R.formatModifier(target.saves[ab]) + ')',
    })));
    const dc = numberInput('', { min: 1, max: 40, placeholder: 'facoltativa', 'data-key': 'dc' });
    const mode = (value, label) => el('label', { class: 'check' },
      el('input', { type: 'radio', name: 'modo-ts', value, checked: value === R.MODES.normale }), ' ' + label);
    const body = el('div', { class: 'form' },
      el('div', { class: 'grid-2' }, field('Caratteristica', ability, 'ability'), field('Classe Difficoltà (CD)', dc, 'dc')),
      el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro' }),
        mode(R.MODES.normale, 'Normale'), mode(R.MODES.vantaggio, 'Vantaggio'), mode(R.MODES.svantaggio, 'Svantaggio')));
    openDialog('Tiro salvezza di ' + target.name, body, [
      { text: 'Annulla' },
      { text: 'Tira', class: 'primary', onclick: () => {
        const dcValue = dc.value.trim() === '' ? null : readNumber(dc);
        const errors = {};
        if (dcValue !== null) DnD.validazione.intInRange(errors, 'dc', dcValue, 1, 40);
        if (!showErrors(body, errors)) return false;
        const ab = ability.value;
        const m = body.querySelector('input[name="modo-ts"]:checked').value;
        let summaryText = '';
        let summaryType = 'info';
        mutate((c) => {
          const t = byId(target.id);
          if (!t) return;
          const r = R.rollSave({ bonus: t.saves[ab], mode: m, dc: dcValue }, DnD.dadi.randomInt);
          const d20 = m === R.MODES.normale ? 'd20 = ' + r.natural : 'd20 con ' + m + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
          const outcome = r.success === null ? '' : r.success ? ' contro CD ' + dcValue + ' → riuscito.' : ' contro CD ' + dcValue + ' → fallito.';
          log(c, r.success === false ? 'mancato' : 'tiro-salvezza', t.name + ' tiro salvezza su ' + R.ABILITY_NAMES[ab] + ': ' + d20 + ' ' +
            R.formatModifier(t.saves[ab]) + ' = ' + r.total + (outcome || '.'));
          summaryText = t.name + ': TS ' + ab + ' = ' + r.total + (r.success === null ? '' : r.success ? ' (riuscito)' : ' (fallito)');
          summaryType = r.success === false ? 'error' : r.success ? 'success' : 'info';
        });
        if (summaryText) toast(summaryText, summaryType);
        return undefined;
      } },
    ]);
  }

  function healDialog(target) {
    const amount = textInput('', { placeholder: 'es. 7 oppure 2d4+2', 'data-key': 'amount' });
    const body = el('div', { class: 'form' },
      field('Quantità o tiro di dado', amount, 'amount', 'PF attuali ' + target.hp + '/' + target.maxHp + '. La cura non supera il massimo.'));
    openDialog('Cura ' + target.name, body, [
      { text: 'Annulla' },
      { text: 'Cura', class: 'primary', onclick: () => {
        const p = DnD.dadi.parseExpr(amount.value);
        if (!p || (!p.count && p.modifier < 0)) {
          showErrors(body, { amount: 'Inserisci un numero positivo o un tiro come 2d4+2.' });
          return false;
        }
        const r = DnD.dadi.roll(p.count, p.sides, p.modifier);
        const healed = Math.max(0, r.total);
        mutate((c) => {
          const t = byId(target.id);
          if (!t) return;
          const before = t.hp;
          t.hp = R.heal(t.hp, t.maxHp, healed);
          const detail = p.count ? ' (' + DnD.dadi.formatExpr(p.count, p.sides, p.modifier) + ': ' + rollText(r.rolls, p.modifier) + ')' : '';
          log(c, 'cura', t.name + ' recupera ' + (t.hp - before) + ' PF' + detail + ': ' + before + ' → ' + t.hp + ' PF.' +
            (before === 0 && t.hp > 0 ? ' Torna in piedi.' : ''));
        });
        toast(target.name + ' curato.', 'success');
        return undefined;
      } },
    ]);
    amount.focus();
  }

  function editDialog(target) {
    const inp = {
      hp: numberInput(target.hp, { min: 0 }),
      maxHp: numberInput(target.maxHp, { min: 1 }),
      ac: numberInput(target.ac, { min: 1, max: 40 }),
      initiative: numberInput(target.initiative),
    };
    // Velocità per modalità: vuoto = quella della razza o della creatura (con bonus e forma), in piedi.
    const base = Mv.baseSpeeds(target);
    const over = Mv.normalizeOverride(target.speedOverride);
    const speedInp = Object.fromEntries(Mv.MODES.map((m) => [m, numberInput(over[m] === undefined ? '' : over[m], { min: 0, max: Mv.MAX_FEET, step: 5, placeholder: String(base[m]) })]));
    const body = el('div', { class: 'form' }, el('div', { class: 'grid-2' },
      field('PF attuali', inp.hp, 'hp'),
      field('PF massimi', inp.maxHp, 'maxHp'),
      field('Classe Armatura', inp.ac, 'ac'),
      field('Iniziativa', inp.initiative, 'initiative')),
      el('fieldset', {}, el('legend', { text: 'Velocità (ft) — vuoto = dalla scheda' }),
        el('div', { class: 'grid-3 tight' }, Mv.MODES.map((m) => field(Mv.MODE_ICONS[m] + ' ' + Mv.MODE_NAMES[m], speedInp[m], 'speed.' + m)))));
    openDialog('Modifica ' + target.name, body, [
      { text: 'Annulla' },
      { text: 'Salva', class: 'primary', onclick: () => {
        const v = Object.fromEntries(Object.entries(inp).map(([k, i]) => [k, readNumber(i)]));
        const errors = {};
        DnD.validazione.intInRange(errors, 'maxHp', v.maxHp, 1, 9999);
        DnD.validazione.intInRange(errors, 'hp', v.hp, 0, Number.isInteger(v.maxHp) ? v.maxHp : 9999);
        DnD.validazione.intInRange(errors, 'ac', v.ac, 1, 40);
        DnD.validazione.intInRange(errors, 'initiative', v.initiative, -20, 60);
        const newOver = {};
        for (const m of Mv.MODES) {
          if (speedInp[m].value.trim() === '') continue;
          const n = readNumber(speedInp[m]);
          DnD.validazione.intInRange(errors, 'speed.' + m, n, 0, Mv.MAX_FEET);
          newOver[m] = n;
        }
        if (!showErrors(body, errors)) return false;
        mutate((c) => {
          const t = byId(target.id);
          if (!t) return;
          const changes = [];
          if (t.hp !== v.hp || t.maxHp !== v.maxHp) changes.push('PF ' + t.hp + '/' + t.maxHp + ' → ' + v.hp + '/' + v.maxHp);
          if (t.ac !== v.ac) changes.push('CA ' + t.ac + ' → ' + v.ac);
          if (t.initiative !== v.initiative) changes.push('iniziativa ' + t.initiative + ' → ' + v.initiative);
          if (JSON.stringify(Mv.normalizeOverride(t.speedOverride)) !== JSON.stringify(Mv.normalizeOverride(newOver))) {
            changes.push('velocità ' + (Object.keys(newOver).length ? Object.entries(newOver).map(([m, n]) => Mv.MODE_NAMES[m].toLowerCase() + ' ' + n + ' ft').join(', ') : 'dalla scheda'));
            t.speedOverride = newOver;
          }
          if (!changes.length) return;
          const wasUp = t.hp > 0;
          Object.assign(t, v);
          log(c, 'modifica', 'Modifica manuale di ' + t.name + ': ' + changes.join(', ') + '.');
          if (wasUp && t.hp === 0) log(c, 'a-terra', t.name + ' è a terra!');
        });
        return undefined;
      } },
    ]);
  }

  function removeCombatant(target) {
    if (!confirm('Rimuovere ' + target.name + ' dal combattimento?')) return;
    mutate((c, st) => {
      // Se tocca a lui, il turno passa prima al successivo.
      const wasCurrent = c.currentId === target.id;
      if (wasCurrent) {
        const res = R.nextTurn(R.sortByInitiative(c.combatants), target.id, c.round);
        c.currentId = res.currentId === target.id ? null : res.currentId;
        c.round = res.round;
      }
      c.combatants = c.combatants.filter((x) => x.id !== target.id);
      log(c, 'sistema', target.name + ' viene rimosso dal combattimento.');
      if (wasCurrent && c.currentId) log(c, 'turno', 'Turno di ' + byId(c.currentId).name + '.');
      if (!c.combatants.length) session(st).combat = null;
    });
  }

  // ---------- Azioni delle creature ----------
  // Bersagli proposti: per cure gli alleati (compreso sé stesso), altrimenti gli avversari non a terra.
  function targetPool(x, a) {
    const others = order().filter((t) => t.id !== x.id);
    return a.mech.kind === 'cura' ? [x].concat(others) : others;
  }
  function defaultTarget(x, a, pool) {
    const enemy = (t) => (a.mech.kind === 'cura' ? t.kind === x.kind : t.kind !== x.kind);
    return (pool.find((t) => enemy(t) && !R.isDown(t)) || pool[0] || {}).id;
  }

  // Finestra dell'azione: per il multiattacco una riga per ogni attacco previsto, ciascuna con il proprio
  // bersaglio; per i tiri salvezza ad area più bersagli. preset: { targets: { indice: [id] }, mode }.
  function creatureActionDialog(x, actionId, preset) {
    preset = preset || {};
    const st = x.creature;
    const a = M.allActions(st).find((y) => y.id === actionId);
    if (!a) return;
    if (a.mech.kind === 'testo') { performCreatureAction(x.id, a.id, [], 'normale'); return; }
    const steps = a.mech.kind === 'multiattacco' ? M.expandMultiattack(st, a) : [a];
    if (!steps.length) { toast('Il multiattacco non ha azioni valide.', 'error'); return; }
    const rows = steps.map((sub, i) => {
      const pool = targetPool(x, sub);
      const multi = sub.mech.kind === 'salvezza' && Boolean(sub.mech.area);
      const chosen = new Set((preset.targets && preset.targets[i]) || [defaultTarget(x, sub, pool)].filter(Boolean));
      const box = el('div', { class: 'target-checks' }, pool.map((t) => el('label', { class: 'check' },
        el('input', { type: multi ? 'checkbox' : 'radio', name: 'bersaglio-' + i, value: t.id, checked: chosen.has(t.id) }),
        ' ' + t.name + ' (CA ' + t.ac + ', PF ' + t.hp + '/' + t.maxHp + ')' + (R.isDown(t) ? ' – a terra' : '') +
          (t.pos && x.pos && t.id !== x.id ? ' · ' + G.tokenDistance(x, t) + ' cas.' : ''))));
      return { sub, box, node: el('fieldset', {}, el('legend', { text: (steps.length > 1 ? (i + 1) + '. ' : '') + M.actionTitle(sub) }),
        el('p', { class: 'muted small', text: M.actionText(st, sub) }), box) };
    });
    const hasAttack = steps.some((y) => y.mech.kind === 'attacco');
    const mode = (value, label) => el('label', { class: 'check' }, el('input', { type: 'radio', name: 'modo-creatura', value, checked: value === (preset.mode || 'normale') }), ' ' + label);
    const modeBox = hasAttack ? el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro per colpire' }), mode('normale', 'Normale'), mode('vantaggio', 'Vantaggio'), mode('svantaggio', 'Svantaggio')) : null;
    const read = () => rows.map((r) => [...r.box.querySelectorAll('input:checked')].map((i) => i.value));
    const currentMode = () => (modeBox ? body.querySelector('input[name="modo-creatura"]:checked').value : 'normale');
    const pickButton = steps.length === 1 && grid && grid.hasTokens() && grid.node.isConnected
      ? el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
        const keep = { mode: currentMode() };
        dialog.dismiss();
        grid.pickTarget((id) => { const xx = byId(x.id); if (xx && id) creatureActionDialog(xx, actionId, Object.assign(keep, { targets: { 0: [id] } })); });
      } })
      : null;
    const body = el('div', { class: 'form' }, rows.map((r) => r.node), pickButton, modeBox);
    const dialog = openDialog(x.name + ': ' + a.name, body, [
      { text: 'Annulla' },
      { text: '▶ Esegui', class: 'primary', onclick: () => {
        const targets = read();
        if (targets.some((t) => !t.length)) { toast('Scegli un bersaglio per ogni attacco.', 'error'); return false; }
        performCreatureAction(x.id, a.id, targets, currentMode());
        return undefined;
      } },
    ]);
  }

  // Esegue l'azione (e, per il multiattacco, tutte le azioni previste in sequenza), con una riga di log per
  // ciascuna. Consuma usi, ricarica o punti leggendari.
  function performCreatureAction(attackerId, actionId, targetIds, mode) {
    const downed = [];
    mutate((c) => {
      const x = byId(attackerId);
      const st = x && x.creature;
      const a = st && M.allActions(st).find((y) => y.id === actionId);
      if (!a) return;
      const use = M.canUse(st, a);
      if (!use.ok) { toast(a.name + ': ' + use.reason + '.', 'error'); return; }
      M.consume(st, a);
      const header = x.name + (a.group === 'legendary' ? ' (azione leggendaria, ' + st.legendaryPoints.left + ' punti rimasti)' : '') + ' usa ' + a.name;
      if (a.mech.kind === 'testo') { log(c, 'sistema', header + ': ' + M.actionText(st, a)); return; }
      const steps = a.mech.kind === 'multiattacco' ? M.expandMultiattack(st, a) : [a];
      if (steps.length > 1) log(c, 'sistema', header + ': ' + M.actionText(st, a));
      steps.forEach((sub, i) => {
        for (const tid of targetIds[i] || []) {
          const t = byId(tid);
          if (!t) continue;
          const before = t.hp;
          const who = steps.length > 1 ? x.name + ' — ' + sub.name : header;
          if (sub.mech.kind === 'attacco') {
            const r = M.resolveAttack(st, sub, t, mode, DnD.dadi.randomInt);
            const d20 = mode === 'normale' ? 'd20 = ' + r.natural : 'd20 con ' + mode + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
            let text = who + ' contro ' + t.name + ': ' + d20 + ' ' + R.formatModifier(r.bonus) + ' = ' + r.total + ' contro CA ' + t.ac;
            if (r.fumble || !r.hit) { log(c, 'mancato', text + (r.fumble ? '. 1 NATURALE: mancato.' : ' → mancato.')); continue; }
            const applied = M.applyDamageParts(r.parts, t.defenses, sub.mech.magical);
            hurt(t, applied.total);
            text += (r.crit ? '. 20 NATURALE, CRITICO (dadi raddoppiati)! ' : ' → colpito: ') +
              r.parts.map((q) => q.dice + rollText(q.rolls, q.bonus).replace(/^/, ' ') + ' = ' + q.amount + (q.type ? ' ' + q.type : '')).join(' + ') +
              (applied.notes.length ? ' (' + applied.notes.join('; ') + ')' : '') + ' → ' + applied.total + ' danni. ' + t.name + ': ' + before + ' → ' + t.hp + ' PF.';
            log(c, r.crit ? 'critico' : 'colpito', text);
          } else if (sub.mech.kind === 'salvezza') {
            const r = M.resolveSave(st, sub, t, DnD.dadi.randomInt);
            const applied = M.applyDamageParts(r.parts, t.defenses, false);
            hurt(t, applied.total);
            let text = who + ': ' + t.name + ' tira salvezza su ' + R.ABILITY_NAMES[r.ability] + ' ' + r.total + ' contro CD ' + r.dc + ' → ' + (r.success ? 'riesce' : 'fallisce');
            if (r.parts.length) text += ', ' + r.full.map((q) => q.dice + ' [' + q.rolls.join(', ') + ']' + (q.bonus ? ' ' + R.formatModifier(q.bonus) : '') + ' = ' + q.amount + (q.type ? ' ' + q.type : '')).join(' + ') +
              (r.success && sub.mech.half ? ' (metà)' : '') + (applied.notes.length ? ' (' + applied.notes.join('; ') + ')' : '') + ' → ' + applied.total + ' danni';
            if (!r.success && sub.mech.effect) text += '; ' + sub.mech.effect;
            text += '. ' + (before !== t.hp ? t.name + ': ' + before + ' → ' + t.hp + ' PF.' : '');
            log(c, r.success ? 'tiro-salvezza' : 'colpito', text);
            if (!r.success && t.creature && t.creature.legendaryResistance.left > 0) {
              t.pendingSave = { full: r.full.map((q) => ({ amount: q.amount, type: q.type })), half: sub.mech.half, applied: before - t.hp, magical: false, text: sub.name };
            }
          } else if (sub.mech.kind === 'cura') {
            const r = M.resolveHeal(st, sub, DnD.dadi.randomInt);
            t.hp = R.heal(t.hp, t.maxHp, r.amount);
            log(c, 'cura', who + ': ' + t.name + ' recupera ' + (t.hp - before) + ' PF [' + r.rolls.join(', ') + ']: ' + before + ' → ' + t.hp + ' PF.');
          }
          if (before > 0 && t.hp === 0) { log(c, 'a-terra', t.name + ' è a terra!'); downed.push(t.name); }
        }
      });
    });
    if (downed.length) toast('A terra: ' + downed.join(', '), 'success');
  }

  // Resistenza leggendaria: l'ultimo tiro salvezza fallito diventa un successo (PF restituiti di conseguenza).
  function useLegendaryResistance(id) {
    mutate((c) => {
      const x = byId(id);
      const what = x.pendingSave && x.pendingSave.text;
      const r = M.useLegendaryResistance(x);
      if (!r) return;
      log(c, 'tiro-salvezza', x.name + ' usa la Resistenza leggendaria: il tiro salvezza contro ' + what + ' diventa un successo' +
        (r.refund ? ', recupera ' + r.refund + ' PF (' + x.hp + ' PF)' : '') + '. Rimaste ' + x.creature.legendaryResistance.left + '.');
    });
  }

  function creatureBox(x) {
    const st = x.creature;
    if (!st) return null;
    const down = R.isDown(x);
    const isTurn = combat().currentId === x.id;
    const usesText = (a) => {
      if (st.uses[a.id] !== undefined) return ' (' + st.uses[a.id] + ' ' + (a.freq.kind === 'giorno' ? '/giorno' : 'uso') + ')';
      if (a.freq.kind === 'ricarica') return st.recharge[a.id] ? '' : ' (da ricaricare)';
      return '';
    };
    const btn = (a, extraDisabled) => {
      const u = M.canUse(st, a);
      return el('button', {
        type: 'button', class: 'btn small' + (a.mech.kind === 'multiattacco' ? ' primary' : ''), disabled: down || !u.ok || extraDisabled,
        title: (u.reason ? u.reason + ' · ' : '') + M.actionText(st, a), text: a.name + (a.cost > 1 ? ' (' + a.cost + ')' : '') + usesText(a),
        onclick: () => creatureActionDialog(x, a.id),
      });
    };
    // Boss: le azioni disabilitate dalla fase in corso non si possono usare.
    const off = x.boss ? DnD.boss.disabledActions(x.boss, x.boss.phase) : new Set();
    const all = M.allActions(st);
    const of = (g) => all.filter((a) => a.group === g);
    const row = (label, list, extraDisabled) => (list.length ? el('div', { class: 'creature-actions' }, el('span', { class: 'muted small', text: label }),
      list.map((a) => { const b = btn(a, extraDisabled || off.has(a.id)); if (off.has(a.id)) b.title = 'Non disponibile in questa fase · ' + b.title; return b; })) : null);
    const lr = st.legendaryResistance;
    return el('div', { class: 'creature-box' },
      DnD.uiBoss.combatBox(x, () => mutate((c) => {
        const t = c.combatants.find((y) => y.id === x.id);
        t.boss.revealed = !t.boss.revealed;
        log(c, 'sistema', '👑 ' + t.name + (t.boss.revealed ? ' è rivelato ai giocatori.' : ' è di nuovo nascosto ai giocatori.'));
      })),
      row('Azioni', of('actions')),
      row('Bonus', of('bonusActions')),
      row('Reazioni', of('reactions')),
      st.legendaryPoints.max ? row('Leggendarie ' + st.legendaryPoints.left + '/' + st.legendaryPoints.max + (isTurn ? ' (alla fine del turno di un altro)' : ''), of('legendary'), isTurn) : null,
      lr.max ? el('div', { class: 'creature-actions' },
        el('span', { class: 'muted small', text: 'Resistenza leggendaria ' + lr.left + '/' + lr.max }),
        el('button', { type: 'button', class: 'btn small', text: 'Usa', disabled: !x.pendingSave || lr.left <= 0,
          title: x.pendingSave ? 'Trasforma in successo il tiro salvezza fallito contro ' + x.pendingSave.text : 'Nessun tiro salvezza fallito da trasformare',
          onclick: () => useLegendaryResistance(x.id) })) : null,
      st.traits.length ? el('details', { class: 'small' }, el('summary', { text: 'Tratti (' + st.traits.length + ')' }),
        st.traits.map((t) => el('p', {}, el('b', { text: M.actionTitle(t) + '. ' }), M.actionText(st, t)))) : null,
      st.lair.length ? el('p', { class: 'muted small', text: '🏰 Tana (iniziativa 20): ' + st.lair.map((a) => a.name).join(', ') }) : null);
  }

  function hpBar(x) {
    const pct = x.maxHp > 0 ? Math.round((x.hp / x.maxHp) * 100) : 0;
    return el('div', { class: 'hp' },
      el('div', { class: 'hp-text' }, el('b', { text: x.hp + ' / ' + x.maxHp }), ' PF'),
      el('div', { class: 'hp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': x.maxHp, 'aria-valuenow': x.hp, 'aria-label': 'Punti ferita' },
        el('div', { class: 'hp-fill ' + R.hpLevel(x.hp, x.maxHp), style: 'width:' + pct + '%' })));
  }

  function combatantCard(x, current) {
    const down = R.isDown(x);
    return el('article', {
      class: 'combatant ' + x.kind + (current ? ' current' : '') + (down ? ' down' : '') + (x.id === selectedId ? ' selected' : '') + (x.legend ? ' legendary' : '') + (x.legend && x.legend.form ? ' transformed' : ''),
      'data-id': x.id,
      style: x.legend && DnD.uiLeggendario ? DnD.uiLeggendario.cardStyle(x) : null,
      onclick: (e) => { if (!e.target.closest('button')) selectCombatant(x.id === selectedId ? null : x.id, 'card'); },
    },
      el('div', { class: 'combatant-head' },
        el('div', {},
          el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(x.icon, 28), el('h3', { text: x.name })),
          el('span', { class: 'muted small', text: (x.kind === 'player' ? 'Giocatore' : x.boss ? 'Boss (GS ' + x.creature.cr + ')' : x.creature ? 'Creatura (GS ' + x.creature.cr + ')' : 'Nemico') + ' · Iniziativa ' + x.initiative +
            ' · ' + G.tokenDims(x).w + '×' + G.tokenDims(x).h + (aiOn() ? ' · ' + (x.control === 'ia' ? '🤖 IA' : '👤 Manuale') + ' · ' + KI.FACTION_NAMES[x.faction] : '') + (x.hidden ? ' · nascosto' : '') }),
          down ? el('span', { class: 'badge down-badge', text: 'A TERRA' }) : null,
          current ? el('span', { class: 'badge turn-badge', text: 'TURNO' }) : null),
        el('div', { class: 'ac-shield', title: 'Classe Armatura' }, el('small', { text: 'CA' }), el('b', { text: String(x.ac) }))),
      hpBar(x),
      x.defenses && (x.defenses.vuln.length || x.defenses.res.length || x.defenses.imm.length) ? el('p', { class: 'muted small', text: [
        x.defenses.vuln.length ? 'Vulnerabile: ' + M.defensesText(x.defenses.vuln) : '', x.defenses.res.length ? 'Resiste: ' + M.defensesText(x.defenses.res) : '',
        x.defenses.imm.length ? 'Immune: ' + M.defensesText(x.defenses.imm) : ''].filter(Boolean).join(' · ') }) : null,
      x.spellcasting ? slotsIndicator(x.spellcasting) : null,
      x.pos || combat().phase === 'attivo' ? movementBox(x) : null,
      // Leggendari: Trasformati / Torna normale, rango e forma attiva.
      x.legend && DnD.uiLeggendario ? DnD.uiLeggendario.combatBox(x, { mutate, log, byId, render }) : null,
      creatureBox(x),
      el('div', { class: 'card-actions' },
        el('button', {
          class: 'btn primary', text: 'Attacca', onclick: () => attackDialog(x),
          disabled: down || !x.weapons.length || combat().combatants.length < 2,
          title: down ? 'È a terra' : !x.weapons.length ? 'Nessuna arma equipaggiata' : null,
        }),
        el('button', { class: 'btn', text: 'Cura', onclick: () => healDialog(x) }),
        el('button', { class: 'btn', text: 'Tiro salvezza', onclick: () => saveDialog(x) }),
        x.spellcasting ? el('button', {
          class: 'btn', text: '✨ Lancia incantesimo', onclick: () => castDialog(x),
          disabled: down || !x.spellcasting.spells.length, title: !x.spellcasting.spells.length ? 'Nessun incantesimo conosciuto' : null,
        }) : null,
        el('button', { class: 'btn', text: 'Modifica', onclick: () => editDialog(x) }),
        el('button', { class: 'btn danger', text: 'Rimuovi', onclick: () => removeCombatant(x) })));
  }

  const LC = DnD.layoutCombattimento;

  // Disposizione a tre colonne (riusata dalla schermata Esplorazione): colonne laterali ridimensionabili e
  // richiudibili, schede sugli schermi stretti; preferenze salvate con la chiave indicata.
  // opts: { key, left: { title, label, head: [nodi], body: [nodi] }, center: nodo, right: { … } }
  function columns(opts) {
    let P = LC.load(localStorage, opts.key);
    const store = () => LC.save(localStorage, P, opts.key);
    const layout = el('div', { class: 'combat-layout' });
    function apply() {
      layout.style.setProperty('--left-w', P.left + 'px');
      layout.style.setProperty('--right-w', P.right + 'px');
      layout.classList.toggle('left-closed', !P.leftOpen);
      layout.classList.toggle('right-closed', !P.rightOpen);
      layout.dataset.tab = P.tab;
      for (const b of layout.querySelectorAll('[data-layout-tab]')) {
        const on = b.dataset.layoutTab === P.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      }
      for (const [side, open] of [['left', P.leftOpen], ['right', P.rightOpen]]) {
        const btn = layout.querySelector('[data-collapse="' + side + '"]');
        if (!btn) continue;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = side === 'left' ? (open ? '«' : '»') : (open ? '»' : '«');
        btn.title = (open ? 'Chiudi' : 'Apri') + ' «' + (side === 'left' ? opts.left.title : opts.right.title) + '»';
        btn.setAttribute('aria-label', btn.title);
      }
    }
    // Divisore trascinabile (o con le frecce) di una colonna laterale.
    function divider(side) {
      const total = () => layout.getBoundingClientRect().width;
      const setWidth = (w) => {
        P[side] = LC.clamp(w, total());
        apply();
        d.setAttribute('aria-valuenow', String(P[side]));
      };
      const d = el('div', {
        class: 'pane-divider', role: 'separator', tabindex: 0, 'aria-orientation': 'vertical', 'data-divider': side,
        'aria-label': 'Ridimensiona la colonna «' + (side === 'left' ? opts.left.title : opts.right.title) + '»',
        'aria-valuenow': String(P[side]), 'aria-valuemin': String(LC.MIN),
        onpointerdown: (e) => {
          d.setPointerCapture(e.pointerId);
          const r = layout.getBoundingClientRect();
          const move = (ev) => setWidth(side === 'left' ? ev.clientX - r.left : r.right - ev.clientX);
          const up = () => {
            d.removeEventListener('pointermove', move);
            d.removeEventListener('pointerup', up);
            store();
          };
          d.addEventListener('pointermove', move);
          d.addEventListener('pointerup', up);
        },
        onkeydown: (e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const grow = (e.key === 'ArrowRight') === (side === 'left');
          setWidth(P[side] + (grow ? 20 : -20));
          store();
        },
      });
      return d;
    }
    const collapseBtn = (side) => el('button', { type: 'button', class: 'icon-btn collapse-btn', 'data-collapse': side, onclick: () => {
      const k = side === 'left' ? 'leftOpen' : 'rightOpen';
      P[k] = !P[k];
      store();
      apply();
    } });
    const tabBtn = (id, label) => el('button', { type: 'button', role: 'tab', class: 'tab', 'data-layout-tab': id, text: label, onclick: () => { P.tab = id; store(); apply(); } });
    const left = el('aside', { class: 'combat-col combat-entities', role: 'tabpanel', 'aria-label': opts.left.title },
      el('div', { class: 'combat-col-head' }, el('h2', { text: opts.left.title }), ...(opts.left.head || []), collapseBtn('left')), ...opts.left.body);
    const right = el('aside', { class: 'combat-col combat-turns', role: 'tabpanel', 'aria-label': opts.right.title },
      el('div', { class: 'combat-col-head' }, collapseBtn('right'), el('h2', { text: opts.right.title }), ...(opts.right.head || [])), ...opts.right.body);
    const tabs = el('div', { class: 'tabs combat-tabs', role: 'tablist', 'aria-label': 'Pannelli' }, tabBtn('entita', opts.left.title), tabBtn('turni', opts.right.title));
    layout.append(left, divider('left'), opts.center, divider('right'), right, tabs);
    apply();
    return { layout, reset: () => { P = LC.reset(localStorage, opts.key); apply(); } };
  }

  function renderActive() {
    const c = combat();
    const list = order();
    const current = c.currentId ? byId(c.currentId) : null;
    const anyUp = list.some((x) => !R.isDown(x));
    const logList = el('ol', { class: 'log' }, c.log.map((e) => el('li', { class: 'log-' + e.type },
      e.type === 'round' ? null : el('span', { class: 'log-round', text: 'R' + e.round }), e.text,
      e.why ? el('button', { type: 'button', class: 'btn small why-btn', text: 'Perché?', onclick: () => DnD.uiIa.whyDialog(e.why) }) : null)));

    if (selectedId && !byId(selectedId)) selectedId = null;
    const g = getGrid();
    // Al centro: barre dei boss e ombra restano sull'area della griglia, senza coprire le colonne.
    const center = el('div', { class: 'combat-center' }, ...[DnD.uiBoss.combatHud(c, 'master'), DnD.uiBoss.vignette(c)].filter(Boolean), g.node);
    const cols = columns({
      left: { title: 'Entità', body: [el('div', { class: 'combatants' }, list.map((x) => combatantCard(x, x.id === c.currentId)))] },
      center,
      right: {
        title: 'Turni',
        head: [el('button', { type: 'button', class: 'btn small dice-inline', text: '🎲 Dadi', title: 'Apri i dadi', onclick: () => DnD.uiDadi.openPanel() })],
        body: [
          el('section', { class: 'panel turn-panel' },
            el('div', { class: 'round' }, 'Round ', el('b', { text: String(c.round) })),
            el('div', { class: 'muted', text: current ? 'Turno di ' + current.name : anyUp ? 'Nessun turno attivo' : 'Tutti i combattenti sono a terra' }),
            current ? el('div', { class: 'small turn-move', text: speedText(current, true) }) : null,
            el('button', { class: 'btn primary wide', text: 'Prossimo turno ▶', onclick: nextTurn, disabled: !anyUp }),
            el('ol', { class: 'turn-order' }, list.map((x) => el('li', {
              class: (x.id === c.currentId ? 'current ' : '') + (R.isDown(x) ? 'down ' : '') + x.kind,
              onclick: () => selectCombatant(x.id, 'list'),
            },
            el('span', { class: 'init', text: String(x.initiative) }),
            el('span', { class: 'name', text: x.name }),
            el('span', { class: 'muted small', text: x.hp + '/' + x.maxHp }))))),
          aiPanel(),
          el('section', { class: 'panel log-panel' }, el('h2', { text: 'Log' }), logList)],
      },
    });

    root.append(
      el('div', { class: 'combat-screen' },
        el('div', { class: 'section-head' },
          el('h1', { text: 'Combattimento' }),
          el('div', { class: 'head-actions' },
            el('button', { class: 'btn', text: 'Reimposta layout', title: 'Larghezze predefinite e colonne aperte', onclick: cols.reset }),
            el('button', { class: 'btn danger', text: 'Termina combattimento', onclick: endCombat }))),
        // Combattimento nato dall'esplorazione: banner per tornarci.
        DnD.uiEsplorazione ? DnD.uiEsplorazione.combatBanner() : null,
        cols.layout));
    g.refresh();
    g.setSelectedCombatant(selectedId);
    logList.scrollTop = logList.scrollHeight;
    scheduleAuto();
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.combattimento = { title: 'Combattimento', render };
  // Per i test dell'interfaccia: piano corrente ed esecuzione. columns: disposizione a tre colonne riusabile.
  DnD.uiCombattimento = { selectCombatant: (id, source) => selectCombatant(id, source), getGrid: () => grid, columns,
    currentAiPlan, executePlan, undoAiTurn: () => restoreCombat(aiHistory.undo(), 'Turno IA annullato.'), aiHistory };
})(globalThis.DnD = globalThis.DnD || {});
