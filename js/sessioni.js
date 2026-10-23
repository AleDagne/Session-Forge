// Sessioni di gioco (funzioni pure sullo stato normalizzato).
// Razze, magie, strutture, attrezzatura, oggetti di mappa, TileSet, biomi ed eventi sono librerie globali. Nemici, giocatori, griglie e il
// Mondo (fazioni, party, città, NPC e quest) appartengono a una sessione (sessionId) oppure sono condivisi con tutte (shared: true).
// Ogni sessione ha anche descrizione, note del master, combattimento in corso e bozza dell'editor.
(function (DnD) {
  'use strict';

  const OWNED = ['npcs', 'players', 'savedGrids', 'factions', 'parties', 'cities', 'worldNpcs', 'quests'];
  const LIBRARIES = ['races', 'spells', 'structures', 'equipment', 'mapObjects', 'tilesets', 'biomes', 'events', 'pathTemplates', 'customConditions'];
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function newSession(name, id) {
    return { id, name, description: '', notes: '', pages: [], combat: null, gridDraft: null, exploration: null, world: DnD.fazioni.normalizeWorld({}) };
  }

  function current(state) {
    return state.sessions.find((s) => s.id === state.currentSessionId) || state.sessions[0];
  }

  function isVisible(entity, sessionId) {
    return entity.shared || entity.sessionId === sessionId;
  }

  // Nemici, giocatori o griglie visibili nella sessione indicata (di default quella corrente).
  function visible(state, key, sessionId) {
    const sid = sessionId || current(state).id;
    return state[key].filter((x) => isVisible(x, sid));
  }

  function uniqueName(state, base) {
    const taken = (n) => state.sessions.some((s) => s.name.toLowerCase() === n.toLowerCase());
    let name = base.slice(0, 60);
    for (let i = 2; taken(name); i++) name = (base + ' (' + i + ')').slice(0, 60);
    return name;
  }

  function addSession(state, name, newId) {
    const s = newSession(uniqueName(state, name), newId());
    state.sessions.push(s);
    state.currentSessionId = s.id;
    return s;
  }

  // Riferimenti a griglie e creature nelle azioni degli eventi piazzati (dopo un cambio di id).
  function remapActions(list, map) {
    for (const a of list || []) {
      if (a.gridId) a.gridId = map(a.gridId);
      if (a.foes) for (const f of a.foes) f.npcId = map(f.npcId);
      remapActions(a.success, map);
      remapActions(a.failure, map);
      for (const r of a.rows || []) remapActions(r.actions, map);
    }
  }
  function remapGridEvents(grid, idMap) {
    const map = (id) => (idMap.has(id) ? idMap.get(id) : id);
    for (const inst of grid.events || []) remapActions(inst.event.actions, map);
    // Copie degli NPC piazzate: modello e fazione della copia.
    for (const it of grid.items || []) if (it.otype === 'npc') { it.npcId = map(it.npcId); if (it.npcState && it.npcState.factionId) it.npcState.factionId = map(it.npcState.factionId); }
  }

  // Riferimenti del Mondo tra elementi della stessa sessione (fazioni, città, party, NPC, quest, giocatori).
  function remapWorldEntities(state, sessionId, idMap) {
    const map = (id) => (id && idMap.has(id) ? idMap.get(id) : id);
    const mine = (key) => (state[key] || []).filter((x) => x.sessionId === sessionId && !x.shared);
    const keys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [map(k), v]));
    for (const f of mine('factions')) f.relations = keys(f.relations);
    for (const p of mine('parties')) { p.factionId = map(p.factionId); p.memberIds = p.memberIds.map(map); p.marchOrder = p.marchOrder.map(map); p.reputation = keys(p.reputation); }
    for (const c of mine('cities')) { c.factionId = map(c.factionId); c.presentFactionIds = c.presentFactionIds.map(map); c.questIds = c.questIds.map(map); if (c.place) c.place.gridId = map(c.place.gridId); c.gridId = map(c.gridId); }
    for (const n of mine('worldNpcs')) {
      n.factionId = map(n.factionId); n.cityId = map(n.cityId); n.questIds = n.questIds.map(map);
      for (const r of n.routine) r.gridId = map(r.gridId);
      for (const node of n.dialog.nodes) for (const a of node.answers) for (const o of a.outcomes) { if (o.factionId) o.factionId = map(o.factionId); if (o.questId) o.questId = map(o.questId); }
    }
    for (const q of mine('quests')) {
      q.giver.npcId = map(q.giver.npcId); q.giver.factionId = map(q.giver.factionId); q.factionId = map(q.factionId);
      for (const r of q.requirements) r.factionId = map(r.factionId);
      for (const o of q.objectives) { o.npcId = map(o.npcId); o.npcSourceId = map(o.npcSourceId); o.gridId = map(o.gridId); }
      for (const r of q.rewards.reputation) r.factionId = map(r.factionId);
      q.rewards.unlockQuestIds = q.rewards.unlockQuestIds.map(map);
      q.rewards.unlockMerchantIds = q.rewards.unlockMerchantIds.map(map);
    }
    for (const key of ['npcs', 'players']) for (const x of mine(key)) { if (x.factionId) x.factionId = map(x.factionId); if (x.cityId) x.cityId = map(x.cityId); }
  }

  // Aggiorna i riferimenti interni di una sessione dopo che nemici/giocatori/griglie hanno cambiato id.
  function remapSession(session, idMap, newId) {
    const map = (id) => (idMap.has(id) ? idMap.get(id) : id);
    const ex = session.exploration;
    if (ex) {
      ex.gridId = map(ex.gridId);
      for (const s of ex.stack) s.gridId = map(s.gridId);
      if (ex.pending) { ex.pending.gridId = map(ex.pending.gridId); remapActions([ex.pending.action], map); remapActions(ex.pending.rest, map); }
      for (const p of ex.parties.concat(...ex.stack.map((s) => s.parties))) p.memberIds = p.memberIds.map(map);
      ex.members = Object.fromEntries(Object.entries(ex.members).map(([k, v]) => [map(k), v]));
    }
    if (session.combat) {
      session.combat.id = newId();
      for (const c of session.combat.combatants) c.sourceId = map(c.sourceId);
      if (session.combat.grid.sourceGridId) session.combat.grid.sourceGridId = map(session.combat.grid.sourceGridId);
    }
    if (session.gridDraft && session.gridDraft.gridId) session.gridDraft.gridId = map(session.gridDraft.gridId);
    if (session.combat) {
      for (const c of session.combat.combatants) {
        c.faction = map(c.faction);
        c.hostileTo = (c.hostileTo || []).map(map);
        if (c.npc) { c.npc.npcId = map(c.npc.npcId); c.npc.cityId = map(c.npc.cityId); }
      }
      remapGridEvents(session.combat.grid, idMap);
    }
    if (session.gridDraft) remapGridEvents(session.gridDraft.grid, idMap);
    const w = session.world;
    if (w) {
      w.activePartyId = map(w.activePartyId);
      w.quests = Object.fromEntries(Object.entries(w.quests || {}).map(([k, v]) => [map(k), Object.assign(v, { partyId: map(v.partyId) })]));
      w.playerRep = Object.fromEntries(Object.entries(w.playerRep || {}).map(([k, v]) => [map(k), Object.fromEntries(Object.entries(v).map(([f, n]) => [map(f), n]))]));
      for (const e of w.repLog || []) { e.partyId = map(e.partyId); e.playerId = map(e.playerId); e.factionId = map(e.factionId); }
    }
  }

  // Duplica una sessione: copia i suoi nemici, giocatori e griglie (non quelli condivisi, che restano unici).
  function duplicateSession(state, sessionId, name, newId) {
    const src = state.sessions.find((s) => s.id === sessionId);
    if (!src) throw new Error('Sessione non trovata.');
    const copy = Object.assign(clone(src), { id: newId(), name: uniqueName(state, name) });
    const idMap = new Map();
    for (const key of OWNED) {
      for (const x of state[key].filter((e) => e.sessionId === sessionId && !e.shared)) {
        const dup = Object.assign(clone(x), { id: newId(), sessionId: copy.id });
        idMap.set(x.id, dup.id);
        state[key].push(dup);
      }
    }
    remapSession(copy, idMap, newId);
    for (const g of state.savedGrids.filter((x) => x.sessionId === copy.id)) remapGridEvents(g, idMap);
    remapWorldEntities(state, copy.id, idMap);
    state.sessions.push(copy);
    state.currentSessionId = copy.id;
    return copy;
  }

  // Elimina una sessione con i suoi elementi non condivisi. Deve restarne almeno una.
  function deleteSession(state, sessionId) {
    if (state.sessions.length <= 1) throw new Error('Deve restare almeno una sessione.');
    state.sessions = state.sessions.filter((s) => s.id !== sessionId);
    const keep = state.sessions[0].id;
    for (const key of OWNED) {
      state[key] = state[key].filter((x) => x.shared || x.sessionId !== sessionId);
      for (const x of state[key]) if (x.sessionId === sessionId) x.sessionId = keep; // condivisi orfani
    }
    if (state.currentSessionId === sessionId) state.currentSessionId = keep;
  }

  // ---------- Esportazione e importazione di una singola sessione ----------
  // Il file contiene la sessione, i suoi nemici, giocatori e griglie (anche quelli condivisi che usa)
  // e gli elementi delle librerie a cui fanno riferimento, così si può importare su un altro computer.
  // images: { id: dataUrl } delle immagini importate usate dalla sessione (vedi immaginiLib.referencedIds).
  function exportSession(state, sessionId, images) {
    const out = exportSessionData(state, sessionId, images);
    const ids = new Set(DnD.tilemap.referencedTilesetIds(out));
    out.tilesets = clone(state.tilesets.filter((t) => ids.has(t.id)));
    return out;
  }

  function exportSessionData(state, sessionId, images) {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('Sessione non trovata.');
    const npcs = visible(state, 'npcs', sessionId);
    const players = visible(state, 'players', sessionId);
    const savedGrids = visible(state, 'savedGrids', sessionId);
    const world = Object.fromEntries(['factions', 'parties', 'cities', 'worldNpcs', 'quests'].map((k) => [k, (state[k] || []).filter((x) => isVisible(x, sessionId))]));
    const creatures = npcs.concat(players).concat(world.worldNpcs.map((n) => n.stats));
    const grids = savedGrids.concat(session.combat ? [session.combat.grid] : [], session.gridDraft ? [session.gridDraft.grid] : []);
    const used = (list, ids) => list.filter((x) => ids.has(x.id));
    const sources = (key) => new Set(grids.flatMap((g) => g[key].map((x) => x.sourceId)));
    const mapObjects = used(state.mapObjects, sources('items'));
    // Attrezzatura usata: armi e armature delle schede, inventari, contenuto degli oggetti di mappa.
    const equipmentIds = new Set([
      ...creatures.flatMap((c) => (c.weapons || []).map((w) => w.equipmentId).concat(c.armor ? [c.armor.equipmentId, c.armor.shieldId] : [])),
      ...players.flatMap((p) => (p.inventory || []).map((x) => x.equipmentId)),
      ...grids.flatMap((g) => g.items.flatMap((it) => (it.contents || []).map((x) => x.equipmentId))),
      ...mapObjects.flatMap((o) => o.contents.map((x) => x.equipmentId)),
      ...mapObjects.map((o) => o.lock && o.lock.keyId),
      ...grids.flatMap((g) => g.items.map((it) => it.lock && it.lock.keyId)),
      // Mondo: merce dei mercanti (modelli e copie), ricompense e obiettivi delle quest, inventari dei party.
      ...world.worldNpcs.flatMap((n) => n.merchant.stock.map((x) => x.equipmentId)),
      ...grids.flatMap((g) => g.items.filter((it) => it.npcState).flatMap((it) => it.npcState.stock.map((x) => x.equipmentId))),
      ...world.quests.flatMap((q) => q.rewards.items.map((x) => x.equipmentId).concat(q.objectives.map((o) => o.equipmentId))),
      ...world.parties.flatMap((p) => p.inventory.map((x) => x.equipmentId)),
    ].filter(Boolean));
    // Biomi (con i loro "padri") ed eventi usati dalle mappe di esplorazione e dalle tabelle degli incontri.
    const biomeIds = new Set(grids.flatMap((g) => DnD.biomi.usedIds(g.biomeMap)));
    const byId = new Map((state.biomes || []).map((b) => [b.id, b]));
    for (const id of [...biomeIds]) for (let b = byId.get(id); b && b.parentId && !biomeIds.has(b.parentId); b = byId.get(b.parentId)) biomeIds.add(b.parentId);
    const biomes = (state.biomes || []).filter((b) => biomeIds.has(b.id));
    const eventIds = new Set(grids.flatMap((g) => (g.events || []).map((i) => i.templateId))
      .concat(biomes.flatMap((b) => (b.encounters || []).filter((r) => r.kind === 'evento').map((r) => r.refId))));
    return clone({
      app: DnD.config ? DnD.config.APP_NAME : 'Session Forge',
      kind: 'sessione',
      version: DnD.dati.VERSION,
      exportedAt: new Date().toISOString(),
      session,
      npcs,
      players,
      savedGrids,
      factions: world.factions,
      parties: world.parties,
      cities: world.cities,
      worldNpcs: world.worldNpcs,
      quests: world.quests,
      races: used(state.races, new Set(creatures.map((c) => c.raceId))),
      spells: used(state.spells, new Set(creatures.flatMap((c) => (c.spellcasting ? c.spellcasting.known : [])
        .concat(c.innate ? c.innate.spells.map((s) => s.spellId) : [])))),
      structures: used(state.structures, sources('structures')),
      equipment: used(state.equipment, equipmentIds),
      mapObjects,
      biomes,
      events: (state.events || []).filter((e) => eventIds.has(e.id)),
      // Condizioni personalizzate: tutte (libreria piccola, usata da azioni, incantesimi e combattimento).
      customConditions: state.customConditions || [],
      tilesets: [],
      images: images || {},
    });
  }

  function isSessionFile(raw) {
    return Boolean(raw && typeof raw === 'object' && raw.kind === 'sessione');
  }

  // Aggiunge la sessione importata allo stato (senza toccare il resto) e la rende corrente.
  // Gli elementi delle librerie già presenti (stesso id) non vengono duplicati; nemici, giocatori e
  // griglie ricevono id nuovi, tranne quelli condivisi già presenti, che vengono riusati.
  function importSession(state, raw, newId) {
    if (!isSessionFile(raw) || !raw.session || typeof raw.session !== 'object') throw new Error('Il file non contiene una sessione.');
    if (typeof raw.version === 'number' && raw.version > DnD.dati.VERSION) throw new Error('La sessione proviene da una versione più recente dell\'app.');
    const before12 = !(typeof raw.version === 'number' && raw.version >= 12);
    raw = DnD.dati.migrateV8(DnD.tileset.migrateRaw(clone(raw)));
    const D = DnD.dati;
    const norm = {
      races: D.normalizeRace, spells: D.normalizeSpell, structures: D.normalizeStructure, equipment: D.normalizeEquipment,
      mapObjects: D.normalizeMapObject, tilesets: D.normalizeTileset, biomes: DnD.biomi.normalizeBiome, events: DnD.eventi.normalizeEvent, pathTemplates: DnD.percorso.normalizeTemplate,
      customConditions: DnD.condizioni.normalizeCustom,
    };
    for (const key of LIBRARIES) {
      if (!Array.isArray(state[key])) state[key] = [];
      for (const x of Array.isArray(raw[key]) ? raw[key] : []) {
        const n = norm[key](x);
        if (!state[key].some((e) => e.id === n.id)) state[key].push(n);
      }
    }
    const session = D.normalizeSession(raw.session);
    session.id = newId();
    session.name = uniqueName(state, session.name);
    const idMap = new Map();
    const normOwned = {
      npcs: (x) => D.normalizeCreature(x, false), players: (x) => D.normalizeCreature(x, true), savedGrids: D.normalizeSavedGrid,
      factions: DnD.fazioni.normalizeFaction, parties: DnD.party.normalizeParty, cities: DnD.citta.normalizeCity, worldNpcs: DnD.npc.normalizeNpc, quests: DnD.quest.normalizeQuest,
    };
    for (const key of OWNED) {
      if (!Array.isArray(state[key])) state[key] = [];
      for (const x of Array.isArray(raw[key]) ? raw[key] : []) {
        const n = normOwned[key](x);
        if (n.builtin) continue; // fazioni predefinite: sempre presenti
        if (n.shared && state[key].some((e) => e.id === n.id && e.shared)) continue; // modello condiviso già presente
        const fresh = newId();
        idMap.set(n.id, fresh);
        state[key].push(Object.assign(n, { id: fresh, sessionId: session.id }));
      }
    }
    remapSession(session, idMap, newId);
    for (const g of state.savedGrids.filter((x) => x.sessionId === session.id)) remapGridEvents(g, idMap);
    remapWorldEntities(state, session.id, idMap);
    // Sessioni precedenti alla versione 12: i giocatori importati entrano nel party «Gruppo».
    if (before12 && !state.parties.some((p) => p.sessionId === session.id)) {
      const party = DnD.party.defaultParty(session.id, state.players.filter((p) => p.sessionId === session.id || p.shared).map((p) => p.id), newId());
      state.parties.push(party);
      session.world.activePartyId = party.id;
    }
    state.sessions.push(session);
    state.currentSessionId = session.id;
    return session;
  }

  DnD.sessioni = {
    OWNED, LIBRARIES, newSession, current, isVisible, visible, uniqueName, remapWorldEntities,
    addSession, duplicateSession, deleteSession, exportSession, isSessionFile, importSession,
  };
})(globalThis.DnD = globalThis.DnD || {});
