// Normalizzazione delle entità salvate (anche dei file importati): ogni funzione accetta qualsiasi valore e
// restituisce la forma attesa (razze, creature e giocatori, incantesimi, strutture, TileSet e TileMap, griglie,
// combattimenti, sessioni). Livello stato. Espone DnD.normalizza; usa i moduli di regole e del Mondo per le parti
// annidate. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const AB = () => DnD.regole.ABILITIES;
  const DEFAULT_SESSION_NAME = 'Sessione predefinita';
  const G = () => DnD.griglia;
  const { VERSION, LOG_MAX, DICE_HISTORY_MAX } = DnD.modello;

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

  DnD.normalizza = {
    DEFAULT_SESSION_NAME, arr, id, int, makeBonuses, normalizeBackground, normalizeCombat, normalizeCombatant, normalizeCreature, normalizeEquipment, normalizeGridContent, normalizeGridDraft, normalizeGridSize, normalizeLabel, normalizeMapObject, normalizePlacedItem, normalizePlacedStructure, normalizeRace, normalizeSavedGrid, normalizeSession, normalizeSessions, normalizeSource, normalizeSpell, normalizeStructure, normalizeTileProps, normalizeTiles, normalizeTileset, normalizeWeapon, normalizeZone, obj, str,
  };
})(globalThis.DnD = globalThis.DnD || {});
