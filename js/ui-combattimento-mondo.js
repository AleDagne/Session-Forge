// Combattimento › Mondo: fazioni dei combattenti, NPC piazzati che entrano nello scontro, provocazioni degli NPC
// neutrali (con annullamento), calmare un NPC, cambio di fazione, effetti sul Mondo dopo un'azione (reputazione,
// uccisioni per le quest, fine del combattimento) e conferma degli effetti ad area sugli alleati. Parte della
// schermata Combattimento (ui-combattimento.js). Livello interfaccia. Espone DnD.uiCombattimentoMondo { mondo(api) }.
(function (DnD) {
  'use strict';

  // api (da ui-combattimento.js): C, FZ, NP, R, S, beginDice, byId, clone, combat, dice, el, endDice, field, log, mutate, openDialog, order, toast
  function mondo(api) {
    const {
      C, FZ, NP, R, S, beginDice, byId, clone, combat, dice, el, endDice, field, log, mutate, openDialog, order, toast,
    } = api;

    const worldView = (st) => FZ.view(st || DnD.store.state);
    const relTable = (st) => FZ.table(worldView(st).factions);
    const factionName = (id) => { const f = worldView().factions.find((x) => x.id === id); return f ? f.name : 'fazione eliminata'; };
    const partyFaction = (st) => { const v = worldView(st); const p = DnD.party.active(v.parties, v.world); return p ? p.factionId : 'giocatori'; };
    const noteAggression = (attackerId, targetIds) => { S.pendingAggr = { attackerId, targetIds: targetIds.filter(Boolean) }; };

    // Copia di un NPC piazzata sulla griglia -> combattente (stessa posizione, PF e stato della copia).
    function npcItemToCombatant(st, it, hostile) {
      const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
      if (!npc) return null;
      const v = worldView(st);
      const source = Object.assign(clone(npc.stats), { id: npc.id, name: it.name || npc.name, icon: clone(it.icon) });
      const x = DnD.combattenti.createCombatants([], [{ npc: source, quantity: 1 }], st.races, dice(), st.spells, st.equipment)[0];
      const fid = NP.factionOf(npc, it.npcState, v.cities);
      const party = DnD.party.active(v.parties, v.world);
      const att = hostile ? 'ostile' : NP.attitudeOf(npc, it.npcState, FZ.reputationOf(v.world, party, fid));
      Object.assign(x, {
        faction: fid, pos: { x: it.x, y: it.y }, w: it.w, h: it.h, control: 'ia',
        npc: NP.combatData(npc, it.npcState, it.id, att),
        hostileTo: hostile ? [party ? party.factionId : 'giocatori'] : (it.npcState.hostileTo || []).slice(),
      });
      if (it.npcState.hp !== null) x.hp = Math.min(x.maxHp, it.npcState.hp);
      return x;
    }
    // Toglie la copia dalla griglia e mette il combattente; ostile = entra al round successivo (se il combattimento è attivo).
    function joinFromItem(c, st, it, hostile) {
      const x = npcItemToCombatant(st, it, hostile);
      if (!x) return null;
      c.grid.items = c.grid.items.filter((y) => y.id !== it.id);
      if (hostile && c.phase === 'attivo') x.joinRound = c.round + 1;
      c.combatants.push(x);
      return x;
    }

    // Provocazione: gli NPC non ostili colpiti (o che difendono la fazione o il party) diventano ostili secondo la
    // loro regola; con «fazione» e «città» anche le copie sulla griglia della stessa fazione o città entrano
    // ostili al round successivo. Penalità di reputazione e voce annullabile (world.provocations).
    function provocationFor(c, st, attacker, targets) {
      const t = relTable(st);
      const npcs = [];
      for (const tg of targets) for (const x of NP.reactions(attacker, tg, c.combatants, t)) if (!npcs.includes(x)) npcs.push(x);
      if (!npcs.length) return [];
      const v = worldView(st);
      const before = c.combatants.filter((x) => x.npc).map((x) => ({ id: x.id, hostileTo: (x.hostileTo || []).slice(), attitude: x.npc.attitude }));
      const res = NP.provoke(npcs, { combatants: c.combatants, factions: v.factions, symmetric: v.world.symmetric, attackerFaction: attacker.faction, attackerId: attacker.id });
      const lines = res.lines.slice();
      // Copie ancora sulla griglia: la città (o la fazione) intera si unisce, ostile, al round successivo.
      const joined = [];
      for (const x of npcs) {
        const rule = x.npc.provoke;
        if (rule !== 'citta' && rule !== 'fazione') continue;
        for (const it of c.grid.items.filter((y) => y.otype === 'npc' && !y.npcState.dead)) {
          const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
          if (!npc) continue;
          const same = rule === 'citta' ? npc.cityId && npc.cityId === x.npc.cityId : NP.factionOf(npc, it.npcState, v.cities) === x.faction;
          if (!same) continue;
          const y = joinFromItem(c, st, it, true);
          if (y) { y.hostileTo = [attacker.faction]; joined.push(y.name); }
        }
      }
      if (joined.length) lines.push('⚠ Si uniscono ostili' + (c.phase === 'attivo' ? ' dal round ' + (c.round + 1) : '') + ': ' + joined.join(', ') + '.');
      // Penalità di reputazione solo se chi attacca è dalla parte del party.
      const repIds = [];
      if (attacker.faction === partyFaction(st) || attacker.kind === 'player') {
        const party = DnD.party.active(v.parties, v.world);
        for (const r of res.reputation) {
          const e = FZ.changeReputation({ world: v.world, party }, r.factionId, r.delta, r.reason, 'combattimento');
          if (e) { repIds.push(e.id); lines.push('⚑ Reputazione con «' + factionName(r.factionId) + '»: ' + e.delta + ' (' + e.after + ').'); }
        }
      }
      v.world.provocations.push({ id: DnD.dadi.uid(), at: new Date().toISOString(), text: lines[0] || '', combatId: c.id,
        factions: Object.fromEntries(res.factionsBefore.map((f) => [f.id, f.relations])), combatants: before, repIds, reverted: false });
      if (v.world.provocations.length > 50) v.world.provocations.splice(0, v.world.provocations.length - 50);
      S.provoked = true;
      return lines;
    }

    // Annulla l'ultima provocazione che ha toccato il combattente (decisione del master).
    function revertProvocation(x) {
      const v = worldView();
      const pr = v.world.provocations.slice().reverse().find((p) => !p.reverted && p.combatId === combat().id && (p.combatants || []).some((b) => b.id === x.id));
      if (!pr) { toast('Nessuna provocazione da annullare.'); return; }
      mutate((c, st) => {
        const w = worldView(st);
        for (const [fid, rel] of Object.entries(pr.factions || {})) { const f = w.factions.find((y) => y.id === fid); if (f) f.relations = clone(rel); }
        for (const b of pr.combatants || []) { const y = c.combatants.find((z) => z.id === b.id); if (y && y.npc) { y.hostileTo = b.hostileTo; y.npc.attitude = b.attitude; } }
        for (const id of pr.repIds || []) FZ.revertReputation(w.world, st.parties, id);
        const p = w.world.provocations.find((y) => y.id === pr.id);
        if (p) p.reverted = true;
        S.aiPlan = null;
        log(c, 'sistema', '↶ Il master annulla la provocazione: ' + (pr.text || '') + ' (relazioni, ostilità e reputazione ripristinate).');
      });
    }
    // Calma (prova di Persuasione del giocatore scelto): l'NPC torna neutrale.
    function calmDialog(x) {
      const players = order().filter((y) => y.kind === 'player' && !R.isDown(y));
      const src = (y) => DnD.store.state.players.find((p) => p.id === y.sourceId);
      if (!players.length) { toast('Nessun giocatore in piedi per calmarlo.', 'error'); return; }
      const sel = el('select', {}, players.map((y) => el('option', { value: y.id, text: y.name })));
      openDialog('Calma ' + x.name, el('div', { class: 'form' }, field('Chi parla', sel), el('p', { class: 'muted small', text: 'Persuasione contro CD ' + x.npc.calmDc + '. Riuscita: torna neutrale (resta nell\'iniziativa ma non attacca).' })), [
        { text: 'Annulla' },
        { text: '🕊 Prova', class: 'primary', onclick: () => {
          const who = byId(sel.value);
          const p = src(who);
          beginDice();
          mutate((c) => {
            const t = c.combatants.find((y) => y.id === x.id);
            // Prova di Persuasione: le condizioni di chi parla (avvelenato, spaventato…) danno svantaggio.
            const r = R.rollSave({ bonus: p ? DnD.leggendario.checkBonus(p, 'Persuasione', false, DnD.store.state) : 0, mode: C.checkMods(who).mode, dc: t.npc.calmDc }, dice());
            log(c, r.success ? 'successo' : 'fallimento', who.name + ' prova a calmare ' + t.name + ': Persuasione ' + r.total + ' contro CD ' + t.npc.calmDc + ' → ' + (r.success ? NP.calm(t) : 'non ci riesce.'));
            S.aiPlan = null;
          });
          endDice('Calma ' + x.name, '');
        } },
      ]);
    }

    // Dopo ogni modifica: provocazioni, uccisioni (quest e reputazione), fine del combattimento per fazioni.
    function worldAfter(c, st, beforeHp, aggr) {
      const lines = [];
      const attacker = aggr ? c.combatants.find((x) => x.id === aggr.attackerId) : null;
      if (attacker) lines.push(...provocationFor(c, st, attacker, aggr.targetIds.map((id) => c.combatants.find((x) => x.id === id)).filter(Boolean)));
      const v = worldView(st);
      const pf = partyFaction(st);
      for (const x of c.combatants) {
        if (!(beforeHp.get(x.id) > 0 && x.hp === 0)) continue;
        lines.push(...DnD.quest.onKill(v.world.quests, v.quests, x));
        // Uccidere un NPC di una fazione: la reputazione con quella fazione scende (se è stato il party).
        if (x.npc && attacker && (attacker.faction === pf || attacker.kind === 'player') && x.faction !== pf) {
          const e = FZ.changeReputation({ world: v.world, party: DnD.party.active(v.parties, v.world) }, x.faction, DnD.mondoDati.REP_EVENTS.uccidiMembro, 'ucciso ' + x.name, 'combattimento');
          if (e) lines.push('⚑ Reputazione con «' + factionName(x.faction) + '»: ' + e.delta + ' (' + e.after + ').');
        }
      }
      // Combattimento da una scena: condizioni di fine dell'incontro (vittoria, sconfitta, fuga, round, obiettivo).
      const fromScene = c.phase === 'attivo' ? DnD.scene.ofCombat(st, c) : null;
      const end = fromScene ? DnD.scene.endCheck(c, fromScene.enc, relTable(st), pf) : null;
      if (end && S.sceneEndNotified !== c.id + end.outcome) {
        S.sceneEndNotified = c.id + end.outcome;
        lines.push('🎬 Condizione di fine dell\'incontro: ' + DnD.sceneDati.OUTCOME_NAMES[end.outcome] + ' (' + end.text + '). Termina il combattimento per il riepilogo della scena.');
      }
      if (c.phase === 'attivo' && S.overNotified !== c.id) {
        const over = FZ.combatOver(c.combatants, relTable(st), pf);
        if (over.over) {
          S.overNotified = c.id;
          lines.push('🏁 Tutte le fazioni ostili al party sono sconfitte o in fuga: il combattimento può terminare.');
        }
      }
      for (const l of lines) log(c, l.startsWith('📜') ? 'quest' : 'sistema', l);
      return lines;
    }

    // Cambio di fazione in gioco (anche a metà combattimento), con la fazione precedente per l'annullamento.
    function factionDialog(x) {
      const sel = el('select', {}, worldView().factions.map((f) => el('option', { value: f.id, text: f.name, selected: f.id === x.faction })));
      openDialog('Fazione di ' + x.name, el('div', { class: 'form' }, field('Fazione', sel),
        el('p', { class: 'muted small', text: 'La relazione tra le fazioni decide chi è alleato, neutrale o ostile (Mondo › Fazioni).' })), [
        { text: 'Annulla' },
        { text: 'Cambia', class: 'primary', onclick: () => {
          if (sel.value === x.faction) return undefined;
          mutate((c) => {
            const t = c.combatants.find((y) => y.id === x.id);
            t.prevFaction = t.faction;
            t.faction = sel.value;
            S.aiPlan = null;
            log(c, 'sistema', '⚑ ' + t.name + ' cambia fazione: ' + factionName(t.prevFaction) + ' → ' + factionName(t.faction) + '.');
          });
          return undefined;
        } },
      ]);
    }
    function undoFaction(id) {
      mutate((c) => {
        const t = c.combatants.find((y) => y.id === id);
        if (!t || !t.prevFaction) return;
        const from = t.faction;
        t.faction = t.prevFaction;
        t.prevFaction = '';
        S.aiPlan = null;
        log(c, 'sistema', '↶ ' + t.name + ' torna alla fazione ' + factionName(t.faction) + ' (era ' + factionName(from) + ').');
      });
    }
    // Effetto ad area: chiede conferma se colpisce chi non è ostile a chi lo usa.
    function confirmArea(casterId, targetIds) {
      const caster = byId(casterId);
      if (!caster) return true;
      const warn = FZ.areaWarnings(caster, targetIds.map(byId).filter(Boolean), relTable());
      return !warn.length || confirm('Attenzione: l\'area colpisce anche ' + warn.map((w) => w.name + ' (' + DnD.mondoDati.LEVEL_NAMES[w.level].toLowerCase() + ')').join(', ') + '. Continuare?');
    }

    return { calmDialog, confirmArea, factionDialog, factionName, joinFromItem, noteAggression, partyFaction, provocationFor, relTable, revertProvocation, undoFaction, worldAfter, worldView };
  }

  DnD.uiCombattimentoMondo = { mondo };
})(globalThis.DnD = globalThis.DnD || {});
