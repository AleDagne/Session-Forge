// Segnalazione manuale e collegamento WebRTC. Il master «ospita» e ottiene un codice di invito; il giocatore lo
// incolla in «Unisciti» e ottiene un codice di risposta, che il master incolla. Nessun server: solo i server STUN
// (pubblici di Google di base, modificabili nelle impostazioni Online). Un servizio di segnalazione automatico
// futuro potrà offrire la stessa interfaccia (ospita / unisciti) di `manuale`.
// Contiene anche le funzioni della pagina «Test connessione» (requisiti e candidati di rete).
(function (DnD) {
  'use strict';

  const STUN_PREDEFINITI = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
  const RACCOLTA_MS = 8000;      // attesa massima della raccolta dei candidati
  const APERTURA_MS = 25000;     // master: attesa dell'apertura dopo aver incollato la risposta
  const CHIAVE_STUN = 'dnd-battaglie:online-stun';
  const K = () => DnD.rete.codici;

  // Server STUN: impostazione locale (un indirizzo per riga), vuota = predefiniti.
  function stun() {
    try {
      const v = JSON.parse(localStorage.getItem(CHIAVE_STUN) || 'null');
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && /^stuns?:/.test(x)).slice(0, 5);
    } catch (e) { /* predefiniti */ }
    return STUN_PREDEFINITI.slice();
  }
  function salvaStun(list) {
    const v = (list || []).map((x) => x.trim()).filter((x) => /^stuns?:\S+$/.test(x)).slice(0, 5);
    try { localStorage.setItem(CHIAVE_STUN, JSON.stringify(v.length ? v : null)); } catch (e) { /* non essenziale */ }
    return v.length ? v : STUN_PREDEFINITI.slice();
  }
  const configurazione = (urls) => ({ iceServers: (urls || stun()).length ? [{ urls: urls || stun() }] : [] });

  // ---------- Funzioni pure ----------
  // Candidati di rete in una descrizione SDP: { locali, stun, relay, mdns, totale }.
  function candidati(sdp) {
    const out = { locali: 0, stun: 0, relay: 0, mdns: 0, totale: 0 };
    for (const riga of String(sdp || '').split(/\r?\n/)) {
      const m = /^a=candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/.exec(riga.trim());
      if (!m) continue;
      out.totale++;
      if (m[2] === 'host') { out.locali++; if (/\.local$/.test(m[1])) out.mdns++; }
      else if (m[2] === 'srflx' || m[2] === 'prflx') out.stun++;
      else if (m[2] === 'relay') out.relay++;
    }
    return out;
  }
  // Giudizio sul collegamento diretto dai candidati trovati.
  function giudizio(c) {
    if (!c.totale) return { livello: 'rosso', testo: 'Nessun candidato di rete: il collegamento non è possibile da questo browser o da questa rete.' };
    if (c.stun) return { livello: 'verde', testo: 'Indirizzo pubblico trovato tramite STUN: il collegamento diretto è probabile (salvo reti che bloccano il traffico UDP o NAT molto restrittivi).' };
    return { livello: 'giallo', testo: 'Solo indirizzi locali: il collegamento funziona nella stessa rete (stessa casa, stesso Wi-Fi), difficilmente tra reti diverse. STUN potrebbe essere bloccato dalla rete.' };
  }
  // Requisiti del browser e della pagina. env: { isSecureContext, protocol, RTCPeerConnection, CompressionStream, clipboard, indexedDB }.
  function requisiti(env) {
    const r = [];
    const voce = (id, ok, nome, nota) => r.push({ id, ok: Boolean(ok), nome, nota });
    voce('sicuro', env.isSecureContext, 'Contesto sicuro (https o localhost)', env.isSecureContext ? '' : env.protocol === 'file:' ? 'Aperta da file: appunti e service worker non funzionano. Servi la pagina in locale (python -m http.server) o pubblicala su un sito statico gratuito.' : 'La pagina non è servita in https: alcuni browser limitano appunti e WebRTC.');
    voce('webrtc', env.RTCPeerConnection, 'WebRTC (RTCPeerConnection)', env.RTCPeerConnection ? '' : 'Questo browser non supporta WebRTC: il gioco online non è disponibile. Ripiego: condividi lo schermo.');
    voce('compressione', env.CompressionStream, 'Compressione dei codici (CompressionStream)', env.CompressionStream ? '' : 'Codici più lunghi, senza compressione: funzionano lo stesso. Chi ospita spunti «Codici senza compressione».');
    voce('appunti', env.clipboard, 'Accesso agli appunti', env.clipboard ? '' : 'Il pulsante «Copia» usa il ripiego: seleziona il codice e copialo con Ctrl+C.');
    voce('indexeddb', env.indexedDB, 'IndexedDB (cache delle immagini)', env.indexedDB ? '' : 'Le immagini della mappa non si possono conservare: la mappa compare senza sfondo e tile.');
    return r;
  }
  const ambiente = () => ({
    isSecureContext: Boolean(globalThis.isSecureContext), protocol: globalThis.location ? location.protocol : '',
    RTCPeerConnection: typeof RTCPeerConnection === 'function', CompressionStream: K().comprimibile(),
    clipboard: Boolean(globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText && globalThis.isSecureContext), indexedDB: typeof indexedDB !== 'undefined',
  });

  // ---------- WebRTC ----------
  // Attende la fine della raccolta dei candidati (tutti nel codice: niente scambi successivi).
  function raccogli(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const fatto = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', fatto); resolve(); } };
      pc.addEventListener('icegatheringstatechange', fatto);
      setTimeout(resolve, RACCOLTA_MS);
    });
  }
  // Canale aperto -> trasporto; errore in italiano dopo «attesa» ms o se la connessione fallisce (e la si chiude).
  // Il giocatore aspetta finché vale il codice: il master può metterci minuti a incollare la risposta.
  function apertura(pc, canalePromessa, opts, attesa) {
    return new Promise((resolve, reject) => {
      const fallito = (testo) => { try { pc.close(); } catch (e) { /* già chiusa */ } reject(new Error(testo)); };
      const bloccato = () => fallito('Collegamento non riuscito: probabilmente la rete (o un firewall aziendale) blocca il collegamento diretto. Riprovate da un\'altra rete o usate la condivisione dello schermo.');
      const timer = setTimeout(() => (attesa > APERTURA_MS ? fallito('Il master non ha usato la risposta in tempo (i codici valgono ' + K().DURATA / 60000 + ' minuti): ricominciate con un nuovo invito.') : bloccato()), attesa || APERTURA_MS);
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') { clearTimeout(timer); bloccato(); } });
      canalePromessa.then((canale) => {
        const t = DnD.rete.trasporto.daCanale(pc, canale, opts);
        if (t.connesso()) { clearTimeout(timer); resolve(t); return; }
        t.suStato((s) => { if (s === 'aperto') { clearTimeout(timer); resolve(t); } });
      });
    });
  }

  const manuale = {
    // Master: crea l'offerta. Restituisce { codice, accetta(codiceRisposta) -> Promise<trasporto>, annulla() }.
    // opts: { nome, comprimi, stun, maxRicevuto, registro }
    async ospita(opts) {
      const o = opts || {};
      const pc = new RTCPeerConnection(configurazione(o.stun));
      const canale = pc.createDataChannel('session-forge', { ordered: true });
      await pc.setLocalDescription(await pc.createOffer());
      await raccogli(pc);
      const inv = K().invito(pc.localDescription.sdp, o.nome, Date.now());
      const codice = await K().codifica(inv, { comprimi: o.comprimi });
      const reg = o.registro || K().registro();
      return {
        codice, id: inv.id, candidati: candidati(pc.localDescription.sdp),
        async accetta(codiceRisposta) {
          const r = await K().decodifica(codiceRisposta);
          K().verifica(r, 'risposta', Date.now());
          if (r.invito !== inv.id) throw new Error('Questo codice di risposta appartiene a un altro invito: usa la risposta all\'invito mostrato qui.');
          reg.usa(r.id);
          reg.usa(inv.id);
          await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
          return apertura(pc, Promise.resolve(canale), { maxRicevuto: o.maxRicevuto });
        },
        annulla: () => { try { pc.close(); } catch (e) { /* già chiusa */ } },
      };
    },
    // Giocatore: legge l'invito e crea la risposta. Restituisce { codice, master, connessione: Promise<trasporto>, annulla() }.
    async unisciti(codiceInvito, opts) {
      const o = opts || {};
      const inv = await K().decodifica(codiceInvito);
      K().verifica(inv, 'invito', Date.now());
      if (o.registro) o.registro.usa(inv.id);
      const pc = new RTCPeerConnection(configurazione(o.stun));
      const canale = new Promise((resolve) => { pc.addEventListener('datachannel', (e) => resolve(e.channel)); });
      await pc.setRemoteDescription({ type: 'offer', sdp: inv.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await raccogli(pc);
      const codice = await K().codifica(K().risposta(pc.localDescription.sdp, inv.id, Date.now()), { comprimi: o.comprimi });
      return {
        codice, master: inv.master, candidati: candidati(pc.localDescription.sdp),
        connessione: apertura(pc, canale, { maxRicevuto: o.maxRicevuto }, Math.max(APERTURA_MS, inv.scade - Date.now() + APERTURA_MS)),
        annulla: () => { try { pc.close(); } catch (e) { /* già chiusa */ } },
      };
    },
  };

  // Test connessione: raccoglie i candidati di questo browser con una connessione di prova.
  async function provaCandidati(urls) {
    const pc = new RTCPeerConnection(configurazione(urls));
    try {
      pc.createDataChannel('prova');
      await pc.setLocalDescription(await pc.createOffer());
      await raccogli(pc);
      return candidati(pc.localDescription.sdp);
    } finally {
      pc.close();
    }
  }

  DnD.rete = DnD.rete || {};
  DnD.rete.segnalazione = { STUN_PREDEFINITI, stun, salvaStun, configurazione, candidati, giudizio, requisiti, ambiente, manuale, provaCandidati };
})(globalThis.DnD = globalThis.DnD || {});
