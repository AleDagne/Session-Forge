// Combattimento › Azioni delle creature: finestre e risoluzione delle azioni dei mostri e dei boss (multiattacco,
// tiri per colpire, salvezze, danni per tipo, ricariche e usi), schede dei combattenti con risorse e riposi e la
// schermata del combattimento in corso (renderActive: colonne, griglia, turni, registro).
// Parte della schermata Combattimento (ui-combattimento.js), che le passa stato e funzioni comuni con un'api.
// Livello interfaccia. Espone DnD.uiCombattimentoCreature { creature(api) }.
(function (DnD) {
  'use strict';

  // api (da ui-combattimento.js): castDialog, editDialog, healDialog, removeCombatant, saveDialog, slotsIndicator, C, G, M, R, RP, S, UC, agganci, aiOn, aiPanel, attackDialog, attackModsFor, beginDice, blockedBy, byId, clone, combat, conditionsDialog, confirmArea, customs, dice, el, endCombat, endDice, getGrid, hurt, inflictOn, log, movementBox, mutate, nextTurn, noteAggression, openDialog, order, render, rollText, scheduleAuto, selectCombatant, speedText, toast
  function creature(api) {
    const {
      castDialog, editDialog, healDialog, removeCombatant, saveDialog, slotsIndicator, C, G, M, R, RP, S, UC, agganci, aiOn, aiPanel, attackDialog, attackModsFor, beginDice, blockedBy, byId, clone, combat, conditionsDialog, confirmArea, customs, dice, el, endCombat, endDice, getGrid, hurt, inflictOn, log, movementBox, mutate, nextTurn, noteAggression, openDialog, order, render, rollText, scheduleAuto, selectCombatant, speedText, toast,
    } = api;

    // ---------- Azioni delle creature ----------
    // Bersagli proposti: per cure gli alleati (compreso sé stesso), altrimenti gli avversari non a terra.
    function targetPool(x, a) {
      const others = order().filter((t) => t.id !== x.id);
      return a.mech.kind === 'cura' ? [x].concat(others) : others;
    }
    function defaultTarget(x, a, pool) {
      const enemy = (t) => (a.mech.kind === 'cura' ? t.kind === x.kind : t.kind !== x.kind);
      return (pool.find((t) => enemy(t) && !R.isDown(t)) || pool[0] || {}).id;
    }

    // Finestra dell'azione: per il multiattacco una riga per ogni attacco previsto, ciascuna con il proprio
    // bersaglio; per i tiri salvezza ad area più bersagli. preset: { targets: { indice: [id] }, mode }.
    function creatureActionDialog(x, actionId, preset) {
      preset = preset || {};
      const st = x.creature;
      const a = M.allActions(st).find((y) => y.id === actionId);
      if (!a) return;
      if (a.mech.kind === 'testo') { performCreatureAction(x.id, a.id, [], 'normale'); return; }
      const steps = a.mech.kind === 'multiattacco' ? M.expandMultiattack(st, a) : [a];
      if (!steps.length) { toast('Il multiattacco non ha azioni valide.', 'error'); return; }
      const rows = steps.map((sub, i) => {
        const pool = targetPool(x, sub);
        const multi = sub.mech.kind === 'salvezza' && Boolean(sub.mech.area);
        const chosen = new Set((preset.targets && preset.targets[i]) || [defaultTarget(x, sub, pool)].filter(Boolean));
        const box = el('div', { class: 'target-checks' }, pool.map((t) => el('label', { class: 'check' },
          el('input', { type: multi ? 'checkbox' : 'radio', name: 'bersaglio-' + i, value: t.id, checked: chosen.has(t.id) }),
          ' ' + t.name + ' (CA ' + t.ac + ', PF ' + t.hp + '/' + t.maxHp + ')' + (R.isDown(t) ? ' – a terra' : '') +
            (t.pos && x.pos && t.id !== x.id ? ' · ' + G.tokenDistance(x, t) + ' cas.' : ''))));
        return { sub, box, node: el('fieldset', {}, el('legend', { text: (steps.length > 1 ? (i + 1) + '. ' : '') + M.actionTitle(sub) }),
          el('p', { class: 'muted small', text: M.actionText(st, sub) }), box) };
      });
      const hasAttack = steps.some((y) => y.mech.kind === 'attacco');
      const mode = (value, label) => el('label', { class: 'check' }, el('input', { type: 'radio', name: 'modo-creatura', value, checked: value === (preset.mode || 'normale') }), ' ' + label);
      const modeBox = hasAttack ? el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro per colpire' }), mode('normale', 'Normale'), mode('vantaggio', 'Vantaggio'), mode('svantaggio', 'Svantaggio')) : null;
      const read = () => rows.map((r) => [...r.box.querySelectorAll('input:checked')].map((i) => i.value));
      const currentMode = () => (modeBox ? body.querySelector('input[name="modo-creatura"]:checked').value : 'normale');
      const pickButton = steps.length === 1 && S.grid && S.grid.hasTokens() && S.grid.node.isConnected
        ? el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
          const keep = { mode: currentMode() };
          dialog.dismiss();
          S.grid.pickTarget((id) => { const xx = byId(x.id); if (xx && id) creatureActionDialog(xx, actionId, Object.assign(keep, { targets: { 0: [id] } })); });
        } })
        : null;
      const body = el('div', { class: 'form' }, rows.map((r) => r.node), pickButton, modeBox);
      const dialog = openDialog(x.name + ': ' + a.name, body, [
        { text: 'Annulla' },
        { text: '▶ Esegui', class: 'primary', onclick: () => {
          const targets = read();
          if (targets.some((t) => !t.length)) { toast('Scegli un bersaglio per ogni attacco.', 'error'); return false; }
          if (steps.some((sub) => sub.mech.kind === 'salvezza' && sub.mech.area) && !confirmArea(x.id, [].concat(...targets))) return false;
          performCreatureAction(x.id, a.id, targets, currentMode());
          return undefined;
        } },
      ]);
    }

    // Esegue l'azione (e, per il multiattacco, tutte le azioni previste in sequenza), con una riga di log per
    // ciascuna. Consuma usi, ricarica o punti leggendari.
    function performCreatureAction(attackerId, actionId, targetIds, mode) {
      const downed = [];
      const who = byId(attackerId);
      const act = who && who.creature ? M.allActions(who.creature).find((y) => y.id === actionId) : null;
      beginDice();
      if (act && act.mech.kind !== 'cura' && act.mech.kind !== 'testo') noteAggression(attackerId, [].concat(...targetIds));
      mutate((c) => {
        const x = byId(attackerId);
        const st = x && x.creature;
        const a = st && M.allActions(st).find((y) => y.id === actionId);
        if (!a) return;
        const use = M.canUse(st, a);
        if (!use.ok) { toast(a.name + ': ' + use.reason + '.', 'error'); return; }
        if (blockedBy(x)) { toast(x.name + ': ' + blockedBy(x) + '.', 'error'); return; }
        M.consume(st, a);
        if (a.group === 'bonusActions' || a.group === 'reactions') DnD.audio.suona('azione-lieve', { coda: true });
        const header = x.name + (a.group === 'legendary' ? ' (azione leggendaria, ' + st.legendaryPoints.left + ' punti rimasti)' : '') + ' usa ' + a.name;
        if (a.mech.kind === 'testo') { log(c, 'sistema', header + ': ' + M.actionText(st, a)); return; }
        const steps = a.mech.kind === 'multiattacco' ? M.expandMultiattack(st, a) : [a];
        if (steps.length > 1) log(c, 'sistema', header + ': ' + M.actionText(st, a));
        steps.forEach((sub, i) => {
          for (const tid of targetIds[i] || []) {
            const t = byId(tid);
            if (!t) continue;
            const before = t.hp;
            const who = steps.length > 1 ? x.name + ' — ' + sub.name : header;
            if (sub.mech.kind === 'attacco') {
              const mods = attackModsFor(x, t, sub.mech.range === 'distanza', mode);
              if (mods.blocked) { log(c, 'sistema', who + ': non attacca ' + t.name + ' (' + mods.blocked + ').'); continue; }
              const r = M.resolveAttack(st, sub, t, mods.mode, dice(), Boolean(mods.autoCrit));
              const why = C.modsText(mods);
              const d20 = mods.mode === 'normale' ? 'd20 = ' + r.natural : 'd20 con ' + mods.mode + ' [' + r.d20Rolls.join(', ') + '] → ' + r.natural;
              let text = who + ' contro ' + t.name + (why ? ' (' + why + ')' : '') + ': ' + d20 + ' ' + R.formatModifier(r.bonus) + ' = ' + r.total + ' contro CA ' + t.ac;
              if (r.fumble || !r.hit) { log(c, 'mancato', text + (r.fumble ? '. 1 NATURALE: mancato.' : ' → mancato.')); continue; }
              const applied = M.applyDamageParts(r.parts, t.defenses, sub.mech.magical);
              hurt(t, applied.total, r.crit);
              text += (r.crit ? (r.natural === 20 ? '. 20 NATURALE, CRITICO (dadi raddoppiati)! ' : '. CRITICO (' + mods.autoCrit + ', dadi raddoppiati)! ') : ' → colpito: ') +
                r.parts.map((q) => q.dice + rollText(q.rolls, q.bonus).replace(/^/, ' ') + ' = ' + q.amount + (q.type ? ' ' + q.type : '')).join(' + ') +
                (applied.notes.length ? ' (' + applied.notes.join('; ') + ')' : '') + ' → ' + applied.total + ' danni. ' + t.name + ': ' + before + ' → ' + t.hp + ' PF.';
              log(c, r.crit ? 'critico' : 'colpito', text);
              // Condizione inflitta dal colpo (con la salvezza che la evita, se indicata).
              const inf = sub.mech.inflict;
              if (inf && inf.type) {
                let saved = false;
                if (inf.save) {
                  const sm = C.saveMods(t, inf.save.ability);
                  const dc = inf.save.dc || 10;
                  const s2 = sm.autoFail ? { success: false, total: '—' } : R.rollSave({ bonus: t.saves[inf.save.ability] || 0, mode: sm.mode, dc }, dice());
                  saved = s2.success;
                  log(c, saved ? 'tiro-salvezza' : 'ts-fallito', t.name + ': salvezza su ' + inf.save.ability + ' contro ' + C.inflictName(inf, customs()).toLowerCase() + ' ' + s2.total + ' vs CD ' + dc + ' → ' + (saved ? 'riesce.' : 'fallisce.'));
                }
                if (!saved) inflictOn(c, x, t, inf, null);
              }
            } else if (sub.mech.kind === 'salvezza') {
              const sm = C.saveMods(t, sub.mech.ability);
              const r = M.resolveSave(st, sub, t, dice(), sm.mode, Boolean(sm.autoFail));
              const applied = M.applyDamageParts(r.parts, t.defenses, false);
              hurt(t, applied.total);
              const why = C.modsText(sm);
              let text = who + ': ' + t.name + ' tira salvezza su ' + R.ABILITY_NAMES[r.ability] + ' ' + (sm.autoFail ? '— fallita in automatico (' + sm.autoFail + ')' : r.total + ' contro CD ' + r.dc + (why ? ' (' + why + ')' : '') + ' → ' + (r.success ? 'riesce' : 'fallisce'));
              if (r.parts.length) text += ', ' + r.full.map((q) => q.dice + ' [' + q.rolls.join(', ') + ']' + (q.bonus ? ' ' + R.formatModifier(q.bonus) : '') + ' = ' + q.amount + (q.type ? ' ' + q.type : '')).join(' + ') +
                (r.success && sub.mech.half ? ' (metà)' : '') + (applied.notes.length ? ' (' + applied.notes.join('; ') + ')' : '') + ' → ' + applied.total + ' danni';
              if (!r.success && sub.mech.effect) text += '; ' + sub.mech.effect;
              text += '. ' + (before !== t.hp ? t.name + ': ' + before + ' → ' + t.hp + ' PF.' : '');
              log(c, r.success ? 'tiro-salvezza' : 'ts-fallito', text);
              if (!r.success && sub.mech.inflict && sub.mech.inflict.type) inflictOn(c, x, t, Object.assign({}, sub.mech.inflict, { save: { ability: sub.mech.ability, dc: r.dc } }), null);
              if (!r.success && t.creature && t.creature.legendaryResistance.left > 0) {
                t.pendingSave = { full: r.full.map((q) => ({ amount: q.amount, type: q.type })), half: sub.mech.half, applied: before - t.hp, magical: false, text: sub.name };
              }
            } else if (sub.mech.kind === 'cura') {
              const r = M.resolveHeal(st, sub, dice());
              t.hp = R.heal(t.hp, t.maxHp, r.amount);
              log(c, 'cura', who + ': ' + t.name + ' recupera ' + (t.hp - before) + ' PF [' + r.rolls.join(', ') + ']: ' + before + ' → ' + t.hp + ' PF.');
            }
            if (before > 0 && t.hp === 0) { log(c, 'a-terra', t.name + ' è a terra!'); downed.push(t.name); }
          }
        });
      });
      endDice((who ? who.name : '') + (act ? ': ' + act.name : ''), downed.length ? 'A terra: ' + downed.join(', ') : '');
      if (downed.length) toast('A terra: ' + downed.join(', '), 'success');
      return (who ? who.name : '') + (act ? ': ' + act.name : '') + (downed.length ? ' · a terra: ' + downed.join(', ') : '');
    }

    // Resistenza leggendaria: l'ultimo tiro salvezza fallito diventa un successo (PF restituiti di conseguenza).
    function useLegendaryResistance(id) {
      mutate((c) => {
        const x = byId(id);
        const what = x.pendingSave && x.pendingSave.text;
        const r = M.useLegendaryResistance(x);
        if (!r) return;
        log(c, 'tiro-salvezza', x.name + ' usa la Resistenza leggendaria: il tiro salvezza contro ' + what + ' diventa un successo' +
          (r.refund ? ', recupera ' + r.refund + ' PF (' + x.hp + ' PF)' : '') + '. Rimaste ' + x.creature.legendaryResistance.left + '.');
      });
    }

    function creatureBox(x) {
      const st = x.creature;
      if (!st) return null;
      const down = R.isDown(x);
      const isTurn = combat().currentId === x.id;
      const usesText = (a) => {
        if (st.uses[a.id] !== undefined) return ' (' + st.uses[a.id] + ' ' + (a.freq.kind === 'giorno' ? '/giorno' : 'uso') + ')';
        if (a.freq.kind === 'ricarica') return st.recharge[a.id] ? '' : ' (da ricaricare)';
        return '';
      };
      const block = blockedBy(x);
      const btn = (a, extraDisabled) => {
        const u = M.canUse(st, a);
        return el('button', {
          type: 'button', class: 'btn small' + (a.mech.kind === 'multiattacco' ? ' primary' : ''), disabled: down || !u.ok || extraDisabled || Boolean(block),
          title: (block ? block + ' (il master può permetterle da «Condizioni») · ' : '') + (u.reason ? u.reason + ' · ' : '') + M.actionText(st, a), text: a.name + (a.cost > 1 ? ' (' + a.cost + ')' : '') + usesText(a),
          onclick: () => creatureActionDialog(x, a.id),
        });
      };
      // Boss: le azioni disabilitate dalla fase in corso non si possono usare.
      const off = x.boss ? DnD.boss.disabledActions(x.boss, x.boss.phase) : new Set();
      const all = M.allActions(st);
      const of = (g) => all.filter((a) => a.group === g);
      const row = (label, list, extraDisabled) => (list.length ? el('div', { class: 'creature-actions' }, el('span', { class: 'muted small', text: label }),
        list.map((a) => { const b = btn(a, extraDisabled || off.has(a.id)); if (off.has(a.id)) b.title = 'Non disponibile in questa fase · ' + b.title; return b; })) : null);
      const lr = st.legendaryResistance;
      return el('div', { class: 'creature-box' },
        DnD.uiBoss.combatBox(x, () => mutate((c) => {
          const t = c.combatants.find((y) => y.id === x.id);
          t.boss.revealed = !t.boss.revealed;
          log(c, 'sistema', '👑 ' + t.name + (t.boss.revealed ? ' è rivelato ai giocatori.' : ' è di nuovo nascosto ai giocatori.'));
        })),
        row('Azioni', of('actions')),
        row('Bonus', of('bonusActions')),
        row('Reazioni', of('reactions')),
        st.legendaryPoints.max ? row('Leggendarie ' + st.legendaryPoints.left + '/' + st.legendaryPoints.max + (isTurn ? ' (alla fine del turno di un altro)' : ''), of('legendary'), isTurn) : null,
        lr.max ? el('div', { class: 'creature-actions' },
          el('span', { class: 'muted small', text: 'Resistenza leggendaria ' + lr.left + '/' + lr.max }),
          el('button', { type: 'button', class: 'btn small', text: 'Usa', disabled: !x.pendingSave || lr.left <= 0,
            title: x.pendingSave ? 'Trasforma in successo il tiro salvezza fallito contro ' + x.pendingSave.text : 'Nessun tiro salvezza fallito da trasformare',
            onclick: () => useLegendaryResistance(x.id) })) : null,
        st.traits.length ? el('details', { class: 'small' }, el('summary', { text: 'Tratti (' + st.traits.length + ')' }),
          st.traits.map((t) => el('p', {}, el('b', { text: M.actionTitle(t) + '. ' }), M.actionText(st, t)))) : null,
        st.lair.length ? el('p', { class: 'muted small', text: '🏰 Tana (iniziativa 20): ' + st.lair.map((a) => a.name).join(', ') }) : null);
    }

    // Risorse del combattente (riposi.js): elenco con − e +, risorse personalizzate, ripristino del master. Il riposo
    // è disattivato durante il combattimento attivo.
    const openRes = new Set(); // riquadri «Risorse» aperti (restano aperti tra un − e un +)
    function restBox(x) {
      const view = RP.resources(RP.fromCombatant(clone(x)));
      const change = (fn, text) => mutate((c) => { const t = c.combatants.find((y) => y.id === x.id); if (!t) return; fn(t); if (text) log(c, 'sistema', text(t)); });
      const active = combat().phase === 'attivo';
      return el('details', { class: 'res-details small', open: openRes.has(x.id), ontoggle: (e) => { if (e.target.open) openRes.add(x.id); else openRes.delete(x.id); } }, el('summary', { text: '🎒 Risorse' + (x.tempHp ? ' · 🛡 ' + x.tempHp + ' PF temporanei' : '') }),
        DnD.uiRiposi.resourcesBox(view, (id, d) => change((t) => RP.adjust(RP.fromCombatant(t), id, d), (t) => t.name + ': ' + (view.find((r) => r.id === id) || {}).label + ' ' + (d > 0 ? '+1' : '−1') + '.'), {
          add: (data) => change((t) => { RP.fromCombatant(t); t.resources.push(RP.normalizeResource(Object.assign({ value: data.max }, data))); }, (t) => t.name + ': nuova risorsa «' + data.label + '».'),
          remove: (rid) => change((t) => { t.resources = (t.resources || []).filter((r) => r.id !== rid); }),
        }),
        el('div', { class: 'head-actions' },
          ['breve', 'lungo'].map((kind) => el('button', { type: 'button', class: 'btn small', text: '🛏 Riposo ' + kind, disabled: active, title: active ? DnD.uiRiposi.BUSY : null, onclick: () => restCombatant(x, kind) })),
          el('button', { type: 'button', class: 'btn small', text: '⟲ Ripristina tutto (master)', onclick: () => {
            if (confirm('Ripristinare PF, dadi vita, slot, usi e risorse di ' + x.name + '?')) change((t) => RP.restoreAll(RP.fromCombatant(t)), (t) => RP.summaryText({ kind: 'tutto', name: t.name }));
          } })));
    }

    // Riposo di un combattente (nemici e NPC compresi) quando il combattimento non è attivo.
    function restCombatant(x, kind) {
      DnD.uiRiposi.restDialog({ kind, subjects: [{ id: x.id, acc: RP.fromCombatant(clone(x)) }], now: null, onConfirm: (params) => {
        const lines = [];
        change0(x.id, (c, t) => {
          const r = kind === 'breve' ? RP.shortRest(RP.fromCombatant(t), { rolls: params.rolls[x.id] || [] }) : RP.longRest(RP.fromCombatant(t), { opts: DnD.impostazioni.restOptions(), interruptedAfter: params.interruptAfter });
          lines.push(RP.summaryText(r));
          log(c, 'sistema', lines[0]);
        });
        return { ok: true, lines };
      } });
    }
    const change0 = (id, fn) => mutate((c) => { const t = c.combatants.find((y) => y.id === id); if (t) fn(c, t); });

    function hpBar(x) {
      const pct = x.maxHp > 0 ? Math.round((x.hp / x.maxHp) * 100) : 0;
      return el('div', { class: 'hp' },
        el('div', { class: 'hp-text' }, el('b', { text: x.hp + ' / ' + x.maxHp }), ' PF'),
        el('div', { class: 'hp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': x.maxHp, 'aria-valuenow': x.hp, 'aria-label': 'Punti ferita' },
          el('div', { class: 'hp-fill ' + R.hpLevel(x.hp, x.maxHp), style: 'width:' + pct + '%' })));
    }

    function combatantCard(x, current) {
      const down = R.isDown(x);
      const block = blockedBy(x);
      const blockTitle = block ? block + ' (il master può permetterle da «Condizioni»)' : null;
      return el('article', {
        class: 'combatant ' + x.kind + (current ? ' current' : '') + (down ? ' down' : '') + (x.id === S.selectedId ? ' selected' : '') + (x.legend ? ' legendary' : '') + (x.legend && x.legend.form ? ' transformed' : ''),
        'data-id': x.id,
        style: x.legend && DnD.uiLeggendario ? DnD.uiLeggendario.cardStyle(x) : null,
        onclick: (e) => { if (!e.target.closest('button')) selectCombatant(x.id === S.selectedId ? null : x.id, 'card'); },
      },
        el('div', { class: 'combatant-head' },
          el('div', {},
            el('div', { class: 'title-with-icon' }, DnD.icone.iconCanvas(x.icon, 28), el('h3', { text: x.name })),
            el('span', { class: 'muted small', text: (x.kind === 'player' ? 'Giocatore' : x.boss ? 'Boss (GS ' + x.creature.cr + ')' : x.creature ? 'Creatura (GS ' + x.creature.cr + ')' : 'Nemico') + ' · Iniziativa ' + x.initiative +
              ' · ' + G.tokenDims(x).w + '×' + G.tokenDims(x).h + (aiOn() ? ' · ' + (x.control === 'ia' ? '🤖 IA' : '👤 Manuale') : '') + (x.hidden ? ' · nascosto' : '') }),
            DnD.uiMondo ? DnD.uiMondoComuni.factionBadge(x.faction) : null,
            x.npc ? el('span', { class: 'tag att-' + x.npc.attitude, title: 'NPC del Mondo', text: '👤 ' + DnD.mondoDati.ATTITUDE_NAMES[x.npc.attitude] }) : null,
            x.hostileTo && x.hostileTo.length ? el('span', { class: 'tag danger', title: 'Ostile per una provocazione', text: '⚔ provocato' }) : null,
            x.joinRound ? el('span', { class: 'badge', text: 'ENTRA AL ROUND ' + x.joinRound }) : null,
            x.dead ? el('span', { class: 'badge down-badge', text: '✝ MORTO' }) : down ? el('span', { class: 'badge down-badge', text: C.dying(x) ? 'TIRI CONTRO LA MORTE' : x.deathSaves && x.deathSaves.stable ? 'STABILE' : 'A TERRA' }) : null,
            current ? el('span', { class: 'badge turn-badge', text: 'TURNO' }) : null),
          el('div', { class: 'ac-shield', title: 'Classe Armatura' }, el('small', { text: 'CA' }), el('b', { text: String(x.ac) }))),
        hpBar(x),
        UC().cardBox(x, byId, () => conditionsDialog(byId(x.id))),
        x.defenses && (x.defenses.vuln.length || x.defenses.res.length || x.defenses.imm.length) ? el('p', { class: 'muted small', text: [
          x.defenses.vuln.length ? 'Vulnerabile: ' + M.defensesText(x.defenses.vuln) : '', x.defenses.res.length ? 'Resiste: ' + M.defensesText(x.defenses.res) : '',
          x.defenses.imm.length ? 'Immune: ' + M.defensesText(x.defenses.imm) : ''].filter(Boolean).join(' · ') }) : null,
        x.spellcasting ? slotsIndicator(x.spellcasting) : null,
        x.pos || combat().phase === 'attivo' ? movementBox(x) : null,
        // Leggendari: Trasformati / Torna normale, rango e forma attiva.
        x.legend && DnD.uiLeggendario ? DnD.uiLeggendario.combatBox(x, { mutate, log, byId, render }) : null,
        creatureBox(x),
        restBox(x),
        el('div', { class: 'card-actions' },
          el('button', {
            class: 'btn primary', text: 'Attacca', onclick: () => attackDialog(x),
            disabled: down || !x.weapons.length || combat().combatants.length < 2 || Boolean(block),
            title: down ? 'È a terra' : block ? blockTitle : !x.weapons.length ? 'Nessuna arma equipaggiata' : null,
          }),
          el('button', { class: 'btn', text: 'Cura', onclick: () => healDialog(x) }),
          el('button', { class: 'btn', text: 'Tiro salvezza', onclick: () => saveDialog(x) }),
          x.spellcasting ? el('button', {
            class: 'btn', text: '✨ Lancia incantesimo', onclick: () => castDialog(x),
            disabled: down || !x.spellcasting.spells.length || Boolean(block), title: block ? blockTitle : !x.spellcasting.spells.length ? 'Nessun incantesimo conosciuto' : null,
          }) : null,
          el('button', { class: 'btn', text: 'Modifica', onclick: () => editDialog(x) }),
          el('button', { class: 'btn danger', text: 'Rimuovi', onclick: () => removeCombatant(x) })));
    }

    // Disposizione a tre colonne: in ui-colonne.js (la usano anche Esplorazione e Online).
    const { columns } = DnD.uiColonne;

    function renderActive() {
      const c = combat();
      const list = order();
      const current = c.currentId ? byId(c.currentId) : null;
      const anyUp = list.some((x) => !R.isDown(x));
      const logList = el('ol', { class: 'log' }, c.log.map((e) => el('li', { class: 'log-' + e.type },
        e.type === 'round' ? null : el('span', { class: 'log-round', text: 'R' + e.round }), e.text,
        e.why ? el('button', { type: 'button', class: 'btn small why-btn', text: 'Perché?', onclick: () => DnD.uiIa.whyDialog(e.why) }) : null)));

      if (S.selectedId && !byId(S.selectedId)) S.selectedId = null;
      const g = getGrid();
      // Al centro: barre dei boss e ombra restano sull'area della griglia, senza coprire le colonne.
      const center = el('div', { class: 'combat-center' }, ...[DnD.uiBoss.combatHud(c, 'master'), DnD.uiBoss.vignette(c)].filter(Boolean), g.node);
      const cols = columns({
        left: { title: 'Entità', body: [el('div', { class: 'combatants' }, list.map((x) => combatantCard(x, x.id === c.currentId)))] },
        center,
        right: {
          title: 'Turni',
          head: [el('button', { type: 'button', class: 'btn small dice-inline', text: '🎲 Dadi', title: 'Apri i dadi', onclick: () => DnD.uiDadi.openPanel() })],
          body: [
            el('section', { class: 'panel turn-panel' },
              el('div', { class: 'round' }, 'Round ', el('b', { text: String(c.round) })),
              el('div', { class: 'muted', text: current ? 'Turno di ' + current.name : anyUp ? 'Nessun turno attivo' : 'Tutti i combattenti sono a terra' }),
              current ? el('div', { class: 'small turn-move', text: speedText(current, true) }) : null,
              el('button', { class: 'btn primary wide', text: 'Prossimo turno ▶', onclick: nextTurn, disabled: !anyUp }),
              el('ol', { class: 'turn-order' }, list.map((x) => el('li', {
                class: (x.id === c.currentId ? 'current ' : '') + (R.isDown(x) ? 'down ' : '') + x.kind,
                onclick: () => selectCombatant(x.id, 'list'),
              },
              el('span', { class: 'init', text: String(x.initiative) }),
              el('span', { class: 'name', text: x.name }),
              el('span', { class: 'muted small', text: x.hp + '/' + x.maxHp }))))),
            aiPanel(),
            el('section', { class: 'panel log-panel' }, el('h2', { text: 'Log' }), logList)],
        },
      });

      S.root.append(
        el('div', { class: 'combat-screen' },
          el('div', { class: 'section-head' },
            el('h1', { text: 'Combattimento' }),
            el('div', { class: 'head-actions' },
              el('button', { class: 'btn', text: 'Reimposta layout', title: 'Larghezze predefinite e colonne aperte', onclick: cols.reset }),
              el('button', { class: 'btn', text: '🌐 Online', title: 'Gioco online: ospita i giocatori o unisciti a una sessione', onclick: () => agganci.apriOnline() }),
              el('button', { class: 'btn danger', text: 'Termina combattimento', onclick: endCombat }))),
          // Combattimento nato dall'esplorazione: banner per tornarci.
          agganci.bannerEsplorazione ? agganci.bannerEsplorazione() : null,
          cols.layout));
      g.refresh();
      g.setSelectedCombatant(S.selectedId);
      logList.scrollTop = logList.scrollHeight;
      scheduleAuto();
    }

    return { performCreatureAction, renderActive };
  }

  DnD.uiCombattimentoCreature = { creature };
})(globalThis.DnD = globalThis.DnD || {});
