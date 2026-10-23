// Avvio dell'app: store, menù laterale, sessioni, impostazioni e pulsante dadi flottante.
(function (DnD) {
  'use strict';

  const { el, toast, svgIcon } = DnD.ui;
  const C = DnD.config;
  const SECTION_KEY = 'dnd-battaglie:sezione';
  let current = null;
  let sidebar = null;
  let notes = null;

  const main = document.getElementById('main');
  const navList = document.getElementById('nav-list');
  const diceFab = document.getElementById('dice-fab');
  const navButtons = () => [...navList.querySelectorAll('[data-section]')];

  // Menù costruito da DnD.config.MENU: voci nell'ordine indicato, separatori tra i gruppi.
  function buildNav() {
    let group = null;
    C.MENU.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        navList.append(el('li', { class: 'nav-group', role: 'presentation' }, el('span', { class: 'nav-label', text: C.GROUPS[group] })));
      }
      const shortcut = 'Alt+' + ((i + 1) % 10);
      navList.append(el('li', {}, el('button', {
        type: 'button', 'data-section': item.id, title: item.label + ' (' + shortcut + ')', 'aria-label': item.label,
        'aria-keyshortcuts': shortcut, onclick: () => show(item.id),
      }, el('span', { class: 'nav-icon' }, svgIcon(item.icon)), el('span', { class: 'nav-label', text: item.label }))));
    });
    // Frecce su/giù (e Home/Fine) tra le voci; Invio o Spazio aprono la sezione.
    navList.addEventListener('keydown', (e) => {
      const buttons = navButtons();
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      buttons[(next + buttons.length) % buttons.length].focus();
    });
  }

  function canLeaveSection() {
    const section = current ? DnD.sezioni[current] : null;
    return !section || !section.canLeave || section.canLeave();
  }

  // Apre una sezione. action: azione rapida opzionale (es. 'nuovo' dalle schermate vuote).
  function show(name, action) {
    if (!C.SECTIONS.includes(name)) name = C.SECTIONS[0];
    if (current && current !== name && !canLeaveSection()) return false;
    const section = DnD.sezioni[name];
    if (section.reset && current !== name) section.reset();
    if (action && section.open) section.open(action);
    current = name;
    for (const b of navButtons()) {
      const active = b.dataset.section === name;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    diceFab.hidden = name === 'dadi';
    try { localStorage.setItem(SECTION_KEY, name); } catch (e) { /* preferenza non essenziale */ }
    section.render(main);
    main.scrollTop = 0;
    return true;
  }

  // Dopo un cambio di sessione, un'importazione o una cancellazione: tutto si ridisegna.
  function refreshAll() {
    for (const id of C.SECTIONS) if (DnD.sezioni[id].reset) DnD.sezioni[id].reset();
    DnD.uiSessioni.refresh();
    if (notes) notes.refresh();
    if (current) DnD.sezioni[current].render(main);
  }

  function switchSession(id) {
    if (id === DnD.sessioni.current(DnD.store.state).id) return true;
    if (!canLeaveSection()) return false;
    if (notes) notes.flush(); // le note in sospeso vanno nella sessione che si lascia
    DnD.store.update((st) => { st.currentSessionId = id; });
    refreshAll();
    toast('Sessione: ' + DnD.sessioni.current(DnD.store.state).name);
    return true;
  }

  function setupSidebar() {
    const app = document.querySelector('.app');
    const toggleBtn = document.getElementById('sidebar-toggle');
    // Barra laterale richiudibile (Ctrl+B): da chiusa mostra solo le icone.
    sidebar = DnD.ui.persistentToggle('dnd-battaglie:barra-laterale', (collapsed) => {
      app.classList.toggle('sidebar-collapsed', collapsed);
      toggleBtn.textContent = collapsed ? '»' : '«';
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleBtn.title = (collapsed ? 'Apri' : 'Chiudi') + ' la barra (Ctrl+B)';
      toggleBtn.setAttribute('aria-label', (collapsed ? 'Apri' : 'Chiudi') + ' la barra laterale');
    });
    toggleBtn.addEventListener('click', () => sidebar.toggle());
  }

  document.addEventListener('keydown', (e) => {
    if (DnD.ui.shortcutsBlocked(e)) return; // nell'editor delle note: Ctrl+B = grassetto, Alt+cifra = niente
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      if (sidebar) sidebar.toggle();
      return;
    }
    // Alt+1…Alt+9 e Alt+0 (decima voce): voci del menù nell'ordine.
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    const item = m ? C.MENU[(Number(m[1]) + 9) % 10] : null;
    if (e.altKey && !e.ctrlKey && !e.metaKey && item) {
      e.preventDefault();
      show(item.id);
    }
  });

  async function start() {
    document.title = C.APP_NAME;
    document.getElementById('brand-name').textContent = C.APP_NAME;
    DnD.store = await DnD.dati.openStore(window.localStorage);
    // Immagini importate (TileSet e sfondi delle griglie): stesso database, con cache in memoria.
    DnD.immagini = DnD.immaginiLib.createStore(DnD.store.blobs);
    // File che sostituiscono i suoni predefiniti: stesso database (chiavi "snd:<id>").
    DnD.audio.collegaArchivio(DnD.store.blobs);
    // Tileset migrati dalle immagini "stirate": la dimensione dei tile si completa leggendo i pixel.
    DnD.uiTileset.resolveLegacyTilesets().then((changed) => { if (changed) refreshAll(); }).catch(() => { /* restano segnaposto */ });
    DnD.store.onSaveError = (e) => toast('Salvataggio non riuscito: ' + e.message + '. Esporta i dati per non perderli.', 'error');

    buildNav();
    setupSidebar();
    DnD.uiSessioni.mount(document.getElementById('session-picker'));
    DnD.uiImpostazioni.mount(document.getElementById('sidebar-footer'));
    diceFab.addEventListener('click', DnD.uiDadi.openPanel);
    // Note del master: pannello laterale disponibile in ogni sezione (non è una voce del menù).
    notes = DnD.uiNote.create();

    if (DnD.store.loadError) toast(DnD.store.loadError, 'error');
    // Riapre l'ultima sezione usata.
    let initial = C.SECTIONS[0];
    try { initial = localStorage.getItem(SECTION_KEY) || initial; } catch (e) { /* ignora */ }
    // Le versioni precedenti avevano le sezioni "Strutture" e "Oggetti": ora sono in "Asset".
    show(initial === 'oggetti' || initial === 'strutture' ? 'asset' : initial);
  }

  DnD.app = {
    show, refreshAll, switchSession, canLeaveSection,
    navigate: (name, action) => show(name, action),
    toggleSidebar: (collapsed) => sidebar && sidebar.toggle(collapsed),
    notes: () => notes,
  };

  start().catch((e) => {
    main.textContent = 'Impossibile avviare l\'app: ' + e.message;
  });

  // Il service worker funziona solo su http(s), non aprendo il file direttamente.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* l'app funziona comunque */ });
  }
})(globalThis.DnD = globalThis.DnD || {});
