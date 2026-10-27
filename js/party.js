// Party (logica pura): nome, colore, icona, fazione, giocatori (anche leggendari), ordine di marcia, inventario
// e monete condivisi facoltativi, reputazione comune verso le fazioni e note. Più party per sessione, uno attivo;
// un giocatore appartiene a un solo party alla volta (tra quelli visibili nella sessione).
// Livello regole, gruppo Mondo. Espone DnD.party; usa attrezzatura, fazioni, dadi, icone. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const ID = /^[\w-]{1,64}$/;
  const idOf = (v) => (typeof v === 'string' && ID.test(v) ? v : DnD.dadi.uid());
  const ids = (v, max) => [...new Set(arr(v).filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, max || 100);
  const DEFAULT_NAME = 'Gruppo';

  function normalizeParty(p) {
    p = obj(p);
    const memberIds = ids(p.memberIds, 50);
    return {
      id: idOf(p.id),
      name: str(p.name, 60) || DEFAULT_NAME,
      color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : '#4f8fd6',
      icon: DnD.icone.normalizeIcon(p.icon || { kind: 'library', icon: 'umano', color: '#4f8fd6' }, false),
      factionId: typeof p.factionId === 'string' && ID.test(p.factionId) ? p.factionId : 'giocatori',
      memberIds,
      // Ordine di marcia: i membri nell'ordine scelto (quelli mancanti in coda).
      marchOrder: orderOf(ids(p.marchOrder, 50), memberIds),
      sharedPurse: Boolean(p.sharedPurse),
      inventory: DnD.attrezzatura.normalizeInventory(p.inventory),
      coins: DnD.attrezzatura.normalizeCoins(p.coins),
      reputation: DnD.fazioni.normalizeRepMap(p.reputation),
      notes: str(p.notes, 5000),
      sessionId: typeof p.sessionId === 'string' ? p.sessionId.slice(0, 64) : '',
      shared: Boolean(p.shared),
    };
  }
  const orderOf = (order, members) => order.filter((x) => members.includes(x)).concat(members.filter((x) => !order.includes(x)));

  // Party «Gruppo» predefinito con i giocatori indicati.
  function defaultParty(sessionId, memberIds, id) {
    return normalizeParty({ id: id || DnD.dadi.uid(), name: DEFAULT_NAME, memberIds, sessionId });
  }

  const partyOf = (parties, playerId) => arr(parties).find((p) => p.memberIds.includes(playerId)) || null;

  // Mette il giocatore nel party (togliendolo dagli altri). Restituisce il party di prima (o null).
  function assignPlayer(parties, partyId, playerId) {
    const target = arr(parties).find((p) => p.id === partyId);
    if (!target) return null;
    const before = partyOf(parties.filter((p) => p.id !== partyId), playerId);
    for (const p of parties) if (p.id !== partyId) removePlayer(p, playerId);
    if (!target.memberIds.includes(playerId)) { target.memberIds.push(playerId); target.marchOrder.push(playerId); }
    return before;
  }
  function removePlayer(party, playerId) {
    party.memberIds = party.memberIds.filter((x) => x !== playerId);
    party.marchOrder = party.marchOrder.filter((x) => x !== playerId);
  }
  // Sposta un membro nell'ordine di marcia (delta -1 / +1).
  function moveInOrder(party, playerId, delta) {
    const i = party.marchOrder.indexOf(playerId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= party.marchOrder.length) return false;
    [party.marchOrder[i], party.marchOrder[j]] = [party.marchOrder[j], party.marchOrder[i]];
    return true;
  }

  // Membri del party nell'ordine di marcia (i giocatori eliminati si saltano, con il conteggio).
  function members(party, players) {
    const byId = new Map(arr(players).map((p) => [p.id, p]));
    const list = party ? party.marchOrder.map((id) => byId.get(id)).filter(Boolean) : [];
    return { list, missing: party ? party.marchOrder.filter((id) => !byId.has(id)).length : 0 };
  }

  // Elimina i riferimenti ai giocatori che non esistono più.
  function prune(party, players) {
    const known = new Set(arr(players).map((p) => p.id));
    party.memberIds = party.memberIds.filter((x) => known.has(x));
    party.marchOrder = party.marchOrder.filter((x) => known.has(x));
    return party;
  }

  // Party attivo della sessione: quello scelto, altrimenti il primo visibile.
  function active(parties, world) {
    const list = arr(parties);
    return list.find((p) => world && p.id === world.activePartyId) || list[0] || null;
  }

  // Fazione di un giocatore: definita in fazioni.js (serve anche alla fazione di partenza dei combattenti).
  const playerFaction = (player, parties) => DnD.fazioni.playerFaction(player, parties);

  DnD.party = { DEFAULT_NAME, normalizeParty, defaultParty, partyOf, assignPlayer, removePlayer, moveInOrder, members, prune, active, playerFaction };
})(globalThis.DnD = globalThis.DnD || {});
