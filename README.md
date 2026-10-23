# Session Forge

Strumento per **pianificare e giocare una sessione di Dungeons & Dragons 5e**, in italiano: mappe di
qualsiasi dimensione con sfondo e tile, personaggi, creature nel formato del Manuale dei Mostri, librerie di
incantesimi, strutture, attrezzatura e oggetti di mappa, combattimento con griglia e dadi.
È fatto solo di HTML, CSS e JavaScript: nessuna installazione, nessuna dipendenza, funziona offline.

Il nome dell'app si cambia in un solo punto, la costante `APP_NAME` in `js/config.js` (titolo,
intestazione e nomi dei file esportati). Solo `manifest.json` va aggiornato a mano, perché è un
file JSON statico e non può leggere quella costante.

## Avvio

**Modo più semplice:** fai doppio clic su `index.html`. Si apre nel browser e funziona tutto,
tranne l'installazione come app (vedi sotto).

**Come app in una finestra dedicata (PWA):** il browser permette di installarla solo se viene
servita da `http://localhost`. Da questa cartella esegui:

```
python -m http.server 8080
```

poi apri `http://localhost:8080` in Chrome o Edge e clicca l'icona **Installa** nella barra
degli indirizzi (oppure menu ⋮ → *Installa Session Forge*). L'app installata funziona anche
offline; dopo ogni aggiornamento dei file conviene riavviare il server una volta.

> Attenzione: i dati sono salvati **per indirizzo**. `file://…/index.html` e
> `http://localhost:8080` hanno archivi separati. Per spostarli usa *Esporta* / *Importa*.

## Sessioni

In cima alla barra laterale c'è il selettore **Sessione corrente**, con i pulsanti **+**
(nuova sessione vuota), **✎** (nome, descrizione e note del master), **⧉** (duplica) e **🗑**
(elimina, deve restarne almeno una).

- Una sessione contiene: nome, descrizione, note del master, i suoi **nemici** (Standard e Creature),
  **giocatori** e **griglie**, il **combattimento in corso** con il suo log (e la bozza dell'editor griglie) e
  l'**esplorazione in corso** (gruppo, tempo, scorte, variabili, registro).
- **Razze, Magie, Strutture, Attrezzatura, Oggetti di mappa, TileSet, Biomi ed Eventi** sono librerie globali,
  uguali in tutte le sessioni.
- Nemici, giocatori e griglie si vedono solo nella loro sessione, a meno di spuntare
  **Condividi con tutte le sessioni** (nel form del personaggio o nella scheda della griglia):
  così diventano modelli riutilizzabili ovunque.
- Duplicando una sessione si copiano i suoi personaggi e le sue griglie (quelli condivisi no,
  restano unici); eliminandola spariscono i suoi elementi non condivisi.
- Combattimento ed Editor griglie lavorano sempre nella sessione corrente. Se la sessione non ha
  ancora personaggi o griglie compare una schermata con i pulsanti rapidi (*Aggiungi nemici*,
  *Crea una griglia*…).

I dati delle versioni precedenti finiscono automaticamente nella **Sessione predefinita**.

## Navigazione

| Gruppo     | Voce             | Scorciatoia |
|------------|------------------|-------------|
| Mappa      | Editor griglie   | Alt+1 |
|            | Combattimento    | Alt+2 |
|            | Esplorazione     | Alt+3 |
| Personaggi | Nemici (Standard, Creature, Boss) | Alt+4 |
|            | Giocatori        | Alt+5 |
| Libreria   | Magie            | Alt+6 |
|            | Asset (Strutture, Oggetti, Biomi, Eventi) | Alt+7 |
|            | Razze            | Alt+8 |
| Strumenti  | Dadi             | Alt+9 |

- Nel menù ci si sposta anche con le frecce su/giù (Home/Fine) e si apre con Invio.
- La barra laterale si chiude e si riapre con « o **Ctrl+B**: da chiusa mostra solo le icone (il
  nome compare passandoci sopra). Lo stato viene ricordato e sugli schermi stretti parte chiusa.
  Lo stesso vale per il pannello laterale della griglia (◧ o **Ctrl+Alt+B**).
- **Alt+M** accende o spegne tutti i suoni (vedi [Effetti sonori](#effetti-sonori)).
- All'avvio si riapre l'ultima sezione usata.

## Impostazioni e tema

In fondo alla barra laterale: l'**ingranaggio** apre il pannello delle impostazioni, il
pulsante **sole/luna** cambia tema con un clic e l'**altoparlante** accende o spegne i suoni (l'icona mostra
sempre lo stato; anche Alt+M).

- **Tema**: Chiaro, Scuro o Automatico (come il sistema). Al primo avvio si segue il sistema;
  dopo una scelta, quella ha la precedenza. Il tema viene applicato prima che la pagina venga
  disegnata, quindi non c'è il lampo del tema sbagliato.
- **Dimensione del testo**: piccola, normale, grande. **Riduci animazioni**: sì/no.
- **Esporta archivio**, **Esporta sessione corrente**, **Importa** (riconosce da solo se il file
  è un archivio completo o una singola sessione) e **Cancella tutti i dati** (doppia conferma;
  le impostazioni di visualizzazione restano).

- **Effetti boss**: barra della vita in alto, ombra ai lati dello schermo e animazioni dei boss nel
  combattimento (attivi di base). Spenti, i boss funzionano comunque (fasi, log, azioni). Spengono anche i suoni
  di Boss e Leggendario.
- **Movimento** (diagonali, modalità senza velocità), **Dadi animati** e **Suoni**: gruppi a scomparsa, descritti
  in [Velocità e movimento](#velocità-e-movimento), [Dadi animati](#dadi-animati) ed [Effetti sonori](#effetti-sonori).

Tutti i colori dell'interfaccia sono variabili CSS (`:root` per il tema chiaro,
`[data-theme="dark"]` per lo scuro), anche quelli della griglia, che si ridisegna al cambio tema.
Le pedine usano la **palette di 14 colori** (vedi [Colori](#colori)) con un doppio bordo di contrasto
calcolato dal colore, leggibile su entrambi gli sfondi; strutture e oggetti con colore libero non cambiano.

## Sezioni

- **Editor griglie** – costruisci le mappe della sessione prima di giocare. L'elenco mostra miniatura,
  tipo, dimensione e data dell'ultima modifica (apri, rinomina, duplica, elimina, condividi). Ogni griglia è
  di tipo **Battaglia** (come sempre; le griglie esistenti restano così) o **Esplorazione** (vedi
  [Esplorazione](#esplorazione)), scelto in *Nuova griglia* e in *Proprietà*.
  - **+ Nuova griglia** apre una finestra con nome, **larghezza e altezza in celle** (da 5 a 100 per lato,
    di base 50×50), **piedi per cella** (di base 5) e **sfondo**: nessuno, colore tinta unita oppure
    **immagine importata** (PNG, JPEG, WebP, salvata in IndexedDB) con adattamento *Adatta alla griglia*
    (stira), *Copri* (mantiene le proporzioni e ritaglia) o *Dimensione originale*, posizione, scala,
    opacità e *Rimuovi sfondo*. **Calibra dalla mappa**: per una mappa già quadrettata indichi quanti pixel
    misura una cella e la griglia calcola da sola larghezza e altezza (e, se vuoi, adatta lo sfondo alle celle).
  - **⚙ Proprietà** cambia dimensione, piedi per cella e sfondo anche dopo la creazione. Riducendo la griglia
    gli elementi che escono dall'area vengono elencati e tolti solo dopo la conferma; ingrandendo (o riducendo)
    scegli se le colonne si aggiungono a destra o a sinistra e le righe in basso o in alto.
  - Strumenti della griglia: *Seleziona/Sposta*, *Inserisci struttura* e *Inserisci oggetto* (scegli il
    modello nel pannello e clicca sulla griglia), *Gomma*, *Riempi area* (trascina un rettangolo con la
    struttura scelta), *Zona giocatori* / *Zona nemici* (zone di partenza), *Etichetta* e *Misura distanza*.
    Rotazione, specchio, duplicazione, Canc e annulla/ripeti come nel combattimento. Dal pannello laterale si
    trascinano strutture, **oggetti di mappa** e voci dell'**Attrezzatura** (diventano «oggetti a terra»).
    Doppio clic su un oggetto di mappa = pannello di interazione (vedi *Asset*).
  - Sotto la griglia c'è il **pannello Tile** (vedi [Tile](#tile)), con cui si dipinge la TileMap
    direttamente sulla griglia.
  - Ogni modifica viene conservata in una bozza: **Salva** la scrive nella griglia, e uscendo con modifiche
    non salvate compare un avviso. Gli elementi che vengono da modelli poi eliminati compaiono come
    segnaposto grigio con un avviso.
- **Combattimento**
  1. *Setup*: spunta i giocatori, indica quante copie di ogni nemico vuoi, **Standard** o **Creature**
     (4 goblin diventano Goblin 1…4, ognuno con i propri PF), e scegli la **griglia di partenza**.
  2. *Iniziativa*: d20 + modificatore di DES tirati in automatico, modificabili a mano.
  3. *Turni*: **Prossimo turno** scorre l'ordine, salta chi è a terra e conta i round.
     Ogni scheda ha **Attacca** (bersaglio con la distanza tra le celle più vicine, arma,
     normale/vantaggio/svantaggio; 20 naturale = critico con dadi raddoppiati, 1 naturale = fallimento
     automatico), **Cura**, **Tiro salvezza**, **✨ Lancia incantesimo**, **Modifica** e **Rimuovi**. A 0 PF un
     combattente è *a terra*: resta visibile in grigio e viene saltato nei turni.
  4. **Creature**: le azioni della scheda sono pulsanti. Clic = scegli il bersaglio (dal menù o sulla griglia)
     e l'app tira attacco o salvezza e i danni, con critico, 1 naturale e vantaggio/svantaggio. Il
     **Multiattacco** esegue in sequenza le azioni previste, ognuna con il proprio bersaglio e il proprio
     risultato nel log. All'inizio del turno della creatura si tira il d6 di **Ricarica** e si ripristinano i
     punti delle **azioni leggendarie** (eseguibili alla fine del turno di un altro combattente); gli **usi
     giornalieri** sono contati; **Resistenza leggendaria → Usa** trasforma l'ultimo tiro salvezza fallito in
     riuscito (restituendo i PF di differenza). Le **azioni di tana** compaiono come promemoria a iniziativa 20.
     Gli **incantesimi innati** si lanciano con il sistema Magie senza consumare slot.
  5. **Difese ai danni**: per ogni combattente (creature, ma anche le resistenze della razza dei personaggi)
     si applicano vulnerabilità (×2), resistenze (÷2 per difetto) e immunità (0), con la nota nel log
     (es. «resistenza al fuoco: 14 → 7»). Le difese «da attacchi non magici» non valgono per gli incantesimi
     e per le armi con bonus magico.
  6. Il log registra ogni azione. **Termina combattimento** chiede conferma.

  Il combattimento usa una **copia** della griglia, sfondo compreso (*Salva come nuova griglia* e *Aggiorna
  la griglia originale* sono nella barra della griglia). I combattenti senza posizione vengono disposti
  nelle zone di partenza; chi non ci entra viene segnalato e resta da trascinare. Con il menu contestuale di
  una pedina (doppio clic) si cambia la **dimensione** di quella sola pedina, senza toccare il modello: se con
  il nuovo ingombro non entra dov'è, compare un avviso.

  **Disposizione su tre colonne**: a sinistra le **entità** (schede dei combattenti, scorrevoli), al centro la
  **griglia** con la sua barra strumenti e il pannello Combattenti/Strutture/Oggetti di mappa, a destra i
  **turni** (round, turno corrente, *Prossimo turno*, iniziativa, combattimento simulato e log che occupa lo
  spazio restante, più il pulsante 🎲 Dadi). Le colonne laterali (340 e 300 px di base) si allargano trascinando
  il divisore o con le frecce (da 240 px al 40% del layout) e si richiudono con « / »; la griglia si adatta senza
  perdere zoom e posizione. Larghezze e colonne aperte sono ricordate; **Reimposta layout** torna ai valori di
  base. Sotto i 1100 px di larghezza la griglia sta in alto e sotto ci sono le schede *Entità* e *Turni*. Barre
  e ombra dei boss restano sull'area della griglia; il pannello Note si apre sopra la colonna dei turni.
  Preferenze e limiti sono in `js/layout-combattimento.js`.

  **Griglia di battaglia**: coordinate sui bordi (colonne
  A–Z, AA–AZ… fino a CV per 100 colonne, righe 1–100); rotella = zoom, trascina lo sfondo (o tasto centrale)
  = sposta la vista. Le pedine occupano il loro **ingombro w×h** ancorato alla cella in alto a sinistra:
  trascinamento, collisioni, selezione, barra della vita, contorno del turno e scelta del bersaglio usano
  tutto l'ingombro; le forme si adattano (il cerchio diventa un'ellisse), immagini e icone della libreria si
  adattano senza deformarsi, con il bordo colorato. Due pedine non si sovrappongono; strutture, porte chiuse,
  oggetti che bloccano e tile *Bloccanti* fermano le pedine salvo *Ignora collisioni*. **Ctrl+Z / Ctrl+Y** per
  le ultime 50 azioni. **📏 Misura distanza** mostra caselle, piedi e metri (diagonale = 5 ft).
- **Nemici** – tre schede:
  - **Standard**: razza, livello, classe (le 12 della 5e o *Personalizzata*), caratteristiche con
    **Randomizza**, **punti caratteristica**, PF manuali o automatici, CA automatica o manuale, tiri salvezza,
    **incantesimi**, armi, icona, **dimensione sulla griglia**, note e **Condividi con tutte le sessioni**.
    **🎲 Genera nemico** crea nemici da razza, livello e classe (come prima).
  - **Creature**: schede nel formato del Manuale dei Mostri (vedi sotto).
  - **👑 Boss**: creature con presentazione, tema visivo e fasi (vedi [Boss](#boss)).
  - Elenco con ricerca, badge del tipo, duplica, elimina, **esporta/importa JSON** di una singola creatura.
- **Giocatori** – stessa scheda dei nemici Standard, con il nome del giocatore reale e l'**Inventario**:
  oggetti del catalogo con quantità e casella *equipaggiato*, monete (mr, ma, me, mo, mp) e peso totale
  (50 monete = 0,5 kg). Due schede: **Standard** e **✦ Leggendari** (livelli 20-40, vedi
  [Personaggi leggendari](#personaggi-leggendari)).
- **Magie** – libreria degli incantesimi (come prima).
- **Asset** – quattro schede (Biomi ed Eventi: vedi [Esplorazione](#esplorazione)):
  - **Strutture**: forma predefinita (fino a 20×20), forma personalizzata a celle (fino a 10×10) oppure
    **Da immagine** (vedi [Tile](#tile)), colore libero.
  - **Oggetti**, con due sotto-schede:
    - **Attrezzatura**: catalogo degli oggetti di gioco (Armi, Armature, Scudi, Equipaggiamento d'avventura,
      Strumenti, Consumabili, Oggetti magici, Tesori e gemme, Altro) con nome, descrizione, peso, costo e
      valuta, rarità, sintonia, icona e tag; per le **armi** categoria, mischia/distanza, dado e tipo di danno,
      dado versatile, proprietà, gittata e bonus magico; per **armature e scudi** tipo, CA base, effetto della
      DES (intera, massimo +2, nessuna), Forza minima, svantaggio a Furtività e bonus magico. È precaricato
      con le armi e le armature base (`js/attrezzatura.js`, solo valori, nessuna descrizione), tutto
      modificabile. Nei form di nemici Standard e giocatori le **armi** si scelgono dal catalogo (con
      *Calcola*: bonus per colpire e danno da competenza, modificatore — FOR, o DES per le armi accurate e a
      distanza — e bonus magico; senza, sovrascrivibili a mano) e la **CA automatica** usa armatura e scudo
      scelti. Le armi scritte a mano restano valide.
    - **Oggetti di mappa** (forzieri, porte, leve, trappole, barili, altari…): tipo, aspetto (icona della
      libreria, immagine, forma o tile da immagine, 1×1 di base), *Contenitore*, *Interagibile*, *Nascosto
      (solo master)* — sulla griglia è semitrasparente con l'occhio barrato — e *Blocca il movimento*; stato
      chiuso/aperto (una **porta chiusa blocca**, aperta no); serratura (CD per scassinare, CD Forza per
      sfondare, chiave richiesta); trappola (CD per individuarla e disinnescarla, danno diretto o tiro
      salvezza, una volta o più); contenuto (oggetti del catalogo e monete). Sono **modelli**: ogni copia
      piazzata ha stato e contenuto propri. Doppio clic su una copia sulla griglia: *Apri/Chiudi*,
      *Scassina*, *Sfonda*, *Cerca/Disinnesca/Attiva trappola*, *Rivela/Nascondi*, contenuto con *Prendi* e
      *Prendi tutto* verso l'inventario di un giocatore. Nel combattimento tutto va nel log e i danni delle
      trappole si applicano al bersaglio.
- **Razze** – nome, taglia (dà la dimensione automatica sulla griglia), velocità, bonus, scurovisione,
  resistenze (usate anche come difese ai danni nel combattimento), linguaggi, competenze.
- **Dadi** – come prima.

### Dimensione sulla griglia

Giocatori, nemici Standard e Creature hanno **Dimensione sulla griglia**: *Automatica* (dalla taglia della
razza o della creatura: Minuscola, Piccola, Media = 1×1; Grande = 2×2; Enorme = 3×3; Mastodontica = 4×4)
oppure larghezza × altezza a scelta, da 1 a 8 celle per lato (preset 1×1…5×5, anche rettangolare, es. 2×4).
Le distanze tra combattenti si misurano tra le celle più vicine delle due pedine.

### Colori

Pedine e icone della libreria usano una palette di **14 colori** definita in un solo file (`js/colori.js`, nome
italiano ed esadecimale): verde, blu, rosso, grigio, arancione, giallo, viola, rosa, azzurro, turchese, marrone,
nero, bianco, oro. Il selettore è una griglia di pallini con il nome nel tooltip; le immagini caricate usano il
colore come bordo. Bordo e contorno di contrasto sono automatici (chiaro sui colori scuri, scuro sui chiari);
sui colori scuri anche il fondo delle icone e i loro dettagli si invertono. I 4 colori precedenti hanno gli
stessi valori, quindi i dati esistenti restano validi. Gli oggetti mantengono il colore libero.

### Icone

Il selettore dell'icona ha tre schede: **Forma** (geometrica), **Libreria** (icone predefinite con ricerca e
filtro per categoria) e **Immagine** (dal computer). La libreria (`js/libreria-icone.js`) contiene 82 silhouette
originali e generiche per le pedine e 17 icone per gli oggetti con colore libero, tutte SVG inline. Categorie
delle pedine: Umanoidi, Bestie, Mostri, **Draghi** (alato in volo, a figura intera, testa, viverna, serpentino,
cucciolo), **Dinosauri** (tirannosauro, raptor, triceratopo, pterodattilo, brontosauro, stegosauro, uovo),
**Demoni** (con corna e ali, con tridente, diavoletto, demone-bestia, signore degli abissi, teschio con corna,
cane infernale), **Aberrazioni** (sfera con occhi su stelo, massa di tentacoli, divoratore di cervelli, melma
con occhi) ed **Elementali** (fuoco, acqua, terra, aria); tra i mostri anche idra, chimera, grifone, basilisco,
scorpione e verme giganti, gigante, lich, vampiro, licantropo, albero antico e forziere con denti. Le icone
usano `currentColor`: un solo disegno, ricolorato e convertito in ImageBitmap per colore, con cache.
Le icone di creature grandi propongono una **dimensione sulla griglia** (es. drago 3×3, brontosauro 4×4):
scegliendole, la dimensione passa a quella suggerita, sempre modificabile.

### Creature (Manuale dei Mostri)

Scheda: nome, taglia, tipo e sottotipo, allineamento, CA con descrizione, **PF dai dadi vita** della taglia
(Minuscola d4, Piccola d6, Media d8, Grande d10, Enorme d12, Mastodontica d20: es. «45 (6d10 + 12)»,
sovrascrivibili), velocità (a piedi, scavare, scalare, volare con *fluttuare*, nuotare), caratteristiche,
tiri salvezza e abilità (competenza o maestria), vulnerabilità/resistenze/immunità ai 13 tipi di danno e ai
danni fisici non magici, immunità alle condizioni, sensi e Percezione passiva, linguaggi, **grado di sfida**
(competenza e PE calcolati), icona, dimensione sulla griglia e note. Tratti, Azioni, Azioni bonus, Reazioni,
Azioni leggendarie (con costo, punti per round e Resistenza leggendaria) e Azioni di tana hanno un **editor
meccanico**: Attacco (mischia/distanza, bonus suggerito = competenza + modificatore, portata o gittata,
bersagli, più danni), Tiro salvezza (CD suggerita = 8 + competenza + modificatore, area, effetto, metà
danni), Cura, Multiattacco (es. 1 morso + 2 artigli) o Solo testo, con frequenza (a volontà, N al giorno,
Ricarica 5–6/4–6/6, dopo un riposo). Il testo viene generato in italiano nello stile del manuale e resta
modificabile a mano. **Incantesimi innati** dalla libreria Magie con frequenza, caratteristica, CD e attacco.
**Scheda** mostra la vista di sola lettura nell'ordine del manuale, stampabile. **📊 Stima CS** applica la
procedura della Guida del Dungeon Master (CS difensivo da PF effettivi e CA, offensivo da danni per round e
bonus per colpire o CD, media dei due) e mostra il risultato accanto al CS dichiarato, senza cambiarlo.
Tre creature d'esempio **originali** (una bestia GS 1, un costrutto GS 5, un drago giovane GS 8) sono
condivise con tutte le sessioni, modificabili ed eliminabili.

## Boss

Un **boss** è una creatura del Manuale dei Mostri (stessa scheda, stessi calcoli, azioni leggendarie e di tana)
con in più presentazione e fasi. Si crea da **+ Nuovo boss** oppure con **⇧ Promuovi a boss…**, partendo da una
creatura o da un nemico standard (caratteristiche finali, PF, CA e armi diventano una scheda del Manuale, con un
multiattacco se ci sono più armi); l'originale resta invariato.

- **Campi aggiuntivi**: titolo, epiteto, introduzione per il master, **tema visivo** (Infernale – predefinito,
  Gelo, Veleno, Arcano, Ossa, Sangue, Oscuro, Divino: colore d'accento, ombra, cornice e motivo; se ne aggiungono altri in `THEMES` di
  `js/boss.js`), **fasi** (fino a 6: soglia in % dei PF, nome, nota per il master, effetto nessuno/lampo/
  tremolio, temperamento facoltativo, azioni della scheda abilitate o disabilitate), **PF × numero di giocatori**
  (spento di base) e **aura** sulla griglia (0–10 celle).
- **Forgia** (interfaccia di creazione): un'area sempre scura anche con il tema chiaro, ombra del tema ai bordi,
  grana e linee tecniche, cerchi di rune, cornice ornata con **spade infilate nel bordo** (SVG inline,
  impugnatura fuori e lama dentro, simmetriche ai lati del titolo e inclinate sui fianchi), angoli decorati e
  divisori. Titolo maiuscolo con riflesso di luce, pulsante **Evoca il boss** con bagliore. Anteprima viva a
  destra: barra della vita con i segni delle fasi e pedina con aura e corona. Salvando un boss nuovo parte
  l'**evocazione** (lampo, tremolio della cornice, nome con effetto d'impatto), saltabile con un clic o Esc.
- **Fasi**: si passa alla fase quando i PF scendono **sotto** la soglia; un solo colpo può attraversarne più di
  una (tutte finiscono nel log). Le fasi **non tornano indietro**: curandosi sopra una soglia il boss resta nella
  fase raggiunta e gli effetti non si ripetono. Le azioni che una fase «abilita» sono bloccate prima di quella
  fase; il temperamento della fase sostituisce quello della scheda (anche per il combattimento simulato).
- **Nel combattimento**: **barra della vita in alto** al centro (nome, titolo, fase, PF, segni delle soglie,
  colore del tema e parte appena persa che si svuota con ritardo); più boss = barre impilate, massimo 3, le
  altre in un menu. **Ombra ai lati dello schermo** finché c'è un boss vivo, più intensa a ogni fase (sopra la
  griglia, sotto i pannelli, non intercetta i clic). Al cambio di fase: banner «FASE 2 — nome», lampo o
  tremolio e nota del master nel log; alla sconfitta: banner finale e l'ombra svanisce. Sulla griglia la pedina
  ha l'alone del tema, l'aura e la corona. Le azioni della fase non disponibili sono disattivate (anche per
  l'IA).
- **Vista del master**: barre ed effetti sono per il master; ogni boss ha **👁 Rivela boss / Nascondi ai
  giocatori** e la barra indica «nascosto ai giocatori». La funzione `DnD.boss.bars(…, 'giocatori')` mostra solo i
  boss rivelati, pronta per una futura vista giocatori (l'app oggi ha solo la vista del master).
- **Impostazioni**: *Effetti boss* spegne barra in alto, ombra e animazioni; con *Riduci animazioni* tutto resta
  statico e leggibile (niente lampi, tremolii né evocazione).
- Componenti riusabili in `js/ui-boss.js` (cornice, spada, barra, vignettatura, banner, forgia) e stile in
  `css/boss.css`, guidati da variabili CSS del tema (`--boss-accent`, `--boss-glow`, `--boss-shadow`,
  `--boss-frame`, `--boss-bg`): la funzione è pensata per crescere.
- **Esempio**: *Skarnoth, La Fornace che Cammina* (originale, GS 12, tema Infernale): 3 fasi con cambio di
  temperamento e un'azione sbloccata nell'ultima, azioni leggendarie, Resistenza leggendaria e tana.

## Personaggi leggendari

Giocatori oltre il ventesimo livello, nella scheda **Giocatori › ✦ Leggendari**. Un leggendario è un giocatore
completo (razza, classe, caratteristiche, PF, CA, tiri salvezza, armi, inventario, incantesimi, controllo
manuale o IA) con in più il **Percorso leggendario** e le **Trasformazioni**. Si crea da **✦ Nuovo leggendario**
oppure con **✦ Eleva a leggendario** dalla scheda Standard (serve il livello 20). **Declassa** lo riporta a
giocatore standard (livello massimo 20) dopo una conferma, conservando percorso e trasformazioni per una nuova
promozione. Condivisione tra sessioni, duplicazione ed esporta/importa come gli altri giocatori. Salvando un
leggendario nuovo parte l'**Ascensione** (colonna di luce, ali, comparsa del nome), saltabile con un clic o Esc.

- **Livelli 20-40**: rango leggendario = livello − 20. Bonus di competenza = 1 + ⌈livello/4⌉ (+6 al 20, fino a +11
  dal 37), sovrascrivibile. Punti caratteristica: 2 a ogni livello multiplo di 4, fino a 20 al livello 40. Tetto
  delle caratteristiche 30 (modificabile, con «ignora limite»). PF: dado vita della classe per ogni livello oltre
  il 20, con le solite regole. Slot: tabella del livello 20, più gli slot dei nodi e la sovrascrittura a mano.
- **Scheda**: riepilogo con caratteristiche, CA, PF, competenza, CD e slot, abilità con competenza o maestria,
  Percezione passiva, sensi, magie «N al giorno» con gli usi rimasti e l'elenco degli effetti con «da: nodo».

### Percorso leggendario

Una mappa di nodi collegati (albero di abilità a grafo) con al centro il **Nucleo**, sempre sbloccato.
**Punti percorso**: 1 per rango leggendario (massimo 20) più i bonus del master.

- **Nodo**: nome, icona e colore, descrizione, costo (1-5 punti), rango minimo, categoria, «esclusivo con» un
  altro nodo (scelta tra due rami) e uno o più **effetti**: bonus a una caratteristica (tetto 30); competenza in
  un tiro salvezza, in un'abilità (anche maestria) o in strumenti/armi/armature (testo); bonus numerici (PF
  massimi, CA, velocità, iniziativa, attacco e danno, CD e attacco degli incantesimi, competenza, resistenze,
  immunità, sensi); nuove magie dalla libreria (anche fuori dalla lista di classe: sempre preparate o «N al
  giorno») e slot extra; **privilegi creati dall'utente** (passivo, azione, azione bonus, reazione, con usi e lo
  stesso editor meccanico delle azioni delle creature); «Sblocca trasformazione»; solo testo.
- **Gli effetti entrano nei calcoli** in automatico e si tolgono al rimborso: caratteristiche (con i PF che
  seguono il modificatore di COS: +1 PF per livello per ogni punto), CA, PF, tiri salvezza, competenza, CD,
  slot, difese, attacco e danno delle armi, velocità e iniziativa nel combattimento. Le **abilità** con
  competenza (×1) o maestria (×2) valgono nelle prove degli eventi dell'esplorazione e nella Percezione passiva. Le
  magie **«N al giorno»** si lanciano senza slot (anche da chi non ha una classe da incantatore: con la migliore
  tra INT, SAG e CAR); gli usi spesi restano sulla scheda e tornano con il riposo lungo (le opzioni del master
  hanno *Riposo breve* e *Riposo lungo*). I **sensi** compaiono nella scheda e nel combattimento: l'app non ha regole
  di luce e vista a cui applicarli. Le competenze in strumenti, armi e armature sono testo (non c'è un calcolo
  che le usi).
- **Modalità Sblocca** (gioco): i nodi raggiungibili e acquistabili pulsano, quelli bloccati sono spenti, quelli
  acquisiti sono illuminati con le linee attive. Clic su un nodo = dettagli e «Sblocca» con conferma e una luce
  che corre lungo la linea. **Rimodella** ripristina i punti (il master può bloccarla).
- **Modalità Modifica** (editor su canvas): zoom e pan, nodi trascinabili, aggiungi, collega trascinando,
  scollega, elimina, duplica, Maiusc+trascina per selezionare più nodi, griglia, **raggiera** automatica attorno
  al Nucleo (ogni ramo nel suo spicchio), ricerca, annulla/ripeti (50 azioni) e pannello del nodo con l'editor
  degli effetti. Avvisi per nodi irraggiungibili e cicli di esclusività.
- **Modelli di percorso** (libreria comune a tutte le sessioni): salva, carica su un altro leggendario, elimina;
  esporta e importa il JSON di un singolo percorso. Esempio originale: **Ascesa dell'Eterno** (13 nodi).
- Riferimenti mancanti (incantesimo o trasformazione eliminati): avviso e effetto disattivato, senza errori.

### Trasformazioni

Una forma da **creatura boss** (angelica, demoniaca, draconica…) in cui il giocatore entra in combattimento.

- **Campi**: nome, epiteto, scheda boss completa (stesso editor di Creature e Boss, con «Parti da una creatura
  esistente»), **regole di fusione** (FOR, DES, COS dalla forma e INT, SAG, CAR dal personaggio; mantiene o perde
  competenze, incantesimi, equipaggiamento, privilegi e difese), **PF** che sostituiscono quelli del personaggio
  (al ritorno il danno in eccesso passa al personaggio) o PF temporanei, usi per riposo breve o lungo, durata in
  round o minuti, azione o azione bonus, fine anticipata, rango minimo o nodo del percorso che la sblocca, icona e
  dimensione sulla griglia, testi di entrata e uscita, **tema** della forma (quello del personaggio, uno dei temi
  ✦ o un tema del Boss). Aggiungi, duplica, ordina, elimina.
- **In combattimento**: **🜂 Trasformati** (se disponibile; gli usi si scalano e finiscono nel log) e **↩ Torna
  normale**, con annulla. In forma la scheda è quella del boss (azioni a pulsanti, multiattacco, ricarica, azioni
  leggendarie, fasi sotto le soglie di PF), con **barra in alto** (nome del giocatore + forma), vignettatura ed
  effetti di fase come per i boss. Fine automatica a fine durata o a 0 PF della forma, con riepilogo nel log.

### Grafica divina

Lo stesso sistema a temi del Boss (le palette stanno in `PALETTES` di `js/leggendario.js`, usate da
`js/ui-boss.js` con la chiave `lg:<id>`), con cinque temi: **Divino** (oro e luce, raggi), **Angelico** (bianco e
azzurro, nuvole e piume), **Abissale** (viola e nero, vortice), **Draconico** (oro e rosso, braci e scaglie),
**Cosmico** (indaco, stelle e nebulosa). Area sempre scura con vignettatura dorata e bianca, raggi di luce, polvere
luminosa, sigilli con rune, ali e aureola in SVG, **lance di luce** al posto delle spade, cornici con filigrana e
angoli luminosi, divisori sacri, percorso su sfondo cosmico con nodi a gemma e il Nucleo come sole. Nel
combattimento la scheda del leggendario ha una cornice più ricca (angoli dorati, aureola sopra il bordo) e la
pedina ha alone e aureola; in forma valgono il tema della trasformazione e due ali ai lati della pedina. Colori
solo da variabili CSS (`--lg-*`), contrasto buono in entrambi i temi dell'app; con *Riduci animazioni* tutto resta
fermo e leggibile (niente Ascensione né lampo), con *Effetti boss* spenti niente lampo di trasformazione.

## Esplorazione

Una mappa di esplorazione è una griglia dell'Editor con tipo **Esplorazione**: stessi strumenti (sfondo,
TileMap, strutture, oggetti, fino a 100×100) più **scala** (di base 1 cella = 1,5 km; preset 5 piedi, 100 m,
1 km, 6 miglia o valore libero, anche per il misuratore) e il pannello **Mappa di esplorazione** con gli
strumenti Biomi, Eventi e Nebbia. Si gioca dalla voce di menù **Esplorazione**.

### Biomi (Asset › Biomi)

Un bioma è un tipo di terreno con regole: colore di sovrapposizione, icona, TileSet preferiti, descrizione;
**costo di movimento** per cella (1, 2, 3 o impraticabile) con eccezioni per modalità di viaggio (a piedi, a
cavallo, nave, volo); **ore per cella** a passo normale (per 1,5 km, adattate alla scala) con il ritmo
*lento* (×1,5 ore, +2 alle prove di scoperta), *normale* o *veloce* (×0,75 ore, −5); **raggio di scoperta** e
**luce**; **pericoli ambientali** (ogni N ore o alla prima entrata; prova di caratteristica o abilità, anche
tiro salvezza, con CD; se si fallisce: danno con dado e tipo, livelli di sfinimento, condizione o perdita di
scorte); **scorte** di cibo e acqua per persona al giorno; **incontri casuali** (probabilità d100 per ora o per
cella; tabella pesata di creature con quantità e intervallo di GS, oppure eventi della libreria); **meteo**
possibile con pesi ed effetti su visibilità e CD (si tira ogni 8 ore). Un **sottobioma** eredita da un altro
bioma le sezioni lasciate su «Eredita» (es. *Foresta innevata* da *Foresta*). Precompilati 8 biomi originali
(foresta, pianura, deserto, palude, montagna, tundra, caverna, costa) più il sottobioma d'esempio, tutti
modificabili ed eliminabili.

Sulla mappa i biomi si dipingono con **Pennello**, **Riempi**, **Rettangolo**, **Gomma** e **Contagocce**, su un
livello separato dall'aspetto grafico, mostrato come sovrapposizione colorata (opacità regolabile, legenda,
attivabile). Le celle senza bioma usano il **bioma predefinito** della mappa. **Genera da bioma** riempie la
mappa (o solo le celle vuote) con macchie casuali dei biomi scelti da un seme, ritoccabili a mano.
Annulla/Ripeti coprono anche biomi ed eventi.

### Eventi (Asset › Eventi e strumento Evento)

Un evento ha nome, icona (palette di colori), descrizione, testo da leggere ai giocatori, note del master e:
- **Innesco**: entrata nella cella o nell'area, passaggio (ogni passo nell'area), interazione (il master
  clicca con 👆 Interagisci), tempo (dopo N ore dal piazzamento o dall'ultima volta), incontro casuale. Forma:
  cella singola o **area** (celle anche non contigue, con lo strumento *Celle dell'area*).
- **Visibilità**: visibile, nascosto (solo master: occhio barrato) o nascosto con **CD di Percezione/Indagare**
  (tirata dal migliore o da tutto il gruppo passando accanto); scoperto diventa visibile.
- **Ripetibilità**: una volta, sempre, N volte, con tempo di ricarica in ore.
- **Condizioni** (tutte vere, anche negate): bioma, ora del giorno, meteo, possesso di un oggetto, variabile.
- **Azioni** in ordine, in blocchi apribili: *Testo* (con ricompensa facoltativa), *Prova o tiro salvezza*
  (caratteristica o abilità, CD, chi tira: gruppo, scelto, migliore, a turno; vantaggio/svantaggio; bonus dalle
  schede; prova di gruppo = basta metà; esiti **successo** e **fallimento** con le loro azioni), *Combattimento*
  (creature o boss con quantità anche in dadi, griglia di battaglia o una vuota dal bioma con zone di partenza,
  *Prepara* o *Avvia ora*; al termine si sceglie l'esito vittoria/fuga/sconfitta, salvato nella variabile
  «esito combattimento», e l'evento prosegue), *Entra in una mappa* (con punto di entrata; pila di mappe senza
  limiti, «Esci» torna allo stesso punto), *Trappola/danno/cura* (dado e tipo, tiro salvezza con metà danni,
  condizione), *Ricompensa* (PE divisi, monete e oggetti dell'Attrezzatura), *Teletrasporto* (cella o altro
  evento), *Cambia ambiente* (bioma attorno al gruppo, meteo, ora), *Variabile* (imposta o aumenta: testo,
  numero, vero/falso; nei testi `{nome}` diventa il valore), *Tabella casuale* (dado e righe con le loro
  azioni), *Riposo* breve o lungo (tempo e scorte), *Attiva altro evento*, *Nota* (registro e, a richiesta, la
  pagina «Registro esplorazione» delle note del master).
- Gli eventi della libreria sono **modelli**: piazzati sulla mappa diventano **copie indipendenti** con il
  proprio stato (innescato, scoperto, contatori, esiti); *✎* modifica solo la copia, *⟳ Aggiorna dal modello* è
  esplicito, *↺* azzera lo stato. **▶ Prova evento** simula senza modificare nulla, anche forzando gli esiti.
  Duplica, esporta e importa JSON di un singolo evento. Riferimenti a creature, griglie, oggetti o biomi
  eliminati: avviso ⚠ in elenco, sulla mappa e nella finestra evento; l'azione viene saltata, la mappa resta.
- Precompilati 8 eventi originali: trappola nascosta, incontro con un viandante, tempesta improvvisa, ingresso
  di un dungeon (da collegare a una mappa), passaggio con prova di Atletica, tesoro con chiave (condizione sulla
  variabile «chiave trovata»), tiro di sopravvivenza, banda di predoni (da completare con le creature).

### Gioco (voce Esplorazione)

Si sceglie la mappa, i giocatori e l'icona della pedina; poi tre colonne come il Combattimento (stessi divisori,
chiusura e schede sugli schermi stretti, preferenze proprie):
- **Gruppo**: pedine (attiva, *Dividi…*, *Riunisci*), personaggi con PF, sfinimento, condizioni e PE, scorte.
- **Mappa**: la pedina del gruppo si trascina (percorso di costo minimo che evita le celle impraticabili) o si
  muove con le **frecce** (Home/Fine/PagSu/PagGiù in diagonale). Ogni passo calcola costo e ore dal bioma, dalla
  modalità di viaggio e dal ritmo; il tempo avanza, scorte e meteo si aggiornano, si controllano pericoli
  ambientali, incontri casuali e inneschi. **Nebbia di scoperta** facoltativa: celle mai viste oscurate (in
  trasparenza per il master), rivelate nel raggio di scoperta del bioma più la visibilità del meteo; il master
  rivela o nasconde a mano. Annulla/Ripeti (Ctrl+Z / Ctrl+Y) riportano indietro anche tempo e scorte.
- **Tempo e registro**: giorno, ora, meteo, bioma corrente con costo e ore per cella, ritmo, modalità,
  **Avanza tempo**, variabili della sessione e registro con ora e luogo.
- Quando scatta un evento si apre la **finestra evento** (testo, note del master, avvisi) con **Esegui**,
  **Salta**, **Rimanda** e **Cambia esito a mano**. Gli incontri con creature propongono *Prepara combattimento*.
  I combattimenti e le mappe di battaglia raggiunte con «Entra in una mappa» si giocano nel Combattimento, con
  il banner **↩ Torna all'esplorazione**; i PF dei personaggi passano dall'uno all'altro.
- Non c'è ancora una vista per i giocatori: il disegno è già pronto a nascondere celle non scoperte, eventi
  nascosti e note quando ci sarà.

## Tile

### Componente «Taglia immagine in tile»

Un solo componente, usato in *Asset › Strutture › Da immagine* (e negli oggetti di mappa con tile) e nel
pannello Tile sotto la griglia.

- Importa un'immagine PNG, JPEG o WebP con il pulsante, trascinandola o con Ctrl+V: è salvata una volta in
  IndexedDB, mai ridimensionata né alterata.
- L'unico controllo è la **dimensione del tile**: X (larghezza) e Y (altezza) in pixel, con preset 16, 32, 48,
  64, 128 o valori liberi, anche non quadrati. La griglia parte dall'angolo in alto a sinistra e copre sempre
  tutta l'immagine: colonne = ⌈larghezza / X⌉, righe = ⌈altezza / Y⌉, con «N colonne × M righe = T tile» in
  tempo reale. I tile di bordo che non coprono una cella intera sono tagliati sul bordo dell'immagine, segnati
  come **parziali** (◩, bordo tratteggiato) e disegnati alla stessa scala degli altri, solo nella parte coperta.
- Anteprima con linee di taglio, numerazione facoltativa, zoom (rotella e pulsanti) e pan (tasto centrale o
  Spazio). **Seleziona**: clic = un tile, Ctrl/Maiusc = aggiungi, trascina = rettangolo; poi i flag
  **Bloccante**, **Vuoto/escluso** e **Terreno difficile** (costo di movimento 2). **Rileva tile vuoti** esclude
  i tile con meno del 5% di pixel non trasparenti (soglia regolabile), modificabili a mano.
- Un tile è identificato da (TileSet, colonna, riga): cambiando X o Y i flag restano sulle stesse coordinate.
  Se il TileSet è già usato da mappe, strutture o oggetti compare dove è usato, con tre scelte: **Applica a
  tutti** (le strutture da immagine si ricostruiscono sulle stesse coordinate), **Salva come nuovo tileset**
  (copia con la nuova dimensione) e **Annulla**. I TileSet precedenti con offset, margini o spaziatura restano
  validi (dati e riferimenti conservati); l'interfaccia espone solo X e Y. Un TileSet mancante dà un
  segnaposto grigio.

### Strutture da immagine

Ogni tile corrisponde a **una cella** della griglia di battaglia: tile più piccoli = struttura più grande.
Clic o trascinamento sui tile per includerli o escluderli (*Seleziona tutto*, *Deseleziona*, *Inverti*,
*Rettangolo*, *Rileva dai pixel*): una casa a L = i tile della L. Solo i tile inclusi si disegnano e contano
per l'ingombro; *Disegna anche le parti fuori selezione* mostra tetti e chiome senza bloccare. Bloccano i
tile inclusi marcati *Bloccante*; se nessuno lo è, tutti gli inclusi. Livello di disegno *Sotto le pedine*
o *Sopra le pedine* (con *Semitrasparente quando c'è una pedina sotto*), **⟳ Ruota** e **⇋ Specchia** (tile,
ingombro e flag insieme) e anteprima sulla griglia con una pedina 1×1 d'esempio. Le strutture a tilemap della
versione precedente restano funzionanti (si piazzano, ruotano e specchiano).

### Pannello Tile (Editor griglie)

Sotto la griglia, richiudibile (▼/▲) e ridimensionabile (trascina il bordo superiore o frecce su/giù):

- **TileSet**: scelta, importazione, *Rinomina*, *Elimina* (con l'elenco di dove è usato). Il componente di
  taglio fa da **palette**: clic = un tile, trascinamento = un rettangolo di tile come **timbro**.
- **Strumenti** (si dipinge sulla griglia principale, ogni tile occupa una cella ed è scalato alla cella):
  **🖌 Pennello** (B), **🧽 Gomma** (E), **🪣 Riempi** (G, area contigua), **▭ Rettangolo** (U, Maiusc =
  svuota), **💧 Contagocce** (I), **⬚ Seleziona/sposta** (M: trascina per selezionare, trascina dentro la
  selezione per spostarla, Copia/Taglia/Incolla/Svuota e Ctrl+C/X/V, Canc), **⛔ Blocco** (K: cella normale →
  bloccata → libera); **🖐 Griglia** (Esc) torna agli strumenti della griglia. Rotazione ⟲ ⟳ (Maiusc+R / R) e
  specchio ⇋ ⇵ (F / Maiusc+F) del timbro o della selezione, registrati nella cella senza toccare l'immagine.
  Il pennello non lascia buchi e non ridisegna la stessa cella finché il puntatore non la cambia; funziona a
  qualsiasi zoom e con il touch. **Annulla/Ripeti** (50 azioni) coprono anche i tratti di tile.
- **Livelli** (Base e Sopra all'inizio, aggiungibili): nome, visibilità, opacità, blocco delle modifiche,
  riordino, duplica, elimina, posizione *sotto* o *sopra le pedine* con *semitrasparente quando c'è una
  pedina sotto*.

Le celle dei tile *Bloccanti* entrano in `DnD.griglia.isCellBlocked(griglia, x, y)` insieme a strutture,
oggetti di mappa che bloccano (porte chiuse comprese) e celle forzate con *Blocco*. Il terreno difficile è
conservato come dato (costo 2, leggibile con `DnD.collisioni.cellInfo`). Nel Combattimento le tile sono
disegnate in sola lettura: prima i livelli sotto, poi le pedine, poi quelli sopra. Lo **sfondo** sta sotto
tutto (sotto TileMap, strutture e pedine).

### Modello dati (versione 11)

```
npcs: [{ type: 'standard', …scheda… , gridSize: { auto, w, h } }
       | { type: 'boss', …come una creatura…, boss: { title, epithet, intro, theme, scaleByPlayers, aura,
           phases: [{ id, threshold, name, note, effect, temperament, enable: [idAzione], disable: [idAzione] }] } }
       | { type: 'creatura', name, size, ctype, subtype, alignment, ac, acDesc, hitDice, hpOverride, speed, abilities,
           saves, skills: { abilità: 1|2 }, vulnerabilities, resistances, immunities, conditionImmunities, senses, cr,
           traits, actions, bonusActions, reactions, legendary, lair: [{ id, name, desc, customText, freq, cost, mech }],
           legendaryResistance, legendaryPoints, innate, icon, gridSize }]
players: [{ …scheda…, inventory: [{ equipmentId, qty, equipped }], coins: { mr, ma, me, mo, mp } }
         | { …scheda…, type: 'leggendario', level: 20-40, abilityCap, legend: { title, theme, pointsBonus, allowRespec,
             path: { name, nodes: [{ id, name, icon, color, description, cost, minRank, category, exclusiveWith,
             requires, requireAll, core, x, y, effects }], links: [[idA, idB]] }, unlocked: [idNodo],
             transformations: [{ id, name, epithet, creature, fusion, hpMode, uses, duration, activation, canEndEarly,
             minRank, requireNode, icon, gridSize, theme, enterText, exitText }], uses, featureUses, spellUses } }]
           (i giocatori standard non hanno «type»; un declassato conserva il percorso in «legendArchive»)
pathTemplates: [{ id, name, description, path }]   modelli di percorso, comuni a tutte le sessioni
equipment: [{ id, name, category, description, weight, cost: { amount, unit }, rarity, attunement, icon, tags, speedBonus (m), weapon, armor }]
combattimento: { …, freeMovement }   (i combattenti precedenti con «speed» in metri ricevono la velocità a piedi)
mapObjects: [{ id, name, otype, icon, mode, tiles, container, interactive, hidden, blocks, state, lock, trap, contents, coins }]
griglia: { w, h, feetPerCell, background: { kind, color, imageId, fit, x, y, scale, opacity, pxPerCell },
           structures, items (oggetti di mappa piazzati, con stato e contenuto propri), labels, zones, tileMap }
griglia (esplorazione): { …, kind: 'battaglia' | 'esplorazione', scale: { value, unit: ft|m|km|mi },
           biomeMap: { palette: [idBioma], cells: 'stringa w×h', defaultId, overlay: { visible, opacity } } | null,
           events: [{ id, templateId, event: …copia del modello…, cells: [{ x, y }], state: { fired, lastHours, discovered, outcomes } }],
           fog: { enabled, seen: 'stringa w×h di 0/1' } }
biomes: [{ id, name, parentId, color, icon, tiles, description, cost, modeCost, hoursPerCell, discovery, light,
           hazards, food, water, encounterChance, encounterPer, encounters, weather }]   (null = ereditato)
events: [{ id, name, icon, description, readText, notes, trigger, area, visibility, repeat, conditions, actions }]
sessione.exploration: { gridId, stack: [{ gridId, parties }], parties: [{ id, name, icon, pos, memberIds }], activeParty,
           time: { day, hour, total }, weather, pace, mode, supplies, members: { id: { hp, maxHp, exhaustion, conditions, xp } },
           variables, log, queue, pending (combattimento in attesa), seed }
combattente: { …, w, h, speeds: { cammina, scalare, nuotare, volare, scavare } (ft), speedOverride, moveMode, conditions,
               movement: { used, dashes, stood, disengaged, start, moves }, ignoreSpeed, defenses: { vuln, res, imm }, creature: { …scheda, uses, recharge, legendaryPoints, legendaryResistance }, pendingSave,
               boss: { …campi del boss, phase, revealed, defeated },
               legend: { theme, rank, transformations, uses, senses, texts, passive, form: { id, name, hpMode, theme, roundsLeft, prev } } }
sorgente di un TileSet: { …, tileW, tileH, cover }   cover = taglio a copertura (bordi parziali)
```

**Migrazione dalla versione 10** (`migrateV11`): i giocatori esistenti restano standard (nessun campo cambia);
gli archivi ricevono la libreria dei modelli di percorso con l'esempio *Ascesa dell'Eterno*.

**Migrazione dalla versione 9** (`migrateV10`): le griglie esistenti diventano di tipo *Battaglia* senza
biomi, eventi né nebbia (nulla cambia); gli archivi ricevono i biomi e gli eventi d'esempio.

**Migrazione dalla versione 8** (`migrateV9`): nessun dato cambia; gli archivi ricevono il boss d'esempio
(condiviso). I file di una singola sessione non ricevono esempi.

**Migrazione dalla versione 7** (in `js/dati.js`, `migrateV8`, sui dati grezzi, anche dei file importati): i
nemici esistenti diventano *Standard*; giocatori e nemici hanno la dimensione *Automatica*; gli Oggetti
diventano voci dell'Attrezzatura (arma → Armi, armatura → Armature, pozione → Consumabili, tesoro → Tesori e
gemme, chiave e altro → Altro; il valore «50 mo» diventa il costo) e, se avevano un aspetto da tile o
bloccavano, anche un modello di oggetto di mappa; le copie già piazzate diventano «oggetti a terra» con
quell'oggetto dentro; le griglie restano 50×50 senza sfondo, con la TileMap portata alla dimensione della
griglia; le strutture da immagine mantengono tile selezionati e flag; le pedine `size` diventano `w × h`. Si
aggiungono il catalogo base, gli oggetti di mappa d'esempio e le creature d'esempio.

### Collisioni (dalle versioni precedenti)

Le tile delle TileMap precedenti possono avere poligoni di collisione (coordinate locali 0–1, soglia di blocco
del TileSet, 50% di base): restano funzionanti in `js/collisioni.js`, ma l'interfaccia non li modifica più;
il flag *Bloccante* è la modalità predefinita.

## Combattimento simulato (IA dei nemici)

Con **Combattimento simulato** (nel setup o nel pannello del combattimento) i combattenti controllati
dall'**IA** giocano da soli; spento, tutto funziona come prima.

- **Controllo e fazioni**: ogni combattente è *Manuale* o *IA* (di base giocatori Manuale, nemici IA) e ha
  una fazione: Giocatori, Nemici o Neutrali/Alleati (questi ultimi stanno con i giocatori). Si scelgono per
  riga nel setup e si cambiano durante la partita dal menu contestuale della pedina (doppio clic), dove si
  può anche rendere un combattente *nascosto* (l'IA non lo vede). Così l'IA può giocare anche un giocatore
  assente o un alleato. L'IA attacca solo le fazioni ostili e cura o aiuta solo gli alleati.
- **Comportamento** (form di Nemici, Standard e Creature): **Temperamento** *Aggressivo* (sempre il
  bersaglio più vicino per percorso, non fugge mai) o *Furbo* (il più debole; può fuggire sotto una soglia
  di PF); **Archetipo** *Automatico* (la caratteristica finale più alta; a parità vince l'ordine FOR, DES,
  COS, INT, SAG, CAR, salvo che tra le pari ci sia quella dell'arma equipaggiata) o scelto a mano. Opzioni
  avanzate: distanza preferita, soglia di fuga, casualità 0–30%, classi bersaglio prioritarie per SAG.
  Il form mostra il «Comportamento previsto».
- **Archetipi**: FOR attacca in mischia; DES resta a distanza (distanza preferita, di base la gittata) e si
  riposiziona se qualcuno si avvicina, senza armi a distanza fa come FOR; COS si mette tra l'alleato più
  fragile e il nemico più vicino a lui e attacca chi lo minaccia (Schivare solo senza attacchi e sotto il
  50% dei PF); INT attacca il bersaglio più pericoloso; SAG dà la priorità a Mago, Chierico e Stregone
  (lista modificabile), altrimenti il più debole; CAR cura chi è sotto il 50%, poi incantesimi di supporto,
  poi Aiutare, resta lontano dai nemici e attacca solo a distanza o si ritira. I bersagli considerati sono
  solo quelli visibili (linea di vista tra le celle) e non a terra. Punteggi di debolezza (PF e CA bassi,
  incantatore, isolato, vulnerabile all'arma) e di minaccia (danno medio per round, livello o GS, PF): pesi in
  `js/ia-dati.js`.
- **Turno** (`js/ia.js`, funzioni pure): `pianificaTurno` restituisce un piano senza modificare nulla. Il
  percorso minimo tiene conto dell'ingombro delle pedine, del terreno difficile (costo 2), delle celle
  bloccate (porte chiuse comprese) e delle diagonali come il misuratore; non supera la velocità e, se non
  arriva, usa lo **Scatto**. Arma, azione o incantesimo si scelgono per danno atteso (portata e gittata,
  svantaggio a distanza con un nemico adiacente, vulnerabilità, resistenze e immunità del bersaglio); le
  creature usano multiattacco, azioni a ricarica e incantesimi innati; gli slot si usano solo se valgono la
  pena (il più basso sufficiente), le aree solo se colpiscono almeno 2 nemici e nessun alleato. Attacchi di
  opportunità e reazioni: solo un promemoria nel log. Il calcolo ha un tetto di 300 ms con ripiego «avvicinati
  e attacca il più vicino»; la casualità usa il seed salvato nel combattimento (turni riproducibili).
- **Modalità**: *Passo a passo* (anteprima sulla griglia con percorso tratteggiato, bersaglio evidenziato e
  motivazione; **Esegui**, **Cambia bersaglio** cliccando un'altra pedina, **Salta turno**, **Ricalcola**),
  *Automatica* (ritardo 0–3 s, animazione dello spostamento, **Pausa**; si ferma al turno di un combattente
  manuale o quando non restano avversari) e *Manuale* (solo il suggerimento). Ogni turno IA finisce nel log con
  la motivazione e il pulsante **Perché?** con i punteggi dei bersagli; **Annulla turno IA / Ripeti**
  riportano indietro (o avanti) l'intero turno come un'unica azione.

I nemici e i giocatori esistenti ricevono temperamento Aggressivo e archetipo Automatico; un combattimento
in corso riprende con i valori di base (giocatori Manuale, nemici IA). Tutto è incluso in Esporta/Importa.

## Velocità e movimento

Nel combattimento ogni pedina ha una **velocità in piedi** per modalità (camminare, scalare, nuotare, volare,
scavare), convertita in caselle: piedi / piedi per cella della griglia, per difetto (30 ft con celle da 5 ft = 6
caselle; con celle da 10 ft = 3). Logica in `js/movimento.js`.

- **Fonti**: razza (giocatori) o scheda della creatura (tutte le modalità; nelle librerie le velocità sono in metri,
  1,5 m = 5 ft), più i **nodi del Percorso** dei leggendari, gli **oggetti equipaggiati** (campo *Bonus alla
  velocità* dell'Attrezzatura, anche negativo) e la **trasformazione** attiva (velocità della forma).
  *Modifica* del combattente sovrascrive a mano la velocità di ogni modalità (vuoto = dalla scheda).
- **Movimento residuo**: si azzera a velocità piena all'inizio del turno del combattente. Lo spostamento lo consuma
  e il residuo è sempre visibile: nella scheda, sopra la pedina di turno («🦶 4») e nella barra del turno. Non si
  può superare: trascinando oltre, la pedina si ferma all'ultima cella raggiungibile con un avviso.
- **Costo per casella**: 1 normale, 2 terreno difficile (tile con costo), celle bloccate non attraversabili
  (strutture, porte chiuse, TileMap, come `isCellBlocked`); pedine ostili bloccano, quelle alleate si
  attraversano ma non ci si ferma sopra; niente angoli tagliati. Le pedine più grandi muovono tutto l'ingombro.
  Diagonali con la regola del misuratore (Impostazioni › Movimento): **sempre 1** (come prima) o **alternata
  1-2-1**. A parità di costo il percorso scelto è quello con meno diagonali.
- **Modalità**: si cambia dal menu della pedina. Senza la velocità di quella modalità la creatura non può usarla
  oppure costa il doppio (con la velocità a piedi), a scelta nelle Impostazioni. Volando il terreno difficile non
  conta.
- **Azioni**: **🏃 Scatto** (aggiunge la velocità al residuo, usa l'azione), **↩ Disimpegno** (promemoria: niente
  attacchi di opportunità), **⤒ Rialzati** da prono (costa metà velocità), **↶ Annulla spostamento** (torna alla
  posizione d'inizio turno e restituisce il movimento speso). Anche dal menu della pedina.
- **Condizioni** (scheda › *Condizioni…*, applicate in automatico): afferrato, trattenuto, paralizzato (e
  pietrificato, privo di sensi) = velocità 0; prono = striscia, ogni casella costa una in più; **rallentato** =
  metà velocità. Il motivo compare accanto al valore.
- **Anteprima** mentre si trascina: celle raggiungibili in verde (residuo) e in arancio (con lo Scatto), percorso
  tratteggiato e costo sul cursore («costo 4 · restano 2»).
- **Master**: *Movimento libero* nella barra della griglia (nessun limite per nessuno) e *🦶 Ignora velocità* per
  singolo combattente (eventi, teletrasporti).
- Il **log** registra ogni spostamento («Kael si muove di 4 caselle, restano 2 caselle (10 ft)»); annulla/ripeti
  della griglia (Ctrl+Z / Ctrl+Y) copre anche il residuo. Il **combattimento simulato** pianifica con il residuo e
  il costo reale del percorso (non la distanza in linea d'aria) e lo consuma.
- Fuori dal combattimento (editor, esplorazione) valgono le regole di prima e quelle dei biomi.

## Dadi animati

Il risultato si decide **prima**, con lo stesso generatore senza bias (`crypto.getRandomValues`): un
*registratore* (`dadi.registratore`) registra i dadi tirati da attacchi, danni, tiri salvezza, prove, iniziativa,
ricariche e incantesimi, e l'animazione li mostra finendo sempre su quei valori. Il log e la cronologia hanno il
tiro anche se l'animazione è saltata o spenta. La parte visiva (`uiDadi.mostraTiro(tiro)`) è separata dal calcolo,
pronta per dadi condivisi in futuro.

- **Aspetto**: d4, d6 (cubo 3D con i puntini), d8, d10, d12, d20 e d100 (due d10, decine e unità) disegnati in
  SVG/CSS, colore scelto nella palette dell'app. Lancio con rotazione, rimbalzo e rallentamento; più dadi rotolano
  insieme e si sommano. Il dado scartato (vantaggio e svantaggio, 4d6 «scarta il più basso») è attenuato. 20
  naturale: bagliore dorato; 1 naturale: effetto scuro e tremolio. Accanto, i gruppi con i modificatori e il totale.
- **Dove**: nel menù **Dadi** (area di lancio, con d100, «d20 con vantaggio/svantaggio» e «4d6, scarta il più
  basso») e come piccolo **overlay** in basso nel Combattimento e nell'Esplorazione: non copre i controlli
  (`pointer-events: none`), si chiude da solo e mette i tiri in coda (veloce durante i turni automatici dell'IA).
- **Impostazioni › Dadi animati**: interruttore generale e per categoria (menù, combattimento, esplorazione),
  velocità (lenta, normale, veloce, istantanea), colore e *Prova*. I suoni dei dadi (rotolio unico per tutto il
  tiro, tonfo al risultato, suoni propri per 20 e 1 naturali; animazione saltata = solo il tonfo) stanno negli
  [Effetti sonori](#effetti-sonori). **Salta animazione** con il pulsante, un clic sull'area o
  Spazio. Con *Riduci animazioni* il risultato compare subito senza movimento; oltre 12 dadi si mostra solo il
  totale.

## Effetti sonori

I punti dell'app emettono **eventi sonori** e un solo modulo li suona (`js/audio.js`): il resto dell'app chiama
soltanto `DnD.audio.suona('critico')`. Il suono accompagna e basta: non decide nulla di gioco, e ogni evento ha già
un riscontro visivo (log, evidenziazione, banner, avviso). Tutti i suoni sono **sintetizzati nel codice** con la Web
Audio API (oscillatori, rumore filtrato, inviluppi): nessun file audio incluso, nessuna libreria, nessuna rete.

- **Eventi** (tabella in `js/suoni-dati.js`: identificatore, etichetta, categoria, volume relativo, acceso/spento di
  base e ricetta): *Dadi* (rotolio, tonfo, 20 e 1 naturali); *Combattimento* (colpo a segno, mancato, critico, danno
  subito da un giocatore, cura, a terra, incantesimo, tiro salvezza riuscito o fallito, azione bonus o reazione);
  *Turno* (inizio del turno di un giocatore manuale, nuovo round, fine combattimento con vittoria o sconfitta);
  *Movimento* (passo, spento di base; movimento rifiutato); *Boss* (evocazione, ingresso in combattimento, cambio di
  fase, sconfitta); *Leggendario* (ascensione, sblocco di un nodo, trasformazione, ritorno alla forma normale);
  *Esplorazione* (evento o incontro, scoperta di un evento nascosto, ingresso in una mappa, tempo che passa o meteo
  che cambia); *Online* (predisposti per la futura fase Online: ingresso, richiesta, chat, disconnessione, ping);
  *Interfaccia* (conferma, errore, salvataggio della griglia, spenti di base).
- **Da dove partono**: il combattimento traduce gli esiti già calcolati (nuove righe del log, PF dei giocatori, forme
  dei leggendari) in un solo punto (`mutate`), l'esplorazione dalle nuove righe del registro; dadi, boss,
  leggendari, griglia e avvisi chiamano `suona` accanto alle animazioni che esistevano già. Gli esiti di un'azione
  vanno in **coda** (uno dopo l'altro); nei turni automatici dell'IA restano solo i suoni principali e la coda non
  aspetta mai più di 1,5 s (il gioco non rallenta).
- **Protezioni**: l'audio parte solo dopo il primo clic o tasto (regole di autoplay dei browser; prima non suona
  nulla e non ci sono errori); al massimo 8 suoni insieme (il più vecchio sfuma); almeno 60 ms tra due suoni uguali;
  silenzio con la scheda in secondo piano; tutto passa da un nodo master con un compressore leggero, senza partenze
  a volume improvviso.
- **Impostazioni › Suoni**: interruttore generale (**spento di base**), volume, *Avvisi sonori più evidenti per il
  turno* (il «ding» del turno è più forte e ripetuto), *Prova suono* e **Tutti i suoni…**: per ogni categoria
  interruttore e volume, per ogni evento acceso/spento, volume, **Ascolta**, **Sostituisci…**, **Ripristina** e
  l'indicatore *Predefinito / Personalizzato*. Pulsante rapido con l'altoparlante accanto al tema e **Alt+M**.
  I suoni sono **indipendenti da «Riduci animazioni»**; quelli di Boss e Leggendario seguono anche *Effetti boss*.
- Le impostazioni dei suoni sono di questo browser (come tema e animazioni) e viaggiano con *Esporta archivio* /
  *Importa*, insieme ai file sostituiti. *Cancella tutti i dati* toglie i file e riporta gli slot alla sintesi.
  Chi usava i suoni dei dadi della versione precedente li ritrova accesi, con lo stesso volume.

### Sostituire un suono

In *Impostazioni › Suoni › Tutti i suoni…* premi **Sostituisci…** accanto all'evento e scegli un file **mp3, ogg o
wav** di **2 MB al massimo**. Il file viene salvato una volta sola nel database del browser (IndexedDB, stesso
contenuto = una sola copia anche se lo usi per più eventi), decodificato una volta e tenuto in memoria. **Ripristina**
torna al suono sintetizzato; se il file manca o è illeggibile l'app torna da sola alla sintesi, senza errori.

> **Diritti**: usa solo file tuoi o con una licenza che lo consenta (ad esempio **CC0**). Non usare suoni estratti
> da videogiochi, film o siti non liberi.

## Note del master

Un blocco note sempre a portata di mano, in **ogni sezione** (non è una voce del menù): il pulsante con
l'icona del blocco note sul bordo destro, a metà altezza, apre e chiude il pannello (anche **Alt+N**;
**Esc** lo chiude quando il focus è nel pannello). Il pannello scorre da destra sopra il contenuto, senza
ridimensionare la griglia; si allarga o si stringe trascinando il bordo sinistro (300 px – 70% della
finestra, frecce sinistra/destra da tastiera; a tutta larghezza sugli schermi stretti). Apertura e larghezza
sono ricordate; con *Riduci animazioni* non scorre. Il pulsante dei dadi e gli avvisi si spostano a
sinistra del pannello aperto.

- **Pagine**: le note sono della **sessione corrente**, divise in pagine (menù in cima: ＋ nuova, ✎ rinomina,
  ⧉ duplica, ↑ ↓ riordina, 🗑 elimina). La pagina «Appunti» nasce alla prima scrittura.
- **Editor** (`js/note-editor.js`, JavaScript puro su contenteditable): tipo di paragrafo (titoli 1–3,
  citazione), **grandezza del testo** (10, 12, 14, 16, 20, 24, 32, 48 px, A− / A+), grassetto, corsivo,
  sottolineato, barrato, **colore** (12 colori leggibili in entrambi i temi, selettore libero, *Predefinito*
  che segue il tema) ed **evidenziatore**, **elenchi** puntati e numerati con rientro (Tab / Maiusc+Tab),
  allineamento, linea orizzontale, cancella formattazione, annulla/ripeti propri (Ctrl+Z / Ctrl+Y) e conteggio
  delle parole. **Tabelle**: inserimento con una griglia 12×12, righe sopra/sotto, colonne a sinistra/destra,
  eliminazione di riga, colonna o tabella, riga di intestazione; Tab passa alla cella successiva e nell'ultima
  aggiunge una riga; le colonne si allargano trascinando il bordo destro di una cella. I pulsanti mostrano lo
  stato del cursore. `document.execCommand` è usato in un solo punto (formati semplici); grandezza, colori,
  elenchi e tabelle usano Selection/Range.
- **Tastiera**: mentre scrivi nell'editor le scorciatoie dell'app non scattano (Ctrl+Z/Y della griglia,
  Canc, Ctrl+B della barra laterale, Alt+1…Alt+9): Ctrl+B, Ctrl+I e Ctrl+U formattano il testo. Fuori
  dall'editor tutto funziona come prima.
- **Salvataggio** automatico mezzo secondo dopo l'ultima modifica e alla chiusura del pannello, al cambio di
  pagina o di sessione, con l'indicatore *Salvato / Salvataggio…*. Se lo spazio è esaurito compare un errore
  chiaro e il testo non risulta salvato (si riprova alla modifica successiva). Ogni nota può arrivare a
  500 KB: oltre compare un avviso e non viene salvata finché non la accorci.
- **Esporta** la pagina in `.html` o `.txt`, **Stampa** solo la nota. Le note sono incluse in *Esporta
  archivio*, *Esporta sessione corrente* e nella duplicazione delle sessioni; non finiscono mai nelle griglie
  salvate.
- **Sicurezza**: l'HTML è sempre sanificato (incollando, caricando e importando) con una whitelist di tag
  (p, br, div, span, b, strong, i, em, u, s, h1–h3, ul, ol, li, table, thead, tbody, tr, td, th, hr,
  blockquote) e di stili (color, background-color, font-size, text-align, font-weight, font-style,
  text-decoration, width): via script, gestori di eventi, link `javascript:` e immagini. **Ctrl+Maiusc+V**
  incolla come testo semplice. Nessuna immagine nelle note e nessuna chiamata di rete.
- Colori e bordi delle tabelle vengono dalle variabili CSS dei temi chiaro e scuro; la dimensione base segue
  l'impostazione *Dimensione del testo*.

## Salvataggio e backup

Ogni modifica viene salvata subito nel database locale del browser (**IndexedDB**, con spazio per
le immagini; se non è disponibile si usa `localStorage`). Le immagini dei TileSet e degli sfondi stanno in chiavi
separate dallo stato, una sola copia per contenuto, con una cache in memoria delle immagini già
decodificate. Se il salvataggio non riesce (es. **spazio esaurito**) compare un messaggio chiaro e
la griglia resta segnata come *non salvata*. Tutto resta sul tuo computer, ma va perso se cancelli
i dati di navigazione del sito: fai backup regolari dal pannello **Impostazioni**:

- **Esporta archivio** scarica tutto (sessioni con combattimenti ed esplorazioni, personaggi e creature,
  griglie con TileMap, sfondi, biomi, eventi e nebbia, librerie compresi biomi ed eventi, attrezzatura, oggetti
  di mappa, TileSet, dadi, impostazioni e file dei suoni e le immagini usate, incorporate in
  Base64: il file è autosufficiente).
  Importandolo, i dati attuali vengono sostituiti dopo una conferma.
- **Esporta sessione corrente** scarica una sola sessione con i suoi personaggi e le sue griglie e
  gli elementi delle librerie che usano (razze, incantesimi anche innati, strutture, attrezzatura di
  armi, armature, inventari e contenuti, oggetti di mappa, i TileSet usati e le immagini, sfondi compresi). Importandola, la sessione si **aggiunge** alle
  altre: gli elementi delle librerie già presenti non vengono duplicati.
- **Cancella tutti i dati** (doppia conferma) svuota anche IndexedDB, immagini, sfondi e suoni personalizzati compresi.
- Ogni creatura (Standard o del Manuale) si esporta e si importa anche da sola, come file JSON, dalla
  sezione Nemici.

I file non validi vengono rifiutati e i valori fuori intervallo corretti. Le chiavi interne di
salvataggio si chiamano ancora `dnd-battaglie`: così i dati delle versioni precedenti restano
leggibili dopo il cambio di nome.

## Test

Apri `test.html` nel browser: esegue i test automatici della logica e mostra i risultati a schermo.
Coprono regole, dadi, classi, incantesimi, generatore di nemici, sessioni, esportazione e importazione;
l'**esplorazione** (costo di movimento e ore per bioma, ritmo, modalità e scala, sottobiomi, mappa dei biomi con
pennello, riempi, ridimensionamento e generazione con seme, percorso che evita le celle impraticabili, inneschi
per entrata, area e tempo, ripetibilità una volta e N volte, istanze indipendenti dallo stesso modello, evento
nascosto con prova di scoperta, prove con successo e fallimento e prova di gruppo, esito scelto dal master,
catena di eventi con variabili e condizioni, tabella casuale con seme, ricompense, «Entra in una mappa» con
ritorno e pila annidata, combattimento in pausa e ripresa con l'esito, pericoli ambientali e incontri casuali
con seme, scorte e meteo, nebbia di scoperta, salvataggio e ripristino, esportazione e importazione anche di
sessione e duplicazione, migrazione delle griglie esistenti, riferimenti mancanti); il
**layout del combattimento** (larghezze e stato salvati e ripristinati, limiti, reimposta layout, tre colonne con
chiusura e divisori, conversione schermo/cella dopo il ridimensionamento, selezione sincronizzata tra scheda e
pedina; la schermata gira in un archivio in memoria, i dati veri non si toccano); la
**fase Boss** (palette di 14 colori con icone e forme ricolorate e bordo di contrasto, nuove categorie con ricerca
e dimensione suggerita, promozione a boss da creatura e da nemico standard, soglie di fase anche con più fasi in
un colpo e cura sopra la soglia, azioni e temperamento per fase, PF scalati, barre multiple, vignettatura che non
intercetta i clic, effetti spenti con *Riduci animazioni* e con *Effetti boss*, boss nascosto nella vista
giocatori, esportazione e importazione, migrazione dei dati e dei colori esistenti); il
**combattimento simulato** (archetipo automatico con parità, Aggressivo per percorso e Furbo sul più debole,
DES a distanza e senza armi a distanza, COS tra alleato fragile e nemico, INT sul più forte, SAG sugli
incantatori, CAR che cura e non attacca, percorso A* con muri, porta chiusa, terreno difficile e pedina 2×2
nello stretto, velocità e Scatto, svantaggio a distanza, danno atteso con resistenze, multiattacco e ricarica,
fuga, tempo massimo, seed, motivazione e «Perché?», annulla di un turno, IA su un giocatore); le
**note del master** (sanificazione, testo e parole, pagine, salvataggio con debounce e alla chiusura, errore
di quota e limite di 500 KB, note per sessione con duplicazione, esportazione e importazione e mai nelle
griglie, grandezza e colore, elenchi con rientro, tabelle con righe, colonne, intestazione e Tab nell'ultima
cella, incolla sanificato, scorciatoie disattivate nell'editor e attive fuori, apertura con il pulsante,
Alt+N ed Esc) e,
per questa fase: ordine del menù con «Asset»; dimensione automatica per taglia e personalizzata, ingombro e
collisioni di pedine 2×2 e 2×4, distanza tra le celle più vicine, pedine che non entrano nelle zone di
partenza; icone della libreria nei 4 colori e icone degli oggetti; tabelle del grado di sfida (competenza e
PE), PF dai dadi vita della taglia, bonus di salvezze e abilità con maestria, Percezione passiva, testo delle
azioni in stile manuale; vulnerabilità, resistenze, immunità e danni non magici; multiattacco, ricarica, usi
giornalieri, azioni leggendarie, Resistenza leggendaria e promemoria della tana; esempi originali validi e
stima del CS; bonus e danno delle armi e CA dalle armature del catalogo, peso dell'inventario; taglio in
tile con ricalcolo di colonne e righe al cambio di X e Y, tile di bordo parziali e flag stabili; TileSet in
uso e «Salva come nuovo tileset»; rilevamento dei tile vuoti; struttura da immagine a L con flag
Bloccante, rotazione e specchio; griglie 20×30 e 100×100 con coordinate e confini, ridimensionamento con
elementi tolti; calibrazione, adattamento dello sfondo e copia nel combattimento; `isCellBlocked` con porta
chiusa e aperta, tile Bloccante e cella forzata; oggetti di mappa con stato e contenuto indipendenti,
serrature, trappole e oggetti a terra; migrazione dalla versione 7 (nemici, oggetti, griglie, strutture,
pedine); esportazione e importazione con creature, attrezzatura, oggetti di mappa e sfondi, anche di file di
sessione precedenti; validazione; errore di quota simulato con messaggio chiaro.

Per i **personaggi leggendari**: bonus di competenza e punti caratteristica ai livelli 20-40, tetto 30, PF oltre il
20, punti percorso per rango; sblocco solo se collegato, con punti e rango, nodo esclusivo, prerequisiti multipli,
rimodella; effetti numerici e competenze applicati ai calcoli e tolti al rimborso, PF che seguono la COS, nuove magie
e slot extra, incantesimo eliminato; competenze e maestrie nelle prove dell'esplorazione, Percezione passiva, sensi,
magie «N al giorno» senza slot (anche per chi non è incantatore) con usi e riposo; privilegio creato dall'utente con
usi per riposo come azione nel combattimento; grafo (collega, scollega, elimina con collegamenti, irraggiungibili,
cicli, duplicazione, raggiera, cronologia), modelli; trasformazione con regole di fusione, PF che passano al
personaggio con il danno in eccesso, PF temporanei, usi e durata, fine anticipata, fasi del boss e barra in alto,
tema della forma; promozione e declassamento, migrazione, esportazione e importazione; temi unificati con il Boss,
scheda del combattente a tema ed effetti fermi con *Riduci animazioni*.

Per **velocità e movimento**: conversione piedi/celle con scale diverse e fonti della velocità (razza, oggetti,
creatura, nodi, trasformazione, sovrascrittura); residuo per turno, azzeramento, limite e fermata all'ultima
cella; costo con terreno difficile, diagonali con le due regole, pedina 2×2 nello stretto, pedine ostili e alleate;
Scatto, Rialzarsi, annulla spostamento; condizioni (afferrato, trattenuto, paralizzato, prono, rallentato);
modalità con velocità mancante vietata o doppia; anteprima delle celle raggiungibili; IA con il residuo;
salvataggio, migrazione, movimento libero e annulla/ripeti con il residuo. Per i **dadi animati**: risultato
mostrato uguale a quello deciso anche con l'animazione interrotta, 4d6 con scarto, vantaggio e svantaggio, 20 e 1
naturali, d100, limite dei dadi animati, velocità, *Riduci animazioni*, interruttori, coda dei tiri e
registrazione dell'esplorazione senza cambiare il seme. Per gli **effetti sonori** (con un AudioContext finto):
etichetta, categoria e ricetta di ogni evento; interruttore generale, categoria ed evento, *Effetti boss*; niente
suoni prima del primo gesto; massimo 8 voci, intervallo minimo, coda e turni veloci; silenzio con la scheda in
secondo piano; sostituzione con un file, una sola copia, ripristino, file corrotto o mancante, limite di 2 MB;
impostazioni salvate e migrazione dei suoni dei dadi; esportazione e importazione con i file; *Cancella tutti i
dati*; dadi sincronizzati con l'animazione anche saltata; eventi dal combattimento e dall'esplorazione; *Silenzia
tutto* con il pulsante e Alt+M; indipendenza da *Riduci animazioni*.

## Struttura

```
index.html            pagina dell'app
test.html             pagina dei test
manifest.json, sw.js  PWA (installazione e uso offline)
css/style.css         temi chiaro/scuro con variabili CSS e layout responsive
css/boss.css          area dei boss, cornice con spade, barra, vignettatura ed effetti (variabili del tema)
css/leggendario.css   grafica divina dei leggendari: temi e motivi, ali, sigilli, lance, percorso, animazioni
css/dadi.css          dadi animati: area di lancio, overlay, d6 in 3D, effetti dei 20 e degli 1
js/impostazioni.js    tema, dimensione del testo e animazioni (caricato in <head>)
js/config.js          nome dell'app, voci e icone del menù
js/dadi.js            generatore casuale, espressioni di dadi, registratore dei tiri, piano dell'animazione e coda
js/movimento.js       velocità e movimento: fonti, conversione in celle, residuo, condizioni, percorso minimo
js/regole.js          regole 5e come funzioni pure (modificatori, attacco, cura, turni, PF, CA, TS)
js/classi.js          tabella delle 12 classi e degli slot incantesimo
js/equipaggiamento.js armi e armature predefinite per classe (generatore di nemici)
js/generatore.js      logica pura del generatore di nemici
js/magie.js           logica pura degli incantesimi
js/nomi.js            lista dei nomi casuali (copiata da nomi.txt)
js/colori.js          palette dei 14 colori delle pedine e bordo di contrasto
js/libreria-icone.js  icone predefinite (SVG originali) per pedine e oggetti, con dimensione suggerita
js/icone.js           icone: normalizzazione, SVG della libreria, disegno nell'ingombro, immagini
js/immagini.js        immagini importate: archivio IndexedDB con cache, lettura dei pixel
js/suoni-dati.js      effetti sonori (dati e logica pura): categorie, eventi con le ricette, impostazioni, esiti → eventi
js/audio.js           effetti sonori: unico modulo Web Audio (sintesi, nodo master, limiti, coda, file in IndexedDB)
js/ui-suoni.js        gruppo «Suoni» nelle impostazioni, finestra «Tutti i suoni», pulsante rapido e Alt+M
js/tileset.js         logica pura dei TileSet: sorgenti, taglio (anche a copertura), id delle tile, proprietà, migrazioni
js/tile.js            logica pura del componente «Taglia immagine in tile» (X e Y, bordi parziali, flag)
js/tilemap.js         logica pura delle TileMap: livelli, pittura, timbri, regioni, trasformazioni, ingombro
js/collisioni.js      logica pura delle collisioni: poligoni, celle bloccate con soglia, info di cella
js/griglia.js         logica pura della griglia: dimensioni, pedine w×h, collisioni, sfondo, ridimensionamento
js/biomi.js           logica pura dei biomi: regole di viaggio, eredità, meteo, pericoli, incontri, scorte, mappa dei biomi
js/eventi.js          logica pura degli eventi: modelli, istanze, inneschi, visibilità, condizioni, azioni ed esiti
js/esplorazione.js    logica pura dell'esplorazione: scala, gruppo, movimento, tempo, nebbia, pila delle mappe
js/ui-biomi.js, js/ui-eventi.js  Asset › Biomi ed Eventi (editor a blocchi, Prova evento, esporta/importa)
js/ui-mappa-esplorazione.js  disegno di biomi, eventi e nebbia; strumenti Bioma, Evento e Nebbia sulla griglia
js/ui-esplorazione.js schermata Esplorazione: gruppo, mappa, tempo e registro, finestra evento, combattimenti
js/layout-combattimento.js  layout del combattimento: larghezze, colonne aperte/chiuse, schede su schermi stretti
js/creature-dati.js   tabelle delle creature (GS, PE, taglie, danni, condizioni, abilità, Guida del DM) ed esempi
js/creature.js        logica pura delle creature: calcoli, testo delle azioni, difese, combattimento, stima del CS
js/boss.js            logica pura dei boss: temi (anche quelli dei leggendari, «lg:<id>»), fasi, promozione, stato nel combattimento
js/percorso.js        logica pura del Percorso leggendario: nodi, effetti, sblocco, grafo, raggiera, modelli, esempio
js/leggendario.js     logica pura dei leggendari: livelli, punti, effetti nei calcoli, abilità, magie al giorno, trasformazioni, palette
js/attrezzatura.js    catalogo dell'Attrezzatura: armi e armature base, bonus, danno, CA, inventario
js/oggetti-mappa.js   logica pura degli oggetti di mappa: stato, serrature, trappole, contenuto
js/validazione.js     validazione dei form con messaggi in italiano
js/dati.js            modello dati, migrazioni (fino alla versione 11), salvataggio (IndexedDB), import/export
js/sessioni.js        logica pura delle sessioni (visibilità, duplicazione, export/import)
js/ui-tileset.js      disegno delle tilemap, vista con zoom/pan, anteprime, importazione immagini
js/ui-tile.js         componente «Taglia immagine in tile» (strutture, oggetti di mappa, pannello Tile)
js/ui-pannello-tile.js  pannello Tile sotto la griglia: palette, strumenti, livelli
js/ui-asset.js        sezione Asset con le schede Strutture e Oggetti
js/ui-attrezzatura.js, js/ui-oggetti-mappa.js  catalogo dell'Attrezzatura, oggetti di mappa e pannello di interazione
js/ui-mostri.js       Nemici › Creature: elenco, form (riusato dai boss), scheda stampabile, stima del CS
js/ui-boss.js         Nemici › Boss (forgia, anteprima, evocazione) e boss nel combattimento (barre, ombra, effetti)
js/ui-percorso.js     editor della mappa a nodi del Percorso e modalità Sblocca (canvas)
js/ui-leggendario.js  Giocatori › Leggendari: elenco, scheda, trasformazioni, opzioni del master, Ascensione, combattimento
js/ia-dati.js         IA dei nemici (dati): pesi dei punteggi, archetipi, fazioni, costanti del pianificatore
js/ia.js              IA dei nemici (logica pura): archetipo, punteggi, visibilità, percorso, pianificazione del turno
js/ui-ia.js           comportamento nei form, anteprima del piano sulla griglia, finestra «Perché?»
js/note.js            note del master (logica pura): sanificazione, testo, pagine, salvataggio automatico
js/note-editor.js     editor di testo ricco delle note (contenteditable, tabelle, elenchi, colori)
js/ui-note.js         pulsante e pannello laterale delle note del master
js/ui-*.js            interfaccia delle altre sezioni
js/app.js             avvio, menù e navigazione
js/test.js            test della logica
```

**Nomi casuali:** aprendo `index.html` direttamente da file il browser non può leggere
`nomi.txt`, quindi la lista usata dall'app è in `js/nomi.js`. Per aggiungere o cambiare nomi
modifica quel file.

Gli script sono classici (non moduli ES) e condividono un solo oggetto globale `DnD`, così
l'app funziona anche aprendo `index.html` direttamente da file. Se modifichi i file e usi la
PWA, aumenta la versione di `CACHE` in `sw.js`.
