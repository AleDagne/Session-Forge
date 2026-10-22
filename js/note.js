// Note del master (funzioni pure, nessun accesso al DOM): sanificazione dell'HTML con una whitelist di tag e
// di stili, testo semplice e conteggio delle parole, pagine di una sessione, limite di dimensione e
// salvataggio automatico con debounce. Le note appartengono a una sessione (sessione.pages).
(function (DnD) {
  'use strict';

  const TAGS = new Set(['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'blockquote']);
  const VOID = new Set(['br', 'hr']);
  // Tag scartati insieme al loro contenuto (script, stili, oggetti incorporati, immagini...).
  const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'title', 'head',
    'textarea', 'select', 'button', 'canvas', 'video', 'audio', 'picture', 'frameset', 'frame', 'applet', 'xml']);
  const STYLE_RULES = {
    color: (v) => /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i.test(v),
    'background-color': (v) => STYLE_RULES.color(v),
    'font-size': (v) => /^\d{1,3}(\.\d+)?(px|em|rem|%)$/.test(v),
    'text-align': (v) => /^(left|right|center|justify|start|end)$/.test(v),
    'font-weight': (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/.test(v),
    'font-style': (v) => /^(normal|italic|oblique)$/.test(v),
    'text-decoration': (v) => /^(none|underline|line-through|overline)( (underline|line-through|overline))*$/.test(v),
    width: (v) => /^\d{1,4}(\.\d+)?(px|%)$/.test(v),
  };
  const STYLES = Object.keys(STYLE_RULES);
  const MAX_BYTES = 500 * 1024;          // limite di una nota (con avviso)
  const MAX_PAGES = 100;
  const DEFAULT_PAGE = 'Appunti';
  const FONT_SIZES = [10, 12, 14, 16, 20, 24, 32, 48];
  // 12 colori leggibili sia sul tema chiaro sia sullo scuro.
  const COLORS = ['#d4453a', '#e0782f', '#c9a227', '#3fae63', '#2a9d8f', '#4f8fd6', '#7b6cd9', '#b55bc4', '#d65a8f', '#8a6a3a', '#8a8f9c', '#5f7a8a'];
  const HIGHLIGHTS = ['#fff3a3', '#c8f0c8', '#cfe3ff', '#ffd3d0', '#e9d7ff', '#ffe2bf'];

  // ---------- Sanificazione ----------
  const escapeText = (s) => s.replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Solo le proprietà ammesse, con valori sicuri (niente url(), expression, javascript:...).
  function sanitizeStyle(style) {
    const out = [];
    for (const decl of String(style || '').split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim().replace(/\s*!important$/i, '').replace(/\s+/g, ' ');
      if (!STYLE_RULES[prop] || /url\(|expression|javascript|\\|@/i.test(value)) continue;
      if (STYLE_RULES[prop](value) && !out.some((d) => d.startsWith(prop + ':'))) out.push(prop + ': ' + value);
    }
    return out.join('; ');
  }

  function attrValue(attrs, name) {
    const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i');
    const m = re.exec(attrs);
    return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
  }
  const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  // HTML -> HTML sicuro: solo i tag della whitelist (con il solo attributo style, filtrato), testo con le
  // entità corrette, tag non chiusi chiusi in fondo. Tutto il resto (script, gestori di eventi, link,
  // immagini, commenti) sparisce. Funziona anche senza DOM (test, importazione).
  function sanitizeHtml(html) {
    const src = String(html == null ? '' : html);
    let out = '';
    const stack = [];
    let i = 0;
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { out += escapeText(src.slice(i)); break; }
      out += escapeText(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        i = end < 0 ? src.length : end + 3;
        continue;
      }
      if (src[lt + 1] === '!' || src[lt + 1] === '?') {
        const end = src.indexOf('>', lt);
        i = end < 0 ? src.length : end + 1;
        continue;
      }
      tagRe.lastIndex = lt;
      const m = tagRe.exec(src);
      if (!m) { out += '&lt;'; i = lt + 1; continue; }
      i = tagRe.lastIndex;
      const name = m[1].toLowerCase();
      const closing = src[lt + 1] === '/';
      if (DROP.has(name)) {
        if (!closing && !/\/\s*$/.test(m[2])) {
          const end = src.toLowerCase().indexOf('</' + name, i);
          if (end < 0) { i = src.length; continue; }
          const close = src.indexOf('>', end);
          i = close < 0 ? src.length : close + 1;
        }
        continue;
      }
      if (!TAGS.has(name)) continue;
      if (closing) {
        const at = stack.lastIndexOf(name);
        if (at < 0) continue;
        while (stack.length > at) out += '</' + stack.pop() + '>';
        continue;
      }
      const style = sanitizeStyle(decodeEntities(attrValue(m[2], 'style') || ''));
      out += '<' + name + (style ? ' style="' + escapeAttr(style) + '"' : '') + '>';
      if (!VOID.has(name)) stack.push(name);
    }
    while (stack.length) out += '</' + stack.pop() + '>';
    return out;
  }

  // ---------- Testo semplice ----------
  // HTML (già sanificato) -> testo: a capo per blocchi, righe e celle separate da tabulazioni.
  function htmlToText(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<hr[^>]*>/gi, '\n———\n')
      .replace(/<\/(p|div|h1|h2|h3|li|tr|blockquote|ul|ol|table)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')
      .replace(/\t\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function wordCount(html) {
    const t = htmlToText(html).replace(/[•———]/g, ' ').trim();
    return t ? t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  }

  // Testo semplice -> HTML (paragrafi), per "incolla come testo semplice".
  function textToHtml(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n/).map((line) => '<p>' + (esc(line) || '<br>') + '</p>').join('');
  }

  // Dimensione in byte (UTF-8) di un testo.
  function byteSize(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }
  const tooLarge = (html) => byteSize(html) > MAX_BYTES;

  // ---------- Pagine ----------
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  function normalizePage(p) {
    p = p && typeof p === 'object' ? p : {};
    return {
      id: typeof p.id === 'string' && /^[\w-]{1,64}$/.test(p.id) ? p.id : DnD.dadi.uid(),
      name: str(p.name, 60).trim() || 'Pagina',
      // Il limite "duro" (2 MB) protegge l'archivio; l'avviso e il blocco del salvataggio sono a 500 KB.
      html: sanitizeHtml(str(p.html, 2 * 1024 * 1024)),
      updatedAt: typeof p.updatedAt === 'string' && !Number.isNaN(Date.parse(p.updatedAt)) ? p.updatedAt : null,
    };
  }
  function normalizePages(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).slice(0, MAX_PAGES).map(normalizePage).filter((p) => !seen.has(p.id) && seen.add(p.id));
  }

  function uniqueName(pages, base, exceptId) {
    const taken = (n) => pages.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase());
    let name = base.slice(0, 60);
    for (let i = 2; taken(name); i++) name = (base + ' (' + i + ')').slice(0, 60);
    return name;
  }
  // Le funzioni seguenti modificano l'elenco e restituiscono la pagina interessata.
  function addPage(pages, name, id) {
    if (pages.length >= MAX_PAGES) throw new Error('Al massimo ' + MAX_PAGES + ' pagine per sessione.');
    const p = { id, name: uniqueName(pages, name || DEFAULT_PAGE), html: '', updatedAt: null };
    pages.push(p);
    return p;
  }
  function renamePage(pages, id, name) {
    const p = pages.find((x) => x.id === id);
    if (!p) return null;
    p.name = uniqueName(pages, name.trim() || p.name, id);
    return p;
  }
  function duplicatePage(pages, id, newId) {
    const i = pages.findIndex((x) => x.id === id);
    if (i < 0) return null;
    if (pages.length >= MAX_PAGES) throw new Error('Al massimo ' + MAX_PAGES + ' pagine per sessione.');
    const copy = Object.assign({}, pages[i], { id: newId, name: uniqueName(pages, pages[i].name + ' (copia)') });
    pages.splice(i + 1, 0, copy);
    return copy;
  }
  function removePage(pages, id) {
    const i = pages.findIndex((x) => x.id === id);
    if (i < 0) return null;
    pages.splice(i, 1);
    return pages[Math.min(i, pages.length - 1)] || null;
  }
  function movePage(pages, id, dir) {
    const i = pages.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= pages.length) return false;
    const [p] = pages.splice(i, 1);
    pages.splice(j, 0, p);
    return true;
  }

  // ---------- Salvataggio automatico ----------
  // opts: { delay (ms, 500), save(valore) -> Promise<{ ok, message }>, onStatus(stato, messaggio),
  //         setTimer, clearTimer (iniettabili per i test) }. Stati: 'modificato', 'salvataggio', 'salvato', 'errore'.
  // change(valore) rimanda il salvataggio; flush() salva subito l'ultima modifica (chiusura del pannello,
  // cambio di pagina o di sessione). Un salvataggio non riuscito lascia la modifica in sospeso.
  function createAutosave(opts) {
    const delay = opts.delay === undefined ? 500 : opts.delay;
    const setT = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearT = opts.clearTimer || ((t) => clearTimeout(t));
    const status = opts.onStatus || (() => {});
    let timer = null;
    let pending = null;
    let hasPending = false;
    let running = Promise.resolve();
    function run() {
      timer = null;
      if (!hasPending) return running;
      const value = pending;
      hasPending = false;
      status('salvataggio', '');
      running = running.then(() => Promise.resolve(opts.save(value))).then((res) => {
        if (res && res.ok === false) {
          // Non salvato: resta da salvare (a meno che non sia già arrivata una modifica più recente).
          if (!hasPending) { pending = value; hasPending = true; }
          status('errore', res.message || 'salvataggio non riuscito');
        } else if (!hasPending) {
          status('salvato', '');
        }
        return res;
      }, (e) => {
        if (!hasPending) { pending = value; hasPending = true; }
        status('errore', (e && e.message) || 'salvataggio non riuscito');
      });
      return running;
    }
    return {
      change(value) {
        pending = value;
        hasPending = true;
        status('modificato', '');
        if (timer !== null) clearT(timer);
        timer = setT(run, delay);
      },
      flush() {
        if (timer !== null) { clearT(timer); timer = null; }
        return run();
      },
      pending: () => hasPending,
      cancel() { if (timer !== null) clearT(timer); timer = null; hasPending = false; },
    };
  }

  DnD.note = {
    TAGS, STYLES, MAX_BYTES, MAX_PAGES, DEFAULT_PAGE, FONT_SIZES, COLORS, HIGHLIGHTS,
    sanitizeHtml, sanitizeStyle, htmlToText, wordCount, textToHtml, byteSize, tooLarge, escapeText,
    normalizePage, normalizePages, uniqueName, addPage, renamePage, duplicatePage, removePage, movePage, createAutosave,
  };
})(globalThis.DnD = globalThis.DnD || {});
