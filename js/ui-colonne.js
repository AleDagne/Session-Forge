// Disposizione a tre colonne delle schermate di gioco (Combattimento, Esplorazione, Online): colonne laterali
// ridimensionabili e richiudibili, schede sugli schermi stretti, preferenze salvate con la chiave indicata.
// Livello interfaccia. Espone DnD.uiColonne { columns }; usa DnD.ui e layout-combattimento (calcoli e preferenze).
(function (DnD) {
  'use strict';

  const { el } = DnD.ui;
  const LC = DnD.layoutCombattimento;

  // opts: { key, left: { title, label, head: [nodi], body: [nodi] }, center: nodo, right: { … } }
  function columns(opts) {
    let P = LC.load(DnD.archivioLocale.preferenze, opts.key);
    const store = () => LC.save(DnD.archivioLocale.preferenze, P, opts.key);
    const layout = el('div', { class: 'combat-layout' });
    function apply() {
      layout.style.setProperty('--left-w', P.left + 'px');
      layout.style.setProperty('--right-w', P.right + 'px');
      layout.classList.toggle('left-closed', !P.leftOpen);
      layout.classList.toggle('right-closed', !P.rightOpen);
      layout.dataset.tab = P.tab;
      for (const b of layout.querySelectorAll('[data-layout-tab]')) {
        const on = b.dataset.layoutTab === P.tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      }
      for (const [side, open] of [['left', P.leftOpen], ['right', P.rightOpen]]) {
        const btn = layout.querySelector('[data-collapse="' + side + '"]');
        if (!btn) continue;
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = side === 'left' ? (open ? '«' : '»') : (open ? '»' : '«');
        btn.title = (open ? 'Chiudi' : 'Apri') + ' «' + (side === 'left' ? opts.left.title : opts.right.title) + '»';
        btn.setAttribute('aria-label', btn.title);
      }
    }
    // Divisore trascinabile (o con le frecce) di una colonna laterale.
    function divider(side) {
      const total = () => layout.getBoundingClientRect().width;
      const setWidth = (w) => {
        P[side] = LC.clamp(w, total());
        apply();
        d.setAttribute('aria-valuenow', String(P[side]));
      };
      const d = el('div', {
        class: 'pane-divider', role: 'separator', tabindex: 0, 'aria-orientation': 'vertical', 'data-divider': side,
        'aria-label': 'Ridimensiona la colonna «' + (side === 'left' ? opts.left.title : opts.right.title) + '»',
        'aria-valuenow': String(P[side]), 'aria-valuemin': String(LC.MIN),
        onpointerdown: (e) => {
          d.setPointerCapture(e.pointerId);
          const r = layout.getBoundingClientRect();
          const move = (ev) => setWidth(side === 'left' ? ev.clientX - r.left : r.right - ev.clientX);
          const up = () => {
            d.removeEventListener('pointermove', move);
            d.removeEventListener('pointerup', up);
            store();
          };
          d.addEventListener('pointermove', move);
          d.addEventListener('pointerup', up);
        },
        onkeydown: (e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const grow = (e.key === 'ArrowRight') === (side === 'left');
          setWidth(P[side] + (grow ? 20 : -20));
          store();
        },
      });
      return d;
    }
    const collapseBtn = (side) => el('button', { type: 'button', class: 'icon-btn collapse-btn', 'data-collapse': side, onclick: () => {
      const k = side === 'left' ? 'leftOpen' : 'rightOpen';
      P[k] = !P[k];
      store();
      apply();
    } });
    const tabBtn = (id, label) => el('button', { type: 'button', role: 'tab', class: 'tab', 'data-layout-tab': id, text: label, onclick: () => { P.tab = id; store(); apply(); } });
    const left = el('aside', { class: 'combat-col combat-entities', role: 'tabpanel', 'aria-label': opts.left.title },
      el('div', { class: 'combat-col-head' }, el('h2', { text: opts.left.title }), ...(opts.left.head || []), collapseBtn('left')), ...opts.left.body);
    const right = el('aside', { class: 'combat-col combat-turns', role: 'tabpanel', 'aria-label': opts.right.title },
      el('div', { class: 'combat-col-head' }, collapseBtn('right'), el('h2', { text: opts.right.title }), ...(opts.right.head || [])), ...opts.right.body);
    const tabs = el('div', { class: 'tabs combat-tabs', role: 'tablist', 'aria-label': 'Pannelli' }, tabBtn('entita', opts.left.title), tabBtn('turni', opts.right.title));
    layout.append(left, divider('left'), opts.center, divider('right'), right, tabs);
    apply();
    return { layout, reset: () => { P = LC.reset(DnD.archivioLocale.preferenze, opts.key); apply(); } };
  }

  DnD.uiColonne = { columns };
})(globalThis.DnD = globalThis.DnD || {});
