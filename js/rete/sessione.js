// Sessione online sopra un trasporto astratto (trasporto.js): il lato master (approvazione degli ingressi,
// espulsione, istantanee filtrate ed eventi incrementali, chat, dadi condivisi, immagini, battito) e il lato
// giocatore (sola vista). Nessun DOM e nessun WebRTC: la UI (ui-online.js) passa le funzioni di contorno e i test
// usano la coppia in memoria. ora() è iniettabile per il battito e i limiti di frequenza.
(function (DnD) {
  'use strict';

  const P = () => DnD.rete.protocollo;
  const F = () => DnD.rete.filtro;
  const T = () => DnD.rete.trasporto;
  const SILENZIO_MAX = 20000;   // oltre: il collegamento è perso
  const CHIUSURA_MS = 400;      // attesa prima di chiudere (il messaggio di congedo deve arrivare)
  const MAX_GIOCATORI = 4;

  // Invio con numero di sequenza per collegamento.
  function canale(trasporto) {
    let seq = 0;
    return (tipo, dati) => trasporto.invia(P().codifica(P().crea(tipo, dati, ++seq)));
  }
  const chiudiDopo = (t) => setTimeout(() => t.chiudi(), CHIUSURA_MS);
  const stessoNome = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // ---------- Master ----------
  // opts: { nome, ora(), stato() -> stato dell'app, suRichiesta(richiesta), suCambio(), suChat(msg), suDado(msg),
  //   suErrore(testo), immagine(id) -> Promise<data URL | null>, pfNemici, maxGiocatori }
  function master(opts) {
    const o = Object.assign({ nome: 'Master', ora: () => Date.now(), suRichiesta() {}, suCambio() {}, suChat() {}, suDado() {}, suErrore() {}, immagine: async () => null, pfNemici: false, maxGiocatori: MAX_GIOCATORI }, opts);
    const giocatori = new Map();
    const icone = new Map(); // immagini delle icone (incorporate nello stato), servite su richiesta
    let finita = false;

    const attivi = () => [...giocatori.values()].filter((g) => g.stato === 'attivo');
    function presenza() {
      const lista = [{ id: 'master', nome: o.nome, colore: '#c9a24f', stato: 'master' }].concat([...giocatori.values()].filter((g) => g.stato !== 'attesa')
        .map((g) => ({ id: g.id, nome: g.nome, colore: g.colore, stato: g.stato })));
      for (const g of attivi()) g.invia('presenza', { giocatori: lista });
    }
    function vistaDi(g) {
      const r = F().istantanea(o.stato(), { giocatoreId: g.id, personaggioId: g.personaggioId, pfNemici: o.pfNemici, master: o.nome });
      for (const [id, data] of r.immagini) icone.set(id, data);
      return r.vista;
    }
    function inviaIstantanea(g) {
      g.vista = vistaDi(g);
      g.n++;
      g.invia('istantanea', { n: g.n, vista: g.vista });
    }
    function disconnesso(g) {
      if (g.stato === 'disconnesso' || !giocatori.has(g.id)) return;
      if (g.stato === 'attesa') { giocatori.delete(g.id); if (g.richiesta) g.richiesta.annullata = true; o.suCambio(); return; }
      g.stato = 'disconnesso';
      g.trasporto.chiudi();
      presenza();
      o.suCambio({ evento: 'disconnesso', giocatore: g });
    }

    // Immagini: solo quelle della vista del giocatore, a pezzi con il controllo del flusso.
    async function servi(g, ids) {
      const lecite = new Set((g.vista && g.vista.immagini) || []);
      for (const id of ids) {
        if (!lecite.has(id) || g.stato !== 'attivo') { g.invia('immagineNo', { id, motivo: 'immagine non disponibile' }); continue; }
        let data = icone.get(id) || null;
        if (!data) { try { data = await o.immagine(id); } catch (e) { data = null; } }
        let pezzi;
        try {
          if (!data) throw new Error('immagine non trovata nell\'archivio del master');
          pezzi = DnD.rete.immagini.pezzi(id, data);
        } catch (e) { g.invia('immagineNo', { id, motivo: e.message }); continue; }
        for (const p of pezzi) {
          if (!g.trasporto.connesso()) return;
          if (g.trasporto.inCoda() > T().SOGLIA_CODA) await g.trasporto.svuotato();
          g.invia('immagine', p);
        }
      }
    }

    function ricevi(g, testo, errFrammento) {
      const ora = o.ora();
      if (errFrammento) { g.errori++; g.invia('errore', { testo: 'Messaggio rifiutato: ' + errFrammento + '.' }); return; }
      if (!g.limite.consenti(ora)) {
        if (ora - g.avvisato > 5000) { g.avvisato = ora; g.invia('errore', { testo: 'Troppi messaggi: alcuni sono stati ignorati.' }); }
        return;
      }
      const r = P().decodifica(testo, 'g');
      if (!r.ok) {
        g.errori++;
        if (r.incompatibile) { g.invia('incompatibile', { versione: P().VERSIONE }); chiudiDopo(g.trasporto); o.suErrore('Un giocatore usa una versione incompatibile dell\'app (' + r.versione + ').'); return; }
        g.invia('errore', { testo: 'Messaggio rifiutato: ' + r.errore + '.' });
        return;
      }
      g.ultimoMsg = ora;
      const { tipo, dati } = r.msg;
      if (tipo === 'battito') { g.invia('battitoOk', { t: dati.t }); return; }
      if (tipo === 'battitoOk') { g.latenza = Math.max(0, ora - dati.t); return; }
      if (tipo === 'eco') { g.invia('ecoOk', { t: dati.t }); return; }
      if (tipo === 'ecoOk') { g.eco = Math.max(0, ora - dati.t); o.suCambio({ evento: 'eco', giocatore: g }); return; }
      if (tipo === 'ciao') {
        if (g.stato !== 'attesa' || g.richiesta) return;
        g.nome = dati.nome;
        g.colore = dati.colore;
        if (attivi().length >= o.maxGiocatori) { rifiuta(g, 'La sessione è piena (massimo ' + o.maxGiocatori + ' giocatori).'); return; }
        const prima = [...giocatori.values()].find((x) => x !== g && x.stato === 'disconnesso' && stessoNome(x.nome, g.nome)) || null;
        g.richiesta = {
          id: g.id, nome: g.nome, colore: g.colore, rientro: prima ? { id: prima.id, personaggioId: prima.personaggioId } : null,
          accetta: (scelte) => accetta(g, scelte || {}, prima),
          rifiuta: (motivo) => rifiuta(g, motivo),
        };
        o.suRichiesta(g.richiesta);
        return;
      }
      if (g.stato !== 'attivo') return;
      if (tipo === 'chiediIstantanea') inviaIstantanea(g);
      else if (tipo === 'chiediImmagini') servi(g, dati.ids);
      else if (tipo === 'chat') {
        if (!g.limiteChat.consenti(ora)) { g.invia('errore', { testo: 'Stai scrivendo troppo in fretta.' }); return; }
        const m = { da: g.nome, colore: g.colore, testo: dati.testo, privato: dati.a === 'master', daId: g.id };
        o.suChat(m);
        if (!m.privato) for (const x of attivi()) if (x !== g) x.invia('chat', { da: m.da, colore: m.colore, testo: m.testo });
      } else if (tipo === 'dado') {
        const m = { da: g.nome, colore: g.colore, tiro: dati.tiro, daId: g.id };
        o.suDado(m);
        for (const x of attivi()) if (x !== g) x.invia('dado', { da: m.da, colore: m.colore, tiro: m.tiro });
      }
    }

    function accetta(g, scelte, prima) {
      if (g.stato !== 'attesa' || !giocatori.has(g.id) || finita) return false;
      g.richiesta = null;
      // Rientro: stesso id, colore e personaggio del giocatore caduto.
      const rientro = Boolean(prima && scelte.rientro !== false && giocatori.get(prima.id) === prima && prima.stato === 'disconnesso');
      if (rientro) {
        giocatori.delete(g.id);
        giocatori.delete(prima.id);
        g.id = prima.id;
        g.colore = prima.colore;
        giocatori.set(g.id, g);
      }
      g.personaggioId = scelte.personaggioId !== undefined ? scelte.personaggioId || null : rientro ? prima.personaggioId : null;
      g.stato = 'attivo';
      g.invia('benvenuto', { id: g.id, nome: g.nome, colore: g.colore, master: o.nome, rientro });
      inviaIstantanea(g);
      presenza();
      o.suCambio({ evento: 'entrato', giocatore: g });
      return true;
    }
    function rifiuta(g, motivo) {
      g.richiesta = null;
      g.invia('rifiutato', { motivo: motivo || 'Il master ha rifiutato l\'ingresso.' });
      giocatori.delete(g.id);
      chiudiDopo(g.trasporto);
      o.suCambio();
    }

    return {
      // Nuovo collegamento: il giocatore resta «in attesa» finché il master non approva il suo «ciao».
      collega(trasporto) {
        if (finita) { trasporto.chiudi(); return null; }
        const g = {
          id: DnD.dadi.uid(), nome: '', colore: '#4f8cc9', stato: 'attesa', personaggioId: null, trasporto, invia: canale(trasporto),
          vista: null, n: 0, ultimoMsg: o.ora(), latenza: null, eco: null, errori: 0, avvisato: -1e9, richiesta: null,
          limite: P().limitatore(40, 20), limiteChat: P().limitatore(5, 1),
        };
        giocatori.set(g.id, g);
        trasporto.suMessaggio((testo, err) => ricevi(g, testo, err));
        trasporto.suStato((s) => { if (s === 'chiuso') disconnesso(g); });
        return g.id;
      },
      // Dopo ogni modifica dello stato: eventi incrementali (o l'istantanea se la vista è cambiata del tutto).
      aggiorna() {
        for (const g of attivi()) {
          const nuova = vistaDi(g);
          const cambi = F().differenze(g.vista, nuova);
          if (!cambi) { g.vista = nuova; g.n++; g.invia('istantanea', { n: g.n, vista: nuova }); continue; }
          if (!cambi.length) continue;
          g.vista = nuova;
          g.n++;
          g.invia('evento', { n: g.n, cambi });
        }
      },
      istantanea: (id) => { const g = giocatori.get(id); if (g && g.stato === 'attivo') inviaIstantanea(g); },
      chat(testo, aId) {
        const t = P().pulisciTesto(testo, P().LIMITI.testo);
        if (!t) return null;
        const m = { da: o.nome, colore: '#c9a24f', testo: t, privato: Boolean(aId) };
        for (const g of attivi()) if (!aId || g.id === aId) g.invia('chat', Object.assign({}, m, { privato: m.privato }));
        return m;
      },
      dado(tiro) { for (const g of attivi()) g.invia('dado', { da: o.nome, colore: '#c9a24f', tiro }); },
      eco(id) { const g = giocatori.get(id); if (g && g.stato === 'attivo') g.invia('eco', { t: o.ora() }); },
      espelli(id, motivo) {
        const g = giocatori.get(id);
        if (!g) return;
        giocatori.delete(id);
        g.stato = 'espulso';
        g.invia('espulso', { motivo: motivo || 'Il master ti ha espulso dalla sessione.' });
        chiudiDopo(g.trasporto);
        presenza();
        o.suCambio();
      },
      // Battito: chiamato ogni pochi secondi; chi tace troppo a lungo è disconnesso.
      battito() {
        const ora = o.ora();
        for (const g of [...giocatori.values()]) {
          if (g.stato === 'disconnesso') continue;
          if (!g.trasporto.connesso() || ora - g.ultimoMsg > SILENZIO_MAX) disconnesso(g);
          else g.invia('battito', { t: ora });
        }
      },
      termina(motivo) {
        finita = true;
        for (const g of giocatori.values()) {
          if (g.stato === 'disconnesso') continue;
          g.invia('fine', { motivo: motivo || 'Il master ha terminato la sessione.' });
          chiudiDopo(g.trasporto);
        }
        giocatori.clear();
        o.suCambio();
      },
      giocatori: () => [...giocatori.values()].map((g) => ({ id: g.id, nome: g.nome, colore: g.colore, stato: g.stato, personaggioId: g.personaggioId, latenza: g.latenza, eco: g.eco, linea: P().statoLinea(g.ultimoMsg, g.latenza || 0, o.ora()), richiesta: g.richiesta })),
      assegna(id, personaggioId) { const g = giocatori.get(id); if (g) { g.personaggioId = personaggioId || null; if (g.stato === 'attivo') inviaIstantanea(g); } },
      impostaPfNemici(v) { o.pfNemici = Boolean(v); },
      finita: () => finita,
      // Per i test: la vista inviata a un giocatore.
      vistaInviata: (id) => (giocatori.get(id) ? giocatori.get(id).vista : null),
    };
  }

  // ---------- Giocatore ----------
  // opts: { nome, colore, trasporto, ora(), suCambio(), suChat(msg), suDado(msg), suFine(motivo), suErrore(testo),
  //   suAvanzamento({ ricevuti, totali }), archivio: { ha(id) -> Promise<bool>, metti(id, data) -> Promise } }
  function giocatore(opts) {
    const o = Object.assign({ ora: () => Date.now(), suCambio() {}, suChat() {}, suDado() {}, suFine() {}, suErrore() {}, suAvanzamento() {},
      archivio: { ha: async () => false, metti: async () => {} } }, opts);
    const invia = canale(o.trasporto);
    const ricevitore = DnD.rete.immagini.ricevitore();
    const s = { stato: 'attesa', id: '', nome: o.nome, colore: o.colore, master: '', vista: null, n: 0, presenza: [], ultimoMsg: o.ora(), latenza: null, eco: null, motivo: '', attesaIstantanea: false, inArrivo: new Set() };

    function finisci(stato, motivo) {
      if (['rifiutato', 'espulso', 'finito'].includes(s.stato)) return;
      s.stato = stato;
      s.motivo = motivo;
      chiudiDopo(o.trasporto);
      o.suFine(motivo, stato);
      o.suCambio();
    }
    async function richiediImmagini(ids) {
      const mancanti = [];
      for (const id of ids || []) {
        if (s.inArrivo.has(id)) continue;
        let ha = false;
        try { ha = await o.archivio.ha(id); } catch (e) { ha = false; }
        if (!ha) mancanti.push(id);
      }
      if (!mancanti.length) return;
      for (const id of mancanti) s.inArrivo.add(id);
      o.suAvanzamento({ ricevuti: 0, totali: mancanti.length, immagini: s.inArrivo.size });
      invia('chiediImmagini', { ids: mancanti.slice(0, P().LIMITI.richiesteImmagini) });
    }
    function chiediIstantanea() {
      if (s.attesaIstantanea) return;
      s.attesaIstantanea = true;
      invia('chiediIstantanea', {});
    }

    o.trasporto.suMessaggio((testo, err) => {
      if (err) { o.suErrore('Messaggio del master scartato: ' + err + '.'); return; }
      const r = P().decodifica(testo, 'm');
      if (!r.ok) {
        if (r.incompatibile) { invia('incompatibile', { versione: P().VERSIONE }); finisci('finito', 'Versione incompatibile: il master usa un\'altra versione dell\'app (' + r.versione + ', questa ' + P().VERSIONE + '). Aggiornate entrambi la pagina.'); return; }
        o.suErrore('Messaggio del master scartato: ' + r.errore + '.');
        return;
      }
      s.ultimoMsg = o.ora();
      const { tipo, dati } = r.msg;
      switch (tipo) {
        case 'benvenuto': Object.assign(s, { stato: 'attivo', id: dati.id, nome: dati.nome, colore: dati.colore, master: dati.master }); o.suCambio(); break;
        case 'rifiutato': finisci('rifiutato', dati.motivo); break;
        case 'espulso': finisci('espulso', dati.motivo); break;
        case 'fine': finisci('finito', 'La sessione è terminata: ' + (dati.motivo || 'il master ha chiuso.')); break;
        case 'incompatibile': finisci('finito', 'Versione incompatibile: il master usa la versione ' + dati.versione + ' del protocollo, questa app la ' + P().VERSIONE + '. Aggiornate entrambi la pagina.'); break;
        case 'istantanea':
          s.vista = dati.vista;
          s.n = dati.n;
          s.attesaIstantanea = false;
          o.suCambio();
          richiediImmagini(s.vista.immagini);
          break;
        case 'evento':
          if (s.attesaIstantanea || !s.vista) return;
          if (dati.n !== s.n + 1) { chiediIstantanea(); return; }
          try {
            s.vista = F().applica(s.vista, dati.cambi);
            s.n = dati.n;
          } catch (e) { chiediIstantanea(); return; }
          o.suCambio(dati.cambi);
          if (dati.cambi.some((c) => c.op === 'immagini')) richiediImmagini(s.vista.immagini);
          break;
        case 'presenza': s.presenza = dati.giocatori; o.suCambio(); break;
        case 'chat': o.suChat(dati); break;
        case 'dado': o.suDado(dati); break;
        case 'immagine': {
          let fatta;
          try { fatta = ricevitore.aggiungi(dati); } catch (e) { s.inArrivo.delete(dati.id); ricevitore.annulla(dati.id); o.suErrore('Immagine scartata: ' + e.message + '.'); break; }
          const av = ricevitore.avanzamento();
          o.suAvanzamento({ ricevuti: av.ricevuti, totali: av.totali, immagini: s.inArrivo.size });
          if (fatta) {
            Promise.resolve(o.archivio.metti(fatta.id, fatta.data)).catch(() => {}).then(() => {
              s.inArrivo.delete(fatta.id);
              o.suAvanzamento({ ricevuti: 1, totali: 1, immagini: s.inArrivo.size, pronta: fatta.id });
            });
          }
          break;
        }
        case 'immagineNo': s.inArrivo.delete(dati.id); o.suErrore('Immagine non ricevuta: ' + dati.motivo + '.'); o.suAvanzamento({ ricevuti: 1, totali: 1, immagini: s.inArrivo.size }); break;
        case 'battito': invia('battitoOk', { t: dati.t }); break;
        case 'battitoOk': s.latenza = Math.max(0, o.ora() - dati.t); break;
        case 'eco': invia('ecoOk', { t: dati.t }); break;
        case 'ecoOk': s.eco = Math.max(0, o.ora() - dati.t); o.suCambio(); break;
        case 'errore': o.suErrore(dati.testo); break;
        default: break;
      }
    });
    o.trasporto.suStato((st) => { if (st === 'chiuso') finisci('finito', 'La sessione è terminata: il collegamento con il master si è interrotto.'); });
    invia('ciao', { nome: o.nome, colore: o.colore });

    return {
      stato: () => s,
      chat(testo, privato) {
        const t = P().pulisciTesto(testo, P().LIMITI.testo);
        if (!t || s.stato !== 'attivo') return null;
        invia('chat', { testo: t, a: privato ? 'master' : null });
        return { da: s.nome, colore: s.colore, testo: t, privato: Boolean(privato) };
      },
      // Dado condiviso: il risultato è deciso qui e mandato al master (fiducia; la convalida arriva più avanti).
      dado(tiro) { if (s.stato === 'attivo' && tiro) invia('dado', { tiro: DnD.dadi.normalizeTiro(tiro) }); },
      eco() { invia('eco', { t: o.ora() }); },
      battito() {
        if (s.stato !== 'attivo' && s.stato !== 'attesa') return;
        if (!o.trasporto.connesso() || o.ora() - s.ultimoMsg > SILENZIO_MAX) { finisci('finito', 'La sessione è terminata: il master non risponde.'); return; }
        invia('battito', { t: o.ora() });
      },
      linea: () => P().statoLinea(s.ultimoMsg, s.latenza || 0, o.ora()),
      esci() { finisci('finito', 'Sei uscito dalla sessione.'); },
    };
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.sessione = { MAX_GIOCATORI, SILENZIO_MAX, master, giocatore };
})(globalThis.DnD = globalThis.DnD || {});
