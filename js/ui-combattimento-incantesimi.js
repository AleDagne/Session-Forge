// Combattimento › Incantesimi e azioni dei combattenti: finestra del lancio (slot, bersagli, tiri), risoluzione con
// concentrazione e condizioni, tiri salvezza richiesti, cure, modifica di un combattente. Parte della schermata
// Combattimento (ui-combattimento.js), che le passa stato e funzioni comuni con un'api.
// Livello interfaccia. Espone DnD.uiCombattimentoIncantesimi { incantesimi(api) }.
(function (DnD) {
  'use strict';

  // api (da ui-combattimento.js): C, M, Mv, R, S, V, attackModsFor, beginDice, byId, clear, confirmArea, dice, el, endDice, field, hurt, inflictOn, log, mutate, noteAggression, numberInput, openDialog, order, readNumber, rollText, session, showErrors, textInput, toast
  function incantesimi(api) {
    const {
      C, M, Mv, R, S, V, attackModsFor, beginDice, byId, clear, confirmArea, dice, el, endDice, field, hurt, inflictOn, log, mutate, noteAggression, numberInput, openDialog, order, readNumber, rollText, session, showErrors, textInput, toast,
    } = api;

    // ---------- Incantesimi ----------
    function slotsIndicator(sc) {
      const levels = sc.slotsTotal.map((n, i) => [i + 1, n]).filter(([, n]) => n > 0);
      const innate = (list) => list.map((sp) => { const inn = sc.innate[sp.id]; return el('span', { class: inn && inn.freq === 'giorno' && !inn.left ? 'empty-slot' : '', text: sp.name + (inn && inn.freq === 'giorno' ? ' ' + inn.left : '') }); });
      if (sc.innate && !levels.length) {
        return el('div', { class: 'slots-indicator', title: 'Incantesimi innati' }, el('span', { text: '✨ Innati · CD ' + sc.dc + ' · ' + R.formatModifier(sc.attack) }), innate(sc.spells));
      }
      // Incantatori con anche magie senza slot (le magie «N al giorno» dei leggendari): slot e usi rimasti.
      if (sc.innate) {
        return el('div', { class: 'slots-indicator', title: 'Slot incantesimo e magie senza slot rimasti' },
          el('span', { text: '✨ CD ' + sc.dc + ' · ' + R.formatModifier(sc.attack) }),
          levels.map(([l, n]) => { const left = DnD.magie.slotsLeft(sc.slotsTotal, sc.slotsUsed, l); return el('span', { class: left ? '' : 'empty-slot', text: l + '°: ' + left + '/' + n }); }),
          innate(sc.spells.filter((sp) => sc.innate[sp.id])));
      }
      return el('div', { class: 'slots-indicator', title: 'Slot incantesimo rimasti' },
        el('span', { text: '✨ CD ' + sc.dc + ' · ' + R.formatModifier(sc.attack) }),
        levels.length
          ? levels.map(([l, n]) => {
            const left = DnD.magie.slotsLeft(sc.slotsTotal, sc.slotsUsed, l);
            return el('span', { class: left ? '' : 'empty-slot', text: l + '°: ' + left + '/' + n });
          })
          : el('span', { text: 'solo trucchetti' }));
    }

    // preset: { spellId, slotLevel, targetIds, mode } per riaprire la finestra dopo la scelta sulla griglia.
    function castDialog(caster, preset) {
      preset = preset || {};
      const sc = caster.spellcasting;
      const spells = sc.spells.slice().sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'it'));
      const spellSel = el('select', {}, spells.map((sp) => el('option', {
        value: sp.id, selected: sp.id === preset.spellId,
        text: sp.name + ' — ' + DnD.magie.levelName(sp.level) + (sp.level && !DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed).length ? ' (nessuno slot)' : ''),
      })));
      const slotSel = el('select', {});
      const summary = el('p', { class: 'muted small' });
      const warn = el('div', { class: 'warn', 'aria-live': 'polite' });
      const others = order().filter((t) => t.id !== caster.id);
      const chosen = new Set(preset.targetIds || []);
      const targetBox = el('div', { class: 'target-checks' });
      const modeBox = el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro per colpire' }),
        DnD.regole.MODI_TIRO.map((m) => el('label', { class: 'check' },
          el('input', { type: 'radio', name: 'modo-magia', value: m, checked: m === (preset.mode || 'normale') }), ' ' + m[0].toUpperCase() + m.slice(1))));
      const current = () => spells.find((sp) => sp.id === spellSel.value);
      const readTargets = () => [...targetBox.querySelectorAll('input:checked')].map((i) => i.value);
      const currentMode = () => body.querySelector('input[name="modo-magia"]:checked').value;
      let castBtn = null;

      function sync() {
        const sp = current();
        if (!sp) return;
        const inn = innateOf(sc, sp);
        const levels = inn ? [sp.level] : DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed);
        clear(slotSel).append(...(inn
          ? [el('option', { value: String(sp.level), text: 'Innato: ' + (inn.freq === 'giorno' ? inn.left + ' usi rimasti oggi' : 'a volontà') + ', senza slot' })]
          : sp.level === 0
            ? [el('option', { value: '0', text: 'Trucchetto: non consuma slot' })]
            : levels.map((l) => el('option', {
              value: String(l), selected: l === preset.slotLevel,
              text: l + '° livello (' + DnD.magie.slotsLeft(sc.slotsTotal, sc.slotsUsed, l) + ' rimasti)' + (l > sp.level && sp.effect.upcastDice ? ' · +' + (l - sp.level) + '×' + sp.effect.upcastDice : ''),
            }))));
        slotSel.disabled = Boolean(inn) || sp.level === 0 || !levels.length;
        warn.textContent = inn ? (inn.freq === 'giorno' && inn.left <= 0 ? '⚠ Usi giornalieri esauriti.' : '')
          : sp.level > 0 && !levels.length ? '⚠ Nessuno slot di ' + sp.level + '° livello o superiore disponibile: non puoi lanciare questo incantesimo.' : '';
        if (castBtn) castBtn.disabled = Boolean(warn.textContent);
        summary.textContent = DnD.uiMagie.effectSummary(sp) + (sp.area ? ' · ad area: puoi scegliere più bersagli' : '');
        modeBox.hidden = sp.effect.type !== 'attacco';
        // Bersagli: più di uno solo per gli incantesimi ad area. Le cure possono puntare anche su sé stessi.
        const pool = sp.effect.type === 'cura' ? [caster].concat(others) : others;
        const multi = sp.area;
        if (!multi && chosen.size > 1) { const first = [...chosen][0]; chosen.clear(); chosen.add(first); }
        if (!chosen.size && pool.length && sp.effect.type !== 'nessuno') {
          const preferred = pool.find((t) => (sp.effect.type === 'cura' ? t.kind === caster.kind : t.kind !== caster.kind) && !R.isDown(t)) || pool[0];
          chosen.add(preferred.id);
        }
        clear(targetBox).append(...pool.map((t) => el('label', { class: 'check' },
          el('input', {
            type: multi ? 'checkbox' : 'radio', name: 'bersaglio-magia', value: t.id, checked: chosen.has(t.id),
            onchange: (e) => { if (!multi) chosen.clear(); if (e.target.checked) chosen.add(t.id); else chosen.delete(t.id); },
          }),
          ' ' + t.name + ' (CA ' + t.ac + ', PF ' + t.hp + '/' + t.maxHp + ')' + (R.isDown(t) ? ' – a terra' : ''))));
      }
      spellSel.addEventListener('change', () => { chosen.clear(); sync(); });

      const pickButton = S.grid && S.grid.hasTokens() && S.grid.node.isConnected
        ? el('button', { type: 'button', class: 'btn small', text: '🎯 Scegli sulla griglia', onclick: () => {
          const keep = { spellId: spellSel.value, slotLevel: Number(slotSel.value), mode: currentMode() };
          const multi = current().area;
          const picked = multi ? new Set(readTargets()) : new Set();
          dialog.dismiss();
          S.grid.pickTarget((id) => {
            const a = byId(caster.id);
            if (!a) return;
            if (id) {
              if (multi && picked.has(id)) picked.delete(id); else picked.add(id);
              if (multi) return toast(byId(id) ? byId(id).name + (picked.has(id) ? ' aggiunto ai bersagli.' : ' tolto dai bersagli.') : '');
              return castDialog(a, Object.assign(keep, { targetIds: [id] }));
            }
            castDialog(a, Object.assign(keep, { targetIds: [...picked] }));
          }, multi);
        } })
        : null;

      const body = el('div', { class: 'form' },
        el('div', { class: 'grid-2' }, field('Incantesimo', spellSel), field('Livello dello slot', slotSel)),
        summary, warn,
        el('fieldset', {}, el('legend', { text: 'Bersagli' }), targetBox, pickButton),
        modeBox);
      const dialog = openDialog(caster.name + ' lancia un incantesimo', body, [
        { text: 'Annulla' },
        { text: '✨ Lancia', class: 'primary', onclick: () => {
          const sp = current();
          const targets = readTargets();
          if (sp.effect.type !== 'nessuno' && !targets.length) { toast('Scegli almeno un bersaglio.', 'error'); return false; }
          const inn = innateOf(sc, sp);
          if (sp.area && sp.effect.type !== 'cura' && !confirmArea(caster.id, targets)) return false;
          const cur = byId(caster.id);
          if (sp.concentration && cur && cur.concentration && !confirm(cur.name + ' è concentrato su ' + cur.concentration.name + ': lanciando ' + sp.name + ' la concentrazione precedente termina (e i suoi effetti). Continuare?')) return false;
          if (inn ? inn.freq === 'giorno' && inn.left <= 0 : sp.level > 0 && !DnD.magie.castableLevels(sp, sc.slotsTotal, sc.slotsUsed).includes(Number(slotSel.value))) {
            toast(inn ? 'Usi giornalieri esauriti.' : 'Nessuno slot disponibile per questo incantesimo.', 'error');
            return false;
          }
          performCast(caster.id, sp.id, inn ? sp.level : sp.level === 0 ? 0 : Number(slotSel.value), targets, currentMode());
          return undefined;
        } },
      ]);
      castBtn = dialog.querySelector('.modal-actions .btn.primary');
      sync();
    }

    // Incantesimo innato di una creatura (senza slot): { freq, left } oppure null.
    const innateOf = DnD.combattimento.innatoDi;

    function performCast(casterId, spellId, slotLevel, targetIds, mode) {
      let summaryText = '';
      beginDice();
      const spell = byId(casterId) && byId(casterId).spellcasting && byId(casterId).spellcasting.spells.find((x) => x.id === spellId);
      if (spell && !['cura', 'nessuno'].includes(spell.effect.type)) noteAggression(casterId, targetIds);
      mutate((c, st) => {
        const a = byId(casterId);
        const sc = a && a.spellcasting;
        const sp = sc && sc.spells.find((x) => x.id === spellId);
        if (!sp) return;
        const targets = targetIds.map(byId).filter(Boolean);
        // Condizioni di ogni bersaglio: modo dell'attacco (e critico automatico da vicino), salvezze automatiche o con svantaggio.
        const tmods = new Map(targets.map((t) => [t.id, sp.effect.type === 'attacco' ? attackModsFor(a, t, false, mode) : C.saveMods(t, sp.effect.saveAbility)]));
        const r = DnD.combattimento.lancio({ c, st, a, sp, slotLevel, targets, tmods, mode, rng: dice(), infliggi: (t, inflict, spell) => inflictOn(c, a, t, inflict, spell) });
        S.hurtLines = S.hurtLines.concat(r.danno);
        summaryText = r.summary;
      });
      endDice(summaryText.split(' · ')[0], summaryText);
      if (summaryText) toast(summaryText, 'success');
      return summaryText;
    }

    function saveDialog(target) {
      const ability = el('select', { 'data-key': 'ability' }, R.ABILITIES.map((ab) => el('option', {
        value: ab, text: R.ABILITY_NAMES[ab] + ' (' + R.formatModifier(target.saves[ab]) + ')',
      })));
      const dc = numberInput('', { min: 1, max: 40, placeholder: 'facoltativa', 'data-key': 'dc' });
      const mode = (value, label) => el('label', { class: 'check' },
        el('input', { type: 'radio', name: 'modo-ts', value, checked: value === R.MODES.normale }), ' ' + label);
      const body = el('div', { class: 'form' },
        el('div', { class: 'grid-2' }, field('Caratteristica', ability, 'ability'), field('Classe Difficoltà (CD)', dc, 'dc')),
        el('fieldset', { class: 'radio-row' }, el('legend', { text: 'Tiro' }),
          mode(R.MODES.normale, 'Normale'), mode(R.MODES.vantaggio, 'Vantaggio'), mode(R.MODES.svantaggio, 'Svantaggio')));
      openDialog('Tiro salvezza di ' + target.name, body, [
        { text: 'Annulla' },
        { text: 'Tira', class: 'primary', onclick: () => {
          const dcValue = dc.value.trim() === '' ? null : readNumber(dc);
          const errors = {};
          if (dcValue !== null) DnD.validazione.intInRange(errors, 'dc', dcValue, 1, 40);
          if (!showErrors(body, errors)) return false;
          const r = performSave(target.id, ability.value, dcValue, body.querySelector('input[name="modo-ts"]:checked').value);
          if (r.testo) toast(r.testo, r.tipo);
          return undefined;
        } },
      ]);
    }
    // Tiro salvezza di un combattente (d20 + salvezza, condizioni): { testo, tipo, success, total }.
    function performSave(targetId, ab, dcValue, m) {
      let summaryText = '';
      let summaryType = 'info';
      let esito = null;
      beginDice();
      mutate((c) => {
        const t = byId(targetId);
        if (!t) return;
        // Condizioni: fallimento automatico (FOR e DES da paralizzato, stordito…) o svantaggio.
        const r = DnD.combattimento.tiroSalvezza(c, t, ab, dcValue, m, dice());
        summaryText = r.summary;
        summaryType = r.summaryType;
        esito = r.esito;
      });
      endDice((byId(targetId) || { name: '' }).name + ': tiro salvezza su ' + R.ABILITY_NAMES[ab], summaryText);
      return { testo: summaryText, tipo: summaryType, success: esito ? esito.success : false, total: esito ? esito.total : null };
    }

    function healDialog(target) {
      const amount = textInput('', { placeholder: 'es. 7 oppure 2d4+2', 'data-key': 'amount' });
      const body = el('div', { class: 'form' },
        field('Quantità o tiro di dado', amount, 'amount', 'PF attuali ' + target.hp + '/' + target.maxHp + '. La cura non supera il massimo.'));
      openDialog('Cura ' + target.name, body, [
        { text: 'Annulla' },
        { text: 'Cura', class: 'primary', onclick: () => {
          const p = DnD.dadi.parseExpr(amount.value);
          if (!p || (!p.count && p.modifier < 0)) {
            showErrors(body, { amount: 'Inserisci un numero positivo o un tiro come 2d4+2.' });
            return false;
          }
          const r = DnD.dadi.roll(p.count, p.sides, p.modifier);
          const healed = Math.max(0, r.total);
          mutate((c) => {
            const t = byId(target.id);
            if (!t) return;
            const before = t.hp;
            t.hp = R.heal(t.hp, t.maxHp, healed);
            const detail = p.count ? ' (' + DnD.dadi.formatExpr(p.count, p.sides, p.modifier) + ': ' + rollText(r.rolls, p.modifier) + ')' : '';
            log(c, 'cura', t.name + ' recupera ' + (t.hp - before) + ' PF' + detail + ': ' + before + ' → ' + t.hp + ' PF.' +
              (before === 0 && t.hp > 0 ? ' Torna in piedi.' : ''));
          });
          toast(target.name + ' curato.', 'success');
          return undefined;
        } },
      ]);
      amount.focus();
    }

    function editDialog(target) {
      const inp = {
        hp: numberInput(target.hp, { min: 0 }),
        maxHp: numberInput(target.maxHp, { min: 1 }),
        ac: numberInput(target.ac, { min: 1, max: 40 }),
        initiative: numberInput(target.initiative),
      };
      // Velocità per modalità: vuoto = quella della razza o della creatura (con bonus e forma), in piedi.
      const base = Mv.baseSpeeds(target);
      const over = Mv.normalizeOverride(target.speedOverride);
      const speedInp = Object.fromEntries(Mv.MODES.map((m) => [m, numberInput(over[m] === undefined ? '' : over[m], { min: 0, max: Mv.MAX_FEET, step: 5, placeholder: String(base[m]) })]));
      const body = el('div', { class: 'form' }, el('div', { class: 'grid-2' },
        field('PF attuali', inp.hp, 'hp'),
        field('PF massimi', inp.maxHp, 'maxHp'),
        field('Classe Armatura', inp.ac, 'ac'),
        field('Iniziativa', inp.initiative, 'initiative')),
        el('fieldset', {}, el('legend', { text: 'Velocità (ft) — vuoto = dalla scheda' }),
          el('div', { class: 'grid-3 tight' }, Mv.MODES.map((m) => field(Mv.MODE_ICONS[m] + ' ' + Mv.MODE_NAMES[m], speedInp[m], 'speed.' + m)))));
      openDialog('Modifica ' + target.name, body, [
        { text: 'Annulla' },
        { text: 'Salva', class: 'primary', onclick: () => {
          const v = Object.fromEntries(Object.entries(inp).map(([k, i]) => [k, readNumber(i)]));
          const errors = {};
          DnD.validazione.intInRange(errors, 'maxHp', v.maxHp, 1, 9999);
          DnD.validazione.intInRange(errors, 'hp', v.hp, 0, Number.isInteger(v.maxHp) ? v.maxHp : 9999);
          DnD.validazione.intInRange(errors, 'ac', v.ac, 1, 40);
          DnD.validazione.intInRange(errors, 'initiative', v.initiative, -20, 60);
          const newOver = {};
          for (const m of Mv.MODES) {
            if (speedInp[m].value.trim() === '') continue;
            const n = readNumber(speedInp[m]);
            DnD.validazione.intInRange(errors, 'speed.' + m, n, 0, Mv.MAX_FEET);
            newOver[m] = n;
          }
          if (!showErrors(body, errors)) return false;
          mutate((c) => {
            const t = byId(target.id);
            if (!t) return;
            const changes = [];
            if (t.hp !== v.hp || t.maxHp !== v.maxHp) changes.push('PF ' + t.hp + '/' + t.maxHp + ' → ' + v.hp + '/' + v.maxHp);
            if (t.ac !== v.ac) changes.push('CA ' + t.ac + ' → ' + v.ac);
            if (t.initiative !== v.initiative) changes.push('iniziativa ' + t.initiative + ' → ' + v.initiative);
            if (JSON.stringify(Mv.normalizeOverride(t.speedOverride)) !== JSON.stringify(Mv.normalizeOverride(newOver))) {
              changes.push('velocità ' + (Object.keys(newOver).length ? Object.entries(newOver).map(([m, n]) => Mv.MODE_NAMES[m].toLowerCase() + ' ' + n + ' ft').join(', ') : 'dalla scheda'));
              t.speedOverride = newOver;
            }
            if (!changes.length) return;
            const wasUp = t.hp > 0;
            Object.assign(t, v);
            log(c, 'modifica', 'Modifica manuale di ' + t.name + ': ' + changes.join(', ') + '.');
            if (wasUp && t.hp === 0) log(c, 'a-terra', t.name + ' è a terra!');
          });
          return undefined;
        } },
      ]);
    }

    function removeCombatant(target) {
      if (!confirm('Rimuovere ' + target.name + ' dal combattimento?')) return;
      mutate((c, st) => {
        // Se tocca a lui, il turno passa prima al successivo.
        const wasCurrent = c.currentId === target.id;
        if (wasCurrent) {
          const res = R.nextTurn(R.sortByInitiative(c.combatants), target.id, c.round);
          c.currentId = res.currentId === target.id ? null : res.currentId;
          c.round = res.round;
        }
        c.combatants = c.combatants.filter((x) => x.id !== target.id);
        log(c, 'sistema', target.name + ' viene rimosso dal combattimento.');
        if (wasCurrent && c.currentId) log(c, 'turno', 'Turno di ' + byId(c.currentId).name + '.');
        if (!c.combatants.length) session(st).combat = null;
      });
    }

    return { castDialog, editDialog, healDialog, performCast, performSave, removeCombatant, saveDialog, slotsIndicator };
  }

  DnD.uiCombattimentoIncantesimi = { incantesimi };
})(globalThis.DnD = globalThis.DnD || {});
