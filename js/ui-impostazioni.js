// Impostazioni: pulsante ingranaggio con pannello a comparsa e pulsante rapido sole/luna.
// Il pannello gestisce tema, dimensione del testo, animazioni ridotte, regole del movimento, dadi animati, suoni
// (ui-suoni.js) ed esportazione/importazione.
(function (DnD) {
  'use strict';

  const { el, clear, toast, svgIcon } = DnD.ui;
  const I = DnD.impostazioni;
  const ICONS = DnD.config.ICONS;

  const slug = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dati';
  const today = () => new Date().toISOString().slice(0, 10);

  // Scarica un file (JSON di base; anche note .html e .txt e singole creature).
  function download(text, filename, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Le immagini importate stanno fuori dallo stato: si aggiungono al file quelle effettivamente usate.
  const imagesOf = (part) => DnD.immagini.getMany(DnD.immaginiLib.referencedIds(part));

  // L'archivio porta anche le impostazioni dei suoni e i file che sostituiscono i suoni predefiniti.
  async function exportArchive() {
    const images = await imagesOf(DnD.store.state);
    download(DnD.dati.exportJSON(DnD.store.state, images, { suoni: await DnD.audio.esporta() }), slug(DnD.config.APP_NAME) + '-archivio-' + today() + '.json');
    toast('Archivio esportato.', 'success');
  }

  async function exportSession() {
    const session = DnD.sessioni.current(DnD.store.state);
    const data = DnD.sessioni.exportSession(DnD.store.state, session.id, {});
    data.images = await imagesOf(data);
    download(JSON.stringify(data, null, 2), slug(DnD.config.APP_NAME) + '-sessione-' + slug(session.name) + '-' + today() + '.json');
    toast('Sessione «' + session.name + '» esportata.', 'success');
  }

  // Importa un archivio completo (sostituisce tutto) oppure una singola sessione (si aggiunge).
  // Salva le immagini del file importato (solo quelle valide, il cui id corrisponde al contenuto).
  async function storeImages(raw) {
    const images = DnD.immaginiLib.validImages(raw);
    for (const data of Object.values(images)) await DnD.immagini.put(data);
    return Object.keys(images).length;
  }

  async function importFile(file) {
    let text;
    let raw;
    try {
      text = await file.text();
      raw = JSON.parse(text);
    } catch (e) {
      toast('Importazione fallita: il file non è un JSON valido.', 'error');
      return;
    }
    try {
      if (DnD.sessioni.isSessionFile(raw)) {
        const name = raw.session && typeof raw.session.name === 'string' ? raw.session.name : 'senza nome';
        if (!confirm('Importare la sessione «' + name + '»?\nVerrà aggiunta alle sessioni esistenti, che restano invariate.')) return;
        if (!DnD.app.canLeaveSection()) return;
        let imported = null;
        const stored = await storeImages(raw.images);
        DnD.store.update((st) => { imported = DnD.sessioni.importSession(st, raw, DnD.dadi.uid); });
        toast('Sessione «' + imported.name + '» importata' + (stored ? ' con ' + stored + (stored === 1 ? ' immagine' : ' immagini') : '') + '.', 'success');
      } else {
        const state = DnD.dati.importJSON(text);
        const summary = state.sessions.length + ' sessioni, ' + state.npcs.length + ' nemici, ' + state.players.length + ' giocatori, ' +
          state.savedGrids.length + ' griglie, ' + state.races.length + ' razze, ' + state.spells.length + ' incantesimi, ' +
          state.structures.length + ' strutture, ' + state.equipment.length + ' oggetti di attrezzatura, ' + state.mapObjects.length + ' oggetti di mappa, ' +
          state.tilesets.length + ' TileSet';
        if (!confirm('Importare l\'archivio (' + summary + ')?\nTutti i dati attuali verranno sostituiti. Conviene esportarli prima.')) return;
        const stored = await storeImages(raw.images);
        const res = await DnD.store.replace(state);
        if (!res.ok) throw new Error('archivio non salvato: ' + res.message);
        if (raw.suoni) await DnD.audio.importa(raw.suoni);
        toast('Archivio importato' + (stored ? ' con ' + stored + (stored === 1 ? ' immagine' : ' immagini') : '') + '.', 'success');
      }
      DnD.app.refreshAll();
      if (await DnD.uiTileset.resolveLegacyTilesets()) DnD.app.refreshAll();
    } catch (e) {
      toast('Importazione fallita: ' + e.message, 'error');
    }
  }

  // Svuota anche IndexedDB: stato, TileSet e immagini importate.
  async function clearAll() {
    if (!confirm('Cancellare TUTTI i dati (sessioni, personaggi e creature, griglie e sfondi, librerie, attrezzatura, oggetti di mappa, TileSet e immagini)?\nConviene esportare prima l\'archivio.')) return;
    if (!confirm('Ultima conferma: l\'operazione non si può annullare. Cancellare tutto?')) return;
    try {
      const res = await DnD.store.clearAll();
      DnD.immagini.reset();
      DnD.audio.svuota();
      DnD.app.refreshAll();
      if (res.ok) toast('Tutti i dati sono stati cancellati.', 'success');
      else toast('Dati cancellati, ma il nuovo archivio vuoto non è stato salvato: ' + res.message, 'error');
    } catch (e) {
      toast('Cancellazione non riuscita: ' + e.message, 'error');
    }
  }

  function mount(footer) {
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (f) importFile(f);
    } });
    const radios = (name, legend, options, key) => el('fieldset', { class: 'settings-group' },
      el('legend', { text: legend }),
      el('div', { class: 'radio-row' }, options.map(([value, label]) => el('label', { class: 'check' },
        el('input', { type: 'radio', name, value, onchange: () => { I.set({ [key]: value }); sync(); } }), ' ' + label))));
    const reduce = el('input', { type: 'checkbox', onchange: () => { I.set({ reduceMotion: reduce.checked }); } });
    const bossFx = el('input', { type: 'checkbox', onchange: () => { I.set({ bossEffects: bossFx.checked }); } });
    // Movimento e dadi animati: gruppi a scomparsa.
    const check = (key, label, title) => {
      const input = el('input', { type: 'checkbox', 'data-setting': key, onchange: () => { I.set({ [key]: input.checked }); sync(); } });
      return el('label', { class: 'check small', title: title || null }, input, ' ' + label);
    };
    const select = (key, label, options) => el('label', { class: 'inline small' }, label + ' ',
      el('select', { 'data-setting': key, onchange: (e) => { I.set({ [key]: e.target.value }); sync(); } }, options.map(([v, t]) => el('option', { value: v, text: t }))));
    const movementGroup = el('details', { class: 'settings-group' }, el('summary', { text: 'Movimento' }),
      radios('diagonali', 'Diagonali (come il misuratore)', I.DIAGONALS.map((k) => [k, DnD.movimento.DIAGONAL_NAMES[k]]), 'diagonals'),
      radios('senza-velocita', 'Modalità senza velocità (scalare, nuotare…)', I.MISSING_MODES.map((k) => [k, DnD.movimento.MISSING_NAMES[k]]), 'missingMode'));
    const combatGroup = el('details', { class: 'settings-group' }, el('summary', { text: 'Combattimento' }),
      check('deathSaves', 'Tiri contro la morte per i giocatori a 0 PF', 'A 0 PF il giocatore è privo di sensi e tira all\'inizio dei suoi turni'),
      check('enemiesDie', 'I nemici a 0 PF muoiono', 'Spento: restano a terra come prima'));
    const restGroup = el('details', { class: 'settings-group' }, el('summary', { text: 'Riposi' }),
      check('restHeroic', 'Riposo lungo eroico (tutti i dadi vita)'),
      check('restShort8', 'Riposo breve di 8 ore (gritty)'),
      check('restLong7', 'Riposo lungo di 7 giorni (gritty)'));
    const diceGroup = el('details', { class: 'settings-group' }, el('summary', { text: 'Dadi animati' }),
      check('diceAnim', 'Dadi animati'),
      el('div', { class: 'radio-row' }, check('diceMenu', 'Menù Dadi'), check('diceCombat', 'Combattimento'), check('diceExploration', 'Esplorazione')),
      select('diceSpeed', 'Velocità', [['lenta', 'Lenta'], ['normale', 'Normale'], ['veloce', 'Veloce'], ['istantanea', 'Istantanea']]),
      select('diceColor', 'Colore', DnD.colori.PALETTE.map((p) => [p.key, p.name])),
      el('button', { type: 'button', class: 'btn small', text: '🎲 Prova', onclick: () => {
        const rec = DnD.dadi.registratore();
        DnD.regole.rollSave({ bonus: 0, mode: 'vantaggio', dc: null }, rec.rng);
        DnD.dadi.roll(2, 6, 0, rec.rng);
        if (!DnD.uiDadi.mostraTiro(rec.tiro('Prova dei dadi', 'combattimento'))) toast('Dadi animati spenti per il combattimento.');
      } }),
      el('p', { class: 'muted small', text: 'Con «Riduci animazioni» il risultato compare subito, senza movimento. Spazio salta l\'animazione. I suoni dei dadi sono nel gruppo «Suoni».' }));
    const soundGroup = DnD.uiSuoni.settingsGroup();
    const difficultyGroup = DnD.uiDifficolta.settingsGroup();
    const panel = el('div', { class: 'settings-panel', id: 'settings-panel', role: 'dialog', 'aria-label': 'Impostazioni', hidden: true },
      el('h2', { text: 'Impostazioni' }),
      radios('tema', 'Tema', [['chiaro', 'Chiaro'], ['scuro', 'Scuro'], ['auto', 'Automatico']], 'theme'),
      radios('testo', 'Dimensione del testo', [['piccolo', 'Piccola'], ['normale', 'Normale'], ['grande', 'Grande']], 'textSize'),
      el('label', { class: 'check' }, reduce, ' Riduci animazioni'),
      el('label', { class: 'check', title: 'Barra della vita in alto, ombra ai lati dello schermo e animazioni dei boss nel combattimento' }, bossFx, ' Effetti boss'),
      movementGroup, combatGroup, restGroup, difficultyGroup.node, diceGroup, soundGroup.node,
      el('fieldset', { class: 'settings-group' },
        el('legend', { text: 'Online' }),
        el('div', { class: 'settings-actions' },
          el('button', { type: 'button', class: 'btn small', text: '🌐 Online: ospita o unisciti', onclick: () => DnD.uiOnline.apri() }),
          el('button', { type: 'button', class: 'btn small', text: '🩺 Test connessione', onclick: () => DnD.uiOnline.testConnessione() }))),
      el('fieldset', { class: 'settings-group' },
        el('legend', { text: 'Dati' }),
        el('div', { class: 'settings-actions' },
          el('button', { type: 'button', class: 'btn small', text: '⬇ Esporta archivio', onclick: exportArchive }),
          el('button', { type: 'button', class: 'btn small', text: '⬇ Esporta sessione corrente', onclick: exportSession }),
          el('button', { type: 'button', class: 'btn small', text: '⬆ Importa archivio o sessione', onclick: () => fileInput.click() }),
          el('button', { type: 'button', class: 'btn small danger', text: 'Cancella tutti i dati', onclick: clearAll }),
          fileInput)));

    const gear = el('button', {
      type: 'button', class: 'icon-btn footer-btn', id: 'settings-btn', title: 'Impostazioni', 'aria-label': 'Impostazioni',
      'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'settings-panel',
    }, svgIcon(ICONS.gear));
    const themeBtn = el('button', { type: 'button', class: 'icon-btn footer-btn', id: 'theme-btn' });

    function sync() {
      const s = I.get();
      for (const input of panel.querySelectorAll('input[name="tema"]')) input.checked = input.value === s.theme;
      for (const input of panel.querySelectorAll('input[name="testo"]')) input.checked = input.value === s.textSize;
      reduce.checked = s.reduceMotion;
      bossFx.checked = s.bossEffects;
      for (const input of panel.querySelectorAll('input[name="diagonali"]')) input.checked = input.value === s.diagonals;
      for (const input of panel.querySelectorAll('input[name="senza-velocita"]')) input.checked = input.value === s.missingMode;
      for (const input of panel.querySelectorAll('[data-setting]')) {
        if (input.type === 'checkbox') input.checked = Boolean(s[input.dataset.setting]);
        else input.value = s[input.dataset.setting];
      }
      soundGroup.sync();
      difficultyGroup.sync();
      for (const k of ['diceMenu', 'diceCombat', 'diceExploration', 'diceSpeed', 'diceColor']) { const n = panel.querySelector('[data-setting="' + k + '"]'); if (n) n.disabled = !s.diceAnim; }
      const dark = I.isDark();
      clear(themeBtn).append(svgIcon(dark ? ICONS.sun : ICONS.moon));
      themeBtn.title = dark ? 'Passa al tema chiaro' : 'Passa al tema scuro';
      themeBtn.setAttribute('aria-label', themeBtn.title);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    }
    const close = () => {
      if (panel.hidden) return;
      panel.hidden = true;
      gear.setAttribute('aria-expanded', 'false');
    };
    gear.addEventListener('click', () => {
      if (!panel.hidden) { close(); return; }
      sync();
      panel.hidden = false;
      gear.setAttribute('aria-expanded', 'true');
      panel.querySelector('input:checked').focus();
    });
    themeBtn.addEventListener('click', () => { I.set({ theme: I.isDark() ? 'chiaro' : 'scuro' }); sync(); });
    document.addEventListener('pointerdown', (e) => { if (!panel.contains(e.target) && !gear.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { close(); gear.focus(); } });
    window.addEventListener('themechange', sync);

    footer.append(gear, themeBtn, DnD.uiSuoni.quickButton(), panel);
    sync();
  }

  DnD.uiImpostazioni = { download, slug, today, mount, exportArchive, exportSession, importFile };
})(globalThis.DnD = globalThis.DnD || {});
