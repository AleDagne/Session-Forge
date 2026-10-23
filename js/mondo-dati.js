// Mondo (dati): fazioni predefinite, livelli di relazione, soglie ed effetti della reputazione, atteggiamenti,
// ruoli degli NPC, dimensioni delle città, stati e obiettivi delle quest. Valori e tabelle modificabili qui.
(function (DnD) {
  'use strict';

  // Fazioni predefinite (non eliminabili). Gli id restano quelli del combattimento simulato precedente.
  const BUILTIN = [
    { id: 'giocatori', name: 'Giocatori', color: '#4f8fd6', icon: { kind: 'shape', shape: 'esagono', color: '#4f8fd6' }, description: 'Il party e i suoi alleati diretti.' },
    { id: 'nemici', name: 'Nemici', color: '#d4453a', icon: { kind: 'shape', shape: 'triangolo', color: '#d4453a' }, description: 'Chi combatte contro il party.' },
    { id: 'neutrali', name: 'Neutrali', color: '#8a8f9c', icon: { kind: 'shape', shape: 'cerchio', color: '#8a8f9c' }, description: 'Né amici né nemici dei Nemici: di base stanno con i Giocatori (come i vecchi «Neutrali/Alleati»).' },
  ];
  const BUILTIN_IDS = BUILTIN.map((f) => f.id);

  // Livelli di relazione tra fazioni, dal più amichevole al più ostile.
  const LEVELS = ['alleata', 'amichevole', 'neutrale', 'ostile', 'guerra'];
  const LEVEL_NAMES = { alleata: 'Alleata', amichevole: 'Amichevole', neutrale: 'Neutrale', ostile: 'Ostile', guerra: 'In guerra' };
  const LEVEL_ICONS = { alleata: '🤝', amichevole: '🙂', neutrale: '😐', ostile: '😠', guerra: '⚔' };
  // L'IA attacca questi livelli e supporta questi altri; i neutrali si ignorano.
  const HOSTILE_LEVELS = ['ostile', 'guerra'];
  const ALLY_LEVELS = ['alleata', 'amichevole'];
  // Relazioni di partenza tra le predefinite: le stesse parti del combattimento simulato precedente
  // (Giocatori e Neutrali/Alleati dalla stessa parte, Nemici ostili a entrambi).
  const BUILTIN_RELATIONS = {
    giocatori: { nemici: 'guerra', neutrali: 'amichevole' },
    nemici: { giocatori: 'guerra', neutrali: 'ostile' },
    neutrali: { giocatori: 'amichevole', nemici: 'ostile' },
  };

  // Reputazione da -100 a +100: soglie (valore minimo) modificabili, dalla più bassa alla più alta.
  const REP_MIN = -100;
  const REP_MAX = 100;
  const THRESHOLDS = [
    { id: 'nemico', name: 'Nemico giurato', min: -100 },
    { id: 'ostile', name: 'Ostile', min: -60 },
    { id: 'diffidente', name: 'Diffidente', min: -20 },
    { id: 'neutrale', name: 'Neutrale', min: -5 },
    { id: 'amichevole', name: 'Amichevole', min: 20 },
    { id: 'alleato', name: 'Alleato', min: 50 },
    { id: 'eroe', name: 'Eroe', min: 80 },
  ];

  // Effetti automatici della reputazione (con la fazione dominante per le città, con la fazione dell'NPC per
  // mercanti e atteggiamento). Ogni riga vale da `min` in su (o fino a `max`); si applica la prima che vale.
  const EFFECTS = {
    // Moltiplicatore dei prezzi di vendita dei mercanti (acquisto del party).
    prices: [
      { max: -50, factor: 1.5, text: 'prezzi alti (+50%)' },
      { max: -20, factor: 1.2, text: 'rincaro (+20%)' },
      { min: 80, factor: 0.8, text: 'sconto del 20%' },
      { min: 50, factor: 0.9, text: 'sconto del 10%' },
    ],
    // Atteggiamento della città verso il party.
    city: [
      { max: -50, attitude: 'ostile', text: 'porte chiuse, guardie nemiche' },
      { max: -20, attitude: 'diffidente', text: 'sorvegliati, prezzi più alti' },
      { min: 50, attitude: 'accogliente', text: 'benvenuti, sconti' },
    ],
    // Modificatore all'atteggiamento iniziale degli NPC della fazione (punti, vedi ATTITUDE_SCALE).
    attitude: [
      { max: -50, delta: -2 },
      { max: -20, delta: -1 },
      { min: 80, delta: 2 },
      { min: 20, delta: 1 },
    ],
    // Accesso a quest e città: sotto questa soglia sono bloccate (se la regola «blocca se ostile» è attiva).
    accessMin: -50,
  };
  const CITY_ATTITUDES = { ostile: 'Ostile', diffidente: 'Diffidente', neutrale: 'Neutrale', accogliente: 'Accogliente' };

  // Variazioni di reputazione predefinite (modificabili) per gli eventi ricorrenti.
  const REP_EVENTS = {
    questCompletata: 10, questFallita: -10, uccidiMembro: -15, salvaMembro: 10, attaccaNeutrale: -10, dono: 5, furto: -10,
  };

  // Atteggiamento degli NPC: valore base (da -2 a +2) più il modificatore dalla reputazione.
  const ATTITUDES = ['ostile', 'indifferente', 'amichevole'];
  const ATTITUDE_NAMES = { ostile: 'Ostile', indifferente: 'Indifferente', amichevole: 'Amichevole' };
  const ATTITUDE_SCALE = { ostile: -2, indifferente: 0, amichevole: 2 };
  // Sconto o rincaro del mercante per atteggiamento.
  const ATTITUDE_PRICE = { ostile: 1.25, indifferente: 1, amichevole: 0.95 };

  const ROLES = ['mercante', 'quest', 'combattente', 'informatore'];
  const ROLE_NAMES = { mercante: 'Mercante', quest: 'Datore di quest', combattente: 'Combattente neutrale', informatore: 'Informatore / Altro' };
  const ROLE_ICONS = { mercante: '🪙', quest: '📜', combattente: '🛡', informatore: '💬' };
  // Combattente neutrale: chi difende e come diventa ostile.
  const DEFENDS = ['se', 'fazione', 'party'];
  const DEFEND_NAMES = { se: 'Difende se stesso', fazione: 'Difende alleati e fazione', party: 'Aiuta il party (se amichevole)' };
  const PROVOKE_RULES = ['solo', 'fazione', 'citta'];
  const PROVOKE_NAMES = { solo: 'Solo lui', fazione: 'Tutta la fazione', citta: 'A cerchi di città (tutti gli NPC della città)' };

  // Mercante: margini di base e contrattazione (Persuasione).
  const MERCHANT = { sellMargin: 1, buyMargin: 0.5, haggleDc: 15, haggleStep: 0.1, haggleFail: 0.05, maxHaggle: 0.2 };

  const CITY_SIZES = ['villaggio', 'paese', 'cittadina', 'citta', 'metropoli'];
  const CITY_SIZE_NAMES = { villaggio: 'Villaggio', paese: 'Paese', cittadina: 'Cittadina', citta: 'Città', metropoli: 'Metropoli' };

  // Quest: stati, obiettivi e requisiti.
  const QUEST_STATES = ['disponibile', 'attiva', 'completata', 'fallita', 'scaduta'];
  const QUEST_STATE_NAMES = { disponibile: 'Disponibile', attiva: 'Attiva', completata: 'Completata', fallita: 'Fallita', scaduta: 'Scaduta' };
  const OBJECTIVES = ['parla', 'uccidi', 'raccogli', 'raggiungi', 'evento'];
  const OBJECTIVE_NAMES = { parla: 'Parla con', uccidi: 'Uccidi N creature', raccogli: 'Raccogli oggetti', raggiungi: 'Raggiungi un luogo', evento: 'Completa un evento' };
  const REQUIREMENTS = ['reputazione', 'livello', 'oggetto', 'evento'];
  const REQUIREMENT_NAMES = { reputazione: 'Reputazione minima', livello: 'Livello minimo', oggetto: 'Possesso di un oggetto', evento: 'Evento completato' };

  // Dialoghi: condizioni ed esiti delle risposte.
  const DIALOG_CONDS = ['reputazione', 'oggetto', 'variabile', 'atteggiamento'];
  const DIALOG_COND_NAMES = { reputazione: 'Reputazione', oggetto: 'Possesso di un oggetto', variabile: 'Variabile', atteggiamento: 'Atteggiamento' };
  const DIALOG_OUTCOMES = ['vai', 'prova', 'reputazione', 'quest', 'negozio', 'combattimento', 'atteggiamento', 'variabile', 'fine'];
  const DIALOG_OUTCOME_NAMES = {
    vai: 'Vai a un nodo', prova: 'Prova (successo / fallimento)', reputazione: 'Reputazione', quest: 'Apri quest', negozio: 'Apri negozio',
    combattimento: 'Avvia combattimento', atteggiamento: 'Cambia atteggiamento', variabile: 'Variabile', fine: 'Fine del dialogo',
  };

  const REP_LOG_MAX = 300;

  // Esempi originali (condivisi con tutte le sessioni, modificabili ed eliminabili): una fazione, una città,
  // un mercante con dialogo e una quest. Dati grezzi: li normalizza dati.js (defaultWorld).
  const EXAMPLE_FACTION = 'fazione-lanterna';
  const EXAMPLE_CITY = 'citta-pontegrigio';
  const EXAMPLE_NPC = 'npc-orsola';
  const EXAMPLE_QUEST = 'quest-lanterne-spente';
  const EXAMPLES = {
    factions: [{
      id: EXAMPLE_FACTION, name: 'Compagnia della Lanterna', color: '#c9a227', icon: { kind: 'shape', shape: 'esagono', color: '#c9a227' },
      description: 'Mercanti e guide che tengono accese le lanterne lungo le strade tra i villaggi, in cambio di un pedaggio.',
      notes: 'Esempio: amichevole con i Giocatori, ostile ai Nemici. Una quest e un mercante sono collegati.',
      relations: { giocatori: 'amichevole', nemici: 'ostile', neutrali: 'neutrale' },
    }],
    cities: [{
      id: EXAMPLE_CITY, name: 'Pontegrigio', factionId: EXAMPLE_FACTION, size: 'cittadina', biomeId: 'bioma-pianura',
      icon: { kind: 'shape', shape: 'quadrato', color: '#c9a227' },
      description: 'Una cittadina di pietra grigia costruita attorno a un ponte a sette arcate. Di notte le lanterne della Compagnia illuminano ogni strada.',
      environment: 'Mercato sul ponte al mattino, taverne affollate la sera, nebbia dal fiume all\'alba.',
      rules: { weapons: 'Armi legate nel fodero dentro le mura.', curfew: 'Coprifuoco a mezzanotte, tranne per le guide.', taxes: '1 ma a persona per attraversare il ponte.' },
      questIds: [EXAMPLE_QUEST],
    }],
    worldNpcs: [{
      id: EXAMPLE_NPC, name: 'Orsola Tre Monete', title: 'Mercante della Compagnia', base: 'standard', roles: ['mercante', 'quest'],
      factionId: EXAMPLE_FACTION, cityId: EXAMPLE_CITY, attitude: 'indifferente', questIds: [EXAMPLE_QUEST],
      stats: { level: 3, classId: 'ladro', abilities: { FOR: 10, DES: 14, COS: 12, INT: 13, SAG: 12, CAR: 16 }, icon: { kind: 'library', icon: 'umano', color: '#c9a227' } },
      merchant: {
        stock: [
          { equipmentId: 'eq-pugnale', qty: 4, restock: 1, max: 6 },
          { equipmentId: 'eq-balestra-leggera', qty: 1 },
          { equipmentId: 'eq-dardo', qty: 20, restock: 5, max: 20 },
          { equipmentId: 'eq-arco-lungo', qty: 1, minRep: 20 },
        ],
        coins: { mo: 60 }, haggleDc: 13,
      },
      combat: { defend: 'fazione', provoke: 'fazione', calmDc: 14 },
      routine: [{ from: 8, to: 20, place: 'Banco sul ponte' }, { from: 20, to: 8, place: 'Locanda della Lanterna' }],
      notes: 'Esempio di mercante e datore di quest. Vende l\'arco lungo solo a chi ha almeno 20 di reputazione con la Compagnia.',
      dialog: {
        start: 'saluto',
        nodes: [
          { id: 'saluto', title: 'Saluto', text: 'Benvenuti a Pontegrigio! Lanterne, lame e consigli: tutto ha un prezzo, tranne il sorriso.', answers: [
            { id: 'r-merce', text: 'Mostrami la merce.', outcomes: [{ kind: 'negozio' }, { kind: 'fine' }] },
            { id: 'r-lavoro', text: 'Hai del lavoro per noi?', outcomes: [{ kind: 'vai', to: 'lavoro' }] },
            { id: 'r-sconto', text: 'Un piccolo sconto, per amicizia?', outcomes: [{ kind: 'prova', what: 'Persuasione', dc: 13, success: 'sconto', failure: 'niente-sconto' }] },
            { id: 'r-amici', text: 'La Compagnia ci conosce bene.', conds: [{ kind: 'reputazione', factionId: EXAMPLE_FACTION, min: 20 }], outcomes: [{ kind: 'atteggiamento', value: 'amichevole' }, { kind: 'vai', to: 'sconto' }] },
            { id: 'r-ciao', text: 'Arrivederci.', outcomes: [{ kind: 'fine' }] },
          ] },
          { id: 'lavoro', title: 'Lavoro', text: 'Le lanterne della strada del bosco si spengono una a una: qualcuno le rompe di notte. Fermatelo e la Compagnia saprà essere generosa.', answers: [
            { id: 'r-accetta', text: 'Ce ne occupiamo noi.', outcomes: [{ kind: 'quest', questId: EXAMPLE_QUEST }, { kind: 'vai', to: 'grazie' }] },
            { id: 'r-dopo', text: 'Non ora.', outcomes: [{ kind: 'vai', to: 'saluto' }] },
          ] },
          { id: 'grazie', title: 'Grazie', text: 'Che la luce vi accompagni. E tornate interi, mi raccomando.', answers: [
            { id: 'r-fine', text: 'Contaci.', outcomes: [{ kind: 'fine' }] },
          ] },
          { id: 'sconto', title: 'Sconto', text: 'Va bene, va bene… per questa volta.', answers: [
            { id: 'r-grazie', text: 'Sei un tesoro.', outcomes: [{ kind: 'atteggiamento', value: 'amichevole' }, { kind: 'negozio' }, { kind: 'fine' }] },
          ] },
          { id: 'niente-sconto', title: 'Niente sconto', text: 'Ah! Bel tentativo. I prezzi restano quelli.', answers: [
            { id: 'r-peccato', text: 'Peccato.', outcomes: [{ kind: 'vai', to: 'saluto' }] },
          ] },
        ],
      },
    }],
    quests: [{
      id: EXAMPLE_QUEST, title: 'Le lanterne spente', giver: { npcId: EXAMPLE_NPC, factionId: EXAMPLE_FACTION }, factionId: EXAMPLE_FACTION,
      description: 'Qualcuno rompe le lanterne della strada del bosco a est di Pontegrigio. Orsola sospetta una banda di goblin.',
      requirements: [{ kind: 'reputazione', factionId: EXAMPLE_FACTION, min: -20 }],
      objectives: [{ id: 'obiettivo-goblin', kind: 'uccidi', creature: 'goblin', count: 3, text: 'Ferma i goblin che rompono le lanterne' }],
      timeLimit: 72,
      rewards: { xp: 300, coins: { mo: 25 }, reputation: [{ factionId: EXAMPLE_FACTION, delta: 15 }] },
      offerText: 'Tre notti, non di più: poi la strada diventa troppo pericolosa per le carovane.',
      completeText: 'La strada è di nuovo illuminata. Orsola vi consegna una borsa tintinnante.',
      notes: 'Esempio di quest: datore Orsola Tre Monete, obiettivo «uccidi 3 goblin» avanzato dal combattimento.',
    }],
  };

  DnD.mondoDati = {
    BUILTIN, BUILTIN_IDS, LEVELS, LEVEL_NAMES, LEVEL_ICONS, HOSTILE_LEVELS, ALLY_LEVELS, BUILTIN_RELATIONS,
    REP_MIN, REP_MAX, THRESHOLDS, EFFECTS, CITY_ATTITUDES, REP_EVENTS, ATTITUDES, ATTITUDE_NAMES, ATTITUDE_SCALE, ATTITUDE_PRICE,
    ROLES, ROLE_NAMES, ROLE_ICONS, DEFENDS, DEFEND_NAMES, PROVOKE_RULES, PROVOKE_NAMES, MERCHANT, CITY_SIZES, CITY_SIZE_NAMES,
    QUEST_STATES, QUEST_STATE_NAMES, OBJECTIVES, OBJECTIVE_NAMES, REQUIREMENTS, REQUIREMENT_NAMES,
    DIALOG_CONDS, DIALOG_COND_NAMES, DIALOG_OUTCOMES, DIALOG_OUTCOME_NAMES, REP_LOG_MAX,
    EXAMPLES, EXAMPLE_FACTION, EXAMPLE_CITY, EXAMPLE_NPC, EXAMPLE_QUEST,
  };
})(globalThis.DnD = globalThis.DnD || {});
