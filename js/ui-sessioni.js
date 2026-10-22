// Selettore "Sessione corrente" in cima alla barra laterale: cambia, crea, modifica, duplica, elimina.
(function (DnD) {
  'use strict';

  const { el, clear, field, textInput, showErrors, toast, promptText, openDialog, svgIcon } = DnD.ui;
  const S = DnD.sessioni;
  let select = null;
  let compact = null;

  const state = () => DnD.store.state;
  const current = () => S.current(state());
  const nameTaken = (name, exceptId) => state().sessions.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());

  function refresh() {
    if (!select) return;
    clear(select).append(...state().sessions.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === current().id })));
    compact.title = 'Sessione corrente: ' + current().name;
    compact.setAttribute('aria-label', compact.title);
  }

  function created(message) {
    toast(message, 'success');
    DnD.app.refreshAll();
  }

  function newSession() {
    if (!DnD.app.canLeaveSection()) return;
    promptText('Nuova sessione', 'Nome della sessione', '', (name) => {
      if (nameTaken(name)) return 'Esiste già una sessione con questo nome.';
      DnD.store.update((st) => S.addSession(st, name, DnD.dadi.uid));
      created('Sessione «' + name + '» creata.');
      return null;
    });
  }

  // Nome, descrizione e note del master della sessione corrente.
  function editSession() {
    const s = current();
    const name = textInput(s.name, { maxlength: 60, 'data-key': 'name' });
    const description = el('textarea', { rows: 3, value: s.description, maxlength: 2000 });
    const notes = el('textarea', { rows: 8, value: s.notes, maxlength: 20000 });
    const body = el('div', { class: 'form' },
      field('Nome', name, 'name'),
      field('Descrizione', description),
      field('Note del master', notes, null, 'Visibili solo a te: trame, segreti, promemoria per la sessione.'));
    openDialog('Sessione', body, [
      { text: 'Annulla' },
      { text: 'Salva', class: 'primary', onclick: () => {
        const n = name.value.trim();
        const errors = {};
        if (!n) errors.name = 'Il nome è obbligatorio.';
        else if (nameTaken(n, s.id)) errors.name = 'Esiste già una sessione con questo nome.';
        if (!showErrors(body, errors)) return false;
        DnD.store.update(() => Object.assign(s, { name: n, description: description.value.trim(), notes: notes.value.trim() }));
        refresh();
        toast('Sessione aggiornata.', 'success');
        return undefined;
      } },
    ]);
    name.focus();
  }

  function duplicateSession() {
    if (!DnD.app.canLeaveSection()) return;
    const src = current();
    promptText('Duplica sessione', 'Nome della copia', S.uniqueName(state(), src.name + ' (copia)'), (name) => {
      if (nameTaken(name)) return 'Esiste già una sessione con questo nome.';
      DnD.store.update((st) => S.duplicateSession(st, src.id, name, DnD.dadi.uid));
      created('Sessione duplicata: «' + name + '».');
      return null;
    });
  }

  function deleteSession() {
    const s = current();
    if (state().sessions.length <= 1) {
      toast('Deve restare almeno una sessione: creane un\'altra prima di eliminare questa.', 'error');
      return;
    }
    const own = (key) => state()[key].filter((x) => x.sessionId === s.id && !x.shared).length;
    if (!confirm('Eliminare la sessione «' + s.name + '»?\nVerranno eliminati anche ' + own('npcs') + ' nemici, ' + own('players') + ' giocatori e ' +
      own('savedGrids') + ' griglie della sessione, oltre al combattimento in corso. Gli elementi condivisi restano.')) return;
    if (!DnD.app.canLeaveSection()) return;
    DnD.store.update((st) => S.deleteSession(st, s.id));
    created('Sessione «' + s.name + '» eliminata.');
  }

  function mount(container) {
    select = el('select', { id: 'session-select', 'aria-label': 'Sessione corrente', onchange: () => {
      if (!DnD.app.switchSession(select.value)) refresh(); // uscita annullata: torna alla sessione di prima
    } });
    const btn = (icon, title, onclick) => el('button', { type: 'button', class: 'icon-btn', title, 'aria-label': title, text: icon, onclick });
    // Da barra chiusa resta un'icona: cliccandola si riapre la barra.
    compact = el('button', { type: 'button', class: 'icon-btn session-compact', onclick: () => DnD.app.toggleSidebar(false) }, svgIcon(DnD.config.ICONS.book));
    container.append(
      compact,
      el('div', { class: 'session-full' },
        el('label', { class: 'session-label', for: 'session-select', text: 'Sessione corrente' }),
        select,
        el('div', { class: 'session-actions' },
          btn('+', 'Nuova sessione', newSession),
          btn('✎', 'Rinomina e modifica descrizione e note', editSession),
          btn('⧉', 'Duplica sessione', duplicateSession),
          btn('🗑', 'Elimina sessione', deleteSession))));
    refresh();
  }

  DnD.uiSessioni = { mount, refresh, newSession, editSession, duplicateSession, deleteSession };
})(globalThis.DnD = globalThis.DnD || {});
