// Esplorazione (logica pura): campi delle griglie di esplorazione (tipo, scala, mappa dei biomi, eventi
// piazzati, nebbia di scoperta), stato dell'esplorazione della sessione (gruppo e pedine, tempo, meteo, ritmo,
// modalità di viaggio, scorte, condizioni dei personaggi, variabili, pila delle mappe, registro, coda delle
// finestre evento) e regole: movimento cella per cella con costo e ore dal bioma, tempo che avanza con
// scorte, meteo, pericoli ambientali, incontri casuali e inneschi degli eventi; nebbia; entra/esci da una mappa.
(function (DnD) {
  'use strict';

  const KINDS = ['battaglia', 'esplorazione'];
  const UNITS = ['ft', 'm', 'km', 'mi'];
  const UNIT_NAMES = { ft: 'piedi', m: 'metri', km: 'km', mi: 'miglia' };
  const UNIT_KM = { ft: 0.0003048, m: 0.001, km: 1, mi: 1.609344 };
  const SCALE_PRESETS = [{ value: 5, unit: 'ft' }, { value: 100, unit: 'm' }, { value: 1, unit: 'km' }, { value: 1.5, unit: 'km' }, { value: 6, unit: 'mi' }];
  const DEFAULT_SCALE = { value: 1.5, unit: 'km' };
  const LOG_MAX = 500;
  const QUEUE_MAX = 50;
  const WEATHER_HOURS = 8;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => DnD.dadi.uid();
  const B = () => DnD.biomi;
  const E = () => DnD.eventi;
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---------- Scala ----------
  const normalizeScale = (s) => { s = obj(s); return { value: num(s.value, DEFAULT_SCALE.value, 0.01, 100000), unit: UNITS.includes(s.unit) ? s.unit : DEFAULT_SCALE.unit }; };
  const scaleKm = (s) => s.value * UNIT_KM[s.unit];
  const fmt = (n) => String(round2(n)).replace('.', ',');
  const scaleLabel = (s) => '1 cella = ' + fmt(s.value) + ' ' + UNIT_NAMES[s.unit];
  const formatDistance = (cells, s) => cells + (cells === 1 ? ' cella' : ' celle') + ' = ' + fmt(cells * s.value) + ' ' + UNIT_NAMES[s.unit];

  // ---------- Campi delle griglie ----------
  function normalizeFog(f, w, h) {
    f = obj(f);
    let seen = typeof f.seen === 'string' ? f.seen.replace(/[^01]/g, '0') : '';
    seen = (seen + '0'.repeat(w * h)).slice(0, w * h);
    return { enabled: Boolean(f.enabled), seen };
  }
  // Tipo, scala, biomi, eventi e nebbia (vuoti per le griglie di battaglia, che restano come prima).
  function normalizeGridExtras(g, w, h) {
    g = obj(g);
    const kind = KINDS.includes(g.kind) ? g.kind : 'battaglia';
    return {
      kind,
      scale: normalizeScale(g.scale),
      biomeMap: B().normalizeMap(g.biomeMap, w, h),
      events: arr(g.events).slice(0, 500).map((i) => E().normalizeInstance(i, w, h)),
      fog: normalizeFog(g.fog, w, h),
    };
  }
  // Contenuto di esplorazione da copiare tra bozza e griglia salvata.
  const extrasOf = (g) => clone({ kind: g.kind || 'battaglia', scale: g.scale || DEFAULT_SCALE, biomeMap: g.biomeMap || null, events: g.events || [], fog: g.fog || { enabled: false, seen: '' } });

  // Ridimensionamento: biomi e nebbia seguono le celle, gli eventi fuori dall'area si tolgono.
  function resizeExtras(g, ow, oh, nw, nh, dx, dy) {
    const shift = (c) => ({ x: c.x + dx, y: c.y + dy });
    const inside = (c) => c.x >= 0 && c.y >= 0 && c.x < nw && c.y < nh;
    const fogCells = [];
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const ox = x - dx;
      const oy = y - dy;
      fogCells.push(ox >= 0 && oy >= 0 && ox < ow && oy < oh && g.fog && g.fog.seen[oy * ow + ox] === '1' ? '1' : '0');
    }
    const events = (g.events || []).map((i) => Object.assign({}, i, { cells: i.cells.map(shift).filter(inside) })).filter((i) => i.cells.length);
    return {
      biomeMap: B().reshapeMap(g.biomeMap, ow, oh, nw, nh, dx, dy),
      fog: { enabled: Boolean(g.fog && g.fog.enabled), seen: fogCells.join('') },
      events, lostEvents: (g.events || []).length - events.length,
    };
  }

  // ---------- Stato dell'esplorazione (per sessione) ----------
  function normalizeMember(m) {
    m = obj(m);
    const maxHp = int(m.maxHp, 10, 1, 9999);
    return { hp: int(m.hp, maxHp, 0, maxHp), maxHp, exhaustion: int(m.exhaustion, 0, 0, 6), xp: int(m.xp, 0, 0, 10000000),
      conditions: [...new Set(arr(m.conditions).filter((c) => DnD.creatureDati.CONDITIONS.includes(c)))] };
  }
  function normalizeParty(p) {
    p = obj(p);
    const pos = obj(p.pos);
    return {
      id: str(p.id, 64) || uid(), name: str(p.name, 60) || 'Gruppo',
      icon: DnD.icone.normalizeIcon(p.icon || { kind: 'library', icon: 'cavaliere', color: '#c9a227' }, false),
      pos: { x: int(pos.x, 0, 0, 99), y: int(pos.y, 0, 0, 99) },
      memberIds: arr(p.memberIds).filter((x) => typeof x === 'string').slice(0, 30),
    };
  }
  function normalizeLog(l) {
    l = obj(l);
    return { day: int(l.day, 1, 1, 100000), hour: num(l.hour, 0, 0, 24), place: str(l.place, 80), text: str(l.text, 600), kind: str(l.kind, 20) || 'sistema' };
  }
  function normalizePrompt(q) {
    q = obj(q);
    return {
      id: str(q.id, 64) || uid(), kind: q.kind === 'incontro' ? 'incontro' : 'evento', gridId: str(q.gridId, 64), instanceId: str(q.instanceId, 64),
      templateId: str(q.templateId, 64), reason: str(q.reason, 200),
      encounter: q.encounter ? { kind: obj(q.encounter).kind === 'evento' ? 'evento' : 'creatura', refId: str(obj(q.encounter).refId, 64), qty: int(obj(q.encounter).qty, 1, 1, 100), roll: int(obj(q.encounter).roll, 0, 0, 100) } : null,
    };
  }
  function normalizeState(x) {
    if (!x || typeof x !== 'object') return null;
    const t = obj(x.time);
    const sup = obj(x.supplies);
    const w = x.weather && typeof x.weather === 'object' ? B().normalizeWeather(x.weather) : null;
    const parties = arr(x.parties).slice(0, 10).map(normalizeParty);
    const variables = {};
    for (const [k, v] of Object.entries(obj(x.variables)).slice(0, 200)) {
      if (typeof v === 'number' || typeof v === 'boolean') variables[str(k, 40)] = v;
      else if (typeof v === 'string') variables[str(k, 40)] = v.slice(0, 200);
    }
    const pending = x.pending && typeof x.pending === 'object' ? {
      kind: 'combattimento', gridId: str(x.pending.gridId, 64), instanceId: str(x.pending.instanceId, 64), name: str(x.pending.name, 80),
      action: E().normalizeAction(x.pending.action), rest: arr(x.pending.rest).slice(0, 40).map((a) => E().normalizeAction(a)), combatId: str(x.pending.combatId, 64),
    } : null;
    return {
      gridId: str(x.gridId, 64),
      stack: arr(x.stack).slice(0, 50).map((s) => ({ gridId: str(obj(s).gridId, 64), parties: arr(obj(s).parties).map(normalizeParty) })),
      parties: parties.length ? parties : [normalizeParty({})],
      activeParty: str(x.activeParty, 64),
      time: { day: int(t.day, 1, 1, 100000), hour: num(t.hour, 8, 0, 23.99), total: num(t.total, 0, 0, 1e9) },
      weather: w, weatherSince: num(x.weatherSince, 0, 0, 1e9),
      pace: B().PACES.includes(x.pace) ? x.pace : 'normale',
      mode: B().MODES.includes(x.mode) ? x.mode : 'piedi',
      supplies: { food: num(sup.food, 10, 0, 100000), water: num(sup.water, 10, 0, 100000) },
      members: Object.fromEntries(Object.entries(obj(x.members)).slice(0, 30).map(([k, v]) => [str(k, 64), normalizeMember(v)])),
      variables,
      hazardTimers: Object.fromEntries(Object.entries(obj(x.hazardTimers)).slice(0, 200).map(([k, v]) => [str(k, 64), num(v, 0, 0, 1e9)])),
      enteredHazards: arr(x.enteredHazards).filter((s) => typeof s === 'string').slice(0, 200),
      encounterAcc: num(x.encounterAcc, 0, 0, 1000),
      rotation: int(x.rotation, 0, 0, 1e6),
      log: arr(x.log).slice(-LOG_MAX).map(normalizeLog),
      queue: arr(x.queue).slice(0, QUEUE_MAX).map(normalizePrompt),
      pending,
      fogOn: x.fogOn !== false,
      seed: int(x.seed, 1, 1, 2147483646),
    };
  }

  // Nuova esplorazione sulla griglia indicata con i giocatori scelti (pedina all'inizio della zona giocatori).
  function create(grid, players, seed) {
    const zone = (grid.zones || []).find((z) => z.kind === 'giocatori');
    const pos = zone ? { x: zone.x, y: zone.y } : { x: 0, y: 0 };
    const party = normalizeParty({ name: 'Gruppo', pos, memberIds: players.map((p) => p.id) });
    return normalizeState({
      gridId: grid.id, parties: [party], activeParty: party.id, seed,
      members: Object.fromEntries(players.map((p) => [p.id, { hp: p.maxHp, maxHp: p.maxHp }])),
      supplies: { food: 5 * Math.max(1, players.length), water: 5 * Math.max(1, players.length) },
    });
  }

  // ---------- Mondo: archivio + stato + griglia corrente ----------
  // w: { st, ex, grid, rng } (rng facoltativo: casualità con il seme dell'esplorazione e il tempo).
  const biomeIndex = (st) => new Map((st.biomes || []).map((b) => [b.id, b]));
  function biomeAt(w, x, y) {
    const id = B().cellBiome(w.grid.biomeMap, w.grid.w, x, y);
    const b = id ? biomeIndex(w.st).get(id) : null;
    return b ? B().resolve(b, biomeIndex(w.st)) : null;
  }
  const activeParty = (ex) => ex.parties.find((p) => p.id === ex.activeParty) || ex.parties[0];
  // Con w.registro (dadi animati) i dadi tirati si registrano, senza cambiare la sequenza del seme.
  const rngOf = (w) => { const base = w.rng || B().seededRng(w.ex.seed ^ Math.round(w.ex.time.total * 100)); return w.registro ? w.registro.wrap(base) : base; };
  const memberState = (ex, id, player) => {
    if (!ex.members[id]) ex.members[id] = normalizeMember({ hp: player ? player.maxHp : 10, maxHp: player ? player.maxHp : 10 });
    return ex.members[id];
  };
  const partyMembers = (w, party) => (party || activeParty(w.ex)).memberIds.map((id) => w.st.players.find((p) => p.id === id)).filter(Boolean);
  const placeName = (w, party) => {
    const p = (party || activeParty(w.ex)).pos;
    const b = biomeAt(w, p.x, p.y);
    return DnD.griglia.cellLabel(p.x, p.y) + (b ? ' · ' + b.name : '');
  };

  function log(w, text, kind, party) {
    w.ex.log.push({ day: w.ex.time.day, hour: round2(w.ex.time.hour), place: placeName(w, party), text, kind: kind || 'sistema' });
    if (w.ex.log.length > LOG_MAX) w.ex.log.splice(0, w.ex.log.length - LOG_MAX);
  }
  function queue(w, prompt) {
    if (w.ex.queue.length >= QUEUE_MAX) return;
    w.ex.queue.push(normalizePrompt(Object.assign({ gridId: w.grid.id }, prompt)));
  }

  // Contesto per le prove e le azioni degli eventi.
  function eventCtx(w, extra) {
    const party = activeParty(w.ex);
    const p = party.pos;
    const b = biomeAt(w, p.x, p.y);
    return Object.assign({
      st: w.st, ex: w.ex, grid: w.grid, rng: rngOf(w), now: () => w.ex.time.total, overrides: {},
      members: () => partyMembers(w, party), memberState: (id) => memberState(w.ex, id, w.st.players.find((x) => x.id === id)),
      log: (text, kind) => log(w, text, kind), biomeId: b ? b.id : '',
      hasItem: (id) => partyMembers(w, party).some((m) => (m.inventory || []).some((it) => it.equipmentId === id && it.qty > 0)),
      findEvent: (id) => {
        const inst = (w.grid.events || []).find((i) => i.id === id || i.templateId === id);
        if (inst) return { inst };
        const template = (w.st.events || []).find((e) => e.id === id);
        return template ? { template } : null;
      },
      advance: (hours) => advanceTime(w, hours),
      teleport: (to) => { party.pos = { x: Math.max(0, Math.min(w.grid.w - 1, to.x)), y: Math.max(0, Math.min(w.grid.h - 1, to.y)) }; reveal(w); },
      setBiome: (id, radius) => {
        if (!w.grid.biomeMap) w.grid.biomeMap = B().emptyMap(w.grid.w, w.grid.h, '');
        const cells = [];
        for (let y = p.y - radius; y <= p.y + radius; y++) for (let x = p.x - radius; x <= p.x + radius; x++) cells.push({ x, y });
        B().paint(w.grid.biomeMap, w.grid.w, w.grid.h, cells, id);
      },
      enterMap: (gridId, entry) => enterMap(w, gridId, entry),
      // Mondo: reputazione del party attivo della sessione e quest (avvia, avanza, completa, fallisci).
      reputation: (factionId, delta, reason) => {
        const v = worldOf(w);
        if (!v) return null;
        return DnD.fazioni.changeReputation({ world: v.world, party: DnD.party.active(v.parties, v.world) }, factionId, delta, reason, 'evento');
      },
      quest: (op, questId, objectiveId, n) => questOp(w, op, questId, objectiveId, n),
    }, extra || {});
  }

  // Mondo della sessione che contiene l'esplorazione (null nei test senza sessioni).
  function worldOf(w) {
    if (!w.st || !Array.isArray(w.st.sessions) || !w.st.factions) return null;
    const se = w.st.sessions.find((s) => s.exploration === w.ex) || DnD.sessioni.current(w.st);
    return se && se.world ? DnD.fazioni.view(w.st, se.id) : null;
  }
  // Operazioni delle azioni «Quest» degli eventi. Restituisce le righe per il registro.
  function questOp(w, op, questId, objectiveId, n) {
    const v = worldOf(w);
    if (!v) return ['⚠ Quest: nessun Mondo nella sessione.'];
    const q = v.quests.find((x) => x.id === questId);
    if (!q) return ['⚠ Quest eliminata: azione saltata.'];
    const Q = DnD.quest;
    const j = v.world.quests;
    const party = DnD.party.active(v.parties, v.world);
    if (op === 'avvia') { Q.offer(j, q); return Q.accept(j, q, w.ex.time.total, party && party.id) ? ['📜 Quest «' + q.title + '» accettata.'] : ['📜 Quest «' + q.title + '» già ' + Q.statusOf(j, q.id) + '.']; }
    if (op === 'avanza') return Q.advance(j, [q], (q.objectives.find((o) => o.id === objectiveId) || q.objectives[0] || {}).kind, (o) => !objectiveId || o.id === objectiveId, n || 1);
    if (op === 'fallisci') { Q.fail(j, q, w.ex.time.total); return ['📜 Quest «' + q.title + '» fallita.']; }
    const r = Q.complete(j, q, w.ex.time.total, true);
    return [r.ok ? '📜 Quest «' + q.title + '» completata: consegna le ricompense dal diario del party.' : '📜 «' + q.title + '»: ' + r.reason + '.'];
  }

  // ---------- Tempo ----------
  // Avanza di `hours` ore: scorte, meteo (ogni 8 ore), pericoli a tempo, incontri per ora ed eventi a tempo.
  function advanceTime(w, hours) {
    const ex = w.ex;
    if (!(hours > 0)) return;
    const party = activeParty(ex);
    const b = biomeAt(w, party.pos.x, party.pos.y);
    const startTotal = ex.time.total;
    ex.time.total = round2(ex.time.total + hours);
    const h = ex.time.hour + hours;
    ex.time.day += Math.floor(h / 24);
    ex.time.hour = round2(h % 24);
    const people = ex.parties.reduce((n, p) => n + p.memberIds.length, 0);
    // Quest con tempo limite: oltre la scadenza diventano Scadute.
    const v = worldOf(w);
    if (v) for (const q of DnD.quest.expire(v.world.quests, v.quests, ex.time.total)) log(w, '📜 Quest «' + q.title + '» scaduta.', 'quest');
    if (b) {
      const c = B().consumption(b, hours, people);
      ex.supplies.food = Math.max(0, round2(ex.supplies.food - c.food));
      ex.supplies.water = Math.max(0, round2(ex.supplies.water - c.water));
      if (!ex.supplies.food || !ex.supplies.water) log(w, '⚠ Scorte esaurite: ' + (!ex.supplies.food ? 'cibo ' : '') + (!ex.supplies.water ? 'acqua' : '') + '.', 'avviso');
      // Meteo: cambia ogni 8 ore (o se non c'è ancora).
      if (!ex.weather || ex.time.total - ex.weatherSince >= WEATHER_HOURS) {
        const wx = B().rollWeather(b, rngOf(w));
        if (wx && (!ex.weather || wx.name !== ex.weather.name)) log(w, '🌦 Meteo: ' + wx.name + (wx.visibility ? ' (visibilità ' + (wx.visibility > 0 ? '+' : '') + wx.visibility + ')' : '') + (wx.dc ? ', CD +' + wx.dc : '') + '.', 'meteo');
        if (wx) ex.weather = Object.assign({}, wx);
        ex.weatherSince = ex.time.total;
      }
      // Pericoli a tempo del bioma.
      for (const hz of b.hazards.filter((x) => x.freq === 'ore')) {
        ex.hazardTimers[hz.id] = round2((ex.hazardTimers[hz.id] || 0) + hours);
        while (ex.hazardTimers[hz.id] >= hz.hours) {
          ex.hazardTimers[hz.id] = round2(ex.hazardTimers[hz.id] - hz.hours);
          resolveHazard(w, hz, b);
        }
      }
      // Incontri per ora: un controllo d100 per ogni ora intera passata.
      if (b.encounterPer === 'ora' && b.encounterChance > 0) {
        ex.encounterAcc = round2(ex.encounterAcc + hours);
        while (ex.encounterAcc >= 1) {
          ex.encounterAcc = round2(ex.encounterAcc - 1);
          checkEncounter(w, b);
        }
      }
    }
    // Eventi a tempo della mappa corrente.
    for (const inst of E().timeTriggers(w.grid.events || [], ex.time.total)) {
      const ctx = eventCtx(w);
      if (E().canFire(inst, ctx).ok) queue(w, { kind: 'evento', instanceId: inst.id, reason: 'sono passate ' + inst.event.trigger.hours + ' ore' });
      else inst.state.lastHours = ex.time.total; // riparte il conteggio
    }
    return ex.time.total - startTotal;
  }

  // Pericolo ambientale: prova di ogni personaggio; chi fallisce subisce l'effetto.
  function resolveHazard(w, hz, b) {
    const ctx = eventCtx(w);
    const extra = -(w.ex.weather ? w.ex.weather.dc || 0 : 0);
    const failed = [];
    for (const m of ctx.members()) {
      const r = E().resolveCheck({ what: hz.check.what, save: hz.check.save, dc: hz.check.dc, who: 'scelto', memberId: m.id, mode: 'normale' }, ctx, extra);
      if (r.success) continue;
      failed.push(m.name);
      const ms = ctx.memberState(m.id);
      const e = hz.effect;
      if (e.kind === 'danno') { const d = DnD.dadi.rollExpr(e.dice, ctx.rng); ms.hp = Math.max(0, ms.hp - (d ? Math.max(0, d.total) : 0)); }
      else if (e.kind === 'sfinimento') ms.exhaustion = Math.min(6, ms.exhaustion + e.levels);
      else if (e.kind === 'condizione' && !ms.conditions.includes(e.condition)) ms.conditions.push(e.condition);
    }
    if (hz.effect.kind === 'scorte' && failed.length) {
      w.ex.supplies.food = Math.max(0, round2(w.ex.supplies.food - hz.effect.food));
      w.ex.supplies.water = Math.max(0, round2(w.ex.supplies.water - hz.effect.water));
    }
    const eff = hz.effect;
    const what = eff.kind === 'danno' ? eff.dice + (eff.type ? ' ' + eff.type : '') : eff.kind === 'sfinimento' ? '+' + eff.levels + ' sfinimento' : eff.kind === 'condizione' ? eff.condition : 'perdita di scorte';
    log(w, '⚠ ' + b.name + ' — ' + hz.name + ' (' + (hz.check.save ? 'TS ' : '') + hz.check.what + ' CD ' + hz.check.dc + '): ' + (failed.length ? 'falliscono ' + failed.join(', ') + ' → ' + what : 'tutti superano la prova') + '.', 'pericolo');
  }

  function checkEncounter(w, b) {
    const r = B().rollEncounter(b, rngOf(w), w.st.npcs);
    if (!r.hit) return null;
    if (!r.row) { log(w, '🎲 Incontro casuale (d100 = ' + r.roll + ' su ' + r.chance + '%), ma la tabella del bioma è vuota.', 'incontro'); return r; }
    if (r.missing) { log(w, '⚠ Incontro casuale: la creatura della tabella non esiste più.', 'avviso'); return r; }
    log(w, '🎲 Incontro casuale in ' + b.name + ' (d100 = ' + r.roll + ' su ' + r.chance + '%).', 'incontro');
    queue(w, { kind: 'incontro', reason: 'incontro casuale', encounter: { kind: r.row.kind, refId: r.row.refId, qty: r.qty, roll: r.roll } });
    return r;
  }

  // ---------- Movimento ----------
  const adjacent = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
  const inBounds = (g, c) => c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h;

  // Costo e ore per entrare nella cella (null se impraticabile o senza bioma valido = costo 1, 1 ora).
  function stepCost(w, c) {
    const b = biomeAt(w, c.x, c.y);
    if (!b) return { cost: 1, hours: round2(1 * B().PACE[w.ex.pace].hours), biome: null };
    const cost = B().costFor(b, w.ex.mode);
    if (!cost) return null;
    return { cost, hours: B().hoursFor(b, w.ex.mode, w.ex.pace, scaleKm(w.grid.scale)), biome: b };
  }

  // Un passo del gruppo attivo verso una cella adiacente. Restituisce { ok, reason, hours }.
  function step(w, to) {
    const party = activeParty(w.ex);
    const from = Object.assign({}, party.pos);
    if (!inBounds(w.grid, to)) return { ok: false, reason: 'fuori dalla mappa' };
    if (!adjacent(from, to)) return { ok: false, reason: 'non adiacente' };
    const sc = stepCost(w, to);
    if (!sc) { const b = biomeAt(w, to.x, to.y); return { ok: false, reason: (b ? b.name : 'cella') + ' impraticabile ' + (w.ex.mode === 'piedi' ? 'a piedi' : B().MODE_NAMES[w.ex.mode].toLowerCase()) }; }
    const before = biomeAt(w, from.x, from.y);
    party.pos = { x: to.x, y: to.y };
    advanceTime(w, sc.hours);
    reveal(w);
    // Quest: obiettivi «Raggiungi un luogo» su questa mappa e cella.
    const qv = worldOf(w);
    if (qv) for (const l of DnD.quest.onReach(qv.world.quests, qv.quests, w.grid.id, to.x, to.y)) log(w, l, 'quest');
    if (sc.biome && (!before || before.id !== sc.biome.id)) {
      log(w, '🧭 Si entra in: ' + sc.biome.name + '.', 'movimento');
      for (const hz of sc.biome.hazards.filter((x) => x.freq === 'entrata')) {
        const key = w.grid.id + ':' + hz.id;
        if (w.ex.enteredHazards.includes(key)) continue;
        w.ex.enteredHazards.push(key);
        resolveHazard(w, hz, sc.biome);
      }
    }
    if (sc.biome && sc.biome.encounterPer === 'cella' && sc.biome.encounterChance > 0) checkEncounter(w, sc.biome);
    // Eventi: scoperta di quelli nascosti vicini, poi inneschi di entrata e passaggio.
    const ctx = eventCtx(w);
    const extra = B().PACE[w.ex.pace].check + (w.ex.weather ? w.ex.weather.visibility || 0 : 0);
    for (const inst of (w.grid.events || []).filter((i) => i.event.visibility.kind === 'scoperta' && !i.state.discovered && i.cells.some((c) => adjacent(c, to) || (c.x === to.x && c.y === to.y)))) {
      const r = E().tryDiscover(inst, ctx, extra);
      if (r && r.success) log(w, '👁 Il gruppo scopre «' + inst.event.name + '» (' + r.results.map((x) => x.name + ' ' + x.total).join(', ') + ').', 'scoperta');
    }
    for (const inst of E().movementTriggers(w.grid.events || [], from, to)) {
      const can = E().canFire(inst, ctx);
      if (can.ok) queue(w, { kind: 'evento', instanceId: inst.id, reason: inst.event.trigger.kind === 'passaggio' ? 'passaggio' : 'entrata' });
    }
    return { ok: true, reason: '', hours: sc.hours };
  }

  // Percorso di costo minimo (Dijkstra, 8 direzioni) che evita le celle impraticabili; null se non c'è.
  function path(w, from, to) {
    const W = w.grid.w;
    const H = w.grid.h;
    const key = (c) => c.y * W + c.x;
    const dist = new Float64Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const done = new Uint8Array(W * H);
    dist[key(from)] = 0;
    const open = [from];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist[key(open[i])] < dist[key(open[bi])]) bi = i;
      const cur = open.splice(bi, 1)[0];
      const k = key(cur);
      if (done[k]) continue;
      done[k] = 1;
      if (cur.x === to.x && cur.y === to.y) break;
      for (const [dx, dy] of DIRS) {
        const n = { x: cur.x + dx, y: cur.y + dy };
        if (!inBounds(w.grid, n) || done[key(n)]) continue;
        const sc = stepCost(w, n);
        if (!sc) continue;
        const d = dist[k] + sc.hours + (dx && dy ? 0.001 : 0);
        if (d < dist[key(n)]) { dist[key(n)] = d; prev[key(n)] = k; open.push(n); }
      }
    }
    if (!Number.isFinite(dist[key(to)])) return null;
    const out = [];
    for (let k = key(to); k !== -1 && k !== key(from); k = prev[k]) out.unshift({ x: k % W, y: Math.floor(k / W) });
    return { cells: out, hours: round2(dist[key(to)]) };
  }

  // Muove lungo il percorso fino alla destinazione; si ferma alla prima finestra evento/incontro in coda.
  function moveTo(w, to) {
    const p = path(w, activeParty(w.ex).pos, to);
    if (!p) return { ok: false, reason: 'nessun percorso praticabile', steps: 0 };
    const q0 = w.ex.queue.length;
    let steps = 0;
    for (const c of p.cells) {
      const r = step(w, c);
      if (!r.ok) return { ok: false, reason: r.reason, steps };
      steps++;
      if (w.ex.queue.length > q0) break;
    }
    return { ok: true, reason: '', steps };
  }

  // Divide il gruppo attivo: i personaggi indicati formano una nuova pedina nella stessa cella.
  function split(ex, memberIds, name) {
    const party = activeParty(ex);
    const move = party.memberIds.filter((id) => memberIds.includes(id));
    if (!move.length || move.length === party.memberIds.length) return null;
    party.memberIds = party.memberIds.filter((id) => !move.includes(id));
    const np = normalizeParty({ name: name || 'Gruppo ' + (ex.parties.length + 1), pos: party.pos, memberIds: move, icon: Object.assign({}, party.icon, { color: '#4f8fd6' }) });
    ex.parties.push(np);
    return np;
  }
  // Riunisce tutte le pedine nella cella della pedina attiva (solo quelle nella stessa cella o adiacenti).
  function merge(ex) {
    const party = activeParty(ex);
    const near = ex.parties.filter((p) => p !== party && Math.max(Math.abs(p.pos.x - party.pos.x), Math.abs(p.pos.y - party.pos.y)) <= 1);
    for (const p of near) party.memberIds = party.memberIds.concat(p.memberIds);
    ex.parties = ex.parties.filter((p) => !near.includes(p));
    return near.length;
  }

  // ---------- Nebbia di scoperta ----------
  // Rivela le celle nel raggio di scoperta del bioma (più la visibilità del meteo) attorno a ogni pedina.
  function reveal(w) {
    const g = w.grid;
    if (!g.fog || !g.fog.enabled) return 0;
    const a = g.fog.seen.split('');
    let n = 0;
    for (const p of w.ex.parties) {
      const b = biomeAt(w, p.pos.x, p.pos.y);
      const r = Math.max(0, (b ? b.discovery : 2) + (w.ex.weather ? w.ex.weather.visibility || 0 : 0));
      for (let y = p.pos.y - r; y <= p.pos.y + r; y++) for (let x = p.pos.x - r; x <= p.pos.x + r; x++) {
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        if ((x - p.pos.x) ** 2 + (y - p.pos.y) ** 2 > r * r + r) continue;
        if (a[y * g.w + x] !== '1') { a[y * g.w + x] = '1'; n++; }
      }
    }
    g.fog.seen = a.join('');
    return n;
  }
  const isSeen = (g, x, y) => !g.fog || !g.fog.enabled || g.fog.seen[y * g.w + x] === '1';
  function setSeen(g, cells, seen) {
    const a = g.fog.seen.split('');
    for (const c of cells) if (c.x >= 0 && c.y >= 0 && c.x < g.w && c.y < g.h) a[c.y * g.w + c.x] = seen ? '1' : '0';
    g.fog.seen = a.join('');
  }

  // ---------- Pila delle mappe ----------
  // Entra in una mappa: la posizione attuale va sulla pila, il gruppo si sposta sul punto d'entrata.
  function enterMap(w, gridId, entry) {
    const target = (w.st.savedGrids || []).find((g) => g.id === gridId);
    if (!gridId || !target) return '⚠ Entra in una mappa: mappa collegata mancante.';
    w.ex.stack.push({ gridId: w.ex.gridId, parties: clone(w.ex.parties) });
    w.ex.gridId = target.id;
    const at = { x: Math.max(0, Math.min(target.w - 1, entry ? entry.x : 0)), y: Math.max(0, Math.min(target.h - 1, entry ? entry.y : 0)) };
    for (const p of w.ex.parties) p.pos = Object.assign({}, at);
    w.grid = target;
    reveal(w);
    return '🚪 Il gruppo entra in «' + target.name + '» (' + (target.kind === 'esplorazione' ? 'esplorazione' : 'battaglia') + ').';
  }
  // Esce: torna alla mappa precedente nello stesso punto. Restituisce false se la pila è vuota.
  function exitMap(ex) {
    const top = ex.stack.pop();
    if (!top) return false;
    ex.gridId = top.gridId;
    ex.parties = top.parties;
    if (!ex.parties.some((p) => p.id === ex.activeParty)) ex.activeParty = ex.parties[0].id;
    return true;
  }

  // ---------- Esecuzione di un evento ----------
  // Esegue l'istanza (o il modello, per gli incontri) con le scelte del master; segna l'innesco.
  // Restituisce il risultato di DnD.eventi.run (testi e pausa per il combattimento).
  function fireEvent(w, inst, overrides, extraCtx) {
    const ev = inst.event || inst;
    const ctx = eventCtx(w, Object.assign({ overrides: overrides || {} }, extraCtx || {}));
    if (inst.state) E().markFired(inst, w.ex.time.total, '');
    log(w, '❗ Evento «' + ev.name + '».', 'evento');
    const res = E().run(ev.actions, ctx);
    if (res.pause) {
      w.ex.pending = { kind: 'combattimento', gridId: w.ex.gridId, instanceId: inst.state ? inst.id : '', name: ev.name, action: res.pause.action, rest: res.pause.rest, combatId: '' };
    } else {
      // Quest: obiettivi «Completa un evento» (per modello o per copia).
      const qv = worldOf(w);
      if (qv) for (const l of DnD.quest.onEvent(qv.world.quests, qv.quests, inst.templateId || ev.id).concat(inst.templateId ? DnD.quest.onEvent(qv.world.quests, qv.quests, inst.id) : [])) log(w, l, 'quest');
    }
    if (inst.state) inst.state.outcomes = inst.state.outcomes.concat('giorno ' + w.ex.time.day + ': ' + (res.pause ? 'combattimento' : 'eseguito')).slice(-20);
    return res;
  }
  // Ripresa dopo il combattimento: registra l'esito e continua con le azioni rimaste.
  function resumeAfterCombat(w, outcome) {
    const p = w.ex.pending;
    if (!p) return null;
    w.ex.pending = null;
    w.ex.variables['esito combattimento'] = outcome;
    log(w, '⚔ Esito del combattimento («' + p.name + '»): ' + outcome + '.', 'combattimento');
    const res = E().run(p.rest, eventCtx(w));
    if (res.pause) w.ex.pending = Object.assign({}, p, { action: res.pause.action, rest: res.pause.rest, combatId: '' });
    return res;
  }

  DnD.esplorazione = {
    KINDS, UNITS, UNIT_NAMES, UNIT_KM, SCALE_PRESETS, DEFAULT_SCALE, LOG_MAX,
    normalizeScale, scaleKm, scaleLabel, formatDistance, normalizeFog, normalizeGridExtras, extrasOf, resizeExtras,
    normalizeState, normalizeParty, normalizeMember, create, biomeAt, activeParty, partyMembers, memberState, placeName, log, queue, eventCtx, worldOf, questOp,
    advanceTime, resolveHazard, checkEncounter, stepCost, step, path, moveTo, split, merge, reveal, isSeen, setSeen, enterMap, exitMap, fireEvent, resumeAfterCombat,
  };
})(globalThis.DnD = globalThis.DnD || {});
