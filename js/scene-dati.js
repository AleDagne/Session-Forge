// Scene e incontri (dati): tipi e stati delle scene, esiti e collegamenti, condizioni di inizio e fine degli
// incontri, generatore di incontri e tre incontri d'esempio ORIGINALI (inventati per questa app, modificabili).
(function (DnD) {
  'use strict';

  const KINDS = ['combattimento', 'esplorazione', 'sociale', 'enigma', 'riposo', 'altro'];
  const KIND_NAMES = { combattimento: 'Combattimento', esplorazione: 'Esplorazione', sociale: 'Sociale', enigma: 'Enigma o trappola', riposo: 'Riposo', altro: 'Altro' };
  const KIND_ICONS = { combattimento: '⚔', esplorazione: '🧭', sociale: '💬', enigma: '🧩', riposo: '🛏', altro: '✦' };
  const STATUSES = ['da-fare', 'in-corso', 'conclusa', 'saltata'];
  const STATUS_NAMES = { 'da-fare': 'Da fare', 'in-corso': 'In corso', conclusa: 'Conclusa', saltata: 'Saltata' };

  // Esiti di un incontro (condizioni di fine) e dei collegamenti tra scene («sempre» = qualunque esito).
  const OUTCOMES = ['vittoria', 'sconfitta', 'fuga', 'round', 'obiettivo'];
  const OUTCOME_NAMES = { vittoria: 'Vittoria', sconfitta: 'Sconfitta', fuga: 'Fuga', round: 'Round massimo', obiettivo: 'Obiettivo raggiunto', sempre: 'Sempre' };
  const LINK_OUTCOMES = ['sempre'].concat(OUTCOMES);

  // Posizione di partenza di una riga dell'incontro: zona «Partenza nemici» della griglia o celle scelte.
  const STARTS = ['zona', 'celle'];
  // Condizioni di inizio: chi è sorpreso, nemici nascosti, luce (come i biomi), meteo e ora (testo e promemoria).
  const SURPRISE = ['nessuno', 'giocatori', 'nemici'];
  const SURPRISE_NAMES = { nessuno: 'Nessuno', giocatori: 'I giocatori', nemici: 'I nemici' };
  const LIGHTS = ['', 'normale', 'penombra', 'buio'];
  const LIGHT_NAMES = { '': 'Non indicata', normale: 'Luce normale', penombra: 'Penombra', buio: 'Buio' };
  // Condizione «sorpreso» (condizioni.js): fino alla fine del primo turno di chi la subisce.
  const SURPRISED_CONDITION = 'sorpreso';

  const MAX = { scenes: 200, encounters: 100, creatures: 30, links: 10, tags: 12, history: 200, cells: 30, effects: 20 };
  // Genera incontro: creature diverse al massimo e numero massimo per tipo.
  const GEN_MAX_KINDS = 2;
  const GEN_MAX_PER_KIND = 8;
  const GEN_OPTIONS = 5;

  // Incontri d'esempio: usano le creature d'esempio (creature-dati.js); se mancano compare un avviso.
  const EXAMPLES = [
    {
      id: 'incontro-esempio-agguato', name: 'Agguato nella palude', shared: true,
      creatures: [{ id: 'r1', ref: { kind: 'npc', id: 'esempio-cinghiale-paludi' }, qty: 3, start: { kind: 'zona' }, ai: true }],
      rewards: { xp: 0, coins: { ma: 30 }, items: [] },
      tactics: 'I cinghiali caricano dal canneto: due puntano chi è più vicino, il terzo gira intorno e colpisce chi resta indietro. Fuggono sotto metà PF.',
      notes: 'Terreno fangoso: chi corre deve superare una prova di DES (Acrobazia) CD 10 o cade prono.',
      start: { surprised: 'giocatori', hidden: true, light: 'penombra', weather: 'Nebbia bassa', hour: 6 },
      end: [{ id: 'e1', kind: 'vittoria' }, { id: 'e2', kind: 'fuga' }],
    },
    {
      id: 'incontro-esempio-sentinella', name: 'La sentinella risvegliata', shared: true,
      creatures: [{ id: 'r1', ref: { kind: 'npc', id: 'esempio-sentinella-bronzo' }, qty: 1, start: { kind: 'zona' }, ai: true }],
      rewards: { xp: 0, coins: { mo: 40 }, items: [] },
      tactics: 'Resta davanti alla porta che custodisce: non insegue oltre 6 celle e torna al suo posto se nessuno la attacca.',
      notes: 'Una leva dietro il pilastro la spegne (prova di INT (Indagare) CD 14).',
      start: { surprised: 'nessuno', hidden: false, light: 'normale', weather: '', hour: null },
      end: [{ id: 'e1', kind: 'vittoria' }, { id: 'e2', kind: 'obiettivo', rounds: 5, text: 'Raggiungere la leva e spegnere la sentinella' }],
    },
    {
      id: 'incontro-esempio-trono', name: 'Il trono di cenere', shared: true,
      creatures: [
        { id: 'r1', ref: { kind: 'npc', id: 'esempio-boss-skarnoth' }, qty: 1, start: { kind: 'zona' }, ai: true },
        { id: 'r2', ref: { kind: 'npc', id: 'esempio-cinghiale-paludi' }, qty: 2, start: { kind: 'zona' }, ai: true },
      ],
      rewards: { xp: 0, coins: { mo: 250, mp: 5 }, items: [] },
      tactics: 'Skarnoth parla prima di combattere: vuole sapere chi ha mandato il gruppo. Le bestie proteggono i suoi fianchi.',
      notes: 'Il soffitto crolla al round 6: tutti fanno un TS di DES CD 13 (2d6 contundenti).',
      start: { surprised: 'nessuno', hidden: false, light: 'buio', weather: '', hour: 23 },
      end: [{ id: 'e1', kind: 'vittoria' }, { id: 'e2', kind: 'sconfitta' }, { id: 'e3', kind: 'round', rounds: 10 }],
    },
  ];

  DnD.sceneDati = {
    KINDS, KIND_NAMES, KIND_ICONS, STATUSES, STATUS_NAMES, OUTCOMES, OUTCOME_NAMES, LINK_OUTCOMES, STARTS, SURPRISE, SURPRISE_NAMES,
    LIGHTS, LIGHT_NAMES, SURPRISED_CONDITION, MAX, GEN_MAX_KINDS, GEN_MAX_PER_KIND, GEN_OPTIONS, EXAMPLES,
  };
})(globalThis.DnD = globalThis.DnD || {});
