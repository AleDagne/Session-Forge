// Generatore automatico di nemici (funzioni pure). Da razza, livello e classe produce un nemico
// completo: caratteristiche per classe, punti caratteristica, PF, armi e armatura, CA,
// incantesimi dalla libreria e note. Il risultato è un normale nemico, modificabile nel form.
(function (DnD) {
  'use strict';

  const R = DnD.regole;
  const C = DnD.classi;
  const E = DnD.equipaggiamento;
  const MIN_LEVEL = 1;
  const MAX_LEVEL = 20;
  const MAX_QUANTITY = 20;
  // Classi che conoscono trucchetti (Paladino e Ranger no).
  const CANTRIP_CLASSES = ['bardo', 'chierico', 'druido', 'mago', 'stregone', 'warlock'];
  // Attacco extra: [livello minimo, attacchi per azione].
  const EXTRA_ATTACK = {
    guerriero: [[5, 2], [11, 3], [20, 4]], barbaro: [[5, 2]], paladino: [[5, 2]], ranger: [[5, 2]], monaco: [[5, 2]],
  };

  const DEFAULTS = { quantity: 1, abilityMethod: '4d6', hpMethod: 'media', magicItems: false, name: '' };

  function validateOptions(o) {
    const errors = {};
    if (!o.raceId) errors.raceId = 'Scegli una razza.';
    DnD.validazione.intInRange(errors, 'level', o.level, MIN_LEVEL, MAX_LEVEL);
    if (errors.level) errors.level = 'Il livello deve essere un numero intero tra 1 e 20.';
    if (!o.classId) errors.classId = 'Scegli una classe.';
    DnD.validazione.intInRange(errors, 'quantity', o.quantity, 1, MAX_QUANTITY);
    if (String(o.name || '').length > 55) errors.name = 'Il nome può avere al massimo 55 caratteri.';
    return errors;
  }

  // Nomi distinti: "{base}" (o "{base} 2" se già usato) per un solo nemico, "{base} 1…N" per più nemici,
  // saltando i numeri già presenti.
  function numberedNames(base, count, existing) {
    const taken = new Set(existing.map((n) => n.toLowerCase()));
    if (count === 1 && !taken.has(base.toLowerCase())) return [base];
    const out = [];
    for (let n = count === 1 ? 2 : 1; out.length < count; n++) {
      const name = base + ' ' + n;
      if (!taken.has(name.toLowerCase())) out.push(name);
    }
    return out;
  }

  // Punti caratteristica (2 ai livelli 4, 8, 12, 16, 20): prima la caratteristica principale della
  // classe fino a 20, poi la seconda, poi COS, poi le altre prioritarie della classe e infine le restanti.
  // Mai oltre 20: i punti avanzati passano alla caratteristica successiva.
  function distributeAsi(base, race, level, priority) {
    const order = [...new Set([priority[0], priority[1], 'COS'].concat(priority, R.ABILITIES).filter(Boolean))];
    const asi = Object.fromEntries(R.ABILITIES.map((ab) => [ab, 0]));
    let points = R.asiPointsAvailable(level);
    while (points > 0) {
      const fin = R.finalAbilities(base, race, asi, false);
      const ab = order.find((x) => fin[x] < 20);
      if (!ab) break; // tutto a 20: i punti restano non assegnati
      asi[ab]++;
      points--;
    }
    return asi;
  }

  // Armi della classe: per colpire = competenza + mod. caratteristica (+ bonus magico), danno = mod (+ bonus magico).
  function buildWeapons(equipment, abilities, profBonus, level, magic) {
    return equipment.weapons.map((w) => {
      const mod = R.modifier(abilities[w.ability]);
      return { name: w.name, toHit: profBonus + mod + magic, damageDice: E.weaponDice(w, level), damageBonus: mod + magic, damageType: w.damageType };
    });
  }

  const hasMechanics = (s) => s.effect.type !== 'nessuno' || Boolean(s.effect.dice);
  const preferMechanics = (a, b) => hasMechanics(b) - hasMechanics(a) || a.name.localeCompare(b.name, 'it');

  function cantripLimit(level) {
    return level >= 10 ? 4 : level >= 4 ? 3 : 2;
  }

  function spellLimit(level) {
    return Math.min(10, level + 1);
  }

  // Sceglie dalla libreria: trucchetti (fino al massimo per livello) e incantesimi dei livelli di slot
  // disponibili, i più alti per primi, preferendo quelli con un effetto meccanico. Restituisce anche gli avvisi.
  function chooseSpells(library, classId, className, level, slots) {
    // La classe personalizzata può usare tutta la libreria (come nel form).
    const forClass = classId === C.CUSTOM ? library.slice() : library.filter((s) => s.classes.includes(classId));
    const warnings = [];
    const maxSlot = slots.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0);
    const wantCantrips = CANTRIP_CLASSES.includes(classId) || classId === C.CUSTOM ? cantripLimit(level) : 0;
    const wantSpells = maxSlot ? spellLimit(level) : 0;
    if (!wantCantrips && !wantSpells) return { known: [], warnings }; // es. Paladino di livello 1
    if (!forClass.length) {
      return { known: [], warnings: ['La libreria Magie non contiene incantesimi per la classe ' + className + ': il nemico non ha incantesimi.'] };
    }
    const cantrips = forClass.filter((s) => s.level === 0).sort(preferMechanics);
    const leveled = forClass.filter((s) => s.level > 0 && s.level <= maxSlot)
      .sort((a, b) => b.level - a.level || preferMechanics(a, b));
    const chosenCantrips = cantrips.slice(0, wantCantrips);
    const chosenSpells = leveled.slice(0, wantSpells);
    const missing = (wantCantrips - chosenCantrips.length) + (wantSpells - chosenSpells.length);
    if (missing > 0) {
      warnings.push('La libreria Magie ha pochi incantesimi per la classe ' + className + ': scelti ' +
        chosenCantrips.length + ' trucchetti su ' + wantCantrips + ' e ' + chosenSpells.length + ' incantesimi su ' + wantSpells + '.');
    }
    return { known: chosenCantrips.concat(chosenSpells).map((s) => s.id), warnings };
  }

  function extraAttacks(classId, level) {
    let n = 1;
    for (const [min, attacks] of EXTRA_ATTACK[classId] || []) if (level >= min) n = attacks;
    return n;
  }

  // Genera un nemico. o: { raceId, level, classId, abilityMethod, hpMethod, magicItems, name, sessionId }
  // ctx: { races, spells, customClass (per 'personalizzata') }. rng(n) -> intero in [1, n].
  function generateEnemy(o, ctx, rng) {
    const race = ctx.races.find((r) => r.id === o.raceId) || null;
    const isCustom = o.classId === C.CUSTOM;
    const customClass = isCustom ? ctx.customClass : { hitDie: 8, saves: [], priority: [], caster: '' };
    const info = C.classInfo(o.classId, customClass);
    if (!info) throw new Error('Classe non valida.');
    const className = C.className(o.classId);
    const equipment = E.EQUIPMENT[isCustom ? 'personalizzata' : o.classId];
    const level = o.level;
    const magic = o.magicItems ? E.magicBonus(level) : 0;
    const warnings = [];

    // 1-4. Caratteristiche per classe, bonus razziali (dalla razza) e punti caratteristica.
    const priority = R.resolvePriority(info.priority, rng);
    const base = R.randomizeAbilities({ mode: 'classe', source: o.abilityMethod === 'standard' ? 'standard' : '4d6', priority }, rng).abilities;
    const asi = distributeAsi(base, race, level, priority);
    const abilities = R.finalAbilities(base, race, asi, false);
    const profBonus = R.proficiencyBonus(level);

    // 5. Punti ferita dalla classe.
    const conMod = R.modifier(abilities.COS);
    const hp = R.computeHp({ level, hitDie: info.hitDie, conMod, method: o.hpMethod === 'tira' ? 'tira' : 'media' }, rng);

    // 9. Incantesimi.
    let known = [];
    if (info.caster) {
      const slots = C.slotTable(info.caster, level);
      const chosen = chooseSpells(ctx.spells, o.classId, className, level, slots);
      known = chosen.known;
      warnings.push(...chosen.warnings);
    }

    // 11. Note sugli aspetti non gestiti dal sistema.
    const notes = ['Generato automaticamente: ' + (race ? race.name : 'senza razza') + ', ' + className + ' di livello ' + level + '.'];
    const attacks = extraAttacks(o.classId, level);
    if (attacks > 1) notes.push('Attacco extra: ' + attacks + ' attacchi per azione.');
    if (magic) notes.push('Equipaggiamento magico +' + magic + ' (armi e CA).');

    const creature = DnD.dati.normalizeCreature({
      id: DnD.dadi.uid(),
      name: o.name,
      raceId: race ? race.id : '',
      level,
      classId: o.classId,
      customClass,
      abilities: base,
      asi,
      hpMode: 'auto',
      hpMethod: o.hpMethod === 'tira' ? 'tira' : 'media',
      hpBasis: { level, conMod, hitDie: info.hitDie },
      hpDetail: hp.detail,
      maxHp: hp.total,
      // 7-8. Armatura, scudo e difesa senza armatura per Barbaro e Monaco.
      acMode: 'auto',
      armor: { type: equipment.armor.type, base: equipment.armor.base, shield: equipment.shield, unarmored: Boolean(info.unarmored), bonus: magic },
      saveMode: 'classe',
      weapons: buildWeapons(equipment, abilities, profBonus, level, magic),
      spellcasting: { known },
      notes: notes.join('\n'),
      icon: { kind: 'shape', shape: 'cerchio', color: DnD.icone.CREATURE_COLORS.rosso },
      generated: true,
      origin: { raceId: o.raceId, level, classId: o.classId },
    }, false);
    // La CA salvata è quella calcolata (la CA automatica si ricalcola comunque dalle caratteristiche).
    creature.ac = R.derivedStats(creature, race).ac.total;
    creature.sessionId = o.sessionId || '';
    return { creature, warnings };
  }

  // Genera la quantità richiesta: ogni nemico ha tiri propri e un nome numerato.
  function generateEnemies(o, ctx, existingNames, rng) {
    const opts = Object.assign({}, DEFAULTS, o);
    const race = ctx.races.find((r) => r.id === opts.raceId);
    const base = opts.name.trim() || ((race ? race.name + ' ' : '') + C.className(opts.classId)).trim();
    return numberedNames(base, opts.quantity, existingNames).map((name) => generateEnemy(Object.assign({}, opts, { name }), ctx, rng));
  }

  // "Rigenera": rifà solo i tiri casuali, tenendo razza, livello, classe, opzioni e nome.
  function regenerate(previous, o, ctx, rng) {
    const again = generateEnemy(Object.assign({}, DEFAULTS, o, { name: previous.name }), ctx, rng);
    again.creature.id = previous.id;
    return again;
  }

  DnD.generatore = {
    MIN_LEVEL, MAX_LEVEL, MAX_QUANTITY, DEFAULTS, CANTRIP_CLASSES,
    validateOptions, numberedNames, distributeAsi, buildWeapons, chooseSpells, cantripLimit, spellLimit, extraAttacks,
    generateEnemy, generateEnemies, regenerate,
  };
})(globalThis.DnD = globalThis.DnD || {});
