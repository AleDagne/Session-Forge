// Attrezzatura (catalogo degli oggetti di gioco, libreria globale): normalizzazione, calcolo di bonus per
// colpire, danno e CA dagli oggetti scelti, peso dell'inventario e precarica di armi e armature base del
// regolamento (solo nomi, danni, proprietà, CA, costi e pesi; nessuna descrizione). Funzioni pure.
// Livello regole. Espone DnD.attrezzatura (unica fonte per monete, valori in rame e peso delle monete); usa DnD.dadi,
// DnD.regole (modificatori) e DnD.icone.normalizeIcon. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const CATEGORIES = ['armi', 'armature', 'scudi', 'avventura', 'strumenti', 'consumabili', 'magici', 'tesori', 'altro'];
  const CATEGORY_NAMES = {
    armi: 'Armi', armature: 'Armature', scudi: 'Scudi', avventura: 'Equipaggiamento d\'avventura', strumenti: 'Strumenti',
    consumabili: 'Consumabili', magici: 'Oggetti magici', tesori: 'Tesori e gemme', altro: 'Altro',
  };
  const CURRENCIES = ['mr', 'ma', 'me', 'mo', 'mp'];
  const CURRENCY_NAMES = { mr: 'mr (rame)', ma: 'ma (argento)', me: 'me (electrum)', mo: 'mo (oro)', mp: 'mp (platino)' };
  const CURRENCY_VALUE = { mr: 1, ma: 10, me: 50, mo: 100, mp: 1000 }; // in monete di rame
  const RARITIES = ['comune', 'non comune', 'raro', 'molto raro', 'leggendario', 'artefatto'];
  const WEAPON_PROPS = ['accurata', 'a due mani', 'da lancio', 'leggera', 'pesante', 'portata', 'ricarica', 'munizioni', 'versatile', 'speciale'];
  const ARMOR_TYPES = ['leggera', 'media', 'pesante', 'scudo'];
  const ARMOR_TYPE_NAMES = { leggera: 'Leggera', media: 'Media', pesante: 'Pesante', scudo: 'Scudo' };
  const DEX_RULES = ['intera', 'max2', 'nessuna'];
  const DEX_RULE_NAMES = { intera: 'DES intera', max2: 'DES, massimo +2', nessuna: 'Nessuna DES' };
  const COIN_WEIGHT = 0.01; // kg per moneta (50 monete = 0,5 kg)
  // Vecchi tipi degli Oggetti -> categorie dell'Attrezzatura.
  const LEGACY_TYPES = { arma: 'armi', armatura: 'armature', pozione: 'consumabili', tesoro: 'tesori', chiave: 'altro', altro: 'altro' };

  // ---------- Normalizzazione ----------
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 2000) : '');
  function num(v, def, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  const int = (v, def, min, max) => Math.round(num(v, def, min, max));
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const diceOf = (v, def) => { const p = DnD.dadi.parseExpr(v); return p && p.count > 0 ? p.count + 'd' + p.sides : def; };
  const idOf = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : DnD.dadi.uid());

  function normalizeCoins(c) {
    c = obj(c);
    return Object.fromEntries(CURRENCIES.map((k) => [k, int(c[k], 0, 0, 10000000)]));
  }

  function normalizeEquipment(e) {
    e = obj(e);
    const cost = obj(e.cost);
    const w = obj(e.weapon);
    const a = obj(e.armor);
    const category = pick(e.category, CATEGORIES, 'altro');
    return {
      id: idOf(e.id),
      name: str(e.name, 60) || 'Oggetto',
      category,
      description: str(e.description, 3000),
      weight: num(e.weight, 0, 0, 100000),
      cost: { amount: num(cost.amount, 0, 0, 100000000), unit: pick(cost.unit, CURRENCIES, 'mo') },
      rarity: pick(e.rarity, RARITIES, 'comune'),
      attunement: Boolean(e.attunement),
      icon: DnD.icone.normalizeIcon(e.icon, true),
      tags: [...new Set(arr(e.tags).map((t) => str(t, 30).trim()).filter(Boolean))].slice(0, 20),
      // Bonus (o malus) alla velocità in metri quando l'oggetto è equipaggiato (es. stivali, armatura pesante).
      speedBonus: num(e.speedBonus, 0, -30, 30),
      weapon: category === 'armi' ? {
        cat: w.cat === 'guerra' ? 'guerra' : 'semplice',
        kind: w.kind === 'distanza' ? 'distanza' : 'mischia',
        dice: diceOf(w.dice, '1d6'),
        damageType: str(w.damageType, 40),
        versatile: w.versatile ? diceOf(w.versatile, '') : '',
        props: [...new Set(arr(w.props).filter((p) => WEAPON_PROPS.includes(p)))],
        rangeNormal: num(w.rangeNormal, 0, 0, 1000),
        rangeLong: num(w.rangeLong, 0, 0, 2000),
        magic: int(w.magic, 0, 0, 3),
      } : null,
      armor: category === 'armature' || category === 'scudi' ? {
        type: category === 'scudi' ? 'scudo' : pick(a.type, ['leggera', 'media', 'pesante'], 'leggera'),
        base: int(a.base, category === 'scudi' ? 2 : 11, 0, 30),
        dex: pick(a.dex, DEX_RULES, 'intera'),
        strength: int(a.strength, 0, 0, 30),
        stealthDis: Boolean(a.stealthDis),
        magic: int(a.magic, 0, 0, 3),
      } : null,
    };
  }

  // Inventario di un giocatore: [{ id, equipmentId, qty, equipped }].
  function normalizeInventory(list) {
    return arr(list).slice(0, 500).map((x) => {
      x = obj(x);
      // attuned: in sintonia (solo per gli oggetti che la richiedono, scheda.js).
      return { id: idOf(x.id), equipmentId: str(x.equipmentId, 64), qty: int(x.qty, 1, 0, 100000), equipped: Boolean(x.equipped), attuned: Boolean(x.attuned) };
    }).filter((x) => x.equipmentId);
  }

  // ---------- Calcoli ----------
  const mod = (score) => DnD.regole.modifier(score);
  const fmt = (n) => DnD.regole.formatModifier(n);

  // Caratteristica di un'arma: DES per le armi a distanza, la migliore tra FOR e DES per le accurate, altrimenti FOR.
  function weaponAbility(w, abilities) {
    if (w.props.includes('accurata')) return mod(abilities.DES) > mod(abilities.FOR) ? 'DES' : 'FOR';
    return w.kind === 'distanza' ? 'DES' : 'FOR';
  }

  // Bonus per colpire e danno di un'arma del catalogo: competenza + modificatore + bonus magico.
  function weaponStats(entry, abilities, profBonus) {
    const w = entry.weapon;
    const ability = weaponAbility(w, abilities);
    const m = mod(abilities[ability]);
    return {
      ability, toHit: profBonus + m + w.magic, damageDice: w.dice, damageBonus: m + w.magic, damageType: w.damageType,
      detail: 'competenza ' + fmt(profBonus) + ' + ' + ability + ' ' + fmt(m) + (w.magic ? ' + magia ' + fmt(w.magic) : ''),
    };
  }

  // Arma di una scheda collegata al catalogo: se "auto", bonus e danno si ricalcolano dalle caratteristiche;
  // altrimenti valgono quelli scritti a mano (anche per le armi senza catalogo).
  function resolveWeapon(weapon, catalog, abilities, profBonus) {
    const entry = weapon.equipmentId ? (catalog || []).find((e) => e.id === weapon.equipmentId && e.weapon) : null;
    if (!entry || !weapon.auto) return Object.assign({}, weapon);
    const s = weaponStats(entry, abilities, profBonus);
    return Object.assign({}, weapon, { name: weapon.name || entry.name, toHit: s.toHit, damageDice: s.damageDice, damageBonus: s.damageBonus, damageType: s.damageType });
  }

  // CA da armatura e scudo del catalogo (null = nessuno), più bonus extra (es. anello di protezione).
  // unarmoredAbility: difesa senza armatura (COS per il Barbaro, SAG per il Monaco), solo senza armatura.
  function armorAc(armorEntry, shieldEntry, abilities, unarmoredAbility, extra) {
    const dex = mod(abilities.DES);
    const parts = [];
    let total;
    if (armorEntry && armorEntry.armor) {
      const a = armorEntry.armor;
      const d = a.dex === 'nessuna' ? 0 : a.dex === 'max2' ? Math.min(2, dex) : dex;
      total = a.base + d;
      parts.push(armorEntry.name + ' ' + a.base);
      if (a.dex !== 'nessuna') parts.push('DES(' + fmt(d) + (a.dex === 'max2' && dex > 2 ? ', max +2' : '') + ')');
      if (a.magic) { total += a.magic; parts.push('magia ' + fmt(a.magic)); }
    } else if (unarmoredAbility) {
      const x = mod(abilities[unarmoredAbility]);
      total = 10 + dex + x;
      parts.push('Difesa senza armatura 10', 'DES(' + fmt(dex) + ')', unarmoredAbility + '(' + fmt(x) + ')');
    } else {
      total = 10 + dex;
      parts.push('10', 'DES(' + fmt(dex) + ')');
    }
    if (shieldEntry && shieldEntry.armor) {
      const s = shieldEntry.armor;
      total += s.base + s.magic;
      parts.push(shieldEntry.name + ' ' + (s.base + s.magic));
    }
    if (extra) { total += extra; parts.push('bonus ' + fmt(extra)); }
    return { total, detail: parts.join(' + ') + ' = ' + total };
  }

  // Peso totale dell'inventario (kg), monete comprese.
  function inventoryWeight(inventory, catalog, coins) {
    let kg = 0;
    for (const x of inventory || []) {
      const e = (catalog || []).find((c) => c.id === x.equipmentId);
      if (e) kg += e.weight * x.qty;
    }
    const n = coins ? CURRENCIES.reduce((s, k) => s + (coins[k] || 0), 0) : 0;
    return Math.round((kg + n * COIN_WEIGHT) * 100) / 100;
  }

  // Somma dei bonus di velocità (m) degli oggetti equipaggiati.
  function speedBonus(inventory, catalog) {
    let m = 0;
    for (const x of inventory || []) {
      if (!x.equipped) continue;
      const e = (catalog || []).find((c) => c.id === x.equipmentId);
      if (e && e.speedBonus) m += e.speedBonus;
    }
    return m;
  }

  // Aggiunge qty di un oggetto all'inventario (somma alla riga esistente non equipaggiata). Modifica inventory.
  function addToInventory(inventory, equipmentId, qty) {
    const row = inventory.find((x) => x.equipmentId === equipmentId && !x.equipped);
    if (row) row.qty += qty;
    else inventory.push({ id: DnD.dadi.uid(), equipmentId, qty, equipped: false });
    return inventory;
  }

  function addCoins(a, b) {
    return Object.fromEntries(CURRENCIES.map((k) => [k, (a[k] || 0) + (b[k] || 0)]));
  }

  const formatCost = (c) => (c && c.amount ? String(c.amount).replace('.', ',') + ' ' + c.unit : '—');
  const formatWeight = (kg) => (kg ? String(kg).replace('.', ',') + ' kg' : '—');
  const formatCoins = (c) => CURRENCIES.filter((k) => c && c[k]).map((k) => c[k] + ' ' + k).join(', ') || 'nessuna moneta';

  // Breve riepilogo dell'oggetto (elenchi e schede).
  function summary(e) {
    const speed = e.speedBonus ? 'velocità ' + (e.speedBonus > 0 ? '+' : '') + String(e.speedBonus).replace('.', ',') + ' m' : '';
    return [baseSummary(e), speed].filter(Boolean).join(' · ');
  }
  function baseSummary(e) {
    if (e.weapon) {
      const w = e.weapon;
      return [w.dice + ' ' + w.damageType, w.versatile ? 'versatile ' + w.versatile : '', w.props.filter((p) => p !== 'versatile').join(', '),
        w.rangeNormal ? 'gittata ' + w.rangeNormal + '/' + w.rangeLong + ' m' : '', w.magic ? '+' + w.magic : ''].filter(Boolean).join(' · ');
    }
    if (e.armor) {
      const a = e.armor;
      if (a.type === 'scudo') return 'CA +' + (a.base + a.magic);
      return 'CA ' + a.base + (a.dex === 'intera' ? ' + DES' : a.dex === 'max2' ? ' + DES (max 2)' : '') + (a.magic ? ' · +' + a.magic : '') +
        (a.strength ? ' · FOR ' + a.strength : '') + (a.stealthDis ? ' · svantaggio Furtività' : '');
    }
    return CATEGORY_NAMES[e.category];
  }

  // ---------- Precarica: armi e armature base ----------
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ICONS = { armi: 'spada', armature: 'armatura', scudi: 'scudo' };
  function weapon(name, cat, kind, dice, damageType, cost, unit, weight, props, extra) {
    return Object.assign({ name, category: 'armi', cost: { amount: cost, unit }, weight, weapon: Object.assign({ cat, kind, dice, damageType, props }, extra) });
  }
  function armor(name, type, base, dex, cost, weight, extra) {
    return { name, category: type === 'scudo' ? 'scudi' : 'armature', cost: { amount: cost, unit: 'mo' }, weight, armor: Object.assign({ type, base, dex }, extra) };
  }
  const R = (n, l) => ({ rangeNormal: n, rangeLong: l });
  const BASE = [
    // Armi semplici da mischia
    weapon('Ascia', 'semplice', 'mischia', '1d6', 'tagliente', 5, 'mo', 1, ['leggera', 'da lancio'], R(6, 18)),
    weapon('Bastone ferrato', 'semplice', 'mischia', '1d6', 'contundente', 2, 'ma', 2, ['versatile'], { versatile: '1d8' }),
    weapon('Falcetto', 'semplice', 'mischia', '1d4', 'tagliente', 1, 'mo', 1, ['leggera']),
    weapon('Giavellotto', 'semplice', 'mischia', '1d6', 'perforante', 5, 'ma', 1, ['da lancio'], R(9, 36)),
    weapon('Lancia', 'semplice', 'mischia', '1d6', 'perforante', 1, 'mo', 1.5, ['da lancio', 'versatile'], Object.assign(R(6, 18), { versatile: '1d8' })),
    weapon('Martello leggero', 'semplice', 'mischia', '1d4', 'contundente', 2, 'mo', 1, ['leggera', 'da lancio'], R(6, 18)),
    weapon('Mazza', 'semplice', 'mischia', '1d6', 'contundente', 5, 'mo', 2, []),
    weapon('Pugnale', 'semplice', 'mischia', '1d4', 'perforante', 2, 'mo', 0.5, ['accurata', 'leggera', 'da lancio'], R(6, 18)),
    weapon('Randello', 'semplice', 'mischia', '1d4', 'contundente', 1, 'ma', 1, ['leggera']),
    weapon('Randello pesante', 'semplice', 'mischia', '1d8', 'contundente', 2, 'ma', 5, ['a due mani']),
    // Armi semplici a distanza
    weapon('Arco corto', 'semplice', 'distanza', '1d6', 'perforante', 25, 'mo', 1, ['munizioni', 'a due mani'], R(24, 96)),
    weapon('Balestra leggera', 'semplice', 'distanza', '1d8', 'perforante', 25, 'mo', 2.5, ['munizioni', 'ricarica', 'a due mani'], R(24, 96)),
    weapon('Dardo', 'semplice', 'distanza', '1d4', 'perforante', 5, 'mr', 0.125, ['accurata', 'da lancio'], R(6, 18)),
    weapon('Fionda', 'semplice', 'distanza', '1d4', 'contundente', 1, 'ma', 0, ['munizioni'], R(9, 36)),
    // Armi da guerra da mischia
    weapon('Alabarda', 'guerra', 'mischia', '1d10', 'tagliente', 20, 'mo', 3, ['pesante', 'portata', 'a due mani']),
    weapon('Ascia bipenne', 'guerra', 'mischia', '1d12', 'tagliente', 30, 'mo', 3.5, ['pesante', 'a due mani']),
    weapon('Ascia da battaglia', 'guerra', 'mischia', '1d8', 'tagliente', 10, 'mo', 2, ['versatile'], { versatile: '1d10' }),
    weapon('Falcione', 'guerra', 'mischia', '1d10', 'tagliente', 20, 'mo', 3, ['pesante', 'portata', 'a due mani']),
    weapon('Frusta', 'guerra', 'mischia', '1d4', 'tagliente', 2, 'mo', 1.5, ['accurata', 'portata']),
    weapon('Lancia da cavaliere', 'guerra', 'mischia', '1d12', 'perforante', 10, 'mo', 3, ['portata', 'speciale']),
    weapon('Maglio', 'guerra', 'mischia', '2d6', 'contundente', 10, 'mo', 5, ['pesante', 'a due mani']),
    weapon('Martello da guerra', 'guerra', 'mischia', '1d8', 'contundente', 15, 'mo', 1, ['versatile'], { versatile: '1d10' }),
    weapon('Mazzafrusto', 'guerra', 'mischia', '1d8', 'contundente', 10, 'mo', 1, []),
    weapon('Morning star', 'guerra', 'mischia', '1d8', 'perforante', 15, 'mo', 2, []),
    weapon('Picca', 'guerra', 'mischia', '1d10', 'perforante', 5, 'mo', 9, ['pesante', 'portata', 'a due mani']),
    weapon('Piccone da guerra', 'guerra', 'mischia', '1d8', 'perforante', 5, 'mo', 1, []),
    weapon('Scimitarra', 'guerra', 'mischia', '1d6', 'tagliente', 25, 'mo', 1.5, ['accurata', 'leggera']),
    weapon('Spada corta', 'guerra', 'mischia', '1d6', 'perforante', 10, 'mo', 1, ['accurata', 'leggera']),
    weapon('Spada lunga', 'guerra', 'mischia', '1d8', 'tagliente', 15, 'mo', 1.5, ['versatile'], { versatile: '1d10' }),
    weapon('Spadone', 'guerra', 'mischia', '2d6', 'tagliente', 50, 'mo', 3, ['pesante', 'a due mani']),
    weapon('Stocco', 'guerra', 'mischia', '1d8', 'perforante', 25, 'mo', 1, ['accurata']),
    weapon('Tridente', 'guerra', 'mischia', '1d6', 'perforante', 5, 'mo', 2, ['da lancio', 'versatile'], Object.assign(R(6, 18), { versatile: '1d8' })),
    // Armi da guerra a distanza
    weapon('Arco lungo', 'guerra', 'distanza', '1d8', 'perforante', 50, 'mo', 1, ['munizioni', 'pesante', 'a due mani'], R(45, 180)),
    weapon('Balestra a mano', 'guerra', 'distanza', '1d6', 'perforante', 75, 'mo', 1.5, ['munizioni', 'leggera', 'ricarica'], R(9, 36)),
    weapon('Balestra pesante', 'guerra', 'distanza', '1d10', 'perforante', 50, 'mo', 9, ['munizioni', 'pesante', 'ricarica', 'a due mani'], R(30, 120)),
    // Armature leggere, medie, pesanti e scudo
    armor('Armatura imbottita', 'leggera', 11, 'intera', 5, 4, { stealthDis: true }),
    armor('Armatura di cuoio', 'leggera', 11, 'intera', 10, 5),
    armor('Armatura di cuoio borchiato', 'leggera', 12, 'intera', 45, 6.5),
    armor('Armatura di pelle', 'media', 12, 'max2', 10, 6),
    armor('Giaco di maglia', 'media', 13, 'max2', 50, 10),
    armor('Corazza di scaglie', 'media', 14, 'max2', 50, 22.5, { stealthDis: true }),
    armor('Corazza a piastre', 'media', 14, 'max2', 400, 10),
    armor('Mezza armatura', 'media', 15, 'max2', 750, 20, { stealthDis: true }),
    armor('Corazza ad anelli', 'pesante', 14, 'nessuna', 30, 20, { stealthDis: true }),
    armor('Cotta di maglia', 'pesante', 16, 'nessuna', 75, 27.5, { strength: 13, stealthDis: true }),
    armor('Armatura a strisce', 'pesante', 17, 'nessuna', 200, 30, { strength: 15, stealthDis: true }),
    armor('Armatura completa', 'pesante', 18, 'nessuna', 1500, 32.5, { strength: 15, stealthDis: true }),
    armor('Scudo', 'scudo', 2, 'intera', 10, 3),
  ];

  // Catalogo predefinito: id stabili ("eq-<nome>"), icone della libreria degli oggetti.
  function defaults() {
    return BASE.map((e) => normalizeEquipment(Object.assign({}, e, {
      id: 'eq-' + slug(e.name), icon: { kind: 'library', icon: ICONS[e.category], color: e.category === 'armi' ? '#b8bcc6' : '#8a6a3a' },
    })));
  }

  DnD.attrezzatura = {
    CATEGORIES, CATEGORY_NAMES, CURRENCIES, CURRENCY_NAMES, CURRENCY_VALUE, RARITIES, WEAPON_PROPS, ARMOR_TYPES, ARMOR_TYPE_NAMES,
    DEX_RULES, DEX_RULE_NAMES, COIN_WEIGHT, LEGACY_TYPES,
    normalizeEquipment, normalizeInventory, normalizeCoins, weaponAbility, weaponStats, resolveWeapon, armorAc,
    inventoryWeight, speedBonus, addToInventory, addCoins, formatCost, formatWeight, formatCoins, summary, defaults, slug,
  };
})(globalThis.DnD = globalThis.DnD || {});
