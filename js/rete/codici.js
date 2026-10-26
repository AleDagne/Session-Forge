// Codici di invito e di risposta della segnalazione manuale: oggetto JSON compresso (CompressionStream
// «deflate-raw» se il browser lo offre, altrimenti senza compressione) e codificato in base64url con un prefisso
// «SF1z.» (compresso) o «SF1p.» (semplice). Validi pochi minuti e una sola volta (registro).
(function (DnD) {
  'use strict';

  const PREFISSO = 'SF1';
  const DURATA = 5 * 60 * 1000;
  const MAX_CODICE = 64 * 1024;
  const P = () => DnD.rete.protocollo;

  const comprimibile = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  function aBase64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function daBase64url(testo) {
    const b = atob(testo.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  async function attraverso(bytes, flusso) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(flusso)).arrayBuffer());
  }

  // Oggetto -> codice. opts: { comprimi } (false per i browser che non sanno decomprimere).
  async function codifica(dati, opts) {
    const bytes = new TextEncoder().encode(JSON.stringify(dati));
    const z = (!opts || opts.comprimi !== false) && comprimibile();
    return PREFISSO + (z ? 'z' : 'p') + '.' + aBase64url(z ? await attraverso(bytes, new CompressionStream('deflate-raw')) : bytes);
  }

  // Codice -> oggetto, o un errore in italiano.
  async function decodifica(codice) {
    const c = typeof codice === 'string' ? codice.replace(/\s+/g, '') : '';
    if (!c) throw new Error('Il codice è vuoto: incollalo per intero.');
    if (c.length > MAX_CODICE) throw new Error('Il codice è troppo lungo: non sembra un codice di questa app.');
    const m = /^SF(\d+)([zp])\.([A-Za-z0-9_-]+)$/.exec(c);
    if (!m) throw new Error('Codice non valido: controlla di averlo copiato per intero (inizia con «' + PREFISSO + '»).');
    if ('SF' + m[1] !== PREFISSO) throw new Error('Codice di un\'altra versione dell\'app: aggiornate entrambi la pagina.');
    let testo;
    try {
      let bytes = daBase64url(m[3]);
      if (m[2] === 'z') {
        if (!comprimibile()) throw new Error('compressione');
        bytes = await attraverso(bytes, new DecompressionStream('deflate-raw'));
      }
      testo = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      if (e.message === 'compressione') throw new Error('Questo browser non sa leggere i codici compressi: chi ti ha mandato il codice spunti «Codici senza compressione» e ne crei uno nuovo.');
      throw new Error('Codice danneggiato: copialo di nuovo per intero.');
    }
    let dati;
    try { dati = JSON.parse(testo); } catch (e) { throw new Error('Codice danneggiato: copialo di nuovo per intero.'); }
    if (!dati || typeof dati !== 'object' || typeof dati.sdp !== 'string' || !['invito', 'risposta'].includes(dati.tipo)) throw new Error('Codice non valido.');
    return dati;
  }

  // Contenuti dei codici. ora: Date.now() (iniettabile nei test).
  const crea = (tipo, campi, ora) => Object.assign({ tipo, versione: P().VERSIONE, id: DnD.dadi.uid(), scade: ora + DURATA }, campi);
  const invito = (sdp, nomeMaster, ora) => crea('invito', { sdp, master: P().pulisciTesto(nomeMaster, 30) }, ora);
  const risposta = (sdp, invitoId, ora) => crea('risposta', { sdp, invito: invitoId }, ora);

  // Controlli comuni: tipo atteso, versione, scadenza. Lancia un errore in italiano.
  function verifica(dati, tipo, ora) {
    if (dati.tipo !== tipo) throw new Error(tipo === 'invito' ? 'Questo è un codice di risposta: in «Unisciti» va il codice di invito del master.' : 'Questo è un codice di invito: al master serve il codice di risposta del giocatore.');
    if (dati.versione !== P().VERSIONE) throw new Error('Versione incompatibile: il codice viene da un\'altra versione dell\'app (' + dati.versione + ', questa ' + P().VERSIONE + '). Aggiornate entrambi la pagina.');
    if (!Number.isFinite(dati.scade) || ora > dati.scade) throw new Error('Codice scaduto: i codici valgono ' + DURATA / 60000 + ' minuti. Createne uno nuovo.');
  }

  // Registro dei codici già usati (uso singolo): usa(id) lancia un errore la seconda volta.
  function registro() {
    const usati = new Set();
    return {
      usa(id) {
        if (usati.has(id)) throw new Error('Codice già usato: ogni codice vale una volta sola. Createne uno nuovo.');
        usati.add(id);
      },
      usato: (id) => usati.has(id),
    };
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.codici = { PREFISSO, DURATA, comprimibile, codifica, decodifica, invito, risposta, verifica, registro };
})(globalThis.DnD = globalThis.DnD || {});
