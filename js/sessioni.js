// Sessioni di gioco (funzioni pure sullo stato normalizzato).
// Razze, magie, strutture, attrezzatura, oggetti di mappa, TileSet, biomi ed eventi sono librerie globali. Nemici, giocatori e griglie appartengono
// a una sessione (sessionId) oppure sono condivisi con tutte (shared: true).
// Ogni sessione ha anche descrizione, note del master, combattimento in corso e bozza dell'editor.
(function (DnD) {
  'use strict';

  const OWNED = ['npcs', 'players', 'savedGrids'];
  const LIBRARIES = ['races', 'spells', 'structures', 'equipment', 'mapObjects', 'tilesets', 'biomes', 'events', 'pathTemplates'];
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function newSession(name, id) {
    return { id, name, description: '', notes: '', pages: [], combat: null, gridDraft: null, exploration: null };
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
    const creatures = npcs.concat(players);
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
      races: used(state.races, new Set(creatures.map((c) => c.raceId))),
      spells: used(state.spells, new Set(creatures.flatMap((c) => (c.spellcasting ? c.spellcasting.known : [])
        .concat(c.innate ? c.innate.spells.map((s) => s.spellId) : [])))),
      structures: used(state.structures, sources('structures')),
      equipment: used(state.equipment, equipmentIds),
      mapObjects,
      biomes,
      events: (state.events || []).filter((e) => eventIds.has(e.id)),
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
    raw = DnD.dati.migrateV8(DnD.tileset.migrateRaw(clone(raw)));
    const D = DnD.dati;
    const norm = {
      races: D.normalizeRace, spells: D.normalizeSpell, structures: D.normalizeStructure, equipment: D.normalizeEquipment,
      mapObjects: D.normalizeMapObject, tilesets: D.normalizeTileset, biomes: DnD.biomi.normalizeBiome, events: DnD.eventi.normalizeEvent, pathTemplates: DnD.percorso.normalizeTemplate,
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
    const normOwned = { npcs: (x) => D.normalizeCreature(x, false), players: (x) => D.normalizeCreature(x, true), savedGrids: D.normalizeSavedGrid };
    for (const key of OWNED) {
      for (const x of Array.isArray(raw[key]) ? raw[key] : []) {
        const n = normOwned[key](x);
        if (n.shared && state[key].some((e) => e.id === n.id && e.shared)) continue; // modello condiviso già presente
        const fresh = newId();
        idMap.set(n.id, fresh);
        state[key].push(Object.assign(n, { id: fresh, sessionId: session.id }));
      }
    }
    remapSession(session, idMap, newId);
    for (const g of state.savedGrids.filter((x) => x.sessionId === session.id)) remapGridEvents(g, idMap);
    state.sessions.push(session);
    state.currentSessionId = session.id;
    return session;
  }

  DnD.sessioni = {
    OWNED, LIBRARIES, newSession, current, isVisible, visible, uniqueName,
    addSession, duplicateSession, deleteSession, exportSession, isSessionFile, importSession,
  };
})(globalThis.DnD = globalThis.DnD || {});
