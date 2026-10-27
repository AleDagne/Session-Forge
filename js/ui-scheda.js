// Scheda del giocatore in stile scheda di D&D 5e (calcoli in regole.js e scheda.js): tre pagine (Personaggio,
// Storia, Incantesimi) compilate direttamente sulla scheda, con i valori automatici sovrascrivibili («auto» /
// «↺»); modalità Scheda, Creazione guidata e Vista di gioco sulla stessa bozza; stampa in tre pagine A4;
// «Sali di livello»; librerie di Background e Talenti; esporta/importa un personaggio.
(function (DnD) {
  'use strict';

  const { el, clear, fill, numberInput, textInput, readNumber, toast, openDialog } = DnD.ui;
  const R = DnD.regole;
  const S = DnD.scheda;
  const K = DnD.schedaDati;
  const A = DnD.attrezzatura;
  const C = DnD.classi;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const st = () => DnD.store.state;
  const fmt = (n) => R.formatModifier(n);
  const opt = (value, text, selected) => el('option', { value, text, selected });
  const m = (v) => String(v).replace('.', ',');
  const session = () => DnD.sessioni.current(st());
  const visible = (key) => DnD.sessioni.visible(st(), key);
  const PAGES = [{ id: 'personaggio', label: 'Personaggio' }, { id: 'storia', label: 'Storia' }, { id: 'incantesimi', label: 'Incantesimi' }];

  // Valori della bozza (tutto quello che la scheda mostra di calcolato).
  function calc(p) {
    const race = st().races.find((r) => r.id === p.raceId) || null;
    const d = DnD.statistiche.derivedStats(p, race, st().equipment);
    const fx = d.fx || S.featEffects(p);
    return {
      race, d, fx, skills: S.skills(p, d, fx, st()), init: S.initiative(p, d, fx), speed: S.speed(p, race, fx, st().equipment),
      carry: S.carry(p, d, st().equipment), att: S.attunement(p, st().equipment), xp: S.xpInfo(p), asi: S.asiAvailable(p),
      passive: (k) => S.passive(p, k, d, fx, st()), bg: visible('backgrounds').find((b) => b.id === p.sheet.background) || null,
      prep: S.preparable(p, d), missing: S.missing(p, Object.assign({}, st(), { backgrounds: visible('backgrounds') })),
    };
  }
  // Prepara una bozza modificabile (campi della scheda sempre presenti).
  function draftOf(player) {
    const p = clone(player);
    p.sheet = S.normalizeSheet(p.sheet);
    p.status = DnD.riposi.normalizeStatus(p.status);
    p.inventory = A.normalizeInventory(p.inventory);
    p.coins = A.normalizeCoins(p.coins);
    return p;
  }

  // ---------- Editor (Scheda / Creazione guidata / Vista di gioco) ----------
  // o: { player, isNew, persist(salvato), done(salvato | null), host, wrap(head, nodo), heading, submitText, submitClass }
  function editor(o) {
    const p = draftOf(o.player);
    const legendary = p.type === 'leggendario';
    let mode = o.isNew && !legendary ? 'guidata' : 'scheda';
    if (o.isNew) p.sheet.wizard = { done: false, step: 0 };
    let page = 'personaggio';
    let pointBuy = false;
    let outs = [];
    let readers = [];
    const body = el('div', { class: 'char-body' });
    const status = el('span', { class: 'muted small char-status', 'aria-live': 'polite' });

    // Valori calcolati: si aggiornano a ogni modifica senza ridisegnare (il focus resta dov'è).
    const out = (fn, cls, titleFn) => { const s = el('span', { class: cls || '' }); outs.push((c) => { s.textContent = fn(c); if (titleFn) s.title = titleFn(c); }); return s; };
    function recalc() {
      if (p.hpMode === 'auto' && p.hpMethod === 'media') {
        const c0 = calc(p);
        const r = S.autoHp(p, R.modifier(c0.d.abilities.COS), c0.fx, 'media');
        if (r) { p.maxHp = Math.max(1, Math.min(9999, r.total)); p.hpBasis = r.basis; p.hpDetail = r.detail; }
      }
      const c = calc(p);
      for (const f of outs) f(c);
      status.textContent = c.missing.length ? '⚠ ' + c.missing.length + (c.missing.length === 1 ? ' campo da completare' : ' campi da completare') : '✓ Scheda completa';
      status.title = c.missing.map((x) => x.text).join('\n');
    }
    // I selettori che leggono dal DOM (icone, dimensione, fazione) passano nella bozza prima di ridisegnare.
    const collect = () => { for (const r of readers) r(); };
    function draw() {
      collect();
      outs = [];
      readers = [];
      fill(body, mode === 'guidata' ? wizard() : mode === 'gioco' ? gameSheet(p, true) : sheetPages());
      recalc();
    }
    const set = (fn, redraw) => { fn(); if (redraw) draw(); else recalc(); };

    function save(close) {
      collect();
      const data = clone(p);
      data.name = (data.name || '').trim() || 'Senza nome';
      if (mode === 'guidata' && close) data.sheet.wizard.done = true;
      const saved = DnD.dati.normalizeCreature(data, true);
      o.persist(saved);
      toast(close ? '«' + saved.name + '» salvato.' : 'Salvato.', 'success');
      if (close) o.done(saved);
      return saved;
    }
    const modeBtn = (id, label) => el('button', { type: 'button', class: 'tab' + (mode === id ? ' active' : ''), role: 'tab', 'aria-selected': String(mode === id), text: label, onclick: () => { mode = id; drawAll(); } });
    const head = el('div', { class: 'section-head no-print' }, el('h1', { text: o.heading || (o.isNew ? 'Nuovo giocatore' : 'Scheda di ' + p.name) }));
    const toolbar = el('div', { class: 'char-toolbar no-print' });
    function drawToolbar() {
      const c = calc(p);
      const lvMax = legendary ? 40 : 20;
      fill(toolbar,
        el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Modalità' }, legendary ? null : modeBtn('guidata', '🧭 Creazione guidata'), modeBtn('scheda', '📜 Scheda'), modeBtn('gioco', '🎲 Vista di gioco')),
        status,
        el('div', { class: 'head-actions' },
          o.isNew ? null : el('button', { type: 'button', class: 'btn small', text: '⬆ Sali di livello', disabled: p.level >= lvMax, title: c.xp.canLevelUp ? 'Hai i PE per il livello ' + (p.level + 1) : '', onclick: () => levelUpDialog(save(false), (np) => { Object.assign(p, draftOf(np)); drawAll(); }) }),
          el('button', { type: 'button', class: 'btn small', text: '🖨 Stampa', onclick: () => { collect(); printSheet(p); } }),
          o.isNew ? null : el('button', { type: 'button', class: 'btn small', text: '⬇ Esporta', onclick: () => { collect(); exportCharacter(DnD.dati.normalizeCreature(clone(p), true)); } }),
          el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => o.done(null) }),
          el('button', { type: 'button', class: 'btn primary' + (o.submitClass ? ' ' + o.submitClass : ''), text: o.submitText || 'Salva', onclick: () => save(true) })));
    }
    function drawAll() { drawToolbar(); draw(); }
    const root = el('div', { class: 'char-editor' }, toolbar, body);
    (o.host).append(o.wrap ? o.wrap(head, root) : el('div', {}, head, root));

    // ---------- Pagine della scheda ----------
    function sheetPages() {
      const caster = S.isCaster(p);
      const pages = PAGES.filter((x) => x.id !== 'incantesimi' || caster);
      if (!pages.some((x) => x.id === page)) page = 'personaggio';
      return [
        el('div', { class: 'char-pagebar no-print' },
          DnD.uiAsset.tabBar(pages, page, 'Pagine della scheda', 'scheda-pg-', (id) => { page = id; draw(); }, true),
          (C.classInfo(p.classId, p.customClass) || {}).caster ? null : el('label', { class: 'check small' },
            el('input', { type: 'checkbox', checked: p.sheet.spellcaster, onchange: (e) => set(() => { p.sheet.spellcaster = e.target.checked; }, true) }), ' Incantatore',
            p.sheet.spellcaster ? el('select', { 'aria-label': 'Tipo di incantatore', onchange: (e) => set(() => { p.sheet.casterType = e.target.value; }) }, C.CASTER_TYPES.map((t) => opt(t, C.CASTER_NAMES[t], t === p.sheet.casterType))) : null)),
        el('div', { class: 'char-sheet', role: 'tabpanel' }, page === 'storia' ? pageStory() : page === 'incantesimi' ? pageSpells() : pageMain()),
      ];
    }

    // Campo calcolato con «auto» e sovrascrittura: get(c) automatico, value() manuale (null = auto), setter.
    function autoBox(label, autoText, detail, manual, onManual, attrs) {
      const input = numberInput(manual === null ? '' : manual, Object.assign({ class: 'qty', placeholder: 'auto', 'aria-label': label + ' (a mano)' }, attrs, {
        oninput: (e) => set(() => onManual(e.target.value.trim() === '' ? null : readNumber(e.target))),
      }));
      const badge = out((c) => (onManual.isManual(c) ? 'manuale' : 'auto'), 'char-badge');
      return el('div', { class: 'char-box char-auto' },
        el('div', { class: 'char-big' }, out(autoText, '', detail)),
        el('div', { class: 'char-box-label', text: label }),
        el('div', { class: 'char-auto-row' }, badge, input,
          el('button', { type: 'button', class: 'icon-btn', text: '↺', title: 'Torna al valore automatico', 'aria-label': 'Torna ad auto: ' + label, onclick: () => { input.value = ''; set(() => onManual(null)); } })));
    }
    const manualFn = (fn, isManual) => Object.assign(fn, { isManual });

    // ---------- Pagina 1: Personaggio ----------
    function pageMain() {
      return [header(), el('div', { class: 'char-cols' }, el('div', { class: 'char-col' }, abilitiesBlock(), savesBlock(), skillsBlock(), profsBlock()),
        el('div', { class: 'char-col' }, combatBlock(), hpBlock(), attacksBlock(), equipmentBlock()),
        el('div', { class: 'char-col' }, personalityBlock(), featuresBlock()))];
    }
    function header() {
      const races = st().races;
      const lvMin = legendary ? 20 : 1;
      const lvMax = legendary ? 40 : 20;
      const bgs = visible('backgrounds');
      return el('div', { class: 'char-header' },
        el('label', { class: 'char-name' }, el('span', { class: 'char-label', text: 'Nome del personaggio' }),
          textInput(p.name, { maxlength: 60, 'aria-label': 'Nome del personaggio', oninput: (e) => set(() => { p.name = e.target.value; }) })),
        el('div', { class: 'char-header-grid' },
          labeled('Classe', el('select', { onchange: (e) => set(() => { p.classId = e.target.value; if (p.saveMode === 'classe') p.saves = ((C.classInfo(p.classId, p.customClass) || {}).saves || []).slice(); if (o.isNew && p.hpMode !== 'auto' && C.classInfo(p.classId)) { p.hpMode = 'auto'; p.hpMethod = 'media'; } }, true) },
            opt('', '— Classe —', !p.classId), C.IDS.map((id) => opt(id, C.CLASSES[id].name, id === p.classId)), opt(C.CUSTOM, 'Personalizzata', p.classId === C.CUSTOM))),
          labeled('Livello', numberInput(p.level, { min: lvMin, max: lvMax, class: 'qty', oninput: (e) => { const v = readNumber(e.target); if (Number.isInteger(v) && v >= lvMin && v <= lvMax) set(() => { p.level = v; }); } })),
          labeled('Background', el('span', { class: 'input-row' },
            el('select', { 'aria-label': 'Background', onchange: (e) => { const bg = bgs.find((b) => b.id === e.target.value); if (bg) applyBackgroundDialog(p, bg, () => draw()); else set(() => { p.sheet.background = ''; }, true); } },
              opt('', '— Background —', !p.sheet.background), bgs.map((b) => opt(b.id, b.name, b.id === p.sheet.background)),
              p.sheet.background && !bgs.some((b) => b.id === p.sheet.background) ? opt(p.sheet.background, '⚠ background eliminato', true) : null))),
          labeled('Nome del giocatore', textInput(p.playerName, { maxlength: 60, oninput: (e) => set(() => { p.playerName = e.target.value; }) })),
          labeled('Razza', el('select', { onchange: (e) => set(() => { p.raceId = e.target.value; }, true) }, opt('', '— Razza —', !p.raceId), races.map((r) => opt(r.id, r.name, r.id === p.raceId)))),
          labeled('Allineamento', el('select', { onchange: (e) => set(() => { p.sheet.alignment = e.target.value; }) }, opt('', '—', !p.sheet.alignment), K.ALIGNMENTS.map((a) => opt(a, a, a === p.sheet.alignment)))),
          labeled('Punti esperienza', el('span', {}, numberInput(p.xp || 0, { min: 0, class: 'qty', oninput: (e) => set(() => { p.xp = Math.max(0, readNumber(e.target) || 0); }) }),
            out((c) => (legendary ? '' : c.xp.next === null ? ' (livello massimo)' : ' / ' + DnD.creature.formatXp(c.xp.next)), 'muted small'),
            out((c) => (c.xp.canLevelUp ? ' ⬆ puoi salire di livello' : ''), 'char-levelup')))),
        p.classId === C.CUSTOM ? el('p', { class: 'muted small', text: 'Classe personalizzata: dado vita, competenze e incantatore si impostano nel form dei nemici standard; qui valgono i dati già salvati.' }) : null);
    }
    const labeled = (text, node) => el('label', { class: 'char-field' }, el('span', { class: 'char-label', text }), node);

    function abilitiesBlock() {
      const box = el('div', { class: 'char-abilities' });
      const cells = R.ABILITIES.map((ab) => {
        const input = numberInput(p.abilities[ab], { min: 1, max: 30, class: 'char-base', 'aria-label': R.ABILITY_NAMES[ab] + ' (base)', disabled: pointBuy,
          oninput: (e) => { const v = readNumber(e.target); if (Number.isInteger(v) && v >= 1 && v <= 30) set(() => { p.abilities[ab] = v; }); } });
        return el('div', { class: 'char-ability' },
          el('div', { class: 'char-ability-name', text: R.ABILITY_NAMES[ab] }),
          out((c) => String(c.d.abilities[ab]), 'char-ability-score', (c) => 'Base ' + p.abilities[ab] + (R.racialBonus(c.race, ab) ? ' + razza ' + fmt(R.racialBonus(c.race, ab)) : '') + (p.asi[ab] ? ' + punti ' + p.asi[ab] : '') + (c.fx.abilities[ab] ? ' + talenti ' + c.fx.abilities[ab] : '') + ' = ' + c.d.abilities[ab]),
          out((c) => fmt(R.modifier(c.d.abilities[ab])), 'char-ability-mod'),
          el('div', { class: 'char-ability-base' }, 'base ', input),
          pointBuy ? el('div', { class: 'asi-row' },
            el('button', { type: 'button', class: 'asi-btn', text: '−', 'aria-label': 'Abbassa ' + R.ABILITY_NAMES[ab], onclick: () => { if (S.canBuy(p.abilities, ab, p.abilities[ab] - 1)) set(() => { p.abilities[ab] -= 1; }, true); } }),
            el('button', { type: 'button', class: 'asi-btn', text: '+', 'aria-label': 'Alza ' + R.ABILITY_NAMES[ab], onclick: () => { if (S.canBuy(p.abilities, ab, p.abilities[ab] + 1)) set(() => { p.abilities[ab] += 1; }, true); else toast('Oltre il budget o il massimo di 15.', 'error'); } }))
            : el('div', { class: 'asi-row', title: 'Punti caratteristica' },
              el('button', { type: 'button', class: 'asi-btn', text: '−', 'aria-label': 'Togli un punto da ' + R.ABILITY_NAMES[ab], onclick: () => { if (p.asi[ab] > 0) set(() => { p.asi[ab] -= 1; }, true); } }),
              out(() => String(p.asi[ab] || 0), 'asi-count'),
              el('button', { type: 'button', class: 'asi-btn', text: '+', 'aria-label': 'Aggiungi un punto a ' + R.ABILITY_NAMES[ab], onclick: () => { if (R.asiPointsAssigned(p.asi) < S.asiAvailable(p)) set(() => { p.asi[ab] = (p.asi[ab] || 0) + 1; }, true); else toast('Nessun punto caratteristica disponibile.', 'error'); } })));
      });
      const random = () => {
        const info = C.classInfo(p.classId, p.customClass);
        const r = R.randomizeAbilities({ mode: info ? 'classe' : 'random', source: '4d6', priority: info && info.priority }, DnD.dadi.randomInt);
        pointBuy = false;
        set(() => { Object.assign(p.abilities, r.abilities); }, true);
        toast('4d6 (scartato il più basso): ' + R.ABILITIES.map((ab) => ab + ' ' + r.abilities[ab]).join(' · '));
      };
      const standard = () => {
        const info = C.classInfo(p.classId, p.customClass);
        const r = R.randomizeAbilities({ mode: info ? 'classe' : 'random', source: 'standard', priority: info && info.priority }, DnD.dadi.randomInt);
        pointBuy = false;
        set(() => { Object.assign(p.abilities, r.abilities); }, true);
      };
      const buy = () => {
        if (pointBuy) { pointBuy = false; draw(); return; }
        if (!S.pointBuy(p.abilities).valid && !confirm('Acquisto punti: le caratteristiche ripartono da 8 con 27 punti da spendere. Continuare?')) return;
        if (!S.pointBuy(p.abilities).valid) Object.assign(p.abilities, S.pointBuyStart());
        pointBuy = true;
        draw();
      };
      fill(box, el('div', { class: 'char-section-title', text: 'Caratteristiche' }),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn small', text: '🎲 Randomizza', onclick: random }),
          el('button', { type: 'button', class: 'btn small' + (pointBuy ? ' active' : ''), text: pointBuy ? '✓ Acquisto punti' : 'Acquisto punti', 'aria-pressed': String(pointBuy), onclick: buy }),
          el('button', { type: 'button', class: 'btn small', text: 'Array standard', onclick: standard })),
        pointBuy ? out(() => { const r = S.pointBuy(p.abilities); return 'Acquisto punti: spesi ' + r.cost + ' su ' + K.POINT_BUY.budget + ' · rimasti ' + r.left + ' (8-15; costi 8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9)'; }, 'small char-pointbuy')
          : out((c) => 'Punti caratteristica: ' + R.asiPointsAssigned(p.asi) + ' assegnati su ' + c.asi + (c.asi < R.asiPointsAvailable(p.level) ? ' (talenti al posto dei punti)' : ''), 'muted small'),
        el('div', { class: 'char-ability-grid' }, cells));
      return el('section', { class: 'char-panel' }, box,
        el('div', { class: 'char-inline' },
          el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: p.sheet.inspiration, onchange: (e) => set(() => { p.sheet.inspiration = e.target.checked; }) }), ' Ispirazione'),
          autoBox('Bonus di competenza', (c) => fmt(c.d.profBonus), () => 'Dal livello ' + p.level, p.profBonusOverride,
            manualFn((v) => { p.profBonusOverride = v; }, () => p.profBonusOverride !== null), { min: 0, max: 20 })));
    }
    function savesBlock() {
      const classSaves = () => ((C.classInfo(p.classId, p.customClass) || {}).saves || []);
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title' }, 'Tiri salvezza ',
        out(() => (p.saveMode === 'classe' ? 'auto (dalla classe)' : 'manuali'), 'char-badge'),
        p.saveMode === 'classe' ? null : el('button', { type: 'button', class: 'icon-btn', text: '↺', title: 'Torna alle competenze della classe', 'aria-label': 'Tiri salvezza dalla classe', onclick: () => set(() => { p.saveMode = 'classe'; p.saves = classSaves().slice(); }, true) })),
      el('ul', { class: 'char-list' }, R.ABILITIES.map((ab) => el('li', {},
        el('input', { type: 'checkbox', checked: (p.saveMode === 'classe' ? classSaves() : p.saves).includes(ab), 'aria-label': 'Competenza nel tiro salvezza di ' + R.ABILITY_NAMES[ab],
          onchange: (e) => set(() => { if (p.saveMode === 'classe') { p.saves = classSaves().slice(); p.saveMode = 'manuale'; } p.saves = e.target.checked ? [...new Set(p.saves.concat(ab))] : p.saves.filter((x) => x !== ab); }, true) }),
        out((c) => fmt(c.d.saveTotals[ab]), 'char-num'), ' ' + R.ABILITY_NAMES[ab]))));
    }
    function skillsBlock() {
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Abilità' }),
        el('label', { class: 'check small', title: 'Metà del bonus di competenza (per difetto) alle abilità senza competenza' },
          el('input', { type: 'checkbox', checked: p.sheet.half, onchange: (e) => set(() => { p.sheet.half = e.target.checked; }) }), ' Metà competenza (es. «tuttofare»)'),
        el('ul', { class: 'char-list char-skills' }, Object.keys(DnD.creatureDati.SKILLS).map((k, i) => {
          const lv = p.sheet.skills[k] || 0;
          return el('li', {},
            el('input', { type: 'checkbox', checked: lv >= 1, 'aria-label': 'Competenza in ' + k, onchange: (e) => set(() => { if (e.target.checked) p.sheet.skills[k] = Math.max(1, p.sheet.skills[k] || 0); else delete p.sheet.skills[k]; }, true) }),
            el('input', { type: 'checkbox', class: 'char-expert', checked: lv === 2, 'aria-label': 'Maestria in ' + k, title: 'Maestria (competenza doppia)', onchange: (e) => set(() => { if (e.target.checked) p.sheet.skills[k] = 2; else if (p.sheet.skills[k] === 2) p.sheet.skills[k] = 1; }, true) }),
            out((c) => fmt(c.skills[i].total), 'char-num', (c) => c.skills[i].detail + (c.skills[i].level > lv ? ' (competenza da talento o Percorso)' : '')),
            ' ' + k + ' ', el('span', { class: 'muted small', text: '(' + DnD.creatureDati.SKILLS[k] + ')' }),
            numberInput(p.sheet.skillBonus[k] || '', { class: 'qty char-mini', placeholder: '±', 'aria-label': 'Bonus a mano a ' + k, oninput: (e) => set(() => { const v = readNumber(e.target); if (Number.isInteger(v) && v) p.sheet.skillBonus[k] = v; else delete p.sheet.skillBonus[k]; }) }));
        })),
        el('div', { class: 'char-passives' },
          el('div', {}, out((c) => String(c.passive('Percezione')), 'char-big'), el('span', { class: 'char-box-label', text: 'Percezione passiva' })),
          el('div', {}, out((c) => String(c.passive('Intuizione')), 'char-big'), el('span', { class: 'char-box-label', text: 'Intuizione passiva' })),
          el('div', {}, out((c) => String(c.passive('Indagare')), 'char-big'), el('span', { class: 'char-box-label', text: 'Indagare passiva' }))));
    }
    function profsBlock() {
      const box = el('div', {});
      const drawTags = () => {
        const c = calc(p);
        const sugg = S.profSuggestions(p, c.race, c.bg);
        const kind = el('select', { 'aria-label': 'Tipo di competenza' }, K.PROF_KINDS.map((k) => opt(k, K.PROF_KIND_NAMES[k], k === 'linguaggi')));
        const listId = 'prof-sugg-' + DnD.dadi.uid().slice(0, 6);
        const text = textInput('', { maxlength: 80, placeholder: 'es. Elfico, Arnesi da scasso', list: listId, 'aria-label': 'Competenza o linguaggio' });
        const add = (k, t) => { if (!t.trim() || p.sheet.proficiencies.some((x) => x.text.toLowerCase() === t.trim().toLowerCase())) return; p.sheet.proficiencies.push(S.normalizeProf({ kind: k, text: t })); drawTags(); recalc(); };
        fill(box,
          K.PROF_KINDS.map((k) => { const list = p.sheet.proficiencies.filter((x) => x.kind === k); return list.length ? el('div', { class: 'char-tags' }, el('b', { class: 'small', text: K.PROF_KIND_NAMES[k] + ': ' }),
            list.map((x) => el('span', { class: 'tag char-tag' }, x.text, el('button', { type: 'button', class: 'tag-x', text: '✕', 'aria-label': 'Togli ' + x.text, onclick: () => { p.sheet.proficiencies = p.sheet.proficiencies.filter((y) => y.id !== x.id); drawTags(); } })))) : null; }),
          el('div', { class: 'input-row' }, kind, text, el('datalist', { id: listId }, sugg.map((x) => el('option', { value: x.text }))),
            el('button', { type: 'button', class: 'btn small', text: '+', 'aria-label': 'Aggiungi la competenza', onclick: () => add(kind.value, text.value) })),
          sugg.length ? el('div', { class: 'char-tags small' }, 'Suggerite: ', sugg.slice(0, 12).map((x) => el('button', { type: 'button', class: 'tag char-sugg', title: 'Da: ' + x.from, text: '+ ' + x.text, onclick: () => add(x.kind, x.text) }))) : null);
      };
      drawTags();
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Altre competenze e linguaggi' }), box);
    }
    function combatBlock() {
      const armorList = st().equipment.filter((e) => e.armor && e.armor.type !== 'scudo');
      const shields = st().equipment.filter((e) => e.armor && e.armor.type === 'scudo');
      const info = C.classInfo(p.classId, p.customClass);
      return el('section', { class: 'char-panel' },
        el('div', { class: 'char-trio' },
          autoBox('Classe Armatura', (c) => String(c.d.ac.total), (c) => c.d.ac.detail, p.acMode === 'manuale' ? p.ac : null,
            manualFn((v) => { if (v === null) p.acMode = 'auto'; else { p.acMode = 'manuale'; p.ac = Math.max(1, Math.min(40, v)); } }, () => p.acMode === 'manuale'), { min: 1, max: 40 }),
          autoBox('Iniziativa', (c) => fmt(c.init.total), (c) => c.init.detail, p.sheet.overrides.initiative,
            manualFn((v) => { p.sheet.overrides.initiative = v; }, () => p.sheet.overrides.initiative !== null), { min: -20, max: 40 }),
          autoBox('Velocità (m)', (c) => m(c.speed.total), (c) => c.speed.detail, p.sheet.overrides.speed,
            manualFn((v) => { p.sheet.overrides.speed = v; }, () => p.sheet.overrides.speed !== null), { min: 0, max: 300, step: 1.5 })),
        el('details', { class: 'char-details' }, el('summary', { class: 'small', text: 'Armatura, scudo e bonus' }),
          el('div', { class: 'char-inline' },
            labeled('Armatura', el('select', { onchange: (e) => set(() => { p.armor.equipmentId = e.target.value; }) }, opt('', '— scritta a mano —', !p.armor.equipmentId), armorList.map((x) => opt(x.id, x.name, x.id === p.armor.equipmentId)))),
            labeled('Scudo', el('select', { onchange: (e) => set(() => { p.armor.shieldId = e.target.value; }) }, opt('', '— nessuno dal catalogo —', !p.armor.shieldId), shields.map((x) => opt(x.id, x.name, x.id === p.armor.shieldId)))),
            labeled('A mano', el('select', { onchange: (e) => set(() => { p.armor.type = e.target.value; p.armor.base = R.ARMOR_BASE[e.target.value]; }) }, R.ARMOR_TYPES.map((t) => opt(t, R.ARMOR_NAMES[t], t === p.armor.type)))),
            labeled('CA base', numberInput(p.armor.base, { min: 0, max: 30, class: 'qty', oninput: (e) => set(() => { p.armor.base = Math.max(0, Math.min(30, readNumber(e.target) || 0)); }) })),
            el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: p.armor.shield, onchange: (e) => set(() => { p.armor.shield = e.target.checked; }) }), ' Scudo (+2)'),
            info && info.unarmored ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: p.armor.unarmored, onchange: (e) => set(() => { p.armor.unarmored = e.target.checked; }) }), ' Difesa senza armatura') : null,
            labeled('Bonus magico CA', numberInput(p.armor.bonus || 0, { min: 0, max: 10, class: 'qty', oninput: (e) => set(() => { p.armor.bonus = Math.max(0, Math.min(10, readNumber(e.target) || 0)); }) })),
            labeled('Bonus iniziativa', numberInput(p.sheet.initiativeBonus, { min: -20, max: 20, class: 'qty', oninput: (e) => set(() => { p.sheet.initiativeBonus = readNumber(e.target) || 0; }) })),
            labeled('Bonus velocità (m)', numberInput(p.sheet.speedBonus, { min: -30, max: 60, step: 1.5, class: 'qty', oninput: (e) => set(() => { p.sheet.speedBonus = readNumber(e.target) || 0; }) })))));
    }
    function hpBlock() {
      const hd = () => (C.classInfo(p.classId, p.customClass) || {}).hitDie || 8;
      const ds = (kind) => [0, 1, 2].map((i) => el('input', { type: 'checkbox', checked: p.sheet.deathSaves[kind] > i, 'aria-label': (kind === 'successes' ? 'Successo ' : 'Fallimento ') + (i + 1),
        onchange: (e) => set(() => { p.sheet.deathSaves[kind] = e.target.checked ? i + 1 : i; }, true) }));
      return el('section', { class: 'char-panel char-hp' },
        el('div', { class: 'char-section-title' }, 'Punti ferita ', out(() => (p.hpMode === 'auto' ? 'auto (' + (p.hpMethod === 'media' ? 'media' : 'tiri') + ')' : 'manuali'), 'char-badge')),
        el('div', { class: 'char-trio' },
          el('div', { class: 'char-box' }, el('div', { class: 'char-big' }, p.hpMode === 'auto' ? out(() => String(p.maxHp), '', () => p.hpDetail) : numberInput(p.maxHp, { min: 1, max: 9999, class: 'qty', 'aria-label': 'PF massimi', oninput: (e) => set(() => { p.maxHp = Math.max(1, readNumber(e.target) || 1); }) })),
            el('div', { class: 'char-box-label', text: 'Massimi' })),
          el('div', { class: 'char-box' }, el('div', { class: 'char-big' }, numberInput(p.status.hp === null ? p.maxHp : p.status.hp, { min: 0, max: 9999, class: 'qty', 'aria-label': 'PF attuali', oninput: (e) => set(() => { const v = readNumber(e.target); p.status.hp = Number.isInteger(v) && v < p.maxHp ? Math.max(0, v) : null; }) })),
            el('div', { class: 'char-box-label', text: 'Attuali' })),
          el('div', { class: 'char-box' }, el('div', { class: 'char-big' }, numberInput(p.status.tempHp, { min: 0, max: 9999, class: 'qty', 'aria-label': 'PF temporanei', oninput: (e) => set(() => { p.status.tempHp = Math.max(0, readNumber(e.target) || 0); }) })),
            el('div', { class: 'char-box-label', text: 'Temporanei' }))),
        el('div', { class: 'char-inline small' },
          el('select', { 'aria-label': 'Modalità dei PF', onchange: (e) => { const [mode0, meth] = e.target.value.split(':'); set(() => { p.hpMode = mode0; if (meth) p.hpMethod = meth; if (mode0 === 'auto' && meth === 'tira') rollHp(); }, true); } },
            opt('auto:media', 'Auto: media della classe', p.hpMode === 'auto' && p.hpMethod === 'media'), opt('auto:tira', 'Auto: tira i dadi', p.hpMode === 'auto' && p.hpMethod === 'tira'), opt('manuale', 'Manuali', p.hpMode !== 'auto')),
          p.hpMode === 'auto' && p.hpMethod === 'tira' ? el('button', { type: 'button', class: 'btn small', text: '🎲 Ritira i PF', onclick: () => set(() => rollHp(), true) }) : null),
        el('div', { class: 'char-inline' },
          el('span', {}, el('b', { text: 'Dadi vita ' }), out(() => p.level + 'd' + hd() + ' · rimasti ', ''),
            numberInput(Math.max(0, p.level - p.status.hitDiceUsed), { min: 0, max: p.level, class: 'qty', 'aria-label': 'Dadi vita rimasti', oninput: (e) => set(() => { p.status.hitDiceUsed = Math.max(0, Math.min(p.level, p.level - (readNumber(e.target) || 0))); }) })),
          el('span', { class: 'char-death' }, el('b', { text: 'Tiri contro la morte ' }), 'successi ', ds('successes'), ' fallimenti ', ds('failures'))));
    }
    function rollHp() {
      const c = calc(p);
      const r = S.autoHp(p, R.modifier(c.d.abilities.COS), c.fx, 'tira');
      if (r) { p.maxHp = Math.max(1, Math.min(9999, r.total)); p.hpBasis = r.basis; p.hpDetail = r.detail; }
    }
    function attacksBlock() {
      const weapons = st().equipment.filter((e) => e.weapon);
      const box = el('div', {});
      const drawRows = () => {
        const c = calc(p);
        fill(box, el('table', { class: 'char-table' },
          el('thead', {}, el('tr', {}, ['Nome', 'Per colpire', 'Danno e tipo', ''].map((t) => el('th', { text: t })))),
          el('tbody', {}, p.weapons.map((w, i) => {
            const r = c.d.weapons[i] || w;
            const fromCat = Boolean(w.equipmentId && w.auto !== false && weapons.some((e) => e.id === w.equipmentId));
            return el('tr', {},
              el('td', {}, fromCat ? el('span', { text: r.name, title: r.detail || '' }) : textInput(w.name, { maxlength: 60, class: 'char-cell', 'aria-label': 'Nome dell\'arma', oninput: (e) => set(() => { w.name = e.target.value; }) })),
              el('td', {}, fromCat ? fmt(r.toHit) : numberInput(w.toHit, { class: 'qty', 'aria-label': 'Per colpire', oninput: (e) => set(() => { w.toHit = readNumber(e.target) || 0; }) })),
              el('td', {}, fromCat ? r.damageDice + (r.damageBonus ? fmt(r.damageBonus) : '') + ' ' + r.damageType
                : [textInput(w.damageDice, { class: 'qty', 'aria-label': 'Dado danno', oninput: (e) => set(() => { if (DnD.dadi.parseExpr(e.target.value)) w.damageDice = e.target.value.trim().toLowerCase(); }) }),
                  numberInput(w.damageBonus, { class: 'qty', 'aria-label': 'Bonus danno', oninput: (e) => set(() => { w.damageBonus = readNumber(e.target) || 0; }) }),
                  textInput(w.damageType, { class: 'qty', 'aria-label': 'Tipo di danno', oninput: (e) => set(() => { w.damageType = e.target.value; }) })]),
              el('td', {},
                o.isNew ? null : el('button', { type: 'button', class: 'btn small', text: '⚔ Attacca', title: 'Usa il combattimento in corso', onclick: () => attackInCombat(p) }),
                el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli ' + (r.name || 'l\'arma'), onclick: () => { p.weapons.splice(i, 1); drawRows(); recalc(); } })));
          }))),
        el('div', { class: 'input-row' },
          el('select', { 'aria-label': 'Arma dal catalogo', onchange: (e) => { const x = weapons.find((y) => y.id === e.target.value); if (x) { p.weapons.push({ id: DnD.dadi.uid(), equipmentId: x.id, auto: true, name: x.name, toHit: 0, damageDice: x.weapon.dice, damageBonus: 0, damageType: x.weapon.damageType }); drawRows(); recalc(); } e.target.value = ''; } },
            opt('', '+ Arma dal catalogo…', true), weapons.map((x) => opt(x.id, x.name, false))),
          el('button', { type: 'button', class: 'btn small', text: '+ Riga libera', onclick: () => { p.weapons.push({ id: DnD.dadi.uid(), equipmentId: '', name: 'Attacco', toHit: 0, damageDice: '1d6', damageBonus: 0, damageType: '' }); drawRows(); } })));
      };
      drawRows();
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Attacchi e incantesimi' }), box);
    }
    function equipmentBlock() {
      const box = el('div', {});
      const cat = () => st().equipment;
      const drawRows = () => {
        fill(box, el('table', { class: 'char-table' },
          el('thead', {}, el('tr', {}, ['Qtà', 'Oggetto', 'Peso', 'Equip.', 'Sint.', ''].map((t) => el('th', { text: t })))),
          el('tbody', {}, p.inventory.map((x, i) => {
            const e = cat().find((y) => y.id === x.equipmentId);
            return el('tr', { class: e ? '' : 'char-missing' },
              el('td', {}, numberInput(x.qty, { min: 0, max: 100000, class: 'qty', 'aria-label': 'Quantità', oninput: (ev) => set(() => { x.qty = Math.max(0, readNumber(ev.target) || 0); }) })),
              el('td', { text: e ? e.name : '⚠ oggetto eliminato' }),
              el('td', { class: 'small', text: e ? A.formatWeight(e.weight * x.qty) : '' }),
              el('td', {}, el('input', { type: 'checkbox', checked: x.equipped, 'aria-label': 'Equipaggiato', onchange: (ev) => set(() => { x.equipped = ev.target.checked; }) })),
              el('td', {}, e && e.attunement ? el('input', { type: 'checkbox', checked: x.attuned, 'aria-label': 'In sintonia', onchange: (ev) => { if (ev.target.checked && !S.canAttune(p, cat())) { ev.target.checked = false; toast('Massimo ' + K.MAX_ATTUNEMENT + ' oggetti in sintonia.', 'error'); return; } set(() => { x.attuned = ev.target.checked; }); } }) : ''),
              el('td', {}, el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { p.inventory.splice(i, 1); drawRows(); recalc(); } })));
          }))),
        el('select', { 'aria-label': 'Aggiungi un oggetto', onchange: (ev) => { if (ev.target.value) { A.addToInventory(p.inventory, ev.target.value, 1); drawRows(); recalc(); } ev.target.value = ''; } },
          opt('', '+ Oggetto dell\'Attrezzatura…', true), cat().map((e) => opt(e.id, e.name + ' (' + A.CATEGORY_NAMES[e.category] + ')', false))));
      };
      drawRows();
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Equipaggiamento' }), box,
        el('div', { class: 'coins-row' }, A.CURRENCIES.map((k) => el('label', { class: 'inline small' }, numberInput(p.coins[k] || 0, { min: 0, class: 'qty', 'aria-label': A.CURRENCY_NAMES[k], oninput: (e) => set(() => { p.coins[k] = Math.max(0, readNumber(e.target) || 0); }) }), k))),
        el('div', { class: 'char-inline small' },
          out((c) => 'Peso ' + A.formatWeight(c.carry.weight) + ' su ' + m(c.carry.capacity) + ' kg' + (c.carry.manual ? ' (a mano)' : ''), '', (c) => 'Capacità: ' + c.carry.detail + ' (regola modificabile nei dati; qui a mano)'),
          numberInput(p.sheet.overrides.carry === null ? '' : p.sheet.overrides.carry, { min: 0, class: 'qty', placeholder: 'auto', 'aria-label': 'Capacità di carico a mano', oninput: (e) => set(() => { p.sheet.overrides.carry = e.target.value.trim() === '' ? null : Math.max(0, readNumber(e.target) || 0); }) }),
          out((c) => (c.carry.over ? '⚠ sovraccarico' : ''), 'char-warn'),
          out((c) => 'Sintonia ' + c.att.count + '/' + c.att.max, '', (c) => c.att.names.join(', '))));
    }
    function personalityBlock() {
      const bg = visible('backgrounds').find((b) => b.id === p.sheet.background) || null;
      return el('section', { class: 'char-panel' }, K.PERSONALITY.map((k) => {
        const ta = el('textarea', { rows: 2, maxlength: 2000, value: p.sheet.personality[k], 'aria-label': K.PERSONALITY_NAMES[k], oninput: (e) => { p.sheet.personality[k] = e.target.value; } });
        const sugg = bg ? bg.suggestions[k] : [];
        return el('div', { class: 'char-textbox' }, ta, el('div', { class: 'char-box-label' }, K.PERSONALITY_NAMES[k],
          sugg.length ? el('button', { type: 'button', class: 'link-btn small', text: ' (suggerimento)', title: sugg.join('\n'), onclick: () => { const s = sugg[Math.floor(Math.random() * sugg.length)]; ta.value = (ta.value ? ta.value + '\n' : '') + s; p.sheet.personality[k] = ta.value; } }) : null));
      }));
    }
    function featuresBlock() {
      const box = el('div', {});
      const feats = visible('feats');
      const drawList = () => {
        const c = calc(p);
        const asiFree = R.asiPointsAvailable(p.level) - 2 * p.sheet.features.filter((f) => f.featId && f.asi).length - R.asiPointsAssigned(p.asi) >= 2;
        fill(box, p.sheet.features.map((f, i) => {
          const feat = f.featId ? feats.find((x) => x.id === f.featId) : null;
          return el('div', { class: 'char-feature' + (f.featId && !feat ? ' char-missing' : '') },
            el('div', { class: 'input-row' },
              textInput(f.name, { maxlength: 80, class: 'char-feature-name', 'aria-label': 'Nome del privilegio', oninput: (e) => { f.name = e.target.value; } }),
              el('select', { 'aria-label': 'Fonte', onchange: (e) => { f.source = e.target.value; } }, K.FEATURE_SOURCES.map((s0) => opt(s0, K.FEATURE_SOURCE_NAMES[s0], s0 === f.source))),
              el('select', { 'aria-label': 'Usi', onchange: (e) => { f.uses.kind = e.target.value; if (f.uses.kind !== 'volonta' && !f.uses.max) f.uses.max = 1; drawList(); } }, K.USES.map((u) => opt(u, K.USES_NAMES[u], u === f.uses.kind))),
              f.uses.kind === 'volonta' ? null : numberInput(f.uses.max, { min: 1, max: 20, class: 'qty', 'aria-label': 'Usi massimi', oninput: (e) => { f.uses.max = Math.max(1, readNumber(e.target) || 1); } }),
              el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli ' + f.name, onclick: () => { p.sheet.features.splice(i, 1); drawList(); recalc(); } })),
            f.featId ? el('div', { class: 'small muted' }, feat ? '✦ Talento' + (f.asi ? ' al posto dei punti caratteristica' : '') + ': ' + featText(feat) : '⚠ talento eliminato (effetti disattivati)') : null,
            el('textarea', { rows: 2, maxlength: 2000, value: f.desc, 'aria-label': 'Descrizione di ' + f.name, oninput: (e) => { f.desc = e.target.value; } }));
        }),
        el('div', { class: 'input-row' },
          el('button', { type: 'button', class: 'btn small', text: '+ Privilegio', onclick: () => { p.sheet.features.push(S.normalizeFeature({ name: '', source: 'classe' })); drawList(); } }),
          el('select', { 'aria-label': 'Aggiungi un talento', onchange: (e) => {
            const feat = feats.find((x) => x.id === e.target.value);
            e.target.value = '';
            if (!feat) return;
            if (p.sheet.features.some((x) => x.featId === feat.id)) { toast('Talento già presente.', 'error'); return; }
            const asi = asiFree && confirm('Prendere «' + feat.name + '» al posto di 2 punti caratteristica? (Annulla = talento extra)');
            p.sheet.features.push(S.normalizeFeature({ name: feat.name, desc: feat.description, source: 'talento', featId: feat.id, asi }));
            drawList(); recalc();
          } }, opt('', '+ Talento…', true), feats.map((x) => opt(x.id, x.name, false))),
          (K.CLASS_FEATURES[p.classId] || []).some((x) => !p.sheet.features.some((f) => f.name === x.name)) ? el('button', { type: 'button', class: 'btn small', text: '+ Suggeriti dalla classe', onclick: () => {
            for (const x of K.CLASS_FEATURES[p.classId]) if (!p.sheet.features.some((f) => f.name === x.name)) p.sheet.features.push(S.normalizeFeature(Object.assign({ source: 'classe' }, x)));
            drawList();
          } }) : null),
        c.fx.names.length ? el('p', { class: 'muted small', text: 'Effetti dei talenti applicati ai calcoli: ' + c.fx.names.join(', ') + '.' }) : null);
      };
      drawList();
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Privilegi e tratti' }), box);
    }

    // ---------- Pagina 2: Storia ----------
    function pageStory() {
      const portrait = DnD.uiIcone.iconPicker(p.sheet.portrait || p.icon, false, 'Ritratto (separato dalla pedina)');
      const token = DnD.uiIcone.iconPicker(p.icon, false, 'Pedina');
      const grid = DnD.uiCreature.gridSizeEditor(p.gridSize, { size: () => { const r = st().races.find((x) => x.id === p.raceId); return r ? r.size : null; } });
      const world = DnD.uiMondo.worldRefsEditor(p, { player: true });
      readers.push(() => { const r1 = portrait.read(); if (r1.icon) p.sheet.portrait = r1.icon; const r2 = token.read(); if (r2.icon) p.icon = r2.icon; Object.assign(p, grid.read(), world.read()); });
      const story = DnD.noteEditor.create({ html: p.sheet.story, label: 'Storia del personaggio', onChange: (h) => { p.sheet.story = DnD.note.sanitizeHtml(h); } });
      const ta = (key, label, src) => el('div', { class: 'char-textbox' }, el('textarea', { rows: 3, maxlength: 5000, value: (src || p.sheet)[key], 'aria-label': label, oninput: (e) => { (src || p.sheet)[key] = e.target.value; } }), el('div', { class: 'char-box-label', text: label }));
      return el('div', { class: 'char-cols char-cols-2' },
        el('div', { class: 'char-col' },
          el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Aspetto' }),
            el('div', { class: 'char-header-grid' }, K.APPEARANCE.map((k) => labeled(K.APPEARANCE_NAMES[k], textInput(p.sheet.appearance[k], { maxlength: 40, oninput: (e) => { p.sheet.appearance[k] = e.target.value; } })))),
            portrait.node),
          el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Storia del personaggio' }), story.node),
          el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Pedina sulla griglia' }), token.node, grid.node)),
        el('div', { class: 'char-col' },
          alliesBlock(),
          el('section', { class: 'char-panel' }, ta('extraFeatures', 'Tratti e privilegi aggiuntivi'), ta('treasure', 'Tesoro (oggetti notevoli)'), ta('notes', 'Note del giocatore', p)),
          el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Percorso e fazione' }), world.node,
            el('p', { class: 'small', text: 'Party: ' + (() => { const v = DnD.fazioni.view(st()); const pt = DnD.party.partyOf(v.parties, p.id); return pt ? pt.name : 'nessuno'; })() }),
            !legendary && !o.isNew && p.level >= 20 ? el('button', { type: 'button', class: 'btn legend-ascend-btn', text: '✦ Eleva a leggendario', onclick: () => { const saved = save(false); if (DnD.uiLeggendario.promote(saved)) o.done(null); } }) : null)));
    }
    function alliesBlock() {
      const box = el('div', {});
      const v = DnD.fazioni.view(st());
      const party = DnD.party.partyOf(v.parties, p.id) || DnD.party.active(v.parties, v.world);
      const drawList = () => fill(box, p.sheet.allies.map((a, i) => el('div', { class: 'input-row' },
        el('select', { 'aria-label': 'Tipo', onchange: (e) => { a.kind = e.target.value; a.refId = ''; drawList(); } }, K.ALLY_KINDS.map((k) => opt(k, k === 'fazione' ? 'Fazione' : k === 'npc' ? 'NPC' : 'Altro', k === a.kind))),
        a.kind === 'fazione' ? el('select', { 'aria-label': 'Fazione', onchange: (e) => { a.refId = e.target.value; drawList(); } }, opt('', '—', !a.refId), v.factions.map((f) => opt(f.id, f.name, f.id === a.refId)), a.refId && !v.factions.some((f) => f.id === a.refId) ? opt(a.refId, '⚠ eliminata', true) : null)
          : a.kind === 'npc' ? el('select', { 'aria-label': 'NPC', onchange: (e) => { a.refId = e.target.value; } }, opt('', '—', !a.refId), v.npcs.map((n) => opt(n.id, n.name, n.id === a.refId)), a.refId && !v.npcs.some((n) => n.id === a.refId) ? opt(a.refId, '⚠ eliminato', true) : null) : null,
        textInput(a.text, { maxlength: 300, placeholder: 'note', 'aria-label': 'Note', oninput: (e) => { a.text = e.target.value; } }),
        a.kind === 'fazione' && a.refId ? el('span', { class: 'small muted', text: 'rep. ' + DnD.fazioni.reputationOf(v.world, party, a.refId, p.id) }) : null,
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: () => { p.sheet.allies.splice(i, 1); drawList(); } }))),
      el('button', { type: 'button', class: 'btn small', text: '+ Alleato o organizzazione', onclick: () => { p.sheet.allies.push(S.normalizeAlly({ kind: 'fazione' })); drawList(); } }));
      drawList();
      return el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Alleati e organizzazioni' }), box);
    }

    // ---------- Pagina 3: Incantesimi ----------
    function pageSpells() {
      const sc = p.spellcasting;
      const lib = st().spells;
      const info = C.classInfo(p.classId, p.customClass);
      const box = el('div', {});
      const drawLists = () => {
        const c = calc(p);
        const slots = c.d.spell ? c.d.spell.slotsTotal : [];
        const maxLv = S.maxSpellLevel(slots);
        const known = lib.filter((s) => sc.known.includes(s.id));
        const flag = (id) => p.sheet.spellFlags[id] || (p.sheet.spellFlags[id] = { prepared: false, ritual: false, concentration: null });
        const forClass = lib.filter((s) => !sc.known.includes(s.id) && (!p.classId || !C.CLASSES[p.classId] || !s.classes.length || s.classes.includes(p.classId)));
        fill(box, c.prep ? el('p', { class: c.prep.prepared > c.prep.max ? 'warn small' : 'muted small', text: 'Preparati ' + c.prep.prepared + ' · preparabili ' + c.prep.max + ' (livello' + (info && info.prepares === 'meta' ? ' / 2' : '') + ' + modificatore)' }) : null,
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => {
            const list = known.filter((s) => s.level === lv);
            if (lv > 0 && lv > maxLv && !list.length) return null;
            return el('section', { class: 'char-panel char-spell-level' },
              el('div', { class: 'char-section-title' }, lv === 0 ? 'Trucchetti' : 'Livello ' + lv,
                lv === 0 ? null : el('span', { class: 'small' }, ' · slot ',
                  numberInput(sc.slotOverrides[lv - 1] === null ? '' : sc.slotOverrides[lv - 1], { min: 0, max: 20, class: 'qty char-mini', placeholder: String((DnD.classi.slotTable(c.d.info && c.d.info.caster, p.level) || [])[lv - 1] || 0), 'aria-label': 'Slot totali di ' + lv + '° livello (vuoto = auto)', oninput: (e) => set(() => { sc.slotOverrides[lv - 1] = e.target.value.trim() === '' ? null : Math.max(0, Math.min(20, readNumber(e.target) || 0)); }) }),
                  ' usati ', numberInput(sc.slotsUsed[lv - 1], { min: 0, max: 20, class: 'qty char-mini', 'aria-label': 'Slot usati di ' + lv + '° livello', oninput: (e) => set(() => { sc.slotsUsed[lv - 1] = Math.max(0, Math.min(20, readNumber(e.target) || 0)); }) }),
                  out((cc) => ' / ' + ((cc.d.spell && cc.d.spell.slotsTotal[lv - 1]) || 0), 'muted'))),
              el('ul', { class: 'char-list' }, list.map((s) => {
                const f = flag(s.id);
                return el('li', {},
                  lv === 0 ? null : el('label', { class: 'check small', title: 'Preparato' }, el('input', { type: 'checkbox', checked: f.prepared, 'aria-label': 'Preparato: ' + s.name, onchange: (e) => { f.prepared = e.target.checked; drawLists(); } }), ' P'),
                  el('label', { class: 'check small', title: 'Concentrazione' }, el('input', { type: 'checkbox', checked: f.concentration === null ? s.concentration : f.concentration, 'aria-label': 'Concentrazione: ' + s.name, onchange: (e) => { f.concentration = e.target.checked; } }), ' C'),
                  el('label', { class: 'check small', title: 'Rituale' }, el('input', { type: 'checkbox', checked: f.ritual, 'aria-label': 'Rituale: ' + s.name, onchange: (e) => { f.ritual = e.target.checked; } }), ' R'),
                  ' ', el('b', { text: s.name }), el('span', { class: 'muted small', text: ' ' + (s.castingTime || '') }),
                  o.isNew ? null : el('button', { type: 'button', class: 'btn small', text: '✨ Lancia', title: 'Usa il combattimento in corso', onclick: () => attackInCombat(p) }),
                  el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli ' + s.name, onclick: () => { sc.known = sc.known.filter((x) => x !== s.id); delete p.sheet.spellFlags[s.id]; drawLists(); recalc(); } }));
              })),
              el('select', { 'aria-label': 'Aggiungi un incantesimo di ' + (lv === 0 ? 'trucchetto' : lv + '° livello'), onchange: (e) => { if (e.target.value) { sc.known.push(e.target.value); drawLists(); recalc(); } } },
                opt('', '+ dalla libreria Magie…', true), forClass.filter((s) => s.level === lv).map((s) => opt(s.id, s.name, false))));
          }),
          sc.known.some((id) => !lib.some((s) => s.id === id)) ? el('p', { class: 'warn small', text: '⚠ Incantesimi eliminati dalla libreria: ' + sc.known.filter((id) => !lib.some((s) => s.id === id)).length + ' (disattivati).' }) : null);
      };
      drawLists();
      return [el('section', { class: 'char-panel' },
        el('div', { class: 'char-trio' },
          el('div', { class: 'char-box' }, el('div', { class: 'char-big' }, el('select', { 'aria-label': 'Caratteristica da incantatore', onchange: (e) => set(() => { sc.ability = e.target.value || null; }) },
            opt('', 'Auto (' + ((info && info.spellAbility) || 'INT') + ')', !sc.ability), R.ABILITIES.map((ab) => opt(ab, ab, ab === sc.ability)))), el('div', { class: 'char-box-label', text: 'Caratteristica' })),
          autoBox('CD del tiro salvezza', (c) => (c.d.spell ? String(c.d.spell.dc) : '—'), () => '8 + competenza + modificatore', sc.dcOverride, manualFn((v) => { sc.dcOverride = v; }, () => sc.dcOverride !== null), { min: 0, max: 40 }),
          autoBox('Attacco con incantesimo', (c) => (c.d.spell ? fmt(c.d.spell.attack) : '—'), () => 'competenza + modificatore', sc.attackOverride, manualFn((v) => { sc.attackOverride = v; }, () => sc.attackOverride !== null), { min: -10, max: 30 }))),
      box];
    }

    // ---------- Creazione guidata ----------
    function wizard() {
      const steps = S.STEPS;
      const step = Math.min(p.sheet.wizard.step, steps.length - 1);
      const go = (i) => { p.sheet.wizard.step = Math.max(0, Math.min(steps.length - 1, i)); draw(); };
      const name = steps[step];
      const c = calc(p);
      const missingOf = (k) => c.missing.filter((x) => x.step === k).length;
      return el('div', { class: 'char-wizard' },
        el('ol', { class: 'char-steps', 'aria-label': 'Passi' }, steps.map((k, i) => el('li', {},
          el('button', { type: 'button', class: 'link-btn' + (i === step ? ' active' : ''), 'aria-current': i === step ? 'step' : null, text: (i + 1) + '. ' + S.STEP_NAMES[k] + (missingOf(k) ? ' ⚠' : ''), onclick: () => go(i) })))),
        el('div', { class: 'char-wizard-main' },
          el('h2', { text: (step + 1) + '. ' + S.STEP_NAMES[name] }),
          wizardStep(name),
          el('div', { class: 'form-actions' },
            el('button', { type: 'button', class: 'btn', text: '← Indietro', disabled: step === 0, onclick: () => go(step - 1) }),
            el('button', { type: 'button', class: 'btn', text: 'Esci e completa dopo', title: 'Passa alla Scheda: i dati restano', onclick: () => { mode = 'scheda'; drawAll(); } }),
            step < steps.length - 1 ? el('button', { type: 'button', class: 'btn primary', text: 'Avanti →', onclick: () => go(step + 1) })
              : el('button', { type: 'button', class: 'btn primary', text: '✓ Salva il personaggio', onclick: () => save(true) }))),
        el('aside', { class: 'char-wizard-preview', 'aria-label': 'Anteprima della scheda' }, gameSheet(p, false)));
    }
    function wizardStep(name) {
      const races = st().races;
      if (name === 'razza') {
        return races.length ? el('div', { class: 'card-grid' }, races.map((r) => el('label', { class: 'card pick-card' + (r.id === p.raceId ? ' selected' : '') },
          el('input', { type: 'radio', name: 'wiz-razza', checked: r.id === p.raceId, onchange: () => set(() => { p.raceId = r.id; }, true) }),
          el('b', { text: r.name }), el('span', { class: 'muted small', text: r.size + ' · ' + m(r.speed) + ' m' + (r.languages ? ' · ' + r.languages : '') }))))
          : el('p', { class: 'empty', text: 'Nessuna razza nella libreria (sezione Razze). Puoi saltare il passo.' });
      }
      if (name === 'classe') {
        return el('div', {}, header(), el('p', { class: 'muted small', text: 'Con un livello iniziale oltre il 1° i PF (media della classe), i punti caratteristica e gli slot si calcolano da soli.' }));
      }
      if (name === 'caratteristiche') return abilitiesBlock();
      if (name === 'background') {
        const c = calc(p);
        const ch = S.classSkillChoice(p, c.bg);
        return el('div', {}, header(),
          ch ? el('section', { class: 'char-panel' }, el('div', { class: 'char-section-title', text: 'Abilità della classe: scegline ' + ch.count + ' (' + ch.chosen.length + ' scelte)' }),
            el('div', { class: 'check-row' }, ch.options.map((k) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: (p.sheet.skills[k] || 0) >= 1, disabled: c.bg && c.bg.skills.includes(k),
              onchange: (e) => set(() => { if (e.target.checked) p.sheet.skills[k] = Math.max(1, p.sheet.skills[k] || 0); else delete p.sheet.skills[k]; }, true) }), ' ' + k)))) : null,
          profsBlock());
      }
      if (name === 'equipaggiamento') {
        const kit = (K.CLASS_KITS[p.classId] || []);
        const gold = K.STARTING_GOLD[p.classId];
        return el('div', {},
          el('div', { class: 'head-actions' },
            kit.length ? el('button', { type: 'button', class: 'btn', text: '🎒 Kit iniziale della classe', onclick: () => { addKit(kit); draw(); } }) : null,
            gold ? el('button', { type: 'button', class: 'btn', text: '💰 Oro iniziale (' + gold[0] + (gold[1] > 1 ? ' × ' + gold[1] : '') + ' mo)', onclick: () => {
              const r = DnD.dadi.rollExpr(gold[0]);
              const mo = r.total * gold[1];
              p.coins.mo = (p.coins.mo || 0) + mo;
              toast('Oro iniziale: ' + gold[0] + ' = ' + r.total + (gold[1] > 1 ? ' × ' + gold[1] : '') + ' = ' + mo + ' mo.');
              draw();
            } }) : null),
          buyBox(), attacksBlock(), equipmentBlock());
      }
      if (name === 'incantesimi') return S.isCaster(p) ? pageSpells() : el('p', { class: 'muted', text: 'La classe non lancia incantesimi: salta questo passo (o attiva «Incantatore» nella Scheda).' });
      if (name === 'dettagli') {
        return el('div', {},
          el('div', { class: 'char-header-grid' },
            labeled('Nome del personaggio', textInput(p.name, { maxlength: 60, oninput: (e) => set(() => { p.name = e.target.value; }) })),
            labeled('Nome del giocatore', textInput(p.playerName, { maxlength: 60, oninput: (e) => set(() => { p.playerName = e.target.value; }) })),
            labeled('Allineamento', el('select', { onchange: (e) => set(() => { p.sheet.alignment = e.target.value; }) }, opt('', '—', !p.sheet.alignment), K.ALIGNMENTS.map((a) => opt(a, a, a === p.sheet.alignment)))),
            K.APPEARANCE.map((k) => labeled(K.APPEARANCE_NAMES[k], textInput(p.sheet.appearance[k], { maxlength: 40, oninput: (e) => { p.sheet.appearance[k] = e.target.value; } })))),
          personalityBlock());
      }
      const c = calc(p);
      return el('div', {},
        c.missing.length ? el('ul', { class: 'char-missing-list' }, c.missing.map((x) => el('li', {}, '⚠ ' + x.text + ' ',
          el('button', { type: 'button', class: 'link-btn small', text: '(vai al passo)', onclick: () => { p.sheet.wizard.step = S.STEPS.indexOf(x.step); draw(); } })))) : el('p', { text: '✓ Nessun campo mancante.' }),
        el('p', { class: 'muted small', text: 'I campi mancanti non bloccano il salvataggio: si completano dopo dalla Scheda.' }));
    }
    function addKit(names) {
      const added = [];
      for (const n of names) {
        const e = st().equipment.find((x) => x.name.toLowerCase() === n.toLowerCase());
        if (!e) continue;
        if (!p.inventory.some((x) => x.equipmentId === e.id)) { p.inventory.push({ id: DnD.dadi.uid(), equipmentId: e.id, qty: 1, equipped: true, attuned: false }); added.push(e.name); }
        if (e.weapon && !p.weapons.some((w) => w.equipmentId === e.id)) p.weapons.push({ id: DnD.dadi.uid(), equipmentId: e.id, auto: true, name: e.name, toHit: 0, damageDice: e.weapon.dice, damageBonus: 0, damageType: e.weapon.damageType });
        if (e.armor && e.armor.type === 'scudo') { p.armor.shieldId = e.id; p.acMode = 'auto'; } else if (e.armor) { p.armor.equipmentId = e.id; p.acMode = 'auto'; }
      }
      toast(added.length ? 'Aggiunti: ' + added.join(', ') + '.' : 'Nessun oggetto del kit nel catalogo (o già presenti).');
    }
    function buyBox() {
      const sel = el('select', { 'aria-label': 'Oggetto da comprare' }, st().equipment.map((e) => opt(e.id, e.name + ' — ' + A.formatCost(e.cost), false)));
      return el('div', { class: 'input-row' }, sel, el('button', { type: 'button', class: 'btn small', text: '🛒 Compra', onclick: () => {
        const e = st().equipment.find((x) => x.id === sel.value);
        if (!e) return;
        const cp = Math.round(e.cost.amount * A.CURRENCY_VALUE[e.cost.unit]);
        const purse = DnD.npc.pay(p.coins, cp);
        if (!purse) { toast('Monete insufficienti per ' + e.name + '.', 'error'); return; }
        p.coins = purse;
        A.addToInventory(p.inventory, e.id, 1);
        toast(e.name + ' comprato (' + A.formatCost(e.cost) + ').', 'success');
        draw();
      } }));
    }
    drawAll();
    return { draft: p, save, setMode: (x) => { mode = x; drawAll(); } };
  }

  const featText = (f) => [f.requirements ? 'req. ' + f.requirements : '',
    Object.entries(f.effects.abilities).map(([ab, v]) => ab + ' ' + fmt(v)).join(' '), f.effects.skills.length ? 'competenza: ' + f.effects.skills.join(', ') : '',
    f.effects.saves.length ? 'TS: ' + f.effects.saves.join(', ') : '', f.effects.ac ? 'CA ' + fmt(f.effects.ac) : '', f.effects.hp ? 'PF +' + f.effects.hp : '',
    f.effects.hpPerLevel ? 'PF +' + f.effects.hpPerLevel + '/livello' : '', f.effects.speed ? 'velocità ' + fmt(f.effects.speed) + ' m' : '', f.effects.initiative ? 'iniziativa ' + fmt(f.effects.initiative) : ''].filter(Boolean).join(' · ');

  // «Attacca» / «Lancia»: apre il combattimento in corso sul combattente del personaggio.
  function attackInCombat(p) {
    const c = DnD.sessioni.current(st()).combat;
    const x = c && c.combatants.find((y) => y.kind === 'player' && y.sourceId === p.id);
    if (!x) { toast('Nessun combattimento in corso con «' + p.name + '».', 'error'); return; }
    DnD.app.navigate('combattimento');
    setTimeout(() => DnD.uiCombattimento.selectCombatant(x.id, 'scheda'), 0);
  }

  // Background: anteprima delle aggiunte e conferma (niente duplicati).
  function applyBackgroundDialog(p, bg, after) {
    const r = S.applyBackground(p, bg, st().equipment);
    openDialog('Background «' + bg.name + '»', el('div', { class: 'form' },
      r.changes.length ? el('ul', {}, r.changes.map((t) => el('li', { text: t }))) : el('p', { text: 'Niente da aggiungere.' }),
      r.skipped.length ? el('p', { class: 'muted small', text: 'Già presenti o non disponibili: ' + r.skipped.join(', ') + '.' }) : null), [
      { text: 'Annulla', onclick: () => { after(); } },
      { text: 'Applica', class: 'primary', onclick: () => { Object.assign(p, r.player); after(); } },
    ]);
  }

  // ---------- Vista di gioco (anche anteprima della creazione guidata) ----------
  // live: i dati che cambiano in partita (PF, slot, condizioni, ispirazione) si modificano con un clic.
  function gameSheet(p, live) {
    const c = calc(p);
    const d = c.d;
    const box = el('div', { class: 'char-game' });
    const persistLive = (fn) => {
      fn(p);
      if (!live) return;
      DnD.store.update((s) => { const x = s.players.find((y) => y.id === p.id); if (x) fn(x); });
      fill(box, gameSheet(p, live));
    };
    const hp = p.status.hp === null ? p.maxHp : p.status.hp;
    const portrait = DnD.icone.iconCanvas(p.sheet.portrait || p.icon, 56);
    const slots = d.spell ? d.spell.slotsTotal : [];
    fill(box,
      el('div', { class: 'char-game-head' }, portrait, el('div', {}, el('h2', { text: p.name || 'Senza nome' }),
        el('p', { class: 'muted small', text: [DnD.ui.raceName(p.raceId), C.className(p.classId), 'livello ' + p.level, c.bg ? c.bg.name : '', p.sheet.alignment].filter(Boolean).join(' · ') }))),
      el('div', { class: 'char-game-stats' },
        stat('CA', d.ac.total, d.ac.detail), stat('Iniziativa', fmt(c.init.total), c.init.detail), stat('Velocità', m(c.speed.total) + ' m', c.speed.detail),
        stat('Competenza', fmt(d.profBonus)), stat('Perc. passiva', c.passive('Percezione'))),
      el('div', { class: 'char-game-abilities' }, R.ABILITIES.map((ab) => el('div', { class: 'char-ability small' },
        el('b', { text: ab }), el('span', { class: 'char-ability-score', text: String(d.abilities[ab]) }), el('span', { class: 'char-ability-mod', text: fmt(R.modifier(d.abilities[ab])) }),
        el('span', { class: 'muted small', text: 'TS ' + fmt(d.saveTotals[ab]) + (d.saves.includes(ab) ? ' ●' : '') }))) ),
      el('div', { class: 'char-game-hp' },
        el('b', { text: 'PF ' + hp + '/' + p.maxHp + (p.status.tempHp ? ' (+' + p.status.tempHp + ' temp.)' : '') }),
        live ? [el('button', { type: 'button', class: 'btn small', text: '−1', 'aria-label': 'Togli 1 PF', onclick: () => persistLive((x) => { x.status = DnD.riposi.normalizeStatus(x.status); const cur = x.status.hp === null ? x.maxHp : x.status.hp; x.status.hp = Math.max(0, cur - 1); }) }),
          el('button', { type: 'button', class: 'btn small', text: '+1', 'aria-label': 'Aggiungi 1 PF', onclick: () => persistLive((x) => { x.status = DnD.riposi.normalizeStatus(x.status); const cur = x.status.hp === null ? x.maxHp : x.status.hp; x.status.hp = cur + 1 >= x.maxHp ? null : cur + 1; }) }),
          el('button', { type: 'button', class: 'btn small', text: '🛏 Risorse…', onclick: () => DnD.uiRiposi.playerDialog(p.id, () => { const fresh = st().players.find((y) => y.id === p.id); if (fresh) { Object.assign(p, draftOf(fresh)); fill(box, gameSheet(p, live)); } }) })] : null,
        el('span', { class: 'small', text: ' · dadi vita ' + Math.max(0, p.level - p.status.hitDiceUsed) + '/' + p.level + ' · morte ✓' + p.sheet.deathSaves.successes + ' ✗' + p.sheet.deathSaves.failures }),
        live ? el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: p.sheet.inspiration, onchange: (e) => persistLive((x) => { x.sheet = S.normalizeSheet(x.sheet); x.sheet.inspiration = e.target.checked; }) }), ' Ispirazione') : null),
      el('div', { class: 'char-tags' }, el('b', { class: 'small', text: 'Condizioni: ' }), live
        ? DnD.condizioni.TYPES.filter((t) => t.id !== 'sfinimento' && t.id !== 'sorpreso').map((t) => el('button', { type: 'button', class: 'tag char-cond' + (p.sheet.conditions.includes(t.id) ? ' on' : ''), 'aria-pressed': String(p.sheet.conditions.includes(t.id)), title: t.text, text: t.icon + ' ' + t.name,
          onclick: () => persistLive((x) => { x.sheet = S.normalizeSheet(x.sheet); x.sheet.conditions = x.sheet.conditions.includes(t.id) ? x.sheet.conditions.filter((y) => y !== t.id) : x.sheet.conditions.concat(t.id); }) }))
        : el('span', { class: 'small', text: p.sheet.conditions.join(', ') || 'nessuna' })),
      slots.some((n) => n) ? el('div', { class: 'char-game-slots' }, el('b', { class: 'small', text: 'Slot: ' }), slots.map((n, i) => (n ? el('span', { class: 'char-slot-group' }, (i + 1) + '° ',
        Array.from({ length: n }, (_, k) => el('button', { type: 'button', class: 'char-pip' + (k < p.spellcasting.slotsUsed[i] ? ' used' : ''), disabled: !live, 'aria-label': 'Slot ' + (i + 1) + '° ' + (k + 1) + (k < p.spellcasting.slotsUsed[i] ? ' usato' : ' libero'),
          onclick: () => persistLive((x) => { const used = x.spellcasting.slotsUsed[i]; x.spellcasting.slotsUsed[i] = k < used ? k : k + 1; }) }))) : null))) : null,
      el('div', { class: 'char-game-cols' },
        el('div', {}, el('b', { class: 'small', text: 'Abilità' }), el('ul', { class: 'char-list small' }, c.skills.filter((s) => s.level || s.extra).map((s) => el('li', { text: fmt(s.total) + ' ' + s.skill + (s.level === 2 ? ' (maestria)' : '') })),
          c.skills.every((s) => !s.level && !s.extra) ? el('li', { class: 'muted', text: 'Nessuna competenza.' }) : null)),
        el('div', {}, el('b', { class: 'small', text: 'Attacchi' }), el('ul', { class: 'char-list small' }, d.weapons.map((w) => el('li', { text: DnD.uiCreature.weaponLabel(w) })), d.weapons.length ? null : el('li', { class: 'muted', text: 'Nessuno.' }))),
        el('div', {}, el('b', { class: 'small', text: 'Privilegi' }), el('ul', { class: 'char-list small' }, p.sheet.features.map((f) => el('li', { text: f.name + (f.uses.kind === 'volonta' ? '' : ' (' + f.uses.max + ' ' + K.USES_NAMES[f.uses.kind] + ')') })), p.sheet.features.length ? null : el('li', { class: 'muted', text: 'Nessuno.' })))));
    return box;
  }
  const stat = (label, value, title) => el('div', { class: 'char-box', title: title || null }, el('div', { class: 'char-big', text: String(value) }), el('div', { class: 'char-box-label', text: label }));

  // ---------- Stampa (tre pagine A4) ----------
  // Nodo da stampare: tre .sheet-page (personaggio, storia, incantesimi), in bianco e nero, senza interfaccia.
  function printNode(p) {
    const pp = draftOf(p);
    const c = calc(pp);
    const d = c.d;
    const row = (label, value) => el('div', { class: 'print-row' }, el('span', { class: 'print-label', text: label }), el('span', { class: 'print-value', text: value === '' || value === null || value === undefined ? '—' : String(value) }));
    const boxes = (list) => el('div', { class: 'print-boxes' }, list.map(([l, v]) => el('div', { class: 'print-box' }, el('div', { class: 'print-big', text: String(v) }), el('div', { class: 'print-label', text: l }))));
    const story = el('div', { class: 'print-story' });
    story.innerHTML = pp.sheet.story || '<p>—</p>';
    const spells = st().spells.filter((s) => pp.spellcasting.known.includes(s.id));
    return el('div', { class: 'sheet-print' },
      el('section', { class: 'sheet-page' },
        el('h1', { text: pp.name || 'Senza nome' }),
        el('div', { class: 'print-grid' }, row('Classe e livello', C.className(pp.classId) + ' ' + pp.level), row('Background', c.bg ? c.bg.name : ''), row('Giocatore', pp.playerName),
          row('Razza', DnD.ui.raceName(pp.raceId)), row('Allineamento', pp.sheet.alignment), row('Punti esperienza', pp.xp || 0)),
        boxes(R.ABILITIES.map((ab) => [ab + ' ' + fmt(R.modifier(d.abilities[ab])), d.abilities[ab]])),
        boxes([['CA', d.ac.total], ['Iniziativa', fmt(c.init.total)], ['Velocità', m(c.speed.total) + ' m'], ['PF massimi', pp.maxHp], ['Competenza', fmt(d.profBonus)], ['Perc. passiva', c.passive('Percezione')]]),
        el('div', { class: 'print-cols' },
          el('div', {}, el('h3', { text: 'Tiri salvezza' }), el('ul', {}, R.ABILITIES.map((ab) => el('li', { text: (d.saves.includes(ab) ? '● ' : '○ ') + fmt(d.saveTotals[ab]) + ' ' + R.ABILITY_NAMES[ab] }))),
            el('h3', { text: 'Abilità' }), el('ul', {}, c.skills.map((s) => el('li', { text: (s.level === 2 ? '◉ ' : s.level ? '● ' : '○ ') + fmt(s.total) + ' ' + s.skill })))),
          el('div', {}, el('h3', { text: 'Attacchi' }), el('ul', {}, d.weapons.map((w) => el('li', { text: DnD.uiCreature.weaponLabel(w) }))),
            el('h3', { text: 'Equipaggiamento' }), el('ul', {}, pp.inventory.map((x) => { const e = st().equipment.find((y) => y.id === x.equipmentId); return el('li', { text: x.qty + '× ' + (e ? e.name : '?') + (x.equipped ? ' (equip.)' : '') + (x.attuned ? ' (sintonia)' : '') }); })),
            el('p', { text: 'Monete: ' + A.formatCoins(pp.coins) }),
            el('h3', { text: 'Competenze e linguaggi' }), el('p', { text: pp.sheet.proficiencies.map((x) => x.text).join(', ') || '—' })),
          el('div', {}, K.PERSONALITY.map((k) => [el('h3', { text: K.PERSONALITY_NAMES[k] }), el('p', { text: pp.sheet.personality[k] || '—' })]),
            el('h3', { text: 'Privilegi e tratti' }), el('ul', {}, pp.sheet.features.map((f) => el('li', { text: f.name + (f.desc ? ': ' + f.desc : '') })))))),
      el('section', { class: 'sheet-page' },
        el('h1', { text: pp.name + ' — la storia' }),
        el('div', { class: 'print-grid' }, K.APPEARANCE.map((k) => row(K.APPEARANCE_NAMES[k], pp.sheet.appearance[k]))),
        el('h3', { text: 'Storia del personaggio' }), story,
        el('h3', { text: 'Alleati e organizzazioni' }), el('ul', {}, pp.sheet.allies.map((a) => { const f = a.kind === 'fazione' ? st().factions.find((x) => x.id === a.refId) : a.kind === 'npc' ? (st().worldNpcs || []).find((x) => x.id === a.refId) : null; return el('li', { text: (f ? f.name : '') + (a.text ? ' — ' + a.text : '') }); })),
        el('h3', { text: 'Tratti e privilegi aggiuntivi' }), el('p', { text: pp.sheet.extraFeatures || '—' }),
        el('h3', { text: 'Tesoro' }), el('p', { text: pp.sheet.treasure || '—' }),
        el('h3', { text: 'Note' }), el('p', { text: pp.notes || '—' })),
      el('section', { class: 'sheet-page' },
        el('h1', { text: pp.name + ' — incantesimi' }),
        d.spell ? el('div', { class: 'print-grid' }, row('Caratteristica', d.spell.ability), row('CD del tiro salvezza', d.spell.dc), row('Attacco con incantesimo', fmt(d.spell.attack)),
          row('Slot', d.spell.slotsTotal.map((n, i) => (n ? (i + 1) + '°: ' + n : '')).filter(Boolean).join(' · '))) : el('p', { text: 'Il personaggio non lancia incantesimi.' }),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => { const list = spells.filter((s) => s.level === lv); return list.length ? [el('h3', { text: lv ? 'Livello ' + lv : 'Trucchetti' }), el('ul', {}, list.map((s) => { const f = pp.sheet.spellFlags[s.id] || {}; return el('li', { text: (f.prepared ? '● ' : '○ ') + s.name + (f.ritual ? ' (rituale)' : '') + ((f.concentration === null || f.concentration === undefined ? s.concentration : f.concentration) ? ' (concentrazione)' : '') }); }))] : null; })));
  }
  function printSheet(p) {
    const node = printNode(p);
    document.body.append(node);
    document.body.classList.add('printing-sheet');
    const done = () => { document.body.classList.remove('printing-sheet'); node.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    if (typeof window.print === 'function') window.print();
    setTimeout(done, 1500);
  }

  // ---------- Sali di livello ----------
  // Finestra guidata: PF (media, tiro o a mano), punti caratteristica o talento ai livelli giusti, nuovi incantesimi
  // e privilegi; riepilogo prima di confermare e «Annulla» dopo. onDone(giocatore aggiornato).
  function levelUpDialog(player, onDone) {
    const race = st().races.find((r) => r.id === player.raceId) || null;
    const max = player.type === 'leggendario' ? 40 : 20;
    if (player.level >= max) { toast('Livello massimo.', 'error'); return; }
    const next = player.level + 1;
    const asiLevel = K.ASI_LEVELS.includes(next) || (next > 20 && next % 4 === 0);
    const method = el('select', { 'aria-label': 'Aumento dei PF' }, opt('media', 'Media del dado', true), opt('tira', 'Tira il dado', false), opt('manuale', 'A mano', false));
    const manual = numberInput(1, { min: 1, max: 100, class: 'qty', 'aria-label': 'PF guadagnati' });
    const asiA = el('select', { 'aria-label': 'Primo punto' }, opt('', '—', true), R.ABILITIES.map((ab) => opt(ab, ab, false)));
    const asiB = el('select', { 'aria-label': 'Secondo punto' }, opt('', '—', true), R.ABILITIES.map((ab) => opt(ab, ab, false)));
    const feat = el('select', { 'aria-label': 'Talento al posto dei punti' }, opt('', '— nessun talento —', true), visible('feats').map((f) => opt(f.id, f.name, false)));
    const features = textInput('Privilegio di livello ' + next, { maxlength: 200, 'aria-label': 'Nuovi privilegi (separati da ;)' });
    const caster = S.isCaster(player);
    const spellSel = el('select', { multiple: true, size: 5, 'aria-label': 'Nuovi incantesimi' }, st().spells.filter((s) => !player.spellcasting.known.includes(s.id) && (!s.classes.length || !C.CLASSES[player.classId] || s.classes.includes(player.classId))).map((s) => opt(s.id, s.name + ' (' + (s.level ? s.level + '°' : 'trucchetto') + ')', false)));
    const preview = el('div', { class: 'small', 'aria-live': 'polite' });
    let roll = null;
    const optsOf = () => {
      const asi = {};
      for (const ab of [asiA.value, asiB.value]) if (ab) asi[ab] = (asi[ab] || 0) + 1;
      if (method.value === 'tira' && roll === null) roll = DnD.dadi.randomInt((C.classInfo(player.classId, player.customClass) || {}).hitDie || 8);
      return { hpMethod: method.value, roll, manual: readNumber(manual), asi: asiLevel && !feat.value ? asi : null, featId: asiLevel ? feat.value : '', spells: [...spellSel.selectedOptions].map((x) => x.value), featureNames: features.value.split(';').map((x) => x.trim()).filter(Boolean) };
    };
    const update = () => {
      const r = S.levelUp(player, optsOf(), { race, catalog: st().equipment, feats: visible('feats') });
      const s = r.summary;
      const slotTxt = (a) => a.map((n, i) => (n ? (i + 1) + '°×' + n : '')).filter(Boolean).join(' ') || '—';
      fill(preview, el('ul', {},
        el('li', { text: 'Livello ' + s.from + ' → ' + s.to }),
        el('li', { text: 'PF +' + s.hpGain + (s.rolled !== null && method.value === 'tira' ? ' (tiro ' + s.rolled + ' + COS)' : '') + ' → ' + r.player.maxHp }),
        el('li', { text: 'Bonus di competenza ' + fmt(s.profBefore) + (s.profAfter !== s.profBefore ? ' → ' + fmt(s.profAfter) : ' (uguale)') }),
        el('li', { text: 'Slot: ' + slotTxt(s.slotsBefore) + (JSON.stringify(s.slotsAfter) !== JSON.stringify(s.slotsBefore) ? ' → ' + slotTxt(s.slotsAfter) : ' (uguali)') }),
        el('li', { text: 'Nuovi privilegi: ' + s.newFeatures.join(', ') }),
        s.spells ? el('li', { text: s.spells + ' nuovi incantesimi' }) : null));
      return r;
    };
    const body = el('div', { class: 'form', onchange: update, oninput: update },
      el('label', { class: 'inline' }, 'Punti ferita ', method, manual),
      asiLevel ? el('fieldset', {}, el('legend', { text: 'Livello ' + next + ': 2 punti caratteristica o un talento' }), el('div', { class: 'input-row' }, '+1 a ', asiA, ' +1 a ', asiB, ' oppure ', feat)) : null,
      caster ? el('fieldset', {}, el('legend', { text: 'Nuovi incantesimi (Ctrl per sceglierne più di uno)' }), spellSel) : null,
      el('label', { class: 'inline' }, 'Nuovi privilegi ', features),
      el('h3', { text: 'Riepilogo' }), preview);
    update();
    openDialog('Sali al livello ' + next, body, [{ text: 'Annulla' }, { text: '⬆ Conferma', class: 'primary', onclick: () => {
      const r = update();
      const before = clone(player);
      const saved = DnD.dati.normalizeCreature(r.player, true);
      DnD.store.update((s) => { const i = s.players.findIndex((x) => x.id === player.id); if (i >= 0) s.players[i] = saved; });
      onDone(saved);
      openDialog('Livello ' + saved.level, el('p', { text: '«' + saved.name + '» è salito al livello ' + saved.level + '. Compila i nuovi privilegi nella scheda.' }), [
        { text: '↶ Annulla la salita', onclick: () => { DnD.store.update((s) => { const i = s.players.findIndex((x) => x.id === player.id); if (i >= 0) s.players[i] = before; }); onDone(before); toast('Salita di livello annullata.'); } },
        { text: 'OK', class: 'primary' },
      ]);
    } }]);
  }

  // ---------- Esporta / importa un personaggio ----------
  function exportCharacter(p) {
    const data = S.exportCharacter(p, st());
    DnD.uiImpostazioni.download(JSON.stringify(data, null, 2), DnD.uiImpostazioni.slug(DnD.config.APP_NAME) + '-personaggio-' + DnD.uiImpostazioni.slug(p.name) + '.json');
    toast('«' + p.name + '» esportato.', 'success');
  }
  async function importCharacter(file, onDone) {
    try {
      const raw = JSON.parse(await file.text());
      const r = S.importCharacter(raw, st(), session().id);
      DnD.store.update((s) => {
        s.players.push(r.player);
        s.backgrounds.push(...r.backgrounds);
        s.feats.push(...r.feats);
        const v = DnD.fazioni.view(s);
        const party = DnD.party.active(v.parties, v.world);
        if (party && !DnD.party.partyOf(v.parties, r.player.id)) DnD.party.assignPlayer(v.parties, party.id, r.player.id);
      });
      toast('«' + r.player.name + '» importato.' + (r.warnings.length ? ' ⚠ ' + r.warnings.join(', ') + '.' : ''), r.warnings.length ? 'error' : 'success');
      onDone(r.player);
    } catch (e) {
      toast('Importazione non riuscita: ' + e.message, 'error');
    }
  }

  // ---------- Librerie: Background e Talenti ----------
  // host, kind ('backgrounds' | 'feats'), onChange.
  function libraryView(host, kind, state) {
    const isBg = kind === 'backgrounds';
    const list = visible(kind);
    const editId = state.editing;
    clear(host);
    if (editId) { libraryForm(host, kind, editId === 'new' ? null : list.find((x) => x.id === editId), state); return; }
    host.append(el('div', { class: 'section-head' }, el('h2', { text: isBg ? 'Background' : 'Talenti' }),
      el('div', { class: 'head-actions' }, el('button', { class: 'btn primary', text: isBg ? '+ Nuovo background' : '+ Nuovo talento', onclick: () => { state.editing = 'new'; state.refresh(); } }))),
    el('p', { class: 'muted small', text: isBg ? 'Si scelgono nella scheda del giocatore: competenze ed equipaggiamento si aggiungono con anteprima e conferma, senza duplicati.' : 'Effetti numerici facoltativi applicati ai calcoli della scheda (caratteristiche, competenze, CA, PF, velocità, iniziativa). Si prendono come privilegio, anche al posto dei punti caratteristica.' }),
    list.length ? el('div', { class: 'card-grid' }, list.map((x) => el('article', { class: 'card' },
      el('div', { class: 'card-title' }, el('h3', { text: x.name }), x.shared ? el('span', { class: 'tag accent', text: 'Condiviso' }) : null),
      el('p', { class: 'small', text: isBg ? [x.skills.join(', '), x.tools.join(', '), x.languages.join(', ')].filter(Boolean).join(' · ') || '—' : featText(x) || x.description || '—' }),
      isBg && x.feature.name ? el('p', { class: 'muted small', text: 'Privilegio: ' + x.feature.name }) : null,
      el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: x.shared, onchange: (e) => { DnD.store.update(() => { x.shared = e.target.checked; }); state.refresh(); } }), ' Condividi con tutte le sessioni'),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn', text: 'Modifica', onclick: () => { state.editing = x.id; state.refresh(); } }),
        el('button', { class: 'btn', text: 'Duplica', onclick: () => { DnD.store.update((s) => { s[kind].push(Object.assign(clone(x), { id: DnD.dadi.uid(), name: (x.name + ' (copia)').slice(0, 60), sessionId: session().id, shared: false })); }); state.refresh(); } }),
        el('button', { class: 'btn danger', text: 'Elimina', onclick: () => { if (confirm('Eliminare «' + x.name + '»? Le schede che lo usano mostreranno un avviso.')) { DnD.store.update((s) => { s[kind] = s[kind].filter((y) => y.id !== x.id); }); state.refresh(); } } }))))) : el('p', { class: 'empty', text: 'Libreria vuota.' }));
  }
  function libraryForm(host, kind, existing, state) {
    const isBg = kind === 'backgrounds';
    const x = existing ? clone(existing) : (isBg ? S.normalizeBackground({ sessionId: session().id }) : S.normalizeFeat({ sessionId: session().id }));
    if (!existing) x.name = '';
    const name = textInput(x.name, { maxlength: 60 });
    const lines = (arr0) => arr0.join('\n');
    const read = (ta) => ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const skillChecks = (sel) => Object.keys(DnD.creatureDati.SKILLS).map((k) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: k, checked: sel.includes(k) }), ' ' + k));
    const checked = (nodes) => nodes.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    let fields;
    let collect;
    if (isBg) {
      const skills = skillChecks(x.skills);
      const tools = el('textarea', { rows: 2, value: lines(x.tools) });
      const langs = el('textarea', { rows: 2, value: lines(x.languages) });
      const equip = el('textarea', { rows: 3, value: x.equipment.map((e) => (e.qty > 1 ? e.qty + ' ' : '') + (e.name || (st().equipment.find((y) => y.id === e.equipmentId) || {}).name || '')).join('\n'), placeholder: 'Un oggetto per riga (nome del catalogo), es.\n2 Pugnale' });
      const fName = textInput(x.feature.name, { maxlength: 80 });
      const fDesc = el('textarea', { rows: 2, value: x.feature.desc });
      const desc = el('textarea', { rows: 2, value: x.description });
      const sugg = Object.fromEntries(K.PERSONALITY.map((k) => [k, el('textarea', { rows: 2, value: lines(x.suggestions[k]), placeholder: 'Uno per riga' })]));
      fields = [DnD.ui.field('Descrizione', desc), el('fieldset', {}, el('legend', { text: 'Competenze nelle abilità' }), el('div', { class: 'check-row' }, skills)),
        el('div', { class: 'grid-3' }, DnD.ui.field('Strumenti (uno per riga)', tools), DnD.ui.field('Linguaggi (uno per riga)', langs), DnD.ui.field('Equipaggiamento iniziale', equip)),
        el('div', { class: 'grid-2' }, DnD.ui.field('Privilegio', fName), DnD.ui.field('Descrizione del privilegio', fDesc)),
        el('fieldset', {}, el('legend', { text: 'Suggerimenti per la personalità' }), el('div', { class: 'grid-2' }, K.PERSONALITY.map((k) => DnD.ui.field(K.PERSONALITY_NAMES[k], sugg[k]))))];
      collect = () => Object.assign(x, {
        description: desc.value, skills: checked(skills), tools: read(tools), languages: read(langs),
        equipment: read(equip).map((ln) => { const mm = /^(\d+)\s+(.+)$/.exec(ln); return { name: mm ? mm[2] : ln, qty: mm ? Number(mm[1]) : 1 }; }),
        feature: { name: fName.value.trim(), desc: fDesc.value }, suggestions: Object.fromEntries(K.PERSONALITY.map((k) => [k, read(sugg[k])])),
      });
    } else {
      const req = textInput(x.requirements, { maxlength: 200 });
      const desc = el('textarea', { rows: 2, value: x.description });
      const abil = Object.fromEntries(R.ABILITIES.map((ab) => [ab, numberInput(x.effects.abilities[ab] || 0, { min: -5, max: 5, class: 'qty', 'aria-label': ab })]));
      const skills = skillChecks(x.effects.skills);
      const saves = R.ABILITIES.map((ab) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: ab, checked: x.effects.saves.includes(ab) }), ' ' + ab));
      const nums = Object.fromEntries([['ac', 'CA'], ['hp', 'PF fissi'], ['hpPerLevel', 'PF per livello'], ['speed', 'Velocità (m)'], ['initiative', 'Iniziativa']].map(([k, l]) => [k, [l, numberInput(x.effects[k] || 0, { class: 'qty', step: k === 'speed' ? 1.5 : 1, 'aria-label': l })]]));
      fields = [DnD.ui.field('Requisiti', req), DnD.ui.field('Descrizione', desc),
        el('fieldset', {}, el('legend', { text: 'Bonus alle caratteristiche' }), el('div', { class: 'input-row' }, R.ABILITIES.map((ab) => el('label', { class: 'inline small' }, ab + ' ', abil[ab])))),
        el('fieldset', {}, el('legend', { text: 'Competenze nelle abilità' }), el('div', { class: 'check-row' }, skills)),
        el('fieldset', {}, el('legend', { text: 'Competenze nei tiri salvezza' }), el('div', { class: 'check-row' }, saves)),
        el('fieldset', {}, el('legend', { text: 'Altri bonus' }), el('div', { class: 'input-row' }, Object.values(nums).map(([l, n]) => el('label', { class: 'inline small' }, l + ' ', n))))];
      collect = () => Object.assign(x, {
        requirements: req.value, description: desc.value,
        effects: { abilities: Object.fromEntries(R.ABILITIES.map((ab) => [ab, readNumber(abil[ab]) || 0])), skills: checked(skills), saves: checked(saves),
          ac: readNumber(nums.ac[1]) || 0, hp: readNumber(nums.hp[1]) || 0, hpPerLevel: readNumber(nums.hpPerLevel[1]) || 0, speed: readNumber(nums.speed[1]) || 0, initiative: readNumber(nums.initiative[1]) || 0 },
      });
    }
    const done = () => { state.editing = null; state.refresh(); };
    host.append(el('div', { class: 'section-head' }, el('h2', { text: (existing ? 'Modifica ' : 'Nuovo ') + (isBg ? 'background' : 'talento') })),
      el('form', { class: 'panel form', novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        collect();
        x.name = name.value.trim() || (isBg ? 'Background' : 'Talento');
        const saved = isBg ? S.normalizeBackground(x) : S.normalizeFeat(x);
        DnD.store.update((s) => { const i = s[kind].findIndex((y) => y.id === saved.id); if (i >= 0) s[kind][i] = saved; else s[kind].push(saved); });
        toast('Salvato.', 'success');
        done();
      } }, DnD.ui.field('Nome', name), fields,
      el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: done }), el('button', { type: 'submit', class: 'btn primary', text: 'Salva' }))));
    name.focus();
  }

  DnD.uiScheda = { editor, calc, draftOf, gameSheet, printNode, printSheet, levelUpDialog, applyBackgroundDialog, exportCharacter, importCharacter, libraryView };
})(globalThis.DnD = globalThis.DnD || {});
