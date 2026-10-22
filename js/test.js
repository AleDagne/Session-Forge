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
    const list = R().createCombatants([eroe], [{ npc: goblin, quantity: 3 }], [race], seq(10, 5, 6, 7));
    eq(list.map((c) => c.name), ['Eroe', 'Goblin 1', 'Goblin 2', 'Goblin 3']);
    eq(list.map((c) => c.initiative), [10, 8, 9, 10]);
    list[1].hp = 1;
    list[1].weapons[0].name = 'Rotta';
    eq(list[2].hp, 7, 'PF indipendenti');
    eq(list[2].weapons[0].name, 'Scimitarra', 'armi indipendenti');
    eq(goblin.weapons[0].name, 'Scimitarra', 'modello originale intatto');
    eq(R().createCombatants([], [{ npc: goblin, quantity: 1 }], [], seq(1))[0].name, 'Goblin');
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
      combatants: R().createCombatants(players, [{ npc: goblin, quantity: qty }], [], () => 10),
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
    const [c] = R().createCombatants([], [{ npc: ogre, quantity: 1 }], [big], () => 1);
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
    eq(v1.structures.map((x) => x.name), ['Muro', 'Colonna', 'Albero', 'Tavolo']);
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
    const st = R().derivedStats(monk, race);
    eq([st.ac.total, st.profBonus, st.saves], [15, 3, ['FOR', 'DES']]);
    eq(st.saveTotals, { FOR: 3, DES: 6, COS: 2, INT: 0, SAG: 2, CAR: -1 });
    const [c] = R().createCombatants([monk], [], [race], () => 10);
    eq([c.ac, c.saves.DES], [15, 6]);
    monk.profBonusOverride = 9;
    eq(R().derivedStats(monk, race).saveTotals.DES, 12, 'bonus competenza sovrascritto');
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
    eq([1, 3, 4, 7, 8, 12, 16, 19, 20].map(R().asiPointsAvailable), [0, 0, 2, 2, 4, 6, 8, 8, 10]);
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
    const s = R().derivedStats(mage, null).spell;
    eq([s.ability, s.mod, s.attack, s.dc], ['INT', 4, 7, 15]);
    mage.spellcasting.dcOverride = 17;
    mage.spellcasting.ability = 'CAR';
    eq([R().derivedStats(mage, null).spell.dc, R().derivedStats(mage, null).spell.attack], [17, 3], 'sovrascritture');
    eq(R().derivedStats(DnD.dati.normalizeCreature({ name: 'G', classId: 'guerriero' }), null).spell, null, 'non incantatore');
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
    eq(R().derivedStats(pal, null).spell.slotsTotal.reduce((a, b) => a + b), 0);
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
      combatants: R().createCombatants([p, p], [{ npc: g, quantity: 2 }], [big], () => 1),
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
    eq(DnD.config.MENU.map((m) => m.label), ['Editor griglie', 'Combattimento', 'Esplorazione', 'Nemici', 'Giocatori', 'Magie', 'Asset', 'Razze', 'Dadi']);
    eq(DnD.config.MENU.map((m) => m.id), ['editor', 'combattimento', 'esplorazione', 'nemici', 'giocatori', 'magie', 'asset', 'razze', 'dadi'], 'Esplorazione dopo Combattimento');
    eq(DnD.config.MENU.map((m) => m.group), ['mappa', 'mappa', 'mappa', 'personaggi', 'personaggi', 'libreria', 'libreria', 'libreria', 'strumenti']);
    eq(DnD.config.MENU.length, 9, 'scorciatoie Alt+1…Alt+9');
    ok(DnD.config.MENU.every((m) => m.icon.length > 0), 'ogni voce ha un\'icona');
    ok(!DnD.config.SECTIONS.includes('oggetti'), 'gli Oggetti sono dentro Strutture');
    eq(DnD.config.APP_NAME, 'Session Forge');
  });

  test('salvataggio e ripristino di tema e dimensione del testo', () => {
    const I = DnD.impostazioni;
    const st = fakeStorage();
    eq(I.load(st), { theme: 'auto', textSize: 'normale', reduceMotion: false, bossEffects: true }, 'primo avvio');
    eq([I.resolveTheme('auto', true), I.resolveTheme('auto', false)], ['dark', 'light'], 'auto segue il sistema');
    ok(I.save(st, { theme: 'chiaro', textSize: 'grande', reduceMotion: true }));
    eq(I.load(st), { theme: 'chiaro', textSize: 'grande', reduceMotion: true, bossEffects: true });
    eq(I.resolveTheme(I.load(st).theme, true), 'light', 'la scelta salvata ha la precedenza sul sistema');
    st.setItem(I.KEY, '{"theme":"viola","textSize":7}');
    eq(I.load(st), { theme: 'auto', textSize: 'normale', reduceMotion: false, bossEffects: true }, 'valori non validi');
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
        const stats = R().derivedStats(c, genRace({ FOR: 1, DES: 1, COS: 1, INT: 1, SAG: 1, CAR: 1 }));
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
    const acOf = (c) => R().derivedStats(c, race);
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
    ok(R().derivedStats(full, genRace()).spell.dc >= 8 + 3, 'CD calcolata');
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
    const t = TM().withFootprint(TM().imageTiles(ts, 0, selection, {}), byId(ts), 'structure');
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
    const s = TM().regionToTiles(t, { x: 1, y: 2, w: 2, h: 1 }, byId(ts), 'structure');
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
      R = op === 'ruota' ? G().rotateMatrix(R) : G().mirrorMatrix(R);
      for (let l = 0; l < 2; l++) {
        for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
          const base = t.layers[l].data[y * 3 + x];
          if (!base) continue;
          const local = { x: -0.3, y: -0.4 };
          const q = G().applyMatrix(R, x + 0.5 + local.x - 1.5, y + 0.5 + local.y - 1);
          const px = q.x + cur.w / 2;
          const py = q.y + cur.h / 2;
          const c = cur.layers[l].data[Math.floor(py) * cur.w + Math.floor(px)];
          ok(c && c[1] === base[1], op + ': tile ' + base[1] + ' fuori posto');
          const lq = G().applyMatrix(TS().ORIENTS[c[2]], local.x, local.y);
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
    const tA = TM().withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure');
    const placed = DnD.dati.normalizePlacedStructure(Object.assign({ id: 'casa', x: 5, y: 5 }, G().placedFields({ mode: 'tiles', tiles: tA })));
    const board = { combatants: [{ id: 't', size: 1, pos: null }], structures: [placed], items: [], ignoreCollisions: false };
    ok(!G().canPlaceToken(board, 't', 5, 5) && G().canPlaceToken(board, 't', 6, 5) && !G().canPlaceToken(board, 't', 7, 7), 'Modalità A');
    const m = mapWith(4, 1, ts);
    m.layers[0].data = [[0, tid(0, 0), 0], [0, tid(1, 1), 0], [0, tid(2, 2), 0], null];
    eq(TM().footprint(m, byId(ts), 'structure'), '1010', 'dai flag "Bloccante"');
    m.overrides = 'l--b';
    eq(TM().footprint(m, byId(ts), 'structure'), '0011', 'forzate: libera e bloccata');
    m.overrides = '----';
    TS().setTileProps(ts, [tid(1, 1)], { excluded: false, collision: { enabled: true, polygons: [COL().fullRect()] } });
    eq(TM().footprint(m, byId(ts), 'structure'), '1110', 'dal poligono di collisione');
    eq(TM().footprint(m, byId(ts), 'item'), '1110', 'oggetto: celle occupate');
    eq(TM().footprint(m, {}, 'structure'), '0000', 'TileSet sconosciuto: nessun blocco calcolato');
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
    const placed = DnD.dati.normalizePlacedStructure(Object.assign({ x: 2, y: 2 }, G().placedFields({ mode: 'tiles', tiles: TM().withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure') })));
    const board = { combatants: [{ id: 't', size: 1, pos: null }], structures: [placed], items: [], ignoreCollisions: false, tilesets: {} };
    ok(!G().canPlaceToken(board, 't', 2, 2) && G().canPlaceToken(board, 't', 3, 2));
  });

  test('TileSet: dove è usato (avviso prima di eliminare)', () => {
    const ts = lTileset();
    TS().addSource(ts, { imageId: null, imageW: 32, imageH: 32 }, { tileW: 32, tileH: 32 });
    const tiles = TM().withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure');
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
    const casa = DnD.dati.normalizeStructure({ id: 'casa', name: 'Casa', mode: 'tiles', tiles: TM().withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure') });
    const muro = DnD.dati.normalizeStructure({ id: 'muro', name: 'Muro', mode: 'tiles', tiles: TM().withFootprint(TM().imageTiles(ts, 0, '000000111', {}), byId(ts), 'structure') });
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
    const tiles = TM().withFootprint(TM().imageTiles(ts, 0, '100100111', {}), byId(ts), 'structure');
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
    const [ca, cb] = R().createCombatants([], [{ npc: a, quantity: 1 }, { npc: b, quantity: 1 }], [big], () => 10);
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
    eq(R().createCombatants([p], [], [nano], () => 1)[0].defenses.res, ['veleno']);
  });

  test('Creature: multiattacco, ricarica, usi giornalieri e azioni leggendarie', () => {
    const d = ex('esempio-drago-cenere');
    eq(CR().expandMultiattack(d, d.actions[0]).map((a) => a.name), ['Morso', 'Artiglio', 'Artiglio']);
    const [c] = R().createCombatants([], [{ npc: d, quantity: 1 }], [], () => 10);
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
    const [c] = R().createCombatants([], [{ npc: ex('esempio-drago-cenere'), quantity: 1 }], [], () => 10);
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
    const st = R().derivedStats(c, null, cat);
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
    const tFree = TM().withFootprint(Object.assign(TM().imageTiles(free, 0, L, {}), { sel: L }), byId(free), 'structure');
    eq([tFree.w, tFree.h, tFree.cells], [3, 3, L], 'nessun tile Bloccante: bloccano tutti i selezionati');
    const partial = TS().newTileset('parz', 'P');
    TS().addSource(partial, { imageId: null, imageW: 48, imageH: 48 }, { tileW: 16, tileH: 16 });
    TS().setTileProps(partial, [tid(0, 2), tid(1, 2), tid(2, 2)], { blocking: true });
    const tP = TM().withFootprint(TM().imageTiles(partial, 0, L, {}), byId(partial), 'structure');
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
    eq(s.version, 11);
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
    const [c] = R().createCombatants([], [{ npc, quantity: 1 }], [race], () => 10);
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
    const [d] = R().createCombatants([], [{ npc: ex('esempio-drago-cenere'), quantity: 1 }], [], () => 10);
    d.pos = { x: 2, y: 2 };
    const foes = [mkHero({ id: 'a', name: 'Aria', pos: { x: 5, y: 2 } }), mkHero({ id: 'b', name: 'Bran', pos: { x: 5, y: 3 } })];
    const p = plan(aiState([d].concat(foes)), d.id);
    eq([p.action.kind, p.action.name], ['creatura', 'Soffio di cenere'], 'ricarica disponibile e due nemici vicini: soffio. ' + p.reason);
    DnD.creature.consume(d.creature, DnD.creature.allActions(d.creature).find((a) => a.name === 'Soffio di cenere'));
    const p2 = plan(aiState([d].concat(foes)), d.id);
    eq(p2.action.name, 'Multiattacco', 'soffio da ricaricare: multiattacco');
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
    let list = R().createCombatants([hero, hero], [{ npc: boss, quantity: 1 }], [], seq(10, 10, 10), [], []);
    const x = list.find((c) => c.boss);
    eq([x.maxHp, x.hp, x.boss.phase, x.boss.revealed], [100, 100, 0, false], 'senza scala');
    boss.boss.scaleByPlayers = true;
    list = R().createCombatants([hero, hero, hero], [{ npc: boss, quantity: 1 }], [], seq(10, 10, 10, 10), [], []);
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
    const cs = R().createCombatants([hero], [{ npc: gob, quantity: 1 }], [], seq(10, 5), [], []);
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
    eq([s.version, g.kind, g.biomeMap, g.events, g.fog.enabled, g.w], [11, 'battaglia', null, [], false, 20]);
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
    eq([c.type, c.level, c.abilityCap, LG().rank(c), R1.derivedStats(c, null).profBonus], ['leggendario', 33, 30, 13, 10]);
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

  test('Percorso: privilegio creato dall\'utente con usi per riposo, come azione nel combattimento', () => {
    const st = DnD.dati.emptyState();
    const c = legendaryOf(24);
    c.legend.path.nodes.push(PT().normalizeNode({ id: 'f', cost: 1, name: 'Ira', effects: [{ kind: 'privilegio', name: 'Colpo divino', type: 'azione', uses: { kind: 'breve', n: 2 },
      mech: { kind: 'attacco', ability: 'FOR', damages: [{ dice: '4d8', type: 'radioso' }] } }] }));
    c.legend.path.links.push(['nucleo', 'f']);
    c.legend.unlocked = ['nucleo', 'f'];
    const x = R().createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
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
    let x = R().createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    eq(x.legend.transformations, ['t1'], 'disponibile (nessun nodo richiesto)');
    x.hp = 150;
    const r = LG().transform(x, t);
    eq([r.ok, x.abilities.FOR, x.abilities.INT, x.maxHp, x.hp, x.ac, x.w, x.legend.uses.t1], [true, 26, 18, 100, 100, 19, 3, 0], 'FOR, DES, COS dalla forma; INT, SAG, CAR dal personaggio');
    eq([x.boss.title, x.boss.theme, DnD.boss.bars([x], 'giocatori').shown.length], ['Forma del drago · Ali d\'oro', 'gelo', 1], 'barra boss in alto (nome del giocatore + forma)');
    eq(DnD.boss.normalizeCombatBoss(x.boss).theme, 'gelo');
    // Tema vuoto: la forma prende il tema del personaggio (chiave «lg:»), che sopravvive al salvataggio.
    const y = R().createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
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
    x = R().createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
    LG().transform(x, t);
    eq(LG().tick(x).length, 1);
    ok(/fine della durata/.test(LG().tick(x)[0]) && !x.legend.form, 'fine a durata');
    // PF temporanei: si consumano prima; fine anticipata.
    c.legend.transformations = [formOf({ hpMode: 'temporanei', uses: { n: 2 } })];
    x = R().createCombatants([c], [], [], seq(10), st.spells, st.equipment)[0];
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
    eq([mig.version, mig.players[0].type, mig.pathTemplates.length], [11, undefined, 1], 'v10 → v11: giocatori standard, modello d\'esempio');
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

  async function runTests() {
    const results = [];
    for (const { name, fn } of tests) {
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
