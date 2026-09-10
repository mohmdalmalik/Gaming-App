# Gaming-App (working title)

A browser-based social exploration game: players are trapped in an elegant late-1980s grand hotel and explore connected rooms — through an elevated, angled "dollhouse" 3D view — to find a way out.

The game runs in the browser and targets iPad Safari (landscape, touch) while also working with a mouse on desktop. It's built with Three.js loaded as ES modules via a CDN import map, with no build step or bundler.

## Status
Early development. The first prototype will be a **greybox** — placeholder shapes standing in for real art — to test how the gameplay feels before any visual polish.

## The concept
The full product vision lives in **[docs/GAME_CONCEPT.md](docs/GAME_CONCEPT.md)**. Read it before any product-related work.

Working rules for coding agents are in **[CLAUDE.md](CLAUDE.md)** (see also [AGENTS.md](AGENTS.md)).

## Preview and run
This is a static site — no build step. To view it locally, serve the repo root with any static file server and open the page in a browser, for example:

```
python3 -m http.server
```

then visit the printed address (typically http://localhost:8000/). Opening `index.html` directly via `file://` also works for the current test page, but a local server is recommended once the game uses ES modules.

The live preview is hosted on GitHub Pages from `main`.

## Structure
- `index.html` — entry page (currently a simple test page).
- `docs/` — project documentation, including the game concept.
- `CLAUDE.md` / `AGENTS.md` — working rules for coding agents.

More structure (a `src/` folder of modules, room data files, and assets) will be added as the greybox prototype is built.
