// Avvio dell'app: archivio del profilo (con la migrazione ai profili), router su hash (portale, Master, gioco online),
// menù laterale, sessioni, impostazioni e pulsante dadi flottante.
(function (DnD) {
  'use strict';

  const { el, toast, svgIcon } = DnD.ui;
  const C = DnD.config;
  const R = DnD.rotte;
  const SECTION_KEY = 'dnd-battaglie:sezione';
  const ROTTA_KEY = 'dnd-battaglie:ultima-rotta';
  const RECENTI_KEY = 'dnd-battaglie:sessioni-recenti';
  // Modalità di prova (index.html?prova, usata dal test di fumo): archivio in memoria, nessun service worker,
  // così il test non legge né scrive i dati veri dell'utente.
  const PROVA = DnD.archivioLocale.PROVA;
  const prefs = () => DnD.archivioLocale.preferenze;
  let current = null;   // ultima sezione del Master aperta
  let modo = null;      // schermata mostrata: 'home' | 'master' | 'gioca' | 'ospita' | 'unisciti'
  let applicata = '';   // hash dell'ultima rotta applicata (gli eventi del browser per la stessa rotta si ignorano)
  let sidebar = null;
  let notes = null;

  const main = document.getElementById('main');
  const navList = document.getElementById('nav-list');
  const diceFab = document.getElementById('dice-fab');
  const navButtons = () => [...navList.querySelectorAll('[data-section]')];

  // Menù costruito da DnD.config.MENU: voci nell'ordine indicato, separatori tra i gruppi.
  function buildNav() {
    let group = null;
    C.MENU.forEach((item) => {
      if (item.group !== group) {
        group = item.group;
        navList.append(el('li', { class: 'nav-group', role: 'presentation' }, el('span', { class: 'nav-label', text: C.GROUPS[group] })));
      }
      const shortcut = 'Alt+' + item.key;
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
    const section = modo === 'master' && current ? DnD.sezioni[current] : null;
    return !section || !section.canLeave || section.canLeave();
  }

  const leggi = (k, def) => { try { const v = JSON.parse(prefs().getItem(k)); return v === null ? def : v; } catch (e) { return def; } };
  const ultimaSezione = () => { try { return prefs().getItem(SECTION_KEY); } catch (e) { return null; } };
  const scrivi = (k, v) => { try { prefs().setItem(k, JSON.stringify(v)); } catch (e) { /* preferenza non essenziale */ } };

  // Schermata mostrata: il body la porta come attributo (il CSS nasconde barra e dadi fuori dal Master).
  function imposta(nuovo) {
    modo = nuovo;
    document.body.dataset.modo = nuovo;
  }
  // Scrive l'hash senza riapplicare la rotta (sostituisci: non aggiunge una voce alla cronologia).
  function segna(hash, sostituisci) {
    applicata = hash;
    if (location.hash === hash) return;
    if (sostituisci) location.replace(hash);
    else location.hash = hash;
  }
  function ricorda(hash) {
    if (!PROVA || hash) scrivi(ROTTA_KEY, hash);
  }

  // Apre una sezione del Master. action: azione rapida opzionale (es. 'nuovo' dalle schermate vuote).
  function show(name, action, opts) {
    // Giocatore online: solo la schermata della sessione (nessun'altra sezione).
    if (DnD.uiOnline && DnD.uiOnline.vistaGiocatore()) return false;
    // Profilo con PIN non ancora inserito: solo il portale.
    if (DnD.uiPortale.bloccato()) return false;
    if (!C.SECTIONS.includes(name)) name = C.SECTIONS[0];
    if (current && current !== name && !canLeaveSection()) return false;
    const section = DnD.sezioni[name];
    if (section.reset && current !== name) section.reset();
    if (action && section.open) section.open(action);
    current = name;
    imposta('master');
    for (const b of navButtons()) {
      const active = b.dataset.section === name;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    diceFab.hidden = name === 'dadi';
    try { prefs().setItem(SECTION_KEY, name); } catch (e) { /* preferenza non essenziale */ }
    section.render(main);
    main.scrollTop = 0;
    const hash = R.formatta({ modo: 'master', sezione: name });
    segna(hash, opts && opts.sostituisci);
    ricorda(hash);
    return true;
  }

  // Portale e schermate «Ospita» / «Unisciti» (ui-portale.js), nella stessa pagina: nessun ricaricamento.
  function mostraPortale(sotto, opts) {
    if (modo === 'master' && !canLeaveSection()) return false;
    imposta(sotto || 'home');
    diceFab.hidden = true;
    DnD.uiPortale.render(main, Object.assign({ schermata: sotto || 'home' }, opts || {}));
    main.scrollTop = 0;
    const hash = R.formatta({ modo: sotto || 'home' });
    segna(hash, opts && opts.sostituisci);
    if (!opts || !opts.interrotta) ricorda(hash);
    return true;
  }

  // C'è qualcosa da perdere uscendo? Combattimento in corso o connessione online attiva.
  function inCorso() {
    const st = DnD.store && DnD.store.state;
    const combat = st ? DnD.sessioni.current(st).combat : null;
    const online = Boolean(DnD.uiOnline && DnD.uiOnline.attivo());
    return { combat: Boolean(combat && combat.phase === 'attivo'), online };
  }

  // Torna al portale (pulsante Home, Alt+H), con conferma se c'è un combattimento o una connessione attiva.
  function home() {
    if (modo === 'home') return true;
    if (DnD.uiOnline && DnD.uiOnline.vistaGiocatore()) {
      if (!confirm('Tornare al portale? Esci dalla partita online: con il gettone salvato potrai rientrare con lo stesso personaggio.')) return false;
      DnD.uiOnline.chiudiGiocatore('Sei uscito dalla partita.');
      return mostraPortale('home');
    }
    const c = inCorso();
    const motivi = [c.combat ? 'un combattimento in corso (resta salvato)' : null, c.online ? 'una partita online ospitata (resta aperta)' : null].filter(Boolean);
    if (motivi.length && !confirm('Tornare al portale? Hai ' + motivi.join(' e ') + '.')) return false;
    return mostraPortale('home');
  }

  // Applica una rotta (dall'hash, da Indietro/Avanti o dai pulsanti). Restituisce true se è stata aperta.
  function applica(r, opts) {
    const o = opts || {};
    const giocatore = Boolean(DnD.uiOnline && DnD.uiOnline.vistaGiocatore());
    if (DnD.uiPortale.bloccato() && r.modo !== 'home') return mostraPortale('home', { sostituisci: true });
    if (giocatore && r.modo !== 'gioca') {
      // La modalità Giocatore non apre le sezioni del Master: solo l'uscita verso il portale (con conferma).
      if (r.modo === 'home' && home()) return true;
      segna(R.formatta({ modo: 'gioca' }), true);
      return false;
    }
    if (r.modo === 'gioca') {
      if (giocatore) { imposta('gioca'); segna(R.formatta(r), o.sostituisci); return true; }
      // Schermata di gioco senza connessione (ricaricamento, link): il portale propone di riconnettersi.
      return mostraPortale('home', { sostituisci: true, interrotta: true });
    }
    if (r.modo === 'master') {
      if (!show(r.sezione || current || ultimaSezione() || C.SECTIONS[0], null, o)) { segna(attuale(), true); return false; }
      return true;
    }
    if (!mostraPortale(r.modo, Object.assign({}, o, { interrotta: o.interrotta || false, sostituisci: o.sostituisci || r.sconosciuta }))) {
      segna(attuale(), true);
      return false;
    }
    return true;
  }
  const attuale = () => (modo === 'master' ? R.formatta({ modo, sezione: current }) : R.formatta({ modo: modo || 'home' }));

  // Navigazione dai pulsanti: hash ('#/master/nemici') o rotta.
  function vai(dove, opts) {
    const r = typeof dove === 'string' ? R.analizza(dove, C.SECTIONS) : dove;
    return applica(r.modo === null ? { modo: 'home' } : r, opts);
  }

  function suHash() {
    if (location.hash === applicata) return;
    const r = R.analizza(location.hash, C.SECTIONS);
    applica(r.modo === null ? { modo: 'home' } : r, { sostituisci: true });
  }

  // Sessioni aperte di recente (per il riquadro «Riprendi» del portale): id e ora, la più recente prima.
  function segnaRecente(id) {
    const lista = leggi(RECENTI_KEY, []);
    const prima = Array.isArray(lista) ? lista.filter((x) => x && x.id !== id) : [];
    scrivi(RECENTI_KEY, [{ id, ora: Date.now() }].concat(prima).slice(0, 8));
  }
  const recenti = () => { const l = leggi(RECENTI_KEY, []); return Array.isArray(l) ? l.filter((x) => x && typeof x.id === 'string') : []; };

  // Dopo un cambio di sessione, un'importazione o una cancellazione: tutto si ridisegna.
  function refreshAll() {
    if (DnD.uiOnline && DnD.uiOnline.vistaGiocatore()) return;
    for (const id of C.SECTIONS) if (DnD.sezioni[id].reset) DnD.sezioni[id].reset();
    DnD.uiSessioni.refresh();
    if (notes) notes.refresh();
    if (modo === 'master' && current) DnD.sezioni[current].render(main);
    else if (modo) DnD.uiPortale.render(main, { schermata: modo });
  }

  function switchSession(id) {
    if (id === DnD.sessioni.current(DnD.store.state).id) { segnaRecente(id); return true; }
    if (!canLeaveSection()) return false;
    if (notes) notes.flush(); // le note in sospeso vanno nella sessione che si lascia
    DnD.store.update((st) => { st.currentSessionId = id; });
    segnaRecente(id);
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
    // Pulsante Home: torna al portale (Alt+H).
    const homeBtn = el('button', { type: 'button', class: 'nav-home', id: 'home-btn', title: 'Portale (Alt+H)', 'aria-label': 'Torna al portale', 'aria-keyshortcuts': 'Alt+H', onclick: home },
      el('span', { class: 'nav-icon' }, svgIcon(C.ICONS.home)), el('span', { class: 'nav-label', text: 'Home' }));
    document.getElementById('session-picker').before(homeBtn);
  }

  document.addEventListener('keydown', (e) => {
    if (DnD.ui.shortcutsBlocked(e)) return; // nell'editor delle note: Ctrl+B = grassetto, Alt+cifra = niente
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
      if (modo !== 'master') return;
      e.preventDefault();
      if (sidebar) sidebar.toggle();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') {
      e.preventDefault();
      home();
      return;
    }
    // Alt+cifra (o Alt+lettera, es. Alt+S per Scene): la voce del menù con quella scorciatoia (config.js).
    const m = /^(?:Digit|Numpad|Key)([0-9A-Z])$/.exec(e.code);
    const item = m ? C.MENU.find((x) => x.key === m[1]) : null;
    if (e.altKey && !e.ctrlKey && !e.metaKey && item) {
      e.preventDefault();
      show(item.id);
    }
  });

  async function start() {
    document.title = C.APP_NAME;
    document.getElementById('brand-name').textContent = C.APP_NAME;
    const avvio = await DnD.archivio.avvia();
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
    DnD.uiPortale.avvio(avvio);
    // Backup: cartella collegata e controllo periodico; archivio in sospeso di un profilo creato da un'importazione.
    DnD.uiBackup.avvia().catch((e) => console.warn('Backup automatico non avviato', e));
    DnD.uiBackup.importazioneInSospeso().catch((e) => console.warn('Importazione in sospeso non riuscita', e));

    if (DnD.store.loadError) toast(DnD.store.loadError, 'error');
    // Ripristina la schermata dall'hash; senza hash: portale, oppure l'ultima sezione con «Salta il portale».
    let ultima = ultimaSezione();
    // Le versioni precedenti avevano le sezioni "Strutture" e "Oggetti": ora sono in "Asset".
    if (ultima === 'oggetti' || ultima === 'strutture') ultima = 'asset';
    const r = R.iniziale({ hash: location.hash, sezioni: C.SECTIONS, salta: DnD.uiPortale.saltaPortale(), ultimaSezione: ultima });
    current = null;
    segnaRecente(DnD.sessioni.current(DnD.store.state).id);
    applica(r, { sostituisci: true, interrotta: r.interrotta });
    window.addEventListener('hashchange', suHash);
    window.addEventListener('popstate', suHash);
  }

  // L'interfaccia DnD.app è dichiarata in ui-comune.js (le sezioni la usano senza dipendere da questo file): qui si riempie.
  Object.assign(DnD.app, {
    show, refreshAll, switchSession, canLeaveSection, vai, home, recenti, inCorso,
    navigate: (name, action) => show(name, action),
    toggleSidebar: (collapsed) => sidebar && sidebar.toggle(collapsed),
    notes: () => notes,
    modo: () => modo,
    sezione: () => current || ultimaSezione() || C.SECTIONS[0],
    ultimaRotta: () => leggi(ROTTA_KEY, null),
  });

  start().catch((e) => {
    console.error('Avvio non riuscito', e);
    main.textContent = 'Impossibile avviare l\'app: ' + e.message;
  });

  // Il service worker funziona solo su http(s), non aprendo il file direttamente.
  if (!PROVA && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* l'app funziona comunque */ });
  }
})(globalThis.DnD = globalThis.DnD || {});
