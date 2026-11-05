// Backup automatici: nomi dei file (app, profilo, data e ora), rotazione delle ultime 10 copie, scrittura con verifica
// (il file riletto deve essere identico e un JSON valido), permesso scaduto, quando tocca al prossimo backup e al
// promemoria «Esporta un backup» (ogni 7 giorni). Lo stato del backup (intervallo, ultimo backup, promemoria) si
// normalizza qui. Livello stato, funzioni pure: la cartella arriva come adattatore { permesso, elenca, scrivi, leggi,
// elimina } (quella vera da stato/archivio.js, un doppione in memoria nei test). Espone DnD.backup.
(function (DnD) {
  'use strict';

  const MAX_COPIE = 10;
  const INTERVALLO = 10;              // minuti tra due backup automatici, se ci sono modifiche
  const PROMEMORIA_GIORNI = 7;
  const GIORNO = 24 * 60 * 60 * 1000;
  const DATA = /-(\d{4}-\d{2}-\d{2}-\d{6})\.json$/;

  const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dati';
  const due = (n) => String(n).padStart(2, '0');
  const prefisso = (app, profilo) => slug(app) + '-' + slug(profilo) + '-';
  /** Nome del file: «session-forge-<profilo>-AAAA-MM-GG-HHMMSS.json» (ora locale). */
  function nomeFile(app, profilo, ora) {
    const d = new Date(ora);
    return prefisso(app, profilo) + d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate()) + '-' + due(d.getHours()) + due(d.getMinutes()) + due(d.getSeconds()) + '.json';
  }
  /** File da eliminare per tenere le ultime `max` copie di quel profilo (gli altri file della cartella non si toccano). */
  function daRuotare(nomi, pref, max) {
    const miei = nomi.filter((n) => n.startsWith(pref) && DATA.test(n.slice(pref.length - 1))).sort();
    return miei.slice(0, Math.max(0, miei.length - (max || MAX_COPIE)));
  }

  function normalizzaStato(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    return {
      intervallo: Number.isInteger(r.intervallo) && r.intervallo >= 1 && r.intervallo <= 240 ? r.intervallo : INTERVALLO,
      promemoria: r.promemoria !== false,
      ultimo: num(r.ultimo),                          // ultimo backup riuscito (cartella o esportazione)
      ultimoTipo: r.ultimoTipo === 'cartella' ? 'cartella' : r.ultimoTipo === 'esportazione' ? 'esportazione' : null,
      ultimoFile: typeof r.ultimoFile === 'string' ? r.ultimoFile.slice(0, 200) : null,
      ultimoErrore: typeof r.ultimoErrore === 'string' ? r.ultimoErrore.slice(0, 300) : null,
      nomeCartella: typeof r.nomeCartella === 'string' ? r.nomeCartella.slice(0, 200) : null,
      rimandato: num(r.rimandato),                    // promemoria rimandato («Più tardi»)
    };
  }

  /** Tocca al backup automatico? Ogni `intervallo` minuti, solo se ci sono modifiche non ancora copiate. */
  function dovuto(stato, ora, modificato) {
    const s = normalizzaStato(stato);
    if (!modificato) return false;
    return !s.ultimo || s.ultimoTipo !== 'cartella' || ora - s.ultimo >= s.intervallo * 60000;
  }
  /** Tocca al promemoria «Esporta un backup»? Ogni 7 giorni dall'ultimo backup (o dal rinvio), se attivo. */
  function promemoria(stato, ora) {
    const s = normalizzaStato(stato);
    if (!s.promemoria) return false;
    const da = Math.max(s.ultimo || 0, s.rimandato || 0);
    return !da || ora - da >= PROMEMORIA_GIORNI * GIORNO;
  }

  // Messaggio chiaro per gli errori della cartella.
  function messaggio(e) {
    const n = e && e.name;
    if (n === 'QuotaExceededError' || /quota|spazio/i.test(String(e && e.message))) return 'spazio esaurito sul disco della cartella di backup.';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'permesso negato: riautorizza la cartella di backup.';
    if (n === 'NotFoundError') return 'la cartella di backup non esiste più: scegline un\'altra.';
    return (e && e.message) || 'errore sconosciuto';
  }

  /**
   * Scrive una copia nella cartella, la rilegge per verificarla e ruota le copie del profilo.
   * @param {object} cartella adattatore { permesso, elenca, scrivi, leggi, elimina }
   * @param {string} testo archivio esportato (JSON)
   * @param {{app: string, profilo: string, ora: number, max?: number}} o
   * @returns {Promise<{ok: boolean, nome?: string, eliminati?: string[], permesso?: boolean, errore?: string}>}
   */
  async function esegui(cartella, testo, o) {
    let perm;
    try { perm = await cartella.permesso(); } catch (e) { perm = 'denied'; }
    if (perm !== 'granted') return { ok: false, permesso: true, errore: 'Il permesso di scrivere nella cartella di backup è scaduto: premi «Riautorizza».' };
    const nome = nomeFile(o.app, o.profilo, o.ora);
    try {
      await cartella.scrivi(nome, testo);
      const letto = await cartella.leggi(nome);
      if (letto !== testo) throw new Error('il file scritto non corrisponde ai dati (verifica non riuscita)');
      JSON.parse(letto);
    } catch (e) {
      return { ok: false, nome, errore: 'Backup non salvato: ' + messaggio(e) };
    }
    const eliminati = [];
    try {
      for (const n of daRuotare(await cartella.elenca(), prefisso(o.app, o.profilo), o.max || MAX_COPIE)) {
        await cartella.elimina(n);
        eliminati.push(n);
      }
    } catch (e) {
      return { ok: true, nome, eliminati, avviso: 'Backup salvato, ma le copie vecchie non si sono potute eliminare: ' + messaggio(e) };
    }
    return { ok: true, nome, eliminati };
  }

  /** Cartella in memoria con la stessa interfaccia (test). permesso: 'granted' | 'prompt' | 'denied'. */
  function cartellaMemoria(opts) {
    const o = Object.assign({ permesso: 'granted', guasto: null }, opts);
    const file = new Map();
    return {
      nome: 'Prova', file, o,
      permesso: async () => o.permesso,
      chiediPermesso: async () => { o.permesso = o.concedi === false ? 'denied' : 'granted'; return o.permesso; },
      elenca: async () => [...file.keys()],
      scrivi: async (n, t) => { if (o.guasto) o.guasto('scrivi', n); file.set(n, o.corrompi ? t.slice(0, -1) : t); },
      leggi: async (n) => { if (!file.has(n)) throw Object.assign(new Error('file mancante'), { name: 'NotFoundError' }); return file.get(n); },
      elimina: async (n) => { file.delete(n); },
    };
  }

  DnD.backup = { MAX_COPIE, INTERVALLO, PROMEMORIA_GIORNI, slug, prefisso, nomeFile, daRuotare, normalizzaStato, dovuto, promemoria, messaggio, esegui, cartellaMemoria };
})(globalThis.DnD = globalThis.DnD || {});
