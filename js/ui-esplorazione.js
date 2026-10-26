// Sezione Esplorazione: si gioca su una mappa di esplorazione della sessione. Tre colonne come il
// Combattimento: a sinistra il gruppo (pedine, personaggi con PF, sfinimento, condizioni, scorte), al centro
// la mappa (stesso componente della griglia: zoom, pan, misuratore; biomi, eventi, nebbia), a destra tempo e
// registro (giorno, ora, meteo, bioma, ritmo, modalità, Avanza tempo, variabili, log). La pedina del gruppo si
// trascina o si muove con le frecce; ogni passo usa le regole del bioma (esplorazione.js) e, quando un evento
// scatta, si apre la finestra evento (Esegui, Salta, Rimanda, Cambia esito a mano). Combattimenti e mappe di
// battaglia passano dalla sezione Combattimento, con il banner «Torna all'esplorazione».
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, readNumber, toast, openDialog } = DnD.ui;
  const X = DnD.esplorazione;
  const B = DnD.biomi;
  const E = DnD.eventi;
  const G = DnD.griglia;
  const R = DnD.regole;
  const UM = () => DnD.uiMappaEsplorazione;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const LAYOUT_KEY = 'dnd-battaglie:layout-esplorazione';
  const UNDO_MAX = 30;

  let root = null;
  let grid = null;          // widget della mappa (creato una volta: vista e zoom sopravvivono ai render)
  let tools = null;         // strumenti del master sulla mappa
  let vision = null;        // luce, visione e nebbia di guerra (ui-visione.js)
  let snoozed = false;      // «Rimanda»: la finestra evento non si riapre da sola finché non arriva altro
  let lastQueue = 0;
  const undoStack = [];
  const redoStack = [];
  const setup = { gridId: '', players: new Set(), icon: null };

  const session = (st) => DnD.sessioni.current(st || DnD.store.state);
  const ex = () => session().exploration;
  const gridOf = (st, id) => (st.savedGrids || []).find((g) => g.id === id) || null;
  const world = (st) => {
    st = st || DnD.store.state;
    const e = session(st).exploration;
    return e ? { st, ex: e, grid: gridOf(st, e.gridId) } : null;
  };

  // ---------- Modifiche con annulla ----------
  // Istantanea: stato dell'esplorazione, griglie toccate (eventi, nebbia, biomi) e giocatori (ricompense).
  function snapshot(st) {
    const e = session(st).exploration;
    const ids = new Set([e.gridId].concat(e.stack.map((s) => s.gridId)));
    return clone({ ex: e, grids: st.savedGrids.filter((g) => ids.has(g.id)).map((g) => ({ id: g.id, events: g.events, fog: g.fog, vision: g.vision, biomeMap: g.biomeMap })), players: st.players });
  }
  function restore(st, snap) {
    session(st).exploration = clone(snap.ex);
    for (const g of snap.grids) { const t = gridOf(st, g.id); if (t) Object.assign(t, clone({ events: g.events, fog: g.fog, vision: g.vision, biomeMap: g.biomeMap })); }
    st.players = clone(snap.players);
  }
  // Riposo del gruppo attivo (esplorazione.rest): anteprima su una copia, poi il riposo vero con l'annulla.
  function restDialog(kind) {
    const w0 = world(JSON.parse(JSON.stringify(DnD.store.state)));
    if (!w0) return;
    const members = X.partyMembers(w0);
    const subjects = members.map((p) => ({ id: p.id, acc: DnD.riposi.fromSheet(p, w0.st, X.memberState(w0.ex, p.id, p)) }));
    DnD.uiRiposi.restDialog({ kind, subjects, now: w0.ex.time.total, guards: members, note: 'il tempo passa ora per ora: scorte, meteo e incontri casuali (un incontro interrompe il riposo)',
      onConfirm: (params) => {
        let r = null;
        mutate((ww) => { r = X.rest(ww, kind, Object.assign({ variants: DnD.impostazioni.restOptions() }, params)); });
        afterAction();
        if (!r || !r.ok) return r;
        return { ok: true, lines: r.results.map((x) => (x.interrupted && kind === 'breve' ? '🛏 Riposo breve interrotto: ' + x.name + ' non ne riceve i benefici.' : DnD.riposi.summaryText(x))).concat(r.interrupted === 'incontro' ? ['⚔ Riposo interrotto da un incontro: vedi le finestre in attesa.'] : []) };
      } });
  }

  // fn(w) modifica il mondo; con undoable si può annullare con Ctrl+Z / ↶.
  function mutate(fn, undoable) {
    let out;
    // Dadi animati: i tiri dell'azione (prove, danni, incontri, meteo) si registrano e poi si mostrano.
    const rec = DnD.dadi.registratore();
    let logFrom = 0;
    let lastLine = '';
    let sounds = [];
    DnD.store.update((st) => {
      const w = world(st);
      if (!w || !w.grid) return;
      w.registro = rec;
      logFrom = w.ex.log.length;
      if (undoable !== false) {
        undoStack.push(snapshot(st));
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        redoStack.length = 0;
      }
      out = fn(w);
      const fresh = w.ex.log.slice(logFrom);
      lastLine = fresh.length ? fresh[fresh.length - 1].text : '';
      // Suoni dagli esiti già scritti nel registro: evento, scoperta, ingresso in una mappa, meteo.
      sounds = DnD.suoniDati.fromExploration(fresh);
    });
    render();
    DnD.audio.suonaTutti(sounds);
    // Solo i dadi veri: le scelte pesate (meteo, quale incontro) usano lo stesso generatore con altre facce.
    const tiro = rec.tiro('Esplorazione', 'esplorazione', { testo: lastLine });
    if (tiro) DnD.uiDadi.mostraTiro(Object.assign(tiro, { totale: null, gruppi: tiro.gruppi.filter((g) => [4, 6, 8, 10, 12, 20, 100].includes(g.sides)) }));
    return out;
  }
  function undo() {
    if (!undoStack.length) return;
    DnD.store.update((st) => { redoStack.push(snapshot(st)); restore(st, undoStack.pop()); });
    render();
  }
  function redo() {
    if (!redoStack.length) return;
    DnD.store.update((st) => { undoStack.push(snapshot(st)); restore(st, redoStack.pop()); });
    render();
  }

  // ---------- Mappa ----------
  // Pedine del gruppo come "combattenti" del componente griglia.
  function tokens(e) {
    return e.parties.map((p) => {
      const hp = p.memberIds.reduce((s, id) => s + (e.members[id] ? e.members[id].hp : 0), 0);
      const max = p.memberIds.reduce((s, id) => s + (e.members[id] ? e.members[id].maxHp : 0), 0) || 1;
      return { id: p.id, name: p.name, icon: p.icon, pos: Object.assign({}, p.pos), w: 1, h: 1, hp: Math.max(1, hp), maxHp: max, kind: 'player', speed: 9, light: p.light };
    });
  }
  // Torcia (o altra sorgente) del gruppo: conta per la scoperta al buio e fa luce sulla mappa.
  function partyLight(id, kind) {
    let line = '';
    mutate((w) => {
      const p = w.ex.parties.find((x) => x.id === id);
      if (!p) return;
      line = DnD.visione.setCarried(p, kind === undefined ? (p.light ? p.light.kind : 'torcia') : kind);
      if (line) X.log(w, line, 'sistema');
      X.reveal(w);
    }, true);
  }
  function getGrid() {
    if (grid) return grid;
    vision = DnD.uiVisione.create({
      getDoc: () => { const w = world(); return w && w.grid ? { grid: w.grid, combatants: tokens(w.ex) } : null; }, widget: () => grid, mode: 'esplorazione',
      otherPainter: () => tools.painter,
      // Luce automatica: ora del giorno e bioma della pedina attiva. Celle viste: il raggio di scoperta del gruppo.
      env: () => { const w = world(); if (!w || !w.grid) return {}; const p = X.activeParty(w.ex); const b = X.biomeAt(w, p.pos.x, p.pos.y); return { hour: w.ex.time.hour, biomeLight: b ? b.light : 'normale' }; },
      playersView: () => { const w = world(); return { cells: X.discoveryView(w), seenIds: new Set(w.ex.parties.map((p) => p.id)) }; },
      onChange: () => DnD.store.save(),
    });
    tools = UM().create({
      getGrid: () => { const w = world(); return w && w.grid; }, widget: () => grid, mode: 'gioco',
      onInteract: (inst) => interact(inst),
      onChange: () => DnD.store.save(),
      otherPainter: () => vision.painter,
      extra: () => vision.quickBar(),
    });
    grid = DnD.uiGriglia.create({
      getDoc: () => {
        const w = world();
        return w && w.grid ? { id: 'esplora:' + w.grid.id, grid: w.grid, combatants: tokens(w.ex), currentId: X.activeParty(w.ex).id } : null;
      },
      // Trascinare una pedina = muoverla cella per cella lungo il percorso più conveniente.
      update: (fn) => {
        const w = world();
        if (!w) return;
        const doc = { id: 'esplora', grid: w.grid, combatants: tokens(w.ex), currentId: null };
        const before = new Map(doc.combatants.map((t) => [t.id, t.pos]));
        fn(doc);
        const moved = doc.combatants.find((t) => t.pos && (t.pos.x !== before.get(t.id).x || t.pos.y !== before.get(t.id).y));
        if (moved) moveParty(moved.id, moved.pos);
        else { DnD.store.save(); render(); }
      },
      tools: ['seleziona', 'misura'],
      showCombatants: false,
      painter: UM().combinePainters(tools.painter, vision.painter),
      vision,
      onSelect: (id) => { if (id && ex() && ex().parties.some((p) => p.id === id) && ex().activeParty !== id) { DnD.store.update(() => { ex().activeParty = id; }); render(); } },
      tokenActions: (id) => {
        const p = ex() && ex().parties.find((x) => x.id === id);
        const src = p && p.light ? DnD.visione.sourceById(p.light.kind) : null;
        return [{ text: '⭐ Rendi attiva', onclick: () => { DnD.store.update(() => { ex().activeParty = id; }); render(); } },
          { text: src && p.light.on ? '🌑 Spegni: ' + src.name.toLowerCase() : '🔥 Accendi ' + (src ? src.name.toLowerCase() : 'una torcia'), onclick: () => partyLight(id) },
          p && p.light ? { text: '✕ Posa la sorgente di luce', onclick: () => partyLight(id, '') } : null].filter(Boolean);
      },
      // Copie degli NPC del Mondo sulla mappa: pannello NPC (Parla, Commercia, Quest, Attacca…).
      onObject: (id) => DnD.uiOggettiMappa.openPanel({
        getItem: () => { const w = world(); return w && w.grid ? w.grid.items.find((x) => x.id === id) : null; },
        update: (fn) => { DnD.store.update((s) => { const w = world(s); if (w && w.grid) fn(w.grid.items.find((x) => x.id === id), s); }); render(); },
        log: (text) => { DnD.store.update((s) => { const w = world(s); if (w && w.grid) X.log(w, text, 'npc'); }); render(); },
      }),
      underlay: (ctx, view, s, W, H) => {
        const w = world();
        if (!w || !w.grid) return;
        UM().drawBiomes(ctx, view, s, w.grid, W, H);
        UM().drawEvents(ctx, view, s, w.grid, { master: true, onLoad: () => grid.requestDraw() });
      },
      undo, redo, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
    });
    return grid;
  }

  function moveParty(partyId, to) {
    const r = mutate((w) => {
      w.ex.activeParty = partyId;
      return X.moveTo(w, to);
    });
    if (r && !r.ok) { DnD.audio.suona('movimento-rifiutato'); toast('Movimento: ' + r.reason + (r.steps ? ' (dopo ' + r.steps + ' passi)' : '') + '.', 'error'); }
    else if (r) DnD.audio.suona('passo');
    afterAction();
  }
  function stepBy(dx, dy) {
    const e = ex();
    if (!e) return;
    const p = X.activeParty(e).pos;
    const r = mutate((w) => X.step(w, { x: p.x + dx, y: p.y + dy }));
    if (r && !r.ok) { DnD.audio.suona('movimento-rifiutato'); toast(r.reason + '.', 'error'); }
    else if (r) DnD.audio.suona('passo');
    afterAction();
  }
  // Frecce (e tastierino) per muovere la pedina attiva, quando la sezione è aperta e il focus non è in un campo.
  const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1] };
  document.addEventListener('keydown', (e) => {
    if (!root || !root.isConnected || !root.querySelector('.explore-screen') || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable) && t.className !== 'grid-canvas') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = KEYS[e.key];
    if (!d) return;
    e.preventDefault();
    stepBy(d[0], d[1]);
  });

  // ---------- Finestra evento ----------
  // Dopo ogni azione: se ci sono finestre in coda (e non è stato chiesto di rimandare) si apre la prima.
  function afterAction() {
    const e = ex();
    if (!e) return;
    if (e.queue.length > lastQueue) snoozed = false;
    lastQueue = e.queue.length;
    if (e.queue.length && !snoozed && !document.querySelector('dialog[open]')) openPrompt(e.queue[0]);
  }
  const dropPrompt = (id) => DnD.store.update(() => { ex().queue = ex().queue.filter((q) => q.id !== id); lastQueue = ex().queue.length; });

  function checksOf(actions, out) {
    out = out || [];
    for (const a of actions) {
      if (a.kind === 'prova') { out.push(a); checksOf(a.success, out); checksOf(a.failure, out); }
      if (a.kind === 'tabella') for (const r of a.rows) checksOf(r.actions, out);
    }
    return out;
  }

  function openPrompt(q) {
    const w = world();
    if (!w || !w.grid) return;
    if (q.kind === 'incontro' && q.encounter && q.encounter.kind === 'creatura') { encounterWindow(q); return; }
    let inst = null;
    if (q.kind === 'evento') inst = (w.grid.events || []).find((i) => i.id === q.instanceId);
    const template = q.kind === 'incontro' ? DnD.store.state.events.find((x) => x.id === q.encounter.refId) : null;
    if (!inst && !template) { dropPrompt(q.id); toast('⚠ Evento non più presente sulla mappa: saltato.', 'error'); render(); return; }
    eventWindow(inst, template, q);
  }

  // Finestra evento: testo, note del master, riferimenti mancanti, esiti delle prove scelti a mano.
  function eventWindow(inst, template, q) {
    const st = DnD.store.state;
    const ev = inst ? inst.event : template;
    const overrides = {};
    const miss = E.missingRefs(ev, st);
    const checks = checksOf(ev.actions);
    const manual = el('details', {}, el('summary', { text: '✎ Cambia esito a mano' }),
      checks.length ? checks.map((a) => el('label', { class: 'inline small' }, (a.save ? 'TS ' : '') + a.what + ' CD ' + a.dc + ' ',
        el('select', { onchange: (e) => { if (e.target.value) overrides[a.id] = e.target.value; else delete overrides[a.id]; } },
          opt('', 'Tira i dadi', true), opt('successo', 'Successo', false), opt('fallimento', 'Fallimento', false)))) : el('p', { class: 'muted small', text: 'Nessuna prova in questo evento.' }));
    const body = el('div', { class: 'form event-window' },
      el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(ev.icon, 40), el('div', {},
        el('b', { text: ev.name }), el('div', { class: 'muted small', text: (q ? 'Innesco: ' + q.reason : 'Interazione del master') + (inst && !E.isVisible(inst) ? ' · 🙈 nascosto ai giocatori' : '') }))),
      ev.readText ? el('blockquote', { class: 'event-read', text: E.interpolate(ev.readText, ex().variables) }) : null,
      ev.description ? el('p', { class: 'muted small', text: ev.description }) : null,
      ev.notes ? el('p', { class: 'event-notes', text: '🔒 ' + ev.notes }) : null,
      miss.length ? el('p', { class: 'warn-text small', text: '⚠ ' + miss.join('; ') + '. Le azioni interessate verranno saltate.' }) : null,
      el('p', { class: 'muted small', text: ev.actions.length + ' azioni: ' + ev.actions.map((a) => E.ACTION_NAMES[a.kind]).join(', ') }),
      manual);
    const done = () => { if (q) dropPrompt(q.id); };
    const dialog = openDialog('Evento', body, [
      { text: 'Rimanda', onclick: () => { snoozed = true; render(); } },
      { text: 'Salta', onclick: () => { done(); mutate((w) => X.log(w, '⏭ «' + ev.name + '» saltato dal master.', 'sistema'), false); afterAction(); } },
      { text: '▶ Esegui', class: 'primary', onclick: () => { done(); runEvent(inst, template, overrides); } },
    ]);
    dialog.classList.add('wide');
  }

  // Esegue un evento e mostra i testi; se l'evento prepara un combattimento, lo crea e apre il Combattimento.
  function runEvent(inst, template, overrides) {
    let res = null;
    let notes = [];
    const enteredBattle = mutate((w) => {
      const target = inst ? (w.grid.events || []).find((i) => i.id === inst.id) : { event: clone(template) };
      const gridBefore = w.ex.gridId;
      res = X.fireEvent(w, target, overrides);
      notes = res.notes || [];
      const now = gridOf(w.st, w.ex.gridId);
      return w.ex.gridId !== gridBefore && now && now.kind !== 'esplorazione' ? now : null;
    });
    if (notes.length) appendNotes(notes);
    const after = () => {
      const e = ex();
      if (e && e.pending && !e.pending.combatId) prepareCombat();
      else if (enteredBattle) battleOnMap();
      else afterAction();
    };
    if (res && res.texts.length) {
      openDialog('Ai giocatori', el('div', { class: 'form' }, res.texts.map((t) => el('blockquote', { class: 'event-read', text: t.text }))), [{ text: 'Continua', class: 'primary', onclick: () => { setTimeout(after); } }]);
    } else after();
  }

  // Note del master: le azioni «Nota» con l'opzione aggiungono righe alla pagina «Registro esplorazione».
  function appendNotes(lines) {
    DnD.store.update((st) => {
      const s = session(st);
      let page = s.pages.find((p) => p.name === 'Registro esplorazione');
      if (!page) page = DnD.note.addPage(s.pages, 'Registro esplorazione', DnD.dadi.uid());
      const e = s.exploration;
      page.html += DnD.note.textToHtml(lines.map((l) => 'Giorno ' + e.time.day + ', ' + hourText(e.time.hour) + ' — ' + l).join('\n'));
      page.updatedAt = new Date().toISOString();
    });
  }

  function encounterWindow(q) {
    const st = DnD.store.state;
    const npc = st.npcs.find((n) => n.id === q.encounter.refId);
    if (!npc) { dropPrompt(q.id); toast('⚠ Incontro: creatura non più presente.', 'error'); return; }
    // Difficoltà dell'incontro contro i membri del gruppo in esplorazione.
    const DF = DnD.difficolta;
    const difficulty = DnD.uiDifficolta.indicator({ title: 'Difficoltà', compact: true });
    difficulty.update({ party: DF.partyFrom(X.partyMembers(world())), creatures: [DF.group(npc, q.encounter.qty)] });
    openDialog('Incontro casuale', el('div', { class: 'form' },
      el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(npc.icon, 40), el('b', { text: q.encounter.qty + '× ' + npc.name })),
      difficulty.node,
      el('p', { class: 'muted small', text: 'd100 = ' + q.encounter.roll + '. Il master decide: combattimento, evitarlo (Salta) o rimandare.' })), [
      { text: 'Rimanda', onclick: () => { snoozed = true; render(); } },
      { text: 'Salta', onclick: () => { dropPrompt(q.id); mutate((w) => X.log(w, '⏭ Incontro con ' + npc.name + ' evitato.', 'incontro'), false); afterAction(); } },
      { text: '⚔ Prepara combattimento', class: 'primary', onclick: () => {
        dropPrompt(q.id);
        mutate((w) => {
          w.ex.pending = { kind: 'combattimento', gridId: w.ex.gridId, instanceId: '', name: 'Incontro con ' + npc.name, rest: [], combatId: '',
            action: E.normalizeAction({ kind: 'combattimento', foes: [{ npcId: npc.id, qty: String(q.encounter.qty) }], start: 'prepara' }) };
        }, false);
        prepareCombat();
      } },
    ]);
  }

  function interact(inst) {
    const w = world();
    const ctx = X.eventCtx(w);
    const can = E.canFire(inst, ctx);
    if (!can.ok && !confirm('«' + inst.event.name + '» non scatterebbe (' + can.reason + '). Aprirlo comunque?')) return;
    eventWindow(inst, null, null);
  }

  // ---------- Combattimento ----------
  // Griglia vuota dal bioma della cella del gruppo: sfondo del colore del bioma, zone di partenza ai lati.
  function biomeBattleGrid(w) {
    const p = X.activeParty(w.ex).pos;
    const b = X.biomeAt(w, p.x, p.y);
    return {
      id: '', name: 'Scontro' + (b ? ' — ' + b.name : ''), w: 20, h: 14, feetPerCell: 5, structures: [], items: [], labels: [], tileMap: null, positions: [],
      background: b ? { kind: 'colore', color: b.color } : null,
      zones: [{ id: DnD.dadi.uid(), kind: 'giocatori', x: 1, y: 4, w: 3, h: 6 }, { id: DnD.dadi.uid(), kind: 'nemici', x: 16, y: 4, w: 3, h: 6 }],
    };
  }
  function newCombat(w, foes, saved, start) {
    const st = w.st;
    const players = X.partyMembers(w).map((p) => clone(p));
    const entries = foes.map((f) => ({ npc: st.npcs.find((n) => n.id === f.npcId), quantity: Math.max(1, Math.min(50, (DnD.dadi.rollExpr(f.qty) || { total: 1 }).total)) })).filter((e) => e.npc);
    const combatants = R.createCombatants(players, entries, st.races, DnD.dadi.randomInt, st.spells, st.equipment);
    // PF dei personaggi: quelli dell'esplorazione.
    for (const c of combatants) if (c.kind === 'player' && w.ex.members[c.sourceId]) c.hp = Math.min(c.maxHp, w.ex.members[c.sourceId].hp);
    // Fazioni del Mondo: della scheda, del party (giocatori) o della città (nemici).
    const wv = DnD.fazioni.view(st);
    const fctx = { parties: wv.parties, cities: wv.cities, factions: wv.factions };
    for (const c of combatants) c.faction = DnD.fazioni.defaultFactionFor(c.kind === 'player' ? players.find((p) => p.id === c.sourceId) : st.npcs.find((n) => n.id === c.sourceId), c.kind === 'player' ? 'player' : 'npc', fctx);
    const combat = {
      id: DnD.dadi.uid(), phase: 'iniziativa', round: 1, currentId: null, combatants, log: [],
      ai: { simulated: false, mode: 'passo', delay: 1, seed: DnD.dadi.randomInt(2147483646) },
      grid: Object.assign({ structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false, sourceGridId: null }, G.gridProps({})),
    };
    G.applySavedGrid(combat, saved, DnD.dadi.uid);
    if (!saved.id) combat.grid.sourceGridId = null;
    if (start === 'avvia') {
      const sorted = R.sortByInitiative(combat.combatants);
      combat.phase = 'attivo';
      combat.currentId = R.firstTurn(sorted);
      for (const x of combat.combatants) DnD.movimento.resetTurn(x);
      DnD.dati.pushLog(combat, 'sistema', 'Inizia il combattimento (dall\'esplorazione). Ordine: ' + sorted.map((x) => x.name + ' (' + x.initiative + ')').join(', ') + '.');
      DnD.audio.suonaTutti(DnD.suoniDati.fromCombat(null, combat.log, combat)); // ingresso del boss
    }
    return combat;
  }
  function prepareCombat() {
    const w = world();
    const p = w.ex.pending;
    if (!p) return;
    if (session().combat && !confirm('C\'è già un combattimento in corso nella sessione: sostituirlo con quello dell\'evento?')) return;
    mutate((ww) => {
      const a = ww.ex.pending.action;
      const saved = a.gridId ? gridOf(ww.st, a.gridId) : null;
      if (a.gridId && !saved) X.log(ww, '⚠ La griglia di battaglia dell\'evento non esiste più: se ne usa una vuota dal bioma.', 'avviso');
      const combat = newCombat(ww, a.foes, saved || biomeBattleGrid(ww), a.start);
      session(ww.st).combat = combat;
      ww.ex.pending.combatId = combat.id;
      X.log(ww, '⚔ Combattimento preparato: ' + combat.combatants.filter((c) => c.kind !== 'player').map((c) => c.name).join(', ') + '.', 'combattimento');
    }, false);
    DnD.app.navigate('combattimento');
  }
  // Mappa di battaglia raggiunta con «Entra in una mappa»: combattimento sulla griglia con il solo gruppo.
  function battleOnMap() {
    const w = world();
    if (!w || !w.grid || w.grid.kind === 'esplorazione') return;
    if (!session().combat) {
      mutate((ww) => { session(ww.st).combat = newCombat(ww, [], ww.grid, 'prepara'); }, false);
    }
    DnD.app.navigate('combattimento');
  }

  // Banner nella sezione Combattimento quando il combattimento viene dall'esplorazione.
  function combatBanner() {
    const e = ex();
    if (!e) return null;
    const fromEvent = e.pending && e.pending.combatId && session().combat && session().combat.id === e.pending.combatId;
    const onBattle = (() => { const g = gridOf(DnD.store.state, e.gridId); return g && g.kind !== 'esplorazione'; })();
    if (!fromEvent && !onBattle) return null;
    return el('div', { class: 'panel explore-banner' },
      el('span', { text: fromEvent ? '🧭 Combattimento dall\'esplorazione: «' + e.pending.name + '».' : '🧭 Mappa di battaglia raggiunta dall\'esplorazione.' }),
      el('button', { type: 'button', class: 'btn small primary', text: '↩ Torna all\'esplorazione', onclick: () => backToExploration() }));
  }
  function backToExploration() {
    const c = session().combat;
    if (c) {
      if (!confirm('Terminare il combattimento e tornare all\'esplorazione?')) return;
      const ended = clone(c);
      DnD.store.update((st) => { session(st).combat = null; });
      onCombatEnded(ended);
      return;
    }
    leaveBattleMap();
    DnD.app.navigate('esplorazione');
  }
  function leaveBattleMap() {
    const e = ex();
    const g = e && gridOf(DnD.store.state, e.gridId);
    if (g && g.kind !== 'esplorazione' && e.stack.length) mutate((w) => { X.exitMap(w.ex); X.log(w, '↩ Il gruppo torna a «' + (gridOf(w.st, w.ex.gridId) || {}).name + '».', 'mappa'); }, false);
  }

  // Dopo «Termina combattimento»: PF dei personaggi, esito (vittoria, fuga, sconfitta) e ripresa delle azioni.
  function onCombatEnded(ended) {
    const e = ex();
    if (!e) return;
    const fromEvent = e.pending && ended && e.pending.combatId === ended.id;
    if (ended) DnD.store.update(() => {
      for (const c of ended.combatants) if (c.kind === 'player' && e.members[c.sourceId]) e.members[c.sourceId].hp = Math.max(0, Math.min(e.members[c.sourceId].maxHp, c.hp));
    });
    if (!fromEvent) { leaveBattleMap(); return; }
    const choose = (outcome) => {
      let res = null;
      mutate((w) => { res = X.resumeAfterCombat(w, outcome); }, false);
      leaveBattleMap();
      DnD.app.navigate('esplorazione');
      if (res && res.texts.length) openDialog('Ai giocatori', el('div', { class: 'form' }, res.texts.map((t) => el('blockquote', { class: 'event-read', text: t.text }))), [{ text: 'Continua', class: 'primary' }]);
      if (res && res.pause) prepareCombat(); else afterAction();
    };
    openDialog('Esito del combattimento', el('p', { text: '«' + e.pending.name + '»: come si è concluso? L\'esito va nel registro (variabile «esito combattimento») e l\'evento prosegue.' }), [
      { text: 'Sconfitta', onclick: () => choose('sconfitta') },
      { text: 'Fuga', onclick: () => choose('fuga') },
      { text: 'Vittoria', class: 'primary', onclick: () => choose('vittoria') },
    ]);
  }

  // ---------- Rendering ----------
  const hourText = (h) => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');

  function render(container) {
    root = container || root;
    if (!root) return;
    clear(root);
    const e = ex();
    if (!e) { renderSetup(); return; }
    renderActive();
  }

  function renderSetup() {
    const st = DnD.store.state;
    const maps = DnD.sessioni.visible(st, 'savedGrids').filter((g) => g.kind === 'esplorazione');
    const players = DnD.sessioni.visible(st, 'players');
    if (!maps.length) {
      root.append(DnD.ui.emptyState('Nessuna mappa di esplorazione',
        'Crea nell\'Editor griglie una griglia di tipo «Esplorazione», dipingi i biomi e piazza gli eventi; poi torna qui per partire.', [
          { text: 'Crea una mappa', primary: true, onclick: () => DnD.app.navigate('editor', 'nuovo') },
          { text: 'Biomi ed eventi (Asset)', onclick: () => DnD.app.navigate('asset') },
        ]));
      return;
    }
    if (!setup.gridId || !maps.some((m) => m.id === setup.gridId)) setup.gridId = maps[0].id;
    // Party attivo del Mondo: di base i suoi membri, con il suo nome e la sua icona sulla pedina del gruppo.
    const wv = DnD.fazioni.view(st);
    const party = DnD.party.active(wv.parties, wv.world);
    if (!setup.players.size) (party && party.memberIds.length ? players.filter((p) => party.memberIds.includes(p.id)) : players).forEach((p) => setup.players.add(p.id));
    const icon = DnD.uiIcone.iconPicker(setup.icon || (party ? party.icon : null) || { kind: 'library', icon: 'cavaliere', color: '#c9a227' }, false, 'Icona della pedina del gruppo');
    root.append(
      el('div', { class: 'section-head' }, el('h1', { text: 'Esplorazione' })),
      el('div', { class: 'grid-2' },
        el('section', { class: 'panel' }, el('h2', { text: 'Mappa' }),
          el('div', { class: 'card-grid' }, maps.map((m) => el('label', { class: 'card pick-card' + (m.id === setup.gridId ? ' selected' : '') },
            el('input', { type: 'radio', name: 'mappa-esplorazione', checked: m.id === setup.gridId, onchange: () => { setup.gridId = m.id; render(); } }),
            DnD.uiGriglia.gridThumbnail(m, 110), el('b', { text: m.name }),
            el('span', { class: 'muted small', text: m.w + '×' + m.h + ' · ' + X.scaleLabel(m.scale) + ' · ' + m.events.length + ' eventi' }))))),
        el('section', { class: 'panel' }, el('div', { class: 'history-head' }, el('h2', { text: 'Gruppo' }),
          party && party.memberIds.length ? el('button', { class: 'btn small', text: '⚑ Aggiungi party «' + party.name + '»', onclick: () => {
            setup.players.clear();
            party.marchOrder.forEach((id) => { if (players.some((p) => p.id === id)) setup.players.add(id); });
            setup.icon = party.icon;
            render();
          } }) : null),
          players.length ? el('ul', { class: 'pick-list' }, players.map((p) => el('li', {}, el('label', { class: 'check' },
            el('input', { type: 'checkbox', checked: setup.players.has(p.id), onchange: (ev) => { if (ev.target.checked) setup.players.add(p.id); else setup.players.delete(p.id); } }),
            ' ', el('b', { text: p.name }), el('span', { class: 'muted small', text: ' · PF ' + p.maxHp }))))) : el('p', { class: 'empty', text: 'Nessun giocatore nella sessione: crealo in Giocatori.' }),
          icon.node)),
      el('div', { class: 'form-actions' },
        el('button', { class: 'btn primary', text: '🧭 Inizia l\'esplorazione', onclick: () => {
          const r = icon.read();
          setup.icon = r.icon || null;
          const map = maps.find((m) => m.id === setup.gridId);
          // Ordine di marcia del party (se c'è), poi gli altri.
          const order = party ? party.marchOrder : [];
          const chosen = players.filter((p) => setup.players.has(p.id)).sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : 999) - (order.includes(b.id) ? order.indexOf(b.id) : 999));
          DnD.store.update((s) => {
            const e = X.create(map, chosen, DnD.dadi.randomInt(2147483646));
            if (setup.icon) e.parties[0].icon = setup.icon;
            if (party && chosen.length && chosen.every((p) => party.memberIds.includes(p.id))) e.parties[0].name = party.name;
            session(s).exploration = e;
            const w = { st: s, ex: e, grid: gridOf(s, map.id) };
            X.reveal(w);
            X.log(w, '🧭 Inizia l\'esplorazione di «' + map.name + '» con ' + (chosen.map((p) => p.name).join(', ') || 'nessun personaggio') + '.', 'sistema');
          });
          undoStack.length = 0;
          redoStack.length = 0;
          render();
        } })));
  }

  function memberCard(w, p) {
    const ms = X.memberState(w.ex, p.id, p);
    const pct = Math.round((ms.hp / ms.maxHp) * 100);
    const set = (fn) => { DnD.store.update(() => fn(X.memberState(ex(), p.id, p))); render(); };
    return el('article', { class: 'combatant player explore-member' },
      el('div', { class: 'combatant-head' },
        el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(p.icon, 26), el('h3', { text: p.name })),
        el('span', { class: 'muted small', text: ms.xp ? ms.xp + ' PE' : '' })),
      el('div', { class: 'hp' },
        el('div', { class: 'hp-text' }, el('b', { text: ms.hp + ' / ' + ms.maxHp }), ' PF ',
          numberInput(ms.hp, { class: 'qty', min: 0, max: ms.maxHp, 'aria-label': 'PF di ' + p.name, onchange: (e) => set((m) => { m.hp = Math.max(0, Math.min(m.maxHp, readNumber(e.target) || 0)); }) })),
        el('div', { class: 'hp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': ms.maxHp, 'aria-valuenow': ms.hp },
          el('div', { class: 'hp-fill ' + R.hpLevel(ms.hp, ms.maxHp), style: 'width:' + pct + '%' }))),
      el('div', { class: 'input-row' },
        el('label', { class: 'inline small' }, 'Sfinimento', el('select', { onchange: (e) => set((m) => { m.exhaustion = Number(e.target.value); }) }, [0, 1, 2, 3, 4, 5, 6].map((n) => opt(String(n), String(n), n === ms.exhaustion)))),
        el('select', { 'aria-label': 'Aggiungi condizione', onchange: (e) => { const c = e.target.value; if (c) set((m) => { if (!m.conditions.includes(c)) m.conditions.push(c); }); } },
          opt('', '+ condizione', true), DnD.creatureDati.CONDITIONS.map((c) => opt(c, c, false)))),
      ms.conditions.length ? el('div', { class: 'tag-row' }, ms.conditions.map((c) => el('button', { type: 'button', class: 'tag', title: 'Togli', text: c + ' ✕',
        onclick: () => set((m) => { m.conditions = m.conditions.filter((x) => x !== c); }) }))) : null);
  }

  function splitDialog(w) {
    const party = X.activeParty(w.ex);
    const members = X.partyMembers(w, party);
    if (members.length < 2) { toast('Servono almeno due personaggi nella pedina per dividere il gruppo.', 'error'); return; }
    const checks = members.map((m) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: m.id }), ' ' + m.name));
    openDialog('Dividi il gruppo', el('div', { class: 'form' }, el('p', { class: 'muted small', text: 'I personaggi scelti formano una nuova pedina nella stessa cella.' }), checks), [
      { text: 'Annulla' },
      { text: 'Dividi', class: 'primary', onclick: () => {
        const ids = checks.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
        const r = mutate((ww) => { const np = X.split(ww.ex, ids); if (np) X.log(ww, '👥 Il gruppo si divide: ' + np.name + '.', 'sistema'); return np; });
        if (!r) { toast('Scegli alcuni personaggi, non tutti.', 'error'); return false; }
        return undefined;
      } },
    ]);
  }

  function renderActive() {
    const w = world();
    const e = w.ex;
    if (!w.grid) {
      root.append(el('div', { class: 'panel' }, el('p', { text: '⚠ La mappa corrente dell\'esplorazione non esiste più.' }),
        el('div', { class: 'form-actions' },
          e.stack.length ? el('button', { class: 'btn', text: '↩ Torna alla mappa precedente', onclick: () => { DnD.store.update(() => X.exitMap(ex())); render(); } }) : null,
          el('button', { class: 'btn danger', text: 'Termina esplorazione', onclick: endExploration }))));
      return;
    }
    const party = X.activeParty(e);
    const here = X.biomeAt(w, party.pos.x, party.pos.y);
    const g = getGrid();
    const logList = el('ol', { class: 'log' }, e.log.map((l) => el('li', { class: 'log-' + l.kind },
      el('span', { class: 'log-round', text: 'G' + l.day + ' ' + hourText(l.hour) }), l.text, el('span', { class: 'muted small', text: ' · ' + l.place }))));
    const hours = numberInput(1, { class: 'qty', min: 0.25, max: 240, step: 0.25, 'aria-label': 'Ore da far passare' });
    const isBattle = w.grid.kind !== 'esplorazione';

    const left = [
      el('section', { class: 'panel' },
        el('div', { class: 'history-head' }, el('h2', { text: 'Pedine' }),
          el('div', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn small', text: 'Dividi…', onclick: () => splitDialog(w) }),
            e.parties.length > 1 ? el('button', { type: 'button', class: 'btn small', text: 'Riunisci', title: 'Riunisce le pedine nella stessa cella o adiacenti a quella attiva',
              onclick: () => { const n = mutate((ww) => { const k = X.merge(ww.ex); if (k) X.log(ww, '👥 Il gruppo si riunisce.', 'sistema'); return k; }); if (!n) toast('Nessuna pedina vicina da riunire.', 'error'); } }) : null)),
        el('ul', { class: 'pick-list' }, e.parties.map((p) => el('li', { class: p.id === party.id ? 'selected' : '' },
          el('label', { class: 'check' }, el('input', { type: 'radio', name: 'pedina-attiva', checked: p.id === party.id, onchange: () => { DnD.store.update(() => { ex().activeParty = p.id; }); render(); } }),
            ' ', DnD.icone.iconCanvas(p.icon, 20), ' ', el('b', { text: p.name }), el('span', { class: 'muted small', text: ' · ' + G.cellLabel(p.pos.x, p.pos.y) + ' · ' + p.memberIds.length + ' pers.' })))))),
      el('div', { class: 'combatants' }, X.partyMembers(w, party).map((p) => memberCard(w, p))),
      el('section', { class: 'panel' }, el('h2', { text: 'Scorte del gruppo' }),
        el('div', { class: 'input-row' },
          el('label', { class: 'inline small' }, '🍖 Cibo', numberInput(e.supplies.food, { class: 'qty', min: 0, step: 0.5, onchange: (ev) => { DnD.store.update(() => { ex().supplies.food = Math.max(0, readNumber(ev.target) || 0); }); render(); } })),
          el('label', { class: 'inline small' }, '💧 Acqua', numberInput(e.supplies.water, { class: 'qty', min: 0, step: 0.5, onchange: (ev) => { DnD.store.update(() => { ex().supplies.water = Math.max(0, readNumber(ev.target) || 0); }); render(); } }))),
        here ? el('p', { class: 'muted small', text: 'Consumo qui: ' + here.food + ' cibo e ' + here.water + ' acqua per persona al giorno.' }) : null),
    ];

    const pending = e.pending;
    const right = [
      el('section', { class: 'panel turn-panel explore-time' },
        el('div', { class: 'round' }, 'Giorno ', el('b', { text: String(e.time.day) }), ' · ', el('b', { text: hourText(e.time.hour) })),
        el('div', { class: 'muted small', text: (e.weather ? '🌦 ' + e.weather.name : '🌦 meteo non ancora tirato') }),
        el('div', { class: 'small' }, here ? [el('span', { class: 'biome-swatch', style: 'background:' + here.color }), ' ', el('b', { text: here.name }),
          ' · costo ' + (B.costFor(here, e.mode) || 'impraticabile') + ' · ' + (B.hoursFor(here, e.mode, e.pace, X.scaleKm(w.grid.scale)) || '—') + ' h/cella · ' + B.LIGHT_NAMES[here.light].toLowerCase()] : 'Nessun bioma in questa cella'),
        el('div', { class: 'input-row' },
          el('label', { class: 'inline small' }, 'Ritmo', el('select', { onchange: (ev) => { DnD.store.update(() => { ex().pace = ev.target.value; }); render(); } }, B.PACES.map((p) => opt(p, B.PACE_NAMES[p], p === e.pace)))),
          el('label', { class: 'inline small' }, 'Viaggio', el('select', { onchange: (ev) => { DnD.store.update(() => { ex().mode = ev.target.value; }); render(); } }, B.MODES.map((m) => opt(m, B.MODE_NAMES[m], m === e.mode))))),
        el('div', { class: 'input-row' }, hours,
          el('button', { class: 'btn primary', text: '⏩ Avanza tempo', onclick: () => {
            const h = readNumber(hours);
            if (!(h > 0)) { toast('Indica le ore.', 'error'); return; }
            mutate((ww) => { X.advanceTime(ww, h); X.log(ww, '⏩ Passano ' + h + ' ore.', 'tempo'); });
            afterAction();
          } })),
        el('div', { class: 'input-row' },
          el('button', { class: 'btn', text: '🛏 Riposo breve', disabled: DnD.uiRiposi.combatActive(), title: DnD.uiRiposi.combatActive() ? DnD.uiRiposi.BUSY : 'Dadi vita e risorse «riposo breve»; il tempo passa', onclick: () => restDialog('breve') }),
          el('button', { class: 'btn', text: '🛏 Riposo lungo', disabled: DnD.uiRiposi.combatActive(), title: DnD.uiRiposi.combatActive() ? DnD.uiRiposi.BUSY : 'PF, dadi vita, slot e risorse; consuma tempo e scorte, può arrivare un incontro', onclick: () => restDialog('lungo') })),
        e.queue.length ? el('button', { class: 'btn wide', text: '❗ Finestre in attesa (' + e.queue.length + ')', onclick: () => { snoozed = false; afterAction(); } }) : null,
        pending ? el('div', { class: 'explore-pending' }, el('span', { text: '⚔ «' + pending.name + '» in attesa del combattimento.' }),
          pending.combatId ? el('button', { class: 'btn small', text: 'Vai al Combattimento', onclick: () => DnD.app.navigate('combattimento') })
            : el('button', { class: 'btn small primary', text: 'Prepara', onclick: prepareCombat })) : null),
      el('details', { class: 'panel' }, el('summary', { text: 'Variabili della sessione (' + Object.keys(e.variables).length + ')' }),
        Object.keys(e.variables).length ? el('ul', { class: 'pick-list' }, Object.entries(e.variables).map(([k, v]) => el('li', {}, el('b', { text: k }), ' = ' + v,
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Elimina la variabile', onclick: () => { mutate(() => { delete ex().variables[k]; }); } })))) : el('p', { class: 'muted small', text: 'Nessuna variabile: le impostano gli eventi.' })),
      el('section', { class: 'panel log-panel' }, el('h2', { text: 'Registro' }), logList),
    ];

    const banner = isBattle ? el('div', { class: 'panel explore-banner' },
      el('span', { text: '⚔ «' + w.grid.name + '» è una mappa di battaglia: si gioca nel Combattimento.' }),
      el('button', { class: 'btn small primary', text: 'Combatti qui', onclick: battleOnMap }),
      e.stack.length ? el('button', { class: 'btn small', text: '↩ Esci', onclick: () => { mutate((ww) => { X.exitMap(ww.ex); X.log(ww, '↩ Il gruppo esce.', 'mappa'); }); } }) : null) : null;
    const center = el('div', { class: 'combat-center' }, banner, tools.node, g.node);
    const cols = DnD.uiCombattimento.columns({
      key: LAYOUT_KEY,
      left: { title: 'Gruppo', body: left },
      center,
      right: { title: 'Tempo e registro', head: [el('button', { type: 'button', class: 'btn small dice-inline', text: '🎲 Dadi', onclick: () => DnD.uiDadi.openPanel() })], body: right },
    });
    root.append(el('div', { class: 'combat-screen explore-screen' },
      el('div', { class: 'section-head' },
        el('div', {}, el('h1', { text: 'Esplorazione' }),
          el('span', { class: 'muted small', text: w.grid.name + (e.stack.length ? ' (dentro ' + e.stack.map((s) => (gridOf(w.st, s.gridId) || { name: '?' }).name).join(' › ') + ')' : '') + ' · ' + X.scaleLabel(w.grid.scale) })),
        el('div', { class: 'head-actions' },
          e.stack.length && !isBattle ? el('button', { class: 'btn', text: '↩ Esci dalla mappa', onclick: () => { mutate((ww) => { X.exitMap(ww.ex); X.log(ww, '↩ Il gruppo torna a «' + (gridOf(ww.st, ww.ex.gridId) || {}).name + '».', 'mappa'); }); } }) : null,
          el('button', { class: 'btn', text: 'Reimposta layout', onclick: () => cols.reset() }),
          el('button', { class: 'btn danger', text: 'Termina esplorazione', onclick: endExploration }))),
      cols.layout));
    tools.refresh();
    g.refresh();
    g.setSelectedCombatant(party.id);
    logList.scrollTop = logList.scrollHeight;
    setTimeout(afterAction);
  }

  function endExploration() {
    if (!confirm('Terminare l\'esplorazione? Tempo, scorte, variabili e registro della sessione verranno cancellati (le mappe conservano eventi e nebbia).')) return;
    DnD.store.update((st) => { session(st).exploration = null; });
    undoStack.length = 0;
    redoStack.length = 0;
    render();
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.esplorazione = { title: 'Esplorazione', render, reset: () => { if (tools) tools.reset(); snoozed = false; } };
  DnD.uiEsplorazione = { combatBanner, onCombatEnded, getGrid: () => grid, undo, redo, restDialog };
})(globalThis.DnD = globalThis.DnD || {});
