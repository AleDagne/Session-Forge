// Test automatici della logica pura. Eseguiti da test.html (nessuna libreria esterna).
(function (DnD) {
  'use strict';

  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'atteso ' + e + ', ottenuto ' + a);
  }
  function ok(cond, msg) {
    if (!cond) throw new Error(msg || 'condizione falsa');
  }

  // Generatore deterministico: restituisce i valori indicati, nell'ordine.
  function seq(...values) {
    return (sides) => {
      if (!values.length) throw new Error('sequenza di dadi esaurita');
      const v = values.shift();
      if (v < 1 || v > sides) throw new Error('valore ' + v + ' fuori da d' + sides);
      return v;
    };
  }

  const R = () => DnD.regole;
  const D = () => DnD.dadi;

  // --- Modificatori e bonus razziali ---
  test('modificatore di caratteristica', () => {
    const cases = { 1: -5, 3: -4, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 16: 3, 20: 5, 30: 10 };
    for (const [score, mod] of Object.entries(cases)) eq(R().modifier(Number(score)), mod, 'punteggio ' + score);
  });

  test('formattazione del modificatore', () => {
    eq(R().formatModifier(3), '+3');
    eq(R().formatModifier(0), '+0');
    eq(R().formatModifier(-2), '-2');
  });

  test('bonus razziali applicati solo se spuntati', () => {
    const race = { bonuses: DnD.dati.makeBonuses({ FOR: 2, COS: 1 }) };
    race.bonuses.COS.apply = false;
    const base = { FOR: 15, DES: 12, COS: 14, INT: 8, SAG: 10, CAR: 10 };
    eq(R().finalAbilities(base, race), { FOR: 17, DES: 12, COS: 14, INT: 8, SAG: 10, CAR: 10 });
    eq(R().finalAbilities(base, null), base, 'senza razza');
  });

  // --- Dadi ---
  test('parsing di espressioni di dadi', () => {
    eq(D().parseExpr('3d6+2'), { count: 3, sides: 6, modifier: 2 });
    eq(D().parseExpr(' D20 '), { count: 1, sides: 20, modifier: 0 });
    eq(D().parseExpr('2d4 - 1'), { count: 2, sides: 4, modifier: -1 });
    eq(D().parseExpr('5'), { count: 0, sides: 0, modifier: 5 });
    for (const bad of ['', '3x6', '0d6', 'd1', '101d6', 'd6+', 'abc', '2d6+1d4']) eq(D().parseExpr(bad), null, bad);
  });

  test('tiro di dadi con totale e modificatore', () => {
    const r = D().roll(3, 6, 2, seq(1, 4, 6));
    eq(r.rolls, [1, 4, 6]);
    eq(r.total, 13);
    eq(D().rollExpr('2d8-3', seq(1, 1)).total, -1);
  });

  test('generatore casuale: valori nel range e tutte le facce', () => {
    for (const sides of [4, 6, 8, 10, 12, 20]) {
      const seen = new Set();
      for (let i = 0; i < 4000; i++) {
        const v = D().randomInt(sides);
        ok(Number.isInteger(v) && v >= 1 && v <= sides, 'd' + sides + ' ha dato ' + v);
        seen.add(v);
      }
      eq(seen.size, sides, 'facce uscite su d' + sides);
    }
  });

  test('generatore casuale: distribuzione uniforme (chi quadro su d6)', () => {
    const n = 60000;
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) counts[D().randomInt(6) - 1]++;
    const exp = n / 6;
    const chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    // 5 gradi di libertà: 20.5 corrisponde a p ≈ 0.001
    ok(chi < 20.5, 'chi quadro troppo alto: ' + chi.toFixed(2));
  });

  test('d20 con vantaggio e svantaggio', () => {
    eq(R().rollD20('vantaggio', seq(5, 17)).natural, 17);
    eq(R().rollD20('svantaggio', seq(5, 17)).natural, 5);
    eq(R().rollD20('normale', seq(9)).rolls, [9]);
  });

  // --- Attacco ---
  const atk = (extra) => Object.assign({ toHit: 5, targetAC: 15, damageDice: '1d8', damageBonus: 3, mode: 'normale' }, extra);

  test('attacco che colpisce (totale uguale alla CA)', () => {
    const r = R().resolveAttack(atk(), seq(10, 6));
    ok(r.hit && !r.crit && !r.fumble);
    eq(r.total, 15);
    eq(r.damage, 9);
  });

  test('attacco mancato', () => {
    const r = R().resolveAttack(atk(), seq(9));
    ok(!r.hit);
    eq(r.damage, 0);
  });

  test('20 naturale: critico con dadi raddoppiati anche contro CA altissima', () => {
    const r = R().resolveAttack(atk({ toHit: -5, targetAC: 40, damageDice: '2d6' }), seq(20, 1, 2, 3, 4));
    ok(r.hit && r.crit);
    eq(r.damageRolls, [1, 2, 3, 4]);
    eq(r.damage, 13);
  });

  test('1 naturale: fallimento automatico anche con bonus altissimo', () => {
    const r = R().resolveAttack(atk({ toHit: 30, targetAC: 5 }), seq(1));
    ok(!r.hit && r.fumble);
  });

  test('vantaggio usa il d20 più alto, svantaggio il più basso', () => {
    ok(R().resolveAttack(atk({ mode: 'vantaggio' }), seq(1, 20, 1, 1)).crit);
    ok(R().resolveAttack(atk({ mode: 'svantaggio' }), seq(20, 1)).fumble);
  });

  test('il danno non è mai negativo', () => {
    eq(R().resolveAttack(atk({ damageBonus: -5 }), seq(15, 1)).damage, 0);
  });

  // --- PF ---
  test('cura limitata ai PF massimi', () => {
    eq(R().heal(5, 20, 10), 15);
    eq(R().heal(15, 20, 10), 20);
    eq(R().heal(0, 20, 3), 3);
    eq(R().heal(10, 20, -4), 10, 'cura negativa ignorata');
  });

  test('danno non scende sotto 0', () => {
    eq(R().applyDamage(10, 4), 6);
    eq(R().applyDamage(3, 10), 0);
  });

  test('fasce di colore della barra della vita', () => {
    eq(R().hpLevel(20, 20), 'alto');
    eq(R().hpLevel(11, 20), 'alto');
    eq(R().hpLevel(10, 20), 'medio');
    eq(R().hpLevel(6, 20), 'medio');
    eq(R().hpLevel(5, 20), 'basso');
    eq(R().hpLevel(0, 20), 'basso');
  });

  // --- Turni e combattenti ---
  test('ordine di iniziativa e turni che saltano chi è a terra', () => {
    const order = R().sortByInitiative([
      { id: 'a', name: 'A', initiative: 10, dexMod: 0, hp: 5 },
      { id: 'b', name: 'B', initiative: 18, dexMod: 1, hp: 0 },
      { id: 'c', name: 'C', initiative: 10, dexMod: 3, hp: 5 },
    ]);
    eq(order.map((c) => c.id), ['b', 'c', 'a']);
    eq(R().firstTurn(order), 'c');
    eq(R().nextTurn(order, 'c', 1), { currentId: 'a', round: 1 });
    eq(R().nextTurn(order, 'a', 1), { currentId: 'c', round: 2 });
  });

  test('turno con tutti a terra non cambia nulla', () => {
    const order = [{ id: 'a', hp: 0 }, { id: 'b', hp: 0 }];
    eq(R().nextTurn(order, 'a', 3), { currentId: 'a', round: 3 });
  });

  test('creazione combattenti: copie numerate, PF propri, iniziativa con DES razziale', () => {
    const race = DnD.dati.normalizeRace({ id: 'r1', name: 'Elfo', bonuses: DnD.dati.makeBonuses({ DES: 2 }) });
    const goblin = DnD.dati.normalizeCreature({ id: 'g', name: 'Goblin', raceId: 'r1', maxHp: 7, abilities: { DES: 14 }, weapons: [{ name: 'Scimitarra', damageDice: '1d6' }] });
    const eroe = DnD.dati.normalizeCreature({ id: 'p', name: 'Eroe', maxHp: 20, abilities: { DES: 10 } }, true);
    const list = DnD.combattenti.createCombatants([eroe], [{ npc: goblin, quantity: 3 }], [race], seq(10, 5, 6, 7));
    eq(list.map((c) => c.name), ['Eroe', 'Goblin 1', 'Goblin 2', 'Goblin 3']);
    eq(list.map((c) => c.initiative), [10, 8, 9, 10]);
    list[1].hp = 1;
    list[1].weapons[0].name = 'Rotta';
    eq(list[2].hp, 7, 'PF indipendenti');
    eq(list[2].weapons[0].name, 'Scimitarra', 'armi indipendenti');
    eq(goblin.weapons[0].name, 'Scimitarra', 'modello originale intatto');
    eq(DnD.combattenti.createCombatants([], [{ npc: goblin, quantity: 1 }], [], seq(1))[0].name, 'Goblin');
  });

  // --- Validazione ---
  test('validazione creatura con messaggi in italiano', () => {
    const c = DnD.dati.normalizeCreature({ name: 'Orco', maxHp: 15, ac: 13 });
    c.weapons = [{ name: 'Ascia', toHit: 5, damageDice: '1d12', damageBonus: 3, damageType: '' }];
    eq(DnD.validazione.validateCreature(c, {}), {});
    c.name = ' ';
    c.level = 0;
    c.abilities.FOR = 31;
    c.weapons[0].damageDice = '1d12+3';
    const e = DnD.validazione.validateCreature(c, { playerName: true });
    eq(Object.keys(e).sort(), ['abilities.FOR', 'level', 'name', 'playerName', 'weapons.0.damageDice']);
    eq(e.name, 'Il nome è obbligatorio.');
  });

  test('validazione razza', () => {
    const r = DnD.dati.normalizeRace({ name: 'Gnomo', size: 'Piccola', speed: 7.5 });
    eq(DnD.validazione.validateRace(r), {});
    r.bonuses.INT.value = 1.5;
    r.speed = NaN;
    eq(Object.keys(DnD.validazione.validateRace(r)).sort(), ['bonuses.INT', 'speed']);
  });

  // --- Dati ---
  test('import: rifiuta file non validi e normalizza quelli validi', () => {
    let msg = '';
    try { DnD.dati.importJSON('{non json'); } catch (e) { msg = e.message; }
    eq(msg, 'Il file non è un JSON valido.');
    try { DnD.dati.importJSON('{"foo":1}'); } catch (e) { msg = e.message; }
    eq(msg, 'Il file non contiene un backup di questa app.');
    const s = DnD.dati.importJSON(JSON.stringify({
      races: [], players: [], npcs: [{ name: 'X', maxHp: '12', abilities: { FOR: 99 }, weapons: [{ damageDice: 'boh' }] }],
    }));
    eq(s.npcs[0].maxHp, 12);
    eq(s.npcs[0].abilities.FOR, 30);
    eq(s.npcs[0].weapons[0].damageDice, '1d4');
    eq(DnD.sessioni.current(s).combat, null);
  });

  test('export e re-import conservano i dati', () => {
    const s = DnD.dati.emptyState();
    s.npcs.push(Object.assign(DnD.dati.normalizeCreature({ name: 'Goblin', maxHp: 7 }), { sessionId: s.currentSessionId }));
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(s));
    eq(back.races, s.races);
    eq(back.npcs, s.npcs);
  });

  test('razze di esempio presenti', () => {
    eq(DnD.dati.defaultRaces().map((r) => r.name), ['Umano', 'Elfo', 'Nano', 'Halfling', 'Orco']);
  });

  // --- Griglia ---
  const G = () => DnD.griglia;
  const rows = (s) => s.cells.match(new RegExp('.{' + s.w + '}', 'g'));

  test('etichette delle colonne A–AX', () => {
    eq([0, 25, 26, 49].map(G().colLabel), ['A', 'Z', 'AA', 'AX']);
    eq(G().cellLabel(2, 0), 'C1');
  });

  test('forme predefinite', () => {
    eq(rows(G().presetShape('rettangolo', 3, 1)), ['111']);
    eq(rows(G().presetShape('L', 3, 3)), ['100', '100', '111']);
    eq(rows(G().presetShape('T', 3, 3)), ['111', '010', '010']);
    eq(rows(G().presetShape('croce', 3, 3)), ['010', '111', '010']);
    eq(rows(G().presetShape('cerchio', 5, 5))[0], '01110');
    eq(rows(G().presetShape('triangolo', 3, 2)), ['010', '111']);
  });

  test('rotazione di 90° e specchio delle forme', () => {
    const L = G().presetShape('L', 2, 3); // 10 / 10 / 11
    eq(rows(L), ['10', '10', '11']);
    const r = G().rotateShape(L);
    eq([r.w, r.h], [3, 2]);
    eq(rows(r), ['111', '100']);
    eq(rows(G().mirrorShape(L)), ['01', '01', '11']);
    let back = L;
    for (let i = 0; i < 4; i++) back = G().rotateShape(back);
    eq(back, L, 'quattro rotazioni tornano all\'originale');
    eq(G().mirrorShape(G().mirrorShape(L)), L);
  });

  const board = () => ({
    combatants: [
      { id: 'a', size: 1, pos: { x: 0, y: 0 } },
      { id: 'b', size: 2, pos: { x: 5, y: 5 } },
      { id: 'c', size: 1, pos: null },
    ],
    structures: [Object.assign({ id: 's1', x: 10, y: 10 }, G().presetShape('L', 2, 2))], // celle (10,10), (10,11), (11,11)
    ignoreCollisions: false,
  });

  test('collisioni tra pedine', () => {
    const b = board();
    ok(!G().canPlaceToken(b, 'c', 6, 6), 'dentro una pedina 2x2');
    ok(G().canPlaceToken(b, 'a', 4, 4), 'accanto alla 2x2 va bene');
    ok(!G().canPlaceToken(b, 'b', 0, 0), 'la 2x2 coprirebbe la pedina a');
    ok(G().canPlaceToken(b, 'b', 6, 6), 'una pedina può spostarsi sovrapponendosi a se stessa');
    ok(!G().canPlaceToken(b, 'b', 49, 0), 'fuori dalla griglia');
    ok(G().canPlaceToken(b, 'c', 49, 49), 'angolo valido');
  });

  test('collisioni tra pedine e strutture, con "ignora collisioni"', () => {
    const b = board();
    ok(!G().canPlaceToken(b, 'c', 10, 11), 'cella piena della struttura');
    ok(G().canPlaceToken(b, 'c', 11, 10), 'cella vuota della L');
    ok(!G().canPlaceStructure(b, G().squareShape(2), 0, 0), 'struttura sopra una pedina');
    ok(G().canPlaceStructure(b, G().squareShape(2), 11, 10), 'strutture possono toccarsi');
    b.ignoreCollisions = true;
    ok(G().canPlaceToken(b, 'c', 10, 11));
    ok(G().canPlaceStructure(b, G().squareShape(2), 0, 0));
    ok(!G().canPlaceToken(b, 'c', 0, 0), 'le pedine non si sovrappongono mai');
  });

  test('conversione coordinate schermo/cella con zoom e pan', () => {
    const view = { zoom: 2, panX: 100, panY: -50 }; // cella = 64 px
    eq(G().screenToCell(view, 100, -50), { x: 0, y: 0 });
    eq(G().screenToCell(view, 163, 13), { x: 0, y: 0 });
    eq(G().screenToCell(view, 164, 14), { x: 1, y: 1 });
    eq(G().screenToCell(view, 99, 0), { x: -1, y: 0 });
    eq(G().cellToScreen(view, 3, 2), { sx: 292, sy: 78 });
    const z = G().zoomAt(view, 300, 200, 0.5);
    eq(z.zoom, 1);
    eq(G().screenToCell(z, 300, 200), G().screenToCell(view, 300, 200), 'il punto sotto il cursore resta fermo');
    eq(G().zoomAt(view, 0, 0, 100).zoom, G().MAX_ZOOM);
  });

  test('distanza in celle (diagonale = 5 piedi)', () => {
    eq(G().cellDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 4);
    eq(G().cellDistance({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
    eq(G().formatDistance(3), '3 caselle · 15 ft · 4,5 m');
    eq(G().formatSpeed(9), '9 m · 30 ft · 6 caselle');
  });

  test('annulla/ripeti con limite', () => {
    const h = G().createHistory(2);
    h.push(1); h.push(2); h.push(3);
    eq(h.undo(4), 3);
    eq(h.undo(3), 2);
    eq(h.undo(2), null, 'limite di 2 stati');
    eq(h.redo(2), 3);
    h.push(9);
    ok(!h.canRedo(), 'una nuova azione cancella il ripeti');
  });

  test('salvataggio e caricamento di una griglia', () => {
    const goblin = DnD.dati.normalizeCreature({ id: 'g', name: 'Goblin', maxHp: 7 });
    const eroe = DnD.dati.normalizeCreature({ id: 'p', name: 'Eroe', maxHp: 20 }, true);
    const mk = (players, qty) => ({
      combatants: DnD.combattenti.createCombatants(players, [{ npc: goblin, quantity: qty }], [], () => 10),
      grid: { structures: [], items: [], labels: [], zones: [], ignoreCollisions: false, sourceGridId: null },
    });
    const c1 = mk([eroe], 2);
    c1.combatants[0].pos = { x: 1, y: 1 };
    c1.combatants[1].pos = { x: 2, y: 2 };
    c1.combatants[2].pos = { x: 3, y: 3 };
    c1.grid.structures.push(DnD.dati.normalizePlacedStructure(Object.assign({ name: 'Muro', x: 8, y: 8, color: '#ffffff' }, G().presetShape('rettangolo', 3, 1))));
    c1.grid.items.push(DnD.dati.normalizePlacedItem({ name: 'Forziere', x: 4, y: 4 }));
    const saved = DnD.dati.normalizeSavedGrid(JSON.parse(JSON.stringify(G().createSavedGrid(c1, 'Cripta del lich', 'x1'))));
    eq(saved.positions.length, 3);

    const c2 = mk([], 3); // nuovo combattimento: nessun Eroe, un Goblin 3 in più
    let n = 0;
    G().applySavedGrid(c2, saved, () => 'id' + (++n));
    eq(c2.combatants.map((c) => c.pos), [{ x: 2, y: 2 }, { x: 3, y: 3 }, null]);
    eq(c2.grid.structures[0].cells, '111');
    eq(c2.grid.structures[0].x, 8);
    eq(c2.grid.items[0].name, 'Forziere');
    ok(c2.grid.structures[0].id !== c1.grid.structures[0].id, 'nuovi id');
  });

  test('icone: colori limitati per le creature e immagini validate', () => {
    const I = DnD.icone;
    eq(I.normalizeIcon(undefined, false), { kind: 'shape', shape: 'cerchio', color: I.CREATURE_COLORS.grigio });
    eq(I.normalizeIcon({ kind: 'shape', shape: 'stella', color: '#123456' }, false).color, I.CREATURE_COLORS.grigio);
    eq(I.normalizeIcon({ kind: 'shape', shape: 'stella', color: '#123456' }, true).color, '#123456');
    eq(I.normalizeIcon({ kind: 'image', image: 'javascript:alert(1)' }, false).kind, 'shape');
    eq(I.normalizeIcon({ kind: 'image', image: 'data:image/png;base64,iVBORw0KGgo=' }, false).kind, 'image');
  });

  test('taglia della pedina dalla razza', () => {
    const big = DnD.dati.normalizeRace({ id: 'r', name: 'Gigante', size: 'Enorme' });
    const ogre = DnD.dati.normalizeCreature({ id: 'o', name: 'Ogre', raceId: 'r' });
    const [c] = DnD.combattenti.createCombatants([], [{ npc: ogre, quantity: 1 }], [big], () => 1);
    eq([c.w, c.h, c.copy, c.pos], [3, 3, 0, null]);
    eq(G().tokenSize('Grande'), 2);
    eq(G().tokenSize('Piccola'), 1);
  });

  test('strutture: validazione e migrazione dei dati della versione 1', () => {
    const s = DnD.dati.normalizeStructure({ name: 'Statua', mode: 'custom', w: 2, h: 2, cells: '0000', color: '#abcdef' });
    eq(s.cells, '1111', 'forma vuota sostituita');
    eq(DnD.validazione.validateStructure(Object.assign({}, s, { cells: '0000' })).cells, 'Riempi almeno una cella.');
    eq(Object.keys(DnD.validazione.validateStructure(Object.assign({}, s, { mode: 'custom', w: 11 }))), ['w']);
    const v1 = DnD.dati.importJSON(JSON.stringify({ version: 1, races: [], npcs: [{ name: 'X' }], players: [] }));
    eq(v1.structures.map((x) => x.name), ['Muro', 'Colonna', 'Albero', 'Tavolo', 'Finestra', 'Grata']);
    eq(v1.npcs[0].icon.shape, 'cerchio');
    eq(v1.savedGrids, []);
  });

  // --- Classi, randomizzazione, PF, CA, tiri salvezza ---
  test('4d6 scartando il più basso (range 3–18)', () => {
    const r = R().roll4d6DropLowest(seq(3, 1, 6, 5));
    eq([r.total, r.dropIndex], [14, 1]);
    eq(R().roll4d6DropLowest(seq(1, 1, 1, 1)).total, 3);
    eq(R().roll4d6DropLowest(seq(6, 6, 6, 6)).total, 18);
    for (let i = 0; i < 2000; i++) {
      const t = R().roll4d6DropLowest(D().randomInt).total;
      ok(t >= 3 && t <= 18, 'fuori range: ' + t);
    }
  });

  test('random a caso: 4d6 per ogni caratteristica, array standard mescolato', () => {
    const rolls = [6, 6, 6, 1, 1, 1, 1, 1, 5, 5, 5, 5, 2, 2, 2, 2, 4, 4, 4, 4, 3, 3, 3, 3];
    const r = R().randomizeAbilities({ mode: 'random', source: '4d6' }, seq(...rolls));
    eq(r.abilities, { FOR: 18, DES: 3, COS: 15, INT: 6, SAG: 12, CAR: 9 });
    eq(r.rolls.FOR.rolls, [6, 6, 6, 1]);
    const s = R().randomizeAbilities({ mode: 'random', source: 'standard' }, D().randomInt);
    eq(Object.values(s.abilities).sort((a, b) => a - b), [8, 10, 12, 13, 14, 15]);
  });

  test('random intelligente: valori più alti alle caratteristiche della classe', () => {
    const C = DnD.classi.CLASSES;
    // Array standard per il Mago: INT 15, COS 14, DES 13; FOR/SAG/CAR ricevono 12/10/8 in ordine casuale.
    const r = R().randomizeAbilities({ mode: 'classe', source: 'standard', priority: C.mago.priority }, D().randomInt);
    eq([r.abilities.INT, r.abilities.COS, r.abilities.DES], [15, 14, 13]);
    eq([r.abilities.FOR, r.abilities.SAG, r.abilities.CAR].sort((a, b) => a - b), [8, 10, 12]);
    // Con il 4d6 i tiri vengono ordinati: il più alto va a CAR per lo Stregone.
    const rolls = [2, 2, 2, 2, 6, 6, 6, 6, 3, 3, 3, 3, 5, 5, 5, 5, 1, 1, 1, 1, 4, 4, 4, 4];
    const s = R().randomizeAbilities({ mode: 'classe', source: '4d6', priority: C.stregone.priority }, seq(...rolls, 1, 1));
    eq([s.abilities.CAR, s.abilities.COS, s.abilities.DES], [18, 15, 12]);
    // Guerriero: la prima priorità è FOR oppure DES.
    for (const [pick, ab] of [[1, 'FOR'], [2, 'DES']]) {
      const g = R().randomizeAbilities({ mode: 'classe', source: 'standard', priority: C.guerriero.priority }, seq(pick, 1, 1, 1, 1));
      eq([g.abilities[ab], g.abilities.COS], [15, 14], 'Guerriero con ' + ab);
    }
  });

  test('PF al livello 1 e ai successivi, anche con COS negativa (minimo 1 per livello)', () => {
    eq(R().computeHp({ level: 1, hitDie: 10, conMod: 2, method: 'tira' }, seq()).total, 12);
    const r = R().computeHp({ level: 4, hitDie: 10, conMod: 2, method: 'tira' }, seq(7, 9, 7));
    eq(r.total, 41);
    eq(r.detail, '10 + 3 tiri 1d10 [7, 9, 7] + 4×COS(+2) = 41');
    // d6 con COS -3: livello 1 = max(1, 3) = 3; tiri 1, 6 -> max(1, -2) = 1 e 3.
    const neg = R().computeHp({ level: 3, hitDie: 6, conMod: -3, method: 'tira' }, seq(1, 6));
    eq(neg.total, 7);
    ok(neg.detail.endsWith('(minimo 1 PF per livello)'));
    eq(R().computeHp({ level: 2, hitDie: 6, conMod: -6, method: 'tira' }, seq(1)).total, 2, 'minimo 1 anche al livello 1');
  });

  test('PF con la media del dado vita', () => {
    eq([6, 8, 10, 12].map(R().hitDieAverage), [4, 5, 6, 7]);
    const r = R().computeHp({ level: 5, hitDie: 8, conMod: 1, method: 'media' }, seq());
    eq(r.total, 9 + 4 * 6);
    eq(r.detail, '8 + 4×5 (media d8) + 5×COS(+1) = 33');
  });

  test('CA: automatica, armatura leggera/media/pesante, scudo e difesa senza armatura', () => {
    const ab = { FOR: 10, DES: 16, COS: 14, INT: 10, SAG: 18, CAR: 8 }; // DES +3, COS +2, SAG +4
    const armor = (type, base, extra) => Object.assign({ type, base, shield: false, unarmored: false }, extra);
    eq(R().computeAc(armor('nessuna', 10), ab, null), { total: 13, detail: '10 + DES(+3) = 13' });
    eq(R().computeAc(armor('leggera', 11), ab, null).total, 14);
    eq(R().computeAc(armor('media', 14), ab, null), { total: 16, detail: 'Armatura media 14 + DES(+3, max +2) = 16' });
    eq(R().computeAc(armor('media', 14), Object.assign({}, ab, { DES: 8 }), null).total, 13, 'DES negativa conta');
    eq(R().computeAc(armor('pesante', 18), ab, null).total, 18);
    eq(R().computeAc(armor('pesante', 16, { shield: true }), ab, null), { total: 18, detail: 'Armatura pesante 16 + Scudo 2 = 18' });
    eq(R().computeAc(armor('nessuna', 10, { unarmored: true }), ab, 'COS').total, 15, 'Barbaro');
    eq(R().computeAc(armor('nessuna', 10, { unarmored: true }), ab, 'SAG').total, 17, 'Monaco');
    eq(R().computeAc(armor('nessuna', 10, { unarmored: true }), ab, null).total, 13, 'senza la capacità di classe');
    eq(R().computeAc(armor('leggera', 11, { unarmored: true }), ab, 'COS').total, 14, 'con armatura non si applica');
  });

  test('bonus competenza per livello', () => {
    eq([1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 30].map(R().proficiencyBonus), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6]);
  });

  test('totale dei tiri salvezza con e senza competenza', () => {
    eq(R().savingThrowTotal(16, true, 3), 6);
    eq(R().savingThrowTotal(16, false, 3), 3);
    eq(R().savingThrowTotal(7, true, 2), 0);
    eq(R().savingThrows({ FOR: 15, DES: 12, COS: 14, INT: 8, SAG: 10, CAR: 10 }, ['FOR', 'COS'], 2),
      { FOR: 4, DES: 1, COS: 4, INT: -1, SAG: 0, CAR: 0 });
    const s = R().rollSave({ bonus: 4, mode: 'vantaggio', dc: 15 }, seq(9, 11));
    eq([s.total, s.success], [15, true]);
    eq(R().rollSave({ bonus: 4, mode: 'normale', dc: null }, seq(3)).success, null);
  });

  test('migrazione della classe in testo libero', () => {
    const known = DnD.dati.normalizeCreature({ name: 'A', cls: ' guerriero ' });
    eq([known.classId, known.notes, known.saves], ['guerriero', '', ['FOR', 'COS']]);
    const custom = DnD.dati.normalizeCreature({ name: 'B', cls: 'Bruto', notes: 'Puzza.' });
    eq([custom.classId, custom.notes], ['personalizzata', 'Puzza.\nClasse originale: Bruto']);
    eq(DnD.dati.normalizeCreature({ name: 'C' }).classId, '');
    eq([known.acMode, known.hpMode], ['manuale', 'manuale'], 'PF e CA esistenti non cambiano');
    const again = DnD.dati.normalizeCreature(JSON.parse(JSON.stringify(custom)));
    eq(again.notes, custom.notes, 'la migrazione non si ripete');
  });

  test('valori derivati e combattenti con CA automatica e tiri salvezza', () => {
    const race = DnD.dati.normalizeRace({ id: 'r', name: 'Nano', bonuses: DnD.dati.makeBonuses({ COS: 2 }) });
    const monk = DnD.dati.normalizeCreature({
      id: 'm', name: 'Monaco', raceId: 'r', classId: 'monaco', level: 5, acMode: 'auto', armor: { type: 'nessuna', unarmored: true },
      abilities: { FOR: 10, DES: 16, COS: 12, INT: 10, SAG: 14, CAR: 8 },
    });
    const st = DnD.combattenti.derivedStats(monk, race);
    eq([st.ac.total, st.profBonus, st.saves], [15, 3, ['FOR', 'DES']]);
    eq(st.saveTotals, { FOR: 3, DES: 6, COS: 2, INT: 0, SAG: 2, CAR: -1 });
    const [c] = DnD.combattenti.createCombatants([monk], [], [race], () => 10);
    eq([c.ac, c.saves.DES], [15, 6]);
    monk.profBonusOverride = 9;
    eq(DnD.combattenti.derivedStats(monk, race).saveTotals.DES, 12, 'bonus competenza sovrascritto');
  });

  test('nome casuale dalla lista, preferendo quelli non usati', () => {
    eq(DnD.nomi.NAMES.length, 70);
    eq(DnD.nomi.pickName(['Ada', 'Bo', 'Cy'], ['ada', 'Cy'], () => 1), 'Bo');
    eq(DnD.nomi.pickName(['Ada', 'Bo'], ['Ada', 'Bo'], () => 2), 'Bo', 'tutti usati: uno qualsiasi');
    eq(DnD.nomi.pickName([], [], () => 1), null);
  });

  // --- Punti caratteristica e magie ---
  const M = () => DnD.magie;

  test('punti caratteristica disponibili per livello', () => {
    eq([1, 3, 4, 7, 8, 12, 16, 19, 20].map(R().asiPointsAvailable), [0, 0, 2, 2, 4, 6, 8, 10, 10]);
    eq(R().asiPointsAssigned({ FOR: 2, DES: 1, COS: 0, INT: 0, SAG: 0, CAR: 1 }), 4);
  });

  test('punti caratteristica e limite di 20', () => {
    const race = { bonuses: DnD.dati.makeBonuses({ FOR: 2 }) };
    const base = { FOR: 17, DES: 14, COS: 20, INT: 10, SAG: 10, CAR: 22 };
    const asi = { FOR: 2, DES: 2, COS: 1, INT: 0, SAG: 0, CAR: 1 };
    eq(R().finalAbilities(base, race, asi, false), { FOR: 20, DES: 16, COS: 20, INT: 10, SAG: 10, CAR: 22 }, 'con limite');
    eq(R().finalAbilities(base, race, asi, true), { FOR: 21, DES: 16, COS: 21, INT: 10, SAG: 10, CAR: 23 }, 'ignora limite');
    eq(R().finalAbilities(base, race), { FOR: 19, DES: 14, COS: 20, INT: 10, SAG: 10, CAR: 22 }, 'senza punti');
  });

  test('bonus di attacco e CD degli incantesimi', () => {
    eq([M().spellAttackBonus(2, 3), M().spellSaveDc(2, 3)], [5, 13]);
    eq([M().spellAttackBonus(6, 5), M().spellSaveDc(6, 5)], [11, 19]);
    const mage = DnD.dati.normalizeCreature({ name: 'Mira', classId: 'mago', level: 5, abilities: { INT: 16 }, asi: { INT: 2 } });
    const s = DnD.combattenti.derivedStats(mage, null).spell;
    eq([s.ability, s.mod, s.attack, s.dc], ['INT', 4, 7, 15]);
    mage.spellcasting.dcOverride = 17;
    mage.spellcasting.ability = 'CAR';
    eq([DnD.combattenti.derivedStats(mage, null).spell.dc, DnD.combattenti.derivedStats(mage, null).spell.attack], [17, 3], 'sovrascritture');
    eq(DnD.combattenti.derivedStats(DnD.dati.normalizeCreature({ name: 'G', classId: 'guerriero' }), null).spell, null, 'non incantatore');
  });

  test('slot per classe e livello (completo, mezzo, patto)', () => {
    const T = DnD.classi.slotTable;
    eq(T('completo', 1), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
    eq(T('completo', 5), [4, 3, 2, 0, 0, 0, 0, 0, 0]);
    eq(T('completo', 18), [4, 3, 3, 3, 3, 1, 1, 1, 1]);
    eq(T('completo', 20), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
    eq(T('mezzo', 1), [0, 0, 0, 0, 0, 0, 0, 0, 0], 'Paladino di livello 1 senza slot');
    eq(T('mezzo', 2), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
    eq(T('mezzo', 9), [4, 3, 2, 0, 0, 0, 0, 0, 0]);
    eq(T('mezzo', 20), [4, 3, 3, 3, 2, 0, 0, 0, 0]);
    eq(T('patto', 1), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
    eq(T('patto', 4), [0, 2, 0, 0, 0, 0, 0, 0, 0]);
    eq(T('patto', 11), [0, 0, 0, 0, 3, 0, 0, 0, 0]);
    eq(T('patto', 20), [0, 0, 0, 0, 4, 0, 0, 0, 0]);
    const pal = DnD.dati.normalizeCreature({ name: 'P', classId: 'paladino', level: 1 });
    eq(DnD.combattenti.derivedStats(pal, null).spell.slotsTotal.reduce((a, b) => a + b), 0);
  });

  test('consumo e ripristino degli slot', () => {
    const total = [2, 1, 0, 0, 0, 0, 0, 0, 0];
    let used = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    used = M().consumeSlot(used, total, 1);
    used = M().consumeSlot(used, total, 2);
    eq(used.slice(0, 2), [1, 1]);
    let msg = '';
    try { M().consumeSlot(used, total, 2); } catch (e) { msg = e.message; }
    eq(msg, 'Nessuno slot di 2° livello disponibile.');
    eq(M().castableLevels({ level: 1 }, total, used), [1]);
    eq(M().castableLevels({ level: 0 }, total, used), [], 'i trucchetti non usano slot');
    eq(M().shortRest(used, false), used, 'il riposo breve non ripristina gli slot normali');
    eq(M().shortRest(used, true).slice(0, 2), [0, 0], 'il riposo breve ripristina la magia del patto');
    eq(M().longRest(used).slice(0, 2), [0, 0]);
  });

  const spell = (extra) => DnD.dati.normalizeSpell(Object.assign({ name: 'X', level: 3, effect: {} }, extra));

  test('lancio con slot superiore', () => {
    const fireball = spell({ effect: { type: 'salvezza', dice: '8d6', upcastDice: '1d6' } });
    eq(M().scaledDice(fireball, 3), { count: 8, sides: 6, modifier: 0 });
    eq(M().scaledDice(fireball, 5), { count: 10, sides: 6, modifier: 0 });
    const missile = spell({ level: 1, effect: { type: 'nessuno', dice: '3d4+3', upcastDice: '1d4+1' } });
    eq(M().scaledDice(missile, 3), { count: 5, sides: 4, modifier: 5 });
    const r = M().resolveSpell({ spell: missile, slotLevel: 2, caster: { mod: 3 }, targets: [{ id: 'a' }] }, seq(1, 2, 3, 4));
    eq([r.roll.total, r.targets[0].amount], [14, 14]);
  });

  test('incantesimo con tiro salvezza: danno pieno e dimezzato', () => {
    const fireball = spell({ effect: { type: 'salvezza', dice: '2d6', saveAbility: 'DES', halfOnSave: true } });
    const targets = [{ id: 'a', saves: { DES: 2 } }, { id: 'b', saves: { DES: 5 } }];
    // Danni 5+6 = 11 (un solo tiro per tutti); a: 9+2 = 11 < 15 fallisce; b: 12+5 = 17 riesce -> 5.
    const r = M().resolveSpell({ spell: fireball, slotLevel: 3, caster: { dc: 15 }, targets }, seq(5, 6, 9, 12));
    eq(r.targets.map((t) => [t.saveTotal, t.success, t.amount]), [[11, false, 11], [17, true, 5]]);
    fireball.effect.halfOnSave = false;
    eq(M().resolveSpell({ spell: fireball, slotLevel: 3, caster: { dc: 15 }, targets: [targets[1]] }, seq(5, 6, 12)).targets[0].amount, 0, 'nessun danno se riesce');
  });

  test('incantesimo di attacco (critico, 1 naturale) e cura con modificatore', () => {
    const bolt = spell({ level: 0, effect: { type: 'attacco', dice: '1d10' } });
    const caster = { attack: 5, dc: 13, mod: 3 };
    const crit = M().resolveSpell({ spell: bolt, slotLevel: 0, caster, targets: [{ id: 'a', ac: 30 }], mode: 'normale' }, seq(20, 4, 7));
    eq([crit.targets[0].hit, crit.targets[0].crit, crit.targets[0].amount], [true, true, 11]);
    const miss = M().resolveSpell({ spell: bolt, slotLevel: 0, caster, targets: [{ id: 'a', ac: 2 }], mode: 'normale' }, seq(1));
    eq([miss.targets[0].hit, miss.targets[0].fumble], [false, true]);
    const cure = spell({ level: 1, effect: { type: 'cura', dice: '1d8', upcastDice: '1d8', addMod: true } });
    eq(M().resolveSpell({ spell: cure, slotLevel: 2, caster, targets: [{ id: 'a' }, { id: 'b' }] }, seq(3, 5)).targets.map((t) => t.amount), [11, 11]);
  });

  test('copia della griglia in combattimento non modifica l\'originale', () => {
    const saved = DnD.dati.normalizeSavedGrid({
      id: 'g1', name: 'Cripta',
      structures: [Object.assign({ name: 'Muro', x: 5, y: 5, sourceId: 's' }, G().presetShape('rettangolo', 3, 1))],
      items: [{ name: 'Forziere', x: 1, y: 1 }], labels: [{ text: 'Trappola', x: 2, y: 2 }],
    });
    const before = JSON.stringify(saved);
    const combat = { combatants: [], grid: { structures: [], items: [], labels: [], zones: [], ignoreCollisions: false } };
    G().applySavedGrid(combat, saved, DnD.dadi.uid);
    combat.grid.structures[0].x = 20;
    combat.grid.items.pop();
    combat.grid.labels[0].text = 'Cambiato';
    eq(JSON.stringify(saved), before);
    eq(combat.grid.sourceGridId, 'g1');
  });

  test('zone di partenza: disposizione automatica', () => {
    const p = DnD.dati.normalizeCreature({ id: 'p', name: 'Eroe' }, true);
    const big = DnD.dati.normalizeRace({ id: 'r', name: 'Grande', size: 'Grande' });
    const g = DnD.dati.normalizeCreature({ id: 'g', name: 'Ogre', raceId: 'r' });
    const combat = {
      combatants: DnD.combattenti.createCombatants([p, p], [{ npc: g, quantity: 2 }], [big], () => 1),
      grid: { structures: [], items: [], labels: [], zones: [], ignoreCollisions: false },
    };
    const saved = DnD.dati.normalizeSavedGrid({
      id: 'z', zones: [{ kind: 'giocatori', x: 0, y: 0, w: 1, h: 3 }, { kind: 'nemici', x: 10, y: 10, w: 3, h: 2 }],
      structures: [Object.assign({ x: 0, y: 1 }, G().squareShape(1))],
    });
    G().applySavedGrid(combat, saved, DnD.dadi.uid);
    eq(combat.combatants.map((c) => c.pos), [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 10, y: 10 }, null], 'struttura saltata, ogre senza spazio fuori');
  });

  test('migrazione alla versione 4', () => {
    const s = DnD.dati.importJSON(JSON.stringify({ version: 3, races: [], players: [], npcs: [{ name: 'N', classId: 'mago' }], savedGrids: [{ name: 'Vecchia', structures: [] }] }));
    eq(s.spells.map((x) => x.name), ['Dardo di fuoco', 'Dardo incantato', 'Palla di fuoco', 'Cura ferite', 'Parola di guarigione']);
    eq(s.npcs[0].asi, { FOR: 0, DES: 0, COS: 0, INT: 0, SAG: 0, CAR: 0 });
    eq([s.npcs[0].ignoreCap, s.npcs[0].spellcasting.known, s.npcs[0].spellcasting.slotsUsed.length], [false, [], 9]);
    eq([s.savedGrids[0].labels, s.savedGrids[0].zones, s.savedGrids[0].updatedAt], [[], [], null]);
    eq(DnD.sessioni.current(s).gridDraft, null);
  });

  // --- Menù, impostazioni e sessioni ---
  const S = () => DnD.sessioni;
  const fakeStorage = () => {
    const data = {};
    return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
  };

  test('ordine e gruppi delle voci di menù', () => {
    eq(DnD.config.MENU.map((m) => m.label), ['Scene', 'Editor griglie', 'Combattimento', 'Esplorazione', 'Mondo', 'Nemici', 'Giocatori', 'Magie', 'Asset', 'Razze', 'Dadi']);
    eq(DnD.config.MENU.map((m) => m.id), ['scene', 'editor', 'combattimento', 'esplorazione', 'mondo', 'nemici', 'giocatori', 'magie', 'asset', 'razze', 'dadi'], 'Scene in cima, Esplorazione dopo Combattimento, Mondo dopo Esplorazione');
    eq(DnD.config.MENU.map((m) => m.group), ['gioco', 'mappa', 'mappa', 'mappa', 'mappa', 'personaggi', 'personaggi', 'libreria', 'libreria', 'libreria', 'strumenti']);
    eq(DnD.config.MENU.length, 11, 'scorciatoie Alt+S, Alt+1…Alt+9 e Alt+0');
    eq(DnD.config.MENU.map((m) => m.key).join(''), 'S1230456789', 'scorciatoie fisse: Scene Alt+S, Mondo Alt+0, le altre come prima');
    ok(DnD.config.MENU.every((m) => m.icon.length > 0), 'ogni voce ha un\'icona');
    ok(!DnD.config.SECTIONS.includes('oggetti'), 'gli Oggetti sono dentro Strutture');
    eq(DnD.config.APP_NAME, 'Session Forge');
  });

  test('salvataggio e ripristino di tema e dimensione del testo', () => {
    const I = DnD.impostazioni;
    const st = fakeStorage();
    eq(I.load(st), Object.assign({}, I.DEFAULTS), 'primo avvio');
    eq([I.DEFAULTS.theme, I.DEFAULTS.reduceMotion, I.DEFAULTS.bossEffects, I.DEFAULTS.diagonals], ['auto', false, true, 'sempre1'], 'predefiniti: diagonali come prima');
    ok(!('diceSound' in I.DEFAULTS), 'i suoni hanno impostazioni proprie (audio.js)');
    eq([I.resolveTheme('auto', true), I.resolveTheme('auto', false)], ['dark', 'light'], 'auto segue il sistema');
    ok(I.save(st, { theme: 'chiaro', textSize: 'grande', reduceMotion: true }));
    eq(I.load(st), Object.assign({}, I.DEFAULTS, { theme: 'chiaro', textSize: 'grande', reduceMotion: true }));
    eq(I.resolveTheme(I.load(st).theme, true), 'light', 'la scelta salvata ha la precedenza sul sistema');
    st.setItem(I.KEY, '{"theme":"viola","textSize":7}');
    eq(I.load(st), Object.assign({}, I.DEFAULTS), 'valori non validi');
    st.setItem(I.KEY, '{rotto');
    eq(I.load(st).theme, 'auto', 'JSON danneggiato');
    const root = { dataset: {} };
    eq(I.apply(root, { theme: 'scuro', textSize: 'piccolo', reduceMotion: true }, false), 'dark');
    eq(root.dataset, { theme: 'dark', textSize: 'piccolo', reduceMotion: '' });
    I.apply(root, { theme: 'scuro', bossEffects: false }, false);
    eq(root.dataset.bossEffects, 'off', 'effetti boss disattivati');
    I.apply(root, { theme: 'scuro' }, false);
    ok(!('bossEffects' in root.dataset), 'effetti boss attivi di base');
  });

  test('migrazione dei dati esistenti nella sessione predefinita', () => {
    const goblin = DnD.dati.normalizeCreature({ id: 'g', name: 'Goblin' });
    const grid = DnD.dati.normalizeSavedGrid({ id: 'gr', name: 'Cripta' });
    const combat = { id: 'c', combatants: [{ id: 'x', name: 'Goblin', sourceId: 'g', maxHp: 7 }], log: [{ text: 'Inizio' }] };
    const s = DnD.dati.importJSON(JSON.stringify({ version: 4, races: [], players: [], npcs: [goblin], savedGrids: [grid], combat, gridDraft: { name: 'Bozza' } }));
    eq(s.sessions.length, 1);
    const def = S().current(s);
    eq(def.name, 'Sessione predefinita');
    eq([s.npcs[0].sessionId, s.savedGrids[0].sessionId], [def.id, def.id]);
    eq([def.combat.combatants[0].name, def.combat.log[0].text, def.gridDraft.name], ['Goblin', 'Inizio', 'Bozza']);
    ok(!('combat' in s) && !('gridDraft' in s), 'niente più combattimento globale');
  });

  test('sessioni: creazione, duplicazione ed eliminazione', () => {
    const s = DnD.dati.emptyState();
    s.npcs = []; // senza le creature d'esempio (condivise)
    const first = S().current(s);
    let n = 0;
    const newId = () => 'id' + (++n);
    s.npcs.push(Object.assign(DnD.dati.normalizeCreature({ id: 'gob', name: 'Goblin' }), { sessionId: first.id }));
    s.npcs.push(Object.assign(DnD.dati.normalizeCreature({ id: 'drago', name: 'Drago' }), { sessionId: first.id, shared: true }));
    s.savedGrids.push(Object.assign(DnD.dati.normalizeSavedGrid({ id: 'gr', name: 'Cripta' }), { sessionId: first.id }));
    first.combat = { id: 'c1', combatants: [{ id: 'x', sourceId: 'gob' }], grid: { sourceGridId: 'gr' } };
    const nuova = S().addSession(s, 'Taverna', newId);
    eq([s.sessions.length, s.currentSessionId, nuova.combat], [2, nuova.id, null]);
    eq(S().visible(s, 'npcs').map((x) => x.name), ['Drago'], 'la nuova sessione vede solo i condivisi');
    const dup = S().duplicateSession(s, first.id, 'Copia', newId);
    eq(s.npcs.length, 3, 'copiato solo il Goblin, non il Drago condiviso');
    const gobCopy = s.npcs.find((x) => x.sessionId === dup.id);
    eq(dup.combat.combatants[0].sourceId, gobCopy.id, 'riferimenti del combattimento aggiornati');
    eq(dup.combat.grid.sourceGridId, s.savedGrids.find((g) => g.sessionId === dup.id).id);
    eq(first.combat.combatants[0].sourceId, 'gob', 'originale invariato');
    S().deleteSession(s, dup.id);
    eq([s.sessions.length, s.npcs.length, s.savedGrids.length], [2, 2, 1]);
    S().deleteSession(s, nuova.id);
    let msg = '';
    try { S().deleteSession(s, first.id); } catch (e) { msg = e.message; }
    eq(msg, 'Deve restare almeno una sessione.');
    eq(S().addSession(s, 'Sessione predefinita', newId).name, 'Sessione predefinita (2)', 'nomi unici');
  });

  test('visibilità dei dati condivisi tra sessioni', () => {
    const s = DnD.dati.emptyState();
    const a = S().current(s);
    const b = S().addSession(s, 'B', () => 'b');
    const mk = (id, sessionId, shared) => Object.assign(DnD.dati.normalizeCreature({ id, name: id }, true), { sessionId, shared });
    s.players.push(mk('solo-a', a.id, false), mk('solo-b', b.id, false), mk('tutti', a.id, true));
    eq(S().visible(s, 'players', a.id).map((x) => x.id), ['solo-a', 'tutti']);
    eq(S().visible(s, 'players', b.id).map((x) => x.id), ['solo-b', 'tutti']);
    S().deleteSession(s, a.id);
    eq(s.players.map((x) => [x.id, x.sessionId]), [['solo-b', b.id], ['tutti', b.id]], 'il condiviso sopravvive alla sua sessione');
  });

  test('esportazione e importazione di una singola sessione', () => {
    const src = DnD.dati.emptyState();
    src.npcs = [];
    const sess = S().current(src);
    sess.name = 'Cripta del lich';
    sess.notes = 'Il lich è nella stanza 3.';
    const spell = src.spells[0];
    const elfo = src.races[1];
    src.npcs.push(Object.assign(DnD.dati.normalizeCreature({ id: 'lich', name: 'Lich', raceId: elfo.id, classId: 'mago', spellcasting: { known: [spell.id] } }), { sessionId: sess.id }));
    src.savedGrids.push(Object.assign(DnD.dati.normalizeSavedGrid({
      id: 'g', name: 'Cripta', structures: [Object.assign({ sourceId: src.structures[0].id, x: 1, y: 1 }, G().squareShape(1))],
    }), { sessionId: sess.id }));
    sess.combat = DnD.dati.normalizeSession({ combat: { combatants: [{ name: 'Lich', sourceId: 'lich', maxHp: 99 }], grid: { sourceGridId: 'g' } } }).combat;
    const file = JSON.parse(JSON.stringify(S().exportSession(src, sess.id)));
    eq([file.kind, file.npcs.length, file.savedGrids.length, file.races.map((r) => r.id), file.spells.map((x) => x.id), file.structures.length],
      ['sessione', 1, 1, [elfo.id], [spell.id], 1]);

    // Importazione in un archivio diverso, che ha già una sessione con lo stesso nome.
    const dst = DnD.dati.emptyState();
    S().current(dst).name = 'Cripta del lich';
    dst.races = [];
    let n = 0;
    const imported = S().importSession(dst, file, () => 'nuovo' + (++n));
    eq([dst.sessions.length, dst.currentSessionId, imported.name, imported.notes], [2, imported.id, 'Cripta del lich (2)', 'Il lich è nella stanza 3.']);
    const lich = dst.npcs.find((x) => x.name === 'Lich');
    eq([lich.sessionId, lich.raceId, dst.races.length], [imported.id, elfo.id, 1], 'razza aggiunta alla libreria');
    eq(imported.combat.combatants[0].sourceId, lich.id, 'combattimento collegato al nemico importato');
    eq(imported.combat.grid.sourceGridId, dst.savedGrids[0].id);
    eq(dst.spells.filter((x) => x.id === spell.id).length, 1, 'incantesimo già presente non duplicato');
    let msg = '';
    try { S().importSession(dst, { kind: 'archivio' }, () => 'x'); } catch (e) { msg = e.message; }
    eq(msg, 'Il file non contiene una sessione.');
    try { DnD.dati.importJSON(JSON.stringify(file)); } catch (e) { msg = e.message; }
    eq(msg, 'Il file contiene una singola sessione: importala come sessione.');
  });

  // --- Generatore di nemici ---
  const GEN = () => DnD.generatore;
  // Generatore pseudo-casuale riproducibile (mulberry32) con interfaccia rng(n) -> [1, n].
  function seeded(seed) {
    let a = seed >>> 0;
    return (n) => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n) + 1;
    };
  }
  const genRace = (bonuses) => DnD.dati.normalizeRace({ id: 'r', name: 'Elfo', bonuses: DnD.dati.makeBonuses(bonuses || {}) });
  const genCtx = (race, spells) => ({ races: race ? [race] : [], spells: spells || [] });
  const gen = (classId, level, extra, ctx, rng) => GEN().generateEnemy(Object.assign({ raceId: 'r', level, classId, abilityMethod: '4d6', hpMethod: 'media', magicItems: false, name: 'Test' }, extra),
    ctx || genCtx(genRace({ FOR: 1, DES: 1, COS: 1, INT: 1, SAG: 1, CAR: 1 })), rng || seeded(level * 31 + classId.length));
  // CA attesa, calcolata qui in modo indipendente dalla tabella dell'equipaggiamento.
  function expectedAc(classId, ab, magic) {
    const eq = DnD.equipaggiamento.EQUIPMENT[classId];
    const m = (x) => Math.floor((ab[x] - 10) / 2);
    const unarmored = DnD.classi.CLASSES[classId].unarmored;
    let ac;
    if (eq.armor.type === 'leggera') ac = eq.armor.base + m('DES');
    else if (eq.armor.type === 'media') ac = eq.armor.base + Math.min(2, m('DES'));
    else if (eq.armor.type === 'pesante') ac = eq.armor.base;
    else ac = 10 + m('DES') + (unarmored ? m(unarmored) : 0);
    return ac + (eq.shield ? 2 : 0) + magic;
  }

  test('generatore: tutte le 12 classi ai livelli 1, 5, 11 e 20', () => {
    for (const classId of DnD.classi.IDS) {
      for (const level of [1, 5, 11, 20]) {
        const where = classId + ' liv. ' + level;
        const { creature: c } = gen(classId, level);
        const stats = DnD.combattenti.derivedStats(c, genRace({ FOR: 1, DES: 1, COS: 1, INT: 1, SAG: 1, CAR: 1 }));
        const ab = stats.abilities;
        ok(Object.values(ab).every((v) => v <= 20), where + ': caratteristica oltre 20 ' + JSON.stringify(ab));
        eq([c.level, c.classId, c.generated, c.origin.classId, c.hpMode, c.acMode, c.saveMode], [level, classId, true, classId, 'auto', 'auto', 'classe'], where);
        // PF con la media: livello 1 = dado massimo + COS, poi media + COS (minimo 1 per livello).
        const hd = DnD.classi.CLASSES[classId].hitDie;
        const con = R().modifier(ab.COS);
        eq(c.maxHp, Math.max(1, hd + con) + (level - 1) * Math.max(1, hd / 2 + 1 + con), where + ' PF');
        eq(c.hpBasis, { level, conMod: con, hitDie: hd }, where + ' base dei PF');
        eq([c.ac, stats.ac.total], [expectedAc(classId, ab, 0), expectedAc(classId, ab, 0)], where + ' CA');
        eq(stats.saves, DnD.classi.CLASSES[classId].saves, where + ' tiri salvezza');
        eq(stats.profBonus, R().proficiencyBonus(level));
        const eqWeapons = DnD.equipaggiamento.EQUIPMENT[classId].weapons;
        c.weapons.forEach((w, i) => {
          const mod = R().modifier(ab[eqWeapons[i].ability]);
          eq([w.name, w.toHit, w.damageBonus], [eqWeapons[i].name, R().proficiencyBonus(level) + mod, mod], where + ' arma ' + w.name);
        });
      }
    }
  });

  test('generatore: CA per ogni armatura, tetto DES della media, scudo e difesa senza armatura', () => {
    const fixed = () => 1; // array standard e assegnazioni deterministiche
    const race = genRace({ DES: 2 });
    const ctx = genCtx(race);
    const g = (classId, level, magicItems) => gen(classId, level, { abilityMethod: 'standard', magicItems }, ctx, fixed).creature;
    const acOf = (c) => DnD.combattenti.derivedStats(c, race);
    // Ranger: DES 15+2 = 17 (+3) ma l'armatura media conta al massimo +2 -> 13 + 2.
    eq(acOf(g('ranger', 1)).ac, { total: 15, detail: 'Armatura media 13 + DES(+3, max +2) = 15' });
    eq(acOf(g('bardo', 1)).ac.detail, 'Armatura leggera 11 + DES(+3) = 14');
    eq(acOf(g('guerriero', 1)).ac.detail, 'Armatura pesante 16 + Scudo 2 = 18');
    const monk = acOf(g('monaco', 1));
    eq(monk.ac.total, 10 + R().modifier(monk.abilities.DES) + R().modifier(monk.abilities.SAG), 'difesa senza armatura del Monaco');
    const barb = acOf(g('barbaro', 1));
    eq(barb.ac.total, 10 + R().modifier(barb.abilities.DES) + R().modifier(barb.abilities.COS), 'difesa senza armatura del Barbaro');
    // Equipaggiamento magico: +1 dal livello 5, +2 dall'11, +3 dal 17, su armi e CA.
    eq([4, 5, 11, 17].map(DnD.equipaggiamento.magicBonus), [0, 1, 2, 3]);
    const plain = g('guerriero', 11, false);
    const magic = g('guerriero', 11, true);
    eq(acOf(magic).ac.total - acOf(plain).ac.total, 2);
    eq([magic.weapons[0].toHit - plain.weapons[0].toHit, magic.weapons[0].damageBonus - plain.weapons[0].damageBonus], [2, 2]);
    ok(acOf(magic).ac.detail.endsWith('Bonus magico 2 = ' + acOf(magic).ac.total));
    eq(g('monaco', 11).weapons[0].damageDice, '1d8', 'dado del colpo senz\'armi');
  });

  test('generatore: punti caratteristica ai livelli multipli di 4', () => {
    const base = { FOR: 8, DES: 13, COS: 14, INT: 15, SAG: 12, CAR: 10 };
    const prio = ['INT', 'COS', 'DES'];
    eq(GEN().distributeAsi(base, null, 3, prio), { FOR: 0, DES: 0, COS: 0, INT: 0, SAG: 0, CAR: 0 });
    eq(GEN().distributeAsi(base, null, 4, prio).INT, 2);
    eq(GEN().distributeAsi(base, null, 12, prio), { FOR: 0, DES: 0, COS: 1, INT: 5, SAG: 0, CAR: 0 }, 'INT fino a 20, poi COS');
    const race = genRace({ INT: 2 });
    eq(GEN().distributeAsi(base, race, 20, prio), { FOR: 0, DES: 1, COS: 6, INT: 3, SAG: 0, CAR: 0 }, 'il bonus razziale conta per il tetto di 20; l\'avanzo va alla terza della classe');
    const strong = { FOR: 20, DES: 20, COS: 20, INT: 20, SAG: 20, CAR: 19 };
    eq(GEN().distributeAsi(strong, null, 20, ['FOR', 'DES']).CAR, 1, 'i punti avanzati vanno alla caratteristica successiva, mai oltre 20');
    eq(R().asiPointsAssigned(gen('mago', 12, { abilityMethod: 'standard' }, genCtx(null), () => 1).creature.asi), 6);
  });

  test('generatore: incantesimi filtrati per classe e livello di slot', () => {
    const sp = (id, level, classes, effect) => DnD.dati.normalizeSpell({ id, name: id, level, classes, effect: effect || {} });
    const dmg = { type: 'attacco', dice: '1d10' };
    const lib = [
      sp('A-trucco', 0, ['mago'], dmg), sp('B-trucco', 0, ['mago']), sp('C-trucco', 0, ['mago'], dmg), sp('D-trucco', 0, ['chierico'], dmg),
      sp('X-1', 1, ['mago'], dmg), sp('Y-1', 1, ['mago']), sp('Z-2', 2, ['mago'], dmg), sp('W-3', 3, ['mago'], dmg),
    ];
    const r = GEN().chooseSpells(lib, 'mago', 'Mago', 3, DnD.classi.slotTable('completo', 3));
    eq(r.known, ['A-trucco', 'C-trucco', 'Z-2', 'X-1', 'Y-1'], 'trucchetti con effetto per primi, niente 3° livello al livello 3, niente Chierico');
    eq(r.warnings.length, 1, 'avviso: 3 incantesimi su 4');
    eq(GEN().chooseSpells(lib, 'mago', 'Mago', 5, DnD.classi.slotTable('completo', 5)).known.slice(3, 4), ['W-3'], 'dal livello 5 il 3° livello per primo (dopo 3 trucchetti)');
    eq(GEN().chooseSpells(lib, 'paladino', 'Paladino', 1, DnD.classi.slotTable('mezzo', 1)), { known: [], warnings: [] }, 'Paladino di livello 1: nessun avviso');
    const empty = gen('mago', 3, {}, genCtx(genRace(), []));
    ok(empty.creature.spellcasting.known.length === 0 && empty.warnings[0].includes('non contiene incantesimi'), 'libreria vuota: avviso');
    const full = gen('mago', 5, {}, genCtx(genRace(), lib)).creature;
    eq(full.spellcasting.known.length, 3 + 4, 'trucchetti (3 dal livello 4) e tutti i 4 incantesimi fino al 3° livello');
    ok(DnD.combattenti.derivedStats(full, genRace()).spell.dc >= 8 + 3, 'CD calcolata');
    eq(gen('guerriero', 5, {}, genCtx(genRace(), lib)).creature.spellcasting.known, [], 'non incantatore');
  });

  test('generatore: più nemici con nomi numerati', () => {
    eq(GEN().numberedNames('Elfo Mago', 1, []), ['Elfo Mago']);
    eq(GEN().numberedNames('Elfo Mago', 1, ['elfo mago']), ['Elfo Mago 2']);
    eq(GEN().numberedNames('Elfo Mago', 3, ['Elfo Mago 2']), ['Elfo Mago 1', 'Elfo Mago 3', 'Elfo Mago 4']);
    const list = GEN().generateEnemies({ raceId: 'r', level: 3, classId: 'mago', quantity: 3 }, genCtx(genRace()), [], seeded(7));
    eq(list.map((x) => x.creature.name), ['Elfo Mago 1', 'Elfo Mago 2', 'Elfo Mago 3']);
    ok(new Set(list.map((x) => JSON.stringify(x.creature.abilities))).size > 1, 'statistiche tirate separatamente');
    ok(new Set(list.map((x) => x.creature.id)).size === 3, 'id distinti');
    eq(GEN().generateEnemies({ raceId: 'r', level: 3, classId: 'mago', name: 'Cultista' }, genCtx(genRace()), ['Cultista'], seeded(1))[0].creature.name, 'Cultista 2');
  });

  test('generatore: "Rigenera" cambia solo i tiri casuali', () => {
    const opts = { raceId: 'r', level: 8, classId: 'guerriero', hpMethod: 'tira' };
    const ctx = genCtx(genRace({ FOR: 2 }));
    const first = GEN().generateEnemies(opts, ctx, [], seeded(1))[0].creature;
    const again = GEN().regenerate(first, opts, ctx, seeded(99)).creature;
    eq([again.id, again.name, again.raceId, again.level, again.classId, again.weapons.map((w) => w.name), again.armor.type],
      [first.id, first.name, first.raceId, first.level, first.classId, first.weapons.map((w) => w.name), first.armor.type]);
    ok(JSON.stringify(again.abilities) !== JSON.stringify(first.abilities) || again.maxHp !== first.maxHp, 'tiri diversi');
  });

  test('generatore: validazione delle opzioni', () => {
    const v = (o) => GEN().validateOptions(Object.assign({ raceId: 'r', level: 5, classId: 'mago', quantity: 1, name: '' }, o));
    eq(v({}), {});
    for (const level of [0, 21, 2.5, NaN]) eq(v({ level }).level, 'Il livello deve essere un numero intero tra 1 e 20.');
    eq(Object.keys(v({ raceId: '', classId: '', quantity: 0 })).sort(), ['classId', 'quantity', 'raceId']);
    const noBonus = gen('mago', 4, {}, genCtx(genRace({})));
    ok(noBonus.creature.maxHp > 0, 'razza senza bonus');
  });

  // --- TileSet, TileMap e collisioni ---
  const IMG = () => DnD.immaginiLib;
  const TS = () => DnD.tileset;
  const TM = () => DnD.tilemap;
  const COL = () => DnD.collisioni;
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==';
  const fakeBackend = () => {
    const data = {};
    return { name: 'test', data, get: async (k) => (k in data ? data[k] : null), set: async (k, v) => { data[k] = v; }, clear: async () => { for (const k of Object.keys(data)) delete data[k]; } };
  };
  const tid = (c, r, s) => TS().tileId(s || 0, c, r);
  // Texture 48×48 con tile da 16: una L opaca (colonna sinistra + riga in basso), il resto trasparente.
  function lAlpha() {
    const a = new Uint8Array(48 * 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) if (x < 16 || y >= 32) a[y * 48 + x] = 255;
    return a;
  }
  // TileSet "Casa": sorgente 0 di 3×3 tile da 16 px. Tile vuote escluse, la L è bloccante.
  function lTileset(extra) {
    const ts = TS().newTileset('ts-casa', 'Casa');
    TS().addSource(ts, { name: 'casa.png', imageId: IMG().imageId(PNG), imageW: 48, imageH: 48 }, { tileW: 16, tileH: 16 });
    const ids = TS().sourceTileIds(ts.sources[0]);
    ids.forEach((id, i) => TS().setTileProps(ts, [id], { excluded: '011011000'[i] === '1', blocking: '100100111'[i] === '1' }));
    return DnD.dati.normalizeTileset(Object.assign(ts, extra));
  }
  const byId = (...list) => Object.fromEntries(list.map((t) => [t.id, t]));
  const tileAt = (t, layer, x, y) => t.layers[layer].data[y * t.w + x];
  const mapWith = (w, h, ts, extra) => Object.assign(TM().newTiles('mappa', w, h), { tilesets: [ts.id] }, extra);

  test('TileSet: taglio con offset, margine e separazione (anche non divisibile e rettangolare)', () => {
    // offset 2, margine 1, separazione 1×2, tile 16×8: inizio a 3 px; 3 colonne (3+16+1+16+1+16 = 53, avanzo 54-1-53 = 0), 3 righe (3+8+2+8+2+8 = 31, avanzo 40-1-31 = 8).
    eq(TS().gridOf(54, 40, { tileW: 16, tileH: 8, offsetX: 2, offsetY: 2, margin: 1, sepX: 1, sepY: 2 }), { cols: 3, rows: 3, restX: 0, restY: 8 });
    const src = DnD.dati.normalizeSource({ id: 0, imageW: 54, imageH: 40, tileW: 16, tileH: 8, offsetX: 2, offsetY: 2, margin: 1, sepX: 1, sepY: 2 });
    eq([src.cols, src.rows], [3, 3]);
    eq(TS().tileRect(src, 0, 0), { sx: 3, sy: 3, sw: 16, sh: 8 });
    eq(TS().tileRect(src, 2, 1), { sx: 37, sy: 13, sw: 16, sh: 8 }, 'colonna 2, riga 1');
    eq(TS().gridOf(100, 70, { tileW: 32, tileH: 32 }), { cols: 3, rows: 2, restX: 4, restY: 6 }, 'non divisibile: il resto si ignora');
    eq(TS().gridOf(10, 10, { tileW: 32, tileH: 32 }).cols, 0, 'tile più grande dell\'immagine');
    eq([TS().proposeTileSize(256, 128), TS().proposeTileSize(48, 48), TS().proposeTileSize(120, 120), TS().proposeTileSize(1000, 37)], [32, 16, 120, 32]);
    const ts = TS().newTileset('t', 'T');
    const whole = TS().addSource(ts, { imageId: null, imageW: 200, imageH: 120 }, TS().wholeImageCut({ imageW: 200, imageH: 120 }));
    eq([whole.cols, whole.rows, TS().tileRect(whole, 0, 0)], [1, 1, { sx: 0, sy: 0, sw: 200, sh: 120 }], 'immagine intera come una tile');
  });

  test('TileSet: id delle tile stabili, più sorgenti, duplicazione ed eliminazione', () => {
    eq(TS().tileCoords(tid(5, 7, 3)), { src: 3, row: 7, col: 5 });
    eq(tid(4, 0), 4, 'prima riga della sorgente 0 = vecchio indice');
    const ts = lTileset();
    const second = TS().addSource(ts, { name: 'alberi', imageId: null, imageW: 64, imageH: 32 }, { tileW: 32, tileH: 32 });
    eq([ts.sources.map((s) => s.id), second.cols, second.rows], [[0, 1], 2, 1]);
    TS().setTileProps(ts, [tid(1, 0, 1)], { name: 'Quercia', blocking: true });
    // La texture si allarga: le tile esistenti mantengono id e proprietà.
    Object.assign(second, { imageW: 128 });
    TS().recut(second);
    eq([second.cols, TS().tileProps(ts, tid(1, 0, 1)).name, TS().resolveTile(ts, tid(3, 0, 1)).rect.sx], [4, 'Quercia', 96]);
    second.name = 'Alberi rinominati';
    eq(TS().tileProps(ts, tid(1, 0, 1)).name, 'Quercia', 'rinominare la sorgente non cambia le tile');
    const copy = TS().duplicateSource(ts, 1);
    eq([copy.id, copy.imageId, TS().tileProps(ts, tid(1, 0, copy.id)).name], [2, second.imageId, 'Quercia']);
    TS().removeSource(ts, 1);
    eq([ts.sources.map((s) => s.id), ts.tiles[tid(1, 0, 1)], TS().resolveTile(ts, tid(1, 0, 1))], [[0, 2], undefined, null]);
    eq(TS().resolveTile(ts, tid(9, 9)), null, 'fuori dalla sorgente');
  });

  test('TileSet: rilevamento delle tile vuote da un\'immagine con trasparenza', () => {
    const alpha = lAlpha();
    const ts = lTileset();
    const src = ts.sources[0];
    eq(TS().detectEmpty(alpha, 48, 48, src), '011011000');
    for (let i = 0; i < 5; i++) alpha[2 * 48 + 40 + i] = 255; // 5 pixel su 256 nella tile (2, 0): 2%
    eq(TS().detectEmpty(alpha, 48, 48, src)[2], '1', 'sotto la soglia del 5%');
    eq(TS().detectEmpty(alpha, 48, 48, src, 0.01)[2], '0', 'soglia regolabile');
    eq(TS().detectEmpty(new Uint8Array(48 * 48), 48, 48, src), '111111111', 'tutta trasparente');
    TS().applyEmpty(ts, src, '100000000');
    eq([TS().isExcluded(ts, tid(0, 0)), TS().isExcluded(ts, tid(1, 0))], [true, false], 'escluse modificabili');
  });

  test('TileSet: proprietà delle tile, validazione e salvataggio compatto', () => {
    const ts = lTileset();
    TS().setTileProps(ts, [tid(0, 2), tid(1, 2)], { tags: ['acqua'], cost: 2, cover: 'mezza', custom: { suono: 'splash' }, navigable: false });
    eq([TS().tileProps(ts, tid(1, 2)).cost, TS().tileProps(ts, tid(1, 2)).custom.suono, TS().tileProps(ts, tid(2, 2)).cost], [2, 'splash', 1]);
    TS().setTileProps(ts, [tid(1, 1)], { excluded: false });
    eq(ts.tiles[tid(1, 1)], undefined, 'valori predefiniti non salvati');
    const bad = DnD.dati.normalizeTileset({ id: 'x', sources: [{ id: 0, imageId: 'javascript:x', tileW: -3, imageW: 32, imageH: 32 }],
      tiles: { 0: { cost: 99, cover: 'boh', tags: 'no', collision: { enabled: true, polygons: [[[0, 0], [2, 0]], [[0, 0], [1, 0], [1, 1]]] }, custom: { '<script>': 1, ok: 3 } }, 999999999: { blocking: true } } });
    eq([bad.sources[0].imageId, bad.sources[0].tileW], [null, 0], 'sorgente non valida corretta');
    eq(bad.tiles[0], { cost: 10, collision: { enabled: true, polygons: [[[0, 0], [1, 0], [1, 1]]] }, custom: { ok: '3' } }, 'proprietà corrette');
    eq(Object.keys(bad.tiles), ['0'], 'tile di sorgenti inesistenti scartate');
    eq(DnD.dati.normalizeTileset(JSON.parse(JSON.stringify(ts))), ts, 'salvataggio e caricamento');
  });

  test('TileSet: orientamenti ammessi', () => {
    const p = Object.assign(TS().defaultProps(), { rotate: false });
    eq([0, 1, 4, 6, 5].map((o) => TS().orientAllowed(p, o)), [true, false, true, true, false]);
    eq([0, 4, 6].map((o) => TS().orientAllowed(Object.assign(TS().defaultProps(), { flip: false }), o)), [true, false, false]);
  });

  test('TileMap: Modalità A (strutture), selezione dei tile di una forma a L', () => {
    const ts = lTileset();
    const selection = TS().detectEmpty(lAlpha(), 48, 48, ts.sources[0]).replace(/[01]/g, (c) => (c === '1' ? '0' : '1'));
    eq(selection, '100100111');
    const t = DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, selection, {}), byId(ts), 'structure');
    eq([t.kind, t.w, t.h, t.mask, t.cells, t.drawAll], ['immagine', 3, 3, '100100111', '100100111', false]);
    eq([tileAt(t, 0, 0, 0), tileAt(t, 0, 1, 0), tileAt(t, 0, 2, 2)], [[0, tid(0, 0), 0], null, [0, tid(2, 2), 0]], 'un tile per cella, gli esclusi non si disegnano');
    const bottom = TM().imageTiles(ts, 0, '000000111', {});
    eq([bottom.w, bottom.h, bottom.mask, tileAt(bottom, 0, 0, 0)], [3, 1, '111', [0, tid(0, 2), 0]]);
    const roof = TM().imageTiles(ts, 0, '000000111', { drawAll: true, layer: 'Sopra', fade: true });
    eq([roof.w, roof.layers[1].above, roof.layers[1].fade, tileAt(roof, 1, 0, 0), tileAt(roof, 0, 0, 0)], [3, true, true, [0, tid(0, 0), 0], null]);
  });

  test('TileMap: pittura, gomma, rettangolo, secchiello e timbri', () => {
    const ts = lTileset();
    const t = mapWith(4, 3, ts);
    const brush = TM().makeStamp(ts.id, [tid(0, 0)], 1, 1);
    ok(TM().paintStamp(t, 0, 1, 1, brush), 'dipinta');
    ok(!TM().paintStamp(t, 0, 1, 1, brush), 'stessa cella: nessuna modifica');
    eq(tileAt(t, 0, 1, 1), [0, tid(0, 0), 0]);
    eq(tileAt(t, 1, 1, 1), null, 'gli altri livelli non cambiano');
    ok(TM().eraseAt(t, 0, 1, 1, byId(ts)) && tileAt(t, 0, 1, 1) === null, 'gomma');
    const two = TM().makeStamp(ts.id, [tid(0, 0), tid(0, 1)], 2, 1);
    TM().fillRect(t, 0, { x: 0, y: 0, w: 3, h: 1 }, two);
    eq(t.layers[0].data.slice(0, 4).map((c) => c && c[1]), [tid(0, 0), tid(0, 1), tid(0, 0), null], 'rettangolo con il timbro ripetuto');
    TM().bucketFill(t, 0, 0, 2, TM().makeStamp(ts.id, [tid(2, 2)], 1, 1));
    eq(t.layers[0].data.filter((c) => c && c[1] === tid(2, 2)).length, 9, 'secchiello contiguo sulle celle vuote');
    TM().bucketFill(t, 0, 0, 0, TM().makeStamp(ts.id, [tid(1, 2)], 1, 1), false);
    eq(t.layers[0].data.filter((c) => c && c[1] === tid(1, 2)).length, 2, 'non contiguo: sostituisce tutte le tile uguali');
    eq(TM().floodFill([null, null, [0, 1, 0], null], 2, 2, 0, 0, [0, 7, 0]), [[0, 7, 0], [0, 7, 0], [0, 1, 0], [0, 7, 0]]);
    const m = TM().newTiles('mappa', 1, 1);
    eq([TM().tilesetRef(m, 'x'), TM().tilesetRef(m, 'y'), TM().tilesetRef(m, 'x'), m.tilesets], [0, 1, 0, ['x', 'y']]);
  });

  test('TileMap: tile più grandi della cella occupano più celle', () => {
    const ts = TS().newTileset('big', 'Grandi');
    TS().addSource(ts, { imageId: null, imageW: 128, imageH: 64 }, { tileW: 64, tileH: 64 });
    const t = mapWith(6, 6, ts, { cellW: 32, cellH: 32 });
    const b = byId(ts);
    TM().paintStamp(t, 0, 1, 1, TM().makeStamp(ts.id, [tid(0, 0), tid(1, 0)], 2, 1, { w: 2, h: 2 }));
    eq([tileAt(t, 0, 1, 1)[1], tileAt(t, 0, 3, 1)[1], tileAt(t, 0, 2, 1)], [tid(0, 0), tid(1, 0), null], 'timbro con passo di 2 celle');
    eq(TM().spanOf(t, b, tileAt(t, 0, 1, 1)), { w: 2, h: 2 });
    eq(TM().anchorAt(t, 0, 2, 2, b).x, 1, 'la cella coperta appartiene alla tile ancorata in alto a sinistra');
    TM().eraseAt(t, 0, 2, 2, b);
    eq(tileAt(t, 0, 1, 1), null, 'la gomma su una cella coperta cancella la tile');
  });

  test('TileMap: livelli indipendenti, ordine, duplicazione, eliminazione', () => {
    const t = TM().newGridMap();
    eq([t.w, t.h, t.cellW, t.feetPerCell, t.layers.map((l) => l.name)], [50, 50, 0, 5, ['Base', 'Sopra']], 'una tile per cella, livelli Base e Sopra');
    eq([TM().layersBelow(t).length, TM().layersAbove(t).map((l) => l.name)], [1, ['Sopra']], 'sotto e sopra le pedine');
    const li = TM().addLayer(t, 'Acqua', { opacity: 0.5 });
    eq([li, t.layers[li].id, t.layers[li].opacity], [2, 'l2', 0.5]);
    t.layers[li].data[0] = [0, 1, 0];
    const dup = TM().duplicateLayer(t, li);
    eq([t.layers[dup].name, t.layers[dup].data[0], t.layers[dup].id], ['Acqua (copia)', [0, 1, 0], 'l3']);
    t.layers[dup].data[0] = null;
    eq(t.layers[li].data[0], [0, 1, 0], 'copia indipendente');
    eq(TM().moveLayer(t, dup, -1), dup - 1, 'spostamento di una posizione');
    eq(TM().moveLayer(t, 0, -1), 0, 'il primo resta primo');
    TM().removeLayer(t, 0);
    eq(t.layers.length, 3);
    const one = TM().newTiles('mappa', 1, 1);
    TM().removeLayer(one, 0);
    let refused = false;
    try { TM().removeLayer(one, 0); } catch (e) { refused = true; }
    ok(refused, 'deve restare almeno un livello');
    const n = DnD.dati.normalizeTiles({ kind: 'mappa', w: 2, h: 1, tilesets: ['a', 'b'], layers: [{ id: 'x', name: 'Fondo', data: [[0, 1, 0], [1, 2, 3]] }, { id: 'x', visible: false, locked: true, opacity: 7, above: true, data: [null, [5, 5, 0]] }] });
    eq(n.layers.map((l) => [l.name, l.visible, l.locked, l.opacity, l.above]), [['Fondo', true, false, 1, false], ['Livello 2', false, true, 1, true]]);
    eq([n.layers[1].id !== n.layers[0].id, n.layers[1].data], [true, [null, null]], 'id unici, riferimento a un TileSet inesistente scartato');
  });

  test('TileMap: copia, incolla, sposta e trasforma una regione', () => {
    const ts = lTileset();
    const t = mapWith(4, 4, ts);
    TM().paintStamp(t, 0, 0, 0, TM().makeStamp(ts.id, [tid(0, 0), tid(1, 0)], 2, 1));
    const reg = TM().copyRegion(t, 0, { x: 0, y: 0, w: 2, h: 1 });
    eq(reg, { w: 2, h: 1, cells: [['ts-casa', tid(0, 0), 0], ['ts-casa', tid(1, 0), 0]] });
    TM().clearRegion(t, 0, { x: 0, y: 0, w: 2, h: 1 });
    TM().pasteRegion(t, 0, 1, 2, reg);
    eq([tileAt(t, 0, 0, 0), tileAt(t, 0, 1, 2)[1], tileAt(t, 0, 2, 2)[1]], [null, tid(0, 0), tid(1, 0)], 'spostata');
    const rot = TM().transformRegion(reg, 'ruota');
    eq([rot.w, rot.h, rot.cells.map((c) => [c[1], c[2]])], [1, 2, [[tid(0, 0), 1], [tid(1, 0), 1]]], 'ruotata di 90°');
    const st = TM().transformRegion(TM().makeStamp('a', [1, 2], 2, 1, { w: 2, h: 1 }), 'ruota');
    eq([st.stepX, st.stepY], [1, 2], 'il passo del timbro ruota con lui');
    eq(TM().transformRegion(TM().transformRegion(reg, 'specchia'), 'specchia'), reg);
    eq(TM().transformRegion(TM().transformRegion(reg, 'specchia-v'), 'specchia-v'), reg);
    eq(TM().transformRegion(TM().transformRegion(reg, 'ruota'), 'ruota-sx'), reg);
    const s = DnD.collisioni.regionToTiles(t, { x: 1, y: 2, w: 2, h: 1 }, byId(ts), 'structure');
    eq([s.kind, s.w, s.h, s.tilesets, s.cells], ['mappa', 2, 1, ['ts-casa'], '10'], 'regione salvata come struttura (bloccante la prima tile)');
  });

  test('Collisioni: poligono convertito in celle bloccate con soglia configurabile', () => {
    const half = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
    eq(COL().coverage([half], 0, 0, 1, 1), 0.5);
    eq(COL().coverage([half, half], 0, 0, 1, 1), 0.5, 'poligoni sovrapposti contano una volta');
    const props = Object.assign(TS().defaultProps(), { collision: { enabled: true, polygons: [half] } });
    eq(COL().tileBlockMask(props, { w: 1, h: 1 }, 0, 0.5), [true], 'metà cella con soglia 50%');
    eq(COL().tileBlockMask(props, { w: 1, h: 1 }, 0, 0.6), [false], 'soglia 60%');
    eq(COL().tileBlockMask(props, { w: 2, h: 2 }, 0, 0.5), [true, false, true, false], 'tile 2×2: colonna sinistra');
    eq(COL().tileBlockMask(Object.assign({}, props, { collision: { enabled: false, polygons: [half] } }), { w: 1, h: 1 }, 0, 0.5), [false], 'collisione disattivata');
    eq(COL().tileBlockMask(Object.assign(TS().defaultProps(), { blocking: true }), { w: 2, h: 1 }, 0, 0.5), [true, true], 'flag Bloccante');
    eq(COL().tileBlockMask(Object.assign(TS().defaultProps(), { navigable: false }), { w: 1, h: 1 }, 0, 0.5), [true], 'non navigabile');
    eq(COL().normalizePolygons([[[0, 0], [1, 0]], [[0, 0], [2, -1], [1, 1]]]), [[[0, 0], [1, 0], [1, 1]]], 'vertici fuori tile corretti');
    // TileSet con soglia al 25%: un triangolo che copre un quarto della tile basta per bloccare.
    const ts = lTileset({ blockThreshold: 0.25 });
    TS().setTileProps(ts, [tid(1, 1)], { excluded: false, collision: { enabled: true, polygons: [[[0, 0], [0.5, 0], [0, 1]]] } });
    const t = mapWith(2, 1, ts);
    t.layers[0].data = [[0, tid(1, 1), 0], null];
    eq([...COL().blockedSet(t, byId(ts))], [0]);
    ts.blockThreshold = 0.3;
    eq([...COL().blockedSet(t, byId(ts))], [], 'sotto la soglia');
  });

  test('Collisioni: rotazione e specchio di una cella, con collisioni e flag che seguono', () => {
    const ts = TS().newTileset('rocce', 'Rocce');
    TS().addSource(ts, { imageId: null, imageW: 64, imageH: 64 }, { tileW: 64, tileH: 64 });
    TS().setTileProps(ts, [tid(0, 0)], { collision: { enabled: true, polygons: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1]]] }, cost: 2, cover: 'mezza' });
    const b = byId(ts);
    const t = mapWith(4, 4, ts, { cellW: 32, cellH: 32 });
    const cells = (o) => { t.layers[0].data.fill(null); t.layers[0].data[0] = [0, tid(0, 0), o]; return [...COL().blockedSet(t, b)].sort((x, y) => x - y); };
    eq(cells(0), [0, 4], 'colonna sinistra della tile 2×2');
    eq(cells(TM().applyOp(0, 'ruota')), [0, 1], 'ruotata di 90°: riga in alto');
    eq(cells(TM().applyOp(0, 'specchia')), [1, 5], 'specchiata: colonna destra');
    eq(cells(TM().applyOp(0, 'specchia-v')), [0, 4], 'specchio verticale: invariata');
    eq(COL().cellInfo(t, b, 0, 1), { blocked: true, cost: 2, cover: 'mezza', tags: [], categories: [] }, 'flag della tile su tutte le sue celle');
    // Tile 2×1 ruotata: occupa 1×2 e l'intera tilemap ruota con le sue ancore.
    const ts2 = TS().newTileset('panca', 'Panca');
    TS().addSource(ts2, { imageId: null, imageW: 64, imageH: 32 }, { tileW: 64, tileH: 32 });
    TS().setTileProps(ts2, [tid(0, 0)], { blocking: true });
    const m = mapWith(3, 2, ts2, { cellW: 32, cellH: 32 });
    m.layers[0].data[0] = [0, tid(0, 0), 0];
    const r = TM().transformTiles(m, 'ruota', byId(ts2));
    eq([r.w, r.h, r.layers[0].data.findIndex(Boolean), TM().spanOf(r, byId(ts2), r.layers[0].data[1])], [2, 3, 1, { w: 1, h: 2 }]);
    eq([...COL().blockedSet(r, byId(ts2))].sort(), [1, 3], 'blocco ruotato con la tile');
  });

  test('TileMap: rotazione e specchio di una tilemap con i suoi tile (strutture)', () => {
    const t = TM().newTiles('mappa', 3, 2);
    t.tilesets = ['ts'];
    t.layers[0].data = [[0, 0, 0], [0, 1, 0], null, [0, 3, 0], [0, 4, 0], [0, 5, 0]];
    t.layers[1].data = [null, null, [0, 9, 0], null, null, null];
    t.overrides = 'b----l';
    t.cells = '110111';
    let cur = t;
    let R = [1, 0, 0, 1];
    for (const op of ['ruota', 'specchia', 'ruota', 'ruota', 'specchia', 'ruota', 'ruota']) {
      cur = TM().transformTiles(cur, op, {});
      R = op === 'ruota' ? DnD.tileset.rotateMatrix(R) : DnD.tileset.mirrorMatrix(R);
      for (let l = 0; l < 2; l++) {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
          const base = t.layers[l].data[y * 3 + x];
          if (!base) continue;
          const local = { x: -0.3, y: -0.4 };
          const q = DnD.tileset.applyMatrix(R, x + 0.5 + local.x - 1.5, y + 0.5 + local.y - 1);
          const px = q.x + cur.w / 2;
          const py = q.y + cur.h / 2;
          const c = cur.layers[l].data[Math.floor(py) * cur.w + Math.floor(px)];
          ok(c && c[1] === base[1], op + ': tile ' + base[1] + ' fuori posto');
          const lq = DnD.tileset.applyMatrix(TS().ORIENTS[c[2]], local.x, local.y);
          ok(Math.abs(lq.x - (px - Math.floor(px) - 0.5)) < 1e-9 && Math.abs(lq.y - (py - Math.floor(py) - 0.5)) < 1e-9, op + ': tile ' + base[1] + ' non ruotato');
        }
      }
    }
    const r = TM().transformTiles(t, 'ruota', {});
    const rotStr = (str, w, h) => { let out = ''; for (let y = 0; y < w; y++) for (let x = 0; x < h; x++) out += str[(h - 1 - x) * w + y]; return out; };
    eq([r.w, r.h, r.cells], [2, 3, G().rotateShape({ w: 3, h: 2, cells: '110111' }).cells]);
    eq(r.overrides, rotStr('b----l', 3, 2), 'eccezioni ruotate come l\'ingombro');
    let back = t;
    for (let i = 0; i < 4; i++) back = TM().transformTiles(back, 'ruota', {});
    eq(back, t, 'quattro rotazioni: come all\'inizio');
    eq(TM().transformTiles(TM().transformTiles(t, 'specchia', {}), 'specchia', {}), t);
    const placed = DnD.dati.normalizePlacedStructure(Object.assign({ id: 'p', x: 0, y: 0 }, G().placedFields({ mode: 'tiles', tiles: t })));
    eq(G().transformPlaced(placed, 'ruota').tiles.cells, r.cells, 'sulla griglia: struttura e tilemap ruotano insieme');
  });

  test('Collisioni: ingombro delle strutture dai flag, dai poligoni e dalle celle forzate', () => {
    const ts = lTileset();
    const tA = DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure');
    const placed = DnD.dati.normalizePlacedStructure(Object.assign({ id: 'casa', x: 5, y: 5 }, G().placedFields({ mode: 'tiles', tiles: tA })));
    const board = { combatants: [{ id: 't', size: 1, pos: null }], structures: [placed], items: [], ignoreCollisions: false };
    ok(!G().canPlaceToken(board, 't', 5, 5) && G().canPlaceToken(board, 't', 6, 5) && !G().canPlaceToken(board, 't', 7, 7), 'Modalità A');
    const m = mapWith(4, 1, ts);
    m.layers[0].data = [[0, tid(0, 0), 0], [0, tid(1, 1), 0], [0, tid(2, 2), 0], null];
    eq(DnD.collisioni.footprint(m, byId(ts), 'structure'), '1010', 'dai flag "Bloccante"');
    m.overrides = 'l--b';
    eq(DnD.collisioni.footprint(m, byId(ts), 'structure'), '0011', 'forzate: libera e bloccata');
    m.overrides = '----';
    TS().setTileProps(ts, [tid(1, 1)], { excluded: false, collision: { enabled: true, polygons: [COL().fullRect()] } });
    eq(DnD.collisioni.footprint(m, byId(ts), 'structure'), '1110', 'dal poligono di collisione');
    eq(DnD.collisioni.footprint(m, byId(ts), 'item'), '1110', 'oggetto: celle occupate');
    eq(DnD.collisioni.footprint(m, {}, 'structure'), '0000', 'TileSet sconosciuto: nessun blocco calcolato');
    eq(G().templateShape(DnD.dati.normalizeMapObject({ name: 'Forziere' }), 'item'), { w: 1, h: 1, cells: '1' });
  });

  test('isCellBlocked: TileMap, strutture, oggetti, "Ignora collisioni" e "Blocca il movimento"', () => {
    const ts = lTileset();
    const tileMap = Object.assign(TM().newGridMap(), { tilesets: [ts.id] });
    tileMap.layers[1].data[2 * 50 + 3] = [0, tid(0, 0), 0];      // D3: tile bloccante
    tileMap.layers[0].data[2 * 50 + 4] = [0, tid(1, 0), 0];      // E3: tile esclusa, non conta
    tileMap.overrides = tileMap.overrides.slice(0, 10) + 'b' + tileMap.overrides.slice(11); // K1 forzata
    const wall = DnD.dati.normalizePlacedStructure({ id: 's', x: 0, y: 0, w: 1, h: 1, cells: '1' });
    const rug = DnD.dati.normalizePlacedItem({ id: 'i', x: 1, y: 0, blocks: false });
    const chest = DnD.dati.normalizePlacedItem({ id: 'c', x: 2, y: 0, blocks: true });
    const grid = { structures: [wall], items: [rug, chest], labels: [], zones: [], tileMap, ignoreCollisions: false };
    const b = byId(ts);
    eq([[0, 0], [1, 0], [2, 0], [3, 2], [4, 2], [10, 0], [20, 20], [-1, 0]].map(([x, y]) => G().isCellBlocked(grid, x, y, b)),
      [true, false, true, true, false, true, false, true], 'struttura, oggetto libero, oggetto che blocca, tile, tile esclusa, cella forzata, vuota, fuori');
    tileMap.overrides = tileMap.overrides.slice(0, 2 * 50 + 3) + 'l' + tileMap.overrides.slice(2 * 50 + 4);
    eq(G().isCellBlocked(grid, 3, 2, b), false, 'cella forzata libera');
    grid.ignoreCollisions = true;
    eq([G().isCellBlocked(grid, 0, 0, b), G().isCellBlocked(grid, 2, 0, b)], [false, false], 'Ignora collisioni');
    // Collegato al movimento delle pedine.
    grid.ignoreCollisions = false;
    tileMap.overrides = '-'.repeat(2500);
    const board = G().boardOf(grid, [{ id: 't', size: 1, pos: null }], b);
    ok(!G().canPlaceToken(board, 't', 3, 2) && G().canPlaceToken(board, 't', 4, 2), 'le pedine non entrano nelle tile bloccanti');
  });

  test('Distanze con i piedi per cella della mappa', () => {
    eq([G().formatDistance(3), G().formatDistance(2, 10)], ['3 caselle · 15 ft · 4,5 m', '2 caselle · 20 ft · 6 m']);
  });

  test('Migrazione: griglia senza TileMap, TileSet della versione 6 e vecchia immagine stirata', () => {
    const id = IMG().imageId(PNG);
    const lCells = '100100111';
    const rotated = G().rotateShape({ w: 3, h: 3, cells: lCells }).cells;
    const raw = {
      version: 5, races: [], npcs: [], players: [],
      structures: [{ id: 'casa', name: 'Casa', mode: 'image', image: { id, w: 3, h: 3, cells: lCells, rect: { x: 0, y: 0, w: 3, h: 3 }, layer: 'sopra', fade: true } }],
      items: [{ id: 'tap', name: 'Tappeto', mode: 'image', image: { id, w: 3, h: 3, cells: '111111111' }, blocks: true }],
      savedGrids: [{ id: 'g', name: 'Vecchia', structures: [{ id: 'p', x: 4, y: 4, w: 3, h: 3, cells: rotated, image: { id, w: 3, h: 3, m: [0, -1, 1, 0], layer: 'sopra' } }] }],
    };
    const s = DnD.dati.importJSON(JSON.stringify(raw));
    eq(s.tilesets.length, 1, 'un TileSet per immagine e area');
    const src = s.tilesets[0].sources[0];
    eq([src.imageId, src.cols, src.rows, src.tileW, src.legacy], [id, 3, 3, 0, true]);
    const casa = s.structures.find((x) => x.id === 'casa');
    eq([casa.mode, casa.tiles.kind, casa.tiles.mask, casa.tiles.cells, casa.tiles.drawAll, casa.tiles.layers[1].fade, casa.tiles.layers[1].above], ['tiles', 'immagine', lCells, lCells, true, true, true]);
    eq([tileAt(casa.tiles, 1, 2, 2), tileAt(casa.tiles, 0, 2, 2)], [[0, tid(2, 2), 0], null], 'livello "sopra" conservato, indice 8 = colonna 2 riga 2');
    const tap = s.mapObjects.find((x) => x.id === 'tap-m');
    eq([tap.mode, tap.blocks, tap.tiles.cells, tap.contents], ['tiles', true, '111111111', [{ equipmentId: 'tap', qty: 1 }]], 'oggetto con tile: modello di oggetto di mappa');
    eq(s.equipment.find((x) => x.id === 'tap').name, 'Tappeto', 'e voce dell\'Attrezzatura');
    const p = s.savedGrids[0].structures[0];
    eq([p.cells, p.tiles.cells, p.tiles.layers[1].data[0]], [rotated, rotated, [0, tid(0, 2), 1]], 'elemento ruotato: celle e tile ruotati');
    eq(s.savedGrids[0].tileMap, null, 'griglia precedente: TileMap vuota');
    const resolved = DnD.dati.normalizeSource(TS().resolveLegacy(src, 300, 150));
    eq([resolved.tileW, resolved.tileH, resolved.cols, resolved.rows], [100, 50, 3, 3], 'tile = immagine / celle dell\'area');
    // Versione 6: tileset a immagine singola con flag per indice; struttura con tilemap a indici.
    const v6 = {
      version: 6, races: [], npcs: [], players: [],
      tilesets: [{ id: 'ts6', name: 'Dungeon', imageId: id, imageW: 64, imageH: 32, tileW: 16, tileH: 16, margin: 0, spacing: 0, cols: 4, rows: 2, blocking: '00000100', empty: '10000000' }],
      structures: [{ id: 'm', name: 'Muro', mode: 'tiles', tiles: { kind: 'mappa', w: 2, h: 1, tilesets: ['ts6'], fade: true, layers: [{ name: 'Base', data: [[0, 5, 0], null] }, { name: 'Sopra', data: [null, [0, 1, 3]] }], cells: '10' } }],
    };
    const s6 = DnD.dati.importJSON(JSON.stringify(v6));
    const t6 = s6.tilesets[0];
    eq([t6.sources.length, t6.sources[0].cols, TS().tileProps(t6, tid(1, 1)).blocking, TS().isExcluded(t6, tid(0, 0))], [1, 4, true, true]);
    const m6 = s6.structures[0].tiles;
    eq([m6.layers[0].data[0], m6.layers[1].data[1], m6.layers.map((l) => [l.name, l.above, l.fade])], [[0, tid(1, 1), 0], [0, tid(1, 0), 3], [['Base', false, false], ['Sopra', true, true]]]);
    eq(DnD.dati.importJSON(DnD.dati.exportJSON(s6)), s6, 'dopo la migrazione il formato è stabile');
  });

  test('TileMap: salvataggio e caricamento di una griglia con TileMap, copia nel combattimento', () => {
    const ts = lTileset();
    const tileMap = Object.assign(TM().newGridMap(20, 10), { tilesets: [ts.id], feetPerCell: 10, showGrid: false });
    TM().addLayer(tileMap, 'Decorazioni');
    tileMap.layers[0].data[5] = [0, tid(0, 2), 3];
    tileMap.layers[1].opacity = 0.5;
    tileMap.layers[2].visible = false;
    tileMap.layers[2].locked = true;
    const state = DnD.dati.emptyState();
    state.tilesets.push(ts);
    state.savedGrids.push(DnD.dati.normalizeSavedGrid({ id: 'g', name: 'Foresta', sessionId: state.sessions[0].id, w: 20, h: 10, structures: [], items: [], labels: [], zones: [], tileMap }));
    const again = DnD.dati.importJSON(DnD.dati.exportJSON(state));
    eq([again.savedGrids[0].tileMap, again.tilesets[0]], [DnD.dati.normalizeTiles(Object.assign({}, tileMap, { kind: 'mappa' })), ts], 'nessuna perdita di dati');
    const combat = { combatants: [], grid: { structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false } };
    G().applySavedGrid(combat, again.savedGrids[0], () => DnD.dadi.uid());
    combat.grid.tileMap.layers[0].data[5] = null;
    eq(again.savedGrids[0].tileMap.layers[0].data[5], [0, tid(0, 2), 3], 'il combattimento lavora su una copia');
    eq(G().createSavedGrid(combat, 'Copia', 'x', null).tileMap.layers[0].data[5], null);
  });

  test('TileMap: TileSet, sorgente o tile mancanti senza errori', async () => {
    const store = IMG().createStore(fakeBackend());
    const id = IMG().imageId(PNG);
    eq(store.drawable(id), { state: 'loading' });
    eq(await store.get(id), null);
    eq([store.status(id), store.drawable(id).state], ['missing', 'missing'], 'immagine mancante: segnaposto');
    const ts = lTileset();
    const t = mapWith(3, 1, ts);
    t.tilesets.push('sparito');
    t.layers[0].data = [[0, tid(0, 0, 9), 0], [1, tid(0, 0), 0], [0, tid(0, 0), 0]];
    eq([TS().resolveTile(ts, tid(0, 0, 9)), [...COL().blockedSet(t, byId(ts))]], [null, [2]], 'le tile mancanti non bloccano e non rompono la mappa');
    eq(DnD.dati.normalizeTiles(t).layers[0].data, t.layers[0].data, 'i riferimenti restano (segnaposto grigio)');
    // L'ingombro salvato con la tilemap resta valido anche se il TileSet sparisce.
    const placed = DnD.dati.normalizePlacedStructure(Object.assign({ x: 2, y: 2 }, G().placedFields({ mode: 'tiles', tiles: DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure') })));
    const board = { combatants: [{ id: 't', size: 1, pos: null }], structures: [placed], items: [], ignoreCollisions: false, tilesets: {} };
    ok(!G().canPlaceToken(board, 't', 2, 2) && G().canPlaceToken(board, 't', 3, 2));
  });

  test('TileSet: dove è usato (avviso prima di eliminare)', () => {
    const ts = lTileset();
    TS().addSource(ts, { imageId: null, imageW: 32, imageH: 32 }, { tileW: 32, tileH: 32 });
    const tiles = DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure');
    const tileMap = Object.assign(TM().newGridMap(), { tilesets: [ts.id] });
    tileMap.layers[0].data[0] = [0, tid(0, 0, 1), 0];
    const state = { structures: [{ name: 'Casa', tiles }], items: [], savedGrids: [{ name: 'Cripta', structures: [], items: [], tileMap }], sessions: [] };
    eq(TM().usage(state, ts.id), ['Struttura «Casa»', 'Griglia «Cripta»']);
    eq([TM().usage(state, ts.id, 0), TM().usage(state, ts.id, 1), TM().usage(state, 'altro')], [['Struttura «Casa»'], ['Griglia «Cripta»'], []]);
  });

  test('TileSet: lo stesso TileSet (e la stessa immagine) riusato da più strutture', async () => {
    const backend = fakeBackend();
    const store = IMG().createStore(backend);
    const imageId = await store.put(PNG);
    await store.put(PNG);
    const ts = lTileset();
    ts.sources[0].imageId = imageId;
    TS().addSource(ts, { imageId, imageW: 48, imageH: 48 }, { tileW: 48, tileH: 48 });
    const casa = DnD.dati.normalizeStructure({ id: 'casa', name: 'Casa', mode: 'tiles', tiles: DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure') });
    const muro = DnD.dati.normalizeStructure({ id: 'muro', name: 'Muro', mode: 'tiles', tiles: DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, '000000111', {}), byId(ts), 'structure') });
    eq(TM().referencedTilesetIds({ structures: [casa, muro] }), ['ts-casa']);
    eq([Object.keys(backend.data).length, IMG().referencedIds({ tilesets: [ts] })], [1, [imageId]], 'immagine salvata una volta sola anche con due sorgenti');
    eq([casa.tiles.w, muro.tiles.w, muro.tiles.h], [3, 3, 1]);
  });

  test('TileSet: esportazione e importazione (archivio e singola sessione con TileMap e immagini)', async () => {
    const backend = fakeBackend();
    const store = IMG().createStore(backend);
    const ts = lTileset();
    ts.sources[0].imageId = await store.put(PNG);
    const other = TS().newTileset('ts-mappa', 'Mappa');
    TS().addSource(other, { imageId: ts.sources[0].imageId, imageW: 48, imageH: 48 });
    const unused = TS().newTileset('ts-inutile', 'Inutile');
    const state = DnD.dati.emptyState();
    const sess = DnD.sessioni.current(state);
    state.tilesets.push(ts, DnD.dati.normalizeTileset(other), DnD.dati.normalizeTileset(unused));
    const tiles = DnD.collisioni.withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure');
    state.structures.push(DnD.dati.normalizeStructure({ id: 'casa', name: 'Casa', mode: 'tiles', tiles }));
    const tileMap = Object.assign(TM().newGridMap(), { tilesets: ['ts-mappa'] });
    tileMap.layers[0].data[0] = [0, tid(0, 0), 0];
    state.savedGrids.push(Object.assign(DnD.dati.normalizeSavedGrid({ id: 'g', name: 'Cripta', tileMap,
      structures: [Object.assign({ x: 1, y: 1 }, G().placedFields({ mode: 'tiles', tiles }))] }), { sessionId: sess.id }));
    const ids = IMG().referencedIds(state);
    const text = DnD.dati.exportJSON(state, await store.getMany(ids));
    const raw = JSON.parse(text);
    eq([Object.keys(raw.images), raw.tilesets.length], [[ts.sources[0].imageId], 3]);
    const images = IMG().validImages(Object.assign({}, raw.images, { 'img-0000000000000000': PNG }));
    eq(Object.keys(images), [ts.sources[0].imageId], 'immagini non valide scartate');
    const back = DnD.dati.importJSON(text);
    eq([back.savedGrids[0].tileMap.layers[0].data[0], back.savedGrids[0].structures[0].tiles.cells], [[0, tid(0, 0), 0], '100100111']);
    // Sessione: porta con sé i TileSet usati (anche solo dalla TileMap) e le loro immagini, non gli altri.
    const file = DnD.sessioni.exportSession(state, sess.id, await store.getMany(ids));
    eq([file.tilesets.map((t) => t.id).sort(), Object.keys(file.images)], [['ts-casa', 'ts-mappa'], [ts.sources[0].imageId]]);
    const dst = DnD.dati.emptyState();
    DnD.sessioni.importSession(dst, JSON.parse(JSON.stringify(file)), DnD.dadi.uid);
    eq([dst.tilesets.map((t) => t.id).sort(), dst.savedGrids[0].tileMap.tilesets], [['ts-casa', 'ts-mappa'], ['ts-mappa']]);
    eq(dst.tilesets.find((t) => t.id === 'ts-casa'), ts, 'TileSet identico dopo l\'importazione');
  });

  test('Salvataggio: errore di quota simulato, il progetto non risulta salvato', async () => {
    const backend = fakeBackend();
    const quota = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return e; };
    let full = false;
    const realSet = backend.set;
    backend.set = (k, v) => (full ? Promise.reject(quota()) : realSet(k, v));
    const store = await DnD.dati.openStore({ getItem: () => null, setItem() {}, removeItem() {} }, { backend });
    let reported = null;
    store.onSaveError = (e) => { reported = e; };
    eq((await store.update((st) => { st.diceHistory = []; })).ok, true, 'scrittura riuscita');
    full = true;
    const res = await store.update((st) => { st.tilesets.push(DnD.dati.normalizeTileset({ id: 'grande' })); });
    eq([res.ok, Boolean(reported), /spazio di archiviazione/.test(res.message), store.lastError && store.lastError.name], [false, true, true, 'QuotaExceededError']);
    ok(!JSON.parse(backend.data.stato).tilesets.some((t) => t.id === 'grande'), 'i dati non scritti non risultano salvati');
    full = false;
    eq((await store.save()).ok, true, 'liberato lo spazio, il salvataggio riprende');
    await realSet('img:img-0123456789abcdef', PNG);
    await store.clearAll();
    eq([Object.keys(backend.data), store.state.tilesets.length], [['stato'], 0], '"Cancella tutti i dati" svuota anche le immagini');
  });

  // I test possono essere asincroni (restituire una Promise): vengono eseguiti uno dopo l'altro.
  // ======================= Fase "pianificatore di sessione" =======================
  const CR = () => DnD.creature;
  const ATT = () => DnD.attrezzatura;
  const OM = () => DnD.oggettiMappa;
  const TL = () => DnD.tile;
  const ex = (id) => DnD.dati.normalizeCreature(DnD.creatureDati.examples().find((c) => c.id === id), false);

  // --- Dimensione sulla griglia ---
  test('Dimensione sulla griglia: automatica per taglia e personalizzata', () => {
    const auto = { auto: true };
    eq(['Minuscola', 'Piccola', 'Media', 'Grande', 'Enorme', 'Mastodontica'].map((s) => G().gridSizeFor(auto, s)),
      [{ w: 1, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 3 }, { w: 4, h: 4 }]);
    eq(G().gridSizeFor({ auto: false, w: 2, h: 4 }, 'Media'), { w: 2, h: 4 }, 'valore mio, rettangolare');
    eq(G().gridSizeFor({ auto: false, w: 12, h: 0 }, 'Media'), { w: 8, h: 1 }, 'limitata a 1–8 per lato');
    const big = DnD.dati.normalizeRace({ id: 'r', name: 'Gigante', size: 'Grande' });
    const a = DnD.dati.normalizeCreature({ id: 'a', name: 'Bruto', raceId: 'r' });
    const b = DnD.dati.normalizeCreature({ id: 'b', name: 'Drago', raceId: 'r', gridSize: { auto: false, w: 2, h: 4 } });
    const [ca, cb] = DnD.combattenti.createCombatants([], [{ npc: a, quantity: 1 }, { npc: b, quantity: 1 }], [big], () => 10);
    eq([ca.w, ca.h, cb.w, cb.h], [2, 2, 2, 4]);
    eq(DnD.dati.normalizeCreature({ name: 'Vecchio' }).gridSize, { auto: true, w: 1, h: 1 }, 'personaggi esistenti: Automatica');
    eq(G().tokenDims({ size: 3 }), { w: 3, h: 3 }, 'combattenti precedenti (size) ancora validi');
    eq(DnD.validazione.validateCreature(Object.assign(DnD.dati.normalizeCreature({ name: 'X' }), { gridSize: { auto: false, w: 9, h: 2 } }))['gridSize.w'] !== undefined, true);
  });

  test('Pedine 2×2 e 2×4: ingombro, collisioni e distanza tra le celle più vicine', () => {
    const wall = Object.assign({ id: 'w', x: 5, y: 0 }, G().shapeFrom(1, 10, () => true));
    const board = {
      w: 20, h: 20, structures: [wall], items: [], ignoreCollisions: false,
      combatants: [{ id: 'a', w: 2, h: 2, pos: { x: 0, y: 0 } }, { id: 'b', w: 2, h: 4, pos: null }, { id: 'c', w: 1, h: 1, pos: { x: 10, y: 10 } }],
    };
    ok(!G().canPlaceToken(board, 'b', 1, 1), '2×4 sovrapposta alla 2×2');
    ok(G().canPlaceToken(board, 'b', 2, 0), 'accanto alla 2×2');
    ok(!G().canPlaceToken(board, 'b', 4, 2), 'una cella dell\'ingombro sul muro');
    ok(!G().canPlaceToken(board, 'b', 19, 0), 'esce dalla griglia (20×20)');
    ok(G().canPlaceToken(board, 'b', 18, 16) && !G().canPlaceToken(board, 'b', 18, 17), 'bordo inferiore con altezza 4');
    ok(!G().canPlaceToken(board, 'a', 0, 0, { w: 6, h: 1 }), 'ridimensionata a 6×1 non entra (muro)');
    ok(G().tokenCovers(board.combatants[0], 1, 1) && !G().tokenCovers(board.combatants[0], 2, 1), 'clic sulla pedina in tutto l\'ingombro');
    const t = (x, y, w, h) => ({ pos: { x, y }, w, h });
    eq(G().tokenDistance(t(0, 0, 2, 2), t(2, 0, 1, 1)), 1, 'adiacenti');
    eq(G().tokenDistance(t(0, 0, 2, 2), t(5, 1, 2, 4)), 4, 'dalla cella più vicina');
    eq(G().tokenDistance(t(0, 0, 2, 4), t(1, 7, 1, 1)), 4, 'in verticale');
    eq(G().tokenDistance(t(0, 0, 1, 1), { pos: null }), null);
    const combat = { combatants: [{ id: 'g', kind: 'npc', w: 3, h: 3, pos: null }, { id: 'h', kind: 'npc', w: 1, h: 1, pos: null }],
      grid: { w: 10, h: 10, structures: [], items: [], labels: [], zones: [{ kind: 'nemici', x: 0, y: 0, w: 2, h: 2 }] } };
    const out = G().placeInZones(combat);
    eq([combat.combatants[0].pos, combat.combatants[1].pos, out.map((c) => c.id)], [null, { x: 0, y: 0 }, ['g']], 'chi non entra nella zona viene segnalato');
  });

  // --- Libreria di icone ---
  test('Icone di libreria: almeno 40, categorie, palette, oggetti con colore libero', () => {
    const L = DnD.libreriaIcone;
    ok(L.LIBRARY.length >= 40, 'icone delle pedine: ' + L.LIBRARY.length);
    const need = { umanoidi: ['guerriero', 'mago', 'ladro', 'chierico', 'arciere', 'bardo', 'elfo', 'nano', 'halfling', 'orco', 'goblin', 'umano'],
      bestie: ['lupo', 'orso', 'ragno', 'serpente', 'ratto', 'pipistrello', 'cavallo', 'cinghiale'],
      mostri: ['scheletro', 'zombie', 'fantasma', 'golem', 'troll', 'ogre'], draghi: ['drago'], demoni: ['demone'], aberrazioni: ['tentacoli', 'occhio', 'melma'] };
    for (const [cat, ids] of Object.entries(need)) for (const id of ids) ok(L.LIBRARY.some((x) => x.id === id && x.category === cat), cat + ': ' + id);
    eq(new Set(L.LIBRARY.map((x) => x.id)).size, L.LIBRARY.length, 'id unici');
    for (const color of Object.values(DnD.icone.CREATURE_COLORS)) {
      for (const x of L.LIBRARY) {
        const svg = DnD.icone.iconSvg(x.id, color);
        ok(svg.startsWith('<svg') && svg.includes(color) && !/\{[cdl]\}/.test(svg), x.id + ' in ' + color);
      }
      eq(DnD.icone.normalizeIcon({ kind: 'library', icon: 'drago', color }, false), { kind: 'library', icon: 'drago', color });
    }
    eq(DnD.icone.normalizeIcon({ kind: 'library', icon: 'drago', color: '#123456' }, false).color, DnD.icone.CREATURE_COLORS.grigio, 'pedine: solo i colori della palette');
    eq(DnD.icone.normalizeIcon({ kind: 'library', icon: 'inesistente' }, false).kind, 'shape');
    for (const id of ['spada', 'ascia', 'arco', 'scudo', 'armatura', 'pozione', 'pergamena', 'chiave', 'forziere', 'borsa', 'gemma', 'torcia', 'porta', 'leva', 'trappola', 'barile', 'bacchetta']) {
      ok(L.ITEM_LIBRARY.some((x) => x.id === id), 'oggetto: ' + id);
    }
    eq(DnD.icone.normalizeIcon({ kind: 'library', icon: 'forziere', color: '#abcdef' }, true).color, '#abcdef', 'oggetti: colore libero');
  });

  // --- Creature: tabelle e calcoli ---
  test('Creature: competenza e PE dal grado di sfida', () => {
    const prof = { 0: 2, '1/8': 2, '1/2': 2, 4: 2, 5: 3, 8: 3, 9: 4, 12: 4, 13: 5, 16: 5, 17: 6, 20: 6, 21: 7, 24: 7, 25: 8, 28: 8, 29: 9, 30: 9 };
    for (const [cr, p] of Object.entries(prof)) eq(CR().profForCr(cr), p, 'CS ' + cr);
    const xp = { 0: 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 5: 1800, 8: 3900, 10: 5900, 13: 10000, 20: 25000, 21: 33000, 24: 62000, 30: 155000 };
    for (const [cr, v] of Object.entries(xp)) eq(CR().xpForCr(cr), v, 'PE CS ' + cr);
    eq(DnD.creatureDati.CRS.length, 34);
    eq(CR().formatXp(155000), '155.000');
  });

  test('Creature: PF dai dadi vita della taglia, salvezze, abilità e Percezione passiva', () => {
    const c = DnD.dati.normalizeCreature({ type: 'creatura', name: 'Orso', size: 'Grande', hitDice: 6, abilities: { FOR: 18, DES: 12, COS: 14, INT: 2, SAG: 13, CAR: 7 }, cr: '5' }, false);
    eq(CR().hpInfo(c).text, '45 (6d10 + 12)');
    eq(['Minuscola', 'Piccola', 'Media', 'Grande', 'Enorme', 'Mastodontica'].map(CR().hitDieFor), [4, 6, 8, 10, 12, 20]);
    eq(CR().hpInfo(Object.assign({}, c, { hpOverride: 60 })).total, 60, 'PF sovrascritti a mano');
    eq(CR().hpInfo(Object.assign({}, c, { size: 'Piccola', hitDice: 2, abilities: Object.assign({}, c.abilities, { COS: 8 }) })).formula, '2d6 − 2');
    c.saves = ['FOR', 'COS'];
    c.skills = { 'Percezione': 1, 'Atletica': 2 };
    eq([CR().saveBonus(c, 'FOR'), CR().saveBonus(c, 'DES'), CR().saveBonus(c, 'COS')], [7, 1, 5], 'mod + competenza (+3 a CS 5)');
    eq([CR().skillBonus(c, 'Percezione'), CR().skillBonus(c, 'Atletica'), CR().skillBonus(c, 'Furtività')], [4, 10, 1], 'maestria = competenza ×2');
    eq(CR().passivePerception(c), 14);
    c.skills = {};
    eq(CR().passivePerception(c), 11, 'senza competenza: 10 + SAG');
    eq(CR().sensesText(Object.assign({}, c, { senses: { darkvision: 18, blindsight: 0, truesight: 0, tremorsense: 0 } })), 'scurovisione 18 m, Percezione passiva 11');
  });

  test('Creature: testo delle azioni in stile manuale (generato e modificabile)', () => {
    const c = DnD.dati.normalizeCreature({ type: 'creatura', name: 'Bruto', cr: '2', abilities: { FOR: 18, DES: 10, COS: 10, INT: 10, SAG: 10, CAR: 10 },
      actions: [{ id: 's', name: 'Spadone', mech: { kind: 'attacco', range: 'mischia', ability: 'FOR', reach: 1.5, damages: [{ dice: '2d6', type: 'tagliente' }] } }] }, false);
    const a = c.actions[0];
    eq(CR().actionText(c, a), 'Attacco con arma da mischia: +6 al tiro per colpire, portata 1,5 m, un bersaglio. Colpito: 11 (2d6 + 4) danni taglienti.');
    const d = ex('esempio-drago-cenere');
    eq(CR().actionText(d, d.actions[1]), 'Attacco con arma da mischia: +7 al tiro per colpire, portata 3 m, un bersaglio. Colpito: 15 (2d10 + 4) danni perforanti più 3 (1d6) danni da fuoco.');
    eq(CR().actionText(d, d.actions[3]), 'Ogni creatura in un cono di 9 m deve effettuare un tiro salvezza su Destrezza con CD 15, subendo 35 (10d6) danni da fuoco se lo fallisce, o la metà dei danni se lo supera.');
    eq(CR().actionText(d, d.actions[0]), 'Drago di cenere giovane effettua tre attacchi: uno con morso e due con artiglio.');
    eq(CR().actionTitle(d.actions[3]), 'Soffio di cenere (Ricarica 5–6)');
    eq(CR().actionTitle(d.legendary[2]), 'Battito d\'ali (costa 2 azioni)');
    eq(CR().actionText(c, Object.assign({}, a, { customText: true, desc: 'Scritto a mano.' })), 'Scritto a mano.', 'il testo resta modificabile');
  });

  test('Difese ai danni: vulnerabilità, resistenza, immunità e attacchi non magici', () => {
    const def = { vuln: ['fuoco'], res: ['freddo', 'tagliente-nm'], imm: ['veleno'] };
    eq(CR().applyDefenses(14, 'fuoco', def, false), { amount: 28, note: 'vulnerabilità al fuoco: 14 → 28' });
    eq(CR().applyDefenses(15, 'freddo', def, false), { amount: 7, note: 'resistenza al freddo: 15 → 7' }, 'metà per difetto');
    eq(CR().applyDefenses(9, 'veleno', def, true), { amount: 0, note: 'immunità al veleno: 9 → 0' });
    eq(CR().applyDefenses(11, 'tagliente', def, false).amount, 5, 'tagliente da attacco non magico');
    eq(CR().applyDefenses(11, 'tagliente', def, true).amount, 11, 'l\'attacco magico supera la resistenza ai non magici');
    eq(CR().applyDefenses(8, 'acido', def, false), { amount: 8, note: '' });
    const parts = CR().applyDamageParts([{ amount: 10, type: 'perforante' }, { amount: 6, type: 'fuoco' }], { vuln: [], res: ['fuoco'], imm: [] }, false);
    eq([parts.total, parts.notes], [13, ['resistenza al fuoco: 6 → 3']]);
    eq([CR().damageTypeOf('Taglienti'), CR().damageTypeOf('fuoco'), CR().damageTypeOf('boh')], ['tagliente', 'fuoco', '']);
    eq(CR().parseDefenses('Veleno, fuoco'), ['veleno', 'fuoco'], 'resistenze di una razza (testo libero)');
    // Vale per ogni combattente: un giocatore con la resistenza della razza.
    const nano = DnD.dati.normalizeRace({ id: 'n', name: 'Nano', resistances: 'Veleno' });
    const p = DnD.dati.normalizeCreature({ id: 'p', name: 'Thorin', raceId: 'n' }, true);
    eq(DnD.combattenti.createCombatants([p], [], [nano], () => 1)[0].defenses.res, ['veleno']);
  });

  test('Creature: multiattacco, ricarica, usi giornalieri e azioni leggendarie', () => {
    const d = ex('esempio-drago-cenere');
    eq(CR().expandMultiattack(d, d.actions[0]).map((a) => a.name), ['Morso', 'Artiglio', 'Artiglio']);
    const [c] = DnD.combattenti.createCombatants([], [{ npc: d, quantity: 1 }], [], () => 10);
    const st = c.creature;
    eq([c.maxHp, c.ac, c.w, c.h, c.defenses.imm, st.legendaryPoints, st.legendaryResistance], [123, 17, 2, 2, ['fuoco'], { max: 3, left: 3 }, { max: 1, left: 1 }]);
    const breath = CR().allActions(st).find((a) => a.name === 'Soffio di cenere');
    ok(CR().canUse(st, breath).ok, 'ricarica pronta all\'inizio');
    CR().consume(st, breath);
    eq(CR().canUse(st, breath), { ok: false, reason: 'da ricaricare' });
    eq(CR().startTurn(st, seq(4)).length, 1, 'd6 = 4: non si ricarica');
    ok(!st.recharge[breath.id]);
    CR().startTurn(st, seq(5));
    ok(st.recharge[breath.id], 'd6 = 5: ricaricata');
    const wing = CR().allActions(st).find((a) => a.name === 'Battito d\'ali');
    CR().consume(st, wing);
    CR().consume(st, CR().allActions(st).find((a) => a.name === 'Colpo di coda'));
    eq([st.legendaryPoints.left, CR().canUse(st, wing).ok], [0, false], 'punti leggendari esauriti');
    CR().startTurn(st, () => 6);
    eq(st.legendaryPoints.left, 3, 'ripristinati all\'inizio del turno della creatura');
    // Usi giornalieri
    const m = DnD.dati.normalizeCreature({ type: 'creatura', name: 'Strega', actions: [{ id: 'x', name: 'Malocchio', freq: { kind: 'giorno', uses: 2 }, mech: { kind: 'testo' } }] }, false);
    const s2 = CR().combatState(m);
    const mal = CR().allActions(s2)[0];
    CR().consume(s2, mal);
    CR().consume(s2, mal);
    eq([s2.uses.x, CR().canUse(s2, mal).reason], [0, 'usi esauriti']);
    // Attacco con critico (dadi raddoppiati) e 1 naturale
    const bite = d.actions[1];
    const hit = CR().resolveAttack(d, bite, { ac: 15 }, 'normale', seq(20, 5, 5, 5, 5, 2, 3));
    eq([hit.crit, hit.parts.map((q) => q.dice), hit.parts.map((q) => q.amount)], [true, ['4d10', '2d6'], [24, 5]]);
    eq(CR().resolveAttack(d, bite, { ac: 1 }, 'normale', seq(1)).hit, false, '1 naturale: mancato');
    // Promemoria della tana a iniziativa 20
    const order = [{ id: 'a', initiative: 22 }, { id: 'b', initiative: 15 }];
    eq([CR().crossesLair(order, 'a', 'b', false), CR().crossesLair(order, 'b', 'a', true), CR().crossesLair([{ id: 'c', initiative: 12 }], null, 'c', true)], [true, false, true]);
  });

  test('Creature: Resistenza leggendaria trasforma un tiro salvezza fallito in riuscito', () => {
    const [c] = DnD.combattenti.createCombatants([], [{ npc: ex('esempio-drago-cenere'), quantity: 1 }], [], () => 10);
    c.hp = 100;
    c.pendingSave = { full: [{ amount: 30, type: 'freddo' }], half: true, applied: 30, magical: true, text: 'Cono di freddo' };
    const r = CR().useLegendaryResistance(c);
    eq([r, c.hp, c.creature.legendaryResistance.left, c.pendingSave], [{ refund: 15, applied: 15 }, 115, 0, null], 'metà danni con il successo');
    c.pendingSave = { full: [{ amount: 10, type: 'fuoco' }], half: false, applied: 0, magical: true, text: 'x' };
    eq(CR().useLegendaryResistance(c), null, 'nessun uso rimasto');
  });

  test('Creature: tre esempi originali e stima del grado di sfida', () => {
    const list = DnD.creatureDati.examples().filter((x) => x.type === 'creatura').map((x) => DnD.dati.normalizeCreature(x, false));
    eq(list.map((c) => [c.ctype, c.cr]), [['bestia', '1'], ['costrutto', '5'], ['drago', '8']]);
    ok(list[0].traits.length && list[1].actions.some((a) => a.mech.kind === 'multiattacco') && list[1].actions.some((a) => a.freq.kind === 'ricarica') && list[2].legendary.length, 'tratti, multiattacco, ricarica, leggendarie');
    for (const c of list) eq(DnD.validazione.validateMonster(c), {}, c.name + ' valida');
    const e = CR().estimateCr(list[1]);
    eq([e.hp, e.dpr, e.bonus], [85, 26, 7], 'sentinella: PF 85, danni per round 26 (2 magli da 13, più del vapore da 21), +7');
    ok(DnD.creatureDati.CRS.includes(e.estimate) && DnD.creatureDati.CRS.includes(e.defensive) && DnD.creatureDati.CRS.includes(e.offensive));
    eq(CR().estimateCr(DnD.dati.normalizeCreature({ type: 'creatura', name: 'Nullo', hitDice: 1, ac: 10, abilities: { COS: 10 }, actions: [] }, false)).estimate, '0');
    ok(DnD.dati.emptyState().npcs.filter((n) => n.type === 'creatura' && n.shared).length === 3, 'esempi presenti nei dati nuovi, condivisi');
  });

  // --- Attrezzatura ---
  test('Attrezzatura: bonus e danno delle armi e CA dalle armature del catalogo', () => {
    const cat = ATT().defaults();
    const get = (name) => cat.find((e) => e.name === name);
    ok(cat.filter((e) => e.weapon).length >= 30 && cat.filter((e) => e.armor).length === 13, 'armi e armature base');
    eq(new Set(cat.map((e) => e.id)).size, cat.length, 'id unici');
    const ab = { FOR: 16, DES: 14, COS: 12, INT: 10, SAG: 10, CAR: 10 };
    const pick = (s) => [s.ability, s.toHit, s.damageDice, s.damageBonus, s.damageType];
    eq(pick(ATT().weaponStats(get('Spada lunga'), ab, 2)), ['FOR', 5, '1d8', 3, 'tagliente']);
    eq(pick(ATT().weaponStats(get('Arco lungo'), ab, 2)), ['DES', 4, '1d8', 2, 'perforante'], 'distanza: DES');
    eq(ATT().weaponStats(get('Stocco'), Object.assign({}, ab, { DES: 18 }), 3).ability, 'DES', 'accurata: la migliore');
    const magic = Object.assign(JSON.parse(JSON.stringify(get('Spada lunga'))), { weapon: Object.assign({}, get('Spada lunga').weapon, { magic: 2 }) });
    eq([ATT().weaponStats(magic, ab, 2).toHit, ATT().weaponStats(magic, ab, 2).damageBonus], [7, 5], 'bonus magico');
    eq(ATT().armorAc(get('Cotta di maglia'), get('Scudo'), ab).total, 18, 'pesante: niente DES, + scudo');
    eq(ATT().armorAc(get('Giaco di maglia'), null, Object.assign({}, ab, { DES: 18 })).total, 15, 'media: DES massimo +2');
    eq(ATT().armorAc(get('Armatura di cuoio'), null, ab).total, 13, 'leggera: DES intera');
    eq(ATT().armorAc(null, null, ab, 'COS').total, 13, 'difesa senza armatura');
    // Collegamento con le schede: arma "auto" dal catalogo, arma scritta a mano invariata, CA automatica.
    const c = DnD.dati.normalizeCreature({ name: 'Guardia', level: 1, abilities: ab, acMode: 'auto', armor: { equipmentId: get('Cotta di maglia').id, shieldId: get('Scudo').id },
      weapons: [{ name: 'Spada lunga', equipmentId: get('Spada lunga').id }, { name: 'Pugno', toHit: 9, damageDice: '1d4', damageBonus: 1 }] });
    const st = DnD.combattenti.derivedStats(c, null, cat);
    eq([st.ac.total, st.weapons[0].toHit, st.weapons[0].damageBonus, st.weapons[1].toHit], [18, 5, 3, 9]);
    const manual = Object.assign({}, c.weapons[0], { auto: false, toHit: 12 });
    eq(ATT().resolveWeapon(manual, cat, ab, 2).toHit, 12, 'sovrascritta a mano');
    eq(ATT().inventoryWeight([{ equipmentId: get('Spada lunga').id, qty: 2 }], cat, { mo: 50 }), 3.5, '2 × 1,5 kg + 50 monete');
  });

  // --- Taglio in tile ---
  test('Taglio in tile: colonne e righe al cambio di X e Y, tile di bordo parziali, flag stabili', () => {
    eq(TL().grid(100, 70, 32, 32), { cols: 4, rows: 3, total: 12, partialCols: true, partialRows: true });
    eq(TL().grid(64, 64, 16, 32), { cols: 4, rows: 2, total: 8, partialCols: false, partialRows: false }, 'non quadrati');
    eq(TL().gridText(TL().grid(100, 70, 32, 32)), '4 colonne × 3 righe = 12 tile');
    const ts = TS().newTileset('t', 'T');
    const src = TS().addSource(ts, { imageId: null, imageW: 100, imageH: 70 }, { tileW: 50, tileH: 35 });
    eq([src.cover, src.cols, src.rows], [true, 2, 2]);
    TL().setFlag(ts, [TS().tileId(0, 1, 1)], 'blocking', true);
    TL().setFlag(ts, [TS().tileId(0, 0, 1)], 'difficult', true);
    TL().setTileSize(src, 32, 32);
    eq([src.cols, src.rows], [4, 3], 'tile più piccoli: se ne creano altri');
    eq(TS().tileRect(src, 3, 2), { sx: 96, sy: 64, sw: 4, sh: 6 }, 'bordo tagliato sull\'immagine');
    ok(TS().isPartial(src, 3, 0) && !TS().isPartial(src, 2, 1), 'indicatore "parziale"');
    eq(TL().partialTiles(src).length, 6);
    eq([TL().flagsOf(ts, TS().tileId(0, 1, 1)).blocking, TL().flagsOf(ts, TS().tileId(0, 0, 1)).difficult, TS().tileProps(ts, TS().tileId(0, 0, 1)).cost], [true, true, 2], 'flag mantenuti per (colonna, riga)');
    TL().setTileSize(src, 128, 128);
    eq([src.cols, src.rows], [1, 1], 'tile più grandi: se ne creano meno');
    let msg = '';
    try { TL().setTileSize(src, 0, 16); } catch (e) { msg = e.message; }
    ok(/tra 1 e/.test(msg), 'dimensione non valida rifiutata');
    eq(TL().remapBits('1001', 2, 2, 3, 2, '0'), '100010', 'selezione riportata sulle stesse coordinate');
    eq([TL().rectIndices(4, 1, 10), TL().invertBits('1100'), TL().setBits('0000', [1, 3], true)], [[1, 2, 5, 6, 9, 10], '0011', '0101']);
  });

  test('Taglio in tile: TileSet in uso (avviso) e "Salva come nuovo tileset"', () => {
    const ts = lTileset();
    const state = { structures: [{ name: 'Casa', tiles: TM().imageTiles(ts, 0, '111111111', {}) }], mapObjects: [], savedGrids: [], sessions: [] };
    eq(TL().usage(state, ts.id), ['Struttura «Casa»'], 'dove è usato');
    const copy = TL().copyWithSize(ts, 0, 24, 24, 'ts-nuovo');
    eq([copy.id, copy.sources[0].tileW, copy.sources[0].cols, ts.sources[0].tileW, ts.sources[0].cols], ['ts-nuovo', 24, 2, 16, 3], 'copia con la nuova dimensione, originale invariato');
    eq(TS().tileProps(copy, tid(0, 0)).blocking, true, 'flag copiati per coordinate');
    eq(TL().usage(state, 'ts-nuovo'), []);
  });

  test('Taglio in tile: rilevamento dei tile vuoti con soglia (anche tile parziali)', () => {
    const ts = TS().newTileset('t', 'T');
    const src = TS().addSource(ts, { imageId: null, imageW: 6, imageH: 4 }, { tileW: 4, tileH: 4 });
    eq([src.cols, src.rows], [2, 1], '6 px con tile da 4: una colonna parziale di 2 px');
    const alpha = new Uint8Array(24);
    alpha[0] = 255; // un solo pixel nel primo tile (1/16 = 6%)
    for (const i of [4, 5, 10, 11]) alpha[i] = 255; // metà del tile parziale (2×4 coperto: 4/8)
    eq(TL().detectEmpty(ts, src, alpha, 0.05), '00', 'sopra la soglia del 5%');
    eq(TL().detectEmpty(ts, src, alpha, 0.1), '10', 'soglia 10%: il primo tile è vuoto');
    eq([TS().isExcluded(ts, tid(0, 0)), TS().isExcluded(ts, tid(1, 0))], [true, false], 'esclusi in automatico');
    TL().setFlag(ts, [tid(0, 0)], 'excluded', false);
    ok(!TS().isExcluded(ts, tid(0, 0)), 'modificabile a mano');
  });

  // --- Strutture da immagine ---
  test('Struttura da immagine a forma di L: collisioni, flag Bloccante, rotazione e specchio', () => {
    const ts = lTileset();
    const b = byId(ts);
    const L = '100100111';
    const free = TS().newTileset('libero', 'Libero');
    TS().addSource(free, { imageId: null, imageW: 48, imageH: 48 }, { tileW: 16, tileH: 16 });
    const tFree = DnD.collisioni.withFootprint(Object.assign(TM().imageTiles(free, 0, L, {}), { sel: L }), byId(free), 'structure');
    eq([tFree.w, tFree.h, tFree.cells], [3, 3, L], 'nessun tile Bloccante: bloccano tutti i selezionati');
    const partial = TS().newTileset('parz', 'P');
    TS().addSource(partial, { imageId: null, imageW: 48, imageH: 48 }, { tileW: 16, tileH: 16 });
    TS().setTileProps(partial, [tid(0, 2), tid(1, 2), tid(2, 2)], { blocking: true });
    const tP = DnD.collisioni.withFootprint(TM().imageTiles(partial, 0, L, {}), byId(partial), 'structure');
    eq(tP.cells, '000000111', 'solo i selezionati Bloccanti bloccano');
    const placed = DnD.dati.normalizePlacedStructure(Object.assign({ x: 2, y: 2 }, G().placedFields({ mode: 'tiles', tiles: tFree })));
    const board = { w: 10, h: 10, combatants: [{ id: 't', w: 1, h: 1, pos: null }], structures: [placed], items: [], ignoreCollisions: false, tilesets: byId(free) };
    ok(!G().canPlaceToken(board, 't', 2, 2) && G().canPlaceToken(board, 't', 3, 2) && G().canPlaceToken(board, 't', 4, 3), 'l\'interno della L resta libero');
    const rot = G().transformPlaced(placed, 'ruota');
    eq(rot.cells, G().rotateShape({ w: 3, h: 3, cells: L }).cells, 'ruotano insieme tile e ingombro');
    eq(rot.tiles.mask, G().rotateShape({ w: 3, h: 3, cells: L }).cells);
    const mir = G().transformPlaced(placed, 'specchia');
    eq(mir.cells, G().mirrorShape({ w: 3, h: 3, cells: L }).cells, 'specchio');
    eq(mir.tiles.layers[0].data[2][2] !== 0, true, 'l\'orientamento della tile cambia');
    const s = DnD.dati.normalizeStructure({ name: 'Casa', mode: 'tiles', tiles: Object.assign({}, tP, { ops: ['ruota', 'boh'] }) });
    eq(s.tiles.ops, ['ruota'], 'trasformazioni salvate nella struttura');
    ok(b);
  });

  // --- Griglie di dimensione libera ---
  test('Griglie di dimensioni diverse: 20×30 e 100×100, coordinate e confini', () => {
    eq([G().colLabel(25), G().colLabel(26), G().colLabel(51), G().colLabel(99), G().cellLabel(99, 99)], ['Z', 'AA', 'AZ', 'CV', 'CV100']);
    const g = DnD.dati.normalizeGridContent({ w: 20, h: 30, structures: [Object.assign({ x: 40, y: 5 }, G().squareShape(2))], zones: [{ x: 18, y: 0, w: 9, h: 3 }], labels: [{ text: 'x', x: 99, y: 99 }] });
    eq([g.w, g.h, g.structures[0].x, g.zones[0].w, g.labels[0].x, g.labels[0].y], [20, 30, 18, 2, 19, 29], 'elementi riportati dentro la griglia');
    ok(G().isCellBlocked(g, 20, 0) && G().isCellBlocked(g, 0, 30) && !G().isCellBlocked(g, 19, 29), 'fuori dalla griglia = bloccato');
    const big = DnD.dati.normalizeGridContent({ w: 100, h: 100 });
    ok(G().inBounds(G().squareShape(1), 99, 99, big) && !G().inBounds(G().squareShape(2), 99, 0, big));
    eq(G().rectBetween({ x: 98, y: 5 }, { x: 200, y: 2 }, big), { x: 98, y: 2, w: 2, h: 4 });
    eq([DnD.dati.normalizeGridContent({ w: 3, h: 400 }).w, DnD.dati.normalizeGridContent({ w: 3, h: 400 }).h], [5, 100], 'limiti 5–100');
    eq(DnD.dati.normalizeGridContent({}).w, 50, 'griglie precedenti: 50×50');
    eq(DnD.validazione.validateGridProps({ w: 4, h: 101, feetPerCell: 5 }).w !== undefined, true);
    const tm = DnD.dati.normalizeGridContent({ w: 20, h: 30, tileMap: TM().newTiles('mappa', 5, 5) }).tileMap;
    eq([tm.w, tm.h], [20, 30], 'la TileMap segue la dimensione della griglia');
    // Ridimensionamento: elementi fuori dall'area elencati, aggiunta di celle a sinistra/in alto.
    const res = G().resizeGrid({ w: 20, h: 20, structures: [Object.assign({ id: 'a', name: 'Muro', x: 15, y: 1 }, G().squareShape(2))], items: [], labels: [], zones: [], tileMap: null }, 10, 10);
    eq([res.lost, res.grid.structures.length, res.grid.w], [['Struttura «Muro»'], 0, 10]);
    const grow = G().resizeGrid({ w: 10, h: 10, structures: [Object.assign({ id: 'a', name: 'Muro', x: 0, y: 0 }, G().squareShape(1))], items: [], labels: [], zones: [], tileMap: TM().newGridMap(10, 10) }, 12, 13, { x: 'sinistra', y: 'sopra' });
    eq([grow.grid.structures[0].x, grow.grid.structures[0].y, grow.grid.tileMap.w, grow.grid.tileMap.h, grow.lost], [2, 3, 12, 13, []]);
  });

  test('Sfondo: calibrazione dei pixel per cella, adattamento e copia nel combattimento', () => {
    eq(G().calibrate(1400, 1050, 70), { w: 20, h: 15, exactW: 20, exactH: 15 });
    eq([G().calibrate(100, 100, 70).w, G().calibrate(20000, 200, 10).w], [5, 100], 'limitata a 5–100');
    const bg = DnD.dati.normalizeBackground({ kind: 'immagine', imageId: 'img-0123456789abcdef', imageW: 1400, imageH: 700, fit: 'copri' });
    eq(G().backgroundRect(bg, 1400, 700, 20, 20), { x: -10, y: 0, w: 40, h: 20 }, 'copri: proporzioni mantenute');
    eq(G().backgroundRect(Object.assign({}, bg, { fit: 'adatta' }), 1400, 700, 20, 20), { x: 0, y: 0, w: 20, h: 20 }, 'adatta: stira');
    eq(G().backgroundRect(Object.assign({}, bg, { fit: 'originale', pxPerCell: 70, x: 1, scale: 2 }), 1400, 700, 20, 20), { x: 1, y: 0, w: 40, h: 20 }, 'originale calibrata');
    eq(DnD.dati.normalizeBackground({ kind: 'immagine', imageId: 'non-valido' }).kind, 'colore', 'immagine non valida: colore');
    const saved = DnD.dati.normalizeSavedGrid({ id: 'g', name: 'Mappa', w: 20, h: 15, feetPerCell: 10, background: bg });
    const combat = { combatants: [], grid: { structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false } };
    G().applySavedGrid(combat, saved, () => DnD.dadi.uid());
    eq([combat.grid.w, combat.grid.h, combat.grid.feetPerCell, combat.grid.background.imageId], [20, 15, 10, bg.imageId], 'sfondo e dimensione copiati');
    combat.grid.background.opacity = 0.2;
    eq(saved.background.opacity, 1, 'copia indipendente');
    eq(G().createSavedGrid(combat, 'Nuova', 'n', null).background.opacity, 0.2, '«Salva come nuova griglia» conserva lo sfondo');
  });

  test('isCellBlocked: porta chiusa e aperta, tile Bloccante, cella forzata', () => {
    const ts = lTileset();
    const tileMap = Object.assign(TM().newGridMap(10, 10), { tilesets: [ts.id] });
    tileMap.layers[0].data[3 * 10 + 3] = [0, tid(0, 0), 0]; // tile Bloccante
    tileMap.overrides = tileMap.overrides.slice(0, 55) + 'b' + tileMap.overrides.slice(56); // cella (5, 5) forzata
    const door = DnD.dati.normalizePlacedItem(Object.assign(OM().instantiate(DnD.dati.normalizeMapObject({ id: 'p', name: 'Porta', otype: 'porta' }), 'd'), { x: 1, y: 1 }));
    const barrel = DnD.dati.normalizePlacedItem({ id: 'b', name: 'Barile', otype: 'barile', blocks: true, x: 2, y: 2 });
    const chest = DnD.dati.normalizePlacedItem({ id: 'c', name: 'Forziere', otype: 'forziere', x: 4, y: 4 });
    const grid = { w: 10, h: 10, structures: [], items: [door, barrel, chest], tileMap, ignoreCollisions: false };
    const tsMap = byId(ts);
    eq([door.state, G().isCellBlocked(grid, 1, 1, tsMap)], ['chiuso', true], 'porta chiusa: blocca');
    OM().toggleOpen(door);
    ok(!G().isCellBlocked(grid, 1, 1, tsMap), 'porta aperta: non blocca');
    ok(G().isCellBlocked(grid, 2, 2, tsMap) && !G().isCellBlocked(grid, 4, 4, tsMap), 'gli altri solo con "Blocca il movimento"');
    ok(G().isCellBlocked(grid, 3, 3, tsMap) && G().isCellBlocked(grid, 5, 5, tsMap) && !G().isCellBlocked(grid, 6, 6, tsMap), 'tile Bloccante e cella forzata');
    ok(!G().isCellBlocked(Object.assign({}, grid, { ignoreCollisions: true }), 3, 3, tsMap), 'Ignora collisioni');
  });

  // --- Oggetti di mappa ---
  test('Oggetti di mappa: stato e contenuto indipendenti tra le copie, serrature e trappole', () => {
    const tpl = DnD.dati.normalizeMapObject({ id: 'f', name: 'Forziere', otype: 'forziere', lock: { locked: true, dcPick: 15, dcForce: 18 },
      contents: [{ equipmentId: 'eq-pugnale', qty: 2 }], coins: { mo: 10 } });
    const a = OM().instantiate(tpl, 'a');
    const b = OM().instantiate(tpl, 'b');
    eq([a.sourceId, a.id, b.id], ['f', 'a', 'b']);
    eq(OM().toggleOpen(a, false), { ok: false, text: 'Forziere è chiuso a chiave.' });
    eq(OM().pickLock(a, 3, seq(11), 'Aria').success, false, '11 + 3 < 15');
    const r = OM().pickLock(a, 3, seq(12), 'Aria');
    eq([r.success, a.lock.locked, b.lock.locked], [true, false, true], 'la serratura dell\'altra copia resta chiusa');
    OM().toggleOpen(a);
    const inv = [];
    const purse = ATT().normalizeCoins({});
    eq(OM().take(a, 0, 1, inv), 1);
    eq([a.contents[0].qty, b.contents[0].qty, inv], [1, 2, [{ id: inv[0].id, equipmentId: 'eq-pugnale', qty: 1, equipped: false }]], 'contenuti separati');
    OM().takeAll(a, inv, purse);
    eq([OM().isEmpty(a), OM().isEmpty(b), inv[0].qty, purse.mo, tpl.coins.mo], [true, false, 2, 10, 10], 'il modello resta pieno');
    eq(OM().forceOpen(b, 2, seq(16), 'Bruto').success, true, 'sfondare: FOR contro CD 18');
    eq(b.state, 'aperto');
    const trap = OM().instantiate(DnD.dati.normalizeMapObject({ name: 'Lame', otype: 'trappola', trap: { effect: { kind: 'salvezza', dice: '2d10', type: 'tagliente', ability: 'DES', dc: 13 } } }), 't');
    const hit = OM().triggerTrap(trap, { name: 'Aria', saves: { DES: 2 } }, seq(4, 6, 15));
    eq([hit.amount, trap.trap.armed], [5, false], 'riesce: metà danni; non riattivabile si disarma');
    eq(OM().triggerTrap(trap, { name: 'Aria', saves: {} }, seq()).amount, 0, 'disinnescata');
    eq(OM().disarmTrap(OM().instantiate(DnD.dati.normalizeMapObject({ otype: 'trappola' }), 'x'), 0, seq(15), 'Ladro').success, true);
    const ground = OM().groundItem(ATT().defaults()[0], 'g');
    eq([ground.otype, ground.contents], ['a-terra', [{ equipmentId: ATT().defaults()[0].id, qty: 1 }]], 'oggetto dell\'Attrezzatura a terra');
  });

  // --- Migrazione alla versione 8 ---
  test('Migrazione: nemici, oggetti, griglie e strutture della versione 7', () => {
    const ts = lTileset();
    const raw = {
      version: 7, races: [], players: [{ id: 'p', name: 'Aria' }],
      npcs: [{ id: 'gob', name: 'Goblin', maxHp: 7 }],
      tilesets: [ts],
      structures: [{ id: 'casa', name: 'Casa', mode: 'tiles', tiles: Object.assign(TM().imageTiles(ts, 0, '100100111', {}), { sel: '100100111' }) }],
      items: [{ id: 'spada', name: 'Spada magica', type: 'arma', value: '50 mo', quantity: 1 }, { id: 'tesoro', name: 'Gemme', type: 'tesoro', value: 'molto', quantity: 3, blocks: true }],
      savedGrids: [{ id: 'g', name: 'Cripta', items: [{ id: 'x', sourceId: 'spada', name: 'Spada magica', x: 3, y: 4 }, { id: 'y', sourceId: 'tesoro', name: 'Gemme', x: 1, y: 1, blocks: true }],
        tileMap: Object.assign(TM().newTiles('mappa', 30, 20), { tilesets: [ts.id] }) }],
      sessions: [{ id: 's', name: 'S', combat: { combatants: [{ id: 'c', name: 'Goblin', size: 2, pos: { x: 1, y: 1 } }], grid: {} } }],
    };
    const s = DnD.dati.importJSON(JSON.stringify(raw));
    eq(s.version, DnD.dati.VERSION);
    const gob = s.npcs.find((n) => n.id === 'gob');
    eq([gob.type, gob.maxHp, gob.gridSize.auto], ['standard', 7, true], 'nemico esistente: Standard, Automatica');
    eq(s.npcs.filter((n) => n.type === 'creatura').length, 3, 'creature d\'esempio aggiunte');
    eq([s.players[0].inventory, s.players[0].gridSize.auto], [[], true]);
    const spada = s.equipment.find((e) => e.id === 'spada');
    eq([spada.category, spada.cost], ['armi', { amount: 50, unit: 'mo' }], 'Oggetto → Attrezzatura (arma → Armi)');
    eq([s.equipment.find((e) => e.id === 'tesoro').category, /Valore: molto/.test(s.equipment.find((e) => e.id === 'tesoro').description)], ['tesori', true]);
    ok(s.equipment.some((e) => e.id === 'eq-spada-lunga'), 'catalogo base aggiunto');
    const [ground, gems] = s.savedGrids[0].items;
    eq([ground.otype, ground.contents, ground.sourceId, ground.x, ground.y], ['a-terra', [{ equipmentId: 'spada', qty: 1 }], '', 3, 4], 'copia piazzata → oggetto a terra');
    eq([gems.otype, gems.sourceId, gems.blocks, s.mapObjects.some((o) => o.id === 'tesoro-m')], ['altro', 'tesoro-m', true, true], 'oggetto bloccante → modello di oggetto di mappa');
    eq([s.savedGrids[0].w, s.savedGrids[0].h, s.savedGrids[0].background, s.savedGrids[0].tileMap.w, s.savedGrids[0].tileMap.h], [50, 50, null, 50, 50], 'griglie 50×50, senza sfondo, TileMap portata a 50×50');
    eq([s.structures[0].tiles.kind, s.structures[0].tiles.sel, s.structures[0].tiles.mask], ['immagine', '100100111', '100100111'], 'struttura da immagine: celle selezionate mantenute');
    const c = s.sessions[0].combat.combatants[0];
    eq([c.w, c.h, c.pos], [2, 2, { x: 1, y: 1 }], 'pedina del combattimento: size → w×h');
    ok(!('items' in s), 'niente più "items"');
    eq(DnD.dati.importJSON(DnD.dati.exportJSON(s)), s, 'dopo la migrazione il formato è stabile');
  });

  test('Esportazione e importazione: creature, attrezzatura, oggetti di mappa, sfondi e immagini', () => {
    const st = DnD.dati.emptyState();
    const sess = S().current(st);
    const bgId = IMG().imageId(PNG);
    st.worldNpcs = []; // senza il mercante d'esempio: nel file solo l'attrezzatura di inventario e oggetti
    const drago = st.npcs.find((n) => n.id === 'esempio-drago-cenere');
    drago.innate.spells.push({ spellId: st.spells[0].id, freq: 'volonta', uses: 1 });
    const p = DnD.dati.normalizeCreature({ id: 'p', name: 'Aria', inventory: [{ equipmentId: 'eq-pugnale', qty: 1 }] }, true);
    st.players.push(Object.assign(p, { sessionId: sess.id }));
    st.savedGrids.push(Object.assign(DnD.dati.normalizeSavedGrid({ id: 'g', name: 'Mappa', w: 20, h: 20, background: { kind: 'immagine', imageId: bgId },
      items: [Object.assign(OM().instantiate(st.mapObjects[0], 'f'), { x: 1, y: 1, contents: [{ equipmentId: 'eq-spada-lunga', qty: 1 }] })] }), { sessionId: sess.id }));
    eq(IMG().referencedIds(st), [bgId], 'immagine dello sfondo inclusa nell\'archivio');
    const file = JSON.parse(JSON.stringify(S().exportSession(st, sess.id, { [bgId]: PNG })));
    eq([file.npcs.some((n) => n.type === 'creatura'), file.mapObjects.map((o) => o.id), file.equipment.map((e) => e.id).sort(), file.spells.map((x) => x.id), IMG().referencedIds(file)],
      [true, [st.mapObjects[0].id], ['eq-pugnale', 'eq-spada-lunga'], [st.spells[0].id], [bgId]]);
    const dst = DnD.dati.emptyState();
    dst.equipment = [];
    dst.mapObjects = [];
    const imported = S().importSession(dst, file, DnD.dadi.uid);
    eq([dst.equipment.length, dst.mapObjects.length, dst.savedGrids[0].background.imageId, dst.players[0].inventory[0].equipmentId], [2, 1, bgId, 'eq-pugnale']);
    ok(imported.id);
    const again = DnD.dati.importJSON(DnD.dati.exportJSON(st, { [bgId]: PNG }));
    eq([again.equipment.length, again.mapObjects.length, again.npcs.filter((n) => n.type === 'creatura').length], [st.equipment.length, st.mapObjects.length, 3], 'archivio completo');
    // File di una sessione della versione 7 (con Oggetti): migrato all'importazione.
    const old = { kind: 'sessione', version: 7, session: { name: 'Vecchia' }, npcs: [{ id: 'o', name: 'Orco' }], players: [], savedGrids: [{ id: 'gg', name: 'G', items: [{ sourceId: 'it', name: 'Corda', x: 0, y: 0 }] }],
      items: [{ id: 'it', name: 'Corda', type: 'altro' }], races: [], spells: [], structures: [], tilesets: [] };
    const dst2 = DnD.dati.emptyState();
    S().importSession(dst2, old, DnD.dadi.uid);
    eq([dst2.equipment.some((e) => e.id === 'it'), dst2.savedGrids[0].items[0].otype, dst2.npcs.find((n) => n.name === 'Orco').type], [true, 'a-terra', 'standard']);
  });

  test('Validazione: creature, attrezzatura, oggetti di mappa e proprietà della griglia', () => {
    const c = ex('esempio-sentinella-bronzo');
    eq(DnD.validazione.validateMonster(c), {});
    c.actions[0].mech.parts = [{ actionId: 'sparita', count: 1 }];
    ok(DnD.validazione.validateMonster(c)['actions.0.parts'], 'multiattacco con un\'azione inesistente');
    eq(DnD.validazione.validateEquipment(ATT().normalizeEquipment({ name: 'Ascia', category: 'armi', weapon: { dice: '1d6' } })), {});
    ok(DnD.validazione.validateEquipment(Object.assign(ATT().normalizeEquipment({ name: 'X', category: 'armi' }), { weight: -1 })).weight);
    eq(DnD.validazione.validateMapObject(DnD.dati.normalizeMapObject({ name: 'Porta', otype: 'porta' })), {});
    eq(DnD.validazione.validateGridProps({ name: 'Torre', w: 20, h: 30, feetPerCell: 5 }), {});
  });

  // ======================= Note del master =======================
  const NT = () => DnD.note;
  const hasDom = () => typeof document !== 'undefined' && typeof document.createRange === 'function' && Boolean(DnD.noteEditor);
  // Editor montato in un contenitore temporaneo; cleanup() lo smonta.
  function mountEditor(html) {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const changes = [];
    const ed = DnD.noteEditor.create({ html, onChange: (h) => changes.push(h) });
    box.appendChild(ed.node);
    return { ed, area: ed.area, changes, cleanup: () => { ed.destroy(); box.remove(); } };
  }
  function selectText(node, start, end) {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end === undefined ? start : end);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  const caretAt = (el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };

  test('Note: sanificazione dell\'HTML (whitelist di tag e stili)', () => {
    const S = NT().sanitizeHtml;
    eq(S('<p onclick="x()">Ciao <b>mondo</b></p><script>alert(1)</script>'), '<p>Ciao <b>mondo</b></p>', 'script e gestori di eventi');
    eq(S('<a href="javascript:alert(1)">link</a><img src="http://x/y.png" onerror="z()">'), 'link', 'link javascript: e immagini esterne');
    eq(S('<SCRIPT>bad()</SCRIPT><Style>p{}</Style><iframe src="x">t</iframe><svg><text>s</text></svg>ok'), 'ok', 'contenuti pericolosi scartati');
    eq(S('<span style="color: #d4453a; position: fixed; background-image: url(x); font-size: 20px; background-color: url(x)">c</span>'),
      '<span style="color: #d4453a; font-size: 20px">c</span>', 'solo gli stili ammessi');
    eq(S('<td style="width: 120px; text-align: center; font-weight: bold; expression(alert)">x</td>'), '<td style="width: 120px; text-align: center; font-weight: bold">x</td>');
    eq(S('<p style="color: javascript:alert(1)">x</p>'), '<p>x</p>');
    eq(S('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><hr><ul><li>x</li></ul>'),
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><hr><ul><li>x</li></ul>', 'tabelle, linee ed elenchi');
    eq(S('<p>a &amp; b &lt; c & d <!-- commento --></p>'), '<p>a &amp; b &lt; c &amp; d </p>', 'entità e commenti');
    eq(S('<p><b>non chiuso'), '<p><b>non chiuso</b></p>', 'tag chiusi in fondo');
    eq(S('<div class="x" id="y" data-a="1"><font color="red">f</font><u>u</u><s>s</s><blockquote>q</blockquote></div>'),
      '<div>f<u>u</u><s>s</s><blockquote>q</blockquote></div>', 'attributi tolti, tag sconosciuti sciolti');
    eq(S('<p>1 < 2 > 0</p>'), '<p>1 &lt; 2 &gt; 0</p>');
    eq(S('<p style="color:red !important;font-size:12px">r</p>'), '<p style="color: red; font-size: 12px">r</p>');
    eq(S(null), '');
  });

  test('Note: testo semplice, conteggio parole, dimensione', () => {
    eq(NT().htmlToText('<h1>Titolo</h1><p>Uno <b>due</b></p><ul><li>tre</li></ul><table><tr><td>a</td><td>b</td></tr></table>'), 'Titolo\nUno due\n• tre\n\na\tb');
    eq(NT().wordCount('<p>Il drago &amp; la principessa</p><p>12 monete</p>'), 6, 'la «&» non è una parola');
    eq(NT().wordCount('<p><br></p>'), 0);
    eq(NT().textToHtml('a < b\n\n<i>x</i>'), '<p>a &lt; b</p><p><br></p><p>&lt;i&gt;x&lt;/i&gt;</p>', 'incolla come testo semplice');
    eq(NT().byteSize('è'), 2);
    ok(NT().tooLarge('x'.repeat(NT().MAX_BYTES + 1)) && !NT().tooLarge('x'.repeat(1000)), 'limite di 500 KB');
    eq([NT().FONT_SIZES, NT().COLORS.length], [[10, 12, 14, 16, 20, 24, 32, 48], 12]);
  });

  test('Note: pagine (nuova, rinomina, duplica, elimina, riordina)', () => {
    const pages = [];
    const a = NT().addPage(pages, '', 'a');
    eq(a.name, 'Appunti', 'pagina predefinita');
    eq(NT().addPage(pages, 'Appunti', 'b').name, 'Appunti (2)', 'nomi unici');
    NT().renamePage(pages, 'b', 'PNG della taverna');
    const c = NT().duplicatePage(pages, 'a', 'c');
    eq(pages.map((p) => p.name), ['Appunti', 'Appunti (copia)', 'PNG della taverna']);
    ok(c && NT().movePage(pages, 'b', -1) && !NT().movePage(pages, 'b', -5));
    eq(pages.map((p) => p.id), ['a', 'b', 'c']);
    eq(NT().removePage(pages, 'b').id, 'c', 'dopo l\'eliminazione si passa alla successiva');
    eq(NT().normalizePages([{ id: 'x', name: '', html: '<p onclick="a()">t</p>' }, { id: 'x' }]), [{ id: 'x', name: 'Pagina', html: '<p>t</p>', updatedAt: null }], 'sanificate al caricamento, id unici');
  });

  test('Note: salvataggio automatico con debounce, alla chiusura ed errore', async () => {
    const timers = [];
    const saved = [];
    const statuses = [];
    let fail = false;
    const as = NT().createAutosave({
      delay: 500, onStatus: (s) => statuses.push(s),
      save: async (v) => { if (fail) return { ok: false, message: 'spazio esaurito' }; saved.push(v); return { ok: true }; },
      setTimer: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length - 1; },
      clearTimer: (i) => { timers[i].on = false; },
    });
    as.change('a');
    as.change('ab');
    as.change('abc');
    eq([timers.filter((t) => t.on).length, timers[2].ms, saved], [1, 500, []], 'una sola attesa di 500 ms, niente ancora salvato');
    await timers[2].fn();
    eq(saved, ['abc'], 'salvata solo l\'ultima versione');
    as.change('abcd');
    await as.flush();
    eq([saved, as.pending(), statuses[statuses.length - 1]], [['abc', 'abcd'], false, 'salvato'], 'alla chiusura si salva subito');
    fail = true;
    as.change('troppo');
    await as.flush();
    eq([as.pending(), statuses[statuses.length - 1], saved.length], [true, 'errore', 2], 'quota piena: non risulta salvato e resta in sospeso');
    fail = false;
    await as.flush();
    eq([saved[2], as.pending()], ['troppo', false], 'salvato al tentativo successivo');
  });

  test('Note: per sessione, duplicazione, esportazione e importazione (mai nelle griglie)', () => {
    const st = DnD.dati.emptyState();
    const s1 = S().current(st);
    eq(s1.pages, [], 'sessione nuova senza pagine');
    s1.pages.push({ id: 'p1', name: 'Appunti', html: '<p>Il <b>lich</b> è al piano 3</p>', updatedAt: null });
    const s2 = S().addSession(st, 'Altra', () => 's2');
    eq(s2.pages, [], 'ogni sessione ha le sue note');
    const dup = S().duplicateSession(st, s1.id, 'Copia', DnD.dadi.uid);
    dup.pages[0].html = '<p>cambiata</p>';
    eq([dup.pages.length, s1.pages[0].html], [1, '<p>Il <b>lich</b> è al piano 3</p>'], 'duplicate e indipendenti');
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(st));
    eq(back.sessions.find((x) => x.id === s1.id).pages[0].html, '<p>Il <b>lich</b> è al piano 3</p>', 'archivio completo');
    const file = JSON.parse(JSON.stringify(S().exportSession(st, s1.id, {})));
    file.session.pages[0].html += '<script>alert(1)</script><p onmouseover="x()">ok</p>';
    const dst = DnD.dati.emptyState();
    const imp = S().importSession(dst, file, DnD.dadi.uid);
    eq(imp.pages[0].html, '<p>Il <b>lich</b> è al piano 3</p><p>ok</p>', 'singola sessione, sanificata all\'importazione');
    s1.combat = { combatants: [], grid: { structures: [], items: [], labels: [], zones: [], tileMap: null } };
    ok(!('pages' in G().createSavedGrid(s1.combat, 'G', 'g', null)) && !JSON.stringify(G().createSavedGrid(s1.combat, 'G', 'g', null)).includes('lich'), 'mai esportate con la griglia');
  });

  test('Editor delle note: grandezza e colore del testo (Range)', () => {
    if (!hasDom()) return;
    const { ed, area, cleanup } = mountEditor('<p>Il drago rosso</p>');
    const t = area.querySelector('p').firstChild;
    selectText(t, 3, 8);
    ed.fontSize(20);
    const span = area.querySelector('span');
    eq([span.textContent, span.style.fontSize], ['drago', '20px']);
    ed.color('#d4453a');
    const colored = [...area.querySelectorAll('span')].find((x) => x.style.color);
    eq([Boolean(colored), colored && colored.textContent], [true, 'drago'], 'colore applicato alla selezione');
    ed.stepSize(1);
    eq(area.querySelector('span[style*="font-size"]').style.fontSize, '24px', 'A+ passa al valore successivo');
    ed.color(null);
    ok(![...area.querySelectorAll('span')].some((s) => s.style.color), '«Predefinito» toglie il colore (segue il tema)');
    ok(ed.getHtml().includes('font-size: 24px') && ed.getHtml().includes('drago'), 'HTML salvabile e sanificato');
    ed.undo();
    ok(area.querySelector('span').style.color, 'annulla proprio');
    ed.redo();
    ok(!area.querySelector('span').style.color, 'ripeti');
    cleanup();
  });

  test('Editor delle note: elenchi puntati e numerati con rientro', () => {
    if (!hasDom()) return;
    const { ed, area, cleanup } = mountEditor('<p>uno</p><p>due</p><p>tre</p>');
    const ps = area.querySelectorAll('p');
    const r = document.createRange();
    r.setStart(ps[0].firstChild, 0);
    r.setEnd(ps[2].firstChild, 3);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    ed.toggleList('ul');
    eq(area.innerHTML, '<ul><li>uno</li><li>due</li><li>tre</li></ul>', 'tre paragrafi diventano un elenco');
    caretAt(area.querySelectorAll('li')[1]);
    ed.indent(false);
    eq(area.innerHTML, '<ul><li>uno<ul><li>due</li></ul></li><li>tre</li></ul>', 'Tab: rientro (sotto-elenco)');
    caretAt(area.querySelector('li li'));
    ed.indent(true);
    eq(area.innerHTML, '<ul><li>uno</li><li>due</li><li>tre</li></ul>', 'Maiusc+Tab: rientro ridotto');
    caretAt(area.querySelectorAll('li')[2]);
    ed.toggleList('ol');
    eq(area.innerHTML, '<ol><li>uno</li><li>due</li><li>tre</li></ol>', 'puntato → numerato');
    caretAt(area.querySelectorAll('li')[1]);
    ed.toggleList('ol');
    eq(area.innerHTML, '<ol><li>uno</li></ol><p>due</p><ol><li>tre</li></ol>', 'togliere l\'elenco da una voce divide la lista');
    caretAt(area.querySelectorAll('li')[1]);
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    cleanup();
  });

  test('Editor delle note: tabelle (inserimento, righe, colonne, intestazione, Tab nell\'ultima cella)', () => {
    if (!hasDom()) return;
    const { ed, area, cleanup } = mountEditor('<p><br></p>');
    caretAt(area.querySelector('p'));
    ed.insertTable(2, 3);
    const table = () => area.querySelector('table');
    const shape = () => [...table().querySelectorAll('tr')].map((tr) => tr.children.length);
    eq([shape(), area.lastChild.nodeName], [[3, 3], 'P'], 'tabella 2×3 con un paragrafo dopo');
    caretAt(table().querySelectorAll('td')[0]);
    ed.tableCommand('riga-sotto');
    ed.tableCommand('riga-sopra');
    eq(shape(), [3, 3, 3, 3], 'righe sopra e sotto');
    caretAt(table().querySelectorAll('td')[0]);
    ed.tableCommand('colonna-destra');
    ed.tableCommand('colonna-sinistra');
    eq(shape(), [5, 5, 5, 5], 'colonne a destra e a sinistra');
    caretAt(table().querySelectorAll('td')[0]);
    ed.tableCommand('intestazione');
    eq([table().tHead.rows[0].children[0].nodeName, table().tBodies[0].rows.length], ['TH', 3], 'riga di intestazione');
    ed.tableCommand('elimina-colonna');
    ed.tableCommand('elimina-riga');
    eq(shape(), [4, 4, 4], 'eliminazione di riga e colonna');
    const cells = table().querySelectorAll('td');
    caretAt(cells[cells.length - 1]);
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    eq(shape(), [4, 4, 4, 4], 'Tab nell\'ultima cella aggiunge una riga');
    caretAt(table().querySelector('td'));
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    area.dispatchEvent(ev);
    ok(ev.defaultPrevented && window.getSelection().anchorNode && (window.getSelection().anchorNode.closest ? window.getSelection().anchorNode : window.getSelection().anchorNode.parentNode).closest('td') === table().querySelectorAll('td')[1], 'Tab passa alla cella successiva');
    ok(NT().sanitizeHtml(area.innerHTML) === ed.getHtml().replace(/​/g, ''), 'tabella conservata dalla sanificazione');
    ed.tableCommand('elimina-tabella');
    ok(!table(), 'eliminazione della tabella');
    cleanup();
  });

  test('Editor delle note: incolla sanificato e scorciatoie solo dentro l\'editor', () => {
    if (!hasDom()) return;
    const { ed, area, cleanup } = mountEditor('<p>x</p>');
    caretAt(area.querySelector('p'));
    ed.insertHtml('<b onclick="a()">ok</b><img src="http://evil/x.png"><script>bad()</script>');
    ok(!area.querySelector('img, script, [onclick]') && area.querySelector('b').textContent === 'ok', 'incolla: niente immagini, script o gestori');
    eq([DnD.ui.shortcutsBlocked({ target: area }), DnD.ui.shortcutsBlocked({ target: area.querySelector('p') }), DnD.ui.shortcutsBlocked({ target: document.body })],
      [true, true, false], 'scorciatoie globali disattivate nell\'editor e attive fuori');
    const z = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    area.dispatchEvent(z);
    ok(z.defaultPrevented, 'Ctrl+Z gestito dall\'editor');
    cleanup();
  });

  test('Pannello delle note: pulsante, Alt+N, Esc, prima scrittura, salvataggio ed errore di quota', async () => {
    if (!hasDom() || !DnD.uiNote) return;
    const backend = fakeBackend();
    const mem = {};
    const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    const store = await DnD.dati.openStore(storage, { backend });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const timers = [];
    const panel = DnD.uiNote.create({ host, storage, store: () => store, closed: true,
      setTimer: (fn) => { timers.push(fn); return timers.length - 1; }, clearTimer: (i) => { timers[i] = null; } });
    try {
      ok(!panel.isOpen() && panel.panel.hidden && panel.panel.getAttribute('role') === 'complementary', 'chiuso all\'inizio, ruolo complementary');
      panel.fab.click();
      eq([panel.isOpen(), panel.fab.getAttribute('aria-pressed'), panel.panel.hidden], [true, 'true', false], 'aperto con il pulsante');
      panel.fab.click();
      ok(!panel.isOpen(), 'secondo clic: chiuso');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', altKey: true, bubbles: true }));
      ok(panel.isOpen(), 'Alt+N apre');
      const area = panel.editor().area;
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ok(!panel.isOpen(), 'Esc chiude');
      eq(DnD.sessioni.current(store.state).pages, [], 'nessuna pagina finché non si scrive');
      panel.open();
      area.innerHTML = '<p>Ricordare la trappola</p>';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      ok(timers.some(Boolean), 'salvataggio rimandato (debounce)');
      eq(panel.status(), 'modificato');
      panel.close();
      await panel.flush();
      await store.saved();
      const pages = DnD.sessioni.current(store.state).pages;
      eq([pages.length, pages[0].name, pages[0].html, panel.status()], [1, 'Appunti', '<p>Ricordare la trappola</p>', 'salvato'], 'pagina «Appunti» creata alla prima scrittura e salvata alla chiusura');
      ok(JSON.parse(await backend.get('stato')).sessions[0].pages[0].html.includes('trappola'), 'scritta davvero nell\'archivio');
      // Spazio esaurito: il testo non risulta salvato.
      const realSet = backend.set;
      backend.set = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return Promise.reject(e); };
      panel.open();
      area.innerHTML = '<p>Nuovo testo</p>';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      await panel.flush();
      eq(panel.status(), 'errore', 'errore di quota: non dichiarato salvato');
      ok(/spazio di archiviazione/.test(panel.panel.querySelector('.notes-status').textContent), 'messaggio chiaro');
      backend.set = realSet;
      await panel.flush();
      eq(panel.status(), 'salvato', 'riprova riuscita');
      // Nota troppo grande: avviso e niente salvataggio.
      area.innerHTML = '<p>' + 'x'.repeat(NT().MAX_BYTES + 10) + '</p>';
      area.dispatchEvent(new Event('input', { bubbles: true }));
      await panel.flush();
      ok(panel.status() === 'errore' && /500 KB/.test(panel.panel.textContent), 'limite di 500 KB con avviso');
    } finally {
      panel.destroy();
      host.remove();
    }
  });

  // ======================= Combattimento simulato (IA) =======================
  const IA = () => DnD.ia;
  const AXE = { id: 'w1', name: 'Ascia', toHit: 5, damageDice: '1d8', damageBonus: 3, damageType: 'tagliente' };
  const mkC = (o) => DnD.dati.normalizeCombatant(Object.assign({
    kind: 'npc', maxHp: 20, hp: 20, ac: 12, speed: 9, initiative: 10,
    abilities: { FOR: 16, DES: 10, COS: 12, INT: 8, SAG: 10, CAR: 8 }, weapons: [AXE],
  }, o));
  const mkHero = (o) => mkC(Object.assign({ kind: 'player', abilities: { FOR: 12, DES: 12, COS: 12, INT: 10, SAG: 10, CAR: 10 } }, o));
  const wallAt = (id, x, y, w, h) => Object.assign({ id, name: 'Muro', x, y }, G().shapeFrom(w, h, () => true));
  const aiState = (combatants, extra) => Object.assign({
    combatants, grid: { w: 20, h: 20, structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false },
    catalog: DnD.attrezzatura.defaults(), tilesets: {}, round: 1, seed: 1,
  }, extra);
  const plan = (st, id, o) => IA().pianificaTurno(st, st.combatants.find((c) => c.id === id), Object.assign({ timeLimit: 5000 }, o));

  test('IA: archetipo automatico dalla caratteristica più alta, con parità', () => {
    const cat = DnD.attrezzatura.defaults();
    const bow = { id: 'b', name: 'Arco lungo', equipmentId: 'eq-arco-lungo', toHit: 4, damageDice: '1d8', damageBonus: 2 };
    const ab = (o) => Object.assign({ FOR: 10, DES: 10, COS: 10, INT: 10, SAG: 10, CAR: 10 }, o);
    eq(IA().archetypeOf(mkC({ abilities: ab({ SAG: 17 }) }), cat), 'SAG');
    eq(IA().archetypeOf(mkC({ abilities: ab({ FOR: 14, DES: 14 }), weapons: [AXE] }), cat), 'FOR', 'parità: vince l\'ordine FOR, DES…');
    eq(IA().archetypeOf(mkC({ abilities: ab({ FOR: 14, DES: 14 }), weapons: [bow] }), cat), 'DES', 'parità con un arco: vince DES');
    eq(IA().archetypeOf(mkC({ abilities: ab({ COS: 15, CAR: 15 }), weapons: [bow] }), cat), 'COS', 'l\'arma conta solo se è tra le pari');
    eq(IA().archetypeOf(mkC({ abilities: ab({ FOR: 18 }), behavior: { archetype: 'CAR' } }), cat), 'CAR', 'scelta manuale');
    // Valori finali: bonus razziali e punti assegnati inclusi.
    const race = DnD.dati.normalizeRace({ id: 'r', name: 'Elfo', bonuses: DnD.dati.makeBonuses({ DES: 2 }) });
    race.bonuses.DES.apply = true;
    const npc = DnD.dati.normalizeCreature({ id: 'n', name: 'Esploratore', raceId: 'r', abilities: ab({ FOR: 14, DES: 13 }) });
    const [c] = DnD.combattenti.createCombatants([], [{ npc, quantity: 1 }], [race], () => 10);
    eq([c.abilities.DES, IA().archetypeOf(c, cat), c.control, c.faction], [15, 'DES', 'ia', 'nemici'], 'DES 13 + 2 razziale = 15');
    eq(DnD.dati.normalizeCreature({ name: 'Vecchio' }).behavior, IA().normalizeBehavior(), 'nemici esistenti: Aggressivo, Automatico');
    eq(IA().normalizeBehavior().temperament + '/' + IA().normalizeBehavior().archetype, 'aggressivo/auto');
    ok(/Orco, aggressivo, FOR.*attacca da vicino il bersaglio più vicino/.test(IA().describe('Orco', {}, 'FOR', false)), 'anteprima nel form');
  });

  test('IA: punteggi di debolezza e minaccia', () => {
    const orc = mkC({ id: 'o', pos: { x: 0, y: 0 } });
    const weak = mkHero({ id: 'a', hp: 4, ac: 11, classId: 'mago', pos: { x: 10, y: 10 } });
    const tough = mkHero({ id: 'b', hp: 40, maxHp: 40, ac: 18, pos: { x: 5, y: 5 } });
    const all = [orc, weak, tough];
    ok(IA().weakness(weak, orc, all, 'tagliente').score > IA().weakness(tough, orc, all, 'tagliente').score, 'PF e CA bassi, incantatore, isolato');
    const vuln = mkHero({ id: 'v', hp: 40, maxHp: 40, ac: 18, pos: { x: 5, y: 6 }, defenses: { vuln: ['tagliente'], res: [], imm: [] } });
    eq(IA().weakness(vuln, orc, all.concat(vuln), 'tagliente').terms.vulnerable, 1, 'vulnerabile al danno dell\'arma');
    const big = mkHero({ id: 'g', level: 9, maxHp: 80, hp: 80, weapons: [{ id: 's', name: 'Spadone', toHit: 8, damageDice: '2d6', damageBonus: 5 }] });
    ok(IA().threat(big, []).score > IA().threat(weak, []).score && IA().threat(big, []).dpr > 0, 'minaccia: danno per round, livello, PF');
  });

  test('IA: Aggressivo = il più vicino per percorso (non in linea d\'aria); Furbo = il più debole', () => {
    const orc = mkC({ id: 'o', name: 'Orco 1', pos: { x: 5, y: 5 } });
    const a = mkHero({ id: 'a', name: 'Mira', hp: 3, pos: { x: 8, y: 5 } });   // a 3 caselle in linea d'aria, ma dietro il muro
    const b = mkHero({ id: 'b', name: 'Bran', pos: { x: 5, y: 12 } });         // a 7 caselle, percorso libero
    const st = aiState([orc, a, b]);
    st.grid.structures.push(wallAt('w', 7, 0, 1, 19));
    const p = plan(st, 'o');
    eq([p.action.targetIds, /più vicino/.test(p.reason)], [['b'], true], p.reason);
    const sly = mkC({ id: 's', name: 'Orco furbo', pos: { x: 5, y: 5 }, behavior: { temperament: 'furbo' } });
    const strong = mkHero({ id: 'f', name: 'Forte', hp: 40, maxHp: 40, ac: 18, pos: { x: 6, y: 5 } });
    const frail = mkHero({ id: 'd', name: 'Debole', hp: 3, ac: 11, pos: { x: 10, y: 9 } });
    const p2 = plan(aiState([sly, strong, frail]), 's');
    eq([p2.action.targetIds, /più debole/.test(p2.reason)], [['d'], true], 'Furbo: il più debole, anche se più lontano. ' + p2.reason);
    eq(plan(aiState([mkC({ id: 's', name: 'Orco', pos: { x: 5, y: 5 } }), strong, frail]), 's').action.targetIds, ['f'], 'Aggressivo nello stesso caso: il più vicino');
  });

  test('IA: DES resta a distanza con un\'arma a distanza, senza avanza come FOR', () => {
    const bow = { id: 'b', name: 'Arco lungo', equipmentId: 'eq-arco-lungo', toHit: 6, damageDice: '1d8', damageBonus: 3, damageType: 'perforante' };
    const archer = mkC({ id: 'x', name: 'Arciere', abilities: { FOR: 10, DES: 17, COS: 10, INT: 10, SAG: 10, CAR: 10 }, weapons: [bow], pos: { x: 2, y: 2 } });
    const hero = mkHero({ id: 'h', name: 'Bran', pos: { x: 8, y: 2 } });
    const p = plan(aiState([archer, hero]), 'x');
    const end = p.path[p.path.length - 1];
    eq([p.action.kind, p.action.ranged, G().tokenDistance({ pos: end, w: 1, h: 1 }, hero) > 1], ['arma', true, true], p.reason);
    // Qualcuno si avvicina: si riposiziona per non tirare con svantaggio.
    hero.pos = { x: 3, y: 2 };
    const p2 = plan(aiState([archer, hero]), 'x');
    const end2 = p2.path[p2.path.length - 1];
    eq([p2.action.mode, G().tokenDistance({ pos: end2, w: 1, h: 1 }, hero) > 1], ['normale', true], 'si allontana prima di tirare');
    const melee = mkC({ id: 'y', name: 'Lama', abilities: { FOR: 10, DES: 17, COS: 10, INT: 10, SAG: 10, CAR: 10 }, weapons: [AXE], pos: { x: 2, y: 2 } });
    const p3 = plan(aiState([melee, mkHero({ id: 'h', name: 'Bran', pos: { x: 8, y: 2 } })]), 'y');
    eq([p3.archetype, p3.action.ranged, p3.path.length > 1], ['DES', false, true], 'solo mischia: avanza e attacca da vicino');
  });

  test('IA: svantaggio a distanza con un nemico adiacente; danno atteso con resistenza', () => {
    const bow = { id: 'b', name: 'Arco lungo', equipmentId: 'eq-arco-lungo', toHit: 6, damageDice: '1d8', damageBonus: 3, damageType: 'perforante' };
    const stuck = mkC({ id: 'x', name: 'Arciere', speed: 0, abilities: { FOR: 8, DES: 17, COS: 10, INT: 10, SAG: 10, CAR: 10 }, weapons: [bow], pos: { x: 2, y: 2 } });
    const p = plan(aiState([stuck, mkHero({ id: 'h', name: 'Bran', pos: { x: 3, y: 2 } })]), 'x');
    eq([p.action.mode, /svantaggio/.test(p.reason)], ['svantaggio', true], p.reason);
    const fire = { id: 'f', name: 'Torcia', toHit: 5, damageDice: '1d4', damageBonus: 0, damageType: 'fuoco' };
    const big = { id: 'g', name: 'Mazza', toHit: 5, damageDice: '1d8', damageBonus: 3, damageType: 'contundente' };
    const brute = mkC({ id: 'z', weapons: [big, fire], pos: { x: 2, y: 2 } });
    const golem = mkHero({ id: 'g1', name: 'Golem', pos: { x: 3, y: 2 }, defenses: { vuln: ['fuoco'], res: [], imm: ['contundente'] } });
    eq(plan(aiState([brute, golem]), 'z').action.id, 'f', 'immune al contundente, vulnerabile al fuoco: usa la torcia');
    const opts = IA().weaponOptions(brute, big, []);
    eq(IA().expectedDamage(opts[0], mkHero({ ac: 12, defenses: { vuln: [], res: ['contundente'], imm: [] } }), false) < IA().expectedDamage(opts[0], mkHero({ ac: 12 }), false), true, 'resistenza: danno atteso dimezzato');
  });

  test('IA: COS si mette tra l\'alleato fragile e il nemico; INT sul più forte; SAG sugli incantatori', () => {
    const shield = mkC({ id: 's', name: 'Scudo', abilities: { FOR: 12, DES: 10, COS: 17, INT: 8, SAG: 10, CAR: 8 }, pos: { x: 6, y: 10 } });
    const mage = mkC({ id: 'm', name: 'Sciamano', hp: 4, pos: { x: 10, y: 10 } });
    const foe = mkHero({ id: 'f', name: 'Bran', pos: { x: 15, y: 10 } });
    const p = plan(aiState([shield, mage, foe]), 's');
    const end = p.path[p.path.length - 1];
    eq([G().tokenDistance({ pos: end, w: 1, h: 1 }, mage), end.x > 10], [1, true], 'adiacente all\'alleato, dal lato del nemico: ' + p.reason);
    // INT: il più pericoloso.
    const brain = mkC({ id: 'i', name: 'Stratega', abilities: { FOR: 10, DES: 10, COS: 10, INT: 17, SAG: 10, CAR: 10 }, pos: { x: 2, y: 2 } });
    const weakling = mkHero({ id: 'w', name: 'Pip', level: 1, pos: { x: 4, y: 2 } });
    const champion = mkHero({ id: 'c', name: 'Campione', level: 10, maxHp: 90, hp: 90, pos: { x: 8, y: 2 }, weapons: [{ id: 's2', name: 'Spadone', toHit: 9, damageDice: '2d6', damageBonus: 5 }] });
    eq(plan(aiState([brain, weakling, champion]), 'i').action.targetIds, ['c']);
    // SAG: mago, chierico, stregone prima di tutti.
    const hunter = mkC({ id: 'h', name: 'Cacciatore', abilities: { FOR: 10, DES: 10, COS: 10, INT: 10, SAG: 17, CAR: 10 }, pos: { x: 2, y: 2 } });
    const fighter = mkHero({ id: 'g', name: 'Guerra', hp: 2, classId: 'guerriero', pos: { x: 3, y: 2 } });
    const cleric = mkHero({ id: 'k', name: 'Sacerdote', classId: 'chierico', hp: 30, maxHp: 30, pos: { x: 9, y: 2 } });
    const ps = plan(aiState([hunter, fighter, cleric]), 'h');
    eq([ps.action.targetIds, /incantatore prioritario \(chierico\)/.test(ps.reason)], [['k'], true], ps.reason);
    hunter.behavior.sagTargets = ['druido'];
    eq(plan(aiState([hunter, fighter, cleric]), 'h').action.targetIds, ['g'], 'lista modificabile; senza prioritari: il più debole');
  });

  test('IA: CAR cura gli alleati e non attacca; senza nulla di utile si ritira', () => {
    const cure = DnD.dati.defaultSpells().find((s) => s.name === 'Cura ferite');
    const sc = { attack: 5, dc: 13, ability: 'CAR', mod: 3, slotsTotal: [2, 0, 0, 0, 0, 0, 0, 0, 0], slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], spells: [cure] };
    const bard = mkC({ id: 'b', name: 'Cantore', abilities: { FOR: 8, DES: 10, COS: 10, INT: 10, SAG: 10, CAR: 17 }, spellcasting: sc, pos: { x: 2, y: 2 } });
    const ally = mkC({ id: 'a', name: 'Orco', hp: 3, pos: { x: 6, y: 2 } });
    const foe = mkHero({ id: 'f', name: 'Bran', pos: { x: 10, y: 2 } });
    const p = plan(aiState([bard, ally, foe]), 'b');
    eq([p.action.kind, p.action.id, p.action.targetIds, p.action.slotLevel], ['incantesimo', cure.id, ['a'], 1], p.reason);
    ally.hp = 20;
    const p2 = plan(aiState([bard, ally, foe]), 'b');
    ok(p2.action.kind !== 'arma' && !(p2.action.targetIds || []).includes('f'), 'non attacca in mischia: ' + p2.reason);
  });

  test('IA: percorso A* con muri, porta chiusa, terreno difficile e pedina 2×2 nello stretto', () => {
    const ts = TS().newTileset('ts-fango', 'Fango');
    TS().addSource(ts, { imageId: null, imageW: 16, imageH: 16 }, { tileW: 16, tileH: 16 });
    TS().setTileProps(ts, [tid(0, 0)], { cost: 2 });
    const tileMap = Object.assign(TM().newGridMap(20, 20), { tilesets: [ts.id] });
    for (let x = 0; x < 20; x++) tileMap.layers[0].data[10 * 20 + x] = [0, tid(0, 0), 0]; // riga di fango a y = 10
    const one = mkC({ id: 'o', pos: { x: 2, y: 2 } });
    const st = aiState([one], { tilesets: { [ts.id]: ts } });
    st.grid.tileMap = tileMap;
    st.grid.structures.push(wallAt('w', 0, 5, 9, 1), wallAt('w2', 10, 5, 10, 1)); // muro con un varco largo 1 in x = 9
    const map = IA().buildMap(st);
    const P = IA().paths(map, st, one);
    eq(P.dist.get(G().key(9, 6)), 9, 'attraverso il varco: diagonali a costo 1, senza tagliare gli angoli del muro');
    const below = P.dist.get(G().key(9, 11));
    const above = P.dist.get(G().key(9, 9));
    eq(below - above, 3, 'la riga di terreno difficile costa 2 (9 → 10 → 11 = 2 + 1)');
    const big = mkC({ id: 'g', w: 2, h: 2, pos: { x: 2, y: 2 } });
    const st2 = Object.assign(aiState([big]), { grid: st.grid, tilesets: st.tilesets });
    const P2 = IA().paths(IA().buildMap(st2), st2, big);
    ok(!P2.dist.has(G().key(9, 6)) && !P2.dist.has(G().key(2, 8)), 'la pedina 2×2 non passa nel varco 1×1');
    // Porta chiusa: blocca; aperta: si passa.
    st.grid.items.push(DnD.dati.normalizePlacedItem({ id: 'p', name: 'Porta', otype: 'porta', x: 9, y: 5 }));
    ok(!IA().paths(IA().buildMap(st), st, one).dist.has(G().key(9, 6)), 'porta chiusa nel varco: niente passaggio');
    st.grid.items[0].state = 'aperto';
    ok(IA().paths(IA().buildMap(st), st, one).dist.has(G().key(9, 6)), 'porta aperta');
    // Visibilità: il muro blocca la linea di vista; i nascosti non si vedono.
    const h = mkHero({ id: 'h', pos: { x: 2, y: 8 } });
    st.grid.items[0].state = 'chiuso';
    ok(!IA().visible(map, one, h) && IA().visible(map, one, mkHero({ id: 'v', pos: { x: 15, y: 2 } })), 'linea di vista');
    ok(!IA().visible(map, one, mkHero({ id: 'n', pos: { x: 3, y: 2 }, hidden: true })), 'nascosto: non visibile');
  });

  test('IA: limite di velocità, Scatto e niente movimento oltre la velocità', () => {
    const orc = mkC({ id: 'o', name: 'Orco', speed: 6, pos: { x: 0, y: 0 } }); // 4 celle
    const far = mkHero({ id: 'h', name: 'Lontano', pos: { x: 15, y: 0 } });
    const p = plan(aiState([orc, far]), 'o');
    eq([p.action.kind, p.dash, p.path.length - 1, p.moveCost <= 8], ['scatto', true, 8, true], p.reason);
    const near = mkHero({ id: 'h', name: 'Vicino', pos: { x: 4, y: 0 } });
    const p2 = plan(aiState([orc, near]), 'o');
    eq([p2.action.kind, p2.moveCost <= 4, p2.path.length - 1], ['arma', true, 3], 'arriva e attacca entro la velocità');
  });

  test('IA: creature con multiattacco e ricarica', () => {
    const [d] = DnD.combattenti.createCombatants([], [{ npc: ex('esempio-drago-cenere'), quantity: 1 }], [], () => 10);
    d.pos = { x: 2, y: 2 };
    const foes = [mkHero({ id: 'a', name: 'Aria', pos: { x: 5, y: 2 } }), mkHero({ id: 'b', name: 'Bran', pos: { x: 5, y: 3 } })];
    const p = plan(aiState([d].concat(foes)), d.id);
    eq([p.action.kind, p.action.name], ['creatura', 'Soffio di cenere'], 'ricarica disponibile e due nemici vicini: soffio. ' + p.reason);
    DnD.creature.consume(d.creature, DnD.creature.allActions(d.creature).find((a) => a.name === 'Soffio di cenere'));
    const p2 = plan(aiState([d].concat(foes)), d.id);
    eq(p2.action.name, 'Multiattacco', 'soffio da ricaricare: multiattacco');
  });

  // ======================= Velocità e movimento (movimento.js) =======================
  const MV = () => DnD.movimento;
  const RULES1 = { diagonals: 'sempre1', missingMode: 'vietato' };
  const RULES_ALT = { diagonals: 'alternata', missingMode: 'vietato' };
  const openMap = (w, h, cost, blocked) => ({ w, h, blocked: new Set(blocked || []), cost: new Map(cost || []) });

  test('Movimento: conversione piedi/celle con diverse scale e fonti della velocità', () => {
    eq([MV().cellsOf(30, 5), MV().cellsOf(30, 10), MV().cellsOf(25, 5), MV().cellsOf(35, 10), MV().cellsOf(4, 5)], [6, 3, 5, 3, 0], 'per difetto');
    eq([MV().feetFromMeters(9), MV().feetFromMeters(12), MV().feetFromMeters(1.5), MV().metersFromFeet(30)], [30, 40, 5, 9]);
    // Razza (Umano 9 m) e oggetti equipaggiati (+3 m).
    const st = DnD.dati.emptyState();
    const human = st.races.find((r) => r.name === 'Umano');
    const boots = DnD.attrezzatura.normalizeEquipment({ id: 'stivali', name: 'Stivali veloci', category: 'magici', speedBonus: 3 });
    const hero = DnD.dati.normalizeCreature({ name: 'Kael', raceId: human.id, classId: 'guerriero', level: 3, inventory: [{ equipmentId: 'stivali', qty: 1, equipped: false }] }, true);
    eq(DnD.combattenti.createCombatants([hero], [], st.races, () => 10, st.spells, [boots])[0].speeds.cammina, 30, 'razza');
    hero.inventory[0].equipped = true;
    eq(DnD.combattenti.createCombatants([hero], [], st.races, () => 10, st.spells, [boots])[0].speeds.cammina, 40, 'stivali equipaggiati +3 m = +10 ft');
    // Creatura: tutte le modalità.
    const harpy = DnD.creature.normalizeMonster({ name: 'Arpia', speed: { walk: 6, fly: 12, swim: 0 } });
    eq(MV().speedsFromCreature(harpy.speed), { cammina: 20, scalare: 0, nuotare: 0, volare: 40, scavare: 0 });
    // Bonus dei nodi del percorso (+3 m) e trasformazione attiva (velocità della forma).
    const c = legendaryOf(25);
    c.legend.path.nodes.push(PT().normalizeNode({ id: 'v', cost: 1, effects: [{ kind: 'bonus', stat: 'velocita', value: 3 }] }));
    c.legend.path.links.push(['nucleo', 'v']);
    c.legend.unlocked = ['nucleo', 'v'];
    c.legend.transformations = [formOf({ creature: { name: 'Drago', speed: { walk: 12, fly: 24 }, abilities: { FOR: 20, DES: 10, COS: 20, INT: 8, SAG: 8, CAR: 8 } } })];
    const x = DnD.combattenti.createCombatants([c], [], [], () => 10, st.spells, st.equipment)[0];
    eq(x.speeds.cammina, 40, 'nodo: +3 m = +10 ft');
    LG().transform(x, c.legend.transformations[0]);
    eq([x.speeds.cammina, x.speeds.volare], [40, 80], 'forma: velocità della creatura');
    // Sovrascrittura a mano.
    const o = mkC({ id: 'o', speedOverride: { cammina: 50 } });
    eq([MV().speedState(o, RULES1, 5).feet, MV().speedState(o, RULES1, 10).cells], [50, 5]);
  });

  test('Movimento: residuo per turno, azzeramento, limite e fermata all\'ultima cella raggiungibile', () => {
    const k = mkC({ id: 'k', pos: { x: 0, y: 0 } }); // 9 m = 30 ft = 6 celle
    eq([MV().budget(k, RULES1, 5), MV().left(k, RULES1, 5)], [6, 6]);
    const st = aiState([k]);
    const P = MV().reach(openMap(20, 20), st, k, { rules: RULES1 });
    const r = MV().routeTo(P, { x: 10, y: 0 }, MV().left(k, RULES1, 5));
    eq([r.end, r.cost, r.full, r.stopped], [{ x: 6, y: 0 }, 6, 10, true], 'oltre il residuo: si ferma a 6');
    MV().recordMove(k, r.end, r.cost);
    eq([k.pos, MV().left(k, RULES1, 5), MV().movementOf(k).moves.length], [{ x: 6, y: 0 }, 0, 1]);
    const r2 = MV().routeTo(MV().reach(openMap(20, 20), st, k, { rules: RULES1 }), { x: 8, y: 0 }, MV().left(k, RULES1, 5));
    eq([r2.end, r2.stopped], [{ x: 6, y: 0 }, true], 'residuo finito: resta dov\'è');
    MV().resetTurn(k);
    eq([MV().left(k, RULES1, 5), MV().movementOf(k).start], [6, { x: 6, y: 0 }], 'nuovo turno: velocità piena');
    // Scala diversa: 10 ft per cella = 3 celle.
    eq(MV().left(k, RULES1, 10), 3);
    const msg = MV().moveText(k, 4, 6, 2, 5);
    eq(msg, 'Senza nome si muove di 4 caselle (costo 6), restano 2 caselle (10 ft).');
  });

  test('Movimento: costo con terreno difficile, diagonali (due regole), pedina 2×2 nello stretto', () => {
    const m = mkC({ id: 'm', pos: { x: 0, y: 0 } });
    const st = aiState([m]);
    const mud = openMap(20, 20, Array.from({ length: 20 }, (_, y) => [G().key(2, y), 2])); // colonna di fango in x = 2
    eq(MV().reach(mud, st, m, { rules: RULES1 }).dist.get(G().key(4, 0)), 4 + 1, 'attraversare il terreno difficile costa 2');
    eq(MV().reach(openMap(20, 20, [[G().key(2, 0), 2]]), st, m, { rules: RULES1 }).dist.get(G().key(4, 0)), 4, 'una cella sola si aggira');
    eq(MV().reach(openMap(20, 20), st, m, { rules: RULES1 }).dist.get(G().key(4, 4)), 4, 'diagonali sempre 1');
    eq(MV().reach(openMap(20, 20), st, m, { rules: RULES_ALT }).dist.get(G().key(4, 4)), 6, 'diagonali alternate 1-2-1-2');
    eq(MV().reach(openMap(20, 20), st, m, { rules: RULES_ALT }).dist.get(G().key(3, 3)), 4, '1 + 2 + 1');
    eq([MV().distance({ x: 0, y: 0 }, { x: 4, y: 4 }, RULES1), MV().distance({ x: 0, y: 0 }, { x: 4, y: 4 }, RULES_ALT), MV().distance({ x: 0, y: 0 }, { x: 5, y: 2 }, RULES_ALT)], [4, 6, 6], 'stessa regola del misuratore');
    const P = MV().reach(openMap(20, 20), st, m, { rules: RULES1 });
    ok(P.path(G().key(6, 0)).every((p) => p.y === 0), 'a parità di costo, percorso dritto (niente zig-zag)');
    // Muro con un varco largo 1: la 2×2 non passa, la 1×1 sì.
    const wall = [];
    for (let x = 0; x < 20; x++) if (x !== 9) wall.push(G().key(x, 5));
    const one = mkC({ id: 'o', pos: { x: 9, y: 2 } });
    const big = mkC({ id: 'b', w: 2, h: 2, pos: { x: 8, y: 1 } });
    ok(MV().reach(openMap(20, 20, [], wall), aiState([one]), one, { rules: RULES1 }).dist.has(G().key(9, 7)), '1×1 nel varco');
    ok(!MV().reach(openMap(20, 20, [], wall), aiState([big]), big, { rules: RULES1 }).dist.has(G().key(8, 7)), '2×2: tutto l\'ingombro, non passa');
    // Pedine ostili bloccano, alleate si attraversano ma non ci si ferma sopra.
    const foe = mkHero({ id: 'f', pos: { x: 1, y: 0 } });
    const ally = mkC({ id: 'a', pos: { x: 0, y: 1 } });
    const P2 = MV().reach(openMap(3, 3), aiState([m, foe, ally]), m, { rules: RULES1 });
    eq([P2.dist.has(G().key(1, 0)), P2.dist.has(G().key(0, 1)), P2.canEnd(0, 1)], [false, true, false]);
  });

  test('Movimento: Scatto, Rialzarsi, annulla spostamento; condizioni afferrato, prono, rallentato', () => {
    const k = mkC({ id: 'k', name: 'Kael', pos: { x: 0, y: 0 } });
    MV().resetTurn(k);
    MV().recordMove(k, { x: 3, y: 0 }, 3);
    MV().dash(k);
    eq([MV().budget(k, RULES1, 5), MV().left(k, RULES1, 5)], [12, 9], 'Scatto: +6');
    const u = MV().undoMoves(k);
    eq([u.ok, u.refunded, k.pos, MV().left(k, RULES1, 5), MV().movementOf(k).dashes], [true, 3, { x: 0, y: 0 }, 12, 1], 'annulla: torna e restituisce, lo Scatto resta');
    eq(MV().undoMoves(k).ok, false, 'niente da annullare');
    // Prono: strisciare costa il doppio; Rialzarsi costa metà velocità e toglie la condizione.
    k.conditions = ['prono'];
    eq(MV().speedState(k, RULES1, 5).extra, 1);
    eq(MV().reach(openMap(20, 20), aiState([k]), k, { rules: RULES1 }).dist.get(G().key(3, 0)), 6, 'striscia: 3 celle costano 6');
    const sUp = MV().standUp(k, RULES1, 5);
    eq([sUp.ok, sUp.cost, DnD.condizioni.types(k), MV().left(k, RULES1, 5), MV().speedState(k, RULES1, 5).extra], [true, 3, [], 9, 0]);
    const tired = mkC({ id: 't', conditions: ['prono'], movement: { used: 5 } });
    eq(MV().standUp(tired, RULES1, 5).ok, false, 'serve metà velocità di residuo');
    // Afferrato, trattenuto, paralizzato: 0 con il motivo; rallentato: metà.
    for (const cond of ['afferrato', 'trattenuto', 'paralizzato']) {
      const st = MV().speedState(mkC({ id: 'x', conditions: [cond] }), RULES1, 5);
      eq([st.cells, st.zero, st.reasons], [0, true, [cond + ': velocità 0']], cond);
    }
    const slow = MV().speedState(mkC({ id: 's', conditions: ['rallentato'] }), RULES1, 5);
    eq([slow.feet, slow.cells, slow.reasons], [15, 3, ['rallentato: metà velocità']]);
    // Le condizioni si salvano (anche «rallentato», che non è del manuale); quelle sconosciute si scartano.
    eq(DnD.condizioni.types(DnD.dati.normalizeCombatant({ conditions: ['prono', 'rallentato', 'boh'] })), ['prono', 'rallentato']);
  });

  test('Movimento: modalità (camminare, volare, nuotare…) e velocità mancante vietata o doppia', () => {
    const harpy = mkC({ id: 'h', speeds: { cammina: 20, volare: 40 }, pos: { x: 0, y: 0 } });
    harpy.moveMode = 'volare';
    const sf = MV().speedState(harpy, RULES1, 5);
    eq([sf.feet, sf.cells, sf.extra], [40, 8, 0]);
    const mud = openMap(20, 20, [[G().key(1, 0), 2], [G().key(2, 0), 2]]);
    eq(MV().reach(mud, aiState([harpy]), harpy, { rules: RULES1 }).dist.get(G().key(3, 0)), 3, 'volando il terreno difficile non conta');
    harpy.moveMode = 'nuotare';
    const ban = MV().speedState(harpy, RULES1, 5);
    eq([ban.usable, ban.cells, ban.reasons], [false, 0, ['non può nuotare']], 'senza velocità: vietato');
    const dbl = MV().speedState(harpy, { diagonals: 'sempre1', missingMode: 'doppio' }, 5);
    eq([dbl.usable, dbl.cells, dbl.extra], [true, 4, 1], 'oppure a costo doppio con la velocità a piedi');
  });

  test('Movimento: anteprima delle celle raggiungibili (1× e con lo Scatto), IA con il residuo', () => {
    const k = mkC({ id: 'k', speed: 1.5, pos: { x: 5, y: 5 } }); // 5 ft = 1 cella
    const P = MV().reach(openMap(11, 11), aiState([k]), k, { rules: RULES1 });
    const sets = MV().reachable(P, 1, 2);
    eq([sets.normal.size, sets.dash.size], [8, 16], 'anello a 1 e anello a 2 con lo Scatto');
    ok(!sets.normal.has(G().key(5, 5)), 'la cella di partenza non conta');
    // L'IA usa il residuo e il costo reale.
    const orc = mkC({ id: 'o', name: 'Orco', pos: { x: 0, y: 0 }, movement: { used: 4 } }); // 6 celle, ne restano 2
    const far = mkHero({ id: 'h', name: 'Lontano', pos: { x: 6, y: 0 } });
    const p = plan(aiState([orc, far]), 'o');
    ok(p.moveCost <= 2 + 6 && (p.dash ? p.path.length - 1 <= 8 : p.path.length - 1 <= 2), 'residuo 2 (+6 con lo Scatto): ' + p.reason);
    const fresh = mkC({ id: 'o', name: 'Orco', pos: { x: 0, y: 0 } });
    eq(plan(aiState([fresh, far]), 'o').action.kind, 'arma', 'con il turno pieno arriva e attacca');
  });

  test('Movimento: salvataggio e migrazione dei combattenti, movimento libero e «Ignora velocità»', () => {
    const old = DnD.dati.normalizeCombatant({ name: 'Vecchio', speed: 12 });
    eq([old.speeds.cammina, old.moveMode, old.movement.used, old.ignoreSpeed, old.conditions], [40, 'cammina', 0, false, []], 'dati precedenti: velocità della razza o creatura');
    const back = DnD.dati.normalizeCombatant(JSON.parse(JSON.stringify(Object.assign({}, old, {
      speeds: { cammina: 30, volare: 60 }, speedOverride: { cammina: 45 }, moveMode: 'volare', ignoreSpeed: true,
      movement: { used: 3, dashes: 1, start: { x: 1, y: 1 }, moves: [{ from: { x: 1, y: 1 }, to: { x: 2, y: 2 }, cost: 1 }] },
    }))));
    eq([back.speeds.volare, back.speedOverride, back.moveMode, back.ignoreSpeed, back.movement.dashes, back.movement.moves.length], [60, { cammina: 45 }, 'volare', true, 1, 1]);
    const combat = DnD.dati.normalizeCombat({ combatants: [old], freeMovement: true });
    eq(combat.freeMovement, true, 'movimento libero salvato con il combattimento');
    // Annulla/ripeti della griglia: anche il residuo torna indietro.
    const doc = { grid: { structures: [], items: [], labels: [], zones: [] }, combatants: [Object.assign(mkC({ id: 'k', pos: { x: 0, y: 0 } }), { movement: MV().normalizeMovement({}) })] };
    const snap = G().gridSnapshot(doc);
    MV().recordMove(doc.combatants[0], { x: 3, y: 0 }, 3);
    G().restoreSnapshot(doc, snap);
    eq([doc.combatants[0].pos, doc.combatants[0].movement.used], [{ x: 0, y: 0 }, 0]);
  });

  test('IA: fuga sotto la soglia (Furbo) e Aggressivo che non fugge mai', () => {
    const orc = mkC({ id: 'o', name: 'Orco', hp: 3, pos: { x: 5, y: 5 }, behavior: { temperament: 'furbo', fleeAt: 30 } });
    const hero = mkHero({ id: 'h', name: 'Bran', pos: { x: 6, y: 5 } });
    const p = plan(aiState([orc, hero]), 'o');
    const end = p.path[p.path.length - 1];
    ok(/fugge/.test(p.reason) && G().tokenDistance({ pos: end, w: 1, h: 1 }, hero) > 3 && p.reminders.some((r) => /attacco di opportunità/.test(r)), p.reason);
    orc.behavior.temperament = 'aggressivo';
    eq(plan(aiState([orc, hero]), 'o').action.kind, 'arma', 'Aggressivo: attacca anche ferito');
  });

  test('IA: tempo massimo di calcolo, seed riproducibile, motivazione nel log', () => {
    const orc = mkC({ id: 'o', name: 'Orco 1', pos: { x: 5, y: 5 }, behavior: { randomness: 30 } });
    const heroes = [0, 1, 2, 3].map((i) => mkHero({ id: 'h' + i, name: 'Eroe ' + i, pos: { x: 8 + i * 2, y: 5 + i } }));
    const st = aiState([orc].concat(heroes), { seed: 12345 });
    let t = 0;
    const slow = plan(st, 'o', { timeLimit: 300, now: () => (t += 1000) });
    ok(slow.fallback && /ripiego/.test(slow.reason) && slow.path.length - 1 <= 6, 'tetto di tempo: ripiego "avvicinati e attacca il più vicino"');
    const a = plan(st, 'o');
    const b = plan(st, 'o');
    eq(JSON.stringify(a), JSON.stringify(b), 'stesso seed, round e combattente: stesso piano');
    ok(/^Orco 1 \(aggressivo, FOR\): si sposta di \d+ celle e attacca Eroe \d con Ascia/.test(plan(aiState([mkC({ id: 'o', name: 'Orco 1', pos: { x: 5, y: 5 } })].concat(heroes)), 'o').reason), 'motivazione');
    const why = IA().whyText(a);
    ok(/Bersagli considerati/.test(why) && /debolezza/.test(why) && /minaccia/.test(why) && /Eroe 0/.test(why), 'Perché?: punteggi dei bersagli');
  });

  test('IA: controllo su un giocatore, fazioni e cronologia di un turno IA', () => {
    const hero = mkHero({ id: 'p', name: 'Aria', control: 'ia', pos: { x: 2, y: 2 } });
    const ally = mkC({ id: 'n', name: 'Guardia amica', faction: 'neutrali', pos: { x: 3, y: 3 } });
    const goblin = mkC({ id: 'g', name: 'Goblin', pos: { x: 6, y: 2 } });
    eq([hero.control, IA().isHostile(hero, ally), IA().isHostile(hero, goblin), IA().isHostile(ally, goblin)], ['ia', false, true, true]);
    eq(plan(aiState([hero, ally, goblin]), 'p').action.targetIds, ['g'], 'il giocatore controllato dall\'IA attacca solo i nemici');
    eq(plan(aiState([goblin, hero, ally]), 'g').scores.map((s) => s.id).sort(), ['n', 'p'], 'per i nemici giocatori e alleati sono ostili');
    eq(plan(aiState([hero, ally]), 'p').reason, 'Aria (aggressivo, FOR): nessun avversario rimasto.');
    // Annulla/Ripeti di un intero turno IA.
    const h = IA().turnHistory();
    h.push({ v: 1 }, { v: 2 });
    eq([h.undo(), h.canUndo(), h.redo(), h.canRedo()], [{ v: 1 }, false, { v: 2 }, false]);
  });

  // --- Fase: più colori, più icone e Boss ---
  const B = () => DnD.boss;

  test('Palette di 14 colori: nomi, esadecimali, bordo di contrasto e colori precedenti validi', () => {
    const P = DnD.colori.PALETTE;
    eq(P.map((c) => c.key), ['verde', 'blu', 'rosso', 'grigio', 'arancione', 'giallo', 'viola', 'rosa', 'azzurro', 'turchese', 'marrone', 'nero', 'bianco', 'oro']);
    ok(P.every((c) => /^#[0-9a-f]{6}$/.test(c.hex) && c.name), 'esadecimali e nomi');
    eq(new Set(P.map((c) => c.hex)).size, 14, 'colori distinti');
    // I 4 colori precedenti non cambiano: i dati esistenti restano validi.
    for (const hex of ['#3fae63', '#4f8fd6', '#d4453a', '#8a8f9c']) eq(DnD.icone.normalizeIcon({ kind: 'shape', shape: 'cerchio', color: hex }, false).color, hex);
    for (const c of P) eq(DnD.icone.normalizeIcon({ kind: 'library', icon: 'drago', color: c.hex }, false).color, c.hex, c.name);
    // Contrasto: bordo esterno chiaro sui colori scuri, scuro sui chiari.
    const k = DnD.colori.contrastStrokes;
    ok(/255,255,255/.test(k('#2b2b30').outer) && /0,0,0/.test(k('#f4f4f0').outer) && /0,0,0/.test(k('#f2c94c').outer), 'nero → bordo chiaro, bianco e giallo → bordo scuro');
    ok(DnD.colori.isDark('#2b2b30') && DnD.colori.isDark('#8b5a2b') && !DnD.colori.isDark('#f4f4f0'), 'colori scuri');
    // Icone in currentColor: un solo SVG, il colore è sulla radice; i dettagli si invertono sui colori scuri.
    const svg = DnD.icone.iconSvg('drago', '#e8832a');
    ok(svg.includes('color="#e8832a"') && svg.includes('currentColor') && !/\{[cdl]\}/.test(svg), 'currentColor');
    ok(DnD.icone.iconSvg('guerriero', '#2b2b30').includes('rgba(255,255,255,0.75)'), 'dettagli chiari sul nero');
    eq(DnD.colori.byHex('#C9A227').name, 'Oro');
  });

  test('Nuove icone: almeno 40, categorie nuove, ricerca e dimensione suggerita', () => {
    const L = DnD.libreriaIcone;
    const nuove = ['drago-volo', 'drago-intero', 'testa-drago', 'viverna', 'drago-serpentino', 'cucciolo-drago',
      'tirannosauro', 'raptor', 'triceratopo', 'pterodattilo', 'brontosauro', 'stegosauro', 'uovo-dinosauro',
      'demone-alato', 'diavolo-tridente', 'diavoletto', 'demone-bestia', 'signore-abissi', 'teschio-corna', 'cane-infernale',
      'occhio-tiranno', 'massa-tentacoli', 'divoratore-menti', 'melma-occhi',
      'elementale-fuoco', 'elementale-acqua', 'elementale-terra', 'elementale-aria',
      'idra-cinque', 'chimera', 'grifone', 'basilisco', 'scorpione-gigante', 'verme-gigante', 'gigante', 'lich', 'vampiro-signore',
      'licantropo-bestia', 'albero-antico', 'mimic'];
    ok(nuove.length >= 40, 'almeno 40');
    for (const id of nuove) ok(L.LIBRARY.some((x) => x.id === id), 'icona ' + id);
    for (const cat of ['draghi', 'dinosauri', 'demoni', 'aberrazioni', 'elementali']) {
      ok(L.CREATURE_CATEGORIES[cat], 'categoria ' + cat);
      ok(L.LIBRARY.filter((x) => x.category === cat).length >= 4, 'icone in ' + cat);
    }
    eq(new Set(L.LIBRARY.map((x) => x.id)).size, L.LIBRARY.length, 'id unici');
    // Stessa ricerca del selettore: nome o id, con filtro di categoria.
    const find = (q, cat) => L.LIBRARY.filter((x) => (!cat || x.category === cat) && (x.name.toLowerCase().includes(q) || x.id.includes(q))).map((x) => x.id);
    ok(find('drago', 'draghi').includes('drago-volo') && !find('drago', 'dinosauri').length, 'ricerca «drago» per categoria');
    eq(find('raptor'), ['raptor']);
    // Dimensione suggerita sulla griglia per le icone grandi.
    const grid = (id) => L.LIBRARY.find((x) => x.id === id).grid;
    eq([grid('tirannosauro'), grid('brontosauro'), grid('drago-intero'), grid('idra-cinque'), grid('drago'), grid('goblin'), grid('raptor')], [3, 4, 4, 3, 3, 1, 1]);
    for (const x of L.LIBRARY) ok(Number.isInteger(x.grid) && x.grid >= 1 && x.grid <= 8, 'dimensione valida: ' + x.id);
  });

  // Creatura di prova per i boss: 100 PF fissi.
  const bossOf = (phases, extra) => DnD.dati.normalizeCreature(Object.assign({
    type: 'boss', name: 'Tiranno', hitDice: 10, hpOverride: 100, abilities: { FOR: 16, DES: 12, COS: 14 },
    actions: [{ id: 'm1', name: 'Pugno', mech: { kind: 'attacco', damages: [{ dice: '1d8', type: 'contundente' }] } },
      { id: 'm2', name: 'Urlo', mech: { kind: 'salvezza', ability: 'SAG', damages: [{ dice: '2d6', type: 'psichico' }] } }],
    boss: { title: 'Il Re di Ferro', theme: 'gelo', phases },
  }, extra), false);

  test('Boss: dati, normalizzazione delle fasi e boss d\'esempio', () => {
    const b = bossOf([{ threshold: 33, name: 'Ultima' }, { threshold: 100, name: 'Inizio' }, { threshold: 66, name: 'Media' }, { threshold: 66, name: 'Doppia' }]);
    eq([b.type, b.boss.title, b.boss.theme, b.boss.phases.map((p) => [p.threshold, p.name])], ['boss', 'Il Re di Ferro', 'gelo', [[100, 'Inizio'], [66, 'Media'], [33, 'Ultima']]]);
    eq(DnD.validazione.validateMonster(b), {}, 'valido come creatura');
    eq(B().normalizeBoss({ theme: 'sconosciuto', aura: 99 }).theme, 'infernale', 'tema predefinito');
    eq(B().THEME_IDS, ['infernale', 'gelo', 'veleno', 'arcano', 'ossa', 'sangue', 'oscuro', 'divino'], 'temi disponibili');
    for (const id of ['sangue', 'oscuro', 'divino']) eq(B().normalizeBoss({ theme: id }).theme, id, 'tema ' + id);
    for (const t of Object.values(B().THEMES)) ok(['accent', 'glow', 'frame', 'bg'].every((k) => /^#[0-9a-f]{6}$/.test(t[k])) && /^rgba\(/.test(t.shadow), 'colori del tema ' + t.name);
    eq(B().normalizeBoss({ aura: 99 }).aura, B().MAX_AURA);
    eq(B().normalizeBoss({}).phases.map((p) => p.threshold), [100], 'almeno una fase al 100%');
    const ex = DnD.creatureDati.examples().filter((x) => x.type === 'boss').map((x) => DnD.dati.normalizeCreature(x, false));
    eq(ex.length, 1, 'un boss d\'esempio');
    const sk = ex[0];
    eq([sk.boss.theme, sk.boss.phases.length, sk.legendary.length > 0, sk.lair.length > 0], ['infernale', 3, true, true]);
    eq(DnD.validazione.validateMonster(sk), {}, 'boss d\'esempio valido');
    ok(DnD.dati.emptyState().npcs.some((n) => n.type === 'boss' && n.shared), 'boss d\'esempio nei dati nuovi, condiviso');
  });

  test('Boss: promozione da creatura e da nemico standard', () => {
    const st = DnD.dati.emptyState();
    const drago = st.npcs.find((n) => n.id === 'esempio-drago-cenere');
    const p1 = DnD.dati.normalizeCreature(B().promote(drago), false);
    eq([p1.type, p1.name, p1.cr, p1.actions.length, p1.legendary.length, p1.boss.phases.length], ['boss', drago.name, drago.cr, drago.actions.length, drago.legendary.length, 2]);
    ok(p1.id !== drago.id && !p1.shared, 'nuovo id, non condiviso');
    const orco = DnD.dati.normalizeCreature({ name: 'Capo orco', raceId: st.races[0].id, level: 5, classId: 'guerriero', hpMode: 'manuale', maxHp: 60, acMode: 'manuale', ac: 16,
      abilities: { FOR: 18, DES: 12, COS: 16, INT: 8, SAG: 10, CAR: 10 },
      weapons: [{ name: 'Ascia bipenne', toHit: 7, damageDice: '1d12', damageBonus: 4, damageType: 'tagliente' }, { name: 'Giavellotto', toHit: 7, damageDice: '1d6', damageBonus: 4, damageType: 'perforante' }] }, false);
    const p2 = DnD.dati.normalizeCreature(B().promote(orco, { race: st.races[0], catalog: st.equipment }), false);
    eq([p2.type, p2.name, p2.ac, DnD.creature.hpInfo(p2).total, p2.cr], ['boss', 'Capo orco', 16, 60, '5']);
    eq(p2.actions.map((a) => a.mech.kind), ['multiattacco', 'attacco', 'attacco'], 'armi → attacchi, più un multiattacco');
    eq([p2.actions[1].mech.toHit, p2.actions[1].mech.damages[0].dice, p2.actions[1].mech.damages[0].bonus], [7, '1d12', 4]);
    eq(DnD.validazione.validateMonster(p2), {}, 'scheda valida');
  });

  test('Boss: soglie di fase (anche più fasi in un colpo), cura sopra la soglia, azioni e temperamento per fase', () => {
    const phases = [{ threshold: 100, name: 'A' }, { threshold: 66, name: 'B', temperament: 'aggressivo', disable: ['m2'] }, { threshold: 33, name: 'C', enable: ['m2', 'm9'] }];
    const st = B().combatState(bossOf(phases));
    eq([B().phaseForHp(st.phases, 100, 100), B().phaseForHp(st.phases, 66, 100), B().phaseForHp(st.phases, 65, 100), B().phaseForHp(st.phases, 32, 100), B().phaseForHp(st.phases, 0, 100)], [0, 0, 1, 2, 2],
      'cambio al passaggio SOTTO la soglia');
    eq(B().updatePhase(st, 80, 100), null, 'sopra la prima soglia: nessun cambio');
    eq(B().updatePhase(st, 20, 100), { from: 0, to: 2, crossed: [1, 2] }, 'un solo colpo attraversa due fasi');
    eq(B().updatePhase(st, 90, 100), null, 'curato sopra la soglia resta nella fase raggiunta');
    eq(st.phase, 2);
    eq(B().updatePhase(st, 10, 100), null, 'gli effetti non si ripetono');
    // Azioni: m9 (abilitata da una fase successiva) parte disabilitata; m2 disattivata in fase B, riattivata in C.
    eq([...B().disabledActions(st, 0)].sort(), ['m2', 'm9'], 'fase A: le azioni sbloccate da una fase successiva partono disabilitate');
    eq([...B().disabledActions(st, 1)].sort(), ['m2', 'm9'], 'fase B');
    eq([...B().disabledActions(st, 2)], [], 'fase C');
    eq([B().temperamentAt(st, 0), B().temperamentAt(st, 1), B().temperamentAt(st, 2)], [null, 'aggressivo', 'aggressivo']);
  });

  test('Boss nel combattimento: PF scalati, eventi di fase e sconfitta, log, temperamento, vignettatura', () => {
    const boss = bossOf([{ threshold: 100, name: 'A' }, { threshold: 50, name: 'Furia', note: 'Spacca il pavimento.', effect: 'tremolio', temperament: 'aggressivo' }], { behavior: { temperament: 'furbo' } });
    const hero = DnD.dati.normalizeCreature({ name: 'Eroe', classId: 'guerriero', maxHp: 20 }, true);
    let list = DnD.combattenti.createCombatants([hero, hero], [{ npc: boss, quantity: 1 }], [], seq(10, 10, 10), [], []);
    const x = list.find((c) => c.boss);
    eq([x.maxHp, x.hp, x.boss.phase, x.boss.revealed], [100, 100, 0, false], 'senza scala');
    boss.boss.scaleByPlayers = true;
    list = DnD.combattenti.createCombatants([hero, hero, hero], [{ npc: boss, quantity: 1 }], [], seq(10, 10, 10, 10), [], []);
    eq(list.find((c) => c.boss).maxHp, 300, 'PF × 3 giocatori');
    const c = DnD.dati.normalizeSession({ combat: { combatants: [x, list[0]] } }).combat;
    const bx = c.combatants.find((y) => y.boss);
    eq([bx.boss.phases.length, bx.boss.theme], [2, 'gelo'], 'stato del boss conservato dalla normalizzazione');
    const logs = [];
    const logFn = (t, s) => logs.push(s);
    eq(B().vignetteLevel(c.combatants), 0.35, 'boss vivo: vignettatura di base');
    bx.hp = 40;
    const ev = B().checkCombat(c, logFn);
    eq(ev.map((e) => [e.kind, e.phase, e.phaseName, e.effect]), [['fase', 1, 'Furia', 'tremolio']]);
    ok(/FASE 2 — Furia/.test(logs[0]) && /Spacca il pavimento/.test(logs[0]), 'nota del master nel log');
    eq(bx.behavior.temperament, 'aggressivo', 'temperamento della fase');
    eq(B().vignetteLevel(c.combatants), 1, 'si intensifica con la fase');
    eq(B().checkCombat(c, logFn), [], 'nessun nuovo evento');
    bx.hp = 0;
    eq(B().checkCombat(c, logFn).map((e) => e.kind), ['sconfitto']);
    eq(B().vignetteLevel(c.combatants), 0, 'boss sconfitto: l\'ombra svanisce');
  });

  test('Boss: barre multiple (massimo 3 visibili) e boss nascosto nella vista giocatori', () => {
    const mk = (i, revealed) => ({ id: 'b' + i, name: 'Boss ' + i, hp: 10, maxHp: 10, boss: Object.assign(B().combatState(bossOf([])), { revealed }) });
    const list = [mk(1, true), { id: 'x', hp: 5, maxHp: 5 }, mk(2, false), mk(3, true), mk(4, false), mk(5, true)];
    const m = B().bars(list, 'master');
    eq([m.shown.map((x) => x.id), m.more.map((x) => x.id)], [['b1', 'b2', 'b3'], ['b4', 'b5']]);
    const g = B().bars(list, 'giocatori');
    eq([g.shown.map((x) => x.id), g.more.map((x) => x.id)], [['b1', 'b3', 'b5'], []], 'solo i boss rivelati');
  });

  test('Boss: esportazione e importazione (archivio e sessione), migrazione dalla versione 8', () => {
    const st = DnD.dati.emptyState();
    const sess = S().current(st);
    const own = Object.assign(bossOf([{ threshold: 100 }, { threshold: 40, name: 'Ultima' }]), { id: 'boss-mio', sessionId: sess.id, shared: false });
    st.npcs.push(own);
    const back = DnD.dati.importJSON(JSON.stringify(st));
    const b = back.npcs.find((n) => n.id === 'boss-mio');
    eq([b.type, b.boss.title, b.boss.phases.map((p) => p.threshold)], ['boss', 'Il Re di Ferro', [100, 40]], 'archivio');
    const file = JSON.parse(JSON.stringify(S().exportSession(st, sess.id)));
    ok(file.npcs.some((n) => n.type === 'boss' && n.boss.phases.length === 2), 'sessione esportata con il boss');
    const dst = DnD.dati.emptyState();
    S().importSession(dst, file, DnD.dadi.uid);
    ok(dst.npcs.some((n) => n.type === 'boss' && n.name === 'Tiranno' && n.boss.title === 'Il Re di Ferro'), 'sessione importata');
    // Duplicazione di una sessione: il boss non condiviso viene copiato.
    const old = JSON.parse(JSON.stringify(st));
    old.version = 8;
    old.npcs = old.npcs.filter((n) => n.type !== 'boss' || n.id === 'boss-mio');
    const migrated = DnD.dati.normalizeState(old);
    ok(migrated.npcs.some((n) => n.id === 'esempio-boss-skarnoth'), 'v8 → v9: arriva il boss d\'esempio');
    eq(migrated.npcs.filter((n) => n.type === 'creatura').length, st.npcs.filter((n) => n.type === 'creatura').length, 'creature invariate');
    eq(migrated.npcs.find((n) => n.id === 'boss-mio').boss.phases.length, 2);
    // Colori delle versioni precedenti: restano quelli.
    const v7 = DnD.dati.normalizeState({ version: 7, races: [], players: [], npcs: [{ id: 'n', name: 'Goblin', icon: { kind: 'shape', shape: 'stella', color: '#d4453a' } }] });
    eq(v7.npcs.find((n) => n.id === 'n').icon.color, '#d4453a', 'migrazione dei colori esistenti');
  });

  // Interfaccia dei boss (solo nel browser, con css/boss.css).
  const hasBossUi = () => typeof document !== 'undefined' && Boolean(DnD.uiBoss) && typeof document.elementFromPoint === 'function';
  const bossCombat = (n, revealed) => ({ combatants: Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'Boss ' + i, hp: 50, maxHp: 100,
    boss: Object.assign(DnD.boss.combatState(bossOf([{ threshold: 100 }, { threshold: 50, name: 'Furia' }])), { revealed: Boolean(revealed) }) })) });

  test('Boss UI: barre in alto (3 visibili + menu), vista giocatori, segni delle fasi e danno recente', () => {
    if (!hasBossUi()) return;
    const hud = DnD.uiBoss.combatHud(bossCombat(5), 'master');
    eq([hud.querySelectorAll(':scope > .boss-bar').length, hud.querySelectorAll('details .boss-bar').length], [3, 2], '3 barre e 2 nel menu');
    const bar = hud.querySelector('.boss-bar');
    ok(/Boss 0/.test(bar.textContent) && /50 \/ 100 PF/.test(bar.textContent) && /nascosto ai giocatori/.test(bar.textContent), 'nome, PF, nascosto');
    eq(bar.querySelectorAll('.boss-bar-mark').length, 1, 'un segno per la soglia della fase 2');
    eq(bar.style.getPropertyValue('--pct'), '50%');
    eq(DnD.uiBoss.combatHud(bossCombat(2, false), 'giocatori'), null, 'vista giocatori: boss non rivelati nascosti');
    eq(DnD.uiBoss.combatHud(bossCombat(2, true), 'giocatori').querySelectorAll('.boss-bar').length, 2, 'rivelati: visibili');
    const lagged = DnD.uiBoss.bar({ name: 'X', hp: 30, maxHp: 100, boss: bossCombat(1).combatants[0].boss }, { prevHp: 80 });
    eq([lagged.style.getPropertyValue('--pct'), lagged.style.getPropertyValue('--lag')], ['30%', '80%'], 'la parte appena persa si svuota dopo');
  });

  test('Boss UI: la vignettatura non intercetta i clic; "Effetti boss" e "Riduci animazioni"', () => {
    if (!hasBossUi()) return;
    const html = document.documentElement;
    const btn = document.createElement('button');
    btn.textContent = 'sotto';
    btn.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:40px;z-index:1';
    document.body.append(btn);
    const v = DnD.uiBoss.vignette(bossCombat(1));
    document.body.append(v);
    try {
      eq(getComputedStyle(v).pointerEvents, 'none');
      eq(document.elementFromPoint(10, 10), btn, 'il clic sul bordo arriva al controllo sotto l\'ombra');
      eq(DnD.uiBoss.vignette({ combatants: [] }), null, 'nessun boss vivo: nessuna ombra');
      html.dataset.bossEffects = 'off';
      eq(getComputedStyle(v).display, 'none', 'effetti disattivati: niente ombra');
      delete html.dataset.bossEffects;
      eq(getComputedStyle(v).display, 'block');
      // Riduci animazioni: banner statico, nessun lampo, evocazione saltata.
      const hadReduce = 'reduceMotion' in html.dataset;
      html.dataset.reduceMotion = '';
      const banner = DnD.uiBoss.applyTheme(document.createElement('div'), 'infernale');
      banner.className += ' boss-banner';
      document.body.append(banner);
      eq(getComputedStyle(banner).animationName, 'none', 'banner senza animazione');
      banner.remove();
      if (!hadReduce) delete html.dataset.reduceMotion;
      const orig = DnD.impostazioni.reduceMotion;
      DnD.impostazioni.reduceMotion = () => true;
      let done = false;
      DnD.uiBoss.summon({ name: 'X', boss: { theme: 'gelo', title: '' } }, null, () => { done = true; });
      DnD.uiBoss.flash('gelo');
      DnD.impostazioni.reduceMotion = orig;
      ok(done && !document.querySelector('.boss-summon') && !document.querySelector('.boss-flash'), 'senza animazioni: niente evocazione né lampo');
    } finally {
      v.remove();
      btn.remove();
    }
  });

  // --- Layout della schermata Combattimento ---
  const LC = () => DnD.layoutCombattimento;

  test('Layout combattimento: salvataggio e ripristino di larghezze e stato, limiti, reimposta', () => {
    const st = fakeStorage();
    eq(LC().load(st), { left: 340, right: 300, leftOpen: true, rightOpen: true, tab: 'entita' }, 'predefiniti');
    ok(LC().save(st, { left: 420, right: 260, leftOpen: false, rightOpen: true, tab: 'turni' }));
    eq(LC().load(st), { left: 420, right: 260, leftOpen: false, rightOpen: true, tab: 'turni' }, 'ripristino');
    st.setItem(LC().KEY, '{"left":"x","right":10,"leftOpen":0,"tab":"altro"}');
    eq(LC().load(st), { left: 340, right: 240, leftOpen: true, rightOpen: true, tab: 'entita' }, 'valori non validi');
    st.setItem(LC().KEY, '{rotto');
    eq(LC().load(st).left, 340, 'JSON danneggiato');
    eq(LC().reset(st), LC().normalize(null), 'reimposta');
    eq(LC().load(st), LC().normalize(null), 'reimposta salvato');
    // Min 240 px, max 40% del layout.
    eq([LC().clamp(100, 1500), LC().clamp(900, 1500), LC().clamp(500, 1500), LC().clamp(300, 400)], [240, 600, 500, 240]);
    // Prima volta: si riprende la larghezza delle schede del layout precedente.
    const old = fakeStorage();
    old.setItem('dnd-battaglie:larghezza-schede', '480');
    eq(LC().load(old).left, 480);
    eq([LC().isNarrow(1099), LC().isNarrow(1100)], [true, false], 'sotto i 1100 px: schede');
  });

  // Schermata del combattimento in un contenitore di prova, con un archivio in memoria (i dati veri non si toccano).
  async function withCombatScreen(fn) {
    const mem = new Map();
    const backend = { name: 'memoria', get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, clear: async () => mem.clear() };
    const prevStore = DnD.store;
    const prevLayout = localStorage.getItem(LC().KEY);
    DnD.store = await DnD.dati.openStore({ getItem: () => null, setItem() {}, removeItem() {} }, { backend });
    const st = DnD.store.state;
    const hero = DnD.dati.normalizeCreature({ name: 'Aria', classId: 'guerriero', maxHp: 20 }, true);
    const gob = DnD.dati.normalizeCreature({ name: 'Goblin', maxHp: 7 }, false);
    const cs = DnD.combattenti.createCombatants([hero], [{ npc: gob, quantity: 1 }], [], seq(10, 5), [], []);
    cs[0].pos = { x: 2, y: 2 };
    cs[1].pos = { x: 6, y: 3 };
    DnD.store.update((s) => { S().current(s).combat = DnD.dati.normalizeSession({ combat: { phase: 'attivo', round: 1, currentId: cs[0].id, combatants: cs, grid: { w: 20, h: 12 } } }).combat; });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:1500px;height:900px;overflow:hidden;z-index:-1;background:var(--bg)';
    document.body.append(box);
    try {
      localStorage.removeItem(LC().KEY);
      DnD.sezioni.combattimento.render(box);
      await fn(box, DnD.store.state);
    } finally {
      box.remove();
      DnD.store = prevStore;
      if (prevLayout === null) localStorage.removeItem(LC().KEY); else localStorage.setItem(LC().KEY, prevLayout);
    }
  }
  // Attende qualche frame (con un tempo massimo: in una scheda nascosta i frame non arrivano).
  const frames = (n) => Promise.race([
    new Promise((res) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : res()); step(n || 2); }),
    new Promise((res) => setTimeout(res, 150 * (n || 2))),
  ]);
  const hasCombatUi = () => typeof document !== 'undefined' && DnD.sezioni && DnD.sezioni.combattimento && typeof ResizeObserver === 'function';

  test('Layout combattimento: tre colonne, chiusura, divisori, reimposta layout', async () => {
    if (!hasCombatUi()) return;
    await withCombatScreen(async (box) => {
      const layout = box.querySelector('.combat-layout');
      const cols = [...layout.children].filter((x) => x.matches('.combat-entities, .combat-center, .combat-turns')).map((x) => x.className.split(' ').pop());
      eq(cols, ['combat-entities', 'combat-center', 'combat-turns'], 'entità | griglia | turni');
      ok(box.querySelector('.combat-entities .combatant') && box.querySelector('.combat-center .grid-canvas') && box.querySelector('.combat-turns .turn-order') &&
        box.querySelector('.combat-turns .ai-panel') && box.querySelector('.combat-turns .log'), 'pannelli nelle colonne giuste');
      ok(/Termina combattimento/.test(box.querySelector('.section-head').textContent), 'Termina combattimento in alto');
      await frames();
      const w = (sel) => Math.round(box.querySelector(sel).getBoundingClientRect().width);
      if (LC().isNarrow(window.innerWidth)) {
        // Finestra stretta: griglia in alto e schede Entità/Turni, una visibile alla volta.
        const shown = (sel) => getComputedStyle(box.querySelector(sel)).display !== 'none';
        ok(shown('.combat-tabs') && shown('.combat-entities') && !shown('.combat-turns'), 'schede sotto la griglia');
        box.querySelector('[data-layout-tab="turni"]').click();
        ok(shown('.combat-turns') && !shown('.combat-entities'), 'scheda Turni');
        eq(JSON.parse(localStorage.getItem(LC().KEY)).tab, 'turni', 'scheda ricordata');
        return;
      }
      eq([w('.combat-entities'), w('.combat-turns')], [340, 300], 'larghezze predefinite');
      box.querySelector('[data-collapse="left"]').click();
      ok(layout.classList.contains('left-closed') && w('.combat-entities') < 60, 'colonna sinistra chiusa');
      eq(JSON.parse(localStorage.getItem(LC().KEY)).leftOpen, false, 'stato ricordato');
      const d = box.querySelector('[data-divider="right"]');
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      eq(JSON.parse(localStorage.getItem(LC().KEY)).right, 320, 'divisore da tastiera (la colonna destra si allarga verso sinistra)');
      [...box.querySelectorAll('button')].find((b) => b.textContent === 'Reimposta layout').click();
      eq([layout.classList.contains('left-closed'), w('.combat-entities'), w('.combat-turns')], [false, 340, 300], 'reimposta layout');
    });
  });

  test('Layout combattimento: conversione schermo/cella dopo il ridimensionamento e selezione sincronizzata', async () => {
    if (!hasCombatUi()) return;
    await withCombatScreen(async (box, st) => {
      const canvas = box.querySelector('.combat-center .grid-canvas');
      canvas.setPointerCapture = () => {};
      const grid = DnD.uiCombattimento.getGrid();
      const view = grid.view();
      const zoom = view.zoom;
      const goblin = S().current(st).combat.combatants.find((x) => x.name === 'Goblin');
      // Clic al centro della cella della pedina, calcolato dalla posizione attuale del canvas.
      const clickCell = (x, y) => {
        const r = canvas.getBoundingClientRect();
        const s = G().CELL_PX * grid.view().zoom;
        const opt = { bubbles: true, button: 0, pointerId: 1, clientX: r.left + grid.view().panX + (x + 0.5) * s, clientY: r.top + grid.view().panY + (y + 0.5) * s };
        canvas.dispatchEvent(new PointerEvent('pointerdown', opt));
        canvas.dispatchEvent(new PointerEvent('pointerup', opt));
      };
      await frames();
      const before = canvas.getBoundingClientRect().left;
      box.querySelector('[data-collapse="left"]').click();
      await frames(3);
      if (!LC().isNarrow(window.innerWidth)) ok(canvas.getBoundingClientRect().left < before - 200, 'la griglia si allarga quando la colonna si chiude');
      eq(grid.view().zoom, zoom, 'lo zoom non cambia');
      // Il ridisegno passa da requestAnimationFrame: si verifica solo se il browser fornisce i frame
      // (non li fornisce, ad esempio, in una scheda nascosta o in un pannello sospeso).
      const rafOk = await Promise.race([new Promise((res) => requestAnimationFrame(() => res(true))), new Promise((res) => setTimeout(() => res(false), 300))]);
      if (rafOk) {
        for (let i = 0; i < 10 && Math.abs(canvas.width / (window.devicePixelRatio || 1) - canvas.getBoundingClientRect().width) > 1.5; i++) await frames(2);
        ok(Math.abs(canvas.width / (window.devicePixelRatio || 1) - canvas.getBoundingClientRect().width) <= 1.5,
          'il canvas si ridisegna alla nuova larghezza (' + canvas.width + ' px per ' + canvas.getBoundingClientRect().width + ')');
      }
      clickCell(goblin.pos.x, goblin.pos.y);
      const card = box.querySelector('.combatant[data-id="' + goblin.id + '"]');
      ok(card.classList.contains('selected'), 'clic sulla pedina dopo il ridimensionamento: selezionata la scheda giusta');
      // Dalla scheda alla pedina.
      const hero = S().current(st).combat.combatants.find((x) => x.name === 'Aria');
      box.querySelector('.combatant[data-id="' + hero.id + '"]').click();
      ok(box.querySelector('.combatant[data-id="' + hero.id + '"]').classList.contains('selected') && !card.classList.contains('selected'), 'clic sulla scheda');
      ok(box.querySelector('.combat-turns .turn-order li.current') && box.querySelector('.combatant.current'), 'turno corrente evidenziato in scheda e lista');
      eq(view, grid.view(), 'stessa vista: posizione conservata');
    });
  });

  // --- Esplorazione: biomi, eventi, gruppo, tempo, nebbia ---
  const BI = () => DnD.biomi;
  const EV = () => DnD.eventi;
  const XP = () => DnD.esplorazione;

  // Mondo di prova: archivio vuoto con i biomi d'esempio, due giocatori e una mappa 10×10 (pianura di base).
  function exploreWorld(opts) {
    opts = opts || {};
    const st = DnD.dati.emptyState();
    const sess = S().current(st);
    const mk = (id, name, ab) => Object.assign(DnD.dati.normalizeCreature({ id, name, classId: 'guerriero', maxHp: 20, abilities: ab }, true), { sessionId: sess.id });
    st.players = [mk('p1', 'Aria', { FOR: 16, DES: 14, COS: 14, INT: 10, SAG: 12, CAR: 8 }), mk('p2', 'Brun', { FOR: 10, DES: 10, COS: 12, INT: 10, SAG: 10, CAR: 14 })];
    const grid = Object.assign(DnD.dati.normalizeSavedGrid({ id: 'mappa', name: 'Valle', kind: 'esplorazione', w: 10, h: 10, zones: [{ kind: 'giocatori', x: 0, y: 0, w: 1, h: 1 }] }), { sessionId: sess.id });
    grid.biomeMap = BI().emptyMap(10, 10, 'bioma-pianura');
    st.savedGrids.push(grid);
    const ex = XP().create(grid, st.players, 7);
    sess.exploration = ex;
    return { st, ex, grid, rng: opts.rng };
  }

  test('Biomi: costo di movimento e ore per bioma, ritmo, modalità di viaggio e scala; sottobiomi', () => {
    const list = BI().examples();
    const by = new Map(list.map((b) => [b.id, b]));
    const R2 = (id) => BI().resolve(by.get(id), by);
    eq(list.length, 9, '8 biomi d\'esempio + un sottobioma');
    const f = R2('bioma-foresta');
    eq([BI().costFor(f, 'piedi'), BI().costFor(f, 'volo'), BI().hoursFor(f, 'piedi', 'normale', 1.5)], [2, 1, 8], 'foresta: 4 h × costo 2');
    eq([BI().hoursFor(f, 'piedi', 'lento', 1.5), BI().hoursFor(f, 'piedi', 'veloce', 1.5), BI().hoursFor(f, 'piedi', 'normale', 3)], [12, 6, 16], 'ritmo e scala');
    eq(BI().hoursFor(R2('bioma-pianura'), 'cavallo', 'normale', 1.5), 2.4, 'a cavallo più veloce');
    eq([BI().costFor(R2('bioma-montagna'), 'cavallo'), BI().hoursFor(R2('bioma-montagna'), 'cavallo', 'normale', 1.5)], [0, null], 'montagna impraticabile a cavallo');
    // Sottobioma: eredita ciò che non sovrascrive.
    const fi = R2('bioma-foresta-innevata');
    eq([fi.cost, fi.hoursPerCell, fi.light, fi.food, fi.weather.length, fi.hazards[0].name], [3, 4, 'penombra', 1, 3, 'Gelo tra gli alberi']);
    eq(by.get('bioma-foresta-innevata').hoursPerCell, null, 'campo da ereditare');
  });

  test('Mappa dei biomi: pennello, riempi, rettangolo, predefinito, ridimensionamento e generazione con seme', () => {
    const m = BI().emptyMap(6, 4, 'bioma-pianura');
    eq(BI().cellBiome(m, 6, 0, 0), 'bioma-pianura', 'cella vuota = predefinito');
    BI().paint(m, 6, 4, BI().rectCells({ x: 0, y: 0 }, { x: 2, y: 1 }), 'bioma-foresta');
    eq([BI().cellBiome(m, 6, 2, 1), BI().paintedBiome(m, 6, 3, 1)], ['bioma-foresta', '']);
    eq(BI().fillCells(m, 6, 4, { x: 1, y: 0 }).length, 6, 'riempi: area contigua della foresta');
    BI().paint(m, 6, 4, [{ x: 0, y: 0 }], '');
    eq(BI().cellBiome(m, 6, 0, 0), 'bioma-pianura', 'gomma');
    const r = BI().reshapeMap(m, 6, 4, 8, 4, 2, 0);
    eq([BI().paintedBiome(r, 8, 3, 0), BI().paintedBiome(r, 8, 0, 0)], ['bioma-foresta', ''], 'colonne aggiunte a sinistra');
    const a = BI().emptyMap(12, 12, '');
    const b = BI().emptyMap(12, 12, '');
    BI().generate(a, 12, 12, ['bioma-foresta', 'bioma-palude'], 99);
    BI().generate(b, 12, 12, ['bioma-foresta', 'bioma-palude'], 99);
    eq(a.cells, b.cells, 'stesso seme, stessa mappa');
    ok(!a.cells.includes('.') && BI().usedIds(a).length === 2, 'tutte le celle con i biomi scelti');
    eq(DnD.dati.normalizeSavedGrid({ kind: 'esplorazione', w: 6, h: 5, biomeMap: m }).biomeMap.cells, m.cells + '......', 'normalizzazione conservata (altezza minima 5: riga vuota aggiunta)');
  });

  test('Esplorazione: passo, ore, ritmo, percorso che evita le celle impraticabili', () => {
    const w = exploreWorld();
    // Una colonna di montagna (x = 2) con un varco in basso (y = 9).
    BI().paint(w.grid.biomeMap, 10, 10, BI().rectCells({ x: 2, y: 0 }, { x: 2, y: 8 }), 'bioma-montagna');
    w.ex.mode = 'cavallo';
    const r = XP().step(w, { x: 1, y: 0 });
    eq([r.ok, r.hours, w.ex.time.hour], [true, 2.4, 10.4], 'pianura a cavallo: 3 h × 0,8');
    eq(XP().step(w, { x: 2, y: 0 }).ok, false, 'montagna impraticabile a cavallo');
    eq(XP().step(w, { x: 5, y: 5 }).reason, 'non adiacente');
    const p = XP().path(w, { x: 1, y: 0 }, { x: 4, y: 0 });
    ok(p && p.cells.some((c) => c.y === 9 && c.x === 2) && !p.cells.some((c) => c.x === 2 && c.y < 9), 'il percorso passa dal varco');
    BI().paint(w.grid.biomeMap, 10, 10, [{ x: 2, y: 9 }], 'bioma-montagna');
    eq(XP().path(w, { x: 1, y: 0 }, { x: 4, y: 0 }), null, 'nessun percorso se il varco si chiude');
    w.ex.mode = 'piedi';
    w.ex.pace = 'lento';
    const t0 = w.ex.time.total;
    XP().step(w, { x: 2, y: 1 });
    eq(Math.round((w.ex.time.total - t0) * 100) / 100, 27, 'montagna a piedi, lento: 6 h × 3 × 1,5');
  });

  test('Esplorazione: scorte, meteo ogni 8 ore e pericoli ambientali con seme', () => {
    const w = exploreWorld();
    const food = w.ex.supplies.food;
    XP().advanceTime(w, 24);
    eq([w.ex.time.day, Math.round((food - w.ex.supplies.food) * 100) / 100], [2, 2], 'un giorno in pianura: 1 razione a testa');
    ok(w.ex.weather && ['Sereno', 'Vento forte', 'Temporale'].includes(w.ex.weather.name), 'meteo della pianura');
    // Deserto: calura ogni 4 ore (TS COS CD 12). Tiri forzati: Aria 20 (riesce), Brun 1 (fallisce), poi 4 controlli d'incontro.
    BI().paint(w.grid.biomeMap, 10, 10, [{ x: 0, y: 0 }], 'bioma-deserto');
    w.ex.hazardTimers = {};
    w.rng = seq(20, 1, 100, 100, 100, 100);
    XP().advanceTime(w, 4);
    eq([w.ex.members.p1.exhaustion, w.ex.members.p2.exhaustion], [0, 1], 'chi fallisce subisce lo sfinimento');
    ok(w.ex.log.some((l) => /Calura/.test(l.text) && /Brun/.test(l.text)), 'nel registro');
  });

  test('Esplorazione: incontri casuali per bioma (d100 con seme) e tabella pesata', () => {
    const w = exploreWorld();
    const b = BI().normalizeBiome({ id: 'b', encounterChance: 30, encounters: [{ kind: 'creatura', refId: 'esempio-cinghiale-paludi', weight: 3, qty: '1d4' }, { kind: 'evento', refId: 'evento-viandante', weight: 1 }] });
    const r1 = BI().rollEncounter(b, seq(45), w.st.npcs);
    eq([r1.roll, r1.hit], [45, false], '45 > 30: niente');
    const r2 = BI().rollEncounter(b, seq(12, 2, 3), w.st.npcs);
    eq([r2.hit, r2.row.kind, r2.qty], [true, 'creatura', 3], 'peso 3 su 4, quantità 1d4');
    const a = BI().rollEncounter(b, BI().seededRng(5), w.st.npcs);
    const c = BI().rollEncounter(b, BI().seededRng(5), w.st.npcs);
    eq(a, c, 'stesso seme, stesso risultato');
    w.st.biomes.push(b);
    BI().paint(w.grid.biomeMap, 10, 10, [{ x: 0, y: 0 }], 'b');
    w.rng = seq(10, 1, 2);
    XP().checkEncounter(w, XP().biomeAt(w, 0, 0));
    eq(w.ex.queue.map((q) => [q.kind, q.encounter.refId, q.encounter.qty]), [['incontro', 'esempio-cinghiale-paludi', 2]], 'finestra di incontro in coda');
    const missing = BI().rollEncounter(BI().normalizeBiome({ encounterChance: 100, encounters: [{ kind: 'creatura', refId: 'non-esiste' }] }), seq(1, 1), w.st.npcs);
    ok(missing.missing, 'creatura eliminata segnalata');
  });

  test('Eventi: innesco per entrata, area e tempo; ripetibilità una volta e N volte; istanze indipendenti', () => {
    const w = exploreWorld();
    const tpl = EV().normalizeEvent({ name: 'Trappola', trigger: { kind: 'entrata' }, repeat: { kind: 'n', times: 2 }, actions: [{ kind: 'nota', text: 'clic' }] });
    const a = EV().instantiate(tpl, [{ x: 1, y: 0 }, { x: 3, y: 3 }]);
    const b = EV().instantiate(tpl, [{ x: 5, y: 5 }]);
    w.grid.events = [a, b];
    XP().step(w, { x: 1, y: 0 });
    eq(w.ex.queue.map((q) => q.instanceId), [a.id], 'entrata nell\'area (anche non contigua)');
    XP().fireEvent(w, a, {});
    XP().fireEvent(w, a, {});
    eq([a.state.fired, b.state.fired], [2, 0], 'istanze indipendenti dallo stesso modello');
    eq(EV().canFire(a, XP().eventCtx(w)).ok, false, 'N volte: esaurito');
    eq(EV().canFire(b, XP().eventCtx(w)).ok, true);
    tpl.name = 'Cambiato';
    eq(a.event.name, 'Trappola', 'il modello non cambia le copie');
    eq(EV().updateFromTemplate(a, tpl).event.name, 'Cambiato', 'Aggiorna dal modello (esplicito)');
    eq(EV().movementTriggers([a], { x: 1, y: 0 }, { x: 1, y: 0 }).length, 0, 'entrata: restare nell\'area non riscatta');
    const once = EV().instantiate(EV().normalizeEvent({ repeat: { kind: 'una' } }), [{ x: 0, y: 0 }]);
    EV().markFired(once, 0);
    eq(EV().canFire(once, XP().eventCtx(w)).reason, 'già innescato');
    // Tempo: dopo 10 ore dal piazzamento.
    const timed = EV().instantiate(EV().normalizeEvent({ trigger: { kind: 'tempo', hours: 10 }, repeat: { kind: 'sempre' } }), [{ x: 9, y: 9 }], w.ex.time.total);
    w.grid.events.push(timed);
    w.ex.queue = [];
    XP().advanceTime(w, 6);
    eq(w.ex.queue.some((q) => q.instanceId === timed.id), false, 'prima del tempo');
    XP().advanceTime(w, 5);
    eq(w.ex.queue.some((q) => q.instanceId === timed.id), true, 'dopo 10 ore');
  });

  test('Eventi: nascosto con prova di scoperta, poi visibile', () => {
    const w = exploreWorld();
    const inst = EV().instantiate(EV().normalizeEvent({ name: 'Botola', visibility: { kind: 'scoperta', dc: 15, skill: 'Percezione', who: 'migliore' } }), [{ x: 2, y: 0 }]);
    w.grid.events = [inst];
    eq(EV().isVisible(inst), false);
    w.rng = seq(5);
    eq(EV().tryDiscover(inst, XP().eventCtx(w)).success, false, '5 + 1 < 15');
    w.rng = seq(14);
    eq(EV().tryDiscover(inst, XP().eventCtx(w)).success, true, '14 + 1 = 15');
    ok(EV().isVisible(inst), 'dopo la scoperta è visibile');
    // Scoperta automatica avvicinandosi.
    const w2 = exploreWorld();
    const hid = EV().instantiate(EV().normalizeEvent({ visibility: { kind: 'scoperta', dc: 5 } }), [{ x: 2, y: 0 }]);
    w2.grid.events = [hid];
    XP().step(w2, { x: 1, y: 0 });
    ok(hid.state.discovered && w2.ex.log.some((l) => /scopre/.test(l.text)), 'scoperta passando accanto');
  });

  test('Eventi: prova con successo e fallimento, prova di gruppo, esito scelto dal master', () => {
    const w = exploreWorld();
    const ev = EV().normalizeEvent({ actions: [{ kind: 'prova', what: 'Atletica', dc: 13, who: 'gruppo', group: true,
      success: [{ kind: 'variabile', name: 'esito', value: 'ok' }], failure: [{ kind: 'variabile', name: 'esito', value: 'ko' }, { kind: 'danno', dice: '1d6', targets: 'gruppo' }] }] });
    // Aria +3, Brun +0: 10 → 13 ✓, 12 → 12 ✗ → metà riesce: successo di gruppo.
    w.rng = seq(10, 12);
    XP().fireEvent(w, { event: ev }, {});
    eq(w.ex.variables.esito, 'ok', 'prova di gruppo: basta metà');
    ev.actions[0].group = false;
    w.rng = seq(10, 12, 4);
    XP().fireEvent(w, { event: ev }, {});
    eq([w.ex.variables.esito, w.ex.members.p1.hp, w.ex.members.p2.hp], ['ko', 16, 16], 'senza prova di gruppo servono tutti; danno 1d6 = 4 a testa');
    w.rng = seq(1, 1);
    XP().fireEvent(w, { event: ev }, { [ev.actions[0].id]: 'successo' });
    eq(w.ex.variables.esito, 'ok', 'esito cambiato a mano');
    const best = EV().resolveCheck({ what: 'Persuasione', dc: 12, who: 'migliore' }, Object.assign(XP().eventCtx(w), { rng: seq(10) }));
    eq([best.results.length, best.results[0].name, best.results[0].total, best.success], [1, 'Brun', 12, true], 'il migliore (CAR 14)');
  });

  test('Eventi: catena con variabili e condizioni, tabella casuale con seme, ricompensa', () => {
    const w = exploreWorld();
    const key = EV().normalizeEvent({ id: 'chiave', name: 'Chiave', actions: [{ kind: 'variabile', name: 'chiave trovata', value: 'vero' }, { kind: 'attiva', eventId: 'forziere' }] });
    const chest = EV().normalizeEvent({ id: 'forziere', name: 'Forziere', conditions: [{ kind: 'variabile', name: 'chiave trovata', op: '=', value: 'true' }],
      actions: [{ kind: 'ricompensa', xp: 100, coins: { mo: 30 } }] });
    const ci = EV().instantiate(chest, [{ x: 5, y: 5 }]);
    w.grid.events = [ci];
    eq(EV().canFire(ci, XP().eventCtx(w)).reason, 'condizioni non soddisfatte', 'senza chiave');
    XP().fireEvent(w, { event: key }, {});
    eq([w.ex.variables['chiave trovata'], ci.state.fired, w.ex.members.p1.xp, w.st.players[0].coins.mo], [true, 1, 50, 30], 'la chiave apre il forziere collegato');
    // Condizioni: ora del giorno (anche a cavallo della mezzanotte) e numero.
    const ctx = XP().eventCtx(w);
    w.ex.time.hour = 23;
    ok(EV().conditionsMet([EV().normalizeCondition({ kind: 'ora', from: 22, to: 4 })], ctx), 'notte');
    w.ex.variables.n = 3;
    ok(EV().conditionsMet([EV().normalizeCondition({ kind: 'variabile', name: 'n', op: '>=', value: '2' })], ctx), 'numero ≥');
    // Tabella casuale: stesso seme, stessa riga.
    const tab = EV().normalizeEvent({ actions: [{ kind: 'tabella', dice: '1d6', rows: [{ min: 1, max: 3, actions: [{ kind: 'variabile', name: 'riga', value: 'bassa' }] }, { min: 4, max: 6, actions: [{ kind: 'variabile', name: 'riga', value: 'alta' }] }] }] });
    w.rng = BI().seededRng(123);
    XP().fireEvent(w, { event: tab }, {});
    const first = w.ex.variables.riga;
    w.rng = BI().seededRng(123);
    w.ex.variables.riga = '';
    XP().fireEvent(w, { event: tab }, {});
    eq(w.ex.variables.riga, first, 'seme riproducibile');
    w.rng = seq(5);
    XP().fireEvent(w, { event: tab }, {});
    eq(w.ex.variables.riga, 'alta', '5 → riga 4–6');
  });

  test('Eventi: «Entra in una mappa» con ritorno nello stesso punto e pila annidata; combattimento in pausa', () => {
    const w = exploreWorld();
    const dungeon = Object.assign(DnD.dati.normalizeSavedGrid({ id: 'dungeon', name: 'Cripta', kind: 'esplorazione', w: 8, h: 8 }), { sessionId: w.grid.sessionId });
    const cella = Object.assign(DnD.dati.normalizeSavedGrid({ id: 'cella', name: 'Cella segreta', w: 6, h: 6 }), { sessionId: w.grid.sessionId });
    w.st.savedGrids.push(dungeon, cella);
    XP().step(w, { x: 1, y: 1 });
    XP().fireEvent(w, { event: EV().normalizeEvent({ actions: [{ kind: 'mappa', gridId: 'dungeon', entry: { x: 3, y: 4 } }] }) }, {});
    eq([w.ex.gridId, w.ex.stack.length, XP().activeParty(w.ex).pos], ['dungeon', 1, { x: 3, y: 4 }]);
    XP().fireEvent(w, { event: EV().normalizeEvent({ actions: [{ kind: 'mappa', gridId: 'cella', entry: { x: 0, y: 0 } }] }) }, {});
    eq([w.ex.gridId, w.ex.stack.map((s) => s.gridId)], ['cella', ['mappa', 'dungeon']], 'annidata');
    ok(XP().exitMap(w.ex) && w.ex.gridId === 'dungeon' && XP().activeParty(w.ex).pos.x === 3, 'esce nel dungeon');
    ok(XP().exitMap(w.ex) && w.ex.gridId === 'mappa' && XP().activeParty(w.ex).pos.x === 1 && XP().activeParty(w.ex).pos.y === 1, 'torna nello stesso punto');
    eq(XP().exitMap(w.ex), false, 'pila vuota');
    // Combattimento: l'evento si ferma e riprende dopo l'esito.
    w.grid = w.st.savedGrids.find((g) => g.id === 'mappa');
    const ev = EV().normalizeEvent({ name: 'Agguato', actions: [{ kind: 'combattimento', foes: [{ npcId: 'esempio-cinghiale-paludi', qty: '2' }] }, { kind: 'nota', text: 'Esito: {esito combattimento}' }] });
    const res = XP().fireEvent(w, { event: ev }, {});
    ok(res.pause && w.ex.pending && w.ex.pending.rest.length === 1, 'in pausa');
    XP().resumeAfterCombat(w, 'fuga');
    ok(!w.ex.pending && w.ex.log.some((l) => l.text === '📝 Esito: fuga'), 'ripresa con l\'esito');
  });

  test('Eventi: riferimenti mancanti (creatura, mappa, oggetto) segnalati senza rompere', () => {
    const w = exploreWorld();
    const ev = EV().normalizeEvent({ actions: [{ kind: 'mappa', gridId: 'sparita' }, { kind: 'ricompensa', items: [{ equipmentId: 'oggetto-sparito', qty: 1 }] },
      { kind: 'prova', what: 'Atletica', failure: [{ kind: 'combattimento', foes: [{ npcId: 'creatura-sparita', qty: '1' }] }] }] });
    const miss = EV().missingRefs(ev, w.st);
    ok(miss.some((m) => /mappa/.test(m)) && miss.some((m) => /oggetto/.test(m)) && miss.some((m) => /creatura/.test(m)), miss.join('; '));
    w.rng = seq(1, 1);
    XP().fireEvent(w, { event: ev }, {});
    ok(w.ex.gridId === 'mappa' && w.ex.log.some((l) => /mappa collegata mancante/.test(l.text)) && w.ex.log.some((l) => /creature non più presenti/.test(l.text)), 'avvisi nel registro, la mappa resta');
  });

  test('Esplorazione: nebbia di scoperta, rivela/nascondi a mano', () => {
    const w = exploreWorld();
    w.grid.fog.enabled = true;
    eq(XP().isSeen(w.grid, 0, 0), false);
    XP().reveal(w);
    const r = BI().resolve(w.st.biomes.find((b) => b.id === 'bioma-pianura'), new Map(w.st.biomes.map((b) => [b.id, b]))).discovery;
    ok(XP().isSeen(w.grid, 0, 0) && XP().isSeen(w.grid, r, 0) && !XP().isSeen(w.grid, r + 2, 0), 'raggio di scoperta del bioma (' + r + ')');
    XP().setSeen(w.grid, [{ x: 9, y: 9 }], true);
    XP().setSeen(w.grid, [{ x: 0, y: 0 }], false);
    eq([XP().isSeen(w.grid, 9, 9), XP().isSeen(w.grid, 0, 0)], [true, false], 'a mano');
    w.grid.fog.enabled = false;
    ok(XP().isSeen(w.grid, 5, 5), 'nebbia spenta: tutto visibile');
  });

  test('Esplorazione: salvataggio e ripristino, esportazione e importazione, duplicazione di sessione', () => {
    const w = exploreWorld();
    w.grid.events = [EV().instantiate(w.st.events.find((e) => e.id === 'evento-ingresso-dungeon'), [{ x: 4, y: 4 }])];
    w.grid.events[0].event.actions[1].gridId = 'mappa';
    w.grid.fog.enabled = true;
    XP().step(w, { x: 1, y: 0 });
    w.ex.variables.prova = 3;
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(w.st));
    const e2 = S().current(back).exploration;
    eq([e2.gridId, e2.parties[0].pos, e2.time.total, e2.variables.prova, e2.log.length], [w.ex.gridId, { x: 1, y: 0 }, w.ex.time.total, 3, w.ex.log.length], 'stato ripristinato');
    const g2 = back.savedGrids.find((g) => g.id === 'mappa');
    eq([g2.kind, g2.biomeMap.cells, g2.events.length, g2.fog.enabled], ['esplorazione', w.grid.biomeMap.cells, 1, true]);
    // File di sessione: biomi ed eventi usati inclusi; all'importazione gli id delle griglie si aggiornano.
    const file = JSON.parse(JSON.stringify(S().exportSession(w.st, S().current(w.st).id)));
    ok(file.biomes.some((b) => b.id === 'bioma-pianura') && file.events.some((e) => e.id === 'evento-ingresso-dungeon'), 'biomi ed eventi nel file');
    const dst = DnD.dati.emptyState();
    dst.biomes = [];
    const imp = S().importSession(dst, file, DnD.dadi.uid);
    const ig = dst.savedGrids.find((g) => g.name === 'Valle');
    eq([imp.exploration.gridId, ig.events[0].event.actions[1].gridId, dst.biomes.length > 0], [ig.id, ig.id, true], 'riferimenti aggiornati');
    const dup = S().duplicateSession(w.st, S().current(w.st).id, 'Copia', DnD.dadi.uid);
    ok(dup.exploration && dup.exploration.gridId !== 'mappa' && w.st.savedGrids.some((g) => g.id === dup.exploration.gridId), 'duplicazione: esplorazione sulla copia della mappa');
  });

  test('Migrazione: le griglie esistenti restano di battaglia; arrivano biomi ed eventi d\'esempio', () => {
    const v9 = { version: 9, races: [], players: [], npcs: [], savedGrids: [{ id: 'g', name: 'Cripta', w: 20, h: 20 }] };
    const s = DnD.dati.normalizeState(v9);
    const g = s.savedGrids[0];
    eq([s.version, g.kind, g.biomeMap, g.events, g.fog.enabled, g.w], [DnD.dati.VERSION, 'battaglia', null, [], false, 20]);
    eq([s.biomes.length, s.events.length], [9, 8], 'esempi originali');
    eq(S().current(s).exploration, null);
    eq(DnD.dati.normalizeState({ version: 10, races: [], players: [], npcs: [], biomes: [], events: [] }).biomes.length, 0, 'librerie vuote rispettate');
  });

  // --- Personaggio leggendario ---
  const LG = () => DnD.leggendario;
  const PT = () => DnD.percorso;
  // Leggendario di prova: guerriero di livello `level` con un percorso piccolo (Nucleo → A → B, Nucleo → C).
  function legendaryOf(level, extra) {
    const path = { nodes: [{ id: 'nucleo', core: true }, { id: 'a', name: 'A', cost: 2, effects: [{ kind: 'caratteristica', ability: 'FOR', value: 4 }, { kind: 'bonus', stat: 'ca', value: 2 }] },
      { id: 'b', name: 'B', cost: 1, minRank: 3, effects: [{ kind: 'bonus', stat: 'pf', value: 15 }, { kind: 'competenza', target: 'ts', ability: 'SAG' }] },
      { id: 'c', name: 'C', cost: 1, exclusiveWith: 'd', effects: [{ kind: 'competenza', target: 'abilita', skill: 'Furtività', expertise: true }] },
      { id: 'd', name: 'D', cost: 1, effects: [] }],
    links: [['nucleo', 'a'], ['a', 'b'], ['nucleo', 'c'], ['nucleo', 'd']] };
    return DnD.dati.normalizeCreature(Object.assign({
      name: 'Eterna', type: 'leggendario', level, classId: 'guerriero', maxHp: 200, acMode: 'manuale', ac: 18, saveMode: 'classe',
      abilities: { FOR: 20, DES: 14, COS: 18, INT: 10, SAG: 12, CAR: 10 }, legend: { path, unlocked: ['nucleo'] },
    }, extra || {}), true);
  }

  test('Leggendari: livelli 20-40, bonus competenza, punti caratteristica, tetto 30, PF oltre il 20, punti percorso', () => {
    const R1 = R();
    eq([20, 21, 24, 25, 28, 29, 33, 37, 40].map((l) => R1.proficiencyBonus(l, true)), [6, 7, 7, 8, 8, 9, 10, 11, 11]);
    eq([R1.proficiencyBonus(20), R1.proficiencyBonus(30)], [6, 6], 'standard invariati');
    eq([R1.asiPointsAvailable(20), R1.asiPointsAvailable(24), R1.asiPointsAvailable(40)], [10, 12, 20]);
    eq(R1.finalAbilities({ FOR: 20 }, null, { FOR: 14 }, false, 30).FOR, 30, 'tetto 30');
    eq(R1.finalAbilities({ FOR: 20 }, null, { FOR: 14 }, false).FOR, 20, 'tetto 20 per gli standard');
    const c = legendaryOf(33);
    eq([c.type, c.level, c.abilityCap, LG().rank(c), DnD.combattenti.derivedStats(c, null).profBonus], ['leggendario', 33, 30, 13, 10]);
    eq(DnD.dati.normalizeCreature({ type: 'leggendario', level: 50 }, true).level, 40, 'massimo 40');
    eq(DnD.dati.normalizeCreature({ type: 'leggendario', level: 5 }, true).level, 20, 'minimo 20');
    eq(DnD.dati.normalizeCreature({ level: 33 }, true).type, undefined, 'giocatori standard senza tipo');
    // PF: d10 del guerriero per ogni livello oltre il 20 (media 6 + COS +4).
    const h20 = R1.computeHp({ level: 20, hitDie: 10, conMod: 4, method: 'media' }).total;
    const h25 = R1.computeHp({ level: 25, hitDie: 10, conMod: 4, method: 'media' }).total;
    eq(h25 - h20, 5 * 10, 'cinque livelli in più: 5 × (6 + 4)');
    eq(DnD.validazione.validateCreature(Object.assign({}, c, { level: 41 }), {}).level !== undefined, true, 'livello 41 non valido');
    eq(LG().points(c), { total: 13, spent: 0, left: 13 }, '1 punto per rango');
    eq(LG().points(legendaryOf(40, { legend: { pointsBonus: 3, path: c.legend.path } })).total, 23, 'massimo 20 + bonus del master');
  });

  test('Percorso: sblocco solo se collegato, con punti e rango; nodo esclusivo; prerequisiti multipli; rimodella', () => {
    const c = legendaryOf(22); // rango 2: 2 punti
    const p = c.legend.path;
    const ctx = { rank: 2, bonus: 0 };
    eq(PT().canUnlock(p, ['nucleo'], 'b', ctx).reason, 'serve il rango leggendario 3');
    eq(PT().canUnlock(p, ['nucleo'], 'b', { rank: 5 }).reason, 'non è collegato a un nodo sbloccato');
    let u = PT().unlock(p, ['nucleo'], 'a', ctx);
    eq([u.ok, u.unlocked], [true, ['nucleo', 'a']]);
    eq(PT().canUnlock(p, u.unlocked, 'c', ctx).reason, 'punti insufficienti (0 su 1)');
    u = PT().unlock(p, ['nucleo'], 'c', ctx);
    eq(PT().canUnlock(p, u.unlocked, 'd', ctx).reason, 'esclusivo con «C», già scelto');
    // Prerequisiti multipli: E richiede A e C entrambi.
    const p2 = PT().normalizePath(Object.assign(JSON.parse(JSON.stringify(p)), { nodes: p.nodes.concat({ id: 'e', name: 'E', cost: 1, requires: ['a', 'c'], requireAll: true }) }));
    eq(PT().canUnlock(p2, ['nucleo', 'a'], 'e', { rank: 10 }).reason, 'mancano i prerequisiti: C');
    eq(PT().canUnlock(p2, ['nucleo', 'a', 'c'], 'e', { rank: 10 }).ok, true, 'con tutti i prerequisiti (anche senza collegamento)');
    eq(PT().respec(), ['nucleo']);
    eq(PT().available(p, ['nucleo'], { rank: 10 }).sort(), ['a', 'c', 'd']);
  });

  test('Percorso: effetti applicati ai calcoli e rimossi al rimborso; nuove magie e slot extra', () => {
    const st = DnD.dati.emptyState();
    const c = legendaryOf(30);
    const base = LG().derived(c, st).stats;
    c.legend.unlocked = ['nucleo', 'a', 'b', 'c'];
    const d = LG().derived(c, st);
    eq([d.stats.abilities.FOR, d.stats.ac.total, d.effective.maxHp, d.stats.saves.includes('SAG'), d.fx.skills['Furtività']], [24, 20, 215, true, 2]);
    ok(d.fx.sources.some((s) => s.from === 'A' && /FOR \+4/.test(s.label)) && d.fx.sources.some((s) => s.from === 'B' && /PF/.test(s.label)), 'dettaglio «da: nodo»');
    c.legend.unlocked = PT().respec();
    const back = LG().derived(c, st).stats;
    eq([back.abilities.FOR, back.ac.total, back.saves.includes('SAG')], [base.abilities.FOR, 18, false], 'rimborso: effetti tolti');
    // Incantatore: magia fuori lista e slot extra.
    const spell = st.spells[0];
    const mage = legendaryOf(25, { classId: 'mago', spellcasting: { known: [] } });
    mage.legend.path.nodes.push(PT().normalizeNode({ id: 'm', cost: 1, effects: [{ kind: 'magia', spellId: spell.id }, { kind: 'slot', level: 9, count: 2 }, { kind: 'bonus', stat: 'cd', value: 1 }] }));
    mage.legend.path.links.push(['nucleo', 'm']);
    const before = LG().derived(mage, st).stats.spell;
    mage.legend.unlocked = ['nucleo', 'm'];
    const after = LG().derived(mage, st);
    eq([after.effective.spellcasting.known.includes(spell.id), after.stats.spell.slotsTotal[8] - before.slotsTotal[8], after.stats.spell.dc - before.dc], [true, 2, 1]);
    // Incantesimo eliminato: effetto disattivato con avviso.
    st.spells = st.spells.filter((s) => s.id !== spell.id);
    ok(LG().effects(mage, st).missing.some((m) => /incantesimo eliminato/.test(m)), 'riferimento mancante');
  });

  test('Percorso: competenze nelle abilità nelle prove, Percezione passiva, sensi, magie «N al giorno» con usi', () => {
    const st = DnD.dati.emptyState();
    // Guerriero 30 (competenza +9, DES 14: +2, SAG 12: +1); il nodo C dà maestria in Furtività.
    const c = legendaryOf(30);
    c.legend.path.nodes.push(PT().normalizeNode({ id: 'v', cost: 1, effects: [{ kind: 'competenza', target: 'abilita', skill: 'Percezione' }, { kind: 'bonus', stat: 'senso', sense: 'vista cieca', value: 9 }] }));
    c.legend.path.links.push(['nucleo', 'v']);
    eq([LG().checkBonus(c, 'Furtività', false, st), LG().checkBonus(c, 'Percezione', false, st), LG().derived(c, st).passive], [2, 1, 11], 'senza nodi: solo il modificatore');
    c.legend.unlocked = ['nucleo', 'c', 'v', 'a'];
    eq([LG().checkBonus(c, 'Furtività', false, st), LG().checkBonus(c, 'Percezione', false, st), LG().checkBonus(c, 'Atletica', false, st), LG().checkBonus(c, 'FOR', true, st)],
      [2 + 18, 1 + 9, 7, 7 + 9], 'maestria ×2, competenza ×1; FOR 24 dal nodo A anche nelle prove');
    const d = LG().derived(c, st);
    eq([d.passive, d.skills.map((k) => k.skill + ':' + k.bonus)], [20, ['Furtività:20', 'Percezione:10']]);
    // Prova di un evento d'esplorazione: usa il bonus del leggendario.
    const ctx = { members: () => [c], st, rng: seq(10), ex: { rotation: 0 }, log() {} };
    eq(DnD.eventi.resolveCheck({ what: 'Furtività', dc: 30, who: 'migliore', mode: 'normale' }, ctx).results[0].total, 30, 'd20 (10) + 20');
    // Combattente: sensi e Percezione passiva.
    let x = DnD.combattenti.createCombatants([c], [], st.races, seq(10), st.spells, st.equipment)[0];
    eq([x.legend.senses['vista cieca'], x.legend.passive, DnD.dati.normalizeCombatant(x).legend.passive], [9, 20, 20]);
    // Magia 2 volte al giorno per un guerriero (non incantatore): si lancia senza slot, con la migliore tra INT, SAG, CAR.
    const spell = st.spells.find((s) => s.level > 0);
    c.legend.path.nodes.push(PT().normalizeNode({ id: 'g', cost: 1, effects: [{ kind: 'magia', spellId: spell.id, freq: 'giorno', uses: 2 }] }));
    c.legend.path.links.push(['nucleo', 'g']);
    c.legend.unlocked.push('g');
    c.legend.spellUses[spell.id] = 1;
    x = DnD.combattenti.createCombatants([c], [], st.races, seq(10), st.spells, st.equipment)[0];
    eq([x.spellcasting.ability, x.spellcasting.dc, x.spellcasting.spells.some((s) => s.id === spell.id), x.spellcasting.innate[spell.id]], ['SAG', 8 + 9 + 1, true, { freq: 'giorno', left: 1 }], 'un uso già speso oggi');
    eq(LG().derived(c, st).daily, [{ spellId: spell.id, n: 2, left: 1 }]);
    LG().rest(c, false);
    eq(c.legend.spellUses[spell.id], 1, 'il riposo breve non le ripristina');
    LG().rest(c, true);
    eq([c.legend.spellUses, LG().derived(c, st).daily[0].left], [{}, 2], 'riposo lungo');
    // Data anche come «sempre preparata»: resta un incantesimo normale (niente usi senza slot).
    c.legend.path.nodes.find((n) => n.id === 'g').effects.push({ id: 'g2', kind: 'magia', spellId: spell.id, freq: 'sempre', uses: 1 });
    eq(LG().dailySpells(c, st), {});
  });

  test('Percorso: privilegio creato dall\'utente con usi per riposo, come azione nel combattimento', () => {
    const st = DnD.dati.emptyState();
    const c = legendaryOf(24);
    c.legend.path.nodes.push(PT().normalizeNode({ id: 'f', cost: 1, name: 'Ira', effects: [{ kind: 'privilegio', name: 'Colpo divino', type: 'azione', uses: { kind: 'breve', n: 2 },
      mech: { kind: 'attacco', ability: 'FOR', damages: [{ dice: '4d8', type: 'radioso' }] } }] }));
    c.legend.path.links.push(['nucleo', 'f']);
    c.legend.unlocked = ['nucleo', 'f'];
    const x = DnD.combattenti.createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    const a = x.creature.actions.find((y) => y.name === 'Colpo divino');
    eq([a.freq.kind, a.freq.uses, x.creature.uses[a.id], a.mech.toHit], ['giorno', 2, 2, 7 + 5], 'competenza +7 e FOR +5');
    DnD.creature.consume(x.creature, a);
    eq(x.creature.uses[a.id], 1);
    c.legend.featureUses[c.legend.path.nodes.find((n) => n.id === 'f').effects[0].id] = 0;
    LG().rest(c, false);
    eq(Object.keys(c.legend.featureUses).length, 0, 'riposo breve: usi ripristinati');
  });

  test('Percorso: modifica del grafo (collega, scollega, elimina con collegamenti), irraggiungibili, cicli, modelli', () => {
    let p = PT().normalizePath({ nodes: [{ id: 'nucleo', core: true }] });
    const a = PT().addNode(p, { name: 'A' });
    p = a.path;
    const b = PT().addNode(p, { name: 'B' });
    p = PT().link(PT().link(b.path, 'nucleo', a.id), a.id, b.id);
    eq(p.links.length, 2);
    eq(PT().link(p, a.id, 'nucleo').links.length, 2, 'niente doppioni');
    eq(PT().unreachable(PT().unlink(p, 'nucleo', a.id)).sort(), [a.id, b.id].sort(), 'scollegati dal Nucleo');
    const r = PT().removeNodes(p, [a.id, 'nucleo']);
    eq([r.nodes.map((n) => n.id).includes('nucleo'), r.links.length], [true, 0], 'il Nucleo resta, i collegamenti del nodo spariscono');
    // Ciclo di esclusività a tre.
    const cyc = PT().normalizePath({ nodes: [{ id: 'nucleo', core: true }, { id: 'x', exclusiveWith: 'y' }, { id: 'y', exclusiveWith: 'z' }, { id: 'z', exclusiveWith: 'x' }], links: [['nucleo', 'x'], ['nucleo', 'y'], ['nucleo', 'z']] });
    ok(PT().validate(cyc).some((w) => /Ciclo di esclusività/.test(w)), 'ciclo segnalato');
    const ex = PT().example();
    eq([ex.nodes.length, PT().unreachable(ex), PT().exclusivityCycles(ex)], [13, [], []], 'percorso d\'esempio con ~12 nodi oltre al Nucleo, tutto raggiungibile');
    eq(PT().nodeById(ex, 'nucleo').x, 0, 'raggiera attorno al Nucleo');
    const d = PT().duplicateNodes(ex, ['n-vigore', 'n-pelle'], 30, 30);
    eq(d.path.nodes.length - ex.nodes.length, 2);
    ok(d.path.links.some((l) => d.ids.includes(l[0]) && d.ids.includes(l[1])), 'il collegamento tra i nodi copiati si copia');
    const tpl = PT().normalizeTemplate({ name: 'Mio', path: ex });
    eq(PT().normalizeTemplate(JSON.parse(JSON.stringify(tpl))).path.nodes.length, 13, 'modello: esporta/importa');
    const h = PT().history(50);
    h.push({ v: 1 });
    eq([h.undo({ v: 2 }), h.redo({ v: 1 })], [{ v: 1 }, { v: 2 }]);
  });

  test('Percorso: la raggiera tiene ogni ramo nello spicchio del suo genitore', () => {
    // Nucleo → A → A1, A2 e Nucleo → B → B1: i figli stanno più vicini al proprio genitore che all'altro ramo.
    const p = PT().radialLayout(PT().normalizePath({ nodes: [{ id: 'nucleo', core: true }, { id: 'a' }, { id: 'a1' }, { id: 'a2' }, { id: 'b' }, { id: 'b1' }, { id: 'solo' }],
      links: [['nucleo', 'a'], ['a', 'a1'], ['a', 'a2'], ['nucleo', 'b'], ['b', 'b1']] }), 100);
    const at = (id) => PT().nodeById(p, id);
    const dist = (x, y) => Math.hypot(at(x).x - at(y).x, at(x).y - at(y).y);
    ok(dist('a1', 'a') < dist('a1', 'b') && dist('a2', 'a') < dist('a2', 'b') && dist('b1', 'b') < dist('b1', 'a'), 'figli vicini al genitore');
    eq([Math.round(Math.hypot(at('a').x, at('a').y)), Math.round(Math.hypot(at('b1').x, at('b1').y)), Math.round(Math.hypot(at('solo').x, at('solo').y))], [100, 200, 300], 'anelli per distanza; irraggiungibili all\'esterno');
  });

  test('Leggendari: un nodo che alza la COS aumenta i PF massimi di 1 per livello per ogni punto di modificatore', () => {
    const st = { races: [], equipment: [], spells: [], players: [] };
    const c = legendaryOf(30); // COS 18 (+4)
    c.legend.path.nodes.push({ id: 'k', name: 'K', cost: 1, effects: [{ kind: 'caratteristica', ability: 'COS', value: 2 }, { kind: 'bonus', stat: 'pf', value: 5 }] });
    c.legend.path.links.push(['nucleo', 'k']);
    c.legend.path = PT().normalizePath(c.legend.path);
    eq(LG().effectivePlayer(c, st).maxHp, 200);
    c.legend.unlocked = ['nucleo', 'k'];
    eq(LG().effectivePlayer(c, st).maxHp, 200 + 5 + 30, 'COS 20 (+5): +1 × 30 livelli, più il bonus diretto');
  });

  // Trasformazione di prova: forma draconica 100 PF, CA 19, FOR 26, DES 10, COS 24; fasi a 50%.
  function formOf(extra) {
    return LG().normalizeTransformation(Object.assign({ id: 't1', name: 'Forma del drago', epithet: 'Ali d\'oro', theme: 'gelo', uses: { per: 'lungo', n: 1 }, duration: { unit: 'round', value: 2 },
      creature: { name: 'Drago d\'oro', size: 'Enorme', hitDice: 10, hpOverride: 100, ac: 19, abilities: { FOR: 26, DES: 10, COS: 24, INT: 8, SAG: 8, CAR: 8 },
        actions: [{ id: 'm', name: 'Morso', mech: { kind: 'attacco', damages: [{ dice: '2d10', type: 'perforante' }] } }],
        boss: { theme: 'gelo', phases: [{ threshold: 100 }, { threshold: 50, name: 'Furia' }] } } }, extra || {}));
  }

  test('Trasformazioni: regole di fusione, PF che passano al personaggio, usi, durata, fine anticipata, fasi del boss', () => {
    const st = DnD.dati.emptyState();
    const c = legendaryOf(30, { abilities: { FOR: 16, DES: 16, COS: 14, INT: 18, SAG: 15, CAR: 13 } });
    c.legend.transformations = [formOf()];
    const t = c.legend.transformations[0];
    let x = DnD.combattenti.createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    eq(x.legend.transformations, ['t1'], 'disponibile (nessun nodo richiesto)');
    x.hp = 150;
    const r = LG().transform(x, t);
    eq([r.ok, x.abilities.FOR, x.abilities.INT, x.maxHp, x.hp, x.ac, x.w, x.legend.uses.t1], [true, 26, 18, 100, 100, 19, 3, 0], 'FOR, DES, COS dalla forma; INT, SAG, CAR dal personaggio');
    eq([x.boss.title, x.boss.theme, DnD.boss.bars([x], 'giocatori').shown.length], ['Forma del drago · Ali d\'oro', 'gelo', 1], 'barra boss in alto (nome del giocatore + forma)');
    eq(DnD.boss.normalizeCombatBoss(x.boss).theme, 'gelo');
    // Tema vuoto: la forma prende il tema del personaggio (chiave «lg:»), che sopravvive al salvataggio.
    const y = DnD.combattenti.createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    LG().transform(y, Object.assign({}, t, { theme: '' }));
    eq([y.boss.theme, DnD.boss.normalizeCombatBoss(y.boss).theme, DnD.boss.theme(y.boss.theme).legendary], ['lg:divino', 'lg:divino', true], 'tema del personaggio');
    eq(DnD.boss.theme('lg:inesistente').name, 'Infernale', 'tema sconosciuto: ripiego');
    eq(LG().transform(x, t).ok, false, 'già trasformato');
    // Fasi del boss in forma: sotto il 50%.
    x.hp = 40;
    const logs = [];
    const ev = DnD.boss.checkCombat({ combatants: [x] }, (k, s) => logs.push(s));
    eq(ev.map((e) => e.phaseName), ['Furia']);
    // A 0 PF della forma: il danno in eccesso (25) passa al personaggio (150 → 125).
    const lines = LG().damage(x, 65);
    eq([x.legend.form, x.hp, x.maxHp, x.abilities.FOR, x.boss], [null, 125, c.maxHp, 16, null], 'ritorno automatico');
    ok(/25 danni in eccesso/.test(lines[0]), lines[0]);
    eq(LG().transform(x, t).ok, false, 'usi esauriti (1 per riposo lungo)');
    // Durata: 2 round, poi fine.
    x = DnD.combattenti.createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    LG().transform(x, t);
    eq(LG().tick(x).length, 1);
    ok(/fine della durata/.test(LG().tick(x)[0]) && !x.legend.form, 'fine a durata');
    // PF temporanei: si consumano prima; fine anticipata.
    c.legend.transformations = [formOf({ hpMode: 'temporanei', uses: { n: 2 } })];
    x = DnD.combattenti.createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    x.hp = 80;
    LG().transform(x, c.legend.transformations[0]);
    eq([x.hp, x.maxHp], [180, c.maxHp + 100]);
    LG().damage(x, 30);
    LG().revert(x, 'anticipata');
    eq(x.hp, 80, 'danno assorbito dai PF temporanei');
    LG().transform(x, c.legend.transformations[0]);
    LG().damage(x, 130);
    LG().revert(x, 'anticipata');
    eq(x.hp, 50, 'il resto ricade sul personaggio');
    // Richiede il nodo che la sblocca.
    c.legend.transformations = [formOf({ requireNode: true, minRank: 5 })];
    eq(LG().available(c, st).length, 0, 'senza il nodo');
    c.legend.path.nodes.push(PT().normalizeNode({ id: 'tn', cost: 1, effects: [{ kind: 'trasformazione', transformationId: 't1' }] }));
    c.legend.path.links.push(['nucleo', 'tn']);
    c.legend.unlocked = ['nucleo', 'tn'];
    eq(LG().available(c, st).map((y) => y.id), ['t1'], 'con il nodo');
  });

  test('Leggendari: promozione e declassamento, esportazione e importazione, migrazione', () => {
    const st = DnD.dati.emptyState();
    const sess = S().current(st);
    const p = DnD.dati.normalizeCreature({ id: 'g', name: 'Aria', level: 19, classId: 'mago' }, true);
    eq(LG().promote(p).ok, false, 'serve il livello 20');
    p.level = 20;
    const up = DnD.dati.normalizeCreature(LG().promote(p).player, true);
    eq([up.type, up.level, up.legend.path.nodes.length > 1, up.legend.unlocked], ['leggendario', 20, true, ['nucleo']]);
    up.legend.unlocked = ['nucleo', 'n-vigore'];
    const down = DnD.dati.normalizeCreature(LG().demote(up), true);
    eq([down.type, down.legend, down.legendArchive.unlocked], [undefined, undefined, ['nucleo', 'n-vigore']], 'dati del percorso conservati');
    eq(DnD.dati.normalizeCreature(LG().promote(down).player, true).legend.unlocked, ['nucleo', 'n-vigore'], 'ripromosso: percorso ritrovato');
    up.sessionId = sess.id;
    up.legend.transformations = [formOf()];
    st.players.push(up);
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(st));
    const q = back.players.find((x) => x.id === 'g');
    eq([q.type, q.legend.unlocked, q.legend.transformations[0].creature.boss.phases.length], ['leggendario', ['nucleo', 'n-vigore'], 2], 'archivio');
    const file = JSON.parse(JSON.stringify(S().exportSession(st, sess.id)));
    const dst = DnD.dati.emptyState();
    S().importSession(dst, file, DnD.dadi.uid);
    ok(dst.players.some((x) => x.type === 'leggendario' && x.name === 'Aria'), 'sessione');
    const mig = DnD.dati.normalizeState({ version: 10, races: [], npcs: [], players: [{ id: 'z', name: 'Zed', level: 20 }] });
    eq([mig.version, mig.players[0].type, mig.pathTemplates.length], [DnD.dati.VERSION, undefined, 1], 'v10 → v11: giocatori standard, modello d\'esempio');
  });

  test('Leggendari UI: temi unificati con il Boss, lance di luce, scheda del combattente a tema, «Riduci animazioni»', () => {
    if (!hasBossUi() || !DnD.uiLeggendario) return;
    const html = document.documentElement;
    // Un solo sistema di temi: chiave «lg:<id>» per i leggendari, variabili --lg-* e motivo del tema.
    const node = DnD.uiLeggendario.applyTheme(document.createElement('div'), 'cosmico');
    eq([node.dataset.bossTheme, node.dataset.legendMotif, node.classList.contains('legend-theme')], ['lg:cosmico', 'stelle', true]);
    ok(/--lg-gold:#9fa8ff/.test(node.getAttribute('style')) && /--boss-accent:#9fa8ff/.test(node.getAttribute('style')), 'stesse variabili per Boss e leggendari');
    const boss = DnD.uiBoss.applyTheme(node, 'gelo');
    eq([boss.classList.contains('legend-theme'), boss.dataset.legendMotif], [false, undefined], 'tema del Boss: niente variabili leggendarie');
    eq(DnD.uiLeggendario.applyTheme(document.createElement('div'), 'divino').dataset.bossTheme, 'lg:divino', '«divino» dei leggendari non si confonde con quello del Boss');
    // Scheda del combattente: tema della forma attiva al posto di quello del personaggio.
    const x = { legend: { theme: 'divino', form: null } };
    ok(/--lg-gold:#f2c94c/.test(DnD.uiLeggendario.cardStyle(x)), 'tema del personaggio');
    x.legend.form = { theme: 'lg:abissale' };
    ok(/--lg-gold:#b48cff/.test(DnD.uiLeggendario.cardStyle(x)), 'in forma: tema della forma');
    // Animazioni leggendarie con «Riduci animazioni»: ferme, niente Ascensione né lampo.
    const host = DnD.uiLeggendario.applyTheme(document.createElement('div'), 'divino');
    host.innerHTML = '<div class="legend-dust"></div><div class="legend-rays"></div><svg class="legend-sigil"></svg><svg class="legend-wings"></svg>';
    document.body.append(host);
    const hadReduce = 'reduceMotion' in html.dataset;
    const orig = DnD.impostazioni.reduceMotion;
    try {
      html.dataset.reduceMotion = '';
      eq([...host.children].map((e) => getComputedStyle(e).animationName), ['none', 'none', 'none', 'none'], 'sfondo e ali fermi');
      DnD.impostazioni.reduceMotion = () => true;
      let done = false;
      DnD.uiLeggendario.ascension({ name: 'X', legend: { theme: 'divino', title: '' } }, () => { done = true; });
      DnD.uiLeggendario.transformFlash('lg:divino');
      ok(done && !document.querySelector('.legend-ascension') && !document.querySelector('.legend-transform-flash'), 'senza animazioni: niente Ascensione né lampo');
    } finally {
      DnD.impostazioni.reduceMotion = orig;
      if (!hadReduce) delete html.dataset.reduceMotion;
      host.remove();
    }
  });

  // ======================= Dadi animati =======================
  const DD = () => DnD.dadi;

  test('Dadi animati: il risultato mostrato è quello deciso prima (registratore), anche saltando l\'animazione', async () => {
    const rec = DD().registratore(seq(3, 6, 2, 15));
    const r = DD().roll(3, 6, 2, rec.rng);
    const t = rec.tiro('3d6+2', 'menu');
    eq([t.gruppi.length, t.gruppi[0].values, t.gruppi[0].modifier, t.totale], [1, r.rolls, 2, r.total], 'un gruppo con i dadi del roll');
    const plan = DD().pianoAnimazione(t, { speed: 'normale' });
    eq([plan.dadi.map((d) => d.value), plan.durata, plan.animati], [[3, 6, 2], 900, true]);
    eq(DD().testoGruppo(t.gruppi[0]), '3 + 6 + 2 + 2 = 13');
    if (typeof document === 'undefined' || !DnD.uiDadi) return;
    // Animazione interrotta subito: le facce finali sono quelle decise.
    const stage = document.createElement('div');
    stage.className = 'dice-stage';
    document.body.append(stage);
    try {
      const plan2 = DD().pianoAnimazione({ gruppi: [{ sides: 20, values: [17], natural: true }, { sides: 8, values: [5] }, { sides: 6, values: [4] }] }, { speed: 'lenta' });
      const a = DnD.uiDadi.animate(stage, plan2, { sound: false });
      a.skip();
      await a.done;
      eq([...stage.querySelectorAll('.die-face')].map((n) => n.textContent), ['17', '5'], 'facce dei dadi piatti');
      eq(stage.querySelector('.die-cube').style.transform, 'rotateX(90deg)', 'cubo del d6 sulla faccia 4');
      ok(stage.classList.contains('landed') && !stage.querySelector('.rolling'), 'animazione finita');
    } finally {
      stage.remove();
    }
  });

  test('Dadi animati: 4d6 con scarto, vantaggio e svantaggio, 20 e 1 naturali, d100', () => {
    const rec = DD().registratore(seq(5, 2, 6, 3));
    const r = R().roll4d6DropLowest(rec.rng);
    const g = rec.gruppi()[0];
    eq([rec.gruppi().length, g.values, g.dropped, g.total, r.total], [1, [5, 2, 6, 3], [1], 14, 14], '4d6: il 2 attenuato');
    eq(DD().pianoAnimazione(rec.tiro('4d6')).dadi.map((d) => d.dropped), [false, true, false, false]);
    const adv = DD().registratore(seq(5, 17));
    R().rollSave({ bonus: 3, mode: 'vantaggio', dc: null }, adv.rng);
    eq(adv.gruppi()[0].dropped, [0], 'vantaggio: scartato il 5');
    const dis = DD().registratore(seq(5, 17));
    R().rollSave({ bonus: 3, mode: 'svantaggio', dc: null }, dis.rng);
    eq(dis.gruppi()[0].dropped, [1], 'svantaggio: scartato il 17');
    const twin = DD().registratore(seq(9, 9));
    R().rollSave({ bonus: 0, mode: 'vantaggio', dc: null }, twin.rng);
    eq(twin.gruppi()[0].dropped, [1], 'pari: se ne attenua uno solo');
    // 20 e 1 naturali (solo sui d20 tenuti e «naturali»).
    const crit = DD().registratore(seq(20, 1));
    R().resolveAttack({ toHit: 5, targetAC: 15, damageDice: '1d8', damageBonus: 3, mode: 'svantaggio' }, crit.rng);
    eq(DD().pianoAnimazione(crit.tiro('Attacco')).dadi.map((d) => [d.value, d.dropped, d.crit]), [[20, true, null], [1, false, 'min']], 'svantaggio: tiene l\'1 (fallimento)');
    const hit = DD().registratore(seq(20, 4, 7, 2));
    R().resolveAttack({ toHit: 5, targetAC: 15, damageDice: '1d8', damageBonus: 3, mode: 'normale' }, hit.rng);
    const ph = DD().pianoAnimazione(hit.tiro('Critico'));
    eq([ph.dadi.map((d) => d.crit), ph.gruppi.map((x) => x.sides), ph.gruppi[1].values], [['max', null, null], [20, 8], [4, 7]], '20 naturale e danni raddoppiati');
    eq(DD().pianoAnimazione({ gruppi: [{ sides: 20, values: [20] }] }).dadi[0].crit, null, 'un d20 di un\'espressione non è «naturale»');
    // d100: due d10.
    eq([DD().d100Faces(47), DD().d100Faces(100), DD().d100Faces(7)], [['40', '7'], ['00', '0'], ['00', '7']]);
    const p100 = DD().pianoAnimazione({ gruppi: [{ sides: 100, values: [47] }] });
    eq([p100.dadi[0].faces, p100.conta], [['40', '7'], 2]);
  });

  test('Dadi animati: limite di dadi animati, velocità, «Riduci animazioni», interruttori, coda', () => {
    const many = (n) => ({ gruppi: [{ sides: 6, values: Array(n).fill(3) }] });
    eq([DD().pianoAnimazione(many(12)).soloTotale, DD().pianoAnimazione(many(13)).soloTotale, DD().pianoAnimazione(many(13)).dadi.length, DD().pianoAnimazione(many(13)).totale],
      [false, true, 0, 39], 'oltre 12: solo il totale');
    eq(['lenta', 'normale', 'veloce', 'istantanea'].map((v) => DD().pianoAnimazione(many(2), { speed: v }).durata), [1200, 900, 600, 0]);
    const still = DD().pianoAnimazione(many(2), { speed: 'lenta', reduceMotion: true });
    eq([still.durata, still.animati, still.dadi.length], [0, false, 2], 'Riduci animazioni: subito, senza movimento');
    // Interruttori (generale e per categoria).
    const I = DnD.impostazioni;
    const prev = I.get();
    try {
      I.set({ diceAnim: true, diceCombat: false });
      eq([DnD.uiDadi.enabled('combattimento'), DnD.uiDadi.enabled('menu'), DnD.uiDadi.mostraTiro({ categoria: 'combattimento', gruppi: [{ sides: 20, values: [5] }] })], [false, true, false]);
      I.set({ diceAnim: false, diceCombat: true });
      eq([DnD.uiDadi.enabled('combattimento'), DnD.uiDadi.enabled('esplorazione')], [false, false], 'interruttore generale spento');
    } finally {
      I.set(prev);
    }
    eq(I.normalize({ diceSpeed: 'turbo', diceColor: '<x>' }).diceSpeed, 'normale');
    eq(I.normalize({ diceColor: '<x>' }).diceColor, 'rosso');
    // Coda: uno alla volta, con la pausa; i più vecchi si saltano oltre il massimo.
    const shown = [];
    const pending = [];
    const timer = { set: (fn) => { pending.push(fn); return pending.length; }, clear() {} };
    let finish = null;
    const q = DD().coda((t, done) => { shown.push(t.etichetta); finish = done; }, { timer, gap: () => 10, max: 2 });
    q.push({ etichetta: 'a' });
    q.push({ etichetta: 'b' });
    q.push({ etichetta: 'c' });
    q.push({ etichetta: 'd' });
    eq([shown, q.size()], [['a'], 3], 'il primo subito, due in attesa (c, d)');
    finish();
    pending.shift()();
    finish();
    pending.shift()();
    eq(shown, ['a', 'c', 'd'], 'in ordine, «b» saltato oltre il massimo');
    // Esplorazione: il registratore non cambia la sequenza del seme.
    const plain = DnD.biomi.seededRng(42);
    const rec = DD().registratore();
    const wrapped = rec.wrap(DnD.biomi.seededRng(42));
    const a = [plain(20), plain(6), plain(100)];
    eq([wrapped(20), wrapped(6), wrapped(100)], a, 'stessi valori');
    eq(rec.gruppi().map((g) => g.sides), [20, 6, 100]);
  });

  // ---------- Effetti sonori (AudioContext finto) ----------
  const SDD = () => DnD.suoniDati;
  // AudioContext finto: registra le sorgenti avviate; decodeAudioData accetta solo i dati che iniziano con «RIFF».
  function fakeAudio() {
    const rec = { sources: [], resumed: 0, suspended: 0 };
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
    const node = (extra) => Object.assign({ connect() {} }, extra);
    const source = (extra) => { const s = node(Object.assign({ start(t) { s.at = t; rec.sources.push(s); }, stop(t) { s.end = t; } }, extra)); return s; };
    class Ctx {
      constructor() { this.currentTime = 0; this.sampleRate = 4000; this.state = 'suspended'; this.destination = node(); rec.ctx = this; }
      createGain() { return node({ gain: param() }); }
      createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
      createBiquadFilter() { return node({ type: '', frequency: param(), Q: param() }); }
      createOscillator() { return source({ kind: 'osc', type: '', frequency: param() }); }
      createBufferSource() { return source({ kind: 'buffer', buffer: null, loop: false }); }
      createBuffer(ch, len, rate) { const d = new Float32Array(len); return { duration: len / rate, getChannelData: () => d }; }
      decodeAudioData(buf) { const b = new Uint8Array(buf); return String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' ? Promise.resolve({ duration: 0.5, decoded: true }) : Promise.reject(new Error('corrotto')); }
      resume() { rec.resumed++; this.state = 'running'; return Promise.resolve(); }
      suspend() { rec.suspended++; this.state = 'suspended'; return Promise.resolve(); }
    }
    const listeners = {};
    const doc = {
      hidden: false,
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
      fire(t) { for (const fn of (listeners[t] || []).slice()) fn({}); },
      count: (t) => (listeners[t] || []).length,
    };
    const data = new Map();
    const blobs = { get: async (k) => (data.has(k) ? data.get(k) : null), set: async (k, v) => { data.set(k, v); } };
    return { Ctx, rec, doc, blobs, data };
  }
  const wavUrl = (body) => 'data:audio/wav;base64,' + btoa('RIFF' + (body || 'suono di prova'));
  const brokenUrl = 'data:audio/wav;base64,' + btoa('XXXX file rovinato');
  // Istanza con suoni accesi e contesto già sbloccato (primo gesto simulato).
  function soundBox(opts) {
    const f = fakeAudio();
    const o = opts || {};
    const a = DnD.audioLib.crea({ AudioContext: f.Ctx, doc: f.doc, storage: o.storage || fakeStorage(), blobs: f.blobs, effettiBoss: o.effettiBoss || (() => true), leggiFile: async (file) => file.dataUrl });
    if (o.on !== false) a.imposta({ on: true });
    if (o.unlock !== false) f.doc.fire('pointerdown');
    return Object.assign(f, { a });
  }

  test('Suoni: tutti gli eventi hanno etichetta, categoria e ricetta valida', () => {
    const S = SDD();
    eq(S.CATEGORIES.map((c) => c.id), ['dadi', 'combattimento', 'turno', 'movimento', 'boss', 'leggendario', 'esplorazione', 'mondo', 'scene', 'online', 'interfaccia']);
    const ids = S.EVENTS.map((e) => e.id);
    eq(new Set(ids).size, ids.length, 'identificatori unici');
    const required = ['dadi-rotolio', 'dadi-tonfo', 'dadi-20', 'dadi-1', 'colpo', 'mancato', 'critico', 'danno', 'cura', 'a-terra', 'incantesimo', 'ts-riuscito', 'ts-fallito', 'azione-lieve',
      'turno-giocatore', 'round', 'vittoria', 'sconfitta', 'passo', 'movimento-rifiutato', 'boss-evocazione', 'boss-ingresso', 'boss-fase', 'boss-sconfitto',
      'ascensione', 'nodo-sbloccato', 'trasformazione', 'forma-normale', 'evento', 'scoperta', 'mappa', 'tempo',
      'online-entra', 'online-richiesta', 'online-chat', 'online-disconnessione', 'online-ping', 'conferma', 'errore', 'salvataggio'];
    for (const id of required) ok(S.event(id), 'manca ' + id);
    const cats = new Set(S.CATEGORIES.map((c) => c.id));
    const FORME = ['sine', 'triangle', 'square', 'sawtooth'];
    for (const e of S.EVENTS) {
      ok(typeof e.label === 'string' && e.label.length > 2 && cats.has(e.cat), e.id + ': etichetta e categoria');
      ok(e.vol > 0 && e.vol <= 1 && typeof e.on === 'boolean', e.id + ': volume relativo e predefinito');
      ok(Array.isArray(e.ricetta) && e.ricetta.length > 0, e.id + ': ricetta');
      for (const l of e.ricetta) {
        ok(['osc', 'rumore'].includes(l.t) && l.dur > 0 && l.g > 0 && l.g <= 1, e.id + ': strato valido');
        if (l.t === 'osc') ok(FORME.includes(l.forma) && [].concat(l.f).every((f) => f > 0), e.id + ': oscillatore');
        if (l.filtro) ok(['lowpass', 'highpass', 'bandpass'].includes(l.filtro.tipo), e.id + ': filtro');
      }
    }
    const def = S.normalize(null);
    eq([def.on, def.eventi.passo.on, def.eventi.conferma.on, def.eventi.errore.on, def.eventi.salvataggio.on, def.eventi.critico.on], [false, false, false, false, false, true],
      'spenti di base: interruttore generale, passo e interfaccia');
    eq(S.normalize({ volume: 300 }).volume, 100);
    eq(S.normalize({ eventi: { critico: { volume: -5, file: { id: '../x' } } } }).eventi.critico, { on: true, volume: 0, file: null }, 'valori corretti e file non valido scartato');
  });

  test('Suoni: interruttore generale, categoria ed evento; niente prima del primo gesto', () => {
    const f = soundBox({ unlock: false });
    eq(f.a.suona('critico').suonato, false);
    ok(/serve un clic/.test(f.a.suona('critico').motivo), 'prima del primo gesto non suona');
    eq(f.rec.sources.length, 0);
    eq(f.doc.count('pointerdown'), 1);
    f.doc.fire('keydown');
    eq([f.a.stato().sbloccato, f.rec.resumed, f.doc.count('pointerdown')], [true, 1, 0], 'sbloccato al primo tasto, ascoltatori tolti');
    ok(f.a.suona('critico').suonato);
    f.rec.ctx.currentTime = 1;
    f.a.imposta({ on: false });
    eq(f.a.suona('critico').motivo, 'suoni spenti');
    f.a.imposta({ on: true });
    f.a.impostaCategoria('combattimento', { on: false });
    eq(f.a.suona('critico').motivo, 'categoria spenta');
    ok(f.a.suona('round').suonato, 'le altre categorie restano');
    f.a.impostaCategoria('combattimento', { on: true });
    f.a.impostaEvento('critico', { on: false });
    eq(f.a.suona('critico').motivo, 'evento spento');
    ok(f.a.suona('critico', { anteprima: true }).suonato, 'Ascolta ignora gli interruttori');
    eq(f.a.suona('passo').motivo, 'evento spento', 'passo spento di base');
    // Boss e Leggendario seguono anche «Effetti boss».
    let fx = false;
    const g = soundBox({ effettiBoss: () => fx });
    eq([g.a.suona('boss-fase').motivo, g.a.suona('ascensione').motivo], ['effetti boss spenti', 'effetti boss spenti']);
    fx = true;
    ok(g.a.suona('boss-fase').suonato);
    // Volumi: categoria × evento × volume relativo; il generale va nel nodo master.
    const s = SDD().normalize({ categorie: { dadi: { volume: 50 } }, eventi: { 'dadi-tonfo': { volume: 50 } } });
    eq(SDD().gain(s, 'dadi-tonfo'), 0.25 * SDD().event('dadi-tonfo').vol);
    ok(SDD().gain(Object.assign({}, s, { turnoEvidente: true }), 'turno-giocatore') > SDD().gain(s, 'turno-giocatore'), 'avviso del turno più evidente');
  });

  test('Suoni: massimo 8 contemporanei, intervallo minimo, coda e turni veloci', () => {
    const f = soundBox();
    const ids = SDD().EVENTS.filter((e) => e.on).map((e) => e.id).slice(0, 12);
    for (const id of ids) f.a.suona(id);
    eq(f.a.stato().voci, DnD.audioLib.MAX_VOICES, 'il più vecchio sfuma');
    ok(f.rec.sources.some((s) => s.end !== undefined && s.end < 0.2), 'le voci scartate si fermano subito');
    // Due suoni identici ravvicinati: il secondo si scarta.
    const g = soundBox();
    ok(g.a.suona('colpo').suonato);
    g.rec.ctx.currentTime = 0.03;
    eq(g.a.suona('colpo').motivo, 'troppo ravvicinato');
    g.rec.ctx.currentTime = 0.2;
    ok(g.a.suona('colpo').suonato, 'dopo 60 ms sì');
    // Coda: gli esiti di un'azione uno dopo l'altro, senza accavallarsi.
    const h = soundBox();
    h.a.suonaTutti(['colpo', 'danno', 'a-terra']);
    const starts = [...new Set(h.rec.sources.map((s) => s.at))].sort((a, b) => a - b);
    ok(starts.length >= 3 && starts[1] - starts[0] >= 0.1, 'partenze distanziate: ' + starts.join(', '));
    // Turni automatici veloci: solo i suoni principali.
    const k = soundBox();
    eq(k.a.suonaTutti(['ts-riuscito', 'colpo', 'cura', 'a-terra'], { veloce: true }).map((x) => x.suonato), [false, true, false, true]);
    // La coda non rallenta il gioco: oltre 1,5 s di attesa i suoni si scartano.
    const m = soundBox();
    const many = m.a.suonaTutti(SDD().EVENTS.filter((e) => e.on && e.cat !== 'boss' && e.cat !== 'leggendario').map((e) => e.id));
    ok(many.some((x) => x.motivo === 'coda piena'), 'coda piena');
  });

  test('Suoni: silenzio con la scheda in secondo piano', () => {
    const f = soundBox();
    f.doc.hidden = true;
    f.doc.fire('visibilitychange');
    eq(f.rec.suspended, 1, 'contesto sospeso');
    eq(f.a.suona('round').motivo, 'scheda in secondo piano');
    f.doc.hidden = false;
    f.doc.fire('visibilitychange');
    ok(f.rec.resumed >= 2 && f.a.suona('round').suonato, 'riprende al ritorno');
  });

  test('Suoni: sostituzione con un file, ripristino, file corrotto o mancante, limite di 2 MB', async () => {
    const f = soundBox();
    const url = wavUrl();
    const fid = await f.a.sostituisciDati('critico', url, 'spada.wav');
    eq([fid, f.data.get('snd:' + fid), f.a.fonte('critico'), f.a.impostazioni().eventi.critico.file.nome], [DnD.audioLib.fileId(url), url, 'personalizzato', 'spada.wav']);
    await f.a.sostituisciDati('colpo', url, 'stesso.wav');
    eq(f.data.size, 1, 'una sola copia per contenuto');
    eq(f.a.suona('critico').fonte, 'file', 'suona il file decodificato');
    eq(f.rec.sources[f.rec.sources.length - 1].buffer.decoded, true);
    f.a.ripristina('critico');
    eq([f.a.fonte('critico'), f.a.suona('critico', { anteprima: true }).fonte], ['predefinito', 'sintesi'], 'Ripristina torna alla sintesi');
    // File corrotto: rifiutato, resta il predefinito.
    let err = '';
    try { await f.a.sostituisciDati('mancato', brokenUrl, 'rotto.wav'); } catch (e) { err = e.message; }
    ok(/non è un audio leggibile/.test(err), err);
    eq(f.a.fonte('mancato'), 'predefinito');
    err = '';
    try { await f.a.sostituisciDati('mancato', 'data:image/png;base64,AAAA', 'x.png'); } catch (e) { err = e.message; }
    ok(/non è un audio/.test(err), 'formato non audio rifiutato');
    // Limite di dimensione e formati.
    err = '';
    try { await f.a.sostituisci('mancato', { name: 'lungo.wav', type: 'audio/wav', size: 3 * 1024 * 1024 }); } catch (e) { err = e.message; }
    ok(/troppo grande/.test(err) && /2 MB/.test(err), err);
    err = '';
    try { await f.a.sostituisci('mancato', { name: 'x.flac', type: 'audio/flac', size: 10 }); } catch (e) { err = e.message; }
    ok(/Formato non supportato/.test(err), err);
    ok(await f.a.sostituisci('mancato', { name: 'ok.ogg', type: 'audio/ogg', size: 100, dataUrl: wavUrl('ogg') }));
    // File mancante nell'archivio (impostazioni copiate in un altro browser): si ripiega sulla sintesi senza errori.
    const st = fakeStorage();
    st.setItem(DnD.audioLib.KEY, JSON.stringify(f.a.impostazioni()));
    const g = soundBox({ storage: st });
    eq(g.a.suona('colpo').fonte, 'sintesi', 'mentre si carica: sintesi');
    await g.a.preload();
    g.rec.ctx.currentTime = 1;
    eq([g.a.fonte('colpo'), g.a.suona('colpo').fonte], ['non leggibile', 'sintesi']);
  });

  test('Suoni: impostazioni salvate, migrazione dei suoni dei dadi, esporta/importa e Cancella tutti i dati', async () => {
    const st = fakeStorage();
    const f = soundBox({ storage: st });
    f.a.imposta({ volume: 40, turnoEvidente: true });
    f.a.impostaCategoria('boss', { on: false });
    await f.a.sostituisciDati('round', wavUrl('gong'), 'gong.wav');
    const again = DnD.audioLib.crea({ storage: st }).impostazioni();
    eq([again.on, again.volume, again.turnoEvidente, again.categorie.boss.on, again.eventi.round.file.nome], [true, 40, true, false, 'gong.wav'], 'ricaricate');
    // Prima versione: diceSound/diceVolume nelle impostazioni di visualizzazione.
    const old = fakeStorage();
    old.setItem('dnd-battaglie:impostazioni', JSON.stringify({ theme: 'scuro', diceSound: true, diceVolume: 30 }));
    const mig = DnD.audioLib.crea({ storage: old }).impostazioni();
    eq([mig.on, mig.categorie.dadi.volume, Boolean(old.getItem(DnD.audioLib.KEY))], [true, 30, true], 'migrazione salvata subito');
    eq(DnD.audioLib.crea({ storage: fakeStorage() }).impostazioni().on, false, 'nuova installazione: spenti');
    // Esporta: impostazioni e file usati, dentro l'archivio; Importa su un altro browser.
    const exp = await f.a.esporta();
    eq([exp.impostazioni.volume, Object.keys(exp.file).length], [40, 1]);
    const text = DnD.dati.exportJSON(DnD.dati.emptyState(), {}, { suoni: exp });
    eq(JSON.parse(text).suoni.impostazioni.volume, 40, 'nell\'archivio esportato');
    eq(DnD.dati.importJSON(text).sessions.length, 1, 'l\'archivio con i suoni si importa');
    const g = soundBox({ on: false });
    eq(await g.a.importa(JSON.parse(text).suoni), 1);
    eq([g.a.impostazioni().volume, g.a.fonte('round'), g.data.size], [40, 'personalizzato', 1]);
    // File con impronta sbagliata: scartato, lo slot torna alla sintesi.
    const bad = JSON.parse(JSON.stringify(exp));
    bad.file[Object.keys(bad.file)[0]] = wavUrl('altro contenuto');
    const h = soundBox();
    eq(await h.a.importa(bad), 0);
    eq(h.a.fonte('round'), 'predefinito');
    // Cancella tutti i dati: l'archivio si svuota (stato, immagini e suoni) e gli slot tornano alla sintesi.
    const backend = { name: 'finto', data: new Map() };
    Object.assign(backend, { get: async (k) => (backend.data.has(k) ? backend.data.get(k) : null), set: async (k, v) => { backend.data.set(k, v); }, clear: async () => { backend.data.clear(); } });
    const store = await DnD.dati.openStore(fakeStorage(), { backend });
    const k = soundBox();
    k.a.collegaArchivio(store.blobs);
    await k.a.sostituisciDati('round', wavUrl('gong'), 'gong.wav');
    ok([...backend.data.keys()].some((x) => x.startsWith('snd:')), 'file nello stesso archivio');
    await store.clearAll();
    k.a.svuota();
    eq([[...backend.data.keys()].some((x) => x.startsWith('snd:')), k.a.fonte('round'), (await k.a.esporta()).file], [false, 'predefinito', {}]);
  });

  test('Suoni: dadi sincronizzati con l\'animazione (rotolio unico, tonfo, 20 e 1, animazione saltata)', async () => {
    if (typeof document === 'undefined' || !DnD.uiDadi) return;
    const calls = [];
    let stopped = 0;
    const prev = DnD.audio;
    DnD.audio = { suona: (id, o) => { calls.push(id + (o && o.veloce ? ':veloce' : '')); return { stop: () => { stopped++; } }; } };
    const stage = document.createElement('div');
    document.body.append(stage);
    try {
      const plan = DD().pianoAnimazione({ gruppi: [{ sides: 20, values: [20], natural: true }, { sides: 6, values: [3, 4] }] }, { speed: 'lenta' });
      const a = DnD.uiDadi.animate(stage, plan);
      eq(calls, ['dadi-rotolio'], 'un solo rotolio per tre dadi');
      a.skip();
      await a.done;
      eq([calls, stopped], [['dadi-rotolio', 'dadi-tonfo', 'dadi-20'], 1], 'saltata: il rotolio si ferma, poi tonfo e 20 naturale');
      calls.length = 0;
      const still = DD().pianoAnimazione({ gruppi: [{ sides: 20, values: [1], natural: true }] }, { speed: 'normale', reduceMotion: true });
      await DnD.uiDadi.animate(stage, still).done;
      eq(calls, ['dadi-tonfo', 'dadi-1'], 'senza animazione: tonfo e 1 naturale');
      calls.length = 0;
      await DnD.uiDadi.animate(stage, still, { veloce: true }).done;
      eq(calls, ['dadi-tonfo:veloce', 'dadi-1:veloce'], 'turni automatici: il modulo audio tiene solo i principali');
      ok(!SDD().event('dadi-tonfo').principale && SDD().event('dadi-1').principale);
    } finally {
      DnD.audio = prev;
      stage.remove();
    }
  });

  test('Suoni: dagli esiti del combattimento e dell\'esplorazione agli eventi', () => {
    const S = SDD();
    const pc = { id: 'p', kind: 'player', control: 'manuale', hp: 10 };
    const foe = { id: 'n', kind: 'npc', faction: 'nemici', hp: 7 };
    const before = S.combatSnapshot({ phase: 'attivo', combatants: [pc, foe] });
    const after = { phase: 'attivo', currentId: 'p', combatants: [Object.assign({}, pc, { hp: 4 }), Object.assign({}, foe, { hp: 0 })] };
    const rows = [{ type: 'critico' }, { type: 'a-terra' }, { type: 'round' }, { type: 'turno' }, { type: 'sistema' }, { type: 'ts-fallito' }];
    eq(S.fromCombat(before, rows, after), ['critico', 'a-terra', 'round', 'turno-giocatore', 'ts-fallito', 'danno']);
    const aiTurn = { phase: 'attivo', currentId: 'p', combatants: [Object.assign({}, pc, { control: 'ia' }), foe] };
    eq(S.fromCombat(before, [{ type: 'turno' }], aiTurn), [], 'turno di un giocatore giocato dall\'IA: niente ding');
    eq(S.fromCombat(before, [{ type: 'mancato' }, { type: 'mancato' }], { phase: 'attivo', combatants: [pc, foe] }), ['mancato'], 'senza ripetizioni');
    // Trasformazione e ritorno, ingresso del boss.
    const lg = { id: 'l', kind: 'player', hp: 50, legend: { form: null } };
    const formed = { phase: 'attivo', combatants: [Object.assign({}, lg, { legend: { form: { id: 'f1' } } })] };
    eq(S.fromCombat(S.combatSnapshot({ phase: 'attivo', combatants: [lg] }), [], formed), ['trasformazione']);
    eq(S.fromCombat(S.combatSnapshot(formed), [], { phase: 'attivo', combatants: [lg] }), ['forma-normale']);
    const boss = { id: 'b', kind: 'npc', hp: 100, boss: { theme: 'infernale' } };
    eq(S.fromCombat(S.combatSnapshot({ phase: 'iniziativa', combatants: [boss] }), [], { phase: 'attivo', combatants: [boss] }), ['boss-ingresso']);
    eq(S.fromCombat(S.combatSnapshot({ phase: 'attivo', combatants: [boss] }), [], { phase: 'attivo', combatants: [boss] }), [], 'una volta sola');
    eq(S.fromCombat(null, [], { phase: 'attivo', combatants: [boss] }), ['boss-ingresso'], 'combattimento avviato dall\'esplorazione');
    // Esito alla fine del combattimento.
    eq([S.combatOutcome(after), S.combatOutcome({ combatants: [Object.assign({}, pc, { hp: 0 }), foe] }), S.combatOutcome({ combatants: [pc, foe] })], ['vittoria', 'sconfitta', null]);
    eq(S.fromExploration([{ kind: 'movimento' }, { kind: 'evento' }, { kind: 'incontro' }, { kind: 'scoperta' }, { kind: 'mappa' }, { kind: 'meteo' }, { kind: 'tempo' }]), ['evento', 'scoperta', 'mappa', 'tempo']);
  });

  test('Suoni: Silenzia tutto (pulsante e Alt+M) e indipendenza da «Riduci animazioni»', () => {
    if (typeof document === 'undefined' || !DnD.uiSuoni) return;
    const f = soundBox();
    const prev = DnD.audio;
    const I = DnD.impostazioni;
    const prevSettings = Object.assign({}, I.get());
    DnD.audio = f.a;
    try {
      const btn = DnD.uiSuoni.quickButton();
      document.body.append(btn);
      eq(btn.getAttribute('aria-pressed'), 'true', 'stato visibile sul pulsante');
      btn.click();
      eq([f.a.attivo(), btn.getAttribute('aria-pressed'), btn.getAttribute('aria-label')], [false, 'false', 'Attiva i suoni']);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', altKey: true, bubbles: true }));
      eq([f.a.attivo(), btn.getAttribute('aria-pressed')], [true, 'true'], 'Alt+M');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true, bubbles: true }));
      eq(f.a.attivo(), true, 'Ctrl+Alt+M non è la scorciatoia');
      // Nell'editor delle note la scorciatoia non scatta.
      const ed = document.createElement('div');
      ed.setAttribute('contenteditable', 'true');
      document.body.append(ed);
      ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', altKey: true, bubbles: true }));
      eq(f.a.attivo(), true, 'non nell\'editor delle note');
      ed.remove();
      btn.remove();
      // Riduci animazioni non tocca i suoni (e viceversa).
      I.set({ reduceMotion: true });
      ok(f.a.attivo() && f.a.suona('round').suonato, 'i suoni restano con «Riduci animazioni»');
      f.a.imposta({ on: false });
      eq(I.get().reduceMotion, true, 'spegnere i suoni non cambia le animazioni');
    } finally {
      DnD.audio = prev;
      I.set(prevSettings);
    }
  });

  // ======================= Mondo: fazioni, party, città, NPC e quest =======================
  const FZ = () => DnD.fazioni;
  const NPC = () => DnD.npc;
  const QS = () => DnD.quest;
  const PY = () => DnD.party;
  const CT = () => DnD.citta;
  // Le tre predefinite più «Gilda», neutrale verso tutti (nessuna relazione scritta).
  const worldFactions = () => FZ().builtinFactions('s').concat(FZ().normalizeFaction({ id: 'gilda', name: 'Gilda' }));
  // Mercante di prova: pugnali (2 mo) con rifornimento e una spada lunga (15 mo) sbloccata da reputazione 50.
  const merchantNpc = (o) => NPC().normalizeNpc(Object.assign({
    id: 'm', name: 'Bera', roles: ['mercante'], factionId: 'gilda',
    merchant: { stock: [{ id: 'l1', equipmentId: 'eq-pugnale', qty: 3, restock: 1, max: 5 }, { id: 'l2', equipmentId: 'eq-spada-lunga', qty: 1, minRep: 50 }], coins: { mo: 10 } },
  }, o));
  // Combattente NPC (neutrale finché non è provocato).
  const npcC = (id, o, npc) => mkC(Object.assign({ id, name: 'NPC ' + id, faction: 'gilda', npc: Object.assign({ npcId: 'n-' + id, defend: 'se', provoke: 'solo', cityId: 'c1', penalty: -10 }, npc) }, o));

  test('Fazioni: matrice delle relazioni, simmetria, asimmetrie e relazione()', () => {
    const list = worldFactions();
    eq([FZ().relazione('giocatori', 'nemici', list), FZ().relazione('neutrali', 'giocatori', list), FZ().relazione('nemici', 'nemici', list)], ['guerra', 'amichevole', 'alleata'], 'predefinite e stessa fazione');
    eq([FZ().relazione('nemici', 'giocatori', []), FZ().relazione('x', 'y', list), FZ().relazione('', 'nemici', list)], ['guerra', 'neutrale', 'neutrale'], 'predefinite mancanti dalla lista e sconosciute');
    FZ().setRelation(list, 'gilda', 'nemici', 'alleata', true);
    eq([FZ().relazione('gilda', 'nemici', list), FZ().relazione('nemici', 'gilda', list)], ['alleata', 'alleata'], 'simmetrica');
    FZ().setRelation(list, 'gilda', 'giocatori', 'ostile', false);
    eq([FZ().relazione('gilda', 'giocatori', list), FZ().relazione('giocatori', 'gilda', list)], ['ostile', 'neutrale'], 'asimmetrica');
    eq(FZ().asymmetries(list), [{ a: 'giocatori', b: 'gilda', ab: 'neutrale', ba: 'ostile' }]);
    eq(FZ().matrix(list)[3].cells.map((c) => c.level), ['ostile', 'alleata', 'neutrale', 'alleata'], 'riga della Gilda');
    FZ().setRelation(list, 'gilda', 'gilda', 'guerra', true);
    FZ().setRelation(list, 'gilda', 'nemici', 'boh', true);
    eq(FZ().relazione('gilda', 'nemici', list), 'alleata', 'livelli non validi e sé stessa ignorati');
    eq([FZ().isHostileLevel('guerra'), FZ().isHostileLevel('neutrale'), FZ().isAllyLevel('amichevole'), FZ().isAllyLevel('neutrale')], [true, false, true, false]);
    eq(FZ().normalizeFaction({ id: 'x', relations: { x: 'alleata', y: 'boh', z: 'ostile' } }).relations, { z: 'ostile' }, 'normalizzazione');
    const fixed = FZ().ensureBuiltins([FZ().normalizeFaction({ id: 'gilda' })], 's');
    eq([fixed.map((f) => f.id), fixed.filter((f) => f.builtin).length, fixed[0].shared], [['giocatori', 'nemici', 'neutrali', 'gilda'], 3, true], 'predefinite sempre presenti e condivise');
    eq(FZ().factionOr(list, 'eliminata'), 'neutrali', 'fazione eliminata: Neutrali');
  });

  test('Reputazione: soglie, effetti su prezzi, città, atteggiamento e accessi', () => {
    const th = (v) => FZ().threshold(v).id;
    eq([th(-100), th(-60), th(-20), th(-6), th(-5), th(19), th(20), th(50), th(100)], ['nemico', 'ostile', 'diffidente', 'diffidente', 'neutrale', 'neutrale', 'amichevole', 'alleato', 'eroe']);
    eq([-60, -50, -30, 0, 50, 79, 80].map(FZ().priceFactor), [1.5, 1.5, 1.2, 1, 0.9, 0.9, 0.8], 'prezzi');
    eq([-51, -20, 0, 50].map(FZ().cityAttitude), ['ostile', 'diffidente', 'neutrale', 'accogliente'], 'città');
    eq([-60, -30, 0, 20, 90].map(FZ().attitudeDelta), [-2, -1, 0, 1, 2], 'atteggiamento degli NPC');
    eq([FZ().hasAccess(-51, true), FZ().hasAccess(-50, true), FZ().hasAccess(-90, false)], [false, true, true], 'sotto -50 bloccato (se la regola è attiva)');
    eq(FZ().normalizeThresholds([{ id: 'a', name: 'A', min: 10 }, { id: 'b', name: 'B', min: -30 }]).map((t) => [t.id, t.min]), [['b', -100], ['a', 10]], 'soglie modificabili, ordinate, la prima da -100');
    eq(FZ().threshold(5, [{ id: 'a', min: 10 }, { id: 'b', min: -30 }]).id, 'b', 'soglie della sessione');
    const city = CT().quickCity({ name: 'Rocca', factionId: 'gilda' }, 's');
    eq([CT().attitude(city, -60).id, CT().attitude(city, -60).name, CT().isClosed(city, -60, true), CT().isClosed(city, -60, false), CT().attitude(city, 60).id], ['ostile', 'Ostile', true, false, 'accogliente']);
  });

  test('Reputazione: registro con motivazione, annullamento e reputazione per giocatore', () => {
    const world = FZ().normalizeWorld({});
    const party = PY().normalizeParty({ id: 'pa', memberIds: ['p1', 'p2'] });
    const t = { world, party };
    const e1 = FZ().changeReputation(t, 'gilda', 30, 'aiuto al mercato', 'manuale', new Date('2026-01-01T10:00:00Z'));
    eq([e1.delta, e1.before, e1.after, e1.reason, e1.at, party.reputation.gilda], [30, 0, 30, 'aiuto al mercato', '2026-01-01T10:00:00.000Z', 30]);
    const e2 = FZ().changeReputation(t, 'gilda', 90, 'eroi', 'quest');
    eq([e2.delta, e2.after, party.reputation.gilda], [70, 100, 100], 'massimo +100: la voce registra la differenza reale');
    eq(FZ().changeReputation(t, 'gilda', 5), null, 'già al massimo: nessuna voce');
    eq(FZ().changeReputation(t, 'gilda', 0), null, 'variazione nulla');
    ok(FZ().revertReputation(world, [party], e2.id) && party.reputation.gilda === 30 && e2.reverted, 'annullata dal master');
    eq(FZ().revertReputation(world, [party], e2.id), false, 'non si annulla due volte');
    // Reputazione personale: parte da quella del party e resta separata.
    world.perPlayer = true;
    const e3 = FZ().changeReputation({ world, party, playerId: 'p1' }, 'gilda', -10, 'furto');
    eq([e3.playerId, e3.before, e3.after, party.reputation.gilda], ['p1', 30, 20, 30]);
    eq([FZ().reputationOf(world, party, 'gilda', 'p1'), FZ().reputationOf(world, party, 'gilda', 'p2'), FZ().reputationOf(world, party, 'nemici')], [20, 30, 0]);
    FZ().revertReputation(world, [party], e3.id);
    eq(world.playerRep.p1.gilda, 30, 'annullamento della voce personale');
    world.perPlayer = false;
    eq(FZ().reputationOf(world, party, 'gilda', 'p1'), 30, 'reputazione personale spenta: vale quella del party');
    eq([world.repLog.length, FZ().normalizeWorld(JSON.parse(JSON.stringify(world))).repLog.map((e) => e.reverted)], [3, [false, true, true]], 'registro salvato');
  });

  test('Monete: conversione in rame, pagamento con resto, incasso', () => {
    eq([NPC().toCopper({ mo: 1, ma: 5, mr: 3 }), NPC().toCopper({ mp: 1, me: 2 })], [153, 1100]);
    const c = NPC().fromCopper(153);
    eq([c.mo, c.ma, c.mr, c.me, c.mp], [1, 5, 3, 0, 0], 'resto in oro, argento e rame');
    const p = NPC().pay({ mo: 2 }, 35);
    eq([p.mo, p.ma, p.mr, NPC().toCopper(p)], [1, 6, 5, 165], '2 mo − 35 mr: si cambia una moneta d\'oro');
    const q = NPC().pay({ mr: 10, mo: 1 }, 15);
    eq([q.mo, q.ma, q.mr, NPC().toCopper(q)], [0, 9, 5, 95], 'prima le monete piccole, poi il cambio');
    eq(NPC().pay({ ma: 2 }, 50), null, 'non basta');
    eq(NPC().toCopper(NPC().receive({ mo: 1 }, 250)), 350);
    ok(/1 mo/.test(NPC().formatCopper(150)) && /5 ma/.test(NPC().formatCopper(150)), NPC().formatCopper(150));
  });

  test('Mercante: prezzi, acquisto e vendita, oggetti sbloccati dalla reputazione, rifornimento, contrattazione', () => {
    const catalog = DnD.attrezzatura.defaults();
    const npc = merchantNpc();
    const st = NPC().instantiateState(npc);
    const ctx = (rep, attitude) => ({ rep: rep || 0, attitude: attitude || 'indifferente', catalog });
    const line = st.stock[0];
    eq([0, 50, 80, -30].map((r) => NPC().unitSellPrice(npc, st, line, ctx(r))), [200, 180, 160, 240], 'reputazione: sconto o rincaro');
    eq(['amichevole', 'ostile'].map((a) => NPC().unitSellPrice(npc, st, line, ctx(0, a))), [190, 250], 'atteggiamento');
    eq(NPC().offer(npc, st, ctx(0)).map((r) => r.locked), [false, true], 'spada lunga bloccata sotto 50');
    eq(NPC().offer(npc, st, ctx(50)).map((r) => r.locked), [false, false]);
    const buyer = { inventory: [], coins: { mo: 5 } };
    ok(NPC().quote(npc, st, { buy: [{ lineId: 'l2', qty: 1 }] }, buyer, ctx(0)).errors.some((e) => /richiede reputazione 50/.test(e)), 'oggetto bloccato');
    ok(NPC().quote(npc, st, { buy: [{ lineId: 'l1', qty: 4 }] }, buyer, ctx(0)).errors.some((e) => /Solo 3/.test(e)), 'quantità disponibile');
    ok(NPC().quote(npc, st, { buy: [{ lineId: 'l1', qty: 3 }] }, buyer, ctx(0)).errors.some((e) => /Monete insufficienti/.test(e)), 'monete insufficienti (6 mo)');
    eq(NPC().quote(npc, st, {}, buyer, ctx(0)).ok, false, 'carrello vuoto');
    const text = NPC().checkout(npc, st, { buy: [{ lineId: 'l1', qty: 2 }] }, buyer, ctx(0));
    eq([line.qty, buyer.inventory[0].equipmentId, buyer.inventory[0].qty, NPC().toCopper(buyer.coins), NPC().toCopper(st.coins)], [1, 'eq-pugnale', 2, 100, 1400], text);
    ok(/compra 2× Pugnale/.test(text) && /paga 4 mo/.test(text), text);
    eq(NPC().unitBuyPrice(npc, st, 'eq-pugnale', ctx(0)), 100, 'il mercante compra a metà prezzo');
    const sold = NPC().checkout(npc, st, { sell: [{ equipmentId: 'eq-pugnale', qty: 1 }] }, buyer, ctx(0));
    eq([line.qty, buyer.inventory[0].qty, NPC().toCopper(buyer.coins), NPC().toCopper(st.coins)], [2, 1, 200, 1300], sold);
    ok(npc.merchant.stock[0].qty === 3, 'il modello non cambia: cambia solo la copia');
    let threw = false;
    try { NPC().checkout(npc, st, { buy: [{ lineId: 'l2', qty: 1 }] }, buyer, ctx(0)); } catch (e) { threw = true; }
    ok(threw && st.stock[1].qty === 1, 'scambio non valido: errore e nulla cambia');
    // Rifornimento giornaliero fino al tetto.
    eq([NPC().restock(st, 2), line.qty, NPC().restock(st, 2), NPC().restock(st, 10), line.qty, st.stock[1].qty], [2, 4, 0, 1, 5, 1]);
    // Contrattazione: Persuasione contro CD 15.
    const h1 = NPC().haggle(npc, st, 2, seq(13));
    eq([h1.success, h1.total, st.haggle, NPC().unitSellPrice(npc, st, line, ctx(0))], [true, 15, 0.1, 180], h1.text);
    const h2 = NPC().haggle(npc, st, 0, seq(2));
    eq([h2.success, Math.round(st.haggle * 100)], [false, 5], h2.text);
    NPC().haggle(npc, st, 10, seq(20));
    NPC().haggle(npc, st, 10, seq(20));
    eq(Math.round(st.haggle * 100), 20, 'sconto massimo 20%');
  });

  test('NPC neutrale provocato: solo lui, tutta la fazione o la città; penalità, annullamento e calma', () => {
    const t = FZ().table(worldFactions());
    const make = (provoke) => {
      const hero = mkHero({ id: 'h', name: 'Aria' });
      const guard = npcC('g1', { name: 'Guardia' }, { provoke });
      const guard2 = npcC('g2', {}, { defend: 'fazione' });
      const citizen = npcC('g3', { faction: 'neutrali' }, {});
      const far = npcC('g4', {}, { cityId: 'c2' });
      return { hero, guard, guard2, citizen, far, all: [hero, guard, guard2, citizen, far] };
    };
    let w = make('solo');
    eq([FZ().ostili(w.hero, w.guard, t), NPC().countsForXp(w.guard, t), NPC().countsForXp(w.hero, t)], [false, false, true], 'neutrale: non conta nei PE');
    eq(NPC().reactions(w.hero, w.guard, w.all, t).map((x) => x.id), ['g1', 'g2'], 'reagiscono il bersaglio e chi difende la fazione');
    const r = NPC().provoke([w.guard], { combatants: w.all, factions: worldFactions(), symmetric: true, attackerFaction: 'giocatori' });
    eq([r.changed, w.guard.hostileTo, w.guard.npc.attitude, r.reputation], [['g1'], ['giocatori'], 'ostile', [{ factionId: 'gilda', delta: -10, reason: 'attacco a Guardia' }]]);
    eq([FZ().ostili(w.hero, w.guard, t), FZ().ostili(w.guard, w.hero, t), FZ().ostili(w.hero, w.guard2, t), NPC().countsForXp(w.guard, t)], [true, true, false, true], 'solo lui');
    eq([NPC().calm(w.guard), FZ().ostili(w.hero, w.guard, t), w.guard.npc.attitude], ['Guardia si calma e torna neutrale.', false, 'indifferente'], 'calmato');
    // Tutta la fazione: la relazione scende; l'istantanea di prima annulla.
    w = make('fazione');
    const list = worldFactions();
    const rf = NPC().provoke([w.guard], { combatants: w.all, factions: list, symmetric: true, attackerFaction: 'giocatori' });
    const t2 = FZ().table(list);
    eq([FZ().relazione('gilda', 'giocatori', list), FZ().relazione('giocatori', 'gilda', list), FZ().ostili(w.hero, w.guard2, t2), FZ().ostili(w.hero, w.far, t2), FZ().ostili(w.hero, w.citizen, t2)], ['ostile', 'ostile', true, true, false]);
    eq(rf.changed.sort(), ['g1', 'g2', 'g4']);
    eq(FZ().ostili(w.hero, w.guard2, FZ().table(rf.factionsBefore)), false, 'annullamento: relazioni di prima');
    // A cerchi di città: tutti gli NPC della città, di qualunque fazione.
    w = make('citta');
    NPC().provoke([w.guard], { combatants: w.all, factions: worldFactions(), symmetric: true, attackerFaction: 'giocatori' });
    eq([w.guard, w.guard2, w.citizen, w.far].map((x) => FZ().ostili(w.hero, x, t)), [true, true, true, false]);
    ok(!NPC().reactions(w.hero, w.guard, w.all, t).some((x) => x.id === 'g1'), 'già ostile: non reagisce di nuovo');
  });

  test('IA con fazioni: attacca solo gli ostili, ignora i neutrali, l\'NPC amichevole aiuta il party', () => {
    const t = FZ().table(worldFactions());
    const hero = mkHero({ id: 'h', name: 'Aria', pos: { x: 2, y: 2 } });
    const goblin = mkC({ id: 'x', name: 'Goblin', pos: { x: 6, y: 2 } });
    const guard = npcC('g', { pos: { x: 5, y: 2 } });
    const friend = npcC('f', { name: 'Amica', pos: { x: 3, y: 3 }, control: 'ia' }, { defend: 'party', attitude: 'amichevole' });
    const st = aiState([goblin, hero, guard, friend], { relations: t });
    eq([FZ().relazioneCombattenti(friend, hero, t), FZ().relazioneCombattenti(friend, goblin, t), FZ().relazioneCombattenti(goblin, friend, t), FZ().relazioneCombattenti(friend, guard, t)], ['amichevole', 'ostile', 'ostile', 'alleata']);
    eq(plan(st, 'x').scores.map((s) => s.id).sort(), ['f', 'h'], 'il goblin ignora la guardia neutrale');
    eq(plan(st, 'f').action.targetIds, ['x'], 'l\'NPC amichevole attacca i nemici del party');
    eq(plan(aiState([guard, hero, goblin], { relations: t }), 'g').reason, 'NPC g (aggressivo, FOR): nessun avversario rimasto.', 'il neutrale non attacca');
    // Non ancora nell'iniziativa: l'IA non lo considera.
    guard.hostileTo = ['nemici'];
    guard.joinRound = 3;
    ok(!plan(aiState([goblin, hero, guard], { relations: t, round: 1 }), 'x').scores.some((s) => s.id === 'g'), 'in attesa fino al round 3');
    ok(plan(aiState([goblin, hero, guard], { relations: t, round: 3 }), 'x').scores.some((s) => s.id === 'g'), 'dal round 3 conta');
  });

  test('Combattimento con fazioni: cambio a metà, avvisi ad area, fine per fazioni, nextTurn con joinRound', () => {
    const t = FZ().table(worldFactions());
    const hero = mkHero({ id: 'h', name: 'Aria', initiative: 15 });
    const ally = mkC({ id: 'a', name: 'Alleato', faction: 'neutrali', initiative: 12 });
    const orc = mkC({ id: 'o', name: 'Orco', initiative: 10 });
    const goblin = mkC({ id: 'x', name: 'Goblin', initiative: 5 });
    eq(FZ().areaWarnings(hero, [hero, ally, orc, goblin], t), [{ id: 'a', name: 'Alleato', level: 'amichevole' }], 'avvisa solo per chi non è ostile');
    Object.assign(goblin, { prevFaction: goblin.faction, faction: 'neutrali' });
    eq([FZ().ostili(hero, goblin, t), FZ().ostili(orc, goblin, t), FZ().areaWarnings(hero, [orc, goblin], t).map((x) => x.id)], [false, true, ['x']], 'il goblin passa ai Neutrali a metà combattimento');
    eq(DnD.dati.normalizeCombatant(JSON.parse(JSON.stringify(goblin))).prevFaction, 'nemici', '«torna a…» salvato');
    eq(FZ().combatOver([hero, ally, orc, goblin], t).over, false);
    orc.hp = 0;
    eq(FZ().combatOver([hero, ally, orc, goblin], t), { over: true, foes: 1, standing: 0 }, 'tutti gli ostili a terra (il goblin ora neutrale non conta)');
    orc.hp = 5;
    orc.fled = true;
    eq(FZ().combatOver([hero, orc], t).over, true, 'o in fuga');
    eq(FZ().combatOver([hero, ally], t).over, false, 'nessun ostile: non si chiude da solo');
    // Iniziativa: chi entra al round 2 viene saltato al round 1; il fuggito sempre.
    const order = R().sortByInitiative([hero, ally, Object.assign(orc, { fled: false, joinRound: 2 }), goblin]);
    eq(R().firstTurn(order, 1), 'h');
    eq([R().nextTurn(order, 'a', 1), R().nextTurn(order, 'x', 1), R().nextTurn(order, 'a', 2)], [{ currentId: 'x', round: 1 }, { currentId: 'h', round: 2 }, { currentId: 'o', round: 2 }]);
    goblin.fled = true;
    eq(R().nextTurn(order, 'o', 2), { currentId: 'h', round: 3 }, 'il fuggito è saltato');
    eq([R().waiting(orc, 1), R().waiting(orc, 2), R().waiting(goblin, 9)], [true, false, true]);
  });

  test('Party: più membri, ordine di marcia, un solo party per giocatore, attivo e fazione', () => {
    const parties = [PY().normalizeParty({ id: 'A', memberIds: ['p1', 'p2'] }), PY().normalizeParty({ id: 'B', name: 'Esploratori', memberIds: ['p3'] })];
    eq(PY().assignPlayer(parties, 'B', 'p1').id, 'A', 'restituisce il party di prima (per la conferma)');
    eq([parties[0].memberIds, parties[1].memberIds, parties[1].marchOrder, PY().partyOf(parties, 'p1').id], [['p2'], ['p3', 'p1'], ['p3', 'p1'], 'B']);
    eq(PY().assignPlayer(parties, 'B', 'p1'), null, 'già nel party: nessun cambio');
    eq(parties[1].memberIds, ['p3', 'p1'], 'nessun doppione');
    ok(PY().moveInOrder(parties[1], 'p1', -1) && !PY().moveInOrder(parties[1], 'p1', -1), 'ordine di marcia e limiti');
    eq(parties[1].marchOrder, ['p1', 'p3']);
    const players = [{ id: 'p1', name: 'Aria' }, { id: 'p2', name: 'Brun' }];
    eq([PY().members(parties[1], players).list.map((p) => p.name), PY().members(parties[1], players).missing], [['Aria'], 1], 'giocatore eliminato saltato');
    eq(PY().prune(parties[1], players).memberIds, ['p1']);
    eq([PY().active(parties, { activePartyId: 'B' }).id, PY().active(parties, {}).id, PY().active([], {})], ['B', 'A', null]);
    eq(PY().normalizeParty({ memberIds: ['a', 'b', 'c'], marchOrder: ['c', 'x'] }).marchOrder, ['c', 'a', 'b'], 'ordine di marcia normalizzato');
    parties[0].factionId = 'gilda';
    eq([PY().playerFaction({ id: 'p2' }, parties), PY().playerFaction({ id: 'p1' }, parties), PY().playerFaction({ id: 'p1', factionId: 'nemici' }, parties), PY().playerFaction({ id: 'zz' }, parties)], ['gilda', 'giocatori', 'nemici', 'giocatori']);
    eq([FZ().defaultFactionFor({ id: 'p2' }, 'player', { parties }), FZ().defaultFactionFor({}, 'npc', {})], ['gilda', 'nemici'], 'fazione di partenza nel combattimento');
  });

  test('Quest: requisiti, obiettivi con contatori, uccisioni, raccolta, consegna, sblocchi e scadenza', () => {
    const q = QS().normalizeQuest({
      id: 'q1', title: 'Lupi', factionId: 'gilda', requirements: [{ kind: 'reputazione', factionId: 'gilda', min: 10 }, { kind: 'livello', level: 3 }],
      objectives: [{ id: 'o1', kind: 'uccidi', creature: 'lupo', count: 3 }, { id: 'o2', kind: 'raccogli', equipmentId: 'eq-pugnale', count: 2 }, { id: 'o3', kind: 'parla', npcId: 'n1', optional: true }],
      timeLimit: 48, rewards: { xp: 300, coins: { mo: 20 }, reputation: [{ factionId: 'gilda', delta: 15 }], unlockQuestIds: ['q2'] },
    });
    const ctx = (rep) => ({ rep: () => rep, level: 4, hasItem: () => false, eventDone: () => false, blockHostile: true });
    eq([QS().requirementsMet(q, ctx(5)), QS().requirementsMet(q, ctx(10)).ok], [{ ok: false, missing: ['reputazione 10'] }, true]);
    ok(QS().requirementsMet(q, ctx(-60)).missing.includes('fazione ostile'), 'fazione ostile: bloccata');
    const j = {};
    eq(QS().statusOf(j, 'q1'), 'disponibile');
    const e = QS().accept(j, q, 10, 'pa');
    eq([e.status, e.offered, e.deadline, e.partyId, QS().accept(j, q, 11)], ['attiva', true, 58, 'pa', null]);
    eq(QS().onKill(j, [q], { name: 'Lupo 2' }).length, 1, 'per nome (senza il numero della copia)');
    eq(QS().onKill(j, [q], { name: 'Orso', creature: { ctype: 'bestia' } }), [], 'altre creature no');
    QS().onKill(j, [q], { name: 'Grande Lupo' });
    const last = QS().onKill(j, [q], { name: 'Bestia', creature: { ctype: 'lupo mannaro' } });
    ok(last.some((l) => /3\/3 ✓/.test(l)), 'per tipo, con ✓');
    eq([QS().onKill(j, [q], { name: 'Lupo' }), j.q1.progress.o1, QS().allDone(q, j.q1)], [[], 3, false], 'il contatore non supera il totale');
    eq(QS().complete(j, q, 12), { ok: false, reason: 'obiettivi non completati' });
    QS().onCollect(j, [q], () => 1);
    eq(j.q1.progress.o2, 1, 'raccogli: conta il posseduto');
    const lines = QS().onCollect(j, [q], () => 5);
    eq([j.q1.progress.o2, lines.length, QS().allDone(q, j.q1)], [2, 1, true], 'facoltativo non richiesto');
    const done = QS().complete(j, q, 20);
    eq([done.ok, done.rewards.xp, done.rewards.coins.mo, done.rewards.reputation, j.q1.status, j.q1.endedAt, j.q2.unlocked], [true, 300, 20, [{ factionId: 'gilda', delta: 15 }], 'completata', 20, true]);
    eq(QS().complete(j, q, 21).ok, false, 'già consegnata');
    // Nemico preciso della libreria, scadenza e fallimento.
    const q3 = QS().normalizeQuest({ id: 'q3', title: 'Il capo', timeLimit: 5, objectives: [{ id: 'k', kind: 'uccidi', npcSourceId: 'boss1' }] });
    QS().accept(j, q3, 0);
    eq([QS().onKill(j, [q3], { name: 'Altro', sourceId: 'x' }).length, QS().onKill(j, [q3], { name: 'Capo', sourceId: 'boss1' }).length > 0], [0, true]);
    eq([QS().expire(j, [q3], 5).length, QS().expire(j, [q3], 6).map((x) => x.id), j.q3.status], [0, ['q3'], 'scaduta']);
    const q4 = QS().normalizeQuest({ id: 'q4', title: 'Rotta', objectives: [{ id: 'r', kind: 'raggiungi', gridId: 'g', x: 2, y: 3 }, { id: 'v', kind: 'evento', eventId: 'ev' }] });
    QS().accept(j, q4, 0);
    eq([QS().onReach(j, [q4], 'g', 2, 2).length, QS().onReach(j, [q4], 'g', 2, 3).length, QS().onEvent(j, [q4], 'ev').length, QS().onTalk(j, [q4], 'n1').length], [0, 1, 2, 0]);
    QS().fail(j, q4, 9);
    eq([j.q4.status, QS().onEvent(j, [q4], 'ev')], ['fallita', []], 'una quest fallita non avanza');
    eq(QS().journalList([q, q3, q4], j, { status: 'scaduta' }).map((x) => x.id), ['q3']);
    eq(QS().journalList([q, q3, q4], j, { factionId: 'gilda', text: 'lup' }).map((x) => x.id), ['q1'], 'ricerca e filtro per fazione');
  });

  test('Dialoghi: condizioni (reputazione, oggetto, variabile), esiti, prove e avvisi', () => {
    const dialog = NPC().normalizeDialog({ start: 'a', nodes: [
      { id: 'a', text: 'Ciao', answers: [
        { id: 'r1', text: 'Sconto?', conds: [{ kind: 'reputazione', factionId: 'gilda', min: 20 }], outcomes: [{ kind: 'atteggiamento', value: 'amichevole' }, { kind: 'vai', to: 'b' }] },
        { id: 'r2', text: 'Convinci', outcomes: [{ kind: 'prova', what: 'Persuasione', dc: 12, success: 'b', failure: 'c' }] },
        { id: 'r3', text: 'Chiave', conds: [{ kind: 'oggetto', equipmentId: 'eq-chiave' }, { kind: 'variabile', name: 'porta', op: '=', value: 'aperta', negate: true }], outcomes: [{ kind: 'quest', questId: 'q1' }, { kind: 'fine' }] },
      ] },
      { id: 'b', text: 'Affare fatto' },
      { id: 'c', text: 'No', answers: [{ id: 'r4', outcomes: [{ kind: 'vai', to: 'zzz' }] }] },
      { id: 'd', text: 'Orfano' },
    ] });
    const ctx = (o) => Object.assign({ rep: () => 0, hasItem: () => true, variable: () => undefined, attitude: 'indifferente', bonus: () => 2 }, o);
    const a = NPC().nodeOf(dialog, 'a');
    eq(NPC().answersFor(a, ctx()).map((x) => x.id), ['r2', 'r3']);
    eq(NPC().answersFor(a, ctx({ rep: (f) => (f === 'gilda' ? 20 : 0), variable: () => 'aperta' })).map((x) => x.id), ['r1', 'r2'], 'reputazione sufficiente, porta già aperta');
    eq(NPC().answersFor(a, ctx({ hasItem: () => false })).map((x) => x.id), ['r2'], 'senza l\'oggetto');
    eq(NPC().choose(dialog, a.answers[0], ctx()), { next: 'b', effects: [{ kind: 'atteggiamento', value: 'amichevole' }], lines: [] });
    const ok1 = NPC().choose(dialog, a.answers[1], ctx(), seq(10));
    const ko = NPC().choose(dialog, a.answers[1], ctx(), seq(9));
    eq([ok1.next, ko.next, /Persuasione 12 contro CD 12: successo/.test(ok1.lines[0])], ['b', 'c', true], 'prova con successo e fallimento');
    eq(NPC().choose(dialog, a.answers[2], ctx()), { next: '', effects: [{ kind: 'quest', questId: 'q1' }], lines: [] }, 'apri quest e fine');
    const broken = NPC().choose(dialog, NPC().nodeOf(dialog, 'c').answers[0], ctx());
    eq([broken.next, broken.lines.length], ['', 1], 'nodo eliminato: il dialogo finisce senza errori');
    eq(NPC().dialogWarnings(dialog), ['«Orfano» non è raggiungibile.', 'Una risposta porta a un nodo eliminato.']);
    eq(NPC().normalizeDialog({ start: 'zz', nodes: [{ id: 'n' }] }).start, 'n', 'inizio mancante: il primo nodo');
  });

  test('NPC: istanze indipendenti dallo stesso modello, fazione dalla città, atteggiamento, routine, promozione', () => {
    const npc = merchantNpc({ notes: 'segreto' });
    const i1 = NPC().placedItem(npc, 'it1', 0, 0);
    const i2 = NPC().placedItem(npc, 'it2', 1, 0);
    i1.npcState.stock[0].qty = 0;
    i1.npcState.hp = 3;
    i1.npcState.delivered.push('q1');
    eq([i1.otype, i1.npcId, i2.npcState.stock[0].qty, i2.npcState.hp, i2.npcState.delivered, npc.merchant.stock[0].qty], ['npc', 'm', 3, null, [], 3], 'ogni copia ha il suo stato');
    const back = NPC().normalizeState(JSON.parse(JSON.stringify(i1.npcState)), npc);
    eq([back.stock[0].qty, back.hp, back.delivered], [0, 3, ['q1']], 'stato salvato');
    // Città: la sua fazione è quella predefinita per NPC e nemici creati lì.
    const city = CT().quickCity({ id: 'c1', name: 'Rocca', factionId: 'gilda', size: 'citta' }, 's');
    const local = NPC().normalizeNpc({ id: 'n2', cityId: 'c1', roles: ['quest'] });
    eq([NPC().factionOf(local, null, [city]), NPC().factionOf(local, { factionId: 'nemici' }, [city]), NPC().factionOf(local, null, []), NPC().factionOf(npc, null, [city])], ['gilda', 'nemici', 'neutrali', 'gilda']);
    eq([FZ().defaultFactionFor({ cityId: 'c1' }, 'npc', { cities: [city] }), FZ().defaultFactionFor({ cityId: 'c1', factionId: 'nemici' }, 'npc', { cities: [city] })], ['gilda', 'nemici'], 'nemico creato in città');
    const q = QS().normalizeQuest({ id: 'qq', giver: { npcId: 'n2' } });
    const c = CT().contents(city, [npc, local], [q]);
    eq([c.npcs.map((n) => n.id), c.merchants, c.quests.map((x) => x.id)], [['n2'], [], ['qq']], 'contenuti della città');
    eq([CT().placeEvent(city).actions[0].kind, CT().placeEvent(Object.assign({}, city, { gridId: 'g' })).actions[0].kind], ['nota', 'mappa'], 'segnaposto «Entra in una mappa»');
    // Atteggiamento: base più modificatore dalla reputazione con la sua fazione.
    const s = NPC().instantiateState(npc);
    eq([NPC().attitudeOf(npc, s, 0), NPC().attitudeOf(npc, s, 20), NPC().attitudeOf(npc, s, -20), NPC().attitudeOf(npc, Object.assign({}, s, { attitude: 'amichevole' }), -20), NPC().attitudeOf(npc, Object.assign({}, s, { hostile: true }), 90)],
      ['indifferente', 'amichevole', 'ostile', 'amichevole', 'ostile']);
    const r = NPC().normalizeNpc({ routine: [{ from: 22, to: 6, place: 'Taverna' }, { from: 8, to: 18, place: 'Bottega' }] });
    eq([23, 3, 12, 19].map((h) => (NPC().routineAt(r, h) || {}).place || null), ['Taverna', 'Taverna', 'Bottega', null], 'routine anche a cavallo della mezzanotte');
    const enemy = DnD.dati.normalizeCreature({ id: 'e', name: 'Lupo', type: 'creatura', size: 'Media' }, false);
    const promoted = NPC().fromEnemy(enemy, 's');
    eq([promoted.name, promoted.base, promoted.roles, promoted.id !== 'e', enemy.name], ['Lupo', 'creatura', ['informatore'], true, 'Lupo'], 'promosso da nemico; l\'originale resta');
  });

  test('Vista dei giocatori e riferimenti mancanti: NPC, quest e città', () => {
    const npc = merchantNpc({ notes: 'segreto', questIds: ['q1', 'q2'] });
    const s = NPC().instantiateState(npc);
    let v = NPC().statoNpcPerGiocatore(npc, s, { shopOpen: true, offeredQuestIds: ['q1', 'q9'] });
    eq([v.name, v.roles, v.attitude, v.shop, v.quests, 'notes' in v, 'merchant' in v], ['Bera', [], null, [], ['q1'], false, false], 'senza rivelare: solo nome e icona');
    s.revealed.role = true;
    s.revealed.attitude = true;
    s.stock[0].qty = 0;
    v = NPC().statoNpcPerGiocatore(npc, s, { shopOpen: true, attitude: 'amichevole' });
    eq([v.roles, v.attitude, v.shop], [['mercante'], 'amichevole', []], 'merce esaurita e merce sbloccata da reputazione non si vedono');
    eq(NPC().statoNpcPerGiocatore(merchantNpc({ hiddenRole: true }), s, { shopOpen: true }).roles, [], 'ruolo nascosto');
    s.revealed.name = false;
    s.hostile = true;
    eq([NPC().statoNpcPerGiocatore(npc, s).name, NPC().statoNpcPerGiocatore(npc, s).status], ['Sconosciuto', 'ostile']);
    // Quest: i giocatori vedono solo quelle offerte e accettate.
    const qs = ['a', 'b', 'c'].map((id) => QS().normalizeQuest({ id, title: id.toUpperCase(), notes: 'segreto', objectives: [{ id: 'o', kind: 'parla', npcId: 'n' }] }));
    const j = {};
    QS().offer(j, qs[1]);
    QS().accept(j, qs[2], 0);
    QS().onTalk(j, qs, 'n');
    eq(QS().perGiocatore(qs, j), [{ id: 'c', title: 'C', description: '', status: 'attiva', objectives: [{ text: 'parla con l\'NPC', done: true, progress: 1, count: 1 }] }]);
    // Riferimenti mancanti: avvisi, nessun errore.
    const catalog = DnD.attrezzatura.defaults();
    const world = { factions: worldFactions(), cities: [], quests: [qs[0]], npcs: [] };
    const broken = merchantNpc({ cityId: 'sparita', questIds: ['a', 'zz'], merchant: { stock: [{ equipmentId: 'eq-sparito' }] } });
    eq(NPC().missingRefs(broken, { equipment: catalog, savedGrids: [] }, world), ['città eliminata', 'oggetto in vendita eliminato', 'quest eliminata']);
    const bq = QS().normalizeQuest({ giver: { npcId: 'nn' }, factionId: 'sparita', objectives: [{ kind: 'raccogli', equipmentId: 'eq-sparito' }, { kind: 'uccidi', npcSourceId: 'boh' }], rewards: { items: [{ equipmentId: 'eq-sparito' }] } });
    eq(QS().missingRefs(bq, { equipment: catalog, npcs: [], events: [] }, world), ['datore eliminato', 'fazione eliminata', 'oggetto da raccogliere eliminato', 'creatura dell\'obiettivo eliminata', 'oggetto della ricompensa eliminato']);
    const bc = CT().normalizeCity({ factionId: 'sparita', gridId: 'gg', questIds: ['zz'], eventIds: ['ev'] });
    eq(CT().missingRefs(bc, { savedGrids: [], biomes: [], events: [] }, world), ['fazione dominante eliminata', 'mappa collegata eliminata', 'quest eliminata', 'evento eliminato']);
    eq(FZ().defaultFactionFor({ factionId: 'sparita' }, 'npc', { factions: world.factions }), 'nemici', 'fazione eliminata nel combattimento: torna alla predefinita');
  });

  // Mondo di una sessione per migrazione, esportazione e duplicazione.
  function worldState() {
    const st = DnD.dati.emptyState();
    const sess = S().current(st);
    const sid = sess.id;
    st.players.push(Object.assign(DnD.dati.normalizeCreature({ id: 'p1', name: 'Aria' }, true), { sessionId: sid }));
    st.factions.push(FZ().normalizeFaction({ id: 'gilda', name: 'Gilda', sessionId: sid, relations: { giocatori: 'amichevole' } }));
    st.cities.push(CT().normalizeCity({ id: 'c1', name: 'Rocca', factionId: 'gilda', sessionId: sid }));
    st.worldNpcs.push(Object.assign(merchantNpc({ cityId: 'c1', questIds: ['q1'] }), { sessionId: sid }));
    st.quests.push(QS().normalizeQuest({ id: 'q1', title: 'Lupi', factionId: 'gilda', giver: { npcId: 'm' }, sessionId: sid, rewards: { reputation: [{ factionId: 'gilda', delta: 10 }] } }));
    const party = st.parties.find((p) => p.sessionId === sid);
    Object.assign(party, { memberIds: ['p1'], marchOrder: ['p1'], reputation: { gilda: 30 } });
    sess.world.activePartyId = party.id;
    QS().accept(sess.world.quests, st.quests.find((q) => q.id === 'q1'), 0, party.id);
    FZ().changeReputation({ world: sess.world, party }, 'gilda', 5, 'prova');
    return { st, sess, party };
  }

  test('Mondo: migrazione v11 → v12 (party «Gruppo», fazioni predefinite ed esempi, combattenti con la fazione di prima)', () => {
    const mig = DnD.dati.normalizeState({ version: 11, races: [], npcs: [], players: [{ id: 'z', name: 'Zed' }, { id: 'y', name: 'Yla' }] });
    const se = S().current(mig);
    const K = DnD.mondoDati;
    eq([mig.version, mig.factions.map((f) => f.id), mig.parties.length, mig.parties[0].name, mig.parties[0].memberIds, se.world.activePartyId === mig.parties[0].id],
      [DnD.dati.VERSION, ['giocatori', 'nemici', 'neutrali', K.EXAMPLE_FACTION], 1, 'Gruppo', ['z', 'y'], true]);
    eq([mig.cities.map((c) => c.id), mig.worldNpcs.map((n) => n.id), mig.quests.map((q) => q.id), se.world.repLog], [[K.EXAMPLE_CITY], [K.EXAMPLE_NPC], [K.EXAMPLE_QUEST], []], 'esempi del Mondo');
    eq(DnD.dati.normalizeState({ version: 11, kind: 'sessione', races: [], npcs: [], players: [] }).cities, [], 'i file di una sessione non ricevono esempi');
    // Esempi originali validi: nessun riferimento mancante, dialogo completo, condivisi.
    const st = DnD.dati.emptyState();
    const v = FZ().view(st);
    const world = { factions: v.factions, cities: v.cities, quests: v.quests, npcs: v.npcs };
    const orsola = v.npcs.find((n) => n.id === K.EXAMPLE_NPC);
    eq([NPC().missingRefs(orsola, st, world), QS().missingRefs(v.quests[0], st, world), CT().missingRefs(v.cities[0], st, world), NPC().dialogWarnings(orsola.dialog)], [[], [], [], []]);
    eq([orsola.shared, orsola.roles, NPC().factionOf(orsola, null, v.cities), FZ().relazione(K.EXAMPLE_FACTION, 'giocatori', v.factions), orsola.merchant.stock.length], [true, ['mercante', 'quest'], K.EXAMPLE_FACTION, 'amichevole', 4]);
    eq(CT().contents(v.cities[0], v.npcs, v.quests).quests.map((q) => q.id), [K.EXAMPLE_QUEST], 'la città elenca la quest del suo mercante');
    eq(['giocatori', 'nemici', 'neutrali'].map((f) => DnD.dati.normalizeCombatant({ name: 'X', faction: f }).faction), ['giocatori', 'nemici', 'neutrali'], 'la fazione di prima resta');
    eq([DnD.dati.normalizeCombatant({ name: 'X', kind: 'player' }).faction, DnD.dati.normalizeCombatant({ name: 'X' }).faction], ['giocatori', 'nemici']);
    eq(DnD.dati.normalizeState(JSON.parse(JSON.stringify(mig))).parties.length, 1, 'una seconda normalizzazione non aggiunge party');
  });

  test('Mondo: esportazione e importazione (archivio e sessione) e duplicazione di sessione', () => {
    const { st, sess, party } = worldState();
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(st));
    const bs = S().current(back);
    const bp = back.parties.find((p) => p.id === party.id);
    eq([back.factions.some((f) => f.id === 'gilda'), back.cities.find((c) => c.id === 'c1').factionId, back.worldNpcs.find((n) => n.id === 'm').cityId, bp.reputation.gilda, bs.world.quests.q1.status, bs.world.repLog.length], [true, 'gilda', 'c1', 35, 'attiva', 1], 'archivio');
    // File di una sessione: nuovi id, riferimenti aggiornati, predefinite non duplicate.
    const file = JSON.parse(JSON.stringify(S().exportSession(st, sess.id)));
    eq([file.factions.length, file.cities.length, file.worldNpcs.length, file.quests.length, file.parties.length], [5, 2, 2, 2, 1], 'tutto il Mondo nel file (anche gli esempi condivisi)');
    const dst = DnD.dati.emptyState();
    const imp = S().importSession(dst, file, DnD.dadi.uid);
    const fg = dst.factions.find((f) => f.name === 'Gilda');
    const city = dst.cities.find((c) => c.name === 'Rocca');
    const npc = dst.worldNpcs.find((n) => n.name === 'Bera');
    const q = dst.quests.find((x) => x.title === 'Lupi');
    const ip = dst.parties.find((p) => p.sessionId === imp.id);
    eq([dst.factions.length, dst.worldNpcs.length], [5, 2], 'predefinite ed esempi condivisi non duplicati');
    ok(fg.id !== 'gilda' && city.factionId === fg.id && npc.factionId === fg.id && npc.cityId === city.id && npc.questIds[0] === q.id, 'fazione, città e quest dell\'NPC');
    ok(q.giver.npcId === npc.id && q.factionId === fg.id && q.rewards.reputation[0].factionId === fg.id, 'quest');
    const p1 = dst.players.find((p) => p.name === 'Aria');
    eq([ip.memberIds, Object.keys(ip.reputation), imp.world.activePartyId, Object.keys(imp.world.quests), imp.world.quests[q.id].partyId, imp.world.repLog[0].factionId], [[p1.id], [fg.id], ip.id, [q.id], ip.id, fg.id], 'party, diario e registro');
    // Sessione di una versione precedente: i giocatori entrano nel party «Gruppo».
    const old = JSON.parse(JSON.stringify(file));
    old.version = 11;
    old.parties = [];
    const dst2 = DnD.dati.emptyState();
    const imp2 = S().importSession(dst2, old, DnD.dadi.uid);
    const g = dst2.parties.find((p) => p.sessionId === imp2.id);
    eq([g.name, g.memberIds.length, imp2.world.activePartyId === g.id], ['Gruppo', 1, true]);
    // Duplicazione: copie indipendenti con i riferimenti della copia.
    const dup = S().duplicateSession(st, sess.id, 'Copia', DnD.dadi.uid);
    const df = st.factions.find((f) => f.sessionId === dup.id && f.name === 'Gilda');
    const dc = st.cities.find((c) => c.sessionId === dup.id);
    const dn = st.worldNpcs.find((n) => n.sessionId === dup.id);
    const dpt = st.parties.find((p) => p.sessionId === dup.id);
    ok(df && df.id !== 'gilda' && dc.factionId === df.id && dn.cityId === dc.id && dpt.reputation[df.id] === 35 && dup.world.activePartyId === dpt.id, 'duplicazione con il Mondo');
    eq(st.cities.find((c) => c.id === 'c1').factionId, 'gilda', 'l\'originale non cambia');
  });

  test('Mondo negli eventi: azioni Reputazione e Quest (avvia, avanza, completa, fallisci), scadenza col tempo', () => {
    const w = exploreWorld();
    const sess = S().current(w.st);
    const party = DnD.party.active(FZ().view(w.st).parties, sess.world);
    w.st.factions.push(FZ().normalizeFaction({ id: 'gilda', name: 'Gilda', sessionId: sess.id }));
    w.st.quests.push(QS().normalizeQuest({ id: 'q1', title: 'Sentiero', sessionId: sess.id, timeLimit: 30, objectives: [{ id: 'o', kind: 'evento', eventId: 'e1', count: 2 }] }));
    w.st.quests.push(QS().normalizeQuest({ id: 'q2', title: 'Scorta', sessionId: sess.id }));
    const run = (actions) => XP().fireEvent(w, { event: EV().normalizeEvent({ id: 'bivio', name: 'Bivio', actions }) }, {});
    run([{ kind: 'reputazione', factionId: 'gilda', delta: 10, reason: 'aiuto' }, { kind: 'quest', op: 'avvia', questId: 'q1' }]);
    const j = sess.world.quests;
    eq([party.reputation.gilda, sess.world.repLog[0].source, j.q1.status, j.q1.deadline], [10, 'evento', 'attiva', w.ex.time.total + 30]);
    ok(w.ex.log.some((l) => /Reputazione con «Gilda»: \+10 \(10\)/.test(l.text)) && w.ex.log.some((l) => /Quest «Sentiero» accettata/.test(l.text)), 'nel registro');
    run([{ kind: 'quest', op: 'avanza', questId: 'q1', n: 1 }]);
    eq(j.q1.progress.o, 1, 'avanza');
    eq(XP().questOp(w, 'avanza', 'q1', 'o', 5).length, 2, 'fino al totale, poi «da consegnare»');
    eq([XP().questOp(w, 'completa', 'q1')[0].includes('completata'), j.q1.status], [true, 'completata']);
    // Obiettivo «Completa un evento»: lo fa avanzare l'evento stesso, quando finisce.
    w.st.quests.push(QS().normalizeQuest({ id: 'q5', title: 'Pellegrino', sessionId: sess.id, objectives: [{ id: 'p', kind: 'evento', eventId: 'e1', count: 2 }] }));
    XP().questOp(w, 'avvia', 'q5');
    XP().fireEvent(w, { event: EV().normalizeEvent({ id: 'e1', name: 'Santuario', actions: [{ kind: 'testo', text: 'Una preghiera.' }] }) }, {});
    eq(j.q5.progress.p, 1, 'evento completato');
    run([{ kind: 'quest', op: 'avvia', questId: 'q2' }, { kind: 'quest', op: 'fallisci', questId: 'q2' }, { kind: 'quest', op: 'avvia', questId: 'sparita' }, { kind: 'reputazione', factionId: 'sparita', delta: 5 }]);
    eq(j.q2.status, 'fallita');
    ok(w.ex.log.some((l) => /Quest eliminata/.test(l.text)) && w.ex.log.some((l) => /fazione eliminata/.test(l.text)), 'riferimenti mancanti: avviso, nessun errore');
    // Scadenza: il tempo dell'esplorazione chiude le quest oltre il limite.
    const q3 = QS().normalizeQuest({ id: 'q3', title: 'Corsa', sessionId: sess.id, timeLimit: 2 });
    w.st.quests.push(q3);
    XP().questOp(w, 'avvia', 'q3');
    XP().advanceTime(w, 3);
    eq(j.q3.status, 'scaduta');
    ok(w.ex.log.some((l) => /Quest «Corsa» scaduta/.test(l.text)), 'scadenza nel registro');
    eq(EV().missingRefs(EV().normalizeEvent({ actions: [{ kind: 'quest', questId: 'zz' }, { kind: 'reputazione', factionId: 'zz' }] }), w.st).sort(), ['fazione eliminata', 'quest eliminata'], 'avvisi nell\'elenco degli eventi');
  });

  // ======================= Condizioni e concentrazione =======================
  const CO = () => DnD.condizioni;
  // Attaccante e bersaglio adiacenti (1 cella) sulla griglia; t2 a 4 celle.
  const duel = () => ({ a: mkHero({ id: 'a', name: 'Aria', pos: { x: 0, y: 0 } }), t: mkC({ id: 't', name: 'Orco', pos: { x: 1, y: 0 } }) });
  const near = { melee: true, distance: 1 };
  const far = { melee: false, distance: 4 };

  test('Condizioni: tabella degli effetti, normalizzazione, stringhe precedenti, personalizzate', () => {
    const ids = CO().TYPES.map((t) => t.id);
    for (const id of ['accecato', 'affascinato', 'assordato', 'spaventato', 'afferrato', 'incapacitato', 'invisibile', 'paralizzato', 'pietrificato',
      'avvelenato', 'prono', 'trattenuto', 'stordito', 'privo di sensi', 'sfinimento']) ok(ids.includes(id), id);
    ok(CO().TYPES.every((t) => t.name && t.icon && t.text && /^#[0-9a-f]{6}$/.test(t.color) && t.effects.every((e) => CO().EFFECT_IDS.includes(e))), 'nome, icona, colore, testo, effetti validi');
    const list = CO().normalizeList(['prono', 'boh', 'prono']);
    eq([list.length, list[0].type, list[0].id, list[0].source.name, list[0].duration.kind], [1, 'prono', 'cond-prono', 'manuale', 'permanente'], 'stringhe della versione 12');
    eq(CO().normalizeList(list)[0].id, 'cond-prono', 'id stabile');
    const ex3 = CO().defOf(CO().normalizeEntry({ type: 'sfinimento', level: 3 }));
    eq([ex3.name, ex3.effects.sort()], ['Sfinimento 3', ['attacchi-svantaggio', 'prove-svantaggio', 'ts-svantaggio', 'velocita-meta']], 'livelli cumulativi');
    const mark = CO().normalizeCustom({ id: 'cp-marchio', name: 'Marchiato', icon: '🎯', effects: ['contro-vantaggio', 'boh'] });
    eq(mark.effects, ['contro-vantaggio'], 'effetti scelti dall\'elenco');
    const { a, t } = duel();
    eq(CO().apply(t, { type: 'custom', custom: mark, source: { id: 'a', name: 'Aria' } }).ok, true);
    eq(CO().attackMods(a, t, far).adv, ['bersaglio marchiato'], 'personalizzata come fonte di vantaggio');
    eq([CO().has(t, 'prono'), CO().types(t), CO().nameOf(CO().normalizeList(t.conditions)[0])], [false, ['custom'], 'Marchiato']);
  });

  test('Condizioni negli attacchi: vantaggio e svantaggio da più fonti, prono vicino e a distanza, critico automatico', () => {
    let { a, t } = duel();
    CO().apply(t, { type: 'prono' });
    const m1 = CO().attackMods(a, t, near);
    eq([m1.mode, m1.adv, CO().modsText(m1)], ['vantaggio', ['bersaglio prono, entro 1 cella'], 'vantaggio: bersaglio prono, entro 1 cella']);
    eq([CO().attackMods(a, t, far).mode, CO().attackMods(a, t, far).dis], ['svantaggio', ['bersaglio prono, a distanza']], 'prono a distanza');
    CO().apply(a, { type: 'avvelenato' });
    const both = CO().attackMods(a, t, near);
    eq([both.mode, /si annullano/.test(CO().modsText(both))], ['normale', true], 'vantaggio e svantaggio insieme = normale');
    eq(CO().attackMods(a, t, Object.assign({ base: 'vantaggio' }, far)).mode, 'normale', 'scelta del tiro e condizioni si combinano');
    // Bersaglio paralizzato o privo di sensi: vantaggio e critico automatico in mischia entro 1 cella.
    ({ a, t } = duel());
    CO().apply(t, { type: 'paralizzato' });
    eq([CO().attackMods(a, t, near).mode, CO().attackMods(a, t, near).autoCrit], ['vantaggio', 'bersaglio paralizzato, in mischia entro 1 cella']);
    eq([CO().attackMods(a, t, far).autoCrit, CO().attackMods(a, t, { melee: false, distance: 1 }).autoCrit], [null, null], 'non a distanza né con un\'arma a distanza');
    CO().remove(t, 'paralizzato');
    CO().apply(t, { type: 'privo di sensi' });
    ok(CO().attackMods(a, t, near).autoCrit, 'privo di sensi');
    for (const ty of ['stordito', 'trattenuto', 'accecato', 'pietrificato']) {
      ({ a, t } = duel());
      CO().apply(t, { type: ty });
      eq(CO().attackMods(a, t, far).mode, 'vantaggio', 'bersaglio ' + ty);
    }
    for (const ty of ['accecato', 'spaventato', 'avvelenato', 'prono', 'trattenuto']) {
      ({ a, t } = duel());
      CO().apply(a, { type: ty });
      eq(CO().attackMods(a, t, near).mode, 'svantaggio', 'attaccante ' + ty);
    }
    ({ a, t } = duel());
    CO().apply(a, { type: 'invisibile' });
    eq(CO().attackMods(a, t, far).mode, 'vantaggio', 'attaccante invisibile');
    eq(CO().attackMods(t, a, far).mode, 'svantaggio', 'contro un invisibile');
    // Paura: solo con la fonte in vista; affascinato: non attacca chi l'ha affascinato.
    ({ a, t } = duel());
    CO().apply(a, { type: 'spaventato', source: { id: 't', name: 'Orco' } });
    const byId = (id) => [a, t].find((x) => x.id === id);
    eq([CO().attackMods(a, t, Object.assign({ byId, canSee: () => true }, near)).mode, CO().attackMods(a, t, Object.assign({ byId, canSee: () => false }, near)).mode], ['svantaggio', 'normale']);
    CO().remove(a, 'spaventato');
    CO().apply(a, { type: 'affascinato', source: { id: 't', name: 'Orco' } });
    ok(/non può attaccare Orco/.test(CO().attackMods(a, t, near).blocked), 'affascinato');
    eq(CO().attackMods(a, mkC({ id: 'z', name: 'Altro' }), near).blocked, null, 'gli altri sì');
    // Regole dei tiri: critico automatico (dadi raddoppiati) solo se colpisce.
    const hit = R().resolveAttack({ toHit: 5, targetAC: 10, damageDice: '1d6', damageBonus: 0, mode: 'normale', autoCrit: true }, seq(12, 3, 4));
    eq([hit.hit, hit.crit, hit.damageDiceCount, hit.damage], [true, true, 2, 7]);
    const miss = R().resolveAttack({ toHit: 0, targetAC: 15, damageDice: '1d6', damageBonus: 0, mode: 'normale', autoCrit: true }, seq(5));
    eq([miss.hit, miss.crit], [false, false]);
    const sp = DnD.dati.normalizeSpell({ id: 'raggio', name: 'Raggio', effect: { type: 'attacco', dice: '1d10' } });
    const rs = DnD.magie.resolveSpell({ spell: sp, slotLevel: 0, mode: 'normale', caster: { attack: 5, dc: 13, mod: 3 }, targets: [{ id: 'x', ac: 10, saves: {}, mode: 'svantaggio' }] }, seq(18, 4, 2));
    eq([rs.targets[0].d20Rolls, rs.targets[0].natural, rs.targets[0].hit], [[18, 4], 4, false], 'incantesimo: il modo del bersaglio prevale');
  });

  test('Condizioni nei tiri salvezza e nelle prove: fallimenti automatici e svantaggio', () => {
    for (const ty of ['paralizzato', 'stordito', 'privo di sensi', 'pietrificato']) {
      const c = mkC({ id: 'x' });
      CO().apply(c, { type: ty });
      eq([CO().saveMods(c, 'FOR').autoFail, CO().saveMods(c, 'DES').autoFail, CO().saveMods(c, 'SAG').autoFail], [ty, ty, null], ty);
    }
    const tr = mkC({ id: 'x' });
    CO().apply(tr, { type: 'trattenuto' });
    eq([CO().saveMods(tr, 'DES').mode, CO().saveMods(tr, 'FOR').mode, CO().saveMods(tr, 'DES', 'vantaggio').mode], ['svantaggio', 'normale', 'normale']);
    const pv = mkC({ id: 'p' });
    CO().apply(pv, { type: 'avvelenato' });
    eq(CO().checkMods(pv).mode, 'svantaggio', 'avvelenato: prove');
    const bl = mkC({ id: 'b' });
    CO().apply(bl, { type: 'accecato' });
    eq([CO().checkMods(bl, { sight: true }).mode, CO().checkMods(bl).mode], ['svantaggio', 'normale'], 'accecato: solo le prove di vista');
    const fr = mkC({ id: 'f' });
    CO().apply(fr, { type: 'spaventato' });
    eq(CO().checkMods(fr).dis, ['spaventato']);
    // Le azioni delle creature e gli incantesimi rispettano il fallimento automatico (nessun tiro).
    const m = DnD.creature.normalizeMonster({ name: 'Drago', actions: [{ id: 'soffio', name: 'Soffio', mech: { kind: 'salvezza', ability: 'DES', dc: 15, damages: [{ dice: '2d6', bonus: 0 }] } }] });
    const r = DnD.creature.resolveSave(m, m.actions[0], { saves: { DES: 5 } }, seq(3, 4), 'normale', true);
    eq([r.success, r.total, r.parts[0].amount], [false, null, 7], 'fallimento automatico: danni pieni, nessun d20');
    const sv = DnD.dati.normalizeSpell({ id: 's', effect: { type: 'salvezza', dice: '1d6', saveAbility: 'DES', halfOnSave: true } });
    const res = DnD.magie.resolveSpell({ spell: sv, slotLevel: 0, caster: { attack: 0, dc: 12, mod: 0 }, targets: [{ id: 'x', saves: { DES: 10 }, autoFail: true }] }, seq(6));
    eq([res.targets[0].success, res.targets[0].autoFail, res.targets[0].amount], [false, true, 6]);
  });

  test('Condizioni: azioni bloccate, velocità, IA (incapacitato, invisibili, bersagli con vantaggio)', () => {
    for (const ty of ['incapacitato', 'paralizzato', 'stordito', 'pietrificato', 'privo di sensi']) {
      const c = mkC({ id: 'x' });
      CO().apply(c, { type: ty });
      ok(/nessuna azione/.test(CO().actionBlock(c)), ty);
    }
    const pr = mkC({ id: 'p' });
    CO().apply(pr, { type: 'prono' });
    eq([CO().actionBlock(pr), CO().actionBlock(Object.assign(mkC({ id: 'm' }), { dead: true }))], [null, 'morto']);
    for (const ty of ['afferrato', 'trattenuto', 'paralizzato', 'stordito', 'pietrificato', 'privo di sensi']) {
      const c = mkC({ id: 'x' });
      CO().apply(c, { type: ty });
      eq(MV().speedState(c, RULES1, 5).cells, 0, ty + ': velocità 0');
    }
    eq(MV().speedState(pr, RULES1, 5).extra, 1, 'prono: striscia');
    // IA: un combattente paralizzato non agisce (salvo permesso del master); evita gli invisibili; preferisce chi dà vantaggio.
    const orc = mkC({ id: 'o', name: 'Orco', pos: { x: 5, y: 5 } });
    const hero = mkHero({ id: 'h', name: 'Bran', pos: { x: 6, y: 5 } });
    CO().apply(orc, { type: 'paralizzato' });
    ok(/nessuna azione/.test(plan(aiState([orc, hero]), 'o').reason), 'paralizzato: nessuna azione');
    orc.forceActions = true;
    eq(plan(aiState([orc, hero]), 'o').action.targetIds, ['h'], 'permesso del master');
    const orc2 = mkC({ id: 'o', name: 'Orco', pos: { x: 5, y: 5 } });
    const ghost = mkHero({ id: 'g', name: 'Ombra', pos: { x: 6, y: 5 } });
    const other = mkHero({ id: 'v', name: 'Vale', pos: { x: 5, y: 9 } });
    CO().apply(ghost, { type: 'invisibile' });
    eq(plan(aiState([orc2, ghost, other]), 'o').action.targetIds, ['v'], 'l\'invisibile viene evitato');
    eq(plan(aiState([orc2, ghost]), 'o').action.targetIds, ['g'], 'se è l\'unico, lo cerca comunque');
    const down = mkHero({ id: 'd', name: 'Dora', hp: 40, maxHp: 40, ac: 18, pos: { x: 9, y: 9 } });
    const up = mkHero({ id: 'u', name: 'Ugo', hp: 40, maxHp: 40, ac: 18, pos: { x: 9, y: 2 } });
    CO().apply(down, { type: 'prono' });
    eq([IA().weakness(down, orc2, [orc2, down, up], '').terms.advantage, IA().weakness(up, orc2, [orc2, down, up], '').terms.advantage], [1, 0], 'prono: preferito');
    const sly = mkC({ id: 's', name: 'Furbo', pos: { x: 5, y: 5 }, behavior: { temperament: 'furbo' } });
    eq(plan(aiState([sly, down, up]), 's').action.targetIds, ['d'], 'il Furbo sceglie il bersaglio con vantaggio');
  });

  test('Sfinimento 1-6 (cumulativo, PF dimezzati, morte) e immunità alle condizioni', () => {
    const c = mkHero({ id: 'c', name: 'Kael', maxHp: 30, hp: 30 });
    const lvl = (n) => CO().apply(c, { type: 'sfinimento', level: n });
    lvl(1);
    eq([CO().checkMods(c).mode, MV().speedState(c, RULES1, 5).feet, CO().exhaustion(c)], ['svantaggio', 30, 1]);
    lvl(2);
    eq(MV().speedState(c, RULES1, 5).feet, 15, '2: velocità dimezzata');
    lvl(3);
    eq([CO().saveMods(c, 'SAG').mode, CO().attackMods(c, mkC({ id: 'z' }), near).mode], ['svantaggio', 'svantaggio'], '3: attacchi e salvezze');
    lvl(4);
    eq([c.maxHp, c.hp], [15, 15], '4: PF massimi dimezzati');
    lvl(5);
    eq([MV().speedState(c, RULES1, 5).cells, c.maxHp], [0, 15], '5: velocità 0 (i PF restano dimezzati una volta sola)');
    const r6 = lvl(6);
    eq([c.hp, c.dead, /muore/.test(r6.line)], [0, true, true], '6: morte');
    const k = mkHero({ id: 'k', name: 'Lia', maxHp: 20, hp: 20 });
    CO().apply(k, { type: 'sfinimento', level: 4 });
    CO().remove(k, 'sfinimento');
    eq([k.maxHp, CO().exhaustion(k)], [20, 0], 'tolto: PF massimi di prima');
    CO().apply(k, { type: 'sfinimento', level: 2 });
    CO().rest(k, true);
    eq(CO().exhaustion(k), 1, 'il riposo lungo toglie un livello');
    // Immunità dalla scheda della creatura (lo sfinimento lì si chiama «indebolimento»).
    const golem = { id: 'g', name: 'Golem', conditions: [], creature: { conditionImmunities: ['avvelenato', 'indebolimento'] } };
    const r = CO().apply(golem, { type: 'avvelenato' });
    eq([r.ok, /immune/.test(r.line), CO().apply(golem, { type: 'sfinimento' }).ok, CO().apply(golem, { type: 'prono' }).ok, CO().types(golem)], [false, true, false, true, ['prono']]);
  });

  test('Durata: N round, inizio e fine del turno, salvezza ripetuta, 1 minuto, fino al riposo', () => {
    const a = mkHero({ id: 'a', name: 'Aria' });
    const b = mkC({ id: 'b', name: 'Orco' });
    const all = [a, b];
    CO().apply(b, { type: 'prono', duration: { kind: 'round', rounds: 2 } });
    eq(CO().endTurn(all, 'a', seq()), [], 'il turno degli altri non conta');
    CO().endTurn(all, 'b', seq());
    eq(CO().normalizeList(b.conditions)[0].duration.rounds, 1);
    ok(/termina/.test(CO().endTurn(all, 'b', seq())[0]) && !CO().has(b, 'prono'), 'durata finita');
    CO().apply(b, { type: 'spaventato', duration: { kind: 'inizio-turno', who: 'a' } });
    eq([CO().startTurn(all, 'b').length, CO().has(b, 'spaventato')], [0, true]);
    eq([CO().startTurn(all, 'a').length, CO().has(b, 'spaventato')], [1, false], 'fino all\'inizio del turno di Aria');
    CO().apply(b, { type: 'accecato', duration: { kind: 'fine-turno', who: 'a' } });
    CO().endTurn(all, 'a', seq());
    eq(CO().has(b, 'accecato'), false, 'fino alla fine del turno di Aria');
    // Salvezza ripetuta a fine turno: riuscita = la condizione termina; fallimento automatico = nessun tiro.
    CO().apply(b, { type: 'stordito', duration: { kind: 'salvezza', ability: 'SAG', dc: 12 } });
    ok(/fallisce/.test(CO().endTurn(all, 'b', seq(5))[0]) && CO().has(b, 'stordito'), 'fallita: resta');
    ok(/riesce/.test(CO().endTurn(all, 'b', seq(15))[0]) && !CO().has(b, 'stordito'), 'riuscita: termina');
    CO().apply(b, { type: 'paralizzato', duration: { kind: 'salvezza', ability: 'FOR', dc: 12 } });
    ok(/in automatico/.test(CO().endTurn(all, 'b', seq())[0]) && CO().has(b, 'paralizzato'), 'paralizzato su FOR: fallisce senza tirare');
    CO().remove(b, 'paralizzato');
    CO().apply(b, { type: 'avvelenato', duration: { kind: 'minuto' } });
    for (let i = 0; i < 9; i++) CO().endTurn(all, 'b', seq());
    eq(CO().has(b, 'avvelenato'), true, 'dopo 9 round resta');
    CO().endTurn(all, 'b', seq());
    eq(CO().has(b, 'avvelenato'), false, '1 minuto = 10 round');
    CO().apply(b, { type: 'assordato', duration: { kind: 'riposo' } });
    CO().endTurn(all, 'b', seq());
    eq([CO().has(b, 'assordato'), CO().rest(b, false).length, CO().has(b, 'assordato')], [true, 1, false], 'fino al riposo');
    const e = CO().normalizeEntry({ type: 'prono', duration: { kind: 'fine-turno', who: 'a' } });
    eq(CO().durationText(e, (id) => all.find((x) => x.id === id)), 'fino alla fine del turno di Aria');
  });

  test('Concentrazione: CD 10 e metà danno, cambio di incantesimo, 0 PF e incapacitato, effetti collegati e ripristino', () => {
    eq([CO().concentrationDc(5), CO().concentrationDc(22), CO().concentrationDc(41)], [10, 11, 20]);
    const a = mkHero({ id: 'a', name: 'Mira' });
    const b = mkC({ id: 'b', name: 'Orco' });
    const all = [a, b];
    const hold = DnD.dati.normalizeSpell({ id: 'blocca', name: 'Blocca persone', concentration: true });
    const web = DnD.dati.normalizeSpell({ id: 'ragnatela', name: 'Ragnatela', concentration: true });
    CO().startConcentration(a, hold, all, 1);
    const data = CO().inflictData({ type: 'paralizzato', duration: { kind: 'salvezza' }, save: { ability: 'SAG', dc: 14 } }, a, b, hold, []);
    eq([data.spellId, data.duration.kind, data.duration.ability, data.duration.dc, data.duration.who], ['blocca', 'salvezza', 'SAG', 14, 'a']);
    CO().apply(b, data);
    const chk = CO().concentrationCheck(a, 30, seq(9));
    eq([chk.dc, chk.kept], [15, false], 'CD = metà del danno (30 → 15)');
    eq(CO().concentrationCheck(a, 4, seq(10)).kept, true, 'CD minima 10');
    const end = CO().endConcentration(a, all, 'danno');
    eq([a.concentration, CO().has(b, 'paralizzato'), end.undo.removed.length, /Effetti tolti: Orco \(paralizzato\)/.test(end.lines[0])], [null, false, 1, true], 'gli effetti collegati spariscono');
    ok(CO().restoreConcentration(a, all) && a.concentration.spellId === 'blocca' && CO().has(b, 'paralizzato'), 'ripristino del master (annulla)');
    const lines = CO().startConcentration(a, web, all, 2);
    eq([a.concentration.spellId, CO().has(b, 'paralizzato'), /perde la concentrazione su Blocca persone/.test(lines[0])], ['ragnatela', false, true], 'un nuovo incantesimo termina il precedente');
    CO().apply(b, { type: 'trattenuto', source: { id: 'b', name: 'Orco' }, spellId: 'ragnatela' });
    CO().endConcentration(a, all);
    eq(CO().has(b, 'trattenuto'), true, 'solo gli effetti della stessa fonte');
    CO().startConcentration(a, web, all, 3);
    a.hp = 0;
    eq(CO().concentrationBreaker(a), '0 PF');
    a.hp = 10;
    CO().apply(a, { type: 'stordito' });
    eq(CO().concentrationBreaker(a), 'stordito', 'incapacitato');
    CO().remove(a, 'stordito');
    a.concentrationAdv = true;
    eq(CO().concentrationCheck(a, 8, seq(3, 12)).kept, true, 'vantaggio dal tratto');
  });

  test('Tiri contro la morte (giocatori a 0 PF) e nemici che muoiono', () => {
    const p = mkHero({ id: 'p', name: 'Aria', hp: 0, maxHp: 20 });
    const rules = { deathSaves: true, enemiesDie: true };
    ok(/privo di sensi/.test(CO().dropToZero(p, rules)[0]), 'privo di sensi');
    eq([p.deathSaves.active, CO().has(p, 'privo di sensi'), CO().dying(p)], [true, true, true]);
    const e = mkC({ id: 'e', name: 'Orco', initiative: 5 });
    const order = R().sortByInitiative([Object.assign(p, { initiative: 15 }), e]);
    eq([R().firstTurn(order), R().nextTurn(order, 'e', 1)], ['p', { currentId: 'p', round: 2 }], 'chi tira contro la morte ha ancora il turno');
    CO().deathSave(p, seq(12));
    CO().deathSave(p, seq(5));
    eq([p.deathSaves.successes, p.deathSaves.failures], [1, 1]);
    eq(CO().damageAtZero(p, true).length, 1);
    eq([p.deathSaves.failures, p.dead], [3, true], 'un critico a 0 PF vale due fallimenti: morto');
    eq(R().firstTurn(order), 'e', 'il morto è saltato');
    const q = mkHero({ id: 'q', name: 'Bran', hp: 0 });
    CO().dropToZero(q, rules);
    CO().deathSave(q, seq(1));
    eq(q.deathSaves.failures, 2, '1 naturale: due fallimenti');
    const s = mkHero({ id: 's', name: 'Cora', hp: 0 });
    CO().dropToZero(s, rules);
    for (const v of [10, 14, 19]) CO().deathSave(s, seq(v));
    eq([s.deathSaves.stable, CO().dying(s), /stabile/.test(CO().deathSave(Object.assign({}, s, { deathSaves: { active: true, successes: 2, failures: 0 } }), seq(11)).line)], [true, false, true]);
    CO().damageAtZero(s, false);
    eq([s.deathSaves.stable, s.deathSaves.failures, CO().dying(s)], [false, 1, true], 'stabile colpito: ricomincia');
    const r20 = CO().deathSave(s, seq(20));
    eq([s.hp, CO().has(s, 'privo di sensi'), s.deathSaves.active, /20 NATURALE/.test(r20.line)], [1, false, false, true], '20 naturale: torna a 1 PF');
    const orc = mkC({ id: 'o', name: 'Orco', hp: 0 });
    eq([CO().dropToZero(orc, rules)[0], orc.dead], ['✝ Orco muore.', true]);
    const orc2 = mkC({ id: 'o2', name: 'Orco', hp: 0 });
    eq([CO().dropToZero(orc2, { deathSaves: true, enemiesDie: false }), orc2.dead], [[], false], 'opzione: restano a terra come prima');
    const off = mkHero({ id: 'x', name: 'Dan', hp: 0 });
    eq([CO().dropToZero(off, { deathSaves: false, enemiesDie: true }), off.deathSaves.active], [[], false], 'interruttore spento');
    eq([DnD.impostazioni.normalize({}).deathSaves, DnD.impostazioni.normalize({}).enemiesDie, DnD.impostazioni.normalize({ deathSaves: false }).deathSaves], [true, true, false], 'impostazioni: accesi di base');
  });

  test('Condizioni nelle prove dell\'esplorazione: avvelenato con svantaggio, paralizzato fallisce le salvezze di DES', () => {
    const w = exploreWorld();
    w.ex.members.p1.conditions = ['avvelenato'];
    const check = EV().normalizeAction({ kind: 'prova', what: 'Atletica', dc: 12, who: 'scelto', memberId: 'p1' });
    const r = EV().resolveCheck(check, Object.assign(XP().eventCtx(w), { rng: seq(18, 4) }));
    eq([r.results[0].natural, r.results[0].success, r.results[0].note], [4, false, 'svantaggio: avvelenato']);
    w.ex.members.p1.conditions = ['paralizzato'];
    const save = EV().normalizeAction({ kind: 'prova', what: 'DES', save: true, dc: 5, who: 'scelto', memberId: 'p1' });
    const r2 = EV().resolveCheck(save, Object.assign(XP().eventCtx(w), { rng: seq() }));
    eq([r2.results[0].success, r2.results[0].total, /automatico/.test(r2.results[0].note)], [false, null, true], 'nessun tiro');
  });

  test('Condizioni inflitte da azioni e incantesimi, salvataggio, migrazione ed esportazione', () => {
    const mech = DnD.creature.normalizeMech({ kind: 'attacco', inflict: { type: 'prono', save: { ability: 'FOR', dc: 13 } } });
    eq([mech.inflict.type, mech.inflict.save, mech.inflict.duration.who], ['prono', { ability: 'FOR', dc: 13 }, 'fonte']);
    eq(DnD.creature.normalizeMech({ kind: 'salvezza' }).inflict.type, '', 'di base nessuna');
    const sp = DnD.dati.normalizeSpell({ id: 'veleno', name: 'Nube', concentration: true, inflict: { type: 'avvelenato', duration: { kind: 'round', rounds: 3, who: 'bersaglio' } } });
    eq([sp.inflict.type, sp.inflict.duration.rounds, sp.inflict.duration.who], ['avvelenato', 3, 'bersaglio']);
    const src = mkC({ id: 's', name: 'Strega' });
    const tg = mkHero({ id: 't', name: 'Aria' });
    const data = CO().inflictData(sp.inflict, src, tg, sp, []);
    eq([data.source, data.duration.who, data.spellId, data.notes], [{ id: 's', name: 'Strega' }, 't', 'veleno', 'Nube']);
    eq(CO().apply(tg, data).ok, true);
    const cust = CO().normalizeCustom({ id: 'cp-maledetto', name: 'Maledetto', effects: ['ts-svantaggio'] });
    const ci = { type: 'custom', customId: 'cp-maledetto' };
    eq([CO().inflictData(ci, src, tg, null, [cust]).custom.name, CO().inflictData(ci, src, tg, null, []), CO().inflictName(ci, [cust]), CO().inflictName({ type: 'sfinimento', level: 2 })], ['Maledetto', null, 'Maledetto', 'Sfinimento 2'], 'personalizzata eliminata: nulla, senza errori');
    CO().apply(tg, CO().inflictData(ci, src, tg, null, [cust]));
    eq(CO().saveMods(tg, 'SAG').dis, ['maledetto']);
    // Salvataggio: condizioni, concentrazione, tiri contro la morte e ripristino.
    Object.assign(tg, { concentration: { spellId: 'scudo', name: 'Scudo della fede', round: 2 }, concentrationAdv: true, deathSaves: { active: true, successes: 1, failures: 2 }, forceActions: true });
    const back = DnD.dati.normalizeCombatant(JSON.parse(JSON.stringify(tg)));
    eq([CO().types(back), back.conditions[0].duration.rounds, back.concentration, back.concentrationAdv, back.deathSaves, back.forceActions],
      [['avvelenato', 'custom'], 3, { spellId: 'scudo', name: 'Scudo della fede', round: 2 }, true, { active: true, successes: 1, failures: 2, stable: false }, true]);
    // Annulla/ripeti: togliere e rimettere una voce la ripristina identica.
    const removed = CO().remove(back, 'avvelenato');
    CO().restore(back, removed);
    eq(CO().normalizeList(back.conditions).find((x) => x.type === 'avvelenato'), removed);
    // Migrazione: combattimenti e schede senza condizioni (o con le stringhe di prima) restano validi.
    const old = DnD.dati.normalizeCombatant({ name: 'Vecchio', conditions: ['prono', 'rallentato'] });
    eq([old.conditions.map((x) => [x.type, x.duration.kind, x.source.name]), old.concentration, old.dead], [[['prono', 'permanente', 'manuale'], ['rallentato', 'permanente', 'manuale']], null, false]);
    eq(DnD.dati.normalizeCombatant({ name: 'Nuovo' }).conditions, []);
    const st = DnD.dati.emptyState();
    st.customConditions.push(cust);
    const back2 = DnD.dati.importJSON(DnD.dati.exportJSON(st));
    eq([back2.version, back2.customConditions.map((x) => x.name)], [DnD.dati.VERSION, ['Maledetto']], 'archivio');
    const file = JSON.parse(JSON.stringify(S().exportSession(st, S().current(st).id)));
    const dst = DnD.dati.emptyState();
    S().importSession(dst, file, DnD.dadi.uid);
    eq(dst.customConditions.map((x) => x.id), ['cp-maledetto'], 'file di sessione');
    eq(DnD.dati.normalizeState({ version: 12, races: [], npcs: [], players: [] }).customConditions, [], 'v12 → v13');
  });

  // ======================= Riposi e risorse =======================
  const RP = () => DnD.riposi;
  // Personaggio di prova: guerriero di livello 5 (d10), COS 14 (+2), 44 PF.
  const restHero = (o) => DnD.dati.normalizeCreature(Object.assign({ id: 'h', name: 'Mira', classId: 'guerriero', level: 5, maxHp: 44,
    abilities: { FOR: 14, DES: 12, COS: 14, INT: 10, SAG: 10, CAR: 10 } }, o), true);

  test('Riposi: dadi vita dalla classe e dal livello, riposo breve con mod. COS e massimo dei PF', () => {
    const st = DnD.dati.emptyState();
    const p = restHero({ status: { hp: 20 } });
    const s = RP().fromSheet(p, st);
    eq([s.hd.die, s.hd.total, s.hd.used, s.conMod, s.getHp(), s.maxHp], [10, 5, 0, 2, 20, 44]);
    const r = RP().shortRest(s, { rolls: [6, 9] });
    eq([r.healed, r.spent, s.getHp(), p.status.hitDiceUsed, r.restored], [19, 2, 39, 2, []], '(6+2) + (9+2)');
    const r2 = RP().shortRest(s, { rolls: [10, 10, 10, 10] });
    eq([r2.spent, s.getHp(), p.status.hp, p.status.hitDiceUsed], [3, 44, null, 5], 'non oltre il massimo; solo i dadi rimasti');
    eq(RP().rollHitDice(s, 3, seq()).length, 0, 'nessun dado vita rimasto');
    const weak = RP().fromSheet(restHero({ id: 'w', classId: 'mago', level: 3, maxHp: 14, abilities: { FOR: 8, DES: 14, COS: 8, INT: 16, SAG: 10, CAR: 10 }, status: { hp: 5 } }), st);
    eq([weak.hd.die, weak.conMod, RP().shortRest(weak, { rolls: [1] }).healed], [6, -1, 0], 'mago d6, COS 8: minimo 0');
    eq(RP().rollHitDice(weak, 2, seq(4, 2)), [4, 2], 'tiri in anticipo per l\'anteprima');
    ok(/Riposo breve: Mira recupera 19 PF, spende 2 dadi vita \[6, 9\]/.test(RP().summaryText(r)), RP().summaryText(r));
  });

  test('Riposi: riposo lungo (PF, metà dei dadi vita con minimo 1, PF temporanei, sfinimento) ed eroico', () => {
    const st = DnD.dati.emptyState();
    const p = restHero({ status: { hp: 10, tempHp: 7, hitDiceUsed: 5, exhaustion: 2 } });
    const s = RP().fromSheet(p, st);
    const r = RP().longRest(s, {});
    eq([s.getHp(), p.status.tempHp, p.status.hitDiceUsed, p.status.exhaustion, r.healed, r.regained, r.exhaustion], [44, 0, 3, 1, 34, 2, -1], 'livello 5: +2 dadi vita');
    ok(/Riposo lungo: Mira recupera 34 PF, 2 dadi vita, sfinimento -1/.test(RP().summaryText(r)), RP().summaryText(r));
    const one = restHero({ id: 'u', level: 1, status: { hitDiceUsed: 1 } });
    RP().longRest(RP().fromSheet(one, st), {});
    eq(one.status.hitDiceUsed, 0, 'livello 1: almeno 1 dado vita');
    const hero = restHero({ id: 'e', status: { hitDiceUsed: 5 } });
    RP().longRest(RP().fromSheet(hero, st), { opts: { heroic: true } });
    eq(hero.status.hitDiceUsed, 0, 'eroico: tutti i dadi vita');
    const hungry = restHero({ id: 'f', status: { exhaustion: 2 } });
    RP().longRest(RP().fromSheet(hungry, st), { suppliesOk: false });
    eq(hungry.status.exhaustion, 2, 'senza cibo e acqua lo sfinimento non scende');
  });

  test('Riposi: slot e risorse per tipo di riposo (breve, lungo, alba, mai, manuale) e Warlock', () => {
    const st = DnD.dati.emptyState();
    const cust = [['Ispirazione', 'breve'], ['Furia', 'lungo'], ['Benedizione', 'alba'], ['Reliquia', 'mai'], ['Segno', 'manuale']].map(([label, reset]) => ({ id: 'r-' + reset, label, max: 2, value: 0, reset }));
    const wiz = restHero({ id: 'm', classId: 'mago', level: 3, maxHp: 16, spellcasting: { slotsUsed: [3, 2, 0, 0, 0, 0, 0, 0, 0] }, status: { resources: cust } });
    const s = RP().fromSheet(wiz, st);
    eq(RP().resources(s).filter((r) => r.kind === 'slot').map((r) => [r.label, r.value, r.max, r.reset]), [['Slot 1° livello', 1, 4, 'lungo'], ['Slot 2° livello', 0, 2, 'lungo']]);
    const val = () => wiz.status.resources.map((r) => r.value);
    const short = RP().shortRest(s, { rolls: [] });
    eq([wiz.spellcasting.slotsUsed.slice(0, 2), val(), short.restored], [[3, 2], [2, 0, 0, 0, 0], ['Ispirazione']], 'breve: solo le «riposo breve»');
    eq([RP().dawn(s), val()], [['Benedizione'], [2, 0, 2, 0, 0]], 'all\'alba');
    wiz.status.resources[2].value = 0;
    const long = RP().longRest(s, {});
    eq([wiz.spellcasting.slotsUsed.slice(0, 2), val(), long.slotsAll], [[0, 0], [2, 2, 2, 0, 0], true], 'lungo: slot, lungo e alba; mai e manuale restano');
    ok(/tutti gli slot/.test(RP().summaryText(long)), RP().summaryText(long));
    // Warlock: la magia del patto torna con il riposo breve.
    const wl = restHero({ id: 'k', classId: 'warlock', level: 3, maxHp: 20, spellcasting: { slotsUsed: [0, 2, 0, 0, 0, 0, 0, 0, 0] } });
    const ws = RP().fromSheet(wl, st);
    eq(RP().resources(ws).filter((r) => r.kind === 'slot').map((r) => [r.max, r.reset]), [[2, 'breve']]);
    RP().shortRest(ws, { rolls: [] });
    eq(wl.spellcasting.slotsUsed[1], 0, 'riposo breve del Warlock');
    // − e +: limiti e PF temporanei senza massimo.
    eq([RP().adjust(s, 'cust-r-mai', 5), RP().adjust(s, 'cust-r-mai', -9), RP().adjust(s, 'pf-temp', 3), RP().adjust(s, 'dadi-vita', -1), wiz.status.hitDiceUsed, RP().adjust(s, 'boh', 1)], [2, 0, 3, 2, 1, null]);
  });

  test('Riposi: regola delle 24 ore, riposo interrotto, varianti gritty, ripristina tutto', () => {
    const st = DnD.dati.emptyState();
    const p = restHero({ status: { hp: 4, resources: [{ id: 'r-b', label: 'Breve', max: 1, value: 0, reset: 'breve' }] } });
    const s = RP().fromSheet(p, st);
    eq(RP().canLongRest(s, 5), { ok: true, wait: 0 }, 'mai riposato');
    s.markLongRest(10);
    eq([RP().canLongRest(s, 20), RP().canLongRest(s, 34).ok], [{ ok: false, wait: 14 }, true]);
    const none = RP().longRest(s, { interruptedAfter: 0.5 });
    eq([none.interrupted, none.restored, s.getHp()], [true, [], 4], 'interrotto subito: nessun beneficio');
    const part = RP().longRest(s, { interruptedAfter: 2 });
    eq([part.restored, s.getHp(), p.status.resources[0].value], [['Breve'], 4, 1], 'dopo almeno 1 ora: i benefici del riposo breve, non quelli del lungo');
    ok(/interrotto dopo 2 ore/.test(RP().summaryText(part)));
    eq([RP().hoursOf('breve', {}), RP().hoursOf('lungo', {}), RP().hoursOf('breve', { gritty8: true }), RP().hoursOf('lungo', { gritty7: true })], [1, 8, 8, 168]);
    eq([DnD.impostazioni.normalize({}).restHeroic, DnD.impostazioni.normalize({ restLong7: true }).restLong7], [false, true], 'opzioni del master spente di base');
    Object.assign(p.status, { hitDiceUsed: 3, tempHp: 4, exhaustion: 3 });
    RP().restoreAll(RP().fromSheet(p, st));
    eq([p.status.hp, p.status.hitDiceUsed, p.status.tempHp, p.status.exhaustion], [null, 0, 0, 0], 'ripristina tutto (master)');
  });

  test('Riposi nell\'esplorazione: tempo e scorte, 24 ore, incontro che interrompe, guardie, alba, evento Riposo', () => {
    const w = exploreWorld();
    const p1 = w.st.players[0];
    p1.abilities.COS = 14;
    w.ex.members.p1.hp = 5;
    const food = w.ex.supplies.food;
    const t0 = w.ex.time.total;
    const r = XP().rest(w, 'lungo', { guards: ['p1', 'p2'] });
    eq([r.ok, r.hours, r.interrupted, w.ex.time.total - t0, w.ex.members.p1.hp, p1.status.lastLongRest], [true, 8, null, 8, 20, w.ex.time.total]);
    ok(w.ex.supplies.food < food, 'scorte consumate');
    ok(w.ex.log.some((l) => /Turni di guardia: Aria 0h–4h, Brun 4h–8h/.test(l.text)) && w.ex.log.some((l) => /Riposo lungo: Aria recupera 15 PF/.test(l.text)), 'guardie e riepilogo nel registro');
    const again = XP().rest(w, 'lungo', {});
    ok(!again.ok && /24 ore/.test(again.reason), again.reason);
    w.ex.members.p1.hp = 10;
    const sh = XP().rest(w, 'breve', { rolls: { p1: [5] } });
    eq([sh.ok, w.ex.members.p1.hp, w.ex.time.total - t0], [true, 17, 9], 'riposo breve: 5 + 2 COS, 1 ora');
    // Incontro notturno: il riposo si ferma alla prima ora e non dà i benefici del riposo lungo.
    const plain = w.st.biomes.find((b) => b.id === 'bioma-pianura');
    Object.assign(plain, { encounterChance: 100, encounterPer: 'ora', encounters: [BI().normalizeBiome({ encounters: [{ kind: 'creatura', refId: w.st.npcs[0].id, qty: '1', weight: 1 }] }).encounters[0]] });
    w.ex.members.p1.hp = 3;
    const cut = XP().rest(w, 'lungo', { force: true, guards: ['p2'] });
    eq([cut.interrupted, cut.hours, w.ex.members.p1.hp, cut.results[0].interrupted], ['incontro', 1, 3, true]);
    ok(w.ex.queue.some((q) => q.kind === 'incontro') && w.ex.log.some((l) => /interrotto da un incontro dopo 1h: era di guardia Brun/.test(l.text)), 'incontro in coda');
    plain.encounterChance = 0;
    w.ex.queue = [];
    // Senza scorte: lo sfinimento sale invece di scendere.
    w.ex.supplies.food = 0;
    w.ex.members.p1.exhaustion = 1;
    XP().rest(w, 'lungo', { force: true });
    eq(w.ex.members.p1.exhaustion, 2, 'senza cibo: +1 sfinimento');
    // Alba: le risorse «all'alba» tornano quando il tempo attraversa le 6.
    w.ex.time.hour = 4;
    p1.status.resources = [RP().normalizeResource({ id: 'r-a', label: 'Preghiera', max: 1, value: 0, reset: 'alba' })];
    XP().advanceTime(w, 3);
    eq(p1.status.resources[0].value, 1);
    ok(w.ex.log.some((l) => /Alba: Aria recupera Preghiera/.test(l.text)));
    // L'azione «Riposo» degli eventi usa lo stesso riposo.
    w.ex.supplies.food = 20;
    w.ex.members.p2.hp = 1;
    XP().fireEvent(w, { event: EV().normalizeEvent({ id: 'campo', name: 'Accampamento', actions: [{ kind: 'riposo', long: true }] }) }, {});
    eq(w.ex.members.p2.hp, 20, 'evento: riposo lungo');
  });

  test('Riposi nel combattimento: stato dalla scheda e ritorno, PF temporanei, riposo di un nemico', () => {
    const st = DnD.dati.emptyState();
    const p = restHero({ status: { hp: 12, tempHp: 5, hitDiceUsed: 1, exhaustion: 2, resources: [{ id: 'r1', label: 'Furia', max: 3, value: 1, reset: 'lungo' }] } });
    const [x] = DnD.combattenti.createCombatants([p], [], st.races, () => 10);
    eq([x.hp, x.tempHp, x.hitDice, DnD.condizioni.exhaustion(x), x.resources[0].value], [12, 5, { die: 10, total: 5, used: 1 }, 2, 1], 'dalla scheda');
    eq([RP().absorbTemp(x, 8), x.tempHp], [{ rest: 3, absorbed: 5 }, 0], 'i PF temporanei assorbono per primi');
    Object.assign(x, { hp: 7 });
    x.hitDice.used = 3;
    DnD.condizioni.apply(x, { type: 'sfinimento', level: 3 });
    RP().syncBack(x, p);
    eq([p.status.hp, p.status.tempHp, p.status.hitDiceUsed, p.status.exhaustion], [7, 0, 3, 3], 'tornano sulla scheda');
    x.hp = x.maxHp;
    eq(RP().syncBack(x, p).status.hp, null, 'al massimo = null');
    // Nemico (creatura): usi giornalieri, per riposo, ricarica, azioni e Resistenza leggendarie.
    const m = DnD.creature.normalizeMonster({ name: 'Drago', size: 'Grande', hitDice: 8, legendaryPoints: 3, legendaryResistance: 2,
      actions: [{ id: 'soffio', name: 'Soffio', freq: { kind: 'ricarica', recharge: 5 }, mech: { kind: 'testo' } }, { id: 'urlo', name: 'Urlo', freq: { kind: 'giorno', uses: 2 }, mech: { kind: 'testo' } },
        { id: 'scaglie', name: 'Scaglie', freq: { kind: 'riposo-breve' }, mech: { kind: 'testo' } }],
      legendary: [{ id: 'coda', name: 'Coda', mech: { kind: 'testo' } }] });
    m.type = 'creatura';
    const d = RP().seedCombatant(DnD.creature.toCombatant(m, 'Drago', 0, () => 10, []), m);
    eq(d.hitDice, { die: 10, total: 8, used: 0 }, 'dadi vita della creatura (Grande = d10)');
    Object.assign(d.creature, { uses: { urlo: 0, scaglie: 0 }, recharge: { soffio: false } });
    d.creature.legendaryPoints.left = 0;
    d.creature.legendaryResistance.left = 0;
    d.hp = 10;
    const ds = RP().fromCombatant(d);
    RP().shortRest(ds, { rolls: [10] });
    eq([d.creature.uses.scaglie, d.creature.uses.urlo, d.creature.recharge.soffio, d.creature.legendaryPoints.left, d.creature.legendaryResistance.left, d.hitDice.used, d.hp], [1, 0, true, 3, 0, 1, 20], 'breve');
    DnD.condizioni.apply(d, { type: 'avvelenato', duration: { kind: 'riposo' } });
    d.deathSaves = { active: true, successes: 1, failures: 1 };
    RP().longRest(ds, {});
    eq([d.creature.uses.urlo, d.creature.legendaryResistance.left, d.hp, DnD.condizioni.has(d, 'avvelenato'), d.deathSaves.active], [2, 2, d.maxHp, false, false], 'lungo: usi, resistenza, «fino al riposo», tiri contro la morte');
    ok(RP().resources(ds).some((r) => r.id === 'leggendarie') && RP().resources(ds).some((r) => r.id === 'uso-urlo'), 'nell\'elenco «Risorse»');
  });

  test('Riposi: dati nuovi, migrazione v13 → v14, salvataggio ed esportazione', () => {
    const old = DnD.dati.normalizeCreature({ name: 'Vecchio', level: 4, classId: 'ladro' }, true);
    eq(old.status, { hp: null, tempHp: 0, hitDiceUsed: 0, exhaustion: 0, lastLongRest: null, resources: [] }, 'valori predefiniti');
    eq(RP().fromSheet(old, DnD.dati.emptyState()).hd, RP().fromSheet(old, DnD.dati.emptyState()).hd);
    eq([RP().fromSheet(old, DnD.dati.emptyState()).hd.die, RP().fromSheet(old, DnD.dati.emptyState()).hd.total], [8, 4], 'dadi vita dal livello');
    const mon = DnD.dati.normalizeCreature({ name: 'Lupo', type: 'creatura' }, false);
    eq(mon.status.hp, null, 'anche le creature');
    const mig = DnD.dati.normalizeState({ version: 13, races: [], npcs: [], players: [{ id: 'z', name: 'Zed', level: 3 }] });
    eq([mig.version, mig.players[0].status.hitDiceUsed, S().current(mig).restClock], [DnD.dati.VERSION, 0, 0]);
    const st = DnD.dati.emptyState();
    st.players.push(Object.assign(restHero({ status: { hp: 9, tempHp: 2, hitDiceUsed: 2, lastLongRest: 30, resources: [{ id: 'r1', label: 'Furia', max: 3, value: 1, reset: 'lungo' }] } }), { sessionId: S().current(st).id }));
    S().current(st).restClock = 40;
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(st));
    eq([back.players[0].status, S().current(back).restClock], [st.players[0].status, 40], 'archivio');
    const file = JSON.parse(JSON.stringify(S().exportSession(st, S().current(st).id)));
    const dst = DnD.dati.emptyState();
    S().importSession(dst, file, DnD.dadi.uid);
    eq(dst.players.find((x) => x.name === 'Mira').status.hitDiceUsed, 2, 'file di sessione');
    const c = DnD.dati.normalizeCombatant({ name: 'X', tempHp: 4, hitDice: { die: 10, total: 5, used: 2 }, resources: [{ label: 'Furia', max: 2, value: 1 }], lastLongRest: 8 });
    eq([c.tempHp, c.hitDice, c.resources[0].value, c.lastLongRest], [4, { die: 10, total: 5, used: 2 }, 1, 8], 'combattente');
    eq(DnD.dati.normalizeCombatant({ name: 'Y' }).tempHp, 0, 'combattimenti salvati prima');
  });

  // --- Difficoltà degli incontri (difficolta.js) ---
  const DF = () => DnD.difficolta;
  const lv = (...levels) => levels.map((l, i) => ({ id: 'p' + i, name: 'P' + i, level: l }));
  const th4 = (r) => [r.facile, r.medio, r.difficile, r.mortale];

  test('Difficoltà: soglie del party per livelli diversi', () => {
    eq(th4(DF().partyThresholds([1, 1, 1, 1])), [100, 200, 300, 400], 'quattro di 1° livello');
    eq(th4(DF().partyThresholds([5, 3])), [325, 650, 975, 1500], '5° + 3°');
    eq(th4(DF().partyThresholds([20])), [2800, 5700, 8500, 12700], '20°');
    eq(th4(DF().partyThresholds([11, 12, 13])), [2900, 5800, 8800, 13200], '11° + 12° + 13°');
    eq([th4(DF().partyThresholds([])), DF().partyThresholds([]).size], [[0, 0, 0, 0], 0], 'party vuoto');
  });

  test('Difficoltà: moltiplicatori per numero di creature, party piccolo e grande', () => {
    const f = (n, size) => DF().multiplier(n, size).factor;
    eq([1, 2, 3, 6, 7, 10, 11, 14, 15, 30].map((n) => f(n, 4)), [1, 1.5, 2, 2, 2.5, 2.5, 3, 3, 4, 4], 'party di 4');
    eq([1, 2, 3, 7, 15].map((n) => f(n, 2)), [1.5, 2, 2.5, 3, 5], 'party di 2: un gradino su (oltre ×4 = ×5)');
    eq([1, 2, 3, 15].map((n) => f(n, 6)), [0.5, 1, 1.5, 3], 'party di 6: un gradino giù (sotto ×1 = ×0,5)');
    eq([f(1, 3), f(1, 5)], [1, 1], '3 e 5 giocatori: nessuna correzione');
    eq([f(0, 4), DF().multiplier(2, 2).shift, DF().multiplier(2, 7).shift], [0, 1, -1]);
  });

  test('Difficoltà: PE grezzi e modificati con CS frazionari, ricompensa', () => {
    const r = DF().evaluate({ party: lv(1, 1, 1, 1), creatures: [{ cr: '1/8', count: 1 }, { cr: '1/4', count: 2 }, { cr: '1/2', count: 1 }] });
    eq([r.rawXp, r.count, r.multiplier, r.adjustedXp, r.band, r.rewardXp, r.perPlayerXp], [225, 4, 2, 450, 'mortale', 225, 56]);
    const z = DF().evaluate({ party: lv(1), creatures: [{ cr: '0', count: 3 }, { cr: '1/4', count: 0 }] });
    eq([z.rawXp, z.count, z.groups.length, z.multiplier], [30, 3, 1, 2.5], 'CS 0 e gruppi vuoti');
    ok(DF().detailText(r).includes('Moltiplicatore ×2') && DF().detailText(r).includes('56 a testa'), 'dettaglio del calcolo');
    eq(DF().evaluate({ party: [], creatures: [{ cr: '1', count: 1 }] }).band, null, 'senza party nessuna fascia');
    eq(DF().evaluate({ party: lv(3), creatures: [] }).warnings, [DnD.difficoltaDati.WARNINGS.noCreatures]);
  });

  test('Difficoltà: fasce al confine (soglia inclusa, «oltre» solo sopra il doppio del mortale)', () => {
    const th = DF().partyThresholds([1, 1, 1, 1]);
    const cases = { 0: 'banale', 99: 'banale', 100: 'facile', 199: 'facile', 200: 'medio', 299: 'medio', 300: 'difficile', 399: 'difficile', 400: 'mortale', 800: 'mortale', 801: 'oltre' };
    for (const [xp, band] of Object.entries(cases)) eq(DF().classify(Number(xp), th), band, xp + ' PE');
    const s = DF().scale(DF().evaluate({ party: lv(1, 1, 1, 1), creatures: [{ cr: '1/4', count: 3 }] }));
    eq([s.max, s.segments.map((x) => x.band), Math.round(s.marker)], [800, ['banale', 'facile', 'medio', 'difficile', 'mortale'], 38], 'barra: fasce e segnaposto');
  });

  test('Difficoltà: CS di nemici standard, creature e boss (CS effettivo)', () => {
    const std = DnD.dati.normalizeCreature({ name: 'Bandito', level: 7 }, false);
    eq([std.crOverride, DF().crOf(std)], ['', '3'], 'standard: livello / 2');
    eq([DF().standardCr(1), DF().standardCr(2), DF().standardCr(30)], ['0', '1', '15'], 'per difetto, minimo 0');
    eq(DF().crOf(DnD.dati.normalizeCreature({ name: 'Capo', level: 7, crOverride: '1/2' }, false)), '1/2', 'CS scritto sulla scheda');
    eq(DnD.dati.normalizeCreature({ name: 'X', crOverride: '99' }, false).crOverride, '', 'CS non valido');
    ok(!('crOverride' in DnD.dati.normalizeCreature({ name: 'Eroe', level: 4 }, true)), 'non sui giocatori');
    eq(DF().crOf(DnD.dati.normalizeCreature({ name: 'Lupo', type: 'creatura', cr: '1/4' }, false)), '1/4');
    const boss = DnD.dati.normalizeCreature({ name: 'Re', type: 'boss', cr: '5', boss: { effectiveCr: '8' } }, false);
    eq([boss.boss.effectiveCr, DF().crOf(boss)], ['8', '8'], 'boss: CS effettivo');
    eq(DF().crOf(DnD.dati.normalizeCreature({ name: 'Re', type: 'boss', cr: '5' }, false)), '5', 'vuoto = quello della scheda');
    const r = DF().evaluate({ party: lv(5, 5, 5, 5), creatures: [DF().group(boss, 1)] });
    eq([r.rawXp, r.band], [3900, 'difficile'], 'PE dal CS effettivo');
    ok(r.warnings.includes(DnD.difficoltaDati.WARNINGS.boss), 'avviso «incontro in fasi»');
    ok(DF().evaluate({ party: lv(1, 1), creatures: [{ cr: '5', count: 1 }] }).warnings.includes(DnD.difficoltaDati.WARNINGS.single), 'un solo mostro molto forte');
    eq(DnD.boss.promote(DnD.dati.normalizeCreature({ name: 'Capo', level: 9, crOverride: '4' }, false), {}).cr, '4', 'promozione a boss con il CS della scheda');
  });

  test('Difficoltà: NPC neutrali, alleati e fazioni non ostili esclusi', () => {
    const t = FZ().table(FZ().builtinFactions('s'));
    const c = (x, rules) => DF().counts(x, t, 'giocatori', rules);
    eq([c({ id: 'a', faction: 'nemici' }), c({ id: 'b', faction: 'neutrali' }), c({ id: 'c', faction: 'giocatori' })], [true, false, false], 'per fazione');
    const npc = (attitude, extra) => Object.assign({ id: 'n', faction: 'neutrali', npc: { attitude, defend: 'se' } }, extra);
    eq([c(npc('indifferente')), c(npc('indifferente', { hostileTo: ['giocatori'] }))], [false, true], 'NPC: solo se ostile (anche personale)');
    const opt = { countNeutralNpcs: true };
    eq([c(npc('indifferente'), opt), c(npc('amichevole'), opt), c(npc('indifferente', { faction: 'giocatori' }), opt), c({ id: 'z', faction: 'neutrali' }, opt)],
      [true, false, false, false], 'opzione: i neutrali che possono diventare ostili, mai amichevoli e alleati (né i non NPC)');
  });

  test('Difficoltà: leggendari (livello 21-40) e tabelle personalizzate', () => {
    const W = DnD.difficoltaDati.WARNINGS;
    const leg = DF().evaluate({ party: lv(20, 30), creatures: [{ cr: '20', count: 1 }] });
    eq([th4(leg.thresholds), leg.thresholds.legendary], [[5600, 11400, 17000, 25400], 'riga20'], 'riga del 20');
    ok(leg.warnings.includes(W.legendary), 'avviso');
    const manual = { legendary: { 30: [3000, 6000, 9000, 14000], 15: [1, 2, 3, 4] } };
    const m = DF().evaluate({ party: lv(20, 30), creatures: [{ cr: '20', count: 1 }] }, manual);
    eq([th4(m.thresholds), m.thresholds.legendary, Object.keys(DF().normalizeRules(manual).legendary)], [[5800, 11700, 17500, 26700], 'manuale', ['30']], 'soglie a mano (solo 21-40)');
    const custom = { custom: true, thresholds: [[10, 20, 30, 40]], multipliers: [{ min: 1, factor: 1 }, { min: 2, factor: 3 }] };
    const enc = { party: lv(1, 1, 1, 1), creatures: [{ cr: '0', count: 2 }] };
    eq([DF().evaluate(enc).band, DF().evaluate(enc).adjustedXp], ['banale', 30], 'Guida');
    const cr = DF().evaluate(enc, custom);
    eq([th4(cr.thresholds), cr.adjustedXp, cr.band], [[40, 80, 120, 160], 60, 'facile'], 'tabella personalizzata');
    eq(th4(DF().evaluate(enc, Object.assign({}, custom, { custom: false })).thresholds), [100, 200, 300, 400], 'spenta: tabelle della Guida');
    eq(DF().evaluate({ party: lv(1), creatures: [{ cr: '0', count: 2 }] }, custom).multiplier, 5, 'party piccolo oltre l\'ultima riga');
    eq(DF().normalizeRules({ multipliers: [{ min: 2, factor: 9 }] }).multipliers, DnD.difficoltaDati.MULTIPLIERS, 'senza la riga per 1 creatura: quelle della Guida');
    eq(DF().normalizeRules({ thresholds: [['x', 5]] }).thresholds[0], [25, 5, 75, 100], 'valori non validi: della Guida');
  });

  test('Difficoltà: «Bilancia» e budget per CS', () => {
    const party = lv(1, 1, 1, 1);
    const one = { party, creatures: [{ id: 'g', name: 'Goblin', cr: '1/4', count: 1 }] };
    const pick = (target) => DF().balance(one, target)[0];
    eq([pick('difficile').to, pick('difficile').result.band, pick('difficile').result.adjustedXp], [3, 'difficile', 300], 'difficile: 3 goblin');
    eq([pick('mortale').to, pick('medio').to, pick('facile').to], [4, null, 2], 'mortale 4, medio impossibile, facile 2');
    eq(one.creatures[0].count, 1, 'nessuna modifica senza conferma');
    const mixed = { party, creatures: [{ id: 'n', name: 'NPC', cr: '1/2', count: 1, fixed: true }, { id: 'g', name: 'Goblin', cr: '1/4', count: 0 }] };
    const props = DF().balance(mixed, 'medio');
    eq([props.length, props[0].index, props[0].to, DF().balance(mixed, 'difficile')[0].to], [1, 1, 1, null], 'i gruppi fissi contano ma non si propongono');
    eq(DF().balance({ party, creatures: [{ id: 'g', cr: '1/4', count: 3 }] }, 'difficile')[0].to, 3, 'già nella fascia');
    eq(DF().budget('1/4', party), { medio: { count: 3, band: 'difficile' }, difficile: { count: 3, band: 'difficile' }, mortale: { count: 4, band: 'mortale' } }, 'budget CS 1/4');
    eq(DF().budget('5', party).medio, { count: 1, band: 'oltre' }, 'già uno basta');
    eq(DF().budget('1', lv(5, 5, 5, 5)), { medio: { count: 5, band: 'medio' }, difficile: { count: 7, band: 'difficile' }, mortale: { count: 9, band: 'mortale' } }, 'budget CS 1 a 5° livello');
  });

  test('Difficoltà: dati v15, migrazione, esportazione e importazione', () => {
    const mig = DnD.dati.normalizeState({ version: 14, races: [], npcs: [{ id: 'b', name: 'Bandito', level: 6 }, { id: 'r', name: 'Re', type: 'boss', cr: '4' }], players: [] });
    eq([mig.version, mig.npcs[0].crOverride, mig.npcs[1].boss.effectiveCr, mig.difficultyRules], [DnD.dati.VERSION, '', '', DF().defaultRules()], 'v14 → v15');
    eq(DnD.dati.emptyState().difficultyRules, DF().defaultRules(), 'archivio nuovo');
    const st = DnD.dati.emptyState();
    const sid = S().current(st).id;
    st.npcs.push(DnD.dati.normalizeCreature({ id: 'cap', name: 'Capitano', level: 8, crOverride: '6', sessionId: sid }, false));
    st.npcs.push(DnD.dati.normalizeCreature({ id: 'rex', name: 'Rex', type: 'boss', cr: '5', boss: { effectiveCr: '7' }, sessionId: sid }, false));
    st.difficultyRules = DF().normalizeRules({ custom: true, thresholds: [[10, 20, 30, 40]], legendary: { 25: [1, 2, 3, 4] }, countNeutralNpcs: true });
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(st));
    eq([back.npcs.find((x) => x.id === 'cap').crOverride, back.npcs.find((x) => x.id === 'rex').boss.effectiveCr, back.difficultyRules], ['6', '7', st.difficultyRules], 'archivio');
    const dst = DnD.dati.emptyState();
    S().importSession(dst, JSON.parse(JSON.stringify(S().exportSession(st, sid))), DnD.dadi.uid);
    eq([dst.npcs.find((x) => x.name === 'Capitano').crOverride, dst.npcs.find((x) => x.name === 'Rex').boss.effectiveCr], ['6', '7'], 'file di sessione');
  });

  test('Difficoltà UI: l\'indicatore del setup si aggiorna mentre cambiano nemici e giocatori', async () => {
    const mem = new Map();
    const backend = { name: 'memoria', get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, clear: async () => mem.clear() };
    const prevStore = DnD.store;
    DnD.store = await DnD.dati.openStore({ getItem: () => null, setItem() {}, removeItem() {} }, { backend });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:900px;overflow:hidden;z-index:-1';
    document.body.append(box);
    try {
      DnD.store.update((s) => {
        const sid = S().current(s).id;
        s.npcs = [DnD.dati.normalizeCreature({ id: 'gob', name: 'Goblin', type: 'creatura', cr: '1/4', sessionId: sid }, false)];
        s.players = [1, 2, 3, 4].map((i) => DnD.dati.normalizeCreature({ id: 'h' + i, name: 'Eroe ' + i, level: 1, sessionId: sid }, true));
        s.parties = [];
      });
      DnD.sezioni.combattimento.render(box);
      const badge = () => box.querySelector('.diff-indicator .diff-badge').textContent;
      const meter = () => box.querySelector('.diff-bar');
      eq(badge(), '—', 'nessun nemico');
      const qty = box.querySelector('input[aria-label="Quantità di Goblin"]');
      qty.value = '3';
      qty.dispatchEvent(new Event('input'));
      eq([badge(), meter().getAttribute('aria-valuenow'), meter().getAttribute('aria-valuetext')], ['Difficile', '300', 'Difficile, 300 PE modificati'], '3 goblin, 4 eroi');
      const checks = box.querySelectorAll('.pick-list input[type="checkbox"]');
      checks[0].checked = true;
      checks[0].dispatchEvent(new Event('change'));
      eq(badge(), 'Oltre il mortale', 'solo un giocatore scelto');
      const faction = box.querySelectorAll('select[aria-label="Fazione"]')[4];
      faction.value = 'neutrali';
      faction.dispatchEvent(new Event('change'));
      eq(badge(), '—', 'nemico neutrale: non conta');
      ok(box.querySelector('.diff-bar').getAttribute('aria-label') === 'Difficoltà dell\'incontro', 'aria-label in italiano');
    } finally {
      box.remove();
      DnD.store = prevStore;
    }
  });

  // --- Scene e incontri (scene.js) ---
  const SC = () => DnD.scene;
  const CINGHIALE = 'esempio-cinghiale-paludi';
  // Archivio con 4 giocatori di 1° livello, una griglia di battaglia con le zone e tre scene collegate.
  function sceneWorld() {
    const st = DnD.dati.emptyState();
    const sid = S().current(st).id;
    st.players = [1, 2, 3, 4].map((i) => DnD.dati.normalizeCreature({ id: 'h' + i, name: 'Eroe ' + i, level: 1, maxHp: 10, sessionId: sid }, true));
    st.savedGrids.push(DnD.dati.normalizeSavedGrid({ id: 'g1', name: 'Radura', w: 12, h: 8, kind: 'battaglia', sessionId: sid,
      zones: [{ kind: 'giocatori', x: 0, y: 0, w: 2, h: 4 }, { kind: 'nemici', x: 9, y: 0, w: 3, h: 8 }] }));
    const enc = SC().normalizeEncounter({ id: 'enc', name: 'Cinghiali', creatures: [{ id: 'r1', ref: { kind: 'npc', id: CINGHIALE }, qty: 3, start: { kind: 'celle', cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }] } }],
      end: [{ kind: 'vittoria' }, { kind: 'round', rounds: 3 }], rewards: { coins: { mo: 1 } } });
    const mk = (id, title, order, extra) => SC().normalizeScene(Object.assign({ id, title, order, sessionId: sid }, extra));
    st.scenes = [
      mk('a', 'Il guado', 0, { kind: 'combattimento', map: { gridId: 'g1' }, encounters: [enc], tags: ['palude'],
        links: [{ outcome: 'vittoria', sceneId: 'b' }, { outcome: 'fuga', sceneId: 'c' }, { outcome: 'sempre', sceneId: 'b' }] }),
      mk('b', 'Il villaggio', 1, { kind: 'sociale' }),
      mk('c', 'La fuga nel bosco', 2, { kind: 'esplorazione' }),
    ];
    return { st, sid, enc: st.scenes[0].encounters[0], scene: st.scenes[0] };
  }

  test('Scene: creazione, riordino, filtri e duplicazione', () => {
    const w = sceneWorld();
    eq(SC().sessionScenes(w.st, w.sid).map((s) => s.id), ['a', 'b', 'c'], 'scaletta in ordine');
    SC().move(w.st.scenes, 'c', 0);
    eq([SC().sessionScenes(w.st, w.sid).map((s) => s.id), w.st.scenes.map((s) => s.order)], [['c', 'a', 'b'], [1, 2, 0]], 'riordino');
    eq(SC().filter(w.st.scenes, { kind: 'sociale' }).map((s) => s.id), ['b'], 'per tipo');
    eq(SC().filter(w.st.scenes, { text: 'palude' }).map((s) => s.id), ['a'], 'per tag');
    eq(SC().filter(w.st.scenes, { status: 'conclusa' }).length, 0, 'per stato');
    w.scene.history.push({ at: new Date().toISOString(), text: 'x' });
    w.scene.status = 'conclusa';
    const d = SC().duplicate(w.scene, 3);
    eq([d.id !== 'a', d.title, d.status, d.history.length, d.order, d.encounters[0].id !== 'enc', d.encounters[0].run, d.links.length], [true, 'Il guado (copia)', 'da-fare', 0, 3, true, null, 3]);
    eq(SC().normalizeScene({}).status, 'da-fare', 'scena nuova: da fare');
    eq(SC().neighbors(w.st.scenes, 'a').prev.id, 'c', 'precedente in scaletta');
  });

  test('Scene: collegamenti con più esiti, vista a linea e conclusione', () => {
    const w = sceneWorld();
    eq(SC().linksFor(w.scene, 'fuga').map((l) => l.sceneId), ['c', 'b'], 'fuga → C, poi «sempre»');
    eq(SC().linksFor(w.scene, 'vittoria').map((l) => l.sceneId), ['b', 'b']);
    const L = SC().line(w.st.scenes);
    eq(L.edges.map((e) => [e.from, e.to, e.outcome]), [[0, 1, 'vittoria'], [0, 2, 'fuga'], [0, 1, 'sempre']], 'frecce');
    SC().startScene(w.st, w.sid, 'a', new Date());
    eq([w.scene.status, S().current(w.st).currentSceneId], ['in-corso', 'a'], 'avviata');
    const res = SC().concludeScene(w.st, w.sid, 'a', 'fuga', new Date());
    eq([w.scene.status, S().current(w.st).currentSceneId, res.next.map((n) => n.scene.id)], ['conclusa', '', ['c', 'b']], 'conclusa con le proposte');
    ok(w.scene.history.some((h) => h.text.includes('fuga')), 'storico');
    SC().startScene(w.st, w.sid, 'a', new Date());
    eq([w.scene.status, w.scene.history.length], ['in-corso', 3], 'riaperta: lo storico resta');
    SC().reopenScene(w.st, w.sid, 'a', new Date());
    eq(w.scene.status, 'da-fare', 'si torna indietro');
  });

  test('Scene: incontro con quantità e posizioni, lancio che prepara combattimento e mappa', () => {
    const w = sceneWorld();
    const r = SC().buildCombat(w.st, w.scene, w.enc, { players: w.st.players, sessionId: w.sid });
    const c = r.combat;
    const pos = (name) => c.combatants.find((x) => x.name === name).pos;
    eq([c.phase, c.scene, c.grid.sourceGridId, c.combatants.length], ['iniziativa', { sceneId: 'a', encounterId: 'enc' }, 'g1', 7], 'preparato, non avviato');
    eq([pos('Cinghiale delle paludi 1'), pos('Cinghiale delle paludi 2')], [{ x: 5, y: 5 }, { x: 6, y: 5 }], 'celle scelte');
    ok(pos('Cinghiale delle paludi 3').x >= 9, 'la terza copia nella zona dei nemici');
    ok(c.combatants.filter((x) => x.kind === 'player').every((x) => x.pos && x.pos.x <= 1), 'giocatori nella loro zona');
    ok(c.combatants.filter((x) => x.kind !== 'player').every((x) => x.faction === 'nemici' && x.control === 'ia'), 'fazione e IA');
    eq(DnD.dati.normalizeCombat(c).scene, { sceneId: 'a', encounterId: 'enc' }, 'riferimento salvato');
    w.scene.map.entry = { x: 6, y: 1 };
    const e2 = SC().buildCombat(w.st, w.scene, w.enc, { players: w.st.players, sessionId: w.sid, start: 'avvia' });
    ok(e2.combat.combatants.filter((x) => x.kind === 'player').every((x) => Math.max(Math.abs(x.pos.x - 6), Math.abs(x.pos.y - 1)) <= 2), 'giocatori al punto di entrata');
    eq([e2.combat.phase, Boolean(e2.combat.currentId)], ['attivo', true], 'Avvia ora');
    const noMap = SC().buildCombat(w.st, Object.assign({}, w.scene, { map: { gridId: '', entry: null } }), w.enc, { players: w.st.players, sessionId: w.sid });
    eq([noMap.unplaced, noMap.combat.grid.zones.length], [[], 2], 'senza mappa: griglia vuota con le zone');
    const ex = DnD.dati.normalizeSavedGrid({ id: 'mx', name: 'Valle', w: 10, h: 10, kind: 'esplorazione', sessionId: w.sid });
    w.st.savedGrids.push(ex);
    const e = SC().buildExploration(w.st, SC().normalizeScene({ title: 'Valle', map: { gridId: 'mx', entry: { x: 4, y: 3 } } }), w.st.players, 7);
    eq([e.gridId, e.parties[0].pos, e.parties[0].memberIds.length], ['mx', { x: 4, y: 3 }, 4], 'esplorazione al punto di entrata');
  });

  test('Scene: difficoltà dell\'incontro con il party e copia dal modello', () => {
    const w = sceneWorld();
    const r = SC().evaluate(w.st, w.enc, w.st.players, w.sid);
    eq([r.rawXp, r.band, r.perPlayerXp], [600, 'oltre', 150], '3 cinghiali (CS 1) contro 4 eroi di 1°');
    w.enc.creatures[0].qty = 1;
    eq(SC().evaluate(w.st, w.enc, w.st.players, w.sid).band, 'medio', 'quantità cambiata');
    eq(SC().evaluate(w.st, w.enc, w.st.players.slice(0, 1), w.sid).band, 'oltre', 'party cambiato');
    w.enc.creatures[0].faction = 'neutrali';
    eq(SC().evaluate(w.st, w.enc, w.st.players, w.sid).count, 0, 'fazione non ostile: non conta');
    const tpl = w.st.encounters.find((e) => e.id === 'incontro-esempio-agguato');
    const copy = SC().fromTemplate(tpl);
    copy.creatures[0].qty = 9;
    copy.name = 'Copia';
    eq([copy.templateId, copy.id !== tpl.id, tpl.creatures[0].qty, tpl.name, copy.creatures[0].id !== tpl.creatures[0].id], ['incontro-esempio-agguato', true, 3, 'Agguato nella palude', true], 'copia indipendente');
    eq(w.st.encounters.filter((e) => e.shared).length, 3, 'tre incontri d\'esempio');
  });

  test('Scene: condizioni di inizio (sorpresa, nascosti) e di fine', () => {
    const w = sceneWorld();
    w.enc.start = SC().normalizeStart({ surprised: 'giocatori', hidden: true, light: 'buio', weather: 'pioggia', hour: 22 });
    const r = SC().buildCombat(w.st, w.scene, w.enc, { players: w.st.players, sessionId: w.sid });
    const c = r.combat;
    ok(c.combatants.filter((x) => x.kind === 'player').every((x) => DnD.condizioni.has(x, 'sorpreso')), 'giocatori sorpresi');
    ok(c.combatants.filter((x) => x.kind !== 'player').every((x) => !DnD.condizioni.has(x, 'sorpreso') && x.hidden), 'nemici nascosti, non sorpresi');
    ok(DnD.condizioni.actionBlock(c.combatants[0]), 'il sorpreso non agisce');
    ok(c.log.some((l) => l.text.includes('Buio') && l.text.includes('pioggia') && l.text.includes('22:00')), 'luce, meteo e ora nel log');
    const t = FZ().table(w.st.factions);
    eq(SC().endCheck(c, w.enc, t, 'giocatori'), null, 'ancora in corso');
    c.round = 4;
    eq(SC().endCheck(c, w.enc, t, 'giocatori').outcome, 'round', 'round massimo');
    c.round = 1;
    for (const x of c.combatants) if (x.kind !== 'player') x.hp = 0;
    eq(SC().endCheck(c, w.enc, t, 'giocatori').outcome, 'vittoria', 'vittoria');
    const sum = SC().summary(w.st, c, t, 'giocatori');
    eq([sum.defeated.length, sum.xp, sum.down], [3, 600, []], 'riepilogo');
    const lost = SC().normalizeEncounter({ end: [{ kind: 'sconfitta' }, { kind: 'obiettivo', rounds: 5, text: 'Sopravvivere' }] });
    for (const x of c.combatants) x.hp = x.kind === 'player' ? 0 : 5;
    eq(SC().endCheck(c, lost, t, 'giocatori').outcome, 'sconfitta', 'sconfitta');
    for (const x of c.combatants) x.hp = 5;
    c.round = 6;
    eq(SC().endCheck(c, lost, t, 'giocatori'), { outcome: 'obiettivo', text: 'Sopravvivere (5 round)' }, 'obiettivo a tempo');
  });

  test('Scene: distribuzione delle ricompense (monete con conversione, oggetti, PE)', () => {
    const w = sceneWorld();
    const [p1, p2, p3] = w.st.players;
    const item = w.st.equipment[0];
    const lines = SC().distribute({ xp: 101, coins: { mo: 1, ma: 1 }, items: [{ equipmentId: item.id, qty: 2, to: 'h2' }, { equipmentId: 'sparito', qty: 1 }] }, [p1, p2], { coinsTo: 'dividi', equipment: w.st.equipment });
    eq([p1.xp, p2.xp, p1.coins.ma, p1.coins.mr, p2.coins.ma, p2.coins.mr, p1.coins.mo], [50, 50, 5, 5, 5, 5, 0], '110 mr divisi in due: 5 ma e 5 mr a testa');
    eq(p2.inventory.find((x) => x.equipmentId === item.id).qty, 2, 'oggetto al giocatore scelto');
    ok(lines.some((l) => l.includes('non più presente')), 'oggetto eliminato: avviso');
    SC().distribute({ coins: { mo: 1 } }, [p1, p2, p3], { coinsTo: 'dividi', equipment: [] });
    eq([p1.coins.ma - 5, p1.coins.mr - 5, p3.coins.ma, p3.coins.mr], [3, 4, 3, 3], '1 mo in tre: il resto al primo');
    SC().distribute({ coins: { mp: 2 } }, [p1, p2], { coinsTo: 'h2', equipment: [] });
    eq(p2.coins.mp, 2, 'tutte a un giocatore');
    eq(DnD.dati.normalizeCreature(p1, true).xp, 50, 'PE sulla scheda');
  });

  test('Scene: effetti su quest e fazioni, vista dei giocatori, note', () => {
    const w = sceneWorld();
    const qid = DnD.mondoDati.EXAMPLES.quests[0].id;
    w.scene.effects = [SC().normalizeEffect({ when: 'inizio', action: { kind: 'reputazione', factionId: 'neutrali', delta: 10 } }), SC().normalizeEffect({ when: 'fine', action: { kind: 'quest', questId: qid, op: 'avvia' } })];
    const lines = SC().startScene(w.st, w.sid, 'a', new Date());
    const v = FZ().view(w.st, w.sid);
    eq([DnD.party.active(v.parties, v.world).reputation.neutrali, lines.length], [10, 1], 'reputazione all\'inizio');
    SC().concludeScene(w.st, w.sid, 'a', 'vittoria', new Date());
    eq(DnD.quest.statusOf(v.world.quests, qid), 'attiva', 'quest avviata alla fine');
    w.scene.readAloud = '<p>Il fiume ruggisce.</p>';
    w.scene.encounters[0].tactics = 'segreto';
    eq(SC().statoScenaPerGiocatore(w.scene).readAloud, null, 'testo nascosto finché non rivelato');
    w.scene.revealed = true;
    const pv = SC().statoScenaPerGiocatore(w.scene);
    eq([pv.readAloud, Object.keys(pv)], ['<p>Il fiume ruggisce.</p>', ['id', 'title', 'kind', 'status', 'readAloud']], 'solo ciò che il master rivela');
    const se = S().current(w.st);
    const page = DnD.note.addPage(se.pages, 'Il guado', 'pg1');
    w.scene.pageId = page.id;
    eq(SC().sceneForPage(w.st, w.sid, 'pg1').id, 'a', 'dalla pagina alla scena');
    eq(SC().normalizeScene({ readAloud: '<p onclick="x()">ok<script>bad()</script></p>' }).readAloud.includes('script'), false, 'testo sanificato come le note');
    eq([SC().parseCells('b4, AA10 ,x').cells, SC().parseCells('b4, AA10 ,x').bad, SC().cellsText([{ x: 1, y: 3 }])], [[{ x: 1, y: 3 }, { x: 26, y: 9 }], ['x'], 'B4'], 'celle come sulla griglia');
  });

  test('Scene: «Genera incontro» dalla libreria con PE adatti al party', () => {
    const w = sceneWorld();
    const res = SC().generate(w.st, w.sid, { players: w.st.players, target: 'medio', theme: 'tipo:bestia', rng: () => 1 });
    eq([res.total, res.options.length, res.options[0].names, res.options[0].result.band], [1, 1, ['1× Cinghiale delle paludi'], 'medio'], 'un cinghiale è Medio per 4 eroi di 1°');
    const all = SC().generate(w.st, w.sid, { players: w.st.players, target: 'mortale', theme: '', rng: () => 1 });
    ok(all.options.length > 0 && all.options.length <= DnD.sceneDati.GEN_OPTIONS && all.options.every((o) => o.result.band === 'mortale'), 'tutte nella fascia scelta');
    ok(all.options.every((o) => o.rows.every((r) => r.ref.kind === 'npc' && w.st.npcs.some((n) => n.id === r.ref.id))), 'righe di creature della libreria');
    eq(SC().candidates(w.st, w.sid, 'tipo:drago').map((c) => c.id), ['esempio-drago-cenere'], 'tema per tipo');
    eq(SC().generate(w.st, w.sid, { players: w.st.players, target: 'facile', theme: 'tipo:drago' }).options, [], 'nessun gruppo adatto');
  });

  test('Scene: riferimenti mancanti senza errori', () => {
    const w = sceneWorld();
    const s = SC().normalizeScene({ title: 'Rotta', map: { gridId: 'nope' }, npcIds: ['nope'], eventIds: ['nope'], links: [{ sceneId: 'nope' }], pageId: 'nope',
      encounters: [{ name: 'Vuoto', creatures: [{ ref: { kind: 'npc', id: 'nope' } }, { ref: { kind: 'npc', id: CINGHIALE }, qty: 1 }] }], treasure: { items: [{ equipmentId: 'nope' }] } });
    const m = SC().missingRefs(w.st, s, w.sid);
    for (const k of ['mappa eliminata', 'creatura di «Vuoto» eliminata', 'NPC eliminato', 'evento eliminato', 'scena collegata eliminata', 'pagina delle note eliminata', 'oggetto del tesoro eliminato']) ok(m.includes(k), k);
    const r = SC().buildCombat(w.st, s, s.encounters[0], { players: w.st.players, sessionId: w.sid });
    eq([r.missing.length, r.combat.combatants.length], [1, 5], 'creatura mancante saltata, mappa vuota');
    ok(r.lines.some((l) => l.includes('non più presente')) && r.lines.some((l) => l.includes('vuota')), 'avvisi nel log');
    eq(SC().line([s]).edges[0].missing, true, 'freccia disattivata');
    eq(SC().evaluate(w.st, s.encounters[0], w.st.players, w.sid).count, 1, 'difficoltà con le sole creature presenti');
  });

  test('Scene: dati v16, ripresa dopo la chiusura, esportazione e importazione', () => {
    const w = sceneWorld();
    const mig = DnD.dati.normalizeState({ version: 15, races: [], npcs: [], players: [{ id: 'p', name: 'P' }] });
    eq([mig.version, mig.scenes, mig.encounters.length, S().current(mig).currentSceneId, mig.players[0].xp], [DnD.dati.VERSION, [], 3, '', 0], 'v15 → v16: nessuna scena, esempi');
    eq(DnD.dati.normalizeState({ version: 16, encounters: [] }).encounters, [], 'archivio già v16: niente esempi aggiunti');
    SC().startScene(w.st, w.sid, 'a', new Date());
    const r = SC().buildCombat(w.st, w.scene, w.enc, { players: w.st.players, sessionId: w.sid });
    S().current(w.st).combat = r.combat;
    SC().recordLaunch(w.scene, w.enc, r.combat.id, new Date());
    const back = DnD.dati.importJSON(DnD.dati.exportJSON(w.st));
    const bs = back.scenes.find((s) => s.id === 'a');
    eq([S().current(back).currentSceneId, bs.status, bs.encounters[0].run.launched, S().current(back).combat.scene.sceneId, bs.history.length], ['a', 'in-corso', 1, 'a', 2], 'riaperta l\'app: scena, lancio e combattimento');
    eq(SC().ofCombat(back, S().current(back).combat).enc.name, 'Cinghiali', 'combattimento ricollegato alla scena');
    // File di sessione: id nuovi e riferimenti rimappati (scene collegate, creature della sessione, griglie).
    w.st.npcs.push(DnD.dati.normalizeCreature({ id: 'bandito', name: 'Bandito', level: 3, sessionId: w.sid }, false));
    w.st.encounters.push(SC().normalizeEncounter({ id: 'lib', name: 'Banditi', creatures: [{ ref: { kind: 'npc', id: 'bandito' }, qty: 2 }], sessionId: w.sid }));
    w.scene.encounters[0].creatures.push(SC().normalizeRow({ ref: { kind: 'npc', id: 'bandito' } }));
    const file = JSON.parse(JSON.stringify(S().exportSession(w.st, w.sid)));
    const dst = DnD.dati.emptyState();
    S().importSession(dst, file, DnD.dadi.uid);
    const nsid = S().current(dst).id;
    const ns = dst.scenes.filter((s) => s.sessionId === nsid);
    const guado = ns.find((s) => s.title === 'Il guado');
    const bandit = dst.npcs.find((n) => n.name === 'Bandito');
    eq([ns.length, guado.links.every((l) => ns.some((s) => s.id === l.sceneId)), guado.map.gridId === dst.savedGrids.find((g) => g.name === 'Radura').id], [3, true, true], 'scene e collegamenti');
    eq([guado.encounters[0].creatures[1].ref.id, dst.encounters.find((e) => e.name === 'Banditi').creatures[0].ref.id, guado.encounters[0].creatures[0].ref.id], [bandit.id, bandit.id, CINGHIALE], 'creature della sessione rimappate, condivise uguali');
    S().duplicateSession(w.st, w.sid, 'Copia', DnD.dadi.uid);
    const dsid = S().current(w.st).id;
    const dup = w.st.scenes.filter((s) => s.sessionId === dsid);
    eq([dup.length, dup.find((s) => s.title === 'Il guado').links.every((l) => dup.some((s) => s.id === l.sceneId))], [3, true], 'duplicazione della sessione');
  });

  test('Scene UI: la difficoltà dell\'incontro si aggiorna mentre cambiano le creature', async () => {
    const mem = new Map();
    const backend = { name: 'memoria', get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, clear: async () => mem.clear() };
    const prevStore = DnD.store;
    DnD.store = await DnD.dati.openStore({ getItem: () => null, setItem() {}, removeItem() {} }, { backend });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:900px;overflow:hidden;z-index:-1';
    document.body.append(box);
    try {
      DnD.store.update((s) => { const sid = S().current(s).id; s.players = [1, 2, 3, 4].map((i) => DnD.dati.normalizeCreature({ id: 'h' + i, name: 'Eroe ' + i, level: 1, sessionId: sid }, true)); });
      DnD.sezioni.scene.render(box);
      ok(box.querySelector('.empty'), 'scaletta vuota');
      box.querySelector('#scheda-scene-incontri').click();
      ok(box.querySelectorAll('.card').length === 3, 'tre incontri d\'esempio in libreria');
      [...box.querySelectorAll('button')].find((b) => b.textContent === '+ Nuovo incontro').click();
      [...box.querySelectorAll('button')].find((b) => b.textContent === '+ Creatura').click();
      const badge = () => box.querySelector('.diff-indicator .diff-badge').textContent;
      eq(badge(), 'Medio', 'un cinghiale');
      const qty = box.querySelector('.enc-row input[aria-label="Quantità"]');
      qty.value = '2';
      qty.dispatchEvent(new Event('input'));
      eq(badge(), 'Mortale', 'due cinghiali');
      DnD.sezioni.scene.reset();
    } finally {
      box.remove();
      DnD.store = prevStore;
    }
  });

  // --- Scheda del giocatore (scheda.js) ---
  const SH = () => DnD.scheda;
  // Archivio minimo in DnD.store per i calcoli che leggono talenti e catalogo dallo stato.
  function withState(state, fn) {
    const prev = DnD.store;
    DnD.store = { state };
    try { return fn(); } finally { DnD.store = prev; }
  }
  const hero = (extra) => DnD.dati.normalizeCreature(Object.assign({ id: 'pc', name: 'Ida', level: 5, classId: 'ladro', maxHp: 30,
    abilities: { FOR: 10, DES: 16, COS: 12, INT: 14, SAG: 12, CAR: 8 } }, extra), true);

  test('Scheda: acquisto punti (27 punti, 8-15) e rifiuto oltre il budget', () => {
    const base = { FOR: 8, DES: 8, COS: 8, INT: 8, SAG: 8, CAR: 8 };
    eq([SH().pointBuy(base).cost, SH().pointBuy(base).left, SH().pointBuy(base).valid], [0, 27, true], 'tutto a 8');
    const top = { FOR: 15, DES: 15, COS: 15, INT: 8, SAG: 8, CAR: 8 };
    eq([SH().pointBuy(top).cost, SH().pointBuy(top).valid], [27, true], 'tre 15: 27 punti');
    eq(SH().pointBuy(Object.assign({}, top, { INT: 9 })).valid, false, '28 punti: oltre il budget');
    eq([SH().canBuy(top, 'INT', 9), SH().canBuy(base, 'FOR', 16), SH().canBuy(base, 'FOR', 7), SH().canBuy(base, 'FOR', 14)], [false, false, false, true]);
    eq(SH().pointBuy({ FOR: 13, DES: 14, COS: 12, INT: 10, SAG: 11, CAR: 9 }).cost, 5 + 7 + 4 + 2 + 3 + 1, 'costo per valore');
    eq(SH().pointBuy(Object.assign({}, base, { FOR: 17 })).out, ['FOR'], 'fuori dall\'intervallo');
    eq([R().modifier(15), R().proficiencyBonus(5), R().proficiencyBonus(9), R().proficiencyBonus(17)], [2, 3, 4, 6], 'modificatori e competenza');
  });

  test('Scheda: abilità con competenza, maestria e metà competenza; passive', () => {
    const p = hero({ sheet: { skills: { 'Furtività': 2, 'Indagare': 1 }, half: true, skillBonus: { 'Percezione': 2 } } });
    const d = DnD.combattenti.derivedStats(p, null, []);
    const fx = SH().featEffects(p, []);
    const b = (k) => SH().skillBonus(p, k, d, fx, null);
    eq([b('Furtività').total, b('Indagare').total, b('Atletica').total, b('Percezione').total], [9, 5, 1, 4], 'maestria 3+6, competenza 2+3, metà 0+1, bonus 1+1+2');
    ok(b('Furtività').detail.includes('maestria') && b('Atletica').half, 'dettaglio del calcolo');
    eq([SH().passive(p, 'Percezione', d, fx, null), SH().passive(p, 'Indagare', d, fx, null)], [14, 15], 'passive');
    eq(SH().skills(p, d, fx, null).length, 18, 'diciotto abilità');
    eq(DnD.leggendario.checkBonus(p, 'Furtività', false, { races: [], equipment: [], feats: [] }), 9, 'le prove degli eventi usano la scheda');
  });

  test('Scheda: valori automatici sovrascritti e ritorno ad auto', () => {
    const p = hero({ sheet: { initiativeBonus: 2, speedBonus: 3 } });
    const d = () => DnD.combattenti.derivedStats(p, null, []);
    eq([SH().initiative(p, d(), null).total, SH().speed(p, null, null, []).total], [5, 12], 'auto: DES + bonus, razza + bonus');
    p.sheet.overrides.initiative = 7;
    p.sheet.overrides.speed = 6;
    eq([SH().initiative(p, d(), null).total, SH().initiative(p, d(), null).manual, SH().speed(p, null, null, []).total], [7, true, 6], 'a mano');
    const x = DnD.combattenti.createCombatants([p], [], [], seq(10), [], [])[0];
    eq([x.initiative, x.speeds.cammina], [17, 20], 'nel combattimento: iniziativa 10 + 7, velocità 6 m = 20 piedi');
    p.sheet.overrides.initiative = null;
    p.sheet.overrides.speed = null;
    eq([SH().initiative(p, d(), null).total, SH().initiative(p, d(), null).manual, SH().speed(p, null, null, []).total], [5, false, 12], 'di nuovo auto');
    eq(SH().normalizeSheet({ overrides: { initiative: '', speed: 'x', carry: 50 } }).overrides, { initiative: null, speed: null, carry: 50 }, 'normalizzazione');
  });

  test('Scheda: capacità di carico e sintonia', () => {
    const cat = DnD.attrezzatura.defaults().concat([1, 2, 3, 4].map((i) => DnD.dati.normalizeEquipment({ id: 'anello-' + i, name: 'Anello ' + i, category: 'magici', attunement: true })));
    const p = hero({ inventory: [{ equipmentId: 'eq-cotta-di-maglia', qty: 1 }], coins: { mo: 100 } });
    const d = DnD.combattenti.derivedStats(p, null, cat);
    const c = SH().carry(p, d, cat);
    eq([c.weight, c.capacity, c.over], [28.5, 75, false], 'FOR 10 × 7,5 kg');
    p.sheet.overrides.carry = 20;
    eq(SH().carry(p, d, cat).over, true, 'capacità a mano: sovraccarico');
    p.inventory = [1, 2, 3].map((i) => ({ id: 'r' + i, equipmentId: 'anello-' + i, qty: 1, attuned: true }));
    eq([SH().attunement(p, cat).count, SH().canAttune(p, cat)], [3, false], 'tre in sintonia: niente di più');
    p.inventory.push({ id: 'r4', equipmentId: 'anello-4', qty: 1, attuned: true }, { id: 'r5', equipmentId: 'eq-cotta-di-maglia', qty: 1, attuned: true });
    eq([SH().attunement(p, cat).count, SH().attunement(p, cat).over], [4, true], 'oltre il massimo (e la cotta non richiede sintonia)');
    eq(DnD.attrezzatura.normalizeInventory([{ equipmentId: 'x', attuned: 1 }])[0].attuned, true, 'campo dell\'inventario');
  });

  test('Scheda: background applicato con anteprima e senza duplicati', () => {
    const cat = DnD.attrezzatura.defaults();
    const bg = SH().exampleBackgrounds('s').find((b) => b.id === 'bg-gladiatore');
    const p = hero({ inventory: [{ equipmentId: 'eq-tridente', qty: 1 }], sheet: { skills: { 'Atletica': 1 }, proficiencies: [{ kind: 'strumenti', text: 'un tipo di arma insolita' }] } });
    const r = SH().applyBackground(p, bg, cat);
    eq(r.changes, ['Background: Ex gladiatore', 'Competenza in Intrattenere', 'Privilegio: Nome dell\'arena'], 'anteprima delle aggiunte');
    eq(r.skipped.length, 3, 'già presenti: Atletica, strumento, tridente');
    eq([p.sheet.background, p.sheet.skills.Intrattenere], ['', undefined], 'la scheda non cambia senza conferma');
    const again = SH().applyBackground(r.player, bg, cat);
    eq([again.changes, again.player.sheet.features.length, again.player.inventory.length], [[], 1, 1], 'riapplicato: nessun doppione');
    const fresh = SH().applyBackground(hero(), SH().exampleBackgrounds('s').find((b) => b.id === 'bg-novizio-cenere'), cat);
    ok(fresh.changes.includes('Equipaggiamento: 1× Bastone ferrato') && fresh.player.sheet.proficiencies.some((x) => x.kind === 'linguaggi'), 'equipaggiamento per nome e linguaggi');
  });

  test('Scheda: talenti, effetti nei calcoli e punti caratteristica', () => {
    const feats = SH().exampleFeats('s');
    const st = Object.assign(DnD.dati.emptyState(), { feats });
    const p = hero({ level: 4, acMode: 'auto', sheet: { features: [{ name: 'Pelle di quercia', source: 'talento', featId: 'tal-pelle-quercia', asi: true }, { name: 'Guardia', source: 'talento', featId: 'tal-guardia-alta' }, { name: 'Occhio', source: 'talento', featId: 'tal-occhio-aquila' }] } });
    eq([SH().asiAvailable(p), SH().asiAvailable(Object.assign({}, p, { level: 8 }))], [0, 2], 'un talento al posto di 2 punti');
    const fx = SH().featEffects(p, feats);
    eq([fx.abilities, fx.ac, fx.saves, fx.skills], [{ COS: 1, SAG: 1 }, 2, ['DES'], ['Percezione']], 'effetti sommati');
    withState(st, () => {
      const d = DnD.combattenti.derivedStats(p, null, []);
      eq([d.abilities.COS, d.abilities.SAG, d.ac.total, d.saves.includes('DES')], [13, 13, 15, true], 'caratteristiche, CA e salvezze');
      ok(d.ac.detail.includes('talenti 2'), 'dettaglio della CA');
      eq(SH().skillBonus(p, 'Percezione', d, d.fx, st).level, 1, 'competenza dal talento');
    });
    const tough = hero({ level: 5, sheet: { features: [{ name: 'Tempra', featId: 'tal-tempra' }] } });
    eq(SH().autoHp(tough, 1, SH().featEffects(tough, feats), 'media').total, 8 + 4 * 5 + 5 * 1 + 10, 'PF: media + talento per livello');
    const lost = hero({ sheet: { features: [{ name: 'Perduto', featId: 'sparito' }] } });
    eq(SH().featEffects(lost, feats).missing, ['Perduto'], 'talento eliminato');
    eq([R().asiPointsAvailable(19), R().asiPointsAvailable(24)], [10, 12], 'livelli 4, 8, 12, 16, 19; oltre il 20 ogni 4');
  });

  test('Scheda: avanzamento di livello (PF, slot, privilegi, PE) e preparazione', () => {
    const p = hero({ level: 3, maxHp: 20, hpMode: 'manuale', abilities: { FOR: 10, DES: 16, COS: 12, INT: 14, SAG: 12, CAR: 8 } });
    const r = SH().levelUp(p, { hpMethod: 'media', asi: { DES: 2 } }, { feats: [] });
    eq([r.player.level, r.player.maxHp, r.summary.hpGain, r.summary.asiLevel, r.player.asi.DES, r.player.sheet.features.map((f) => f.name)], [4, 26, 6, true, 2, ['Privilegio di livello 4']], 'media + COS, punti al 4°');
    eq([p.level, p.maxHp], [3, 20], 'l\'originale non cambia (annullabile)');
    eq(SH().levelUp(p, { hpMethod: 'tira', roll: 1 }, { feats: [] }).summary.hpGain, 2, 'tiro 1 + COS');
    eq(SH().levelUp(p, { hpMethod: 'manuale', manual: 7 }, { feats: [] }).summary.hpGain, 7, 'a mano');
    const mage = hero({ classId: 'mago', level: 2, abilities: { FOR: 8, DES: 14, COS: 12, INT: 16, SAG: 10, CAR: 10 } });
    const rm = SH().levelUp(mage, { hpMethod: 'media', spells: ['palla'] }, { feats: [] });
    eq([rm.summary.slotsBefore.slice(0, 2), rm.summary.slotsAfter.slice(0, 2), rm.player.spellcasting.known], [[3, 0], [4, 2], ['palla']], 'nuovi slot e incantesimi');
    eq(SH().levelUp(hero({ level: 20 }), {}, { feats: [] }).summary, null, 'livello massimo');
    eq([SH().xpInfo(hero({ level: 3, xp: 2700 })).canLevelUp, SH().xpInfo(hero({ level: 3, xp: 2699 })).canLevelUp, SH().levelForXp(6500), SH().xpInfo(hero({ level: 3 })).next], [true, false, 5, 2700], 'soglie dei PE');
    const cleric = hero({ classId: 'chierico', abilities: { FOR: 10, DES: 10, COS: 12, INT: 10, SAG: 16, CAR: 10 }, sheet: { spellFlags: { a: { prepared: true }, b: { prepared: true }, c: { prepared: false } } } });
    eq(SH().preparable(cleric, DnD.combattenti.derivedStats(cleric, null, [])), { max: 8, prepared: 2 }, 'chierico: livello + SAG');
    const pal = hero({ classId: 'paladino', abilities: { FOR: 14, DES: 10, COS: 12, INT: 10, SAG: 10, CAR: 14 } });
    eq(SH().preparable(pal, DnD.combattenti.derivedStats(pal, null, [])).max, 4, 'paladino: metà livello + CAR');
    eq(SH().preparable(hero(), DnD.combattenti.derivedStats(hero(), null, [])), null, 'il ladro non prepara');
    const fighter = hero({ classId: 'guerriero', sheet: { spellcaster: true, casterType: 'mezzo' } });
    ok(SH().isCaster(fighter) && DnD.combattenti.derivedStats(fighter, null, []).spell.slotsTotal[0] === 4, 'casella «Incantatore»: come la classe personalizzata');
  });

  test('Scheda: condizioni e tiri contro la morte tra scheda e combattimento', () => {
    const p = hero({ status: { hp: 0 }, sheet: { conditions: ['prono'], deathSaves: { successes: 1, failures: 2 } } });
    const x = DnD.combattenti.createCombatants([p], [], [], seq(10), [], [])[0];
    eq([DnD.condizioni.has(x, 'prono'), x.deathSaves.active, x.deathSaves.successes, x.deathSaves.failures], [true, true, 1, 2], 'dalla scheda');
    DnD.condizioni.remove(x, 'prono');
    DnD.condizioni.apply(x, { type: 'avvelenato' });
    x.hp = 5;
    DnD.riposi.syncBack(x, p);
    eq([p.sheet.conditions, p.sheet.deathSaves], [['avvelenato'], { successes: 0, failures: 0 }], 'di ritorno sulla scheda');
  });

  test('Scheda: migrazione di un giocatore esistente, librerie ed esempi', () => {
    const mig = DnD.dati.normalizeState({ version: 16, races: [], npcs: [], players: [{ id: 'old', name: 'Vecchio', level: 3, notes: 'appunti', maxHp: 22,
      weapons: [{ name: 'Ascia', toHit: 4, damageDice: '1d6' }], inventory: [{ equipmentId: 'eq-ascia', qty: 1 }], coins: { mo: 7 } }] });
    const p = mig.players[0];
    eq([mig.version, p.notes, p.maxHp, p.weapons[0].name, p.inventory[0].attuned, p.coins.mo, p.sheet.alignment, p.sheet.features, p.sheet.skills, p.sheet.wizard.done], [DnD.dati.VERSION, 'appunti', 22, 'Ascia', false, 7, '', [], {}, true], 'nessun dato perso, campi nuovi vuoti');
    eq([mig.backgrounds.length, mig.feats.length], [6, 8], 'esempi originali');
    eq([DnD.dati.normalizeState({ version: 17 }).backgrounds.length, DnD.dati.normalizeState({ version: 17 }).feats.length], [0, 0], 'archivio già v17: niente esempi aggiunti');
    eq(SH().normalizeSheet({ story: '<p onclick="x()">Nata<script>bad()</script> al faro</p>' }).story.includes('script'), false, 'storia sanificata come le note');
    eq(DnD.dati.normalizeCreature({ name: 'Nemico' }, false).sheet, undefined, 'i nemici non cambiano');
  });

  test('Scheda: esportazione e importazione di un singolo personaggio', () => {
    const st = DnD.dati.emptyState();
    const p = hero({ sheet: { background: 'bg-gladiatore', features: [{ name: 'Tempra', featId: 'tal-tempra' }], alignment: 'Neutrale' } });
    const file = JSON.parse(JSON.stringify(SH().exportCharacter(p, st)));
    eq([file.kind, file.backgrounds.map((b) => b.id), file.feats.map((f) => f.id)], ['personaggio', ['bg-gladiatore'], ['tal-tempra']], 'con background e talenti usati');
    const dst = Object.assign(DnD.dati.emptyState(), { backgrounds: [], feats: [] });
    const r = SH().importCharacter(file, dst, 'sx');
    eq([r.player.id !== 'pc', r.player.name, r.player.sessionId, r.player.sheet.alignment, r.backgrounds.length, r.feats.length, r.warnings], [true, 'Ida', 'sx', 'Neutrale', 1, 1, []], 'importato con le librerie mancanti');
    eq(SH().importCharacter(file, st, 'sx').backgrounds.length, 0, 'librerie già presenti: non si duplicano');
    let msg = '';
    try { SH().importCharacter({ kind: 'creatura' }, st, 'sx'); } catch (e) { msg = e.message; }
    ok(msg.includes('personaggio'), 'file sbagliato');
    const sid = S().current(st).id;
    st.players.push(Object.assign(hero({ id: 'p1', sessionId: sid }), { sheet: SH().normalizeSheet({ background: 'bg-mio', features: [{ name: 'T', featId: 'tal-mio' }] }) }));
    st.backgrounds.push(SH().normalizeBackground({ id: 'bg-mio', name: 'Mio', sessionId: sid }));
    st.feats.push(SH().normalizeFeat({ id: 'tal-mio', name: 'Mio', sessionId: sid }));
    S().duplicateSession(st, sid, 'Copia', DnD.dadi.uid);
    const nsid = S().current(st).id;
    const copy = st.players.find((x) => x.sessionId === nsid);
    eq([copy.sheet.background === st.backgrounds.find((b) => b.sessionId === nsid && b.name === 'Mio').id, copy.sheet.features[0].featId === st.feats.find((f) => f.sessionId === nsid).id], [true, true], 'duplicazione della sessione: riferimenti rimappati');
  });

  test('Scheda: creazione guidata completa e interrotta, riferimenti mancanti', () => {
    const st = DnD.dati.emptyState();
    const blank = DnD.dati.normalizeCreature({ name: '', sheet: { wizard: { done: false } } }, true);
    const texts = SH().missing(blank, st).map((x) => x.text);
    for (const t of ['manca la razza', 'manca la classe', 'caratteristiche ancora tutte a 10', 'manca il background', 'nessun equipaggiamento', 'manca il nome', 'manca l\'allineamento']) ok(texts.includes(t), t);
    eq(blank.sheet.wizard.done, false, 'creazione interrotta: si completa dopo');
    const done = DnD.dati.normalizeCreature({ name: 'Brenna', raceId: st.races[0].id, classId: 'guerriero', abilities: { FOR: 15, DES: 12, COS: 14, INT: 8, SAG: 10, CAR: 13 },
      inventory: [{ equipmentId: 'eq-spada-lunga', qty: 1 }], sheet: { background: 'bg-gladiatore', alignment: 'Neutrale', skills: { 'Atletica': 1, 'Intrattenere': 1, 'Percezione': 1, 'Sopravvivenza': 1 } } }, true);
    eq(SH().missing(done, st), [], 'creazione completa');
    eq(SH().classSkillChoice(done, st.backgrounds.find((b) => b.id === 'bg-gladiatore')), { count: 2, options: DnD.schedaDati.CLASS_SKILLS.guerriero.options, chosen: ['Percezione', 'Sopravvivenza'], missing: 0 }, 'abilità della classe (senza quelle del background)');
    const broken = hero({ inventory: [{ equipmentId: 'sparito', qty: 1 }], spellcasting: { known: ['sparito'] }, sheet: { background: 'sparito', features: [{ name: 'x', featId: 'sparito' }], allies: [{ kind: 'fazione', refId: 'sparita' }] } });
    eq(SH().missingRefs(broken, st), ['oggetto dell\'inventario eliminato', 'incantesimo eliminato', 'background eliminato', 'talento eliminato', 'alleato eliminato'], 'avvisi senza errori');
  });

  test('Scheda UI: stampa in tre pagine, creazione guidata interrotta, vista di gioco', async () => {
    const mem = new Map();
    const backend = { name: 'memoria', get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, clear: async () => mem.clear() };
    const prevStore = DnD.store;
    DnD.store = await DnD.dati.openStore({ getItem: () => null, setItem() {}, removeItem() {} }, { backend });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:1300px;height:900px;overflow:hidden;z-index:-1';
    document.body.append(box);
    try {
      const sid = S().current(DnD.store.state).id;
      const p = hero({ sessionId: sid, sheet: { story: '<p>Nata al faro.</p>' } });
      const pages = DnD.uiScheda.printNode(p).querySelectorAll('.sheet-page');
      eq([pages.length, pages[0].querySelector('h1').textContent, pages[1].textContent.includes('Nata al faro'), pages[2].textContent.includes('non lancia incantesimi')], [3, 'Ida', true, true], 'stampa: tre pagine');
      let saved = null;
      const blank = DnD.dati.normalizeCreature({ name: '', sessionId: sid }, true);
      DnD.uiScheda.editor({ player: blank, isNew: true, host: box, persist: (x) => { saved = x; }, done: () => {} });
      ok(box.querySelector('.char-wizard'), 'creazione guidata');
      [...box.querySelectorAll('button')].find((b) => b.textContent === 'Esci e completa dopo').click();
      ok(box.querySelector('.char-sheet') && !box.querySelector('.char-wizard'), 'passa alla Scheda senza perdere dati');
      const name = box.querySelector('.char-name input');
      name.value = 'Lia';
      name.dispatchEvent(new Event('input'));
      [...box.querySelectorAll('button')].find((b) => b.textContent === 'Salva').click();
      eq([saved.name, saved.sheet.wizard.done], ['Lia', false], 'salvata a metà: campi mancanti segnalati, non bloccati');
      box.textContent = '';
      DnD.store.update((s) => { s.players.push(p); });
      box.append(DnD.uiScheda.gameSheet(DnD.uiScheda.draftOf(p), true));
      [...box.querySelectorAll('.char-cond')].find((b) => b.textContent.includes('Prono')).click();
      [...box.querySelectorAll('button')].find((b) => b.textContent === '−1').click();
      const q = DnD.store.state.players.find((x) => x.id === 'pc');
      eq([q.sheet.conditions, q.status.hp], [['prono'], 29], 'vista di gioco: condizioni e PF con un clic');
    } finally {
      box.remove();
      DnD.store = prevStore;
    }
  });

  // --- Luce, visione e nebbia di guerra (fase 5/5) ---
  const V = () => DnD.visione;
  const VC = () => DnD.condizioni;
  // Griglia di prova normalizzata (strutture, oggetti, piedi per cella, visione e nebbia).
  const vGrid = (o) => DnD.dati.normalizeSavedGrid(Object.assign({ id: 'vg', name: 'Prova', w: 20, h: 20, structures: [], items: [] }, o || {}));
  const vWall = (id, x, y, w, h, extra) => Object.assign({ id, name: 'Muro', x, y }, G().shapeFrom(w, h, () => true), extra || {});
  const vC = (o) => Object.assign({ id: 'c', name: 'Pedina', kind: 'player', faction: 'giocatori', hp: 10, maxHp: 10, w: 1, h: 1, conditions: [], senses: {} }, o);
  const vCtx = (g, list, opts) => V().context(g, list, opts);

  test('Visione: linea di vista con muri, porte, finestre e pedine 2×2', () => {
    const g = vGrid({ structures: [vWall('m', 5, 0, 1, 20), vWall('f', 10, 0, 1, 20, { blocksSight: false })] });
    const a = vC({ id: 'a', pos: { x: 2, y: 5 } });
    const b = vC({ id: 'b', kind: 'npc', faction: 'nemici', pos: { x: 8, y: 5 } });
    const c = vC({ id: 'c', kind: 'npc', faction: 'nemici', pos: { x: 12, y: 5 } });
    let ctx = vCtx(g, [a, b, c]);
    ok(!V().canSee(ctx, a, b).seen && V().canSee(ctx, a, b).cause === 'linea', 'il muro blocca la vista');
    ok(V().canSee(ctx, b, c).seen, 'la finestra (struttura che non blocca la vista) lascia vedere');
    ok(G().isCellBlocked(g, 10, 5), 'ma blocca il movimento');
    // Varco con una porta nel muro: chiusa blocca, aperta si vede.
    g.structures[0].cells = g.structures[0].cells.slice(0, 5) + '0' + g.structures[0].cells.slice(6);
    g.items.push(DnD.dati.normalizePlacedItem({ id: 'p', name: 'Porta', otype: 'porta', x: 5, y: 5 }));
    ctx = vCtx(g, [a, b]);
    ok(!V().canSee(ctx, a, b).seen, 'porta chiusa: non si vede');
    g.items[0].state = 'aperto';
    ctx = vCtx(g, [a, b]);
    ok(V().canSee(ctx, a, b).seen, 'porta aperta: si vede');
    eq(V().lineOfSight(ctx.sm, { x: 2, y: 5 }, { x: 8, y: 5 }), V().lineOfSight(ctx.sm, { x: 8, y: 5 }, { x: 2, y: 5 }), 'simmetrica');
    // Pedina 2×2: basta una cella del suo ingombro.
    const g2 = vGrid({ structures: [vWall('m', 5, 0, 1, 6)] });
    const big = vC({ id: 'g', w: 2, h: 2, pos: { x: 2, y: 5 } });
    const t = vC({ id: 't', kind: 'npc', faction: 'nemici', pos: { x: 8, y: 5 } });
    ok(V().canSee(vCtx(g2, [big, t]), big, t).seen, 'la riga in basso della pedina 2×2 vede oltre la fine del muro');
    ok(!V().canSee(vCtx(g2, [t]), vC({ id: 's', pos: { x: 2, y: 5 } }), t).seen, 'una pedina 1×1 dietro il muro no');
  });

  test('Visione: luce, scurovisione, penombra e sorgenti con piedi per cella diversi', () => {
    const g = vGrid({ vision: { ambient: 'buio' } });
    const human = vC({ id: 'h', pos: { x: 2, y: 2 } });
    const elf = vC({ id: 'e', pos: { x: 2, y: 3 }, senses: { darkvision: 60 } });
    const orc = vC({ id: 'o', kind: 'npc', faction: 'nemici', pos: { x: 8, y: 2 } });
    let ctx = vCtx(g, [human, elf, orc]);
    eq([V().canSee(ctx, human, orc).seen, V().canSee(ctx, human, orc).cause], [false, 'buio'], 'buio: un umano non vede');
    eq([V().canSee(ctx, elf, orc).seen, V().canSee(ctx, elf, orc).level, V().canSee(ctx, elf, orc).how], [true, 1, 'darkvision'], 'scurovisione: il buio conta come penombra');
    const far = vC({ id: 'f', kind: 'npc', faction: 'nemici', pos: { x: 2, y: 17 } }); // 14 celle = 70 ft
    ok(!V().canSee(vCtx(g, [elf, far]), elf, far).seen, 'oltre il raggio della scurovisione non si vede');
    g.vision.ambient = 'crepuscolo';
    ctx = vCtx(g, [human, elf, orc]);
    eq([V().canSee(ctx, human, orc).level, V().canSee(ctx, elf, orc).level], [1, 2], 'penombra: vista leggermente oscurata; con la scurovisione come luce intensa');
    eq(V().perceptionMods(ctx, human, { x: 8, y: 2 }).dis.length, 1, 'penombra: svantaggio alla Percezione');
    // Torcia: 20 ft intensa + 20 ft penombra = 4 + 4 celle da 5 ft, 2 + 2 celle da 10 ft.
    g.vision.ambient = 'buio';
    const torch = vC({ id: 'h', pos: { x: 2, y: 2 }, light: { kind: 'torcia', on: true, minutes: 60 } });
    let lm = V().lightMap(g, [torch], V().sightMap(g));
    eq([lm.level[2 * 20 + 6], lm.level[2 * 20 + 7], lm.level[2 * 20 + 10], lm.level[2 * 20 + 11]], [2, 1, 1, 0], 'celle da 5 ft');
    g.feetPerCell = 10;
    lm = V().lightMap(g, [torch], V().sightMap(g));
    eq([lm.level[2 * 20 + 4], lm.level[2 * 20 + 5], lm.level[2 * 20 + 6], lm.level[2 * 20 + 7]], [2, 1, 1, 0], 'celle da 10 ft');
    // La luce non passa i muri.
    g.feetPerCell = 5;
    g.structures.push(DnD.dati.normalizePlacedStructure(vWall('m', 4, 0, 1, 20), g));
    lm = V().lightMap(g, [torch], V().sightMap(g));
    eq([lm.level[2 * 20 + 3], lm.level[2 * 20 + 5]], [2, 0], 'il muro ferma la luce');
    // Sorgente piazzata e oggetto che fa luce.
    const g2 = vGrid({ vision: { ambient: 'notte', lights: [{ id: 'l', x: 10, y: 10, bright: 10, dim: 10 }] },
      items: [{ id: 'br', name: 'Braciere', otype: 'altro', x: 2, y: 15, light: { on: true, bright: 5, dim: 5 } }] });
    lm = V().lightMap(g2, [], V().sightMap(g2));
    eq([lm.level[10 * 20 + 12], lm.level[10 * 20 + 13], lm.level[15 * 20 + 3], lm.level[15 * 20 + 5]], [2, 1, 2, 0], 'sorgente piazzata e braciere');
    g2.vision.lights[0].on = false;
    eq(V().lightMap(g2, [], V().sightMap(g2)).level[10 * 20 + 12], 0, 'sorgente spenta');
  });

  test('Visione: vista cieca, vista pura, percezione tellurica, accecato e invisibile', () => {
    const g = vGrid({ vision: { ambient: 'buio', lights: [{ id: 'd', x: 10, y: 5, dark: true, bright: 0, dim: 15 }] } });
    const bat = vC({ id: 'b', kind: 'npc', faction: 'nemici', pos: { x: 2, y: 5 }, senses: { blindsight: 30 } });
    const devil = vC({ id: 'd', kind: 'npc', faction: 'nemici', pos: { x: 5, y: 5 }, senses: { truesight: 60, darkvision: 120 } });
    const elf = vC({ id: 'e', pos: { x: 6, y: 5 }, senses: { darkvision: 60 } });
    const mole = vC({ id: 'm', kind: 'npc', faction: 'nemici', pos: { x: 6, y: 12 }, senses: { tremorsense: 60 } });
    const inDark = vC({ id: 'x', pos: { x: 10, y: 5 } });
    const ctx = vCtx(g, [bat, devil, elf, mole, inDark]);
    eq(V().canSee(ctx, bat, elf).how, 'blindsight', 'vista cieca: vede senza luce');
    eq([V().canSee(ctx, elf, inDark).seen, V().canSee(ctx, elf, inDark).cause], [false, 'magico'], 'buio magico: la scurovisione non vede');
    eq(V().canSee(ctx, devil, inDark).how, 'truesight', 'la vista pura vede nel buio magico');
    eq(V().canSee(ctx, mole, elf).how, 'tremorsense', 'percezione tellurica: sente chi tocca il suolo');
    ok(!V().canSee(ctx, mole, Object.assign({}, elf, { moveMode: 'volare' })).seen, 'non chi vola');
    // Invisibile: solo vista pura o vista cieca nel raggio.
    const ghost = vC({ id: 'g', kind: 'npc', faction: 'nemici', pos: { x: 7, y: 5 } });
    VC().apply(ghost, { type: 'invisibile' });
    const ctx2 = vCtx(g, [elf, ghost, devil]);
    eq(V().canSee(ctx2, elf, ghost).cause, 'invisibile', 'invisibile: non si vede');
    ok(V().canSee(ctx2, devil, ghost).seen, 'la vista pura lo vede');
    // Accecato: nessuna cella visibile oltre la propria; lo svantaggio viene dalle condizioni, senza doppioni.
    const blind = vC({ id: 'k', pos: { x: 3, y: 3 } });
    VC().apply(blind, { type: 'accecato' });
    const lit = vGrid();
    const v = V().viewOf(vCtx(lit, [blind]), blind);
    eq(v.reduce((s, x) => s + (x ? 1 : 0), 0), 1, 'accecato: solo la propria cella');
    const foe = vC({ id: 'f', kind: 'npc', faction: 'nemici', pos: { x: 4, y: 3 } });
    eq(V().attackVision(vCtx(lit, [blind, foe]), blind, foe).dis, [], 'la visione non ripete «accecato»');
    eq(VC().attackMods(blind, foe, { melee: true, distance: 1 }).mode, 'svantaggio', 'svantaggio dalle condizioni');
  });

  test('Visione: svantaggio al buio, vantaggio contro chi non vede, causa nel log', () => {
    const g = vGrid({ vision: { ambient: 'buio' } });
    const human = vC({ id: 'h', pos: { x: 2, y: 2 } });
    const orc = vC({ id: 'o', kind: 'npc', faction: 'nemici', pos: { x: 3, y: 2 }, senses: { darkvision: 60 } });
    const ctx = vCtx(g, [human, orc]);
    const hv = V().attackVision(ctx, human, orc);
    eq([hv.dis.length, hv.dis[0].startsWith('buio'), hv.adv.length], [1, true, 0], 'l\'umano attacca al buio: svantaggio («buio»)');
    const ov = V().attackVision(ctx, orc, human);
    eq([ov.adv.length, ov.dis.length], [1, 0], 'l\'orco con la scurovisione attacca chi non lo vede: vantaggio');
    const mods = VC().attackMods(human, orc, { melee: true, distance: 1, vision: hv });
    eq([mods.mode, VC().modsText(mods).includes('buio')], ['svantaggio', true], 'attackMods con la visione: causa nel testo');
    // Penombra: nessun effetto sugli attacchi (solo sulla Percezione).
    g.vision.ambient = 'crepuscolo';
    eq(V().attackVision(vCtx(g, [human, orc]), human, orc), { adv: [], dis: [] }, 'penombra: attacco normale');
  });

  test('Visione: luce ambientale per ora e bioma, torcia che si spegne, incantesimi', () => {
    eq([V().ambientLevel('giorno'), V().ambientLevel('crepuscolo'), V().ambientLevel('notte'), V().ambientLevel('buio')], [2, 1, 0, 0]);
    eq([V().ambientLevel('auto', { hour: 12 }), V().ambientLevel('auto', { hour: 6 }), V().ambientLevel('auto', { hour: 23 })], [2, 1, 0], 'dall\'ora');
    eq([V().ambientLevel('auto', { hour: 12, biomeLight: 'penombra' }), V().ambientLevel('auto', { hour: 12, biomeLight: 'buio' })], [1, 0], 'dal bioma (foresta, caverna)');
    eq([V().discoveryRadius(4, 0, false, null), V().discoveryRadius(4, 0, true, null), V().discoveryRadius(4, 0, false, { kind: 'torcia', on: true, minutes: 10 })], [1, 3, 3], 'scoperta al buio, con scurovisione o torcia');
    // La torcia dura un'ora di gioco: si spegne con il tempo (anche a round nel combattimento).
    const pc = vC({ id: 'h', name: 'Mira', pos: { x: 0, y: 0 } });
    V().setCarried(pc, 'torcia', true);
    eq([pc.light.on, pc.light.minutes], [true, 60]);
    eq(V().tickLights(null, [pc], 30), [], 'mezz\'ora: ancora accesa');
    const lines = V().tickLights(null, [pc], 30);
    eq([pc.light.on, lines.length], [false, 1], 'dopo un\'ora si spegne');
    V().setCarried(pc, 'torcia', true);
    eq(pc.light.minutes, 60, 'riaccesa: una torcia nuova');
    // Incantesimi: Oscurità a concentrazione, che svanisce quando la concentrazione finisce.
    const g = vGrid();
    const caster = vC({ id: 'w', name: 'Maga', pos: { x: 1, y: 1 } });
    const spell = { id: 'sp-osc', name: 'Oscurità', concentration: true };
    ok(V().castLight(g, caster, spell, { x: 10, y: 10 }).includes('buio magico'));
    caster.concentration = { spellId: 'sp-osc', name: 'Oscurità', round: 1 };
    eq(V().lightMap(g, [caster], V().sightMap(g)).level[10 * 20 + 10], 0, 'buio magico anche di giorno');
    eq(V().pruneLinked(g, [caster]), [], 'concentrazione attiva: resta');
    caster.concentration = null;
    eq([V().pruneLinked(g, [caster]).length, g.vision.lights.length], [1, 0], 'concentrazione finita: sparisce');
    eq(V().spellEffect({ name: 'Luce' }), { source: 'luce' });
  });

  test('Visione: nebbia manuale, automatica e mista, memoria, stanze e pennelli', () => {
    const g = vGrid({ fog: { enabled: true, mode: 'manuale' }, structures: [vWall('m', 6, 0, 1, 20)] });
    const pc = vC({ id: 'p', pos: { x: 2, y: 2 } });
    const pv = V().playersView(vCtx(g, [pc]));
    eq(V().cellStates(g, pv.cells)[2 * 20 + 3], 0, 'manuale: la visione non rivela');
    V().paintFog(g, V().brushCells(g, 'rettangolo', { x: 0, y: 0 }, { x: 1, y: 1 }), true);
    eq([V().cellStates(g, pv.cells)[0], V().cellStates(g, pv.cells)[1 * 20 + 1], V().cellStates(g, pv.cells)[2]], [2, 2, 0], 'rettangolo rivelato a mano');
    eq(V().brushCells(g, 'cerchio', { x: 10, y: 10 }, { x: 12, y: 10 }).length, 21, 'pennello a cerchio di raggio 2');
    const fill = V().brushCells(g, 'riempi', { x: 2, y: 2 });
    ok(fill.length === 7 * 20 && fill.some((c) => c.x === 6) && !fill.some((c) => c.x === 7), 'riempimento fino al muro (compreso)');
    // Automatica: rivela ciò che vedono i giocatori e lo ricorda.
    g.fog.mode = 'auto';
    eq(V().cellStates(g, pv.cells)[2 * 20 + 3], 2, 'automatica: visibile');
    eq(V().cellStates(g, pv.cells)[2 * 20 + 8], 0, 'dietro il muro no');
    ok(V().remember(g, pv.cells) > 0);
    pc.pos = { x: 10, y: 19 };
    const pv2 = V().playersView(vCtx(g, [pc]));
    eq([V().cellStates(g, pv2.cells)[2 * 20 + 3], V().cellStates(g, pv2.cells)[19 * 20 + 11]], [1, 2], 'memoria: esplorata (velo più tenue)');
    eq(V().cellStates(g, pv2.cells)[0], 1, 'automatica: i ritocchi del master non contano');
    // Mista: visione più ritocchi (nascondere batte la visione).
    g.fog.mode = 'mista';
    V().paintFog(g, [{ x: 11, y: 19 }], false);
    eq([V().cellStates(g, pv2.cells)[19 * 20 + 11], V().cellStates(g, pv2.cells)[0]], [0, 2], 'mista: nascosta a mano, rivelata a mano');
    V().hideAll(g);
    eq([g.fog.seen.includes('1'), g.fog.manual.includes('1')], [false, false], 'Nascondi tutto');
    V().revealAll(g);
    ok(V().cellStates(g, null).every((x) => x === 2), 'Rivela tutto');
    // Stanza: si rivela quando si apre una porta che la tocca (una volta sola).
    const r = vGrid({ fog: { enabled: true, mode: 'manuale' }, vision: { rooms: [{ id: 'st', name: 'Cripta', cells: [{ x: 10, y: 10 }, { x: 11, y: 10 }] }] },
      items: [{ id: 'p', name: 'Porta', otype: 'porta', x: 9, y: 10 }] });
    eq(V().roomsSweep(r, [pc]), [], 'porta chiusa');
    r.items[0].state = 'aperto';
    eq([V().roomsSweep(r, [pc]).length, V().cellStates(r, null)[10 * 20 + 11], r.vision.rooms[0].revealed], [1, 2, true], 'porta aperta: la stanza si rivela');
    eq(V().roomsSweep(r, [pc]), [], 'una volta sola');
  });

  test('Visione: pedine nascoste ai giocatori e visioneGiocatore()', () => {
    const g = vGrid({ fog: { enabled: true, mode: 'auto', ghosts: true }, structures: [vWall('m', 6, 0, 1, 20)],
      items: [{ id: 'tr', name: 'Trappola', otype: 'trappola', x: 3, y: 3, hidden: true }, { id: 'fz', name: 'Forziere', otype: 'forziere', x: 4, y: 3 }, { id: 'fz2', name: 'Forziere lontano', otype: 'forziere', x: 15, y: 3 }] });
    const pc = vC({ id: 'p', pos: { x: 2, y: 2 } });
    const near = vC({ id: 'n', name: 'Goblin', kind: 'npc', faction: 'nemici', pos: { x: 4, y: 4 } });
    const far = vC({ id: 'f', name: 'Orco', kind: 'npc', faction: 'nemici', pos: { x: 10, y: 4 } });
    const pv = V().playersView(vCtx(g, [pc, near, far]));
    eq([pv.seenIds.has('n'), pv.seenIds.has('f')], [true, false], 'il nemico dietro il muro non è visto');
    const out = V().visioneGiocatore({ grid: g, combatants: [pc, near, far] });
    eq(out.combatants.map((c) => c.id), ['p', 'n'], 'pedine: solo quelle che i giocatori vedono');
    eq(out.items.map((i) => i.id), ['fz'], 'oggetti nascosti e celle non rivelate esclusi');
    eq([out.cells.length, out.cells[2 * 20 + 8], out.cells[2 * 20 + 3]], [400, '0', '2'], 'celle: nascoste e visibili');
    ok(!('trap' in out.items[0]) && !('contents' in out.items[0]), 'niente contenuti né trappole');
    // Ultima posizione nota (fantasma): il goblin si sposta dietro il muro.
    V().refreshFog(g, [pc, near, far]);
    near.pos = { x: 12, y: 12 };
    V().refreshFog(g, [pc, near, far]);
    const out2 = V().visioneGiocatore({ grid: g, combatants: [pc, near, far] });
    eq([out2.combatants.map((c) => c.id), out2.ghosts], [['p'], [{ x: 4, y: 4 }]], 'fantasma all\'ultima posizione nota');
    // Senza nebbia: tutto tranne i nascosti.
    g.fog.enabled = false;
    eq(V().visioneGiocatore({ grid: g, combatants: [pc, near, far] }).combatants.length, 3);
  });

  test('Visione UI: nebbia dopo il cambio di tema e di zoom, pedine nascoste nell\'anteprima', () => {
    const g = vGrid({ fog: { enabled: true, mode: 'auto' }, vision: { ambient: 'notte' }, structures: [vWall('m', 6, 0, 1, 20)] });
    const pc = vC({ id: 'p', pos: { x: 2, y: 2 }, light: { kind: 'torcia', on: true, minutes: 60 } });
    const orc = vC({ id: 'o', kind: 'npc', faction: 'nemici', pos: { x: 10, y: 2 } });
    const doc = { grid: g, combatants: [pc, orc] };
    const fake = { requestDraw() {}, tileSnapshot: () => G().gridSnapshot(doc), commitTiles() {}, updateUi() {} };
    const ui = DnD.uiVisione.create({ getDoc: () => doc, widget: () => fake, mode: 'combattimento' });
    const cv = document.createElement('canvas');
    cv.width = cv.height = 300;
    const ctx = cv.getContext('2d');
    const a = ui.compute();
    ui.draw(ctx, { panX: 0, panY: 0, zoom: 1 }, 32);
    ui.draw(ctx, { panX: 15, panY: -8, zoom: 2.5 }, 80);
    ok(ui.compute() === a, 'zoom e pan riusano lo stesso livello (nessun ricalcolo)');
    // Velo del master: cella nascosta al buio, coperta ma non opaca (il master vede tutto).
    const px = (cvs, x, y) => Array.from(cvs.getContext('2d').getImageData(x, y, 1, 1).data);
    const hidden = px(a.shade, 15, 15)[3];
    ok(hidden > 120 && hidden < 255, 'velo semitrasparente sulle celle non rivelate (' + hidden + ')');
    eq(px(a.shade, 2, 3)[3], 0, 'nessun velo nella luce della torcia');
    const root = document.documentElement;
    const prev = root.dataset.theme;
    try {
      root.dataset.theme = prev === 'dark' ? 'light' : 'dark';
      window.dispatchEvent(new Event('themechange'));
      const b = ui.compute();
      ok(b !== a && b.shade, 'cambio di tema: ricalcolato con i colori del tema');
      ok(px(b.shade, 15, 15)[3] === hidden, 'stessa copertura nel nuovo tema');
    } finally {
      if (prev === undefined) delete root.dataset.theme; else root.dataset.theme = prev;
      window.dispatchEvent(new Event('themechange'));
    }
    // Anteprima «come i giocatori»: l'orco dietro il muro non si vede.
    ui.setViewAs('giocatori');
    eq([ui.hideToken(pc), ui.hideToken(orc)], [false, true]);
    ui.setViewAs('master');
    eq(ui.hideToken(orc), false, 'il master vede sempre tutto');
    eq(ui.levelAt(2, 2), 2, 'indicatore della luce sulla pedina');
  });

  test('Visione: prestazioni su una griglia 100×100', () => {
    const structures = [];
    for (let i = 0; i < 12; i++) structures.push(vWall('m' + i, 8 * i + 4, (i * 13) % 60, 1, 30));
    const g = vGrid({ w: 100, h: 100, structures, vision: { ambient: 'notte', lights: [{ id: 'l', x: 50, y: 50, bright: 40, dim: 40 }] }, fog: { enabled: true, mode: 'auto' } });
    const party = [0, 1, 2, 3].map((i) => vC({ id: 'p' + i, pos: { x: 10 + i * 20, y: 80 }, senses: { darkvision: i % 2 ? 60 : 0 }, light: i === 0 ? { kind: 'torcia', on: true, minutes: 60 } : null }));
    const enemies = [0, 1, 2, 3, 4, 5].map((i) => vC({ id: 'e' + i, kind: 'npc', faction: 'nemici', pos: { x: 15 * i + 3, y: 20 } }));
    const t0 = performance.now();
    const r = V().refreshFog(g, party.concat(enemies));
    const ms = performance.now() - t0;
    ok(r.explored > 0, 'celle esplorate');
    ok(ms < 1500, 'ricalcolo della nebbia in ' + Math.round(ms) + ' ms');
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) V().signature(g, party.concat(enemies));
    ok(performance.now() - t1 < 500, 'firma per il ricalcolo a richiesta');
  });

  test('Visione: salvataggio, migrazione v17 → v18, copie e ridimensionamento', () => {
    // Griglie e combattenti precedenti: nebbia spenta, giorno, nessuna sorgente, nulla cambia.
    const st = DnD.dati.normalizeState({ version: 17, races: [], npcs: [], players: [], structures: [{ id: 's', name: 'Muro', w: 3, h: 1 }],
      savedGrids: [{ id: 'g', name: 'Vecchia', w: 10, h: 10, structures: [{ id: 'm', name: 'Muro', x: 1, y: 1, w: 3, h: 1, cells: '111' }], fog: { enabled: true, seen: '1'.repeat(100) } }] });
    const g = st.savedGrids[0];
    eq([g.vision.ambient, g.vision.lights.length, g.fog.mode, g.fog.seen.length, g.structures[0].blocksSight], ['giorno', 0, 'mista', 100, true], 'griglia v17');
    ok(st.structures.some((x) => x.name === 'Finestra' && !x.blocksSight) && st.mapObjects.some((x) => x.name === 'Braciere' && x.light), 'esempi agli archivi migrati');
    eq(st.structures.find((x) => x.id === 's').blocksSight, true, 'le strutture esistenti bloccano la vista');
    // Salvataggio: tutto passa la normalizzazione.
    const full = vGrid({ vision: { ambient: 'notte', stepped: true, lights: [{ id: 'l', x: 3, y: 3, kind: 'torcia', minutes: 30 }], sight: '1'.repeat(5), rooms: [{ id: 'r', name: 'Sala', cells: [{ x: 1, y: 1 }] }] },
      fog: { enabled: true, mode: 'auto', manual: '12', opacity: 0.7, ghosts: true, lastKnown: { e1: { x: 2, y: 2 } } } });
    const again = DnD.dati.normalizeSavedGrid(JSON.parse(JSON.stringify(full)));
    eq([again.vision, again.fog], [full.vision, full.fog], 'salvataggio e ripristino');
    // Combattente: sensi e sorgente.
    const c = DnD.dati.normalizeCombatant({ id: 'x', name: 'X', maxHp: 5, senses: { darkvision: 60 }, light: { kind: 'lanterna', on: false } });
    eq([c.senses.darkvision, c.light], [60, { kind: 'lanterna', on: false, minutes: 360 }]);
    eq(DnD.dati.normalizeCombatant({ id: 'y', name: 'Y', maxHp: 5 }).light, null, 'combattenti precedenti: nessuna sorgente');
    // Dalla razza (metri) e dal Percorso leggendario.
    eq(V().sensesFromRace({ darkvision: 18 }).darkvision, 60);
    eq(V().sensesOf({ senses: {}, legend: { senses: { 'vista pura': 9 } } }).truesight, 30, 'sensi del Percorso leggendario');
    // Copia nel combattimento e ritorno con «Salva come nuova griglia».
    const combat = { grid: { structures: [], items: [], labels: [], zones: [], tileMap: null }, combatants: [] };
    G().applySavedGrid(combat, full, DnD.dadi.uid);
    combat.grid.vision.ambient = 'giorno';
    eq(full.vision.ambient, 'notte', 'il combattimento lavora su una copia');
    eq(G().createSavedGrid(combat, 'Copia', 'n', null).vision.lights.length, 1);
    // Ridimensionamento: sorgenti e celle seguono.
    const r = G().resizeGrid(full, 22, 20, { x: 'sinistra', y: 'sotto' }).grid;
    eq([r.vision.lights[0].x, r.vision.sight.slice(0, 7), r.fog.manual.slice(0, 4)], [5, '0011111', '0012'], 'ridimensionata a sinistra');
    // Annulla/Ripeti con la visione.
    const doc = { grid: full, combatants: [] };
    const snap = G().gridSnapshot(doc);
    full.vision.lights = [];
    G().restoreSnapshot(doc, snap);
    eq(full.vision.lights.length, 1, 'annulla una sorgente tolta');
  });

  test('Magie: esporta e importa un file di incantesimi, saltando i nomi già presenti', () => {
    const lib = [DnD.dati.normalizeSpell({ id: 'a', name: 'Dardo di fuoco', level: 0 })];
    const file = DnD.magie.exportFile([DnD.dati.normalizeSpell({ id: 'b', name: 'Guida', level: 0, concentration: true }),
      DnD.dati.normalizeSpell({ id: 'c', name: 'Cura ferite', level: 1, effect: { type: 'cura', dice: '1d8', upcastDice: '1d8', addMod: true } })], 'Prova');
    eq(file.kind, 'incantesimi');
    const r = DnD.magie.importFile(JSON.parse(JSON.stringify(file)).spells.concat({ name: ' dardo di FUOCO ' }, { name: 'Guida' }), lib, DnD.dati.normalizeSpell);
    eq([r.added.map((s) => s.name), r.skipped], [['Guida', 'Cura ferite'], ['dardo di FUOCO', 'Guida']], 'duplicati saltati, anche nel file');
    ok(r.added.every((s) => s.id !== 'b' && s.id !== 'c'), 'id nuovi');
    eq([r.added[0].concentration, r.added[1].effect.type, r.added[1].effect.dice], [true, 'cura', '1d8'], 'normalizzati');
    eq(DnD.magie.importFile(file, [], DnD.dati.normalizeSpell).added.length, 2, 'file esportato');
    let err = '';
    try { DnD.magie.importFile({ kind: 'creatura' }, [], DnD.dati.normalizeSpell); } catch (e) { err = e.message; }
    ok(err.includes('incantesimi'), 'file sbagliato: errore in italiano');
  });

  // ---------- Gioco online (trasporto in memoria) ----------
  const NET = () => DnD.rete;
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  // Archivio con un combattimento: Mira (giocatrice), un goblin visibile, un assassino nascosto, un boss non rivelato,
  // un forziere con contenuto, una trappola nascosta e note del master.
  function onlineState() {
    const st = DnD.dati.emptyState();
    const se = S().current(st);
    se.notes = 'NOTA-SEGRETA del master';
    st.players.push(Object.assign(DnD.dati.normalizeCreature({ id: 'pg1', name: 'Mira', classId: 'guerriero', maxHp: 25 }, true), { sessionId: se.id }));
    const c = (o) => Object.assign({ kind: 'npc', faction: 'nemici', hp: 7, maxHp: 7, initiative: 10, w: 1, h: 1 }, o);
    se.combat = DnD.dati.normalizeCombat({
      id: 'cmb', phase: 'attivo', round: 2, currentId: 'p1',
      combatants: [
        c({ id: 'p1', sourceId: 'pg1', name: 'Mira', kind: 'player', faction: 'giocatori', hp: 20, maxHp: 25, initiative: 15, pos: { x: 1, y: 1 } }),
        c({ id: 'g1', name: 'Goblin', hp: 4, initiative: 12, pos: { x: 3, y: 1 } }),
        c({ id: 'h1', name: 'Assassino', hp: 33, maxHp: 33, hidden: true, pos: { x: 8, y: 8 } }),
        c({ id: 'b1', name: 'Drago', hp: 90, maxHp: 120, initiative: 5, pos: { x: 6, y: 1 } }),
      ],
      grid: { w: 12, h: 12, items: [
        Object.assign(DnD.oggettiMappa.instantiate(st.mapObjects.find((o) => o.otype === 'forziere') || st.mapObjects[0], 'fz'), { x: 2, y: 3, contents: [{ equipmentId: 'eq-spada-lunga', qty: 1 }], notes: 'TESORO-SEGRETO' }),
        { id: 'tr', name: 'Trappola', otype: 'trappola', x: 4, y: 4, hidden: true },
      ] },
      log: [
        { round: 1, type: 'colpito', text: 'Mira colpisce Goblin: 7 → 4 PF.' },
        { round: 1, type: 'ia', text: 'Piano: il Drago punta Mira.' },
        { round: 1, type: 'sistema', text: 'Assassino si avvicina nell\'ombra.' },
        { round: 2, type: 'sistema', text: '👑 Drago entra nella FASE 2 — Furia. Nota del master: soffio al prossimo turno.' },
      ],
    });
    se.combat.combatants.find((x) => x.id === 'b1').boss = { title: 'Signore della cenere', theme: 'fuoco', phase: 0, revealed: false, defeated: false };
    return st;
  }
  // Master e giocatore collegati in memoria; il master accetta subito come Mira.
  async function onlinePair(st, opts) {
    const o = opts || {};
    const [a, b] = NET().trasporto.coppiaMemoria(o.trasporto);
    const inviati = [];
    const inv = b.invia;
    b.invia = (t) => { inviati.push(t); return inv(t); };
    const ricevuti = { chat: [], dadi: [], fine: [], errori: [] };
    const m = NET().sessione.master(Object.assign({ nome: 'Dario', stato: () => st, suRichiesta: (r) => (o.richiesta ? o.richiesta(r) : r.accetta({ personaggioId: 'pg1' })),
      suChat: (x) => ricevuti.chat.push(x), suDado: (x) => ricevuti.dadi.push(x) }, o.master));
    m.collega(b);
    const g = NET().sessione.giocatore(Object.assign({ nome: o.nome || 'Ale', colore: '#aa3355', trasporto: a, suChat: (x) => ricevuti.chat.push(x), suDado: (x) => ricevuti.dadi.push(x),
      suFine: (x) => ricevuti.fine.push(x), suErrore: (x) => ricevuti.errori.push(x) }, o.giocatore));
    await pausa();
    return { m, g, a, b, inviati, ricevuti };
  }

  test('Online: il filtro non invia mai dati nascosti (contenuto dei messaggi)', async () => {
    const st = onlineState();
    const { g, inviati } = await onlinePair(st);
    eq(g.stato().stato, 'attivo', 'giocatore accettato');
    const testo = inviati.join('\n');
    for (const segreto of ['NOTA-SEGRETA', 'TESORO-SEGRETO', 'Assassino', 'Trappola', 'Signore della cenere', 'Piano:', 'soffio al prossimo turno', 'eq-spada-lunga', '"hp"', '"why"']) {
      ok(!testo.includes(segreto), 'non deve partire: ' + segreto);
    }
    const v = g.stato().vista.combattimento;
    eq(v.pedine.map((p) => p.id), ['p1', 'g1', 'b1'], 'pedine non nascoste, in ordine di iniziativa');
    const gob = v.pedine.find((p) => p.id === 'g1');
    eq([gob.salute, 'pf' in gob, v.pedine[0].pf, v.pedine[0].mia], ['ferito', false, 20, true], 'nemico: solo la salute a parole; la propria pedina con i PF');
    eq(v.log.map((r) => r.testo), ['Mira colpisce Goblin: ferito.', '👑 Drago entra nella FASE 2 — Furia.'], 'log filtrato');
    eq([v.boss, g.stato().vista.scheda.nome, v.griglia.items.map((i) => i.id)], [[], 'Mira', ['fz']], 'boss non rivelato, scheda propria, oggetti visibili');
    // Rivelato il boss, con l'opzione dei PF dei nemici: arriva come evento incrementale.
    const b1 = S().current(st).combat.combatants.find((x) => x.id === 'b1');
    b1.boss.revealed = true;
    const { m: m2, g: g2 } = await onlinePair(st, { master: { pfNemici: true } });
    eq([g2.stato().vista.combattimento.boss[0].titolo, g2.stato().vista.combattimento.pedine.find((p) => p.id === 'g1').pf], ['Signore della cenere', 4]);
    ok(m2.giocatori().length === 1);
  });

  test('Online: eventi incrementali, evento perso e nuova istantanea', async () => {
    const st = onlineState();
    let perdi = false;
    const { m, g } = await onlinePair(st, { trasporto: { perdi: (t) => perdi && t.includes('"tipo":"evento"') } });
    const c = S().current(st).combat;
    c.combatants[1].pos = { x: 4, y: 2 };
    c.combatants[1].hp = 1;
    DnD.dati.pushLog(c, 'colpito', 'Mira colpisce Goblin: 4 → 1 PF.');
    m.aggiorna();
    await pausa();
    const v = g.stato().vista.combattimento;
    eq([v.pedine[1].pos, v.pedine[1].salute, v.log[v.log.length - 1].testo, g.stato().n], [{ x: 4, y: 2 }, 'grave', 'Mira colpisce Goblin: grave.', 2], 'movimento, PF e log');
    // Un evento si perde: al successivo il giocatore chiede di nuovo l'istantanea.
    perdi = true;
    c.currentId = 'g1';
    m.aggiorna();
    await pausa();
    perdi = false;
    c.round = 3;
    m.aggiorna();
    await pausa();
    eq(g.stato().vista, m.vistaInviata(g.stato().id), 'ricomposta dall\'istantanea');
    eq([g.stato().vista.combattimento.turno, g.stato().vista.combattimento.round], ['g1', 3]);
    // Fine del combattimento: struttura diversa, nuova istantanea.
    S().current(st).combat = null;
    m.aggiorna();
    await pausa();
    eq(g.stato().vista.combattimento, null);
  });

  test('Online: messaggi malformati, troppo grandi, troppo frequenti e versione incompatibile', async () => {
    const P = NET().protocollo;
    eq(P.decodifica('{non json', 'g').ok, false);
    eq(P.decodifica(JSON.stringify({ versione: 1, tipo: 'istantanea', id: 'x', seq: 1, dati: { n: 1, vista: {} } }), 'g').ok, false, 'un giocatore non manda istantanee');
    eq(P.decodifica(JSON.stringify({ versione: 1, tipo: 'chat', id: 'x', seq: 1, dati: { testo: 5 } }), 'g').ok, false, 'schema');
    ok(P.decodifica('x'.repeat(P.LIMITI.daGiocatore + 1), 'g').grande, 'troppo grande');
    const inc = P.decodifica(JSON.stringify({ versione: 99, tipo: 'chat', id: 'x', seq: 1, dati: {} }), 'm');
    eq([inc.ok, inc.incompatibile, inc.versione], [false, true, 99]);
    const lim = P.limitatore(3, 1);
    eq([lim.consenti(0), lim.consenti(0), lim.consenti(0), lim.consenti(0), lim.consenti(1000)], [true, true, true, false, true]);
    // Sulla sessione: il master risponde con un errore e ignora i messaggi in eccesso.
    const st = onlineState();
    const { a, ricevuti, m } = await onlinePair(st);
    a.invia('{rotto');
    for (let i = 0; i < 80; i++) a.invia(P.codifica(P.crea('chat', { testo: 'spam ' + i }, 100 + i)));
    await pausa();
    ok(ricevuti.errori.some((e) => e.includes('rifiutato')), 'errore per il messaggio rotto');
    ok(ricevuti.errori.some((e) => e.includes('Troppi messaggi') || e.includes('troppo in fretta')), 'limite di frequenza');
    ok(ricevuti.chat.length <= 6, 'la chat in eccesso non arriva al master');
    eq(m.giocatori()[0].stato, 'attivo', 'il giocatore resta collegato');
    // Versione incompatibile: il giocatore chiude con un messaggio chiaro.
    const [x, y] = NET().trasporto.coppiaMemoria();
    const fine = [];
    NET().sessione.giocatore({ nome: 'Vecchio', colore: '#112233', trasporto: x, suFine: (t) => fine.push(t) });
    y.invia(JSON.stringify({ versione: 99, tipo: 'benvenuto', id: 'z', seq: 1, dati: {} }));
    await pausa();
    ok(fine[0] && fine[0].includes('Versione incompatibile'), 'versione incompatibile');
  });

  test('Online: codici con e senza compressione, scadenza e uso singolo', async () => {
    const K = NET().codici;
    const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' + 'a=candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host\r\n'.repeat(4);
    const inv = K.invito(sdp, 'Dario', 1000);
    const semplice = await K.codifica(inv, { comprimi: false });
    ok(semplice.startsWith('SF1p.'), 'senza compressione');
    eq(await K.decodifica(semplice), inv);
    if (K.comprimibile()) {
      const z = await K.codifica(inv);
      ok(z.startsWith('SF1z.') && z.length < semplice.length, 'compresso e più corto');
      eq(await K.decodifica(' ' + z + '\n'), inv, 'spazi ignorati');
    }
    let err = '';
    try { await K.decodifica('SF1p.@@@'); } catch (e) { err = e.message; }
    ok(err.includes('Codice non valido'), err);
    try { await K.decodifica(semplice.slice(0, -10)); err = ''; } catch (e) { err = e.message; }
    ok(err.includes('danneggiato'), 'codice tagliato: ' + err);
    K.verifica(inv, 'invito', 1000 + K.DURATA - 1);
    try { K.verifica(inv, 'invito', 1000 + K.DURATA + 1); err = ''; } catch (e) { err = e.message; }
    ok(err.includes('scaduto'), err);
    try { K.verifica(inv, 'risposta', 1000); err = ''; } catch (e) { err = e.message; }
    ok(err.includes('codice di invito'), err);
    const reg = K.registro();
    reg.usa(inv.id);
    try { reg.usa(inv.id); err = ''; } catch (e) { err = e.message; }
    ok(err.includes('già usato'), err);
    eq(NET().segnalazione.candidati(sdp + 'a=candidate:2 1 udp 1 203.0.113.9 6000 typ srflx raddr 0.0.0.0 rport 0\r\n'), { locali: 4, stun: 1, relay: 0, mdns: 0, totale: 5 });
    eq(NET().segnalazione.giudizio({ locali: 2, stun: 0, relay: 0, mdns: 0, totale: 2 }).livello, 'giallo');
  });

  test('Online: chat sanificata e messaggi privati', async () => {
    const P = NET().protocollo;
    eq(P.pulisciTesto('  ciao‮\u0007 <b>a</b>\n\n\n\nfine ', 500), 'ciao <b>a</b>\n\nfine', 'controlli e direzionali tolti, HTML lasciato come testo');
    eq(P.pulisciTesto('x'.repeat(900), 500).length, 500);
    const st = onlineState();
    const p1 = await onlinePair(st);
    p1.g.chat('Ciao​ a tutti');
    p1.g.chat('Solo per te', true);
    p1.g.chat('   ');
    await pausa();
    eq(p1.ricevuti.chat.map((c) => [c.da, c.testo, c.privato]), [['Ale', 'Ciao a tutti', false], ['Ale', 'Solo per te', true]]);
    p1.m.chat('Benvenuti');
    await pausa();
    eq(p1.ricevuti.chat[2].testo, 'Benvenuti');
  });

  test('Online: dado libero del giocatore (tiri convalidati spenti, segnato come non verificato)', async () => {
    const st = onlineState();
    const { g, ricevuti } = await onlinePair(st, { master: { convalidati: false } });
    const rec = D().registratore(seq(17, 3));
    R().rollSave({ bonus: 2, mode: 'vantaggio', dc: null }, rec.rng);
    const tiro = rec.tiro('d20 con vantaggio', 'menu', { totale: 19 });
    g.dado(tiro);
    await pausa();
    eq(ricevuti.dadi.length, 1);
    eq([ricevuti.dadi[0].da, ricevuti.dadi[0].tiro, ricevuti.dadi[0].verificato], ['Ale', D().normalizeTiro(tiro), false], 'stessi dadi e stesso totale, non verificato');
  });

  test('Online: immagini a pezzi con impronta e cache', async () => {
    const IM = NET().immagini;
    const big = 'data:image/png;base64,' + 'A'.repeat(40000);
    const id = IMG().imageId(big);
    const pz = IM.pezzi(id, big);
    eq(pz.length, 3, 'pezzi da 16 KB');
    const r = IM.ricevitore();
    eq([r.aggiungi(pz[2]), r.aggiungi(pz[0])], [null, null]);
    eq(r.aggiungi(pz[1]), { id, data: big }, 'ricomposta in qualsiasi ordine');
    const r2 = IM.ricevitore();
    let err = '';
    try { IM.pezzi('img-x', big).forEach((p) => r2.aggiungi(p)); } catch (e) { err = e.message; }
    ok(err.includes('impronta'), 'impronta verificata');
    try { IM.pezzi(id, 'data:image/png;base64,' + 'A'.repeat(NET().protocollo.LIMITI.immagine)); err = ''; } catch (e) { err = e.message; }
    ok(err.includes('troppo grande'), 'limite di dimensione');
    // Sessione: l'icona della giocatrice viaggia a parte e finisce nella cache; la seconda volta non si scarica.
    const st = onlineState();
    S().current(st).combat.combatants[0].icon = { kind: 'image', image: PNG, color: '#3366aa' };
    const cache = new Map();
    const archivio = { ha: async (x) => cache.has(x), metti: async (x, d) => { cache.set(x, d); } };
    const p = await onlinePair(st, { giocatore: { archivio } });
    await pausa(10);
    eq([...cache.keys()], [IMG().imageId(PNG)], 'icona ricevuta e conservata');
    ok(p.inviati.filter((t) => t.includes('"tipo":"istantanea"')).every((t) => !t.includes('base64')), 'il data URL non è nell\'istantanea');
    ok(!JSON.stringify(p.g.stato().vista).includes('base64'), 'la vista contiene solo l\'impronta');
    const p2 = await onlinePair(st, { giocatore: { archivio } });
    await pausa(10);
    ok(!p2.inviati.some((t) => t.includes('"tipo":"immagine"')), 'già in cache: nessun pezzo');
    // Immagini non della vista: rifiutate.
    p2.a.invia(NET().protocollo.codifica(NET().protocollo.crea('chiediImmagini', { ids: ['img-0000000000000000'] }, 50)));
    await pausa(10);
    ok(p2.ricevuti.errori.some((e) => e.includes('non disponibile')), 'solo le immagini della propria vista');
  });

  test('Online: espulsione, rifiuto, rientro con lo stesso nome e fine sessione', async () => {
    const st = onlineState();
    const p = await onlinePair(st);
    const id = p.g.stato().id;
    // Il giocatore cade: il master lo vede disconnesso, poi rientra con un nuovo collegamento e lo stesso nome.
    p.a.chiudi();
    await pausa();
    eq(p.m.giocatori()[0].stato, 'disconnesso');
    const [a2, b2] = NET().trasporto.coppiaMemoria();
    const m = p.m;
    m.collega(b2);
    const g2 = NET().sessione.giocatore({ nome: 'ale ', colore: '#000000', trasporto: a2 });
    await pausa();
    eq([g2.stato().stato, g2.stato().id, g2.stato().colore], ['attivo', id, '#aa3355'], 'stesso id e colore di prima');
    eq(m.giocatori().filter((x) => x.stato === 'attivo').length, 1, 'un solo giocatore attivo');
    // Espulsione.
    const fine = [];
    const st2 = onlineState();
    const q = await onlinePair(st2, { giocatore: { suFine: (t) => fine.push(t) } });
    q.m.espelli(q.g.stato().id, 'Basta così.');
    await pausa();
    eq([q.g.stato().stato, fine[0], q.m.giocatori().length], ['espulso', 'Basta così.', 0]);
    // Rifiuto.
    const r = await onlinePair(onlineState(), { richiesta: (x) => x.rifiuta() });
    eq(r.g.stato().stato, 'rifiutato');
    // Fine sessione.
    const z = await onlinePair(onlineState());
    z.m.termina();
    await pausa();
    eq([z.g.stato().stato, z.ricevuti.fine[0].includes('La sessione è terminata')], ['finito', true]);
  });

  test('Online: battito, latenza e silenzio del master', async () => {
    let ora = 1000;
    const st = onlineState();
    const p = await onlinePair(st, { master: { ora: () => ora }, giocatore: { ora: () => ora } });
    ora += 50;
    p.m.battito();
    await pausa();
    eq(p.g.linea(), 'verde');
    ora += 120;
    p.g.battito();
    await pausa();
    eq([p.g.stato().latenza, p.m.giocatori()[0].linea], [0, 'verde'], 'latenza misurata');
    ora += 10000;
    eq(p.g.linea(), 'giallo', 'silenzio: giallo');
    ora += 15000;
    p.g.battito();
    // Tappa 3: con il gettone la sessione non finisce, il collegamento risulta perso (si può rientrare).
    eq([p.g.stato().stato, p.g.stato().motivo.includes('non risponde')], ['persa', true], 'master in silenzio: connessione persa');
  });

  test('Online: due giocatori seguono un turno completo', async () => {
    const st = onlineState();
    const [a1, b1] = NET().trasporto.coppiaMemoria();
    const [a2, b2] = NET().trasporto.coppiaMemoria();
    const m = NET().sessione.master({ nome: 'Dario', stato: () => st, suRichiesta: (r) => r.accetta({ personaggioId: r.nome === 'Ale' ? 'pg1' : null }) });
    m.collega(b1);
    m.collega(b2);
    const chat = [];
    const g1 = NET().sessione.giocatore({ nome: 'Ale', colore: '#aa3355', trasporto: a1 });
    const g2 = NET().sessione.giocatore({ nome: 'Bea', colore: '#33aa55', trasporto: a2, suChat: (x) => chat.push(x) });
    await pausa();
    eq([g1.stato().stato, g2.stato().stato, g2.stato().presenza.length], ['attivo', 'attivo', 3], 'master e due giocatori');
    eq([g1.stato().vista.scheda.nome, g2.stato().vista.scheda], ['Mira', null], 'scheda solo a chi ha il personaggio');
    // Turno di Mira: si muove, colpisce, passa il turno al goblin.
    const c = S().current(st).combat;
    c.combatants[0].pos = { x: 2, y: 1 };
    m.aggiorna();
    c.combatants[1].hp = 0;
    DnD.dati.pushLog(c, 'a-terra', 'Goblin è a terra!');
    m.aggiorna();
    c.currentId = 'b1';
    m.aggiorna();
    g1.chat('Fatto!');
    await pausa();
    for (const g of [g1, g2]) {
      const v = g.stato().vista.combattimento;
      eq([v.pedine[0].pos, v.pedine[1].salute, v.turno, v.log[v.log.length - 1].testo, g.stato().n], [{ x: 2, y: 1 }, 'a terra', 'b1', 'Goblin è a terra!', 4]);
    }
    eq(chat.map((x) => x.da + ': ' + x.testo), ['Ale: Fatto!'], 'la chat arriva all\'altro giocatore');
  });

  // ---------- Gioco online, tappa 2: intenzioni convalidate dal master ----------
  // Partita di prova: Mira (Ale, guerriera di 5° livello, spada, arco e due incantesimi) e Bea (Bice) nel party,
  // un goblin accanto a Mira, un orco lontano, un'ombra nascosta e un muro. Il master usa l'esecutore vero del
  // Combattimento (DnD.uiCombattimento.online) su un archivio di prova; i dadi del master sono deterministici.
  const SP = (o) => DnD.dati.normalizeSpell(Object.assign({ level: 1, school: 'invocazione', castingTime: '1 azione', range: '18 metri', duration: 'Istantanea' }, o));
  function partitaState() {
    const st = DnD.dati.emptyState();
    const se = S().current(st);
    const pg = (id, name, extra) => Object.assign(DnD.dati.normalizeCreature(Object.assign({ id, name, classId: 'guerriero', level: 1, maxHp: 30 }, extra), true), { sessionId: se.id });
    st.players.push(pg('pg1', 'Mira', { level: 5 }), pg('pg2', 'Bea'));
    st.players[0].inventory = [{ id: 'i1', equipmentId: st.equipment[0].id, qty: 3 }];
    const arco = st.equipment.find((e) => e.weapon && e.weapon.kind === 'distanza' && e.weapon.rangeLong);
    const c = (x) => Object.assign({ kind: 'npc', faction: 'nemici', hp: 10, maxHp: 10, ac: 12, initiative: 10, w: 1, h: 1 }, x);
    se.combat = DnD.dati.normalizeCombat({
      id: 'cmb', phase: 'attivo', round: 1, currentId: 'x1',
      combatants: [
        c({ id: 'x1', sourceId: 'pg1', name: 'Mira', kind: 'player', faction: 'giocatori', hp: 30, maxHp: 30, initiative: 20, pos: { x: 1, y: 1 },
          weapons: [{ id: 'spada', name: 'Spada', toHit: 5, damageDice: '1d8', damageBonus: 3, damageType: 'tagliente' }, { id: 'arco', name: 'Arco', toHit: 5, damageDice: '1d6', equipmentId: arco.id }],
          spellcasting: { attack: 5, dc: 13, slotsTotal: [2, 0, 0, 0, 0, 0, 0, 0, 0], slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], spells: [
            SP({ id: 'sp-fuoco', name: 'Vampata', effect: { type: 'salvezza', dice: '2d6', damageType: 'fuoco', saveAbility: 'DES', halfOnSave: true } }),
            SP({ id: 'sp-scudo', name: 'Scudo arcano', range: 'Sé', concentration: true, effect: { type: 'nessuno' } }),
            SP({ id: 'sp-vicino', name: 'Tocco gelido', level: 0, range: 'Contatto', effect: { type: 'attacco', dice: '1d8', damageType: 'necrotico' } })] } }),
        c({ id: 'x2', sourceId: 'pg2', name: 'Bea', kind: 'player', faction: 'giocatori', hp: 20, maxHp: 20, initiative: 15, pos: { x: 1, y: 3 },
          weapons: [{ id: 'mazza', name: 'Mazza', toHit: 4, damageDice: '1d6', damageBonus: 2 }] }),
        c({ id: 'g1', name: 'Goblin', initiative: 12, pos: { x: 2, y: 1 } }),
        c({ id: 'g2', name: 'Orco', initiative: 5, pos: { x: 8, y: 1 } }),
        c({ id: 'h1', name: 'Ombra', hidden: true, initiative: 4, pos: { x: 1, y: 6 } }),
      ],
      grid: { w: 12, h: 10, structures: [vWall('muro', 4, 3, 1, 7)] },
      log: [],
    });
    return st;
  }
  // Archivio di prova (al posto di IndexedDB): update applica e avvisa la sessione online, come l'app.
  const archivioProva = (st) => ({ state: st, onChange: null, update(fn) { fn(this.state); if (this.onChange) this.onChange(); return Promise.resolve({ ok: true }); }, save() { return Promise.resolve({ ok: true }); } });
  // Master e giocatori collegati in memoria: Ale gioca Mira, Bice gioca Bea. fn riceve la partita; l'archivio
  // dell'app e i dadi dell'esecutore tornano come prima alla fine.
  async function partita(fn, opts) {
    const o = opts || {};
    const st = o.st || partitaState();
    const prevStore = DnD.store;
    const E = DnD.uiCombattimento.online;
    DnD.store = archivioProva(st);
    const esiti = [];
    const dadi = { master: [], Ale: [], Bice: [] };
    const extra = { ping: [], rivela: [], offerte: [], richieste: [], gettoni: [], fine: [], errori: [], violazioni: [], domande: [] };
    const m = NET().sessione.master(Object.assign({
      nome: 'Dario', stato: () => DnD.store.state, aggiornaStato: (f) => DnD.store.update(f), esecutore: E, regole: () => RULES1,
      suRichiesta: (r) => r.accetta({ personaggioId: r.nome === 'Ale' ? 'pg1' : 'pg2' }),
      suDado: (x) => dadi.master.push(x), suViolazione: (v) => extra.violazioni.push(v), suDomanda: (d) => extra.domande.push(d),
    }, o.master));
    DnD.store.onChange = () => m.aggiorna();
    const inviati = [];
    const unisci = (nome, gopts) => {
      const [a, b] = NET().trasporto.coppiaMemoria();
      const inv = b.invia;
      b.invia = (t) => { inviati.push({ a: nome, t }); return inv(t); };
      m.collega(b);
      const g = NET().sessione.giocatore(Object.assign({
        nome, colore: '#aa3355', trasporto: a, suEsito: (e) => esiti.push(Object.assign({ chi: nome }, e)), suDado: (x) => dadi[nome] && dadi[nome].push(x),
        suPing: (p) => extra.ping.push([nome, p]), suRivela: (r) => extra.rivela.push([nome, r]), suOfferta: (f) => extra.offerte.push([nome, f]),
        suRichiestaTiro: (r) => extra.richieste.push([nome, r]), suGettone: (t) => extra.gettoni.push([nome, t]), suFine: (t) => extra.fine.push([nome, t]), suErrore: (t) => extra.errori.push([nome, t]),
      }, gopts));
      g.a = a;
      return g;
    };
    const ale = unisci('Ale');
    const bice = o.soloAle ? null : unisci('Bice');
    await pausa();
    // Chiede e aspetta l'esito (eseguita, rifiutata o attesa).
    const chiedi = async (g, tipo, dati) => { const id = g.intenzione(tipo, dati); await pausa(); return esiti.filter((e) => e.id === id).pop() || null; };
    try {
      await fn({ st, m, E, ale, bice, esiti, dadi, extra, inviati, chiedi, unisci, c: () => S().current(DnD.store.state).combat, x: (id) => S().current(DnD.store.state).combat.combatants.find((y) => y.id === id) });
    } finally {
      E.dadiDiProva(null);
      DnD.store = prevStore;
    }
  }

  test('Online 2: intenzioni di movimento valide e non valide, cella per cella', async () => {
    await partita(async ({ ale, bice, chiedi, x, extra, m }) => {
      let e = await chiedi(bice, 'muovi', { combattenteId: 'x2', celle: [{ x: 1, y: 4 }] });
      eq([e.stato, e.testo], ['rifiutata', 'Non è il tuo turno.'], 'fuori turno');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x2', celle: [{ x: 1, y: 4 }] });
      eq(e.testo, 'Puoi agire solo con il tuo personaggio.', 'pedina altrui');
      ok(m.registro().some((v) => v.tipo === 'altrui' && v.grave && v.nome === 'Ale'), 'registrato come violazione');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 1, y: 2 }, { x: 3, y: 3 }] });
      eq(e.testo, 'Non puoi andare lì.', 'salto di due celle: percorso non continuo');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 2, y: 2 }] });
      eq(e.testo, 'Non puoi andare lì.', 'diagonale che taglia l\'angolo accanto al goblin');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }] });
      eq([e.stato, x('x1').pos, DnD.movimento.left(x('x1'), RULES1, 5)], ['eseguita', { x: 3, y: 2 }, 3], 'percorso valido: 3 celle');
      eq(bice.stato().vista.combattimento.pedine.find((p) => p.id === 'x1').pos, { x: 3, y: 2 }, 'l\'altro giocatore vede lo spostamento');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 4, y: 3 }] });
      eq([e.stato, e.testo, x('x1').pos], ['rifiutata', 'Non puoi andare lì.', { x: 3, y: 2 }], 'cella bloccata dal muro');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 }, { x: 3, y: 8 }] });
      eq([e.stato, e.avviso, x('x1').pos], ['eseguita', 'Movimento esaurito: ti fermi dopo 3 celle.', { x: 3, y: 5 }], 'oltre il residuo: si ferma all\'ultima cella valida');
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 3, y: 6 }] });
      eq(e.testo, 'Movimento residuo insufficiente: 0 celle.');
      // Pedina nascosta sul percorso: rifiuto senza rivelare nulla.
      x('x1').movement = null;
      x('x1').pos = { x: 1, y: 4 };
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 1, y: 5 }, { x: 1, y: 6 }, { x: 1, y: 7 }] });
      eq([e.avviso, x('x1').pos], ['Non puoi andare oltre: ti fermi prima.', { x: 1, y: 5 }], 'si ferma prima dell\'ombra');
      ok(!JSON.stringify(e).includes('Ombra'), 'nessun nome nascosto nella risposta');
      // Condizione che azzera la velocità.
      DnD.condizioni.apply(x('x1'), { type: 'afferrato' });
      e = await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 2, y: 5 }] });
      ok(e.testo.startsWith('Non puoi muoverti: afferrato'), e.testo);
      eq(extra.errori, []);
    });
  });

  test('Online 2: percorso verificato cella per cella (terreno difficile, angoli, salti)', () => {
    const m = mkC({ id: 'm', pos: { x: 0, y: 0 } });
    const st = aiState([m]);
    const mud = openMap(20, 20, Array.from({ length: 20 }, (_, y) => [G().key(2, y), 2]));
    const r = MV().walk(mud, st, m, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], 6, { rules: RULES1 });
    eq([r.end, r.cost, r.stopped], [{ x: 3, y: 0 }, 4, false], 'il fango costa 2');
    const r2 = MV().walk(mud, st, m, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], 2, { rules: RULES1 });
    eq([r2.end, r2.reason], [{ x: 1, y: 0 }, 'residuo'], 'il fango supera il residuo');
    const muro = openMap(20, 20, [], [G().key(1, 0)]);
    eq(MV().walk(muro, st, m, [{ x: 1, y: 1 }, { x: 2, y: 0 }], 6, { rules: RULES1 }).reason, 'bloccato', 'angolo tagliato vicino al muro');
    eq(MV().walk(openMap(20, 20), st, m, [{ x: 5, y: 5 }], 6, { rules: RULES1 }).reason, 'percorso', 'salto');
  });

  test('Online 2: attacco con portata, gittata, linea di vista, vantaggio per condizioni, critico e Attacco extra', async () => {
    await partita(async ({ ale, chiedi, x, c, E, dadi, inviati }) => {
      let e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g2', armaId: 'spada' });
      eq(e.testo, 'Orco è fuori portata: 7 celle (portata 1 cella).');
      e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'h1', armaId: 'arco' });
      eq(e.testo, 'Bersaglio non valido.', 'pedina nascosta: rifiuto senza nome');
      // Goblin prono e attacco in mischia: vantaggio; 17 con il vantaggio, 6 + 3 danni.
      DnD.condizioni.apply(x('g1'), { type: 'prono' });
      E.dadiDiProva(seq(4, 17, 6));
      e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada' });
      eq([e.stato, x('g1').hp], ['eseguita', 1]);
      // L'esito passa dal filtro come il log: i PF del Goblin solo a parole (audit A1).
      ok(e.testo.includes('Goblin') && !/\d+ → \d+ PF/.test(e.testo) && !/PF \d+\/\d+/.test(e.testo), 'esito filtrato: ' + e.testo);
      const riga = c().log.find((r) => r.text.includes('attacca Goblin'));
      ok(riga.text.includes('vantaggio') && riga.text.includes('[4, 17]'), riga.text);
      eq([dadi.Ale.length, dadi.Bice.length, dadi.Ale[0].tiro.gruppi.map((g) => g.values)], [1, 1, [[4, 17], [6]]], 'stessi dadi del master sui due lati');
      eq(dadi.Ale[0].tiro, dadi.Bice[0].tiro);
      // Secondo attacco (Attacco extra del guerriero di 5° livello): critico con il 20 naturale.
      E.dadiDiProva(seq(20, 3, 5));
      e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g2', armaId: 'arco' });
      ok(e.stato === 'eseguita' && c().log.some((r) => r.text.includes('CRITICO')), 'critico a distanza');
      eq(x('g2').hp, 10 - (3 + 5), 'dadi raddoppiati');
      e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g2', armaId: 'arco' });
      eq(e.testo, 'Hai già usato l\'azione in questo turno.', 'due attacchi per azione, non tre');
      ok(!inviati.some((m) => m.t.includes('"hp"')), 'i PF esatti dei nemici non partono');
    });
    // Linea di vista (verifica pura): muro tra chi attacca e il bersaglio.
    const g = vGrid({ w: 12, h: 10, structures: [vWall('m', 4, 0, 1, 10)] });
    const a = vC({ id: 'a', pos: { x: 1, y: 1 }, weapons: [{ id: 'arco', name: 'Arco', toHit: 5, damageDice: '1d6' }] });
    const t = vC({ id: 't', name: 'Lupo', kind: 'npc', faction: 'nemici', pos: { x: 8, y: 1 } });
    const ctx = { c: { combatants: [a, t] }, x: a, visti: new Set(['t']), catalogo: [], distanza: () => true, vista: V().context(g, [a, t]) };
    eq(DnD.rete.intenzioni.verificaAttacco(ctx, { armaId: 'arco', bersaglioId: 't', modo: 'normale' }).testo, 'Non hai linea di vista su Lupo.');
  });

  test('Online 2: incantesimi con slot, concentrazione, gittata e tiro salvezza dei bersagli', async () => {
    await partita(async ({ ale, chiedi, x, c, E, st }) => {
      let e = await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-vicino', slot: 0, bersagli: ['g2'] });
      eq(e.testo, 'Orco è fuori gittata: 7 celle (massimo 1 cella).', 'gittata «Contatto»');
      e = await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-fuoco', slot: 2, bersagli: ['g1'] });
      eq(e.testo, 'Nessuno slot di 2° livello disponibile.');
      // Vampata: 2d6 = 7, salvezza del goblin 2 + 0 contro CD 13 → fallita, 7 danni.
      E.dadiDiProva(seq(3, 4, 2));
      e = await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-fuoco', slot: 1, bersagli: ['g1'] });
      eq([e.stato, x('g1').hp, x('x1').spellcasting.slotsUsed[0], st.players[0].spellcasting.slotsUsed[0]], ['eseguita', 3, 1, 1], 'slot speso anche nella scheda');
      ok(c().log.some((r) => r.text.includes('salvezza DES') && r.text.includes('fallisce')), 'tiro salvezza del bersaglio');
      e = await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-scudo', slot: 1, bersagli: [] });
      eq(e.testo, 'Hai già usato l\'azione in questo turno.');
    });
    await partita(async ({ ale, chiedi, x }) => {
      const e = await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-scudo', slot: 1, bersagli: ['x2'] });
      eq(e.testo, 'Scudo arcano ha gittata personale.');
      const e2 = await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-scudo', slot: 1, bersagli: [] });
      eq([e2.stato, x('x1').concentration && x('x1').concentration.name], ['eseguita', 'Scudo arcano'], 'concentrazione iniziata');
    }, { soloAle: true });
  });

  test('Online 2: tiro salvezza richiesto dal master, con svantaggio dalle condizioni', async () => {
    await partita(async ({ ale, m, chiedi, x, c, E, extra }) => {
      DnD.condizioni.apply(x('x1'), { type: 'trattenuto' });
      const rid = m.richiediTiro(ale.stato().id, { caratteristica: 'DES', cd: 14, testo: 'Trappola a dardi' });
      await pausa();
      eq([extra.richieste.length, extra.richieste[0][1].caratteristica, extra.richieste[0][1].cd], [1, 'DES', 14]);
      E.dadiDiProva(seq(15, 3));
      const e = await chiedi(ale, 'salvezza', { richiestaId: rid });
      ok(e.stato === 'eseguita' && e.testo.includes('fallito'), e.testo);
      ok(c().log.some((r) => r.text.includes('svantaggio') && r.text.includes('[15, 3]')), 'svantaggio da trattenuto, tirato dal master');
      const e2 = await chiedi(ale, 'salvezza', { richiestaId: rid });
      eq(e2.testo, 'Richiesta di tiro non trovata o già usata.');
    }, { soloAle: true });
  });

  test('Online 2: tiri liberi generati dal master e identici sui due lati; tiri privati', async () => {
    await partita(async ({ ale, chiedi, dadi }) => {
      const e = await chiedi(ale, 'tira', { tipo: 'espr', espr: '2d6+3' });
      eq(e.stato, 'eseguita');
      eq([dadi.master.length, dadi.Ale.length, dadi.Bice.length], [1, 1, 1]);
      eq(dadi.Ale[0].tiro, dadi.master[0].tiro, 'stesso tiro sul master');
      eq(dadi.Bice[0].tiro, dadi.master[0].tiro, 'e sull\'altro giocatore');
      ok(dadi.Ale[0].verificato && dadi.Ale[0].tiro.gruppi[0].values.length === 2);
      await chiedi(ale, 'tira', { tipo: 'd20', modo: 'vantaggio', bonus: 2, privato: true });
      eq([dadi.master.length, dadi.Ale.length, dadi.Bice.length], [2, 2, 1], 'privato: solo il master e chi tira');
      const bad = await chiedi(ale, 'tira', { tipo: 'espr', espr: 'tanti dadi' });
      ok(bad.testo.startsWith('Richiesta non valida'), bad.testo);
      // Con i tiri convalidati il dado deciso dal client non passa.
      ale.dado(D().tiroDaRoll(D().roll(1, 20, 0, seq(20)), 'd20', 'menu'));
      await pausa();
      eq(dadi.master.length, 2);
    });
  });

  test('Online 2: permessi, pausa e conferma manuale (approva, rifiuta, modifica, annulla)', async () => {
    await partita(async ({ ale, m, chiedi, c, E }) => {
      m.impostaPermessi(ale.stato().id, { attaccare: false });
      await pausa();
      eq(ale.stato().permessi.attaccare, false, 'il giocatore riceve i suoi permessi');
      let e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada' });
      eq(e.testo, 'Il master non ti permette questa azione.');
      m.impostaPermessi(ale.stato().id, null);
      m.impostaPausa(true);
      e = await chiedi(ale, 'movimento', { combattenteId: 'x1', tipo: 'scatto' });
      eq(e.testo, 'Il master ha messo in pausa il gioco.');
      m.impostaPausa(false);
      m.impostaPermessi(null, { confermaManuale: true });
      e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada' });
      eq([e.stato, m.coda().length, m.coda()[0].descrizione], ['attesa', 1, 'Mira attacca Goblin con Spada'], 'in coda con l\'anteprima');
      E.dadiDiProva(seq(18, 2, 2));
      m.approva(m.coda()[0].id, { modo: 'svantaggio' });
      await pausa();
      ok(c().log.some((r) => r.text.includes('svantaggio')), 'approvata con la modifica del master');
      const id2 = ale.intenzione('attacca', { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada' });
      await pausa();
      m.rifiuta(m.coda()[0].id, 'non adesso');
      await pausa();
      eq(ale.stato().inSospeso.has(id2), false);
      const id3 = ale.intenzione('usaAzione', { combattenteId: 'x1', azione: 'reazione', testo: 'Attacco di opportunità' });
      await pausa();
      eq(m.coda().length, 1, 'le reazioni passano sempre dal master');
      ale.annulla(id3);
      await pausa();
      eq(m.coda().length, 0, 'annullata dal giocatore');
    }, { soloAle: true });
  });

  test('Online 2: scheda con delta, limiti, permessi e conflitti', async () => {
    await partita(async ({ ale, m, chiedi, x, st }) => {
      let e = await chiedi(ale, 'modificaScheda', { campo: 'pf', valore: 25, prima: 30 });
      eq([e.stato, x('x1').hp], ['eseguita', 25]);
      await pausa();
      eq(ale.stato().vista.scheda.pf, 25, 'lo stato torna al giocatore');
      e = await chiedi(ale, 'modificaScheda', { campo: 'pf', valore: 99, prima: 25 });
      eq(e.testo, 'Valore fuori dai limiti (da 0 a 30).');
      e = await chiedi(ale, 'modificaScheda', { campo: 'pf', valore: 20, prima: 30 });
      eq(e.testo, 'Il valore è cambiato nel frattempo (ora 25): la tua modifica non è stata applicata.', 'conflitto: vince il master');
      e = await chiedi(ale, 'modificaScheda', { campo: 'caratteristica', chiave: 'FOR', valore: 18, prima: null });
      eq(e.testo, 'Il master non ti permette questa azione.', 'caratteristiche spente di base');
      m.impostaPermessi(null, { schedaBase: true });
      e = await chiedi(ale, 'modificaScheda', { campo: 'caratteristica', chiave: 'FOR', valore: 18, prima: null });
      eq([e.stato, st.players[0].abilities.FOR], ['eseguita', 18]);
      e = await chiedi(ale, 'modificaScheda', { campo: 'slot', livello: 1, valore: 2, prima: 0 });
      eq([e.stato, x('x1').spellcasting.slotsUsed[0]], ['eseguita', 2]);
      e = await chiedi(ale, 'modificaScheda', { campo: 'monete', chiave: 'mo', valore: 50, prima: null });
      eq(st.players[0].coins.mo, 50);
    }, { soloAle: true });
  });

  test('Online 2: scambio di oggetti con la conferma del destinatario', async () => {
    await partita(async ({ ale, bice, chiedi, extra, st, esiti }) => {
      const e = await chiedi(ale, 'dai', { indice: 0, qty: 5, a: 'pg2' });
      eq(e.testo, 'Ne hai solo 3.');
      const id = ale.intenzione('dai', { indice: 0, qty: 2, a: 'pg2' });
      await pausa();
      eq([extra.offerte.length, extra.offerte[0][0], extra.offerte[0][1].qty], [1, 'Bice', 2], 'offerta al destinatario');
      await chiedi(bice, 'rispostaOfferta', { offertaId: extra.offerte[0][1].id, accetta: true });
      eq([st.players[0].inventory[0].qty, st.players[1].inventory[0].qty], [1, 2]);
      eq(esiti.filter((x) => x.id === id).pop().stato, 'eseguita', 'esito anche a chi ha dato');
      ale.intenzione('dai', { indice: 0, qty: 1, a: 'pg2' });
      await pausa();
      await chiedi(bice, 'rispostaOfferta', { offertaId: extra.offerte[1][1].id, accetta: false });
      eq(st.players[0].inventory[0].qty, 1, 'rifiutata: nulla cambia');
    });
  });

  test('Online 2: gettone di rientro, revoca e personaggio assente', async () => {
    let richiesta = null;
    await partita(async ({ ale, m, extra, unisci, c }) => {
      eq(extra.gettoni.length, 1);
      const gettone = extra.gettoni[0][1];
      const id = ale.stato().id;
      ale.a.chiudi();
      await pausa();
      eq([m.giocatori()[0].stato, m.giocatori()[0].assente], ['disconnesso', true], 'personaggio assente');
      // Assente da saltare: al suo turno il master passa oltre.
      m.assente('pg1', 'salta');
      await pausa(5);
      ok(c().currentId !== 'x1', 'turno saltato');
      ok(c().log.some((r) => r.text.includes('Mira salta il turno')));
      // Rientro con il gettone (anche con un altro nome): stesso id e stesso personaggio.
      const a2 = unisci('Alessia', { gettone });
      await pausa();
      eq([richiesta.rientro.gettone, richiesta.rientro.personaggioId], [true, 'pg1']);
      richiesta.accetta({});
      await pausa();
      eq([a2.stato().id, a2.stato().vista.scheda.nome, m.giocatori().find((g) => g.id === id).personaggioId], [id, 'Mira', 'pg1']);
      // Revoca: chi rientra con quel gettone è un giocatore nuovo.
      m.revocaGettone(id);
      a2.a.chiudi();
      await pausa();
      richiesta = null;
      unisci('Zed', { gettone });
      await pausa();
      eq(richiesta.rientro, null, 'gettone revocato');
    }, { soloAle: true, master: { suRichiesta: (r) => { if (!richiesta && r.nome === 'Ale') r.accetta({ personaggioId: 'pg1' }); else richiesta = r; } } });
  });

  test('Online 2: intenzioni duplicate (idempotenza), campi extra e messaggi malformati', async () => {
    await partita(async ({ ale, m, x, c, esiti, E }) => {
      const P = NET().protocollo;
      const raw = (msg, seqN) => ale.a.invia(P.codifica(P.crea('intenzione', msg, seqN)));
      E.dadiDiProva(seq(15, 4, 15, 4));
      raw({ id: 'doppia-1', tipo: 'attacca', dati: { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada', pf: 999, extra: { a: 1 } } }, 900);
      raw({ id: 'doppia-1', tipo: 'attacca', dati: { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada' } }, 901);
      await pausa();
      eq(c().log.filter((r) => r.text.includes('attacca Goblin')).length, 1, 'eseguita una volta sola');
      eq(esiti.filter((e) => e.id === 'doppia-1').map((e) => e.stato), ['eseguita', 'eseguita'], 'stesso esito ripetuto');
      eq(x('g1').hp, 10 - 7, 'campi extra ignorati (pf)');
      m.impostaSoglia(3);
      raw({ id: 'x-1', tipo: 'teletrasporto', dati: {} }, 902);
      raw({ id: 'x-2', tipo: 'muovi', dati: { combattenteId: 'x1', celle: 'tutte' } }, 903);
      await pausa();
      ok(esiti.some((e) => e.id === 'x-1' && e.testo.startsWith('Richiesta non valida')), 'tipo sconosciuto');
      eq(m.registro().filter((v) => v.grave).length, 2);
      ale.a.invia('{rotto');
      await pausa();
      eq([ale.stato().stato, m.giocatori().length], ['espulso', 0], 'espulso alla soglia delle violazioni');
    }, { soloAle: true });
  });

  test('Online 2: nessun dato nascosto nelle risposte, ping, domanda e rivelazione di un handout', async () => {
    await partita(async ({ ale, bice, m, chiedi, extra, inviati }) => {
      await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'h1', armaId: 'arco' });
      await chiedi(ale, 'lancia', { combattenteId: 'x1', magiaId: 'sp-fuoco', slot: 1, bersagli: ['h1'] });
      await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 1, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }, { x: 0, y: 5 }, { x: 1, y: 6 }] });
      ok(!inviati.some((x) => x.t.includes('Ombra') || x.t.includes('"h1"')), 'l\'ombra nascosta non compare mai');
      ok(!inviati.some((x) => x.t.includes('Il mistero della torre')), 'l\'handout non parte prima della rivelazione');
      await chiedi(ale, 'ping', { x: 5, y: 5 });
      eq(extra.ping.map(([n, p]) => [n, p.x, p.y, p.nome]), [['Ale', 5, 5, 'Ale'], ['Bice', 5, 5, 'Ale']], 'ping a tutti con il nome');
      await chiedi(bice, 'domanda', { testo: 'Posso scassinare la porta?' });
      eq(extra.domande.map((d) => [d.nome, d.testo]), [['Bice', 'Posso scassinare la porta?']]);
      m.rivela({ titolo: 'Lettera', testo: 'Il mistero della torre' });
      await pausa();
      eq(extra.rivela.map(([n, r]) => [n, r.titolo, r.testo]), [['Ale', 'Lettera', 'Il mistero della torre'], ['Bice', 'Lettera', 'Il mistero della torre']]);
    });
  });

  test('Online 2: client della tappa 1 rifiutato con un messaggio chiaro', async () => {
    const [a, b] = NET().trasporto.coppiaMemoria();
    const errori = [];
    NET().sessione.master({ stato: () => onlineState(), suErrore: (t) => errori.push(t) }).collega(b);
    const ricevuti = [];
    a.suMessaggio((t) => ricevuti.push(JSON.parse(t)));
    a.invia(JSON.stringify({ versione: 1, tipo: 'ciao', id: 'v1', seq: 1, dati: { nome: 'Vecchio' } }));
    await pausa();
    eq([ricevuti[0].tipo, ricevuti[0].dati.versione], ['incompatibile', NET().protocollo.VERSIONE]);
    ok(errori[0].includes('protocollo 1') && errori[0].includes('aggiornare'), errori[0]);
  });

  test('Online 2: due client giocano un turno completo (movimento, attacco, fine turno)', async () => {
    await partita(async ({ ale, bice, chiedi, c, x, E }) => {
      ok(await chiedi(ale, 'muovi', { combattenteId: 'x1', celle: [{ x: 1, y: 2 }] }));
      E.dadiDiProva(seq(15, 5));
      let e = await chiedi(ale, 'attacca', { combattenteId: 'x1', bersaglioId: 'g1', armaId: 'spada' });
      eq([e.stato, x('g1').hp], ['eseguita', 2]);
      e = await chiedi(bice, 'finisciTurno', { combattenteId: 'x2' });
      eq(e.testo, 'Non è il tuo turno.');
      e = await chiedi(ale, 'finisciTurno', { combattenteId: 'x1' });
      eq([e.stato, c().currentId], ['eseguita', 'x2']);
      eq([ale.stato().vista.combattimento.turno, bice.stato().vista.combattimento.turno], ['x2', 'x2'], 'entrambi vedono il turno di Bea');
      eq(bice.stato().vista.combattimento.pedine.find((p) => p.id === 'x2').proprie.economia.azione, false, 'Bea ha la sua azione');
      e = await chiedi(bice, 'muovi', { combattenteId: 'x2', celle: [{ x: 2, y: 2 }] });
      eq(e.stato, 'eseguita', 'Bea si avvicina al goblin');
      E.dadiDiProva(seq(19, 4));
      e = await chiedi(bice, 'attacca', { combattenteId: 'x2', bersaglioId: 'g1', armaId: 'mazza' });
      eq([e.stato, x('g1').hp], ['eseguita', 0]);
      e = await chiedi(bice, 'finisciTurno', { combattenteId: 'x2' });
      eq(c().currentId, 'g2', 'turno dell\'orco (il goblin è a terra)');
      const v = ale.stato().vista.combattimento;
      eq([v.turno, v.pedine.find((p) => p.id === 'g1').salute, v.pedine.find((p) => p.id === 'x1').pos], ['g2', 'a terra', { x: 1, y: 2 }]);
    });
  });

  // ---------- Gioco online, tappa 3: filtro unico, più giocatori, riconnessione ----------
  // Chiavi e valori che non devono mai comparire in un messaggio al giocatore (stato di prova con valori marcatori).
  const CHIAVI_VIETATE = ['notes', 'note', 'hidden', 'nascosto', 'soglia', 'threshold', 'thresholds', 'piano', 'plan', 'tactics', 'readAloud', 'npcState',
    'trap', 'lock', 'contents', 'hiddenRole', 'dialog', 'stock', 'merchant', 'why', 'phases', 'lair'];
  const VALORI_VIETATI = ['MK-', 'NOTA-SEGRETA', 'TESORO-SEGRETO', 'Assassino', 'Piano:', 'soffio al prossimo turno'];
  // Scorre ricorsivamente ogni messaggio (chiavi e valori) e restituisce i problemi trovati.
  function cercaSegreti(testi) {
    const out = [];
    const scorri = (v, via) => {
      if (typeof v === 'string') { for (const s of VALORI_VIETATI) if (v.includes(s)) out.push(via + ' = ' + v.slice(0, 60)); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => scorri(x, via + '[' + i + ']')); return; }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (CHIAVI_VIETATE.includes(k)) out.push(via + '.' + k); scorri(x, via + '.' + k); }
    };
    for (const t of testi) { if (!t.startsWith('{')) continue; scorri(JSON.parse(t), 'msg'); }
    return out;
  }
  // Stato pieno di segreti: combattimento di onlineState più Mondo (fazione segreta, mercante e spia piazzati, quest non
  // offerta, città segreta, reputazioni), scene (una rivelata, una no), boss con fasi e tana, log dell'IA.
  function statoMarcatori() {
    const st = onlineState();
    const se = S().current(st);
    const sid = se.id;
    st.players[0].coins = { mr: 0, ma: 0, me: 0, mo: 5, mp: 0 };
    const c = se.combat;
    const boss = c.combatants.find((x) => x.id === 'b1');
    boss.boss.phases = [{ threshold: 50, name: 'MK-FASE', notes: 'MK-NOTA-FASE' }];
    boss.creature = { legendary: [{ name: 'Colpo di coda', cost: 1 }], legendaryPoints: { max: 3, left: 2 }, lair: [{ name: 'MK-TANA' }] };
    DnD.dati.pushLog(c, 'ia', 'MK-PIANO: il drago aspetta.');
    st.factions.push(FZ().normalizeFaction({ id: 'gilda', name: 'Gilda', sessionId: sid }), FZ().normalizeFaction({ id: 'segreta', name: 'MK-FAZIONE', notes: 'MK-NOTE-FAZIONE', sessionId: sid }));
    st.cities.push(CT().normalizeCity({ id: 'cx', name: 'MK-CITTA', notes: 'MK-NOTE-CITTA', sessionId: sid }));
    const merc = Object.assign(merchantNpc({ notes: 'MK-NOTE-MERCANTE' }), { sessionId: sid });
    const spia = Object.assign(NPC().normalizeNpc({ id: 'spia', name: 'Vel', roles: ['informatore'], hiddenRole: true, attitude: 'ostile', factionId: 'segreta', notes: 'MK-NOTE-SPIA',
      dialog: { start: 'n1', nodes: [{ id: 'n1', title: 'MK-NODO', text: 'MK-DIALOGO', answers: [] }] } }), { sessionId: sid });
    st.worldNpcs.push(merc, spia);
    const im = NPC().placedItem(merc, 'npc-m', 2, 2);
    im.npcState.revealed.role = true;
    const is = NPC().placedItem(spia, 'npc-s', 4, 2);
    c.grid.items.push(im, is);
    st.quests.push(QS().normalizeQuest({ id: 'q1', title: 'Lupi', factionId: 'gilda', description: 'Caccia ai lupi', sessionId: sid, notes: 'MK-NOTE-QUEST' }),
      QS().normalizeQuest({ id: 'q2', title: 'MK-QUEST', factionId: 'segreta', sessionId: sid, hidden: true }));
    const party = st.parties.find((p) => p.sessionId === sid);
    Object.assign(party, { memberIds: ['pg1'], reputation: { gilda: 30, segreta: -50 } });
    se.world.activePartyId = party.id;
    QS().offer(se.world.quests, st.quests.find((q) => q.id === 'q1'));
    QS().accept(se.world.quests, st.quests.find((q) => q.id === 'q1'), 0, party.id);
    st.scenes.push(SC().normalizeScene({ id: 's1', title: 'Arrivo', order: 1, sessionId: sid, revealed: true, readAloud: '<p>Benvenuti a Rocca</p>', notes: 'MK-NOTE-SCENA' }),
      SC().normalizeScene({ id: 's2', title: 'MK-SCENA', order: 2, sessionId: sid, readAloud: '<p>MK-TESTO</p>' }));
    return st;
  }
  // Rete di prova della tappa 3: un master e più client in memoria. scelte(nome) -> scelte di accetta.
  function rete3(st, mopts, scelte) {
    const m = NET().sessione.master(Object.assign({ nome: 'Dario', stato: () => st, suRichiesta: (r) => (scelte ? scelte(r) : r.accetta({ personaggioId: 'pg1' })) }, mopts));
    const unisci = (nome, gopts) => {
      const [a, b] = NET().trasporto.coppiaMemoria();
      const inviati = [];
      const inv = b.invia;
      b.invia = (t) => { inviati.push(t); return inv(t); };
      m.collega(b);
      const esiti = [];
      const g = NET().sessione.giocatore(Object.assign({ nome, colore: '#3366aa', trasporto: a, suEsito: (e) => esiti.push(e) }, gopts));
      return { g, a, b, inviati, esiti, chiedi: async (tipo, dati) => { const id = g.intenzione(tipo, dati); await pausa(); return esiti.filter((e) => e.id === id).pop() || null; } };
    };
    return { m, unisci };
  }

  test('Online 3: whitelist — nessun marcatore segreto in nessun messaggio, sezione per sezione', async () => {
    const st = statoMarcatori();
    const { m, unisci } = rete3(st);
    const c1 = unisci('Ale');
    await pausa();
    const v = c1.g.stato().vista;
    eq([v.mondo.npc.map((n) => n.nome), v.mondo.npc.find((n) => n.id === 'npc-s').ruoli, v.mondo.npc.find((n) => n.id === 'npc-s').atteggiamento], [['Bera', 'Vel'], [], ''], 'NPC incontrati, ruolo e atteggiamento della spia nascosti');
    eq([v.mondo.quest.map((q) => q.titolo), v.mondo.fazioni.map((f) => f.nome), v.mondo.citta, v.mondo.reputazioni], [['Lupi'], ['Gilda'], [], []], 'quest accettate, fazioni conosciute, reputazioni nascoste');
    eq(v.scene, [{ id: 's1', titolo: 'Arrivo', tipo: v.scene[0].tipo, stato: v.scene[0].stato, testo: 'Benvenuti a Rocca' }], 'solo la scena rivelata, in testo semplice');
    eq(v.mondo.npc.find((n) => n.id === 'npc-m').negozio, [], 'negozio chiuso: nessuna merce');
    eq([v.combattimento.boss, v.combattimento.pedine.find((p) => p.id === 'b1').tema], [[], ''], 'boss non rivelato: nessun tema né azioni');
    // Il master apre il negozio, rivela il boss e le reputazioni: arrivano come eventi, ancora senza segreti.
    m.rivelaMondo('negozi', 'npc-m');
    S().current(st).combat.combatants.find((x) => x.id === 'b1').boss.revealed = true;
    m.impostaVisibilita({ mostraReputazioni: true });
    await pausa();
    const v2 = c1.g.stato().vista;
    eq(v2.mondo.npc.find((n) => n.id === 'npc-m').negozio.map((r) => [r.lineId, r.nome, r.qty]), [['l1', 'Pugnale', 3]], 'negozio aperto: solo le righe sbloccate');
    eq([v2.mondo.reputazioni, v2.combattimento.boss[0].leggendarie, v2.combattimento.boss[0].puntiLeggendari, v2.combattimento.pedine.find((p) => p.id === 'b1').tema],
      [[{ fazioneId: 'gilda', valore: 30 }], [{ nome: 'Colpo di coda' }], 2, 'fuoco'], 'reputazione rivelata solo per le fazioni note; azioni leggendarie solo a boss rivelato');
    eq(c1.inviati.some((t) => t.includes('"tipo":"evento"')), true, 'aggiornamenti incrementali');
    eq(cercaSegreti(c1.inviati), [], 'nessuna chiave o valore segreto in tutti i messaggi');
  });

  test('Online 3: campo nuovo non ammesso scartato con avviso; eventi filtrati per operazione', () => {
    const F = NET().filtro;
    const avvisi = [];
    const r = F.ammetti({ master: 'Dario', nuovoCampo: 'MK-X', notes: 'MK-N', io: { giocatoreId: 'a', extra: 1 }, altri: [{ id: 'p', nome: 'Bea', segreto: 'MK' }] }, F.SCHEMA, 'vista', avvisi);
    eq(r, { master: 'Dario', io: { giocatoreId: 'a' }, altri: [{ id: 'p', nome: 'Bea' }] }, 'solo i campi ammessi');
    eq(avvisi, ['vista.nuovoCampo', 'vista.io.extra', 'vista.altri[0].segreto'], 'avviso per i campi sconosciuti (le chiavi private note si scartano in silenzio)');
    const ev = F.eventoPerGiocatore({ n: 4, cambi: [{ op: 'pedina', pedina: { id: 'g1', nome: 'Goblin', hp: 7, piano: 'MK' } }, { op: 'segreto', x: 1 }, { op: 'celle', d: [[3, 2]] }] }, 'g', { silenzioso: true });
    eq(ev, { n: 4, cambi: [{ op: 'pedina', pedina: { id: 'g1', nome: 'Goblin' } }, { op: 'celle', d: [[3, 2]] }] }, 'operazione sconosciuta scartata, campi della pedina filtrati');
  });

  test('Online 3: «Vedi come giocatore» mostra i dati inviati e ciò che non arriva', async () => {
    const st = statoMarcatori();
    const { m, unisci } = rete3(st);
    const c1 = unisci('Ale');
    await pausa();
    const id = c1.g.stato().id;
    const vc = m.vediCome(id);
    eq(vc.vista, m.vistaInviata(id), 'la stessa vista inviata, non una ricostruzione della UI');
    const testi = vc.manca.map((x) => x.sezione + ': ' + x.testo);
    for (const atteso of ['Note: Note del master', 'Combattimento: Assassino (nascosto)', 'Boss: Drago', 'Mappa: Trappola (nascosto)', 'Scene: «MK-SCENA» (non rivelata)', 'Quest: «MK-QUEST»', 'Fazioni: MK-FAZIONE', 'Combattimento: PF esatti dei nemici']) {
      ok(testi.some((t) => t.startsWith(atteso)), 'non ricevuto: ' + atteso);
    }
    const tavolo = m.vediCome(null);
    eq([tavolo.vista.io.spettatore, tavolo.vista.scheda], [true, null], 'vista del tavolo (spettatore senza personaggio)');
  });

  test('Online 3: esplorazione e nebbia — solo celle scoperte, aggiornamenti incrementali, gruppo mosso con approvazione', async () => {
    const w = exploreWorld();
    w.grid.fog.enabled = true;
    w.grid.items = [DnD.dati.normalizePlacedItem({ id: 'lontano', name: 'MK-OGGETTO', x: 9, y: 9 })];
    XP().reveal(w);
    const mosse = [];
    const { m, unisci } = rete3(w.st, { esploraGruppo: (x, y) => { w.ex.parties[0].pos = { x, y }; XP().reveal(w); mosse.push([x, y]); return { testo: 'Il gruppo si sposta.' }; } }, (r) => r.accetta({ personaggioId: 'p1' }));
    const c1 = unisci('Ale');
    await pausa();
    const ve = c1.g.stato().vista.esplorazione;
    ok(ve && ve.griglia.cells.includes('0') && ve.griglia.cells.includes('2'), 'celle coperte e visibili');
    eq([ve.griglia.items, ve.gruppi.map((p) => p.pos), ve.tempo.giorno, Boolean(ve.bioma && ve.bioma.nome)], [[], [{ x: 0, y: 0 }], 1, true], 'nessun oggetto fuori vista; gruppo, tempo e bioma');
    let e = await c1.chiedi('muoviGruppo', { x: 9, y: 9 });
    eq([e.stato, e.testo], ['rifiutata', 'Non puoi andare lì.'], 'cella non scoperta');
    e = await c1.chiedi('muoviGruppo', { x: 1, y: 0 });
    eq([e.stato, m.coda().length], ['attesa', 1], 'serve l\'approvazione del master');
    const prima = c1.inviati.length;
    m.approva(m.coda()[0].id);
    m.aggiorna();
    await pausa();
    const nuovi = c1.inviati.slice(prima).map((t) => JSON.parse(t)).filter((x) => x.tipo === 'evento');
    const ops = nuovi.flatMap((x) => x.dati.cambi.map((c) => c.op));
    ok(ops.includes('celleEsp') && !ops.includes('nebbiaEsp'), 'nebbia: solo le celle rivelate (' + ops.join(', ') + ')');
    eq([mosse, c1.g.stato().vista, cercaSegreti(c1.inviati)], [[[1, 0]], m.vistaInviata(c1.g.stato().id), []], 'gruppo mosso, vista coerente, nessun segreto');
    // Mappa 100×100: lo spostamento manda solo le differenze, molto meno della maschera intera.
    const F = NET().filtro;
    const a = '0'.repeat(10000);
    const b = a.slice(0, 5050) + '22222' + a.slice(5055);
    const d = F.diffCelle(a, b);
    eq([d.length, F.applicaCelle(a, d) === b, JSON.stringify(d).length < 200], [5, true, true], 'differenze delle celle su 100×100');
  });

  test('Online 3: scambio col mercante convalidato dal master, quest e scene', async () => {
    const st = statoMarcatori();
    const { m, unisci } = rete3(st);
    const c1 = unisci('Ale');
    await pausa();
    let e = await c1.chiedi('scambio', { npcId: 'npc-m', compra: [{ lineId: 'l1', qty: 1 }] });
    eq([e.stato, e.testo], ['rifiutata', 'Mercante non disponibile.'], 'negozio non aperto');
    e = await c1.chiedi('scambio', { npcId: 'npc-zzz', compra: [{ lineId: 'l1', qty: 1 }] });
    eq(e.testo, 'Mercante non disponibile.', 'mercante inesistente: stesso rifiuto, nulla da dedurre');
    m.rivelaMondo('negozi', 'npc-m');
    m.rivelaMondo('negozi', 'npc-s');
    await pausa();
    e = await c1.chiedi('scambio', { npcId: 'npc-s', compra: [{ lineId: 'l1', qty: 1 }] });
    eq(e.testo, 'Mercante non disponibile.', 'ruolo nascosto: nessun negozio');
    e = await c1.chiedi('scambio', { npcId: 'npc-m', compra: [{ lineId: 'l2', qty: 1 }] });
    eq(e.testo, 'Oggetto non in vendita.', 'riga bloccata dalla reputazione');
    e = await c1.chiedi('scambio', { npcId: 'npc-m', compra: [{ lineId: 'l1', qty: 9 }] });
    eq(e.stato, 'rifiutata', 'quantità oltre la disponibilità');
    const prezzo = c1.g.stato().vista.mondo.npc.find((n) => n.id === 'npc-m').negozio[0].prezzo;
    e = await c1.chiedi('scambio', { npcId: 'npc-m', compra: [{ lineId: 'l1', qty: 1 }] });
    const pg = st.players.find((p) => p.id === 'pg1');
    eq([e.stato, pg.inventory.some((x) => x.equipmentId === 'eq-pugnale'), NPC().toCopper(pg.coins), S().current(st).combat.grid.items.find((x) => x.id === 'npc-m').npcState.stock[0].qty],
      ['eseguita', true, 500 - prezzo, 2], 'acquisto con i prezzi del master');
    eq(cercaSegreti(c1.inviati), [], 'nessun segreto');
  });

  test('Online 3: boss rivelato e non, trasformazione leggendaria visibile al proprietario', async () => {
    const st = partitaState();
    const x1 = S().current(st).combat.combatants.find((x) => x.id === 'x1');
    x1.legend = { theme: 'sole', rank: 2, transformations: [{ name: 'Avatar' }], form: { id: 'f', name: 'Avatar del sole', theme: 'sole' } };
    await partita(async ({ ale, bice }) => {
      const pa = ale.stato().vista.combattimento.pedine.find((p) => p.id === 'x1');
      const pb = bice.stato().vista.combattimento.pedine.find((p) => p.id === 'x1');
      eq([pa.tema, pa.proprie.leggenda.forma, pa.proprie.leggenda.trasformazioni], ['lg:sole', 'Avatar del sole', ['Avatar']], 'il proprietario vede forma e percorso');
      eq([pb.tema, 'proprie' in pb], ['lg:sole', false], 'gli altri vedono solo la pedina trasformata (tema grafico)');
    }, { st });
  });

  test('Online 3: richiesta di riposo breve con approvazione e dialogo con scelta del giocatore', async () => {
    const st = statoMarcatori();
    const riposi = [];
    const dialoghi = [];
    const { m, unisci } = rete3(st, { riposo: (id, tipo) => { riposi.push([id, tipo]); return { testo: 'Riposo breve avviato.' }; }, suDialogo: (d) => { dialoghi.push(d); return { testo: 'Bera: ecco le armi.' }; } });
    const c1 = unisci('Ale', { suDialogo: (d) => dialoghi.push(['giocatore', d.chiuso ? 'chiuso' : d.testo]) });
    await pausa();
    let e = await c1.chiedi('richiediRiposo', { tipo: 'breve' });
    eq(e.testo, 'Non puoi riposare durante un combattimento.');
    S().current(st).combat = null;
    m.aggiorna();
    e = await c1.chiedi('richiediRiposo', { tipo: 'lungo' });
    eq(e.stato, 'rifiutata', 'solo il riposo breve');
    e = await c1.chiedi('richiediRiposo', { tipo: 'breve' });
    eq(e.stato, 'attesa');
    m.approva(m.coda()[0].id);
    await pausa();
    eq([riposi, c1.esiti.pop().testo], [[['pg1', 'breve']], 'Riposo breve avviato.'], 'approvato: lo avvia il master');
    const did = m.mostraDialogo({ npc: 'Bera', testo: 'Cosa cerchi?', risposte: [{ id: 'r1', testo: 'Armi' }, { id: 'r2', testo: 'Niente' }], scelta: true });
    await pausa();
    eq([c1.g.stato().dialoghi.get(did).risposte.map((r) => r.testo), dialoghi[0]], [['Armi', 'Niente'], ['giocatore', 'Cosa cerchi?']], 'dialogo mostrato al giocatore');
    e = await c1.chiedi('rispostaDialogo', { dialogoId: did, rispostaId: 'r9' });
    eq(e.testo, 'Risposta non disponibile.', 'risposta non mandata');
    e = await c1.chiedi('rispostaDialogo', { dialogoId: did, rispostaId: 'r1' });
    eq([e.stato, e.testo, dialoghi.find((d) => d.rispostaId).rispostaId, c1.g.stato().dialoghi.size], ['eseguita', 'Bera: ecco le armi.', 'r1', 0], 'scelta convalidata e dialogo chiuso');
    e = await c1.chiedi('rispostaDialogo', { dialogoId: did, rispostaId: 'r1' });
    eq(e.testo, 'Risposta non disponibile.', 'una volta sola');
  });

  // Sei giocatori in combattimento (pg1…pg6) e un goblin.
  function seiState() {
    const st = DnD.dati.emptyState();
    const se = S().current(st);
    const cs = [];
    for (let i = 1; i <= 6; i++) {
      st.players.push(Object.assign(DnD.dati.normalizeCreature({ id: 'pg' + i, name: 'Eroe ' + i, classId: 'guerriero', maxHp: 20 }, true), { sessionId: se.id }));
      cs.push({ id: 'x' + i, sourceId: 'pg' + i, name: 'Eroe ' + i, kind: 'player', faction: 'giocatori', hp: 20, maxHp: 20, initiative: 20 - i, pos: { x: i, y: 1 }, w: 1, h: 1 });
    }
    cs.push({ id: 'g1', name: 'Goblin', kind: 'npc', faction: 'nemici', hp: 7, maxHp: 7, initiative: 5, pos: { x: 3, y: 5 }, w: 1, h: 1 });
    cs.push({ id: 'h1', name: 'Assassino', kind: 'npc', faction: 'nemici', hp: 9, maxHp: 9, hidden: true, initiative: 4, pos: { x: 9, y: 9 }, w: 1, h: 1 });
    se.combat = DnD.dati.normalizeCombat({ id: 'c6', phase: 'attivo', round: 1, currentId: 'x1', combatants: cs, grid: { w: 12, h: 12 }, log: [] });
    return st;
  }
  const sceltaSei = (r) => (r.nome.startsWith('Spett') ? r.accetta({ spettatore: true, come: r.nome === 'Spett-come' ? 'pg2' : null }) : r.accetta({ personaggioId: 'pg' + r.nome.slice(1) }));

  test('Online 3: sei giocatori con viste diverse, spettatori (tavolo e «come»), barra dei partecipanti', async () => {
    const st = seiState();
    const errori = [];
    const { m, unisci } = rete3(st, { suErrore: (t) => errori.push(t) }, sceltaSei);
    const cl = [1, 2, 3, 4, 5, 6].map((i) => unisci('G' + i));
    const tavolo = unisci('Spett-tavolo');
    const come = unisci('Spett-come');
    await pausa();
    eq(cl.map((x) => x.g.stato().vista.io.personaggioId), ['pg1', 'pg2', 'pg3', 'pg4', 'pg5', 'pg6'], 'ognuno il proprio personaggio');
    eq(cl.map((x) => x.g.stato().vista.combattimento.pedine.filter((p) => p.mia).map((p) => p.id)[0]), ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'], 'viste filtrate per ciascuno');
    ok(new Set(cl.map((x) => x.inviati.find((t) => t.includes('"tipo":"istantanea"')))).size === 6, 'istantanee diverse, non un broadcast identico');
    eq([tavolo.g.stato().spettatore, tavolo.g.stato().vista.scheda, come.g.stato().vista.scheda.nome, come.g.stato().vista.combattimento.pedine.some((p) => p.proprie)], [true, null, 'Eroe 2', false], 'spettatori');
    const e = await come.chiedi('finisciTurno', { combattenteId: 'x2' });
    eq(e.testo, 'Gli spettatori non possono agire.');
    const pres = cl[0].g.stato().presenza;
    eq([pres.length, pres.find((p) => p.nome === 'G1').personaggio, pres.find((p) => p.nome === 'G1').turno, pres.find((p) => p.nome === 'Spett-tavolo').spettatore], [9, 'Eroe 1', true, true], 'partecipanti con personaggio e turno');
    // Un settimo giocatore entra solo come spettatore.
    const sett = unisci('G7');
    await pausa();
    eq([sett.g.stato().spettatore, errori.some((t) => t.includes('piena'))], [true, true], 'oltre 6: spettatore');
    for (const x of cl.concat([tavolo, come, sett])) eq(cercaSegreti(x.inviati), [], 'nessun segreto');
    eq([m.diagnostica().giocatori, m.diagnostica().spettatori], [6, 3]);
  });

  test('Online 3: coda di invio con priorità, client lento e accorpamento degli aggiornamenti', async () => {
    // Unità: con il canale pieno i messaggi aspettano; poi prima lo stato, poi la chat, ultime le immagini.
    let pieno = true;
    let rilascia = null;
    const usciti = [];
    const finto = { connesso: () => true, inCoda: () => (pieno ? 1e9 : 0), svuotato: () => new Promise((r) => { rilascia = r; }), invia: (t) => usciti.push(JSON.parse(t).tipo) };
    const q = NET().sessione.codaInvio(finto);
    q.invia('immagine', {});
    q.invia('chat', {});
    q.invia('evento', {});
    q.invia('esito', {});
    eq([usciti, q.inAttesa(), q.inAttesa(2)], [[], 4, 1], 'canale pieno: tutto in coda');
    pieno = false;
    rilascia();
    await pausa();
    eq(usciti, ['evento', 'esito', 'chat', 'immagine'], 'priorità: stato di gioco, chat, immagini');
    // Sessione: un client lento non blocca gli altri e riceve gli aggiornamenti accorpati.
    const st = seiState();
    const { m, unisci } = rete3(st, {}, sceltaSei);
    const veloce = unisci('G1');
    const lento = unisci('G2');
    await pausa();
    let tappo = false;
    let apri = null;
    lento.b.inCoda = () => (tappo ? 1e9 : 0);
    lento.b.svuotato = () => new Promise((r) => { apri = r; });
    tappo = true;
    const c = S().current(st).combat;
    const primaV = veloce.inviati.length;
    const primaL = lento.inviati.length;
    for (let i = 0; i < 5; i++) { c.combatants.find((x) => x.id === 'g1').pos = { x: 4 + i, y: 5 }; m.aggiorna(); }
    await pausa();
    const statoV = veloce.inviati.slice(primaV).filter((t) => /"tipo":"(evento|istantanea)"/.test(t)).length;
    eq([statoV, lento.inviati.length - primaL], [5, 0], 'il veloce riceve tutto, il lento aspetta (canale pieno)');
    ok(m.giocatori().find((g) => g.nome === 'G2').coda > 0, 'coda del client lento visibile al master');
    tappo = false;
    apri();
    await pausa();
    await pausa();
    const statoL = lento.inviati.slice(primaL).filter((t) => /"tipo":"(evento|istantanea)"/.test(t)).length;
    ok(statoL <= 3, 'aggiornamenti accorpati (' + statoL + ' invece di 5)');
    eq(lento.g.stato().vista, m.vistaInviata(lento.g.stato().id), 'alla fine la stessa vista');
    eq(lento.g.stato().vista.combattimento.pedine.find((p) => p.id === 'g1').pos, { x: 8, y: 5 });
  });

  test('Online 3: riconnessione col gettone, intenzioni in sospeso annullate, master che riprende la sessione', async () => {
    const st = onlineState();
    const errori = [];
    const richieste = [];
    const accetta = (r) => { richieste.push(r); r.accetta(r.rientro ? {} : { personaggioId: 'pg1' }); };
    const mopts = { suErrore: (t) => errori.push(t) };
    const r1 = rete3(st, mopts, accetta);
    const perse = [];
    const c1 = r1.unisci('Ale', { suPersa: (t) => perse.push(t) });
    await pausa();
    const id = c1.g.stato().id;
    r1.m.impostaPermessi(null, { confermaManuale: true });
    const iid = c1.g.intenzione('domanda', { testo: 'Ci sono trappole?' });
    r1.m.richiediTiro(id, { caratteristica: 'DES', cd: 12 });
    await pausa();
    // Il collegamento cade: richieste annullate dal master, il giocatore vede «Connessione persa».
    c1.a.chiudi();
    await pausa();
    eq([c1.g.stato().stato, perse.length, r1.m.giocatori()[0].stato], ['persa', 1, 'disconnesso'], 'connessione persa');
    ok(errori.some((t) => t.includes('annullate')), 'richieste in sospeso annullate con avviso');
    ok(c1.esiti.every((e) => e.id !== iid || e.stato !== 'attesa'), 'nessuna richiesta lasciata in attesa');
    // Rientra: nuovo scambio, stesso gettone, stesso posto e personaggio.
    const [a2, b2] = NET().trasporto.coppiaMemoria();
    r1.m.collega(b2);
    eq(c1.g.riconnetti(a2), true);
    await pausa();
    eq([c1.g.stato().stato, c1.g.stato().id, c1.g.stato().vista.io.personaggioId, richieste.pop().rientro.gettone], ['attivo', id, 'pg1', true], 'rientro con il gettone');
    // Il master chiude e riapre: riprende con i gettoni salvati, i codici sono nuovi.
    const gettoni = r1.m.esportaGettoni();
    r1.m.termina('Il master ha chiuso l\'app.');
    await pausa();
    eq(c1.g.stato().stato, 'finito');
    const r2 = rete3(st, { gettoni }, accetta);
    const [a3, b3] = NET().trasporto.coppiaMemoria();
    r2.m.collega(b3);
    c1.g.riconnetti(a3);
    await pausa();
    eq([c1.g.stato().stato, c1.g.stato().id, c1.g.stato().vista.io.personaggioId], ['attivo', id, 'pg1'], 'sessione ripresa: personaggio ancora legato');
  });

  test('Online 3: carico simulato (6 client, 200 eventi), limiti, espulsione per frequenza, diagnostica e riepilogo', async () => {
    const st = seiState();
    const { m, unisci } = rete3(st, {}, sceltaSei);
    const cl = [1, 2, 3, 4, 5, 6].map((i) => unisci('G' + i));
    await pausa();
    const c = S().current(st).combat;
    const g1 = c.combatants.find((x) => x.id === 'g1');
    // Tempo di calcolo del master (filtro, differenze, invio), senza le attese tra un gruppo e l'altro.
    let durata = 0;
    for (let i = 0; i < 200; i++) {
      g1.pos = { x: i % 10, y: 5 + (i % 3) };
      if (i % 10 === 0) DnD.dati.pushLog(c, 'sistema', 'Evento ' + i);
      const t0 = performance.now();
      m.aggiorna();
      durata += performance.now() - t0;
      if (i % 20 === 19) await pausa();
    }
    await pausa();
    for (const x of cl) eq(x.g.stato().vista, m.vistaInviata(x.g.stato().id), 'vista coerente dopo il carico');
    const max = Math.max(...cl.flatMap((x) => x.inviati.map((t) => t.length)));
    ok(max < 64 * 1024, 'messaggio più grande ' + max + ' byte');
    ok(durata < 8000, '200 eventi × 6 client in ' + Math.round(durata) + ' ms di calcolo');
    const diag = m.diagnostica();
    eq([diag.giocatori, diag.client.length, diag.client.every((x) => x.byte > 0 && x.messaggi > 200)], [6, 6, true], 'diagnostica per client');
    // Limiti: messaggio troppo grande e raffica di richieste con espulsione automatica.
    const r2 = rete3(seiState(), { espelliFrequenza: true, soglia: 3 }, sceltaSei);
    const sp = r2.unisci('G1');
    await pausa();
    sp.a.invia('x'.repeat(NET().protocollo.LIMITI.daGiocatore + 10));
    for (let i = 0; i < 60; i++) sp.g.intenzione('ping', { x: 1, y: 1 });
    await pausa();
    await pausa();
    eq(sp.g.stato().stato, 'espulso', 'espulso oltre la soglia');
    ok(r2.m.diagnostica().errori.length > 0, 'ultimi errori nella diagnostica');
    // Riepilogo di fine partita (giocatore) e log completo (master).
    m.chat('Fine della serata');
    await pausa();
    const testo = cl[0].g.riepilogo();
    ok(testo.includes('Fine della serata') && testo.includes('— Combattimento —') && testo.includes('Evento 190') && !testo.includes('Assassino'), 'riepilogo filtrato');
    ok(m.registroCompleto().some((r) => r.includes('Fine della serata')), 'log del master');
  });

  // --- Rete di sicurezza del riordino: migrazione dell'archivio di esempio e test di fumo dell'app ---
  // Primo punto in cui due JSON differiscono (per capire subito cosa è cambiato).
  function primaDifferenza(a, b, path) {
    const p = path || '$';
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return p + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = primaDifferenza(a[k], b[k], p + '.' + k);
      if (d) return d;
    }
    return p;
  }
  const leggiFixture = async (nome) => {
    const res = await fetch('test/fixture/' + nome, { cache: 'no-store' });
    if (!res.ok) throw new Error('fixture ' + nome + ' non trovata (apri test.html da un server)');
    return res.text();
  };

  // L'archivio è stato esportato prima del riordino (versione 18); il risultato atteso è la sua normalizzazione di allora.
  test('Migrazione: l\'archivio di esempio di prima del riordino si importa identico (nessun dato perso)', async () => {
    if (location.protocol === 'file:') return; // fetch delle fixture solo da server
    const testo = await leggiFixture('archivio-v18.json');
    const atteso = JSON.parse(await leggiFixture('atteso-v18.json'));
    const stato = JSON.parse(JSON.stringify(DnD.dati.importJSON(testo)));
    const d = primaDifferenza(stato, atteso);
    ok(!d, 'normalizzazione cambiata: ' + d);
    // Ogni id dell'archivio originale c'è ancora dopo l'importazione.
    const ids = (t) => new Set([...t.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]));
    const dopo = ids(JSON.stringify(stato));
    const persi = [...ids(testo)].filter((id) => !dopo.has(id));
    eq(persi, [], 'id persi');
  });

  test('Misure: caselle da metri (per difetto, con tolleranza) e conversioni piedi/metri', () => {
    const MI = DnD.misure;
    eq([MI.celleDaMetri(4.5), MI.celleDaMetri(1.4), MI.celleDaMetri(9), MI.celleDaMetri(0)], [3, 0, 6, 0]);
    eq([DnD.movimento.feetFromMeters(9), DnD.movimento.metersFromFeet(30), DnD.movimento.cellsOf(35, 5)], [30, 9, 7]);
    eq([DnD.movimento.distance({ x: 0, y: 0 }, { x: 3, y: 2 }), DnD.movimento.distance({ x: 0, y: 0 }, { x: 3, y: 2 }, { diagonals: 'alternata' })], [3, 4]);
  });

  // index.html, test.html e sw.js elencano gli stessi script (test.html: senza app.js, con test.js) e gli stessi CSS.
  test('Elenchi dei file: index.html, test.html e cache del service worker allineati', async () => {
    if (location.protocol === 'file:') return;
    const testo = async (url) => (await fetch(url, { cache: 'no-store' })).text();
    const [index, pagina, sw] = await Promise.all([testo('index.html'), testo('test.html'), testo('sw.js')]);
    const script = (html) => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const css = (html) => [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    const cache = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
    eq(script(pagina), script(index).filter((s) => s !== 'js/app.js').concat('js/test.js'), 'script di test.html');
    eq(cache.filter((f) => f.endsWith('.js')), script(index), 'script in cache');
    eq(cache.filter((f) => f.endsWith('.css')), css(index), 'CSS in cache');
  });

  // Carica l'app vera (index.html?prova: archivio in memoria) in un iframe e la usa come farebbe il master.
  test('Fumo: sezioni, giocatore, nemico, griglia, sessione, combattimento, esporta e importa senza errori', async () => {
    if (location.protocol === 'file:' || typeof document === 'undefined') return;
    const preferenze = Object.assign({}, localStorage); // l'iframe condivide localStorage: si ripristina alla fine
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;opacity:0;pointer-events:none';
    frame.src = 'index.html?prova';
    const errori = [];
    const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
    // Avvio lento senza cache (oltre 100 script) e timer rallentati se la pagina è in secondo piano: si misura il
    // tempo trascorso, non i giri, fino a 2 minuti.
    const fino = async (cond, cosa) => {
      const limite = Date.now() + 120000;
      while (Date.now() < limite) { if (cond()) return; await attesa(25); }
      throw new Error('tempo scaduto: ' + cosa);
    };
    try {
      document.body.append(frame);
      await fino(() => frame.contentWindow && frame.contentWindow.DnD && frame.contentWindow.DnD.store, 'avvio dell\'app');
      const W = frame.contentWindow;
      const A = W.DnD;
      W.addEventListener('error', (e) => errori.push('errore: ' + e.message));
      W.addEventListener('unhandledrejection', (e) => errori.push('promessa: ' + (e.reason && e.reason.message)));
      const errConsole = W.console.error;
      W.console.error = (...x) => { errori.push('console: ' + x.join(' ')); errConsole.apply(W.console, x); };
      W.confirm = () => true;
      W.alert = () => {};
      let scaricato = null;
      W.HTMLAnchorElement.prototype.click = function () { if (this.download) scaricato = this.href; };
      const main = W.document.getElementById('main');
      const pulsante = (radice, testo) => {
        const b = [...radice.querySelectorAll('button')].reverse().find((x) => x.textContent.trim() === testo);
        if (!b) throw new Error('pulsante «' + testo + '» non trovato');
        return b;
      };
      const dialogo = () => W.document.querySelector('dialog.modal[open]');
      eq(A.store.backend, 'memoria', 'archivio di prova');
      // Ogni sezione del menù si apre.
      for (const id of A.config.SECTIONS) {
        ok(A.app.show(id), 'sezione ' + id);
        await attesa(30);
        ok(main.children.length > 0, 'sezione vuota: ' + id);
      }
      // Sessione nuova (nome dal dialogo).
      A.uiSessioni.newSession();
      await attesa(30);
      dialogo().querySelector('input').value = 'Sessione fumo';
      pulsante(dialogo(), 'Conferma').click();
      await attesa(50);
      eq(A.sessioni.current(A.store.state).name, 'Sessione fumo');
      // Giocatore e nemico con i valori predefiniti.
      A.app.show('giocatori', 'nuovo');
      await attesa(50);
      pulsante(main, 'Salva').click();
      await attesa(50);
      eq(A.store.state.players.length, 1, 'giocatore salvato');
      A.app.show('nemici', 'nuovo');
      await attesa(50);
      const nome = main.querySelector('input[type=text], input:not([type])');
      nome.value = 'Orco di prova';
      nome.dispatchEvent(new W.Event('input', { bubbles: true }));
      pulsante(main, 'Salva').click();
      await attesa(50);
      ok(A.store.state.npcs.some((n) => n.name === 'Orco di prova'), 'nemico salvato');
      // Griglia nuova nell'editor, salvata.
      A.app.show('editor');
      await attesa(50);
      pulsante(main, 'Crea una griglia').click();
      await attesa(50);
      const ng = dialogo().querySelector('[data-key=name]');
      ng.value = 'Griglia fumo';
      ng.dispatchEvent(new W.Event('input', { bubbles: true }));
      pulsante(dialogo(), 'Crea griglia').click();
      await attesa(50);
      pulsante(main, '💾 Salva').click();
      await attesa(50);
      ok(A.store.state.savedGrids.some((g) => g.name === 'Griglia fumo'), 'griglia salvata');
      // Combattimento breve: tutti i partecipanti scelti, iniziativa, due turni.
      A.app.show('combattimento');
      await attesa(50);
      for (const c of main.querySelectorAll('input[type=checkbox]')) if (!c.checked) { c.checked = true; c.dispatchEvent(new W.Event('change', { bubbles: true })); }
      for (const q of main.querySelectorAll('input[aria-label^="Quantità"]')) if (Number(q.value) === 0) { q.value = '1'; q.dispatchEvent(new W.Event('input', { bubbles: true })); q.dispatchEvent(new W.Event('change', { bubbles: true })); }
      await attesa(50);
      pulsante(main, 'Tira l\'iniziativa').click();
      await attesa(100);
      pulsante(main, 'Inizia combattimento').click();
      await attesa(100);
      const cmb = A.sessioni.current(A.store.state).combat;
      ok(cmb && cmb.combatants.length >= 2, 'combattimento avviato con ' + (cmb ? cmb.combatants.length : 0) + ' combattenti');
      const round = cmb.round;
      for (let i = 0; i < cmb.combatants.length; i++) { pulsante(main, 'Prossimo turno ▶').click(); await attesa(30); }
      ok(A.sessioni.current(A.store.state).combat.round > round, 'il round avanza');
      // Esporta l'archivio e lo reimporta.
      await A.uiImpostazioni.exportArchive();
      ok(scaricato, 'archivio esportato');
      const testo = await (await W.fetch(scaricato)).text();
      const prima = JSON.stringify(A.dati.importJSON(testo));
      await A.uiImpostazioni.importFile(new W.File([testo], 'archivio.json'));
      await A.store.saved();
      eq(JSON.stringify(A.store.state), prima, 'stato dopo l\'importazione');
      ok(A.store.state.npcs.some((n) => n.name === 'Orco di prova'), 'nemico ancora presente');
      eq(errori, [], 'errori in console');
    } finally {
      frame.remove();
      localStorage.clear();
      for (const [k, v] of Object.entries(preferenze)) localStorage.setItem(k, v);
    }
  });

  // solo: facoltativo, esegue solo i test il cui nome contiene questo testo.
  async function runTests(solo) {
    const results = [];
    for (const { name, fn } of tests) {
      if (solo && !name.includes(solo)) continue;
      DnD.testInCorso = name; // per capire quale test si blocca
      try {
        await fn();
        results.push({ name, ok: true });
      } catch (e) {
        results.push({ name, ok: false, error: e.message });
      }
    }
    return results;
  }

  DnD.runTests = runTests;
})(globalThis.DnD = globalThis.DnD || {});
