// Fazioni e reputazione (logica pura). Una fazione ha nome, colore, icona, descrizione, note e la sua riga
// della matrice delle relazioni (come vede le altre: Alleata, Amichevole, Neutrale, Ostile, In guerra).
// relazione(a, b) è l'unica fonte di verità: la usano IA, bersagli, avvisi degli effetti ad area, fine del
// combattimento e conversione degli NPC neutrali. La reputazione (-100…+100) del party, e facoltativamente di
// ogni giocatore, verso ogni fazione ha soglie modificabili ed effetti su prezzi, città, NPC e accessi.
// Livello regole, base del gruppo Mondo. Espone DnD.fazioni (unica fonte dell'ostilità: relazione, ostili, alleati);
// usa DnD.modello, dati/mondo, dadi, icone. Non deve toccare DOM, disco o rete né chiamare party, quest o sessioni.
(function (DnD) {
  'use strict';

  const K = () => DnD.mondoDati;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const HEX = /^#[0-9a-f]{6}$/i;
  const ID = /^[\w-]{1,64}$/;
  const idOf = (v) => (typeof v === 'string' && ID.test(v) ? v : DnD.dadi.uid());
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ---------- Normalizzazione ----------
  function normalizeRelations(r, selfId) {
    const out = {};
    for (const [k, v] of Object.entries(obj(r))) if (ID.test(k) && k !== selfId && K().LEVELS.includes(v)) out[k] = v;
    return out;
  }

  function normalizeFaction(f) {
    f = obj(f);
    const id = idOf(f.id);
    const builtin = K().BUILTIN.find((b) => b.id === id) || null;
    const color = typeof f.color === 'string' && HEX.test(f.color) ? f.color.toLowerCase() : builtin ? builtin.color : '#8a8f9c';
    return {
      id,
      name: str(f.name, 60) || (builtin ? builtin.name : 'Fazione'),
      color,
      icon: DnD.icone.normalizeIcon(f.icon || (builtin ? builtin.icon : { kind: 'shape', shape: 'cerchio', color }), false),
      description: str(f.description, 3000),
      notes: str(f.notes, 5000),
      builtin: Boolean(builtin),
      relations: normalizeRelations(f.relations, id),
      // Predefinite: sempre condivise con tutte le sessioni.
      sessionId: typeof f.sessionId === 'string' ? f.sessionId.slice(0, 64) : '',
      shared: builtin ? true : Boolean(f.shared),
    };
  }

  function builtinFactions(sessionId) {
    return K().BUILTIN.map((b) => normalizeFaction(Object.assign(clone(b), { relations: K().BUILTIN_RELATIONS[b.id], sessionId: sessionId || '', shared: true })));
  }

  // Aggiunge le predefinite mancanti (in testa, nell'ordine). Modifica e restituisce la lista.
  function ensureBuiltins(list, sessionId) {
    const missing = builtinFactions(sessionId).filter((b) => !list.some((f) => f.id === b.id));
    list.unshift(...missing);
    return list;
  }

  // Soglie della reputazione (modificabili per sessione): ordinate, la prima parte sempre da -100.
  function normalizeThresholds(t) {
    const base = K().THRESHOLDS;
    const list = Array.isArray(t) && t.length ? t : base;
    const out = list.slice(0, 12).map((x, i) => ({
      id: str(obj(x).id, 40) || (base[i] ? base[i].id : 'soglia' + i),
      name: str(obj(x).name, 40) || (base[i] ? base[i].name : 'Soglia'),
      min: int(obj(x).min, base[i] ? base[i].min : 0, K().REP_MIN, K().REP_MAX),
    })).sort((a, b) => a.min - b.min);
    out[0].min = K().REP_MIN;
    return out;
  }

  const repValue = (v) => int(v, 0, K().REP_MIN, K().REP_MAX);
  function normalizeRepMap(m) {
    const out = {};
    for (const [k, v] of Object.entries(obj(m))) if (ID.test(k)) out[k] = repValue(v);
    return out;
  }

  function normalizeRepEntry(e) {
    e = obj(e);
    return {
      id: idOf(e.id),
      at: typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at)) ? e.at : new Date(0).toISOString(),
      partyId: str(e.partyId, 64), playerId: str(e.playerId, 64), factionId: str(e.factionId, 64),
      delta: int(e.delta, 0, -200, 200), before: repValue(e.before), after: repValue(e.after),
      reason: str(e.reason, 300), source: str(e.source, 40), reverted: Boolean(e.reverted),
    };
  }

  function normalizeVars(v) {
    const out = {};
    for (const [k, x] of Object.entries(obj(v)).slice(0, 200)) {
      const key = String(k).slice(0, 40);
      out[key] = typeof x === 'number' || typeof x === 'boolean' ? x : str(x, 200);
    }
    return out;
  }
  // Variabili condivise della sessione: quelle dell'esplorazione, se c'è, altrimenti quelle del Mondo.
  const variables = (session) => (session.exploration ? session.exploration.variables : session.world.variables);

  // Stato del Mondo della sessione: party attivo, simmetria della matrice, soglie, reputazioni dei singoli
  // giocatori, registro delle variazioni, regole degli NPC neutrali e stato di quest e NPC.
  // opts.diarioQuest: normalizzazione del diario delle quest (quest.normalizeJournal), passata da chi carica lo stato:
  // le quest stanno sopra le fazioni. Senza, il diario resta vuoto.
  function normalizeWorld(w, opts) {
    w = obj(w);
    const diario = opts && opts.diarioQuest;
    const playerRep = {};
    for (const [pid, m] of Object.entries(obj(w.playerRep))) if (ID.test(pid)) playerRep[pid] = normalizeRepMap(m);
    return {
      activePartyId: str(w.activePartyId, 64),
      symmetric: w.symmetric !== false,
      perPlayer: Boolean(w.perPlayer),
      blockHostile: w.blockHostile !== false,
      thresholds: normalizeThresholds(w.thresholds),
      playerRep,
      repLog: arr(w.repLog).slice(-K().REP_LOG_MAX).map(normalizeRepEntry),
      // Diario delle quest della sessione: stato, avanzamento e date (quest.js).
      quests: diario ? diario(w.quests) : {},
      // Variabili di sessione fuori dall'esplorazione (dialoghi e quest); con un'esplorazione in corso valgono le sue.
      variables: normalizeVars(w.variables),
      // Undo delle conversioni degli NPC neutrali (npc.js): istantanee da ripristinare.
      provocations: arr(w.provocations).slice(-50).map((p) => {
        p = obj(p);
        return {
          id: idOf(p.id), at: typeof p.at === 'string' ? p.at : '', text: str(p.text, 300), combatId: str(p.combatId, 64),
          factions: p.factions && typeof p.factions === 'object' ? Object.fromEntries(Object.entries(p.factions).filter(([k]) => ID.test(k)).map(([k, v]) => [k, normalizeRelations(v, k)])) : null,
          combatants: arr(p.combatants).slice(0, 200).map((b) => ({ id: str(obj(b).id, 64), hostileTo: arr(obj(b).hostileTo).filter((x) => typeof x === 'string' && ID.test(x)), attitude: K().ATTITUDES.includes(obj(b).attitude) ? obj(b).attitude : 'indifferente' })),
          repIds: arr(p.repIds).filter((x) => typeof x === 'string' && ID.test(x)).slice(0, 20),
          reverted: Boolean(p.reverted),
        };
      }),
    };
  }

  // ---------- Relazioni ----------
  const byIdOf = (factions) => (factions instanceof Map ? factions : new Map(arr(factions).map((f) => [f.id, f])));

  // Relazione della fazione a verso la fazione b (come a vede b). Stessa fazione = Alleata; fazioni sconosciute
  // usano le relazioni di partenza delle predefinite o Neutrale.
  function relazione(a, b, factions) {
    if (!a || !b) return 'neutrale';
    if (a === b) return 'alleata';
    const fa = byIdOf(factions).get(a);
    if (fa && fa.relations[b]) return fa.relations[b];
    const base = K().BUILTIN_RELATIONS[a];
    if (!fa && base && base[b]) return base[b];
    return 'neutrale';
  }
  const isHostileLevel = (level) => K().HOSTILE_LEVELS.includes(level);
  const isAllyLevel = (level) => K().ALLY_LEVELS.includes(level);

  // Imposta la relazione (e, se simmetrica, anche quella inversa). Modifica le fazioni nella lista.
  function setRelation(factions, a, b, level, symmetric) {
    if (a === b || !K().LEVELS.includes(level)) return;
    const map = byIdOf(factions);
    const fa = map.get(a);
    const fb = map.get(b);
    if (fa) fa.relations[b] = level;
    if (symmetric && fb) fb.relations[a] = level;
  }

  // Matrice completa (righe = chi guarda) per le viste a matrice ed elenco.
  function matrix(factions) {
    const list = arr(factions);
    return list.map((a) => ({ id: a.id, cells: list.map((b) => ({ id: b.id, level: relazione(a.id, b.id, list) })) }));
  }
  // Coppie con relazioni diverse nei due versi (per la vista asimmetrica).
  function asymmetries(factions) {
    const list = arr(factions);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ab = relazione(list[i].id, list[j].id, list);
        const ba = relazione(list[j].id, list[i].id, list);
        if (ab !== ba) out.push({ a: list[i].id, b: list[j].id, ab, ba });
      }
    }
    return out;
  }

  // Istantanea delle fazioni per il combattimento (stato puro passato all'IA): { id: { name, color, icon, relations } }.
  function table(factions) {
    const out = {};
    for (const f of arr(factions)) out[f.id] = { id: f.id, name: f.name, color: f.color, icon: f.icon, relations: Object.assign({}, f.relations) };
    return out;
  }
  const tableList = (t) => (t ? Object.values(t) : []);

  // Relazione tra due combattenti: quella delle loro fazioni, corretta dalle ostilità personali degli NPC
  // provocati (hostileTo: fazioni o combattenti verso cui l'NPC è ostile, valida nei due versi) e da chi
  // «aiuta il party» (amichevole con i Giocatori e ostile a chi è ostile a loro).
  function relazioneCombattenti(a, b, t) {
    if (!a || !b) return 'neutrale';
    if (a.id && a.id === b.id) return 'alleata';
    const list = tableList(t);
    const personal = (x, y) => arr(x.hostileTo).some((h) => h === y.faction || h === y.id);
    if (personal(a, b) || personal(b, a)) return 'ostile';
    const helper = (x) => x.npc && x.npc.defend === 'party' && x.npc.attitude === 'amichevole';
    const party = 'giocatori';
    if (helper(a) && b.faction !== party && a.faction !== b.faction) {
      if (isHostileLevel(relazione(party, b.faction, list)) || isHostileLevel(relazione(b.faction, party, list))) return 'ostile';
      if (b.faction === a.faction) return 'alleata';
    }
    if (helper(b) && a.faction !== party && a.faction !== b.faction) {
      if (isHostileLevel(relazione(party, a.faction, list)) || isHostileLevel(relazione(a.faction, party, list))) return 'ostile';
    }
    if (helper(a) && b.faction === party) return 'amichevole';
    if (helper(b) && a.faction === party) return 'amichevole';
    return relazione(a.faction, b.faction, list);
  }
  const ostili = (a, b, t) => a.id !== b.id && isHostileLevel(relazioneCombattenti(a, b, t));
  const alleati = (a, b, t) => a.id === b.id || isAllyLevel(relazioneCombattenti(a, b, t));

  // Effetto ad area: chi colpisce che non sia ostile a chi la lancia (per l'avviso).
  function areaWarnings(caster, targets, t) {
    return arr(targets).filter((x) => x.id !== caster.id && !ostili(caster, x, t)).map((x) => ({ id: x.id, name: x.name, level: relazioneCombattenti(caster, x, t) }));
  }

  // Fine del combattimento: tutte le fazioni ostili al party sconfitte (a terra) o in fuga (fled), qualunque sia il tipo.
  function combatOver(combatants, t, partyFaction) {
    const party = partyFaction || 'giocatori';
    const members = arr(combatants).filter((x) => x.faction === party);
    const probe = members[0] || { id: '__party', faction: party };
    const foes = arr(combatants).filter((x) => x.faction !== party && ostili(probe, x, t) && !x.waiting);
    const standing = foes.filter((x) => x.hp > 0 && !x.fled);
    return { over: foes.length > 0 && standing.length === 0, foes: foes.length, standing: standing.length };
  }

  // ---------- Reputazione ----------
  function threshold(value, thresholds) {
    const list = normalizeThresholds(thresholds);
    let cur = list[0];
    for (const t of list) if (repValue(value) >= t.min) cur = t;
    return cur;
  }
  // Riga di una tabella di effetti (EFFECTS) che vale per il valore: { max } fino a, { min } da.
  function effectRow(rows, value) {
    const v = repValue(value);
    return arr(rows).find((r) => (r.max !== undefined && v <= r.max) || (r.min !== undefined && v >= r.min)) || null;
  }
  const priceFactor = (rep) => { const r = effectRow(K().EFFECTS.prices, rep); return r ? r.factor : 1; };
  const cityAttitude = (rep) => { const r = effectRow(K().EFFECTS.city, rep); return r ? r.attitude : 'neutrale'; };
  const cityAttitudeText = (rep) => { const r = effectRow(K().EFFECTS.city, rep); return r ? r.text : ''; };
  const attitudeDelta = (rep) => { const r = effectRow(K().EFFECTS.attitude, rep); return r ? r.delta : 0; };
  const hasAccess = (rep, blockHostile) => !blockHostile || repValue(rep) >= K().EFFECTS.accessMin;

  // Reputazione del party (o del giocatore, se attiva la reputazione personale e ha un valore) verso una fazione.
  function reputationOf(world, party, factionId, playerId) {
    if (playerId && world && world.perPlayer && world.playerRep[playerId] && world.playerRep[playerId][factionId] !== undefined) return world.playerRep[playerId][factionId];
    return party && party.reputation && party.reputation[factionId] !== undefined ? party.reputation[factionId] : 0;
  }

  // Cambia la reputazione e la registra. target: { world, party, playerId }. Restituisce la voce del registro
  // (null se il valore non cambia). Modifica party.reputation / world.playerRep e world.repLog.
  function changeReputation(target, factionId, delta, reason, source, now) {
    const { world, party, playerId } = target;
    if (!world || !factionId || !Number.isFinite(delta) || !delta) return null;
    const personal = Boolean(playerId && world.perPlayer);
    let before;
    if (personal) {
      world.playerRep[playerId] = world.playerRep[playerId] || {};
      before = world.playerRep[playerId][factionId] !== undefined ? world.playerRep[playerId][factionId] : reputationOf(world, party, factionId);
    } else {
      if (!party) return null;
      party.reputation = party.reputation || {};
      before = party.reputation[factionId] || 0;
    }
    const after = repValue(before + delta);
    if (after === before) return null;
    if (personal) world.playerRep[playerId][factionId] = after;
    else party.reputation[factionId] = after;
    const entry = normalizeRepEntry({
      id: DnD.dadi.uid(), at: (now || new Date()).toISOString(), partyId: party ? party.id : '', playerId: personal ? playerId : '',
      factionId, delta: after - before, before, after, reason: reason || '', source: source || 'manuale',
    });
    world.repLog.push(entry);
    if (world.repLog.length > K().REP_LOG_MAX) world.repLog.splice(0, world.repLog.length - K().REP_LOG_MAX);
    return entry;
  }

  // Annulla (correzione del master) una voce del registro: toglie la differenza e la segna come annullata.
  function revertReputation(world, parties, entryId) {
    const e = world.repLog.find((x) => x.id === entryId);
    if (!e || e.reverted) return false;
    if (e.playerId) {
      const m = world.playerRep[e.playerId] || (world.playerRep[e.playerId] = {});
      m[e.factionId] = repValue((m[e.factionId] || 0) - e.delta);
    } else {
      const p = arr(parties).find((x) => x.id === e.partyId);
      if (!p) return false;
      p.reputation[e.factionId] = repValue((p.reputation[e.factionId] || 0) - e.delta);
    }
    e.reverted = true;
    return true;
  }

  // Fazioni a cui un elemento fa riferimento sono state eliminate: si torna a Neutrali (nessun errore).
  function factionOr(factions, id, fallback) {
    return byIdOf(factions).has(id) ? id : fallback === undefined ? 'neutrali' : fallback;
  }

  // Fazione di un giocatore: la sua (se scelta), altrimenti quella del suo party, altrimenti Giocatori.
  function playerFaction(player, parties) {
    if (player && player.factionId) return player.factionId;
    const p = arr(parties).find((x) => x.memberIds.includes(player && player.id));
    return p ? p.factionId : 'giocatori';
  }

  // Il Mondo visibile nella sessione (di default quella corrente): fazioni, party, città, NPC, quest e stato.
  function view(state, sessionId) {
    const se = sessionId ? state.sessions.find((s) => s.id === sessionId) : DnD.modello.current(state);
    const vis = (key) => arr(state[key]).filter((x) => DnD.modello.isVisible(x, se.id));
    return { session: se, world: se.world, factions: vis('factions'), parties: vis('parties'), cities: vis('cities'), npcs: vis('worldNpcs'), quests: vis('quests') };
  }

  // Fazione di partenza di un combattente dalla sua scheda: la sua, altrimenti quella del party (giocatori) o
  // della città (nemici), altrimenti Giocatori / Nemici. ctx: { parties, cities, factions }.
  function defaultFactionFor(source, kind, ctx) {
    const c = ctx || {};
    let id = source && source.factionId;
    if (!id && kind === 'player') id = playerFaction(source, c.parties);
    if (!id && source && source.cityId) { const city = arr(c.cities).find((x) => x.id === source.cityId); if (city) id = city.factionId; }
    id = id || (kind === 'player' ? 'giocatori' : 'nemici');
    return c.factions ? factionOr(c.factions, id, kind === 'player' ? 'giocatori' : 'nemici') : id;
  }

  DnD.fazioni = {
    view, defaultFactionFor, variables,
    normalizeFaction, builtinFactions, ensureBuiltins, normalizeThresholds, normalizeRepMap, normalizeWorld, normalizeRepEntry, playerFaction,
    relazione, isHostileLevel, isAllyLevel, setRelation, matrix, asymmetries, table, relazioneCombattenti, ostili, alleati,
    areaWarnings, combatOver, threshold, effectRow, priceFactor, cityAttitude, cityAttitudeText, attitudeDelta, hasAccess,
    reputationOf, changeReputation, revertReputation, factionOr, repValue,
  };
})(globalThis.DnD = globalThis.DnD || {});
