// Scheda del giocatore (dati modificabili): allineamenti, acquisto punti, soglie di PE, livelli dei punti
// caratteristica, carico e sintonia, competenze e abilità offerte dalle classi, equipaggiamento e oro iniziali,
// privilegi suggeriti, sei background e otto talenti ORIGINALI (scritti per questa app, modificabili).
// Livello dati. Espone DnD.schedaDati; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const ALIGNMENTS = ['Legale Buono', 'Neutrale Buono', 'Caotico Buono', 'Legale Neutrale', 'Neutrale', 'Caotico Neutrale', 'Legale Malvagio', 'Neutrale Malvagio', 'Caotico Malvagio'];

  // Acquisto punti: 27 punti, valori da 8 a 15, costo per valore.
  const POINT_BUY = { budget: 27, min: 8, max: 15, costs: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } };

  // PE necessari per ogni livello (indice = livello − 1).
  const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
  // Livelli con 2 punti caratteristica (o un talento al loro posto). Oltre il 20 (leggendari): ogni 4 livelli.
  const ASI_LEVELS = [4, 8, 12, 16, 19];
  // Capacità di carico: FOR × CARRY_FACTOR kg (regola modificabile qui e, per il personaggio, a mano).
  const CARRY_FACTOR = 7.5;
  const MAX_ATTUNEMENT = 3;

  // Grado di competenza in un'abilità: 0 nessuna, 1 competenza, 2 maestria.
  const SKILL_LEVELS = [0, 1, 2];
  const PROF_KINDS = ['armi', 'armature', 'strumenti', 'linguaggi', 'altro'];
  const PROF_KIND_NAMES = { armi: 'Armi', armature: 'Armature', strumenti: 'Strumenti', linguaggi: 'Linguaggi', altro: 'Altro' };
  const FEATURE_SOURCES = ['classe', 'razza', 'background', 'talento', 'altro'];
  const FEATURE_SOURCE_NAMES = { classe: 'Classe', razza: 'Razza', background: 'Background', talento: 'Talento', altro: 'Altro' };
  const USES = ['volonta', 'breve', 'lungo'];
  const USES_NAMES = { volonta: 'A volontà', breve: 'per riposo breve', lungo: 'per riposo lungo' };
  const ALLY_KINDS = ['fazione', 'npc', 'libero'];
  const APPEARANCE = ['age', 'height', 'weight', 'eyes', 'skin', 'hair'];
  const APPEARANCE_NAMES = { age: 'Età', height: 'Altezza', weight: 'Peso', eyes: 'Occhi', skin: 'Pelle', hair: 'Capelli' };
  const PERSONALITY = ['traits', 'ideals', 'bonds', 'flaws'];
  const PERSONALITY_NAMES = { traits: 'Tratti della personalità', ideals: 'Ideali', bonds: 'Legami', flaws: 'Difetti' };

  // Abilità tra cui scegliere alla creazione (numero e opzioni) e competenze di base per classe.
  const S = ['Acrobazia', 'Addestrare animali', 'Arcano', 'Atletica', 'Furtività', 'Indagare', 'Inganno', 'Intimidire', 'Intrattenere', 'Intuizione',
    'Medicina', 'Natura', 'Percezione', 'Persuasione', 'Rapidità di mano', 'Religione', 'Sopravvivenza', 'Storia'];
  const CLASS_SKILLS = {
    barbaro: { count: 2, options: ['Addestrare animali', 'Atletica', 'Intimidire', 'Natura', 'Percezione', 'Sopravvivenza'] },
    bardo: { count: 3, options: S },
    chierico: { count: 2, options: ['Intuizione', 'Medicina', 'Persuasione', 'Religione', 'Storia'] },
    druido: { count: 2, options: ['Addestrare animali', 'Arcano', 'Intuizione', 'Medicina', 'Natura', 'Percezione', 'Religione', 'Sopravvivenza'] },
    guerriero: { count: 2, options: ['Acrobazia', 'Addestrare animali', 'Atletica', 'Intimidire', 'Intuizione', 'Percezione', 'Sopravvivenza', 'Storia'] },
    ladro: { count: 4, options: ['Acrobazia', 'Atletica', 'Furtività', 'Indagare', 'Inganno', 'Intimidire', 'Intrattenere', 'Intuizione', 'Percezione', 'Persuasione', 'Rapidità di mano'] },
    mago: { count: 2, options: ['Arcano', 'Indagare', 'Intuizione', 'Medicina', 'Religione', 'Storia'] },
    monaco: { count: 2, options: ['Acrobazia', 'Atletica', 'Furtività', 'Intuizione', 'Religione', 'Storia'] },
    paladino: { count: 2, options: ['Atletica', 'Intimidire', 'Intuizione', 'Medicina', 'Persuasione', 'Religione'] },
    ranger: { count: 3, options: ['Addestrare animali', 'Atletica', 'Furtività', 'Indagare', 'Intuizione', 'Natura', 'Percezione', 'Sopravvivenza'] },
    stregone: { count: 2, options: ['Arcano', 'Inganno', 'Intimidire', 'Intuizione', 'Persuasione', 'Religione'] },
    warlock: { count: 2, options: ['Arcano', 'Indagare', 'Inganno', 'Intimidire', 'Natura', 'Religione', 'Storia'] },
  };
  const CLASS_PROFS = {
    barbaro: { armi: ['Armi semplici', 'Armi da guerra'], armature: ['Armature leggere', 'Armature medie', 'Scudi'] },
    bardo: { armi: ['Armi semplici', 'Stocchi', 'Spade corte'], armature: ['Armature leggere'], strumenti: ['Tre strumenti musicali'] },
    chierico: { armi: ['Armi semplici'], armature: ['Armature leggere', 'Armature medie', 'Scudi'] },
    druido: { armi: ['Bastoni', 'Pugnali', 'Scimitarre', 'Lance'], armature: ['Armature leggere e medie non di metallo', 'Scudi non di metallo'], strumenti: ['Borsa da erborista'] },
    guerriero: { armi: ['Armi semplici', 'Armi da guerra'], armature: ['Tutte le armature', 'Scudi'] },
    ladro: { armi: ['Armi semplici', 'Balestre a mano', 'Spade corte', 'Spade lunghe', 'Stocchi'], armature: ['Armature leggere'], strumenti: ['Arnesi da scasso'] },
    mago: { armi: ['Pugnali', 'Dardi', 'Fionde', 'Bastoni', 'Balestre leggere'] },
    monaco: { armi: ['Armi semplici', 'Spade corte'], strumenti: ['Uno strumento da artigiano o musicale'] },
    paladino: { armi: ['Armi semplici', 'Armi da guerra'], armature: ['Tutte le armature', 'Scudi'] },
    ranger: { armi: ['Armi semplici', 'Armi da guerra'], armature: ['Armature leggere', 'Armature medie', 'Scudi'] },
    stregone: { armi: ['Pugnali', 'Dardi', 'Fionde', 'Bastoni', 'Balestre leggere'] },
    warlock: { armi: ['Armi semplici'], armature: ['Armature leggere'] },
  };
  // Equipaggiamento iniziale: nomi del catalogo dell'Attrezzatura (quelli che non ci sono vengono saltati).
  const CLASS_KITS = {
    barbaro: ['Ascia bipenne', 'Giavellotto'], bardo: ['Stocco', 'Armatura di cuoio', 'Pugnale'], chierico: ['Mazza', 'Corazza di scaglie', 'Scudo'],
    druido: ['Scimitarra', 'Armatura di cuoio', 'Scudo'], guerriero: ['Cotta di maglia', 'Spada lunga', 'Scudo', 'Balestra leggera'],
    ladro: ['Stocco', 'Arco corto', 'Armatura di cuoio', 'Pugnale'], mago: ['Bastone ferrato', 'Pugnale'], monaco: ['Spada corta', 'Dardo'],
    paladino: ['Cotta di maglia', 'Spada lunga', 'Scudo', 'Giavellotto'], ranger: ['Corazza di scaglie', 'Spada corta', 'Arco lungo'],
    stregone: ['Balestra leggera', 'Pugnale'], warlock: ['Balestra leggera', 'Armatura di cuoio', 'Pugnale'],
  };
  // Oro iniziale per l'acquisto: dadi × moltiplicatore (in mo).
  const STARTING_GOLD = {
    barbaro: ['2d4', 10], bardo: ['5d4', 10], chierico: ['5d4', 10], druido: ['2d4', 10], guerriero: ['5d4', 10], ladro: ['4d4', 10],
    mago: ['4d4', 10], monaco: ['5d4', 1], paladino: ['5d4', 10], ranger: ['5d4', 10], stregone: ['3d4', 10], warlock: ['4d4', 10],
  };
  // Privilegi di 1° livello suggeriti (descrizioni brevi scritte per questa app).
  const CLASS_FEATURES = {
    barbaro: [{ name: 'Ira', desc: 'Entra in uno stato di furia: più danni in mischia e resistenza ai colpi fisici per un minuto.', uses: { kind: 'lungo', max: 2 } }, { name: 'Difesa senza armatura', desc: 'Senza armatura la CA usa anche la Costituzione.' }],
    bardo: [{ name: 'Ispirazione bardica', desc: 'Con parole o musica dà a un alleato un dado da aggiungere a una prova, un attacco o un tiro salvezza.', uses: { kind: 'lungo', max: 3 } }],
    chierico: [{ name: 'Dominio divino', desc: 'La divinità scelta concede incantesimi e un potere del dominio.' }],
    druido: [{ name: 'Lingua druidica', desc: 'Conosce la lingua segreta dei druidi e lascia messaggi nascosti.' }],
    guerriero: [{ name: 'Stile di combattimento', desc: 'Uno stile preferito che migliora un modo di combattere (difesa, duello, tiro…).' }, { name: 'Recuperare energie', desc: 'Con un\'azione bonus recupera un po\' di PF.', uses: { kind: 'breve', max: 1 } }],
    ladro: [{ name: 'Attacco furtivo', desc: 'Danni extra una volta per turno quando ha vantaggio o un alleato vicino al bersaglio.' }, { name: 'Maestria', desc: 'Raddoppia la competenza in due abilità scelte.' }],
    mago: [{ name: 'Recupero arcano', desc: 'Dopo un riposo breve recupera alcuni slot dal libro.', uses: { kind: 'lungo', max: 1 } }],
    monaco: [{ name: 'Arti marziali', desc: 'Colpi senz\'armi più efficaci e un colpo extra con l\'azione bonus.' }, { name: 'Difesa senza armatura', desc: 'Senza armatura la CA usa anche la Saggezza.' }],
    paladino: [{ name: 'Percezione divina', desc: 'Sente la presenza di creature celestiali, immonde o non morte vicine.', uses: { kind: 'lungo', max: 1 } }, { name: 'Imposizione delle mani', desc: 'Una riserva di PF da donare con il tocco.' }],
    ranger: [{ name: 'Nemico prescelto', desc: 'Conosce bene un tipo di creatura: le traccia e ne ricorda le abitudini.' }, { name: 'Esploratore nato', desc: 'Si muove e si orienta meglio in un tipo di terreno.' }],
    stregone: [{ name: 'Origine stregonesca', desc: 'La fonte del potere innato (sangue antico, magia selvaggia…).' }],
    warlock: [{ name: 'Patrono ultraterreno', desc: 'Un patto con un\'entità potente che concede poteri.' }],
  };

  // Background d'esempio (originali): competenze, strumenti, linguaggi, equipaggiamento (nomi del catalogo),
  // privilegio e suggerimenti per la personalità.
  const BACKGROUNDS = [
    { id: 'bg-guardiano-faro', name: 'Guardiano del faro', skills: ['Percezione', 'Sopravvivenza'], tools: ['Strumenti da navigatore'], languages: ['Una lingua a scelta'], equipment: ['Pugnale'],
      feature: { name: 'Luce nella tempesta', desc: 'Marinai e pescatori riconoscono chi ha tenuto acceso un faro: offrono un passaggio o un riparo.' },
      suggestions: { traits: ['Parlo poco ma osservo tutto.', 'Conto le onde quando sono nervoso.'], ideals: ['Dovere: qualcuno deve restare sveglio per gli altri.'], bonds: ['Il faro della mia infanzia è stato spento: voglio sapere chi è stato.'], flaws: ['Non mi fido di chi non guarda il cielo.'] } },
    { id: 'bg-cartografo', name: 'Cartografo errante', skills: ['Storia', 'Natura'], tools: ['Strumenti da cartografo'], languages: ['Due lingue a scelta'], equipment: [],
      feature: { name: 'Occhio per i sentieri', desc: 'Ricorda le strade percorse e trova sempre la via più breve verso un luogo già visto.' },
      suggestions: { traits: ['Disegno su qualsiasi cosa, anche sui tovaglioli.'], ideals: ['Conoscenza: ogni angolo del mondo merita una mappa.'], bonds: ['Devo finire l\'atlante di mio padre.'], flaws: ['Mi perdo nei dettagli e dimentico il pericolo.'] } },
    { id: 'bg-gladiatore', name: 'Ex gladiatore', skills: ['Atletica', 'Intrattenere'], tools: ['Un tipo di arma insolita'], languages: [], equipment: ['Tridente'],
      feature: { name: 'Nome dell\'arena', desc: 'Nelle città con un\'arena qualcuno ricorda le sue vittorie e offre da bere o informazioni.' },
      suggestions: { traits: ['Saluto ogni nemico prima di combatterlo.'], ideals: ['Libertà: nessuno sarà più mio padrone.'], bonds: ['Un compagno d\'arena è ancora prigioniero.'], flaws: ['Non resisto a una sfida, anche stupida.'] } },
    { id: 'bg-novizio-cenere', name: 'Novizio della Cenere', skills: ['Religione', 'Medicina'], tools: ['Borsa da erborista'], languages: ['Una lingua a scelta'], equipment: ['Bastone ferrato'],
      feature: { name: 'Ospitalità del tempio', desc: 'I templi della sua fede gli offrono vitto, alloggio e cure di base.' },
      suggestions: { traits: ['Prego a voce alta nei momenti peggiori.'], ideals: ['Carità: chi ha bisogno viene prima.'], bonds: ['Il mio maestro è scomparso in pellegrinaggio.'], flaws: ['Giudico in fretta chi non crede.'] } },
    { id: 'bg-contrabbandiere', name: 'Contrabbandiere di fiume', skills: ['Inganno', 'Rapidità di mano'], tools: ['Veicoli d\'acqua', 'Arnesi da scasso'], languages: [], equipment: ['Pugnale'],
      feature: { name: 'Approdi nascosti', desc: 'Conosce moli abbandonati e barcaioli discreti lungo i fiumi della regione.' },
      suggestions: { traits: ['Ho sempre una via di fuga in mente.'], ideals: ['Indipendenza: le leggi sono per chi se le può permettere.'], bonds: ['Devo un favore grosso a una banda di battellieri.'], flaws: ['Non riesco a dire la verità alle guardie.'] } },
    { id: 'bg-erudito-esule', name: 'Erudito in esilio', skills: ['Arcano', 'Indagare'], tools: [], languages: ['Due lingue a scelta'], equipment: [],
      feature: { name: 'Biblioteche segrete', desc: 'Sa dove trovare copie proibite di libri rari e chi le custodisce.' },
      suggestions: { traits: ['Correggo la grammatica di tutti.'], ideals: ['Verità: nessun sapere va bruciato.'], bonds: ['Voglio tornare nell\'accademia che mi ha cacciato.'], flaws: ['Sottovaluto chi non ha studiato.'] } },
  ];

  // Talenti d'esempio (originali) con effetti numerici facoltativi applicati ai calcoli.
  const FEATS = [
    { id: 'tal-pelle-quercia', name: 'Pelle di quercia', requirements: 'Costituzione 13', description: 'La pelle si indurisce come corteccia.', effects: { abilities: { COS: 1 }, ac: 1 } },
    { id: 'tal-riflessi-felini', name: 'Riflessi felini', requirements: '', description: 'Reagisce prima di tutti al pericolo.', effects: { initiative: 3 } },
    { id: 'tal-passo-lungo', name: 'Passo lungo', requirements: '', description: 'Cammina e corre più veloce degli altri.', effects: { speed: 3 } },
    { id: 'tal-studioso', name: 'Studioso instancabile', requirements: 'Intelligenza 13', description: 'Anni sui libri: memoria e cultura migliorano.', effects: { abilities: { INT: 1 }, skills: ['Storia'] } },
    { id: 'tal-tempra', name: 'Tempra d\'acciaio', requirements: '', description: 'Resiste alla fatica e alle ferite.', effects: { hpPerLevel: 2 } },
    { id: 'tal-occhio-aquila', name: 'Occhio d\'aquila', requirements: '', description: 'Nota i dettagli anche da lontano.', effects: { abilities: { SAG: 1 }, skills: ['Percezione'] } },
    { id: 'tal-voce-ferma', name: 'Voce ferma', requirements: 'Carisma 13', description: 'Parla con calma e convince.', effects: { abilities: { CAR: 1 }, skills: ['Persuasione'] } },
    { id: 'tal-guardia-alta', name: 'Guardia alta', requirements: 'Competenza con le armature medie', description: 'Si muove sempre coperto e pronto a parare.', effects: { ac: 1, saves: ['DES'] } },
  ];

  DnD.schedaDati = {
    ALIGNMENTS, POINT_BUY, XP_THRESHOLDS, ASI_LEVELS, CARRY_FACTOR, MAX_ATTUNEMENT, SKILL_LEVELS, PROF_KINDS, PROF_KIND_NAMES,
    FEATURE_SOURCES, FEATURE_SOURCE_NAMES, USES, USES_NAMES, ALLY_KINDS, APPEARANCE, APPEARANCE_NAMES, PERSONALITY, PERSONALITY_NAMES,
    CLASS_SKILLS, CLASS_PROFS, CLASS_KITS, STARTING_GOLD, CLASS_FEATURES, BACKGROUNDS, FEATS,
  };
})(globalThis.DnD = globalThis.DnD || {});
