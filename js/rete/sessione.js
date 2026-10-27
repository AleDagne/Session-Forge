// Sessione online sopra un trasporto astratto (trasporto.js): il lato master (approvazione degli ingressi,
// espulsione, istantanee filtrate ed eventi incrementali, chat, dadi, immagini, battito) e il lato giocatore.
// Tappa 2: il giocatore manda intenzioni (rete/intenzioni.js), il master le verifica con le funzioni esistenti e le
// esegue con l'esecutore del Combattimento (ui-combattimento.js, DnD.uiCombattimento.online): tira i dadi lui e
// risponde con l'esito o con un rifiuto spiegato. Permessi, conferma manuale, pausa, gettone di rientro, richieste
// di tiro salvezza, ping, domande, rivelazioni, scambio di oggetti e registro delle violazioni.
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
  const MAX_GIOCATORI = 4;
  const ATTESA_ESITO = 20000;   // giocatore: oltre, la richiesta senza risposta scade
  const ESITI_RICORDATI = 200;  // esiti tenuti per l'idempotenza (per giocatore)

  // Invio con numero di sequenza per collegamento.
  function canale(trasporto) {
    let seq = 0;
    return (tipo, dati) => trasporto.invia(P().codifica(P().crea(tipo, dati, ++seq)));
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
  //   pfNemici, maxGiocatori, convalidati, soglia }
  function master(opts) {
    const o = Object.assign({
      nome: 'Master', ora: () => Date.now(), stato: () => ({}), aggiornaStato: null, esecutore: null, regole: null,
      suRichiesta() {}, suCambio() {}, suChat() {}, suDado() {}, suErrore() {}, suCoda() {}, suDomanda() {}, suPing() {}, suScrive() {}, suViolazione() {},
      immagine: async () => null, pfNemici: false, maxGiocatori: MAX_GIOCATORI, convalidati: true, soglia: 10,
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
    const reg = I().registro(o.soglia);
    let permessiTutti = I().normalizzaPermessi({});
    let pausa = false;
    let finita = false;
    let saltando = '';

    const attivi = () => [...giocatori.values()].filter((g) => g.stato === 'attivo');
    const combat = () => { const s = DnD.sessioni.current(o.stato()); return s ? s.combat : null; };
    const permessiDi = (g) => I().normalizzaPermessi(Object.assign({}, permessiTutti, g.permessi || {}));
    const mioCombattente = (g, c) => (c && g.personaggioId ? c.combatants.find((y) => y.kind === 'player' && y.sourceId === g.personaggioId) || null : null);
    const personaggio = (g, st) => (g.personaggioId ? (st || o.stato()).players.find((p) => p.id === g.personaggioId) || null : null);
    const economiaDi = (x, c) => { const e = I().economia(economie.get(x.id), c, x); economie.set(x.id, e); return e; };
    function presenza() {
      const lista = [{ id: 'master', nome: o.nome, colore: '#c9a24f', stato: 'master' }].concat([...giocatori.values()].filter((g) => g.stato !== 'attesa')
        .map((g) => ({ id: g.id, nome: g.nome, colore: g.colore, stato: g.stato })));
      for (const g of attivi()) g.invia('presenza', { giocatori: lista });
    }
    function vistaDi(g) {
      const r = F().istantanea(o.stato(), {
        giocatoreId: g.id, personaggioId: g.personaggioId, pfNemici: o.pfNemici, master: o.nome,
        regole: o.regole ? o.regole() : null, economia: (x) => { const c = combat(); return c ? economiaDi(x, c) : null; },
      });
      for (const [id, data] of r.immagini) icone.set(id, data);
      return r.vista;
    }
    function inviaIstantanea(g) {
      g.vista = vistaDi(g);
      g.n++;
      g.invia('istantanea', { n: g.n, vista: g.vista });
    }
    const inviaPermessi = (g) => g.invia('permessi', { permessi: permessiDi(g), pausa, convalidati: o.convalidati });
    function disconnesso(g) {
      if (g.stato === 'disconnesso' || !giocatori.has(g.id)) return;
      if (g.stato === 'attesa') { giocatori.delete(g.id); if (g.richiesta) g.richiesta.annullata = true; o.suCambio(); return; }
      g.stato = 'disconnesso';
      g.trasporto.chiudi();
      presenza();
      o.suCambio({ evento: 'disconnesso', giocatore: g });
    }

    // ---------- Violazioni ed esiti ----------
    function violazione(g, tipo, testo, grave) {
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
            if (c2) DnD.dati.pushLog(c2, 'sistema', riga);
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
            if (r.ok && c2) DnD.dati.pushLog(c2, 'sistema', '🎒 ' + p.name + ' dà ' + d.qty + ' × ' + r.nome + ' a ' + dest.name + '.');
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
      return rispondi(g, id, 'eseguita', (r && r.testo) || 'Fatto.', v.avviso || (r && r.avviso) || '');
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
      if (tipo === 'battitoOk') { g.latenza = Math.max(0, ora - dati.t); return; }
      if (tipo === 'eco') { g.invia('ecoOk', { t: dati.t }); return; }
      if (tipo === 'ecoOk') { g.eco = Math.max(0, ora - dati.t); o.suCambio({ evento: 'eco', giocatore: g }); return; }
      if (tipo === 'ciao') {
        if (g.stato !== 'attesa' || g.richiesta) return;
        g.nome = dati.nome;
        g.colore = dati.colore;
        if (attivi().length >= o.maxGiocatori) { rifiutaIngresso(g, 'La sessione è piena (massimo ' + o.maxGiocatori + ' giocatori).'); return; }
        // Rientro: con il gettone (stesso personaggio) o, in mancanza, con lo stesso nome di chi è caduto.
        const gt = dati.gettone ? gettoni.get(dati.gettone) : null;
        const prima = gt ? giocatori.get(gt.id) || Object.assign({ stato: 'disconnesso' }, gt)
          : [...giocatori.values()].find((x) => x !== g && x.stato === 'disconnesso' && stessoNome(x.nome, g.nome)) || null;
        g.richiesta = {
          id: g.id, nome: g.nome, colore: g.colore, rientro: prima ? { id: prima.id, personaggioId: prima.personaggioId, gettone: Boolean(gt) } : null,
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
      g.personaggioId = scelte.personaggioId !== undefined ? scelte.personaggioId || null : rientro ? prima.personaggioId : null;
      g.stato = 'attivo';
      // Gettone di rientro: lo stesso del giocatore che rientra, altrimenti nuovo.
      for (const [k, v] of gettoni) if (v.id === g.id) gettoni.delete(k);
      g.gettone = gettone && rientro ? gettone : nuovoGettone();
      gettoni.set(g.gettone, { id: g.id, personaggioId: g.personaggioId, nome: g.nome, colore: g.colore });
      if (g.personaggioId) saltaAssenti.delete(g.personaggioId);
      g.invia('benvenuto', { id: g.id, nome: g.nome, colore: g.colore, master: o.nome, rientro, gettone: g.gettone });
      inviaPermessi(g);
      inviaIstantanea(g);
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
          id: DnD.dadi.uid(), nome: '', colore: '#4f8cc9', stato: 'attesa', personaggioId: null, permessi: null, gettone: '', trasporto, invia: canale(trasporto),
          vista: null, n: 0, ultimoMsg: o.ora(), latenza: null, eco: null, avvisato: -1e9, richiesta: null,
          limite: P().limitatore(40, 20), limiteChat: P().limitatore(5, 1), limiteIntenzioni: P().limitatore(12, 6), limitePing: P().limitatore(2, 1), limiteScrive: P().limitatore(2, 0.5),
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
        saltaSeAssente();
      },
      istantanea: (id) => { const g = giocatori.get(id); if (g && g.stato === 'attivo') inviaIstantanea(g); },
      chat(testo, aId) {
        const t = P().pulisciTesto(testo, P().LIMITI.testo);
        if (!t) return null;
        const m = { da: o.nome, colore: '#c9a24f', testo: t, privato: Boolean(aId) };
        for (const g of attivi()) if (!aId || g.id === aId) g.invia('chat', Object.assign({}, m));
        return m;
      },
      dado(tiro) { for (const g of attivi()) g.invia('dado', { da: o.nome, colore: '#c9a24f', tiro, verificato: true }); },
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
  //   archivio: { ha(id) -> Promise<bool>, metti(id, data) -> Promise } }
  function giocatore(opts) {
    const o = Object.assign({ ora: () => Date.now(), suCambio() {}, suChat() {}, suDado() {}, suFine() {}, suErrore() {}, suAvanzamento() {},
      suGettone() {}, suEsito() {}, suRichiestaTiro() {}, suPing() {}, suRivela() {}, suPermessi() {}, suOfferta() {}, suRichiamo() {}, suScrive() {},
      archivio: { ha: async () => false, metti: async () => {} } }, opts);
    const invia = canale(o.trasporto);
    const ricevitore = DnD.rete.immagini.ricevitore();
    const s = {
      stato: 'attesa', id: '', nome: o.nome, colore: o.colore, master: '', vista: null, n: 0, presenza: [], ultimoMsg: o.ora(), latenza: null, eco: null,
      motivo: '', attesaIstantanea: false, inArrivo: new Set(), gettone: o.gettone || '', permessi: I().normalizzaPermessi({}), pausa: false, convalidati: true,
      inSospeso: new Map(), // id intenzione -> { tipo, dati, ora, attesa }
    };

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
        if (r.incompatibile) { invia('incompatibile', { versione: P().VERSIONE }); finisci('finito', 'Versione incompatibile: il master usa un\'altra versione dell\'app (protocollo ' + r.versione + ', questa ' + P().VERSIONE + '). Aggiornate entrambi la pagina.'); return; }
        o.suErrore('Messaggio del master scartato: ' + r.errore + '.');
        return;
      }
      s.ultimoMsg = o.ora();
      const { tipo, dati } = r.msg;
      switch (tipo) {
        case 'benvenuto':
          Object.assign(s, { stato: 'attivo', id: dati.id, nome: dati.nome, colore: dati.colore, master: dati.master });
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
          break;
        }
        case 'chat': o.suChat(dati); break;
        case 'dado': o.suDado(dati); break;
        case 'richiestaTiro': o.suRichiestaTiro(dati); break;
        case 'ping': o.suPing(dati); break;
        case 'rivela': o.suRivela(dati); break;
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
    });
    o.trasporto.suStato((st) => { if (st === 'chiuso') finisci('finito', 'La sessione è terminata: il collegamento con il master si è interrotto.'); });
    invia('ciao', { nome: o.nome, colore: o.colore, gettone: s.gettone });

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
        if (!o.trasporto.connesso() || o.ora() - s.ultimoMsg > SILENZIO_MAX) { finisci('finito', 'La sessione è terminata: il master non risponde.'); return; }
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
    };
    return api;
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.sessione = { MAX_GIOCATORI, SILENZIO_MAX, ATTESA_ESITO, master, giocatore };
})(globalThis.DnD = globalThis.DnD || {});
