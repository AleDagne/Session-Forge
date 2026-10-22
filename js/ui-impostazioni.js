// Impostazioni: pulsante ingranaggio con pannello a comparsa e pulsante rapido sole/luna.
// Il pannello gestisce tema, dimensione del testo, animazioni ridotte ed esportazione/importazione.
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

  async function exportArchive() {
    const images = await imagesOf(DnD.store.state);
    download(DnD.dati.exportJSON(DnD.store.state, images), slug(DnD.config.APP_NAME) + '-archivio-' + today() + '.json');
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
    const panel = el('div', { class: 'settings-panel', id: 'settings-panel', role: 'dialog', 'aria-label': 'Impostazioni', hidden: true },
      el('h2', { text: 'Impostazioni' }),
      radios('tema', 'Tema', [['chiaro', 'Chiaro'], ['scuro', 'Scuro'], ['auto', 'Automatico']], 'theme'),
      radios('testo', 'Dimensione del testo', [['piccolo', 'Piccola'], ['normale', 'Normale'], ['grande', 'Grande']], 'textSize'),
      el('label', { class: 'check' }, reduce, ' Riduci animazioni'),
      el('label', { class: 'check', title: 'Barra della vita in alto, ombra ai lati dello schermo e animazioni dei boss nel combattimento' }, bossFx, ' Effetti boss'),
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

    footer.append(gear, themeBtn, panel);
    sync();
  }

  DnD.uiImpostazioni = { download, slug, today, mount, exportArchive, exportSession, importFile };
})(globalThis.DnD = globalThis.DnD || {});
