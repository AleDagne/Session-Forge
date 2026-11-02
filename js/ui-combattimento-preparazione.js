// Combattimento › Preparazione e iniziativa: scelta di giocatori, nemici (quantità, controllo, fazione) e griglia di
// partenza, generatore di nemici, indicatore di difficoltà, combattimento simulato; tiro e modifica dell'iniziativa e
// avvio dello scontro. Parte della schermata Combattimento (ui-combattimento.js), che le passa stato e funzioni con
// un'api. Livello interfaccia. Espone DnD.uiCombattimentoPreparazione { preparazione(api) }.
(function (DnD) {
  'use strict';

  // api (da ui-combattimento.js): DF, FZ, G, IA, M, MAX_COPIES, Mv, NP, R, S, UD, agganci, aiHistory, beginDice, byId, dice, el, endDice, field, joinFromItem, log, mutate, numberInput, order, partyFaction, readNumber, relTable, render, rules, session, setup, showErrors, startTurnOf, toast, worldView
  function preparazione(api) {
    const {
      DF, FZ, G, IA, M, MAX_COPIES, Mv, NP, R, S, UD, agganci, aiHistory, beginDice, byId, dice, el, endDice, field, joinFromItem, log, mutate, numberInput, order, partyFaction, readNumber, relTable, render, rules, session, setup, showErrors, startTurnOf, toast, worldView,
    } = api;

    // ---------- Setup ----------
    // Genera nemici al volo: vengono salvati in Nemici e aggiunti al setup (uno per ciascuno). La difficoltà del
    // generatore parte dalla selezione del setup (setupInput, assegnato da renderSetup).
    function generateAndAdd() {
      DnD.uiGeneratore.open({
        saveLabel: 'Salva e aggiungi al combattimento',
        baseInput: S.setupInput ? S.setupInput() : null,
        onSaved: (creatures) => {
          for (const c of creatures) setup.npcs[c.id] = 1;
          render();
        },
      });
    }

    function renderSetup() {
      const st = DnD.store.state;
      const vPlayers = DnD.sessioni.visible(st, 'players');
      const vNpcs = DnD.sessioni.visible(st, 'npcs');
      const vGrids = DnD.sessioni.visible(st, 'savedGrids');
      S.setupInput = null;
      if (!vPlayers.length && !vNpcs.length) {
        S.root.append(DnD.ui.emptyState('Nessun personaggio in questa sessione',
          'Per iniziare un combattimento servono nemici o giocatori della sessione «' + session().name + '» (o condivisi con tutte le sessioni).', [
            { text: '🎲 Genera e aggiungi', primary: true, onclick: generateAndAdd },
            { text: '+ Aggiungi nemici', onclick: () => DnD.app.navigate('nemici', 'nuovo') },
            { text: '+ Aggiungi giocatori', onclick: () => DnD.app.navigate('giocatori', 'nuovo') },
            { text: 'Crea una griglia', onclick: () => DnD.app.navigate('editor', 'nuovo') },
          ]));
        return;
      }
      const playerSummary = (c) => { // i leggendari con gli effetti dei nodi già applicati
        const e = DnD.leggendario.effectivePlayer(c, st);
        return [DnD.classi.className(c.classId), 'PF ' + e.maxHp, 'CA ' + DnD.statistiche.derivedStats(e, st.races.find((r) => r.id === c.raceId), st.equipment).ac.total];
      };
      const summary = (c) => (DnD.boss.isMonster(c)
        ? [c.type === 'boss' ? 'Boss' : 'Creatura', 'GS ' + DF.crOf(c) + (DF.crOf(c) !== c.cr ? ' effettivo' : ''), 'PF ' + M.hpInfo(c).total, 'CA ' + c.ac]
        : playerSummary(c).concat(vPlayers.includes(c) ? [] : ['GS ' + DF.crOf(c)]));
      const qtyInputs = {};
      const errorBox = el('div', { class: 'error', 'aria-live': 'polite' });
      // Controllo (Manuale o IA) e fazione per riga: di base giocatori Manuale, nemici IA.
      // Fazione di partenza: quella della scheda, del party (giocatori) o della città (nemici).
      const wv = worldView(st);
      const fctx = { parties: wv.parties, cities: wv.cities, factions: wv.factions };
      const sourceOf = (id) => vPlayers.find((p) => p.id === id) || vNpcs.find((n) => n.id === id);
      const defaultFactionOf = (id, kind) => FZ.defaultFactionFor(sourceOf(id), kind, fctx);
      function controlPickers(id, kind) {
        const control = setup.control[id] || IA.defaultControl(kind);
        const faction = setup.faction[id] || defaultFactionOf(id, kind);
        return el('span', { class: 'control-pickers' },
          el('select', { class: 'small-select', 'aria-label': 'Controllo', onchange: (e) => { setup.control[id] = e.target.value; } },
            el('option', { value: 'manuale', text: '👤 Manuale', selected: control === 'manuale' }), el('option', { value: 'ia', text: '🤖 IA', selected: control === 'ia' })),
          el('select', { class: 'small-select', 'aria-label': 'Fazione', onchange: (e) => { setup.faction[id] = e.target.value; refreshDifficulty(); } },
            wv.factions.map((f) => el('option', { value: f.id, text: f.name, selected: f.id === faction }))));
      }
      const activeParty = DnD.party.active(wv.parties, wv.world);

      // Difficoltà (difficolta.js): giocatori scelti (o il party attivo) contro i nemici ostili al party e gli NPC
      // della griglia di partenza che contano (ostili, o neutrali con l'opzione). Si aggiorna a ogni modifica.
      function encounterInput() {
        const chosen = vPlayers.filter((p) => setup.players.has(p.id));
        const party = DF.partyFrom(chosen.length ? chosen : UD.partyPlayers(st).players);
        const t = relTable(st);
        const pf = partyFaction(st);
        const rules = UD.rules();
        const creatures = [];
        for (const n of vNpcs) {
          const q = qtyInputs[n.id] ? readNumber(qtyInputs[n.id]) : setup.npcs[n.id] || 0;
          if (!Number.isInteger(q) || q <= 0) continue;
          if (DF.counts({ id: n.id, faction: setup.faction[n.id] || defaultFactionOf(n.id, 'npc') }, t, pf, rules)) creatures.push(DF.group(n, Math.min(q, MAX_COPIES)));
        }
        const g = vGrids.find((x) => x.id === setup.gridId);
        for (const it of g ? g.items.filter((y) => y.otype === 'npc' && !y.npcState.dead) : []) {
          const npc = (st.worldNpcs || []).find((n) => n.id === it.npcId);
          if (!npc) continue;
          const fid = NP.factionOf(npc, it.npcState, wv.cities);
          const att = NP.attitudeOf(npc, it.npcState, FZ.reputationOf(wv.world, activeParty, fid));
          const x = { id: it.id, faction: fid, npc: NP.combatData(npc, it.npcState, it.id, att), hostileTo: it.npcState.hostile ? [pf] : it.npcState.hostileTo };
          if (DF.counts(x, t, pf, rules)) creatures.push(DF.group(Object.assign({}, npc.stats, { id: it.id, name: it.name || npc.name }), 1, { fixed: true }));
        }
        return { party, creatures };
      }
      const difficulty = UD.indicator({
        title: 'Difficoltà dell\'incontro',
        onBalance: () => {
          const input = encounterInput();
          UD.balanceDialog(input, (i, count) => { setup.npcs[input.creatures[i].id] = count; render(); }, MAX_COPIES);
        },
      });
      S.setupInput = encounterInput;
      const partyNote = el('p', { class: 'muted small' });
      function refreshDifficulty() {
        difficulty.update(encounterInput());
        partyNote.textContent = (vPlayers.some((p) => setup.players.has(p.id)) ? 'Party: i giocatori scelti.' : 'Party: ' + UD.partyPlayers(st).label + ' (nessun giocatore scelto).') +
          ' Contano i nemici ostili al party e gli NPC ostili della griglia di partenza.';
      }

      const playersBox = vPlayers.length
        ? el('ul', { class: 'pick-list' }, vPlayers.map((p) => el('li', {},
          el('label', { class: 'check' },
            el('input', { type: 'checkbox', checked: setup.players.has(p.id), onchange: (e) => { if (e.target.checked) setup.players.add(p.id); else setup.players.delete(p.id); refreshDifficulty(); } }),
            ' ', el('b', { text: p.name }),
            el('span', { class: 'muted small', text: ' · ' + [p.playerName].concat(summary(p)).filter(Boolean).join(' · ') })), ' ', controlPickers(p.id, 'player'))))
        : el('p', { class: 'empty', text: 'Nessun giocatore. Creali nella sezione Giocatori.' });

      const npcsBox = vNpcs.length
        ? el('ul', { class: 'pick-list' }, vNpcs.map((n) => {
          qtyInputs[n.id] = numberInput(setup.npcs[n.id] || 0, {
            min: 0, max: MAX_COPIES, class: 'qty', 'aria-label': 'Quantità di ' + n.name,
            oninput: (e) => { setup.npcs[n.id] = readNumber(e.target); refreshDifficulty(); },
          });
          return el('li', {}, qtyInputs[n.id], ' ', el('b', { text: n.name }), ' ',
            el('span', { class: 'tag' + (n.type === 'boss' ? ' boss-tag' : n.type === 'creatura' ? ' accent' : ''), text: n.type === 'boss' ? '👑 Boss' : n.type === 'creatura' ? 'Creatura' : 'Standard' }),
            el('span', { class: 'muted small', text: ' · ' + summary(n).filter(Boolean).join(' · ') }), ' ', controlPickers(n.id, 'npc'));
        }))
        : el('p', { class: 'empty', text: 'Nessun nemico. Creali nella sezione Nemici.' });

      function start() {
        const players = vPlayers.filter((p) => setup.players.has(p.id));
        const entries = [];
        for (const n of vNpcs) {
          const q = readNumber(qtyInputs[n.id]);
          if (!Number.isInteger(q) || q < 0 || q > MAX_COPIES) {
            qtyInputs[n.id].classList.add('invalid');
            errorBox.textContent = 'La quantità di "' + n.name + '" deve essere un intero tra 0 e ' + MAX_COPIES + '.';
            qtyInputs[n.id].focus();
            return;
          }
          if (q > 0) entries.push({ npc: n, quantity: q });
        }
        if (!players.length && !entries.length) {
          errorBox.textContent = 'Seleziona almeno un giocatore o un nemico.';
          return;
        }
        beginDice();
        const combatants = DnD.combattenti.createCombatants(players, entries, st.races, dice(), st.spells, st.equipment);
        endDice('Iniziativa', '');
        for (const x of combatants) {
          if (setup.control[x.sourceId]) x.control = setup.control[x.sourceId];
          x.faction = setup.faction[x.sourceId] || defaultFactionOf(x.sourceId, x.kind === 'player' ? 'player' : 'npc');
        }
        const startGrid = vGrids.find((g) => g.id === gridSelect.value);
        let unplaced = [];
        DnD.store.update((s) => {
          session(s).combat = {
            id: DnD.dadi.uid(), phase: 'iniziativa', round: 1, currentId: null, combatants, log: [],
            ai: { simulated: setup.simulated, mode: 'passo', delay: 1, seed: DnD.dadi.randomInt(2147483646) },
            grid: Object.assign({ structures: [], items: [], labels: [], zones: [], tileMap: null, ignoreCollisions: false, sourceGridId: null }, G.gridProps({})),
          };
          if (startGrid) unplaced = DnD.griglia.applySavedGrid(session(s).combat, startGrid, DnD.dadi.uid);
          // NPC del Mondo sulla griglia con «Entra subito»: combattenti (neutrali) fin dall'iniziativa.
          const cb = session(s).combat;
          for (const it of cb.grid.items.filter((y) => y.otype === 'npc')) {
            const npc = (s.worldNpcs || []).find((n) => n.id === it.npcId);
            if (npc && npc.combat.joinNow && !it.npcState.dead) joinFromItem(cb, s, it, Boolean(it.npcState.hostile));
          }
        });
        if (unplaced.length) toast('Non entrano nelle zone di partenza: ' + unplaced.map((x) => x.name).join(', ') + '. Trascinali dal pannello.', 'error');
        setup.players.clear();
        setup.npcs = {};
        setup.gridId = '';
        aiHistory.clear();
        S.aiPlan = null;
        S.aiPaused = false;
        render();
      }

      const gridSelect = el('select', { onchange: (e) => { setup.gridId = e.target.value; refreshDifficulty(); } },
        el('option', { value: '', text: 'Griglia vuota' }),
        vGrids.map((g) => el('option', { value: g.id, text: g.name, selected: g.id === setup.gridId })));
      const gridPanel = el('section', { class: 'panel' },
        el('h2', { text: 'Griglia di partenza' }),
        el('div', { class: 'grid-start' },
          field('Parti da', gridSelect),
          el('button', { type: 'button', class: 'btn', text: 'Griglie salvate…', onclick: () => DnD.uiGriglia.savedGridsDialog((g) => {
            setup.gridId = g.id;
            render();
            return true;
          }) })),
        el('p', { class: 'muted small', text: 'Dalla griglia salvata vengono ripresi strutture, oggetti e posizioni dei combattenti con lo stesso nome; gli altri restano da trascinare.' }));

      S.root.append(
        el('div', { class: 'section-head' }, el('h1', { text: 'Nuovo combattimento' }),
          el('div', { class: 'head-actions' }, el('button', { class: 'btn', text: '🌐 Online', title: 'Gioco online: ospita i giocatori o unisciti a una sessione', onclick: () => agganci.apriOnline() }))),
        el('section', { class: 'panel diff-panel' }, difficulty.node, partyNote),
        el('div', { class: 'grid-2' },
          el('section', { class: 'panel' },
            el('div', { class: 'history-head' },
              el('h2', { text: 'Giocatori' }),
              el('div', { class: 'head-actions' },
                activeParty && activeParty.memberIds.length ? el('button', { class: 'btn small', text: '⚑ Aggiungi party', title: 'Tutti i membri di «' + activeParty.name + '»',
                  onclick: () => { activeParty.memberIds.forEach((id) => { if (vPlayers.some((p) => p.id === id)) setup.players.add(id); }); render(); } }) : null,
                vPlayers.length ? el('button', { class: 'btn small', text: 'Tutti', onclick: () => { vPlayers.forEach((p) => setup.players.add(p.id)); render(); } }) : null)),
            playersBox),
          el('section', { class: 'panel' },
            el('div', { class: 'history-head' },
              el('h2', { text: 'Nemici e quantità' }),
              el('button', { class: 'btn small', text: '🎲 Genera e aggiungi', onclick: generateAndAdd })),
            npcsBox)),
        gridPanel,
        el('div', { class: 'form-actions' }, errorBox,
          el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: setup.simulated, onchange: (e) => { setup.simulated = e.target.checked; } }), ' Combattimento simulato (IA)'),
          el('button', { class: 'btn primary', text: 'Tira l\'iniziativa', onclick: start })));
      refreshDifficulty();
    }

    // ---------- Iniziativa ----------
    function renderInitiative() {
      const inputs = {};
      const list = order();
      const rerollAll = () => {
        beginDice();
        mutate((c) => {
          for (const x of c.combatants) Object.assign(x, R.rollInitiative(x.dexMod, dice()));
        });
        endDice('Iniziativa ritirata', '');
      };
      const begin = () => {
        const errors = {};
        for (const x of list) {
          const v = readNumber(inputs[x.id]);
          DnD.validazione.intInRange(errors, 'init.' + x.id, v, -20, 60);
        }
        if (!showErrors(S.root, errors)) return;
        mutate((c) => {
          for (const x of c.combatants) x.initiative = readNumber(inputs[x.id]);
          const sorted = R.sortByInitiative(c.combatants);
          c.phase = 'attivo';
          c.round = 1;
          c.currentId = R.firstTurn(sorted);
          for (const x of c.combatants) Mv.resetTurn(x);
          log(c, 'sistema', 'Inizia il combattimento. Ordine: ' + sorted.map((x) => x.name + ' (' + x.initiative + ')').join(', ') + '.');
          if (c.currentId) startTurnOf(c, sorted, null, c.currentId, true);
        });
      };
      const cancel = () => {
        if (confirm('Annullare il combattimento?')) mutate((c, st) => { session(st).combat = null; });
      };

      S.root.append(
        el('div', { class: 'section-head' }, el('h1', { text: 'Iniziativa' }),
          el('div', { class: 'head-actions' },
            el('button', { class: 'btn', text: 'Ritira tutti', onclick: rerollAll }),
            el('button', { class: 'btn danger', text: 'Annulla', onclick: cancel }))),
        (agganci.bannerEsplorazione && agganci.bannerEsplorazione()) || '',
        el('div', { class: 'panel' },
          el('p', { class: 'muted', text: 'd20 + modificatore di DES tirati automaticamente. Puoi correggere i valori a mano.' }),
          el('table', { class: 'init-table' },
            el('thead', {}, el('tr', {}, ['Combattente', 'Tiro', 'Iniziativa'].map((t) => el('th', { text: t })))),
            el('tbody', {}, list.map((x) => {
              inputs[x.id] = numberInput(x.initiative, { 'data-key': 'init.' + x.id, 'aria-label': 'Iniziativa di ' + x.name, onchange: (e) => {
                const v = readNumber(e.target);
                if (Number.isInteger(v) && v >= -20 && v <= 60) DnD.store.update(() => { byId(x.id).initiative = v; });
              } });
              return el('tr', { class: x.kind },
                el('td', {}, el('span', { class: 'kind-dot ' + x.kind }), ' ', x.name),
                el('td', { class: 'muted', text: 'd20 (' + x.initiativeRoll + ') ' + R.formatModifier(x.dexMod) }),
                el('td', {}, inputs[x.id], el('div', { class: 'error', 'data-error': 'init.' + x.id })));
            }))),
          el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', text: 'Inizia combattimento', onclick: begin }))));
    }

    return { renderInitiative, renderSetup };
  }

  DnD.uiCombattimentoPreparazione = { preparazione };
})(globalThis.DnD = globalThis.DnD || {});
