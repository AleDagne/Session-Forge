// Regole di D&D 5e come funzioni pure (nessun accesso al DOM o a localStorage).
(function (DnD) {
  'use strict';

  const ABILITIES = ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'];
  const ABILITY_NAMES = {
    FOR: 'Forza', DES: 'Destrezza', COS: 'Costituzione',
    INT: 'Intelligenza', SAG: 'Saggezza', CAR: 'Carisma',
  };
  const MODES = { normale: 'normale', vantaggio: 'vantaggio', svantaggio: 'svantaggio' };

  function modifier(score) {
    return Math.floor((score - 10) / 2);
  }

  function formatModifier(mod) {
    return mod >= 0 ? '+' + mod : String(mod);
  }

  // Il bonus razziale conta solo se la casella "applica" è spuntata.
  function racialBonus(race, ability) {
    const b = race && race.bonuses && race.bonuses[ability];
    return b && b.apply ? Number(b.value) || 0 : 0;
  }

  // Punti caratteristica: 2 ogni 4 livelli (livelli 4, 8, 12, 16, 20...).
  function asiPointsAvailable(level) {
    return 2 * Math.floor(level / 4);
  }

  function asiPointsAssigned(asi) {
    return asi ? ABILITIES.reduce((sum, ab) => sum + (asi[ab] || 0), 0) : 0;
  }

  // Valore finale = base + bonus razziale (se spuntato) + punti caratteristica assegnati.
  // I punti non portano oltre il tetto (20, o quello del personaggio leggendario, di base 30; salvo
  // ignoreCap); un valore già oltre il tetto per base e razza resta com'è.
  function finalAbilities(base, race, asi, ignoreCap, cap) {
    const top = cap || 20;
    const out = {};
    for (const ab of ABILITIES) {
      const raw = (Number(base[ab]) || 0) + racialBonus(race, ab);
      const points = (asi && asi[ab]) || 0;
      out[ab] = ignoreCap ? raw + points : Math.max(raw, Math.min(top, raw + points));
    }
    return out;
  }

  // Tiro di d20 con vantaggio/svantaggio: { rolls, natural }.
  function rollD20(mode, rng) {
    const rolls = mode === MODES.vantaggio || mode === MODES.svantaggio ? [rng(20), rng(20)] : [rng(20)];
    let natural = rolls[0];
    if (mode === MODES.vantaggio) natural = Math.max(...rolls);
    if (mode === MODES.svantaggio) natural = Math.min(...rolls);
    // Per i dadi animati (dadi.registratore): con vantaggio/svantaggio il dado scartato si mostra attenuato.
    if (rng.nota) rng.nota({ sides: 20, values: rolls, dropped: rolls.length > 1 ? [rolls.indexOf(natural) === 0 ? 1 : 0] : [], natural: true });
    return { rolls, natural };
  }

  // Risolve un attacco. 20 naturale: colpo critico (dadi di danno raddoppiati).
  // 1 naturale: fallimento automatico. Altrimenti colpisce se totale >= CA.
  function resolveAttack(p, rng) {
    const d20 = rollD20(p.mode, rng);
    const crit = d20.natural === 20;
    const fumble = d20.natural === 1;
    const total = d20.natural + p.toHit;
    const hit = crit || (!fumble && total >= p.targetAC);
    const result = {
      d20Rolls: d20.rolls, natural: d20.natural, total, hit, crit, fumble,
      damageRolls: [], damageDiceCount: 0, damage: 0,
    };
    if (hit) {
      const dice = DnD.dadi.parseExpr(p.damageDice);
      const count = dice && dice.count ? dice.count * (crit ? 2 : 1) : 0;
      const sides = dice ? dice.sides : 0;
      const flat = (dice ? dice.modifier : 0) + p.damageBonus;
      const r = DnD.dadi.roll(count, sides, flat, rng);
      result.damageRolls = r.rolls;
      result.damageDiceCount = count;
      result.damageSides = sides;
      result.damageFlat = flat;
      result.damage = Math.max(0, r.total);
    }
    return result;
  }

  function applyDamage(hp, amount) {
    return Math.max(0, hp - Math.max(0, Math.floor(amount)));
  }

  // La cura non supera mai i PF massimi.
  function heal(hp, maxHp, amount) {
    return Math.min(maxHp, hp + Math.max(0, Math.floor(amount)));
  }

  // Fascia della barra della vita: alto (verde) > 50%, medio (giallo) > 25%, basso (rosso).
  function hpLevel(hp, maxHp) {
    const pct = maxHp > 0 ? hp / maxHp : 0;
    if (pct > 0.5) return 'alto';
    if (pct > 0.25) return 'medio';
    return 'basso';
  }

  function isDown(c) {
    return c.hp <= 0;
  }

  function sortByInitiative(list) {
    return list.slice().sort((a, b) =>
      b.initiative - a.initiative || b.dexMod - a.dexMod || a.name.localeCompare(b.name, 'it'));
  }

  function firstTurn(order) {
    const c = order.find((x) => !isDown(x));
    return c ? c.id : null;
  }

  // Passa al prossimo combattente non a terra; incrementa il round quando l'ordine ricomincia.
  function nextTurn(order, currentId, round) {
    if (!order.some((c) => !isDown(c))) return { currentId, round };
    const idx = order.findIndex((c) => c.id === currentId);
    for (let i = 1; i <= order.length; i++) {
      const j = idx + i;
      const c = order[j % order.length];
      if (!isDown(c)) return { currentId: c.id, round: round + (j >= order.length ? 1 : 0) };
    }
    return { currentId, round };
  }

  function rollInitiative(dexMod, rng) {
    const roll = rng(20);
    if (rng.nota) rng.nota({ sides: 20, values: [roll], modifier: dexMod, total: roll + dexMod, natural: true });
    return { initiativeRoll: roll, initiative: roll + dexMod };
  }

  // ---------- Generazione delle caratteristiche ----------
  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

  function roll4d6DropLowest(rng) {
    const rolls = [rng(6), rng(6), rng(6), rng(6)];
    const dropIndex = rolls.indexOf(Math.min(...rolls));
    if (rng.nota) rng.nota({ sides: 6, values: rolls, dropped: [dropIndex], total: rolls.reduce((a, b) => a + b, 0) - rolls[dropIndex] });
    return { rolls, dropIndex, total: rolls.reduce((a, b) => a + b, 0) - rolls[dropIndex] };
  }

  // Fisher–Yates con rng(n) -> intero in [1, n].
  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng(i + 1) - 1;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Priorità di classe -> elenco di caratteristiche distinte (le alternative, es. FOR o DES, si scelgono a caso).
  function resolvePriority(priority, rng) {
    const out = [];
    for (const p of priority || []) {
      const options = (Array.isArray(p) ? p : [p]).filter((ab) => ABILITIES.includes(ab) && !out.includes(ab));
      if (options.length) out.push(options.length > 1 ? options[rng(options.length) - 1] : options[0]);
    }
    return out;
  }

  // opts: { mode: 'random' | 'classe', source: '4d6' | 'standard', priority }.
  // Restituisce { abilities: { FOR: n, ... }, rolls: { FOR: tiro 4d6 | null, ... } }.
  // 'classe': i valori ordinati dal più alto vanno alle caratteristiche prioritarie, gli altri a caso.
  function randomizeAbilities(opts, rng) {
    const entries = opts.source === 'standard'
      ? STANDARD_ARRAY.map((total) => ({ total, roll: null }))
      : ABILITIES.map(() => { const r = roll4d6DropLowest(rng); return { total: r.total, roll: r }; });
    const assigned = {};
    if (opts.mode === 'classe') {
      const sorted = entries.slice().sort((a, b) => b.total - a.total);
      const prio = resolvePriority(opts.priority, rng);
      prio.forEach((ab, i) => { assigned[ab] = sorted[i]; });
      const rest = shuffle(sorted.slice(prio.length), rng);
      ABILITIES.filter((ab) => !prio.includes(ab)).forEach((ab, i) => { assigned[ab] = rest[i]; });
    } else {
      // Con il 4d6 ogni caratteristica ha già il suo tiro; l'array standard va mescolato.
      const order = opts.source === 'standard' ? shuffle(entries, rng) : entries;
      ABILITIES.forEach((ab, i) => { assigned[ab] = order[i]; });
    }
    return {
      abilities: Object.fromEntries(ABILITIES.map((ab) => [ab, assigned[ab].total])),
      rolls: Object.fromEntries(ABILITIES.map((ab) => [ab, assigned[ab].roll])),
    };
  }

  // ---------- Punti ferita ----------
  function hitDieAverage(hitDie) {
    return hitDie / 2 + 1;
  }

  // Livello 1: massimo del dado + COS. Ogni livello successivo: tiro (o media) + COS, minimo 1 PF per livello.
  function computeHp(p, rng) {
    const { level, hitDie, conMod } = p;
    const average = p.method === 'media';
    let total = Math.max(1, hitDie + conMod);
    let clamped = hitDie + conMod < 1;
    const rolls = [];
    for (let l = 2; l <= level; l++) {
      const r = average ? hitDieAverage(hitDie) : rng(hitDie);
      rolls.push(r);
      if (r + conMod < 1) clamped = true;
      total += Math.max(1, r + conMod);
    }
    const n = level - 1;
    const parts = [String(hitDie)];
    if (n && average) parts.push(n + '×' + hitDieAverage(hitDie) + ' (media d' + hitDie + ')');
    if (n && !average) parts.push(n + (n === 1 ? ' tiro' : ' tiri') + ' 1d' + hitDie + ' [' + rolls.join(', ') + ']');
    parts.push(level + '×COS(' + formatModifier(conMod) + ')');
    const detail = parts.join(' + ') + ' = ' + total + (clamped ? ' (minimo 1 PF per livello)' : '');
    return { total, rolls, detail };
  }

  // ---------- Classe Armatura ----------
  const ARMOR_TYPES = ['nessuna', 'leggera', 'media', 'pesante'];
  const ARMOR_NAMES = { nessuna: 'Nessuna', leggera: 'Leggera', media: 'Media', pesante: 'Pesante' };
  const ARMOR_BASE = { nessuna: 10, leggera: 11, media: 14, pesante: 16 };

  // armor: { type, base, shield, unarmored }; unarmoredAbility: 'COS' (Barbaro), 'SAG' (Monaco) o null.
  function computeAc(armor, abilities, unarmoredAbility) {
    const dex = modifier(abilities.DES);
    const dexText = 'DES(' + formatModifier(dex) + ')';
    let total;
    let parts;
    if (armor.type === 'leggera') {
      total = armor.base + dex;
      parts = ['Armatura leggera ' + armor.base, dexText];
    } else if (armor.type === 'media') {
      total = armor.base + Math.min(2, dex);
      parts = ['Armatura media ' + armor.base, dex > 2 ? 'DES(' + formatModifier(dex) + ', max +2)' : dexText];
    } else if (armor.type === 'pesante') {
      total = armor.base;
      parts = ['Armatura pesante ' + armor.base];
    } else if (armor.unarmored && unarmoredAbility) {
      const extra = modifier(abilities[unarmoredAbility]);
      total = 10 + dex + extra;
      parts = ['Difesa senza armatura 10', dexText, unarmoredAbility + '(' + formatModifier(extra) + ')'];
    } else {
      total = 10 + dex;
      parts = ['10', dexText];
    }
    if (armor.shield) {
      total += 2;
      parts.push('Scudo 2');
    }
    if (armor.bonus) {
      total += armor.bonus;
      parts.push('Bonus magico ' + armor.bonus);
    }
    return { total, detail: parts.join(' + ') + ' = ' + total };
  }

  // ---------- Competenza e tiri salvezza ----------
  // Personaggi leggendari (livelli 20-40): 1 + livello/4 per eccesso, senza il tetto di +6 (fino a +11).
  function proficiencyBonus(level, legendary) {
    if (legendary === true) return 1 + Math.ceil(Math.max(1, level) / 4);
    return Math.min(6, 2 + Math.floor((Math.max(1, level) - 1) / 4));
  }

  function savingThrowTotal(score, proficient, profBonus) {
    return modifier(score) + (proficient ? profBonus : 0);
  }

  function savingThrows(abilities, proficient, profBonus) {
    return Object.fromEntries(ABILITIES.map((ab) => [ab, savingThrowTotal(abilities[ab], proficient.includes(ab), profBonus)]));
  }

  // Tiro salvezza: d20 (+ vantaggio/svantaggio) + bonus, confrontato con la CD se indicata.
  function rollSave(p, rng) {
    const d20 = rollD20(p.mode, rng);
    const total = d20.natural + p.bonus;
    return { d20Rolls: d20.rolls, natural: d20.natural, total, success: p.dc === null || p.dc === undefined ? null : total >= p.dc };
  }

  // Valori derivati di una creatura salvata (razza, classe e modalità applicate).
  // Statistiche da incantatore (null se la classe non lancia incantesimi).
  function spellStats(c, info, abilities, profBonus) {
    if (!info || !info.caster) return null;
    const sc = c.spellcasting;
    const ability = sc.ability || info.spellAbility;
    const mod = modifier(abilities[ability]);
    const M = DnD.magie;
    return {
      caster: info.caster,
      ability,
      mod,
      attack: sc.attackOverride === null ? M.spellAttackBonus(profBonus, mod) : sc.attackOverride,
      dc: sc.dcOverride === null ? M.spellSaveDc(profBonus, mod) : sc.dcOverride,
      slotsTotal: M.effectiveSlots(DnD.classi.slotTable(info.caster, c.level), sc.slotOverrides),
      slotsUsed: sc.slotsUsed.slice(),
    };
  }

  // Catalogo dell'Attrezzatura (di base quello dell'archivio).
  const catalogOf = (catalog) => catalog || (DnD.store ? DnD.store.state.equipment : []);

  // CA automatica: armatura e scudo del catalogo se scelti, altrimenti i campi scritti a mano.
  function autoAc(c, abilities, unarmored, catalog) {
    const list = catalogOf(catalog);
    const find = (id) => (id ? list.find((e) => e.id === id && e.armor) || null : null);
    const armor = find(c.armor.equipmentId);
    const shield = find(c.armor.shieldId);
    if (armor || shield) return DnD.attrezzatura.armorAc(armor, shield, abilities, armor ? null : unarmored, c.armor.bonus);
    return computeAc(c.armor, abilities, unarmored);
  }

  // catalog facoltativo: catalogo dell'Attrezzatura per armi e armatura scelte dal catalogo.
  function derivedStats(c, race, catalog) {
    const legendary = c.type === 'leggendario';
    const abilities = finalAbilities(c.abilities, race, c.asi, c.ignoreCap, legendary ? c.abilityCap || 30 : 20);
    const info = DnD.classi.classInfo(c.classId, c.customClass);
    const profBonus = c.profBonusOverride === null || c.profBonusOverride === undefined ? proficiencyBonus(c.level, legendary) : c.profBonusOverride;
    const saves = c.saveMode === 'classe' ? (info ? info.saves.slice() : []) : c.saves;
    const ac = c.acMode === 'auto' ? autoAc(c, abilities, info && info.unarmored, catalog) : { total: c.ac, detail: 'Manuale: ' + c.ac };
    const list = catalogOf(catalog);
    return {
      abilities, info, profBonus, saves, saveTotals: savingThrows(abilities, saves, profBonus), ac,
      spell: c.spellcasting ? spellStats(c, info, abilities, profBonus) : null,
      weapons: (c.weapons || []).map((w) => DnD.attrezzatura.resolveWeapon(w, list, abilities, profBonus)),
    };
  }

  // copy: numero della copia per i nemici multipli (0 se unico). Le celle occupate vengono dalla dimensione
  // sulla griglia (Automatica = dalla taglia della razza). spells: libreria; il combattente riceve una copia
  // degli incantesimi conosciuti. catalog: Attrezzatura (armi e armatura scelte dal catalogo).
  function toCombatant(source, kind, name, copy, race, rng, spells, catalog) {
    const stats = derivedStats(source, race, catalog);
    const dims = DnD.griglia.gridSizeFor(source.gridSize, race && race.size);
    const list = catalogOf(catalog);
    const magicOf = (w) => { const e = w.equipmentId && list.find((x) => x.id === w.equipmentId); return Boolean(w.magical || (e && e.weapon && e.weapon.magic)); };
    const sp = stats.spell;
    const dexMod = modifier(stats.abilities.DES);
    return Object.assign({
      id: DnD.dadi.uid(),
      sourceId: source.id,
      kind,
      name,
      copy,
      maxHp: source.maxHp,
      hp: source.maxHp,
      ac: stats.ac.total,
      dexMod,
      saves: stats.saveTotals,
      w: dims.w,
      h: dims.h,
      // Velocità in piedi per modalità (movimento.js): razza più gli oggetti equipaggiati.
      speeds: DnD.movimento.addFeet(DnD.movimento.speedsFromRace(race), DnD.movimento.feetFromMeters(DnD.attrezzatura.speedBonus(source.inventory, list))),
      icon: Object.assign({}, source.icon),
      pos: null,
      weapons: stats.weapons.map((w) => Object.assign({}, w, { magical: magicOf(w) })),
      // Difese ai danni: le resistenze della razza (testo libero, es. "Veleno").
      defenses: { vuln: [], res: race ? DnD.creature.parseDefenses(race.resistances) : [], imm: [] },
      creature: null,
      pendingSave: null,
      // Combattimento simulato: controllo, fazione, comportamento e dati per l'IA.
      control: DnD.ia.defaultControl(kind),
      faction: DnD.ia.defaultFaction(kind),
      behavior: DnD.ia.normalizeBehavior(source.behavior),
      abilities: Object.assign({}, stats.abilities),
      classId: source.classId || '',
      level: source.level || 1,
      hidden: false,
      spellcasting: sp ? {
        attack: sp.attack, dc: sp.dc, ability: sp.ability, mod: sp.mod, pact: sp.caster === 'patto',
        slotsTotal: sp.slotsTotal, slotsUsed: sp.slotsUsed,
        spells: (spells || []).filter((s) => source.spellcasting.known.includes(s.id)).map((s) => JSON.parse(JSON.stringify(s))),
      } : null,
    }, rollInitiative(dexMod, rng));
  }

  // players: [personaggio]; npcEntries: [{ npc, quantity }] con nemici Standard o Creature. Le copie multiple
  // vengono numerate.
  function createCombatants(players, npcEntries, races, rng, spells, catalog) {
    const raceOf = (c) => races.find((r) => r.id === c.raceId) || null;
    // Leggendari: la scheda con gli effetti del Percorso, poi privilegi, difese e trasformazioni (leggendario.js).
    const st = { spells: spells || [], equipment: catalog || [], races };
    const out = players.map((p) => {
      if (p.type !== 'leggendario') return toCombatant(p, 'player', p.name, 0, raceOf(p), rng, spells, catalog);
      const x = toCombatant(DnD.leggendario.effectivePlayer(p, st), 'player', p.name, 0, raceOf(p), rng, spells, catalog);
      return DnD.leggendario.applyToCombatant(x, p, st, rng);
    });
    for (const { npc, quantity } of npcEntries) {
      for (let k = 1; k <= quantity; k++) {
        const name = quantity > 1 ? npc.name + ' ' + k : npc.name;
        const copy = quantity > 1 ? k : 0;
        if (DnD.boss.isMonster(npc)) {
          const x = DnD.creature.toCombatant(npc, name, copy, rng, spells);
          // Boss: stato delle fasi e PF moltiplicati per il numero di giocatori (se previsto).
          if (DnD.boss.isBoss(npc)) {
            x.boss = DnD.boss.combatState(npc);
            x.maxHp = x.hp = Math.min(9999, DnD.boss.scaledHp(x.maxHp, players.length, x.boss.scaleByPlayers));
          }
          out.push(x);
        } else out.push(toCombatant(npc, 'npc', name, copy, raceOf(npc), rng, spells, catalog));
      }
    }
    return out;
  }

  DnD.regole = {
    ABILITIES, ABILITY_NAMES, MODES,
    modifier, formatModifier, racialBonus, finalAbilities, asiPointsAvailable, asiPointsAssigned, spellStats,
    rollD20, resolveAttack, applyDamage, heal, hpLevel, isDown,
    sortByInitiative, firstTurn, nextTurn, rollInitiative, createCombatants,
    STANDARD_ARRAY, roll4d6DropLowest, shuffle, resolvePriority, randomizeAbilities,
    hitDieAverage, computeHp, ARMOR_TYPES, ARMOR_NAMES, ARMOR_BASE, computeAc,
    proficiencyBonus, savingThrowTotal, savingThrows, rollSave, derivedStats, autoAc, toCombatant,
  };
})(globalThis.DnD = globalThis.DnD || {});
