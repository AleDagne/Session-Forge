// Portale (schermata iniziale): titolo dell'app, selettore del profilo (Nuovo, Modifica, Duplica, Elimina, PIN
// locale), tema e impostazioni, tre carte (Crea e gestisci, Unisciti, Ospita), riquadro «Riprendi» (ultima sessione,
// recenti, partite online con «Rientra», «Riconnetti» dopo un ricaricamento), avvisi di migrazione e backup, guida del
// primo avvio; schermate «Ospita» (scelta della sessione) e «Unisciti». Livello interfaccia: usa DnD.archivio.profili
// per i profili, DnD.uiOnline per la rete (senza riscriverla), DnD.uiBackup per lo stato dei backup. Espone DnD.uiPortale.
(function (DnD) {
  'use strict';

  const { el, fill, toast, openDialog, field, textInput, svgIcon, openMenu } = DnD.ui;
  const C = DnD.config;
  const L = DnD.archivioLocale;
  const PR = DnD.profili;
  const I = DnD.impostazioni;
  const gestore = () => DnD.archivio.profili;
  const online = () => DnD.uiOnline;

  // Icone delle carte (SVG 24×24 a tratto, come il menù).
  const ICONE = {
    master: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5', 'M9 7h7', 'M9 11h5'],
    unisciti: ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'M10 17l5-5-5-5', 'M15 12H3'],
    ospita: ['M2 20h20', 'M5 20V9l7-5 7 5v11', 'M9 20v-6h6v6', 'M12 2v2', 'M4.5 5.5l1.4 1.4', 'M19.5 5.5l-1.4 1.4'],
    profilo: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-7 8-7s8 3 8 7'],
  };
  let avvio = null;          // esito della migrazione all'avvio (avvisi del portale)
  let avvisoMigrazione = true;

  const dataOra = (t) => (t ? new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const profiloAttivo = () => (gestore() ? gestore().attivo() : null);
  const bloccato = () => { const p = profiloAttivo(); return Boolean(p && p.pin && !L.sbloccato(p.id)); };
  const saltaPortale = () => Boolean(gestore() && gestore().portale().salta) && !bloccato();

  function avatar(p, grande) {
    const cls = 'portale-avatar' + (grande ? ' grande' : '');
    if (p && p.avatar && p.avatar.tipo === 'immagine') return el('img', { class: cls, src: p.avatar.dati, alt: '', style: 'border-color:' + p.colore });
    return el('span', { class: cls, 'aria-hidden': 'true', style: 'border-color:' + (p ? p.colore : 'var(--border)'), text: p && p.avatar ? p.avatar.id : '🧙' });
  }

  // ---------- Profili ----------
  // Salva le scritture in sospeso, cambia il profilo attivo e ricarica: ogni modulo legge l'archivio del nuovo profilo.
  async function attiva(id) {
    const ospitando = online().ospitando();
    if (ospitando) {
      if (!confirm('Stai ospitando una partita online: per cambiare profilo devi chiudere la sessione online. Chiuderla ora?')) return;
      online().termina();
      if (online().ospitando()) return;
    }
    const p = gestore().elenco().find((x) => x.id === id);
    if (!p) return;
    if (p.pin && !L.sbloccato(p.id) && !(await chiediPin(p))) return;
    const notes = DnD.app.notes();
    if (notes) notes.flush();
    await DnD.store.saved();
    try {
      gestore().attiva(id);
    } catch (e) {
      toast('Profilo non cambiato: ' + DnD.archivio.saveErrorMessage(e), 'error');
      return;
    }
    location.hash = '#/home';
    location.reload();
  }

  // Chiede il PIN di un profilo. Restituisce true se è giusto (e sblocca il profilo in questa scheda).
  function chiediPin(p) {
    return new Promise((resolve) => {
      const input = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, pattern: '[0-9]*', 'aria-label': 'PIN' });
      const errore = el('p', { class: 'error-text small', 'aria-live': 'assertive' });
      let fatto = false;
      const prova = async () => {
        if (await PR.verificaPin(input.value, p.pin)) {
          fatto = true;
          L.sblocca(p.id);
          d.dismiss();
          resolve(true);
          return;
        }
        errore.textContent = 'PIN errato.';
        input.select();
      };
      const d = openDialog('PIN del profilo «' + p.nome + '»', el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); prova(); } },
        field('PIN (4-8 cifre)', input), errore,
        el('p', { class: 'muted small', text: 'Il PIN non si può recuperare. Se l\'hai dimenticato puoi solo eliminare il profilo (con tutti i suoi dati) da un altro profilo.' }),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn primary', text: 'Sblocca' }))));
      d.addEventListener('close', () => { if (!fatto) resolve(false); });
      input.focus();
    });
  }

  // Immagine dell'avatar ridotta a 96 px (data URL piccolo, sta nel registro dei profili).
  function riduciImmagine(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Impossibile leggere il file.'));
      r.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Immagine non valida.'));
        img.onload = () => {
          const lato = 96;
          const c = document.createElement('canvas');
          c.width = lato;
          c.height = lato;
          const s = Math.min(img.width, img.height);
          c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, lato, lato);
          resolve(c.toDataURL('image/png'));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  // Nuovo profilo (p null) o modifica: nome, colore, avatar, ruolo preferito, PIN locale.
  function editor(p) {
    const nuovo = !p;
    const dati = p ? JSON.parse(JSON.stringify(p)) : { nome: '', colore: PR.COLORI[gestore().elenco().length % PR.COLORI.length], avatar: { tipo: 'icona', id: PR.ICONE[0] }, ruolo: 'master', pin: null };
    let pinNuovo = undefined; // undefined = invariato, null = rimosso, oggetto = nuovo PIN
    const nome = textInput(dati.nome, { maxlength: 30, 'data-key': 'nome', placeholder: 'es. Giulia' });
    const colore = el('input', { type: 'color', value: dati.colore, 'aria-label': 'Colore del profilo' });
    const anteprima = el('span', { class: 'portale-anteprima' });
    const aggiorna = () => fill(anteprima, avatar(Object.assign({}, dati, { colore: colore.value }), true));
    colore.addEventListener('input', aggiorna);
    const icone = el('div', { class: 'portale-icone', role: 'radiogroup', 'aria-label': 'Avatar' }, PR.ICONE.map((ic) => el('button', {
      type: 'button', class: 'portale-icona', role: 'radio', 'aria-checked': String(dati.avatar.tipo === 'icona' && dati.avatar.id === ic), 'aria-label': 'Avatar ' + ic, text: ic,
      onclick: (e) => {
        dati.avatar = { tipo: 'icona', id: ic };
        for (const b of icone.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
        aggiorna();
      },
    })));
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        dati.avatar = PR.normalizzaAvatar({ tipo: 'immagine', dati: await riduciImmagine(f) });
        for (const b of icone.children) b.setAttribute('aria-checked', 'false');
        aggiorna();
      } catch (e) { toast(e.message, 'error'); }
    } });
    const ruolo = el('select', { 'aria-label': 'Ruolo preferito' }, PR.RUOLI.map((r) => el('option', { value: r, text: PR.NOMI_RUOLI[r], selected: r === dati.ruolo })));
    const statoPin = el('p', { class: 'small' });
    const pin1 = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 8, 'aria-label': 'Nuovo PIN' });
    const pin2 = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 8, 'aria-label': 'Ripeti il PIN' });
    const rimuovi = el('button', { type: 'button', class: 'btn small', text: 'Rimuovi il PIN', onclick: () => { pinNuovo = null; syncPin(); } });
    function syncPin() {
      const ha = pinNuovo === undefined ? Boolean(dati.pin) : Boolean(pinNuovo);
      statoPin.textContent = ha ? '🔒 Questo profilo ha un PIN.' : 'Nessun PIN.';
      rimuovi.hidden = !ha;
    }
    syncPin();
    aggiorna();
    const corpo = el('form', { class: 'form portale-editor', onsubmit: (e) => { e.preventDefault(); salva(); } },
      el('div', { class: 'portale-editor-testa' }, anteprima, el('div', { class: 'portale-editor-campi' }, field('Nome visualizzato', nome, 'nome'), field('Colore', colore))),
      el('fieldset', { class: 'settings-group' }, el('legend', { text: 'Avatar' }), icone,
        el('button', { type: 'button', class: 'btn small', text: '🖼 Usa un\'immagine…', onclick: () => file.click() }), file),
      field('Ruolo preferito', ruolo, null, 'Solo un suggerimento: ogni profilo può fare il Master, giocare o guardare.'),
      el('details', { class: 'settings-group' }, el('summary', { text: 'PIN locale (facoltativo)' }),
        el('p', { class: 'warning-text small', text: '⚠ Il PIN non è sicuro contro chi usa lo stesso PC: i dati restano leggibili nel browser. Serve solo a non aprire per sbaglio il profilo di un altro.' }),
        el('p', { class: 'muted small', text: 'Il PIN non si può recuperare: se lo dimentichi, l\'unico ripiego è eliminare il profilo (e i suoi dati).' }),
        statoPin, field('Nuovo PIN (4-8 cifre)', pin1), field('Ripeti il PIN', pin2), rimuovi));
    const d = openDialog(nuovo ? 'Nuovo profilo' : 'Modifica il profilo', corpo, [
      { text: 'Annulla' },
      { text: nuovo ? 'Crea il profilo' : 'Salva', class: 'primary', onclick: () => { salva(); return false; } },
    ]);
    async function salva() {
      const n = nome.value.trim();
      if (!n) { DnD.ui.showErrors(corpo, { nome: 'Il nome è obbligatorio.' }); nome.focus(); return; }
      if (gestore().elenco().some((x) => x.nome.toLowerCase() === n.toLowerCase() && (!p || x.id !== p.id))) { DnD.ui.showErrors(corpo, { nome: 'Esiste già un profilo con questo nome.' }); return; }
      if (pin1.value || pin2.value) {
        if (pin1.value !== pin2.value) { toast('I due PIN non coincidono.', 'error'); return; }
        try { pinNuovo = await PR.creaPin(pin1.value); } catch (e) { toast(e.message, 'error'); return; }
      }
      const patch = { nome: n, colore: colore.value, avatar: dati.avatar, ruolo: ruolo.value };
      if (pinNuovo !== undefined) patch.pin = pinNuovo;
      try {
        if (nuovo) {
          const creato = gestore().crea(patch);
          if (patch.pin) { gestore().modifica(creato.id, { pin: patch.pin }); L.sblocca(creato.id); } // il PIN appena scelto vale come inserito
          d.dismiss();
          if (confirm('Profilo «' + creato.nome + '» creato. Passare subito al nuovo profilo?')) attiva(creato.id);
          else DnD.app.refreshAll();
        } else {
          gestore().modifica(p.id, patch);
          if (patch.pin && p.id === L.attivo()) L.sblocca(p.id);
          d.dismiss();
          toast('Profilo salvato.', 'success');
          DnD.app.refreshAll();
        }
      } catch (e) {
        toast('Profilo non salvato: ' + DnD.archivio.saveErrorMessage(e), 'error');
      }
    }
    nome.focus();
  }

  async function duplica(p) {
    const nome = prompt('Nome della copia del profilo «' + p.nome + '»:', p.nome + ' (copia)');
    if (!nome || !nome.trim()) return;
    if (p.id === L.attivo()) await DnD.store.saved();
    try {
      const c = await gestore().duplica(p.id, nome.trim().slice(0, 30));
      toast('Profilo «' + c.nome + '» creato come copia (senza PIN).', 'success');
      DnD.app.refreshAll();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function elimina(p) {
    if (online().ospitando() && p.id === L.attivo()) { toast('Chiudi prima la sessione online.', 'error'); return; }
    if (!confirm('Eliminare il profilo «' + p.nome + '»?\nVerranno cancellati da questo browser: sessioni, personaggi, librerie, griglie e immagini, suoni personalizzati, impostazioni, gettoni e note online, collegamento alla cartella di backup.\nI file di backup già salvati restano. Conviene esportare prima l\'archivio.')) return;
    if (!confirm('Ultima conferma: l\'eliminazione non si può annullare. Eliminare «' + p.nome + '»?')) return;
    const eraAttivo = p.id === L.attivo();
    try {
      if (eraAttivo) DnD.store.bloccato = true; // nessuna scrittura ricrea il database che si sta eliminando
      await gestore().elimina(p.id);
    } catch (e) {
      DnD.store.bloccato = false;
      toast('Profilo non eliminato: ' + DnD.archivio.saveErrorMessage(e), 'error');
      return;
    }
    if (eraAttivo) { location.hash = '#/home'; location.reload(); return; }
    toast('Profilo «' + p.nome + '» eliminato.', 'success');
    DnD.app.refreshAll();
  }

  // Menù del profilo: elenco per cambiare, poi Nuovo, Modifica, Duplica, Elimina.
  function menuProfili(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const att = profiloAttivo();
    const lista = gestore().elenco();
    openMenu(r.left, r.bottom + 4, lista.map((p) => ({
      text: (p.id === att.id ? '✓ ' : '   ') + p.nome + (p.pin ? ' 🔒' : '') + ' · ' + PR.NOMI_RUOLI[p.ruolo],
      onclick: () => { if (p.id !== att.id) attiva(p.id); },
    })).concat([
      { text: '＋ Nuovo profilo…', onclick: () => editor(null) },
      { text: '✎ Modifica «' + att.nome + '»…', onclick: () => editor(att) },
      { text: '⧉ Duplica «' + att.nome + '»…', onclick: () => duplica(att) },
    ], lista.filter((p) => p.id !== att.id).map((p) => ({ text: '🗑 Elimina «' + p.nome + '»…', danger: true, onclick: () => elimina(p) })),
    [{ text: '🗑 Elimina il profilo attivo…', danger: true, onclick: () => elimina(att) }]));
  }

  // ---------- Pezzi del portale ----------
  function testa() {
    const p = profiloAttivo();
    const dark = I.isDark();
    return el('header', { class: 'portale-testa' },
      el('h1', { class: 'portale-titolo' }, el('span', { class: 'brand-icon', 'aria-hidden': 'true', text: '⚔' }), ' ', C.APP_NAME),
      el('div', { class: 'portale-strumenti' },
        p ? el('button', { type: 'button', class: 'btn portale-profilo', 'aria-haspopup': 'menu', 'aria-label': 'Profilo: ' + p.nome + '. Cambia o gestisci i profili', onclick: menuProfili },
          avatar(p), el('span', { class: 'portale-profilo-nome', text: p.nome }), el('span', { 'aria-hidden': 'true', text: '▾' })) : null,
        el('button', { type: 'button', class: 'icon-btn footer-btn', title: dark ? 'Passa al tema chiaro' : 'Passa al tema scuro', 'aria-label': dark ? 'Passa al tema chiaro' : 'Passa al tema scuro',
          onclick: () => { I.set({ theme: I.isDark() ? 'chiaro' : 'scuro' }); render(document.getElementById('main'), { schermata: DnD.app.modo() }); } }, svgIcon(C.ICONS[dark ? 'sun' : 'moon'])),
        el('button', { type: 'button', class: 'icon-btn footer-btn', title: 'Impostazioni', 'aria-label': 'Impostazioni', onclick: (e) => DnD.uiImpostazioni.apri(e.currentTarget) }, svgIcon(C.ICONS.gear)),
        DnD.uiBackup ? el('button', { type: 'button', class: 'btn small', text: '💾 Dati e backup', onclick: () => DnD.uiBackup.apri() }) : null));
  }

  function avvisi(schermata, interrottaDaRicarica) {
    const out = [];
    const m = avvio && avvio.migrazione;
    if (m && !m.ok && m.errore) {
      out.push(el('div', { class: 'portale-avviso errore', role: 'alert' }, el('p', { text: m.errore }),
        m.backup ? el('button', { type: 'button', class: 'btn small', text: '⬇ Scarica il backup', onclick: () => scaricaBackupMigrazione(m.backup) }) : null));
    }
    const reg = gestore() ? gestore().registro() : null;
    if (avvisoMigrazione && reg && reg.migrazione && !reg.migrazione.vuoto && !reg.migrazione.backupScaricato) {
      out.push(el('div', { class: 'portale-avviso', role: 'status' },
        el('p', {}, el('b', { text: 'I tuoi dati sono ora nel profilo «Master». ' }), 'Prima di spostarli ho preparato un backup completo: conviene scaricarlo e conservarlo.'),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn small primary', text: '⬇ Scarica il backup', onclick: async () => {
            const t = (m && m.backup) || await DnD.archivio.backupMigrazione();
            if (!t) { toast('Backup non più disponibile: esporta l\'archivio da «Dati e backup».', 'error'); return; }
            scaricaBackupMigrazione(t);
          } }),
          el('button', { type: 'button', class: 'btn small', text: 'Più tardi', onclick: (e) => { avvisoMigrazione = false; e.currentTarget.closest('.portale-avviso').remove(); } }))));
    }
    const int = online().interrotta();
    if (schermata === 'home' && int) {
      out.push(el('div', { class: 'portale-avviso', role: 'status' },
        el('p', { text: (interrottaDaRicarica ? 'La pagina si è ricaricata: ' : '') + (int.ruolo === 'master' ? 'la partita che ospitavi si è interrotta.' : 'la connessione con ' + (int.master || 'il master') + ' si è interrotta.') }),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn small primary', text: '↻ Riconnetti', onclick: () => riconnetti(int) }),
          el('button', { type: 'button', class: 'btn small', text: 'Ignora', onclick: () => { online().dimenticaInterrotta(); render(document.getElementById('main'), { schermata }); } }))));
    }
    if (DnD.uiBackup) out.push(...DnD.uiBackup.avvisiPortale());
    return out.length ? el('div', { class: 'portale-avvisi' }, out) : null;
  }

  function scaricaBackupMigrazione(testo) {
    DnD.ui.download(testo, DnD.ui.slug(C.APP_NAME) + '-backup-prima-dei-profili-' + DnD.ui.today() + '.json');
    try { gestore().segnaMigrazione({ backupScaricato: true }); } catch (e) { /* avviso riproposto */ }
    avvisoMigrazione = false;
    toast('Backup scaricato: controlla la cartella dei download.', 'success');
  }

  function riconnetti(int) {
    online().dimenticaInterrotta();
    if (int.ruolo === 'master') {
      const st = DnD.store.state;
      if (st.sessions.some((s) => s.id === int.sessionId)) DnD.app.switchSession(int.sessionId);
      if (DnD.app.vai({ modo: 'master', sezione: DnD.app.sezione() })) online().ospita(true);
      return;
    }
    online().rientraPartita({ gettone: int.gettone, partita: int.partita });
  }

  function carta(id, titolo, descrizione, stato, onclick, opts) {
    const o = opts || {};
    return el('button', { type: 'button', class: 'portale-carta', 'data-carta': id, disabled: o.disabled, onclick, 'aria-label': titolo + ': ' + descrizione + (stato ? '. ' + stato : '') },
      el('span', { class: 'portale-carta-icona' }, svgIcon(ICONE[id], 40)),
      el('span', { class: 'portale-carta-titolo', text: titolo }),
      el('span', { class: 'portale-carta-testo', text: descrizione }),
      stato ? el('span', { class: 'portale-carta-stato', text: stato }) : null);
  }

  function carte() {
    const st = DnD.store.state;
    const n = st.sessions.length;
    const corrente = DnD.sessioni.current(st);
    const osp = online().ospitando();
    const webrtc = DnD.rete.segnalazione.ambiente().RTCPeerConnection;
    const partite = online().partite();
    return el('section', { class: 'portale-carte', 'aria-label': 'Scegli cosa fare' },
      carta('master', 'Crea e gestisci', 'Prepara sessioni, mappe, personaggi e combattimenti come Master.',
        n + (n === 1 ? ' sessione' : ' sessioni') + ' · corrente: ' + corrente.name, () => DnD.app.vai({ modo: 'master', sezione: DnD.app.sezione() })),
      carta('unisciti', 'Unisciti a una partita', 'Gioca come giocatore o spettatore con il codice di invito del master.',
        !webrtc ? 'WebRTC non disponibile in questo browser' : partite.length ? partite.length + (partite.length === 1 ? ' partita salvata' : ' partite salvate') + ': puoi rientrare' : 'Ti serve il codice di invito',
        () => { if (DnD.app.vai({ modo: 'unisciti' })) online().unisciti({ spettatore: (profiloAttivo() || {}).ruolo === 'spettatore' }); }, { disabled: !webrtc }),
      carta('ospita', 'Ospita una partita', 'Scegli una sessione e invita i giocatori, senza server né account.',
        osp ? 'In corso: ' + osp.giocatori + (osp.giocatori === 1 ? ' giocatore' : ' giocatori') : !webrtc ? 'WebRTC non disponibile in questo browser' : 'Scegli la sessione da ospitare',
        () => DnD.app.vai({ modo: 'ospita' }), { disabled: !webrtc && !osp }));
  }

  function riprendi() {
    const st = DnD.store.state;
    const sessioni = new Map(st.sessions.map((s) => [s.id, s]));
    const recenti = DnD.app.recenti().filter((r) => sessioni.has(r.id));
    const ultima = recenti[0] || { id: DnD.sessioni.current(st).id, ora: 0 };
    const apri = (id) => { if (DnD.app.switchSession(id)) DnD.app.vai({ modo: 'master', sezione: DnD.app.sezione() }); };
    const partite = online().partite();
    return el('section', { class: 'panel portale-riprendi', 'aria-labelledby': 'portale-riprendi-titolo' },
      el('h2', { id: 'portale-riprendi-titolo', text: 'Riprendi' }),
      el('div', { class: 'portale-ultima' },
        el('div', {}, el('span', { class: 'muted small', text: 'Ultima sessione' }), el('p', {}, el('b', { text: sessioni.get(ultima.id).name })),
          el('p', { class: 'muted small', text: ultima.ora ? 'Aperta il ' + dataOra(ultima.ora) : 'Non ancora aperta' })),
        el('button', { type: 'button', class: 'btn primary', text: 'Continua ▶', 'aria-label': 'Continua la sessione ' + sessioni.get(ultima.id).name, onclick: () => apri(ultima.id) })),
      el('h3', { text: 'Sessioni recenti' }),
      recenti.length > 1
        ? el('ul', { class: 'portale-lista' }, recenti.slice(1, 6).map((r) => el('li', {},
          el('span', {}, el('b', { text: sessioni.get(r.id).name }), el('span', { class: 'muted small', text: ' · ' + dataOra(r.ora) })),
          el('button', { type: 'button', class: 'btn small', text: 'Apri', 'aria-label': 'Apri la sessione ' + sessioni.get(r.id).name, onclick: () => apri(r.id) }))))
        : el('p', { class: 'muted small', text: 'Nessun\'altra sessione aperta di recente.' }),
      el('h3', { text: 'Partite online a cui hai partecipato' }),
      partite.length
        ? el('ul', { class: 'portale-lista' }, partite.slice(0, 6).map((v) => el('li', {},
          el('span', {}, el('b', { text: 'Master: ' + (v.master || '?') }), el('span', { class: 'muted small', text: v.ora ? ' · ' + dataOra(v.ora) : '' })),
          el('span', { class: 'head-actions' },
            el('button', { type: 'button', class: 'btn small', text: '🔑 Rientra', title: 'Chiedi al master un nuovo invito: con il gettone salvato riprendi lo stesso personaggio', 'aria-label': 'Rientra nella partita di ' + (v.master || 'master'), onclick: () => online().rientraPartita(v) }),
            el('button', { type: 'button', class: 'btn small', text: 'Dimentica', 'aria-label': 'Dimentica la partita di ' + (v.master || 'master'), onclick: () => { if (confirm('Dimenticare il gettone di questa partita? Non potrai più riprendere lo stesso personaggio.')) { online().dimenticaPartita(v.gettone); render(document.getElementById('main'), { schermata: 'home' }); } } })))))
        : el('p', { class: 'muted small', text: 'Non hai ancora partecipato a partite online: usa «Unisciti a una partita».' }));
  }

  // Primo avvio: nessun dato dell'utente. Guida di tre passi e «Crea la tua prima sessione».
  function guida() {
    const p = profiloAttivo();
    const st = DnD.store.state;
    const vuoto = st.sessions.length === 1 && !st.players.length && !st.savedGrids.length && !st.scenes.length;
    if (!p || !p.nuovo || !vuoto) return null;
    const fatto = () => { try { gestore().modifica(p.id, { nuovo: false }); } catch (e) { /* guida riproposta */ } };
    return el('section', { class: 'panel portale-guida', 'aria-labelledby': 'portale-guida-titolo' },
      el('h2', { id: 'portale-guida-titolo', text: 'Benvenuto in ' + C.APP_NAME + '!' }),
      el('ol', { class: 'portale-passi' },
        el('li', {}, el('b', { text: 'Crea una sessione' }), el('span', { class: 'muted small', text: ' — il contenitore della tua campagna o serata.' })),
        el('li', {}, el('b', { text: 'Aggiungi giocatori e nemici' }), el('span', { class: 'muted small', text: ' — schede dei personaggi e creature (ci sono già degli esempi).' })),
        el('li', {}, el('b', { text: 'Prepara una griglia e gioca' }), el('span', { class: 'muted small', text: ' — combattimento, esplorazione, oppure ospita la partita online.' }))),
      el('div', { class: 'head-actions' },
        el('button', { type: 'button', class: 'btn primary', text: '✨ Crea la tua prima sessione', onclick: () => { fatto(); if (DnD.app.vai({ modo: 'master', sezione: 'scene' })) DnD.uiSessioni.newSession(); } }),
        el('button', { type: 'button', class: 'btn', text: 'Ho capito', onclick: () => { fatto(); render(document.getElementById('main'), { schermata: 'home' }); } })));
  }

  function piede() {
    const salta = el('input', { type: 'checkbox', checked: Boolean(gestore() && gestore().portale().salta), onchange: () => {
      try { gestore().impostaPortale({ salta: salta.checked }); toast(salta.checked ? 'Al prossimo avvio si apre direttamente il Master (Alt+H riporta qui).' : 'Al prossimo avvio si apre il portale.', 'success'); } catch (e) { toast('Preferenza non salvata: ' + DnD.archivio.saveErrorMessage(e), 'error'); }
    } });
    return el('footer', { class: 'portale-piede' },
      el('label', { class: 'check small' }, salta, ' Salta il portale (apri direttamente il Master)'),
      el('span', { class: 'muted small', text: 'Alt+H: torna qui da ogni schermata' }));
  }

  // Schermata «Ospita»: scelta della sessione, poi il pannello Online del master già esistente.
  function ospita() {
    const st = DnD.store.state;
    const osp = online().ospitando();
    const corrente = DnD.sessioni.current(st).id;
    const gruppo = el('div', { class: 'portale-scelte', role: 'radiogroup', 'aria-label': 'Sessione da ospitare' }, st.sessions.map((s) => {
      const rip = online().ripresaDi(s.id);
      const pgs = st.players.filter((p) => DnD.modello.isVisible(p, s.id)).length;
      return el('label', { class: 'portale-scelta' },
        el('input', { type: 'radio', name: 'sessione-ospita', value: s.id, checked: s.id === corrente }),
        el('span', {}, el('b', { text: s.name }), el('span', { class: 'muted small', text: ' · ' + pgs + (pgs === 1 ? ' personaggio' : ' personaggi') + (rip && rip.gettoni.length ? ' · ripresa possibile (' + rip.gettoni.length + ' gettoni)' : '') })));
    }));
    const riprendiCheck = el('input', { type: 'checkbox', checked: true });
    const avvia = () => {
      const id = (gruppo.querySelector('input:checked') || {}).value || corrente;
      if (!DnD.app.switchSession(id)) return;
      const rip = online().ripresaDi(id);
      if (DnD.app.vai({ modo: 'master', sezione: DnD.app.sezione() })) online().ospita(Boolean(rip && rip.gettoni.length && riprendiCheck.checked));
    };
    return el('section', { class: 'panel portale-sotto', 'aria-labelledby': 'portale-ospita-titolo' },
      el('h2', { id: 'portale-ospita-titolo', text: 'Ospita una partita' }),
      osp ? el('div', { class: 'portale-avviso', role: 'status' }, el('p', { text: 'Stai già ospitando una partita (' + osp.giocatori + (osp.giocatori === 1 ? ' giocatore' : ' giocatori') + ').' }),
        el('button', { type: 'button', class: 'btn small primary', text: 'Apri il pannello Online', onclick: () => { if (DnD.app.vai({ modo: 'master', sezione: DnD.app.sezione() })) online().ospita(); } })) : null,
      el('p', { class: 'muted small', text: 'Il collegamento è diretto tra browser: tu e i giocatori vi scambiate due codici (per esempio nella chat che usate già). Ai giocatori arriva solo ciò che decidi di mostrare.' }),
      gruppo,
      el('label', { class: 'check small' }, riprendiCheck, ' Se ci sono gettoni salvati, riprendi la partita (i giocatori ritrovano il loro personaggio)'),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: '◀ Portale', onclick: () => DnD.app.vai({ modo: 'home' }) }),
        el('button', { type: 'button', class: 'btn primary', text: '🏠 Ospita la sessione', disabled: Boolean(osp), onclick: avvia })));
  }

  // Schermata «Unisciti»: nome e colore dal profilo, preferenza spettatore, codice di invito, partite salvate.
  function unisciti() {
    const p = profiloAttivo();
    const spett = el('input', { type: 'checkbox', checked: Boolean(p && p.ruolo === 'spettatore') });
    return el('section', { class: 'panel portale-sotto', 'aria-labelledby': 'portale-unisciti-titolo' },
      el('h2', { id: 'portale-unisciti-titolo', text: 'Unisciti a una partita' }),
      p ? el('p', { class: 'portale-chi' }, avatar(p), ' Entri come ', el('b', { text: p.nome }), el('span', { class: 'muted small', text: ' (nome e colore del profilo)' })) : null,
      el('label', { class: 'check small' }, spett, ' Preferisco guardare (spettatore, sola vista): il master decide comunque'),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn', text: '◀ Portale', onclick: () => DnD.app.vai({ modo: 'home' }) }),
        el('button', { type: 'button', class: 'btn primary', text: '🔗 Incolla il codice di invito', onclick: () => online().unisciti({ spettatore: spett.checked }) })),
      el('h3', { text: 'Rientra in una partita' }),
      online().partite().length
        ? el('ul', { class: 'portale-lista' }, online().partite().map((v) => el('li', {}, el('span', { text: 'Master: ' + (v.master || '?') + (v.ora ? ' · ' + dataOra(v.ora) : '') }),
          el('button', { type: 'button', class: 'btn small', text: '🔑 Rientra', onclick: () => online().rientraPartita(v) }))))
        : el('p', { class: 'muted small', text: 'Nessuna partita salvata: il gettone di rientro si salva la prima volta che entri.' }));
  }

  // Profilo con PIN non ancora sbloccato in questa scheda: solo il PIN (o il cambio di profilo).
  function blocco() {
    const p = profiloAttivo();
    const altri = gestore().elenco().filter((x) => x.id !== p.id);
    return el('section', { class: 'panel portale-sotto portale-blocco', 'aria-labelledby': 'portale-blocco-titolo' },
      el('h2', { id: 'portale-blocco-titolo' }, avatar(p, true), ' ', p.nome),
      el('p', { text: 'Questo profilo è protetto da un PIN locale.' }),
      el('div', { class: 'form-actions' },
        el('button', { type: 'button', class: 'btn primary', text: '🔓 Inserisci il PIN', onclick: async () => { if (await chiediPin(p)) render(document.getElementById('main'), { schermata: 'home' }); } })),
      altri.length ? el('div', {}, el('h3', { text: 'Oppure usa un altro profilo' }), el('div', { class: 'head-actions' },
        altri.map((x) => el('button', { type: 'button', class: 'btn small', onclick: () => attiva(x.id) }, avatar(x), ' ' + x.nome)))) : null,
      el('p', { class: 'muted small', text: 'PIN dimenticato? Non si può recuperare: da un altro profilo puoi eliminare questo (con i suoi dati).' }));
  }

  /**
   * Disegna il portale nel contenitore. opts: { schermata: 'home' | 'ospita' | 'unisciti', interrotta }.
   * @param {HTMLElement} main  @param {{schermata?: string, interrotta?: boolean}} [opts]
   */
  function render(main, opts) {
    const o = opts || {};
    const schermata = ['ospita', 'unisciti'].includes(o.schermata) ? o.schermata : 'home';
    let corpo;
    if (bloccato()) corpo = [blocco()];
    else if (schermata === 'ospita') corpo = [ospita()];
    else if (schermata === 'unisciti') corpo = [unisciti()];
    else corpo = [guida(), carte(), riprendi(), piede()];
    fill(main, el('div', { class: 'portale', role: 'region', 'aria-label': 'Portale di ' + C.APP_NAME },
      testa(), bloccato() ? null : avvisi(schermata, o.interrotta), corpo));
    const primo = main.querySelector('.portale-carta:not(:disabled), .portale-sotto .btn.primary');
    if (primo && o.fuoco !== false) primo.focus({ preventScroll: true });
  }

  DnD.uiPortale = {
    render, saltaPortale, bloccato, attiva, editor, chiediPin,
    avvio: (info) => { avvio = info || null; },
  };
})(globalThis.DnD = globalThis.DnD || {});
