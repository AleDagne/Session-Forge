// Sezione "Asset": gli elementi da piazzare sulla griglia e il catalogo degli oggetti di gioco. Schede
// Strutture, Oggetti (sotto-schede Attrezzatura e Oggetti di mappa), Biomi ed Eventi (per l'esplorazione).
(function (DnD) {
  'use strict';

  const { el, clear } = DnD.ui;
  const TABS = [{ id: 'strutture', label: 'Strutture' }, { id: 'oggetti', label: 'Oggetti' }, { id: 'biomi', label: 'Biomi' }, { id: 'eventi', label: 'Eventi' }];
  const SUBTABS = [{ id: 'attrezzatura', label: 'Attrezzatura' }, { id: 'oggettiMappa', label: 'Oggetti di mappa' }];
  const TAB_KEY = 'dnd-battaglie:scheda-asset';
  const SUB_KEY = 'dnd-battaglie:scheda-oggetti';
  let active = 'strutture';
  let sub = 'attrezzatura';
  try {
    active = TABS.some((t) => t.id === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'strutture';
    sub = localStorage.getItem(SUB_KEY) === 'oggettiMappa' ? 'oggettiMappa' : 'attrezzatura';
  } catch (e) { /* preferenza non essenziale */ }
  let root = null;

  // Barra di schede accessibile (frecce sinistra/destra). onSelect(id, focus).
  function tabBar(tabs, current, label, idPrefix, onSelect, small) {
    return el('div', { class: 'tabs' + (small ? ' small-tabs' : ''), role: 'tablist', 'aria-label': label }, tabs.map((t, i) => el('button', {
      type: 'button', role: 'tab', id: idPrefix + t.id, 'aria-controls': idPrefix + 'pannello',
      'aria-selected': String(t.id === current), tabindex: t.id === current ? '0' : '-1', class: 'tab' + (t.id === current ? ' active' : ''),
      text: t.label,
      onclick: () => onSelect(t.id),
      onkeydown: (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        onSelect(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].id, true);
      },
    })));
  }

  function select(id, focus) {
    active = id;
    try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* ignora */ }
    resetAll();
    render();
    if (focus) root.querySelector('.tabs [aria-selected="true"]').focus();
  }
  function selectSub(id, focus) {
    sub = id;
    try { localStorage.setItem(SUB_KEY, id); } catch (e) { /* ignora */ }
    resetAll();
    render();
    if (focus) root.querySelector('.small-tabs [aria-selected="true"]').focus();
  }
  const resetAll = () => { for (const k of ['strutture', 'attrezzatura', 'oggettiMappa', 'biomi', 'eventi']) DnD.schede[k].reset(); };

  function render(container) {
    root = container || root;
    clear(root);
    root.append(el('div', { class: 'section-head' }, el('h1', { text: 'Asset' })),
      tabBar(TABS, active, 'Asset', 'scheda-asset-', select));
    const panel = el('div', { role: 'tabpanel', id: 'scheda-asset-pannello', 'aria-labelledby': 'scheda-asset-' + active });
    if (active === 'oggetti') {
      root.append(tabBar(SUBTABS, sub, 'Oggetti', 'scheda-oggetti-', selectSub, true));
      panel.id = 'scheda-oggetti-pannello';
      root.append(panel);
      DnD.schede[sub].render(panel);
      return;
    }
    root.append(panel);
    DnD.schede[active === 'biomi' || active === 'eventi' ? active : 'strutture'].render(panel);
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.asset = { title: 'Asset', render, reset: resetAll };
  DnD.uiAsset = { tabBar };
})(globalThis.DnD = globalThis.DnD || {});
