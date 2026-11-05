// Instradamento su hash (#/home, #/master/<sezione>, #/gioca, #/online/ospita, #/online/unisciti): l'app gira anche
// da file locale, quindi niente percorsi veri. Funzioni pure: lettura e scrittura delle rotte, rotta d'avvio e
// permessi delle modalità (Master, Giocatore, Spettatore). Livello regole: nessun DOM, disco o rete (app.js applica
// le rotte). Espone DnD.rotte.
(function (DnD) {
  'use strict';

  const MODI = ['home', 'master', 'gioca', 'ospita', 'unisciti'];
  // Modalità d'uso: il Master vede tutto; Giocatore e Spettatore solo la schermata di gioco (e il portale per uscire).
  const MODALITA = ['master', 'giocatore', 'spettatore'];
  const PERMESSI = {
    master: ['home', 'master', 'gioca', 'ospita', 'unisciti'],
    giocatore: ['home', 'gioca'],
    spettatore: ['home', 'gioca'],
  };

  /**
   * Hash -> rotta. Hash vuoto: { modo: null } (decide l'avvio); rotta sconosciuta: { modo: 'home', sconosciuta: true }.
   * @param {string} hash es. '#/master/nemici'  @param {string[]} sezioni sezioni valide del Master
   * @returns {{modo: string|null, sezione?: string|null, sconosciuta?: boolean}}
   */
  function analizza(hash, sezioni) {
    const h = String(hash || '').replace(/^#/, '');
    if (h === '' || h === '/') return { modo: null };
    const parti = h.replace(/^\//, '').split('/').map((p) => { try { return decodeURIComponent(p); } catch (e) { return ''; } });
    const sconosciuta = { modo: 'home', sconosciuta: true };
    if (parti.length === 1 && (parti[0] === 'home' || parti[0] === 'gioca')) return { modo: parti[0] };
    if (parti[0] === 'master' && parti.length <= 2) {
      if (parti.length === 1 || parti[1] === '') return { modo: 'master', sezione: null };
      return (sezioni || []).includes(parti[1]) ? { modo: 'master', sezione: parti[1] } : sconosciuta;
    }
    if (parti[0] === 'online' && parti.length === 2 && (parti[1] === 'ospita' || parti[1] === 'unisciti')) return { modo: parti[1] };
    return sconosciuta;
  }

  /** Rotta -> hash. @param {{modo: string, sezione?: string|null}} r @returns {string} */
  function formatta(r) {
    const modo = r && MODI.includes(r.modo) ? r.modo : 'home';
    if (modo === 'master') return r.sezione ? '#/master/' + encodeURIComponent(r.sezione) : '#/master';
    if (modo === 'ospita' || modo === 'unisciti') return '#/online/' + modo;
    return '#/' + modo;
  }

  /**
   * Rotta da aprire all'avvio o al ricaricamento.
   * @param {{hash: string, sezioni: string[], salta: boolean, ultimaSezione: string|null}} o salta = «Salta il portale»
   * @returns {{modo: string, sezione?: string|null, sconosciuta?: boolean, interrotta?: boolean}} interrotta: la schermata
   *   di gioco non sopravvive al ricaricamento (la connessione è caduta): si torna al portale, che propone «Riconnetti».
   */
  function iniziale(o) {
    const sezioni = o.sezioni || [];
    const ultima = sezioni.includes(o.ultimaSezione) ? o.ultimaSezione : sezioni[0] || null;
    const r = analizza(o.hash, sezioni);
    if (r.modo === null) return o.salta ? { modo: 'master', sezione: ultima } : { modo: 'home' };
    if (r.modo === 'gioca') return { modo: 'home', interrotta: true };
    if (r.modo === 'master' && !r.sezione) return { modo: 'master', sezione: ultima };
    return r;
  }

  /** La modalità può aprire la rotta? (Giocatore e Spettatore: mai le sezioni del Master.) */
  function consentita(r, modalita) {
    const p = PERMESSI[MODALITA.includes(modalita) ? modalita : 'master'];
    return Boolean(r && p.includes(r.modo));
  }

  DnD.rotte = { MODI, MODALITA, PERMESSI, analizza, formatta, iniziale, consentita };
})(globalThis.DnD = globalThis.DnD || {});
