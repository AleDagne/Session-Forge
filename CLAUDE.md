# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Session Forge: Italian-language D&D 5e session planner/player (maps, characters, creatures, combat, exploration, dice). Pure HTML/CSS/vanilla JS — no build step, no package manager, no dependencies, works offline (PWA). All UI text, comments, identifiers in data and commit messages are in **Italian**; keep to that. `README.md` (long, ~890 lines) is the detailed feature/data-model reference; `RIPRESA-LAVORO.md` is a work-resume log of the last development phase.

## Commands

- Run: open `index.html` directly, or serve it (needed for PWA/service worker). `.claude/launch.json` defines the `session-forge` server: `python -m http.server 5617` → `http://localhost:5617/index.html`.
- Tests: open `test.html` in a **visible** browser window (served, e.g. `http://localhost:5617/test.html`). It loads every script then runs `DnD.runTests()`; results are listed on the page with a pass/fail summary (hidden pane stays on "Esecuzione…"). There is no CLI runner and no single-test filter: tests are registered with `test(name, fn)` in `js/test.js` (helpers `eq`, `ok`, `seq(...)` for deterministic dice); to run one in isolation, temporarily narrow the list there.
- Browsers cache scripts aggressively: hard reload (Ctrl+F5) after edits.
- No lint/build commands exist.

## Architecture

- **Classic scripts, one global namespace.** No ES modules: every file is an IIFE `(function (DnD) { 'use strict'; … })(globalThis.DnD = globalThis.DnD || {});` that attaches to `DnD.<module>`. Load order matters and is defined by the `<script>` list in `index.html`; **`test.html` duplicates that list** and `sw.js` has a third copy (`FILES`). When adding/renaming a script or CSS file, update all three.
- **Layering by file prefix/order** (in `index.html`): `config/dadi/regole/classi/magie…` (pure rules & data) → domain logic (`griglia`, `movimento`, `creature`, `boss`, `biomi`, `eventi`, `esplorazione`, `percorso`, `leggendario`, `ia`, …) → `validazione`/`dati`/`sessioni` (store, migrations, import/export) → `ui-*.js` (DOM) → `app.js` (boot, nav, sessions). Domain modules are pure/logic-only and unit-tested; `ui-*.js` build DOM via `DnD.ui.el(...)` (`ui-comune.js`) and are not covered by tests.
- **Nav/menu** is data-driven from `DnD.config.MENU` (`js/config.js`), each item with a fixed `key` for its Alt+digit shortcut; `APP_NAME` is also in `config.js` (and `manifest.json` by hand).
- **Data & persistence** (`js/dati.js`, `sessioni.js`): data model is versioned (currently **v12**) with chained migrations `migrateV8 … migrateV12` run on raw data, including imported files. Data is per-origin (file:// vs localhost differ). Per-session data (npcs, players, grids, combat, exploration, notes, and the Mondo: factions, parties, cities, worldNpcs, quests, `session.world`) vs global libraries (races, spells, structures, equipment, mapObjects, tilesets, biomes, events, pathTemplates) — items can be flagged shared across sessions. Large images/tilesets live in IndexedDB (`immagini.js`). Changing the schema ⇒ add a migration, bump version, update README "Modello dati".
- **Dice**: `dadi.js` uses rejection-sampled `crypto.getRandomValues`; roll functions take an injectable RNG (tests pass `seq(...)`). `dadi.registratore` annotates rolls for the animated-dice overlay (`ui-dadi.js`, `css/dadi.css`) without changing results.
- **Combat/entities**: combatants are built by `regole.createCombatants`; creatures, bosses (phases/themes in `boss.js`) and legendary players (`percorso.js` skill-graph + `leggendario.js` effects/transformations) all reduce to the same creature-style action model so combat UI, IA (`ia.js`) and `movimento.js` (speeds, path costs, per-turn residual) treat them uniformly. Legendary themes reuse the boss theming system via `lg:<id>` keys; colours come only from CSS variables (`--boss-*`, `--lg-*`), never hard-coded in components.
- **Mondo** (`mondo-dati` data → pure `fazioni`/`party`/`citta`/`npc`/`quest` → `ui-mondo`/`ui-party`/`ui-npc`/`ui-quest`): `DnD.fazioni.relazione(a, b)` / `relazioneCombattenti` is the single source of truth for hostility (IA, movement, area warnings, combat end, NPC provocation); the three builtin factions `giocatori`/`nemici`/`neutrali` keep the old combat sides' ids. Placed NPC copies are map objects with `otype: 'npc'` and their own `npcState`.
- **Sounds**: everything goes through `DnD.audio.suona(id)`; events and recipes are data in `suoni-dati.js` (synthesised, no files).
- **Grid/maps**: `griglia.js` is the grid model; blocking is centralised in `DnD.griglia.isCellBlocked` (structures, closed doors/blocking map objects, forced cells, blocking tiles from `tilemap`/`tileset`). Grids are `battaglia` or `esplorazione` (biomes, events, fog).
- **Theming/settings**: `impostazioni.js` loads first (before CSS paint) to set theme/text size/reduced motion; all colours are CSS variables in `css/style.css`. Respect "Riduci animazioni" and "Effetti boss" settings in any new animation.

## Conventions

- Match the existing style: 2-space indent, single quotes, `const`/arrow functions, short Italian comments describing intent.
- After modifying any cached file, bump `CACHE` in `sw.js` (currently `session-forge-v24`).
- New logic should get tests in `js/test.js` and a README update (features, data model, migration notes, "Struttura" file list).
