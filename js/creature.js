// Creature secondo le regole del Manuale dei Mostri (funzioni pure, nessun accesso al DOM): normalizzazione
// della scheda, calcoli automatici (competenza e PE dal grado di sfida, PF dai dadi vita della taglia,
// abilità, tiri salvezza, Percezione passiva), testo delle azioni in italiano nello stile del manuale,
// difese ai danni (valide per ogni combattente), combattimento (attacchi, salvezze, multiattacco, ricarica,
// usi giornalieri, Resistenza leggendaria, azioni leggendarie) e stima del grado di sfida (Guida del DM).
(function (DnD) {
  'use strict';

  const K = () => DnD.creatureDati;
  const R = () => DnD.regole;
  const AB = () => DnD.regole.ABILITIES;

  // ---------- Helper di normalizzazione ----------
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 2000) : '');
  function int(v, def, min, max) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  function num(v, def, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const nullableInt = (v, min, max) => (v === null || v === undefined || v === '' ? null : int(v, null, min, max));
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const idOf = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : DnD.dadi.uid());
  const uniq = (v, list) => [...new Set(arr(v).filter((x) => list.includes(x)))];
  const diceOf = (v, def) => { const p = DnD.dadi.parseExpr(v); return p && p.count > 0 ? p.count + 'd' + p.sides : def; };

  // ---------- Grado di sfida ----------
  const crIndex = (cr) => K().CRS.indexOf(String(cr));
  const crValue = (cr) => { const s = String(cr); return s.includes('/') ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s); };
  // CS 0-4 → +2, 5-8 → +3, 9-12 → +4, 13-16 → +5, 17-20 → +6, 21-24 → +7, 25-28 → +8, 29-30 → +9.
  function profForCr(cr) {
    const v = crValue(cr);
    return v < 5 ? 2 : 2 + Math.ceil((Math.floor(v) - 4) / 4);
  }
  const xpForCr = (cr) => K().XP[String(cr)] || 0;
  const formatXp = (xp) => String(xp).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ---------- Punti ferita ----------
  const hitDieFor = (size) => K().HIT_DIE[size] || 8;
  const avgDice = (count, sides) => Math.floor((count * (sides + 1)) / 2);
  function hpInfo(c) {
    const die = hitDieFor(c.size);
    const conMod = R().modifier(c.abilities.COS);
    const n = c.hitDice;
    const average = Math.max(1, avgDice(n, die) + n * conMod);
    const bonus = n * conMod;
    const formula = n + 'd' + die + (bonus ? (bonus > 0 ? ' + ' : ' − ') + Math.abs(bonus) : '');
    const total = c.hpOverride === null || c.hpOverride === undefined ? average : c.hpOverride;
    return { die, conMod, average, formula, total, text: total + ' (' + formula + ')' + (c.hpOverride !== null && c.hpOverride !== undefined ? ' · manuale' : '') };
  }

  // ---------- Abilità, salvezze, sensi ----------
  const mod = (c, ab) => R().modifier(c.abilities[ab]);
  const prof = (c) => profForCr(c.cr);
  const saveBonus = (c, ab) => mod(c, ab) + (c.saves.includes(ab) ? prof(c) : 0);
  // level: 1 = competenza, 2 = maestria (competenza raddoppiata).
  const skillBonus = (c, skill) => mod(c, K().SKILLS[skill]) + (c.skills[skill] || 0) * prof(c);
  const passivePerception = (c) => 10 + skillBonus(c, 'Percezione');
  const saveTotals = (c) => Object.fromEntries(AB().map((ab) => [ab, saveBonus(c, ab)]));

  // ---------- Normalizzazione della scheda ----------
  function normalizeDamage(d) {
    d = obj(d);
    return { dice: diceOf(d.dice, '1d6'), bonus: nullableInt(d.bonus, -20, 50), type: pick(d.type, K().DAMAGE_TYPES, '') };
  }

  function normalizeMech(m) {
    m = obj(m);
    const kind = pick(m.kind, K().MECHS, 'testo');
    const damages = arr(m.damages).slice(0, 6).map(normalizeDamage);
    if (kind === 'attacco') {
      return {
        kind, range: pick(m.range, K().RANGES, 'mischia'), ability: pick(m.ability, AB(), 'FOR'), toHit: nullableInt(m.toHit, -10, 30),
        reach: num(m.reach, 1.5, 0, 100), rangeNormal: num(m.rangeNormal, 0, 0, 1000), rangeLong: num(m.rangeLong, 0, 0, 2000),
        targets: str(m.targets, 60) || 'un bersaglio', damages: damages.length ? damages : [normalizeDamage({})], magical: Boolean(m.magical),
        inflict: DnD.condizioni.normalizeInflict(m.inflict),
      };
    }
    if (kind === 'salvezza') {
      return {
        kind, ability: pick(m.ability, AB(), 'DES'), dcAbility: pick(m.dcAbility, AB(), 'COS'), dc: nullableInt(m.dc, 1, 40),
        damages, half: m.half !== false, effect: str(m.effect, 300), area: str(m.area, 80),
        inflict: DnD.condizioni.normalizeInflict(m.inflict),
      };
    }
    if (kind === 'cura') return { kind, dice: diceOf(m.dice, '2d8'), bonus: int(m.bonus, 0, -20, 100) };
    if (kind === 'multiattacco') {
      return { kind, parts: arr(m.parts).slice(0, 10).map((p) => ({ actionId: str(obj(p).actionId, 64), count: int(obj(p).count, 1, 1, 10) })).filter((p) => p.actionId) };
    }
    return { kind: 'testo' };
  }

  function normalizeAction(a, group) {
    a = obj(a);
    const f = obj(a.freq);
    const out = {
      id: idOf(a.id),
      name: str(a.name, 80) || 'Azione',
      desc: str(a.desc, 3000),
      customText: Boolean(a.customText),
      mech: normalizeMech(a.mech),
      freq: { kind: pick(f.kind, K().FREQS, 'volonta'), uses: int(f.uses, 1, 1, 20), recharge: int(f.recharge, 5, 2, 6) },
    };
    if (group === 'legendary') out.cost = int(a.cost, 1, 1, 3);
    return out;
  }

  function normalizeMonster(c) {
    c = obj(c);
    const abilities = {};
    for (const ab of AB()) abilities[ab] = int(obj(c.abilities)[ab], 10, 1, 30);
    const sp = obj(c.speed);
    const se = obj(c.senses);
    const skills = {};
    for (const [k, v] of Object.entries(obj(c.skills))) if (K().SKILLS[k] && (v === 1 || v === 2)) skills[k] = v;
    const inn = obj(c.innate);
    const out = {
      type: 'creatura',
      size: pick(c.size, K().SIZES, 'Media'),
      ctype: pick(c.ctype, K().TYPES, 'mostruosità'),
      subtype: str(c.subtype, 40),
      alignment: str(c.alignment, 60),
      ac: int(c.ac, 12, 1, 40),
      acDesc: str(c.acDesc, 80),
      hitDice: int(c.hitDice, 2, 1, 100),
      hpOverride: nullableInt(c.hpOverride, 1, 9999),
      speed: {
        walk: num(sp.walk, 9, 0, 300), burrow: num(sp.burrow, 0, 0, 300), climb: num(sp.climb, 0, 0, 300),
        fly: num(sp.fly, 0, 0, 300), hover: Boolean(sp.hover), swim: num(sp.swim, 0, 0, 300),
      },
      abilities,
      saves: uniq(c.saves, AB()),
      skills,
      vulnerabilities: uniq(c.vulnerabilities, K().DEFENSE_TYPES),
      resistances: uniq(c.resistances, K().DEFENSE_TYPES),
      immunities: uniq(c.immunities, K().DEFENSE_TYPES),
      conditionImmunities: uniq(c.conditionImmunities, K().CONDITIONS),
      senses: Object.fromEntries(K().SENSES.map((k) => [k, num(se[k], 0, 0, 1000)])),
      passiveOverride: nullableInt(c.passiveOverride, 1, 50),
      languages: str(c.languages, 300),
      cr: K().CRS.includes(String(c.cr)) ? String(c.cr) : '1',
      legendaryResistance: int(c.legendaryResistance, 0, 0, 10),
      legendaryPoints: int(c.legendaryPoints, 3, 1, 10),
      innate: {
        ability: pick(inn.ability, AB(), 'CAR'),
        dcOverride: nullableInt(inn.dcOverride, 1, 40),
        attackOverride: nullableInt(inn.attackOverride, -10, 30),
        spells: arr(inn.spells).slice(0, 50).map((s) => {
          s = obj(s);
          return { spellId: str(s.spellId, 64), freq: s.freq === 'giorno' ? 'giorno' : 'volonta', uses: int(s.uses, 1, 1, 9) };
        }).filter((s) => s.spellId),
      },
    };
    for (const g of K().GROUPS) out[g] = arr(c[g]).slice(0, 40).map((a) => normalizeAction(a, g));
    return out;
  }

  // Tutte le voci della scheda (per trovare le azioni di un multiattacco).
  const allActions = (c) => K().GROUPS.flatMap((g) => (c[g] || []).map((a) => Object.assign({ group: g }, a)));
  const findAction = (c, id) => allActions(c).find((a) => a.id === id) || null;

  // ---------- Valori derivati delle azioni ----------
  const toHit = (c, m) => (m.toHit === null || m.toHit === undefined ? prof(c) + mod(c, m.ability) : m.toHit);
  // Bonus al danno: se non indicato, il primo danno di un attacco usa il modificatore della caratteristica.
  function damageBonus(c, m, i) {
    const d = m.damages[i];
    if (d.bonus !== null && d.bonus !== undefined) return d.bonus;
    return m.kind === 'attacco' && i === 0 ? mod(c, m.ability) : 0;
  }
  const saveDc = (c, m) => (m.dc === null || m.dc === undefined ? 8 + prof(c) + mod(c, m.dcAbility) : m.dc);
  function avgDamage(dice, bonus) {
    const p = DnD.dadi.parseExpr(dice);
    return Math.max(0, (p ? avgDice(p.count, p.sides) : 0) + bonus);
  }

  // ---------- Testo in stile manuale ----------
  const DAMAGE_WORDS = {
    acido: 'da acido', contundente: 'contundenti', freddo: 'da freddo', fulmine: 'da fulmine', fuoco: 'da fuoco', forza: 'da forza',
    necrotico: 'necrotici', perforante: 'perforanti', psichico: 'psichici', radioso: 'radiosi', tagliente: 'taglienti', tuono: 'da tuono', veleno: 'da veleno',
  };
  const NUMBERS = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'];
  const meters = (n) => String(Math.round(n * 10) / 10).replace('.', ',') + ' m';
  const signed = (n) => (n >= 0 ? '+' + n : '−' + Math.abs(n));

  function diceText(dice, bonus) {
    return avgDamage(dice, bonus) + ' (' + dice + (bonus ? (bonus > 0 ? ' + ' : ' − ') + Math.abs(bonus) : '') + ')';
  }
  function damagesText(c, m) {
    return m.damages.map((d, i) => diceText(d.dice, damageBonus(c, m, i)) + ' danni' + (d.type ? ' ' + DAMAGE_WORDS[d.type] : '')).join(' più ');
  }

  function freqLabel(f) {
    if (!f) return '';
    if (f.kind === 'ricarica') return 'Ricarica ' + (f.recharge >= 6 ? '6' : f.recharge + '–6');
    if (f.kind === 'giorno') return f.uses + '/giorno';
    if (f.kind === 'riposo-breve') return 'Ricarica dopo un riposo breve o lungo';
    if (f.kind === 'riposo-lungo') return 'Ricarica dopo un riposo lungo';
    return '';
  }

  // Nome con frequenza e costo, es. "Soffio di cenere (Ricarica 5–6)" o "Battito d'ali (costa 2 azioni)".
  function actionTitle(a) {
    const extra = [freqLabel(a.freq), a.cost > 1 ? 'costa ' + a.cost + ' azioni' : ''].filter(Boolean);
    return a.name + (extra.length ? ' (' + extra.join(', ') + ')' : '');
  }

  function attackText(c, m) {
    const kind = { mischia: 'da mischia', distanza: 'a distanza', entrambi: 'da mischia o a distanza' }[m.range];
    const range = m.range === 'mischia' ? 'portata ' + meters(m.reach)
      : m.range === 'distanza' ? 'gittata ' + meters(m.rangeNormal).replace(' m', '') + '/' + meters(m.rangeLong || m.rangeNormal)
        : 'portata ' + meters(m.reach) + ' o gittata ' + meters(m.rangeNormal).replace(' m', '') + '/' + meters(m.rangeLong || m.rangeNormal);
    return 'Attacco con arma ' + kind + ': ' + signed(toHit(c, m)) + ' al tiro per colpire, ' + range + ', ' + m.targets + '. Colpito: ' + damagesText(c, m) + '.';
  }

  function saveText(c, m) {
    const ab = R().ABILITY_NAMES[m.ability];
    const dc = saveDc(c, m);
    const prep = /^(in|entro|nel|nella|nei|nelle)\b/.test(m.area) ? '' : /^(cono|cubo|cerchio|cilindro|raggio)\b/.test(m.area) ? 'in un '
      : /^(linea|sfera|area)\b/.test(m.area) ? 'in una ' : 'in ';
    const who = m.area ? 'Ogni creatura ' + prep + m.area : 'Il bersaglio';
    let t = who + ' deve effettuare un tiro salvezza su ' + ab + ' con CD ' + dc;
    if (m.damages.length) {
      t += ', subendo ' + damagesText(c, m) + ' se lo fallisce' + (m.half ? ', o la metà dei danni se lo supera' : '');
    }
    t += '.';
    if (m.effect) t += ' Se fallisce, ' + (m.area ? 'la creatura ' : 'il bersaglio ') + m.effect.replace(/\.$/, '') + '.';
    return t;
  }

  function multiText(c, m) {
    const total = m.parts.reduce((s, p) => s + p.count, 0);
    const parts = m.parts.map((p) => {
      const a = findAction(c, p.actionId);
      return (p.count === 1 ? 'uno' : NUMBERS[p.count] || String(p.count)) + ' con ' + (a ? a.name.toLowerCase() : '(azione eliminata)');
    });
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1] : parts.join('');
    return c.name + ' effettua ' + (NUMBERS[total] || String(total)) + (total === 1 ? ' attacco' : ' attacchi') + (list ? ': ' + list : '') + '.';
  }

  // Testo generato dalla meccanica (null per "Solo testo").
  function generatedText(c, a) {
    const m = a.mech;
    if (m.kind === 'attacco') return attackText(c, m);
    if (m.kind === 'salvezza') return saveText(c, m);
    if (m.kind === 'cura') return 'Una creatura scelta recupera ' + diceText(m.dice, m.bonus) + ' punti ferita.';
    if (m.kind === 'multiattacco') return multiText(c, m);
    return null;
  }
  // Testo mostrato: quello scritto a mano (customText) oppure quello generato.
  function actionText(c, a) {
    const gen = generatedText(c, a);
    return a.customText || gen === null ? a.desc : gen;
  }

  // Righe della scheda: velocità, sensi, difese...
  function speedText(c) {
    const s = c.speed;
    const parts = [meters(s.walk)];
    if (s.burrow) parts.push('scavare ' + meters(s.burrow));
    if (s.climb) parts.push('scalare ' + meters(s.climb));
    if (s.fly) parts.push('volare ' + meters(s.fly) + (s.hover ? ' (fluttuare)' : ''));
    if (s.swim) parts.push('nuotare ' + meters(s.swim));
    return parts.join(', ');
  }
  function sensesText(c) {
    const parts = K().SENSES.filter((k) => c.senses[k] > 0).map((k) => K().SENSE_NAMES[k] + ' ' + meters(c.senses[k]));
    parts.push('Percezione passiva ' + (c.passiveOverride || passivePerception(c)));
    return parts.join(', ');
  }
  const defensesText = (list) => {
    const normal = list.filter((t) => !K().NON_MAGICAL[t]);
    const nm = list.filter((t) => K().NON_MAGICAL[t]).map((t) => K().NON_MAGICAL[t]);
    const parts = [];
    if (normal.length) parts.push(normal.join(', '));
    if (nm.length) parts.push(nm.join(', ') + ' da attacchi non magici');
    return parts.join('; ');
  };
  const savesText = (c) => c.saves.map((ab) => ab + ' ' + signed(saveBonus(c, ab))).join(', ');
  const skillsText = (c) => Object.keys(c.skills).sort((a, b) => a.localeCompare(b, 'it')).map((s) => s + ' ' + signed(skillBonus(c, s))).join(', ');
  const crText = (c) => c.cr + ' (' + formatXp(xpForCr(c.cr)) + ' PE)';
  const typeLine = (c) => 'Creatura ' + c.size + ' (' + c.ctype + (c.subtype ? ', ' + c.subtype : '') + ')' + (c.alignment ? ', ' + c.alignment : '');

  // ---------- Difese ai danni (per ogni combattente) ----------
  // Tipo di danno da un testo libero (es. "Taglienti", "fuoco"): uno dei 13 tipi oppure ''.
  function damageTypeOf(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return '';
    return K().DAMAGE_TYPES.find((t) => s === t || s.startsWith(t.slice(0, Math.min(6, t.length)))) || '';
  }
  // Difese da un testo libero (es. le resistenze di una razza: "Veleno, fuoco").
  function parseDefenses(text) {
    return [...new Set(String(text || '').split(/[,;/]| e /).map(damageTypeOf).filter(Boolean))];
  }
  const emptyDefenses = () => ({ vuln: [], res: [], imm: [] });

  // Danno dopo vulnerabilità (×2), resistenza (÷2 per difetto) e immunità (0). magical: l'attacco è magico
  // (le difese "da attacchi non magici" non valgono). Restituisce { amount, note } con la nota per il log.
  function applyDefenses(amount, type, defenses, magical) {
    const d = defenses || emptyDefenses();
    if (!type || !amount) return { amount, note: '' };
    const has = (list) => list.includes(type) || (!magical && list.includes(type + '-nm'));
    let a = amount;
    const notes = [];
    if (has(d.imm)) { notes.push('immunità ' + wordFor(type) + ': ' + a + ' → 0'); a = 0; }
    else {
      if (has(d.res)) { const b = Math.floor(a / 2); notes.push('resistenza ' + wordFor(type) + ': ' + a + ' → ' + b); a = b; }
      if (has(d.vuln)) { const b = a * 2; notes.push('vulnerabilità ' + wordFor(type) + ': ' + a + ' → ' + b); a = b; }
    }
    return { amount: a, note: notes.join(', ') };
  }
  // "al fuoco", "ai danni taglienti"...
  function wordFor(type) {
    const art = { acido: "all'acido", freddo: 'al freddo', fulmine: 'al fulmine', fuoco: 'al fuoco', forza: 'alla forza', tuono: 'al tuono', veleno: 'al veleno' };
    return art[type] || 'ai danni ' + DAMAGE_WORDS[type];
  }

  // Più parti di danno ([{ amount, type }]) sullo stesso bersaglio: totale e note.
  function applyDamageParts(parts, defenses, magical) {
    let total = 0;
    const notes = [];
    for (const p of parts) {
      const r = applyDefenses(p.amount, p.type, defenses, magical);
      total += r.amount;
      if (r.note) notes.push(r.note);
    }
    return { total, notes };
  }

  // ---------- Combattimento ----------
  // Stato della creatura nel combattimento: copia della scheda + usi, ricariche e punti leggendari.
  function combatState(c) {
    const state = JSON.parse(JSON.stringify({
      name: c.name, size: c.size, cr: c.cr, abilities: c.abilities, saves: c.saves, skills: c.skills,
      traits: c.traits, actions: c.actions, bonusActions: c.bonusActions, reactions: c.reactions, legendary: c.legendary, lair: c.lair,
    }));
    state.uses = {};
    state.recharge = {};
    for (const a of allActions(c)) {
      if (a.freq.kind === 'giorno') state.uses[a.id] = a.freq.uses;
      else if (a.freq.kind === 'riposo-breve' || a.freq.kind === 'riposo-lungo') state.uses[a.id] = 1;
      if (a.freq.kind === 'ricarica') state.recharge[a.id] = true;
    }
    state.legendaryPoints = { max: c.legendary.length ? c.legendaryPoints : 0, left: c.legendary.length ? c.legendaryPoints : 0 };
    state.legendaryResistance = { max: c.legendaryResistance, left: c.legendaryResistance };
    return state;
  }

  // L'azione si può usare ora? { ok, reason }
  function canUse(state, a) {
    if (a.freq.kind === 'ricarica' && !state.recharge[a.id]) return { ok: false, reason: 'da ricaricare' };
    if (state.uses[a.id] !== undefined && state.uses[a.id] <= 0) return { ok: false, reason: 'usi esauriti' };
    if (a.group === 'legendary' && (state.legendaryPoints.left < (a.cost || 1))) return { ok: false, reason: 'punti azione leggendaria insufficienti' };
    return { ok: true, reason: '' };
  }

  // Consuma l'azione (usi, ricarica, punti leggendari). Modifica state.
  function consume(state, a) {
    if (a.freq.kind === 'ricarica') state.recharge[a.id] = false;
    if (state.uses[a.id] !== undefined) state.uses[a.id] = Math.max(0, state.uses[a.id] - 1);
    if (a.group === 'legendary') state.legendaryPoints.left = Math.max(0, state.legendaryPoints.left - (a.cost || 1));
  }

  // Inizio del turno della creatura: tiro di ricarica (d6) per le azioni scariche e punti leggendari
  // ripristinati. Modifica state; restituisce le righe del log.
  function startTurn(state, rng) {
    const lines = [];
    for (const a of allActions(state)) {
      if (a.freq.kind !== 'ricarica' || state.recharge[a.id]) continue;
      const roll = rng(6);
      const ok = roll >= a.freq.recharge;
      if (ok) state.recharge[a.id] = true;
      lines.push(state.name + ': ricarica di ' + a.name + ' (' + freqLabel(a.freq) + '), d6 = ' + roll + ' → ' + (ok ? 'ricaricata' : 'non ancora'));
    }
    if (state.legendaryPoints.max) state.legendaryPoints.left = state.legendaryPoints.max;
    return lines;
  }

  // Azioni eseguite da un multiattacco, nell'ordine (ognuna con il proprio bersaglio).
  function expandMultiattack(c, a) {
    const out = [];
    for (const p of a.mech.parts || []) {
      const sub = findAction(c, p.actionId);
      if (sub && sub.mech.kind !== 'multiattacco') for (let i = 0; i < p.count; i++) out.push(sub);
    }
    return out;
  }

  function rollParts(c, m, crit, rng) {
    return m.damages.map((d, i) => {
      const p = DnD.dadi.parseExpr(d.dice);
      const bonus = damageBonus(c, m, i);
      const r = DnD.dadi.roll(p.count * (crit ? 2 : 1), p.sides, bonus, rng);
      return { dice: (p.count * (crit ? 2 : 1)) + 'd' + p.sides, bonus, rolls: r.rolls, amount: Math.max(0, r.total), type: d.type };
    });
  }

  // Attacco della creatura contro un bersaglio: 20 naturale = critico (dadi raddoppiati), 1 = mancato.
  function resolveAttack(c, a, target, mode, rng, autoCrit) {
    const m = a.mech;
    const bonus = toHit(c, m);
    const d20 = R().rollD20(mode || 'normale', rng);
    const fumble = d20.natural === 1;
    const total = d20.natural + bonus;
    const hit = d20.natural === 20 || (!fumble && total >= target.ac);
    const crit = d20.natural === 20 || Boolean(autoCrit && hit);
    return { kind: 'attacco', bonus, d20Rolls: d20.rolls, natural: d20.natural, total, hit, crit, fumble, parts: hit ? rollParts(c, m, crit, rng) : [] };
  }

  // Tiro salvezza del bersaglio contro l'azione: danni pieni se fallisce, metà (o niente) se riesce.
  // autoFail: fallimento automatico per una condizione (nessun tiro).
  function resolveSave(c, a, target, rng, saveMode, autoFail) {
    const m = a.mech;
    const dc = saveDc(c, m);
    const s = autoFail ? { d20Rolls: [], natural: null, total: null, success: false }
      : R().rollSave({ bonus: (target.saves && target.saves[m.ability]) || 0, mode: saveMode || 'normale', dc }, rng);
    const full = rollParts(c, m, false, rng);
    const parts = full.map((p) => Object.assign({}, p, { amount: s.success ? (m.half ? Math.floor(p.amount / 2) : 0) : p.amount }));
    return { kind: 'salvezza', dc, ability: m.ability, d20Rolls: s.d20Rolls, natural: s.natural, total: s.total, success: s.success, full, parts };
  }

  function resolveHeal(c, a, rng) {
    const p = DnD.dadi.parseExpr(a.mech.dice);
    const r = DnD.dadi.roll(p.count, p.sides, a.mech.bonus, rng);
    return { kind: 'cura', rolls: r.rolls, amount: Math.max(0, r.total) };
  }

  // Resistenza leggendaria: trasforma l'ultimo tiro salvezza fallito del combattente in un successo.
  // combatant.pendingSave: { full: [danni pieni per tipo], half, applied (PF tolti), text }. Restituisce
  // { refund, applied } (PF restituiti e danno con il successo) oppure null se non si può usare.
  function useLegendaryResistance(combatant) {
    const st = combatant.creature;
    const ps = combatant.pendingSave;
    if (!st || !ps || st.legendaryResistance.left <= 0) return null;
    const after = applyDamageParts(ps.full.map((p) => ({ amount: ps.half ? Math.floor(p.amount / 2) : 0, type: p.type })), combatant.defenses, ps.magical).total;
    const refund = Math.max(0, ps.applied - after);
    combatant.hp = Math.min(combatant.maxHp, combatant.hp + refund);
    st.legendaryResistance.left -= 1;
    combatant.pendingSave = null;
    return { refund, applied: after };
  }

  // Combattente da una creatura. spells: libreria (incantesimi innati, lanciati senza consumare slot).
  function toCombatant(c, name, copy, rng, spells) {
    const dexMod = mod(c, 'DES');
    const hp = hpInfo(c).total;
    const dims = DnD.griglia.gridSizeFor(c.gridSize, c.size);
    const innate = c.innate.spells.map((s) => ({ s, spell: (spells || []).find((x) => x.id === s.spellId) })).filter((x) => x.spell);
    const imod = mod(c, c.innate.ability);
    return Object.assign({
      id: DnD.dadi.uid(), sourceId: c.id, kind: 'npc', name, copy, maxHp: hp, hp, ac: c.ac, dexMod, saves: saveTotals(c),
      w: dims.w, h: dims.h, speeds: DnD.movimento.speedsFromCreature(c.speed), icon: Object.assign({}, c.icon), pos: null, weapons: [],
      defenses: { vuln: c.vulnerabilities.slice(), res: c.resistances.slice(), imm: c.immunities.slice() },
      creature: combatState(c),
      // Sensi della scheda (in metri) in piedi, per la luce e la visione (visione.js).
      senses: DnD.visione.sensesFromCreature(c),
      control: 'ia', faction: 'nemici', behavior: DnD.ia.normalizeBehavior(c.behavior), abilities: Object.assign({}, c.abilities),
      classId: '', level: Math.max(1, Math.round(crValue(c.cr))), hidden: false,
      spellcasting: innate.length ? {
        attack: c.innate.attackOverride === null ? prof(c) + imod : c.innate.attackOverride,
        dc: c.innate.dcOverride === null ? 8 + prof(c) + imod : c.innate.dcOverride,
        ability: c.innate.ability, mod: imod, pact: false, slotsTotal: Array(9).fill(0), slotsUsed: Array(9).fill(0),
        spells: innate.map((x) => JSON.parse(JSON.stringify(x.spell))),
        innate: Object.fromEntries(innate.map((x) => [x.spell.id, { freq: x.s.freq, left: x.s.freq === 'giorno' ? x.s.uses : null }])),
      } : null,
    }, R().rollInitiative(dexMod, rng));
  }

  // Promemoria delle azioni di tana a iniziativa 20: true se il passaggio di turno da prev a next
  // (nell'ordine di iniziativa) attraversa il 20, anche all'inizio di un nuovo round.
  function crossesLair(order, prevId, nextId, newRound) {
    const init = (id) => { const c = order.find((x) => x.id === id); return c ? c.initiative : -Infinity; };
    const a = prevId ? init(prevId) : Infinity;
    const b = init(nextId);
    if (newRound || !prevId) return b < 20;
    return a >= 20 && b < 20;
  }

  // ---------- Stima del grado di sfida (Guida del Dungeon Master) ----------
  // Danno medio per round: il migliore tra le azioni (il multiattacco somma le sue parti).
  function damagePerRound(c) {
    let best = { dpr: 0, bonus: null, kind: null, name: '' };
    const avgOf = (a) => a.mech.damages.reduce((s, d, i) => s + avgDamage(d.dice, damageBonus(c, a.mech, i)), 0);
    for (const a of c.actions) {
      let dpr = 0;
      let bonus = null;
      let kind = null;
      if (a.mech.kind === 'attacco') { dpr = avgOf(a); bonus = toHit(c, a.mech); kind = 'attacco'; }
      else if (a.mech.kind === 'salvezza') { dpr = avgOf(a); bonus = saveDc(c, a.mech); kind = 'salvezza'; }
      else if (a.mech.kind === 'multiattacco') {
        for (const sub of expandMultiattack(c, a)) {
          if (sub.mech.kind !== 'attacco' && sub.mech.kind !== 'salvezza') continue;
          dpr += avgOf(sub);
          const b = sub.mech.kind === 'attacco' ? toHit(c, sub.mech) : saveDc(c, sub.mech);
          if (bonus === null || b > bonus) { bonus = b; kind = sub.mech.kind; }
        }
      }
      if (dpr > best.dpr) best = { dpr, bonus, kind, name: a.name };
    }
    return best;
  }

  function rowFor(value, lo, hi) {
    const T = K().DMG_TABLE;
    if (value <= T[0][hi]) return 0;
    for (let i = 0; i < T.length; i++) if (value >= T[i][lo] && value <= T[i][hi]) return i;
    return value > T[T.length - 1][hi] ? T.length - 1 : 0;
  }
  const clampIndex = (i) => Math.max(0, Math.min(K().DMG_TABLE.length - 1, i));
  const steps = (diff) => (diff >= 0 ? Math.floor(diff / 2) : -Math.floor(-diff / 2));

  function estimateCr(c) {
    const T = K().DMG_TABLE;
    const hp = hpInfo(c).total;
    const physical = ['contundente', 'perforante', 'tagliente'];
    const strong = (list) => list.length >= 3 || list.some((t) => physical.includes(t) || K().NON_MAGICAL[t]);
    let effHp = hp;
    const base = rowFor(hp, 2, 3);
    const mult = K().EFFECTIVE_HP.find((r) => crValue(T[base][0]) <= r[0]);
    if (strong(c.immunities)) effHp = Math.round(hp * mult[2]);
    else if (strong(c.resistances)) effHp = Math.round(hp * mult[1]);
    const hpRow = rowFor(effHp, 2, 3);
    const defensive = clampIndex(hpRow + steps(c.ac - T[hpRow][1]));
    const off = damagePerRound(c);
    const dprRow = rowFor(off.dpr, 5, 6);
    const expected = off.kind === 'salvezza' ? T[dprRow][7] : T[dprRow][4];
    const offensive = clampIndex(dprRow + (off.bonus === null ? 0 : steps(off.bonus - expected)));
    const avg = (crValue(T[defensive][0]) + crValue(T[offensive][0])) / 2;
    let best = 0;
    T.forEach((row, i) => { if (Math.abs(crValue(row[0]) - avg) <= Math.abs(crValue(T[best][0]) - avg) + 1e-9) best = i; });
    // A parità di distanza si sceglie il GS più alto (scorrendo dal basso, l'ultimo uguale vince).
    return {
      defensive: T[defensive][0], offensive: T[offensive][0], estimate: T[best][0],
      hp, effHp, ac: c.ac, dpr: off.dpr, bonus: off.bonus, bonusKind: off.kind, from: off.name,
    };
  }

  DnD.creature = {
    crIndex, crValue, profForCr, xpForCr, formatXp, hitDieFor, avgDice, hpInfo,
    mod, prof, saveBonus, skillBonus, passivePerception, saveTotals,
    normalizeDamage, normalizeMech, normalizeAction, normalizeMonster, allActions, findAction,
    toHit, damageBonus, saveDc, avgDamage, diceText, damagesText, freqLabel, actionTitle, generatedText, actionText,
    speedText, sensesText, defensesText, savesText, skillsText, crText, typeLine, DAMAGE_WORDS,
    damageTypeOf, parseDefenses, emptyDefenses, applyDefenses, applyDamageParts,
    combatState, canUse, consume, startTurn, expandMultiattack, resolveAttack, resolveSave, resolveHeal, useLegendaryResistance,
    toCombatant, crossesLair, damagePerRound, estimateCr,
  };
})(globalThis.DnD = globalThis.DnD || {});
