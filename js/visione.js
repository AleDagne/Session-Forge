// Luce, visione e nebbia di guerra (logica pura, nessun accesso al DOM). Dati di una griglia: `vision` (luce
// ambientale, sorgenti piazzate, celle della vista, stanze) e `fog` (nebbia: modalità, celle esplorate, ritocchi
// del master, ultime posizioni note). Calcoli: celle che bloccano la vista, linea di vista a celle (Bresenham,
// simmetrica), mappa della luce, sensi dei combattenti, celle visibili a una pedina (anche multi-cella), chi vede chi,
// modificatori d'attacco, nebbia per i giocatori (manuale, automatica, mista, memoria, stanze), pennelli e
// `visioneGiocatore()` (lo stato filtrato che il master può mandare ai giocatori). I raggi sono in piedi.
(function (DnD) {
  'use strict';

  const K = () => DnD.visioneDati;
  const G = () => DnD.griglia;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const hex = (v, def) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const ID = /^[\w-]{1,64}$/;
  const id = (v) => (typeof v === 'string' && ID.test(v) ? v : DnD.dadi.uid());
  const bits = (v, n, chars, fill) => {
    const s = typeof v === 'string' ? v.replace(new RegExp('[^' + chars + ']', 'g'), fill) : '';
    return (s + fill.repeat(n)).slice(0, n);
  };
  const has = (c, type) => Boolean(DnD.condizioni && DnD.condizioni.has(c, type));
  const sourceById = (k) => K().SOURCES.find((s) => s.id === k) || null;

  // ---------- Normalizzazione ----------
  // Luce emessa da un oggetto di mappa o da una struttura (null = nessuna).
  function normalizeEmitter(l) {
    if (!l || typeof l !== 'object') return null;
    return { on: l.on !== false, bright: num(l.bright, 20, 0, 1000), dim: num(l.dim, 20, 0, 1000), color: hex(l.color, '#ffcf7a'), flicker: Boolean(l.flicker) };
  }
  // Sorgente piazzata sulla griglia (strumento Luce, incantesimi): luce o zona di buio magico, durata facoltativa
  // (minuti di gioco rimasti, null = illimitata), collegamento a una concentrazione.
  function normalizeLight(l, d) {
    l = obj(l);
    const link = obj(l.link);
    const dark = Boolean(l.dark);
    return Object.assign({
      id: id(l.id), name: str(l.name, 60) || (dark ? K().DARKNESS.name : 'Luce'), kind: str(l.kind, 40),
      x: int(l.x, 0, 0, Math.max(0, d.w - 1)), y: int(l.y, 0, 0, Math.max(0, d.h - 1)), dark,
      minutes: l.minutes === null || l.minutes === undefined || l.minutes === '' ? null : num(l.minutes, 60, 0, 1e6),
      link: link.casterId && link.spellId ? { casterId: str(link.casterId, 64), spellId: str(link.spellId, 64) } : null,
    }, normalizeEmitter(Object.assign({ bright: dark ? 0 : 20, dim: dark ? K().DARKNESS.radius : 20 }, l)));
  }
  // Sorgente portata da una pedina (o dal gruppo dell'esplorazione): tipo dall'elenco dei dati.
  function normalizeCarried(l) {
    if (!l || typeof l !== 'object') return null;
    const src = sourceById(l.kind);
    if (!src) return null;
    return { kind: src.id, on: l.on !== false, minutes: l.minutes === null || l.minutes === undefined ? src.minutes : num(l.minutes, src.minutes || 0, 0, 1e6) };
  }
  function normalizeSenses(s) {
    s = obj(s);
    return Object.fromEntries(K().SENSES.concat('range').map((k) => [k, int(s[k], 0, 0, 5000)]));
  }
  function normalizeRoom(r, d) {
    r = obj(r);
    const seen = new Set();
    const cells = arr(r.cells).map(obj).map((c) => ({ x: int(c.x, -1, -1, 1e4), y: int(c.y, -1, -1, 1e4) }))
      .filter((c) => c.x >= 0 && c.y >= 0 && c.x < d.w && c.y < d.h && !seen.has(c.y * d.w + c.x) && seen.add(c.y * d.w + c.x)).slice(0, K().MAX_ROOM_CELLS);
    return { id: id(r.id), name: str(r.name, 60) || 'Stanza', cells, revealed: Boolean(r.revealed) };
  }
  // Luce e visione della griglia. Griglie precedenti: giorno (luce intensa ovunque), nessuna sorgente.
  function normalizeVision(v, w, h) {
    v = obj(v);
    const d = { w, h };
    return {
      ambient: K().AMBIENTS.includes(v.ambient) ? v.ambient : 'giorno',
      stepped: Boolean(v.stepped),
      lights: arr(v.lights).slice(0, K().MAX_LIGHTS).map((l) => normalizeLight(l, d)),
      sight: bits(v.sight, w * h, '0-3', '0'),
      rooms: arr(v.rooms).slice(0, K().MAX_ROOMS).map((r) => normalizeRoom(r, d)),
    };
  }
  // Nebbia: seen = celle esplorate (memoria, anche la nebbia di scoperta dell'esplorazione); manual = ritocchi del
  // master ('1' rivelata, '2' nascosta, '0' nessuno). Griglie precedenti: spenta.
  function normalizeFog(f, w, h) {
    f = obj(f);
    const lk = obj(f.lastKnown);
    return {
      enabled: Boolean(f.enabled),
      mode: K().FOG_MODES.includes(f.mode) ? f.mode : 'mista',
      seen: bits(f.seen, w * h, '01', '0'),
      manual: bits(f.manual, w * h, '0-2', '0'),
      opacity: num(f.opacity, K().FOG_OPACITY, 0.1, 0.95),
      ghosts: Boolean(f.ghosts),
      lastKnown: Object.fromEntries(Object.entries(lk).filter(([k]) => ID.test(k)).slice(0, 200)
        .map(([k, p]) => [k, { x: int(obj(p).x, 0, 0, w - 1), y: int(obj(p).y, 0, 0, h - 1) }])),
    };
  }
  const emptyVision = (w, h) => normalizeVision({}, w, h);
  const emptyFog = (w, h) => normalizeFog({}, w, h);
  // Griglie create al volo (combattimento senza griglia di partenza): luce e nebbia di base, se mancano.
  function ensure(grid) {
    const d = G().dims(grid);
    if (!grid.vision) grid.vision = emptyVision(d.w, d.h);
    if (!grid.fog || typeof grid.fog.manual !== 'string') grid.fog = normalizeFog(grid.fog, d.w, d.h);
    return grid;
  }

  // Ridimensionamento: le stringhe di celle seguono le celle, sorgenti e stanze fuori dall'area si tolgono.
  function resize(vision, fog, ow, oh, nw, nh, dx, dy) {
    const shiftStr = (s, def) => {
      let out = '';
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const ox = x - dx;
        const oy = y - dy;
        out += ox >= 0 && oy >= 0 && ox < ow && oy < oh && s ? s[oy * ow + ox] || def : def;
      }
      return out;
    };
    const inside = (c) => c.x >= 0 && c.y >= 0 && c.x < nw && c.y < nh;
    const v = vision ? clone(vision) : emptyVision(ow, oh);
    const f = fog ? clone(fog) : emptyFog(ow, oh);
    v.sight = shiftStr(v.sight, '0');
    v.lights = v.lights.map((l) => Object.assign(l, { x: l.x + dx, y: l.y + dy })).filter(inside);
    v.rooms = v.rooms.map((r) => Object.assign(r, { cells: r.cells.map((c) => ({ x: c.x + dx, y: c.y + dy })).filter(inside) })).filter((r) => r.cells.length);
    f.seen = shiftStr(f.seen, '0');
    f.manual = shiftStr(f.manual, '0');
    f.lastKnown = {};
    return { vision: normalizeVision(v, nw, nh), fog: normalizeFog(f, nw, nh) };
  }

  // ---------- Sensi ----------
  const feet = (m) => DnD.movimento.feetFromMeters(m);
  // Dalla razza (scurovisione in metri) o dalla scheda della creatura (sensi in metri).
  const sensesFromRace = (race) => normalizeSenses({ darkvision: race && race.darkvision ? feet(race.darkvision) : 0 });
  const sensesFromCreature = (m) => normalizeSenses(Object.fromEntries(K().SENSES.map((k) => [k, feet(obj(m && m.senses)[k])])));
  // Sensi effettivi di un combattente: i suoi più quelli dei nodi del Percorso leggendario (in metri).
  function sensesOf(c) {
    const out = normalizeSenses(c && c.senses);
    const legend = c && c.legend && c.legend.senses ? c.legend.senses : {};
    for (const [k, v] of Object.entries(legend)) {
      const key = K().LEGEND_SENSES[k];
      if (key) out[key] = Math.max(out[key], feet(v));
    }
    return out;
  }
  const sensesText = (s) => K().SENSES.concat('range').filter((k) => s[k] > 0)
    .map((k) => K().SENSE_NAMES[k].toLowerCase() + ' ' + s[k] + ' ft').join(', ') || 'vista normale';

  // ---------- Celle che bloccano la vista ----------
  // Le porte bloccano la vista finché sono chiuse; gli altri oggetti solo con «Blocca la vista».
  const objectBlocksSight = (it) => (it.otype === 'porta' ? it.state !== 'aperto' : Boolean(it.blocksSight));
  // { w, h, block, obscured }: strutture con «Blocca la vista» (di base sì), porte chiuse e oggetti che bloccano la
  // vista, tile bloccanti e celle forzate della TileMap; poi le celle della vista scelte a mano (blocca, non blocca,
  // leggermente oscurata). Una finestra (struttura che blocca il movimento ma non la vista) lascia vedere.
  function sightMap(grid, tilesets) {
    const d = G().dims(grid);
    const n = d.w * d.h;
    const block = new Uint8Array(n);
    const obscured = new Uint8Array(n);
    const mark = (e) => {
      for (let j = 0; j < e.h; j++) for (let i = 0; i < e.w; i++) {
        const x = e.x + i;
        const y = e.y + j;
        if (G().isFilled(e, i, j) && x >= 0 && y >= 0 && x < d.w && y < d.h) block[y * d.w + x] = 1;
      }
    };
    for (const s of grid.structures || []) if (s.blocksSight !== false) mark(s);
    for (const it of grid.items || []) if (objectBlocksSight(it)) mark(it);
    if (grid.tileMap) for (const k of DnD.collisioni.blockedSet(grid.tileMap, tilesets || DnD.tilemap.storeIndex(), d.w)) if (k < n) block[k] = 1;
    const sight = grid.vision && grid.vision.sight;
    if (sight) for (let i = 0; i < n; i++) {
      const c = sight[i];
      if (c === '1') block[i] = 1;
      else if (c === '2') block[i] = 0;
      else if (c === '3') { block[i] = 0; obscured[i] = 1; }
    }
    return { w: d.w, h: d.h, block, obscured };
  }

  // Linea di vista tra i centri di due celle (Bresenham): bloccata se una cella intermedia blocca la vista.
  // Simmetrica: basta una delle due direzioni (la vista non dipende da chi guarda).
  function line(sm, a, b) {
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - a.x);
    const dy = -Math.abs(b.y - a.y);
    const sx = a.x < b.x ? 1 : -1;
    const sy = a.y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x === b.x && y === b.y) return true;
      if (!(x === a.x && y === a.y) && sm.block[y * sm.w + x]) return false;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  const lineOfSight = (sm, a, b) => line(sm, a, b) || line(sm, b, a);

  // ---------- Luce ----------
  const hourLevel = (h) => {
    const hour = ((Math.floor(Number(h) || 0) % 24) + 24) % 24;
    if (hour >= K().DAY_HOURS.from && hour <= K().DAY_HOURS.to) return 2;
    return K().TWILIGHT_HOURS.includes(hour) ? 1 : 0;
  };
  // Livello della luce ambientale: dalla scelta della mappa o, «Automatica», dall'ora e dal bioma (env: { hour, biomeLight }).
  function ambientLevel(ambient, env) {
    if (ambient === 'auto') {
      const e = obj(env);
      const byHour = e.hour === undefined || e.hour === null ? 2 : hourLevel(e.hour);
      const byBiome = K().BIOME_LEVEL[e.biomeLight];
      return Math.min(byHour, byBiome === undefined ? 2 : byBiome);
    }
    const l = K().AMBIENT_LEVEL[ambient];
    return l === undefined ? 2 : l;
  }

  // Piedi per cella: quelli della griglia di battaglia; nelle mappe di esplorazione dalla scala (1,5 km = 4921 ft).
  const feetPerCell = (grid) => (grid.kind === 'esplorazione' && grid.scale && DnD.esplorazione
    ? Math.max(1, Math.round(DnD.esplorazione.scaleKm(grid.scale) * 3280.84)) : grid.feetPerCell || 5);
  const rectOf = (e, pos) => { const d = G().tokenDims(e); return { x0: pos.x, y0: pos.y, x1: pos.x + d.w - 1, y1: pos.y + d.h - 1 }; };
  const centerOf = (r) => ({ x: Math.floor((r.x0 + r.x1) / 2), y: Math.floor((r.y0 + r.y1) / 2), cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 });
  // Sorgenti accese: piazzate, di strutture e oggetti, portate dalle pedine. { x, y (cella), cx, cy, bright, dim, color, flicker, dark, ref }
  function emitters(grid, combatants) {
    const out = [];
    const v = grid.vision || {};
    for (const l of v.lights || []) if (l.on && l.minutes !== 0) out.push({ x: l.x, y: l.y, cx: l.x, cy: l.y, bright: l.bright, dim: l.dim, color: l.color, flicker: l.flicker, dark: l.dark, ref: 'luce:' + l.id });
    const fromShape = (e, ref) => {
      const c = centerOf({ x0: e.x, y0: e.y, x1: e.x + e.w - 1, y1: e.y + e.h - 1 });
      out.push(Object.assign(c, { bright: e.light.bright, dim: e.light.dim, color: e.light.color, flicker: e.light.flicker, dark: false, ref }));
    };
    for (const s of grid.structures || []) if (s.light && s.light.on) fromShape(s, 'struttura:' + s.id);
    for (const it of grid.items || []) if (it.light && it.light.on) fromShape(it, 'oggetto:' + it.id);
    for (const c of combatants || []) {
      const l = c.light;
      const src = l && l.on && l.minutes !== 0 && c.pos ? sourceById(l.kind) : null;
      if (src) out.push(Object.assign(centerOf(rectOf(c, c.pos)), { bright: src.bright, dim: src.dim, color: src.color, flicker: src.flicker, dark: false, ref: 'pedina:' + c.id }));
    }
    return out;
  }
  // Mappa della luce: livello di ogni cella (luce ambientale, poi le sorgenti fermate dai muri) e buio magico.
  // env: { hour, biomeLight } per la luce automatica.
  function lightMap(grid, combatants, sm, env) {
    const d = G().dims(grid);
    const fpc = feetPerCell(grid);
    const amb = ambientLevel(grid.vision ? grid.vision.ambient : 'giorno', env);
    const level = new Uint8Array(d.w * d.h).fill(amb);
    const magic = new Uint8Array(d.w * d.h);
    // Sorgente che illumina ogni cella (-1 = solo luce ambientale), per il colore della luce nel disegno.
    const src = new Int16Array(d.w * d.h).fill(-1);
    const list = emitters(grid, combatants);
    list.forEach((e, k) => {
      const rb = e.bright / fpc;
      const rd = (e.bright + e.dim) / fpc;
      const r = Math.ceil(rd);
      for (let y = Math.max(0, e.y - r); y <= Math.min(d.h - 1, e.y + r); y++) {
        for (let x = Math.max(0, e.x - r); x <= Math.min(d.w - 1, e.x + r); x++) {
          const dist = Math.hypot(x - e.cx, y - e.cy);
          if (dist > rd + 0.25) continue;
          const i = y * d.w + x;
          if (e.dark) { magic[i] = 1; continue; }
          if (amb === 2 || level[i] === 2) continue;
          if (!lineOfSight(sm, { x: e.x, y: e.y }, { x, y })) continue;
          const lv = dist <= rb + 0.25 ? 2 : 1;
          if (lv > level[i] || src[i] < 0) { level[i] = Math.max(level[i], lv); src[i] = k; }
        }
      }
    });
    for (let i = 0; i < magic.length; i++) if (magic[i]) { level[i] = 0; src[i] = -1; }
    return { level, magic, src, ambient: amb, emitters: list };
  }

  // Contesto di calcolo di una griglia: celle della vista e luce. opts: { tilesets, hour, biomeLight }.
  function context(grid, combatants, opts) {
    const o = opts || {};
    const d = G().dims(grid);
    const sm = sightMap(grid, o.tilesets);
    return { grid, w: d.w, h: d.h, n: d.w * d.h, fpc: feetPerCell(grid), sm, lm: lightMap(grid, combatants || [], sm, o), combatants: combatants || [] };
  }
  const lightAt = (ctx, x, y) => (x >= 0 && y >= 0 && x < ctx.w && y < ctx.h ? ctx.lm.level[y * ctx.w + x] : 0);

  // ---------- Visione ----------
  const canPerceive = (c) => Boolean(c) && !(typeof c.hp === 'number' && c.hp <= 0) && !has(c, 'privo di sensi');
  // Distanza (in celle) dal rettangolo di una pedina al centro di una cella.
  const rectDist = (r, x, y) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));
  // Livello con cui chi guarda percepisce la cella i a una distanza dist (celle), senza contare la linea di vista.
  // { lvl, cause } con la causa quando non vede.
  function perceived(ctx, se, blind, dist, i) {
    const ft = dist * ctx.fpc;
    if (se.blindsight && ft <= se.blindsight) return { lvl: 2, how: 'blindsight' };
    if (blind) return { lvl: 0, cause: 'accecato' };
    if (se.range && ft > se.range) return { lvl: 0, cause: 'raggio' };
    const pure = se.truesight && ft <= se.truesight;
    if (ctx.lm.magic[i]) return pure ? { lvl: 2, how: 'truesight' } : { lvl: 0, cause: 'magico' };
    if (pure) return { lvl: 2, how: 'truesight' };
    let L = ctx.lm.level[i];
    let how = 'vista';
    if (se.darkvision && ft <= se.darkvision && L < 2) { L += 1; how = 'darkvision'; }
    if (ctx.sm.obscured[i]) L = Math.min(L, 1);
    return L ? { lvl: L, how } : { lvl: 0, cause: 'buio' };
  }
  const footprint = (r) => { const out = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push({ x, y }); return out; };
  const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  const seesFrom = (ctx, origins, x, y) => origins.some((o) => lineOfSight(ctx.sm, o, { x, y }));

  // Celle che una pedina vede (anche w×h: basta una cella dell'ingombro): Uint8Array con 0 = non vista,
  // 1 = penombra (leggermente oscurata), 2 = vista bene. pos facoltativa (posizione da provare).
  function viewOf(ctx, viewer, pos) {
    const out = new Uint8Array(ctx.n);
    const p = pos || (viewer && viewer.pos);
    if (!p || !canPerceive(viewer)) return out;
    const se = sensesOf(viewer);
    const blind = has(viewer, 'accecato');
    const r = rectOf(viewer, p);
    const origins = footprint(r).filter((c) => c.x >= 0 && c.y >= 0 && c.x < ctx.w && c.y < ctx.h);
    for (let y = 0; y < ctx.h; y++) {
      for (let x = 0; x < ctx.w; x++) {
        const i = y * ctx.w + x;
        if (inRect(r, x, y)) { out[i] = Math.max(1, perceived(ctx, se, blind, 0, i).lvl); continue; }
        const pc = perceived(ctx, se, blind, rectDist(r, x, y), i);
        if (pc.lvl && seesFrom(ctx, origins, x, y)) out[i] = pc.lvl;
      }
    }
    return out;
  }

  // Chi guarda vede il bersaglio? { seen, level, how, cause } (cause: chiave di CAUSES quando non lo vede).
  // Percezione tellurica: sente chi tocca il suolo nel raggio, senza linea di vista. Invisibile: solo con vista pura
  // o vista cieca nel raggio. «Nascosto» (scelta del master) = non visto.
  function canSee(ctx, viewer, target, viewerPos) {
    const vp = viewerPos || (viewer && viewer.pos);
    if (!target || !target.pos || !vp) return { seen: false, level: 0, how: '', cause: 'linea' };
    if (target.hidden) return { seen: false, level: 0, how: '', cause: 'nascosto' };
    const se = sensesOf(viewer);
    const vr = rectOf(viewer, vp);
    const tr = rectOf(target, target.pos);
    const gapX = Math.max(tr.x0 - vr.x1, 0, vr.x0 - tr.x1);
    const gapY = Math.max(tr.y0 - vr.y1, 0, vr.y0 - tr.y1);
    const ft = Math.hypot(gapX, gapY) * ctx.fpc;
    const flying = target.moveMode === 'volare';
    if (se.tremorsense && ft <= se.tremorsense && !flying && canPerceive(viewer)) return { seen: true, level: 2, how: 'tremorsense', cause: '' };
    if (!canPerceive(viewer)) return { seen: false, level: 0, how: '', cause: 'accecato' };
    const special = (se.truesight && ft <= se.truesight) || (se.blindsight && ft <= se.blindsight);
    if (has(target, 'invisibile') && !special) return { seen: false, level: 0, how: '', cause: 'invisibile' };
    const blind = has(viewer, 'accecato');
    const origins = footprint(vr).filter((c) => c.x >= 0 && c.y >= 0 && c.x < ctx.w && c.y < ctx.h);
    let best = { lvl: 0, how: '' };
    let cause = '';
    for (const c of footprint(tr)) {
      if (c.x < 0 || c.y < 0 || c.x >= ctx.w || c.y >= ctx.h) continue;
      const pc = perceived(ctx, se, blind, rectDist(vr, c.x, c.y), c.y * ctx.w + c.x);
      if (!pc.lvl) { cause = cause || pc.cause; continue; }
      if (!inRect(vr, c.x, c.y) && !seesFrom(ctx, origins, c.x, c.y)) { cause = cause || 'linea'; continue; }
      if (pc.lvl > best.lvl) best = pc;
      if (best.lvl === 2) break;
    }
    return best.lvl ? { seen: true, level: best.lvl, how: best.how, cause: '' } : { seen: false, level: 0, how: '', cause: cause || 'linea' };
  }

  // Attacco: svantaggio contro un bersaglio non visto, vantaggio se il bersaglio non vede chi attacca.
  // Accecato e invisibile sono già nelle condizioni (condizioni.attackMods): qui non si ripetono.
  // { adv: [cause], dis: [cause] } da passare a condizioni.attackMods (opzione vision).
  function attackVision(ctx, attacker, target) {
    const out = { adv: [], dis: [] };
    if (!attacker || !target || !attacker.pos || !target.pos) return out;
    const skip = ['accecato', 'invisibile', 'nascosto'];
    const a = canSee(ctx, attacker, target);
    if (!a.seen && !skip.includes(a.cause)) out.dis.push(K().CAUSES[a.cause] + ' (bersaglio non visto)');
    if (canPerceive(target) && !has(target, 'accecato')) {
      const t = canSee(ctx, target, attacker);
      if (!t.seen && !skip.includes(t.cause)) out.adv.push(K().CAUSES[t.cause] + ' (il bersaglio non vede chi attacca)');
    }
    return out;
  }
  // Prova di Percezione basata sulla vista verso una cella: svantaggio in penombra (zona leggermente oscurata).
  function perceptionMods(ctx, viewer, cell) {
    const i = cell.y * ctx.w + cell.x;
    const pc = perceived(ctx, sensesOf(viewer), has(viewer, 'accecato'), rectDist(rectOf(viewer, viewer.pos), cell.x, cell.y), i);
    if (pc.lvl === 1) return { dis: [K().CAUSES.penombra + ': svantaggio alla Percezione'], blind: false };
    if (!pc.lvl) return { dis: [], blind: true, cause: K().CAUSES[pc.cause] };
    return { dis: [], blind: false };
  }

  // ---------- Giocatori ----------
  // Le pedine dei giocatori (e della loro fazione) rivelano la nebbia automatica.
  const isPlayer = (c) => c.kind === 'player' || c.faction === 'giocatori';
  // Unione di ciò che vedono i giocatori: { cells (Uint8Array 0/1/2), seenIds (gli altri combattenti visti) }.
  function playersView(ctx) {
    const cells = new Uint8Array(ctx.n);
    const players = ctx.combatants.filter((c) => isPlayer(c) && c.pos);
    for (const p of players) {
      const v = viewOf(ctx, p);
      for (let i = 0; i < ctx.n; i++) if (v[i] > cells[i]) cells[i] = v[i];
    }
    const seenIds = new Set(players.map((p) => p.id));
    for (const c of ctx.combatants) {
      if (seenIds.has(c.id) || !c.pos) continue;
      if (players.some((p) => canSee(ctx, p, c).seen)) seenIds.add(c.id);
    }
    return { cells, seenIds };
  }

  // ---------- Nebbia ----------
  // Stato di ogni cella per i giocatori: 0 = nascosta, 1 = esplorata (memoria), 2 = visibile ora.
  // Manuale: solo i ritocchi del master; Automatica: solo la visione (con la memoria); Mista: entrambe.
  function cellStates(grid, visible) {
    const n = grid.w * grid.h;
    const out = new Uint8Array(n);
    const f = grid.fog;
    if (!f || !f.enabled) return out.fill(2);
    const manual = f.mode !== 'auto';
    const auto = f.mode !== 'manuale';
    for (let i = 0; i < n; i++) {
      const m = f.manual[i];
      if (manual && m === '2') continue;
      if ((manual && m === '1') || (auto && visible && visible[i])) out[i] = 2;
      else if (f.seen[i] === '1') out[i] = 1;
    }
    return out;
  }
  // Memoria: le celle viste restano esplorate. Restituisce quante celle sono state esplorate ora.
  function remember(grid, visible) {
    const f = grid.fog;
    if (!f || !f.enabled || f.mode === 'manuale' || !visible) return 0;
    let n = 0;
    const a = f.seen.split('');
    for (let i = 0; i < a.length; i++) if (visible[i] && a[i] !== '1') { a[i] = '1'; n++; }
    if (n) f.seen = a.join('');
    return n;
  }
  // Pennello del master: rivela ('1') o nasconde ('2', e dimentica la cella) le celle indicate.
  function paintFog(grid, cells, reveal) {
    const f = grid.fog;
    const m = f.manual.split('');
    const s = f.seen.split('');
    let n = 0;
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= grid.w || c.y >= grid.h) continue;
      const i = c.y * grid.w + c.x;
      const want = reveal ? '1' : '2';
      if (m[i] !== want || (!reveal && s[i] === '1')) n++;
      m[i] = want;
      if (!reveal) s[i] = '0';
    }
    f.manual = m.join('');
    f.seen = s.join('');
    return n;
  }
  function revealAll(grid) { grid.fog.manual = '1'.repeat(grid.w * grid.h); }
  function hideAll(grid) {
    const n = grid.w * grid.h;
    Object.assign(grid.fog, { manual: '0'.repeat(n), seen: '0'.repeat(n), lastKnown: {} });
    for (const r of (grid.vision && grid.vision.rooms) || []) r.revealed = false;
  }
  // Celle dei pennelli: cerchio (centro a, raggio fino a b), rettangolo tra a e b, riempimento dell'area chiusa
  // dai muri (le celle che bloccano la vista sul bordo sono comprese).
  function brushCells(grid, shape, a, b, sm) {
    const d = G().dims(grid);
    const inside = (x, y) => x >= 0 && y >= 0 && x < d.w && y < d.h;
    const out = [];
    if (shape === 'rettangolo') {
      const r = G().rectBetween(a, b || a, grid);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
      return out;
    }
    if (shape === 'riempi') {
      const map = sm || sightMap(grid);
      const seen = new Uint8Array(d.w * d.h);
      const queue = [a];
      seen[a.y * d.w + a.x] = 1;
      while (queue.length && out.length < K().FILL_MAX) {
        const c = queue.shift();
        out.push(c);
        if (map.block[c.y * d.w + c.x] && !(c.x === a.x && c.y === a.y)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (inside(x, y) && !seen[y * d.w + x]) { seen[y * d.w + x] = 1; queue.push({ x, y }); }
        }
      }
      return out;
    }
    const r = b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    const R = Math.ceil(r);
    for (let y = a.y - R; y <= a.y + R; y++) for (let x = a.x - R; x <= a.x + R; x++) if (inside(x, y) && Math.hypot(x - a.x, y - a.y) <= r + 0.5) out.push({ x, y });
    return out;
  }

  // Stanze: si rivelano (una volta) quando un giocatore ci entra o quando si apre una porta che le tocca.
  function roomsSweep(grid, combatants) {
    const lines = [];
    const rooms = (grid.vision && grid.vision.rooms) || [];
    if (!grid.fog || !grid.fog.enabled || !rooms.length) return lines;
    const players = (combatants || []).filter((c) => isPlayer(c) && c.pos);
    const doors = (grid.items || []).filter((it) => it.otype === 'porta' && it.state === 'aperto');
    for (const room of rooms) {
      if (room.revealed) continue;
      const keys = new Set(room.cells.map((c) => c.y * grid.w + c.x));
      const touches = (x, y, pad) => { for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) if (keys.has((y + dy) * grid.w + (x + dx))) return true; return false; };
      const entered = players.some((p) => footprint(rectOf(p, p.pos)).some((c) => keys.has(c.y * grid.w + c.x)));
      const door = doors.find((it) => footprint({ x0: it.x, y0: it.y, x1: it.x + it.w - 1, y1: it.y + it.h - 1 }).some((c) => touches(c.x, c.y, 1)));
      if (!entered && !door) continue;
      room.revealed = true;
      paintFog(grid, room.cells, true);
      const s = grid.fog.seen.split('');
      for (const c of room.cells) s[c.y * grid.w + c.x] = '1';
      grid.fog.seen = s.join('');
      lines.push('🚪 La stanza «' + room.name + '» si rivela' + (entered ? ' (i giocatori entrano).' : ' (si apre «' + door.name + '»).'));
    }
    return lines;
  }
  // Ultime posizioni note dei nemici (fantasmi): aggiornate quando i giocatori li vedono.
  function trackGhosts(grid, combatants, seenIds) {
    const f = grid.fog;
    const ids = new Set((combatants || []).map((c) => c.id));
    for (const k of Object.keys(f.lastKnown)) if (!ids.has(k)) delete f.lastKnown[k];
    for (const c of combatants || []) if (!isPlayer(c) && c.pos && seenIds.has(c.id)) f.lastKnown[c.id] = { x: c.pos.x, y: c.pos.y };
  }
  // Aggiorna la nebbia dopo un cambiamento (pedine, porte, sorgenti): memoria, stanze, fantasmi.
  // Restituisce { lines, explored } (nulla se la nebbia è spenta).
  function refreshFog(grid, combatants, opts) {
    if (!grid.fog || !grid.fog.enabled) return { lines: [], explored: 0 };
    const lines = roomsSweep(grid, combatants);
    if (grid.fog.mode === 'manuale' && !grid.fog.ghosts) return { lines, explored: 0 };
    const pv = playersView(context(grid, combatants, opts));
    const explored = remember(grid, pv.cells);
    trackGhosts(grid, combatants, pv.seenIds);
    return { lines, explored };
  }

  // ---------- Vista dei giocatori (per la fase Online) ----------
  // Stato che il master può mandare ai giocatori: mai celle nascoste, pedine fuori dalla loro vista, oggetti ed eventi
  // nascosti, note. doc: { grid, combatants }; opts: { tilesets, hour, biomeLight, visible (celle già calcolate) }.
  function visioneGiocatore(doc, opts) {
    const o = opts || {};
    const grid = doc.grid;
    const ctx = context(grid, doc.combatants, o);
    const pv = o.visible ? { cells: o.visible, seenIds: o.seenIds || new Set() } : playersView(ctx);
    const fogOn = Boolean(grid.fog && grid.fog.enabled);
    const states = cellStates(grid, pv.cells);
    const known = (x, y) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && states[y * grid.w + x] > 0;
    const visibleNow = (x, y) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && states[y * grid.w + x] === 2;
    const touches = (e, test) => footprint({ x0: e.x, y0: e.y, x1: e.x + e.w - 1, y1: e.y + e.h - 1 }).some((c) => test(c.x, c.y));
    const strip = (e) => { const c = clone(e); delete c.notes; delete c.npcState; delete c.trap; delete c.lock; delete c.contents; delete c.coins; return c; };
    let tileMap = grid.tileMap ? clone(grid.tileMap) : null;
    if (tileMap && fogOn) for (const l of tileMap.layers || []) if (Array.isArray(l.data)) for (let i = 0; i < l.data.length; i++) if (!states[i]) l.data[i] = 0;
    const players = doc.combatants.filter(isPlayer);
    const shown = doc.combatants.filter((c) => c.pos && (players.includes(c) || (!fogOn ? !c.hidden : pv.seenIds.has(c.id) && touches(Object.assign({ x: c.pos.x, y: c.pos.y }, G().tokenDims(c)), visibleNow))));
    return {
      w: grid.w, h: grid.h, feetPerCell: grid.feetPerCell || 5, background: clone(grid.background || null), kind: grid.kind || 'battaglia',
      cells: Array.from(states).join(''),
      structures: (grid.structures || []).filter((s) => !fogOn || touches(s, known)).map(strip),
      items: (grid.items || []).filter((it) => !it.hidden && (it.otype === 'npc' ? touches(it, visibleNow) : !fogOn || touches(it, known))).map(strip),
      labels: (grid.labels || []).filter((l) => !fogOn || known(l.x, l.y)).map(clone),
      tileMap,
      events: (grid.events || []).filter((e) => DnD.eventi && DnD.eventi.isVisible(e) && e.cells.some((c) => !fogOn || known(c.x, c.y)))
        .map((e) => ({ id: e.id, name: e.event.name, icon: clone(e.event.icon), cells: clone(e.cells) })),
      combatants: shown.map((c) => ({ id: c.id, name: c.name, icon: clone(c.icon || null), pos: Object.assign({}, c.pos), w: G().tokenDims(c).w, h: G().tokenDims(c).h, kind: c.kind, faction: c.faction })),
      ghosts: fogOn && grid.fog.ghosts ? Object.entries(grid.fog.lastKnown).filter(([k]) => !shown.some((c) => c.id === k)).map(([, p]) => Object.assign({}, p)) : [],
    };
  }

  // ---------- Sorgenti in gioco ----------
  // Accende, spegne o cambia la sorgente portata da una pedina (kind = id della sorgente, '' = togli).
  function setCarried(c, kind, on) {
    if (!kind) { const had = Boolean(c.light); c.light = null; return had ? c.name + ' posa la sua sorgente di luce.' : ''; }
    const src = sourceById(kind);
    if (!src) return '';
    if (!c.light || c.light.kind !== kind) c.light = { kind, on: true, minutes: src.minutes };
    else c.light.on = on === undefined ? !c.light.on : Boolean(on);
    if (c.light.on && c.light.minutes === 0) c.light.minutes = src.minutes;
    return (c.light.on ? src.icon + ' ' + c.name + ' accende: ' : c.name + ' spegne: ') + src.name.toLowerCase() + '.';
  }
  // Il tempo consuma le sorgenti a durata (minuti di gioco): a 0 si spengono, con una riga per ciascuna.
  function tickLights(grid, combatants, minutes) {
    const lines = [];
    if (!(minutes > 0)) return lines;
    for (const l of (grid && grid.vision && grid.vision.lights) || []) {
      if (!l.on || l.minutes === null) continue;
      l.minutes = Math.max(0, Math.round((l.minutes - minutes) * 100) / 100);
      if (!l.minutes) { l.on = false; lines.push('«' + l.name + '» si spegne.'); }
    }
    if (grid && grid.vision) grid.vision.lights = grid.vision.lights.filter((l) => l.on || !l.dark);
    for (const c of combatants || []) {
      const l = c.light;
      if (!l || !l.on || l.minutes === null) continue;
      l.minutes = Math.max(0, Math.round((l.minutes - minutes) * 100) / 100);
      if (!l.minutes) { l.on = false; lines.push('La sorgente di ' + c.name + ' (' + sourceById(l.kind).name.toLowerCase() + ') si esaurisce.'); }
    }
    return lines;
  }
  // Incantesimi di luce e oscurità (riconosciuti dal nome): { source } o { dark } oppure null.
  const spellEffect = (spell) => (spell && K().SPELLS[String(spell.name || '').trim().toLowerCase()]) || null;
  // Crea la sorgente (o la zona di buio) dell'incantesimo nella cella indicata, collegata alla concentrazione.
  function castLight(grid, caster, spell, cell) {
    const fx = spellEffect(spell);
    if (!fx || !cell) return '';
    const src = fx.dark ? null : sourceById(fx.source);
    const link = spell.concentration ? { casterId: caster.id, spellId: spell.id } : null;
    const base = fx.dark
      ? { name: 'Oscurità (' + caster.name + ')', dark: true, bright: 0, dim: K().DARKNESS.radius, minutes: K().DARKNESS.minutes }
      : { name: src.name + ' (' + caster.name + ')', kind: src.id, bright: src.bright, dim: src.dim, color: src.color, flicker: src.flicker, minutes: src.minutes };
    grid.vision.lights.push(normalizeLight(Object.assign(base, { x: cell.x, y: cell.y, link }), grid));
    return (fx.dark ? '🌑 Una sfera di buio magico avvolge ' : '✨ Una luce magica illumina ') + G().cellLabel(cell.x, cell.y) + (link ? ' (finché ' + caster.name + ' resta concentrato).' : '.');
  }
  // Toglie le sorgenti collegate a una concentrazione finita.
  function pruneLinked(grid, combatants) {
    if (!grid || !grid.vision) return [];
    const lines = [];
    grid.vision.lights = grid.vision.lights.filter((l) => {
      if (!l.link) return true;
      const c = (combatants || []).find((x) => x.id === l.link.casterId);
      if (c && c.concentration && c.concentration.spellId === l.link.spellId) return true;
      lines.push('«' + l.name + '» svanisce: la concentrazione è finita.');
      return false;
    });
    return lines;
  }

  // ---------- Esplorazione ----------
  // Celle nel raggio di scoperta attorno a una cella (cerchio, come la nebbia di scoperta).
  function discoveryCells(grid, pos, r) {
    const out = [];
    for (let y = pos.y - r; y <= pos.y + r; y++) for (let x = pos.x - r; x <= pos.x + r; x++) {
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
      if ((x - pos.x) ** 2 + (y - pos.y) ** 2 > r * r + r) continue;
      out.push({ x, y });
    }
    return out;
  }
  // Raggio di scoperta con la luce: base (bioma + meteo) corretta dal livello di luce attorno al gruppo, alzato di uno
  // dalla scurovisione di un membro o da una sorgente accesa.
  function discoveryRadius(base, level, darkvision, carried) {
    let L = level;
    if (L < 2 && (darkvision || (carried && carried.on && carried.minutes !== 0))) L += 1;
    return Math.max(0, base + K().EXPLORE_DISCOVERY[L]);
  }

  // ---------- Disegno (dati per il rendering) ----------
  // Firma dello stato che cambia la nebbia e la luce: il disegno si ricalcola solo quando cambia.
  function signature(grid, combatants, extra) {
    const tm = grid.tileMap ? JSON.stringify([grid.tileMap.overrides, grid.tileMap.layers.map((l) => [l.visible, l.data])]) : '';
    let h = 0x811c9dc5;
    for (let i = 0; i < tm.length; i++) h = Math.imul(h ^ tm.charCodeAt(i), 0x01000193) >>> 0;
    return JSON.stringify([grid.w, grid.h, grid.feetPerCell, grid.vision, grid.fog,
      (grid.structures || []).map((s) => [s.id, s.x, s.y, s.w, s.h, s.cells, s.blocksSight, s.light]),
      (grid.items || []).map((it) => [it.id, it.x, it.y, it.w, it.h, it.otype, it.state, it.blocksSight, it.light, it.hidden]),
      (combatants || []).map((c) => [c.id, c.pos, c.w, c.h, c.hp > 0, c.light, c.senses, c.legend && c.legend.senses, c.kind, c.faction, c.hidden, c.moveMode,
        (c.conditions || []).map((e) => (typeof e === 'string' ? e : e.type))]),
      h, extra || null]);
  }

  DnD.visione = {
    normalizeEmitter, normalizeLight, normalizeCarried, normalizeSenses, normalizeRoom, normalizeVision, normalizeFog, emptyVision, emptyFog, ensure, resize,
    sensesFromRace, sensesFromCreature, sensesOf, sensesText, objectBlocksSight, sightMap, lineOfSight, hourLevel, ambientLevel, emitters, lightMap,
    context, lightAt, canPerceive, viewOf, canSee, attackVision, perceptionMods, isPlayer, playersView, cellStates, remember, paintFog, revealAll,
    hideAll, brushCells, roomsSweep, trackGhosts, refreshFog, visioneGiocatore, setCarried, tickLights, spellEffect, castLight, pruneLinked,
    discoveryCells, discoveryRadius, signature, sourceById, feetPerCell,
  };

  // Combattimento da una griglia salvata senza luce o nebbia: si parte da quelle vuote.
  DnD.griglia.registraVisioneVuota((w, h) => ({ vision: emptyVision(w, h), fog: emptyFog(w, h) }));
})(globalThis.DnD = globalThis.DnD || {});
