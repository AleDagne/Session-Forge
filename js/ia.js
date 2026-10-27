// IA dei nemici (funzioni pure, nessun accesso al DOM e nessuna modifica dello stato). pianificaTurno()
// restituisce un PIANO (percorso, azione, bersagli, motivazione e punteggi); l'esecuzione usa le funzioni
// già esistenti del combattimento (attacco, danni con le difese, incantesimi, azioni delle creature).
// - Archetipo dalla caratteristica più alta (FOR attaccante, DES tiratore, COS scudo, INT stratega,
//   SAG cacciatore di incantatori, CAR supporto) e temperamento (Aggressivo = il più vicino per percorso,
//   Furbo = il più debole).
// - Percorso minimo (Dijkstra/A* senza euristica: serve il costo verso tutti i bersagli) con l'ingombro w×h
//   delle pedine, terreno difficile a costo 2, celle bloccate come isCellBlocked (porte chiuse comprese),
//   diagonali con la regola del misuratore, niente angoli tagliati (movimento.js). Budget = movimento residuo
//   del turno (velocità in piedi / piedi per cella, condizioni comprese); con lo Scatto si aggiunge la velocità.
// - Visibilità: linea di vista tra le celle, esclusi i combattenti nascosti e quelli a 0 PF.
// - Tetto di tempo con ripiego, casualità riproducibile con il seed del combattimento.
(function (DnD) {
  'use strict';

  const K = () => DnD.iaDati;
  const G = () => DnD.griglia;
  const R = () => DnD.regole;
  const AB = ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'];

  // ---------- Comportamento ----------
  function normalizeBehavior(b) {
    b = b && typeof b === 'object' ? b : {};
    const int = (v, def, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
    return {
      temperament: K().TEMPERAMENTS.includes(b.temperament) ? b.temperament : 'aggressivo',
      archetype: AB.includes(b.archetype) ? b.archetype : 'auto',
      preferredRange: b.preferredRange === null || b.preferredRange === undefined || b.preferredRange === '' ? null : int(b.preferredRange, null, 1, 100),
      fleeAt: int(b.fleeAt, 0, 0, 90),
      randomness: int(b.randomness, 0, 0, 30),
      sagTargets: Array.isArray(b.sagTargets) ? [...new Set(b.sagTargets.filter((x) => typeof x === 'string' && x.length <= 40))].slice(0, 20) : K().SAG_TARGETS.slice(),
    };
  }
  const defaultControl = (kind) => (kind === 'player' ? 'manuale' : 'ia');
  const defaultFaction = (kind) => (kind === 'player' ? 'giocatori' : 'nemici');
  // Fazioni del Mondo: l'IA attacca solo chi è Ostile o In guerra, supporta Alleati e Amichevoli e ignora i
  // Neutrali (fazioni.relazioneCombattenti, con le ostilità personali degli NPC provocati). rel = state.relations
  // (istantanea delle fazioni della sessione); senza, valgono le relazioni di partenza delle tre predefinite
  // (Giocatori e Neutrali dalla stessa parte, Nemici ostili a entrambi, come prima).
  const side = (c) => (c.faction === 'nemici' ? 'nemici' : 'giocatori');
  const isHostile = (a, b, rel) => DnD.fazioni.ostili(a, b, rel);
  const isAlly = (a, b, rel) => DnD.fazioni.alleati(a, b, rel);
  const alive = (c) => c.hp > 0;

  // ---------- Armi e azioni ----------
  const cells = (m) => Math.max(1, DnD.misure.celleDaMetri(Number(m) || 0));
  const avgDice = (dice) => { const p = DnD.dadi.parseExpr(dice); return p ? (p.count * (p.sides + 1)) / 2 + p.modifier : 0; };
  const RANGED_NAMES = [[/arco/i, 16, 64], [/balestra/i, 16, 64], [/fionda/i, 6, 24], [/giavellott/i, 6, 24], [/dardo/i, 4, 12], [/pugnal/i, 4, 12]];

  // Opzioni d'attacco di un'arma: mischia (portata in celle) e, se è a distanza o da lancio, a distanza.
  function weaponOptions(c, w, catalog) {
    const e = w.equipmentId ? (catalog || []).find((x) => x.id === w.equipmentId && x.weapon) : null;
    const base = { source: 'arma', id: w.id, name: w.name, toHit: w.toHit, parts: [{ dice: w.damageDice, bonus: w.damageBonus, type: DnD.creature.damageTypeOf(w.damageType) }], magical: Boolean(w.magical) };
    const out = [];
    if (e) {
      const wp = e.weapon;
      if (wp.kind === 'distanza') out.push(Object.assign({}, base, { ranged: true, range: cells(wp.rangeNormal), long: cells(wp.rangeLong || wp.rangeNormal) }));
      else {
        out.push(Object.assign({}, base, { ranged: false, reach: wp.props.includes('portata') ? 2 : 1 }));
        if (wp.props.includes('da lancio') && wp.rangeNormal) out.push(Object.assign({}, base, { ranged: true, range: cells(wp.rangeNormal), long: cells(wp.rangeLong || wp.rangeNormal), thrown: true }));
      }
      return out;
    }
    const guess = RANGED_NAMES.find(([re]) => re.test(w.name));
    if (guess && !/pugnal/i.test(w.name)) return [Object.assign({}, base, { ranged: true, range: guess[1], long: guess[2] })];
    out.push(Object.assign({}, base, { ranged: false, reach: 1 }));
    if (guess) out.push(Object.assign({}, base, { ranged: true, range: guess[1], long: guess[2], thrown: true }));
    return out;
  }

  // Azioni delle creature: attacchi, tiri salvezza (anche ad area), multiattacco e cure, se utilizzabili ora.
  function creatureOptions(c) {
    const st = c.creature;
    if (!st) return [];
    const M = DnD.creature;
    const out = [];
    const parts = (a) => (a.mech.damages || []).map((d, i) => ({ dice: d.dice, bonus: M.damageBonus(st, a.mech, i), type: d.type }));
    const actOf = (a) => {
      const m = a.mech;
      if (m.kind === 'attacco') {
        const o = { source: 'creatura', id: a.id, name: a.name, toHit: M.toHit(st, m), parts: parts(a), magical: m.magical, recharge: a.freq.kind === 'ricarica' };
        const list = [];
        if (m.range !== 'distanza') list.push(Object.assign({}, o, { ranged: false, reach: Math.max(1, Math.round(m.reach / DnD.misure.METRI_PER_CASELLA)) }));
        if (m.range !== 'mischia') list.push(Object.assign({}, o, { ranged: true, range: cells(m.rangeNormal || 9), long: cells(m.rangeLong || m.rangeNormal || 9) }));
        return list;
      }
      if (m.kind === 'salvezza') {
        return [{ source: 'creatura', id: a.id, name: a.name, save: { ability: m.ability, dc: M.saveDc(st, m), half: m.half }, parts: parts(a), area: Boolean(m.area),
          ranged: true, range: m.area ? 6 : 12, long: m.area ? 6 : 12, noDisadvantage: true, recharge: a.freq.kind === 'ricarica' }];
      }
      return [];
    };
    // Boss: le azioni disabilitate dalla fase in corso non si usano.
    const off = c.boss ? DnD.boss.disabledActions(c.boss, c.boss.phase) : new Set();
    for (const a of M.allActions(st).filter((x) => x.group === 'actions')) {
      if (!M.canUse(st, a).ok || off.has(a.id)) continue;
      if (a.mech.kind === 'multiattacco') {
        const subs = M.expandMultiattack(st, a).map((s) => actOf(s).find((x) => !x.ranged) || actOf(s)[0]).filter(Boolean);
        if (!subs.length) continue;
        const ranged = subs.every((s) => s.ranged);
        out.push({ source: 'creatura', id: a.id, name: a.name, multi: subs, ranged, reach: Math.min(...subs.map((s) => s.reach || 1)),
          range: ranged ? Math.min(...subs.map((s) => s.range)) : 0, long: ranged ? Math.min(...subs.map((s) => s.long)) : 0 });
      } else if (a.mech.kind === 'cura') {
        out.push({ source: 'creatura', id: a.id, name: a.name, heal: avgDice(a.mech.dice) + (a.mech.bonus || 0), ranged: true, range: 6, long: 6 });
      } else {
        out.push(...actOf(a));
      }
    }
    return out;
  }

  // Gittata di un incantesimo dal testo ("36 m", "Contatto", "Sé").
  function spellRange(sp) {
    const t = String(sp.range || '').toLowerCase();
    if (/contatto/.test(t)) return 1;
    if (/^s[eé]\b/.test(t)) return 0;
    const m = /(\d+(?:[.,]\d+)?)\s*m\b/.exec(t);
    return m ? cells(Number(m[1].replace(',', '.'))) : 12;
  }
  // Incantesimi utilizzabili: livello più basso sufficiente (o innato), con dadi al livello scelto.
  function spellOptions(c) {
    const sc = c.spellcasting;
    if (!sc) return [];
    const out = [];
    for (const sp of sc.spells) {
      const inn = sc.innate && sc.innate[sp.id];
      let slot = 0;
      if (inn) { if (inn.freq === 'giorno' && inn.left <= 0) continue; slot = sp.level; }
      else if (sp.level > 0) {
        const lv = DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed);
        if (!lv.length) continue;
        slot = lv[0];
      }
      const e = sp.effect;
      const dice = DnD.magie.scaledDice(sp, slot || sp.level);
      const avg = dice ? (dice.count * (dice.sides + 1)) / 2 + dice.modifier : 0;
      const range = spellRange(sp);
      const o = { source: 'incantesimo', id: sp.id, name: sp.name, slot, costly: sp.level > 0 && !inn, area: Boolean(sp.area), ranged: range > 1, range: Math.max(1, range), long: Math.max(1, range), reach: 1, noDisadvantage: e.type !== 'attacco' };
      if (e.type === 'cura') out.push(Object.assign(o, { heal: avg + (e.addMod ? sc.mod : 0) }));
      else if (e.type === 'attacco') out.push(Object.assign(o, { toHit: sc.attack, parts: [{ dice: '', avg, type: DnD.creature.damageTypeOf(e.damageType) }], magical: true }));
      else if (e.type === 'salvezza') out.push(Object.assign(o, { save: { ability: e.saveAbility, dc: sc.dc, half: e.halfOnSave }, parts: [{ dice: '', avg, type: DnD.creature.damageTypeOf(e.damageType) }], magical: true }));
      else if (avg > 0) out.push(Object.assign(o, { auto: true, parts: [{ dice: '', avg, type: DnD.creature.damageTypeOf(e.damageType) }], magical: true }));
      else out.push(Object.assign(o, { buff: true }));
    }
    return out;
  }

  function allOptions(c, catalog) {
    return c.weapons.flatMap((w) => weaponOptions(c, w, catalog)).concat(creatureOptions(c), spellOptions(c));
  }
  const attackOptions = (opts) => opts.filter((o) => !o.heal && !o.buff);

  // Danno atteso di un'opzione sul bersaglio (probabilità di colpire o di fallire il tiro salvezza, critici,
  // vulnerabilità, resistenze e immunità del bersaglio). disadvantage: tiro con svantaggio.
  function expectedDamage(o, target, disadvantage) {
    if (o.multi) return o.multi.reduce((s, m) => s + expectedDamage(m, target, disadvantage), 0);
    const raw = (o.parts || []).map((p) => ({ amount: p.avg !== undefined ? p.avg : avgDice(p.dice) + (p.bonus || 0), type: p.type }));
    const dmg = DnD.creature.applyDamageParts(raw.map((p) => ({ amount: Math.max(0, p.amount), type: p.type })), target.defenses, o.magical).total;
    if (o.auto) return dmg;
    if (o.save) {
      const bonus = (target.saves && target.saves[o.save.ability]) || 0;
      const fail = Math.min(0.95, Math.max(0.05, (o.save.dc - bonus - 1) / 20));
      return dmg * (fail + (o.save.half ? (1 - fail) / 2 : 0));
    }
    let p = Math.min(0.95, Math.max(0.05, (21 - (target.ac - (o.toHit || 0))) / 20));
    if (disadvantage) p *= p;
    return dmg * p;
  }

  // ---------- Archetipo automatico ----------
  // Caratteristica dell'arma principale: DES per le armi a distanza o accurate, FOR altrimenti.
  function weaponAbility(c, catalog) {
    if (c.creature) {
      const a = DnD.creature.allActions(c.creature).find((x) => x.mech.kind === 'attacco');
      return a ? a.mech.ability : null;
    }
    const w = c.weapons[0];
    if (!w) return null;
    const e = w.equipmentId ? (catalog || []).find((x) => x.id === w.equipmentId && x.weapon) : null;
    if (e) return e.weapon.kind === 'distanza' || e.weapon.props.includes('accurata') ? 'DES' : 'FOR';
    return weaponOptions(c, w, catalog).some((o) => o.ranged && !o.thrown) ? 'DES' : 'FOR';
  }
  // "Automatico": la caratteristica più alta (valori finali); a parità vince l'ordine FOR, DES, COS, INT, SAG,
  // CAR, salvo che tra le pari ci sia quella coerente con l'arma equipaggiata.
  function archetypeOf(c, catalog) {
    const b = c.behavior || normalizeBehavior();
    if (b.archetype !== 'auto') return b.archetype;
    const ab = c.abilities || {};
    const max = Math.max(...AB.map((k) => Number(ab[k]) || 0));
    const tied = AB.filter((k) => (Number(ab[k]) || 0) === max);
    if (tied.length > 1) {
      const wa = weaponAbility(c, catalog);
      if (wa && tied.includes(wa)) return wa;
    }
    return tied[0];
  }

  // ---------- Punteggi ----------
  const isCaster = (c) => Boolean(c.spellcasting && c.spellcasting.spells.length) || K().CASTER_CLASSES.includes(c.classId);
  function weakness(t, attacker, combatants, damageType, rel) {
    const W = K().WEAKNESS;
    const near = combatants.some((o) => o.id !== t.id && alive(o) && isAlly(o, t, rel) && G().tokenDistance(o, t) !== null && G().tokenDistance(o, t) <= 2);
    const terms = {
      hp: 1 - Math.min(1, t.hp / K().HP_SCALE),
      ac: Math.min(1, Math.max(0, (20 - t.ac) / 10)),
      caster: isCaster(t) ? 1 : 0,
      isolated: near ? 0 : 1,
      vulnerable: damageType && t.defenses && t.defenses.vuln.includes(damageType) ? 1 : 0,
      // Condizioni del bersaglio che danno vantaggio all'attaccante (in mischia, da vicino).
      advantage: DnD.condizioni.attackMods(attacker, t, { melee: true, distance: 1 }).adv.some((x) => x.startsWith('bersaglio')) ? 1 : 0,
    };
    return { score: Object.keys(W).reduce((s, k) => s + W[k] * terms[k], 0), terms };
  }
  // Danno medio per round stimato dalle armi, azioni e incantesimi del bersaglio.
  function damagePerRound(t, catalog) {
    const avgOf = (o) => {
      if (o.multi) return o.multi.reduce((s, m) => s + avgOf(m), 0);
      return (o.parts || []).reduce((s, p) => s + Math.max(0, p.avg !== undefined ? p.avg : avgDice(p.dice) + (p.bonus || 0)), 0);
    };
    const opts = attackOptions(allOptions(t, catalog));
    return opts.length ? Math.max(...opts.map(avgOf)) * K().HIT_CHANCE : 0;
  }
  function threat(t, catalog) {
    const T = K().THREAT;
    const level = t.creature ? DnD.creature.crValue(t.creature.cr) : t.level || 1;
    const dpr = damagePerRound(t, catalog);
    return { score: T.dpr * dpr + T.level * level + T.hp * t.maxHp, dpr: Math.round(dpr * 10) / 10, level };
  }

  // ---------- Casualità riproducibile ----------
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  }
  // Stesso combattimento, round e combattente = stessa sequenza (il turno è riproducibile).
  const rngFor = (seed, round, id) => makeRng((Number(seed) >>> 0) ^ hash(round + ':' + id));

  // ---------- Mappa: celle bloccate, costi, occupazione ----------
  function buildMap(state) {
    const grid = state.grid;
    const d = G().dims(grid);
    const blocked = grid.ignoreCollisions ? new Set() : G().blockedCells(G().boardOf(grid, [], state.tilesets));
    const cost = new Map();
    if (grid.tileMap && !grid.ignoreCollisions) {
      DnD.collisioni.eachCoveredCell(grid.tileMap, state.tilesets || DnD.tilemap.storeIndex(), (x, y, props) => {
        const k = G().key(x, y);
        if (props.cost > (cost.get(k) || 1)) cost.set(k, Math.min(4, props.cost));
      });
    }
    // Visione (visione.js): celle che bloccano la vista, luce e sensi per i bersagli visibili.
    const vision = DnD.visione.context(grid, state.combatants, { tilesets: state.tilesets });
    return { w: d.w, h: d.h, blocked, cost, vision };
  }
  const cellCost = (map, x, y) => map.cost.get(G().key(x, y)) || 1;

  // Linea di vista tra il centro di due celle (visione.js): bloccano le celle che bloccano la vista (strutture con
  // «Blocca la vista», porte chiuse, tile bloccanti), non le finestre.
  const lineOfSight = (map, a, b) => DnD.visione.lineOfSight(map.vision.sm, a, b);
  // Visibile se chi guarda lo vede (visione.canSee): linea di vista da una cella dell'ingombro, luce e sensi
  // (scurovisione, vista cieca, vista pura, percezione tellurica), invisibilità; i nascosti e chi è a terra no.
  function visible(map, viewer, target, viewerPos) {
    if (!target.pos || target.hidden || !alive(target)) return false;
    return DnD.visione.canSee(map.vision, viewer, target, viewerPos).seen;
  }

  // ---------- Percorso minimo ----------
  // Dijkstra con l'ingombro w×h, terreno difficile, strisciare e modalità di movimento del combattente e la
  // regola delle diagonali (state.rules): vedi movimento.js. Le pedine ostili bloccano, quelle alleate (o a
  // terra) si attraversano ma non ci si ferma sopra. opts: { deadline, now, maxCost }.
  const paths = (map, state, mover, opts) => DnD.movimento.reach(map, state, mover, Object.assign({ rules: state.rules, hostile: (a, b) => alive(b) && isHostile(a, b, state.relations) }, opts));
  const pathTo = (P, k) => P.path(k);
  // Tronca un percorso al budget di movimento, fermandosi sull'ultima cella dove si può stare.
  function truncate(P, path, budget) {
    let best = 0;
    for (let i = 0; i < path.length; i++) {
      const c = P.dist.get(G().key(path[i].x, path[i].y));
      if (c > budget) break;
      if (i === 0 || P.canEnd(path[i].x, path[i].y)) best = i;
    }
    return path.slice(0, best + 1);
  }
  const at = (mover, pos) => ({ pos, w: G().tokenDims(mover).w, h: G().tokenDims(mover).h });

  // ---------- Pianificazione ----------
  const tempName = (b) => K().TEMPERAMENT_NAMES[b.temperament].toLowerCase();
  // Velocità piena e residuo del turno in celle (piedi / piedi per cella della griglia, condizioni comprese).
  const speedCells = (c, state) => DnD.movimento.speedCells(c, state && state.rules, state && state.grid && state.grid.feetPerCell);
  const moveLeft = (c, state) => DnD.movimento.left(c, state && state.rules, state && state.grid && state.grid.feetPerCell);

  // state: { combatants, grid, catalog, tilesets, round, seed, relations (fazioni.table) }; opts: { forceTargetId, now, timeLimit }.
  function pianificaTurno(state, mover, opts) {
    const o = opts || {};
    const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const t0 = now();
    const deadline = t0 + (o.timeLimit === undefined ? K().PLANNER.timeLimit : o.timeLimit);
    const b = mover.behavior || normalizeBehavior();
    const arch = archetypeOf(mover, state.catalog);
    const header = mover.name + ' (' + tempName(b) + ', ' + arch + ')';
    const plan = { combatantId: mover.id, archetype: arch, temperament: b.temperament, path: mover.pos ? [Object.assign({}, mover.pos)] : [], moveCost: 0, dash: false,
      action: { kind: 'nessuna' }, bonus: null, reason: '', scores: [], reminders: [], fallback: false };
    if (!alive(mover)) return Object.assign(plan, { reason: header + ': è a terra.' });
    // Condizioni: incapacitato, paralizzato, stordito… = nessuna azione (salvo permesso del master).
    const blocked = mover.forceActions ? null : DnD.condizioni.actionBlock(mover);
    if (blocked) return Object.assign(plan, { reason: header + ': ' + blocked + '.' });
    if (!mover.pos) return Object.assign(plan, { reason: header + ': non è sulla griglia.' });
    const map = buildMap(state);
    const others = state.combatants.filter((c) => c.id !== mover.id);
    // Gli NPC neutrali ancora fuori dall'iniziativa (joinRound nel futuro) non contano.
    const active = (c) => alive(c) && c.pos && !(c.joinRound && c.joinRound > (state.round || 1));
    const hostiles = others.filter((c) => active(c) && isHostile(mover, c, state.relations));
    const allies = others.filter((c) => active(c) && isAlly(mover, c, state.relations));
    if (!hostiles.length) return Object.assign(plan, { reason: header + ': nessun avversario rimasto.' });
    const rng = rngFor(state.seed || 0, state.round || 1, mover.id);
    // Movimento: il residuo del turno; con lo Scatto si aggiunge la velocità piena.
    const budget = moveLeft(mover, state);
    const dashCap = budget + speedCells(mover, state);
    const P = paths(map, state, mover, { deadline, now });
    const opts2 = allOptions(mover, state.catalog);
    const attacks = attackOptions(opts2);
    const hpPct = mover.hp / mover.maxHp;
    if (P.aborted || now() > deadline) return fallback(state, map, mover, hostiles, plan, header, attacks);

    // Ignora chi non vede (buio, fuori vista, invisibile) se vede qualcun altro; altrimenti si avvicina al più vicino
    // che sente (senza sapere bene dove sia). I sensi speciali (vista cieca, tellurica, pura) contano come vista.
    const seen = hostiles.filter((t) => visible(map, mover, t));
    const pool = seen.length ? seen : hostiles;
    const dmgType = attacks.length && attacks[0].parts && attacks[0].parts[0] ? attacks[0].parts[0].type : '';
    // Costo per raggiungere una posizione di mischia accanto al bersaglio (o Infinity).
    const reachCost = (t, reach) => {
      let best = Infinity;
      let bestK = null;
      for (const [k, cost] of P.dist) {
        const x = G().keyX(k);
        const y = G().keyY(k);
        if (cost < best && (k === P.start || P.canEnd(x, y)) && G().tokenDistance(at(mover, { x, y }), t) <= reach) { best = cost; bestK = k; }
      }
      return { cost: best, key: bestK };
    };
    const info = pool.map((t) => ({ t, path: reachCost(t, 1).cost, weak: weakness(t, mover, state.combatants, dmgType, state.relations), thr: threat(t, state.catalog), line: G().tokenDistance(mover, t) }));
    plan.scores = info.map((x) => ({ id: x.t.id, name: x.t.name, percorso: x.path === Infinity ? null : x.path, distanza: x.line,
      debolezza: Math.round(x.weak.score * 100) / 100, minaccia: Math.round(x.thr.score * 10) / 10 }));
    if (!seen.length) plan.reminders.push('Non vede nessun avversario (buio, fuori vista o invisibile): si avvicina al più vicino che sente.');

    // Bersaglio secondo un criterio (con casualità: talvolta il secondo migliore).
    const pick = (list, key, desc) => {
      const sorted = list.slice().sort((a, c) => (desc ? key(c) - key(a) : key(a) - key(c)) || a.t.name.localeCompare(c.t.name, 'it'));
      if (sorted.length > 1 && b.randomness && rng() * 100 < b.randomness) return sorted[1];
      return sorted[0];
    };
    const byTemperament = (list) => (b.temperament === 'furbo'
      ? { x: pick(list, (x) => x.weak.score, true), why: 'bersaglio più debole' }
      : { x: pick(list, (x) => (x.path === Infinity ? 1000 + x.line : x.path), false), why: 'bersaglio più vicino' });

    // Fuga: solo i Furbi con la soglia attiva.
    if (b.fleeAt > 0 && b.temperament === 'furbo' && hpPct * 100 < b.fleeAt) return flee(P, mover, hostiles, plan, header, budget, '', dashCap);

    if (o.forceTargetId) {
      const f = info.find((x) => x.t.id === o.forceTargetId) || (hostiles.find((t) => t.id === o.forceTargetId) && { t: hostiles.find((t) => t.id === o.forceTargetId) });
      if (f) return attackPlan(f.t, 'bersaglio scelto dal master');
    }
    if (arch === 'CAR') {
      const support = supportPlan();
      if (support) return support;
    }
    if (arch === 'COS' && allies.length) {
      const g = guardPlan();
      if (g) return g;
    }
    let choice;
    if (arch === 'INT') choice = { x: pick(info, (x) => x.thr.score, true), why: 'bersaglio più pericoloso' };
    else if (arch === 'SAG') {
      const prio = info.filter((x) => (b.sagTargets || []).includes(x.t.classId));
      choice = prio.length ? { x: pick(prio, (x) => x.weak.score, true), why: 'incantatore prioritario (' + DnD.classi.className(prio[0].t.classId).toLowerCase() + ')' }
        : { x: pick(info, (x) => x.weak.score, true), why: 'bersaglio più debole' };
      if (prio.length) choice.why = 'incantatore prioritario (' + DnD.classi.className(choice.x.t.classId).toLowerCase() + ')';
    } else choice = byTemperament(info);
    return attackPlan(choice.x.t, choice.why);

    // --- Attacco: arma/azione migliore e posizione per usarla ---
    function attackPlan(target, why, onlyRanged) {
      const hostileAdjacent = (pos) => hostiles.some((h) => G().tokenDistance(at(mover, pos), h) <= 1);
      const keepRange = arch === 'DES' || arch === 'CAR';
      let best = null;
      for (const op of attacks) {
        if (onlyRanged && !op.ranged) continue;
        // Posizioni candidate entro il movimento.
        for (const [k, cost] of P.dist) {
          if (cost > budget) continue;
          const x = G().keyX(k);
          const y = G().keyY(k);
          if (k !== P.start && !P.canEnd(x, y)) continue;
          const pos = { x, y };
          const dd = G().tokenDistance(at(mover, pos), target);
          let ok;
          let dis = false;
          if (op.ranged) {
            if (dd > op.long || !visible(map, mover, target, pos)) continue;
            dis = dd > op.range || (!op.noDisadvantage && hostileAdjacent(pos));
            ok = true;
          } else ok = dd <= (op.reach || 1);
          if (!ok) continue;
          let value = expectedDamage(op, target, dis);
          // Area: conta i nemici vicini al bersaglio; mai se ci sono alleati o neutrali nell'area.
          let areaTargets = [target.id];
          if (op.area) {
            const inArea = (c) => G().tokenDistance(c, target) <= K().PLANNER.areaRadius;
            const bystanders = others.filter((c) => alive(c) && c.pos && !isHostile(mover, c, state.relations));
            if (bystanders.some(inArea) || inArea(at(mover, pos))) continue; // chi attacca conta dalla posizione d'arrivo
            const hit = hostiles.filter(inArea);
            if (op.source === 'incantesimo' && hit.length < 2) continue;
            areaTargets = hit.map((h) => h.id);
            value = hit.reduce((s, h) => s + expectedDamage(op, h, false), 0);
          }
          if (op.costly) {
            const free = attacks.filter((a) => !a.costly && !a.area).map((a) => expectedDamage(a, target, false));
            if (!op.area && value < K().PLANNER.slotWorth * Math.max(0, ...free)) continue;
          }
          // Preferenze di posizione: chi sta a distanza resta lontano (distanza preferita), gli altri muovono poco.
          const pref = b.preferredRange || op.range || 1;
          const posScore = keepRange && op.ranged
            ? -Math.abs(dd - Math.min(pref, op.range)) * 0.3 + Math.min(...hostiles.map((h) => G().tokenDistance(at(mover, pos), h))) * 0.2 - (dis ? 5 : 0)
            : -cost * 0.01;
          const score = value * 10 + posScore;
          if (!best || score > best.score) best = { score, op, pos, k, cost, dis, value, areaTargets };
        }
      }
      if (!best) {
        // Non arriva in tempo: Scatto verso il bersaglio (il più vicino possibile).
        const goal = reachCost(target, Math.max(1, ...attacks.filter((a) => !a.ranged).map((a) => a.reach || 1), 1));
        let key = goal.key;
        if (key === null) {
          let bd = Infinity;
          for (const [k] of P.dist) {
            const x = G().keyX(k);
            const y = G().keyY(k);
            if (!P.canEnd(x, y) && k !== P.start) continue;
            const dd = G().tokenDistance(at(mover, { x, y }), target);
            if (dd < bd) { bd = dd; key = k; }
          }
        }
        const path = truncate(P, pathTo(P, key), dashCap);
        Object.assign(plan, { path, moveCost: P.dist.get(G().key(path[path.length - 1].x, path[path.length - 1].y)), dash: true, action: { kind: 'scatto', targetIds: [target.id] } });
        plan.reason = header + ': ' + moveText(plan).replace(/ e $/, '') + ' (Scatto) verso ' + target.name + ', ' + why + '; non arriva ad attaccare in questo turno.';
        addReminders(plan.path);
        return plan;
      }
      const path = pathTo(P, best.k);
      const op = best.op;
      const kind = op.source === 'arma' ? 'arma' : op.source === 'creatura' ? 'creatura' : 'incantesimo';
      Object.assign(plan, {
        path, moveCost: best.cost,
        action: { kind, id: op.id, name: op.name, targetIds: best.areaTargets, slotLevel: op.slot || 0, mode: best.dis ? 'svantaggio' : 'normale', ranged: Boolean(op.ranged), expected: Math.round(best.value * 10) / 10 },
      });
      const verb = kind === 'incantesimo' ? 'lancia ' + op.name + (op.slot ? ' (slot ' + op.slot + '°)' : '') + ' su ' : (op.ranged ? 'attacca a distanza ' : 'attacca ');
      plan.reason = header + ': ' + moveText(plan) + verb + target.name + (best.areaTargets.length > 1 ? ' e altri ' + (best.areaTargets.length - 1) : '') +
        (kind !== 'incantesimo' ? ' con ' + op.name : '') + ', ' + why + (best.dis ? ' (con svantaggio: un nemico è adiacente)' : '') + '.';
      addReminders(path);
      return plan;
    }

    function moveText(p) {
      const n = p.path.length - 1;
      return n > 0 ? 'si sposta di ' + n + (n === 1 ? ' cella' : ' celle') + (p.moveCost > n ? ' (terreno difficile)' : '') + ' e ' : '';
    }
    // Promemoria degli attacchi di opportunità (nessuna automazione).
    function addReminders(path) {
      if (path.length < 2) return;
      const startPos = path[0];
      const endPos = path[path.length - 1];
      for (const h of hostiles) {
        if (G().tokenDistance(at(mover, startPos), h) <= 1 && G().tokenDistance(at(mover, endPos), h) > 1) {
          plan.reminders.push('Promemoria: ' + mover.name + ' esce dalla portata di ' + h.name + ' (possibile attacco di opportunità).');
        }
      }
    }

    // --- Scudo (COS): tra l'alleato più fragile e il nemico più vicino a lui ---
    function guardPlan() {
      const fragile = allies.slice().sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp || a.name.localeCompare(c.name, 'it'))[0];
      const menace = hostiles.slice().sort((a, c) => G().tokenDistance(a, fragile) - G().tokenDistance(c, fragile))[0];
      let best = null;
      for (const [k, cost] of P.dist) {
        const x = G().keyX(k);
        const y = G().keyY(k);
        if (k !== P.start && !P.canEnd(x, y)) continue;
        const pos = at(mover, { x, y });
        if (G().tokenDistance(pos, fragile) !== 1) continue;
        const score = G().tokenDistance(pos, menace) * 10 + cost * 0.1;
        if (!best || score < best.score) best = { score, k, cost };
      }
      if (!best) return null;
      let path = pathTo(P, best.k);
      if (best.cost > budget) path = truncate(P, path, budget);
      const end = path[path.length - 1];
      plan.path = path;
      plan.moveCost = P.dist.get(G().key(end.x, end.y));
      const endAt = at(mover, end);
      const melee = attacks.filter((a) => !a.ranged || G().tokenDistance(endAt, menace) <= a.long);
      const inReach = (t) => melee.some((a) => (a.ranged ? G().tokenDistance(endAt, t) <= a.long : G().tokenDistance(endAt, t) <= (a.reach || 1)));
      const target = inReach(menace) ? menace : hostiles.filter(inReach).sort((a, c) => G().tokenDistance(endAt, a) - G().tokenDistance(endAt, c))[0];
      const prefix = header + ': ' + moveText(plan) + 'si mette tra ' + fragile.name + ' e ' + menace.name;
      if (target) {
        const op = melee.filter((a) => (a.ranged ? G().tokenDistance(endAt, target) <= a.long : G().tokenDistance(endAt, target) <= (a.reach || 1)))
          .sort((a, c) => expectedDamage(c, target, false) - expectedDamage(a, target, false))[0];
        plan.action = { kind: op.source === 'arma' ? 'arma' : op.source === 'creatura' ? 'creatura' : 'incantesimo', id: op.id, name: op.name, targetIds: [target.id], slotLevel: op.slot || 0,
          mode: op.ranged && hostiles.some((h) => G().tokenDistance(endAt, h) <= 1) && !op.noDisadvantage ? 'svantaggio' : 'normale', ranged: Boolean(op.ranged) };
        plan.reason = prefix + ' e attacca ' + target.name + (target === menace ? ', che minaccia ' + fragile.name : ', il più vicino') + '.';
      } else if (hpPct < K().PLANNER.dodgeAt) {
        plan.action = { kind: 'schivare' };
        plan.reason = prefix + ' e usa Schivare (nessun attacco raggiungibile, PF sotto il 50%).';
      } else {
        plan.reason = prefix + '; nessun attacco raggiungibile.';
      }
      addReminders(path);
      return plan;
    }

    // --- Supporto (CAR): cura, poi incantesimi di supporto, poi Aiutare; lontano dai nemici ---
    function supportPlan() {
      const team = allies.concat([mover]);
      const minHostile = (pos) => Math.min(...hostiles.map((h) => G().tokenDistance(at(mover, pos), h)));
      // Posizione entro il movimento, entro gittata dall'alleato, la più lontana dai nemici.
      const spot = (ally, range) => {
        let best = null;
        for (const [k, cost] of P.dist) {
          if (cost > budget) continue;
          const x = G().keyX(k);
          const y = G().keyY(k);
          if (k !== P.start && !P.canEnd(x, y)) continue;
          const pos = { x, y };
          if ((ally.id === mover.id ? 0 : G().tokenDistance(at(mover, pos), ally)) > range) continue;
          if (ally.id !== mover.id && !visible(map, mover, ally, pos)) continue;
          const score = minHostile(pos) * 10 - cost * 0.1;
          if (!best || score > best.score) best = { score, k, cost };
        }
        return best;
      };
      const heals = opts2.filter((x) => x.heal);
      const hurt = team.filter((a) => a.hp / a.maxHp < K().PLANNER.supportAt).sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp);
      for (const ally of hurt) {
        for (const h of heals.slice().sort((a, c) => (a.slot || 0) - (c.slot || 0))) {
          const s = spot(ally, h.range || 1);
          if (!s) continue;
          Object.assign(plan, { path: pathTo(P, s.k), moveCost: s.cost,
            action: { kind: h.source === 'creatura' ? 'creatura' : 'incantesimo', id: h.id, name: h.name, targetIds: [ally.id], slotLevel: h.slot || 0, mode: 'normale', heal: true } });
          plan.reason = header + ': ' + moveText(plan) + 'cura ' + (ally.id === mover.id ? 'sé stesso' : ally.name) + ' con ' + h.name + ' (sotto il 50% dei PF).';
          addReminders(plan.path);
          return plan;
        }
      }
      const buffs = opts2.filter((x) => x.buff);
      if (buffs.length && allies.length) {
        const ally = allies.slice().sort((a, c) => threat(c, state.catalog).score - threat(a, state.catalog).score)[0];
        const bf = buffs[0];
        const s = spot(ally, bf.range || 1);
        if (s) {
          Object.assign(plan, { path: pathTo(P, s.k), moveCost: s.cost, action: { kind: 'incantesimo', id: bf.id, name: bf.name, targetIds: [ally.id], slotLevel: bf.slot || 0, mode: 'normale' } });
          plan.reason = header + ': ' + moveText(plan) + 'lancia ' + bf.name + ' su ' + ally.name + ' (supporto).';
          addReminders(plan.path);
          return plan;
        }
      }
      // Aiutare: un alleato già accanto a un nemico.
      const helped = allies.find((a) => hostiles.some((h) => G().tokenDistance(a, h) <= 1));
      if (helped) {
        const s = spot(helped, 1);
        if (s) {
          const foe = hostiles.find((h) => G().tokenDistance(helped, h) <= 1);
          Object.assign(plan, { path: pathTo(P, s.k), moveCost: s.cost, action: { kind: 'aiutare', targetIds: [helped.id], foeId: foe.id } });
          plan.reason = header + ': ' + moveText(plan) + 'usa Aiutare: ' + helped.name + ' ha vantaggio contro ' + foe.name + '.';
          addReminders(plan.path);
          return plan;
        }
      }
      // Niente di utile: attacca a distanza, altrimenti si ritira.
      const ranged = attacks.filter((a) => a.ranged);
      if (ranged.length) {
        const choice = byTemperament(info);
        const p = attackPlan(choice.x.t, choice.why + ', nient\'altro di utile da fare', true);
        if (p.action.kind !== 'scatto') return p;
      }
      return flee(P, mover, hostiles, plan, header, budget, 'si ritira: nessuna cura, supporto o attacco a distanza utile', dashCap);
    }
  }

  // Fuga: la posizione raggiungibile (con Scatto) più lontana dai nemici.
  function flee(P, mover, hostiles, plan, header, budget, why, dashCap) {
    let best = null;
    for (const [k, cost] of P.dist) {
      if (cost > dashCap) continue;
      const x = G().keyX(k);
      const y = G().keyY(k);
      if (k !== P.start && !P.canEnd(x, y)) continue;
      const dmin = Math.min(...hostiles.map((h) => G().tokenDistance(at(mover, { x, y }), h)));
      const score = dmin * 10 - cost * 0.1;
      if (!best || score > best.score) best = { score, k, cost };
    }
    const path = pathTo(P, best.k);
    Object.assign(plan, { path, moveCost: best.cost, dash: best.cost > budget, action: { kind: best.cost > budget ? 'scatto' : 'nessuna' } });
    const n = path.length - 1;
    plan.reason = header + ': ' + (why || 'fugge (PF sotto la soglia)') + (n ? ', si allontana di ' + n + (n === 1 ? ' cella' : ' celle') + (plan.dash ? ' con Scatto' : '') : '') + '.';
    const start = path[0];
    const end = path[path.length - 1];
    for (const h of hostiles) {
      if (G().tokenDistance(at(mover, start), h) <= 1 && G().tokenDistance(at(mover, end), h) > 1) plan.reminders.push('Promemoria: ' + mover.name + ' esce dalla portata di ' + h.name + ' (possibile attacco di opportunità).');
    }
    return plan;
  }

  // Ripiego (tempo scaduto): avvicinati in linea retta al più vicino e attacca se arrivi.
  function fallback(state, map, mover, hostiles, plan, header, attacks) {
    const target = hostiles.slice().sort((a, c) => G().tokenDistance(mover, a) - G().tokenDistance(mover, c))[0];
    const budget = moveLeft(mover, state);
    const P = paths(map, state, mover, { maxCost: budget });
    let path = [Object.assign({}, mover.pos)];
    let cur = mover.pos;
    for (let i = 0; i < budget; i++) {
      if (G().tokenDistance(at(mover, cur), target) <= 1) break;
      const step = { x: cur.x + Math.sign(target.pos.x - cur.x), y: cur.y + Math.sign(target.pos.y - cur.y) };
      if (!P.passable(step.x, step.y)) break;
      path.push(step);
      cur = step;
    }
    while (path.length > 1 && !P.canEnd(path[path.length - 1].x, path[path.length - 1].y)) path = path.slice(0, -1);
    const end = path[path.length - 1];
    const melee = attacks.find((a) => !a.ranged && G().tokenDistance(at(mover, end), target) <= (a.reach || 1));
    Object.assign(plan, { path, moveCost: path.length - 1, fallback: true,
      action: melee ? { kind: melee.source === 'arma' ? 'arma' : 'creatura', id: melee.id, name: melee.name, targetIds: [target.id], mode: 'normale' } : { kind: 'nessuna' } });
    plan.reason = header + ': calcolo troppo lungo, ripiego: si avvicina a ' + target.name + (melee ? ' e lo attacca' : '') + ' (il più vicino).';
    return plan;
  }

  // Testo dei punteggi per "Perché?".
  function whyText(plan) {
    const head = plan.reason + (plan.fallback ? ' (ripiego)' : '');
    const rows = plan.scores.map((s) => '• ' + s.name + ': percorso ' + (s.percorso === null ? 'irraggiungibile' : s.percorso + ' celle') + ', distanza ' + s.distanza +
      ', debolezza ' + s.debolezza + ', minaccia ' + s.minaccia);
    return [head, 'Archetipo ' + plan.archetype + ' (' + K().ARCHETYPE_NAMES[plan.archetype] + '), ' + K().TEMPERAMENT_NAMES[plan.temperament].toLowerCase() + '.', 'Bersagli considerati:'].concat(rows, plan.reminders).join('\n');
  }

  // Anteprima per il form: "Comportamento previsto: Orco, aggressivo, FOR → attacca da vicino il bersaglio più vicino".
  function describe(name, behavior, archetype, hasRanged) {
    const b = normalizeBehavior(behavior);
    const t = b.temperament === 'furbo' ? 'il bersaglio più debole' : 'il bersaglio più vicino';
    const what = {
      FOR: 'attacca da vicino ' + t,
      DES: hasRanged ? 'resta a distanza e colpisce ' + t : 'senza armi a distanza: attacca da vicino ' + t,
      COS: 'protegge l\'alleato più fragile e attacca chi lo minaccia',
      INT: 'attacca il bersaglio più pericoloso',
      SAG: 'caccia ' + b.sagTargets.join(', ') + ', altrimenti il più debole',
      CAR: 'cura e sostiene gli alleati, resta lontano dai nemici',
    }[archetype];
    const extra = b.fleeAt && b.temperament === 'furbo' ? '; fugge sotto il ' + b.fleeAt + '% dei PF' : '';
    return 'Comportamento previsto: ' + (name || 'Nemico') + ', ' + tempName(b) + ', ' + archetype + (b.archetype === 'auto' ? ' (automatico)' : '') + ' → ' + what + extra + '.';
  }

  // Annulla/Ripeti di un intero turno IA: ogni voce è { prima, dopo } (stati completi del combattimento).
  function turnHistory(limit) {
    const max = limit || 50;
    const past = [];
    let future = [];
    return {
      push(before, after) { past.push({ before, after }); if (past.length > max) past.shift(); future = []; },
      undo() { const e = past.pop(); if (!e) return null; future.push(e); return e.before; },
      redo() { const e = future.pop(); if (!e) return null; past.push(e); return e.after; },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      clear() { past.length = 0; future = []; },
    };
  }

  DnD.ia = {
    turnHistory, normalizeBehavior, defaultControl, defaultFaction, isHostile, isAlly, side,
    weaponOptions, creatureOptions, spellOptions, allOptions, expectedDamage, weaponAbility, archetypeOf,
    weakness, threat, damagePerRound, makeRng, rngFor, buildMap, lineOfSight, visible, paths, pathTo, truncate, speedCells, moveLeft,
    pianificaTurno, whyText, describe,
  };
})(globalThis.DnD = globalThis.DnD || {});
