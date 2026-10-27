// Luce, visione e nebbia di guerra (dati): livelli di luce con le regole, luce ambientale (anche dall'ora e dal
// bioma), sorgenti di luce trasportabili, incantesimi di luce e oscurità, sensi, modalità della nebbia e celle
// della vista. Tutti i raggi sono in piedi (si convertono in celle con i piedi per cella della mappa).
// Livello dati. Espone DnD.visioneDati; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  // Livelli di luce di una cella: 2 = luce intensa, 1 = penombra, 0 = buio.
  const LEVELS = [2, 1, 0];
  const LEVEL_NAMES = { 2: 'Luce intensa', 1: 'Penombra', 0: 'Buio' };
  const LEVEL_ICONS = { 2: '☀', 1: '◐', 0: '●' };
  const LEVEL_RULES = {
    2: 'Si vede normalmente.',
    1: 'Zona leggermente oscurata: svantaggio alle prove di Saggezza (Percezione) basate sulla vista.',
    0: 'Zona pesantemente oscurata: chi non ha una visione adatta è di fatto accecato verso quella zona.',
  };
  // Cause scritte nel log e nelle anteprime degli attacchi.
  const CAUSES = {
    buio: 'buio', magico: 'buio magico', linea: 'fuori dalla linea di vista', accecato: 'accecato', invisibile: 'invisibile',
    raggio: 'oltre il raggio di vista', penombra: 'penombra',
  };

  // Luce ambientale della mappa. «Automatica» (mappe di esplorazione): dall'ora del giorno e dal bioma.
  const AMBIENTS = ['giorno', 'crepuscolo', 'notte', 'buio', 'auto'];
  const AMBIENT_NAMES = { giorno: 'Giorno', crepuscolo: 'Crepuscolo', notte: 'Notte', buio: 'Buio totale (interno)', auto: 'Automatica (ora e bioma)' };
  const AMBIENT_LEVEL = { giorno: 2, crepuscolo: 1, notte: 0, buio: 0 };
  // Ore del giorno (0-23): giorno pieno e crepuscolo; il resto è notte.
  const DAY_HOURS = { from: 7, to: 18 };
  const TWILIGHT_HOURS = [5, 6, 19, 20];
  // Luce dei biomi (biomi.js: normale, penombra, buio): limita la luce del giorno.
  const BIOME_LEVEL = { normale: 2, penombra: 1, buio: 0 };
  // Esplorazione: correzione del raggio di scoperta (celle) secondo la luce attorno al gruppo.
  const EXPLORE_DISCOVERY = { 2: 0, 1: -1, 0: -3 };

  // Sorgenti di luce (raggi in piedi: luce intensa + penombra oltre). minutes = durata in minuti di gioco
  // (null = finché resta accesa). Una pedina ne porta una; oggetti e strutture ne hanno una propria.
  const SOURCES = [
    { id: 'torcia', name: 'Torcia', icon: '🔥', bright: 20, dim: 20, color: '#ffb347', flicker: true, minutes: 60 },
    { id: 'lanterna', name: 'Lanterna a schermo', icon: '🏮', bright: 30, dim: 30, color: '#ffd27a', flicker: false, minutes: 360 },
    { id: 'lanterna-schermata', name: 'Lanterna schermata (abbassata)', icon: '🏮', bright: 0, dim: 5, color: '#ffd27a', flicker: false, minutes: 360 },
    { id: 'lanterna-occhio', name: 'Lanterna a occhio di bue', icon: '🔦', bright: 60, dim: 60, color: '#fff0c0', flicker: false, minutes: 360 },
    { id: 'candela', name: 'Candela', icon: '🕯', bright: 5, dim: 5, color: '#ffc864', flicker: true, minutes: 60 },
    { id: 'luce', name: 'Luce (trucchetto)', icon: '✨', bright: 20, dim: 20, color: '#fff6d5', flicker: false, minutes: 60 },
    { id: 'luci-danzanti', name: 'Luci danzanti', icon: '✨', bright: 0, dim: 10, color: '#d8e6ff', flicker: false, minutes: 1 },
    { id: 'fiamma-perenne', name: 'Fiamma perenne', icon: '🔥', bright: 20, dim: 20, color: '#ffb347', flicker: true, minutes: null },
    { id: 'luce-diurna', name: 'Luce diurna', icon: '☀', bright: 60, dim: 60, color: '#fffbe6', flicker: false, minutes: 60 },
    { id: 'fuoco', name: 'Fuoco da campo / braciere', icon: '🔥', bright: 20, dim: 20, color: '#ff9a3c', flicker: true, minutes: null },
  ];
  // Zona di buio magico (Oscurità): niente luce, la scurovisione non vede, la vista pura sì.
  const DARKNESS = { id: 'oscurita', name: 'Oscurità (buio magico)', icon: '🌑', radius: 15, minutes: 10 };

  // Incantesimi riconosciuti dal nome (minuscolo): creano una sorgente o una zona di buio sulla mappa.
  // Se l'incantesimo è a concentrazione, la sorgente sparisce quando la concentrazione finisce.
  const SPELLS = {
    'luce': { source: 'luce' },
    'luci danzanti': { source: 'luci-danzanti' },
    'fiamma perenne': { source: 'fiamma-perenne' },
    'luce diurna': { source: 'luce-diurna' },
    'oscurità': { dark: true },
    'oscurita': { dark: true },
  };

  // Sensi (in piedi). range = raggio di vista massimo (0 = illimitato).
  const SENSES = ['darkvision', 'blindsight', 'truesight', 'tremorsense'];
  const SENSE_NAMES = { darkvision: 'Scurovisione', blindsight: 'Vista cieca', truesight: 'Vista pura', tremorsense: 'Percezione tellurica', range: 'Raggio di vista massimo' };
  // Nomi dei sensi del Percorso leggendario (in metri) → chiavi.
  const LEGEND_SENSES = { scurovisione: 'darkvision', 'vista cieca': 'blindsight', 'vista pura': 'truesight', 'percezione tellurica': 'tremorsense' };
  // Sensi da provare nell'anteprima «Vedi come» dell'Editor griglie.
  const PROBES = [
    { id: 'normale', name: 'Vista normale', senses: {} },
    { id: 'scuro60', name: 'Scurovisione 18 m (60 ft)', senses: { darkvision: 60 } },
    { id: 'scuro120', name: 'Scurovisione 36 m (120 ft)', senses: { darkvision: 120 } },
    { id: 'cieca', name: 'Vista cieca 9 m (30 ft)', senses: { blindsight: 30 } },
    { id: 'pura', name: 'Vista pura 18 m (60 ft)', senses: { truesight: 60 } },
  ];

  // Nebbia di guerra: modalità, opacità del velo del master (le celle esplorate hanno un velo più tenue).
  const FOG_MODES = ['manuale', 'auto', 'mista'];
  const FOG_MODE_NAMES = { manuale: 'Manuale (il master rivela)', auto: 'Automatica dalla visione', mista: 'Mista (automatica con ritocchi)' };
  const FOG_OPACITY = 0.55;
  const EXPLORED_FACTOR = 0.45;     // velo delle celle esplorate rispetto a quello pieno
  const PLAYER_EXPLORED = 0.6;      // vista dei giocatori: celle esplorate scurite
  const BRUSHES = ['cerchio', 'rettangolo', 'riempi'];
  const BRUSH_NAMES = { cerchio: '◯ Cerchio', rettangolo: '▭ Rettangolo', riempi: '🪣 Riempi area' };
  const FILL_MAX = 4000;            // celle al massimo per un riempimento d'area

  // Celle della vista (strumento «Blocco vista»): predefinito (dai tile), blocca, non blocca, leggermente oscurata
  // (nebbia, fumo, vegetazione fitta).
  const SIGHT = { '0': 'Predefinita', '1': 'Blocca la vista', '2': 'Non blocca la vista', '3': 'Leggermente oscurata' };
  const SIGHT_CYCLE = { '0': '1', '1': '2', '2': '3', '3': '0' };

  // Durata di un round in minuti (6 secondi): le torce si consumano anche nel combattimento.
  const ROUND_MINUTES = 0.1;
  const MAX_LIGHTS = 500;
  const MAX_ROOMS = 100;
  const MAX_ROOM_CELLS = 2500;

  DnD.visioneDati = {
    LEVELS, LEVEL_NAMES, LEVEL_ICONS, LEVEL_RULES, CAUSES, AMBIENTS, AMBIENT_NAMES, AMBIENT_LEVEL, DAY_HOURS, TWILIGHT_HOURS, BIOME_LEVEL,
    EXPLORE_DISCOVERY, SOURCES, DARKNESS, SPELLS, SENSES, SENSE_NAMES, LEGEND_SENSES, PROBES, FOG_MODES, FOG_MODE_NAMES, FOG_OPACITY,
    EXPLORED_FACTOR, PLAYER_EXPLORED, BRUSHES, BRUSH_NAMES, FILL_MAX, SIGHT, SIGHT_CYCLE, ROUND_MINUTES, MAX_LIGHTS, MAX_ROOMS, MAX_ROOM_CELLS,
  };
})(globalThis.DnD = globalThis.DnD || {});
