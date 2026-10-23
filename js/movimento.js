// Velocità e movimento nel combattimento (funzioni pure, nessun accesso al DOM).
// - Velocità di ogni combattente in PIEDI per modalità (camminare, scalare, nuotare, volare, scavare): dalla razza
//   o dalla scheda della creatura (in metri nelle librerie: 1,5 m = 5 ft), più i bonus dei nodi e degli oggetti,
//   la forma della trasformazione attiva e la sovrascrittura a mano. In celle: piedi / piedi per cella, per difetto.
// - Movimento del turno: { used, dashes, stood, disengaged, start, moves }. Residuo = velocità in celle ×
//   (1 + Scatti) − speso; si azzera all'inizio del turno del combattente.
// - Condizioni: afferrato, trattenuto, paralizzato (e pietrificato, privo di sensi) = 0; rallentato = metà;
//   prono = striscia (ogni casella costa una in più). Senza la velocità della modalità: vietata o costo doppio.
// - Percorso minimo (Dijkstra) con l'ingombro w×h, celle bloccate come isCellBlocked, pedine ostili che
//   bloccano, niente angoli tagliati. Costo di un passo = unità della diagonale × (terreno + extra): terreno
//   difficile 2 (tile), extra +1 per strisciare o per una modalità senza velocità. Diagonali: sempre 1 oppure
//   alternate 1-2-1 (stessa regola del misuratore). Usato dal trascinamento delle pedine e dall'IA.
(function (DnD) {
  'use strict';

  const G = () => DnD.griglia;
  const MODES = ['cammina', 'scalare', 'nuotare', 'volare', 'scavare'];
  const MODE_NAMES = { cammina: 'Camminare', scalare: 'Scalare', nuotare: 'Nuotare', volare: 'Volare', scavare: 'Scavare' };
  const MODE_ICONS = { cammina: '🚶', scalare: '🧗', nuotare: '🏊', volare: '🦅', scavare: '⛏' };
  const CREATURE_KEYS = { cammina: 'walk', scalare: 'climb', nuotare: 'swim', volare: 'fly', scavare: 'burrow' };
  const STOP = ['afferrato', 'trattenuto', 'paralizzato', 'pietrificato', 'privo di sensi'];
  const DIAGONALS = ['sempre1', 'alternata'];
  const DIAGONAL_NAMES = { sempre1: 'Sempre 1 casella', alternata: 'Alternata 1-2-1' };
  const MISSING = ['vietato', 'doppio'];
  const MISSING_NAMES = { vietato: 'Non può usarla', doppio: 'Costa il doppio (con la velocità a piedi)' };
  const DEFAULT_RULES = { diagonals: 'sempre1', missingMode: 'vietato' };
  const MAX_FEET = 1000;
  const MAX_MOVES = 60;

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const int = (v, def, lo, hi) => { const n = Math.round(Number(v)); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const posOf = (p) => (p && Number.isInteger(p.x) && Number.isInteger(p.y) ? { x: p.x, y: p.y } : null);

  // Condizioni del combattimento: quelle del manuale più «rallentato».
  const conditions = () => DnD.creatureDati.CONDITIONS.concat('rallentato');

  // ---------- Unità ----------
  const feetFromMeters = (m) => Math.max(0, Math.round(((Number(m) || 0) / 1.5) * 5));
  const metersFromFeet = (ft) => Math.round(ft * 0.3 * 100) / 100;
  // Celle da piedi: piedi / piedi per cella, arrotondato per difetto.
  const cellsOf = (feet, feetPerCell) => Math.max(0, Math.floor((Number(feet) || 0) / (feetPerCell > 0 ? feetPerCell : 5) + 1e-9));
  const formatFeet = (ft) => ft + ' ft (' + String(metersFromFeet(ft)).replace('.', ',') + ' m)';

  function normalizeRules(r) {
    r = obj(r);
    return { diagonals: DIAGONALS.includes(r.diagonals) ? r.diagonals : DEFAULT_RULES.diagonals, missingMode: MISSING.includes(r.missingMode) ? r.missingMode : DEFAULT_RULES.missingMode };
  }

  // ---------- Velocità (fonti) ----------
  function normalizeSpeeds(s) {
    s = obj(s);
    return Object.fromEntries(MODES.map((m) => [m, int(s[m], m === 'cammina' ? 30 : 0, 0, MAX_FEET)]));
  }
  const speedsFromRace = (race) => normalizeSpeeds({ cammina: feetFromMeters(race ? race.speed : 9) });
  const speedsFromCreature = (speed) => { const sp = obj(speed); return normalizeSpeeds(Object.fromEntries(MODES.map((m) => [m, feetFromMeters(sp[CREATURE_KEYS[m]] || 0)]))); };
  // Bonus in piedi (nodi del percorso, oggetti): si aggiunge a camminare e alle modalità che il combattente ha già.
  function addFeet(speeds, ft) {
    const out = normalizeSpeeds(speeds);
    if (!ft) return out;
    for (const m of MODES) if (m === 'cammina' || out[m] > 0) out[m] = Math.max(0, Math.min(MAX_FEET, out[m] + ft));
    return out;
  }
  // Velocità base del combattente (i dati precedenti hanno solo «speed» in metri, a piedi).
  const baseSpeeds = (c) => (c.speeds ? normalizeSpeeds(c.speeds) : speedsFromRace({ speed: c.speed === undefined ? 9 : c.speed }));
  function normalizeOverride(o) {
    o = obj(o);
    const out = {};
    for (const m of MODES) if (o[m] !== null && o[m] !== undefined && o[m] !== '' && Number.isFinite(Number(o[m]))) out[m] = int(o[m], 0, 0, MAX_FEET);
    return out;
  }
  const modeOf = (c) => (MODES.includes(c.moveMode) ? c.moveMode : 'cammina');
  const feetIn = (c, mode) => { const o = normalizeOverride(c.speedOverride); return o[mode] !== undefined ? o[mode] : baseSpeeds(c)[mode]; };

  // ---------- Stato della velocità ----------
  // { mode, usable, feet, cells, extra (costo in più per casella), reasons: [testo], zero }.
  function speedState(c, rules, feetPerCell) {
    const r = normalizeRules(rules);
    const mode = modeOf(c);
    const reasons = [];
    let feet = feetIn(c, mode);
    let extra = 0;
    let usable = true;
    if (mode !== 'cammina' && feet <= 0) {
      if (r.missingMode === 'doppio') { feet = feetIn(c, 'cammina'); extra += 1; reasons.push('senza velocità per ' + MODE_NAMES[mode].toLowerCase() + ': costo doppio'); }
      else { usable = false; feet = 0; reasons.push('non può ' + MODE_NAMES[mode].toLowerCase()); }
    }
    const conds = Array.isArray(c.conditions) ? c.conditions : [];
    const stop = STOP.find((x) => conds.includes(x));
    if (stop) { feet = 0; reasons.push(stop + ': velocità 0'); }
    else {
      if (conds.includes('rallentato')) { feet = Math.floor(feet / 2); reasons.push('rallentato: metà velocità'); }
      if (conds.includes('prono') && !(c.movement && c.movement.stood)) { extra += 1; reasons.push('prono: striscia (costo doppio)'); }
    }
    return { mode, usable, feet, cells: usable ? cellsOf(feet, feetPerCell) : 0, extra, reasons, zero: !usable || feet <= 0 };
  }
  // Velocità piena in celle (per lo Scatto e l'anteprima «con Scatto»).
  const speedCells = (c, rules, feetPerCell) => speedState(c, rules, feetPerCell).cells;

  // ---------- Movimento del turno ----------
  function normalizeMovement(m) {
    m = obj(m);
    return {
      used: int(m.used, 0, 0, 100000),
      dashes: int(m.dashes, 0, 0, 10),
      stood: Boolean(m.stood),
      disengaged: Boolean(m.disengaged),
      start: posOf(m.start),
      moves: (Array.isArray(m.moves) ? m.moves : []).slice(-MAX_MOVES).map((x) => ({ from: posOf(obj(x).from), to: posOf(obj(x).to), cost: int(obj(x).cost, 0, 0, 100000) })).filter((x) => x.from && x.to),
    };
  }
  const movementOf = (c) => normalizeMovement(c.movement);
  // Celle totali del turno (velocità × (1 + Scatti)) e residuo.
  const budget = (c, rules, feetPerCell) => speedCells(c, rules, feetPerCell) * (1 + movementOf(c).dashes);
  const left = (c, rules, feetPerCell) => Math.max(0, budget(c, rules, feetPerCell) - movementOf(c).used);

  // Inizio del turno: velocità piena, niente Scatto né Disimpegno. Modifica c.
  function resetTurn(c) {
    c.movement = normalizeMovement({ start: c.pos });
    return c;
  }
  // Spostamento registrato (per il residuo e per «Annulla spostamento»). Modifica c.
  function recordMove(c, to, cost) {
    const m = movementOf(c);
    if (c.pos) m.moves.push({ from: { x: c.pos.x, y: c.pos.y }, to: { x: to.x, y: to.y }, cost });
    if (m.moves.length > MAX_MOVES) m.moves.shift();
    m.used += cost;
    if (!m.start && c.pos) m.start = { x: c.pos.x, y: c.pos.y };
    c.movement = m;
    c.pos = { x: to.x, y: to.y };
    return c;
  }
  // Scatto: la velocità base si aggiunge al residuo (usa l'azione). Modifica c.
  function dash(c) {
    const m = movementOf(c);
    m.dashes += 1;
    c.movement = m;
    return c;
  }
  function disengage(c) {
    const m = movementOf(c);
    m.disengaged = true;
    c.movement = m;
    return c;
  }
  // Rialzarsi da prono: costa metà della velocità (per eccesso). { ok, cost, reason }. Modifica c se riesce.
  function standUp(c, rules, feetPerCell) {
    const conds = Array.isArray(c.conditions) ? c.conditions : [];
    if (!conds.includes('prono')) return { ok: false, reason: c.name + ' non è prono' };
    const full = cellsOf(feetIn(c, 'cammina'), feetPerCell);
    const st = speedState(c, rules, feetPerCell);
    if (st.zero || full <= 0) return { ok: false, reason: c.name + ' non può muoversi' };
    const cost = Math.ceil(full / 2);
    if (left(c, rules, feetPerCell) < cost) return { ok: false, reason: 'servono ' + cost + ' caselle di movimento, ne restano ' + left(c, rules, feetPerCell) };
    const m = movementOf(c);
    m.used += cost;
    m.stood = true;
    c.movement = m;
    c.conditions = conds.filter((x) => x !== 'prono');
    return { ok: true, cost };
  }
  // Annulla gli spostamenti del turno: torna alla posizione d'inizio e restituisce il movimento speso per
  // spostarsi (Scatto e Rialzarsi restano). { ok, refunded, to }. Modifica c se riesce.
  function undoMoves(c) {
    const m = movementOf(c);
    if (!m.moves.length) return { ok: false, refunded: 0 };
    const refunded = m.moves.reduce((s, x) => s + x.cost, 0);
    const to = m.moves[0].from;
    m.used = Math.max(0, m.used - refunded);
    m.moves = [];
    c.movement = m;
    c.pos = { x: to.x, y: to.y };
    return { ok: true, refunded, to };
  }

  // ---------- Distanze ----------
  // Distanza in caselle tra due celle con la regola delle diagonali.
  function distance(a, b, rules) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return normalizeRules(rules).diagonals === 'alternata' ? Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2) : Math.max(dx, dy);
  }

  // ---------- Percorso minimo ----------
  function heap() {
    const a = [];
    return {
      push(item, pr) {
        a.push([pr, item]);
        for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
      },
      pop() {
        const top = a[0];
        const last = a.pop();
        if (a.length) {
          a[0] = last;
          for (let i = 0; ;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let m = i;
            if (l < a.length && a[l][0] < a[m][0]) m = l;
            if (r < a.length && a[r][0] < a[m][0]) m = r;
            if (m === i) break;
            [a[m], a[i]] = [a[i], a[m]];
            i = m;
          }
        }
        return top;
      },
      size: () => a.length,
    };
  }

  // map: { w, h, blocked: Set, cost: Map } (ia.buildMap). state: { combatants, grid }. mover: con pos.
  // opts: { rules, extra, ignoreTerrain, maxCost, deadline, now, maxNodes, hostile(a, b) }. Di base extra e
  // terreno vengono dal combattente (strisciare, modalità senza velocità; volando il terreno difficile non conta).
  // Pedine ostili bloccano, le altre si attraversano ma non ci si ferma sopra.
  // Restituisce { dist: Map(chiave cella → costo minimo), path(chiave), canEnd(x, y), passable, aborted, start, dims }.
  function reach(map, state, mover, opts) {
    const o = opts || {};
    const rules = normalizeRules(o.rules);
    const fpc = state.grid && state.grid.feetPerCell;
    const st = speedState(mover, rules, fpc);
    const extra = o.extra === undefined ? st.extra : o.extra;
    const ignoreTerrain = o.ignoreTerrain === undefined ? st.mode === 'volare' : o.ignoreTerrain;
    const alt = rules.diagonals === 'alternata';
    const hostile = o.hostile || ((a, b) => DnD.fazioni.ostili(a, b, state.relations));
    const d = G().tokenDims(mover);
    const hostileCells = new Set();
    const otherCells = new Set();
    for (const t of state.combatants || []) {
      if (t.id === mover.id || !t.pos) continue;
      for (const k of G().tokenCells(t)) { otherCells.add(k); if (t.hp > 0 && hostile(mover, t)) hostileCells.add(k); }
    }
    const passable = (x, y) => {
      if (x < 0 || y < 0 || x + d.w > map.w || y + d.h > map.h) return false;
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) { const k = G().key(x + i, y + j); if (map.blocked.has(k) || hostileCells.has(k)) return false; }
      return true;
    };
    const canEnd = (x, y) => {
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) if (otherCells.has(G().key(x + i, y + j))) return false;
      return true;
    };
    const terrain = (x, y) => {
      if (ignoreTerrain) return 1;
      let c = 1;
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) c = Math.max(c, map.cost.get(G().key(x + i, y + j)) || 1);
      return c;
    };
    const start = G().key(mover.pos.x, mover.pos.y);
    // Stati: cella × parità delle diagonali (conta solo con la regola alternata).
    const s0 = start * 2;
    const distS = new Map([[s0, 0]]);
    // A parità di costo vince il percorso con meno diagonali (niente zig-zag): solo per scegliere, non nel costo.
    const tieS = new Map([[s0, 0]]);
    const prevS = new Map();
    const dist = new Map([[start, 0]]);
    const bestS = new Map([[start, s0]]);
    const q = heap();
    q.push(s0, 0);
    const maxNodes = o.maxNodes || (DnD.iaDati ? DnD.iaDati.PLANNER.maxNodes : 200000);
    let n = 0;
    let aborted = false;
    while (q.size()) {
      const [pr, s] = q.pop();
      const cost = distS.get(s);
      if (pr > cost + tieS.get(s) / 1e6 + 1e-9) continue;
      if (o.maxCost !== undefined && cost > o.maxCost) continue;
      if (++n > maxNodes || (n % 256 === 0 && o.deadline && o.now() > o.deadline)) { aborted = true; break; }
      const k = Math.floor(s / 2);
      const par = s % 2;
      const x = G().keyX(k);
      const y = G().keyY(k);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!passable(nx, ny)) continue;
          const diag = Boolean(dx && dy);
          if (diag && (!passable(x + dx, y) || !passable(x, y + dy))) continue; // niente angoli tagliati
          const units = diag && alt && par ? 2 : 1;
          const npar = diag && alt ? 1 - par : par;
          const nk = G().key(nx, ny);
          const ns = nk * 2 + npar;
          const nc = cost + units * (terrain(nx, ny) + extra);
          const nt = tieS.get(s) + (diag ? 1 : 0);
          const old = distS.has(ns) ? distS.get(ns) : Infinity;
          if (nc < old || (nc === old && nt < tieS.get(ns))) {
            distS.set(ns, nc);
            tieS.set(ns, nt);
            prevS.set(ns, s);
            q.push(ns, nc + nt / 1e6);
            const bk = bestS.get(nk);
            if (nc < (dist.has(nk) ? dist.get(nk) : Infinity) || (nc === dist.get(nk) && bk !== undefined && nt < tieS.get(bk))) { dist.set(nk, nc); bestS.set(nk, ns); }
          }
        }
      }
    }
    const path = (k) => {
      if (!bestS.has(k)) return [];
      const out = [];
      for (let s = bestS.get(k); s !== undefined; s = prevS.get(s)) {
        const c = Math.floor(s / 2);
        out.push({ x: G().keyX(c), y: G().keyY(c) });
        if (s === s0) break;
      }
      return out.reverse();
    };
    return { dist, path, canEnd, passable, aborted, start, dims: d };
  }

  // Percorso verso target (angolo in alto a sinistra) limitato al residuo: si ferma sull'ultima cella del
  // percorso dove si può stare entro il budget. { path, cost, end, full: costo dell'intero percorso | null, stopped }.
  function routeTo(P, target, limit) {
    const k = G().key(target.x, target.y);
    if (!P.dist.has(k)) return { path: [], cost: 0, end: null, full: null, stopped: false };
    const full = P.dist.get(k);
    const path = P.path(k);
    let best = 0;
    for (let i = 0; i < path.length; i++) {
      const c = P.dist.get(G().key(path[i].x, path[i].y));
      if (limit !== undefined && c > limit) break;
      if (i === 0 || P.canEnd(path[i].x, path[i].y)) best = i;
    }
    const kept = path.slice(0, best + 1);
    const end = kept[kept.length - 1];
    return { path: kept, cost: P.dist.get(G().key(end.x, end.y)), end, full, stopped: kept.length < path.length };
  }

  // Celle raggiungibili (dove ci si può fermare) entro limit e entro limitDash. { normal: Set, dash: Set } di chiavi.
  function reachable(P, limit, limitDash) {
    const normal = new Set();
    const dashed = new Set();
    for (const [k, cost] of P.dist) {
      if (k === P.start) continue;
      if (!P.canEnd(G().keyX(k), G().keyY(k))) continue;
      if (cost <= limit) normal.add(k);
      else if (limitDash !== undefined && cost <= limitDash) dashed.add(k);
    }
    return { normal, dash: dashed };
  }

  // Riga del log per uno spostamento.
  function moveText(c, cells, cost, leftAfter, feetPerCell) {
    const n = cells + (cells === 1 ? ' casella' : ' caselle');
    return c.name + ' si muove di ' + n + (cost !== cells ? ' (costo ' + cost + ')' : '') + ', ' +
      (leftAfter === Infinity ? 'movimento libero.' : 'restano ' + leftAfter + (leftAfter === 1 ? ' casella' : ' caselle') + ' (' + leftAfter * (feetPerCell || 5) + ' ft).');
  }

  DnD.movimento = {
    MODES, MODE_NAMES, MODE_ICONS, CREATURE_KEYS, STOP, DIAGONALS, DIAGONAL_NAMES, MISSING, MISSING_NAMES, DEFAULT_RULES, MAX_FEET,
    conditions, feetFromMeters, metersFromFeet, cellsOf, formatFeet, normalizeRules,
    normalizeSpeeds, speedsFromRace, speedsFromCreature, addFeet, baseSpeeds, normalizeOverride, modeOf, feetIn,
    speedState, speedCells, normalizeMovement, movementOf, budget, left, resetTurn, recordMove, dash, disengage, standUp, undoMoves,
    distance, reach, routeTo, reachable, moveText,
  };
})(globalThis.DnD = globalThis.DnD || {});
