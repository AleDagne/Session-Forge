// Intenzioni del gioco online (tappa 2): il giocatore chiede, il master decide. Qui le parti pure: schemi delle
// intenzioni (solo i campi previsti, limiti), permessi con il profilo predefinito, economia delle azioni del turno,
// verifiche di movimento (cella per cella), attacco e incantesimo con le funzioni esistenti (movimento, griglia,
// visione, magie, condizioni), modifiche della scheda con delta e conflitti, scambio di oggetti, registro delle
// violazioni. I messaggi di rifiuto non rivelano mai ciò che il giocatore non vede («Non puoi andare lì»).
(function (DnD) {
  'use strict';

  const R = () => DnD.regole;
  const G = () => DnD.griglia;
  const Mv = () => DnD.movimento;
  const C = () => DnD.condizioni;
  const P = () => DnD.rete.protocollo;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const ID = /^[\w-]{1,64}$/;
  const isId = (v) => typeof v === 'string' && ID.test(v);
  const intero = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const MODI = ['normale', 'vantaggio', 'svantaggio'];
  const modo = (v) => (MODI.includes(v) ? v : 'normale');
  const celle = (n) => n + (n === 1 ? ' cella' : ' celle');

  // ---------- Schemi ----------
  // Ogni schema restituisce i soli campi previsti (gli altri si ignorano) o lancia un errore in italiano.
  function no(testo) { const e = new Error(testo); e.intenzione = true; return e; }
  const richiedi = (cond, testo) => { if (!cond) throw no(testo); };
  const AZIONI = ['schivare', 'aiutare', 'nascondersi', 'oggetto', 'altro', 'reazione', 'creatura'];
  const AZIONI_NOMI = { schivare: 'Schivare', aiutare: 'Aiutare', nascondersi: 'Nascondersi', oggetto: 'Usa un oggetto', altro: 'Altra azione', reazione: 'Reazione', creatura: 'Azione' };
  const CAMPI = ['pf', 'pfTemp', 'slot', 'monete', 'inventario', 'caratteristica', 'livello'];
  const SCHEMI = {
    muovi: (d) => {
      richiedi(isId(d.combattenteId), 'combattente mancante');
      richiedi(Array.isArray(d.celle) && d.celle.length >= 1 && d.celle.length <= 200, 'percorso non valido');
      const out = d.celle.map((c) => (obj(c) && intero(c.x, 0, 999) && intero(c.y, 0, 999) ? { x: c.x, y: c.y } : null));
      richiedi(out.every(Boolean), 'percorso non valido');
      return { combattenteId: d.combattenteId, celle: out };
    },
    movimento: (d) => {
      richiedi(isId(d.combattenteId), 'combattente mancante');
      richiedi(['scatto', 'disimpegno', 'rialzati', 'annulla'].includes(d.tipo), 'azione di movimento sconosciuta');
      return { combattenteId: d.combattenteId, tipo: d.tipo };
    },
    attacca: (d) => {
      richiedi(isId(d.combattenteId) && isId(d.bersaglioId) && isId(d.armaId), 'attacco incompleto');
      return { combattenteId: d.combattenteId, bersaglioId: d.bersaglioId, armaId: d.armaId, modo: modo(d.modo), reazione: Boolean(d.reazione) };
    },
    lancia: (d) => {
      richiedi(isId(d.combattenteId) && isId(d.magiaId), 'incantesimo incompleto');
      richiedi(intero(d.slot, 0, 9), 'slot non valido');
      richiedi(Array.isArray(d.bersagli) && d.bersagli.length <= 20 && d.bersagli.every(isId), 'bersagli non validi');
      return { combattenteId: d.combattenteId, magiaId: d.magiaId, slot: d.slot, bersagli: [...new Set(d.bersagli)], modo: modo(d.modo) };
    },
    usaAzione: (d) => {
      richiedi(isId(d.combattenteId) && AZIONI.includes(d.azione), 'azione sconosciuta');
      richiedi(d.bersagli === undefined || (Array.isArray(d.bersagli) && d.bersagli.length <= 20 && d.bersagli.every(isId)), 'bersagli non validi');
      return {
        combattenteId: d.combattenteId, azione: d.azione, come: ['azione', 'bonus', 'reazione'].includes(d.come) ? d.come : d.azione === 'reazione' ? 'reazione' : 'azione',
        testo: P().pulisciTesto(d.testo, 200), azioneId: isId(d.azioneId) ? d.azioneId : '', bersagli: d.bersagli ? [...new Set(d.bersagli)] : [], modo: modo(d.modo),
      };
    },
    tira: (d) => {
      const tipo = ['espr', 'd20', '4d6'].includes(d.tipo) ? d.tipo : 'espr';
      const p = tipo === 'espr' ? DnD.dadi.parseExpr(typeof d.espr === 'string' ? d.espr.slice(0, 30) : '') : null;
      richiedi(tipo !== 'espr' || (p && p.count > 0), 'espressione di dadi non valida (es. 2d6+3)');
      return { tipo, espr: p ? DnD.dadi.formatExpr(p.count, p.sides, p.modifier) : '', modo: modo(d.modo), bonus: intero(d.bonus, -30, 30) ? d.bonus : 0, privato: Boolean(d.privato), etichetta: P().pulisciTesto(d.etichetta, 60).replace(/\n/g, ' ') };
    },
    salvezza: (d) => { richiedi(isId(d.richiestaId), 'richiesta mancante'); return { richiestaId: d.richiestaId }; },
    finisciTurno: (d) => { richiedi(isId(d.combattenteId), 'combattente mancante'); return { combattenteId: d.combattenteId }; },
    modificaScheda: (d) => {
      richiedi(CAMPI.includes(d.campo), 'campo della scheda non modificabile');
      richiedi(Number.isInteger(d.valore) && Math.abs(d.valore) <= 1e7, 'valore non valido');
      return {
        campo: d.campo, valore: d.valore, prima: Number.isInteger(d.prima) ? d.prima : null,
        livello: intero(d.livello, 1, 9) ? d.livello : null, chiave: typeof d.chiave === 'string' ? d.chiave.slice(0, 12) : '', indice: intero(d.indice, 0, 499) ? d.indice : null,
      };
    },
    dai: (d) => {
      richiedi(intero(d.indice, 0, 499) && intero(d.qty, 1, 100000) && isId(d.a), 'scambio non valido');
      return { indice: d.indice, qty: d.qty, a: d.a };
    },
    rispostaOfferta: (d) => { richiedi(isId(d.offertaId), 'offerta mancante'); return { offertaId: d.offertaId, accetta: Boolean(d.accetta) }; },
    ping: (d) => { richiedi(intero(d.x, 0, 999) && intero(d.y, 0, 999), 'cella non valida'); return { x: d.x, y: d.y }; },
    domanda: (d) => { const t = P().pulisciTesto(d.testo, 300); richiedi(t, 'domanda vuota'); return { testo: t }; },
    annulla: (d) => { richiedi(isId(d.intenzioneId), 'richiesta mancante'); return { intenzioneId: d.intenzioneId }; },
  };
  const TIPI = Object.keys(SCHEMI);
  function pulisci(tipo, dati) {
    if (!SCHEMI[tipo]) return { ok: false, motivo: 'richiesta sconosciuta' };
    if (!obj(dati)) return { ok: false, motivo: 'dati mancanti' };
    try { return { ok: true, dati: SCHEMI[tipo](dati) }; } catch (e) {
      if (!e.intenzione) throw e;
      return { ok: false, motivo: e.message };
    }
  }

  // ---------- Permessi ----------
  const PERMESSI_BASE = {
    muovi: 'turno',        // 'turno' | 'sempre' | 'mai'
    attaccare: true, magie: true, azioni: true,
    tiri: true,            // dadi e prove
    tiriPrivati: true,     // tiri visibili solo al master
    schedaRisorse: true,   // PF, slot, inventario, monete
    schedaBase: false,     // caratteristiche e livello
    ping: true, chat: true,
    confermaManuale: false, // attacchi e magie approvati a mano dal master
    confermaArea: true,     // magie ad area approvate a mano
  };
  const PERMESSI_NOMI = {
    muovi: 'Spostare la propria pedina', attaccare: 'Attaccare', magie: 'Lanciare incantesimi', azioni: 'Altre azioni, azione bonus e reazione',
    tiri: 'Tirare dadi e prove', tiriPrivati: 'Tiri privati al master', schedaRisorse: 'Modificare PF, slot, inventario e monete',
    schedaBase: 'Modificare caratteristiche e livello', ping: 'Indicare un punto (ping)', chat: 'Usare la chat e le domande',
    confermaManuale: 'Conferma manuale di attacchi e magie', confermaArea: 'Conferma manuale delle magie ad area',
  };
  function normalizzaPermessi(p) {
    const o = obj(p) || {};
    const out = {};
    for (const [k, v] of Object.entries(PERMESSI_BASE)) out[k] = k === 'muovi' ? (['turno', 'sempre', 'mai'].includes(o.muovi) ? o.muovi : v) : typeof o[k] === 'boolean' ? o[k] : v;
    return out;
  }
  // Permesso che serve a un'intenzione (null = sempre permessa).
  function permessoDi(tipo, d) {
    if (tipo === 'muovi' || tipo === 'movimento') return 'muovi';
    if (tipo === 'attacca') return 'attaccare';
    if (tipo === 'lancia') return 'magie';
    if (tipo === 'usaAzione') return 'azioni';
    if (tipo === 'tira') return d.privato ? 'tiriPrivati' : 'tiri';
    if (tipo === 'salvezza') return 'tiri';
    if (tipo === 'modificaScheda') return ['caratteristica', 'livello'].includes(d.campo) ? 'schedaBase' : 'schedaRisorse';
    if (tipo === 'dai') return 'schedaRisorse';
    if (tipo === 'ping') return 'ping';
    if (tipo === 'domanda') return 'chat';
    return null;
  }
  const permesso = (perm, tipo, d) => { const k = permessoDi(tipo, d); return !k || (k === 'muovi' ? perm.muovi !== 'mai' : Boolean(perm[k])); };

  // ---------- Economia delle azioni ----------
  // Per combattente: azione (con gli attacchi rimasti dell'azione Attacco), azione bonus, reazione. Si azzera
  // all'inizio di ogni suo turno (nuovo round o nuovo turno). Tenuta dal master in memoria, non nei dati.
  function economia(prec, c, x) {
    if (prec && prec.combat === c.id && (prec.round === c.round || c.currentId !== x.id)) return prec;
    return { combat: c.id, round: c.round, azione: false, attacchi: 0, bonus: false, reazione: false };
  }
  const COSTI = { azione: 'l\'azione', bonus: 'l\'azione bonus', reazione: 'la reazione' };
  // Può spendere? costo: 'attacco' | 'azione' | 'bonus' | 'reazione'.
  function puo(eco, costo) {
    if (costo === 'attacco') return eco.attacchi > 0 || !eco.azione ? null : 'Hai già usato l\'azione in questo turno.';
    if (costo === 'reazione') return eco.reazione ? 'Hai già usato la reazione in questo round.' : null;
    return eco[costo] ? 'Hai già usato ' + COSTI[costo] + ' in questo turno.' : null;
  }
  function spendi(eco, costo, attacchiPerAzione) {
    if (costo === 'attacco') {
      if (eco.attacchi > 0) eco.attacchi--;
      else { eco.azione = true; eco.attacchi = Math.max(0, (attacchiPerAzione || 1) - 1); }
    } else eco[costo] = true;
    return eco;
  }
  // Costo di un incantesimo dal tempo di lancio («1 azione bonus», «1 reazione»).
  const costoMagia = (sp) => (/bonus/i.test(sp.castingTime || '') ? 'bonus' : /reazion/i.test(sp.castingTime || '') ? 'reazione' : 'azione');

  // ---------- Verifiche ----------
  // ctx: { c (combattimento), x (combattente del giocatore), visti (Set di id che il giocatore vede), catalogo,
  //   regole, piedi, limitato (bool), mappa() (ia.buildMap), stato() (stato per il percorso), distanza(arma) -> a distanza? }
  const comune = (ctx) => {
    if (R().isDown(ctx.x)) return 'Sei a terra: non puoi agire.';
    const b = C().actionBlock(ctx.x);
    return b ? 'Non puoi agire: ' + b + '.' : null;
  };
  // Movimento: il percorso del giocatore cella per cella (movimento.walk). Si ferma all'ultima cella valida.
  function verificaMovimento(ctx, percorso) {
    const x = ctx.x;
    if (!x.pos) return { ok: false, testo: 'La tua pedina non è sulla griglia.' };
    const st = Mv().speedState(x, ctx.regole, ctx.piedi);
    if (ctx.limitato && st.zero) return { ok: false, testo: 'Non puoi muoverti: ' + (st.reasons[st.reasons.length - 1] || 'velocità 0') + '.' };
    const limite = ctx.limitato ? Mv().left(x, ctx.regole, ctx.piedi) : undefined;
    const r = Mv().walk(ctx.mappa(), ctx.stato(), x, percorso, limite, { rules: ctx.regole });
    // Percorso non continuo (salti, celle non valide): rifiutato per intero.
    if (r.reason === 'percorso') return { ok: false, testo: 'Non puoi andare lì.' };
    if (r.path.length < 2) {
      if (r.reason === 'residuo') return { ok: false, testo: 'Movimento residuo insufficiente: ' + celle(limite) + '.' };
      return { ok: false, testo: 'Non puoi andare lì.' };
    }
    const avviso = !r.stopped ? '' : r.reason === 'residuo' ? 'Movimento esaurito: ti fermi dopo ' + celle(r.path.length - 1) + '.' : 'Non puoi andare oltre: ti fermi prima.';
    return { ok: true, route: { path: r.path, cost: r.cost, end: r.end, stopped: r.stopped }, avviso };
  }
  // Distanza massima in celle di un'arma: portata (2 con «portata») o gittata lunga del catalogo (1,5 m per cella).
  function portataArma(w, ranged, catalogo) {
    const eq = w.equipmentId ? (catalogo || []).find((e) => e.id === w.equipmentId) : null;
    const wp = eq && eq.weapon;
    if (ranged) return wp && (wp.rangeLong || wp.rangeNormal) ? Math.floor((wp.rangeLong || wp.rangeNormal) / 1.5) : Infinity;
    return wp && (wp.props || []).includes('portata') ? 2 : 1;
  }
  function verificaAttacco(ctx, d) {
    const x = ctx.x;
    const err = comune(ctx);
    if (err) return { ok: false, testo: err };
    const w = x.weapons.find((y) => y.id === d.armaId);
    if (!w) return { ok: false, testo: 'Arma non valida.' };
    const t = ctx.c.combatants.find((y) => y.id === d.bersaglioId);
    if (!t || !ctx.visti.has(t.id) || t.id === x.id) return { ok: false, testo: 'Bersaglio non valido.' };
    if (t.dead) return { ok: false, testo: t.name + ' è morto.' };
    if (x.pos && t.pos) {
      const dist = G().tokenDistance(x, t);
      const ranged = ctx.distanza(w);
      const max = portataArma(w, ranged, ctx.catalogo);
      if (dist > max) return { ok: false, testo: ranged ? t.name + ' è fuori gittata: ' + celle(dist) + ' (massimo ' + celle(max) + ').' : t.name + ' è fuori portata: ' + celle(dist) + ' (portata ' + celle(max) + ').' };
      if (ctx.vista && !DnD.visione.lineOfSight(ctx.vista.sm, x.pos, t.pos)) return { ok: false, testo: 'Non hai linea di vista su ' + t.name + '.' };
    }
    return { ok: true, costo: d.reazione ? 'reazione' : 'attacco', descrizione: x.name + ' attacca ' + t.name + ' con ' + w.name + (d.modo !== 'normale' ? ' (' + d.modo + ')' : '') };
  }
  // Gittata di un incantesimo in celle dal testo («18 metri», «Contatto», «Sé»); null = non si controlla.
  function gittata(sp) {
    const r = String(sp.range || '').toLowerCase();
    if (/^(sé|se stesso|personale)/.test(r)) return 0;
    if (/contatto/.test(r)) return 1;
    const m = /(\d+(?:[.,]\d+)?)\s*(m\b|metri)/.exec(r);
    return m ? Math.floor(Number(m[1].replace(',', '.')) / 1.5) : null;
  }
  function verificaMagia(ctx, d) {
    const x = ctx.x;
    const err = comune(ctx);
    if (err) return { ok: false, testo: err };
    const sc = x.spellcasting;
    const sp = sc && sc.spells.find((y) => y.id === d.magiaId);
    if (!sp) return { ok: false, testo: 'Incantesimo non valido.' };
    const inn = sc.innate && sc.innate[sp.id];
    let slot = sp.level ? d.slot : 0;
    if (inn) {
      if (inn.freq === 'giorno' && !inn.left) return { ok: false, testo: 'Hai esaurito gli usi di ' + sp.name + '.' };
      slot = sp.level;
    } else if (sp.level > 0 && !DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed).includes(slot)) {
      return { ok: false, testo: slot < sp.level ? sp.name + ' richiede uno slot di almeno ' + sp.level + '° livello.' : 'Nessuno slot di ' + slot + '° livello disponibile.' };
    }
    const targets = d.bersagli.map((id) => ctx.c.combatants.find((y) => y.id === id));
    if (targets.some((t, i) => !t || (!ctx.visti.has(t.id) && d.bersagli[i] !== x.id))) return { ok: false, testo: 'Bersaglio non valido.' };
    if (['attacco', 'salvezza', 'cura'].includes(sp.effect.type) && !targets.length) return { ok: false, testo: 'Scegli almeno un bersaglio.' };
    const max = gittata(sp);
    if (max === 0 && targets.some((t) => t.id !== x.id)) return { ok: false, testo: sp.name + ' ha gittata personale.' };
    if (max !== null && x.pos) {
      const lontano = targets.find((t) => t.pos && t.id !== x.id && G().tokenDistance(x, t) > max);
      if (lontano) return { ok: false, testo: lontano.name + ' è fuori gittata: ' + celle(G().tokenDistance(x, lontano)) + ' (massimo ' + celle(max) + ').' };
    }
    const conc = sp.concentration && x.concentration ? ' (termina la concentrazione su ' + x.concentration.name + ')' : '';
    return {
      ok: true, slot, costo: costoMagia(sp), area: Boolean(sp.area),
      descrizione: x.name + ' lancia ' + sp.name + (sp.level ? ' (slot ' + slot + '°)' : '') + (targets.length ? ' su ' + targets.map((t) => t.name).join(', ') : '') + conc,
    };
  }
  // Turno: le intenzioni di combattimento valgono solo nel proprio turno (salvo reazioni e il permesso «sempre»).
  const turnoDi = (c, x) => Boolean(c && c.phase === 'attivo' && c.currentId === x.id);

  // ---------- Scheda: modifiche con delta ----------
  // Valori attuali dei campi modificabili. p: giocatore della sessione, x: il suo combattente (se c'è un combattimento).
  function valoriScheda(p, x) {
    const st = DnD.riposi.normalizeStatus(p.status);
    const sc = x && x.spellcasting ? x.spellcasting : p.spellcasting || null;
    return {
      pf: x ? x.hp : st.hp === null ? p.maxHp : st.hp, pfMax: x ? x.maxHp : p.maxHp, pfTemp: x ? x.tempHp || 0 : st.tempHp,
      slotsTotal: sc && sc.slotsTotal ? sc.slotsTotal.slice() : [], slotsUsed: sc && sc.slotsUsed ? sc.slotsUsed.slice() : [],
      monete: DnD.attrezzatura.normalizeCoins(p.coins), inventario: DnD.attrezzatura.normalizeInventory(p.inventory).map((i) => i.qty),
      caratteristiche: Object.assign({}, p.abilities), livello: p.level || 1,
    };
  }
  // Delta valido? { ok, attuale } o { ok: false, testo }. Conflitto (prima diverso dall'attuale): vince il master.
  function verificaDelta(v, d) {
    let attuale;
    let lo = 0;
    let hi = 0;
    if (d.campo === 'pf') { attuale = v.pf; hi = v.pfMax; }
    else if (d.campo === 'pfTemp') { attuale = v.pfTemp; hi = 999; }
    else if (d.campo === 'slot') {
      if (!d.livello || !v.slotsTotal[d.livello - 1]) return { ok: false, testo: 'Non hai slot di quel livello.' };
      attuale = v.slotsUsed[d.livello - 1] || 0; hi = v.slotsTotal[d.livello - 1];
    } else if (d.campo === 'monete') {
      if (!DnD.attrezzatura.CURRENCIES.includes(d.chiave)) return { ok: false, testo: 'Moneta non valida.' };
      attuale = v.monete[d.chiave]; hi = 10000000;
    } else if (d.campo === 'inventario') {
      if (d.indice === null || d.indice >= v.inventario.length) return { ok: false, testo: 'Oggetto non trovato.' };
      attuale = v.inventario[d.indice]; hi = 100000;
    } else if (d.campo === 'caratteristica') {
      if (!R().ABILITIES.includes(d.chiave)) return { ok: false, testo: 'Caratteristica non valida.' };
      attuale = v.caratteristiche[d.chiave]; lo = 1; hi = 30;
    } else if (d.campo === 'livello') { attuale = v.livello; lo = 1; hi = 20; }
    if (d.prima !== null && d.prima !== attuale) return { ok: false, conflitto: true, testo: 'Il valore è cambiato nel frattempo (ora ' + attuale + '): la tua modifica non è stata applicata.' };
    if (d.valore < lo || d.valore > hi) return { ok: false, testo: 'Valore fuori dai limiti (da ' + lo + ' a ' + hi + ').' };
    return { ok: true, attuale };
  }
  // Applica un delta già verificato al giocatore e al suo combattente. Restituisce la riga del log.
  function applicaDelta(p, x, d) {
    const nomi = { pf: 'PF', pfTemp: 'PF temporanei', slot: 'slot di ' + d.livello + '° livello usati', monete: d.chiave, inventario: 'quantità', caratteristica: d.chiave, livello: 'livello' };
    if (d.campo === 'pf') {
      if (x) x.hp = d.valore;
      else { p.status = DnD.riposi.normalizeStatus(p.status); p.status.hp = d.valore >= p.maxHp ? null : d.valore; }
    } else if (d.campo === 'pfTemp') {
      if (x) x.tempHp = d.valore;
      else { p.status = DnD.riposi.normalizeStatus(p.status); p.status.tempHp = d.valore; }
    } else if (d.campo === 'slot') {
      if (x && x.spellcasting) x.spellcasting.slotsUsed[d.livello - 1] = d.valore;
      if (p.spellcasting && p.spellcasting.slotsUsed) p.spellcasting.slotsUsed[d.livello - 1] = d.valore;
    } else if (d.campo === 'monete') {
      p.coins = Object.assign(DnD.attrezzatura.normalizeCoins(p.coins), { [d.chiave]: d.valore });
    } else if (d.campo === 'inventario') {
      p.inventory = DnD.attrezzatura.normalizeInventory(p.inventory);
      if (d.valore > 0) p.inventory[d.indice].qty = d.valore; else p.inventory.splice(d.indice, 1);
    } else if (d.campo === 'caratteristica') p.abilities = Object.assign({}, p.abilities, { [d.chiave]: d.valore });
    else if (d.campo === 'livello') p.level = d.valore;
    return '📝 ' + p.name + ': ' + nomi[d.campo] + ' → ' + d.valore + '.';
  }
  // Scambio di oggetti tra due giocatori: sposta qty dell'oggetto all'indice; restituisce il nome dell'oggetto o un errore.
  function trasferisci(da, a, indice, qty, catalogo) {
    da.inventory = DnD.attrezzatura.normalizeInventory(da.inventory);
    const voce = da.inventory[indice];
    if (!voce) return { ok: false, testo: 'Oggetto non trovato.' };
    if (qty > voce.qty) return { ok: false, testo: 'Ne hai solo ' + voce.qty + '.' };
    const eq = (catalogo || []).find((e) => e.id === voce.equipmentId);
    voce.qty -= qty;
    if (!voce.qty) da.inventory.splice(indice, 1);
    a.inventory = DnD.attrezzatura.normalizeInventory(a.inventory);
    const stessa = a.inventory.find((y) => y.equipmentId === voce.equipmentId);
    if (stessa) stessa.qty += qty;
    else a.inventory.push({ id: DnD.dadi.uid(), equipmentId: voce.equipmentId, qty, equipped: false, attuned: false });
    return { ok: true, nome: eq ? eq.name : 'oggetto' };
  }

  // ---------- Registro delle violazioni ----------
  // Per giocatore: intenzioni rifiutate, tentativi su pedine altrui, messaggi malformati. Le gravi contano per la soglia.
  function registro(soglia) {
    const voci = [];
    const gravi = new Map();
    const r = {
      soglia: soglia || 10,
      annota(giocatoreId, nome, tipo, testo, grave, ora) {
        voci.push({ giocatoreId, nome, tipo, testo, grave: Boolean(grave), ora: ora || Date.now() });
        if (voci.length > 500) voci.shift();
        if (grave) gravi.set(giocatoreId, (gravi.get(giocatoreId) || 0) + 1);
        return gravi.get(giocatoreId) || 0;
      },
      voci: () => voci.slice(),
      gravi: (id) => gravi.get(id) || 0,
      oltre: (id) => (gravi.get(id) || 0) >= r.soglia,
    };
    return r;
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.intenzioni = {
    TIPI, AZIONI, AZIONI_NOMI, CAMPI, PERMESSI_BASE, PERMESSI_NOMI, pulisci, normalizzaPermessi, permessoDi, permesso,
    economia, puo, spendi, costoMagia, verificaMovimento, portataArma, verificaAttacco, gittata, verificaMagia, turnoDi,
    valoriScheda, verificaDelta, applicaDelta, trasferisci, registro,
  };
})(globalThis.DnD = globalThis.DnD || {});
