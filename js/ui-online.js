// Gioco online (interfaccia): finestra «Gioco online» (Ospita / Unisciti), scambio dei codici, approvazione degli
// ingressi, pannello del master (giocatori, latenza, eco, espulsione, chat), schermata del giocatore in sola vista
// (griglia, pedine, turni, log, chat, dadi condivisi, propria scheda) e pagina «Test connessione».
// La logica è in js/rete/ (protocollo, trasporto, codici, segnalazione, filtro, immagini, sessione): qui solo DOM.
// L'app offline resta com'è: la rete parte solo quando si ospita o ci si unisce a una sessione.
(function (DnD) {
  'use strict';

  const { el, clear, toast, openDialog, field, textInput, fill } = DnD.ui;
  const NET = () => DnD.rete;
  const PROFILO = 'dnd-battaglie:online-profilo';
  const BATTITO_MS = 3000;
  const COLORE = /^#[0-9a-f]{6}$/i;
  const suona = (id) => { if (DnD.audio) DnD.audio.suona(id); };

  let master = null; // { s: sessione, q: profilo, timer, attesa, registro, dom }
  let gioc = null;   // { s: sessione, q, timer, dom, grid, doc, tsIndex, icone, finita }
  const feed = [];   // chat e dadi: { da, colore, testo, privato, a, dado, ora }
  const chatBoxes = new Set();

  // ---------- Profilo (nome e colore: preferenza locale, non dati della sessione) ----------
  function profilo() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PROFILO) || '{}') || {}; } catch (e) { p = {}; }
    return { nome: typeof p.nome === 'string' ? p.nome.slice(0, 30) : '', colore: COLORE.test(p.colore || '') ? p.colore : '#4f8cc9', comprimi: p.comprimi !== false };
  }
  function salvaProfilo(p) { try { localStorage.setItem(PROFILO, JSON.stringify(p)); } catch (e) { /* non essenziale */ } }

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

  // ---------- Chat e dadi (feed comune) ----------
  function aggiungiFeed(m) {
    feed.push(Object.assign({ ora: Date.now() }, m));
    if (feed.length > 300) feed.splice(0, feed.length - 300);
    for (const c of chatBoxes) c.refresh();
  }
  // opts: { destinatari() -> [[valore, etichetta]], invia(testo, destinatario) -> messaggio | null }
  function chatBox(opts) {
    const list = el('ol', { class: 'online-chat-list', 'aria-live': 'polite', 'aria-label': 'Messaggi' });
    const input = textInput('', { maxlength: 500, placeholder: 'Scrivi un messaggio…', 'aria-label': 'Messaggio' });
    const dest = el('select', { 'aria-label': 'Destinatario' });
    const form = el('form', { class: 'online-chat-form', onsubmit: (e) => {
      e.preventDefault();
      const m = opts.invia(input.value, dest.value);
      if (m) { aggiungiFeed(m); input.value = ''; }
    } }, dest, input, el('button', { type: 'submit', class: 'btn small', text: 'Invia' }));
    const node = el('section', { class: 'panel online-chat' }, el('h2', { text: 'Chat e dadi' }), list, form);
    const box = {
      node,
      refresh() {
        const v = dest.value;
        clear(dest).append(...opts.destinatari().map(([value, label]) => el('option', { value, text: label, selected: value === v })));
        clear(list).append(...feed.map((m) => el('li', { class: (m.dado ? 'dado' : '') + (m.privato ? ' privato' : '') },
          el('span', { class: 'muted small', text: oraTesto(m.ora) + ' ' }), pallino(m.colore), el('b', { text: m.da }),
          m.privato ? el('span', { class: 'tag small', text: '🔒 ' + (m.a ? 'a ' + m.a : 'privato') }) : null,
          el('span', { text: (m.dado ? ' 🎲 ' : ': ') + m.testo }))));
        list.scrollTop = list.scrollHeight;
      },
    };
    chatBoxes.add(box);
    box.refresh();
    return box;
  }
  // Dado di un altro: animazione con mostraTiro, riga nel feed (e nel log del combattimento, sul master).
  function dadoRicevuto(m, sulMaster) {
    DnD.uiDadi.mostraTiro(Object.assign({}, m.tiro, { categoria: 'combattimento' }));
    aggiungiFeed({ da: m.da, colore: m.colore, testo: tiroTesto(m.tiro), dado: true });
    if (!sulMaster) return;
    const c = DnD.sessioni.current(DnD.store.state).combat;
    if (!c) return;
    DnD.store.update(() => DnD.dati.pushLog(c, 'sistema', '🎲 ' + m.da + ' (online): ' + tiroTesto(m.tiro)));
    if (document.querySelector('.combat-screen') && !document.querySelector('.online-screen')) DnD.sezioni.combattimento.render();
  }

  // ---------- Finestra «Gioco online» ----------
  function apri() {
    if (gioc) return;
    if (master) { pannello(true); return; }
    const p = profilo();
    const nome = textInput(p.nome, { maxlength: 30, placeholder: 'Come ti vedranno gli altri', 'aria-label': 'Nome visualizzato' });
    const colore = el('input', { type: 'color', value: p.colore, 'aria-label': 'Colore' });
    const semplici = el('input', { type: 'checkbox', checked: !p.comprimi });
    const leggi = () => { const q = { nome: NET().protocollo.pulisciTesto(nome.value, 30).replace(/\n/g, ' ') || 'Senza nome', colore: colore.value, comprimi: !semplici.checked }; salvaProfilo(q); return q; };
    const S = NET().segnalazione;
    const env = S.ambiente();
    const d = openDialog('Gioco online', el('div', { class: 'form online-start' },
      el('p', { class: 'muted small', text: 'Collegamento diretto tra browser (WebRTC), senza server e senza account: master e giocatore si scambiano due codici (per esempio nella chat che usate già). Il giocatore vede il combattimento in sola lettura.' }),
      env.RTCPeerConnection ? null : el('p', { class: 'error-text', text: 'Questo browser non supporta WebRTC: il gioco online non è disponibile. Ripiego: condividi lo schermo.' }),
      field('Nome visualizzato', nome), field('Colore', colore),
      el('label', { class: 'check small', title: 'Per i browser che non sanno decomprimere i codici (codici più lunghi)' }, semplici, ' Codici senza compressione'),
      el('div', { class: 'online-choice' },
        el('button', { type: 'button', class: 'btn primary', text: '🏠 Ospita (master)', disabled: !env.RTCPeerConnection, onclick: () => { const q = leggi(); d.dismiss(); avviaMaster(q); nuovoInvito(); } }),
        el('button', { type: 'button', class: 'btn primary', text: '🔗 Unisciti (giocatore)', disabled: !env.RTCPeerConnection, onclick: () => { const q = leggi(); d.dismiss(); unisciti(q); } })),
      el('button', { type: 'button', class: 'btn small', text: '🩺 Test connessione', onclick: () => { d.dismiss(); testConnessione(); } })));
    nome.focus();
  }

  // ---------- Master ----------
  function avviaMaster(q) {
    if (master) return;
    const s = NET().sessione.master({
      nome: q.nome, stato: () => DnD.store.state,
      suRichiesta: richiestaDialog,
      suCambio: (e) => {
        if (e && e.evento === 'entrato') { suona('online-entra'); toast(e.giocatore.nome + ' è entrato nella sessione.', 'success'); }
        if (e && e.evento === 'disconnesso') { suona('online-disconnessione'); toast(e.giocatore.nome + ' si è disconnesso: può rientrare con un nuovo invito.', 'error'); }
        aggiornaPannello();
      },
      suChat: (m) => { aggiungiFeed(m); suona('online-chat'); },
      suDado: (m) => dadoRicevuto(m, true),
      suErrore: (t) => toast(t, 'error'),
      immagine: (id) => DnD.immagini.get(id),
    });
    master = { s, q, attesa: null, registro: NET().codici.registro(), timer: setInterval(() => { s.battito(); aggiornaPannello(); }, BATTITO_MS) };
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
    const btn = el('button', { type: 'button', class: 'btn primary', text: 'Collega', onclick: async () => {
      btn.disabled = true;
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
        btn.disabled = false;
      }
    } });
    fill(body,
      el('p', {}, el('b', { text: '1. ' }), 'Manda questo codice di invito al giocatore. Vale ' + NET().codici.DURATA / 60000 + ' minuti e una sola volta.'),
      campoCodice(invito.codice),
      invito.candidati.stun ? null : el('p', { class: 'small warning-text', text: '⚠ Nessun indirizzo pubblico trovato (STUN): il collegamento funzionerà probabilmente solo nella stessa rete. Vedi «Test connessione».' }),
      el('p', {}, el('b', { text: '2. ' }), 'Il giocatore lo incolla in «Unisciti» e ti manda il suo codice di risposta: incollalo qui.'),
      risposta, el('div', { class: 'form-actions' }, btn), stato);
  }

  function richiestaDialog(r) {
    suona('online-richiesta');
    const pgs = DnD.sessioni.visible(DnD.store.state, 'players');
    const usati = new Set(master.s.giocatori().filter((g) => g.stato === 'attivo').map((g) => g.personaggioId).filter(Boolean));
    const pre = r.rientro ? r.rientro.personaggioId : (pgs.find((p) => !usati.has(p.id) && p.sheet && p.sheet.playerName && p.sheet.playerName.trim().toLowerCase() === r.nome.toLowerCase()) || {}).id;
    const sel = el('select', {}, el('option', { value: '', text: '— nessuno (spettatore) —' }),
      pgs.map((p) => el('option', { value: p.id, text: p.name + (usati.has(p.id) ? ' (già assegnato)' : ''), selected: p.id === pre })));
    let risposto = false;
    const d = openDialog('Richiesta di ingresso', el('div', { class: 'form' },
      el('p', {}, pallino(r.colore), ' ', el('b', { text: r.nome }), ' vuole entrare nella sessione.'),
      r.rientro ? el('p', { class: 'small', text: '↩ Rientro: era già nella sessione ed è caduto. Accettando riprende lo stesso posto (nome, colore e personaggio).' }) : null,
      field('Personaggio (vedrà la sua scheda in sola lettura)', sel)), [
      { text: 'Rifiuta', class: 'danger', onclick: () => { risposto = true; r.rifiuta(); } },
      { text: 'Accetta', class: 'primary', onclick: () => { risposto = true; r.accetta({ personaggioId: sel.value || null }); } },
    ]);
    d.addEventListener('close', () => { if (!risposto) r.rifiuta('Il master ha chiuso la richiesta.'); });
  }

  // Pannello del master: barra in basso a sinistra, si apre con i giocatori, le azioni e la chat.
  function pannello(aperto) {
    if (!master) return;
    if (!master.dom) {
      const m = master.dom = {};
      m.head = el('button', { type: 'button', class: 'online-head', 'aria-expanded': 'false', onclick: () => pannello(!m.root.classList.contains('open')) });
      m.righe = el('ul', { class: 'online-players' });
      m.pf = el('input', { type: 'checkbox', onchange: () => { master.s.impostaPfNemici(m.pf.checked); master.s.aggiorna(); } });
      m.invita = el('button', { type: 'button', class: 'btn small primary', text: '➕ Invita un giocatore', onclick: nuovoInvito });
      m.chat = chatBox({
        destinatari: () => [['', 'A tutti']].concat(master ? master.s.giocatori().filter((g) => g.stato === 'attivo').map((g) => [g.id, 'Solo a ' + g.nome]) : []),
        invia: (testo, a) => {
          const msg = master && master.s.chat(testo, a || null);
          if (!msg) return null;
          const g = a ? master.s.giocatori().find((x) => x.id === a) : null;
          return Object.assign(msg, { a: g ? g.nome : '' });
        },
      });
      m.body = el('div', { class: 'online-body' },
        m.righe,
        el('div', { class: 'online-actions' }, m.invita,
          el('label', { class: 'check small', title: 'Di base i giocatori vedono solo «illeso / ferito / grave / a terra»' }, m.pf, ' Mostra i PF dei nemici'),
          el('button', { type: 'button', class: 'btn small', text: '🩺 Test connessione', onclick: testConnessione }),
          el('button', { type: 'button', class: 'btn small danger', text: '⏹ Termina sessione', onclick: terminaMaster })),
        m.chat.node);
      m.root = el('aside', { class: 'online-panel', 'aria-label': 'Sessione online' }, m.head, m.body);
      document.body.append(m.root);
    }
    master.dom.root.classList.toggle('open', Boolean(aperto));
    master.dom.head.setAttribute('aria-expanded', String(Boolean(aperto)));
    aggiornaPannello();
  }
  function aggiornaPannello() {
    if (!master || !master.dom) return;
    const m = master.dom;
    const lista = master.s.giocatori().filter((g) => g.stato !== 'attesa');
    const attivi = lista.filter((g) => g.stato === 'attivo');
    const peggiore = attivi.some((g) => g.linea === 'rosso') ? 'rosso' : attivi.some((g) => g.linea === 'giallo') ? 'giallo' : attivi.length ? 'verde' : 'grigio';
    fill(m.head, lineaDot(peggiore), ' 🌐 Online · ' + attivi.length + (attivi.length === 1 ? ' giocatore' : ' giocatori'), el('span', { class: 'muted small', text: m.root.classList.contains('open') ? ' ▾' : ' ▴' }));
    m.invita.disabled = attivi.length >= NET().sessione.MAX_GIOCATORI;
    if (!m.root.classList.contains('open')) return;
    // Le righe si ricostruiscono solo se cambia qualcosa di strutturale (così il menù del personaggio non si chiude).
    const firma = JSON.stringify(lista.map((g) => [g.id, g.nome, g.stato, g.personaggioId]));
    if (firma !== m.firma) {
      m.firma = firma;
      const pgs = DnD.sessioni.visible(DnD.store.state, 'players');
      fill(m.righe, lista.length ? lista.map((g) => el('li', { 'data-id': g.id },
        el('span', { class: 'online-dot-slot' }), pallino(g.colore), el('b', { text: g.nome }),
        el('span', { class: 'muted small', text: g.stato === 'disconnesso' ? ' disconnesso' : '' }),
        el('span', { class: 'online-lat small muted' }),
        g.stato === 'attivo' ? el('select', { class: 'small', 'aria-label': 'Personaggio di ' + g.nome, onchange: (e) => master.s.assegna(g.id, e.target.value) },
          el('option', { value: '', text: '— spettatore —' }), pgs.map((p) => el('option', { value: p.id, text: p.name, selected: p.id === g.personaggioId }))) : null,
        g.stato === 'attivo' ? el('button', { type: 'button', class: 'btn small', text: '📡 Eco', title: 'Prova di eco: tempo di andata e ritorno', onclick: () => master.s.eco(g.id) }) : null,
        el('button', { type: 'button', class: 'btn small danger', text: g.stato === 'attivo' ? 'Espelli' : 'Dimentica', onclick: () => {
          if (g.stato !== 'attivo' || confirm('Espellere ' + g.nome + ' dalla sessione?')) master.s.espelli(g.id);
        } }))) : [el('li', { class: 'muted small', text: 'Nessun giocatore: premi «Invita un giocatore».' })]);
    }
    for (const g of lista) {
      const li = m.righe.querySelector('[data-id="' + g.id + '"]');
      if (!li) continue;
      fill(li.querySelector('.online-dot-slot'), lineaDot(g.stato === 'attivo' ? g.linea : 'grigio'));
      li.querySelector('.online-lat').textContent = g.stato !== 'attivo' ? '' : ' ' + (g.latenza !== null ? g.latenza + ' ms' : '…') + (g.eco !== null ? ' · eco ' + g.eco + ' ms' : '');
    }
    m.chat.refresh();
  }
  function terminaMaster() {
    if (!master || !confirm('Terminare la sessione online? I giocatori verranno scollegati.')) return;
    master.s.termina();
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
  function unisciti(q) {
    const invito = el('textarea', { class: 'code-box', rows: 4, spellcheck: false, placeholder: 'Incolla qui il codice di invito del master', 'aria-label': 'Codice di invito' });
    const out = el('div');
    const stato = el('p', { class: 'small', 'aria-live': 'polite' });
    let tentativo = null;
    let fatto = false;
    const btn = el('button', { type: 'button', class: 'btn primary', text: 'Crea la risposta', onclick: async () => {
      btn.disabled = true;
      stato.className = 'small';
      stato.textContent = 'Leggo l\'invito e preparo la risposta (qualche secondo)…';
      try {
        tentativo = await NET().segnalazione.manuale.unisciti(invito.value, { comprimi: q.comprimi, maxRicevuto: NET().protocollo.LIMITI.daMaster });
      } catch (e) {
        stato.className = 'small error-text';
        stato.textContent = e.message;
        btn.disabled = false;
        return;
      }
      invito.readOnly = true;
      fill(out, el('p', {}, el('b', { text: '2. ' }), 'Manda questo codice di risposta a ' + (tentativo.master || 'il master') + '. Quando lo incolla, il collegamento parte da solo.'),
        campoCodice(tentativo.codice));
      stato.textContent = '⏳ In attesa del master…';
      tentativo.connessione.then((t) => { fatto = true; d.dismiss(); entraComeGiocatore(q, t); })
        .catch((e) => { stato.className = 'small error-text'; stato.textContent = e.message; });
    } });
    const d = openDialog('Unisciti a una sessione', el('div', { class: 'form online-codes' },
      el('p', {}, el('b', { text: '1. ' }), 'Incolla il codice di invito che ti ha mandato il master.'), invito,
      el('div', { class: 'form-actions' }, btn), out, stato));
    d.addEventListener('close', () => { if (tentativo && !fatto) tentativo.annulla(); });
    invito.focus();
  }

  function entraComeGiocatore(q, t) {
    gioc = { q, dom: null, grid: null, doc: null, tsIndex: {}, icone: new Map(), finita: false, avanz: null };
    gioc.chat = chatBox({
      destinatari: () => [['', 'A tutti'], ['master', 'Solo al master']],
      invia: (testo, a) => (gioc && !gioc.finita ? gioc.s.chat(testo, a === 'master') : null),
    });
    gioc.s = NET().sessione.giocatore({
      nome: q.nome, colore: q.colore, trasporto: t,
      suCambio: () => renderGiocatore(),
      suChat: (m) => { aggiungiFeed(m); suona('online-chat'); },
      suDado: (m) => dadoRicevuto(m, false),
      suFine: (motivo, stato) => fineGiocatore(motivo, stato),
      suErrore: (testo) => toast(testo, 'error'),
      suAvanzamento: avanzamento,
      archivio: {
        ha: async (id) => { const data = await DnD.immagini.get(id); if (data) gioc.icone.set(id, data); return Boolean(data); },
        metti: async (id, data) => { await DnD.immagini.put(data); gioc.icone.set(id, data); },
      },
    });
    gioc.timer = setInterval(() => { if (gioc && !gioc.finita) { gioc.s.battito(); aggiornaLinea(); } }, BATTITO_MS);
    // Dadi condivisi: il tiro del menù Dadi parte verso il master (che lo mostra a tutti nel log).
    DnD.uiDadi.suTiro = (tiro) => {
      if (!gioc || gioc.finita) return;
      gioc.s.dado(tiro);
      aggiungiFeed({ da: q.nome, colore: q.colore, testo: tiroTesto(tiro), dado: true });
    };
    document.body.classList.add('online-giocatore');
    document.querySelectorAll('dialog[open]').forEach((x) => x.close());
    renderGiocatore();
  }

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
  // Documento per la griglia in sola vista: griglia ricevuta normalizzata (confine di fiducia) e pedine.
  function documento(c) {
    const g = c.griglia || {};
    let grid;
    try {
      grid = Object.assign(DnD.dati.normalizeGridContent({ w: g.w, h: g.h, feetPerCell: g.feetPerCell, background: g.background, structures: g.structures, items: g.items, labels: g.labels, tileMap: g.tileMap, kind: g.kind }), { ignoreCollisions: true });
    } catch (e) {
      grid = Object.assign(DnD.dati.normalizeGridContent({ w: 10, h: 10 }), { ignoreCollisions: true });
    }
    const combatants = (Array.isArray(c.pedine) ? c.pedine : []).filter((p) => p && p.pos).map((p) => ({
      id: String(p.id), name: String(p.nome || ''), icon: iconaDi(p.icona), kind: p.lato === 'giocatore' ? 'player' : 'npc', faction: String(p.fazione || ''),
      pos: { x: intero(p.pos.x, 0, grid.w - 1, 0), y: intero(p.pos.y, 0, grid.h - 1, 0) }, w: intero(p.w, 1, 10, 1), h: intero(p.h, 1, 10, 1),
      hp: Number.isFinite(p.pf) ? p.pf : SALUTE_PF[p.salute] !== undefined ? SALUTE_PF[p.salute] : 4, maxHp: Number.isFinite(p.pfMax) && p.pfMax > 0 ? p.pfMax : 4,
      dead: Boolean(p.morto), conditions: [], concentration: null,
    }));
    try { gioc.tsIndex = DnD.tilemap.tilesetIndex((Array.isArray(c.tilesets) ? c.tilesets : []).map((t) => DnD.dati.normalizeTileset(t))); } catch (e) { gioc.tsIndex = {}; }
    return { id: 'online', grid, combatants, currentId: c.turno || null };
  }
  // Nebbia del giocatore: celle sconosciute coperte, esplorate velate (stati dal master: 0, 1, 2).
  function disegnaNebbia(ctx, view, s) {
    const v = gioc && gioc.s.stato().vista;
    const c = v && v.combattimento;
    const cells = c && typeof c.griglia.cells === 'string' ? c.griglia.cells : '';
    if (!cells || !/[01]/.test(cells)) return;
    const w = gioc.doc.grid.w;
    const cs = getComputedStyle(document.documentElement);
    const fog = cs.getPropertyValue('--vision-fog-player').trim() || '6, 7, 10';
    ctx.save();
    for (let i = 0; i < cells.length && i < w * gioc.doc.grid.h; i++) {
      const st = cells.charCodeAt(i) - 48;
      if (st === 2) continue;
      ctx.fillStyle = 'rgba(' + fog + ',' + (st === 0 ? 1 : 0.55) + ')';
      ctx.fillRect(view.panX + (i % w) * s, view.panY + Math.floor(i / w) * s, s + 0.5, s + 0.5);
    }
    ctx.restore();
  }

  function scheletro() {
    const d = gioc.dom = {};
    d.dot = el('span', { class: 'online-dot-slot' });
    d.linea = el('span', { class: 'small muted' });
    d.avanzBar = el('progress', { max: 100, value: 0 });
    d.avanz = el('div', { class: 'online-progress', hidden: true, role: 'status' }, el('span', { text: 'Scarico la mappa… ' }), d.avanzBar);
    d.cards = el('div', { class: 'combatants' });
    d.turni = el('section', { class: 'panel turn-panel' });
    d.log = el('ol', { class: 'log' });
    d.scheda = el('section', { class: 'panel online-scheda' });
    d.presenza = el('div', { class: 'online-presence small' });
    d.vuoto = el('div', { class: 'panel online-empty' });
    gioc.grid = DnD.uiGriglia.create({
      getDoc: () => gioc.doc, update: () => {}, readOnly: true, tools: ['misura'], showCombatants: false,
      tilesets: () => gioc.tsIndex, overlay: disegnaNebbia, tokenActions: () => [],
    });
    d.center = el('div', { class: 'combat-center' }, d.vuoto, gioc.grid.node);
    const cols = DnD.uiCombattimento.columns({
      key: 'dnd-battaglie:layout-online',
      left: { title: 'Entità', body: [d.cards] },
      center: d.center,
      right: { title: 'Turni', head: [el('button', { type: 'button', class: 'btn small dice-inline', text: '🎲 Dadi', title: 'Tira i dadi: il risultato va a tutti', onclick: () => DnD.uiDadi.openPanel() })],
        body: [d.turni, el('section', { class: 'panel log-panel' }, el('h2', { text: 'Log' }), d.log), gioc.chat.node, d.scheda] },
    });
    d.root = el('div', { class: 'combat-screen online-screen' },
      el('div', { class: 'section-head' },
        el('h1', { text: 'Sessione online' }),
        el('div', { class: 'head-actions' },
          el('span', { class: 'online-status' }, d.dot, ' ', d.linea), d.presenza,
          el('button', { type: 'button', class: 'btn small', text: '📡 Eco', title: 'Prova di eco con il master', onclick: () => { gioc.s.eco(); setTimeout(aggiornaLinea, 1500); } }),
          el('button', { type: 'button', class: 'btn small', text: '🩺 Test connessione', onclick: testConnessione }),
          el('button', { type: 'button', class: 'btn small danger', text: 'Esci', onclick: () => { if (confirm('Uscire dalla sessione online?')) gioc.s.esci(); } }))),
      d.avanz, cols.layout);
    fill(document.getElementById('main'), d.root);
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
    // Immagine pronta: sfondo e tile si ridisegnano, le icone si aggiornano.
    if (a.pronta) renderGiocatore();
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
      p.morte ? el('p', { class: 'small', text: p.morte.stabile ? 'Stabile' : 'Tiri contro la morte: ✔ ' + p.morte.successi + ' · ✖ ' + p.morte.fallimenti }) : null);
  }
  function schedaNode(sc) {
    if (!sc) return [el('h2', { text: 'Scheda' }), el('p', { class: 'muted small', text: 'Nessun personaggio assegnato: segui la partita come spettatore.' })];
    const fmt = (n) => (n === null || n === undefined ? '—' : DnD.regole.formatModifier(n));
    return [
      el('h2', { text: 'Scheda: ' + sc.nome }),
      el('p', { class: 'muted small', text: [sc.razza, sc.classe, 'livello ' + sc.livello].filter(Boolean).join(' · ') }),
      el('div', { class: 'online-stats' },
        [['CA', sc.ca], ['PF', sc.pf + '/' + sc.pfMax], ['Iniziativa', fmt(sc.iniziativa)], ['Velocità', sc.velocita !== null ? String(sc.velocita).replace('.', ',') + ' m' : '—'],
          ['Competenza', fmt(sc.competenza)], ['Perc. passiva', sc.percezione], ['Dadi vita', sc.dadiVita]]
          .map(([k, v]) => el('div', { class: 'online-stat' }, el('small', { text: k }), el('b', { text: v === null || v === undefined ? '—' : String(v) })))),
      sc.caratteristiche.length ? el('div', { class: 'online-abilities' }, sc.caratteristiche.map((a) => el('div', { class: 'online-stat' },
        el('small', { text: a.nome }), el('b', { text: String(a.valore) }), el('span', { class: 'small muted', text: fmt(a.mod) + ' · TS ' + fmt(a.ts) + (a.competente ? ' ●' : '') })))) : null,
      el('p', { class: 'small', text: 'Condizioni: ' + (sc.condizioni.length ? sc.condizioni.join(', ') : 'nessuna') }),
    ];
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
    fill(d.presenza, (s.presenza || []).map((p) => el('span', { class: 'online-who', title: p.stato === 'master' ? 'Master' : p.stato }, pallino(p.colore), ' ' + p.nome + (p.stato === 'master' ? ' (master)' : p.stato === 'disconnesso' ? ' (disconnesso)' : ''))));
    fill(d.scheda, schedaNode(v.scheda));
    const attivo = Boolean(c && c.fase === 'attivo');
    d.vuoto.hidden = attivo;
    gioc.grid.node.hidden = !attivo;
    if (!attivo) {
      fill(d.vuoto, el('h2', { text: c ? 'Si tira l\'iniziativa…' : 'Nessun combattimento in corso' }),
        el('p', { class: 'muted', text: c ? 'Il combattimento comincia tra poco.' : v.master + ' non ha ancora iniziato un combattimento. Intanto puoi scrivere in chat e tirare i dadi.' }));
      clear(d.cards); clear(d.log);
      fill(d.turni, el('div', { class: 'muted small', text: 'In attesa del combattimento.' }));
    } else {
      const corrente = c.pedine.find((p) => p.id === c.turno) || null;
      fill(d.cards, c.pedine.map((p) => cartaPedina(p, p.id === c.turno)));
      fill(d.turni,
        el('div', { class: 'round' }, 'Round ', el('b', { text: String(c.round) })),
        el('div', { class: 'muted', text: corrente ? 'Turno di ' + corrente.nome + (corrente.mia ? ' (tu!)' : '') : 'Turno di qualcuno che non vedi' }),
        c.boss.length ? el('div', { class: 'online-boss small' }, c.boss.map((b) => el('div', {}, '👑 ', el('b', { text: b.nome }), b.titolo ? ' — ' + b.titolo : '', ' · fase ' + b.fase + ' · ' + (Number.isFinite(b.pf) ? b.pf + '/' + b.pfMax + ' PF' : b.salute)))) : null,
        el('ol', { class: 'turn-order' }, c.pedine.map((p) => el('li', { class: (p.id === c.turno ? 'current ' : '') + (p.aTerra ? 'down ' : '') + (p.lato === 'giocatore' ? 'player' : 'npc') },
          el('span', { class: 'init', text: String(p.iniziativa) }), el('span', { class: 'name', text: p.nome }),
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

  function fineGiocatore(motivo, stato) {
    if (!gioc) return;
    gioc.finita = true;
    clearInterval(gioc.timer);
    DnD.uiDadi.suTiro = null;
    suona('online-disconnessione');
    const v = gioc.s.stato().vista;
    const titolo = stato === 'rifiutato' ? 'Ingresso rifiutato' : stato === 'espulso' ? 'Sei stato espulso' : 'La sessione è terminata';
    const esporta = () => {
      const righe = ['Sessione online' + (v ? ' con ' + v.master : '') + ' — ' + new Date().toLocaleString('it-IT'), ''];
      if (v && v.combattimento) righe.push('Log del combattimento:', ...v.combattimento.log.map((e) => 'R' + e.round + ' ' + e.testo), '');
      righe.push('Chat e dadi:', ...feed.map((m) => oraTesto(m.ora) + ' ' + m.da + (m.privato ? ' (privato)' : '') + (m.dado ? ' 🎲 ' : ': ') + m.testo));
      DnD.uiImpostazioni.download(righe.join('\n'), 'sessione-online-' + DnD.uiImpostazioni.today() + '.txt', 'text/plain');
    };
    fill(document.getElementById('main'), el('div', { class: 'panel online-wait' },
      el('h1', { text: titolo }), el('p', { text: motivo || '' }),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: '⬇ Esporta il log', onclick: esporta }),
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
    const stun = el('textarea', { rows: 2, class: 'code-box', spellcheck: false, 'aria-label': 'Server STUN, uno per riga' });
    stun.value = S.stun().join('\n');
    const problemi = [
      ['«Collegamento non riuscito» dopo lo scambio dei codici', 'La rete (ufficio, scuola, alcuni operatori mobili) blocca il collegamento diretto. Provate un\'altra rete, per esempio l\'hotspot del telefono. Ripiego consigliato: condividete lo schermo con il programma di videochiamata che usate già.'],
      ['«Codice scaduto» o «già usato»', 'I codici valgono ' + NET().codici.DURATA / 60000 + ' minuti e una volta sola: il master crea un nuovo invito (anche per far rientrare chi è caduto).'],
      ['«Codice non valido» o «danneggiato»', 'Copiatelo per intero, senza tagli né spazi aggiunti: meglio con il pulsante «Copia».'],
      ['«Versione incompatibile»', 'Master e giocatore usano versioni diverse dell\'app: aggiornate entrambi la pagina (Ctrl+F5).'],
      ['Pagina aperta da file (file://)', 'Appunti e cache offline non funzionano. Servite la cartella in locale (python -m http.server) oppure pubblicatela gratis su un sito statico (per esempio GitHub Pages).'],
    ];
    openDialog('Test connessione', el('div', { class: 'online-test' },
      el('h3', { text: 'Requisiti' }),
      el('ul', { class: 'online-req' }, req.map((r) => el('li', { class: r.ok ? 'ok' : 'ko' }, el('span', { text: r.ok ? '✔ ' : '✖ ' }), el('b', { text: r.nome }), r.nota ? el('div', { class: 'small muted', text: r.nota }) : null))),
      el('h3', { text: 'Rete' }), analizza, rete,
      el('h3', { text: 'Prova di eco' }), eco, ecoOut,
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

  DnD.uiOnline = {
    apri, testConnessione,
    vistaGiocatore: () => Boolean(gioc),
    attivo: () => Boolean(master || gioc),
  };
})(globalThis.DnD = globalThis.DnD || {});
