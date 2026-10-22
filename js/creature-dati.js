// Tabelle delle creature (formato del Manuale dei Mostri, regole 5e): taglie, tipi, gradi di sfida,
// bonus di competenza e PE, tipi di danno, condizioni, abilità, tabella della Guida del DM per la stima
// del grado di sfida e tre creature d'esempio ORIGINALI (inventate per questa app, modificabili ed eliminabili).
(function (DnD) {
  'use strict';

  const SIZES = ['Minuscola', 'Piccola', 'Media', 'Grande', 'Enorme', 'Mastodontica'];
  const HIT_DIE = { Minuscola: 4, Piccola: 6, Media: 8, Grande: 10, Enorme: 12, Mastodontica: 20 };
  const TYPES = ['aberrazione', 'bestia', 'celestiale', 'costrutto', 'drago', 'elementale', 'fatato', 'immondo', 'gigante',
    'umanoide', 'melma', 'mostruosità', 'non morto', 'vegetale'];
  const ALIGNMENTS = ['legale buono', 'neutrale buono', 'caotico buono', 'legale neutrale', 'neutrale', 'caotico neutrale',
    'legale malvagio', 'neutrale malvagio', 'caotico malvagio', 'senza allineamento', 'qualsiasi allineamento'];

  const CRS = ['0', '1/8', '1/4', '1/2'].concat(Array.from({ length: 30 }, (_, i) => String(i + 1)));
  const XP = {
    0: 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
    11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
    21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
  };

  const DAMAGE_TYPES = ['acido', 'contundente', 'freddo', 'fulmine', 'fuoco', 'forza', 'necrotico', 'perforante', 'psichico', 'radioso',
    'tagliente', 'tuono', 'veleno'];
  // Voci speciali: danni fisici da attacchi non magici.
  const NON_MAGICAL = { 'contundente-nm': 'contundente', 'perforante-nm': 'perforante', 'tagliente-nm': 'tagliente' };
  const DEFENSE_TYPES = DAMAGE_TYPES.concat(Object.keys(NON_MAGICAL));
  const DEFENSE_NAMES = Object.assign(Object.fromEntries(DAMAGE_TYPES.map((t) => [t, t])), {
    'contundente-nm': 'contundente da attacchi non magici', 'perforante-nm': 'perforante da attacchi non magici', 'tagliente-nm': 'tagliente da attacchi non magici',
  });

  const CONDITIONS = ['accecato', 'affascinato', 'afferrato', 'assordato', 'avvelenato', 'incapacitato', 'indebolimento', 'invisibile',
    'paralizzato', 'pietrificato', 'privo di sensi', 'prono', 'spaventato', 'stordito', 'trattenuto'];

  const SKILLS = {
    'Acrobazia': 'DES', 'Addestrare animali': 'SAG', 'Arcano': 'INT', 'Atletica': 'FOR', 'Furtività': 'DES', 'Indagare': 'INT',
    'Inganno': 'CAR', 'Intimidire': 'CAR', 'Intrattenere': 'CAR', 'Intuizione': 'SAG', 'Medicina': 'SAG', 'Natura': 'INT',
    'Percezione': 'SAG', 'Persuasione': 'CAR', 'Rapidità di mano': 'DES', 'Religione': 'INT', 'Sopravvivenza': 'SAG', 'Storia': 'INT',
  };

  const SPEEDS = ['walk', 'burrow', 'climb', 'fly', 'swim'];
  const SPEED_NAMES = { walk: 'A piedi', burrow: 'Scavare', climb: 'Scalare', fly: 'Volare', swim: 'Nuotare' };
  const SENSES = ['darkvision', 'blindsight', 'truesight', 'tremorsense'];
  const SENSE_NAMES = { darkvision: 'scurovisione', blindsight: 'vista cieca', truesight: 'vista pura', tremorsense: 'percezione tellurica' };

  const GROUPS = ['traits', 'actions', 'bonusActions', 'reactions', 'legendary', 'lair'];
  const GROUP_NAMES = { traits: 'Tratti speciali', actions: 'Azioni', bonusActions: 'Azioni bonus', reactions: 'Reazioni', legendary: 'Azioni leggendarie', lair: 'Azioni di tana' };
  const MECHS = ['attacco', 'salvezza', 'cura', 'multiattacco', 'testo'];
  const MECH_NAMES = { attacco: 'Attacco', salvezza: 'Tiro salvezza', cura: 'Cura', multiattacco: 'Multiattacco', testo: 'Solo testo' };
  const FREQS = ['volonta', 'giorno', 'ricarica', 'riposo-breve', 'riposo-lungo'];
  const FREQ_NAMES = { volonta: 'A volontà', giorno: 'N volte al giorno', ricarica: 'Ricarica', 'riposo-breve': 'Dopo un riposo breve o lungo', 'riposo-lungo': 'Dopo un riposo lungo' };
  const RANGES = ['mischia', 'distanza', 'entrambi'];
  const RANGE_NAMES = { mischia: 'Mischia', distanza: 'Distanza', entrambi: 'Mischia o distanza' };

  // Guida del Dungeon Master, "Statistiche dei mostri per grado di sfida":
  // [GS, CA, PF min, PF max, bonus d'attacco, danni per round min, max, CD del tiro salvezza].
  const DMG_TABLE = [
    ['0', 13, 1, 6, 3, 0, 1, 13], ['1/8', 13, 7, 35, 3, 2, 3, 13], ['1/4', 13, 36, 49, 3, 4, 5, 13], ['1/2', 13, 50, 70, 3, 6, 8, 13],
    ['1', 13, 71, 85, 3, 9, 14, 13], ['2', 13, 86, 100, 3, 15, 20, 13], ['3', 13, 101, 115, 4, 21, 26, 13], ['4', 14, 116, 130, 5, 27, 32, 14],
    ['5', 15, 131, 145, 6, 33, 38, 15], ['6', 15, 146, 160, 6, 39, 44, 15], ['7', 15, 161, 175, 6, 45, 50, 15], ['8', 16, 176, 190, 7, 51, 56, 16],
    ['9', 16, 191, 205, 7, 57, 62, 16], ['10', 17, 206, 220, 7, 63, 68, 16], ['11', 17, 221, 235, 8, 69, 74, 17], ['12', 17, 236, 250, 8, 75, 80, 17],
    ['13', 18, 251, 265, 8, 81, 86, 18], ['14', 18, 266, 280, 8, 87, 92, 18], ['15', 18, 281, 295, 8, 93, 98, 18], ['16', 18, 296, 310, 9, 99, 104, 18],
    ['17', 19, 311, 325, 10, 105, 110, 19], ['18', 19, 326, 340, 10, 111, 116, 19], ['19', 19, 341, 355, 10, 117, 122, 19], ['20', 19, 356, 400, 10, 123, 140, 19],
    ['21', 19, 401, 445, 11, 141, 158, 20], ['22', 19, 446, 490, 11, 159, 176, 20], ['23', 19, 491, 535, 11, 177, 194, 20], ['24', 19, 536, 580, 12, 195, 212, 21],
    ['25', 19, 581, 625, 12, 213, 230, 21], ['26', 19, 626, 670, 12, 231, 248, 21], ['27', 19, 671, 715, 13, 249, 266, 22], ['28', 19, 716, 760, 13, 267, 284, 22],
    ['29', 19, 761, 805, 13, 285, 302, 22], ['30', 19, 806, 850, 14, 303, 320, 23],
  ];
  // Moltiplicatori dei PF effettivi per resistenze e immunità, secondo il GS atteso: [GS massimo, resistenze, immunità].
  const EFFECTIVE_HP = [[4, 2, 2], [10, 1.5, 2], [16, 1.25, 1.5], [30, 1, 1.25]];

  // ---------- Creature d'esempio (originali) ----------
  const dmg = (dice, type, bonus) => ({ dice, type, bonus: bonus === undefined ? null : bonus });
  const attack = (id, name, range, damages, extra) => ({ id, name, desc: '', customText: false, mech: Object.assign({ kind: 'attacco', range, ability: 'FOR', toHit: null, reach: 1.5, rangeNormal: 0, rangeLong: 0, targets: 'un bersaglio', damages, magical: false }, extra) });
  const save = (id, name, ability, dcAbility, damages, extra) => ({ id, name, desc: '', customText: false, mech: Object.assign({ kind: 'salvezza', ability, dcAbility, dc: null, damages, half: true, effect: '', area: '' }, extra) });
  const text = (id, name, desc) => ({ id, name, desc, customText: true, mech: { kind: 'testo' } });

  function examples() {
    return [
      {
        id: 'esempio-cinghiale-paludi', type: 'creatura', name: 'Cinghiale delle paludi', size: 'Media', ctype: 'bestia', subtype: '', alignment: 'senza allineamento',
        ac: 12, acDesc: 'armatura naturale', hitDice: 4, hpOverride: null,
        speed: { walk: 12, burrow: 0, climb: 0, fly: 0, hover: false, swim: 6 },
        abilities: { FOR: 15, DES: 11, COS: 15, INT: 2, SAG: 10, CAR: 4 },
        saves: [], skills: { 'Percezione': 1 }, vulnerabilities: [], resistances: [], immunities: [], conditionImmunities: [],
        senses: { darkvision: 0, blindsight: 0, truesight: 0, tremorsense: 0 }, languages: '', cr: '1',
        traits: [text('t1', 'Carica fangosa', 'Se il cinghiale si muove di almeno 6 m in linea retta verso un bersaglio e lo colpisce con le zanne nello stesso turno, il bersaglio subisce 3 (1d6) danni perforanti extra e deve superare un tiro salvezza su Forza con CD 12 o cadere prono.'),
          text('t2', 'Ostinato (Ricarica dopo un riposo breve o lungo)', 'Se subisce 7 danni o meno che lo porterebbero a 0 punti ferita, scende invece a 1 punto ferita.')],
        actions: [attack('a1', 'Zanne', 'mischia', [dmg('1d8', 'perforante')])],
        bonusActions: [], reactions: [], legendary: [], lair: [], legendaryResistance: 0, legendaryPoints: 3,
        innate: { ability: 'CAR', dcOverride: null, attackOverride: null, spells: [] },
        notes: 'Creatura d\'esempio originale: mostra i tratti speciali.',
      },
      {
        id: 'esempio-sentinella-bronzo', type: 'creatura', name: 'Sentinella di bronzo', size: 'Grande', ctype: 'costrutto', subtype: '', alignment: 'senza allineamento',
        ac: 17, acDesc: 'armatura naturale', hitDice: 10, hpOverride: null,
        speed: { walk: 9, burrow: 0, climb: 0, fly: 0, hover: false, swim: 0 },
        abilities: { FOR: 19, DES: 9, COS: 17, INT: 3, SAG: 11, CAR: 1 },
        saves: [], skills: {}, vulnerabilities: [], resistances: ['contundente-nm', 'perforante-nm', 'tagliente-nm'], immunities: ['veleno', 'psichico'],
        conditionImmunities: ['affascinato', 'avvelenato', 'indebolimento', 'paralizzato', 'pietrificato', 'spaventato'],
        senses: { darkvision: 18, blindsight: 0, truesight: 0, tremorsense: 0 }, languages: 'capisce i comandi di chi l\'ha creata ma non parla', cr: '5',
        traits: [text('t1', 'Forma immutabile', 'La sentinella è immune a qualsiasi incantesimo o effetto che ne altererebbe la forma.')],
        actions: [
          { id: 'a0', name: 'Multiattacco', desc: '', customText: false, mech: { kind: 'multiattacco', parts: [{ actionId: 'a1', count: 2 }] } },
          attack('a1', 'Maglio', 'mischia', [dmg('2d8', 'contundente')]),
          Object.assign(save('a2', 'Vapore rovente', 'COS', 'COS', [dmg('6d6', 'fuoco', 0)], { area: 'cono di 4,5 m' }), { freq: { kind: 'ricarica', recharge: 5 } }),
        ],
        bonusActions: [], reactions: [], legendary: [], lair: [], legendaryResistance: 0, legendaryPoints: 3,
        innate: { ability: 'CAR', dcOverride: null, attackOverride: null, spells: [] },
        notes: 'Creatura d\'esempio originale: mostra multiattacco, ricarica e immunità.',
      },
      {
        id: 'esempio-drago-cenere', type: 'creatura', name: 'Drago di cenere giovane', size: 'Grande', ctype: 'drago', subtype: '', alignment: 'caotico malvagio',
        ac: 17, acDesc: 'armatura naturale', hitDice: 13, hpOverride: null,
        speed: { walk: 12, burrow: 6, climb: 0, fly: 24, hover: false, swim: 0 },
        abilities: { FOR: 19, DES: 12, COS: 18, INT: 12, SAG: 13, CAR: 15 },
        saves: ['DES', 'COS', 'SAG', 'CAR'], skills: { 'Percezione': 2, 'Furtività': 1 }, vulnerabilities: [], resistances: [], immunities: ['fuoco'], conditionImmunities: [],
        senses: { darkvision: 36, blindsight: 9, truesight: 0, tremorsense: 0 }, languages: 'Comune, Draconico', cr: '8',
        traits: [text('t1', 'Velo di fumo', 'Il drago ha vantaggio alle prove di Destrezza (Furtività) fatte in aree di fumo o cenere.')],
        actions: [
          { id: 'a0', name: 'Multiattacco', desc: '', customText: false, mech: { kind: 'multiattacco', parts: [{ actionId: 'a1', count: 1 }, { actionId: 'a2', count: 2 }] } },
          attack('a1', 'Morso', 'mischia', [dmg('2d10', 'perforante'), dmg('1d6', 'fuoco', 0)], { reach: 3 }),
          attack('a2', 'Artiglio', 'mischia', [dmg('2d6', 'tagliente')]),
          Object.assign(save('a3', 'Soffio di cenere', 'DES', 'COS', [dmg('10d6', 'fuoco', 0)], { area: 'cono di 9 m' }), { freq: { kind: 'ricarica', recharge: 5 } }),
        ],
        bonusActions: [],
        reactions: [text('r1', 'Ali di fuliggine', 'Quando una creatura che il drago può vedere lo manca con un attacco, il drago può volare fino a metà della sua velocità senza provocare attacchi di opportunità.')],
        legendary: [
          Object.assign(text('l1', 'Individuare', 'Il drago effettua una prova di Saggezza (Percezione).'), { cost: 1 }),
          Object.assign(attack('l2', 'Colpo di coda', 'mischia', [dmg('2d8', 'contundente')], { reach: 4.5 }), { cost: 1 }),
          Object.assign(save('l3', 'Battito d\'ali', 'DES', 'FOR', [dmg('2d6', 'contundente', 4)], { area: 'entro 3 m', half: false, effect: 'cade prono' }), { cost: 2 }),
        ],
        lair: [text('ta1', 'Pioggia di braci', 'A iniziativa 20 il drago fa piovere braci in un cerchio di 6 m che vede: chi è nell\'area tira su Destrezza (CD 13) o subisce 7 (2d6) danni da fuoco.')],
        legendaryResistance: 1, legendaryPoints: 3,
        innate: { ability: 'CAR', dcOverride: null, attackOverride: null, spells: [] },
        notes: 'Creatura d\'esempio originale: mostra multiattacco, ricarica, azioni leggendarie, Resistenza leggendaria e azioni di tana.',
      },
      {
        // Boss d'esempio originale (inventato per questa app): 3 fasi, azioni leggendarie, tana e tema Infernale.
        id: 'esempio-boss-skarnoth', type: 'boss', name: 'Skarnoth', size: 'Enorme', ctype: 'immondo', subtype: 'demone', alignment: 'caotico malvagio',
        ac: 18, acDesc: 'armatura naturale', hitDice: 18, hpOverride: null,
        speed: { walk: 12, burrow: 0, climb: 0, fly: 0, hover: false, swim: 0 },
        abilities: { FOR: 23, DES: 11, COS: 21, INT: 14, SAG: 15, CAR: 18 },
        saves: ['FOR', 'COS', 'SAG'], skills: { 'Intimidire': 1, 'Percezione': 1 }, vulnerabilities: [], resistances: ['freddo', 'fulmine'], immunities: ['fuoco', 'veleno'],
        conditionImmunities: ['avvelenato', 'spaventato'],
        senses: { darkvision: 36, blindsight: 0, truesight: 9, tremorsense: 0 }, languages: 'Abissale, Comune', cr: '12',
        icon: { kind: 'library', icon: 'signore-abissi', color: '#d4453a' },
        traits: [text('t1', 'Corpo di brace', 'Una creatura che tocca Skarnoth o lo colpisce con un attacco in mischia entro 1,5 m subisce 5 (1d10) danni da fuoco.')],
        actions: [
          { id: 'a0', name: 'Multiattacco', desc: '', customText: false, mech: { kind: 'multiattacco', parts: [{ actionId: 'a1', count: 2 }, { actionId: 'a2', count: 1 }] } },
          attack('a1', 'Artiglio rovente', 'mischia', [dmg('2d8', 'tagliente'), dmg('1d8', 'fuoco', 0)], { reach: 3 }),
          attack('a2', 'Frusta di catene', 'mischia', [dmg('2d6', 'contundente')], { reach: 4.5 }),
          Object.assign(save('a3', 'Eruzione', 'DES', 'COS', [dmg('8d6', 'fuoco', 0)], { area: 'sfera di 6 m entro 18 m' }), { freq: { kind: 'ricarica', recharge: 5 } }),
          Object.assign(save('a4', 'Cuore di fornace', 'COS', 'CAR', [dmg('10d8', 'fuoco', 0)], { area: 'entro 9 m' }), { freq: { kind: 'giorno', uses: 1 } }),
        ],
        bonusActions: [],
        reactions: [text('r1', 'Catene di risposta', 'Quando una creatura entro 4,5 m lo colpisce, Skarnoth la tira fino a 3 m verso di sé.')],
        legendary: [
          Object.assign(text('l1', 'Passo di cenere', 'Skarnoth si muove fino a metà della sua velocità.'), { cost: 1 }),
          Object.assign(attack('l2', 'Sferzata', 'mischia', [dmg('2d6', 'contundente')], { reach: 4.5 }), { cost: 1 }),
          Object.assign(save('l3', 'Ondata di braci', 'DES', 'COS', [dmg('3d6', 'fuoco', 0)], { area: 'entro 3 m' }), { cost: 2 }),
        ],
        lair: [text('ta1', 'Crepe nel suolo', 'A iniziativa 20 il pavimento si spacca in una linea di 9 m: chi è sulla linea tira su Destrezza (CD 15) o cade prono e subisce 7 (2d6) danni da fuoco.')],
        legendaryResistance: 2, legendaryPoints: 3,
        innate: { ability: 'CAR', dcOverride: null, attackOverride: null, spells: [] },
        behavior: { temperament: 'furbo' },
        boss: {
          title: 'La Fornace che Cammina', epithet: 'Signore delle Ceneri', theme: 'infernale', aura: 2, scaleByPlayers: false,
          intro: 'Il calore arriva prima di lui: l\'aria trema, le pareti si coprono di fuliggine. Poi le catene, trascinate sulla pietra, e due occhi come carboni nel buio.',
          phases: [
            { id: 'f1', threshold: 100, name: 'Il Risveglio', note: 'Skarnoth studia il gruppo e colpisce chi sembra più fragile.', effect: 'nessuno', temperament: '', enable: [], disable: [] },
            { id: 'f2', threshold: 60, name: 'Catene spezzate', note: 'Le catene si spezzano: diventa Aggressivo e non arretra più.', effect: 'tremolio', temperament: 'aggressivo', enable: [], disable: [] },
            { id: 'f3', threshold: 25, name: 'Cuore di fornace', note: 'Il petto si apre: sblocca Cuore di fornace (una volta).', effect: 'lampo', temperament: '', enable: ['a4'], disable: [] },
          ],
        },
        notes: 'Boss d\'esempio originale: 3 fasi con cambio di temperamento e un\'azione sbloccata nell\'ultima fase.',
      },
    ];
  }

  DnD.creatureDati = {
    SIZES, HIT_DIE, TYPES, ALIGNMENTS, CRS, XP, DAMAGE_TYPES, NON_MAGICAL, DEFENSE_TYPES, DEFENSE_NAMES, CONDITIONS, SKILLS,
    SPEEDS, SPEED_NAMES, SENSES, SENSE_NAMES, GROUPS, GROUP_NAMES, MECHS, MECH_NAMES, FREQS, FREQ_NAMES, RANGES, RANGE_NAMES,
    DMG_TABLE, EFFECTIVE_HP, examples,
  };
})(globalThis.DnD = globalThis.DnD || {});
