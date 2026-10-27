// Sessione online sopra un trasporto astratto (trasporto.js): il lato master (approvazione degli ingressi,
// espulsione, istantanee filtrate ed eventi incrementali, chat, dadi, immagini, battito) e il lato giocatore.
// Tappa 2: il giocatore manda intenzioni (rete/intenzioni.js), il master le verifica con le funzioni esistenti e le
// esegue con l'esecutore del Combattimento (ui-combattimento.js, DnD.uiCombattimento.online): tira i dadi lui e
// risponde con l'esito o con un rifiuto spiegato. Permessi, conferma manuale, pausa, gettone di rientro, richieste
// di tiro salvezza, ping, domande, rivelazioni, scambio di oggetti e registro delle violazioni.
// Tappa 3: fino a 6 giocatori più spettatori, topologia a stella (ogni client riceve la propria vista già filtrata da
// filtro.statoPerGiocatore / eventoPerGiocatore), coda di invio con priorità per client (stato di gioco, poi chat e
// battito, poi immagini) con accorpamento degli aggiornamenti per i client lenti, esplorazione, scambi coi mercanti,
// dialoghi, richieste di riposo, riconnessione con il gettone, ripresa della sessione e diagnostica.
// Nessun DOM e nessun WebRTC: la UI (ui-online.js) passa le funzioni di contorno e i test usano la coppia in memoria.
// ora() è iniettabile per il battito e i limiti di frequenza.
(function (DnD) {
  'use strict';

  const P = () => DnD.rete.protocollo;
  const F = () => DnD.rete.filtro;
  const T = () => DnD.rete.trasporto;
  const I = () => DnD.rete.intenzioni;
  const SILENZIO_MAX = 20000;   // oltre: il collegamento è perso
  const CHIUSURA_MS = 400;      // attesa prima di chiudere (il messaggio di congedo deve arrivare)
  const MAX_GIOCATORI = 6;
  const MAX_SPETTATORI = 10;
  const REGISTRO_MAX = 2000;    // righe del riepilogo di fine partita
  const ATTESA_ESITO = 20000;   // giocatore: oltre, la richiesta senza risposta scade
  const ESITI_RICORDATI = 200;  // esiti tenuti per l'idempotenza (per giocatore)

  // Invio con numero di sequenza per collegamento.
  function canale(trasporto) {
    let seq = 0;
    return (tipo, dati) => trasporto.invia(P().codifica(P().crea(tipo, dati, ++seq)));
  }
  // Coda di invio del master per un client: priorità 0 = stato di gioco, 1 = chat, dadi, presenza e battito,
  // 2 = pezzi di immagine (in background, con metà della soglia del canale: non bloccano il gioco). Con il canale pieno
  // (client lento) i messaggi aspettano qui; stat: byte e messaggi inviati, per la diagnostica.
  const PRIORITA = { chat: 1, dado: 1, scrive: 1, presenza: 1, ping: 1, battito: 1, battitoOk: 1, eco: 1, ecoOk: 1, immagine: 2, immagineNo: 2 };
  function codaInvio(trasporto, suVuota) {
    let seq = 0;
    const code = [[], [], []];
    const stat = { byte: 0, messaggi: 0, picco: 0 };
    let attesa = false;
    function svuota() {
      for (;;) {
        if (!trasporto.connesso()) { for (const q of code) q.length = 0; return; }
        const q = code.find((x) => x.length);
        if (!q) { if (suVuota) suVuota(); return; }
        const limite = q === code[2] ? T().SOGLIA_CODA / 2 : T().SOGLIA_CODA;
        if (trasporto.inCoda() > limite) {
          if (!attesa) { attesa = true; Promise.resolve(trasporto.svuotato()).then(() => { attesa = false; svuota(); }); }
          return;
        }
        const testo = q.shift();
        trasporto.invia(testo);
        stat.byte += testo.length;
        stat.messaggi++;
        stat.picco = Math.max(stat.picco, testo.length);
      }
    }
    return {
      invia(tipo, dati) { code[PRIORITA[tipo] || 0].push(P().codifica(P().crea(tipo, dati, ++seq))); svuota(); return true; },
      inAttesa: (p) => (p === undefined ? code[0].length + code[1].length + code[2].length : code[p].length),
      stat,
    };
  }
  const chiudiDopo = (t) => setTimeout(() => t.chiudi(), CHIUSURA_MS);
  const stessoNome = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // Gettone di rientro: casuale, senza significato (nessuna password).
  function nuovoGettone() {
    const b = new Uint8Array(18);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  const tiroTesto = (t) => (t.etichetta || 'Tiro') + ' = ' + (t.totale !== null && t.totale !== undefined ? t.totale : t.gruppi.reduce((s, g) => s + g.total, 0)) + ' [' + t.gruppi.flatMap((g) => g.values).join(', ') + ']';

  // ---------- Master ----------
  // opts: { nome, ora(), stato() -> stato dell'app, aggiornaStato(fn(stato)) (modifica e salva), esecutore (azioni del
  //   Combattimento), regole() (regole del movimento), suRichiesta(richiesta), suCambio(evento), suChat(msg), suDado(msg),
  //   suErrore(testo), suCoda(), suDomanda(d), suPing(p), suScrive(nome), suViolazione(v), immagine(id) -> Promise<data URL>,
  //   pfNemici, maxGiocatori, maxSpettatori, convalidati, soglia,
  //   gettoni (ripresa: [{ gettone, id, personaggioId, nome, colore, spettatore, come }]), schedeAltri, mostraReputazioni,
  //   rivelati: { citta, npc, fazioni, negozi }, esploraGruppo(x, y) -> { ok, testo }, riposo(personaggioId, tipo) -> { testo },
  //   suDialogo({ dialogoId, rispostaId, giocatoreId, nome }) -> { testo }, espelliFrequenza }
  function master(opts) {
    const o = Object.assign({
      nome: 'Master', ora: () => Date.now(), stato: () => ({}), aggiornaStato: null, esecutore: null, regole: null,
      suRichiesta() {}, suCambio() {}, suChat() {}, suDado() {}, suErrore() {}, suCoda() {}, suDomanda() {}, suPing() {}, suScrive() {}, suViolazione() {},
      immagine: async () => null, pfNemici: false, maxGiocatori: MAX_GIOCATORI, maxSpettatori: MAX_SPETTATORI, convalidati: true, soglia: 10,
      gettoni: [], schedeAltri: true, mostraReputazioni: false, rivelati: {}, esploraGruppo: null, riposo: null, suDialogo: null, espelliFrequenza: false,
    }, opts);
    const aggiornaStato = o.aggiornaStato || ((fn) => fn(o.stato()));
    const giocatori = new Map();
    const icone = new Map();      // immagini delle icone (incorporate nello stato), servite su richiesta
    const gettoni = new Map();    // gettone -> { id, personaggioId, nome, colore }
    const esiti = new Map();      // id giocatore -> Map(id intenzione -> esito) (idempotenza, anche dopo un rientro)
    const economie = new Map();   // id combattente -> economia del turno
    const coda = [];              // intenzioni in attesa della conferma manuale
    const offerte = new Map();    // scambi di oggetti in attesa del destinatario
    const richieste = new Map();  // tiri salvezza richiesti dal master
    const saltaAssenti = new Set(); // personaggi assenti di cui saltare i turni
    const dialoghi = new Map();   // dialoghi mostrati: id -> { risposte, scelta, a (id giocatore o null) }
    const incontrati = new Set(); // NPC piazzati già visti dal party (si ricordano anche fuori vista)
    const errori = [];            // ultimi errori, per la diagnostica
    const registroMaster = [];    // log completo della sessione online (chat, dadi, esiti, ingressi)
    let chiusa = false;           // «Chiudi nuovi ingressi»
    let lavoro = null;            // «Il master sta lavorando…»
    const reg = I().registro(o.soglia);
    // Ripresa della sessione: gettoni già assegnati (i personaggi restano legati, i codici sono nuovi).
    for (const x of Array.isArray(o.gettoni) ? o.gettoni : []) {
      if (x && typeof x.gettone === 'string' && typeof x.id === 'string') gettoni.set(x.gettone, { id: x.id, personaggioId: x.personaggioId || null, nome: String(x.nome || ''), colore: x.colore || '#4f8cc9', spettatore: Boolean(x.spettatore), come: x.come || null });
    }
    const annota = (testo) => { registroMaster.push('[' + new Date(o.ora()).toISOString().slice(11, 19) + '] ' + testo); if (registroMaster.length > REGISTRO_MAX) registroMaster.shift(); };
    const erroreDiag = (testo) => { errori.push({ ora: o.ora(), testo }); if (errori.length > 20) errori.shift(); };
    let permessiTutti = I().normalizzaPermessi({});
    let pausa = false;
    let finita = false;
    let saltando = '';

    const attivi = () => [...giocatori.values()].filter((g) => g.stato === 'attivo');
    const giocanti = () => attivi().filter((g) => !g.spettatore);
    const spettatori = () => attivi().filter((g) => g.spettatore);
    const combat = () => { const s = DnD.sessioni.current(o.stato()); return s ? s.combat : null; };
    const permessiDi = (g) => I().normalizzaPermessi(Object.assign({}, permessiTutti, g.permessi || {}));
    const mioCombattente = (g, c) => (c && g.personaggioId ? c.combatants.find((y) => y.kind === 'player' && y.sourceId === g.personaggioId) || null : null);
    const personaggio = (g, st) => (g.personaggioId ? (st || o.stato()).players.find((p) => p.id === g.personaggioId) || null : null);
    const economiaDi = (x, c) => { const e = I().economia(economie.get(x.id), c, x); economie.set(x.id, e); return e; };
    // Barra dei partecipanti: nome, colore, personaggio, stato e chi ha il turno (mandata solo se cambia).
    function presenza() {
      const st = o.stato();
      const c = combat();
      const turno = c && c.phase === 'attivo' ? c.combatants.find((y) => y.id === c.currentId) : null;
      const lista = [{ id: 'master', nome: o.nome, colore: '#c9a24f', stato: 'master', personaggio: '', spettatore: false, turno: false }].concat([...giocatori.values()].filter((g) => g.stato !== 'attesa')
        .map((g) => {
          const p = personaggio(g, st);
          return { id: g.id, nome: g.nome, colore: g.colore, stato: g.stato, personaggio: p && !g.spettatore ? p.name : '', spettatore: Boolean(g.spettatore),
            turno: Boolean(turno && p && !g.spettatore && turno.kind === 'player' && turno.sourceId === p.id) };
        }));
      const firma = JSON.stringify(lista);
      for (const g of attivi()) if (g.presenza !== firma) { g.presenza = firma; g.invia('presenza', { giocatori: lista }); }
    }
    // Vista di un client: passa sempre dal punto unico del filtro (whitelist). Spettatore: vede come il personaggio
    // scelto (g.come) oppure come il «tavolo» (solo ciò che tutto il party sa).
    function opzioniVista(g) {
      return {
        personaggioId: g.spettatore ? g.come : g.personaggioId, spettatore: Boolean(g.spettatore), pfNemici: o.pfNemici, master: o.nome,
        schedeAltri: o.schedeAltri, mostraReputazioni: o.mostraReputazioni, rivelati: o.rivelati, incontrati,
        regole: o.regole ? o.regole() : null, economia: (x) => { const c = combat(); return c ? economiaDi(x, c) : null; },
      };
    }
    function vistaDi(g) {
      const r = F().statoPerGiocatore(o.stato(), g.id, opzioniVista(g));
      for (const [id, data] of r.immagini) icone.set(id, data);
      return r.vista;
    }
    // Aggiornamento di un client: eventi incrementali (o l'istantanea se la vista è cambiata del tutto), sempre
    // passando da filtro.eventoPerGiocatore. Client lento (stato ancora in coda): si accorpa, un solo calcolo quando
    // la sua coda si svuota.
    function aggiornaUno(g) {
      if (g.coda.inAttesa(0) > 0) { g.sporco = true; return; }
      const nuova = vistaDi(g);
      const cambi = F().differenze(g.vista, nuova);
      if (!cambi) { g.vista = nuova; g.n++; g.invia('istantanea', { n: g.n, vista: nuova }); return; }
      if (!cambi.length) return;
      g.vista = nuova;
      g.n++;
      g.invia('evento', F().eventoPerGiocatore({ n: g.n, cambi }, g.id));
    }
    function inviaIstantanea(g) {
      g.vista = vistaDi(g);
      g.n++;
      g.invia('istantanea', { n: g.n, vista: g.vista });
    }
    const inviaPermessi = (g) => g.invia('permessi', { permessi: permessiDi(g), pausa, convalidati: o.convalidati });
    // Intenzioni in sospeso di chi cade: annullate con avviso (il master non perde nulla dei turni).
    function annullaSospese(g) {
      let n = 0;
      for (let i = coda.length - 1; i >= 0; i--) if (coda[i].g.id === g.id) { coda.splice(i, 1); n++; }
      for (const [k, f] of offerte) if (f.g.id === g.id || f.gDest.id === g.id) { offerte.delete(k); n++; }
      for (const [k, r] of richieste) if (r.giocatoreId === g.id) { richieste.delete(k); n++; }
      if (n) { o.suCoda(); o.suErrore('Richieste in sospeso di ' + g.nome + ' annullate: si è disconnesso (' + n + ').'); }
      return n;
    }
    function disconnesso(g) {
      if (g.stato === 'disconnesso' || !giocatori.has(g.id)) return;
      if (g.stato === 'attesa') { giocatori.delete(g.id); if (g.richiesta) g.richiesta.annullata = true; o.suCambio(); return; }
      g.stato = 'disconnesso';
      g.trasporto.chiudi();
      annullaSospese(g);
      annota(g.nome + ' si è disconnesso.');
      presenza();
      o.suCambio({ evento: 'disconnesso', giocatore: g });
    }

    // ---------- Violazioni ed esiti ----------
    function violazione(g, tipo, testo, grave) {
      if (tipo === 'frequenza' && o.espelliFrequenza) grave = true;
      erroreDiag(g.nome + ' · ' + tipo + ': ' + testo);
      reg.annota(g.id, g.nome, tipo, testo, grave, o.ora());
      o.suViolazione({ giocatoreId: g.id, nome: g.nome, tipo, testo, grave });
      if (grave && reg.oltre(g.id) && giocatori.has(g.id)) api.espelli(g.id, 'Espulso automaticamente: troppe richieste non valide (' + reg.gravi(g.id) + ').');
    }
    function rispondi(g, id, stato, testo, avviso) {
      const e = { id, stato, testo: testo || '', avviso: avviso || '' };
      if (stato !== 'attesa') {
        const m = esiti.get(g.id) || new Map();
        m.set(id, e);
        if (m.size > ESITI_RICORDATI) m.delete(m.keys().next().value);
        esiti.set(g.id, m);
      }
      g.invia('esito', e);
      if (stato !== 'attesa') annota(g.nome + ' · ' + stato + ': ' + (e.testo || ''));
      return e;
    }

    const rifiuto = (g, id, testo, tipo, grave) => { violazione(g, tipo || 'rifiuto', testo, grave); return rispondi(g, id, 'rifiutata', testo); };
    // Dadi del master: a tutti i giocatori attivi (o solo a chi ha tirato, se privato), stessa animazione.
    function diffondiDado(m, soloA) {
      for (const x of attivi()) if (!soloA || x === soloA) x.invia('dado', { da: m.da, colore: m.colore, tiro: m.tiro, privato: Boolean(m.privato), verificato: true });
    }

    // ---------- Valutazione delle intenzioni ----------
    // { ok: false, testo, tipo, grave } | { ok: true, descrizione, conferma, esegui() -> { ok, testo, tiro, avviso } }
    function valuta(g, tipo, d, approvato) {
      const st = o.stato();
      const c = combat();
      const x = mioCombattente(g, c);
      const perm = permessiDi(g);
      const no = (testo, extra) => Object.assign({ ok: false, testo }, extra || {});
      const si = (descrizione, esegui, extra) => Object.assign({ ok: true, descrizione, esegui, conferma: false, diffondi: x ? x.name : '' }, extra || {});
      if (tipo === 'ping') {
        if (!g.limitePing.consenti(o.ora())) return no('Un ping alla volta.', { tipo: 'frequenza' });
        if (c && (d.x >= c.grid.w || d.y >= c.grid.h)) return no('Cella fuori dalla griglia.');
        return si(g.nome + ' indica una cella', () => { api.ping(d.x, d.y, g.nome, g.colore); return { testo: 'Ping inviato.' }; });
      }
      if (tipo === 'domanda') return si(g.nome + ' chiede', () => { o.suDomanda({ giocatoreId: g.id, nome: g.nome, testo: d.testo }); return { testo: 'Domanda inviata al master.' }; });
      if (g.spettatore) return no('Gli spettatori non possono agire.');
      // Esplorazione: il gruppo si muove solo su celle che il giocatore conosce; costo e ore li calcola il master.
      if (tipo === 'muoviGruppo') {
        const ve = g.vista && g.vista.esplorazione;
        if (!ve || !o.esploraGruppo) return no('Non c\'è un\'esplorazione in corso.');
        if (d.x >= ve.griglia.w || d.y >= ve.griglia.h || ve.griglia.cells[d.y * ve.griglia.w + d.x] === '0') return no('Non puoi andare lì.');
        return si(g.nome + ' propone di muovere il gruppo in ' + DnD.griglia.cellLabel(d.x, d.y), () => o.esploraGruppo(d.x, d.y),
          { conferma: !approvato && permessiDi(g).esplorazione !== 'sempre', diffondi: '' });
      }
      // Scambio con un mercante: solo con un negozio aperto che il giocatore vede; prezzi e verifiche del master
      // (gli stessi del Mondo). Stesso rifiuto per un mercante inesistente, nascosto o chiuso: nulla da dedurre.
      if (tipo === 'scambio') {
        const p = personaggio(g, st);
        if (!p) return no('Non hai un personaggio assegnato.');
        const vm = g.vista && g.vista.mondo;
        const vn = vm && vm.npc.find((n) => n.id === d.npcId);
        const sess = DnD.sessioni.current(st);
        const pz = vn && vn.negozio.length ? F().npcPiazzato(st, sess, d.npcId) : null;
        const def = pz && DnD.fazioni.view(st, sess.id).npcs.find((n) => n.id === pz.item.npcId);
        if (!def) return no('Mercante non disponibile.');
        const visibili = new Set(vn.negozio.map((r) => r.lineId));
        if (d.compra.some((r) => !visibili.has(r.lineId))) return no('Oggetto non in vendita.');
        const cart = { buy: d.compra, sell: d.vendi };
        const stato = DnD.npc.normalizeState(pz.item.npcState, def);
        const borsa = (x) => ({ inventory: DnD.attrezzatura.normalizeInventory(x.inventory), coins: DnD.attrezzatura.normalizeCoins(x.coins) });
        const q = DnD.npc.quote(def, stato, cart, borsa(p), F().contestoPrezzi(st, sess, def, stato));
        if (!q.ok) return no(q.errors.join(' ') || 'Scambio non valido.');
        return si(p.name + ' commercia con ' + vn.nome, () => {
          let testo = '';
          aggiornaStato((s2) => {
            const se2 = DnD.sessioni.current(s2);
            const pz2 = F().npcPiazzato(s2, se2, d.npcId);
            const p2 = s2.players.find((y) => y.id === p.id);
            const b = borsa(p2);
            pz2.item.npcState = DnD.npc.normalizeState(pz2.item.npcState, def);
            testo = p2.name + ': ' + DnD.npc.checkout(def, pz2.item.npcState, cart, b, F().contestoPrezzi(s2, se2, def, pz2.item.npcState));
            p2.inventory = b.inventory;
            p2.coins = b.coins;
            if (se2.combat) DnD.modello.pushLog(se2.combat, 'sistema', '🛒 ' + testo);
          });
          return { testo };
        });
      }
      // Dialogo mostrato dal master con la scelta al giocatore: solo le risposte mandate, una volta.
      if (tipo === 'rispostaDialogo') {
        const dl = dialoghi.get(d.dialogoId);
        if (!dl || !dl.scelta || (dl.a && dl.a !== g.id) || !dl.risposte.includes(d.rispostaId)) return no('Risposta non disponibile.');
        return si(g.nome + ' risponde', () => {
          dialoghi.delete(d.dialogoId);
          for (const x of attivi()) x.invia('dialogo', { id: d.dialogoId, chiuso: true });
          const r = o.suDialogo ? o.suDialogo({ dialogoId: d.dialogoId, rispostaId: d.rispostaId, giocatoreId: g.id, nome: g.nome }) : null;
          return { testo: (r && r.testo) || 'Risposta scelta.' };
        });
      }
      // Riposo breve: sempre con l'approvazione del master, che lo avvia.
      if (tipo === 'richiediRiposo') {
        const p = personaggio(g, st);
        if (!p) return no('Non hai un personaggio assegnato.');
        if (c && c.phase === 'attivo') return no('Non puoi riposare durante un combattimento.');
        return si(p.name + ' chiede un riposo breve', () => (o.riposo ? o.riposo(p.id, 'breve') : { testo: 'Il master avvia il riposo breve.' }), { conferma: !approvato });
      }
      if (tipo === 'tira') {
        return si(g.nome + ' tira', () => {
          const rec = DnD.dadi.registratore();
          let totale;
          if (d.tipo === 'd20') totale = DnD.regole.rollSave({ bonus: d.bonus, mode: d.modo, dc: null }, rec.rng).total;
          else if (d.tipo === '4d6') DnD.regole.roll4d6DropLowest(rec.rng);
          else { const p = DnD.dadi.parseExpr(d.espr); DnD.dadi.roll(p.count, p.sides, p.modifier, rec.rng); }
          const etichetta = d.etichetta || (d.tipo === 'd20' ? 'd20' + (d.modo !== 'normale' ? ' con ' + d.modo : '') + (d.bonus ? DnD.regole.formatModifier(d.bonus) : '') : d.tipo === '4d6' ? '4d6, scarta il più basso' : d.espr);
          const tiro = rec.tiro(etichetta, c ? 'combattimento' : 'menu', totale === undefined ? {} : { totale });
          const m = { da: g.nome, colore: g.colore, tiro, privato: d.privato, verificato: true, daId: g.id };
          o.suDado(m);
          diffondiDado(m, d.privato ? g : null);
          return { testo: tiroTesto(tiro) + (d.privato ? ' (privato, visto solo dal master)' : '') };
        });
      }
      if (tipo === 'salvezza') {
        const r = richieste.get(d.richiestaId);
        if (!r || r.giocatoreId !== g.id) return no('Richiesta di tiro non trovata o già usata.');
        return si(g.nome + ' tira la salvezza', () => {
          richieste.delete(d.richiestaId);
          const cx = combat();
          const xx = mioCombattente(g, cx);
          if (xx && o.esecutore) return o.esecutore.salvezza(xx.id, r.caratteristica, r.cd, r.modo);
          // Fuori dal combattimento: bonus della scheda, dadi del master.
          const sc = F().scheda(personaggio(g), o.stato(), null);
          const car = sc && sc.caratteristiche.find((y) => y.nome === r.caratteristica);
          const rec = DnD.dadi.registratore();
          const res = DnD.regole.rollSave({ bonus: car ? car.ts : 0, mode: r.modo, dc: r.cd }, rec.rng);
          const tiro = rec.tiro('Salvezza ' + r.caratteristica + (r.cd ? ' CD ' + r.cd : ''), 'menu', { totale: res.total });
          const testo = g.nome + ': salvezza ' + r.caratteristica + ' = ' + res.total + (res.success === null ? '' : res.success ? ' (riuscita)' : ' (fallita)');
          o.suDado({ da: g.nome, colore: g.colore, tiro, verificato: true, daId: g.id });
          return { testo, tiro };
        }, { diffondi: g.nome });
      }
      if (tipo === 'modificaScheda') {
        const p = personaggio(g, st);
        if (!p) return no('Non hai un personaggio assegnato.');
        const chk = I().verificaDelta(I().valoriScheda(p, x), d);
        if (!chk.ok) return no(chk.testo, { tipo: chk.conflitto ? 'conflitto' : 'regola' });
        return si('Modifica della scheda di ' + p.name, () => {
          let riga = '';
          aggiornaStato((s2) => {
            const p2 = s2.players.find((y) => y.id === p.id);
            const c2 = DnD.sessioni.current(s2).combat;
            const x2 = mioCombattente(g, c2);
            riga = I().applicaDelta(p2, x2, d);
            if (c2) DnD.modello.pushLog(c2, 'sistema', riga);
          });
          return { testo: riga };
        });
      }
      if (tipo === 'dai') {
        const p = personaggio(g, st);
        const dest = st.players.find((y) => y.id === d.a);
        if (!p) return no('Non hai un personaggio assegnato.');
        if (!dest || dest.id === p.id || !DnD.sessioni.visible(st, 'players').includes(dest)) return no('Destinatario non valido.');
        const voce = DnD.attrezzatura.normalizeInventory(p.inventory)[d.indice];
        if (!voce || d.qty > voce.qty) return no(voce ? 'Ne hai solo ' + voce.qty + '.' : 'Oggetto non trovato.');
        const eq = st.equipment.find((e) => e.id === voce.equipmentId);
        const oggetto = eq ? eq.name : 'oggetto';
        const gDest = attivi().find((y) => y.personaggioId === dest.id);
        const trasferimento = () => {
          let r = null;
          aggiornaStato((s2) => {
            r = I().trasferisci(s2.players.find((y) => y.id === p.id), s2.players.find((y) => y.id === dest.id), d.indice, d.qty, s2.equipment);
            const c2 = DnD.sessioni.current(s2).combat;
            if (r.ok && c2) DnD.modello.pushLog(c2, 'sistema', '🎒 ' + p.name + ' dà ' + d.qty + ' × ' + r.nome + ' a ' + dest.name + '.');
          });
          return r.ok ? { testo: p.name + ' dà ' + d.qty + ' × ' + r.nome + ' a ' + dest.name + '.' } : { ok: false, testo: r.testo };
        };
        // Destinatario collegato: conferma lui; altrimenti il master.
        if (gDest) return si(p.name + ' offre ' + d.qty + ' × ' + oggetto + ' a ' + dest.name, null, { offerta: { gDest, oggetto, trasferimento } });
        return si(p.name + ' dà ' + d.qty + ' × ' + oggetto + ' a ' + dest.name + ' (non collegato)', trasferimento, { conferma: !approvato });
      }
      // Intenzioni di combattimento.
      if (!c || c.phase !== 'attivo') return no('Non c\'è un combattimento in corso.');
      if (!x) return no(g.personaggioId ? 'Il tuo personaggio non è nel combattimento.' : 'Non hai un personaggio assegnato.');
      if (d.combattenteId !== x.id) return no('Puoi agire solo con il tuo personaggio.', { tipo: 'altrui', grave: true });
      const E = o.esecutore;
      if (!E) return no('Il master non può eseguire azioni ora.');
      const mioTurno = I().turnoDi(c, x);
      const eco = economiaDi(x, c);
      let mappa = null;
      const ctx = {
        c, x, catalogo: st.equipment, regole: o.regole ? o.regole() : E.regole(), piedi: E.piediPerCella(), limitato: E.limitato(x),
        visti: new Set(g.vista && g.vista.combattimento ? g.vista.combattimento.pedine.map((y) => y.id) : []),
        mappa: () => (mappa = mappa || E.mappa()), stato: () => E.statoIA(), distanza: (w) => E.distanza(w),
      };
      Object.defineProperty(ctx, 'vista', { get: () => ctx.mappa().vision });
      const fuoriTurno = () => no('Non è il tuo turno.');
      if (tipo === 'muovi') {
        if (perm.muovi === 'turno' && !mioTurno) return fuoriTurno();
        const r = I().verificaMovimento(ctx, d.celle);
        if (!r.ok) return no(r.testo);
        return si(x.name + ' si sposta', () => E.muovi(x.id, r.route), { avviso: r.avviso });
      }
      if (tipo === 'movimento') {
        if (perm.muovi === 'turno' && !mioTurno) return fuoriTurno();
        const costo = d.tipo === 'scatto' || d.tipo === 'disimpegno' ? 'azione' : null;
        if (costo) { const err = I().puo(eco, costo) || (DnD.condizioni.actionBlock(x) ? 'Non puoi agire: ' + DnD.condizioni.actionBlock(x) + '.' : null); if (err) return no(err); }
        return si(x.name + ': ' + d.tipo, () => { const r = E.movimento(x.id, d.tipo); if (r.ok && costo) I().spendi(eco, costo); return r; });
      }
      if (tipo === 'attacca') {
        if (!d.reazione && !mioTurno) return fuoriTurno();
        const v = I().verificaAttacco(ctx, d);
        if (!v.ok) return no(v.testo);
        const err = I().puo(eco, v.costo);
        if (err) return no(err);
        const pg = personaggio(g, st);
        const n = pg && DnD.generatore ? DnD.generatore.extraAttacks(pg.classId, pg.level || 1) : 1;
        return si(v.descrizione, () => { I().spendi(eco, v.costo, n); return E.attacca(x.id, d.bersaglioId, d.armaId, d.modo); },
          { conferma: !approvato && (d.reazione || perm.confermaManuale) });
      }
      if (tipo === 'lancia') {
        const v = I().verificaMagia(ctx, d);
        if (!v.ok) return no(v.testo);
        if (v.costo !== 'reazione' && !mioTurno) return fuoriTurno();
        const err = I().puo(eco, v.costo);
        if (err) return no(err);
        return si(v.descrizione, () => { I().spendi(eco, v.costo); return E.lancia(x.id, d.magiaId, v.slot, d.bersagli, d.modo); },
          { conferma: !approvato && (v.costo === 'reazione' || perm.confermaManuale || (v.area && perm.confermaArea)) });
      }
      if (tipo === 'usaAzione') {
        const costo = d.azione === 'reazione' ? 'reazione' : d.come;
        if (costo !== 'reazione' && !mioTurno) return fuoriTurno();
        const blocco = DnD.condizioni.actionBlock(x);
        if (blocco) return no('Non puoi agire: ' + blocco + '.');
        if (DnD.regole.isDown(x)) return no('Sei a terra: non puoi agire.');
        const err = I().puo(eco, costo);
        if (err) return no(err);
        const nome = I().AZIONI_NOMI[d.azione];
        if (d.azione === 'creatura') {
          const a = x.creature && DnD.creature.allActions(x.creature).find((y) => y.id === d.azioneId);
          if (!a) return no('Azione non valida.');
          if (d.bersagli.some((id) => !ctx.visti.has(id))) return no('Bersaglio non valido.');
          return si(x.name + ': ' + a.name, () => { I().spendi(eco, costo); return E.azioneCreatura(x.id, a.id, d.bersagli, d.modo); }, { conferma: !approvato && perm.confermaManuale });
        }
        const come = costo === 'bonus' ? ' (azione bonus)' : costo === 'reazione' ? ' (reazione)' : ' (azione)';
        const testo = '⚑ ' + x.name + ': ' + nome + come + (d.testo ? ' — ' + d.testo : '') + '.';
        return si(testo, () => { I().spendi(eco, costo); return E.dichiara(testo); }, { conferma: !approvato && costo === 'reazione' });
      }
      if (tipo === 'finisciTurno') {
        if (!mioTurno) return fuoriTurno();
        const sospese = coda.some((q) => q.g === g);
        return si(x.name + ' finisce il turno', () => E.prossimoTurno(), { conferma: !approvato && sospese });
      }
      return no('Richiesta sconosciuta.', { tipo: 'malformata', grave: true });
    }

    function esegui(g, id, v) {
      let r;
      try { r = v.esegui(); } catch (e) { return rispondi(g, id, 'rifiutata', 'Il master non è riuscito a eseguire la richiesta: ' + e.message); }
      if (r && r.ok === false) return rispondi(g, id, 'rifiutata', r.testo);
      // Dadi del combattimento tirati dal master: anche ai giocatori (stessi valori, stessa animazione).
      if (r && r.tiro && v.diffondi) diffondiDado({ da: v.diffondi, colore: g.colore, tiro: r.tiro });
      // Il testo è la riga del registro del master: passa dal filtro come il log (PF dei nemici, combattenti non visti).
      const testo = r && r.testo ? F().testoEsito(o.stato(), r.testo, { pfNemici: o.pfNemici }) : 'Fatto.';
      return rispondi(g, id, 'eseguita', testo, v.avviso || (r && r.avviso) || '');
    }

    function intenzione(g, m) {
      const { id, tipo } = m;
      const ricordati = esiti.get(g.id);
      if (ricordati && ricordati.has(id)) { g.invia('esito', ricordati.get(id)); return; } // idempotenza
      if (coda.some((q) => q.g.id === g.id && q.id === id) || [...offerte.values()].some((f) => f.g.id === g.id && f.id === id)) { g.invia('esito', { id, stato: 'attesa', testo: 'In attesa…', avviso: '' }); return; }
      if (!g.limiteIntenzioni.consenti(o.ora())) { rifiuto(g, id, 'Troppe richieste: rallenta.', 'frequenza', false); return; }
      const pul = I().pulisci(tipo, m.dati);
      if (!pul.ok) { rifiuto(g, id, 'Richiesta non valida: ' + pul.motivo + '.', 'malformata', true); return; }
      const d = pul.dati;
      if (tipo === 'annulla') {
        const i = coda.findIndex((q) => q.g.id === g.id && q.id === d.intenzioneId);
        if (i >= 0) { coda.splice(i, 1); rispondi(g, d.intenzioneId, 'annullata', 'Richiesta annullata.'); o.suCoda(); }
        rispondi(g, id, 'eseguita', i >= 0 ? 'Richiesta annullata.' : 'Niente da annullare.');
        return;
      }
      if (tipo === 'rispostaOfferta') {
        const f = offerte.get(d.offertaId);
        if (!f || f.gDest.id !== g.id) { rifiuto(g, id, 'Offerta non trovata.', 'regola', false); return; }
        offerte.delete(d.offertaId);
        if (!d.accetta) { rispondi(f.g, f.id, 'rifiutata', g.nome + ' ha rifiutato ' + f.oggetto + '.'); rispondi(g, id, 'eseguita', 'Offerta rifiutata.'); return; }
        const r = f.trasferimento();
        rispondi(f.g, f.id, r.ok === false ? 'rifiutata' : 'eseguita', r.testo);
        rispondi(g, id, r.ok === false ? 'rifiutata' : 'eseguita', r.testo);
        return;
      }
      if (pausa) { rifiuto(g, id, 'Il master ha messo in pausa il gioco.', 'pausa', false); return; }
      if (!I().permesso(permessiDi(g), tipo, d)) { rifiuto(g, id, 'Il master non ti permette questa azione.', 'permesso', false); return; }
      const v = valuta(g, tipo, d, false);
      if (!v.ok) { rifiuto(g, id, v.testo, v.tipo || 'regola', v.grave); return; }
      if (v.offerta) {
        const oid = DnD.dadi.uid();
        offerte.set(oid, { id, g, gDest: v.offerta.gDest, oggetto: v.offerta.oggetto, trasferimento: v.offerta.trasferimento });
        v.offerta.gDest.invia('offerta', { id: oid, da: g.nome, oggetto: v.offerta.oggetto, qty: d.qty });
        rispondi(g, id, 'attesa', 'Offerta inviata: attende la conferma di ' + v.offerta.gDest.nome + '.');
        return;
      }
      if (v.conferma) {
        coda.push({ id, g, tipo, d, descrizione: v.descrizione, ora: o.ora() });
        rispondi(g, id, 'attesa', 'In attesa del master: ' + v.descrizione + '.');
        o.suCoda();
        return;
      }
      esegui(g, id, v);
    }

    function ricevi(g, testo, errFrammento) {
      const ora = o.ora();
      if (errFrammento) { violazione(g, 'malformata', errFrammento, true); g.invia('errore', { testo: 'Messaggio rifiutato: ' + errFrammento + '.' }); return; }
      if (!g.limite.consenti(ora)) {
        if (ora - g.avvisato > 5000) { g.avvisato = ora; violazione(g, 'frequenza', 'troppi messaggi', false); g.invia('errore', { testo: 'Troppi messaggi: alcuni sono stati ignorati.' }); }
        return;
      }
      const r = P().decodifica(testo, 'g');
      if (!r.ok) {
        if (r.incompatibile) {
          g.invia('incompatibile', { versione: P().VERSIONE });
          chiudiDopo(g.trasporto);
          o.suErrore('Un giocatore usa una versione incompatibile dell\'app (protocollo ' + r.versione + ', qui ' + P().VERSIONE + '): deve aggiornare la pagina.');
          return;
        }
        violazione(g, 'malformata', r.errore, true);
        g.invia('errore', { testo: 'Messaggio rifiutato: ' + r.errore + '.' });
        return;
      }
      g.ultimoMsg = ora;
      const { tipo, dati } = r.msg;
      if (tipo === 'battito') { g.invia('battitoOk', { t: dati.t }); return; }
      if (tipo === 'battitoOk') { g.latenza = Math.max(0, ora - dati.t); g.latenze.push(g.latenza); if (g.latenze.length > 20) g.latenze.shift(); return; }

      if (tipo === 'eco') { g.invia('ecoOk', { t: dati.t }); return; }
      if (tipo === 'ecoOk') { g.eco = Math.max(0, ora - dati.t); o.suCambio({ evento: 'eco', giocatore: g }); return; }
      if (tipo === 'ciao') {
        if (g.stato !== 'attesa' || g.richiesta) return;
        g.nome = dati.nome;
        g.colore = dati.colore;
        // Rientro: con il gettone (stesso personaggio) o, in mancanza, con lo stesso nome di chi è caduto.
        const gt = dati.gettone ? gettoni.get(dati.gettone) : null;
        if (chiusa && !gt) { rifiutaIngresso(g, 'Il master non accetta nuovi ingressi in questo momento.'); return; }
        if (!gt && giocanti().length >= o.maxGiocatori && spettatori().length >= o.maxSpettatori) {
          rifiutaIngresso(g, 'La sessione è piena (massimo ' + o.maxGiocatori + ' giocatori e ' + o.maxSpettatori + ' spettatori).');
          return;
        }
        const prima = gt ? giocatori.get(gt.id) || Object.assign({ stato: 'disconnesso' }, gt)
          : [...giocatori.values()].find((x) => x !== g && x.stato === 'disconnesso' && stessoNome(x.nome, g.nome)) || null;
        g.richiesta = {
          id: g.id, nome: g.nome, colore: g.colore, pieno: giocanti().length >= o.maxGiocatori,
          rientro: prima ? { id: prima.id, personaggioId: prima.personaggioId, gettone: Boolean(gt), spettatore: Boolean(prima.spettatore), come: prima.come || null } : null,
          accetta: (scelte) => accetta(g, scelte || {}, prima, gt ? dati.gettone : ''),
          rifiuta: (motivo) => rifiutaIngresso(g, motivo),
        };
        o.suRichiesta(g.richiesta);
        return;
      }
      if (g.stato !== 'attivo') return;
      if (tipo === 'intenzione') intenzione(g, dati);
      else if (tipo === 'chiediIstantanea') inviaIstantanea(g);
      else if (tipo === 'chiediImmagini') servi(g, dati.ids);
      else if (tipo === 'scrive') {
        if (!g.limiteScrive.consenti(ora)) return;
        o.suScrive(g.nome);
        for (const x of attivi()) if (x !== g) x.invia('scrive', { nome: g.nome });
      } else if (tipo === 'chat') {
        if (!permessiDi(g).chat) { g.invia('errore', { testo: 'Il master non ti permette di usare la chat.' }); return; }
        if (!g.limiteChat.consenti(ora)) { g.invia('errore', { testo: 'Stai scrivendo troppo in fretta.' }); return; }
        const m = { da: g.nome, colore: g.colore, testo: dati.testo, privato: dati.a === 'master', daId: g.id };
        annota('💬 ' + g.nome + (m.privato ? ' (al master)' : '') + ': ' + m.testo);
        o.suChat(m);
        if (!m.privato) for (const x of attivi()) if (x !== g) x.invia('chat', { da: m.da, colore: m.colore, testo: m.testo });
      } else if (tipo === 'dado') {
        // Tiro deciso dal giocatore: solo con «Tiri convalidati» spento, e segnato come non verificato.
        if (o.convalidati) { g.invia('errore', { testo: 'I tiri sono convalidati: li tira il master.' }); return; }
        const m = { da: g.nome, colore: g.colore, tiro: dati.tiro, daId: g.id, privato: dati.privato, verificato: false };
        o.suDado(m);
        if (!m.privato) for (const x of attivi()) if (x !== g) x.invia('dado', { da: m.da, colore: m.colore, tiro: m.tiro, verificato: false });
      }
    }

    // Immagini: solo quelle della vista del giocatore, a pezzi nella coda a bassa priorità (non bloccano il gioco).
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
        if (!g.trasporto.connesso()) return;
        for (const p of pezzi) g.invia('immagine', p);
      }
    }

    function accetta(g, scelte, prima, gettone) {
      if (g.stato !== 'attesa' || !giocatori.has(g.id) || finita) return false;
      g.richiesta = null;
      const rientro = Boolean(prima && scelte.rientro !== false && (!giocatori.has(prima.id) || giocatori.get(prima.id).stato !== 'attivo' || gettone));
      if (rientro) {
        const vecchio = giocatori.get(prima.id);
        if (vecchio && vecchio !== g && vecchio.stato === 'attivo') vecchio.trasporto.chiudi(); // stesso gettone da un'altra scheda
        giocatori.delete(g.id);
        giocatori.delete(prima.id);
        g.id = prima.id;
        g.colore = prima.colore;
        if (prima.permessi) g.permessi = prima.permessi;
        giocatori.set(g.id, g);
      }
      // Spettatore: sola vista, come un personaggio scelto (come) o come il «tavolo» (come = null).
      g.spettatore = scelte.spettatore !== undefined ? Boolean(scelte.spettatore) : rientro ? Boolean(prima.spettatore) : false;
      if (!g.spettatore && !rientro && giocanti().length >= o.maxGiocatori) {
        o.suErrore('La sessione è piena (' + o.maxGiocatori + ' giocatori): ' + g.nome + ' entra come spettatore.');
        g.spettatore = true;
      }
      g.come = g.spettatore ? (scelte.come !== undefined ? scelte.come || null : rientro ? prima.come || null : null) : null;
      g.personaggioId = g.spettatore ? null : scelte.personaggioId !== undefined ? scelte.personaggioId || null : rientro ? prima.personaggioId : null;
      g.stato = 'attivo';
      // Gettone di rientro: lo stesso del giocatore che rientra, altrimenti nuovo.
      for (const [k, v] of gettoni) if (v.id === g.id) gettoni.delete(k);
      g.gettone = gettone && rientro ? gettone : nuovoGettone();
      gettoni.set(g.gettone, { id: g.id, personaggioId: g.personaggioId, nome: g.nome, colore: g.colore, spettatore: g.spettatore, come: g.come });
      if (g.personaggioId) saltaAssenti.delete(g.personaggioId);
      g.invia('benvenuto', { id: g.id, nome: g.nome, colore: g.colore, master: o.nome, rientro, gettone: g.gettone, spettatore: g.spettatore });
      inviaPermessi(g);
      inviaIstantanea(g);
      if (lavoro) g.invia('lavoro', { attivo: true, testo: lavoro });
      annota((rientro ? '🔑 ' + g.nome + ' rientra' : '➕ ' + g.nome + ' entra') + (g.spettatore ? ' come spettatore.' : '.'));
      presenza();
      o.suCambio({ evento: 'entrato', giocatore: g });
      return true;
    }
    function rifiutaIngresso(g, motivo) {
      g.richiesta = null;
      g.invia('rifiutato', { motivo: motivo || 'Il master ha rifiutato l\'ingresso.' });
      giocatori.delete(g.id);
      chiudiDopo(g.trasporto);
      o.suCambio();
    }
    // Assenti da saltare: al loro turno il master passa oltre (una volta per turno).
    function saltaSeAssente() {
      const c = combat();
      if (!c || c.phase !== 'attivo' || !c.currentId || !o.esecutore) return;
      const x = c.combatants.find((y) => y.id === c.currentId);
      if (!x || x.kind !== 'player' || !saltaAssenti.has(x.sourceId) || attivi().some((g) => g.personaggioId === x.sourceId)) return;
      const chiave = c.id + ':' + c.round + ':' + x.id;
      if (saltando === chiave) return;
      saltando = chiave;
      setTimeout(() => { o.esecutore.dichiara('⏭ ' + x.name + ' salta il turno (giocatore assente).'); o.esecutore.prossimoTurno(); }, 0);
    }

    const api = {
      // Nuovo collegamento: il giocatore resta «in attesa» finché il master non approva il suo «ciao».
      collega(trasporto) {
        if (finita) { trasporto.chiudi(); return null; }
        const g = {
          id: DnD.dadi.uid(), nome: '', colore: '#4f8cc9', stato: 'attesa', personaggioId: null, permessi: null, gettone: '', trasporto, invia: null, coda: null,
          spettatore: false, come: null, sporco: false, presenza: '', latenze: [],
          vista: null, n: 0, ultimoMsg: o.ora(), latenza: null, eco: null, avvisato: -1e9, richiesta: null,
          limite: P().limitatore(40, 20), limiteChat: P().limitatore(5, 1), limiteIntenzioni: P().limitatore(12, 6), limitePing: P().limitatore(2, 1), limiteScrive: P().limitatore(2, 0.5),
        };
        // Coda con priorità; quando si svuota, un client lento riceve in una volta gli aggiornamenti accorpati.
        g.coda = codaInvio(trasporto, () => { if (g.sporco && g.stato === 'attivo') { g.sporco = false; aggiornaUno(g); } });
        g.invia = g.coda.invia;
        giocatori.set(g.id, g);
        trasporto.suMessaggio((testo, err) => ricevi(g, testo, err));
        trasporto.suStato((s) => { if (s === 'chiuso') disconnesso(g); });
        return g.id;
      },
      // Dopo ogni modifica dello stato: eventi incrementali (o l'istantanea se la vista è cambiata del tutto).
      aggiorna() {
        for (const g of attivi()) aggiornaUno(g);
        presenza();
        saltaSeAssente();
      },
      istantanea: (id) => { const g = giocatori.get(id); if (g && g.stato === 'attivo') inviaIstantanea(g); },
      chat(testo, aId) {
        const t = P().pulisciTesto(testo, P().LIMITI.testo);
        if (!t) return null;
        const m = { da: o.nome, colore: '#c9a24f', testo: t, privato: Boolean(aId) };
        annota('💬 ' + o.nome + (aId ? ' (privato)' : '') + ': ' + t);
        for (const g of attivi()) if (!aId || g.id === aId) g.invia('chat', Object.assign({}, m));
        return m;
      },
      dado(tiro) { annota('🎲 ' + o.nome + ': ' + tiroTesto(tiro)); for (const g of attivi()) g.invia('dado', { da: o.nome, colore: '#c9a24f', tiro, verificato: true }); },
      eco(id) { const g = giocatori.get(id); if (g && g.stato === 'attivo') g.invia('eco', { t: o.ora() }); },
      espelli(id, motivo) {
        const g = giocatori.get(id);
        if (!g) return;
        giocatori.delete(id);
        g.stato = 'espulso';
        for (const [k, v] of gettoni) if (v.id === id) gettoni.delete(k);
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
        annota('⏹ Sessione terminata.');
        for (const g of giocatori.values()) {
          if (g.stato === 'disconnesso') continue;
          g.invia('fine', { motivo: motivo || 'Il master ha terminato la sessione.' });
          chiudiDopo(g.trasporto);
        }
        giocatori.clear();
        gettoni.clear();
        o.suCambio();
      },
      giocatori: () => [...giocatori.values()].map((g) => ({ id: g.id, nome: g.nome, colore: g.colore, stato: g.stato, personaggioId: g.personaggioId, latenza: g.latenza, eco: g.eco,
        spettatore: Boolean(g.spettatore), come: g.come, coda: g.coda.inAttesa(), scaricando: g.coda.inAttesa(2) > 0, byte: g.coda.stat.byte,
        linea: P().statoLinea(g.ultimoMsg, g.latenza || 0, o.ora()), richiesta: g.richiesta, gettone: Boolean(g.gettone && gettoni.has(g.gettone)), permessi: g.permessi,
        assente: g.stato === 'disconnesso' && Boolean(g.personaggioId), salta: Boolean(g.personaggioId && saltaAssenti.has(g.personaggioId)), violazioni: reg.gravi(g.id) })),
      assegna(id, personaggioId) {
        const g = giocatori.get(id);
        if (!g) return;
        g.personaggioId = personaggioId || null;
        if (gettoni.has(g.gettone)) gettoni.get(g.gettone).personaggioId = g.personaggioId;
        if (g.stato === 'attivo') inviaIstantanea(g);
      },
      impostaPfNemici(v) { o.pfNemici = Boolean(v); },
      // Spettatore (o di nuovo giocatore): come = personaggio di cui vede la vista, null = «tavolo».
      impostaSpettatore(id, spettatore, come) {
        const g = giocatori.get(id);
        if (!g) return;
        g.spettatore = Boolean(spettatore);
        g.come = g.spettatore ? come || null : null;
        if (g.spettatore) g.personaggioId = null;
        if (gettoni.has(g.gettone)) Object.assign(gettoni.get(g.gettone), { spettatore: g.spettatore, come: g.come, personaggioId: g.personaggioId });
        if (g.stato === 'attivo') inviaIstantanea(g);
        presenza();
      },
      // Impostazioni di visibilità: PF dei nemici (numeri o stato), schede degli altri giocatori, reputazioni.
      visibilita: () => ({ pfNemici: o.pfNemici, schedeAltri: o.schedeAltri, mostraReputazioni: o.mostraReputazioni }),
      impostaVisibilita(v) {
        for (const k of ['pfNemici', 'schedeAltri', 'mostraReputazioni']) if (v && k in v) o[k] = Boolean(v[k]);
        api.aggiorna();
      },
      // Mondo rivelato dal master: tipo 'citta' | 'npc' | 'fazioni' | 'negozi' (on = false per nascondere di nuovo).
      rivelaMondo(tipo, id, on) {
        if (!['citta', 'npc', 'fazioni', 'negozi'].includes(tipo) || typeof id !== 'string') return;
        const r = o.rivelati;
        r[tipo] = (Array.isArray(r[tipo]) ? r[tipo] : []).filter((x) => x !== id);
        if (on !== false) r[tipo].push(id);
        if (tipo === 'npc' && on === false) incontrati.delete(id);
        api.aggiorna();
      },
      rivelati: () => JSON.parse(JSON.stringify(o.rivelati)),
      // «Vedi come giocatore»: la vista che il client ha ricevuto davvero (gli stessi dati inviati) e ciò che non
      // riceve. Senza id: la vista del «tavolo» (ciò che tutto il party sa).
      vediCome(id) {
        const g = id ? giocatori.get(id) : null;
        const vista = g ? g.vista || vistaDi(g) : F().statoPerGiocatore(o.stato(), 'tavolo', opzioniVista({ spettatore: true, come: null })).vista;
        return { vista, manca: F().nonRicevuto(o.stato(), vista) };
      },
      // Dialogo di un NPC mostrato ai giocatori: d = { npc, testo, risposte: [{ id, testo }], scelta }; aId = solo a lui.
      mostraDialogo(d, aId) {
        const id = (d && d.id) || DnD.dadi.uid();
        const risposte = (d.risposte || []).slice(0, 12).map((r) => ({ id: r.id, testo: r.testo }));
        dialoghi.set(id, { risposte: risposte.map((r) => r.id), scelta: Boolean(d.scelta), a: aId || null });
        for (const g of attivi()) if (!aId || g.id === aId) g.invia('dialogo', { id, npc: d.npc || '', testo: d.testo || '', risposte, scelta: Boolean(d.scelta) && !g.spettatore });
        annota('🗨 ' + (d.npc || 'NPC') + ': ' + (d.testo || ''));
        return id;
      },
      chiudiDialogo(id) { dialoghi.delete(id); for (const g of attivi()) g.invia('dialogo', { id, chiuso: true }); },
      // «Il master sta lavorando…» (preparazione di una scena): indicatore per i giocatori.
      lavoro(attivo, testo) {
        lavoro = attivo ? testo || 'Il master sta preparando la scena…' : null;
        for (const g of attivi()) g.invia('lavoro', { attivo: Boolean(attivo), testo: lavoro || '' });
      },
      // Nuovi ingressi chiusi: entra solo chi rientra con il gettone.
      chiudiIngressi(v) { chiusa = Boolean(v); o.suCambio(); },
      ingressiChiusi: () => chiusa,
      // Ripresa della sessione: i gettoni da salvare (e da ripassare in opts.gettoni alla riapertura).
      esportaGettoni: () => [...gettoni].map(([gettone, v]) => Object.assign({ gettone }, v)),
      // Diagnostica: collegati, latenze, traffico e coda per client, ultimi errori.
      diagnostica() {
        const lista = [...giocatori.values()].filter((g) => g.stato !== 'attesa');
        const lat = lista.flatMap((g) => g.latenze);
        return {
          protocollo: P().VERSIONE, giocatori: giocanti().length, spettatori: spettatori().length, ingressiChiusi: chiusa,
          latenzaMedia: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null, latenzaMassima: lat.length ? Math.max(...lat) : null,
          client: lista.map((g) => ({ nome: g.nome, stato: g.stato, spettatore: Boolean(g.spettatore), latenza: g.latenza, linea: P().statoLinea(g.ultimoMsg, g.latenza || 0, o.ora()),
            byte: g.coda.stat.byte, messaggi: g.coda.stat.messaggi, picco: g.coda.stat.picco, coda: g.coda.inAttesa(), scaricando: g.coda.inAttesa(2) > 0 })),
          errori: errori.slice(-10),
        };
      },
      // Log completo della sessione online (per il master).
      registroCompleto: () => registroMaster.slice(),

      // Permessi: per tutti (id null) o per un giocatore (patch sopra il profilo comune; null = come tutti).
      permessi: (id) => (id ? (giocatori.get(id) ? permessiDi(giocatori.get(id)) : null) : Object.assign({}, permessiTutti)),
      impostaPermessi(id, patch) {
        if (!id) { permessiTutti = I().normalizzaPermessi(Object.assign({}, permessiTutti, patch)); for (const g of attivi()) inviaPermessi(g); return; }
        const g = giocatori.get(id);
        if (!g) return;
        g.permessi = patch === null ? null : Object.assign({}, g.permessi || {}, patch);
        if (g.stato === 'attivo') inviaPermessi(g);
      },
      pausa: () => pausa,
      impostaPausa(v) { pausa = Boolean(v); for (const g of attivi()) inviaPermessi(g); },
      convalidati: () => o.convalidati,
      impostaConvalidati(v) { o.convalidati = Boolean(v); for (const g of attivi()) inviaPermessi(g); },
      // Conferma manuale: coda, approvazione (con modifiche: modo, bersaglio, slot…), rifiuto.
      coda: () => coda.map((q) => ({ id: q.id, giocatoreId: q.g.id, nome: q.g.nome, tipo: q.tipo, dati: Object.assign({}, q.d), descrizione: q.descrizione, ora: q.ora })),
      approva(id, modifiche) {
        const i = coda.findIndex((q) => q.id === id);
        if (i < 0) return null;
        const [q] = coda.splice(i, 1);
        o.suCoda();
        const pul = I().pulisci(q.tipo, Object.assign({}, q.d, modifiche || {}));
        if (!pul.ok) return rispondi(q.g, q.id, 'rifiutata', 'Richiesta non valida dopo la modifica: ' + pul.motivo + '.');
        const v = valuta(q.g, q.tipo, pul.dati, true);
        if (!v.ok) return rispondi(q.g, q.id, 'rifiutata', v.testo);
        return esegui(q.g, q.id, v);
      },
      rifiuta(id, motivo) {
        const i = coda.findIndex((q) => q.id === id);
        if (i < 0) return null;
        const [q] = coda.splice(i, 1);
        o.suCoda();
        return rispondi(q.g, q.id, 'rifiutata', 'Il master ha rifiutato' + (motivo ? ': ' + motivo : '.'));
      },
      // Tiro salvezza richiesto dal master: il giocatore preme «Tira», i dadi li tira il master.
      richiediTiro(id, r) {
        const g = giocatori.get(id);
        if (!g || g.stato !== 'attivo') return null;
        const rid = DnD.dadi.uid();
        const req = { giocatoreId: id, caratteristica: DnD.regole.ABILITIES.includes(r.caratteristica) ? r.caratteristica : 'DES', cd: Number.isInteger(r.cd) ? r.cd : null, modo: ['vantaggio', 'svantaggio'].includes(r.modo) ? r.modo : 'normale', testo: r.testo || '' };
        richieste.set(rid, req);
        g.invia('richiestaTiro', { id: rid, caratteristica: req.caratteristica, cd: req.cd, modo: req.modo, testo: req.testo });
        return rid;
      },
      ping(x, y, nome, colore) {
        const p = { x, y, nome: nome || o.nome, colore: colore || '#c9a24f' };
        o.suPing(p);
        for (const g of attivi()) g.invia('ping', p);
      },
      scrive() { for (const g of attivi()) g.invia('scrive', { nome: o.nome }); },
      richiama(id, testo) { const g = giocatori.get(id); if (g && g.stato === 'attivo') g.invia('richiamo', { testo: testo || 'Tocca a te!' }); },
      // Rivelazione (handout): mandata solo ora, a tutti o a un giocatore.
      rivela(r, id) {
        const msg = { titolo: r.titolo || '', testo: r.testo || '', immagine: r.immagine || null };
        for (const g of attivi()) if (!id || g.id === id) g.invia('rivela', msg);
      },
      rispondiDomanda(id, testo) { return api.chat('↪ ' + testo, id); },
      // Gettone: revoca (chi rientra con quel gettone è un giocatore nuovo).
      revocaGettone(id) { for (const [k, v] of gettoni) if (v.id === id) gettoni.delete(k); const g = giocatori.get(id); if (g) g.gettone = ''; },
      // Personaggio assente: controllo automatico ('ia'), turni saltati ('salta') o di nuovo manuale ('manuale').
      assente(personaggioId, modo) {
        const c = combat();
        const x = c ? c.combatants.find((y) => y.kind === 'player' && y.sourceId === personaggioId) : null;
        if (modo === 'salta') saltaAssenti.add(personaggioId); else saltaAssenti.delete(personaggioId);
        if (x && o.esecutore && (modo === 'ia' || modo === 'manuale')) o.esecutore.controllo(x.id, modo === 'ia' ? 'ia' : 'manuale');
        saltaSeAssente();
        o.suCambio();
      },
      registro: () => reg.voci(),
      soglia: () => reg.soglia,
      impostaSoglia(n) { reg.soglia = Math.max(1, Math.min(100, Math.round(n) || 10)); },
      finita: () => finita,
      // Per i test: la vista inviata a un giocatore.
      vistaInviata: (id) => (giocatori.get(id) ? giocatori.get(id).vista : null),
    };
    return api;
  }

  // ---------- Giocatore ----------
  // opts: { nome, colore, trasporto, gettone, ora(), suCambio(), suChat(msg), suDado(msg), suFine(motivo, stato),
  //   suErrore(testo), suAvanzamento({ ricevuti, totali }), suGettone(gettone), suEsito(esito, intenzione),
  //   suRichiestaTiro(r), suPing(p), suRivela(r), suPermessi(p), suOfferta(f), suRichiamo(testo), suScrive(nome),
  //   suPersa(motivo) (collegamento caduto: si può rientrare con riconnetti), suDialogo(d), suLavoro(testo),
  //   archivio: { ha(id) -> Promise<bool>, metti(id, data) -> Promise } }
  function giocatore(opts) {
    const o = Object.assign({ ora: () => Date.now(), suCambio() {}, suChat() {}, suDado() {}, suFine() {}, suErrore() {}, suAvanzamento() {},
      suGettone() {}, suEsito() {}, suRichiestaTiro() {}, suPing() {}, suRivela() {}, suPermessi() {}, suOfferta() {}, suRichiamo() {}, suScrive() {},
      suPersa() {}, suDialogo() {}, suLavoro() {},
      archivio: { ha: async () => false, metti: async () => {} } }, opts);
    let invia = canale(o.trasporto);
    let ricevitore = DnD.rete.immagini.ricevitore();
    const s = {
      stato: 'attesa', id: '', nome: o.nome, colore: o.colore, master: '', vista: null, n: 0, presenza: [], ultimoMsg: o.ora(), latenza: null, eco: null,
      motivo: '', attesaIstantanea: false, inArrivo: new Set(), gettone: o.gettone || '', permessi: I().normalizzaPermessi({}), pausa: false, convalidati: true,
      inSospeso: new Map(), // id intenzione -> { tipo, dati, ora, attesa }
      spettatore: false, lavoro: '', dialoghi: new Map(), registro: [], tentativi: 0,
    };
    // Riepilogo di fine partita: chat, dadi, esiti, rivelazioni (già filtrati dal master).
    const annota = (testo) => { s.registro.push('[' + new Date(o.ora()).toISOString().slice(11, 19) + '] ' + testo); if (s.registro.length > REGISTRO_MAX) s.registro.shift(); };

    function finisci(stato, motivo) {
      if (['rifiutato', 'espulso', 'finito'].includes(s.stato)) return;
      s.stato = stato;
      s.motivo = motivo;
      chiudiDopo(o.trasporto);
      o.suFine(motivo, stato);
      o.suCambio();
    }
    // Collegamento caduto mentre si giocava: le richieste in sospeso si annullano con un avviso e si può rientrare
    // (riconnetti) con il gettone, che ripristina personaggio e stato.
    function perso(motivo) {
      if (s.stato !== 'attivo' && s.stato !== 'attesa') return;
      if (!s.gettone) { finisci('finito', motivo); return; }
      s.stato = 'persa';
      s.motivo = motivo;
      for (const [id, intn] of s.inSospeso) o.suEsito({ id, stato: 'annullata', testo: 'Richiesta annullata: connessione persa.', avviso: '' }, intn);
      s.inSospeso.clear();
      s.dialoghi.clear();
      annota('⚠ ' + motivo);
      o.suPersa(motivo);
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

    function ricevi(testo, err) {
      if (err) { o.suErrore('Messaggio del master scartato: ' + err + '.'); return; }
      const r = P().decodifica(testo, 'm');
      if (!r.ok) {
        if (r.incompatibile) { invia('incompatibile', { versione: P().VERSIONE }); finisci('finito', 'Versione incompatibile: il master usa un\'altra versione dell\'app (protocollo ' + r.versione + ', questa ' + P().VERSIONE + '). Aggiornate entrambi la pagina.'); return; }
        o.suErrore('Messaggio del master scartato: ' + r.errore + '.');
        return;
      }
      s.ultimoMsg = o.ora();
      const { tipo, dati } = r.msg;
      switch (tipo) {
        case 'benvenuto':
          Object.assign(s, { stato: 'attivo', id: dati.id, nome: dati.nome, colore: dati.colore, master: dati.master, spettatore: dati.spettatore, tentativi: 0 });
          annota(dati.rientro ? '🔑 Rientrato nella sessione di ' + dati.master + '.' : '➕ Entrato nella sessione di ' + dati.master + (dati.spettatore ? ' come spettatore.' : '.'));
          if (dati.gettone) { s.gettone = dati.gettone; o.suGettone(dati.gettone, dati.master); }
          o.suCambio();
          break;
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
        case 'permessi':
          s.permessi = I().normalizzaPermessi(dati.permessi);
          s.pausa = dati.pausa;
          s.convalidati = dati.convalidati;
          o.suPermessi({ permessi: s.permessi, pausa: s.pausa, convalidati: s.convalidati });
          o.suCambio();
          break;
        case 'esito': {
          const intn = s.inSospeso.get(dati.id) || null;
          if (dati.stato === 'attesa') { if (intn) intn.attesa = true; }
          else s.inSospeso.delete(dati.id);
          o.suEsito(dati, intn);
          if (dati.stato !== 'attesa') annota((dati.stato === 'eseguita' ? '✔ ' : '✖ ') + (dati.testo || ''));
          break;
        }
        case 'chat': annota('💬 ' + dati.da + ': ' + dati.testo); o.suChat(dati); break;
        case 'dado': annota('🎲 ' + dati.da + ': ' + tiroTesto(dati.tiro)); o.suDado(dati); break;
        case 'dialogo':
          if (dati.chiuso) s.dialoghi.delete(dati.id);
          else { s.dialoghi.set(dati.id, dati); annota('🗨 ' + (dati.npc || 'NPC') + ': ' + dati.testo); }
          o.suDialogo(dati);
          break;
        case 'lavoro': s.lavoro = dati.attivo ? dati.testo : ''; o.suLavoro(s.lavoro); o.suCambio(); break;
        case 'richiestaTiro': o.suRichiestaTiro(dati); break;
        case 'ping': o.suPing(dati); break;
        case 'rivela': annota('📜 ' + (dati.titolo || 'Rivelazione') + (dati.testo ? ': ' + dati.testo : '')); o.suRivela(dati); break;
        case 'offerta': o.suOfferta(dati); break;
        case 'richiamo': o.suRichiamo(dati.testo); break;
        case 'scrive': o.suScrive(dati.nome); break;
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
    }
    // Ogni trasporto (anche quello di un rientro) passa di qui; i messaggi di un trasporto vecchio si ignorano.
    function collegaTrasporto(t) {
      t.suMessaggio((testo, err) => { if (t === o.trasporto) ricevi(testo, err); });
      t.suStato((st) => { if (st === 'chiuso' && t === o.trasporto) perso('Connessione persa con il master.'); });
      invia('ciao', { nome: o.nome, colore: o.colore, gettone: s.gettone });
    }
    collegaTrasporto(o.trasporto);

    const api = {
      stato: () => s,
      // Intenzione: id e sequenza; resta «in attesa» finché non arriva l'esito (o scade). id: per ripetere la stessa.
      intenzione(tipo, dati, id) {
        if (s.stato !== 'attivo') return null;
        const iid = id || 'i' + DnD.dadi.uid();
        s.inSospeso.set(iid, { id: iid, tipo, dati, ora: o.ora(), attesa: false });
        invia('intenzione', { id: iid, tipo, dati });
        return iid;
      },
      // Annulla una richiesta in sospeso (se è nella coda del master, il master la toglie).
      annulla(id) {
        const intn = s.inSospeso.get(id);
        if (!intn) return;
        s.inSospeso.delete(id);
        invia('intenzione', { id: 'i' + DnD.dadi.uid(), tipo: 'annulla', dati: { intenzioneId: id } });
        o.suEsito({ id, stato: 'annullata', testo: 'Richiesta annullata.', avviso: '' }, intn);
      },
      chat(testo, privato) {
        const t = P().pulisciTesto(testo, P().LIMITI.testo);
        if (!t || s.stato !== 'attivo') return null;
        invia('chat', { testo: t, a: privato ? 'master' : null });
        return { da: s.nome, colore: s.colore, testo: t, privato: Boolean(privato) };
      },
      scrive() { if (s.stato === 'attivo') invia('scrive', {}); },
      // Dado libero deciso qui (solo con «Tiri convalidati» spento): il master lo segna come non verificato.
      dado(tiro, privato) { if (s.stato === 'attivo' && tiro) invia('dado', { tiro: DnD.dadi.normalizeTiro(tiro), privato: Boolean(privato) }); },
      eco() { invia('eco', { t: o.ora() }); },
      battito() {
        if (s.stato !== 'attivo' && s.stato !== 'attesa') return;
        if (!o.trasporto.connesso() || o.ora() - s.ultimoMsg > SILENZIO_MAX) { const t = o.trasporto; perso('Connessione persa: il master non risponde.'); t.chiudi(); return; }
        invia('battito', { t: o.ora() });
        // Richieste senza risposta (non quelle in coda dal master): scadono con un avviso.
        for (const [id, intn] of s.inSospeso) {
          if (intn.attesa || o.ora() - intn.ora <= ATTESA_ESITO) continue;
          s.inSospeso.delete(id);
          o.suEsito({ id, stato: 'rifiutata', testo: 'Nessuna risposta dal master: riprova.', avviso: '' }, intn);
        }
      },
      linea: () => P().statoLinea(s.ultimoMsg, s.latenza || 0, o.ora()),
      esci() { finisci('finito', 'Sei uscito dalla sessione.'); },
      // Rientro dopo una caduta (o dopo che il master ha riaperto la sessione): nuovo trasporto, stesso gettone.
      riconnetti(t) {
        if (!['persa', 'finito'].includes(s.stato) || !t) return false;
        const vecchio = o.trasporto;
        o.trasporto = t;
        try { vecchio.chiudi(); } catch (e) { /* già chiuso */ }
        invia = canale(t);
        ricevitore = DnD.rete.immagini.ricevitore();
        s.inArrivo.clear();
        Object.assign(s, { stato: 'attesa', motivo: '', attesaIstantanea: false, ultimoMsg: o.ora(), lavoro: '' });
        s.tentativi++;
        collegaTrasporto(t);
        o.suCambio();
        return true;
      },
      // Riepilogo di fine partita (testo): registro della sessione e log del combattimento e dell'esplorazione visti.
      riepilogo() {
        const v = s.vista || {};
        const righe = ['Session Forge · riepilogo della partita online', 'Master: ' + (s.master || '?') + ' · giocatore: ' + s.nome, '', '— Sessione —'].concat(s.registro);
        if (v.combattimento) righe.push('', '— Combattimento —', ...v.combattimento.log.map((r) => (r.round ? 'R' + r.round + ' ' : '') + r.testo));
        if (v.esplorazione) righe.push('', '— Esplorazione —', ...v.esplorazione.eventi.map((e) => 'G' + e.giorno + ' ' + e.testo));
        return righe.join('\n');
      },

    };
    return api;
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.sessione = { MAX_GIOCATORI, MAX_SPETTATORI, SILENZIO_MAX, ATTESA_ESITO, PRIORITA, codaInvio, master, giocatore };
})(globalThis.DnD = globalThis.DnD || {});
