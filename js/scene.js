// Scene e incontri (logica pura). Una scena è un contenitore che collega ciò che esiste già: mappa della sessione,
// incontri (gruppi di creature pronti da lanciare), NPC, eventi, città, quest e reputazione, tesori, pagina delle
// note e collegamenti alle scene successive per esito. Qui: normalizzazione, scaletta (ordine, riordino,
// duplicazione), vista a linea, copia di un incontro dal modello, difficoltà, preparazione del combattimento e
// dell'esplorazione, condizioni di inizio e di fine, riepilogo, distribuzione delle ricompense, effetti su quest e
// fazioni, «Genera incontro», riferimenti mancanti, vista dei giocatori e rimappatura degli id.
(function (DnD) {
  'use strict';

  const K = () => DnD.sceneDati;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v, def, min, max) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : def; };
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const REF = /^[\w-]{1,64}$/;
  const refId = (v) => (typeof v === 'string' && REF.test(v) ? v : '');
  const ids = (v, max) => [...new Set(arr(v).map(refId).filter(Boolean))].slice(0, max);
  const uid = () => DnD.dadi.uid();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const cell = (c) => { c = obj(c); const x = int(c.x, null, 0, 199); const y = int(c.y, null, 0, 199); return x === null || y === null ? null : { x, y }; };

  // Celle scritte come sulla griglia («B4, C4»): colonne a lettere (A, B, … Z, AA…) e righe da 1. Restituisce
  // { cells, bad: [testi non validi] }; il contrario è cellsText.
  function parseCells(text) {
    const cells = [];
    const bad = [];
    for (const part of str(text, 1000).split(/[\s,;]+/).filter(Boolean)) {
      const m = /^([A-Za-z]{1,2})(\d{1,3})$/.exec(part);
      if (!m) { bad.push(part); continue; }
      const x = m[1].toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const y = Number(m[2]) - 1;
      if (x > 199 || y < 0 || y > 199) bad.push(part); else cells.push({ x, y });
    }
    return { cells, bad };
  }
  const cellsText = (cells) => arr(cells).map((c) => DnD.griglia.cellLabel(c.x, c.y)).join(', ');

  // ---------- Normalizzazione ----------
  // Riga di un incontro: creatura della libreria (npc: Standard, Creatura, Boss) o NPC del Mondo (mondo), quantità,
  // partenza (zona dei nemici o celle scelte), fazione (vuota = quella della scheda) e comportamento automatico.
  function normalizeRow(r) {
    r = obj(r);
    const ref = obj(r.ref);
    const s = obj(r.start);
    const kind = ref.kind === 'mondo' ? 'mondo' : 'npc';
    return {
      id: refId(r.id) || uid(),
      ref: { kind, id: refId(ref.id) },
      qty: kind === 'mondo' ? 1 : int(r.qty, 1, 1, 50),
      start: { kind: pick(s.kind, K().STARTS, 'zona'), cells: arr(s.cells).map(cell).filter(Boolean).slice(0, K().MAX.cells) },
      faction: refId(r.faction),
      ai: r.ai !== false,
    };
  }
  function normalizeEnd(e) {
    e = obj(e);
    const kind = pick(e.kind, K().OUTCOMES, 'vittoria');
    const timed = kind === 'round' || kind === 'obiettivo';
    return { id: refId(e.id) || uid(), kind, rounds: timed ? int(e.rounds, kind === 'round' ? 10 : 0, 0, 1000) : 0, text: str(e.text, 200) };
  }
  function normalizeStart(s) {
    s = obj(s);
    return {
      surprised: pick(s.surprised, K().SURPRISE, 'nessuno'), hidden: Boolean(s.hidden), light: pick(s.light, K().LIGHTS, ''),
      weather: str(s.weather, 60), hour: s.hour === null || s.hour === undefined || s.hour === '' ? null : int(s.hour, null, 0, 23),
    };
  }
  const normalizeRewards = (r) => { const out = DnD.eventi.normalizeReward(r); delete out.to; return out; };
  // Stato di svolgimento di una copia nella scena (lanci, esito, sconfitti, ricompense date).
  function normalizeRun(r) {
    if (!r || typeof r !== 'object') return null;
    return {
      launched: int(r.launched, 0, 0, 1000), combatId: refId(r.combatId), outcome: pick(r.outcome, [''].concat(K().OUTCOMES), ''),
      defeated: arr(r.defeated).filter((x) => typeof x === 'string').slice(0, 100).map((x) => x.slice(0, 80)),
      down: arr(r.down).filter((x) => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, 80)),
      xp: int(r.xp, 0, 0, 100000000), rewardsGiven: Boolean(r.rewardsGiven),
    };
  }
  // Incontro: modello della libreria (encounters) o copia indipendente dentro una scena (templateId, run).
  function normalizeEncounter(e) {
    e = obj(e);
    const end = arr(e.end).slice(0, 8).map(normalizeEnd);
    return {
      id: refId(e.id) || uid(),
      name: str(e.name, 80).trim() || 'Incontro',
      templateId: refId(e.templateId),
      creatures: arr(e.creatures).slice(0, K().MAX.creatures).map(normalizeRow),
      rewards: normalizeRewards(e.rewards),
      notes: str(e.notes, 3000),
      tactics: str(e.tactics, 3000),
      start: normalizeStart(e.start),
      end: end.length ? end : [normalizeEnd({ kind: 'vittoria' })],
      run: normalizeRun(e.run),
      sessionId: typeof e.sessionId === 'string' ? e.sessionId.slice(0, 64) : '',
      shared: Boolean(e.shared),
    };
  }
  const normalizeLink = (l) => { l = obj(l); return { id: refId(l.id) || uid(), outcome: pick(l.outcome, K().LINK_OUTCOMES, 'sempre'), label: str(l.label, 80), sceneId: refId(l.sceneId) }; };
  // Effetto su quest o fazioni all'inizio o alla fine della scena (stesse azioni degli eventi).
  function normalizeEffect(x) {
    x = obj(x);
    const a = DnD.eventi.normalizeAction(Object.assign({}, obj(x.action), { kind: obj(x.action).kind === 'reputazione' ? 'reputazione' : 'quest' }));
    return { id: refId(x.id) || uid(), when: x.when === 'fine' ? 'fine' : 'inizio', action: a };
  }
  const normalizeHistory = (h) => { h = obj(h); return { at: typeof h.at === 'string' && !Number.isNaN(Date.parse(h.at)) ? h.at : new Date(0).toISOString(), text: str(h.text, 500) }; };
  function normalizeScene(s) {
    s = obj(s);
    const map = obj(s.map);
    return {
      id: refId(s.id) || uid(),
      title: str(s.title, 80).trim() || 'Scena',
      kind: pick(s.kind, K().KINDS, 'altro'),
      status: pick(s.status, K().STATUSES, 'da-fare'),
      order: int(s.order, 0, 0, 100000),
      // Testo da leggere ai giocatori (HTML sanificato come le note) e rivelato o no (vista dei giocatori).
      readAloud: DnD.note.sanitizeHtml(str(s.readAloud, 20000)),
      revealed: Boolean(s.revealed),
      pageId: refId(s.pageId),
      map: { gridId: refId(map.gridId), entry: map.entry ? cell(map.entry) : null },
      encounters: arr(s.encounters).slice(0, 20).map(normalizeEncounter).map((e) => Object.assign(e, { sessionId: '', shared: false })),
      npcIds: ids(s.npcIds, 30),
      eventIds: ids(s.eventIds, 30),
      cityId: refId(s.cityId),
      treasure: normalizeRewards(s.treasure),
      treasureGiven: Boolean(s.treasureGiven),
      effects: arr(s.effects).slice(0, K().MAX.effects).map(normalizeEffect),
      links: arr(s.links).slice(0, K().MAX.links).map(normalizeLink),
      duration: int(s.duration, 0, 0, 1440),
      tags: [...new Set(arr(s.tags).filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, K().MAX.tags),
      history: arr(s.history).slice(-K().MAX.history).map(normalizeHistory),
      sessionId: typeof s.sessionId === 'string' ? s.sessionId.slice(0, 64) : '',
      shared: Boolean(s.shared),
    };
  }

  // ---------- Scaletta ----------
  const byOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title);
  // Scene della sessione in ordine di scaletta (le condivise compaiono in tutte).
  const sessionScenes = (state, sessionId) => arr(state.scenes).filter((s) => DnD.sessioni.isVisible(s, sessionId)).sort(byOrder);
  const nextOrder = (list) => arr(list).reduce((m, s) => Math.max(m, s.order + 1), 0);
  // Sposta la scena id alla posizione index della scaletta e rinumera l'ordine (0, 1, 2…). Modifica le scene.
  function move(list, id, index) {
    const sorted = arr(list).slice().sort(byOrder);
    const from = sorted.findIndex((s) => s.id === id);
    if (from < 0) return sorted;
    const [s] = sorted.splice(from, 1);
    sorted.splice(Math.max(0, Math.min(sorted.length, index)), 0, s);
    sorted.forEach((x, i) => { x.order = i; });
    return sorted;
  }
  const neighbors = (list, id) => { const sorted = arr(list).slice().sort(byOrder); const i = sorted.findIndex((s) => s.id === id); return { prev: i > 0 ? sorted[i - 1] : null, next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null }; };
  // Duplicato: id nuovi (anche delle copie degli incontri), da fare, senza storico; collegamenti e riferimenti uguali.
  function duplicate(scene, order) {
    const c = clone(scene);
    return normalizeScene(Object.assign(c, {
      id: uid(), title: (scene.title + ' (copia)').slice(0, 80), status: 'da-fare', order, history: [], treasureGiven: false, shared: false,
      encounters: c.encounters.map((e) => Object.assign(e, { id: uid(), run: null })),
      links: c.links.map((l) => Object.assign(l, { id: uid() })),
    }));
  }
  // Ricerca per titolo, tag e testo; filtri per tipo e stato.
  function filter(list, q) {
    q = obj(q);
    const text = str(q.text, 80).trim().toLowerCase();
    return arr(list).filter((s) => (!q.kind || s.kind === q.kind) && (!q.status || s.status === q.status) &&
      (!text || s.title.toLowerCase().includes(text) || s.tags.some((t) => t.toLowerCase().includes(text)) || DnD.note.htmlToText(s.readAloud).toLowerCase().includes(text)));
  }
  // Vista a linea: scene in fila e frecce dei collegamenti (indice di partenza e d'arrivo, esito, destinazione mancante).
  function line(list) {
    const sorted = arr(list).slice().sort(byOrder);
    const index = new Map(sorted.map((s, i) => [s.id, i]));
    const edges = [];
    sorted.forEach((s, i) => {
      for (const l of s.links) edges.push({ from: i, to: index.has(l.sceneId) ? index.get(l.sceneId) : null, outcome: l.outcome, label: l.label || K().OUTCOME_NAMES[l.outcome], missing: !index.has(l.sceneId) });
    });
    return { nodes: sorted, edges };
  }
  // Collegamenti per un esito: quelli con l'esito esatto, poi quelli «sempre».
  function linksFor(scene, outcome) {
    const exact = scene.links.filter((l) => outcome && l.outcome === outcome);
    return exact.concat(scene.links.filter((l) => l.outcome === 'sempre'));
  }

  // ---------- Incontri ----------
  // Copia indipendente di un modello della libreria (lanciarlo o aggiungerlo a una scena non tocca il modello).
  const fromTemplate = (tpl) => normalizeEncounter(Object.assign(clone(tpl), { id: uid(), templateId: tpl.id, run: null, sessionId: '', shared: false,
    creatures: tpl.creatures.map((r) => Object.assign(clone(r), { id: uid() })) }));
  // Scheda di una riga: nemico della libreria o scheda dell'NPC del Mondo (col suo nome); null se eliminata.
  function sourceOf(st, row) {
    if (row.ref.kind === 'mondo') {
      const n = arr(st.worldNpcs).find((x) => x.id === row.ref.id);
      return n ? Object.assign(clone(n.stats), { id: n.id, name: n.name }) : null;
    }
    return arr(st.npcs).find((x) => x.id === row.ref.id) || null;
  }
  const worldNpcOf = (st, row) => (row.ref.kind === 'mondo' ? arr(st.worldNpcs).find((x) => x.id === row.ref.id) || null : null);
  // Fazione di partenza di una riga: quella scelta, altrimenti della scheda/città (nemici) o dell'NPC.
  function rowFaction(st, row, src, sessionId) {
    if (row.faction) return row.faction;
    const v = DnD.fazioni.view(st, sessionId);
    const npc = worldNpcOf(st, row);
    if (npc) return DnD.npc.factionOf(npc, null, v.cities);
    return DnD.fazioni.defaultFactionFor(src, 'npc', { parties: v.parties, cities: v.cities, factions: v.factions });
  }
  const partyFactionOf = (st, sessionId) => { const v = DnD.fazioni.view(st, sessionId); const p = DnD.party.active(v.parties, v.world); return p ? p.factionId : 'giocatori'; };
  // Giocatori dell'incontro: il party attivo (visibili nella sessione), altrimenti tutti i giocatori della sessione.
  function partyPlayers(st, sessionId) {
    const all = DnD.sessioni.visible(st, 'players', sessionId);
    const v = DnD.fazioni.view(st, sessionId);
    const p = DnD.party.active(v.parties, v.world);
    const members = p ? all.filter((x) => p.memberIds.includes(x.id)) : [];
    return members.length ? members : all;
  }
  // Ingresso per difficolta.evaluate: party e gruppi che contano (gli NPC del Mondo entrano ostili al party).
  function difficultyInput(st, enc, players, sessionId) {
    const DF = DnD.difficolta;
    const t = DnD.fazioni.table(DnD.fazioni.view(st, sessionId).factions);
    const pf = partyFactionOf(st, sessionId);
    const rules = DF.tables(st.difficultyRules);
    const creatures = [];
    enc.creatures.forEach((row, i) => {
      const src = sourceOf(st, row);
      if (!src) return;
      const x = { id: 'riga-' + i, faction: rowFaction(st, row, src, sessionId) };
      if (row.ref.kind === 'mondo') Object.assign(x, { npc: { attitude: 'ostile' }, hostileTo: row.faction ? [] : [pf] });
      if (DF.counts(x, t, pf, rules)) creatures.push(DF.group(src, row.qty, { id: row.id }));
    });
    return { party: DF.partyFrom(players), creatures };
  }
  const evaluate = (st, enc, players, sessionId) => DnD.difficolta.evaluate(difficultyInput(st, enc, players, sessionId), st.difficultyRules);

  // ---------- Preparazione del combattimento ----------
  // Griglia vuota con le zone di partenza ai lati (scena senza mappa o con una mappa di esplorazione).
  const defaultGrid = () => ({ id: '', name: 'Scontro', w: 20, h: 14, feetPerCell: 5, structures: [], items: [], labels: [], tileMap: null, positions: [], background: null,
    zones: [{ id: uid(), kind: 'giocatori', x: 1, y: 4, w: 3, h: 6 }, { id: uid(), kind: 'nemici', x: 16, y: 4, w: 3, h: 6 }] });
  // Stato del combattimento di un incontro: giocatori nella zona di partenza (o vicino al punto di entrata),
  // creature nelle loro celle o nella zona dei nemici, fazioni, IA, sorpresa e nemici nascosti. Non avvia nulla se
  // opts.start !== 'avvia'. opts: { players, rng, start, sessionId }. Restituisce { combat, unplaced, missing, lines }.
  function buildCombat(st, scene, enc, opts) {
    const R = DnD.regole;
    const G = DnD.griglia;
    const C = DnD.condizioni;
    const rng = opts.rng || DnD.dadi.randomInt;
    const players = arr(opts.players);
    const pf = partyFactionOf(st, opts.sessionId);
    const lines = [];
    const missing = [];
    const combatants = DnD.combattenti.createCombatants(players, [], st.races, rng, st.spells, st.equipment);
    const rowOf = new Map();
    for (const row of enc.creatures) {
      const src = sourceOf(st, row);
      if (!src) { missing.push(row); continue; }
      const made = DnD.combattenti.createCombatants([], [{ npc: src, quantity: row.qty }], st.races, rng, st.spells, st.equipment);
      const npc = worldNpcOf(st, row);
      for (const x of made) {
        x.control = row.ai ? 'ia' : 'manuale';
        x.faction = rowFaction(st, row, src, opts.sessionId);
        if (npc) Object.assign(x, { npc: DnD.npc.combatData(npc, null, '', 'ostile'), hostileTo: row.faction ? [] : [pf] });
        if (enc.start.hidden) x.hidden = true;
        rowOf.set(x.id, row);
        combatants.push(x);
      }
    }
    if (missing.length) lines.push('⚠ ' + missing.length + (missing.length === 1 ? ' creatura non più presente: saltata.' : ' creature non più presenti: saltate.'));
    const v = DnD.fazioni.view(st, opts.sessionId);
    const fctx = { parties: v.parties, cities: v.cities, factions: v.factions };
    for (const x of combatants) if (x.kind === 'player') x.faction = DnD.fazioni.defaultFactionFor(players.find((p) => p.id === x.sourceId), 'player', fctx);
    const saved = scene.map.gridId ? arr(st.savedGrids).find((g) => g.id === scene.map.gridId && g.kind !== 'esplorazione') : null;
    if (scene.map.gridId && !saved) lines.push('⚠ La mappa della scena non è una griglia di battaglia (o non esiste più): se ne usa una vuota.');
    const combat = {
      id: uid(), phase: 'iniziativa', round: 1, currentId: null, combatants, log: [],
      ai: { simulated: enc.creatures.some((r) => r.ai), mode: 'passo', delay: 1, seed: rng(2147483646) },
      grid: Object.assign({ structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false, sourceGridId: null }, G.gridProps({})),
      scene: { sceneId: scene.id, encounterId: enc.id },
    };
    G.applySavedGrid(combat, saved || defaultGrid(), uid);
    if (!saved) combat.grid.sourceGridId = null;
    const board = () => G.boardOf(combat.grid, combat.combatants);
    // Punto di entrata: i giocatori partono lì vicino (al posto della loro zona).
    if (scene.map.entry && saved) {
      const ps = combatants.filter((x) => x.kind === 'player');
      for (const x of ps) x.pos = null;
      for (const x of ps) x.pos = G.findFreeSpot(scene.map.entry.x, scene.map.entry.y, (cx, cy) => G.canPlaceToken(board(), x.id, cx, cy), combat.grid);
    }
    // Creature: prima quelle con le celle scelte, poi le altre nella zona dei nemici.
    const foes = combatants.filter((x) => x.kind !== 'player');
    for (const x of foes) x.pos = null;
    const used = new Map();
    for (const x of foes) {
      const row = rowOf.get(x.id);
      if (!row || row.start.kind !== 'celle') continue;
      const k = used.get(row.id) || 0;
      used.set(row.id, k + 1);
      const c = row.start.cells[k];
      if (c && G.canPlaceToken(board(), x.id, c.x, c.y)) x.pos = { x: c.x, y: c.y };
    }
    const unplaced = G.placeInZones(combat).map((x) => x.name);
    // Condizioni di inizio: sorpresa (fino alla fine del primo turno), nemici nascosti, luce, meteo e ora.
    const st0 = enc.start;
    if (st0.surprised !== 'nessuno') {
      const who = combatants.filter((x) => (st0.surprised === 'giocatori') === (x.kind === 'player'));
      for (const x of who) C.apply(x, { type: K().SURPRISED_CONDITION, source: { name: 'sorpresa' }, duration: { kind: 'fine-turno', who: x.id } });
      lines.push('❗ Sorpresa: ' + (who.map((x) => x.name).join(', ') || 'nessuno') + (who.length > 1 ? ' non agiscono' : ' non agisce') + ' nel primo turno.');
    }
    if (st0.hidden) lines.push('👁 I nemici partono nascosti ai giocatori.');
    const env = [st0.light ? K().LIGHT_NAMES[st0.light] : '', st0.weather, st0.hour === null ? '' : 'ore ' + String(st0.hour).padStart(2, '0') + ':00'].filter(Boolean);
    if (env.length) lines.push('🌙 ' + env.join(' · ') + '.');
    DnD.modello.pushLog(combat, 'sistema', '🎬 Scena «' + scene.title + '», incontro «' + enc.name + '»: combattimento ' + (opts.start === 'avvia' ? 'avviato' : 'preparato') + '.');
    for (const l of lines) DnD.modello.pushLog(combat, 'sistema', l);
    if (opts.start === 'avvia') {
      const sorted = R.sortByInitiative(combat.combatants);
      combat.phase = 'attivo';
      combat.currentId = R.firstTurn(sorted);
      for (const x of combat.combatants) DnD.movimento.resetTurn(x);
      DnD.modello.pushLog(combat, 'sistema', 'Inizia il combattimento. Ordine: ' + sorted.map((x) => x.name + ' (' + x.initiative + ')').join(', ') + '.');
    }
    return { combat, unplaced, missing, lines };
  }
  // Esplorazione della mappa della scena con il gruppo al punto di entrata (o nella zona dei giocatori).
  function buildExploration(st, scene, players, seed) {
    const map = arr(st.savedGrids).find((g) => g.id === scene.map.gridId && g.kind === 'esplorazione');
    if (!map) return null;
    const X = DnD.esplorazione;
    const e = X.create(map, players, seed);
    if (scene.map.entry) e.parties[0].pos = { x: Math.min(map.w - 1, scene.map.entry.x), y: Math.min(map.h - 1, scene.map.entry.y) };
    const w = { st, ex: e, grid: map };
    X.reveal(w);
    X.log(w, '🎬 Scena «' + scene.title + '»: inizia l\'esplorazione di «' + map.name + '» con ' + (players.map((p) => p.name).join(', ') || 'nessun personaggio') + '.', 'sistema');
    return e;
  }

  // ---------- Fine dell'incontro ----------
  // Condizione di fine raggiunta (la prima dell'elenco): vittoria (fazioni ostili sconfitte o in fuga), sconfitta
  // (giocatori a terra), fuga (giocatori fuggiti), round massimo o obiettivo a tempo (superato il round indicato).
  function endCheck(combat, enc, t, partyFaction) {
    const players = combat.combatants.filter((x) => x.kind === 'player');
    for (const e of enc.end) {
      if (e.kind === 'vittoria' && DnD.fazioni.combatOver(combat.combatants, t, partyFaction).over) return { outcome: 'vittoria', text: 'tutti i nemici sono sconfitti o in fuga' };
      if (e.kind === 'sconfitta' && players.length && players.every((x) => x.hp <= 0 || x.dead)) return { outcome: 'sconfitta', text: 'tutti i giocatori sono a terra' };
      if (e.kind === 'fuga' && players.length && players.every((x) => x.fled || x.hp <= 0) && players.some((x) => x.fled)) return { outcome: 'fuga', text: 'il party è fuggito' };
      if ((e.kind === 'round' || e.kind === 'obiettivo') && e.rounds && combat.round > e.rounds) return { outcome: e.kind, text: e.kind === 'round' ? 'superato il round ' + e.rounds : (e.text || 'obiettivo') + ' (' + e.rounds + ' round)' };
    }
    return null;
  }
  // Riepilogo di un combattimento finito: creature ostili sconfitte (con i PE dal CS), giocatori a terra.
  function summary(st, combat, t, partyFaction) {
    const DF = DnD.difficolta;
    const probe = { id: '__party', faction: partyFaction || 'giocatori' };
    const foes = combat.combatants.filter((x) => x.kind !== 'player' && DnD.fazioni.ostili(probe, x, t));
    const defeated = foes.filter((x) => x.hp <= 0 || x.dead);
    const crOfX = (x) => { const src = arr(st.npcs).find((n) => n.id === x.sourceId); return src ? DF.crOf(src) : x.creature ? x.creature.cr : '0'; };
    return {
      defeated: defeated.map((x) => x.name), fled: foes.filter((x) => x.fled && x.hp > 0).map((x) => x.name),
      down: combat.combatants.filter((x) => x.kind === 'player' && x.hp <= 0).map((x) => x.name),
      xp: defeated.reduce((s, x) => s + DF.xpOf(crOfX(x)), 0), round: combat.round,
    };
  }

  // ---------- Ricompense ----------
  // Distribuisce monete, oggetti e PE ai giocatori (schede, modificate). rewards: { xp, coins, items: [{ equipmentId,
  // qty, to }] }; opts: { coinsTo: id del giocatore | 'dividi', equipment }. Le monete divise passano in rame e tornano
  // in mo/ma/mr (il resto al primo). Restituisce le righe per il registro.
  function distribute(rewards, players, opts) {
    const A = DnD.attrezzatura;
    const NP = DnD.npc;
    const list = arr(players);
    const lines = [];
    if (!list.length) return ['⚠ Ricompense: nessun giocatore.'];
    const r = obj(rewards);
    if (r.xp > 0) {
      const each = Math.floor(r.xp / list.length);
      for (const p of list) p.xp = (p.xp || 0) + each;
      lines.push('✨ ' + r.xp + ' PE: ' + each + ' a testa (' + list.map((p) => p.name).join(', ') + ').');
    }
    const coins = A.normalizeCoins(r.coins);
    const cp = NP.toCopper(coins);
    if (cp > 0) {
      if (opts.coinsTo === 'dividi') {
        const each = Math.floor(cp / list.length);
        list.forEach((p, i) => { p.coins = A.addCoins(A.normalizeCoins(p.coins), NP.fromCopper(each + (i === 0 ? cp - each * list.length : 0))); });
        lines.push('💰 ' + A.formatCoins(coins) + ' divise: ' + A.formatCoins(NP.fromCopper(each)) + ' a testa' + (cp - each * list.length ? ' (il resto a ' + list[0].name + ')' : '') + '.');
      } else {
        const p = list.find((x) => x.id === opts.coinsTo) || list[0];
        p.coins = A.addCoins(A.normalizeCoins(p.coins), coins);
        lines.push('💰 ' + A.formatCoins(coins) + ' a ' + p.name + '.');
      }
    }
    for (const it of arr(r.items)) {
      const eq = arr(opts.equipment).find((e) => e.id === it.equipmentId);
      if (!eq) { lines.push('⚠ Oggetto non più presente nell\'Attrezzatura: saltato.'); continue; }
      const p = list.find((x) => x.id === it.to) || list[0];
      p.inventory = arr(p.inventory);
      A.addToInventory(p.inventory, eq.id, it.qty || 1);
      lines.push('🎁 ' + (it.qty || 1) + '× ' + eq.name + ' a ' + p.name + '.');
    }
    return lines.length ? lines : ['Nessuna ricompensa da distribuire.'];
  }

  // ---------- Svolgimento ----------
  const historyAdd = (scene, text, now) => { scene.history.push({ at: (now || new Date()).toISOString(), text: str(text, 500) }); if (scene.history.length > K().MAX.history) scene.history.shift(); };
  // Effetti della scena (quest e reputazione) all'inizio o alla fine. Modifica il Mondo della sessione.
  function applyEffects(st, sessionId, scene, when, nowHours) {
    const v = DnD.fazioni.view(st, sessionId);
    const lines = [];
    for (const e of scene.effects.filter((x) => x.when === when)) {
      const a = e.action;
      if (a.kind === 'quest') lines.push(...DnD.quest.op(v, a.op, a.questId, a.objectiveId, a.n, nowHours || 0));
      else {
        const f = v.factions.find((x) => x.id === a.factionId);
        if (!f) { lines.push('⚠ Reputazione: fazione eliminata.'); continue; }
        const r = DnD.fazioni.changeReputation({ world: v.world, party: DnD.party.active(v.parties, v.world) }, a.factionId, a.delta, a.reason || 'scena «' + scene.title + '»', 'scena');
        lines.push('⚑ Reputazione con «' + f.name + '»: ' + (r ? (r.delta > 0 ? '+' : '') + r.delta + ' (' + r.after + ')' : 'invariata') + '.');
      }
    }
    return lines;
  }
  const sessionOf = (st, sessionId) => st.sessions.find((s) => s.id === sessionId);
  // Avvia la scena: In corso, scena corrente della sessione, storico ed effetti «inizio». Restituisce le righe.
  function startScene(st, sessionId, sceneId, now) {
    const scene = arr(st.scenes).find((s) => s.id === sceneId);
    const se = sessionOf(st, sessionId);
    if (!scene || !se) return [];
    const again = scene.status === 'conclusa';
    scene.status = 'in-corso';
    se.currentSceneId = scene.id;
    historyAdd(scene, again ? 'Scena riaperta.' : 'Scena avviata.', now);
    const lines = applyEffects(st, sessionId, scene, 'inizio', se.restClock);
    for (const l of lines) historyAdd(scene, l, now);
    return lines;
  }
  // Conclude (o salta) la scena: stato, storico, effetti «fine» (non per le saltate), proposte di scena successiva.
  function concludeScene(st, sessionId, sceneId, outcome, now, skipped) {
    const scene = arr(st.scenes).find((s) => s.id === sceneId);
    const se = sessionOf(st, sessionId);
    if (!scene || !se) return { lines: [], next: [] };
    scene.status = skipped ? 'saltata' : 'conclusa';
    if (se.currentSceneId === scene.id) se.currentSceneId = '';
    historyAdd(scene, skipped ? 'Scena saltata.' : 'Scena conclusa' + (outcome ? ' (' + K().OUTCOME_NAMES[outcome].toLowerCase() + ')' : '') + '.', now);
    const lines = skipped ? [] : applyEffects(st, sessionId, scene, 'fine', se.restClock);
    for (const l of lines) historyAdd(scene, l, now);
    const visible = new Set(sessionScenes(st, sessionId).map((s) => s.id));
    return { lines, next: linksFor(scene, outcome).filter((l) => visible.has(l.sceneId)).map((l) => ({ link: l, scene: st.scenes.find((s) => s.id === l.sceneId) })) };
  }
  // Torna alla scena precedente: la corrente torna «Da fare» (lo storico resta).
  function reopenScene(st, sessionId, sceneId, now) {
    const scene = arr(st.scenes).find((s) => s.id === sceneId);
    const se = sessionOf(st, sessionId);
    if (!scene || !se) return;
    if (scene.status === 'in-corso') scene.status = 'da-fare';
    if (se.currentSceneId === scene.id) se.currentSceneId = '';
    historyAdd(scene, 'Si torna alla scena precedente.', now);
  }
  // Lancio di un incontro della scena: contatore, combattimento collegato, storico.
  function recordLaunch(scene, enc, combatId, now) {
    enc.run = Object.assign(normalizeRun(enc.run) || normalizeRun({}), { launched: ((enc.run && enc.run.launched) || 0) + 1, combatId, outcome: '' });
    historyAdd(scene, '⚔ Incontro «' + enc.name + '» lanciato.', now);
  }
  function recordOutcome(scene, enc, sum, outcome, now) {
    enc.run = Object.assign(normalizeRun(enc.run) || normalizeRun({}), { outcome: outcome || '', defeated: sum.defeated, down: sum.down, xp: sum.xp });
    historyAdd(scene, '🏁 «' + enc.name + '»: ' + (outcome ? K().OUTCOME_NAMES[outcome] : 'concluso') + ', round ' + sum.round + '. Sconfitti: ' + (sum.defeated.join(', ') || 'nessuno') +
      (sum.down.length ? '. A terra: ' + sum.down.join(', ') : '') + '.', now);
  }
  // Scena e incontro di un combattimento (combat.scene), null se il combattimento non viene da una scena.
  function ofCombat(st, combat) {
    if (!combat || !combat.scene) return null;
    const scene = arr(st.scenes).find((s) => s.id === combat.scene.sceneId);
    const enc = scene ? scene.encounters.find((e) => e.id === combat.scene.encounterId) : null;
    return scene && enc ? { scene, enc } : null;
  }

  // ---------- Genera incontro ----------
  // Creature candidate dalla libreria della sessione per tema: '' (tutte), 'tipo:<tipo>' (le standard contano come
  // umanoidi) o 'bioma:<id>' (le creature della tabella degli incontri del bioma).
  function candidates(st, sessionId, theme) {
    const all = DnD.sessioni.visible(st, 'npcs', sessionId);
    const t = str(theme, 80);
    if (t.startsWith('tipo:')) return all.filter((c) => (DnD.boss.isMonster(c) ? c.ctype : 'umanoide') === t.slice(5));
    if (t.startsWith('bioma:')) {
      const b = arr(st.biomes).find((x) => x.id === t.slice(6));
      const want = new Set(b ? b.encounters.filter((r) => r.kind === 'creatura').map((r) => r.refId) : []);
      return all.filter((c) => want.has(c.id));
    }
    return all;
  }
  // Gruppi (uno o due tipi: un capo e dei gregari) che portano l'incontro alla fascia scelta con il party; ne
  // sceglie fino a GEN_OPTIONS a caso (rng come i dadi). Restituisce { options: [{ rows, result }], total }.
  function generate(st, sessionId, opts) {
    const DF = DnD.difficolta;
    const rules = DF.tables(st.difficultyRules);
    const party = DF.partyFrom(opts.players);
    const list = candidates(st, sessionId, opts.theme);
    const max = K().GEN_MAX_PER_KIND;
    const found = [];
    const test = (groups) => { const r = DF.evaluate({ party, creatures: groups.map((g) => DF.group(g.src, g.qty)) }, rules); return r.band === opts.target ? r : null; };
    for (const a of list) {
      for (let n = 1; n <= max; n++) { const r = test([{ src: a, qty: n }]); if (r) found.push({ groups: [{ src: a, qty: n }], result: r }); }
      for (const b of list) {
        if (b.id === a.id || DF.xpOf(DF.crOf(b)) >= DF.xpOf(DF.crOf(a))) continue;
        for (let n = 1; n <= max; n++) { const r = test([{ src: a, qty: 1 }, { src: b, qty: n }]); if (r) found.push({ groups: [{ src: a, qty: 1 }, { src: b, qty: n }], result: r }); }
      }
    }
    const pool = found.slice();
    const options = [];
    const rng = opts.rng || DnD.dadi.randomInt;
    while (pool.length && options.length < K().GEN_OPTIONS) options.push(pool.splice(rng(pool.length) - 1, 1)[0]);
    return {
      total: found.length,
      options: options.map((o) => ({ rows: o.groups.map((g) => normalizeRow({ ref: { kind: 'npc', id: g.src.id }, qty: g.qty })), names: o.groups.map((g) => g.qty + '× ' + g.src.name), result: o.result })),
    };
  }

  // ---------- Riferimenti mancanti ----------
  // Avvisi per ciò che una scena (o un incontro) usa e non esiste più: le voci restano, disattivate.
  function encounterMissing(st, enc) {
    const out = [];
    enc.creatures.forEach((r) => { if (!sourceOf(st, r)) out.push('creatura di «' + enc.name + '» eliminata'); });
    if (enc.creatures.some((r) => r.faction && !arr(st.factions).some((f) => f.id === r.faction))) out.push('fazione di «' + enc.name + '» eliminata');
    for (const it of enc.rewards.items) if (!arr(st.equipment).some((e) => e.id === it.equipmentId)) out.push('oggetto del tesoro di «' + enc.name + '» eliminato');
    return out;
  }
  function missingRefs(st, scene, sessionId) {
    const out = [];
    const se = sessionOf(st, sessionId);
    if (scene.map.gridId && !arr(st.savedGrids).some((g) => g.id === scene.map.gridId)) out.push('mappa eliminata');
    for (const e of scene.encounters) out.push(...encounterMissing(st, e));
    if (scene.npcIds.some((id) => !arr(st.worldNpcs).some((n) => n.id === id))) out.push('NPC eliminato');
    if (scene.eventIds.some((id) => !arr(st.events).some((e) => e.id === id))) out.push('evento eliminato');
    if (scene.cityId && !arr(st.cities).some((c) => c.id === scene.cityId)) out.push('città eliminata');
    for (const it of scene.treasure.items) if (!arr(st.equipment).some((e) => e.id === it.equipmentId)) out.push('oggetto del tesoro eliminato');
    for (const e of scene.effects) {
      if (e.action.kind === 'quest' && !arr(st.quests).some((q) => q.id === e.action.questId)) out.push('quest eliminata');
      if (e.action.kind === 'reputazione' && !arr(st.factions).some((f) => f.id === e.action.factionId)) out.push('fazione eliminata');
    }
    if (scene.links.some((l) => !arr(st.scenes).some((s) => s.id === l.sceneId))) out.push('scena collegata eliminata');
    if (scene.pageId && se && !se.pages.some((p) => p.id === scene.pageId)) out.push('pagina delle note eliminata');
    return [...new Set(out)];
  }

  // ---------- Note e giocatori ----------
  // Scena della sessione collegata a una pagina delle note (per risalire dalla pagina alla scena).
  const sceneForPage = (st, sessionId, pageId) => (pageId ? sessionScenes(st, sessionId).find((s) => s.pageId === pageId) || null : null);
  // Online (futuro): ciò che un giocatore può vedere di una scena. Il testo da leggere solo se il master lo rivela;
  // mai note, incontri, tattiche, tesori, collegamenti o storico.
  function statoScenaPerGiocatore(scene) {
    return { id: scene.id, title: scene.title, kind: scene.kind, status: scene.status, readAloud: scene.revealed ? scene.readAloud : null };
  }

  // ---------- Duplicazione e importazione di sessioni ----------
  // Riferimenti di scene e incontri della sessione dopo un cambio di id (griglie, creature, NPC, fazioni, città,
  // quest, scene collegate, modelli degli incontri). Modifica lo stato.
  function remap(state, sessionId, idMap) {
    const map = (id) => (id && idMap.has(id) ? idMap.get(id) : id);
    const mine = (key) => arr(state[key]).filter((x) => x.sessionId === sessionId && !x.shared);
    const encounter = (e) => {
      e.templateId = map(e.templateId);
      for (const r of e.creatures) { r.ref.id = map(r.ref.id); r.faction = map(r.faction); }
    };
    for (const e of mine('encounters')) encounter(e);
    for (const s of mine('scenes')) {
      s.map.gridId = map(s.map.gridId);
      s.encounters.forEach(encounter);
      s.npcIds = s.npcIds.map(map);
      s.cityId = map(s.cityId);
      for (const l of s.links) l.sceneId = map(l.sceneId);
      for (const e of s.effects) { if (e.action.questId) e.action.questId = map(e.action.questId); if (e.action.factionId) e.action.factionId = map(e.action.factionId); }
    }
  }
  // Riferimento della scena nel combattimento salvato.
  const normalizeCombatRef = (r) => (r && typeof r === 'object' && refId(r.sceneId) ? { sceneId: refId(r.sceneId), encounterId: refId(r.encounterId) } : null);
  // Incontri d'esempio, condivisi, della prima sessione.
  const examples = (sessionId) => K().EXAMPLES.map((e) => normalizeEncounter(Object.assign(clone(e), { sessionId })));

  DnD.scene = {
    parseCells, cellsText, normalizeScene, normalizeEncounter, normalizeRow, normalizeEnd, normalizeStart, normalizeLink, normalizeEffect, normalizeRun, normalizeCombatRef,
    sessionScenes, nextOrder, move, neighbors, duplicate, filter, line, linksFor,
    fromTemplate, sourceOf, rowFaction, partyPlayers, partyFactionOf, difficultyInput, evaluate,
    defaultGrid, buildCombat, buildExploration, endCheck, summary, distribute,
    applyEffects, startScene, concludeScene, reopenScene, recordLaunch, recordOutcome, ofCombat,
    candidates, generate, encounterMissing, missingRefs, sceneForPage, statoScenaPerGiocatore, remap, examples,
  };
})(globalThis.DnD = globalThis.DnD || {});
