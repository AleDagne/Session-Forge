// Trasporto astratto del gioco online: un canale di testo con
//   invia(testo), suMessaggio(fn), suStato(fn), connesso(), chiudi(), inCoda() (byte in attesa), svuotato() (promessa)
// e due implementazioni: il DataChannel di WebRTC e una coppia in memoria per i test. Il resto dell'app non conosce
// WebRTC. I testi lunghi viaggiano in frammenti (frammenta / ricompositore) con un limite alla dimensione ricomposta.
(function (DnD) {
  'use strict';

  const FRAMMENTO = 16 * 1024;
  const SOGLIA_CODA = 256 * 1024; // oltre questa coda chi manda aspetta (controllo del flusso)
  // Frammento: «F|id|i|n|» + parte; i messaggi interi iniziano con «{».
  let prossimoId = 1;
  function frammenta(testo, dim) {
    const size = dim || FRAMMENTO;
    if (testo.length <= size) return [testo];
    const id = (prossimoId++).toString(36);
    const n = Math.ceil(testo.length / size);
    const out = [];
    for (let i = 0; i < n; i++) out.push('F|' + id + '|' + i + '|' + n + '|' + testo.slice(i * size, (i + 1) * size));
    return out;
  }
  // Ricompone i frammenti: aggiungi(pezzo) -> testo intero | null; lancia un errore se il messaggio supera max.
  function ricompositore(max) {
    const aperti = new Map();
    return {
      aggiungi(pezzo) {
        if (typeof pezzo !== 'string') throw new Error('frammento non testuale');
        if (!pezzo.startsWith('F|')) return pezzo;
        const m = /^F\|([0-9a-z]{1,12})\|(\d{1,6})\|(\d{1,6})\|/.exec(pezzo);
        if (!m) throw new Error('frammento malformato');
        const [testa, id] = m;
        const i = Number(m[2]);
        const n = Number(m[3]);
        if (i >= n || n * FRAMMENTO > max + FRAMMENTO) throw new Error('messaggio troppo grande');
        let a = aperti.get(id);
        if (!a) {
          if (aperti.size >= 8) aperti.delete(aperti.keys().next().value);
          a = { n, parti: new Array(n), ricevuti: 0, lunghezza: 0 };
          aperti.set(id, a);
        }
        if (a.n !== n) throw new Error('frammento incoerente');
        if (a.parti[i] === undefined) {
          a.parti[i] = pezzo.slice(testa.length);
          a.ricevuti++;
          a.lunghezza += a.parti[i].length;
          if (a.lunghezza > max) { aperti.delete(id); throw new Error('messaggio troppo grande'); }
        }
        if (a.ricevuti < n) return null;
        aperti.delete(id);
        return a.parti.join('');
      },
    };
  }

  // Base comune: gestori dei messaggi e dello stato, frammentazione in uscita e ricomposizione in entrata.
  // opts: { maxRicevuto } (dimensione massima di un messaggio ricomposto).
  function base(opts, invia, extra) {
    const suMsg = new Set();
    const suSt = new Set();
    const ric = ricompositore((opts && opts.maxRicevuto) || 4 * 1024 * 1024);
    let stato = 'connessione';
    const t = Object.assign({
      invia(testo) { if (stato !== 'aperto') return false; for (const f of frammenta(testo)) invia(f); return true; },
      suMessaggio(fn) { suMsg.add(fn); return () => suMsg.delete(fn); },
      suStato(fn) { suSt.add(fn); return () => suSt.delete(fn); },
      connesso: () => stato === 'aperto',
      stato: () => stato,
      inCoda: () => 0,
      svuotato: () => Promise.resolve(),
    }, extra);
    t._ricevi = (pezzo) => {
      let testo;
      try { testo = ric.aggiungi(pezzo); } catch (e) { for (const fn of suMsg) fn(null, e.message); return; }
      if (testo !== null) for (const fn of suMsg) fn(testo, null);
    };
    t._stato = (s) => { if (stato === s || stato === 'chiuso') return; stato = s; for (const fn of suSt) fn(s); };
    return t;
  }

  // Coppia in memoria: [a, b], ciò che manda a arriva a b e viceversa (in modo asincrono, in ordine).
  // opts: { perdi(testo, daA) -> true per scartare un messaggio (simula una perdita), maxRicevuto }.
  function coppiaMemoria(opts) {
    const o = opts || {};
    const lati = [];
    const consegna = (verso, testo, daA) => {
      if (o.perdi && o.perdi(testo, daA)) return;
      queueMicrotask(() => { if (verso.connesso()) verso._ricevi(testo); });
    };
    const chiudi = () => { for (const l of lati) l._stato('chiuso'); };
    lati.push(base(o, (f) => consegna(lati[1], f, true), { chiudi }));
    lati.push(base(o, (f) => consegna(lati[0], f, false), { chiudi }));
    for (const l of lati) l._stato('aperto');
    return lati;
  }

  // DataChannel di WebRTC già creato (segnalazione.js). pc: la RTCPeerConnection, per chiuderla con il canale.
  function daCanale(pc, canale, opts) {
    const t = base(opts, (f) => { try { canale.send(f); } catch (e) { t._stato('chiuso'); } }, {
      chiudi: () => { try { canale.close(); } catch (e) { /* già chiuso */ } try { pc.close(); } catch (e) { /* già chiusa */ } t._stato('chiuso'); },
      inCoda: () => canale.bufferedAmount || 0,
      svuotato: () => (canale.bufferedAmount <= SOGLIA_CODA / 4 ? Promise.resolve() : new Promise((resolve) => {
        const fatto = () => { canale.removeEventListener('bufferedamountlow', fatto); resolve(); };
        canale.addEventListener('bufferedamountlow', fatto);
        setTimeout(fatto, 5000); // mai bloccati per sempre
      })),
    });
    canale.bufferedAmountLowThreshold = SOGLIA_CODA / 4;
    canale.addEventListener('message', (e) => t._ricevi(typeof e.data === 'string' ? e.data : null));
    canale.addEventListener('open', () => t._stato('aperto'));
    canale.addEventListener('close', () => t._stato('chiuso'));
    canale.addEventListener('error', () => t._stato('chiuso'));
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') t._stato('chiuso');
    });
    if (canale.readyState === 'open') t._stato('aperto');
    return t;
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.trasporto = { FRAMMENTO, SOGLIA_CODA, frammenta, ricompositore, coppiaMemoria, daCanale };
})(globalThis.DnD = globalThis.DnD || {});
