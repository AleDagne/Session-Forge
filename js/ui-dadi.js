// Menu dadi: widget riutilizzabile, montato nella sezione Dadi e nel pannello flottante.
(function (DnD) {
  'use strict';

  const { el, clear, numberInput, textInput, readNumber, toast } = DnD.ui;
  const DICE = [4, 6, 8, 10, 12, 20];

  function mount(container) {
    const count = numberInput(1, { min: 1, max: DnD.dadi.MAX_COUNT, 'aria-label': 'Numero di dadi' });
    const mod = numberInput(0, { 'aria-label': 'Modificatore' });
    const expr = textInput('', { placeholder: 'es. 3d6+2', 'aria-label': 'Espressione libera' });
    const result = el('div', { class: 'dice-result', 'aria-live': 'polite' }, el('span', { class: 'muted', text: 'Scegli un dado da tirare.' }));
    const history = el('ol', { class: 'dice-history' });

    function show(r, label) {
      DnD.store.update((st) => DnD.dati.pushDiceHistory(st, { expr: label, rolls: r.rolls, total: r.total }));
      clear(result).append(
        el('div', { class: 'dice-expr', text: label }),
        el('div', { class: 'dice-rolls' }, r.rolls.map((v) => el('span', {
          class: 'die' + (v === r.sides ? ' max' : v === 1 ? ' min' : ''), text: String(v),
        })), r.modifier ? el('span', { class: 'die-mod', text: DnD.regole.formatModifier(r.modifier) }) : null),
        el('div', { class: 'dice-total', text: String(r.total) }));
      renderHistory();
    }

    function rollDie(sides) {
      const n = readNumber(count);
      const m = mod.value.trim() === '' ? 0 : readNumber(mod);
      if (!Number.isInteger(n) || n < 1 || n > DnD.dadi.MAX_COUNT) {
        toast('Il numero di dadi deve essere un intero tra 1 e ' + DnD.dadi.MAX_COUNT + '.', 'error');
        return;
      }
      if (!Number.isInteger(m) || Math.abs(m) > 1000) {
        toast('Il modificatore deve essere un intero tra -1000 e 1000.', 'error');
        return;
      }
      show(DnD.dadi.roll(n, sides, m), DnD.dadi.formatExpr(n, sides, m));
    }

    function rollExpr(ev) {
      ev.preventDefault();
      const p = DnD.dadi.parseExpr(expr.value);
      if (!p || !p.count) {
        toast('Espressione non valida. Usa il formato NdM+X, ad esempio 3d6+2.', 'error');
        return;
      }
      show(DnD.dadi.roll(p.count, p.sides, p.modifier), DnD.dadi.formatExpr(p.count, p.sides, p.modifier));
    }

    function renderHistory() {
      const h = DnD.store.state.diceHistory;
      clear(history);
      if (!h.length) history.append(el('li', { class: 'muted', text: 'Nessun tiro.' }));
      for (const e of h) {
        history.append(el('li', {},
          el('span', { class: 'hist-expr', text: e.expr }),
          el('span', { class: 'muted small', text: '[' + e.rolls.join(', ') + ']' }),
          el('b', { text: String(e.total) })));
      }
    }

    container.append(el('div', { class: 'dice-widget' },
      el('div', { class: 'dice-controls' },
        el('label', { class: 'inline' }, 'Dadi ', count),
        el('label', { class: 'inline' }, 'Modificatore ', mod)),
      el('div', { class: 'dice-buttons' }, DICE.map((s) => el('button', { type: 'button', class: 'btn die-btn', text: 'd' + s, onclick: () => rollDie(s) }))),
      el('form', { class: 'dice-expr-form', onsubmit: rollExpr }, expr, el('button', { type: 'submit', class: 'btn', text: 'Tira' })),
      result,
      el('div', { class: 'history-head' },
        el('h3', { text: 'Ultimi tiri' }),
        el('button', { type: 'button', class: 'btn small', text: 'Svuota', onclick: () => { DnD.store.update((st) => { st.diceHistory = []; }); renderHistory(); } })),
      history));
    renderHistory();
  }

  function render(container) {
    clear(container).append(el('div', { class: 'section-head' }, el('h1', { text: 'Dadi' })), el('div', { class: 'panel' }));
    mount(container.lastChild);
  }

  function openPanel() {
    const body = el('div');
    mount(body);
    DnD.ui.openDialog('Dadi', body);
  }

  DnD.sezioni = DnD.sezioni || {};
  DnD.sezioni.dadi = { title: 'Dadi', render };
  DnD.uiDadi = { mount, openPanel };
})(globalThis.DnD = globalThis.DnD || {});
