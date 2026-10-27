// Libreria di icone predefinite (dati): silhouette SVG semplici e ORIGINALI, disegnate per questa app
// (nessun file esterno, nessun personaggio o mostro di opere protette: solo versioni generiche).
// Ogni icona è il contenuto di un <svg viewBox="0 0 64 64">: {c} = colore scelto, {d} = dettagli scuri,
// {l} = dettagli chiari. Pedine: palette di 14 colori (dati/colori.js), {c} diventa currentColor. Oggetti: colore libero.
// Il quinto campo facoltativo delle creature è la dimensione suggerita sulla griglia (lato in celle).
// Livello dati. Espone DnD.libreriaIcone; nessuna dipendenza. Non deve toccare DOM, disco o rete.
(function (DnD) {
  'use strict';

  const D = '{d}';
  const L = '{l}';
  const p = (d, f) => '<path d="' + d + '" fill="' + (f || '{c}') + '"/>';
  const s = (d, w, f) => '<path d="' + d + '" fill="none" stroke="' + (f || '{c}') + '" stroke-width="' + (w || 3) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  const c = (cx, cy, r, f) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + (f || '{c}') + '"/>';
  const e = (cx, cy, rx, ry, f) => '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + (f || '{c}') + '"/>';
  const r = (x, y, w, h, f, rr) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rr || 0) + '" fill="' + (f || '{c}') + '"/>';

  // Pezzi comuni delle figure umanoidi.
  const torso = p('M19 60 L21 34 Q32 27 43 34 L45 60 Z');
  const eyes = (y, x1, x2) => c(x1 || 29, y, 1.6, D) + c(x2 || 35, y, 1.6, D);

  const CREATURE_CATEGORIES = {
    umanoidi: 'Umanoidi', bestie: 'Bestie', mostri: 'Mostri', draghi: 'Draghi', dinosauri: 'Dinosauri',
    demoni: 'Demoni', aberrazioni: 'Aberrazioni', elementali: 'Elementali',
  };
  const ITEM_CATEGORIES = { oggetti: 'Oggetti' };

  const CREATURES = [
    // ---------- Umanoidi ----------
    ['guerriero', 'Guerriero', 'umanoidi', torso + c(32, 17, 8) + p('M23 15 Q32 3 41 15 L41 18 L23 18 Z', D) + r(30.5, 13, 3, 8, D) +
      p('M8 30 L16 28 L19 44 Q13 50 8 44 Z') + p('M47 8 L50 6 L52 9 L49 36 L46 36 Z', L) + r(43, 35, 10, 3)],
    ['mago', 'Mago', 'umanoidi', p('M18 60 L25 32 L39 32 L46 60 Z') + c(32, 25, 7) + p('M20 22 L32 2 L44 22 Z') + e(32, 22, 14, 3) +
      eyes(26) + s('M50 60 L50 16', 3) + c(50, 13, 5, L)],
    ['ladro', 'Ladro', 'umanoidi', p('M14 60 Q16 34 32 30 Q48 34 50 60 Z') + p('M20 26 Q20 6 32 6 Q44 6 44 26 Q32 32 20 26 Z') +
      e(32, 20, 7, 6, D) + c(29, 20, 1.4, L) + c(35, 20, 1.4, L) + p('M50 30 L54 26 L56 28 L52 32 L46 46 L44 44 Z', L)],
    ['chierico', 'Chierico', 'umanoidi', p('M17 60 L22 32 Q32 26 42 32 L47 60 Z') + c(32, 18, 8) + eyes(18) +
      c(32, 44, 6, L) + c(32, 44, 3, '{c}') + s('M12 58 L12 34', 3) + c(12, 30, 5)],
    ['arciere', 'Arciere', 'umanoidi', torso + c(32, 17, 8) + eyes(17) + s('M50 8 Q62 32 50 56', 3) + s('M50 8 L50 56', 1, L) +
      s('M24 32 L54 32', 2, L) + p('M54 29 L60 32 L54 35 Z', L)],
    ['bardo', 'Bardo', 'umanoidi', torso + c(32, 17, 8) + p('M24 12 Q32 4 42 10 L46 8 L44 14 L24 14 Z', D) + eyes(18) +
      e(24, 46, 8, 7, L) + c(24, 46, 2.5, D) + p('M28 40 L44 26 L46 28 L31 42 Z', L)],
    ['elfo', 'Elfo', 'umanoidi', p('M22 60 L24 34 Q32 28 40 34 L42 60 Z') + c(32, 18, 8) + p('M24 18 L13 9 L25 14 Z') + p('M40 18 L51 9 L39 14 Z') +
      p('M24 14 Q32 6 40 14 L40 12 Q32 2 24 12 Z', D) + eyes(19)],
    ['nano', 'Nano', 'umanoidi', p('M13 60 L16 38 Q32 30 48 38 L51 60 Z') + c(32, 24, 9) + p('M22 21 Q32 9 42 21 Z', D) + r(20, 20, 24, 3, D) +
      p('M23 27 Q32 52 41 27 Q32 33 23 27 Z', L) + eyes(25)],
    ['halfling', 'Halfling', 'umanoidi', p('M22 52 L24 36 Q32 31 40 36 L42 52 Z') + c(32, 26, 8) + c(26, 20, 3) + c(30, 18, 3) + c(35, 18, 3) + c(39, 21, 3) +
      eyes(27) + e(24, 58, 6, 3) + e(40, 58, 6, 3) + r(25, 50, 4, 7) + r(35, 50, 4, 7)],
    ['orco', 'Orco', 'umanoidi', p('M10 60 L14 34 Q32 24 50 34 L54 60 Z') + c(32, 20, 11) + p('M24 26 L26 20 L28 26 Z', L) + p('M36 26 L38 20 L40 26 Z', L) +
      c(27, 17, 1.8, D) + c(37, 17, 1.8, D) + p('M25 13 L39 13 L37 15 L27 15 Z', D)],
    ['goblin', 'Goblin', 'umanoidi', p('M23 60 L25 40 Q32 35 39 40 L41 60 Z') + c(32, 28, 9) + p('M24 26 L6 18 L24 32 Z') + p('M40 26 L58 18 L40 32 Z') +
      c(28, 27, 2, D) + c(36, 27, 2, D) + p('M27 33 L37 33 L32 36 Z', D)],
    ['umano', 'Umano', 'umanoidi', torso + c(32, 17, 9) + p('M23 15 Q32 4 41 15 Q32 10 23 15 Z', D) + eyes(18) + s('M29 22 Q32 24 35 22', 1.5, D)],
    ['druido', 'Druido', 'umanoidi', p('M16 60 L22 32 Q32 26 42 32 L48 60 Z') + c(32, 19, 8) + p('M22 14 L16 4 L22 8 L24 2 L27 10 Z') + p('M42 14 L48 4 L42 8 L40 2 L37 10 Z') +
      eyes(19) + s('M52 60 L52 18', 3) + p('M52 18 Q44 12 50 6 Q58 10 52 18 Z', L)],
    ['barbaro', 'Barbaro', 'umanoidi', p('M14 60 L16 32 Q32 24 48 32 L50 60 Z') + c(32, 18, 8) + p('M24 14 Q16 10 14 2 Q20 10 26 11 Z', L) + p('M40 14 Q48 10 50 2 Q44 10 38 11 Z', L) +
      eyes(19) + s('M10 58 L10 22', 3) + p('M10 20 Q0 26 2 36 L10 32 Z', L)],
    ['cavaliere', 'Cavaliere', 'umanoidi', torso + p('M23 26 L23 14 Q32 4 41 14 L41 26 Z') + r(26, 15, 12, 2.5, D) + p('M32 6 Q38 0 44 4 Q38 6 34 10 Z', L) +
      s('M8 60 L56 4', 3, L) + p('M14 30 L24 30 L23 46 Q19 50 15 46 Z', D)],

    // ---------- Bestie ----------
    ['lupo', 'Lupo', 'bestie', p('M6 40 L14 30 L18 20 L22 28 L30 30 L48 28 Q58 30 60 40 L56 42 L52 54 L48 54 L48 44 L28 44 L26 54 L22 54 L20 44 L14 44 Z') +
      c(17, 33, 1.5, D) + p('M6 40 L4 44 L10 44 Z')],
    ['orso', 'Orso', 'bestie', p('M8 50 Q6 32 20 28 Q22 20 28 22 Q34 18 44 26 Q58 28 58 44 L58 54 L50 54 L50 46 L22 46 L22 54 L14 54 L14 50 Z') +
      c(21, 23, 4) + c(25, 33, 1.6, D) + e(14, 36, 4, 3, D)],
    ['ragno', 'Ragno', 'bestie', s('M28 30 L14 18 L6 24', 2.5) + s('M28 34 L10 30 L4 36', 2.5) + s('M28 38 L12 42 L6 50', 2.5) + s('M29 41 L18 52 L16 60', 2.5) +
      s('M36 30 L50 18 L58 24', 2.5) + s('M36 34 L54 30 L60 36', 2.5) + s('M36 38 L52 42 L58 50', 2.5) + s('M35 41 L46 52 L48 60', 2.5) +
      e(32, 42, 9, 10) + c(32, 28, 6) + c(30, 27, 1.2, L) + c(34, 27, 1.2, L)],
    ['serpente', 'Serpente', 'bestie', s('M12 52 Q4 40 16 36 Q30 32 26 24 Q22 14 34 12 Q44 10 46 18', 7) + e(48, 18, 7, 5) + c(50, 16, 1.4, D) +
      s('M55 19 L60 21 M58 20 L61 17', 1.5) + s('M12 52 Q24 60 40 54', 6)],
    ['ratto', 'Ratto', 'bestie', e(30, 40, 16, 10) + p('M12 36 L4 40 L12 44 Z') + c(16, 32, 4) + c(10, 39, 1.4, D) + c(4, 40, 1.4, D) +
      s('M46 42 Q58 46 56 56 Q54 62 46 58', 2.5) + r(20, 48, 3, 6) + r(36, 48, 3, 6)],
    ['pipistrello', 'Pipistrello', 'bestie', p('M32 24 Q22 16 4 18 Q10 26 8 32 Q16 28 18 36 Q24 30 28 36 L32 44 L36 36 Q40 30 46 36 Q48 28 56 32 Q54 26 60 18 Q42 16 32 24 Z') +
      e(32, 32, 5, 8) + p('M28 22 L29 16 L32 22 Z') + p('M36 22 L35 16 L32 22 Z') + c(30, 28, 1.2, L) + c(34, 28, 1.2, L)],
    ['cavallo', 'Cavallo', 'bestie', p('M20 60 L22 40 Q18 30 24 20 L22 10 L28 16 Q36 12 44 22 L54 34 Q56 40 50 40 L42 34 L38 36 L40 60 Z') +
      p('M24 20 Q20 34 26 40 L22 40 Q16 30 20 20 Z', D) + c(37, 22, 1.8, D) + c(51, 36, 1.2, D)],
    ['cinghiale', 'Cinghiale', 'bestie', p('M8 44 Q8 30 22 28 L26 22 L30 28 L46 28 Q58 30 58 42 L56 54 L50 54 L50 46 L24 46 L22 54 L16 54 L14 46 Z') +
      p('M8 44 L4 46 L8 48 Z') + p('M12 42 Q8 34 14 34 Q12 38 14 42 Z', L) + c(18, 35, 1.5, D) + s('M24 28 L28 22 L32 28 L36 22 L40 28', 2, D)],
    ['aquila', 'Aquila', 'bestie', p('M32 22 Q20 14 2 16 Q10 22 12 28 Q20 26 24 32 L28 44 L24 56 L32 52 L40 56 L36 44 L40 32 Q44 26 52 28 Q54 22 62 16 Q44 14 32 22 Z') +
      c(32, 20, 5) + p('M34 20 L40 22 L34 24 Z', L) + c(31, 19, 1.2, D)],
    ['pantera', 'Felino selvatico', 'bestie', p('M6 42 Q6 30 16 30 L18 24 L22 30 L44 30 Q54 32 54 40 L52 54 L48 54 L48 44 L22 44 L20 54 L16 54 L14 44 Z') +
      s('M54 38 Q62 30 58 20', 3) + p('M10 28 L12 22 L16 28 Z') + c(14, 34, 1.4, L)],
    ['scorpione', 'Scorpione', 'bestie', e(32, 44, 10, 7) + s('M38 40 Q50 36 50 24 Q50 12 40 12', 5) + p('M38 8 L44 12 L38 16 Z', L) +
      s('M24 40 L14 34 L10 26', 3) + p('M6 22 L14 24 L10 30 Z') + s('M40 46 L54 50', 2.5) + s('M24 46 L10 50', 2.5) + s('M28 50 L22 58', 2.5) + s('M36 50 L42 58', 2.5)],

    // ---------- Mostri ----------
    ['drago', 'Drago', 'draghi', p('M30 30 Q20 12 4 10 Q12 18 10 26 Q18 24 22 32 Z') + p('M36 30 Q46 12 62 10 Q54 18 56 26 Q48 24 44 32 Z') +
      e(33, 38, 10, 8) + p('M30 30 Q26 18 32 12 L34 6 L36 12 Q40 18 36 30 Z') + p('M32 6 L26 2 L31 8 Z') + c(33, 10, 1.3, L) +
      s('M40 44 Q52 52 58 46 Q60 44 62 48', 4) + r(26, 44, 4, 10) + r(36, 44, 4, 10)],
    ['scheletro', 'Scheletro', 'mostri', c(32, 14, 9) + r(27, 20, 10, 6) + c(28, 13, 2.6, D) + c(36, 13, 2.6, D) + p('M31 17 L33 17 L32 20 Z', D) +
      s('M32 26 L32 50', 3) + s('M22 30 Q32 26 42 30 M22 36 Q32 32 42 36 M24 42 Q32 38 40 42', 2.5) + s('M22 30 L14 44 M42 30 L50 44', 2.5) +
      s('M28 50 L24 62 M36 50 L40 62', 3)],
    ['zombie', 'Non morto barcollante', 'mostri', p('M20 60 L22 34 Q30 28 40 32 L42 60 Z') + c(30, 20, 8) + p('M38 34 L58 30 L58 35 L40 40 Z') + p('M36 40 L56 40 L56 45 L38 46 Z') +
      c(27, 19, 1.8, D) + c(33, 20, 1.4, D) + s('M26 25 L34 25', 1.5, D)],
    ['fantasma', 'Fantasma', 'mostri', p('M14 60 L14 28 Q14 6 32 6 Q50 6 50 28 L50 60 L44 54 L38 60 L32 54 L26 60 L20 54 Z') +
      e(25, 24, 3.5, 5, D) + e(39, 24, 3.5, 5, D) + e(32, 38, 4, 5, D)],
    ['demone', 'Demone', 'demoni', p('M24 32 Q12 22 2 26 Q8 32 8 40 Q16 34 22 42 Z') + p('M40 32 Q52 22 62 26 Q56 32 56 40 Q48 34 42 42 Z') +
      p('M20 60 L22 32 Q32 26 42 32 L44 60 Z') + c(32, 18, 8) + p('M25 13 Q20 6 22 0 Q26 8 28 11 Z') + p('M39 13 Q44 6 42 0 Q38 8 36 11 Z') +
      p('M27 17 L30 18 L27 19 Z', L) + p('M37 17 L34 18 L37 19 Z', L) + s('M42 56 Q54 60 56 50 L60 48', 2.5)],
    ['golem', 'Golem', 'mostri', r(18, 22, 28, 26, '{c}', 3) + r(24, 6, 16, 14, '{c}', 2) + r(8, 24, 9, 22, '{c}', 2) + r(47, 24, 9, 22, '{c}', 2) +
      r(20, 49, 10, 13, '{c}', 2) + r(34, 49, 10, 13, '{c}', 2) + r(27, 11, 4, 3, L) + r(33, 11, 4, 3, L) + s('M22 30 L30 36 M40 28 L36 40', 1.5, D)],
    ['troll', 'Troll', 'mostri', p('M18 60 L20 38 Q24 24 34 24 Q44 26 44 38 L46 60 Z') + c(34, 16, 8) + p('M38 18 L48 20 L40 22 Z') +
      p('M22 30 Q10 40 8 56 L13 56 Q16 44 24 38 Z') + p('M44 30 Q54 42 56 58 L51 58 Q48 46 42 38 Z') + c(32, 14, 1.6, D) + c(38, 14, 1.6, D)],
    ['ogre', 'Ogre', 'mostri', e(30, 42, 16, 15) + c(30, 16, 10) + c(26, 14, 2, D) + c(34, 14, 2, D) + p('M24 21 L36 21 L33 24 L27 24 Z', D) +
      p('M46 34 L60 12 L64 14 L50 38 Z', L) + r(20, 54, 7, 9) + r(33, 54, 7, 9)],
    ['tentacoli', 'Mostro con tentacoli', 'aberrazioni', e(32, 22, 16, 14) + c(26, 20, 3, L) + c(38, 20, 3, L) + c(26, 20, 1.4, D) + c(38, 20, 1.4, D) +
      s('M20 32 Q10 44 18 52 Q22 56 16 60', 4) + s('M27 35 Q24 48 30 54 Q34 58 28 62', 4) + s('M37 35 Q40 48 34 54', 4) + s('M44 32 Q56 42 48 52 Q44 56 50 60', 4)],
    ['occhio', 'Occhio fluttuante', 'aberrazioni', p('M12 30 Q2 22 4 14 Q12 22 18 24 Z') + p('M52 30 Q62 22 60 14 Q52 22 46 24 Z') + c(32, 32, 16) +
      e(32, 32, 10, 8, L) + c(32, 32, 5, D) + c(30, 30, 1.6, L) + s('M22 50 Q32 56 42 50', 2.5)],
    ['melma', 'Melma', 'aberrazioni', p('M4 58 Q4 44 14 42 Q14 26 30 24 Q48 22 50 38 Q60 38 60 50 Q62 58 56 58 Z') +
      c(26, 38, 3, L) + c(38, 36, 2, L) + c(46, 48, 2.5, L) + c(20, 50, 2, L) + c(30, 40, 1.4, D) + c(40, 38, 1.4, D)],
    ['elementale', 'Elementale', 'elementali', p('M32 60 Q16 54 18 40 Q20 30 14 22 Q24 26 26 18 Q28 8 32 2 Q36 10 38 18 Q42 26 50 22 Q44 30 46 40 Q48 54 32 60 Z') +
      p('M32 52 Q24 48 26 40 Q28 34 32 28 Q36 34 38 40 Q40 48 32 52 Z', L) + c(28, 30, 1.6, D) + c(36, 30, 1.6, D)],
    ['vampiro', 'Vampiro', 'mostri', p('M8 60 Q14 30 24 28 L32 36 L40 28 Q50 30 56 60 L44 54 L32 60 L20 54 Z') + c(32, 18, 8) +
      p('M24 14 Q32 6 40 14 L32 12 Z', D) + c(29, 18, 1.4, D) + c(35, 18, 1.4, D) + p('M29 22 L30 26 L31 22 Z', L) + p('M33 22 L34 26 L35 22 Z', L) +
      p('M20 28 L16 18 L26 26 Z') + p('M44 28 L48 18 L38 26 Z')],
    ['lupo-mannaro', 'Licantropo', 'mostri', p('M16 60 L18 34 Q32 26 46 34 L48 60 Z') + p('M24 26 L20 10 L28 18 L36 18 L44 10 L40 26 L46 30 L32 34 L18 30 Z') +
      p('M28 28 L32 36 L36 28 Z', D) + c(28, 22, 1.4, L) + c(36, 22, 1.4, L) + p('M16 40 L8 52 L12 54 L20 46 Z') + p('M48 40 L56 52 L52 54 L44 46 Z')],
    ['gargoyle', 'Statua alata', 'mostri', p('M24 30 Q10 14 2 18 Q6 26 4 34 Q14 30 20 38 Z') + p('M40 30 Q54 14 62 18 Q58 26 60 34 Q50 30 44 38 Z') +
      p('M20 60 L20 44 Q18 32 32 30 Q46 32 44 44 L44 60 L36 54 L28 54 Z') + c(32, 22, 8) + p('M26 16 L24 8 L29 14 Z') + p('M38 16 L40 8 L35 14 Z') +
      c(29, 22, 1.4, D) + c(35, 22, 1.4, D)],
    ['idra', 'Idra', 'mostri', e(32, 50, 16, 10) + s('M24 44 Q14 30 14 16', 6) + s('M32 42 Q32 26 32 10', 6) + s('M40 44 Q50 30 50 16', 6) +
      e(14, 14, 5, 4) + e(32, 8, 5, 4) + e(50, 14, 5, 4) + c(13, 13, 1, D) + c(31, 7, 1, D) + c(49, 13, 1, D)],

    // ---------- Draghi ----------
    ['drago-volo', 'Drago alato in volo', 'draghi', p('M32 22 Q12 4 2 10 Q10 14 8 22 Q16 20 20 26 Q12 28 12 34 Q22 30 28 34 Z') + p('M32 22 Q52 4 62 10 Q54 14 56 22 Q48 20 44 26 Q52 28 52 34 Q42 30 36 34 Z') +
      e(32, 34, 7, 12) + p('M28 44 Q32 62 40 60 Q34 56 34 44 Z') + p('M27 22 L32 12 L37 22 Z') + p('M28 14 L26 8 L30 12 Z', D) + p('M36 14 L38 8 L34 12 Z', D) + c(30, 18, 1.2, L) + c(34, 18, 1.2, L), 3],
    ['drago-intero', 'Drago a figura intera', 'draghi', p('M10 50 Q8 36 20 34 L24 22 Q22 12 30 8 L38 10 L34 14 L36 18 Q30 20 30 26 L40 32 Q52 30 58 40 L62 52 Q54 46 50 50 L48 58 L42 58 L42 50 L26 50 L26 58 L20 58 L18 52 Z') +
      p('M30 30 Q38 8 54 6 Q50 14 56 18 Q46 18 42 28 Z', D) + c(32, 12, 1.3, L) + p('M36 10 L40 6 L38 11 Z'), 4],
    ['testa-drago', 'Testa di drago', 'draghi', p('M14 50 Q8 34 16 22 Q24 12 36 14 L54 22 Q60 26 58 32 L46 34 L52 40 L40 42 Q34 56 14 50 Z') +
      p('M20 22 L12 4 L26 16 Z') + p('M28 16 L26 2 L34 14 Z') + p('M46 34 L50 37 L46 38 Z', L) + p('M54 27 L58 29', D) + e(34, 24, 3, 2, L) + c(34, 24, 1.2, D) +
      s('M18 34 Q22 40 30 40', 2, D), 2],
    ['viverna', 'Viverna', 'draghi', p('M30 36 Q14 10 2 14 Q8 20 6 28 Q14 26 18 32 Q12 34 14 40 Q22 36 28 40 Z') + p('M30 36 L22 30 L18 22 L22 18 L30 26 L42 30 Q52 32 54 42 L50 52 L44 50 L44 44 L34 44 L32 54 L26 54 L28 44 Z') +
      s('M54 42 Q62 50 56 58 L60 60', 3) + p('M56 58 L62 56 L60 62 Z') + c(20, 20, 1.2, L), 3],
    ['drago-serpentino', 'Drago serpentino', 'draghi', s('M8 54 Q4 40 18 40 Q32 40 28 28 Q24 16 38 14 Q48 12 50 20', 8) + s('M8 54 Q20 62 34 56 Q46 50 56 56', 6) +
      e(52, 18, 8, 6) + p('M50 12 L46 4 L54 10 Z') + p('M56 14 L62 8 L58 16 Z') + c(54, 16, 1.3, L) + s('M60 20 Q64 26 60 30', 1.5) +
      s('M16 40 L14 34 M24 38 L24 32 M30 24 L26 22 M36 14 L34 8', 2, D), 3],
    ['cucciolo-drago', 'Cucciolo di drago', 'draghi', e(32, 44, 13, 11) + c(32, 24, 10) + p('M24 18 L20 8 L28 16 Z') + p('M40 18 L44 8 L36 16 Z') +
      p('M20 40 Q6 30 6 40 Q12 44 20 46 Z') + p('M44 40 Q58 30 58 40 Q52 44 44 46 Z') + e(28, 24, 3, 3.5, L) + e(36, 24, 3, 3.5, L) + c(28, 25, 1.5, D) + c(36, 25, 1.5, D) +
      e(32, 46, 7, 6, L) + s('M44 52 Q56 58 58 50', 3)],

    // ---------- Dinosauri ----------
    ['tirannosauro', 'Tirannosauro', 'dinosauri', p('M4 34 Q16 30 26 32 L34 22 L36 8 Q46 2 58 8 L60 14 L48 16 L58 18 L56 24 L44 24 L42 34 Q44 44 36 48 L38 58 L32 58 L30 50 L24 50 L22 58 L16 58 L18 46 Q12 40 4 34 Z') +
      c(46, 10, 1.4, L) + s('M48 18 L56 20', 1.5, D) + s('M40 30 L46 34', 2.5), 3],
    ['raptor', 'Raptor', 'dinosauri', p('M2 30 Q14 32 22 30 L34 20 L42 12 Q50 8 58 12 L56 16 L46 18 L40 26 Q42 36 36 40 L40 52 L46 56 L36 56 L32 44 L26 44 L22 56 L14 56 L22 50 L20 40 Q12 36 2 30 Z') +
      c(50, 12, 1.2, L) + s('M38 26 L44 30 L46 34', 2) + p('M36 54 L32 58 L36 57 Z', L)],
    ['triceratopo', 'Triceratopo', 'dinosauri', p('M4 38 Q10 26 26 26 L40 24 Q38 10 48 12 Q56 16 54 26 L60 36 L48 38 L44 44 L44 56 L38 56 L36 46 L20 46 L18 56 L12 56 L12 44 Z') +
      p('M42 22 L36 6 L46 18 Z', L) + p('M50 20 L52 4 L54 20 Z', L) + p('M58 32 L64 30 L60 36 Z', L) + c(50, 28, 1.4, D) + s('M42 14 Q36 22 42 30', 2, D), 3],
    ['pterodattilo', 'Pterodattilo', 'dinosauri', p('M32 30 L2 18 Q10 30 12 40 L28 36 Z') + p('M32 30 L62 18 Q54 30 52 40 L36 36 Z') + e(32, 34, 5, 8) +
      p('M30 26 L28 14 L20 6 L32 16 L44 10 L36 20 L34 26 Z') + c(31, 18, 1.1, L) + s('M30 42 L28 50 M34 42 L36 50', 2), 2],
    ['brontosauro', 'Brontosauro', 'dinosauri', p('M6 50 Q14 34 30 34 Q44 32 48 22 Q50 10 56 6 Q62 4 62 10 L58 12 Q54 24 54 34 Q56 46 46 48 L46 58 L40 58 L38 50 L24 50 L22 58 L16 58 L16 50 Z') +
      c(59, 8, 1, D) + s('M6 50 Q2 52 2 46', 3), 4],
    ['stegosauro', 'Stegosauro', 'dinosauri', p('M2 46 Q10 36 26 32 Q42 30 52 38 L60 42 L56 46 L48 46 L46 56 L40 56 L38 48 L22 48 L20 56 L14 56 L14 48 Z') +
      p('M16 36 L18 24 L24 33 Z', D) + p('M24 32 L28 18 L33 31 Z', D) + p('M33 31 L38 18 L42 32 Z', D) + p('M42 33 L48 24 L49 37 Z', D) + p('M2 46 L0 40 L6 43 Z', L) + p('M4 44 L4 38 L8 42 Z', L) + c(56, 41, 1, D), 3],
    ['uovo-dinosauro', 'Uovo di dinosauro', 'dinosauri', p('M32 4 Q52 12 52 38 Q52 60 32 60 Q12 60 12 38 Q12 12 32 4 Z') + c(24, 26, 3, L) + c(38, 18, 2.5, L) + c(40, 40, 4, L) + c(26, 46, 2, L) +
      s('M18 30 L24 34 L22 40 L28 42', 2, D)],

    // ---------- Demoni e immondi ----------
    ['demone-alato', 'Demone con corna e ali', 'demoni', p('M24 30 Q8 10 2 14 Q6 24 2 34 Q12 32 20 40 Z') + p('M40 30 Q56 10 62 14 Q58 24 62 34 Q52 32 44 40 Z') +
      p('M20 60 L22 34 Q32 28 42 34 L44 60 L36 52 L28 52 Z') + c(32, 22, 8) + p('M26 18 Q18 14 18 4 Q24 12 28 15 Z') + p('M38 18 Q46 14 46 4 Q40 12 36 15 Z') +
      p('M28 22 L31 23 L28 24 Z', L) + p('M36 22 L33 23 L36 24 Z', L), 2],
    ['diavolo-tridente', 'Diavolo con tridente', 'demoni', p('M18 60 L21 34 Q32 28 43 34 L46 60 Z') + c(32, 19, 8) + p('M25 14 L22 4 L29 12 Z') + p('M39 14 L42 4 L35 12 Z') +
      c(29, 19, 1.4, L) + c(35, 19, 1.4, L) + p('M28 24 Q32 30 36 24 Q32 26 28 24 Z', D) + s('M54 62 L54 10', 3, L) + s('M48 14 L48 6 M54 10 L54 2 M60 14 L60 6 M48 14 Q54 18 60 14', 2.5, L) +
      s('M18 54 Q6 56 8 44 L4 40', 2.5)],
    ['diavoletto', 'Diavoletto', 'demoni', e(32, 44, 9, 10) + c(32, 28, 9) + p('M25 22 L20 12 L29 20 Z') + p('M39 22 L44 12 L35 20 Z') + p('M24 40 Q10 30 8 40 Q14 44 24 46 Z') +
      p('M40 40 Q54 30 56 40 Q50 44 40 46 Z') + c(28, 28, 2, L) + c(36, 28, 2, L) + p('M28 33 L36 33 L32 35 Z', D) + s('M40 52 Q52 58 54 48 L56 46', 2)],
    ['demone-bestia', 'Demone-bestia', 'demoni', p('M4 46 Q6 30 22 28 L28 18 L36 26 L50 28 Q60 32 60 44 L56 46 L54 58 L48 58 L48 48 L22 48 L20 58 L14 58 L14 48 Z') +
      p('M22 22 Q14 14 16 4 Q22 14 28 18 Z', L) + p('M30 20 Q30 10 38 6 Q34 14 34 22 Z', L) + c(24, 32, 1.6, '#ffd24a') + s('M20 40 L24 38 L28 40', 2, L), 2],
    ['signore-abissi', 'Signore degli abissi', 'demoni', p('M30 26 Q8 6 0 14 Q6 26 2 40 Q14 34 22 44 Z') + p('M34 26 Q56 6 64 14 Q58 26 62 40 Q50 34 42 44 Z') +
      p('M12 62 L16 34 Q32 24 48 34 L52 62 L40 56 L32 62 L24 56 Z') + c(32, 20, 10) + p('M24 14 Q10 12 8 0 Q18 8 26 9 Z') + p('M40 14 Q54 12 56 0 Q46 8 38 9 Z') +
      p('M26 20 L31 21 L26 23 Z', '#ffd24a') + p('M38 20 L33 21 L38 23 Z', '#ffd24a') + p('M26 26 L38 26 L32 32 Z', D) + c(32, 44, 4, D), 3],
    ['teschio-corna', 'Teschio con corna', 'demoni', p('M14 32 Q14 10 32 10 Q50 10 50 32 Q50 40 44 42 L44 52 L20 52 L20 42 Q14 40 14 32 Z') +
      p('M16 22 Q4 18 4 4 Q12 14 20 16 Z') + p('M48 22 Q60 18 60 4 Q52 14 44 16 Z') + e(25, 30, 5, 6, D) + e(39, 30, 5, 6, D) + p('M30 38 L34 38 L32 43 Z', D) +
      s('M24 52 L24 46 M29 52 L29 46 M35 52 L35 46 M40 52 L40 46', 2, D)],
    ['cane-infernale', 'Cane infernale', 'demoni', p('M6 40 L12 28 L16 18 L22 28 L30 30 L46 28 Q56 30 58 40 L54 42 L50 54 L46 54 L46 44 L28 44 L26 54 L22 54 L20 44 L12 44 Z') +
      c(16, 32, 1.6, '#ffd24a') + p('M46 28 Q50 16 46 8 Q54 14 52 22 Q58 16 56 8 Q62 20 54 30 Z', L) + p('M6 40 L2 44 L10 44 Z')],

    // ---------- Aberrazioni ----------
    ['occhio-tiranno', 'Sfera con occhi su stelo', 'aberrazioni', s('M22 20 Q16 10 10 8', 2.5) + s('M28 16 Q26 6 22 2', 2.5) + s('M36 16 Q38 6 42 2', 2.5) + s('M42 20 Q48 10 54 8', 2.5) +
      c(10, 8, 3.5) + c(22, 3, 3.5) + c(42, 3, 3.5) + c(54, 8, 3.5) + c(32, 36, 20) + e(32, 32, 10, 8, L) + c(32, 32, 5, D) + p('M18 46 Q32 56 46 46 L42 50 Q32 54 22 50 Z', D) +
      s('M22 48 L24 52 M28 50 L29 54 M35 50 L34 54 M41 48 L40 52', 1.5, L), 2],
    ['massa-tentacoli', 'Massa di tentacoli', 'aberrazioni', e(32, 30, 14, 12) + s('M20 38 Q8 44 10 56 Q12 60 6 60', 5) + s('M26 40 Q22 52 26 60', 5) + s('M38 40 Q42 52 38 60', 5) +
      s('M44 38 Q56 44 54 56 Q52 60 58 60', 5) + s('M20 26 Q6 22 4 12', 4) + s('M44 26 Q58 22 60 12', 4) + c(26, 28, 3, L) + c(38, 28, 3, L) + c(32, 22, 2, L) +
      c(26, 28, 1.3, D) + c(38, 28, 1.3, D), 2],
    ['divoratore-menti', 'Divoratore di cervelli', 'aberrazioni', p('M18 60 L21 36 Q32 30 43 36 L46 60 Z') + p('M20 22 Q20 4 32 4 Q44 4 44 22 Q44 28 38 30 L26 30 Q20 28 20 22 Z') +
      s('M28 30 Q26 40 22 44', 2.5) + s('M31 30 Q30 42 28 48', 2.5) + s('M34 30 Q34 42 36 48', 2.5) + s('M37 30 Q40 40 42 44', 2.5) +
      e(27, 20, 3, 2, L) + e(37, 20, 3, 2, L) + s('M24 10 Q32 6 40 10 M26 14 Q32 11 38 14', 1.5, D)],
    ['melma-occhi', 'Melma con occhi', 'aberrazioni', p('M6 56 Q4 40 14 36 Q14 22 28 22 Q34 12 44 20 Q58 22 56 38 Q62 46 58 56 Z') + c(22, 36, 5, L) + c(40, 30, 4, L) + c(46, 44, 3, L) +
      c(22, 37, 2, D) + c(40, 31, 1.6, D) + c(46, 45, 1.3, D) + c(30, 48, 2, L) + c(14, 50, 1.5, L)],

    // ---------- Elementali ----------
    ['elementale-fuoco', 'Elementale del fuoco', 'elementali', p('M32 62 Q12 58 14 40 Q16 30 22 26 Q22 34 26 36 Q24 22 32 12 Q34 4 30 2 Q46 10 44 28 Q48 24 48 18 Q56 30 52 46 Q48 60 32 62 Z') +
      p('M32 58 Q22 54 24 44 Q28 46 30 44 Q28 36 34 30 Q34 38 40 40 Q44 52 32 58 Z', L) + c(28, 40, 1.6, D) + c(36, 40, 1.6, D), 2],
    ['elementale-acqua', 'Elementale dell\'acqua', 'elementali', p('M32 4 Q46 22 48 34 Q50 46 44 52 Q56 54 60 60 L4 60 Q8 54 20 52 Q14 46 16 34 Q18 22 32 4 Z') +
      s('M22 36 Q26 32 30 36 M34 36 Q38 32 42 36', 2, L) + s('M10 58 Q16 54 22 58 M42 58 Q48 54 54 58', 2, L) + p('M24 44 Q32 50 40 44 Q32 46 24 44 Z', D), 2],
    ['elementale-terra', 'Elementale della terra', 'elementali', p('M14 60 L10 40 L18 26 L30 24 L40 28 L50 26 L56 40 L52 60 L40 60 L36 48 L28 48 L24 60 Z') +
      p('M22 26 L20 12 L32 6 L42 12 L42 26 Z') + p('M6 36 L12 28 L18 40 L12 46 Z') + p('M58 36 L52 28 L46 40 L52 46 Z') + c(28, 16, 2, '#ffd24a') + c(36, 16, 2, '#ffd24a') +
      s('M18 34 L26 40 M42 36 L46 44 M30 30 L34 36', 2, D), 2],
    ['elementale-aria', 'Elementale dell\'aria', 'elementali', s('M10 20 Q32 8 54 20 Q40 18 30 24', 5) + s('M14 32 Q34 22 50 32 Q38 30 30 36', 5) + s('M20 44 Q34 36 44 44 Q36 44 30 48', 4) +
      s('M28 52 Q34 48 36 54 Q34 58 30 60', 3) + c(26, 22, 1.8, D) + c(36, 22, 1.8, D) + s('M4 30 L10 30 M54 42 L60 42', 2, L), 2],

    // ---------- Altri mostri ----------
    ['idra-cinque', 'Idra a cinque teste', 'mostri', e(32, 52, 18, 9) + s('M20 46 Q8 36 6 22', 5) + s('M26 44 Q20 28 18 12', 5) + s('M32 44 Q32 24 32 8', 5) + s('M38 44 Q44 28 46 12', 5) + s('M44 46 Q56 36 58 22', 5) +
      e(6, 20, 4, 3) + e(18, 10, 4, 3) + e(32, 6, 4, 3) + e(46, 10, 4, 3) + e(58, 20, 4, 3) + c(5, 19, 0.9, L) + c(17, 9, 0.9, L) + c(31, 5, 0.9, L) + c(45, 9, 0.9, L) + c(57, 19, 0.9, L), 3],
    ['chimera', 'Chimera', 'mostri', p('M6 42 Q8 28 22 28 L46 28 Q56 30 56 42 L52 44 L50 56 L44 56 L44 46 L22 46 L20 56 L14 56 L14 46 Z') + c(14, 26, 8) + c(14, 26, 4, D) +
      p('M38 28 L40 16 L34 10 L42 12 L48 22 Z') + c(42, 15, 1, D) + s('M56 40 Q64 32 58 26', 3) + e(58, 24, 3, 2) + p('M26 28 Q30 14 44 10 Q38 18 40 26 Z', L) + c(12, 25, 1.2, L), 2],
    ['grifone', 'Grifone', 'mostri', p('M8 44 Q10 30 24 30 L42 30 Q54 32 54 44 L50 46 L48 58 L42 58 L42 48 L24 48 L22 58 L16 58 L16 48 Z') +
      p('M22 30 L18 18 Q20 8 30 10 L36 16 L28 18 L26 30 Z') + p('M28 18 L36 16 L32 22 Z', L) + c(25, 15, 1.2, D) + p('M30 30 Q34 8 58 4 Q54 14 58 18 Q44 20 42 30 Z', L) + s('M54 44 Q62 50 60 56', 2.5), 2],
    ['basilisco', 'Basilisco', 'mostri', p('M2 44 Q12 40 20 42 L28 34 L44 32 Q54 32 58 40 L62 44 L52 44 L50 50 L44 50 L42 44 L34 46 L32 54 L26 54 L28 46 L20 50 L16 56 L12 56 L16 48 Q8 48 2 44 Z') +
      s('M30 34 L32 28 M36 33 L38 27 M42 32 L44 26 M48 33 L50 28', 2, D) + c(54, 38, 2, '#ffd24a') + c(54, 38, 0.9, D), 2],
    ['scorpione-gigante', 'Scorpione gigante', 'mostri', e(32, 40, 12, 8) + s('M32 32 Q30 18 40 10 Q48 6 50 14', 5) + p('M48 12 L56 16 L50 20 Z', L) +
      s('M22 38 Q12 34 8 26', 4) + s('M42 38 Q52 34 56 26', 4) + p('M2 22 L10 18 L12 28 L4 30 Z') + p('M62 22 L54 18 L52 28 L60 30 Z') +
      s('M24 44 L14 52 M28 46 L22 56 M36 46 L42 56 M40 44 L50 52', 2.5) + c(28, 36, 1.2, L) + c(36, 36, 1.2, L), 2],
    ['verme-gigante', 'Verme gigante', 'mostri', p('M18 62 Q14 40 22 28 Q30 16 44 18 Q58 22 56 36 L48 34 Q40 28 34 34 Q30 44 34 62 Z') + e(48, 26, 10, 10, D) +
      p('M42 20 L44 24 L40 24 Z', L) + p('M54 22 L52 26 L50 22 Z', L) + p('M56 30 L52 30 L54 26 Z', L) + p('M40 30 L44 30 L42 34 Z', L) +
      s('M20 46 L32 46 M19 54 L32 54 M24 36 L34 38', 1.5, D), 3],
    ['gigante', 'Gigante', 'mostri', p('M14 62 L16 30 Q32 22 48 30 L50 62 L38 62 L36 46 L28 46 L26 62 Z') + c(32, 14, 9) + p('M23 12 Q32 2 41 12 L40 8 Q32 0 24 8 Z', D) + eyes(15) +
      p('M24 20 Q32 30 40 20 Q32 26 24 20 Z', D) + p('M16 32 L6 50 L12 52 L20 38 Z') + p('M48 32 L58 50 L52 52 L44 38 Z') + s('M56 52 L60 22', 5, L), 3],
    ['lich', 'Lich con corona', 'mostri', p('M14 62 Q18 34 32 30 Q46 34 50 62 L40 56 L32 62 L24 56 Z') + p('M22 22 Q22 8 32 8 Q42 8 42 22 Q42 28 36 30 L28 30 Q22 28 22 22 Z', L) +
      p('M22 10 L24 2 L28 7 L32 0 L36 7 L40 2 L42 10 Z', '#ffd24a') + e(28, 20, 3, 3.5, D) + e(36, 20, 3, 3.5, D) + c(28, 20, 1, '{c}') + c(36, 20, 1, '{c}') +
      s('M54 62 L54 18', 3, L) + c(54, 14, 5) + c(54, 14, 2, L)],
    ['vampiro-signore', 'Signore vampiro', 'mostri', p('M4 60 Q10 24 24 26 L32 40 L40 26 Q54 24 60 60 L46 50 L32 60 L18 50 Z') + p('M20 26 L14 8 L26 22 Z') + p('M44 26 L50 8 L38 22 Z') +
      c(32, 18, 8, L) + p('M24 14 Q32 4 40 14 L32 12 Z', D) + c(29, 18, 1.4, '{c}') + c(35, 18, 1.4, '{c}') + p('M29 22 L30 26 L31 22 Z', D) + p('M33 22 L34 26 L35 22 Z', D)],
    ['licantropo-bestia', 'Licantropo ululante', 'mostri', p('M18 62 L20 36 Q30 28 44 34 L46 62 L38 62 L36 50 L28 50 L26 62 Z') + p('M28 32 L22 18 L26 4 L30 14 L36 6 L36 16 L44 14 L40 24 L44 30 L36 34 Z') +
      p('M40 24 L46 22 L42 28 Z', D) + c(32, 16, 1.3, L) + p('M20 40 L10 30 L8 34 L18 46 Z') + p('M44 40 L54 30 L56 34 L46 46 Z') + p('M8 28 L6 34 L10 34 Z', L) + p('M56 28 L58 34 L54 34 Z', L)],
    ['albero-antico', 'Albero antico', 'mostri', p('M24 62 L26 36 Q14 38 8 28 Q4 16 16 12 Q20 2 32 4 Q44 2 48 12 Q60 16 56 28 Q50 38 38 36 L40 62 L36 56 L32 62 L28 56 Z') +
      e(27, 26, 3, 2, '#ffd24a') + e(37, 26, 3, 2, '#ffd24a') + p('M26 32 Q32 36 38 32 Q32 34 26 32 Z', D) + s('M26 40 L18 46 L14 44 M38 42 L46 48 L50 46', 3) +
      s('M20 18 L24 22 M42 16 L40 22 M32 8 L32 14', 2, D), 3],
    ['mimic', 'Forziere con denti', 'mostri', p('M6 34 L58 34 L58 60 L6 60 Z') + p('M6 26 Q6 8 32 8 Q58 8 58 26 L58 30 L6 30 Z') + r(6, 30, 52, 4, D) +
      p('M10 34 L14 42 L18 34 L22 42 L26 34 L30 42 L34 34 L38 42 L42 34 L46 42 L50 34 L54 42 L56 34 Z', L) + p('M10 30 L14 24 L18 30 L22 24 L26 30 L30 24 L34 30 L38 24 L42 30 L46 24 L50 30 L54 24 L56 30 Z', L) +
      p('M24 40 Q32 56 46 50 Q38 48 30 40 Z', '#c83a4a') + c(20, 18, 2.5, '#ffd24a') + c(44, 18, 2.5, '#ffd24a')],
  ];

  const ITEMS = [
    ['spada', 'Spada', p('M44 6 L58 6 L58 20 L24 50 L14 40 Z') + p('M14 40 L24 50 L20 54 L10 44 Z', D) + s('M12 46 L4 54 L10 60 L18 52', 4) + s('M20 38 L26 44', 3, D)],
    ['ascia', 'Ascia', s('M14 58 L44 18', 5) + p('M36 10 Q54 4 60 22 Q50 26 46 36 Q38 30 34 22 Z') + p('M38 18 L46 30', D)],
    ['arco', 'Arco', s('M14 6 Q54 10 58 50', 4) + s('M14 6 L58 50', 1.5, D) + s('M10 54 L48 16', 2.5, D) + p('M48 12 L54 10 L52 16 Z', D)],
    ['scudo', 'Scudo', p('M32 4 L56 12 Q56 44 32 60 Q8 44 8 12 Z') + p('M32 12 L48 17 Q48 40 32 52 Z', D)],
    ['armatura', 'Armatura', p('M18 8 L26 4 Q32 10 38 4 L46 8 L54 20 L46 26 L46 58 L18 58 L18 26 L10 20 Z') + s('M24 26 L40 26 M24 36 L40 36 M24 46 L40 46', 2, D)],
    ['pozione', 'Pozione', r(26, 4, 12, 6, D, 2) + r(28, 10, 8, 10) + p('M28 18 Q12 26 14 44 Q16 60 32 60 Q48 60 50 44 Q52 26 36 18 Z') + p('M18 40 Q32 34 46 40 Q46 56 32 56 Q18 56 18 40 Z', L)],
    ['pergamena', 'Pergamena', r(14, 10, 36, 44, '{c}', 2) + e(14, 32, 5, 24) + e(50, 32, 5, 24) + s('M22 22 L42 22 M22 30 L42 30 M22 38 L36 38', 2, D)],
    ['chiave', 'Chiave', c(18, 22, 12) + c(18, 22, 5, D) + r(28, 19, 30, 6) + r(46, 25, 4, 10) + r(54, 25, 4, 8)],
    ['forziere', 'Forziere', p('M6 30 L58 30 L58 58 L6 58 Z') + p('M6 30 Q6 12 32 12 Q58 12 58 30 Z') + r(6, 28, 52, 4, D) + r(28, 30, 8, 10, L, 1) + c(32, 35, 1.5, D)],
    ['borsa', 'Borsa di monete', p('M22 16 Q18 10 24 8 L40 8 Q46 10 42 16 Q58 26 56 44 Q54 60 32 60 Q10 60 8 44 Q6 26 22 16 Z') + s('M22 16 L42 16', 3, D) +
      c(32, 40, 8, L) + p('M30 34 L34 34 L34 46 L30 46 Z', D)],
    ['gemma', 'Gemma', p('M16 22 L24 10 L40 10 L48 22 L32 56 Z') + p('M16 22 L48 22 L32 56 Z', D) + p('M24 10 L28 22 L36 22 L40 10 Z', L)],
    ['torcia', 'Torcia', s('M26 60 L36 28', 6, D) + p('M36 28 Q22 22 30 10 Q32 18 36 14 Q38 6 34 2 Q50 10 44 22 Q42 28 36 28 Z') + p('M36 24 Q30 20 34 14 Q38 20 40 16 Q42 22 36 24 Z', L)],
    ['porta', 'Porta', p('M12 60 L12 18 Q12 4 32 4 Q52 4 52 18 L52 60 Z') + s('M22 14 L22 58 M32 8 L32 58 M42 14 L42 58', 2, D) + c(44, 36, 3, L)],
    ['leva', 'Leva', r(8, 46, 48, 12, D, 2) + s('M32 48 L48 12', 5) + c(48, 10, 6) + c(32, 48, 5, L)],
    ['trappola', 'Trappola', p('M4 50 L60 50 L56 58 L8 58 Z', D) + p('M8 50 L14 30 L20 50 Z') + p('M20 50 L26 30 L32 50 Z') + p('M32 50 L38 30 L44 50 Z') + p('M44 50 L50 30 L56 50 Z') +
      s('M8 44 Q32 14 56 44', 2.5)],
    ['barile', 'Barile', p('M14 8 L50 8 Q58 32 50 56 L14 56 Q6 32 14 8 Z') + r(10, 16, 44, 4, D) + r(9, 44, 46, 4, D) + s('M24 10 L22 54 M40 10 L42 54', 1.5, D)],
    ['bacchetta', 'Bacchetta', s('M10 54 L42 22', 5) + p('M46 6 L49 15 L58 18 L49 21 L46 30 L43 21 L34 18 L43 15 Z', L)],
  ];

  // Dimensione suggerita sulla griglia per le icone di creature grandi già presenti.
  const BIG = { drago: 3, idra: 3, troll: 2, ogre: 2, golem: 2, demone: 2, occhio: 2, tentacoli: 2, elementale: 2 };
  const toEntry = ([id, name, category, svg, grid]) => ({ id, name, category, svg, grid: grid || BIG[id] || 1 });
  const LIBRARY = CREATURES.map(toEntry);
  const ITEM_LIBRARY = ITEMS.map(([id, name, svg]) => ({ id, name, category: 'oggetti', svg }));

  DnD.libreriaIcone = { CREATURE_CATEGORIES, ITEM_CATEGORIES, LIBRARY, ITEM_LIBRARY };
})(globalThis.DnD = globalThis.DnD || {});
