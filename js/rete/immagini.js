// Immagini del gioco online (sfondo, tile, icone): mandate una volta sola, a pezzi di circa 16 KB, identificate
// dall'impronta del contenuto (DnD.immaginiLib.imageId) e conservate nell'archivio delle immagini del giocatore
// (IndexedDB). Qui le parti pure: divisione in pezzi e ricomposizione con i controlli di dimensione e impronta.
(function (DnD) {
  'use strict';

  const P = () => DnD.rete.protocollo;

  // Data URL -> pezzi { id, i, n, parte }. Lancia un errore se l'immagine supera il limite.
  function pezzi(id, data, dim) {
    const size = dim || P().LIMITI.pezzo;
    if (typeof data !== 'string' || !data) throw new Error('immagine vuota');
    if (data.length > P().LIMITI.immagine) throw new Error('immagine troppo grande (' + Math.round(data.length / 1048576) + ' MB, massimo ' + P().LIMITI.immagine / 1048576 + ' MB)');
    const n = Math.ceil(data.length / size);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ id, i, n, parte: data.slice(i * size, (i + 1) * size) });
    return out;
  }

  // Ricompone le immagini in arrivo. aggiungi(pezzo) -> null | { id, data } (completa e verificata); lancia un
  // errore se l'immagine è incoerente, troppo grande o non corrisponde alla sua impronta.
  function ricevitore() {
    const aperte = new Map();
    return {
      aggiungi(p) {
        let a = aperte.get(p.id);
        if (!a) {
          if (aperte.size >= 16) throw new Error('troppe immagini in arrivo insieme');
          a = { n: p.n, parti: new Array(p.n), ricevuti: 0, lunghezza: 0 };
          aperte.set(p.id, a);
        }
        if (a.n !== p.n) { aperte.delete(p.id); throw new Error('pezzi incoerenti'); }
        if (a.parti[p.i] === undefined) {
          a.parti[p.i] = p.parte;
          a.ricevuti++;
          a.lunghezza += p.parte.length;
          if (a.lunghezza > P().LIMITI.immagine) { aperte.delete(p.id); throw new Error('immagine troppo grande'); }
        }
        if (a.ricevuti < a.n) return null;
        aperte.delete(p.id);
        const data = a.parti.join('');
        const lib = DnD.immaginiLib;
        if (!lib.isStoredImageUrl(data) || lib.imageId(data) !== p.id) throw new Error('immagine danneggiata (impronta diversa)');
        return { id: p.id, data };
      },
      // Avanzamento: { ricevuti, totali } dei pezzi delle immagini aperte.
      avanzamento() {
        let r = 0;
        let t = 0;
        for (const a of aperte.values()) { r += a.ricevuti; t += a.n; }
        return { ricevuti: r, totali: t };
      },
      annulla: (id) => aperte.delete(id),
    };
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.immagini = { pezzi, ricevitore };
})(globalThis.DnD = globalThis.DnD || {});
