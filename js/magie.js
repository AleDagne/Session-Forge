// Incantesimi come funzioni pure: CD e attacco, slot, livello superiore e risoluzione del lancio; file di incantesimi.
// Livello regole. Espone DnD.magie; usa DnD.dadi e DnD.regole (tiro per colpire, salvezze).
// Non deve toccare DOM, disco o rete (la normalizzazione degli incantesimi importati arriva come parametro).
(function (DnD) {
  'use strict';

  const SCHOOLS = ['abiurazione', 'ammaliamento', 'divinazione', 'evocazione', 'illusione', 'invocazione', 'necromanzia', 'trasmutazione'];
  const SCHOOL_NAMES = {
    abiurazione: 'Abiurazione', ammaliamento: 'Ammaliamento', divinazione: 'Divinazione', evocazione: 'Evocazione',
    illusione: 'Illusione', invocazione: 'Invocazione', necromanzia: 'Necromanzia', trasmutazione: 'Trasmutazione',
  };
  const EFFECTS = ['nessuno', 'attacco', 'salvezza', 'cura'];
  const EFFECT_NAMES = {
    nessuno: 'Nessun tiro (effetto automatico)', attacco: 'Attacco con incantesimo', salvezza: 'Tiro salvezza del bersaglio', cura: 'Cura',
  };

  function levelName(level) {
    return level === 0 ? 'Trucchetto' : level + '° livello';
  }

  function spellAttackBonus(profBonus, abilityMod) {
    return profBonus + abilityMod;
  }

  function spellSaveDc(profBonus, abilityMod) {
    return 8 + profBonus + abilityMod;
  }

  // Slot effettivi: valori calcolati, sostituiti dalle sovrascritture (null = automatico).
  function effectiveSlots(auto, overrides) {
    return auto.map((n, i) => (overrides && overrides[i] !== null && overrides[i] !== undefined ? overrides[i] : n));
  }

  function slotsLeft(total, used, slotLevel) {
    return Math.max(0, total[slotLevel - 1] - used[slotLevel - 1]);
  }

  // Livelli di slot con cui si può lanciare l'incantesimo (vuoto per i trucchetti: non usano slot).
  function castableLevels(spell, total, used) {
    if (spell.level === 0) return [];
    const out = [];
    for (let l = spell.level; l <= 9; l++) if (slotsLeft(total, used, l) > 0) out.push(l);
    return out;
  }

  function consumeSlot(used, total, slotLevel) {
    if (slotsLeft(total, used, slotLevel) <= 0) throw new Error('Nessuno slot di ' + slotLevel + '° livello disponibile.');
    return used.map((n, i) => (i === slotLevel - 1 ? n + 1 : n));
  }

  // Riposo lungo: tutti gli slot. Riposo breve: solo quelli della magia del patto.
  function longRest(used) {
    return used.map(() => 0);
  }
  function shortRest(used, isPact) {
    return isPact ? used.map(() => 0) : used.slice();
  }

  // Dadi dell'effetto al livello di slot scelto: base + (slot - livello) × dado extra.
  function scaledDice(spell, slotLevel) {
    const base = DnD.dadi.parseExpr(spell.effect.dice);
    if (!base) return null;
    const up = DnD.dadi.parseExpr(spell.effect.upcastDice);
    const extra = spell.level > 0 && up ? Math.max(0, slotLevel - spell.level) : 0;
    if (!extra) return { count: base.count, sides: base.sides, modifier: base.modifier };
    return { count: base.count + extra * up.count, sides: base.sides, modifier: base.modifier + extra * up.modifier };
  }

  // Risolve un incantesimo. p: { spell, slotLevel, caster: { attack, dc, mod }, targets: [{ id, ac, saves, mode, autoCrit,
  // saveMode, autoFail }], mode }: i campi del bersaglio (dalle condizioni) prevalgono sul modo comune.
  // Restituisce { dice, roll (danno/cura comune, se c'è), targets: [{ id, amount, ...dettagli del tiro }] }.
  function resolveSpell(p, rng) {
    const { spell, caster } = p;
    const e = spell.effect;
    const dice = scaledDice(spell, p.slotLevel);
    if (dice && e.type === 'cura' && e.addMod) dice.modifier += caster.mod;
    const rollDice = (mult) => (dice ? DnD.dadi.roll(dice.count * mult, dice.sides, dice.modifier, rng) : null);
    const out = { dice, roll: null, targets: [] };

    if (e.type === 'attacco') {
      for (const t of p.targets) {
        const h = DnD.regole.rollToHit({ mode: t.mode || p.mode, toHit: caster.attack, targetAC: t.ac, autoCrit: t.autoCrit }, rng);
        const r = h.hit ? rollDice(h.crit ? 2 : 1) : null;
        out.targets.push(Object.assign({ id: t.id }, h, { roll: r, amount: r ? Math.max(0, r.total) : 0 }));
      }
    } else if (e.type === 'salvezza') {
      out.roll = rollDice(1);
      const full = out.roll ? Math.max(0, out.roll.total) : 0;
      for (const t of p.targets) {
        const s = t.autoFail ? { natural: null, total: null, success: false } : DnD.regole.rollSave({ bonus: t.saves[e.saveAbility] || 0, mode: t.saveMode || 'normale', dc: caster.dc }, rng);
        out.targets.push({ id: t.id, natural: s.natural, saveTotal: s.total, success: s.success, autoFail: Boolean(t.autoFail), amount: s.success ? (e.halfOnSave ? Math.floor(full / 2) : 0) : full });
      }
    } else {
      // Cura e "nessun tiro": un solo tiro (se ci sono dadi) applicato a tutti i bersagli.
      out.roll = rollDice(1);
      const amount = out.roll ? Math.max(0, out.roll.total) : 0;
      for (const t of p.targets) out.targets.push({ id: t.id, amount });
    }
    return out;
  }

  // ---------- File di incantesimi (esporta / importa) ----------
  const FILE_KIND = 'incantesimi';
  function exportFile(spells, appName) {
    return { app: appName || 'Session Forge', kind: FILE_KIND, exportedAt: new Date().toISOString(), spells: JSON.parse(JSON.stringify(spells)) };
  }
  // Incantesimi da aggiungere alla libreria: accetta il file esportato o un elenco. Ognuno riceve un id nuovo; quelli con
  // lo stesso nome (maiuscole comprese) di uno già presente, o ripetuti nel file, vengono saltati.
  // normalize: DnD.dati.normalizeSpell. Restituisce { added, skipped: [nomi] } oppure lancia un errore in italiano.
  function importFile(raw, existing, normalize) {
    const list = Array.isArray(raw) ? raw : raw && raw.kind === FILE_KIND && Array.isArray(raw.spells) ? raw.spells : null;
    if (!list) throw new Error('il file non contiene incantesimi di questa app.');
    const names = new Set((existing || []).map((s) => s.name.trim().toLowerCase()));
    const added = [];
    const skipped = [];
    for (const item of list.slice(0, 1000)) {
      const sp = normalize(Object.assign({}, item, { id: undefined }));
      const key = sp.name.trim().toLowerCase();
      if (names.has(key)) { skipped.push(sp.name.trim()); continue; }
      names.add(key);
      added.push(sp);
    }
    return { added, skipped };
  }

  DnD.magie = {
    SCHOOLS, SCHOOL_NAMES, EFFECTS, EFFECT_NAMES, levelName,
    spellAttackBonus, spellSaveDc, effectiveSlots, slotsLeft, castableLevels, consumeSlot, longRest, shortRest,
    scaledDice, resolveSpell, FILE_KIND, exportFile, importFile,
  };
})(globalThis.DnD = globalThis.DnD || {});
