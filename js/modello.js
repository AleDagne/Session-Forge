// Accesso di base al modello dei dati (funzioni pure sullo stato normalizzato): sessione corrente e visibilità delle
// entità nelle sessioni (della sessione o condivise). Sta sotto tutti i moduli che leggono lo stato, così nessuno
// deve dipendere da sessioni.js (che a sua volta usa i moduli del Mondo) solo per sapere qual è la sessione corrente.
// Livello stato (base). Espone DnD.modello; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  /**
   * Sessione corrente (o la prima, se l'id salvato non c'è più).
   * @param {{sessions: object[], currentSessionId: string}} state
   * @returns {object}
   */
  function current(state) {
    return state.sessions.find((s) => s.id === state.currentSessionId) || state.sessions[0];
  }

  /**
   * Un'entità è visibile in una sessione se le appartiene o è condivisa con tutte.
   * @param {{shared?: boolean, sessionId?: string}} entity
   * @param {string} sessionId
   * @returns {boolean}
   */
  function isVisible(entity, sessionId) {
    return entity.shared || entity.sessionId === sessionId;
  }

  DnD.modello = { current, isVisible };
})(globalThis.DnD = globalThis.DnD || {});
