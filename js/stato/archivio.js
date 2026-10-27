// Archivio dei dati sul disco del browser: IndexedDB (stato, immagini «img:», suoni «snd:»), con ripiego su
// localStorage; scritture in fila con esito reale, copia dei dati danneggiati, migrazione dal salvataggio della
// versione 1. È l'unico modulo che scrive lo stato su disco. Livello stato (in cima). Espone DnD.archivio e aggiunge
// openStore e saveErrorMessage a DnD.dati; usa DnD.dati (emptyState, parseSaved).
(function (DnD) {
  'use strict';

  const DB_KEY = 'stato';
  const DB_NAME = 'dnd-battaglie';
  const DB_STORE = 'kv';
  const LEGACY_KEY = 'dnd-battaglie:dati'; // salvataggio in localStorage della versione 1
  const { emptyState, parseSaved } = DnD.dati;

  // --- Persistenza: IndexedDB (spazio ampio, adatto alle immagini), con ripiego su localStorage ---
  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function openIdbBackend() {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    const db = await idbRequest(req);
    const tx = (mode) => db.transaction(DB_STORE, mode).objectStore(DB_STORE);
    return {
      name: 'IndexedDB',
      get: (key) => idbRequest(tx('readonly').get(key)).then((v) => (v === undefined ? null : v)),
      set: (key, value) => new Promise((resolve, reject) => {
        const t = db.transaction(DB_STORE, 'readwrite');
        t.objectStore(DB_STORE).put(value, key);
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error || new Error('Scrittura annullata'));
      }),
      // Svuota tutto il database: stato e immagini.
      clear: () => new Promise((resolve, reject) => {
        const t = db.transaction(DB_STORE, 'readwrite');
        t.objectStore(DB_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error || new Error('Cancellazione annullata'));
      }),
    };
  }

  function localBackend(storage) {
    return {
      name: 'localStorage',
      get: async (key) => storage.getItem(DB_NAME + ':' + key),
      set: async (key, value) => storage.setItem(DB_NAME + ':' + key, value),
      // Solo le chiavi dei dati (stato, immagini e file dei suoni): le impostazioni di visualizzazione restano.
      clear: async () => {
        const keys = [];
        for (let i = 0; i < storage.length; i++) if (storage.key(i).startsWith(DB_NAME + ':')) keys.push(storage.key(i));
        for (const k of keys) if (k === DB_NAME + ':' + DB_KEY || k.startsWith(DB_NAME + ':img:') || k.startsWith(DB_NAME + ':snd:')) storage.removeItem(k);
      },
    };
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
    return (e && e.message) || 'errore sconosciuto';
  }

  // opts.backend: archivio alternativo { name, get, set, clear } (usato dai test).
  async function openStore(storage, opts) {
    let backend = opts && opts.backend;
    if (!backend) {
      try {
        backend = await openIdbBackend();
      } catch (e) {
        backend = localBackend(storage);
      }
    }
    let text;
    let error = null;
    try {
      text = await backend.get(DB_KEY);
    } catch (e) {
      error = 'Impossibile leggere i dati salvati: ' + e.message;
    }
    let legacy = null;
    if (text === null || text === undefined) {
      try { legacy = storage.getItem(LEGACY_KEY); } catch (e) { /* nessun dato precedente */ }
      text = legacy;
    }
    const loaded = parseSaved(text);
    if (loaded.corrupted) {
      // Conserva una copia dei dati illeggibili invece di sovrascriverli e perderli.
      try { await backend.set(DB_KEY + '-danneggiato', loaded.corrupted); } catch (e) { /* ignora */ }
    }

    let queued = null;
    let writing = null;
    let waiters = [];
    const store = {
      state: loaded.state,
      backend: backend.name,
      // Archivio delle immagini importate: stesso database, chiavi separate dallo stato.
      blobs: { get: (k) => backend.get(k), set: (k, v) => backend.set(k, v) },
      loadError: error || loaded.error,
      onSaveError: null,
      // Dopo ogni modifica (update, replace): la sessione online manda gli aggiornamenti ai giocatori.
      onChange: null,
      lastError: null,
      save() {
        queued = JSON.stringify(store.state);
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
      // Cancella tutto (stato e immagini) e riparte da uno stato vuoto.
      async clearAll() {
        await store.saved();
        await backend.clear();
        return store.replace(emptyState());
      },
    };

    async function flush() {
      while (queued !== null) {
        const value = queued;
        const mine = waiters;
        queued = null;
        waiters = [];
        let result;
        try {
          await backend.set(DB_KEY, value);
          store.lastError = null;
          result = { ok: true, error: null, message: '' };
          if (legacy !== null) {
            // Migrazione completata: il vecchio salvataggio in localStorage non serve più.
            try { storage.removeItem(LEGACY_KEY); } catch (e) { /* ignora */ }
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

  DnD.archivio = { openStore, saveErrorMessage };
  // Sorgente dello stato corrente per le regole (modello.statoCorrente): lo store aperto, se c'è.
  DnD.modello.registraFonteStato(() => (DnD.store ? DnD.store.state : null));
  // DnD.dati resta la facciata pubblica dello stato (app.js, test): qui le si aggiungono le funzioni dell'archivio.
  Object.assign(DnD.dati, { openStore, saveErrorMessage });
})(globalThis.DnD = globalThis.DnD || {});
