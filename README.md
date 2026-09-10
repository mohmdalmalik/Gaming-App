# Gaming-App (working title)

A browser game in the making: players are trapped in an elegant late-1980s grand hotel and explore connected rooms — seen from an elevated, angled "dollhouse" view — to find a way out.

The full product vision lives in **[docs/GAME_CONCEPT.md](docs/GAME_CONCEPT.md)**. Working rules for coding agents are in **[CLAUDE.md](CLAUDE.md)** (see also [AGENTS.md](AGENTS.md)); key technical choices are recorded in **[docs/DECISIONS.md](docs/DECISIONS.md)**; current status and next steps in **[docs/PROGRESS.md](docs/PROGRESS.md)**.

## Status

**Greybox prototype** (step 1 of the development plan): the gameplay view built from plain placeholder shapes — boxes for walls and furniture, a capsule for the player. It exists to test the camera, touch controls, walking, room discovery, dead ends, mood changes and the exit on an iPad. No art, menu, characters, sound or cards yet.

## Open the preview

The game is published with GitHub Pages straight from the `main` branch:

**https://mohmdalmalik.github.io/Gaming-App/**

(If that address shows a 404, Pages needs switching on once: on GitHub open the repository → *Settings* → *Pages* → under *Build and deployment* choose *Deploy from a branch*, branch `main`, folder `/ (root)`, then *Save*. The page appears a minute or two later, and updates by itself after every push to `main`.)

Works on iPad Safari (landscape, touch) and on desktop with a mouse:

| Action | iPad | Desktop |
| --- | --- | --- |
| Walk | tap a spot on the floor | left-click |
| Go through a doorway | tap the glowing frame | click it |
| Zoom | pinch | mouse wheel (or trackpad pinch) |
| Move the view | two-finger drag (it drifts back to the player) | right- or middle-button drag |
| Rotate the view | ↺ ↻ buttons | same |
| Map / End turn | buttons | same |

## Run locally

There is nothing to install or build. Serve the repository folder with any static file server and open it in a browser, for example:

```
python3 -m http.server 8000
```

then visit http://localhost:8000/. (Opening `index.html` directly from the file system does not work: browsers refuse to load ES modules over `file://`.) Three.js is fetched from a CDN, so an internet connection is needed the first time.

## Project structure

```
index.html            page shell: import map for Three.js, interface elements, overlays
styles.css            interface styling (touch-safe, safe-area aware)
.nojekyll             tells GitHub Pages to serve files as they are
src/
  main.js             starts everything and runs the game loop; exposes window.__game for tests
  config.js           all tuning values (camera, player speed, zoom limits, colours…)
  data/floor1.js      THE FLOOR: rooms, doorways, furniture, moods and the action-point rules
  game/               pure rules, no rendering (reusable by a server later)
    floor.js          turns the data into world geometry: rooms, walls, doorways, checks
    grid.js           walkable grid + A* pathfinding + path smoothing
    state.js          game state: discovered rooms, action points, turns, exit
    moves.js          plans a walk from a tap: discovery rules + action-point check
  render/             Three.js placeholder visuals (the part to replace with real art)
    scene.js          renderer, scene, camera, global light, resizing
    materials.js      shared greybox geometry and materials
    roomView.js       rooms (floor, walls, furniture, lights) and doorway markers
    cutaway.js        lowers the walls that face the camera
    mood.js           per-room light colour/intensity/flicker, global light level
    playerView.js     the player capsule
  camera.js           camera rig: follow, 90° snap rotation, zoom, pan, ease back
  input.js            touch + mouse gestures → tap / pinch / drag / wheel
  player.js           walking along a path, turning, walk bob
  discovery.js        glue: taps → plan → walk; room changes → reveal + charge points
  hud.js  map.js  overlays.js   on-screen interface, 2D map, start/exit/error overlays
docs/                 concept, decisions, progress
```

## Editing the floor

Everything about the layout is data in `src/data/floor1.js`: room positions and sizes, which wall a doorway is in and where it leads, furniture blocks, the mood (light colour, brightness, flicker) and the action-point rules. The file header explains the format. If a change makes the floor invalid (rooms overlapping, a doorway to a room that does not touch that wall, a doorway blocked by furniture), the game refuses to start and lists the problems on screen instead of failing quietly.
