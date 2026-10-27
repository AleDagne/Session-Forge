// Menu dadi (widget riutilizzabile, montato nella sezione Dadi e nel pannello flottante) e DADI ANIMATI.
// Regola d'oro: il risultato è già deciso (dadi.registratore o roll) quando si chiama mostraTiro(tiro); l'animazione
// è solo visiva e finisce sempre sui valori decisi. Il log e la cronologia mostrano il tiro anche se l'animazione
// viene saltata o è spenta. mostraTiro è separata dal calcolo (pronta per i dadi condivisi in futuro).
// - Area di lancio nel menù Dadi; piccolo overlay non bloccante (pointer-events: none) nel Combattimento e
//   nell'Esplorazione, con la coda dei tiri; si chiude da solo.
// - d4, d6 (cubo 3D), d8, d10, d12, d20, d100 (due d10) in SVG/CSS; colore della palette dell'app.
// - 20 naturale: bagliore dorato; 1 naturale: effetto scuro e tremolio; dadi scartati (vantaggio, 4d6) attenuati.
// - Impostazioni: interruttore generale e per categoria, velocità, colore; suoni da audio.js (rotolio, tonfo, 20 e 1),
//   «Riduci animazioni» (risultato subito, senza movimento), limite di 12 dadi animati (oltre: solo il totale).
(function (DnD) {
  'use strict';

  const { el, clear, numberInput, textInput, readNumber, toast } = DnD.ui;
  const D = DnD.dadi;
  const DICE = [4, 6, 8, 10, 12, 20, 100];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HOLD = 1400; // ms in cui l'overlay resta visibile dopo l'atterraggio

  // ---------- Impostazioni ----------
  const settings = () => DnD.impostazioni.dice();
  const motionOff = () => DnD.impostazioni.reduceMotion() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const CATEGORY_KEY = { menu: 'diceMenu', combattimento: 'diceCombat', esplorazione: 'diceExploration' };
  // Animazione attiva per la categoria (interruttore generale e per categoria).
  const enabled = (categoria) => { const s = settings(); return s.diceAnim && s[CATEGORY_KEY[categoria] || 'diceMenu'] !== false; };
  function dieColor() {
    const p = DnD.colori && DnD.colori.byKey(settings().diceColor);
    return p ? p.hex : '#d4453a';
  }

  // ---------- Suoni (audio.js) ----------
  // Rotolio unico per tutti i dadi del tiro all'inizio dell'animazione; al risultato tonfo e, per 20 e 1 naturali,
  // il loro suono. Animazione saltata: il rotolio si ferma e resta solo il tonfo. Turni automatici veloci: solo 20 e 1.
  const audio = () => DnD.audio || { suona: () => ({ stop() {} }) };
  function landingSounds(plan, veloce) {
    audio().suona('dadi-tonfo', { veloce });
    const crit = plan.dadi.find((d) => d.crit && !d.dropped);
    if (crit) audio().suona(crit.crit === 'max' ? 'dadi-20' : 'dadi-1', { veloce, coda: true });
  }

  // ---------- Disegno dei dadi ----------
  const SHAPES = {
    4: { poly: '50,6 95,88 5,88', inner: '', ty: 64 },
    8: { poly: '50,4 94,50 50,96 6,50', inner: 'M6 50 L94 50', ty: 52 },
    10: { poly: '50,4 92,42 50,96 8,42', inner: 'M8 42 L50 58 L92 42 M50 58 L50 96', ty: 44 },
    12: { poly: '50,5 95,38 78,92 22,92 5,38', inner: 'M50 22 L76 42 L66 74 L34 74 L24 42 Z', ty: 52 },
    20: { poly: '50,3 93,27 93,73 50,97 7,73 7,27', inner: 'M50 22 L78 70 L22 70 Z', ty: 56 },
  };
  function svg(markup, viewBox) {
    const n = document.createElementNS(SVG_NS, 'svg');
    n.setAttribute('viewBox', viewBox);
    n.setAttribute('aria-hidden', 'true');
    n.innerHTML = markup;
    return n;
  }
  // Dado piatto (in prospettiva semplificata) con il numero sulla faccia.
  function flatDie(sides, label) {
    const sh = SHAPES[sides] || null;
    const shape = sh ? '<polygon class="die-body" points="' + sh.poly + '"/>' + (sh.inner ? '<path class="die-edge" d="' + sh.inner + '"/>' : '')
      : '<circle class="die-body" cx="50" cy="50" r="44"/>';
    const node = el('div', { class: 'die-anim d' + sides });
    node.append(svg(shape, '0 0 100 100'), el('span', { class: 'die-face', style: sh ? 'top:' + sh.ty + '%' : 'top:50%', text: label }));
    return node;
  }
  // d6 in 3D: cubo con i puntini, ruota fino a mostrare la faccia decisa.
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const FACE_ROT = { 1: 'rotateX(0deg) rotateY(0deg)', 2: 'rotateY(-90deg)', 3: 'rotateX(-90deg)', 4: 'rotateX(90deg)', 5: 'rotateY(90deg)', 6: 'rotateY(180deg)' };
  function cubeDie() {
    const cube = el('div', { class: 'die-cube' }, [1, 2, 3, 4, 5, 6].map((n) => el('div', { class: 'cube-face f' + n },
      Array.from({ length: 9 }, (_, i) => el('span', { class: PIPS[n].includes(i + 1) ? 'pip' : 'pip off' })))));
    return el('div', { class: 'die-anim d6 cube' }, el('div', { class: 'die-cube-wrap' }, cube));
  }
  const rnd = (n) => Math.floor(Math.random() * n) + 1; // solo per i numeri che scorrono durante il lancio (visivo)

  // Disegna e anima i dadi del piano in stage. Restituisce { skip(), done: Promise }.
  function animate(stage, plan, opts) {
    const o = opts || {};
    clear(stage);
    stage.style.setProperty('--die-color', dieColor());
    const nodes = [];
    plan.dadi.forEach((d, i) => {
      const parts = d.sides === 100 ? [{ sides: 10, label: d.faces[0], tens: true }, { sides: 10, label: d.faces[1], units: true }] : [{ sides: d.sides, label: d.faces[0] }];
      const wrap = el('div', { class: 'die-slot' + (d.dropped ? ' dropped' : '') + (d.crit ? ' crit-' + d.crit : '') + (d.sides === 100 ? ' d100' : ''), title: (d.dropped ? 'Scartato: ' : '') + 'd' + d.sides + ' = ' + d.value });
      for (const p of parts) {
        const node = p.sides === 6 ? cubeDie() : flatDie(p.sides, p.label);
        node.style.setProperty('--delay', (i * 40) + 'ms');
        node.style.setProperty('--spin', (Math.random() < 0.5 ? -1 : 1) * (360 + rnd(360)) + 'deg');
        wrap.append(node);
        nodes.push({ node, die: d, part: p });
      }
      stage.append(wrap);
    });
    if (plan.soloTotale) stage.append(el('div', { class: 'die-many', text: plan.conta + ' dadi: solo il totale' }));
    const land = () => {
      for (const { node, die, part } of nodes) {
        node.classList.remove('rolling');
        if (part.sides === 6 && node.classList.contains('cube')) node.querySelector('.die-cube').style.transform = FACE_ROT[die.value];
        else node.querySelector('.die-face').textContent = part.label;
      }
      stage.classList.add('landed');
    };
    let timer = null;
    let flick = null;
    let rolling = { stop() {} };
    let finish;
    const done = new Promise((r) => { finish = r; });
    const end = () => {
      if (timer === null && flick === null && stage.classList.contains('landed')) return;
      clearTimeout(timer);
      clearInterval(flick);
      timer = null;
      flick = null;
      land();
      rolling.stop();
      if (o.sound !== false) landingSounds(plan, o.veloce);
      finish();
    };
    stage.classList.remove('landed');
    if (!plan.animati) {
      land();
      if (o.sound !== false) landingSounds(plan, o.veloce);
      finish();
      return { skip: () => {}, done };
    }
    stage.style.setProperty('--roll-ms', plan.durata + 'ms');
    for (const { node, die, part } of nodes) {
      node.classList.add('rolling');
      if (part.sides === 6) {
        const cube = node.querySelector('.die-cube');
        cube.style.transition = 'none';
        cube.style.transform = 'rotateX(' + (720 + rnd(360)) + 'deg) rotateY(' + (720 + rnd(360)) + 'deg)';
        void cube.offsetWidth; // riparte dalla rotazione casuale
        cube.style.transition = '';
        cube.style.transform = FACE_ROT[die.value];
      }
    }
    if (o.sound !== false) rolling = audio().suona('dadi-rotolio', { veloce: o.veloce, durata: plan.durata / 1000 });
    // Numeri che scorrono durante il lancio (solo visivi), poi la faccia decisa.
    flick = setInterval(() => {
      for (const { node, part } of nodes) {
        if (part.sides === 6) continue;
        node.querySelector('.die-face').textContent = part.tens ? String((rnd(10) - 1) * 10).padStart(2, '0') : part.units ? String(rnd(10) - 1) : String(rnd(part.sides));
      }
    }, 70);
    timer = setTimeout(end, plan.durata);
    return { skip: end, done };
  }

  // Riepilogo sotto i dadi: etichetta, gruppi con i modificatori e totale.
  function summary(plan) {
    const parts = plan.gruppi.map((g) => el('span', { class: 'die-sum' }, el('small', { text: (g.values.length > 1 ? g.values.length : '') + 'd' + g.sides + ': ' }), D.testoGruppo(g)));
    const crit = plan.dadi.find((d) => d.crit);
    return el('div', { class: 'die-summary' },
      plan.etichetta ? el('div', { class: 'die-label', text: plan.etichetta }) : null,
      el('div', { class: 'die-groups' }, parts),
      crit ? el('div', { class: 'die-crit ' + crit.crit, text: crit.crit === 'max' ? '20 naturale!' : '1 naturale…' }) : null,
      plan.totale !== null && plan.gruppi.length !== 1 ? el('div', { class: 'die-total', text: String(plan.totale) }) : null,
      plan.testo ? el('div', { class: 'die-text', text: plan.testo }) : null);
  }

  // ---------- Overlay (combattimento, esplorazione) con la coda ----------
  let overlay = null;
  let current = null; // animazione in corso nell'overlay (per Spazio = salta)
  let fast = false;
  function overlayNode() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = el('div', { class: 'dice-overlay', 'aria-live': 'polite', role: 'status' });
    document.body.appendChild(overlay);
    return overlay;
  }
  function showInOverlay(tiro, done) {
    const s = settings();
    const plan = D.pianoAnimazione(tiro, { speed: fast ? 'veloce' : s.diceSpeed, reduceMotion: motionOff(), limit: D.MAX_ANIMATI });
    const box = overlayNode();
    const stage = el('div', { class: 'dice-stage small' });
    const card = el('div', { class: 'dice-card' }, stage, summary(plan));
    clear(box).append(card);
    box.classList.add('visible');
    current = animate(stage, plan, { veloce: fast });
    current.done.then(() => {
      current = null;
      setTimeout(() => {
        if (card.isConnected) { box.classList.remove('visible'); setTimeout(() => card.remove(), 250); }
        done();
      }, fast ? 350 : plan.animati ? HOLD : HOLD + 400);
    });
  }
  const queue = D.coda(showInOverlay, { gap: () => (fast ? 80 : 200) });

  // Interfaccia pubblica: mostra un tiro già deciso. opts: { veloce } (turni automatici dell'IA).
  // Il tiro va comunque nel log o nella cronologia di chi lo ha fatto; qui c'è solo la parte visiva.
  function mostraTiro(tiro, opts) {
    const t = D.normalizeTiro(tiro);
    if (!t.gruppi.length || !enabled(t.categoria) || typeof document === 'undefined') return false;
    fast = Boolean(opts && opts.veloce);
    queue.push(t);
    return true;
  }
  // Spazio salta l'animazione in corso (fuori dai campi di testo).
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || !current) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault();
      current.skip();
    });
  }

  // ---------- Menù Dadi ----------
  function mount(container) {
    const count = numberInput(1, { min: 1, max: D.MAX_COUNT, 'aria-label': 'Numero di dadi' });
    const mod = numberInput(0, { 'aria-label': 'Modificatore' });
    const expr = textInput('', { placeholder: 'es. 3d6+2', 'aria-label': 'Espressione libera' });
    const stage = el('div', { class: 'dice-stage', title: 'Clic per saltare l\'animazione' });
    const result = el('div', { class: 'dice-result', 'aria-live': 'polite' }, el('span', { class: 'muted', text: 'Scegli un dado da tirare.' }));
    const history = el('ol', { class: 'dice-history' });
    let anim = null;
    const skipBtn = el('button', { type: 'button', class: 'btn small', text: '⏭ Salta animazione', hidden: true, onclick: () => anim && anim.skip() });
    stage.addEventListener('click', () => anim && anim.skip());

    // rec: registratore usato per il tiro; label: espressione per la cronologia.
    function show(rec, label, extraTotal) {
      const tiro = rec.tiro(label, 'menu', extraTotal === undefined ? {} : { totale: extraTotal });
      // Gioco online: il giocatore condivide il tiro con il master (ui-online.js).
      if (DnD.uiDadi.suTiro) DnD.uiDadi.suTiro(tiro);
      const total = tiro.totale !== null ? tiro.totale : tiro.gruppi.reduce((s, g) => s + g.total, 0);
      // Cronologia e risultato: sempre, anche con l'animazione saltata o spenta.
      const values = tiro.gruppi.flatMap((g) => g.values);
      DnD.store.update((st) => DnD.dati.pushDiceHistory(st, { expr: label, rolls: values, total }));
      const plan = D.pianoAnimazione(tiro, { speed: settings().diceSpeed, reduceMotion: motionOff() || !enabled('menu'), limit: D.MAX_ANIMATI });
      clear(result).append(summary(Object.assign({}, plan, { etichetta: label, totale: total })));
      if (anim) anim.skip();
      anim = animate(stage, plan);
      skipBtn.hidden = !plan.animati;
      anim.done.then(() => { skipBtn.hidden = true; });
      renderHistory();
    }

    // Gioco online con «Tiri convalidati»: il tiro lo fa il master (DnD.uiDadi.remoto restituisce true se l'ha mandato).
    const remoto = (spec, label) => {
      if (!DnD.uiDadi.remoto || !DnD.uiDadi.remoto(spec)) return false;
      clear(result).append(el('span', { class: 'muted', text: '🎲 ' + label + ': tiro inviato al master…' }));
      return true;
    };
    function rollDie(sides) {
      const n = readNumber(count);
      const m = mod.value.trim() === '' ? 0 : readNumber(mod);
      if (!Number.isInteger(n) || n < 1 || n > D.MAX_COUNT) {
        toast('Il numero di dadi deve essere un intero tra 1 e ' + D.MAX_COUNT + '.', 'error');
        return;
      }
      if (!Number.isInteger(m) || Math.abs(m) > 1000) {
        toast('Il modificatore deve essere un intero tra -1000 e 1000.', 'error');
        return;
      }
      if (remoto({ tipo: 'espr', espr: D.formatExpr(n, sides, m) }, D.formatExpr(n, sides, m))) return;
      const rec = D.registratore();
      D.roll(n, sides, m, rec.rng);
      show(rec, D.formatExpr(n, sides, m));
    }
    // d20 con vantaggio o svantaggio: due d20, quello scartato attenuato.
    function rollD20(mode) {
      const m = mod.value.trim() === '' ? 0 : readNumber(mod) || 0;
      if (remoto({ tipo: 'd20', modo: mode, bonus: m }, 'd20 con ' + mode)) return;
      const rec = D.registratore();
      const r = DnD.regole.rollSave({ bonus: m, mode, dc: null }, rec.rng);
      show(rec, 'd20 ' + (mode === 'vantaggio' ? 'con vantaggio' : 'con svantaggio') + (m ? DnD.regole.formatModifier(m) : ''), r.total);
    }
    function roll4d6() {
      if (remoto({ tipo: '4d6' }, '4d6, scarta il più basso')) return;
      const rec = D.registratore();
      DnD.regole.roll4d6DropLowest(rec.rng);
      show(rec, '4d6, scarta il più basso');
    }

    function rollExpr(ev) {
      ev.preventDefault();
      const p = D.parseExpr(expr.value);
      if (!p || !p.count) {
        toast('Espressione non valida. Usa il formato NdM+X, ad esempio 3d6+2.', 'error');
        return;
      }
      if (remoto({ tipo: 'espr', espr: D.formatExpr(p.count, p.sides, p.modifier) }, D.formatExpr(p.count, p.sides, p.modifier))) return;
      const rec = D.registratore();
      D.roll(p.count, p.sides, p.modifier, rec.rng);
      show(rec, D.formatExpr(p.count, p.sides, p.modifier));
    }

    function renderHistory() {
      const h = DnD.store.state.diceHistory;
      clear(history);
      if (!h.length) history.append(el('li', { class: 'muted', text: 'Nessun tiro.' }));
      for (const e of h) {
        history.append(el('li', {},
          el('span', { class: 'hist-expr', text: e.expr }),
          el('span', { class: 'muted small', text: '[' + e.rolls.join(', ') + ']' }),
          el('b', { text: String(e.total) })));
      }
    }

    container.append(el('div', { class: 'dice-widget' },
      el('div', { class: 'dice-controls' },
        el('label', { class: 'inline' }, 'Dadi ', count),
        el('label', { class: 'inline' }, 'Modificatore ', mod)),
      el('div', { class: 'dice-buttons' }, DICE.map((s) => el('button', { type: 'button', class: 'btn die-btn', text: 'd' + s, onclick: () => rollDie(s) }))),
      el('div', { class: 'dice-extra' },
        el('button', { type: 'button', class: 'btn small', text: 'd20 con vantaggio', onclick: () => rollD20('vantaggio') }),
        el('button', { type: 'button', class: 'btn small', text: 'd20 con svantaggio', onclick: () => rollD20('svantaggio') }),
        el('button', { type: 'button', class: 'btn small', text: '4d6, scarta il più basso', onclick: roll4d6 })),
      el('form', { class: 'dice-expr-form', onsubmit: rollExpr }, expr, el('button', { type: 'submit', class: 'btn', text: 'Tira' })),
      stage, skipBtn,
      result,
      el('div', { class: 'history-head' },
        el('h3', { text: 'Ultimi tiri' }),
        el('button', { type: 'button', class: 'btn small', text: 'Svuota', onclick: () => { DnD.store.update((st) => { st.diceHistory = []; }); renderHistory(); } })),
      history));
    renderHistory();
  }

  function render(container) {
    clear(container).append(el('div', { class: 'section-head' }, el('h1', { text: 'Dadi' })), el('div', { class: 'panel' }));
    mount(container.lastChild);
  }

  function openPanel() {
    const body = el('div');
    mount(body);
    DnD.ui.openDialog('Dadi', body);
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.dadi = { title: 'Dadi', render };
  DnD.uiDadi = { mount, openPanel, mostraTiro, animate, enabled, queue, suTiro: null, remoto: null };
})(globalThis.DnD = globalThis.DnD || {});
