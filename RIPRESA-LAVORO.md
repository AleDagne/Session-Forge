# Ripresa del lavoro — Fase «Personaggio leggendario»

Data: 22 ottobre 2026. Questo file serve a riprendere il lavoro dal PC desktop.

## Come ripartire

1. Apri una nuova sessione di Claude Code nella cartella del progetto.
2. Scrivi: *«Leggi RIPRESA-LAVORO.md e continua la fase Personaggio leggendario dai punti "Da fare"»*.
3. Per provare l'app e i test serve il server locale: `python -m http.server 8080` nella cartella, poi
   `http://localhost:8080/index.html` e `http://localhost:8080/test.html`. Il browser tiene in cache gli script:
   ricarica forzata (Ctrl+F5) dopo ogni modifica.
4. Attenzione: la cartella **non è un repository git**, quindi non c'è cronologia. Conviene una copia di backup
   della cartella prima di continuare.

## Stato al momento della pausa

- Dal 22 ottobre 2026 (sessione sul PC desktop) la cartella **è un repository git**: la cronologia parte dal commit
  «Stato iniziale». Claude Code avvia il server da `.claude/launch.json` sulla porta **5617** (la 8080 era occupata).
- L'app parte e tutti gli script si caricano senza errori di sintassi.
- `test.html`: **tutti i 188 test passano** (in una finestra visibile: con il pannello nascosto restano su «Esecuzione…»).
- Versione dei dati: **11** (cache del service worker: `session-forge-v21`).

## Prova a mano dell'interfaccia (22 ottobre 2026, PC desktop)

Provati nell'app e funzionanti: elenco Leggendari, «+ Nuovo leggendario» con validazione e animazione di Ascensione,
scheda con riepilogo ed effetti «da: nodo», Percorso in Sblocca (dettagli, sblocco, linea attiva, punti) e in
Modifica (aggiungi nodo, collega trascinando, pannello del nodo, Applica, annulla/ripeti, raggiera), Opzioni del
master (titolo, tema Cosmico, bonus, rimodella), Trasformazioni (da creatura esistente, modifica, salva, duplica,
ordina, elimina), combattimento (Trasformati, barra boss in alto, vignettatura, ritorno a 0 PF con danno in
eccesso, pulsante disattivato senza usi).

Corretto durante la prova:
- I PF massimi non salivano quando un nodo aumenta la COS: ora +1 PF per livello per ogni punto di modificatore
  (`leggendario.effectivePlayer`), con test.
- «null» scritto come testo da `append` nativo: card leggendari, card boss, card trasformazioni, pannello del
  Nucleo, schermata dell'iniziativa (sempre visibile!), scheda degli oggetti di mappa.
- Raggiera: ora è ad albero (spicchio per ramo proporzionale alle foglie, anelli più larghi), con test.
- Editor della trasformazione: tolti icona e dimensione doppie (ora solo quelle della scheda boss, che erano
  ignorate); il tema boss della forma non ricolora più la pagina divina; campi Usi/Durata schiacciati; campo di
  ricerca icone schiacciato nei contenitori stretti.
- «Duplica» anche per il singolo nodo; titolo del personaggio aggiornato subito nell'intestazione; setup del
  combattimento con PF/CA effettivi dei leggendari; singolari («1 punto», «1 nodo sbloccato», «1 uso»).

Nota rimasta: lo sblocco chiede conferma due volte (dialogo + `confirm()` nativo, come il resto dell'app).

## Grafica divina completa (punto 2 del «Da fare») — FATTA (22 ottobre 2026)

- **Temi unificati con il Boss**: le palette dei 5 temi leggendari stanno in `leggendario.js` (`PALETTES`, stessa
  forma dei temi di `boss.js`). `boss.theme(id)` risolve sia i temi del Boss sia le chiavi `lg:<id>` dei leggendari
  (niente confusione tra «divino» del Boss e «divino» leggendario); `boss.normalizeBoss` le accetta.
  `uiBoss.applyTheme/themeStyle` sono l'unico punto in cui i colori entrano nell'interfaccia: per i temi leggendari
  aggiungono le variabili `--lg-*`, la classe `legend-theme` e `data-legend-motif`.
- **Tema della forma unico**: un solo campo «Tema» nelle regole della trasformazione (Tema del personaggio, 5 temi
  ✦, temi del Boss). `leggendario.formTheme` lo risolve; vale per barra in alto, vignettatura, alone della pedina,
  lampo, card e scheda del combattente. Nella scheda boss della forma è nascosto il riquadro «Presentazione»
  (titolo, epiteto, introduzione, tema), che la trasformazione ignorava.
- **Grafica** (`css/leggendario.css`, `ui-leggendario.js`): vignettatura dorata e bianca, raggi che oscillano,
  polvere, due sigilli con rune che ruotano, ali a tre file di piume lungo l'arco dell'ala con aureola e raggi,
  lance di luce al posto delle spade, filigrana sotto le cornici, angoli luminosi, divisori sacri. Motivi per tema:
  raggi (Divino), nuvole e piume (Angelico), vortice (Abissale), braci e scaglie (Draconico), stelle e nebulosa
  (Cosmico). Il canvas del Percorso prende i colori dal tema.
- **Combattimento**: scheda del leggendario con angoli dorati, aureola sopra il bordo e alone (più forte in forma),
  colori del tema attivo (quello della forma se trasformato); pedina con alone, aureola sotto la barra della vita e,
  in forma, ali ai lati.
- Contrasto verificato nel tema scuro e chiaro; «Riduci animazioni» ferma tutto (test nuovo in `test.html`).

## Fatto in questa fase (punti dell'ordine di lavoro)

### 1. Livelli 20-40 e calcoli estesi — FATTO e testato
- `js/regole.js`: `proficiencyBonus(level, legendary)` → per i leggendari `1 + ⌈livello/4⌉` (fino a +11), invariato
  per gli standard; `finalAbilities(…, cap)` con tetto configurabile (leggendari 30); `derivedStats` usa tetto e
  competenza leggendari quando `type === 'leggendario'`.
- `js/validazione.js`: livello 20-40 e tetto 20-30 per i leggendari.
- `js/dati.js`: giocatore con `type: 'leggendario'`, `level` 20-40, `abilityCap`, `legend` (percorso, nodi
  sbloccati, trasformazioni, usi). Giocatore declassato: conserva `legendArchive`. Libreria globale
  `pathTemplates`. Migrazione `migrateV11`. I combattenti salvano `legend` (anche la forma attiva).
- I giocatori standard **non hanno il campo type** (sono "standard" per assenza del campo).

### 2. Modello del percorso e funzioni pure — FATTO e testato
- `js/percorso.js`: nodi, collegamenti, Nucleo, effetti (caratteristica, competenza, bonus numerici, magia, slot,
  privilegio, trasformazione, testo), sblocco (collegato o tutti i prerequisiti, rango, punti, esclusività),
  rimodella, irraggiungibili, cicli di esclusività, aggiungi/collega/scollega/elimina/duplica/sposta,
  disposizione a raggiera, cronologia annulla/ripeti, ricerca, modelli, **percorso d'esempio originale
  «Ascesa dell'Eterno»** (13 nodi).
- `js/leggendario.js`: rango, punti (1 per rango, max 20, + bonus del master), somma degli effetti con le fonti
  («da: nodo»), giocatore effettivo per i calcoli esistenti, privilegi come azioni da creatura (pulsanti nel
  combattimento), trasformazioni (fusione delle caratteristiche, PF sostitutivi con danno in eccesso al
  personaggio o PF temporanei, usi, durata, fine anticipata, fasi del boss), promozione/declassamento, riposo.
- `js/regole.js` `createCombatants`: i leggendari entrano in combattimento con tutti gli effetti.

### 3-6. Interfaccia — SCRITTA, da verificare a mano nell'app (mai provata visivamente)
- `js/ui-creature.js`: Giocatori con schede **Standard / ✦ Leggendari**; pulsante «✦ Eleva a leggendario» (livello
  20); il form del giocatore è riusabile in modalità leggendaria (livello 20-40, tetto 30, competenza
  sovrascrivibile).
- `js/ui-percorso.js`: editor della mappa a nodi su canvas (zoom, pan, trascina nodi, collega trascinando,
  scollega, elimina, duplica, Maiusc+trascina per selezione multipla, griglia, raggiera, annulla/ripeti, ricerca,
  validazione, pannello del nodo con editor degli effetti) e **modalità Sblocca** (nodi che pulsano, linee attive
  con luce che scorre, sblocco con conferma e animazione).
- `js/ui-leggendario.js`: elenco dei leggendari, scheda con **Scheda / Percorso / Trasformazioni / Opzioni del
  master**, modelli di percorso (salva, carica, elimina), esporta/importa JSON del percorso, editor delle
  trasformazioni (regole + scheda boss completa riusando `uiMostri.monsterForm` e `uiBoss.bossFields`),
  animazione di Ascensione, riquadro nel combattimento (Trasformati / Torna normale / annulla / ripeti), alone e
  aureola sulla pedina.
- `js/ui-combattimento.js`: danno tramite `hurt()` (gestisce l'eccesso della forma), durata della forma che scende
  a inizio turno, classe `legendary` sulla scheda del combattente, riquadro dei leggendari.
- `js/ui-mostri.js`: opzione `save` di `monsterForm` (salva altrove invece che nei Nemici).
- `js/ui-boss.js`: esportato `bossFields`. `js/ui-griglia.js`: alone dei leggendari sulla pedina.
- `css/leggendario.css`: **versione di base** (temi con variabili `--lg-*`, raggi, polvere, editor del percorso,
  animazioni, «Riduci animazioni»).

## Fase «Velocità e movimento, dadi animati» — FATTA (22 ottobre 2026)

- `js/movimento.js` (nuovo, logica pura): velocità in piedi per modalità (fonti: razza, creatura, nodi, oggetti
  con il nuovo campo *Bonus alla velocità*, forma, sovrascrittura), celle = piedi / piedi per cella, residuo per
  turno, Scatto, Disimpegno, Rialzarsi, annulla spostamento, condizioni (aggiunta «rallentato»), percorso minimo
  con diagonali 1 o 1-2-1 e costi additivi. L'IA (`ia.paths`) ora usa questo percorso e il residuo.
- Griglia: aggancio `movement` (anteprima delle celle raggiungibili, percorso, costo, fermata all'ultima cella),
  misuratore con la regola delle diagonali, residuo nell'istantanea di annulla/ripeti.
- Dadi: `dadi.registratore` (le funzioni dei tiri annotano vantaggio, scarto e modificatori senza cambiare i
  risultati), `pianoAnimazione`, `coda`; `ui-dadi.js` riscritto con `mostraTiro` (overlay e area di lancio),
  `css/dadi.css`; Impostazioni › Movimento e Dadi animati.
- **Da provare a mano** (in aggiunta all'elenco qui sotto): trascinare pedine con terreno difficile e diagonali
  1-2-1, cambio di modalità dal menu della pedina, condizioni, Movimento libero e Ignora velocità, turni IA
  automatici con l'overlay dei dadi, suoni con il volume, esplorazione (prove degli eventi) con i dadi.
- Limiti noti: nessuna regola di luce/acqua; i biomi non cambiano il costo nel combattimento (solo le tile).

## Effetti dei nodi e README — FATTI (22 ottobre 2026)

- **Abilità**: competenza (×1) e maestria (×2) dei nodi valgono nelle prove degli eventi dell'esplorazione
  (`leggendario.checkBonus`, usato da `eventi.memberBonus`, che ora usa anche le caratteristiche date dai nodi) e
  nella Percezione passiva. La scheda le mostra con il bonus.
- **Sensi**: nella scheda e nel riquadro del combattente, con la Percezione passiva (salvata nel combattente).
  L'app non ha regole di luce/vista in cui usarli (l'esplorazione lavora in km): restano informativi.
- **Magie «N al giorno»**: nel combattimento diventano incantesimi senza slot (come gli innati delle creature),
  con gli usi rimasti; il lancio scala `legend.spellUses` sulla scheda, il riposo lungo li ripristina. Chi non ha
  una classe da incantatore le lancia con la migliore tra INT, SAG e CAR. Se lo stesso incantesimo è dato anche
  «sempre preparato», resta normale (con gli slot). L'indicatore sulla scheda mostra slot e usi insieme.
- Competenze in strumenti/armi/armature: restano testo (nessun calcolo dell'app le usa).
- **README**: sezione «Personaggi leggendari» (livelli, Percorso, Trasformazioni, grafica), modello dati v11 con
  la migrazione, test e struttura.

## Da fare

1. **Prove a mano** (le fa l'utente), con l'app servita in locale e Ctrl+F5 dopo l'aggiornamento:
   - Giocatori › Standard: un giocatore di livello 20 → «✦ Eleva a leggendario» (Ascensione), poi Declassa e
     di nuovo Eleva: il percorso e le trasformazioni devono tornare.
   - Percorso › Sblocca: sblocco con conferma, linea che si illumina, punti; Opzioni del master → togli
     «Permetti di rimodellare» e verifica che Rimodella sia bloccato; poi Rimodella con il permesso.
   - Percorso › Modifica: Collega, Scollega, Elimina (anche con Canc), Duplica di uno e di più nodi
     (Maiusc+trascina), Griglia, Raggiera, ricerca, Ctrl+Z / Ctrl+Y; nodo esclusivo e «Servono tutti i
     prerequisiti»; avviso per un nodo scollegato.
   - Modelli: Salva come modello, Carica modello su un altro leggendario, elimina modello; Esporta JSON e
     Importa JSON del percorso.
   - Effetti dei nodi: un nodo con competenza in Percezione e uno con «Nuova magia 2/giorno» → la scheda
     mostra bonus, Percezione passiva e «Magie al giorno 2/2»; in combattimento la magia si lancia senza slot
     (anche con un guerriero), gli usi scendono e restano dopo il combattimento; Riposo lungo li ripristina.
     Un evento d'esplorazione con prova di Percezione deve usare il bonus del leggendario.
   - Combattimento: «Trasformati» con un privilegio a pulsanti; fasi del boss in forma; «Torna normale» e il
     pulsante ↶ (annulla) / ↷; fine a durata (10 round con «Prossimo turno»); forma con PF temporanei.
   - Grafica: i 5 temi nelle Opzioni del master; tema della forma diverso da quello del personaggio (barra,
     vignettatura, scheda e pedina cambiano); tema chiaro dell'app; Impostazioni › «Riduci animazioni» (tutto
     fermo, niente Ascensione) ed «Effetti boss» spenti (niente lampo né barra).
   - Esporta/Importa: archivio completo e singola sessione con un leggendario; Duplica sessione.
   - Installata come app (PWA): dopo l'aggiornamento parte la nuova versione (cache `session-forge-v21`).
2. Nota rimasta: lo sblocco chiede conferma due volte (dialogo + `confirm()` nativo, come il resto dell'app).
3. **Service worker**: ora `session-forge-v21`; aumentarlo di nuovo dopo le prossime modifiche.

## Test già presenti per questa fase (in `js/test.js`, tutti passano)

- Livelli 20-40: bonus competenza, punti caratteristica, tetto 30, PF oltre il 20, punti percorso per rango.
- Sblocco: collegamento, punti, rango, nodo esclusivo, prerequisiti multipli, rimodella.
- Effetti applicati ai calcoli e tolti al rimborso; nuove magie, slot extra, CD; incantesimo eliminato.
- Privilegio creato dall'utente con usi per riposo, come azione nel combattimento.
- Grafo: collega, scollega, elimina con collegamenti, irraggiungibili, cicli di esclusività, duplicazione, modelli,
  cronologia.
- Trasformazioni: fusione, PF con danno in eccesso, PF temporanei, usi, durata, fine anticipata, fasi del boss,
  barra in alto, nodo che la sblocca.
- Promozione e declassamento, esportazione e importazione (archivio e sessione), migrazione v10 → v11.

## Il prompt originale della fase (testo inserito dall'utente)

```
# FASE: Personaggio leggendario (livelli 20-40, Percorso leggendario, Trasformazioni)

Rileggi i file che toccherai prima di modificarli. Riusa la scheda Giocatore, i calcoli di classe, PF, CA, incantesimi e tiri salvezza, la scheda Creatura/Boss (azioni, fasi, tema, barra vita), il combattimento e la UI artistica del Boss (css/boss.css, js/ui-boss.js). Dove questo blocco contraddice i precedenti (limite livello 20, limite caratteristiche a 20), vale questo solo per i leggendari.

## 1. Dove vive
- In **Giocatori** due schede in alto: **Standard** e **Leggendari**. Un giocatore standard si può promuovere con "Eleva a leggendario" (richiede livello 20; resta modificabile e si può declassare con conferma, conservando i dati del percorso).
- Un leggendario eredita tutto dal giocatore standard (razza, classe, caratteristiche, punti, PF, CA, tiri salvezza, armi, inventario, incantesimi, controllo manuale/IA) e aggiunge due sotto-sezioni: **Percorso leggendario** e **Trasformazioni**.
- Condivisione tra sessioni, duplicazione ed Esporta/Importa come gli altri giocatori.

## 2. Livelli 20-40
- Il livello va da 20 (base) a 40. "Rango leggendario" = livello - 20 (0-20).
- Bonus competenza = 1 + arrotondamento per eccesso di livello/4 (livello 20 = +6, 21-24 = +7, 25-28 = +8, 29-32 = +9, 33-36 = +10, 37-40 = +11). Sovrascrivibile a mano.
- Punti caratteristica: 2 ogni livello multiplo di 4, come prima, fino al 40 (totale 20). Tetto delle caratteristiche dei leggendari = 30 (campo modificabile, con "ignora limite").
- PF: dado vita della classe per ogni livello oltre il 20, con le stesse regole di calcolo (media o tiro, mod. COS, minimo 1 per livello).
- Slot incantesimo: tabella del livello 20 per tutti i livelli leggendari, più slot extra concessi dai nodi del percorso e sovrascrittura manuale. Nessuna progressione di classe inventata: i nuovi privilegi li crea l'utente (sezione 3).
- Punti Percorso: 1 per ogni rango leggendario (massimo 20), più bonus assegnabili a mano dal master.

## 3. Percorso leggendario (mappa a nodi)

### 3.1 Concetto
Il percorso è una **mappa di nodi collegati** (stile albero di abilità a grafo). Un **nodo centrale** (il "Nucleo", sempre sbloccato) si connette ad altri nodi, che si connettono ad altri ancora. Un nodo si può sbloccare solo se è collegato ad almeno un nodo già sbloccato (o, con opzione, a tutti i prerequisiti elencati) e se ho punti sufficienti.

### 3.2 Il nodo
Campi: nome, icona (libreria o immagine, palette colori), descrizione, **costo in punti** (1-5), rango leggendario minimo richiesto, categoria con colore, **effetti** (uno o più), eventuale "esclusivo con" un altro nodo (scelta tra due rami).
Tipi di effetto, con valori modificabili:
- **Bonus caratteristica** (+N a una caratteristica, tetto 30).
- **Competenza** in tiro salvezza, abilità (con maestria) o strumento/arma/armatura.
- **Bonus numerici**: PF massimi, CA, velocità, iniziativa, bonus attacco e danno, CD e bonus attacco incantesimi, bonus competenza, resistenze, immunità, sensi (scurovisione, vista cieca...).
- **Nuove magie**: incantesimi dalla libreria Magie, anche fuori dalla lista di classe, e/o slot extra (livello e numero), con frequenza (sempre preparato, N/giorno).
- **Privilegio di classe creato dall'utente**: nome, descrizione, tipo (passivo, azione, azione bonus, reazione), usi (a volontà, N per riposo breve/lungo) e un editor meccanico come per le azioni delle creature (attacco, tiro salvezza, cura, testo, danno aggiuntivo).
- **Sblocca trasformazione** (collega a una trasformazione della sezione 4).
- **Solo testo** (per effetti narrativi).
Gli effetti numerici e le competenze vengono applicati **in automatico** ai calcoli della scheda (con il dettaglio "da: nome del nodo" nel riepilogo), quelli solo testuali compaiono nell'elenco dei privilegi.

### 3.3 Editor della mappa
- Canvas con zoom e pan (stesso componente del resto dell'app dove possibile), nodi trascinabili liberamente, collegamenti disegnati come linee curve o rette tra nodi.
- Strumenti: aggiungi nodo, collega (trascino da un nodo all'altro), scollega, elimina, duplica, sposta, seleziona più nodi, allinea alla griglia opzionale, "Disposizione automatica a raggiera" attorno al Nucleo.
- Pannello laterale per modificare il nodo selezionato. Ricerca nodi. Validazione: avviso per nodi irraggiungibili dal Nucleo e per cicli di esclusività.
- **Modelli di percorso**: salva un percorso come modello riusabile (libreria globale) e importalo su un altro leggendario. Esporta/importa JSON di un singolo percorso. Un percorso di esempio **originale** con circa 12 nodi.
- Annulla/Ripeti (50 azioni) per l'editor.

### 3.4 Uso in gioco
- Modalità **Sblocca**: i nodi raggiungibili e acquistabili pulsano, quelli bloccati sono spenti, quelli acquisiti illuminati con le linee attive. Punti disponibili/spesi visibili. Clic su un nodo = dettagli + "Sblocca" con conferma.
- **Rimodella** (ripristina i punti) con conferma, o bloccato dopo l'acquisto, scelta del master in impostazioni.
- Dopo lo sblocco, gli effetti entrano in tutti i calcoli (scheda, combattimento, incantesimi).

## 4. Trasformazioni (forma leggendaria)

### 4.1 Cos'è
Una trasformazione porta il **giocatore** in una forma da creatura **Boss** (forma angelica, demoniaca, draconica, elementale, ecc.). Il personaggio resta del giocatore (controllo manuale), ma in forma usa la scheda di una creatura boss. Sezione "Trasformazioni" del leggendario con elenco di forme (aggiungi, duplica, elimina, ordina).

### 4.2 Campi di una trasformazione
- Nome, epiteto, **scheda creatura boss** completa (stesso editor di Creature/Boss: taglia, caratteristiche, CA, PF, velocità, difese, sensi, azioni, multiattacco, azioni leggendarie, tratti, fasi, tema visivo) con "Parti da una creatura esistente".
- **Regole di fusione** (scelta per ogni trasformazione): caratteristiche fisiche (FOR, DES, COS) dalla forma e INT, SAG, CAR dal personaggio; mantiene o perde competenze, incantesimi, equipaggiamento e privilegi di classe.
- **PF**: sostituiscono i PF del personaggio (al ritorno, il danno in eccesso passa al personaggio, come nella trasformazione standard) oppure PF temporanei della forma, a scelta.
- **Costo e durata**: usi per riposo breve/lungo, durata in round o minuti, azione o azione bonus per attivare, può terminare in anticipo. Requisiti: rango leggendario e/o nodo del percorso che la sblocca.
- Dimensione sulla griglia e icona proprie (con la palette colori), alone sulla pedina.
- **Entrata e uscita**: testo e animazione di trasformazione.

### 4.3 In combattimento
- Pulsante **Trasformati** (e "Torna normale") nella scheda del combattente, visibile solo se disponibile. Gli usi si scalano e finiscono nel log.
- In forma: la scheda mostra la creatura boss (azioni come pulsanti, multiattacco, ricarica, azioni leggendarie con punti per turno, fasi che scattano sotto le soglie di PF), con barra della vita **boss in alto** (nome del giocatore + forma), vignettatura e effetti di fase come per i boss. Il controllo resta Manuale (o IA se scelto).
- Concentrazione e incantesimi seguono la regola di fusione. Fine automatica a fine durata o a 0 PF della forma, con riepilogo nel log. Annulla/Ripeti copre attivazione e ritorno.
- Interruttore "Effetti boss" nelle impostazioni già previsto vale anche qui.

## 5. Grafica: più epica e divina del Boss
Il leggendario usa lo stesso sistema a temi del Boss, con temi nuovi pensati per il divino. Stesse regole: sempre scuro, CSS/SVG inline, niente immagini esterne, riuso dei componenti.
- Tema base **Divino**: fondo quasi nero con **vignettatura dorata e bianca**, raggi di luce che scendono dall'alto, polvere luminosa lenta, alone dorato attorno ai pannelli, bordi con cornice ornata (angoli e filigrana), **ali** e **aureola** stilizzate in SVG, spade e lance di luce al posto delle spade conficcate, simboli e rune in sottofondo. Altri temi: Angelico (bianco e azzurro), Abissale (viola e nero), Draconico (oro e rosso), Cosmico (indaco con stelle). Il tema della trasformazione può sostituire quello del personaggio quando è attiva.
- Titolo del personaggio in maiuscolo spaziato con effetto di luce, grande pulsante **"Ascendi"** con bagliore. Divisori a tratto sottile con motivo sacro/tecnico.
- **Percorso leggendario**: sfondo cosmico con stelle lontane, nodi come gemme o sigilli luminosi, linee attive con scorrimento di luce, il Nucleo come sole/aureola. Sblocco con un'animazione di luce che corre lungo la linea e un impulso sul nodo.
- **Animazioni**: al salvataggio di un nuovo leggendario ("Ascensione": colonna di luce, tremolio leggero, comparsa del nome), allo sblocco di un nodo, all'attivazione della trasformazione (lampo e comparsa di ali/aura sulla pedina). Saltabili con un clic.
- Pedina sulla griglia: alone dorato e aureola o simbolo del tema. Nel combattimento, la scheda del leggendario ha una cornice più ricca di quella degli altri giocatori, ma senza coprire pulsanti e testi.
- Contrasto sempre buono, nessun colore scritto nei componenti (variabili CSS dedicate), rispetto di "Riduci animazioni" (statico e leggibile).
- File dedicati (es. `css/leggendario.css`, `js/ui-leggendario.js`, `js/percorso.js` per il grafo).

## 6. Dati e compatibilità
- Giocatore con campo tipo = "leggendario", livello 20-40, punti percorso, nodi e collegamenti con posizioni, nodi sbloccati, trasformazioni, stato attivo della trasformazione (con PF della forma), usi residui. Giocatori esistenti = tipo "standard", invariati.
- Esporta/Importa (archivio e singola sessione), modelli di percorso come libreria globale, duplicazione di sessione, service worker e README aggiornati.
- Riferimenti mancanti (incantesimo o creatura eliminati): avviso e nodo/trasformazione disattivati senza errori.

## 7. Test (a test.html)
Bonus competenza e punti caratteristica ai livelli 20-40; tetto 30; PF oltre il 20; punti percorso per rango; sblocco di un nodo solo se collegato e con punti sufficienti; nodo esclusivo; prerequisiti multipli; effetti numerici e competenze applicati ai calcoli e rimossi al rimborso; nuovi incantesimi e slot extra; privilegio personalizzato con usi per riposo; modifica del grafo (collega, scollega, elimina nodo con collegamenti), nodi irraggiungibili; modelli di percorso; trasformazione con regole di fusione (caratteristiche, PF che passano al personaggio con danno in eccesso), usi e durata, fine anticipata; fasi del boss in forma trasformata; barra in alto; promozione e declassamento; migrazione; esportazione e importazione; effetti disattivati con "Riduci animazioni".

## 8. Ordine di lavoro
1. Scheda Leggendari, livelli 20-40 e calcoli estesi con test. 2. Modello dati del percorso e funzioni pure (sblocco, effetti, rimborso). 3. Editor della mappa a nodi. 4. Effetti dei nodi collegati alla scheda. 5. Modalità Sblocca in gioco. 6. Modello e editor delle Trasformazioni (riuso scheda boss). 7. Trasformazione in combattimento. 8. Grafica divina, temi e animazioni. 9. Modelli di percorso, esempi, esporta/importa e test. Dopo ogni punto verifica che l'app parta e che i test passino, poi fai un resoconto in italiano.
```
