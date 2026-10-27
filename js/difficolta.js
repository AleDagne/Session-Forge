// Difficoltà degli incontri (metodo della Guida del DM), solo logica: soglie di PE del party, PE grezzi dal grado
// di sfida, moltiplicatore per numero di creature (corretto per party piccoli e grandi), fasce, PE di ricompensa,
// chi conta (fazioni del Mondo), «Bilancia» e «Budget». Le tabelle sono in dati/difficolta.js; le regole della
// casa (tabelle personalizzate, soglie dei leggendari) stanno nello stato (difficultyRules).
(function (DnD) {
  'use strict';

  const K = () => DnD.difficoltaDati;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const int = (v, def, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const MAX_XP = 10000000;

  // ---------- Regole (tabelle personalizzate) ----------
  const row4 = (r, def) => { const a = arr(r); return [0, 1, 2, 3].map((i) => int(a[i], def ? def[i] : 0, 0, MAX_XP)); };
  const normalizeMultipliers = (list) => {
    const seen = new Set();
    const rows = arr(list).map((r) => ({ min: int(obj(r).min, 0, 1, 1000), factor: Number(obj(r).factor) }))
      .filter((r) => r.min && Number.isFinite(r.factor) && r.factor >= 0 && r.factor <= 100 && !seen.has(r.min) && seen.add(r.min))
      .sort((a, b) => a.min - b.min);
    if (!rows.length || rows[0].min !== 1) return clone(K().MULTIPLIERS);
    return rows.slice(0, 20);
  };
  const factorOf = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : def; };

  function defaultRules() {
    return { custom: false, thresholds: clone(K().THRESHOLDS), multipliers: clone(K().MULTIPLIERS), belowFirst: K().BELOW_FIRST, aboveLast: K().ABOVE_LAST,
      legendary: {}, countNeutralNpcs: false };
  }
  // custom: usa le tabelle scritte dal master; legendary: { livello 21-40: [facile, medio, difficile, mortale] } (sempre
  // valide, anche senza tabelle personalizzate); countNeutralNpcs: contano anche gli NPC neutrali che potrebbero diventare ostili.
  function normalizeRules(r) {
    r = obj(r);
    const legendary = {};
    for (const [k, v] of Object.entries(obj(r.legendary))) {
      const lv = int(k, 0, K().MAX_TABLE_LEVEL + 1, K().MAX_LEVEL);
      if (lv && Array.isArray(v)) legendary[lv] = row4(v);
    }
    return {
      custom: Boolean(r.custom),
      thresholds: K().THRESHOLDS.map((def, i) => row4(arr(r.thresholds)[i], def)),
      multipliers: normalizeMultipliers(r.multipliers),
      belowFirst: factorOf(r.belowFirst, K().BELOW_FIRST),
      aboveLast: factorOf(r.aboveLast, K().ABOVE_LAST),
      legendary,
      countNeutralNpcs: Boolean(r.countNeutralNpcs),
    };
  }
  // Tabelle in uso: quelle personalizzate se attive, altrimenti quelle della Guida (soglie dei leggendari e opzione NPC sempre dal master).
  // Il risultato è segnato (resolved) e si riusa così com'è nei calcoli ripetuti (Bilancia, Budget).
  function tables(rules) {
    if (rules && rules.resolved) return rules;
    const r = normalizeRules(rules);
    return Object.assign(r.custom ? r : Object.assign(defaultRules(), { legendary: r.legendary, countNeutralNpcs: r.countNeutralNpcs }), { resolved: true });
  }

  // ---------- Soglie ----------
  // Soglie di un personaggio: la riga del suo livello; oltre il 20 quelle scritte a mano o la riga del 20 (con avviso).
  function levelThresholds(level, rules) {
    const t = tables(rules);
    const lv = int(level, 1, 1, K().MAX_LEVEL);
    if (lv <= K().MAX_TABLE_LEVEL) return { level: lv, row: t.thresholds[lv - 1].slice(), legendary: null };
    if (t.legendary[lv]) return { level: lv, row: t.legendary[lv].slice(), legendary: 'manuale' };
    return { level: lv, row: t.thresholds[K().MAX_TABLE_LEVEL - 1].slice(), legendary: 'riga20' };
  }
  // Soglie del party: somma per colonna. legendary: 'riga20' se almeno uno usa la riga del 20, 'manuale' se tutti a mano.
  function partyThresholds(levels, rules) {
    const per = arr(levels).map((lv) => levelThresholds(lv, rules));
    const out = { size: per.length, legendary: null, perPlayer: per };
    K().THRESHOLD_BANDS.forEach((b, i) => { out[b] = per.reduce((s, p) => s + p.row[i], 0); });
    if (per.some((p) => p.legendary === 'riga20')) out.legendary = 'riga20';
    else if (per.some((p) => p.legendary === 'manuale')) out.legendary = 'manuale';
    return out;
  }

  // ---------- Grado di sfida ----------
  const CRS = () => DnD.creatureDati.CRS;
  const isCr = (v) => CRS().includes(String(v));
  // Nemico standard: CS stimato dal livello (livello / 2 per difetto, minimo 0).
  const standardCr = (level) => String(Math.max(0, Math.floor(int(level, 1, 1, 40) / K().STANDARD_CR_DIVISOR)));
  // CS di una scheda: creature dal Manuale; boss dal «CS effettivo» (vuoto = quello della scheda); nemici standard
  // (e schede standard degli NPC) dal campo CS, vuoto = stimato dal livello.
  function crOf(src) {
    if (!src) return '0';
    if (DnD.boss.isMonster(src)) return src.type === 'boss' && src.boss && isCr(src.boss.effectiveCr) ? String(src.boss.effectiveCr) : (isCr(src.cr) ? String(src.cr) : '0');
    return isCr(src.crOverride) ? String(src.crOverride) : standardCr(src.level);
  }
  const xpOf = (cr) => DnD.creature.xpForCr(cr);

  // ---------- Moltiplicatore e fasce ----------
  // Riga per numero di creature, poi un gradino su per i party piccoli e giù per i grandi (oltre la tabella:
  // belowFirst / aboveLast).
  function multiplier(count, partySize, rules) {
    const t = tables(rules);
    if (!(count > 0)) return { factor: 0, base: 0, shift: 0 };
    const rows = t.multipliers;
    let i = 0;
    rows.forEach((r, j) => { if (r.min <= count) i = j; });
    const shift = partySize > 0 && partySize < K().SMALL_PARTY ? 1 : partySize >= K().LARGE_PARTY ? -1 : 0;
    const j = i + shift;
    const factor = j < 0 ? t.belowFirst : j >= rows.length ? t.aboveLast : rows[j].factor;
    return { factor, base: rows[i].factor, shift };
  }
  // Fascia dei PE modificati: soglia inclusa (= facile è già Facile); «Oltre il mortale» solo sopra il doppio del mortale.
  function classify(xp, th) {
    if (xp > th.mortale * K().BEYOND_FACTOR) return 'oltre';
    for (const b of K().THRESHOLD_BANDS.slice().reverse()) if (xp >= th[b]) return b;
    return 'banale';
  }
  const bandIndex = (b) => K().BANDS.indexOf(b);
  const bandName = (b) => K().BAND_NAMES[b] || '—';

  // ---------- Valutazione ----------
  // input: { party: [{ id, name, level }], creatures: [{ id, name, cr, count, boss }] } (i gruppi con count 0 si ignorano).
  function evaluate(input, rules) {
    input = obj(input);
    rules = tables(rules);
    const party = arr(input.party);
    const groups = arr(input.creatures).map((g) => Object.assign({}, g, { cr: isCr(g.cr) ? String(g.cr) : '0', count: int(g.count, 0, 0, 1000) })).filter((g) => g.count > 0);
    const count = groups.reduce((s, g) => s + g.count, 0);
    const rawXp = groups.reduce((s, g) => s + xpOf(g.cr) * g.count, 0);
    const thresholds = partyThresholds(party.map((p) => p.level), rules);
    const mult = multiplier(count, party.length, rules);
    const adjustedXp = rawXp * mult.factor;
    const band = party.length && count ? classify(adjustedXp, thresholds) : null;
    const W = K().WARNINGS;
    const warnings = [];
    if (!party.length) warnings.push(W.noParty);
    if (!count) warnings.push(W.noCreatures);
    if (thresholds.legendary === 'riga20') warnings.push(W.legendary);
    else if (thresholds.legendary === 'manuale') warnings.push(W.legendaryManual);
    if (mult.shift > 0 && count) warnings.push(W.smallParty);
    if (mult.shift < 0 && count) warnings.push(W.largeParty);
    if (count === 1 && band && bandIndex(band) >= bandIndex('difficile')) warnings.push(W.single);
    if (groups.some((g) => g.boss)) warnings.push(W.boss);
    return {
      party: party.length, groups, count, rawXp, multiplier: mult.factor, multiplierBase: mult.base, shift: mult.shift, adjustedXp,
      thresholds, band, rewardXp: rawXp, perPlayerXp: party.length ? Math.floor(rawXp / party.length) : 0, warnings,
    };
  }

  const fmt = (n) => DnD.creature.formatXp(Math.round(n));
  const factorText = (f) => '×' + String(f).replace('.', ',');
  // Dettaglio del calcolo (tooltip e lettori di schermo).
  function detailText(res) {
    const parts = [];
    parts.push('PE grezzi: ' + (res.groups.length ? res.groups.map((g) => g.count + ' × ' + (g.name || 'creatura') + ' (CS ' + g.cr + ', ' + fmt(xpOf(g.cr)) + ')').join(' + ') + ' = ' : '') + fmt(res.rawXp));
    if (res.count) parts.push('Moltiplicatore ' + factorText(res.multiplier) + ' (' + res.count + (res.count === 1 ? ' creatura' : ' creature') + ', party di ' + res.party +
      (res.shift ? ', base ' + factorText(res.multiplierBase) + (res.shift > 0 ? ' un gradino su' : ' un gradino giù') : '') + ')');
    parts.push('PE modificati: ' + fmt(res.adjustedXp));
    const th = res.thresholds;
    if (res.party) parts.push('Soglie del party: ' + K().THRESHOLD_BANDS.map((b) => bandName(b).toLowerCase() + ' ' + fmt(th[b])).join(' · '));
    parts.push('Difficoltà: ' + (res.band ? bandName(res.band) : '—'));
    parts.push('Ricompensa: ' + fmt(res.rewardXp) + ' PE' + (res.party ? ' (' + fmt(res.perPlayerXp) + ' a testa)' : ''));
    return parts.join('\n');
  }

  // Barra a fasce: estremi delle fasce (in PE) e posizione del segnaposto (0-100). La scala arriva al doppio del
  // mortale (o ai PE modificati, se più alti).
  function scale(res) {
    const th = res.thresholds;
    const top = th.mortale * K().BEYOND_FACTOR;
    const max = Math.max(top, res.adjustedXp, 1);
    const edges = [0, th.facile, th.medio, th.difficile, th.mortale, top, max];
    const segments = K().BANDS.map((b, i) => ({ band: b, from: edges[i], to: edges[i + 1], width: ((edges[i + 1] - edges[i]) / max) * 100 })).filter((s) => s.to > s.from);
    return { max, segments, marker: Math.min(100, (res.adjustedXp / max) * 100) };
  }

  // ---------- Chi conta ----------
  // Conta nella difficoltà chi è ostile al party (relazione delle fazioni e ostilità personali). Gli NPC non ostili
  // (che potrebbero diventarlo se provocati) contano solo con l'opzione countNeutralNpcs, e mai se di una fazione
  // alleata o con atteggiamento amichevole. x: { id, faction, npc: { attitude, … }, hostileTo }.
  function counts(x, t, partyFaction, rules) {
    const F = DnD.fazioni;
    const probe = { id: '__party', faction: partyFaction || 'giocatori' };
    if (F.ostili(probe, x, t)) return true;
    if (!x.npc || !tables(rules).countNeutralNpcs) return false;
    return F.relazioneCombattenti(probe, x, t) !== 'alleata' && x.npc.attitude !== 'amichevole';
  }
  // Gruppo dalla scheda (nemico standard, creatura, boss, scheda di un NPC) e party dalle schede dei giocatori.
  const group = (src, count, extra) => Object.assign({ id: src.id, name: src.name, cr: crOf(src), count, boss: src.type === 'boss' }, extra);
  const partyFrom = (players) => arr(players).map((p) => ({ id: p.id, name: p.name, level: p.level }));

  // ---------- Bilancia e Budget ----------
  const withCount = (input, i, n) => Object.assign({}, input, { creatures: arr(input.creatures).map((g, j) => (j === i ? Object.assign({}, g, { count: n }) : g)) });
  // Per ogni tipo di creatura: il numero (0..max) più vicino a quello attuale che porta l'incontro alla fascia
  // scelta, cambiando solo quel tipo. to = null se non c'è; il master sceglie quale proposta applicare.
  // I gruppi fissi (fixed: NPC già piazzati, nemici già scelti nel generatore) contano ma non si propongono.
  function balance(input, target, rules, max) {
    const top = int(max, K().MAX_BALANCE, 1, 1000);
    rules = tables(rules);
    return arr(obj(input).creatures).map((g, i) => {
      if (g.fixed) return null;
      let best = null;
      for (let n = 0; n <= top; n++) {
        if (evaluate(withCount(input, i, n), rules).band !== target) continue;
        if (best === null || Math.abs(n - g.count) < Math.abs(best - g.count)) best = n;
      }
      return { index: i, id: g.id, name: g.name, from: g.count, to: best, result: best === null ? null : evaluate(withCount(input, i, best), rules) };
    }).filter(Boolean);
  }
  // Quante creature di un CS servono (minimo) per un incontro almeno Medio, Difficile e Mortale con il party.
  // { medio: { count, band } | null, … }: band è la fascia raggiunta (può essere più alta, se già una basta).
  function budget(cr, party, rules, max) {
    const top = int(max, K().MAX_BALANCE, 1, 1000);
    rules = tables(rules);
    const out = {};
    for (const target of ['medio', 'difficile', 'mortale']) {
      out[target] = null;
      for (let n = 1; n <= top; n++) {
        const r = evaluate({ party, creatures: [{ cr, count: n }] }, rules);
        if (r.band && bandIndex(r.band) >= bandIndex(target)) { out[target] = { count: n, band: r.band }; break; }
      }
    }
    return out;
  }

  DnD.difficolta = {
    defaultRules, normalizeRules, tables, levelThresholds, partyThresholds, standardCr, crOf, xpOf, multiplier, classify, bandIndex, bandName,
    evaluate, detailText, scale, counts, group, partyFrom, balance, budget, factorText,
  };
})(globalThis.DnD = globalThis.DnD || {});
