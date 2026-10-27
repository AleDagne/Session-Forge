// Dati d'esempio dello stato nuovo (razze, strutture, incantesimi, oggetti di mappa, creature, Mondo) e party
// predefiniti. Livello stato. Espone DnD.esempi; usa DnD.normalizza e i moduli con gli esempi (mondo, fazioni…).
// Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const { id, makeBonuses, normalizeCreature, normalizeMapObject, normalizeRace, normalizeSpell, normalizeStructure } = DnD.normalizza;

  function defaultRaces() {
    const race = (name, size, speed, darkvision, bonuses, description, traits, languages, extra) =>
      normalizeRace(Object.assign({
        id: DnD.dadi.uid(), name, size, speed, darkvision, bonuses: makeBonuses(bonuses),
        description, traits, languages,
      }, extra));
    return [
      race('Umano', 'Media', 9, null, { FOR: 1, DES: 1, COS: 1, INT: 1, SAG: 1, CAR: 1 },
        'Versatili e ambiziosi, gli umani sono la razza più diffusa.',
        'Nessun tratto speciale oltre ai bonus a tutte le caratteristiche.',
        'Comune, un linguaggio a scelta'),
      race('Elfo', 'Media', 9, 18, { DES: 2 },
        'Popolo magico e longevo, aggraziato e attento.',
        'Sensi acuti, Retaggio fatato (vantaggio contro charme, immune al sonno magico), Trance.',
        'Comune, Elfico', { proficiencies: 'Percezione' }),
      race('Nano', 'Media', 7.5, 18, { COS: 2 },
        'Robusti e tenaci, maestri della pietra e del metallo.',
        'Resilienza nanica (vantaggio ai TS contro veleno), Esperto della pietra. La velocità non è ridotta dall\'armatura pesante.',
        'Comune, Nanico', { resistances: 'Veleno', proficiencies: 'Asce da battaglia, asce, martelli leggeri, martelli da guerra' }),
      race('Halfling', 'Piccola', 7.5, null, { DES: 2 },
        'Piccoli, allegri e sorprendentemente coraggiosi.',
        'Fortunato (ritira gli 1 naturali), Coraggioso, Agilità halfling.',
        'Comune, Halfling'),
      race('Orco', 'Media', 9, 18, { FOR: 2, COS: 1 },
        'Guerrieri feroci e resistenti, temuti in battaglia.',
        'Aggressivo (azione bonus per muoversi verso un nemico), Minaccioso.',
        'Comune, Orchesco', { proficiencies: 'Intimidire' }),
    ];
  }

  function defaultStructures() {
    const s = (name, color, preset, w, h) => normalizeStructure({ id: DnD.dadi.uid(), name, color, mode: 'preset', preset, w, h });
    return [
      s('Muro', '#7d7f86', 'rettangolo', 3, 1),
      s('Colonna', '#b9b4a8', 'cerchio', 1, 1),
      s('Albero', '#2f7d3b', 'cerchio', 2, 2),
      s('Tavolo', '#8a5a33', 'rettangolo', 2, 1),
    ].concat(visionStructures());
  }
  // Esempi della visione (v18): bloccano il passaggio ma non la vista.
  function visionStructures() {
    const s = (id, name, color, w, h) => normalizeStructure({ id, name, color, mode: 'preset', preset: 'rettangolo', w, h, blocksSight: false });
    return [s('st-finestra', 'Finestra', '#9fc4d8', 1, 1), s('st-grata', 'Grata', '#5b6270', 3, 1)];
  }

  // Incantesimi di esempio (descrizioni brevi, modificabili o eliminabili).
  function defaultSpells() {
    const sp = (name, level, school, castingTime, range, components, duration, classes, description, effect, extra) =>
      normalizeSpell(Object.assign({ id: DnD.dadi.uid(), name, level, school, castingTime, range, components, duration, classes, description, effect }, extra));
    return [
      sp('Dardo di fuoco', 0, 'invocazione', '1 azione', '36 m', { V: true, S: true }, 'Istantanea', ['mago', 'stregone'],
        'Scagli una scintilla di fuoco contro una creatura o un oggetto. Se colpisce, il bersaglio subisce danni da fuoco; gli oggetti infiammabili prendono fuoco.',
        { type: 'attacco', dice: '1d10', damageType: 'fuoco' }),
      sp('Dardo incantato', 1, 'invocazione', '1 azione', '36 m', { V: true, S: true }, 'Istantanea', ['mago', 'stregone'],
        'Tre dardi di energia luminosa colpiscono senza fallire, ognuno per 1d4+1 danni da forza. Ogni slot superiore aggiunge un dardo.',
        { type: 'nessuno', dice: '3d4+3', damageType: 'forza', upcastDice: '1d4+1' }),
      sp('Palla di fuoco', 3, 'invocazione', '1 azione', '45 m', { V: true, S: true, M: true, material: 'una pallina di guano di pipistrello e zolfo' },
        'Istantanea', ['mago', 'stregone'],
        "Una sfera di fiamme esplode in un raggio di 6 metri. Chi è nell'area tira su Destrezza: metà danni se riesce.",
        { type: 'salvezza', dice: '8d6', damageType: 'fuoco', upcastDice: '1d6', saveAbility: 'DES', halfOnSave: true }, { area: true }),
      sp('Cura ferite', 1, 'invocazione', '1 azione', 'Contatto', { V: true, S: true }, 'Istantanea', ['bardo', 'chierico', 'druido', 'paladino', 'ranger'],
        'Tocchi una creatura e le restituisci punti ferita pari a 1d8 + il tuo modificatore da incantatore. Non ha effetto su non morti e costrutti.',
        { type: 'cura', dice: '1d8', upcastDice: '1d8', addMod: true }),
      sp('Parola di guarigione', 1, 'invocazione', '1 azione bonus', '18 m', { V: true }, 'Istantanea', ['bardo', 'chierico', 'druido'],
        'Una parola di conforto restituisce a una creatura che puoi vedere 1d4 + il tuo modificatore da incantatore punti ferita.',
        { type: 'cura', dice: '1d4', upcastDice: '1d4', addMod: true }),
    ];
  }

  // Oggetti di mappa di esempio (modelli: ogni copia piazzata ha stato e contenuto propri).
  function defaultMapObjects() {
    const o = (id, name, otype, icon, color, extra) => normalizeMapObject(Object.assign({ id, name, otype, icon: { kind: 'library', icon, color } }, extra));
    return [
      o('mo-forziere', 'Forziere', 'forziere', 'forziere', '#b07a3c', { lock: { locked: true, dcPick: 15, dcForce: 17 }, coins: { mo: 25 } }),
      o('mo-porta', 'Porta di legno', 'porta', 'porta', '#8a5a33', { lock: { locked: false, dcPick: 15, dcForce: 15 } }),
      o('mo-leva', 'Leva', 'leva', 'leva', '#9aa0ab'),
      o('mo-trappola', 'Trappola a lame', 'trappola', 'trappola', '#d4453a', { hidden: true, trap: { dcFind: 14, dcDisarm: 13, effect: { kind: 'salvezza', dice: '2d10', type: 'tagliente', ability: 'DES', dc: 13, half: true } } }),
      o('mo-barile', 'Barile', 'barile', 'barile', '#8a6a3a', { blocks: true }),
    ].concat(visionMapObjects());
  }
  // Esempi della visione (v18): oggetti che fanno luce.
  function visionMapObjects() {
    const o = (id, name, otype, icon, color, extra) => normalizeMapObject(Object.assign({ id, name, otype, icon: { kind: 'library', icon, color } }, extra));
    return [
      o('mo-braciere', 'Braciere', 'altro', 'torcia', '#d9822b', { blocks: true, interactive: true, light: { on: true, bright: 20, dim: 20, color: '#ff9a3c', flicker: true } }),
      o('mo-lanterna', 'Lanterna appesa', 'altro', 'torcia', '#e8c34a', { interactive: true, light: { on: true, bright: 15, dim: 15, color: '#ffd27a', flicker: false } }),
    ];
  }

  // Creature d'esempio (originali): condivise con tutte le sessioni, modificabili ed eliminabili.
  function defaultCreatures(sessionId) {
    return DnD.creatureDati.examples().map((c) => normalizeCreature(Object.assign(c, { sessionId, shared: true }), false));
  }

  function defaultWorld(sessionId) {
    const E = DnD.mondoDati.EXAMPLES;
    const own = (x) => Object.assign(JSON.parse(JSON.stringify(x)), { sessionId, shared: true });
    return {
      factions: E.factions.map((f) => DnD.fazioni.normalizeFaction(own(f))),
      cities: E.cities.map((c) => DnD.citta.normalizeCity(own(c))),
      worldNpcs: E.worldNpcs.map((n) => DnD.npc.normalizeNpc(own(n))),
      quests: E.quests.map((q) => DnD.quest.normalizeQuest(own(q))),
    };
  }

  // Party «Gruppo» per ogni sessione che non ne ha, con i giocatori visibili nella sessione.
  function addDefaultParties(st) {
    for (const se of st.sessions) {
      if (st.parties.some((p) => p.sessionId === se.id || p.shared)) continue;
      const members = st.players.filter((p) => p.shared || p.sessionId === se.id).map((p) => p.id);
      const party = DnD.party.defaultParty(se.id, members);
      st.parties.push(party);
      se.world.activePartyId = party.id;
    }
  }

  DnD.esempi = {
    addDefaultParties, defaultCreatures, defaultMapObjects, defaultRaces, defaultSpells, defaultStructures, defaultWorld, visionMapObjects, visionStructures,
  };
})(globalThis.DnD = globalThis.DnD || {});
