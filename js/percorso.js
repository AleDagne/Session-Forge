// Percorso leggendario (logica pura): mappa di nodi collegati attorno al Nucleo (sempre sbloccato). Un nodo si
// sblocca se è collegato a un nodo già sbloccato (o, con «tutti i prerequisiti», se lo sono tutti quelli
// elencati), se il rango leggendario basta, se i punti bastano e se non è escluso da un nodo già preso.
// Effetti dei nodi (bonus, competenze, magie, slot, privilegi creati dall'utente, trasformazioni, testo),
// modifiche al grafo (aggiungi, collega, scollega, elimina, duplica), validazione (irraggiungibili, cicli di
// esclusività), disposizione a raggiera, cronologia per annulla/ripeti, percorso d'esempio originale.
(function (DnD) {
  'use strict';

  const EFFECTS = ['caratteristica', 'competenza', 'bonus', 'magia', 'slot', 'privilegio', 'trasformazione', 'testo'];
  const EFFECT_NAMES = {
    caratteristica: 'Bonus caratteristica', competenza: 'Competenza', bonus: 'Bonus numerico', magia: 'Nuova magia', slot: 'Slot extra',
    privilegio: 'Privilegio (creato da te)', trasformazione: 'Sblocca trasformazione', testo: 'Solo testo',
  };
  const STATS = ['pf', 'ca', 'velocita', 'iniziativa', 'attacco', 'danno', 'cd', 'attaccoMagia', 'competenza', 'resistenza', 'immunita', 'senso'];
  const STAT_NAMES = {
    pf: 'PF massimi', ca: 'CA', velocita: 'Velocità (m)', iniziativa: 'Iniziativa', attacco: 'Bonus attacco', danno: 'Bonus danno',
    cd: 'CD incantesimi', attaccoMagia: 'Attacco con incantesimi', competenza: 'Bonus competenza', resistenza: 'Resistenza', immunita: 'Immunità', senso: 'Senso',
  };
  const SENSES = ['scurovisione', 'vista cieca', 'vista pura', 'percezione tellurica'];
  const PROF_TARGETS = ['ts', 'abilita', 'altro'];
  const FEATURE_TYPES = ['passivo', 'azione', 'bonus', 'reazione'];
  const FEATURE_TYPE_NAMES = { passivo: 'Passivo', azione: 'Azione', bonus: 'Azione bonus', reazione: 'Reazione' };
  const USES = ['volonta', 'breve', 'lungo'];
  const USES_NAMES = { volonta: 'A volontà', breve: 'per riposo breve', lungo: 'per riposo lungo' };
  const CORE_ID = 'nucleo';
  const MAX_NODES = 200;
  const MAX_RANK = 20;

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, def, lo, hi) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const int = (v, def, lo, hi) => Math.round(num(v, def, lo, hi));
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => DnD.dadi.uid();
  const HEX = /^#[0-9a-f]{6}$/i;
  const AB = () => DnD.regole.ABILITIES;

  function normalizeEffect(e) {
    e = obj(e);
    const kind = pick(e.kind, EFFECTS, 'testo');
    const out = { id: str(e.id, 64) || uid(), kind };
    if (kind === 'caratteristica') Object.assign(out, { ability: pick(e.ability, AB(), 'FOR'), value: int(e.value, 1, -10, 10) });
    else if (kind === 'competenza') Object.assign(out, {
      target: pick(e.target, PROF_TARGETS, 'ts'), ability: pick(e.ability, AB(), 'FOR'),
      skill: DnD.creatureDati.SKILLS[e.skill] ? e.skill : 'Atletica', expertise: Boolean(e.expertise), text: str(e.text, 80),
    });
    else if (kind === 'bonus') Object.assign(out, {
      stat: pick(e.stat, STATS, 'pf'), value: int(e.value, 1, -100, 1000),
      damageType: DnD.creatureDati.DEFENSE_TYPES.includes(e.damageType) ? e.damageType : 'fuoco', sense: pick(e.sense, SENSES, 'scurovisione'),
    });
    else if (kind === 'magia') Object.assign(out, { spellId: str(e.spellId, 64), freq: e.freq === 'giorno' ? 'giorno' : 'sempre', uses: int(e.uses, 1, 1, 20) });
    else if (kind === 'slot') Object.assign(out, { level: int(e.level, 1, 1, 9), count: int(e.count, 1, 1, 9) });
    else if (kind === 'privilegio') {
      const u = obj(e.uses);
      Object.assign(out, {
        name: str(e.name, 80) || 'Privilegio', desc: str(e.desc, 3000), type: pick(e.type, FEATURE_TYPES, 'passivo'),
        uses: { kind: pick(u.kind, USES, 'volonta'), n: int(u.n, 1, 1, 20) },
        mech: DnD.creature.normalizeMech(e.mech || { kind: 'testo' }),
      });
    } else if (kind === 'trasformazione') Object.assign(out, { transformationId: str(e.transformationId, 64) });
    else Object.assign(out, { text: str(e.text, 2000) });
    return out;
  }

  function normalizeNode(n, i) {
    n = obj(n);
    const core = n.id === CORE_ID || Boolean(n.core);
    return {
      id: core ? CORE_ID : str(n.id, 64) || uid(),
      core,
      name: str(n.name, 60) || (core ? 'Nucleo' : 'Nodo ' + ((i || 0) + 1)),
      icon: DnD.icone.normalizeIcon(n.icon || { kind: 'shape', shape: core ? 'stella' : 'esagono', color: '#c9a227' }, false),
      description: str(n.description, 3000),
      cost: core ? 0 : int(n.cost, 1, 1, 5),
      minRank: core ? 0 : int(n.minRank, 0, 0, MAX_RANK),
      category: str(n.category, 40),
      color: HEX.test(n.color) ? n.color.toLowerCase() : '#c9a227',
      x: num(n.x, 0, -10000, 10000), y: num(n.y, 0, -10000, 10000),
      effects: arr(n.effects).slice(0, 12).map(normalizeEffect),
      exclusiveWith: str(n.exclusiveWith, 64),
      requires: arr(n.requires).filter((x) => typeof x === 'string').slice(0, 10),
      requireAll: Boolean(n.requireAll),
    };
  }

  // Percorso: { nodes, links: [[a, b]] } con il Nucleo sempre presente; collegamenti unici e validi.
  function normalizePath(p) {
    p = obj(p);
    const nodes = arr(p.nodes).slice(0, MAX_NODES).map(normalizeNode);
    const seen = new Set();
    const unique = nodes.filter((n) => !seen.has(n.id) && seen.add(n.id));
    if (!unique.some((n) => n.core)) unique.unshift(normalizeNode({ id: CORE_ID, core: true }));
    const ids = new Set(unique.map((n) => n.id));
    const keys = new Set();
    const links = arr(p.links).map((l) => (Array.isArray(l) ? [str(l[0], 64), str(l[1], 64)] : null))
      .filter((l) => l && l[0] !== l[1] && ids.has(l[0]) && ids.has(l[1]))
      .filter((l) => { const k = l.slice().sort().join('|'); return !keys.has(k) && keys.add(k); });
    for (const n of unique) {
      if (n.exclusiveWith && (!ids.has(n.exclusiveWith) || n.exclusiveWith === n.id)) n.exclusiveWith = '';
      n.requires = n.requires.filter((r) => ids.has(r) && r !== n.id);
    }
    return { name: str(p.name, 80) || 'Percorso leggendario', nodes: unique, links };
  }

  const nodeById = (path, id) => path.nodes.find((n) => n.id === id) || null;
  const neighbors = (path, id) => path.links.filter((l) => l[0] === id || l[1] === id).map((l) => (l[0] === id ? l[1] : l[0]));
  const linked = (path, a, b) => path.links.some((l) => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a));
  const withCore = (unlocked) => [...new Set([CORE_ID].concat(unlocked || []))];

  // ---------- Punti e sblocco ----------
  const pointsTotal = (rank, bonus) => Math.min(MAX_RANK, Math.max(0, rank || 0)) + Math.max(0, bonus || 0);
  const pointsSpent = (path, unlocked) => withCore(unlocked).reduce((s, id) => { const n = nodeById(path, id); return s + (n ? n.cost : 0); }, 0);

  // { ok, reason } per sbloccare il nodo con lo stato attuale.
  function canUnlock(path, unlocked, nodeId, ctx) {
    const n = nodeById(path, nodeId);
    const have = new Set(withCore(unlocked));
    if (!n) return { ok: false, reason: 'nodo inesistente' };
    if (have.has(n.id)) return { ok: false, reason: 'già sbloccato' };
    if ((ctx.rank || 0) < n.minRank) return { ok: false, reason: 'serve il rango leggendario ' + n.minRank };
    const excl = path.nodes.find((x) => have.has(x.id) && (x.exclusiveWith === n.id || n.exclusiveWith === x.id));
    if (excl) return { ok: false, reason: 'esclusivo con «' + excl.name + '», già scelto' };
    if (n.requireAll && n.requires.length) {
      const miss = n.requires.filter((r) => !have.has(r));
      if (miss.length) return { ok: false, reason: 'mancano i prerequisiti: ' + miss.map((r) => (nodeById(path, r) || { name: r }).name).join(', ') };
    } else if (!neighbors(path, n.id).some((x) => have.has(x))) {
      return { ok: false, reason: 'non è collegato a un nodo sbloccato' };
    }
    const left = pointsTotal(ctx.rank, ctx.bonus) - pointsSpent(path, unlocked);
    if (left < n.cost) return { ok: false, reason: 'punti insufficienti (' + left + ' su ' + n.cost + ')' };
    return { ok: true, reason: '' };
  }
  function unlock(path, unlocked, nodeId, ctx) {
    const r = canUnlock(path, unlocked, nodeId, ctx);
    return r.ok ? { ok: true, unlocked: withCore(unlocked).concat(nodeId) } : Object.assign({ unlocked: withCore(unlocked) }, r);
  }
  // Rimodella: si torna al solo Nucleo e i punti tornano disponibili.
  const respec = () => [CORE_ID];
  // Nodi sbloccabili ora (per l'animazione della modalità Sblocca).
  const available = (path, unlocked, ctx) => path.nodes.filter((n) => canUnlock(path, unlocked, n.id, ctx).ok).map((n) => n.id);

  // ---------- Validazione ----------
  // Nodi non raggiungibili dal Nucleo seguendo i collegamenti.
  function unreachable(path) {
    const seen = new Set([CORE_ID]);
    const queue = [CORE_ID];
    while (queue.length) for (const x of neighbors(path, queue.shift())) if (!seen.has(x)) { seen.add(x); queue.push(x); }
    return path.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  }
  // Cicli di esclusività: catene A→B→C→…→A di tre o più nodi (la coppia A↔B è la normale scelta tra due rami).
  function exclusivityCycles(path) {
    const out = [];
    for (const start of path.nodes) {
      const seq = [start.id];
      let cur = start;
      while (cur && cur.exclusiveWith) {
        const next = nodeById(path, cur.exclusiveWith);
        if (!next) break;
        if (next.id === start.id) { if (seq.length >= 3) out.push(seq.slice()); break; }
        if (seq.includes(next.id)) break;
        seq.push(next.id);
        cur = next;
      }
    }
    const keys = new Set();
    return out.filter((c) => { const k = c.slice().sort().join('|'); return !keys.has(k) && keys.add(k); });
  }
  function validate(path) {
    const warnings = [];
    const lost = unreachable(path);
    if (lost.length) warnings.push('Nodi irraggiungibili dal Nucleo: ' + lost.map((id) => nodeById(path, id).name).join(', ') + '.');
    for (const c of exclusivityCycles(path)) warnings.push('Ciclo di esclusività: ' + c.map((id) => nodeById(path, id).name).join(' → ') + '.');
    for (const n of path.nodes) if (n.exclusiveWith && n.requires.includes(n.exclusiveWith) && n.requireAll) warnings.push('«' + n.name + '» richiede un nodo con cui è esclusivo: non si potrà mai sbloccare.');
    return warnings;
  }

  // ---------- Modifiche al grafo (restituiscono un nuovo percorso) ----------
  function addNode(path, fields) {
    const p = clone(path);
    const n = normalizeNode(Object.assign({ id: uid() }, fields), p.nodes.length);
    p.nodes.push(n);
    return { path: p, id: n.id };
  }
  function link(path, a, b) {
    if (a === b || linked(path, a, b) || !nodeById(path, a) || !nodeById(path, b)) return path;
    const p = clone(path);
    p.links.push([a, b]);
    return p;
  }
  function unlink(path, a, b) {
    const p = clone(path);
    p.links = p.links.filter((l) => !((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)));
    return p;
  }
  // Elimina nodi (mai il Nucleo) con i loro collegamenti, esclusività e prerequisiti.
  function removeNodes(path, ids) {
    const del = new Set(ids.filter((id) => id !== CORE_ID));
    const p = clone(path);
    p.nodes = p.nodes.filter((n) => !del.has(n.id));
    p.links = p.links.filter((l) => !del.has(l[0]) && !del.has(l[1]));
    for (const n of p.nodes) {
      if (del.has(n.exclusiveWith)) n.exclusiveWith = '';
      n.requires = n.requires.filter((r) => !del.has(r));
    }
    return p;
  }
  function duplicateNodes(path, ids, dx, dy) {
    const p = clone(path);
    const map = new Map();
    for (const id of ids) {
      const n = nodeById(p, id);
      if (!n || n.core) continue;
      const c = Object.assign(clone(n), { id: uid(), name: (n.name + ' (copia)').slice(0, 60), x: n.x + (dx || 40), y: n.y + (dy || 40) });
      c.effects.forEach((e) => { e.id = uid(); });
      map.set(id, c.id);
      p.nodes.push(c);
    }
    // I collegamenti tra nodi copiati si copiano anch'essi.
    for (const l of path.links) if (map.has(l[0]) && map.has(l[1])) p.links.push([map.get(l[0]), map.get(l[1])]);
    return { path: p, ids: [...map.values()] };
  }
  function moveNodes(path, ids, dx, dy, snap) {
    const p = clone(path);
    for (const n of p.nodes) if (ids.includes(n.id)) {
      n.x += dx;
      n.y += dy;
      if (snap) { n.x = Math.round(n.x / snap) * snap; n.y = Math.round(n.y / snap) * snap; }
    }
    return p;
  }
  // Disposizione automatica a raggiera: anelli concentrici per distanza (in collegamenti) dal Nucleo. Ogni ramo
  // dell'albero di visita riceve uno spicchio proporzionale alle sue foglie, così i figli stanno vicino al
  // genitore e i rami non si incrociano. I nodi irraggiungibili vanno su un anello esterno.
  function radialLayout(path, ring) {
    const p = clone(path);
    const step = ring || 190;
    const pos = (n, a, d) => { n.x = Math.round(Math.cos(a) * step * d); n.y = Math.round(Math.sin(a) * step * d); };
    const depth = new Map([[CORE_ID, 0]]);
    const children = new Map([[CORE_ID, []]]);
    const order = [CORE_ID];
    for (let i = 0; i < order.length; i++) {
      for (const x of neighbors(p, order[i])) {
        if (depth.has(x)) continue;
        depth.set(x, depth.get(order[i]) + 1);
        children.get(order[i]).push(x);
        children.set(x, []);
        order.push(x);
      }
    }
    const leaves = new Map();
    for (const id of [...order].reverse()) leaves.set(id, Math.max(1, children.get(id).reduce((s, x) => s + leaves.get(x), 0)));
    const place = (id, a0, a1) => {
      const n = nodeById(p, id);
      if (id === CORE_ID) { n.x = 0; n.y = 0; } else pos(n, (a0 + a1) / 2, depth.get(id));
      let a = a0;
      for (const x of children.get(id)) { const w = ((a1 - a0) * leaves.get(x)) / leaves.get(id); place(x, a, a + w); a += w; }
    };
    if (nodeById(p, CORE_ID)) place(CORE_ID, -Math.PI, Math.PI);
    const lost = p.nodes.filter((n) => !depth.has(n.id));
    const outer = Math.max(0, ...depth.values()) + 1;
    lost.forEach((n, i) => pos(n, (i / lost.length) * Math.PI * 2 - Math.PI / 2, outer));
    return p;
  }

  // Cronologia per l'editor (annulla/ripeti, 50 azioni).
  function history(limit) {
    const undo = [];
    const redo = [];
    const max = limit || 50;
    return {
      push(snap) { undo.push(clone(snap)); if (undo.length > max) undo.shift(); redo.length = 0; },
      undo(cur) { if (!undo.length) return null; redo.push(clone(cur)); return undo.pop(); },
      redo(cur) { if (!redo.length) return null; undo.push(clone(cur)); return redo.pop(); },
      canUndo: () => undo.length > 0, canRedo: () => redo.length > 0, clear() { undo.length = 0; redo.length = 0; },
    };
  }

  // Ricerca per nome, categoria o descrizione.
  const search = (path, q) => (q ? path.nodes.filter((n) => (n.name + ' ' + n.category + ' ' + n.description).toLowerCase().includes(q.toLowerCase())).map((n) => n.id) : []);

  // ---------- Modelli di percorso (libreria globale) ----------
  function normalizeTemplate(t) {
    t = obj(t);
    return { id: str(t.id, 64) || uid(), name: str(t.name, 80) || 'Modello di percorso', description: str(t.description, 1000), path: normalizePath(t.path) };
  }

  // Percorso d'esempio originale: 12 nodi attorno al Nucleo, due rami esclusivi e un ramo che richiede due nodi.
  function example() {
    const ic = (icon, color) => ({ kind: 'library', icon, color });
    const nodes = [
      { id: CORE_ID, core: true, name: 'Scintilla Eterna', description: 'Il punto in cui il mortale smette di esserlo.', icon: ic('lich', '#c9a227'), color: '#f2c94c' },
      { id: 'n-vigore', name: 'Vigore senza fine', cost: 1, category: 'Corpo', color: '#d4453a', description: 'Il corpo non conosce più la stanchezza.', icon: ic('barbaro', '#d4453a'),
        effects: [{ kind: 'bonus', stat: 'pf', value: 20 }, { kind: 'caratteristica', ability: 'COS', value: 2 }] },
      { id: 'n-passo', name: 'Passo del vento', cost: 1, category: 'Corpo', color: '#5cc8f0', description: 'Ci si muove come una raffica.', icon: ic('elementale-aria', '#5cc8f0'),
        effects: [{ kind: 'bonus', stat: 'velocita', value: 3 }, { kind: 'bonus', stat: 'iniziativa', value: 2 }] },
      { id: 'n-mente', name: 'Mente di cristallo', cost: 1, category: 'Spirito', color: '#8e5cc9', description: 'Pensieri limpidi e inattaccabili.', icon: ic('mago', '#8e5cc9'),
        effects: [{ kind: 'competenza', target: 'ts', ability: 'SAG' }, { kind: 'bonus', stat: 'cd', value: 1 }] },
      { id: 'n-pelle', name: 'Pelle d\'ossidiana', cost: 2, category: 'Corpo', color: '#2b2b30', description: 'La carne si indurisce come pietra vulcanica.', icon: ic('golem', '#8a8f9c'),
        effects: [{ kind: 'bonus', stat: 'ca', value: 1 }, { kind: 'bonus', stat: 'resistenza', damageType: 'fuoco' }] },
      { id: 'n-occhi', name: 'Occhi oltre il velo', cost: 1, category: 'Spirito', color: '#22a39a', description: 'Il buio non nasconde più nulla.', icon: ic('occhio', '#22a39a'),
        effects: [{ kind: 'bonus', stat: 'senso', sense: 'vista cieca', value: 9 }, { kind: 'competenza', target: 'abilita', skill: 'Percezione', expertise: true }] },
      { id: 'n-lama', name: 'Lama del giudizio', cost: 2, category: 'Guerra', color: '#c9a227', description: 'Ogni colpo porta il peso di una sentenza.', icon: ic('cavaliere', '#c9a227'),
        effects: [{ kind: 'bonus', stat: 'attacco', value: 1 }, { kind: 'bonus', stat: 'danno', value: 2 }], exclusiveWith: 'n-scudo' },
      { id: 'n-scudo', name: 'Egida immortale', cost: 2, category: 'Guerra', color: '#4f8fd6', description: 'Proteggere gli altri diventa istinto.', icon: ic('chierico', '#4f8fd6'),
        effects: [{ kind: 'bonus', stat: 'ca', value: 2 }, { kind: 'privilegio', name: 'Scudo vivente', type: 'reazione', uses: { kind: 'breve', n: 1 },
          desc: 'Quando un alleato entro 9 m viene colpito, il danno passa a te.', mech: { kind: 'testo' } }], exclusiveWith: 'n-lama' },
      { id: 'n-fiamma', name: 'Fiamma interiore', cost: 2, category: 'Arcano', color: '#e8832a', description: 'Un fuoco che non brucia chi lo porta.', icon: ic('elementale-fuoco', '#e8832a'),
        effects: [{ kind: 'slot', level: 6, count: 1 }, { kind: 'privilegio', name: 'Esplosione di brace', type: 'azione', uses: { kind: 'lungo', n: 2 },
          desc: '', mech: { kind: 'salvezza', ability: 'DES', dcAbility: 'COS', damages: [{ dice: '8d6', type: 'fuoco', bonus: 0 }], half: true, area: 'sfera di 6 m' } }] },
      { id: 'n-stelle', name: 'Respiro delle stelle', cost: 3, minRank: 4, category: 'Arcano', color: '#4f8fd6', description: 'Gli slot più alti si moltiplicano.', icon: ic('bacchetta', '#4f8fd6'),
        effects: [{ kind: 'slot', level: 9, count: 1 }, { kind: 'bonus', stat: 'attaccoMagia', value: 1 }] },
      { id: 'n-forma', name: 'Risveglio della forma', cost: 3, minRank: 5, category: 'Ascesa', color: '#f2c94c', description: 'La forma leggendaria si apre.', icon: ic('drago-volo', '#f2c94c'),
        effects: [{ kind: 'trasformazione', transformationId: '' }, { kind: 'testo', text: 'Collega qui una trasformazione del personaggio.' }] },
      { id: 'n-corona', name: 'Corona dell\'ascesa', cost: 4, minRank: 8, category: 'Ascesa', color: '#f4f4f0', description: 'Solo chi ha corpo e spirito pronti può indossarla.', icon: ic('lich', '#f4f4f0'),
        effects: [{ kind: 'caratteristica', ability: 'CAR', value: 2 }, { kind: 'bonus', stat: 'competenza', value: 1 }], requires: ['n-pelle', 'n-occhi'], requireAll: true },
      { id: 'n-eco', name: 'Eco dei nomi', cost: 1, category: 'Spirito', color: '#e86fa6', description: 'I nomi antichi rispondono alla tua voce.', icon: ic('bardo', '#e86fa6'),
        effects: [{ kind: 'testo', text: 'Puoi comunicare con qualsiasi creatura che abbia un nome, una volta al giorno.' }] },
    ];
    const links = [[CORE_ID, 'n-vigore'], [CORE_ID, 'n-passo'], [CORE_ID, 'n-mente'], ['n-vigore', 'n-pelle'], ['n-mente', 'n-occhi'], ['n-passo', 'n-lama'], ['n-passo', 'n-scudo'],
      ['n-mente', 'n-fiamma'], ['n-fiamma', 'n-stelle'], ['n-stelle', 'n-forma'], ['n-pelle', 'n-corona'], ['n-occhi', 'n-corona'], ['n-mente', 'n-eco']];
    return radialLayout(normalizePath({ name: 'Ascesa dell\'Eterno', nodes, links }), 190);
  }
  const exampleTemplate = () => normalizeTemplate({ id: 'modello-ascesa-eterno', name: 'Ascesa dell\'Eterno', description: 'Percorso d\'esempio originale: corpo, spirito, guerra, arcano e ascesa.', path: example() });

  DnD.percorso = {
    EFFECTS, EFFECT_NAMES, STATS, STAT_NAMES, SENSES, PROF_TARGETS, FEATURE_TYPES, FEATURE_TYPE_NAMES, USES, USES_NAMES, CORE_ID, MAX_NODES, MAX_RANK,
    normalizeEffect, normalizeNode, normalizePath, normalizeTemplate, nodeById, neighbors, linked, withCore,
    pointsTotal, pointsSpent, canUnlock, unlock, respec, available, unreachable, exclusivityCycles, validate,
    addNode, link, unlink, removeNodes, duplicateNodes, moveNodes, radialLayout, history, search, example, exampleTemplate,
  };
})(globalThis.DnD = globalThis.DnD || {});
