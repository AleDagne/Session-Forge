// Giocatori › Leggendari: personaggi di livello 20-40 con Percorso leggendario e Trasformazioni. Grafica
// "divina" (css/leggendario.css) che riusa i componenti del Boss (cornice, spade, barra) con temi propri:
// Divino, Angelico, Abissale, Draconico, Cosmico. Elenco, promozione/declassamento, scheda con quattro parti
// (Scheda del giocatore, Percorso, Trasformazioni, Opzioni del master), animazione di Ascensione; nel
// combattimento: Trasformati / Torna normale (con annulla/ripeti), alone dorato e aureola sulla pedina.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const L = DnD.leggendario;
  const P = DnD.percorso;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const motionOff = () => DnD.impostazioni.reduceMotion() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Temi: oro e luce (gold), riflesso (light), alone (glow), fondo (bg); le variabili del Boss si allineano
  // così cornici e spade diventano «lance di luce».
  const THEMES = {
    divino: { gold: '#f2c94c', light: '#fff8e1', glow: 'rgba(255, 222, 140, 0.55)', bg: '#0c0a06', accent: '#e8b84a' },
    angelico: { gold: '#bfe3ff', light: '#ffffff', glow: 'rgba(190, 230, 255, 0.55)', bg: '#070b12', accent: '#8fd0ff' },
    abissale: { gold: '#b48cff', light: '#efe3ff', glow: 'rgba(140, 80, 230, 0.55)', bg: '#07040d', accent: '#8e5cc9' },
    draconico: { gold: '#f2b23c', light: '#fff1d0', glow: 'rgba(230, 90, 40, 0.5)', bg: '#0d0605', accent: '#e0322b' },
    cosmico: { gold: '#9fa8ff', light: '#eef0ff', glow: 'rgba(110, 120, 255, 0.5)', bg: '#05051a', accent: '#5c6cff' },
  };
  function themeStyle(id) {
    const t = THEMES[id] || THEMES.divino;
    return ['--lg-gold:' + t.gold, '--lg-light:' + t.light, '--lg-glow:' + t.glow, '--lg-bg:' + t.bg, '--lg-accent:' + t.accent,
      '--boss-accent:' + t.gold, '--boss-glow:' + t.light, '--boss-shadow:' + t.glow, '--boss-frame:' + t.accent, '--boss-bg:' + t.bg,
      '--boss-steel:' + t.light, '--boss-steel-dark:' + t.gold, '--boss-grip:' + t.accent].join(';');
  }
  function applyTheme(node, id) {
    node.classList.add('boss-theme', 'legend-theme');
    node.setAttribute('style', themeStyle(id));
    node.dataset.legendTheme = id;
    return node;
  }

  // ---------- Componenti grafici ----------
  function svg(markup, cls, viewBox) {
    const n = document.createElementNS(SVG_NS, 'svg');
    n.setAttribute('class', cls);
    n.setAttribute('viewBox', viewBox);
    n.setAttribute('aria-hidden', 'true');
    n.innerHTML = markup;
    return n;
  }
  // Ali e aureola stilizzate sopra il titolo.
  const WINGS = (() => {
    const feathers = (side) => Array.from({ length: 7 }, (_, i) => {
      const len = 70 - i * 7;
      const ang = -10 - i * 11;
      return '<path transform="translate(' + (side * 18) + ' 40) scale(' + side + ' 1) rotate(' + ang + ')" d="M0 0 Q' + (len * 0.55) + ' -9 ' + len + ' 0 Q' + (len * 0.55) + ' 5 0 0Z" fill="currentColor" opacity="' + (0.95 - i * 0.09).toFixed(2) + '"/>';
    }).join('');
    return '<g transform="translate(120 10)">' + feathers(1) + feathers(-1) + '</g>' +
      '<ellipse cx="120" cy="22" rx="26" ry="7" fill="none" stroke="currentColor" stroke-width="3"/><ellipse cx="120" cy="22" rx="32" ry="10" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5"/>';
  })();
  const wings = () => svg(WINGS, 'legend-wings', '0 0 240 70');

  function forge(title, subtitle, themeId) {
    const node = applyTheme(el('div', { class: 'boss-forge legend-forge' }), themeId || 'divino');
    node.append(el('div', { class: 'legend-rays', 'aria-hidden': 'true' }), el('div', { class: 'legend-dust', 'aria-hidden': 'true' }),
      el('header', { class: 'boss-forge-head legend-head' }, wings(),
        el('h1', { class: 'boss-title legend-title', text: title }), subtitle ? el('p', { class: 'boss-subtitle', text: subtitle }) : null));
    return node;
  }
  const frame = (title, content, opts) => DnD.uiBoss.frame(title, content, Object.assign({ class: 'legend-frame' }, opts || {}));
  const divider = () => el('div', { class: 'boss-divider legend-divider', role: 'presentation' });

  // Ascensione (nuovo leggendario o promozione): colonna di luce, tremolio leggero, comparsa del nome.
  function ascension(c, done) {
    if (motionOff()) { done(); return; }
    const overlay = applyTheme(el('div', { class: 'legend-ascension', role: 'dialog', 'aria-label': 'Ascensione di ' + c.name, tabindex: -1 },
      el('div', { class: 'legend-column', 'aria-hidden': 'true' }), wings(),
      el('div', { class: 'boss-summon-name legend-ascension-name' }, el('b', { text: c.name }), el('span', { text: c.legend && c.legend.title ? c.legend.title : 'Ascende al rango leggendario' })),
      el('div', { class: 'boss-summon-skip', text: 'Clic o Esc per continuare' })), c.legend ? c.legend.theme : 'divino');
    let closed = false;
    const close = () => { if (closed) return; closed = true; overlay.remove(); done(); };
    overlay.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) close(); });
    document.body.appendChild(overlay);
    overlay.focus();
    setTimeout(close, 3200);
  }
  // Trasformazione nel combattimento: lampo e ali che si aprono.
  function transformFlash(themeId) {
    if (motionOff() || !DnD.impostazioni.bossEffects()) return;
    const f = applyTheme(el('div', { class: 'legend-transform-flash', 'aria-hidden': 'true' }, wings()), themeId || 'divino');
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  // Alone dorato e aureola sulla pedina del leggendario.
  function drawHalo(ctx, t, cx, cy, dw, dh, top) {
    const th = THEMES[t.legend.theme] || THEMES.divino;
    const r = Math.max(dw, dh) / 2;
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.1);
    g.addColorStop(0, th.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, dw / 2 * 1.1, dh / 2 * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = th.gold;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.beginPath();
    ctx.ellipse(cx, top + Math.max(3, r * 0.12), r * 0.42, r * 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Sezione ----------
  let root = null;
  let api = null;
  let viewing = null;     // id del leggendario aperto
  let part = 'scheda';    // scheda | percorso | trasformazioni | maestro
  let pathMode = 'sblocca';
  let editingForm = null; // id della trasformazione in modifica
  let pathWidget = null;
  let pathFor = null;

  const st = () => DnD.store.state;
  const session = () => DnD.sessioni.current(st());
  const list = () => DnD.sessioni.visible(st(), 'players').filter((c) => c.type === 'leggendario');
  const byId = (id) => st().players.find((p) => p.id === id);
  const update = (id, fn) => DnD.store.update((s) => { const p = s.players.find((x) => x.id === id); if (p) fn(p, s); });

  function render(container, a) {
    root = container || root;
    api = a || api;
    clear(root);
    const c = viewing && list().find((x) => x.id === viewing);
    if (c) renderSheet(c);
    else { viewing = null; renderList(); }
  }

  function promote(c) {
    const r = L.promote(c);
    if (!r.ok) { toast('Non si può elevare: ' + r.reason + '.', 'error'); return false; }
    if (!confirm('Elevare «' + c.name + '» a personaggio leggendario (livelli 20-40, Percorso e Trasformazioni)?')) return false;
    const saved = DnD.dati.normalizeCreature(r.player, true);
    DnD.store.update((s) => { const i = s.players.findIndex((x) => x.id === c.id); s.players[i] = saved; });
    viewing = saved.id;
    part = 'scheda';
    ascension(saved, () => { if (root && root.isConnected) render(); });
    return true;
  }
  function demote(c) {
    if (!confirm('Declassare «' + c.name + '» a giocatore standard (livello massimo 20)? Percorso e trasformazioni restano conservati per una nuova promozione.')) return;
    const saved = DnD.dati.normalizeCreature(L.demote(c), true);
    DnD.store.update((s) => { const i = s.players.findIndex((x) => x.id === c.id); s.players[i] = saved; });
    viewing = null;
    toast('«' + c.name + '» è tornato giocatore standard.');
    api.refresh();
  }

  function renderList() {
    const all = list();
    const f = forge('I Leggendari', 'Oltre il ventesimo livello', 'divino');
    const newOne = () => {
      const c = DnD.dati.normalizeCreature({ name: '', type: 'leggendario', level: 20, maxHp: 150, ac: 18, acMode: 'manuale', saveMode: 'classe', sessionId: session().id }, true);
      openForm(c, true);
    };
    f.append(
      el('div', { class: 'section-head' }, el('h2', { text: 'Personaggi leggendari' }),
        el('div', { class: 'head-actions' }, el('button', { class: 'btn primary legend-ascend-btn', text: '✦ Nuovo leggendario', onclick: newOne }))),
      el('p', { class: 'muted small', text: 'Un giocatore standard di livello 20 si eleva con «✦ Eleva a leggendario» dalla scheda Standard.' }),
      divider(),
      all.length ? el('div', { class: 'card-grid' }, all.map((c) => {
        const pts = L.points(c);
        const card = applyTheme(el('article', { class: 'card legend-card' }), c.legend.theme);
        card.append(
          el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(c.icon, 36), el('h3', { text: c.name }),
            c.shared ? el('span', { class: 'tag', text: 'Condiviso' }) : null)),
          c.legend.title ? el('p', { class: 'boss-card-title', text: c.legend.title }) : '',
          el('p', { class: 'muted small', text: [DnD.classi.className(c.classId), 'livello ' + c.level, 'rango ' + L.rank(c)].filter(Boolean).join(' · ') }),
          el('p', { class: 'small', text: '✦ ' + (c.legend.unlocked.length - 1) + (c.legend.unlocked.length === 2 ? ' nodo sbloccato' : ' nodi sbloccati') + ' · punti ' + pts.left + '/' + pts.total + ' · ' + c.legend.transformations.length + ' trasformazioni' }),
          el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: c.shared, onchange: (e) => { update(c.id, (p) => { p.shared = e.target.checked; }); render(); } }), ' Condividi con tutte le sessioni'),
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn primary', text: 'Apri', onclick: () => { viewing = c.id; part = 'scheda'; render(); } }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => {
              const copy = Object.assign(clone(c), { id: DnD.dadi.uid(), name: (c.name + ' (copia)').slice(0, 60), sessionId: session().id, shared: false });
              DnD.store.update((s) => { s.players.push(copy); });
              render();
            } }),
            el('button', { class: 'btn', text: 'Declassa', onclick: () => demote(c) }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => { if (confirm('Eliminare «' + c.name + '»?')) { DnD.store.update((s) => { s.players = s.players.filter((x) => x.id !== c.id); }); render(); } } })));
        return card;
      })) : el('p', { class: 'empty', text: 'Nessun leggendario in questa sessione.' }));
    root.append(f);
  }

  // Form del giocatore (stesso di Giocatori) dentro la cornice divina.
  function openForm(c, isNew) {
    clear(root);
    const f = forge(isNew ? 'Ascensione' : c.name, isNew ? 'Un nuovo leggendario' : 'Scheda del leggendario', c.legend.theme);
    root.append(f);
    api.renderForm({
      player: c, host: f, heading: isNew ? 'Nuovo leggendario' : 'Modifica scheda', submitText: isNew ? '✦ Ascendi' : 'Salva', submitClass: 'legend-ascend-btn',
      wrap: (head, form) => frame('Scheda del personaggio', [head, form], { sideSwords: true }),
      onDone: (saved) => {
        if (saved && isNew) { viewing = saved.id; ascension(saved, () => render()); return; }
        render();
      },
    });
  }

  function renderSheet(c) {
    const pts = L.points(c);
    const f = forge(c.name, [c.legend.title, DnD.classi.className(c.classId), 'livello ' + c.level + ' · rango leggendario ' + L.rank(c)].filter(Boolean).join(' · '), c.legend.theme);
    const tabs = [['scheda', 'Scheda'], ['percorso', '✦ Percorso'], ['trasformazioni', '🜂 Trasformazioni'], ['maestro', 'Opzioni del master']];
    f.append(
      el('div', { class: 'section-head no-print' },
        el('button', { class: 'btn', text: '← Elenco', onclick: () => { viewing = null; render(); } }),
        el('div', { class: 'legend-points', text: 'Punti percorso: ' + pts.left + ' disponibili · ' + pts.spent + ' spesi su ' + pts.total })),
      DnD.uiAsset.tabBar(tabs.map(([id, label]) => ({ id, label })), part, 'Parti del leggendario', 'leggendario-', (id) => { part = id; editingForm = null; render(); }));
    const body = el('div', { role: 'tabpanel' });
    f.append(body);
    root.append(f);
    if (part === 'percorso') renderPath(c, body);
    else if (part === 'trasformazioni') renderTransformations(c, body);
    else if (part === 'maestro') renderMaster(c, body);
    else renderSummary(c, body);
  }

  // Scheda: riepilogo degli effetti (con «da: nodo») e il form del giocatore.
  function renderSummary(c, host) {
    const d = L.derived(c, st());
    const s = d.stats;
    const fx = d.fx;
    host.append(
      frame('Riepilogo leggendario', [
        el('div', { class: 'stat-line' }, DnD.regole.ABILITIES.map((ab) => el('span', { class: 'stat' }, el('b', { text: ab }), ' ' + s.abilities[ab] + ' (' + DnD.regole.formatModifier(DnD.regole.modifier(s.abilities[ab])) + ')'))),
        el('p', {}, 'CA ', el('b', { text: String(s.ac.total) }), ' · PF ', el('b', { text: String(d.effective.maxHp) }), ' · competenza ', el('b', { text: DnD.regole.formatModifier(s.profBonus) }),
          s.spell ? ' · CD incantesimi ' + s.spell.dc + ' · slot ' + s.spell.slotsTotal.map((n, i) => (n ? (i + 1) + '°×' + n : '')).filter(Boolean).join(' ') : ''),
        fx.sources.length ? el('ul', { class: 'legend-sources' }, fx.sources.map((x) => el('li', {}, x.label, el('span', { class: 'muted small', text: ' — da: ' + x.from })))) : el('p', { class: 'muted small', text: 'Nessun effetto: sblocca nodi nel Percorso.' }),
        fx.features.length ? el('div', {}, el('b', { text: 'Privilegi leggendari' }), el('ul', {}, fx.features.map((x) => el('li', {}, el('b', { text: x.name }), ' (' + P.FEATURE_TYPE_NAMES[x.type] + ', ' + (x.uses.kind === 'volonta' ? 'a volontà' : x.uses.n + ' ' + P.USES_NAMES[x.uses.kind]) + ')' + (x.desc ? ': ' + x.desc : ''))))) : null,
        fx.texts.length ? el('ul', {}, fx.texts.map((x) => el('li', { text: x.text + ' (da: ' + x.from + ')' }))) : null,
        fx.missing.length ? el('ul', { class: 'warn-text small' }, fx.missing.map((m) => el('li', { text: '⚠ ' + m }))) : null,
      ], { swords: false }),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', text: 'Modifica scheda (razza, classe, caratteristiche, PF, CA…)', onclick: () => openForm(c, false) })));
  }

  // Percorso: modalità Sblocca (gioco) o Modifica (editor), modelli ed esportazione.
  function renderPath(c, host) {
    const id = c.id;
    const cur = () => byId(id);
    if (!pathWidget || pathFor !== id + ':' + pathMode) {
      pathFor = id + ':' + pathMode;
      pathWidget = DnD.uiPercorso.create({
        mode: pathMode,
        getPath: () => cur().legend.path,
        setPath: (p) => { update(id, (x) => { x.legend.path = p; const ids = new Set(p.nodes.map((n) => n.id)); x.legend.unlocked = x.legend.unlocked.filter((u) => ids.has(u)); }); },
        getUnlocked: () => cur().legend.unlocked,
        ctx: () => ({ rank: L.rank(cur()), bonus: cur().legend.pointsBonus }),
        getTransformations: () => cur().legend.transformations,
        onUnlock: (nodeId) => {
          const r = P.unlock(cur().legend.path, cur().legend.unlocked, nodeId, { rank: L.rank(cur()), bonus: cur().legend.pointsBonus });
          if (!r.ok) { toast(r.reason, 'error'); return false; }
          update(id, (x) => { x.legend.unlocked = r.unlocked; });
          toast('✦ ' + P.nodeById(cur().legend.path, nodeId).name + ' sbloccato.', 'success');
          refreshHead();
          return true;
        },
      });
    }
    const pts = L.points(c);
    const refreshHead = () => { const p = L.points(cur()); const n = root.querySelector('.legend-points'); if (n) n.textContent = 'Punti percorso: ' + p.left + ' disponibili · ' + p.spent + ' spesi su ' + p.total; };
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
      const file = importInput.files[0];
      importInput.value = '';
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        if (!raw || raw.kind !== 'percorso' || !raw.path) throw new Error('il file non contiene un percorso di questa app.');
        if (!confirm('Sostituire il percorso con quello del file? I nodi sbloccati tornano al solo Nucleo.')) return;
        update(id, (x) => { x.legend.path = P.normalizePath(raw.path); x.legend.unlocked = P.respec(); });
        pathWidget.reset();
        render();
      } catch (e) { toast('Importazione non riuscita: ' + e.message, 'error'); }
    } });
    host.append(
      el('div', { class: 'path-head' },
        el('div', { class: 'tabs small-tabs', role: 'tablist', 'aria-label': 'Modalità del percorso' },
          ['sblocca', 'editor'].map((m) => el('button', { type: 'button', role: 'tab', class: 'tab' + (pathMode === m ? ' active' : ''), 'aria-selected': String(pathMode === m), text: m === 'sblocca' ? '✦ Sblocca' : '✎ Modifica la mappa',
            onclick: () => { pathMode = m; render(); } }))),
        el('div', { class: 'head-actions' },
          pathMode === 'sblocca' ? el('button', { class: 'btn small', text: '↺ Rimodella', disabled: !c.legend.allowRespec || c.legend.unlocked.length <= 1,
            title: c.legend.allowRespec ? 'Ripristina i punti: resta solo il Nucleo' : 'Il master ha bloccato la rimodellazione (Opzioni del master)',
            onclick: () => { if (confirm('Rimodellare il percorso? Tutti i nodi tornano bloccati e i ' + pts.spent + ' punti spesi tornano disponibili.')) { update(id, (x) => { x.legend.unlocked = P.respec(); }); render(); } } }) : null,
          el('button', { class: 'btn small', text: '💾 Salva come modello', onclick: () => DnD.ui.promptText('Salva come modello di percorso', 'Nome del modello', c.legend.path.name, (name) => {
            DnD.store.update((s) => { s.pathTemplates.push(P.normalizeTemplate({ name, path: cur().legend.path })); });
            toast('Modello «' + name + '» salvato (libreria comune a tutte le sessioni).', 'success');
            return null;
          }) }),
          el('button', { class: 'btn small', text: '⬇ Carica modello…', onclick: () => templateDialog(id) }),
          el('button', { class: 'btn small', text: 'Esporta JSON', onclick: () => DnD.uiImpostazioni.download(JSON.stringify({ app: DnD.config.APP_NAME, kind: 'percorso', version: DnD.dati.VERSION, path: cur().legend.path }, null, 2),
            DnD.uiImpostazioni.slug(DnD.config.APP_NAME) + '-percorso-' + DnD.uiImpostazioni.slug(cur().legend.path.name) + '.json') }),
          el('button', { class: 'btn small', text: 'Importa JSON', onclick: () => importInput.click() }), importInput)),
      pathWidget.node);
    pathWidget.refresh();
  }

  function templateDialog(id) {
    const tpls = st().pathTemplates;
    if (!tpls.length) { toast('Nessun modello di percorso nella libreria.', 'error'); return; }
    const sel = el('select', {}, tpls.map((t) => opt(t.id, t.name + ' (' + (t.path.nodes.length - 1) + ' nodi)', false)));
    openDialog('Carica un modello di percorso', el('div', { class: 'form' }, field('Modello', sel),
      el('p', { class: 'muted small', text: 'Il percorso attuale viene sostituito da una copia del modello; i nodi sbloccati tornano al solo Nucleo.' }),
      el('button', { type: 'button', class: 'btn small danger', text: 'Elimina il modello scelto dalla libreria', onclick: () => {
        const t = tpls.find((x) => x.id === sel.value);
        if (t && confirm('Eliminare il modello «' + t.name + '»?')) { DnD.store.update((s) => { s.pathTemplates = s.pathTemplates.filter((x) => x.id !== t.id); }); document.querySelector('dialog[open]').dismiss(); }
      } })), [
      { text: 'Annulla' },
      { text: 'Carica', class: 'primary', onclick: () => {
        const t = tpls.find((x) => x.id === sel.value);
        update(id, (x) => { x.legend.path = clone(t.path); x.legend.unlocked = P.respec(); });
        if (pathWidget) pathWidget.reset();
        render();
      } },
    ]);
  }

  // ---------- Trasformazioni ----------
  function renderTransformations(c, host) {
    const id = c.id;
    if (editingForm) { editTransformation(c, host); return; }
    const avail = new Set(L.available(c, st()).map((t) => t.id));
    const fromCreature = el('select', { 'aria-label': 'Parti da una creatura' }, opt('', 'Nuova forma vuota', true),
      DnD.sessioni.visible(st(), 'npcs').filter((n) => DnD.boss.isMonster(n)).map((n) => opt(n.id, (n.type === 'boss' ? '👑 ' : '') + n.name + ' (GS ' + n.cr + ')', false)));
    const add = () => {
      const src = st().npcs.find((n) => n.id === fromCreature.value);
      const t = L.normalizeTransformation(src ? { name: 'Forma di ' + src.name, creature: clone(src), icon: src.icon } : { name: 'Forma leggendaria',
        creature: { name: 'Forma', size: 'Grande', hitDice: 20, ac: 18, abilities: { FOR: 24, DES: 16, COS: 22, INT: 10, SAG: 12, CAR: 14 },
          actions: [{ name: 'Colpo radioso', mech: { kind: 'attacco', damages: [{ dice: '3d8', type: 'radioso' }] } }], boss: { theme: 'infernale' } } });
      update(id, (x) => { x.legend.transformations.push(t); });
      editingForm = t.id;
      render();
    };
    const move = (i, d) => update(id, (x) => { const a = x.legend.transformations; if (a[i + d]) [a[i], a[i + d]] = [a[i + d], a[i]]; });
    host.append(
      el('div', { class: 'input-row' }, fromCreature, el('button', { class: 'btn primary', text: '+ Aggiungi trasformazione', onclick: add })),
      c.legend.transformations.length ? el('div', { class: 'card-grid' }, c.legend.transformations.map((t, i) => {
        const card = DnD.uiBoss.applyTheme(el('article', { class: 'card boss-card' }), DnD.boss.THEME_IDS.includes(t.creature.boss.theme) ? t.creature.boss.theme : 'infernale');
        card.append(
          el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(t.icon, 34), el('h3', { text: t.name }))),
          t.epithet ? el('p', { class: 'boss-card-title', text: t.epithet }) : '',
          el('p', { class: 'muted small', text: DnD.creature.typeLine(t.creature) + ' · PF ' + DnD.creature.hpInfo(t.creature).total + (t.hpMode === 'temporanei' ? ' temporanei' : ' (sostituiscono)') + ' · CA ' + t.creature.ac }),
          el('p', { class: 'small', text: t.uses.n + (t.uses.n === 1 ? ' uso' : ' usi') + ' per riposo ' + t.uses.per + ' · ' + t.duration.value + ' ' + t.duration.unit + ' · ' + (t.activation === 'bonus' ? 'azione bonus' : 'azione') +
            (t.minRank ? ' · rango ' + t.minRank : '') + (t.requireNode ? ' · serve un nodo' : '') }),
          el('p', { class: avail.has(t.id) ? 'ok-text small' : 'warn-text small', text: avail.has(t.id) ? '✦ Disponibile' : 'Non ancora disponibile (rango o nodo mancante)' }),
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editingForm = t.id; render(); } }),
            el('button', { class: 'btn', text: '↑', 'aria-label': 'Sposta su', onclick: () => { move(i, -1); render(); } }),
            el('button', { class: 'btn', text: '↓', 'aria-label': 'Sposta giù', onclick: () => { move(i, 1); render(); } }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => { update(id, (x) => { x.legend.transformations.splice(i + 1, 0, Object.assign(clone(t), { id: DnD.dadi.uid(), name: (t.name + ' (copia)').slice(0, 60) })); }); render(); } }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => { if (confirm('Eliminare la trasformazione «' + t.name + '»?')) { update(id, (x) => { x.legend.transformations = x.legend.transformations.filter((y) => y.id !== t.id); }); render(); } } })));
        return card;
      })) : el('p', { class: 'empty', text: 'Nessuna trasformazione. Aggiungine una, anche partendo da una creatura o da un boss esistente.' }));
  }

  // Editor di una trasformazione: regole e scheda boss completa (stesso editor di Creature/Boss).
  function editTransformation(c, host) {
    const id = c.id;
    const t = clone(c.legend.transformations.find((x) => x.id === editingForm));
    if (!t) { editingForm = null; render(); return; }
    const chk = (obj, k, label) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: obj[k], onchange: (e) => { obj[k] = e.target.checked; } }), ' ' + label);
    const themeSel = el('select', { 'aria-label': 'Tema della forma' }, opt('', 'Tema del personaggio', !t.theme),
      L.THEMES.map((x) => opt(x, '✦ ' + L.THEME_NAMES[x], t.theme === x)), DnD.boss.THEME_IDS.map((x) => opt(x, DnD.boss.THEMES[x].name, t.theme === x)));
    const rules = frame('Regole della trasformazione', [
      el('div', { class: 'grid-2 tight' },
        field('Nome', textInput(t.name, { maxlength: 60, oninput: (e) => { t.name = e.target.value; } })),
        field('Epiteto', textInput(t.epithet, { maxlength: 60, oninput: (e) => { t.epithet = e.target.value; } }))),
      el('fieldset', {}, el('legend', { text: 'Regole di fusione' }),
        chk(t.fusion, 'physicalFromForm', 'FOR, DES e COS dalla forma (INT, SAG e CAR dal personaggio)'),
        chk(t.fusion, 'keepProficiency', 'Mantiene le competenze (tiri salvezza)'),
        chk(t.fusion, 'keepSpells', 'Mantiene gli incantesimi'),
        chk(t.fusion, 'keepEquipment', 'Mantiene l\'equipaggiamento (armi)'),
        chk(t.fusion, 'keepFeatures', 'Mantiene i privilegi leggendari e le difese')),
      el('div', { class: 'grid-3 tight' },
        field('PF della forma', el('select', { onchange: (e) => { t.hpMode = e.target.value; } }, opt('sostituisce', 'Sostituiscono i PF (eccesso al personaggio)', t.hpMode === 'sostituisce'), opt('temporanei', 'PF temporanei', t.hpMode === 'temporanei'))),
        field('Usi', el('div', { class: 'input-row' }, numberInput(t.uses.n, { class: 'qty', min: 1, max: 10, oninput: (e) => { t.uses.n = readNumber(e.target) || 1; } }),
          el('select', { 'aria-label': 'Ricarica degli usi', onchange: (e) => { t.uses.per = e.target.value; } }, opt('lungo', 'per riposo lungo', t.uses.per === 'lungo'), opt('breve', 'per riposo breve', t.uses.per === 'breve')))),
        field('Durata', el('div', { class: 'input-row' }, numberInput(t.duration.value, { class: 'qty', min: 1, max: 1000, oninput: (e) => { t.duration.value = readNumber(e.target) || 1; } }),
          el('select', { onchange: (e) => { t.duration.unit = e.target.value; } }, opt('round', 'round', t.duration.unit === 'round'), opt('minuti', 'minuti', t.duration.unit === 'minuti')))),
        field('Attivazione', el('select', { onchange: (e) => { t.activation = e.target.value; } }, opt('azione', 'Azione', t.activation === 'azione'), opt('bonus', 'Azione bonus', t.activation === 'bonus'))),
        field('Rango minimo', numberInput(t.minRank, { min: 0, max: 20, oninput: (e) => { t.minRank = readNumber(e.target) || 0; } })),
        field('Tema', themeSel)),
      chk(t, 'canEndEarly', 'Può terminare in anticipo'),
      chk(t, 'requireNode', 'Richiede un nodo del Percorso che la sblocca (effetto «Sblocca trasformazione»)'),
      el('div', { class: 'grid-2 tight' },
        field('Testo di entrata', el('textarea', { rows: 2, value: t.enterText, oninput: (e) => { t.enterText = e.target.value; } })),
        field('Testo di uscita', el('textarea', { rows: 2, value: t.exitText, oninput: (e) => { t.exitText = e.target.value; } }))),
    ], { swords: false });
    host.append(el('div', { class: 'section-head' }, el('h2', { text: 'Trasformazione: ' + t.name }),
      el('button', { class: 'btn', text: '← Trasformazioni', onclick: () => { editingForm = null; render(); } })), rules, divider());
    const formHost = el('div', {});
    host.append(formHost);
    // Icona e dimensione sulla griglia della forma si scelgono nella scheda boss (un solo posto).
    DnD.uiMostri.monsterForm(formHost, Object.assign(clone(t.creature), { id: t.creature.id || DnD.dadi.uid(), type: 'boss', icon: t.icon, gridSize: t.gridSize }), {
      kind: 'boss', heading: 'Scheda della forma (creatura boss)', submitText: '🜂 Salva la trasformazione', submitClass: 'legend-ascend-btn', savedText: 'Trasformazione salvata.',
      // Il tema boss della forma vale per barra e vignettatura in combattimento: non ricolora la pagina divina.
      extra: (m, ctx) => DnD.uiBoss.bossFields(m, ctx, el('div')),
      wrap: (head, form) => frame('Forma', [head, form], { sideSwords: true }),
      save: (creature) => {
        const saved = L.normalizeTransformation(Object.assign(t, { creature, icon: creature.icon || t.icon, gridSize: creature.gridSize, theme: themeSel.value }));
        update(id, (x) => { const i = x.legend.transformations.findIndex((y) => y.id === saved.id); x.legend.transformations[i] = saved; });
      },
      onDone: () => { editingForm = null; render(); },
    });
  }

  // ---------- Opzioni del master ----------
  function renderMaster(c, host) {
    const id = c.id;
    host.append(frame('Opzioni del master', [
      el('div', { class: 'grid-2 tight' },
        field('Titolo del personaggio', textInput(c.legend.title, { maxlength: 80, placeholder: 'es. Lama dell\'Alba', onchange: (e) => { update(id, (x) => { x.legend.title = e.target.value.trim(); }); render(); } })),
        field('Tema', el('select', { onchange: (e) => { update(id, (x) => { x.legend.theme = e.target.value; }); render(); } }, L.THEMES.map((x) => opt(x, L.THEME_NAMES[x], x === c.legend.theme))))),
      el('div', { class: 'grid-2 tight' },
        field('Punti percorso bonus (dal master)', numberInput(c.legend.pointsBonus, { min: 0, max: 100, onchange: (e) => { update(id, (x) => { x.legend.pointsBonus = Math.max(0, readNumber(e.target) || 0); }); render(); } })),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: c.legend.allowRespec, onchange: (e) => { update(id, (x) => { x.legend.allowRespec = e.target.checked; }); } }),
          ' Permetti di rimodellare il percorso (se no, gli acquisti sono definitivi)')),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn', text: 'Riposo breve', title: 'Ripristina gli usi «per riposo breve»', onclick: () => { update(id, (x) => L.rest(x, false)); toast('Riposo breve: usi ripristinati.'); } }),
        el('button', { class: 'btn', text: 'Riposo lungo', title: 'Ripristina tutti gli usi di trasformazioni e privilegi', onclick: () => { update(id, (x) => L.rest(x, true)); toast('Riposo lungo: usi ripristinati.'); } }),
        el('button', { class: 'btn danger', text: 'Declassa a standard', onclick: () => demote(c) })),
    ], { swords: false }));
  }

  // ---------- Combattimento ----------
  const combatUndo = [];
  const combatRedo = [];
  // Riquadro nella scheda del combattente: Trasformati (per ogni forma disponibile), Torna normale, annulla/ripeti.
  function combatBox(x, h) {
    const player = st().players.find((p) => p.id === x.sourceId);
    const forms = player && player.legend ? player.legend.transformations.filter((t) => x.legend.transformations.includes(t.id)) : [];
    const f = x.legend.form;
    const snapshotOf = (id) => clone(h.byId(id));
    const record = (before, id) => { combatUndo.push({ id, before }); if (combatUndo.length > 30) combatUndo.shift(); combatRedo.length = 0; };
    const swap = (from, to) => {
      const e = from.pop();
      if (!e) return;
      h.mutate((c) => {
        const i = c.combatants.findIndex((y) => y.id === e.id);
        if (i < 0) return;
        to.push({ id: e.id, before: clone(c.combatants[i]) });
        c.combatants[i] = e.before;
        h.log(c, 'sistema', '↶ Trasformazione di ' + e.before.name + ': ' + (from === combatUndo ? 'annullata' : 'ripetuta') + '.');
      });
    };
    return el('div', { class: 'legend-box' },
      el('span', { class: 'tag legend-tag', text: '✦ Leggendario · rango ' + x.legend.rank }),
      f ? el('span', { class: 'small', text: '🜂 ' + f.name + ' · ' + f.roundsLeft + ' round' }) : null,
      !f ? forms.map((t) => {
        const left = x.legend.uses[t.id] === undefined ? t.uses.n : x.legend.uses[t.id];
        return el('button', { type: 'button', class: 'btn small legend-ascend-btn', disabled: left <= 0 || x.hp <= 0, title: (t.activation === 'bonus' ? 'Azione bonus' : 'Azione') + ' · usi ' + left + '/' + t.uses.n,
          text: '🜂 Trasformati: ' + t.name + ' (' + left + ')', onclick: () => {
            record(snapshotOf(x.id), x.id);
            let ok = false;
            h.mutate((c) => {
              const y = c.combatants.find((z) => z.id === x.id);
              const r = L.transform(y, t);
              ok = r.ok;
              for (const line of r.lines) h.log(c, 'sistema', line);
            });
            if (ok) {
              // Gli usi restano scalati anche sulla scheda del giocatore (fino al riposo).
              update(player.id, (p) => { p.legend.uses[t.id] = left - 1; });
              transformFlash(t.theme && THEMES[t.theme] ? t.theme : x.legend.theme);
            } else combatUndo.pop();
          } });
      }) : null,
      f && f.canEndEarly ? el('button', { type: 'button', class: 'btn small', text: '↩ Torna normale', onclick: () => {
        record(snapshotOf(x.id), x.id);
        h.mutate((c) => { const y = c.combatants.find((z) => z.id === x.id); for (const line of L.revert(y, 'anticipata', 0).lines) h.log(c, 'sistema', line); });
      } }) : null,
      combatUndo.some((e) => e.id === x.id) ? el('button', { type: 'button', class: 'btn small', text: '↶', title: 'Annulla l\'ultima trasformazione o ritorno', 'aria-label': 'Annulla trasformazione', onclick: () => swap(combatUndo, combatRedo) }) : null,
      combatRedo.some((e) => e.id === x.id) ? el('button', { type: 'button', class: 'btn small', text: '↷', title: 'Ripeti', 'aria-label': 'Ripeti trasformazione', onclick: () => swap(combatRedo, combatUndo) }) : null,
      x.legend.texts.length ? el('details', { class: 'small' }, el('summary', { text: 'Effetti narrativi (' + x.legend.texts.length + ')' }), x.legend.texts.map((t) => el('p', { text: t }))) : null);
  }

  DnD.uiLeggendario = {
    pathWidget: () => pathWidget,
    render, promote, demote, combatBox, drawHalo, ascension, transformFlash, applyTheme, THEMES,
    reset: () => { viewing = null; part = 'scheda'; editingForm = null; pathWidget = null; pathFor = null; },
  };
})(globalThis.DnD = globalThis.DnD || {});
