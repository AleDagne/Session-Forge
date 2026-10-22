// IA dei nemici (dati): pesi dei punteggi di debolezza e di minaccia, classi bersaglio predefinite per SAG,
// classi incantatrici, temperamenti, archetipi e costanti del pianificatore. Modificabili qui.
(function (DnD) {
  'use strict';

  const TEMPERAMENTS = ['aggressivo', 'furbo'];
  const TEMPERAMENT_NAMES = { aggressivo: 'Aggressivo', furbo: 'Furbo' };
  const ARCHETYPES = ['FOR', 'DES', 'COS', 'INT', 'SAG', 'CAR'];
  const ARCHETYPE_NAMES = {
    FOR: 'attaccante', DES: 'tiratore', COS: 'scudo', INT: 'stratega', SAG: 'cacciatore di incantatori', CAR: 'supporto',
  };
  const CONTROLS = ['manuale', 'ia'];
  const FACTIONS = ['giocatori', 'nemici', 'neutrali'];
  const FACTION_NAMES = { giocatori: 'Giocatori', nemici: 'Nemici', neutrali: 'Neutrali/Alleati' };
  const MODES = ['passo', 'auto', 'manuale'];
  const MODE_NAMES = { passo: 'Passo a passo', auto: 'Automatica', manuale: 'Manuale (solo suggerimento)' };

  // Punteggio di debolezza: somma pesata di termini tra 0 e 1.
  const WEAKNESS = {
    hp: 3,          // PF attuali bassi (1 = 0 PF, 0 = HP_SCALE o più)
    ac: 1.5,        // CA bassa (1 = CA 10 o meno, 0 = CA 20 o più)
    caster: 1,      // classe incantatrice o creatura con incantesimi
    isolated: 1,    // nessun alleato entro 2 caselle
    vulnerable: 2,  // vulnerabile al danno dell'arma usata
  };
  const HP_SCALE = 40;
  // Punteggio di minaccia: danno medio per round + livello (o GS) + PF massimi.
  const THREAT = { dpr: 1, level: 2, hp: 0.1 };
  const HIT_CHANCE = 0.65;   // probabilità di colpire usata per stimare la minaccia

  const SAG_TARGETS = ['mago', 'chierico', 'stregone'];
  const CASTER_CLASSES = ['bardo', 'chierico', 'druido', 'mago', 'stregone', 'warlock', 'paladino', 'ranger'];

  const PLANNER = {
    timeLimit: 300,         // ms massimi di calcolo, poi ripiego "avvicinati e attacca il più vicino"
    maxNodes: 40000,        // nodi massimi esplorati dal percorso
    areaRadius: 2,          // raggio (celle) degli incantesimi e delle azioni ad area
    slotWorth: 1.5,         // uno slot si usa se il danno atteso supera di tanto quello gratuito
    supportAt: 0.5,         // si cura chi è sotto il 50% dei PF
    dodgeAt: 0.5,           // lo scudo usa Schivare sotto il 50% dei PF
  };

  DnD.iaDati = {
    TEMPERAMENTS, TEMPERAMENT_NAMES, ARCHETYPES, ARCHETYPE_NAMES, CONTROLS, FACTIONS, FACTION_NAMES, MODES, MODE_NAMES,
    WEAKNESS, HP_SCALE, THREAT, HIT_CHANCE, SAG_TARGETS, CASTER_CLASSES, PLANNER,
  };
})(globalThis.DnD = globalThis.DnD || {});
