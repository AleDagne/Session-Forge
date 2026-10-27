// Accesso di base al modello dei dati (funzioni pure sullo stato normalizzato): sessione corrente e visibilità delle
// entità nelle sessioni (della sessione o condivise). Sta sotto tutti i moduli che leggono lo stato, così nessuno
// deve dipendere da sessioni.js (che a sua volta usa i moduli del Mondo) solo per sapere qual è la sessione corrente.
// Contiene anche la versione del modello, i registri del combattimento e dei dadi e il punto d'accesso alla
// normalizzazione delle creature (registrata da dati.js), usato dai moduli di regole con creature annidate.
// Livello stato (base). Espone DnD.modello; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  // Versione del modello dei dati (vedi le migrazioni in dati.js e il README, «Modello dati»).
  const VERSION = 18;
  const DICE_HISTORY_MAX = 20;
  const LOG_MAX = 500;

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

  /** Aggiunge un tiro in cima alla cronologia dei dadi (massimo DICE_HISTORY_MAX). */
  /**
   * Nemici, giocatori, griglie… visibili nella sessione indicata (di default quella corrente).
   * @param {object} state  @param {string} key collezione dello stato  @param {string} [sessionId]
   * @returns {object[]}
   */
  function visible(state, key, sessionId) {
    const sid = sessionId || current(state).id;
    return state[key].filter((x) => isVisible(x, sid));
  }

  /** Il file è l'esportazione di una singola sessione? */
  function isSessionFile(raw) {
    return Boolean(raw && typeof raw === 'object' && raw.kind === 'sessione');
  }

  // Stato corrente dell'app, per i valori predefiniti delle regole (talenti, catalogo, TileSet) quando chi chiama
  // non li passa. La sorgente la registra lo stato (stato/archivio.js); senza, null.
  let fonteStato = () => null;
  /** @param {() => object|null} fn */
  const registraFonteStato = (fn) => { fonteStato = fn; };
  const statoCorrente = () => fonteStato();

  function pushDiceHistory(state, entry) {
    state.diceHistory.unshift(entry);
    state.diceHistory.length = Math.min(state.diceHistory.length, DICE_HISTORY_MAX);
  }

  /** Aggiunge una riga al registro del combattimento { round, type, text } (massimo LOG_MAX righe). */
  function pushLog(combat, type, text) {
    combat.log.push({ round: combat.round, type, text });
    if (combat.log.length > LOG_MAX) combat.log.splice(0, combat.log.length - LOG_MAX);
  }

  // Normalizzazione di una creatura (nemico o giocatore): l'implementazione è in dati.js, che sta sopra le regole;
  // leggendario (forme), npc (scheda riusata) e scheda (import) la chiedono qui senza dipendere dallo stato.
  let normalizzatore = null;
  /** @param {(c: object, isPlayer: boolean) => object} fn */
  const registraNormalizzaCreatura = (fn) => { normalizzatore = fn; };
  /**
   * @param {object} c creatura grezza  @param {boolean} isPlayer
   * @returns {object} creatura normalizzata
   */
  function normalizzaCreatura(c, isPlayer) {
    if (!normalizzatore) throw new Error('normalizzazione delle creature non registrata (dati.js non caricato)');
    return normalizzatore(c, isPlayer);
  }

  DnD.modello = { VERSION, LOG_MAX, DICE_HISTORY_MAX, current, isVisible, visible, isSessionFile, pushDiceHistory, pushLog, registraNormalizzaCreatura, normalizzaCreatura, registraFonteStato, statoCorrente };
})(globalThis.DnD = globalThis.DnD || {});
