// Boss (logica pura): un boss è una creatura del Manuale dei Mostri (type 'boss', stessa scheda e stessi
// calcoli) con in più titolo, epiteto, introduzione, tema visivo, fasi a soglie di PF, aura e scala dei PF.
// Qui: temi, normalizzazione, promozione da creatura o nemico standard, calcolo delle fasi, azioni
// abilitate per fase, stato nel combattimento e barre visibili.
// Livello regole, gruppo entità. Espone DnD.boss; usa creature, regole, combattenti (statistiche dei boss Standard),
// dati/creature, dati/leggendario (palette «lg:<id>»), dadi. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  // Temi visivi: colore d'accento, ombra (vignettatura), cornice e motivo. Se ne aggiungono altri qui.
  const THEMES = {
    infernale: { name: 'Infernale', accent: '#e0322b', glow: '#ff5a3c', shadow: 'rgba(170, 16, 10, 0.55)', frame: '#7a1c16', bg: '#120607', motif: 'rune' },
    gelo: { name: 'Gelo', accent: '#6fc8ff', glow: '#bfe9ff', shadow: 'rgba(40, 120, 200, 0.5)', frame: '#2a5577', bg: '#060c14', motif: 'cristalli' },
    veleno: { name: 'Veleno', accent: '#6ccf3a', glow: '#b6ff6a', shadow: 'rgba(60, 150, 20, 0.5)', frame: '#2f5a18', bg: '#070c05', motif: 'spore' },
    arcano: { name: 'Arcano', accent: '#a46cff', glow: '#d6b8ff', shadow: 'rgba(110, 50, 210, 0.5)', frame: '#45297a', bg: '#0a0614', motif: 'cerchi' },
    ossa: { name: 'Ossa', accent: '#d8cfb4', glow: '#fff5d8', shadow: 'rgba(120, 110, 80, 0.5)', frame: '#5c5440', bg: '#0d0c09', motif: 'ossa' },
    sangue: { name: 'Sangue', accent: '#b3001b', glow: '#ff2a45', shadow: 'rgba(110, 0, 18, 0.65)', frame: '#4f0710', bg: '#0d0204', motif: 'gocce' },
    oscuro: { name: 'Oscuro', accent: '#6b5b95', glow: '#a99bd6', shadow: 'rgba(0, 0, 0, 0.8)', frame: '#26203a', bg: '#040306', motif: 'ombre' },
    divino: { name: 'Divino', accent: '#e8c35a', glow: '#fff3c4', shadow: 'rgba(220, 180, 70, 0.45)', frame: '#7a6224', bg: '#0f0c05', motif: 'raggi' },
  };
  const THEME_IDS = Object.keys(THEMES);
  // Tema per id: i temi del Boss o, con la chiave «lg:<id>», quelli dei leggendari (leggendario.js, PALETTES).
  const legendPalette = (id) => (typeof id === 'string' && id.startsWith('lg:') ? DnD.leggendarioDati.PALETTES[id.slice(3)] || null : null);
  const isTheme = (id) => THEME_IDS.includes(id) || Boolean(legendPalette(id));
  const theme = (id) => legendPalette(id) || THEMES[id] || THEMES.infernale;
  const EFFECTS = ['nessuno', 'lampo', 'tremolio'];
  const EFFECT_NAMES = { nessuno: 'Nessuno', lampo: 'Lampo', tremolio: 'Tremolio' };
  const TEMPERAMENTS = ['', 'aggressivo', 'furbo'];
  const MAX_PHASES = 6;
  const MAX_AURA = 10;
  const MAX_BARS = 3;

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const int = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : def; };
  const ids = (v) => [...new Set(arr(v).filter((x) => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)))].slice(0, 100);
  const uid = () => (DnD.dadi && DnD.dadi.uid ? DnD.dadi.uid() : Math.random().toString(36).slice(2));

  function normalizePhase(p, i) {
    p = obj(p);
    return {
      id: str(p.id, 64) || uid(),
      threshold: i === 0 ? 100 : int(p.threshold, 50, 1, 99),
      name: str(p.name, 60) || 'Fase ' + (i + 1),
      note: str(p.note, 1000),
      effect: EFFECTS.includes(p.effect) ? p.effect : (i === 0 ? 'nessuno' : 'lampo'),
      temperament: TEMPERAMENTS.includes(p.temperament) ? p.temperament : '',
      enable: ids(p.enable),
      disable: ids(p.disable),
    };
  }

  // Fasi ordinate per soglia decrescente; la prima è sempre al 100%. Soglie uguali: resta la prima.
  function normalizePhases(list) {
    const raw = arr(list).slice(0, MAX_PHASES).map(obj);
    const first = raw.find((p) => Number(p.threshold) >= 100) || raw[0] || {};
    const rest = raw.filter((p) => p !== first).sort((a, b) => Number(b.threshold) - Number(a.threshold));
    const out = [normalizePhase(first, 0)];
    for (const p of rest) {
      const n = normalizePhase(p, out.length);
      if (!out.some((x) => x.threshold === n.threshold)) out.push(n);
    }
    return out;
  }

  function normalizeBoss(b) {
    b = obj(b);
    return {
      title: str(b.title, 80),
      epithet: str(b.epithet, 60),
      intro: str(b.intro, 3000),
      theme: isTheme(b.theme) ? b.theme : 'infernale',
      phases: normalizePhases(b.phases),
      scaleByPlayers: Boolean(b.scaleByPlayers),
      aura: int(b.aura, 0, 0, MAX_AURA),
      // Difficoltà: grado di sfida effettivo (azioni leggendarie e fasi), vuoto = quello della scheda.
      effectiveCr: DnD.creatureDati.CRS.includes(String(b.effectiveCr)) ? String(b.effectiveCr) : '',
    };
  }

  const isBoss = (c) => Boolean(c && c.type === 'boss');
  // Creature del Manuale (anche i boss): stessa scheda e stessi calcoli.
  const isMonster = (c) => Boolean(c && (c.type === 'creatura' || c.type === 'boss'));

  // ---------- Promozione a boss ----------
  // Da una creatura: stessa scheda, tipo 'boss' e campi del boss di base.
  // Da un nemico standard: scheda del Manuale ricavata da caratteristiche finali, PF, CA, armi e livello.
  function promote(src, ctx) {
    ctx = ctx || {};
    const c = JSON.parse(JSON.stringify(src));
    const bossBase = normalizeBoss({ title: '', phases: [{ threshold: 100, name: 'Fase 1' }, { threshold: 50, name: 'Furia', effect: 'tremolio' }] });
    if (isMonster(c)) {
      return Object.assign(c, { id: uid(), type: 'boss', boss: c.boss ? normalizeBoss(c.boss) : bossBase, shared: false });
    }
    const R = DnD.regole;
    const race = ctx.race || null;
    const d = DnD.statistiche.derivedStats(c, race, ctx.catalog);
    const abilities = d.abilities || c.abilities;
    const level = c.level || 1;
    const crs = DnD.creatureDati.CRS;
    // Il CS scritto sulla scheda standard, se c'è; altrimenti il livello.
    const cr = crs.includes(String(c.crOverride)) ? String(c.crOverride)
      : crs.includes(String(Math.min(30, Math.max(1, Math.round(level))))) ? String(Math.min(30, Math.max(1, Math.round(level)))) : '1';
    // Armi risolte (catalogo compreso): bonus per colpire e danno diventano attacchi della scheda.
    const actions = arr(d.weapons).slice(0, 10).map((w) => {
      const entry = w.equipmentId ? arr(ctx.catalog).find((e) => e.id === w.equipmentId && e.weapon) : null;
      const ranged = Boolean(entry && entry.weapon && entry.weapon.kind === 'distanza');
      return {
        id: uid(), name: w.name || 'Arma', desc: '', customText: false, freq: { kind: 'volonta', uses: 1, recharge: 5 },
        mech: {
          kind: 'attacco', range: ranged ? 'distanza' : 'mischia', ability: ranged ? 'DES' : 'FOR', toHit: Number.isFinite(w.toHit) ? w.toHit : null,
          reach: 1.5, rangeNormal: ranged ? 24 : 0, rangeLong: ranged ? 96 : 0, targets: 'un bersaglio', magical: Boolean(w.magical),
          damages: [{ dice: w.damageDice || '1d6', bonus: Number.isFinite(w.damageBonus) ? w.damageBonus : 0, type: DnD.creature.damageTypeOf(w.damageType) || 'tagliente' }],
        },
      };
    });
    if (actions.length > 1) {
      actions.unshift({ id: uid(), name: 'Multiattacco', desc: '', customText: false, freq: { kind: 'volonta', uses: 1, recharge: 5 },
        mech: { kind: 'multiattacco', parts: actions.slice(0, 2).map((a) => ({ actionId: a.id, count: 1 })) } });
    }
    const monster = DnD.creature.normalizeMonster({
      size: (race && race.size) || 'Media', ctype: 'umanoide', alignment: '', ac: d.ac ? d.ac.total : c.ac,
      hitDice: Math.max(1, level), hpOverride: c.maxHp, abilities, saves: c.saves, cr,
      actions: actions.length ? actions : [{ name: 'Colpo', mech: { kind: 'attacco', damages: [{ dice: '1d6', type: 'contundente' }] } }],
      legendaryPoints: 3, legendaryResistance: 1,
    });
    return Object.assign(monster, {
      id: uid(), type: 'boss', name: c.name, icon: c.icon, gridSize: c.gridSize, behavior: c.behavior, notes: c.notes || '',
      sessionId: c.sessionId, shared: false, boss: bossBase,
    });
  }

  // ---------- Fasi ----------
  const pctOf = (hp, maxHp) => (maxHp > 0 ? (Math.max(0, hp) / maxHp) * 100 : 0);

  // Fase indicata dai PF: la più avanzata la cui soglia è stata superata verso il basso (PF% < soglia);
  // la prima fase (100%) vale finché non si scende sotto la seconda soglia.
  function phaseForHp(phases, hp, maxHp) {
    const pct = pctOf(hp, maxHp);
    let idx = 0;
    for (let i = 1; i < phases.length; i++) if (pct < phases[i].threshold) idx = i;
    return idx;
  }

  // Aggiorna la fase di un boss nel combattimento. Le fasi non tornano indietro: curandosi sopra una soglia il
  // boss resta nella fase raggiunta (e gli effetti non si ripetono). Restituisce { from, to, crossed: [indici] }
  // con tutte le fasi attraversate da un solo colpo, oppure null se nulla cambia. Modifica state.
  function updatePhase(state, hp, maxHp) {
    const target = phaseForHp(state.phases, hp, maxHp);
    if (target <= state.phase) return null;
    const from = state.phase;
    const crossed = [];
    for (let i = from + 1; i <= target; i++) crossed.push(i);
    state.phase = target;
    return { from, to: target, crossed };
  }

  // Azioni disabilitate alla fase idx: quelle che una fase successiva "abilita" partono disabilitate; poi
  // per ogni fase raggiunta si applicano disabilita e abilita, in ordine.
  function disabledActions(state, idx) {
    const off = new Set();
    state.phases.forEach((p, i) => { if (i > 0) p.enable.forEach((a) => off.add(a)); });
    for (let i = 0; i <= Math.min(idx, state.phases.length - 1); i++) {
      state.phases[i].disable.forEach((a) => off.add(a));
      state.phases[i].enable.forEach((a) => off.delete(a));
    }
    return off;
  }

  // Temperamento della fase (l'ultimo impostato fino a idx), null = quello della scheda.
  function temperamentAt(state, idx) {
    let t = null;
    for (let i = 0; i <= Math.min(idx, state.phases.length - 1); i++) if (state.phases[i].temperament) t = state.phases[i].temperament;
    return t;
  }

  // Intensità della vignettatura: 0 senza boss vivi, poi cresce con la fase più avanzata (0.35 → 1).
  function vignetteLevel(combatants) {
    const alive = combatants.filter((x) => x.boss && x.hp > 0);
    if (!alive.length) return 0;
    const k = Math.max(...alive.map((x) => (x.boss.phases.length > 1 ? x.boss.phase / (x.boss.phases.length - 1) : 0)));
    return Math.round((0.35 + 0.65 * k) * 100) / 100;
  }

  // ---------- Combattimento ----------
  // PF del boss con la scala per numero di giocatori (se attiva).
  const scaledHp = (base, players, on) => (on ? base * Math.max(1, players || 1) : base);

  // Stato del boss nel combattimento (dentro il combattente).
  function combatState(npc) {
    const b = normalizeBoss(npc.boss);
    return Object.assign(b, { phase: 0, revealed: false, defeated: false, sourceName: npc.name });
  }

  function normalizeCombatBoss(st) {
    if (!st || typeof st !== 'object') return null;
    const b = normalizeBoss(st);
    return Object.assign(b, {
      phase: int(st.phase, 0, 0, b.phases.length - 1),
      revealed: Boolean(st.revealed),
      defeated: Boolean(st.defeated),
      sourceName: str(st.sourceName, 60),
    });
  }

  // Controlla tutti i boss del combattimento dopo un'azione: passaggi di fase e sconfitte. Modifica c; le
  // righe del log vanno a logFn(tipo, testo). Restituisce gli eventi per gli effetti visivi:
  // [{ kind: 'fase', id, name, phase, phaseName, effect, theme } | { kind: 'sconfitto', id, name, theme }].
  function checkCombat(c, logFn) {
    const events = [];
    for (const x of c.combatants) {
      const b = x.boss;
      if (!b) continue;
      if (x.hp <= 0) {
        if (!b.defeated) {
          b.defeated = true;
          logFn('sistema', '👑 ' + x.name + (b.title ? ', ' + b.title + ',' : '') + ' è sconfitto!');
          events.push({ kind: 'sconfitto', id: x.id, name: x.name, theme: b.theme });
        }
        continue;
      }
      if (b.defeated) b.defeated = false;
      const ch = updatePhase(b, x.hp, x.maxHp);
      if (!ch) continue;
      for (const i of ch.crossed) {
        const p = b.phases[i];
        logFn('sistema', '👑 ' + x.name + ' entra nella FASE ' + (i + 1) + ' — ' + p.name + ' (sotto il ' + p.threshold + '% dei PF).' + (p.note ? ' Nota del master: ' + p.note : ''));
      }
      const t = temperamentAt(b, b.phase);
      if (t && x.behavior && x.behavior.temperament !== t) {
        x.behavior.temperament = t;
        logFn('sistema', '👑 ' + x.name + ' ora è ' + (t === 'furbo' ? 'Furbo' : 'Aggressivo') + '.');
      }
      const last = b.phases[ch.to];
      events.push({ kind: 'fase', id: x.id, name: x.name, phase: ch.to, phaseName: last.name, effect: last.effect, theme: b.theme, crossed: ch.crossed });
    }
    return events;
  }

  // Barre da mostrare in alto: boss vivi (o appena sconfitti) visibili per chi guarda. viewer: 'master' (tutti)
  // o 'giocatori' (solo quelli rivelati). Le prime MAX_BARS sono visibili, le altre vanno nel menu.
  function bars(combatants, viewer) {
    const list = combatants.filter((x) => x.boss && (viewer !== 'giocatori' || x.boss.revealed));
    return { shown: list.slice(0, MAX_BARS), more: list.slice(MAX_BARS) };
  }

  DnD.boss = {
    THEMES, THEME_IDS, theme, isTheme, EFFECTS, EFFECT_NAMES, TEMPERAMENTS, MAX_PHASES, MAX_AURA, MAX_BARS,
    normalizeBoss, normalizePhases, isBoss, isMonster, promote,
    pctOf, phaseForHp, updatePhase, disabledActions, temperamentAt, vignetteLevel,
    scaledHp, combatState, normalizeCombatBoss, checkCombat, bars,
  };
})(globalThis.DnD = globalThis.DnD || {});
