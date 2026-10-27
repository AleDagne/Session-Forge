// Combattenti: costruzione dei combattenti di uno scontro (giocatori, leggendari, nemici Standard, Creature e Boss)
// a partire dalle schede salvate. I valori derivati sono in statistiche.js.
// Livello regole, in cima al gruppo entità. Espone DnD.combattenti { toCombatant, createCombatants }; usa statistiche,
// regole, leggendario, boss, creature, riposi, griglia, movimento, visione, ia-comportamento, attrezzatura, dadi.
// Non deve toccare il DOM. Eccezione (audit A6): il catalogo predefinito dell'Attrezzatura viene da DnD.store.
(function (DnD) {
  'use strict';

  const R = () => DnD.regole;
  const catalogOf = (catalog) => DnD.statistiche.catalogOf(catalog);

  // copy: numero della copia per i nemici multipli (0 se unico). Le celle occupate vengono dalla dimensione
  // sulla griglia (Automatica = dalla taglia della razza). spells: libreria; il combattente riceve una copia
  // degli incantesimi conosciuti. catalog: Attrezzatura (armi e armatura scelte dal catalogo).
  function toCombatant(source, kind, name, copy, race, rng, spells, catalog) {
    const stats = DnD.statistiche.derivedStats(source, race, catalog);
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
      control: DnD.iaComportamento.defaultControl(kind),
      faction: DnD.iaComportamento.defaultFaction(kind),
      behavior: DnD.iaComportamento.normalizeBehavior(source.behavior),
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

  DnD.combattenti = { toCombatant, createCombatants };
})(globalThis.DnD = globalThis.DnD || {});
