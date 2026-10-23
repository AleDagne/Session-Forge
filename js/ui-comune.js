// Helper DOM condivisi. I testi dell'utente vengono sempre inseriti come textContent, mai come HTML.
(function (DnD) {
  'use strict';

  // el('button', { class: 'btn', onclick: fn, text: 'Ok' }, ...figli)
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'selected') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  let fieldSeq = 0;

  // Campo con etichetta e spazio per l'errore. `key` collega il campo ai messaggi di validazione.
  function field(label, input, key, hint) {
    if (!input.id) input.id = 'f' + (++fieldSeq);
    if (key) input.dataset.key = key;
    return el('div', { class: 'field' },
      el('label', { for: input.id, text: label }),
      input,
      hint ? el('small', { class: 'hint', text: hint }) : null,
      key ? el('div', { class: 'error', 'data-error': key, 'aria-live': 'polite' }) : null);
  }

  function numberInput(value, attrs) {
    return el('input', Object.assign({ type: 'number', inputmode: 'numeric', value: value === null || value === undefined ? '' : String(value) }, attrs));
  }

  function textInput(value, attrs) {
    return el('input', Object.assign({ type: 'text', value: value || '' }, attrs));
  }

  // Legge un input numerico: stringa vuota o non numerica -> NaN (la validazione la segnala).
  function readNumber(input) {
    return input.value.trim() === '' ? NaN : Number(input.value);
  }

  // Mostra gli errori di validazione nel contenitore; restituisce true se non ce ne sono.
  function showErrors(container, errors) {
    for (const node of container.querySelectorAll('[data-error]')) node.textContent = '';
    for (const node of container.querySelectorAll('.invalid')) node.classList.remove('invalid');
    for (const [key, msg] of Object.entries(errors)) {
      const slot = container.querySelector('[data-error="' + key + '"]');
      if (slot) slot.textContent = msg;
      const input = container.querySelector('[data-key="' + key + '"]');
      if (input) input.classList.add('invalid');
    }
    const keys = Object.keys(errors);
    if (keys.length) {
      const first = container.querySelector('[data-key="' + keys[0] + '"]');
      if (first) first.focus();
      toast('Controlla i campi evidenziati.', 'error');
    }
    return keys.length === 0;
  }

  function toast(message, type) {
    const host = document.getElementById('toasts');
    if (!host) return;
    // Suoni dell'interfaccia (spenti di base): errore e conferma accompagnano gli avvisi.
    if (DnD.audio && (type === 'error' || type === 'success')) DnD.audio.suona(type === 'error' ? 'errore' : 'conferma', { coda: true });
    const t = el('div', { class: 'toast ' + (type || 'info'), role: 'status', text: message });
    host.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // Finestra modale basata su <dialog>. actions: [{ text, class, onclick }]; onclick restituisce false per non chiudere.
  function openDialog(title, body, actions) {
    const dialog = el('dialog', { class: 'modal' });
    const close = () => { dialog.close(); dialog.remove(); };
    // Senza azioni non c'è il piede (append scriverebbe un null come testo "null").
    dialog.append(...[
      el('header', { class: 'modal-header' },
        el('h2', { text: title }),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', text: '✕', onclick: close })),
      el('div', { class: 'modal-body' }, body),
      actions && actions.length
        ? el('footer', { class: 'modal-actions' }, actions.map((a) => el('button', {
          type: 'button', class: 'btn ' + (a.class || ''), text: a.text,
          onclick: () => { if (!a.onclick || a.onclick() !== false) close(); },
        })))
        : null,
    ].filter(Boolean));
    dialog.addEventListener('close', () => dialog.remove());
    dialog.dismiss = close; // chiude e rimuove subito (il close nativo rimuove solo all'evento asincrono)
    document.body.appendChild(dialog);
    dialog.showModal();
    return dialog;
  }

  // Chiede un testo (es. il nome di una griglia). onOk(valore) restituisce un messaggio d'errore o nulla.
  function promptText(title, label, initial, onOk) {
    const input = textInput(initial, { maxlength: 60, 'data-key': 'value' });
    const body = el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); dialog.querySelector('.btn.primary').click(); } },
      field(label, input, 'value'));
    const dialog = openDialog(title, body, [
      { text: 'Annulla' },
      { text: 'Conferma', class: 'primary', onclick: () => {
        const v = input.value.trim();
        const err = v ? onOk(v) : 'Il nome è obbligatorio.';
        if (err) { showErrors(body, { value: err }); return false; }
        return undefined;
      } },
    ]);
    input.focus();
    input.select();
  }

  // Menu contestuale alle coordinate dello schermo. items: [{ text, onclick, disabled, danger }]
  let openMenuNode = null;
  function closeMenu() {
    if (openMenuNode) openMenuNode.remove();
    openMenuNode = null;
  }
  function openMenu(clientX, clientY, items) {
    closeMenu();
    const menu = el('div', { class: 'context-menu', role: 'menu' }, items.map((it) => el('button', {
      type: 'button', role: 'menuitem', class: it.danger ? 'danger' : null, text: it.text, disabled: it.disabled,
      onclick: () => { closeMenu(); it.onclick(); },
    })));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(clientX, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(clientY, window.innerHeight - r.height - 8) + 'px';
    openMenuNode = menu;
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (openMenuNode && !openMenuNode.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // Pannello richiudibile con stato ricordato (localStorage). Su schermi stretti parte chiuso.
  // apply(collapsed) aggiorna la UI; restituisce { toggle(forza?), collapsed() }.
  function persistentToggle(key, apply) {
    let collapsed = false;
    try { collapsed = localStorage.getItem(key) === 'chiuso'; } catch (e) { /* preferenza non essenziale */ }
    if (window.matchMedia('(max-width: 760px)').matches) collapsed = true;
    apply(collapsed);
    return {
      toggle(force) {
        collapsed = typeof force === 'boolean' ? force : !collapsed;
        try { localStorage.setItem(key, collapsed ? 'chiuso' : 'aperto'); } catch (e) { /* ignora */ }
        apply(collapsed);
      },
      collapsed: () => collapsed,
    };
  }

  // Icona SVG a tratto da un elenco di path (vedi DnD.config.ICONS e MENU).
  function svgIcon(paths, size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size || 20, height: size || 20, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'svg-icon' })) {
      svg.setAttribute(k, v);
    }
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  // Schermata vuota con pulsanti rapidi. actions: [{ text, onclick, primary }]
  function emptyState(title, text, actions) {
    return el('div', { class: 'empty-state' },
      el('h2', { text: title }),
      el('p', { class: 'muted', text }),
      el('div', { class: 'head-actions' }, actions.map((a) => el('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : ''), text: a.text, onclick: a.onclick }))));
  }

  function scrollBehavior() {
    return DnD.impostazioni && DnD.impostazioni.reduceMotion() ? 'auto' : 'smooth';
  }

  function raceName(id) {
    const r = DnD.store.state.races.find((x) => x.id === id);
    return r ? r.name : id ? 'Razza eliminata' : 'Nessuna razza';
  }

  // Le scorciatoie globali dell'app non scattano mentre si scrive in un editor di testo (contenteditable,
  // come le note del master): lì valgono quelle dell'editor.
  function shortcutsBlocked(e) {
    const t = e && e.target;
    return Boolean(t && t.nodeType === 1 && (t.isContentEditable || (t.closest && t.closest('[contenteditable="true"]'))));
  }

  DnD.ui = { shortcutsBlocked, el, clear, field, numberInput, textInput, readNumber, showErrors, toast, openDialog, promptText, openMenu, closeMenu, persistentToggle, scrollBehavior, svgIcon, emptyState, raceName };
})(globalThis.DnD = globalThis.DnD || {});
