// Suoni: gruppo «Suoni» nel pannello delle impostazioni (interruttore generale, volume, avviso del turno, Prova
// suono), finestra «Tutti i suoni» (categorie ed eventi: acceso/spento, volume, Ascolta, Sostituisci con un file,
// Ripristina, Predefinito/Personalizzato) e pulsante rapido con l'altoparlante accanto al tema (anche Alt+M).
// Tutto passa da DnD.audio (audio.js); questo file non conosce la Web Audio API.
(function (DnD) {
  'use strict';

  const { el, clear, toast, openDialog, svgIcon } = DnD.ui;
  const SD = DnD.suoniDati;
  const A = () => DnD.audio;
  const ICONS = {
    on: ['M11 5L6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
    off: ['M11 5L6 9H3v6h3l5 4z', 'M16 9l6 6', 'M22 9l-6 6'],
  };
  const listeners = new Set(); // sync di chi mostra lo stato (pulsante rapido, gruppo nelle impostazioni, finestra)
  const notify = () => listeners.forEach((fn) => fn());

  function range(value, label, onchange) {
    const input = el('input', { type: 'range', min: 0, max: 100, step: 5, value: String(value), 'aria-label': label, onchange: () => onchange(Number(input.value)) });
    return input;
  }
  // Ascolta e Prova sono gesti dell'utente: il contesto audio si sblocca qui se non lo era già.
  function listen(id) {
    A().sblocca();
    const r = A().suona(id, { anteprima: true });
    if (!r.suonato) toast('Impossibile ascoltare il suono: ' + r.motivo + '.', 'error');
  }

  // Interruttore generale (Alt+M, pulsante rapido): lo stato si vede sempre sull'icona.
  function toggle() {
    A().sblocca();
    const on = A().toggle();
    notify();
    toast(on ? 'Suoni attivi.' : 'Suoni spenti.');
    return on;
  }

  function quickButton() {
    const btn = el('button', { type: 'button', class: 'icon-btn footer-btn sound-btn', id: 'sound-btn', onclick: toggle });
    const sync = () => {
      const on = A().attivo();
      clear(btn).append(svgIcon(on ? ICONS.on : ICONS.off));
      btn.classList.toggle('off', !on);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = (on ? 'Suoni attivi: clic per silenziare' : 'Suoni spenti: clic per attivarli') + ' (Alt+M)';
      btn.setAttribute('aria-label', on ? 'Silenzia tutti i suoni' : 'Attiva i suoni');
    };
    listeners.add(sync);
    sync();
    return btn;
  }

  // Gruppo nel pannello delle impostazioni: { node, sync }.
  function settingsGroup() {
    const on = el('input', { type: 'checkbox', onchange: () => { A().sblocca(); A().imposta({ on: on.checked }); notify(); } });
    const loud = el('input', { type: 'checkbox', onchange: () => { A().imposta({ turnoEvidente: loud.checked }); } });
    const volume = range(A().impostazioni().volume, 'Volume generale dei suoni', (v) => A().imposta({ volume: v }));
    const node = el('details', { class: 'settings-group' }, el('summary', { text: 'Suoni' }),
      el('label', { class: 'check small' }, on, ' Suoni (spenti di base, Alt+M)'),
      el('label', { class: 'inline small' }, 'Volume ', volume),
      el('label', { class: 'check small', title: 'Il «ding» del turno di un giocatore è più forte e ripetuto' }, loud, ' Avvisi sonori più evidenti per il turno'),
      el('div', { class: 'settings-actions' },
        el('button', { type: 'button', class: 'btn small', text: '🔊 Prova suono', onclick: () => {
          A().sblocca();
          const r = A().suona('turno-giocatore');
          if (!r.suonato) toast('Nessun suono: ' + r.motivo + '.');
        } }),
        el('button', { type: 'button', class: 'btn small', text: 'Tutti i suoni…', onclick: openPanel })),
      el('p', { class: 'muted small', text: 'Indipendenti da «Riduci animazioni». Ogni suono ha anche un riscontro visivo (log, evidenziazione, banner).' }));
    const sync = () => {
      const s = A().impostazioni();
      on.checked = s.on;
      loud.checked = s.turnoEvidente;
      volume.value = String(s.volume);
    };
    listeners.add(sync);
    sync();
    return { node, sync };
  }

  // ---------- Finestra «Tutti i suoni» ----------
  function eventRow(ev, redraw) {
    const s = A().impostazioni().eventi[ev.id];
    const source = A().fonte(ev.id);
    const file = el('input', { type: 'file', accept: 'audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav', hidden: true, onchange: async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      A().sblocca();
      try {
        await A().sostituisci(ev.id, f);
        toast('«' + ev.label + '»: ora usa «' + f.name + '».', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      redraw();
    } });
    const tagText = source === 'predefinito' ? 'Predefinito' : source === 'non leggibile' ? 'File non leggibile: sintesi' : 'Personalizzato';
    return el('div', { class: 'sound-row' },
      el('label', { class: 'check small sound-name' },
        el('input', { type: 'checkbox', checked: s.on, onchange: (e) => A().impostaEvento(ev.id, { on: e.target.checked }) }), ' ' + ev.label),
      range(s.volume, 'Volume: ' + ev.label, (v) => A().impostaEvento(ev.id, { volume: v })),
      el('span', { class: 'tag sound-tag' + (source === 'predefinito' ? '' : ' custom') + (source === 'non leggibile' ? ' broken' : ''), title: s.file ? s.file.nome : 'Sintetizzato nel codice', text: tagText }),
      el('div', { class: 'sound-actions' },
        el('button', { type: 'button', class: 'btn small', text: '▶ Ascolta', 'aria-label': 'Ascolta: ' + ev.label, onclick: () => listen(ev.id) }),
        el('button', { type: 'button', class: 'btn small', text: 'Sostituisci…', 'aria-label': 'Sostituisci con un file: ' + ev.label, onclick: () => file.click() }),
        el('button', { type: 'button', class: 'btn small', text: 'Ripristina', 'aria-label': 'Ripristina il suono predefinito: ' + ev.label, disabled: !s.file, onclick: () => { A().ripristina(ev.id); redraw(); } }),
        file));
  }

  function openPanel() {
    const body = el('div', { class: 'form sound-panel' });
    const redraw = () => {
      const s = A().impostazioni();
      const top = el('div', { class: 'sound-top' },
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: s.on, onchange: (e) => { A().sblocca(); A().imposta({ on: e.target.checked }); notify(); } }), ' Suoni attivi'),
        el('label', { class: 'inline small' }, 'Volume generale ', range(s.volume, 'Volume generale dei suoni', (v) => { A().imposta({ volume: v }); notify(); })),
        el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: s.turnoEvidente, onchange: (e) => { A().imposta({ turnoEvidente: e.target.checked }); notify(); } }), ' Avvisi sonori più evidenti per il turno'));
      const cats = SD.CATEGORIES.map((c) => el('fieldset', { class: 'sound-cat' },
        el('legend', {}, el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: s.categorie[c.id].on, 'aria-label': 'Categoria ' + c.label, onchange: (e) => A().impostaCategoria(c.id, { on: e.target.checked }) }), ' ' + c.label)),
        el('label', { class: 'inline small' }, 'Volume della categoria ', range(s.categorie[c.id].volume, 'Volume della categoria ' + c.label, (v) => A().impostaCategoria(c.id, { volume: v }))),
        c.note ? el('p', { class: 'muted small', text: c.note }) : null,
        SD.EVENTS.filter((ev) => ev.cat === c.id).map((ev) => eventRow(ev, redraw))));
      clear(body).append(top,
        el('p', { class: 'muted small', text: 'Sostituisci un suono con un file mp3, ogg o wav (massimo 2 MB): usa solo file tuoi o con una licenza che lo consenta (ad esempio CC0), non estratti da videogiochi, film o siti non liberi. «Ripristina» torna al suono sintetizzato.' }),
        ...cats);
    };
    redraw();
    listeners.add(redraw);
    const dialog = openDialog('Suoni', body, [{ text: 'Chiudi' }]);
    dialog.classList.add('wide');
    dialog.addEventListener('close', () => listeners.delete(redraw));
  }

  // Alt+M: interruttore generale, da qualsiasi sezione (non nell'editor delle note, come le altre scorciatoie).
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.code !== 'KeyM' && String(e.key).toLowerCase() !== 'm')) return;
      if (DnD.ui.shortcutsBlocked(e)) return;
      e.preventDefault();
      toggle();
    });
  }

  DnD.uiSuoni = { quickButton, settingsGroup, openPanel, toggle, ICONS };
})(globalThis.DnD = globalThis.DnD || {});
