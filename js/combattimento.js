// Regole del combattimento attivo (A8): danno con PF temporanei, forme leggendarie, 0 PF e concentrazione; effetti
// dopo ogni azione; risoluzione di un attacco con arma; passaggio del turno. Livello regole: nessun DOM, nessun
// disco, nessuna rete. Espone DnD.combattimento; usa regole, condizioni, riposi, leggendario, creature, movimento,
// visione e modello (pushLog). Lavora sull'oggetto combattimento che riceve (dentro store.update) e scrive le righe
// nel suo log; i dadi arrivano come rng (dadi del registratore o di prova). Regole: danni critici a dadi raddoppiati,
// 1 e 20 naturali, CD della concentrazione max(10, metà del danno) (in condizioni.js), azioni di tana a iniziativa 20.
(function (DnD) {
  'use strict';

  const R = DnD.regole;
  const C = DnD.condizioni;
  const M = DnD.creature;
  const log = (c, type, text) => DnD.modello.pushLog(c, type, text);
  const rollText = (rolls, flat) => '[' + rolls.join(', ') + ']' + (flat ? ' ' + R.formatModifier(flat) : '');

  /**
   * Danno a un combattente: PF temporanei, forma leggendaria (l'eccesso passa al personaggio), tiri contro la morte
   * se era già a 0 PF, prova di concentrazione.
   * @param {object} t combattente (modificato)  @param {number} amount danno dopo le difese  @param {boolean} crit
   * @param {object[]} combatants tutti i combattenti (fine della concentrazione)  @param {Function} rng dadi
   * @returns {Array<string|{type: string, text: string}>} righe da scrivere nel log alla fine dell'azione
   */
  function danno(t, amount, crit, combatants, rng) {
    const lines = [];
    const wasZero = t.hp <= 0;
    const tmp = DnD.riposi.absorbTemp(t, amount);
    if (tmp.absorbed) lines.push('🛡 ' + t.name + ': i PF temporanei assorbono ' + tmp.absorbed + ' danni (ne restano ' + (t.tempHp || 0) + ').');
    lines.push(...DnD.leggendario.damage(t, tmp.rest));
    if (!(amount > 0)) return lines;
    if (wasZero) lines.push(...C.damageAtZero(t, crit));
    if (t.hp > 0 && t.concentration) {
      const r = C.concentrationCheck(t, amount, rng);
      lines.push({ type: r.kept ? 'tiro-salvezza' : 'ts-fallito', text: r.line });
      if (!r.kept) lines.push(...C.endConcentration(t, combatants, 'danno').lines.map((text) => ({ type: 'concentrazione', text })));
    }
    return lines;
  }

  /**
   * Dopo ogni azione: chi scende a 0 PF (privo di sensi o morto), chi torna sopra 0 e le concentrazioni che finiscono
   * da sole (0 PF, incapacitato). Scrive nel log del combattimento.
   * @param {object} c combattimento  @param {Map<string, number>} beforeHp PF prima dell'azione  @param {object} rules
   */
  function dopoAzione(c, beforeHp, rules) {
    for (const x of c.combatants) {
      const before = beforeHp.has(x.id) ? beforeHp.get(x.id) : x.hp;
      if (before > 0 && x.hp <= 0) for (const line of C.dropToZero(x, rules)) log(c, 'sistema', line);
      const ds = C.normalizeDeathSaves(x.deathSaves);
      if (x.hp > 0 && (ds.active || ds.stable || x.dead || C.normalizeList(x.conditions).some((e) => e.auto === 'zero'))) {
        C.revive(x);
        x.dead = false;
        if (ds.active || ds.stable) log(c, 'sistema', x.name + ' torna cosciente.');
      }
      const why = C.concentrationBreaker(x);
      if (why) for (const line of C.endConcentration(x, c.combatants, why).lines) log(c, 'concentrazione', line);
    }
  }

  // Testo del d20: «d20 = 14» oppure «d20 con vantaggio [4, 17] → 17».
  const testoD20 = (mode, res) => (mode === R.MODES.normale ? 'd20 = ' + res.natural : 'd20 con ' + mode + ' [' + res.d20Rolls.join(', ') + '] → ' + res.natural);

  // Colpo andato a segno: difese del bersaglio, danno e testo della riga del log.
  function colpito(o, res, text) {
    const { a, t, w, mods } = o;
    const before = t.hp;
    const def = M.applyDefenses(res.damage, M.damageTypeOf(w.damageType), t.defenses, w.magical);
    const dannoRighe = danno(t, def.amount, res.crit, o.combatants, o.rng);
    text += res.crit ? (res.natural === 20 ? '. 20 NATURALE, COLPO CRITICO! ' : '. COLPO CRITICO (' + mods.autoCrit + ')! ') : ' → colpito. ';
    text += 'Danni ' + res.damageDiceCount + 'd' + res.damageSides + (res.crit ? ' (dadi raddoppiati)' : '') + ': ' + rollText(res.damageRolls, res.damageFlat) +
      ' = ' + res.damage + (w.damageType ? ' ' + w.damageType : '') + (def.note ? ' (' + def.note + ')' : '') + '. ' + t.name + ': ' + before + ' → ' + t.hp + ' PF.';
    const righe = [{ type: res.crit ? 'critico' : 'colpito', text }];
    let summary = (res.crit ? 'CRITICO! ' : '') + t.name + ' subisce ' + def.amount + ' danni.';
    if (before > 0 && t.hp === 0) {
      righe.push({ type: 'a-terra', text: t.name + ' è a terra!' });
      summary += ' ' + t.name + ' è a terra!';
    }
    return { righe, danno: dannoRighe, summary, summaryType: res.crit ? 'success' : 'info' };
  }

  /**
   * Attacco con arma già convalidato (modificatori delle condizioni calcolati da chi chiama).
   * @param {{a: object, t: object, w: object, mods: object, combatants: object[], rng: Function}} o
   * @returns {{righe: {type: string, text: string}[], danno: Array, summary: string, summaryType: string}} righe del
   *   log subito, righe del danno da scrivere alla fine dell'azione, riepilogo per l'avviso
   */
  function attacco(o) {
    const { a, t, w, mods } = o;
    if (mods.blocked) return { righe: [{ type: 'sistema', text: a.name + ' non attacca ' + t.name + ': ' + mods.blocked + '.' }], danno: [], summary: a.name + ': ' + mods.blocked + '.', summaryType: 'info' };
    const res = R.resolveAttack({ toHit: w.toHit, targetAC: t.ac, damageDice: w.damageDice, damageBonus: w.damageBonus, mode: mods.mode, autoCrit: Boolean(mods.autoCrit) }, o.rng);
    const why = C.modsText(mods);
    const text = a.name + ' attacca ' + t.name + ' con ' + w.name + (why ? ' (' + why + ')' : '') + ': ' + testoD20(mods.mode, res) + ' ' + R.formatModifier(w.toHit) + ' = ' + res.total + ' contro CA ' + t.ac;
    if (res.fumble) return { righe: [{ type: 'mancato', text: text + '. 1 NATURALE: fallimento automatico.' }], danno: [], summary: a.name + ': fallimento automatico!', summaryType: 'info' };
    if (!res.hit) return { righe: [{ type: 'mancato', text: text + ' → mancato.' }], danno: [], summary: a.name + ' manca ' + t.name + '.', summaryType: 'info' };
    return colpito(o, res, text);
  }

  /**
   * Inizio del turno: promemoria delle azioni di tana (iniziativa 20), movimento azzerato, condizioni «fino all'inizio
   * del turno», tiri contro la morte, azioni bloccate, durata delle trasformazioni, ricarica e azioni leggendarie.
   * @param {object} c combattimento  @param {object[]} sorted ordine di iniziativa  @param {string} prevId
   * @param {string} nextId  @param {boolean} newRound  @param {Function} rng
   * @returns {{tana: boolean}} tana: azioni di tana disponibili (per l'avviso)
   */
  function inizioTurno(c, sorted, prevId, nextId, newRound, rng) {
    const lairs = sorted.filter((x) => x.creature && x.creature.lair.length && !R.isDown(x));
    const tana = Boolean(lairs.length && M.crossesLair(sorted, prevId, nextId, newRound));
    if (tana) for (const x of lairs) log(c, 'sistema', '🏰 Iniziativa 20 — azioni di tana di ' + x.name + ': ' + x.creature.lair.map((a) => a.name).join(', ') + ' (promemoria).');
    const cur = c.combatants.find((x) => x.id === nextId);
    DnD.movimento.resetTurn(cur);
    log(c, 'turno', 'Turno di ' + cur.name + '.');
    for (const line of C.startTurn(c.combatants, nextId)) log(c, 'sistema', line);
    if (C.dying(cur)) log(c, 'sistema', C.deathSave(cur, rng).line);
    else if (C.actionBlock(cur) && cur.hp > 0) log(c, 'sistema', '⚠ ' + cur.name + ': ' + C.actionBlock(cur) + (cur.forceActions ? ' (il master le permette).' : '.'));
    for (const line of DnD.leggendario.tick(cur)) log(c, 'sistema', line);
    if (cur.creature) for (const line of M.startTurn(cur.creature, rng)) log(c, 'sistema', line);
    return { tana };
  }

  /**
   * Passa al turno successivo: fine del turno di chi ha giocato, nuovo round (torce, NPC che entrano), inizio del turno.
   * @param {object} c combattimento  @param {Function} rng
   * @returns {{tana: boolean}|null} null se il turno non cambia
   */
  function prossimoTurno(c, rng) {
    const sorted = R.sortByInitiative(c.combatants);
    const res = R.nextTurn(sorted, c.currentId, c.round);
    if (res.currentId === c.currentId && res.round === c.round) return null;
    const newRound = res.round !== c.round;
    if (c.currentId) for (const line of C.endTurn(c.combatants, c.currentId, rng)) log(c, 'sistema', line);
    if (newRound) log(c, 'round', '— Round ' + res.round + ' —');
    // Torce e sorgenti a durata: un round = 6 secondi di gioco.
    if (newRound) for (const line of DnD.visione.tickLights(c.grid, c.combatants, DnD.visioneDati.ROUND_MINUTES)) log(c, 'sistema', '🔥 ' + line);
    // NPC diventati ostili: entrano nell'ordine di iniziativa da questo round.
    if (newRound) for (const x of c.combatants.filter((y) => y.joinRound && y.joinRound <= res.round)) { x.joinRound = 0; log(c, 'sistema', x.name + ' entra nell\'ordine di iniziativa.'); }
    const prev = c.currentId;
    c.round = res.round;
    c.currentId = res.currentId;
    return inizioTurno(c, sorted, prev, c.currentId, newRound, rng);
  }

  // ---------- Incantesimi e tiri salvezza ----------
  // Incantesimo innato di una creatura (senza slot): { freq, left } oppure null.
  const innatoDi = (sc, sp) => (sc && sc.innate && sp && sc.innate[sp.id]) || null;

  // Spende l'uso: innato «N al giorno» (anche nel Percorso del leggendario) o slot (anche nella scheda del giocatore).
  function spendiLancio(st, a, sp, slotLevel) {
    const sc = a.spellcasting;
    const inn = innatoDi(sc, sp);
    if (inn) {
      if (inn.freq === 'giorno') inn.left = Math.max(0, inn.left - 1);
      const source = a.kind === 'player' && a.legend ? st.players.find((p) => p.id === a.sourceId) : null;
      if (source && source.legend && inn.freq === 'giorno') source.legend.spellUses[sp.id] = (source.legend.spellUses[sp.id] || 0) + 1;
    } else if (sp.level > 0) {
      sc.slotsUsed = DnD.magie.consumeSlot(sc.slotsUsed, sc.slotsTotal, slotLevel);
      const source = a.kind === 'player' ? st.players.find((p) => p.id === a.sourceId) : null;
      if (source) source.spellcasting.slotsUsed[slotLevel - 1] = sc.slotsUsed[slotLevel - 1];
    }
    return inn;
  }

  // Parte della riga del log per un bersaglio, secondo il tipo di effetto.
  function testoBersaglio(o, t, r, before, defNote) {
    const { sp, sc, tmods, diceText, dmgType } = o;
    const e = sp.effect;
    const hpText = (before === t.hp ? '' : ' (' + before + ' → ' + t.hp + ' PF)') + defNote;
    const why = C.modsText(tmods.get(t.id));
    if (e.type === 'attacco') {
      const outcome = r.fumble ? '1 NATURALE, mancato' : r.crit ? 'CRITICO, ' + r.amount + ' danni' + dmgType + ' (' + diceText(r.roll) + ')'
        : r.hit ? 'colpito, ' + r.amount + ' danni' + dmgType + ' (' + diceText(r.roll) + ')' : 'mancato';
      return t.name + (why ? ' (' + why + ')' : '') + ': ' + testoD20(tmods.get(t.id).mode, r) + ' ' + R.formatModifier(sc.attack) + ' = ' + r.total + ' contro CA ' + t.ac + ' → ' + outcome + hpText + '.';
    }
    if (e.type === 'salvezza') return t.name + ': salvezza ' + e.saveAbility + ' ' + (r.autoFail ? 'fallita in automatico (' + why + ')' : r.saveTotal + ' vs CD ' + sc.dc + (why ? ' (' + why + ')' : '') + ' → ' + (r.success ? 'riesce' : 'fallisce')) + ', ' + r.amount + ' danni' + hpText + '.';
    if (e.type === 'cura') return t.name + ' recupera ' + (t.hp - before) + ' PF' + hpText + (before === 0 && t.hp > 0 ? ', torna in piedi' : '') + '.';
    return o.res.roll ? t.name + ': ' + r.amount + ' danni' + hpText + '.' : null;
  }

  // Effetto su ogni bersaglio: cura o danno (con difese), Resistenza leggendaria in sospeso, testo.
  function applicaBersagli(o, parts, danni) {
    const { c, sp, res } = o;
    const e = sp.effect;
    const downed = [];
    for (const r of res.targets) {
      const t = c.combatants.find((x) => x.id === r.id);
      const before = t.hp;
      let defNote = '';
      if (e.type === 'cura') t.hp = R.heal(t.hp, t.maxHp, r.amount);
      else if (r.amount) {
        const def = M.applyDefenses(r.amount, M.damageTypeOf(e.damageType), t.defenses, true);
        defNote = def.note ? ' (' + def.note + ')' : '';
        danni.push(...danno(t, def.amount, r.crit, c.combatants, o.rng));
        r.amount = def.amount;
      }
      // Tiro salvezza fallito: la Resistenza leggendaria può trasformarlo in un successo.
      if (e.type === 'salvezza' && !r.success && t.creature && t.creature.legendaryResistance.left > 0) {
        t.pendingSave = { full: [{ amount: res.roll ? Math.max(0, res.roll.total) : 0, type: M.damageTypeOf(e.damageType) }], half: e.halfOnSave, applied: before - t.hp, magical: true, text: sp.name };
      }
      const line = testoBersaglio(o, t, r, before, defNote);
      if (line) parts.push(line);
      if (before > 0 && t.hp === 0) downed.push(t.name);
    }
    return downed;
  }

  // Condizione inflitta: a chi fallisce la salvezza, a chi è colpito, o (senza tiro) a tutti salvo la salvezza propria.
  function infliggiCondizioni(o) {
    const { c, sp, sc, res } = o;
    const e = sp.effect;
    if (!sp.inflict || !sp.inflict.type) return;
    for (const r of res.targets) {
      const t = c.combatants.find((x) => x.id === r.id);
      if (!t || (e.type === 'salvezza' && r.success) || (e.type === 'attacco' && !r.hit)) continue;
      if (e.type !== 'salvezza' && e.type !== 'attacco' && sp.inflict.save) {
        const sm = C.saveMods(t, sp.inflict.save.ability);
        const dc = sp.inflict.save.dc || sc.dc;
        const s2 = sm.autoFail ? { success: false, total: '—' } : R.rollSave({ bonus: t.saves[sp.inflict.save.ability] || 0, mode: sm.mode, dc }, o.rng);
        log(c, s2.success ? 'tiro-salvezza' : 'ts-fallito', t.name + ': salvezza su ' + sp.inflict.save.ability + ' contro ' + sp.name + ' ' + s2.total + ' vs CD ' + dc + ' → ' + (s2.success ? 'riesce.' : 'fallisce.'));
        if (s2.success) continue;
      }
      o.infliggi(t, sp.inflict, sp);
    }
  }

  /**
   * Lancio di un incantesimo: spende slot o uso innato, risolve attacchi/salvezze/cure (magie.resolveSpell), avvia la
   * concentrazione e la luce, applica danni e condizioni, scrive il log.
   * @param {{c: object, st: object, a: object, sp: object, slotLevel: number, targets: object[], tmods: Map, mode: string,
   *   rng: Function, infliggi: Function}} o tmods: modificatori delle condizioni per bersaglio (calcolati da chi chiama);
   *   infliggi(t, inflict, sp): applica una condizione
   * @returns {{danno: Array, summary: string}} righe del danno da scrivere alla fine dell'azione, riepilogo
   */
  function lancio(o) {
    const { c, a, sp, slotLevel, targets, tmods, mode } = o;
    const sc = a.spellcasting;
    const inn = spendiLancio(o.st, a, sp, slotLevel);
    const res = DnD.magie.resolveSpell({
      spell: sp, slotLevel, mode, caster: { attack: sc.attack, dc: sc.dc, mod: sc.mod },
      targets: targets.map((t) => { const m = tmods.get(t.id); return { id: t.id, ac: t.ac, saves: t.saves, mode: m.mode, autoCrit: Boolean(m.autoCrit), saveMode: m.mode, autoFail: Boolean(m.autoFail) }; }),
    }, o.rng);
    // Concentrazione: inizia prima di applicare gli effetti (quella precedente finisce con i suoi).
    const concLines = sp.concentration ? C.startConcentration(a, sp, c.combatants, c.round) : [];
    // Luce e Oscurità (riconosciuti dal nome): la sorgente nasce sul primo bersaglio o su chi lancia.
    const lightAt = (targets[0] && targets[0].pos) || a.pos;
    if (lightAt && DnD.visione.spellEffect(sp)) concLines.push(DnD.visione.castLight(c.grid, a, sp, lightAt));
    const e = sp.effect;
    const dmgType = e.damageType ? ' ' + e.damageType : '';
    const diceText = (r) => (r ? DnD.dadi.formatExpr(r.count, r.sides, r.modifier) + ': ' + rollText(r.rolls, r.modifier) + ' = ' + Math.max(0, r.total) : '');
    const parts = [a.name + ' lancia ' + sp.name + (inn ? ' (innato' + (inn.freq === 'giorno' ? ', ' + inn.left + ' usi rimasti' : ', a volontà') + ')' : sp.level ? ' (slot ' + slotLevel + '°)' : ' (trucchetto)') +
      (targets.length ? ' su ' + targets.map((t) => t.name).join(', ') : '') + '.'];
    if (res.roll) parts.push((e.type === 'cura' ? 'Cura ' : 'Danni ') + diceText(res.roll) + (e.type === 'cura' ? '' : dmgType) + '.');
    const ctx = Object.assign({}, o, { sc, res, diceText, dmgType });
    const danni = [];
    const downed = applicaBersagli(ctx, parts, danni);
    log(c, 'magia', parts.join(' '));
    for (const line of concLines) log(c, line.includes('perde') ? 'concentrazione' : 'sistema', line);
    infliggiCondizioni(ctx);
    for (const n of downed) log(c, 'a-terra', n + ' è a terra!');
    return { danno: danni, summary: a.name + ' lancia ' + sp.name + (downed.length ? ' · a terra: ' + downed.join(', ') : '') };
  }

  /**
   * Tiro salvezza richiesto dal master: d20 + salvezza, condizioni (fallimento automatico, vantaggio/svantaggio), CD.
   * @param {object} c combattimento  @param {object} t combattente  @param {string} ab caratteristica
   * @param {number|null} dcValue CD (null: solo il totale)  @param {string} m modo scelto  @param {Function} rng
   * @returns {{esito: {success: boolean|null, total: number|null}, summary: string, summaryType: string}}
   */
  function tiroSalvezza(c, t, ab, dcValue, m, rng) {
    const sm = C.saveMods(t, ab, m);
    if (sm.autoFail) {
      log(c, 'ts-fallito', t.name + ' tiro salvezza su ' + R.ABILITY_NAMES[ab] + ': fallito in automatico (' + sm.autoFail + ').');
      return { esito: { success: false, total: null }, summary: t.name + ': TS ' + ab + ' fallito in automatico (' + sm.autoFail + ')', summaryType: 'error' };
    }
    const r = R.rollSave({ bonus: t.saves[ab], mode: sm.mode, dc: dcValue }, rng);
    const why = C.modsText(sm);
    const outcome = r.success === null ? '' : r.success ? ' contro CD ' + dcValue + ' → riuscito.' : ' contro CD ' + dcValue + ' → fallito.';
    log(c, r.success === false ? 'ts-fallito' : 'tiro-salvezza', t.name + ' tiro salvezza su ' + R.ABILITY_NAMES[ab] + (why ? ' (' + why + ')' : '') + ': ' + testoD20(sm.mode, r) + ' ' +
      R.formatModifier(t.saves[ab]) + ' = ' + r.total + (outcome || '.'));
    return {
      esito: r,
      summary: t.name + ': TS ' + ab + ' = ' + r.total + (r.success === null ? '' : r.success ? ' (riuscito)' : ' (fallito)'),
      summaryType: r.success === false ? 'error' : r.success ? 'success' : 'info',
    };
  }

  DnD.combattimento = { danno, dopoAzione, attacco, inizioTurno, prossimoTurno, lancio, tiroSalvezza, innatoDi, rollText };
})(globalThis.DnD = globalThis.DnD || {});
