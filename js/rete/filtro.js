// Filtro del gioco online (sul master): ciò che non deve vedersi non viene mai inviato. Costruisce la «vista» di un
// giocatore dallo stato del master (istantanea), le differenze tra due viste (eventi incrementali) e la loro
// applicazione sul giocatore. Mai inviati: note del master, combattenti e oggetti nascosti, eventi non visibili,
// boss non rivelati, contenuti di forzieri e trappole, tiri segreti, piano dell'IA, PF esatti dei nemici
// (salvo l'opzione del master). La griglia passa da DnD.visione.visioneGiocatore (nebbia e linea di vista).
(function (DnD) {
  'use strict';

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const LOG_MAX = 120;
  // Tipi di riga del log che non partono mai: piano e motivazioni dell'IA, modifiche a mano del master.
  const LOG_ESCLUSI = new Set(['ia', 'modifica']);
  const SALUTE = { illeso: 'illeso', ferito: 'ferito', grave: 'grave', terra: 'a terra' };

  // Stato di salute senza numeri: illeso / ferito / grave / a terra.
  function salute(hp, maxHp) {
    if (hp <= 0) return SALUTE.terra;
    if (hp >= maxHp) return SALUTE.illeso;
    return hp > maxHp / 2 ? SALUTE.ferito : SALUTE.grave;
  }
  const delParty = (c) => c.kind === 'player' || c.faction === 'giocatori';
  const lato = (c) => (c.kind === 'player' ? 'giocatore' : c.faction === 'giocatori' ? 'alleato' : c.faction === 'neutrali' ? 'neutrale' : 'nemico');

  // Icona senza immagini incorporate: le immagini viaggiano a parte (immagini.js), qui solo l'impronta.
  function icona(icon, raccolta) {
    if (!icon || typeof icon !== 'object') return null;
    const out = clone(icon);
    if (out.kind === 'image' && typeof out.image === 'string') {
      const lib = DnD.immaginiLib;
      if (lib && lib.isStoredImageUrl(out.image)) {
        out.imageId = lib.imageId(out.image);
        raccolta.set(out.imageId, out.image);
      }
      delete out.image;
    }
    return out;
  }

  function pedina(c, opts, raccolta) {
    const mostraPf = delParty(c) || opts.pfNemici;
    const ds = DnD.condizioni.normalizeDeathSaves(c.deathSaves);
    const p = {
      id: c.id, nome: c.name, icona: icona(c.icon, raccolta), pos: c.pos ? { x: c.pos.x, y: c.pos.y } : null,
      w: DnD.griglia.tokenDims(c).w, h: DnD.griglia.tokenDims(c).h, lato: lato(c), fazione: c.faction || '', iniziativa: c.initiative,
      salute: salute(c.hp, c.maxHp), aTerra: c.hp <= 0, morto: Boolean(c.dead),
      condizioni: DnD.condizioni.normalizeList(c.conditions).map((e) => { const d = DnD.condizioni.defOf(e); return { nome: d.name, icona: d.icon, colore: d.color }; }),
      concentrazione: c.concentration ? c.concentration.name : '',
      mia: Boolean(opts.combattenteId && c.id === opts.combattenteId),
    };
    if (mostraPf) Object.assign(p, { pf: c.hp, pfMax: c.maxHp, pfTemp: c.tempHp || 0 });
    if (delParty(c) && (ds.active || ds.stable)) p.morte = { successi: ds.successes, fallimenti: ds.failures, stabile: ds.stable };
    if (p.mia) p.proprie = proprie(c, opts);
    return p;
  }

  // Azioni della propria pedina (tappa 2): armi, magie, azioni da creatura, movimento residuo ed economia del turno.
  function proprie(x, opts) {
    const Mv = DnD.movimento;
    const sc = x.spellcasting;
    const m = Mv.movementOf(x);
    const eco = opts.economia ? opts.economia(x) : null;
    return {
      armi: (x.weapons || []).map((w) => ({ id: w.id, nome: w.name, testo: DnD.regole.formatModifier(w.toHit) + ' · ' + w.damageDice + (w.damageBonus ? DnD.regole.formatModifier(w.damageBonus) : '') + (w.damageType ? ' ' + w.damageType : '') })),
      magie: sc ? {
        cd: sc.dc, attacco: sc.attack, slotsTotali: (sc.slotsTotal || []).slice(), slotsUsati: (sc.slotsUsed || []).slice(),
        lista: sc.spells.map((sp) => {
          const inn = sc.innate && sc.innate[sp.id];
          return { id: sp.id, nome: sp.name, livello: sp.level, effetto: sp.effect.type, gittata: sp.range || '', tempo: sp.castingTime || '', area: Boolean(sp.area), concentrazione: Boolean(sp.concentration),
            innato: inn ? { freq: inn.freq, rimasti: inn.left === undefined ? null : inn.left } : null };
        }),
      } : null,
      creatura: x.creature && DnD.creature ? DnD.creature.allActions(x.creature).map((a) => ({ id: a.id, nome: a.name })) : [],
      movimento: { residuo: opts.regole ? Mv.left(x, opts.regole, opts.piedi) : null, velocita: opts.regole ? Mv.speedCells(x, opts.regole, opts.piedi) : null, spostato: m.moves.length > 0, scatti: m.dashes },
      prono: DnD.condizioni.has(x, 'prono'),
      blocco: DnD.condizioni.actionBlock(x) || '',
      economia: eco ? { azione: eco.azione, attacchi: eco.attacchi, bonus: eco.bonus, reazione: eco.reazione } : null,
    };
  }

  // Riga del log ripulita, o null se non deve partire. nomi: { visti: Set, nascosti: [nomi], nemici: Map nome -> maxHp }.
  function rigaLog(e, nomi, opts) {
    if (LOG_ESCLUSI.has(e.type)) return null;
    let t = String(e.text || '');
    if (nomi.nascosti.some((n) => n && t.includes(n))) return null;
    t = t.replace(/\s*Nota del master:.*$/s, '');
    if (!opts.pfNemici && nomi.nemici.size) {
      // PF dei nemici: «Nome: 12 → 5 PF» diventa «Nome: ferito»; altri numeri di PF vicini al nome spariscono.
      for (const [n, max] of nomi.nemici) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        t = t.replace(new RegExp(esc + ': -?\\d+ → (-?\\d+) PF', 'g'), (m, dopo) => n + ': ' + salute(Number(dopo), max));
        t = t.replace(new RegExp('(' + esc + '[^.]*?) \\(-?\\d+ → (-?\\d+) PF\\)', 'g'), (m, testa, dopo) => testa + ' (' + salute(Number(dopo), max) + ')');
        t = t.replace(new RegExp('(' + esc + '[^.]*?)(?:,? )?PF -?\\d+/\\d+', 'g'), '$1');
        t = t.replace(new RegExp('(' + esc + ' recupera) \\d+ PF(?: \\[[^\\]]*\\])?', 'g'), '$1 PF');
      }
    }
    return t.trim() ? { round: e.round, tipo: e.type, testo: t.slice(0, 400) } : null;
  }

  // Scheda in sola lettura (riassunto calcolato sul master: il giocatore non ha le librerie del master).
  function scheda(p, st, combattente) {
    if (!p) return null;
    const out = { nome: p.name, livello: p.level || 1, razza: '', classe: '', ca: null, pf: null, pfMax: p.maxHp, iniziativa: null, velocita: null, competenza: null, caratteristiche: [], percezione: null, condizioni: [], dadiVita: null };
    try {
      const race = arr(st.races).find((r) => r.id === p.raceId) || null;
      const d = DnD.regole.derivedStats(p, race, st.equipment);
      const fx = d.fx || (DnD.scheda ? DnD.scheda.featEffects(p) : null);
      const R = DnD.regole;
      Object.assign(out, {
        razza: race ? race.name : '', classe: DnD.classi.className(p.classId), ca: d.ac.total, competenza: d.profBonus,
        iniziativa: DnD.scheda.initiative(p, d, fx).total, velocita: DnD.scheda.speed(p, race, fx, st.equipment).total,
        caratteristiche: R.ABILITIES.map((ab) => ({ nome: ab, valore: d.abilities[ab], mod: R.modifier(d.abilities[ab]), ts: d.saveTotals[ab], competente: d.saves.includes(ab) })),
        percezione: DnD.scheda.passive(p, 'Percezione', d, fx, st),
      });
    } catch (e) { /* riassunto parziale */ }
    const status = DnD.riposi ? DnD.riposi.normalizeStatus(p.status) : obj(p.status);
    out.pf = combattente ? combattente.hp : status.hp === null || status.hp === undefined ? p.maxHp : status.hp;
    if (combattente) out.pfMax = combattente.maxHp;
    // Scheda completa (tappa 2): campi modificabili con le richieste di modifica.
    out.pfTemp = combattente ? combattente.tempHp || 0 : status.tempHp || 0;
    const sc = combattente && combattente.spellcasting ? combattente.spellcasting : p.spellcasting;
    out.slot = sc && sc.slotsTotal ? sc.slotsTotal.map((n, i) => ({ livello: i + 1, totali: n, usati: (sc.slotsUsed || [])[i] || 0 })).filter((x) => x.totali > 0) : [];
    out.monete = DnD.attrezzatura ? DnD.attrezzatura.normalizeCoins(p.coins) : {};
    out.inventario = DnD.attrezzatura ? DnD.attrezzatura.normalizeInventory(p.inventory).map((it, i) => {
      const eq = arr(st.equipment).find((e) => e.id === it.equipmentId);
      return { indice: i, nome: eq ? eq.name : 'Oggetto sconosciuto', qty: it.qty, equipaggiato: it.equipped };
    }) : [];
    out.dadiVita = Math.max(0, out.livello - (status.hitDiceUsed || 0)) + '/' + out.livello;
    out.condizioni = combattente ? DnD.condizioni.normalizeList(combattente.conditions).map((e) => DnD.condizioni.nameOf(e)) : arr(p.sheet && p.sheet.conditions).slice(0, 20);
    return out;
  }

  // Schede degli altri giocatori in sola lettura limitata: nome, classe, livello, salute, CA, condizioni.
  function altri(st, c, pers, o) {
    if (o.schedeAltri === false) return [];
    const sess = DnD.sessioni.current(st);
    return DnD.sessioni.visible(st, 'players', sess.id).filter((p) => !pers || p.id !== pers.id).map((p) => {
      const x = c ? c.combatants.find((y) => y.kind === 'player' && y.sourceId === p.id) : null;
      if (c && !x) return null;
      const s = DnD.riposi.normalizeStatus(p.status);
      const hp = x ? x.hp : s.hp === null ? p.maxHp : s.hp;
      return { id: p.id, nome: p.name, classe: DnD.classi.className(p.classId), livello: p.level || 1, salute: salute(hp, x ? x.maxHp : p.maxHp), ca: x ? x.ac : null,
        condizioni: x ? DnD.condizioni.normalizeList(x.conditions).map((e) => DnD.condizioni.nameOf(e)) : arr(p.sheet && p.sheet.conditions).slice(0, 20) };
    }).filter(Boolean);
  }

  // TileSet usati da TileMap, strutture e oggetti (le definizioni servono al giocatore per disegnare le tile).
  function tilesetUsati(griglia, tutti) {
    const ids = new Set();
    const da = (tiles) => { for (const id of arr(tiles && tiles.tilesets)) ids.add(id); };
    da(griglia.tileMap);
    for (const e of griglia.structures.concat(griglia.items)) da(e.tiles);
    return arr(tutti).filter((t) => ids.has(t.id)).map(clone);
  }
  // Impronte delle immagini di una vista (sfondo, sorgenti dei TileSet, icone).
  function immaginiDi(vista) {
    const ids = new Set();
    const c = vista.combattimento;
    if (c) {
      if (c.griglia.background && c.griglia.background.imageId) ids.add(c.griglia.background.imageId);
      for (const t of c.tilesets) for (const s of arr(t.sources)) if (s.imageId) ids.add(s.imageId);
      for (const p of c.pedine) if (p.icona && p.icona.imageId) ids.add(p.icona.imageId);
    }
    return [...ids];
  }

  // Vista di un giocatore. opts: { giocatoreId, personaggioId, pfNemici, master (nome) }.
  // Restituisce { vista, immagini: Map impronta -> data URL delle icone (le altre sono nell'archivio delle immagini) }.
  function istantanea(st, opts) {
    const o = opts || {};
    const raccolta = new Map();
    const sess = DnD.sessioni.current(st);
    const c = sess && sess.combat;
    const pers = o.personaggioId ? arr(st.players).find((p) => p.id === o.personaggioId) || null : null;
    const mio = c && pers ? c.combatants.find((x) => x.sourceId === pers.id && x.kind === 'player') || null : null;
    const vista = { master: o.master || 'Master', combattimento: null, scheda: scheda(pers, st, mio), io: { giocatoreId: o.giocatoreId || '', combattenteId: mio ? mio.id : '', personaggioId: pers ? pers.id : '' },
      regole: o.regole || null, altri: altri(st, c, pers, o) };
    if (!c) return { vista, immagini: raccolta };
    const tsIndex = DnD.tilemap.tilesetIndex(st.tilesets);
    const vg = DnD.visione.visioneGiocatore({ grid: c.grid, combatants: c.combatants }, { tilesets: tsIndex });
    const fogOn = Boolean(c.grid.fog && c.grid.fog.enabled);
    const visti = new Set(vg.combatants.map((x) => x.id));
    // Pedine: party sempre; le altre se la griglia le mostra o, senza nebbia, se non sono nascoste e non piazzate.
    const mostrati = c.combatants.filter((x) => delParty(x) || visti.has(x.id) || (!x.pos && !x.hidden && !fogOn));
    const ids = new Set(mostrati.map((x) => x.id));
    const nomi = {
      nascosti: c.combatants.filter((x) => !ids.has(x.id)).map((x) => x.name),
      nemici: new Map(mostrati.filter((x) => !delParty(x)).map((x) => [x.name, x.maxHp])),
    };
    const opzPedina = { pfNemici: Boolean(o.pfNemici), combattenteId: mio ? mio.id : '', regole: o.regole, piedi: c.grid.feetPerCell || 5, economia: o.economia };
    const griglia = Object.assign({}, vg);
    delete griglia.combatants;
    for (const e of griglia.structures.concat(griglia.items)) { delete e.sourceId; delete e.hidden; }
    const ordine = DnD.regole.sortByInitiative(mostrati);
    vista.combattimento = {
      fase: c.phase, round: c.round, turno: ids.has(c.currentId) ? c.currentId : null,
      pedine: ordine.map((x) => pedina(x, opzPedina, raccolta)),
      log: c.log.map((e) => rigaLog(e, nomi, o)).filter(Boolean).slice(-LOG_MAX),
      // Boss: solo quelli rivelati, con la salute a parole (o i PF con l'opzione del master).
      boss: c.combatants.filter((x) => x.boss && x.boss.revealed && ids.has(x.id)).map((x) => Object.assign({ id: x.id, nome: x.name, titolo: x.boss.title || '', tema: x.boss.theme || '', fase: (x.boss.phase || 0) + 1, salute: salute(x.hp, x.maxHp) },
        o.pfNemici ? { pf: x.hp, pfMax: x.maxHp } : {})),
      griglia,
      tilesets: tilesetUsati(griglia, st.tilesets),
    };
    vista.immagini = immaginiDi(vista);
    return { vista, immagini: raccolta };
  }

  // ---------- Eventi incrementali ----------
  const uguale = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const senzaCelle = (g) => Object.assign({}, g, { cells: '' });
  // Cambi da «prima» a «dopo» (stesse regole del filtro: lavora su viste già filtrate). null = serve l'istantanea.
  function differenze(prima, dopo) {
    if (!prima || Boolean(prima.combattimento) !== Boolean(dopo.combattimento)) return null;
    const cambi = [];
    if (!uguale(prima.scheda, dopo.scheda)) cambi.push({ op: 'scheda', scheda: dopo.scheda });
    if (!uguale(prima.io, dopo.io)) cambi.push({ op: 'io', io: dopo.io });
    if (!uguale(prima.altri, dopo.altri)) cambi.push({ op: 'altri', altri: dopo.altri });
    if (!uguale(prima.regole, dopo.regole)) cambi.push({ op: 'regole', regole: dopo.regole });
    const a = prima.combattimento;
    const b = dopo.combattimento;
    if (b) {
      const vecchie = new Map(a.pedine.map((p) => [p.id, p]));
      for (const p of b.pedine) if (!uguale(vecchie.get(p.id), p)) cambi.push({ op: 'pedina', pedina: p });
      const nuove = new Set(b.pedine.map((p) => p.id));
      for (const p of a.pedine) if (!nuove.has(p.id)) cambi.push({ op: 'via', id: p.id });
      const ordine = b.pedine.map((p) => p.id);
      if (a.fase !== b.fase || a.round !== b.round || a.turno !== b.turno || !uguale(a.pedine.map((p) => p.id), ordine)) {
        cambi.push({ op: 'turno', fase: b.fase, round: b.round, turno: b.turno, ordine });
      }
      // Log: righe aggiunte in coda; se la coda non combacia (log accorciato o ripulito) si manda tutto.
      const la = a.log.map((r) => JSON.stringify(r));
      const lb = b.log.map((r) => JSON.stringify(r));
      const coda = (k) => la.slice(k).every((r, i) => r === lb[i]);
      let k = 0;
      while (k < la.length && !coda(k)) k++;
      if (k < la.length || !la.length) {
        const nuove = b.log.slice(la.length - k);
        if (nuove.length) cambi.push({ op: 'log', righe: nuove });
      } else cambi.push({ op: 'logTutto', righe: b.log });
      if (!uguale(a.boss, b.boss)) cambi.push({ op: 'boss', boss: b.boss });
      if (a.griglia.cells !== b.griglia.cells) cambi.push({ op: 'nebbia', celle: b.griglia.cells });
      if (!uguale(senzaCelle(a.griglia), senzaCelle(b.griglia)) || !uguale(a.tilesets, b.tilesets)) cambi.push({ op: 'griglia', griglia: senzaCelle(b.griglia), tilesets: b.tilesets });
      if (!uguale(prima.immagini, dopo.immagini)) cambi.push({ op: 'immagini', ids: dopo.immagini });
    }
    return cambi;
  }

  // Applica i cambi a una vista del giocatore (restituisce una nuova vista). Lancia un errore se un cambio non ha senso.
  function applica(vista, cambi) {
    const v = clone(vista);
    const c = v.combattimento;
    const serve = () => { if (!c) throw new Error('evento senza combattimento'); };
    for (const x of cambi) {
      if (x.op === 'scheda') v.scheda = x.scheda || null;
      else if (x.op === 'io') v.io = obj(x.io);
      else if (x.op === 'altri') v.altri = arr(x.altri);
      else if (x.op === 'regole') v.regole = x.regole || null;
      else if (x.op === 'pedina') {
        serve();
        const p = obj(x.pedina);
        const i = c.pedine.findIndex((y) => y.id === p.id);
        if (i >= 0) c.pedine[i] = p; else c.pedine.push(p);
      } else if (x.op === 'via') { serve(); c.pedine = c.pedine.filter((p) => p.id !== x.id); }
      else if (x.op === 'turno') {
        serve();
        Object.assign(c, { fase: x.fase, round: x.round, turno: x.turno });
        const pos = new Map(arr(x.ordine).map((id, i) => [id, i]));
        c.pedine.sort((p, q) => (pos.has(p.id) ? pos.get(p.id) : 1e9) - (pos.has(q.id) ? pos.get(q.id) : 1e9));
      } else if (x.op === 'log') { serve(); c.log = c.log.concat(arr(x.righe)).slice(-LOG_MAX); }
      else if (x.op === 'logTutto') { serve(); c.log = arr(x.righe).slice(-LOG_MAX); }
      else if (x.op === 'boss') { serve(); c.boss = arr(x.boss); }
      else if (x.op === 'nebbia') { serve(); c.griglia.cells = String(x.celle || ''); }
      else if (x.op === 'griglia') { serve(); c.griglia = Object.assign(obj(x.griglia), { cells: c.griglia.cells }); c.tilesets = arr(x.tilesets); }
      else if (x.op === 'immagini') v.immagini = arr(x.ids);
      else throw new Error('cambio sconosciuto: ' + x.op);
    }
    return v;
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.filtro = { SALUTE, salute, rigaLog, scheda, istantanea, immaginiDi, differenze, applica };
})(globalThis.DnD = globalThis.DnD || {});
