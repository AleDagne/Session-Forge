// Note del master: pulsante fisso sul bordo destro (a metà altezza) e pannello che scorre da destra, sopra il
// contenuto (non ridimensiona il canvas). Si apre e chiude con il pulsante, Alt+N ed Esc (con il focus nel
// pannello). Larghezza ridimensionabile dal bordo sinistro (300 px – 70% della finestra, a tutta larghezza sugli
// schermi stretti); stato e larghezza ricordati. Note della sessione corrente, in più pagine, con salvataggio
// automatico (debounce di 500 ms e alla chiusura), esportazione .html / .txt e stampa. Non è una voce del menù.
(function (DnD) {
  'use strict';

  const { el, clear, toast, promptText, svgIcon } = DnD.ui;
  const N = DnD.note;
  const OPEN_KEY = 'dnd-battaglie:note-aperte';
  const WIDTH_KEY = 'dnd-battaglie:larghezza-note';
  const PAGE_KEY = 'dnd-battaglie:pagina-note';
  const DEFAULT_WIDTH = 420;
  const MIN_WIDTH = 300;
  const ICON = ['M6 3h10l4 4v14H6z', 'M16 3v4h4', 'M9 11h8', 'M9 15h8', 'M9 19h5', 'M4 6v14'];

  const clampWidth = (w, vw) => Math.round(Math.max(MIN_WIDTH, Math.min(Math.max(MIN_WIDTH, vw * 0.7), Number(w) || DEFAULT_WIDTH)));

  // opts: { host (elemento in cui montare, di base document.body), storage (di base localStorage), delay, store() }
  function create(opts) {
    const o = opts || {};
    const host = o.host || document.body;
    const storage = o.storage || window.localStorage;
    const store = o.store || (() => DnD.store);
    const pref = (k, v) => { try { if (v === undefined) return storage.getItem(k); storage.setItem(k, v); } catch (e) { /* preferenza non essenziale */ } return null; };
    const session = () => DnD.sessioni.current(store().state);
    let isOpen = false;
    let width = clampWidth(pref(WIDTH_KEY), window.innerWidth || 1200);
    let pageId = pref(PAGE_KEY);
    let editor = null;
    let shownFor = null;      // { sessionId, pageId } mostrati nell'editor

    // ---------- DOM ----------
    const fab = el('button', {
      type: 'button', class: 'notes-fab', id: 'notes-fab', title: 'Note del master (Alt+N)', 'aria-label': 'Note del master',
      'aria-pressed': 'false', 'aria-controls': 'notes-panel', 'aria-keyshortcuts': 'Alt+N', onclick: () => toggle(),
    }, svgIcon(ICON, 22));
    const status = el('span', { class: 'notes-status', 'aria-live': 'polite' });
    const words = el('span', { class: 'notes-words muted small' });
    const warn = el('div', { class: 'warn small', 'aria-live': 'polite' });
    const pageSel = el('select', { class: 'notes-pages', 'aria-label': 'Pagina delle note', onchange: (e) => switchPage(e.target.value) });
    const ib = (text, title, onclick) => el('button', { type: 'button', class: 'btn small', text, title, 'aria-label': title, onclick });
    const body = el('div', { class: 'notes-body' });
    const resizer = el('div', { class: 'notes-resizer', role: 'separator', tabindex: 0, 'aria-orientation': 'vertical', 'aria-label': 'Ridimensiona le note',
      'aria-valuemin': String(MIN_WIDTH), 'aria-valuenow': String(width) });
    const sessionName = el('span', { class: 'muted small' });
    const panel = el('aside', { class: 'notes-panel', id: 'notes-panel', role: 'complementary', 'aria-label': 'Note del master', hidden: true },
      resizer,
      el('header', { class: 'notes-head' },
        el('div', {}, el('h2', { text: 'Note del master' }), sessionName),
        el('button', { type: 'button', class: 'icon-btn', text: '✕', title: 'Chiudi (Esc)', 'aria-label': 'Chiudi le note', onclick: () => { close(); fab.focus(); } })),
      el('div', { class: 'notes-pagebar' }, pageSel,
        ib('＋', 'Nuova pagina', () => newPage()), ib('✎', 'Rinomina pagina', () => renamePage()), ib('⧉', 'Duplica pagina', () => duplicatePage()),
        ib('↑', 'Sposta su', () => movePage(-1)), ib('↓', 'Sposta giù', () => movePage(1)), ib('🗑', 'Elimina pagina', () => deletePage())),
      body,
      el('footer', { class: 'notes-foot' },
        status, words,
        el('span', { class: 'notes-actions' },
          ib('⬇ HTML', 'Esporta la pagina in .html', () => exportPage('html')),
          ib('⬇ TXT', 'Esporta la pagina in .txt', () => exportPage('txt')),
          ib('🖨', 'Stampa la pagina', () => printPage()))),
      warn);
    host.append(fab, panel);

    function applyWidth() {
      const vw = window.innerWidth || 1200;
      width = clampWidth(width, vw);
      document.documentElement.style.setProperty('--notes-w', width + 'px');
      resizer.setAttribute('aria-valuenow', String(width));
      resizer.setAttribute('aria-valuemax', String(Math.round(vw * 0.7)));
    }
    applyWidth();
    window.addEventListener('resize', applyWidth);
    resizer.addEventListener('pointerdown', (e) => {
      if (resizer.setPointerCapture) resizer.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const w0 = width;
      const mv = (ev) => { width = w0 + (x0 - ev.clientX); applyWidth(); };
      const up = () => { resizer.removeEventListener('pointermove', mv); resizer.removeEventListener('pointerup', up); pref(WIDTH_KEY, String(width)); };
      resizer.addEventListener('pointermove', mv);
      resizer.addEventListener('pointerup', up);
    });
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      width += e.key === 'ArrowLeft' ? 20 : -20;
      applyWidth();
      pref(WIDTH_KEY, String(width));
    });

    // ---------- Salvataggio ----------
    const STATUS = { modificato: 'Modifiche in sospeso…', salvataggio: 'Salvataggio…', salvato: '✓ Salvato', errore: '⚠ Non salvato' };
    function setStatus(state, message) {
      status.textContent = STATUS[state] + (message ? ': ' + message : '');
      status.dataset.state = state;
      status.classList.toggle('error', state === 'errore');
    }
    // Scrive la pagina nella sua sessione; il testo risulta salvato solo se la scrittura è riuscita.
    async function save(v) {
      if (N.tooLarge(v.html)) return { ok: false, message: 'la nota supera ' + Math.round(N.MAX_BYTES / 1024) + ' KB: accorciala o dividila in più pagine' };
      let found = false;
      const res = await store().update((st) => {
        const se = st.sessions.find((s) => s.id === v.sessionId);
        if (!se) return;
        se.pages = se.pages || [];
        let p = se.pages.find((x) => x.id === v.pageId);
        // La pagina predefinita "Appunti" nasce alla prima scrittura.
        if (!p) p = N.addPage(se.pages, N.DEFAULT_PAGE, v.pageId);
        p.html = N.sanitizeHtml(v.html);
        p.updatedAt = new Date().toISOString();
        found = true;
      });
      if (found && v.created) { v.created = false; renderPages(); }
      return res;
    }
    const autosave = N.createAutosave({ delay: o.delay === undefined ? 500 : o.delay, save, onStatus: setStatus, setTimer: o.setTimer, clearTimer: o.clearTimer });
    const flush = () => autosave.flush();

    function onEdit(h) {
      const se = session();
      const pages = se.pages || [];
      let id = shownFor && shownFor.pageId;
      let created = false;
      if (!id || !pages.some((p) => p.id === id)) { if (!id) id = DnD.dadi.uid(); created = true; }
      shownFor = { sessionId: se.id, pageId: id };
      pageId = id;
      pref(PAGE_KEY, id);
      updateCounts(h);
      autosave.change({ sessionId: se.id, pageId: id, html: h, created });
    }
    function updateCounts(h) {
      const n = N.wordCount(h);
      words.textContent = n + (n === 1 ? ' parola' : ' parole');
      const kb = N.byteSize(h) / 1024;
      warn.textContent = N.tooLarge(h) ? '⚠ Nota troppo grande (' + Math.round(kb) + ' KB, massimo ' + Math.round(N.MAX_BYTES / 1024) + ' KB): non verrà salvata finché non la accorci.'
        : kb > N.MAX_BYTES / 1024 * 0.8 ? 'Nota quasi al limite: ' + Math.round(kb) + ' KB su ' + Math.round(N.MAX_BYTES / 1024) + '.' : '';
    }

    // ---------- Pagine ----------
    const pages = () => session().pages || [];
    const currentPage = () => pages().find((p) => p.id === pageId) || pages()[0] || null;
    function renderPages() {
      const list = pages();
      const cur = currentPage();
      clear(pageSel).append(...(list.length ? list.map((p) => el('option', { value: p.id, text: p.name, selected: cur && p.id === cur.id }))
        : [el('option', { value: '', text: N.DEFAULT_PAGE + ' (nuova)' })]));
      sessionName.textContent = 'Sessione: ' + session().name;
    }
    // Mostra nell'editor la pagina corrente della sessione corrente.
    function show() {
      const se = session();
      const p = currentPage();
      pageId = p ? p.id : null;
      shownFor = { sessionId: se.id, pageId };
      renderPages();
      if (!editor) {
        editor = DnD.noteEditor.create({ html: p ? p.html : '', label: 'Note del master', onChange: onEdit });
        body.append(editor.node);
      } else {
        editor.setHtml(p ? p.html : '');
      }
      updateCounts(editor.getHtml());
      setStatus('salvato', '');
      if (!p) status.textContent = 'Scrivi per creare la pagina «' + N.DEFAULT_PAGE + '»';
    }
    async function switchPage(id) {
      await flush();
      pageId = id;
      pref(PAGE_KEY, id);
      show();
      editor.focus();
    }
    async function pageEdit(fn, okText) {
      await flush();
      let result = null;
      const res = await store().update((st) => {
        const se = DnD.sessioni.current(st);
        se.pages = se.pages || [];
        result = fn(se.pages);
      });
      if (!res.ok) toast('Note NON salvate: ' + res.message, 'error');
      else if (okText) toast(okText);
      return result;
    }
    function newPage() {
      promptText('Nuova pagina', 'Nome della pagina', 'Pagina ' + (pages().length + 1), (name) => {
        pageEdit((list) => N.addPage(list, name, DnD.dadi.uid())).then((p) => { if (p) { pageId = p.id; show(); editor.focus(); } });
        return null;
      });
    }
    function renamePage() {
      const p = currentPage();
      if (!p) { toast('Scrivi qualcosa per creare la prima pagina.'); return; }
      promptText('Rinomina pagina', 'Nome', p.name, (name) => { pageEdit((list) => N.renamePage(list, p.id, name)).then(() => renderPages()); return null; });
    }
    function duplicatePage() {
      const p = currentPage();
      if (!p) return;
      pageEdit((list) => N.duplicatePage(list, p.id, DnD.dadi.uid()), 'Pagina duplicata.').then((c) => { if (c) { pageId = c.id; show(); } });
    }
    function movePage(dir) {
      const p = currentPage();
      if (p) pageEdit((list) => N.movePage(list, p.id, dir)).then(() => renderPages());
    }
    function deletePage() {
      const p = currentPage();
      if (!p || !confirm('Eliminare la pagina «' + p.name + '» delle note?')) return;
      autosave.cancel();
      pageEdit((list) => N.removePage(list, p.id), 'Pagina eliminata.').then((next) => { pageId = next ? next.id : null; show(); });
    }

    // ---------- Esporta e stampa ----------
    const fileName = (ext) => DnD.uiImpostazioni.slug(DnD.config.APP_NAME) + '-note-' + DnD.uiImpostazioni.slug(session().name) + '-' +
      DnD.uiImpostazioni.slug(currentPage() ? currentPage().name : N.DEFAULT_PAGE) + '.' + ext;
    function exportPage(kind) {
      const h = editor.getHtml();
      const title = (currentPage() ? currentPage().name : N.DEFAULT_PAGE) + ' — ' + session().name;
      if (kind === 'txt') { DnD.uiImpostazioni.download(N.htmlToText(h), fileName('txt'), 'text/plain;charset=utf-8'); return; }
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const doc = '<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
        '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}</style>' +
        '</head><body><h1>' + esc(title) + '</h1>\n' + h + '\n</body></html>\n';
      DnD.uiImpostazioni.download(doc, fileName('html'), 'text/html;charset=utf-8');
    }
    function printPage() {
      flush();
      document.body.classList.add('printing-notes');
      const done = () => { document.body.classList.remove('printing-notes'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      if (typeof window.print === 'function') window.print();
      setTimeout(done, 1000);
    }

    // ---------- Apertura e chiusura ----------
    function open() {
      if (isOpen) return;
      isOpen = true;
      panel.hidden = false;
      document.documentElement.classList.add('notes-open');
      fab.setAttribute('aria-pressed', 'true');
      fab.classList.add('active');
      pref(OPEN_KEY, 'aperto');
      show();
      requestAnimationFrame(() => panel.classList.add('in'));
      if (editor) editor.focus();
    }
    function close() {
      if (!isOpen) return;
      flush();
      isOpen = false;
      panel.classList.remove('in');
      panel.hidden = true;
      document.documentElement.classList.remove('notes-open');
      fab.setAttribute('aria-pressed', 'false');
      fab.classList.remove('active');
      pref(OPEN_KEY, 'chiuso');
    }
    const toggle = () => (isOpen ? close() : open());
    const onKey = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyN' || e.key.toLowerCase() === 'n')) { e.preventDefault(); toggle(); return; }
      if (e.key === 'Escape' && isOpen && (panel.contains(e.target) || e.target === fab) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        close();
        fab.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', flush);

    // Dopo un cambio di sessione, un'importazione o una cancellazione.
    function refresh() {
      if (shownFor && shownFor.sessionId !== session().id) pageId = null;
      if (isOpen) show();
    }
    if (pref(OPEN_KEY) === 'aperto' && !o.closed) open();

    return {
      open, close, toggle, flush, refresh, fab, panel,
      isOpen: () => isOpen,
      editor: () => editor,
      status: () => status.dataset.state,
      destroy: () => {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('beforeunload', flush);
        window.removeEventListener('resize', applyWidth);
        document.documentElement.classList.remove('notes-open');
        if (editor) editor.destroy();
        fab.remove();
        panel.remove();
      },
    };
  }

  DnD.uiNote = { create, clampWidth, DEFAULT_WIDTH, MIN_WIDTH };
})(globalThis.DnD = globalThis.DnD || {});
