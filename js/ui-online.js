// Gioco online (interfaccia): finestra «Gioco online» (Ospita / Unisciti), scambio dei codici, approvazione degli
// ingressi, pannello del master (giocatori, permessi, pausa, tiri convalidati, richieste in attesa con Approva /
// Modifica / Rifiuta, domande, tiri salvezza richiesti, rivelazioni, registro di sicurezza, chat), schermata del
// giocatore (azioni come richieste al master, propria scheda modificabile, griglia con la propria pedina da
// trascinare, ping, turni, log, chat e dadi) e pagina «Test connessione».
// Tappa 3: pannello unificato (visibilità, ingressi chiusi, spettatori, «Vedi come giocatore», Mondo, dialoghi,
// scene, «sto preparando», log completo, ripresa della sessione), schermata del giocatore con esplorazione, Mondo
// (quest, NPC, mercanti), dialoghi, riposo breve, barra dei partecipanti, «Connessione persa» con Rientra, diagnostica.
// La logica è in js/rete/ (protocollo, trasporto, codici, segnalazione, filtro, immagini, intenzioni, sessione): qui
// solo DOM. L'app offline resta com'è: la rete parte solo quando si ospita o ci si unisce a una sessione.
(function (DnD) {
  'use strict';

  const { el, clear, toast, openDialog, field, textInput, fill } = DnD.ui;
  const NET = () => DnD.rete;
  const I = () => DnD.rete.intenzioni;
  const PROFILO = 'dnd-battaglie:online-profilo';
  const GETTONE = 'dnd-battaglie:online-gettone';
  const NOTE = 'dnd-battaglie:online-note';
  const RIPRESA = 'dnd-battaglie:online-ripresa'; // gettoni del master per riprendere la sessione dopo una chiusura
  const BATTITO_MS = 3000;
  const PING_MS = 3500;
  const COLORE = /^#[0-9a-f]{6}$/i;
  const suona = (id) => { if (DnD.audio) DnD.audio.suona(id); };
  const lento = () => !DnD.impostazioni.reduceMotion();

  let master = null; // { s: sessione, q: profilo, timer, attesa, registro, dom, domande }
  let gioc = null;   // { s: sessione, q, timer, dom, grid, doc, tsIndex, icone, finita, richieste, anim }
  const feed = [];   // chat e dadi: { da, colore, testo, privato, a, dado, ora }
  const chatBoxes = new Set();
  const pings = [];  // { x, y, nome, colore, t0 }

  // ---------- Preferenze locali (non dati della sessione) ----------
  function leggi(chiave, def) { try { const v = JSON.parse(localStorage.getItem(chiave) || 'null'); return v === null ? def : v; } catch (e) { return def; } }
  function scrivi(chiave, v) { try { localStorage.setItem(chiave, JSON.stringify(v)); } catch (e) { /* non essenziale */ } }
  function profilo() {
    const p = leggi(PROFILO, {}) || {};
    return { nome: typeof p.nome === 'string' ? p.nome.slice(0, 30) : '', colore: COLORE.test(p.colore || '') ? p.colore : '#4f8cc9', comprimi: p.comprimi !== false };
  }

  // ---------- Elementi comuni ----------
  // Codice da copiare: campo selezionabile e «Copia» (appunti, o ripiego con la selezione).
  function campoCodice(codice) {
    const area = el('textarea', { class: 'code-box', rows: 4, readonly: true, spellcheck: false, 'aria-label': 'Codice', onfocus: (e) => e.target.select() });
    area.value = codice;
    const copia = el('button', { type: 'button', class: 'btn small', text: '📋 Copia', onclick: async () => {
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('appunti');
        await navigator.clipboard.writeText(codice);
        toast('Codice copiato: incollalo nella chat con l\'altro giocatore.', 'success');
      } catch (e) {
        area.focus();
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        toast(ok ? 'Codice copiato.' : 'Codice selezionato: premi Ctrl+C (Cmd+C) per copiarlo.', ok ? 'success' : null);
      }
    } });
    return el('div', { class: 'code-field' }, area, el('div', { class: 'code-actions' }, copia, el('span', { class: 'muted small', text: codice.length + ' caratteri' })));
  }
  const pallino = (colore) => el('span', { class: 'online-swatch', style: 'background:' + (COLORE.test(colore || '') ? colore : '#888') });
  const lineaDot = (linea) => el('span', { class: 'online-dot ' + (linea || 'grigio'), title: { verde: 'Collegamento buono', giallo: 'Collegamento lento', rosso: 'Nessuna risposta', grigio: 'Non collegato' }[linea || 'grigio'] });
  function totaleTiro(t) { return t.totale !== null && t.totale !== undefined ? t.totale : t.gruppi.reduce((s, g) => s + g.total, 0); }
  const tiroTesto = (t) => (t.etichetta || 'Tiro') + ' = ' + totaleTiro(t) + ' [' + t.gruppi.flatMap((g) => g.values).join(', ') + ']';
  const oraTesto = (t) => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const btn = (text, onclick, extra) => el('button', Object.assign({ type: 'button', class: 'btn small', text, onclick }, extra || {}));

  // ---------- Chat e dadi (feed comune) ----------
  function aggiungiFeed(m) {
    feed.push(Object.assign({ ora: Date.now() }, m));
    if (feed.length > 300) feed.splice(0, feed.length - 300);
    for (const c of chatBoxes) c.refresh();
  }
  // opts: { destinatari() -> [[valore, etichetta]], invia(testo, destinatario) -> messaggio | null, scrive(), comandi(testo, dest) -> true se gestito }
  function chatBox(opts) {
    const list = el('ol', { class: 'online-chat-list', 'aria-live': 'polite', 'aria-label': 'Messaggi' });
    const scrivendo = el('p', { class: 'muted small online-typing', 'aria-live': 'polite' });
    let ultimoScrive = 0;
    const input = textInput('', { maxlength: 500, placeholder: 'Scrivi un messaggio… (/tira 2d6+3)', 'aria-label': 'Messaggio', oninput: () => {
      if (opts.scrive && Date.now() - ultimoScrive > 2500) { ultimoScrive = Date.now(); opts.scrive(); }
    } });
    const dest = el('select', { 'aria-label': 'Destinatario' });
    const form = el('form', { class: 'online-chat-form', onsubmit: (e) => {
      e.preventDefault();
      if (opts.comandi && opts.comandi(input.value, dest.value)) { input.value = ''; return; }
      const m = opts.invia(input.value, dest.value);
      if (m) { aggiungiFeed(m); input.value = ''; }
    } }, dest, input, el('button', { type: 'submit', class: 'btn small', text: 'Invia' }));
    const node = el('section', { class: 'panel online-chat' }, el('h2', { text: 'Chat e dadi' }), list, scrivendo, form);
    let timer = 0;
    const box = {
      node,
      refresh() {
        const v = dest.value;
        clear(dest).append(...opts.destinatari().map(([value, label]) => el('option', { value, text: label, selected: value === v })));
        clear(list).append(...feed.map((m) => el('li', { class: (m.dado ? 'dado' : '') + (m.privato ? ' privato' : '') },
          el('span', { class: 'muted small', text: oraTesto(m.ora) + ' ' }), pallino(m.colore), el('b', { text: m.da }),
          m.privato ? el('span', { class: 'tag small', text: '🔒 ' + (m.a ? 'a ' + m.a : 'privato') }) : null,
          m.verificato === false ? el('span', { class: 'tag small', title: 'Tiro deciso dal giocatore, non dal master', text: 'non verificato' }) : null,
          el('span', { text: (m.dado ? ' 🎲 ' : ': ') + m.testo }))));
        list.scrollTop = list.scrollHeight;
      },
      scrive(nome) {
        scrivendo.textContent = nome + ' sta scrivendo…';
        clearTimeout(timer);
        timer = setTimeout(() => { scrivendo.textContent = ''; }, 3000);
      },
    };
    chatBoxes.add(box);
    box.refresh();
    return box;
  }
  // Dado ricevuto: animazione con mostraTiro, riga nel feed (e nel log del combattimento, sul master).
  function dadoRicevuto(m, sulMaster) {
    DnD.uiDadi.mostraTiro(Object.assign({}, m.tiro, { categoria: 'combattimento' }));
    aggiungiFeed({ da: m.da, colore: m.colore, testo: tiroTesto(m.tiro), dado: true, privato: m.privato, verificato: m.verificato });
    if (!sulMaster) return;
    const c = DnD.sessioni.current(DnD.store.state).combat;
    if (!c || m.privato) return;
    DnD.store.update(() => DnD.dati.pushLog(c, 'sistema', '🎲 ' + m.da + ' (online): ' + tiroTesto(m.tiro) + (m.verificato === false ? ' — non verificato' : '')));
    rinfrescaCombattimento();
  }
  const rinfrescaCombattimento = () => { if (document.querySelector('.combat-screen') && !document.querySelector('.online-screen')) DnD.sezioni.combattimento.render(); };

  // ---------- Ping sulla griglia ----------
  let pingAnim = 0;
  function aggiungiPing(p) {
    pings.push(Object.assign({}, p, { t0: performance.now() }));
    suona('online-ping');
    const griglia = () => (gioc && gioc.grid) || (DnD.uiCombattimento && DnD.uiCombattimento.getGrid());
    const passo = () => {
      const now = performance.now();
      while (pings.length && now - pings[0].t0 > PING_MS) pings.shift();
      const g = griglia();
      if (g) g.requestDraw();
      pingAnim = pings.length ? requestAnimationFrame(passo) : 0;
    };
    if (!pingAnim) pingAnim = requestAnimationFrame(passo);
  }
  // Disegno dei ping (anche sulla griglia del Combattimento del master): cerchi che si allargano e il nome.
  function disegnaPing(ctx, view, s) {
    const now = performance.now();
    for (const p of pings) {
      const k = Math.min(1, (now - p.t0) / PING_MS);
      const cx = view.panX + (p.x + 0.5) * s;
      const cy = view.panY + (p.y + 0.5) * s;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = p.colore;
      ctx.lineWidth = 3;
      for (const f of lento() ? [0, 0.35] : [0]) {
        ctx.beginPath();
        ctx.arc(cx, cy, s * (0.4 + (lento() ? ((k + f) % 1) * 1.2 : 0.4)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = p.colore;
      ctx.font = '600 ' + Math.max(10, Math.round(s * 0.3)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('📍 ' + p.nome, cx, cy - s * 0.7);
      ctx.restore();
    }
  }

  // ---------- Finestra «Gioco online» ----------
  function apri() {
    if (gioc) return;
    if (master) { pannello(true); return; }
    const p = profilo();
    const nome = textInput(p.nome, { maxlength: 30, placeholder: 'Come ti vedranno gli altri', 'aria-label': 'Nome visualizzato' });
    const colore = el('input', { type: 'color', value: p.colore, 'aria-label': 'Colore' });
    const semplici = el('input', { type: 'checkbox', checked: !p.comprimi });
    const leggiQ = () => { const q = { nome: NET().protocollo.pulisciTesto(nome.value, 30).replace(/\n/g, ' ') || 'Senza nome', colore: colore.value, comprimi: !semplici.checked }; scrivi(PROFILO, q); return q; };
    const S = NET().segnalazione;
    const env = S.ambiente();
    // Ripresa: il master aveva chiuso l'app con una sessione aperta su questa sessione dell'archivio.
    const rip = leggi(RIPRESA, null);
    const sessId = DnD.sessioni.current(DnD.store.state).id;
    const riprendi = rip && rip.sessionId === sessId && Array.isArray(rip.gettoni) && rip.gettoni.length
      ? el('button', { type: 'button', class: 'btn', text: '↻ Riprendi la sessione online (' + rip.gettoni.length + (rip.gettoni.length === 1 ? ' giocatore' : ' giocatori') + ')',
        title: 'I personaggi restano legati ai gettoni: rinvita i giocatori con codici nuovi',
        disabled: !env.RTCPeerConnection, onclick: () => { const q = leggiQ(); d.dismiss(); avviaMaster(q, rip.gettoni); nuovoInvito(); } }) : null;
    const d = openDialog('Gioco online', el('div', { class: 'form online-start' },
      el('p', { class: 'muted small', text: 'Collegamento diretto tra browser (WebRTC), senza server e senza account: master e giocatore si scambiano due codici (per esempio nella chat che usate già). Il giocatore chiede le azioni, il master le verifica e tira i dadi.' }),
      env.RTCPeerConnection ? null : el('p', { class: 'error-text', text: 'Questo browser non supporta WebRTC: il gioco online non è disponibile. Ripiego: condividi lo schermo.' }),
      field('Nome visualizzato', nome), field('Colore', colore),
      el('label', { class: 'check small', title: 'Per i browser che non sanno decomprimere i codici (codici più lunghi)' }, semplici, ' Codici senza compressione'),
      el('div', { class: 'online-choice' },
        el('button', { type: 'button', class: 'btn primary', text: '🏠 Ospita (master)', disabled: !env.RTCPeerConnection, onclick: () => { const q = leggiQ(); d.dismiss(); avviaMaster(q); nuovoInvito(); } }),
        el('button', { type: 'button', class: 'btn primary', text: '🔗 Unisciti (giocatore)', disabled: !env.RTCPeerConnection, onclick: () => { const q = leggiQ(); d.dismiss(); unisciti(q); } })),
      riprendi,
      el('button', { type: 'button', class: 'btn small', text: '🩺 Test connessione', onclick: () => { d.dismiss(); testConnessione(); } })));
    nome.focus();
  }

  // ---------- Master ----------
  // gettoni: ripresa di una sessione chiusa (i personaggi restano legati ai gettoni, i codici sono nuovi).
  function avviaMaster(q, gettoni) {
    if (master) return;
    const s = NET().sessione.master({
      nome: q.nome, stato: () => DnD.store.state, gettoni: gettoni || [],
      // Esplorazione: il gruppo si muove con le regole dell'esplorazione (costo, ore, eventi).
      esploraGruppo: (x, y) => (DnD.uiEsplorazione ? DnD.uiEsplorazione.muoviOnline({ x, y }) : { ok: false, testo: 'Esplorazione non disponibile.' }),
      // Riposo breve chiesto e approvato: il master lo avvia con la finestra di sempre.
      riposo: (id) => { setTimeout(() => DnD.uiRiposi.restPlayers('breve', [id], 'Riposo breve richiesto online'), 0); return { testo: 'Il master avvia il riposo breve.' }; },
      suDialogo: (d) => {
        const dl = master && master.dialogo && master.dialogo.id === d.dialogoId ? master.dialogo : null;
        const r = dl ? dl.risposte.find((x) => x.id === d.rispostaId) : null;
        const testo = d.nome + ' sceglie: «' + (r ? r.testo : '?') + '»';
        toast('🗨 ' + testo, 'success');
        aggiungiFeed({ da: d.nome, colore: '#c9a24f', testo: '🗨 ' + (r ? r.testo : '?') });
        if (master) master.dialogo = null;
        return { testo };
      },
      aggiornaStato: (fn) => { DnD.store.update(fn); rinfrescaCombattimento(); },
      esecutore: DnD.uiCombattimento.online,
      regole: () => DnD.impostazioni.movementRules(),
      suRichiesta: richiestaDialog,
      suCambio: (e) => {
        if (e && e.evento === 'entrato') { suona('online-entra'); toast(e.giocatore.nome + ' è entrato nella sessione.', 'success'); }
        if (e && e.evento === 'disconnesso') { suona('online-disconnessione'); toast(e.giocatore.nome + ' si è disconnesso: il suo personaggio è assente (vedi il pannello Online).', 'error'); }
        aggiornaPannello();
      },
      suChat: (m) => { aggiungiFeed(m); suona('online-chat'); },
      suDado: (m) => dadoRicevuto(m, true),
      suErrore: (t) => toast(t, 'error'),
      suCoda: () => { suona('online-richiesta'); aggiornaPannello(true); },
      suDomanda: (d) => { master.domande.push(Object.assign({ ora: Date.now() }, d)); suona('online-richiesta'); toast(d.nome + ' chiede: ' + d.testo); aggiornaPannello(true); },
      suPing: aggiungiPing,
      suScrive: (nome) => { if (master && master.dom) master.dom.chat.scrive(nome); },
      suViolazione: () => aggiornaPannello(true),
      immagine: (id) => DnD.immagini.get(id),
    });
    master = { s, q, attesa: null, domande: [], dialogo: null, registro: NET().codici.registro(), timer: setInterval(() => { s.battito(); salvaRipresa(); aggiornaPannello(); }, BATTITO_MS) };
    if (gettoni && gettoni.length) toast('Sessione ripresa: invita di nuovo i giocatori (codici nuovi); con il gettone ritrovano il loro personaggio.', 'success');
    // Ogni modifica dello stato (combattimento, griglia, PF…) diventa un evento per i giocatori.
    DnD.store.onChange = () => {
      if (!master) return;
      clearTimeout(master.attesa);
      master.attesa = setTimeout(() => { if (master) master.s.aggiorna(); }, 80);
    };
    pannello(true);
  }

  async function nuovoInvito() {
    if (!master) return;
    const body = el('div', { class: 'form online-codes' }, el('p', { class: 'muted', text: 'Preparo l\'invito (cerco gli indirizzi di rete, qualche secondo)…' }));
    let invito = null;
    let collegato = false;
    const d = openDialog('Invita un giocatore', body);
    d.addEventListener('close', () => { if (invito && !collegato) invito.annulla(); });
    try {
      invito = await NET().segnalazione.manuale.ospita({ nome: master.q.nome, comprimi: master.q.comprimi, registro: master.registro, maxRicevuto: NET().protocollo.LIMITI.daGiocatore });
    } catch (e) {
      fill(body, el('p', { class: 'error-text', text: 'Impossibile creare l\'invito: ' + e.message }));
      return;
    }
    if (!d.open) { invito.annulla(); return; }
    const risposta = el('textarea', { class: 'code-box', rows: 4, spellcheck: false, placeholder: 'Incolla qui il codice di risposta del giocatore', 'aria-label': 'Codice di risposta' });
    const stato = el('p', { class: 'small', 'aria-live': 'polite' });
    const collega = el('button', { type: 'button', class: 'btn primary', text: 'Collega', onclick: async () => {
      collega.disabled = true;
      stato.className = 'small';
      stato.textContent = 'Collegamento in corso…';
      try {
        const t = await invito.accetta(risposta.value);
        if (!master) { t.chiudi(); return; }
        collegato = true;
        master.s.collega(t);
        stato.textContent = 'Collegato! Tra un attimo ti arriva la richiesta di ingresso.';
        setTimeout(() => d.dismiss(), 900);
      } catch (e) {
        stato.className = 'small error-text';
        stato.textContent = e.message;
        collega.disabled = false;
      }
    } });
    fill(body,
      el('p', {}, el('b', { text: '1. ' }), 'Manda questo codice di invito al giocatore. Vale ' + NET().codici.DURATA / 60000 + ' minuti e una sola volta.'),
      campoCodice(invito.codice),
      invito.candidati.stun ? null : el('p', { class: 'small warning-text', text: '⚠ Nessun indirizzo pubblico trovato (STUN): il collegamento funzionerà probabilmente solo nella stessa rete. Vedi «Test connessione».' }),
      el('p', {}, el('b', { text: '2. ' }), 'Il giocatore lo incolla in «Unisciti» e ti manda il suo codice di risposta: incollalo qui.'),
      risposta, el('div', { class: 'form-actions' }, collega), stato);
  }

  const personaggi = () => DnD.sessioni.visible(DnD.store.state, 'players');
  // Gettoni assegnati, salvati nel browser del master: se chiude l'app può riprendere la sessione.
  function salvaRipresa() {
    if (!master) return;
    const gettoni = master.s.esportaGettoni();
    scrivi(RIPRESA, gettoni.length ? { sessionId: DnD.sessioni.current(DnD.store.state).id, gettoni, ora: Date.now() } : null);
  }
  // Scelte dell'ingresso: personaggio, oppure spettatore («tavolo» o come un personaggio).
  function sceltaPersonaggio(pgs, usati, pre, attuale) {
    return el('select', { 'aria-label': 'Personaggio o spettatore' },
      el('optgroup', { label: 'Giocatore' }, pgs.map((p) => el('option', { value: 'pg:' + p.id, text: p.name + (usati.has(p.id) ? ' (già assegnato)' : ''), selected: attuale ? attuale === 'pg:' + p.id : p.id === pre }))),
      el('optgroup', { label: 'Spettatore (sola vista)' }, el('option', { value: 'sp:', text: 'Spettatore: come il tavolo (ciò che tutti sanno)', selected: attuale === 'sp:' || (!attuale && !pre) }),
        pgs.map((p) => el('option', { value: 'sp:' + p.id, text: 'Spettatore: come ' + p.name, selected: attuale === 'sp:' + p.id }))));
  }
  const leggiScelta = (v) => (v.startsWith('sp:') ? { spettatore: true, come: v.slice(3) || null } : { spettatore: false, personaggioId: v.slice(3) || null });
  function richiestaDialog(r) {
    suona('online-richiesta');
    const pgs = personaggi();
    const usati = new Set(master.s.giocatori().filter((g) => g.stato === 'attivo').map((g) => g.personaggioId).filter(Boolean));
    const pre = r.rientro ? r.rientro.personaggioId : (pgs.find((p) => !usati.has(p.id) && p.sheet && p.sheet.playerName && p.sheet.playerName.trim().toLowerCase() === r.nome.toLowerCase()) || {}).id;
    const attuale = r.rientro ? (r.rientro.spettatore ? 'sp:' + (r.rientro.come || '') : r.rientro.personaggioId ? 'pg:' + r.rientro.personaggioId : '') : '';
    const sel = sceltaPersonaggio(pgs, usati, pre, attuale);
    let risposto = false;
    const d = openDialog('Richiesta di ingresso', el('div', { class: 'form' },
      el('p', {}, pallino(r.colore), ' ', el('b', { text: r.nome }), ' vuole entrare nella sessione.'),
      r.rientro ? el('p', { class: 'small', text: r.rientro.gettone ? '🔑 Rientro con il gettone: riprende lo stesso posto e lo stesso personaggio.' : '↩ Rientro: stesso nome di un giocatore caduto. Accettando riprende il suo posto.' }) : null,
      r.pieno ? el('p', { class: 'small warning-text', text: 'Ci sono già ' + NET().sessione.MAX_GIOCATORI + ' giocatori: può entrare solo come spettatore.' }) : null,
      field('Personaggio (potrà agire solo con lui) o spettatore', sel)), [
      { text: 'Rifiuta', class: 'danger', onclick: () => { risposto = true; r.rifiuta(); } },
      { text: 'Accetta', class: 'primary', onclick: () => { risposto = true; r.accetta(leggiScelta(sel.value)); } },
    ]);
    d.addEventListener('close', () => { if (!risposto) r.rifiuta('Il master ha chiuso la richiesta.'); });
  }

  // Permessi: per tutti (id null) o per un giocatore (con «Come tutti»).
  function permessiDialog(id) {
    const g = id ? master.s.giocatori().find((x) => x.id === id) : null;
    const p = master.s.permessi(id);
    const inputs = {};
    const righe = Object.entries(I().PERMESSI_NOMI).map(([k, nome]) => {
      if (k === 'muovi') {
        inputs[k] = el('select', { 'aria-label': nome }, [['turno', 'solo nel proprio turno'], ['sempre', 'sempre'], ['mai', 'mai']].map(([v, t]) => el('option', { value: v, text: t, selected: p.muovi === v })));
        return el('label', { class: 'inline small' }, nome + ' ', inputs[k]);
      }
      inputs[k] = el('input', { type: 'checkbox', checked: p[k] });
      return el('label', { class: 'check small' }, inputs[k], ' ' + nome);
    });
    const leggiP = () => Object.fromEntries(Object.entries(inputs).map(([k, x]) => [k, k === 'muovi' ? x.value : x.checked]));
    openDialog(g ? 'Permessi di ' + g.nome : 'Permessi per tutti', el('div', { class: 'form online-perms' }, ...righe,
      el('p', { class: 'muted small', text: 'Spenta la conferma manuale, il master convalida in automatico ciò che rispetta le regole. Le reazioni passano sempre dal master.' })), [
      g ? { text: 'Come tutti', onclick: () => { master.s.impostaPermessi(id, null); toast('Permessi di ' + g.nome + ': come tutti.'); } } : null,
      { text: 'Annulla' },
      { text: 'Salva', class: 'primary', onclick: () => { master.s.impostaPermessi(id, leggiP()); aggiornaPannello(true); toast('Permessi aggiornati.', 'success'); } },
    ].filter(Boolean));
  }
  // Tiro salvezza richiesto a un giocatore: lui preme «Tira», i dadi li tira il master.
  function tiroDialog(g) {
    const car = el('select', { 'aria-label': 'Caratteristica' }, DnD.regole.ABILITIES.map((a) => el('option', { value: a, text: DnD.regole.ABILITY_NAMES[a], selected: a === 'DES' })));
    const cd = DnD.ui.numberInput(14, { min: 1, max: 40, 'aria-label': 'Classe Difficoltà' });
    const modo = el('select', { 'aria-label': 'Tiro' }, [['normale', 'Normale'], ['vantaggio', 'Vantaggio'], ['svantaggio', 'Svantaggio']].map(([v, t]) => el('option', { value: v, text: t })));
    const testo = textInput('', { maxlength: 120, placeholder: 'es. trappola a dardi', 'aria-label': 'Motivo' });
    openDialog('Tiro salvezza per ' + g.nome, el('div', { class: 'form' }, field('Caratteristica', car), field('CD (vuota = senza CD)', cd), field('Tiro', modo), field('Motivo', testo),
      el('p', { class: 'muted small', text: 'Nel combattimento valgono anche le condizioni (svantaggio, fallimento automatico).' })), [
      { text: 'Annulla' },
      { text: 'Chiedi il tiro', class: 'primary', onclick: () => {
        const v = cd.value.trim() === '' ? null : Number(cd.value);
        master.s.richiediTiro(g.id, { caratteristica: car.value, cd: Number.isInteger(v) ? v : null, modo: modo.value, testo: testo.value.trim() });
        toast('Richiesta di tiro mandata a ' + g.nome + '.');
      } },
    ]);
  }
  // Modifica prima di approvare: modo, bersaglio (attacco) o slot (incantesimo).
  function modificaDialog(q) {
    const c = DnD.sessioni.current(DnD.store.state).combat;
    const campi = [];
    const modo = el('select', { 'aria-label': 'Tiro' }, ['normale', 'vantaggio', 'svantaggio'].map((v) => el('option', { value: v, text: v, selected: q.dati.modo === v })));
    if (q.dati.modo) campi.push(field('Tiro', modo));
    let bers = null;
    if (q.tipo === 'attacca' && c) { bers = el('select', { 'aria-label': 'Bersaglio' }, c.combatants.map((x) => el('option', { value: x.id, text: x.name, selected: x.id === q.dati.bersaglioId }))); campi.push(field('Bersaglio', bers)); }
    let slot = null;
    if (q.tipo === 'lancia') { slot = DnD.ui.numberInput(q.dati.slot, { min: 0, max: 9, 'aria-label': 'Slot' }); campi.push(field('Livello dello slot', slot)); }
    openDialog('Modifica e approva', el('div', { class: 'form' }, el('p', { text: q.descrizione }), ...campi), [
      { text: 'Annulla' },
      { text: 'Approva con le modifiche', class: 'primary', onclick: () => {
        const m = {};
        if (q.dati.modo) m.modo = modo.value;
        if (bers) m.bersaglioId = bers.value;
        if (slot) m.slot = Number(slot.value) || 0;
        master.s.approva(q.id, m);
        aggiornaPannello(true);
      } },
    ]);
  }
  // Rivelazione: titolo, testo e immagine facoltativa, mandati solo ora.
  function rivelaDialog() {
    const titolo = textInput('', { maxlength: 100, 'aria-label': 'Titolo' });
    const testo = el('textarea', { rows: 6, maxlength: NET().protocollo.LIMITI.rivelazione, 'aria-label': 'Testo' });
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Immagine' });
    const dest = el('select', { 'aria-label': 'Destinatari' }, el('option', { value: '', text: 'A tutti' }), master.s.giocatori().filter((g) => g.stato === 'attivo').map((g) => el('option', { value: g.id, text: 'Solo a ' + g.nome })));
    openDialog('Rivela ai giocatori', el('div', { class: 'form' }, field('Titolo', titolo), field('Testo', testo), field('Immagine (facoltativa, massimo 3 MB)', file), field('A chi', dest)), [
      { text: 'Annulla' },
      { text: 'Rivela', class: 'primary', onclick: () => {
        const manda = (immagine) => { master.s.rivela({ titolo: titolo.value.trim(), testo: testo.value, immagine }, dest.value || null); toast('Rivelato.', 'success'); };
        const f = file.files[0];
        if (!f) { manda(null); return undefined; }
        if (f.size > NET().protocollo.LIMITI.immagineRivelata * 0.74) { toast('Immagine troppo grande (massimo circa 2 MB).', 'error'); return false; }
        const r = new FileReader();
        r.onload = () => manda(r.result);
        r.readAsDataURL(f);
        return undefined;
      } },
    ]);
  }

  // ---------- Strumenti del master della tappa 3 ----------
  // «Vedi come giocatore»: ciò che il client ha ricevuto davvero (gli stessi dati inviati) e, evidenziato, ciò che no.
  function vediComeDialog(idIniziale) {
    const dest = el('select', { 'aria-label': 'Vedi come' }, el('option', { value: '', text: 'Il tavolo (ciò che tutti sanno)' }),
      master.s.giocatori().filter((g) => g.stato === 'attivo').map((g) => el('option', { value: g.id, text: g.nome + (g.spettatore ? ' (spettatore)' : ''), selected: g.id === idIniziale })));
    const out = el('div', { class: 'online-seeas' });
    const voce = (t) => el('li', { text: t });
    const disegna = () => {
      const r = master.s.vediCome(dest.value || null);
      const v = r.vista || {};
      const c = v.combattimento;
      const e = v.esplorazione;
      const m = v.mondo;
      const riceve = [];
      if (v.scheda) riceve.push('Scheda: ' + v.scheda.nome + ' (' + v.scheda.pf + '/' + v.scheda.pfMax + ' PF)');
      if (c) riceve.push('Combattimento: round ' + c.round + ', pedine ' + c.pedine.map((p) => p.nome + ' (' + (Number.isFinite(p.pf) ? p.pf + ' PF' : p.salute) + ')').join(', '),
        'Mappa: ' + c.griglia.items.length + ' oggetti, ' + (c.griglia.cells.match(/[12]/g) || []).length + ' celle note su ' + c.griglia.cells.length, 'Log: ' + c.log.length + ' righe');
      if (c && c.boss.length) riceve.push('Boss rivelati: ' + c.boss.map((b) => b.nome + ' — ' + b.titolo).join(', '));
      if (e) riceve.push('Esplorazione: giorno ' + e.tempo.giorno + ', ' + (e.griglia.cells.match(/[12]/g) || []).length + ' celle scoperte, bioma ' + (e.bioma ? e.bioma.nome : '—'));
      if ((v.scene || []).length) riceve.push('Scene rivelate: ' + v.scene.map((x) => x.titolo).join(', '));
      if (m) riceve.push('NPC incontrati: ' + (m.npc.map((n) => n.nome + (n.negozio.length ? ' 🛒' : '')).join(', ') || '—'), 'Quest: ' + (m.quest.map((q) => q.titolo).join(', ') || '—'),
        'Fazioni note: ' + (m.fazioni.map((f) => f.nome).join(', ') || '—') + (m.reputazioni.length ? ' (con le reputazioni)' : ''));
      fill(out,
        el('h3', { text: '✔ Riceve' }), el('ul', { class: 'small' }, riceve.map(voce)),
        el('h3', { text: '✖ Non riceve' }), el('ul', { class: 'small online-manca' }, r.manca.length ? r.manca.map((x) => el('li', {}, el('b', { text: x.sezione + ': ' }), x.testo)) : [voce('—')]),
        el('details', {}, el('summary', { class: 'small', text: 'Dati inviati (grezzi)' }), el('pre', { class: 'small player-view', text: JSON.stringify(v, null, 1).slice(0, 20000) })));
    };
    dest.addEventListener('change', disegna);
    disegna();
    openDialog('Vedi come giocatore', el('div', { class: 'form' }, field('Vista di', dest), out), [{ text: 'Chiudi', class: 'primary' }]);
  }
  // NPC piazzati sulle mappe della sessione (combattimento ed esplorazione), con il loro modello del Mondo.
  function npcPiazzati() {
    const st = DnD.store.state;
    const se = DnD.sessioni.current(st);
    const v = DnD.fazioni.view(st, se.id);
    const grids = [se.combat && se.combat.grid, se.exploration && (st.savedGrids || []).find((g) => g.id === se.exploration.gridId)].filter(Boolean);
    return grids.flatMap((g) => (g.items || []).filter((it) => it.otype === 'npc')).map((it) => ({ it, def: v.npcs.find((n) => n.id === it.npcId) || null })).filter((x) => x.def);
  }
  // Mondo rivelato: città visitate, NPC incontrati, negozi aperti, fazioni conosciute.
  function mondoDialog() {
    const st = DnD.store.state;
    const v = DnD.fazioni.view(st, DnD.sessioni.current(st).id);
    const riv = master.s.rivelati();
    const ha = (k, id) => (riv[k] || []).includes(id);
    const casella = (k, id, testo) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: ha(k, id), onchange: (e) => master.s.rivelaMondo(k, id, e.target.checked) }), ' ' + testo);
    const npc = npcPiazzati();
    openDialog('Mondo per i giocatori', el('div', { class: 'form online-world' },
      el('p', { class: 'muted small', text: 'I giocatori vedono solo ciò che spunti qui (oltre agli NPC che hanno davanti e alle quest accettate). Atteggiamenti segreti, ruoli nascosti, dialoghi e note non partono mai.' }),
      el('h3', { text: 'Città visitate' }), v.cities.length ? v.cities.map((c) => casella('citta', c.id, c.name)) : el('p', { class: 'muted small', text: 'Nessuna città.' }),
      el('h3', { text: 'NPC sulle mappe' }), npc.length ? npc.map((x) => el('div', { class: 'online-row' }, casella('npc', x.it.id, x.it.name + ' (incontrato)'),
        x.def.roles.includes('mercante') ? casella('negozi', x.it.id, '🛒 negozio aperto') : null)) : el('p', { class: 'muted small', text: 'Nessun NPC piazzato.' }),
      el('h3', { text: 'Fazioni conosciute' }), v.factions.filter((f) => !f.builtin).map((f) => casella('fazioni', f.id, f.name))), [{ text: 'Chiudi', class: 'primary' }]);
  }
  // Dialogo di un NPC mostrato ai giocatori: il master sceglie il nodo; «Il giocatore sceglie» manda anche le risposte.
  function dialogoDialog() {
    const npc = npcPiazzati().filter((x) => x.def.dialog && x.def.dialog.nodes.length);
    if (!npc.length) { toast('Nessun NPC con un dialogo sulle mappe della sessione.', 'error'); return; }
    const chi = el('select', { 'aria-label': 'NPC' }, npc.map((x, i) => el('option', { value: String(i), text: x.it.name })));
    const nodo = el('select', { 'aria-label': 'Nodo' });
    const anteprima = el('div', { class: 'small' });
    const scelta = el('input', { type: 'checkbox' });
    const dest = el('select', { 'aria-label': 'A chi' }, el('option', { value: '', text: 'A tutti' }), master.s.giocatori().filter((g) => g.stato === 'attivo' && !g.spettatore).map((g) => el('option', { value: g.id, text: 'Solo a ' + g.nome })));
    const corrente = () => { const x = npc[Number(chi.value)]; return { x, n: x.def.dialog.nodes.find((y) => y.id === nodo.value) || x.def.dialog.nodes[0] }; };
    const nodi = () => { const x = npc[Number(chi.value)]; fill(nodo, x.def.dialog.nodes.map((n) => el('option', { value: n.id, text: n.title || n.text.slice(0, 40), selected: n.id === x.def.dialog.start }))); vedi(); };
    const vedi = () => { const { n } = corrente(); fill(anteprima, el('p', { text: n.text }), el('ul', {}, n.answers.map((a) => el('li', { text: a.text })))); };
    chi.addEventListener('change', nodi);
    nodo.addEventListener('change', vedi);
    nodi();
    openDialog('Mostra un dialogo', el('div', { class: 'form' }, field('NPC', chi), field('Nodo', nodo), anteprima,
      el('label', { class: 'check small' }, scelta, ' Il giocatore sceglie la risposta (altrimenti la sceglie il master)'), field('A chi', dest),
      el('p', { class: 'muted small', text: 'Parte solo il testo del nodo e delle risposte: mai condizioni, esiti o note.' })), [
      { text: 'Annulla' },
      { text: 'Mostra ai giocatori', class: 'primary', onclick: () => {
        const { x, n } = corrente();
        const nome = x.it.npcState && x.it.npcState.revealed && x.it.npcState.revealed.name === false ? 'Sconosciuto' : x.it.name;
        const risposte = n.answers.map((a) => ({ id: a.id, testo: a.text }));
        const id = master.s.mostraDialogo({ npc: nome, testo: n.text, risposte, scelta: scelta.checked }, dest.value || null);
        master.dialogo = { id, risposte };
        toast('Dialogo mostrato.', 'success');
      } },
    ]);
  }
  // Scena ai giocatori: la segna come rivelata e manda subito il testo da leggere (finestra chiudibile).
  function scenaDialog() {
    const st = DnD.store.state;
    const scene = DnD.scene.sessionScenes(st, DnD.sessioni.current(st).id);
    if (!scene.length) { toast('Nessuna scena in questa sessione.', 'error'); return; }
    const sel = el('select', { 'aria-label': 'Scena' }, scene.map((s) => el('option', { value: s.id, text: s.title + (s.revealed ? ' (già rivelata)' : '') })));
    openDialog('Mostra una scena ai giocatori', el('div', { class: 'form' }, field('Scena', sel),
      el('p', { class: 'muted small', text: 'Parte solo il titolo e il testo da leggere; note, incontri, tesori e collegamenti restano al master.' })), [
      { text: 'Annulla' },
      { text: 'Mostra ai giocatori', class: 'primary', onclick: () => {
        const sc = scene.find((s) => s.id === sel.value);
        DnD.store.update((s2) => { const x = (s2.scenes || []).find((y) => y.id === sc.id); if (x) x.revealed = true; });
        master.s.rivela({ titolo: sc.title, testo: DnD.note.htmlToText(sc.readAloud || '').trim().slice(0, NET().protocollo.LIMITI.rivelazione), immagine: null }, null);
        toast('Scena mostrata ai giocatori.', 'success');
      } },
    ]);
  }
  function scaricaRegistro() {
    if (!master) return;
    DnD.uiImpostazioni.download(['Sessione online (master) — ' + new Date().toLocaleString('it-IT'), ''].concat(master.s.registroCompleto()).join('\n'), 'sessione-online-master-' + DnD.uiImpostazioni.today() + '.txt', 'text/plain');
  }

  // Pannello del master: barra in basso a sinistra, si apre con giocatori, interruttori, richieste e chat.
  function pannello(aperto) {
    if (!master) return;
    if (!master.dom) {
      const m = master.dom = {};
      m.head = el('button', { type: 'button', class: 'online-head', 'aria-expanded': 'false', onclick: () => pannello(!m.root.classList.contains('open')) });
      m.righe = el('ul', { class: 'online-players' });
      m.coda = el('div', { class: 'online-queue' });
      m.registro = el('ol', { class: 'online-log small' });
      m.pf = el('input', { type: 'checkbox', onchange: () => { master.s.impostaPfNemici(m.pf.checked); master.s.aggiorna(); } });
      m.pausa = el('input', { type: 'checkbox', onchange: () => { master.s.impostaPausa(m.pausa.checked); toast(m.pausa.checked ? 'Gioco in pausa: le richieste dei giocatori sono bloccate.' : 'Pausa finita.'); } });
      m.convalidati = el('input', { type: 'checkbox', checked: true, onchange: () => master.s.impostaConvalidati(m.convalidati.checked) });
      m.schede = el('input', { type: 'checkbox', checked: true, onchange: () => master.s.impostaVisibilita({ schedeAltri: m.schede.checked }) });
      m.rep = el('input', { type: 'checkbox', onchange: () => master.s.impostaVisibilita({ mostraReputazioni: m.rep.checked }) });
      m.chiusa = el('input', { type: 'checkbox', onchange: () => { master.s.chiudiIngressi(m.chiusa.checked); toast(m.chiusa.checked ? 'Nuovi ingressi chiusi: entra solo chi rientra con il gettone.' : 'Ingressi aperti.'); } });
      m.lavoro = el('input', { type: 'checkbox', onchange: () => master.s.lavoro(m.lavoro.checked) });
      m.soglia = DnD.ui.numberInput(master.s.soglia(), { min: 1, max: 100, class: 'qty', 'aria-label': 'Soglia di espulsione', onchange: () => master.s.impostaSoglia(Number(m.soglia.value)) });
      m.invita = el('button', { type: 'button', class: 'btn small primary', text: '➕ Invita un giocatore', onclick: nuovoInvito });
      m.chat = chatBox({
        destinatari: () => [['', 'A tutti']].concat(master ? master.s.giocatori().filter((g) => g.stato === 'attivo').map((g) => [g.id, 'Solo a ' + g.nome]) : []),
        invia: (testo, a) => {
          const msg = master && master.s.chat(testo, a || null);
          if (!msg) return null;
          const g = a ? master.s.giocatori().find((x) => x.id === a) : null;
          return Object.assign(msg, { a: g ? g.nome : '' });
        },
        scrive: () => master && master.s.scrive(),
      });
      m.body = el('div', { class: 'online-body' },
        m.righe,
        el('div', { class: 'online-actions' }, m.invita,
          el('label', { class: 'check small', title: 'Blocca tutte le richieste dei giocatori (utile per discutere)' }, m.pausa, ' ⏸ Pausa'),
          el('label', { class: 'check small', title: 'I tiri liberi dei giocatori li tira il master. Spento: si accetta il tiro del giocatore, segnato come non verificato' }, m.convalidati, ' Tiri convalidati'),
          el('label', { class: 'check small', title: 'Di base i giocatori vedono solo «illeso / ferito / grave / a terra»' }, m.pf, ' PF dei nemici'),
          el('label', { class: 'check small', title: 'Nome, classe, livello, salute, CA e condizioni dei compagni' }, m.schede, ' Schede degli altri'),
          el('label', { class: 'check small', title: 'Reputazione del party con le fazioni che conosce' }, m.rep, ' Reputazioni'),
          el('label', { class: 'check small', title: 'Entra solo chi rientra con il gettone' }, m.chiusa, ' 🚪 Chiudi nuovi ingressi'),
          el('label', { class: 'check small', title: 'I giocatori vedono «Il master sta preparando la scena…»' }, m.lavoro, ' 🛠 Sto preparando')),
        el('div', { class: 'online-actions' },
          btn('🔐 Permessi…', () => permessiDialog(null)), btn('👁 Vedi come…', () => vediComeDialog(null)), btn('📜 Rivela…', rivelaDialog),
          btn('🎬 Scena…', scenaDialog), btn('🌍 Mondo…', mondoDialog), btn('🗨 Dialogo…', dialogoDialog)),
        el('div', { class: 'online-actions' },
          btn('🩺 Test connessione', testConnessione), btn('⬇ Log completo', scaricaRegistro), el('button', { type: 'button', class: 'btn small danger', text: '⏹ Termina sessione', onclick: terminaMaster })),
        m.coda,
        el('details', { class: 'online-security' }, el('summary', { text: 'Registro di sicurezza' }),
          el('label', { class: 'inline small' }, 'Espelli dopo ', m.soglia, ' violazioni gravi'), m.registro),
        m.chat.node);
      m.root = el('aside', { class: 'online-panel', 'aria-label': 'Sessione online' }, m.head, m.body);
      document.body.append(m.root);
    }
    master.dom.root.classList.toggle('open', Boolean(aperto));
    master.dom.head.setAttribute('aria-expanded', String(Boolean(aperto)));
    aggiornaPannello(true);
  }
  function aggiornaPannello(forza) {
    if (!master || !master.dom) return;
    const m = master.dom;
    const lista = master.s.giocatori().filter((g) => g.stato !== 'attesa');
    const attivi = lista.filter((g) => g.stato === 'attivo');
    const coda = master.s.coda();
    const peggiore = attivi.some((g) => g.linea === 'rosso') ? 'rosso' : attivi.some((g) => g.linea === 'giallo') ? 'giallo' : attivi.length ? 'verde' : 'grigio';
    const nSpett = attivi.filter((g) => g.spettatore).length;
    fill(m.head, lineaDot(peggiore), ' 🌐 Online · ' + (attivi.length - nSpett) + (attivi.length - nSpett === 1 ? ' giocatore' : ' giocatori') + (nSpett ? ' + ' + nSpett + ' spett.' : ''),
      master.s.ingressiChiusi() ? el('span', { class: 'tag small', text: '🚪 chiusa' }) : null,
      coda.length + master.domande.length ? el('span', { class: 'badge', text: String(coda.length + master.domande.length) }) : null,
      master.s.pausa() ? el('span', { class: 'tag small', text: '⏸ pausa' }) : null,
      el('span', { class: 'muted small', text: m.root.classList.contains('open') ? ' ▾' : ' ▴' }));
    m.invita.disabled = master.s.ingressiChiusi();
    if (!m.root.classList.contains('open')) return;
    // Le righe si ricostruiscono solo se cambia qualcosa di strutturale (così i menù aperti non si chiudono).
    const firma = JSON.stringify(lista.map((g) => [g.id, g.nome, g.stato, g.personaggioId, g.gettone, g.salta, Boolean(g.permessi), g.spettatore, g.come]));
    if (firma !== m.firma || forza) {
      m.firma = firma;
      const pgs = personaggi();
      fill(m.righe, lista.length ? lista.map((g) => el('li', { 'data-id': g.id },
        el('div', { class: 'online-row' },
          el('span', { class: 'online-dot-slot' }), pallino(g.colore), el('b', { text: g.nome }),
          g.stato === 'disconnesso' ? el('span', { class: 'tag small', text: g.assente ? 'assente' : 'disconnesso' }) : null,
          g.spettatore ? el('span', { class: 'tag small', text: '👁 spettatore' }) : null,
          g.permessi ? el('span', { class: 'tag small', title: 'Permessi personalizzati', text: '🔐' }) : null,
          g.violazioni ? el('span', { class: 'tag small danger', title: 'Violazioni gravi', text: '⚠ ' + g.violazioni }) : null,
          el('span', { class: 'online-lat small muted' })),
        g.stato === 'attivo' ? el('div', { class: 'online-row' },
          (() => {
            const s = sceltaPersonaggio(pgs, new Set(), null, g.spettatore ? 'sp:' + (g.come || '') : g.personaggioId ? 'pg:' + g.personaggioId : 'sp:');
            s.classList.add('small');
            s.setAttribute('aria-label', 'Personaggio di ' + g.nome);
            s.addEventListener('change', () => {
              const x = leggiScelta(s.value);
              if (x.spettatore) master.s.impostaSpettatore(g.id, true, x.come);
              else { master.s.impostaSpettatore(g.id, false, null); master.s.assegna(g.id, x.personaggioId); }
              aggiornaPannello(true);
            });
            return s;
          })(),
          btn('👁', () => vediComeDialog(g.id), { title: 'Vedi come ' + g.nome, 'aria-label': 'Vedi come ' + g.nome }),
          btn('🎯 Salvezza…', () => tiroDialog(g), { title: 'Chiedi un tiro salvezza' }),
          btn('📣', () => { master.s.richiama(g.id); toast('«Tocca a te!» mandato a ' + g.nome + '.'); }, { title: 'Evidenzia: «Tocca a te!»', 'aria-label': 'Richiama ' + g.nome }),
          btn('🔐', () => permessiDialog(g.id), { title: 'Permessi di ' + g.nome, 'aria-label': 'Permessi di ' + g.nome }),
          btn('📡', () => master.s.eco(g.id), { title: 'Prova di eco', 'aria-label': 'Eco con ' + g.nome }),
          g.gettone ? btn('🔑', () => { if (confirm('Revocare il gettone di rientro di ' + g.nome + '? Rientrando sarà un giocatore nuovo.')) { master.s.revocaGettone(g.id); aggiornaPannello(true); } }, { title: 'Revoca il gettone di rientro', 'aria-label': 'Revoca il gettone di ' + g.nome }) : null,
          el('button', { type: 'button', class: 'btn small danger', text: 'Espelli', onclick: () => { if (confirm('Espellere ' + g.nome + ' dalla sessione?')) master.s.espelli(g.id); } }))
          : el('div', { class: 'online-row' },
            g.assente ? el('select', { class: 'small', 'aria-label': 'Personaggio assente', onchange: (e) => master.s.assente(g.personaggioId, e.target.value) },
              [['manuale', 'Assente: lo muovi tu'], ['ia', 'Assente: controllo automatico'], ['salta', 'Assente: salta i suoi turni']].map(([v, t]) => el('option', { value: v, text: t, selected: v === (g.salta ? 'salta' : 'manuale') }))) : null,
            el('button', { type: 'button', class: 'btn small', text: 'Dimentica', onclick: () => master.s.espelli(g.id) })))) : [el('li', { class: 'muted small', text: 'Nessun giocatore: premi «Invita un giocatore».' })]);
      // Richieste in attesa (conferma manuale) e domande al master.
      fill(m.coda,
        coda.length ? el('h3', { text: 'Richieste in attesa (' + coda.length + ')' }) : null,
        coda.map((q) => el('div', { class: 'online-request' },
          el('p', { class: 'small' }, el('b', { text: q.nome + ': ' }), q.descrizione),
          el('div', { class: 'online-actions' },
            btn('✔ Approva', () => { master.s.approva(q.id); aggiornaPannello(true); }, { class: 'btn small primary' }),
            ['attacca', 'lancia', 'usaAzione'].includes(q.tipo) ? btn('✎ Modifica…', () => modificaDialog(q)) : null,
            btn('✖ Rifiuta', () => { master.s.rifiuta(q.id, (prompt('Motivo (facoltativo):') || '').trim()); aggiornaPannello(true); }, { class: 'btn small danger' })))),
        master.domande.length ? el('h3', { text: 'Domande' }) : null,
        master.domande.map((d, i) => {
          const r = textInput('', { maxlength: 300, placeholder: 'Risposta', 'aria-label': 'Risposta a ' + d.nome });
          return el('form', { class: 'online-request', onsubmit: (e) => {
            e.preventDefault();
            const m2 = master.s.rispondiDomanda(d.giocatoreId, r.value);
            if (m2) aggiungiFeed(Object.assign(m2, { a: d.nome }));
            master.domande.splice(i, 1);
            aggiornaPannello(true);
          } }, el('p', { class: 'small' }, el('b', { text: d.nome + ' chiede: ' }), d.testo), el('div', { class: 'online-actions' }, r,
            el('button', { type: 'submit', class: 'btn small primary', text: 'Rispondi' }),
            btn('Ignora', () => { master.domande.splice(i, 1); aggiornaPannello(true); })));
        }));
      fill(m.registro, master.s.registro().slice(-30).reverse().map((v) => el('li', { class: v.grave ? 'grave' : '' }, oraTesto(v.ora) + ' ' + v.nome + ' · ' + v.tipo + ': ' + v.testo)));
    }
    for (const g of lista) {
      const li = m.righe.querySelector('[data-id="' + g.id + '"]');
      if (!li) continue;
      fill(li.querySelector('.online-dot-slot'), lineaDot(g.stato === 'attivo' ? g.linea : 'grigio'));
      li.querySelector('.online-lat').textContent = g.stato !== 'attivo' ? '' : ' ' + (g.latenza !== null ? g.latenza + ' ms' : '…') + (g.eco !== null ? ' · eco ' + g.eco + ' ms' : '') +
        (g.coda ? ' · in coda ' + g.coda : '') + (g.scaricando ? ' · ⬇ sta scaricando la mappa' : '');
    }
    m.chat.refresh();
  }
  function terminaMaster() {
    if (!master || !confirm('Terminare la sessione online? I giocatori verranno scollegati.')) return;
    master.s.termina();
    scrivi(RIPRESA, null);

    clearInterval(master.timer);
    clearTimeout(master.attesa);
    DnD.store.onChange = null;
    chatBoxes.delete(master.dom.chat);
    master.dom.root.remove();
    master = null;
    feed.length = 0;
    toast('Sessione online terminata.');
  }

  // ---------- Giocatore ----------
  // suTrasporto: per il rientro (stesso giocatore, nuovo scambio di codici); di base si entra come giocatore nuovo.
  function unisciti(q, suTrasporto) {
    const invito = el('textarea', { class: 'code-box', rows: 4, spellcheck: false, placeholder: 'Incolla qui il codice di invito del master', 'aria-label': 'Codice di invito' });
    const out = el('div');
    const stato = el('p', { class: 'small', 'aria-live': 'polite' });
    let tentativo = null;
    let fatto = false;
    const crea = el('button', { type: 'button', class: 'btn primary', text: 'Crea la risposta', onclick: async () => {
      crea.disabled = true;
      stato.className = 'small';
      stato.textContent = 'Leggo l\'invito e preparo la risposta (qualche secondo)…';
      try {
        tentativo = await NET().segnalazione.manuale.unisciti(invito.value, { comprimi: q.comprimi, maxRicevuto: NET().protocollo.LIMITI.daMaster });
      } catch (e) {
        stato.className = 'small error-text';
        stato.textContent = e.message;
        crea.disabled = false;
        return;
      }
      invito.readOnly = true;
      fill(out, el('p', {}, el('b', { text: '2. ' }), 'Manda questo codice di risposta a ' + (tentativo.master || 'il master') + '. Quando lo incolla, il collegamento parte da solo.'),
        campoCodice(tentativo.codice));
      stato.textContent = '⏳ In attesa del master…';
      tentativo.connessione.then((t) => { fatto = true; d.dismiss(); if (suTrasporto) suTrasporto(t); else entraComeGiocatore(q, t, tentativo.master); })
        .catch((e) => { stato.className = 'small error-text'; stato.textContent = e.message; });
    } });
    const d = openDialog(suTrasporto ? 'Rientra nella sessione' : 'Unisciti a una sessione', el('div', { class: 'form online-codes' },
      suTrasporto ? el('p', { class: 'small', text: '🔑 Con il gettone salvato riprendi lo stesso personaggio: chiedi al master un nuovo invito.' }) : null,
      el('p', {}, el('b', { text: '1. ' }), 'Incolla il codice di invito che ti ha mandato il master.'), invito,
      el('div', { class: 'form-actions' }, crea), out, stato));
    d.addEventListener('close', () => { if (tentativo && !fatto) tentativo.annulla(); });
    invito.focus();
  }

  function entraComeGiocatore(q, t, nomeMaster) {
    // Gettone di rientro salvato nel browser (solo per lo stesso master).
    const salvato = leggi(GETTONE, null);
    const gettone = salvato && salvato.master === nomeMaster && typeof salvato.gettone === 'string' ? salvato.gettone : '';
    gioc = { q, dom: null, grid: null, doc: null, tsIndex: {}, icone: new Map(), finita: false, richieste: new Map(), esiti: [], anim: new Map(), ultimePos: new Map(), turnoPrima: null };
    gioc.chat = chatBox({
      destinatari: () => [['', 'A tutti'], ['master', 'Solo al master']],
      invia: (testo, a) => (gioc && !gioc.finita ? gioc.s.chat(testo, a === 'master') : null),
      scrive: () => gioc && gioc.s.scrive(),
      // Comandi rapidi: «/tira 2d6+3» (tiro del master), «/tirap 1d20» (privato al master).
      comandi: (testo, a) => {
        const m = /^\/(tira|tirap)\s+(.+)$/i.exec(testo.trim());
        if (!m) return false;
        const p = DnD.dadi.parseExpr(m[2]);
        if (!p || !p.count) { toast('Espressione non valida: usa per esempio /tira 2d6+3.', 'error'); return true; }
        chiedi('tira', { tipo: 'espr', espr: DnD.dadi.formatExpr(p.count, p.sides, p.modifier), privato: m[1].toLowerCase() === 'tirap' || a === 'master' }, 'Tiro ' + m[2]);
        return true;
      },
    });
    gioc.s = NET().sessione.giocatore({
      nome: q.nome, colore: q.colore, trasporto: t, gettone,
      suCambio: () => renderGiocatore(),
      suChat: (m) => { aggiungiFeed(m); suona('online-chat'); },
      suDado: (m) => dadoRicevuto(m, false),
      suFine: (motivo, stato) => fineGiocatore(motivo, stato),
      suErrore: (testo) => toast(testo, 'error'),
      suAvanzamento: avanzamento,
      suGettone: (g, master) => scrivi(GETTONE, { gettone: g, master }),
      suEsito: suEsito,
      suRichiestaTiro: richiestaTiro,
      suPing: aggiungiPing,
      suRivela: mostraRivelazione,
      suOfferta: offerta,
      suRichiamo: (testo) => { suona('turno-giocatore'); toast('📣 ' + testo, 'success'); evidenzia(); },
      suScrive: (nome) => gioc.chat.scrive(nome),
      suPermessi: () => renderGiocatore(),
      suPersa: (motivo) => { suona('online-disconnessione'); toast(motivo + ' Premi «Rientra» quando il master ti manda un nuovo invito.', 'error'); renderGiocatore(); },
      suDialogo: dialogoNpc,
      suLavoro: () => renderGiocatore(),
      archivio: {
        ha: async (id) => { const data = await DnD.immagini.get(id); if (data) gioc.icone.set(id, data); return Boolean(data); },
        metti: async (id, data) => { await DnD.immagini.put(data); gioc.icone.set(id, data); },
      },
    });
    aggancia();
    document.body.classList.add('online-giocatore');
    document.querySelectorAll('dialog[open]').forEach((x) => x.close());
    renderGiocatore();
  }
  // Battito e dadi del menù (con «Tiri convalidati» li tira il master; altrimenti il tiro del giocatore, non verificato).
  function aggancia() {
    clearInterval(gioc.timer);
    gioc.timer = setInterval(() => { if (gioc && !gioc.finita) { gioc.s.battito(); aggiornaLinea(); } }, BATTITO_MS);
    DnD.uiDadi.remoto = (spec) => {
      if (!gioc || gioc.finita || !gioc.s.stato().convalidati) return false;
      chiedi('tira', spec, 'Tiro');
      return true;
    };
    DnD.uiDadi.suTiro = (tiro) => {
      if (!gioc || gioc.finita || gioc.s.stato().convalidati) return;
      gioc.s.dado(tiro);
      aggiungiFeed({ da: gioc.q.nome, colore: gioc.q.colore, testo: tiroTesto(tiro), dado: true, verificato: false });
    };
  }
  // Rientro dopo una caduta o dopo che il master ha riaperto la sessione: nuovo scambio di codici, stesso gettone.
  function rientra() {
    if (!gioc) return;
    unisciti(gioc.q, (t) => {
      if (!gioc) { t.chiudi(); return; }
      gioc.finita = false;
      gioc.dom = null;
      aggancia();
      if (!gioc.s.riconnetti(t)) { t.chiudi(); toast('Non è possibile rientrare da qui: torna all\'app e unisciti di nuovo.', 'error'); return; }
      renderGiocatore();
    });
  }
  // Dialogo di un NPC mostrato dal master (con le risposte se puoi scegliere).
  function dialogoNpc(d) {
    if (!gioc) return;
    gioc.dialoghi = gioc.dialoghi || new Map();
    if (d.chiuso) { const x = gioc.dialoghi.get(d.id); if (x && x.open) x.close(); gioc.dialoghi.delete(d.id); return; }
    suona('online-richiesta');
    let dl = null;
    dl = openDialog('🗨 ' + (d.npc || 'NPC'), el('div', { class: 'online-reveal' }, el('p', { class: 'online-reveal-text', text: d.testo }),
      d.risposte.length ? el('div', { class: 'online-answers' }, d.risposte.map((r) => d.scelta
        ? el('button', { type: 'button', class: 'btn', text: r.testo, onclick: () => { chiedi('rispostaDialogo', { dialogoId: d.id, rispostaId: r.id }, 'Risposta'); dl.close(); } })
        : el('p', { class: 'muted small', text: '• ' + r.testo }))) : null,
      !d.scelta && d.risposte.length ? el('p', { class: 'muted small', text: 'Sceglie il master.' }) : null), [{ text: 'Chiudi' }]);
    gioc.dialoghi.set(d.id, dl);
  }
  // Scambio con un mercante: carrello sulla merce ricevuta; prezzi e verifiche li fa il master.
  function mercanteDialog(n) {
    const sc = gioc.s.stato().vista.scheda;
    const qty = new Map();
    const totale = el('p', { class: 'small', 'aria-live': 'polite' });
    const conto = () => { const t = n.negozio.reduce((s, r) => s + r.prezzo * (qty.get(r.lineId) || 0), 0); totale.textContent = t ? 'Totale indicativo: ' + DnD.npc.formatCopper(t) + ' (lo conferma il master)' : ''; };
    openDialog('🛒 ' + n.nome, el('div', { class: 'form' },
      el('table', { class: 'small online-shop' }, el('tbody', {}, n.negozio.map((r) => el('tr', {}, el('td', { text: r.nome }), el('td', { text: r.testoPrezzo }), el('td', { text: '×' + r.qty }),
        el('td', {}, DnD.ui.numberInput(0, { min: 0, max: r.qty, class: 'qty', 'aria-label': 'Quantità di ' + r.nome, oninput: (e) => { qty.set(r.lineId, Math.max(0, Math.min(r.qty, Number(e.target.value) || 0))); conto(); } })))))),
      totale, sc ? el('p', { class: 'muted small', text: 'Monete: ' + DnD.attrezzatura.formatCoins(sc.monete || {}) }) : null), [
      { text: 'Annulla' },
      { text: 'Compra', class: 'primary', onclick: () => {
        const compra = [...qty].filter(([, q]) => q > 0).map(([lineId, q]) => ({ lineId, qty: q }));
        if (!compra.length) { toast('Carrello vuoto.', 'error'); return false; }
        chiedi('scambio', { npcId: n.id, compra }, 'Acquisto da ' + n.nome);
        return undefined;
      } },
    ]);
  }
  // Mondo e scene del giocatore: quest accettate, NPC incontrati (con il negozio se aperto), città, fazioni, scene.
  function mondoNode(v) {
    const m = v.mondo;
    const out = [];
    if ((v.scene || []).length) out.push(el('details', { class: 'online-scenes' }, el('summary', { text: '🎬 Scene (' + v.scene.length + ')' }),
      v.scene.map((s) => el('div', { class: 'small' }, el('b', { text: s.titolo }), s.testo ? el('p', { class: 'online-reveal-text', text: s.testo }) : null))));
    if (!m) return out;
    out.push(el('details', { class: 'online-quests', open: true }, el('summary', { text: '📜 Diario delle quest (' + m.quest.length + ')' }),
      m.quest.length ? m.quest.map((q) => el('div', { class: 'small' }, el('b', { text: q.titolo }), ' · ' + q.stato,
        el('ul', {}, q.obiettivi.map((o) => el('li', { text: (o.fatto ? '✔ ' : '◻ ') + o.testo + (o.quanti > 1 ? ' (' + o.progresso + '/' + o.quanti + ')' : '') })))))
        : el('p', { class: 'muted small', text: 'Nessuna quest accettata.' })));
    if (m.npc.length) out.push(el('details', {}, el('summary', { text: '🧑 NPC incontrati (' + m.npc.length + ')' }),
      m.npc.map((n) => el('div', { class: 'online-row small' }, DnD.icone.iconCanvas(iconaDi(n.icona), 20), el('b', { text: n.nome }),
        n.ruoli.length ? ' · ' + n.ruoli.join(', ') : '', n.atteggiamento ? ' · ' + n.atteggiamento : '', n.stato ? ' · ' + n.stato : '',
        n.negozio.length && !gioc.s.stato().spettatore ? btn('🛒 Negozio', () => mercanteDialog(n)) : null))));
    if (m.citta.length || m.fazioni.length) out.push(el('details', {}, el('summary', { text: '🗺 Città e fazioni' }),
      m.citta.map((c) => el('div', { class: 'small', text: '🏰 ' + c.nome })),
      m.fazioni.map((f) => { const r = m.reputazioni.find((x) => x.fazioneId === f.id); return el('div', { class: 'small' }, pallino(f.colore), ' ' + f.nome + (r ? ' · reputazione ' + r.valore : '')); })));
    return out;
  }

  // ---------- Richieste (intenzioni) ----------
  // Manda un'intenzione e la mostra «in attesa» finché non arriva l'esito.
  function chiedi(tipo, dati, etichetta) {
    if (!gioc || gioc.finita) return null;
    const id = gioc.s.intenzione(tipo, dati);
    if (!id) { toast('Non sei ancora in gioco.', 'error'); return null; }
    gioc.richieste.set(id, { etichetta: etichetta || tipo, stato: 'invio' });
    aggiornaRichieste();
    return id;
  }
  function suEsito(e) {
    if (!gioc) return;
    const r = gioc.richieste.get(e.id);
    if (e.stato === 'attesa') { if (r) r.stato = 'attesa'; aggiornaRichieste(); return; }
    gioc.richieste.delete(e.id);
    if (e.stato === 'rifiutata') { suona('errore'); toast('✖ ' + e.testo, 'error'); }
    else if (e.stato === 'eseguita' && r && r.etichetta !== 'Tiro') { suona('conferma'); toast((e.avviso ? '⚠ ' + e.avviso + ' ' : '') + (e.testo || 'Fatto.'), e.avviso ? null : 'success'); }
    gioc.esiti.unshift({ ok: e.stato === 'eseguita', testo: (r ? r.etichetta + ': ' : '') + (e.avviso ? e.avviso + ' ' : '') + e.testo });
    gioc.esiti.length = Math.min(gioc.esiti.length, 5);
    aggiornaRichieste();
  }
  function aggiornaRichieste() {
    if (!gioc || !gioc.dom) return;
    fill(gioc.dom.richieste,
      [...gioc.richieste].map(([id, r]) => el('li', { class: 'small' }, '⏳ ' + r.etichetta + (r.stato === 'attesa' ? ' — in attesa del master…' : ' — invio…') + ' ',
        btn('Annulla', () => { gioc.s.annulla(id); }, { 'aria-label': 'Annulla la richiesta ' + r.etichetta }))),
      gioc.esiti.map((x) => el('li', { class: 'small ' + (x.ok ? 'ok' : 'ko'), text: (x.ok ? '✔ ' : '✖ ') + x.testo })));
  }
  function richiestaTiro(r) {
    suona('online-richiesta');
    openDialog('Il master chiede un tiro', el('div', { class: 'form' },
      el('p', {}, el('b', { text: 'Tiro salvezza su ' + (DnD.regole.ABILITY_NAMES[r.caratteristica] || r.caratteristica) }), r.cd ? ' (CD ' + r.cd + ')' : '', r.modo !== 'normale' ? ' con ' + r.modo : ''),
      r.testo ? el('p', { class: 'muted', text: r.testo }) : null,
      el('p', { class: 'muted small', text: 'I dadi li tira il master: vedrai il risultato nel log e nell\'animazione.' })), [
      { text: '🎲 Tira', class: 'primary', onclick: () => { chiedi('salvezza', { richiestaId: r.id }, 'Salvezza ' + r.caratteristica); } },
    ]);
  }
  function offerta(f) {
    suona('online-richiesta');
    let risposto = false;
    const d = openDialog('Offerta di ' + f.da, el('p', {}, el('b', { text: f.da }), ' ti offre ' + f.qty + ' × ' + f.oggetto + '.'), [
      { text: 'Rifiuta', onclick: () => { risposto = true; chiedi('rispostaOfferta', { offertaId: f.id, accetta: false }, 'Offerta'); } },
      { text: 'Accetta', class: 'primary', onclick: () => { risposto = true; chiedi('rispostaOfferta', { offertaId: f.id, accetta: true }, 'Offerta'); } },
    ]);
    d.addEventListener('close', () => { if (!risposto) chiedi('rispostaOfferta', { offertaId: f.id, accetta: false }, 'Offerta'); });
  }
  function mostraRivelazione(r) {
    suona('online-richiesta');
    openDialog(r.titolo || 'Il master ti mostra…', el('div', { class: 'online-reveal' },
      r.immagine ? el('img', { src: r.immagine, alt: r.titolo || 'Immagine rivelata dal master' }) : null,
      r.testo ? el('p', { class: 'online-reveal-text', text: r.testo }) : null), [{ text: 'Chiudi', class: 'primary' }]);
  }
  function evidenzia() {
    if (!gioc || !gioc.dom) return;
    gioc.dom.root.classList.remove('online-flash');
    void gioc.dom.root.offsetWidth;
    gioc.dom.root.classList.add('online-flash');
  }

  // ---------- Vista del giocatore ----------
  // Icona ricevuta: impronta -> immagine dalla cache, altrimenti una forma del colore indicato.
  function iconaDi(ic) {
    const i = ic && typeof ic === 'object' ? ic : {};
    if (i.kind === 'image' && i.imageId) {
      const data = gioc.icone.get(i.imageId);
      return DnD.icone.normalizeIcon(data ? { kind: 'image', image: data, color: i.color } : { kind: 'shape', shape: 'cerchio', color: i.color });
    }
    return DnD.icone.normalizeIcon(i);
  }
  const intero = (v, lo, hi, def) => (Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : def);
  const SALUTE_PF = { illeso: 4, ferito: 3, grave: 1, 'a terra': 0 };
  // Documento per la griglia: griglia ricevuta normalizzata (confine di fiducia) e pedine; chi si è spostato
  // scivola alla nuova cella con una breve animazione (salvo «Riduci animazioni»).
  function documento(c) {
    const g = c.griglia || {};
    let grid;
    try {
      grid = Object.assign(DnD.dati.normalizeGridContent({ w: g.w, h: g.h, feetPerCell: g.feetPerCell, background: g.background, structures: g.structures, items: g.items, labels: g.labels, tileMap: g.tileMap, kind: g.kind }), { ignoreCollisions: false });
    } catch (e) {
      grid = Object.assign(DnD.dati.normalizeGridContent({ w: 10, h: 10 }), { ignoreCollisions: false });
    }
    const ora = performance.now();
    const combatants = (Array.isArray(c.pedine) ? c.pedine : []).filter((p) => p && p.pos).map((p) => {
      const pos = { x: intero(p.pos.x, 0, grid.w - 1, 0), y: intero(p.pos.y, 0, grid.h - 1, 0) };
      const prima = gioc.ultimePos.get(p.id);
      if (prima && (prima.x !== pos.x || prima.y !== pos.y) && lento()) gioc.anim.set(p.id, { da: prima, a: pos, t0: ora });
      gioc.ultimePos.set(p.id, pos);
      return {
        id: String(p.id), name: String(p.nome || ''), icon: iconaDi(p.icona), kind: p.lato === 'giocatore' ? 'player' : 'npc', faction: String(p.fazione || ''), lato: p.lato,
        pos: Object.assign({}, pos), w: intero(p.w, 1, 10, 1), h: intero(p.h, 1, 10, 1),
        hp: Number.isFinite(p.pf) ? p.pf : SALUTE_PF[p.salute] !== undefined ? SALUTE_PF[p.salute] : 4, maxHp: Number.isFinite(p.pfMax) && p.pfMax > 0 ? p.pfMax : 4,
        dead: Boolean(p.morto), conditions: [], concentration: null,
      };
    });
    try { gioc.tsIndex = DnD.tilemap.tilesetIndex((Array.isArray(c.tilesets) ? c.tilesets : []).map((t) => DnD.dati.normalizeTileset(t))); } catch (e) { gioc.tsIndex = {}; }
    const doc = { id: 'online', grid, combatants, currentId: c.turno || null };
    if (gioc.anim.size) requestAnimationFrame(animaPedine);
    return doc;
  }
  function animaPedine() {
    if (!gioc || !gioc.doc || !gioc.anim.size) return;
    const now = performance.now();
    for (const t of gioc.doc.combatants) {
      const a = gioc.anim.get(t.id);
      if (!a) continue;
      const k = Math.min(1, (now - a.t0) / 260);
      t.pos = k < 1 ? { x: a.da.x + (a.a.x - a.da.x) * k, y: a.da.y + (a.a.y - a.da.y) * k } : Object.assign({}, a.a);
      if (k >= 1) gioc.anim.delete(t.id);
    }
    gioc.grid.requestDraw();
    if (gioc.anim.size) requestAnimationFrame(animaPedine);
  }
  // Griglia mostrata: quella del combattimento attivo, altrimenti quella dell'esplorazione.
  function vistaGriglia(v) {
    if (!v) return null;
    if (v.combattimento && v.combattimento.fase === 'attivo') return v.combattimento;
    const e = v.esplorazione;
    return e ? { griglia: e.griglia, tilesets: e.tilesets, turno: null, esplorazione: true,
      pedine: e.gruppi.map((p) => ({ id: p.id, nome: p.nome, icona: p.icona, pos: p.pos, w: 1, h: 1, lato: 'giocatore', salute: 'illeso', fazione: 'giocatori' })) } : null;
  }
  // Nebbia del giocatore (celle sconosciute coperte, esplorate velate) e ping.
  function disegnaSopra(ctx, view, s) {
    const v = gioc && gioc.s.stato().vista;
    const c = vistaGriglia(v);
    const cells = c && typeof c.griglia.cells === 'string' ? c.griglia.cells : '';
    if (cells && /[01]/.test(cells)) {
      const w = gioc.doc.grid.w;
      const fog = getComputedStyle(document.documentElement).getPropertyValue('--vision-fog-player').trim() || '6, 7, 10';
      ctx.save();
      for (let i = 0; i < cells.length && i < w * gioc.doc.grid.h; i++) {
        const st = cells.charCodeAt(i) - 48;
        if (st === 2) continue;
        ctx.fillStyle = 'rgba(' + fog + ',' + (st === 0 ? 1 : 0.55) + ')';
        ctx.fillRect(view.panX + (i % w) * s, view.panY + Math.floor(i / w) * s, s + 0.5, s + 0.5);
      }
      ctx.restore();
    }
    disegnaPing(ctx, view, s);
  }
  // Anteprima del movimento sul client (dati ricevuti: celle visibili, pedine viste, residuo): l'esito lo decide il master.
  function anteprimaMovimento(id) {
    const v = gioc.s.stato().vista;
    const mia = mieAzioni();
    if (!v || !v.combattimento || !mia || id !== mia.p.id || !gioc.doc) return null;
    const mover = gioc.doc.combatants.find((x) => x.id === id);
    if (!mover) return null;
    const regole = v.regole || DnD.movimento.DEFAULT_RULES;
    const state = { grid: gioc.doc.grid, combatants: gioc.doc.combatants, tilesets: gioc.tsIndex, rules: regole };
    let P;
    try {
      P = DnD.movimento.reach(DnD.ia.buildMap(state), state, mover, { rules: regole, hostile: (a, b) => b.lato === 'nemico' && b.hp > 0 });
    } catch (e) { return null; } // senza anteprima: niente trascinamento (resta la richiesta dal master)
    const res = mia.pr.movimento.residuo;
    const left = res === null || res === undefined ? undefined : res;
    const sets = DnD.movimento.reachable(P, left === undefined ? Infinity : left);
    return {
      normal: sets.normal, dash: sets.dash,
      route: (target) => {
        const r = DnD.movimento.routeTo(P, target, left);
        r.label = !r.end ? 'non raggiungibile' : r.stopped ? 'oltre il residuo: ti fermi dopo ' + r.cost : 'costo ' + r.cost + (left !== undefined ? ' · restano ' + (left - r.cost) : '');
        return r;
      },
    };
  }

  function scheletro() {
    const d = gioc.dom = {};
    d.dot = el('span', { class: 'online-dot-slot' });
    d.linea = el('span', { class: 'small muted' });
    d.avanzBar = el('progress', { max: 100, value: 0 });
    d.avanz = el('div', { class: 'online-progress', hidden: true, role: 'status' }, el('span', { text: 'Scarico la mappa… ' }), d.avanzBar);
    d.banner = el('div', { class: 'online-banner', hidden: true, role: 'status', 'aria-live': 'assertive' });
    d.azioni = el('section', { class: 'panel online-actions-panel', 'aria-label': 'Le tue azioni' });
    d.richieste = el('ul', { class: 'online-requests', 'aria-live': 'polite', 'aria-label': 'Richieste al master' });
    d.scheda = el('section', { class: 'panel online-scheda' });
    d.cards = el('div', { class: 'combatants' });
    d.turni = el('section', { class: 'panel turn-panel' });
    d.log = el('ol', { class: 'log' });
    d.altri = el('section', { class: 'panel online-altri' });
    d.presenza = el('div', { class: 'online-presence small', role: 'list', 'aria-label': 'Partecipanti' });
    d.lavoro = el('div', { class: 'online-banner online-working', hidden: true, role: 'status' });
    d.persa = el('div', { class: 'online-banner online-lost', hidden: true, role: 'alert' });
    d.mondo = el('section', { class: 'panel online-mondo', 'aria-label': 'Mondo' });
    d.esplora = el('section', { class: 'panel online-esplora', hidden: true, 'aria-label': 'Esplorazione' });
    d.vuoto = el('div', { class: 'panel online-empty' });
    gioc.grid = DnD.uiGriglia.create({
      getDoc: () => gioc.doc, update: () => {}, readOnly: true, tools: ['misura'], showCombatants: false,
      tilesets: () => gioc.tsIndex, overlay: disegnaSopra, tokenActions: () => [],
      canDrag: (id) => { const m = mieAzioni(); return Boolean(m && id === m.p.id && !motivoNo('muovi')); },
      movement: { begin: anteprimaMovimento, apply: (dd, id, r) => chiedi('muovi', { combattenteId: id, celle: r.path.slice(1) }, 'Movimento') },
    });
    // Clic prolungato sulla griglia: ping a tutti.
    const canvas = gioc.grid.node.querySelector('canvas');
    let pressione = null;
    canvas.addEventListener('pointerdown', (e) => {
      const p0 = { x: e.clientX, y: e.clientY };
      clearTimeout(pressione && pressione.t);
      pressione = { p0, t: setTimeout(() => {
        const r = canvas.getBoundingClientRect();
        const cell = DnD.griglia.screenToCell(gioc.grid.view(), p0.x - r.left, p0.y - r.top);
        if (gioc.doc && cell.x >= 0 && cell.y >= 0 && cell.x < gioc.doc.grid.w && cell.y < gioc.doc.grid.h) chiedi('ping', { x: cell.x, y: cell.y }, 'Ping');
        pressione = null;
      }, 600) };
    });
    const annullaPressione = (e) => { if (pressione && (e.type !== 'pointermove' || Math.hypot(e.clientX - pressione.p0.x, e.clientY - pressione.p0.y) > 6)) { clearTimeout(pressione.t); pressione = null; } };
    for (const ev of ['pointermove', 'pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(ev, annullaPressione);
    // Esplorazione: doppio clic su una cella scoperta = chiedi di muovere il gruppo (costo e ore li calcola il master).
    canvas.addEventListener('dblclick', (e) => {
      const g = vistaGriglia(gioc.s.stato().vista);
      if (!g || !g.esplorazione || gioc.s.stato().spettatore) return;
      const r = canvas.getBoundingClientRect();
      const cell = DnD.griglia.screenToCell(gioc.grid.view(), e.clientX - r.left, e.clientY - r.top);
      if (cell.x < 0 || cell.y < 0 || cell.x >= g.griglia.w || cell.y >= g.griglia.h) return;
      chiedi('muoviGruppo', { x: cell.x, y: cell.y }, 'Gruppo verso ' + DnD.griglia.cellLabel(cell.x, cell.y));
    });
    d.center = el('div', { class: 'combat-center' }, d.vuoto, gioc.grid.node, el('p', { class: 'muted small online-hint', text: 'Trascina la tua pedina per chiedere lo spostamento · clic prolungato = ping a tutti' }));
    const cols = DnD.uiCombattimento.columns({
      key: 'dnd-battaglie:layout-online',
      left: { title: 'Tu', body: [d.azioni, d.esplora, d.scheda, d.mondo, d.cards] },
      center: d.center,
      right: { title: 'Turni', head: [el('button', { type: 'button', class: 'btn small dice-inline', text: '🎲 Dadi', title: 'Tira i dadi: il risultato lo decide il master', onclick: () => DnD.uiDadi.openPanel() })],
        body: [d.turni, el('section', { class: 'panel log-panel' }, el('h2', { text: 'Log' }), d.log), gioc.chat.node, d.altri] },
    });
    d.root = el('div', { class: 'combat-screen online-screen' },
      el('div', { class: 'section-head' },
        el('h1', { text: 'Sessione online' }),
        el('div', { class: 'head-actions' },
          el('span', { class: 'online-status' }, d.dot, ' ', d.linea), d.presenza,
          btn('❓ Chiedi al master…', domandaDialog),
          btn('📡 Eco', () => { gioc.s.eco(); setTimeout(aggiornaLinea, 1500); }, { title: 'Prova di eco con il master' }),
          btn('🩺 Test connessione', testConnessione),
          btn('⬇ Riepilogo', esportaRiepilogo, { title: 'Scarica il riepilogo della partita (solo ciò che hai visto)' }),
          el('button', { type: 'button', class: 'btn small danger', text: 'Esci', onclick: () => { if (confirm('Uscire dalla sessione online?')) gioc.s.esci(); } }))),
      d.persa, d.lavoro, d.banner, d.avanz, cols.layout);
    fill(document.getElementById('main'), d.root);
  }
  function domandaDialog() {
    const t = el('textarea', { rows: 3, maxlength: 300, placeholder: 'es. Posso scassinare la porta?', 'aria-label': 'Domanda al master' });
    openDialog('Chiedi al master', el('div', { class: 'form' }, field('Domanda', t)), [
      { text: 'Annulla' },
      { text: 'Invia', class: 'primary', onclick: () => { if (t.value.trim()) chiedi('domanda', { testo: t.value }, 'Domanda'); } },
    ]);
  }

  function aggiornaLinea() {
    if (!gioc || !gioc.dom || gioc.finita) return;
    const s = gioc.s.stato();
    const l = gioc.s.linea();
    fill(gioc.dom.dot, lineaDot(l));
    gioc.dom.linea.textContent = (l === 'verde' ? 'Collegato' : l === 'giallo' ? 'Linea lenta' : 'Nessuna risposta dal master') +
      (s.latenza !== null ? ' · ' + s.latenza + ' ms' : '') + (s.eco !== null ? ' · eco ' + s.eco + ' ms' : '');
  }
  function avanzamento(a) {
    if (!gioc || !gioc.dom) return;
    gioc.dom.avanz.hidden = !a.immagini;
    if (a.totali) gioc.dom.avanzBar.value = Math.round((a.ricevuti / a.totali) * 100);
    if (a.pronta) renderGiocatore();
  }

  // ---------- Azioni del giocatore ----------
  // La propria pedina con le sue azioni (dalla vista), o null.
  function mieAzioni() {
    const v = gioc && gioc.s.stato().vista;
    const c = v && v.combattimento;
    const p = c && c.pedine.find((x) => x.mia);
    return p && p.proprie ? { v, c, p, pr: p.proprie } : null;
  }
  // Motivo per cui un'azione non è possibile ora ('' = possibile): mostrato nel tooltip del pulsante disattivato.
  function motivoNo(tipo, costo) {
    const s = gioc.s.stato();
    const m = mieAzioni();
    const perm = s.permessi;
    if (s.pausa) return 'Il master ha messo in pausa il gioco';
    if (!m) return s.vista && s.vista.combattimento ? 'Non hai un personaggio nel combattimento' : 'Nessun combattimento in corso';
    if (m.c.fase !== 'attivo') return 'Si tira ancora l\'iniziativa';
    const k = I().permessoDi(tipo, {});
    if (k && (k === 'muovi' ? perm.muovi === 'mai' : !perm[k])) return 'Il master non ti permette questa azione';
    const mioTurno = m.c.turno === m.p.id;
    if (tipo === 'muovi') return !mioTurno && perm.muovi !== 'sempre' ? 'Non è il tuo turno' : m.pr.movimento.residuo === 0 ? 'Movimento esaurito' : '';
    if (costo !== 'reazione' && !mioTurno) return 'Non è il tuo turno';
    if (tipo === 'finisciTurno') return '';
    if (m.p.aTerra) return 'Sei a terra';
    if (m.pr.blocco && costo) return 'Non puoi agire: ' + m.pr.blocco;
    const eco = m.pr.economia;
    if (eco && costo === 'attacco' && eco.azione && !eco.attacchi) return 'Hai già usato l\'azione';
    if (eco && costo === 'azione' && eco.azione) return 'Hai già usato l\'azione';
    if (eco && costo === 'bonus' && eco.bonus) return 'Hai già usato l\'azione bonus';
    if (eco && costo === 'reazione' && eco.reazione) return 'Hai già usato la reazione';
    return '';
  }
  function azioniNode() {
    const m = mieAzioni();
    const s = gioc.s.stato();
    const c = s.vista && s.vista.combattimento;
    const corrente = c && c.pedine.find((p) => p.id === c.turno);
    const b = (text, tipo, costo, fn, extra) => {
      const no = motivoNo(tipo, costo);
      return el('button', Object.assign({ type: 'button', class: 'btn small' + (m && c.turno === m.p.id && !no ? ' online-ready' : ''), text, disabled: Boolean(no), title: no || null, onclick: fn }, extra || {}));
    };
    const id = m ? m.p.id : '';
    const pr = m ? m.pr : null;
    const eco = pr && pr.economia;
    return [
      el('h2', { text: m && c.turno === m.p.id ? '⭐ È il tuo turno!' : corrente ? 'Turno di ' + corrente.nome : 'Le tue azioni' }),
      s.pausa ? el('p', { class: 'warning-text small', text: '⏸ Il master ha messo in pausa il gioco.' }) : null,
      m ? el('p', { class: 'small muted', text: 'Movimento: ' + (pr.movimento.residuo === null ? '—' : pr.movimento.residuo + '/' + pr.movimento.velocita + ' celle') +
        (eco ? ' · azione ' + (eco.azione ? (eco.attacchi ? 'in corso (' + eco.attacchi + ' attacchi)' : 'usata') : 'libera') + ' · bonus ' + (eco.bonus ? 'usata' : 'libera') + ' · reazione ' + (eco.reazione ? 'usata' : 'libera') : '') }) : null,
      el('div', { class: 'online-actions' },
        b('⚔ Attacca…', 'attacca', 'attacco', () => attaccoDialog(), { disabled: Boolean(motivoNo('attacca', 'attacco')) || !(pr && pr.armi.length) }),
        pr && pr.magie ? b('✨ Incantesimo…', 'lancia', 'azione', () => magiaDialog()) : null,
        b('🏃 Scatto', 'movimento', 'azione', () => chiedi('movimento', { combattenteId: id, tipo: 'scatto' }, 'Scatto')),
        b('↩ Disimpegno', 'movimento', 'azione', () => chiedi('movimento', { combattenteId: id, tipo: 'disimpegno' }, 'Disimpegno')),
        pr && pr.prono ? b('⤒ Rialzati', 'movimento', null, () => chiedi('movimento', { combattenteId: id, tipo: 'rialzati' }, 'Rialzati')) : null,
        pr && pr.movimento.spostato ? b('↶ Annulla spostamento', 'movimento', null, () => chiedi('movimento', { combattenteId: id, tipo: 'annulla' }, 'Annulla spostamento')) : null,
        b('🛡 Schivare', 'usaAzione', 'azione', () => chiedi('usaAzione', { combattenteId: id, azione: 'schivare' }, 'Schivare')),
        b('🤝 Aiutare', 'usaAzione', 'azione', () => azioneDialog('aiutare')),
        b('🫥 Nascondersi', 'usaAzione', 'azione', () => chiedi('usaAzione', { combattenteId: id, azione: 'nascondersi' }, 'Nascondersi')),
        b('🧪 Usa un oggetto…', 'usaAzione', 'azione', () => azioneDialog('oggetto')),
        b('⚑ Altra azione…', 'usaAzione', null, () => azioneDialog('altro')),
        b('⚡ Reazione…', 'usaAzione', 'reazione', () => azioneDialog('reazione')),
        pr && pr.creatura.length ? b('🐉 Azioni…', 'usaAzione', 'azione', () => creaturaDialog()) : null,
        b('⏭ Finisci turno', 'finisciTurno', 'fine', () => chiedi('finisciTurno', { combattenteId: id }, 'Fine del turno'), { class: 'btn small primary' })),
      gioc.dom.richieste,
    ];
  }
  // Bersagli: le pedine che vedi (tranne te).
  const bersagli = () => { const m = mieAzioni(); return m ? m.c.pedine.filter((p) => p.id !== m.p.id && !p.morto) : []; };
  const modoRadio = (nome) => el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro' }),
    ['normale', 'vantaggio', 'svantaggio'].map((v, i) => el('label', { class: 'check' }, el('input', { type: 'radio', name: nome, value: v, checked: !i }), ' ' + v)));
  const modoLetto = (body, nome) => body.querySelector('input[name="' + nome + '"]:checked').value;
  function sceltaSullaGriglia(select, riapri) {
    return el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
      document.querySelectorAll('dialog[open]').forEach((x) => x.dismiss ? x.dismiss() : x.close());
      gioc.grid.pickTarget((tid) => { riapri(tid || select.value); });
    } });
  }
  function attaccoDialog(preset) {
    const m = mieAzioni();
    if (!m) return;
    const arma = el('select', { 'aria-label': 'Arma' }, m.pr.armi.map((w) => el('option', { value: w.id, text: w.nome + ' (' + w.testo + ')' })));
    const bers = el('select', { 'aria-label': 'Bersaglio' }, bersagli().map((p) => el('option', { value: p.id, text: p.nome + ' — ' + (Number.isFinite(p.pf) ? p.pf + '/' + p.pfMax + ' PF' : p.salute), selected: p.id === preset })));
    const reaz = el('input', { type: 'checkbox' });
    const body = el('div', { class: 'form' }, el('div', { class: 'target-row' }, field('Bersaglio', bers), sceltaSullaGriglia(bers, (tid) => attaccoDialog(tid))), field('Arma', arma), modoRadio('o-modo'),
      el('label', { class: 'check small' }, reaz, ' Come reazione (es. attacco di opportunità: lo conferma il master)'),
      el('p', { class: 'muted small', text: 'Il master controlla portata, linea di vista e condizioni (vantaggio e svantaggio) e tira i dadi.' }));
    openDialog('Attacca', body, [
      { text: 'Annulla' },
      { text: 'Chiedi l\'attacco', class: 'primary', onclick: () => {
        if (!bers.value) { toast('Nessun bersaglio in vista.', 'error'); return false; }
        chiedi('attacca', { combattenteId: m.p.id, bersaglioId: bers.value, armaId: arma.value, modo: modoLetto(body, 'o-modo'), reazione: reaz.checked }, 'Attacco');
        return undefined;
      } },
    ]);
  }
  function magiaDialog(preset) {
    const m = mieAzioni();
    if (!m || !m.pr.magie) return;
    const mg = m.pr.magie;
    const slotLiberi = (l) => Math.max(0, (mg.slotsTotali[l - 1] || 0) - (mg.slotsUsati[l - 1] || 0));
    const sp = el('select', { 'aria-label': 'Incantesimo' }, mg.lista.map((x) => el('option', { value: x.id,
      text: x.nome + ' (' + (x.livello ? x.livello + '°' : 'trucchetto') + (x.innato ? ', innato' + (x.innato.rimasti !== null ? ' ' + x.innato.rimasti : '') : '') + (x.tempo ? ', ' + x.tempo : '') + (x.gittata ? ', ' + x.gittata : '') + ')' })));
    const slot = el('select', { 'aria-label': 'Slot' });
    const lista = el('div', { class: 'check-row' }, el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: m.p.id }), ' te stesso'),
      bersagli().map((p) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: p.id, checked: p.id === preset }), ' ' + p.nome)));
    const aggiornaSlot = () => {
      const x = mg.lista.find((y) => y.id === sp.value);
      clear(slot);
      if (!x || !x.livello || x.innato) { slot.append(el('option', { value: '0', text: x && x.livello ? 'innato' : '— trucchetto —' })); slot.disabled = true; return; }
      slot.disabled = false;
      for (let l = x.livello; l <= 9; l++) if (mg.slotsTotali[l - 1]) slot.append(el('option', { value: String(l), text: l + '° livello (' + slotLiberi(l) + ' liberi)', disabled: !slotLiberi(l) }));
    };
    sp.addEventListener('change', aggiornaSlot);
    aggiornaSlot();
    const body = el('div', { class: 'form' }, field('Incantesimo', sp), field('Slot', slot), el('fieldset', {}, el('legend', { text: 'Bersagli' }), lista), modoRadio('o-modo-m'),
      el('p', { class: 'muted small', text: 'CD ' + mg.cd + ' · attacco ' + DnD.regole.formatModifier(mg.attacco) + '. Il master verifica slot, gittata e concentrazione e risolve tiri e salvezze.' }));
    openDialog('Lancia un incantesimo', body, [
      { text: 'Annulla' },
      { text: 'Chiedi il lancio', class: 'primary', onclick: () => {
        const ids = [...lista.querySelectorAll('input:checked')].map((x) => x.value);
        const x = mg.lista.find((y) => y.id === sp.value);
        chiedi('lancia', { combattenteId: m.p.id, magiaId: sp.value, slot: Number(slot.value) || 0, bersagli: ids, modo: modoLetto(body, 'o-modo-m') }, 'Incantesimo ' + (x ? x.nome : ''));
      } },
    ]);
  }
  function azioneDialog(azione) {
    const m = mieAzioni();
    if (!m) return;
    const come = el('select', { 'aria-label': 'Costo' }, [['azione', 'Azione'], ['bonus', 'Azione bonus']].map(([v, t]) => el('option', { value: v, text: t })));
    const testo = textInput('', { maxlength: 200, placeholder: azione === 'oggetto' ? 'es. bevo una pozione di guarigione' : azione === 'aiutare' ? 'chi aiuti e come' : 'cosa fai', 'aria-label': 'Descrizione' });
    const nome = I().AZIONI_NOMI[azione];
    openDialog(nome, el('div', { class: 'form' }, azione === 'reazione' ? null : field('Costo', come), field('Descrizione', testo),
      el('p', { class: 'muted small', text: azione === 'reazione' ? 'Le reazioni le conferma sempre il master.' : 'Il master la convalida e la scrive nel log; gli effetti (cure, oggetti) li applica lui.' })), [
      { text: 'Annulla' },
      { text: 'Chiedi', class: 'primary', onclick: () => { chiedi('usaAzione', { combattenteId: m.p.id, azione, come: azione === 'reazione' ? 'reazione' : come.value, testo: testo.value }, nome); } },
    ]);
  }
  function creaturaDialog() {
    const m = mieAzioni();
    if (!m) return;
    const az = el('select', { 'aria-label': 'Azione' }, m.pr.creatura.map((a) => el('option', { value: a.id, text: a.nome })));
    const lista = el('div', { class: 'check-row' }, bersagli().map((p) => el('label', { class: 'check small' }, el('input', { type: 'checkbox', value: p.id }), ' ' + p.nome)));
    const body = el('div', { class: 'form' }, field('Azione', az), el('fieldset', {}, el('legend', { text: 'Bersagli' }), lista), modoRadio('o-modo-c'));
    openDialog('Azioni', body, [
      { text: 'Annulla' },
      { text: 'Chiedi', class: 'primary', onclick: () => { chiedi('usaAzione', { combattenteId: m.p.id, azione: 'creatura', azioneId: az.value, bersagli: [...lista.querySelectorAll('input:checked')].map((x) => x.value), modo: modoLetto(body, 'o-modo-c') }, 'Azione'); } },
    ]);
  }

  // ---------- Scheda del giocatore (modifiche come richieste con delta) ----------
  function schedaNode(sc, v) {
    if (!sc) return [el('h2', { text: 'Scheda' }), el('p', { class: 'muted small', text: 'Nessun personaggio assegnato: segui la partita come spettatore.' })];
    const s = gioc.s.stato();
    const risorse = s.permessi.schedaRisorse && !s.pausa;
    const base = s.permessi.schedaBase && !s.pausa;
    const fmt = (n) => (n === null || n === undefined ? '—' : DnD.regole.formatModifier(n));
    const delta = (campo, valore, prima, extra, etichetta) => chiedi('modificaScheda', Object.assign({ campo, valore, prima }, extra || {}), etichetta || 'Scheda');
    const piuMeno = (attuale, min, max, campo, extra, nome) => [
      btn('−', () => delta(campo, attuale - 1, attuale, extra, nome), { disabled: !risorse || attuale <= min, 'aria-label': 'Diminuisci ' + nome }),
      btn('+', () => delta(campo, attuale + 1, attuale, extra, nome), { disabled: !risorse || attuale >= max, 'aria-label': 'Aumenta ' + nome })];
    const numero = (attuale, campo, extra, nome, permesso, lo, hi) => el('input', { type: 'number', class: 'qty', value: attuale, min: lo, max: hi, disabled: !permesso, 'aria-label': nome,
      onchange: (e) => { const n = Number(e.target.value); if (Number.isInteger(n)) delta(campo, n, attuale, extra, nome); } });
    const altri = (v.altri || []);
    const note = el('textarea', { rows: 3, maxlength: 5000, 'aria-label': 'Note personali', placeholder: 'Restano solo su questo computer: il master non le vede.' });
    const chiaveNote = NOTE + ':' + (v.io.personaggioId || 'spettatore');
    note.value = String(leggi(chiaveNote, '') || '');
    note.addEventListener('input', () => scrivi(chiaveNote, NET().protocollo.pulisciTesto(note.value, 5000)));
    return [
      el('h2', { text: 'Scheda: ' + sc.nome }),
      el('p', { class: 'muted small', text: [sc.razza, sc.classe, 'livello ' + sc.livello].filter(Boolean).join(' · ') }),
      el('div', { class: 'online-hp-edit' },
        el('span', {}, el('b', { text: 'PF ' + sc.pf + '/' + sc.pfMax }), sc.pfTemp ? ' (+' + sc.pfTemp + ' temp.)' : ''), ...piuMeno(sc.pf, 0, sc.pfMax, 'pf', {}, 'PF'),
        el('label', { class: 'inline small' }, 'Temp. ', numero(sc.pfTemp || 0, 'pfTemp', {}, 'PF temporanei', risorse, 0, 999))),
      el('div', { class: 'online-stats' },
        [['CA', sc.ca], ['Iniziativa', fmt(sc.iniziativa)], ['Velocità', sc.velocita !== null ? String(sc.velocita).replace('.', ',') + ' m' : '—'],
          ['Competenza', fmt(sc.competenza)], ['Perc. passiva', sc.percezione], ['Dadi vita', sc.dadiVita]]
          .map(([k, x]) => el('div', { class: 'online-stat' }, el('small', { text: k }), el('b', { text: x === null || x === undefined ? '—' : String(x) })))),
      sc.caratteristiche.length ? el('div', { class: 'online-abilities' }, sc.caratteristiche.map((a) => el('div', { class: 'online-stat' },
        el('small', { text: a.nome }), base ? numero(a.valore, 'caratteristica', { chiave: a.nome }, a.nome, true, 1, 30) : el('b', { text: String(a.valore) }),
        el('span', { class: 'small muted', text: fmt(a.mod) + ' · TS ' + fmt(a.ts) + (a.competente ? ' ●' : '') })))) : null,
      base ? el('label', { class: 'inline small' }, 'Livello ', numero(sc.livello, 'livello', {}, 'Livello', true, 1, 20)) : null,
      (sc.slot || []).length ? el('div', { class: 'online-slots small' }, el('b', { text: 'Slot usati: ' }), sc.slot.map((x) => el('span', { class: 'online-slot' },
        x.livello + '°: ' + x.usati + '/' + x.totali, ...piuMeno(x.usati, 0, x.totali, 'slot', { livello: x.livello }, 'slot di ' + x.livello + '° livello usati')))) : null,
      el('div', { class: 'online-coins small' }, el('b', { text: 'Monete: ' }), DnD.attrezzatura.CURRENCIES.map((k) => el('label', { class: 'inline' }, k + ' ', numero((sc.monete || {})[k] || 0, 'monete', { chiave: k }, 'Monete ' + k, risorse, 0, 10000000)))),
      el('details', { class: 'online-inventory' }, el('summary', { text: 'Inventario (' + (sc.inventario || []).length + ')' }),
        (sc.inventario || []).length ? el('ul', {}, sc.inventario.map((it) => el('li', { class: 'small' }, it.nome + ' × ' + it.qty + (it.equipaggiato ? ' (equipaggiato)' : '') + ' ',
          ...piuMeno(it.qty, 0, 100000, 'inventario', { indice: it.indice }, 'quantità di ' + it.nome),
          altri.length ? btn('Dai a…', () => daiDialog(it, altri), { disabled: !risorse }) : null))) : el('p', { class: 'muted small', text: 'Vuoto.' })),
      sc.condizioni.length ? el('p', { class: 'small', text: 'Condizioni: ' + sc.condizioni.join(', ') }) : null,
      el('details', {}, el('summary', { text: 'Note personali' }), note),
    ];
  }
  function daiDialog(it, altri) {
    const a = el('select', { 'aria-label': 'A chi' }, altri.map((p) => el('option', { value: p.id, text: p.nome })));
    const qty = DnD.ui.numberInput(1, { min: 1, max: it.qty, 'aria-label': 'Quantità' });
    openDialog('Dai ' + it.nome, el('div', { class: 'form' }, field('A chi', a), field('Quantità (hai ' + it.qty + ')', qty),
      el('p', { class: 'muted small', text: 'Lo scambio avviene quando il destinatario accetta (o il master, se non è collegato).' })), [
      { text: 'Annulla' },
      { text: 'Offri', class: 'primary', onclick: () => { chiedi('dai', { indice: it.indice, qty: Math.max(1, Math.min(it.qty, Number(qty.value) || 1)), a: a.value }, 'Scambio'); } },
    ]);
  }
  function altriNode(v) {
    const lista = v.altri || [];
    if (!lista.length) return [];
    return [el('h2', { text: 'Compagni' }), el('ul', { class: 'online-companions' }, lista.map((p) => el('li', { class: 'small' },
      el('b', { text: p.nome }), ' · ' + [p.classe, 'liv. ' + p.livello, p.salute, p.ca !== null ? 'CA ' + p.ca : ''].filter(Boolean).join(' · ') +
      (p.condizioni.length ? ' · ' + p.condizioni.join(', ') : ''))))];
  }

  function cartaPedina(p, turno) {
    const pf = Number.isFinite(p.pf);
    return el('article', { class: 'combatant ' + (p.lato === 'giocatore' ? 'player' : 'npc') + (turno ? ' current' : '') + (p.aTerra ? ' down' : '') + (p.mia ? ' selected' : '') },
      el('div', { class: 'combatant-head' },
        el('div', {},
          el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(iconaDi(p.icona), 28), el('h3', { text: String(p.nome || '') })),
          el('span', { class: 'muted small', text: { giocatore: 'Giocatore', alleato: 'Alleato', neutrale: 'Neutrale', nemico: 'Nemico' }[p.lato] || '' }),
          p.mia ? el('span', { class: 'badge', text: 'TU' }) : null,
          p.morto ? el('span', { class: 'badge down-badge', text: '✝ MORTO' }) : p.aTerra ? el('span', { class: 'badge down-badge', text: 'A TERRA' }) : null,
          turno ? el('span', { class: 'badge turn-badge', text: 'TURNO' }) : null)),
      pf ? el('div', { class: 'hp' }, el('div', { class: 'hp-text' }, el('b', { text: p.pf + ' / ' + p.pfMax }), ' PF' + (p.pfTemp ? ' (+' + p.pfTemp + ' temp.)' : '')),
        el('div', { class: 'hp-bar' }, el('div', { class: 'hp-fill ' + DnD.regole.hpLevel(p.pf, p.pfMax), style: 'width:' + Math.max(0, Math.min(100, Math.round((p.pf / p.pfMax) * 100))) + '%' })))
        : el('p', { class: 'online-health ' + String(p.salute || '').replace(' ', '-'), text: 'Salute: ' + (p.salute || '?') }),
      (p.condizioni || []).length || p.concentrazione ? el('div', { class: 'cond-box' },
        (p.condizioni || []).map((c) => el('span', { class: 'tag small', style: COLORE.test(c.colore || '') ? 'border-color:' + c.colore : null, text: (c.icona || '') + ' ' + c.nome })),
        p.concentrazione ? el('span', { class: 'tag conc-tag', text: '◎ ' + p.concentrazione }) : null) : null,
      p.morte ? el('p', { class: 'small', text: p.morte.stabile ? 'Stabile' : 'Tiri contro la morte (li tira il master): ✔ ' + p.morte.successi + ' · ✖ ' + p.morte.fallimenti }) : null);
  }

  function renderGiocatore() {
    if (!gioc || gioc.finita) return;
    const s = gioc.s.stato();
    const main = document.getElementById('main');
    if (s.stato === 'attesa' || !s.vista) {
      gioc.dom = null;
      fill(main, el('div', { class: 'panel online-wait' }, el('h1', { text: 'Sessione online' }),
        el('p', { text: s.stato === 'attesa' ? '⏳ Collegato. In attesa che il master ti faccia entrare…' : 'Ricevo la sessione…' })));
      return;
    }
    if (!gioc.dom) scheletro();
    const d = gioc.dom;
    const v = s.vista;
    const c = v.combattimento;
    // Barra dei partecipanti: colore, nome, personaggio, stato e chi ha il turno.
    fill(d.presenza, (s.presenza || []).map((p) => el('span', { class: 'online-who' + (p.turno ? ' turn' : ''), role: 'listitem', title: p.stato === 'master' ? 'Master' : p.stato === 'disconnesso' ? 'Assente' : p.spettatore ? 'Spettatore' : 'Connesso' },
      pallino(p.colore), ' ' + (p.turno ? '⭐ ' : '') + p.nome + (p.personaggio ? ' · ' + p.personaggio : '') + (p.stato === 'master' ? ' (master)' : p.stato === 'disconnesso' ? ' (assente)' : p.spettatore ? ' 👁' : ''))));
    // Connessione persa: banner con «Rientra» (stesso gettone, nuovo scambio di codici).
    d.persa.hidden = s.stato !== 'persa';
    if (s.stato === 'persa') fill(d.persa, '⚠ ' + (s.motivo || 'Connessione persa.') + ' ', btn('🔑 Rientra', rientra, { class: 'btn small primary' }));
    d.lavoro.hidden = !s.lavoro;
    d.lavoro.textContent = s.lavoro ? '🛠 ' + s.lavoro : '';
    fill(d.azioni, ...(s.spettatore ? [el('h2', { text: 'Spettatore' }), el('p', { class: 'muted small', text: 'Sei uno spettatore: vedi la partita, puoi scrivere in chat e fare domande, ma non agire.' })] : azioniNode()));
    aggiornaRichieste();
    fill(d.scheda, ...schedaNode(v.scheda, v));
    fill(d.altri, ...altriNode(v));
    fill(d.mondo, ...mondoNode(v));
    d.mondo.hidden = !d.mondo.childNodes.length;
    const attivo = Boolean(c && c.fase === 'attivo');
    const esplora = !attivo && v.esplorazione ? v.esplorazione : null;
    d.esplora.hidden = !esplora;
    if (esplora) {
      const ora = Math.floor(esplora.tempo.ora);
      fill(d.esplora, el('h2', { text: '🧭 Esplorazione' }),
        el('p', { class: 'small' }, 'Giorno ' + esplora.tempo.giorno + ', ore ' + String(ora).padStart(2, '0') + ':' + String(Math.round((esplora.tempo.ora - ora) * 60)).padStart(2, '0'),
          esplora.meteo ? ' · ' + esplora.meteo.nome : '', esplora.bioma ? ' · ' + (esplora.bioma.icona ? esplora.bioma.icona + ' ' : '') + esplora.bioma.nome : ''),
        s.spettatore ? null : el('p', { class: 'muted small', text: 'Doppio clic su una cella scoperta per proporre lo spostamento del gruppo: il master lo approva e calcola costo e ore.' }),
        s.spettatore ? null : btn('🛏 Chiedi un riposo breve', () => chiedi('richiediRiposo', { tipo: 'breve' }, 'Riposo breve')),
        esplora.eventi.length ? el('ol', { class: 'log small' }, esplora.eventi.slice(-8).map((x) => el('li', { text: 'G' + x.giorno + ' ' + x.testo }))) : null);
    }
    d.vuoto.hidden = attivo || Boolean(esplora);
    gioc.grid.node.hidden = !attivo && !esplora;
    // Inizio del proprio turno: suono, avviso e pagina evidenziata.
    const mio = attivo && v.io.combattenteId && c.turno === v.io.combattenteId;
    if (mio && gioc.turnoPrima !== c.round + ':' + c.turno) {
      suona('turno-giocatore');
      d.banner.hidden = false;
      d.banner.textContent = '⭐ Tocca a te! Trascina la pedina per muoverti, poi scegli un\'azione.';
      evidenzia();
    } else if (!mio) d.banner.hidden = true;
    gioc.turnoPrima = attivo ? c.round + ':' + c.turno : null;
    if (!attivo) {
      fill(d.vuoto, el('h2', { text: c ? 'Si tira l\'iniziativa…' : 'Nessun combattimento in corso' }),
        el('p', { class: 'muted', text: c ? 'Il combattimento comincia tra poco.' : v.master + ' non ha ancora iniziato un combattimento. Intanto puoi scrivere in chat, tirare i dadi e fare domande.' }),
        !c && !s.spettatore && v.scheda ? btn('🛏 Chiedi un riposo breve', () => chiedi('richiediRiposo', { tipo: 'breve' }, 'Riposo breve')) : null);
      clear(d.cards); clear(d.log);
      fill(d.turni, el('div', { class: 'muted small', text: 'In attesa del combattimento.' }));
      if (esplora) { gioc.doc = documento(vistaGriglia(v)); gioc.grid.refresh(); }
    } else {
      const corrente = c.pedine.find((p) => p.id === c.turno) || null;
      fill(d.cards, c.pedine.filter((p) => !p.mia).map((p) => cartaPedina(p, p.id === c.turno)));
      fill(d.turni,
        el('div', { class: 'round' }, 'Round ', el('b', { text: String(c.round) })),
        el('div', { class: 'muted', text: corrente ? 'Turno di ' + corrente.nome + (corrente.mia ? ' (tu!)' : '') : 'Turno di qualcuno che non vedi' }),
        c.boss.length ? el('div', { class: 'online-boss small' }, c.boss.map((b) => el('div', {}, '👑 ', el('b', { text: b.nome }), b.titolo ? ' — ' + b.titolo : '', ' · fase ' + b.fase + ' · ' + (Number.isFinite(b.pf) ? b.pf + '/' + b.pfMax + ' PF' : b.salute)))) : null,
        el('ol', { class: 'turn-order' }, c.pedine.map((p) => el('li', { class: (p.id === c.turno ? 'current ' : '') + (p.aTerra ? 'down ' : '') + (p.lato === 'giocatore' ? 'player' : 'npc') },
          el('span', { class: 'init', text: String(p.iniziativa) }), el('span', { class: 'name', text: p.nome + (p.mia ? ' (tu)' : '') }),
          el('span', { class: 'muted small', text: Number.isFinite(p.pf) ? p.pf + '/' + p.pfMax : p.salute })))));
      fill(d.log, c.log.map((e) => el('li', { class: 'log-' + String(e.tipo || '').replace(/[^a-z-]/g, '') }, e.tipo === 'round' ? null : el('span', { class: 'log-round', text: 'R' + e.round }), String(e.testo || ''))));
      d.log.scrollTop = d.log.scrollHeight;
      gioc.doc = documento(c);
      gioc.grid.refresh();
      const mia = c.pedine.find((p) => p.mia);
      if (mia && !gioc.selezionata) { gioc.selezionata = true; gioc.grid.setSelectedCombatant(mia.id); }
    }
    aggiornaLinea();
  }

  // Riepilogo di fine partita: solo ciò che il giocatore ha ricevuto (già filtrato dal master).
  function esportaRiepilogo() {
    if (!gioc) return;
    DnD.uiImpostazioni.download(gioc.s.riepilogo(), 'sessione-online-' + DnD.uiImpostazioni.today() + '.txt', 'text/plain');
  }
  function fineGiocatore(motivo, stato) {
    if (!gioc) return;
    gioc.finita = true;
    clearInterval(gioc.timer);
    DnD.uiDadi.suTiro = null;
    DnD.uiDadi.remoto = null;
    suona('online-disconnessione');
    if (stato === 'espulso') scrivi(GETTONE, null);
    const titolo = stato === 'rifiutato' ? 'Ingresso rifiutato' : stato === 'espulso' ? 'Sei stato espulso' : 'La sessione è terminata';
    const puoRientrare = stato === 'finito' && Boolean(gioc.s.stato().gettone);
    fill(document.getElementById('main'), el('div', { class: 'panel online-wait' },
      el('h1', { text: titolo }), el('p', { text: motivo || '' }),
      stato === 'finito' ? el('p', { class: 'muted small', text: 'Per rientrare chiedi al master un nuovo invito: con il gettone salvato riprendi lo stesso personaggio (anche se il master ha chiuso e riaperto l\'app).' }) : null,
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: '⬇ Riepilogo della partita', onclick: esportaRiepilogo }),
        puoRientrare ? el('button', { type: 'button', class: 'btn', text: '🔑 Rientra', onclick: rientra }) : null,
        el('button', { type: 'button', class: 'btn primary', text: 'Torna all\'app', onclick: () => location.reload() }))));
  }

  // ---------- Test connessione ----------
  function testConnessione() {
    const S = NET().segnalazione;
    const env = S.ambiente();
    const req = S.requisiti(env);
    const rete = el('div', { class: 'small', 'aria-live': 'polite', text: 'Premi «Analizza la rete» per cercare i candidati di collegamento (locali, tramite STUN, tramite relay).' });
    const analizza = el('button', { type: 'button', class: 'btn small', text: '🔎 Analizza la rete', disabled: !env.RTCPeerConnection, onclick: async () => {
      analizza.disabled = true;
      rete.textContent = 'Analisi in corso (qualche secondo)…';
      try {
        const c = await S.provaCandidati();
        const g = S.giudizio(c);
        fill(rete, el('p', { text: 'Candidati trovati: ' + c.locali + ' locali' + (c.mdns ? ' (' + c.mdns + ' con indirizzo nascosto dal browser)' : '') + ', ' + c.stun + ' tramite STUN, ' + c.relay + ' tramite relay.' }),
          el('p', { class: 'online-verdict ' + g.livello }, lineaDot(g.livello), ' ' + g.testo));
      } catch (e) {
        rete.textContent = 'Analisi non riuscita: ' + e.message;
      }
      analizza.disabled = false;
    } });
    // Prova di eco: con i giocatori (master) o con il master (giocatore).
    const ecoOut = el('div', { class: 'small', 'aria-live': 'polite' });
    let eco;
    if (master) {
      const attivi = master.s.giocatori().filter((g) => g.stato === 'attivo');
      eco = attivi.length ? el('div', { class: 'online-actions' }, attivi.map((g) => el('button', { type: 'button', class: 'btn small', text: '📡 Eco con ' + g.nome, onclick: () => {
        master.s.eco(g.id);
        ecoOut.textContent = 'Attendo la risposta di ' + g.nome + '…';
        setTimeout(() => { const x = master && master.s.giocatori().find((y) => y.id === g.id); ecoOut.textContent = x && x.eco !== null ? 'Eco con ' + g.nome + ': ' + x.eco + ' ms andata e ritorno.' : 'Nessuna risposta da ' + g.nome + '.'; }, 1500);
      } }))) : el('p', { class: 'muted small', text: 'Nessun giocatore collegato: invita qualcuno e riprova.' });
    } else if (gioc && !gioc.finita) {
      eco = el('button', { type: 'button', class: 'btn small', text: '📡 Eco con il master', onclick: () => {
        gioc.s.eco();
        ecoOut.textContent = 'Attendo la risposta del master…';
        setTimeout(() => { const s = gioc && gioc.s.stato(); ecoOut.textContent = s && s.eco !== null ? 'Eco con il master: ' + s.eco + ' ms andata e ritorno.' : 'Nessuna risposta dal master.'; }, 1500);
      } });
    } else {
      eco = el('p', { class: 'muted small', text: 'La prova di eco misura il tempo di risposta tra master e giocatore: avvia o raggiungi una sessione (Ospita / Unisciti), poi torna qui.' });
    }
    // Diagnostica: collegati, latenze, traffico per client e ultimi errori; «Copia diagnostica» per una segnalazione.
    const diagnostica = () => {
      const base = { app: DnD.config.APP_NAME, protocollo: NET().protocollo.VERSIONE, browser: navigator.userAgent, ora: new Date().toISOString(), requisiti: req.map((r) => r.nome + ': ' + (r.ok ? 'ok' : 'NO')) };
      if (master) return Object.assign(base, { ruolo: 'master' }, master.s.diagnostica());
      if (gioc) { const s = gioc.s.stato(); return Object.assign(base, { ruolo: 'giocatore', stato: s.stato, latenza: s.latenza, eco: s.eco, linea: gioc.s.linea(), rientri: s.tentativi, spettatore: s.spettatore }); }
      return Object.assign(base, { ruolo: 'nessuna sessione' });
    };
    const diag = diagnostica();
    const diagNode = master ? el('div', { class: 'small' },
      el('p', { text: 'Giocatori collegati: ' + diag.giocatori + (diag.spettatori ? ' + ' + diag.spettatori + ' spettatori' : '') + ' · latenza media ' + (diag.latenzaMedia === null ? '—' : diag.latenzaMedia + ' ms') + ', massima ' + (diag.latenzaMassima === null ? '—' : diag.latenzaMassima + ' ms') }),
      diag.client.length ? el('table', { class: 'online-diag' }, el('thead', {}, el('tr', {}, ['Client', 'Stato', 'Latenza', 'Inviati', 'Messaggi', 'In coda'].map((t) => el('th', { text: t })))),
        el('tbody', {}, diag.client.map((x) => el('tr', {}, el('td', { text: x.nome + (x.spettatore ? ' 👁' : '') }), el('td', {}, lineaDot(x.stato === 'attivo' ? x.linea : 'grigio'), ' ' + x.stato),
          el('td', { text: x.latenza === null ? '—' : x.latenza + ' ms' }), el('td', { text: Math.round(x.byte / 1024) + ' KB' }), el('td', { text: String(x.messaggi) }),
          el('td', { text: String(x.coda) + (x.scaricando ? ' ⬇' : '') }))))) : null,
      diag.errori.length ? el('ul', {}, diag.errori.map((e) => el('li', { text: oraTesto(e.ora) + ' ' + e.testo }))) : el('p', { class: 'muted', text: 'Nessun errore recente.' }))
      : el('p', { class: 'small muted', text: gioc ? 'Stato: ' + diag.stato + ' · latenza ' + (diag.latenza === null ? '—' : diag.latenza + ' ms') : 'Nessuna sessione online aperta.' });
    const copiaDiag = btn('📋 Copia diagnostica', async () => {
      const testo = JSON.stringify(diagnostica(), null, 1);
      try { await navigator.clipboard.writeText(testo); toast('Diagnostica copiata: incollala nella segnalazione.', 'success'); } catch (e) { toast('Appunti non disponibili: seleziona e copia il testo qui sotto.', 'error'); diagPre.hidden = false; }
    });
    const diagPre = el('pre', { class: 'small player-view', hidden: true, text: JSON.stringify(diag, null, 1) });
    const stun = el('textarea', { rows: 2, class: 'code-box', spellcheck: false, 'aria-label': 'Server STUN, uno per riga' });
    stun.value = S.stun().join('\n');
    const problemi = [
      ['«Collegamento non riuscito» dopo lo scambio dei codici', 'La rete (ufficio, scuola, alcuni operatori mobili) blocca il collegamento diretto. Provate un\'altra rete, per esempio l\'hotspot del telefono. Ripiego consigliato: condividete lo schermo con il programma di videochiamata che usate già.'],
      ['«Codice scaduto» o «già usato»', 'I codici valgono ' + NET().codici.DURATA / 60000 + ' minuti e una volta sola: il master crea un nuovo invito (anche per far rientrare chi è caduto: con il gettone riprende lo stesso personaggio).'],
      ['«Codice non valido» o «danneggiato»', 'Copiatelo per intero, senza tagli né spazi aggiunti: meglio con il pulsante «Copia».'],
      ['«Versione incompatibile»', 'Master e giocatore usano versioni diverse dell\'app: aggiornate entrambi la pagina (Ctrl+F5).'],
      ['Pagina aperta da file (file://)', 'Appunti e cache offline non funzionano. Servite la cartella in locale (python -m http.server) oppure pubblicatela gratis su un sito statico (per esempio GitHub Pages).'],
      ['«Connessione persa» durante la partita', 'Premi «Rientra» e chiedi al master un nuovo invito: con il gettone riprendi personaggio e stato. Le richieste che avevi in sospeso sono annullate (ripetile). Brevi cadute della rete si recuperano da sole.'],
      ['«La sessione è piena» o «non accetta nuovi ingressi»', 'Al massimo ' + NET().sessione.MAX_GIOCATORI + ' giocatori più gli spettatori; il master può aver chiuso i nuovi ingressi (entra solo chi rientra con il gettone).'],

    ];
    openDialog('Test connessione', el('div', { class: 'online-test' },
      el('h3', { text: 'Requisiti' }),
      el('ul', { class: 'online-req' }, req.map((r) => el('li', { class: r.ok ? 'ok' : 'ko' }, el('span', { text: r.ok ? '✔ ' : '✖ ' }), el('b', { text: r.nome }), r.nota ? el('div', { class: 'small muted', text: r.nota }) : null))),
      el('h3', { text: 'Rete' }), analizza, rete,
      el('h3', { text: 'Prova di eco' }), eco, ecoOut,
      el('h3', { text: 'Diagnostica' }), diagNode, copiaDiag, diagPre,
      el('h3', { text: 'Problemi tipici' }),
      el('dl', { class: 'online-problems small' }, problemi.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      el('details', {}, el('summary', { text: 'Server STUN (avanzato)' }),
        el('p', { class: 'muted small', text: 'Servono solo a scoprire l\'indirizzo pubblico; nessun dato della partita passa da lì. Vuoto = predefiniti di Google.' }),
        stun, el('button', { type: 'button', class: 'btn small', text: 'Salva', onclick: () => { const v = S.salvaStun(stun.value.split('\n')); stun.value = v.join('\n'); toast('Server STUN salvati.', 'success'); } }))));
  }

  // Uscire con una sessione aperta: il browser chiede conferma.
  window.addEventListener('beforeunload', (e) => {
    if (master || (gioc && !gioc.finita)) { e.preventDefault(); e.returnValue = ''; }
  });
  // Il master chiude l'app: messaggio chiaro ai giocatori; i gettoni restano salvati per riprendere la sessione.
  window.addEventListener('pagehide', () => {
    if (!master) return;
    salvaRipresa();
    master.s.termina('Il master ha chiuso l\'app: quando la riapre potrà riprendere la sessione e mandarvi un nuovo invito.');
  });


  DnD.uiOnline = {
    apri, testConnessione, disegnaPing,
    vistaGiocatore: () => Boolean(gioc),
    attivo: () => Boolean(master || gioc),
  };
})(globalThis.DnD = globalThis.DnD || {});
