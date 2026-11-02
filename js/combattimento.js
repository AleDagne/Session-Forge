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

  DnD.combattimento = { danno, dopoAzione, attacco, inizioTurno, prossimoTurno, rollText };
})(globalThis.DnD = globalThis.DnD || {});
