# Architettura di Session Forge

Documento di riferimento dopo il riordino (ottobre-novembre 2026). Descrive i livelli, le regole che li tengono
separati, i punti di aggancio e il modo di aggiungere codice senza rompere la struttura. Il README resta il manuale
delle funzioni e del modello dati.

## Principi

- **HTML, CSS e JavaScript puro**, senza librerie, bundler né server: si apre `index.html` (o lo si serve per la PWA).
- **Script classici e un solo namespace globale `DnD`.** Ogni file è un'IIFE
  `(function (DnD) { 'use strict'; … })(globalThis.DnD = globalThis.DnD || {});` che espone `DnD.<modulo>`.
  Niente moduli ES: non funzionerebbero aprendo il file da disco (`file://`).
- **L'ordine di caricamento conta** ed è la lista dei `<script>` in `index.html`; `test.html` la ripete (senza
  `app.js`, con `test.js`) e `sw.js` la copia nella cache (`FILES`). Il test «Elenchi dei file» controlla che le tre
  liste siano allineate.
- **Le dipendenze vanno solo verso i livelli più bassi.** Il grafo dei moduli non ha cicli: verificato con lo script
  di analisi del riordino (riferimenti `DnD.<modulo>` fuori dai commenti).

## Livelli

```
dati            tabelle e costanti modificabili (js/dati/, config.js)          nessuna dipendenza
  ↑
regole          funzioni pure di gioco, nessun DOM, disco o rete               dati, modello
  ↑               base: dadi, regole, misure → statistiche, combattenti
  ↑               mappa: tileset → tile/tilemap → collisioni → griglia → visione
  ↑               entità: creature, boss, percorso, scheda, leggendario, ia
  ↑               Mondo: fazioni → party/città/quest/npc → esplorazione, scene
stato           modello, normalizzazione, esempi, migrazioni, profili, archivio su disco, unione, backup
  ↑               stato/archivio-locale.js (in <head>) · modello.js (base, caricato presto) … stato/normalizza → esempi →
  ↑               migrazioni → dati.js → stato/profili → stato/archivio → sessioni → stato/srd → stato/unione → stato/backup
  ↑               rotte.js (instradamento su hash, puro) sta in fondo a questo gruppo
rete            protocollo, trasporto, codici, segnalazione, filtro, immagini, intenzioni, valutazione, sessione (js/rete/)
  ↑
interfaccia     DOM e canvas (ui-*.js, note-editor.js)                          base: ui-comune.js
  ↑
app.js          avvio, menù, scorciatoie, service worker
```

`modello.js` è la base dello stato ed è caricato subito dopo `config.js`, perché anche le regole lo usano (sessione
corrente, versione, punti d'accesso descritti sotto). `stato/archivio-locale.js` e `impostazioni.js` si caricano per
primi, prima del CSS: il primo sceglie il profilo attivo e la vista delle sue preferenze, il secondo applica tema e
dimensione del testo di quel profilo.

### Modulo di archivio e profili

Il **modulo di archivio** è l'unico che tocca lo storage del browser (localStorage, sessionStorage, IndexedDB,
`navigator.storage`, File System Access) ed è in due parti:

- `stato/archivio-locale.js` (in `<head>`, nessuna dipendenza): registro dei profili `sessionforge:profili` e profilo
  attivo, nomi degli archivi (`nomi(id)` → database `sessionforge-<id>`, prefisso `sessionforge-<id>:`; senza registro
  i nomi di sempre `dnd-battaglie`), e **`DnD.archivioLocale.preferenze`**: una vista con l'interfaccia di localStorage
  che salva le chiavi «dnd-battaglie:…» di tutti i moduli sotto il prefisso del profilo attivo. Ogni altro file usa
  questa vista, mai `localStorage`.
- `stato/archivio.js`: store dello stato sul database del profilo, migrazione ai profili (`migraProfili`, con backup
  prima e ripristino se fallisce), gestore dei profili (`gestoreProfili(env)`: crea, modifica, attiva, duplica,
  elimina, cancella tutti), spazio e persistenza, cartella di backup. Le operazioni lavorano su un **ambiente**
  (`ambienteReale()` o `ambienteMemoria()` per i test e per `index.html?prova`).

La forma dei profili (`stato/profili.js`), l'unione degli archivi importati (`stato/unione.js`) e la logica dei backup
(`stato/backup.js`, con la cartella come adattatore) sono funzioni pure. Cambiare profilo ricarica la pagina, così ogni
modulo rilegge il proprio archivio.

### Instradamento

`rotte.js` (puro) legge e scrive le rotte su hash (`#/home`, `#/master/<sezione>`, `#/gioca`, `#/online/ospita`,
`#/online/unisciti`), sceglie la rotta d'avvio e decide i permessi delle modalità (`consentita`: Giocatore e Spettatore
non aprono mai le sezioni del Master). `app.js` applica le rotte (`DnD.app.vai`, `home`, `show`), ascolta `hashchange`
/ `popstate` e mostra il portale (`ui-portale.js`) nella stessa pagina, senza ricaricare. Il `body` porta
`data-modo` (home, master, gioca, ospita, unisciti) e il CSS nasconde barra, note e dadi fuori dal Master.

### Cosa NON deve fare ogni livello

| Livello | Non deve |
|---|---|
| dati | contenere logica (eccezione: piccole funzioni di conversione in `dati/misure.js`, `dati/suoni.js`) |
| regole | toccare DOM, `localStorage`, IndexedDB o rete; leggere `DnD.store` (lo stato corrente si chiede a `modello.statoCorrente()`) |
| stato | toccare il DOM; leggere o scrivere lo storage fuori dal modulo di archivio (`stato/archivio-locale.js`, `stato/archivio.js`) |
| rete | mandare ai giocatori dati che non passano da `rete/filtro.js` (vista, eventi, testo degli esiti) |
| interfaccia | contenere regole di gioco nuove (vanno nelle regole e si chiamano da qui) |

## Punti di aggancio (dipendenze rovesciate)

Quando un modulo basso deve usare qualcosa di un modulo alto, il modulo basso offre una funzione `registra…` e il
modulo alto si registra al caricamento. Così il basso non conosce l'alto e non ci sono cicli.

| Chi offre l'aggancio | Funzione | Chi si registra | A cosa serve |
|---|---|---|---|
| `modello.js` | `registraNormalizzaCreatura` / `normalizzaCreatura` | `dati.js` | forme leggendarie, NPC e import di personaggi normalizzano creature annidate |
| `modello.js` | `registraFonteStato` / `statoCorrente` | `stato/archivio.js` | valori predefiniti delle regole (talenti, catalogo, TileSet) |
| `griglia.js` | `registraRidimensionamento` | `esplorazione.js` | biomi, eventi, nebbia e luce seguono le celle |
| `griglia.js` | `registraVisioneVuota` | `visione.js` | luce e nebbia vuote per una griglia salvata che non le ha |
| `scheda.js` | `registraLivelloLeggendario` | `leggendario.js` | grado delle abilità dal Percorso |
| `ui-riposi.js` | `registraRiposoEsplorazione` | `ui-esplorazione.js` | riposo del gruppo durante un'esplorazione |
| `ui-combattimento.js` | `registraAgganci` | `ui-esplorazione.js`, `ui-online.js` | striscione e fine dello scontro, pulsante «Online», ping |
| `ui-impostazioni.js` | `registraOnline` | `ui-online.js` | pulsanti online del pannello Impostazioni |
| `ui-comune.js` | `DnD.app` (dichiarata) | `app.js` | navigazione (anche `vai`, `home`, `modo`), aggiornamento, sessioni, sessioni recenti |
| `dati.js` | facciata `DnD.dati` | `stato/archivio.js` | aggiunge `openStore` e `saveErrorMessage` |

## Componenti grandi divisi in parti

Le parti ricevono dal componente un oggetto **`api`** con lo stato condiviso e le funzioni che usano; lo stato
condiviso è un unico oggetto **`S`**, così le parti lo leggono e lo modificano senza variabili globali.

- **Griglia** (`ui-griglia.js` → `DnD.uiGriglia.create(opts)`): `ui-griglia-disegno.js` (colori dal tema e primitive
  di disegno, `primitive(api)`), `ui-griglia-pannello.js` (pannello laterale, `pannello(api)`),
  `ui-griglia-puntatore.js` (mouse e tastiera, `puntatore(api)`). Il ciclo `draw()` e l'API pubblica restano in
  `ui-griglia.js`.
- **Combattimento** (`ui-combattimento.js` → `DnD.sezioni.combattimento`, `DnD.uiCombattimento`):
  `ui-combattimento-preparazione.js`, `-incantesimi.js`, `-ia.js`, `-creature.js` (anche la schermata attiva),
  `-mondo.js`, più `ui-colonne.js` (tre colonne, condivisa con Esplorazione e Online). L'ordine delle chiamate alle
  fabbriche conta: chi riceve una funzione di un'altra parte va chiamato dopo, oppure la riceve con un rimando
  `(...a) => funzione(...a)`. Le regole del combattimento attivo stanno sotto, in `combattimento.js` (livello regole,
  `DnD.combattimento`: `danno`, `dopoAzione`, `attacco`, `lancio`, `tiroSalvezza`, `inizioTurno`, `prossimoTurno`); l'interfaccia apre
  `mutate`, tira i dadi con il registratore e mostra avvisi e suoni.
- **Stato** (`dati.js`, facciata): `stato/normalizza.js`, `stato/esempi.js`, `stato/migrazioni.js`, `stato/archivio.js`.

## Una sola fonte di verità

| Regola | Dove |
|---|---|
| modificatore, bonus di competenza, tiro per colpire, salvezze, «in fin di vita» | `regole.js` |
| valori derivati di una scheda (talenti, iniziativa, velocità, CA, armi) | `statistiche.js` |
| misure: 1 casella = 5 ft = 1,5 m, caselle da metri, scala delle mappe | `dati/misure.js` |
| blocco delle celle | `griglia.isCellBlocked` |
| chi vede chi | `visione.canSee` |
| ostilità tra combattenti | `fazioni.ostili` / `relazioneCombattenti` |
| monete, valori in rame, peso delle monete | `attrezzatura.js` |
| GS e PE | `creature.xpForCr`, `difficolta.crOf` |
| sanificazione dell'HTML | `note.sanitizeHtml` |
| file da scaricare, nomi di file, data | `DnD.ui.download`, `slug`, `today` (`ui-comune.js`) |
| sessione corrente, visibilità nelle sessioni | `modello.current`, `isVisible`, `visible` |
| profilo attivo, nomi degli archivi, preferenze | `archivioLocale.attivo`, `nomi`, `preferenze` |
| rotte e permessi delle modalità | `rotte.analizza`, `formatta`, `iniziale`, `consentita` |
| gettoni di rientro (per partita) e ripresa (per sessione) | `ui-online.js` (`partite`, `ripresaDi`), nelle preferenze del profilo |
| testi inviati ai giocatori | `rete/filtro.js` (`istantanea`, `differenze`, `testoEsito`) |

## Come aggiungere una funzione senza rompere i livelli

1. Decidi il livello: dato modificabile → `js/dati/`; regola di gioco → modulo di regole (puro); salvataggio o forma
   dei dati → `js/stato/`; finestra o disegno → `ui-*.js`.
2. Usa solo moduli di livelli uguali o più bassi. Se ti serve qualcosa di un livello più alto, offri un aggancio
   (`registra…`) nel modulo basso e registralo da quello alto.
3. Se aggiungi un file: intestazione di 3-8 righe (scopo, livello, cosa espone, da cosa dipende, cosa non deve fare),
   poi aggiorna **tutte e tre** le liste (`index.html`, `test.html`, `sw.js`) nello stesso punto dell'ordine.
4. Scrivi i test della logica pura in `js/test.js` e aggiorna il README (funzioni, «Struttura», modello dati).
5. Alza `CACHE` in `sw.js` (`session-forge-vNN`).

## Test

- `test.html` servito (`python .claude/servi.py 5617`, senza cache del browser) in una finestra **visibile**.
- `test(nome, fn)` in `js/test.js`; aiuti `eq`, `ok`, `seq(...)` (dadi deterministici). `DnD.runTests('parte del nome')`
  esegue solo i test scelti.
- Reti di sicurezza: «Migrazione: l'archivio di esempio…» (`test/fixture/archivio-v18.json` normalizzato confrontato
  con `atteso-v18.json`), «Fumo: …» (l'app vera in un iframe con `index.html?prova`: archivio in memoria, nessun
  service worker), «Griglia UI: …» e «Combattimento UI: …» (caratterizzazione dell'interfaccia), «Elenchi dei file».

## Versioni e migrazioni dei dati

- Versione del modello: `modello.VERSION` (oggi **19**: provenienza degli incantesimi, solo normalizzazione), salvata nello stato e nei file esportati.
- I dati grezzi (salvati o importati) passano da `migrazioni-tile.migrateRaw` (v5-v7) e da
  `migrateV8 … migrateV18` (`stato/migrazioni.js`), poi dalla normalizzazione (`stato/normalizza.js`).
- Cambiare lo schema: nuova funzione `migrateVNN` in fila, `VERSION` + 1, fixture nuova in `test/fixture/`, sezione
  «Modello dati» del README.
- Gli incantesimi dell'SRD 5.1 sono dati generati (`js/dati/srd-incantesimi.js`) da uno strumento di sviluppo fuori
  dall'app (`strumenti/estrai-srd.js`, Node + `pdftotext`, non in cache). L'analisi del testo (`js/srd-analisi.js`,
  livello regole) è la stessa usata dallo strumento e provata dai test; l'importazione nella libreria è in
  `js/stato/srd.js` (livello stato), che salva tramite lo store ricevuto e annulla tutto se la scrittura non riesce.
- Le preferenze di visualizzazione (chiavi `dnd-battaglie:…` nella vista del profilo) non hanno versione: si leggono
  con valori di ripiego.
- Il **registro dei profili** ha una versione propria (`profili.VERSIONE`, oggi **1**), indipendente da quella dello
  stato: `archivio.migraProfili` porta i dati di prima dei profili (versione 0: database `dnd-battaglie`) nel profilo
  «Master». Una nuova forma del registro: nuovo passo in `migraProfili`, `VERSIONE` + 1, test con
  `test/fixture/profili-prima.json`.

## Rilascio

1. Tutti i test verdi in `test.html` (finestra visibile).
2. `CACHE` in `sw.js` aumentata, così i client scaricano i file nuovi; il test «Elenchi dei file» verde.
3. Commit in italiano; README e questo documento aggiornati se la struttura è cambiata.
