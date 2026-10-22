// Tabella delle 12 classi di D&D 5e: dado vita, competenze nei tiri salvezza,
// caratteristiche principali in ordine di priorità (un array interno = alternative equivalenti)
// e caratteristica aggiunta alla "Difesa senza armatura" (solo Barbaro e Monaco).
(function (DnD) {
  'use strict';

  const CUSTOM = 'personalizzata';
  const HIT_DICE = [6, 8, 10, 12];

  // caster: 'completo' | 'mezzo' | 'patto'; spellAbility: caratteristica da incantatore;
  // prepares: 'livello' (livello + mod) o 'meta' (metà livello + mod) per le classi che preparano.
  const CLASSES = {
    barbaro: { name: 'Barbaro', hitDie: 12, saves: ['FOR', 'COS'], priority: ['FOR', 'COS', 'DES'], unarmored: 'COS' },
    bardo: { name: 'Bardo', hitDie: 8, saves: ['DES', 'CAR'], priority: ['CAR', 'DES', 'COS'], caster: 'completo', spellAbility: 'CAR' },
    chierico: { name: 'Chierico', hitDie: 8, saves: ['SAG', 'CAR'], priority: ['SAG', 'COS', 'FOR'], caster: 'completo', spellAbility: 'SAG', prepares: 'livello' },
    druido: { name: 'Druido', hitDie: 8, saves: ['INT', 'SAG'], priority: ['SAG', 'COS', 'DES'], caster: 'completo', spellAbility: 'SAG', prepares: 'livello' },
    guerriero: { name: 'Guerriero', hitDie: 10, saves: ['FOR', 'COS'], priority: [['FOR', 'DES'], 'COS'] },
    ladro: { name: 'Ladro', hitDie: 8, saves: ['DES', 'INT'], priority: ['DES', 'INT', 'CAR'] },
    mago: { name: 'Mago', hitDie: 6, saves: ['INT', 'SAG'], priority: ['INT', 'COS', 'DES'], caster: 'completo', spellAbility: 'INT', prepares: 'livello' },
    monaco: { name: 'Monaco', hitDie: 8, saves: ['FOR', 'DES'], priority: ['DES', 'SAG', 'COS'], unarmored: 'SAG' },
    paladino: { name: 'Paladino', hitDie: 10, saves: ['SAG', 'CAR'], priority: ['FOR', 'CAR', 'COS'], caster: 'mezzo', spellAbility: 'CAR', prepares: 'meta' },
    ranger: { name: 'Ranger', hitDie: 10, saves: ['FOR', 'DES'], priority: ['DES', 'SAG', 'COS'], caster: 'mezzo', spellAbility: 'SAG' },
    stregone: { name: 'Stregone', hitDie: 6, saves: ['COS', 'CAR'], priority: ['CAR', 'COS', 'DES'], caster: 'completo', spellAbility: 'CAR' },
    warlock: { name: 'Warlock', hitDie: 8, saves: ['SAG', 'CAR'], priority: ['CAR', 'COS', 'DES'], caster: 'patto', spellAbility: 'CAR' },
  };
  const IDS = Object.keys(CLASSES);
  const CASTER_TYPES = ['completo', 'mezzo', 'patto'];
  const CASTER_NAMES = { completo: 'Incantatore completo', mezzo: 'Mezzo incantatore', patto: 'Magia del patto' };

  // Slot per livello di personaggio, nell'ordine dei livelli di slot 1°..9°.
  const FULL_SLOTS = {
    1: [2], 2: [3], 3: [4, 2], 4: [4, 3], 5: [4, 3, 2], 6: [4, 3, 3], 7: [4, 3, 3, 1], 8: [4, 3, 3, 2],
    9: [4, 3, 3, 3, 1], 10: [4, 3, 3, 3, 2], 11: [4, 3, 3, 3, 2, 1], 12: [4, 3, 3, 3, 2, 1],
    13: [4, 3, 3, 3, 2, 1, 1], 14: [4, 3, 3, 3, 2, 1, 1], 15: [4, 3, 3, 3, 2, 1, 1, 1], 16: [4, 3, 3, 3, 2, 1, 1, 1],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1], 18: [4, 3, 3, 3, 3, 1, 1, 1, 1], 19: [4, 3, 3, 3, 3, 2, 1, 1, 1], 20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
  };
  const HALF_SLOTS = {
    1: [], 2: [2], 3: [3], 4: [3], 5: [4, 2], 6: [4, 2], 7: [4, 3], 8: [4, 3], 9: [4, 3, 2], 10: [4, 3, 2],
    11: [4, 3, 3], 12: [4, 3, 3], 13: [4, 3, 3, 1], 14: [4, 3, 3, 1], 15: [4, 3, 3, 2], 16: [4, 3, 3, 2],
    17: [4, 3, 3, 3, 1], 18: [4, 3, 3, 3, 1], 19: [4, 3, 3, 3, 2], 20: [4, 3, 3, 3, 2],
  };
  // Magia del patto: [numero di slot, livello degli slot] per livello di personaggio.
  function pactSlots(level) {
    if (level >= 17) return [4, 5];
    if (level >= 11) return [3, 5];
    if (level >= 9) return [2, 5];
    if (level >= 7) return [2, 4];
    if (level >= 5) return [2, 3];
    if (level >= 3) return [2, 2];
    if (level >= 2) return [2, 1];
    return [1, 1];
  }

  // Slot totali (9 valori, dal 1° al 9° livello) per tipo di incantatore e livello (oltre il 20 vale il 20).
  function slotTable(caster, level) {
    const lv = Math.min(20, Math.max(1, level));
    const out = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (caster === 'patto') {
      const [count, slotLevel] = pactSlots(lv);
      out[slotLevel - 1] = count;
    } else if (caster === 'completo' || caster === 'mezzo') {
      (caster === 'completo' ? FULL_SLOTS : HALF_SLOTS)[lv].forEach((n, i) => { out[i] = n; });
    }
    return out;
  }

  // Dati effettivi della classe di una creatura (anche personalizzata); null se nessuna classe.
  function classInfo(classId, customClass) {
    if (CLASSES[classId]) return CLASSES[classId];
    if (classId === CUSTOM && customClass) {
      return {
        name: 'Personalizzata', hitDie: customClass.hitDie, saves: customClass.saves, priority: customClass.priority,
        caster: customClass.caster || undefined, spellAbility: customClass.caster ? 'INT' : undefined,
      };
    }
    return null;
  }

  function className(classId) {
    return CLASSES[classId] ? CLASSES[classId].name : classId === CUSTOM ? 'Personalizzata' : '';
  }

  // Riconosce una classe scritta come testo libero (es. "  guerriero ") -> id, altrimenti null.
  function matchClass(text) {
    const t = String(text || '').trim().toLowerCase();
    return IDS.find((id) => id === t || CLASSES[id].name.toLowerCase() === t) || null;
  }

  DnD.classi = { CUSTOM, HIT_DICE, CLASSES, IDS, CASTER_TYPES, CASTER_NAMES, slotTable, classInfo, className, matchClass };
})(globalThis.DnD = globalThis.DnD || {});
