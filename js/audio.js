// Effetti sonori: l'unico modulo che conosce la Web Audio API. Il resto dell'app chiama soltanto
// DnD.audio.suona('critico') e simili; eventi, ricette e impostazioni stanno in suoni-dati.js.
// - Sintesi nel codice (oscillatori, rumore filtrato, inviluppi): nessun file, nessuna libreria, nessuna rete.
// - Slot: ogni evento può usare un file dell'utente (mp3, ogg, wav, massimo 2 MB) salvato una volta in IndexedDB
//   (chiave "snd:<id>", id = impronta del contenuto), decodificato una volta e tenuto in cache. File mancante o
//   illeggibile: si torna alla sintesi senza errori.
// - Autoplay: l'AudioContext nasce (o riprende) al primo gesto dell'utente; prima non suona nulla.
// - Protezioni: massimo 8 suoni insieme (il più vecchio sfuma), 60 ms tra due suoni identici, coda breve per gli
//   esiti di un'azione (e dei turni automatici), silenzio con la scheda in secondo piano, tutto passa da un nodo
//   master con volume regolabile e un compressore leggero.
// crea(env) è usata anche dai test con un AudioContext finto.
(function (DnD) {
  'use strict';

  const S = () => DnD.suoniDati;
  const KEY = 'dnd-battaglie:suoni';
  const LEGACY_DISPLAY_KEY = 'dnd-battaglie:impostazioni'; // diceSound e diceVolume della prima versione
  const MAX_VOICES = 8;
  const MIN_GAP = 0.06;        // s tra due suoni identici
  const QUEUE_GAP = 0.12;      // s tra i suoni in coda
  const QUEUE_GAP_FAST = 0.06; // turni automatici veloci
  const QUEUE_MAX = 1.5;       // oltre questo ritardo un suono in coda si scarta (il gioco non aspetta i suoni)
  const MAX_FILE = 2 * 1024 * 1024;
  const MAX_DATA_URL = Math.ceil(MAX_FILE * 4 / 3) + 64;
  const DATA_URL = /^data:audio\/(mpeg|mp3|ogg|wav|x-wav|wave|vnd\.wave);base64,[A-Za-z0-9+/]+=*$/;
  const ACCEPTED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'];
  const ACCEPTED_EXT = /\.(mp3|ogg|oga|wav)$/i;

  // ---------- Funzioni pure ----------
  const isAudioDataUrl = (v) => typeof v === 'string' && v.length <= MAX_DATA_URL && DATA_URL.test(v);
  const isAcceptedFile = (f) => Boolean(f) && (ACCEPTED_TYPES.includes(f.type) || ACCEPTED_EXT.test(f.name || ''));
  // Stessa impronta delle immagini: stesso contenuto -> stesso id (una sola copia).
  const fileId = (dataUrl) => 'snd-' + DnD.immaginiLib.imageId(dataUrl).slice(4);
  // File validi di un archivio esportato: solo quelli il cui id corrisponde al contenuto.
  function validFiles(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, data] of Object.entries(raw)) if (isAudioDataUrl(data) && fileId(data) === id) out[id] = data;
    return out;
  }
  function dataUrlToBuffer(dataUrl) {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  const pair = (v) => (Array.isArray(v) ? v : [v, v]);

  // env: { AudioContext, doc (document: hidden, eventi), storage (localStorage), effettiBoss(), leggiFile(file) -> dataUrl,
  //        blobs ({ get, set }: anche dopo, con collegaArchivio) }
  function crea(env) {
    const e = env || {};
    let ctx = null;
    let master = null;
    let unlocked = false;
    let blobs = e.blobs || null;
    let settings = load();
    let voices = [];
    const lastAt = {};
    let queueEnd = 0;
    const buffers = new Map(); // idFile -> { stato: 'caricamento' | 'ok' | 'rotto', buffer, promise }
    let noise = null;
    const clacks = new Map();

    // ---------- Impostazioni ----------
    function load() {
      let raw = null;
      try { raw = e.storage ? JSON.parse(e.storage.getItem(KEY)) : null; } catch (err) { raw = null; }
      if (raw) return S().normalize(raw);
      let legacy = null;
      try { legacy = e.storage ? JSON.parse(e.storage.getItem(LEGACY_DISPLAY_KEY)) : null; } catch (err) { legacy = null; }
      // Migrazione una volta sola: le impostazioni di visualizzazione non conservano più diceSound.
      const s = S().fromLegacy(legacy);
      if (legacy && legacy.diceSound) save(s);
      return s;
    }
    function save(s) {
      try { if (e.storage) e.storage.setItem(KEY, JSON.stringify(s || settings)); return true; } catch (err) { return false; }
    }
    function imposta(patch) {
      settings = S().normalize(Object.assign({}, settings, patch));
      save();
      applyVolume();
      return settings;
    }
    const impostaCategoria = (id, patch) => imposta({ categorie: Object.assign({}, settings.categorie, { [id]: Object.assign({}, settings.categorie[id], patch) }) });
    const impostaEvento = (id, patch) => imposta({ eventi: Object.assign({}, settings.eventi, { [id]: Object.assign({}, settings.eventi[id], patch) }) });
    const toggle = () => imposta({ on: !settings.on }).on;

    // ---------- Contesto e nodo master ----------
    const hidden = () => Boolean(e.doc && e.doc.hidden);
    function applyVolume() {
      if (!master) return;
      master.gain.setTargetAtTime(settings.volume / 100, ctx.currentTime, 0.03);
    }
    // Al primo gesto dell'utente (pointerdown, keydown, touchstart): crea o riprende il contesto.
    function sblocca() {
      if (!e.AudioContext) return false;
      try {
        if (!ctx) {
          ctx = new e.AudioContext();
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -18;
          comp.knee.value = 12;
          comp.ratio.value = 4;
          comp.attack.value = 0.003;
          comp.release.value = 0.25;
          master = ctx.createGain();
          master.gain.value = 0; // sale con setTargetAtTime: niente partenze a volume pieno
          master.connect(comp);
          comp.connect(ctx.destination);
        }
        if (ctx.state === 'suspended' && !hidden()) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        unlocked = true;
        applyVolume();
        preload();
        return true;
      } catch (err) {
        return false;
      }
    }
    // Scheda in secondo piano: si sospende tutto; al ritorno si riprende.
    function onVisibility() {
      if (!ctx) return;
      try {
        const p = hidden() ? ctx.suspend() : ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (err) { /* ignora */ }
    }
    if (e.doc && e.doc.addEventListener) {
      const unlock = () => {
        if (!sblocca()) return;
        for (const t of ['pointerdown', 'keydown', 'touchstart']) e.doc.removeEventListener(t, unlock, true);
      };
      for (const t of ['pointerdown', 'keydown', 'touchstart']) e.doc.addEventListener(t, unlock, true);
      e.doc.addEventListener('visibilitychange', onVisibility);
    }

    // ---------- Sintesi ----------
    function noiseBuffer() {
      if (noise) return noise;
      const len = ctx.sampleRate;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noise;
    }
    // Rumore a colpetti (dadi che rotolano), lungo quanto serve.
    function clackBuffer(rate, dur) {
      const k = rate + ':' + dur.toFixed(2);
      if (clacks.has(k)) return clacks.get(k);
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const clack = Math.pow(Math.max(0, Math.sin(t * rate * Math.PI)), 12);
        d[i] = (Math.random() * 2 - 1) * (0.25 + 0.75 * clack) * (1 - t / dur);
      }
      clacks.set(k, buf);
      return buf;
    }
    function ramp(param, v, t0, dur) {
      const [a, b] = pair(v);
      param.setValueAtTime(a, t0);
      if (b !== a) param.exponentialRampToValueAtTime(Math.max(1, b), t0 + dur);
    }
    // Strati della ricetta su out, a partire da when. Restituisce { fine, sources }.
    function synth(ev, when, out, durata) {
      const sources = [];
      let fine = when;
      for (const l of ev.ricetta) {
        const t0 = when + (l.at || 0);
        const dur = ev.estendibile && durata ? Math.max(0.1, durata) : l.dur;
        const a = Math.max(0.005, l.a || 0);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(l.g, t0 + a);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(a + 0.01, dur));
        let src;
        if (l.t === 'osc') {
          src = ctx.createOscillator();
          src.type = l.forma || 'sine';
          ramp(src.frequency, l.f, t0, dur);
        } else {
          src = ctx.createBufferSource();
          if (l.colpetti) src.buffer = clackBuffer(l.colpetti, dur);
          else { src.buffer = noiseBuffer(); src.loop = true; }
        }
        let node = src;
        if (l.filtro) {
          const f = ctx.createBiquadFilter();
          f.type = l.filtro.tipo;
          ramp(f.frequency, l.filtro.f, t0, dur);
          if (l.filtro.q) f.Q.value = l.filtro.q;
          node.connect(f);
          node = f;
        }
        node.connect(env);
        env.connect(out);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
        sources.push(src);
        fine = Math.max(fine, t0 + dur + 0.05);
      }
      return { fine, sources };
    }
    function play(id, when, g, o) {
      const ev = S().event(id);
      const out = ctx.createGain();
      // Breve ingresso anche per i file: nessuno scatto improvviso.
      out.gain.setValueAtTime(0.0001, when);
      out.gain.linearRampToValueAtTime(g, when + 0.01);
      out.connect(master);
      const file = settings.eventi[id].file;
      const entry = file ? buffers.get(file.id) : null;
      if (file && !entry) decodeFile(file.id);
      let r;
      let fonte = 'sintesi';
      if (entry && entry.stato === 'ok') {
        const src = ctx.createBufferSource();
        src.buffer = entry.buffer;
        src.connect(out);
        src.start(when);
        r = { fine: when + entry.buffer.duration, sources: [src] };
        fonte = 'file';
      } else r = synth(ev, when, out, o.durata);
      const voice = {
        id, fine: r.fine, fonte,
        stop() {
          if (voice.fermata) return;
          voice.fermata = true;
          const t = ctx.currentTime;
          try {
            out.gain.cancelScheduledValues(t);
            out.gain.setTargetAtTime(0.0001, t, 0.015);
            for (const s of r.sources) s.stop(t + 0.08);
          } catch (err) { /* già fermata */ }
          voice.fine = t;
        },
      };
      return voice;
    }

    // ---------- Interfaccia: suona(evento, opzioni) ----------
    // opts: { coda (dopo i suoni già in coda), veloce (turni automatici: solo i principali), durata (s, rotolio),
    //         anteprima (Ascolta: ignora gli interruttori) }. -> { suonato, motivo, stop() }
    const result = (ok, motivo, voice) => ({ suonato: ok, motivo, stop: voice ? voice.stop : () => {}, fonte: voice ? voice.fonte : null });
    function suona(id, opts) {
      const o = opts || {};
      const check = S().canPlay(settings, id, { anteprima: o.anteprima, veloce: o.veloce, effettiBoss: e.effettiBoss ? e.effettiBoss() : true });
      if (!check.ok) return result(false, check.motivo);
      if (!unlocked || !ctx) return result(false, 'audio non ancora attivo: serve un clic o un tasto');
      if (hidden()) return result(false, 'scheda in secondo piano');
      try {
        const now = ctx.currentTime;
        let when = now;
        if (o.coda) {
          when = Math.max(now, queueEnd);
          if (when - now > QUEUE_MAX) return result(false, 'coda piena');
        }
        if (!o.anteprima && lastAt[id] !== undefined && Math.abs(when - lastAt[id]) < MIN_GAP) return result(false, 'troppo ravvicinato');
        lastAt[id] = when;
        if (o.coda) queueEnd = when + (o.veloce ? QUEUE_GAP_FAST : QUEUE_GAP);
        voices = voices.filter((v) => v.fine > now);
        while (voices.length >= MAX_VOICES) voices.shift().stop();
        const g = S().gain(settings, id);
        const voice = play(id, when, g, o);
        voices.push(voice);
        // Avviso del turno più evidente: più forte e ripetuto.
        if (id === 'turno-giocatore' && settings.turnoEvidente) {
          if (voices.length >= MAX_VOICES) voices.shift().stop();
          voices.push(play(id, when + 0.45, g, o));
        }
        return result(true, '', voice);
      } catch (err) {
        return result(false, 'audio non disponibile');
      }
    }
    // Più eventi di una stessa azione: in coda, uno dopo l'altro.
    const suonaTutti = (ids, opts) => (ids || []).map((id) => suona(id, Object.assign({ coda: true }, opts)));

    // ---------- File personalizzati ----------
    function decodeFile(fid) {
      if (buffers.has(fid)) return buffers.get(fid).promise;
      const entry = { stato: 'caricamento', buffer: null, promise: null };
      buffers.set(fid, entry);
      entry.promise = (async () => {
        try {
          const data = blobs ? await blobs.get('snd:' + fid) : null;
          if (!isAudioDataUrl(data) || !ctx) throw new Error('mancante');
          entry.buffer = await ctx.decodeAudioData(dataUrlToBuffer(data));
          entry.stato = 'ok';
        } catch (err) {
          entry.stato = 'rotto';
        }
        return entry.stato;
      })();
      return entry.promise;
    }
    function preload() {
      if (!ctx || !blobs) return Promise.resolve();
      return Promise.all(Object.values(S().filesOf(settings)).map(decodeFile));
    }
    function collegaArchivio(b) {
      blobs = b;
      return preload();
    }
    // Stato dello slot per l'interfaccia: 'predefinito' | 'personalizzato' | 'non leggibile'.
    function fonte(id) {
      const f = settings.eventi[id] && settings.eventi[id].file;
      if (!f) return 'predefinito';
      const entry = buffers.get(f.id);
      return entry && entry.stato === 'rotto' ? 'non leggibile' : 'personalizzato';
    }
    async function sostituisci(id, file) {
      if (!isAcceptedFile(file)) throw new Error('Formato non supportato: usa un file mp3, ogg o wav.');
      if (file.size > MAX_FILE) throw new Error('Il file è troppo grande (' + (file.size / 1048576).toFixed(1).replace('.', ',') + ' MB): il massimo è 2 MB.');
      return sostituisciDati(id, await e.leggiFile(file), file.name);
    }
    async function sostituisciDati(id, dataUrl, nome) {
      if (!S().event(id)) throw new Error('Evento sconosciuto.');
      if (typeof dataUrl === 'string' && dataUrl.length > MAX_DATA_URL) throw new Error('Il file è troppo grande: il massimo è 2 MB.');
      if (!isAudioDataUrl(dataUrl)) throw new Error('Il file non è un audio mp3, ogg o wav valido.');
      if (!blobs) throw new Error('Archivio non disponibile.');
      const fid = fileId(dataUrl);
      await blobs.set('snd:' + fid, dataUrl);
      // Con il contesto attivo si verifica subito che il file sia leggibile.
      if (ctx) {
        buffers.delete(fid);
        if (await decodeFile(fid) !== 'ok') throw new Error('Il file non è un audio leggibile: resta il suono predefinito.');
      }
      impostaEvento(id, { file: { id: fid, nome: String(nome || 'file').slice(0, 120) } });
      return fid;
    }
    const ripristina = (id) => impostaEvento(id, { file: null });

    // ---------- Esporta / Importa / Cancella ----------
    async function esporta() {
      const file = {};
      for (const fid of new Set(Object.values(S().filesOf(settings)))) {
        try {
          const data = blobs ? await blobs.get('snd:' + fid) : null;
          if (isAudioDataUrl(data)) file[fid] = data;
        } catch (err) { /* file mancante: non si esporta */ }
      }
      return { impostazioni: JSON.parse(JSON.stringify(settings)), file };
    }
    // Sostituisce le impostazioni con quelle del file; i riferimenti a file assenti tornano alla sintesi.
    async function importa(raw) {
      if (!raw || typeof raw !== 'object') return 0;
      const files = validFiles(raw.file);
      if (blobs) for (const [fid, data] of Object.entries(files)) await blobs.set('snd:' + fid, data);
      const next = S().normalize(raw.impostazioni);
      for (const ev of Object.values(next.eventi)) {
        if (!ev.file || files[ev.file.id]) continue;
        let present = null;
        try { present = blobs ? await blobs.get('snd:' + ev.file.id) : null; } catch (err) { present = null; }
        if (!isAudioDataUrl(present)) ev.file = null;
      }
      settings = next;
      save();
      applyVolume();
      buffers.clear();
      await preload();
      return Object.keys(files).length;
    }
    // Dopo «Cancella tutti i dati» (i file sono già stati tolti dall'archivio): tutti gli slot tornano alla sintesi.
    function svuota() {
      const eventi = {};
      for (const [id, ev] of Object.entries(settings.eventi)) eventi[id] = Object.assign({}, ev, { file: null });
      imposta({ eventi });
      buffers.clear();
    }

    return {
      suona, suonaTutti, sblocca, imposta, impostaCategoria, impostaEvento, toggle, sostituisci, sostituisciDati, ripristina,
      esporta, importa, svuota, collegaArchivio, fonte, preload,
      impostazioni: () => settings,
      attivo: () => settings.on,
      stato: () => ({ sbloccato: unlocked, voci: ctx ? voices.filter((v) => v.fine > ctx.currentTime).length : 0, contesto: ctx }),
    };
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Impossibile leggere il file.'));
      r.readAsDataURL(file);
    });
  }

  DnD.audioLib = { KEY, MAX_VOICES, MIN_GAP, QUEUE_MAX, MAX_FILE, ACCEPTED_TYPES, isAudioDataUrl, isAcceptedFile, fileId, validFiles, crea };
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    let storage = null;
    try { storage = window.localStorage; } catch (err) { storage = null; }
    DnD.audio = crea({
      AudioContext: window.AudioContext || window.webkitAudioContext, doc: document, storage, leggiFile: readDataUrl,
      effettiBoss: () => !DnD.impostazioni || DnD.impostazioni.bossEffects(),
    });
  }
})(globalThis.DnD = globalThis.DnD || {});
