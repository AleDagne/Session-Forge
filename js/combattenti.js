// Combattenti: valori derivati di un personaggio o nemico salvato (razza, classe, scheda, catalogo) e costruzione
// dei combattenti di uno scontro (giocatori, leggendari, nemici Standard, Creature e Boss).
// Livello regole, sopra regole.js. Espone DnD.combattenti { derivedStats, autoAc, spellStats, toCombatant,
// createCombatants }; usa DnD.regole, classi, magie, attrezzatura, scheda, leggendario, boss, creature, riposi,
// griglia, movimento, visione, ia, dadi. Non deve toccare il DOM. Unica eccezione nota: il catalogo predefinito
// dell'Attrezzatura si legge da DnD.store se non viene passato (audit, A6).
(function (DnD) {
  'use strict';

  const R = () => DnD.regole;

  // Valori derivati di una creatura salvata (razza, classe e modalità applicate).
  // Statistiche da incantatore (null se la classe non lancia incantesimi).
  function spellStats(c, info, abilities, profBonus) {
    if (!info || !info.caster) return null;
    const sc = c.spellcasting;
    const ability = sc.ability || info.spellAbility;
    const mod = R().modifier(abilities[ability]);
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
    return R().computeAc(c.armor, abilities, unarmored);
  }

  // catalog facoltativo: catalogo dell'Attrezzatura per armi e armatura scelte dal catalogo.
  function derivedStats(c, race, catalog) {
    const legendary = c.type === 'leggendario';
    // Scheda del giocatore (scheda.js): effetti dei talenti su caratteristiche, salvezze, CA, iniziativa e velocità.
    const fx = c.sheet && DnD.scheda ? DnD.scheda.featEffects(c) : null;
    const abilities = R().finalAbilities(c.abilities, race, fx ? DnD.scheda.addAbilities(c.asi, fx.abilities) : c.asi, c.ignoreCap, legendary ? c.abilityCap || 30 : 20);
    const base = DnD.classi.classInfo(c.classId, c.customClass);
    // Casella «Incantatore» della scheda per una classe che non lo è: incantesimi come la classe Personalizzata.
    const info = base && !base.caster && c.sheet && c.sheet.spellcaster ? Object.assign({}, base, { caster: c.sheet.casterType || 'completo', spellAbility: 'INT' }) : base;
    const profBonus = c.profBonusOverride === null || c.profBonusOverride === undefined ? R().proficiencyBonus(c.level, legendary) : c.profBonusOverride;
    const saves = [...new Set((c.saveMode === 'classe' ? (info ? info.saves.slice() : []) : c.saves).concat(fx ? fx.saves : []))];
    let ac = c.acMode === 'auto' ? autoAc(c, abilities, info && info.unarmored, catalog) : { total: c.ac, detail: 'Manuale: ' + c.ac };
    if (fx && fx.ac && c.acMode === 'auto') ac = { total: ac.total + fx.ac, detail: ac.detail.replace(/ = \d+$/, '') + ' + talenti ' + fx.ac + ' = ' + (ac.total + fx.ac) };
    const list = catalogOf(catalog);
    const init = c.sheet && DnD.scheda ? DnD.scheda.initiative(c, { abilities }, fx) : null;
    const spd = c.sheet && DnD.scheda ? DnD.scheda.speed(c, race, fx, list) : null;
    return {
      abilities, info, profBonus, saves, saveTotals: R().savingThrows(abilities, saves, profBonus), ac, fx,
      // Iniziativa: bonus oltre la DES; velocità a piedi della scheda (m), null se non è una scheda.
      initiativeBonus: init ? init.bonus : 0, sheetSpeed: spd ? spd.total : null,
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
    const dexMod = R().modifier(stats.abilities.DES);
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
      speeds: stats.sheetSpeed !== null
        ? Object.assign(DnD.movimento.speedsFromRace(race), { cammina: DnD.movimento.feetFromMeters(stats.sheetSpeed) })
        : DnD.movimento.addFeet(DnD.movimento.speedsFromRace(race), DnD.movimento.feetFromMeters(DnD.attrezzatura.speedBonus(source.inventory, list))),
      icon: Object.assign({}, source.icon),
      pos: null,
      weapons: stats.weapons.map((w) => Object.assign({}, w, { magical: magicOf(w) })),
      // Difese ai danni: le resistenze della razza (testo libero, es. "Veleno").
      defenses: { vuln: [], res: race ? DnD.creature.parseDefenses(race.resistances) : [], imm: [] },
      // Sensi (visione.js): la scurovisione della razza, in piedi.
      senses: DnD.visione.sensesFromRace(race),
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
    }, R().rollInitiative(dexMod + stats.initiativeBonus, rng));
  }

  // players: [personaggio]; npcEntries: [{ npc, quantity }] con nemici Standard o Creature. Le copie multiple
  // vengono numerate.
  function createCombatants(players, npcEntries, races, rng, spells, catalog) {
    const raceOf = (c) => races.find((r) => r.id === c.raceId) || null;
    // Leggendari: la scheda con gli effetti del Percorso, poi privilegi, difese e trasformazioni (leggendario.js).
    const st = { spells: spells || [], equipment: catalog || [], races };
    const out = players.map((p) => {
      // Stato della scheda (riposi.js): PF attuali, PF temporanei, dadi vita, sfinimento e risorse.
      if (p.type !== 'leggendario') return DnD.riposi.seedCombatant(toCombatant(p, 'player', p.name, 0, raceOf(p), rng, spells, catalog), p);
      const x = toCombatant(DnD.leggendario.effectivePlayer(p, st), 'player', p.name, 0, raceOf(p), rng, spells, catalog);
      return DnD.riposi.seedCombatant(DnD.leggendario.applyToCombatant(x, p, st, rng), p);
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
          out.push(DnD.riposi.seedCombatant(x, npc));
        } else out.push(DnD.riposi.seedCombatant(toCombatant(npc, 'npc', name, copy, raceOf(npc), rng, spells, catalog), npc));
      }
    }
    return out;
  }

  DnD.combattenti = { derivedStats, autoAc, spellStats, toCombatant, createCombatants };
})(globalThis.DnD = globalThis.DnD || {});
