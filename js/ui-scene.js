// Sezione Scene (logica in scene.js): scaletta della sessione con ricerca, filtri, riordino a trascinamento e
// duplicazione; vista a linea con le frecce dei collegamenti; editor della scena e dell'incontro; libreria degli
// incontri con esporta/importa e «Genera incontro»; lancio (combattimento o esplorazione), vista della scena in
// corso, riepilogo del combattimento, distribuzione delle ricompense e scena successiva.
(function (DnD) {
  'use strict';

  const { el, clear, fill, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const S = DnD.scene;
  const K = DnD.sceneDati;
  const A = DnD.attrezzatura;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const TABS = [{ id: 'scaletta', label: 'Scaletta' }, { id: 'linea', label: 'Linea' }, { id: 'incontri', label: 'Incontri' }];
  let root = null;
  let tab = 'scaletta';
  let editing = null;      // id della scena in modifica o 'new'
  let editingEnc = null;   // id dell'incontro della libreria in modifica o 'new'
  let viewing = null;      // id della scena aperta (vista)
  const query = { text: '', kind: '', status: '' };
  let dragId = null;

  const st = () => DnD.store.state;
  const session = (s) => DnD.sessioni.current(s || st());
  const scenes = () => S.sessionScenes(st(), session().id);
  const library = () => DnD.sessioni.visible(st(), 'encounters');
  const sceneById = (id) => (st().scenes || []).find((s) => s.id === id) || null;
  const players = () => S.partyPlayers(st(), session().id);
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const sound = (id) => { if (DnD.audio) DnD.audio.suona(id); };
  const statusTag = (s) => el('span', { class: 'tag scene-status scene-' + s.status, text: K.STATUS_NAMES[s.status] });
  const save = (fn) => DnD.store.update(fn);

  function render(container) {
    root = container || root;
    if (!root) return;
    clear(root);
    const cur = session().currentSceneId ? sceneById(session().currentSceneId) : null;
    root.append(el('div', { class: 'section-head' }, el('h1', { text: 'Scene' }),
      el('span', { class: 'muted small', text: 'Sessione «' + session().name + '» · ' + scenes().length + ' scene' })));
    if (cur && !editing) root.append(runningBanner(cur));
    root.append(DnD.uiAsset.tabBar(TABS, tab, 'Scene', 'scheda-scene-', (id) => { tab = id; editing = null; editingEnc = null; viewing = null; render(); }));
    const panel = el('div', { role: 'tabpanel', id: 'scheda-scene-pannello', 'aria-labelledby': 'scheda-scene-' + tab });
    root.append(panel);
    if (tab === 'incontri') return editingEnc ? encounterLibraryForm(panel) : encounterList(panel);
    if (editing) return sceneForm(panel);
    if (viewing && sceneById(viewing)) return sceneView(panel, sceneById(viewing));
    if (tab === 'linea') return lineView(panel);
    return sceneList(panel);
  }

  // ---------- Scaletta ----------
  function sceneList(host) {
    const list = scenes();
    const shown = S.filter(list, query);
    const reorder = (id, index) => { save(() => { S.move(scenes(), id, index); }); render(); };
    host.append(el('div', { class: 'section-head' }, el('h2', { text: 'Scaletta' }),
      el('div', { class: 'head-actions' },
        el('input', { type: 'search', placeholder: 'Cerca per titolo, tag o testo…', value: query.text, 'aria-label': 'Cerca le scene', onchange: (e) => { query.text = e.target.value.trim(); render(); } }),
        el('select', { 'aria-label': 'Filtra per tipo', onchange: (e) => { query.kind = e.target.value; render(); } }, opt('', 'Tutti i tipi', !query.kind), K.KINDS.map((k) => opt(k, K.KIND_NAMES[k], k === query.kind))),
        el('select', { 'aria-label': 'Filtra per stato', onchange: (e) => { query.status = e.target.value; render(); } }, opt('', 'Tutti gli stati', !query.status), K.STATUSES.map((k) => opt(k, K.STATUS_NAMES[k], k === query.status))),
        el('button', { class: 'btn primary', text: '+ Nuova scena', onclick: () => { editing = 'new'; render(); } }))),
    shown.length ? el('ol', { class: 'scene-list' }, shown.map((s) => {
      const i = list.indexOf(s);
      const warn = S.missingRefs(st(), s, session().id);
      return el('li', {
        class: 'scene-row' + (s.id === session().currentSceneId ? ' running' : ''), draggable: 'true', 'data-id': s.id,
        ondragstart: (e) => { dragId = s.id; e.dataTransfer.effectAllowed = 'move'; },
        ondragover: (e) => { if (dragId && dragId !== s.id) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
        ondragleave: (e) => e.currentTarget.classList.remove('drop'),
        ondrop: (e) => { e.preventDefault(); const id = dragId; dragId = null; if (id && id !== s.id) reorder(id, i); },
      },
      el('span', { class: 'scene-num', 'aria-hidden': 'true', text: String(i + 1) }),
      el('span', { class: 'scene-kind', title: K.KIND_NAMES[s.kind], text: K.KIND_ICONS[s.kind] }),
      el('div', { class: 'scene-main' },
        el('button', { type: 'button', class: 'link-btn scene-title', text: s.title, onclick: () => { viewing = s.id; render(); } }), ' ', statusTag(s),
        s.shared ? el('span', { class: 'tag accent', text: 'Condivisa' }) : null,
        el('div', { class: 'muted small', text: [K.KIND_NAMES[s.kind], s.encounters.length ? s.encounters.length + (s.encounters.length === 1 ? ' incontro' : ' incontri') : '', s.duration ? '~' + s.duration + ' min' : '',
          s.links.length ? s.links.length + ' collegamenti' : '', s.tags.map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ') }),
        warn.length ? el('div', { class: 'warn small', text: '⚠ ' + warn.join(', ') }) : null),
      el('div', { class: 'scene-actions' },
        el('button', { class: 'icon-btn', text: '↑', 'aria-label': 'Sposta su «' + s.title + '»', disabled: i === 0, onclick: () => reorder(s.id, i - 1) }),
        el('button', { class: 'icon-btn', text: '↓', 'aria-label': 'Sposta giù «' + s.title + '»', disabled: i === list.length - 1, onclick: () => reorder(s.id, i + 1) }),
        el('button', { class: 'btn small primary', text: '▶ Lancia', onclick: () => launchScene(s.id) }),
        el('button', { class: 'btn small', text: 'Modifica', onclick: () => { editing = s.id; render(); } }),
        el('button', { class: 'btn small', text: 'Duplica', onclick: () => { save((x) => { x.scenes.push(Object.assign(S.duplicate(s, S.nextOrder(scenes())), { sessionId: session(x).id })); }); toast('Scena duplicata.'); render(); } }),
        el('button', { class: 'btn small danger', text: 'Elimina', onclick: () => removeScene(s) })));
    })) : el('p', { class: 'empty', text: list.length ? 'Nessuna scena con questi filtri.' : 'Nessuna scena: crea la prima della scaletta.' }),
    el('p', { class: 'muted small', text: 'Trascina le righe (o usa ↑ ↓) per riordinare la scaletta.' }));
  }
  function removeScene(s) {
    if (!confirm('Eliminare la scena «' + s.title + '»?' + (s.shared ? '\nÈ condivisa: sparirà da tutte le sessioni.' : ''))) return;
    save((x) => { x.scenes = x.scenes.filter((y) => y.id !== s.id); if (session(x).currentSceneId === s.id) session(x).currentSceneId = ''; });
    toast('Scena eliminata.');
    render();
  }

  // ---------- Vista a linea ----------
  function lineView(host) {
    const L = S.line(scenes());
    if (!L.nodes.length) { host.append(el('p', { class: 'empty', text: 'Nessuna scena nella scaletta.' })); return; }
    const W = 170;
    const H = 64;
    const GAP = 50;
    const top = 70;
    const width = L.nodes.length * (W + GAP) + GAP;
    const height = top + H + 90;
    const cx = (i) => GAP + i * (W + GAP) + W / 2;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('class', 'scene-line-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Linea delle scene: ' + L.nodes.map((s) => s.title).join(', '));
    const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; svg.append(n); return n; };
    const marker = add('defs', {});
    marker.innerHTML = '<marker id="scene-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="scene-arrow-head"/></marker>';
    // Frecce: avanti sopra, indietro sotto; più collegamenti dalla stessa scena si alzano a gradini.
    const lanes = new Map();
    for (const e of L.edges) {
      if (e.missing) continue;
      const lane = (lanes.get(e.from) || 0) + 1;
      lanes.set(e.from, lane);
      const fwd = e.to > e.from;
      const y0 = fwd ? top : top + H;
      const lift = (fwd ? -1 : 1) * (14 + lane * 12 + Math.abs(e.to - e.from) * 4);
      const x1 = cx(e.from) + (fwd ? 20 : -20);
      const x2 = cx(e.to) + (fwd ? -20 : 20);
      add('path', { d: 'M' + x1 + ' ' + y0 + ' C' + x1 + ' ' + (y0 + lift) + ' ' + x2 + ' ' + (y0 + lift) + ' ' + x2 + ' ' + y0, class: 'scene-edge scene-edge-' + e.outcome, 'marker-end': 'url(#scene-arrow)' });
      add('text', { x: String((x1 + x2) / 2), y: String(y0 + lift + (fwd ? -3 : 11)), 'text-anchor': 'middle', class: 'scene-edge-label' }, e.label);
    }
    L.nodes.forEach((s, i) => {
      const x = GAP + i * (W + GAP);
      if (i < L.nodes.length - 1) add('line', { x1: String(x + W), y1: String(top + H / 2), x2: String(x + W + GAP), y2: String(top + H / 2), class: 'scene-flow' });
      add('rect', { x: String(x), y: String(top), width: String(W), height: String(H), rx: '10', class: 'scene-node scene-' + s.status + (s.id === session().currentSceneId ? ' running' : '') });
      add('text', { x: String(x + 10), y: String(top + 24), class: 'scene-node-title' }, K.KIND_ICONS[s.kind] + ' ' + (i + 1) + '. ' + (s.title.length > 18 ? s.title.slice(0, 17) + '…' : s.title));
      add('text', { x: String(x + 10), y: String(top + 46), class: 'scene-node-sub' }, K.STATUS_NAMES[s.status]);
    });
    const missing = L.edges.filter((e) => e.missing);
    fill(host, el('div', { class: 'scene-line' }, svg),
      el('ul', { class: 'scene-line-list small' }, L.nodes.map((s, i) => el('li', {},
        el('button', { type: 'button', class: 'link-btn', text: (i + 1) + '. ' + s.title, onclick: () => { viewing = s.id; render(); } }),
        s.links.length ? ' → ' + s.links.map((l) => K.OUTCOME_NAMES[l.outcome] + (l.label ? ' «' + l.label + '»' : '') + ': ' + ((sceneById(l.sceneId) || {}).title || 'scena eliminata')).join(' · ') : ''))),
      missing.length ? el('p', { class: 'warn small', text: '⚠ ' + missing.length + ' collegamenti verso scene eliminate (disattivati).' }) : null);
  }

  // ---------- Vista della scena ----------
  function sceneView(host, s) {
    const warn = S.missingRefs(st(), s, session().id);
    fill(host, el('div', { class: 'section-head' }, el('h2', {}, K.KIND_ICONS[s.kind] + ' ' + s.title + ' ', statusTag(s)),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn', text: '← Scaletta', onclick: () => { viewing = null; render(); } }),
        el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = s.id; render(); } }),
        el('button', { class: 'btn primary', text: '▶ Lancia scena', onclick: () => launchScene(s.id) }))),
    warn.length ? el('p', { class: 'warn', text: '⚠ Riferimenti mancanti: ' + warn.join(', ') + ' (voci disattivate).' }) : null,
    sceneDetails(s, false),
    s.history.length ? el('details', { class: 'panel' }, el('summary', { text: 'Storico (' + s.history.length + ')' }),
      el('ol', { class: 'scene-history small' }, s.history.slice().reverse().map((h) => el('li', { text: new Date(h.at).toLocaleString('it-IT') + ' — ' + h.text })))) : null);
  }
  // Dettaglio comune alla vista e al banner: testo da leggere, mappa, incontri, NPC, eventi, tesoro, collegamenti.
  function sceneDetails(s, running) {
    const g = s.map.gridId ? (st().savedGrids || []).find((x) => x.id === s.map.gridId) : null;
    const read = el('div', { class: 'scene-read event-read' });
    read.innerHTML = s.readAloud || '<p><em>Nessun testo da leggere.</em></p>';
    const npcs = s.npcIds.map((id) => (st().worldNpcs || []).find((n) => n.id === id));
    const events = s.eventIds.map((id) => (st().events || []).find((e) => e.id === id));
    const city = s.cityId ? (st().cities || []).find((c) => c.id === s.cityId) : null;
    const pageName = s.pageId ? (session().pages.find((p) => p.id === s.pageId) || {}).name : '';
    return el('div', { class: 'scene-details' },
      el('section', { class: 'panel' }, el('div', { class: 'history-head' }, el('h3', { text: 'Testo da leggere ai giocatori' }),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn small', text: '📢 Mostra ai giocatori', onclick: () => showToPlayers(s) }),
          s.pageId ? el('button', { class: 'btn small', text: '🗒 Note' + (pageName ? ' «' + pageName + '»' : ''), disabled: !pageName, onclick: () => DnD.app.notes() && DnD.app.notes().openPage(s.pageId) }) : null)),
      read, el('p', { class: 'muted small', text: s.revealed ? 'Rivelato ai giocatori.' : 'Non ancora rivelato ai giocatori.' })),
      el('section', { class: 'panel' }, el('h3', { text: 'Mappa e incontri' }),
        el('p', { class: 'small', text: s.map.gridId ? (g ? (g.kind === 'esplorazione' ? '🧭 ' : '⚔ ') + g.name + (s.map.entry ? ' · entrata ' + DnD.griglia.cellLabel(s.map.entry.x, s.map.entry.y) : '') : '⚠ mappa eliminata') : 'Nessuna mappa (griglia vuota per i combattimenti).' }),
        s.encounters.length ? el('ul', { class: 'pick-list' }, s.encounters.map((e) => encounterRow(s, e, running))) : el('p', { class: 'muted small', text: 'Nessun incontro.' })),
      el('section', { class: 'panel' }, el('h3', { text: 'NPC, eventi e luoghi' }),
        el('p', { class: 'small', text: 'NPC presenti: ' + (npcs.map((n) => (n ? n.name : '⚠ eliminato')).join(', ') || 'nessuno') }),
        el('p', { class: 'small', text: 'Eventi collegati: ' + (events.map((e) => (e ? e.name : '⚠ eliminato')).join(', ') || 'nessuno') }),
        s.cityId ? el('p', { class: 'small', text: 'Città: ' + (city ? city.name : '⚠ eliminata') }) : null,
        s.effects.length ? el('p', { class: 'small', text: 'Effetti: ' + s.effects.map(effectText).join(' · ') }) : null),
      el('section', { class: 'panel' }, el('h3', { text: 'Tesori e ricompense' }),
        el('p', { class: 'small', text: rewardText(s.treasure) + (s.treasureGiven ? ' · già distribuito' : '') }),
        running && hasReward(s.treasure) ? el('button', { class: 'btn small', text: '🎁 Distribuisci il tesoro', onclick: () => rewardsDialog(s.treasure, players(), (lines) => { save((x) => { const sc = x.scenes.find((y) => y.id === s.id); sc.treasureGiven = true; for (const l of lines) sc.history.push({ at: new Date().toISOString(), text: l }); }); render(); }) }) : null),
      s.links.length ? el('section', { class: 'panel' }, el('h3', { text: 'Collegamenti' }),
        el('ul', { class: 'small' }, s.links.map((l) => el('li', { text: K.OUTCOME_NAMES[l.outcome] + (l.label ? ' «' + l.label + '»' : '') + ' → ' + ((sceneById(l.sceneId) || {}).title || '⚠ scena eliminata') })))) : null,
      s.duration || s.tags.length ? el('p', { class: 'muted small', text: [s.duration ? 'Durata stimata: ' + s.duration + ' min' : '', s.tags.map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ') }) : null);
  }
  const hasReward = (r) => r.xp > 0 || A.CURRENCIES.some((k) => r.coins[k]) || r.items.length > 0;
  function rewardText(r) {
    const eq = (id) => (st().equipment.find((e) => e.id === id) || { name: '⚠ oggetto eliminato' }).name;
    return [r.xp ? r.xp + ' PE' : '', A.CURRENCIES.some((k) => r.coins[k]) ? A.formatCoins(r.coins) : '', r.items.map((i) => i.qty + '× ' + eq(i.equipmentId)).join(', ')].filter(Boolean).join(' · ') || 'Nessuno';
  }
  function effectText(e) {
    const a = e.action;
    const when = e.when === 'fine' ? 'alla fine' : 'all\'inizio';
    if (a.kind === 'reputazione') return when + ': reputazione ' + (a.delta > 0 ? '+' : '') + a.delta + ' con «' + ((st().factions.find((f) => f.id === a.factionId) || {}).name || 'fazione eliminata') + '»';
    return when + ': quest «' + ((st().quests.find((q) => q.id === a.questId) || {}).title || 'eliminata') + '» (' + a.op + ')';
  }
  // Riga di un incontro della scena: difficoltà col party, PE, stato e pulsanti di lancio.
  function encounterRow(s, e, running) {
    const r = S.evaluate(st(), e, players(), session().id);
    const missing = S.encounterMissing(st(), e);
    return el('li', { class: 'scene-enc' },
      el('b', { text: e.name }), ' ',
      el('span', { class: 'diff-badge' + (r.band ? ' diff-' + r.band : ''), text: r.band ? DnD.difficolta.bandName(r.band) : '—' }),
      el('span', { class: 'muted small', text: ' ' + e.creatures.map((row) => row.qty + '× ' + ((S.sourceOf(st(), row) || {}).name || '⚠ eliminata')).join(', ') + ' · ' + DnD.creature.formatXp(r.rawXp) + ' PE (' + DnD.creature.formatXp(r.perPlayerXp) + ' a testa)' +
        (e.run ? ' · lanciato ' + e.run.launched + (e.run.outcome ? ', ' + K.OUTCOME_NAMES[e.run.outcome].toLowerCase() : '') + (e.run.rewardsGiven ? ', ricompense date' : '') : '') }),
      missing.length ? el('div', { class: 'warn small', text: '⚠ ' + missing.join(', ') }) : null,
      e.tactics ? el('div', { class: 'small scene-tactics', text: 'Tattica: ' + e.tactics }) : null,
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn small', text: '⚔ Prepara', title: 'Prepara il combattimento senza avviarlo (l\'iniziativa si conferma nel Combattimento)', onclick: () => launchEncounter(s.id, e.id, 'prepara') }),
        el('button', { class: 'btn small primary', text: '▶ Avvia ora', onclick: () => launchEncounter(s.id, e.id, 'avvia') }),
        running ? null : el('button', { class: 'btn small', text: 'Modifica', onclick: () => editSceneEncounter(s.id, e.id) })));
  }
  // Mostra ai giocatori: rivela il testo (vista dei giocatori futura) e lo apre grande, da condividere.
  function showToPlayers(s) {
    save((x) => { const sc = x.scenes.find((y) => y.id === s.id); if (sc) sc.revealed = true; });
    const view = S.statoScenaPerGiocatore(sceneById(s.id));
    const box = el('div', { class: 'scene-read event-read scene-read-big' });
    box.innerHTML = view.readAloud || '<p><em>Nessun testo.</em></p>';
    openDialog(view.title, box, [{ text: 'Chiudi', class: 'primary' }]).classList.add('wide');
    render();
  }

  // ---------- Scena in corso ----------
  function runningBanner(s) {
    const n = S.neighbors(scenes(), s.id);
    return el('section', { class: 'panel scene-banner', 'aria-label': 'Scena in corso' },
      el('div', { class: 'history-head' },
        el('h2', {}, '🎬 In corso: ', el('button', { type: 'button', class: 'link-btn', text: s.title, onclick: () => { viewing = s.id; tab = 'scaletta'; render(); } })),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn small', text: '◀ Scena precedente', title: 'Questa torna «Da fare»', disabled: !n.prev, onclick: () => n.prev && goTo(s.id, n.prev.id, false) }),
          el('button', { class: 'btn small', text: 'Prossima scena ▶', title: 'Questa diventa «Conclusa»', disabled: !n.next, onclick: () => n.next && goTo(s.id, n.next.id, true) }),
          el('button', { class: 'btn small', text: 'Salta', onclick: () => concludeDialog(s, true) }),
          el('button', { class: 'btn small primary', text: '🏁 Concludi', onclick: () => concludeDialog(s, false) }))),
      sceneDetails(s, true));
  }
  // Scena successiva della scaletta (la corrente si conclude, senza esito) o precedente (la corrente torna da fare).
  function goTo(fromId, toId, forward) {
    let lines = [];
    save((x) => {
      if (forward) lines = S.concludeScene(x, session(x).id, fromId, '', new Date()).lines;
      else S.reopenScene(x, session(x).id, fromId, new Date());
    });
    if (forward) sound('scena-conclusa');
    for (const l of lines) toast(l);
    launchScene(toId);
  }
  function concludeDialog(s, skipped) {
    const outcome = el('select', { 'aria-label': 'Esito della scena' }, opt('', 'Nessun esito particolare', true), K.OUTCOMES.map((o) => opt(o, K.OUTCOME_NAMES[o], false)));
    openDialog(skipped ? 'Salta la scena' : 'Concludi la scena', el('div', { class: 'form' },
      el('p', { text: '«' + s.title + '» diventa ' + (skipped ? 'Saltata' : 'Conclusa') + '. Lo storico resta.' + (!skipped && s.effects.some((e) => e.when === 'fine') ? ' Si applicano gli effetti di fine (quest e reputazione).' : '') }),
      skipped ? null : el('label', { class: 'inline' }, 'Esito ', outcome)), [
      { text: 'Annulla' },
      { text: skipped ? 'Salta' : 'Concludi', class: 'primary', onclick: () => { finish(s.id, skipped ? '' : outcome.value, skipped); } },
    ]);
  }
  // Conclude o salta, poi propone le scene collegate all'esito (o la successiva della scaletta).
  function finish(sceneId, outcome, skipped) {
    let res = null;
    save((x) => { res = S.concludeScene(x, session(x).id, sceneId, outcome, new Date(), skipped); });
    if (!skipped) sound('scena-conclusa');
    for (const l of res.lines) toast(l);
    render();
    const next = res.next.length ? res.next.map((n) => ({ text: (n.link.outcome === 'sempre' ? '' : K.OUTCOME_NAMES[n.link.outcome] + ': ') + (n.link.label || n.scene.title), id: n.scene.id }))
      : (() => { const nb = S.neighbors(scenes(), sceneId).next; return nb ? [{ text: 'Successiva: ' + nb.title, id: nb.id }] : []; })();
    if (next.length) {
      openDialog('Scena successiva', el('p', { text: 'Quale scena viene adesso?' }), [{ text: 'Più tardi' }].concat(next.map((n, i) => ({ text: '▶ ' + n.text, class: i === 0 ? 'primary' : '', onclick: () => { setTimeout(() => launchScene(n.id), 0); } }))));
    }
  }

  // ---------- Lancio ----------
  // Lancia la scena: In corso ed effetti d'inizio; poi la mappa nell'area giusta (Esplorazione) o il primo incontro
  // non ancora lanciato preparato nel Combattimento (senza iniziare); la pagina delle note si apre da sola.
  function launchScene(sceneId) {
    const s = sceneById(sceneId);
    if (!s) return;
    let lines = [];
    save((x) => { lines = S.startScene(x, session(x).id, sceneId, new Date()); });
    sound('scena-avviata');
    for (const l of lines) toast(l);
    const fresh = sceneById(sceneId);
    if (fresh.pageId && DnD.app.notes() && session().pages.some((p) => p.id === fresh.pageId)) DnD.app.notes().openPage(fresh.pageId);
    const g = fresh.map.gridId ? (st().savedGrids || []).find((x) => x.id === fresh.map.gridId) : null;
    if (g && g.kind === 'esplorazione') { launchExploration(fresh); return; }
    const enc = fresh.encounters.find((e) => !e.run || !e.run.launched);
    if (enc) { launchEncounter(fresh.id, enc.id, 'prepara'); return; }
    if (g) { launchEncounter(fresh.id, null, 'prepara'); return; }
    viewing = null;
    tab = 'scaletta';
    DnD.app.navigate('scene');
    render();
  }
  function launchExploration(s) {
    if (session().exploration && !confirm('C\'è già un\'esplorazione in corso: sostituirla con quella della scena «' + s.title + '»?')) return;
    let ok = false;
    save((x) => { const e = S.buildExploration(x, s, S.partyPlayers(x, session(x).id), DnD.dadi.randomInt(2147483646)); if (e) { session(x).exploration = e; ok = true; } });
    if (!ok) { toast('La mappa di esplorazione della scena non esiste più.', 'error'); return; }
    DnD.app.navigate('esplorazione');
  }
  // Prepara (o avvia) il combattimento di un incontro della scena; encId null = solo i giocatori sulla mappa.
  function launchEncounter(sceneId, encId, start) {
    const s = sceneById(sceneId);
    if (!s) return;
    const enc = encId ? s.encounters.find((e) => e.id === encId) : S.normalizeEncounter({ id: 'nessuno', name: 'Mappa della scena', end: [] });
    if (!enc) return;
    if (session().combat && !confirm('C\'è già un combattimento in corso nella sessione: sostituirlo con «' + enc.name + '»?')) return;
    let res = null;
    save((x) => {
      const sc = x.scenes.find((y) => y.id === sceneId);
      if (sc.status !== 'in-corso') S.startScene(x, session(x).id, sceneId, new Date());
      res = S.buildCombat(x, sc, enc, { players: S.partyPlayers(x, session(x).id), start, sessionId: session(x).id });
      session(x).combat = res.combat;
      const real = sc.encounters.find((e) => e.id === enc.id);
      if (real) S.recordLaunch(sc, real, res.combat.id, new Date());
    });
    if (res.unplaced.length) toast('Fuori dalle zone di partenza: ' + res.unplaced.join(', ') + '. Trascinali dal pannello.', 'error');
    if (start === 'avvia') DnD.audio.suonaTutti(DnD.suoniDati.fromCombat(null, res.combat.log, res.combat));
    DnD.app.navigate('combattimento');
  }

  // ---------- Fine del combattimento ----------
  // Riepilogo: esito (proposto dalle condizioni di fine), sconfitti, giocatori a terra, PE e tesoro; ricompense,
  // riposo breve, conclusione della scena e scena successiva.
  function onCombatEnded(ended, playerIds) {
    const ref = S.ofCombat(st(), ended);
    if (!ref) return;
    const t = DnD.fazioni.table(DnD.fazioni.view(st()).factions);
    const pf = S.partyFactionOf(st(), session().id);
    const sum = S.summary(st(), ended, t, pf);
    const end = S.endCheck(ended, ref.enc, t, pf);
    const guess = end ? end.outcome : sum.down.length && sum.down.length === ended.combatants.filter((x) => x.kind === 'player').length ? 'sconfitta' : 'vittoria';
    const record = (o) => save((x) => { const sc = x.scenes.find((y) => y.id === ref.scene.id); const e = sc && sc.encounters.find((y) => y.id === ref.enc.id); if (e) { if (e.run && e.run.outcome) sc.history.pop(); S.recordOutcome(sc, e, sum, o, new Date()); } });
    record(guess);
    const outcome = el('select', { 'aria-label': 'Esito dell\'incontro', onchange: (e) => record(e.target.value) }, K.OUTCOMES.map((o) => opt(o, K.OUTCOME_NAMES[o], o === guess)));
    const rewards = { xp: sum.xp + ref.enc.rewards.xp, coins: clone(ref.enc.rewards.coins), items: clone(ref.enc.rewards.items) };
    const who = (st().players || []).filter((p) => playerIds.includes(p.id));
    const recipients = who.length ? who : players();
    openDialog('Fine dell\'incontro «' + ref.enc.name + '»', el('div', { class: 'form' },
      el('p', { text: 'Scena «' + ref.scene.title + '» · round ' + sum.round + '.' }),
      end ? el('p', { class: 'small', text: '🎬 Condizione di fine: ' + K.OUTCOME_NAMES[end.outcome] + ' (' + end.text + ').' }) : null,
      el('label', { class: 'inline' }, 'Esito ', outcome),
      el('ul', { class: 'small' },
        el('li', { text: 'Creature sconfitte: ' + (sum.defeated.join(', ') || 'nessuna') }),
        sum.fled.length ? el('li', { text: 'In fuga: ' + sum.fled.join(', ') }) : null,
        el('li', { text: 'Giocatori a terra: ' + (sum.down.join(', ') || 'nessuno') }),
        el('li', { text: 'PE dei nemici sconfitti: ' + DnD.creature.formatXp(sum.xp) + (ref.enc.rewards.xp ? ' + ' + ref.enc.rewards.xp + ' a mano' : '') }),
        el('li', { text: 'Tesoro: ' + rewardText(ref.enc.rewards) }))), [
      { text: 'Più tardi' },
      { text: '🛏 Riposo breve', onclick: () => { setTimeout(() => DnD.uiRiposi.restPlayers('breve', recipients.map((p) => p.id)), 0); } },
      { text: '🎁 Distribuisci ricompense', onclick: () => { setTimeout(() => rewardsDialog(rewards, recipients, (lines) => afterRewards(ref, lines, outcome.value)), 0); } },
      { text: '🏁 Concludi la scena', class: 'primary', onclick: () => { setTimeout(() => finish(ref.scene.id, outcome.value, false), 0); } },
    ]);
  }
  function afterRewards(ref, lines, outcome) {
    save((x) => {
      const sc = x.scenes.find((y) => y.id === ref.scene.id);
      const e = sc && sc.encounters.find((y) => y.id === ref.enc.id);
      if (e && e.run) e.run.rewardsGiven = true;
      if (sc) for (const l of lines) sc.history.push({ at: new Date().toISOString(), text: l });
    });
    if (confirm('Ricompense distribuite. Concludere la scena «' + ref.scene.title + '»?')) finish(ref.scene.id, outcome, false);
    else render();
  }

  // Distribuisci ricompense: PE (divisi), monete (a un giocatore o divise con conversione), oggetti a chi si sceglie.
  function rewardsDialog(base, list, onDone) {
    if (!list.length) { toast('Nessun giocatore a cui dare le ricompense.', 'error'); return; }
    const r = clone(base);
    const xp = numberInput(r.xp || 0, { min: 0, class: 'qty', 'aria-label': 'PE' });
    const coins = Object.fromEntries(A.CURRENCIES.map((k) => [k, numberInput(r.coins[k] || 0, { min: 0, class: 'qty', 'aria-label': A.CURRENCY_NAMES ? A.CURRENCY_NAMES[k] : k })]));
    const coinsTo = el('select', { 'aria-label': 'Monete a' }, opt('dividi', 'Dividi tra tutti (con conversione)', true), list.map((p) => opt(p.id, p.name, false)));
    const items = r.items.map((it) => {
      const eq = st().equipment.find((e) => e.id === it.equipmentId);
      return { it, eq, to: el('select', { 'aria-label': 'Destinatario di ' + (eq ? eq.name : 'oggetto') }, list.map((p) => opt(p.id, p.name, false))) };
    });
    const preview = el('p', { class: 'muted small' });
    const read = () => ({ xp: readNumber(xp) || 0, coins: Object.fromEntries(A.CURRENCIES.map((k) => [k, readNumber(coins[k]) || 0])), items: items.filter((x) => x.eq).map((x) => ({ equipmentId: x.it.equipmentId, qty: x.it.qty, to: x.to.value })) });
    const upd = () => { const d = read(); preview.textContent = 'A testa: ' + Math.floor(d.xp / list.length) + ' PE' + (coinsTo.value === 'dividi' && DnD.npc.toCopper(d.coins) ? ' · ' + A.formatCoins(DnD.npc.fromCopper(Math.floor(DnD.npc.toCopper(d.coins) / list.length))) : ''); };
    const body = el('div', { class: 'form', oninput: upd, onchange: upd },
      el('p', { class: 'small', text: 'Giocatori: ' + list.map((p) => p.name).join(', ') }),
      el('label', { class: 'inline' }, 'PE da dividere ', xp),
      el('div', { class: 'input-row' }, A.CURRENCIES.map((k) => el('label', { class: 'inline small' }, k + ' ', coins[k]))),
      el('label', { class: 'inline' }, 'Monete ', coinsTo),
      items.length ? el('ul', { class: 'pick-list' }, items.map((x) => el('li', {}, x.eq ? x.it.qty + '× ' + x.eq.name + ' a ' : '⚠ oggetto eliminato (saltato) ', x.eq ? x.to : null))) : null,
      preview);
    upd();
    openDialog('Distribuisci ricompense', body, [{ text: 'Annulla' }, { text: '🎁 Distribuisci', class: 'primary', onclick: () => {
      const d = read();
      let lines = [];
      const ids = list.map((p) => p.id);
      save((x) => { lines = S.distribute(d, ids.map((id) => x.players.find((p) => p.id === id)).filter(Boolean), { coinsTo: coinsTo.value, equipment: x.equipment }); });
      for (const l of lines) toast(l, 'success');
      onDone(lines);
    } }]);
  }

  // ---------- Editor della scena ----------
  function sceneForm(host) {
    const existing = editing === 'new' ? null : sceneById(editing);
    const s = existing ? clone(existing) : S.normalizeScene({ title: '', order: S.nextOrder(scenes()), sessionId: session().id });
    const se = session();
    const grids = DnD.sessioni.visible(st(), 'savedGrids');
    const title = textInput(s.title, { maxlength: 80, 'data-key': 'title' });
    const kind = el('select', {}, K.KINDS.map((k) => opt(k, K.KIND_ICONS[k] + ' ' + K.KIND_NAMES[k], k === s.kind)));
    const status = el('select', {}, K.STATUSES.map((k) => opt(k, K.STATUS_NAMES[k], k === s.status)));
    const duration = numberInput(s.duration || '', { min: 0, max: 1440, class: 'qty', placeholder: 'min' });
    const tags = textInput(s.tags.join(', '), { maxlength: 300, placeholder: 'es. palude, agguato' });
    const editor = DnD.noteEditor.create({ html: s.readAloud, label: 'Testo da leggere ai giocatori', onChange: () => {} });
    const page = el('select', {}, opt('', '— Nessuna —', !s.pageId), se.pages.map((p) => opt(p.id, p.name, p.id === s.pageId)),
      s.pageId && !se.pages.some((p) => p.id === s.pageId) ? opt(s.pageId, '⚠ pagina eliminata', true) : null);
    const grid = el('select', {}, opt('', '— Nessuna (griglia vuota) —', !s.map.gridId), grids.map((g) => opt(g.id, (g.kind === 'esplorazione' ? '🧭 ' : '⚔ ') + g.name, g.id === s.map.gridId)),
      s.map.gridId && !grids.some((g) => g.id === s.map.gridId) ? opt(s.map.gridId, '⚠ mappa eliminata', true) : null);
    const entry = textInput(s.map.entry ? DnD.griglia.cellLabel(s.map.entry.x, s.map.entry.y) : '', { maxlength: 6, placeholder: 'es. B4', 'data-key': 'entry', class: 'qty' });
    const shared = el('input', { type: 'checkbox', checked: s.shared });
    const v = DnD.fazioni.view(st());
    const npcChecks = v.npcs.map((n) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: n.id, checked: s.npcIds.includes(n.id) }), ' ' + n.name));
    const eventChecks = (st().events || []).map((e) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: e.id, checked: s.eventIds.includes(e.id) }), ' ' + e.name));
    const city = el('select', {}, opt('', '— Nessuna —', !s.cityId), v.cities.map((c) => opt(c.id, c.name, c.id === s.cityId)));
    const treasure = rewardEditor(s.treasure);
    // Incontri della scena (copie indipendenti): dalla libreria o nuovi.
    const encBox = el('ul', { class: 'pick-list' });
    const drawEnc = () => fill(encBox, s.encounters.map((e, i) => el('li', {}, el('b', { text: e.name }),
      el('span', { class: 'muted small', text: ' · ' + e.creatures.length + ' righe' + (e.templateId ? ' · dal modello' : '') }), ' ',
      el('button', { type: 'button', class: 'btn small', text: 'Modifica', onclick: () => encounterDialog(e, (saved) => { s.encounters[i] = saved; drawEnc(); }) }),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli «' + e.name + '»', onclick: () => { s.encounters.splice(i, 1); drawEnc(); } }))),
      s.encounters.length ? null : el('li', { class: 'muted small', text: 'Nessun incontro.' }));
    drawEnc();
    const fromLib = el('select', { 'aria-label': 'Incontro della libreria' }, opt('', '+ Dalla libreria…', true), library().map((e) => opt(e.id, e.name, false)));
    fromLib.addEventListener('change', () => { const tpl = library().find((e) => e.id === fromLib.value); if (tpl) { s.encounters.push(S.fromTemplate(tpl)); drawEnc(); } fromLib.value = ''; });
    // Effetti su quest e fazioni, collegamenti per esito.
    const effBox = el('div', {});
    const drawEff = () => fill(effBox, s.effects.map((x, i) => {
      const a = x.action;
      return el('div', { class: 'input-row' },
        el('select', { 'aria-label': 'Quando', onchange: (e) => { x.when = e.target.value; } }, opt('inizio', 'All\'inizio', x.when === 'inizio'), opt('fine', 'Alla fine', x.when === 'fine')),
        el('select', { 'aria-label': 'Tipo di effetto', onchange: (e) => { s.effects[i] = S.normalizeEffect({ id: x.id, when: x.when, action: { kind: e.target.value } }); drawEff(); } }, opt('quest', 'Quest', a.kind === 'quest'), opt('reputazione', 'Reputazione', a.kind === 'reputazione')),
        a.kind === 'quest' ? [
          el('select', { 'aria-label': 'Quest', onchange: (e) => { a.questId = e.target.value; } }, opt('', '— Quest —', !a.questId), v.quests.map((q) => opt(q.id, q.title, q.id === a.questId))),
          el('select', { 'aria-label': 'Operazione', onchange: (e) => { a.op = e.target.value; } }, ['avvia', 'avanza', 'completa', 'fallisci'].map((o) => opt(o, o, o === a.op)))]
          : [el('select', { 'aria-label': 'Fazione', onchange: (e) => { a.factionId = e.target.value; } }, opt('', '— Fazione —', !a.factionId), v.factions.map((f) => opt(f.id, f.name, f.id === a.factionId))),
            numberInput(a.delta, { class: 'qty', min: -200, max: 200, 'aria-label': 'Variazione', oninput: (e) => { a.delta = readNumber(e.target) || 0; } })],
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli l\'effetto', onclick: () => { s.effects.splice(i, 1); drawEff(); } }));
    }), el('button', { type: 'button', class: 'btn small', text: '+ Effetto', onclick: () => { s.effects.push(S.normalizeEffect({ when: 'fine', action: { kind: 'quest' } })); drawEff(); } }));
    drawEff();
    const linkBox = el('div', {});
    const others = scenes().filter((x) => x.id !== s.id);
    const drawLinks = () => fill(linkBox, s.links.map((l, i) => el('div', { class: 'input-row' },
      el('select', { 'aria-label': 'Esito', onchange: (e) => { l.outcome = e.target.value; } }, K.LINK_OUTCOMES.map((o) => opt(o, (o === 'sempre' ? '' : 'Se ') + K.OUTCOME_NAMES[o].toLowerCase(), o === l.outcome))),
      textInput(l.label, { maxlength: 80, placeholder: 'etichetta (es. «Se fuggono»)', 'aria-label': 'Etichetta', oninput: (e) => { l.label = e.target.value; } }),
      ' → ', el('select', { 'aria-label': 'Scena', onchange: (e) => { l.sceneId = e.target.value; } }, opt('', '— Scena —', !l.sceneId), others.map((x) => opt(x.id, x.title, x.id === l.sceneId)),
        l.sceneId && !others.some((x) => x.id === l.sceneId) ? opt(l.sceneId, '⚠ scena eliminata', true) : null),
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli il collegamento', onclick: () => { s.links.splice(i, 1); drawLinks(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Collegamento', disabled: s.links.length >= K.MAX.links, onclick: () => { s.links.push(S.normalizeLink({ outcome: s.links.length ? 'fuga' : 'vittoria' })); drawLinks(); } }));
    drawLinks();
    const error = el('p', { class: 'error', 'aria-live': 'polite' });
    const done = () => { editing = null; render(); };
    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' }, field('Titolo', title, 'title'), field('Tipo', kind), field('Stato', status), field('Durata stimata (min)', duration), field('Tag (separati da virgola)', tags)),
      el('fieldset', {}, el('legend', { text: 'Testo da leggere ai giocatori' }), editor.node,
        el('p', { class: 'muted small', text: 'Si mostra ai giocatori solo quando lo riveli («Mostra ai giocatori»).' })),
      el('div', { class: 'grid-3' }, field('Pagina delle note del master', page),
        el('div', { class: 'field' }, el('label', { text: ' ' }), el('button', { type: 'button', class: 'btn small', text: '+ Crea pagina con il titolo', onclick: () => {
          const name = (title.value.trim() || 'Scena').slice(0, 60);
          let p = null;
          save((x) => { const ss = session(x); ss.pages = ss.pages || []; p = DnD.note.addPage(ss.pages, name, DnD.dadi.uid()); });
          page.append(opt(p.id, p.name, true));
          page.value = p.id;
          toast('Pagina «' + p.name + '» creata nelle note.');
        } }))),
      el('fieldset', {}, el('legend', { text: 'Mappa' }), el('div', { class: 'grid-2' }, field('Griglia della sessione', grid), field('Punto di entrata (cella)', entry, 'entry'))),
      el('fieldset', {}, el('legend', { text: 'Incontri' }), encBox,
        el('div', { class: 'input-row' }, fromLib, el('button', { type: 'button', class: 'btn small', text: '+ Nuovo incontro', onclick: () => encounterDialog(S.normalizeEncounter({ name: 'Incontro ' + (s.encounters.length + 1) }), (saved) => { s.encounters.push(saved); drawEnc(); }) }),
          el('button', { type: 'button', class: 'btn small', text: '🎲 Genera incontro', onclick: () => generateDialog((rows) => encounterDialog(S.normalizeEncounter({ name: 'Incontro generato', creatures: rows }), (saved) => { s.encounters.push(saved); drawEnc(); })) }))),
      el('fieldset', {}, el('legend', { text: 'NPC presenti' }), npcChecks.length ? el('div', { class: 'check-row' }, npcChecks) : el('p', { class: 'muted small', text: 'Nessun NPC nel Mondo.' })),
      el('fieldset', {}, el('legend', { text: 'Eventi e luoghi' }), eventChecks.length ? el('div', { class: 'check-row' }, eventChecks) : el('p', { class: 'muted small', text: 'Nessun evento negli Asset.' }), field('Città', city)),
      el('fieldset', {}, el('legend', { text: 'Tesori e ricompense' }), treasure.node),
      el('fieldset', {}, el('legend', { text: 'Quest e reputazione' }), effBox),
      el('fieldset', {}, el('legend', { text: 'Collegamenti alle scene successive' }), linkBox),
      el('label', { class: 'check' }, shared, ' Condividi con tutte le sessioni (modello)'),
      error,
      el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: done }), el('button', { type: 'submit', class: 'btn primary', text: 'Salva scena' })));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const cells = entry.value.trim() ? S.parseCells(entry.value) : { cells: [], bad: [] };
      if (!title.value.trim()) { error.textContent = 'Il titolo è obbligatorio.'; title.focus(); return; }
      if (cells.bad.length || cells.cells.length > 1) { error.textContent = 'Punto di entrata: una cella come «B4».'; entry.focus(); return; }
      const data = S.normalizeScene(Object.assign(s, {
        title: title.value.trim(), kind: kind.value, status: status.value, duration: readNumber(duration) || 0,
        tags: tags.value.split(',').map((x) => x.trim()).filter(Boolean), readAloud: editor.getHtml(), pageId: page.value,
        map: { gridId: grid.value, entry: cells.cells[0] || null }, npcIds: npcChecks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value),
        eventIds: eventChecks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value), cityId: city.value, treasure: treasure.read(), shared: shared.checked,
      }));
      save((x) => { const i = x.scenes.findIndex((y) => y.id === data.id); if (i >= 0) x.scenes[i] = data; else x.scenes.push(data); });
      toast('Scena salvata.', 'success');
      viewing = data.id;
      done();
    });
    host.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica scena' : 'Nuova scena' })), form);
    title.focus();
  }
  // Modifica di un incontro della scena dalla vista.
  function editSceneEncounter(sceneId, encId) {
    const s = sceneById(sceneId);
    const e = s && s.encounters.find((x) => x.id === encId);
    if (e) encounterDialog(clone(e), (saved) => { save((x) => { const sc = x.scenes.find((y) => y.id === sceneId); const i = sc.encounters.findIndex((y) => y.id === encId); sc.encounters[i] = Object.assign(saved, { run: sc.encounters[i].run }); }); render(); });
  }

  // Editor del tesoro: PE a mano, monete, oggetti dell'Attrezzatura.
  function rewardEditor(r) {
    const xp = numberInput(r.xp || 0, { min: 0, class: 'qty', 'aria-label': 'PE a mano' });
    const coins = Object.fromEntries(A.CURRENCIES.map((k) => [k, numberInput(r.coins[k] || 0, { min: 0, class: 'qty', 'aria-label': 'Monete ' + k })]));
    const items = r.items.map((x) => Object.assign({}, x));
    const box = el('ul', { class: 'pick-list' });
    const draw = () => fill(box, items.map((it, i) => el('li', {},
      numberInput(it.qty, { min: 1, max: 999, class: 'qty', 'aria-label': 'Quantità', oninput: (e) => { it.qty = readNumber(e.target) || 1; } }), ' ',
      (st().equipment.find((e) => e.id === it.equipmentId) || { name: '⚠ oggetto eliminato' }).name, ' ',
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli l\'oggetto', onclick: () => { items.splice(i, 1); draw(); } }))));
    draw();
    const add = el('select', { 'aria-label': 'Aggiungi un oggetto' }, opt('', '+ Oggetto dell\'Attrezzatura…', true), st().equipment.map((e) => opt(e.id, e.name, false)));
    add.addEventListener('change', () => { if (add.value) { items.push({ equipmentId: add.value, qty: 1 }); draw(); } add.value = ''; });
    return {
      node: el('div', {}, el('div', { class: 'input-row' }, el('label', { class: 'inline small' }, 'PE ', xp), A.CURRENCIES.map((k) => el('label', { class: 'inline small' }, k + ' ', coins[k]))), box, add),
      read: () => ({ xp: readNumber(xp) || 0, coins: Object.fromEntries(A.CURRENCIES.map((k) => [k, readNumber(coins[k]) || 0])), items: items.map((x) => ({ equipmentId: x.equipmentId, qty: x.qty })) }),
    };
  }

  // ---------- Editor dell'incontro (libreria e copie nelle scene) ----------
  // Righe di creature con quantità, partenza, fazione e IA; difficoltà in tempo reale col party attivo (con
  // Bilancia); tesoro, note, tattica, condizioni di inizio e di fine. onSave(incontro normalizzato).
  function encounterFields(e0) {
    const e = clone(e0);
    const v = DnD.fazioni.view(st());
    const npcs = DnD.sessioni.visible(st(), 'npcs');
    const typeName = (n) => (n.type === 'boss' ? 'Boss' : n.type === 'creatura' ? 'Creatura' : 'Standard');
    const indicator = DnD.uiDifficolta.indicator({ title: 'Difficoltà col party', onBalance: () => {
      const input = S.difficultyInput(st(), e, players(), session().id);
      DnD.uiDifficolta.balanceDialog(input, (i, count) => { const row = e.creatures.find((r) => r.id === input.creatures[i].id); if (row) { row.qty = Math.max(1, count); drawRows(); } }, 50);
    } });
    const refresh = () => indicator.update(S.difficultyInput(st(), e, players(), session().id));
    const rowsBox = el('div', { class: 'enc-rows' });
    const drawRows = () => {
      fill(rowsBox, e.creatures.map((r, i) => {
        const src = S.sourceOf(st(), r);
        const cells = textInput(S.cellsText(r.start.cells), { maxlength: 200, placeholder: 'es. P5, P6', 'aria-label': 'Celle di partenza', class: 'enc-cells', disabled: r.start.kind !== 'celle',
          onchange: (ev) => { const p = S.parseCells(ev.target.value); r.start.cells = p.cells; ev.target.classList.toggle('invalid', p.bad.length > 0); ev.target.title = p.bad.length ? 'Non valide: ' + p.bad.join(', ') : ''; } });
        return el('div', { class: 'enc-row' + (src ? '' : ' missing') },
          el('select', { 'aria-label': 'Creatura', onchange: (ev) => { const [k, id] = ev.target.value.split(':'); r.ref = { kind: k, id }; if (k === 'mondo') r.qty = 1; drawRows(); } },
            src ? null : opt('', '⚠ creatura eliminata', true),
            el('optgroup', { label: 'Nemici' }, npcs.map((n) => opt('npc:' + n.id, n.name + ' (' + typeName(n) + ', GS ' + DnD.difficolta.crOf(n) + ')', r.ref.kind === 'npc' && r.ref.id === n.id))),
            v.npcs.length ? el('optgroup', { label: 'NPC del Mondo (entrano ostili)' }, v.npcs.map((n) => opt('mondo:' + n.id, n.name, r.ref.kind === 'mondo' && r.ref.id === n.id))) : null),
          numberInput(r.qty, { min: 1, max: 50, class: 'qty', 'aria-label': 'Quantità', disabled: r.ref.kind === 'mondo', oninput: (ev) => { r.qty = Math.max(1, Math.min(50, readNumber(ev.target) || 1)); refresh(); } }),
          el('select', { 'aria-label': 'Partenza', onchange: (ev) => { r.start.kind = ev.target.value; drawRows(); } }, opt('zona', 'Zona dei nemici', r.start.kind === 'zona'), opt('celle', 'Celle scelte', r.start.kind === 'celle')),
          cells,
          el('select', { 'aria-label': 'Fazione', onchange: (ev) => { r.faction = ev.target.value; refresh(); } }, opt('', 'Fazione della scheda', !r.faction), v.factions.map((f) => opt(f.id, f.name, f.id === r.faction))),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: r.ai, onchange: (ev) => { r.ai = ev.target.checked; } }), ' IA'),
          el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli la riga', onclick: () => { e.creatures.splice(i, 1); drawRows(); } }));
      }), el('div', { class: 'input-row' },
        el('button', { type: 'button', class: 'btn small', text: '+ Creatura', disabled: !npcs.length || e.creatures.length >= K.MAX.creatures, onclick: () => { e.creatures.push(S.normalizeRow({ ref: { kind: 'npc', id: npcs[0].id } })); drawRows(); } }),
        el('button', { type: 'button', class: 'btn small', text: '🎲 Genera', onclick: () => generateDialog((rows) => { e.creatures = rows; drawRows(); }) })));
      refresh();
    };
    drawRows();
    const name = textInput(e.name, { maxlength: 80, 'data-key': 'name' });
    const reward = rewardEditor(e.rewards);
    const notes = el('textarea', { rows: 2, value: e.notes, maxlength: 3000 });
    const tactics = el('textarea', { rows: 2, value: e.tactics, maxlength: 3000, placeholder: 'Come combattono, quando fuggono…' });
    const surprised = el('select', {}, K.SURPRISE.map((k) => opt(k, K.SURPRISE_NAMES[k], k === e.start.surprised)));
    const hidden = el('input', { type: 'checkbox', checked: e.start.hidden });
    const light = el('select', {}, K.LIGHTS.map((k) => opt(k, K.LIGHT_NAMES[k], k === e.start.light)));
    const weather = textInput(e.start.weather, { maxlength: 60, placeholder: 'es. pioggia' });
    const hour = numberInput(e.start.hour === null ? '' : e.start.hour, { min: 0, max: 23, class: 'qty', placeholder: '—' });
    const endBox = el('div', {});
    const drawEnd = () => fill(endBox, e.end.map((x, i) => el('div', { class: 'input-row' },
      el('select', { 'aria-label': 'Condizione di fine', onchange: (ev) => { e.end[i] = S.normalizeEnd({ id: x.id, kind: ev.target.value }); drawEnd(); } }, K.OUTCOMES.map((o) => opt(o, K.OUTCOME_NAMES[o], o === x.kind))),
      x.kind === 'round' || x.kind === 'obiettivo' ? el('label', { class: 'inline small' }, 'dopo il round ', numberInput(x.rounds, { min: 0, max: 1000, class: 'qty', oninput: (ev) => { x.rounds = readNumber(ev.target) || 0; } })) : null,
      x.kind === 'obiettivo' ? textInput(x.text, { maxlength: 200, placeholder: 'es. sopravvivere 5 round', 'aria-label': 'Obiettivo', oninput: (ev) => { x.text = ev.target.value; } }) : null,
      el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli la condizione', onclick: () => { e.end.splice(i, 1); drawEnd(); } }))),
    el('button', { type: 'button', class: 'btn small', text: '+ Condizione di fine', onclick: () => { e.end.push(S.normalizeEnd({ kind: 'fuga' })); drawEnd(); } }));
    drawEnd();
    const node = el('div', { class: 'form enc-form' },
      field('Nome', name, 'name'),
      el('fieldset', {}, el('legend', { text: 'Creature' }), rowsBox,
        el('p', { class: 'muted small', text: 'Celle scelte: una per copia, come sulla griglia («P5, P6»); le altre copie vanno nella zona «Partenza nemici».' })),
      indicator.node,
      el('fieldset', {}, el('legend', { text: 'Condizioni di inizio' }),
        el('div', { class: 'grid-3' }, field('Sorpresi', surprised), field('Luce', light), field('Meteo', weather), field('Ora (0-23)', hour)),
        el('label', { class: 'check small' }, hidden, ' Nemici nascosti ai giocatori')),
      el('fieldset', {}, el('legend', { text: 'Condizioni di fine (con l\'esito che porta alla scena successiva)' }), endBox),
      el('fieldset', {}, el('legend', { text: 'Tesoro e ricompense' }), reward.node, el('p', { class: 'muted small', text: 'Si sommano ai PE dei nemici sconfitti a fine combattimento.' })),
      field('Tattica', tactics), field('Note', notes));
    const read = () => S.normalizeEncounter(Object.assign(e, {
      name: name.value.trim() || 'Incontro', rewards: reward.read(), notes: notes.value, tactics: tactics.value,
      start: { surprised: surprised.value, hidden: hidden.checked, light: light.value, weather: weather.value.trim(), hour: hour.value.trim() === '' ? null : readNumber(hour) },
    }));
    return { node, read };
  }
  function encounterDialog(e0, onSave) {
    const f = encounterFields(e0);
    openDialog('Incontro', f.node, [{ text: 'Annulla' }, { text: 'Salva incontro', class: 'primary', onclick: () => { onSave(f.read()); return undefined; } }]).classList.add('wide');
  }

  // ---------- Libreria degli incontri ----------
  function encounterList(host) {
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { const f = importInput.files[0]; importInput.value = ''; if (f) importEncounter(f); } });
    const list = library();
    host.append(el('div', { class: 'section-head' }, el('h2', { text: 'Incontri' }),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn', text: '⬆ Importa JSON', onclick: () => importInput.click() }), importInput,
        el('button', { class: 'btn', text: '🎲 Genera incontro', onclick: () => generateDialog((rows) => { editingEnc = { draft: S.normalizeEncounter({ name: 'Incontro generato', creatures: rows }) }; render(); }) }),
        el('button', { class: 'btn primary', text: '+ Nuovo incontro', onclick: () => { editingEnc = 'new'; render(); } }))),
    el('p', { class: 'muted small', text: 'Gli incontri della libreria sono modelli: aggiungerli a una scena ne crea una copia indipendente. Difficoltà calcolata con il party attivo.' }),
    list.length ? el('div', { class: 'card-grid' }, list.map((e) => {
      const r = S.evaluate(st(), e, players(), session().id);
      const missing = S.encounterMissing(st(), e);
      return el('article', { class: 'card' },
        el('div', { class: 'card-title' }, el('h3', { text: e.name }), el('span', { class: 'diff-badge' + (r.band ? ' diff-' + r.band : ''), text: r.band ? DnD.difficolta.bandName(r.band) : '—' })),
        el('p', { class: 'small', text: e.creatures.map((row) => row.qty + '× ' + ((S.sourceOf(st(), row) || {}).name || '⚠ eliminata')).join(', ') || 'Nessuna creatura' }),
        el('p', { class: 'muted small', text: DnD.creature.formatXp(r.rawXp) + ' PE (' + DnD.creature.formatXp(r.perPlayerXp) + ' a testa) · ' + DnD.creature.formatXp(r.adjustedXp) + ' modificati' }),
        missing.length ? el('p', { class: 'warn small', text: '⚠ ' + missing.join(', ') }) : null,
        el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: e.shared, onchange: (ev) => { save(() => { e.shared = ev.target.checked; }); render(); } }), ' Condividi con tutte le sessioni'),
        el('div', { class: 'card-actions' },
          el('button', { class: 'btn', text: 'Modifica', onclick: () => { editingEnc = e.id; render(); } }),
          el('button', { class: 'btn', text: 'Duplica', onclick: () => { save((x) => { x.encounters.push(S.normalizeEncounter(Object.assign(clone(e), { id: DnD.dadi.uid(), name: (e.name + ' (copia)').slice(0, 80), shared: false, sessionId: session(x).id }))); }); render(); } }),
          el('button', { class: 'btn', text: 'Esporta', onclick: () => exportEncounter(e) }),
          el('button', { class: 'btn danger', text: 'Elimina', onclick: () => { if (confirm('Eliminare l\'incontro «' + e.name + '»? Le copie già nelle scene restano.')) { save((x) => { x.encounters = x.encounters.filter((y) => y.id !== e.id); }); render(); } } })));
    })) : el('p', { class: 'empty', text: 'Nessun incontro nella libreria.' }));
  }
  function encounterLibraryForm(host) {
    const existing = typeof editingEnc === 'string' && editingEnc !== 'new' ? library().find((e) => e.id === editingEnc) : null;
    const base = existing || (editingEnc && editingEnc.draft) || S.normalizeEncounter({ name: '' });
    const f = encounterFields(base);
    const done = () => { editingEnc = null; render(); };
    host.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica incontro' : 'Nuovo incontro' })),
      el('div', { class: 'panel' }, f.node, el('div', { class: 'form-actions' },
        el('button', { class: 'btn', text: 'Annulla', onclick: done }),
        el('button', { class: 'btn primary', text: 'Salva incontro', onclick: () => {
          const data = Object.assign(f.read(), { sessionId: existing ? existing.sessionId : session().id, shared: existing ? existing.shared : false, run: null, templateId: '' });
          save((x) => { const i = x.encounters.findIndex((y) => y.id === data.id); if (i >= 0) x.encounters[i] = data; else x.encounters.push(data); });
          toast('Incontro salvato.', 'success');
          done();
        } }))));
  }
  function exportEncounter(e) {
    const data = { app: DnD.config.APP_NAME, kind: 'incontro', version: DnD.dati.VERSION, exportedAt: new Date().toISOString(), encounter: e };
    DnD.uiImpostazioni.download(JSON.stringify(data, null, 2), DnD.uiImpostazioni.slug(DnD.config.APP_NAME) + '-incontro-' + DnD.uiImpostazioni.slug(e.name) + '.json');
    toast('«' + e.name + '» esportato.', 'success');
  }
  async function importEncounter(file) {
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || raw.kind !== 'incontro' || !raw.encounter || typeof raw.encounter !== 'object') throw new Error('il file non contiene un incontro di questa app.');
      const e = Object.assign(S.normalizeEncounter(raw.encounter), { id: DnD.dadi.uid(), sessionId: session().id, shared: false, run: null });
      save((x) => { x.encounters.push(e); });
      const missing = S.encounterMissing(st(), e);
      toast('«' + e.name + '» importato.' + (missing.length ? ' ⚠ ' + missing.join(', ') + '.' : ''), missing.length ? 'error' : 'success');
      render();
    } catch (err) {
      toast('Importazione non riuscita: ' + err.message, 'error');
    }
  }

  // ---------- Genera incontro ----------
  function generateDialog(onUse) {
    const target = el('select', { 'aria-label': 'Difficoltà' }, DnD.difficoltaDati.THRESHOLD_BANDS.map((b) => opt(b, DnD.difficolta.bandName(b), b === 'medio')));
    const npcs = DnD.sessioni.visible(st(), 'npcs');
    const types = [...new Set(npcs.map((c) => (DnD.boss.isMonster(c) ? c.ctype : 'umanoide')))].sort();
    const theme = el('select', { 'aria-label': 'Tema' }, opt('', 'Tutte le creature', true),
      el('optgroup', { label: 'Per tipo' }, types.map((t) => opt('tipo:' + t, t, false))),
      (st().biomes || []).length ? el('optgroup', { label: 'Per bioma (tabella degli incontri)' }, st().biomes.map((b) => opt('bioma:' + b.id, b.name, false))) : null);
    const out = el('div', { 'aria-live': 'polite' });
    let dialog = null;
    const run = () => {
      const res = S.generate(st(), session().id, { players: players(), target: target.value, theme: theme.value });
      fill(out, res.options.length ? el('ul', { class: 'pick-list' }, res.options.map((o) => el('li', {},
        el('b', { text: o.names.join(' + ') }), ' ', el('span', { class: 'diff-badge diff-' + o.result.band, text: DnD.difficolta.bandName(o.result.band) }),
        el('span', { class: 'muted small', text: ' ' + DnD.creature.formatXp(o.result.adjustedXp) + ' PE modificati · ' + DnD.creature.formatXp(o.result.rawXp) + ' grezzi ' }),
        el('button', { type: 'button', class: 'btn small primary', text: 'Usa', onclick: () => { dialog.dismiss(); onUse(o.rows); } }))))
        : el('p', { class: 'empty', text: 'Nessun gruppo adatto con queste creature: prova un\'altra difficoltà o un altro tema.' }),
      res.total > res.options.length ? el('p', { class: 'muted small', text: res.total + ' gruppi possibili: ne vedi ' + res.options.length + ' a caso.' }) : null);
    };
    dialog = openDialog('Genera incontro', el('div', { class: 'form' },
      el('p', { class: 'muted small', text: 'Propone gruppi dalla libreria della sessione con PE adatti al party (' + players().map((p) => p.name + ' liv. ' + p.level).join(', ') + '). Poi l\'incontro resta modificabile.' }),
      el('div', { class: 'input-row' }, el('label', { class: 'inline' }, 'Difficoltà ', target), el('label', { class: 'inline' }, 'Tema ', theme),
        el('button', { type: 'button', class: 'btn', text: '🎲 Genera', onclick: run })), out), [{ text: 'Chiudi' }]);
    dialog.classList.add('wide');
    run();
  }

  // Apre una scena (dalla pagina delle note).
  function openScene(id) {
    tab = 'scaletta';
    editing = null;
    viewing = id;
    DnD.app.navigate('scene');
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.scene = {
    title: 'Scene', render,
    reset: () => { editing = null; editingEnc = null; },
    open: (action) => { if (action === 'nuovo') { tab = 'scaletta'; editing = 'new'; } },
  };
  DnD.uiScene = { render, openScene, launchScene, launchEncounter, onCombatEnded, rewardsDialog, generateDialog };
})(globalThis.DnD = globalThis.DnD || {});
