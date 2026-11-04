# Importazione degli incantesimi dall'SRD 5.1 (italiano)

Rapporto generato da `strumenti/estrai-srd.js` il 2026-11-04 sul file `fonti/SRD_CC_v5.1_IT.pdf`
(testo letto con `pdftotext -enc UTF-8`, ordine di lettura). Rilanciare lo strumento rigenera questo file e
`js/dati/srd-incantesimi.js`.

## Attribuzione

> Questo lavoro include materiale del System Reference Document 5.1 (“SRD 5.1”) di Wizards of the Coast LLC disponibile al sito https://dnd.wizards.com/it/resources/systems-reference-document. L’SRD 5.1 è concesso in licenza sotto l’Attribuzione 4.0 Internazionale di Creative Commons disponibile al sito https://creativecommons.org/licenses/by/4.0/legalcode.it.

## Conteggi

- Incantesimi estratti: **319** (intestazioni «Scuola di N° livello» / «Trucchetto di …» trovate: 319).
- Incantesimi nominati nelle liste per classe: 319. Il PDF non ha un indice degli incantesimi: il confronto
  è fatto con le liste per classe e torna.

| Livello | Incantesimi |
|---|---|
| Trucchetti | 24 |
| 1° | 49 |
| 2° | 54 |
| 3° | 42 |
| 4° | 31 |
| 5° | 37 |
| 6° | 31 |
| 7° | 20 |
| 8° | 16 |
| 9° | 15 |

| Scuola | Incantesimi |
|---|---|
| Abiurazione | 39 |
| Ammaliamento | 29 |
| Divinazione | 29 |
| Evocazione | 49 |
| Illusione | 27 |
| Invocazione | 62 |
| Necromanzia | 25 |
| Trasmutazione | 59 |

## Controlli

Senza classe (descritti ma in nessuna lista):
- nessuno

Senza scuola: nessuno (la scuola è letta dall'intestazione; un'intestazione non riconosciuta esclude l'incantesimo).

Campi mancanti (tempo di lancio, gittata, durata o descrizione vuoti):
- nessuno

Difetti del PDF corretti dallo strumento:
- Dominare persone: nell'intestazione la parola «Eroismo» (titolo dell'incantesimo della colonna accanto) è sovrapposta a «livello»
- Contagio: «Componente:» invece di «Componenti:»

Intestazioni con campi non leggibili (incantesimi esclusi):
- nessuno

Nomi nelle liste per classe senza descrizione corrispondente:
- nessuno

Nomi nelle liste scritti diversamente dalla descrizione (abbinati per somiglianza, al massimo 2 lettere di differenza):
- nessuno

Livello nella lista diverso da quello della descrizione:
- nessuno

Id ripetuti:
- nessuno

Nomi troppo lunghi per la libreria:
- nessuno

## Meccanica

Rilevata (da verificare nella coda «Da verificare»): **114**. Non rilevata: **205**, di cui
32 ambigui (lasciati senza tiro automatico) e 173 senza dadi, attacchi o tiri salvezza.

### Rilevata

- Allucinazione mortale: tiro salvezza su SAG, 4d10 psichici; +1d10 per slot superiore
- Amicizia con gli animali: tiro salvezza su SAG, senza danni
- Anatema: tiro salvezza su CAR, senza danni
- Antipatia/Simpatia: tiro salvezza su SAG, senza danni
- Arma spirituale: attacco con incantesimo, 1d8 forza; livelli superiori non interpretati: «Quando l'incantatore lancia questo incantesimo usando uno slot incantesimo di 3°…»
- Aura sacra: tiro salvezza su COS, senza danni
- Bagliore lunare: tiro salvezza su COS, 2d10 radiosi, metà se riesce; +1d10 per slot superiore
- Bagliore solare: tiro salvezza su COS, 6d8 radiosi, metà se riesce
- Banchetto degli eroi: tiro salvezza su SAG, senza danni
- Barriera di lame: tiro salvezza su DES, 6d10 taglienti, metà se riesce
- Beffa crudele: tiro salvezza su SAG, 1d4 psichici
- Blocca mostri: tiro salvezza su SAG, senza danni
- Blocca persone: tiro salvezza su SAG, senza danni
- Calmare emozioni: tiro salvezza su CAR, senza danni
- Carne in pietra: tiro salvezza su COS, senza danni
- Catena di fulmini: tiro salvezza su DES, 10d8 fulmine, metà se riesce; livelli superiori non interpretati: «Quando l'incantatore lancia questo incantesimo usando uno slot incantesimo di 7°…»
- Cecità/Sordità: tiro salvezza su COS, senza danni
- Cerchio di morte: tiro salvezza su COS, 8d6 necrotici, metà se riesce; +2d6 per slot superiore
- Cerchio magico: tiro salvezza su CAR, senza danni
- Charme su persone: tiro salvezza su SAG, senza danni
- Comando: tiro salvezza su SAG, senza danni
- Compulsione: tiro salvezza su SAG, senza danni
- Confusione: tiro salvezza su SAG, senza danni
- Cono di freddo: tiro salvezza su COS, 8d8 freddo, metà se riesce; +1d8 per slot superiore
- Contattare altri piani: tiro salvezza su INT, 6d6 psichici
- Controllare acqua: tiro salvezza su FOR, 2d8 contundenti, metà se riesce
- Costrizione: tiro salvezza su SAG, 5d10 psichici
- Cura ferite: cura 1d8 + modificatore; +1d8 per slot superiore
- Cura ferite di massa: cura 3d8 + modificatore; +1d8 per slot superiore
- Danza irresistibile: tiro salvezza su SAG, senza danni
- Dardo di fuoco: attacco con incantesimo, 1d10 fuoco
- Dardo tracciante: attacco con incantesimo, 4d6 radiosi; +1d6 per slot superiore
- Deflagrazione occulta: attacco con incantesimo, 1d10 forza
- Disintegrazione: tiro salvezza su DES, 10d6+40 forza; +3d6 per slot superiore
- Dito della morte: tiro salvezza su COS, 7d8+30 necrotici, metà se riesce
- Dominare bestie: tiro salvezza su SAG, senza danni
- Dominare mostri: tiro salvezza su SAG, senza danni
- Dominare persone: tiro salvezza su SAG, senza danni
- Esilio: tiro salvezza su CAR, senza danni
- Esplosione solare: tiro salvezza su COS, 12d6 radiosi, metà se riesce
- Estasiare: tiro salvezza su SAG, senza danni
- Fatale: tiro salvezza su SAG, 4d10 psichici
- Ferire: tiro salvezza su COS, 14d6 necrotici, metà se riesce
- Fiamma sacra: tiro salvezza su DES, 1d8 radiosi
- Fiotto acido: tiro salvezza su DES, 1d6 acido
- Folata di vento: tiro salvezza su FOR, senza danni
- Frantumare: tiro salvezza su COS, 3d8 tuono, metà se riesce; +1d8 per slot superiore
- Fulmine: tiro salvezza su DES, 8d6 fulmine, metà se riesce; +1d6 per slot superiore
- Gabbia di forza: tiro salvezza su CAR, senza danni
- Giara magica: tiro salvezza su CAR, senza danni
- Glifo di interdizione: tiro salvezza su DES, 5d8 acido, metà se riesce; +1d8 per slot superiore
- Guardiano della fede: tiro salvezza su DES, senza danni
- Imprigionare: tiro salvezza su SAG, senza danni
- Inaridire: tiro salvezza su COS, 8d8 necrotici, metà se riesce; +1d8 per slot superiore
- Individuazione dei pensieri: tiro salvezza su SAG, senza danni
- Infliggi ferite: attacco con incantesimo, 3d10 necrotici; +1d10 per slot superiore
- Ingrandire/Ridurre: tiro salvezza su COS, senza danni
- Intimorire infernale: tiro salvezza su DES, 2d10 fuoco, metà se riesce; +1d10 per slot superiore
- Intralciare: tiro salvezza su FOR, senza danni
- Inversione della gravità: tiro salvezza su DES, senza danni
- Invocare il fulmine: tiro salvezza su DES, 3d10 fulmine, metà se riesce; +1d10 per slot superiore
- Legame planare: tiro salvezza su CAR, senza danni
- Levitazione: tiro salvezza su COS, senza danni
- Luce: tiro salvezza su DES, senza danni
- Luminescenza: tiro salvezza su DES, senza danni
- Mani brucianti: tiro salvezza su DES, 3d6 fuoco, metà se riesce; +1d6 per slot superiore
- Metamorfosi: tiro salvezza su SAG, senza danni
- Metamorfosi pura: tiro salvezza su SAG, senza danni
- Modificare memoria: tiro salvezza su SAG, senza danni
- Muro di fuoco: tiro salvezza su DES, 5d8 fuoco, metà se riesce; +1d8 per slot superiore
- Muro di pietra: tiro salvezza su DES, senza danni
- Muro di vento: tiro salvezza su FOR, 3d8 contundenti, metà se riesce
- Nube incendiaria: tiro salvezza su DES, 10d8 fuoco, metà se riesce
- Nube maleodorante: tiro salvezza su COS, senza danni
- Nube mortale: tiro salvezza su COS, 5d8 veleno, metà se riesce; +1d8 per slot superiore
- Onda tonante: tiro salvezza su COS, 2d8 tuono, metà se riesce; +1d8 per slot superiore
- Palla di fuoco: tiro salvezza su DES, 8d6 fuoco, metà se riesce; +1d6 per slot superiore
- Palla di fuoco ritardata: tiro salvezza su DES, senza danni
- Parola del potere stordire: tiro salvezza su COS, senza danni
- Parola divina: tiro salvezza su CAR, senza danni
- Parola guaritrice: cura 1d4 + modificatore; +1d4 per slot superiore
- Parola guaritrice di massa: cura 1d4 + modificatore; +1d4 per slot superiore
- Paura: tiro salvezza su SAG, senza danni
- Piaga degli insetti: tiro salvezza su COS, 4d10 perforanti, metà se riesce; +1d10 per slot superiore
- Preghiera di guarigione: cura 2d8 + modificatore; +1d8 per slot superiore
- Produrre fiamma: attacco con incantesimo, 1d8 fuoco
- Raggio di gelo: attacco con incantesimo, 1d8 freddo
- Raggio rovente: attacco con incantesimo, 2d6 fuoco; livelli superiori non interpretati: «Quando l'incantatore lancia questo incantesimo usando uno slot incantesimo di 3°…»
- Ragnatela: tiro salvezza su DES, 2d4 fuoco
- Regressione mentale: tiro salvezza su INT, 4d6 psichici
- Risata incontenibile: tiro salvezza su SAG, senza danni
- Riscaldare il metallo: tiro salvezza su COS, 2d8 fuoco; +1d8 per slot superiore
- Santificare: tiro salvezza su CAR, senza danni
- Santuario: tiro salvezza su SAG, senza danni
- Scagliare maledizione: tiro salvezza su SAG, 1d8 necrotici
- Scrutare: tiro salvezza su SAG, senza danni
- Sembrare: tiro salvezza su CAR, senza danni
- Sfera congelante: tiro salvezza su COS, 10d6 freddo, metà se riesce; +1d6 per slot superiore
- Sfera elastica: tiro salvezza su DES, senza danni
- Sfera infuocata: tiro salvezza su DES, 2d6 fuoco, metà se riesce; +1d6 per slot superiore
- Sguardo penetrante: tiro salvezza su SAG, senza danni
- Sogno: tiro salvezza su SAG, 3d6 psichici
- Spada arcana: attacco con incantesimo, 3d10 forza
- Spruzzo velenoso: tiro salvezza su COS, 1d12 veleno
- Stretta folgorante: attacco con incantesimo, 1d8 fulmine
- Suggestione: tiro salvezza su SAG, senza danni
- Suggestione di massa: tiro salvezza su SAG, senza danni
- Tempesta di fuoco: tiro salvezza su DES, 7d10 fuoco, metà se riesce
- Tentacoli neri: tiro salvezza su DES, 3d6 contundenti
- Tocco del vampiro: attacco con incantesimo, 3d6 necrotici; +1d6 per slot superiore
- Tocco gelido: attacco con incantesimo, 1d8 necrotici
- Trama ipnotica: tiro salvezza su SAG, senza danni
- Unto: tiro salvezza su DES, senza danni
- Zona di verità: tiro salvezza su CAR, senza danni

### Ambigua (nessun tiro automatico)

- Alterare se stesso: danni senza attacco né tiro salvezza: 1d6 contundenti
- Colpo infuocato: più danni diversi: 4d6 fuoco; 4d6 radiosi
- Contagio: attacco con incantesimo e tiro salvezza nello stesso testo
- Crescita di spine: danni senza attacco né tiro salvezza: 2d4 perforanti
- Dardo incantato: danni senza attacco né tiro salvezza: 1d4+1 forza
- Desiderio: danni senza attacco né tiro salvezza: 1d10 necrotici
- Dissolvi il bene e il male: attacco con incantesimo e tiro salvezza nello stesso testo
- Favore divino: danni senza attacco né tiro salvezza: 1d4 radiosi
- Fondersi nella pietra: danni senza attacco né tiro salvezza: 6d6 contundenti
- Freccia acida: più danni diversi: 4d4 acido; 2d4 acido
- Guardiani spirituali: più danni diversi: 3d8 radiosi; 3d8 necrotici
- Lama infuocata: danni senza attacco né tiro salvezza: 3d6 fuoco
- Lentezza: tiri salvezza su più caratteristiche: SAG, DES
- Mano arcana: più danni diversi: 2d6 contundenti; 4d8 forza
- Muro di ghiaccio: tiri salvezza su più caratteristiche: DES, COS
- Muro di spine: più danni diversi: 7d8 perforanti; 7d8 taglienti
- Muro prismatico: tiri salvezza su più caratteristiche: COS, DES, SAG
- Porta dimensionale: danni senza attacco né tiro salvezza: 4d6 forza
- Proibizione: danni senza attacco né tiro salvezza: 5d10 necrotici
- Punizione marchiante: danni senza attacco né tiro salvezza: 2d6 radiosi
- Raggio di affaticamento: attacco con incantesimo e tiro salvezza nello stesso testo
- Sciame di meteore: più danni diversi: 20d6 fuoco; 20d6 contundenti
- Scudo di fuoco: più danni diversi: 2d8 fuoco; 2d8 freddo
- Segugio fedele: danni senza attacco né tiro salvezza: 4d8 perforanti
- Simbolo: tiri salvezza su più caratteristiche: COS, CAR, SAG, INT
- Spostamento planare: attacco con incantesimo e tiro salvezza nello stesso testo
- Spruzzo prismatico: tiri salvezza su più caratteristiche: DES, COS, SAG
- Teletrasporto: danni senza attacco né tiro salvezza: 3d10 forza
- Tempesta di ghiaccio: più danni diversi: 2d8 contundenti; 4d6 freddo
- Tempesta di nevischio: tiri salvezza su più caratteristiche: DES, COS
- Tempesta di vendetta: tiri salvezza su più caratteristiche: COS, DES
- Terremoto: tiri salvezza su più caratteristiche: COS, DES

### Senza meccanica nel testo

Aiuto, Allarme, Alleato planare, Animale messaggero, Animare morti, Animare oggetti, Anti-individuazione, Arma magica, Armatura magica, Artificio druidico, Aura magica dell'arcanista, Bacche benefiche, Benedizione, Bocca magica, Caduta morbida, Camminare nel vento, Camminare sull'acqua, Campo anti-magia, Camuffare se stesso, Capanna, Caratteristica potenziata, Celare, Cerchio di teletrasporto, Chiaroveggenza, Clone, Colpo accurato, Comprensione dei linguaggi, Comunione, Comunione con la natura, Conoscenza delle legende, Contingenza, Controincantesimo, Controllare tempo atmosferico, Creare cibo e acqua, Creare non morti, Creare o distruggere acqua, Creazione, Crescita vegetale, Destriero fantomatico, Disco fluttuante, Dissolvi magie, Divinazione, Eroismo, Evoca animali, Evoca celestiale, Evoca creature boschive, Evoca elementale, Evoca elementali minori, Evoca folletto, Evocazioni istantanee, Fabbricare, Faro di speranza, Fermare il tempo, Fiamma perenne, Forma eterea, Forma gassosa, Forme animali, Fuorviare, Globo di invulnerabilità, Guarigione, Guarigione di massa, Guida, Guscio anti-vita, Identificare, Illusione minore, Illusione programmata, Immagine maggiore, Immagine proiettata, Immagine silenziosa, Immagine speculare, Individuazione del bene e del male, Individuazione del magico, Individuazione delle malattie e dei veleni, Insetto gigante, Interdizione alla morte, Intermittenza, Inviare, Invisibilità, Invisibilità superiore, Labirinto, Legame telepatico, Libertà di movimento, Linguaggi, Localizza animali o vegetali, Localizza creatura, Localizza oggetto, Loquacità, Luce diurna, Luci danzanti, Mano magica, Marchio del cacciatore, Messaggio, Miraggio arcano, Movimenti del ragno, Muovere il terreno, Muro di forza, Nube di nebbia, Occhio arcano, Oscurità, Parlare con gli animali, Parlare con i morti, Parlare con i vegetali, Parola del potere uccidere, Parola del ritiro, Passapareti, Passare senza tracce, Passo velato, Passo veloce, Pelle coriacea, Pelle di pietra, Portale, Presagio, Prestidigitazione, Previsione, Proiezione astrale, Protezione dai veleni, Protezione dal bene e dal male, Protezione dall'energia, Purificare cibo e bevande, Randello incantato, Reggia meravigliosa, Reincarnazione, Resistenza, Respirare sott'acqua, Resurrezione, Resurrezione pura, Rianimare morti, Rigenerazione, Rimuovi maledizione, Rinascita, Riparare, Riposo inviolato, Ristorare inferiore, Ristorare superiore, Risveglio, Ritirata rapida, Saltare, Salvare i morenti, Santuario privato, Scassinare, Scolpire pietra, Scopri il percorso, Scopri trappole, Scrigno segreto, Scritto illusorio, Scudo, Scudo della fede, Scurovisione, Semipiano, Serratura arcana, Servitore inosservato, Sfocatura, Silenzio, Simulacro, Sonno, Spruzzo colorato, Taumaturgia, Telecinesi, Terreno illusorio, Trasformazione, Traslazione arborea, Trasporto vegetale, Trova cavalcatura, Trova famiglio, Trucco della corda, Vedere invisibilità, Velocità, Vigilanza e interdizione, Vincolo di interdizione, Visione del vero, Vita falsata, Volare, Vuoto mentale

## Testi forse spezzati dall'estrazione

Righe unite perché la seguente iniziava con la minuscola o la precedente finiva con una virgola (a capo di pagina o di
colonna), e paragrafi che finiscono senza punto (tabelle, elenchi o un a capo non riconosciuto). Le tabelle interne
agli incantesimi (es. Confusione, Muro prismatico, Spruzzo prismatico) restano righe di testo semplice.

- Animare oggetti: paragrafo che finisce senza punto «…Statistiche degli oggetti animati» (lasciato così)
- Animare oggetti: paragrafo che finisce senza punto «…Taglia» (lasciato così)
- Animare oggetti: paragrafo che finisce senza punto «…PF CA Attacco» (lasciato così)
- Animare oggetti: «…Minuscola 20 18 +8 al tiro per colpire,» + «1d4 + 4 danni…» (uniti)
- Animare oggetti: paragrafo che finisce senza punto «…Minuscola 20 18 +8 al tiro per colpire, 1d4 + 4 danni» (lasciato così)
- Animare oggetti: «…Piccola 25 16 +6 al tiro per colpire,» + «1d8 + 2 danni…» (uniti)
- Animare oggetti: paragrafo che finisce senza punto «…Piccola 25 16 +6 al tiro per colpire, 1d8 + 2 danni» (lasciato così)
- Animare oggetti: paragrafo che finisce senza punto «…Media» (lasciato così)
- Animare oggetti: «…40 13 +5 al tiro per colpire,» + «2d6 + 1 danni…» (uniti)
- Animare oggetti: paragrafo che finisce senza punto «…40 13 +5 al tiro per colpire, 2d6 + 1 danni» (lasciato così)
- Animare oggetti: «…Grande 50 10 +6 al tiro per colpire,» + «2d10 + 2 danni…» (uniti)
- Animare oggetti: paragrafo che finisce senza punto «…Grande 50 10 +6 al tiro per colpire, 2d10 + 2 danni» (lasciato così)
- Animare oggetti: «…Enorme 80 10 +8 al tiro per colpire,» + «2d12 + 4 danni…» (uniti)
- Animare oggetti: paragrafo che finisce senza punto «…Enorme 80 10 +8 al tiro per colpire, 2d12 + 4 danni» (lasciato così)
- Animare oggetti: paragrafo che finisce senza punto «…For Des 4 18 6 14 10 12 14 10 18 6» (lasciato così)
- Animare oggetti: «… a 9 metri e può fluttuare. Se l'oggetto» + «è agganciato saldamente a una superficie…» (uniti)
- Antipatia/Simpatia: «…lligente, come per esempio draghi rossi,» + «goblin o vampiri. L'incantatore infonde …» (uniti)
- Benedizione: «…iro per colpire o un tiro salvezza prima» + «che l'incantesimo termini, può tirare un…» (uniti)
- Caduta morbida: «…l'incantesimo termini, non subisce alcun» + «danno da caduta e può atterrare in piedi…» (uniti)
- Camminare nel vento: «…ll'incantesimo, una creatura può tornare» + «in forma gassosa, il che richiede 1 minu…» (uniti)
- Capanna: «…no attraversare liberamente la barriera,» + «mentre a tutte le altre creature e ogget…» (uniti)
- Comunione con la natura: «…egetali, minerali, animali o popolazioni» + «predominanti • celestiali, folletti, imm…» (uniti)
- Comunione con la natura: «…olletti, immondi, elementali o non morti» + «potenti • influenza da altri piani di es…» (uniti)
- Comunione con la natura: paragrafo che finisce senza punto «…ti potenti • influenza da altri piani di esistenza • edifici» (lasciato così)
- Confusione: «…no per determinare il suo comportamento.» + «d10 1…» (uniti)
- Confusione: paragrafo che finisce senza punto «…i ogni suo turno per determinare il suo comportamento. d10 1» (lasciato così)
- Confusione: paragrafo che finisce senza punto «…2–6 7–8» (lasciato così)
- Confusione: paragrafo che finisce senza punto «…9–10» (lasciato così)
- Contingenza: «…respirare sott'acqua avrà effetto quando» + «l'incantatore sarà sommerso nell'acqua o…» (uniti)
- Controllare acqua: «… 30 metri per lato. Quando lancia questo» + «incantesimo, l'incantatore può scegliere…» (uniti)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…Precipitazioni» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…Grado 1 2 3 4 5» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…e o neve Pioggia torrenziale, grandinata violenta o tormenta» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…Temperatura» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…Grado 1 2 3 4 5 6» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…o insopportabile Caldo Temperato Fresco Freddo Freddo artico» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…Vento» (lasciato così)
- Controllare tempo atmosferico: paragrafo che finisce senza punto «…Grado 1 2 3 4 5» (lasciato così)
- Creare non morti: «…i ristabilire il controllo su un massimo» + «di tre creature da lui animate tramite q…» (uniti)
- Creare o distruggere acqua: «…cqua. L'incantatore crea fino a 45 litri» + «d'acqua pulita in un contenitore aperto …» (uniti)
- Creazione: «…o materiali simili. Può anche utilizzare» + «questo incantesimo per creare oggetti mi…» (uniti)
- Creazione: paragrafo che finisce senza punto «…ietra o cristallo Metalli preziosi Gemme Adamantio o mithral» (lasciato così)
- Creazione: paragrafo che finisce senza punto «…Durata 1 giorno 12 ore 1 ora 10 minuti 1 minuto» (lasciato così)
- Desiderio: «…erato di un avversario, il colpo critico» + «di un nemico o un tiro salvezza fallito …» (uniti)
- Destriero fantomatico: «… equipaggiamento creato dall'incantesimo» + «svanisce in uno sbuffo di fumo se traspo…» (uniti)
- Disintegrazione: «…tro gittata. Il bersaglio può essere una» + «creatura, un oggetto o una creazione di …» (uniti)
- Dominare bestie: «… creatura completa l'ordine e non riceve» + «ulteriori indicazioni da parte dell'inca…» (uniti)
- Dominare mostri: «…urante questo periodo, l'incantatore può» + «anche fare in modo che la creatura utili…» (uniti)
- Dominare persone: «…, la durata diventa concentrazione, fino» + «a 1 ora. Quando usa uno slot incantesimo…» (uniti)
- Evoca animali: «…estie di grado di sfida pari o inferiore» + «a 1/2 • Otto bestie di grado di sfida pa…» (uniti)
- Evoca animali: paragrafo che finisce senza punto «…a 1/2 • Otto bestie di grado di sfida pari o inferiore a 1/4» (lasciato così)
- Evoca celestiale: «…ncantesimo. Si tira per l'iniziativa del» + «celestiale, che svolge i propri turni. I…» (uniti)
- Evoca creature boschive: paragrafo che finisce senza punto «… Una creatura fatata con grado di sfida pari o inferiore a 2» (lasciato così)
- Evoca creature boschive: paragrafo che finisce senza punto «… Due creature fatate con grado di sfida pari o inferiore a 1» (lasciato così)
- Evoca creature boschive: paragrafo che finisce senza punto «…ro creature fatate con grado di sfida pari o inferiore a 1/2» (lasciato così)
- Evoca creature boschive: paragrafo che finisce senza punto «…to creature fatate con grado di sfida pari o inferiore a 1/4» (lasciato così)
- Evoca elementali minori: paragrafo che finisce senza punto «…• Un elementale con grado di sfida pari o inferiore a2» (lasciato così)
- Evoca elementali minori: paragrafo che finisce senza punto «…• Due elementali con grado di sfida pari o inferiore a1» (lasciato così)
- Evoca elementali minori: paragrafo che finisce senza punto «…Quattro elementali con grado di sfida pari o inferiore a 1/2» (lasciato così)
- Evoca elementali minori: paragrafo che finisce senza punto «…• Otto elementali con grado di sfida pari o inferiore a 1/4» (lasciato così)
- Evoca folletto: «…l'ostilità su di sé e sui suoi compagni,» + «rischiando che la creatura fatata li att…» (uniti)
- Fatale: «…e superare un tiro salvezza su Saggezza,» + «altrimenti subisce 4d10 danni psichici. …» (uniti)
- Fermare il tempo: «…lcuno diverso da lui. Termina inoltre se» + «l'incantatore si muove in un luogo a più…» (uniti)
- Fondersi nella pietra: «…nerne più il corpo) provoca l'espulsione» + «dell'incantatore, infliggendogli 6d6 dan…» (uniti)
- Forma eterea: «…t superiore al 7°. Al momento del lancio» + «dell'incantesimo, le creature non devono…» (uniti)
- Giara magica: «…e l'incantatore si trova al suo interno,» + «anche la creatura muore e l'incantatore …» (uniti)
- Guarigione di massa: «…di vedere. Le creature guarite da questo» + «incantesimo vengono inoltre curate da og…» (uniti)
- Immagine maggiore: «…rande di un cubo di 6 metri. L'immagine,» + «apparendo in un punto situato entro gitt…» (uniti)
- Immagine proiettata: «… dalla presenza di ostacoli. L'illusione» + «assomiglia in tutto e per tutto all'inca…» (uniti)
- Immagine silenziosa: «…ione superando una prova di Intelligenza» + «(Indagare) contro la CD del tiro salvezz…» (uniti)
- Invocare il fulmine: «…e invece di crearne una nuova. In queste» + «condizioni, i danni provocati dall'incan…» (uniti)
- Mano arcana: «…er la mano usando le proprie statistiche» + «di gioco. Se il colpo va a segno, il ber…» (uniti)
- Miraggio arcano: «…a medesima. Un campo aperto o una strada» + «potrebbe così sembrare una palude, una c…» (uniti)
- Muro prismatico: «…i attacchi magici a distanza non possono» + «attraversare il muro. Questo strato può …» (uniti)
- Oscurità: «…tesimo. L'oscurità si diffonde oltre gli» + «angoli. Una creatura dotata di scurovisi…» (uniti)
- Palla di fuoco ritardata: «…viene interrotta, la sfera si disintegra» + «con un cupo boato in un'esplosione di fi…» (uniti)
- Parlare con i vegetali: «…ntatore può comunicarci come se entrambi» + «condividessero una lingua comune, ma non…» (uniti)
- Parola divina: paragrafo che finisce senza punto «… 1 minuto • 40 punti ferita o meno: assordata e accecata per» (lasciato così)
- Parola divina: «…punti ferita o meno: assordata, accecata» + «e stordita per 1 ora • 20 punti ferita o…» (uniti)
- Parola divina: paragrafo che finisce senza punto «…a per 1 ora • 20 punti ferita o meno: uccisa istantaneamente» (lasciato così)
- Presagio: «…tura, se l'azione fornisce risultati sia» + «positivi che negativi • Nulla, se non ci…» (uniti)
- Presagio: «…on ci sono risultati positivi o negativi» + «rilevanti…» (uniti)
- Presagio: paragrafo che finisce senza punto «…ulla, se non ci sono risultati positivi o negativi rilevanti» (lasciato così)
- Randello incantato: «…n un d8. Se già non lo è, l'arma diventa» + «magica. L'incantesimo termina se l'incan…» (uniti)
- Reincarnazione: «…lternativa, la può scegliere lui stesso.» + «d100 01–04 05–13 14–21 22–25 26–29 30–35…» (uniti)
- Reincarnazione: paragrafo che finisce senza punto «…26–29 30–35 36–43 44–51 52–55 56–59 60–68 69–76 77–80 81–100» (lasciato così)
- Reincarnazione: paragrafo che finisce senza punto «…zzorco Nano delle colline Nano delle montagne Tiefling Umano» (lasciato così)
- Ristorare superiore: «…e di uno il livello di indebolimento del» + «bersaglio o porre fine a uno dei seguent…» (uniti)
- Ristorare superiore: paragrafo che finisce senza punto «…• Un effetto che ha affascinato o pietrificato il bersaglio» (lasciato così)
- Ristorare superiore: paragrafo che finisce senza punto «…sa la sintonia del bersaglio con un oggetto magico maledetto» (lasciato così)
- Ristorare superiore: paragrafo che finisce senza punto «…si riduzione di un punteggio di caratteristica del bersaglio» (lasciato così)
- Ritirata rapida: «…na velocità straordinaria. Quando lancia» + «questo incantesimo e poi come azione bon…» (uniti)
- Santificare: «…divinità o un capo specifico, oppure per» + «quelle appartenenti a un tipo specifico,…» (uniti)
- Santuario: «… Se lo fallisce, deve scegliere un nuovo» + «bersaglio o perdere l'attacco o l'incant…» (uniti)
- Scolpire pietra: «…dola nella forma che desidera. Potrebbe,» + «per esempio, modellare una grossa roccia…» (uniti)
- Scopri trappole: «… a tali fini dal suo creatore. Pertanto,» + «l'incantesimo è in grado di individuare …» (uniti)
- Scrutare: paragrafo che finisce senza punto «…Modificatore al tiro salvezza» (lasciato così)
- Scrutare: paragrafo che finisce senza punto «…+5» (lasciato così)
- Scrutare: paragrafo che finisce senza punto «…+0» (lasciato così)
- Scrutare: paragrafo che finisce senza punto «…-5» (lasciato così)
- Scrutare: paragrafo che finisce senza punto «…Modificatore al tiro salvezza» (lasciato così)
- Scrutare: paragrafo che finisce senza punto «…-2 -4 -10» (lasciato così)
- Sogno: «…essaggero può anche modellare l'ambiente» + «del sogno, creando paesaggi, oggetti e a…» (uniti)
- Spostamento planare: «…cciaio, davanti alla Porta delle Ceneri,» + «oppure nei pressi della città ma dalla p…» (uniti)
- Suggestione: «… La suggestione deve essere formulata in» + «modo che il corso d'azione appaia ragion…» (uniti)
- Teletrasporto: paragrafo che finisce senza punto «…casionalmente Visto una volta Descrizione Falsa destinazione» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…Errore —» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…01–05 01–33» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…01–43 01–43 01–50» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…Area simile» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…06–13 34–43» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…44–53 44–53 51–100» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…Fuori bersaglio» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…14–24 44–53» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…54–73 54–73» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…Sul bersaglio 01–100» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…01–100» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…25–100 54–100» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…74–100 74–100» (lasciato così)
- Teletrasporto: paragrafo che finisce senza punto «…—» (lasciato così)
- Terreno illusorio: «…strutture artificiali, l'equipaggiamento» + «e le creature all'interno dell'area non …» (uniti)
- Trasformazione: «… abilità e competenze nei tiri salvezza,» + «oltre a ottenere quelle della creatura. …» (uniti)
- Trova cavalcatura: «…come cavalcature.) La cavalcatura usa le» + «statistiche della forma scelta, anche se…» (uniti)
- Trova famiglio: «…e nel proprio turno. Un famiglio non può» + «attaccare, ma può effettuare altre azion…» (uniti)
- Trucco della corda: «…lla corda, si apre un'entrata invisibile» + «verso uno spazio extradimensionale che p…» (uniti)
- Vigilanza e interdizione: «…ocare una folata di vento costante in un» + «corridoio o in una stanza. • Collocare l…» (uniti)
- Vigilanza e interdizione: «…ocare luci danzanti in quattro corridoi,» + «specificando anche un semplice schema ch…» (uniti)
