// Disegno della griglia su <canvas>: colori letti dal tema (con cache, ridisegno al cambio tema) e primitive di
// disegno (forme, contorni, TileMap, zone, etichette, pedine con condizioni, NPC piazzati, segni degli oggetti,
// sfondo, coordinate, celle raggiungibili, percorso). Il ciclo di disegno draw() resta in ui-griglia.js.
// Livello interfaccia. Espone DnD.uiGrigliaDisegno { colors, redrawers, MARGIN, DOUBLE_CLICK_MS, DRAG_THRESHOLD, primitive(api) }; usa griglia,
// regole, icone, tilemap, tileset, immagini.
(function (DnD) {
  'use strict';

  const G = DnD.griglia;
  const R = DnD.regole;
  const MARGIN = 22;          // fascia delle coordinate sui bordi
  const DOUBLE_CLICK_MS = 400; // due clic entro questo tempo = doppio clic
  const DRAG_THRESHOLD = 4;   // pixel prima che un clic diventi un trascinamento

  // Colori del canvas letti dalle variabili CSS del tema; la cache si svuota al cambio tema.
  let palette = null;
  const redrawers = new Set();
  function colors() {
    if (!palette) {
      const cs = getComputedStyle(document.documentElement);
      const v = (name) => cs.getPropertyValue(name).trim();
      const rgb = (name) => v(name).split(',').map(Number);
      palette = {
        bg: v('--grid-bg'), board: v('--grid-board'), line: v('--grid-line'), line5: v('--grid-line-strong'),
        label: v('--grid-label'), labelBg: v('--grid-label-bg'), text: v('--text'), current: v('--accent'), selected: v('--selection'),
        missing: v('--grid-missing'), missingText: v('--grid-missing-text'), conc: v('--conc'), condBg: v('--cond-token-bg'),
        ok: v('--grid-ok'), bad: v('--grid-bad'),
        // Movimento: celle raggiungibili (1×) e con lo Scatto (2×), percorso.
        reach: v('--grid-reach'), reachDash: v('--grid-reach-dash'), path: v('--accent'),
        shapeStroke: v('--grid-shape-stroke'), hostile: v('--grid-hostile'), badgeBg: v('--grid-badge-bg'), badgeFg: v('--grid-badge-fg'),
        hiddenBg: v('--grid-hidden-bg'), hiddenSlash: v('--grid-hidden-slash'),
        hp: { alto: v('--hp-high'), medio: v('--hp-mid'), basso: v('--hp-low') }, hpTrack: v('--hp-track'),
        zone: { giocatori: rgb('--zone-players'), nemici: rgb('--zone-enemies') },
      };
    }
    return palette;
  }
  window.addEventListener('themechange', () => {
    palette = null;
    for (const redraw of redrawers) redraw();
  });

  /**
   * Primitive di disegno legate a una griglia.
   * @param {{view: () => object, requestDraw: () => void, tsIndex: () => object, dims: () => {w: number, h: number},
   *   wrap: HTMLElement}} api
   */
  function primitive(api) {
    const { requestDraw, tsIndex, dims, wrap } = api;

  function drawShape(ctx, shape, color, x, y, s, alpha) {
    const view = api.view();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = colors().shapeStroke;
    for (let j = 0; j < shape.h; j++) {
      for (let i = 0; i < shape.w; i++) {
        if (!G.isFilled(shape, i, j)) continue;
        const px = view.panX + (x + i) * s;
        const py = view.panY + (y + j) * s;
        ctx.fillRect(px, py, s, s);
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
      }
    }
    ctx.restore();
  }

  function outline(ctx, shape, x, y, s, color, dashed) {
    const view = api.view();
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([5, 4]);
    for (let j = 0; j < shape.h; j++) {
      for (let i = 0; i < shape.w; i++) {
        if (G.isFilled(shape, i, j)) ctx.strokeRect(view.panX + (x + i) * s + 1, view.panY + (y + j) * s + 1, s - 2, s - 2);
      }
    }
    ctx.restore();
  }

  function questionMark(ctx, cx, cy, s) {
    ctx.save();
    ctx.fillStyle = colors().missingText;
    ctx.font = 'bold ' + Math.round(s * 0.5) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy + 1);
    ctx.restore();
  }

  // Tilemap di una struttura o di un oggetto: i livelli sotto (above = false) o sopra le pedine, solo le
  // celle visibili. Se il TileSet o la sua immagine mancano compare un segnaposto grigio; l'ingombro resta valido.
  function drawPlacedTiles(ctx, e, s, above, faded, W, H) {
    const view = api.view();
    const clip = {
      x0: Math.floor((0 - view.panX) / s) - e.x, y0: Math.floor((0 - view.panY) / s) - e.y,
      x1: Math.ceil((W - view.panX) / s) - e.x, y1: Math.ceil((H - view.panY) / s) - e.y,
    };
    const res = DnD.uiTileset.drawTiles(ctx, e.tiles, view.panX + e.x * s, view.panY + e.y * s, s, {
      above, clip, onReady: requestDraw, byId: tsIndex(), layerAlpha: (l) => (faded && l.fade ? 0.4 : 1),
    });
    if (res.missing && !above) questionMark(ctx, view.panX + (e.x + e.w / 2) * s, view.panY + (e.y + e.h / 2) * s, s);
  }

  // TileMap della griglia: livelli sotto le pedine (prima) o sopra (dopo). Le celle dei livelli
  // "semitrasparenti" sopra una pedina si vedono al 40%.
  function drawGridMap(ctx, map, s, above, tokenCells, W, H) {
    const view = api.view();
    const clip = {
      x0: Math.max(0, Math.floor(-view.panX / s)), y0: Math.max(0, Math.floor(-view.panY / s)),
      x1: Math.ceil((W - view.panX) / s), y1: Math.ceil((H - view.panY) / s),
    };
    const covered = (x, y, span) => {
      for (let j = 0; j < span.h; j++) for (let i = 0; i < span.w; i++) if (tokenCells.has(G.key(x + i, y + j))) return true;
      return false;
    };
    DnD.uiTileset.drawTiles(ctx, map, view.panX, view.panY, s, {
      above, clip, onReady: requestDraw, byId: tsIndex(),
      cellAlpha: above ? (l, x, y, span) => (l.fade && covered(x, y, span) ? 0.4 : 1) : null,
    });
  }

  function drawZone(ctx, z, s, alpha) {
    const view = api.view();
    const [r, g, b] = colors().zone[z.kind];
    const px = view.panX + z.x * s;
    const py = view.panY + z.y * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.22)';
    ctx.fillRect(px, py, z.w * s, z.h * s);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, z.w * s - 2, z.h * s - 2);
    if (s >= 14) {
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',1)';
      ctx.font = '600 ' + Math.max(9, Math.min(12, s * 0.32)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(G.ZONE_KINDS[z.kind], px + 4, py + 3, z.w * s - 8);
    }
    ctx.restore();
  }

  function drawLabel(ctx, l, s) {
    const view = api.view();
    const cx = view.panX + (l.x + 0.5) * s;
    const cy = view.panY + (l.y + 0.5) * s;
    ctx.save();
    ctx.font = '600 ' + Math.max(9, Math.min(13, s * 0.34)) + 'px system-ui, sans-serif';
    const w = ctx.measureText(l.text).width + 8;
    ctx.fillStyle = colors().labelBg;
    ctx.fillRect(cx - w / 2, cy - 9, w, 18);
    ctx.strokeStyle = colors().current;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 + 0.5, cy - 8.5, w - 1, 17);
    ctx.fillStyle = colors().current;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, cx, cy + 0.5);
    ctx.restore();
  }

  // Pedina nel suo ingombro w × h: forme stirate (il cerchio diventa un'ellisse), immagini e icone della
  // libreria adattate senza deformarle, contorno del turno, selezione, barra della vita e nome.
  function drawToken(ctx, t, x, y, s, o) {
    const view = api.view();
    const dm = G.tokenDims(t);
    const dw = dm.w * s;
    const dh = dm.h * s;
    const px = view.panX + x * s;
    const py = view.panY + y * s;
    const cx = px + dw / 2;
    const cy = py + dh / 2;
    const pad = Math.min(dw, dh) * 0.12;
    const down = R.isDown(t);
    // Boss: alone del colore del tema (e aura in celle) sotto la pedina. Leggendari: alone e, in forma, ali.
    if (t.boss && !down && DnD.uiBoss) DnD.uiBoss.drawAura(ctx, t, cx, cy, dw, dh, s);
    if (t.legend && !down && DnD.uiLeggendario) DnD.uiLeggendario.drawHalo(ctx, t, cx, cy, dw, dh);
    ctx.save();
    if (o.ghost) ctx.globalAlpha = 0.6;
    if (down) { ctx.globalAlpha = 0.45; ctx.filter = 'grayscale(1)'; }
    DnD.icone.drawIconRect(ctx, t.icon, px + pad, py + pad, dw - 2 * pad, dh - 2 * pad, requestDraw);
    ctx.restore();
    // Fazione: contorno sottile del colore della fazione e pallino in alto a sinistra (tratteggiato se l'NPC è
    // in attesa di entrare nell'iniziativa; rosso se è ostile per una provocazione).
    const fac = factionOf(t.faction);
    if (fac && !down) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, dw / 2 - pad * 0.45, dh / 2 - pad * 0.45, 0, 0, Math.PI * 2);
      ctx.strokeStyle = (t.hostileTo && t.hostileTo.length) ? colors().hostile : fac.color;
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      if (t.joinRound) ctx.setLineDash([4, 3]);
      ctx.stroke();
      if (s >= 18) {
        const r = Math.max(3, s * 0.09);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px + pad + r * 0.6, py + pad + r * 1.6, r, 0, Math.PI * 2);
        ctx.fillStyle = fac.color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors().board;
        ctx.stroke();
      }
      ctx.restore();
    }
    // Sopra la pedina: corona del boss (il leggendario, anche in forma, ha l'aureola sotto la barra della vita).
    if (t.boss && !t.legend && DnD.uiBoss) DnD.uiBoss.drawCrown(ctx, t, cx, py + pad, Math.min(dw, dh), s);
    if (o.current) {
      ctx.save();
      ctx.beginPath();
      const ring = Math.max(3, s * 0.09);
      ctx.ellipse(cx, cy, dw / 2 - pad + ring, dh / 2 - pad + ring, 0, 0, Math.PI * 2);
      ctx.strokeStyle = colors().current;
      ctx.lineWidth = Math.max(2.5, s * 0.08);
      ctx.stroke();
      ctx.restore();
    }
    if (o.selected) {
      ctx.save();
      ctx.strokeStyle = colors().selected;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1.5, py + 1.5, dw - 3, dh - 3);
      ctx.restore();
    }
    // Mini barra della vita sopra la pedina.
    const bw = dw * 0.8;
    const bh = Math.max(3, s * 0.1);
    const bx = cx - bw / 2;
    const by = py + Math.max(1, s * 0.02);
    ctx.fillStyle = colors().hpTrack;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = down ? colors().missing : colors().hp[R.hpLevel(t.hp, t.maxHp)];
    ctx.fillRect(bx, by, bw * Math.max(0, t.hp / t.maxHp), bh);
    if (t.legend && !down && DnD.uiLeggendario) DnD.uiLeggendario.drawAureola(ctx, t, cx, by + bh, Math.min(dw, dh));
    ctx.strokeStyle = colors().line5;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
    // Numerino delle copie.
    if (t.copy) {
      const br = Math.max(6, s * 0.17);
      const bxx = px + dw - pad - br * 0.4;
      const byy = py + pad + br * 0.9;
      ctx.beginPath();
      ctx.arc(bxx, byy, br, 0, Math.PI * 2);
      ctx.fillStyle = colors().badgeBg;
      ctx.fill();
      ctx.strokeStyle = colors().badgeFg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = colors().badgeFg;
      ctx.font = 'bold ' + Math.round(br * 1.2) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(t.copy), bxx, byy + 0.5);
    }
    // Condizioni: al massimo 4 simboli in basso (gli altri come «+N»); concentrazione: anello tratteggiato.
    if (DnD.uiCondizioni && !t.dead) drawConditions(ctx, t, px, py, dw, dh, pad, s);
    // Nome sotto la pedina.
    if (s >= 22) {
      const fs = Math.max(9, Math.min(13, s * 0.3));
      ctx.font = '600 ' + fs + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors().board;
      const ty = py + dh - pad + 1;
      ctx.strokeText(t.name, cx, ty, dw + s);
      ctx.fillStyle = down ? colors().label : colors().text;
      ctx.fillText(t.name, cx, ty, dw + s);
    }
  }

  function drawConditions(ctx, t, px, py, dw, dh, pad, s) {
    const g = DnD.uiCondizioni.tokenGlyphs(t);
    if (g.conc) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(px + dw / 2, py + dh / 2, dw / 2 - pad * 0.15, dh / 2 - pad * 0.15, 0, 0, Math.PI * 2);
      ctx.strokeStyle = colors().conc;
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.restore();
    }
    if (!g.icons.length || s < 18) return;
    const size = Math.max(8, Math.min(16, s * 0.28));
    const items = g.icons.map((x) => ({ text: x.icon, level: x.level, color: x.color })).concat(g.more ? [{ text: '+' + g.more }] : []);
    const total = items.length * size;
    let x = px + dw / 2 - total / 2 + size / 2;
    const y = py + dh - pad - size * 0.55;
    ctx.save();
    ctx.font = Math.round(size * 0.78) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = colors().condBg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = it.color || colors().line5;
      ctx.stroke();
      ctx.fillStyle = colors().text;
      ctx.fillText(it.text, x, y + 0.5);
      if (it.level) {
        ctx.font = 'bold ' + Math.round(size * 0.5) + 'px system-ui, sans-serif';
        ctx.fillText(String(it.level), x + size * 0.38, y + size * 0.36);
        ctx.font = Math.round(size * 0.78) + 'px system-ui, sans-serif';
      }
      x += size;
    }
    ctx.restore();
  }

  // Fazioni della sessione per colore e nome (contorno delle pedine e degli NPC).
  let factionCache = null;
  function factionOf(id) {
    if (!id) return null;
    const st = DnD.store && DnD.store.state;
    if (!st || !st.factions) return null;
    if (!factionCache || factionCache.list !== st.factions) factionCache = { list: st.factions, map: new Map(st.factions.map((f) => [f.id, f])) };
    return factionCache.map.get(id) || null;
  }

  // Copia di un NPC del Mondo: icona nel suo ingombro, anello della fazione, nome sotto e stato (ostile, morto).
  function drawNpcItem(ctx, it, s) {
    const view = api.view();
    const px = view.panX + it.x * s;
    const py = view.panY + it.y * s;
    const dw = it.w * s;
    const dh = it.h * s;
    const pad = Math.min(dw, dh) * 0.12;
    const info = DnD.uiNpc ? DnD.uiNpc.itemInfo(it) : { faction: null, missing: false };
    ctx.save();
    if (it.npcState && it.npcState.dead) { ctx.globalAlpha *= 0.45; ctx.filter = 'grayscale(1)'; }
    if (info.missing) DnD.icone.drawIcon(ctx, { kind: 'shape', shape: 'cerchio', color: colors().missing }, px + dw / 2, py + dh / 2, Math.min(dw, dh) * 0.3);
    else DnD.icone.drawIconRect(ctx, it.icon, px + pad, py + pad, dw - 2 * pad, dh - 2 * pad, requestDraw);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(px + dw / 2, py + dh / 2, dw / 2 - pad * 0.45, dh / 2 - pad * 0.45, 0, 0, Math.PI * 2);
    ctx.strokeStyle = it.npcState && it.npcState.hostile ? colors().hostile : info.faction ? info.faction.color : colors().missing;
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.setLineDash([Math.max(2, s * 0.12), Math.max(2, s * 0.08)]);
    ctx.stroke();
    ctx.restore();
    if (s >= 22) {
      const fs = Math.max(9, Math.min(13, s * 0.3));
      ctx.save();
      ctx.font = 'italic 600 ' + fs + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors().board;
      const label = (info.roleIcon ? info.roleIcon + ' ' : '') + it.name + (it.npcState && it.npcState.hostile ? ' ⚔' : '');
      ctx.strokeText(label, px + dw / 2, py + dh - pad + 1, dw + s);
      ctx.fillStyle = colors().text;
      ctx.fillText(label, px + dw / 2, py + dh - pad + 1, dw + s);
      ctx.restore();
    }
  }

  // Oggetto di mappa: icona (o tile), con i segni di stato: aperto (più chiaro), chiuso a chiave 🔒,
  // trappola individuata ⚠ e nascosto (solo master: semitrasparente con l'occhio barrato).
  function drawObjectMarks(ctx, it, s) {
    const view = api.view();
    if (s < 14) return;
    const marks = (it.lock.locked && it.state !== 'aperto' ? '🔒' : '') + (it.trap.enabled && it.trap.armed && it.trap.found ? '⚠' : '');
    ctx.save();
    if (marks) {
      ctx.font = Math.max(8, Math.round(s * 0.3)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(marks, view.panX + (it.x + it.w) * s - 1, view.panY + it.y * s + 1);
    }
    if (it.hidden) {
      // Occhio barrato (nascosto ai giocatori, visibile solo al master) nell'angolo in basso a sinistra.
      const r = Math.max(4, s * 0.14);
      const cx = view.panX + it.x * s + r + 2;
      const cy = view.panY + (it.y + it.h) * s - r - 2;
      ctx.fillStyle = colors().hiddenBg;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors().badgeFg;
      ctx.lineWidth = Math.max(1, r * 0.22);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = colors().hiddenSlash;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.8);
      ctx.lineTo(cx + r, cy - r * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Sfondo della griglia: colore o immagine (adattata, coperta o a dimensione originale, con posizione,
  // scala e opacità), sempre sotto tutto e ritagliato sull'area della griglia.
  function drawBackground(ctx, g, s, N) {
    const view = api.view();
    const bg = g.background;
    ctx.fillStyle = bg && bg.kind === 'colore' ? bg.color : colors().board;
    ctx.fillRect(view.panX, view.panY, N.w * s, N.h * s);
    if (!bg || bg.kind !== 'immagine' || !DnD.immagini) return;
    const res = DnD.immagini.drawable(bg.imageId, requestDraw);
    if (res.state !== 'ok') return;
    const iw = res.img.width || res.img.naturalWidth;
    const ih = res.img.height || res.img.naturalHeight;
    const r = G.backgroundRect(bg, iw, ih, N.w, N.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.panX, view.panY, N.w * s, N.h * s);
    ctx.clip();
    ctx.globalAlpha = bg.opacity;
    ctx.drawImage(res.img, view.panX + r.x * s, view.panY + r.y * s, r.w * s, r.h * s);
    ctx.restore();
  }

  function drawLabels(ctx, W, H, s) {
    const view = api.view();
    ctx.fillStyle = colors().bg;
    ctx.fillRect(0, 0, W, MARGIN);
    ctx.fillRect(0, 0, MARGIN, H);
    ctx.fillStyle = colors().label;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const step = s >= 20 ? 1 : s >= 10 ? 2 : s >= 4 ? 5 : 10;
    const N = dims();
    for (let i = 0; i < Math.max(N.w, N.h); i += step) {
      const x = view.panX + (i + 0.5) * s;
      if (i < N.w && x > MARGIN && x < W) ctx.fillText(G.colLabel(i), x, MARGIN / 2);
      const y = view.panY + (i + 0.5) * s;
      if (i < N.h && y > MARGIN && y < H) ctx.fillText(String(i + 1), MARGIN / 2, y);
    }
    ctx.fillStyle = colors().bg;
    ctx.fillRect(0, 0, MARGIN, MARGIN);
  }

  // Movimento: celle dove ci si può fermare con il residuo (verde) e con lo Scatto (arancio).
  function drawReach(ctx, mv, s) {
    const view = api.view();
    ctx.save();
    for (const [set, col] of [[mv.normal, colors().reach], [mv.dash, colors().reachDash]]) {
      ctx.fillStyle = col;
      for (const k of set) ctx.fillRect(view.panX + G.keyX(k) * s, view.panY + G.keyY(k) * s, s, s);
    }
    ctx.restore();
  }
  // Percorso tratteggiato fino alla cella d'arrivo, pedina fantasma (rossa oltre il residuo) e costo sul cursore.
  function drawRoute(ctx, dr, s) {
    const view = api.view();
    const r = dr.route;
    const fp = dr.footprint;
    if (r && r.end) {
      const ctr = (p) => [view.panX + (p.x + fp.w / 2) * s, view.panY + (p.y + fp.h / 2) * s];
      ctx.save();
      ctx.strokeStyle = colors().path;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.setLineDash([s * 0.25, s * 0.18]);
      ctx.beginPath();
      r.path.forEach((p, i) => { const [x, y] = ctr(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.restore();
      drawShape(ctx, fp, colors().ok, r.end.x, r.end.y, s, 1);
    }
    if (!r || !r.end || r.stopped) drawShape(ctx, fp, colors().bad, dr.target.x, dr.target.y, s, 0.6);
    if (r && r.label && dr.cursor) {
      ctx.save();
      ctx.font = 'bold 12px system-ui, sans-serif';
      const tw = ctx.measureText(r.label).width + 12;
      ctx.fillStyle = colors().labelBg;
      // A sinistra del cursore se a destra non c'è spazio.
      const lx = dr.cursor.sx + 14 + tw > wrap.clientWidth ? dr.cursor.sx - 14 - tw : dr.cursor.sx + 14;
      ctx.fillRect(lx, dr.cursor.sy + 8, tw, 20);
      ctx.fillStyle = r.stopped || !r.end ? colors().hostile : colors().current;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.label, lx + 6, dr.cursor.sy + 18);
      ctx.restore();
    }
  }

    return { drawShape, outline, questionMark, drawPlacedTiles, drawGridMap, drawZone, drawLabel, drawToken, drawConditions, factionOf, drawNpcItem, drawObjectMarks, drawBackground, drawLabels, drawReach, drawRoute };
  }

  DnD.uiGrigliaDisegno = { colors, redrawers, MARGIN, DOUBLE_CLICK_MS, DRAG_THRESHOLD, primitive };
})(globalThis.DnD = globalThis.DnD || {});
