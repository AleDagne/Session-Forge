// Archivio dei dati sul disco del browser (seconda parte del modulo di archivio; la prima, caricata presto, è
// stato/archivio-locale.js con registro dei profili e preferenze). Ogni profilo ha il suo database IndexedDB
// «sessionforge-<id>» (stato, immagini «img:», suoni «snd:», collegamento alla cartella di backup) con ripiego avvisato
// su localStorage (prefisso «sessionforge-<id>:»); scritture in fila con esito reale, copia dei dati danneggiati (se
// non riesce o la lettura fallisce, sola lettura), migrazione dal salvataggio della versione 1 e migrazione ai profili
// (backup automatico prima, ripristino se fallisce), gestione dei profili, spazio e archiviazione persistente,
// cartella di backup (File System Access). È l'unico modulo che scrive su disco. Livello stato (in cima). Espone
// DnD.archivio e aggiunge openStore e saveErrorMessage a DnD.dati; usa DnD.dati, DnD.profili, DnD.archivioLocale.
(function (DnD) {
  'use strict';

  const DB_KEY = 'stato';
  const DB_NAME = 'dnd-battaglie'; // nome di sempre: le chiavi di localStorage passano dalla vista del profilo
  const DB_STORE = 'kv';
  const LEGACY_KEY = 'dnd-battaglie:dati'; // salvataggio in localStorage della versione 1
  const BACKUP_MIGRAZIONE = 'backup-migrazione';
  const CARTELLA = 'cartella-backup';
  const IMPORTAZIONE = 'importazione-in-sospeso';
  const { emptyState, parseSaved } = DnD.dati;
  const L = DnD.archivioLocale;
  const PR = DnD.profili;

  // --- Persistenza: IndexedDB (spazio ampio, adatto alle immagini), con ripiego su localStorage ---
  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function openIdbBackend(nome) {
    const req = indexedDB.open(nome || DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    const db = await idbRequest(req);
    const tx = (mode) => db.transaction(DB_STORE, mode).objectStore(DB_STORE);
    const scrittura = (fare, messaggio) => new Promise((resolve, reject) => {
      const t = db.transaction(DB_STORE, 'readwrite');
      fare(t.objectStore(DB_STORE));
      t.oncomplete = () => resolve();
      t.onerror = t.onabort = () => reject(t.error || new Error(messaggio));
    });
    return {
      name: 'IndexedDB',
      db: nome || DB_NAME,
      get: (key) => idbRequest(tx('readonly').get(key)).then((v) => (v === undefined ? null : v)),
      set: (key, value) => scrittura((s) => s.put(value, key), 'Scrittura annullata'),
      del: (key) => scrittura((s) => s.delete(key), 'Cancellazione annullata'),
      chiavi: () => idbRequest(tx('readonly').getAllKeys()).then((k) => k.map(String)),
      // Svuota tutto il database: stato e immagini.
      clear: () => scrittura((s) => s.clear(), 'Cancellazione annullata'),
      chiudi: () => db.close(),
    };
  }

  // Elimina un database (profilo eliminato, migrazione annullata). Se è aperto altrove resta «bloccato»: si risolve
  // lo stesso, il browser lo elimina quando viene chiuso.
  function eliminaIdb(nome) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(nome);
      req.onsuccess = () => resolve(true);
      req.onblocked = () => resolve(false);
      req.onerror = () => reject(req.error || new Error('Database non eliminato'));
    });
  }

  function localBackend(storage) {
    const proprie = () => {
      const keys = [];
      for (let i = 0; i < storage.length; i++) if (String(storage.key(i)).startsWith(DB_NAME + ':')) keys.push(storage.key(i));
      return keys;
    };
    const dato = (k) => k === DB_NAME + ':' + DB_KEY || k.startsWith(DB_NAME + ':img:') || k.startsWith(DB_NAME + ':snd:');
    return {
      name: 'localStorage',
      get: async (key) => storage.getItem(DB_NAME + ':' + key),
      set: async (key, value) => {
        if (typeof value !== 'string') throw new Error('in localStorage si possono salvare solo testi');
        storage.setItem(DB_NAME + ':' + key, value);
      },
      del: async (key) => storage.removeItem(DB_NAME + ':' + key),
      chiavi: async () => proprie().filter(dato).map((k) => k.slice(DB_NAME.length + 1)),
      // Solo le chiavi dei dati (stato, immagini e file dei suoni): le impostazioni di visualizzazione restano.
      clear: async () => { for (const k of proprie()) if (dato(k)) storage.removeItem(k); },
    };
  }

  // Dati del gioco online in localStorage (profilo, gettoni, partite, note, ripresa, server STUN) e stato del backup:
  // li cancella «Cancella tutti i dati» insieme all'archivio; le preferenze di visualizzazione e dei suoni restano.
  const PREFISSI_DATI = [DB_NAME + ':online-', DB_NAME + ':backup', DB_NAME + ':sessioni-recenti'];
  function cancellaOnline(storage) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) if (PREFISSI_DATI.some((p) => String(storage.key(i)).startsWith(p))) keys.push(storage.key(i));
      for (const k of keys) storage.removeItem(k);
    } catch (e) {
      console.error('Archivio: dati del gioco online non cancellati', e);
    }
  }

  // Store unico: ogni modifica passa da update(). Il salvataggio è asincrono ma ordinato:
  // le scritture non si sovrappongono e, se arrivano più modifiche, si salva solo l'ultima.
  // save(), update() e replace() restituiscono una Promise con l'esito reale della scrittura
  // { ok, error, message }: un progetto risulta salvato solo se i dati sono stati davvero scritti.
  // Messaggio chiaro per un salvataggio non riuscito (spazio esaurito o altro).
  function saveErrorMessage(e) {
    const name = e && e.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(e && e.message))) {
      return 'spazio di archiviazione del browser esaurito. Esporta i dati, poi elimina immagini, TileSet o griglie che non usi.';
    }
    if (name === 'SecurityError' || name === 'InvalidStateError') {
      return 'il browser non permette di salvare dati su questo sito (navigazione privata o archiviazione bloccata nelle impostazioni).';
    }
    return (e && e.message) || 'errore sconosciuto';
  }

  // Avviso per il ripiego su localStorage: i dati eventualmente salvati in IndexedDB restano lì ma non si vedono.
  function avvisoRipiego(e) {
    return 'Archivio IndexedDB non disponibile (' + ((e && e.message) || 'errore sconosciuto') + '): i dati sono salvati '
      + 'in localStorage, con meno spazio. Se prima avevi dati salvati, ora non sono visibili: ricarica la pagina; '
      + 'se il problema resta, controlla le impostazioni del browser sui dati dei siti.';
  }

  /**
   * Apre l'archivio dello stato. Se i dati salvati non si possono leggere, o sono danneggiati e la loro copia non si
   * può scrivere, lo store resta in sola lettura (`bloccato`): nessun salvataggio sovrascrive i dati originali.
   * @param {Storage} storage preferenze del profilo (o un sostituto con le chiavi «dnd-battaglie:…»)
   * @param {{backend?: object, openIdb?: Function, dbName?: string}} [opts] backend alternativo { name, get, set, clear }
   *   oppure apertura di IndexedDB sostituita (usati dai test); dbName: database del profilo
   * @returns {Promise<object>} lo store
   */
  async function openStore(storage, opts) {
    let backend = opts && opts.backend;
    let avviso = null;
    if (!backend) {
      try {
        backend = await ((opts && opts.openIdb) || openIdbBackend)((opts && opts.dbName) || DB_NAME);
      } catch (e) {
        console.error('Archivio: IndexedDB non si apre, ripiego su localStorage', e);
        avviso = avvisoRipiego(e);
        backend = localBackend(storage);
      }
    }
    let text;
    let error = null;
    let bloccato = false;
    try {
      text = await backend.get(DB_KEY);
    } catch (e) {
      console.error('Archivio: lettura dello stato non riuscita', e);
      // Lo stato vuoto non deve sovrascrivere i dati che non si sono potuti leggere.
      error = 'Impossibile leggere i dati salvati: ' + e.message + '. I salvataggi sono sospesi per non sovrascriverli: ricarica la pagina.';
      bloccato = true;
    }
    let legacy = null;
    if (!bloccato && (text === null || text === undefined)) {
      try { legacy = storage.getItem(LEGACY_KEY); } catch (e) { console.warn('Archivio: salvataggio della versione 1 non leggibile', e); }
      text = legacy;
    }
    const loaded = parseSaved(text);
    if (loaded.corrupted) {
      // Conserva una copia dei dati illeggibili invece di sovrascriverli e perderli.
      try {
        await backend.set(DB_KEY + '-danneggiato', loaded.corrupted);
      } catch (e) {
        console.error('Archivio: copia dei dati danneggiati non riuscita', e);
        loaded.error += ' Non è stato possibile conservarne una copia: i salvataggi sono sospesi per non perderli ('
          + saveErrorMessage(e) + ').';
        bloccato = true;
      }
    }

    let queued = null;
    let writing = null;
    let waiters = [];
    const store = {
      state: loaded.state,
      backend: backend.name,
      // Archivio delle immagini importate: stesso database, chiavi separate dallo stato.
      blobs: { get: (k) => backend.get(k), set: (k, v) => backend.set(k, v), del: (k) => (backend.del ? backend.del(k) : backend.set(k, null)) },
      loadError: [avviso, error || loaded.error].filter(Boolean).join(' ') || null,
      // Sola lettura: i dati sul disco non si sono potuti leggere né copiare, quindi non si sovrascrivono.
      bloccato,
      onSaveError: null,
      // Dopo ogni modifica (update, replace): la sessione online manda gli aggiornamenti ai giocatori.
      onChange: null,
      lastError: null,
      // Contatori delle modifiche e dell'ultima scrittura riuscita (il backup automatico salva solo se ci sono novità).
      modifiche: 0,
      salvate: 0,
      save() {
        if (store.bloccato) {
          if (store.onChange) store.onChange();
          return Promise.resolve({ ok: false, error: null, message: 'salvataggi sospesi: i dati sul disco non si sono potuti leggere o copiare.' });
        }
        queued = JSON.stringify(store.state);
        store.modifiche++;
        if (store.onChange) store.onChange();
        const result = new Promise((resolve) => waiters.push(resolve));
        if (!writing) writing = flush();
        return result;
      },
      update(fn) {
        fn(store.state);
        return store.save();
      },
      replace(state) {
        store.state = state;
        return store.save();
      },
      // Promessa risolta quando tutte le scritture in corso sono terminate.
      saved: () => writing || Promise.resolve(),
      // Chiude il database (test, eliminazione di un profilo): dopo, lo store non va più usato.
      chiudi: async () => { await (writing || Promise.resolve()); if (backend.chiudi) backend.chiudi(); },
      // Cancella tutto (stato, immagini, suoni, cartella di backup collegata e dati del gioco online) e riparte da uno
      // stato vuoto.
      async clearAll() {
        await store.saved();
        await backend.clear();
        cancellaOnline(storage);
        // Cancellazione voluta dall'utente: i dati illeggibili non vanno più protetti.
        store.bloccato = false;
        return store.replace(emptyState());
      },
    };

    async function flush() {
      while (queued !== null) {
        const value = queued;
        const mine = waiters;
        const numero = store.modifiche;
        queued = null;
        waiters = [];
        let result;
        try {
          await backend.set(DB_KEY, value);
          store.lastError = null;
          store.salvate = numero;
          result = { ok: true, error: null, message: '' };
          if (legacy !== null) {
            // Migrazione completata: il vecchio salvataggio in localStorage non serve più.
            try { storage.removeItem(LEGACY_KEY); } catch (e) { console.warn('Archivio: vecchio salvataggio non rimosso', e); }
            legacy = null;
          }
        } catch (e) {
          store.lastError = e;
          result = { ok: false, error: e, message: saveErrorMessage(e) };
          if (store.onSaveError) store.onSaveError(e);
        }
        for (const resolve of mine) resolve(result);
      }
      writing = null;
    }

    if (legacy !== null && !loaded.corrupted) await store.save();
    return store;
  }

  /**
   * Apre l'archivio e lo rende lo store dell'app (DnD.store, con l'archivio delle immagini DnD.immagini), letto
   * dall'interfaccia e dalla rete.
   * @param {Storage} storage preferenze del profilo (o un sostituto)  @param {{backend?: object, dbName?: string}} [opts]
   * @returns {Promise<object>} lo store
   */
  async function apri(storage, opts) {
    DnD.store = await openStore(storage, opts);
    // Immagini importate (TileSet e sfondi delle griglie): stesso database, con cache in memoria.
    DnD.immagini = DnD.immaginiLib.createStore(DnD.store.blobs);
    return DnD.store;
  }

  // ---------- Ambiente: localStorage e IndexedDB veri, oppure in memoria (prova e test) ----------
  function ambienteReale() {
    return {
      storage: L.base,
      apriDb: (nome) => openIdbBackend(nome),
      eliminaDb: eliminaIdb,
      elencaDb: async () => {
        if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
        try { return (await indexedDB.databases()).map((d) => d.name); } catch (e) { return null; }
      },
    };
  }
  /** Ambiente in memoria (stesse funzioni dell'ambiente reale). guasto(fase) può lanciare per provare gli errori. */
  function ambienteMemoria(storage, guasto) {
    const dbs = new Map();
    const g = guasto || (() => {});
    const backendDi = (nome) => {
      const m = dbs.get(nome);
      return {
        name: 'memoria',
        db: nome,
        get: async (k) => (m.has(k) ? m.get(k) : null),
        set: async (k, v) => { g('scrivi', nome, k); m.set(k, v); },
        del: async (k) => { m.delete(k); },
        chiavi: async () => [...m.keys()],
        clear: async () => { m.clear(); },
        chiudi: () => {},
      };
    };
    return {
      storage: storage || L.memoria(),
      dbs,
      apriDb: async (nome) => { g('apri', nome); if (!dbs.has(nome)) dbs.set(nome, new Map()); return backendDi(nome); },
      eliminaDb: async (nome) => { dbs.delete(nome); return true; },
      elencaDb: async () => [...dbs.keys()],
    };
  }

  // ---------- Migrazione ai profili (registro versione 1) ----------
  // Backup esportabile dei dati di prima: stesso formato di «Esporta archivio» (si reimporta come un archivio),
  // con in più le preferenze grezze. valori: chiavi del database; locali: chiavi «dnd-battaglie:…» di localStorage.
  function backupDi(valori, locali) {
    const statoTesto = valori[DB_KEY] || locali[DB_NAME + ':' + DB_KEY] || locali[LEGACY_KEY] || null;
    let stato = null;
    try { stato = statoTesto ? JSON.parse(statoTesto) : null; } catch (e) { stato = null; }
    const images = {};
    const file = {};
    const tutti = Object.assign({}, valori);
    for (const [k, v] of Object.entries(locali)) if (k.startsWith(DB_NAME + ':img:') || k.startsWith(DB_NAME + ':snd:')) tutti[k.slice(DB_NAME.length + 1)] = v;
    for (const [k, v] of Object.entries(tutti)) {
      if (typeof v !== 'string') continue;
      if (k.startsWith('img:')) images[k.slice(4)] = v;
      if (k.startsWith('snd:')) file[k.slice(4)] = v;
    }
    let suoni = null;
    try { suoni = { impostazioni: JSON.parse(locali[DB_NAME + ':suoni'] || 'null'), file }; } catch (e) { suoni = { impostazioni: null, file }; }
    const preferenze = {};
    for (const [k, v] of Object.entries(locali)) if (!k.startsWith(DB_NAME + ':img:') && !k.startsWith(DB_NAME + ':snd:') && k !== DB_NAME + ':' + DB_KEY && k !== LEGACY_KEY) preferenze[k] = v;
    const testa = { app: DnD.config ? DnD.config.APP_NAME : 'Session Forge', kind: stato && Array.isArray(stato.races) ? 'archivio' : 'backup-migrazione', exportedAt: new Date().toISOString() };
    return JSON.stringify(Object.assign(testa, stato || {}, { images, suoni, backupMigrazione: { preferenze, statoGrezzo: stato ? null : statoTesto } }));
  }
  const uguali = (a, b) => (typeof a === 'string' || typeof b === 'string' ? a === b : JSON.stringify(a) === JSON.stringify(b));

  /**
   * Migra i dati di prima dei profili (database «dnd-battaglie», chiavi «dnd-battaglie:…») nel profilo «Master»:
   * backup automatico prima, copia nel database del profilo con verifica, spostamento delle chiavi di localStorage,
   * poi il registro. Se un passo fallisce, tutto torna com'era (il database vecchio non si tocca mai).
   * @param {object} env ambiente (ambienteReale() o ambienteMemoria())
   * @returns {Promise<{ok: boolean, fatto: boolean, primoAvvio?: boolean, backup?: string, errore?: string, rimanda?: boolean}>}
   */
  async function migraProfili(env) {
    const reg = L.leggiRegistro(env.storage);
    if (reg && Number(reg.versione) >= PR.VERSIONE) return { ok: true, fatto: false };
    const ora = Date.now();
    const vecchie = L.chiaviDi(env.storage).filter((k) => k.startsWith(DB_NAME + ':'));
    const nomiDb = await env.elencaDb();
    let vecchio = null;
    let chiaviDb = [];
    if (nomiDb === null || nomiDb.includes(DB_NAME)) {
      try {
        vecchio = await env.apriDb(DB_NAME);
        chiaviDb = await vecchio.chiavi();
      } catch (e) {
        // IndexedDB non leggibile: non si migra ora (i dati potrebbero esserci), si riprova al prossimo avvio.
        console.error('Profili: database precedente non leggibile, migrazione rimandata', e);
        return { ok: false, fatto: false, rimanda: true, errore: 'Migrazione ai profili rimandata: i dati salvati non si sono potuti leggere (' + saveErrorMessage(e) + '). L\'app usa l\'archivio di prima; ricarica la pagina per riprovare.' };
      }
    }
    // Solo preferenze (nessuno stato salvato): si spostano, ma il profilo resta «nuovo» (guida del primo avvio).
    const haStato = chiaviDb.includes(DB_KEY) || vecchie.includes(DB_NAME + ':' + DB_KEY) || vecchie.includes(LEGACY_KEY);
    const profilo = PR.crea({ id: 'master', nome: 'Master', ruolo: 'master', nuovo: !haStato }, [], ora);
    const registro = { versione: PR.VERSIONE, attivo: profilo.id, profili: [profilo], portale: Object.assign({}, PR.PORTALE_PREDEFINITO), migrazione: { versione: PR.VERSIONE, ora, dbVecchio: null, vuoto: true } };
    if (!chiaviDb.length && !vecchie.length) {
      // Primo avvio: niente da migrare (il database aperto per controllare era vuoto).
      if (vecchio) { try { if (vecchio.chiudi) vecchio.chiudi(); await env.eliminaDb(DB_NAME); } catch (e) { /* resta un database vuoto */ } }
      try { L.scriviRegistro(env.storage, registro); } catch (e) { return { ok: false, fatto: false, errore: 'Il registro dei profili non si è potuto salvare: ' + saveErrorMessage(e) }; }
      return { ok: true, fatto: true, primoAvvio: true };
    }
    // Backup automatico prima di toccare qualsiasi cosa.
    const valori = {};
    for (const k of chiaviDb) valori[k] = await vecchio.get(k);
    const locali = {};
    for (const k of vecchie) locali[k] = env.storage.getItem(k);
    const backup = backupDi(valori, locali);
    const nomi = L.nomi(profilo.id);
    const spostate = [];
    let nuovo = null;
    try {
      nuovo = await env.apriDb(nomi.db);
      for (const k of chiaviDb) await nuovo.set(k, valori[k]);
      for (const k of chiaviDb) if (!uguali(await nuovo.get(k), valori[k])) throw new Error('la copia di «' + k + '» non corrisponde all\'originale');
      for (const k of vecchie) {
        const dest = nomi.prefisso + k.slice(DB_NAME.length + 1);
        env.storage.setItem(dest, locali[k]);
        spostate.push(k);
        env.storage.removeItem(k);
      }
      let backupSalvato = false;
      try { await nuovo.set(BACKUP_MIGRAZIONE, backup); backupSalvato = true; } catch (e) { console.warn('Profili: backup della migrazione non conservato nel database', e); }
      registro.migrazione = { versione: PR.VERSIONE, ora, dbVecchio: chiaviDb.length ? DB_NAME : null, vuoto: !haStato, backupSalvato };
      L.scriviRegistro(env.storage, registro);
      if (vecchio && vecchio.chiudi) vecchio.chiudi();
      return { ok: true, fatto: true, backup, backupSalvato };
    } catch (e) {
      console.error('Profili: migrazione non riuscita, ripristino', e);
      for (const k of spostate) {
        try { env.storage.setItem(k, locali[k]); env.storage.removeItem(nomi.prefisso + k.slice(DB_NAME.length + 1)); } catch (err) { console.error('Profili: chiave non ripristinata', k, err); }
      }
      try { env.storage.removeItem(L.REGISTRO); } catch (err) { /* nessun registro scritto */ }
      try { if (nuovo && nuovo.chiudi) nuovo.chiudi(); await env.eliminaDb(nomi.db); } catch (err) { console.error('Profili: database nuovo non eliminato', err); }
      if (vecchio && vecchio.chiudi) vecchio.chiudi();
      return { ok: false, fatto: false, backup, errore: 'Migrazione ai profili non riuscita (' + saveErrorMessage(e) + '): i dati sono rimasti come prima e l\'app li usa senza profili. Scarica il backup e riprova ricaricando la pagina.' };
    }
  }

  // ---------- Profili: registro, creazione, modifica, duplicazione, eliminazione, cancellazione totale ----------
  /** Gestore dei profili su un ambiente (di base quello reale). */
  function gestoreProfili(env) {
    const leggi = () => PR.normalizzaRegistro(L.leggiRegistro(env.storage) || {});
    const scrivi = (reg) => { L.scriviRegistro(env.storage, reg); if (env.storage === L.base) L.ricarica(); return reg; };
    const prefissate = (id) => L.chiaviDi(env.storage).filter((k) => k.startsWith(L.nomi(id).prefisso));
    function trova(reg, id) {
      const p = reg.profili.find((x) => x.id === id);
      if (!p) throw new Error('Profilo non trovato.');
      return p;
    }
    return {
      registro: leggi,
      elenco: () => leggi().profili,
      attivo: () => { const r = leggi(); return r.profili.find((p) => p.id === r.attivo) || null; },
      portale: () => leggi().portale,
      impostaPortale(patch) { const r = leggi(); r.portale = Object.assign({}, r.portale, patch); return scrivi(r).portale; },
      segnaMigrazione(patch) { const r = leggi(); if (r.migrazione) Object.assign(r.migrazione, patch); scrivi(r); },
      crea(dati) {
        const r = leggi();
        const p = PR.crea(dati, r.profili);
        r.profili.push(p);
        if (!r.attivo) r.attivo = p.id;
        scrivi(r);
        return p;
      },
      modifica(id, patch) {
        const r = leggi();
        const p = trova(r, id);
        const n = PR.normalizzaProfilo(Object.assign({}, p, patch, { id: p.id }));
        r.profili[r.profili.indexOf(p)] = n;
        scrivi(r);
        return n;
      },
      // Profilo attivo (l'app poi si ricarica: ogni modulo legge l'archivio del nuovo profilo).
      attiva(id) {
        const r = leggi();
        const p = trova(r, id);
        p.usato = Date.now();
        r.attivo = id;
        scrivi(r);
        return p;
      },
      // Copia completa: database (stato, immagini, suoni) e preferenze; il PIN non si copia.
      async duplica(id, nome) {
        const r = leggi();
        const p = trova(r, id);
        const copia = PR.crea({ nome: nome || (p.nome + ' (copia)'), colore: p.colore, avatar: p.avatar, ruolo: p.ruolo, nuovo: p.nuovo }, r.profili);
        const da = L.nomi(id);
        const a = L.nomi(copia.id);
        const sorgente = await env.apriDb(da.db);
        const dest = await env.apriDb(a.db);
        const scritte = [];
        try {
          for (const k of await sorgente.chiavi()) {
            if (k === BACKUP_MIGRAZIONE || k === IMPORTAZIONE) continue;
            await dest.set(k, await sorgente.get(k));
          }
          for (const k of prefissate(id)) {
            const nk = a.prefisso + k.slice(da.prefisso.length);
            env.storage.setItem(nk, env.storage.getItem(k));
            scritte.push(nk);
          }
          r.profili.push(copia);
          scrivi(r);
        } catch (e) {
          for (const k of scritte) env.storage.removeItem(k);
          if (dest.chiudi) dest.chiudi();
          await env.eliminaDb(a.db);
          throw new Error('Copia del profilo non riuscita: ' + saveErrorMessage(e));
        } finally {
          if (sorgente.chiudi) sorgente.chiudi();
          if (dest.chiudi) dest.chiudi();
        }
        return copia;
      },
      // Elimina database e preferenze del profilo; se era l'attivo, diventa attivo il primo rimasto (o un «Master» nuovo).
      async elimina(id) {
        const r = leggi();
        trova(r, id);
        await env.eliminaDb(L.nomi(id).db);
        for (const k of prefissate(id)) env.storage.removeItem(k);
        r.profili = r.profili.filter((p) => p.id !== id);
        if (!r.profili.length) r.profili.push(PR.crea({ id: 'master', nome: 'Master', ruolo: 'master' }, []));
        if (r.attivo === id || !r.profili.some((p) => p.id === r.attivo)) r.attivo = r.profili[0].id;
        scrivi(r);
        return r;
      },
      // «Cancella tutti i dati» per tutti i profili: database, preferenze, registro e anche i dati di prima della migrazione.
      async cancellaTutti() {
        const r = leggi();
        for (const p of r.profili) await env.eliminaDb(L.nomi(p.id).db);
        await env.eliminaDb(DB_NAME);
        for (const k of L.chiaviDi(env.storage)) if (k === L.REGISTRO || k.startsWith('sessionforge-') || k.startsWith(DB_NAME + ':')) env.storage.removeItem(k);
        if (env.storage === L.base) L.ricarica();
      },
      // Database di prima della migrazione, conservato per sicurezza: si può eliminare dalla pagina «Dati e backup».
      async eliminaVecchio() {
        await env.eliminaDb(DB_NAME);
        const reg = leggi();
        if (reg.migrazione) { reg.migrazione.dbVecchio = null; scrivi(reg); }
      },
      // Testo da importare al primo avvio del profilo indicato (importazione «in un profilo nuovo»).
      async mettiImportazione(id, testo) {
        const db = await env.apriDb(L.nomi(id).db);
        try { await db.set(IMPORTAZIONE, testo); } finally { if (db.chiudi) db.chiudi(); }
      },
    };
  }

  // ---------- Spazio e archiviazione persistente ----------
  const storageApi = () => (typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null);
  /** { usato, quota } in byte, o null se il browser non lo dice. */
  async function spazio() {
    const s = storageApi();
    if (!s || typeof s.estimate !== 'function') return null;
    try { const e = await s.estimate(); return { usato: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; }
  }
  /** true / false, o null se il browser non lo dice. */
  async function persistente() {
    const s = storageApi();
    if (!s || typeof s.persisted !== 'function') return null;
    try { return await s.persisted(); } catch (e) { return null; }
  }
  /** Chiede l'archiviazione persistente: true se concessa, false se rifiutata, null se non disponibile. */
  async function richiediPersistenza() {
    const s = storageApi();
    if (!s || typeof s.persist !== 'function') return null;
    try { return await s.persist(); } catch (e) { return false; }
  }

  // ---------- Cartella di backup (File System Access: Chrome, Edge, Opera) ----------
  const cartellaDisponibile = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  /** Adattatore di una cartella vera (FileSystemDirectoryHandle) con l'interfaccia usata da stato/backup.js. */
  function adattatoreCartella(handle) {
    const opz = { mode: 'readwrite' };
    return {
      nome: handle.name,
      permesso: async () => (handle.queryPermission ? handle.queryPermission(opz) : 'granted'),
      chiediPermesso: async () => (handle.requestPermission ? handle.requestPermission(opz) : 'granted'),
      async elenca() {
        const out = [];
        for await (const [nome, h] of handle.entries()) if (h.kind === 'file') out.push(nome);
        return out;
      },
      async scrivi(nome, testo) {
        const f = await handle.getFileHandle(nome, { create: true });
        const w = await f.createWritable();
        await w.write(testo);
        await w.close();
      },
      async leggi(nome) {
        const f = await handle.getFileHandle(nome);
        return (await f.getFile()).text();
      },
      elimina: (nome) => handle.removeEntry(nome),
    };
  }
  // Collegamento alla cartella: l'handle si conserva nel database del profilo (non in localStorage).
  async function scegliCartella() {
    const handle = await window.showDirectoryPicker({ id: 'session-forge-backup', mode: 'readwrite' });
    await DnD.store.blobs.set(CARTELLA, handle);
    return adattatoreCartella(handle);
  }
  async function cartellaCollegata() {
    let h = null;
    try { h = await DnD.store.blobs.get(CARTELLA); } catch (e) { h = null; }
    return h && typeof h === 'object' && h.kind === 'directory' ? adattatoreCartella(h) : null;
  }
  async function scollegaCartella() {
    try { await DnD.store.blobs.del(CARTELLA); } catch (e) { /* già scollegata */ }
  }
  // Backup automatico di prima della migrazione e importazione in sospeso (nel database del profilo attivo).
  const backupMigrazione = async () => { try { return await DnD.store.blobs.get(BACKUP_MIGRAZIONE); } catch (e) { return null; } };
  async function prendiImportazione() {
    let t = null;
    try { t = await DnD.store.blobs.get(IMPORTAZIONE); } catch (e) { return null; }
    if (typeof t === 'string') { try { await DnD.store.blobs.del(IMPORTAZIONE); } catch (e) { /* si riproporrebbe */ } return t; }
    return null;
  }

  // ---------- Avvio dell'app ----------
  const backendMemoria = () => {
    const data = {};
    return { name: 'memoria', get: async (k) => (k in data ? data[k] : null), set: async (k, v) => { data[k] = v; }, del: async (k) => { delete data[k]; }, chiavi: async () => Object.keys(data), clear: async () => { for (const k of Object.keys(data)) delete data[k]; } };
  };
  /**
   * Avvio: migrazione ai profili (se serve), poi l'archivio del profilo attivo come store dell'app. In prova
   * (index.html?prova) tutto è in memoria.
   * @returns {Promise<{migrazione: object, profilo: string|null}>}
   */
  async function avvia() {
    const env = L.PROVA ? ambienteMemoria(L.base) : ambienteReale();
    const migrazione = await migraProfili(env);
    L.ricarica();
    DnD.archivio.profili = gestoreProfili(env);
    const id = L.attivo();
    await apri(L.preferenze, L.PROVA ? { backend: backendMemoria() } : { dbName: L.nomi(id).db });
    return { migrazione, profilo: id };
  }

  DnD.archivio = {
    openStore, saveErrorMessage, apri, avvia, migraProfili, gestoreProfili, ambienteReale, ambienteMemoria, backupDi, eliminaIdb, openIdbBackend,
    spazio, persistente, richiediPersistenza, cartellaDisponibile, adattatoreCartella, scegliCartella, cartellaCollegata, scollegaCartella,
    backupMigrazione, prendiImportazione,
    profili: null, // gestore dei profili dell'app (avvia)
  };
  // Sorgente dello stato corrente per le regole (modello.statoCorrente): lo store aperto, se c'è.
  DnD.modello.registraFonteStato(() => (DnD.store ? DnD.store.state : null));
  // DnD.dati resta la facciata pubblica dello stato (app.js, test): qui le si aggiungono le funzioni dell'archivio.
  Object.assign(DnD.dati, { openStore, saveErrorMessage });
})(globalThis.DnD = globalThis.DnD || {});
