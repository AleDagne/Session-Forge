// Quest (logica pura). Una quest ha titolo, descrizione, datore (NPC o fazione), fazione, requisiti
// (reputazione, livello, oggetto, evento), obiettivi con contatori (parla con, uccidi N creature, raccogli
// oggetti, raggiungi un luogo, completa un evento), tempo limite facoltativo e ricompense (PE, monete, oggetti,
// reputazione, sblocco di quest e negozi). Lo stato vive nel diario della sessione (world.quests):
// Disponibile, Attiva, Completata, Fallita, Scaduta, con l'avanzamento degli obiettivi. I giocatori vedono solo
// le quest offerte e accettate. Eventi e combattimento avanzano gli obiettivi; la consegna restituisce le
// ricompense da distribuire (con conferma del master).
(function (DnD) {
  'use strict';

  const K = () => DnD.mondoDati;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => { const n = num(v, def, lo, hi); return n === null ? null : Math.round(n); };
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const ID = /^[\w-]{1,64}$/;
  const idOf = (v) => (typeof v === 'string' && ID.test(v) ? v : DnD.dadi.uid());
  const refId = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
  const ids = (v, max) => [...new Set(arr(v).filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, max || 50);
  const lower = (s) => String(s || '').toLowerCase();

  function normalizeObjective(o) {
    o = obj(o);
    const kind = pick(o.kind, K().OBJECTIVES, 'parla');
    return {
      id: idOf(o.id), kind, text: str(o.text, 200),
      npcId: refId(o.npcId),                    // parla con
      creature: str(o.creature, 60),            // uccidi: nome o tipo (es. «goblin», «non morto»)
      npcSourceId: refId(o.npcSourceId),        // uccidi: un nemico preciso della libreria
      equipmentId: refId(o.equipmentId),        // raccogli
      gridId: refId(o.gridId), x: int(o.x, 0, 0, 99), y: int(o.y, 0, 0, 99), place: str(o.place, 80), // raggiungi
      eventId: refId(o.eventId),                // completa un evento
      count: int(o.count, 1, 1, 9999),
      optional: Boolean(o.optional),
    };
  }
  function normalizeRequirement(r) {
    r = obj(r);
    return { kind: pick(r.kind, K().REQUIREMENTS, 'reputazione'), factionId: refId(r.factionId), min: int(r.min, 0, -100, 100), level: int(r.level, 1, 1, 40), equipmentId: refId(r.equipmentId), eventId: refId(r.eventId) };
  }
  function normalizeRewards(r) {
    r = obj(r);
    return Object.assign(DnD.eventi.normalizeReward(r), {
      reputation: arr(r.reputation).slice(0, 10).map((x) => ({ factionId: refId(obj(x).factionId), delta: int(obj(x).delta, 10, -100, 100) })).filter((x) => x.factionId),
      unlockQuestIds: ids(r.unlockQuestIds, 10),
      unlockMerchantIds: ids(r.unlockMerchantIds, 10),
    });
  }
  function normalizeQuest(q) {
    q = obj(q);
    const g = obj(q.giver);
    return {
      id: idOf(q.id),
      title: str(q.title, 80) || 'Quest',
      description: str(q.description, 5000),
      giver: { npcId: refId(g.npcId), factionId: refId(g.factionId) },
      factionId: refId(q.factionId),
      requirements: arr(q.requirements).slice(0, 8).map(normalizeRequirement),
      objectives: arr(q.objectives).slice(0, 20).map(normalizeObjective),
      timeLimit: q.timeLimit === null || q.timeLimit === undefined || q.timeLimit === '' ? null : num(q.timeLimit, null, 1, 100000), // ore di gioco
      rewards: normalizeRewards(q.rewards),
      // Eventi da attivare all'accettazione e al completamento (le quest possono attivare eventi).
      onAccept: refId(q.onAccept), onComplete: refId(q.onComplete),
      offerText: str(q.offerText, 2000), completeText: str(q.completeText, 2000),
      hidden: q.hidden !== false, // non compare ai giocatori finché non è offerta
      notes: str(q.notes, 5000),
      sessionId: typeof q.sessionId === 'string' ? q.sessionId.slice(0, 64) : '',
      shared: Boolean(q.shared),
    };
  }

  // Voce del diario: stato e avanzamento di una quest nella sessione.
  function normalizeEntry(e) {
    e = obj(e);
    const progress = {};
    for (const [k, v] of Object.entries(obj(e.progress))) if (ID.test(k)) progress[k] = int(v, 0, 0, 9999);
    return {
      status: pick(e.status, K().QUEST_STATES, 'disponibile'),
      offered: Boolean(e.offered),
      unlocked: Boolean(e.unlocked),
      partyId: refId(e.partyId),
      acceptedAt: e.acceptedAt === null || e.acceptedAt === undefined ? null : num(e.acceptedAt, null, 0, 1e9),
      deadline: e.deadline === null || e.deadline === undefined ? null : num(e.deadline, null, 0, 1e9),
      endedAt: e.endedAt === null || e.endedAt === undefined ? null : num(e.endedAt, null, 0, 1e9),
      progress,
      rewarded: Boolean(e.rewarded),
    };
  }
  function normalizeJournal(j) {
    const out = {};
    for (const [k, v] of Object.entries(obj(j))) if (ID.test(k)) out[k] = normalizeEntry(v);
    return out;
  }
  const entryOf = (journal, questId) => journal[questId] || (journal[questId] = normalizeEntry({}));
  const statusOf = (journal, questId) => (journal[questId] ? journal[questId].status : 'disponibile');

  // ---------- Requisiti e accesso ----------
  // ctx: { rep(factionId), level (massimo del party), hasItem(id), eventDone(id), blockHostile }
  function requirementsMet(q, ctx) {
    const missing = [];
    for (const r of q.requirements) {
      if (r.kind === 'reputazione' && ctx.rep(r.factionId) < r.min) missing.push('reputazione ' + r.min);
      if (r.kind === 'livello' && (ctx.level || 0) < r.level) missing.push('livello ' + r.level);
      if (r.kind === 'oggetto' && !ctx.hasItem(r.equipmentId)) missing.push('oggetto richiesto');
      if (r.kind === 'evento' && !ctx.eventDone(r.eventId)) missing.push('evento da completare');
    }
    // Quest di una fazione ostile: bloccata (se la regola è attiva).
    if (q.factionId && !DnD.fazioni.hasAccess(ctx.rep(q.factionId), ctx.blockHostile)) missing.push('fazione ostile');
    return { ok: !missing.length, missing };
  }

  // ---------- Transizioni ----------
  function offer(journal, q) {
    const e = entryOf(journal, q.id);
    e.offered = true;
    return e;
  }
  function accept(journal, q, nowHours, partyId) {
    const e = entryOf(journal, q.id);
    if (e.status !== 'disponibile') return null;
    Object.assign(e, { status: 'attiva', offered: true, partyId: partyId || '', acceptedAt: nowHours || 0, deadline: q.timeLimit ? (nowHours || 0) + q.timeLimit : null });
    return e;
  }
  function setStatus(journal, q, status, nowHours) {
    const e = entryOf(journal, q.id);
    e.status = pick(status, K().QUEST_STATES, e.status);
    if (['completata', 'fallita', 'scaduta'].includes(e.status)) e.endedAt = nowHours || 0;
    return e;
  }
  const fail = (journal, q, nowHours) => setStatus(journal, q, 'fallita', nowHours);

  // Obiettivo completato?
  const objectiveDone = (e, o) => (e.progress[o.id] || 0) >= o.count;
  const allDone = (q, e) => q.objectives.filter((o) => !o.optional).every((o) => objectiveDone(e, o));

  // Avanza gli obiettivi che corrispondono (kind e predicato). Restituisce le righe per il log.
  function advance(journal, quests, kind, match, n) {
    const lines = [];
    for (const q of arr(quests)) {
      const e = journal[q.id];
      if (!e || e.status !== 'attiva') continue;
      for (const o of q.objectives) {
        if (o.kind !== kind || objectiveDone(e, o) || !match(o)) continue;
        e.progress[o.id] = Math.min(o.count, (e.progress[o.id] || 0) + (n || 1));
        lines.push('📜 «' + q.title + '»: ' + objectiveText(o) + ' ' + e.progress[o.id] + '/' + o.count + (objectiveDone(e, o) ? ' ✓' : '') + '.');
      }
      if (allDone(q, e)) lines.push('📜 «' + q.title + '»: tutti gli obiettivi completati, da consegnare.');
    }
    return lines;
  }
  // Uccisione di un combattente: per nome, tipo di creatura o nemico preciso della libreria.
  function onKill(journal, quests, victim) {
    const name = lower(victim.name).replace(/\s+\d+$/, '');
    const ctype = lower(victim.creature && victim.creature.ctype);
    return advance(journal, quests, 'uccidi', (o) => {
      if (o.npcSourceId) return o.npcSourceId === victim.sourceId;
      const want = lower(o.creature);
      return Boolean(want) && (name.includes(want) || (ctype && ctype.includes(want)));
    }, 1);
  }
  const onTalk = (journal, quests, npcId) => advance(journal, quests, 'parla', (o) => o.npcId === npcId, 1);
  const onEvent = (journal, quests, eventId) => advance(journal, quests, 'evento', (o) => o.eventId === eventId, 1);
  const onReach = (journal, quests, gridId, x, y) => advance(journal, quests, 'raggiungi', (o) => o.gridId === gridId && o.x === x && o.y === y, 1);
  // Raccogli: il conteggio è quello posseduto (si ricalcola, non si somma).
  function onCollect(journal, quests, countOf) {
    const lines = [];
    for (const q of arr(quests)) {
      const e = journal[q.id];
      if (!e || e.status !== 'attiva') continue;
      for (const o of q.objectives.filter((x) => x.kind === 'raccogli' && x.equipmentId)) {
        const have = Math.min(o.count, countOf(o.equipmentId));
        if (have !== (e.progress[o.id] || 0)) { e.progress[o.id] = have; lines.push('📜 «' + q.title + '»: ' + objectiveText(o) + ' ' + have + '/' + o.count + '.'); }
      }
    }
    return lines;
  }

  // Scadenza: le quest attive oltre il tempo limite diventano Scadute.
  function expire(journal, quests, nowHours) {
    const out = [];
    for (const q of arr(quests)) {
      const e = journal[q.id];
      if (e && e.status === 'attiva' && e.deadline !== null && nowHours > e.deadline) { setStatus(journal, q, 'scaduta', nowHours); out.push(q); }
    }
    return out;
  }

  // Consegna: completa la quest e restituisce le ricompense da distribuire (la UI chiede conferma al master).
  function complete(journal, q, nowHours, force) {
    const e = entryOf(journal, q.id);
    if (e.status !== 'attiva') return { ok: false, reason: 'la quest non è attiva' };
    if (!force && !allDone(q, e)) return { ok: false, reason: 'obiettivi non completati' };
    setStatus(journal, q, 'completata', nowHours);
    for (const id of q.rewards.unlockQuestIds) entryOf(journal, id).unlocked = true;
    return { ok: true, rewards: q.rewards };
  }

  function objectiveText(o) {
    if (o.text) return o.text;
    if (o.kind === 'uccidi') return 'uccidi ' + (o.creature || 'creature');
    if (o.kind === 'raccogli') return 'raccogli oggetti';
    if (o.kind === 'parla') return 'parla con l\'NPC';
    if (o.kind === 'raggiungi') return 'raggiungi ' + (o.place || DnD.griglia.cellLabel(o.x, o.y));
    return 'completa l\'evento';
  }

  // Diario: filtro per testo, fazione e stato.
  function journalList(quests, journal, filter) {
    const f = filter || {};
    return arr(quests).filter((q) => {
      const s = statusOf(journal, q.id);
      if (f.status && f.status !== s) return false;
      if (f.factionId && q.factionId !== f.factionId && q.giver.factionId !== f.factionId) return false;
      if (f.text && !lower(q.title + ' ' + q.description).includes(lower(f.text))) return false;
      return true;
    });
  }

  // Vista dei giocatori: solo le quest offerte e accettate (mai note e obiettivi nascosti).
  function perGiocatore(quests, journal) {
    return arr(quests).filter((q) => journal[q.id] && journal[q.id].offered && journal[q.id].status !== 'disponibile').map((q) => {
      const e = journal[q.id];
      return { id: q.id, title: q.title, description: q.description, status: e.status,
        objectives: q.objectives.map((o) => ({ text: objectiveText(o), done: objectiveDone(e, o), progress: e.progress[o.id] || 0, count: o.count })) };
    });
  }

  function missingRefs(q, st, world) {
    const out = [];
    const has = (list, id) => arr(list).some((x) => x.id === id);
    if (q.giver.npcId && world && !has(world.npcs, q.giver.npcId)) out.push('datore eliminato');
    if (q.factionId && world && !has(world.factions, q.factionId)) out.push('fazione eliminata');
    for (const o of q.objectives) {
      if (o.kind === 'raccogli' && o.equipmentId && !has(st.equipment, o.equipmentId)) out.push('oggetto da raccogliere eliminato');
      if (o.kind === 'parla' && o.npcId && world && !has(world.npcs, o.npcId)) out.push('NPC dell\'obiettivo eliminato');
      if (o.kind === 'uccidi' && o.npcSourceId && !has(st.npcs, o.npcSourceId)) out.push('creatura dell\'obiettivo eliminata');
      if (o.kind === 'evento' && o.eventId && !has(st.events, o.eventId)) out.push('evento dell\'obiettivo eliminato');
    }
    for (const it of q.rewards.items) if (!has(st.equipment, it.equipmentId)) out.push('oggetto della ricompensa eliminato');
    return [...new Set(out)];
  }

  DnD.quest = {
    normalizeQuest, normalizeObjective, normalizeRewards, normalizeEntry, normalizeJournal, entryOf, statusOf, requirementsMet,
    offer, accept, setStatus, fail, objectiveDone, allDone, advance, onKill, onTalk, onEvent, onReach, onCollect, expire, complete,
    objectiveText, journalList, perGiocatore, missingRefs,
  };
})(globalThis.DnD = globalThis.DnD || {});
