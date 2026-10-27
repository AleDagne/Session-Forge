// NPC (logica pura). Un NPC riusa una scheda Standard o Creatura (statistiche, PF, CA, armi, incantesimi) e
// aggiunge ruolo, fazione, città, atteggiamento, dialogo, note. Modello (libreria della sessione) e istanze
// (copie piazzate sulle griglie come oggetti di mappa di tipo «npc»): ogni copia ha il proprio stato (PF,
// merce del mercante, atteggiamento, ostilità, quest consegnate). Ruoli combinabili: Mercante (prezzi con
// margini, reputazione, atteggiamento e contrattazione; monete con conversione; rifornimento giornaliero;
// oggetti sbloccati dalla reputazione), Datore di quest, Combattente neutrale (non attacca; difende se stesso,
// la fazione o aiuta il party; provocato diventa ostile secondo la regola: solo lui, la fazione, la città),
// Informatore. Dialoghi ad albero con condizioni ed esiti. statoNpcPerGiocatore() è la vista dei giocatori.
// Livello regole, gruppo Mondo. Espone DnD.npc; usa fazioni, citta, eventi, oggetti-mappa, attrezzatura, griglia, regole,
// boss (isMonster), dati/mondo, dadi, modello (normalizzaCreatura per la scheda riusata). Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const K = () => DnD.mondoDati;
  const F = () => DnD.fazioni;
  const A = () => DnD.attrezzatura;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => { const n = num(v, def, lo, hi); return n === null ? null : Math.round(n); };
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const ID = /^[\w-]{1,64}$/;
  const idOf = (v) => (typeof v === 'string' && ID.test(v) ? v : DnD.dadi.uid());
  const refId = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
  const ids = (v, max) => [...new Set(arr(v).filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, max || 100);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const MAX_NODES = 60;

  // ---------- Normalizzazione ----------
  function normalizeStockLine(s) {
    s = obj(s);
    return {
      id: idOf(s.id),
      equipmentId: refId(s.equipmentId),
      qty: int(s.qty, 1, 0, 9999),
      // Prezzo base in rame (null = costo dell'Attrezzatura).
      price: s.price === null || s.price === undefined || s.price === '' ? null : int(s.price, null, 0, 100000000),
      restock: int(s.restock, 0, 0, 999),     // pezzi aggiunti ogni giorno (0 = nessun rifornimento)
      max: int(s.max, int(s.qty, 1, 0, 9999), 0, 9999), // tetto del rifornimento
      minRep: s.minRep === null || s.minRep === undefined || s.minRep === '' ? null : int(s.minRep, null, -100, 100),
    };
  }
  function normalizeMerchant(m) {
    m = obj(m);
    return {
      stock: arr(m.stock).slice(0, 200).map(normalizeStockLine).filter((s) => s.equipmentId),
      coins: A().normalizeCoins(m.coins || { mo: 100 }),
      sellMargin: num(m.sellMargin, K().MERCHANT.sellMargin, 0.1, 10),
      buyMargin: num(m.buyMargin, K().MERCHANT.buyMargin, 0, 5),
      haggleDc: int(m.haggleDc, K().MERCHANT.haggleDc, 1, 40),
      buys: m.buys !== false,
    };
  }

  function normalizeDialogCond(c) {
    c = obj(c);
    return {
      kind: pick(c.kind, K().DIALOG_CONDS, 'reputazione'), negate: Boolean(c.negate),
      factionId: refId(c.factionId), min: int(c.min, 0, -100, 100), equipmentId: refId(c.equipmentId),
      name: str(c.name, 40), op: pick(c.op, DnD.eventi.OPS, '='), value: typeof c.value === 'number' || typeof c.value === 'boolean' ? c.value : str(c.value, 80),
      attitude: pick(c.attitude, K().ATTITUDES, 'amichevole'),
    };
  }
  function normalizeDialogOutcome(o) {
    o = obj(o);
    const kind = pick(o.kind, K().DIALOG_OUTCOMES, 'vai');
    const out = { kind };
    if (kind === 'vai') out.to = refId(o.to);
    if (kind === 'prova') Object.assign(out, { what: typeof o.what === 'string' && o.what ? str(o.what, 40) : 'Persuasione', dc: int(o.dc, 12, 1, 40), success: refId(o.success), failure: refId(o.failure) });
    if (kind === 'reputazione') Object.assign(out, { factionId: refId(o.factionId), delta: int(o.delta, 5, -100, 100) });
    if (kind === 'quest') out.questId = refId(o.questId);
    if (kind === 'atteggiamento') out.value = pick(o.value, K().ATTITUDES, 'amichevole');
    if (kind === 'variabile') Object.assign(out, { name: str(o.name, 40) || 'variabile', op: o.op === 'incrementa' ? 'incrementa' : 'imposta', value: typeof o.value === 'number' || typeof o.value === 'boolean' ? o.value : str(o.value, 80) });
    return out;
  }
  function normalizeDialog(d) {
    d = obj(d);
    const nodes = arr(d.nodes).slice(0, MAX_NODES).map((n) => {
      n = obj(n);
      return {
        id: idOf(n.id), title: str(n.title, 60), text: str(n.text, 3000),
        answers: arr(n.answers).slice(0, 12).map((a) => {
          a = obj(a);
          return { id: idOf(a.id), text: str(a.text, 300) || '…', conds: arr(a.conds).slice(0, 6).map(normalizeDialogCond), outcomes: arr(a.outcomes).slice(0, 8).map(normalizeDialogOutcome) };
        }),
      };
    });
    const start = nodes.some((n) => n.id === d.start) ? d.start : nodes.length ? nodes[0].id : '';
    return { start, nodes };
  }

  function normalizeNpc(n) {
    n = obj(n);
    const c = obj(n.combat);
    const base = n.base === 'creatura' ? 'creatura' : 'standard';
    // Scheda riusata: standard (razza, classe, livello) o creatura del Manuale dei Mostri.
    const rawStats = Object.assign({}, obj(n.stats), { id: 'scheda', name: str(n.name, 60) || obj(n.stats).name, type: base === 'creatura' ? 'creatura' : 'standard' });
    const stats = DnD.modello.normalizzaCreatura(rawStats, false);
    delete stats.sessionId;
    delete stats.shared;
    return {
      id: idOf(n.id),
      name: str(n.name, 60) || stats.name || 'NPC',
      base,
      stats,
      roles: [...new Set(arr(n.roles).filter((r) => K().ROLES.includes(r)))],
      // Vuoto = dalla città (fazione dominante), altrimenti Neutrali.
      factionId: refId(n.factionId),
      cityId: refId(n.cityId),
      attitude: pick(n.attitude, K().ATTITUDES, 'indifferente'),
      title: str(n.title, 60),
      dialog: normalizeDialog(n.dialog),
      merchant: normalizeMerchant(n.merchant),
      questIds: ids(n.questIds, 30),
      combat: {
        defend: pick(c.defend, K().DEFENDS, 'se'),
        provoke: pick(c.provoke, K().PROVOKE_RULES, 'solo'),
        calmDc: int(c.calmDc, 15, 1, 40),
        joinNow: Boolean(c.joinNow),
        penalty: int(c.penalty, K().REP_EVENTS.attaccaNeutrale, -100, 0),
      },
      // Routine facoltativa: dove si trova per fascia oraria.
      routine: arr(n.routine).slice(0, 12).map((r) => ({ from: int(obj(r).from, 8, 0, 23), to: int(obj(r).to, 18, 0, 23), gridId: refId(obj(r).gridId), x: int(obj(r).x, 0, 0, 99), y: int(obj(r).y, 0, 0, 99), place: str(obj(r).place, 80) })),
      hiddenRole: Boolean(n.hiddenRole),
      notes: str(n.notes, 5000),
      sessionId: typeof n.sessionId === 'string' ? n.sessionId.slice(0, 64) : '',
      shared: Boolean(n.shared),
    };
  }

  // Stato di una copia piazzata.
  function normalizeState(s, npc) {
    s = obj(s);
    const base = npc ? initialState(npc) : { stock: [], coins: A().normalizeCoins({}) };
    return {
      hp: s.hp === null || s.hp === undefined ? null : int(s.hp, null, 0, 9999),
      attitude: s.attitude ? pick(s.attitude, K().ATTITUDES, 'indifferente') : null,
      stock: Array.isArray(s.stock) ? s.stock.slice(0, 200).map(normalizeStockLine).filter((x) => x.equipmentId) : base.stock,
      coins: s.coins ? A().normalizeCoins(s.coins) : base.coins,
      hostile: Boolean(s.hostile),
      hostileTo: ids(s.hostileTo, 20),
      factionId: refId(s.factionId),
      delivered: ids(s.delivered, 50),
      haggle: num(s.haggle, 0, -K().MERCHANT.maxHaggle, K().MERCHANT.maxHaggle),
      lastRestockDay: int(s.lastRestockDay, 0, 0, 1000000),
      revealed: { name: obj(s.revealed).name !== false, role: Boolean(obj(s.revealed).role), attitude: Boolean(obj(s.revealed).attitude) },
      dead: Boolean(s.dead),
    };
  }
  function initialState(npc) {
    return { stock: clone(npc.merchant.stock), coins: clone(npc.merchant.coins) };
  }
  // Nuova copia indipendente dello stato (dal modello).
  const instantiateState = (npc) => normalizeState({}, npc);

  // Copia piazzata sulla griglia: un oggetto di mappa di tipo «npc» con icona, nome e stato propri.
  function placedItem(npc, id, x, y) {
    const dims = DnD.griglia.gridSizeFor(npc.stats.gridSize, npc.stats.size || null);
    return Object.assign({
      id, sourceId: '', name: npc.name, icon: clone(npc.stats.icon), mode: 'icon', tiles: null, x: x || 0, y: y || 0, w: dims.w, h: dims.h, cells: '1'.repeat(dims.w * dims.h),
    }, DnD.oggettiMappa.normalizeFields({ otype: 'npc', container: false, interactive: true }), { npcId: npc.id, npcState: instantiateState(npc) });
  }

  // ---------- Fazione e atteggiamento ----------
  function factionOf(npc, state, cities) {
    if (state && state.factionId) return state.factionId;
    if (npc.factionId) return npc.factionId;
    const city = arr(cities).find((c) => c.id === npc.cityId);
    return DnD.citta.defaultFaction(city, 'neutrali');
  }
  // Atteggiamento effettivo: base (o quello della copia) più il modificatore dalla reputazione con la sua fazione.
  function attitudeOf(npc, state, rep) {
    const baseName = state && state.attitude ? state.attitude : npc.attitude;
    if (state && state.hostile) return 'ostile';
    const v = K().ATTITUDE_SCALE[baseName] + F().attitudeDelta(rep || 0);
    return v <= -1 ? 'ostile' : v >= 1 ? 'amichevole' : 'indifferente';
  }

  // ---------- Monete ----------
  const V = () => A().CURRENCY_VALUE;
  const toCopper = (coins) => A().CURRENCIES.reduce((s, k) => s + (coins && coins[k] ? coins[k] * V()[k] : 0), 0);
  // Rame -> monete (oro, argento, rame: le monete di platino ed electrum non si danno come resto).
  function fromCopper(cp) {
    let rest = Math.max(0, Math.round(cp));
    const out = A().normalizeCoins({});
    for (const k of ['mo', 'ma', 'mr']) { out[k] = Math.floor(rest / V()[k]); rest -= out[k] * V()[k]; }
    return out;
  }
  // Paga cp dalla borsa, con il resto: prima le monete piccole, poi si cambia la più piccola sufficiente.
  // Restituisce la nuova borsa o null se non basta.
  function pay(purse, cp) {
    if (toCopper(purse) < cp) return null;
    const p = A().normalizeCoins(purse);
    let rem = Math.round(cp);
    for (const k of A().CURRENCIES) {
      const take = Math.min(p[k], Math.floor(rem / V()[k]));
      p[k] -= take;
      rem -= take * V()[k];
    }
    while (rem > 0) {
      const k = A().CURRENCIES.find((x) => p[x] > 0 && V()[x] >= rem) || A().CURRENCIES.slice().reverse().find((x) => p[x] > 0);
      if (!k) return null;
      p[k] -= 1;
      if (V()[k] >= rem) { const change = fromCopper(V()[k] - rem); for (const c of A().CURRENCIES) p[c] += change[c]; rem = 0; }
      else rem -= V()[k];
    }
    return p;
  }
  const receive = (purse, cp) => A().addCoins(A().normalizeCoins(purse), fromCopper(cp));
  // Rame -> testo leggibile («1 mo, 5 ma»).
  const formatCopper = (cp) => A().formatCoins(fromCopper(cp));

  // ---------- Mercante ----------
  // ctx: { rep (reputazione del party con la fazione dell'NPC), attitude, catalog }
  const basePrice = (line, catalog) => {
    if (line.price !== null && line.price !== undefined) return line.price;
    const e = arr(catalog).find((x) => x.id === line.equipmentId);
    return e && e.cost ? Math.round(e.cost.amount * V()[e.cost.unit]) : 0;
  };
  // Fattore di prezzo complessivo per gli acquisti del party (margine, reputazione, atteggiamento, contrattazione).
  function sellFactor(npc, state, ctx) {
    return npc.merchant.sellMargin * F().priceFactor(ctx.rep || 0) * K().ATTITUDE_PRICE[ctx.attitude || 'indifferente'] * (1 - ((state && state.haggle) || 0));
  }
  function buyFactor(npc, state, ctx) {
    return npc.merchant.buyMargin / F().priceFactor(ctx.rep || 0) / K().ATTITUDE_PRICE[ctx.attitude || 'indifferente'] * (1 + ((state && state.haggle) || 0));
  }
  const unitSellPrice = (npc, state, line, ctx) => { const b = basePrice(line, ctx.catalog); return b ? Math.max(1, Math.round(b * sellFactor(npc, state, ctx))) : 0; };
  function unitBuyPrice(npc, state, equipmentId, ctx) {
    const b = basePrice({ equipmentId, price: null }, ctx.catalog);
    return b ? Math.max(0, Math.floor(b * buyFactor(npc, state, ctx))) : 0;
  }
  // Merce in vendita: righe con prezzo, disponibilità e blocco per reputazione.
  function offer(npc, state, ctx) {
    return state.stock.map((line) => {
      const e = arr(ctx.catalog).find((x) => x.id === line.equipmentId) || null;
      const locked = line.minRep !== null && (ctx.rep || 0) < line.minRep;
      return { line, equipment: e, missing: !e, locked, price: unitSellPrice(npc, state, line, ctx) };
    });
  }

  // Scambio: cart = { buy: [{ lineId, qty }], sell: [{ equipmentId, qty }] }. Verifica e calcola i totali.
  // buyer: { inventory, coins } (giocatore o borsa condivisa del party). Restituisce { ok, errors, total, buyTotal, sellTotal }.
  function quote(npc, state, cart, buyer, ctx) {
    const errors = [];
    let buyTotal = 0;
    let sellTotal = 0;
    const rows = offer(npc, state, ctx);
    for (const b of arr(cart.buy)) {
      const r = rows.find((x) => x.line.id === b.lineId);
      if (!r) { errors.push('Oggetto non più in vendita.'); continue; }
      if (r.missing) { errors.push('Oggetto eliminato dall\'Attrezzatura.'); continue; }
      if (r.locked) { errors.push('«' + r.equipment.name + '» richiede reputazione ' + r.line.minRep + '.'); continue; }
      if (b.qty > r.line.qty) errors.push('Solo ' + r.line.qty + '× «' + r.equipment.name + '» disponibili.');
      buyTotal += r.price * b.qty;
    }
    for (const s of arr(cart.sell)) {
      if (!npc.merchant.buys) { errors.push('Questo mercante non compra.'); break; }
      const row = arr(buyer.inventory).filter((x) => x.equipmentId === s.equipmentId).reduce((n, x) => n + x.qty, 0);
      if (s.qty > row) errors.push('Non hai abbastanza oggetti da vendere.');
      sellTotal += unitBuyPrice(npc, state, s.equipmentId, ctx) * s.qty;
    }
    const total = buyTotal - sellTotal;
    if (total > 0 && toCopper(buyer.coins) < total) errors.push('Monete insufficienti: servono ' + formatCopper(total) + '.');
    if (total < 0 && toCopper(state.coins) < -total) errors.push('Il mercante non ha abbastanza monete (' + A().formatCoins(state.coins) + ').');
    return { ok: !errors.length && (arr(cart.buy).length + arr(cart.sell).length) > 0, errors: [...new Set(errors)], total, buyTotal, sellTotal };
  }
  // Esegue lo scambio (modifica state e buyer). Restituisce il testo per il log o lancia un errore.
  function checkout(npc, state, cart, buyer, ctx) {
    const q = quote(npc, state, cart, buyer, ctx);
    if (!q.ok) throw new Error(q.errors.join(' ') || 'Carrello vuoto.');
    const parts = [];
    for (const b of arr(cart.buy)) {
      if (!b.qty) continue;
      const line = state.stock.find((x) => x.id === b.lineId);
      line.qty -= b.qty;
      A().addToInventory(buyer.inventory, line.equipmentId, b.qty);
      const e = arr(ctx.catalog).find((x) => x.id === line.equipmentId);
      parts.push('compra ' + b.qty + '× ' + (e ? e.name : '?'));
    }
    for (const s of arr(cart.sell)) {
      if (!s.qty) continue;
      let left = s.qty;
      for (const row of buyer.inventory.filter((x) => x.equipmentId === s.equipmentId).sort((a, b) => Number(a.equipped) - Number(b.equipped))) {
        const take = Math.min(row.qty, left);
        row.qty -= take;
        left -= take;
        if (!left) break;
      }
      buyer.inventory.splice(0, buyer.inventory.length, ...buyer.inventory.filter((x) => x.qty > 0));
      const line = state.stock.find((x) => x.equipmentId === s.equipmentId);
      if (line) line.qty += s.qty;
      else state.stock.push(normalizeStockLine({ equipmentId: s.equipmentId, qty: s.qty, max: 0 }));
      const e = arr(ctx.catalog).find((x) => x.id === s.equipmentId);
      parts.push('vende ' + s.qty + '× ' + (e ? e.name : '?'));
    }
    if (q.total > 0) { buyer.coins = pay(buyer.coins, q.total); state.coins = receive(state.coins, q.total); }
    if (q.total < 0) { state.coins = pay(state.coins, -q.total); buyer.coins = receive(buyer.coins, -q.total); }
    return parts.join(', ') + ' · ' + (q.total >= 0 ? 'paga ' : 'riceve ') + formatCopper(Math.abs(q.total));
  }

  // Rifornimento giornaliero: ogni riga con «restock» torna verso il suo tetto. day = giorno corrente.
  function restock(state, day) {
    const days = Math.max(0, day - state.lastRestockDay);
    if (!days) return 0;
    let added = 0;
    for (const line of state.stock) {
      if (!line.restock || line.qty >= line.max) continue;
      const n = Math.min(line.max - line.qty, line.restock * days);
      line.qty += n;
      added += n;
    }
    state.lastRestockDay = day;
    return added;
  }

  // Contrattazione: prova di Persuasione contro la CD del mercante. Successo = sconto (fino al tetto),
  // fallimento = piccolo rincaro. Modifica state.haggle. Restituisce { success, total, haggle, text }.
  function haggle(npc, state, bonus, rng) {
    const r = DnD.regole.rollSave({ bonus: bonus || 0, mode: 'normale', dc: npc.merchant.haggleDc }, rng);
    const M = K().MERCHANT;
    const before = state.haggle;
    state.haggle = Math.max(-M.maxHaggle, Math.min(M.maxHaggle, before + (r.success ? M.haggleStep : -M.haggleFail)));
    const pct = Math.round(state.haggle * 100);
    return { success: r.success, total: r.total, natural: r.natural, haggle: state.haggle,
      text: 'Persuasione ' + r.total + ' contro CD ' + npc.merchant.haggleDc + ': ' + (r.success ? 'riuscita' : 'fallita') + ' → ' + (pct >= 0 ? 'sconto ' + pct + '%' : 'rincaro ' + (-pct) + '%') + '.' };
  }

  // ---------- Combattente neutrale ----------
  // Dati dell'NPC sul combattente (combattente.npc): modello, copia, regole e atteggiamento corrente.
  function combatData(npc, state, itemId, attitude) {
    return { npcId: npc.id, itemId: itemId || '', cityId: npc.cityId, defend: npc.combat.defend, provoke: npc.combat.provoke,
      calmDc: npc.combat.calmDc, penalty: npc.combat.penalty, attitude: attitude || 'indifferente', roles: npc.roles.slice() };
  }
  // È ancora neutrale verso chi lo attacca? (relazione non ostile e nessuna ostilità personale)
  const isNeutralTo = (x, attacker, t) => !F().ostili(x, attacker, t);

  // Chi reagisce a un attacco di `attacker` contro `target`: il bersaglio stesso (se NPC non ostile) e gli NPC che
  // difendono la sua fazione o i suoi alleati. Restituisce i combattenti NPC da rendere ostili.
  function reactions(attacker, target, combatants, t) {
    const out = [];
    for (const x of arr(combatants)) {
      if (!x.npc || x.hp <= 0 || x.id === attacker.id) continue;
      if (!isNeutralTo(x, attacker, t)) continue;
      if (x.id === target.id) { out.push(x); continue; }
      if (x.npc.defend === 'fazione' && (x.faction === target.faction || F().alleati(x, target, t))) out.push(x);
      if (x.npc.defend === 'party' && target.faction === 'giocatori' && x.npc.attitude === 'amichevole') out.push(x);
    }
    return out;
  }

  // Rende ostili gli NPC provocati secondo la loro regola. ctx: { combatants, factions (lista modificabile),
  // symmetric, attackerFaction, attackerId }. Modifica combattenti e fazioni; restituisce { lines, changed: [id],
  // factionsBefore (istantanea per l'annullamento), reputation: [{ factionId, delta }] }.
  function provoke(npcs, ctx) {
    const lines = [];
    const changed = new Set();
    const factionsBefore = clone(ctx.factions || []);
    const reputation = [];
    const hostileTo = (x) => {
      x.hostileTo = [...new Set(arr(x.hostileTo).concat(ctx.attackerFaction))];
      if (x.npc) x.npc.attitude = 'ostile';
      changed.add(x.id);
    };
    for (const x of npcs) {
      const rule = x.npc.provoke;
      if (rule === 'fazione' && ctx.factions && x.faction !== ctx.attackerFaction) {
        F().setRelation(ctx.factions, x.faction, ctx.attackerFaction, 'ostile', ctx.symmetric);
        for (const y of arr(ctx.combatants)) if (y.faction === x.faction && y.npc) { y.npc.attitude = 'ostile'; changed.add(y.id); }
        changed.add(x.id);
        lines.push('⚠ ' + x.name + ' è stato provocato: la sua fazione diventa ostile.');
      } else if (rule === 'citta' && x.npc.cityId) {
        for (const y of arr(ctx.combatants)) if (y.npc && y.npc.cityId === x.npc.cityId) hostileTo(y);
        lines.push('⚠ ' + x.name + ' è stato provocato: tutta la sua città diventa ostile.');
      } else {
        hostileTo(x);
        lines.push('⚠ ' + x.name + ' diventa ostile.');
      }
      if (x.npc.penalty) reputation.push({ factionId: x.faction, delta: x.npc.penalty, reason: 'attacco a ' + x.name });
    }
    return { lines, changed: [...changed], factionsBefore, reputation };
  }
  // Calmato (prova o evento): torna neutrale (toglie le ostilità personali, atteggiamento indifferente).
  function calm(x) {
    x.hostileTo = [];
    if (x.npc) x.npc.attitude = 'indifferente';
    return x.name + ' si calma e torna neutrale.';
  }
  // Conta nella difficoltà e nei PE? Solo se è ostile al party (gli NPC neutrali no).
  function countsForXp(x, t, partyFaction) {
    if (!x.npc) return true;
    return F().ostili({ id: '__party', faction: partyFaction || 'giocatori' }, x, t);
  }

  // ---------- Dialoghi ----------
  // ctx: { rep(factionId), hasItem(id), variable(name), attitude }
  function condOk(c, ctx) {
    let ok;
    if (c.kind === 'reputazione') ok = ctx.rep(c.factionId) >= c.min;
    else if (c.kind === 'oggetto') ok = ctx.hasItem(c.equipmentId);
    else if (c.kind === 'atteggiamento') ok = ctx.attitude === c.attitude;
    else { const v = ctx.variable(c.name); ok = DnD.eventi.compare(v === undefined ? '' : v, c.op, c.value); }
    return c.negate ? !ok : ok;
  }
  const answersFor = (node, ctx) => (node ? node.answers.filter((a) => a.conds.every((c) => condOk(c, ctx))) : []);
  const nodeOf = (dialog, id) => dialog.nodes.find((n) => n.id === id) || null;

  // Sceglie una risposta: restituisce { next (id del nodo o ''), effects: [esiti da applicare], lines }.
  // Le prove si tirano qui (ctx.bonus(what), rng); gli esiti con effetti fuori dal dialogo li applica la UI.
  function choose(dialog, answer, ctx, rng) {
    const effects = [];
    const lines = [];
    let next = '';
    for (const o of answer.outcomes) {
      if (o.kind === 'vai') next = o.to;
      else if (o.kind === 'fine') next = '';
      else if (o.kind === 'prova') {
        const r = DnD.regole.rollSave({ bonus: ctx.bonus ? ctx.bonus(o.what) : 0, mode: 'normale', dc: o.dc }, rng);
        lines.push('🎲 ' + o.what + ' ' + r.total + ' contro CD ' + o.dc + ': ' + (r.success ? 'successo' : 'fallimento') + '.');
        next = r.success ? o.success : o.failure;
      } else effects.push(o);
    }
    if (next && !nodeOf(dialog, next)) { lines.push('⚠ Il nodo successivo non esiste più: il dialogo finisce.'); next = ''; }
    return { next, effects, lines };
  }
  // Nodi irraggiungibili e riferimenti a nodi mancanti (avvisi dell'editor).
  function dialogWarnings(dialog) {
    const out = [];
    const known = new Set(dialog.nodes.map((n) => n.id));
    const seen = new Set();
    const stack = dialog.start ? [dialog.start] : [];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id) || !known.has(id)) continue;
      seen.add(id);
      for (const a of nodeOf(dialog, id).answers) for (const o of a.outcomes) for (const t of [o.to, o.success, o.failure]) if (t) stack.push(t);
    }
    for (const n of dialog.nodes) if (!seen.has(n.id)) out.push('«' + (n.title || n.text.slice(0, 30) || 'nodo') + '» non è raggiungibile.');
    for (const n of dialog.nodes) for (const a of n.answers) for (const o of a.outcomes) for (const t of [o.to, o.success, o.failure]) if (t && !known.has(t)) out.push('Una risposta porta a un nodo eliminato.');
    return [...new Set(out)];
  }

  // ---------- Routine ----------
  function routineAt(npc, hour) {
    return npc.routine.find((r) => (r.from <= r.to ? hour >= r.from && hour < r.to : hour >= r.from || hour < r.to)) || null;
  }

  // ---------- Vista per i giocatori (compatibilità futura con l'online) ----------
  // Solo ciò che il master rivela: mai note, ruoli nascosti, atteggiamenti segreti, merce o quest non offerte.
  function statoNpcPerGiocatore(npc, state, opts) {
    const o = opts || {};
    const s = state || normalizeState({}, npc);
    const showRole = s.revealed.role && !npc.hiddenRole;
    return {
      name: s.revealed.name ? npc.name : 'Sconosciuto',
      icon: clone(npc.stats.icon),
      roles: showRole ? npc.roles.filter((r) => r !== 'combattente') : [],
      attitude: s.revealed.attitude ? (o.attitude || s.attitude || npc.attitude) : null,
      status: s.dead ? 'morto' : s.hostile ? 'ostile' : '',
      // Merce solo se il negozio è stato scoperto, quest solo se offerte (ids dal diario).
      shop: o.shopOpen && showRole && npc.roles.includes('mercante') ? s.stock.filter((x) => x.qty > 0 && x.minRep === null).map((x) => ({ equipmentId: x.equipmentId, qty: x.qty })) : [],
      quests: arr(o.offeredQuestIds).filter((id) => npc.questIds.includes(id)),
    };
  }

  // Riferimenti mancanti: messaggi per elenco e pannello.
  function missingRefs(npc, st, world) {
    const out = [];
    const has = (list, id) => arr(list).some((x) => x.id === id);
    if (npc.factionId && world && !has(world.factions, npc.factionId)) out.push('fazione eliminata');
    if (npc.cityId && world && !has(world.cities, npc.cityId)) out.push('città eliminata');
    if (npc.merchant.stock.some((s) => !has(st.equipment, s.equipmentId))) out.push('oggetto in vendita eliminato');
    if (world && npc.questIds.some((q) => !has(world.quests, q))) out.push('quest eliminata');
    if (npc.routine.some((r) => r.gridId && !has(st.savedGrids, r.gridId))) out.push('mappa della routine eliminata');
    out.push(...dialogWarnings(npc.dialog).filter((w) => w.includes('eliminato')));
    return out;
  }

  // Promuove un nemico (Standard, Creatura o Boss) a NPC: la scheda viene copiata, l'originale resta.
  function fromEnemy(enemy, sessionId) {
    const stats = clone(enemy);
    delete stats.id;
    const base = DnD.boss.isMonster(enemy) ? 'creatura' : 'standard';
    return normalizeNpc({ id: DnD.dadi.uid(), name: enemy.name, base, stats: Object.assign(stats, { type: base === 'creatura' ? 'creatura' : 'standard' }), roles: ['informatore'], sessionId });
  }

  DnD.npc = {
    normalizeNpc, normalizeState, normalizeDialog, normalizeMerchant, normalizeStockLine, instantiateState, placedItem,
    factionOf, attitudeOf, toCopper, fromCopper, pay, receive, formatCopper, basePrice, unitSellPrice, unitBuyPrice, offer, quote, checkout,
    restock, haggle, combatData, isNeutralTo, reactions, provoke, calm, countsForXp, condOk, answersFor, nodeOf, choose, dialogWarnings,
    routineAt, statoNpcPerGiocatore, missingRefs, fromEnemy,
  };
})(globalThis.DnD = globalThis.DnD || {});
