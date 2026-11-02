// Valutazione delle intenzioni dei giocatori sul lato del master (A10: tolta da sessione.master): per ogni tipo una
// funzione che controlla permessi, turno, economia e regole e restituisce { ok, testo } (rifiuto) oppure
// { ok: true, descrizione, esegui, conferma, diffondi, … } (da eseguire, subito o dopo la conferma del master).
// Livello rete: nessun DOM; le azioni di combattimento passano dall'esecutore iniettato (o.esecutore). Espone
// DnD.rete.valutazione.crea(dip); usa rete/filtro, rete/intenzioni e le regole (griglia, npc, attrezzatura, dadi).
(function (DnD) {
  'use strict';

  const F = () => DnD.rete.filtro;
  const I = () => DnD.rete.intenzioni;
  const prendi = (tabella, tipo) => (Object.prototype.hasOwnProperty.call(tabella, tipo) ? tabella[tipo] : null);

  /**
   * Crea la funzione di valutazione legata allo stato della sessione del master.
   * @param {object} dip { o, aggiornaStato, attivi, combat, personaggio, permessiDi, mioCombattente, economiaDi, dialoghi,
   *   richieste, coda, diffondiDado, tiroTesto, ping }
   * @returns {(g: object, tipo: string, d: object, approvato: boolean) => object} valuta
   */
  function crea(dip) {
    const { o, aggiornaStato, attivi, combat, personaggio, permessiDi, mioCombattente, economiaDi, dialoghi, richieste, coda, diffondiDado, tiroTesto } = dip;
    const api = { ping: (...a) => dip.ping(...a) };

    // Valide anche per gli spettatori.
    const GENERALI = {
      ping(k) {
        const { g, d, c, no, si } = k;
        if (!g.limitePing.consenti(o.ora())) return no('Un ping alla volta.', { tipo: 'frequenza' });
        if (c && (d.x >= c.grid.w || d.y >= c.grid.h)) return no('Cella fuori dalla griglia.');
        return si(g.nome + ' indica una cella', () => { api.ping(d.x, d.y, g.nome, g.colore); return { testo: 'Ping inviato.' }; });
      },
      domanda(k) {
        const { g, d, si } = k;
        return si(g.nome + ' chiede', () => { o.suDomanda({ giocatoreId: g.id, nome: g.nome, testo: d.testo }); return { testo: 'Domanda inviata al master.' }; });
      },
    };

    // Fuori dal combattimento (o comunque senza il turno): esplorazione, scambi, dialoghi, riposo, dadi, scheda, oggetti.
    const FUORI = {
      // Esplorazione: il gruppo si muove solo su celle che il giocatore conosce; costo e ore li calcola il master.
      muoviGruppo(k) {
        const { g, d, c, approvato, no, si } = k;
        const ve = g.vista && g.vista.esplorazione;
        if (!ve || !o.esploraGruppo) return no('Non c\'è un\'esplorazione in corso.');
        if (d.x >= ve.griglia.w || d.y >= ve.griglia.h || ve.griglia.cells[d.y * ve.griglia.w + d.x] === '0') return no('Non puoi andare lì.');
        return si(g.nome + ' propone di muovere il gruppo in ' + DnD.griglia.cellLabel(d.x, d.y), () => o.esploraGruppo(d.x, d.y),
          { conferma: !approvato && permessiDi(g).esplorazione !== 'sempre', diffondi: '' });
      },
      // Scambio con un mercante: solo con un negozio aperto che il giocatore vede; prezzi e verifiche del master
      // (gli stessi del Mondo). Stesso rifiuto per un mercante inesistente, nascosto o chiuso: nulla da dedurre.
      scambio(k) {
        const { g, d, st, x, no, si } = k;
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
      },
      // Dialogo mostrato dal master con la scelta al giocatore: solo le risposte mandate, una volta.
      rispostaDialogo(k) {
        const { g, d, x, no, si } = k;
        const dl = dialoghi.get(d.dialogoId);
        if (!dl || !dl.scelta || (dl.a && dl.a !== g.id) || !dl.risposte.includes(d.rispostaId)) return no('Risposta non disponibile.');
        return si(g.nome + ' risponde', () => {
          dialoghi.delete(d.dialogoId);
          for (const x of attivi()) x.invia('dialogo', { id: d.dialogoId, chiuso: true });
          const r = o.suDialogo ? o.suDialogo({ dialogoId: d.dialogoId, rispostaId: d.rispostaId, giocatoreId: g.id, nome: g.nome }) : null;
          return { testo: (r && r.testo) || 'Risposta scelta.' };
        });
      },
      // Riposo breve: sempre con l'approvazione del master, che lo avvia.
      richiediRiposo(k) {
        const { g, st, c, approvato, no, si } = k;
        const p = personaggio(g, st);
        if (!p) return no('Non hai un personaggio assegnato.');
        if (c && c.phase === 'attivo') return no('Non puoi riposare durante un combattimento.');
        return si(p.name + ' chiede un riposo breve', () => (o.riposo ? o.riposo(p.id, 'breve') : { testo: 'Il master avvia il riposo breve.' }), { conferma: !approvato });
      },
      tira(k) {
        const { g, d, c, si } = k;
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
      },
      salvezza(k) {
        const { g, d, no, si } = k;
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
      },
      modificaScheda(k) {
        const { g, d, st, x, no, si } = k;
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
      },
      dai(k) {
        const { g, d, st, approvato, no, si } = k;
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
      },
    };

    // Intenzioni di combattimento: k ha anche E (esecutore), mioTurno, eco (economia del turno), ctx (verifiche).
    const COMBATTIMENTO = {
      muovi(k) {
        const { d, x, perm, no, si, E, mioTurno, ctx, fuoriTurno } = k;
        if (perm.muovi === 'turno' && !mioTurno) return fuoriTurno();
        const r = I().verificaMovimento(ctx, d.celle);
        if (!r.ok) return no(r.testo);
        return si(x.name + ' si sposta', () => E.muovi(x.id, r.route), { avviso: r.avviso });
      },
      movimento(k) {
        const { d, x, perm, no, si, E, mioTurno, eco, fuoriTurno } = k;
        if (perm.muovi === 'turno' && !mioTurno) return fuoriTurno();
        const costo = d.tipo === 'scatto' || d.tipo === 'disimpegno' ? 'azione' : null;
        if (costo) { const err = I().puo(eco, costo) || (DnD.condizioni.actionBlock(x) ? 'Non puoi agire: ' + DnD.condizioni.actionBlock(x) + '.' : null); if (err) return no(err); }
        return si(x.name + ': ' + d.tipo, () => { const r = E.movimento(x.id, d.tipo); if (r.ok && costo) I().spendi(eco, costo); return r; });
      },
      attacca(k) {
        const { g, d, st, x, perm, approvato, no, si, E, mioTurno, eco, ctx, fuoriTurno } = k;
        if (!d.reazione && !mioTurno) return fuoriTurno();
        const v = I().verificaAttacco(ctx, d);
        if (!v.ok) return no(v.testo);
        const err = I().puo(eco, v.costo);
        if (err) return no(err);
        const pg = personaggio(g, st);
        const n = pg && DnD.generatore ? DnD.generatore.extraAttacks(pg.classId, pg.level || 1) : 1;
        return si(v.descrizione, () => { I().spendi(eco, v.costo, n); return E.attacca(x.id, d.bersaglioId, d.armaId, d.modo); },
          { conferma: !approvato && (d.reazione || perm.confermaManuale) });
      },
      lancia(k) {
        const { d, x, perm, approvato, no, si, E, mioTurno, eco, ctx, fuoriTurno } = k;
        const v = I().verificaMagia(ctx, d);
        if (!v.ok) return no(v.testo);
        if (v.costo !== 'reazione' && !mioTurno) return fuoriTurno();
        const err = I().puo(eco, v.costo);
        if (err) return no(err);
        return si(v.descrizione, () => { I().spendi(eco, v.costo); return E.lancia(x.id, d.magiaId, v.slot, d.bersagli, d.modo); },
          { conferma: !approvato && (v.costo === 'reazione' || perm.confermaManuale || (v.area && perm.confermaArea)) });
      },
      usaAzione(k) {
        const { d, x, perm, approvato, no, si, E, mioTurno, eco, ctx, fuoriTurno } = k;
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
      },
      finisciTurno(k) {
        const { g, x, approvato, si, E, mioTurno, fuoriTurno } = k;
        if (!mioTurno) return fuoriTurno();
        const sospese = coda.some((q) => q.g === g);
        return si(x.name + ' finisce il turno', () => E.prossimoTurno(), { conferma: !approvato && sospese });
      },
    };

    return function valuta(g, tipo, d, approvato) {
      const st = o.stato();
      const c = combat();
      const x = mioCombattente(g, c);
      const perm = permessiDi(g);
      const no = (testo, extra) => Object.assign({ ok: false, testo }, extra || {});
      const si = (descrizione, esegui, extra) => Object.assign({ ok: true, descrizione, esegui, conferma: false, diffondi: x ? x.name : '' }, extra || {});
      const k = { g, d, approvato, st, c, x, perm, no, si };
      const generale = prendi(GENERALI, tipo);
      if (generale) return generale(k);
      if (g.spettatore) return no('Gli spettatori non possono agire.');
      const fuori = prendi(FUORI, tipo);
      if (fuori) return fuori(k);
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
      Object.assign(k, { E, mioTurno, eco, ctx, fuoriTurno });
      const azione = prendi(COMBATTIMENTO, tipo);
      if (azione) return azione(k);
      return no('Richiesta sconosciuta.', { tipo: 'malformata', grave: true });
    };
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.valutazione = { crea };
})(globalThis.DnD = globalThis.DnD || {});
