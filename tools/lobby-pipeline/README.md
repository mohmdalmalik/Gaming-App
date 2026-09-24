# Starting-room pipeline (Blender → baked glTF → game)

Builds the "Fourth Floor Landing" as one stylised model with its lighting baked in, matching the
style target `docs/art-reference.jpg`. Not part of the running game; the game only loads the output
in `assets/models/lobby/` (through `src/render/bakedRoom.js`).

## Steps
```bash
python3 -m pip install "bpy==4.2.0" pillow numpy                          # once
node    tools/lobby-pipeline/dump_lobby.mjs > tools/lobby-pipeline/lobby.json
python3 tools/lobby-pipeline/textures.py
python3 tools/lobby-pipeline/make_lobby.py --size 2048 --samples 64       # ~15 min on 4 CPUs
```
`--size 1024 --samples 32` is a quick look (~1–2 min). `--nobake` rebuilds geometry only (the light
maps then no longer match; do not commit that).

## What each file does
- `dump_lobby.mjs` — writes the room's walls, doorways and furniture footprints from
  `src/data/floor1.js`, so the model is built on exactly what collision and pathfinding use.
  `tests/browser-lobby.mjs` fails if the data and `lobby.json` ever drift apart: re-run the steps.
- `textures.py` — cream stone tiles, two burgundy rugs with gold borders, four paintings
  (into `build/`, embedded in the `.glb` as JPEG).
- `make_lobby.py` — the model and the bake:
  - **One style**: walnut raised-panel walls with brass inlay, crown moulding and a dark cap at a
    consistent 2.4 m cut; red velvet sofa and armchair, round walnut table, console with brass
    pulls, brass lamps with cream shades, sconces, gilt-framed paintings, plants in brass-banded
    planters, a walnut lift with brass frame, walnut door casings with brass plinths. Every piece is
    a softly bevelled box/cylinder; colours are vertex colours (no textures needed).
  - **Cutaway-ready walls**: each game wall segment becomes `W_<side>_<i>_lo` (to 0.64 m, with a dark
    cut cap) and `W_<side>_<i>_up` (the rest, origin on the cut). The game folds the upper part
    down when the camera looks over that wall.
  - **Bake** (Cycles, CPU): warm sky light from the open top, a soft key light, point lights in every
    lamp and sconce; diffuse light × an ambient-occlusion pass, denoised with Open Image Denoise.
    The floor and rugs get their own light map (mapped straight down); everything else shares an
    atlas. Faces nobody can see (bottoms, backs against walls) are left out so the atlas is used
    for visible surfaces. The cut caps are baked a second time with the upper walls hidden, since
    that is the only time they are seen.
  - Light maps are stored as `light / 4` in sRGB JPEG (`LM_SCALE`, must match `bakedRoom.js`).

## Tuning
- Overall brightness in the game: `exposure` for `hall` in `src/data/dressing.js` (no re-bake).
- Colours: `C` in `make_lobby.py`; lights: `setup_lighting()` and the `LIGHTS` entries (re-bake).
- Furniture footprints (collision) stay in `src/data/floor1.js`; move a piece there, re-dump, re-bake.
