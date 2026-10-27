// Eventi (logica pura): modelli della libreria e istanze piazzate sulle mappe di esplorazione (copie
// indipendenti con il proprio stato). Innesco (entrata, passaggio, interazione, tempo, incontro), visibilità
// (visibile, nascosto, da scoprire con una prova), ripetibilità, condizioni (bioma, ora, meteo, oggetto,
// variabile) e azioni ordinate con esiti: testo, prova o tiro salvezza (successo/fallimento, prova di gruppo),
// combattimento, entra in una mappa, danno/cura, ricompensa, teletrasporto, cambia ambiente, variabile,
// tabella casuale, riposo, attiva altro evento, nota. L'esecuzione lavora su { st (archivio), ex (stato
// dell'esplorazione della sessione) } e si ferma sulle azioni che richiedono la schermata (combattimento).
(function (DnD) {
  'use strict';

  const TRIGGERS = ['entrata', 'passaggio', 'interazione', 'tempo', 'incontro'];
  const TRIGGER_NAMES = { entrata: 'Entrata nella cella o nell\'area', passaggio: 'Passaggio (ogni passo nell\'area)', interazione: 'Interazione (clic del master)', tempo: 'Tempo (dopo N ore)', incontro: 'Incontro casuale' };
  const VISIBILITY = ['visibile', 'nascosto', 'scoperta'];
  const VISIBILITY_NAMES = { visibile: 'Visibile', nascosto: 'Nascosto (solo master)', scoperta: 'Nascosto, da scoprire con una prova' };
  const REPEATS = ['una', 'sempre', 'n'];
  const REPEAT_NAMES = { una: 'Una volta', sempre: 'Sempre', n: 'N volte' };
  const COND_KINDS = ['bioma', 'ora', 'meteo', 'oggetto', 'variabile'];
  const COND_NAMES = { bioma: 'Bioma', ora: 'Ora del giorno', meteo: 'Meteo', oggetto: 'Possesso di un oggetto', variabile: 'Variabile' };
  const OPS = ['=', '!=', '>', '>=', '<', '<='];
  const ACTIONS = ['testo', 'prova', 'combattimento', 'mappa', 'danno', 'ricompensa', 'teletrasporto', 'ambiente', 'variabile', 'tabella', 'riposo', 'attiva', 'nota', 'reputazione', 'quest'];
  const ACTION_NAMES = {
    testo: 'Testo / lettura ai giocatori', prova: 'Prova o tiro salvezza', combattimento: 'Combattimento', mappa: 'Entra in una mappa',
    danno: 'Trappola / danno / cura', ricompensa: 'Ricompensa', teletrasporto: 'Teletrasporto', ambiente: 'Cambia ambiente',
    variabile: 'Variabile', tabella: 'Tabella casuale', riposo: 'Riposo', attiva: 'Attiva altro evento', nota: 'Nota',
    reputazione: 'Reputazione con una fazione', quest: 'Quest (avvia, avanza, completa, fallisci)',
  };
  const QUEST_OPS = ['avvia', 'avanza', 'completa', 'fallisci'];
  const QUEST_OP_NAMES = { avvia: 'Avvia (accetta)', avanza: 'Avanza un obiettivo', completa: 'Completa', fallisci: 'Fallisci' };
  const WHO = ['gruppo', 'scelto', 'migliore', 'turno'];
  const WHO_NAMES = { gruppo: 'Tutto il gruppo', scelto: 'Un personaggio scelto', migliore: 'Il migliore', turno: 'A turno' };
  const COINS = ['mr', 'ma', 'me', 'mo', 'mp'];
  const MAX_DEPTH = 6;
  const MAX_STEPS = 200;

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => DnD.dadi.uid();
  const AB = () => DnD.regole.ABILITIES;
  const SKILLS = () => DnD.creatureDati.SKILLS;
  const dice = (v, def) => (DnD.dadi.parseExpr(v) ? str(v, 20) : def);
  const cellsOf = (v) => arr(v).slice(0, 2500).map((c) => ({ x: int(obj(c).x, 0, 0, 99), y: int(obj(c).y, 0, 0, 99) }));

  // ---------- Normalizzazione ----------
  function normalizeCondition(c) {
    c = obj(c);
    return {
      kind: pick(c.kind, COND_KINDS, 'variabile'), negate: Boolean(c.negate),
      biomeId: str(c.biomeId, 64), from: int(c.from, 6, 0, 23), to: int(c.to, 18, 0, 23), weather: str(c.weather, 60),
      equipmentId: str(c.equipmentId, 64), name: str(c.name, 40), op: pick(c.op, OPS, '='), value: typeof c.value === 'number' || typeof c.value === 'boolean' ? c.value : str(c.value, 80),
    };
  }

  function normalizeAction(a, depth) {
    a = obj(a);
    depth = depth || 0;
    const sub = (v) => (depth >= MAX_DEPTH ? [] : arr(v).slice(0, 30).map((x) => normalizeAction(x, depth + 1)));
    const kind = pick(a.kind, ACTIONS, 'testo');
    const out = { id: str(a.id, 64) || uid(), kind };
    switch (kind) {
      case 'testo': Object.assign(out, { text: str(a.text, 5000), reward: a.reward ? normalizeReward(a.reward) : null }); break;
      case 'prova': Object.assign(out, {
        what: typeof a.what === 'string' && (AB().includes(a.what) || SKILLS()[a.what]) ? a.what : 'Atletica',
        save: Boolean(a.save), dc: int(a.dc, 12, 1, 40), who: pick(a.who, WHO, 'migliore'), memberId: str(a.memberId, 64),
        mode: pick(a.mode, ['normale', 'vantaggio', 'svantaggio'], 'normale'), group: Boolean(a.group), success: sub(a.success), failure: sub(a.failure),
      }); break;
      case 'combattimento': Object.assign(out, {
        foes: arr(a.foes).slice(0, 20).map((f) => ({ npcId: str(obj(f).npcId, 64), qty: dice(obj(f).qty, '1') })).filter((f) => f.npcId),
        gridId: str(a.gridId, 64), start: a.start === 'avvia' ? 'avvia' : 'prepara',
      }); break;
      case 'mappa': Object.assign(out, { gridId: str(a.gridId, 64), entry: { x: int(obj(a.entry).x, 0, 0, 99), y: int(obj(a.entry).y, 0, 0, 99) } }); break;
      case 'danno': Object.assign(out, {
        heal: Boolean(a.heal), dice: dice(a.dice, '1d6'), type: str(a.type, 30), targets: a.targets === 'scelto' ? 'scelto' : 'gruppo', memberId: str(a.memberId, 64),
        save: a.save ? { what: pick(obj(a.save).what, AB(), 'DES'), dc: int(obj(a.save).dc, 12, 1, 40), half: obj(a.save).half !== false } : null,
        condition: a.condition && DnD.creatureDati.CONDITIONS.includes(a.condition) ? a.condition : '',
      }); break;
      case 'ricompensa': Object.assign(out, normalizeReward(a)); break;
      case 'teletrasporto': Object.assign(out, { to: { x: int(obj(a.to).x, 0, 0, 99), y: int(obj(a.to).y, 0, 0, 99) }, eventId: str(a.eventId, 64) }); break;
      case 'ambiente': Object.assign(out, { biomeId: str(a.biomeId, 64), radius: int(a.radius, 0, 0, 20), weather: str(a.weather, 60), hour: a.hour === null || a.hour === undefined || a.hour === '' ? null : int(a.hour, 8, 0, 23) }); break;
      case 'variabile': Object.assign(out, { name: str(a.name, 40) || 'variabile', op: pick(a.op, ['imposta', 'incrementa'], 'imposta'),
        value: typeof a.value === 'number' || typeof a.value === 'boolean' ? a.value : str(a.value, 80) }); break;
      case 'tabella': Object.assign(out, { dice: dice(a.dice, '1d6'), rows: arr(a.rows).slice(0, 20).map((r) => ({ min: int(obj(r).min, 1, 1, 1000), max: int(obj(r).max, 1, 1, 1000), label: str(obj(r).label, 80), actions: sub(obj(r).actions) })) }); break;
      case 'riposo': Object.assign(out, { long: Boolean(a.long) }); break;
      case 'attiva': Object.assign(out, { eventId: str(a.eventId, 64) }); break;
      case 'nota': Object.assign(out, { text: str(a.text, 2000), toNotes: Boolean(a.toNotes) }); break;
      case 'reputazione': Object.assign(out, { factionId: str(a.factionId, 64), delta: int(a.delta, 5, -200, 200), reason: str(a.reason, 200) }); break;
      case 'quest': Object.assign(out, { questId: str(a.questId, 64), op: pick(a.op, QUEST_OPS, 'avvia'), objectiveId: str(a.objectiveId, 64), n: int(a.n, 1, 1, 999) }); break;
      default: break;
    }
    return out;
  }
  function normalizeReward(r) {
    r = obj(r);
    const c = obj(r.coins);
    return {
      xp: int(r.xp, 0, 0, 1000000),
      coins: Object.fromEntries(COINS.map((k) => [k, int(c[k], 0, 0, 1000000)])),
      items: arr(r.items).slice(0, 30).map((x) => ({ equipmentId: str(obj(x).equipmentId, 64), qty: int(obj(x).qty, 1, 1, 999) })).filter((x) => x.equipmentId),
      to: arr(r.to).filter((x) => typeof x === 'string').slice(0, 20),
    };
  }

  function normalizeEvent(e) {
    e = obj(e);
    const t = obj(e.trigger);
    const v = obj(e.visibility);
    const r = obj(e.repeat);
    return {
      id: str(e.id, 64) || uid(),
      name: str(e.name, 80) || 'Evento',
      icon: DnD.icone.normalizeIcon(e.icon || { kind: 'shape', shape: 'stella', color: '#f2c94c' }, false),
      description: str(e.description, 3000),
      readText: str(e.readText, 5000),
      notes: str(e.notes, 5000),
      trigger: { kind: pick(t.kind, TRIGGERS, 'entrata'), hours: num(t.hours, 24, 0.5, 100000) },
      area: Boolean(e.area),
      visibility: { kind: pick(v.kind, VISIBILITY, 'visibile'), dc: int(v.dc, 13, 1, 40), skill: v.skill === 'Indagare' ? 'Indagare' : 'Percezione', who: v.who === 'gruppo' ? 'gruppo' : 'migliore' },
      repeat: { kind: pick(r.kind, REPEATS, 'una'), times: int(r.times, 2, 1, 999), cooldown: num(r.cooldown, 0, 0, 100000) },
      conditions: arr(e.conditions).slice(0, 10).map(normalizeCondition),
      actions: arr(e.actions).slice(0, 40).map((a) => normalizeAction(a, 0)),
      shared: e.shared !== false,
    };
  }

  // Istanza piazzata: copia indipendente del modello, celle occupate e stato proprio.
  function normalizeInstance(i, w, h) {
    i = obj(i);
    const s = obj(i.state);
    const cells = cellsOf(i.cells).filter((c) => c.x < (w || 100) && c.y < (h || 100));
    return {
      id: str(i.id, 64) || uid(),
      templateId: str(i.templateId, 64),
      event: normalizeEvent(i.event),
      cells: cells.length ? cells : [{ x: 0, y: 0 }],
      state: {
        fired: int(s.fired, 0, 0, 1000000), lastHours: s.lastHours === null || s.lastHours === undefined ? null : num(s.lastHours, null, 0, 1e9),
        placedHours: num(s.placedHours, 0, 0, 1e9), discovered: Boolean(s.discovered), disabled: Boolean(s.disabled),
        outcomes: arr(s.outcomes).slice(-20).map((o) => str(o, 200)),
      },
    };
  }

  function instantiate(template, cells, nowHours) {
    return normalizeInstance({ id: uid(), templateId: template.id, event: clone(template), cells, state: { placedHours: nowHours || 0 } });
  }
  // "Aggiorna dal modello": copia di nuovo il modello, lo stato resta.
  function updateFromTemplate(inst, template) {
    return Object.assign({}, inst, { event: clone(template) });
  }

  const inCells = (cells, p) => Boolean(p) && cells.some((c) => c.x === p.x && c.y === p.y);
  // L'evento è visibile al gruppo (e mostrato sulla mappa dei giocatori)?
  // Evento piazzato visibile ai giocatori: definito in visione.js (serve alla vista dei giocatori), qui riesportato.
  const isVisible = (inst) => DnD.visione.eventoVisibile(inst);

  // ---------- Membri del gruppo e prove ----------
  // Bonus di un giocatore a una caratteristica, abilità o tiro salvezza (dalle schede: caratteristiche finali e
  // competenze della classe). I leggendari aggiungono gli effetti del Percorso (caratteristiche, competenze e
  // maestrie nelle abilità); per gli standard la competenza nelle abilità non è registrata: solo il modificatore.
  function memberBonus(player, what, save, st) {
    return DnD.leggendario.checkBonus(player, what, save, st);
  }

  // Prova: { results: [{ id, name, total, success }], success } secondo "chi tira".
  function resolveCheck(a, ctx, extra) {
    const members = ctx.members();
    if (!members.length) return { results: [], success: false, note: 'nessun personaggio nel gruppo' };
    const bonusOf = (m) => memberBonus(m, a.what, a.save, ctx.st) + (extra || 0);
    let who = members;
    if (a.who === 'scelto') who = [members.find((m) => m.id === a.memberId) || members[0]];
    else if (a.who === 'migliore') who = [members.slice().sort((x, y) => bonusOf(y) - bonusOf(x))[0]];
    else if (a.who === 'turno') { who = [members[ctx.ex.rotation % members.length]]; ctx.ex.rotation += 1; }
    const results = who.map((m) => {
      // Condizioni del personaggio (condizioni.js): svantaggio alle prove, salvezze con svantaggio o fallite in automatico.
      const ms = ctx.memberState ? ctx.memberState(m.id) : null;
      const pseudo = { conditions: ms ? (ms.conditions || []).concat(ms.exhaustion ? [{ type: 'sfinimento', level: ms.exhaustion }] : []) : [] };
      const C = DnD.condizioni;
      const ability = AB().includes(a.what) ? a.what : (DnD.creatureDati.SKILLS[a.what] || 'FOR');
      const mods = a.save ? C.saveMods(pseudo, ability, a.mode || 'normale') : C.checkMods(pseudo, { base: a.mode || 'normale', sight: a.what === 'Percezione' || a.what === 'Indagare' });
      if (mods.autoFail) return { id: m.id, name: m.name, natural: null, total: null, success: false, note: 'fallisce in automatico (' + mods.autoFail + ')' };
      const r = DnD.regole.rollSave({ bonus: bonusOf(m), mode: mods.mode, dc: a.dc }, ctx.rng);
      return { id: m.id, name: m.name, natural: r.natural, total: r.total, success: r.success, note: C.modsText(mods) };
    });
    const ok = results.filter((r) => r.success).length;
    const success = a.who === 'gruppo' && a.group ? ok * 2 >= results.length : a.who === 'gruppo' ? ok === results.length : ok > 0;
    return { results, success };
  }

  // ---------- Condizioni ----------
  function compare(a, op, b) {
    const na = Number(a);
    const nb = Number(b);
    const numeric = a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'boolean';
    const x = numeric ? na : String(a);
    const y = numeric ? nb : String(b);
    switch (op) {
      case '!=': return x !== y;
      case '>': return x > y;
      case '>=': return x >= y;
      case '<': return x < y;
      case '<=': return x <= y;
      default: return x === y;
    }
  }
  // ctx: { ex, biomeId (della cella del gruppo), hasItem(id) }
  function conditionsMet(conds, ctx) {
    return conds.every((c) => {
      let ok;
      const hour = ctx.ex.time.hour;
      if (c.kind === 'bioma') ok = ctx.biomeId === c.biomeId;
      else if (c.kind === 'ora') ok = c.from <= c.to ? hour >= c.from && hour <= c.to : hour >= c.from || hour <= c.to;
      else if (c.kind === 'meteo') ok = Boolean(ctx.ex.weather) && ctx.ex.weather.name.toLowerCase() === c.weather.toLowerCase();
      else if (c.kind === 'oggetto') ok = ctx.hasItem(c.equipmentId);
      else {
        const v = ctx.ex.variables[c.name];
        ok = compare(v === undefined ? '' : v, c.op, c.value);
      }
      return c.negate ? !ok : ok;
    });
  }

  // L'istanza può scattare ora? (ripetibilità, ricarica, condizioni). Restituisce { ok, reason }.
  function canFire(inst, ctx) {
    const e = inst.event;
    const s = inst.state;
    if (s.disabled) return { ok: false, reason: 'disattivato' };
    if (e.repeat.kind === 'una' && s.fired >= 1) return { ok: false, reason: 'già innescato' };
    if (e.repeat.kind === 'n' && s.fired >= e.repeat.times) return { ok: false, reason: 'innescato ' + s.fired + ' volte su ' + e.repeat.times };
    if (e.repeat.cooldown && s.lastHours !== null && ctx.ex.time.total - s.lastHours < e.repeat.cooldown) return { ok: false, reason: 'in ricarica' };
    if (!conditionsMet(e.conditions, ctx)) return { ok: false, reason: 'condizioni non soddisfatte' };
    return { ok: true, reason: '' };
  }

  // Inneschi dovuti al movimento del gruppo da `from` a `to` (celle adiacenti). Restituisce le istanze.
  function movementTriggers(instances, from, to) {
    return instances.filter((i) => {
      const k = i.event.trigger.kind;
      if (k === 'entrata') return inCells(i.cells, to) && !inCells(i.cells, from);
      if (k === 'passaggio') return inCells(i.cells, to);
      return false;
    });
  }
  // Inneschi a tempo: scattano quando sono passate le ore indicate dal piazzamento (o dall'ultima volta).
  const timeTriggers = (instances, totalHours) => instances.filter((i) => i.event.trigger.kind === 'tempo' &&
    totalHours - (i.state.lastHours === null ? i.state.placedHours : i.state.lastHours) >= i.event.trigger.hours);

  // Scoperta di un evento nascosto con CD: prova (Percezione o Indagare) del migliore o di tutto il gruppo
  // (basta un successo), con il modificatore del ritmo e del meteo. Modifica inst.state.discovered.
  function tryDiscover(inst, ctx, extra) {
    const v = inst.event.visibility;
    if (v.kind !== 'scoperta' || inst.state.discovered) return null;
    const r = resolveCheck({ what: v.skill, dc: v.dc, who: v.who === 'gruppo' ? 'gruppo' : 'migliore', group: false, mode: 'normale' }, ctx, extra);
    const success = r.results.some((x) => x.success);
    if (success) inst.state.discovered = true;
    return { success, results: r.results };
  }

  // ---------- Esecuzione ----------
  // Testo con le variabili: "{chiave}" diventa il valore della variabile della sessione.
  const interpolate = (text, vars) => String(text || '').replace(/\{([\w àèéìòù-]{1,40})\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

  // ctx: {
  //   st, ex, grid (griglia corrente), rng, now() (ore totali), overrides: { idAzione: 'successo' | 'fallimento' },
  //   members() -> giocatori del gruppo attivo, memberState(id), log(testo, tipo), biomeId, hasItem(id),
  //   findEvent(id) -> { inst | template }, enterMap(gridId, entry) -> messaggio, teleport(cella), setBiome(id, raggio)
  // }
  // Esegue le azioni in ordine. Restituisce { texts: [{ title, text, reward }], pause: null | { action, rest } }.
  function run(actions, ctx, out, depth) {
    out = out || { texts: [], pause: null, steps: 0 };
    depth = depth || 0;
    for (let i = 0; i < actions.length; i++) {
      if (out.pause || ++out.steps > MAX_STEPS) break;
      const a = actions[i];
      const branch = exec(a, ctx, out, depth);
      if (out.pause) {
        // Le azioni che seguono riprendono dopo il combattimento (o la schermata richiesta).
        out.pause.rest = out.pause.rest.concat(actions.slice(i + 1));
        break;
      }
      if (branch && branch.length) run(branch, ctx, out, depth + 1);
    }
    return out;
  }

  function applyReward(r, ctx) {
    const members = ctx.members();
    const to = r.to && r.to.length ? members.filter((m) => r.to.includes(m.id)) : members;
    if (!to.length) { ctx.log('Ricompensa: nessun destinatario.', 'avviso'); return; }
    const parts = [];
    if (r.xp) {
      const each = Math.floor(r.xp / to.length);
      for (const m of to) ctx.memberState(m.id).xp += each;
      parts.push(r.xp + ' PE (' + each + ' a testa)');
    }
    const first = ctx.st.players.find((p) => p.id === to[0].id);
    for (const k of COINS) if (r.coins && r.coins[k] && first) { first.coins[k] = (first.coins[k] || 0) + r.coins[k]; parts.push(r.coins[k] + ' ' + k); }
    for (const it of r.items || []) {
      const eq = ctx.st.equipment.find((e) => e.id === it.equipmentId);
      if (!eq) { ctx.log('⚠ Oggetto della ricompensa non più presente nell\'Attrezzatura.', 'avviso'); continue; }
      if (!first) continue;
      const row = first.inventory.find((x) => x.equipmentId === eq.id);
      if (row) row.qty += it.qty; else first.inventory.push({ equipmentId: eq.id, qty: it.qty, equipped: false });
      parts.push(it.qty + '× ' + eq.name);
    }
    if (parts.length) ctx.log('🎁 Ricompensa' + (first ? ' (oggetti e monete a ' + first.name + ')' : '') + ': ' + parts.join(', ') + '.', 'ricompensa');
  }

  function exec(a, ctx, out, depth) {
    const ex = ctx.ex;
    switch (a.kind) {
      case 'testo': {
        out.texts.push({ title: 'Testo', text: interpolate(a.text, ex.variables), reward: a.reward });
        if (a.reward) applyReward(a.reward, ctx);
        return null;
      }
      case 'nota': {
        ctx.log('📝 ' + interpolate(a.text, ex.variables), 'nota');
        if (a.toNotes) out.notes = (out.notes || []).concat(interpolate(a.text, ex.variables));
        return null;
      }
      case 'prova': {
        const forced = ctx.overrides && ctx.overrides[a.id];
        const r = resolveCheck(a, ctx, ex.weather ? -(ex.weather.dc || 0) : 0);
        const success = forced ? forced === 'successo' : r.success;
        ctx.log('🎲 ' + (a.save ? 'Tiro salvezza su ' : 'Prova di ') + a.what + ' CD ' + a.dc + ' (' + WHO_NAMES[a.who].toLowerCase() + (a.group ? ', prova di gruppo' : '') + '): ' +
          (r.results.map((x) => x.name + ' ' + (x.total === null ? '—' : x.total) + (x.success ? ' ✓' : ' ✗') + (x.note ? ' (' + x.note + ')' : '')).join(', ') || r.note || '—') + ' → ' + (success ? 'SUCCESSO' : 'FALLIMENTO') + (forced ? ' (scelto dal master)' : '') + '.', success ? 'successo' : 'fallimento');
        return success ? a.success : a.failure;
      }
      case 'danno': {
        const members = ctx.members();
        const targets = a.targets === 'scelto' ? members.filter((m) => m.id === a.memberId).slice(0, 1) : members;
        const roll = DnD.dadi.rollExpr(a.dice, ctx.rng);
        const amount = roll ? Math.max(0, roll.total) : 0;
        const parts = [];
        for (const m of targets) {
          const ms = ctx.memberState(m.id);
          if (a.heal) { ms.hp = Math.min(ms.maxHp, ms.hp + amount); parts.push(m.name + ' +' + amount); continue; }
          let dmg = amount;
          let saved = false;
          if (a.save) {
            const r = DnD.regole.rollSave({ bonus: memberBonus(m, a.save.what, true, ctx.st), mode: 'normale', dc: a.save.dc }, ctx.rng);
            saved = r.success;
            if (saved) dmg = a.save.half ? Math.floor(amount / 2) : 0;
          }
          ms.hp = Math.max(0, ms.hp - dmg);
          if (a.condition && !saved && !ms.conditions.includes(a.condition)) ms.conditions.push(a.condition);
          parts.push(m.name + ' -' + dmg + (a.save ? (saved ? ' (salvezza riuscita)' : ' (salvezza fallita)') : '') + (a.condition && !saved ? ', ' + a.condition : ''));
        }
        ctx.log((a.heal ? '💚 Cura ' : '💥 Danno ') + a.dice + ' = ' + amount + (a.type ? ' ' + a.type : '') + ': ' + (parts.join(', ') || 'nessun bersaglio') + '.', a.heal ? 'cura' : 'danno');
        return null;
      }
      case 'ricompensa': applyReward(a, ctx); return null;
      case 'variabile': {
        const cur = ex.variables[a.name];
        if (a.op === 'incrementa') ex.variables[a.name] = (Number(cur) || 0) + (Number(a.value) || 0);
        else ex.variables[a.name] = a.value === 'vero' ? true : a.value === 'falso' ? false : a.value;
        ctx.log('🔣 Variabile «' + a.name + '» = ' + ex.variables[a.name] + '.', 'variabile');
        return null;
      }
      case 'tabella': {
        const roll = DnD.dadi.rollExpr(a.dice, ctx.rng);
        const v = roll ? roll.total : 0;
        const row = a.rows.find((r) => v >= r.min && v <= r.max);
        ctx.log('🎲 Tabella ' + a.dice + ' = ' + v + (row ? ': ' + (row.label || 'righe ' + row.min + '–' + row.max) : ': nessuna riga') + '.', 'tabella');
        return row ? row.actions : null;
      }
      case 'riposo': {
        // Il riposo dell'esplorazione (esplorazione.rest con riposi.js): tempo, scorte, PF, dadi vita, risorse, sfinimento.
        if (ctx.rest) { const r = ctx.rest(a.long ? 'lungo' : 'breve'); if (!r.ok) ctx.log('⚠ Riposo: ' + r.reason + '.', 'avviso'); return null; }
        ctx.advance(a.long ? 8 : 1);
        ctx.log('🛏 Riposo ' + (a.long ? 'lungo' : 'breve') + '.', 'riposo');
        return null;
      }
      case 'ambiente': {
        if (a.biomeId) ctx.setBiome(a.biomeId, a.radius);
        if (a.weather) { ex.weather = { id: '', name: a.weather, visibility: 0, dc: 0 }; }
        if (a.hour !== null) { const add = (a.hour - ex.time.hour + 24) % 24; ctx.advance(add); }
        ctx.log('🌦 Ambiente: ' + [a.biomeId ? 'bioma cambiato' + (a.radius ? ' (raggio ' + a.radius + ')' : '') : '', a.weather ? 'meteo «' + a.weather + '»' : '', a.hour !== null ? 'ora ' + a.hour + ':00' : ''].filter(Boolean).join(', ') + '.', 'ambiente');
        return null;
      }
      case 'teletrasporto': {
        let to = a.to;
        if (a.eventId) {
          const f = ctx.findEvent(a.eventId);
          if (f && f.inst) to = f.inst.cells[0];
          else { ctx.log('⚠ Teletrasporto: evento di destinazione mancante.', 'avviso'); return null; }
        }
        ctx.teleport(to);
        ctx.log('✨ Il gruppo viene trasportato in ' + DnD.griglia.cellLabel(to.x, to.y) + '.', 'teletrasporto');
        return null;
      }
      case 'attiva': {
        const f = ctx.findEvent(a.eventId);
        if (!f) { ctx.log('⚠ Evento collegato mancante.', 'avviso'); return null; }
        if (depth >= MAX_DEPTH) { ctx.log('⚠ Troppi eventi collegati in catena: interrotto.', 'avviso'); return null; }
        const ev = f.inst ? f.inst.event : f.template;
        if (f.inst) {
          const can = canFire(f.inst, ctx);
          if (!can.ok) { ctx.log('↪ «' + ev.name + '» non scatta: ' + can.reason + '.', 'avviso'); return null; }
          markFired(f.inst, ctx.now(), 'attivato da un altro evento');
        }
        ctx.log('↪ Attiva «' + ev.name + '».', 'evento');
        if (ev.readText) out.texts.push({ title: ev.name, text: interpolate(ev.readText, ex.variables) });
        return ev.actions;
      }
      case 'mappa': {
        const msg = ctx.enterMap(a.gridId, a.entry);
        ctx.log(msg, msg.startsWith('⚠') ? 'avviso' : 'mappa');
        return null;
      }
      case 'reputazione': {
        if (!ctx.reputation) { ctx.log('⚠ Reputazione: non disponibile qui.', 'avviso'); return null; }
        const e = ctx.reputation(a.factionId, a.delta, a.reason || 'evento');
        const f = (ctx.st.factions || []).find((x) => x.id === a.factionId);
        ctx.log(f ? '⚑ Reputazione con «' + f.name + '»: ' + (e ? (e.delta > 0 ? '+' : '') + e.delta + ' (' + e.after + ')' : 'invariata') + '.' : '⚠ Reputazione: fazione eliminata.', 'reputazione');
        return null;
      }
      case 'quest': {
        if (!ctx.quest) { ctx.log('⚠ Quest: non disponibile qui.', 'avviso'); return null; }
        for (const l of ctx.quest(a.op, a.questId, a.objectiveId, a.n)) ctx.log(l, 'quest');
        return null;
      }
      case 'combattimento': {
        const missing = a.foes.filter((f) => !ctx.st.npcs.some((n) => n.id === f.npcId));
        if (missing.length) ctx.log('⚠ Combattimento: ' + missing.length + ' creature non più presenti (saltate).', 'avviso');
        out.pause = { action: a, rest: [] };
        ctx.log('⚔ Combattimento: ' + (a.start === 'avvia' ? 'avvio' : 'preparazione') + '.', 'combattimento');
        return null;
      }
      default: return null;
    }
  }

  function markFired(inst, nowHours, outcome) {
    inst.state.fired += 1;
    inst.state.lastHours = nowHours;
    if (outcome) inst.state.outcomes = inst.state.outcomes.concat(outcome).slice(-20);
  }

  // Riferimenti mancanti di un evento (creature, griglie, oggetti, biomi, eventi): elenco di messaggi.
  function missingRefs(ev, st, gridIds) {
    const out = [];
    const grids = new Set(gridIds || (st.savedGrids || []).map((g) => g.id));
    const visit = (list) => {
      for (const a of list) {
        if (a.kind === 'combattimento') {
          for (const f of a.foes) if (!st.npcs.some((n) => n.id === f.npcId)) out.push('creatura eliminata in «' + ACTION_NAMES[a.kind] + '»');
          if (a.gridId && !grids.has(a.gridId)) out.push('griglia di battaglia eliminata');
        }
        if (a.kind === 'mappa' && a.gridId && !grids.has(a.gridId)) out.push('mappa collegata eliminata');
        if (a.kind === 'ricompensa' || (a.kind === 'testo' && a.reward)) for (const it of (a.reward || a).items || []) if (!st.equipment.some((e) => e.id === it.equipmentId)) out.push('oggetto eliminato dall\'Attrezzatura');
        if (a.kind === 'ambiente' && a.biomeId && !(st.biomes || []).some((b) => b.id === a.biomeId)) out.push('bioma eliminato');
        if (a.kind === 'reputazione' && a.factionId && st.factions && !st.factions.some((f) => f.id === a.factionId)) out.push('fazione eliminata');
        if (a.kind === 'quest' && a.questId && st.quests && !st.quests.some((q) => q.id === a.questId)) out.push('quest eliminata');
        if (a.kind === 'prova') { visit(a.success); visit(a.failure); }
        if (a.kind === 'tabella') for (const r of a.rows) visit(r.actions);
      }
    };
    visit(ev.actions);
    for (const c of ev.conditions) if (c.kind === 'oggetto' && !st.equipment.some((e) => e.id === c.equipmentId)) out.push('oggetto della condizione eliminato');
    return [...new Set(out)];
  }

  // Id di elementi delle librerie usati dalle azioni (per l'esportazione della sessione).
  function refs(ev) {
    const out = { npcs: new Set(), equipment: new Set(), biomes: new Set(), events: new Set(), grids: new Set() };
    const visit = (list) => {
      for (const a of list) {
        if (a.kind === 'combattimento') { a.foes.forEach((f) => out.npcs.add(f.npcId)); if (a.gridId) out.grids.add(a.gridId); }
        if (a.kind === 'mappa' && a.gridId) out.grids.add(a.gridId);
        if (a.kind === 'ricompensa' || (a.kind === 'testo' && a.reward)) ((a.reward || a).items || []).forEach((x) => out.equipment.add(x.equipmentId));
        if (a.kind === 'ambiente' && a.biomeId) out.biomes.add(a.biomeId);
        if (a.kind === 'attiva' && a.eventId) out.events.add(a.eventId);
        if (a.kind === 'prova') { visit(a.success); visit(a.failure); }
        if (a.kind === 'tabella') a.rows.forEach((r) => visit(r.actions));
      }
    };
    visit(ev.actions);
    ev.conditions.forEach((c) => { if (c.kind === 'oggetto') out.equipment.add(c.equipmentId); if (c.kind === 'bioma') out.biomes.add(c.biomeId); });
    return out;
  }

  // ---------- Esempi originali ----------
  function examples() {
    const ic = (icon, color) => ({ kind: 'library', icon, color });
    return [
      { id: 'evento-trappola-nascosta', name: 'Trappola nascosta', icon: ic('trappola', '#d4453a'),
        description: 'Un filo teso tra due radici fa scattare una pioggia di aghi.', readText: 'Un clic secco sotto i piedi: dal fogliame schizzano aghi sottili.',
        trigger: { kind: 'entrata' }, visibility: { kind: 'scoperta', dc: 14, skill: 'Percezione', who: 'migliore' }, repeat: { kind: 'una' },
        actions: [{ kind: 'danno', dice: '2d6', type: 'perforante', save: { what: 'DES', dc: 13, half: true } }] },
      { id: 'evento-viandante', name: 'Incontro con un viandante', icon: ic('umano', '#4f8fd6'),
        description: 'Un venditore ambulante con un mulo carico.', readText: 'Un uomo anziano con un mulo vi saluta alzando un bastone: «Notizie dalla strada, in cambio di un po\' di compagnia?»',
        trigger: { kind: 'entrata' }, repeat: { kind: 'una' },
        actions: [{ kind: 'prova', what: 'Persuasione', dc: 12, who: 'migliore',
          success: [{ kind: 'testo', text: 'Il viandante vi indica un guado sicuro e vi regala una pozione.', reward: { items: [] } }, { kind: 'variabile', name: 'guado noto', op: 'imposta', value: 'vero' }],
          failure: [{ kind: 'testo', text: 'Il viandante borbotta e riprende la sua strada.' }] }] },
      { id: 'evento-tempesta', name: 'Tempesta improvvisa', icon: ic('elementale-aria', '#8a8f9c'),
        description: 'Il cielo si chiude in pochi minuti.', readText: 'Il vento cambia di colpo e la pioggia arriva a scrosci.',
        trigger: { kind: 'tempo', hours: 12 }, repeat: { kind: 'sempre', cooldown: 24 },
        actions: [{ kind: 'ambiente', weather: 'Tempesta' }, { kind: 'prova', what: 'Sopravvivenza', dc: 12, who: 'migliore',
          success: [{ kind: 'nota', text: 'Il gruppo trova riparo in tempo.' }],
          failure: [{ kind: 'danno', dice: '1d4', type: 'freddo' }, { kind: 'nota', text: 'Il gruppo è fradicio e infreddolito.' }] }] },
      { id: 'evento-ingresso-dungeon', name: 'Ingresso di un dungeon', icon: ic('porta', '#8b5a2b'),
        description: 'Una porta di pietra semisepolta. Collega una mappa con l\'azione «Entra in una mappa».', readText: 'Tra i rovi spunta un arco di pietra con gradini che scendono nel buio.',
        trigger: { kind: 'interazione' }, repeat: { kind: 'sempre' },
        actions: [{ kind: 'testo', text: 'Collega qui la mappa del dungeon (modifica l\'azione «Entra in una mappa»).' }, { kind: 'mappa', gridId: '', entry: { x: 1, y: 1 } }] },
      { id: 'evento-passaggio-atletica', name: 'Passaggio con prova di Atletica', icon: ic('gigante', '#8a8f9c'),
        description: 'Un torrente in piena o una parete da scalare.', readText: 'La via prosegue oltre un salto di roccia bagnata.',
        trigger: { kind: 'entrata' }, repeat: { kind: 'sempre' },
        actions: [{ kind: 'prova', what: 'Atletica', dc: 13, who: 'gruppo', group: true,
          success: [{ kind: 'nota', text: 'Il gruppo supera il passaggio.' }],
          failure: [{ kind: 'danno', dice: '1d6', type: 'contundente' }, { kind: 'nota', text: 'Qualcuno scivola: si perde un\'ora.' }] }] },
      { id: 'evento-tesoro-chiave', name: 'Tesoro con chiave', icon: ic('forziere', '#c9a227'),
        description: 'Un forziere che si apre solo se un altro evento ha impostato la variabile «chiave trovata».', readText: 'Un forziere cerchiato di ferro, con una serratura a forma di corvo.',
        trigger: { kind: 'interazione' }, repeat: { kind: 'una' },
        conditions: [{ kind: 'variabile', name: 'chiave trovata', op: '=', value: 'true' }],
        actions: [{ kind: 'testo', text: 'La chiave gira: dentro, monete e una mappa ingiallita.' }, { kind: 'ricompensa', xp: 100, coins: { mo: 50 } }] },
      { id: 'evento-sopravvivenza', name: 'Tiro di sopravvivenza', icon: ic('albero-antico', '#3fae63'),
        description: 'Cercare cibo e acqua lungo la strada.', readText: 'Le scorte scarseggiano: qualcuno prova a cercare frutti e sorgenti.',
        trigger: { kind: 'interazione' }, repeat: { kind: 'sempre', cooldown: 8 },
        actions: [{ kind: 'prova', what: 'Sopravvivenza', dc: 12, who: 'migliore',
          success: [{ kind: 'nota', text: 'Trovate scorte per un giorno.' }, { kind: 'variabile', name: 'foraggiamenti', op: 'incrementa', value: 1 }],
          failure: [{ kind: 'nota', text: 'Nessuna risorsa trovata.' }] }] },
      { id: 'evento-predoni', name: 'Banda di predoni', icon: ic('ladro', '#d4453a'),
        description: 'Un gruppo armato sbarra la strada. Scegli le creature nell\'azione «Combattimento».', readText: '«Fermi lì! Il pedaggio è tutto quello che avete.»',
        trigger: { kind: 'entrata' }, repeat: { kind: 'una' },
        actions: [{ kind: 'prova', what: 'Intimidire', dc: 15, who: 'migliore',
          success: [{ kind: 'testo', text: 'I predoni si guardano e si ritirano tra gli alberi.' }],
          failure: [{ kind: 'combattimento', foes: [], start: 'prepara' }, { kind: 'nota', text: 'Scontro con i predoni concluso.' }] }] },
    ].map(normalizeEvent);
  }

  DnD.eventi = {
    TRIGGERS, TRIGGER_NAMES, VISIBILITY, VISIBILITY_NAMES, REPEATS, REPEAT_NAMES, COND_KINDS, COND_NAMES, OPS, ACTIONS, ACTION_NAMES, WHO, WHO_NAMES, COINS, QUEST_OPS, QUEST_OP_NAMES,
    normalizeEvent, normalizeAction, normalizeCondition, normalizeReward, normalizeInstance, instantiate, updateFromTemplate,
    inCells, isVisible, memberBonus, resolveCheck, compare, conditionsMet, canFire, movementTriggers, timeTriggers, tryDiscover,
    interpolate, run, markFired, missingRefs, refs, examples,
  };
})(globalThis.DnD = globalThis.DnD || {});
