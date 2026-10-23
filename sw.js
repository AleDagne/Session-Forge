// Service worker minimale: mette in cache i file dell'app per l'uso offline.
// Aumenta CACHE quando modifichi i file, così i client scaricano la nuova versione.
const CACHE = 'session-forge-v28';
const FILES = [
  './', './index.html', './manifest.json', './css/style.css', './css/boss.css', './css/leggendario.css', './css/dadi.css', './icons/icon.svg', './js/impostazioni.js',
  './js/config.js', './js/dadi.js', './js/regole.js', './js/classi.js', './js/magie.js', './js/equipaggiamento.js', './js/nomi.js', './js/colori.js',
  './js/libreria-icone.js', './js/icone.js', './js/immagini.js', './js/suoni-dati.js', './js/audio.js', './js/tileset.js', './js/tile.js', './js/tilemap.js', './js/collisioni.js',
  './js/griglia.js', './js/condizioni.js', './js/riposi-dati.js', './js/riposi.js', './js/movimento.js', './js/layout-combattimento.js', './js/creature-dati.js', './js/creature.js', './js/boss.js', './js/biomi.js', './js/eventi.js',
  './js/esplorazione.js', './js/percorso.js', './js/leggendario.js', './js/attrezzatura.js', './js/oggetti-mappa.js', './js/mondo-dati.js', './js/fazioni.js', './js/party.js', './js/citta.js', './js/npc.js', './js/quest.js', './js/ia-dati.js',
  './js/ia.js', './js/note.js', './js/validazione.js', './js/dati.js', './js/sessioni.js', './js/generatore.js', './js/ui-comune.js', './js/ui-condizioni.js', './js/ui-riposi.js',
  './js/ui-icone.js', './js/ui-razze.js', './js/ui-magie.js', './js/ui-incantesimi.js', './js/ui-asset.js', './js/ui-oggetti-mappa.js',
  './js/ui-ia.js', './js/ui-creature.js', './js/ui-mostri.js', './js/ui-boss.js', './js/ui-percorso.js', './js/ui-leggendario.js',
  './js/ui-generatore.js', './js/ui-tileset.js', './js/ui-tile.js', './js/ui-strutture.js', './js/ui-attrezzatura.js', './js/ui-biomi.js',
  './js/ui-eventi.js', './js/ui-mondo.js', './js/ui-party.js', './js/ui-npc.js', './js/ui-quest.js', './js/note-editor.js', './js/ui-note.js', './js/ui-dadi.js', './js/ui-griglia.js', './js/ui-pannello-tile.js',
  './js/ui-mappa-esplorazione.js', './js/ui-editor-griglie.js', './js/ui-combattimento.js', './js/ui-esplorazione.js', './js/ui-sessioni.js',
  './js/ui-suoni.js', './js/ui-impostazioni.js', './js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Rete prima (così gli aggiornamenti arrivano subito), cache se offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request)
    .then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, copy));
      return res;
    })
    .catch(() => caches.match(event.request, { ignoreSearch: true })));
});
