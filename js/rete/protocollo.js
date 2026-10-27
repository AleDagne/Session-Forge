// Protocollo del gioco online: messaggi JSON { versione, tipo, id, seq, dati } con validazione di ogni messaggio
// ricevuto (versione, tipo e direzione, schema dei dati, lunghezza dei testi, dimensione) e limite di frequenza.
// Versione 2 (tappa 2): intenzioni del giocatore ed esiti del master, richieste di tiro, ping, rivelazioni, permessi,
// offerte di oggetti, gettone di rientro. I client della versione 1 vengono rifiutati con un messaggio chiaro.
// Funzioni pure: il trasporto (trasporto.js) muove solo testo, la sessione (sessione.js) decide cosa farne.
(function (DnD) {
  'use strict';

  const VERSIONE = 2;
  const LIMITI = {
    daGiocatore: 16 * 1024,        // un messaggio di un giocatore (chat, dado, battito…)
    daMaster: 4 * 1024 * 1024,     // istantanea compresa
    testo: 500,                    // messaggio di chat
    nome: 30,
    pezzo: 16 * 1024,              // pezzo di un'immagine
    immagine: 8 * 1024 * 1024,     // immagine intera (data URL)
    richiesteImmagini: 200,
    rivelazione: 5000,             // testo di una rivelazione
    immagineRivelata: 3 * 1024 * 1024,
  };
  // Chi può mandare ogni tipo: 'g' giocatore, 'm' master.
  const TIPI = {
    ciao: 'g', chiediIstantanea: 'g', chiediImmagini: 'g', intenzione: 'g',
    benvenuto: 'm', rifiutato: 'm', espulso: 'm', istantanea: 'm', evento: 'm', presenza: 'm', immagine: 'm', immagineNo: 'm', fine: 'm',
    esito: 'm', richiestaTiro: 'm', ping: 'm', rivela: 'm', permessi: 'm', offerta: 'm', richiamo: 'm',
    eco: 'gm', ecoOk: 'gm', battito: 'gm', battitoOk: 'gm', chat: 'gm', dado: 'gm', errore: 'gm', incompatibile: 'gm', scrive: 'gm',
  };
  const GETTONE = /^[A-Za-z0-9_-]{16,64}$/;
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const ID = /^[\w-]{1,64}$/;
  const COLORE = /^#[0-9a-f]{6}$/i;

  // Testo ricevuto: niente caratteri di controllo, direzionali o invisibili; righe vuote compresse; lunghezza limitata.
  // Chi lo mostra usa sempre textContent (mai HTML).
  function pulisciTesto(v, max) {
    if (typeof v !== 'string') return '';
    return v.replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  }
  const nome = (v) => pulisciTesto(v, LIMITI.nome).replace(/\n/g, ' ');

  function errore(testo) { const e = new Error(testo); e.protocollo = true; return e; }
  const richiedi = (cond, testo) => { if (!cond) throw errore(testo); };
  const intero = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  // Schemi dei dati per tipo: restituiscono i dati ripuliti o lanciano un errore in italiano.
  const SCHEMI = {
    ciao: (d) => {
      const n = nome(d.nome);
      richiedi(n, 'nome mancante');
      return { nome: n, colore: COLORE.test(d.colore || '') ? d.colore.toLowerCase() : '#4f8cc9', gettone: GETTONE.test(d.gettone || '') ? d.gettone : '' };
    },
    // Intenzione: la forma qui, i dati con lo schema del tipo (intenzioni.pulisci, solo i campi previsti).
    intenzione: (d) => {
      richiedi(typeof d.id === 'string' && ID.test(d.id) && typeof d.tipo === 'string' && d.tipo.length <= 30 && obj(d.dati), 'intenzione malformata');
      return { id: d.id, tipo: d.tipo, dati: d.dati };
    },
    esito: (d) => ({
      id: typeof d.id === 'string' && ID.test(d.id) ? d.id : '', stato: ['eseguita', 'rifiutata', 'attesa', 'annullata'].includes(d.stato) ? d.stato : 'rifiutata',
      testo: pulisciTesto(d.testo, 400), avviso: pulisciTesto(d.avviso, 200),
    }),
    richiestaTiro: (d) => {
      richiedi(typeof d.id === 'string' && ID.test(d.id), 'richiesta non valida');
      return { id: d.id, caratteristica: typeof d.caratteristica === 'string' ? d.caratteristica.slice(0, 3) : '', cd: Number.isInteger(d.cd) ? d.cd : null, modo: ['vantaggio', 'svantaggio'].includes(d.modo) ? d.modo : 'normale', testo: pulisciTesto(d.testo, 200) };
    },
    ping: (d) => {
      richiedi(intero(d.x, 0, 999) && intero(d.y, 0, 999), 'ping non valido');
      return { x: d.x, y: d.y, nome: nome(d.nome), colore: COLORE.test(d.colore || '') ? d.colore : '#c9a24f' };
    },
    rivela: (d) => {
      const img = typeof d.immagine === 'string' && d.immagine.length <= LIMITI.immagineRivelata && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(d.immagine) ? d.immagine : null;
      return { titolo: pulisciTesto(d.titolo, 100).replace(/\n/g, ' '), testo: pulisciTesto(d.testo, LIMITI.rivelazione), immagine: img };
    },
    permessi: (d) => ({ permessi: obj(d.permessi) ? d.permessi : {}, pausa: Boolean(d.pausa), convalidati: d.convalidati !== false }),
    offerta: (d) => {
      richiedi(typeof d.id === 'string' && ID.test(d.id), 'offerta non valida');
      return { id: d.id, da: nome(d.da), oggetto: pulisciTesto(d.oggetto, 60), qty: intero(d.qty, 1, 100000) ? d.qty : 1 };
    },
    richiamo: (d) => ({ testo: pulisciTesto(d.testo, 200) }),
    scrive: (d) => ({ nome: nome(d.nome) }),
    chiediIstantanea: () => ({}),
    chiediImmagini: (d) => {
      richiedi(Array.isArray(d.ids) && d.ids.length <= LIMITI.richiesteImmagini && d.ids.every((x) => typeof x === 'string' && ID.test(x)), 'elenco di immagini non valido');
      return { ids: [...new Set(d.ids)] };
    },
    eco: (d) => ({ t: Number.isFinite(d.t) ? d.t : 0 }),
    ecoOk: (d) => ({ t: Number.isFinite(d.t) ? d.t : 0 }),
    battito: (d) => ({ t: Number.isFinite(d.t) ? d.t : 0 }),
    battitoOk: (d) => ({ t: Number.isFinite(d.t) ? d.t : 0 }),
    chat: (d) => {
      const testo = pulisciTesto(d.testo, LIMITI.testo);
      richiedi(testo, 'messaggio vuoto');
      return { testo, a: typeof d.a === 'string' && ID.test(d.a) ? d.a : null, da: typeof d.da === 'string' ? nome(d.da) : '', privato: Boolean(d.privato), colore: COLORE.test(d.colore || '') ? d.colore : null };
    },
    dado: (d) => {
      richiedi(obj(d.tiro), 'tiro mancante');
      const tiro = DnD.dadi.normalizeTiro(d.tiro);
      richiedi(tiro.gruppi.length && tiro.gruppi.length <= 20 && tiro.gruppi.every((g) => g.values.length <= DnD.dadi.MAX_COUNT), 'tiro non valido');
      return { tiro, da: typeof d.da === 'string' ? nome(d.da) : '', colore: COLORE.test(d.colore || '') ? d.colore : null, privato: Boolean(d.privato), verificato: d.verificato !== false };
    },
    errore: (d) => ({ testo: pulisciTesto(d.testo, 300) }),
    incompatibile: (d) => ({ versione: Number.isInteger(d.versione) ? d.versione : 0 }),
    benvenuto: (d) => {
      richiedi(typeof d.id === 'string' && ID.test(d.id), 'id del giocatore non valido');
      return { id: d.id, nome: nome(d.nome), colore: COLORE.test(d.colore || '') ? d.colore : '#4f8cc9', master: nome(d.master), rientro: Boolean(d.rientro), gettone: GETTONE.test(d.gettone || '') ? d.gettone : '' };
    },
    rifiutato: (d) => ({ motivo: pulisciTesto(d.motivo, 200) }),
    espulso: (d) => ({ motivo: pulisciTesto(d.motivo, 200) }),
    fine: (d) => ({ motivo: pulisciTesto(d.motivo, 200) }),
    // Istantanea ed eventi: la forma si controlla qui, i contenuti si normalizzano in filtro.applica / vista.
    istantanea: (d) => {
      richiedi(intero(d.n, 0, 1e12) && obj(d.vista), 'istantanea non valida');
      return { n: d.n, vista: d.vista };
    },
    evento: (d) => {
      richiedi(intero(d.n, 0, 1e12) && Array.isArray(d.cambi) && d.cambi.length <= 5000 && d.cambi.every((c) => obj(c) && typeof c.op === 'string'), 'evento non valido');
      return { n: d.n, cambi: d.cambi };
    },
    presenza: (d) => {
      richiedi(Array.isArray(d.giocatori) && d.giocatori.length <= 16, 'presenza non valida');
      return { giocatori: d.giocatori.filter(obj).map((g) => ({ id: typeof g.id === 'string' && ID.test(g.id) ? g.id : '', nome: nome(g.nome), colore: COLORE.test(g.colore || '') ? g.colore : '#4f8cc9', stato: ['attivo', 'disconnesso', 'master'].includes(g.stato) ? g.stato : 'attivo' })) };
    },
    immagine: (d) => {
      richiedi(typeof d.id === 'string' && ID.test(d.id) && intero(d.n, 1, Math.ceil(LIMITI.immagine / LIMITI.pezzo)) && intero(d.i, 0, d.n - 1), 'pezzo di immagine non valido');
      richiedi(typeof d.parte === 'string' && d.parte.length <= LIMITI.pezzo, 'pezzo di immagine troppo grande');
      return { id: d.id, i: d.i, n: d.n, parte: d.parte };
    },
    immagineNo: (d) => ({ id: typeof d.id === 'string' && ID.test(d.id) ? d.id : '', motivo: pulisciTesto(d.motivo, 200) }),
  };

  let contatore = 0;
  function crea(tipo, dati, seq) {
    return { versione: VERSIONE, tipo, id: 'm' + Date.now().toString(36) + (contatore++).toString(36), seq: seq || 0, dati: dati || {} };
  }
  const codifica = (msg) => JSON.stringify(msg);

  // Testo ricevuto -> { ok: true, msg } | { ok: false, errore, incompatibile?, versione? }.
  // da: 'g' (lo manda un giocatore, lo legge il master) o 'm'. max: lunghezza massima del testo.
  function decodifica(testo, da, max) {
    const limite = max || (da === 'g' ? LIMITI.daGiocatore : LIMITI.daMaster);
    if (typeof testo !== 'string') return { ok: false, errore: 'messaggio non testuale' };
    if (testo.length > limite) return { ok: false, errore: 'messaggio troppo grande (' + Math.ceil(testo.length / 1024) + ' KB, massimo ' + Math.floor(limite / 1024) + ' KB)', grande: true };
    let m;
    try { m = JSON.parse(testo); } catch (e) { return { ok: false, errore: 'messaggio non leggibile' }; }
    if (!obj(m)) return { ok: false, errore: 'messaggio malformato' };
    // «incompatibile» si legge sempre, anche da versioni diverse.
    if (m.tipo !== 'incompatibile' && m.versione !== VERSIONE) {
      return { ok: false, incompatibile: true, versione: Number.isInteger(m.versione) ? m.versione : 0, errore: 'versione del protocollo incompatibile (questa app: ' + VERSIONE + ', l\'altra: ' + (Number.isInteger(m.versione) ? m.versione : '?') + ')' };
    }
    const dir = TIPI[m.tipo];
    if (!dir) return { ok: false, errore: 'tipo di messaggio sconosciuto' };
    if (!dir.includes(da)) return { ok: false, errore: 'messaggio «' + m.tipo + '» non permesso' };
    if (typeof m.id !== 'string' || m.id.length > 64 || !intero(m.seq, 0, 1e12) || !obj(m.dati)) return { ok: false, errore: 'intestazione del messaggio non valida' };
    try {
      return { ok: true, msg: { versione: m.versione, tipo: m.tipo, id: m.id, seq: m.seq, dati: SCHEMI[m.tipo](m.dati) } };
    } catch (e) {
      if (!e.protocollo) throw e;
      return { ok: false, errore: 'dati non validi: ' + e.message };
    }
  }

  // Limite di frequenza (secchio di gettoni): capacita messaggi di colpo, poi perSecondo.
  function limitatore(capacita, perSecondo) {
    let gettoni = capacita;
    let ultimo = null;
    return {
      consenti(ora) {
        if (ultimo !== null) gettoni = Math.min(capacita, gettoni + ((ora - ultimo) / 1000) * perSecondo);
        ultimo = ora;
        if (gettoni < 1) return false;
        gettoni -= 1;
        return true;
      },
    };
  }

  // Stato della linea dal tempo dell'ultimo messaggio e dalla latenza: 'verde' | 'giallo' | 'rosso'.
  function statoLinea(ultimo, latenza, ora) {
    const silenzio = ora - ultimo;
    if (silenzio > 15000) return 'rosso';
    if (silenzio > 7000 || latenza > 400) return 'giallo';
    return 'verde';
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.protocollo = { VERSIONE, LIMITI, TIPI, pulisciTesto, crea, codifica, decodifica, limitatore, statoLinea };
})(globalThis.DnD = globalThis.DnD || {});
