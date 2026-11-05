// Profili locali (nessuna password, nessun account): forma del registro dei profili e dei singoli profili (nome,
// colore, avatar, ruolo preferito, PIN locale facoltativo), impostazioni del portale, identificativi, PIN con
// impronta salata. Livello stato, funzioni pure (il PIN usa crypto.subtle se c'è): non legge né scrive su disco, lo
// fa stato/archivio.js. Espone DnD.profili.
(function (DnD) {
  'use strict';

  const VERSIONE = 1; // versione del registro dei profili (migrazione in stato/archivio.js: migraProfili)
  const COLORE = /^#[0-9a-f]{6}$/i;
  const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const RUOLI = ['master', 'giocatore', 'spettatore'];
  const NOMI_RUOLI = { master: 'Master', giocatore: 'Giocatore', spettatore: 'Spettatore' };
  const COLORI = ['#c0553f', '#4f8cc9', '#3f9e6b', '#c9a24f', '#8a5cc2', '#d07a2a', '#3aa3a3', '#b84b7d'];
  // Avatar dalla libreria: emoji semplici (nessun file), oppure un'immagine piccola (data URL).
  const ICONE = ['🧙', '🛡', '🗡', '🏹', '🐉', '🎲', '📜', '🔮', '👑', '🦉', '🐺', '🌙'];
  const MAX_AVATAR = 200 * 1024;
  const AVATAR_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const PIN = /^\d{4,8}$/;
  const PORTALE_PREDEFINITO = { salta: false };

  const testo = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

  function normalizzaAvatar(a) {
    if (a && a.tipo === 'immagine' && typeof a.dati === 'string' && a.dati.length <= MAX_AVATAR && AVATAR_URL.test(a.dati)) return { tipo: 'immagine', dati: a.dati };
    return { tipo: 'icona', id: a && ICONE.includes(a.id) ? a.id : ICONE[0] };
  }
  function normalizzaPin(p) {
    if (!p || typeof p !== 'object' || typeof p.sale !== 'string' || typeof p.hash !== 'string') return null;
    if (!/^[0-9a-f]{16,64}$/.test(p.sale) || !/^[0-9a-f]{16,128}$/.test(p.hash)) return null;
    return { alg: p.alg === 'fnv' ? 'fnv' : 'pbkdf2', sale: p.sale, hash: p.hash };
  }

  /** Profilo salvato -> profilo valido (null se l'id non è valido). */
  function normalizzaProfilo(p) {
    if (!p || typeof p !== 'object' || !ID.test(String(p.id || ''))) return null;
    return {
      id: p.id,
      nome: testo(p.nome, 30) || 'Senza nome',
      colore: COLORE.test(p.colore || '') ? p.colore.toLowerCase() : COLORI[0],
      avatar: normalizzaAvatar(p.avatar),
      ruolo: RUOLI.includes(p.ruolo) ? p.ruolo : 'master',
      pin: normalizzaPin(p.pin),
      creato: Number.isFinite(p.creato) ? p.creato : 0,
      usato: Number.isFinite(p.usato) ? p.usato : 0,
      // Primo avvio: nessuna sessione creata dall'utente (il portale mostra la guida).
      nuovo: Boolean(p.nuovo),
    };
  }

  /** Registro salvato -> registro valido (profili unici, attivo esistente o il primo). */
  function normalizzaRegistro(r) {
    r = r && typeof r === 'object' ? r : {};
    const profili = (Array.isArray(r.profili) ? r.profili : []).map(normalizzaProfilo).filter(Boolean)
      .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
    const portale = Object.assign({}, PORTALE_PREDEFINITO, r.portale && typeof r.portale === 'object' ? { salta: Boolean(r.portale.salta) } : {});
    const m = r.migrazione && typeof r.migrazione === 'object' ? r.migrazione : null;
    return {
      versione: Number.isInteger(r.versione) ? r.versione : VERSIONE,
      attivo: profili.some((p) => p.id === r.attivo) ? r.attivo : (profili[0] ? profili[0].id : null),
      profili,
      portale,
      migrazione: m ? { versione: Number(m.versione) || 1, ora: Number(m.ora) || 0, dbVecchio: typeof m.dbVecchio === 'string' ? m.dbVecchio : null, vuoto: Boolean(m.vuoto), backupScaricato: Boolean(m.backupScaricato) } : null,
    };
  }

  /** Id nuovo, leggibile e unico: dal nome («Luca» -> «luca», poi «luca-2»…). */
  function nuovoId(nome, esistenti) {
    const base = String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'profilo';
    const usati = new Set(esistenti || []);
    if (!usati.has(base)) return base;
    for (let i = 2; ; i++) if (!usati.has(base + '-' + i)) return base + '-' + i;
  }

  /** Profilo nuovo con i valori predefiniti (colore a rotazione). */
  function crea(dati, esistenti, ora) {
    const ids = (esistenti || []).map((p) => p.id);
    const d = dati || {};
    return normalizzaProfilo({
      id: d.id && ID.test(d.id) && !ids.includes(d.id) ? d.id : nuovoId(d.nome, ids),
      nome: d.nome, colore: d.colore || COLORI[ids.length % COLORI.length], avatar: d.avatar, ruolo: d.ruolo, nuovo: d.nuovo !== false,
      creato: ora || Date.now(), usato: ora || Date.now(),
    });
  }

  // ---------- PIN locale (non sicuro contro chi usa lo stesso PC: solo un ostacolo per chi passa) ----------
  const esa = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  function saleCasuale() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return esa(b);
  }
  // Ripiego senza crypto.subtle (es. pagina non sicura): impronta FNV ripetuta, più debole.
  function impFnv(testoIn) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let r = 0; r < 2000; r++) {
      for (let i = 0; i < testoIn.length; i++) {
        const c = testoIn.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c ^ r, 0x5bd1e995) >>> 0;
      }
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + (h1 ^ h2).toString(16).padStart(8, '0');
  }
  const subtle = () => (globalThis.crypto && crypto.subtle && typeof crypto.subtle.importKey === 'function' ? crypto.subtle : null);
  async function impronta(pin, sale, alg) {
    const s = subtle();
    if (alg === 'fnv' || !s) return impFnv(sale + ':' + pin);
    const chiave = await s.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await s.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(sale), iterations: 100000, hash: 'SHA-256' }, chiave, 256);
    return esa(new Uint8Array(bits));
  }
  /** PIN -> { alg, sale, hash } da salvare (mai il PIN). Lancia un errore se il PIN non ha 4-8 cifre. */
  async function creaPin(pin, sale) {
    if (!PIN.test(String(pin || ''))) throw new Error('Il PIN deve avere da 4 a 8 cifre.');
    const sl = sale || saleCasuale();
    const alg = subtle() ? 'pbkdf2' : 'fnv';
    return { alg, sale: sl, hash: await impronta(String(pin), sl, alg) };
  }
  /** Il PIN corrisponde all'impronta salvata? */
  async function verificaPin(pin, salvato) {
    const p = normalizzaPin(salvato);
    if (!p || !PIN.test(String(pin || ''))) return false;
    return (await impronta(String(pin), p.sale, p.alg)) === p.hash;
  }

  DnD.profili = {
    VERSIONE, RUOLI, NOMI_RUOLI, COLORI, ICONE, MAX_AVATAR, PIN, PORTALE_PREDEFINITO,
    normalizzaProfilo, normalizzaRegistro, normalizzaAvatar, nuovoId, crea, creaPin, verificaPin,
  };
})(globalThis.DnD = globalThis.DnD || {});
