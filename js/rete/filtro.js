// Filtro del gioco online (sul master): ciò che non deve vedersi non viene mai inviato. Costruisce la «vista» di un
// giocatore dallo stato del master (istantanea), le differenze tra due viste (eventi incrementali) e la loro
// applicazione sul giocatore. Mai inviati: note del master, combattenti e oggetti nascosti, eventi non visibili,
// boss non rivelati, contenuti di forzieri e trappole, tiri segreti, piano dell'IA, PF esatti dei nemici
// (salvo l'opzione del master). La griglia passa da DnD.visione.visioneGiocatore (nebbia e linea di vista).
// Tappa 3: un solo punto per il filtro. statoPerGiocatore() e eventoPerGiocatore() fanno passare tutto da una lista
// di campi ammessi (whitelist): un campo nuovo non parte finché non viene ammesso qui; quelli sconosciuti si scartano
// con un avviso in console (solo sul master). Sezioni: combattimento, esplorazione, scene rivelate, Mondo.
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
      // Grafica calcolata dal client: solo la chiave del tema (boss rivelato o leggendario), mai soglie o fasi future.
      tema: c.boss && c.boss.revealed ? String(c.boss.theme || '') : c.legend ? 'lg:' + String((c.legend.form && c.legend.form.theme) || c.legend.theme || '') : '',
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
      // Percorso e trasformazione leggendaria: solo al proprietario.
      leggenda: x.legend ? { tema: String(x.legend.theme || ''), rango: x.legend.rank === undefined ? null : x.legend.rank, forma: x.legend.form ? String(x.legend.form.name || '') : '',
        trasformazioni: arr(x.legend.transformations).map((t) => String((t && t.name) || '')).filter(Boolean).slice(0, 20) } : null,
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
      const d = DnD.combattenti.derivedStats(p, race, st.equipment);
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
  // ---------- Sezioni della tappa 3 ----------
  // Griglia con gli NPC piazzati sotto il nome rivelato (altrimenti «Sconosciuto»).
  function grigliaNpcRivelati(grid) {
    if (!arr(grid.items).some((it) => it.otype === 'npc')) return grid;
    return Object.assign({}, grid, { items: grid.items.map((it) => (it.otype === 'npc' && !(it.npcState && it.npcState.revealed && it.npcState.revealed.name !== false)
      ? Object.assign({}, it, { name: 'Sconosciuto' }) : it)) });
  }
  const testoPulito = (t, max) => String(t || '').replace(/\s*Nota del master:.*$/s, '').trim().slice(0, max || 400);

  // Combattenti che il giocatore vede e nomi per ripulire i testi (non visti; nemici visti con i PF massimi).
  function visibili(st, c) {
    const tsIndex = DnD.tilemap.tilesetIndex(st.tilesets);
    const vg = DnD.visione.visioneGiocatore({ grid: grigliaNpcRivelati(c.grid), combatants: c.combatants }, { tilesets: tsIndex });
    const fogOn = Boolean(c.grid.fog && c.grid.fog.enabled);
    const visti = new Set(vg.combatants.map((x) => x.id));
    // Pedine: party sempre; le altre se la griglia le mostra o, senza nebbia, se non sono nascoste e non piazzate.
    const mostrati = c.combatants.filter((x) => delParty(x) || visti.has(x.id) || (!x.pos && !x.hidden && !fogOn));
    const ids = new Set(mostrati.map((x) => x.id));
    const nomi = {
      nascosti: c.combatants.filter((x) => !ids.has(x.id)).map((x) => x.name),
      nemici: new Map(mostrati.filter((x) => !delParty(x)).map((x) => [x.name, x.maxHp])),
    };
    return { vg, mostrati, ids, nomi };
  }

  /**
   * Testo dell'esito di un'intenzione (di solito l'ultima riga del registro del master), ripulito come le righe del log:
   * PF dei nemici a parole (salvo opts.pfNemici), niente combattenti non visti né note del master.
   * @param {object} st stato del master  @param {string} testo  @param {{pfNemici?: boolean}} opts
   * @returns {string} testo per il giocatore ('Fatto.' se la riga non può partire)
   */
  function testoEsito(st, testo, opts) {
    const sess = DnD.sessioni.current(st);
    const c = sess && sess.combat;
    if (!c) return testoPulito(testo);
    const r = rigaLog({ type: 'esito', text: testo }, visibili(st, c).nomi, opts || {});
    return r ? r.testo : 'Fatto.';
  }

  function combattimento(st, c, o, mio, raccolta) {
    const { vg, mostrati, ids, nomi } = visibili(st, c);
    const opzPedina = { pfNemici: Boolean(o.pfNemici), combattenteId: mio ? mio.id : '', regole: o.regole, piedi: c.grid.feetPerCell || 5, economia: o.economia };
    const griglia = Object.assign({}, vg);
    delete griglia.combatants;
    const ordine = DnD.regole.sortByInitiative(mostrati);
    return {
      fase: c.phase, round: c.round, turno: ids.has(c.currentId) ? c.currentId : null,
      pedine: ordine.map((x) => pedina(x, opzPedina, raccolta)),
      log: c.log.map((e) => rigaLog(e, nomi, o)).filter(Boolean).slice(-LOG_MAX),
      // Boss: solo quelli rivelati, con la salute a parole (o i PF con l'opzione del master); azioni leggendarie solo
      // per nome e punti rimasti, mai soglie, fasi future o azioni di tana.
      boss: c.combatants.filter((x) => x.boss && x.boss.revealed && ids.has(x.id)).map((x) => {
        const cr = x.creature || {};
        const lp = obj(cr.legendaryPoints);
        return Object.assign({ id: x.id, nome: x.name, titolo: x.boss.title || '', tema: x.boss.theme || '', fase: (x.boss.phase || 0) + 1, salute: salute(x.hp, x.maxHp),
          leggendarie: arr(cr.legendary).map((a) => ({ nome: String((a && a.name) || '') })).filter((a) => a.nome).slice(0, 12),
          puntiLeggendari: Number.isFinite(lp.left) ? lp.left : null }, o.pfNemici ? { pf: x.hp, pfMax: x.maxHp } : {});
      }),
      griglia,
      tilesets: tilesetUsati(griglia, st.tilesets),
    };
  }

  // Esplorazione: solo celle scoperte (nebbia di scoperta), gruppi, tempo, meteo, bioma corrente ed eventi già scattati.
  function esplorazione(st, sess, raccolta) {
    const ex = sess && sess.exploration;
    const grid = ex && ex.gridId ? arr(st.savedGrids).find((g) => g.id === ex.gridId) : null;
    if (!grid) return null;
    const E = DnD.esplorazione;
    const w = { st, ex, grid };
    let vis;
    try { vis = E.discoveryView(w); } catch (e) { vis = undefined; }
    const gruppi = arr(ex.parties).map((p) => ({ id: p.id, name: p.name, icon: p.icon, pos: p.pos, kind: 'player', faction: 'giocatori', w: 1, h: 1 }));
    const vg = DnD.visione.visioneGiocatore({ grid: grigliaNpcRivelati(grid), combatants: gruppi }, { tilesets: DnD.tilemap.tilesetIndex(st.tilesets), visible: vis, seenIds: new Set() });
    const griglia = Object.assign({}, vg);
    delete griglia.combatants;
    const att = E.activeParty(ex);
    let b = null;
    try { b = att ? E.biomeAt(w, att.pos.x, att.pos.y) : null; } catch (e) { b = null; }
    return {
      griglia, tilesets: tilesetUsati(griglia, st.tilesets),
      gruppi: arr(ex.parties).map((p) => ({ id: p.id, nome: p.name, icona: icona(p.icon, raccolta), pos: { x: p.pos.x, y: p.pos.y }, attivo: p === att })),
      tempo: { giorno: ex.time.day, ora: ex.time.hour },
      meteo: ex.weather ? { nome: ex.weather.name } : null,
      bioma: b ? { nome: b.name, icona: typeof b.icon === 'string' ? b.icon : '', colore: typeof b.color === 'string' ? b.color : '' } : null,
      eventi: arr(ex.log).filter((e) => e.kind === 'evento').slice(-30).map((e) => ({ giorno: e.day, ora: e.hour, luogo: String(e.place || ''), testo: testoPulito(e.text) })).filter((e) => e.testo),
    };
  }

  // Scene: solo quelle rivelate dal master, con il testo da leggere ridotto a testo semplice.
  function scene(st, sess) {
    if (!DnD.scene || !sess) return [];
    return DnD.scene.sessionScenes(st, sess.id).filter((x) => x.revealed).map((x) => {
      const v = DnD.scene.statoScenaPerGiocatore(x);
      return { id: v.id, titolo: v.title, tipo: v.kind, stato: v.status, testo: DnD.note.htmlToText(v.readAloud || '').trim().slice(0, 5000) };
    });
  }

  // Contesto dei prezzi di un mercante (reputazione del party con la sua fazione, atteggiamento, catalogo): lo stesso
  // per la vista e per la convalida degli scambi.
  function contestoPrezzi(st, sess, def, stato) {
    const v = DnD.fazioni.view(st, sess.id);
    const party = DnD.party.active(v.parties, v.world);
    return { rep: party && def.factionId ? party.reputation[def.factionId] || 0 : 0, attitude: stato.attitude || def.attitude, catalog: st.equipment };
  }
  // Oggetto di mappa (copia di un NPC) cercato sulle griglie della sessione: combattimento, poi griglie salvate.
  function npcPiazzato(st, sess, itemId) {
    const grids = [sess.combat && sess.combat.grid].concat(arr(st.savedGrids)).filter(Boolean);
    for (const g of grids) { const it = arr(g.items).find((x) => x.id === itemId && x.otype === 'npc'); if (it) return { grid: g, item: it }; }
    return null;
  }
  // Merce in vendita vista dal giocatore: righe sbloccate e disponibili, con il prezzo calcolato dal master.
  function negozio(st, sess, def, stato) {
    const ctx = contestoPrezzi(st, sess, def, stato);
    return DnD.npc.offer(def, stato, ctx).filter((r) => !r.missing && !r.locked && r.line.qty > 0 && r.line.minRep === null)
      .map((r) => ({ lineId: r.line.id, nome: r.equipment.name, qty: r.line.qty, prezzo: r.price, testoPrezzo: DnD.npc.formatCopper(r.price) }));
  }

  // Mondo: città visitate, NPC incontrati, quest accettate, fazioni conosciute, reputazioni solo se rivelate.
  // o.rivelati: { citta, npc, fazioni, negozi } (id), o.incontrati: Set degli id degli NPC piazzati già visti.
  function mondo(st, sess, o, raccolta, npcVisti) {
    if (!sess || !sess.world || !DnD.fazioni || !DnD.npc) return null;
    const v = DnD.fazioni.view(st, sess.id);
    const riv = obj(o.rivelati);
    const lista = (k) => new Set(arr(riv[k]));
    const incontrati = o.incontrati instanceof Set ? o.incontrati : new Set();
    for (const id of npcVisti) incontrati.add(id);
    for (const id of lista('npc')) incontrati.add(id);
    const negozi = lista('negozi');
    const quest = DnD.quest.perGiocatore(v.quests, v.world.quests || {});
    const offerte = quest.map((q) => q.id);
    const npc = [];
    const fazioni = lista('fazioni');
    for (const id of incontrati) {
      const p = npcPiazzato(st, sess, id);
      const def = p && v.npcs.find((n) => n.id === p.item.npcId);
      if (!def || p.item.hidden) continue;
      const stato = DnD.npc.normalizeState(p.item.npcState, def);
      const pv = DnD.npc.statoNpcPerGiocatore(def, stato, { shopOpen: negozi.has(id), offeredQuestIds: offerte });
      if (pv.roles.length && def.factionId) fazioni.add(def.factionId);
      npc.push({ id, nome: pv.name, icona: icona(pv.icon, raccolta), ruoli: pv.roles.slice(), atteggiamento: pv.attitude || '', stato: pv.status,
        negozio: pv.shop.length ? negozio(st, sess, def, stato) : [] });
    }
    const citta = v.cities.filter((x) => lista('citta').has(x.id) || (sess.exploration && x.gridId && x.gridId === sess.exploration.gridId));
    for (const x of citta) if (x.factionId) fazioni.add(x.factionId);
    for (const q of v.quests) if (offerte.includes(q.id) && q.factionId) fazioni.add(q.factionId);
    const note = v.factions.filter((f) => fazioni.has(f.id) && !f.builtin);
    const party = DnD.party.active(v.parties, v.world);
    return {
      citta: citta.map((x) => ({ id: x.id, nome: x.name, icona: typeof x.icon === 'string' ? x.icon : '' })),
      npc,
      quest: quest.map((q) => ({ id: q.id, titolo: q.title, descrizione: String(q.description || '').slice(0, 2000), stato: q.status,
        obiettivi: q.objectives.map((x) => ({ testo: x.text, fatto: Boolean(x.done), progresso: x.progress, quanti: x.count })) })),
      fazioni: note.map((f) => ({ id: f.id, nome: f.name, colore: f.color || '' })),
      reputazioni: o.mostraReputazioni && party ? note.map((f) => ({ fazioneId: f.id, valore: party.reputation[f.id] || 0 })) : [],
    };
  }

  // Impronte delle immagini di una vista (sfondi, sorgenti dei TileSet, icone).
  function immaginiDi(vista) {
    const ids = new Set();
    const griglia = (g, ts) => {
      if (g.background && g.background.imageId) ids.add(g.background.imageId);
      for (const t of ts) for (const s of arr(t.sources)) if (s.imageId) ids.add(s.imageId);
    };
    const ic = (i) => { if (i && i.imageId) ids.add(i.imageId); };
    const c = vista.combattimento;
    if (c) { griglia(c.griglia, c.tilesets); for (const p of c.pedine) ic(p.icona); }
    const e = vista.esplorazione;
    if (e) { griglia(e.griglia, e.tilesets); for (const p of e.gruppi) ic(p.icona); }
    if (vista.mondo) for (const n of vista.mondo.npc) ic(n.icona);
    return [...ids];
  }

  // Vista di un giocatore. opts: { giocatoreId, personaggioId, pfNemici, master (nome), spettatore, schedeAltri,
  //   mostraReputazioni, rivelati, incontrati, regole, economia }.
  // Restituisce { vista, immagini: Map impronta -> data URL delle icone (le altre sono nell'archivio delle immagini) }.
  // Non passa dalla whitelist: chi invia usa statoPerGiocatore.
  function istantanea(st, opts) {
    const o = opts || {};
    const raccolta = new Map();
    const sess = DnD.sessioni.current(st);
    const c = sess && sess.combat;
    const pers = o.personaggioId ? arr(st.players).find((p) => p.id === o.personaggioId) || null : null;
    const mio = c && pers ? c.combatants.find((x) => x.sourceId === pers.id && x.kind === 'player') || null : null;
    const vista = { master: o.master || 'Master', combattimento: null, esplorazione: null, scene: scene(st, sess), mondo: null, scheda: scheda(pers, st, mio),
      io: { giocatoreId: o.giocatoreId || '', combattenteId: mio ? mio.id : '', personaggioId: pers ? pers.id : '', spettatore: Boolean(o.spettatore) },
      regole: o.regole || null, altri: altri(st, c, pers, o) };
    if (c) vista.combattimento = combattimento(st, c, o, mio, raccolta);
    try { vista.esplorazione = esplorazione(st, sess, raccolta); } catch (e) { vista.esplorazione = null; }
    const npcVisti = [];
    for (const g of [vista.combattimento, vista.esplorazione]) if (g) for (const it of g.griglia.items) if (it.otype === 'npc') npcVisti.push(it.id);
    try { vista.mondo = mondo(st, sess, o, raccolta, npcVisti); } catch (e) { vista.mondo = null; }
    // Spettatore: sola vista, senza azioni proprie.
    if (o.spettatore && vista.combattimento) for (const p of vista.combattimento.pedine) { delete p.proprie; p.mia = false; }
    vista.immagini = immaginiDi(vista);
    return { vista, immagini: raccolta };
  }

  // ---------- Whitelist ----------
  // Schemi: 's' testo, 'n' numero, 'b' vero/falso, 'p' valore semplice, 'celle' stringa di 0/1/2, 'dati' dati di
  // disegno (tile, TileSet, regole: solo valori semplici, senza le chiavi private), { o: campi } oggetto, { l: schema } elenco.
  const o_ = (campi) => ({ o: campi });
  const l_ = (s, max) => ({ l: s, max: max || 10000 });
  // Chiavi private note: si scartano in silenzio (i campi davvero sconosciuti invece producono un avviso).
  const PRIVATI = new Set(['notes', 'note', 'hidden', 'sourceId', 'npcId', 'npcState', 'lock', 'trap', 'contents', 'coins', 'description', 'revealed',
    'why', 'plan', 'tactics', 'secret', 'hiddenRole', 'thresholds', 'phases', 'lair', 'dialog', 'stock', 'merchant', 'hp', 'maxHp', 'ai', 'readAloud']);
  const ICONA = o_({ kind: 's', shape: 's', icon: 's', color: 's', imageId: 's' });
  const XY = o_({ x: 'n', y: 'n' });
  const LUCE = o_({ on: 'b', bright: 'n', dim: 'n', color: 's', flicker: 'p' });
  const COND = o_({ nome: 's', icona: 'p', colore: 'p' });
  const PROPRIE = o_({
    armi: l_(o_({ id: 's', nome: 's', testo: 's' })),
    magie: o_({ cd: 'p', attacco: 'p', slotsTotali: l_('n'), slotsUsati: l_('n'),
      lista: l_(o_({ id: 's', nome: 's', livello: 'n', effetto: 's', gittata: 's', tempo: 's', area: 'b', concentrazione: 'b', innato: o_({ freq: 'p', rimasti: 'p' }) })) }),
    creatura: l_(o_({ id: 's', nome: 's' })),
    movimento: o_({ residuo: 'p', velocita: 'p', spostato: 'b', scatti: 'p' }),
    prono: 'b', blocco: 's', economia: o_({ azione: 'p', attacchi: 'p', bonus: 'p', reazione: 'p' }),
    leggenda: o_({ tema: 's', rango: 'p', forma: 's', trasformazioni: l_('s') }),
  });
  const PEDINA = o_({ id: 's', nome: 's', icona: ICONA, pos: XY, w: 'n', h: 'n', lato: 's', fazione: 's', iniziativa: 'p', salute: 's', aTerra: 'b', morto: 'b',
    condizioni: l_(COND), concentrazione: 's', mia: 'b', tema: 's', pf: 'n', pfMax: 'n', pfTemp: 'n', morte: o_({ successi: 'n', fallimenti: 'n', stabile: 'b' }), proprie: PROPRIE });
  const LOG = o_({ round: 'p', tipo: 's', testo: 's' });
  const BOSS = o_({ id: 's', nome: 's', titolo: 's', tema: 's', fase: 'n', salute: 's', pf: 'n', pfMax: 'n', leggendarie: l_(o_({ nome: 's' })), puntiLeggendari: 'p' });
  const FORMA = { id: 's', name: 's', color: 's', x: 'n', y: 'n', w: 'n', h: 'n', cells: 's', tiles: 'dati', blocksSight: 'b', light: LUCE };
  const STRUTTURA = o_(Object.assign({ mode: 's', shapeMode: 's', preset: 's' }, FORMA));
  const OGGETTO = o_(Object.assign({ icon: ICONA, mode: 's', otype: 's', container: 'b', interactive: 'b', blocks: 'b', state: 's' }, FORMA));
  const GRIGLIA = o_({
    w: 'n', h: 'n', feetPerCell: 'n', kind: 's', cells: 'celle', tileMap: 'dati',
    background: o_({ kind: 's', color: 's', imageId: 'p', imageW: 'n', imageH: 'n', fit: 's', x: 'n', y: 'n', scale: 'n', opacity: 'n', pxPerCell: 'n' }),
    structures: l_(STRUTTURA), items: l_(OGGETTO), labels: l_(o_({ id: 's', text: 's', x: 'n', y: 'n' })),
    events: l_(o_({ id: 's', name: 's', icon: ICONA, cells: l_(XY) })), ghosts: l_(XY),
  });
  const SCHEDA = o_({
    nome: 's', livello: 'n', razza: 's', classe: 's', ca: 'p', pf: 'p', pfMax: 'p', pfTemp: 'p', iniziativa: 'p', velocita: 'p', competenza: 'p', percezione: 'p', dadiVita: 'p',
    caratteristiche: l_(o_({ nome: 's', valore: 'n', mod: 'n', ts: 'n', competente: 'b' })), condizioni: l_('s'),
    slot: l_(o_({ livello: 'n', totali: 'n', usati: 'n' })), monete: o_({ mr: 'n', ma: 'n', me: 'n', mo: 'n', mp: 'n' }),
    inventario: l_(o_({ indice: 'n', nome: 's', qty: 'n', equipaggiato: 'b' })),
  });
  const COMBATTIMENTO = o_({ fase: 's', round: 'p', turno: 'p', pedine: l_(PEDINA), log: l_(LOG), boss: l_(BOSS), griglia: GRIGLIA, tilesets: l_('dati') });
  const ESPLORAZIONE = o_({
    griglia: GRIGLIA, tilesets: l_('dati'), gruppi: l_(o_({ id: 's', nome: 's', icona: ICONA, pos: XY, attivo: 'b' })),
    tempo: o_({ giorno: 'n', ora: 'n' }), meteo: o_({ nome: 's' }), bioma: o_({ nome: 's', icona: 's', colore: 's' }),
    eventi: l_(o_({ giorno: 'n', ora: 'n', luogo: 's', testo: 's' })),
  });
  const SCENA = o_({ id: 's', titolo: 's', tipo: 's', stato: 's', testo: 's' });
  const MONDO = o_({
    citta: l_(o_({ id: 's', nome: 's', icona: 's' })),
    npc: l_(o_({ id: 's', nome: 's', icona: ICONA, ruoli: l_('s'), atteggiamento: 's', stato: 's', negozio: l_(o_({ lineId: 's', nome: 's', qty: 'n', prezzo: 'n', testoPrezzo: 's' })) })),
    quest: l_(o_({ id: 's', titolo: 's', descrizione: 's', stato: 's', obiettivi: l_(o_({ testo: 's', fatto: 'b', progresso: 'n', quanti: 'n' })) })),
    fazioni: l_(o_({ id: 's', nome: 's', colore: 's' })), reputazioni: l_(o_({ fazioneId: 's', valore: 'n' })),
  });
  const ALTRO = o_({ id: 's', nome: 's', classe: 's', livello: 'n', salute: 's', ca: 'p', condizioni: l_('s') });
  const IO = o_({ giocatoreId: 's', combattenteId: 's', personaggioId: 's', spettatore: 'b' });
  const VISTA = o_({
    master: 's', combattimento: COMBATTIMENTO, esplorazione: ESPLORAZIONE, scene: l_(SCENA), mondo: MONDO, scheda: SCHEDA,
    io: IO, regole: 'dati', altri: l_(ALTRO), immagini: l_('s'),
  });
  // Campi di ogni cambio incrementale.
  const CELLE = l_(l_('n', 2), 20000);
  const OPS = {
    scheda: { scheda: SCHEDA }, io: { io: IO }, altri: { altri: l_(ALTRO) }, regole: { regole: 'dati' }, pedina: { pedina: PEDINA }, via: { id: 's' },
    turno: { fase: 's', round: 'p', turno: 'p', ordine: l_('s') }, log: { righe: l_(LOG) }, logTutto: { righe: l_(LOG) }, boss: { boss: l_(BOSS) },
    nebbia: { celle: 'celle' }, celle: { d: CELLE }, griglia: { griglia: GRIGLIA, tilesets: l_('dati') }, immagini: { ids: l_('s') },
    esplorazione: { esplorazione: ESPLORAZIONE }, nebbiaEsp: { celle: 'celle' }, celleEsp: { d: CELLE },
    scene: { scene: l_(SCENA) }, mondo: { mondo: MONDO },
  };

  const SCARTA = Symbol('scarta');
  // Copia di dati di disegno: solo valori semplici, elenchi e oggetti, senza chiavi private; profondità limitata.
  function dati(v, prof) {
    if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (prof > 8) return null;
    if (Array.isArray(v)) return v.map((x) => dati(x, prof + 1));
    if (typeof v !== 'object') return null;
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!PRIVATI.has(k)) out[k] = dati(x, prof + 1);
    return out;
  }
  // Valore filtrato con lo schema (o SCARTA). avvisi: percorsi dei campi sconosciuti scartati.
  function ammetti(v, sc, via, avvisi) {
    if (v === null || v === undefined) return null;
    if (sc === 's') return typeof v === 'string' ? v : SCARTA;
    if (sc === 'n') return typeof v === 'number' && Number.isFinite(v) ? v : SCARTA;
    if (sc === 'b') return typeof v === 'boolean' ? v : SCARTA;
    if (sc === 'p') return ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v)) ? v : SCARTA;
    if (sc === 'celle') return typeof v === 'string' && /^[0-2]*$/.test(v) ? v : SCARTA;
    if (sc === 'dati') return dati(v, 0);
    if (sc.l) {
      if (!Array.isArray(v)) return SCARTA;
      return v.slice(0, sc.max).map((x, i) => ammetti(x, sc.l, via + '[' + i + ']', avvisi)).filter((x) => x !== SCARTA);
    }
    if (typeof v !== 'object' || Array.isArray(v)) return SCARTA;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (!Object.prototype.hasOwnProperty.call(sc.o, k)) { if (!PRIVATI.has(k)) avvisi.push(via + '.' + k); continue; }
      const r = ammetti(x, sc.o[k], via + '.' + k, avvisi);
      if (r !== SCARTA) out[k] = r;
    }
    return out;
  }
  // Avviso in console (solo sul master), una volta per campo.
  const avvisati = new Set();
  function avvisa(avvisi, opts) {
    if (!avvisi.length || (opts && opts.silenzioso)) return;
    const nuovi = [...new Set(avvisi.map((p) => p.replace(/\[\d+\]/g, '[]')))].filter((p) => !avvisati.has(p));
    if (!nuovi.length) return;
    for (const p of nuovi) avvisati.add(p);
    if (typeof console !== 'undefined') console.warn('[Online] Campi non ammessi dal filtro, scartati: ' + nuovi.join(', '));
  }

  // ---------- Punto unico del filtro ----------
  // Stato per un giocatore: istantanea + whitelist. Restituisce { vista, immagini, scartati }.
  function statoPerGiocatore(st, giocatoreId, opts) {
    const r = istantanea(st, Object.assign({}, opts, { giocatoreId }));
    const avvisi = [];
    const vista = ammetti(r.vista, VISTA, 'vista', avvisi);
    avvisa(avvisi, opts);
    return { vista, immagini: r.immagini, scartati: avvisi };
  }
  // Evento incrementale per un giocatore: ogni cambio passa dalla whitelist della sua operazione.
  function eventoPerGiocatore(evento, giocatoreId, opts) {
    const avvisi = [];
    const cambi = arr(evento && evento.cambi).map((c, i) => {
      const campi = c && OPS[c.op];
      if (!campi) { avvisi.push('evento.' + (c && c.op)); return null; }
      const r = ammetti(c, o_(Object.assign({ op: 's' }, campi)), 'evento[' + i + ']', avvisi);
      return r === SCARTA ? null : r;
    }).filter(Boolean);
    avvisa(avvisi, opts);
    return { n: evento.n, cambi };
  }
  // Interfacce delle sezioni, ora qui dentro: chi invia passa sempre da statoPerGiocatore.
  const statoNpcPerGiocatore = (npc, stato, opts) => DnD.npc.statoNpcPerGiocatore(npc, stato, opts);
  const statoScenaPerGiocatore = (scena) => DnD.scene.statoScenaPerGiocatore(scena);
  const visioneGiocatore = (doc, opts) => DnD.visione.visioneGiocatore(doc, opts);

  // ---------- «Vedi come giocatore» ----------
  // Cosa NON riceve un giocatore, confrontando lo stato del master con la vista davvero inviata. [{ sezione, testo }].
  function nonRicevuto(st, vista) {
    const out = [];
    const add = (sezione, testo) => out.push({ sezione, testo });
    const sess = DnD.sessioni.current(st);
    if (!sess) return out;
    if (String(sess.notes || '').trim() || arr(sess.pages).length) add('Note', 'Note del master e pagine collegate');
    const c = sess.combat;
    const vc = vista && vista.combattimento;
    if (c && vc) {
      const ids = new Set(vc.pedine.map((p) => p.id));
      for (const x of c.combatants) if (!ids.has(x.id)) add('Combattimento', x.name + (x.hidden ? ' (nascosto)' : ' (fuori vista)'));
      for (const x of c.combatants) if (x.boss && !x.boss.revealed && ids.has(x.id)) add('Boss', x.name + ': boss non rivelato (titolo, fasi, soglie)');
      if (vc.pedine.some((p) => p.lato === 'nemico' && !('pf' in p))) add('Combattimento', 'PF esatti dei nemici (solo lo stato di salute)');
      const items = new Set(vc.griglia.items.map((i) => i.id));
      for (const it of arr(c.grid.items)) if (!items.has(it.id)) add('Mappa', it.name + (it.hidden ? ' (nascosto)' : ' (fuori vista)'));
      for (const it of arr(c.grid.items)) if (items.has(it.id) && ((it.trap && it.trap.enabled) || (it.lock && it.lock.locked) || arr(it.contents).length)) add('Mappa', it.name + ': contenuto, serratura o trappola');
      const coperte = (vc.griglia.cells.match(/0/g) || []).length;
      if (coperte) add('Nebbia', coperte + ' celle coperte');
      const righe = c.log.length - vc.log.length;
      if (righe > 0) add('Registro', righe + ' righe del registro (IA, modifiche, nascosti)');
      if (arr(c.grid.vision && c.grid.vision.lights).length) add('Luce', 'Sorgenti di luce piazzate dal master');
    }
    const ve = vista && vista.esplorazione;
    if (ve) { const coperte = (ve.griglia.cells.match(/0/g) || []).length; if (coperte) add('Esplorazione', coperte + ' celle non scoperte'); }
    if (DnD.scene) for (const s of DnD.scene.sessionScenes(st, sess.id)) if (!s.revealed) add('Scene', '«' + s.title + '» (non rivelata)');
    if (sess.world && DnD.fazioni) {
      const v = DnD.fazioni.view(st, sess.id);
      const m = (vista && vista.mondo) || {};
      const q = new Set(arr(m.quest).map((x) => x.id));
      for (const x of v.quests) if (!q.has(x.id)) add('Quest', '«' + x.title + '» (non offerta o non accettata)');
      const f = new Set(arr(m.fazioni).map((x) => x.id));
      for (const x of v.factions) if (!x.builtin && !f.has(x.id)) add('Fazioni', x.name + ' (sconosciuta al party)');
      if (!arr(m.reputazioni).length) add('Mondo', 'Reputazioni (non mostrate)');
      if (v.npcs.length) add('NPC', 'Atteggiamenti segreti, ruoli nascosti, dialoghi e note degli NPC');
    }
    return out;
  }

  // ---------- Eventi incrementali ----------
  const uguale = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const senzaCelle = (g) => Object.assign({}, g, { cells: '' });
  // Celle cambiate [[indice, valore]] o null se conviene mandarle tutte (dimensioni diverse o troppi cambi).
  function diffCelle(a, b) {
    if (typeof a !== 'string' || a.length !== b.length) return null;
    const d = [];
    for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) { d.push([i, Number(b[i])]); if (d.length > Math.max(64, b.length / 8)) return null; }
    return d;
  }
  function applicaCelle(s, d) {
    const a = String(s || '').split('');
    for (const x of arr(d)) {
      const [i, v] = arr(x);
      if (!Number.isInteger(i) || i < 0 || i >= a.length || ![0, 1, 2].includes(v)) throw new Error('cella non valida');
      a[i] = String(v);
    }
    return a.join('');
  }
  const opCelle = (a, b, intera, parziale) => {
    const d = diffCelle(a, b);
    return d ? { op: parziale, d } : { op: intera, celle: b };
  };
  // Cambi da «prima» a «dopo» (stesse regole del filtro: lavora su viste già filtrate). null = serve l'istantanea.
  function differenze(prima, dopo) {
    if (!prima || Boolean(prima.combattimento) !== Boolean(dopo.combattimento) || Boolean(prima.esplorazione) !== Boolean(dopo.esplorazione)) return null;
    const cambi = [];
    if (!uguale(prima.scheda, dopo.scheda)) cambi.push({ op: 'scheda', scheda: dopo.scheda });
    if (!uguale(prima.io, dopo.io)) cambi.push({ op: 'io', io: dopo.io });
    if (!uguale(prima.altri, dopo.altri)) cambi.push({ op: 'altri', altri: dopo.altri });
    if (!uguale(prima.regole, dopo.regole)) cambi.push({ op: 'regole', regole: dopo.regole });
    if (!uguale(prima.scene, dopo.scene)) cambi.push({ op: 'scene', scene: dopo.scene });
    if (!uguale(prima.mondo, dopo.mondo)) cambi.push({ op: 'mondo', mondo: dopo.mondo });
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
      // Nebbia: solo le celle cambiate (rivelate dopo un movimento), non l'intera maschera.
      if (a.griglia.cells !== b.griglia.cells) cambi.push(opCelle(a.griglia.cells, b.griglia.cells, 'nebbia', 'celle'));
      if (!uguale(senzaCelle(a.griglia), senzaCelle(b.griglia)) || !uguale(a.tilesets, b.tilesets)) cambi.push({ op: 'griglia', griglia: senzaCelle(b.griglia), tilesets: b.tilesets });
    }
    const ea = prima.esplorazione;
    const eb = dopo.esplorazione;
    if (eb) {
      const sc = (e) => Object.assign({}, e, { griglia: senzaCelle(e.griglia) });
      if (!uguale(sc(ea), sc(eb))) cambi.push({ op: 'esplorazione', esplorazione: sc(eb) });
      if (ea.griglia.cells !== eb.griglia.cells) cambi.push(opCelle(ea.griglia.cells, eb.griglia.cells, 'nebbiaEsp', 'celleEsp'));
    }
    if (!uguale(prima.immagini, dopo.immagini)) cambi.push({ op: 'immagini', ids: dopo.immagini });
    return cambi;
  }

  // Applica i cambi a una vista del giocatore (restituisce una nuova vista). Lancia un errore se un cambio non ha senso.
  function applica(vista, cambi) {
    const v = clone(vista);
    const c = v.combattimento;
    const serve = () => { if (!c) throw new Error('evento senza combattimento'); };
    const serveEsp = () => { if (!v.esplorazione) throw new Error('evento senza esplorazione'); };
    for (const x of cambi) {
      if (x.op === 'scheda') v.scheda = x.scheda || null;
      else if (x.op === 'io') v.io = obj(x.io);
      else if (x.op === 'altri') v.altri = arr(x.altri);
      else if (x.op === 'regole') v.regole = x.regole || null;
      else if (x.op === 'scene') v.scene = arr(x.scene);
      else if (x.op === 'mondo') v.mondo = x.mondo || null;
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
      else if (x.op === 'celle') { serve(); c.griglia.cells = applicaCelle(c.griglia.cells, x.d); }
      else if (x.op === 'griglia') { serve(); c.griglia = Object.assign(obj(x.griglia), { cells: c.griglia.cells }); c.tilesets = arr(x.tilesets); }
      else if (x.op === 'esplorazione') { serveEsp(); const e = obj(x.esplorazione); e.griglia = Object.assign(obj(e.griglia), { cells: v.esplorazione.griglia.cells }); v.esplorazione = e; }
      else if (x.op === 'nebbiaEsp') { serveEsp(); v.esplorazione.griglia.cells = String(x.celle || ''); }
      else if (x.op === 'celleEsp') { serveEsp(); v.esplorazione.griglia.cells = applicaCelle(v.esplorazione.griglia.cells, x.d); }
      else if (x.op === 'immagini') v.immagini = arr(x.ids);
      else throw new Error('cambio sconosciuto: ' + x.op);
    }
    return v;
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.filtro = {
    SALUTE, salute, rigaLog, testoEsito, scheda, istantanea, immaginiDi, differenze, applica, diffCelle, applicaCelle,
    statoPerGiocatore, eventoPerGiocatore, ammetti, statoNpcPerGiocatore, statoScenaPerGiocatore, visioneGiocatore, nonRicevuto,
    contestoPrezzi, npcPiazzato, negozio, SCHEMA: VISTA,
  };
})(globalThis.DnD = globalThis.DnD || {});
