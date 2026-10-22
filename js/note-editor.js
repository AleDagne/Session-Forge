// Editor di testo ricco delle note del master (JavaScript puro su contenteditable). document.execCommand è
// usato in un solo punto (native) e solo per grassetto, corsivo, sottolineato, barrato, titoli, linea
// orizzontale e cancella formattazione; dimensione in px, colore, evidenziatore, allineamento, elenchi con
// rientro e tabelle usano Selection/Range. Annulla/ripeti propri (100 passi), incolla sanificato (Ctrl+Maiusc+V
// = testo semplice), nessuna immagine. I pulsanti riflettono lo stato del cursore.
(function (DnD) {
  'use strict';

  const N = DnD.note;
  const HISTORY = 100;
  const BLOCK_TAGS = ['P', 'DIV', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'TD', 'TH'];
  const LEAF_SELECTOR = 'p, div, h1, h2, h3, li, blockquote';
  const ZWSP = '​';
  // Icone SVG 24×24 a tratto (vedi DnD.ui.svgIcon).
  const ICONS = {
    undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
    redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
    smaller: ['M4 18l5-12 5 12', 'M5.5 14h7', 'M16 12h5'],
    larger: ['M4 18l5-12 5 12', 'M5.5 14h7', 'M18.5 9.5v5', 'M16 12h5'],
    color: ['M6 17l6-14 6 14', 'M8.5 12h7', 'M4 21h16'],
    highlight: ['M14 4l6 6-9 9H5v-6z', 'M4 21h16'],
    ul: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
    ol: ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 5l1.5-1v5', 'M3.5 13.5c0-1 2.5-1.5 2.5 0S3.5 16 3.5 17H6', 'M3.5 20h2.5'],
    indent: ['M4 6h16', 'M11 12h9', 'M11 18h9', 'M4 10l3 2.5L4 15'],
    outdent: ['M4 6h16', 'M11 12h9', 'M11 18h9', 'M7 10l-3 2.5L7 15'],
    left: ['M4 6h16', 'M4 10h10', 'M4 14h16', 'M4 18h10'],
    center: ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M7 18h10'],
    right: ['M4 6h16', 'M10 10h10', 'M4 14h16', 'M10 18h10'],
    justify: ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16'],
    table: ['M3 5h18v14H3z', 'M3 10h18', 'M3 15h18', 'M9 5v14', 'M15 5v14'],
    hr: ['M3 12h18', 'M7 7h10', 'M7 17h10'],
    clear: ['M6 6h12', 'M12 6l-3 13', 'M15 14l5 5', 'M20 14l-5 5'],
    rowAbove: ['M3 11h18v9H3z', 'M12 2v6', 'M9 5h6'],
    rowBelow: ['M3 4h18v9H3z', 'M12 16v6', 'M9 19h6'],
    colLeft: ['M11 3h9v18h-9z', 'M2 12h6', 'M5 9v6'],
    colRight: ['M4 3h9v18H4z', 'M16 12h6', 'M19 9v6'],
    delRow: ['M3 8h18v8H3z', 'M9 10l6 4', 'M15 10l-6 4'],
    delCol: ['M8 3h8v18H8z', 'M10 9l4 6', 'M14 9l-4 6'],
    header: ['M3 5h18v14H3z', 'M3 10h18', 'M5 7.5h14'],
    delTable: ['M3 5h18v14H3z', 'M8 9l8 6', 'M16 9l-8 6'],
  };

  // L'UNICO punto che usa document.execCommand / queryCommandState (assenti in alcuni ambienti).
  function native(cmd, value, query) {
    try {
      if (query) return typeof document.queryCommandState === 'function' ? document.queryCommandState(cmd) : false;
      return typeof document.execCommand === 'function' ? document.execCommand(cmd, false, value === undefined ? null : value) : false;
    } catch (e) {
      return false;
    }
  }

  // opts: { html, label, onChange(html) }
  function create(opts) {
    const { el } = DnD.ui;
    const onChange = opts.onChange || (() => {});
    const area = el('div', {
      class: 'note-area', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true',
      'aria-label': opts.label || 'Testo della nota',
    });
    let saved = null;          // ultimo intervallo selezionato nell'editor (i menù della barra rubano il focus)
    let plainNext = false;     // Ctrl+Maiusc+V: il prossimo incolla è testo semplice
    let lastHtml = '';
    let past = [];
    let future = [];
    let typing = null;

    // ---------- Selezione ----------
    const inArea = (n) => Boolean(n) && (n === area || area.contains(n));
    function range() {
      const s = window.getSelection();
      if (s && s.rangeCount && inArea(s.getRangeAt(0).commonAncestorContainer)) return s.getRangeAt(0);
      return null;
    }
    function select(r) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      saved = r.cloneRange();
    }
    // Ripristina la selezione salvata se il focus è uscito dall'editor (menù, selettori di colore).
    function restore() {
      if (range()) return range();
      if (saved && inArea(saved.startContainer)) { select(saved.cloneRange()); return range(); }
      const r = document.createRange();
      r.selectNodeContents(area);
      r.collapse(false);
      select(r);
      return range();
    }
    function caretIn(node, atEnd) {
      const r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(!atEnd);
      select(r);
    }
    const create_ = (tag) => document.createElement(tag);
    const unwrap = (node) => { while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node); node.remove(); };
    function rename(node, tag) {
      const n = create_(tag);
      while (node.firstChild) n.appendChild(node.firstChild);
      if (node.getAttribute('style')) n.setAttribute('style', node.getAttribute('style'));
      node.replaceWith(n);
      return n;
    }

    // ---------- Cronologia (annulla/ripeti) ----------
    const html = () => area.innerHTML;
    function commit() {
      clearTimeout(typing);
      typing = null;
      const h = html();
      if (h === lastHtml) return;
      past.push(lastHtml);
      if (past.length > HISTORY) past.shift();
      future = [];
      lastHtml = h;
    }
    function changed() {
      ensureContent();
      onChange(getHtml());
      refreshState();
    }
    // Esegue un comando come un unico passo annullabile.
    function command(fn) {
      commit();
      restore();
      fn();
      commit();
      changed();
      // Il focus torna nell'editor senza perdere la selezione appena impostata dal comando.
      const keep = range() ? range().cloneRange() : null;
      if (document.activeElement !== area) area.focus({ preventScroll: true });
      if (keep) select(keep);
    }
    function undo() {
      commit();
      if (!past.length) return false;
      future.push(lastHtml);
      lastHtml = past.pop();
      area.innerHTML = lastHtml;
      caretIn(area, true);
      changed();
      return true;
    }
    function redo() {
      commit();
      if (!future.length) return false;
      past.push(lastHtml);
      lastHtml = future.pop();
      area.innerHTML = lastHtml;
      caretIn(area, true);
      changed();
      return true;
    }

    // ---------- Blocchi ----------
    function ensureContent() {
      if (!area.firstChild || (area.childNodes.length === 1 && area.firstChild.nodeName === 'BR')) area.innerHTML = '<p><br></p>';
    }
    // Il testo scritto direttamente nell'editor va in paragrafi (i comandi di blocco lavorano sui blocchi).
    function ensureBlocks() {
      let p = null;
      for (const n of [...area.childNodes]) {
        const inline = n.nodeType === 3 || (n.nodeType === 1 && !['P', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'TABLE', 'HR', 'BLOCKQUOTE'].includes(n.nodeName));
        if (!inline) { p = null; continue; }
        if (n.nodeType === 3 && !n.textContent.trim() && !p) continue;
        if (!p) { p = create_('p'); area.insertBefore(p, n); }
        p.appendChild(n);
      }
      ensureContent();
    }
    function blockOf(node) {
      for (let n = node; n && n !== area; n = n.parentNode) if (n.nodeType === 1 && BLOCK_TAGS.includes(n.nodeName)) return n;
      return null;
    }
    // Blocchi "foglia" toccati dalla selezione, nell'ordine del documento.
    function selectedBlocks() {
      const r = range();
      if (!r) return [];
      const start = blockOf(r.startContainer);
      const end = blockOf(r.endContainer);
      if (!start) return [];
      if (start === end) return [start];
      const all = [...area.querySelectorAll(LEAF_SELECTOR)].filter((b) => !b.querySelector(LEAF_SELECTOR) || b.nodeName === 'LI');
      const i = all.indexOf(start);
      const j = all.indexOf(end);
      return i >= 0 && j >= i ? all.slice(i, j + 1) : [start];
    }
    const topLevel = (node) => { let n = node; while (n && n.parentNode !== area) n = n.parentNode; return n; };

    // ---------- Stile in linea: dimensione, colore, evidenziatore ----------
    function stripProp(root, prop) {
      for (const s of [...root.querySelectorAll('span')]) {
        s.style.removeProperty(prop);
        if (!s.getAttribute('style')) unwrap(s);
      }
    }
    // Divide un antenato che imposta la stessa proprietà, così il nuovo valore (o il predefinito) vale solo
    // per la selezione: le parti prima e dopo tengono il valore dell'antenato.
    function splitAround(anc, wrapper, prop) {
      const before = document.createRange();
      before.setStart(anc, 0);
      before.setEndBefore(wrapper);
      const after = document.createRange();
      after.setStartAfter(wrapper);
      after.setEnd(anc, anc.childNodes.length);
      const fb = before.extractContents();
      const fa = after.extractContents();
      if (fb.textContent) { const b = anc.cloneNode(false); b.appendChild(fb); anc.parentNode.insertBefore(b, anc); }
      if (fa.textContent) { const a = anc.cloneNode(false); a.appendChild(fa); anc.parentNode.insertBefore(a, anc.nextSibling); }
      anc.style.removeProperty(prop);
      if (!anc.getAttribute('style') && anc.nodeName === 'SPAN') unwrap(anc);
    }
    // Applica prop: value alla selezione (value null = predefinito: segue il tema o il testo circostante).
    function applyStyle(prop, value) {
      const r = restore();
      if (!r) return;
      const wrapper = create_('span');
      if (r.collapsed) wrapper.textContent = ZWSP;
      else {
        const frag = r.extractContents();
        stripProp(frag, prop);
        wrapper.appendChild(frag);
      }
      if (value) wrapper.style.setProperty(prop, value);
      r.insertNode(wrapper);
      for (let a = wrapper.parentNode; a && a !== area;) {
        const next = a.parentNode;
        if (a.nodeName === 'SPAN' && a.style.getPropertyValue(prop)) splitAround(a, wrapper, prop);
        a = next;
      }
      const sel = document.createRange();
      if (wrapper.textContent === ZWSP) { sel.setStart(wrapper.firstChild, 1); sel.collapse(true); } else sel.selectNodeContents(wrapper);
      select(sel);
      if (!wrapper.getAttribute('style') && wrapper.textContent !== ZWSP) {
        const first = wrapper.firstChild;
        const last = wrapper.lastChild;
        unwrap(wrapper);
        if (first) { const rr = document.createRange(); rr.setStartBefore(first); rr.setEndAfter(last); select(rr); }
      }
    }
    // Dimensione attuale (px) al cursore: la più vicina impostata nel testo, altrimenti quella calcolata.
    function currentSize() {
      const r = range() || saved;
      let n = r ? r.startContainer : null;
      if (n && n.nodeType === 3) n = n.parentNode;
      for (let x = n; x && inArea(x); x = x.parentNode) {
        if (x.style && x.style.fontSize && /px$/.test(x.style.fontSize)) return parseFloat(x.style.fontSize);
      }
      const cs = n && typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(n).fontSize) : NaN;
      return Number.isFinite(cs) && cs > 0 ? cs : 16;
    }
    function stepSize(dir) {
      const cur = currentSize();
      const list = N.FONT_SIZES;
      const next = dir > 0 ? list.find((v) => v > cur + 0.5) || list[list.length - 1] : list.slice().reverse().find((v) => v < cur - 0.5) || list[0];
      command(() => applyStyle('font-size', next + 'px'));
    }

    // ---------- Allineamento ----------
    function align(value) {
      command(() => { ensureBlocks(); for (const b of selectedBlocks()) b.style.textAlign = value === 'left' ? '' : value; });
    }

    // ---------- Elenchi con rientro ----------
    function liftItem(li) {
      const list = li.parentNode;
      const after = [...list.children].slice([...list.children].indexOf(li) + 1);
      const p = create_('p');
      const nested = [];
      while (li.firstChild) {
        const c = li.firstChild;
        if (c.nodeName === 'UL' || c.nodeName === 'OL') { nested.push(c); c.remove(); } else p.appendChild(c);
      }
      if (!p.firstChild) p.innerHTML = '<br>';
      let ref = list;
      if (after.length) { const tail = create_(list.nodeName); for (const x of after) tail.appendChild(x); list.after(tail); }
      ref.after(p);
      ref = p;
      for (const n of nested) { ref.after(n); ref = n; }
      li.remove();
      if (!list.children.length) list.remove();
      return p;
    }
    function indentItem(li) {
      const prev = li.previousElementSibling;
      if (!prev) return false;
      let sub = prev.lastElementChild;
      if (!sub || (sub.nodeName !== 'UL' && sub.nodeName !== 'OL')) { sub = create_(li.parentNode.nodeName); prev.appendChild(sub); }
      sub.appendChild(li);
      return true;
    }
    function outdentItem(li) {
      const list = li.parentNode;
      const parentLi = list.parentNode;
      if (!parentLi || parentLi.nodeName !== 'LI') return liftItem(li);
      const after = [...list.children].slice([...list.children].indexOf(li) + 1);
      if (after.length) { const sub = create_(list.nodeName); for (const x of after) sub.appendChild(x); li.appendChild(sub); }
      parentLi.after(li);
      if (!list.children.length) list.remove();
      return li;
    }
    const selectedItems = () => selectedBlocks().filter((b) => b.nodeName === 'LI');
    function toggleList(tag) {
      const T = tag.toUpperCase();
      command(() => {
        ensureBlocks();
        const r = range();
        const keep = r ? { node: r.startContainer, offset: r.startOffset } : null;
        const blocks = selectedBlocks();
        if (!blocks.length) return;
        const items = blocks.filter((b) => b.nodeName === 'LI');
        if (items.length === blocks.length && items.every((li) => li.parentNode.nodeName === T)) {
          for (const li of items.slice().reverse()) liftItem(li);
        } else {
          let list = null;
          for (const b of blocks) {
            if (b.nodeName === 'LI') { if (b.parentNode.nodeName !== T) rename(b.parentNode, tag); list = null; continue; }
            if (b.nodeName === 'TD' || b.nodeName === 'TH') {
              const l = create_(tag);
              const li = create_('li');
              while (b.firstChild) li.appendChild(b.firstChild);
              if (!li.firstChild) li.innerHTML = '<br>';
              l.appendChild(li);
              b.appendChild(l);
              continue;
            }
            const li = create_('li');
            while (b.firstChild) li.appendChild(b.firstChild);
            if (!li.firstChild) li.innerHTML = '<br>';
            if (b.style.textAlign) li.style.textAlign = b.style.textAlign;
            if (!list || list.nextSibling !== b) { list = create_(tag); b.parentNode.insertBefore(list, b); }
            list.appendChild(li);
            b.remove();
          }
        }
        if (keep && inArea(keep.node)) { const rr = document.createRange(); rr.setStart(keep.node, Math.min(keep.offset, keep.node.length !== undefined ? keep.node.length : keep.node.childNodes.length)); rr.collapse(true); select(rr); }
      });
    }
    function indent(back) {
      const items = selectedItems();
      if (!items.length) return false;
      command(() => { for (const li of back ? items.slice().reverse() : items) { if (back) outdentItem(li); else indentItem(li); } });
      return true;
    }

    // ---------- Tabelle ----------
    function currentCell() {
      const r = range() || saved;
      let n = r ? r.startContainer : null;
      for (; n && inArea(n); n = n.parentNode) if (n.nodeName === 'TD' || n.nodeName === 'TH') return n;
      return null;
    }
    const emptyCell = (tag) => { const c = create_(tag || 'td'); c.innerHTML = '<br>'; return c; };
    function insertTable(rows, cols) {
      rows = Math.max(1, Math.min(12, rows));
      cols = Math.max(1, Math.min(12, cols));
      command(() => {
        ensureBlocks();
        const table = create_('table');
        const body = create_('tbody');
        for (let i = 0; i < rows; i++) {
          const tr = create_('tr');
          for (let j = 0; j < cols; j++) tr.appendChild(emptyCell('td'));
          body.appendChild(tr);
        }
        table.appendChild(body);
        const r = range();
        const top = r ? topLevel(r.startContainer === area ? area.childNodes[r.startOffset] || area.lastChild : r.startContainer) : area.lastChild;
        if (top && top.nodeName === 'P' && !top.textContent.replace(ZWSP, '').trim()) top.replaceWith(table);
        else if (top) top.after(table);
        else area.appendChild(table);
        if (!table.nextSibling) { const p = create_('p'); p.innerHTML = '<br>'; table.after(p); }
        caretIn(table.querySelector('td'), false);
      });
    }
    // Comandi sulla tabella del cursore: righe sopra/sotto, colonne a sinistra/destra, eliminazioni, intestazione.
    function tableCommand(cmd) {
      const cell = currentCell();
      if (!cell) return false;
      command(() => {
        const tr = cell.parentNode;
        const table = cell.closest('table');
        const ci = [...tr.children].indexOf(cell);
        const rows = [...table.querySelectorAll('tr')];
        if (cmd === 'riga-sopra' || cmd === 'riga-sotto') {
          const n = create_('tr');
          for (const c of tr.children) n.appendChild(emptyCell(c.nodeName.toLowerCase()));
          if (cmd === 'riga-sopra') tr.before(n); else tr.after(n);
          caretIn(n.children[Math.min(ci, n.children.length - 1)], false);
        } else if (cmd === 'colonna-sinistra' || cmd === 'colonna-destra') {
          for (const row of rows) {
            const ref = row.children[Math.min(ci, row.children.length - 1)];
            const c = emptyCell(ref ? ref.nodeName.toLowerCase() : 'td');
            if (!ref) row.appendChild(c);
            else if (cmd === 'colonna-sinistra') ref.before(c);
            else ref.after(c);
          }
          caretIn(tr.children[cmd === 'colonna-sinistra' ? ci : ci + 1], false);
        } else if (cmd === 'elimina-riga') {
          if (rows.length <= 1) return removeTable(table);
          const next = rows[rows.indexOf(tr) + 1] || rows[rows.indexOf(tr) - 1];
          const section = tr.parentNode;
          tr.remove();
          if (!section.children.length) section.remove();
          caretIn(next.children[Math.min(ci, next.children.length - 1)], false);
        } else if (cmd === 'elimina-colonna') {
          if (tr.children.length <= 1) return removeTable(table);
          for (const row of rows) if (row.children[ci]) row.children[ci].remove();
          caretIn(tr.children[Math.min(ci, tr.children.length - 1)], false);
        } else if (cmd === 'elimina-tabella') {
          removeTable(table);
        } else if (cmd === 'intestazione') {
          if (table.tHead) {
            let body = table.tBodies[0];
            if (!body) { body = create_('tbody'); table.appendChild(body); }
            for (const row of [...table.tHead.rows].reverse()) {
              for (const c of [...row.children]) rename(c, 'td');
              body.insertBefore(row, body.firstChild);
            }
            table.tHead.remove();
          } else {
            const first = rows[0];
            const head = create_('thead');
            table.insertBefore(head, table.firstChild);
            head.appendChild(first);
            for (const c of [...first.children]) rename(c, 'th');
            const b = table.tBodies[0];
            if (b && !b.children.length) b.remove();
          }
          caretIn(table.querySelectorAll('tr')[Math.max(0, rows.indexOf(tr))].children[ci] || table.querySelector('td,th'), false);
        }
        return undefined;
      });
      return true;
    }
    function removeTable(table) {
      const p = create_('p');
      p.innerHTML = '<br>';
      table.replaceWith(p);
      caretIn(p, false);
    }
    // Tab nelle tabelle: cella successiva (o precedente); nell'ultima cella aggiunge una riga.
    function nextCell(back) {
      const cell = currentCell();
      if (!cell) return false;
      const table = cell.closest('table');
      const cells = [...table.querySelectorAll('td, th')];
      const i = cells.indexOf(cell);
      if (back) { if (i > 0) caretIn(cells[i - 1], true); return true; }
      if (i === cells.length - 1) {
        command(() => {
          const tr = cell.parentNode;
          const n = create_('tr');
          for (const c of tr.children) n.appendChild(emptyCell(c.nodeName === 'TH' ? 'td' : c.nodeName.toLowerCase()));
          if (tr.parentNode.nodeName === 'THEAD') {
            let body = table.tBodies[0];
            if (!body) { body = create_('tbody'); table.appendChild(body); }
            body.appendChild(n);
          } else tr.after(n);
          caretIn(n.firstChild, false);
        });
        return true;
      }
      caretIn(cells[i + 1], false);
      return true;
    }

    // Colonne ridimensionabili: trascinando il bordo destro di una cella.
    let resize = null;
    const nearEdge = (cell, x) => { const r = cell.getBoundingClientRect(); return r.width > 0 && x > r.right - 6 && x <= r.right + 2; };
    area.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest && e.target.closest('td, th');
      if (!cell || !inArea(cell) || !nearEdge(cell, e.clientX)) return;
      e.preventDefault();
      commit();
      const table = cell.closest('table');
      const ci = [...cell.parentNode.children].indexOf(cell);
      resize = { table, ci, x0: e.clientX, w0: cell.getBoundingClientRect().width };
      if (area.setPointerCapture) area.setPointerCapture(e.pointerId);
    });
    area.addEventListener('pointermove', (e) => {
      if (resize) {
        const w = Math.round(Math.max(30, resize.w0 + e.clientX - resize.x0));
        for (const row of resize.table.querySelectorAll('tr')) if (row.children[resize.ci]) row.children[resize.ci].style.width = w + 'px';
        return;
      }
      const cell = e.target.closest && e.target.closest('td, th');
      area.classList.toggle('resizing-col', Boolean(cell && nearEdge(cell, e.clientX)));
    });
    const endResize = () => { if (!resize) return; resize = null; commit(); changed(); };
    area.addEventListener('pointerup', endResize);
    area.addEventListener('pointercancel', endResize);

    // ---------- Incolla, trascina, digitazione ----------
    function insertHtml(h) {
      const r = restore();
      r.deleteContents();
      const frag = r.createContextualFragment(h);
      const last = frag.lastChild;
      r.insertNode(frag);
      if (last) { const rr = document.createRange(); rr.setStartAfter(last); rr.collapse(true); select(rr); }
    }
    area.addEventListener('paste', (e) => {
      e.preventDefault();
      const cd = e.clipboardData;
      if (!cd) return;
      const types = [...(cd.types || [])];
      const h = plainNext || !types.includes('text/html') ? N.textToHtml(cd.getData('text/plain')) : N.sanitizeHtml(cd.getData('text/html'));
      plainNext = false;
      command(() => insertHtml(h));
    });
    area.addEventListener('drop', (e) => {
      e.preventDefault(); // niente immagini o file trascinati; il testo trascinato si inserisce sanificato
      const dt = e.dataTransfer;
      if (!dt || (dt.files && dt.files.length)) return;
      const h = dt.getData('text/html') ? N.sanitizeHtml(dt.getData('text/html')) : N.textToHtml(dt.getData('text/plain'));
      if (h) command(() => insertHtml(h));
    });
    area.addEventListener('dragover', (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
    area.addEventListener('input', () => {
      clearTimeout(typing);
      typing = setTimeout(commit, 400);
      ensureContent();
      onChange(getHtml());
    });
    area.addEventListener('focus', () => { native('defaultParagraphSeparator', 'p'); native('styleWithCSS', false); });
    area.addEventListener('blur', () => { const r = window.getSelection(); if (r && r.rangeCount && inArea(r.getRangeAt(0).commonAncestorContainer)) saved = r.getRangeAt(0).cloneRange(); });

    // Scorciatoie dell'editor (quelle globali dell'app sono disattivate mentre si scrive, vedi DnD.ui.shortcutsBlocked).
    area.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && k === 'v') { plainNext = true; return; }
      if (ctrl && !e.altKey) {
        const fmt = { b: 'bold', i: 'italic', u: 'underline' }[k];
        if (fmt && !e.shiftKey) { e.preventDefault(); format(fmt); return; }
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      }
      if (e.key === 'Tab' && !ctrl && !e.altKey) {
        if (currentCell()) { e.preventDefault(); nextCell(e.shiftKey); return; }
        if (selectedItems().length) { e.preventDefault(); indent(e.shiftKey); }
      }
    });

    // ---------- Formati nativi (isolati in native) ----------
    function format(cmd) { command(() => { native(cmd); }); }
    function block(tag) { command(() => { ensureBlocks(); native('formatBlock', '<' + tag + '>'); }); }
    function hr() { command(() => { ensureBlocks(); native('insertHorizontalRule'); }); }
    function clearFormat() {
      command(() => {
        native('removeFormat');
        const r = range();
        if (!r) return;
        for (const s of [...area.querySelectorAll('span')]) if (r.intersectsNode(s)) unwrap(s);
        for (const b of selectedBlocks()) b.style.textAlign = '';
      });
    }

    // ---------- Barra degli strumenti ----------
    const btns = {};
    const iconBtn = (key, title, onclick, label) => {
      const b = el('button', { type: 'button', class: 'note-btn', title, 'aria-label': title, 'aria-pressed': 'false',
        onmousedown: (e) => e.preventDefault(), onclick }, label ? el('span', { class: 'note-btn-text', text: label }) : DnD.ui.svgIcon(ICONS[key], 18));
      btns[key] = b;
      return b;
    };
    const blockSel = el('select', { class: 'note-select', 'aria-label': 'Tipo di paragrafo', title: 'Tipo di paragrafo', onchange: (e) => block(e.target.value) },
      [['p', 'Paragrafo'], ['h1', 'Titolo 1'], ['h2', 'Titolo 2'], ['h3', 'Titolo 3'], ['blockquote', 'Citazione']].map(([v, t]) => el('option', { value: v, text: t })));
    const sizeSel = el('select', { class: 'note-select', 'aria-label': 'Grandezza del testo', title: 'Grandezza del testo',
      onchange: (e) => { if (e.target.value) command(() => applyStyle('font-size', e.target.value + 'px')); } },
    el('option', { value: '', text: 'px' }), N.FONT_SIZES.map((v) => el('option', { value: String(v), text: String(v) })));
    // Riquadri a comparsa (colori, griglia della tabella).
    let openPop = null;
    const closePop = () => { if (openPop) openPop.hidden = true; openPop = null; };
    function popover(anchorKey, content) {
      const pop = el('div', { class: 'note-pop', hidden: true, role: 'dialog' }, content);
      const wrap = el('span', { class: 'note-pop-wrap' }, btns[anchorKey], pop);
      btns[anchorKey].addEventListener('click', () => {
        const was = openPop === pop;
        closePop();
        if (!was) { pop.hidden = false; openPop = pop; }
      });
      return { wrap, pop };
    }
    document.addEventListener('pointerdown', (e) => { if (openPop && !openPop.parentNode.contains(e.target)) closePop(); }, true);
    const swatches = (list, onpick, defLabel) => el('div', { class: 'note-swatches' },
      list.map((c) => el('button', { type: 'button', class: 'note-swatch', style: 'background:' + c, title: c, 'aria-label': 'Colore ' + c,
        onmousedown: (e) => e.preventDefault(), onclick: () => { closePop(); onpick(c); } })),
      el('button', { type: 'button', class: 'btn small', text: defLabel, onmousedown: (e) => e.preventDefault(), onclick: () => { closePop(); onpick(null); } }));
    const colorInput = el('input', { type: 'color', value: '#d4453a', 'aria-label': 'Colore libero', onchange: (e) => { closePop(); command(() => applyStyle('color', e.target.value)); } });
    iconBtn('color', 'Colore del testo', () => {});
    const colorPop = popover('color', [swatches(N.COLORS, (c) => command(() => applyStyle('color', c)), 'Predefinito'), el('label', { class: 'inline small' }, 'Libero', colorInput)]);
    iconBtn('highlight', 'Evidenziatore', () => {});
    const hlPop = popover('highlight', [swatches(N.HIGHLIGHTS, (c) => command(() => applyStyle('background-color', c)), 'Nessuno')]);
    // Griglia di selezione della tabella (1–12 righe e colonne).
    const gridInfo = el('div', { class: 'muted small', text: 'Righe × colonne' });
    const tableGrid = el('div', { class: 'note-table-grid', role: 'grid', 'aria-label': 'Dimensione della tabella' });
    for (let rr = 1; rr <= 12; rr++) {
      for (let cc = 1; cc <= 12; cc++) {
        tableGrid.append(el('button', { type: 'button', class: 'note-grid-cell', 'data-r': rr, 'data-c': cc, 'aria-label': rr + ' righe per ' + cc + ' colonne',
          onmousedown: (e) => e.preventDefault(),
          onmouseenter: () => {
            gridInfo.textContent = rr + ' × ' + cc;
            for (const b of tableGrid.children) b.classList.toggle('on', Number(b.dataset.r) <= rr && Number(b.dataset.c) <= cc);
          },
          onclick: () => { closePop(); insertTable(rr, cc); } }));
      }
    }
    iconBtn('table', 'Inserisci tabella', () => {});
    const tablePop = popover('table', [gridInfo, tableGrid]);
    const tableBar = el('span', { class: 'note-group note-table-tools' },
      iconBtn('rowAbove', 'Aggiungi riga sopra', () => tableCommand('riga-sopra')),
      iconBtn('rowBelow', 'Aggiungi riga sotto', () => tableCommand('riga-sotto')),
      iconBtn('colLeft', 'Aggiungi colonna a sinistra', () => tableCommand('colonna-sinistra')),
      iconBtn('colRight', 'Aggiungi colonna a destra', () => tableCommand('colonna-destra')),
      iconBtn('header', 'Riga di intestazione', () => tableCommand('intestazione')),
      iconBtn('delRow', 'Elimina riga', () => tableCommand('elimina-riga')),
      iconBtn('delCol', 'Elimina colonna', () => tableCommand('elimina-colonna')),
      iconBtn('delTable', 'Elimina tabella', () => tableCommand('elimina-tabella')));
    const group = (...items) => el('span', { class: 'note-group' }, items);
    const toolbar = el('div', { class: 'note-toolbar', role: 'toolbar', 'aria-label': 'Formattazione' },
      group(iconBtn('undo', 'Annulla (Ctrl+Z)', () => undo()), iconBtn('redo', 'Ripeti (Ctrl+Y)', () => redo())),
      group(blockSel, sizeSel, iconBtn('smaller', 'Riduci il testo (A−)', () => stepSize(-1)), iconBtn('larger', 'Ingrandisci il testo (A+)', () => stepSize(1))),
      group(iconBtn('bold', 'Grassetto (Ctrl+B)', () => format('bold'), 'G'), iconBtn('italic', 'Corsivo (Ctrl+I)', () => format('italic'), 'C'),
        iconBtn('underline', 'Sottolineato (Ctrl+U)', () => format('underline'), 'S'), iconBtn('strike', 'Barrato', () => format('strikeThrough'), 'B')),
      group(colorPop.wrap, hlPop.wrap),
      group(iconBtn('ul', 'Elenco puntato', () => toggleList('ul')), iconBtn('ol', 'Elenco numerato', () => toggleList('ol')),
        iconBtn('outdent', 'Riduci rientro (Maiusc+Tab)', () => indent(true)), iconBtn('indent', 'Aumenta rientro (Tab)', () => indent(false))),
      group(iconBtn('left', 'Allinea a sinistra', () => align('left')), iconBtn('center', 'Centra', () => align('center')),
        iconBtn('right', 'Allinea a destra', () => align('right')), iconBtn('justify', 'Giustifica', () => align('justify'))),
      group(tablePop.wrap, iconBtn('hr', 'Linea orizzontale', () => hr()), iconBtn('clear', 'Cancella formattazione', () => clearFormat())),
      tableBar);
    btns.bold.classList.add('b');
    btns.italic.classList.add('i');
    btns.underline.classList.add('u');
    btns.strike.classList.add('s');
    for (const s of [blockSel, sizeSel, colorInput]) s.addEventListener('focus', () => { const r = window.getSelection(); if (r && r.rangeCount && inArea(r.getRangeAt(0).commonAncestorContainer)) saved = r.getRangeAt(0).cloneRange(); });

    // I pulsanti riflettono lo stato del cursore.
    function refreshState() {
      const r = range();
      if (!r) return;
      saved = r.cloneRange();
      const set = (key, on) => { if (btns[key]) { btns[key].setAttribute('aria-pressed', String(Boolean(on))); btns[key].classList.toggle('active', Boolean(on)); } };
      for (const [key, cmd] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough']]) set(key, native(cmd, null, true));
      const b = blockOf(r.startContainer);
      const list = b && b.nodeName === 'LI' ? b.parentNode.nodeName : '';
      set('ul', list === 'UL');
      set('ol', list === 'OL');
      const al = (b && b.style.textAlign) || 'left';
      for (const k of ['left', 'center', 'right', 'justify']) set(k, al === k);
      const tag = b ? b.nodeName.toLowerCase() : 'p';
      blockSel.value = ['h1', 'h2', 'h3', 'blockquote'].includes(tag) ? tag : 'p';
      const size = Math.round(currentSize());
      sizeSel.value = N.FONT_SIZES.includes(size) ? String(size) : '';
      const inTable = Boolean(currentCell());
      tableBar.hidden = !inTable;
      set('header', inTable && Boolean(currentCell().closest('table').tHead));
    }
    const onSelection = () => { if (area.isConnected) refreshState(); };
    document.addEventListener('selectionchange', onSelection);

    // ---------- API ----------
    function getHtml() { return N.sanitizeHtml(area.innerHTML.split(ZWSP).join('')); }
    function setHtml(h) {
      area.innerHTML = N.sanitizeHtml(h);
      ensureContent();
      lastHtml = html();
      past = [];
      future = [];
      saved = null;
    }
    setHtml(opts.html || '');
    const node = el('div', { class: 'note-editor' }, toolbar, area);
    tableBar.hidden = true;

    return {
      node, toolbar, area, getHtml, setHtml, undo, redo, refreshState,
      focus: () => { area.focus({ preventScroll: true }); restore(); },
      // Comandi (usati dalla barra e dai test).
      fontSize: (px) => command(() => applyStyle('font-size', px + 'px')),
      stepSize, color: (c) => command(() => applyStyle('color', c)), highlight: (c) => command(() => applyStyle('background-color', c)),
      toggleList, indent, align, insertTable, tableCommand, nextCell, format, block, hr, clearFormat, insertHtml: (h) => command(() => insertHtml(N.sanitizeHtml(h))),
      destroy: () => document.removeEventListener('selectionchange', onSelection),
    };
  }

  DnD.noteEditor = { create, native, ICONS };
})(globalThis.DnD = globalThis.DnD || {});
