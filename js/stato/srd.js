// Incantesimi dell'SRD 5.1 nella libreria Magie: confronto con la libreria (nuovi, già presenti, in conflitto),
// importazione con le scelte sui conflitti (tieni il mio, sostituisci, importa come copia), stato «modificato»,
// ripristino dell'originale, filtri per fonte e «da verificare», salvataggio tutto o niente.
// Livello stato. Espone DnD.srd; usa DnD.datiSrd (catalogo) e la normalizzazione degli incantesimi (DnD.normalizza).
// Non deve toccare il DOM; scrive solo tramite lo store ricevuto (che passa da stato/archivio.js).
(function (DnD) {
  'use strict';

  const FONTE = 'SRD 5.1 IT';
  const SCELTE = ['tieni', 'sostituisci', 'copia'];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const norm = (sp) => DnD.normalizza.normalizeSpell(sp);
  const chiaveNome = (n) => String(n || '').trim().toLowerCase();

  const catalogo = () => (DnD.datiSrd && Array.isArray(DnD.datiSrd.incantesimi) ? DnD.datiSrd.incantesimi : []);
  const voce = (srdId) => catalogo().find((v) => v.id === srdId) || null;
  // Voce dell'SRD da cui viene un incantesimo della libreria (null se è stato creato nell'app).
  const originale = (sp) => (sp && (sp.srdId || sp.fonte === FONTE) ? voce(sp.srdId || sp.id) : null);

  // Incantesimo della libreria da una voce del catalogo (id: quello stabile della voce, o uno dato).
  function daCatalogo(v, id, nome) {
    return norm(Object.assign(clone(v), { id: id || v.id, name: nome || v.name, srdId: v.id, fonte: FONTE, modificato: false, meccanicaVerificata: false }));
  }

  // Campi che contano per «modificato» (non contano id, verifica della meccanica e provenienza).
  const CONTENUTO = ['name', 'level', 'school', 'castingTime', 'range', 'components', 'duration', 'concentration', 'ritual', 'area', 'classes', 'description', 'higherLevels', 'effect', 'inflict'];
  const contenuto = (sp, nome) => JSON.stringify(CONTENUTO.map((k) => (k === 'name' ? nome : k === 'classes' ? sp.classes.slice().sort() : sp[k])));
  // Vero se l'incantesimo (normalizzato) differisce dall'originale SRD. Le copie possono avere un nome diverso.
  function diverso(sp) {
    const v = originale(sp);
    if (!v) return false;
    const o = daCatalogo(v);
    return contenuto(sp, sp.id === v.id ? sp.name : '') !== contenuto(o, sp.id === v.id ? o.name : '');
  }
  // Dopo una modifica nel form: segna (o toglie) «modificato» confrontando con l'originale.
  function segnaModifiche(sp) {
    if (originale(sp)) sp.modificato = diverso(sp);
    return sp;
  }
  // Ripristino dell'originale: stesso id (i personaggi che lo conoscono lo tengono), nome della copia se lo era.
  function ripristina(sp) {
    const v = originale(sp);
    if (!v) throw new Error('questo incantesimo non viene dall\'SRD.');
    return daCatalogo(v, sp.id, sp.id === v.id ? v.name : sp.name);
  }

  // Confronto delle voci scelte con la libreria. Ogni risultato: { voce, stato, esistente, motivo }:
  // 'nuovo'; 'presente' (già importato e non modificato: rilanciare non cambia nulla); 'conflitto' con motivo
  // 'modificato' (importato e poi modificato) o 'nome' (stesso nome di un incantesimo non dell'SRD, es. gli esempi).
  function confronta(libreria, voci) {
    return voci.map((v) => {
      const legato = libreria.find((s) => s.srdId === v.id || s.id === v.id);
      if (legato) return legato.modificato || legato.id === v.id && !legato.srdId
        ? { voce: v, stato: 'conflitto', esistente: legato, motivo: legato.modificato ? 'modificato' : 'id' }
        : { voce: v, stato: 'presente', esistente: legato, motivo: '' };
      const omonimo = libreria.find((s) => chiaveNome(s.name) === chiaveNome(v.name));
      return omonimo ? { voce: v, stato: 'conflitto', esistente: omonimo, motivo: 'nome' } : { voce: v, stato: 'nuovo', esistente: null, motivo: '' };
    });
  }

  // Nome libero per una copia: «Nome (SRD)», poi «Nome (SRD 2)»…
  function nomeCopia(libreria, nome) {
    const presi = new Set(libreria.map((s) => chiaveNome(s.name)));
    for (let i = 1; ; i++) {
      const suffisso = i === 1 ? ' (SRD)' : ' (SRD ' + i + ')';
      const n = nome.slice(0, 60 - suffisso.length) + suffisso;
      if (!presi.has(chiaveNome(n))) return n;
    }
  }

  // Applica il confronto: restituisce { spells (libreria nuova, quella data non cambia), esito: { aggiunti,
  // sostituiti, copie, tenuti, presenti } }. scelte: { [id voce]: 'tieni' | 'sostituisci' | 'copia' }; un conflitto
  // senza scelta resta com'è (nessun incantesimo dell'utente viene sovrascritto senza conferma). newId: id delle copie.
  function applica(libreria, confronto, scelte, newId) {
    const spells = libreria.slice();
    const esito = { aggiunti: 0, sostituiti: 0, copie: 0, tenuti: 0, presenti: 0 };
    for (const r of confronto) {
      if (r.stato === 'presente') { esito.presenti++; continue; }
      if (r.stato === 'nuovo') {
        // Un'altra voce della stessa importazione può aver preso il nome (non succede con l'SRD, ma resta sicuro).
        if (spells.some((s) => s.id === r.voce.id)) { esito.presenti++; continue; }
        spells.push(daCatalogo(r.voce));
        esito.aggiunti++;
        continue;
      }
      const scelta = (scelte || {})[r.voce.id];
      if (scelta === 'sostituisci') {
        const i = spells.indexOf(r.esistente);
        // Stesso id dell'incantesimo sostituito: personaggi e creature che lo usano non perdono il riferimento.
        spells[i] = daCatalogo(r.voce, r.esistente.id);
        esito.sostituiti++;
      } else if (scelta === 'copia') {
        spells.push(daCatalogo(r.voce, newId(), nomeCopia(spells, r.voce.name)));
        esito.copie++;
      } else {
        esito.tenuti++;
      }
    }
    return { spells, esito };
  }

  // Filtri della sezione Magie.
  const fonteDi = (sp) => (sp.fonte === FONTE || sp.srdId ? 'srd' : 'mie');
  const daVerificare = (sp) => !sp.meccanicaVerificata;
  const conferma = (sp) => Object.assign(sp, { meccanicaVerificata: true });

  // Sostituisce la libreria nello store e salva: se la scrittura non riesce (es. quota piena) rimette la libreria di
  // prima in memoria, così sul disco e nell'app non resta un'importazione a metà. Restituisce l'esito del salvataggio.
  async function salvaLibreria(store, spells) {
    const prima = store.state.spells;
    const esito = await store.update((st) => { st.spells = spells; });
    if (!esito.ok) store.state.spells = prima;
    return esito;
  }

  DnD.srd = {
    FONTE, SCELTE, catalogo, voce, originale, daCatalogo, diverso, segnaModifiche, ripristina, confronta, nomeCopia, applica,
    fonteDi, daVerificare, conferma, salvaLibreria,
  };
})(globalThis.DnD = globalThis.DnD || {});
