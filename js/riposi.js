// Riposi e risorse (logica pura). Una risorsa ha etichetta, valore, massimo e regola di ripristino (riposo breve,
// lungo, all'alba, mai, manuale). Le risorse di un personaggio vengono da ciò che esiste già: dadi vita, slot,
// usi delle trasformazioni e delle magie «N al giorno» dei leggendari, usi e ricariche delle azioni delle creature,
// azioni e Resistenza leggendarie, PF temporanei, sfinimento, più quelle personalizzate. Un «soggetto» (accessori
// su una scheda di giocatore, eventualmente con lo stato dell'esplorazione, o su un combattente) le rende uniformi:
// riposo breve (dadi vita + mod. COS), riposo lungo, ripristino completo e alba lavorano solo sul soggetto.
(function (DnD) {
  'use strict';

  const K = () => DnD.riposiDati;
  const C = () => DnD.condizioni;
  const R = () => DnD.regole;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const int = (v, def, lo, hi) => { const n = Math.round(Number(v)); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const ID = /^[\w-]{1,64}$/;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- Stato persistente sulla scheda ----------
  function normalizeResource(r) {
    r = obj(r);
    const max = int(r.max, 1, 0, 999);
    return { id: typeof r.id === 'string' && ID.test(r.id) ? r.id : 'ris-' + DnD.dadi.uid(), label: str(r.label, 40) || 'Risorsa', max,
      value: int(r.value, max, 0, max), reset: K().RESETS.includes(r.reset) ? r.reset : 'lungo' };
  }
  // status: PF attuali (null = al massimo), PF temporanei, dadi vita spesi, sfinimento, ultimo riposo lungo (ore di
  // gioco, null = mai), risorse personalizzate.
  function normalizeStatus(s) {
    s = obj(s);
    return {
      hp: s.hp === null || s.hp === undefined ? null : int(s.hp, null, 0, 99999),
      tempHp: int(s.tempHp, 0, 0, 9999),
      hitDiceUsed: int(s.hitDiceUsed, 0, 0, 100),
      exhaustion: int(s.exhaustion, 0, 0, 6),
      lastLongRest: s.lastLongRest === null || s.lastLongRest === undefined ? null : int(s.lastLongRest, null, -1e9, 1e9),
      resources: arr(s.resources).slice(0, K().MAX_CUSTOM).map(normalizeResource),
    };
  }

  // ---------- Soggetti ----------
  const entry = (id, label, value, max, reset, set, extra) => Object.assign({ id, label, value, max, reset, set }, extra || {});
  const slotEntries = (total, used, pact, setUsed) => total.map((n, i) => n > 0
    ? entry('slot-' + (i + 1), 'Slot ' + (i + 1) + '° livello' + (pact ? ' (patto)' : ''), Math.max(0, n - used[i]), n, pact ? 'breve' : 'lungo', (v) => setUsed(i, n - clamp(v, 0, n)), { kind: 'slot' })
    : null).filter(Boolean);
  const customEntries = (list) => list.map((r) => entry('cust-' + r.id, r.label, r.value, r.max, r.reset, (v) => { r.value = clamp(v, 0, r.max); }, { kind: 'personalizzata', resource: r }));

  // Scheda di un giocatore (st: archivio per razza, incantesimi e attrezzatura; member: stato dell'esplorazione
  // facoltativo, che contiene PF e sfinimento correnti). Modifica la scheda (e member).
  function fromSheet(p, st, member) {
    const S = st || {};
    p.status = normalizeStatus(p.status);
    const status = p.status;
    const legendary = p.type === 'leggendario';
    const eff = legendary && DnD.leggendario ? DnD.leggendario.effectivePlayer(p, S) : p;
    const race = arr(S.races).find((r) => r.id === p.raceId) || null;
    const stats = R().derivedStats(eff, race, S.equipment);
    const info = DnD.classi.classInfo(p.classId, p.customClass);
    const maxHp = member ? member.maxHp : eff.maxHp;
    const sp = stats.spell;
    const out = {
      kind: 'scheda', name: p.name, source: p,
      maxHp,
      getHp: () => (member ? member.hp : status.hp === null ? maxHp : Math.min(status.hp, maxHp)),
      setHp: (v) => { const n = clamp(Math.round(v), 0, maxHp); if (member) member.hp = n; status.hp = n >= maxHp ? null : n; },
      getTemp: () => status.tempHp,
      setTemp: (v) => { status.tempHp = clamp(Math.round(v), 0, 9999); },
      conMod: R().modifier(stats.abilities.COS),
      hd: { die: (info && info.hitDie) || 8, total: Math.max(1, p.level || 1), get used() { return Math.min(status.hitDiceUsed, this.total); }, set used(v) { status.hitDiceUsed = clamp(v, 0, this.total); } },
      getExhaustion: () => (member ? member.exhaustion : status.exhaustion),
      setExhaustion: (v) => { const n = clamp(v, 0, 6); status.exhaustion = n; if (member) member.exhaustion = n; },
      lastLongRest: () => status.lastLongRest,
      markLongRest: (t) => { status.lastLongRest = t; },
      extra: () => {
        const list = sp && p.spellcasting ? slotEntries(sp.slotsTotal, p.spellcasting.slotsUsed, sp.caster === 'patto', (i, n) => { p.spellcasting.slotsUsed[i] = n; }) : [];
        if (legendary && p.legend) {
          for (const t of p.legend.transformations || []) {
            list.push(entry('trasf-' + t.id, '🜂 ' + t.name, DnD.leggendario.usesLeft(p, t), t.uses.n, t.uses.per === 'breve' ? 'breve' : 'lungo', (v) => { p.legend.uses[t.id] = clamp(v, 0, t.uses.n); }));
          }
          for (const d of DnD.leggendario.dailySpells(p, S).daily) {
            const spell = arr(S.spells).find((x) => x.id === d.spellId);
            list.push(entry('magia-' + d.spellId, '✨ ' + (spell ? spell.name : 'Magia') + ' (al giorno)', d.left, d.n, 'lungo', (v) => { p.legend.spellUses[d.spellId] = d.n - clamp(v, 0, d.n); }));
          }
        }
        return list.concat(customEntries(status.resources));
      },
    };
    return out;
  }

  // Combattente (giocatore, nemico, creatura, boss, NPC). Modifica il combattente.
  function fromCombatant(c) {
    c.hitDice = normalizeHitDice(c.hitDice, c);
    c.resources = arr(c.resources).map(normalizeResource);
    const st = c.creature;
    const out = {
      kind: 'combattente', name: c.name, source: c,
      maxHp: c.maxHp,
      getHp: () => c.hp,
      setHp: (v) => { c.hp = clamp(Math.round(v), 0, c.maxHp); },
      getTemp: () => c.tempHp || 0,
      setTemp: (v) => { c.tempHp = clamp(Math.round(v), 0, 9999); },
      conMod: R().modifier((c.abilities && c.abilities.COS) || 10),
      hd: { die: c.hitDice.die, total: c.hitDice.total, get used() { return c.hitDice.used; }, set used(v) { c.hitDice.used = clamp(v, 0, c.hitDice.total); } },
      getExhaustion: () => C().exhaustion(c),
      setExhaustion: (v) => { const n = clamp(v, 0, 6); if (!n) C().remove(c, 'sfinimento'); else C().apply(c, { type: 'sfinimento', level: n, source: { name: 'riposo' } }); },
      lastLongRest: () => (c.lastLongRest === undefined ? null : c.lastLongRest),
      markLongRest: (t) => { c.lastLongRest = t; },
      extra: () => {
        const sc = c.spellcasting;
        const list = sc ? slotEntries(sc.slotsTotal, sc.slotsUsed, sc.pact, (i, n) => { sc.slotsUsed[i] = n; }) : [];
        if (st) {
          for (const a of DnD.creature.allActions(st)) {
            const f = a.freq.kind;
            if (st.uses[a.id] !== undefined) {
              const max = f === 'giorno' ? a.freq.uses : 1;
              list.push(entry('uso-' + a.id, a.name + (f === 'giorno' ? ' (al giorno)' : f === 'riposo-breve' ? ' (riposo breve)' : ' (riposo lungo)'), st.uses[a.id], max,
                f === 'riposo-breve' ? 'breve' : f === 'giorno' ? 'alba' : 'lungo', (v) => { st.uses[a.id] = clamp(v, 0, max); }));
            }
            if (f === 'ricarica') list.push(entry('ricarica-' + a.id, a.name + ' (ricarica ' + a.freq.recharge + '-6)', st.recharge[a.id] ? 1 : 0, 1, 'breve', (v) => { st.recharge[a.id] = v > 0; }));
          }
          if (st.legendaryPoints.max) list.push(entry('leggendarie', 'Azioni leggendarie', st.legendaryPoints.left, st.legendaryPoints.max, 'breve', (v) => { st.legendaryPoints.left = clamp(v, 0, st.legendaryPoints.max); }));
          if (st.legendaryResistance.max) list.push(entry('resistenza', 'Resistenza leggendaria', st.legendaryResistance.left, st.legendaryResistance.max, 'lungo', (v) => { st.legendaryResistance.left = clamp(v, 0, st.legendaryResistance.max); }));
        }
        if (c.concentration) list.push(entry('concentrazione', '◎ Concentrazione: ' + c.concentration.name, 1, 1, 'manuale', null, { readonly: true }));
        return list.concat(customEntries(c.resources));
      },
      // Riposo lungo del combattente: tiri contro la morte azzerati e fine delle condizioni «fino al riposo».
      afterLong: () => { c.deathSaves = C().normalizeDeathSaves({}); c.dead = c.dead && c.hp <= 0; C().rest(c, false); },
    };
    return out;
  }
  // Dadi vita del combattente: dalla classe e dal livello (giocatori e nemici standard) o dalla scheda (creature).
  function normalizeHitDice(h, c) {
    h = obj(h);
    const auto = hitDiceOf(c || {});
    const total = int(h.total, auto.total, 1, 100);
    return { die: [4, 6, 8, 10, 12, 20].includes(h.die) ? h.die : auto.die, total, used: int(h.used, 0, 0, total) };
  }
  // Ripiego per i combattimenti salvati prima dei dadi vita (seedCombatant li dà ai combattenti nuovi).
  function hitDiceOf(c) {
    if (c.creature && c.creature.size) return { die: DnD.creature.hitDieFor(c.creature.size), total: Math.max(1, c.level || 1) };
    const info = DnD.classi.classInfo(c.classId, c.customClass);
    return { die: (info && info.hitDie) || 8, total: Math.max(1, c.level || 1) };
  }

  // ---------- Risorse ----------
  // Elenco unico: dadi vita, PF temporanei, sfinimento, poi slot, usi, ricariche e personalizzate.
  function resources(s) {
    const hd = s.hd;
    return [
      entry('dadi-vita', 'Dadi vita (d' + hd.die + ')', hd.total - hd.used, hd.total, 'lungo', (v) => { hd.used = hd.total - clamp(v, 0, hd.total); }, { kind: 'dadi-vita' }),
      entry('pf-temp', 'PF temporanei', s.getTemp(), null, 'lungo', (v) => s.setTemp(v), { kind: 'pf-temp' }),
      entry('sfinimento', 'Sfinimento', s.getExhaustion(), 6, 'lungo', (v) => s.setExhaustion(v), { kind: 'sfinimento' }),
    ].concat(s.extra());
  }
  // − / + su una risorsa. Restituisce il nuovo valore (o null se non esiste o è di sola lettura).
  function adjust(s, id, delta) {
    const r = resources(s).find((x) => x.id === id);
    if (!r || !r.set) return null;
    const v = r.max === null ? Math.max(0, r.value + delta) : clamp(r.value + delta, 0, r.max);
    r.set(v);
    return v;
  }
  // Ripristina al massimo le risorse con le regole indicate (non dadi vita, PF temporanei e sfinimento, che hanno
  // regole proprie). Restituisce le etichette ripristinate.
  function restoreBy(s, resets) {
    const out = [];
    for (const r of s.extra()) {
      if (!r.set || r.readonly || !resets.includes(r.reset) || r.value >= r.max) continue;
      r.set(r.max);
      out.push(r.kind === 'slot' ? r.label.toLowerCase() : r.label);
    }
    return out;
  }

  // ---------- Opzioni del master ----------
  // { heroic, shortHours, longHours } dalle impostazioni (eroico: tutti i dadi vita; gritty: 8 ore / 7 giorni).
  function options(raw) {
    const o = obj(raw);
    return { heroic: Boolean(o.heroic), shortHours: o.gritty8 ? K().GRITTY.breve : K().HOURS.breve, longHours: o.gritty7 ? K().GRITTY.lungo : K().HOURS.lungo };
  }
  const hoursOf = (kind, opts) => (kind === 'lungo' ? options(opts).longHours : options(opts).shortHours);
  // Regola delle 24 ore: { ok, wait (ore che mancano) }.
  function canLongRest(s, now) {
    const last = s.lastLongRest();
    if (last === null || now === null || now === undefined) return { ok: true, wait: 0 };
    const wait = Math.max(0, K().LONG_EVERY - (now - last));
    return { ok: wait <= 0, wait: Math.ceil(wait) };
  }

  // ---------- Riposo breve ----------
  // Tira in anticipo i dadi vita (per l'anteprima, modificabili a mano): [valori].
  const rollHitDice = (s, n, rng) => Array.from({ length: clamp(n, 0, s.hd.total - s.hd.used) }, () => rng(s.hd.die));
  // Cura di un dado vita: dado + mod. COS (minimo 0).
  const healOf = (s, roll) => Math.max(0, roll + s.conMod);
  // p: { rolls: [valori dei dadi vita spesi] }. Restituisce il riepilogo. Modifica il soggetto.
  function shortRest(s, p) {
    const rolls = arr(p && p.rolls).slice(0, s.hd.total - s.hd.used).map((v) => clamp(int(v, 1, 1, s.hd.die), 1, s.hd.die));
    const before = s.getHp();
    let gained = 0;
    for (const r of rolls) gained += healOf(s, r);
    s.setHp(before + gained);
    s.hd.used += rolls.length;
    const restored = restoreBy(s, ['breve']);
    return { kind: 'breve', name: s.name, healed: s.getHp() - before, spent: rolls.length, rolls, restored };
  }

  // ---------- Riposo lungo ----------
  // p: { opts (varianti), interruptedAfter (ore, se interrotto), suppliesOk (false = niente cibo o acqua: niente
  // recupero dello sfinimento) }. Restituisce il riepilogo. Modifica il soggetto.
  function longRest(s, p) {
    const o = obj(p);
    if (o.interruptedAfter !== undefined && o.interruptedAfter !== null) {
      // Interrotto: nessun beneficio del riposo lungo; con almeno 1 ora valgono quelli del riposo breve.
      const short = o.interruptedAfter >= K().INTERRUPT_SHORT ? restoreBy(s, ['breve']) : [];
      return { kind: 'lungo', name: s.name, interrupted: true, hours: o.interruptedAfter, healed: 0, regained: 0, restored: short, exhaustion: 0 };
    }
    const before = s.getHp();
    s.setHp(s.maxHp);
    s.setTemp(0);
    const hd = s.hd;
    const usedBefore = hd.used;
    hd.used -= options(o.opts).heroic ? hd.total : Math.max(1, Math.floor(hd.total / 2));
    const restored = restoreBy(s, ['breve', 'lungo', 'alba']);
    const ex = s.getExhaustion();
    const exDelta = ex > 0 && o.suppliesOk !== false ? -1 : 0;
    if (exDelta) s.setExhaustion(ex - 1);
    if (s.afterLong) s.afterLong();
    return { kind: 'lungo', name: s.name, healed: s.getHp() - before, regained: usedBefore - hd.used, restored, exhaustion: exDelta, slotsAll: restored.some((x) => x.startsWith('slot')) };
  }

  // All'alba: le risorse «all'alba» tornano al massimo.
  const dawn = (s) => restoreBy(s, ['alba']);

  // Ripristina tutto (master: test e preparazione).
  function restoreAll(s) {
    s.setHp(s.maxHp);
    s.setTemp(0);
    s.hd.used = 0;
    s.setExhaustion(0);
    for (const r of s.extra()) if (r.set && !r.readonly) r.set(r.max);
    if (s.afterLong) s.afterLong();
    return { kind: 'tutto', name: s.name };
  }

  // Riga del log: «Riposo lungo: Mira recupera 18 PF, 2 dadi vita, tutti gli slot».
  function summaryText(r) {
    if (r.kind === 'tutto') return '⟲ ' + r.name + ': tutto ripristinato (master).';
    if (r.interrupted) return '🛏 Riposo lungo interrotto dopo ' + r.hours + (r.hours === 1 ? ' ora' : ' ore') + ': ' + r.name + ' non ne riceve i benefici' + (r.restored.length ? ' (valgono quelli del riposo breve: ' + r.restored.join(', ') + ')' : '') + '.';
    const parts = [];
    if (r.kind === 'breve') {
      parts.push('recupera ' + r.healed + ' PF');
      if (r.spent) parts.push('spende ' + r.spent + (r.spent === 1 ? ' dado vita' : ' dadi vita') + ' [' + r.rolls.join(', ') + ']');
    } else {
      parts.push('recupera ' + r.healed + ' PF');
      if (r.regained) parts.push(r.regained + (r.regained === 1 ? ' dado vita' : ' dadi vita'));
    }
    const slots = r.restored.filter((x) => x.startsWith('slot'));
    const others = r.restored.filter((x) => !x.startsWith('slot'));
    if (slots.length) parts.push(r.kind === 'lungo' ? 'tutti gli slot' : slots.join(', '));
    if (others.length) parts.push(others.join(', '));
    if (r.exhaustion) parts.push('sfinimento ' + r.exhaustion);
    return '🛏 Riposo ' + r.kind + ': ' + r.name + ' ' + parts.join(', ') + '.';
  }

  // ---------- Combattimento ----------
  // Nuovo combattente da una scheda: PF attuali, PF temporanei, dadi vita, sfinimento e risorse della scheda (i
  // giocatori); dadi vita dalla scheda della creatura. Modifica il combattente.
  function seedCombatant(x, source) {
    const s = source && source.status ? normalizeStatus(source.status) : null;
    const monster = Boolean(source && DnD.boss.isMonster(source));
    const info = monster ? null : DnD.classi.classInfo(source.classId, source.customClass);
    const total = Math.max(1, monster ? source.hitDice : source.level || 1);
    x.hitDice = { die: monster ? DnD.creature.hitDieFor(source.size) : (info && info.hitDie) || 8, total, used: s ? Math.min(s.hitDiceUsed, total) : 0 };
    x.tempHp = s ? s.tempHp : 0;
    x.resources = s ? JSON.parse(JSON.stringify(s.resources)) : [];
    if (s && x.kind === 'player') {
      if (s.hp !== null) x.hp = Math.min(x.maxHp, s.hp);
      if (s.exhaustion) C().apply(x, { type: 'sfinimento', level: s.exhaustion, source: { name: 'scheda' } });
      x.lastLongRest = s.lastLongRest;
    }
    return x;
  }
  // Fine del combattimento: lo stato del giocatore torna sulla scheda. Modifica la scheda.
  function syncBack(x, p) {
    p.status = normalizeStatus(p.status);
    // Leggendario ancora trasformato: valgono i PF del personaggio (quelli della forma restano nel combattimento).
    const prev = x.legend && x.legend.form && x.legend.form.prev ? x.legend.form.prev : null;
    const hp = prev ? prev.hp : x.hp;
    const maxHp = prev ? prev.maxHp : x.maxHp;
    Object.assign(p.status, {
      hp: hp >= maxHp ? null : Math.max(0, hp), tempHp: x.tempHp || 0, hitDiceUsed: x.hitDice ? x.hitDice.used : p.status.hitDiceUsed,
      exhaustion: C().exhaustion(x), resources: arr(x.resources).map(normalizeResource),
    });
    if (x.lastLongRest !== undefined) p.status.lastLongRest = x.lastLongRest;
    return p;
  }
  // PF temporanei: assorbono il danno per primi. Restituisce il danno che resta. Modifica il combattente.
  function absorbTemp(x, amount) {
    const t = Math.min(x.tempHp || 0, Math.max(0, amount));
    if (t) x.tempHp -= t;
    return { rest: Math.max(0, amount - t), absorbed: t };
  }

  DnD.riposi = {
    normalizeResource, normalizeStatus, normalizeHitDice, fromSheet, fromCombatant, resources, adjust, restoreBy, options, hoursOf, canLongRest,
    rollHitDice, healOf, shortRest, longRest, dawn, restoreAll, summaryText, seedCombatant, syncBack, absorbTemp,
  };
})(globalThis.DnD = globalThis.DnD || {});
