// Comportamento dei nemici per l'IA (temperamento, archetipo, gittata preferita, fuga, casualità, bersagli per SAG),
// controllo e fazione di partenza di un combattente. Sta sotto creature.js e ia.js, che lo usano entrambi.
// Livello regole. Espone DnD.iaComportamento { normalizeBehavior, defaultControl, defaultFaction }; usa dati/ia e regole.
// Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const K = () => DnD.iaDati;
  const AB = DnD.regole.ABILITIES;

  function normalizeBehavior(b) {
    b = b && typeof b === 'object' ? b : {};
    const int = (v, def, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
    return {
      temperament: K().TEMPERAMENTS.includes(b.temperament) ? b.temperament : 'aggressivo',
      archetype: AB.includes(b.archetype) ? b.archetype : 'auto',
      preferredRange: b.preferredRange === null || b.preferredRange === undefined || b.preferredRange === '' ? null : int(b.preferredRange, null, 1, 100),
      fleeAt: int(b.fleeAt, 0, 0, 90),
      randomness: int(b.randomness, 0, 0, 30),
      sagTargets: Array.isArray(b.sagTargets) ? [...new Set(b.sagTargets.filter((x) => typeof x === 'string' && x.length <= 40))].slice(0, 20) : K().SAG_TARGETS.slice(),
    };
  }
  const defaultControl = (kind) => (kind === 'player' ? 'manuale' : 'ia');
  const defaultFaction = (kind) => (kind === 'player' ? 'giocatori' : 'nemici');

  DnD.iaComportamento = { normalizeBehavior, defaultControl, defaultFaction };
})(globalThis.DnD = globalThis.DnD || {});
