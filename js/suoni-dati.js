// Effetti sonori (dati e funzioni pure): categorie, tabella degli eventi con le ricette di sintesi, impostazioni
// (interruttore generale, categorie, eventi, file sostituiti) e traduzione degli esiti già calcolati (righe del log
// del combattimento e dell'esplorazione) in eventi sonori. Il suono accompagna soltanto: non decide nulla di gioco.
//
// Ricetta = elenco di strati sintetizzati da audio.js (Web Audio, nessun file):
//   { t: 'osc' | 'rumore', forma (osc: sine|triangle|square|sawtooth), f: Hz o [inizio, fine] (osc),
//     at: inizio (s), dur: durata (s), a: attacco (s), g: picco 0–1,
//     filtro: { tipo: lowpass|highpass|bandpass, f: Hz o [inizio, fine], q }, colpetti: Hz (rumore a colpetti) }
// estendibile: la durata segue opts.durata (il rotolio dura quanto l'animazione dei dadi).
(function (DnD) {
  'use strict';

  const CATEGORIES = [
    { id: 'dadi', label: 'Dadi' },
    { id: 'combattimento', label: 'Combattimento' },
    { id: 'turno', label: 'Turno' },
    { id: 'movimento', label: 'Movimento' },
    { id: 'boss', label: 'Boss' },
    { id: 'leggendario', label: 'Leggendario' },
    { id: 'esplorazione', label: 'Esplorazione' },
    { id: 'mondo', label: 'Mondo' },
    { id: 'online', label: 'Online', note: 'predisposti: suoneranno quando esisterà la fase Online' },
    { id: 'interfaccia', label: 'Interfaccia' },
  ];
  // Categorie che seguono anche l'interruttore «Effetti boss».
  const BOSS_CATEGORIES = ['boss', 'leggendario'];

  // Accordo/arpeggio: una nota per frequenza, a distanza di passo secondi.
  const notes = (freqs, step, layer) => freqs.map((f, i) => Object.assign({ t: 'osc', forma: 'sine', f, at: i * step }, layer));

  // principale: suona anche nei turni automatici veloci (gli altri si saltano).
  const EVENTS = [
    // Dadi
    { id: 'dadi-rotolio', label: 'Rotolio dei dadi', cat: 'dadi', vol: 0.8, on: true, estendibile: true,
      ricetta: [{ t: 'rumore', colpetti: 55, filtro: { tipo: 'bandpass', f: [2400, 1700], q: 0.8 }, dur: 0.45, a: 0.01, g: 0.35 }] },
    { id: 'dadi-tonfo', label: 'Tonfo finale', cat: 'dadi', vol: 0.9, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [140, 55], dur: 0.22, a: 0.005, g: 0.6 }, { t: 'rumore', filtro: { tipo: 'lowpass', f: [900, 300] }, dur: 0.08, a: 0.003, g: 0.25 }] },
    { id: 'dadi-20', label: '20 naturale', cat: 'dadi', vol: 0.8, on: true, principale: true,
      ricetta: notes([784, 988, 1175, 1568], 0.07, { dur: 0.55, a: 0.01, g: 0.28 }).concat([{ t: 'osc', forma: 'triangle', f: 3136, at: 0.21, dur: 0.6, a: 0.02, g: 0.06 }]) },
    { id: 'dadi-1', label: '1 naturale', cat: 'dadi', vol: 0.8, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sawtooth', f: [220, 70], dur: 0.6, a: 0.01, g: 0.35, filtro: { tipo: 'lowpass', f: [1200, 200] } }, { t: 'osc', forma: 'sine', f: 55, at: 0.05, dur: 0.5, a: 0.02, g: 0.3 }] },
    // Combattimento
    { id: 'colpo', label: 'Colpo a segno', cat: 'combattimento', vol: 0.9, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [180, 70], dur: 0.16, a: 0.003, g: 0.6 }, { t: 'rumore', filtro: { tipo: 'lowpass', f: [2500, 600] }, dur: 0.1, a: 0.002, g: 0.35 }] },
    { id: 'mancato', label: 'Mancato', cat: 'combattimento', vol: 0.7, on: true, principale: true,
      ricetta: [{ t: 'rumore', filtro: { tipo: 'bandpass', f: [600, 2600], q: 1.2 }, dur: 0.25, a: 0.04, g: 0.3 }] },
    { id: 'critico', label: 'Critico', cat: 'combattimento', vol: 1, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [200, 60], dur: 0.25, a: 0.003, g: 0.65 }, { t: 'rumore', filtro: { tipo: 'lowpass', f: [3000, 500] }, dur: 0.14, a: 0.002, g: 0.4 },
        { t: 'osc', forma: 'sine', f: 1046, at: 0.08, dur: 0.5, a: 0.01, g: 0.2 }, { t: 'osc', forma: 'sine', f: 1568, at: 0.14, dur: 0.5, a: 0.01, g: 0.2 }] },
    { id: 'danno', label: 'Danno subito', cat: 'combattimento', vol: 0.8, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [110, 45], dur: 0.28, a: 0.004, g: 0.55 }, { t: 'rumore', filtro: { tipo: 'lowpass', f: 400 }, dur: 0.12, a: 0.003, g: 0.3 }] },
    { id: 'cura', label: 'Cura', cat: 'combattimento', vol: 0.7, on: true,
      ricetta: notes([523, 659, 784], 0.09, { forma: 'triangle', dur: 0.5, a: 0.03, g: 0.22 }) },
    { id: 'a-terra', label: 'A terra (0 PF)', cat: 'combattimento', vol: 0.9, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'triangle', f: [392, 98], dur: 0.7, a: 0.01, g: 0.35 }, { t: 'osc', forma: 'sine', f: [90, 40], at: 0.5, dur: 0.35, a: 0.005, g: 0.5 }] },
    { id: 'incantesimo', label: 'Lancio di un incantesimo', cat: 'combattimento', vol: 0.7, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [880, 1760], dur: 0.5, a: 0.05, g: 0.2 }, { t: 'osc', forma: 'triangle', f: [1320, 2640], at: 0.05, dur: 0.45, a: 0.05, g: 0.08 },
        { t: 'rumore', filtro: { tipo: 'highpass', f: 4000 }, dur: 0.4, a: 0.1, g: 0.08 }] },
    { id: 'ts-riuscito', label: 'Tiro salvezza riuscito', cat: 'combattimento', vol: 0.6, on: true,
      ricetta: notes([660, 880], 0.08, { dur: 0.25, a: 0.01, g: 0.25 }) },
    { id: 'ts-fallito', label: 'Tiro salvezza fallito', cat: 'combattimento', vol: 0.6, on: true,
      ricetta: notes([440, 330], 0.1, { forma: 'square', dur: 0.25, a: 0.01, g: 0.12, filtro: { tipo: 'lowpass', f: 1500 } }) },
    { id: 'azione-lieve', label: 'Azione bonus o reazione', cat: 'combattimento', vol: 0.4, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: 1200, dur: 0.09, a: 0.005, g: 0.18 }] },
    { id: 'condizione', label: 'Condizione applicata', cat: 'combattimento', vol: 0.6, on: true,
      ricetta: [{ t: 'osc', forma: 'triangle', f: [660, 440], dur: 0.3, a: 0.01, g: 0.2 }, { t: 'rumore', filtro: { tipo: 'bandpass', f: 1800, q: 2 }, dur: 0.2, a: 0.02, g: 0.08 }] },
    { id: 'concentrazione-spezzata', label: 'Concentrazione spezzata', cat: 'combattimento', vol: 0.7, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [1320, 330], dur: 0.35, a: 0.005, g: 0.22 }, { t: 'rumore', filtro: { tipo: 'highpass', f: 3000 }, dur: 0.15, a: 0.002, g: 0.12 }] },
    // Turno
    { id: 'turno-giocatore', label: 'Inizio del turno di un giocatore', cat: 'turno', vol: 0.8, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: 1318, dur: 0.9, a: 0.005, g: 0.35 }, { t: 'osc', forma: 'sine', f: 2636, dur: 0.5, a: 0.005, g: 0.08 }] },
    { id: 'round', label: 'Nuovo round', cat: 'turno', vol: 0.6, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: 196, dur: 1, a: 0.01, g: 0.35 }, { t: 'osc', forma: 'sine', f: 294, dur: 0.8, a: 0.01, g: 0.15 }] },
    { id: 'vittoria', label: 'Fine combattimento: vittoria', cat: 'turno', vol: 0.8, on: true, principale: true,
      ricetta: notes([523, 659, 784, 1046], 0.12, { forma: 'triangle', dur: 0.5, a: 0.01, g: 0.28 }) },
    { id: 'sconfitta', label: 'Fine combattimento: sconfitta', cat: 'turno', vol: 0.8, on: true, principale: true,
      ricetta: notes([392, 330, 262, 196], 0.18, { forma: 'sawtooth', dur: 0.6, a: 0.02, g: 0.18, filtro: { tipo: 'lowpass', f: 900 } }) },
    // Movimento
    { id: 'passo', label: 'Passo', cat: 'movimento', vol: 0.4, on: false,
      ricetta: [{ t: 'rumore', filtro: { tipo: 'lowpass', f: [320, 140] }, dur: 0.07, a: 0.004, g: 0.25 }] },
    { id: 'movimento-rifiutato', label: 'Movimento rifiutato', cat: 'movimento', vol: 0.5, on: true,
      ricetta: notes([180, 180], 0.12, { forma: 'square', dur: 0.08, a: 0.005, g: 0.12, filtro: { tipo: 'lowpass', f: 1200 } }) },
    // Boss
    { id: 'boss-evocazione', label: 'Evocazione', cat: 'boss', vol: 0.9, on: true,
      ricetta: [{ t: 'rumore', filtro: { tipo: 'lowpass', f: [150, 700] }, dur: 1.5, a: 0.5, g: 0.35 }, { t: 'osc', forma: 'sawtooth', f: [55, 41], dur: 1.6, a: 0.3, g: 0.2, filtro: { tipo: 'lowpass', f: 500 } },
        { t: 'osc', forma: 'sine', f: [90, 40], at: 1.2, dur: 0.6, a: 0.005, g: 0.6 }] },
    { id: 'boss-ingresso', label: 'Ingresso in combattimento', cat: 'boss', vol: 0.8, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [73, 55], dur: 1.2, a: 0.05, g: 0.5 }, { t: 'osc', forma: 'sawtooth', f: 110, dur: 0.9, a: 0.1, g: 0.12, filtro: { tipo: 'lowpass', f: 450 } }] },
    { id: 'boss-fase', label: 'Cambio di fase', cat: 'boss', vol: 0.9, on: true, principale: true,
      ricetta: [{ t: 'rumore', filtro: { tipo: 'lowpass', f: [900, 100] }, dur: 0.6, a: 0.005, g: 0.45 }, { t: 'osc', forma: 'sawtooth', f: [98, 49], dur: 0.8, a: 0.01, g: 0.22, filtro: { tipo: 'lowpass', f: 600 } }] },
    { id: 'boss-sconfitto', label: 'Sconfitta del boss', cat: 'boss', vol: 0.9, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sawtooth', f: [196, 40], dur: 1.6, a: 0.01, g: 0.25, filtro: { tipo: 'lowpass', f: [1500, 200] } }, { t: 'rumore', filtro: { tipo: 'lowpass', f: [1200, 80] }, dur: 1.2, a: 0.005, g: 0.35 }] },
    // Leggendario
    { id: 'ascensione', label: 'Ascensione', cat: 'leggendario', vol: 0.8, on: true,
      ricetta: notes([523, 659, 784, 1046], 0.15, { dur: 1.6, a: 0.3, g: 0.15 }).concat([{ t: 'rumore', filtro: { tipo: 'highpass', f: 5000 }, at: 0.3, dur: 1.4, a: 0.5, g: 0.06 }]) },
    { id: 'nodo-sbloccato', label: 'Sblocco di un nodo', cat: 'leggendario', vol: 0.7, on: true,
      ricetta: notes([1568, 2093], 0.06, { dur: 0.45, a: 0.005, g: 0.2 }) },
    { id: 'trasformazione', label: 'Trasformazione', cat: 'leggendario', vol: 0.8, on: true, principale: true,
      ricetta: [{ t: 'osc', forma: 'sawtooth', f: [110, 880], dur: 0.8, a: 0.05, g: 0.18, filtro: { tipo: 'lowpass', f: [400, 3000] } }, { t: 'osc', forma: 'sine', f: 1760, at: 0.6, dur: 0.6, a: 0.01, g: 0.15 }] },
    { id: 'forma-normale', label: 'Ritorno alla forma normale', cat: 'leggendario', vol: 0.7, on: true,
      ricetta: [{ t: 'osc', forma: 'sine', f: [880, 220], dur: 0.5, a: 0.02, g: 0.25 }] },
    // Esplorazione
    { id: 'evento', label: 'Evento innescato', cat: 'esplorazione', vol: 0.7, on: true,
      ricetta: notes([587, 880], 0.12, { forma: 'triangle', dur: 0.35, a: 0.01, g: 0.25 }) },
    { id: 'scoperta', label: 'Scoperta di un evento nascosto', cat: 'esplorazione', vol: 0.7, on: true,
      ricetta: notes([1760, 2349, 2794], 0.06, { dur: 0.4, a: 0.005, g: 0.15 }) },
    { id: 'mappa', label: 'Ingresso in una mappa', cat: 'esplorazione', vol: 0.7, on: true,
      ricetta: [{ t: 'rumore', filtro: { tipo: 'bandpass', f: [300, 1400], q: 1 }, dur: 0.5, a: 0.15, g: 0.25 }, { t: 'osc', forma: 'sine', f: [220, 330], at: 0.2, dur: 0.4, a: 0.05, g: 0.2 }] },
    { id: 'tempo', label: 'Ora che passa o meteo che cambia', cat: 'esplorazione', vol: 0.4, on: true,
      ricetta: notes([1000, 1500], 0.1, { dur: 0.12, a: 0.005, g: 0.12 }) },
    // Mondo
    { id: 'reputazione-su', label: 'Reputazione che sale', cat: 'mondo', vol: 0.6, on: true,
      ricetta: notes([523, 659], 0.11, { forma: 'triangle', dur: 0.25, a: 0.01, g: 0.22 }) },
    { id: 'reputazione-giu', label: 'Reputazione che scende', cat: 'mondo', vol: 0.6, on: true,
      ricetta: notes([392, 311], 0.11, { forma: 'triangle', dur: 0.25, a: 0.01, g: 0.22 }) },
    { id: 'quest-accettata', label: 'Quest accettata', cat: 'mondo', vol: 0.7, on: true,
      ricetta: notes([523, 659, 784], 0.11, { forma: 'triangle', dur: 0.3, a: 0.01, g: 0.22 }) },
    { id: 'quest-completata', label: 'Quest completata', cat: 'mondo', vol: 0.8, on: true,
      ricetta: notes([659, 784, 1047], 0.11, { forma: 'triangle', dur: 0.45, a: 0.01, g: 0.25 }).concat([{ t: 'osc', forma: 'sine', f: 2093, at: 0.3, dur: 0.5, a: 0.02, g: 0.06 }]) },
    { id: 'npc-ostile', label: 'NPC che diventa ostile', cat: 'mondo', vol: 0.8, on: true, principale: true,
      ricetta: notes([220, 185], 0.11, { forma: 'sawtooth', dur: 0.3, a: 0.01, g: 0.18, filtro: { tipo: 'lowpass', f: 1200 } }) },
    // Online (predisposti)
    { id: 'online-entra', label: 'Giocatore che entra', cat: 'online', vol: 0.6, on: true, ricetta: notes([660, 880], 0.08, { dur: 0.3, a: 0.01, g: 0.22 }) },
    { id: 'online-richiesta', label: 'Richiesta di ingresso', cat: 'online', vol: 0.6, on: true, ricetta: notes([990, 990], 0.15, { dur: 0.12, a: 0.005, g: 0.2 }) },
    { id: 'online-chat', label: 'Messaggio in chat', cat: 'online', vol: 0.5, on: true, ricetta: [{ t: 'osc', forma: 'sine', f: 1400, dur: 0.1, a: 0.005, g: 0.18 }] },
    { id: 'online-disconnessione', label: 'Disconnessione', cat: 'online', vol: 0.6, on: true, ricetta: notes([660, 440], 0.1, { dur: 0.3, a: 0.01, g: 0.22 }) },
    { id: 'online-ping', label: 'Ping sulla griglia', cat: 'online', vol: 0.6, on: true, ricetta: [{ t: 'osc', forma: 'sine', f: 1760, dur: 0.3, a: 0.005, g: 0.22 }] },
    // Interfaccia
    { id: 'conferma', label: 'Conferma', cat: 'interfaccia', vol: 0.4, on: false, ricetta: notes([880, 1320], 0.06, { dur: 0.12, a: 0.005, g: 0.15 }) },
    { id: 'errore', label: 'Errore', cat: 'interfaccia', vol: 0.5, on: false,
      ricetta: notes([220, 220], 0.12, { forma: 'square', dur: 0.09, a: 0.005, g: 0.1, filtro: { tipo: 'lowpass', f: 1000 } }) },
    { id: 'salvataggio', label: 'Salvataggio riuscito', cat: 'interfaccia', vol: 0.4, on: false, ricetta: [{ t: 'osc', forma: 'sine', f: [660, 990], dur: 0.15, a: 0.005, g: 0.18 }] },
  ];
  const byId = new Map(EVENTS.map((e) => [e.id, e]));
  const event = (id) => byId.get(id) || null;

  // ---------- Impostazioni ----------
  // { on, volume, turnoEvidente, categorie: { id: { on, volume } }, eventi: { id: { on, volume, file: { id, nome } | null } } }
  const DEFAULTS = { on: false, volume: 70, turnoEvidente: false };
  const vol = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : d);
  const FILE_ID = /^snd-[0-9a-f]{16}$/;
  function normalizeFile(f) {
    if (!f || typeof f !== 'object' || !FILE_ID.test(f.id)) return null;
    return { id: f.id, nome: typeof f.nome === 'string' ? f.nome.slice(0, 120) : 'file' };
  }
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const cats = raw.categorie && typeof raw.categorie === 'object' ? raw.categorie : {};
    const evs = raw.eventi && typeof raw.eventi === 'object' ? raw.eventi : {};
    return {
      on: Boolean(raw.on),
      volume: vol(raw.volume, DEFAULTS.volume),
      turnoEvidente: Boolean(raw.turnoEvidente),
      categorie: Object.fromEntries(CATEGORIES.map((c) => {
        const r = cats[c.id] && typeof cats[c.id] === 'object' ? cats[c.id] : {};
        return [c.id, { on: r.on !== false, volume: vol(r.volume, 100) }];
      })),
      eventi: Object.fromEntries(EVENTS.map((e) => {
        const r = evs[e.id] && typeof evs[e.id] === 'object' ? evs[e.id] : {};
        return [e.id, { on: typeof r.on === 'boolean' ? r.on : e.on, volume: vol(r.volume, 100), file: normalizeFile(r.file) }];
      })),
    };
  }
  // Prima versione dei suoni (solo dadi, nelle impostazioni di visualizzazione): diceSound e diceVolume.
  function fromLegacy(display) {
    const s = normalize(null);
    if (display && display.diceSound) {
      s.on = true;
      s.categorie.dadi.volume = vol(display.diceVolume, 100);
    }
    return s;
  }
  // File personalizzati usati: { idEvento: idFile }.
  const filesOf = (s) => Object.fromEntries(Object.entries(s.eventi).filter(([, e]) => e.file).map(([id, e]) => [id, e.file.id]));

  // Può suonare? ctx: { anteprima (Ascolta: ignora gli interruttori), veloce, effettiBoss }.
  // -> { ok, motivo }
  function canPlay(s, id, ctx) {
    const e = event(id);
    const c = ctx || {};
    if (!e) return { ok: false, motivo: 'evento sconosciuto' };
    if (c.anteprima) return { ok: true, motivo: '' };
    if (!s.on) return { ok: false, motivo: 'suoni spenti' };
    if (!s.categorie[e.cat].on) return { ok: false, motivo: 'categoria spenta' };
    if (!s.eventi[id].on) return { ok: false, motivo: 'evento spento' };
    if (BOSS_CATEGORIES.includes(e.cat) && c.effettiBoss === false) return { ok: false, motivo: 'effetti boss spenti' };
    if (c.veloce && !e.principale) return { ok: false, motivo: 'turno veloce: solo i suoni principali' };
    return { ok: true, motivo: '' };
  }
  // Guadagno dell'evento (il volume generale sta nel nodo master): categoria × evento × volume relativo.
  function gain(s, id) {
    const e = event(id);
    if (!e) return 0;
    const g = (s.categorie[e.cat].volume / 100) * (s.eventi[id].volume / 100) * e.vol;
    return id === 'turno-giocatore' && s.turnoEvidente ? Math.min(1.5, g * 1.6) : g;
  }

  // ---------- Dagli esiti già calcolati agli eventi sonori ----------
  const COMBAT_LOG = { colpito: 'colpo', critico: 'critico', mancato: 'mancato', 'a-terra': 'a-terra', cura: 'cura', magia: 'incantesimo',
    'tiro-salvezza': 'ts-riuscito', 'ts-fallito': 'ts-fallito', round: 'round', movimento: 'passo',
    condizione: 'condizione', concentrazione: 'concentrazione-spezzata' };
  // prima: istantanea prima della modifica (combatSnapshot: fase e { id: { hp, form } }); righe: nuove righe del log;
  // dopo: il combattimento. -> eventi in ordine, senza ripetizioni.
  function fromCombat(prima, righe, dopo) {
    const out = [];
    const add = (id) => { if (!out.includes(id)) out.push(id); };
    const p0 = prima || { fase: null, x: {} };
    // Ingresso di un boss: il combattimento passa alla fase attiva con almeno un boss.
    if (dopo && dopo.phase === 'attivo' && p0.fase !== 'attivo' && dopo.combatants.some((x) => x.boss && x.hp > 0)) add('boss-ingresso');
    for (const r of righe || []) {
      if (COMBAT_LOG[r.type]) add(COMBAT_LOG[r.type]);
      if (r.type === 'turno' && dopo) {
        const cur = dopo.combatants.find((x) => x.id === dopo.currentId);
        if (cur && cur.kind === 'player' && cur.control !== 'ia') add('turno-giocatore');
      }
    }
    for (const x of dopo ? dopo.combatants : []) {
      const p = p0.x[x.id];
      if (!p) continue;
      if (x.kind === 'player' && x.hp < p.hp) add('danno');
      const form = x.legend && x.legend.form ? x.legend.form.id : null;
      if (form && !p.form) add('trasformazione');
      if (!form && p.form) add('forma-normale');
    }
    return out;
  }
  // Istantanea minima per fromCombat.
  const combatSnapshot = (c) => ({
    fase: c ? c.phase : null,
    x: Object.fromEntries((c ? c.combatants : []).map((x) => [x.id, { hp: x.hp, form: x.legend && x.legend.form ? x.legend.form.id : null }])),
  });
  // Esito alla fine: vittoria se tutti gli avversari dei giocatori sono a terra, sconfitta se lo sono tutti i giocatori.
  function combatOutcome(c) {
    const list = c ? c.combatants : [];
    const side = (x) => (x.faction ? x.faction !== 'nemici' : x.kind === 'player');
    const players = list.filter(side);
    const foes = list.filter((x) => !side(x));
    if (players.length && players.every((x) => x.hp <= 0)) return 'sconfitta';
    if (foes.length && foes.every((x) => x.hp <= 0)) return 'vittoria';
    return null;
  }
  const EXPLORATION_LOG = { evento: 'evento', incontro: 'evento', scoperta: 'scoperta', mappa: 'mappa', meteo: 'tempo', tempo: 'tempo' };
  function fromExploration(righe) {
    const out = [];
    for (const r of righe || []) { const id = EXPLORATION_LOG[r.kind]; if (id && !out.includes(id)) out.push(id); }
    return out;
  }

  DnD.suoniDati = {
    CATEGORIES, BOSS_CATEGORIES, EVENTS, DEFAULTS, FILE_ID, event, normalize, fromLegacy, filesOf, canPlay, gain,
    COMBAT_LOG, EXPLORATION_LOG, fromCombat, combatSnapshot, combatOutcome, fromExploration,
  };
})(globalThis.DnD = globalThis.DnD || {});
