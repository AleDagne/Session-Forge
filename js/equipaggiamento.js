// Equipaggiamento predefinito per classe, usato dal generatore di nemici. Modificabile liberamente.
// Arma: nome, dado di danno, caratteristica (FOR, oppure DES per armi accurate e a distanza), tipo di danno.
// diceByLevel: dado che cresce con il livello ([livello minimo, dado], in ordine crescente).
// Armatura: tipo ('nessuna' | 'leggera' | 'media' | 'pesante'), CA base e nome; shield = scudo (+2).
(function (DnD) {
  'use strict';

  const weapon = (name, dice, ability, damageType, extra) => Object.assign({ name, dice, ability, damageType }, extra);
  const armor = (type, base, name) => ({ type, base, name });
  const NONE = armor('nessuna', 10, 'Nessuna');

  const EQUIPMENT = {
    barbaro: { weapons: [weapon('Ascia bipenne', '1d12', 'FOR', 'tagliente')], armor: NONE, shield: false },
    bardo: { weapons: [weapon('Stocco', '1d8', 'DES', 'perforante')], armor: armor('leggera', 11, 'Armatura di cuoio'), shield: false },
    chierico: { weapons: [weapon('Mazza', '1d6', 'FOR', 'contundente')], armor: armor('media', 14, 'Armatura a scaglie'), shield: true },
    druido: { weapons: [weapon('Scimitarra', '1d6', 'DES', 'tagliente')], armor: armor('media', 12, 'Armatura di pelle'), shield: true },
    guerriero: { weapons: [weapon('Spada lunga', '1d8', 'FOR', 'tagliente')], armor: armor('pesante', 16, 'Cotta di maglia'), shield: true },
    ladro: {
      weapons: [weapon('Stocco', '1d8', 'DES', 'perforante'), weapon('Arco corto', '1d6', 'DES', 'perforante')],
      armor: armor('leggera', 12, 'Cuoio borchiato'), shield: false,
    },
    mago: { weapons: [weapon('Bastone', '1d6', 'FOR', 'contundente')], armor: NONE, shield: false },
    monaco: {
      weapons: [weapon('Colpo senz\'armi', '1d4', 'DES', 'contundente', { diceByLevel: [[1, '1d4'], [5, '1d6'], [11, '1d8'], [17, '1d10']] })],
      armor: NONE, shield: false,
    },
    paladino: { weapons: [weapon('Spada lunga', '1d8', 'FOR', 'tagliente')], armor: armor('pesante', 16, 'Cotta di maglia'), shield: true },
    ranger: {
      weapons: [weapon('Arco lungo', '1d8', 'DES', 'perforante'), weapon('Spada corta', '1d6', 'DES', 'perforante')],
      armor: armor('media', 13, 'Giaco di maglia'), shield: false,
    },
    stregone: { weapons: [weapon('Pugnale', '1d4', 'DES', 'perforante')], armor: NONE, shield: false },
    warlock: { weapons: [weapon('Bastone', '1d6', 'FOR', 'contundente')], armor: armor('leggera', 11, 'Armatura di cuoio'), shield: false },
    personalizzata: { weapons: [weapon('Arma', '1d8', 'FOR', '')], armor: NONE, shield: false },
  };

  // Dado effettivo dell'arma al livello indicato.
  function weaponDice(w, level) {
    if (!w.diceByLevel) return w.dice;
    let dice = w.dice;
    for (const [min, d] of w.diceByLevel) if (level >= min) dice = d;
    return dice;
  }

  // Equipaggiamento magico: +1 dal livello 5, +2 dall'11, +3 dal 17.
  function magicBonus(level) {
    return level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0;
  }

  DnD.equipaggiamento = { EQUIPMENT, weaponDice, magicBonus };
})(globalThis.DnD = globalThis.DnD || {});
