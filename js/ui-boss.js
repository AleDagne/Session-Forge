// Nemici › Boss e boss nel combattimento. Componenti riusabili a temi (vedi css/boss.css): vignettatura,
// cornice con spade, barra della vita, banner ed effetti; scheda Boss con elenco, "Promuovi a boss", form
// della creatura dentro la "forgia" (area sempre scura) con anteprima viva e animazione di evocazione;
// nel combattimento barre in alto, ombra ai lati, effetti di fase, alone e corona sulla pedina.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const B = DnD.boss;
  const M = DnD.creature;
  const K = DnD.creatureDati;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let editing = null;   // id in modifica, 'new' o null
  let viewing = null;   // id della scheda in vista
  let pendingNew = null; // boss nuovo da modificare (es. appena promosso)
  let query = '';
  let root = null;
  let seq = 0;

  const session = () => DnD.sessioni.current(DnD.store.state);
  const list = () => DnD.sessioni.visible(DnD.store.state, 'npcs').filter((c) => c.type === 'boss');
  const motionOff = () => DnD.impostazioni.reduceMotion() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const effectsOn = () => DnD.impostazioni.bossEffects();

  // ---------- Componenti ----------
  // Variabili CSS del tema (l'unico punto in cui i colori del tema entrano nell'interfaccia).
  // I temi leggendari («lg:<id>») aggiungono le variabili --lg-* e trasformano le spade in lance di luce.
  function themeStyle(themeId) {
    const t = B.theme(themeId);
    const base = '--boss-accent:' + t.accent + ';--boss-glow:' + t.glow + ';--boss-shadow:' + t.shadow + ';--boss-frame:' + t.frame + ';--boss-bg:' + t.bg;
    if (!t.legendary) return base;
    return base + ';--lg-gold:' + t.accent + ';--lg-light:' + t.glow + ';--lg-glow:' + t.shadow + ';--lg-accent:' + t.frame + ';--lg-bg:' + t.bg +
      ';--boss-steel:' + t.glow + ';--boss-steel-dark:' + t.accent + ';--boss-grip:' + t.frame;
  }
  function applyTheme(node, themeId) {
    const t = B.theme(themeId);
    node.classList.add('boss-theme');
    node.classList.toggle('legend-theme', Boolean(t.legendary));
    node.setAttribute('style', themeStyle(themeId));
    node.dataset.bossTheme = themeId;
    if (t.legendary) node.dataset.legendMotif = t.motif;
    else delete node.dataset.legendMotif;
    return node;
  }

  function svg(markup, cls, attrs) {
    const node = document.createElementNS(SVG_NS, 'svg');
    node.setAttribute('class', cls);
    node.setAttribute('aria-hidden', 'true');
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    node.innerHTML = markup;
    return node;
  }

  // Spada verticale (punta in basso) in SVG: pomolo e impugnatura in alto (fuori dalla cornice), lama sotto.
  // pos: { x | r, y, rot } in CSS (es. '12%', '-60px', '-8deg').
  function sword(pos) {
    const id = 'boss-blade-' + (++seq);
    const node = svg(
      '<defs><linearGradient id="' + id + '" x1="0" x2="1"><stop offset="0" class="stop-dark"/><stop offset="0.5" class="stop-light"/><stop offset="1" class="stop-dark"/></linearGradient></defs>' +
      '<circle class="pommel" cx="13" cy="5" r="4" stroke-width="1"/>' +
      '<rect class="grip" x="10.5" y="8" width="5" height="17" rx="1.5"/>' +
      '<path d="M11 10 L15 12 M11 14 L15 16 M11 18 L15 20" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>' +
      '<path class="guard" d="M1 26 Q13 22 25 26 L25 29 Q13 26 1 29 Z" stroke-width="1"/>' +
      '<circle class="gem" cx="13" cy="27" r="2"/>' +
      '<path fill="url(#' + id + ')" d="M9.5 30 L16.5 30 L16 104 L13 119 L10 104 Z"/>' +
      '<path class="edge" d="M13 32 L13 112" stroke-width="0.8" opacity="0.55"/>',
      'boss-sword', { viewBox: '0 0 26 120', width: '26', height: '120' });
    const style = [];
    if (pos.x !== undefined) style.push('--x:' + pos.x);
    if (pos.r !== undefined) style.push('--r:' + pos.r);
    style.push('--y:' + (pos.y || '-46px'), '--rot:' + (pos.rot || '0deg'));
    node.setAttribute('style', style.join(';'));
    return node;
  }

  const CORNER = '<path d="M2 32 L2 2 L32 2" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 26 L8 8 L26 8" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '<circle cx="2" cy="2" r="3.5" fill="currentColor"/><path d="M14 2 L17 -1 L20 2 L17 5 Z M2 14 L-1 17 L2 20 L5 17 Z" fill="currentColor"/>';
  const RUNES = (() => {
    const glyphs = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = 100 + Math.cos(a) * 82;
      const y = 100 + Math.sin(a) * 82;
      const k = i % 4;
      glyphs.push('<path transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + (a * 180 / Math.PI + 90).toFixed(0) + ')" d="' +
        ['M-3 -4 L0 4 L3 -4', 'M-3 -4 L3 -4 L-3 4 L3 4', 'M0 -4 L0 4 M-3 0 L3 0', 'M-3 4 L0 -4 L3 4 M-2 1 L2 1'][k] + '" fill="none" stroke="currentColor" stroke-width="1.2"/>');
    }
    return '<circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" stroke-width="0.8" stroke-dasharray="4 6"/>' +
      '<circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" stroke-width="0.8"/><path d="M100 4 L100 196 M4 100 L196 100 M32 32 L168 168 M168 32 L32 168" stroke="currentColor" stroke-width="0.4"/>' + glyphs.join('');
  })();
  const runes = (cls) => svg(RUNES, 'boss-runes' + (cls ? ' ' + cls : ''), { viewBox: '0 0 200 200' });

  // Cornice ornata: targa del titolo al centro del bordo superiore, spade simmetriche ai due lati del titolo
  // (impugnatura fuori, lama dentro), altre due inclinate sui fianchi, angoli decorati.
  function frame(title, content, opts) {
    opts = opts || {};
    const node = el('section', { class: 'boss-frame' + (opts.class ? ' ' + opts.class : '') });
    node.append(...['tl', 'tr', 'bl', 'br'].map((k) => svg(CORNER, 'boss-corner ' + k, { viewBox: '-2 -2 36 36' })));
    if (title) node.append(el('div', { class: 'boss-frame-plate', text: title }));
    if (opts.swords !== false) {
      node.append(sword({ x: 'calc(50% - 150px)', y: '-46px', rot: '-14deg' }), sword({ r: 'calc(50% - 150px)', y: '-46px', rot: '14deg' }));
      if (opts.sideSwords) node.append(sword({ x: '-22px', y: '30%', rot: '-62deg' }), sword({ r: '-22px', y: '58%', rot: '62deg' }));
    }
    // append() scriverebbe «null» come testo: gli elementi assenti si tolgono.
    node.append(...[].concat(content).flat().filter((x) => x !== null && x !== undefined && x !== false));
    return node;
  }

  const divider = () => el('div', { class: 'boss-divider', role: 'presentation' });

  // Barra della vita di un boss. x: { id, name, hp, maxHp, boss: { title, theme, phases, phase, revealed, defeated } }.
  // prevHp: PF prima dell'ultimo colpo (la parte persa si svuota con ritardo).
  function bar(x, opts) {
    opts = opts || {};
    const b = x.boss;
    const pct = (hp) => Math.max(0, Math.min(100, x.maxHp > 0 ? (hp / x.maxHp) * 100 : 0));
    const node = applyTheme(el('div', {
      class: 'boss-bar' + (x.hp <= 0 ? ' defeated' : ''), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': x.maxHp, 'aria-valuenow': Math.max(0, x.hp),
      'aria-label': 'Punti ferita di ' + x.name,
    }), b.theme);
    const lagFrom = opts.prevHp !== undefined && opts.prevHp > x.hp ? pct(opts.prevHp) : pct(x.hp);
    node.style.setProperty('--pct', pct(x.hp) + '%');
    node.style.setProperty('--lag', lagFrom + '%');
    const phase = b.phases[b.phase || 0];
    node.append(
      el('div', { class: 'boss-bar-head' },
        el('div', {}, el('span', { class: 'boss-bar-name', text: x.name || 'Boss senza nome' }), b.title ? el('span', { class: 'boss-bar-title', text: ' · ' + b.title }) : null,
          opts.master && b.revealed === false ? el('span', { class: 'boss-bar-hidden', text: '(nascosto ai giocatori)' }) : null),
        el('div', {}, phase && b.phases.length > 1 ? el('span', { class: 'boss-bar-phase', text: 'Fase ' + ((b.phase || 0) + 1) + ' — ' + phase.name + ' · ' }) : null,
          el('span', { class: 'boss-bar-hp', text: Math.max(0, x.hp) + ' / ' + x.maxHp + ' PF' }))),
      el('div', { class: 'boss-bar-track' },
        el('div', { class: 'boss-bar-lag' }), el('div', { class: 'boss-bar-fill' }),
        ...b.phases.slice(1).map((p) => el('div', { class: 'boss-bar-mark', title: p.name + ' (' + p.threshold + '%)', style: 'left:calc(' + p.threshold + '% - 1px)' }))));
    if (lagFrom !== pct(x.hp)) requestAnimationFrame(() => requestAnimationFrame(() => node.style.setProperty('--lag', pct(x.hp) + '%')));
    return node;
  }

  // ---------- Disegno sulla griglia ----------
  function hexToRgba(hex, a) {
    const n = parseInt(String(hex).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Alone del colore del tema e, se prevista, aura di raggio in celle (dal bordo della pedina).
  function drawAura(ctx, t, cx, cy, dw, dh, s) {
    const th = B.theme(t.boss.theme);
    ctx.save();
    if (t.boss.aura) {
      const rx = dw / 2 + t.boss.aura * s;
      const ry = dh / 2 + t.boss.aura * s;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(th.accent, 0.1);
      ctx.fill();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.strokeStyle = hexToRgba(th.glow, 0.7);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = Math.max(dw, dh) / 2;
    const g = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.05);
    g.addColorStop(0, hexToRgba(th.glow, 0.55));
    g.addColorStop(1, hexToRgba(th.accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, dw / 2 * 1.05, dh / 2 * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Corona sopra la pedina.
  function drawCrown(ctx, t, cx, top, size, s) {
    const th = B.theme(t.boss.theme);
    const w = Math.max(12, Math.min(size * 0.38, s * 0.9));
    const h = w * 0.62;
    const x = cx - w / 2;
    const y = top - h * 0.55;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + h * 0.3);
    ctx.lineTo(x + w * 0.25, y + h * 0.62);
    ctx.lineTo(x + w * 0.5, y);
    ctx.lineTo(x + w * 0.75, y + h * 0.62);
    ctx.lineTo(x + w, y + h * 0.3);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = '#f2c94c';
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, w * 0.07);
    ctx.strokeStyle = '#3a2408';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, y + h * 0.72, w * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = th.accent;
    ctx.fill();
    ctx.restore();
  }

  // Pedina d'anteprima (con aura) su un piccolo canvas: cell = lato di una cella in px.
  function tokenPreview(canvas, npc, icon) {
    const dims = DnD.griglia.gridSizeFor(npc.gridSize, npc.size);
    const aura = npc.boss.aura || 0;
    const cell = Math.max(14, Math.min(40, Math.floor(220 / (Math.max(dims.w, dims.h) + 2 * aura + 1))));
    const cols = dims.w + 2 * aura + 1;
    const rows = dims.h + 2 * aura + 1;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cols * cell * dpr;
    canvas.height = rows * cell * dpr;
    canvas.style.width = cols * cell + 'px';
    canvas.style.height = rows * cell + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(i * cell + 0.5, 0); ctx.lineTo(i * cell + 0.5, rows * cell); ctx.stroke(); }
    for (let j = 0; j <= rows; j++) { ctx.beginPath(); ctx.moveTo(0, j * cell + 0.5); ctx.lineTo(cols * cell, j * cell + 0.5); ctx.stroke(); }
    const px = (aura + 0.5) * cell;
    const py = (aura + 0.5) * cell;
    const dw = dims.w * cell;
    const dh = dims.h * cell;
    const t = { boss: npc.boss, icon };
    drawAura(ctx, t, px + dw / 2, py + dh / 2, dw, dh, cell);
    const pad = Math.min(dw, dh) * 0.12;
    DnD.icone.drawIconRect(ctx, icon, px + pad, py + pad, dw - 2 * pad, dh - 2 * pad, () => tokenPreview(canvas, npc, icon));
    drawCrown(ctx, t, px + dw / 2, py + pad, Math.min(dw, dh), cell);
    return dims;
  }

  // ---------- Effetti ----------
  function themeHost(themeId, node) {
    return applyTheme(node, themeId);
  }
  function flash(themeId) {
    if (motionOff() || !effectsOn()) return;
    const f = themeHost(themeId, el('div', { class: 'boss-flash', 'aria-hidden': 'true' }));
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }
  function shake(node) {
    if (!node || motionOff() || !effectsOn()) return;
    node.classList.remove('boss-shake');
    void node.offsetWidth;
    node.classList.add('boss-shake');
    setTimeout(() => node.classList.remove('boss-shake'), 550);
  }
  function banner(themeId, title, sub) {
    if (!effectsOn()) return;
    for (const old of document.querySelectorAll('.boss-banner')) old.remove();
    const b = themeHost(themeId, el('div', { class: 'boss-banner', role: 'status' }, el('b', { text: title }), sub ? el('span', { text: sub }) : null));
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3100);
  }

  // Eventi di checkCombat (boss.js): banner "FASE N — nome", lampo o tremolio; sconfitta: banner finale.
  // I suoni accompagnano gli stessi eventi (audio.js li tace con «Effetti boss» spenti).
  function playEvents(events, shakeNode) {
    for (const e of events || []) {
      DnD.audio.suona(e.kind === 'fase' ? 'boss-fase' : 'boss-sconfitto', { coda: true });
      if (e.kind === 'fase') {
        banner(e.theme, 'Fase ' + (e.phase + 1) + ' — ' + e.phaseName, e.name);
        if (e.effect === 'lampo') flash(e.theme);
        if (e.effect === 'tremolio') shake(shakeNode || document.querySelector('.combat-layout'));
      } else if (e.kind === 'sconfitto') {
        banner(e.theme, e.name + ' è caduto', 'Il boss è sconfitto');
        flash(e.theme);
      }
    }
  }

  // Evocazione di un nuovo boss: lampo, tremolio della cornice, nome con effetto di impatto. Un clic la salta.
  function summon(npc, frameNode, done) {
    DnD.audio.suona('boss-evocazione'); // anche con «Riduci animazioni»: sono due preferenze diverse
    if (motionOff()) { done(); return; }
    shake(frameNode);
    const overlay = themeHost(npc.boss.theme, el('div', { class: 'boss-summon', role: 'dialog', 'aria-label': 'Evocazione di ' + npc.name, tabindex: -1 },
      el('div', { class: 'boss-summon-name' }, el('b', { text: npc.name }), npc.boss.title ? el('span', { text: npc.boss.title }) : null),
      el('div', { class: 'boss-summon-skip', text: 'Clic o Esc per continuare' })));
    let closed = false;
    const close = () => { if (closed) return; closed = true; overlay.remove(); done(); };
    overlay.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close(); });
    document.body.appendChild(overlay);
    overlay.focus();
    setTimeout(close, 3100);
  }

  // ---------- Sezione Boss (Nemici) ----------
  function forge(title, subtitle, themeId) {
    const node = applyTheme(el('div', { class: 'boss-forge' }), themeId || 'infernale');
    node.append(runes(), runes('left'), el('header', { class: 'boss-forge-head' },
      el('h1', { class: 'boss-title', text: title }), subtitle ? el('p', { class: 'boss-subtitle', text: subtitle }) : null));
    return node;
  }

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else if (viewing && list().some((c) => c.id === viewing)) renderSheet(list().find((c) => c.id === viewing));
    else { viewing = null; renderList(); }
  }

  function save(npc) {
    DnD.store.update((st) => {
      const i = st.npcs.findIndex((x) => x.id === npc.id);
      if (i >= 0) st.npcs[i] = npc;
      else st.npcs.push(npc);
    });
  }

  function renderList() {
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
      const f = importInput.files[0];
      importInput.value = '';
      if (f) DnD.uiCreature.importOne(f, () => render());
    } });
    const shown = list().filter((c) => !query || (c.name + ' ' + c.boss.title + ' ' + c.boss.epithet).toLowerCase().includes(query.toLowerCase()));
    const f = forge('I Boss', 'Le minacce che chiudono un capitolo');
    f.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Boss della sessione' }),
        el('div', { class: 'head-actions' },
          el('input', { type: 'search', placeholder: 'Cerca un boss…', value: query, 'aria-label': 'Cerca un boss', onchange: (e) => { query = e.target.value.trim(); render(); } }),
          el('button', { class: 'btn', text: '⬆ Importa JSON', onclick: () => importInput.click() }), importInput,
          el('button', { class: 'btn', text: '⇧ Promuovi a boss…', onclick: promoteDialog }),
          el('button', { class: 'btn primary', text: '+ Nuovo boss', onclick: () => { editing = 'new'; render(); } }))),
      divider(),
      shown.length
        ? el('div', { class: 'card-grid' }, shown.map((c) => {
          const card = applyTheme(el('article', { class: 'card boss-card' }), c.boss.theme);
          card.append(
            el('div', { class: 'card-title' },
              el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(c.icon, 36), el('h3', { text: c.name }), c.shared ? el('span', { class: 'tag', text: 'Condiviso' }) : null),
              el('span', { class: 'ac-badge', text: 'CA ' + c.ac })),
            c.boss.title ? el('p', { class: 'boss-card-title', text: c.boss.title + (c.boss.epithet ? ' · ' + c.boss.epithet : '') }) : '',
            el('p', { class: 'muted small', text: M.typeLine(c) }),
            el('p', { text: 'PF ' + M.hpInfo(c).text + ' · GS ' + M.crText(c) }),
            el('p', { class: 'small muted', text: c.boss.phases.length + ' fasi (' + c.boss.phases.map((p) => p.threshold + '%').join(', ') + ') · tema ' + B.theme(c.boss.theme).name +
              (c.legendary.length ? ' · ' + c.legendary.length + ' leggendarie' : '') }),
            el('label', { class: 'check small' },
              el('input', { type: 'checkbox', checked: c.shared, onchange: (e) => { DnD.store.update(() => { c.shared = e.target.checked; }); render(); } }),
              ' Condividi con tutte le sessioni'),
            el('div', { class: 'card-actions' },
              el('button', { class: 'btn primary', text: 'Scheda', onclick: () => { viewing = c.id; render(); } }),
              el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = c.id; render(); } }),
              el('button', { class: 'btn', text: 'Duplica', onclick: () => duplicate(c) }),
              el('button', { class: 'btn', text: 'Esporta', onclick: () => DnD.uiCreature.exportOne(c) }),
              el('button', { class: 'btn danger', text: 'Elimina', onclick: () => remove(c) })));
          return card;
        }))
        : el('p', { class: 'empty', text: query ? 'Nessun boss per «' + query + '».' : 'Nessun boss in questa sessione. Evocane uno o promuovi una creatura.' }));
    root.append(f);
  }

  function duplicate(c) {
    const copy = Object.assign(clone(c), { id: DnD.dadi.uid(), name: (c.name + ' (copia)').slice(0, 60), sessionId: session().id, shared: false });
    DnD.store.update((st) => { st.npcs.splice(st.npcs.indexOf(c) + 1, 0, copy); });
    toast('Boss duplicato.');
    render();
  }
  function remove(c) {
    if (!confirm('Eliminare il boss "' + c.name + '"?' + (c.shared ? '\nÈ condiviso: sparirà da tutte le sessioni.' : ''))) return;
    DnD.store.update((st) => { st.npcs = st.npcs.filter((x) => x.id !== c.id); });
    toast('Boss eliminato.');
    render();
  }

  // Promuovi a boss: da una creatura o da un nemico standard della sessione (anche condivisi).
  function promoteDialog() {
    const st = DnD.store.state;
    const all = DnD.sessioni.visible(st, 'npcs').filter((c) => c.type !== 'boss');
    if (!all.length) { toast('Nessuna creatura o nemico standard da promuovere.', 'error'); return; }
    const sel = el('select', { 'aria-label': 'Da promuovere' },
      el('optgroup', { label: 'Creature' }, all.filter((c) => c.type === 'creatura').map((c) => el('option', { value: c.id, text: c.name + ' (GS ' + c.cr + ')' }))),
      el('optgroup', { label: 'Nemici standard' }, all.filter((c) => c.type !== 'creatura').map((c) => el('option', { value: c.id, text: c.name + ' (liv. ' + c.level + ')' }))));
    openDialog('Promuovi a boss', el('div', { class: 'form' }, field('Creatura o nemico', sel),
      el('p', { class: 'muted small', text: 'Si crea un nuovo boss con la stessa scheda (per i nemici standard: caratteristiche, PF, CA e armi diventano una scheda del Manuale). L\'originale resta invariato.' })), [
      { text: 'Annulla' },
      { text: 'Promuovi', class: 'primary', onclick: () => {
        const src = all.find((c) => c.id === sel.value);
        const race = st.races.find((r) => r.id === src.raceId) || null;
        pendingNew = DnD.dati.normalizeCreature(Object.assign(B.promote(src, { race, catalog: st.equipment }), { sessionId: session().id }), false);
        editing = 'new';
        render();
      } },
    ]);
  }

  // Scheda: intestazione del boss (titolo, introduzione, fasi) e blocco statistiche del Manuale.
  function renderSheet(c) {
    const f = forge(c.name, [c.boss.title, c.boss.epithet].filter(Boolean).join(' · '), c.boss.theme);
    f.append(
      el('div', { class: 'section-head no-print' },
        el('h2', { text: 'Scheda del boss' }),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn', text: '← Elenco', onclick: () => { viewing = null; render(); } }),
          el('button', { class: 'btn', text: '🖨 Stampa', onclick: () => window.print() }),
          el('button', { class: 'btn primary', text: 'Modifica', onclick: () => { editing = c.id; render(); } }))),
      frame('Presentazione', [
        c.boss.intro ? el('p', { class: 'boss-intro', text: c.boss.intro }) : el('p', { class: 'muted', text: 'Nessuna introduzione.' }),
        bar({ name: c.name, hp: M.hpInfo(c).total, maxHp: M.hpInfo(c).total, boss: Object.assign({}, c.boss, { phase: 0 }) }),
        el('ol', { class: 'boss-phase-list' }, c.boss.phases.map((p, i) => el('li', {},
          el('b', { text: 'Fase ' + (i + 1) + ' — ' + p.name }), ' (' + (i ? 'sotto il ' + p.threshold + '% dei PF' : 'dall\'inizio') + ')',
          p.note ? el('div', { class: 'muted small', text: p.note }) : null,
          el('div', { class: 'muted small', text: [p.effect !== 'nessuno' ? 'Effetto: ' + B.EFFECT_NAMES[p.effect] : '', p.temperament ? 'Temperamento: ' + p.temperament : '',
            p.enable.length ? 'Abilita: ' + p.enable.map((id) => (M.findAction(c, id) || { name: id }).name).join(', ') : '',
            p.disable.length ? 'Disabilita: ' + p.disable.map((id) => (M.findAction(c, id) || { name: id }).name).join(', ') : ''].filter(Boolean).join(' · ') })))),
        el('p', { class: 'muted small', text: (c.boss.aura ? 'Aura: ' + c.boss.aura + ' celle · ' : '') + (c.boss.scaleByPlayers ? 'PF moltiplicati per il numero di giocatori' : 'PF fissi') }),
      ], { sideSwords: false }),
      DnD.uiMostri.statblock(c));
    root.append(f);
  }

  // ---------- Form (la forgia) ----------
  function renderForm() {
    const existing = editing === 'new' ? null : list().find((c) => c.id === editing);
    const seed = !existing && pendingNew ? pendingNew : null;
    pendingNew = null;
    const f = forge(existing ? 'Rimodella il boss' : 'Forgia del boss', existing ? existing.name : 'Dai forma a qualcosa di grosso', existing ? existing.boss.theme : seed ? seed.boss.theme : 'infernale');
    let mainFrame = null;
    let preview = null;
    DnD.uiMostri.monsterForm(f, existing || seed, {
      kind: 'boss',
      defaults: seed ? null : {
        size: 'Grande', cr: '5', hitDice: 12, legendaryPoints: 3, legendaryResistance: 1,
        icon: { kind: 'library', icon: 'drago', color: '#d4453a' }, gridSize: { auto: true, w: 2, h: 2 },
        boss: { theme: 'infernale', phases: [{ threshold: 100, name: 'Il Risveglio' }, { threshold: 66, name: 'L\'Ira', effect: 'tremolio' }, { threshold: 33, name: 'Ultima Furia', effect: 'lampo' }] },
      },
      heading: existing ? 'Modifica boss' : 'Nuovo boss',
      submitText: existing ? 'Salva il boss' : 'Evoca il boss',
      submitClass: 'boss-summon-btn',
      savedText: existing ? 'Boss salvato.' : 'Il boss è stato evocato.',
      extra: (m, ctx) => {
        const ex = bossFields(m, ctx, f);
        preview = ex.preview;
        return ex;
      },
      wrap: (heading, form) => {
        mainFrame = frame('Scheda del boss', [form], { sideSwords: true });
        return el('div', { class: 'boss-forge-grid' }, el('div', {}, mainFrame), preview.node);
      },
      onDone: (saved) => {
        editing = null;
        if (!saved) { render(); return; }
        viewing = saved.id;
        if (!existing) summon(saved, mainFrame, () => render());
        else render();
      },
    });
    root.append(f);
    // L'anteprima segue anche icona e dimensione (che non passano dai calcoli del form).
    const form = f.querySelector('form');
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => preview.update()); };
    form.addEventListener('input', later);
    form.addEventListener('change', later);
    form.addEventListener('click', later);
    preview.update();
  }

  // Campi del boss nel form della creatura: presentazione e tema in alto; fasi, scala e aura in fondo.
  // opts.presentation === false: niente titolo, epiteto, introduzione e tema (le trasformazioni leggendarie
  // hanno i loro nelle regole della forma).
  function bossFields(m, ctx, forgeNode, opts) {
    const b = m.boss = B.normalizeBoss(m.boss);
    const title = textInput(b.title, { maxlength: 80, placeholder: 'es. Il Re delle Ceneri', 'data-key': 'boss.title', oninput: (e) => { b.title = e.target.value; ctx.refresh(); } });
    const epithet = textInput(b.epithet, { maxlength: 60, placeholder: 'es. Signore del Vulcano', oninput: (e) => { b.epithet = e.target.value; ctx.refresh(); } });
    const intro = el('textarea', { rows: 3, maxlength: 3000, value: b.intro, placeholder: 'Testo da leggere o parafrasare quando il boss entra in scena', oninput: (e) => { b.intro = e.target.value; } });
    const themeRow = el('div', { class: 'boss-theme-row', role: 'group', 'aria-label': 'Tema visivo' });
    const drawThemes = () => {
      clear(themeRow).append(...B.THEME_IDS.map((id) => el('button', {
        type: 'button', class: 'boss-theme-choice', 'aria-pressed': String(b.theme === id), style: '--dot:' + B.THEMES[id].accent,
        onclick: () => { b.theme = id; applyTheme(forgeNode, id); drawThemes(); ctx.refresh(); },
      }, el('span', { class: 'boss-theme-dot' }), B.THEMES[id].name)));
    };
    drawThemes();

    // Fasi: soglia (la prima è al 100%), nome, nota, effetto, temperamento, azioni abilitate/disabilitate.
    const phasesBox = el('div', {});
    const actionChoices = () => K.GROUPS.flatMap((g) => m[g].filter((a) => g !== 'traits').map((a) => ({ id: a.id, name: a.name + (g === 'legendary' ? ' (leggendaria)' : g === 'lair' ? ' (tana)' : '') })));
    const opt = (value, text, selected) => el('option', { value, text, selected });
    function drawPhases() {
      const choices = actionChoices();
      clear(phasesBox).append(...b.phases.map((p, i) => {
        const checks = (key) => el('fieldset', {}, el('legend', { text: key === 'enable' ? 'Abilita (bloccate prima)' : 'Disabilita' }),
          choices.length ? choices.map((a) => el('label', { class: 'check small' },
            el('input', { type: 'checkbox', checked: p[key].includes(a.id), onchange: (e) => { p[key] = e.target.checked ? p[key].concat(a.id) : p[key].filter((x) => x !== a.id); } }),
            ' ' + a.name)) : el('p', { class: 'muted small', text: 'Nessuna azione.' }));
        return el('div', { class: 'boss-phase' },
          el('div', { class: 'boss-phase-head' },
            el('span', { class: 'boss-phase-num', text: 'Fase ' + (i + 1) }),
            i === 0 ? el('span', { class: 'muted small', text: 'dall\'inizio (100%)' })
              : field('Sotto il % dei PF', numberInput(p.threshold, { min: 1, max: 99, class: 'qty', 'data-key': 'boss.phases.' + i + '.threshold', oninput: (e) => { p.threshold = readNumber(e.target); ctx.refresh(); } }), 'boss.phases.' + i + '.threshold'),
            field('Nome', textInput(p.name, { maxlength: 60, oninput: (e) => { p.name = e.target.value; ctx.refresh(); } })),
            field('Effetto visivo', el('select', { onchange: (e) => { p.effect = e.target.value; } }, B.EFFECTS.map((k) => opt(k, B.EFFECT_NAMES[k], k === p.effect)))),
            field('Temperamento', el('select', { onchange: (e) => { p.temperament = e.target.value; } },
              opt('', 'Invariato', !p.temperament), opt('aggressivo', 'Aggressivo', p.temperament === 'aggressivo'), opt('furbo', 'Furbo', p.temperament === 'furbo'))),
            i > 0 ? el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Elimina la fase', onclick: () => { b.phases.splice(i, 1); drawPhases(); ctx.refresh(); } }) : null),
          field('Nota per il master (finisce nel log)', el('textarea', { rows: 2, maxlength: 1000, value: p.note, oninput: (e) => { p.note = e.target.value; } })),
          el('details', {}, el('summary', { class: 'small', text: 'Azioni della fase' + (p.enable.length || p.disable.length ? ' (' + (p.enable.length + p.disable.length) + ')' : '') }),
            el('div', { class: 'boss-phase-actions' }, checks('enable'), checks('disable'))));
      }),
      b.phases.length < B.MAX_PHASES ? el('button', { type: 'button', class: 'btn small', text: '+ Aggiungi fase', onclick: () => {
        const last = b.phases[b.phases.length - 1];
        b.phases.push({ id: DnD.dadi.uid(), threshold: Math.max(1, Math.round((last.threshold || 100) / 2)), name: 'Fase ' + (b.phases.length + 1), note: '', effect: 'lampo', temperament: '', enable: [], disable: [] });
        drawPhases();
        ctx.refresh();
      } }) : '');
    }
    drawPhases();
    const scale = el('input', { type: 'checkbox', checked: b.scaleByPlayers, onchange: (e) => { b.scaleByPlayers = e.target.checked; ctx.refresh(); } });
    const aura = numberInput(b.aura, { min: 0, max: B.MAX_AURA, class: 'qty', 'data-key': 'boss.aura', oninput: (e) => { b.aura = readNumber(e.target); ctx.refresh(); } });

    // Anteprima viva: barra della vita e pedina con aura.
    const barBox = el('div', {});
    const canvas = el('canvas', { 'aria-label': 'Anteprima della pedina con aura' });
    const tokenNote = el('p', { class: 'boss-preview-note' });
    const preview = {
      node: el('aside', { class: 'boss-preview', 'aria-label': 'Anteprima' },
        frame('Anteprima', [barBox, el('p', { class: 'boss-preview-note', text: 'Barra in alto durante il combattimento, con i segni delle fasi.' })], { swords: false }),
        frame('Pedina', [canvas, tokenNote], { swords: false })),
      update() {
        const hp = Number.isInteger(m.hitDice) && Number.isFinite(m.abilities.COS) ? M.hpInfo(m).total : 0;
        const phases = B.normalizePhases(b.phases);
        clear(barBox).append(bar({ name: m.name.trim() || 'Senza nome', hp, maxHp: Math.max(1, hp), boss: Object.assign({}, b, { phases, phase: 0 }) }));
        const iconNow = (ctx.icon.read().icon) || m.icon;
        const gs = ctx.gridSize.read().gridSize;
        const npc = { gridSize: gs, size: m.size, boss: { theme: b.theme, aura: Number.isInteger(b.aura) ? b.aura : 0 } };
        const dims = tokenPreview(canvas, npc, iconNow);
        tokenNote.textContent = dims.w + '×' + dims.h + ' celle' + (npc.boss.aura ? ' · aura ' + npc.boss.aura + ' celle' : '') + (b.scaleByPlayers ? ' · PF × giocatori' : '');
      },
    };

    return {
      preview,
      top: opts && opts.presentation === false ? [] : [frame('Presentazione', [
        el('div', { class: 'grid-2 tight' }, field('Titolo', title, 'boss.title'), field('Epiteto breve', epithet)),
        field('Introduzione per il master', intro),
        el('div', { class: 'field' }, el('label', { text: 'Tema visivo' }), themeRow),
      ], { swords: false }), divider()],
      bottom: [divider(), el('fieldset', { class: 'boss-phases' }, el('legend', { text: 'Fasi' }),
        el('p', { class: 'muted small', text: 'Si passa alla fase quando i PF scendono sotto la soglia; anche più fasi con un solo colpo. Le fasi non tornano indietro curandosi.' }), phasesBox),
      el('fieldset', {}, el('legend', { text: 'Scala e aura' }),
        el('label', { class: 'check' }, scale, ' PF moltiplicati per il numero di giocatori'),
        el('div', { class: 'input-row' }, el('label', { class: 'inline' }, 'Aura sulla griglia (celle, 0 = nessuna) ', aura)),
        el('div', { class: 'error', 'data-error': 'boss.aura' }),
        el('p', { class: 'muted small', text: 'Resistenza leggendaria e azioni leggendarie sono quelle della scheda (sopra).' }))],
      read: () => ({ boss: B.normalizeBoss(clone(b)) }),
      validate: () => {
        const errors = {};
        b.phases.forEach((p, i) => {
          if (i && !(Number.isInteger(p.threshold) && p.threshold >= 1 && p.threshold <= 99)) errors['boss.phases.' + i + '.threshold'] = 'La soglia deve essere un intero tra 1 e 99.';
          else if (i && b.phases.some((q, j) => j !== i && j > 0 && q.threshold === p.threshold)) errors['boss.phases.' + i + '.threshold'] = 'Due fasi con la stessa soglia.';
        });
        if (!(Number.isInteger(b.aura) && b.aura >= 0 && b.aura <= B.MAX_AURA)) errors['boss.aura'] = 'L\'aura va da 0 a ' + B.MAX_AURA + ' celle.';
        return errors;
      },
      refresh: () => { if (preview) preview.update(); },
    };
  }

  // ---------- Combattimento ----------
  const lastHp = new Map(); // PF mostrati nell'ultima barra (per la parte "appena persa")

  // Barre in alto (massimo 3, le altre nel menu) e vignettatura ai lati. Vista del master: tutti i boss.
  function combatHud(c, viewer) {
    const bs = B.bars(c.combatants, viewer || 'master');
    const all = bs.shown.concat(bs.more);
    if (!all.length) return null;
    const mk = (x) => { const n = bar(x, { prevHp: lastHp.get(x.id), master: viewer !== 'giocatori' }); lastHp.set(x.id, x.hp); return n; };
    return el('div', { class: 'boss-hud', 'aria-label': 'Boss in combattimento' },
      bs.shown.map(mk),
      bs.more.length ? el('details', { class: 'boss-hud-more' }, el('summary', { text: '+ altri ' + bs.more.length + ' boss' }), bs.more.map(mk)) : null);
  }

  function vignette(c) {
    const level = B.vignetteLevel(c.combatants);
    if (!level) return null;
    const alive = c.combatants.filter((x) => x.boss && x.hp > 0);
    const top = alive.sort((a, b) => b.boss.phase - a.boss.phase)[0];
    const v = applyTheme(el('div', { class: 'boss-vignette', 'aria-hidden': 'true' }), top.boss.theme);
    v.style.setProperty('--level', String(level));
    return v;
  }

  // Riga del boss nella scheda del combattente: fase, rivela ai giocatori.
  function combatBox(x, onToggleReveal) {
    if (!x.boss) return null;
    const p = x.boss.phases[x.boss.phase];
    return el('div', { class: 'boss-box' },
      el('span', { class: 'tag boss-tag', text: '👑 Boss' + (x.boss.title ? ' · ' + x.boss.title : '') }),
      x.boss.phases.length > 1 ? el('span', { class: 'small', text: 'Fase ' + (x.boss.phase + 1) + '/' + x.boss.phases.length + ' — ' + p.name }) : null,
      el('button', { type: 'button', class: 'btn small', text: x.boss.revealed ? '🙈 Nascondi ai giocatori' : '👁 Rivela boss', onclick: onToggleReveal,
        title: 'La barra e gli effetti compaiono nella vista giocatori solo dopo la rivelazione' }));
  }

  DnD.uiBoss = {
    bossFields,
    render, reset: () => { editing = null; viewing = null; pendingNew = null; },
    themeStyle, applyTheme, sword, frame, bar, divider, forge, drawAura, drawCrown, tokenPreview,
    playEvents, banner, flash, shake, summon, combatHud, vignette, combatBox,
  };
})(globalThis.DnD = globalThis.DnD || {});
