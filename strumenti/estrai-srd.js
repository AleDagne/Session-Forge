#!/usr/bin/env node
// Strumento di sviluppo (fuori dall'app, non in cache nel service worker): estrae gli incantesimi dal PDF
// fonti/SRD_CC_v5.1_IT.pdf e genera js/dati/srd-incantesimi.js e il rapporto docs/IMPORT_SRD.md.
// Uso: node strumenti/estrai-srd.js [percorso del PDF]. Richiede pdftotext (Poppler/Xpdf) nel PATH.
// L'analisi del testo (intestazioni, campi, liste, meccanica) è in js/srd-analisi.js, la stessa provata da test.html.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const RADICE = path.join(__dirname, '..');
const PDF = path.resolve(process.argv[2] || path.join(RADICE, 'fonti', 'SRD_CC_v5.1_IT.pdf'));
const USCITA_DATI = path.join(RADICE, 'js', 'dati', 'srd-incantesimi.js');
const USCITA_RAPPORTO = path.join(RADICE, 'docs', 'IMPORT_SRD.md');
const FONTE = 'SRD 5.1 IT';

if (!fs.existsSync(PDF)) {
  console.error('PDF non trovato: ' + PDF);
  process.exit(1);
}

// Modulo di analisi dell'app, caricato come script classico.
const contesto = { globalThis: {} };
contesto.globalThis = contesto;
vm.createContext(contesto);
vm.runInContext(fs.readFileSync(path.join(RADICE, 'js', 'srd-analisi.js'), 'utf8'), contesto);
const A = contesto.DnD.srdAnalisi;

// Testo del PDF in ordine di lettura (una riga per paragrafo, le colonne una dopo l'altra).
const testo = execFileSync('pdftotext', ['-enc', 'UTF-8', PDF, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const PIEDE = /^Rivendita vietata\. /;
const righe = testo.split(/\r?\n/).map((r) => r.replace(/\f/g, '').replace(/[ \t]+$/, ''));

// ---------- Attribuzione (alla lettera, dalla prima pagina) ----------
const mAttr = /dichiarazione di attribuzione:\s+([\s\S]+?)\s+Non includere altre attribuzioni/.exec(testo.slice(0, 20000));
if (!mAttr) throw new Error('testo di attribuzione non trovato nella prima pagina');
const ATTRIBUZIONE = mAttr[1].replace(/\s+/g, ' ').trim();
const LICENZA_URL = (/(https:\/\/creativecommons\.org\/\S+?)\.?$/.exec(ATTRIBUZIONE) || [])[1];
if (!LICENZA_URL) throw new Error('link alla licenza non trovato nell\'attribuzione');

// ---------- Sezioni ----------
const iListe = righe.indexOf('Liste degli incantesimi');
const iDescr = righe.indexOf('Descrizioni degli incantesimi');
const iFine = righe.findIndex((r, i) => i > iDescr && r === 'Trappole');
if (iListe < 0 || iDescr < 0 || iFine < 0) throw new Error('sezioni degli incantesimi non trovate');
const pulite = (da, a) => righe.slice(da, a).filter((r) => !PIEDE.test(r));

// Difetti del PDF corretti con il testo del PDF stesso (segnalati nel rapporto).
const CORREZIONI = [
  { da: 'Ammaliamento di 5° li Eroismoello', a: 'Ammaliamento di 5° livello', nota: "Dominare persone: nell'intestazione la parola «Eroismo» (titolo dell'incantesimo della colonna accanto) è sovrapposta a «livello»" },
];
const correzioniFatte = [];
for (let i = iDescr; i < iFine; i++) {
  for (const c of CORREZIONI) if (righe[i] === c.da) { righe[i] = c.a; correzioniFatte.push(c.nota); }
}
const componente = [];

// ---------- Descrizioni ----------
const descr = pulite(iDescr + 1, iFine);
const inizi = [];
for (let i = 1; i < descr.length; i++) {
  const h = A.intestazione(descr[i]);
  if (!h) continue;
  let n = i - 1;
  while (n >= 0 && !descr[n].trim()) n--;
  inizi.push({ nome: descr[n].trim(), riga: n, intest: i, h });
}

const anomalie = { campi: [], spezzati: [], lunghi: [] };
const incantesimi = [];
for (let k = 0; k < inizi.length; k++) {
  const s = inizi[k];
  const fine = k + 1 < inizi.length ? inizi[k + 1].riga : descr.length;
  const blocco = descr.slice(s.intest + 1, fine);
  // Campi: righe unite finché la durata è completa.
  let testoCampi = s.h.resto;
  let c = null;
  let j = 0;
  while (j < blocco.length && !c) {
    testoCampi = (testoCampi + ' ' + blocco[j]).trim();
    j++;
    if (/ Durata: /.test(' ' + testoCampi)) c = A.campi(testoCampi);
  }
  if (!c) { anomalie.campi.push(s.nome); continue; }
  if (/ Componente: /.test(' ' + testoCampi)) componente.push(s.nome + ': «Componente:» invece di «Componenti:»');
  // Paragrafi: le righe vuote non contano; una riga che continua con la minuscola è lo stesso paragrafo (a capo di
  // pagina o di colonna).
  const paragrafi = [];
  for (const r of [c.resto].concat(blocco.slice(j)).map((x) => x.trim()).filter(Boolean)) {
    const prima = paragrafi[paragrafi.length - 1];
    if (prima !== undefined && (/^[a-zàèéìòù(]/.test(r) || /[,;]$/.test(prima))) {
      paragrafi[paragrafi.length - 1] = prima + ' ' + r;
      anomalie.spezzati.push(s.nome + ': «…' + prima.slice(-40) + '» + «' + r.slice(0, 40) + '…» (uniti)');
    } else {
      if (prima !== undefined && !/[.!?:)»"”]$/.test(prima)) anomalie.spezzati.push(s.nome + ': paragrafo che finisce senza punto «…' + prima.slice(-60) + '» (lasciato così)');
      paragrafi.push(r);
    }
  }
  const { description, higherLevels } = A.livelliSuperiori(paragrafi.join('\n'));
  const sp = {
    id: A.slug(s.nome),
    name: s.nome,
    level: s.h.level,
    school: s.h.school,
    castingTime: c.castingTime,
    range: c.range,
    components: c.components,
    duration: c.duration,
    concentration: A.concentrazione(c.duration),
    ritual: A.rituale(descr[s.intest], c.castingTime),
    area: false,
    classes: [],
    description,
    higherLevels,
    effect: null,
    fonte: FONTE,
    modificato: false,
    meccanicaVerificata: false,
  };
  const m = A.rilevaMeccanica(sp);
  sp.effect = m.effect;
  sp.area = m.area;
  incantesimi.push({ sp, mecc: m });
  if (s.nome.length > 60) anomalie.lunghi.push(s.nome + ' (nome oltre 60 caratteri)');
}

// ---------- Liste per classe ----------
const nomi = incantesimi.map((x) => x.sp.name);
const perNome = new Map(incantesimi.map((x) => [x.sp.name.toLowerCase(), x]));
const liste = pulite(iListe + 1, iDescr).filter((r) => r.trim());
const fuoriLista = [];
const livelliDiversi = [];
const approssimati = [];
const nomiInLista = new Set();
let classe = null;
let livello = null;
const gruppi = []; // { classe, livello, testo }
for (const r of liste) {
  const mc = /^Incantesimi da ([a-z]+)$/.exec(r.trim());
  if (mc) { classe = A.CLASSI[mc[1]] || null; if (!classe) fuoriLista.push('classe sconosciuta: ' + mc[1]); continue; }
  if (/^Trucchetti \(livello 0\)$/.test(r.trim())) { livello = 0; gruppi.push({ classe, livello, testo: '' }); continue; }
  const ml = /^([1-9])° livello$/.exec(r.trim());
  if (ml) { livello = Number(ml[1]); gruppi.push({ classe, livello, testo: '' }); continue; }
  if (gruppi.length) gruppi[gruppi.length - 1].testo += ' ' + r;
}
// Distanza di modifica (per i nomi scritti in modo diverso nella lista e nella descrizione).
function distanza(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function approssima(frammento) {
  // Il frammento può contenere più nomi: prova i prefissi di parole, il più lungo per primo.
  const parole = frammento.split(' ');
  const trovati = [];
  const resto = [];
  for (let i = 0; i < parole.length;) {
    let preso = null;
    for (let n = parole.length - i; n >= 1 && !preso; n--) {
      const pezzo = parole.slice(i, i + n).join(' ').toLowerCase();
      const cand = nomi.filter((x) => Math.abs(x.length - pezzo.length) <= 2 && distanza(x.toLowerCase(), pezzo) <= 2);
      if (cand.length === 1) preso = { nome: cand[0], n, pezzo: parole.slice(i, i + n).join(' ') };
    }
    if (preso) { trovati.push(preso); i += preso.n; } else { resto.push(parole[i]); i++; }
  }
  return { trovati, resto: resto.join(' ') };
}
for (const g of gruppi) {
  const { nomi: trovati, ignoti } = A.separaLista(g.testo, nomi);
  for (const f of ignoti) {
    const a = approssima(f);
    for (const t of a.trovati) { trovati.push(t.nome); approssimati.push('«' + t.pezzo + '» (lista ' + g.classe + ', ' + g.livello + '°) → ' + t.nome); }
    if (a.resto) fuoriLista.push('«' + a.resto + '» (lista ' + g.classe + ', livello ' + g.livello + '): nessun incantesimo con questo nome');
  }
  for (const n of trovati) {
    const x = perNome.get(n.toLowerCase());
    nomiInLista.add(x.sp.name);
    if (x.sp.level !== g.livello) livelliDiversi.push(x.sp.name + ': lista ' + g.classe + ' al livello ' + g.livello + ', descrizione di livello ' + x.sp.level);
    if (!x.sp.classes.includes(g.classe)) x.sp.classes.push(g.classe);
  }
}
const ORDINE_CLASSI = ['bardo', 'chierico', 'druido', 'mago', 'paladino', 'ranger', 'stregone', 'warlock'];
for (const x of incantesimi) x.sp.classes.sort((a, b) => ORDINE_CLASSI.indexOf(a) - ORDINE_CLASSI.indexOf(b));

// Id ripetuti (nomi che differiscono solo per accenti o punteggiatura).
const ids = new Map();
for (const x of incantesimi) ids.set(x.sp.id, (ids.get(x.sp.id) || 0) + 1);
const idDoppi = [...ids].filter(([, n]) => n > 1).map(([id]) => id);

// ---------- File dati ----------
const js = (v) => JSON.stringify(v);
const dati = '// Incantesimi del System Reference Document 5.1 in italiano (fonti/SRD_CC_v5.1_IT.pdf), nel formato della\n' +
  '// libreria Magie. File GENERATO da strumenti/estrai-srd.js: non modificarlo a mano, rilancia lo strumento.\n' +
  '// Livello dati. Espone DnD.datiSrd = { FONTE, ATTRIBUZIONE, LICENZA, LICENZA_URL, incantesimi }.\n' +
  '// L\'effetto meccanico è rilevato in automatico (meccanicaVerificata: false): va confermato nella coda «Da verificare».\n' +
  '(function (DnD) {\n  \'use strict\';\n\n  DnD.datiSrd = {\n' +
  '    FONTE: ' + js(FONTE) + ',\n' +
  '    // Testo di attribuzione copiato alla lettera dalle «Note legali» del PDF.\n' +
  '    ATTRIBUZIONE: ' + js(ATTRIBUZIONE) + ',\n' +
  '    LICENZA: \'Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0)\',\n' +
  '    LICENZA_URL: ' + js(LICENZA_URL) + ',\n' +
  '    incantesimi: [\n' + incantesimi.map((x) => '      ' + js(x.sp) + ',\n').join('') + '    ],\n  };\n' +
  '})(globalThis.DnD = globalThis.DnD || {});\n';
fs.writeFileSync(USCITA_DATI, dati);

// ---------- Rapporto ----------
const NOMI_SCUOLE = { abiurazione: 'Abiurazione', ammaliamento: 'Ammaliamento', divinazione: 'Divinazione', evocazione: 'Evocazione', illusione: 'Illusione', invocazione: 'Invocazione', necromanzia: 'Necromanzia', trasmutazione: 'Trasmutazione' };
const conta = (f) => incantesimi.reduce((m, x) => { const k = f(x.sp); m[k] = (m[k] || 0) + 1; return m; }, {});
const perLivello = conta((s) => s.level);
const perScuola = conta((s) => s.school);
const senzaClasse = incantesimi.filter((x) => !x.sp.classes.length).map((x) => x.sp.name);
const rilevati = incantesimi.filter((x) => x.mecc.rilevata);
const nonRilevati = incantesimi.filter((x) => !x.mecc.rilevata);
const ambigui = nonRilevati.filter((x) => !/^nessun dado/.test(x.mecc.note[0]));
const mancanti = incantesimi.filter((x) => !x.sp.castingTime || !x.sp.range || !x.sp.duration || !x.sp.description).map((x) => x.sp.name);
const soloDescr = incantesimi.filter((x) => !nomiInLista.has(x.sp.name)).map((x) => x.sp.name);
const elenco = (a) => (a.length ? a.map((x) => '- ' + x).join('\n') : '- nessuno');
const rapporto = `# Importazione degli incantesimi dall'SRD 5.1 (italiano)

Rapporto generato da \`strumenti/estrai-srd.js\` il ${new Date().toISOString().slice(0, 10)} sul file \`fonti/SRD_CC_v5.1_IT.pdf\`
(testo letto con \`pdftotext -enc UTF-8\`, ordine di lettura). Rilanciare lo strumento rigenera questo file e
\`js/dati/srd-incantesimi.js\`.

## Attribuzione

> ${ATTRIBUZIONE}

## Conteggi

- Incantesimi estratti: **${incantesimi.length}** (intestazioni «Scuola di N° livello» / «Trucchetto di …» trovate: ${inizi.length}).
- Incantesimi nominati nelle liste per classe: ${nomiInLista.size}. Il PDF non ha un indice degli incantesimi: il confronto
  è fatto con le liste per classe${soloDescr.length ? '; quelli descritti ma assenti da tutte le liste sono elencati sotto' : ' e torna'}.

| Livello | Incantesimi |
|---|---|
${Object.keys(perLivello).sort((a, b) => a - b).map((l) => '| ' + (l === '0' ? 'Trucchetti' : l + '°') + ' | ' + perLivello[l] + ' |').join('\n')}

| Scuola | Incantesimi |
|---|---|
${Object.keys(perScuola).sort().map((s) => '| ' + NOMI_SCUOLE[s] + ' | ' + perScuola[s] + ' |').join('\n')}

## Controlli

Senza classe (descritti ma in nessuna lista):
${elenco(senzaClasse)}

Senza scuola: nessuno (la scuola è letta dall'intestazione; un'intestazione non riconosciuta esclude l'incantesimo).

Campi mancanti (tempo di lancio, gittata, durata o descrizione vuoti):
${elenco(mancanti)}

Difetti del PDF corretti dallo strumento:
${elenco(correzioniFatte.concat(componente))}

Intestazioni con campi non leggibili (incantesimi esclusi):
${elenco(anomalie.campi)}

Nomi nelle liste per classe senza descrizione corrispondente:
${elenco(fuoriLista)}

Nomi nelle liste scritti diversamente dalla descrizione (abbinati per somiglianza, al massimo 2 lettere di differenza):
${elenco(approssimati)}

Livello nella lista diverso da quello della descrizione:
${elenco(livelliDiversi)}

Id ripetuti:
${elenco(idDoppi)}

Nomi troppo lunghi per la libreria:
${elenco(anomalie.lunghi)}

## Meccanica

Rilevata (da verificare nella coda «Da verificare»): **${rilevati.length}**. Non rilevata: **${nonRilevati.length}**, di cui
${ambigui.length} ambigui (lasciati senza tiro automatico) e ${nonRilevati.length - ambigui.length} senza dadi, attacchi o tiri salvezza.

### Rilevata

${rilevati.map((x) => '- ' + x.sp.name + ': ' + x.mecc.note.join('; ')).join('\n')}

### Ambigua (nessun tiro automatico)

${elenco(ambigui.map((x) => x.sp.name + ': ' + x.mecc.note.join('; ')))}

### Senza meccanica nel testo

${nonRilevati.filter((x) => !ambigui.includes(x)).map((x) => x.sp.name).join(', ') || 'nessuno'}

## Testi forse spezzati dall'estrazione

Righe unite perché la seguente iniziava con la minuscola o la precedente finiva con una virgola (a capo di pagina o di
colonna), e paragrafi che finiscono senza punto (tabelle, elenchi o un a capo non riconosciuto). Le tabelle interne
agli incantesimi (es. Confusione, Muro prismatico, Spruzzo prismatico) restano righe di testo semplice.

${elenco(anomalie.spezzati)}
`;
fs.writeFileSync(USCITA_RAPPORTO, rapporto);
console.log(incantesimi.length + ' incantesimi; rilevati ' + rilevati.length + ', non rilevati ' + nonRilevati.length +
  '; senza classe ' + senzaClasse.length + '; fuori lista ' + fuoriLista.length + '; approssimati ' + approssimati.length +
  '; livelli diversi ' + livelliDiversi.length + '; id doppi ' + idDoppi.length + '; spezzati ' + anomalie.spezzati.length);
