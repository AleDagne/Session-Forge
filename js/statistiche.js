// Statistiche: valori derivati di un personaggio o nemico salvato (caratteristiche con razza, punti e talenti, bonus di
// competenza, salvezze, CA automatica, iniziativa e velocità della scheda, incantatore, armi del catalogo).
// Sta sotto scheda, boss, leggendario, riposi e combattenti, che la usano tutti.
// Livello regole, gruppo entità (base). Espone DnD.statistiche { derivedStats, autoAc, spellStats, catalogOf,
// featEffects, addAbilities, initiative, speed }; usa regole, classi, magie, attrezzatura. Non deve toccare il DOM.
// Eccezione (audit A6): talenti e catalogo predefiniti letti da DnD.store se il chiamante non li passa.
(function (DnD) {
  'use strict';

  const R = () => DnD.regole;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);

  // ---------- Talenti della scheda ----------
  const storeFeats = () => (DnD.store && DnD.store.state && DnD.store.state.feats) || [];
  // Talenti della scheda (privilegi con featId) e loro effetti sommati; i talenti eliminati finiscono in missing.
  function featEffects(c, feats) {
    const lib = feats || storeFeats();
    const out = { abilities: {}, skills: [], saves: [], ac: 0, hp: 0, hpPerLevel: 0, speed: 0, initiative: 0, names: [], missing: [] };
    for (const f of arr(c && c.sheet && c.sheet.features)) {
      if (!f.featId) continue;
      const feat = lib.find((x) => x.id === f.featId);
      if (!feat) { out.missing.push(f.name); continue; }
      const e = feat.effects;
      for (const [ab, v] of Object.entries(e.abilities)) out.abilities[ab] = (out.abilities[ab] || 0) + v;
      for (const k of e.skills) if (!out.skills.includes(k)) out.skills.push(k);
      for (const k of e.saves) if (!out.saves.includes(k)) out.saves.push(k);
      out.ac += e.ac; out.hp += e.hp; out.hpPerLevel += e.hpPerLevel; out.speed += e.speed; out.initiative += e.initiative;
      out.names.push(feat.name);
    }
    return out;
  }
  // Punti caratteristica più i bonus dei talenti (stesso tetto dei punti).
  const addAbilities = (asi, extra) => Object.fromEntries(R().ABILITIES.map((ab) => [ab, (obj(asi)[ab] || 0) + (obj(extra)[ab] || 0)]));

  // ---------- Iniziativa e velocità della scheda ----------
  // Bonus di iniziativa oltre la DES (scheda + talenti) o, se sovrascritta, la differenza dal valore scritto.
  function initiative(c, d, fx) {
    const dex = R().modifier(d.abilities.DES);
    const bonus = ((c.sheet && c.sheet.initiativeBonus) || 0) + ((fx && fx.initiative) || 0);
    const auto = dex + bonus;
    const ov = c.sheet ? c.sheet.overrides.initiative : null;
    return { auto, total: ov === null ? auto : ov, manual: ov !== null, bonus: (ov === null ? auto : ov) - dex,
      detail: 'DES ' + R().formatModifier(dex) + (bonus ? ' + bonus ' + R().formatModifier(bonus) : '') + ' = ' + R().formatModifier(auto) };
  }
  // Velocità a piedi (m): razza + oggetti equipaggiati + scheda + talenti, o il valore scritto.
  function speed(c, race, fx, catalog) {
    const base = race ? race.speed : 9;
    const items = DnD.attrezzatura.speedBonus(c.inventory, catalog || []);
    const extra = ((c.sheet && c.sheet.speedBonus) || 0) + ((fx && fx.speed) || 0);
    const auto = Math.max(0, Math.round((base + items + extra) * 10) / 10);
    const ov = c.sheet ? c.sheet.overrides.speed : null;
    const m = (v) => String(v).replace('.', ',') + ' m';
    return { auto, total: ov === null ? auto : ov, manual: ov !== null,
      detail: 'razza ' + m(base) + (items ? ' + oggetti ' + m(items) : '') + (extra ? ' + bonus ' + m(extra) : '') + ' = ' + m(auto) };
  }

  // ---------- Valori derivati ----------
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
    const fx = c.sheet ? featEffects(c) : null;
    const abilities = R().finalAbilities(c.abilities, race, fx ? addAbilities(c.asi, fx.abilities) : c.asi, c.ignoreCap, legendary ? c.abilityCap || 30 : 20);
    const base = DnD.classi.classInfo(c.classId, c.customClass);
    // Casella «Incantatore» della scheda per una classe che non lo è: incantesimi come la classe Personalizzata.
    const info = base && !base.caster && c.sheet && c.sheet.spellcaster ? Object.assign({}, base, { caster: c.sheet.casterType || 'completo', spellAbility: 'INT' }) : base;
    const profBonus = c.profBonusOverride === null || c.profBonusOverride === undefined ? R().proficiencyBonus(c.level, legendary) : c.profBonusOverride;
    const saves = [...new Set((c.saveMode === 'classe' ? (info ? info.saves.slice() : []) : c.saves).concat(fx ? fx.saves : []))];
    let ac = c.acMode === 'auto' ? autoAc(c, abilities, info && info.unarmored, catalog) : { total: c.ac, detail: 'Manuale: ' + c.ac };
    if (fx && fx.ac && c.acMode === 'auto') ac = { total: ac.total + fx.ac, detail: ac.detail.replace(/ = \d+$/, '') + ' + talenti ' + fx.ac + ' = ' + (ac.total + fx.ac) };
    const list = catalogOf(catalog);
    const init = c.sheet ? initiative(c, { abilities }, fx) : null;
    const spd = c.sheet ? speed(c, race, fx, list) : null;
    return {
      abilities, info, profBonus, saves, saveTotals: R().savingThrows(abilities, saves, profBonus), ac, fx,
      // Iniziativa: bonus oltre la DES; velocità a piedi della scheda (m), null se non è una scheda.
      initiativeBonus: init ? init.bonus : 0, sheetSpeed: spd ? spd.total : null,
      spell: c.spellcasting ? spellStats(c, info, abilities, profBonus) : null,
      weapons: (c.weapons || []).map((w) => DnD.attrezzatura.resolveWeapon(w, list, abilities, profBonus)),
    };
  }

  DnD.statistiche = { derivedStats, autoAc, spellStats, catalogOf, featEffects, addAbilities, initiative, speed };
})(globalThis.DnD = globalThis.DnD || {});
