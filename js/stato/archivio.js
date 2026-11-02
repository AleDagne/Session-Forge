// Archivio dei dati sul disco del browser: IndexedDB (stato, immagini «img:», suoni «snd:»), con ripiego avvisato su
// localStorage; scritture in fila con esito reale, copia dei dati danneggiati (se non riesce o la lettura fallisce,
// sola lettura), migrazione dal salvataggio della versione 1. È l'unico modulo che scrive lo stato su disco. Livello
// stato (in cima). Espone DnD.archivio e aggiunge openStore e saveErrorMessage a DnD.dati; usa DnD.dati (emptyState,
// parseSaved).
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

  // Dati del gioco online in localStorage (profilo, gettoni, note, ripresa, server STUN): li cancella «Cancella tutti i
  // dati» insieme all'archivio; le preferenze di visualizzazione e dei suoni restano.
  const PREFISSO_ONLINE = DB_NAME + ':online-';
  function cancellaOnline(storage) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) if (String(storage.key(i)).startsWith(PREFISSO_ONLINE)) keys.push(storage.key(i));
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
   * @param {Storage} storage localStorage (o un sostituto)
   * @param {{backend?: object, openIdb?: Function}} [opts] backend alternativo { name, get, set, clear } oppure
   *   apertura di IndexedDB sostituita (usati dai test)
   * @returns {Promise<object>} lo store
   */
  async function openStore(storage, opts) {
    let backend = opts && opts.backend;
    let avviso = null;
    if (!backend) {
      try {
        backend = await ((opts && opts.openIdb) || openIdbBackend)();
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
      blobs: { get: (k) => backend.get(k), set: (k, v) => backend.set(k, v) },
      loadError: [avviso, error || loaded.error].filter(Boolean).join(' ') || null,
      // Sola lettura: i dati sul disco non si sono potuti leggere né copiare, quindi non si sovrascrivono.
      bloccato,
      onSaveError: null,
      // Dopo ogni modifica (update, replace): la sessione online manda gli aggiornamenti ai giocatori.
      onChange: null,
      lastError: null,
      save() {
        if (store.bloccato) {
          if (store.onChange) store.onChange();
          return Promise.resolve({ ok: false, error: null, message: 'salvataggi sospesi: i dati sul disco non si sono potuti leggere o copiare.' });
        }
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
      // Cancella tutto (stato, immagini, suoni e dati del gioco online) e riparte da uno stato vuoto.
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
        queued = null;
        waiters = [];
        let result;
        try {
          await backend.set(DB_KEY, value);
          store.lastError = null;
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
   * @param {Storage} storage localStorage (o un sostituto)  @param {{backend?: object}} [opts]
   * @returns {Promise<object>} lo store
   */
  async function apri(storage, opts) {
    DnD.store = await openStore(storage, opts);
    // Immagini importate (TileSet e sfondi delle griglie): stesso database, con cache in memoria.
    DnD.immagini = DnD.immaginiLib.createStore(DnD.store.blobs);
    return DnD.store;
  }

  DnD.archivio = { openStore, saveErrorMessage, apri };
  // Sorgente dello stato corrente per le regole (modello.statoCorrente): lo store aperto, se c'è.
  DnD.modello.registraFonteStato(() => (DnD.store ? DnD.store.state : null));
  // DnD.dati resta la facciata pubblica dello stato (app.js, test): qui le si aggiungono le funzioni dell'archivio.
  Object.assign(DnD.dati, { openStore, saveErrorMessage });
})(globalThis.DnD = globalThis.DnD || {});
