// Pagina «Dati e backup» (dalle Impostazioni e dal portale): spazio usato e archiviazione persistente, esportazione
// dell'archivio del profilo o di una sessione, importazione in un profilo nuovo o unita a quello attuale (anteprima e
// scelta per ogni conflitto), backup della migrazione, cartella di backup automatica (File System Access: ogni N
// minuti se ci sono modifiche e all'uscita, ultime 10 copie verificate), promemoria «Esporta un backup» ogni 7 giorni,
// «Cancella tutti i dati» del profilo o di tutti. Livello interfaccia: la logica è in stato/backup.js e stato/unione.js,
// il disco in stato/archivio.js. Espone DnD.uiBackup.
(function (DnD) {
  'use strict';

  const { el, fill, toast, openDialog, field } = DnD.ui;
  const B = DnD.backup;
  const U = DnD.unione;
  const A = () => DnD.archivio;
  const STATO_KEY = 'dnd-battaglie:backup';
  const prefs = () => DnD.archivioLocale.preferenze;
  const app = () => DnD.config.APP_NAME;

  let cartella = null;        // adattatore della cartella collegata (se c'è)
  let permessoScaduto = false;
  let copiate = 0;            // DnD.store.salvate all'ultimo backup nella cartella (in questa sessione dell'app)
  let timer = 0;
  let inCorso = null;

  // ---------- Stato del backup (preferenze del profilo) ----------
  function stato() {
    try { return B.normalizzaStato(JSON.parse(prefs().getItem(STATO_KEY))); } catch (e) { return B.normalizzaStato(null); }
  }
  function aggiorna(patch) {
    const s = Object.assign(stato(), patch);
    try { prefs().setItem(STATO_KEY, JSON.stringify(s)); } catch (e) { console.warn('Backup: stato non salvato', e); }
    return s;
  }
  const dataOra = (t) => (t ? new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'mai');
  const mb = (n) => (n / (1024 * 1024)).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MB';
  const profilo = () => (A().profili && A().profili.attivo()) || { nome: 'Profilo', colore: '#888', avatar: null, ruolo: 'master' };
  const giocatoreOnline = () => Boolean(DnD.uiOnline && DnD.uiOnline.vistaGiocatore());

  // L'esportazione manuale scaricata conta come backup (scaricato: il file lo salva il browser nei download).
  const segnaEsportazione = () => aggiorna({ ultimo: Date.now(), ultimoTipo: 'esportazione', ultimoFile: null });

  // ---------- Cartella di backup ----------
  async function collega() {
    if (!A().cartellaDisponibile()) return;
    try {
      cartella = await A().scegliCartella();
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('Cartella non collegata: ' + B.messaggio(e) + (DnD.store.backend !== 'IndexedDB' ? ' (serve IndexedDB per ricordarla)' : ''), 'error');
      return;
    }
    permessoScaduto = false;
    aggiorna({ nomeCartella: cartella.nome, ultimoErrore: null });
    toast('Cartella «' + cartella.nome + '» collegata: faccio subito un backup.', 'success');
    await salvaOra(true);
  }
  async function riautorizza() {
    if (!cartella) cartella = await A().cartellaCollegata();
    if (!cartella) return false;
    let p = 'denied';
    try { p = await cartella.chiediPermesso(); } catch (e) { p = 'denied'; }
    permessoScaduto = p !== 'granted';
    if (permessoScaduto) toast('Permesso non concesso: i backup automatici restano sospesi.', 'error');
    else { toast('Cartella di backup riautorizzata.', 'success'); await salvaOra(true); }
    return !permessoScaduto;
  }
  async function scollega() {
    await A().scollegaCartella();
    cartella = null;
    permessoScaduto = false;
    aggiorna({ nomeCartella: null, ultimoErrore: null });
    toast('Cartella di backup scollegata (i file già salvati restano).');
  }

  /**
   * Scrive una copia nella cartella (con verifica e rotazione). manuale: avvisa anche dell'esito positivo.
   * @returns {Promise<{ok: boolean, errore?: string}>}
   */
  async function salvaOra(manuale) {
    if (inCorso) return inCorso;
    inCorso = (async () => {
      if (!cartella) cartella = await A().cartellaCollegata();
      if (!cartella) return { ok: false, errore: 'Nessuna cartella di backup collegata.' };
      await DnD.store.saved();
      const numero = DnD.store.salvate;
      let testo;
      try { testo = await DnD.uiImpostazioni.testoArchivio([]); } catch (e) { return { ok: false, errore: 'Archivio non preparato: ' + e.message }; }
      const r = await B.esegui(cartella, testo, { app: app(), profilo: profilo().nome, ora: Date.now() });
      if (r.permesso) permessoScaduto = true;
      if (r.ok) {
        copiate = numero;
        aggiorna({ ultimo: Date.now(), ultimoTipo: 'cartella', ultimoFile: r.nome, ultimoErrore: r.avviso || null, nomeCartella: cartella.nome });
        if (manuale) toast('Backup salvato e verificato: ' + r.nome + (r.eliminati.length ? ' (eliminate ' + r.eliminati.length + ' copie vecchie)' : ''), 'success');
      } else {
        aggiorna({ ultimoErrore: r.errore });
        if (manuale || !r.permesso) toast(r.errore, 'error');
      }
      return r;
    })();
    try { return await inCorso; } finally { inCorso = null; }
  }

  // Ogni minuto: se è passato l'intervallo e ci sono modifiche salvate non ancora copiate, backup nella cartella.
  async function controlla() {
    if (!cartella || permessoScaduto || !DnD.store) return;
    let p = 'denied';
    try { p = await cartella.permesso(); } catch (e) { p = 'denied'; }
    if (p !== 'granted') { permessoScaduto = true; rinfrescaPortale(); return; }
    if (B.dovuto(stato(), Date.now(), DnD.store.salvate > copiate)) await salvaOra(false);
  }
  function rinfrescaPortale() {
    if (DnD.app.modo && DnD.app.modo() === 'home') DnD.uiPortale.render(document.getElementById('main'), { schermata: 'home', fuoco: false });
  }

  // Avvio: cartella collegata e permesso; poi il controllo periodico e la copia all'uscita.
  async function avvia() {
    copiate = DnD.store.salvate;
    if (A().cartellaDisponibile()) {
      try { cartella = await A().cartellaCollegata(); } catch (e) { cartella = null; }
      if (cartella) {
        let p = 'denied';
        try { p = await cartella.permesso(); } catch (e) { p = 'denied'; }
        permessoScaduto = p !== 'granted';
        if (permessoScaduto) rinfrescaPortale();
      }
    }
    clearInterval(timer);
    timer = setInterval(controlla, 60000);
    // All'uscita (scheda nascosta o chiusa): copia se ci sono modifiche (il browser può interromperla).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && cartella && !permessoScaduto && DnD.store.salvate > copiate) salvaOra(false);
    });
  }

  // ---------- Avvisi del portale ----------
  function avvisiPortale() {
    const out = [];
    const s = stato();
    if (cartella && permessoScaduto) {
      out.push(el('div', { class: 'portale-avviso errore', role: 'alert' },
        el('p', { text: 'Il permesso di scrivere nella cartella di backup «' + (s.nomeCartella || cartella.nome) + '» è scaduto: i backup automatici sono sospesi.' }),
        el('button', { type: 'button', class: 'btn small primary', text: '🔑 Riautorizza', onclick: async () => { await riautorizza(); rinfrescaPortale(); } })));
    }
    // Promemoria (senza una cartella automatica attiva): ogni 7 giorni, disattivabile.
    if ((!cartella || permessoScaduto) && B.promemoria(s, Date.now())) {
      out.push(el('div', { class: 'portale-avviso', role: 'status' },
        el('p', { text: s.ultimo ? 'L\'ultimo backup risale al ' + dataOra(s.ultimo) + ': conviene esportarne uno nuovo.' : 'Non hai ancora fatto un backup di questo profilo: i dati stanno solo in questo browser.' }),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn small primary', text: '⬇ Esporta un backup', onclick: async () => { await DnD.uiImpostazioni.exportArchive(); rinfrescaPortale(); } }),
          el('button', { type: 'button', class: 'btn small', text: 'Più tardi', onclick: () => { aggiorna({ rimandato: Date.now() }); rinfrescaPortale(); } }),
          el('button', { type: 'button', class: 'btn small', text: 'Non ricordarmelo', onclick: () => { aggiorna({ promemoria: false }); rinfrescaPortale(); } }))));
    }
    out.push(el('p', { class: 'muted small portale-ultimo-backup' }, '💾 Ultimo backup: ' + dataOra(s.ultimo) +
      (s.ultimoTipo === 'cartella' ? ' (cartella)' : s.ultimoTipo === 'esportazione' ? ' (esportazione scaricata)' : '') +
      (cartella && !permessoScaduto ? ' · automatico ogni ' + s.intervallo + ' min nella cartella «' + cartella.nome + '»' : '')));
    return out;
  }

  // ---------- Importazione ----------
  const leggiFile = (file) => file.text();
  // Archivio scelto: in un profilo nuovo, unito a questo, oppure al posto di tutto (come prima).
  async function importaFile(file) {
    let testo;
    let raw;
    try { testo = await leggiFile(file); raw = JSON.parse(testo); } catch (e) { toast('Importazione fallita: il file non è un JSON valido.', 'error'); return; }
    if (DnD.sessioni.isSessionFile(raw)) { await DnD.uiImpostazioni.importFile(file); return; }
    let importato;
    try { importato = DnD.dati.importJSON(testo); } catch (e) { toast('Importazione rifiutata: ' + e.message + (/recente/.test(e.message) ? ' Aggiorna l\'app (ricarica la pagina) e riprova.' : ''), 'error'); return; }
    const nomeProfilo = raw.profilo && typeof raw.profilo.nome === 'string' ? raw.profilo.nome : file.name.replace(/\.json$/i, '').slice(0, 30);
    const d = openDialog('Importa un archivio', el('div', { class: 'form' },
      el('p', { text: 'L\'archivio contiene ' + importato.sessions.length + ' sessioni, ' + importato.players.length + ' giocatori e ' + importato.npcs.length + ' nemici' + (typeof raw.version === 'number' && raw.version < DnD.modello.VERSION ? ' (versione ' + raw.version + ' dell\'app: verrà aggiornato).' : '.') }),
      el('div', { class: 'settings-actions' },
        el('button', { type: 'button', class: 'btn primary', text: '➕ In un profilo nuovo', onclick: () => { d.dismiss(); inProfiloNuovo(testo, raw, nomeProfilo); } }),
        el('button', { type: 'button', class: 'btn', text: '⇄ Unisci a questo profilo (scegli i conflitti)', onclick: () => { d.dismiss(); unisciDialog(importato, raw); } }),
        el('button', { type: 'button', class: 'btn danger', text: '↺ Sostituisci tutto il profilo', onclick: () => { d.dismiss(); DnD.uiImpostazioni.importFile(new File([testo], file.name)); } }))));
  }

  async function inProfiloNuovo(testo, raw, nomeProposto) {
    const nome = prompt('Nome del nuovo profilo:', nomeProposto || 'Importato');
    if (!nome || !nome.trim()) return;
    const p = raw.profilo && typeof raw.profilo === 'object' ? raw.profilo : {};
    try {
      const nuovo = A().profili.crea({ nome: nome.trim().slice(0, 30), colore: p.colore, avatar: p.avatar, ruolo: p.ruolo, nuovo: false });
      await A().profili.mettiImportazione(nuovo.id, testo);
      if (confirm('Profilo «' + nuovo.nome + '» creato: l\'archivio verrà importato quando lo apri. Passare ora al nuovo profilo?')) DnD.uiPortale.attiva(nuovo.id);
      else toast('Profilo «' + nuovo.nome + '» creato: l\'archivio si importa alla prima apertura.', 'success');
    } catch (e) {
      toast('Profilo non creato: ' + A().saveErrorMessage(e), 'error');
    }
  }

  // Al primo avvio di un profilo creato da un'importazione: l'archivio in sospeso prende il posto dello stato vuoto.
  async function importazioneInSospeso() {
    const testo = await A().prendiImportazione();
    if (!testo) return;
    try {
      const state = DnD.dati.importJSON(testo);
      const raw = JSON.parse(testo);
      const immagini = DnD.immaginiLib.validImages(raw.images);
      for (const data of Object.values(immagini)) await DnD.immagini.put(data);
      const res = await DnD.store.replace(state);
      if (!res.ok) throw new Error('archivio non salvato: ' + res.message);
      if (raw.suoni) await DnD.audio.importa(raw.suoni);
      DnD.app.refreshAll();
      toast('Archivio importato nel profilo.', 'success');
    } catch (e) {
      await DnD.store.blobs.set('importazione-in-sospeso', testo).catch(() => {});
      toast('Importazione nel profilo nuovo non riuscita: ' + e.message, 'error');
    }
  }

  // Anteprima con una scelta per ogni conflitto, poi l'unione.
  function unisciDialog(importato, raw) {
    const st = DnD.store.state;
    const prev = U.anteprima(st, importato);
    const scelte = U.tutte(prev.conflitti, 'tieni');
    const righe = prev.conflitti.map((c) => {
      const sel = el('select', { 'aria-label': 'Scelta per ' + c.tipo + ' ' + c.nome, onchange: () => { scelte[U.chiave(c.col, c.id)] = sel.value; } },
        U.SCELTE.map((v) => el('option', { value: v, text: U.NOMI_SCELTE[v] })));
      return { c, sel, tr: el('tr', {}, el('td', { text: c.tipo }), el('td', {}, el('b', { text: c.nome }), c.nomeAttuale !== c.nome ? el('span', { class: 'muted small', text: ' (il tuo: ' + c.nomeAttuale + ')' }) : null), el('td', {}, sel)) };
    });
    const tutti = el('select', { 'aria-label': 'Scelta per tutti i conflitti', onchange: () => { for (const r of righe) { r.sel.value = tutti.value; scelte[U.chiave(r.c.col, r.c.id)] = tutti.value; } } },
      el('option', { value: '', text: 'Per tutti…' }), U.SCELTE.map((v) => el('option', { value: v, text: U.NOMI_SCELTE[v] })));
    const riepilogo = el('div', { class: 'backup-riepilogo' }, Object.values(prev.perTipo).map((t) => el('span', { class: 'tag small', text: t.tipo + ': +' + t.aggiunti + (t.conflitti ? ', ' + t.conflitti + ' in conflitto' : '') + (t.identici ? ', ' + t.identici + ' uguali' : '') })));
    openDialog('Unisci l\'archivio', el('div', { class: 'form' },
      el('p', {}, el('b', { text: prev.aggiunti.length + ' elementi nuovi' }), ' verranno aggiunti; ', el('b', { text: prev.conflitti.length + ' in conflitto' }), ' (stesso elemento, contenuto diverso); ' + prev.identici + ' già uguali.'),
      riepilogo,
      prev.conflitti.length ? el('div', {}, el('p', { class: 'small', text: 'Per ogni conflitto: «Tieni il mio» lascia il tuo, «Sostituisci» prende quello del file, «Duplica» li tiene entrambi (la copia ha un nome con «(importato)»; una sessione duplicata porta con sé i suoi elementi).' }),
        field('Scelta per tutti', tutti),
        el('div', { class: 'backup-conflitti' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Tipo' }), el('th', { text: 'Elemento' }), el('th', { text: 'Scelta' }))), el('tbody', {}, righe.map((r) => r.tr))))) : null,
      el('p', { class: 'muted small', text: 'Le impostazioni dei suoni e le regole della casa restano le tue; le immagini del file si aggiungono.' })), [
      { text: 'Annulla' },
      { text: 'Unisci', class: 'primary', onclick: () => { applicaUnione(importato, raw, scelte); } },
    ]);
  }
  async function applicaUnione(importato, raw, scelte) {
    if (!DnD.app.canLeaveSection()) return;
    try {
      const unito = U.unisci(DnD.store.state, importato, scelte, DnD.dadi.uid);
      unito.currentSessionId = DnD.store.state.currentSessionId;
      for (const data of Object.values(DnD.immaginiLib.validImages(raw.images))) await DnD.immagini.put(data);
      const res = await DnD.store.replace(unito);
      if (!res.ok) throw new Error('archivio non salvato: ' + res.message);
      DnD.app.refreshAll();
      toast('Archivio unito e salvato.', 'success');
    } catch (e) {
      toast('Unione non riuscita: ' + e.message, 'error');
    }
  }

  // ---------- Cancella tutti i dati ----------
  async function cancella(tutti) {
    const p = profilo();
    const cosa = tutti ? 'di TUTTI i profili di questo browser (e il registro dei profili)' : 'del profilo «' + p.nome + '»';
    if (!confirm('Cancellare tutti i dati ' + cosa + '?\nSessioni, personaggi e creature, griglie e immagini, librerie, suoni personalizzati, gettoni e note online, stato dei backup e collegamento alla cartella di backup (i file già salvati nella cartella restano).\nConviene esportare prima l\'archivio.')) return;
    if (!confirm('Ultima conferma: l\'operazione non si può annullare. Cancellare ' + (tutti ? 'tutti i profili' : 'il profilo «' + p.nome + '»') + '?')) return;
    if (DnD.uiOnline && DnD.uiOnline.ospitando()) { toast('Chiudi prima la sessione online.', 'error'); return; }
    try {
      if (tutti) {
        await DnD.store.saved();
        DnD.store.bloccato = true; // nessuna scrittura ricrea i database eliminati
        await A().profili.cancellaTutti();
        location.hash = '#/home';
        location.reload();
        return;
      }
      const res = await DnD.store.clearAll();
      cartella = null;
      permessoScaduto = false;
      DnD.immagini.reset();
      DnD.audio.svuota();
      DnD.app.refreshAll();
      if (res.ok) toast('Tutti i dati del profilo sono stati cancellati.', 'success');
      else toast('Dati cancellati, ma il nuovo archivio vuoto non è stato salvato: ' + res.message, 'error');
    } catch (e) {
      DnD.store.bloccato = false;
      toast('Cancellazione non riuscita: ' + e.message, 'error');
    }
  }

  // ---------- Pagina «Dati e backup» ----------
  function apri() {
    if (giocatoreOnline()) { toast('Durante una partita online da giocatore i dati non si esportano: esci dalla partita.', 'error'); return; }
    const corpo = el('div', { class: 'backup-pagina' });
    const d = openDialog('Dati e backup · ' + profilo().nome, corpo);
    const ridisegna = () => { if (d.open) disegna(corpo, ridisegna); };
    disegna(corpo, ridisegna);
    return d;
  }

  async function disegna(corpo, ridisegna) {
    const s = stato();
    const st = DnD.store.state;
    const spazio = el('div', {}, el('p', { class: 'muted small', text: 'Calcolo dello spazio…' }));
    const pers = el('p', { class: 'small', 'aria-live': 'polite' });
    const esitoPers = el('p', { class: 'small backup-esito', 'aria-live': 'polite' });
    const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { const f = file.files[0]; file.value = ''; if (f) importaFile(f); } });
    const sessione = el('select', { 'aria-label': 'Sessione da esportare' }, st.sessions.map((x) => el('option', { value: x.id, text: x.name, selected: x.id === st.currentSessionId })));
    const reg = A().profili ? A().profili.registro() : null;
    const intervallo = el('input', { type: 'number', min: 1, max: 240, value: s.intervallo, style: 'width:5rem', 'aria-label': 'Minuti tra due backup automatici', onchange: () => {
      const n = Math.round(Number(intervallo.value));
      if (n >= 1 && n <= 240) { aggiorna({ intervallo: n }); toast('Backup automatico ogni ' + n + ' minuti (se ci sono modifiche).', 'success'); } else intervallo.value = stato().intervallo;
    } });
    const promem = el('input', { type: 'checkbox', checked: s.promemoria, onchange: () => aggiorna({ promemoria: promem.checked }) });
    const ambito = el('select', { 'aria-label': 'Cosa cancellare' }, el('option', { value: 'profilo', text: 'Solo il profilo «' + profilo().nome + '»' }), el('option', { value: 'tutti', text: 'Tutti i profili di questo browser' }));
    const avvisoArchivio = DnD.store.bloccato ? el('p', { class: 'error-text small', text: '⚠ I salvataggi sono sospesi: i dati sul disco non si sono potuti leggere. Esporta subito l\'archivio.' })
      : DnD.store.backend === 'localStorage' ? el('p', { class: 'warning-text small', text: '⚠ IndexedDB non è disponibile: i dati stanno in localStorage, con pochissimo spazio (circa 5 MB) e senza cartella di backup.' })
        : DnD.store.lastError ? el('p', { class: 'error-text small', text: '⚠ L\'ultimo salvataggio non è riuscito: ' + A().saveErrorMessage(DnD.store.lastError) }) : null;
    const disponibile = A().cartellaDisponibile();
    const backupMig = await A().backupMigrazione();
    fill(corpo,
      el('section', {}, el('h3', { text: 'Spazio' }), spazio, pers,
        el('div', { class: 'head-actions' }, el('button', { type: 'button', class: 'btn small', text: '📌 Chiedi archiviazione persistente', onclick: async () => {
          const r = await A().richiediPersistenza();
          esitoPers.className = 'small backup-esito ' + (r ? 'ok' : 'no');
          esitoPers.textContent = r === null ? 'Questo browser non permette di chiederla.' : r ? 'Concessa: il browser non cancellerà i dati per fare spazio.' : 'Rifiutata dal browser: i dati potrebbero essere cancellati se lo spazio scarseggia. Esporta spesso un backup (il permesso arriva più facilmente installando l\'app o usandola spesso).';
          ridisegnaSpazio();
        } })), esitoPers, avvisoArchivio),
      el('section', {}, el('h3', { text: 'Esporta e importa' }),
        el('div', { class: 'head-actions' },
          el('button', { type: 'button', class: 'btn small', text: '⬇ Esporta l\'archivio completo del profilo', onclick: async () => { await DnD.uiImpostazioni.exportArchive(); ridisegna(); } }),
          el('button', { type: 'button', class: 'btn small', text: '⬆ Importa un archivio o una sessione…', onclick: () => file.click() }), file),
        el('div', { class: 'head-actions' }, sessione, el('button', { type: 'button', class: 'btn small', text: '⬇ Esporta la sessione', onclick: () => DnD.uiImpostazioni.exportSession(sessione.value) })),
        el('p', { class: 'muted small', text: 'Un archivio si può importare in un profilo nuovo, unire a questo (con la scelta per ogni conflitto) o mettere al posto di tutto. Un archivio di una versione più recente dell\'app viene rifiutato; uno più vecchio viene aggiornato.' })),
      backupMig || (reg && reg.migrazione && reg.migrazione.dbVecchio) ? el('section', {}, el('h3', { text: 'Migrazione ai profili' }),
        el('p', { class: 'small', text: 'Il ' + dataOra(reg && reg.migrazione ? reg.migrazione.ora : 0) + ' i dati di prima sono stati spostati nel profilo «Master».' }),
        el('div', { class: 'head-actions' },
          backupMig ? el('button', { type: 'button', class: 'btn small', text: '⬇ Scarica il backup di prima della migrazione', onclick: () => { DnD.ui.download(backupMig, DnD.ui.slug(app()) + '-backup-prima-dei-profili.json'); A().profili.segnaMigrazione({ backupScaricato: true }); } }) : null,
          reg && reg.migrazione && reg.migrazione.dbVecchio ? el('button', { type: 'button', class: 'btn small danger', text: 'Elimina la copia dei dati di prima', onclick: async () => {
            if (!confirm('Eliminare la copia dei dati di prima della migrazione (database «' + reg.migrazione.dbVecchio + '»)? I dati del profilo «Master» restano.')) return;
            try { await A().profili.eliminaVecchio(); toast('Copia eliminata.', 'success'); ridisegna(); } catch (e) { toast('Copia non eliminata: ' + e.message, 'error'); }
          } }) : null)) : null,
      el('section', {}, el('h3', { text: 'Backup automatico' }),
        el('p', { class: 'small', text: 'Ultimo backup: ' + dataOra(s.ultimo) + (s.ultimoTipo === 'cartella' ? ' nella cartella' + (s.ultimoFile ? ' (' + s.ultimoFile + ')' : '') : s.ultimoTipo === 'esportazione' ? ' (esportazione scaricata)' : '') }),
        s.ultimoErrore ? el('p', { class: 'error-text small', text: '⚠ ' + s.ultimoErrore }) : null,
        disponibile
          ? el('div', { class: 'settings-group' },
            el('p', { class: 'small', text: cartella ? 'Cartella collegata: «' + cartella.nome + '»' + (permessoScaduto ? ' — permesso scaduto' : '') : 'Nessuna cartella collegata.' }),
            el('div', { class: 'head-actions' },
              el('button', { type: 'button', class: 'btn small primary', text: cartella ? '📁 Cambia cartella…' : '📁 Scegli la cartella di backup…', onclick: async () => { await collega(); ridisegna(); } }),
              cartella && permessoScaduto ? el('button', { type: 'button', class: 'btn small', text: '🔑 Riautorizza', onclick: async () => { await riautorizza(); ridisegna(); } }) : null,
              cartella && !permessoScaduto ? el('button', { type: 'button', class: 'btn small', text: '💾 Salva ora', onclick: async () => { await salvaOra(true); ridisegna(); } }) : null,
              cartella ? el('button', { type: 'button', class: 'btn small', text: 'Scollega', onclick: async () => { await scollega(); ridisegna(); } }) : null),
            el('label', { class: 'inline small' }, 'Ogni ', intervallo, ' minuti, se ci sono modifiche (e all\'uscita). Restano le ultime ' + B.MAX_COPIE + ' copie, ognuna riletta per verificarla.'))
          : el('p', { class: 'muted small', text: 'Questo browser non permette di scrivere in una cartella (serve Chrome, Edge o Opera): esporta l\'archivio a mano ogni tanto.' }),
        el('label', { class: 'check small' }, promem, ' Ricordami ogni ' + B.PROMEMORIA_GIORNI + ' giorni di esportare un backup (quando non c\'è una cartella automatica)')),
      el('section', {}, el('h3', { text: 'Cancella tutti i dati' }),
        el('div', { class: 'head-actions' }, ambito, el('button', { type: 'button', class: 'btn small danger', text: 'Cancella…', onclick: () => cancella(ambito.value === 'tutti') })),
        el('p', { class: 'muted small', text: 'Svuota anche IndexedDB, i suoni personalizzati e il collegamento alla cartella di backup (i file nella cartella restano). Doppia conferma.' })));
    async function ridisegnaSpazio() {
      const [sp, p] = await Promise.all([A().spazio(), A().persistente()]);
      fill(spazio, sp ? [el('p', { class: 'small', text: 'Usati ' + mb(sp.usato) + (sp.quota ? ' di circa ' + mb(sp.quota) + ' disponibili per questo sito' : '') + ' (tutti i profili).' }),
        sp.quota ? el('div', { class: 'backup-barra', role: 'img', 'aria-label': 'Spazio usato ' + Math.round(sp.usato / sp.quota * 100) + '%' }, el('span', { style: 'width:' + Math.min(100, Math.max(1, sp.usato / sp.quota * 100)) + '%' })) : null,
        sp.quota && sp.usato / sp.quota > 0.8 ? el('p', { class: 'warning-text small', text: '⚠ Lo spazio sta finendo: esporta i dati ed elimina immagini o TileSet che non usi.' }) : null]
        : el('p', { class: 'muted small', text: 'Il browser non indica lo spazio usato.' }));
      pers.textContent = p === null ? 'Archiviazione persistente: il browser non lo indica.' : p ? '✔ Archiviazione persistente: attiva (il browser non cancella i dati per fare spazio).' : '⚠ Archiviazione non persistente: se lo spazio sul disco scarseggia il browser può cancellare i dati. Chiedila qui sotto ed esporta spesso un backup.';
    }
    ridisegnaSpazio();
  }

  DnD.uiBackup = { apri, avvia, avvisiPortale, segnaEsportazione, salvaOra, importaFile, importazioneInSospeso, stato, controlla, riautorizza };
})(globalThis.DnD = globalThis.DnD || {});
