// Riposi (dati): durate, varianti per il master (eroico, gritty), regola delle 24 ore e regole di ripristino
// delle risorse. Valori modificabili qui; la logica è in riposi.js.
// Livello dati. Espone DnD.riposiDati; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  // Durate in ore: normali e varianti «gritty» (riposo breve di 8 ore, riposo lungo di 7 giorni).
  const HOURS = { breve: 1, lungo: 8 };
  const GRITTY = { breve: 8, lungo: 168 };
  // Un solo riposo lungo ogni 24 ore di gioco (il master può forzare).
  const LONG_EVERY = 24;
  // Riposo lungo interrotto: con almeno questa durata valgono i benefici del riposo breve.
  const INTERRUPT_SHORT = 1;
  // Ora dell'alba (ripristino delle risorse «all'alba» nell'esplorazione).
  const DAWN_HOUR = 6;

  // Regole di ripristino delle risorse.
  const RESETS = ['breve', 'lungo', 'alba', 'mai', 'manuale'];
  const RESET_NAMES = { breve: 'Riposo breve', lungo: 'Riposo lungo', alba: 'All\'alba', mai: 'Mai', manuale: 'Manuale' };
  const MAX_CUSTOM = 30;

  DnD.riposiDati = { HOURS, GRITTY, LONG_EVERY, INTERRUPT_SHORT, DAWN_HOUR, RESETS, RESET_NAMES, MAX_CUSTOM };
})(globalThis.DnD = globalThis.DnD || {});
