// Configurazione dell'app: nome (modificabile qui, in un solo punto) e voci del menù laterale.
(function (DnD) {
  'use strict';

  const APP_NAME = 'Session Forge';

  // Gruppi solo grafici: l'ordine delle voci resta quello di MENU.
  const GROUPS = { gioco: 'Gioco', mappa: 'Mappa', personaggi: 'Personaggi', libreria: 'Libreria', strumenti: 'Strumenti' };

  // Icone SVG 24×24 a tratto (stroke = currentColor): un elenco di path "d".
  // key = tasto della scorciatoia Alt+key: fisso per ogni voce (Mondo, aggiunta dopo, ha Alt+0; Scene, in cima, Alt+S:
  // nessuna delle altre si sposta).
  const MENU = [
    { id: 'scene', key: 'S', label: 'Scene', group: 'gioco', icon: ['M4 5h16v14H4z', 'M4 9h16', 'M8 5l2 4', 'M13 5l2 4', 'M10 13l5 2.5-5 2.5z'] },
    { id: 'editor', key: '1', label: 'Editor griglie', group: 'mappa', icon: ['M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z', 'M9 3v15', 'M15 6v15'] },
    { id: 'combattimento', key: '2', label: 'Combattimento', group: 'mappa', icon: ['M4 4l11 11', 'M20 4L9 15', 'M4 4h4', 'M4 4v4', 'M20 4h-4', 'M20 4v4', 'M13 17l4 4', 'M11 17l-4 4', 'M15 19l2-2', 'M9 19l-2-2'] },
    { id: 'esplorazione', key: '3', label: 'Esplorazione', group: 'mappa', icon: ['M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'] },
    { id: 'mondo', key: '0', label: 'Mondo', group: 'mappa', icon: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9', 'M12 3c-2.5 2.7-3.8 5.7-3.8 9s1.3 6.3 3.8 9'] },
    { id: 'nemici', key: '4', label: 'Nemici', group: 'personaggi', icon: ['M12 3c-4.4 0-8 3.1-8 7 0 2.4 1.3 4.5 3.3 5.7V19h9.4v-3.3c2-1.2 3.3-3.3 3.3-5.7 0-3.9-3.6-7-8-7z', 'M9 10.5h.01', 'M15 10.5h.01', 'M10 19v2', 'M14 19v2'] },
    { id: 'giocatori', key: '5', label: 'Giocatori', group: 'personaggi', icon: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'] },
    { id: 'magie', key: '6', label: 'Magie', group: 'libreria', icon: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z'] },
    { id: 'asset', key: '7', label: 'Asset', group: 'libreria', icon: ['M3 5h18v14H3z', 'M3 9.7h18', 'M3 14.3h18', 'M9 5v4.7', 'M15 5v4.7', 'M6 9.7v4.6', 'M12 9.7v4.6', 'M18 9.7v4.6', 'M9 14.3V19', 'M15 14.3V19'] },
    { id: 'razze', key: '8', label: 'Razze', group: 'libreria', icon: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-7 8-7s8 3 8 7'] },
    { id: 'dadi', key: '9', label: 'Dadi', group: 'strumenti', icon: ['M12 2l9 5v10l-9 5-9-5V7z', 'M12 7l5 8H7z', 'M3 7l4 8', 'M21 7l-4 8', 'M12 2v5', 'M7 15l-4 2', 'M17 15l4 2', 'M7 15l5 7 5-7'] },
  ];

  // Icone dell'interfaccia (impostazioni, tema, sessione).
  const ICONS = {
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
    moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
    book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z', 'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5'],
  };

  DnD.config = { APP_NAME, GROUPS, MENU, ICONS, SECTIONS: MENU.map((m) => m.id) };
})(globalThis.DnD = globalThis.DnD || {});
