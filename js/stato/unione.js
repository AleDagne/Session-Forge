// Importazione di un archivio unendolo a quello del profilo: anteprima di cosa si aggiunge, cosa è identico e cosa è
// in conflitto (stesso id, contenuto diverso), poi l'unione con una scelta per ogni conflitto (tieni, sostituisci,
// duplica). Una sessione duplicata si copia con tutti i suoi elementi e id nuovi (sessioni.importSession, che rimappa
// i riferimenti). Livello stato, funzioni pure su stati già normalizzati (dati.importJSON): non tocca DOM né disco.
// Espone DnD.unione; usa DnD.sessioni e DnD.dati.
(function (DnD) {
  'use strict';

  // Raccolte con id, nell'ordine dell'anteprima; nomi in italiano per l'interfaccia.
  const RACCOLTE = [
    ['sessions', 'Sessioni'], ['players', 'Giocatori'], ['npcs', 'Nemici'], ['savedGrids', 'Griglie'], ['scenes', 'Scene'], ['encounters', 'Incontri'],
    ['factions', 'Fazioni'], ['parties', 'Party'], ['cities', 'Città'], ['worldNpcs', 'NPC del Mondo'], ['quests', 'Quest'],
    ['backgrounds', 'Background'], ['feats', 'Talenti'], ['races', 'Razze'], ['spells', 'Incantesimi'], ['structures', 'Strutture'],
    ['equipment', 'Attrezzatura'], ['mapObjects', 'Oggetti di mappa'], ['tilesets', 'TileSet'], ['biomes', 'Biomi'], ['events', 'Eventi'],
    ['pathTemplates', 'Percorsi'], ['customConditions', 'Condizioni personalizzate'],
  ];
  const SCELTE = ['tieni', 'sostituisci', 'duplica'];
  const NOMI_SCELTE = { tieni: 'Tieni il mio', sostituisci: 'Sostituisci', duplica: 'Duplica' };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const nomeDi = (x) => String((x && (x.name || x.nome || x.title)) || (x && x.id) || '?').slice(0, 80);
  const chiave = (col, id) => col + ':' + id;

  /**
   * Cosa succede importando `importato` in `stato`.
   * @returns {{aggiunti: object[], conflitti: object[], identici: number, perTipo: object}} elementi { col, tipo, id, nome, nomeAttuale }
   */
  function anteprima(stato, importato) {
    const out = { aggiunti: [], conflitti: [], identici: 0, perTipo: {} };
    for (const [col, tipo] of RACCOLTE) {
      const mie = new Map((stato[col] || []).map((x) => [x.id, x]));
      const t = { tipo, aggiunti: 0, conflitti: 0, identici: 0 };
      for (const x of importato[col] || []) {
        const mio = mie.get(x.id);
        if (!mio) { out.aggiunti.push({ col, tipo, id: x.id, nome: nomeDi(x) }); t.aggiunti++; }
        else if (JSON.stringify(mio) === JSON.stringify(x)) { out.identici++; t.identici++; }
        else { out.conflitti.push({ col, tipo, id: x.id, nome: nomeDi(x), nomeAttuale: nomeDi(mio) }); t.conflitti++; }
      }
      if (t.aggiunti || t.conflitti || t.identici) out.perTipo[col] = t;
    }
    return out;
  }

  /**
   * Unisce `importato` a `stato` (nessuno dei due viene modificato) e restituisce lo stato nuovo, normalizzato.
   * @param {object} scelte { 'col:id': 'tieni' | 'sostituisci' | 'duplica' } per i conflitti (di base 'tieni')
   * @param {() => string} uid generatore di id nuovi
   */
  function unisci(stato, importato, scelte, uid) {
    const s = scelte || {};
    const scelta = (col, id) => (SCELTE.includes(s[chiave(col, id)]) ? s[chiave(col, id)] : 'tieni');
    let out = clone(stato);
    // Sessioni in conflitto da duplicare: copia completa con id nuovi; i loro elementi non si uniscono uno per uno.
    const copiate = new Set();
    for (const sess of importato.sessions || []) {
      const mia = out.sessions.find((x) => x.id === sess.id);
      if (!mia || JSON.stringify(mia) === JSON.stringify(sess) || scelta('sessions', sess.id) !== 'duplica') continue;
      const dati = DnD.sessioni.exportSession(importato, sess.id, {});
      DnD.sessioni.importSession(out, dati, uid);
      copiate.add(sess.id);
    }
    for (const [col] of RACCOLTE) {
      if (!Array.isArray(out[col])) out[col] = [];
      for (const x of importato[col] || []) {
        if (col === 'sessions' && copiate.has(x.id)) continue;
        if (col !== 'sessions' && copiate.has(x.sessionId) && !x.shared) continue;
        const i = out[col].findIndex((e) => e.id === x.id);
        if (i < 0) { out[col].push(clone(x)); continue; }
        if (JSON.stringify(out[col][i]) === JSON.stringify(x)) continue;
        const sc = scelta(col, x.id);
        if (sc === 'sostituisci') out[col][i] = clone(x);
        else if (sc === 'duplica') {
          const copia = Object.assign(clone(x), { id: uid() });
          if (typeof copia.name === 'string') copia.name = (copia.name + ' (importato)').slice(0, 120);
          out[col].push(copia);
        }
      }
    }
    out = DnD.dati.normalizeState(out);
    return out;
  }

  /** Scelte per tutti i conflitti con lo stesso valore. */
  const tutte = (conflitti, valore) => Object.fromEntries(conflitti.map((c) => [chiave(c.col, c.id), valore]));

  DnD.unione = { RACCOLTE, SCELTE, NOMI_SCELTE, anteprima, unisci, tutte, chiave };
})(globalThis.DnD = globalThis.DnD || {});
