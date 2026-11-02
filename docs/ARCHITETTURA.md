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
stato           modello, normalizzazione, esempi, migrazioni, archivio su disco
  ↑               modello.js (base, caricato presto) … stato/normalizza → esempi → migrazioni → dati.js → stato/archivio
rete            protocollo, trasporto, codici, segnalazione, filtro, immagini, intenzioni, sessione (js/rete/)
  ↑
interfaccia     DOM e canvas (ui-*.js, note-editor.js)                          base: ui-comune.js
  ↑
app.js          avvio, menù, scorciatoie, service worker
```

`modello.js` è la base dello stato ed è caricato subito dopo `config.js`, perché anche le regole lo usano (sessione
corrente, versione, punti d'accesso descritti sotto). `impostazioni.js` si carica per primo, prima del CSS, per
applicare tema e dimensione del testo.

### Cosa NON deve fare ogni livello

| Livello | Non deve |
|---|---|
| dati | contenere logica (eccezione: piccole funzioni di conversione in `dati/misure.js`, `dati/suoni.js`) |
| regole | toccare DOM, `localStorage`, IndexedDB o rete; leggere `DnD.store` (lo stato corrente si chiede a `modello.statoCorrente()`) |
| stato | toccare il DOM; scrivere su disco fuori da `stato/archivio.js` |
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
| `ui-comune.js` | `DnD.app` (dichiarata) | `app.js` | navigazione, aggiornamento, sessioni per tutte le sezioni |
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

- Versione del modello: `modello.VERSION` (oggi **18**), salvata nello stato e nei file esportati.
- I dati grezzi (salvati o importati) passano da `migrazioni-tile.migrateRaw` (v5-v7) e da
  `migrateV8 … migrateV18` (`stato/migrazioni.js`), poi dalla normalizzazione (`stato/normalizza.js`).
- Cambiare lo schema: nuova funzione `migrateVNN` in fila, `VERSION` + 1, fixture nuova in `test/fixture/`, sezione
  «Modello dati» del README.
- Le preferenze di visualizzazione (`localStorage`, chiavi `dnd-battaglie:…`) non hanno versione: si leggono con
  valori di ripiego.

## Rilascio

1. Tutti i test verdi in `test.html` (finestra visibile).
2. `CACHE` in `sw.js` aumentata, così i client scaricano i file nuovi; il test «Elenchi dei file» verde.
3. Commit in italiano; README e questo documento aggiornati se la struttura è cambiata.
