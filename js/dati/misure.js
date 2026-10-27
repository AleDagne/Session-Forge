// Misure della griglia (regola 5e): una casella è un quadrato di 5 piedi, cioè 1,5 metri; le librerie dell'app
// scrivono distanze e velocità in metri, il movimento del combattimento lavora in piedi.
// Livello dati. Espone DnD.misure; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const METRI_PER_CASELLA = 1.5;
  const PIEDI_PER_CASELLA = 5;
  // Conversione arrotondata usata dall'app (5 ft = 1,5 m), non quella esatta di 0,3048 m per piede.
  const METRI_PER_PIEDE = METRI_PER_CASELLA / PIEDI_PER_CASELLA;
  // Tolleranza per gli errori di virgola mobile (es. 4,5 / 1,5 = 2,9999…).
  const EPSILON = 1e-9;

  // Scala delle mappe di esplorazione (1 cella = valore + unità): chilometri per unità; piedi in un chilometro
  // (conversione esatta, usata per i raggi di vista sulle mappe in scala).
  const KM_PER_UNITA = { ft: 0.0003048, m: 0.001, km: 1, mi: 1.609344 };
  const PIEDI_PER_KM = 3280.84;

  /**
   * Chilometri coperti da una cella di una mappa in scala.
   * @param {{value: number, unit: 'ft'|'m'|'km'|'mi'}} scala
   * @returns {number}
   */
  const kmDaScala = (scala) => scala.value * KM_PER_UNITA[scala.unit];

  /**
   * Caselle intere coperte da una distanza in metri (per difetto).
   * @param {number} metri
   * @returns {number}
   */
  const celleDaMetri = (metri) => Math.floor(metri / METRI_PER_CASELLA + EPSILON);

  DnD.misure = { METRI_PER_CASELLA, PIEDI_PER_CASELLA, METRI_PER_PIEDE, EPSILON, KM_PER_UNITA, PIEDI_PER_KM, celleDaMetri, kmDaScala };
})(globalThis.DnD = globalThis.DnD || {});
