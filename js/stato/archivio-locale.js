// Archivio locale (prima parte del modulo di archivio, caricata in <head> prima delle impostazioni): registro dei
// profili e profilo attivo (archivio condiviso, chiave «sessionforge:profili»), nomi degli archivi di ogni profilo
// (database IndexedDB «sessionforge-<id>», prefisso «sessionforge-<id>:» in localStorage) e la vista delle
// preferenze del profilo attivo, con cui tutti gli altri file leggono e scrivono le loro chiavi «dnd-battaglie:…»
// senza toccare lo storage. Senza registro (prima della migrazione) valgono i nomi di sempre («dnd-battaglie»).
// Livello stato. Espone DnD.archivioLocale; non dipende da altri moduli. Il resto dell'archivio è stato/archivio.js.
(function (DnD) {
  'use strict';

  const VECCHIO = 'dnd-battaglie';
  const REGISTRO = 'sessionforge:profili';
  const SBLOCCO = 'sessionforge:sbloccato'; // sessionStorage: profilo con PIN già sbloccato in questa scheda
  const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  // Modalità di prova (index.html?prova, test di fumo): tutto in memoria, nulla tocca i dati veri dell'utente.
  const PROVA = typeof location !== 'undefined' && /[?&]prova(?:[=&]|$)/.test(location.search || '');

  // Storage in memoria con la stessa interfaccia di localStorage (prova, test, ripiego se localStorage è negato).
  function memoria() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)); },
      removeItem: (k) => { m.delete(String(k)); },
      key: (i) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
      clear: () => m.clear(),
    };
  }

  function baseReale() {
    if (PROVA) return memoria();
    try {
      const s = globalThis.localStorage;
      s.getItem(REGISTRO);
      return s;
    } catch (e) {
      return memoria();
    }
  }
  const base = baseReale();

  /** Nomi degli archivi di un profilo; id null = archivio di prima dei profili. */
  function nomi(id) {
    return id ? { db: 'sessionforge-' + id, prefisso: 'sessionforge-' + id + ':' } : { db: VECCHIO, prefisso: VECCHIO + ':' };
  }

  // Tutte le chiavi di uno storage (lettura sicura).
  function chiaviDi(storage) {
    const out = [];
    try { for (let i = 0; i < storage.length; i++) out.push(storage.key(i)); } catch (e) { /* storage non leggibile */ }
    return out.filter((k) => typeof k === 'string');
  }

  /**
   * Vista di uno storage sotto un prefisso: le chiavi «dnd-battaglie:x» (quelle di sempre) diventano «<prefisso>x».
   * Stessa interfaccia di localStorage; key(i) restituisce le chiavi nella forma «dnd-battaglie:x».
   */
  function vista(storage, prefisso) {
    const vera = (k) => (String(k).startsWith(VECCHIO + ':') ? prefisso + String(k).slice(VECCHIO.length + 1) : prefisso + String(k));
    const proprie = () => chiaviDi(storage).filter((k) => k.startsWith(prefisso)).map((k) => VECCHIO + ':' + k.slice(prefisso.length));
    return {
      prefisso,
      getItem: (k) => storage.getItem(vera(k)),
      setItem: (k, v) => storage.setItem(vera(k), v),
      removeItem: (k) => storage.removeItem(vera(k)),
      key: (i) => proprie()[i] ?? null,
      get length() { return proprie().length; },
      chiavi: proprie,
      clear: () => { for (const k of proprie()) storage.removeItem(vera(k)); },
    };
  }

  // Registro dei profili così com'è salvato (la normalizzazione completa è in stato/profili.js).
  function leggiRegistro(storage) {
    try {
      const r = JSON.parse((storage || base).getItem(REGISTRO));
      return r && typeof r === 'object' && Array.isArray(r.profili) ? r : null;
    } catch (e) {
      return null;
    }
  }
  // Lancia l'errore del browser se non si può scrivere (spazio esaurito, archiviazione negata).
  function scriviRegistro(storage, reg) {
    (storage || base).setItem(REGISTRO, JSON.stringify(reg));
  }
  function attivoDi(reg) {
    if (!reg || !ID.test(String(reg.attivo || ''))) return null;
    return reg.profili.some((p) => p && p.id === reg.attivo) ? reg.attivo : null;
  }

  // Profilo attivo e vista delle sue preferenze: si rileggono dopo la migrazione o un cambio di profilo.
  const S = { attivo: null, preferenze: null };
  function ricarica() {
    S.attivo = attivoDi(leggiRegistro(base));
    S.preferenze = vista(base, nomi(S.attivo).prefisso);
    return S.attivo;
  }
  ricarica();

  // PIN già inserito in questa scheda (sessionStorage; in prova in memoria).
  const sessione = (() => { if (PROVA) return memoria(); try { return globalThis.sessionStorage; } catch (e) { return memoria(); } })();
  const sbloccato = (id) => { try { return sessione.getItem(SBLOCCO) === id; } catch (e) { return false; } };
  const sblocca = (id) => { try { if (id) sessione.setItem(SBLOCCO, id); else sessione.removeItem(SBLOCCO); } catch (e) { /* resta da sbloccare */ } };

  DnD.archivioLocale = {
    VECCHIO, REGISTRO, ID, PROVA, memoria, base, nomi, chiaviDi, vista, leggiRegistro, scriviRegistro, attivoDi, ricarica, sbloccato, sblocca,
    attivo: () => S.attivo,
    // Preferenze del profilo attivo (stessa interfaccia di localStorage): l'unica via per le chiavi «dnd-battaglie:…».
    get preferenze() { return S.preferenze; },
  };
})(globalThis.DnD = globalThis.DnD || {});
