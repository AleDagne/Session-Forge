# Ripresa del lavoro

## Fase in corso: «FASE 2/5: Riposi e risorse» (23 ottobre 2026)

- Stato: **completata**, non ancora committata. Dati alla versione **14**, cache `session-forge-v28`.
- `test.html`: **230/230** passati (7 test nuovi della fase). Attenzione: con la finestra di anteprima a 0×0 il test
  «Boss UI: la vignettatura…» fallisce (elementFromPoint): serve una finestra visibile.
- File nuovi: `js/riposi-dati.js`, `js/riposi.js`, `js/ui-riposi.js`. Aiuto nuovo `DnD.ui.fill` in `ui-comune.js`.
- Toccati: `dati.js` (v14, `status` sulle schede, campi del combattente, `restClock`), `regole.js` (seed dei
  combattenti), `esplorazione.js` (`rest`, alba, PF dalla scheda), `eventi.js` (azione Riposo), `impostazioni.js` e
  `ui-impostazioni.js` (gruppo Riposi), `sessioni.js`, `ui-combattimento.js` (PF temporanei, Risorse, fine del
  combattimento), `ui-creature.js`, `ui-leggendario.js`, `ui-party.js`, `ui-esplorazione.js`, `ui-condizioni.js`, CSS.
- Da provare a mano: riposo breve e lungo di giocatori veri (Giocatori, Party, Esplorazione con incontro notturno),
  proposta «Riposo breve ora?» a fine combattimento.
- Limiti: il riposo di nemici e NPC c'è sulla scheda del combattente ma è disattivato durante il combattimento attivo
  (come richiesto); le creature della libreria non hanno uno stato tra un combattimento e l'altro.

## Fase precedente: «FASE 1/5: Condizioni e concentrazione» (commit `1afa9c1`)

- Stato: completata. Dati alla versione 13.
- `test.html`: **223/223** passati (10 test nuovi della fase).
- Prova nel browser: condizione applicata dalla finestra, attacco della creatura con vantaggio e critico automatico
  contro un paralizzato, azioni del paralizzato disattivate, salvezza ripetuta a fine turno che chiude la condizione,
  simboli sulla scheda e sulla pedina, moduli di creature e incantesimi con «Condizione inflitta».
- File nuovi: `js/condizioni.js` (logica pura), `js/ui-condizioni.js` (interfaccia).
- File toccati: `regole.js` (turni di chi tira contro la morte, critico automatico), `movimento.js`, `creature.js`,
  `magie.js`, `dati.js` (v13, campi del combattente, `customConditions`, `inflict`), `sessioni.js`, `impostazioni.js`
  e `ui-impostazioni.js` (gruppo Combattimento), `ia.js` e `ia-dati.js`, `eventi.js` (prove con le condizioni),
  `suoni-dati.js`, `ui-combattimento.js`, `ui-griglia.js`, `ui-mostri.js`, `ui-magie.js`, `css/style.css`, README e CLAUDE.md.
- Da provare a mano: concentrazione con un incantesimo vero (lancio, danno, «Ripristina»), tiri contro la morte di un
  giocatore, condizioni personalizzate, pedina con più di 4 condizioni a zoom diversi.
- Prossime fasi: 2/5 … 5/5 (prompt dell'utente).

## Fase precedente: «NPC, Fazioni, Città e Party» (completata, commit `9887590`)

Data: 23 ottobre 2026. Questo file serve a riprendere il lavoro da un altro PC.

## Come ripartire

1. Apri una nuova sessione di Claude Code nella cartella del progetto (meglio con Opus).
2. Scrivi: *«Leggi RIPRESA-LAVORO.md e continua la fase NPC, Fazioni, Città e Party dai punti "Da fare"»*.
3. Server locale: `.claude/launch.json` (porta **5617**, `python -m http.server 5617`), poi
   `http://localhost:5617/index.html` e `http://localhost:5617/test.html` (in una finestra visibile).
   Il service worker tiene in cache gli script: ricarica forzata (Ctrl+F5) o togli la registrazione del SW.

## Stato al momento della pausa

- Versione dei dati: **12** (cache del service worker: `session-forge-v24`).
- `test.html`: **213/213** passati (16 test nuovi del Mondo, più la verifica delle scorciatoie).
- L'app parte senza errori; le schede Mondo › Fazioni/Città/NPC/Quest, l'editor NPC (5 sotto-schede) e
  Giocatori › Party si aprono senza errori (prova automatica, senza toccare i dati).
- La fase audio (commit `33c3f5a`) è unita al Mondo: i suoni del Mondo passano da `DnD.audio` (categoria «Mondo»).

## Fatto (file nuovi)

- `js/mondo-dati.js` — costanti modificabili: fazioni predefinite (giocatori, nemici, neutrali), livelli di
  relazione (alleata, amichevole, neutrale, ostile, guerra), relazioni di partenza (Giocatori–Neutrali amichevole,
  Nemici ostili/in guerra: stesso comportamento dei vecchi «Neutrali/Alleati»), soglie di reputazione, tabelle
  degli effetti (prezzi, città, atteggiamento, accesso sotto −50), eventi di reputazione, atteggiamenti, ruoli,
  regole dei combattenti neutrali, mercante, dimensioni città, stati/obiettivi/requisiti quest, dialoghi.
- `js/fazioni.js` — puro: normalizzazione fazioni e `world` della sessione (party attivo, simmetria, soglie,
  reputazione per giocatore, registro, diario quest, variabili, provocazioni), `relazione(a, b, fazioni)`,
  `setRelation`, matrice, asimmetrie, `table`, `relazioneCombattenti` (con ostilità personali `hostileTo` e NPC che
  «aiutano il party»), `ostili`/`alleati`, `areaWarnings`, `combatOver`, soglie ed effetti, `changeReputation` /
  `revertReputation`, `view(state)`, `defaultFactionFor`, `variables(session)`.
- `js/party.js` — puro: party, un solo party per giocatore (`assignPlayer`), ordine di marcia, attivo, fazione del giocatore.
- `js/citta.js` — puro: città, «Crea città» rapido, atteggiamento, contenuti, evento segnaposto «Entra in una mappa».
- `js/npc.js` — puro: NPC (scheda Standard/Creatura riusata via `normalizeCreature`), stato delle copie, copia
  piazzata come oggetto di mappa `otype: 'npc'`, monete (`toCopper`, `fromCopper`, `pay` con resto), mercante
  (prezzi, offerta, `quote`, `checkout`, `restock`, `haggle`), combattente neutrale (`reactions`, `provoke` con
  regole solo/fazione/città, `calm`, `countsForXp`), dialoghi (`answersFor`, `choose`, `dialogWarnings`), routine,
  `statoNpcPerGiocatore`, `missingRefs`, `fromEnemy`.
- `js/quest.js` — puro: quest, diario (`world.quests`), requisiti, offri/accetta/fallisci/completa, avanzamento
  (`onKill`, `onTalk`, `onEvent`, `onReach`, `onCollect`), scadenza, `perGiocatore`, `missingRefs`.
- `js/ui-mondo.js` — sezione **Mondo** (Fazioni con matrice/elenco e simmetria; Città con form, atteggiamento,
  «+ NPC qui», «+ Nemico qui», «Sulla mappa…»), componenti comuni (`factionBadge`, `factionSelect`,
  `worldRefsEditor`, `repBar`, `reputationPanel`, `applyReputation`, suoni con l'interruttore dei suoni dei dadi).
- `js/ui-party.js` — Giocatori › **Party** (elenco, attivo, form con membri e conferma di spostamento, borsa comune,
  dettaglio con ordine di marcia, reputazione, diario).
- `js/ui-npc.js` — Mondo › NPC (elenco, «Promuovi da nemico», editor Generale/Scheda/Mercante/Dialogo/Quest e
  routine), pannello sulla griglia (Parla, Commercia, Quest, Attacca, Entra nell'iniziativa, Scheda, Fazione e
  stato con Calma e anteprima vista giocatori), dialogo giocabile, finestra di scambio con carrello e contrattazione.
- `js/ui-quest.js` — Mondo › Quest (elenco, editor), offerta, consegna con ricompense confermate, diario con filtri.

## Fatto (file modificati)

- `config.js` (voce Mondo dopo Esplorazione), `app.js` (Alt+0 per la decima voce), `index.html`, `test.html`,
  `sw.js` (script nuovi, cache v22), `css/style.css` (stili del Mondo, solo variabili del tema).
- `dati.js`: VERSION 12, `factions/parties/cities/worldNpcs/quests` nello stato, `factionId`/`cityId` su nemici e
  giocatori, fazione libera sui combattenti + `hostileTo`, `npc`, `joinRound`, `fled`, `prevFaction`; `world` nella
  sessione; `migrateV12` + `addDefaultParties` (party «Gruppo» per sessione con i giocatori visibili); copie NPC
  negli oggetti piazzati.
- `sessioni.js`: nuove librerie in OWNED, `remapWorldEntities`, remap di combattimento/world/griglie, export e
  import di sessione con il Mondo (sessioni < v12 ricevono il party «Gruppo»).
- `ia.js` / `movimento.js`: ostili e alleati da `fazioni` con `state.relations`; aree mai su alleati o neutrali;
  NPC in attesa (`joinRound`) ignorati.
- `regole.js`: `nextTurn`/`firstTurn` saltano chi è in attesa (`joinRound`) o fuggito; `waiting` esportato.
- `oggetti-mappa.js` / `ui-oggetti-mappa.js`: tipo `npc` (non nei modelli), il pannello degli NPC si apre al doppio clic.
- `ui-griglia.js`: contorno e pallino della fazione sulle pedine, disegno delle copie NPC (anello, nome, stato),
  gruppo «NPC del Mondo» nel pannello per trascinarli.
- `ui-combattimento.js`: fazioni del Mondo nel setup (default da scheda/party/città), «Aggiungi party», NPC con
  «Entra subito» sulla griglia di partenza, provocazione automatica (attacchi, incantesimi, azioni delle creature)
  con penalità e annullamento, Calma, cambio fazione con «torna a…», badge fazione/NPC/«entra al round N», avvisi
  ad area, uccisioni → quest e reputazione, annuncio fine per fazioni, PE dei nemici sconfitti a fine combattimento.
- `ui-esplorazione.js`: «Aggiungi party» (ordine di marcia, nome e icona), fazioni nei combattimenti da esplorazione,
  pannello NPC sulle mappe di esplorazione.
- `esplorazione.js` / `eventi.js` / `ui-eventi.js`: azioni evento **Reputazione** e **Quest**, scadenza quest col
  tempo, obiettivi «Raggiungi» e «Completa un evento».
- `ui-creature.js`: form riusabile (`DnD.sezioni.nemici.form` con `save`), campi Mondo nei form, scheda Party,
  giocatore nuovo nel party attivo. `ui-mostri.js`: campi Mondo (`worldRefs: false` per le trasformazioni).

## Fatto in questa ripresa

1. Test nuovi in `js/test.js` (sezione «Mondo»): relazioni, reputazione ed effetti, registro, monete, mercante,
   NPC provocato e calma, IA con fazioni, cambio di fazione/avvisi ad area/fine/`joinRound`, party, quest,
   dialoghi, istanze, città, vista giocatori, riferimenti mancanti, migrazione ed esempi, export/import/duplicazione,
   azioni evento Reputazione e Quest.
2. Corretto in `quest.js`: l'avviso «tutti gli obiettivi completati, da consegnare» si ripeteva a ogni uccisione o
   dialogo successivo; ora compare solo quando l'azione fa avanzare la quest.
3. Suoni del Mondo: nuova categoria «Mondo» in `suoni-dati.js` (reputazione su/giù, quest accettata/completata,
   NPC ostile); `ui-mondo.js` non usa più la vecchia impostazione `diceSound` (era sempre muto).
4. Esempi originali (`mondo-dati.js` › `EXAMPLES`, `dati.defaultWorld`): Compagnia della Lanterna, Pontegrigio,
   Orsola Tre Monete (mercante con dialogo), «Le lanterne spente». Negli archivi nuovi e in quelli migrati da v11.
5. Pulizie: `ui-npc.js` senza `|| true`; scorciatoie con cifra fissa (`key` in `MENU`): **Mondo = Alt+0**, le
   altre come prima (prima Alt+0 apriva Dadi e Nemici…Dadi erano slittati di uno); «null» scritto per sbaglio in
   alcuni pannelli (`append` nativo con `null`: Party, NPC, scambio, Boss, Oggetti di mappa).
6. README (sezione Mondo, navigazione, IA, suoni, modello dati v12, migrazione, test, struttura) e CLAUDE.md.

## Da fare

1. **Prove a mano** (non automatizzabili senza toccare i dati veri): fazioni e relazioni; party; città e
   segnaposto; NPC mercante trascinato sulla griglia (Editor, Combattimento, Esplorazione); dialogo; scambio e
   contrattazione; attacco a un neutrale (provocazione e annullamento); quest offerta/consegnata; diario; reputazione.
2. Note: un archivio **già alla v12** non riceve gli esempi del Mondo (solo archivi nuovi o migrati da v11). La
   regola «blocca se ostile» (`world.blockHostile`) è sempre attiva: non c'è ancora un interruttore nell'interfaccia.
   La routine degli NPC resta un promemoria (non sposta le pedine).

## Il prompt originale della fase (testo inserito dall'utente)

```
# FASE: NPC, Fazioni, Città e Party

Rileggi i file che toccherai prima di modificarli. Riusa schede Standard/Creature/Boss, Attrezzatura, combattimento, comportamento automatico dei nemici, Esplorazione ed eventi, note, log, dadi e suoni. Dove questo blocco contraddice i precedenti (le tre fazioni fisse), vale questo.

## 1. Dove vive
- Nuova voce di menù **Mondo** subito dopo Esplorazione, con le schede **Fazioni, Città, NPC**. Scorciatoia Alt+0. Aggiorna menù, test sull'ordine delle voci e README.
- In **Giocatori** una nuova scheda **Party**.
- Fazioni, Città e NPC sono librerie per sessione, con "Condividi con tutte le sessioni" come i nemici. Esporta/Importa, duplicazione di sessione e service worker aggiornati.

## 2. Fazioni (meccanica reale)
- Una fazione ha: nome, colore, icona (libreria o immagine), descrizione, note del master.
- **Relazioni tra fazioni**: per ogni coppia un livello tra Alleata, Amichevole, Neutrale, Ostile, In guerra (matrice modificabile, simmetrica o no a scelta). Vista a matrice o a elenco.
- **Reputazione** del party (e di ogni giocatore, opzionale) verso ogni fazione: valore da -100 a +100 con soglie modificabili (Nemico giurato, Ostile, Diffidente, Neutrale, Amichevole, Alleato, Eroe). La reputazione cambia da azioni di eventi, quest, combattimenti e a mano.
- **Effetti automatici**: prezzi dei mercanti, atteggiamento iniziale degli NPC, accesso a quest e città (alcune bloccate se ostili), bersagli dell'IA.
- Fazioni predefinite non eliminabili: Giocatori, Nemici, Neutrali. I dati esistenti vi migrano senza perdite.
- Assegnazione della fazione a **giocatore, party, nemico (Standard, Creatura, Boss), NPC e città**. Ogni combattente ha una fazione propria, che per default eredita dal party, dalla città o dal modello.
- Nel combattimento la relazione decide chi è alleato, neutrale o ostile. Il comportamento automatico attacca solo chi è Ostile o In guerra, supporta Alleati e Amichevoli, ignora i Neutrali. Colore del contorno della pedina e icona della fazione visibili (tooltip).
- **Cambio di fazione in gioco**: un combattente può cambiare fazione (anche a metà combattimento), con voce nel log e annullabile.

## 3. Party
- Un party ha nome, colore, icona, fazione, giocatori scelti dall'elenco (anche leggendari), ordine di marcia, inventario e monete condivisi (opzionale), reputazione comune, note.
- Più party per sessione, uno attivo. Nel Combattimento e nell'Esplorazione "Aggiungi party" inserisce tutti i membri. In Esplorazione il party è la pedina del gruppo. Si può dividere e riunire.
- Un giocatore appartiene a un solo party alla volta (si cambia con conferma).

## 4. Città
- Una città ha: nome, descrizione, fazione dominante e fazioni presenti, dimensione, bioma, **mappa collegata** (griglia di battaglia o esplorazione, opzionale), posizione sulla mappa di esplorazione (segnaposto), ambiente e regole (armi vietate, coprifuoco, tasse: testo e promemoria).
- **Atteggiamento della città** verso il party dalla reputazione con la fazione dominante (ostile = porte chiuse, prezzi alti o guardie nemiche).
- Contenuti: elenco di NPC, mercanti, quest disponibili ed eventi collegati (ingresso, incontri tipici).
- "Crea città" con modulo rapido: nome, fazione, dimensione, bioma. Assegnare la fazione di una città la propaga come predefinita a NPC e nemici creati lì (modificabile).
- Una città si piazza sulla mappa come evento "Entra in una mappa", con ritorno.

## 5. NPC
Un NPC è una scheda che **riusa** Standard o Creatura (statistiche, PF, CA, armi, incantesimi) e aggiunge: ruolo, fazione, città, atteggiamento, dialogo, icona, dimensione, note. Si crea da zero o con "Promuovi da nemico/creatura". Non conta nei calcoli di difficoltà e nei PE finché non diventa ostile.
- **Atteggiamento**: Amichevole, Indifferente, Ostile, con valore base e modificatore dalla reputazione. Cambia con le azioni.
- **Ruoli** (combinabili):
  - **Mercante**: inventario in vendita (oggetti dell'Attrezzatura con quantità, prezzo base e rifornimento giornaliero opzionale), monete disponibili per comprare dal party, margine di vendita e acquisto, sconto o rincaro in base a reputazione e atteggiamento, oggetti sbloccati solo da reputazione minima. Finestra di scambio con carrello, totale in monete (mr, ma, me, mo, mp con conversione) e trasferimento all'inventario del giocatore scelto. Prova di Persuasione per contrattare (CD e effetto sul prezzo). Tutto nel log.
  - **Datore di quest**: elenco di quest (sezione 6), con dialogo di offerta, accettazione e consegna.
  - **Combattente neutrale**: ha scheda da combattimento ma non attacca. Opzioni: **difende se stesso**, **difende alleati/fazione**, **aiuta il party** se amichevole. Se viene attaccato (o un suo alleato di fazione, o un suo amico) **diventa ostile**: la sua fazione cambia o la relazione scende, secondo la regola scelta (solo lui, tutta la fazione, a cerchi di città). Penalità di reputazione e voce nel log, annullabile dal master. Se più tardi viene calmato (prova o evento) torna neutrale.
  - **Informatore / Altro**: solo dialogo, informazioni e indizi.
- **Dialogo**: alberi semplici a scelte (nodo di testo, risposte, condizioni di reputazione/oggetto/variabile, esiti: prova, reputazione, apri quest, apri negozio, avvia combattimento, cambia atteggiamento). Editor a elenco di blocchi come gli eventi.
- **Routine opzionale**: posizione per ora del giorno sulla mappa o in città.
- **Sulla griglia** una pedina con icona e nome. Doppio clic apre il pannello NPC (Parla, Commercia, Quest, Attacca, Scheda, Fazione). Gli NPC con ruolo nascosto mostrano solo il nome.
- NPC modello e NPC istanza come per eventi e oggetti: ogni copia ha stato proprio (PF, inventario del mercante, atteggiamento, quest consegnate).

## 6. Quest
- Quest: titolo, descrizione, datore (NPC o fazione), fazione, requisiti (reputazione, livello, oggetto, evento), **obiettivi** (parlare con, uccidere N creature di un tipo, raccogliere oggetti, raggiungere un luogo, completare un evento) con contatori, tempo limite opzionale, ricompense (PE, monete, oggetti, reputazione, sblocco di negozi o quest).
- Stati: Disponibile, Attiva, Completata, Fallita, Scaduta. Diario di quest per il party, con ricerca e filtro per fazione.
- Collegamento con Eventi: eventi possono avviare, avanzare o chiudere quest, e le quest possono attivare eventi. Variabili di sessione condivise.
- Collegamento con il combattimento: le uccisioni di creature aggiornano gli obiettivi, e la fine del combattimento calcola i PE. Alla consegna si distribuiscono ricompense e reputazione con conferma del master.
- Le quest non compaiono ai giocatori se non sono state offerte e accettate.

## 7. Reputazione e conseguenze
- Eventi di reputazione: completare o fallire quest, uccidere o salvare un NPC di una fazione, attaccare un NPC neutrale, doni e furti (registro con motivazione e possibilità di correggere a mano).
- Soglie con effetti configurabili: sotto -50 la città diventa ostile, sopra +50 sconto del 10%. Valori e tabelle in un file dati.
- Pannello "Reputazione" del party con barre per fazione e storico delle variazioni.

## 8. Comportamento automatico e combattimento
- `relazione(a, b)` come unica fonte di verità (funzione pura) usata da IA, bersagli, effetti ad area (gli incantesimi ad area avvisano se colpiscono neutrali o alleati) e vittoria/sconfitta.
- NPC neutrali nel combattimento: restano fuori dall'ordine di iniziativa finché non diventano ostili, poi tirano l'iniziativa e entrano al round successivo. Opzione per includerli subito.
- Condizione di fine combattimento: tutte le fazioni ostili al party sconfitte o in fuga, indipendentemente dal tipo.
- Effetti di fazione su creature e boss: un boss può avere una fazione e un seguito.

## 9. Online (compatibilità futura)
Il giocatore non riceve mai: reputazioni nascoste, ruoli nascosti, atteggiamenti segreti, contenuto dei negozi non scoperti, quest non offerte, note dell'NPC. Vede il nome, l'icona e lo stato che il master rivela. Interfaccia `statoNpcPerGiocatore()` separata dai dati.

## 10. Dati e compatibilità
- Nuovi dati: fazioni con matrice, reputazione, party, città, NPC con ruoli e stato, dialoghi, quest con stato, diario, cronologia reputazione.
- Migrazione: i combattenti esistenti ricevono la fazione Giocatori, Nemici o Neutrali secondo il campo precedente. Giocatori esistenti nel party "Gruppo" predefinito. Nulla viene perso.
- Riferimenti mancanti (oggetto, creatura, mappa eliminati): avviso e voce disattivata, senza errori.
- Suoni opzionali (se la fase audio esiste): reputazione che cambia, quest accettata o completata, NPC che diventa ostile.

## 11. Test (a test.html)
Matrice delle relazioni e funzione `relazione`; effetti della reputazione su prezzi e accesso; soglie; acquisto e vendita con conversione monete, rifornimento, oggetti sbloccati da reputazione, contrattazione; NPC neutrale che diventa ostile (solo lui, intera fazione, cerchi), penalità e annullamento, ritorno a neutrale; NPC non conteggiato nella difficoltà finché è neutrale; bersagli dell'IA con alleati, neutrali, ostili; cambio di fazione a metà combattimento; party con più membri e un solo party per giocatore; quest con obiettivi e contatori, uccisioni da combattimento, ricompense, scadenza; dialogo con condizioni; istanze indipendenti dello stesso NPC modello; città con fazione propagata; migrazione; esportazione e importazione; riferimenti mancanti; filtro dei dati per il giocatore.

## 12. Ordine di lavoro
1. Voce Mondo, modello dati delle fazioni, matrice e `relazione` con test e migrazione. 2. Reputazione e soglie. 3. Assegnazione della fazione a giocatori, nemici, creature e boss, e integrazione con IA e combattimento. 4. Scheda Party e uso nel Combattimento e nell'Esplorazione. 5. Città. 6. NPC base con pedina e pannello. 7. Mercanti e finestra di scambio. 8. Combattenti neutrali e conversione in ostili. 9. Dialoghi. 10. Quest e diario, collegamenti con eventi e combattimento. 11. Filtro per giocatore, suoni, esempi originali e test. Dopo ogni punto verifica che l'app parta e che i test passino, poi fai un resoconto in italiano.
```
