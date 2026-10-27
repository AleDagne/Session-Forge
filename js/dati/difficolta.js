// Tabelle della difficoltà degli incontri (metodo della Guida del Dungeon Master): soglie di PE per personaggio,
// moltiplicatori per numero di creature, correzione per party piccolo o grande, fasce. Modificabili: le regole
// della casa si scrivono nelle «tabelle personalizzate» (Impostazioni › Difficoltà), che partono da queste.
// Livello dati. Espone DnD.difficoltaDati; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  // Soglie per livello (1-20): [facile, medio, difficile, mortale].
  const THRESHOLDS = [
    [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500],
    [250, 500, 750, 1100], [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100],
    [550, 1100, 1600, 2400], [600, 1200, 1900, 2800], [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500],
    [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400], [1600, 3200, 4800, 7200],
    [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
  ];
  // Moltiplicatore per numero di creature: dalla riga con «min» più alto non superiore al numero.
  const MULTIPLIERS = [
    { min: 1, factor: 1 }, { min: 2, factor: 1.5 }, { min: 3, factor: 2 },
    { min: 7, factor: 2.5 }, { min: 11, factor: 3 }, { min: 15, factor: 4 },
  ];
  // Gradini oltre la tabella: party grande con una creatura (sotto la prima riga) e party piccolo oltre l'ultima.
  const BELOW_FIRST = 0.5;
  const ABOVE_LAST = 5;
  // Party con meno di SMALL_PARTY giocatori: un gradino in su; con LARGE_PARTY o più: un gradino in giù.
  const SMALL_PARTY = 3;
  const LARGE_PARTY = 6;
  // Fasce (le quattro con soglia sono le colonne della tabella).
  const BANDS = ['banale', 'facile', 'medio', 'difficile', 'mortale', 'oltre'];
  const BAND_NAMES = { banale: 'Banale', facile: 'Facile', medio: 'Medio', difficile: 'Difficile', mortale: 'Mortale', oltre: 'Oltre il mortale' };
  const THRESHOLD_BANDS = ['facile', 'medio', 'difficile', 'mortale'];
  // «Oltre il mortale» quando i PE modificati superano la soglia mortale moltiplicata per questo valore.
  const BEYOND_FACTOR = 2;
  // Livelli dei leggendari (21-40): si usa la riga del 20 se il master non scrive le soglie a mano.
  const MAX_TABLE_LEVEL = 20;
  const MAX_LEVEL = 40;
  // Nemici standard: CS stimato = livello / STANDARD_CR_DIVISOR, per difetto, minimo 0.
  const STANDARD_CR_DIVISOR = 2;
  // Bilancia: numero massimo di creature di un tipo proposto.
  const MAX_BALANCE = 50;

  const WARNINGS = {
    single: 'Un solo mostro molto forte vale più di molti piccoli: con una creatura sola il party ha tutte le azioni contro di lei, ma un colpo fortunato può far cadere un personaggio.',
    boss: 'Incontro in fasi (boss): il CS effettivo può essere più alto di quello della scheda (azioni leggendarie, fasi, resistenze).',
    legendary: 'Livelli oltre il 20 (leggendari): si usa la riga del livello 20; correggi le soglie a mano in Impostazioni › Difficoltà.',
    legendaryManual: 'Leggendari: soglie scritte a mano per i livelli oltre il 20.',
    noParty: 'Nessun giocatore: scegli i giocatori o attiva un party.',
    noCreatures: 'Nessuna creatura ostile al party.',
    smallParty: 'Party piccolo (meno di 3): moltiplicatore un gradino più alto.',
    largeParty: 'Party grande (6 o più): moltiplicatore un gradino più basso.',
  };

  DnD.difficoltaDati = {
    THRESHOLDS, MULTIPLIERS, BELOW_FIRST, ABOVE_LAST, SMALL_PARTY, LARGE_PARTY, BANDS, BAND_NAMES, THRESHOLD_BANDS, BEYOND_FACTOR,
    MAX_TABLE_LEVEL, MAX_LEVEL, STANDARD_CR_DIVISOR, MAX_BALANCE, WARNINGS,
  };
})(globalThis.DnD = globalThis.DnD || {});
