// Personaggio leggendario (logica pura): giocatore di livello 20-40 (rango leggendario = livello - 20) con
// Percorso leggendario (percorso.js) e Trasformazioni in forme da boss. Qui: normalizzazione, punti, effetti dei
// nodi sbloccati applicati ai calcoli della scheda e del combattimento (con il dettaglio «da: nodo»), privilegi
// creati dall'utente come azioni a pulsanti, trasformazioni (regole di fusione, PF che passano al personaggio
// con il danno in eccesso, usi e durata, fine anticipata), promozione e declassamento.
// Livello regole, gruppo entità (sopra scheda e percorso). Espone DnD.leggendario; usa statistiche, scheda, percorso,
// creature, boss, magie, movimento, griglia, classi, regole, dati/leggendario, dadi, icone. Non deve toccare il DOM.
// Le forme normalizzano la creatura con modello.normalizzaCreatura.
(function (DnD) {
  'use strict';

  const MIN_LEVEL = 20;
  const MAX_LEVEL = 40;
  // Temi e palette: dati in dati/leggendario.js (li legge anche boss.js per i temi «lg:<id>»).
  const { THEMES, THEME_NAMES, PALETTES } = DnD.leggendarioDati;
  // Chiave di tema per l'interfaccia: i temi leggendari diventano «lg:<id>», quelli del Boss restano come sono.
  const themeKey = (id) => (THEMES.includes(id) ? 'lg:' + id : id);
  // Tema della forma: quello scelto nella trasformazione o, se vuoto, quello del personaggio.
  const formTheme = (t, legendTheme) => (t && t.theme ? themeKey(t.theme) : 'lg:' + (THEMES.includes(legendTheme) ? legendTheme : 'divino'));
  const PHYSICAL = ['FOR', 'DES', 'COS'];

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => DnD.dadi.uid();
  const P = () => DnD.percorso;
  const R = () => DnD.regole;
  const AB = () => DnD.regole.ABILITIES;

  // ---------- Trasformazioni ----------
  function normalizeTransformation(t) {
    t = obj(t);
    const f = obj(t.fusion);
    const u = obj(t.uses);
    const d = obj(t.duration);
    const c = obj(t.creature);
    const creature = DnD.modello.normalizzaCreatura(Object.assign({ name: t.name || 'Forma' }, c, { type: 'boss', boss: c.boss || { theme: 'infernale' } }), false);
    delete creature.sessionId;
    delete creature.shared;
    return {
      id: str(t.id, 64) || uid(),
      name: str(t.name, 60) || 'Forma leggendaria',
      epithet: str(t.epithet, 60),
      creature,
      fusion: {
        physicalFromForm: f.physicalFromForm !== false, keepProficiency: f.keepProficiency !== false, keepSpells: Boolean(f.keepSpells),
        keepEquipment: Boolean(f.keepEquipment), keepFeatures: f.keepFeatures !== false,
      },
      hpMode: t.hpMode === 'temporanei' ? 'temporanei' : 'sostituisce',
      uses: { per: u.per === 'breve' ? 'breve' : 'lungo', n: int(u.n, 1, 1, 10) },
      duration: { unit: d.unit === 'minuti' ? 'minuti' : 'round', value: int(d.value, 10, 1, 1000) },
      activation: t.activation === 'bonus' ? 'bonus' : 'azione',
      canEndEarly: t.canEndEarly !== false,
      minRank: int(t.minRank, 0, 0, 20),
      requireNode: Boolean(t.requireNode),
      icon: DnD.icone.normalizeIcon(t.icon || creature.icon, false),
      gridSize: DnD.griglia.normalizeGridSize(t.gridSize),
      theme: THEMES.includes(t.theme) || (DnD.boss.THEME_IDS || []).includes(t.theme) ? t.theme : '',
      enterText: str(t.enterText, 2000),
      exitText: str(t.exitText, 2000),
    };
  }

  function normalizeLegend(l) {
    l = obj(l);
    const usesOf = (v) => Object.fromEntries(Object.entries(obj(v)).filter(([k]) => /^[\w-]{1,64}$/.test(k)).slice(0, 200).map(([k, x]) => [k, int(x, 0, 0, 99)]));
    const path = P().normalizePath(l.path || P().example());
    const ids = new Set(path.nodes.map((n) => n.id));
    return {
      title: str(l.title, 80),
      theme: THEMES.includes(l.theme) ? l.theme : 'divino',
      pointsBonus: int(l.pointsBonus, 0, 0, 100),
      path,
      unlocked: P().withCore(arr(l.unlocked).filter((x) => typeof x === 'string' && ids.has(x))),
      allowRespec: l.allowRespec !== false,
      transformations: arr(l.transformations).slice(0, 20).map(normalizeTransformation),
      uses: usesOf(l.uses),            // usi rimasti delle trasformazioni (per riposo)
      featureUses: usesOf(l.featureUses),
      spellUses: usesOf(l.spellUses),  // magie «N al giorno» del Percorso: usi spesi (fino al riposo lungo)
    };
  }

  const isLegendary = (c) => Boolean(c && c.type === 'leggendario');
  const rank = (c) => Math.max(0, Math.min(20, (c.level || MIN_LEVEL) - MIN_LEVEL));
  const points = (c) => {
    const total = P().pointsTotal(rank(c), c.legend.pointsBonus);
    const spent = P().pointsSpent(c.legend.path, c.legend.unlocked);
    return { total, spent, left: total - spent };
  };

  // ---------- Effetti dei nodi sbloccati ----------
  // st: archivio (incantesimi e trasformazioni per i riferimenti). Restituisce gli effetti sommati, le fonti
  // («da: nome del nodo») e i riferimenti mancanti (effetto disattivato).
  function effects(c, st) {
    const out = {
      abilities: {}, saves: [], skills: {}, other: [], stats: {}, res: [], imm: [], senses: {}, spells: [], slots: Array(9).fill(0),
      features: [], transformations: [], texts: [], sources: [], missing: [],
    };
    if (!isLegendary(c)) return out;
    const spells = (st && st.spells) || [];
    const tIds = new Set(c.legend.transformations.map((t) => t.id));
    const have = new Set(c.legend.unlocked);
    for (const n of c.legend.path.nodes) {
      if (!have.has(n.id)) continue;
      const src = (label) => out.sources.push({ label, from: n.name });
      for (const e of n.effects) {
        switch (e.kind) {
          case 'caratteristica': out.abilities[e.ability] = (out.abilities[e.ability] || 0) + e.value; src(e.ability + ' ' + (e.value >= 0 ? '+' : '') + e.value); break;
          case 'competenza':
            if (e.target === 'ts') { if (!out.saves.includes(e.ability)) out.saves.push(e.ability); src('competenza TS ' + e.ability); }
            else if (e.target === 'abilita') { out.skills[e.skill] = Math.max(out.skills[e.skill] || 0, e.expertise ? 2 : 1); src((e.expertise ? 'maestria ' : 'competenza ') + e.skill); }
            else { out.other.push(e.text || 'competenza'); src('competenza: ' + (e.text || '—')); }
            break;
          case 'bonus':
            if (e.stat === 'resistenza') { if (!out.res.includes(e.damageType)) out.res.push(e.damageType); src('resistenza ' + e.damageType); }
            else if (e.stat === 'immunita') { if (!out.imm.includes(e.damageType)) out.imm.push(e.damageType); src('immunità ' + e.damageType); }
            else if (e.stat === 'senso') { out.senses[e.sense] = Math.max(out.senses[e.sense] || 0, e.value); src(e.sense + ' ' + e.value + ' m'); }
            else { out.stats[e.stat] = (out.stats[e.stat] || 0) + e.value; src(P().STAT_NAMES[e.stat] + ' ' + (e.value >= 0 ? '+' : '') + e.value); }
            break;
          case 'magia': {
            const sp = spells.find((s) => s.id === e.spellId);
            if (!sp) { out.missing.push('«' + n.name + '»: incantesimo eliminato (effetto disattivato)'); break; }
            out.spells.push({ spellId: sp.id, freq: e.freq, uses: e.uses, from: n.name });
            src('magia ' + sp.name + (e.freq === 'giorno' ? ' (' + e.uses + '/giorno)' : ' (sempre preparato)'));
            break;
          }
          case 'slot': out.slots[e.level - 1] += e.count; src('+' + e.count + ' slot di ' + e.level + '° livello'); break;
          case 'privilegio': out.features.push(Object.assign(clone(e), { from: n.name })); src('privilegio ' + e.name); break;
          case 'trasformazione':
            if (!e.transformationId) break;
            if (!tIds.has(e.transformationId)) { out.missing.push('«' + n.name + '»: trasformazione eliminata (effetto disattivato)'); break; }
            out.transformations.push(e.transformationId);
            src('sblocca una trasformazione');
            break;
          default: if (e.text) out.texts.push({ text: e.text, from: n.name });
        }
      }
    }
    return out;
  }

  // Giocatore "effettivo": la scheda con gli effetti dei nodi già dentro, per i calcoli esistenti
  // (DnD.statistiche.derivedStats e DnD.combattenti.toCombatant). Le caratteristiche restano sotto il tetto (di base 30).
  function effectivePlayer(c, st) {
    if (!isLegendary(c)) return c;
    const fx = effects(c, st);
    const e = clone(c);
    e.asi = Object.assign({}, e.asi);
    for (const [ab, v] of Object.entries(fx.abilities)) e.asi[ab] = (e.asi[ab] || 0) + v;
    const race = st && st.races ? st.races.find((r) => r.id === c.raceId) || null : null;
    const base = DnD.statistiche.derivedStats(c, race, st && st.equipment);
    if (fx.saves.length) { e.saveMode = 'manuale'; e.saves = [...new Set(base.saves.concat(fx.saves))]; }
    if (fx.stats.competenza) e.profBonusOverride = base.profBonus + fx.stats.competenza;
    // PF: bonus diretti più il modificatore di COS cresciuto (o calato) con i nodi, per ogni livello.
    const conDelta = fx.abilities.COS ? R().modifier(DnD.statistiche.derivedStats(e, race, st && st.equipment).abilities.COS) - R().modifier(base.abilities.COS) : 0;
    const hpBonus = (fx.stats.pf || 0) + conDelta * c.level;
    if (hpBonus) e.maxHp = Math.max(c.level, c.maxHp + hpBonus);
    if (fx.stats.ca) { if (e.acMode === 'auto') e.armor.bonus = (e.armor.bonus || 0) + fx.stats.ca; else e.ac += fx.stats.ca; }
    if (e.spellcasting) {
      const sc = e.spellcasting;
      for (const s of fx.spells) if (!sc.known.includes(s.spellId)) sc.known.push(s.spellId);
      if (fx.slots.some(Boolean) && base.spell) {
        sc.slotOverrides = base.spell.slotsTotal.map((n, i) => (fx.slots[i] ? n + fx.slots[i] : sc.slotOverrides[i]));
      }
      if (fx.stats.cd && base.spell) sc.dcOverride = base.spell.dc + fx.stats.cd;
      if (fx.stats.attaccoMagia && base.spell) sc.attackOverride = base.spell.attack + fx.stats.attaccoMagia;
    }
    return e;
  }

  // Valori derivati con il riepilogo degli effetti (per la scheda): abilità con competenza o maestria dei nodi,
  // Percezione passiva, sensi e magie «N al giorno» con gli usi rimasti.
  function derived(c, st) {
    const race = st && st.races ? st.races.find((r) => r.id === c.raceId) || null : null;
    const e = effectivePlayer(c, st);
    const stats = DnD.statistiche.derivedStats(e, race, st && st.equipment);
    const fx = effects(c, st);
    const skillOf = (skill) => R().modifier(stats.abilities[SKILL_ABILITY()[skill] || 'SAG']) + (fx.skills[skill] || 0) * stats.profBonus;
    const daily = dailySpells(c, st);
    return {
      stats, effective: e, fx, points: isLegendary(c) ? points(c) : null,
      skills: Object.keys(fx.skills).sort((a, b) => a.localeCompare(b, 'it')).map((k) => ({ skill: k, level: fx.skills[k], bonus: skillOf(k) })),
      passive: 10 + skillOf('Percezione'),
      daily: Object.entries(daily).map(([spellId, n]) => ({ spellId, n, left: Math.max(0, n - ((c.legend && c.legend.spellUses[spellId]) || 0)) })),
    };
  }

  // Abilità → caratteristica (Atletica → FOR, Percezione → SAG…).
  const SKILL_ABILITY = () => DnD.creatureDati.SKILLS;
  // Grado di competenza in un'abilità dato dai nodi: 0 nessuno, 1 competenza, 2 maestria.
  const skillLevel = (c, skill, st) => effects(c, st).skills[skill] || 0;
  // Bonus di un personaggio (standard o leggendario) a una prova di caratteristica o di abilità, o a un tiro
  // salvezza: caratteristiche finali con gli effetti dei nodi e competenze/maestrie del Percorso.
  function checkBonus(c, what, save, st) {
    const race = st && st.races ? st.races.find((r) => r.id === c.raceId) || null : null;
    const d = DnD.statistiche.derivedStats(effectivePlayer(c, st), race, st && st.equipment);
    const isAbility = R().ABILITIES.includes(what);
    if (save && isAbility) return d.saveTotals[what];
    if (isAbility) return R().modifier(d.abilities[what]);
    // Abilità: competenza e maestria dalla scheda, dai talenti e dal Percorso, «metà competenza», bonus a mano (scheda.js).
    if (c.sheet && DnD.scheda) return DnD.scheda.skillBonus(c, what, d, DnD.statistiche.featEffects(c, st && st.feats), st).total;
    return R().modifier(d.abilities[SKILL_ABILITY()[what] || 'SAG']) + skillLevel(c, what, st) * d.profBonus;
  }

  // Magie «N al giorno» del Percorso: { spellId: usi al giorno } (più nodi sullo stesso incantesimo si sommano).
  // Un incantesimo dato anche come «sempre preparato» resta normale (si lancia con gli slot).
  function dailySpells(c, st) {
    const fx = effects(c, st);
    const always = new Set(fx.spells.filter((x) => x.freq !== 'giorno').map((x) => x.spellId));
    const out = {};
    for (const x of fx.spells) if (x.freq === 'giorno' && !always.has(x.spellId)) out[x.spellId] = (out[x.spellId] || 0) + x.uses;
    return out;
  }

  // PF dei livelli leggendari: dado vita della classe per ogni livello oltre il 20 (stesse regole di calcolo).
  const hpParams = (c, conMod) => {
    const info = DnD.classi.classInfo(c.classId, c.customClass);
    return info ? { level: c.level, hitDie: info.hitDie, conMod } : null;
  };

  // Privilegi creati dall'utente come azioni da creatura (pulsanti nel combattimento). profBonus e
  // caratteristiche del personaggio danno bonus per colpire e CD quando non sono scritti a mano.
  function featureActions(features, abilities, profBonus) {
    const mod = (ab) => R().modifier(abilities[ab] || 10);
    const group = { passivo: 'traits', azione: 'actions', bonus: 'bonusActions', reazione: 'reactions' };
    const out = { traits: [], actions: [], bonusActions: [], reactions: [] };
    for (const f of features) {
      const mech = clone(f.mech);
      if (mech.kind === 'attacco' && (mech.toHit === null || mech.toHit === undefined)) mech.toHit = profBonus + mod(mech.ability || 'FOR');
      if (mech.kind === 'salvezza' && (mech.dc === null || mech.dc === undefined)) mech.dc = 8 + profBonus + mod(mech.dcAbility || 'COS');
      const freq = f.uses.kind === 'volonta' ? { kind: 'volonta' } : f.uses.n === 1 ? { kind: f.uses.kind === 'breve' ? 'riposo-breve' : 'riposo-lungo' } : { kind: 'giorno', uses: f.uses.n };
      out[group[f.type]].push(DnD.creature.normalizeAction({ id: f.id, name: f.name, desc: f.desc + (f.from ? ' (da: ' + f.from + ')' : ''), customText: Boolean(f.desc) || mech.kind === 'testo', mech, freq }));
    }
    return out;
  }

  // Combattente di un leggendario: velocità, iniziativa, attacco e danno, difese, sensi, privilegi come azioni,
  // trasformazioni disponibili. x: combattente creato da DnD.combattenti.toCombatant con il giocatore effettivo.
  function applyToCombatant(x, c, st, rng) {
    const fx = effects(c, st);
    const s = fx.stats;
    if (s.velocita) x.speeds = DnD.movimento.addFeet(x.speeds, DnD.movimento.feetFromMeters(Math.abs(s.velocita)) * Math.sign(s.velocita));
    if (s.iniziativa) x.initiative += s.iniziativa;
    if (s.attacco || s.danno) x.weapons = x.weapons.map((w) => Object.assign({}, w, { toHit: w.toHit + (s.attacco || 0), damageBonus: w.damageBonus + (s.danno || 0) }));
    x.defenses = { vuln: x.defenses.vuln, res: [...new Set(x.defenses.res.concat(fx.res))], imm: [...new Set(x.defenses.imm.concat(fx.imm))] };
    const prof = DnD.statistiche.derivedStats(effectivePlayer(c, st), null, st.equipment).profBonus;
    const acts = featureActions(fx.features, x.abilities, prof);
    if (acts.actions.length || acts.bonusActions.length || acts.reactions.length || acts.traits.length) {
      // Pseudo-scheda da creatura: i privilegi diventano pulsanti (usi, ricarica) come per le creature.
      const pseudo = DnD.creature.normalizeMonster(Object.assign({ abilities: x.abilities, cr: '0', legendaryPoints: 1 }, acts));
      x.creature = DnD.creature.combatState(Object.assign(pseudo, { name: x.name }));
    }
    // Magie del Percorso: quelle «N al giorno» si lanciano senza slot con gli usi rimasti (come gli incantesimi
    // innati delle creature). Chi non ha una classe da incantatore le lancia con la migliore tra INT, SAG e CAR.
    const daily = dailySpells(c, st);
    const nodeSpells = fx.spells.map((s) => (st.spells || []).find((x) => x.id === s.spellId)).filter(Boolean);
    if (!x.spellcasting && nodeSpells.length) {
      const ability = ['INT', 'SAG', 'CAR'].reduce((a, b) => (x.abilities[b] > x.abilities[a] ? b : a));
      const mod = R().modifier(x.abilities[ability]);
      x.spellcasting = {
        attack: DnD.magie.spellAttackBonus(prof, mod), dc: DnD.magie.spellSaveDc(prof, mod), ability, mod, pact: false,
        slotsTotal: Array(9).fill(0), slotsUsed: Array(9).fill(0), spells: [],
      };
    }
    if (x.spellcasting) {
      const sc = x.spellcasting;
      for (const sp of nodeSpells) if (!sc.spells.some((y) => y.id === sp.id)) sc.spells.push(clone(sp));
      sc.innate = Object.assign({}, sc.innate || {});
      for (const [id, n] of Object.entries(daily)) sc.innate[id] = { freq: 'giorno', left: Math.max(0, n - (c.legend.spellUses[id] || 0)) };
      if (!Object.keys(sc.innate).length) delete sc.innate;
    }
    x.legend = {
      theme: c.legend.theme, rank: rank(c),
      transformations: available(c, st).map((t) => t.id),
      uses: clone(c.legend.uses), form: null, senses: fx.senses, texts: fx.texts.map((t) => t.text),
      passive: derived(c, st).passive,
    };
    return x;
  }

  // Trasformazioni disponibili: rango sufficiente e, se richiesto, sbloccate da un nodo del percorso.
  function available(c, st) {
    if (!isLegendary(c)) return [];
    const fx = effects(c, st);
    return c.legend.transformations.filter((t) => rank(c) >= t.minRank && (!t.requireNode || fx.transformations.includes(t.id)));
  }
  const usesLeft = (c, t) => (c.legend.uses[t.id] === undefined ? t.uses.n : c.legend.uses[t.id]);

  // ---------- Trasformazione nel combattimento ----------
  const FORM_KEYS = ['maxHp', 'hp', 'ac', 'saves', 'abilities', 'weapons', 'spellcasting', 'creature', 'boss', 'w', 'h', 'icon', 'speeds', 'defenses'];

  // Caratteristiche fuse: FOR, DES, COS dalla forma (se previsto), INT, SAG, CAR dal personaggio.
  function fusedAbilities(t, playerAbilities) {
    const out = {};
    for (const ab of AB()) out[ab] = t.fusion.physicalFromForm && PHYSICAL.includes(ab) ? t.creature.abilities[ab] : playerAbilities[ab];
    return out;
  }

  // Attiva la forma: il combattente usa la scheda boss (azioni, fasi, tema, barra in alto). Modifica x;
  // restituisce le righe del log.
  function transform(x, t) {
    if (x.legend && x.legend.form) return { ok: false, lines: [x.name + ' è già trasformato.'] };
    const left = x.legend.uses[t.id] === undefined ? t.uses.n : x.legend.uses[t.id];
    if (left <= 0) return { ok: false, lines: ['Nessun uso rimasto di «' + t.name + '».'] };
    const prev = clone(Object.fromEntries(FORM_KEYS.map((k) => [k, x[k] === undefined ? null : x[k]])));
    const m = clone(t.creature);
    const abilities = fusedAbilities(t, x.abilities);
    m.abilities = abilities;
    const formHp = DnD.creature.hpInfo(t.creature).total;
    const st = DnD.creature.combatState(Object.assign({}, m, { name: x.name }));
    // Privilegi del personaggio mantenuti: si aggiungono alle azioni della forma.
    if (t.fusion.keepFeatures && prev.creature) for (const g of ['traits', 'actions', 'bonusActions', 'reactions']) st[g] = st[g].concat(prev.creature[g] || []);
    if (t.fusion.keepFeatures && prev.creature) { Object.assign(st.uses, prev.creature.uses); Object.assign(st.recharge, prev.creature.recharge); }
    x.creature = st;
    x.boss = Object.assign(DnD.boss.combatState(Object.assign({}, m, { name: x.name })), { title: t.name + (t.epithet ? ' · ' + t.epithet : ''), revealed: true, theme: formTheme(t, x.legend.theme) });
    if (t.hpMode === 'sostituisce') { x.maxHp = formHp; x.hp = formHp; }
    else { x.maxHp = prev.maxHp + formHp; x.hp = prev.hp + formHp; }
    x.ac = m.ac;
    const formSaves = DnD.creature.saveTotals(m);
    x.saves = Object.fromEntries(AB().map((ab) => [ab, t.fusion.keepProficiency ? Math.max(formSaves[ab], prev.saves[ab]) : formSaves[ab]]));
    x.abilities = abilities;
    const dims = DnD.griglia.gridSizeFor(t.gridSize, m.size);
    x.w = dims.w;
    x.h = dims.h;
    x.icon = Object.assign({}, t.icon);
    x.speeds = DnD.movimento.speedsFromCreature(m.speed);
    x.weapons = t.fusion.keepEquipment ? prev.weapons : [];
    x.spellcasting = t.fusion.keepSpells ? prev.spellcasting : null;
    x.defenses = {
      vuln: m.vulnerabilities.slice(), res: [...new Set(m.resistances.concat(t.fusion.keepFeatures ? prev.defenses.res : []))], imm: [...new Set(m.immunities.concat(t.fusion.keepFeatures ? prev.defenses.imm : []))],
    };
    x.legend.uses[t.id] = left - 1;
    x.legend.form = {
      id: t.id, name: t.name, hpMode: t.hpMode, prev, theme: x.boss.theme,
      roundsLeft: t.duration.unit === 'minuti' ? t.duration.value * 10 : t.duration.value, canEndEarly: t.canEndEarly, exitText: t.exitText,
    };
    return { ok: true, lines: ['✦ ' + x.name + ' si trasforma: ' + t.name + (t.epithet ? ', ' + t.epithet : '') + ' (' + (t.activation === 'bonus' ? 'azione bonus' : 'azione') + ', usi rimasti ' + (left - 1) + '/' + t.uses.n + ', durata ' + t.duration.value + ' ' + t.duration.unit + ').' + (t.enterText ? ' ' + t.enterText : '')] };
  }

  // Torna normale. excess: danno oltre lo 0 della forma (passa al personaggio, con PF che sostituiscono).
  function revert(x, reason, excess) {
    const f = x.legend && x.legend.form;
    if (!f) return { ok: false, lines: [] };
    const prev = f.prev;
    const formHp = x.hp;
    let hp;
    if (f.hpMode === 'sostituisce') hp = formHp > 0 ? prev.hp : Math.max(0, prev.hp - Math.max(0, excess || 0));
    else hp = Math.min(prev.hp, formHp); // PF temporanei: si consumano prima, il resto ricade sul personaggio
    for (const k of FORM_KEYS) x[k] = prev[k];
    x.hp = Math.max(0, Math.min(x.maxHp, hp));
    x.legend.form = null;
    const why = { durata: 'fine della durata', pf: 'PF della forma a 0', anticipata: 'fine anticipata', manuale: 'ritorno' }[reason] || reason;
    return { ok: true, lines: ['✦ ' + x.name + ' torna normale (' + why + ')' + (f.hpMode === 'sostituisce' && excess > 0 ? ': ' + excess + ' danni in eccesso passano al personaggio' : '') + ' — PF ' + x.hp + '/' + x.maxHp + '.' + (f.exitText ? ' ' + f.exitText : '')] };
  }

  // Danno a un combattente: come regole.applyDamage, ma una forma con PF sostitutivi che scende a 0 torna
  // normale e il danno in eccesso passa al personaggio. Restituisce le righe del log (eventuali).
  function damage(x, amount) {
    const f = x.legend && x.legend.form;
    if (!f || f.hpMode !== 'sostituisce') { x.hp = R().applyDamage(x.hp, amount); return []; }
    const excess = amount - x.hp;
    x.hp = Math.max(0, x.hp - amount);
    if (x.hp > 0) return [];
    if (f.hpMode === 'sostituisce') return revert(x, 'pf', excess).lines;
    return [];
  }

  // Inizio del turno del combattente trasformato: la durata scende e, finita, la forma termina.
  function tick(x) {
    const f = x.legend && x.legend.form;
    if (!f) return [];
    f.roundsLeft -= 1;
    if (f.roundsLeft > 0) return [x.name + ': ' + f.name + ', ancora ' + f.roundsLeft + ' round.'];
    return revert(x, 'durata', 0).lines;
  }

  // ---------- Promozione e declassamento ----------
  // Eleva a leggendario (serve il livello 20). Il percorso e le trasformazioni si conservano anche declassando.
  function promote(p) {
    if (p.level < MIN_LEVEL) return { ok: false, reason: 'serve il livello 20 (ora ' + p.level + ')' };
    const out = clone(p);
    out.type = 'leggendario';
    out.abilityCap = out.abilityCap || 30;
    out.legend = normalizeLegend(p.legend || p.legendArchive || {});
    delete out.legendArchive;
    return { ok: true, player: out };
  }
  function demote(p) {
    const out = clone(p);
    out.legendArchive = out.legend;
    delete out.legend;
    delete out.type;
    out.level = Math.min(out.level, MIN_LEVEL);
    return out;
  }

  // Riposo: ripristina gli usi delle trasformazioni e dei privilegi (breve: solo quelli «per riposo breve»).
  function rest(c, long) {
    for (const t of c.legend.transformations) if (long || t.uses.per === 'breve') delete c.legend.uses[t.id];
    for (const n of c.legend.path.nodes) for (const e of n.effects) if (e.kind === 'privilegio' && (long || e.uses.kind === 'breve')) delete c.legend.featureUses[e.id];
    if (long) c.legend.spellUses = {};
  }

  DnD.leggendario = {
    MIN_LEVEL, MAX_LEVEL, THEMES, THEME_NAMES, PALETTES, themeKey, formTheme, PHYSICAL, FORM_KEYS,
    normalizeLegend, normalizeTransformation, isLegendary, rank, points, effects, effectivePlayer, derived, hpParams, featureActions,
    applyToCombatant, available, usesLeft, skillLevel, checkBonus, dailySpells, fusedAbilities, transform, revert, damage, tick, promote, demote, rest,
  };

  // Grado delle abilità dal Percorso: la scheda lo chiede senza conoscere questo modulo.
  DnD.scheda.registraLivelloLeggendario(skillLevel);
})(globalThis.DnD = globalThis.DnD || {});
