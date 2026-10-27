// Migrazioni dei dati grezzi (archivio salvato o file importato), dalla versione 8 alla 18, in fila prima della
// normalizzazione; le migrazioni delle tile (v5-v7) sono in migrazioni-tile.js. Livello stato. Espone DnD.migrazioni;
// usa DnD.normalizza e DnD.esempi. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const { arr, id } = DnD.normalizza;
  const { defaultMapObjects } = DnD.esempi;

  // ---------- Migrazione alla versione 8 (sui dati grezzi) ----------
  // Visita ogni griglia dei dati grezzi: salvate, combattimenti e bozze (anche dei formati precedenti).
  function eachRawGrid(raw, cb) {
    const g = (x) => { if (x && typeof x === 'object') cb(x); };
    for (const x of arr(raw.savedGrids)) g(x);
    const session = (se) => { if (se && typeof se === 'object') { if (se.combat) g(se.combat.grid); if (se.gridDraft) g(se.gridDraft.grid); } };
    for (const se of arr(raw.sessions)) session(se);
    session(raw.session);
    if (raw.combat) g(raw.combat.grid);
    if (raw.gridDraft) g(raw.gridDraft.grid);
  }

  // Valore libero di un vecchio oggetto ("50 mo") -> costo { amount, unit }.
  function parseCost(text) {
    const m = /(\d+(?:[.,]\d+)?)\s*(mr|ma|me|mo|mp)\b/i.exec(String(text || ''));
    return m ? { amount: Number(m[1].replace(',', '.')), unit: m[2].toLowerCase() } : null;
  }

  // Versione 8: i nemici esistenti sono "standard"; gli Oggetti diventano voci dell'Attrezzatura (e, se
  // avevano un aspetto da tile o bloccavano, anche un modello di oggetto di mappa); le copie già piazzate
  // sulle griglie diventano "oggetti a terra" con quell'oggetto dentro. Le griglie restano 50×50 senza
  // sfondo (completate dalla normalizzazione). Si aggiungono il catalogo base e le creature d'esempio.
  // Funziona anche sui file di una singola sessione (stessi campi).
  function migrateV8(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 8) return raw;
    for (const n of arr(raw.npcs)) if (n && typeof n === 'object' && !n.type) n.type = 'standard';
    const items = arr(raw.items).filter((x) => x && typeof x === 'object');
    const byId = new Map(items.map((x) => [x.id, x]));
    const tplId = (x) => String(x.id).slice(0, 60) + '-m';
    const migrated = items.map((x) => {
      const cost = parseCost(x.value);
      return {
        id: x.id, name: x.name, category: DnD.attrezzatura.LEGACY_TYPES[x.type] || 'altro',
        description: [x.description, x.value && !cost ? 'Valore: ' + x.value : ''].filter(Boolean).join('\n'), cost: cost || undefined, icon: x.icon,
      };
    });
    const mapTemplates = items.filter((x) => (x.mode === 'tiles' && x.tiles) || x.blocks).map((x) => ({
      id: tplId(x), name: x.name, otype: 'altro', icon: x.icon, mode: x.mode, tiles: x.tiles, blocks: Boolean(x.blocks),
      container: true, state: 'aperto', contents: [{ equipmentId: x.id, qty: Number(x.quantity) || 1 }],
    }));
    const isArchive = raw.kind !== 'sessione';
    if (!Array.isArray(raw.equipment)) raw.equipment = (isArchive ? DnD.attrezzatura.defaults() : []).concat(migrated);
    if (!Array.isArray(raw.mapObjects)) raw.mapObjects = (isArchive ? defaultMapObjects() : []).concat(mapTemplates);
    eachRawGrid(raw, (g) => {
      g.items = arr(g.items).map((p) => {
        if (!p || typeof p !== 'object' || p.otype) return p;
        const src = byId.get(p.sourceId);
        const tpl = src && mapTemplates.find((t) => t.id === tplId(src));
        return Object.assign({}, p, {
          otype: tpl ? 'altro' : 'a-terra', sourceId: tpl ? tpl.id : '', container: true, state: 'aperto',
          contents: src ? [{ equipmentId: src.id, qty: Number(src.quantity) || 1 }] : [],
        });
      });
    });
    delete raw.items;
    if (isArchive) raw.addExampleCreatures = true;
    return raw;
  }

  // Versione 9: arrivano i boss (creature con type 'boss'); nessun dato esistente cambia, gli archivi
  // precedenti ricevono il boss d'esempio (condiviso).
  function migrateV9(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 9) return raw;
    if (raw.kind !== 'sessione') raw.addExampleBoss = true;
    return raw;
  }

  // Versione 10: biomi ed eventi (librerie globali). Le griglie esistenti restano di battaglia (tipo
  // predefinito); gli archivi precedenti ricevono biomi ed eventi d'esempio.
  function migrateV10(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 10) return raw;
    if (raw.kind !== 'sessione') {
      if (!Array.isArray(raw.biomes)) raw.biomes = DnD.biomi.examples();
      if (!Array.isArray(raw.events)) raw.events = DnD.eventi.examples();
    }
    return raw;
  }

  // Versione 11: personaggi leggendari (giocatori con type 'leggendario'; gli esistenti restano standard) e
  // modelli di percorso (libreria globale, con il modello d'esempio negli archivi precedenti).
  function migrateV11(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 11) return raw;
    if (raw.kind !== 'sessione' && !Array.isArray(raw.pathTemplates)) raw.pathTemplates = [DnD.percorso.exampleTemplate()];
    return raw;
  }

  // Versione 12: fazioni, party, città, NPC e quest (per sessione). I combattenti tengono la fazione che avevano
  // (Giocatori, Nemici o Neutrali, ora fazioni del Mondo); i giocatori di ogni sessione entrano nel party
  // predefinito «Gruppo». Funziona anche sui file di una singola sessione; gli archivi ricevono anche gli
  // esempi del Mondo (fazione, città, mercante e quest, condivisi).
  function migrateV12(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 12) return raw;
    raw.addDefaultParties = true;
    if (raw.kind !== 'sessione') raw.addWorldExamples = true;
    return raw;
  }
  // Versione 16: scene e incontri. Le sessioni restano senza scene; gli archivi ricevono gli incontri d'esempio.
  function migrateV16(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 16) return raw;
    if (raw.kind !== 'sessione') raw.addSceneExamples = true;
    return raw;
  }
  // Versione 17: scheda del giocatore. I giocatori ricevono i campi vuoti; gli archivi i background e i talenti d'esempio.
  function migrateV17(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 17) return raw;
    if (raw.kind !== 'sessione') raw.addSheetExamples = true;
    return raw;
  }

  // Versione 18 (luce, visione e nebbia di guerra): solo normalizzazione (nebbia spenta, giorno, nessuna sorgente);
  // gli archivi ricevono gli esempi (Finestra, Grata, Braciere, Lanterna appesa).
  function migrateV18(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 18) return raw;
    if (raw.kind !== 'sessione' && typeof raw.version === 'number') raw.addVisionExamples = true;
    return raw;
  }

  // Esempi originali del Mondo (dati/mondo.js), condivisi con tutte le sessioni: { factions, cities, worldNpcs, quests }.

  DnD.migrazioni = {
    eachRawGrid, migrateV10, migrateV11, migrateV12, migrateV16, migrateV17, migrateV18, migrateV8, migrateV9, parseCost,
  };
})(globalThis.DnD = globalThis.DnD || {});
