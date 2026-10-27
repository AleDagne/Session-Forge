// Condizioni e concentrazione (dati e logica pura). Ogni combattente ha un elenco di condizioni attive
// (tipo, origine, durata, incantesimo collegato, note); le condizioni sono una fonte di modificatori letta dalle
// funzioni di tiro (attacco, salvezza, prova), dal movimento e dall'IA. Tabella degli effetti, condizioni
// personalizzate, durata con lo scorrere dei turni, concentrazione con i suoi effetti collegati, tiri contro la morte.
// Livello regole, sopra regole.js. Espone DnD.condizioni; usa DnD.regole (tiri) e DnD.dadi. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const int = (v, def, lo, hi) => { const n = Math.round(Number(v)); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const ID = /^[\w-]{1,64}$/;
  const refId = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
  const uid = () => DnD.dadi.uid();
  const AB = ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'];

  // ---------- Modificatori (anche per le condizioni personalizzate) ----------
  const EFFECTS = {
    'attacchi-svantaggio': 'Svantaggio ai propri tiri per colpire',
    'attacchi-vantaggio': 'Vantaggio ai propri tiri per colpire',
    'contro-vantaggio': 'Chi lo attacca ha vantaggio',
    'contro-svantaggio': 'Chi lo attacca ha svantaggio',
    'contro-prono': 'Chi lo attacca entro 1 cella ha vantaggio, da più lontano svantaggio',
    'critico-mischia': 'I colpi in mischia entro 1 cella sono critici',
    'ts-fallisce-for-des': 'Fallisce in automatico i tiri salvezza di FOR e DES',
    'ts-des-svantaggio': 'Svantaggio ai tiri salvezza di DES',
    'ts-svantaggio': 'Svantaggio a tutti i tiri salvezza',
    'prove-svantaggio': 'Svantaggio alle prove di caratteristica',
    'prove-vista-svantaggio': 'Svantaggio alle prove che si basano sulla vista',
    'prove-udito-svantaggio': 'Svantaggio alle prove che si basano sull\'udito',
    'nessuna-azione': 'Nessuna azione, azione bonus o reazione',
    'velocita-zero': 'Velocità 0',
    'velocita-meta': 'Velocità dimezzata',
    'striscia': 'Striscia: ogni casella costa una in più',
    'non-attacca-fonte': 'Non può attaccare chi gli ha causato la condizione',
  };
  const EFFECT_IDS = Object.keys(EFFECTS);

  // Condizioni di D&D 5e (testi originali, riassunti per il tavolo) più «rallentato» e lo sfinimento a livelli.
  // sight: gli effetti valgono solo con la fonte in vista (spaventato).
  const TYPES = [
    { id: 'accecato', name: 'Accecato', icon: '🙈', color: '#6b7280', text: 'Non vede nulla: i suoi attacchi sono più difficili, quelli contro di lui più facili; male nelle prove di vista.',
      effects: ['attacchi-svantaggio', 'contro-vantaggio', 'prove-vista-svantaggio'] },
    { id: 'affascinato', name: 'Affascinato', icon: '💞', color: '#db2777', text: 'Non attacca chi l\'ha affascinato, che con lui ha gioco facile nelle interazioni.',
      effects: ['non-attacca-fonte'] },
    { id: 'assordato', name: 'Assordato', icon: '🔇', color: '#64748b', text: 'Non sente nulla: le prove basate sull\'udito vanno male.',
      effects: ['prove-udito-svantaggio'] },
    { id: 'spaventato', name: 'Spaventato', icon: '😱', color: '#7c3aed', sight: true, text: 'Finché vede la fonte della paura attacca e prova con svantaggio e non le si avvicina di sua volontà.',
      effects: ['attacchi-svantaggio', 'prove-svantaggio'] },
    { id: 'afferrato', name: 'Afferrato', icon: '✊', color: '#b45309', text: 'Trattenuto da una presa: resta dov\'è (velocità 0) finché non si libera.',
      effects: ['velocita-zero'] },
    { id: 'incapacitato', name: 'Incapacitato', icon: '💫', color: '#a16207', text: 'Non può compiere azioni, azioni bonus né reazioni.',
      effects: ['nessuna-azione'] },
    { id: 'invisibile', name: 'Invisibile', icon: '👻', color: '#0891b2', text: 'Nessuno lo vede: attacca con vantaggio e chi lo attacca ha svantaggio.',
      effects: ['attacchi-vantaggio', 'contro-svantaggio'] },
    { id: 'paralizzato', name: 'Paralizzato', icon: '⚡', color: '#ca8a04', text: 'Immobile e senza azioni: fallisce i tiri salvezza di FOR e DES, chi lo attacca ha vantaggio e da vicino lo colpisce in modo critico.',
      effects: ['nessuna-azione', 'velocita-zero', 'ts-fallisce-for-des', 'contro-vantaggio', 'critico-mischia'] },
    { id: 'pietrificato', name: 'Pietrificato', icon: '🗿', color: '#78716c', text: 'Trasformato in pietra: senza azioni né movimento, fallisce i tiri salvezza di FOR e DES e chi lo attacca ha vantaggio.',
      effects: ['nessuna-azione', 'velocita-zero', 'ts-fallisce-for-des', 'contro-vantaggio'] },
    { id: 'avvelenato', name: 'Avvelenato', icon: '🤢', color: '#16a34a', text: 'Nausea e debolezza: svantaggio ai tiri per colpire e alle prove.',
      effects: ['attacchi-svantaggio', 'prove-svantaggio'] },
    { id: 'prono', name: 'Prono', icon: '🛌', color: '#92400e', text: 'A terra: striscia, attacca con svantaggio; chi gli è vicino lo attacca con vantaggio, da lontano con svantaggio. Rialzarsi costa metà velocità.',
      effects: ['attacchi-svantaggio', 'contro-prono', 'striscia'] },
    { id: 'trattenuto', name: 'Trattenuto', icon: '⛓', color: '#57534e', text: 'Legato o intrappolato: velocità 0, attacca con svantaggio, chi lo attacca ha vantaggio, svantaggio ai tiri salvezza di DES.',
      effects: ['velocita-zero', 'attacchi-svantaggio', 'contro-vantaggio', 'ts-des-svantaggio'] },
    { id: 'stordito', name: 'Stordito', icon: '😵', color: '#ea580c', text: 'Frastornato: senza azioni né movimento, fallisce i tiri salvezza di FOR e DES e chi lo attacca ha vantaggio.',
      effects: ['nessuna-azione', 'velocita-zero', 'ts-fallisce-for-des', 'contro-vantaggio'] },
    { id: 'privo di sensi', name: 'Privo di sensi', icon: '💤', color: '#475569', text: 'Svenuto: senza azioni né movimento, fallisce i tiri salvezza di FOR e DES, chi lo attacca ha vantaggio e da vicino lo colpisce in modo critico.',
      effects: ['nessuna-azione', 'velocita-zero', 'ts-fallisce-for-des', 'contro-vantaggio', 'critico-mischia'] },
    { id: 'rallentato', name: 'Rallentato', icon: '🐌', color: '#0d9488', text: 'Si muove a fatica: metà velocità.',
      effects: ['velocita-meta'] },
    // Sorpresa all'inizio di un incontro (scene.js): fino alla fine del suo primo turno.
    { id: 'sorpreso', name: 'Sorpreso', icon: '❗', color: '#e11d48', text: 'Colto alla sprovvista: nel suo primo turno non si muove, non agisce e non reagisce.',
      effects: ['nessuna-azione', 'velocita-zero'] },
    { id: 'sfinimento', name: 'Sfinimento', icon: '🥱', color: '#9f1239', levels: true, text: 'Stanchezza a livelli (1-6), cumulativi: prove, velocità, attacchi e salvezze, PF massimi, immobilità e morte.',
      effects: [] },
  ];
  const BY_ID = new Map(TYPES.map((t) => [t.id, t]));
  const TYPE_IDS = TYPES.map((t) => t.id);
  // Sfinimento: effetti cumulativi per livello (il 4 dimezza i PF massimi, il 6 è la morte).
  const EXHAUSTION = [
    { level: 1, effects: ['prove-svantaggio'], text: 'svantaggio alle prove' },
    { level: 2, effects: ['velocita-meta'], text: 'velocità dimezzata' },
    { level: 3, effects: ['attacchi-svantaggio', 'ts-svantaggio'], text: 'svantaggio ad attacchi e tiri salvezza' },
    { level: 4, effects: [], text: 'PF massimi dimezzati' },
    { level: 5, effects: ['velocita-zero'], text: 'velocità 0' },
    { level: 6, effects: [], text: 'morte' },
  ];
  // Nella scheda delle creature lo sfinimento si chiama «indebolimento».
  const IMMUNITY_NAME = { sfinimento: 'indebolimento' };

  // ---------- Durate ----------
  const DURATIONS = ['permanente', 'round', 'inizio-turno', 'fine-turno', 'salvezza', 'minuto', 'riposo'];
  const DURATION_NAMES = {
    permanente: 'Fino a nuovo ordine', round: 'N round', 'inizio-turno': 'Fino all\'inizio del turno di…', 'fine-turno': 'Fino alla fine del turno di…',
    salvezza: 'Salvezza ripetuta a fine turno', minuto: '1 minuto (10 round)', riposo: 'Fino al riposo',
  };
  function normalizeDuration(d) {
    d = obj(d);
    const kind = DURATIONS.includes(d.kind) ? d.kind : 'permanente';
    return {
      kind,
      rounds: kind === 'minuto' ? int(d.rounds, 10, 0, 10) : kind === 'round' ? int(d.rounds, 1, 0, 1000) : 0,
      who: refId(d.who),
      ability: AB.includes(d.ability) ? d.ability : 'COS',
      dc: int(d.dc, 10, 1, 40),
    };
  }

  // ---------- Condizioni personalizzate (libreria globale) ----------
  function normalizeCustom(c) {
    c = obj(c);
    return {
      id: refId(c.id) || 'cp-' + uid(),
      name: str(c.name, 40) || 'Condizione',
      icon: str(c.icon, 4) || '✦',
      color: typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : '#8b5cf6',
      description: str(c.description, 1000),
      effects: [...new Set(arr(c.effects).filter((e) => EFFECT_IDS.includes(e)))],
    };
  }

  // ---------- Voci attive ----------
  // { id, type (id della tabella o 'custom'), custom (copia della personalizzata), level (sfinimento), source: { id, name }
  //   (id vuoto = manuale), duration, spellId (incantesimo che la mantiene, con la concentrazione), notes, auto, hpBase }
  function normalizeEntry(e) {
    if (typeof e === 'string') e = { type: e };
    e = obj(e);
    const custom = e.type === 'custom' && e.custom ? normalizeCustom(e.custom) : null;
    const type = custom ? 'custom' : BY_ID.has(e.type) ? e.type : null;
    if (!type) return null;
    const src = obj(e.source);
    // Senza id (dati precedenti, stringhe): id stabile dal tipo (una voce per tipo), così si ritrova sempre.
    const key = custom ? 'custom:' + custom.id : type;
    return {
      id: refId(e.id) || 'cond-' + key.replace(/[^\w-]/g, '_'),
      type,
      custom,
      level: type === 'sfinimento' ? int(e.level, 1, 1, 6) : 0,
      source: { id: refId(src.id), name: str(src.name, 60) || (src.id ? '' : 'manuale') },
      duration: normalizeDuration(e.duration),
      spellId: refId(e.spellId),
      notes: str(e.notes, 300),
      // auto: 'zero' = messa dai 0 PF (si toglie da sola quando torna sopra 0).
      auto: e.auto === 'zero' ? 'zero' : '',
      hpBase: e.hpBase === null || e.hpBase === undefined ? null : int(e.hpBase, null, 1, 100000),
    };
  }
  // Elenco del combattente: accetta anche le stringhe della versione precedente; una voce per tipo.
  function normalizeList(list) {
    const out = [];
    for (const raw of arr(list).slice(0, 40)) {
      const e = normalizeEntry(raw);
      if (e && !out.some((x) => keyOf(x) === keyOf(e))) out.push(e);
    }
    return out;
  }
  const keyOf = (e) => (e.type === 'custom' ? 'custom:' + e.custom.id : e.type);
  const listOf = (c) => normalizeList(c && c.conditions);

  // Definizione di una voce: nome, icona, colore, testo ed effetti (lo sfinimento accumula quelli dei livelli).
  function defOf(e) {
    if (e.type === 'custom') return { name: e.custom.name, icon: e.custom.icon, color: e.custom.color, text: e.custom.description, effects: e.custom.effects, custom: true };
    const t = BY_ID.get(e.type);
    if (e.type === 'sfinimento') {
      return Object.assign({}, t, { name: 'Sfinimento ' + e.level, effects: [...new Set(EXHAUSTION.filter((x) => x.level <= e.level).flatMap((x) => x.effects))] });
    }
    return t;
  }
  const nameOf = (e) => defOf(e).name;
  const has = (c, type) => listOf(c).some((e) => e.type === type);
  const types = (c) => listOf(c).map((e) => e.type);
  const exhaustion = (c) => { const e = listOf(c).find((x) => x.type === 'sfinimento'); return e ? e.level : 0; };

  // Effetti attivi con la causa («prono», «sfinimento 3»). ctx: { canSee(a, b), byId(id) } per la paura (fonte in vista).
  function effectsOf(c, ctx) {
    const out = [];
    for (const e of listOf(c)) {
      const d = defOf(e);
      if (d.sight && e.source.id && ctx && ctx.byId && ctx.canSee) {
        const src = ctx.byId(e.source.id);
        if (src && !ctx.canSee(c, src)) continue;
      }
      for (const eff of d.effects) out.push({ effect: eff, cause: d.name.toLowerCase(), entry: e });
    }
    return out;
  }
  const causesOf = (c, effect, ctx) => effectsOf(c, ctx).filter((x) => x.effect === effect).map((x) => x.cause);

  // ---------- Tiri ----------
  // Vantaggio e svantaggio da più fonti: insieme si annullano (tiro normale).
  function combine(base, adv, dis) {
    const a = adv.slice();
    const d = dis.slice();
    if (base === 'vantaggio') a.unshift('scelta del tiro');
    if (base === 'svantaggio') d.unshift('scelta del tiro');
    return { adv: a, dis: d, mode: a.length && d.length ? 'normale' : a.length ? 'vantaggio' : d.length ? 'svantaggio' : 'normale' };
  }
  // Testo del modificatore per il log e l'anteprima: «vantaggio: bersaglio prono, entro 1 cella».
  function modsText(m) {
    if (!m) return '';
    const out = [];
    if (m.blocked) out.push(m.blocked);
    if (m.autoFail) out.push('fallimento automatico: ' + m.autoFail);
    if (m.adv.length && m.dis.length) out.push('vantaggio (' + m.adv.join(', ') + ') e svantaggio (' + m.dis.join(', ') + ') si annullano');
    else if (m.adv.length) out.push('vantaggio: ' + m.adv.join(', '));
    else if (m.dis.length) out.push('svantaggio: ' + m.dis.join(', '));
    if (m.autoCrit) out.push('critico se colpisce: ' + m.autoCrit);
    return out.join('; ');
  }

  // Attacco: opts { melee, distance (celle tra le più vicine, o null), base (modo scelto), canSee, byId }.
  function attackMods(attacker, target, opts) {
    const o = opts || {};
    const near = o.distance === null || o.distance === undefined ? Boolean(o.melee) : o.distance <= 1;
    const adv = [];
    const dis = [];
    let autoCrit = null;
    let blocked = null;
    for (const x of effectsOf(attacker, o)) {
      if (x.effect === 'attacchi-svantaggio') dis.push(x.cause);
      if (x.effect === 'attacchi-vantaggio') adv.push(x.cause);
      if (x.effect === 'non-attacca-fonte' && target && x.entry.source.id && x.entry.source.id === target.id) blocked = x.cause + ': non può attaccare ' + target.name;
    }
    for (const x of target ? effectsOf(target, o) : []) {
      if (x.effect === 'contro-vantaggio') adv.push('bersaglio ' + x.cause);
      if (x.effect === 'contro-svantaggio') dis.push('bersaglio ' + x.cause);
      if (x.effect === 'contro-prono') (near ? adv : dis).push('bersaglio ' + x.cause + (near ? ', entro 1 cella' : ', a distanza'));
      if (x.effect === 'critico-mischia' && o.melee && near && !autoCrit) autoCrit = 'bersaglio ' + x.cause + ', in mischia entro 1 cella';
    }
    // Luce e visione (visione.attackVision): bersaglio non visto, attaccante non visto dal bersaglio.
    if (o.vision) { adv.push(...o.vision.adv); dis.push(...o.vision.dis); }
    return Object.assign(combine(o.base || 'normale', uniq(adv), uniq(dis)), { autoCrit, blocked });
  }
  const uniq = (l) => [...new Set(l)];

  // Tiro salvezza: fallimento automatico (FOR e DES da paralizzato, stordito…) e svantaggio.
  function saveMods(c, ability, base) {
    let autoFail = null;
    const dis = [];
    for (const x of effectsOf(c)) {
      if (x.effect === 'ts-fallisce-for-des' && (ability === 'FOR' || ability === 'DES') && !autoFail) autoFail = x.cause;
      if (x.effect === 'ts-des-svantaggio' && ability === 'DES') dis.push(x.cause);
      if (x.effect === 'ts-svantaggio') dis.push(x.cause);
    }
    return Object.assign(combine(base || 'normale', [], uniq(dis)), { autoFail });
  }
  // Prova di caratteristica: opts { sight, hearing, base, canSee, byId }.
  function checkMods(c, opts) {
    const o = opts || {};
    const dis = [];
    for (const x of effectsOf(c, o)) {
      if (x.effect === 'prove-svantaggio') dis.push(x.cause);
      if (x.effect === 'prove-vista-svantaggio' && o.sight) dis.push(x.cause + ' (vista)');
      if (x.effect === 'prove-udito-svantaggio' && o.hearing) dis.push(x.cause + ' (udito)');
    }
    return combine(o.base || 'normale', [], uniq(dis));
  }
  // Azioni bloccate (incapacitato, paralizzato…): il motivo, oppure null.
  function actionBlock(c) {
    if (c && c.dead) return 'morto';
    const x = effectsOf(c).find((y) => y.effect === 'nessuna-azione');
    return x ? x.cause + ': nessuna azione, azione bonus o reazione' : null;
  }
  // Velocità (per movimento.js): cause di velocità 0, dimezzata e del strisciare.
  function speedEffects(c) {
    return { zero: causesOf(c, 'velocita-zero'), half: causesOf(c, 'velocita-meta'), crawl: causesOf(c, 'striscia') };
  }

  // ---------- Applicazione ----------
  // Immunità dalla scheda della creatura.
  function immuneTo(c, type) {
    const imm = c && c.creature && Array.isArray(c.creature.conditionImmunities) ? c.creature.conditionImmunities : [];
    return imm.includes(IMMUNITY_NAME[type] || type);
  }
  // Sfinimento: il livello 4 dimezza i PF massimi (ricordando quelli di prima), il 6 uccide. Modifica c.
  function applyExhaustionHp(c, e) {
    if (e.level >= 4 && e.hpBase === null) { e.hpBase = c.maxHp; c.maxHp = Math.max(1, Math.floor(c.maxHp / 2)); c.hp = Math.min(c.hp, c.maxHp); }
    if (e.level < 4 && e.hpBase !== null) { c.maxHp = e.hpBase; e.hpBase = null; }
    if (e.level >= 6) { c.hp = 0; c.dead = true; }
  }
  // Applica una condizione (data: { type, custom, level, source, duration, spellId, notes, auto }). Una voce per
  // tipo: riapplicarla la aggiorna. Restituisce { ok, entry, line } oppure { ok: false, reason, line }. Modifica c.
  function apply(c, data) {
    const e = normalizeEntry(data);
    if (!e) return { ok: false, reason: 'condizione sconosciuta', line: '' };
    const name = nameOf(e);
    if (e.type !== 'custom' && immuneTo(c, e.type)) return { ok: false, reason: 'immune', line: '🛡 ' + c.name + ' è immune a «' + defOf(e).name.toLowerCase().replace(/ \d$/, '') + '»: condizione rifiutata.' };
    const list = listOf(c);
    const i = list.findIndex((x) => keyOf(x) === keyOf(e));
    if (i >= 0) { e.id = list[i].id; e.hpBase = list[i].hpBase; list[i] = e; } else list.push(e);
    c.conditions = list;
    if (e.type === 'sfinimento') applyExhaustionHp(c, e);
    const from = e.source.id ? ' (da ' + (e.source.name || 'fonte') + ')' : '';
    const line = '🌀 ' + c.name + (i >= 0 ? ': condizione aggiornata, ' : ': ') + name.toLowerCase() + from + ' — ' + durationText(e) + '.' + (e.type === 'sfinimento' && e.level >= 6 ? ' ' + c.name + ' muore di sfinimento.' : '');
    return { ok: true, entry: e, line };
  }
  // Toglie una voce (per id o tipo). Restituisce la voce tolta (per l'annullamento) o null. Modifica c.
  function remove(c, idOrType) {
    const list = listOf(c);
    const e = list.find((x) => x.id === idOrType || keyOf(x) === idOrType);
    if (!e) return null;
    c.conditions = list.filter((x) => x !== e);
    if (e.type === 'sfinimento' && e.hpBase !== null) { c.maxHp = e.hpBase; }
    return e;
  }
  // Rimette una voce tolta (annulla). Modifica c.
  function restore(c, e) {
    const list = listOf(c).filter((x) => keyOf(x) !== keyOf(e));
    list.push(e);
    c.conditions = list;
    if (e.type === 'sfinimento' && e.hpBase !== null) { c.maxHp = Math.max(1, Math.floor(e.hpBase / 2)); c.hp = Math.min(c.hp, c.maxHp); }
    return c;
  }

  function durationText(e, byId) {
    const d = e.duration;
    const who = d.who ? ((byId && byId(d.who)) || {}).name || 'un combattente' : '';
    if (d.kind === 'round') return d.rounds + (d.rounds === 1 ? ' round' : ' round');
    if (d.kind === 'minuto') return '1 minuto (' + d.rounds + ' round rimasti)';
    if (d.kind === 'inizio-turno') return 'fino all\'inizio del turno di ' + who;
    if (d.kind === 'fine-turno') return 'fino alla fine del turno di ' + who;
    if (d.kind === 'salvezza') return 'salvezza su ' + d.ability + ' CD ' + d.dc + ' a fine turno';
    if (d.kind === 'riposo') return 'fino al riposo';
    return 'fino a nuovo ordine';
  }

  // ---------- Scorrimento dei turni ----------
  // Inizio del turno di currentId: finiscono le condizioni «fino all'inizio del turno di» quel combattente.
  function startTurn(combatants, currentId) {
    const lines = [];
    for (const c of arr(combatants)) {
      for (const e of listOf(c).filter((x) => x.duration.kind === 'inizio-turno' && x.duration.who === currentId)) {
        remove(c, e.id);
        lines.push('⌛ ' + c.name + ': ' + nameOf(e).toLowerCase() + ' termina (inizio del turno).');
      }
    }
    return lines;
  }
  // Fine del turno di endingId: finiscono quelle «fino alla fine del turno di»; per il combattente stesso scendono i
  // round (anche il minuto) e si ripete la salvezza (riuscita = la condizione termina). Modifica i combattenti.
  function endTurn(combatants, endingId, rng) {
    const lines = [];
    for (const c of arr(combatants)) {
      for (const e of listOf(c)) {
        const d = e.duration;
        if (d.kind === 'fine-turno' && d.who === endingId) {
          remove(c, e.id);
          lines.push('⌛ ' + c.name + ': ' + nameOf(e).toLowerCase() + ' termina (fine del turno).');
          continue;
        }
        if (c.id !== endingId) continue;
        if (d.kind === 'round' || d.kind === 'minuto') {
          const left = Math.max(0, d.rounds - 1);
          if (!left) { remove(c, e.id); lines.push('⌛ ' + c.name + ': ' + nameOf(e).toLowerCase() + ' termina (durata finita).'); }
          else { const list = listOf(c); list.find((x) => x.id === e.id).duration.rounds = left; c.conditions = list; }
        }
        if (d.kind === 'salvezza') {
          const m = saveMods(c, d.ability);
          if (m.autoFail) { lines.push('🎲 ' + c.name + ' riprova la salvezza su ' + d.ability + ' contro ' + nameOf(e).toLowerCase() + ': fallisce in automatico (' + m.autoFail + ').'); continue; }
          const r = DnD.regole.rollSave({ bonus: (c.saves && c.saves[d.ability]) || 0, mode: m.mode, dc: d.dc }, rng);
          lines.push('🎲 ' + c.name + ' riprova la salvezza su ' + d.ability + ' contro ' + nameOf(e).toLowerCase() + ': ' + r.total + ' contro CD ' + d.dc + (m.mode !== 'normale' ? ' (' + modsText(m) + ')' : '') + ' → ' + (r.success ? 'riesce, la condizione termina.' : 'fallisce.'));
          if (r.success) remove(c, e.id);
        }
      }
    }
    return lines;
  }
  // Riposo: finiscono le condizioni «fino al riposo»; il riposo lungo toglie un livello di sfinimento.
  function rest(c, long) {
    const lines = [];
    for (const e of listOf(c).filter((x) => x.duration.kind === 'riposo')) { remove(c, e.id); lines.push(c.name + ': ' + nameOf(e).toLowerCase() + ' termina con il riposo.'); }
    const ex = listOf(c).find((x) => x.type === 'sfinimento');
    if (long && ex && !c.dead) {
      if (ex.level <= 1) remove(c, ex.id);
      else apply(c, Object.assign({}, ex, { level: ex.level - 1 }));
      lines.push(c.name + ': lo sfinimento scende a ' + (ex.level - 1) + '.');
    }
    return lines;
  }

  // ---------- Concentrazione ----------
  // c.concentration = { spellId, name, round } | null. Le condizioni collegate hanno spellId e la fonte = c.
  const concentrationDc = (damage) => Math.max(10, Math.floor(Math.max(0, damage) / 2));
  // Termina la concentrazione: toglie da tutti i combattenti gli effetti collegati. Restituisce { lines, undo }
  // (undo = { concentration, removed: [{ targetId, entry }] } per «Ripristina»). Modifica i combattenti.
  function endConcentration(caster, combatants, reason) {
    const conc = caster.concentration;
    if (!conc) return { lines: [], undo: null };
    const removed = [];
    for (const c of arr(combatants)) {
      for (const e of listOf(c).filter((x) => x.spellId === conc.spellId && x.source.id === caster.id)) {
        remove(c, e.id);
        removed.push({ targetId: c.id, entry: e });
      }
    }
    caster.concentration = null;
    const undo = { concentration: conc, removed };
    caster.concentrationUndo = undo;
    const lost = removed.length ? ' Effetti tolti: ' + removed.map((r) => (arr(combatants).find((c) => c.id === r.targetId) || {}).name + ' (' + nameOf(r.entry).toLowerCase() + ')').join(', ') + '.' : '';
    return { lines: ['◎ ' + caster.name + ' perde la concentrazione su ' + conc.name + (reason ? ' (' + reason + ')' : '') + '.' + lost], undo };
  }
  // Ripristina una concentrazione appena persa (intervento del master). Modifica i combattenti.
  function restoreConcentration(caster, combatants) {
    const u = caster.concentrationUndo;
    if (!u) return false;
    caster.concentration = u.concentration;
    for (const r of u.removed) { const t = arr(combatants).find((c) => c.id === r.targetId); if (t) restore(t, r.entry); }
    caster.concentrationUndo = null;
    return true;
  }
  // Inizia la concentrazione: un'altra in corso termina. Restituisce le righe. Modifica i combattenti.
  function startConcentration(caster, spell, combatants, round) {
    const lines = caster.concentration ? endConcentration(caster, combatants, 'lancia ' + spell.name).lines : [];
    caster.concentration = { spellId: spell.id, name: spell.name, round: round || 1 };
    caster.concentrationUndo = null;
    lines.push('◎ ' + caster.name + ' si concentra su ' + spell.name + '.');
    return lines;
  }
  // Tiro salvezza su COS dopo un danno: CD = max(10, metà del danno). Vantaggio se c.concentrationAdv.
  function concentrationCheck(c, damage, rng) {
    const dc = concentrationDc(damage);
    const m = saveMods(c, 'COS', c.concentrationAdv ? 'vantaggio' : 'normale');
    const r = DnD.regole.rollSave({ bonus: (c.saves && c.saves.COS) || 0, mode: m.mode, dc }, rng);
    const kept = r.success;
    const line = '◎ ' + c.name + ' mantiene la concentrazione? Salvezza su COS ' + r.total + ' contro CD ' + dc + (m.mode !== 'normale' ? ' (' + m.mode + ')' : '') + ' → ' + (kept ? 'sì.' : 'no.');
    return { dc, roll: r, kept, line };
  }
  // Motivo per cui la concentrazione finisce da sola (0 PF o incapacitato), oppure null.
  function concentrationBreaker(c) {
    if (!c.concentration) return null;
    if (c.hp <= 0) return '0 PF';
    return actionBlock(c) ? actionBlock(c).split(':')[0] : null;
  }

  // ---------- Tiri contro la morte ----------
  // c.deathSaves = { active, successes, failures, stable }; c.dead. rules: { deathSaves, enemiesDie }.
  function normalizeDeathSaves(d) {
    d = obj(d);
    return { active: Boolean(d.active), successes: int(d.successes, 0, 0, 3), failures: int(d.failures, 0, 0, 3), stable: Boolean(d.stable) };
  }
  // Combattente che a 0 PF tira contro la morte (resta nell'ordine dei turni).
  // Unica definizione in regole.js (serve anche all'ordine dei turni): qui riesportata per chi legge le condizioni.
  const dying = (c) => DnD.regole.dying(c);
  // Appena sceso a 0 PF. Modifica c; restituisce le righe.
  function dropToZero(c, rules) {
    const r = rules || { deathSaves: true, enemiesDie: true };
    if (c.dead) return [];
    if (c.kind === 'player' && r.deathSaves) {
      c.deathSaves = { active: true, successes: 0, failures: 0, stable: false };
      // La concentrazione (con i suoi effetti) la chiude concentrationBreaker: a 0 PF finisce.
      apply(c, { type: 'privo di sensi', source: { name: '0 PF' }, auto: 'zero' });
      return ['💤 ' + c.name + ' è privo di sensi: tira contro la morte all\'inizio dei suoi turni.'];
    }
    if (c.kind !== 'player' && r.enemiesDie) { c.dead = true; return ['✝ ' + c.name + ' muore.']; }
    return [];
  }
  // Tiro contro la morte all'inizio del turno: 10+ successo, 1 = due fallimenti, 20 = torna a 1 PF. Modifica c.
  function deathSave(c, rng) {
    const d20 = DnD.regole.rollD20('normale', rng).natural;
    const ds = normalizeDeathSaves(c.deathSaves);
    let text;
    if (d20 === 20) {
      c.hp = 1;
      revive(c);
      return { natural: d20, line: '🎲 ' + c.name + ' tira contro la morte: 20 NATURALE, torna in sé con 1 PF!' };
    }
    if (d20 === 1) ds.failures = Math.min(3, ds.failures + 2);
    else if (d20 >= 10) ds.successes = Math.min(3, ds.successes + 1);
    else ds.failures = Math.min(3, ds.failures + 1);
    text = '🎲 ' + c.name + ' tira contro la morte: ' + d20 + (d20 === 1 ? ' (1 naturale: due fallimenti)' : d20 >= 10 ? ' → successo' : ' → fallimento') + ' · ✔ ' + ds.successes + ' ✖ ' + ds.failures;
    if (ds.failures >= 3) { c.dead = true; ds.active = false; text += '. ' + c.name + ' muore.'; }
    else if (ds.successes >= 3) { ds.stable = true; text += '. ' + c.name + ' è stabile.'; }
    else text += '.';
    c.deathSaves = ds;
    return { natural: d20, line: text };
  }
  // Danno a 0 PF: un fallimento (due con un critico); se era stabile ricomincia a tirare. Modifica c.
  function damageAtZero(c, crit) {
    if (c.dead || !c.deathSaves || !(c.deathSaves.active || c.deathSaves.stable)) return [];
    const ds = normalizeDeathSaves(c.deathSaves);
    ds.stable = false;
    ds.active = true;
    ds.failures = Math.min(3, ds.failures + (crit ? 2 : 1));
    c.deathSaves = ds;
    if (ds.failures >= 3) { c.dead = true; ds.active = false; return ['✝ ' + c.name + ' subisce danni a 0 PF e muore.']; }
    return ['⚠ ' + c.name + ' subisce danni a 0 PF: ' + (crit ? 'due fallimenti' : 'un fallimento') + ' (✖ ' + ds.failures + ').'];
  }
  // Tornato sopra 0 PF: niente più tiri contro la morte, via il «privo di sensi» dei 0 PF. Modifica c.
  function revive(c) {
    c.deathSaves = normalizeDeathSaves({});
    const e = listOf(c).find((x) => x.auto === 'zero');
    if (e) remove(c, e.id);
    return c;
  }

  // ---------- Condizioni inflitte da azioni e incantesimi ----------
  // { type ('' = nessuna), customId, level, duration (who: 'fonte' | 'bersaglio' per inizio/fine turno), save: { ability, dc } }
  function normalizeInflict(i) {
    i = obj(i);
    const type = i.type === 'custom' ? 'custom' : BY_ID.has(i.type) ? i.type : '';
    const d = obj(i.duration);
    const s = obj(i.save);
    return {
      type, customId: type === 'custom' ? refId(i.customId) : '', level: type === 'sfinimento' ? int(i.level, 1, 1, 6) : 0,
      duration: Object.assign(normalizeDuration(d), { who: d.who === 'bersaglio' ? 'bersaglio' : 'fonte' }),
      save: s.ability && AB.includes(s.ability) ? { ability: s.ability, dc: int(s.dc, null, 1, 40) } : null,
    };
  }
  // Dati da applicare a target (null se non c'è o la personalizzata è stata eliminata). customs: libreria.
  function inflictData(inflict, source, target, spell, customs) {
    const i = normalizeInflict(inflict);
    if (!i.type) return null;
    const custom = i.type === 'custom' ? arr(customs).find((c) => c.id === i.customId) : null;
    if (i.type === 'custom' && !custom) return null;
    const duration = Object.assign({}, i.duration, { who: i.duration.who === 'bersaglio' ? target.id : source.id });
    if (duration.kind === 'salvezza' && i.save) Object.assign(duration, { ability: i.save.ability, dc: i.save.dc || duration.dc });
    return { type: i.type, custom, level: i.level, source: { id: source.id, name: source.name }, duration, spellId: spell && spell.concentration ? spell.id : '', notes: spell ? spell.name : '' };
  }
  const inflictName = (inflict, customs) => {
    const i = normalizeInflict(inflict);
    if (!i.type) return '';
    if (i.type === 'custom') return ((arr(customs).find((c) => c.id === i.customId)) || { name: 'personalizzata eliminata' }).name;
    return BY_ID.get(i.type).name + (i.type === 'sfinimento' ? ' ' + i.level : '');
  };

  DnD.condizioni = {
    EFFECTS, EFFECT_IDS, TYPES, TYPE_IDS, EXHAUSTION, DURATIONS, DURATION_NAMES,
    normalizeDuration, normalizeCustom, normalizeEntry, normalizeList, keyOf, defOf, nameOf, has, types, exhaustion, effectsOf,
    combine, modsText, attackMods, saveMods, checkMods, actionBlock, speedEffects, immuneTo, apply, remove, restore, durationText,
    startTurn, endTurn, rest, concentrationDc, startConcentration, endConcentration, restoreConcentration, concentrationCheck,
    concentrationBreaker, normalizeDeathSaves, dying, dropToZero, deathSave, damageAtZero, revive, normalizeInflict, inflictData, inflictName,
  };
})(globalThis.DnD = globalThis.DnD || {});
