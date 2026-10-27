// Asset › Oggetti › Oggetti di mappa (forzieri, porte, leve, trappole, barili, altari...): elenco e form dei
// modelli, e pannello di interazione sulla griglia (doppio clic su un oggetto piazzato): Apri/Chiudi,
// Scassina, Sfonda, Cerca/Disinnesca/Attiva trappola, contenuto con "Prendi" e "Prendi tutto" verso
// l'inventario di un giocatore. Ogni copia piazzata ha stato e contenuto propri.
(function (DnD) {
  'use strict';

  const { el, clear, field, numberInput, textInput, readNumber, showErrors, toast, openDialog } = DnD.ui;
  const OM = DnD.oggettiMappa;
  const A = DnD.attrezzatura;
  const R = DnD.regole;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let editing = null;
  let root = null;

  const equipmentName = (id) => { const e = DnD.store.state.equipment.find((x) => x.id === id); return e ? e.name : 'Oggetto eliminato'; };

  function render(container) {
    root = container || root;
    clear(root);
    if (editing) renderForm();
    else renderList();
  }

  function flagsText(o) {
    return [OM.TYPE_NAMES[o.otype], o.container ? 'contenitore' : '', o.hidden ? 'nascosto' : '', o.otype === 'porta' ? 'blocca se chiusa' : o.blocks ? 'blocca il movimento' : '',
      o.blocksSight && o.otype !== 'porta' ? 'blocca la vista' : '', o.light ? 'fa luce (' + o.light.bright + ' + ' + o.light.dim + ' ft)' : '',
      o.lock.locked ? 'chiuso a chiave (CD ' + o.lock.dcPick + ')' : '', o.trap.enabled ? 'trappola (CD ' + o.trap.dcFind + '/' + o.trap.dcDisarm + ')' : ''].filter(Boolean).join(' · ');
  }

  function renderList() {
    const list = DnD.store.state.mapObjects;
    root.append(
      el('div', { class: 'section-head' },
        el('h2', { text: 'Oggetti di mappa' }),
        el('button', { class: 'btn primary', text: '+ Nuovo oggetto di mappa', onclick: () => { editing = 'new'; render(); } })),
      el('p', { class: 'muted small', text: 'Sono modelli: ogni copia piazzata sulla griglia ha il proprio stato e il proprio contenuto. Doppio clic su una copia nella griglia per interagire.' }),
      list.length
        ? el('div', { class: 'card-grid' }, list.map((o) => el('article', { class: 'card' },
          el('div', { class: 'card-title' }, el('div', { class: 'title-with-icon' }, DnD.uiTileset.templatePreview(o, 'item', 32), el('h3', { text: o.name }))),
          el('p', { class: 'muted small', text: flagsText(o) }),
          o.contents.length || !OM.isEmpty(o) ? el('p', { class: 'small', text: 'Contenuto: ' + o.contents.map((c) => c.qty + '× ' + equipmentName(c.equipmentId)).concat(A.CURRENCIES.some((k) => o.coins[k]) ? [A.formatCoins(o.coins)] : []).join(', ') }) : null,
          el('div', { class: 'card-actions' },
            el('button', { class: 'btn', text: 'Modifica', onclick: () => { editing = o.id; render(); } }),
            el('button', { class: 'btn', text: 'Duplica', onclick: () => {
              const copy = Object.assign(clone(o), { id: DnD.dadi.uid(), name: (o.name + ' (copia)').slice(0, 60) });
              DnD.store.update((st) => { st.mapObjects.splice(st.mapObjects.indexOf(o) + 1, 0, copy); });
              render();
            } }),
            el('button', { class: 'btn danger', text: 'Elimina', onclick: () => {
              if (!confirm('Eliminare il modello «' + o.name + '»?\nLe copie già piazzate sulle griglie restano.')) return;
              DnD.store.update((st) => { st.mapObjects = st.mapObjects.filter((x) => x.id !== o.id); });
              render();
            } })))))
        : el('p', { class: 'empty', text: 'Nessun oggetto di mappa. Creane uno con «Nuovo oggetto di mappa».' }));
  }

  // Elenco di oggetti del catalogo con quantità (contenuto di un contenitore).
  function contentsEditor(initial) {
    const rows = el('div', { class: 'content-rows' });
    const options = () => DnD.store.state.equipment.map((e) => el('option', { value: e.id, text: e.name + ' (' + A.CATEGORY_NAMES[e.category] + ')' }));
    const addRow = (c) => {
      const sel = el('select', { 'aria-label': 'Oggetto' }, options());
      sel.value = c.equipmentId;
      const qty = numberInput(c.qty, { min: 1, max: 100000, 'aria-label': 'Quantità', class: 'qty' });
      rows.append(el('div', { class: 'input-row content-row' }, qty, sel,
        el('button', { type: 'button', class: 'icon-btn danger', text: '✕', 'aria-label': 'Togli', onclick: (e) => e.target.closest('.content-row').remove() })));
    };
    initial.forEach(addRow);
    const node = el('div', {}, rows,
      el('button', { type: 'button', class: 'btn small', text: '+ Aggiungi oggetto', onclick: () => {
        if (!DnD.store.state.equipment.length) { toast('Il catalogo dell\'Attrezzatura è vuoto.', 'error'); return; }
        addRow({ equipmentId: DnD.store.state.equipment[0].id, qty: 1 });
      } }));
    return {
      node,
      read: () => [...rows.querySelectorAll('.content-row')].map((r) => ({ equipmentId: r.querySelector('select').value, qty: readNumber(r.querySelector('input')) }))
        .filter((c) => c.equipmentId && Number.isInteger(c.qty) && c.qty > 0),
    };
  }

  function coinsEditor(coins, label) {
    const inputs = {};
    const node = el('div', { class: 'coins-row' }, el('span', { class: 'field-label', text: label || 'Monete' }), A.CURRENCIES.map((k) => {
      inputs[k] = numberInput(coins[k] || 0, { min: 0, 'aria-label': A.CURRENCY_NAMES[k], class: 'qty' });
      return el('label', { class: 'inline small' }, inputs[k], k);
    }));
    return { node, read: () => Object.fromEntries(A.CURRENCIES.map((k) => [k, Math.max(0, Math.round(readNumber(inputs[k]) || 0))])) };
  }

  function renderForm() {
    const existing = DnD.store.state.mapObjects.find((x) => x.id === editing);
    const o = existing || DnD.dati.normalizeMapObject({ name: '', otype: 'forziere', icon: { kind: 'library', icon: 'forziere', color: '#b07a3c' } });
    if (!existing) o.name = '';
    let mode = o.mode;
    let cut = o.tiles && o.tiles.kind === 'immagine' ? { tilesetId: o.tiles.tilesets[0], srcId: o.tiles.source, selection: o.tiles.sel } : null;
    const inp = {
      name: textInput(o.name, { maxlength: 60 }),
      otype: el('select', {}, OM.TYPES.filter((t) => t !== 'npc').map((t) => el('option', { value: t, text: OM.TYPE_NAMES[t], selected: t === o.otype }))),
      description: el('textarea', { rows: 2, value: o.description }),
      container: el('input', { type: 'checkbox', checked: o.container }),
      interactive: el('input', { type: 'checkbox', checked: o.interactive }),
      hidden: el('input', { type: 'checkbox', checked: o.hidden }),
      blocks: el('input', { type: 'checkbox', checked: o.blocks }),
      blocksSight: el('input', { type: 'checkbox', checked: o.blocksSight }),
      state: el('select', {}, el('option', { value: 'chiuso', text: 'Chiuso', selected: o.state === 'chiuso' }), el('option', { value: 'aperto', text: 'Aperto', selected: o.state === 'aperto' })),
      locked: el('input', { type: 'checkbox', checked: o.lock.locked }),
      dcPick: numberInput(o.lock.dcPick, { min: 1, max: 40 }),
      dcForce: numberInput(o.lock.dcForce, { min: 1, max: 40 }),
      keyId: el('select', {}, el('option', { value: '', text: '— nessuna chiave —' }), DnD.store.state.equipment.map((e) => el('option', { value: e.id, text: e.name, selected: e.id === o.lock.keyId }))),
      trap: el('input', { type: 'checkbox', checked: o.trap.enabled }),
      dcFind: numberInput(o.trap.dcFind, { min: 1, max: 40 }),
      dcDisarm: numberInput(o.trap.dcDisarm, { min: 1, max: 40 }),
      effKind: el('select', {}, el('option', { value: 'danno', text: 'Danno diretto', selected: o.trap.effect.kind === 'danno' }), el('option', { value: 'salvezza', text: 'Tiro salvezza', selected: o.trap.effect.kind === 'salvezza' })),
      dice: textInput(o.trap.effect.dice, { placeholder: '2d10' }),
      dmgType: el('select', {}, DnD.creatureDati.DAMAGE_TYPES.map((t) => el('option', { value: t, text: t, selected: t === o.trap.effect.type }))),
      ability: el('select', {}, R.ABILITIES.map((ab) => el('option', { value: ab, text: R.ABILITY_NAMES[ab], selected: ab === o.trap.effect.ability }))),
      dc: numberInput(o.trap.effect.dc, { min: 1, max: 40 }),
      half: el('input', { type: 'checkbox', checked: o.trap.effect.half }),
      reusable: el('input', { type: 'checkbox', checked: o.trap.reusable }),
    };
    const icon = DnD.uiIcone.iconPicker(o.icon, true, 'Icona sulla griglia');
    // Luce e visione: luce emessa (braciere, lanterna) e blocco della vista (le porte solo da chiuse).
    const light = DnD.uiVisione.emitterEditor(o.light);
    const tilesBox = el('div', { class: 'image-box' });
    const cutter = DnD.uiTile.cutter({ mode: 'struttura', tilesetId: cut && cut.tilesetId, srcId: cut && cut.srcId, selection: cut && cut.selection, container: tilesBox, onChange: (st) => { cut = st; }, height: 260 });
    tilesBox.append(cutter.node, el('small', { class: 'hint', text: 'Ogni tile incluso occupa una cella della griglia (l\'oggetto blocca solo con «Blocca il movimento», le porte quando sono chiuse).' }));
    const contents = contentsEditor(o.contents);
    const coins = coinsEditor(o.coins);
    const lockBox = el('fieldset', {}, el('legend', { text: 'Serratura' }),
      el('label', { class: 'check' }, inp.locked, ' Chiuso a chiave'),
      el('div', { class: 'grid-3 tight' }, field('CD per scassinare', inp.dcPick, 'lock.dcPick'), field('CD (Forza) per sfondare', inp.dcForce, 'lock.dcForce'), field('Chiave richiesta', inp.keyId)));
    const trapFields = el('div', {},
      el('div', { class: 'grid-3 tight' }, field('CD per individuarla', inp.dcFind, 'trap.dcFind'), field('CD per disinnescarla', inp.dcDisarm, 'trap.dcDisarm'), field('Effetto', inp.effKind)),
      el('div', { class: 'grid-3 tight' }, field('Dado di danno', inp.dice, 'trap.dice'), field('Tipo di danno', inp.dmgType), field('Salvezza su', inp.ability)),
      el('div', { class: 'grid-3 tight' }, field('CD del tiro salvezza', inp.dc, 'trap.dc'),
        el('label', { class: 'check' }, inp.half, ' Metà danni se riesce'), el('label', { class: 'check' }, inp.reusable, ' Si riattiva (più volte)')));
    const trapBox = el('fieldset', {}, el('legend', { text: 'Trappola' }), el('label', { class: 'check' }, inp.trap, ' È (o contiene) una trappola'), trapFields);
    const contentsBox = el('fieldset', {}, el('legend', { text: 'Contenuto' }), contents.node, coins.node);
    const sync = () => {
      icon.node.hidden = mode !== 'icon';
      tilesBox.hidden = mode !== 'tiles';
      trapFields.hidden = !inp.trap.checked && inp.otype.value !== 'trappola';
      contentsBox.hidden = !inp.container.checked;
    };
    const modeRadio = (value, label) => el('label', { class: 'check' },
      el('input', { type: 'radio', name: 'mo-mode', value, checked: mode === value, onchange: () => { mode = value; sync(); } }), ' ' + label);
    for (const x of [inp.trap, inp.otype, inp.container]) x.addEventListener('change', sync);

    const form = el('form', { class: 'panel form', novalidate: true },
      el('div', { class: 'grid-3' }, field('Nome', inp.name, 'name'), field('Tipo', inp.otype), field('Stato iniziale', inp.state)),
      field('Descrizione', inp.description),
      el('div', { class: 'check-row' },
        el('label', { class: 'check' }, inp.container, ' Contenitore'), el('label', { class: 'check' }, inp.interactive, ' Interagibile'),
        el('label', { class: 'check' }, inp.hidden, ' Nascosto (solo master)'), el('label', { class: 'check' }, inp.blocks, ' Blocca il movimento'),
        el('label', { class: 'check', title: 'Le porte bloccano la vista solo da chiuse' }, inp.blocksSight, ' Blocca la vista')),
      light.node,
      el('fieldset', {}, el('legend', { text: 'Aspetto sulla griglia' }),
        el('div', { class: 'radio-row' }, modeRadio('icon', 'Icona (1×1)'), modeRadio('tiles', 'Tile da immagine')),
        icon.node, tilesBox, el('div', { class: 'error', 'data-error': 'tiles' })),
      lockBox, trapBox, contentsBox,
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: 'Annulla', onclick: () => { editing = null; render(); } }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Salva oggetto di mappa' })));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const iconResult = icon.read();
      let tiles = null;
      if (mode === 'tiles' && cut && cut.tilesetId) {
        const st = DnD.store.state;
        const ts = st.tilesets.find((t) => t.id === cut.tilesetId);
        const byId = DnD.tilemap.tilesetIndex(st.tilesets);
        if (ts && cut.selection.includes('1')) tiles = DnD.collisioni.withFootprint(Object.assign(DnD.tilemap.imageTiles(ts, cut.srcId, cut.selection, {}), { sel: cut.selection }), byId, 'item');
      }
      const data = {
        id: o.id, name: inp.name.value.trim(), otype: inp.otype.value, description: inp.description.value.trim(),
        icon: iconResult.icon || o.icon, mode, tiles,
        container: inp.container.checked, interactive: inp.interactive.checked, hidden: inp.hidden.checked, blocks: inp.blocks.checked, state: inp.state.value,
        blocksSight: inp.blocksSight.checked, light: light.read(),
        lock: { locked: inp.locked.checked, dcPick: readNumber(inp.dcPick), dcForce: readNumber(inp.dcForce), keyId: inp.keyId.value },
        trap: {
          enabled: inp.trap.checked || inp.otype.value === 'trappola', dcFind: readNumber(inp.dcFind), dcDisarm: readNumber(inp.dcDisarm),
          effect: { kind: inp.effKind.value, dice: inp.dice.value.trim(), type: inp.dmgType.value, ability: inp.ability.value, dc: readNumber(inp.dc), half: inp.half.checked },
          reusable: inp.reusable.checked, armed: true, found: false,
        },
        contents: contents.read(), coins: coins.read(),
      };
      const errors = DnD.validazione.validateMapObject(data);
      if (iconResult.error && mode === 'icon') errors.icon = iconResult.error;
      if (mode === 'tiles' && !tiles) errors.tiles = 'Importa un\'immagine e includi almeno un tile (oppure usa l\'icona).';
      if (!showErrors(form, errors)) return;
      const saved = DnD.dati.normalizeMapObject(data);
      DnD.store.update((st) => {
        const i = st.mapObjects.findIndex((x) => x.id === saved.id);
        if (i >= 0) st.mapObjects[i] = saved;
        else st.mapObjects.push(saved);
      });
      toast('Oggetto di mappa salvato.', 'success');
      editing = null;
      render();
    });

    root.append(el('div', { class: 'section-head' }, el('h2', { text: existing ? 'Modifica oggetto di mappa' : 'Nuovo oggetto di mappa' })), form);
    sync();
    inp.name.focus();
  }

  // ---------- Pannello di interazione (doppio clic sulla griglia) ----------
  // ctx: { getItem() -> oggetto piazzato, update(fn(item, state)), log(text), combatants() -> [combattente] (facoltativo),
  //        applyDamage(targetId, amount, type, text) (facoltativo, nel combattimento) }
  function openPanel(ctx) {
    // Copie degli NPC del Mondo: pannello NPC (Parla, Commercia, Quest, Attacca, Scheda, Fazione).
    const first = ctx.getItem();
    if (first && first.otype === 'npc') return DnD.uiNpc.openPanel(ctx);
    const body = el('div', { class: 'object-panel' });
    let dialog = null;
    const st = () => DnD.store.state;
    const players = () => DnD.sessioni.visible(st(), 'players');
    // Chi agisce: giocatori della sessione (con le loro caratteristiche) e, nel combattimento, i combattenti.
    const actors = () => {
      const list = players().map((p) => ({ id: 'p:' + p.id, name: p.name, abilities: DnD.combattenti.derivedStats(p, st().races.find((r) => r.id === p.raceId)).abilities, player: p }));
      for (const c of ctx.combatants ? ctx.combatants() : []) if (c.kind !== 'player') list.push({ id: 'c:' + c.id, name: c.name, abilities: null, dexMod: c.dexMod, combatant: c });
      return list;
    };
    const who = el('select', { 'aria-label': 'Chi agisce' });
    const bonus = numberInput(0, { 'aria-label': 'Bonus alla prova', class: 'qty' });
    const target = el('select', { 'aria-label': 'Giocatore che prende gli oggetti' });
    let ability = 'DES';
    const actor = () => actors().find((a) => a.id === who.value) || null;
    function fillBonus(ab) {
      ability = ab;
      const a = actor();
      if (!a) return;
      bonus.value = String(a.abilities ? R.modifier(a.abilities[ab]) : ab === 'DES' ? a.dexMod : 0);
    }
    who.addEventListener('change', () => fillBonus(ability));

    function act(fn) {
      let text = '';
      ctx.update((it, state) => { text = fn(it, state); });
      if (text) ctx.log(text);
      draw();
    }
    const rollBonus = () => (Number.isFinite(readNumber(bonus)) ? readNumber(bonus) : 0);
    const name = () => (actor() ? actor().name : 'Qualcuno');
    const hasKey = (it) => {
      const a = actor();
      return Boolean(it.lock.keyId && a && a.player && a.player.inventory.some((x) => x.equipmentId === it.lock.keyId && x.qty > 0));
    };

    function draw() {
      const it = ctx.getItem();
      if (!it) { if (dialog) dialog.dismiss(); return; }
      const keep = { who: who.value, target: target.value };
      clear(who).append(...actors().map((a) => el('option', { value: a.id, text: a.name })));
      if (keep.who) who.value = keep.who;
      clear(target).append(...players().map((p) => el('option', { value: p.id, text: p.name })));
      if (keep.target) target.value = keep.target;
      const b = (text, onclick, disabled, cls) => el('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), text, onclick, disabled });
      const check = (label, ab, fn) => b(label, () => { fillBonus(ab); act((x) => fn(x, rollBonus(), DnD.dadi.randomInt, name()).text); });
      const coinsLeft = A.CURRENCIES.some((k) => it.coins[k]);
      clear(body).append(
        el('p', { class: 'muted small', text: [OM.TYPE_NAMES[it.otype], it.state === 'aperto' ? 'aperto' : 'chiuso', it.lock.locked ? 'chiuso a chiave' : '',
          it.hidden ? 'nascosto ai giocatori' : '', it.trap.enabled ? (it.trap.armed ? 'trappola attiva' + (it.trap.found ? ' (individuata)' : '') : 'trappola disinnescata') : ''].filter(Boolean).join(' · ') }),
        it.description ? el('p', { class: 'small', text: it.description }) : '',
        el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Chi agisce' }), who, el('label', { class: 'inline small' }, 'bonus', bonus)),
        el('div', { class: 'head-actions' },
          b(it.state === 'aperto' ? 'Chiudi' : 'Apri', () => act((x) => OM.toggleOpen(x, hasKey(x)).text), !it.interactive),
          it.lock.locked ? check('Scassina (DES)', 'DES', OM.pickLock) : null,
          it.lock.locked || it.state !== 'aperto' ? check('Sfonda (FOR)', 'FOR', OM.forceOpen) : null,
          b(it.hidden ? 'Rivela ai giocatori' : 'Nascondi', () => act((x) => { x.hidden = !x.hidden; return x.name + (x.hidden ? ' è nascosto.' : ' è visibile.'); })),
          // Luce emessa dall'oggetto (braciere, lanterna): accendi e spegni.
          it.light ? b(it.light.on ? '🌑 Spegni' : '🔥 Accendi', () => act((x) => { x.light.on = !x.light.on; return x.name + (x.light.on ? ' viene acceso.' : ' viene spento.'); })) : null),
        it.trap.enabled ? el('div', { class: 'head-actions' },
          check('Cerca trappole (SAG)', 'SAG', OM.findTrap),
          it.trap.armed ? check('Disinnesca (DES)', 'DES', OM.disarmTrap) : null,
          it.trap.armed ? b('Attiva la trappola', () => triggerTrap(), false, 'danger') : b('Riarma', () => act((x) => { x.trap.armed = true; return 'La trappola di ' + x.name + ' è di nuovo attiva.'; }))) : '',
        it.container ? el('div', { class: 'object-contents' },
          el('h3', { text: 'Contenuto' }),
          it.state !== 'aperto' && it.otype !== 'a-terra' ? el('p', { class: 'muted small', text: 'Aprilo per prendere il contenuto.' }) : null,
          it.contents.length || coinsLeft ? el('ul', { class: 'pick-list' },
            it.contents.map((c, i) => el('li', {}, el('b', { text: c.qty + '× ' }), equipmentName(c.equipmentId), ' ',
              b('Prendi', () => take(i), it.state !== 'aperto' && it.otype !== 'a-terra'))),
            coinsLeft ? el('li', { text: '💰 ' + A.formatCoins(it.coins) }) : null) : el('p', { class: 'muted small', text: 'Vuoto.' }),
          players().length ? el('div', { class: 'input-row' }, el('span', { class: 'field-label', text: 'Nell\'inventario di' }), target,
            b('Prendi tutto', () => takeAll(), (it.state !== 'aperto' && it.otype !== 'a-terra') || OM.isEmpty(it), 'primary'))
            : el('p', { class: 'muted small', text: 'Crea un giocatore per prendere gli oggetti.' })) : '');
    }

    function playerOf(state) { return state.players.find((p) => p.id === target.value) || null; }
    function take(i) {
      act((x, state) => {
        const p = playerOf(state);
        if (!p) return '';
        const c = x.contents[i];
        const n = OM.take(x, i, c.qty, p.inventory);
        return p.name + ' prende ' + n + '× ' + equipmentName(c.equipmentId) + ' da ' + x.name + '.';
      });
    }
    function takeAll() {
      act((x, state) => {
        const p = playerOf(state);
        if (!p) return '';
        const r = OM.takeAll(x, p.inventory, p.coins);
        const parts = r.items.map((c) => c.qty + '× ' + equipmentName(c.equipmentId));
        if (A.CURRENCIES.some((k) => r.coins[k])) parts.push(A.formatCoins(r.coins));
        return p.name + ' prende tutto da ' + x.name + ': ' + (parts.join(', ') || 'niente') + '.';
      });
    }
    function triggerTrap() {
      const list = ctx.combatants ? ctx.combatants() : [];
      const options = list.length ? list.map((c) => ({ id: c.id, name: c.name, saves: c.saves })) : players().map((p) => ({ id: p.id, name: p.name, saves: DnD.combattenti.derivedStats(p, st().races.find((r) => r.id === p.raceId)).saveTotals }));
      if (!options.length) { act((x) => OM.triggerTrap(x, { name: 'nessuno', saves: {} }, DnD.dadi.randomInt).text); return; }
      const sel = el('select', {}, options.map((o) => el('option', { value: o.id, text: o.name })));
      openDialog('Su chi scatta la trappola?', el('div', { class: 'form' }, field('Bersaglio', sel)), [
        { text: 'Annulla' },
        { text: 'Attiva', class: 'primary danger', onclick: () => {
          const t = options.find((o) => o.id === sel.value);
          let res = null;
          ctx.update((x) => { res = OM.triggerTrap(x, t, DnD.dadi.randomInt); });
          if (ctx.applyDamage && list.length) ctx.applyDamage(t.id, res.amount, res.type, res.text);
          else ctx.log(res.text);
          draw();
        } },
      ]);
    }

    draw();
    const it = ctx.getItem();
    dialog = openDialog('🗝 ' + (it ? it.name : 'Oggetto'), body, [{ text: 'Chiudi' }]);
  }

  // Scheda della sezione Asset › Oggetti (vedi ui-asset.js).
  DnD.schede = DnD.schede || {};
  DnD.schede.oggettiMappa = { title: 'Oggetti di mappa', render, reset: () => { editing = null; } };
  DnD.uiOggettiMappa = { openPanel, contentsEditor, coinsEditor };
})(globalThis.DnD = globalThis.DnD || {});
