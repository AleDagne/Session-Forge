// Scheda del giocatore (logica pura): campi aggiuntivi della scheda, background e talenti (librerie), acquisto
// punti, abilità con competenza/maestria/«metà competenza», passive, iniziativa e velocità sovrascrivibili,
// carico e sintonia, PE e livelli, applicazione di un background (anteprima, senza duplicati), effetti dei
// talenti, avanzamento di livello, incantesimi preparabili, avvisi della creazione guidata, riferimenti mancanti,
// esportazione e importazione di un personaggio. I calcoli di base restano in regole.js, dati/classi.js, attrezzatura.js.
// Livello regole, gruppo entità (sotto leggendario.js). Espone DnD.scheda; usa statistiche, regole, classi, attrezzatura,
// condizioni, note (sanificazione della storia), dati/scheda, dati/creature, dadi, icone. Non deve toccare il DOM.
// Il Percorso leggendario si aggancia con registraLivelloLeggendario; l'import usa modello.normalizzaCreatura e VERSION.
(function (DnD) {
  'use strict';

  const K = () => DnD.schedaDati;
  const R = () => DnD.regole;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v, def, min, max) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : def; };
  const num = (v, def, min, max) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : def; };
  const nullable = (v, min, max, isInt) => (v === null || v === undefined || v === '' ? null : (isInt ? int(v, null, min, max) : num(v, null, min, max)));
  const REF = /^[\w-]{1,64}$/;
  const refId = (v) => (typeof v === 'string' && REF.test(v) ? v : '');
  const uid = () => DnD.dadi.uid();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const SKILLS = () => DnD.creatureDati.SKILLS;
  const SKILL_NAMES = () => Object.keys(SKILLS());
  const ABS = () => R().ABILITIES;
  const texts = (v, max, len) => arr(v).filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, len || 120)).filter(Boolean).slice(0, max);

  // ---------- Normalizzazione ----------
  function normalizeFeature(f) {
    f = obj(f);
    const u = obj(f.uses);
    const kind = K().USES.includes(u.kind) ? u.kind : 'volonta';
    return {
      id: refId(f.id) || uid(), name: str(f.name, 80).trim() || 'Privilegio', desc: str(f.desc, 2000),
      source: K().FEATURE_SOURCES.includes(f.source) ? f.source : 'altro',
      uses: { kind, max: kind === 'volonta' ? 0 : int(u.max, 1, 1, 20) },
      featId: refId(f.featId), asi: Boolean(f.asi), level: int(f.level, 0, 0, 40),
    };
  }
  const normalizeProf = (p) => { p = obj(p); return { id: refId(p.id) || uid(), kind: K().PROF_KINDS.includes(p.kind) ? p.kind : 'altro', text: str(p.text, 80).trim() }; };
  const normalizeAlly = (a) => { a = obj(a); return { id: refId(a.id) || uid(), kind: K().ALLY_KINDS.includes(a.kind) ? a.kind : 'libero', refId: refId(a.refId), text: str(a.text, 300) }; };
  // Campi della scheda (giocatori). I giocatori esistenti ricevono valori vuoti: nulla di ciò che avevano cambia.
  function normalizeSheet(s) {
    s = obj(s);
    const skills = {};
    for (const [k, v] of Object.entries(obj(s.skills))) if (SKILLS()[k] && K().SKILL_LEVELS.includes(v) && v) skills[k] = v;
    const skillBonus = {};
    for (const [k, v] of Object.entries(obj(s.skillBonus))) if (SKILLS()[k] && int(v, 0, -20, 20)) skillBonus[k] = int(v, 0, -20, 20);
    const o = obj(s.overrides);
    const ap = obj(s.appearance);
    const pe = obj(s.personality);
    const flags = {};
    for (const [k, v] of Object.entries(obj(s.spellFlags))) if (refId(k)) flags[k] = { prepared: Boolean(obj(v).prepared), ritual: Boolean(obj(v).ritual), concentration: obj(v).concentration === undefined ? null : Boolean(obj(v).concentration) };
    const ds = obj(s.deathSaves);
    return {
      background: refId(s.background),
      alignment: K().ALIGNMENTS.includes(s.alignment) ? s.alignment : '',
      inspiration: Boolean(s.inspiration),
      skills, skillBonus, half: Boolean(s.half),
      initiativeBonus: int(s.initiativeBonus, 0, -20, 20),
      speedBonus: num(s.speedBonus, 0, -30, 60),
      // Valori calcolati sovrascritti a mano (null = automatico).
      overrides: { initiative: nullable(o.initiative, -20, 40, true), speed: nullable(o.speed, 0, 300, false), carry: nullable(o.carry, 0, 100000, false) },
      proficiencies: arr(s.proficiencies).slice(0, 80).map(normalizeProf).filter((p) => p.text),
      personality: Object.fromEntries(K().PERSONALITY.map((k) => [k, str(pe[k], 2000)])),
      features: arr(s.features).slice(0, 80).map(normalizeFeature),
      appearance: Object.fromEntries(K().APPEARANCE.map((k) => [k, str(ap[k], 40)])),
      portrait: s.portrait ? DnD.icone.normalizeIcon(s.portrait, false) : null,
      story: DnD.note.sanitizeHtml(str(s.story, 50000)),
      allies: arr(s.allies).slice(0, 40).map(normalizeAlly),
      extraFeatures: str(s.extraFeatures, 5000), treasure: str(s.treasure, 5000),
      // «Incantatore» per le classi che non lo sono (come la classe Personalizzata): tipo di incantatore.
      spellcaster: Boolean(s.spellcaster), casterType: DnD.classi.CASTER_TYPES.includes(s.casterType) ? s.casterType : 'completo', spellFlags: flags,
      conditions: [...new Set(arr(s.conditions).filter((x) => DnD.condizioni.TYPE_IDS.includes(x) && x !== 'sfinimento'))],
      deathSaves: { successes: int(ds.successes, 0, 0, 3), failures: int(ds.failures, 0, 0, 3) },
      wizard: { done: s.wizard ? Boolean(obj(s.wizard).done) : true, step: int(obj(s.wizard).step, 0, 0, 7) },
    };
  }
  function normalizeBackground(b) {
    b = obj(b);
    const f = obj(b.feature);
    const sg = obj(b.suggestions);
    return {
      id: refId(b.id) || uid(), name: str(b.name, 60).trim() || 'Background', description: str(b.description, 2000),
      skills: [...new Set(arr(b.skills).filter((x) => SKILLS()[x]))].slice(0, 6),
      tools: texts(b.tools, 10), languages: texts(b.languages, 10),
      equipment: arr(b.equipment).slice(0, 20).map((x) => (typeof x === 'string' ? { name: x.slice(0, 60), qty: 1, equipmentId: '' } : { name: str(obj(x).name, 60), qty: int(obj(x).qty, 1, 1, 99), equipmentId: refId(obj(x).equipmentId) })).filter((x) => x.name || x.equipmentId),
      feature: { name: str(f.name, 80), desc: str(f.desc, 2000) },
      suggestions: Object.fromEntries(K().PERSONALITY.map((k) => [k, texts(sg[k], 10, 300)])),
      sessionId: typeof b.sessionId === 'string' ? b.sessionId.slice(0, 64) : '', shared: Boolean(b.shared),
    };
  }
  function normalizeFeat(f) {
    f = obj(f);
    const e = obj(f.effects);
    const abilities = {};
    for (const ab of ABS()) { const v = int(obj(e.abilities)[ab], 0, -5, 5); if (v) abilities[ab] = v; }
    return {
      id: refId(f.id) || uid(), name: str(f.name, 60).trim() || 'Talento', requirements: str(f.requirements, 200), description: str(f.description, 2000),
      effects: {
        abilities, skills: [...new Set(arr(e.skills).filter((x) => SKILLS()[x]))], saves: [...new Set(arr(e.saves).filter((x) => ABS().includes(x)))],
        ac: int(e.ac, 0, -5, 10), hp: int(e.hp, 0, 0, 200), hpPerLevel: int(e.hpPerLevel, 0, 0, 10), speed: num(e.speed, 0, -9, 30), initiative: int(e.initiative, 0, -10, 10),
      },
      sessionId: typeof f.sessionId === 'string' ? f.sessionId.slice(0, 64) : '', shared: Boolean(f.shared),
    };
  }
  const own = (x, sessionId) => Object.assign(clone(x), { sessionId, shared: true });
  const exampleBackgrounds = (sessionId) => K().BACKGROUNDS.map((b) => normalizeBackground(own(b, sessionId)));
  const exampleFeats = (sessionId) => K().FEATS.map((f) => normalizeFeat(own(f, sessionId)));

  // ---------- Talenti ----------
  // Effetti dei talenti e somma ai punti caratteristica: in statistiche.js (servono ai valori derivati).
  const featEffects = (c, feats) => DnD.statistiche.featEffects(c, feats);
  const addAbilities = (asi, extra) => DnD.statistiche.addAbilities(asi, extra);
  // Punti caratteristica disponibili: quelli del livello meno 2 per ogni talento preso al loro posto.
  function asiAvailable(c) {
    const taken = arr(c.sheet && c.sheet.features).filter((f) => f.featId && f.asi).length;
    return Math.max(0, R().asiPointsAvailable(c.level) - 2 * taken);
  }

  // ---------- Acquisto punti ----------
  // Costo dei valori base: { cost, left, valid, out: [caratteristiche fuori da 8-15] }; valid = dentro il budget.
  function pointBuy(abilities) {
    const P = K().POINT_BUY;
    const out = ABS().filter((ab) => !(Number.isInteger(abilities[ab]) && abilities[ab] >= P.min && abilities[ab] <= P.max));
    const cost = ABS().reduce((s, ab) => s + (out.includes(ab) ? 0 : P.costs[abilities[ab]]), 0);
    return { cost, left: P.budget - cost, valid: !out.length && cost <= P.budget, out };
  }
  // Si può portare la caratteristica a value restando nel budget? (rifiuta combinazioni oltre i 27 punti)
  function canBuy(abilities, ab, value) {
    const P = K().POINT_BUY;
    if (!(value >= P.min && value <= P.max)) return false;
    return pointBuy(Object.assign({}, abilities, { [ab]: value })).valid;
  }
  const pointBuyStart = () => Object.fromEntries(ABS().map((ab) => [ab, K().POINT_BUY.min]));

  // ---------- Abilità e passive ----------
  // Grado di competenza: il più alto tra scheda, talenti e Percorso leggendario.
  // Grado dal Percorso leggendario: lo registra leggendario.js (sta sopra la scheda); senza, 0.
  let livelloLeggendario = () => 0;
  /**
   * @param {(c: object, skill: string, st: object) => number} fn grado di competenza dato dal Percorso leggendario
   */
  const registraLivelloLeggendario = (fn) => { livelloLeggendario = fn; };
  function skillLevel(c, skill, fx, st) {
    const sheet = (c.sheet && c.sheet.skills[skill]) || 0;
    const feat = fx && fx.skills.includes(skill) ? 1 : 0;
    const legend = c.type === 'leggendario' ? livelloLeggendario(c, skill, st) : 0;
    return Math.max(sheet, feat, legend);
  }
  // Bonus di un'abilità: mod. + competenza × grado (maestria = doppia); senza competenza, «metà competenza» (per
  // difetto) se attiva; più il bonus scritto a mano. d: DnD.statistiche.derivedStats. Restituisce { total, level, detail }.
  function skillBonus(c, skill, d, fx, st) {
    const ab = SKILLS()[skill] || 'SAG';
    const m = R().modifier(d.abilities[ab]);
    const level = skillLevel(c, skill, fx, st);
    const half = !level && c.sheet && c.sheet.half ? Math.floor(d.profBonus / 2) : 0;
    const extra = (c.sheet && c.sheet.skillBonus[skill]) || 0;
    const total = m + level * d.profBonus + half + extra;
    const f = R().formatModifier;
    const detail = ab + ' ' + f(m) + (level ? ' + competenza ' + f(d.profBonus) + (level === 2 ? ' × 2 (maestria)' : '') : '') + (half ? ' + metà competenza ' + f(half) : '') + (extra ? ' + bonus ' + f(extra) : '') + ' = ' + f(total);
    return { skill, ability: ab, total, level, half: Boolean(half), extra, detail };
  }
  const skills = (c, d, fx, st) => SKILL_NAMES().map((k) => skillBonus(c, k, d, fx, st));
  const passive = (c, skill, d, fx, st) => 10 + skillBonus(c, skill, d, fx, st).total;

  // ---------- Iniziativa, velocità, carico, sintonia ----------
  // Iniziativa e velocità: in statistiche.js (servono ai valori derivati).
  const initiative = (c, d, fx) => DnD.statistiche.initiative(c, d, fx);
  const speed = (c, race, fx, catalog) => DnD.statistiche.speed(c, race, fx, catalog);
  // Carico: peso dell'inventario (monete comprese) e capacità FOR × fattore (o scritta a mano).
  function carry(c, d, catalog) {
    const weight = DnD.attrezzatura.inventoryWeight(c.inventory, catalog || [], c.coins);
    const auto = Math.round(d.abilities.FOR * K().CARRY_FACTOR * 10) / 10;
    const ov = c.sheet ? c.sheet.overrides.carry : null;
    const capacity = ov === null ? auto : ov;
    return { weight, capacity, auto, manual: ov !== null, over: weight > capacity, detail: 'FOR ' + d.abilities.FOR + ' × ' + String(K().CARRY_FACTOR).replace('.', ',') + ' kg = ' + String(auto).replace('.', ',') + ' kg' };
  }
  // Sintonia: oggetti in sintonia (righe con attuned di oggetti che la richiedono), massimo 3.
  function attunement(c, catalog) {
    const items = arr(c.inventory).filter((x) => x.attuned).map((x) => ({ row: x, item: arr(catalog).find((e) => e.id === x.equipmentId) })).filter((x) => x.item && x.item.attunement);
    return { count: items.length, max: K().MAX_ATTUNEMENT, over: items.length > K().MAX_ATTUNEMENT, names: items.map((x) => x.item.name) };
  }
  const canAttune = (c, catalog) => attunement(c, catalog).count < K().MAX_ATTUNEMENT;

  // ---------- PE e livelli ----------
  const levelForXp = (xp) => { let lv = 1; K().XP_THRESHOLDS.forEach((t, i) => { if (xp >= t) lv = i + 1; }); return lv; };
  function xpInfo(c) {
    const lv = c.level;
    const next = lv < 20 ? K().XP_THRESHOLDS[lv] : null;
    return { level: lv, xp: c.xp || 0, next, canLevelUp: c.type !== 'leggendario' && next !== null && (c.xp || 0) >= next, levelForXp: levelForXp(c.xp || 0) };
  }
  // PF automatici dalla classe (regole.computeHp) più i talenti (fissi e per livello).
  function autoHp(c, conMod, fx, method, rng) {
    const info = DnD.classi.classInfo(c.classId, c.customClass);
    if (!info) return null;
    const r = R().computeHp({ level: c.level, hitDie: info.hitDie, conMod, method: method || 'media' }, rng || DnD.dadi.randomInt);
    const bonus = ((fx && fx.hp) || 0) + ((fx && fx.hpPerLevel) || 0) * c.level;
    return { total: r.total + bonus, detail: r.detail + (bonus ? ' + talenti ' + bonus : ''), basis: { level: c.level, conMod, hitDie: info.hitDie } };
  }

  // ---------- Background ----------
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // Applica un background a una copia della scheda: competenze nelle abilità, strumenti e linguaggi (tag),
  // equipaggiamento (dal catalogo, per id o nome) e privilegio; niente di già presente viene duplicato.
  // Restituisce { player, changes: [testi per l'anteprima], skipped: [testi] }.
  function applyBackground(c, bg, catalog) {
    const p = clone(c);
    p.sheet = normalizeSheet(p.sheet);
    p.inventory = arr(p.inventory);
    const changes = [];
    const skipped = [];
    for (const k of bg.skills) {
      if ((p.sheet.skills[k] || 0) >= 1) { skipped.push('competenza in ' + k + ' (già presente)'); continue; }
      p.sheet.skills[k] = 1;
      changes.push('Competenza in ' + k);
    }
    const tags = [['strumenti', bg.tools], ['linguaggi', bg.languages]];
    for (const [kind, list] of tags) {
      for (const t of list) {
        if (p.sheet.proficiencies.some((x) => same(x.text, t))) { skipped.push(t + ' (già presente)'); continue; }
        p.sheet.proficiencies.push(normalizeProf({ kind, text: t }));
        changes.push(DnD.schedaDati.PROF_KIND_NAMES[kind] + ': ' + t);
      }
    }
    for (const it of bg.equipment) {
      const e = arr(catalog).find((x) => (it.equipmentId && x.id === it.equipmentId) || (it.name && same(x.name, it.name)));
      if (!e) { skipped.push((it.name || 'oggetto') + ' (non nel catalogo)'); continue; }
      if (p.inventory.some((x) => x.equipmentId === e.id)) { skipped.push(e.name + ' (già nell\'inventario)'); continue; }
      p.inventory.push({ id: uid(), equipmentId: e.id, qty: it.qty || 1, equipped: false, attuned: false });
      changes.push('Equipaggiamento: ' + (it.qty || 1) + '× ' + e.name);
    }
    if (bg.feature.name) {
      if (p.sheet.features.some((f) => f.source === 'background' && same(f.name, bg.feature.name))) skipped.push('privilegio ' + bg.feature.name + ' (già presente)');
      else { p.sheet.features.push(normalizeFeature({ name: bg.feature.name, desc: bg.feature.desc, source: 'background' })); changes.push('Privilegio: ' + bg.feature.name); }
    }
    if (p.sheet.background !== bg.id) { p.sheet.background = bg.id; changes.unshift('Background: ' + bg.name); }
    return { player: p, changes, skipped };
  }
  // Suggerimenti di competenze (tag) dalla classe, dalla razza e dal background, senza quelle già presenti.
  function profSuggestions(c, race, bg) {
    const out = [];
    const cp = K().CLASS_PROFS[c.classId] || {};
    for (const kind of ['armi', 'armature', 'strumenti']) for (const t of cp[kind] || []) out.push({ kind, text: t, from: 'classe' });
    if (race && race.languages) for (const t of race.languages.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) out.push({ kind: 'linguaggi', text: t, from: 'razza' });
    if (race && race.proficiencies) for (const t of race.proficiencies.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) out.push({ kind: 'altro', text: t, from: 'razza' });
    if (bg) { for (const t of bg.tools) out.push({ kind: 'strumenti', text: t, from: 'background' }); for (const t of bg.languages) out.push({ kind: 'linguaggi', text: t, from: 'background' }); }
    const have = arr(c.sheet && c.sheet.proficiencies);
    return out.filter((x, i) => !have.some((h) => same(h.text, x.text)) && out.findIndex((y) => same(y.text, x.text)) === i);
  }
  // Abilità da scegliere per la classe: quante, tra quali, quante già scelte (escluse quelle del background).
  function classSkillChoice(c, bg) {
    const cs = K().CLASS_SKILLS[c.classId];
    if (!cs) return null;
    const fromBg = bg ? bg.skills : [];
    const chosen = cs.options.filter((k) => (c.sheet.skills[k] || 0) >= 1 && !fromBg.includes(k));
    return { count: cs.count, options: cs.options, chosen, missing: Math.max(0, cs.count - chosen.length) };
  }

  // ---------- Incantesimi ----------
  // Incantatore? La classe lancia incantesimi, oppure la casella «Incantatore» della scheda.
  const isCaster = (c) => Boolean((DnD.classi.classInfo(c.classId, c.customClass) || {}).caster || (c.sheet && c.sheet.spellcaster));
  // Preparabili per le classi che preparano: livello (o metà) + modificatore, minimo 1; null per le altre.
  function preparable(c, d) {
    const info = DnD.classi.classInfo(c.classId, c.customClass);
    if (!info || !info.prepares || !d.spell) return null;
    const base = info.prepares === 'meta' ? Math.floor(c.level / 2) : c.level;
    const prepared = Object.values(c.sheet.spellFlags).filter((f) => f.prepared).length;
    return { max: Math.max(1, base + d.spell.mod), prepared };
  }
  // Livello di incantesimo più alto con slot (0 = solo trucchetti).
  const maxSpellLevel = (slots) => arr(slots).reduce((m, n, i) => (n > 0 ? i + 1 : m), 0);

  // ---------- Avanzamento di livello ----------
  // Sale di un livello (copia): PF (media, tiro o a mano, minimo 1, + talenti per livello), privilegi vuoti da
  // compilare, punti caratteristica o talento ai livelli giusti, nuovi incantesimi. opts: { hpMethod, roll, manual,
  // asi: { FOR: 1… }, featId, spells: [id], featureNames: [nome] }. Restituisce { player, summary }.
  function levelUp(c, opts, ctx) {
    opts = obj(opts);
    const p = clone(c);
    p.sheet = normalizeSheet(p.sheet);
    const race = ctx && ctx.race;
    const before = DnD.statistiche.derivedStats(c, race, ctx && ctx.catalog);
    const info = before.info;
    const from = c.level;
    const max = c.type === 'leggendario' ? 40 : 20;
    if (from >= max) return { player: p, summary: null };
    p.level = from + 1;
    const fx = featEffects(c, ctx && ctx.feats);
    const conMod = R().modifier(before.abilities.COS);
    const die = info ? info.hitDie : 8;
    const rolled = opts.hpMethod === 'tira' ? (opts.roll || (ctx && ctx.rng ? ctx.rng(die) : DnD.dadi.randomInt(die))) : opts.hpMethod === 'manuale' ? null : R().hitDieAverage(die);
    const gain = opts.hpMethod === 'manuale' ? Math.max(1, int(opts.manual, 1, 1, 100)) : Math.max(1, rolled + conMod) + fx.hpPerLevel;
    p.maxHp = Math.min(9999, c.maxHp + gain);
    p.hpBasis = p.hpMode === 'auto' && info ? { level: p.level, conMod, hitDie: die } : p.hpBasis;
    p.hpDetail = (c.hpDetail ? c.hpDetail + ' · ' : '') + 'liv. ' + p.level + ': +' + gain;
    const asiLevel = K().ASI_LEVELS.includes(p.level) || (p.level > 20 && p.level % 4 === 0);
    if (asiLevel && opts.featId) p.sheet.features.push(normalizeFeature({ name: (ctx && ctx.feats || storeFeats()).find((f) => f.id === opts.featId) ? (ctx && ctx.feats || storeFeats()).find((f) => f.id === opts.featId).name : 'Talento', source: 'talento', featId: opts.featId, asi: true, level: p.level }));
    else if (asiLevel && opts.asi) for (const ab of ABS()) p.asi[ab] = (p.asi[ab] || 0) + (int(opts.asi[ab], 0, 0, 2));
    const names = arr(opts.featureNames).length ? opts.featureNames : ['Privilegio di livello ' + p.level];
    for (const n of names) p.sheet.features.push(normalizeFeature({ name: n, source: 'classe', level: p.level }));
    if (p.spellcasting) p.spellcasting.known = [...new Set(p.spellcasting.known.concat(arr(opts.spells)))];
    const after = DnD.statistiche.derivedStats(p, race, ctx && ctx.catalog);
    const slots = (d) => (d.spell ? d.spell.slotsTotal : [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    return {
      player: p,
      summary: {
        from, to: p.level, hpGain: gain, rolled, profBefore: before.profBonus, profAfter: after.profBonus, slotsBefore: slots(before), slotsAfter: slots(after),
        asiLevel, newFeatures: names, spells: arr(opts.spells).length,
      },
    };
  }

  // ---------- Creazione guidata ----------
  const STEPS = ['razza', 'classe', 'caratteristiche', 'background', 'equipaggiamento', 'incantesimi', 'dettagli', 'riepilogo'];
  const STEP_NAMES = { razza: 'Razza', classe: 'Classe e livello', caratteristiche: 'Caratteristiche', background: 'Background e competenze', equipaggiamento: 'Equipaggiamento', incantesimi: 'Incantesimi', dettagli: 'Dettagli', riepilogo: 'Riepilogo' };
  // Avvisi (non bloccanti) per ciò che manca: { step, text }.
  function missing(c, st) {
    const out = [];
    const bg = arr(st && st.backgrounds).find((b) => b.id === c.sheet.background) || null;
    if (!c.raceId) out.push({ step: 'razza', text: 'manca la razza' });
    if (!c.classId) out.push({ step: 'classe', text: 'manca la classe' });
    if (ABS().every((ab) => c.abilities[ab] === 10)) out.push({ step: 'caratteristiche', text: 'caratteristiche ancora tutte a 10' });
    if (!c.sheet.background) out.push({ step: 'background', text: 'manca il background' });
    else if (!bg) out.push({ step: 'background', text: 'background eliminato' });
    const ch = c.classId ? classSkillChoice(c, bg) : null;
    if (ch && ch.missing) out.push({ step: 'background', text: (ch.missing === 1 ? 'manca 1 abilità' : 'mancano ' + ch.missing + ' abilità') + ' da scegliere' });
    if (!arr(c.inventory).length && !c.weapons.length) out.push({ step: 'equipaggiamento', text: 'nessun equipaggiamento' });
    if (isCaster(c) && c.spellcasting && !c.spellcasting.known.length) out.push({ step: 'incantesimi', text: 'nessun incantesimo scelto' });
    if (!c.name || c.name === 'Senza nome') out.push({ step: 'dettagli', text: 'manca il nome' });
    if (!c.sheet.alignment) out.push({ step: 'dettagli', text: 'manca l\'allineamento' });
    return out;
  }

  // ---------- Riferimenti mancanti ----------
  function missingRefs(c, st) {
    const out = [];
    const eq = arr(st && st.equipment);
    if (arr(c.inventory).some((x) => !eq.some((e) => e.id === x.equipmentId))) out.push('oggetto dell\'inventario eliminato');
    if (c.spellcasting && c.spellcasting.known.some((id) => !arr(st && st.spells).some((s) => s.id === id))) out.push('incantesimo eliminato');
    if (c.sheet.background && !arr(st && st.backgrounds).some((b) => b.id === c.sheet.background)) out.push('background eliminato');
    if (featEffects(c, arr(st && st.feats)).missing.length) out.push('talento eliminato');
    if (c.sheet.allies.some((a) => (a.kind === 'fazione' && !arr(st && st.factions).some((f) => f.id === a.refId)) || (a.kind === 'npc' && !arr(st && st.worldNpcs).some((n) => n.id === a.refId)))) out.push('alleato eliminato');
    return out;
  }

  // ---------- Esportazione e importazione di un personaggio ----------
  // File: il personaggio con il background e i talenti che usa (per importarlo altrove).
  function exportCharacter(c, st) {
    return {
      app: DnD.config ? DnD.config.APP_NAME : 'Session Forge', kind: 'personaggio', version: DnD.modello.VERSION, exportedAt: new Date().toISOString(),
      character: clone(c),
      backgrounds: arr(st.backgrounds).filter((b) => b.id === c.sheet.background).map(clone),
      feats: arr(st.feats).filter((f) => c.sheet.features.some((x) => x.featId === f.id)).map(clone),
    };
  }
  // Importa nella sessione: id nuovo; background e talenti assenti vengono aggiunti (per id). Restituisce
  // { player, backgrounds, feats, warnings } senza modificare lo stato.
  function importCharacter(raw, st, sessionId) {
    if (!raw || raw.kind !== 'personaggio' || !raw.character || typeof raw.character !== 'object') throw new Error('il file non contiene un personaggio di questa app.');
    if (typeof raw.version === 'number' && raw.version > DnD.modello.VERSION) throw new Error('il personaggio viene da una versione più recente dell\'app.');
    const player = DnD.modello.normalizzaCreatura(Object.assign({}, raw.character, { id: uid(), sessionId, shared: false }), true);
    const backgrounds = arr(raw.backgrounds).map(normalizeBackground).filter((b) => !arr(st.backgrounds).some((x) => x.id === b.id)).map((b) => Object.assign(b, { sessionId, shared: false }));
    const feats = arr(raw.feats).map(normalizeFeat).filter((f) => !arr(st.feats).some((x) => x.id === f.id)).map((f) => Object.assign(f, { sessionId, shared: false }));
    const after = Object.assign({}, st, { backgrounds: arr(st.backgrounds).concat(backgrounds), feats: arr(st.feats).concat(feats) });
    return { player, backgrounds, feats, warnings: missingRefs(player, after) };
  }

  DnD.scheda = {
    normalizeSheet, normalizeFeature, normalizeProf, normalizeAlly, normalizeBackground, normalizeFeat, exampleBackgrounds, exampleFeats,
    featEffects, addAbilities, asiAvailable, pointBuy, canBuy, pointBuyStart, skillLevel, skillBonus, skills, passive, registraLivelloLeggendario,
    initiative, speed, carry, attunement, canAttune, levelForXp, xpInfo, autoHp, applyBackground, profSuggestions, classSkillChoice,
    isCaster, preparable, maxSpellLevel, levelUp, STEPS, STEP_NAMES, missing, missingRefs, exportCharacter, importCharacter,
  };
})(globalThis.DnD = globalThis.DnD || {});
