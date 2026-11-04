// Analisi del testo degli incantesimi dell'SRD 5.1 in italiano: intestazione (livello, scuola, rituale), campi (tempo di
// lancio, gittata, componenti, durata), concentrazione, testo «Ai livelli superiori», liste per classe e rilevamento
// prudente dell'effetto meccanico. Livello regole, senza dipendenze: lo usano lo strumento strumenti/estrai-srd.js
// (fuori dall'app) e la coda «Da verificare» della sezione Magie. Espone DnD.srdAnalisi. Non tocca DOM, disco o rete.
(function (DnD) {
  'use strict';

  // Scuole come scritte nel PDF (minuscole) → id della libreria Magie.
  const SCUOLE = {
    abiurazione: 'abiurazione', ammaliamento: 'ammaliamento', divinazione: 'divinazione', evocazione: 'evocazione',
    illusione: 'illusione', invocazione: 'invocazione', necromanzia: 'necromanzia', trasmutazione: 'trasmutazione',
  };
  // Titoli delle liste per classe → id delle classi (dati/classi.js).
  const CLASSI = {
    bardo: 'bardo', chierico: 'chierico', druido: 'druido', mago: 'mago', paladino: 'paladino', ranger: 'ranger',
    stregone: 'stregone', warlock: 'warlock',
  };
  const CARATTERISTICHE = { forza: 'FOR', destrezza: 'DES', costituzione: 'COS', intelligenza: 'INT', saggezza: 'SAG', carisma: 'CAR' };
  const TIPI_DANNO = ['acido', 'contundenti', 'forza', 'freddo', 'fulmine', 'fuoco', 'necrotici', 'perforanti', 'psichici', 'radiosi', 'taglienti', 'tuono', 'veleno'];

  const spazi = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  // Id stabile: srd51-it-<nome in minuscolo, senza accenti, con trattini>.
  function slug(nome) {
    return 'srd51-it-' + String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Riga dopo il nome: «Trucchetto di Invocazione», «Invocazione di 3° livello (rituale)», eventualmente seguita sulla
  // stessa riga dai campi. Restituisce { level, school, ritual, resto } oppure null.
  function intestazione(riga) {
    const t = spazi(riga);
    let m = /^Trucchetto di ([A-Za-z]+)( \(rituale\))?(?: (.*))?$/.exec(t);
    if (m && SCUOLE[m[1].toLowerCase()]) return { level: 0, school: SCUOLE[m[1].toLowerCase()], ritual: Boolean(m[2]), resto: m[3] || '' };
    m = /^([A-Za-z]+) di ([1-9])° livello( \(rituale\))?(?: (.*))?$/.exec(t);
    if (m && SCUOLE[m[1].toLowerCase()]) return { level: Number(m[2]), school: SCUOLE[m[1].toLowerCase()], ritual: Boolean(m[3]), resto: m[4] || '' };
    return null;
  }

  // Valori di durata che compaiono nell'SRD (servono a capire dove finisce la durata e inizia la descrizione).
  const DURATA = /^(Istantanea|Speciale|Finché non viene dissolto(?: o innescato)?|(?:Concentrazione, )?(?:[Ff]ino a )?(?:\d+|un|una) (?:round|minut[oi]|or[ae]|giorn[oi]))\.?(?:\s+|$)/;

  // Testo dei campi «Tempo di lancio: … Gittata: … Componenti: … Durata: …» (righe già unite con uno spazio; il PDF
  // scrive una volta «Componente:»).
  // Restituisce { castingTime, range, components, duration, resto } oppure null se manca un campo.
  function campi(testo) {
    const t = spazi(testo);
    const m = /^Tempo di lancio: (.+?) Gittata: (.+?) Component[ei]: (.+?) Durata: (.*)$/.exec(t);
    if (!m) return null;
    const d = DURATA.exec(m[4]);
    if (!d) return null;
    return { castingTime: m[1].trim(), range: m[2].trim(), components: componenti(m[3]), duration: d[1], resto: m[4].slice(d[0].length).trim() };
  }

  // «V, S, M (una piuma)» → { V, S, M, material }.
  function componenti(testo) {
    const t = spazi(testo);
    const mat = /\bM \((.*)\)$/.exec(t);
    const sigle = (mat ? t.slice(0, mat.index) + 'M' : t).split(/,\s*/).map((x) => x.trim());
    return { V: sigle.includes('V'), S: sigle.includes('S'), M: sigle.includes('M'), material: mat ? mat[1].trim() : '' };
  }

  // Concentrazione: dalla durata («Concentrazione, fino a 1 minuto»).
  const concentrazione = (durata) => /^\s*concentrazione\b/i.test(String(durata || ''));
  // Rituale: dall'etichetta «(rituale)» dell'intestazione o, se c'è, dal tempo di lancio.
  const rituale = (intest, tempo) => /\(rituale\)/i.test(String(intest || '')) || /\brituale\b/i.test(String(tempo || ''));

  // Separa la descrizione dal paragrafo «Ai livelli superiori.» (sempre l'ultimo, nell'SRD).
  function livelliSuperiori(testo) {
    const i = String(testo).search(/(^|\n)Ai livelli superiori\. /);
    if (i < 0) return { description: String(testo).trim(), higherLevels: '' };
    const start = testo[i] === '\n' ? i + 1 : i;
    return { description: testo.slice(0, i).trim(), higherLevels: testo.slice(start + 'Ai livelli superiori. '.length).trim() };
  }

  // Divide una riga di nomi separati da spazi («Luce Mano magica Messaggio») usando i nomi noti, il più lungo per primo.
  // Restituisce { nomi: [nomi noti], ignoti: [frammenti non riconosciuti] }.
  function separaLista(testo, noti) {
    const chiave = (s) => s.toLowerCase();
    const elenco = [...new Set(noti)].sort((a, b) => b.length - a.length);
    const parole = spazi(testo).split(' ').filter(Boolean);
    const nomi = [];
    const ignoti = [];
    let buco = [];
    for (let i = 0; i < parole.length;) {
      const resto = chiave(parole.slice(i).join(' '));
      const n = elenco.find((x) => resto === chiave(x) || resto.startsWith(chiave(x) + ' '));
      if (n) {
        if (buco.length) { ignoti.push(buco.join(' ')); buco = []; }
        nomi.push(n);
        i += n.split(' ').length;
      } else {
        buco.push(parole[i]);
        i++;
      }
    }
    if (buco.length) ignoti.push(buco.join(' '));
    return { nomi, ignoti };
  }

  const dado = (t) => String(t).replace(/\s+/g, '').toLowerCase();
  const effettoVuoto = () => ({ type: 'nessuno', dice: '', damageType: '', upcastDice: '', saveAbility: 'DES', halfOnSave: false, addMod: false });

  // Rilevamento prudente dell'effetto meccanico: { effect, area, rilevata, note: [motivi] }. Se il testo è ambiguo
  // (più tipi di danno, più caratteristiche, attacco e salvezza insieme, danni senza tiro) l'effetto resta
  // «nessun tiro automatico» e la nota dice perché.
  function rilevaMeccanica(sp) {
    const testo = spazi(sp.description);
    const sup = spazi(sp.higherLevels);
    const note = [];
    const effect = effettoVuoto();
    const area = /\((?:[^)]*\b)?(cono|cubo|sfera|linea|raggio|cilindro|emisfero)\b/i.test(sp.range || '') ||
      // «Ogni creatura (situata) entro una sfera / un cono…»: più bersagli nell'area.
      /\bogni creatura (?:[a-zà]+ ){0,3}(?:entro|in|nel|nella|dentro) (?:una |un |la |il |l'|quella |quel )?(?:sfera|cilindro|cubo|cono|emisfero|linea|raggio|area)\b/i.test(testo);

    const attacco = /\battacc(?:o|hi) (?:(?:a distanza|in mischia) )?con (?:un |questo )?incantesimo/i.test(testo) ||
      /\bcon questo incantesimo,? (?:l'incantatore )?effettu(?:a|i) un attacco (?:a distanza|in mischia)/i.test(testo);
    // «Vantaggio ai tiri salvezza su Destrezza» e simili non sono tiri imposti dall'incantesimo.
    const perTs = testo.replace(/\b(?:s?vantaggio|bonus|penalità|competenza)\b[^.;]{0,30}? (?:ai|al|a|nei|nel) tir[oi] salvezza su \w+/gi, '');
    const ts = [...new Set([...perTs.matchAll(/tir[oi] salvezza su (Forza|Destrezza|Costituzione|Intelligenza|Saggezza|Carisma)/gi)].map((m) => CARATTERISTICHE[m[1].toLowerCase()]))];
    const danni = [...new Set([...testo.matchAll(new RegExp('(\\d+d\\d+(?: ?\\+ ?\\d+)?) danni (?:da )?(' + TIPI_DANNO.join('|') + ')\\b', 'gi'))]
      .map((m) => dado(m[1]) + ' ' + m[2].toLowerCase()))];
    const cura = /recuper(?:a|ano) (?:un numero|una quantità|un ammontare) di punti ferita pari a (\d+d\d+)( \+ il modificatore di caratteristica da incantatore)?/i.exec(testo);

    if (attacco && ts.length) { note.push('attacco con incantesimo e tiro salvezza nello stesso testo'); return { effect, area, rilevata: false, note }; }
    if (ts.length > 1) { note.push('tiri salvezza su più caratteristiche: ' + ts.join(', ')); return { effect, area, rilevata: false, note }; }
    if (danni.length > 1) { note.push('più danni diversi: ' + danni.join('; ')); return { effect, area, rilevata: false, note }; }
    if (cura && (attacco || ts.length || danni.length)) { note.push('cura insieme a danni o tiri'); return { effect, area, rilevata: false, note }; }

    const [dice, damageType] = danni.length ? danni[0].split(' ') : ['', ''];
    if (attacco) {
      Object.assign(effect, { type: 'attacco', dice, damageType });
      note.push('attacco con incantesimo' + (dice ? ', ' + dice + ' ' + damageType : ', nessun dado di danno'));
    } else if (ts.length) {
      const meta = /\bla metà (?:dei|di quei) danni\b|\bmetà dei danni\b/i.test(testo);
      Object.assign(effect, { type: 'salvezza', saveAbility: ts[0], dice, damageType, halfOnSave: Boolean(dice) && meta });
      note.push('tiro salvezza su ' + ts[0] + (dice ? ', ' + dice + ' ' + damageType + (effect.halfOnSave ? ', metà se riesce' : '') : ', senza danni'));
    } else if (cura) {
      Object.assign(effect, { type: 'cura', dice: dado(cura[1]), addMod: Boolean(cura[2]) });
      note.push('cura ' + effect.dice + (effect.addMod ? ' + modificatore' : ''));
    } else if (danni.length) {
      note.push('danni senza attacco né tiro salvezza: ' + danni[0]);
      return { effect, area, rilevata: false, note };
    } else {
      note.push('nessun dado, attacco o tiro salvezza nel testo');
      return { effect, area, rilevata: false, note };
    }
    // Dado extra per slot superiore (solo «per ogni slot», non «per ogni due slot»).
    if (sp.level > 0 && effect.dice) {
      const up = /aument(?:a|ano) di (\d+d\d+(?: ?\+ ?\d+)?) per ogni slot di livello superiore/i.exec(sup);
      if (up) { effect.upcastDice = dado(up[1]); note.push('+' + effect.upcastDice + ' per slot superiore'); }
      else if (/per ogni (?:due )?slot/i.test(sup)) note.push('livelli superiori non interpretati: «' + sup.slice(0, 80) + '…»');
    }
    return { effect, area, rilevata: true, note };
  }

  DnD.srdAnalisi = { SCUOLE, CLASSI, CARATTERISTICHE, TIPI_DANNO, slug, intestazione, campi, componenti, concentrazione, rituale, livelliSuperiori, separaLista, rilevaMeccanica };
})(globalThis.DnD = globalThis.DnD || {});
