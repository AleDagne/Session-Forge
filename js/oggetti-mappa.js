// Oggetti di mappa (forzieri, porte, leve, trappole, barili, altari...): modelli nella libreria Asset e copie
// piazzate sulle griglie. Ogni copia ha il proprio stato (aperto/chiuso, serratura, trappola) e il proprio
// contenuto, copiati dal modello alla creazione: due forzieri uguali si svuotano separatamente.
// Una porta chiusa blocca il movimento, aperta no; gli altri oggetti bloccano solo con "Blocca il movimento"
// (vedi griglia.objectBlocks). Gli "oggetti a terra" sono oggetti di mappa che contengono un oggetto
// dell'Attrezzatura. Funzioni pure: le azioni modificano l'oggetto e restituiscono il testo per il log.
(function (DnD) {
  'use strict';

  // «npc»: copia di un NPC del Mondo piazzata sulla griglia (non è un modello della libreria, vedi npc.js).
  const TYPES = ['forziere', 'porta', 'leva', 'trappola', 'barile', 'altare', 'cassa', 'altro', 'a-terra', 'npc'];
  const TYPE_NAMES = {
    forziere: 'Forziere', porta: 'Porta', leva: 'Leva', trappola: 'Trappola', barile: 'Barile', altare: 'Altare', cassa: 'Cassa',
    altro: 'Altro', 'a-terra': 'Oggetto a terra', npc: 'NPC',
  };
  const TYPE_ICONS = { forziere: 'forziere', porta: 'porta', leva: 'leva', trappola: 'trappola', barile: 'barile', altare: 'gemma', cassa: 'forziere', altro: 'borsa', 'a-terra': 'borsa' };

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 2000) : '');
  function int(v, def, min, max) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const AB = () => DnD.regole.ABILITIES;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // Campi di stato e contenuto (comuni a modelli e copie piazzate).
  function normalizeFields(o) {
    o = obj(o);
    const lock = obj(o.lock);
    const trap = obj(o.trap);
    const eff = obj(trap.effect);
    const dice = DnD.dadi.parseExpr(eff.dice);
    const otype = TYPES.includes(o.otype) ? o.otype : 'altro';
    return {
      otype,
      description: str(o.description, 2000),
      container: o.container === undefined ? ['forziere', 'barile', 'cassa', 'a-terra'].includes(otype) : Boolean(o.container),
      interactive: o.interactive === undefined ? true : Boolean(o.interactive),
      hidden: Boolean(o.hidden),
      blocks: Boolean(o.blocks),
      // Visione (visione.js): blocca la vista (le porte solo da chiuse) e luce emessa (facoltativa).
      blocksSight: Boolean(o.blocksSight),
      light: DnD.visione.normalizeEmitter(o.light),
      state: o.state === 'aperto' ? 'aperto' : 'chiuso',
      lock: {
        locked: Boolean(lock.locked), dcPick: int(lock.dcPick, 15, 1, 40), dcForce: int(lock.dcForce, 15, 1, 40), keyId: str(lock.keyId, 64),
      },
      trap: {
        enabled: otype === 'trappola' || Boolean(trap.enabled),
        dcFind: int(trap.dcFind, 15, 1, 40), dcDisarm: int(trap.dcDisarm, 15, 1, 40),
        effect: {
          kind: eff.kind === 'salvezza' ? 'salvezza' : 'danno',
          dice: dice && dice.count > 0 ? DnD.dadi.formatExpr(dice.count, dice.sides, dice.modifier) : '2d10',
          type: str(eff.type, 40) || 'perforante',
          ability: AB().includes(eff.ability) ? eff.ability : 'DES',
          dc: int(eff.dc, 13, 1, 40),
          half: eff.half !== false,
        },
        reusable: Boolean(trap.reusable),
        armed: trap.armed !== false,
        found: Boolean(trap.found),
      },
      contents: arr(o.contents).slice(0, 200).map((c) => ({ equipmentId: str(obj(c).equipmentId, 64), qty: int(obj(c).qty, 1, 1, 100000) })).filter((c) => c.equipmentId),
      coins: DnD.attrezzatura.normalizeCoins(o.coins),
    };
  }

  // Modello (libreria): aspetto da icona o da tile (come le strutture), ingombro predefinito 1×1.
  function normalizeTemplate(o, normalizeTiles) {
    o = obj(o);
    const tiles = normalizeTiles ? normalizeTiles(o.tiles) : null;
    if (o.otype === 'npc') o = Object.assign({}, o, { otype: 'altro' }); // i modelli non sono NPC
    return Object.assign({
      id: typeof o.id === 'string' && /^[\w-]{1,64}$/.test(o.id) ? o.id : DnD.dadi.uid(),
      name: str(o.name, 60) || 'Oggetto di mappa',
      icon: DnD.icone.normalizeIcon(o.icon, true),
      mode: o.mode === 'tiles' && tiles ? 'tiles' : 'icon',
      tiles,
    }, normalizeFields(o));
  }

  // Copia da piazzare: stato e contenuto copiati dal modello.
  function instantiate(tpl, id) {
    const placed = clone(tpl);
    placed.sourceId = tpl.id;
    placed.id = id;
    return placed;
  }

  // Oggetto dell'Attrezzatura posato a terra: un oggetto di mappa che lo contiene.
  function groundItem(equipment, id, qty) {
    return Object.assign({
      id, sourceId: '', name: equipment.name, icon: clone(equipment.icon), mode: 'icon', tiles: null,
    }, normalizeFields({ otype: 'a-terra', container: true, state: 'aperto', contents: [{ equipmentId: equipment.id, qty: qty || 1 }] }));
  }

  // ---------- Azioni ----------
  function check(bonus, dc, rng) {
    const roll = rng(20);
    const total = roll + (bonus || 0);
    return { roll, total, success: total >= dc, text: 'd20 = ' + roll + ' ' + DnD.regole.formatModifier(bonus || 0) + ' = ' + total + ' contro CD ' + dc };
  }

  // Apri/chiudi. hasKey: chi apre ha la chiave richiesta (sblocca la serratura).
  function toggleOpen(o, hasKey) {
    if (o.state === 'aperto') { o.state = 'chiuso'; return { ok: true, text: o.name + ' viene chiuso.' }; }
    if (o.lock.locked && !hasKey) return { ok: false, text: o.name + ' è chiuso a chiave.' };
    if (o.lock.locked && hasKey) o.lock.locked = false;
    o.state = 'aperto';
    return { ok: true, text: o.name + ' viene aperto' + (hasKey ? ' con la chiave' : '') + '.' };
  }

  // Scassinare (di solito DES + strumenti da scasso) e sfondare (FOR).
  function pickLock(o, bonus, rng, who) {
    const r = check(bonus, o.lock.dcPick, rng);
    if (r.success) o.lock.locked = false;
    return Object.assign(r, { text: (who || 'Qualcuno') + ' prova a scassinare ' + o.name + ': ' + r.text + ' → ' + (r.success ? 'serratura aperta.' : 'fallito.') });
  }
  function forceOpen(o, bonus, rng, who) {
    const r = check(bonus, o.lock.dcForce, rng);
    if (r.success) { o.lock.locked = false; o.state = 'aperto'; }
    return Object.assign(r, { text: (who || 'Qualcuno') + ' prova a sfondare ' + o.name + ': ' + r.text + ' → ' + (r.success ? 'sfondato e aperto.' : 'resiste.') });
  }
  function findTrap(o, bonus, rng, who) {
    const r = check(bonus, o.trap.dcFind, rng);
    if (r.success) o.trap.found = true;
    return Object.assign(r, { text: (who || 'Qualcuno') + ' cerca trappole su ' + o.name + ': ' + r.text + ' → ' + (r.success ? 'trappola individuata!' : 'non trova nulla.') });
  }
  function disarmTrap(o, bonus, rng, who) {
    const r = check(bonus, o.trap.dcDisarm, rng);
    if (r.success) o.trap.armed = false;
    return Object.assign(r, { text: (who || 'Qualcuno') + ' prova a disinnescare ' + o.name + ': ' + r.text + ' → ' + (r.success ? 'disinnescata.' : 'fallito.') });
  }

  // La trappola scatta su un bersaglio ({ name, saves }): danno diretto oppure tiro salvezza.
  // Restituisce { amount, type, text }; se non è riattivabile si disarma.
  function triggerTrap(o, target, rng) {
    const e = o.trap.effect;
    if (!o.trap.armed) return { amount: 0, type: e.type, text: 'La trappola di ' + o.name + ' è disinnescata.' };
    const roll = DnD.dadi.rollExpr(e.dice, rng);
    const full = Math.max(0, roll.total);
    let amount = full;
    let text = 'Scatta la trappola di ' + o.name + ' su ' + target.name + ': ' + e.dice + ' [' + roll.rolls.join(', ') + '] = ' + full + ' danni ' + e.type;
    if (e.kind === 'salvezza') {
      const s = DnD.regole.rollSave({ bonus: (target.saves && target.saves[e.ability]) || 0, mode: 'normale', dc: e.dc }, rng);
      amount = s.success ? (e.half ? Math.floor(full / 2) : 0) : full;
      text += '; salvezza ' + e.ability + ' ' + s.total + ' contro CD ' + e.dc + ' → ' + (s.success ? 'riesce' : 'fallisce') + ', ' + amount + ' danni';
    }
    if (!o.trap.reusable) o.trap.armed = false;
    return { amount, type: e.type, text: text + '.' };
  }

  // Prende qty dell'oggetto alla posizione index del contenuto e lo mette nell'inventario (modifica entrambi).
  function take(o, index, qty, inventory) {
    const c = o.contents[index];
    if (!c) return 0;
    const n = Math.min(c.qty, Math.max(1, qty || c.qty));
    DnD.attrezzatura.addToInventory(inventory, c.equipmentId, n);
    c.qty -= n;
    if (c.qty <= 0) o.contents.splice(index, 1);
    return n;
  }

  // Prende tutto il contenuto e le monete. Restituisce { items, coins } presi.
  function takeAll(o, inventory, purse) {
    const items = o.contents.map((c) => ({ equipmentId: c.equipmentId, qty: c.qty }));
    for (const c of items) DnD.attrezzatura.addToInventory(inventory, c.equipmentId, c.qty);
    o.contents = [];
    const coins = Object.assign({}, o.coins);
    if (purse) Object.assign(purse, DnD.attrezzatura.addCoins(purse, coins));
    o.coins = DnD.attrezzatura.normalizeCoins({});
    return { items, coins };
  }

  const isEmpty = (o) => !o.contents.length && !DnD.attrezzatura.CURRENCIES.some((k) => o.coins[k]);

  DnD.oggettiMappa = {
    TYPES, TYPE_NAMES, TYPE_ICONS, normalizeFields, normalizeTemplate, instantiate, groundItem,
    check, toggleOpen, pickLock, forceOpen, findTrap, disarmTrap, triggerTrap, take, takeAll, isEmpty,
  };
})(globalThis.DnD = globalThis.DnD || {});
