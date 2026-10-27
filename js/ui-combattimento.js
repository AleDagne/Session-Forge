// Sezione Combattimento: setup, iniziativa e gestione dei turni. Il combattimento appartiene alla
// sessione corrente (sessione.combat). Nemici Standard e Creature (con azioni a pulsanti, multiattacco,
// ricarica, usi giornalieri, Resistenza leggendaria, azioni leggendarie e promemoria delle azioni di tana);
// i danni tengono conto di vulnerabilità, resistenze e immunità di ogni combattente.
// Combattimento simulato: i combattenti controllati dall'IA pianificano il turno con DnD.ia (funzioni pure)
// e il piano si esegue con le stesse funzioni dei comandi manuali (attacco, incantesimi, azioni delle creature).
// Boss: dopo ogni azione si controllano le soglie di fase (boss.js) e si mostrano barra in alto, ombra ed effetti.
// Suoni: mutate() traduce gli esiti già calcolati (nuove righe del log, PF dei giocatori, forme dei leggendari) in
// eventi sonori (suoni-dati.js) e li mette in coda; nei turni automatici dell'IA restano solo i principali.
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
  let vision = null;     // luce, visione e nebbia di guerra sulla griglia (ui-visione.js)

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
    if (!x.pos || !vision) return '';
    const lv = vision.levelAt(x.pos.x, x.pos.y);
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
      aiPlan = null;
      log(c, 'movimento', t.name + ': modalità di movimento ' + Mv.MODE_NAMES[mode].toLowerCase() + ' (' + Mv.feetIn(t, mode) + ' ft).');
    });
  }
  // Finestra delle condizioni (applica, modifica, togli, concentrazione, tiri contro la morte): ui-condizioni.js.
  function conditionsDialog(x) {
    UC().dialog(x.id, { mutate, log, byId, combatants: () => combat().combatants, after: () => { aiPlan = null; } });
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
  let diceRec = null;
  let lastTiro = null; // ultimo tiro mostrato (gioco online: va anche ai giocatori)
  const dice = () => (diceRec ? diceRec.rng : DnD.dadi.randomInt);
  let rngProva = null; // generatore deterministico (solo test.html, con online.dadiDiProva)
  const beginDice = () => { diceRec = DnD.dadi.registratore(rngProva || undefined); };
  function endDice(label, text) {
    const r = diceRec;
    diceRec = null;
    if (!r) return;
    const c = combat();
    // Senza riepilogo: l'ultima riga del log (l'esito dell'azione).
    const last = c && c.log.length ? c.log[c.log.length - 1].text : '';
    // Turni automatici dell'IA: coda veloce, il gioco non rallenta.
    lastTiro = r.tiro(label, 'combattimento', { testo: text || last });
    if (lastTiro) DnD.uiDadi.mostraTiro(lastTiro, { veloce: Boolean(c && c.ai && c.ai.simulated && c.ai.mode === 'auto') });
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
  let pendingAggr = null;   // { attackerId, targetIds } dell'azione ostile in corso (provocazioni, uccisioni)
  let overNotified = null;  // id del combattimento per cui si è già annunciata la fine
  let sceneEndNotified = '';  // combattimento ed esito della condizione di fine della scena già annunciati
  const noteAggression = (attackerId, targetIds) => { pendingAggr = { attackerId, targetIds: targetIds.filter(Boolean) }; };

  // Copia di un NPC piazzata sulla griglia -> combattente (stessa posizione, PF e stato della copia).
  function npcItemToCombatant(st, it, hostile) {
    const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
    if (!npc) return null;
    const v = worldView(st);
    const source = Object.assign(clone(npc.stats), { id: npc.id, name: it.name || npc.name, icon: clone(it.icon) });
    const x = R.createCombatants([], [{ npc: source, quantity: 1 }], st.races, dice(), st.spells, st.equipment)[0];
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
    provoked = true;
    return lines;
  }
  let provoked = false;

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
      aiPlan = null;
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
          aiPlan = null;
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
    if (end && sceneEndNotified !== c.id + end.outcome) {
      sceneEndNotified = c.id + end.outcome;
      lines.push('🎬 Condizione di fine dell\'incontro: ' + DnD.sceneDati.OUTCOME_NAMES[end.outcome] + ' (' + end.text + '). Termina il combattimento per il riepilogo della scena.');
    }
    if (c.phase === 'attivo' && overNotified !== c.id) {
      const over = FZ.combatOver(c.combatants, relTable(st), pf);
      if (over.over) {
        overNotified = c.id;
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
          aiPlan = null;
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
      aiPlan = null;
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
  let aiPlan = null;          // { forId, round, plan } del turno in corso
  let aiPaused = false;       // modalità automatica in pausa
  let aiBusy = false;         // esecuzione in corso (animazione)
  let aiTimer = null;
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
      vision = DnD.uiVisione.create({ getDoc: () => combat(), widget: () => grid, mode: 'combattimento' });
      grid = DnD.uiGriglia.create({
        getDoc: combat,
        // Spostamenti e strumenti della griglia: la nebbia dei giocatori si aggiorna subito.
        update: (fn) => DnD.store.update(() => { fn(combat()); visionAfter(combat()); }),
        painter: vision.painter,
        vision,
        tools: ['seleziona', 'misura'],
        showCombatants: true,
        onSelect: (id) => selectCombatant(id, 'grid'),
        tokenActions,
        movement: { begin: movementBegin, apply: movementApply },
        turnInfo: (x) => speedText(x, true) + (lightText(x) ? ' · ' + lightText(x) : ''),
        // Residuo sopra la pedina di turno; anteprima del piano dell'IA: percorso tratteggiato e bersagli evidenziati.
        overlay: (ctx, view, s) => {
          if (DnD.uiOnline) DnD.uiOnline.disegnaPing(ctx, view, s);
          const c = combat();
          const cur = c && c.currentId ? byId(c.currentId) : null;
          if (cur && cur.pos && limited(cur)) DnD.uiIa.drawBadge(ctx, view, s, cur, '🦶 ' + Mv.left(cur, rules(), fpc()));
          if (!c || !aiOn() || !aiPlan || aiPlan.forId !== c.currentId) return;
          const col = DnD.uiTileset.colors();
          DnD.uiIa.drawPlan(ctx, view, s, aiPlan.plan, c.combatants, { current: col.accent, bad: '#d4453a' });
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
                aiPlan = null;
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
          vision.quickBar(),
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
        aiPlan = null;
        log(c, 'sistema', t.name + ': controllo ' + (t.control === 'ia' ? 'IA' : 'manuale') + '.');
      }) },
      { text: '⚑ Fazione: ' + factionName(x.faction) + '…', onclick: () => factionDialog(byId(id)) },
      x.prevFaction ? { text: '↶ Torna a ' + factionName(x.prevFaction), onclick: () => undoFaction(id) } : null,
      x.npc && x.hostileTo && x.hostileTo.length ? { text: '🕊 Calma ' + x.name + '…', onclick: () => calmDialog(byId(id)) } : null,
      x.npc && x.hostileTo && x.hostileTo.length ? { text: '↶ Annulla la provocazione', onclick: () => revertProvocation(byId(id)) } : null,
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
  // Danni a 0 PF (tiri contro la morte) e concentrazione: salvezza su COS con CD max(10, metà del danno).
  let hurtLines = [];
  function hurt(t, amount, crit) {
    const wasZero = t.hp <= 0;
    // PF temporanei (riposi.js): assorbono il danno per primi.
    const tmp = DnD.riposi.absorbTemp(t, amount);
    if (tmp.absorbed) hurtLines.push('🛡 ' + t.name + ': i PF temporanei assorbono ' + tmp.absorbed + ' danni (ne restano ' + (t.tempHp || 0) + ').');
    hurtLines = hurtLines.concat(DnD.leggendario.damage(t, tmp.rest));
    if (!(amount > 0)) return;
    if (wasZero) hurtLines.push(...C.damageAtZero(t, crit));
    if (t.hp > 0 && t.concentration) {
      const r = C.concentrationCheck(t, amount, dice());
      hurtLines.push({ type: r.kept ? 'tiro-salvezza' : 'ts-fallito', text: r.line });
      if (!r.kept) hurtLines.push(...C.endConcentration(t, combat().combatants, 'danno').lines.map((text) => ({ type: 'concentrazione', text })));
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
    const aggr = pendingAggr;
    pendingAggr = null;
    provoked = false;
    DnD.store.update((st) => {
      const prev = session(st).combat;
      const beforeHp = new Map(prev ? prev.combatants.map((x) => [x.id, x.hp]) : []);
      const before = DnD.suoniDati.combatSnapshot(prev);
      const lastLine = prev && prev.log.length ? prev.log[prev.log.length - 1] : null;
      fn(session(st).combat, st);
      if (hurtLines.length && session(st).combat) for (const line of hurtLines) log(session(st).combat, line.type || 'sistema', line.text || line);
      hurtLines = [];
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
    if (provoked) { aiPlan = null; if (DnD.uiMondo) DnD.uiMondo.sound('ostile'); toast('Un NPC neutrale diventa ostile (vedi il log).'); }
    if (events.some((e) => e.kind === 'fase')) aiPlan = null;
    render();
    DnD.uiBoss.playEvents(events, root && root.querySelector('.combat-layout'));
  }

  function log(c, type, text) {
    DnD.dati.pushLog(c, type, text);
  }

  function render(container) {
    root = container || root;
    if (!root) return;
    clear(root);
    if (!combat()) renderSetup();
    else if (combat().phase === 'iniziativa') renderInitiative();
    else renderActive();
  }

  // ---------- Setup ----------
  // Genera nemici al volo: vengono salvati in Nemici e aggiunti al setup (uno per ciascuno). La difficoltà del
  // generatore parte dalla selezione del setup (setupInput, assegnato da renderSetup).
  let setupInput = null;
  function generateAndAdd() {
    DnD.uiGeneratore.open({
      saveLabel: 'Salva e aggiungi al combattimento',
      baseInput: setupInput ? setupInput() : null,
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
    setupInput = null;
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
      ? [c.type === 'boss' ? 'Boss' : 'Creatura', 'GS ' + DF.crOf(c) + (DF.crOf(c) !== c.cr ? ' effettivo' : ''), 'PF ' + M.hpInfo(c).total, 'CA ' + c.ac]
      : playerSummary(c).concat(vPlayers.includes(c) ? [] : ['GS ' + DF.crOf(c)]));
    const qtyInputs = {};
    const errorBox = el('div', { class: 'error', 'aria-live': 'polite' });
    // Controllo (Manuale o IA) e fazione per riga: di base giocatori Manuale, nemici IA.
    // Fazione di partenza: quella della scheda, del party (giocatori) o della città (nemici).
    const wv = worldView(st);
    const fctx = { parties: wv.parties, cities: wv.cities, factions: wv.factions };
    const sourceOf = (id) => vPlayers.find((p) => p.id === id) || vNpcs.find((n) => n.id === id);
    const defaultFactionOf = (id, kind) => FZ.defaultFactionFor(sourceOf(id), kind, fctx);
    function controlPickers(id, kind) {
      const control = setup.control[id] || IA.defaultControl(kind);
      const faction = setup.faction[id] || defaultFactionOf(id, kind);
      return el('span', { class: 'control-pickers' },
        el('select', { class: 'small-select', 'aria-label': 'Controllo', onchange: (e) => { setup.control[id] = e.target.value; } },
          el('option', { value: 'manuale', text: '👤 Manuale', selected: control === 'manuale' }), el('option', { value: 'ia', text: '🤖 IA', selected: control === 'ia' })),
        el('select', { class: 'small-select', 'aria-label': 'Fazione', onchange: (e) => { setup.faction[id] = e.target.value; refreshDifficulty(); } },
          wv.factions.map((f) => el('option', { value: f.id, text: f.name, selected: f.id === faction }))));
    }
    const activeParty = DnD.party.active(wv.parties, wv.world);

    // Difficoltà (difficolta.js): giocatori scelti (o il party attivo) contro i nemici ostili al party e gli NPC
    // della griglia di partenza che contano (ostili, o neutrali con l'opzione). Si aggiorna a ogni modifica.
    function encounterInput() {
      const chosen = vPlayers.filter((p) => setup.players.has(p.id));
      const party = DF.partyFrom(chosen.length ? chosen : UD.partyPlayers(st).players);
      const t = relTable(st);
      const pf = partyFaction(st);
      const rules = UD.rules();
      const creatures = [];
      for (const n of vNpcs) {
        const q = qtyInputs[n.id] ? readNumber(qtyInputs[n.id]) : setup.npcs[n.id] || 0;
        if (!Number.isInteger(q) || q <= 0) continue;
        if (DF.counts({ id: n.id, faction: setup.faction[n.id] || defaultFactionOf(n.id, 'npc') }, t, pf, rules)) creatures.push(DF.group(n, Math.min(q, MAX_COPIES)));
      }
      const g = vGrids.find((x) => x.id === setup.gridId);
      for (const it of g ? g.items.filter((y) => y.otype === 'npc' && !y.npcState.dead) : []) {
        const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
        if (!npc) continue;
        const fid = NP.factionOf(npc, it.npcState, wv.cities);
        const att = NP.attitudeOf(npc, it.npcState, FZ.reputationOf(wv.world, activeParty, fid));
        const x = { id: it.id, faction: fid, npc: NP.combatData(npc, it.npcState, it.id, att), hostileTo: it.npcState.hostile ? [pf] : it.npcState.hostileTo };
        if (DF.counts(x, t, pf, rules)) creatures.push(DF.group(Object.assign({}, npc.stats, { id: it.id, name: it.name || npc.name }), 1, { fixed: true }));
      }
      return { party, creatures };
    }
    const difficulty = UD.indicator({
      title: 'Difficoltà dell\'incontro',
      onBalance: () => {
        const input = encounterInput();
        UD.balanceDialog(input, (i, count) => { setup.npcs[input.creatures[i].id] = count; render(); }, MAX_COPIES);
      },
    });
    setupInput = encounterInput;
    const partyNote = el('p', { class: 'muted small' });
    function refreshDifficulty() {
      difficulty.update(encounterInput());
      partyNote.textContent = (vPlayers.some((p) => setup.players.has(p.id)) ? 'Party: i giocatori scelti.' : 'Party: ' + UD.partyPlayers(st).label + ' (nessun giocatore scelto).') +
        ' Contano i nemici ostili al party e gli NPC ostili della griglia di partenza.';
    }

    const playersBox = vPlayers.length
      ? el('ul', { class: 'pick-list' }, vPlayers.map((p) => el('li', {},
        el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: setup.players.has(p.id), onchange: (e) => { if (e.target.checked) setup.players.add(p.id); else setup.players.delete(p.id); refreshDifficulty(); } }),
          ' ', el('b', { text: p.name }),
          el('span', { class: 'muted small', text: ' · ' + [p.playerName].concat(summary(p)).filter(Boolean).join(' · ') })), ' ', controlPickers(p.id, 'player'))))
      : el('p', { class: 'empty', text: 'Nessun giocatore. Creali nella sezione Giocatori.' });

    const npcsBox = vNpcs.length
      ? el('ul', { class: 'pick-list' }, vNpcs.map((n) => {
        qtyInputs[n.id] = numberInput(setup.npcs[n.id] || 0, {
          min: 0, max: MAX_COPIES, class: 'qty', 'aria-label': 'Quantità di ' + n.name,
          oninput: (e) => { setup.npcs[n.id] = readNumber(e.target); refreshDifficulty(); },
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
      beginDice();
      const combatants = R.createCombatants(players, entries, st.races, dice(), st.spells, st.equipment);
      endDice('Iniziativa', '');
      for (const x of combatants) {
        if (setup.control[x.sourceId]) x.control = setup.control[x.sourceId];
        x.faction = setup.faction[x.sourceId] || defaultFactionOf(x.sourceId, x.kind === 'player' ? 'player' : 'npc');
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
        // NPC del Mondo sulla griglia con «Entra subito»: combattenti (neutrali) fin dall'iniziativa.
        const cb = session(s).combat;
        for (const it of cb.grid.items.filter((y) => y.otype === 'npc')) {
          const npc = (s.worldNpcs || []).find((n) => n.id === it.npcId);
          if (npc && npc.combat.joinNow && !it.npcState.dead) joinFromItem(cb, s, it, Boolean(it.npcState.hostile));
        }
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

    const gridSelect = el('select', { onchange: (e) => { setup.gridId = e.target.value; refreshDifficulty(); } },
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
      el('div', { class: 'section-head' }, el('h1', { text: 'Nuovo combattimento' }),
        el('div', { class: 'head-actions' }, el('button', { class: 'btn', text: '🌐 Online', title: 'Gioco online: ospita i giocatori o unisciti a una sessione', onclick: () => DnD.uiOnline.apri() }))),
      el('section', { class: 'panel diff-panel' }, difficulty.node, partyNote),
      el('div', { class: 'grid-2' },
        el('section', { class: 'panel' },
          el('div', { class: 'history-head' },
            el('h2', { text: 'Giocatori' }),
            el('div', { class: 'head-actions' },
              activeParty && activeParty.memberIds.length ? el('button', { class: 'btn small', text: '⚑ Aggiungi party', title: 'Tutti i membri di «' + activeParty.name + '»',
                onclick: () => { activeParty.memberIds.forEach((id) => { if (vPlayers.some((p) => p.id === id)) setup.players.add(id); }); render(); } }) : null,
              vPlayers.length ? el('button', { class: 'btn small', text: 'Tutti', onclick: () => { vPlayers.forEach((p) => setup.players.add(p.id)); render(); } }) : null)),
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
    refreshDifficulty();
  }

  // ---------- Iniziativa ----------
  function renderInitiative() {
    const inputs = {};
    const list = order();
    const rerollAll = () => {
      beginDice();
      mutate((c) => {
        for (const x of c.combatants) Object.assign(x, R.rollInitiative(x.dexMod, dice()));
      });
      endDice('Iniziativa ritirata', '');
    };
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
    if (DnD.uiEsplorazione) DnD.uiEsplorazione.onCombatEnded(ended);
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
        if (sp.area && sp.effect.type !== 'cura' && !confirmArea(caster.id, targets)) return false;
        const cur = byId(caster.id);
        if (sp.concentration && cur && cur.concentration && !confirm(cur.name + ' è concentrato su ' + cur.concentration.name + ': lanciando ' + sp.name + ' la concentrazione precedente termina (e i suoi effetti). Continuare?')) return false;
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
    beginDice();
    const spell = byId(casterId) && byId(casterId).spellcasting && byId(casterId).spellcasting.spells.find((x) => x.id === spellId);
    if (spell && !['cura', 'nessuno'].includes(spell.effect.type)) noteAggression(casterId, targetIds);
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
      // Condizioni di ogni bersaglio: modo dell'attacco (e critico automatico da vicino), salvezze automatiche o con svantaggio.
      const tmods = new Map(targets.map((t) => [t.id, sp.effect.type === 'attacco' ? attackModsFor(a, t, false, mode) : C.saveMods(t, sp.effect.saveAbility)]));
      const res = DnD.magie.resolveSpell({
        spell: sp, slotLevel, mode, caster: { attack: sc.attack, dc: sc.dc, mod: sc.mod },
        targets: targets.map((t) => { const m = tmods.get(t.id); return { id: t.id, ac: t.ac, saves: t.saves, mode: m.mode, autoCrit: Boolean(m.autoCrit), saveMode: m.mode, autoFail: Boolean(m.autoFail) }; }),
      }, dice());
      // Concentrazione: inizia prima di applicare gli effetti (quella precedente finisce con i suoi).
      const concLines = sp.concentration ? C.startConcentration(a, sp, c.combatants, c.round) : [];
      // Luce e Oscurità (riconosciuti dal nome): la sorgente nasce sul primo bersaglio o su chi lancia, legata alla concentrazione.
      const lightAt = (targets[0] && targets[0].pos) || a.pos;
      if (lightAt && V.spellEffect(sp)) concLines.push(V.castLight(c.grid, a, sp, lightAt));
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
          hurt(t, def.amount, r.crit);
          r.amount = def.amount;
        }
        // Tiro salvezza fallito: la Resistenza leggendaria può trasformarlo in un successo.
        if (e.type === 'salvezza' && !r.success && t.creature && t.creature.legendaryResistance.left > 0) {
          t.pendingSave = { full: [{ amount: res.roll ? Math.max(0, res.roll.total) : 0, type: M.damageTypeOf(e.damageType) }], half: e.halfOnSave, applied: before - t.hp, magical: true, text: sp.name };
        }
        const hpText = (before === t.hp ? '' : ' (' + before + ' → ' + t.hp + ' PF)') + defNote;
        const why = C.modsText(tmods.get(t.id));
        if (e.type === 'attacco') {
          const tm = tmods.get(t.id).mode;
          const d20 = tm === 'normale' ? 'd20 = ' + r.natural : 'd20 con ' + tm + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
          const outcome = r.fumble ? '1 NATURALE, mancato' : r.crit ? 'CRITICO, ' + r.amount + ' danni' + dmgType + ' (' + diceText(r.roll) + ')'
            : r.hit ? 'colpito, ' + r.amount + ' danni' + dmgType + ' (' + diceText(r.roll) + ')' : 'mancato';
          parts.push(t.name + (why ? ' (' + why + ')' : '') + ': ' + d20 + ' ' + R.formatModifier(sc.attack) + ' = ' + r.total + ' contro CA ' + t.ac + ' → ' + outcome + hpText + '.');
        } else if (e.type === 'salvezza') {
          parts.push(t.name + ': salvezza ' + e.saveAbility + ' ' + (r.autoFail ? 'fallita in automatico (' + why + ')' : r.saveTotal + ' vs CD ' + sc.dc + (why ? ' (' + why + ')' : '') + ' → ' + (r.success ? 'riesce' : 'fallisce')) + ', ' + r.amount + ' danni' + hpText + '.');
        } else if (e.type === 'cura') {
          parts.push(t.name + ' recupera ' + (t.hp - before) + ' PF' + hpText + (before === 0 && t.hp > 0 ? ', torna in piedi' : '') + '.');
        } else if (res.roll) {
          parts.push(t.name + ': ' + r.amount + ' danni' + hpText + '.');
        }
        if (before > 0 && t.hp === 0) downed.push(t.name);
      }
      log(c, 'magia', parts.join(' '));
      for (const line of concLines) log(c, line.includes('perde') ? 'concentrazione' : 'sistema', line);
      // Condizione inflitta: a chi fallisce la salvezza, a chi è colpito, o (senza tiro) a tutti salvo la salvezza propria.
      if (sp.inflict && sp.inflict.type) {
        for (const r of res.targets) {
          const t = byId(r.id);
          if (!t || (e.type === 'salvezza' && r.success) || (e.type === 'attacco' && !r.hit)) continue;
          if (e.type !== 'salvezza' && e.type !== 'attacco' && sp.inflict.save) {
            const sm = C.saveMods(t, sp.inflict.save.ability);
            const dc = sp.inflict.save.dc || sc.dc;
            const s2 = sm.autoFail ? { success: false, total: '—' } : R.rollSave({ bonus: t.saves[sp.inflict.save.ability] || 0, mode: sm.mode, dc }, dice());
            log(c, s2.success ? 'tiro-salvezza' : 'ts-fallito', t.name + ': salvezza su ' + sp.inflict.save.ability + ' contro ' + sp.name + ' ' + s2.total + ' vs CD ' + dc + ' → ' + (s2.success ? 'riesce.' : 'fallisce.'));
            if (s2.success) continue;
          }
          inflictOn(c, a, t, sp.inflict, sp);
        }
      }
      for (const n of downed) log(c, 'a-terra', n + ' è a terra!');
      summaryText = a.name + ' lancia ' + sp.name + (downed.length ? ' · a terra: ' + downed.join(', ') : '');
    });
    endDice(summaryText.split(' · ')[0], summaryText);
    if (summaryText) toast(summaryText, 'success');
    return summaryText;
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
        const r = performSave(target.id, ability.value, dcValue, body.querySelector('input[name="modo-ts"]:checked').value);
        if (r.testo) toast(r.testo, r.tipo);
        return undefined;
      } },
    ]);
  }
  // Tiro salvezza di un combattente (d20 + salvezza, condizioni): { testo, tipo, success, total }.
  function performSave(targetId, ab, dcValue, m) {
    let summaryText = '';
    let summaryType = 'info';
    let esito = null;
    beginDice();
    mutate((c) => {
      const t = byId(targetId);
      if (!t) return;
      // Condizioni: fallimento automatico (FOR e DES da paralizzato, stordito…) o svantaggio.
      const sm = C.saveMods(t, ab, m);
      if (sm.autoFail) {
        esito = { success: false, total: null };
        log(c, 'ts-fallito', t.name + ' tiro salvezza su ' + R.ABILITY_NAMES[ab] + ': fallito in automatico (' + sm.autoFail + ').');
        summaryText = t.name + ': TS ' + ab + ' fallito in automatico (' + sm.autoFail + ')';
        summaryType = 'error';
        return;
      }
      const r = R.rollSave({ bonus: t.saves[ab], mode: sm.mode, dc: dcValue }, dice());
      const why = C.modsText(sm);
      const d20 = sm.mode === R.MODES.normale ? 'd20 = ' + r.natural : 'd20 con ' + sm.mode + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
      const outcome = r.success === null ? '' : r.success ? ' contro CD ' + dcValue + ' → riuscito.' : ' contro CD ' + dcValue + ' → fallito.';
      log(c, r.success === false ? 'ts-fallito' : 'tiro-salvezza', t.name + ' tiro salvezza su ' + R.ABILITY_NAMES[ab] + (why ? ' (' + why + ')' : '') + ': ' + d20 + ' ' +
        R.formatModifier(t.saves[ab]) + ' = ' + r.total + (outcome || '.'));
      summaryText = t.name + ': TS ' + ab + ' = ' + r.total + (r.success === null ? '' : r.success ? ' (riuscito)' : ' (fallito)');
      summaryType = r.success === false ? 'error' : r.success ? 'success' : 'info';
      esito = r;
    });
    endDice((byId(targetId) || { name: '' }).name + ': tiro salvezza su ' + R.ABILITY_NAMES[ab], summaryText);
    return { testo: summaryText, tipo: summaryType, success: esito ? esito.success : false, total: esito ? esito.total : null };
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
        if (steps.some((sub) => sub.mech.kind === 'salvezza' && sub.mech.area) && !confirmArea(x.id, [].concat(...targets))) return false;
        performCreatureAction(x.id, a.id, targets, currentMode());
        return undefined;
      } },
    ]);
  }

  // Esegue l'azione (e, per il multiattacco, tutte le azioni previste in sequenza), con una riga di log per
  // ciascuna. Consuma usi, ricarica o punti leggendari.
  function performCreatureAction(attackerId, actionId, targetIds, mode) {
    const downed = [];
    const who = byId(attackerId);
    const act = who && who.creature ? M.allActions(who.creature).find((y) => y.id === actionId) : null;
    beginDice();
    if (act && act.mech.kind !== 'cura' && act.mech.kind !== 'testo') noteAggression(attackerId, [].concat(...targetIds));
    mutate((c) => {
      const x = byId(attackerId);
      const st = x && x.creature;
      const a = st && M.allActions(st).find((y) => y.id === actionId);
      if (!a) return;
      const use = M.canUse(st, a);
      if (!use.ok) { toast(a.name + ': ' + use.reason + '.', 'error'); return; }
      if (blockedBy(x)) { toast(x.name + ': ' + blockedBy(x) + '.', 'error'); return; }
      M.consume(st, a);
      if (a.group === 'bonusActions' || a.group === 'reactions') DnD.audio.suona('azione-lieve', { coda: true });
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
            const mods = attackModsFor(x, t, sub.mech.range === 'distanza', mode);
            if (mods.blocked) { log(c, 'sistema', who + ': non attacca ' + t.name + ' (' + mods.blocked + ').'); continue; }
            const r = M.resolveAttack(st, sub, t, mods.mode, dice(), Boolean(mods.autoCrit));
            const why = C.modsText(mods);
            const d20 = mods.mode === 'normale' ? 'd20 = ' + r.natural : 'd20 con ' + mods.mode + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
            let text = who + ' contro ' + t.name + (why ? ' (' + why + ')' : '') + ': ' + d20 + ' ' + R.formatModifier(r.bonus) + ' = ' + r.total + ' contro CA ' + t.ac;
            if (r.fumble || !r.hit) { log(c, 'mancato', text + (r.fumble ? '. 1 NATURALE: mancato.' : ' → mancato.')); continue; }
            const applied = M.applyDamageParts(r.parts, t.defenses, sub.mech.magical);
            hurt(t, applied.total, r.crit);
            text += (r.crit ? (r.natural === 20 ? '. 20 NATURALE, CRITICO (dadi raddoppiati)! ' : '. CRITICO (' + mods.autoCrit + ', dadi raddoppiati)! ') : ' → colpito: ') +
              r.parts.map((q) => q.dice + rollText(q.rolls, q.bonus).replace(/^/, ' ') + ' = ' + q.amount + (q.type ? ' ' + q.type : '')).join(' + ') +
              (applied.notes.length ? ' (' + applied.notes.join('; ') + ')' : '') + ' → ' + applied.total + ' danni. ' + t.name + ': ' + before + ' → ' + t.hp + ' PF.';
            log(c, r.crit ? 'critico' : 'colpito', text);
            // Condizione inflitta dal colpo (con la salvezza che la evita, se indicata).
            const inf = sub.mech.inflict;
            if (inf && inf.type) {
              let saved = false;
              if (inf.save) {
                const sm = C.saveMods(t, inf.save.ability);
                const dc = inf.save.dc || 10;
                const s2 = sm.autoFail ? { success: false, total: '—' } : R.rollSave({ bonus: t.saves[inf.save.ability] || 0, mode: sm.mode, dc }, dice());
                saved = s2.success;
                log(c, saved ? 'tiro-salvezza' : 'ts-fallito', t.name + ': salvezza su ' + inf.save.ability + ' contro ' + C.inflictName(inf, customs()).toLowerCase() + ' ' + s2.total + ' vs CD ' + dc + ' → ' + (saved ? 'riesce.' : 'fallisce.'));
              }
              if (!saved) inflictOn(c, x, t, inf, null);
            }
          } else if (sub.mech.kind === 'salvezza') {
            const sm = C.saveMods(t, sub.mech.ability);
            const r = M.resolveSave(st, sub, t, dice(), sm.mode, Boolean(sm.autoFail));
            const applied = M.applyDamageParts(r.parts, t.defenses, false);
            hurt(t, applied.total);
            const why = C.modsText(sm);
            let text = who + ': ' + t.name + ' tira salvezza su ' + R.ABILITY_NAMES[r.ability] + ' ' + (sm.autoFail ? '— fallita in automatico (' + sm.autoFail + ')' : r.total + ' contro CD ' + r.dc + (why ? ' (' + why + ')' : '') + ' → ' + (r.success ? 'riesce' : 'fallisce'));
            if (r.parts.length) text += ', ' + r.full.map((q) => q.dice + ' [' + q.rolls.join(', ') + ']' + (q.bonus ? ' ' + R.formatModifier(q.bonus) : '') + ' = ' + q.amount + (q.type ? ' ' + q.type : '')).join(' + ') +
              (r.success && sub.mech.half ? ' (metà)' : '') + (applied.notes.length ? ' (' + applied.notes.join('; ') + ')' : '') + ' → ' + applied.total + ' danni';
            if (!r.success && sub.mech.effect) text += '; ' + sub.mech.effect;
            text += '. ' + (before !== t.hp ? t.name + ': ' + before + ' → ' + t.hp + ' PF.' : '');
            log(c, r.success ? 'tiro-salvezza' : 'ts-fallito', text);
            if (!r.success && sub.mech.inflict && sub.mech.inflict.type) inflictOn(c, x, t, Object.assign({}, sub.mech.inflict, { save: { ability: sub.mech.ability, dc: r.dc } }), null);
            if (!r.success && t.creature && t.creature.legendaryResistance.left > 0) {
              t.pendingSave = { full: r.full.map((q) => ({ amount: q.amount, type: q.type })), half: sub.mech.half, applied: before - t.hp, magical: false, text: sub.name };
            }
          } else if (sub.mech.kind === 'cura') {
            const r = M.resolveHeal(st, sub, dice());
            t.hp = R.heal(t.hp, t.maxHp, r.amount);
            log(c, 'cura', who + ': ' + t.name + ' recupera ' + (t.hp - before) + ' PF [' + r.rolls.join(', ') + ']: ' + before + ' → ' + t.hp + ' PF.');
          }
          if (before > 0 && t.hp === 0) { log(c, 'a-terra', t.name + ' è a terra!'); downed.push(t.name); }
        }
      });
    });
    endDice((who ? who.name : '') + (act ? ': ' + act.name : ''), downed.length ? 'A terra: ' + downed.join(', ') : '');
    if (downed.length) toast('A terra: ' + downed.join(', '), 'success');
    return (who ? who.name : '') + (act ? ': ' + act.name : '') + (downed.length ? ' · a terra: ' + downed.join(', ') : '');
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
    const block = blockedBy(x);
    const btn = (a, extraDisabled) => {
      const u = M.canUse(st, a);
      return el('button', {
        type: 'button', class: 'btn small' + (a.mech.kind === 'multiattacco' ? ' primary' : ''), disabled: down || !u.ok || extraDisabled || Boolean(block),
        title: (block ? block + ' (il master può permetterle da «Condizioni») · ' : '') + (u.reason ? u.reason + ' · ' : '') + M.actionText(st, a), text: a.name + (a.cost > 1 ? ' (' + a.cost + ')' : '') + usesText(a),
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

  // Risorse del combattente (riposi.js): elenco con − e +, risorse personalizzate, ripristino del master. Il riposo
  // è disattivato durante il combattimento attivo.
  const openRes = new Set(); // riquadri «Risorse» aperti (restano aperti tra un − e un +)
  function restBox(x) {
    const view = RP.resources(RP.fromCombatant(clone(x)));
    const change = (fn, text) => mutate((c) => { const t = c.combatants.find((y) => y.id === x.id); if (!t) return; fn(t); if (text) log(c, 'sistema', text(t)); });
    const active = combat().phase === 'attivo';
    return el('details', { class: 'res-details small', open: openRes.has(x.id), ontoggle: (e) => { if (e.target.open) openRes.add(x.id); else openRes.delete(x.id); } }, el('summary', { text: '🎒 Risorse' + (x.tempHp ? ' · 🛡 ' + x.tempHp + ' PF temporanei' : '') }),
      DnD.uiRiposi.resourcesBox(view, (id, d) => change((t) => RP.adjust(RP.fromCombatant(t), id, d), (t) => t.name + ': ' + (view.find((r) => r.id === id) || {}).label + ' ' + (d > 0 ? '+1' : '−1') + '.'), {
        add: (data) => change((t) => { RP.fromCombatant(t); t.resources.push(RP.normalizeResource(Object.assign({ value: data.max }, data))); }, (t) => t.name + ': nuova risorsa «' + data.label + '».'),
        remove: (rid) => change((t) => { t.resources = (t.resources || []).filter((r) => r.id !== rid); }),
      }),
      el('div', { class: 'head-actions' },
        ['breve', 'lungo'].map((kind) => el('button', { type: 'button', class: 'btn small', text: '🛏 Riposo ' + kind, disabled: active, title: active ? DnD.uiRiposi.BUSY : null, onclick: () => restCombatant(x, kind) })),
        el('button', { type: 'button', class: 'btn small', text: '⟲ Ripristina tutto (master)', onclick: () => {
          if (confirm('Ripristinare PF, dadi vita, slot, usi e risorse di ' + x.name + '?')) change((t) => RP.restoreAll(RP.fromCombatant(t)), (t) => RP.summaryText({ kind: 'tutto', name: t.name }));
        } })));
  }

  // Riposo di un combattente (nemici e NPC compresi) quando il combattimento non è attivo.
  function restCombatant(x, kind) {
    DnD.uiRiposi.restDialog({ kind, subjects: [{ id: x.id, acc: RP.fromCombatant(clone(x)) }], now: null, onConfirm: (params) => {
      const lines = [];
      change0(x.id, (c, t) => {
        const r = kind === 'breve' ? RP.shortRest(RP.fromCombatant(t), { rolls: params.rolls[x.id] || [] }) : RP.longRest(RP.fromCombatant(t), { opts: DnD.impostazioni.restOptions(), interruptedAfter: params.interruptAfter });
        lines.push(RP.summaryText(r));
        log(c, 'sistema', lines[0]);
      });
      return { ok: true, lines };
    } });
  }
  const change0 = (id, fn) => mutate((c) => { const t = c.combatants.find((y) => y.id === id); if (t) fn(c, t); });

  function hpBar(x) {
    const pct = x.maxHp > 0 ? Math.round((x.hp / x.maxHp) * 100) : 0;
    return el('div', { class: 'hp' },
      el('div', { class: 'hp-text' }, el('b', { text: x.hp + ' / ' + x.maxHp }), ' PF'),
      el('div', { class: 'hp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': x.maxHp, 'aria-valuenow': x.hp, 'aria-label': 'Punti ferita' },
        el('div', { class: 'hp-fill ' + R.hpLevel(x.hp, x.maxHp), style: 'width:' + pct + '%' })));
  }

  function combatantCard(x, current) {
    const down = R.isDown(x);
    const block = blockedBy(x);
    const blockTitle = block ? block + ' (il master può permetterle da «Condizioni»)' : null;
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
            ' · ' + G.tokenDims(x).w + '×' + G.tokenDims(x).h + (aiOn() ? ' · ' + (x.control === 'ia' ? '🤖 IA' : '👤 Manuale') : '') + (x.hidden ? ' · nascosto' : '') }),
          DnD.uiMondo ? DnD.uiMondo.factionBadge(x.faction) : null,
          x.npc ? el('span', { class: 'tag att-' + x.npc.attitude, title: 'NPC del Mondo', text: '👤 ' + DnD.mondoDati.ATTITUDE_NAMES[x.npc.attitude] }) : null,
          x.hostileTo && x.hostileTo.length ? el('span', { class: 'tag danger', title: 'Ostile per una provocazione', text: '⚔ provocato' }) : null,
          x.joinRound ? el('span', { class: 'badge', text: 'ENTRA AL ROUND ' + x.joinRound }) : null,
          x.dead ? el('span', { class: 'badge down-badge', text: '✝ MORTO' }) : down ? el('span', { class: 'badge down-badge', text: C.dying(x) ? 'TIRI CONTRO LA MORTE' : x.deathSaves && x.deathSaves.stable ? 'STABILE' : 'A TERRA' }) : null,
          current ? el('span', { class: 'badge turn-badge', text: 'TURNO' }) : null),
        el('div', { class: 'ac-shield', title: 'Classe Armatura' }, el('small', { text: 'CA' }), el('b', { text: String(x.ac) }))),
      hpBar(x),
      UC().cardBox(x, byId, () => conditionsDialog(byId(x.id))),
      x.defenses && (x.defenses.vuln.length || x.defenses.res.length || x.defenses.imm.length) ? el('p', { class: 'muted small', text: [
        x.defenses.vuln.length ? 'Vulnerabile: ' + M.defensesText(x.defenses.vuln) : '', x.defenses.res.length ? 'Resiste: ' + M.defensesText(x.defenses.res) : '',
        x.defenses.imm.length ? 'Immune: ' + M.defensesText(x.defenses.imm) : ''].filter(Boolean).join(' · ') }) : null,
      x.spellcasting ? slotsIndicator(x.spellcasting) : null,
      x.pos || combat().phase === 'attivo' ? movementBox(x) : null,
      // Leggendari: Trasformati / Torna normale, rango e forma attiva.
      x.legend && DnD.uiLeggendario ? DnD.uiLeggendario.combatBox(x, { mutate, log, byId, render }) : null,
      creatureBox(x),
      restBox(x),
      el('div', { class: 'card-actions' },
        el('button', {
          class: 'btn primary', text: 'Attacca', onclick: () => attackDialog(x),
          disabled: down || !x.weapons.length || combat().combatants.length < 2 || Boolean(block),
          title: down ? 'È a terra' : block ? blockTitle : !x.weapons.length ? 'Nessuna arma equipaggiata' : null,
        }),
        el('button', { class: 'btn', text: 'Cura', onclick: () => healDialog(x) }),
        el('button', { class: 'btn', text: 'Tiro salvezza', onclick: () => saveDialog(x) }),
        x.spellcasting ? el('button', {
          class: 'btn', text: '✨ Lancia incantesimo', onclick: () => castDialog(x),
          disabled: down || !x.spellcasting.spells.length || Boolean(block), title: block ? blockTitle : !x.spellcasting.spells.length ? 'Nessun incantesimo conosciuto' : null,
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
            el('button', { class: 'btn', text: '🌐 Online', title: 'Gioco online: ospita i giocatori o unisciti a una sessione', onclick: () => DnD.uiOnline.apri() }),
            el('button', { class: 'btn danger', text: 'Termina combattimento', onclick: endCombat }))),
        // Combattimento nato dall'esplorazione: banner per tornarci.
        DnD.uiEsplorazione ? DnD.uiEsplorazione.combatBanner() : null,
        cols.layout));
    g.refresh();
    g.setSelectedCombatant(selectedId);
    logList.scrollTop = logList.scrollHeight;
    scheduleAuto();
  }

  // ---------- Gioco online (rete/sessione.js) ----------
  // Le intenzioni dei giocatori, già verificate dal master (rete/intenzioni.js), si eseguono con le stesse funzioni
  // dei comandi del master. Ogni funzione restituisce { ok, testo, tiro } (tiro: i dadi tirati dal master, per
  // mostrarli anche ai giocatori).
  function eseguito(fn) {
    lastTiro = null;
    const testo = fn();
    const last = combat() && combat().log.length ? combat().log[combat().log.length - 1].text : '';
    return { ok: true, testo: testo || last, tiro: lastTiro };
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
    salvezza: (id, ab, dc, mode) => { lastTiro = null; const r = performSave(id, ab, dc, mode); return { ok: true, testo: r.testo, tiro: lastTiro, success: r.success, total: r.total }; },
    dichiara: (testo, tipo) => eseguito(() => { mutate((c) => log(c, tipo || 'sistema', testo)); return testo; }),
    prossimoTurno: () => eseguito(() => { nextTurn(); return ''; }),
    dadiDiProva: (rng) => { rngProva = rng || null; },
    controllo: (id, kind) => eseguito(() => { mutate((c) => { const t = c.combatants.find((y) => y.id === id); if (t) { t.control = kind; if (kind === 'ia') c.ai.simulated = true; aiPlan = null; } }); return ''; }),
  };

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.combattimento = { title: 'Combattimento', render };
  // Per i test dell'interfaccia: piano corrente ed esecuzione. columns: disposizione a tre colonne riusabile.
  DnD.uiCombattimento = { selectCombatant: (id, source) => selectCombatant(id, source), getGrid: () => grid, columns,
    currentAiPlan, executePlan, undoAiTurn: () => restoreCombat(aiHistory.undo(), 'Turno IA annullato.'), aiHistory, online };
})(globalThis.DnD = globalThis.DnD || {});
