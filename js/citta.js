// Città (logica pura): nome, descrizione, fazione dominante e fazioni presenti, dimensione, bioma, mappa
// collegata (griglia di battaglia o esplorazione), segnaposto sulla mappa di esplorazione, ambiente e regole
// (armi vietate, coprifuoco, tasse), quest ed eventi collegati. L'atteggiamento verso il party viene dalla
// reputazione con la fazione dominante. La fazione della città è quella predefinita per NPC e nemici creati lì.
// Livello regole, gruppo Mondo. Espone DnD.citta; usa dati/mondo, fazioni, eventi, dadi, icone. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const K = () => DnD.mondoDati;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const int = (v, def, lo, hi) => { const n = Math.round(Number(v)); return v !== null && v !== '' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const ID = /^[\w-]{1,64}$/;
  const idOf = (v) => (typeof v === 'string' && ID.test(v) ? v : DnD.dadi.uid());
  const refId = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
  const ids = (v, max) => [...new Set(arr(v).filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, max || 100);

  function normalizeCity(c) {
    c = obj(c);
    const r = obj(c.rules);
    const place = obj(c.place);
    return {
      id: idOf(c.id),
      name: str(c.name, 60) || 'Città',
      description: str(c.description, 5000),
      icon: DnD.icone.normalizeIcon(c.icon || { kind: 'shape', shape: 'quadrato', color: '#c9a227' }, false),
      factionId: refId(c.factionId) || 'neutrali',
      presentFactionIds: ids(c.presentFactionIds, 30),
      size: K().CITY_SIZES.includes(c.size) ? c.size : 'paese',
      biomeId: refId(c.biomeId),
      // Mappa collegata (facoltativa) e punto di ingresso.
      gridId: refId(c.gridId),
      entry: { x: int(obj(c.entry).x, 0, 0, 99), y: int(obj(c.entry).y, 0, 0, 99) },
      // Segnaposto sulla mappa di esplorazione (l'evento «Entra in una mappa» piazzato lì).
      place: place.gridId ? { gridId: refId(place.gridId), x: int(place.x, 0, 0, 99), y: int(place.y, 0, 0, 99), instanceId: refId(place.instanceId) } : null,
      environment: str(c.environment, 2000),
      rules: { weapons: str(r.weapons, 300), curfew: str(r.curfew, 300), taxes: str(r.taxes, 300) },
      questIds: ids(c.questIds, 50),
      eventIds: ids(c.eventIds, 30),
      entryEventId: refId(c.entryEventId),
      notes: str(c.notes, 5000),
      sessionId: typeof c.sessionId === 'string' ? c.sessionId.slice(0, 64) : '',
      shared: Boolean(c.shared),
    };
  }

  // «Crea città» rapido: nome, fazione, dimensione, bioma.
  function quickCity(data, sessionId) {
    return normalizeCity(Object.assign({ id: DnD.dadi.uid(), sessionId }, obj(data)));
  }

  // Atteggiamento della città verso il party: { id, name, text, rep }.
  function attitude(city, rep) {
    const id = DnD.fazioni.cityAttitude(rep);
    return { id, name: K().CITY_ATTITUDES[id] || 'Neutrale', text: DnD.fazioni.cityAttitudeText(rep), rep };
  }
  const isClosed = (city, rep, blockHostile) => !DnD.fazioni.hasAccess(rep, blockHostile);

  // Fazione predefinita per un NPC o un nemico creato nella città.
  const defaultFaction = (city, fallback) => (city && city.factionId) || fallback || 'neutrali';

  // Contenuti: NPC della città, mercanti, quest disponibili (della città o dei suoi datori di quest).
  function contents(city, npcs, quests) {
    const here = arr(npcs).filter((n) => n.cityId === city.id);
    const givers = new Set(here.filter((n) => n.roles.includes('quest')).map((n) => n.id));
    return {
      npcs: here,
      merchants: here.filter((n) => n.roles.includes('mercante')),
      quests: arr(quests).filter((q) => city.questIds.includes(q.id) || givers.has(q.giver.npcId)),
    };
  }

  // Evento «Entra in una mappa» per il segnaposto sulla mappa di esplorazione (con ritorno dell'esplorazione).
  function placeEvent(city) {
    return DnD.eventi.normalizeEvent({
      id: 'citta-' + city.id, name: city.name, icon: city.icon, description: 'Segnaposto della città «' + city.name + '».',
      readText: city.description ? city.description.slice(0, 600) : '', trigger: { kind: 'interazione' }, repeat: { kind: 'sempre' }, shared: false,
      actions: (city.gridId ? [{ kind: 'mappa', gridId: city.gridId, entry: city.entry }] : [{ kind: 'nota', text: 'La città «' + city.name + '» non ha ancora una mappa collegata.' }]),
    });
  }

  // Riferimenti mancanti (fazioni, mappa, bioma, quest, eventi): messaggi.
  function missingRefs(city, st, list) {
    const out = [];
    const has = (key, id) => arr(st[key]).some((x) => x.id === id);
    if (city.factionId && list && !list.factions.some((f) => f.id === city.factionId)) out.push('fazione dominante eliminata');
    if (city.gridId && !has('savedGrids', city.gridId)) out.push('mappa collegata eliminata');
    if (city.biomeId && !has('biomes', city.biomeId)) out.push('bioma eliminato');
    if (list && city.questIds.some((q) => !list.quests.some((x) => x.id === q))) out.push('quest eliminata');
    if (city.eventIds.some((e) => !has('events', e))) out.push('evento eliminato');
    return out;
  }

  DnD.citta = { normalizeCity, quickCity, attitude, isClosed, defaultFaction, contents, placeEvent, missingRefs };
})(globalThis.DnD = globalThis.DnD || {});
