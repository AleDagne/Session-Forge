// Validazione dei dati dei form. Ogni funzione restituisce un oggetto { campo: messaggio }:
// vuoto se tutto è valido. Le chiavi annidate usano il punto (es. "weapons.0.damageDice").
(function (DnD) {
  'use strict';

  const SIZES = ['Minuscola', 'Piccola', 'Media', 'Grande', 'Enorme', 'Mastodontica'];

  function intInRange(errors, key, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[key] = 'Inserisci un numero intero tra ' + min + ' e ' + max + '.';
    }
  }

  function requiredText(errors, key, value, label, maxLen) {
    const s = String(value || '').trim();
    if (!s) errors[key] = label + ' è obbligatorio.';
    else if (s.length > maxLen) errors[key] = label + ' può avere al massimo ' + maxLen + ' caratteri.';
  }

  function validateRace(r) {
    const errors = {};
    requiredText(errors, 'name', r.name, 'Il nome', 60);
    if (!SIZES.includes(r.size)) errors.size = 'Scegli una taglia.';
    if (!Number.isFinite(r.speed) || r.speed < 0 || r.speed > 100) {
      errors.speed = 'Inserisci una velocità tra 0 e 100 metri.';
    }
    if (r.darkvision !== null && (!Number.isFinite(r.darkvision) || r.darkvision < 0 || r.darkvision > 200)) {
      errors.darkvision = 'Inserisci una distanza tra 0 e 200 metri, oppure lascia vuoto.';
    }
    for (const ab of DnD.regole.ABILITIES) {
      intInRange(errors, 'bonuses.' + ab, r.bonuses[ab].value, -10, 10);
    }
    return errors;
  }

  // Le armi scelte dal catalogo in automatico hanno bonus e danno calcolati: si controlla solo il nome.
  function validateWeapon(w, prefix, errors) {
    requiredText(errors, prefix + 'name', w.name, "Il nome dell'arma", 60);
    if (w.equipmentId && w.auto) return;
    intInRange(errors, prefix + 'toHit', w.toHit, -20, 30);
    const dice = DnD.dadi.parseExpr(w.damageDice);
    if (!dice || dice.count < 1 || dice.modifier !== 0) {
      errors[prefix + 'damageDice'] = 'Usa il formato NdM, ad esempio 1d8 o 2d6.';
    }
    intInRange(errors, prefix + 'damageBonus', w.damageBonus, -20, 30);
  }

  // opts.playerName: true per i giocatori (nome del giocatore reale obbligatorio).
  function validateCreature(c, opts) {
    const errors = {};
    requiredText(errors, 'name', c.name, 'Il nome', 60);
    if (opts && opts.playerName) requiredText(errors, 'playerName', c.playerName, 'Il nome del giocatore', 60);
    // Leggendari: livelli 20-40.
    if (c.type === 'leggendario') intInRange(errors, 'level', c.level, 20, 40);
    else intInRange(errors, 'level', c.level, 1, 30);
    for (const ab of DnD.regole.ABILITIES) intInRange(errors, 'abilities.' + ab, c.abilities[ab], 1, 30);
    const C = DnD.classi;
    if (c.classId && !C.CLASSES[c.classId] && c.classId !== C.CUSTOM) errors.classId = 'Scegli una classe valida.';
    if (c.classId === C.CUSTOM) {
      if (!C.HIT_DICE.includes(c.customClass.hitDie)) errors['customClass.hitDie'] = 'Scegli il dado vita.';
      const prio = c.customClass.priority;
      if (new Set(prio).size !== prio.length) errors['customClass.priority'] = 'Ogni caratteristica può comparire una sola volta.';
    }
    if (c.hpMode === 'auto' && !C.classInfo(c.classId, c.customClass)) errors.classId = 'Scegli una classe per calcolare i PF in automatico.';
    intInRange(errors, 'maxHp', c.maxHp, 1, 9999);
    if (c.acMode === 'auto') {
      if (c.armor.type !== 'nessuna') intInRange(errors, 'armor.base', c.armor.base, 0, 30);
      intInRange(errors, 'armor.bonus', c.armor.bonus, 0, 10);
    } else {
      intInRange(errors, 'ac', c.ac, 1, 40);
    }
    if (c.profBonusOverride !== null) intInRange(errors, 'profBonusOverride', c.profBonusOverride, 0, 20);
    if (c.type === 'leggendario') intInRange(errors, 'abilityCap', c.abilityCap, 20, 30);
    if (c.asi && Number.isInteger(c.level)) {
      const assigned = DnD.regole.asiPointsAssigned(c.asi);
      const available = DnD.regole.asiPointsAvailable(c.level);
      if (assigned > available) errors.asi = 'Hai assegnato ' + assigned + ' punti caratteristica ma al livello ' + c.level + ' ne hai ' + available + ': togline ' + (assigned - available) + ' con i pulsanti −.';
    }
    const sc = c.spellcasting;
    if (sc) {
      if (sc.attackOverride !== null) intInRange(errors, 'spell.attackOverride', sc.attackOverride, -10, 30);
      if (sc.dcOverride !== null) intInRange(errors, 'spell.dcOverride', sc.dcOverride, 0, 40);
      sc.slotOverrides.forEach((v, i) => { if (v !== null) intInRange(errors, 'spell.slot.' + i, v, 0, 20); });
      sc.slotsUsed.forEach((v, i) => intInRange(errors, 'spell.used.' + i, v, 0, 20));
    }
    c.weapons.forEach((w, i) => validateWeapon(w, 'weapons.' + i + '.', errors));
    validateGridSize(c.gridSize, errors);
    return errors;
  }

  // Dimensione sulla griglia: Automatica, oppure larghezza × altezza da 1 a 8 celle.
  function validateGridSize(gs, errors) {
    if (!gs || gs.auto) return;
    intInRange(errors, 'gridSize.w', gs.w, 1, 8);
    intInRange(errors, 'gridSize.h', gs.h, 1, 8);
  }

  // Creatura (Manuale dei Mostri).
  function validateMonster(c) {
    const errors = {};
    requiredText(errors, 'name', c.name, 'Il nome', 60);
    for (const ab of DnD.regole.ABILITIES) intInRange(errors, 'abilities.' + ab, c.abilities[ab], 1, 30);
    intInRange(errors, 'ac', c.ac, 1, 40);
    intInRange(errors, 'hitDice', c.hitDice, 1, 100);
    if (c.hpOverride !== null) intInRange(errors, 'hpOverride', c.hpOverride, 1, 9999);
    for (const k of DnD.creatureDati.SPEEDS) {
      if (!Number.isFinite(c.speed[k]) || c.speed[k] < 0 || c.speed[k] > 300) errors['speed.' + k] = 'Inserisci una velocità tra 0 e 300 metri.';
    }
    if (!DnD.creatureDati.CRS.includes(String(c.cr))) errors.cr = 'Scegli un grado di sfida.';
    intInRange(errors, 'legendaryResistance', c.legendaryResistance, 0, 10);
    intInRange(errors, 'legendaryPoints', c.legendaryPoints, 1, 10);
    const ids = new Set(DnD.creatureDati.GROUPS.flatMap((g) => c[g].map((a) => a.id)));
    for (const g of DnD.creatureDati.GROUPS) {
      c[g].forEach((a, i) => {
        const key = g + '.' + i;
        requiredText(errors, key + '.name', a.name, 'Il nome', 80);
        const m = a.mech;
        for (const d of m.damages || []) {
          const p = DnD.dadi.parseExpr(d.dice);
          if (!p || p.count < 1 || p.modifier) errors[key + '.dice'] = 'Usa il formato NdM per i dadi di danno, ad esempio 2d6.';
        }
        if (m.kind === 'multiattacco') {
          if (!m.parts.length) errors[key + '.parts'] = 'Indica almeno un\'azione del multiattacco.';
          if (m.parts.some((p) => !ids.has(p.actionId) || p.actionId === a.id)) errors[key + '.parts'] = 'Il multiattacco usa un\'azione che non esiste.';
        }
      });
    }
    validateGridSize(c.gridSize, errors);
    return errors;
  }

  // Proprietà di una griglia: dimensioni da 5 a 100 celle per lato, piedi per cella da 1 a 100.
  function validateGridProps(g) {
    const errors = {};
    if (g.name !== undefined) requiredText(errors, 'name', g.name, 'Il nome', 60);
    intInRange(errors, 'w', g.w, 5, 100);
    intInRange(errors, 'h', g.h, 5, 100);
    if (!Number.isFinite(g.feetPerCell) || g.feetPerCell < 1 || g.feetPerCell > 100) errors.feetPerCell = 'Inserisci un valore tra 1 e 100 piedi.';
    if (g.kind === 'esplorazione' && (!g.scale || !Number.isFinite(g.scale.value) || g.scale.value <= 0 || g.scale.value > 100000)) errors.scale = 'Indica quanto misura una cella (un numero positivo).';
    return errors;
  }

  const MAX_PRESET = 20;
  const MAX_CUSTOM = 10;

  function validateStructure(s) {
    const errors = {};
    requiredText(errors, 'name', s.name, 'Il nome', 60);
    if (!DnD.icone.HEX.test(s.color)) errors.color = 'Scegli un colore.';
    const max = s.mode === 'custom' ? MAX_CUSTOM : MAX_PRESET;
    intInRange(errors, 'w', s.w, 1, max);
    intInRange(errors, 'h', s.h, 1, max);
    if (s.mode === 'preset' && !DnD.griglia.PRESETS.includes(s.preset)) errors.preset = 'Scegli una forma.';
    if (!errors.w && !errors.h && !String(s.cells || '').includes('1')) errors.cells = 'Riempi almeno una cella.';
    return errors;
  }

  // Voce dell'Attrezzatura.
  function validateEquipment(e) {
    const errors = {};
    requiredText(errors, 'name', e.name, 'Il nome', 60);
    if (!DnD.attrezzatura.CATEGORIES.includes(e.category)) errors.category = 'Scegli una categoria.';
    if (!Number.isFinite(e.weight) || e.weight < 0 || e.weight > 100000) errors.weight = 'Inserisci un peso (kg) tra 0 e 100000.';
    if (!Number.isFinite(e.cost.amount) || e.cost.amount < 0) errors['cost.amount'] = 'Inserisci un costo positivo o zero.';
    if (e.weapon) {
      const p = DnD.dadi.parseExpr(e.weapon.dice);
      if (!p || p.count < 1 || p.modifier) errors['weapon.dice'] = 'Usa il formato NdM, ad esempio 1d8.';
      if (e.weapon.versatile) { const v = DnD.dadi.parseExpr(e.weapon.versatile); if (!v || v.count < 1 || v.modifier) errors['weapon.versatile'] = 'Usa il formato NdM, ad esempio 1d10.'; }
      if (e.weapon.rangeLong && e.weapon.rangeLong < e.weapon.rangeNormal) errors['weapon.rangeLong'] = 'La gittata lunga non può essere minore della normale.';
    }
    if (e.armor) intInRange(errors, 'armor.base', e.armor.base, 0, 30);
    return errors;
  }

  // Modello di oggetto di mappa.
  function validateMapObject(o) {
    const errors = {};
    requiredText(errors, 'name', o.name, 'Il nome', 60);
    intInRange(errors, 'lock.dcPick', o.lock.dcPick, 1, 40);
    intInRange(errors, 'lock.dcForce', o.lock.dcForce, 1, 40);
    if (o.trap.enabled) {
      intInRange(errors, 'trap.dcFind', o.trap.dcFind, 1, 40);
      intInRange(errors, 'trap.dcDisarm', o.trap.dcDisarm, 1, 40);
      const p = DnD.dadi.parseExpr(o.trap.effect.dice);
      if (!p || p.count < 1) errors['trap.dice'] = 'Usa il formato NdM, ad esempio 2d10.';
      if (o.trap.effect.kind === 'salvezza') intInRange(errors, 'trap.dc', o.trap.effect.dc, 1, 40);
    }
    return errors;
  }

  function validateSpell(s) {
    const errors = {};
    requiredText(errors, 'name', s.name, 'Il nome', 60);
    intInRange(errors, 'level', s.level, 0, 9);
    if (!DnD.magie.SCHOOLS.includes(s.school)) errors.school = 'Scegli una scuola.';
    const e = s.effect;
    const dice = DnD.dadi.parseExpr(e.dice);
    if (e.dice && (!dice || dice.count < 1)) errors['effect.dice'] = 'Usa il formato NdM, ad esempio 8d6 o 3d4+3.';
    else if (!e.dice && e.type !== 'nessuno') errors['effect.dice'] = 'Indica il dado di danno o di cura.';
    if (e.upcastDice) {
      const up = DnD.dadi.parseExpr(e.upcastDice);
      if (!up || up.count < 1) errors['effect.upcastDice'] = 'Usa il formato NdM, ad esempio 1d6.';
      else if (dice && dice.count && up.sides !== dice.sides) errors['effect.upcastDice'] = 'Il dado extra deve avere le stesse facce del dado base (d' + dice.sides + ').';
    }
    if (s.components.M && !s.components.material.trim()) errors['components.material'] = 'Descrivi la componente materiale.';
    return errors;
  }

  DnD.validazione = {
    validateSpell, SIZES, MAX_PRESET, MAX_CUSTOM, validateRace, validateCreature, validateGridSize, validateMonster, validateGridProps,
    validateStructure, validateEquipment, validateMapObject, intInRange, requiredText,
  };
})(globalThis.DnD = globalThis.DnD || {});
