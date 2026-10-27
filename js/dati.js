// Stato dell'app: stato vuoto, caricamento dei dati grezzi (migrazioni in fila, poi normalizzazione), esportazione e
// importazione dell'archivio. È la facciata pubblica dello stato (DnD.dati): riesporta normalizzazione, esempi e
// migrazioni con i nomi di sempre; l'archivio su disco (archivio.js) le aggiunge openStore e saveErrorMessage.
// Livello stato. Usa normalizza, esempi, migrazioni, migrazioni-tile, sessioni e i moduli con dati d'esempio.
// Non deve toccare DOM o disco.
(function (DnD) {
  'use strict';

  const { VERSION, LOG_MAX, DICE_HISTORY_MAX } = DnD.modello;
  const {
    DEFAULT_SESSION_NAME, arr, int, makeBonuses, normalizeBackground, normalizeCombat, normalizeCombatant, normalizeCreature, normalizeEquipment, normalizeGridContent, normalizeGridDraft, normalizeGridSize, normalizeLabel, normalizeMapObject, normalizePlacedItem, normalizePlacedStructure, normalizeRace, normalizeSavedGrid, normalizeSession, normalizeSessions, normalizeSource, normalizeSpell, normalizeStructure, normalizeTileProps, normalizeTiles, normalizeTileset, normalizeWeapon, normalizeZone, obj, str,
  } = DnD.normalizza;
  const {
    addDefaultParties, defaultCreatures, defaultMapObjects, defaultRaces, defaultSpells, defaultStructures, defaultWorld, visionMapObjects, visionStructures,
  } = DnD.esempi;
  const {
    eachRawGrid, migrateV10, migrateV11, migrateV12, migrateV16, migrateV17, migrateV18, migrateV8, migrateV9, parseCost,
  } = DnD.migrazioni;
  // Definite in modello.js (base dello stato), qui riesportate.
  const { pushDiceHistory, pushLog } = DnD.modello;

  function emptyState() {
    const session = DnD.sessioni.newSession(DEFAULT_SESSION_NAME, DnD.dadi.uid());
    const world = defaultWorld(session.id);
    return {
      version: VERSION, races: defaultRaces(), npcs: defaultCreatures(session.id), players: [], structures: defaultStructures(),
      equipment: DnD.attrezzatura.defaults(), mapObjects: defaultMapObjects(), tilesets: [], spells: defaultSpells(), savedGrids: [],
      biomes: DnD.biomi.examples(), events: DnD.eventi.examples(), pathTemplates: [DnD.percorso.exampleTemplate()], customConditions: [],
      difficultyRules: DnD.difficolta.defaultRules(),
      // Scene (scaletta per sessione) e libreria degli incontri (con tre esempi condivisi).
      scenes: [], encounters: DnD.scene.examples(session.id),
      // Scheda del giocatore: background e talenti (librerie per sessione, esempi condivisi).
      backgrounds: DnD.scheda.exampleBackgrounds(session.id), feats: DnD.scheda.exampleFeats(session.id),
      // Mondo (per sessione, condivisibili): fazioni (le tre predefinite sono condivise), party, città, NPC e quest.
      factions: DnD.fazioni.builtinFactions(session.id).concat(world.factions), parties: [DnD.party.defaultParty(session.id, [])],
      cities: world.cities, worldNpcs: world.worldNpcs, quests: world.quests,
      sessions: [session], currentSessionId: session.id, diceHistory: [],
    };
  }

  function normalizeState(raw) {
    // Versioni 6, 7 e 8: immagini "stirate" -> tilemap su tileset, TileSet con sorgenti e livelli generici,
    // poi Attrezzatura, oggetti di mappa e creature (sui dati grezzi, prima di tutto); 9: boss d'esempio;
    // 10: biomi ed eventi.
    raw = migrateV18(migrateV17(migrateV16(migrateV12(migrateV11(migrateV10(migrateV9(migrateV8(DnD.migrazioniTile.migrateRaw(JSON.parse(JSON.stringify(obj(raw))))))))))));
    const { sessions, currentSessionId } = normalizeSessions(raw);
    // Chi non appartiene a una sessione esistente (es. dati precedenti) va nella prima.
    const ids = new Set(sessions.map((x) => x.id));
    const owned = (x) => Object.assign(x, { sessionId: ids.has(x.sessionId) ? x.sessionId : sessions[0].id });
    const npcs = arr(raw.npcs).map((c) => owned(normalizeCreature(c, false)));
    // Dati precedenti alla versione 8: ricevono le creature d'esempio (condivise).
    if (raw.addExampleCreatures) for (const c of defaultCreatures(sessions[0].id)) if (!npcs.some((n) => n.id === c.id)) npcs.push(c);
    if (raw.addExampleBoss) for (const c of defaultCreatures(sessions[0].id)) if (c.type === 'boss' && !npcs.some((n) => n.id === c.id)) npcs.push(c);
    const unique = (list) => list.filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);
    const factions = DnD.fazioni.ensureBuiltins(unique(arr(raw.factions).map((f) => owned(DnD.fazioni.normalizeFaction(f)))), sessions[0].id);
    const out = {
      version: VERSION,
      races: arr(raw.races).map(normalizeRace),
      npcs,
      players: arr(raw.players).map((c) => owned(normalizeCreature(c, true))),
      // I dati della versione 1 non hanno strutture: ricevono quelle di esempio.
      structures: Array.isArray(raw.structures) ? raw.structures.map(normalizeStructure) : defaultStructures(),
      equipment: unique(Array.isArray(raw.equipment) ? raw.equipment.map(normalizeEquipment) : DnD.attrezzatura.defaults()),
      mapObjects: unique(Array.isArray(raw.mapObjects) ? raw.mapObjects.map(normalizeMapObject) : defaultMapObjects()),
      tilesets: arr(raw.tilesets).map(normalizeTileset).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i),
      // I dati precedenti alla versione 4 non hanno incantesimi: ricevono quelli di esempio.
      spells: Array.isArray(raw.spells) ? raw.spells.map(normalizeSpell) : defaultSpells(),
      savedGrids: arr(raw.savedGrids).map((g) => owned(normalizeSavedGrid(g))),
      biomes: unique(arr(raw.biomes).map(DnD.biomi.normalizeBiome)),
      events: unique(arr(raw.events).map(DnD.eventi.normalizeEvent)),
      pathTemplates: unique(arr(raw.pathTemplates).map(DnD.percorso.normalizeTemplate)),
      // Condizioni personalizzate (libreria globale, condizioni.js).
      customConditions: unique(arr(raw.customConditions).map(DnD.condizioni.normalizeCustom)),
      // Difficoltà degli incontri: tabelle personalizzate (regole della casa), soglie dei leggendari, NPC neutrali.
      difficultyRules: DnD.difficolta.normalizeRules(raw.difficultyRules),
      factions,
      parties: unique(arr(raw.parties).map((p) => owned(DnD.party.normalizeParty(p)))),
      cities: unique(arr(raw.cities).map((c) => owned(DnD.citta.normalizeCity(c)))),
      worldNpcs: unique(arr(raw.worldNpcs).map((n) => owned(DnD.npc.normalizeNpc(n)))),
      quests: unique(arr(raw.quests).map((q) => owned(DnD.quest.normalizeQuest(q)))),
      // Scene (per sessione, ordinate) e incontri della libreria (modelli, condivisibili).
      scenes: unique(arr(raw.scenes).map((x) => owned(DnD.scene.normalizeScene(x)))),
      encounters: unique(arr(raw.encounters).map((x) => owned(DnD.scene.normalizeEncounter(x)))),
      backgrounds: unique(arr(raw.backgrounds).map((x) => owned(DnD.scheda.normalizeBackground(x)))),
      feats: unique(arr(raw.feats).map((x) => owned(DnD.scheda.normalizeFeat(x)))),
      sessions,
      currentSessionId,
      diceHistory: arr(raw.diceHistory).slice(0, DICE_HISTORY_MAX).map((h) => {
        h = obj(h);
        return { expr: str(h.expr, 40), rolls: arr(h.rolls).slice(0, 100).map((n) => int(n, 0, 0, 1000)), total: int(h.total, 0, -100000, 100000) };
      }),
    };
    if (raw.addDefaultParties) addDefaultParties(out);
    if (raw.addSheetExamples) {
      for (const b of DnD.scheda.exampleBackgrounds(sessions[0].id)) if (!out.backgrounds.some((x) => x.id === b.id)) out.backgrounds.push(b);
      for (const f of DnD.scheda.exampleFeats(sessions[0].id)) if (!out.feats.some((x) => x.id === f.id)) out.feats.push(f);
    }
    if (raw.addVisionExamples) {
      for (const x of visionStructures()) if (!out.structures.some((e) => e.id === x.id)) out.structures.push(x);
      for (const x of visionMapObjects()) if (!out.mapObjects.some((e) => e.id === x.id)) out.mapObjects.push(x);
    }
    if (raw.addSceneExamples) for (const e of DnD.scene.examples(sessions[0].id)) if (!out.encounters.some((x) => x.id === e.id)) out.encounters.push(e);
    if (raw.addWorldExamples) {
      const ex = defaultWorld(sessions[0].id);
      for (const key of Object.keys(ex)) for (const x of ex[key]) if (!out[key].some((e) => e.id === x.id)) out[key].push(x);
    }
    return out;
  }

  // --- Import / export ---
  // images: { id: dataUrl } delle immagini importate usate (stanno fuori dallo stato, in IndexedDB).
  // extra: altre parti dell'archivio fuori dallo stato (es. suoni: impostazioni e file personalizzati).
  function exportJSON(state, images, extra) {
    return JSON.stringify(Object.assign({ app: DnD.config ? DnD.config.APP_NAME : 'Session Forge', kind: 'archivio', exportedAt: new Date().toISOString() },
      state, { images: images || {} }, extra || {}), null, 2);
  }

  function importJSON(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error('Il file non è un JSON valido.');
    }
    if (DnD.sessioni.isSessionFile(raw)) throw new Error('Il file contiene una singola sessione: importala come sessione.');
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.races) || !Array.isArray(raw.npcs) || !Array.isArray(raw.players)) {
      throw new Error('Il file non contiene un backup di questa app.');
    }
    if (typeof raw.version === 'number' && raw.version > VERSION) {
      throw new Error('Il backup proviene da una versione più recente dell\'app.');
    }
    return normalizeState(raw);
  }

  // Testo salvato -> { state, error, corrupted }
  function parseSaved(text) {
    if (text === null || text === undefined) return { state: emptyState(), error: null };
    try {
      return { state: normalizeState(JSON.parse(text)), error: null };
    } catch (e) {
      return { state: emptyState(), error: 'I dati salvati erano danneggiati e non sono stati caricati.', corrupted: text };
    }
  }

  // Le regole con creature annidate (forme leggendarie, NPC, import di personaggi) normalizzano attraverso il modello.
  DnD.modello.registraNormalizzaCreatura(normalizeCreature);

  DnD.dati = {
    VERSION, emptyState, defaultRaces, defaultStructures, defaultSpells, defaultMapObjects, defaultCreatures, makeBonuses, normalizeState, normalizeRace, normalizeCreature, normalizeWeapon, normalizeGridSize, normalizeStructure, normalizeEquipment, normalizeMapObject, normalizeSpell, normalizePlacedStructure, normalizePlacedItem, normalizeLabel, normalizeZone, normalizeBackground, normalizeGridContent, normalizeSavedGrid, normalizeGridDraft, migrateV8, migrateV9, migrateV10, migrateV11, migrateV12, addDefaultParties, defaultWorld, eachRawGrid, parseCost, normalizeCombatant, normalizeCombat, normalizeSession, DEFAULT_SESSION_NAME, normalizeTileset, normalizeSource, normalizeTileProps, normalizeTiles, exportJSON, importJSON, parseSaved, pushDiceHistory, pushLog,
  };
})(globalThis.DnD = globalThis.DnD || {});
