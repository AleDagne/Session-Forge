// Sezione Combattimento: setup, iniziativa e gestione dei turni. Il combattimento appartiene alla
// sessione corrente (sessione.combat). Nemici Standard e Creature (con azioni a pulsanti, multiattacco,
// ricarica, usi giornalieri, Resistenza leggendaria, azioni leggendarie e promemoria delle azioni di tana);
// i danni tengono conto di vulnerabilità, resistenze e immunità di ogni combattente.
// Combattimento simulato: i combattenti controllati dall'IA pianificano il turno con DnD.ia (funzioni pure)
// e il piano si esegue con le stesse funzioni dei comandi manuali (attacco, incantesimi, azioni delle creature).
// Boss: dopo ogni azione si controllano le soglie di fase (boss.js) e si mostrano barra in alto, ombra ed effetti.
// Suoni: mutate() traduce gli esiti già calcolati (nuove righe del log, PF dei giocatori, forme dei leggendari) in
// eventi sonori (dati/suoni.js) e li mette in coda; nei turni automatici dell'IA restano solo i principali.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast, openDialog, promptText } = DnD.ui;
  const R = DnD.regole;
  const M = DnD.creature;
  const G = DnD.griglia;
  const MAX_COPIES = 50;
  // Funzioni dei moduli sopra il combattimento (vedi registraAgganci in fondo).
  const agganci = { bannerEsplorazione: null, fineCombattimento: null, apriOnline: () => {}, disegnaPing: null };

  // Stato della schermata (radice, combattente selezionato, griglia, visione, dadi, IA, avvisi…): un solo oggetto,
  // così le sezioni in altri file (preparazione, incantesimi, azioni delle creature…) lo condividono.
  const S = {
    root: null,
    selectedId: null, // combattente selezionato (scheda e pedina)
    grid: null, // widget della griglia: creato una volta, così vista e annulla/ripeti sopravvivono ai render
    vision: null, // luce, visione e nebbia di guerra sulla griglia (ui-visione.js)
    diceRec: null,
    lastTiro: null, // ultimo tiro mostrato (gioco online: va anche ai giocatori)
    rngProva: null, // generatore deterministico (solo test.html, con online.dadiDiProva)
    pendingAggr: null, // { attackerId, targetIds } dell'azione ostile in corso (provocazioni, uccisioni)
    overNotified: null, // id del combattimento per cui si è già annunciata la fine
    sceneEndNotified: '', // combattimento ed esito della condizione di fine della scena già annunciati
    provoked: false,
    aiPlan: null, // { forId, round, plan } del turno in corso
    aiPaused: false, // modalità automatica in pausa
    aiBusy: false, // esecuzione in corso (animazione)
    aiTimer: null,
    hurtLines: [],
    setupInput: null,
  };
  const setup = { players: new Set(), npcs: {}, gridId: '', control: {}, faction: {}, simulated: false }; // selezione del setup (non persistita)

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
  // ---------- Condizioni e concentrazione (condizioni.js) ----------
  // Le condizioni sono una fonte di modificatori per attacchi, salvezze, velocità e azioni; la UI è in ui-condizioni.js.
  const C = DnD.condizioni;
  const RP = DnD.riposi;
  const UC = () => DnD.uiCondizioni;
  const customs = () => DnD.store.state.customConditions || [];
  const combatRules = () => DnD.impostazioni.combatRules();
  // Arma a distanza (dal catalogo); le armi scritte a mano contano come mischia entro 1 cella.
  const weaponRanged = (w) => { const e = w && w.equipmentId ? DnD.store.state.equipment.find((x) => x.id === w.equipmentId) : null; return Boolean(e && e.weapon && e.weapon.kind === 'distanza'); };
  // Modificatori delle condizioni per un attacco (base = modo scelto); la paura vale con la fonte in vista.
  function attackModsFor(a, t, ranged, base) {
    const distance = a.pos && t.pos ? G.tokenDistance(a, t) : null;
    let map = null;
    const canSee = (x, y) => { if (!x.pos || !y.pos) return true; map = map || IA.buildMap(aiState()); return IA.visible(map, x, y); };
    // Luce e visione: svantaggio contro chi non si vede (buio, fuori vista), vantaggio contro chi non vede.
    const vision = a.pos && t.pos ? V.attackVision(V.context(combat().grid, combat().combatants, { tilesets: DnD.tilemap.tilesetIndex(DnD.store.state.tilesets) }), a, t) : null;
    return C.attackMods(a, t, { melee: !ranged && (distance === null || distance <= 1), distance, base, byId, canSee, vision });
  }
  // ---------- Luce, visione e nebbia (visione.js) ----------
  const V = DnD.visione;
  // Dopo ogni modifica: sorgenti delle concentrazioni finite, nebbia dei giocatori (memoria, stanze, fantasmi).
  function visionAfter(c) {
    if (!c || !c.grid.vision) return;
    for (const line of V.pruneLinked(c.grid, c.combatants)) log(c, 'sistema', '✨ ' + line);
    for (const line of V.refreshFog(c.grid, c.combatants, { tilesets: DnD.tilemap.tilesetIndex(DnD.store.state.tilesets) }).lines) log(c, 'sistema', line);
  }
  // Luce sulla pedina: icona e nome del livello («☀ luce intensa»).
  function lightText(x) {
    if (!x.pos || !S.vision) return '';
    const lv = S.vision.levelAt(x.pos.x, x.pos.y);
    const src = x.light && x.light.on ? V.sourceById(x.light.kind) : null;
    return DnD.visioneDati.LEVEL_ICONS[lv] + ' ' + DnD.visioneDati.LEVEL_NAMES[lv].toLowerCase() + (src ? ' (' + src.icon + ' ' + src.name.toLowerCase() + ')' : '');
  }
  // Sorgente portata da una pedina: accendi, spegni o scegli quale (torcia, lanterna…).
  function lightDialog(x) {
    const sel = el('select', { 'aria-label': 'Sorgente di luce' }, el('option', { value: '', text: '— nessuna —' }),
      DnD.visioneDati.SOURCES.map((s) => el('option', { value: s.id, text: s.icon + ' ' + s.name + ' (' + s.bright + ' + ' + s.dim + ' ft' + (s.minutes ? ', ' + s.minutes + ' min' : '') + ')', selected: x.light && x.light.kind === s.id })));
    openDialog('Sorgente di luce di ' + x.name, el('div', { class: 'form' }, field('Porta', sel),
      el('p', { class: 'muted small', text: 'La torcia dura un\'ora di gioco (10 round = 1 minuto); spenta non si consuma.' })), [
      { text: 'Annulla' },
      { text: 'Applica', class: 'primary', onclick: () => mutate((c) => { const t = c.combatants.find((y) => y.id === x.id); const line = V.setCarried(t, sel.value, true); if (line) log(c, 'sistema', line); }) },
    ]);
  }
  // Azioni bloccate dalle condizioni (il master può permetterle): il motivo, oppure null.
  const blockedBy = (x) => (x.forceActions ? null : C.actionBlock(x));
  // Applica la condizione inflitta da un'azione o da un incantesimo a un bersaglio (con la riga nel log).
  function inflictOn(c, src, t, inflict, spell) {
    const data = C.inflictData(inflict, src, t, spell, customs());
    if (!data) return;
    const r = C.apply(t, data);
    if (r.line) log(c, r.ok ? 'condizione' : 'sistema', r.line);
  }
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
    DnD.audio.suona('passo');
    log(c, 'movimento', Mv.moveText(t, r.path.length - 1, r.cost, Mv.left(t, rules(), fpc()), fpc()) + (r.stopped ? ' Movimento esaurito.' : ''));
  }
  // Azioni di movimento: Scatto, Disimpegno, Rialzarsi, Annulla spostamento.
  // Restituisce { ok, testo } (riga del log o motivo del rifiuto); quiet: senza avvisi a schermo (gioco online).
  function moveAction(id, kind, quiet) {
    const x = byId(id);
    if (!x) return { ok: false, testo: 'Combattente non trovato.' };
    const no = (testo) => { if (!quiet) toast(testo, 'error'); return { ok: false, testo }; };
    if (kind === 'rialzati') {
      const probe = clone(x);
      const r = Mv.standUp(probe, rules(), fpc());
      if (!r.ok) return no('Non può rialzarsi: ' + r.reason + '.');
    }
    if (kind === 'annulla' && !Mv.movementOf(x).moves.length) return no(x.name + ' non si è ancora spostato in questo turno.');
    mutate((c) => {
      const t = c.combatants.find((y) => y.id === id);
      if (kind === 'scatto') { Mv.dash(t); log(c, 'movimento', t.name + ' usa Scatto (azione): +' + cellsText(Mv.speedCells(t, rules(), fpc())) + ', restano ' + cellsText(Mv.left(t, rules(), fpc())) + '.'); }
      else if (kind === 'disimpegno') { Mv.disengage(t); log(c, 'movimento', t.name + ' usa Disimpegno (azione): il suo movimento non provoca attacchi di opportunità in questo turno.'); }
      else if (kind === 'rialzati') { const r = Mv.standUp(t, rules(), fpc()); log(c, 'movimento', t.name + ' si rialza (costa ' + cellsText(r.cost) + '), restano ' + cellsText(Mv.left(t, rules(), fpc())) + '.'); }
      else if (kind === 'annulla') { const r = Mv.undoMoves(t); log(c, 'movimento', t.name + ' annulla lo spostamento: torna in ' + G.cellLabel(r.to.x, r.to.y) + ', restituite ' + cellsText(r.refunded) + '.'); }
    });
    return { ok: true, testo: combat().log[combat().log.length - 1].text };
  }
  function setMode(id, mode) {
    mutate((c) => {
      const t = c.combatants.find((y) => y.id === id);
      t.moveMode = mode;
      S.aiPlan = null;
      log(c, 'movimento', t.name + ': modalità di movimento ' + Mv.MODE_NAMES[mode].toLowerCase() + ' (' + Mv.feetIn(t, mode) + ' ft).');
    });
  }
  // Finestra delle condizioni (applica, modifica, togli, concentrazione, tiri contro la morte): ui-condizioni.js.
  function conditionsDialog(x) {
    UC().dialog(x.id, { mutate, log, byId, combatants: () => combat().combatants, after: () => { S.aiPlan = null; } });
  }
  // Riquadro del movimento nella scheda: velocità e residuo con il motivo, condizioni, azioni.
  function movementBox(x) {
    const m = Mv.movementOf(x);
    const prone = C.has(x, 'prono');
    return el('div', { class: 'move-box' + (limited(x) && !Mv.left(x, rules(), fpc()) ? ' empty' : '') },
      el('span', { class: 'small', text: speedText(x) }),
      el('div', { class: 'head-actions' },
        el('button', { type: 'button', class: 'btn small', text: '🏃 Scatto', title: blockedBy(x) || 'Aggiunge la velocità al residuo (usa l\'azione)', disabled: R.isDown(x) || Boolean(blockedBy(x)), onclick: () => moveAction(x.id, 'scatto') }),
        el('button', { type: 'button', class: 'btn small', text: '↩ Disimpegno', title: blockedBy(x) || 'Promemoria: niente attacchi di opportunità (usa l\'azione)', disabled: R.isDown(x) || m.disengaged || Boolean(blockedBy(x)), onclick: () => moveAction(x.id, 'disimpegno') }),
        prone ? el('button', { type: 'button', class: 'btn small', text: '⤒ Rialzati', title: 'Costa metà della velocità', onclick: () => moveAction(x.id, 'rialzati') }) : null,
        m.moves.length ? el('button', { type: 'button', class: 'btn small', text: '↶ Annulla spostamento', title: 'Torna alla posizione d\'inizio turno e restituisce il movimento', onclick: () => moveAction(x.id, 'annulla') }) : null,
        el('button', { type: 'button', class: 'btn small', text: '⚕ Condizioni…', onclick: () => conditionsDialog(byId(x.id)) })));
  }
  // Interruttore del master: nessun limite di velocità.
  const freeBox = el('input', { type: 'checkbox', onchange: (e) => mutate((c) => { c.freeMovement = e.target.checked; log(c, 'sistema', 'Movimento libero ' + (c.freeMovement ? 'attivo: nessun limite di velocità.' : 'disattivato.')); }) });

  // ---------- Dadi animati ----------
  // Ogni azione registra i dadi che tira (risultato deciso prima, con lo stesso generatore senza bias); finita
  // l'azione, l'overlay li mostra con il riepilogo. Il log ha già tutto anche se l'animazione è saltata o spenta.
  const dice = () => (S.diceRec ? S.diceRec.rng : DnD.dadi.randomInt);
  const beginDice = () => { S.diceRec = DnD.dadi.registratore(S.rngProva || undefined); };
  function endDice(label, text) {
    const r = S.diceRec;
    S.diceRec = null;
    if (!r) return;
    const c = combat();
    // Senza riepilogo: l'ultima riga del log (l'esito dell'azione).
    const last = c && c.log.length ? c.log[c.log.length - 1].text : '';
    // Turni automatici dell'IA: coda veloce, il gioco non rallenta.
    S.lastTiro = r.tiro(label, 'combattimento', { testo: text || last });
    if (S.lastTiro) DnD.uiDadi.mostraTiro(S.lastTiro, { veloce: Boolean(c && c.ai && c.ai.simulated && c.ai.mode === 'auto') });
  }

  // ---------- Combattimento simulato (IA) ----------
  const IA = DnD.ia;
  const KI = DnD.iaDati;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ---------- Mondo: fazioni, NPC neutrali, uccisioni per le quest, fine del combattimento ----------
  // La relazione tra fazioni (fazioni.relazioneCombattenti) è l'unica fonte di verità per IA, bersagli, avvisi
  // degli effetti ad area, provocazione degli NPC neutrali e fine del combattimento.
  const FZ = DnD.fazioni;
  const NP = DnD.npc;
  const DF = DnD.difficolta;
  const UD = DnD.uiDifficolta;
  const worldView = (st) => FZ.view(st || DnD.store.state);
  const relTable = (st) => FZ.table(worldView(st).factions);
  const factionName = (id) => { const f = worldView().factions.find((x) => x.id === id); return f ? f.name : 'fazione eliminata'; };
  const partyFaction = (st) => { const v = worldView(st); const p = DnD.party.active(v.parties, v.world); return p ? p.factionId : 'giocatori'; };
  const noteAggression = (attackerId, targetIds) => { S.pendingAggr = { attackerId, targetIds: targetIds.filter(Boolean) }; };

  // Copia di un NPC piazzata sulla griglia -> combattente (stessa posizione, PF e stato della copia).
  function npcItemToCombatant(st, it, hostile) {
    const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
    if (!npc) return null;
    const v = worldView(st);
    const source = Object.assign(clone(npc.stats), { id: npc.id, name: it.name || npc.name, icon: clone(it.icon) });
    const x = DnD.combattenti.createCombatants([], [{ npc: source, quantity: 1 }], st.races, dice(), st.spells, st.equipment)[0];
    const fid = NP.factionOf(npc, it.npcState, v.cities);
    const party = DnD.party.active(v.parties, v.world);
    const att = hostile ? 'ostile' : NP.attitudeOf(npc, it.npcState, FZ.reputationOf(v.world, party, fid));
    Object.assign(x, {
      faction: fid, pos: { x: it.x, y: it.y }, w: it.w, h: it.h, control: 'ia',
      npc: NP.combatData(npc, it.npcState, it.id, att),
      hostileTo: hostile ? [party ? party.factionId : 'giocatori'] : (it.npcState.hostileTo || []).slice(),
    });
    if (it.npcState.hp !== null) x.hp = Math.min(x.maxHp, it.npcState.hp);
    return x;
  }
  // Toglie la copia dalla griglia e mette il combattente; ostile = entra al round successivo (se il combattimento è attivo).
  function joinFromItem(c, st, it, hostile) {
    const x = npcItemToCombatant(st, it, hostile);
    if (!x) return null;
    c.grid.items = c.grid.items.filter((y) => y.id !== it.id);
    if (hostile && c.phase === 'attivo') x.joinRound = c.round + 1;
    c.combatants.push(x);
    return x;
  }

  // Provocazione: gli NPC non ostili colpiti (o che difendono la fazione o il party) diventano ostili secondo la
  // loro regola; con «fazione» e «città» anche le copie sulla griglia della stessa fazione o città entrano
  // ostili al round successivo. Penalità di reputazione e voce annullabile (world.provocations).
  function provocationFor(c, st, attacker, targets) {
    const t = relTable(st);
    const npcs = [];
    for (const tg of targets) for (const x of NP.reactions(attacker, tg, c.combatants, t)) if (!npcs.includes(x)) npcs.push(x);
    if (!npcs.length) return [];
    const v = worldView(st);
    const before = c.combatants.filter((x) => x.npc).map((x) => ({ id: x.id, hostileTo: (x.hostileTo || []).slice(), attitude: x.npc.attitude }));
    const res = NP.provoke(npcs, { combatants: c.combatants, factions: v.factions, symmetric: v.world.symmetric, attackerFaction: attacker.faction, attackerId: attacker.id });
    const lines = res.lines.slice();
    // Copie ancora sulla griglia: la città (o la fazione) intera si unisce, ostile, al round successivo.
    const joined = [];
    for (const x of npcs) {
      const rule = x.npc.provoke;
      if (rule !== 'citta' && rule !== 'fazione') continue;
      for (const it of c.grid.items.filter((y) => y.otype === 'npc' && !y.npcState.dead)) {
        const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
        if (!npc) continue;
        const same = rule === 'citta' ? npc.cityId && npc.cityId === x.npc.cityId : NP.factionOf(npc, it.npcState, v.cities) === x.faction;
        if (!same) continue;
        const y = joinFromItem(c, st, it, true);
        if (y) { y.hostileTo = [attacker.faction]; joined.push(y.name); }
      }
    }
    if (joined.length) lines.push('⚠ Si uniscono ostili' + (c.phase === 'attivo' ? ' dal round ' + (c.round + 1) : '') + ': ' + joined.join(', ') + '.');
    // Penalità di reputazione solo se chi attacca è dalla parte del party.
    const repIds = [];
    if (attacker.faction === partyFaction(st) || attacker.kind === 'player') {
      const party = DnD.party.active(v.parties, v.world);
      for (const r of res.reputation) {
        const e = FZ.changeReputation({ world: v.world, party }, r.factionId, r.delta, r.reason, 'combattimento');
        if (e) { repIds.push(e.id); lines.push('⚑ Reputazione con «' + factionName(r.factionId) + '»: ' + e.delta + ' (' + e.after + ').'); }
      }
    }
    v.world.provocations.push({ id: DnD.dadi.uid(), at: new Date().toISOString(), text: lines[0] || '', combatId: c.id,
      factions: Object.fromEntries(res.factionsBefore.map((f) => [f.id, f.relations])), combatants: before, repIds, reverted: false });
    if (v.world.provocations.length > 50) v.world.provocations.splice(0, v.world.provocations.length - 50);
    S.provoked = true;
    return lines;
  }

  // Annulla l'ultima provocazione che ha toccato il combattente (decisione del master).
  function revertProvocation(x) {
    const v = worldView();
    const pr = v.world.provocations.slice().reverse().find((p) => !p.reverted && p.combatId === combat().id && (p.combatants || []).some((b) => b.id === x.id));
    if (!pr) { toast('Nessuna provocazione da annullare.'); return; }
    mutate((c, st) => {
      const w = worldView(st);
      for (const [fid, rel] of Object.entries(pr.factions || {})) { const f = w.factions.find((y) => y.id === fid); if (f) f.relations = clone(rel); }
      for (const b of pr.combatants || []) { const y = c.combatants.find((z) => z.id === b.id); if (y && y.npc) { y.hostileTo = b.hostileTo; y.npc.attitude = b.attitude; } }
      for (const id of pr.repIds || []) FZ.revertReputation(w.world, st.parties, id);
      const p = w.world.provocations.find((y) => y.id === pr.id);
      if (p) p.reverted = true;
      S.aiPlan = null;
      log(c, 'sistema', '↶ Il master annulla la provocazione: ' + (pr.text || '') + ' (relazioni, ostilità e reputazione ripristinate).');
    });
  }
  // Calma (prova di Persuasione del giocatore scelto): l'NPC torna neutrale.
  function calmDialog(x) {
    const players = order().filter((y) => y.kind === 'player' && !R.isDown(y));
    const src = (y) => DnD.store.state.players.find((p) => p.id === y.sourceId);
    if (!players.length) { toast('Nessun giocatore in piedi per calmarlo.', 'error'); return; }
    const sel = el('select', {}, players.map((y) => el('option', { value: y.id, text: y.name })));
    openDialog('Calma ' + x.name, el('div', { class: 'form' }, field('Chi parla', sel), el('p', { class: 'muted small', text: 'Persuasione contro CD ' + x.npc.calmDc + '. Riuscita: torna neutrale (resta nell\'iniziativa ma non attacca).' })), [
      { text: 'Annulla' },
      { text: '🕊 Prova', class: 'primary', onclick: () => {
        const who = byId(sel.value);
        const p = src(who);
        beginDice();
        mutate((c) => {
          const t = c.combatants.find((y) => y.id === x.id);
          // Prova di Persuasione: le condizioni di chi parla (avvelenato, spaventato…) danno svantaggio.
          const r = R.rollSave({ bonus: p ? DnD.leggendario.checkBonus(p, 'Persuasione', false, DnD.store.state) : 0, mode: C.checkMods(who).mode, dc: t.npc.calmDc }, dice());
          log(c, r.success ? 'successo' : 'fallimento', who.name + ' prova a calmare ' + t.name + ': Persuasione ' + r.total + ' contro CD ' + t.npc.calmDc + ' → ' + (r.success ? NP.calm(t) : 'non ci riesce.'));
          S.aiPlan = null;
        });
        endDice('Calma ' + x.name, '');
      } },
    ]);
  }

  // Dopo ogni modifica: provocazioni, uccisioni (quest e reputazione), fine del combattimento per fazioni.
  function worldAfter(c, st, beforeHp, aggr) {
    const lines = [];
    const attacker = aggr ? c.combatants.find((x) => x.id === aggr.attackerId) : null;
    if (attacker) lines.push(...provocationFor(c, st, attacker, aggr.targetIds.map((id) => c.combatants.find((x) => x.id === id)).filter(Boolean)));
    const v = worldView(st);
    const pf = partyFaction(st);
    for (const x of c.combatants) {
      if (!(beforeHp.get(x.id) > 0 && x.hp === 0)) continue;
      lines.push(...DnD.quest.onKill(v.world.quests, v.quests, x));
      // Uccidere un NPC di una fazione: la reputazione con quella fazione scende (se è stato il party).
      if (x.npc && attacker && (attacker.faction === pf || attacker.kind === 'player') && x.faction !== pf) {
        const e = FZ.changeReputation({ world: v.world, party: DnD.party.active(v.parties, v.world) }, x.faction, DnD.mondoDati.REP_EVENTS.uccidiMembro, 'ucciso ' + x.name, 'combattimento');
        if (e) lines.push('⚑ Reputazione con «' + factionName(x.faction) + '»: ' + e.delta + ' (' + e.after + ').');
      }
    }
    // Combattimento da una scena: condizioni di fine dell'incontro (vittoria, sconfitta, fuga, round, obiettivo).
    const fromScene = c.phase === 'attivo' ? DnD.scene.ofCombat(st, c) : null;
    const end = fromScene ? DnD.scene.endCheck(c, fromScene.enc, relTable(st), pf) : null;
    if (end && S.sceneEndNotified !== c.id + end.outcome) {
      S.sceneEndNotified = c.id + end.outcome;
      lines.push('🎬 Condizione di fine dell\'incontro: ' + DnD.sceneDati.OUTCOME_NAMES[end.outcome] + ' (' + end.text + '). Termina il combattimento per il riepilogo della scena.');
    }
    if (c.phase === 'attivo' && S.overNotified !== c.id) {
      const over = FZ.combatOver(c.combatants, relTable(st), pf);
      if (over.over) {
        S.overNotified = c.id;
        lines.push('🏁 Tutte le fazioni ostili al party sono sconfitte o in fuga: il combattimento può terminare.');
      }
    }
    for (const l of lines) log(c, l.startsWith('📜') ? 'quest' : 'sistema', l);
    return lines;
  }

  // Cambio di fazione in gioco (anche a metà combattimento), con la fazione precedente per l'annullamento.
  function factionDialog(x) {
    const sel = el('select', {}, worldView().factions.map((f) => el('option', { value: f.id, text: f.name, selected: f.id === x.faction })));
    openDialog('Fazione di ' + x.name, el('div', { class: 'form' }, field('Fazione', sel),
      el('p', { class: 'muted small', text: 'La relazione tra le fazioni decide chi è alleato, neutrale o ostile (Mondo › Fazioni).' })), [
      { text: 'Annulla' },
      { text: 'Cambia', class: 'primary', onclick: () => {
        if (sel.value === x.faction) return undefined;
        mutate((c) => {
          const t = c.combatants.find((y) => y.id === x.id);
          t.prevFaction = t.faction;
          t.faction = sel.value;
          S.aiPlan = null;
          log(c, 'sistema', '⚑ ' + t.name + ' cambia fazione: ' + factionName(t.prevFaction) + ' → ' + factionName(t.faction) + '.');
        });
        return undefined;
      } },
    ]);
  }
  function undoFaction(id) {
    mutate((c) => {
      const t = c.combatants.find((y) => y.id === id);
      if (!t || !t.prevFaction) return;
      const from = t.faction;
      t.faction = t.prevFaction;
      t.prevFaction = '';
      S.aiPlan = null;
      log(c, 'sistema', '↶ ' + t.name + ' torna alla fazione ' + factionName(t.faction) + ' (era ' + factionName(from) + ').');
    });
  }
  // Effetto ad area: chiede conferma se colpisce chi non è ostile a chi lo usa.
  function confirmArea(casterId, targetIds) {
    const caster = byId(casterId);
    if (!caster) return true;
    const warn = FZ.areaWarnings(caster, targetIds.map(byId).filter(Boolean), relTable());
    return !warn.length || confirm('Attenzione: l\'area colpisce anche ' + warn.map((w) => w.name + ' (' + DnD.mondoDati.LEVEL_NAMES[w.level].toLowerCase() + ')').join(', ') + '. Continuare?');
  }
  const aiHistory = IA.turnHistory(); // annulla/ripeti: un intero turno IA = una sola azione
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
    if (!S.grid) {
      S.vision = DnD.uiVisione.create({ getDoc: () => combat(), widget: () => S.grid, mode: 'combattimento' });
      S.grid = DnD.uiGriglia.create({
        getDoc: combat,
        // Spostamenti e strumenti della griglia: la nebbia dei giocatori si aggiorna subito.
        update: (fn) => DnD.store.update(() => { fn(combat()); visionAfter(combat()); }),
        painter: S.vision.painter,
        vision: S.vision,
        tools: ['seleziona', 'misura'],
        showCombatants: true,
        onSelect: (id) => selectCombatant(id, 'grid'),
        tokenActions,
        movement: { begin: movementBegin, apply: movementApply },
        turnInfo: (x) => speedText(x, true) + (lightText(x) ? ' · ' + lightText(x) : ''),
        // Residuo sopra la pedina di turno; anteprima del piano dell'IA: percorso tratteggiato e bersagli evidenziati.
        overlay: (ctx, view, s) => {
          if (agganci.disegnaPing) agganci.disegnaPing(ctx, view, s);
          const c = combat();
          const cur = c && c.currentId ? byId(c.currentId) : null;
          if (cur && cur.pos && limited(cur)) DnD.uiIa.drawBadge(ctx, view, s, cur, '🦶 ' + Mv.left(cur, rules(), fpc()));
          if (!c || !aiOn() || !S.aiPlan || S.aiPlan.forId !== c.currentId) return;
          const col = DnD.uiTileset.colors();
          DnD.uiIa.drawPlan(ctx, view, s, S.aiPlan.plan, c.combatants, { current: col.accent, bad: '#d4453a' });
        },
        onObject: (id) => DnD.uiOggettiMappa.openPanel({
          // Copie degli NPC: Attacca (diventa ostile, entra al round successivo) o Entra nell'iniziativa (neutrale).
          combat: {
            attack: (itemId) => {
              beginDice();
              mutate((c, st) => {
                const it = c.grid.items.find((x) => x.id === itemId);
                if (!it) return;
                const x = joinFromItem(c, st, it, false);
                if (!x) return;
                log(c, 'sistema', '⚔ Il party attacca ' + x.name + '.');
                const probe = { id: '__party', faction: partyFaction(st), kind: 'player' };
                for (const l of provocationFor(c, st, probe, [x])) log(c, 'sistema', l);
                if (c.phase === 'attivo') { x.joinRound = c.round + 1; log(c, 'sistema', x.name + ' tira l\'iniziativa (' + x.initiative + ') ed entra al round ' + x.joinRound + '.'); }
                S.aiPlan = null;
              });
              endDice('Iniziativa', '');
              document.querySelectorAll('dialog[open]').forEach((d) => d.close());
            },
            join: (itemId) => {
              beginDice();
              mutate((c, st) => {
                const it = c.grid.items.find((x) => x.id === itemId);
                const x = it ? joinFromItem(c, st, it, false) : null;
                if (x) log(c, 'sistema', x.name + ' entra nel combattimento (neutrale, iniziativa ' + x.initiative + ').');
              });
              endDice('Iniziativa', '');
            },
          },
          getItem: () => combat() && combat().grid.items.find((x) => x.id === id),
          // Porte aperte e luci accese: la nebbia (stanze, celle viste) si aggiorna subito.
          update: (fn) => { DnD.store.update((st) => { const c = session(st).combat; fn(c.grid.items.find((x) => x.id === id), st); visionAfter(c); }); render(); },
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
          S.vision.quickBar(),
        ],
      });
    }
    updateOriginalBtn.hidden = !originalGrid();
    freeBox.checked = Boolean(combat() && combat().freeMovement);
    return S.grid;
  }

  // Seleziona un combattente evidenziando scheda e pedina. source: 'card' | 'grid' | 'list'.
  function selectCombatant(id, source) {
    S.selectedId = id;
    for (const card of S.root.querySelectorAll('.combatant')) card.classList.toggle('selected', card.dataset.id === id);
    if (source !== 'grid' && S.grid) S.grid.setSelectedCombatant(id);
    if (source !== 'card' && id) {
      const card = S.root.querySelector('.combatant[data-id="' + id + '"]');
      if (card) card.scrollIntoView({ behavior: DnD.ui.scrollBehavior(), block: 'nearest' });
    }
  }

  function tokenActions(id) {
    const x = byId(id);
    if (!x) return [];
    return [
      x.creature ? { text: '🐉 Azioni della creatura…', disabled: R.isDown(x) || Boolean(blockedBy(x)), onclick: () => selectCombatant(id, 'list') } : null,
      { text: '⚔ Attacca', disabled: R.isDown(x) || !x.weapons.length || combat().combatants.length < 2 || Boolean(blockedBy(x)), onclick: () => attackDialog(byId(id)) },
      { text: '✚ Cura', onclick: () => healDialog(byId(id)) },
      { text: '🛡 Tiro salvezza', onclick: () => saveDialog(byId(id)) },
      x.spellcasting ? { text: '✨ Lancia incantesimo', disabled: R.isDown(x) || !x.spellcasting.spells.length || Boolean(blockedBy(x)), onclick: () => castDialog(byId(id)) } : null,
      { text: '✎ Modifica', onclick: () => editDialog(byId(id)) },
      { text: '↔ Dimensione sulla griglia…', onclick: () => resizeDialog(byId(id)) },
      ...Mv.MODES.filter((mode) => mode !== Mv.modeOf(x)).map((mode) => {
        const ft = Mv.feetIn(x, mode);
        const banned = ft <= 0 && mode !== 'cammina' && rules().missingMode === 'vietato';
        return { text: Mv.MODE_ICONS[mode] + ' Modalità: ' + Mv.MODE_NAMES[mode].toLowerCase() + (ft > 0 ? ' (' + ft + ' ft)' : mode === 'cammina' ? '' : banned ? ' (nessuna velocità)' : ' (costo doppio)'),
          disabled: banned, onclick: () => setMode(id, mode) };
      }),
      { text: '🏃 Scatto', disabled: R.isDown(x) || Boolean(blockedBy(x)), onclick: () => moveAction(id, 'scatto') },
      C.has(x, 'prono') ? { text: '⤒ Rialzati (metà velocità)', onclick: () => moveAction(id, 'rialzati') } : null,
      Mv.movementOf(x).moves.length ? { text: '↶ Annulla spostamento', onclick: () => moveAction(id, 'annulla') } : null,
      { text: '⚕ Condizioni e concentrazione…', onclick: () => conditionsDialog(byId(id)) },
      x.light ? { text: x.light.on ? '🌑 Spegni: ' + V.sourceById(x.light.kind).name.toLowerCase() : '🔥 Accendi: ' + V.sourceById(x.light.kind).name.toLowerCase(),
        onclick: () => mutate((c) => { const t = c.combatants.find((y) => y.id === id); log(c, 'sistema', V.setCarried(t, t.light.kind)); }) }
        : { text: '🔥 Accendi una torcia', onclick: () => mutate((c) => { const t = c.combatants.find((y) => y.id === id); log(c, 'sistema', V.setCarried(t, 'torcia', true)); }) },
      { text: '🔦 Sorgente di luce…', onclick: () => lightDialog(byId(id)) },
      { text: x.ignoreSpeed ? '🦶 Rispetta la velocità' : '🦶 Ignora velocità', onclick: () => mutate((c) => {
        const t = c.combatants.find((y) => y.id === id);
        t.ignoreSpeed = !t.ignoreSpeed;
        log(c, 'sistema', t.name + ': ' + (t.ignoreSpeed ? 'ignora la velocità (movimento libero).' : 'rispetta di nuovo la velocità.'));
      }) },
      { text: x.control === 'ia' ? '👤 Controllo: passa a Manuale' : '🤖 Controllo: passa all\'IA', onclick: () => mutate((c) => {
        const t = c.combatants.find((y) => y.id === id);
        t.control = t.control === 'ia' ? 'manuale' : 'ia';
        S.aiPlan = null;
        log(c, 'sistema', t.name + ': controllo ' + (t.control === 'ia' ? 'IA' : 'manuale') + '.');
      }) },
      { text: '⚑ Fazione: ' + factionName(x.faction) + '…', onclick: () => factionDialog(byId(id)) },
      x.prevFaction ? { text: '↶ Torna a ' + factionName(x.prevFaction), onclick: () => undoFaction(id) } : null,
      x.npc && x.hostileTo && x.hostileTo.length ? { text: '🕊 Calma ' + x.name + '…', onclick: () => calmDialog(byId(id)) } : null,
      x.npc && x.hostileTo && x.hostileTo.length ? { text: '↶ Annulla la provocazione', onclick: () => revertProvocation(byId(id)) } : null,
      { text: x.hidden ? '👁 Non più nascosto' : '🙈 Nascosto (l\'IA non lo vede)', onclick: () => mutate((c) => { const t = c.combatants.find((y) => y.id === id); t.hidden = !t.hidden; S.aiPlan = null; }) },
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
  // Danni a 0 PF (tiri contro la morte) e concentrazione: salvezza su COS con CD max(10, metà del danno).
  function hurt(t, amount, crit) {
    const wasZero = t.hp <= 0;
    // PF temporanei (riposi.js): assorbono il danno per primi.
    const tmp = DnD.riposi.absorbTemp(t, amount);
    if (tmp.absorbed) S.hurtLines.push('🛡 ' + t.name + ': i PF temporanei assorbono ' + tmp.absorbed + ' danni (ne restano ' + (t.tempHp || 0) + ').');
    S.hurtLines = S.hurtLines.concat(DnD.leggendario.damage(t, tmp.rest));
    if (!(amount > 0)) return;
    if (wasZero) S.hurtLines.push(...C.damageAtZero(t, crit));
    if (t.hp > 0 && t.concentration) {
      const r = C.concentrationCheck(t, amount, dice());
      S.hurtLines.push({ type: r.kept ? 'tiro-salvezza' : 'ts-fallito', text: r.line });
      if (!r.kept) S.hurtLines.push(...C.endConcentration(t, combat().combatants, 'danno').lines.map((text) => ({ type: 'concentrazione', text })));
    }
  }
  // Dopo ogni azione: chi scende a 0 PF (privo di sensi e tiri contro la morte, o nemico che muore), chi torna
  // sopra 0 e le concentrazioni che finiscono da sole (0 PF, incapacitato).
  function conditionsAfter(c, beforeHp) {
    for (const x of c.combatants) {
      const before = beforeHp.has(x.id) ? beforeHp.get(x.id) : x.hp;
      if (before > 0 && x.hp <= 0) for (const line of C.dropToZero(x, combatRules())) log(c, 'sistema', line);
      const ds = C.normalizeDeathSaves(x.deathSaves);
      if (x.hp > 0 && (ds.active || ds.stable || x.dead || C.normalizeList(x.conditions).some((e) => e.auto === 'zero'))) {
        C.revive(x);
        x.dead = false;
        if (ds.active || ds.stable) log(c, 'sistema', x.name + ' torna cosciente.');
      }
      const why = C.concentrationBreaker(x);
      if (why) for (const line of C.endConcentration(x, c.combatants, why).lines) log(c, 'concentrazione', line);
    }
  }

  function mutate(fn) {
    let events = [];
    let sounds = [];
    let fast = false;
    const aggr = S.pendingAggr;
    S.pendingAggr = null;
    S.provoked = false;
    DnD.store.update((st) => {
      const prev = session(st).combat;
      const beforeHp = new Map(prev ? prev.combatants.map((x) => [x.id, x.hp]) : []);
      const before = DnD.suoniDati.combatSnapshot(prev);
      const lastLine = prev && prev.log.length ? prev.log[prev.log.length - 1] : null;
      fn(session(st).combat, st);
      if (S.hurtLines.length && session(st).combat) for (const line of S.hurtLines) log(session(st).combat, line.type || 'sistema', line.text || line);
      S.hurtLines = [];
      // Mondo: provocazioni degli NPC neutrali, uccisioni (quest, reputazione) e fine per fazioni.
      const c = session(st).combat;
      if (c) conditionsAfter(c, beforeHp);
      if (c) visionAfter(c);
      if (c) worldAfter(c, st, beforeHp, aggr);
      // Boss: passaggi di fase e sconfitte (anche più fasi con un solo colpo), con le note nel log.
      if (c && c.phase === 'attivo') events = DnD.boss.checkCombat(c, (type, text) => log(c, type, text));
      if (c) {
        sounds = DnD.suoniDati.fromCombat(before, c.log.slice(c.log.lastIndexOf(lastLine) + 1), c);
        fast = Boolean(c.ai && c.ai.simulated && c.ai.mode === 'auto');
      }
    });
    DnD.audio.suonaTutti(sounds, { veloce: fast });
    if (S.provoked) { S.aiPlan = null; if (DnD.uiMondo) DnD.uiMondoComuni.sound('ostile'); toast('Un NPC neutrale diventa ostile (vedi il log).'); }
    if (events.some((e) => e.kind === 'fase')) S.aiPlan = null;
    render();
    DnD.uiBoss.playEvents(events, S.root && S.root.querySelector('.combat-layout'));
  }

  function log(c, type, text) {
    DnD.dati.pushLog(c, type, text);
  }

  function render(container) {
    S.root = container || S.root;
    if (!S.root) return;
    clear(S.root);
    if (!combat()) renderSetup();
    else if (combat().phase === 'iniziativa') renderInitiative();
    else renderActive();
  }

  // Setup: in ui-combattimento-preparazione.js (DnD.uiCombattimentoPreparazione).
  const {
    renderInitiative, renderSetup,
  } = DnD.uiCombattimentoPreparazione.preparazione({
    DF, FZ, G, IA, M, MAX_COPIES, Mv, NP, R, S, UD, agganci, aiHistory, beginDice, byId, dice, el, endDice, field, joinFromItem, log, mutate, numberInput, order, partyFaction, readNumber, relTable, render, rules, session, setup, showErrors, startTurnOf, toast, worldView,
  });

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
    // Condizioni «fino all'inizio del turno di…», tiri contro la morte e promemoria delle azioni bloccate.
    for (const line of C.startTurn(c.combatants, nextId)) log(c, 'sistema', line);
    if (C.dying(cur)) log(c, 'sistema', C.deathSave(cur, dice()).line);
    else if (C.actionBlock(cur) && cur.hp > 0) log(c, 'sistema', '⚠ ' + cur.name + ': ' + C.actionBlock(cur) + (cur.forceActions ? ' (il master le permette).' : '.'));
    // Trasformazione leggendaria: la durata scende all'inizio del turno.
    for (const line of DnD.leggendario.tick(cur)) log(c, 'sistema', line);
    if (cur.creature) for (const line of M.startTurn(cur.creature, dice())) log(c, 'sistema', line);
  }

  function nextTurn() {
    beginDice();
    mutate((c) => {
      const sorted = R.sortByInitiative(c.combatants);
      const res = R.nextTurn(sorted, c.currentId, c.round);
      if (res.currentId === c.currentId && res.round === c.round) return;
      const newRound = res.round !== c.round;
      // Fine del turno di chi ha appena giocato: durate in round, salvezze ripetute, «fino alla fine del turno di…».
      if (c.currentId) for (const line of C.endTurn(c.combatants, c.currentId, dice())) log(c, 'sistema', line);
      if (newRound) log(c, 'round', '— Round ' + res.round + ' —');
      // Torce e sorgenti a durata: un round = 6 secondi di gioco.
      if (newRound) for (const line of V.tickLights(c.grid, c.combatants, DnD.visioneDati.ROUND_MINUTES)) log(c, 'sistema', '🔥 ' + line);
      // NPC diventati ostili: entrano nell'ordine di iniziativa da questo round.
      if (newRound) for (const x of c.combatants.filter((y) => y.joinRound && y.joinRound <= res.round)) { x.joinRound = 0; log(c, 'sistema', x.name + ' entra nell\'ordine di iniziativa.'); }
      const prev = c.currentId;
      c.round = res.round;
      c.currentId = res.currentId;
      startTurnOf(c, sorted, prev, c.currentId, newRound);
    });
    const cur = combat() && combat().currentId ? byId(combat().currentId) : null;
    endDice(cur ? 'Ricarica di ' + cur.name : 'Ricarica', '');
  }

  // PE dei nemici sconfitti (creature dal GS; gli NPC contano solo se ostili al party).
  function defeatedXp(c) {
    const t = relTable();
    const pf = partyFaction();
    return c.combatants.filter((x) => R.isDown(x) && x.creature && x.faction !== pf && NP.countsForXp(x, t, pf) && FZ.ostili({ id: '__p', faction: pf }, x, t))
      .reduce((n, x) => n + M.xpForCr(x.creature.cr), 0);
  }
  function endCombat() {
    if (!confirm('Terminare il combattimento? Il log e lo stato dei combattenti verranno cancellati.')) return;
    const xp = defeatedXp(combat());
    const ended = JSON.parse(JSON.stringify(combat()));
    const outcome = DnD.suoniDati.combatOutcome(ended);
    const playerIds = ended.combatants.filter((x) => x.kind === 'player' && x.sourceId).map((x) => x.sourceId);
    if (xp) toast('PE dei nemici sconfitti: ' + xp + ' (da dividere tra il party).', 'success');
    // Lo stato dei giocatori (PF, PF temporanei, dadi vita, sfinimento, risorse) torna sulla scheda.
    mutate((c, st) => {
      for (const x of c.combatants) { const p = x.kind === 'player' ? st.players.find((q) => q.id === x.sourceId) : null; if (p) DnD.riposi.syncBack(x, p); }
      session(st).combat = null;
    });
    if (outcome) DnD.audio.suona(outcome);
    toast('Combattimento terminato.');
    // Combattimento preparato da un evento dell'esplorazione: esito e ritorno all'esplorazione.
    if (agganci.fineCombattimento) agganci.fineCombattimento(ended);
    // Combattimento lanciato da una scena: riepilogo, ricompense, esito e scena successiva (con il riposo breve).
    if (ended.scene && DnD.uiScene) { DnD.uiScene.onCombatEnded(ended, playerIds); return; }
    // Proposta rapida: riposo breve dei giocatori del combattimento.
    if (playerIds.length) openDialog('Combattimento terminato', el('p', { text: 'Riposo breve ora? I giocatori possono spendere i dadi vita.' }), [
      { text: 'No' },
      { text: '🛏 Riposo breve', class: 'primary', onclick: () => { setTimeout(() => DnD.uiRiposi.restPlayers('breve', playerIds), 0); } },
    ]);
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
    const weapon = el('select', {}, attacker.weapons.map((w) => el('option', { value: w.id, text: DnD.uiCreatureComuni.weaponLabel(w), selected: w.id === preset.weaponId })));
    const mode = (value, label) => el('label', { class: 'check' },
      el('input', { type: 'radio', name: 'modo', value, checked: value === (preset.mode || R.MODES.normale) }), ' ' + label);
    const currentMode = () => body.querySelector('input[name="modo"]:checked').value;
    const pickButton = S.grid && S.grid.hasTokens() && S.grid.node.isConnected
      ? el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
        const keep = { targetId: target.value, weaponId: weapon.value, mode: currentMode() };
        dialog.dismiss();
        S.grid.pickTarget((id) => {
          const a = byId(attacker.id);
          if (!a) return;
          attackDialog(a, Object.assign(keep, id && id !== attacker.id ? { targetId: id } : {}));
        });
      } })
      : null;
    const distance = el('p', { class: 'muted small', 'aria-live': 'polite' });
    const modsLine = el('p', { class: 'small cond-preview', 'aria-live': 'polite' });
    const showDistance = () => {
      const t = byId(target.value);
      const dd = t ? G.tokenDistance(attacker, t) : null;
      distance.textContent = dd === null ? '' : 'Distanza (tra le celle più vicine): ' + G.formatDistance(dd, combat().grid.feetPerCell);
      // Anteprima delle condizioni: «vantaggio: bersaglio prono, entro 1 cella».
      const w = attacker.weapons.find((x) => x.id === weapon.value);
      const m = t && body ? attackModsFor(attacker, t, weaponRanged(w), currentMode()) : null;
      modsLine.textContent = m && (m.adv.length || m.dis.length || m.autoCrit || m.blocked) ? '🌀 ' + C.modsText(m) + (m.mode !== currentMode() ? ' → tiro ' + m.mode : '') : '';
    };
    target.addEventListener('change', showDistance);
    weapon.addEventListener('change', showDistance);
    const body = el('div', { class: 'form', onchange: (e) => { if (e.target.name === 'modo') showDistance(); } },
      el('div', { class: 'target-row' }, field('Bersaglio', target), pickButton),
      distance,
      field('Arma', weapon),
      el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro' }),
        mode(R.MODES.normale, 'Normale'), mode(R.MODES.vantaggio, 'Vantaggio'), mode(R.MODES.svantaggio, 'Svantaggio')),
      modsLine);
    showDistance();

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
    const names = [byId(attackerId), byId(targetId)].map((x) => (x ? x.name : ''));
    beginDice();
    noteAggression(attackerId, [targetId]);
    mutate((c) => {
      const a = byId(attackerId);
      const t = byId(targetId);
      const w = a && a.weapons.find((x) => x.id === weaponId);
      if (!a || !t || !w) return;
      // Condizioni: vantaggio e svantaggio da più fonti, critico automatico, attacco impossibile (affascinato).
      const mods = attackModsFor(a, t, weaponRanged(w), mode);
      if (mods.blocked) { log(c, 'sistema', a.name + ' non attacca ' + t.name + ': ' + mods.blocked + '.'); summary = a.name + ': ' + mods.blocked + '.'; return; }
      const res = R.resolveAttack({ toHit: w.toHit, targetAC: t.ac, damageDice: w.damageDice, damageBonus: w.damageBonus, mode: mods.mode, autoCrit: Boolean(mods.autoCrit) }, dice());
      const why = C.modsText(mods);
      const d20 = mods.mode === R.MODES.normale
        ? 'd20 = ' + res.natural
        : 'd20 con ' + mods.mode + ' [' + res.d20Rolls.join(', ') + '] → ' + res.natural;
      let text = a.name + ' attacca ' + t.name + ' con ' + w.name + (why ? ' (' + why + ')' : '') + ': ' + d20 + ' ' + R.formatModifier(w.toHit) + ' = ' + res.total + ' contro CA ' + t.ac;
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
      hurt(t, def.amount, res.crit);
      const dmgExpr = res.damageDiceCount + 'd' + res.damageSides;
      text += res.crit ? (res.natural === 20 ? '. 20 NATURALE, COLPO CRITICO! ' : '. COLPO CRITICO (' + mods.autoCrit + ')! ') : ' → colpito. ';
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
    endDice(names[0] + ' attacca ' + names[1], summary);
    if (summary) toast(summary, summaryType);
    return summary;
  }

  // Tiro salvezza: d20 + totale della caratteristica, con vantaggio/svantaggio e CD opzionale.
  // Incantesimi: in ui-combattimento-incantesimi.js (DnD.uiCombattimentoIncantesimi).
  const {
    castDialog, editDialog, healDialog, performCast, performSave, removeCombatant, saveDialog, slotsIndicator,
  } = DnD.uiCombattimentoIncantesimi.incantesimi({
    C, M, Mv, R, S, V, attackModsFor, beginDice, byId, clear, confirmArea, dice, el, endDice, field, hurt, inflictOn, log, mutate, noteAggression, numberInput, openDialog, order, readNumber, rollText, session, showErrors, textInput, toast,
  });

  // Azioni delle creature: in ui-combattimento-creature.js (DnD.uiCombattimentoCreature).
  const {
    performCreatureAction, renderActive,
  } = DnD.uiCombattimentoCreature.creature({
    castDialog, editDialog, healDialog, removeCombatant, saveDialog, slotsIndicator, C, G, M, R, RP, S, UC, agganci, aiOn, aiPanel, attackDialog, attackModsFor, beginDice, blockedBy, byId, clone, combat, conditionsDialog, confirmArea, customs, dice, el, endCombat, endDice, getGrid, hurt, inflictOn, log, movementBox, mutate, nextTurn, noteAggression, openDialog, order, render, rollText, scheduleAuto, selectCombatant, speedText, toast,
  });

  // ---------- Gioco online (rete/sessione.js) ----------
  // Le intenzioni dei giocatori, già verificate dal master (rete/intenzioni.js), si eseguono con le stesse funzioni
  // dei comandi del master. Ogni funzione restituisce { ok, testo, tiro } (tiro: i dadi tirati dal master, per
  // mostrarli anche ai giocatori).
  function eseguito(fn) {
    S.lastTiro = null;
    const testo = fn();
    const last = combat() && combat().log.length ? combat().log[combat().log.length - 1].text : '';
    return { ok: true, testo: testo || last, tiro: S.lastTiro };
  }
  const online = {
    combat: () => combat(),
    regole: () => rules(),
    piediPerCella: () => fpc(),
    limitato: (x) => limited(x),
    mappa: () => IA.buildMap(aiState()),
    statoIA: () => aiState(),
    modsAttacco: (a, t, ranged, mode) => attackModsFor(a, t, ranged, mode),
    distanza: (w) => weaponRanged(w),
    muovi: (id, route) => eseguito(() => { mutate((c) => movementApply(c, id, route)); return ''; }),
    movimento: (id, kind) => { const r = moveAction(id, kind, true); return { ok: r.ok, testo: r.testo, tiro: null }; },
    attacca: (id, targetId, weaponId, mode) => eseguito(() => performAttack(id, targetId, weaponId, mode)),
    lancia: (id, spellId, slot, targetIds, mode) => eseguito(() => performCast(id, spellId, slot, targetIds, mode)),
    azioneCreatura: (id, actionId, targetIds, mode) => eseguito(() => performCreatureAction(id, actionId, targetIds, mode)),
    salvezza: (id, ab, dc, mode) => { S.lastTiro = null; const r = performSave(id, ab, dc, mode); return { ok: true, testo: r.testo, tiro: S.lastTiro, success: r.success, total: r.total }; },
    dichiara: (testo, tipo) => eseguito(() => { mutate((c) => log(c, tipo || 'sistema', testo)); return testo; }),
    prossimoTurno: () => eseguito(() => { nextTurn(); return ''; }),
    dadiDiProva: (rng) => { S.rngProva = rng || null; },
    controllo: (id, kind) => eseguito(() => { mutate((c) => { const t = c.combatants.find((y) => y.id === id); if (t) { t.control = kind; if (kind === 'ia') c.ai.simulated = true; S.aiPlan = null; } }); return ''; }),
  };

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.combattimento = { title: 'Combattimento', render };
  // Per i test dell'interfaccia: piano corrente ed esecuzione. columns: disposizione a tre colonne riusabile.
  /**
   * Agganci dei moduli sopra il combattimento (ui-esplorazione, ui-online), registrati al loro caricamento.
   * @param {{bannerEsplorazione?: () => Node|null, fineCombattimento?: (ended: object) => void,
   *   apriOnline?: () => void, disegnaPing?: (ctx, view, s) => void}} parti
   */
  const registraAgganci = (parti) => { Object.assign(agganci, parti); };

  DnD.uiCombattimento = { registraAgganci, selectCombatant: (id, source) => selectCombatant(id, source), getGrid: () => S.grid,
    currentAiPlan, executePlan, undoAiTurn: () => restoreCombat(aiHistory.undo(), 'Turno IA annullato.'), aiHistory, online };
})(globalThis.DnD = globalThis.DnD || {});
