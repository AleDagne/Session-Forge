# Audit del codice — Session Forge (Riordino 1/2)

Data: 27 ottobre 2026 · Commit di riferimento: `7cdff51` (fase online 3/3) · Nessun file del progetto modificato.
Metodo: lettura mirata dei file + script di analisi statica temporanei (grafo `DnD.<modulo>`, conteggi, stima della
lunghezza delle funzioni per graffe, export non usati), esecuzione di `test.html` nel browser integrato.
Le stime automatiche (righe di funzione, export non usati, classi CSS) sono **approssimate**: dove un dato non è stato
verificato a mano è scritto «da verificare».

Elenco di bug noti passato dall'utente: **nessuno** (il messaggio non ne conteneva).

---

## 1. Riepilogo

Il codice è in **buona salute per un progetto cresciuto a fasi**: le regole pure sono quasi tutte centralizzate
(`regole.modifier`, `regole.proficiencyBonus`, `fazioni.ostili`, `griglia.isCellBlocked`, `visione.canSee`,
`condizioni.*Mods`), la persistenza ha un unico store con coda di scrittura ed esito reale, le migrazioni sono
concatenate, l'HTML delle note/scene/schede passa da una whitelist (`note.sanitizeHtml`), il filtro online è
ampio e testato. **308 test su 309 passano.** Nessun `TODO/FIXME`, un solo `console.*`, `execCommand` isolato.

I problemi sono soprattutto di **dimensione e accoppiamento**: 73 dei 107 file JS dell'app stanno in un'unica componente
fortemente connessa del grafo (tutto dipende da tutto tramite `DnD.*` risolto a runtime), alcuni file UI sono
enormi (`ui-combattimento.js` 2157 righe, `ui-griglia.js` con una funzione `create` di ~1370 righe), e alcune
regole pure dipendono da moduli UI o da `DnD.app`.

**I 5 problemi più gravi**

1. **A1 — Fuga di dati nascosti nel gioco online**: la risposta `esito` a un'intenzione del giocatore porta come
   testo l'ultima riga del registro di combattimento (`ui-combattimento.js:144`, `:2129` → `rete/sessione.js:451`),
   **senza passare da `rete/filtro.js`**. Le righe del registro contengono i PF esatti del bersaglio
   (`ui-combattimento.js:670` «Nome: 12 → 5 PF.», `:1613`, `:1828`) che il filtro nasconde per i nemici.
2. **A2 — Ciclo di dipendenze gigante**: 73 file in un'unica componente; le regole «pure» chiamano `DnD.app`,
   `DnD.dati` e perfino moduli UI (`rete/sessione.js` → `DnD.uiCombattimento`), quindi non sono testabili da sole
   né spostabili senza caricare tutto.
3. **A3 — File/funzioni giganti**: `ui-griglia.create` (~1370 righe), `note-editor.create` (~635),
   `rete/sessione.master` (~784), `ui-scheda.editor` (~570), `ui-percorso.create` (~562), `ui-pannello-tile.create`
   (~451), `ui-tile.cutter` (~441), `ia.pianificaTurno` (~293), `audio.crea` (~332). Toccarli è rischioso.
4. **A4 — Regole di gioco dentro la UI**: `ui-combattimento.js` contiene la risoluzione di attacchi, incantesimi,
   cure, azioni delle creature (`performAttack`, `performCast` ~96 righe, `performCreatureAction` ~81) usata
   anche dal master online; non coperta da test unitari puri.
5. **A5 — «Cancella tutti i dati» non cancella tutto**: rimangono in `localStorage` i gettoni del gioco online
   (`online-gettone`, `online-ripresa`), il profilo, le note online e tutte le preferenze; il backend IndexedDB
   cancella solo il proprio archivio. Da decidere se è voluto (vedi Domande).

---

## 2. Mappa dei moduli

Legenda: **R** = righe; ⚠ = file > 600 righe; «usato da» = numero di file che nominano il modulo (fan‑in, test
esclusi) o i principali. Export = proprietà di `DnD`.

### 2.1 Avvio, configurazione, dati puri (nessuna dipendenza o quasi)

| File | R | Scopo | Export | Usato da |
|---|---|---|---|---|
| js/impostazioni.js | 124 | tema, testo, animazioni ridotte, effetti boss (prima del CSS) | `impostazioni` | ui-*, audio |
| js/config.js | 36 | nome app, voci del menù | `config` | app, ui-comune, scheda, sessioni… |
| js/dadi.js | 192 | RNG senza bias, parser «3d6+2», registratore | `dadi` | 60 file (il più usato) |
| js/classi.js | 90 | 12 classi 5e | `classi` | 19 file |
| js/colori.js | 46 | palette 14 colori | `colori` | icone, ui-* |
| js/libreria-icone.js | 261 | silhouette SVG originali | `libreriaIcone` | icone, ui-icone |
| js/creature-dati.js | 183 | taglie, tipi, GS, PE | `creatureDati` | 23 file |
| js/difficolta-dati.js | 55 | soglie PE DMG | `difficoltaDati` | difficolta, ui-* |
| js/equipaggiamento.js | 51 | equipaggiamento per classe | `equipaggiamento` | generatore |
| js/ia-dati.js | 48 | pesi IA | `iaDati` | ia, movimento, ui-ia, ui-combattimento |
| js/mondo-dati.js | 200 | fazioni predefinite, soglie reputazione | `mondoDati` | fazioni, citta, npc, quest |
| js/riposi-dati.js | 22 | durate e varianti dei riposi | `riposiDati` | riposi, esplorazione, ui-riposi |
| js/scene-dati.js | 71 | tipi/stati/esiti scene | `sceneDati` | scene, ui-scene |
| js/scheda-dati.js | 134 | allineamenti, punti, soglie PE | `schedaDati` | scheda |
| js/suoni-dati.js | 259 | ricette dei suoni | `suoniDati` | audio, ui-suoni |
| js/visione-dati.js | 102 | luce, sensi, modi nebbia | `visioneDati` | visione, ui-visione |
| js/layout-combattimento.js | 65 | larghezze colonne (puro + storage iniettato) | `layoutCombattimento` | ui-combattimento |
| js/nomi.js | 88 | nomi generati (copia di nomi.txt) | `nomi` | ui-creature |

### 2.2 Regole e dominio (logica pura)

| File | R | Scopo | Export | Note |
|---|---|---|---|---|
| js/regole.js | 434 | regole 5e: modificatori, competenza, attacchi, TS, statistiche derivate, combattenti | `regole` | fan‑in 41; dipende da 14 moduli (anche `DnD.app`, da verificare se solo commento) |
| js/magie.js | 133 | CD, attacco, slot, lancio | `magie` | dipende da `dati` |
| js/condizioni.js | 533 | condizioni, concentrazione, TS morte | `condizioni` | |
| js/riposi.js | 321 | riposi e risorse sui «soggetti» | `riposi` | |
| js/movimento.js | 393 | velocità, costi, distanza con regole diagonali | `movimento` | |
| js/griglia.js | 562 | modello griglia, forme, blocco celle | `griglia` | fan‑in 34 |
| js/collisioni.js | 159 | poligoni delle tile | `collisioni` | |
| js/tileset.js | 375 | libreria TileSet | `tileset` | contiene `migrateV7`, `migrateLegacy` |
| js/tile.js | 123 | «Taglia immagine in tile» | `tile` | |
| js/tilemap.js | 522 | mappe dipinte | `tilemap` | dipende da `DnD.app` (da verificare) |
| js/visione.js | 655 ⚠ | luce, vista, nebbia | `visione` | |
| js/creature.js | 551 | Manuale dei Mostri | `creature` | ciclo con `ia` |
| js/boss.js | 252 | fasi e temi dei boss | `boss` | colori esadecimali (32) nei temi |
| js/biomi.js | 366 | terreni | `biomi` | |
| js/eventi.js | 542 | eventi di esplorazione | `eventi` | `exec` ~124 righe |
| js/esplorazione.js | 589 | viaggio, tempo, scoperta | `esplorazione` | |
| js/percorso.js | 334 | grafo leggendario | `percorso` | |
| js/leggendario.js | 419 | effetti e trasformazioni | `leggendario` | dipende da `dati` |
| js/attrezzatura.js | 290 | catalogo oggetti, monete | `attrezzatura` | ciclo con `regole` |
| js/oggetti-mappa.js | 183 | forzieri, porte… | `oggettiMappa` | |
| js/fazioni.js | 324 | relazioni e reputazione | `fazioni` | unica fonte dell'ostilità |
| js/party.js | 96 | party | `party` | |
| js/citta.js | 95 | città | `citta` | |
| js/npc.js | 491 | NPC, mercanti, dialoghi | `npc` | dipende da `dati` |
| js/quest.js | 269 | quest | `quest` | |
| js/difficolta.js | 223 | difficoltà incontri | `difficolta` | |
| js/scene.js | 582 | scene e incontri | `scene` | dipende da `dati`, `sessioni` |
| js/scheda.js | 401 | scheda del giocatore | `scheda` | dipende da `app`, `dati` |
| js/ia.js | 689 ⚠ | IA dei nemici | `ia` | `pianificaTurno` ~293 righe |
| js/generatore.js | 205 | generatore di nemici | `generatore` | dipende da `dati` |
| js/note.js | 263 | sanificazione HTML note | `note` | |
| js/icone.js | 216 | icone/forme | `icone` | usa `document` (canvas, immagini) |
| js/immagini.js | 208 | impronta immagini, archivio IndexedDB | `immaginiLib` | usa `document` |
| js/audio.js | 403 | Web Audio | `audio`, `audioLib` | `crea` ~332 righe |

### 2.3 Dati, sessioni, validazione

| File | R | Scopo | Export |
|---|---|---|---|
| js/validazione.js | 214 | validazione dei form | `validazione` |
| js/dati.js | 1344 ⚠ | modello v18, esempi, normalizzazione, migrazioni V8–V12, import/export, store IndexedDB/localStorage | `dati` (+ `normalizeGridSize` esportato due volte nell'oggetto) |
| js/sessioni.js | 313 | sessioni: crea/duplica/esporta, remap | `sessioni` |

### 2.4 Rete (`js/rete/`, tutti esportano su `DnD.rete`)

| File | R | Scopo |
|---|---|---|
| protocollo.js | 198 | messaggi versionati, `SCHEMI` (~91 righe), `pulisciTesto` |
| trasporto.js | 120 | canale astratto / `coppiaMemoria` |
| codici.js | 88 | codici invito/risposta compressi |
| segnalazione.js | 154 | WebRTC, STUN in localStorage, diagnostica ambiente |
| filtro.js | 636 ⚠ | vista del giocatore, differenze/eventi |
| immagini.js | 59 | immagini a pezzi |
| intenzioni.js | 377 | schemi, permessi, economia d'azione, verifiche |
| sessione.js | 1101 ⚠ | master/giocatore; `master` ~784 righe; dipende da `DnD.uiCombattimento` e `DnD.ui` |

### 2.5 Interfaccia

| File | R | Scopo | Funzioni > 60 righe (stima) |
|---|---|---|---|
| ui-comune.js | 212 | `el`, `fill`, menù, dialoghi, toggle persistenti | — |
| ui-condizioni.js | 245 | condizioni nella UI | dialog 94, draw 69 |
| ui-riposi.js | 196 | riposi | restDialog 67 |
| ui-difficolta.js | 206 | indicatore difficoltà | rulesDialog 77 |
| ui-icone.js | 121 | selettore icona | iconPicker 103 |
| ui-razze.js | 137 | sezione Razze | renderForm 81 |
| ui-magie.js | 259 | sezione Magie | renderForm 125 |
| ui-incantesimi.js | 139 | editor incantesimi nei form | spellcastingEditor 121 |
| ui-asset.js | 70 | sezione Asset (schede) | — |
| ui-oggetti-mappa.js | 338 | oggetti di mappa | renderForm 116, openPanel 120 |
| ui-ia.js | 125 | editor IA | — |
| ui-scheda.js | 909 ⚠ | scheda giocatore | editor ~570 |
| ui-creature.js | 938 ⚠ | Nemici/Giocatori | createSection ~358, renderForm 179, editor vari 62–108 |
| ui-mostri.js | 459 | Creature | monsterForm ~295 |
| ui-boss.js | 619 ⚠ | Boss | bossFields 108 |
| ui-percorso.js | 610 ⚠ | Percorso su canvas | create ~562, draw ~198 |
| ui-leggendario.js | 613 ⚠ | Leggendari | — |
| ui-generatore.js | 212 | generatore | open 142 |
| ui-tileset.js | 377 | TileSet | viewport 90 |
| ui-tile.js | 491 | taglia in tile | cutter ~441 |
| ui-strutture.js | 344 | strutture | renderForm 179 |
| ui-attrezzatura.js | 171 | attrezzatura | renderForm 102 |
| ui-biomi.js | 268 | biomi | renderForm 166 |
| ui-eventi.js | 365 | eventi | actionsEditor 143, fieldsOf 97 |
| ui-mondo.js | 520 | Mondo | cityForm 76 |
| ui-party.js | 177 | party | renderForm 71 |
| ui-npc.js | 677 ⚠ | NPC | tradeWindow 93, dialogRunner 81 |
| ui-quest.js | 320 | quest | renderForm 86 |
| ui-scene.js | 708 ⚠ | scene | sceneForm 102, encounterFields 66 |
| note-editor.js | 692 ⚠ | editor ricco | create ~635 |
| ui-note.js | 314 | pannello note | create ~290 |
| ui-dadi.js | 335 | dadi e animazione | mount 108, animate 71 |
| ui-griglia.js | 1579 ⚠ | canvas griglia | **create ~1370**, draw 155, drawToken 108 |
| ui-pannello-tile.js | 505 | pannello Tile | create ~451 |
| ui-visione.js | 556 | luce/nebbia | create ~474 e interne 62–85 |
| ui-mappa-esplorazione.js | 381 | biomi su canvas | create ~234 |
| ui-editor-griglie.js | 478 | Editor griglie | propsDialog 145 |
| ui-combattimento.js | 2157 ⚠ | Combattimento | renderSetup 189, castDialog 102, performCast 96, getGrid 83, performCreatureAction 81, columns 73 |
| ui-esplorazione.js | 693 ⚠ | Esplorazione | renderActive 91 |
| ui-sessioni.js | 109 | sessioni | — |
| ui-suoni.js | 147 | impostazioni suoni | — |
| ui-impostazioni.js | 219 | impostazioni, esporta/cancella | mount 111 |
| ui-online.js | 1513 ⚠ | gioco online | aggiornaPannello 84, testConnessione 81, renderGiocatore 76, scheletro 70 |
| app.js | 163 | avvio, nav | — |

Altri file: `index.html` (142), `test.html` (144), `js/test.js` (6860 ⚠), `sw.js` (39), `manifest.json`,
`css/style.css` (1495 ⚠), `css/boss.css` (381), `css/leggendario.css` (232), `css/dadi.css` (112),
`icons/icon.svg`, `nomi.txt` (70, sorgente di `nomi.js`), `README.md` (1996), `RIPRESA-LAVORO.md` (361), `CLAUDE.md`.

Funzioni lunghe anche nei moduli puri: `dati.normalizeCreature` 99, `dati.normalizeCombatant` 82,
`dati.openStore` 93, `dati.normalizeState` 67, `ia.attackPlan` 79, `ia.supportPlan` 64, `scene.buildCombat` 79,
`sessioni.exportSessionData` 72, `generatore.generateEnemy` 67, `movimento.reach` 63, `esplorazione.advanceTime` 61,
`immagini.createStore` 62; `rete/sessione` `valuta` ~221, `api` ~221, `giocatore` ~222, `ricevi` 70/89.

---

## 3. Grafo delle dipendenze

Le dipendenze passano tutte dal **namespace globale `DnD`** risolto a runtime (nessun import). L'ordine dei
`<script>` conta solo per il codice eseguito al caricamento; le chiamate dentro funzioni funzionano anche «all'indietro»,
ed è così che nascono i cicli senza errori. Nota: lo script conta anche i `DnD.x` citati nei commenti, per cui
alcune frecce (es. `regole → app`, `tilemap → app`, `scheda → app`) sono **da verificare**.

### 3.1 Schema a livelli (dipendenze reali, semplificato)

```
dati puri ── config, dadi, classi, colori, libreria-icone, *-dati.js, equipaggiamento, nomi, layout-combattimento
   ▲
regole ⇄ attrezzatura, condizioni, magie, creature, boss, leggendario, riposi, scheda, ia   (ciclo «regole»)
griglia ⇄ tilemap ⇄ tileset, collisioni ⇄ tilemap, griglia ⇄ visione ⇄ esplorazione       (ciclo «mappa»)
fazioni ⇄ party, quest, sessioni                                                             (ciclo «mondo»)
   ▲
dati.js ⇄ magie, leggendario, npc, scene, scheda, sessioni, generatore                      (dati chiamato dal dominio)
   ▲
rete/* ── filtro (21 moduli), intenzioni (10), sessione (13, incluso ui-combattimento!)
   ▲
ui-comune ⇄ app;  ui-* ⇄ ui-* (vedi 3.2);  app ⇄ ui-dadi, ui-impostazioni, ui-note, ui-online, ui-sessioni, ui-tileset
```

### 3.2 Cicli diretti (coppie che si chiamano a vicenda)

- Dominio: `attrezzatura⇄regole`, `boss⇄leggendario`, `boss⇄regole`, `collisioni⇄tilemap`, `condizioni⇄regole`,
  `creature⇄ia`, `creature⇄regole`, `dati⇄leggendario`, `dati⇄magie`, `dati⇄npc`, `dati⇄scene`, `dati⇄scheda`,
  `dati⇄sessioni`, `esplorazione⇄griglia`, `esplorazione⇄visione`, `fazioni⇄party`, `fazioni⇄quest`,
  `fazioni⇄sessioni`, `griglia⇄tilemap`, `griglia⇄visione`, `ia⇄regole`, `leggendario⇄regole`,
  `leggendario⇄scheda`, `magie⇄regole`, `regole⇄riposi`, `regole⇄scheda`, `scene⇄sessioni`, `tilemap⇄tileset`.
- UI: `app⇄ui-comune`, `app⇄ui-dadi`, `app⇄ui-impostazioni`, `app⇄ui-note`, `app⇄ui-online`, `app⇄ui-sessioni`,
  `app⇄ui-tileset`, `ui-boss⇄ui-creature`, `ui-combattimento⇄ui-esplorazione`, `ui-combattimento⇄ui-online`,
  `ui-creature⇄ui-generatore`, `ui-creature⇄ui-mostri`, `ui-creature⇄ui-scheda`, `ui-esplorazione⇄ui-riposi`,
  `ui-impostazioni⇄ui-online`, `ui-mondo⇄ui-npc`, `ui-mondo⇄ui-quest`, `ui-strutture⇄ui-tileset`.
- **Componente fortemente connessa: 73 file** (praticamente tutto il dominio, dati, e tutta la UI). Fuori restano
  solo i file di dati puri, `dadi`, `icone`, `immagini`, `impostazioni`, `audio`, `layout-combattimento` e `rete/*`
  esclusa `sessione.js` (che entra nel ciclo via `ui-combattimento`).

### 3.3 Moduli che sanno troppo

| Modulo | Fan‑out | Commento |
|---|---|---|
| ui-combattimento.js | 53 | conosce quasi tutta l'app, incluse 20 altre UI |
| dati.js | 38 | normalizza ogni entità chiamando ogni modulo di dominio |
| ui-creature.js | 34 | |
| ui-esplorazione.js | 32 | |
| ui-scheda.js | 29 | |
| ui-online.js | 27 | |
| rete/filtro.js | 21 | inevitabile (deve conoscere ogni entità), ma è puro |
| regole.js | 15 | dovrebbe essere una foglia; invece chiama ia, leggendario, boss, scheda, riposi… |

Fan‑in più alti: `dadi` 60, `ui-comune` 44, `app` 42, `regole` 41, `griglia` 34, `icone` 34, `sessioni` 33, `dati` 33.

### 3.4 Stato globale condiviso

| Globale | Scritto da | Letto da |
|---|---|---|
| `globalThis.DnD` (namespace) | ogni file | ogni file |
| `DnD.store` (stato + `update/save/replace`, `onChange`, `onSaveError`, `blobs`) | `app.js` (avvio), test | ~33 file; `rete/sessione` via `onChange` |
| `DnD.store.state` (mutato direttamente in molti `update(fn)`) | tutte le UI | tutte le UI, filtro |
| `DnD.immagini` (store immagini, creato in app.js) | app.js | audio, ui-tile, ui-tileset, ui-editor-griglie, ui-impostazioni |
| `DnD.store.onChange` → `master.aggiorna()` | ui-online.js | dati.js (save) |
| `document.documentElement.dataset.*` (theme, reduceMotion, bossEffects) | impostazioni.js | CSS, ui-boss, ui-dadi, test |
| `DnD.testInCorso`, `DnD.runTests` | test.js | test.html |
| `DnD.sezioni`, `DnD.schede` (registri di sezioni) | ui-*.js che li riempiono | app.js, ui-asset.js |
| `DnD.uiCombattimento.online` | ui-combattimento.js | rete/sessione.js |
| `lastTiro` (variabile di modulo) | ui-combattimento.js | `online.*` — stato nascosto tra funzioni |

Eventi: `DnD.store.onChange` (un solo ascoltatore alla volta, assegnazione diretta), `onSaveError`, listener
`window`/`document` (26), `storage`? (non trovato). Archivi: vedi sezione 6.

---

## 4. Separazione dei livelli

| Modulo | Logica | UI | Salvataggio | Note |
|---|---|---|---|---|
| regole, condizioni, magie, movimento, griglia, visione, fazioni… | ✔ | — | — | puri, ma con cicli |
| icone.js, immagini.js | ✔ | usa `document` (canvas/Image) | IndexedDB (immagini) | misti, non testabili senza DOM |
| audio.js | ✔ | Web Audio, `window` | localStorage | atteso |
| impostazioni.js | ✔ | `document.documentElement` | localStorage | atteso (gira prima del CSS) |
| dati.js | normalizzazione | — | IndexedDB + localStorage | mescola modello, esempi, migrazioni e persistenza in 1344 righe |
| rete/segnalazione.js | ✔ | — | localStorage (STUN) | lettura di `indexedDB` solo per diagnostica |
| rete/sessione.js | ✔ | usa `DnD.ui` (da verificare dove) | — | **esegue tramite `DnD.uiCombattimento.online`** |
| ui-combattimento.js | **regole di combattimento** | ✔ | tramite store | vedi sotto |
| ui-esplorazione.js, ui-scene.js, ui-online.js | parti di flusso di gioco | ✔ | tramite store | |

**Regole nella UI (da spostare in futuro):**
- `ui-combattimento.js`: `performAttack`, `performCast` (~96 righe), `performCreatureAction` (~81), cure
  (`:1596–1613`), `performSave`, `moveAction`, testi del registro con PF; `hurt()`/`conditionsAfter()` applicano
  concentrazione e condizioni; ricalcolo GS effettivo per la setup (`:893`).
- `ui-dadi.js:263` `rollD20` (usa correttamente `regole.rollSave`, ma l'etichetta/modi sono ricostruiti in UI).
- Liste `['normale','vantaggio','svantaggio']` ripetute in 6 punti UI (`ui-combattimento:1347`, `ui-eventi:193`,
  `ui-online:344,360,1151`, `ui-dadi:309`) invece di una costante in `regole`.
- `ui-scheda.js:388` usa `Math.random` per i suggerimenti (fuori dal RNG di `dadi`).
- `ui-mappa-esplorazione.js:280` seme casuale con `Math.random`.

**Regole che toccano DOM o disco:** `icone.js` e `immagini.js` (canvas), `layout-combattimento.js` (storage
iniettato, ok), `regole.js` cita `localStorage` solo nel commento d'intestazione (ok).

---

## 5. Duplicazioni

| Regola | Dove | Somiglianza | Versione giusta |
|---|---|---|---|
| Modificatore di caratteristica | `regole.modifier` (unica formula); alias locali `mod` in attrezzatura:94, creature:57, leggendario:234/269, generatore:66 | alias, nessuna copia della formula | `regole.modifier` ✔ |
| Formattazione del segno | `regole.formatModifier` (`-`) vs `creature.signed` (`−` tipografico, `creature.js:187`); `ui-mostri.js:22` ridefinisce `signed` come alias | due output diversi per lo stesso numero | da decidere (vedi Domande) |
| Bonus di competenza | `regole.proficiencyBonus(level)` e `creature.profForCr(cr)` | regole diverse (livello vs GS), legittime | entrambe |
| Vantaggio/svantaggio | logica in `regole.rollD20`/`rollSave`; costanti dei modi in 6 UI | solo costanti duplicate | `regole` |
| Escape HTML | `note.escapeText`, `note.escapeAttr`, `esc` locale `note.js:136`, `esc` in `ui-note.js:227` | quasi identiche | `note.escapeText`/`escapeAttr` |
| Pulizia testo | `protocollo.pulisciTesto` (rete), `filtro.testoPulito` (rimuove «Nota del master»), `note.sanitizeHtml` | scopi diversi | tenere separate, documentare |
| Distanza tra pedine | `griglia.cellDistance` (Chebyshev) vs `movimento.distance(a,b,rules)` (regole diagonali) | la prima ignora la regola 5‑10‑5 | `movimento.distance` per il gioco; `cellDistance` solo per geometria (da verificare chi usa quale per gittata) |
| Piedi ↔ celle ↔ metri | `griglia.js:297` (`feetPerCell`), `movimento` (`feetFromMeters`, `metersFromFeet`, `cellsOf`), `config.js` e altri usano `1.5`/`0.3048` letterali (81 occorrenze, incluse icone SVG: falso positivo parziale) | sparse | `movimento` |
| Ostilità | `fazioni.ostili/alleati`; `ia.isHostile/isAlly` e `movimento.js:224` sono alias | alias | `fazioni` ✔ |
| Blocco celle | `griglia.isCellBlocked` (unico) | — | ✔ |
| Tiri di dado | `dadi` (crypto) ovunque; eccezioni `Math.random` in ui-dadi (2, animazione), audio (2, rumore), ui-scheda, ui-mappa-esplorazione, boss.js:36 (fallback uid) | | `dadi` per tutto ciò che conta |
| Monete | `attrezzatura.formatCost`, `dati.parseCost` (vecchi «50 mo»), `npc.basePrice/unitSellPrice/unitBuyPrice`, `fazioni.priceFactor` | ruoli diversi | ok; `parseCost` è solo migrazione |
| GS e PE | `creature.xpForCr`, `difficolta.xpOf` (alias), `difficolta.crOf`; `creature.formatXp` | alias | ✔ |

In generale la duplicazione di **regole** è bassa; quella di **costanti e piccoli helper** è media.

---

## 6. Codice morto e residui

### 6.1 Export mai nominati fuori dal proprio file (candidati, **da verificare** uno per uno)

Lo script ha trovato ~230 export non citati da altri file (molti sono usati internamente o solo dai test, quindi
non necessariamente morti). Quelli **non usati nemmeno dai test** e più probabili come residui:

- dati: `migrateV9/V10/V11/V12` (usati dentro `normalizeState`, esportati senza bisogno), `parseSaved`,
  `defaultStructures`, `defaultMapObjects`, `defaultCreatures`, `normalizeGridDraft`, `normalizeTileProps`,
  `eachRawGrid`, `addDefaultParties`, `defaultWorld`; inoltre `normalizeGridSize` compare **due volte** nell'oggetto export.
- tileset: `migrateV7`, `migrateLegacy`, `legacyTilesetId`, `gcd`, `opsFor`, `tileCoverage` (residui delle schede TileSet vecchie).
- tilemap: `setCell`, `crop`, `pruneTilesets`, `orient*`, `remap*`, `patternAt`, `bounds`, `newLayer`, `nextLayerId`.
- ia: `makeRng`, `rngFor`, `pathTo`, `moveLeft`, `truncate`, `weaponAbility`, `spellOptions`, `creatureOptions`, `damagePerRound`.
- creature: `avgDamage`, `avgDice`, `diceText`, `damagesText`, `damagePerRound`, `freqLabel`, `crIndex`, `emptyDefenses`, `normalizeDamage`.
- visione: `trackGhosts`, `objectBlocksSight`, `hourLevel`, `canPerceive`.
- ui: `uiCombattimento.undoAiTurn/executePlan/aiHistory/currentAiPlan`, `uiScene.launchEncounter/launchScene/rewardsDialog/generateDialog`,
  `uiScheda.calc/applyBackgroundDialog/printSheet/levelUpDialog`, `uiTileset.refreshTemplates/onThemeChange/tilesetFromFile/tileThumb`,
  `uiTile.rebuildImageTemplates`, `ui.openMenu/closeMenu/textInput/readNumber` (usati internamente da ui-comune), `noteEditor.native`.
- `app.show` risulta non citato come `.show` altrove solo per limite dello script: è usato (`DnD.app.show`) — **falso positivo**, segnalato per trasparenza.

### 6.2 File

- Tutti i file JS e CSS sono referenziati in `index.html`, `test.html` (tranne `app.js`, voluto) e `sw.js`: liste **allineate**.
- `nomi.txt`: non caricato dall'app (il browser non legge .txt da file://), è la sorgente di `nomi.js`. Non in cache SW (corretto).
- `RIPRESA-LAVORO.md`: obsoleto — dice la fase online 2/3 «non ancora committata», mentre è committata anche la 3/3.

### 6.3 CSS

839 classi definite, **62 mai scritte letteralmente** in JS/HTML. La maggior parte è composta a runtime
(`log-` + tipo, `diff-` + fascia, `rel-`, `q-`, `scene-`, `att-`, `city-att-`, `vision-swatch-N`, `f4–f6`,
`test-*` in test.html) → **non morte**. Probabilmente morte (da verificare): `tileset-dialog`, `ts-canvas`,
`ts-stage`, `drop-zone`, `fading`, `cond-tag` (nessuna occorrenza nemmeno come prefisso).

### 6.4 Residui delle vecchie versioni

- Migrazioni «stirate → tilemap» (v6–v8) in `dati.js:1068` e `app.js:128` (completamento delle dimensioni dei tile leggendo i pixel all'avvio): necessarie finché esistono backup vecchi.
- Chiavi legacy: `dnd-battaglie:dati` (v1, rimossa dopo la migrazione), `dnd-battaglie:larghezza-schede` (layout precedente, solo letta), `diceSound/diceVolume` nelle impostazioni della prima versione (`audio.js:17,71`).
- `attrezzatura.LEGACY_TYPES`, `dati.parseCost`: conversione di vecchi oggetti.
- Fazione «neutrali» con descrizione che richiama «i vecchi Neutrali/Alleati» (testo utente, ok).
- 4 colori fissi / 50×50 fisso / vecchi menù: **non trovati** residui nel codice (la palette è a 14 colori; nessun `50x50`).
- README §«Vista dei giocatori (per la futura fase Online)» e §«Collisioni (dalle versioni precedenti)»: titoli superati.
- Nessun `TODO/FIXME/HACK`; un `XXX` in `test.js` (da verificare se è testo di prova).

---

## 7. Dati e salvataggio

### 7.1 Archivi

| Archivio | Chiave | Contenuto | Versione | Scrive | Legge |
|---|---|---|---|---|---|
| IndexedDB `dnd-battaglie`, store `kv` (v1) | `stato` | stato completo JSON | `VERSION = 18` nello stato | `dati.openStore().flush` (unico punto) | `openStore` |
| idem | `stato-danneggiato` | copia dei dati illeggibili | — | `openStore` | nessuno (solo recupero manuale) |
| idem | `img:<hash>` | immagini (tileset, sfondi) | nessuna | `immagini.createStore` via `store.blobs` | idem, rete (master) |
| idem | `snd:<id>` | file audio personalizzati | nessuna | `audio.js` | `audio.js` |
| localStorage (ripiego senza IndexedDB) | `dnd-battaglie:<chiave>` | come sopra | | `localBackend` | |
| localStorage | `dnd-battaglie:dati` | stato v1 (legacy) | v1 | — (rimosso) | `openStore` |
| localStorage | `dnd-battaglie:impostazioni` | tema, testo, animazioni, effetti boss | no | impostazioni.js | impostazioni.js, audio.js (legacy) |
| localStorage | `dnd-battaglie:suoni` | impostazioni suoni | no | audio.js | audio.js |
| localStorage | `dnd-battaglie:sezione` | ultima sezione | no | app.js | app.js |
| localStorage | `dnd-battaglie:barra-laterale`, `pannello-griglia`, `pannello-tile` | aperto/chiuso | no | `ui.persistentToggle` | idem |
| localStorage | `dnd-battaglie:scheda-asset`, `scheda-oggetti`, `scheda-mondo`, `vista-relazioni` | schede attive | no | ui-asset, ui-mondo | idem |
| localStorage | `dnd-battaglie:layout-combattimento`, `layout-esplorazione`, `layout-online`, `larghezza-schede` (legacy) | colonne | no | layout-combattimento via ui-combattimento | idem |
| localStorage | `dnd-battaglie:note-aperte`, `larghezza-note`, `pagina-note` | pannello note | no | ui-note | ui-note |
| localStorage | `dnd-battaglie:altezza-pannello-tile` | altezza | no | ui-pannello-tile | idem |
| localStorage | `dnd-battaglie:online-profilo`, `online-gettone`, `online-note`, `online-ripresa` | profilo, gettoni di rientro, note del giocatore, gettoni del master | no | ui-online.js | ui-online.js |
| localStorage | `dnd-battaglie:online-stun` | server STUN | no | rete/segnalazione | idem |
| IndexedDB del giocatore (immagini ricevute) | — | cache immagini per hash | — | rete/immagini + immaginiLib (da verificare il nome dell'archivio) | idem |
| Cache API `session-forge-v36` | URL | file dell'app | v36 | sw.js | sw.js |

### 7.2 Rischi

- **Preferenze senza versione**: tutte le chiavi `localStorage` sono JSON o stringhe senza numero di versione; si
  reggono su letture difensive (`try/catch`, valori di ripiego). Basso rischio.
- **Migrazioni**: quelle dello stato sono concatenate in `dati.js` (V8–V12 + normalizzazione fino a v18), ma ce ne
  sono anche in `tileset.js` (`migrateV7`, `migrateLegacy`), `audio.js` (legacy impostazioni), `app.js:128`
  (completamento tile all'avvio, asincrono) e `layout-combattimento.js` (vecchia larghezza). **Sparse**.
- **Scritture dello stato da un solo punto** (`flush`) ✔; ma lo stato è **mutato in place** da decine di
  `update(fn)` sparsi nella UI (nessuna validazione centrale dopo la modifica).
- **Errori silenziosi** (sezione 8): `backend.set(stato-danneggiato)` ignorato (`dati.js:1255`); se fallisce, la
  copia dei dati danneggiati va persa e lo stato vuoto viene scritto alla prima modifica → **rischio di perdita**
  (basso ma reale).
- `openStore`: se `indexedDB.open` fallisce si passa a localStorage **in silenzio**; se l'utente aveva dati in
  IndexedDB (es. blocco temporaneo/privacy), l'app parte vuota e al primo salvataggio scrive su localStorage:
  i dati IndexedDB restano ma «invisibili». Da verificare se l'interfaccia segnala il backend in uso.
- Quota: `saveErrorMessage` gestisce `QuotaExceededError` con messaggio chiaro ✔.
- **Esporta/Importa**: l'archivio (`dati.exportJSON(state, images, extra)`) include stato e immagini e le regole
  di difficoltà; le **preferenze di visualizzazione, suoni, layout, chiavi online non sono esportate** (da
  verificare se i file audio `snd:` entrano in `extra`: `audio.js:345` li esporta se presenti).
- **Cancella tutti i dati**: rimuove stato, `img:` e `snd:`; lascia preferenze, layout e **dati online**
  (gettoni, profilo, note, STUN) — vedi A5.

---

## 8. Rete e filtro

Percorsi verso il giocatore in `rete/sessione.js` (lato master):

| Messaggio | Passa dal filtro? | Note |
|---|---|---|
| `istantanea`, `evento` | ✔ `filtro.statoPerGiocatore` / `differenze` / `eventoPerGiocatore` | |
| NPC, prezzi, scheda | ✔ `filtro.npcPiazzato`, `contestoPrezzi`, `scheda` | |
| `immagine` | ✔ solo id presenti in `g.vista.immagini` | |
| **`esito`** | ✘ | **testo = ultima riga del registro** → PF esatti dei nemici, nomi di bersagli forse non rivelati (A1) |
| `dado` del master (`:217`, `:677`) | ✘ | tiri annotati dal registratore: etichette possono contenere nomi o CD (da verificare) |
| `rivela`, `dialogo`, `richiestaTiro`, `ping`, `lavoro`, `chat`, `presenza` | ✘ (inviati per scelta esplicita del master) | contenuto deciso dal master, accettabile; `rivela.immagine` è un dataURL inviato fuori dalla whitelist immagini |
| `offerta` (scambio) | ✘ | nome oggetto e quantità tra giocatori, accettabile |
| `permessi`, `benvenuto`, `errore`, `espulso`, `fine` | ✘ | metadati |

Lato giocatore: `filtro.applica` sui `evento` ✔. Il filtro esclude esplicitamente `hp`, `maxHp`, `ai`,
`readAloud`, `secret`, `tactics`… (`filtro.js:350`) ✔, e `filtro.js:124` ha un `catch` silenzioso
(«riassunto parziale») e l'unico `console.*` del progetto.

---

## 9. Qualità e leggibilità

- **Nomi misti italiano/inglese**: il dominio e la UI vecchi sono in inglese (`normalizeCreature`, `performAttack`,
  `isCellBlocked`, `state.players`), la rete e le parti nuove in italiano (`istantanea`, `invia`, `giocatori`).
  Anche le chiavi dei dati sono inglesi. Coerente per «epoche», incoerente nel complesso. Prefisso storico
  `dnd-battaglie:` per le chiavi vs nome `session-forge` per la cache.
- **Numeri magici** fuori dai file dati: `1.5`/`0.3048` per metri; `5000` ms in `sessione.js:503`; `ESITI_RICORDATI`,
  `LOG_MAX`, `DICE_HISTORY_MAX` sono costanti (ok); limiti `slice(0, 32)`, `str(…, 20000/50000)` in normalizzazione.
- **Parametri**: funzioni con 4+ parametri posizionali (`attrezzatura.resolveWeapon(weapon, catalog, abilities, profBonus)`,
  `regole.spellStats(c, info, abilities, profBonus)`, `generatore.buildWeapons(…5)`) — accettabile.
- **Annidamento profondo**: le funzioni `create` dei componenti canvas (closure di centinaia di righe con stato
  locale) e `rete/sessione.master` (closure di ~784 righe).
- **`catch` vuoti o con solo commento: 31** (vedi elenco sotto). La maggior parte è legittima (preferenze, chiusure
  di canali). Da rivedere: `dati.js:1255` (copia dei dati danneggiati), `immagini.js:129`, `audio.js:345`
  (file mancante non esportato **senza avviso**), `filtro.js:124`.
- **`execCommand`**: isolato in `note-editor.js:43–47` (deprecato ma senza alternativa nativa per contenteditable;
  ben documentato) e `ui-online.js:55` (copia negli appunti, fallback di `navigator.clipboard`, ok).
- **Listener**: 180 `addEventListener` vs 20 `removeEventListener`. La maggior parte è su nodi che vengono buttati
  (raccolti col nodo). **Rischio di accumulo** sui 26 listener di `window`/`document`, in particolare in
  `ui-note.js` (5), `ui-impostazioni.js` (3), `ui-tileset.js` (2), `ui-online.js` (2), `ui-griglia.js` (2),
  `note-editor.js` (2): da verificare se vengono rimossi quando il componente è ricreato.
- **Timer**: `setInterval` in `ui-online.js` (2) e `ui-dadi.js` (1): da verificare l'arresto.
- **Memoria**: `icone.js` mantiene una cache di immagini (`getImage`) senza limite (da verificare); canvas
  offscreen in `ui-visione` (cache dichiarata) e `ui-tileset`; `createObjectURL` 3 / `revokeObjectURL` 4 ✔.
- **Ridisegni**: `ui-griglia.draw` (155 righe) ridisegna tutto a ogni modifica; la visione ha layer in cache ✔.
  `DnD.store.onChange` scatta a **ogni** `save()` e il master ricalcola la vista filtrata per ogni giocatore
  (`filtro.statoPerGiocatore` + `differenze`) — costoso con mappe grandi (da misurare).
- `alert/confirm/prompt` nativi: 72 occorrenze (bloccanti, non stilizzati; accettabile ma incoerente con i dialoghi custom).
- `innerHTML`: 19 usi; tutti su markup statico o HTML già sanificato (`scene.readAloud`, `scheda.story` passano da
  `note.sanitizeHtml` in normalizzazione) ✔.

---

## 10. Accessibilità e tema

- Colori letterali **in JS**: 264 esadecimali + 86 `rgb()`; la maggior parte in file dati (palette, temi boss e
  leggendari, `mondo-dati`, `visione-dati`, `condizioni`). **Nei componenti**: `ui-percorso.js` (27 `rgba`),
  `ui-griglia.js` (12), `ui-visione.js` (9), `ui-leggendario.js` (6), `ui-boss.js` (3), `ui-mappa-esplorazione.js` (3),
  `rete/sessione.js:677` (`#c9a24f` colore del master). Sul canvas i colori non possono essere `var()` diretti, ma
  andrebbero letti da CSS (`getComputedStyle`) per seguire il tema.
- CSS: `style.css` 160 colori letterali (vs 593 `var(`), `boss.css` 51, `dadi.css` 22, `leggendario.css` 18 — da
  verificare quanti sono fuori da `:root`/temi.
- `aria-label`: 515 occorrenze, buona copertura nei form recenti; meno nei file più vecchi (`ui-razze`, `ui-magie`,
  `ui-strutture`): **da verificare a mano** i pulsanti solo‑icona.
- Testi in inglese visibili all'utente: non rilevati sistematicamente (gli identificatori inglesi non sono visibili).
  Da verificare valori come i nomi delle modalità nelle `<option>` (`text: v` minuscolo in `ui-online.js:360,1151`).
- Contrasto: non misurato (richiede rendering dei temi): **da verificare**.

---

## 11. Test

- **309 test** in `js/test.js` (6860 righe). **Esito dell'esecuzione (browser integrato, pannello nascosto):
  308 passati, 1 fallito**:
  - ✘ «Boss UI: la vignettatura non intercetta i clic; "Effetti boss" e "Riduci animazioni"» — `document.elementFromPoint(10,10)`
    ha restituito `null` invece del pulsante. Molto probabilmente dovuto al **pannello nascosto** (viewport senza
    area visibile), come avverte CLAUDE.md; **da ripetere in una finestra visibile** prima di considerarlo un bug.
- **Dipendenti dal DOM**: 46 usi di `document.` nei test (ui-boss, ui-dadi, ui-leggendario, ui-scheda, ui-note,
  note-editor, ui-visione, ui-comune, layout). **Dipendenti da storage reale**: test del layout
  (`test.js:2754–2809`) leggono/scrivono `localStorage` e ripristinano a mano. **Dipendenza da altri test**: `DnD.store`
  è sostituito globalmente nei test (da verificare l'isolamento); i test online asincroni rallentano a pagina nascosta.
- **Moduli UI mai citati nei test**: app, uiAsset, uiCondizioni, uiCreature, uiDifficolta, uiEditorGriglie,
  uiEsplorazione, uiEventi, uiGeneratore, **uiGriglia**, uiIa, uiIcone, uiImpostazioni, uiIncantesimi, uiMagie,
  uiMappaEsplorazione, uiMondo, uiMostri, uiNpc, uiOggettiMappa, **uiOnline**, uiPannelloTile, uiParty, uiPercorso,
  uiQuest, uiRiposi, uiScene, uiSessioni, uiStrutture, uiTile, uiTileset; dati: iaDati, riposiDati, visioneDati, immagini (store).
- Copertura dei moduli puri: buona (tutti nominati, spesso tramite alias tipo `const R = DnD.regole`).
  Scoperti o deboli: le **migrazioni V9–V12 non sono chiamate direttamente** (solo via `normalizeState`),
  `dati.parseSaved`, ripiego `localBackend`, `tileset.migrateLegacy/migrateV7`, `ui-combattimento.online.*`
  (testati tramite la sessione con dadi di prova — da verificare quanto).

---

## 12. Service worker e PWA

- `CACHE = 'session-forge-v36'`; strategia «rete prima, cache se offline» ✔.
- `FILES` (sw.js) confrontato con i file reali e con `index.html`: **tutti i 107 JS (test.js escluso) + 4 CSS + icona + manifest
  presenti, nessun file mancante o in più**. `test.html`/`test.js` esclusi (giusto). `nomi.txt` escluso (giusto).
- Tre liste da tenere allineate a mano (`index.html`, `test.html`, `sw.js`): rischio di disallineamento a ogni nuovo file.
- `manifest.json`: nome scritto a mano (duplicato di `config.APP_NAME`).
- Nessuna gestione dell'aggiornamento visibile all'utente (`skipWaiting` + `clients.claim` immediati: una pagina
  aperta può trovarsi a metà tra versioni vecchie e nuove dei file finché non ricarica — rischio basso).

---

## 13. README e commenti

- README (1996 righe) molto dettagliato: avvio, sessioni, navigazione, sezioni, boss, scheda, leggendari,
  esplorazione, mondo, tile, modello dati v18, IA, movimento, condizioni, riposi, difficoltà, scene, visione, online.
- Obsoleti: §«Vista dei giocatori (per la futura fase Online)» (la fase online esiste), §«Collisioni (dalle
  versioni precedenti)»; `RIPRESA-LAVORO.md` fermo alla fase online 2/3.
- **Intestazioni**: tutti i file JS hanno un commento d'intestazione in italiano (verificato sulla prima riga) ✔.
  CSS: da verificare.
- `CLAUDE.md` coerente con il codice (versione v18, cache v36).

---

## 14. Elenco dei problemi

Gravità: **alta** = perdita di dati o dati nascosti inviati al giocatore; **media** = duplicazioni/regole sparse/accoppiamento;
**bassa** = stile. Rischio = rischio di toccarlo. Sforzo S/M/L.

| Id | Area | Descrizione | Dove | Gravità | Rischio | Sforzo |
|---|---|---|---|---|---|---|
| A1 | Rete | `esito` manda la riga del registro con i PF esatti dei nemici, fuori dal filtro | `ui-combattimento.js:144,2129`, `rete/sessione.js:201–209,451` | alta | medio | S |
| A2 | Rete | tiri del master (`dado`) e `rivela.immagine` inviati senza filtro/whitelist | `rete/sessione.js:217,677,845` | alta (da verificare) | basso | S |
| A3 | Dati | copia dei dati danneggiati scritta con errore ignorato; poi lo stato vuoto sovrascrive | `dati.js:1253–1256` | alta | basso | S |
| A4 | Dati | ripiego silenzioso IndexedDB → localStorage: dati «spariti» se IDB fallisce una volta | `dati.openStore:1235–1240` | alta | medio | S |
| A5 | Dati | «Cancella tutti i dati» lascia gettoni/profilo/note online e preferenze | `dati.js:1205–1213`, `ui-impostazioni.clearAll` | media (da decidere) | basso | S |
| A6 | Architettura | 73 file in un'unica componente ciclica; dominio che chiama `dati`/`app`/UI | grafo §3 | media | alto | L |
| A7 | Architettura | `rete/sessione` esegue tramite `DnD.uiCombattimento.online` (rete → UI) | `rete/sessione.js`, `ui-combattimento.js:2131` | media | alto | L |
| A8 | Livelli | regole di combattimento (attacco, incantesimi, cure, azioni creature, registro) nella UI | `ui-combattimento.js` | media | alto | L |
| A9 | Dimensione | `ui-griglia.create` ~1370 righe, `ui-combattimento.js` 2157 righe | | media | alto | L |
| A10 | Dimensione | `rete/sessione.master` ~784, `note-editor.create` ~635, `ui-scheda.editor` ~570, `ui-percorso.create` ~562, `ui-pannello-tile.create` ~451, `ui-tile.cutter` ~441, `ui-visione.create` ~474 | | media | alto | L |
| A11 | Dati | `dati.js` 1344 righe: esempi + normalizzazione + migrazioni + store | `dati.js` | media | medio | M |
| A12 | Dati | migrazioni sparse in tileset.js, audio.js, app.js, layout-combattimento.js | | media | medio | M |
| A13 | Duplicazione | costanti dei modi di tiro ripetute in 6 UI | vedi §5 | bassa | basso | S |
| A14 | Duplicazione | `creature.signed` (−) vs `regole.formatModifier` (-) | `creature.js:187`, `regole.js:16` | bassa | basso | S |
| A15 | Duplicazione | `esc` locali duplicano `note.escapeText` | `note.js:136`, `ui-note.js:227` | bassa | basso | S |
| A16 | Duplicazione | conversioni metri/piedi con letterali sparsi | §5 | media | medio | M |
| A17 | Duplicazione | `griglia.cellDistance` vs `movimento.distance`: chi usa quale per gittate (da verificare) | | media | medio | M |
| A18 | RNG | `Math.random` fuori da `dadi` in UI (scheda, seme mappa) | `ui-scheda.js:388`, `ui-mappa-esplorazione.js:280` | bassa | basso | S |
| A19 | Codice morto | ~230 export non usati fuori dal file, alcuni non usati affatto (§6.1) | vari | bassa | medio | M |
| A20 | Codice morto | export duplicato `normalizeGridSize` | `dati.js:1334–1337` | bassa | basso | S |
| A21 | CSS | classi probabilmente morte (`tileset-dialog`, `ts-canvas`, `ts-stage`, `drop-zone`, `fading`, `cond-tag`) | css | bassa | basso | S |
| A22 | Errori | 31 `catch` silenziosi; da rivedere `immagini.js:129`, `audio.js:345`, `filtro.js:124` | §9 | media | basso | S |
| A23 | Memoria | 26 listener su `window/document`, 2 `setInterval` online, cache `icone.getImage` senza limite (da verificare) | §9 | media | medio | M |
| A24 | Prestazioni | vista filtrata ricalcolata a ogni `save()` per ogni giocatore | `rete/sessione.js:150–165` | media | medio | M |
| A25 | Tema | colori letterali nei componenti canvas (ui-percorso, ui-griglia, ui-visione) e `#c9a24f` in rete | §10 | bassa | basso | M |
| A26 | Nomi | italiano/inglese misti per epoca; prefisso `dnd-battaglie:` vs `session-forge` | ovunque | bassa | alto | L |
| A27 | Test | 31 moduli UI senza test; migrazioni V9–V12 e ripiego localStorage non testati direttamente | §11 | media | — | M |
| A28 | Test | test DOM dipendenti dalla visibilità della pagina (1 fallimento a pannello nascosto) | `test.js:2687` | bassa | basso | S |
| A29 | PWA | tre liste di script da allineare a mano | index.html, test.html, sw.js | bassa | basso | S |
| A30 | Doc | README §futura fase Online e RIPRESA-LAVORO.md obsoleti | | bassa | basso | S |
| A31 | UX/stile | 72 `alert/confirm/prompt` nativi | ui-* | bassa | basso | M |
| A32 | Preferenze | chiavi localStorage senza versione | §7 | bassa | basso | S |

---

## 15. Proposta di ordine di refactoring

Principio: dalle foglie alla UI, un modulo per volta, **comportamento identico**, test prima di toccare.

1. **File di dati** (`*-dati.js`, `config`, `classi`, `colori`, `equipaggiamento`) — cosa cambia: niente o
   costanti spostate qui (modi di tiro, conversioni metri/piedi, numeri magici). Può rompersi: nulla se si tengono
   alias. Test: snapshot delle tabelle.
2. **`dadi`, `regole`** — rompere i cicli: `regole` non deve chiamare `ia`, `leggendario`, `boss`, `scheda`,
   `riposi`; passare ciò che serve come parametri o spostare `derivedStats`/`createCombatants` in un modulo
   «combattenti» sopra. Può rompersi: statistiche derivate, CA, iniziativa. Test: tabelle di `derivedStats` per ogni
   tipo (standard, creatura, boss, leggendario, scheda con talenti).
3. **`condizioni`, `magie`, `attrezzatura`, `movimento`** — togliere le chiamate a `dati` (es. `magie → dati`);
   unificare la formattazione del segno. Test: `attackMods/saveMods` per ogni condizione; gittata con 5‑10‑5.
4. **Mappa: `collisioni`, `tileset`, `tilemap`, `griglia`, `visione`, `esplorazione`** — rompere
   `griglia⇄tilemap`, `griglia⇄visione`, `esplorazione⇄griglia` con iniezione delle funzioni di blocco; spostare
   `migrateV7/migrateLegacy` nelle migrazioni. Test: `isCellBlocked` con ogni sorgente di blocco, `canSee`.
5. **Mondo: `fazioni`, `party`, `quest`, `citta`, `npc`** — `fazioni` non deve dipendere da `sessioni/quest/party`.
   Test: matrice di `relazione`/`ostili`.
6. **Creature/IA: `creature`, `boss`, `leggendario`, `percorso`, `ia`** — rompere `creature⇄ia`; spezzare
   `pianificaTurno` in fasi. Test: piani dell'IA deterministici (seme) su 3–4 scenari.
7. **`dati.js`** — dividere in `dati/esempi`, `dati/normalizza`, `dati/migrazioni` (con tutte le migrazioni, anche
   quelle sparse), `dati/store`; correggere A3/A4. Test: fixture di file v8…v18 → stato atteso; store con backend finto
   che fallisce.
8. **Nuovo modulo puro «azioni di combattimento»** estratto da `ui-combattimento` (`attacca`, `lancia`, `cura`,
   `azioneCreatura`, `salvezza`, `muovi`) che restituisce `{ stato, registro, tiro }`. Può rompersi: tutto il
   combattimento e l'online. Test: prima scrivere test di caratterizzazione attraverso `uiCombattimento.online`.
9. **Rete** — `sessione` usa il nuovo modulo azioni invece di `DnD.uiCombattimento`; l'`esito` passa da un
   `filtro.esitoPerGiocatore` (A1/A2). Test: nessun messaggio contiene `hp` nemici esatti (test «avvelenato» con un
   segreto noto cercato in ogni messaggio inviato).
10. **UI**, dal basso: `ui-comune` (togliere `app` dal ciclo), componenti canvas (`ui-griglia` → livelli/disegno/
    input separati), `ui-combattimento` (setup, turni, colonne, dialoghi), `ui-online`, `ui-scheda`, `ui-creature`.
    Test: smoke test DOM per sezione (montaggio senza errori) + test manuali guidati.

---

## 16. Test mancanti da scrivere prima (rete di sicurezza)

- **dati**: migrazione di fixture reali v8, v12, v16, v17 → v18 (confronto profondo); `parseSaved` su JSON
  danneggiato; store con backend che fallisce in `get`, `set`, e nella copia `-danneggiato`; ripiego localStorage;
  `clearAll` (cosa resta).
- **sessioni**: duplicazione/import con `scene.remap` e `remapWorldEntities`.
- **regole/condizioni**: tabella completa di `derivedStats` per i 5 tipi di entità.
- **movimento/griglia**: `distance` vs `cellDistance` per gittate in diagonale.
- **combattimento (caratterizzazione)**: `uiCombattimento.online.attacco/magia/salvezza/movimento` con `dadiDiProva`:
  stato risultante + testo del registro.
- **rete/filtro**: test «nessun segreto» su **tutti** i tipi di messaggio (`esito`, `dado`, `rivela`, `evento`,
  `istantanea`) con nemico nascosto, PF esatti, note del master, boss non rivelato.
- **rete/sessione**: listener/timer fermati alla chiusura (nessun `setInterval` residuo).
- **tileset/tilemap**: `migrateLegacy`, `migrateV7` su dati vecchi.
- **UI (smoke)**: ogni sezione del menù si monta e si smonta senza errori in console; listener su `window` non
  crescono dopo 10 montaggi (contatore con `addEventListener` intercettato).
- **sw.js**: test che confronta `FILES` con gli script di `index.html` (evita A29).

---

## 17. Struttura finale proposta (evoluzione, non riscrittura)

Restano script classici e il namespace `DnD`; cambiano cartelle e confini. Ogni cartella dipende solo da quelle sopra.

```
js/
  dati/        tabelle modificabili (oggi *-dati.js, config, classi, colori, equipaggiamento, libreria-icone, nomi)
               API: costanti congelate, nessuna funzione con stato
  base/        dadi.js, testo.js (escape, segno, metri/piedi), validazione.js
               API: DnD.dadi.*, DnD.testo.{escape, segno, metri, piedi, celle}
  regole/      regole.js (5e puro), condizioni, magie, attrezzatura, riposi, difficolta, combattenti.js (derivedStats,
               createCombatants), azioni.js (NUOVO: attacca/lancia/cura/salvezza/azioneCreatura → { stato, registro, tiro })
  mappa/       collisioni, tileset, tile, tilemap, griglia, movimento, visione, biomi, eventi, esplorazione
               API: isCellBlocked, distance, canSee, context, walk
  mondo/       fazioni, party, citta, npc, quest, scene
  entita/      creature, boss, percorso, leggendario, scheda, generatore, ia
  stato/       modello.js (emptyState, VERSION), esempi.js, normalizza.js, migrazioni.js (TUTTE), store.js
               (IndexedDB/localStorage), sessioni.js, immagini.js, preferenze.js (tutte le chiavi localStorage con
               prefisso e versione, elenco usato da «Cancella» ed «Esporta»)
  rete/        protocollo, trasporto, codici, segnalazione, filtro (+ esitoPerGiocatore), immagini, intenzioni, sessione
               (usa regole/azioni.js, non la UI)
  ui/          comune, componenti/ (griglia/, visione, percorso, tile, dadi, note-editor), sezioni/ (una per voce di
               menù: combattimento/, esplorazione, scene, mondo, creature, scheda, asset…), online/
  app.js       avvio e navigazione
  audio.js, impostazioni.js   (servizi del browser)
```

Interfacce pubbliche previste (esempi): `DnD.stato.store.{state, update, saved, clearAll}`,
`DnD.stato.preferenze.{leggi, scrivi, tutte}`, `DnD.regole.azioni.attacca(stato, attaccanteId, bersaglioId, opz, rng)`,
`DnD.rete.filtro.{istantanea, differenze, applica, esitoPerGiocatore}`, `DnD.ui.griglia.create(canvas, opts)`.

---

## 18. Cose che NON consiglierei di toccare

- **`dadi.js`** (RNG con `crypto` e campionamento a rifiuto, registratore): corretto, testato, usato ovunque.
- **`note.sanitizeHtml` / `note-editor` con `execCommand`**: funziona, è isolato in un punto, non esiste
  un'alternativa nativa equivalente; riscriverlo è costoso e rischioso per la sicurezza.
- **Formato dei dati salvati e prefisso `dnd-battaglie:`**: rinominare chiavi o campi (anche per uniformare
  italiano/inglese) richiede migrazioni per tutti i backup degli utenti, per guadagno solo estetico.
- **Protocollo online (`protocollo.js`, codici)**: cambiare i messaggi rompe la compatibilità tra versioni.
- **Le migrazioni esistenti V8–V12**: spostarle sì, modificarle no.
- **Lo schema «script classici + `DnD`»**: passare a moduli ES cambierebbe l'avvio da `file://` (i moduli non
  funzionano senza server) — vincolo dell'app.

---

## 19. Domande aperte (decisioni tue)

1. «Cancella tutti i dati» deve cancellare anche preferenze, layout e **dati del gioco online** (gettoni, profilo, note)?
2. Le preferenze di visualizzazione e suoni devono entrare in Esporta/Importa?
3. Lingua degli identificatori: si uniforma all'italiano solo il codice nuovo, o anche il vecchio (senza toccare i dati)?
4. Segno meno: `−` tipografico o `-` ovunque?
5. Il master vuole che i giocatori vedano i PF esatti nel testo degli esiti (A1) o vale la regola del filtro?
6. Le classi CSS e gli export candidati a codice morto si eliminano subito o dopo un periodo con avviso?
7. È accettabile introdurre cartelle (`js/regole/`, `js/ui/`…) cambiando i percorsi in index/test/sw?
8. Si vuole sostituire `alert/confirm/prompt` nativi con i dialoghi dell'app?
9. `RIPRESA-LAVORO.md` va aggiornato, archiviato o eliminato?
10. Il test della vignettatura dei boss va ripetuto in finestra visibile da te, o preferisci che lo renda indipendente
    dalla visibilità nella fase 2?
