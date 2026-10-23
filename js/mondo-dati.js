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

  DnD.mondoDati = {
    BUILTIN, BUILTIN_IDS, LEVELS, LEVEL_NAMES, LEVEL_ICONS, HOSTILE_LEVELS, ALLY_LEVELS, BUILTIN_RELATIONS,
    REP_MIN, REP_MAX, THRESHOLDS, EFFECTS, CITY_ATTITUDES, REP_EVENTS, ATTITUDES, ATTITUDE_NAMES, ATTITUDE_SCALE, ATTITUDE_PRICE,
    ROLES, ROLE_NAMES, ROLE_ICONS, DEFENDS, DEFEND_NAMES, PROVOKE_RULES, PROVOKE_NAMES, MERCHANT, CITY_SIZES, CITY_SIZE_NAMES,
    QUEST_STATES, QUEST_STATE_NAMES, OBJECTIVES, OBJECTIVE_NAMES, REQUIREMENTS, REQUIREMENT_NAMES,
    DIALOG_CONDS, DIALOG_COND_NAMES, DIALOG_OUTCOMES, DIALOG_OUTCOME_NAMES, REP_LOG_MAX,
  };
})(globalThis.DnD = globalThis.DnD || {});
