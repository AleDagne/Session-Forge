// Modello dati, dati di esempio, normalizzazione (anche dei file importati) e persistenza.
(function (DnD) {
  'use strict';

  const LEGACY_KEY = 'dnd-battaglie:dati'; // salvataggio in localStorage della versione 1
  const DB_NAME = 'dnd-battaglie';
  const DB_STORE = 'kv';
  const DB_KEY = 'stato';
  const { VERSION, LOG_MAX, DICE_HISTORY_MAX } = DnD.modello;
  const DEFAULT_SESSION_NAME = 'Sessione predefinita';
  const AB = () => DnD.regole.ABILITIES;
  const G = () => DnD.griglia;

  // --- Helper di normalizzazione: accettano qualsiasi valore e restituiscono il tipo atteso. ---
  function str(v, max) {
    return typeof v === 'string' ? v.slice(0, max || 2000) : '';
  }
  function int(v, def, min, max) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  function num(v, def, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function id(v) {
    return typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : DnD.dadi.uid();
  }
  function hex(v, def) {
    return typeof v === 'string' && DnD.icone.HEX.test(v) ? v.toLowerCase() : def;
  }
  // Posizione in celle (l'appartenenza alla griglia si controlla con le sue dimensioni, vedi clampTo).
  function pos(v) {
    v = obj(v);
    const max = G().MAX_SIZE - 1;
    return Number.isInteger(v.x) && Number.isInteger(v.y) && v.x >= 0 && v.y >= 0 && v.x <= max && v.y <= max
      ? { x: v.x, y: v.y } : null;
  }
  // Riporta un elemento w×h dentro una griglia di dimensioni d.
  const clampTo = (p, w, h, d) => ({ x: Math.max(0, Math.min(p.x, d.w - w)), y: Math.max(0, Math.min(p.y, d.h - h)) });

  function makeBonuses(values) {
    const b = {};
    for (const ab of AB()) {
      const v = values && values[ab];
      b[ab] = { value: v || 0, apply: Boolean(v) };
    }
    return b;
  }

  function defaultRaces() {
    const race = (name, size, speed, darkvision, bonuses, description, traits, languages, extra) =>
      normalizeRace(Object.assign({
        id: DnD.dadi.uid(), name, size, speed, darkvision, bonuses: makeBonuses(bonuses),
        description, traits, languages,
      }, extra));
    return [
      race('Umano', 'Media', 9, null, { FOR: 1, DES: 1, COS: 1, INT: 1, SAG: 1, CAR: 1 },
        'Versatili e ambiziosi, gli umani sono la razza più diffusa.',
        'Nessun tratto speciale oltre ai bonus a tutte le caratteristiche.',
        'Comune, un linguaggio a scelta'),
      race('Elfo', 'Media', 9, 18, { DES: 2 },
        'Popolo magico e longevo, aggraziato e attento.',
        'Sensi acuti, Retaggio fatato (vantaggio contro charme, immune al sonno magico), Trance.',
        'Comune, Elfico', { proficiencies: 'Percezione' }),
      race('Nano', 'Media', 7.5, 18, { COS: 2 },
        'Robusti e tenaci, maestri della pietra e del metallo.',
        'Resilienza nanica (vantaggio ai TS contro veleno), Esperto della pietra. La velocità non è ridotta dall\'armatura pesante.',
        'Comune, Nanico', { resistances: 'Veleno', proficiencies: 'Asce da battaglia, asce, martelli leggeri, martelli da guerra' }),
      race('Halfling', 'Piccola', 7.5, null, { DES: 2 },
        'Piccoli, allegri e sorprendentemente coraggiosi.',
        'Fortunato (ritira gli 1 naturali), Coraggioso, Agilità halfling.',
        'Comune, Halfling'),
      race('Orco', 'Media', 9, 18, { FOR: 2, COS: 1 },
        'Guerrieri feroci e resistenti, temuti in battaglia.',
        'Aggressivo (azione bonus per muoversi verso un nemico), Minaccioso.',
        'Comune, Orchesco', { proficiencies: 'Intimidire' }),
    ];
  }

  function defaultStructures() {
    const s = (name, color, preset, w, h) => normalizeStructure({ id: DnD.dadi.uid(), name, color, mode: 'preset', preset, w, h });
    return [
      s('Muro', '#7d7f86', 'rettangolo', 3, 1),
      s('Colonna', '#b9b4a8', 'cerchio', 1, 1),
      s('Albero', '#2f7d3b', 'cerchio', 2, 2),
      s('Tavolo', '#8a5a33', 'rettangolo', 2, 1),
    ].concat(visionStructures());
  }
  // Esempi della visione (v18): bloccano il passaggio ma non la vista.
  function visionStructures() {
    const s = (id, name, color, w, h) => normalizeStructure({ id, name, color, mode: 'preset', preset: 'rettangolo', w, h, blocksSight: false });
    return [s('st-finestra', 'Finestra', '#9fc4d8', 1, 1), s('st-grata', 'Grata', '#5b6270', 3, 1)];
  }

  // Incantesimi di esempio (descrizioni brevi, modificabili o eliminabili).
  function defaultSpells() {
    const sp = (name, level, school, castingTime, range, components, duration, classes, description, effect, extra) =>
      normalizeSpell(Object.assign({ id: DnD.dadi.uid(), name, level, school, castingTime, range, components, duration, classes, description, effect }, extra));
    return [
      sp('Dardo di fuoco', 0, 'invocazione', '1 azione', '36 m', { V: true, S: true }, 'Istantanea', ['mago', 'stregone'],
        'Scagli una scintilla di fuoco contro una creatura o un oggetto. Se colpisce, il bersaglio subisce danni da fuoco; gli oggetti infiammabili prendono fuoco.',
        { type: 'attacco', dice: '1d10', damageType: 'fuoco' }),
      sp('Dardo incantato', 1, 'invocazione', '1 azione', '36 m', { V: true, S: true }, 'Istantanea', ['mago', 'stregone'],
        'Tre dardi di energia luminosa colpiscono senza fallire, ognuno per 1d4+1 danni da forza. Ogni slot superiore aggiunge un dardo.',
        { type: 'nessuno', dice: '3d4+3', damageType: 'forza', upcastDice: '1d4+1' }),
      sp('Palla di fuoco', 3, 'invocazione', '1 azione', '45 m', { V: true, S: true, M: true, material: 'una pallina di guano di pipistrello e zolfo' },
        'Istantanea', ['mago', 'stregone'],
        "Una sfera di fiamme esplode in un raggio di 6 metri. Chi è nell'area tira su Destrezza: metà danni se riesce.",
        { type: 'salvezza', dice: '8d6', damageType: 'fuoco', upcastDice: '1d6', saveAbility: 'DES', halfOnSave: true }, { area: true }),
      sp('Cura ferite', 1, 'invocazione', '1 azione', 'Contatto', { V: true, S: true }, 'Istantanea', ['bardo', 'chierico', 'druido', 'paladino', 'ranger'],
        'Tocchi una creatura e le restituisci punti ferita pari a 1d8 + il tuo modificatore da incantatore. Non ha effetto su non morti e costrutti.',
        { type: 'cura', dice: '1d8', upcastDice: '1d8', addMod: true }),
      sp('Parola di guarigione', 1, 'invocazione', '1 azione bonus', '18 m', { V: true }, 'Istantanea', ['bardo', 'chierico', 'druido'],
        'Una parola di conforto restituisce a una creatura che puoi vedere 1d4 + il tuo modificatore da incantatore punti ferita.',
        { type: 'cura', dice: '1d4', upcastDice: '1d4', addMod: true }),
    ];
  }

  // Oggetti di mappa di esempio (modelli: ogni copia piazzata ha stato e contenuto propri).
  function defaultMapObjects() {
    const o = (id, name, otype, icon, color, extra) => normalizeMapObject(Object.assign({ id, name, otype, icon: { kind: 'library', icon, color } }, extra));
    return [
      o('mo-forziere', 'Forziere', 'forziere', 'forziere', '#b07a3c', { lock: { locked: true, dcPick: 15, dcForce: 17 }, coins: { mo: 25 } }),
      o('mo-porta', 'Porta di legno', 'porta', 'porta', '#8a5a33', { lock: { locked: false, dcPick: 15, dcForce: 15 } }),
      o('mo-leva', 'Leva', 'leva', 'leva', '#9aa0ab'),
      o('mo-trappola', 'Trappola a lame', 'trappola', 'trappola', '#d4453a', { hidden: true, trap: { dcFind: 14, dcDisarm: 13, effect: { kind: 'salvezza', dice: '2d10', type: 'tagliente', ability: 'DES', dc: 13, half: true } } }),
      o('mo-barile', 'Barile', 'barile', 'barile', '#8a6a3a', { blocks: true }),
    ].concat(visionMapObjects());
  }
  // Esempi della visione (v18): oggetti che fanno luce.
  function visionMapObjects() {
    const o = (id, name, otype, icon, color, extra) => normalizeMapObject(Object.assign({ id, name, otype, icon: { kind: 'library', icon, color } }, extra));
    return [
      o('mo-braciere', 'Braciere', 'altro', 'torcia', '#d9822b', { blocks: true, interactive: true, light: { on: true, bright: 20, dim: 20, color: '#ff9a3c', flicker: true } }),
      o('mo-lanterna', 'Lanterna appesa', 'altro', 'torcia', '#e8c34a', { interactive: true, light: { on: true, bright: 15, dim: 15, color: '#ffd27a', flicker: false } }),
    ];
  }

  // Creature d'esempio (originali): condivise con tutte le sessioni, modificabili ed eliminabili.
  function defaultCreatures(sessionId) {
    return DnD.creatureDati.examples().map((c) => normalizeCreature(Object.assign(c, { sessionId, shared: true }), false));
  }

  function emptyState() {
    const session = DnD.sessioni.newSession(DEFAULT_SESSION_NAME, DnD.dadi.uid());
    const world = defaultWorld(session.id);
    return {
      version: VERSION, races: defaultRaces(), npcs: defaultCreatures(session.id), players: [], structures: defaultStructures(),
      equipment: DnD.attrezzatura.defaults(), mapObjects: defaultMapObjects(), tilesets: [], spells: defaultSpells(), savedGrids: [],
      biomes: DnD.biomi.examples(), events: DnD.eventi.examples(), pathTemplates: [DnD.percorso.exampleTemplate()], customConditions: [],
      difficultyRules: DnD.difficolta.defaultRules(),
      // Scene (scaletta per sessione) e libreria degli incontri (con tre esempi condivisi).
      scenes: [], encounters: DnD.scene.examples(session.id),
      // Scheda del giocatore: background e talenti (librerie per sessione, esempi condivisi).
      backgrounds: DnD.scheda.exampleBackgrounds(session.id), feats: DnD.scheda.exampleFeats(session.id),
      // Mondo (per sessione, condivisibili): fazioni (le tre predefinite sono condivise), party, città, NPC e quest.
      factions: DnD.fazioni.builtinFactions(session.id).concat(world.factions), parties: [DnD.party.defaultParty(session.id, [])],
      cities: world.cities, worldNpcs: world.worldNpcs, quests: world.quests,
      sessions: [session], currentSessionId: session.id, diceHistory: [],
    };
  }

  // --- Normalizzazione delle entità ---
  function normalizeRace(r) {
    r = obj(r);
    const bonuses = {};
    for (const ab of AB()) {
      const b = obj(obj(r.bonuses)[ab]);
      bonuses[ab] = { value: int(b.value, 0, -10, 10), apply: Boolean(b.apply) };
    }
    const sizes = DnD.validazione.SIZES;
    return {
      id: id(r.id),
      name: str(r.name, 60) || 'Senza nome',
      size: sizes.includes(r.size) ? r.size : 'Media',
      speed: num(r.speed, 9, 0, 100),
      darkvision: r.darkvision === null || r.darkvision === undefined || r.darkvision === ''
        ? null : num(r.darkvision, null, 0, 200),
      description: str(r.description),
      traits: str(r.traits),
      bonuses,
      resistances: str(r.resistances, 500),
      languages: str(r.languages, 500),
      proficiencies: str(r.proficiencies, 500),
    };
  }

  // Arma di una scheda: scritta a mano, oppure scelta dal catalogo dell'Attrezzatura (equipmentId) con
  // bonus e danno calcolati in automatico (auto) o sovrascritti a mano.
  function normalizeWeapon(w) {
    w = obj(w);
    const dice = DnD.dadi.parseExpr(w.damageDice);
    return {
      id: id(w.id),
      name: str(w.name, 60) || 'Arma',
      toHit: int(w.toHit, 0, -20, 30),
      damageDice: dice && dice.count > 0 ? dice.count + 'd' + dice.sides : '1d4',
      damageBonus: int(w.damageBonus, 0, -20, 30),
      damageType: str(w.damageType, 40),
      equipmentId: typeof w.equipmentId === 'string' ? w.equipmentId.slice(0, 64) : '',
      auto: Boolean(w.equipmentId) && w.auto !== false,
      magical: Boolean(w.magical),
    };
  }

  // Dimensione sulla griglia: Automatica (dalla taglia della razza o della creatura) o w × h a scelta.
  // Dimensione sulla griglia: definita in griglia.js (serve anche alle regole), qui riesportata.
  const normalizeGridSize = (gs) => G().normalizeGridSize(gs);

  function abilityList(v, max) {
    return [...new Set(arr(v).filter((ab) => AB().includes(ab)))].slice(0, max);
  }

  // Classe: id noto, "personalizzata" o vuota. I dati della versione 2 avevano la classe come
  // testo libero (cls): se corrisponde a una classe nota la si seleziona, altrimenti diventa
  // "Personalizzata" e il testo originale finisce nelle note.
  function normalizeClass(c, notes) {
    const C = DnD.classi;
    if (typeof c.classId === 'string') {
      return { classId: C.CLASSES[c.classId] || c.classId === C.CUSTOM ? c.classId : '', notes };
    }
    const text = str(c.cls, 60).trim();
    if (!text) return { classId: '', notes };
    const match = C.matchClass(text);
    if (match) return { classId: match, notes };
    return { classId: C.CUSTOM, notes: (notes ? notes + '\n' : '') + 'Classe originale: ' + text };
  }

  const nullableInt = (v, min, max) => (v === null || v === undefined || v === '' ? null : int(v, null, min, max));
  const nine = (v, fn) => Array.from({ length: 9 }, (_, i) => fn(arr(v)[i]));

  function normalizeSpellcasting(sc) {
    sc = obj(sc);
    return {
      ability: AB().includes(sc.ability) ? sc.ability : null,
      attackOverride: nullableInt(sc.attackOverride, -10, 30),
      dcOverride: nullableInt(sc.dcOverride, 0, 40),
      slotOverrides: nine(sc.slotOverrides, (v) => nullableInt(v, 0, 20)),
      slotsUsed: nine(sc.slotsUsed, (v) => int(v, 0, 0, 20)),
      known: [...new Set(arr(sc.known).filter((x) => typeof x === 'string'))].slice(0, 500),
    };
  }

  function normalizeSpell(sp) {
    sp = obj(sp);
    const comp = obj(sp.components);
    const e = obj(sp.effect);
    const dice = (v) => { const p = DnD.dadi.parseExpr(v); return p && p.count > 0 ? DnD.dadi.formatExpr(p.count, p.sides, p.modifier) : ''; };
    return {
      id: id(sp.id),
      name: str(sp.name, 60) || 'Incantesimo',
      level: int(sp.level, 0, 0, 9),
      school: DnD.magie.SCHOOLS.includes(sp.school) ? sp.school : 'invocazione',
      castingTime: str(sp.castingTime, 60),
      range: str(sp.range, 60),
      components: { V: Boolean(comp.V), S: Boolean(comp.S), M: Boolean(comp.M), material: str(comp.material, 200) },
      duration: str(sp.duration, 60),
      concentration: Boolean(sp.concentration),
      area: Boolean(sp.area),
      classes: [...new Set(arr(sp.classes).filter((x) => DnD.classi.IDS.includes(x)))],
      description: str(sp.description, 5000),
      effect: {
        type: DnD.magie.EFFECTS.includes(e.type) ? e.type : 'nessuno',
        dice: dice(e.dice),
        damageType: str(e.damageType, 40),
        upcastDice: dice(e.upcastDice),
        saveAbility: AB().includes(e.saveAbility) ? e.saveAbility : 'DES',
        halfOnSave: Boolean(e.halfOnSave),
        addMod: Boolean(e.addMod),
      },
      // Condizione inflitta ai bersagli (che falliscono la salvezza o sono colpiti).
      inflict: DnD.condizioni.normalizeInflict(sp.inflict),
    };
  }

  // Nemici e giocatori. I nemici sono di due tipi: "standard" (scheda con razza, classe e livello) e
  // "creatura" (scheda del Manuale dei Mostri, vedi creature.js). I dati precedenti sono tutti standard.
  // I boss (type 'boss', vedi boss.js) sono creature con in più i campi di presentazione e le fasi.
  function normalizeCreature(c, isPlayer) {
    c = obj(c);
    if (!isPlayer && DnD.boss.isMonster(c)) {
      const boss = c.type === 'boss' ? { type: 'boss', boss: DnD.boss.normalizeBoss(c.boss) } : {};
      return Object.assign({
        id: id(c.id),
        name: str(c.name, 60) || 'Creatura',
        icon: DnD.icone.normalizeIcon(c.icon, false),
        gridSize: normalizeGridSize(c.gridSize),
        // Comportamento nel combattimento simulato (IA): temperamento, archetipo, opzioni avanzate.
        behavior: DnD.ia.normalizeBehavior(c.behavior),
        notes: str(c.notes, 5000),
      }, DnD.creature.normalizeMonster(c), boss, worldRefs(c), restStatus(c), ownership(c));
    }
    const abilities = {};
    for (const ab of AB()) abilities[ab] = int(obj(c.abilities)[ab], 10, 1, 30);
    const cls = normalizeClass(c, str(c.notes, 5000));
    const custom = obj(c.customClass);
    const armor = obj(c.armor);
    const armorType = DnD.regole.ARMOR_TYPES.includes(armor.type) ? armor.type : 'nessuna';
    const hpBasis = obj(c.hpBasis);
    const out = {
      id: id(c.id),
      type: 'standard',
      name: str(c.name, 60) || 'Senza nome',
      raceId: typeof c.raceId === 'string' ? c.raceId : '',
      // Leggendari (solo giocatori): livelli 20-40.
      level: isPlayer && c.type === 'leggendario' ? int(c.level, 20, 20, 40) : int(c.level, 1, 1, 30),
      classId: cls.classId,
      customClass: {
        hitDie: DnD.classi.HIT_DICE.includes(custom.hitDie) ? custom.hitDie : 8,
        saves: abilityList(custom.saves, 6),
        priority: abilityList(custom.priority, 3),
        caster: DnD.classi.CASTER_TYPES.includes(custom.caster) ? custom.caster : '',
      },
      abilities,
      asi: Object.fromEntries(AB().map((ab) => [ab, int(obj(c.asi)[ab], 0, 0, 20)])),
      ignoreCap: Boolean(c.ignoreCap),
      spellcasting: normalizeSpellcasting(c.spellcasting),
      // Le creature precedenti restano in modalità manuale, così PF e CA non cambiano.
      hpMode: c.hpMode === 'auto' ? 'auto' : 'manuale',
      hpMethod: c.hpMethod === 'media' ? 'media' : 'tira',
      hpBasis: c.hpBasis ? { level: int(hpBasis.level, 1, 1, 40), conMod: int(hpBasis.conMod, 0, -10, 20), hitDie: int(hpBasis.hitDie, 8, 4, 12) } : null,
      hpDetail: str(c.hpDetail, 300),
      maxHp: int(c.maxHp, 1, 1, 9999),
      acMode: c.acMode === 'auto' ? 'auto' : 'manuale',
      armor: {
        type: armorType,
        base: int(armor.base, DnD.regole.ARMOR_BASE[armorType], 0, 30),
        shield: Boolean(armor.shield),
        unarmored: Boolean(armor.unarmored),
        bonus: int(armor.bonus, 0, 0, 10),
        // Armatura e scudo scelti dal catalogo dell'Attrezzatura (vuoti = campi scritti a mano).
        equipmentId: typeof armor.equipmentId === 'string' ? armor.equipmentId.slice(0, 64) : '',
        shieldId: typeof armor.shieldId === 'string' ? armor.shieldId.slice(0, 64) : '',
      },
      ac: int(c.ac, 10, 1, 40),
      saveMode: c.saveMode === 'manuale' ? 'manuale' : 'classe',
      saves: abilityList(c.saves, 6),
      profBonusOverride: c.profBonusOverride === null || c.profBonusOverride === undefined || c.profBonusOverride === ''
        ? null : int(c.profBonusOverride, null, 0, 20),
      weapons: arr(c.weapons).slice(0, 50).map(normalizeWeapon),
      notes: cls.notes,
      icon: DnD.icone.normalizeIcon(c.icon, false),
      gridSize: normalizeGridSize(c.gridSize),
      behavior: DnD.ia.normalizeBehavior(c.behavior),
      // Nemici creati dal generatore: razza, livello e classe di partenza.
      generated: Boolean(c.generated),
      origin: c.generated && c.origin && typeof c.origin === 'object'
        ? { raceId: str(c.origin.raceId, 64), level: int(c.origin.level, 1, 1, 20), classId: str(c.origin.classId, 40) } : null,
    };
    // Difficoltà (difficolta.js): grado di sfida dei nemici standard, vuoto = stimato dal livello (livello / 2).
    if (!isPlayer) out.crOverride = DnD.creatureDati.CRS.includes(String(c.crOverride)) ? String(c.crOverride) : '';
    // In modalità "da classe" le competenze sono sempre quelle della classe.
    if (out.saveMode === 'classe') {
      const info = DnD.classi.classInfo(out.classId, out.customClass);
      out.saves = info ? info.saves.slice() : [];
    }
    if (isPlayer) {
      delete out.type;
      out.playerName = str(c.playerName, 60);
      out.inventory = DnD.attrezzatura.normalizeInventory(c.inventory);
      out.coins = DnD.attrezzatura.normalizeCoins(c.coins);
      // PE accumulati (ricompense delle scene).
      out.xp = int(c.xp, 0, 0, 100000000);
      // Scheda del giocatore (scheda.js): background, allineamento, abilità, privilegi, aspetto, storia…
      out.sheet = DnD.scheda.normalizeSheet(c.sheet);
      // Personaggio leggendario (leggendario.js): tetto delle caratteristiche, Percorso e Trasformazioni.
      // Un giocatore declassato conserva i dati del percorso (legendArchive) per una nuova promozione.
      if (c.type === 'leggendario') {
        out.type = 'leggendario';
        out.abilityCap = int(c.abilityCap, 30, 20, 30);
        out.legend = DnD.leggendario.normalizeLegend(c.legend);
      } else if (c.legendArchive && typeof c.legendArchive === 'object') {
        out.legendArchive = DnD.leggendario.normalizeLegend(c.legendArchive);
      }
    }
    Object.assign(out, worldRefs(c), restStatus(c), ownership(c));
    return out;
  }

  // Fazione (vuota = predefinita: Nemici, quella della città o del party) e città d'origine.
  const REF = /^[\w-]{1,64}$/;
  const refId = (v) => (typeof v === 'string' && REF.test(v) ? v : '');
  // Riposi e risorse (riposi.js): PF attuali, PF temporanei, dadi vita spesi, sfinimento, ultimo riposo lungo, risorse
  // personalizzate. I dati precedenti ricevono i valori di base (PF al massimo, nessun dado vita speso).
  function restStatus(c) {
    return { status: DnD.riposi.normalizeStatus(c.status) };
  }

  function worldRefs(c) {
    return { factionId: refId(c.factionId), cityId: refId(c.cityId) };
  }

  // Appartenenza a una sessione: sessionId della sessione proprietaria, shared = visibile in tutte.
  function ownership(x) {
    return { sessionId: typeof x.sessionId === 'string' ? x.sessionId.slice(0, 64) : '', shared: Boolean(x.shared) };
  }

  // Forma: { w, h, cells } con cells stringa di "0"/"1". Le forme predefinite si ricalcolano dal preset.
  function normalizeShape(s, maxSide) {
    const w = int(s.w, 1, 1, maxSide);
    const h = int(s.h, 1, 1, maxSide);
    const cells = typeof s.cells === 'string' && s.cells.length === w * h && /^[01]+$/.test(s.cells) && s.cells.includes('1')
      ? s.cells : '1'.repeat(w * h);
    return { w, h, cells };
  }

  // ---------- TileSet e TileMap ----------
  const IMAGE_ID = /^img-[0-9a-f]{16}$/;
  const T = () => DnD.tileset;
  const TM = () => DnD.tilemap;
  const bits = (v, n, def) => (typeof v === 'string' && v.length === n && /^[01]*$/.test(v) ? v : def.repeat(n));
  const CUSTOM_KEY = /^[\w .-]{1,40}$/;

  // Proprietà di una tile: solo i valori diversi da quelli predefiniti (vedi tileset.compactProps), o null.
  function normalizeTileProps(p) {
    p = obj(p);
    const col = obj(p.collision);
    const custom = {};
    for (const [k, v] of Object.entries(obj(p.custom)).slice(0, 32)) if (CUSTOM_KEY.test(k)) custom[k] = str(String(v), 200);
    return T().compactProps({
      name: str(p.name, 60),
      category: str(p.category, 40),
      tags: [...new Set(arr(p.tags).map((x) => str(x, 30).trim()).filter(Boolean))].slice(0, 20),
      blocking: Boolean(p.blocking),
      excluded: Boolean(p.excluded),
      navigable: p.navigable !== false,
      cost: num(p.cost, 1, 1, 10),
      cover: T().COVERS.includes(p.cover) ? p.cover : '',
      collision: { enabled: Boolean(col.enabled), polygons: DnD.collisioni.normalizePolygons(col.polygons) },
      rotate: p.rotate !== false,
      flip: p.flip !== false,
      custom,
    });
  }

  // Sorgente (texture) di un TileSet: colonne e righe si ricalcolano dal taglio. Le sorgenti "legacy"
  // (migrate dalle vecchie immagini) hanno tileW = 0 finché non si conoscono i pixel dell'immagine.
  function normalizeSource(s, fallbackId) {
    s = obj(s);
    const tileW = num(s.tileW, 32, 0, T().MAX_IMAGE_SIDE);
    return T().recut({
      id: int(s.id, fallbackId, 0, 2047),
      name: str(s.name, 60) || 'Texture',
      imageId: IMAGE_ID.test(s.imageId) ? s.imageId : null,
      imageW: int(s.imageW, 0, 0, T().MAX_IMAGE_SIDE),
      imageH: int(s.imageH, 0, 0, T().MAX_IMAGE_SIDE),
      tileW,
      tileH: num(s.tileH, tileW, 0, T().MAX_IMAGE_SIDE),
      offsetX: int(s.offsetX, 0, 0, 4096),
      offsetY: int(s.offsetY, 0, 0, 4096),
      margin: int(s.margin, 0, 0, 2048),
      sepX: int(s.sepX, 0, 0, 2048),
      sepY: int(s.sepY, 0, 0, 2048),
      cols: int(s.cols, 1, 1, T().MAX_GRID),
      rows: int(s.rows, 1, 1, T().MAX_GRID),
      legacy: Boolean(s.legacy),
      cover: Boolean(s.cover),
    });
  }

  // TileSet: libreria globale con più sorgenti; tiles[tileId] = proprietà non predefinite.
  function normalizeTileset(ts) {
    ts = obj(ts);
    const seen = new Set();
    const sources = arr(ts.sources).slice(0, 2048).map((s, i) => normalizeSource(s, i)).filter((s) => !seen.has(s.id) && seen.add(s.id));
    const tiles = {};
    for (const [k, p] of Object.entries(obj(ts.tiles))) {
      const tid = Number(k);
      if (!Number.isInteger(tid) || tid < 0 || !seen.has(T().tileCoords(tid).src)) continue;
      const n = normalizeTileProps(p);
      if (n) tiles[tid] = n;
    }
    return {
      id: id(ts.id),
      name: str(ts.name, 60) || 'TileSet',
      smooth: Boolean(ts.smooth),
      threshold: num(ts.threshold, T().EMPTY_THRESHOLD, 0, 1),
      blockThreshold: num(ts.blockThreshold, T().BLOCK_THRESHOLD, 0.05, 1),
      nextSourceId: Math.max(int(ts.nextSourceId, 0, 0, 2048), ...sources.map((s) => s.id + 1), 0),
      sources,
      tiles,
    };
  }

  function normalizeLayer(l, n, i, nRefs) {
    l = obj(l);
    const data = arr(l.data);
    const cell = (c) => (Array.isArray(c) && c.length === 3 && Number.isInteger(c[0]) && c[0] >= 0 && c[0] < nRefs &&
      Number.isInteger(c[1]) && c[1] >= 0 && c[1] < 2147483648 && Number.isInteger(c[2]) && c[2] >= 0 && c[2] < 8 ? [c[0], c[1], c[2]] : null);
    return {
      id: typeof l.id === 'string' && /^[\w-]{1,40}$/.test(l.id) ? l.id : 'l' + i,
      name: str(l.name, 40) || 'Livello ' + (i + 1),
      visible: l.visible !== false,
      opacity: num(l.opacity, 1, 0, 1),
      above: Boolean(l.above),
      fade: Boolean(l.fade),
      locked: Boolean(l.locked),
      data: Array.from({ length: n }, (_, k) => cell(data[k])),
    };
  }

  // TileMap: di una griglia, di una struttura o di un oggetto (anche piazzati sulla griglia).
  // Riferimenti a TileSet non elencati nella mappa, celle e livelli non validi vengono scartati.
  function normalizeTiles(t) {
    if (!t || typeof t !== 'object') return null;
    const w = int(t.w, 1, 1, TM().MAX_SIDE);
    const h = int(t.h, 1, 1, TM().MAX_SIDE);
    const n = w * h;
    const tilesets = arr(t.tilesets).filter((x) => typeof x === 'string' && /^[\w-]{1,80}$/.test(x)).slice(0, 32);
    const seen = new Set();
    let layers = arr(t.layers).slice(0, TM().MAX_LAYERS).map((l, i) => normalizeLayer(l, n, i, tilesets.length));
    // Id dei livelli unici: un duplicato riceve un id nuovo.
    for (const l of layers) {
      for (let k = 0; seen.has(l.id); k++) l.id = 'l' + (layers.length + k);
      seen.add(l.id);
    }
    if (!layers.length) layers = [normalizeLayer({ name: 'Base' }, n, 0, 0)];
    const cellW = num(t.cellW, 0, 0, 4096);
    return {
      kind: t.kind === 'mappa' ? 'mappa' : 'immagine',
      w, h,
      cellW,
      cellH: num(t.cellH, cellW, 0, 4096),
      feetPerCell: num(t.feetPerCell, 5, 1, 100),
      showGrid: t.showGrid !== false,
      tilesets, layers,
      mask: bits(t.mask, n, '1'),
      drawAll: Boolean(t.drawAll),
      overrides: typeof t.overrides === 'string' && t.overrides.length === n && /^[-bl]*$/.test(t.overrides) ? t.overrides : '-'.repeat(n),
      // Modalità A: tile selezionati sull'intera sorgente (la tilemap può essere ritagliata).
      sel: typeof t.sel === 'string' && t.sel.length <= 1048576 && /^[01]*$/.test(t.sel) ? t.sel : '',
      source: int(t.source, 0, 0, 2047),
      // Strutture "da immagine": rotazioni e specchi applicati dopo la selezione dei tile (per riaprire il form).
      ops: arr(t.ops).filter((op) => ['ruota', 'ruota-sx', 'specchia', 'specchia-v'].includes(op)).slice(0, 16),
      // Ingombro calcolato al salvataggio (vedi collisioni.footprint): resta valido anche se il TileSet manca.
      cells: bits(t.cells, n, '0'),
    };
  }

  // Modalità: 'preset' (forma predefinita), 'custom' (celle), 'tiles' (tileset).
  // In modalità tileset la forma resta salvata, così si può tornare indietro senza perderla.
  function normalizeStructure(s) {
    s = obj(s);
    const tiles = normalizeTiles(s.tiles);
    const mode = s.mode === 'custom' || (s.mode === 'tiles' && tiles) ? s.mode : 'preset';
    // shapeMode: la forma usata quando non c'è il tileset (predefinita o a celle).
    const shapeMode = mode === 'tiles' ? (s.shapeMode === 'custom' ? 'custom' : 'preset') : mode;
    const preset = G().PRESETS.includes(s.preset) ? s.preset : 'rettangolo';
    let shape;
    if (shapeMode === 'custom') shape = normalizeShape(s, DnD.validazione.MAX_CUSTOM);
    else { const n = normalizeShape(s, DnD.validazione.MAX_PRESET); shape = G().presetShape(preset, n.w, n.h); }
    return Object.assign({
      id: id(s.id),
      name: str(s.name, 60) || 'Struttura',
      color: hex(s.color, '#7d7f86'),
      mode,
      shapeMode,
      preset,
      // Visione: blocca la vista (di base sì: una finestra o una grata no) e luce emessa (facoltativa).
      blocksSight: s.blocksSight !== false,
      light: DnD.visione.normalizeEmitter(s.light),
    }, shape, { tiles });
  }

  // Oggetto dell'Attrezzatura (catalogo globale): vedi attrezzatura.js.
  const normalizeEquipment = (e) => DnD.attrezzatura.normalizeEquipment(e);
  // Modello di oggetto di mappa (libreria globale): vedi oggetti-mappa.js.
  const normalizeMapObject = (o) => DnD.oggettiMappa.normalizeTemplate(o, normalizeTiles);

  // Struttura posizionata sulla griglia (copia indipendente dal modello, ruotabile e specchiabile).
  // d: dimensioni della griglia (di base 50×50).
  function normalizePlacedStructure(s, d) {
    s = obj(s);
    const tiles = normalizeTiles(s.tiles);
    const shape = tiles ? { w: tiles.w, h: tiles.h, cells: tiles.cells } : normalizeShape(s, G().MAX_SIZE);
    return Object.assign({
      id: id(s.id), sourceId: str(s.sourceId, 64), name: str(s.name, 60) || 'Struttura', color: hex(s.color, '#7d7f86'),
      blocksSight: s.blocksSight !== false, light: DnD.visione.normalizeEmitter(s.light),
    }, clampTo(pos(s) || { x: 0, y: 0 }, shape.w, shape.h, d || G().dims(null)), shape, { tiles });
  }

  // Oggetto di mappa piazzato: 1×1 (icona) oppure con l'ingombro della sua tilemap; stato e contenuto propri.
  function normalizePlacedItem(it, d) {
    it = obj(it);
    const tiles = normalizeTiles(it.tiles);
    const shape = tiles ? { w: tiles.w, h: tiles.h, cells: tiles.cells } : normalizeShape(it, G().MAX_SIZE);
    return Object.assign({
      id: id(it.id), sourceId: str(it.sourceId, 64), name: str(it.name, 60) || 'Oggetto', icon: DnD.icone.normalizeIcon(it.icon, true),
      mode: tiles ? 'tiles' : 'icon',
    }, clampTo(pos(it) || { x: 0, y: 0 }, shape.w, shape.h, d || G().dims(null)), shape, DnD.oggettiMappa.normalizeFields(it), { tiles },
    // Copia di un NPC del Mondo: modello e stato proprio (PF, merce, atteggiamento, ostilità, quest consegnate).
    it.otype === 'npc' ? { npcId: refId(it.npcId), npcState: DnD.npc.normalizeState(it.npcState, null) } : {});
  }

  function normalizeLabel(l, d) {
    l = obj(l);
    return Object.assign({ id: id(l.id), text: str(l.text, 40) || 'Etichetta' }, clampTo(pos(l) || { x: 0, y: 0 }, 1, 1, d || G().dims(null)));
  }

  function normalizeZone(z, d) {
    z = obj(z);
    const dd = d || G().dims(null);
    const p = clampTo(pos(z) || { x: 0, y: 0 }, 1, 1, dd);
    const w = int(z.w, 1, 1, dd.w - p.x);
    const h = int(z.h, 1, 1, dd.h - p.y);
    return { id: id(z.id), kind: z.kind === 'nemici' ? 'nemici' : 'giocatori', x: p.x, y: p.y, w, h };
  }

  // Sfondo della griglia: colore oppure immagine importata (in IndexedDB) con adattamento, posizione,
  // scala e opacità. null = nessuno sfondo (il colore del tema).
  function normalizeBackground(b) {
    if (!b || typeof b !== 'object') return null;
    const image = b.kind === 'immagine' && IMAGE_ID.test(b.imageId);
    return {
      kind: image ? 'immagine' : 'colore',
      color: hex(b.color, '#2b2f38'),
      imageId: image ? b.imageId : null,
      imageW: int(b.imageW, 0, 0, 100000),
      imageH: int(b.imageH, 0, 0, 100000),
      fit: G().BG_FITS.includes(b.fit) ? b.fit : 'adatta',
      x: num(b.x, 0, -1000, 1000),
      y: num(b.y, 0, -1000, 1000),
      scale: num(b.scale, 1, 0.05, 20),
      opacity: num(b.opacity, 1, 0, 1),
      pxPerCell: num(b.pxPerCell, 0, 0, 4096),
    };
  }

  // Contenuto di una griglia (combattimento, griglia salvata o bozza dell'editor) con le sue proprietà:
  // dimensione (w × h, 5–100, di base 50×50), piedi per cella e sfondo. tileMap: la TileMap dipinta, sempre
  // grande quanto la griglia (null finché non la si crea).
  function normalizeGridContent(g) {
    g = obj(g);
    const size = (v) => int(v, G().DEFAULT_SIZE, G().MIN_SIZE, G().MAX_SIZE);
    const d = { w: size(g.w), h: size(g.h) };
    let tileMap = normalizeTiles(g.tileMap);
    if (tileMap) {
      tileMap.kind = 'mappa';
      if (tileMap.w !== d.w || tileMap.h !== d.h) tileMap = Object.assign(TM().reshape(tileMap, d.w, d.h), { kind: 'mappa' });
    }
    return {
      w: d.w, h: d.h,
      feetPerCell: num(g.feetPerCell, tileMap ? tileMap.feetPerCell : 5, 1, 100),
      background: normalizeBackground(g.background),
      structures: arr(g.structures).slice(0, 2500).map((x) => normalizePlacedStructure(x, d)),
      items: arr(g.items).slice(0, 2500).map((x) => normalizePlacedItem(x, d)),
      labels: arr(g.labels).slice(0, 2500).map((x) => normalizeLabel(x, d)),
      zones: arr(g.zones).slice(0, 100).map((x) => normalizeZone(x, d)),
      tileMap,
      // Esplorazione: tipo (battaglia di base), scala, mappa dei biomi, eventi piazzati e nebbia (esplorazione.js).
      ...DnD.esplorazione.normalizeGridExtras(g, d.w, d.h),
    };
  }

  function normalizeCombatantSpells(sc) {
    if (!sc || typeof sc !== 'object') return null;
    return {
      attack: int(sc.attack, 0, -10, 30),
      dc: int(sc.dc, 10, 0, 40),
      ability: AB().includes(sc.ability) ? sc.ability : 'INT',
      mod: int(sc.mod, 0, -10, 20),
      pact: Boolean(sc.pact),
      slotsTotal: nine(sc.slotsTotal, (v) => int(v, 0, 0, 20)),
      slotsUsed: nine(sc.slotsUsed, (v) => int(v, 0, 0, 20)),
      spells: arr(sc.spells).slice(0, 500).map(normalizeSpell),
      // Incantesimi innati delle creature: { idIncantesimo: { freq: 'volonta' | 'giorno', left } }, senza slot.
      innate: sc.innate && typeof sc.innate === 'object' ? Object.fromEntries(Object.entries(sc.innate).slice(0, 100).map(([k, v]) => [k, {
        freq: obj(v).freq === 'giorno' ? 'giorno' : 'volonta', left: obj(v).freq === 'giorno' ? int(obj(v).left, 0, 0, 20) : null,
      }])) : null,
    };
  }

  const defenseList = (v) => [...new Set(arr(v).filter((t) => DnD.creatureDati.DEFENSE_TYPES.includes(t)))];

  // Stato di una creatura nel combattimento (vedi creature.combatState): copia della scheda e contatori.
  function normalizeCombatCreature(st) {
    if (!st || typeof st !== 'object') return null;
    const m = DnD.creature.normalizeMonster(st);
    const counters = (v, fn) => Object.fromEntries(Object.entries(obj(v)).filter(([k]) => /^[\w-]{1,64}$/.test(k)).slice(0, 200).map(([k, x]) => [k, fn(x)]));
    const lp = obj(st.legendaryPoints);
    const lr = obj(st.legendaryResistance);
    return {
      name: str(st.name, 80), size: m.size, cr: m.cr, abilities: m.abilities, saves: m.saves, skills: m.skills,
      traits: m.traits, actions: m.actions, bonusActions: m.bonusActions, reactions: m.reactions, legendary: m.legendary, lair: m.lair,
      uses: counters(st.uses, (x) => int(x, 0, 0, 20)),
      recharge: counters(st.recharge, Boolean),
      legendaryPoints: { max: int(lp.max, 0, 0, 10), left: int(lp.left, 0, 0, 10) },
      legendaryResistance: { max: int(lr.max, 0, 0, 10), left: int(lr.left, 0, 0, 10) },
    };
  }

  function normalizeCombatLegend(l) {
    if (!l || typeof l !== 'object') return null;
    const f = l.form && typeof l.form === 'object' ? l.form : null;
    const keys = DnD.leggendario.FORM_KEYS;
    return {
      theme: DnD.leggendario.THEMES.includes(l.theme) ? l.theme : 'divino',
      rank: int(l.rank, 0, 0, 20),
      transformations: arr(l.transformations).filter((x) => typeof x === 'string').slice(0, 20),
      uses: Object.fromEntries(Object.entries(obj(l.uses)).slice(0, 50).map(([k, v]) => [str(k, 64), int(v, 0, 0, 99)])),
      senses: Object.fromEntries(Object.entries(obj(l.senses)).slice(0, 10).map(([k, v]) => [str(k, 40), int(v, 0, 0, 1000)])),
      texts: arr(l.texts).filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 2000)),
      passive: l.passive === null || l.passive === undefined ? null : int(l.passive, 10, 0, 60),
      form: f ? {
        id: str(f.id, 64), name: str(f.name, 60), hpMode: f.hpMode === 'temporanei' ? 'temporanei' : 'sostituisce', theme: str(f.theme, 20),
        roundsLeft: int(f.roundsLeft, 1, 0, 100000), canEndEarly: f.canEndEarly !== false, exitText: str(f.exitText, 2000),
        // Stato del combattente prima della trasformazione (solo i campi che la forma sostituisce).
        prev: Object.fromEntries(keys.map((k) => [k, f.prev && f.prev[k] !== undefined ? JSON.parse(JSON.stringify(f.prev[k])) : null])),
      } : null,
    };
  }

  function normalizeCombatant(c) {
    c = obj(c);
    const maxHp = int(c.maxHp, 1, 1, 9999);
    const dims = G().tokenDims(c);
    const def = obj(c.defenses);
    const ps = obj(c.pendingSave);
    return {
      id: id(c.id),
      sourceId: str(c.sourceId, 64),
      kind: c.kind === 'player' ? 'player' : 'npc',
      name: str(c.name, 80) || 'Senza nome',
      copy: int(c.copy, 0, 0, 999),
      maxHp,
      hp: int(c.hp, maxHp, 0, maxHp),
      ac: int(c.ac, 10, 1, 40),
      dexMod: int(c.dexMod, 0, -10, 20),
      saves: Object.fromEntries(AB().map((ab) => [ab, int(obj(c.saves)[ab], 0, -10, 30)])),
      initiative: int(c.initiative, 0, -20, 60),
      initiativeRoll: int(c.initiativeRoll, 0, 0, 20),
      w: dims.w,
      h: dims.h,
      // Movimento (movimento.js): velocità in piedi per modalità (i dati precedenti hanno «speed» in metri, a
      // piedi), sovrascrittura a mano, modalità attiva, condizioni, residuo del turno e «Ignora velocità».
      speeds: DnD.movimento.baseSpeeds(c),
      speedOverride: DnD.movimento.normalizeOverride(c.speedOverride),
      moveMode: DnD.movimento.MODES.includes(c.moveMode) ? c.moveMode : 'cammina',
      // Condizioni attive (condizioni.js): le stringhe della versione 12 diventano voci «fino a nuovo ordine».
      conditions: DnD.condizioni.normalizeList(c.conditions),
      // Concentrazione su un incantesimo (con l'ultima persa, per «Ripristina») e vantaggio da un tratto.
      concentration: c.concentration && typeof c.concentration === 'object' && refId(c.concentration.spellId)
        ? { spellId: refId(c.concentration.spellId), name: str(c.concentration.name, 60), round: int(c.concentration.round, 1, 0, 100000) } : null,
      concentrationUndo: normalizeConcentrationUndo(c.concentrationUndo),
      concentrationAdv: Boolean(c.concentrationAdv),
      // Tiri contro la morte (giocatori a 0 PF), morte e azioni permesse dal master nonostante le condizioni.
      deathSaves: DnD.condizioni.normalizeDeathSaves(c.deathSaves),
      dead: Boolean(c.dead),
      forceActions: Boolean(c.forceActions),
      // Riposi e risorse: PF temporanei, dadi vita, risorse personalizzate, ultimo riposo lungo (giocatori).
      tempHp: int(c.tempHp, 0, 0, 9999),
      hitDice: DnD.riposi.normalizeHitDice(c.hitDice, c),
      resources: arr(c.resources).slice(0, 30).map(DnD.riposi.normalizeResource),
      lastLongRest: c.lastLongRest === null || c.lastLongRest === undefined ? null : int(c.lastLongRest, null, -1e9, 1e9),
      movement: DnD.movimento.normalizeMovement(c.movement),
      ignoreSpeed: Boolean(c.ignoreSpeed),
      icon: DnD.icone.normalizeIcon(c.icon, false),
      pos: pos(c.pos),
      weapons: arr(c.weapons).slice(0, 50).map(normalizeWeapon),
      spellcasting: normalizeCombatantSpells(c.spellcasting),
      // Difese ai danni (per ogni combattente: razza, creatura o modifica a mano).
      defenses: { vuln: defenseList(def.vuln), res: defenseList(def.res), imm: defenseList(def.imm) },
      creature: normalizeCombatCreature(c.creature),
      // Boss: fase raggiunta, tema, aura e visibilità per i giocatori (vedi boss.js).
      boss: DnD.boss.normalizeCombatBoss(c.boss),
      // Leggendari: trasformazioni disponibili, usi e forma attiva (con lo stato precedente per il ritorno).
      legend: normalizeCombatLegend(c.legend),
      // Combattimento simulato: chi lo controlla (persona o IA), fazione, comportamento e dati per i punteggi.
      control: DnD.iaDati.CONTROLS.includes(c.control) ? c.control : DnD.ia.defaultControl(c.kind === 'player' ? 'player' : 'npc'),
      // Fazione del Mondo (fazioni.js): qualsiasi fazione; le tre predefinite sono quelle di prima.
      faction: refId(c.faction) || DnD.ia.defaultFaction(c.kind === 'player' ? 'player' : 'npc'),
      // Ostilità personali (NPC provocati): fazioni o combattenti verso cui è ostile.
      hostileTo: [...new Set(arr(c.hostileTo).filter((x) => typeof x === 'string' && REF.test(x)))].slice(0, 20),
      // NPC del Mondo: modello, copia sulla griglia, regole del combattente neutrale e atteggiamento.
      npc: c.npc && typeof c.npc === 'object' ? normalizeCombatNpc(c.npc) : null,
      // Entra nell'ordine di iniziativa solo da questo round (NPC diventati ostili), o è fuggito.
      joinRound: int(c.joinRound, 0, 0, 100000),
      prevFaction: refId(c.prevFaction),
      fled: Boolean(c.fled),
      behavior: DnD.ia.normalizeBehavior(c.behavior),
      abilities: Object.fromEntries(AB().map((ab) => [ab, int(obj(c.abilities)[ab], 10, 1, 30)])),
      classId: str(c.classId, 40),
      level: int(c.level, 1, 1, 30),
      hidden: Boolean(c.hidden),
      // Visione: sensi in piedi (scurovisione, vista cieca, vista pura, percezione tellurica, raggio massimo) e
      // sorgente di luce portata (torcia, lanterna…), accesa o spenta, con i minuti rimasti.
      senses: DnD.visione.normalizeSenses(c.senses),
      light: DnD.visione.normalizeCarried(c.light),
      // Ultimo tiro salvezza fallito (per la Resistenza leggendaria).
      pendingSave: c.pendingSave && typeof c.pendingSave === 'object' ? {
        full: arr(ps.full).slice(0, 10).map((x) => ({ amount: int(obj(x).amount, 0, 0, 100000), type: str(obj(x).type, 40) })),
        half: Boolean(ps.half), applied: int(ps.applied, 0, 0, 100000), magical: Boolean(ps.magical), text: str(ps.text, 200),
      } : null,
    };
  }

  function normalizeConcentrationUndo(u) {
    if (!u || typeof u !== 'object' || !u.concentration || !refId(u.concentration.spellId)) return null;
    return {
      concentration: { spellId: refId(u.concentration.spellId), name: str(u.concentration.name, 60), round: int(u.concentration.round, 1, 0, 100000) },
      removed: arr(u.removed).slice(0, 50).map((r) => ({ targetId: refId(obj(r).targetId), entry: DnD.condizioni.normalizeEntry(obj(r).entry) })).filter((r) => r.targetId && r.entry),
    };
  }

  function normalizeCombatNpc(n) {
    const M = DnD.mondoDati;
    return {
      npcId: refId(n.npcId), itemId: refId(n.itemId), cityId: refId(n.cityId),
      defend: M.DEFENDS.includes(n.defend) ? n.defend : 'se', provoke: M.PROVOKE_RULES.includes(n.provoke) ? n.provoke : 'solo',
      calmDc: int(n.calmDc, 15, 1, 40), penalty: int(n.penalty, -10, -100, 0),
      attitude: M.ATTITUDES.includes(n.attitude) ? n.attitude : 'indifferente',
      roles: arr(n.roles).filter((r) => M.ROLES.includes(r)),
    };
  }

  function normalizeCombat(c) {
    if (!c || typeof c !== 'object') return null;
    const combatants = arr(c.combatants).slice(0, 200).map(normalizeCombatant);
    if (!combatants.length) return null;
    const grid = obj(c.grid);
    return {
      id: id(c.id),
      phase: c.phase === 'attivo' ? 'attivo' : 'iniziativa',
      round: int(c.round, 1, 1, 100000),
      currentId: combatants.some((x) => x.id === c.currentId) ? c.currentId : null,
      combatants,
      // Movimento libero (scelta del master): nessun limite di velocità per nessuno.
      freeMovement: Boolean(c.freeMovement),
      grid: Object.assign(normalizeGridContent(grid), {
        ignoreCollisions: Boolean(grid.ignoreCollisions),
        sourceGridId: typeof grid.sourceGridId === 'string' ? grid.sourceGridId : null,
      }),
      // Combattimento lanciato da una scena: scena e incontro (per l'esito, il riepilogo e le ricompense).
      scene: DnD.scene.normalizeCombatRef(c.scene),
      log: arr(c.log).slice(-LOG_MAX).map((e) => {
        e = obj(e);
        const out = { round: int(e.round, 0, 0, 100000), type: str(e.type, 20), text: str(e.text, 1000) };
        if (e.why) out.why = str(e.why, 6000); // righe dell'IA: punteggi per "Perché?"
        return out;
      }),
      // Combattimento simulato: interruttore, modalità (passo a passo, automatica, solo suggerimento),
      // ritardo della modalità automatica (secondi) e seed della casualità (turni riproducibili).
      ai: {
        simulated: Boolean(obj(c.ai).simulated),
        mode: DnD.iaDati.MODES.includes(obj(c.ai).mode) ? c.ai.mode : 'passo',
        delay: num(obj(c.ai).delay, 1, 0, 3),
        seed: int(obj(c.ai).seed, 1, 0, 4294967295),
      },
    };
  }

  function normalizeSavedGrid(g) {
    g = obj(g);
    return Object.assign({
      id: id(g.id),
      name: str(g.name, 60) || 'Griglia',
      updatedAt: typeof g.updatedAt === 'string' && !Number.isNaN(Date.parse(g.updatedAt)) ? g.updatedAt : null,
    }, ownership(g), normalizeGridContent(g), {
      positions: arr(g.positions).slice(0, 200).map((p) => {
        p = obj(p);
        const xy = pos(p);
        return xy ? { key: str(p.key, 200), x: xy.x, y: xy.y } : null;
      }).filter(Boolean),
    });
  }

  // Bozza dell'editor griglie: salvata a ogni modifica, diventa una griglia con "Salva".
  function normalizeGridDraft(d) {
    if (!d || typeof d !== 'object') return null;
    return {
      gridId: typeof d.gridId === 'string' ? d.gridId : null,
      name: str(d.name, 60) || 'Nuova griglia',
      dirty: Boolean(d.dirty),
      grid: Object.assign(normalizeGridContent(d.grid), { ignoreCollisions: Boolean(obj(d.grid).ignoreCollisions) }),
    };
  }

  function normalizeSession(se) {
    se = obj(se);
    return {
      id: id(se.id),
      name: str(se.name, 60) || 'Sessione',
      description: str(se.description, 2000),
      notes: str(se.notes, 20000),
      // Note del master (blocco note laterale): pagine con HTML sanificato. Mai nelle griglie salvate.
      pages: DnD.note.normalizePages(se.pages),
      combat: normalizeCombat(se.combat),
      gridDraft: normalizeGridDraft(se.gridDraft),
      // Esplorazione in corso: gruppo, tempo, meteo, scorte, variabili, pila delle mappe, registro.
      exploration: DnD.esplorazione.normalizeState(se.exploration),
      // Mondo: party attivo, matrice simmetrica, soglie, reputazioni personali e registro, diario delle quest.
      world: DnD.fazioni.normalizeWorld(se.world, { diarioQuest: DnD.quest.normalizeJournal }),
      // Orologio dei riposi fuori dall'esplorazione (ore di gioco), per la regola delle 24 ore.
      restClock: int(se.restClock, 0, 0, 1e9),
      // Scena in corso (scene.js), vuota se nessuna.
      currentSceneId: typeof se.currentSceneId === 'string' && /^[\w-]{1,64}$/.test(se.currentSceneId) ? se.currentSceneId : '',
    };
  }

  // Dalla versione 5 i dati sono divisi in sessioni. I dati precedenti (combattimento, bozza,
  // nemici, giocatori e griglie) finiscono tutti nella "Sessione predefinita".
  function normalizeSessions(raw) {
    const seen = new Set();
    let sessions = arr(raw.sessions).map(normalizeSession).filter((x) => !seen.has(x.id) && seen.add(x.id));
    if (!sessions.length) {
      sessions = [Object.assign(DnD.sessioni.newSession(DEFAULT_SESSION_NAME, DnD.dadi.uid()), {
        combat: normalizeCombat(raw.combat),
        gridDraft: normalizeGridDraft(raw.gridDraft),
      })];
    }
    const currentSessionId = sessions.some((x) => x.id === raw.currentSessionId) ? raw.currentSessionId : sessions[0].id;
    return { sessions, currentSessionId };
  }

  // ---------- Migrazione alla versione 8 (sui dati grezzi) ----------
  // Visita ogni griglia dei dati grezzi: salvate, combattimenti e bozze (anche dei formati precedenti).
  function eachRawGrid(raw, cb) {
    const g = (x) => { if (x && typeof x === 'object') cb(x); };
    for (const x of arr(raw.savedGrids)) g(x);
    const session = (se) => { if (se && typeof se === 'object') { if (se.combat) g(se.combat.grid); if (se.gridDraft) g(se.gridDraft.grid); } };
    for (const se of arr(raw.sessions)) session(se);
    session(raw.session);
    if (raw.combat) g(raw.combat.grid);
    if (raw.gridDraft) g(raw.gridDraft.grid);
  }

  // Valore libero di un vecchio oggetto ("50 mo") -> costo { amount, unit }.
  function parseCost(text) {
    const m = /(\d+(?:[.,]\d+)?)\s*(mr|ma|me|mo|mp)\b/i.exec(String(text || ''));
    return m ? { amount: Number(m[1].replace(',', '.')), unit: m[2].toLowerCase() } : null;
  }

  // Versione 8: i nemici esistenti sono "standard"; gli Oggetti diventano voci dell'Attrezzatura (e, se
  // avevano un aspetto da tile o bloccavano, anche un modello di oggetto di mappa); le copie già piazzate
  // sulle griglie diventano "oggetti a terra" con quell'oggetto dentro. Le griglie restano 50×50 senza
  // sfondo (completate dalla normalizzazione). Si aggiungono il catalogo base e le creature d'esempio.
  // Funziona anche sui file di una singola sessione (stessi campi).
  function migrateV8(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 8) return raw;
    for (const n of arr(raw.npcs)) if (n && typeof n === 'object' && !n.type) n.type = 'standard';
    const items = arr(raw.items).filter((x) => x && typeof x === 'object');
    const byId = new Map(items.map((x) => [x.id, x]));
    const tplId = (x) => String(x.id).slice(0, 60) + '-m';
    const migrated = items.map((x) => {
      const cost = parseCost(x.value);
      return {
        id: x.id, name: x.name, category: DnD.attrezzatura.LEGACY_TYPES[x.type] || 'altro',
        description: [x.description, x.value && !cost ? 'Valore: ' + x.value : ''].filter(Boolean).join('\n'), cost: cost || undefined, icon: x.icon,
      };
    });
    const mapTemplates = items.filter((x) => (x.mode === 'tiles' && x.tiles) || x.blocks).map((x) => ({
      id: tplId(x), name: x.name, otype: 'altro', icon: x.icon, mode: x.mode, tiles: x.tiles, blocks: Boolean(x.blocks),
      container: true, state: 'aperto', contents: [{ equipmentId: x.id, qty: Number(x.quantity) || 1 }],
    }));
    const isArchive = raw.kind !== 'sessione';
    if (!Array.isArray(raw.equipment)) raw.equipment = (isArchive ? DnD.attrezzatura.defaults() : []).concat(migrated);
    if (!Array.isArray(raw.mapObjects)) raw.mapObjects = (isArchive ? defaultMapObjects() : []).concat(mapTemplates);
    eachRawGrid(raw, (g) => {
      g.items = arr(g.items).map((p) => {
        if (!p || typeof p !== 'object' || p.otype) return p;
        const src = byId.get(p.sourceId);
        const tpl = src && mapTemplates.find((t) => t.id === tplId(src));
        return Object.assign({}, p, {
          otype: tpl ? 'altro' : 'a-terra', sourceId: tpl ? tpl.id : '', container: true, state: 'aperto',
          contents: src ? [{ equipmentId: src.id, qty: Number(src.quantity) || 1 }] : [],
        });
      });
    });
    delete raw.items;
    if (isArchive) raw.addExampleCreatures = true;
    return raw;
  }

  // Versione 9: arrivano i boss (creature con type 'boss'); nessun dato esistente cambia, gli archivi
  // precedenti ricevono il boss d'esempio (condiviso).
  function migrateV9(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 9) return raw;
    if (raw.kind !== 'sessione') raw.addExampleBoss = true;
    return raw;
  }

  // Versione 10: biomi ed eventi (librerie globali). Le griglie esistenti restano di battaglia (tipo
  // predefinito); gli archivi precedenti ricevono biomi ed eventi d'esempio.
  function migrateV10(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 10) return raw;
    if (raw.kind !== 'sessione') {
      if (!Array.isArray(raw.biomes)) raw.biomes = DnD.biomi.examples();
      if (!Array.isArray(raw.events)) raw.events = DnD.eventi.examples();
    }
    return raw;
  }

  // Versione 11: personaggi leggendari (giocatori con type 'leggendario'; gli esistenti restano standard) e
  // modelli di percorso (libreria globale, con il modello d'esempio negli archivi precedenti).
  function migrateV11(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 11) return raw;
    if (raw.kind !== 'sessione' && !Array.isArray(raw.pathTemplates)) raw.pathTemplates = [DnD.percorso.exampleTemplate()];
    return raw;
  }

  // Versione 12: fazioni, party, città, NPC e quest (per sessione). I combattenti tengono la fazione che avevano
  // (Giocatori, Nemici o Neutrali, ora fazioni del Mondo); i giocatori di ogni sessione entrano nel party
  // predefinito «Gruppo». Funziona anche sui file di una singola sessione; gli archivi ricevono anche gli
  // esempi del Mondo (fazione, città, mercante e quest, condivisi).
  function migrateV12(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 12) return raw;
    raw.addDefaultParties = true;
    if (raw.kind !== 'sessione') raw.addWorldExamples = true;
    return raw;
  }
  // Versione 16: scene e incontri. Le sessioni restano senza scene; gli archivi ricevono gli incontri d'esempio.
  function migrateV16(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 16) return raw;
    if (raw.kind !== 'sessione') raw.addSceneExamples = true;
    return raw;
  }
  // Versione 17: scheda del giocatore. I giocatori ricevono i campi vuoti; gli archivi i background e i talenti d'esempio.
  function migrateV17(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 17) return raw;
    if (raw.kind !== 'sessione') raw.addSheetExamples = true;
    return raw;
  }

  // Versione 18 (luce, visione e nebbia di guerra): solo normalizzazione (nebbia spenta, giorno, nessuna sorgente);
  // gli archivi ricevono gli esempi (Finestra, Grata, Braciere, Lanterna appesa).
  function migrateV18(raw) {
    if (!raw || typeof raw !== 'object' || raw.version >= 18) return raw;
    if (raw.kind !== 'sessione' && typeof raw.version === 'number') raw.addVisionExamples = true;
    return raw;
  }

  // Esempi originali del Mondo (dati/mondo.js), condivisi con tutte le sessioni: { factions, cities, worldNpcs, quests }.
  function defaultWorld(sessionId) {
    const E = DnD.mondoDati.EXAMPLES;
    const own = (x) => Object.assign(JSON.parse(JSON.stringify(x)), { sessionId, shared: true });
    return {
      factions: E.factions.map((f) => DnD.fazioni.normalizeFaction(own(f))),
      cities: E.cities.map((c) => DnD.citta.normalizeCity(own(c))),
      worldNpcs: E.worldNpcs.map((n) => DnD.npc.normalizeNpc(own(n))),
      quests: E.quests.map((q) => DnD.quest.normalizeQuest(own(q))),
    };
  }

  // Party «Gruppo» per ogni sessione che non ne ha, con i giocatori visibili nella sessione.
  function addDefaultParties(st) {
    for (const se of st.sessions) {
      if (st.parties.some((p) => p.sessionId === se.id || p.shared)) continue;
      const members = st.players.filter((p) => p.shared || p.sessionId === se.id).map((p) => p.id);
      const party = DnD.party.defaultParty(se.id, members);
      st.parties.push(party);
      se.world.activePartyId = party.id;
    }
  }

  function normalizeState(raw) {
    // Versioni 6, 7 e 8: immagini "stirate" -> tilemap su tileset, TileSet con sorgenti e livelli generici,
    // poi Attrezzatura, oggetti di mappa e creature (sui dati grezzi, prima di tutto); 9: boss d'esempio;
    // 10: biomi ed eventi.
    raw = migrateV18(migrateV17(migrateV16(migrateV12(migrateV11(migrateV10(migrateV9(migrateV8(DnD.migrazioniTile.migrateRaw(JSON.parse(JSON.stringify(obj(raw))))))))))));
    const { sessions, currentSessionId } = normalizeSessions(raw);
    // Chi non appartiene a una sessione esistente (es. dati precedenti) va nella prima.
    const ids = new Set(sessions.map((x) => x.id));
    const owned = (x) => Object.assign(x, { sessionId: ids.has(x.sessionId) ? x.sessionId : sessions[0].id });
    const npcs = arr(raw.npcs).map((c) => owned(normalizeCreature(c, false)));
    // Dati precedenti alla versione 8: ricevono le creature d'esempio (condivise).
    if (raw.addExampleCreatures) for (const c of defaultCreatures(sessions[0].id)) if (!npcs.some((n) => n.id === c.id)) npcs.push(c);
    if (raw.addExampleBoss) for (const c of defaultCreatures(sessions[0].id)) if (c.type === 'boss' && !npcs.some((n) => n.id === c.id)) npcs.push(c);
    const unique = (list) => list.filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);
    const factions = DnD.fazioni.ensureBuiltins(unique(arr(raw.factions).map((f) => owned(DnD.fazioni.normalizeFaction(f)))), sessions[0].id);
    const out = {
      version: VERSION,
      races: arr(raw.races).map(normalizeRace),
      npcs,
      players: arr(raw.players).map((c) => owned(normalizeCreature(c, true))),
      // I dati della versione 1 non hanno strutture: ricevono quelle di esempio.
      structures: Array.isArray(raw.structures) ? raw.structures.map(normalizeStructure) : defaultStructures(),
      equipment: unique(Array.isArray(raw.equipment) ? raw.equipment.map(normalizeEquipment) : DnD.attrezzatura.defaults()),
      mapObjects: unique(Array.isArray(raw.mapObjects) ? raw.mapObjects.map(normalizeMapObject) : defaultMapObjects()),
      tilesets: arr(raw.tilesets).map(normalizeTileset).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i),
      // I dati precedenti alla versione 4 non hanno incantesimi: ricevono quelli di esempio.
      spells: Array.isArray(raw.spells) ? raw.spells.map(normalizeSpell) : defaultSpells(),
      savedGrids: arr(raw.savedGrids).map((g) => owned(normalizeSavedGrid(g))),
      biomes: unique(arr(raw.biomes).map(DnD.biomi.normalizeBiome)),
      events: unique(arr(raw.events).map(DnD.eventi.normalizeEvent)),
      pathTemplates: unique(arr(raw.pathTemplates).map(DnD.percorso.normalizeTemplate)),
      // Condizioni personalizzate (libreria globale, condizioni.js).
      customConditions: unique(arr(raw.customConditions).map(DnD.condizioni.normalizeCustom)),
      // Difficoltà degli incontri: tabelle personalizzate (regole della casa), soglie dei leggendari, NPC neutrali.
      difficultyRules: DnD.difficolta.normalizeRules(raw.difficultyRules),
      factions,
      parties: unique(arr(raw.parties).map((p) => owned(DnD.party.normalizeParty(p)))),
      cities: unique(arr(raw.cities).map((c) => owned(DnD.citta.normalizeCity(c)))),
      worldNpcs: unique(arr(raw.worldNpcs).map((n) => owned(DnD.npc.normalizeNpc(n)))),
      quests: unique(arr(raw.quests).map((q) => owned(DnD.quest.normalizeQuest(q)))),
      // Scene (per sessione, ordinate) e incontri della libreria (modelli, condivisibili).
      scenes: unique(arr(raw.scenes).map((x) => owned(DnD.scene.normalizeScene(x)))),
      encounters: unique(arr(raw.encounters).map((x) => owned(DnD.scene.normalizeEncounter(x)))),
      backgrounds: unique(arr(raw.backgrounds).map((x) => owned(DnD.scheda.normalizeBackground(x)))),
      feats: unique(arr(raw.feats).map((x) => owned(DnD.scheda.normalizeFeat(x)))),
      sessions,
      currentSessionId,
      diceHistory: arr(raw.diceHistory).slice(0, DICE_HISTORY_MAX).map((h) => {
        h = obj(h);
        return { expr: str(h.expr, 40), rolls: arr(h.rolls).slice(0, 100).map((n) => int(n, 0, 0, 1000)), total: int(h.total, 0, -100000, 100000) };
      }),
    };
    if (raw.addDefaultParties) addDefaultParties(out);
    if (raw.addSheetExamples) {
      for (const b of DnD.scheda.exampleBackgrounds(sessions[0].id)) if (!out.backgrounds.some((x) => x.id === b.id)) out.backgrounds.push(b);
      for (const f of DnD.scheda.exampleFeats(sessions[0].id)) if (!out.feats.some((x) => x.id === f.id)) out.feats.push(f);
    }
    if (raw.addVisionExamples) {
      for (const x of visionStructures()) if (!out.structures.some((e) => e.id === x.id)) out.structures.push(x);
      for (const x of visionMapObjects()) if (!out.mapObjects.some((e) => e.id === x.id)) out.mapObjects.push(x);
    }
    if (raw.addSceneExamples) for (const e of DnD.scene.examples(sessions[0].id)) if (!out.encounters.some((x) => x.id === e.id)) out.encounters.push(e);
    if (raw.addWorldExamples) {
      const ex = defaultWorld(sessions[0].id);
      for (const key of Object.keys(ex)) for (const x of ex[key]) if (!out[key].some((e) => e.id === x.id)) out[key].push(x);
    }
    return out;
  }

  // --- Import / export ---
  // images: { id: dataUrl } delle immagini importate usate (stanno fuori dallo stato, in IndexedDB).
  // extra: altre parti dell'archivio fuori dallo stato (es. suoni: impostazioni e file personalizzati).
  function exportJSON(state, images, extra) {
    return JSON.stringify(Object.assign({ app: DnD.config ? DnD.config.APP_NAME : 'Session Forge', kind: 'archivio', exportedAt: new Date().toISOString() },
      state, { images: images || {} }, extra || {}), null, 2);
  }

  function importJSON(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error('Il file non è un JSON valido.');
    }
    if (DnD.sessioni.isSessionFile(raw)) throw new Error('Il file contiene una singola sessione: importala come sessione.');
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.races) || !Array.isArray(raw.npcs) || !Array.isArray(raw.players)) {
      throw new Error('Il file non contiene un backup di questa app.');
    }
    if (typeof raw.version === 'number' && raw.version > VERSION) {
      throw new Error('Il backup proviene da una versione più recente dell\'app.');
    }
    return normalizeState(raw);
  }

  // Testo salvato -> { state, error, corrupted }
  function parseSaved(text) {
    if (text === null || text === undefined) return { state: emptyState(), error: null };
    try {
      return { state: normalizeState(JSON.parse(text)), error: null };
    } catch (e) {
      return { state: emptyState(), error: 'I dati salvati erano danneggiati e non sono stati caricati.', corrupted: text };
    }
  }

  // --- Persistenza: IndexedDB (spazio ampio, adatto alle immagini), con ripiego su localStorage ---
  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function openIdbBackend() {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    const db = await idbRequest(req);
    const tx = (mode) => db.transaction(DB_STORE, mode).objectStore(DB_STORE);
    return {
      name: 'IndexedDB',
      get: (key) => idbRequest(tx('readonly').get(key)).then((v) => (v === undefined ? null : v)),
      set: (key, value) => new Promise((resolve, reject) => {
        const t = db.transaction(DB_STORE, 'readwrite');
        t.objectStore(DB_STORE).put(value, key);
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error || new Error('Scrittura annullata'));
      }),
      // Svuota tutto il database: stato e immagini.
      clear: () => new Promise((resolve, reject) => {
        const t = db.transaction(DB_STORE, 'readwrite');
        t.objectStore(DB_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(t.error || new Error('Cancellazione annullata'));
      }),
    };
  }

  function localBackend(storage) {
    return {
      name: 'localStorage',
      get: async (key) => storage.getItem(DB_NAME + ':' + key),
      set: async (key, value) => storage.setItem(DB_NAME + ':' + key, value),
      // Solo le chiavi dei dati (stato, immagini e file dei suoni): le impostazioni di visualizzazione restano.
      clear: async () => {
        const keys = [];
        for (let i = 0; i < storage.length; i++) if (storage.key(i).startsWith(DB_NAME + ':')) keys.push(storage.key(i));
        for (const k of keys) if (k === DB_NAME + ':' + DB_KEY || k.startsWith(DB_NAME + ':img:') || k.startsWith(DB_NAME + ':snd:')) storage.removeItem(k);
      },
    };
  }

  // Store unico: ogni modifica passa da update(). Il salvataggio è asincrono ma ordinato:
  // le scritture non si sovrappongono e, se arrivano più modifiche, si salva solo l'ultima.
  // save(), update() e replace() restituiscono una Promise con l'esito reale della scrittura
  // { ok, error, message }: un progetto risulta salvato solo se i dati sono stati davvero scritti.
  // Messaggio chiaro per un salvataggio non riuscito (spazio esaurito o altro).
  function saveErrorMessage(e) {
    const name = e && e.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(e && e.message))) {
      return 'spazio di archiviazione del browser esaurito. Esporta i dati, poi elimina immagini, TileSet o griglie che non usi.';
    }
    return (e && e.message) || 'errore sconosciuto';
  }

  // opts.backend: archivio alternativo { name, get, set, clear } (usato dai test).
  async function openStore(storage, opts) {
    let backend = opts && opts.backend;
    if (!backend) {
      try {
        backend = await openIdbBackend();
      } catch (e) {
        backend = localBackend(storage);
      }
    }
    let text;
    let error = null;
    try {
      text = await backend.get(DB_KEY);
    } catch (e) {
      error = 'Impossibile leggere i dati salvati: ' + e.message;
    }
    let legacy = null;
    if (text === null || text === undefined) {
      try { legacy = storage.getItem(LEGACY_KEY); } catch (e) { /* nessun dato precedente */ }
      text = legacy;
    }
    const loaded = parseSaved(text);
    if (loaded.corrupted) {
      // Conserva una copia dei dati illeggibili invece di sovrascriverli e perderli.
      try { await backend.set(DB_KEY + '-danneggiato', loaded.corrupted); } catch (e) { /* ignora */ }
    }

    let queued = null;
    let writing = null;
    let waiters = [];
    const store = {
      state: loaded.state,
      backend: backend.name,
      // Archivio delle immagini importate: stesso database, chiavi separate dallo stato.
      blobs: { get: (k) => backend.get(k), set: (k, v) => backend.set(k, v) },
      loadError: error || loaded.error,
      onSaveError: null,
      // Dopo ogni modifica (update, replace): la sessione online manda gli aggiornamenti ai giocatori.
      onChange: null,
      lastError: null,
      save() {
        queued = JSON.stringify(store.state);
        if (store.onChange) store.onChange();
        const result = new Promise((resolve) => waiters.push(resolve));
        if (!writing) writing = flush();
        return result;
      },
      update(fn) {
        fn(store.state);
        return store.save();
      },
      replace(state) {
        store.state = state;
        return store.save();
      },
      // Promessa risolta quando tutte le scritture in corso sono terminate.
      saved: () => writing || Promise.resolve(),
      // Cancella tutto (stato e immagini) e riparte da uno stato vuoto.
      async clearAll() {
        await store.saved();
        await backend.clear();
        return store.replace(emptyState());
      },
    };

    async function flush() {
      while (queued !== null) {
        const value = queued;
        const mine = waiters;
        queued = null;
        waiters = [];
        let result;
        try {
          await backend.set(DB_KEY, value);
          store.lastError = null;
          result = { ok: true, error: null, message: '' };
          if (legacy !== null) {
            // Migrazione completata: il vecchio salvataggio in localStorage non serve più.
            try { storage.removeItem(LEGACY_KEY); } catch (e) { /* ignora */ }
            legacy = null;
          }
        } catch (e) {
          store.lastError = e;
          result = { ok: false, error: e, message: saveErrorMessage(e) };
          if (store.onSaveError) store.onSaveError(e);
        }
        for (const resolve of mine) resolve(result);
      }
      writing = null;
    }

    if (legacy !== null && !loaded.corrupted) await store.save();
    return store;
  }

  // Definite in modello.js (base dello stato), qui riesportate.
  const { pushDiceHistory, pushLog } = DnD.modello;

  DnD.dati = {
    VERSION, emptyState, defaultRaces, defaultStructures, defaultSpells, defaultMapObjects, defaultCreatures, makeBonuses,
    normalizeState, normalizeRace, normalizeCreature, normalizeWeapon, normalizeGridSize, normalizeStructure, normalizeEquipment, normalizeMapObject, normalizeSpell,
    normalizePlacedStructure, normalizePlacedItem, normalizeLabel, normalizeZone, normalizeBackground, normalizeGridContent, normalizeSavedGrid, normalizeGridDraft,
    migrateV8, migrateV9, migrateV10, migrateV11, migrateV12, addDefaultParties, defaultWorld, eachRawGrid, parseCost, normalizeCombatant, normalizeCombat,
    normalizeSession, DEFAULT_SESSION_NAME, normalizeTileset, normalizeSource, normalizeTileProps, normalizeTiles,
    exportJSON, importJSON, parseSaved, openStore, saveErrorMessage, pushDiceHistory, pushLog,
  };

  // Le regole con creature annidate (forme leggendarie, NPC, import di personaggi) normalizzano attraverso il modello.
  DnD.modello.registraNormalizzaCreatura(normalizeCreature);
})(globalThis.DnD = globalThis.DnD || {});
